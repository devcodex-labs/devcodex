'use strict'

const crypto = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { buildBundle } = require('./control-content-source')
const {
  createWorkspaceTempArtifactAtRoot,
  ensureWorkspaceTempPartitions,
  inspectPathBoundary,
  v2ManifestPath
} = require('./workspace-temp.js')
const {
  resolveWorkspaceTempProject,
  resolveWorkspaceTempRoot
} = require('./workspace-temp-layout.js')

const PREVIEW_SCHEMA = 'ContentRootDeletePreviewV1'
const TRANSACTION_SCHEMA = 'ContentRootDeleteTransactionV1'
const FINALIZE_CONFIRMATION = 'DELETE-STAGED-CONTENT'
const DEFAULT_QUARANTINE = 'content-root-delete'

function portable (value) {
  return String(value || '').replace(/\\/g, '/')
}

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function writeJsonAtomic (target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function trackedPaths (root) {
  const output = execFileSync('git', ['-C', root, 'ls-files', '-z', '--'], {
    encoding: 'buffer',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return output.toString('utf8').split('\0').filter(Boolean).map(portable).sort()
}

function mappedRecord (relative) {
  if (relative.startsWith('content-source/')) {
    return {
      group: 'content-source',
      replacement: `content/${relative.slice('content-source/'.length)}`
    }
  }
  if (relative === 'instructions.md') {
    return { group: 'legacy-markdown', replacement: 'content/instructions.md' }
  }
  if (/^(?:instructions|prompts)\/.+\.md$/.test(relative)) {
    return { group: 'legacy-markdown', replacement: `content/${relative}` }
  }
  if (/^skills\/[^/]+\/SKILL\.md$/.test(relative)) {
    return { group: 'legacy-markdown', replacement: `content/${relative}` }
  }
  if (/^skills\/[^/]+\/intent\.json$/.test(relative)) {
    return { group: 'legacy-intent', replacement: `content/${relative}` }
  }
  return null
}

function assertSafeRecord (record) {
  const mapped = mappedRecord(portable(record.path))
  const source = portable(record.path)
  const replacement = portable(record.replacement)
  if (!mapped ||
      mapped.group !== record.group ||
      mapped.replacement !== replacement ||
      source.includes('..') ||
      replacement.includes('..') ||
      path.isAbsolute(record.path) ||
      path.isAbsolute(record.replacement)) {
    const error = new Error(`CONTENT_ROOT_DELETE_PATH_UNSAFE: ${record.path}`)
    error.code = 'CONTENT_ROOT_DELETE_PATH_UNSAFE'
    throw error
  }
  return { source, replacement }
}

function previewDigest (preview) {
  const unsigned = { ...preview }
  delete unsigned.previewDigest
  return sha256(JSON.stringify(unsigned))
}

function expectedRenderedFiles (root) {
  const bundle = buildBundle(root)
  return new Map(bundle.files.map(file => [portable(file.relative), file.outputDigest]))
}

function buildDeletePreview (root, options = {}) {
  const resolvedRoot = path.resolve(root)
  const rendered = expectedRenderedFiles(resolvedRoot)
  const records = []
  for (const relative of trackedPaths(resolvedRoot)) {
    const mapped = mappedRecord(relative)
    if (!mapped) continue
    const sourcePath = path.join(resolvedRoot, relative)
    const replacementPath = path.join(resolvedRoot, mapped.replacement)
    if (!fs.existsSync(replacementPath)) {
      throw new Error(`CONTENT_ROOT_DELETE_REPLACEMENT_MISSING: ${mapped.replacement}`)
    }
    const digest = sha256(fs.readFileSync(sourcePath))
    const replacementDigest = sha256(fs.readFileSync(replacementPath))
    let equivalence = digest === replacementDigest
      ? 'byte-identical'
      : 'canonical-supersedes-legacy'
    if (mapped.group === 'legacy-markdown') {
      const renderedDigest = rendered.get(relative)
      if (!renderedDigest || renderedDigest !== digest) {
        throw new Error(`CONTENT_ROOT_DELETE_RENDERED_DRIFT: ${relative}`)
      }
      equivalence = 'rendered-byte-identical'
    } else if (relative === 'content-source/manifest.json') {
      equivalence = 'superseded-manifest-v2'
    }
    records.push({
      group: mapped.group,
      path: relative,
      digest,
      replacement: mapped.replacement,
      replacementDigest,
      equivalence,
      tracked: true
    })
  }

  const groups = records.reduce((counts, record) => {
    counts[record.group] = (counts[record.group] || 0) + 1
    return counts
  }, {})
  const preview = {
    schemaVersion: PREVIEW_SCHEMA,
    project: options.project || path.basename(resolvedRoot),
    root: portable(resolvedRoot),
    generatedAt: options.generatedAt || new Date().toISOString(),
    groups,
    fileCount: records.length,
    records
  }
  preview.previewDigest = previewDigest(preview)
  return preview
}

function verifyDeletePreview (root, preview) {
  const resolvedRoot = path.resolve(root)
  const failures = []
  if (preview?.schemaVersion !== PREVIEW_SCHEMA) failures.push('schema')
  if (path.resolve(preview?.root || '') !== resolvedRoot) failures.push('root')
  if (!Array.isArray(preview?.records)) failures.push('records')
  if (preview?.fileCount !== preview?.records?.length) failures.push('fileCount')
  if (preview?.previewDigest !== previewDigest(preview || {})) failures.push('previewDigest')
  if (failures.length > 0) {
    const error = new Error(`CONTENT_ROOT_DELETE_PREVIEW_INVALID: ${failures.join(',')}`)
    error.code = 'CONTENT_ROOT_DELETE_PREVIEW_INVALID'
    throw error
  }

  const tracked = new Set(trackedPaths(resolvedRoot))
  const expected = trackedPaths(resolvedRoot).filter(relative => mappedRecord(relative))
  const actual = preview.records.map(record => portable(record.path))
  if (new Set(actual).size !== actual.length ||
      expected.length !== actual.length ||
      expected.some((relative, index) => relative !== actual[index])) {
    const error = new Error('CONTENT_ROOT_DELETE_INVENTORY_DRIFT')
    error.code = 'CONTENT_ROOT_DELETE_INVENTORY_DRIFT'
    throw error
  }

  const rendered = expectedRenderedFiles(resolvedRoot)
  for (const record of preview.records) {
    const { source, replacement } = assertSafeRecord(record)
    const sourcePath = path.join(resolvedRoot, source)
    const replacementPath = path.join(resolvedRoot, replacement)
    if (!tracked.has(source) || record.tracked !== true) {
      throw new Error(`CONTENT_ROOT_DELETE_SOURCE_UNTRACKED: ${source}`)
    }
    if (!fs.existsSync(sourcePath) || sha256(fs.readFileSync(sourcePath)) !== record.digest) {
      throw new Error(`CONTENT_ROOT_DELETE_SOURCE_DRIFT: ${source}`)
    }
    if (!fs.existsSync(replacementPath) ||
        sha256(fs.readFileSync(replacementPath)) !== record.replacementDigest) {
      throw new Error(`CONTENT_ROOT_DELETE_REPLACEMENT_DRIFT: ${replacement}`)
    }
    if (record.group === 'legacy-markdown') {
      if (record.equivalence !== 'rendered-byte-identical' ||
          rendered.get(source) !== record.digest) {
        throw new Error(`CONTENT_ROOT_DELETE_RENDERED_DRIFT: ${source}`)
      }
    } else if (record.equivalence === 'byte-identical' &&
        record.digest !== record.replacementDigest) {
      throw new Error(`CONTENT_ROOT_DELETE_EQUIVALENCE_INVALID: ${source}`)
    }
  }
  return {
    status: 'PASS',
    previewDigest: preview.previewDigest,
    fileCount: preview.fileCount,
    groups: preview.groups
  }
}

function readJson (target) {
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

function assertInsideRoot (root, target, label) {
  const resolvedRoot = `${path.resolve(root)}${path.sep}`
  const resolvedTarget = path.resolve(target)
  if (!`${resolvedTarget}${path.sep}`.startsWith(resolvedRoot)) {
    throw new Error(`CONTENT_ROOT_DELETE_${label}_OUTSIDE_ROOT`)
  }
  return resolvedTarget
}

function resolveQuarantineBase (root, options = {}, { prepare = false } = {}) {
  if (options.quarantineRoot) {
    const relative = portable(options.quarantineRoot)
    if (path.isAbsolute(options.quarantineRoot) || relative.includes('..')) {
      throw new Error('CONTENT_ROOT_DELETE_QUARANTINE_PATH_UNSAFE')
    }
    return path.join(path.resolve(root), options.quarantineRoot)
  }
  const tempRoot = resolveWorkspaceTempRoot(root)
  if (prepare) ensureWorkspaceTempPartitions(tempRoot)
  const quarantineBase = path.join(tempRoot, 'quarantine')
  const boundary = inspectPathBoundary(tempRoot, quarantineBase)
  if (!boundary.safe) throw new Error(`CONTENT_ROOT_DELETE_QUARANTINE_PATH_UNSAFE: ${boundary.reason}`)
  if (prepare) {
    fs.mkdirSync(quarantineBase, { recursive: true })
    const preparedBoundary = inspectPathBoundary(tempRoot, quarantineBase)
    if (!preparedBoundary.safe) throw new Error(`CONTENT_ROOT_DELETE_QUARANTINE_PATH_UNSAFE: ${preparedBoundary.reason}`)
  }
  return quarantineBase
}

function quarantineTransactionRoot (root, previewDigestValue, options = {}) {
  if (options.quarantineRoot) return path.join(resolveQuarantineBase(root, options), previewDigestValue)
  const project = resolveWorkspaceTempProject(root)
  const artifactId = `content-root-delete-${String(previewDigestValue).slice(0, 24)}`
  return path.join(
    resolveWorkspaceTempRoot(root),
    'quarantine',
    ...String(project).split('/').filter(Boolean),
    'content-root-delete-transaction',
    artifactId,
    'transaction'
  )
}

function quarantinePath (root, previewDigestValue, relative, options = {}) {
  return path.join(quarantineTransactionRoot(root, previewDigestValue, options), 'files', relative)
}

function removeTransactionManifest (root, receipt, options = {}) {
  if (options.quarantineRoot) return false
  const artifactId = `content-root-delete-${String(receipt.previewDigest || '').slice(0, 24)}`
  const tempRoot = resolveWorkspaceTempRoot(root)
  const manifestPath = v2ManifestPath(
    tempRoot,
    resolveWorkspaceTempProject(root),
    'quarantine',
    artifactId
  )
  if (!fs.existsSync(manifestPath)) return false
  const stats = fs.lstatSync(manifestPath)
  if (stats.isSymbolicLink() || !stats.isFile()) return false
  const raw = fs.readFileSync(manifestPath)
  if (receipt.tempArtifact?.manifestDigest && sha256(raw) !== receipt.tempArtifact.manifestDigest) return false
  let manifest
  try { manifest = JSON.parse(raw.toString('utf8')) } catch { return false }
  const expectedTarget = quarantineTransactionRoot(root, receipt.previewDigest, options)
  if (
    manifest?.schemaVersion !== 'WorkspaceTempManifestV2' ||
    manifest?.artifactId !== artifactId ||
    manifest?.owner !== 'devcodex-content-root-delete' ||
    manifest?.producer !== 'content-root-delete-transaction' ||
    manifest?.cleanupPolicy !== 'retain' ||
    manifest?.lifecycleState !== 'finalized' ||
    path.resolve(tempRoot, String(manifest?.targetRelativePath || '')) !== path.resolve(expectedTarget)
  ) return false
  fs.unlinkSync(manifestPath)
  return true
}

function stageDeleteTransaction (root, previewPath, receiptPath, expectedDigest, options = {}) {
  const resolvedRoot = path.resolve(root)
  const resolvedReceipt = assertInsideRoot(resolvedRoot, receiptPath, 'RECEIPT')
  const preview = readJson(previewPath)
  const verification = verifyDeletePreview(resolvedRoot, preview)
  if (!expectedDigest || expectedDigest !== preview.previewDigest) {
    throw new Error('CONTENT_ROOT_DELETE_EXPECTED_DIGEST_MISMATCH')
  }
  if (fs.existsSync(resolvedReceipt)) throw new Error('CONTENT_ROOT_DELETE_RECEIPT_EXISTS')

  const receipt = {
    schemaVersion: TRANSACTION_SCHEMA,
    root: portable(resolvedRoot),
    previewPath: portable(path.resolve(previewPath)),
    previewDigest: preview.previewDigest,
    fileCount: preview.fileCount,
    state: 'staging',
    startedAt: new Date().toISOString(),
    moved: [],
    records: preview.records.map(record => ({
      path: record.path,
      digest: record.digest,
      replacement: record.replacement,
      replacementDigest: record.replacementDigest
    }))
  }
  resolveQuarantineBase(resolvedRoot, options, { prepare: true })
  let tempArtifact = null
  if (!options.quarantineRoot) {
    tempArtifact = createWorkspaceTempArtifactAtRoot(resolveWorkspaceTempRoot(resolvedRoot), {
      artifactId: `content-root-delete-${receipt.previewDigest.slice(0, 24)}`,
      type: 'quarantine',
      owner: 'devcodex-content-root-delete',
      project: resolveWorkspaceTempProject(resolvedRoot),
      producer: 'content-root-delete-transaction',
      targetName: 'transaction',
      cleanupPolicy: 'retain'
    })
  }
  writeJsonAtomic(resolvedReceipt, receipt)
  try {
    for (const record of receipt.records) {
      const sourcePath = path.join(resolvedRoot, record.path)
      const stagedPath = quarantinePath(resolvedRoot, receipt.previewDigest, record.path, options)
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true })
      fs.renameSync(sourcePath, stagedPath)
      receipt.moved.push(record.path)
      writeJsonAtomic(resolvedReceipt, receipt)
    }
    if (!options.quarantineRoot) {
      const transactionRoot = quarantineTransactionRoot(resolvedRoot, receipt.previewDigest, options)
      tempArtifact.activate()
      const finalReceipt = tempArtifact.finalize({ finalDisposition: 'retained' })
      receipt.tempArtifact = {
        manifestPath: tempArtifact.manifestPath,
        manifestDigest: sha256(fs.readFileSync(tempArtifact.manifestPath)),
        targetPath: transactionRoot,
        lifecycleReceipt: finalReceipt
      }
    }
    receipt.state = 'staged'
    receipt.stagedAt = new Date().toISOString()
    writeJsonAtomic(resolvedReceipt, receipt)
  } catch (error) {
    if (tempArtifact) {
      try { tempArtifact.abandon({ failureCode: error.code || 'CONTENT_ROOT_DELETE_STAGE_FAILED' }) } catch { }
    }
    for (const relative of [...receipt.moved].reverse()) {
      const stagedPath = quarantinePath(resolvedRoot, receipt.previewDigest, relative, options)
      const sourcePath = path.join(resolvedRoot, relative)
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
      if (fs.existsSync(stagedPath) && !fs.existsSync(sourcePath)) fs.renameSync(stagedPath, sourcePath)
    }
    const transactionRoot = quarantineTransactionRoot(resolvedRoot, receipt.previewDigest, options)
    removeEmptyParents(path.join(transactionRoot, 'files'), path.dirname(transactionRoot))
    removeTransactionManifest(resolvedRoot, receipt, options)
    receipt.state = 'stage-failed-rolled-back'
    receipt.error = error.message
    writeJsonAtomic(resolvedReceipt, receipt)
    throw error
  }
  return { ...verification, state: receipt.state, receiptPath: portable(resolvedReceipt) }
}

function readTransactionReceipt (root, receiptPath) {
  const resolvedReceipt = assertInsideRoot(root, receiptPath, 'RECEIPT')
  const receipt = readJson(resolvedReceipt)
  if (receipt.schemaVersion !== TRANSACTION_SCHEMA ||
      path.resolve(receipt.root) !== path.resolve(root) ||
      !Array.isArray(receipt.records) ||
      !Array.isArray(receipt.moved)) {
    throw new Error('CONTENT_ROOT_DELETE_RECEIPT_INVALID')
  }
  return { receipt, resolvedReceipt }
}

function rollbackDeleteTransaction (root, receiptPath, options = {}) {
  const resolvedRoot = path.resolve(root)
  const { receipt, resolvedReceipt } = readTransactionReceipt(resolvedRoot, receiptPath)
  if (!['staging', 'staged', 'stage-failed-rolled-back'].includes(receipt.state)) {
    throw new Error(`CONTENT_ROOT_DELETE_ROLLBACK_STATE_INVALID: ${receipt.state}`)
  }
  for (const record of [...receipt.records].reverse()) {
    const stagedPath = quarantinePath(resolvedRoot, receipt.previewDigest, record.path, options)
    const sourcePath = path.join(resolvedRoot, record.path)
    if (fs.existsSync(sourcePath)) {
      if (sha256(fs.readFileSync(sourcePath)) !== record.digest) {
        throw new Error(`CONTENT_ROOT_DELETE_ROLLBACK_SOURCE_CONFLICT: ${record.path}`)
      }
      continue
    }
    if (!fs.existsSync(stagedPath) || sha256(fs.readFileSync(stagedPath)) !== record.digest) {
      throw new Error(`CONTENT_ROOT_DELETE_ROLLBACK_STAGED_DRIFT: ${record.path}`)
    }
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
    fs.renameSync(stagedPath, sourcePath)
  }
  const transactionRoot = quarantineTransactionRoot(resolvedRoot, receipt.previewDigest, options)
  removeEmptyParents(path.join(transactionRoot, 'files'), path.dirname(transactionRoot))
  receipt.tempManifestRemoved = removeTransactionManifest(resolvedRoot, receipt, options)
  receipt.state = 'rolled-back'
  receipt.rolledBackAt = new Date().toISOString()
  writeJsonAtomic(resolvedReceipt, receipt)
  return { status: 'PASS', state: receipt.state, fileCount: receipt.fileCount }
}

function removeEmptyParents (start, stop) {
  let current = path.resolve(start)
  const boundary = path.resolve(stop)
  while (current.startsWith(`${boundary}${path.sep}`)) {
    try {
      fs.rmdirSync(current)
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error
      if (error.code === 'ENOTEMPTY') break
    }
    current = path.dirname(current)
  }
}

function finalizeDeleteTransaction (root, receiptPath, expectedDigest, confirmation, options = {}) {
  const resolvedRoot = path.resolve(root)
  const { receipt, resolvedReceipt } = readTransactionReceipt(resolvedRoot, receiptPath)
  if (receipt.state !== 'staged') {
    throw new Error(`CONTENT_ROOT_DELETE_FINALIZE_STATE_INVALID: ${receipt.state}`)
  }
  if (expectedDigest !== receipt.previewDigest) {
    throw new Error('CONTENT_ROOT_DELETE_EXPECTED_DIGEST_MISMATCH')
  }
  if (confirmation !== FINALIZE_CONFIRMATION) {
    throw new Error('CONTENT_ROOT_DELETE_FINALIZE_CONFIRMATION_REQUIRED')
  }
  for (const record of receipt.records) {
    const sourcePath = path.join(resolvedRoot, record.path)
    const stagedPath = quarantinePath(resolvedRoot, receipt.previewDigest, record.path, options)
    const replacementPath = path.join(resolvedRoot, record.replacement)
    if (fs.existsSync(sourcePath)) {
      throw new Error(`CONTENT_ROOT_DELETE_FINALIZE_SOURCE_REAPPEARED: ${record.path}`)
    }
    if (!fs.existsSync(stagedPath) || sha256(fs.readFileSync(stagedPath)) !== record.digest) {
      throw new Error(`CONTENT_ROOT_DELETE_FINALIZE_STAGED_DRIFT: ${record.path}`)
    }
    if (!fs.existsSync(replacementPath) ||
        sha256(fs.readFileSync(replacementPath)) !== record.replacementDigest) {
      throw new Error(`CONTENT_ROOT_DELETE_FINALIZE_REPLACEMENT_DRIFT: ${record.replacement}`)
    }
  }

  receipt.state = 'finalizing'
  receipt.removed = []
  writeJsonAtomic(resolvedReceipt, receipt)
  for (const record of receipt.records) {
    const stagedPath = quarantinePath(resolvedRoot, receipt.previewDigest, record.path, options)
    fs.unlinkSync(stagedPath)
    receipt.removed.push(record.path)
    writeJsonAtomic(resolvedReceipt, receipt)
  }
  const quarantineRoot = quarantineTransactionRoot(resolvedRoot, receipt.previewDigest, options)
  removeEmptyParents(path.join(quarantineRoot, 'files'), path.dirname(quarantineRoot))
  receipt.tempManifestRemoved = removeTransactionManifest(resolvedRoot, receipt, options)
  receipt.state = 'finalized'
  receipt.finalizedAt = new Date().toISOString()
  writeJsonAtomic(resolvedReceipt, receipt)
  return { status: 'PASS', state: receipt.state, fileCount: receipt.fileCount }
}

module.exports = {
  DEFAULT_QUARANTINE,
  FINALIZE_CONFIRMATION,
  PREVIEW_SCHEMA,
  TRANSACTION_SCHEMA,
  buildDeletePreview,
  finalizeDeleteTransaction,
  previewDigest,
  resolveQuarantineBase,
  rollbackDeleteTransaction,
  stageDeleteTransaction,
  verifyDeletePreview,
  writeJsonAtomic
}
