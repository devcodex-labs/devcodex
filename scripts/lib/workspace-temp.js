'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  findLayoutInfo,
  normalizeProjectNamespace,
  resolveActiveRuntimeRoot
} = require('../../hooks/_runtime/workspace-layout.cjs')
const {
  resolveWorkspaceTempBackupRoot,
  resolveWorkspaceTempProject,
  resolveWorkspaceTempRoot
} = require('./workspace-temp-layout.js')

const LEGACY_MANIFEST_SCHEMA = 'WorkspaceTempManifestV1'
const MANIFEST_SCHEMA = 'WorkspaceTempManifestV2'
const LEASE_SCHEMA = 'WorkspaceTempLeaseV2'
const LIFECYCLE_RECEIPT_SCHEMA = 'WorkspaceTempLifecycleReceiptV2'
const STATUS_SCHEMA = 'WorkspaceTempStatusV2'
const PRUNE_SCHEMA = 'WorkspaceTempPruneV2'
const MAX_ENTRIES = 10000
const MAX_CONTROL_FILE_BYTES = 64 * 1024
const PARTITIONS = Object.freeze(['runs', 'cache', 'backups', 'leases', 'quarantine', 'manifests'])
const ARTIFACT_PARTITIONS = Object.freeze(['runs', 'cache', 'backups', 'quarantine'])
const TYPE_PARTITION = Object.freeze({ run: 'runs', cache: 'cache', backup: 'backups', quarantine: 'quarantine' })
const DEFAULT_TTL_MS = Object.freeze({
  run: 24 * 60 * 60 * 1000,
  cache: 7 * 24 * 60 * 60 * 1000,
  backup: 7 * 24 * 60 * 60 * 1000,
  quarantine: 14 * 24 * 60 * 60 * 1000
})
const TARGET_SHAPE_MAX_ENTRIES = 4096
const TARGET_SHAPE_FILE_SAMPLE_LIMIT = 64
const TARGET_SHAPE_SAMPLE_BYTES = 2048
const NAMESPACE_SCAN_SKIP = new Set([
  'workspace', 'profile', '.memory', '.audit-state', '.runtime-state', '.tmp',
  'requirements', 'bugs', 'optimizations', 'scenario-tests', 'reports', 'data',
  'migrations', 'managed'
])
const TASK_CONTENT_ROOTS = new Set([
  'requirements', 'bugs', 'optimizations', 'scenario-tests'
])
const OWNERSHIP_DISQUALIFIERS = new Set([
  'path-escape', 'physical-path-escape', 'reparse-ancestor', 'path-unreadable',
  'unknown-manifest-schema', 'invalid-artifact-id', 'unknown-artifact-type',
  'unknown-owner', 'incomplete-owner-scope', 'partition-mismatch', 'partition-root-reserved',
  'target-identity-missing', 'target-identity-invalid', 'target-instance-changed',
  'target-identity-unreadable'
])

function isExternalDriveSpoolDirectoryName(value) {
  return /^\.tmp\.drive/i.test(String(value || ''))
}

function isLegacyWorkspaceTempDirectoryName(value) {
  return /^(?:tmp|temp|audit-tmp|release-tmp|\.tmp(?:[-_].+)?)$/i.test(String(value || ''))
}

function portable(value) {
  return String(value || '').replace(/\\/g, '/')
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function safeIdentifier(value) {
  const text = String(value || '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text)
}

function tempContractError(code, message = code, details = {}) {
  const error = new Error(message)
  error.name = 'WorkspaceTempContractError'
  error.code = code
  Object.assign(error, details)
  return error
}

function permissionReceipt(targetPath, kind) {
  if (process.platform === 'win32') {
    return {
      schemaVersion: 'WorkspaceTempPermissionReceiptV1',
      targetPath,
      kind,
      platform: 'win32',
      status: 'UNVERIFIED',
      evidence: 'DACL not probed by the source runtime'
    }
  }
  const mode = fs.statSync(targetPath).mode & 0o777
  const expectedMode = kind === 'directory' ? 0o700 : 0o600
  return {
    schemaVersion: 'WorkspaceTempPermissionReceiptV1',
    targetPath,
    kind,
    platform: process.platform,
    status: mode === expectedMode ? 'PASS' : 'WARN',
    mode,
    expectedMode
  }
}

function enforceWorkspaceTempTargetPermission(targetPath) {
  const stats = fs.lstatSync(targetPath)
  if (stats.isSymbolicLink()) throw tempContractError('WORKSPACE_TEMP_TARGET_REPARSE', targetPath)
  const kind = stats.isDirectory() ? 'directory' : 'file'
  if (process.platform !== 'win32') fs.chmodSync(targetPath, kind === 'directory' ? 0o700 : 0o600)
  return permissionReceipt(targetPath, kind)
}

function statNanoseconds(stats, field, fallbackField) {
  if (stats[field] != null) return String(stats[field])
  return String(BigInt(Math.trunc(Number(stats[fallbackField] || 0) * 1e6)))
}

function sampledFileDigest(file, stats) {
  const size = Number(stats.size)
  const firstLength = Math.min(TARGET_SHAPE_SAMPLE_BYTES, size)
  const lastLength = Math.min(TARGET_SHAPE_SAMPLE_BYTES, Math.max(0, size - firstLength))
  const first = Buffer.alloc(firstLength)
  const last = Buffer.alloc(lastLength)
  const descriptor = fs.openSync(file, 'r')
  try {
    if (firstLength) fs.readSync(descriptor, first, 0, firstLength, 0)
    if (lastLength) fs.readSync(descriptor, last, 0, lastLength, Math.max(0, size - lastLength))
  } finally {
    fs.closeSync(descriptor)
  }
  return crypto.createHash('sha256')
    .update(String(stats.size))
    .update('\0')
    .update(first)
    .update('\0')
    .update(last)
    .digest('hex')
}

function captureTargetShape(targetPath, targetStats) {
  if (targetStats.isFile()) {
    return {
      shapeDigest: sampledFileDigest(targetPath, targetStats),
      shapeEntries: 1,
      shapeTruncated: false
    }
  }
  if (!targetStats.isDirectory()) {
    return {
      shapeDigest: crypto.createHash('sha256').update(`other\0${targetStats.size}`).digest('hex'),
      shapeEntries: 1,
      shapeTruncated: false
    }
  }

  const records = []
  let sampledFiles = 0
  let truncated = false
  function visit(directory, relativeBase = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (records.length >= TARGET_SHAPE_MAX_ENTRIES) {
        truncated = true
        return
      }
      const full = path.join(directory, entry.name)
      const relative = portable(path.join(relativeBase, entry.name))
      const stats = fs.lstatSync(full, { bigint: true })
      const kind = stats.isDirectory() ? 'directory'
        : (stats.isFile() ? 'file' : (stats.isSymbolicLink() ? 'symlink' : 'other'))
      const record = { relative, kind, size: String(stats.size) }
      if (kind === 'file' && sampledFiles < TARGET_SHAPE_FILE_SAMPLE_LIMIT) {
        record.sampleDigest = sampledFileDigest(full, stats)
        sampledFiles += 1
      }
      records.push(record)
      if (kind === 'directory') visit(full, relative)
      if (truncated) return
    }
  }
  visit(targetPath)
  return {
    shapeDigest: crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    shapeEntries: records.length,
    shapeTruncated: truncated
  }
}

function captureTargetIdentity(targetPath, schemaVersion = 'WorkspaceTempTargetIdentityV2') {
  const stats = fs.lstatSync(targetPath, { bigint: true })
  if (stats.isSymbolicLink()) throw new Error(`WORKSPACE_TEMP_TARGET_REPARSE: ${targetPath}`)
  const kind = stats.isDirectory() ? 'directory' : (stats.isFile() ? 'file' : 'other')
  const base = {
    schemaVersion,
    kind,
    device: String(stats.dev),
    inode: String(stats.ino),
    birthtimeNs: statNanoseconds(stats, 'birthtimeNs', 'birthtimeMs')
  }
  if (schemaVersion === 'WorkspaceTempTargetIdentityV1') return base
  if (schemaVersion !== 'WorkspaceTempTargetIdentityV2') {
    throw new Error(`WORKSPACE_TEMP_TARGET_IDENTITY_SCHEMA_UNSUPPORTED: ${schemaVersion}`)
  }
  return {
    ...base,
    changeTimeNs: statNanoseconds(stats, 'ctimeNs', 'ctimeMs'),
    modifiedTimeNs: statNanoseconds(stats, 'mtimeNs', 'mtimeMs'),
    size: String(stats.size),
    linkCount: String(stats.nlink),
    ...captureTargetShape(targetPath, stats)
  }
}

function validTargetIdentity(value) {
  const baseValid = Boolean(
    ['WorkspaceTempTargetIdentityV1', 'WorkspaceTempTargetIdentityV2'].includes(value?.schemaVersion) &&
    ['directory', 'file', 'other'].includes(value.kind) &&
    /^-?\d+$/.test(String(value.device || '')) &&
    /^-?\d+$/.test(String(value.inode || '')) &&
    /^-?\d+$/.test(String(value.birthtimeNs || ''))
  )
  if (!baseValid || value.schemaVersion === 'WorkspaceTempTargetIdentityV1') return baseValid
  return ['changeTimeNs', 'modifiedTimeNs', 'size', 'linkCount']
    .every(field => /^-?\d+$/.test(String(value[field] || ''))) &&
    /^[a-f0-9]{64}$/.test(String(value.shapeDigest || '')) &&
    Number.isInteger(value.shapeEntries) && value.shapeEntries >= 0 &&
    typeof value.shapeTruncated === 'boolean'
}

function targetIdentityMatches(expected, observed, options = {}) {
  return validTargetIdentity(expected) && validTargetIdentity(observed) &&
    expected.schemaVersion === observed.schemaVersion &&
    expected.kind === observed.kind &&
    String(expected.device) === String(observed.device) &&
    String(expected.inode) === String(observed.inode) &&
    String(expected.birthtimeNs) === String(observed.birthtimeNs) &&
    (expected.schemaVersion === 'WorkspaceTempTargetIdentityV1' || (
      (options.allowRenameMetadataChange === true ||
        String(expected.changeTimeNs) === String(observed.changeTimeNs)) &&
      String(expected.modifiedTimeNs) === String(observed.modifiedTimeNs) &&
      String(expected.size) === String(observed.size) &&
      String(expected.linkCount) === String(observed.linkCount) &&
      expected.shapeDigest === observed.shapeDigest &&
      expected.shapeEntries === observed.shapeEntries &&
      expected.shapeTruncated === observed.shapeTruncated
    ))
}

function inspectPathBoundary(root, candidate) {
  const absoluteRoot = path.resolve(root)
  const absoluteTarget = path.resolve(candidate)
  if (!isContained(absoluteRoot, absoluteTarget)) {
    return { safe: false, reason: 'path-escape', reparseAncestor: false, physicalEscape: true, unreadable: false }
  }
  const segments = path.relative(absoluteRoot, absoluteTarget).split(path.sep).filter(Boolean)
  let current = absoluteRoot
  let deepestExisting = absoluteRoot
  try {
    const rootStats = fs.lstatSync(absoluteRoot)
    if (rootStats.isSymbolicLink()) {
      return { safe: false, reason: 'reparse-ancestor', reparseAncestor: true, physicalEscape: false, unreadable: false }
    }
    for (const segment of segments) {
      current = path.join(current, segment)
      if (!fs.existsSync(current)) break
      const stats = fs.lstatSync(current)
      if (stats.isSymbolicLink()) {
        return { safe: false, reason: 'reparse-ancestor', reparseAncestor: true, physicalEscape: false, unreadable: false }
      }
      deepestExisting = current
    }
    const physicalRoot = fs.realpathSync.native(absoluteRoot)
    const physicalExisting = fs.realpathSync.native(deepestExisting)
    const physicalRelative = path.relative(physicalRoot, physicalExisting)
    const physicalEscape = Boolean(physicalRelative) && (physicalRelative.startsWith('..') || path.isAbsolute(physicalRelative))
    return {
      safe: !physicalEscape,
      reason: physicalEscape ? 'physical-path-escape' : null,
      reparseAncestor: false,
      physicalEscape,
      unreadable: false
    }
  } catch {
    return { safe: false, reason: 'path-unreadable', reparseAncestor: false, physicalEscape: false, unreadable: true }
  }
}

function ensureWorkspaceTempPartitions(tempRoot) {
  const root = path.resolve(tempRoot)
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) {
    throw new Error(`WORKSPACE_TEMP_ROOT_REPARSE: ${root}`)
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700)
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error(`WORKSPACE_TEMP_ROOT_REPARSE: ${root}`)
  }
  for (const partition of PARTITIONS) {
    const partitionPath = path.join(root, partition)
    if (fs.existsSync(partitionPath) && fs.lstatSync(partitionPath).isSymbolicLink()) {
      throw new Error(`WORKSPACE_TEMP_PARTITION_REPARSE: ${partitionPath}`)
    }
    fs.mkdirSync(partitionPath, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') fs.chmodSync(partitionPath, 0o700)
    if (fs.lstatSync(partitionPath).isSymbolicLink()) {
      throw new Error(`WORKSPACE_TEMP_PARTITION_REPARSE: ${partitionPath}`)
    }
  }
  return root
}

function prepareWorkspaceTempBackupRoot(cwdOrActiveRoot, explicitProject = '') {
  const tempRoot = ensureWorkspaceTempPartitions(resolveWorkspaceTempRoot(cwdOrActiveRoot))
  const backupRoot = resolveWorkspaceTempBackupRoot(cwdOrActiveRoot, explicitProject)
  const before = inspectPathBoundary(tempRoot, backupRoot)
  if (!before.safe) throw new Error(`WORKSPACE_TEMP_BACKUP_ROOT_UNSAFE: ${before.reason}: ${backupRoot}`)
  fs.mkdirSync(backupRoot, { recursive: true })
  const after = inspectPathBoundary(tempRoot, backupRoot)
  if (!after.safe) throw new Error(`WORKSPACE_TEMP_BACKUP_ROOT_UNSAFE: ${after.reason}: ${backupRoot}`)
  return backupRoot
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(path.dirname(file), 0o700)
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  const content = JSON.stringify(value, null, 2) + '\n'
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTROL_FILE_BYTES) {
    throw new Error(`WORKSPACE_TEMP_CONTROL_FILE_TOO_LARGE: ${file}`)
  }
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600)
    try {
      fs.linkSync(temporary, file)
    } catch (error) {
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error
      fs.copyFileSync(temporary, file, fs.constants.COPYFILE_EXCL)
    }
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
  return permissionReceipt(file, 'file')
}

function manifestDigest(file) {
  const stats = fs.lstatSync(file)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`WORKSPACE_TEMP_MANIFEST_NOT_REGULAR: ${file}`)
  if (stats.size > MAX_CONTROL_FILE_BYTES) throw new Error(`WORKSPACE_TEMP_MANIFEST_TOO_LARGE: ${file}`)
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function findWorkspaceTempRootForPath(targetPath) {
  const target = path.resolve(targetPath)
  let current = path.dirname(target)
  while (true) {
    if (
      path.basename(current).toLocaleLowerCase('en-US') === 'devcodex' &&
      path.basename(path.dirname(current)).toLocaleLowerCase('en-US') === '.tmp'
    ) {
      const relative = path.relative(current, target)
      const partition = relative.split(path.sep).filter(Boolean)[0]
      if (ARTIFACT_PARTITIONS.includes(partition)) return current
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function controlFileDigest(file) {
  const stats = fs.lstatSync(file)
  if (stats.isSymbolicLink() || !stats.isFile()) throw tempContractError('WORKSPACE_TEMP_CONTROL_NOT_REGULAR', file)
  if (stats.size > MAX_CONTROL_FILE_BYTES) throw tempContractError('WORKSPACE_TEMP_CONTROL_FILE_TOO_LARGE', file)
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function readControlJson(file) {
  const digest = controlFileDigest(file)
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw tempContractError('WORKSPACE_TEMP_CONTROL_INVALID', file)
  }
  return { value, digest }
}

function atomicReplaceJson(file, value, expectedDigest) {
  if (!fs.existsSync(file) || controlFileDigest(file) !== expectedDigest) {
    throw tempContractError('WORKSPACE_TEMP_CONTROL_CAS_MISMATCH', file)
  }
  const content = `${JSON.stringify(value, null, 2)}\n`
  if (Buffer.byteLength(content) > MAX_CONTROL_FILE_BYTES) {
    throw tempContractError('WORKSPACE_TEMP_CONTROL_FILE_TOO_LARGE', file)
  }
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600)
    if (controlFileDigest(file) !== expectedDigest) {
      throw tempContractError('WORKSPACE_TEMP_CONTROL_CAS_MISMATCH', file)
    }
    fs.renameSync(temporary, file)
    if (controlFileDigest(file) !== crypto.createHash('sha256').update(content).digest('hex')) {
      throw tempContractError('WORKSPACE_TEMP_CONTROL_READBACK_MISMATCH', file)
    }
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
  return { digest: controlFileDigest(file), permission: permissionReceipt(file, 'file') }
}

function normalizeTempProject(project) {
  const value = String(project || 'workspace')
  if (value === 'workspace') return value
  return normalizeProjectNamespace(value, { layout: { enabled: false }, allowEmpty: false })
}

function projectSegments(project) {
  return String(project).split('/').filter(Boolean)
}

function v2ManifestPath(root, project, partition, artifactId) {
  const projectDigest = crypto.createHash('sha256').update(project).digest('hex')
  return path.join(root, 'manifests', 'v2', projectDigest, partition, `${artifactId}.json`)
}

function expectedV2TargetRelative(manifest) {
  const partition = TYPE_PARTITION[manifest.type]
  if (!partition) return ''
  return portable(path.join(
    partition,
    ...projectSegments(manifest.project),
    manifest.producer,
    manifest.artifactId,
    manifest.targetName
  ))
}

function validateV2ManifestIdentity(manifest, root, manifestPath = '') {
  const errors = []
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA) errors.push('schema-version-invalid')
  if (!safeIdentifier(manifest?.artifactId)) errors.push('artifact-id-invalid')
  if (!TYPE_PARTITION[manifest?.type]) errors.push('type-invalid')
  if (!safeIdentifier(manifest?.owner) || !safeIdentifier(manifest?.producer)) errors.push('owner-invalid')
  if (!safeIdentifier(manifest?.targetName)) errors.push('target-name-invalid')
  let project = ''
  try { project = normalizeTempProject(manifest?.project) } catch { errors.push('project-invalid') }
  if (project && project !== manifest.project) errors.push('project-noncanonical')
  if (!/^[a-f0-9]{64}$/.test(String(manifest?.ownerTokenDigest || ''))) errors.push('owner-token-invalid')
  const expectedRelative = expectedV2TargetRelative(manifest)
  if (!expectedRelative || portable(manifest?.targetRelativePath) !== expectedRelative) errors.push('target-relative-identity-mismatch')
  const targetPath = path.resolve(root, String(manifest?.targetRelativePath || ''))
  if (!isContained(root, targetPath)) errors.push('target-path-escape')
  if (manifestPath) {
    const expectedManifest = v2ManifestPath(root, project || 'workspace', TYPE_PARTITION[manifest?.type], manifest?.artifactId)
    if (pathComparisonKey(expectedManifest) !== pathComparisonKey(manifestPath)) errors.push('manifest-path-identity-mismatch')
  }
  return { valid: errors.length === 0, errors, targetPath, expectedRelative }
}

function createWorkspaceTempArtifactAtRoot(tempRoot, input = {}) {
  const root = ensureWorkspaceTempPartitions(tempRoot)
  const type = String(input.type || '').trim()
  const partition = TYPE_PARTITION[type]
  if (!partition) throw tempContractError('WORKSPACE_TEMP_TYPE_UNSUPPORTED', type || '(empty)')
  const owner = String(input.owner || '').trim()
  const producer = String(input.producer || owner).trim()
  const targetName = String(input.targetName || 'artifact').trim()
  if (!safeIdentifier(owner) || !safeIdentifier(producer) || !safeIdentifier(targetName)) {
    throw tempContractError('WORKSPACE_TEMP_OWNER_INVALID')
  }
  const project = normalizeTempProject(input.project)
  const artifactId = String(input.artifactId || `${type}-${crypto.randomBytes(12).toString('hex')}`).trim()
  if (!safeIdentifier(artifactId)) throw tempContractError('WORKSPACE_TEMP_ARTIFACT_ID_INVALID', artifactId)
  const ownerToken = String(input.ownerToken || crypto.randomBytes(32).toString('hex'))
  const ownerTokenDigest = crypto.createHash('sha256').update(ownerToken).digest('hex')
  const createdAtMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
  const ttlMs = Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TTL_MS[type]
  const targetRelativePath = portable(path.join(
    partition,
    ...projectSegments(project),
    producer,
    artifactId,
    targetName
  ))
  const targetPath = path.resolve(root, targetRelativePath)
  const manifestPath = v2ManifestPath(root, project, partition, artifactId)
  if (fs.existsSync(manifestPath) || fs.existsSync(targetPath)) {
    throw tempContractError('WORKSPACE_TEMP_ARTIFACT_ID_CONFLICT', artifactId)
  }
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    artifactId,
    type,
    owner,
    project,
    producer,
    targetName,
    targetRelativePath,
    ownerTokenDigest,
    lifecycleState: 'allocated',
    targetIdentity: null,
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
    cleanupPolicy: input.cleanupPolicy || 'delete',
    finalDisposition: null,
    leaseId: artifactId,
    generation: 1
  }
  const permission = atomicWriteJson(manifestPath, manifest)
  const validation = validateV2ManifestIdentity(manifest, root, manifestPath)
  if (!validation.valid) throw tempContractError('WORKSPACE_TEMP_MANIFEST_IDENTITY_INVALID', validation.errors.join(','))

  function transition(nextState, details = {}) {
    const current = readControlJson(manifestPath)
    const observed = current.value
    if (observed.ownerTokenDigest !== ownerTokenDigest) {
      throw tempContractError('WORKSPACE_TEMP_OWNER_TOKEN_MISMATCH')
    }
    const allowed = {
      allocated: new Set(['active', 'abandoned']),
      active: new Set(['finalized', 'abandoned']),
      finalized: new Set(),
      abandoned: new Set()
    }
    if (!allowed[observed.lifecycleState]?.has(nextState)) {
      throw tempContractError('WORKSPACE_TEMP_LIFECYCLE_TRANSITION_INVALID', `${observed.lifecycleState}->${nextState}`)
    }
    let targetIdentity = observed.targetIdentity
    let targetPermission = null
    if (nextState === 'active' || (nextState === 'abandoned' && fs.existsSync(targetPath))) {
      if (!fs.existsSync(targetPath)) throw tempContractError('WORKSPACE_TEMP_TARGET_MISSING', targetPath)
      targetPermission = enforceWorkspaceTempTargetPermission(targetPath)
      targetIdentity = captureTargetIdentity(targetPath)
    }
    const nowMs = Number.isFinite(details.nowMs) ? details.nowMs : Date.now()
    const next = {
      ...observed,
      lifecycleState: nextState,
      targetIdentity,
      finalDisposition: nextState === 'finalized' ? (details.finalDisposition || 'retained') : observed.finalDisposition,
      updatedAt: new Date(nowMs).toISOString(),
      generation: Number(observed.generation || 0) + 1,
      ...(details.failureCode ? { failureCode: details.failureCode } : {})
    }
    const write = atomicReplaceJson(manifestPath, next, current.digest)
    return {
      schemaVersion: LIFECYCLE_RECEIPT_SCHEMA,
      status: nextState,
      artifactId,
      ownerTokenDigest,
      project,
      producer,
      targetPath,
      manifestPath,
      manifestDigest: write.digest,
      generation: next.generation,
      permission: write.permission,
      targetPermission
    }
  }

  const allocationReceipt = {
    schemaVersion: LIFECYCLE_RECEIPT_SCHEMA,
    status: 'allocated',
    artifactId,
    ownerTokenDigest,
    project,
    producer,
    targetPath,
    manifestPath,
    manifestDigest: controlFileDigest(manifestPath),
    generation: 1,
    permission
  }
  return Object.freeze({
    artifactId,
    ownerToken,
    ownerTokenDigest,
    targetPath,
    manifestPath,
    allocationReceipt,
    activate: options => transition('active', options),
    finalize: options => transition('finalized', options),
    abandon: options => transition('abandoned', options)
  })
}

function createWorkspaceTempArtifact(cwdOrActiveRoot, input = {}) {
  const tempRoot = resolveWorkspaceTempRoot(cwdOrActiveRoot)
  const project = input.project || resolveWorkspaceTempProject(cwdOrActiveRoot)
  return createWorkspaceTempArtifactAtRoot(tempRoot, { ...input, project })
}

function withWorkspaceTempArtifactAtRoot(tempRoot, input, producer) {
  if (typeof producer !== 'function') throw tempContractError('WORKSPACE_TEMP_PRODUCER_REQUIRED')
  const artifact = createWorkspaceTempArtifactAtRoot(tempRoot, input)
  fs.mkdirSync(path.dirname(artifact.targetPath), { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(path.dirname(artifact.targetPath), 0o700)
  try {
    const value = producer({
      artifactId: artifact.artifactId,
      ownerToken: artifact.ownerToken,
      targetPath: artifact.targetPath,
      manifestPath: artifact.manifestPath
    })
    if (value && typeof value.then === 'function') {
      throw tempContractError('WORKSPACE_TEMP_ASYNC_PRODUCER_UNSUPPORTED')
    }
    const activeReceipt = artifact.activate()
    const finalReceipt = artifact.finalize({ finalDisposition: input.finalDisposition || 'retained' })
    return { ...artifact, value, activeReceipt, finalReceipt }
  } catch (error) {
    try { artifact.abandon({ failureCode: error.code || 'WORKSPACE_TEMP_PRODUCER_FAILED' }) } catch { }
    throw error
  }
}

function withWorkspaceTempArtifact(cwdOrActiveRoot, input, producer) {
  const project = input.project || resolveWorkspaceTempProject(cwdOrActiveRoot)
  return withWorkspaceTempArtifactAtRoot(resolveWorkspaceTempRoot(cwdOrActiveRoot), { ...input, project }, producer)
}

function withWorkspaceTempBackup(backupRoot, input, producer) {
  const absoluteBackupRoot = path.resolve(backupRoot)
  const tempRoot = findWorkspaceTempRootForPath(path.join(absoluteBackupRoot, 'candidate'))
  if (!tempRoot) throw tempContractError('WORKSPACE_TEMP_BACKUP_ROOT_INVALID', absoluteBackupRoot)
  const relative = path.relative(path.join(tempRoot, 'backups'), absoluteBackupRoot)
  const project = portable(relative).split('/').filter(Boolean).join('/') || 'workspace'
  return withWorkspaceTempArtifactAtRoot(tempRoot, {
    ...input,
    type: 'backup',
    project,
    targetName: input.targetName || 'backup'
  }, producer)
}

function acquireWorkspaceTempLease(tempRoot, input = {}) {
  const root = path.resolve(tempRoot)
  const artifactId = String(input.artifactId || '')
  const ownerToken = String(input.ownerToken || '')
  if (!safeIdentifier(artifactId) || !ownerToken) throw tempContractError('WORKSPACE_TEMP_LEASE_INPUT_INVALID')
  const project = normalizeTempProject(input.project)
  const partition = TYPE_PARTITION[String(input.type || '')]
  if (!partition) throw tempContractError('WORKSPACE_TEMP_LEASE_INPUT_INVALID')
  const manifestPath = v2ManifestPath(root, project, partition, artifactId)
  if (!fs.existsSync(manifestPath)) throw tempContractError('WORKSPACE_TEMP_ARTIFACT_NOT_FOUND', artifactId)
  const manifest = readControlJson(manifestPath).value
  const validation = validateV2ManifestIdentity(manifest, root, manifestPath)
  if (!validation.valid || manifest.project !== project || TYPE_PARTITION[manifest.type] !== partition) {
    throw tempContractError('WORKSPACE_TEMP_MANIFEST_IDENTITY_INVALID', validation.errors.join(','))
  }
  const ownerTokenDigest = crypto.createHash('sha256').update(ownerToken).digest('hex')
  if (manifest.ownerTokenDigest !== ownerTokenDigest) throw tempContractError('WORKSPACE_TEMP_OWNER_TOKEN_MISMATCH')
  const leaseToken = String(input.leaseToken || crypto.randomBytes(32).toString('hex'))
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
  const ttlMs = Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : 5 * 60 * 1000
  const lease = {
    schemaVersion: LEASE_SCHEMA,
    artifactId,
    project: manifest.project,
    producer: manifest.producer,
    ownerTokenDigest,
    leaseTokenDigest: crypto.createHash('sha256').update(leaseToken).digest('hex'),
    generation: 1,
    acquiredAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  }
  const leasePath = path.join(root, 'leases', `${artifactId}.json`)
  const permission = atomicWriteJson(leasePath, lease)
  return { leasePath, leaseToken, leaseTokenDigest: lease.leaseTokenDigest, generation: 1, permission }
}

function mutateWorkspaceTempLease(tempRoot, artifactId, leaseToken, mutation) {
  const leasePath = path.join(path.resolve(tempRoot), 'leases', `${artifactId}.json`)
  const current = readControlJson(leasePath)
  if (current.value.schemaVersion !== LEASE_SCHEMA ||
      !workspaceTempLeaseTokenMatches(current.value, leaseToken)) {
    throw tempContractError('WORKSPACE_TEMP_LEASE_TOKEN_MISMATCH')
  }
  return mutation({ leasePath, current })
}

function workspaceTempLeaseTokenMatches(lease, leaseToken) {
  const expected = String(lease?.leaseTokenDigest || '')
  const observed = crypto.createHash('sha256').update(String(leaseToken || '')).digest('hex')
  return /^[a-f0-9]{64}$/.test(expected) && expected === observed
}

function renewWorkspaceTempLease(tempRoot, input = {}) {
  return mutateWorkspaceTempLease(tempRoot, input.artifactId, input.leaseToken, ({ leasePath, current }) => {
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
    const ttlMs = Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : 5 * 60 * 1000
    const next = {
      ...current.value,
      generation: Number(current.value.generation || 0) + 1,
      renewedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + ttlMs).toISOString()
    }
    const write = atomicReplaceJson(leasePath, next, current.digest)
    return { status: 'renewed', leasePath, generation: next.generation, digest: write.digest }
  })
}

function releaseWorkspaceTempLease(tempRoot, input = {}) {
  return mutateWorkspaceTempLease(tempRoot, input.artifactId, input.leaseToken, ({ leasePath, current }) => {
    if (controlFileDigest(leasePath) !== current.digest) throw tempContractError('WORKSPACE_TEMP_LEASE_CAS_MISMATCH')
    fs.rmSync(leasePath, { force: true })
    return { status: 'released', leasePath, generation: current.value.generation }
  })
}

function registerWorkspaceTempArtifactAtRoot(tempRoot, input = {}) {
  void tempRoot
  void input
  throw tempContractError(
    'WORKSPACE_TEMP_V1_REGISTRATION_READ_ONLY',
    'WorkspaceTempManifestV1 is read-only; use createWorkspaceTempArtifactAtRoot or withWorkspaceTempArtifactAtRoot'
  )
}

function registerWorkspaceTempBackup(targetPath, options = {}) {
  void targetPath
  void options
  throw tempContractError(
    'WORKSPACE_TEMP_V1_REGISTRATION_READ_ONLY',
    'late backup registration is disabled; use withWorkspaceTempBackup'
  )
}

function inspectTarget(targetPath, maxEntries = MAX_ENTRIES) {
  if (!fs.existsSync(targetPath)) {
    return { exists: false, files: 0, bytes: 0, entries: 0, truncated: false, reparse: false, lock: false, unreadable: false }
  }
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    return { exists: true, files: 0, bytes: 0, entries: 0, truncated: true, reparse: false, lock: false, unreadable: false }
  }
  const pending = [path.resolve(targetPath)]
  let visited = 0
  let files = 0
  let bytes = 0
  let reparse = false
  let ordinaryLocks = 0
  let unreadable = false
  let truncated = false
  while (pending.length && visited < maxEntries) {
    const current = pending.pop()
    visited++
    let stats
    try { stats = fs.lstatSync(current) } catch {
      unreadable = true
      continue
    }
    if (stats.isSymbolicLink()) {
      reparse = true
      continue
    }
    if (path.basename(current).endsWith('.lock')) ordinaryLocks += 1
    if (!stats.isDirectory()) {
      files++
      bytes += stats.size
      continue
    }
    let directory
    try { directory = fs.opendirSync(current) } catch {
      unreadable = true
      continue
    }
    try {
      let entry
      while ((entry = directory.readSync()) !== null) {
        if (visited + pending.length >= maxEntries) {
          truncated = true
          break
        }
        pending.push(path.join(current, entry.name))
      }
    } catch {
      unreadable = true
    } finally {
      try { directory.closeSync() } catch { unreadable = true }
    }
  }
  return {
    exists: true,
    files,
    bytes,
    entries: visited,
    truncated: truncated || pending.length > 0,
    reparse,
    lock: false,
    ordinaryLocks,
    unreadable
  }
}

function readLease(root, leaseId, nowMs, expectedManifest = null) {
  if (!leaseId) return { status: 'none', path: null }
  const leasePath = path.join(root, 'leases', `${leaseId}.json`)
  if (!fs.existsSync(leasePath)) return { status: 'missing', path: leasePath }
  try {
    const stats = fs.lstatSync(leasePath)
    if (stats.isSymbolicLink() || !stats.isFile()) return { status: 'invalid', path: leasePath, reason: 'lease-not-regular-file' }
    if (stats.size > MAX_CONTROL_FILE_BYTES) return { status: 'invalid', path: leasePath, reason: 'lease-too-large' }
    const raw = fs.readFileSync(leasePath)
    const value = JSON.parse(raw.toString('utf8'))
    if (![LEASE_SCHEMA, 'WorkspaceTempLeaseV1'].includes(value?.schemaVersion)) {
      return { status: 'invalid', path: leasePath, reason: 'unknown-lease-schema' }
    }
    if (value.schemaVersion === LEASE_SCHEMA) {
      const bindingValid = safeIdentifier(value.artifactId) && value.artifactId === leaseId &&
        /^[a-f0-9]{64}$/.test(String(value.ownerTokenDigest || '')) &&
        /^[a-f0-9]{64}$/.test(String(value.leaseTokenDigest || '')) &&
        Number.isInteger(value.generation) && value.generation > 0 &&
        (!expectedManifest || (
          value.artifactId === expectedManifest.artifactId &&
          value.project === expectedManifest.project &&
          value.producer === expectedManifest.producer &&
          value.ownerTokenDigest === expectedManifest.ownerTokenDigest
        ))
      if (!bindingValid) return { status: 'invalid', path: leasePath, reason: 'lease-binding-invalid' }
    }
    const expiresAtMs = Date.parse(value?.expiresAt)
    if (!Number.isFinite(expiresAtMs)) return { status: 'invalid', path: leasePath }
    return {
      status: expiresAtMs > nowMs ? 'active' : 'expired',
      path: leasePath,
      schemaVersion: value.schemaVersion,
      generation: value.generation || null,
      expiresAt: new Date(expiresAtMs).toISOString(),
      digest: crypto.createHash('sha256').update(raw).digest('hex')
    }
  } catch {
    return { status: 'invalid', path: leasePath }
  }
}

function inspectManifest(root, manifestPath, nowMs, maxTargetEntries = MAX_ENTRIES) {
  let manifest
  let raw
  try {
    const stats = fs.lstatSync(manifestPath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return { manifestPath, eligible: false, reasons: ['invalid-manifest-entry'] }
    }
    if (stats.size > MAX_CONTROL_FILE_BYTES) {
      return { manifestPath, eligible: false, reasons: ['manifest-too-large'] }
    }
    raw = fs.readFileSync(manifestPath)
    manifest = JSON.parse(raw.toString('utf8'))
  } catch {
    return { manifestPath, eligible: false, reasons: ['invalid-manifest-json'] }
  }
  const reasons = []
  const isV2 = manifest?.schemaVersion === MANIFEST_SCHEMA
  const isLegacy = manifest?.schemaVersion === LEGACY_MANIFEST_SCHEMA
  if (!isV2 && !isLegacy) reasons.push('unknown-manifest-schema')
  if (isLegacy) reasons.push('legacy-manifest-read-only')
  if (!safeIdentifier(manifest?.artifactId) || path.basename(manifestPath) !== `${manifest.artifactId}.json`) reasons.push('invalid-artifact-id')
  const type = String(manifest?.type || '')
  if (!TYPE_PARTITION[type]) reasons.push('unknown-artifact-type')
  if (!String(manifest?.owner || '').trim() || (isV2 && !safeIdentifier(manifest.owner))) reasons.push('unknown-owner')
  if (!String(manifest?.project || '').trim() || !String(manifest?.producer || '').trim()) reasons.push('incomplete-owner-scope')
  if (manifest?.cleanupPolicy !== 'delete') reasons.push('cleanup-policy-not-delete')
  if (manifest?.targetIdentity == null) {
    if (!isV2 || !['allocated', 'abandoned'].includes(manifest.lifecycleState)) reasons.push('target-identity-missing')
  } else if (!validTargetIdentity(manifest.targetIdentity)) reasons.push('target-identity-invalid')

  const v2Identity = isV2 ? validateV2ManifestIdentity(manifest, root, manifestPath) : null
  if (v2Identity && !v2Identity.valid) reasons.push(...v2Identity.errors)
  const targetPath = isV2
    ? v2Identity.targetPath
    : path.resolve(String(manifest?.targetPath || root))
  const targetContained = isV2
    ? v2Identity.valid && isContained(root, targetPath)
    : Boolean(manifest?.targetPath) && path.isAbsolute(String(manifest.targetPath)) && isContained(root, targetPath)
  const boundary = targetContained
    ? inspectPathBoundary(root, targetPath)
    : { safe: false, reason: 'path-escape' }
  if (!targetContained) reasons.push('path-escape')
  else if (!boundary.safe) reasons.push(boundary.reason)
  if (TYPE_PARTITION[type] && path.relative(root, targetPath).split(path.sep).filter(Boolean)[0] !== TYPE_PARTITION[type]) {
    reasons.push('partition-mismatch')
  }
  if (TYPE_PARTITION[type] && path.relative(root, targetPath).split(path.sep).filter(Boolean).length < 2) {
    reasons.push('partition-root-reserved')
  }
  if (isV2 && !['allocated', 'active', 'finalized', 'abandoned'].includes(manifest.lifecycleState)) {
    reasons.push('lifecycle-state-invalid')
  }
  if (isV2 && ['allocated', 'active'].includes(manifest.lifecycleState)) reasons.push('lifecycle-not-finalized')
  const createdAtMs = Date.parse(manifest?.createdAt)
  const expiresAtMs = Date.parse(manifest?.expiresAt)
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs < createdAtMs) reasons.push('invalid-retention-window')
  if (isLegacy && type === 'backup' && manifest?.transactionStatus !== 'completed') reasons.push('backup-transaction-incomplete')
  if (manifest?.leaseId != null && !safeIdentifier(manifest.leaseId)) reasons.push('invalid-lease-id')
  const lease = readLease(root, safeIdentifier(manifest?.leaseId) ? manifest.leaseId : null, nowMs, isV2 ? manifest : null)
  if (lease.status === 'active') reasons.push('active-lease')
  if (lease.status === 'invalid') reasons.push('invalid-lease')

  const target = targetContained && boundary.safe
    ? inspectTarget(targetPath, maxTargetEntries)
    : { exists: false, files: 0, bytes: 0, entries: 0, truncated: false, reparse: false, lock: false, unreadable: false }
  if (target.reparse) reasons.push('reparse-point')
  if (target.unreadable) reasons.push('target-unreadable')
  if (target.truncated) reasons.push('inspection-truncated')
  let observedTargetIdentity = null
  if (target.exists && validTargetIdentity(manifest?.targetIdentity)) {
    try {
      observedTargetIdentity = captureTargetIdentity(targetPath, manifest.targetIdentity.schemaVersion)
      if (!targetIdentityMatches(manifest.targetIdentity, observedTargetIdentity)) {
        reasons.push('target-instance-changed')
      }
    } catch {
      reasons.push('target-identity-unreadable')
    }
  }
  if (Number.isFinite(expiresAtMs) && expiresAtMs > nowMs) reasons.push('ttl-not-expired')
  return {
    manifestPath,
    manifestDigest: crypto.createHash('sha256').update(raw).digest('hex'),
    artifactId: manifest?.artifactId || null,
    manifestSchema: manifest?.schemaVersion || null,
    lifecycleState: manifest?.lifecycleState || (isLegacy ? 'legacy-read-only' : null),
    type: manifest?.type || null,
    owner: manifest?.owner || null,
    project: manifest?.project || null,
    producer: manifest?.producer || null,
    leaseId: safeIdentifier(manifest?.leaseId) ? manifest.leaseId : null,
    targetPath,
    targetRelativePath: isV2 ? manifest.targetRelativePath : null,
    targetIdentity: validTargetIdentity(manifest?.targetIdentity) ? manifest.targetIdentity : null,
    observedTargetIdentity,
    expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null,
    target,
    lease,
    category: isLegacy ? 'legacy' : (isV2 ? 'registered' : 'invalid'),
    eligible: reasons.length === 0,
    reasons
  }
}

function removeIdentityBoundTarget(root, targetPath, expectedIdentity, artifactId) {
  if (!fs.existsSync(targetPath)) return { removed: false, stagedPath: null }
  const observed = captureTargetIdentity(targetPath, expectedIdentity.schemaVersion)
  if (!targetIdentityMatches(expectedIdentity, observed)) {
    throw Object.assign(new Error('registered target instance was replaced before deletion'), {
      code: 'WORKSPACE_TEMP_TARGET_INSTANCE_CHANGED'
    })
  }
  const stagedPath = `${targetPath}.devcodex-prune-${artifactId}-${crypto.randomBytes(6).toString('hex')}`
  const stagedBoundary = inspectPathBoundary(root, stagedPath)
  if (!stagedBoundary.safe || fs.existsSync(stagedPath)) {
    throw Object.assign(new Error('identity-bound prune staging path is unavailable'), {
      code: 'WORKSPACE_TEMP_PRUNE_STAGE_UNSAFE'
    })
  }
  fs.renameSync(targetPath, stagedPath)
  try {
    const movedIdentity = captureTargetIdentity(stagedPath, expectedIdentity.schemaVersion)
    if (!targetIdentityMatches(expectedIdentity, movedIdentity, { allowRenameMetadataChange: true })) {
      throw Object.assign(new Error('target instance changed during identity-bound rename'), {
        code: 'WORKSPACE_TEMP_TARGET_INSTANCE_CHANGED'
      })
    }
    fs.rmSync(stagedPath, { recursive: true, force: true })
    return { removed: true, stagedPath }
  } catch (error) {
    if (fs.existsSync(stagedPath) && !fs.existsSync(targetPath)) {
      try {
        fs.renameSync(stagedPath, targetPath)
      } catch (restoreError) {
        error.restoreFailure = {
          stagedPath,
          targetPath,
          errorCode: restoreError.code || 'WORKSPACE_TEMP_TARGET_RESTORE_FAILED',
          message: restoreError.message
        }
      }
    }
    throw error
  }
}

function readDirectoryEntriesBounded(root, limit = MAX_ENTRIES) {
  if (!fs.existsSync(root)) return { entries: [], truncated: false, unreadable: false }
  if (!Number.isInteger(limit) || limit <= 0) return { entries: [], truncated: true, unreadable: false }
  let directory
  try { directory = fs.opendirSync(root) } catch {
    return { entries: [], truncated: true, unreadable: true }
  }
  const entries = []
  let truncated = false
  let unreadable = false
  try {
    let entry
    while ((entry = directory.readSync()) !== null) {
      if (entries.length >= limit) {
        truncated = true
        break
      }
      entries.push(entry)
    }
  } catch {
    truncated = true
    unreadable = true
  } finally {
    try { directory.closeSync() } catch { unreadable = true }
  }
  return { entries, truncated, unreadable }
}

function readChildDirectoriesBounded(root, limit = MAX_ENTRIES) {
  if (!fs.existsSync(root)) return { entries: [], visited: 0, truncated: false, unreadable: false }
  if (!Number.isInteger(limit) || limit <= 0) return { entries: [], visited: 0, truncated: true, unreadable: false }
  let directory
  try { directory = fs.opendirSync(root) } catch {
    return { entries: [], visited: 0, truncated: true, unreadable: true }
  }
  const entries = []
  let rawVisited = 0
  let truncated = false
  let unreadable = false
  try {
    let entry
    while ((entry = directory.readSync()) !== null) {
      rawVisited++
      if (rawVisited > MAX_ENTRIES) {
        truncated = true
        break
      }
      if (!(entry.isDirectory() || entry.isSymbolicLink())) continue
      if (entries.length >= limit) {
        truncated = true
        break
      }
      entries.push(entry)
    }
  } catch {
    truncated = true
    unreadable = true
  } finally {
    try { directory.closeSync() } catch { unreadable = true }
  }
  return { entries, visited: entries.length, truncated, unreadable }
}

function collectLeafEntries(root, limit = MAX_ENTRIES) {
  if (!fs.existsSync(root)) return { entries: [], visited: 0, truncated: false }
  if (!Number.isInteger(limit) || limit <= 0) return { entries: [], visited: 0, truncated: true }
  const pending = [path.resolve(root)]
  const entries = []
  let visited = 0
  let truncated = false
  while (pending.length && visited < limit) {
    const current = pending.pop()
    visited++
    let stats
    try { stats = fs.lstatSync(current) } catch { continue }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      entries.push(current)
      continue
    }
    let directory
    try { directory = fs.opendirSync(current) } catch {
      entries.push(current)
      continue
    }
    let childCount = 0
    try {
      let child
      while ((child = directory.readSync()) !== null) {
        childCount++
        if (visited + pending.length >= limit) {
          truncated = true
          break
        }
        pending.push(path.join(current, child.name))
      }
    } catch {
      truncated = true
      entries.push(current)
    } finally {
      try { directory.closeSync() } catch { truncated = true }
    }
    if (childCount === 0 && current !== path.resolve(root)) entries.push(current)
  }
  return { entries, visited, truncated: truncated || pending.length > 0 }
}

function pathComparisonKey(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function addReason(record, reason) {
  if (!record.reasons.includes(reason)) record.reasons.push(reason)
}

function hasOwnershipAuthority(record) {
  return Boolean(record.targetPath) && !(record.reasons || []).some(reason => OWNERSHIP_DISQUALIFIERS.has(reason))
}

function markOwnershipOverlaps(records) {
  const groups = new Map()
  for (const record of records) {
    if (!hasOwnershipAuthority(record)) continue
    const key = pathComparisonKey(record.targetPath)
    const group = groups.get(key) || []
    group.push(record)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    if (group.length > 1) for (const record of group) addReason(record, 'ownership-overlap')
  }
  for (const group of groups.values()) {
    let current = path.dirname(group[0].targetPath)
    while (true) {
      const ancestorGroup = groups.get(pathComparisonKey(current))
      if (ancestorGroup) {
        for (const ancestor of ancestorGroup) addReason(ancestor, 'ownership-overlap')
        for (const record of group) addReason(record, 'ownership-overlap')
      }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
}

function markLeaseOverlaps(records) {
  const owners = new Map()
  for (const record of records) {
    if (!record.leaseId) continue
    const group = owners.get(record.leaseId) || []
    group.push(record)
    owners.set(record.leaseId, group)
  }
  for (const group of owners.values()) {
    if (group.length > 1) for (const record of group) addReason(record, 'lease-overlap')
  }
}

function discoverRuntimeNamespaceBases(workspaceRoot, limit) {
  const runtimeRoot = path.join(workspaceRoot, '.devcodex')
  const bases = new Set()
  const errors = []
  const pending = [{ root: runtimeRoot, depth: 0 }]
  let visited = 0
  let truncated = false
  while (pending.length && visited < limit) {
    const current = pending.pop()
    const listing = readChildDirectoriesBounded(current.root, Math.max(0, limit - visited))
    visited += listing.visited
    truncated = truncated || listing.truncated
    if (listing.unreadable) errors.push(current.root)
    const namespaceRoot = current.depth > 0 && listing.entries.some(entry => (
      entry.isDirectory() && (
        entry.name.toLocaleLowerCase('en-US') === 'profile' ||
        isLegacyWorkspaceTempDirectoryName(entry.name)
      )
    ))
    if (namespaceRoot) {
      bases.add(current.root)
      continue
    }
    for (const entry of listing.entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name.toLocaleLowerCase('en-US')
      if (NAMESPACE_SCAN_SKIP.has(name)) continue
      if (current.depth === 0 && isExternalDriveSpoolDirectoryName(name)) continue
      if (current.depth < 8) pending.push({ root: path.join(current.root, entry.name), depth: current.depth + 1 })
    }
  }
  if (pending.length) truncated = true
  return { bases: [...bases], errors, visited, truncated }
}

function discoverTempNamedDirectories(root, limit, maxDepth = 1) {
  const roots = new Set()
  const errors = []
  const pending = [{ root, depth: 0 }]
  let visited = 0
  let truncated = false
  while (pending.length && visited < limit) {
    const current = pending.pop()
    const listing = readChildDirectoriesBounded(current.root, Math.max(0, limit - visited))
    visited += listing.visited
    truncated = truncated || listing.truncated
    if (listing.unreadable) errors.push(current.root)
    for (const entry of listing.entries) {
      if (!(entry.isDirectory() || entry.isSymbolicLink())) continue
      const candidate = path.join(current.root, entry.name)
      if (isLegacyWorkspaceTempDirectoryName(entry.name)) {
        roots.add(candidate)
      } else if (entry.isDirectory()) {
        if (current.depth < maxDepth) pending.push({ root: candidate, depth: current.depth + 1 })
      }
    }
  }
  if (pending.length) truncated = true
  return { roots: [...roots], errors, visited, truncated }
}

function summarizeLegacyRoots(cwd, canonicalRoot, limit = MAX_ENTRIES) {
  const layout = findLayoutInfo(cwd)
  const workspaceRoot = layout.enabled
    ? layout.workspaceRoot
    : path.dirname(path.dirname(path.resolve(canonicalRoot)))
  const namespaceBases = new Set(layout.enabled
    ? [
        path.join(workspaceRoot, '.devcodex'),
        resolveActiveRuntimeRoot(cwd),
        path.join(workspaceRoot, '.devcodex', 'workspace')
      ]
    : [path.join(workspaceRoot, '.devcodex')])
  const errors = []
  let visited = 0
  let truncated = false
  if (layout.enabled) {
    const namespaceDiscovery = discoverRuntimeNamespaceBases(workspaceRoot, limit)
    for (const base of namespaceDiscovery.bases) namespaceBases.add(base)
    errors.push(...namespaceDiscovery.errors)
    visited += namespaceDiscovery.visited
    truncated = namespaceDiscovery.truncated
    const physical = readChildDirectoriesBounded(workspaceRoot, Math.max(0, limit - visited))
    visited += physical.visited
    truncated = truncated || physical.truncated
    if (physical.unreadable) errors.push(workspaceRoot)
    for (const entry of physical.entries) {
      const name = entry.name.toLocaleLowerCase('en-US')
      if (
        entry.isDirectory() &&
        name !== '.devcodex' &&
        !name.startsWith('.') &&
        !isLegacyWorkspaceTempDirectoryName(name)
      ) {
        namespaceBases.add(path.join(workspaceRoot, entry.name, '.devcodex'))
      }
    }
  }
  const externalRoots = []
  const roots = new Set()
  for (const base of namespaceBases) {
    const listing = readChildDirectoriesBounded(base, Math.max(0, limit - visited))
    visited += listing.visited
    truncated = truncated || listing.truncated
    if (listing.unreadable) errors.push(base)
    for (const entry of listing.entries) {
      if (!(entry.isDirectory() || entry.isSymbolicLink()) || !isLegacyWorkspaceTempDirectoryName(entry.name)) continue
      const candidate = path.join(base, entry.name)
      if (path.resolve(candidate) !== path.resolve(canonicalRoot)) roots.add(candidate)
    }
    for (const entry of listing.entries) {
      if (!entry.isDirectory() || !TASK_CONTENT_ROOTS.has(entry.name.toLocaleLowerCase('en-US'))) continue
      const discovered = discoverTempNamedDirectories(path.join(base, entry.name), Math.max(0, limit - visited))
      visited += discovered.visited
      truncated = truncated || discovered.truncated
      errors.push(...discovered.errors)
      for (const candidate of discovered.roots) roots.add(candidate)
    }
  }
  const summaries = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    const inspected = inspectTarget(root, Math.max(0, limit - visited))
    visited += inspected.entries
    truncated = truncated || inspected.truncated
    summaries.push({ root, reason: 'legacy-project-temp-root', ...inspected })
    if (visited >= limit) truncated = true
  }
  return { roots: summaries, externalRoots, errors, visited, truncated }
}

function inspectLegacyWorkspaceTempRoots(cwd, maxEntries = MAX_ENTRIES) {
  const limit = Number.isInteger(maxEntries) ? Math.max(1, Math.min(MAX_ENTRIES, maxEntries)) : MAX_ENTRIES
  return summarizeLegacyRoots(cwd, resolveWorkspaceTempRoot(cwd), limit)
}

function inspectWorkspaceTemp(cwd, nowMs = Date.now(), options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries)
    ? Math.max(1, Math.min(MAX_ENTRIES, options.maxEntries))
    : MAX_ENTRIES
  const canonicalRoot = resolveWorkspaceTempRoot(cwd)
  const manifestRoot = path.join(canonicalRoot, 'manifests')
  const manifestListing = readDirectoryEntriesBounded(manifestRoot, maxEntries)
  const manifestEntries = manifestListing.entries
  let truncated = manifestListing.truncated
  let observationCount = manifestEntries.length
  const manifestJsonEntries = manifestEntries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
  const records = []
  for (const entry of manifestJsonEntries) {
    const record = inspectManifest(
      canonicalRoot,
      path.join(manifestRoot, entry.name),
      nowMs,
      Math.max(0, maxEntries - observationCount)
    )
    observationCount += record.target?.entries || 0
    truncated = truncated || Boolean(record.target?.truncated)
    records.push(record)
  }
  markOwnershipOverlaps(records)
  markLeaseOverlaps(records)
  for (const record of records) record.eligible = record.reasons.length === 0
  const candidates = records.filter(record => record.eligible)
  const blocked = records.filter(record => !record.eligible)
  for (const entry of manifestEntries) {
    if (entry.isFile() && entry.name.endsWith('.json')) continue
    blocked.push({
      targetPath: path.join(manifestRoot, entry.name),
      eligible: false,
      reasons: ['invalid-manifest-entry'],
      partition: 'manifests'
    })
  }
  const leaseRoot = path.join(canonicalRoot, 'leases')
  const referencedLeases = new Set(records.map(record => record.leaseId).filter(Boolean))
  const leaseListing = readDirectoryEntriesBounded(leaseRoot, Math.max(0, maxEntries - observationCount))
  observationCount += leaseListing.entries.length
  truncated = truncated || leaseListing.truncated
  if (leaseListing.entries.length) {
    const leaseEntries = leaseListing.entries
    for (const entry of leaseEntries) {
      const leaseId = entry.isFile() && entry.name.endsWith('.json') ? entry.name.slice(0, -5) : null
      if (leaseId && referencedLeases.has(leaseId)) continue
      blocked.push({
        targetPath: path.join(leaseRoot, entry.name),
        eligible: false,
        reasons: [leaseId ? 'unknown-lease-owner' : 'invalid-lease-entry'],
        partition: 'leases'
      })
    }
  }
  const ownedTargets = records
    .filter(hasOwnershipAuthority)
    .map(record => record.targetPath)
  const ownedTargetKeys = new Set(ownedTargets.map(pathComparisonKey))

  function isOwnedEntry(entry) {
    let current = path.resolve(entry)
    while (isContained(canonicalRoot, current)) {
      if (ownedTargetKeys.has(pathComparisonKey(current))) return true
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return false
  }

  for (const partition of ARTIFACT_PARTITIONS) {
    const scanBudget = Math.max(0, maxEntries - observationCount)
    if (scanBudget === 0) {
      if (fs.existsSync(path.join(canonicalRoot, partition))) truncated = true
      continue
    }
    const observed = collectLeafEntries(path.join(canonicalRoot, partition), scanBudget)
    observationCount += observed.visited
    truncated = truncated || observed.truncated
    for (const entry of observed.entries) {
      if (!isOwnedEntry(entry)) {
        blocked.push({ targetPath: entry, eligible: false, reasons: ['unknown-owner'], partition })
      }
    }
  }

  const rootListing = readDirectoryEntriesBounded(canonicalRoot, Math.max(0, maxEntries - observationCount))
  observationCount += rootListing.entries.length
  truncated = truncated || rootListing.truncated
  if (rootListing.entries.length) {
    for (const entry of rootListing.entries) {
      if (!PARTITIONS.includes(entry.name)) {
        blocked.push({ targetPath: path.join(canonicalRoot, entry.name), eligible: false, reasons: ['unknown-partition'] })
      }
    }
  }
  const legacySummary = summarizeLegacyRoots(cwd, canonicalRoot, Math.max(0, maxEntries - observationCount))
  const legacyRoots = legacySummary.roots
  const externalRoots = legacySummary.externalRoots
  observationCount += legacySummary.visited
  truncated = truncated || legacySummary.truncated
  for (const legacy of legacyRoots) {
    blocked.push({ targetPath: legacy.root, eligible: false, reasons: [legacy.reason] })
  }
  for (const external of externalRoots) {
    blocked.push({ targetPath: external.root, eligible: false, reasons: [external.reason] })
  }
  for (const unreadable of legacySummary.errors) {
    blocked.push({ targetPath: unreadable, eligible: false, reasons: ['legacy-inspection-unreadable'] })
  }

  return {
    schemaVersion: STATUS_SCHEMA,
    cwd: path.resolve(cwd),
    canonicalRoot,
    project: resolveWorkspaceTempProject(cwd),
    exists: fs.existsSync(canonicalRoot),
    partitions: PARTITIONS.map(name => ({ name, path: path.join(canonicalRoot, name), exists: fs.existsSync(path.join(canonicalRoot, name)) })),
    manifests: records,
    candidates,
    blocked,
    legacyRoots,
    externalRoots,
    totals: {
      manifests: records.length,
      candidates: candidates.length,
      blocked: blocked.length,
      files: records.reduce((total, record) => total + (record.target?.files || 0), 0),
      bytes: records.reduce((total, record) => total + (record.target?.bytes || 0), 0),
      observedEntries: observationCount,
      maxEntries,
      truncated
    }
  }
}

function applyWorkspaceTempCandidate(canonicalRoot, candidate, nowMs) {
  const partial = { targetRemoved: false, leaseRemoved: false, manifestRemoved: false }
  try {
    if (!isContained(canonicalRoot, candidate.targetPath)) {
      throw tempContractError('WORKSPACE_TEMP_PATH_ESCAPE', 'path escaped canonical root')
    }
    if (!fs.existsSync(candidate.manifestPath) || manifestDigest(candidate.manifestPath) !== candidate.manifestDigest) {
      throw tempContractError('WORKSPACE_TEMP_MANIFEST_CHANGED', 'manifest changed after inspection')
    }
    const refreshLimit = Math.max(1, Math.min(MAX_ENTRIES, (candidate.target?.entries || 0) + 1))
    const refreshed = inspectManifest(canonicalRoot, candidate.manifestPath, nowMs, refreshLimit)
    if (!refreshed.eligible || refreshed.manifestDigest !== candidate.manifestDigest ||
        pathComparisonKey(refreshed.targetPath) !== pathComparisonKey(candidate.targetPath) ||
        refreshed.artifactId !== candidate.artifactId || refreshed.type !== candidate.type) {
      throw tempContractError('WORKSPACE_TEMP_TARGET_CHANGED', 'retention, lease or target safety state changed after inspection')
    }
    const finalBoundary = inspectPathBoundary(canonicalRoot, refreshed.targetPath)
    const currentTarget = inspectTarget(refreshed.targetPath, refreshLimit)
    if (!finalBoundary.safe || currentTarget.reparse || currentTarget.unreadable || currentTarget.truncated) {
      throw tempContractError('WORKSPACE_TEMP_TARGET_CHANGED', 'target safety state changed after inspection')
    }
    let expiredLease = null
    if (candidate.leaseId) {
      const currentLease = readLease(canonicalRoot, candidate.leaseId, nowMs)
      if (currentLease.status === 'active' || currentLease.status === 'invalid') {
        throw tempContractError('WORKSPACE_TEMP_LEASE_CHANGED', 'lease state changed after inspection')
      }
      if (currentLease.status === 'expired') {
        if (currentLease.digest !== refreshed.lease.digest) {
          throw tempContractError('WORKSPACE_TEMP_LEASE_CHANGED', 'lease changed after inspection')
        }
        expiredLease = currentLease
      }
    }
    if (manifestDigest(candidate.manifestPath) !== candidate.manifestDigest) {
      throw tempContractError('WORKSPACE_TEMP_MANIFEST_CHANGED', 'manifest changed before deletion')
    }
    const targetRemoval = removeIdentityBoundTarget(
      canonicalRoot,
      refreshed.targetPath,
      refreshed.targetIdentity,
      refreshed.artifactId
    )
    partial.targetRemoved = targetRemoval.removed
    if (expiredLease && fs.existsSync(expiredLease.path)) {
      const finalLease = readLease(canonicalRoot, candidate.leaseId, nowMs)
      if (finalLease.status !== 'expired' || finalLease.digest !== expiredLease.digest) {
        throw tempContractError('WORKSPACE_TEMP_LEASE_CHANGED', 'lease changed before deletion')
      }
      fs.rmSync(expiredLease.path, { force: true })
      partial.leaseRemoved = true
    }
    fs.rmSync(candidate.manifestPath, { force: true })
    partial.manifestRemoved = true
    removeEmptyParents(path.dirname(refreshed.targetPath), path.join(canonicalRoot, TYPE_PARTITION[candidate.type]))
    return {
      artifactId: candidate.artifactId,
      targetPath: refreshed.targetPath,
      manifestPath: candidate.manifestPath,
      leasePath: expiredLease?.path || null,
      partial
    }
  } catch (error) {
    error.partial = partial
    throw error
  }
}

function pruneWorkspaceTemp(cwd, { apply = false, nowMs = Date.now(), maxEntries = MAX_ENTRIES } = {}) {
  const status = inspectWorkspaceTemp(cwd, nowMs, { maxEntries })
  const removed = []
  const failed = []
  if (apply && status.totals.truncated) {
    failed.push({
      artifactId: null,
      targetPath: status.canonicalRoot,
      errorCode: 'WORKSPACE_TEMP_INSPECTION_TRUNCATED',
      message: 'bounded inspection was incomplete; no artifacts were removed'
    })
  } else if (apply) {
    for (const candidate of status.candidates) {
      try {
        removed.push(applyWorkspaceTempCandidate(status.canonicalRoot, candidate, nowMs))
      } catch (error) {
        failed.push({
          artifactId: candidate.artifactId,
          targetPath: candidate.targetPath,
          errorCode: error.code || 'WORKSPACE_TEMP_PRUNE_FAILED',
          message: error.message,
          partial: error.partial || { targetRemoved: false, leaseRemoved: false, manifestRemoved: false }
        })
      }
    }
  }
  return {
    schemaVersion: PRUNE_SCHEMA,
    mode: apply ? 'apply' : 'dry-run',
    canonicalRoot: status.canonicalRoot,
    candidates: status.candidates,
    removed,
    failed,
    blocked: status.blocked,
    inspection: {
      schemaVersion: status.schemaVersion,
      manifests: status.totals.manifests,
      candidates: status.totals.candidates,
      blocked: status.totals.blocked,
      observedEntries: status.totals.observedEntries,
      maxEntries: status.totals.maxEntries,
      truncated: status.totals.truncated
    }
  }
}

function removeEmptyParents(start, stop) {
  let current = path.resolve(start)
  const boundary = path.resolve(stop)
  while (current !== boundary && isContained(boundary, current)) {
    try {
      if (fs.readdirSync(current).length > 0) break
      fs.rmdirSync(current)
    } catch {
      break
    }
    current = path.dirname(current)
  }
}

module.exports = {
  ARTIFACT_PARTITIONS,
  DEFAULT_TTL_MS,
  LEASE_SCHEMA,
  LEGACY_MANIFEST_SCHEMA,
  LIFECYCLE_RECEIPT_SCHEMA,
  MANIFEST_SCHEMA,
  MAX_CONTROL_FILE_BYTES,
  MAX_ENTRIES,
  PARTITIONS,
  PRUNE_SCHEMA,
  STATUS_SCHEMA,
  acquireWorkspaceTempLease,
  applyWorkspaceTempCandidate,
  createWorkspaceTempArtifact,
  createWorkspaceTempArtifactAtRoot,
  ensureWorkspaceTempPartitions,
  enforceWorkspaceTempTargetPermission,
  findWorkspaceTempRootForPath,
  inspectWorkspaceTemp,
  inspectLegacyWorkspaceTempRoots,
  inspectManifest,
  inspectTarget,
  isLegacyWorkspaceTempDirectoryName,
  isContained,
  normalizeTempProject,
  pathComparisonKey,
  prepareWorkspaceTempBackupRoot,
  pruneWorkspaceTemp,
  releaseWorkspaceTempLease,
  registerWorkspaceTempArtifactAtRoot,
  registerWorkspaceTempBackup,
  renewWorkspaceTempLease,
  inspectPathBoundary,
  captureTargetIdentity,
  collectLeafEntries,
  targetIdentityMatches,
  validTargetIdentity,
  validateV2ManifestIdentity,
  v2ManifestPath,
  withWorkspaceTempArtifact,
  withWorkspaceTempArtifactAtRoot,
  withWorkspaceTempBackup,
  workspaceTempLeaseTokenMatches
}
