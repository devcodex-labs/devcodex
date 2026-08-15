'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  GLOBAL_HOST_IDS,
  resolveGlobalHostTargets,
  samePath,
  targetAcceptsPath,
  targetSafetyRoots,
  isUnder,
  isUnderPhysical
} = require('./global-host-target.js')
const {
  GLOBAL_HOST_RECEIPT_SCHEMA,
  buildGlobalHostConfigPlan,
  buildVscodeMcpServers,
  portable
} = require('./global-host-config.js')
const {
  parseJsonObject,
  removeHostJsonContent,
  removeManagedBlock,
  tomlManagedFileMatches
} = require('./global-host-config-merge.js')
const {
  executeGlobalHostTransaction,
  operationDigest
} = require('./global-host-config-transaction.js')
const {
  removeGrokPluginRegistration,
  syncGrokWorkspacePluginInstallation,
  uninstallGrokPluginInstallation
} = require('./host-adapter-scope.js')
const { buildGrokCliEnv } = require('./grok-cli-env.js')
const {
  ACTIVATION_RECEIPT_SCHEMA,
  resolveActivationReceiptFile
} = require('./devcodex-readiness.js')

const GLOBAL_HOST_REMOVAL_PLAN_SCHEMA = 'GlobalHostRemovalPlanV1'
const GLOBAL_HOST_REMOVAL_RECEIPT_SCHEMA = 'GlobalHostRemovalReceiptV1'
const MANAGED_SIGNATURE = /BEGIN DEVCODEX MANAGED|# DevCodex global host adapter|devcodex-(?:memory|profile)|lifecycle-(?:host-adapters|cursor-compatible)\.cjs|devcodex-workspace/i
const MAX_REMOVAL_RECEIPT_BYTES = 16 * 1024 * 1024
const MAX_REMOVAL_RECEIPT_PATHS = 20000
const MAX_MANAGED_ROOT_SCAN_ENTRIES = 50000
const MAX_ACTIVATION_RECEIPT_BYTES = 4 * 1024 * 1024

function digestText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function readText(file, fsImpl = fs) {
  return fsImpl.existsSync(file) ? fsImpl.readFileSync(file, 'utf8') : ''
}

function pathKey(file) {
  const resolved = path.resolve(file)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function samePathValue(left, right) {
  return Boolean(left && right && samePath(left, right))
}

function structuredOwnership(target, file) {
  if (samePathValue(file, target.files?.instructions)) {
    return { ownershipKind: 'markdown-block', blockId: `global-${target.host}` }
  }
  if (target.host === 'codex' && samePathValue(file, target.files?.config)) {
    return { ownershipKind: 'codex-toml-block', blockId: 'global-codex-mcp' }
  }
  if (target.host === 'grok' && samePathValue(file, target.files?.config)) {
    return { ownershipKind: 'grok-plugin-registration', pluginName: 'devcodex-workspace' }
  }
  const jsonFiles = [
    target.files?.hooks,
    target.files?.settings,
    target.files?.mcp,
    target.files?.vscodeMcp,
    ...(target.additionalFiles || [])
  ].filter(Boolean)
  if (jsonFiles.some(candidate => samePathValue(file, candidate))) {
    return { ownershipKind: 'json-managed' }
  }
  return { ownershipKind: 'whole-file' }
}

function receiptDigest(receipt, file) {
  for (const [candidate, digest] of Object.entries(receipt?.managedFileDigests || {})) {
    if (samePath(candidate, file)) return String(digest || '')
  }
  const artifact = [
    ...(receipt?.managedArtifacts || []),
    ...(receipt?.retainedManagedArtifacts || [])
  ].find(item => item?.path && samePath(item.path, file))
  return String(artifact?.managedDigest || artifact?.contentDigest || '')
}

function receiptArtifact(receipt, target, file) {
  const recorded = [
    ...(receipt?.managedArtifacts || []),
    ...(receipt?.retainedManagedArtifacts || [])
  ].find(item => item?.path && samePath(item.path, file))
  return {
    ...(recorded || {}),
    path: portable(file),
    ...structuredOwnership(target, file),
    managedDigest: String(recorded?.managedDigest || receiptDigest(receipt, file) || '')
  }
}

function receiptPaths(receipt) {
  return Array.from(new Set([
    ...(receipt?.managedPaths || receipt?.configFiles || []),
    ...(receipt?.pendingStaleManagedPaths || []),
    ...(receipt?.retainedManagedArtifacts || []).map(item => item?.path).filter(Boolean)
  ].map(portable)))
}

function knownConfigFiles(target) {
  return Array.from(new Set([
    ...Object.values(target.files || {}).filter(value => typeof value === 'string' && !/skills$/i.test(value)),
    ...(target.additionalFiles || [])
  ].map(file => path.resolve(file))))
}

function walkTreeEntries(root, fsImpl = fs) {
  if (!fsImpl.existsSync(root)) return { files: [], directories: [] }
  const files = []
  const directories = []
  const stack = [path.resolve(root)]
  let scanned = 0
  while (stack.length) {
    const current = stack.pop()
    scanned += 1
    if (scanned > MAX_MANAGED_ROOT_SCAN_ENTRIES) {
      const error = new Error(`GLOBAL_HOST_REMOVAL_SCAN_LIMIT: ${root}`)
      error.code = 'GLOBAL_HOST_REMOVAL_SCAN_LIMIT'
      throw error
    }
    const stat = fsImpl.lstatSync(current)
    if (stat.isSymbolicLink()) {
      files.push(current)
      continue
    }
    if (stat.isFile()) {
      files.push(current)
      continue
    }
    if (!samePath(current, root)) directories.push(current)
    for (const entry of fsImpl.readdirSync(current, { withFileTypes: true })) {
      stack.push(path.join(current, entry.name))
    }
  }
  return { files, directories }
}

function exclusiveManagedRoots(receipt, target, fsImpl = fs) {
  const roots = [
    receipt?.runtimeRoot,
    ...(receipt?.retainedRuntimeRoots || []),
    target.files?.plugin
  ].filter(Boolean)
  if (target.shared?.root && receiptPaths(receipt).some(file =>
    isUnderPhysical(path.join(target.shared.root, 'devcodex'), file, fsImpl)
  )) {
    roots.push(path.join(target.shared.root, 'devcodex'))
  }
  for (const file of receiptPaths(receipt)) {
    if (path.basename(file) === '.devcodex-managed.json') roots.push(path.dirname(file))
  }
  return Array.from(new Map(roots.map(root => [pathKey(root), path.resolve(root)])).values())
}

function unknownFilesInManagedRoots(receipt, target, fsImpl = fs, additionalOwnedPaths = []) {
  const paths = [...receiptPaths(receipt), ...additionalOwnedPaths].map(file => path.resolve(file))
  const owned = new Set(paths.map(pathKey))
  return exclusiveManagedRoots(receipt, target, fsImpl)
    .flatMap(root => {
      const resolvedRoot = path.resolve(root)
      const ownedDirectories = new Set([pathKey(resolvedRoot)])
      for (const file of paths) {
        if (!isUnderPhysical(resolvedRoot, file, fsImpl)) continue
        let cursor = path.dirname(file)
        while (isUnder(resolvedRoot, cursor)) {
          ownedDirectories.add(pathKey(cursor))
          if (samePath(cursor, resolvedRoot)) break
          cursor = path.dirname(cursor)
        }
      }
      const entries = walkTreeEntries(resolvedRoot, fsImpl)
      return [
        ...entries.files.filter(file => !owned.has(pathKey(file))),
        ...entries.directories.filter(directory => !ownedDirectories.has(pathKey(directory)))
      ]
    })
    .map(portable)
    .filter((file, index, all) => all.indexOf(file) === index)
    .sort()
}

function validActivationReceiptPath(file, fsImpl = fs) {
  if (!file || !fsImpl.existsSync(file)) return null
  try {
    const stat = fsImpl.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_ACTIVATION_RECEIPT_BYTES) {
      return null
    }
    const receipt = parseJsonObject(readText(file, fsImpl), 'DevCodex activation readiness receipt')
    if (receipt.schemaVersion !== ACTIVATION_RECEIPT_SCHEMA || receipt.packageName !== 'devcodex' ||
        receipt.lifecycle?.schemaVersion !== 'DevCodexNpmLifecycleAdapterReceiptV1' ||
        !['PASS', 'BLOCK'].includes(receipt.status) ||
        typeof receipt.completedAt !== 'string' || !Number.isFinite(Date.parse(receipt.completedAt))) {
      return null
    }
    return path.resolve(file)
  } catch {
    return null
  }
}

function extractManagedBlockText(content, kind, id) {
  const markers = kind === 'markdown'
    ? {
        begin: `<!-- BEGIN DEVCODEX MANAGED: ${id} -->`,
        end: `<!-- END DEVCODEX MANAGED: ${id} -->`
      }
    : {
        begin: `# BEGIN DEVCODEX MANAGED: ${id}`,
        end: `# END DEVCODEX MANAGED: ${id}`
      }
  const text = String(content || '')
  const begin = text.indexOf(markers.begin)
  const end = text.indexOf(markers.end, begin)
  if (begin < 0 && end < 0) return null
  if (begin < 0 || end < begin || text.indexOf(markers.begin, begin + markers.begin.length) !== -1 ||
      text.indexOf(markers.end, end + markers.end.length) !== -1) {
    const error = new Error(`GLOBAL_HOST_MARKER_CONFLICT: ${id}`)
    error.code = 'GLOBAL_HOST_MARKER_CONFLICT'
    throw error
  }
  return `${text.slice(begin, end + markers.end.length)}\n`
}

function unmanagedResidualEvidence(target, fsImpl = fs) {
  const evidence = []
  if (fsImpl.existsSync(target.runtimeBaseRoot)) evidence.push(portable(target.runtimeBaseRoot))
  if (target.files?.plugin && fsImpl.existsSync(target.files.plugin)) evidence.push(portable(target.files.plugin))
  if (target.host === 'codex' && target.shared?.root) {
    const sharedRuntime = path.join(target.shared.root, 'devcodex')
    if (fsImpl.existsSync(sharedRuntime)) evidence.push(portable(sharedRuntime))
  }
  for (const file of knownConfigFiles(target)) {
    if (!fsImpl.existsSync(file)) continue
    const stat = fsImpl.lstatSync(file)
    if (stat.isSymbolicLink()) {
      evidence.push(portable(file))
      continue
    }
    if (!stat.isFile()) continue
    if (MANAGED_SIGNATURE.test(readText(file, fsImpl))) evidence.push(portable(file))
  }
  const nativeSkillRoots = [
    target.host === 'copilot' ? target.files?.skills : null,
    target.host === 'claude' ? path.join(target.root, 'skills') : null,
    target.host === 'codex' ? target.shared?.skills : null
  ].filter(Boolean)
  for (const root of nativeSkillRoots) {
    if (!fsImpl.existsSync(root)) continue
    const stat = fsImpl.lstatSync(root)
    if (stat.isSymbolicLink()) {
      evidence.push(portable(root))
      continue
    }
    if (!stat.isDirectory()) continue
    for (const entry of fsImpl.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const marker = path.join(root, entry.name, '.devcodex-managed.json')
      if (fsImpl.existsSync(marker)) evidence.push(portable(path.dirname(marker)))
    }
  }
  return Array.from(new Set(evidence))
}

function validateReceipt(receipt, target, fsImpl = fs) {
  if (!receipt || receipt.schemaVersion !== GLOBAL_HOST_RECEIPT_SCHEMA || receipt.host !== target.host) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_RECEIPT_INVALID: ${target.host}`)
    error.code = 'GLOBAL_HOST_REMOVAL_RECEIPT_INVALID'
    throw error
  }
  if (!Array.isArray(receipt.managedPaths) || !receipt.managedFileDigests || receipt.result !== 'committed') {
    const error = new Error(`GLOBAL_HOST_REMOVAL_RECEIPT_INCOMPLETE: ${target.host}`)
    error.code = 'GLOBAL_HOST_REMOVAL_RECEIPT_INCOMPLETE'
    throw error
  }
  const runtimeRoots = [receipt.runtimeRoot, ...(receipt.retainedRuntimeRoots || [])].filter(Boolean)
  for (const root of runtimeRoots) {
    if (samePath(root, target.runtimeBaseRoot) || !isUnderPhysical(target.runtimeBaseRoot, root, fsImpl)) {
      const error = new Error(`GLOBAL_HOST_REMOVAL_RUNTIME_ROOT_INVALID: ${root}`)
      error.code = 'GLOBAL_HOST_REMOVAL_RUNTIME_ROOT_INVALID'
      throw error
    }
  }
  const paths = receiptPaths(receipt)
  if (paths.length > MAX_REMOVAL_RECEIPT_PATHS) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_RECEIPT_LIMIT: ${target.host} paths=${paths.length}`)
    error.code = 'GLOBAL_HOST_REMOVAL_RECEIPT_LIMIT'
    throw error
  }
  for (const [file, digest] of Object.entries(receipt.managedFileDigests || {})) {
    if (!paths.some(candidate => samePath(candidate, file)) || !/^[a-f0-9]{64}$/i.test(String(digest || ''))) {
      const error = new Error(`GLOBAL_HOST_REMOVAL_RECEIPT_DIGEST_INVALID: ${file}`)
      error.code = 'GLOBAL_HOST_REMOVAL_RECEIPT_DIGEST_INVALID'
      throw error
    }
  }
}

function historicalConfigFiles(target) {
  const result = knownConfigFiles(target)
  if (target.host === 'copilot' && target.files?.vscodeMcp) {
    const productRoot = path.dirname(path.dirname(target.files.vscodeMcp))
    const appDataRoot = path.dirname(productRoot)
    result.push(path.join(appDataRoot, 'Code - Insiders', 'User', 'mcp.json'))
  }
  return Array.from(new Map(result.map(file => [pathKey(file), path.resolve(file)])).values())
}

function nativeSkillRoots(target) {
  return Array.from(new Set([
    target.host === 'copilot' ? target.files?.skills : null,
    target.host === 'claude' ? path.join(target.root, 'skills') : null,
    target.shared?.skills
  ].filter(Boolean).map(root => path.resolve(root))))
}

function nativeSkillMarkerOwns(receipt, target, file, fsImpl = fs) {
  for (const root of nativeSkillRoots(target)) {
    if (!isUnderPhysical(root, file, fsImpl) || samePath(root, file)) continue
    const relative = path.relative(root, path.resolve(file))
    const [skillId, ...rest] = relative.split(path.sep)
    if (!skillId || !rest.length) continue
    const markerFile = path.join(root, skillId, '.devcodex-managed.json')
    if (!fsImpl.existsSync(markerFile) || fsImpl.lstatSync(markerFile).isSymbolicLink() ||
        !fsImpl.lstatSync(markerFile).isFile()) continue
    let marker
    try {
      marker = parseJsonObject(readText(markerFile, fsImpl), `${target.host} native skill marker`)
    } catch {
      continue
    }
    if (marker.schemaVersion !== 'DevCodexManagedSkillOwnershipV1' || marker.owner !== 'devcodex' ||
        marker.skillId !== skillId) continue
    if (samePath(file, markerFile)) return true
    const relativeFile = rest.join('/').replace(/\\/g, '/')
    const entry = (marker.files || []).find(item => item?.path === relativeFile)
    const digest = receiptDigest(receipt, file)
    if (entry && /^[a-f0-9]{64}$/i.test(digest) && entry.digest === digest) return true
  }
  return false
}

function validateReceiptManagedPath(receipt, target, file, expectedOperations, fsImpl = fs) {
  const resolved = path.resolve(file)
  if (!targetAcceptsPath(target, resolved, fsImpl)) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_PATH_OUTSIDE_ROOT: ${resolved}`)
    error.code = 'GLOBAL_HOST_REMOVAL_PATH_OUTSIDE_ROOT'
    throw error
  }
  if (expectedOperations.has(pathKey(resolved)) ||
      historicalConfigFiles(target).some(candidate => samePath(candidate, resolved))) return
  const dedicatedRoots = [
    receipt.runtimeRoot,
    ...(receipt.retainedRuntimeRoots || []),
    target.files?.plugin,
    target.shared?.root ? path.join(target.shared.root, 'devcodex') : null
  ].filter(Boolean)
  if (dedicatedRoots.some(root => isUnderPhysical(root, resolved, fsImpl))) return
  if (nativeSkillMarkerOwns(receipt, target, resolved, fsImpl)) return
  const error = new Error(`GLOBAL_HOST_REMOVAL_PATH_NOT_MANAGED: ${resolved}`)
  error.code = 'GLOBAL_HOST_REMOVAL_PATH_NOT_MANAGED'
  throw error
}

function expectedOperationMap(plan, host) {
  const hostPlan = plan.hostPlans.find(item => item.host === host)
  return new Map((hostPlan?.operations || []).map(operation => [pathKey(operation.path), operation]))
}

function managedJsonFor(target, file, expectedOperation) {
  if (target.host === 'copilot' && (
    samePathValue(file, target.files?.vscodeMcp) ||
    (target.additionalFiles || []).some(candidate => samePathValue(file, candidate))
  )) {
    return { servers: buildVscodeMcpServers(target.runtimeRoot, { host: 'copilot' }) }
  }
  if (!expectedOperation?.managedContent) {
    return { hooks: {}, mcpServers: {}, servers: {} }
  }
  return parseJsonObject(expectedOperation.managedContent, `${target.host} managed JSON`)
}

function writeOrRemoveOperation(host, file, desired, kind = 'text', currentBytes = null) {
  const expectedDigest = currentBytes == null ? null : operationDigest(currentBytes)
  if (desired === '') return { host, action: 'remove', path: file, kind, expectedDigest }
  return { host, action: 'write', path: file, kind, content: desired, expectedDigest }
}

function planArtifactOperation({ artifact, receipt, target, expectedOperation, fsImpl }) {
  const file = path.resolve(artifact.path)
  if (!targetAcceptsPath(target, file, fsImpl) || samePath(file, target.receiptFile)) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_PATH_OUTSIDE_ROOT: ${file}`)
    error.code = 'GLOBAL_HOST_REMOVAL_PATH_OUTSIDE_ROOT'
    throw error
  }
  if (!fsImpl.existsSync(file)) {
    return {
      host: target.host,
      action: 'remove',
      path: file,
      kind: expectedOperation?.kind || 'text',
      expectAbsent: true
    }
  }
  const stat = fsImpl.lstatSync(file)
  if (stat.isSymbolicLink()) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_SYMLINK: ${file}`)
    error.code = 'GLOBAL_HOST_REMOVAL_SYMLINK'
    throw error
  }
  if (!stat.isFile()) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_NOT_FILE: ${file}`)
    error.code = 'GLOBAL_HOST_REMOVAL_NOT_FILE'
    throw error
  }
  const currentBytes = fsImpl.readFileSync(file)
  const current = currentBytes.toString('utf8')
  if (artifact.ownershipKind === 'markdown-block') {
    const block = extractManagedBlockText(current, 'markdown', artifact.blockId || `global-${target.host}`)
    if (block == null && MANAGED_SIGNATURE.test(current)) {
      const error = new Error(`GLOBAL_HOST_REMOVAL_MANAGED_BLOCK_MISSING: ${file}`)
      error.code = 'GLOBAL_HOST_REMOVAL_MANAGED_BLOCK_MISSING'
      throw error
    }
    if (block != null && digestText(block) !== artifact.managedDigest) {
      const error = new Error(`GLOBAL_HOST_REMOVAL_MANAGED_BLOCK_MODIFIED: ${file}`)
      error.code = 'GLOBAL_HOST_REMOVAL_MANAGED_BLOCK_MODIFIED'
      throw error
    }
    return writeOrRemoveOperation(
      target.host,
      file,
      removeManagedBlock(current, { kind: 'markdown', id: artifact.blockId || `global-${target.host}` }),
      'text',
      currentBytes
    )
  }
  if (artifact.ownershipKind === 'codex-toml-block') {
    if (extractManagedBlockText(current, 'toml', artifact.blockId || 'global-codex-mcp') != null &&
        (!expectedOperation || !tomlManagedFileMatches(
          current,
          expectedOperation.content,
          expectedOperation.managedContent,
          { id: artifact.blockId || 'global-codex-mcp' }
        ))) {
      const error = new Error(`GLOBAL_HOST_REMOVAL_MANAGED_BLOCK_MODIFIED: ${file}`)
      error.code = 'GLOBAL_HOST_REMOVAL_MANAGED_BLOCK_MODIFIED'
      throw error
    }
    const desired = removeManagedBlock(current, { kind: 'toml', id: artifact.blockId || 'global-codex-mcp' })
    if (/mcp_servers\.devcodex-(?:memory|profile)/i.test(desired)) {
      const error = new Error(`GLOBAL_HOST_REMOVAL_TOML_RESIDUAL: ${file}`)
      error.code = 'GLOBAL_HOST_REMOVAL_TOML_RESIDUAL'
      throw error
    }
    return writeOrRemoveOperation(target.host, file, desired, 'toml', currentBytes)
  }
  if (artifact.ownershipKind === 'grok-plugin-registration') {
    const removal = removeGrokPluginRegistration(current, target.files.plugin, {
      pluginName: artifact.pluginName || 'devcodex-workspace'
    })
    const desired = artifact.managedDigest && digestText(current) === artifact.managedDigest
      ? ''
      : removal.desired
    if (/devcodex-workspace/i.test(desired) || desired.includes(portable(target.files.plugin))) {
      const error = new Error(`GLOBAL_HOST_REMOVAL_GROK_REGISTRATION_CONFLICT: ${file}`)
      error.code = 'GLOBAL_HOST_REMOVAL_GROK_REGISTRATION_CONFLICT'
      throw error
    }
    return writeOrRemoveOperation(target.host, file, desired, 'toml', currentBytes)
  }
  if (artifact.ownershipKind === 'json-managed') {
    const managed = managedJsonFor(target, file, expectedOperation)
    const removal = removeHostJsonContent(current, managed, `${target.host}:${portable(file)}`)
    return writeOrRemoveOperation(target.host, file, removal.desired, 'json', currentBytes)
  }

  const expectedDigest = artifact.managedDigest || receiptDigest(receipt, file)
  if (!/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_OWNERSHIP_PROOF_MISSING: ${file}`)
    error.code = 'GLOBAL_HOST_REMOVAL_OWNERSHIP_PROOF_MISSING'
    throw error
  }
  const actualDigest = digestText(fsImpl.readFileSync(file))
  if (actualDigest !== expectedDigest) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_MANAGED_FILE_MODIFIED: ${file}`)
    error.code = 'GLOBAL_HOST_REMOVAL_MANAGED_FILE_MODIFIED'
    throw error
  }
  return {
    host: target.host,
    action: 'remove',
    path: file,
    kind: expectedOperation?.kind || 'text',
    expectedDigest: operationDigest(currentBytes)
  }
}

function buildGlobalHostRemovalPlan(options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const targets = resolveGlobalHostTargets({
    home: options.home,
    env,
    fs: fsImpl,
    packageRoot,
    hosts: options.hosts || GLOBAL_HOST_IDS
  })
  const expectedPlan = buildGlobalHostConfigPlan({
    packageRoot,
    home: options.home,
    env,
    fs: fsImpl,
    hosts: targets.map(target => target.host)
  })
  const contentOperations = []
  const receiptOperations = []
  const conflicts = []
  const hostPlans = []
  const seen = new Map()

  for (const target of targets) {
    if (!fsImpl.existsSync(target.receiptFile)) {
      const residuals = unmanagedResidualEvidence(target, fsImpl)
      if (residuals.length) {
        conflicts.push({
          host: target.host,
          errorCode: 'GLOBAL_HOST_REMOVAL_RECEIPT_MISSING',
          error: 'managed-looking host artifacts exist without an ownership receipt',
          paths: residuals
        })
        hostPlans.push({ host: target.host, status: 'blocked', artifacts: 0, residuals })
      } else {
        hostPlans.push({ host: target.host, status: 'already-absent', artifacts: 0, residuals: [] })
      }
      continue
    }

    let receipt
    try {
      const receiptStat = fsImpl.lstatSync(target.receiptFile)
      if (receiptStat.isSymbolicLink() || !receiptStat.isFile()) {
        const error = new Error(`GLOBAL_HOST_REMOVAL_RECEIPT_NOT_REGULAR: ${target.receiptFile}`)
        error.code = 'GLOBAL_HOST_REMOVAL_RECEIPT_NOT_REGULAR'
        throw error
      }
      if (receiptStat.size > MAX_REMOVAL_RECEIPT_BYTES) {
        const error = new Error(`GLOBAL_HOST_REMOVAL_RECEIPT_LIMIT: ${target.receiptFile} bytes=${receiptStat.size}`)
        error.code = 'GLOBAL_HOST_REMOVAL_RECEIPT_LIMIT'
        throw error
      }
      receipt = parseJsonObject(readText(target.receiptFile, fsImpl), `${target.host} removal receipt`)
      validateReceipt(receipt, target, fsImpl)
      const activationReceiptPath = target.host === 'codex'
        ? validActivationReceiptPath(resolveActivationReceiptFile({
            env,
            home: options.home,
            fs: fsImpl
          }), fsImpl)
        : null
      const auxiliaryManagedPaths = activationReceiptPath ? [activationReceiptPath] : []
      const unknownFiles = unknownFilesInManagedRoots(receipt, target, fsImpl, auxiliaryManagedPaths)
      if (unknownFiles.length) {
        const error = new Error(`GLOBAL_HOST_REMOVAL_UNKNOWN_MANAGED_ROOT_CONTENT: ${unknownFiles.join(', ')}`)
        error.code = 'GLOBAL_HOST_REMOVAL_UNKNOWN_MANAGED_ROOT_CONTENT'
        throw error
      }
      const expected = expectedOperationMap(expectedPlan, target.host)
      const paths = Array.from(new Set([...receiptPaths(receipt), ...auxiliaryManagedPaths].map(portable)))
      let changed = 0
      for (const file of paths) {
        validateReceiptManagedPath(receipt, target, file, expected, fsImpl)
        const artifact = auxiliaryManagedPaths.some(candidate => samePath(candidate, file))
          ? {
              path: portable(file),
              ownershipKind: 'whole-file',
              managedDigest: digestText(fsImpl.readFileSync(file))
            }
          : receiptArtifact(receipt, target, file)
        const operation = planArtifactOperation({
          artifact,
          receipt,
          target,
          expectedOperation: expected.get(pathKey(file)),
          fsImpl
        })
        if (!operation) continue
        const key = pathKey(operation.path)
        if (seen.has(key)) {
          const error = new Error(`GLOBAL_HOST_REMOVAL_DUPLICATE_OWNERSHIP: ${operation.path}`)
          error.code = 'GLOBAL_HOST_REMOVAL_DUPLICATE_OWNERSHIP'
          throw error
        }
        seen.set(key, target.host)
        contentOperations.push(operation)
        changed += 1
      }
      receiptOperations.push({
        host: target.host,
        action: 'remove',
        path: target.receiptFile,
        kind: 'json',
        expectedDigest: operationDigest(fsImpl.readFileSync(target.receiptFile))
      })
      hostPlans.push({
        host: target.host,
        status: 'planned',
        artifacts: paths.length,
        changed: changed + 1,
        receiptFile: portable(target.receiptFile)
      })
    } catch (error) {
      conflicts.push({
        host: target.host,
        errorCode: error.code || 'GLOBAL_HOST_REMOVAL_PLAN_FAILED',
        error: error.message
      })
      hostPlans.push({ host: target.host, status: 'blocked', artifacts: 0 })
    }
  }

  const operations = [...contentOperations, ...receiptOperations]
  const planDigest = digestText(JSON.stringify(operations.map(operation => ({
    host: operation.host,
    action: operation.action,
    path: portable(operation.path),
    contentDigest: operation.content == null ? null : digestText(operation.content),
    expectAbsent: operation.expectAbsent === true
  }))))
  return {
    schemaVersion: GLOBAL_HOST_REMOVAL_PLAN_SCHEMA,
    status: conflicts.length ? 'blocked' : (operations.length ? 'planned' : 'already-absent'),
    packageRoot,
    home: targets[0]?.home || path.resolve(options.home || ''),
    targets,
    hostPlans,
    conflicts,
    operations,
    planDigest
  }
}

function transactionBoundaries(targets) {
  const allowedByHost = {}
  const allowedRoots = []
  const allowedFiles = []
  const safetyRoots = []
  for (const target of targets) {
    const roots = [target.root, ...(target.additionalRoots || [])]
    const files = target.additionalFiles || []
    const targetSafety = targetSafetyRoots(target)
    allowedByHost[target.host] = {
      allowedRoots: roots,
      allowedFiles: files,
      safetyRoots: targetSafety
    }
    allowedRoots.push(...roots)
    allowedFiles.push(...files)
    safetyRoots.push(...targetSafety)
  }
  return { allowedByHost, allowedRoots, allowedFiles, safetyRoots }
}

function refreshAuthorizedGrokConfigMutation(plan, grokTarget, integration, fsImpl = fs) {
  if (!grokTarget?.files?.config) return
  const index = plan.operations.findIndex(operation =>
    operation.host === 'grok' && samePath(operation.path, grokTarget.files.config)
  )
  if (index < 0) return
  const operation = plan.operations[index]
  const beforeDigest = String(integration?.beforeDigest || '')
  const afterDigest = String(integration?.afterDigest || '')
  const authorizedMutation = integration?.dryRun === false &&
    operation.expectedDigest === beforeDigest &&
    /^[a-f0-9]{64}$/i.test(afterDigest)
  if (!fsImpl.existsSync(operation.path)) {
    if (operation.action === 'remove' && authorizedMutation && afterDigest === operationDigest('')) {
      operation.expectedDigest = null
      operation.expectAbsent = true
      return
    }
    const error = new Error(`GLOBAL_HOST_REMOVAL_GROK_CONFIG_DRIFT: ${operation.path}`)
    error.code = 'GLOBAL_HOST_REMOVAL_GROK_CONFIG_DRIFT'
    throw error
  }
  const currentBytes = fsImpl.readFileSync(operation.path)
  const currentDigest = operationDigest(currentBytes)
  if (currentDigest === operation.expectedDigest) return
  if (!authorizedMutation || currentDigest !== afterDigest) {
    const error = new Error(`GLOBAL_HOST_REMOVAL_GROK_CONFIG_DRIFT: ${operation.path}`)
    error.code = 'GLOBAL_HOST_REMOVAL_GROK_CONFIG_DRIFT'
    throw error
  }
  operation.expectedDigest = currentDigest
  delete operation.expectAbsent
}

function buildGrokConfigCompensationOperation(snapshot, integration, fsImpl = fs) {
  const currentExists = fsImpl.existsSync(snapshot.path)
  const currentBytes = currentExists ? fsImpl.readFileSync(snapshot.path) : null
  const currentDigest = operationDigest(currentBytes == null ? '' : currentBytes)
  const beforeDigest = operationDigest(snapshot.content)
  const authorizedAfter = integration?.dryRun === false &&
    integration.beforeDigest === beforeDigest &&
    integration.afterDigest === currentDigest

  if (snapshot.existed) {
    if (currentExists && currentDigest === beforeDigest) return null
    if (!currentExists) {
      return {
        host: 'grok',
        action: 'write',
        path: snapshot.path,
        kind: 'toml',
        content: snapshot.content,
        expectAbsent: true
      }
    }
    if (authorizedAfter) {
      return {
        host: 'grok',
        action: 'write',
        path: snapshot.path,
        kind: 'toml',
        content: snapshot.content,
        expectedDigest: currentDigest
      }
    }
  } else {
    if (!currentExists) return null
    if (authorizedAfter) {
      return {
        host: 'grok',
        action: 'remove',
        path: snapshot.path,
        kind: 'toml',
        expectedDigest: currentDigest
      }
    }
  }

  const error = new Error(`GLOBAL_HOST_REMOVAL_GROK_COMPENSATION_DRIFT: ${snapshot.path}`)
  error.code = 'GLOBAL_HOST_REMOVAL_GROK_COMPENSATION_DRIFT'
  throw error
}

function nearestPruneBoundary(file, target, fsImpl = fs) {
  const destination = path.resolve(file)
  const exclusiveRoots = [
    target.runtimeBaseRoot,
    target.files?.plugin,
    target.shared?.root ? path.join(target.shared.root, 'devcodex') : null
  ]
    .filter(Boolean)
    .map(root => path.resolve(root))
    .filter(root => isUnderPhysical(root, destination, fsImpl))
    .sort((left, right) => left.length - right.length)
  if (exclusiveRoots.length) return path.dirname(exclusiveRoots[0])

  const skillRoots = nativeSkillRoots(target)
    .filter(root => isUnderPhysical(root, destination, fsImpl) && !samePath(root, destination))
    .sort((left, right) => right.length - left.length)
  if (skillRoots.length) return skillRoots[0]

  // Direct host config parents (for example ~/.copilot/hooks) are not receipt-owned.
  return path.dirname(destination)
}

function pruneEmptyManagedDirectories(operations, targets, fsImpl = fs) {
  const removed = []
  const failures = []
  const targetByHost = new Map(targets.map(target => [target.host, target]))
  for (const operation of operations.filter(item => item.action === 'remove')) {
    const target = targetByHost.get(operation.host)
    const boundary = target && nearestPruneBoundary(operation.path, target, fsImpl)
    if (!boundary) continue
    let cursor = path.dirname(operation.path)
    while (!samePath(cursor, boundary) && isUnderPhysical(boundary, cursor, fsImpl)) {
      if (!fsImpl.existsSync(cursor)) {
        cursor = path.dirname(cursor)
        continue
      }
      try {
        const stat = fsImpl.lstatSync(cursor)
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          failures.push({
            path: portable(cursor),
            errorCode: 'GLOBAL_HOST_PRUNE_PATH_UNSAFE',
            error: 'Empty-directory pruning encountered a non-directory or symbolic link'
          })
          break
        }
        if (fsImpl.readdirSync(cursor).length) break
        fsImpl.rmdirSync(cursor)
        removed.push(portable(cursor))
        cursor = path.dirname(cursor)
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) {
          failures.push({ path: portable(cursor), errorCode: error.code || 'RMDIR_FAILED', error: error.message })
        }
        break
      }
    }
  }
  return { removed: Array.from(new Set(removed)), failures }
}

function cleanupGrokRecoveryArtifact(integration, fsImpl = fs) {
  const backupPath = integration?.backupPath ? path.resolve(integration.backupPath) : null
  const manifestPath = integration?.backupManifestPath ? path.resolve(integration.backupManifestPath) : null
  if (!backupPath && !manifestPath) {
    return { status: 'not-applicable', transaction: null, failures: [] }
  }
  const failures = []
  if (!backupPath || !manifestPath) {
    failures.push({
      errorCode: 'GLOBAL_HOST_GROK_RECOVERY_PROOF_INCOMPLETE',
      error: 'Grok recovery cleanup requires both backupPath and backupManifestPath'
    })
    return { status: 'blocked', transaction: null, failures }
  }
  const tempRoot = path.dirname(path.dirname(manifestPath))
  if (path.basename(tempRoot).toLowerCase() !== 'devcodex' ||
      path.basename(path.dirname(tempRoot)).toLowerCase() !== '.tmp' ||
      !isUnderPhysical(tempRoot, backupPath, fsImpl) ||
      !isUnderPhysical(path.join(tempRoot, 'manifests'), manifestPath, fsImpl)) {
    failures.push({
      errorCode: 'GLOBAL_HOST_GROK_RECOVERY_PATH_INVALID',
      error: 'Grok recovery paths are outside one canonical workspace temp root'
    })
    return { status: 'blocked', transaction: null, failures }
  }
  if (!fsImpl.existsSync(manifestPath) || fsImpl.lstatSync(manifestPath).isSymbolicLink() ||
      !fsImpl.lstatSync(manifestPath).isFile()) {
    failures.push({
      errorCode: 'GLOBAL_HOST_GROK_RECOVERY_MANIFEST_INVALID',
      path: portable(manifestPath),
      error: 'Grok recovery manifest is missing or not a regular file'
    })
    return { status: 'blocked', transaction: null, failures }
  }
  let manifest
  try {
    manifest = parseJsonObject(readText(manifestPath, fsImpl), 'Grok recovery manifest')
  } catch (error) {
    failures.push({ errorCode: error.code || 'GLOBAL_HOST_GROK_RECOVERY_MANIFEST_INVALID', error: error.message })
    return { status: 'blocked', transaction: null, failures }
  }
  if (manifest.schemaVersion !== 'WorkspaceTempManifestV1' ||
      manifest.owner !== 'devcodex-grok-adapter' ||
      manifest.producer !== 'grok-plugin-uninstall' ||
      !path.isAbsolute(String(manifest.targetPath || '')) ||
      !samePathValue(manifest.targetPath, backupPath)) {
    failures.push({
      errorCode: 'GLOBAL_HOST_GROK_RECOVERY_OWNERSHIP_INVALID',
      path: portable(manifestPath),
      error: 'Grok recovery manifest does not prove exact DevCodex uninstall ownership'
    })
    return { status: 'blocked', transaction: null, failures }
  }
  const operations = []
  if (fsImpl.existsSync(backupPath)) {
    const stat = fsImpl.lstatSync(backupPath)
    if (stat.isSymbolicLink() || !stat.isFile() ||
        !/^[a-f0-9]{64}$/i.test(String(integration.beforeDigest || '')) ||
        digestText(fsImpl.readFileSync(backupPath, 'utf8')) !== integration.beforeDigest) {
      failures.push({
        errorCode: 'GLOBAL_HOST_GROK_RECOVERY_BACKUP_MODIFIED',
        path: portable(backupPath),
        error: 'Grok recovery backup is modified or not a regular file'
      })
      return { status: 'blocked', transaction: null, failures }
    }
    operations.push({
      host: 'grok-recovery',
      action: 'remove',
      path: backupPath,
      kind: 'text',
      expectedDigest: operationDigest(fsImpl.readFileSync(backupPath))
    })
  }
  operations.push({
    host: 'grok-recovery',
    action: 'remove',
    path: manifestPath,
    kind: 'json',
    expectedDigest: operationDigest(fsImpl.readFileSync(manifestPath))
  })
  try {
    const transaction = executeGlobalHostTransaction(operations, {
      fs: fsImpl,
      allowedRoots: [tempRoot],
      allowedByHost: {
        'grok-recovery': { allowedRoots: [tempRoot], allowedFiles: [] }
      }
    })
    return {
      status: transaction.backupCleanupIncomplete ? 'cleanup-incomplete' : 'committed',
      transaction,
      failures: transaction.backupCleanupFailures || []
    }
  } catch (error) {
    return {
      status: 'blocked',
      transaction: error.receipt || null,
      failures: [{ errorCode: error.code || 'GLOBAL_HOST_GROK_RECOVERY_CLEANUP_FAILED', error: error.message }]
    }
  }
}

function applyGlobalHostRemoval(options = {}) {
  const fsImpl = options.fs || fs
  const plan = buildGlobalHostRemovalPlan(options)
  if (plan.status === 'blocked') {
    const error = new Error(`GLOBAL_HOST_REMOVAL_BLOCKED: ${plan.conflicts.map(item => `${item.host}:${item.errorCode}`).join(', ')}`)
    error.code = 'GLOBAL_HOST_REMOVAL_BLOCKED'
    error.plan = plan
    throw error
  }
  if (plan.status === 'already-absent') {
    return {
      ...plan,
      schemaVersion: GLOBAL_HOST_REMOVAL_RECEIPT_SCHEMA,
      status: 'already-absent',
      dryRun: options.dryRun === true,
      transaction: null,
      grokIntegration: null,
      prunedDirectories: [],
      completedAt: new Date().toISOString()
    }
  }

  const boundaries = transactionBoundaries(plan.targets)
  executeGlobalHostTransaction(plan.operations, {
    fs: fsImpl,
    ...boundaries,
    dryRun: true
  })
  const grokTarget = plan.targets.find(target => target.host === 'grok')
  const grokPlanned = plan.hostPlans.some(item => item.host === 'grok' && item.status === 'planned')
  const grokEnv = grokTarget
    ? buildGrokCliEnv({ ...(options.env || process.env), GROK_HOME: grokTarget.root })
    : null
  const uninstallGrok = options.uninstallGrokPluginInstallation || uninstallGrokPluginInstallation
  const syncGrok = options.syncGrokWorkspacePluginInstallation || syncGrokWorkspacePluginInstallation
  let grokIntegration = null
  let grokBefore = null

  if (options.dryRun === true) {
    if (grokTarget && grokPlanned) {
      grokIntegration = uninstallGrok({
        pluginPath: grokTarget.files.plugin,
        activeRoot: options.activeRoot,
        dryRun: true,
        env: grokEnv
      })
    }
    const transaction = executeGlobalHostTransaction(plan.operations, {
      fs: fsImpl,
      ...boundaries,
      dryRun: true
    })
    return {
      ...plan,
      schemaVersion: GLOBAL_HOST_REMOVAL_RECEIPT_SCHEMA,
      status: 'planned',
      dryRun: true,
      transaction,
      grokIntegration,
      prunedDirectories: [],
      completedAt: new Date().toISOString()
    }
  }

  const grokConfigSnapshot = grokTarget
    ? {
        path: grokTarget.files.config,
        existed: fsImpl.existsSync(grokTarget.files.config),
        content: readText(grokTarget.files.config, fsImpl)
      }
    : null
  try {
    if (grokTarget && grokPlanned) {
      grokBefore = uninstallGrok({
        pluginPath: grokTarget.files.plugin,
        activeRoot: options.activeRoot,
        dryRun: true,
        env: grokEnv
      })
      grokIntegration = uninstallGrok({
        pluginPath: grokTarget.files.plugin,
        activeRoot: options.activeRoot,
        dryRun: false,
        env: grokEnv
      })
      refreshAuthorizedGrokConfigMutation(plan, grokTarget, grokIntegration, fsImpl)
    }
    const transaction = executeGlobalHostTransaction(plan.operations, {
      fs: fsImpl,
      ...boundaries,
      failAfter: options.failAfter
    })
    const pruned = pruneEmptyManagedDirectories(plan.operations, plan.targets, fsImpl)
    const grokRecoveryCleanup = cleanupGrokRecoveryArtifact(grokIntegration, fsImpl)
    const cleanupIncomplete = transaction.backupCleanupIncomplete === true ||
      pruned.failures.length > 0 ||
      ['blocked', 'cleanup-incomplete'].includes(grokRecoveryCleanup.status)
    return {
      ...plan,
      schemaVersion: GLOBAL_HOST_REMOVAL_RECEIPT_SCHEMA,
      status: cleanupIncomplete ? 'cleanup-incomplete' : 'committed',
      dryRun: false,
      transaction,
      grokIntegration,
      grokRecoveryCleanup,
      prunedDirectories: pruned.removed,
      pruneFailures: pruned.failures,
      recoveryCleanupFailures: grokRecoveryCleanup.failures,
      cleanupIncomplete,
      completedAt: new Date().toISOString()
    }
  } catch (error) {
    const compensationApplicable = Boolean(grokConfigSnapshot && grokPlanned)
    const compensation = {
      applicable: compensationApplicable,
      configRestored: !compensationApplicable,
      registrationRestored: !compensationApplicable,
      errors: []
    }
    if (compensationApplicable) {
      try {
        const restoreOperation = buildGrokConfigCompensationOperation(
          grokConfigSnapshot,
          grokIntegration,
          fsImpl
        )
        if (restoreOperation) {
          executeGlobalHostTransaction([restoreOperation], { fs: fsImpl, ...boundaries })
        }
        compensation.configRestored = true
      } catch (restoreError) {
        compensation.errors.push(restoreError.message)
      }
      if (grokIntegration?.installedRepoId || grokBefore?.installedRepoId) {
        if (!compensation.configRestored) {
          compensation.errors.push('Grok registration restore skipped because configuration compensation is not proven safe')
        } else {
          try {
            const restored = syncGrok({
              pluginPath: grokTarget.files.plugin,
              activeRoot: options.activeRoot,
              env: grokEnv
            })
            compensation.registrationRestored = restored?.status === 'verified'
            if (!compensation.registrationRestored) compensation.errors.push(`Grok restore status: ${restored?.status || 'unknown'}`)
          } catch (restoreError) {
            compensation.errors.push(restoreError.message)
          }
        }
      } else {
        compensation.registrationRestored = true
      }
    }
    error.plan = error.plan || plan
    error.removalCompensation = compensation
    if (compensation.errors.length) error.code = 'GLOBAL_HOST_REMOVAL_ROLLBACK_INCOMPLETE'
    throw error
  }
}

module.exports = {
  GLOBAL_HOST_REMOVAL_PLAN_SCHEMA,
  GLOBAL_HOST_REMOVAL_RECEIPT_SCHEMA,
  applyGlobalHostRemoval,
  buildGrokConfigCompensationOperation,
  buildGlobalHostRemovalPlan,
  cleanupGrokRecoveryArtifact,
  digestText,
  pruneEmptyManagedDirectories,
  receiptPaths,
  structuredOwnership
}
