'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  findLayoutInfo,
  resolveActiveRuntimeRoot
} = require('../../hooks/_runtime/workspace-layout.cjs')
const {
  resolveWorkspaceTempBackupRoot,
  resolveWorkspaceTempProject,
  resolveWorkspaceTempRoot
} = require('./workspace-temp-layout.js')

const MANIFEST_SCHEMA = 'WorkspaceTempManifestV1'
const STATUS_SCHEMA = 'WorkspaceTempStatusV1'
const PRUNE_SCHEMA = 'WorkspaceTempPruneV1'
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
  'unknown-owner', 'incomplete-owner-scope', 'partition-mismatch', 'partition-root-reserved'
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
  fs.mkdirSync(root, { recursive: true })
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error(`WORKSPACE_TEMP_ROOT_REPARSE: ${root}`)
  }
  for (const partition of PARTITIONS) {
    const partitionPath = path.join(root, partition)
    if (fs.existsSync(partitionPath) && fs.lstatSync(partitionPath).isSymbolicLink()) {
      throw new Error(`WORKSPACE_TEMP_PARTITION_REPARSE: ${partitionPath}`)
    }
    fs.mkdirSync(partitionPath, { recursive: true })
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
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  const content = JSON.stringify(value, null, 2) + '\n'
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTROL_FILE_BYTES) {
    throw new Error(`WORKSPACE_TEMP_CONTROL_FILE_TOO_LARGE: ${file}`)
  }
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' })
    try {
      fs.linkSync(temporary, file)
    } catch (error) {
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error
      fs.copyFileSync(temporary, file, fs.constants.COPYFILE_EXCL)
    }
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
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
      return ARTIFACT_PARTITIONS.includes(partition) ? current : null
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function registerWorkspaceTempArtifactAtRoot(tempRoot, input = {}) {
  const root = ensureWorkspaceTempPartitions(tempRoot)
  const targetPath = path.resolve(input.targetPath || '')
  const type = String(input.type || '').trim()
  const expectedPartition = TYPE_PARTITION[type]
  if (!expectedPartition) throw new Error(`WORKSPACE_TEMP_TYPE_UNSUPPORTED: ${type || '(empty)'}`)
  if (!isContained(root, targetPath)) throw new Error(`WORKSPACE_TEMP_PATH_ESCAPE: ${targetPath}`)
  if (!fs.existsSync(targetPath)) throw new Error(`WORKSPACE_TEMP_TARGET_MISSING: ${targetPath}`)
  const boundary = inspectPathBoundary(root, targetPath)
  if (!boundary.safe) throw new Error(`WORKSPACE_TEMP_PATH_UNSAFE: ${boundary.reason}: ${targetPath}`)
  const relative = path.relative(root, targetPath).split(path.sep).filter(Boolean)
  if (relative[0] !== expectedPartition) {
    throw new Error(`WORKSPACE_TEMP_PARTITION_MISMATCH: ${type} must live under ${expectedPartition}`)
  }
  if (relative.length < 2) {
    throw new Error(`WORKSPACE_TEMP_PARTITION_ROOT_RESERVED: ${targetPath}`)
  }

  const createdAtMs = input.createdAt ? Date.parse(input.createdAt) : Date.now()
  if (!Number.isFinite(createdAtMs)) throw new Error('WORKSPACE_TEMP_CREATED_AT_INVALID')
  const expiresAtMs = input.expiresAt
    ? Date.parse(input.expiresAt)
    : createdAtMs + (Number.isFinite(input.ttlMs) ? input.ttlMs : DEFAULT_TTL_MS[type])
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < createdAtMs) {
    throw new Error('WORKSPACE_TEMP_EXPIRES_AT_INVALID')
  }
  const owner = String(input.owner || '').trim()
  const producer = String(input.producer || owner).trim()
  const project = String(input.project || 'workspace').trim()
  if (!owner || !producer || !project) throw new Error('WORKSPACE_TEMP_OWNER_REQUIRED')
  const generatedId = crypto.createHash('sha256')
    .update(`${portable(targetPath)}\0${createdAtMs}\0${process.pid}\0${crypto.randomBytes(8).toString('hex')}`)
    .digest('hex').slice(0, 24)
  const artifactId = String(input.artifactId || `${type}-${generatedId}`).trim()
  if (!safeIdentifier(artifactId)) throw new Error(`WORKSPACE_TEMP_ARTIFACT_ID_INVALID: ${artifactId}`)
  const leaseId = input.leaseId == null ? null : String(input.leaseId).trim()
  if (leaseId !== null && !safeIdentifier(leaseId)) throw new Error(`WORKSPACE_TEMP_LEASE_ID_INVALID: ${leaseId}`)

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    artifactId,
    type,
    owner,
    project,
    producer,
    targetPath,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    cleanupPolicy: input.cleanupPolicy || 'delete',
    transactionStatus: input.transactionStatus || (type === 'backup' ? 'completed' : 'not-applicable'),
    leaseId
  }
  const manifestPath = path.join(root, 'manifests', `${artifactId}.json`)
  if (fs.existsSync(manifestPath)) {
    throw new Error(`WORKSPACE_TEMP_ARTIFACT_ID_CONFLICT: ${artifactId}`)
  }
  atomicWriteJson(manifestPath, manifest)
  return { manifestPath, manifest }
}

function registerWorkspaceTempBackup(targetPath, options = {}) {
  const tempRoot = options.tempRoot || findWorkspaceTempRootForPath(targetPath)
  if (!tempRoot) return null
  const parentParts = path.relative(tempRoot, path.dirname(path.resolve(targetPath))).split(path.sep).filter(Boolean)
  const inferredProject = parentParts[0] === 'backups' && parentParts.length > 1
    ? parentParts.slice(1).join('/')
    : 'workspace'
  return registerWorkspaceTempArtifactAtRoot(tempRoot, {
    ...options,
    targetPath,
    type: 'backup',
    owner: options.owner || 'devcodex-cli',
    project: options.project || inferredProject,
    producer: options.producer || 'managed-backup',
    transactionStatus: options.transactionStatus || 'completed'
  })
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
  let lock = false
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
    if (path.basename(current).endsWith('.lock')) lock = true
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
  return { exists: true, files, bytes, entries: visited, truncated: truncated || pending.length > 0, reparse, lock, unreadable }
}

function readLease(root, leaseId, nowMs) {
  if (!leaseId) return { status: 'none', path: null }
  const leasePath = path.join(root, 'leases', `${leaseId}.json`)
  if (!fs.existsSync(leasePath)) return { status: 'missing', path: leasePath }
  try {
    const stats = fs.lstatSync(leasePath)
    if (stats.isSymbolicLink() || !stats.isFile()) return { status: 'invalid', path: leasePath, reason: 'lease-not-regular-file' }
    if (stats.size > MAX_CONTROL_FILE_BYTES) return { status: 'invalid', path: leasePath, reason: 'lease-too-large' }
    const raw = fs.readFileSync(leasePath)
    const value = JSON.parse(raw.toString('utf8'))
    if (value?.schemaVersion !== 'WorkspaceTempLeaseV1') return { status: 'invalid', path: leasePath, reason: 'unknown-lease-schema' }
    const expiresAtMs = Date.parse(value?.expiresAt)
    if (!Number.isFinite(expiresAtMs)) return { status: 'invalid', path: leasePath }
    return {
      status: expiresAtMs > nowMs ? 'active' : 'expired',
      path: leasePath,
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
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA) reasons.push('unknown-manifest-schema')
  if (!safeIdentifier(manifest?.artifactId) || path.basename(manifestPath) !== `${manifest.artifactId}.json`) reasons.push('invalid-artifact-id')
  const type = String(manifest?.type || '')
  if (!TYPE_PARTITION[type]) reasons.push('unknown-artifact-type')
  if (!String(manifest?.owner || '').trim()) reasons.push('unknown-owner')
  if (!String(manifest?.project || '').trim() || !String(manifest?.producer || '').trim()) reasons.push('incomplete-owner-scope')
  if (manifest?.cleanupPolicy !== 'delete') reasons.push('cleanup-policy-not-delete')

  const targetPath = path.resolve(String(manifest?.targetPath || root))
  const targetContained = Boolean(manifest?.targetPath) && path.isAbsolute(String(manifest.targetPath)) && isContained(root, targetPath)
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
  const createdAtMs = Date.parse(manifest?.createdAt)
  const expiresAtMs = Date.parse(manifest?.expiresAt)
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs < createdAtMs) reasons.push('invalid-retention-window')
  if (type === 'backup' && manifest?.transactionStatus !== 'completed') reasons.push('backup-transaction-incomplete')
  if (manifest?.leaseId != null && !safeIdentifier(manifest.leaseId)) reasons.push('invalid-lease-id')
  const lease = readLease(root, safeIdentifier(manifest?.leaseId) ? manifest.leaseId : null, nowMs)
  if (lease.status === 'active') reasons.push('active-lease')
  if (lease.status === 'invalid') reasons.push('invalid-lease')

  const target = targetContained && boundary.safe
    ? inspectTarget(targetPath, maxTargetEntries)
    : { exists: false, files: 0, bytes: 0, entries: 0, truncated: false, reparse: false, lock: false, unreadable: false }
  if (target.reparse) reasons.push('reparse-point')
  if (target.lock) reasons.push('lock-present')
  if (target.unreadable) reasons.push('target-unreadable')
  if (target.truncated) reasons.push('inspection-truncated')
  if (Number.isFinite(expiresAtMs) && expiresAtMs > nowMs) reasons.push('ttl-not-expired')
  return {
    manifestPath,
    manifestDigest: crypto.createHash('sha256').update(raw).digest('hex'),
    artifactId: manifest?.artifactId || null,
    type: manifest?.type || null,
    owner: manifest?.owner || null,
    project: manifest?.project || null,
    producer: manifest?.producer || null,
    leaseId: safeIdentifier(manifest?.leaseId) ? manifest.leaseId : null,
    targetPath,
    expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null,
    target,
    lease,
    eligible: reasons.length === 0,
    reasons
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
      let targetRemoved = false
      let leaseRemoved = false
      let manifestRemoved = false
      try {
        if (!isContained(status.canonicalRoot, candidate.targetPath)) throw Object.assign(new Error('path escaped canonical root'), { code: 'WORKSPACE_TEMP_PATH_ESCAPE' })
        if (!fs.existsSync(candidate.manifestPath) || manifestDigest(candidate.manifestPath) !== candidate.manifestDigest) {
          throw Object.assign(new Error('manifest changed after inspection'), { code: 'WORKSPACE_TEMP_MANIFEST_CHANGED' })
        }
        const refreshLimit = Math.max(1, Math.min(MAX_ENTRIES, (candidate.target?.entries || 0) + 1))
        const refreshed = inspectManifest(status.canonicalRoot, candidate.manifestPath, nowMs, refreshLimit)
        if (
          !refreshed.eligible ||
          refreshed.manifestDigest !== candidate.manifestDigest ||
          pathComparisonKey(refreshed.targetPath) !== pathComparisonKey(candidate.targetPath) ||
          refreshed.artifactId !== candidate.artifactId ||
          refreshed.type !== candidate.type
        ) {
          throw Object.assign(new Error('retention, lease or target safety state changed after inspection'), { code: 'WORKSPACE_TEMP_TARGET_CHANGED' })
        }
        const finalBoundary = inspectPathBoundary(status.canonicalRoot, refreshed.targetPath)
        const currentTarget = inspectTarget(refreshed.targetPath, refreshLimit)
        if (!finalBoundary.safe || currentTarget.reparse || currentTarget.lock || currentTarget.unreadable || currentTarget.truncated) {
          throw Object.assign(new Error('target safety state changed after inspection'), { code: 'WORKSPACE_TEMP_TARGET_CHANGED' })
        }
        let expiredLease = null
        if (candidate.leaseId) {
          const currentLease = readLease(status.canonicalRoot, candidate.leaseId, nowMs)
          if (currentLease.status === 'active' || currentLease.status === 'invalid') {
            throw Object.assign(new Error('lease state changed after inspection'), { code: 'WORKSPACE_TEMP_LEASE_CHANGED' })
          }
          if (currentLease.status === 'expired') {
            if (currentLease.digest !== refreshed.lease.digest) {
              throw Object.assign(new Error('lease changed after inspection'), { code: 'WORKSPACE_TEMP_LEASE_CHANGED' })
            }
            expiredLease = currentLease
          }
        }
        if (manifestDigest(candidate.manifestPath) !== candidate.manifestDigest) {
          throw Object.assign(new Error('manifest changed before deletion'), { code: 'WORKSPACE_TEMP_MANIFEST_CHANGED' })
        }
        if (fs.existsSync(refreshed.targetPath)) {
          fs.rmSync(refreshed.targetPath, { recursive: true, force: true })
          targetRemoved = true
        }
        if (expiredLease && fs.existsSync(expiredLease.path)) {
          const finalLease = readLease(status.canonicalRoot, candidate.leaseId, nowMs)
          if (finalLease.status !== 'expired' || finalLease.digest !== expiredLease.digest) {
            throw Object.assign(new Error('lease changed before deletion'), { code: 'WORKSPACE_TEMP_LEASE_CHANGED' })
          }
          fs.rmSync(expiredLease.path, { force: true })
          leaseRemoved = true
        }
        fs.rmSync(candidate.manifestPath, { force: true })
        manifestRemoved = true
        removeEmptyParents(path.dirname(refreshed.targetPath), path.join(status.canonicalRoot, TYPE_PARTITION[candidate.type]))
        removed.push({
          artifactId: candidate.artifactId,
          targetPath: refreshed.targetPath,
          manifestPath: candidate.manifestPath,
          leasePath: expiredLease?.path || null
        })
      } catch (error) {
        failed.push({
          artifactId: candidate.artifactId,
          targetPath: candidate.targetPath,
          errorCode: error.code || 'WORKSPACE_TEMP_PRUNE_FAILED',
          message: error.message,
          partial: { targetRemoved, leaseRemoved, manifestRemoved }
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
  MANIFEST_SCHEMA,
  MAX_CONTROL_FILE_BYTES,
  MAX_ENTRIES,
  PARTITIONS,
  PRUNE_SCHEMA,
  STATUS_SCHEMA,
  ensureWorkspaceTempPartitions,
  findWorkspaceTempRootForPath,
  inspectWorkspaceTemp,
  inspectLegacyWorkspaceTempRoots,
  isLegacyWorkspaceTempDirectoryName,
  isContained,
  prepareWorkspaceTempBackupRoot,
  pruneWorkspaceTemp,
  registerWorkspaceTempArtifactAtRoot,
  registerWorkspaceTempBackup,
  inspectPathBoundary
}
