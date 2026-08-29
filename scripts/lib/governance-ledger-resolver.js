'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  inspectGovernanceLedgerBuffer,
  inspectGovernanceLedgerFile
} = require('../../hooks/_runtime/governance-ledger-integrity.cjs')

const MANIFEST_SCHEMA = 'GovernanceLedgerManifestV1'
const INDEX_SCHEMA = 'GovernanceLedgerIndexV1'
const MANIFEST_RELATIVE_PATH = 'data/governance-ledger-manifest.json'
const INDEX_RELATIVE_PATH = '.memory/indexes/governance-ledgers.json'
const TRANSACTION_RELATIVE_PATH = 'data/governance-ledger-migration.transaction.json'

const LEDGER_DEFINITIONS = Object.freeze({
  PI: Object.freeze({ kind: 'PI', prefix: 'PI-', activePath: 'data/process-improvements.md', archiveDirectory: 'data/archive/process-improvements' }),
  PF: Object.freeze({ kind: 'PF', prefix: 'PF-', activePath: 'data/pending-fixes.md', archiveDirectory: 'data/archive/pending-fixes' }),
  VL: Object.freeze({ kind: 'VL', prefix: 'VL-', activePath: 'data/violations.md', archiveDirectory: 'data/archive/violations' }),
  GR: Object.freeze({ kind: 'GR', prefix: 'GR-', activePath: 'data/gap-registry.md', archiveDirectory: 'data/archive/gap-registry' }),
  ISSUE: Object.freeze({ kind: 'ISSUE', prefix: 'ISSUE-', activePath: 'data/pending-issues.md', archiveDirectory: 'data/archive/pending-issues' })
})

const LEDGER_ALIASES = Object.freeze({
  'process-improvements': 'PI',
  'pending-fixes': 'PF',
  violations: 'VL',
  'gap-registry': 'GR',
  'pending-issues': 'ISSUE'
})

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function portable (value) {
  return String(value || '').replace(/\\/g, '/')
}

function stableValue (value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function stableStringify (value) {
  return JSON.stringify(stableValue(value))
}

function normalizeLedgerKind (value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (LEDGER_DEFINITIONS[normalized]) return normalized
  return LEDGER_ALIASES[String(value || '').trim().toLowerCase()] || null
}

function resolveInsideActiveRoot (activeRoot, relativePath) {
  const root = path.resolve(activeRoot)
  const relative = portable(relativePath)
  if (!relative || path.isAbsolute(relativePath) || relative.split('/').includes('..')) {
    const error = new Error(`GOVERNANCE_LEDGER_PATH_INVALID: ${relativePath}`)
    error.code = 'GOVERNANCE_LEDGER_PATH_INVALID'
    throw error
  }
  const target = path.resolve(root, ...relative.split('/'))
  const rootWithSeparator = `${root}${path.sep}`
  const comparableRoot = process.platform === 'win32' ? rootWithSeparator.toLowerCase() : rootWithSeparator
  const comparableTarget = process.platform === 'win32' ? target.toLowerCase() : target
  if (!comparableTarget.startsWith(comparableRoot)) {
    const error = new Error(`GOVERNANCE_LEDGER_PATH_OUTSIDE_ACTIVE_ROOT: ${relativePath}`)
    error.code = 'GOVERNANCE_LEDGER_PATH_OUTSIDE_ACTIVE_ROOT'
    throw error
  }
  return target
}

function governanceLedgerPaths (activeRoot) {
  return {
    manifest: resolveInsideActiveRoot(activeRoot, MANIFEST_RELATIVE_PATH),
    index: resolveInsideActiveRoot(activeRoot, INDEX_RELATIVE_PATH),
    transaction: resolveInsideActiveRoot(activeRoot, TRANSACTION_RELATIVE_PATH)
  }
}

function fileExists (file, fsImpl = fs) {
  try { return fsImpl.statSync(file).isFile() } catch { return false }
}

function readJson (file, fsImpl = fs) {
  return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
}

function manifestDigest (manifest) {
  return sha256(stableStringify(manifest))
}

function createLegacyEquivalentManifest (activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const ledgerFamilies = {}
  for (const definition of Object.values(LEDGER_DEFINITIONS)) {
    const file = resolveInsideActiveRoot(activeRoot, definition.activePath)
    const integrity = fileExists(file, fsImpl)
      ? inspectGovernanceLedgerFile(file, { expectedPrefix: definition.prefix })
      : null
    ledgerFamilies[definition.kind] = {
      kind: definition.kind,
      prefix: definition.prefix,
      activePath: definition.activePath,
      nextSequence: Math.max(1, Number(integrity?.maxSequence || 0) + 1),
      shards: [],
      reopenedOverlays: []
    }
  }
  return {
    schemaVersion: MANIFEST_SCHEMA,
    manifestRevision: 1,
    ledgerFamilies
  }
}

function inspectGovernanceLedgerManifest (activeRoot, manifest, options = {}) {
  const fsImpl = options.fs || fs
  const requireAll = options.requireAll === true
  const verifyDigests = options.verifyDigests !== false
  const issues = []
  const documents = []
  const recordsById = new Map()

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { schemaVersion: 'GovernanceLedgerManifestInspectionV1', valid: false, issues: ['manifest-not-object'], documents: [] }
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) issues.push('manifest-schema-unsupported')
  if (!Number.isInteger(manifest.manifestRevision) || manifest.manifestRevision < 1) issues.push('manifest-revision-invalid')
  if (!manifest.ledgerFamilies || typeof manifest.ledgerFamilies !== 'object' || Array.isArray(manifest.ledgerFamilies)) {
    issues.push('ledger-families-invalid')
  }

  for (const definition of Object.values(LEDGER_DEFINITIONS)) {
    const family = manifest.ledgerFamilies?.[definition.kind]
    if (!family || typeof family !== 'object' || Array.isArray(family)) {
      issues.push(`ledger-family-missing:${definition.kind}`)
      continue
    }
    if (family.kind !== definition.kind) issues.push(`ledger-kind-mismatch:${definition.kind}`)
    if (family.prefix !== definition.prefix) issues.push(`ledger-prefix-mismatch:${definition.kind}`)
    if (portable(family.activePath) !== definition.activePath) issues.push(`ledger-active-path-mismatch:${definition.kind}`)
    if (!Number.isInteger(family.nextSequence) || family.nextSequence < 1) issues.push(`ledger-next-sequence-invalid:${definition.kind}`)
    if (!Array.isArray(family.shards)) issues.push(`ledger-shards-invalid:${definition.kind}`)
    if (!Array.isArray(family.reopenedOverlays)) issues.push(`ledger-overlays-invalid:${definition.kind}`)

    const familyDocuments = [{
      kind: definition.kind,
      role: 'active',
      relativePath: portable(family.activePath),
      immutable: false,
      expectedDigest: null
    }]
    const shardPaths = new Set()
    for (const shard of Array.isArray(family.shards) ? family.shards : []) {
      const relativePath = portable(shard?.path)
      if (!relativePath || shardPaths.has(relativePath)) issues.push(`ledger-shard-path-duplicate:${definition.kind}:${relativePath}`)
      shardPaths.add(relativePath)
      if (!relativePath.startsWith(`${definition.archiveDirectory}/`)) issues.push(`ledger-shard-path-invalid:${definition.kind}:${relativePath}`)
      if (shard?.immutable !== true) issues.push(`ledger-shard-mutable:${definition.kind}:${relativePath}`)
      if (!/^[a-f0-9]{64}$/.test(String(shard?.digest || ''))) issues.push(`ledger-shard-digest-invalid:${definition.kind}:${relativePath}`)
      if (!Array.isArray(shard?.ids) || !shard.ids.length) issues.push(`ledger-shard-ids-invalid:${definition.kind}:${relativePath}`)
      familyDocuments.push({
        kind: definition.kind,
        role: 'archive',
        relativePath,
        immutable: true,
        expectedDigest: shard?.digest || null,
        declaredIds: Array.isArray(shard?.ids) ? shard.ids.map(value => String(value).toUpperCase()) : []
      })
    }

    let familyMaxSequence = 0
    for (const document of familyDocuments) {
      let file
      try { file = resolveInsideActiveRoot(activeRoot, document.relativePath) } catch (error) {
        issues.push(`ledger-document-path-invalid:${definition.kind}:${document.relativePath}`)
        continue
      }
      if (!fileExists(file, fsImpl)) {
        if (requireAll || document.role === 'archive') issues.push(`ledger-document-missing:${definition.kind}:${document.relativePath}`)
        continue
      }
      const bytes = fsImpl.readFileSync(file)
      const integrity = inspectGovernanceLedgerBuffer(bytes, {
        expectedPrefix: definition.prefix,
        exactHeadingLevel: document.role === 'archive' ? 2 : undefined
      })
      const digest = sha256(bytes)
      if (!integrity.valid) {
        for (const issue of integrity.issues) issues.push(`ledger-integrity:${definition.kind}:${document.relativePath}:${issue}`)
      }
      if (document.expectedDigest && verifyDigests && digest !== document.expectedDigest) {
        issues.push(`ledger-shard-digest-mismatch:${definition.kind}:${document.relativePath}`)
      }
      if (document.declaredIds) {
        const actual = [...integrity.primaryIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        const declared = [...document.declaredIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        if (stableStringify(actual) !== stableStringify(declared)) {
          issues.push(`ledger-shard-id-drift:${definition.kind}:${document.relativePath}`)
        }
      }
      for (const id of integrity.primaryIds) {
        const sequence = Number(id.match(/\d+$/)?.[0] || 0)
        familyMaxSequence = Math.max(familyMaxSequence, sequence)
        if (!recordsById.has(id)) recordsById.set(id, [])
        recordsById.get(id).push({ kind: definition.kind, role: document.role, relativePath: document.relativePath })
      }
      documents.push({ ...document, file, digest, integrity })
    }

    if (Number.isInteger(family.nextSequence) && family.nextSequence <= familyMaxSequence) {
      issues.push(`ledger-next-sequence-not-monotonic:${definition.kind}`)
    }
  }

  const overlaysById = new Map()
  for (const family of Object.values(manifest.ledgerFamilies || {})) {
    for (const overlay of Array.isArray(family?.reopenedOverlays) ? family.reopenedOverlays : []) {
      const id = String(overlay?.id || '').toUpperCase()
      if (!id || overlaysById.has(id)) issues.push(`ledger-overlay-duplicate:${id || 'missing'}`)
      else overlaysById.set(id, portable(overlay.historicalShard))
    }
  }

  for (const [id, occurrences] of recordsById) {
    if (occurrences.length < 2) continue
    const overlayShard = overlaysById.get(id)
    const active = occurrences.filter(item => item.role === 'active')
    const archives = occurrences.filter(item => item.role === 'archive')
    const validOverlay = occurrences.length === 2 && active.length === 1 && archives.length === 1 && archives[0].relativePath === overlayShard
    if (!validOverlay) issues.push(`ledger-primary-id-duplicate:${id}`)
  }

  for (const [id, historicalShard] of overlaysById) {
    const occurrences = recordsById.get(id) || []
    if (!occurrences.some(item => item.role === 'active') || !occurrences.some(item => item.role === 'archive' && item.relativePath === historicalShard)) {
      issues.push(`ledger-overlay-reference-invalid:${id}`)
    }
  }

  return {
    schemaVersion: 'GovernanceLedgerManifestInspectionV1',
    valid: issues.length === 0,
    issues,
    manifestDigest: manifestDigest(manifest),
    documentCount: documents.length,
    recordCount: recordsById.size,
    documents
  }
}

function loadGovernanceLedgerManifest (activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const paths = governanceLedgerPaths(activeRoot)
  if (!options.allowInProgress && fileExists(paths.transaction, fsImpl)) {
    const error = new Error(`GOVERNANCE_LEDGER_MIGRATION_IN_PROGRESS: ${paths.transaction}`)
    error.code = 'GOVERNANCE_LEDGER_MIGRATION_IN_PROGRESS'
    throw error
  }
  if (!fileExists(paths.manifest, fsImpl)) {
    if (options.allowLegacyFallback === false) {
      const error = new Error(`GOVERNANCE_LEDGER_MANIFEST_MISSING: ${paths.manifest}`)
      error.code = 'GOVERNANCE_LEDGER_MANIFEST_MISSING'
      throw error
    }
    const manifest = createLegacyEquivalentManifest(activeRoot, { fs: fsImpl })
    const inspection = inspectGovernanceLedgerManifest(activeRoot, manifest, { fs: fsImpl, requireAll: false })
    return { origin: 'legacy-fallback', manifest, inspection, file: paths.manifest }
  }
  let manifest
  try { manifest = readJson(paths.manifest, fsImpl) } catch (error) {
    const wrapped = new Error(`GOVERNANCE_LEDGER_MANIFEST_READ_FAILED: ${error.message}`)
    wrapped.code = 'GOVERNANCE_LEDGER_MANIFEST_READ_FAILED'
    throw wrapped
  }
  const inspection = inspectGovernanceLedgerManifest(activeRoot, manifest, { fs: fsImpl, requireAll: true })
  if (!inspection.valid) {
    const error = new Error(`GOVERNANCE_LEDGER_MANIFEST_INVALID: ${inspection.issues.join(', ')}`)
    error.code = 'GOVERNANCE_LEDGER_MANIFEST_INVALID'
    error.inspection = inspection
    throw error
  }
  return { origin: 'manifest', manifest, inspection, file: paths.manifest }
}

function resolveGovernanceLedgerFamily (activeRoot, kind, options = {}) {
  const normalizedKind = normalizeLedgerKind(kind)
  if (!normalizedKind) {
    const error = new Error(`GOVERNANCE_LEDGER_KIND_UNSUPPORTED: ${kind}`)
    error.code = 'GOVERNANCE_LEDGER_KIND_UNSUPPORTED'
    throw error
  }
  const loaded = options.loaded || loadGovernanceLedgerManifest(activeRoot, options)
  const documents = loaded.inspection.documents
    .filter(document => document.kind === normalizedKind)
    .sort((left, right) => left.role === right.role
      ? left.relativePath.localeCompare(right.relativePath)
      : (left.role === 'active' ? -1 : 1))
  return {
    schemaVersion: 'GovernanceLedgerResolutionV1',
    kind: normalizedKind,
    origin: loaded.origin,
    manifestFile: loaded.file,
    manifestDigest: loaded.inspection.manifestDigest,
    family: loaded.manifest.ledgerFamilies[normalizedKind],
    documents
  }
}

function resolveAllGovernanceLedgerFamilies (activeRoot, options = {}) {
  const loaded = options.loaded || loadGovernanceLedgerManifest(activeRoot, options)
  return Object.keys(LEDGER_DEFINITIONS).map(kind => resolveGovernanceLedgerFamily(activeRoot, kind, { ...options, loaded }))
}

function writeFileAtomic (file, content, fsImpl = fs) {
  const directory = path.dirname(file)
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  fsImpl.mkdirSync(directory, { recursive: true })
  fsImpl.writeFileSync(temporary, content)
  try { fsImpl.renameSync(temporary, file) } catch (error) {
    try { fsImpl.unlinkSync(temporary) } catch {}
    throw error
  }
}

function acquireManifestLock (activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const lockFile = `${governanceLedgerPaths(activeRoot).manifest}.lock`
  fsImpl.mkdirSync(path.dirname(lockFile), { recursive: true })
  let descriptor
  try {
    descriptor = fsImpl.openSync(lockFile, 'wx')
    fsImpl.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`)
  } catch (error) {
    const wrapped = new Error(`GOVERNANCE_LEDGER_MANIFEST_LOCKED: ${lockFile}`)
    wrapped.code = 'GOVERNANCE_LEDGER_MANIFEST_LOCKED'
    throw wrapped
  }
  return {
    file: lockFile,
    release () {
      try { fsImpl.closeSync(descriptor) } catch {}
      try { fsImpl.unlinkSync(lockFile) } catch {}
    }
  }
}

function writeGovernanceLedgerManifestAtomic (activeRoot, manifest, options = {}) {
  const fsImpl = options.fs || fs
  const inspection = inspectGovernanceLedgerManifest(activeRoot, manifest, { fs: fsImpl, requireAll: true })
  if (!inspection.valid) {
    const error = new Error(`GOVERNANCE_LEDGER_MANIFEST_INVALID: ${inspection.issues.join(', ')}`)
    error.code = 'GOVERNANCE_LEDGER_MANIFEST_INVALID'
    error.inspection = inspection
    throw error
  }
  const file = governanceLedgerPaths(activeRoot).manifest
  if (options.expectedDigest) {
    if (!fileExists(file, fsImpl)) {
      const error = new Error('GOVERNANCE_LEDGER_MANIFEST_STALE: manifest missing')
      error.code = 'GOVERNANCE_LEDGER_MANIFEST_STALE'
      throw error
    }
    const current = readJson(file, fsImpl)
    if (manifestDigest(current) !== options.expectedDigest) {
      const error = new Error('GOVERNANCE_LEDGER_MANIFEST_STALE: digest mismatch')
      error.code = 'GOVERNANCE_LEDGER_MANIFEST_STALE'
      throw error
    }
  }
  writeFileAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`, fsImpl)
  return { file, manifestDigest: manifestDigest(manifest), inspection }
}

function initializeGovernanceLedgerManifest (activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const lock = acquireManifestLock(activeRoot, { fs: fsImpl })
  try {
    const file = governanceLedgerPaths(activeRoot).manifest
    if (fileExists(file, fsImpl)) {
      const loaded = loadGovernanceLedgerManifest(activeRoot, { fs: fsImpl })
      return { status: 'existing', file, manifestDigest: loaded.inspection.manifestDigest, manifest: loaded.manifest }
    }
    const manifest = createLegacyEquivalentManifest(activeRoot, { fs: fsImpl })
    const written = writeGovernanceLedgerManifestAtomic(activeRoot, manifest, { fs: fsImpl })
    return { status: 'initialized', ...written, manifest }
  } finally {
    lock.release()
  }
}

function allocateGovernanceRecordId (activeRoot, kind, options = {}) {
  const fsImpl = options.fs || fs
  const normalizedKind = normalizeLedgerKind(kind)
  if (!normalizedKind) {
    const error = new Error(`GOVERNANCE_LEDGER_KIND_UNSUPPORTED: ${kind}`)
    error.code = 'GOVERNANCE_LEDGER_KIND_UNSUPPORTED'
    throw error
  }
  const lock = acquireManifestLock(activeRoot, { fs: fsImpl })
  try {
    const loaded = loadGovernanceLedgerManifest(activeRoot, { fs: fsImpl, allowLegacyFallback: false })
    if (options.expectedManifestDigest && loaded.inspection.manifestDigest !== options.expectedManifestDigest) {
      const error = new Error('GOVERNANCE_LEDGER_MANIFEST_STALE: allocation digest mismatch')
      error.code = 'GOVERNANCE_LEDGER_MANIFEST_STALE'
      throw error
    }
    const manifest = JSON.parse(JSON.stringify(loaded.manifest))
    const family = manifest.ledgerFamilies[normalizedKind]
    const sequence = family.nextSequence
    const id = `${family.prefix}${String(sequence).padStart(3, '0')}`
    family.nextSequence += 1
    manifest.manifestRevision += 1
    const written = writeGovernanceLedgerManifestAtomic(activeRoot, manifest, {
      fs: fsImpl,
      expectedDigest: loaded.inspection.manifestDigest
    })
    return {
      schemaVersion: 'GovernanceLedgerIdAllocationReceiptV1',
      kind: normalizedKind,
      id,
      sequence,
      manifestRevision: manifest.manifestRevision,
      manifestDigest: written.manifestDigest
    }
  } finally {
    lock.release()
  }
}

function normalizeRecordStatus (value) {
  const text = String(value || '').toLowerCase()
  if (/partial|residual|部分|进行中|pending|待处理|待确认|waiting|blocked/.test(text)) return 'partial'
  if (/\b(?:closed|completed|absorbed|released|resolved|fixed)\b|已关闭|已完成|已吸纳|已发布|已修复|✅/.test(text)) return 'closed'
  if (/\b(?:open|todo|recorded|not-started)\b|未开始|🔄/.test(text)) return 'open'
  if (/deferred|postponed|延期|延后/.test(text)) return 'deferred'
  return 'unknown'
}

function parseLedgerRecords (content, document, definition) {
  const lines = String(content || '').split(/\r?\n/)
  const records = []
  const seen = new Set()
  const idPattern = definition.kind === 'ISSUE' ? 'ISSUE' : definition.kind
  const tablePattern = new RegExp(`^\\|\\s*(${idPattern}-\\d{3,})\\s*\\|`, 'i')
  const headingPattern = new RegExp(`^${document.role === 'archive' ? '##' : '#{2,}'}\\s+(${idPattern}-\\d{3,})(?:\\s|$)`, 'i')
  const integrity = inspectGovernanceLedgerBuffer(Buffer.from(String(content || ''), 'utf8'), {
    expectedPrefix: definition.prefix,
    exactHeadingLevel: document.role === 'archive' ? 2 : undefined
  })
  const primaryIds = new Set(integrity.primaryIds)
  for (let index = 0; index < lines.length; index += 1) {
    const table = lines[index].match(tablePattern)
    const heading = lines[index].match(headingPattern)
    const match = heading || table
    if (!match) continue
    const id = match[1].toUpperCase()
    if (!primaryIds.has(id) || seen.has(id)) continue
    seen.add(id)
    let statusText = lines[index]
    if (heading) {
      let end = lines.length
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^##\s+/.test(lines[cursor])) { end = cursor; break }
      }
      const statusLine = lines.slice(index, end).find(line => /^\s*-\s*状态[:：]/.test(line))
      if (statusLine) statusText = statusLine
    }
    records.push({
      id,
      kind: definition.kind,
      status: normalizeRecordStatus(statusText),
      sourcePath: document.relativePath,
      sourceRole: document.role,
      line: index + 1
    })
  }
  return records
}

function buildGovernanceLedgerIndex (activeRoot, options = {}) {
  const loaded = options.loaded || loadGovernanceLedgerManifest(activeRoot, options)
  const sources = []
  const occurrences = new Map()
  for (const document of loaded.inspection.documents) {
    const definition = LEDGER_DEFINITIONS[document.kind]
    const content = (options.fs || fs).readFileSync(document.file, 'utf8')
    const records = parseLedgerRecords(content, document, definition)
    sources.push({
      kind: document.kind,
      role: document.role,
      path: document.relativePath,
      digest: document.digest,
      recordCount: records.length
    })
    for (const record of records) {
      if (!occurrences.has(record.id)) occurrences.set(record.id, [])
      occurrences.get(record.id).push(record)
    }
  }
  const records = [...occurrences.entries()].map(([id, values]) => {
    const ordered = [...values].sort((left, right) => left.sourceRole === right.sourceRole
      ? left.sourcePath.localeCompare(right.sourcePath)
      : (left.sourceRole === 'active' ? -1 : 1))
    return { ...ordered[0], history: ordered.slice(1) }
  }).sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
  return {
    schemaVersion: INDEX_SCHEMA,
    authority: 'derived-from-governance-ledger-manifest',
    manifestDigest: loaded.inspection.manifestDigest,
    sourceCount: sources.length,
    recordCount: records.length,
    sources: sources.sort((left, right) => left.kind.localeCompare(right.kind) || left.role.localeCompare(right.role) || left.path.localeCompare(right.path)),
    records
  }
}

function writeGovernanceLedgerIndex (activeRoot, index, options = {}) {
  const fsImpl = options.fs || fs
  const file = governanceLedgerPaths(activeRoot).index
  writeFileAtomic(file, `${JSON.stringify(index, null, 2)}\n`, fsImpl)
  const readback = readJson(file, fsImpl)
  if (stableStringify(readback) !== stableStringify(index)) {
    const error = new Error('GOVERNANCE_LEDGER_INDEX_READBACK_FAILED')
    error.code = 'GOVERNANCE_LEDGER_INDEX_READBACK_FAILED'
    throw error
  }
  return { file, digest: sha256(stableStringify(index)), recordCount: index.recordCount }
}

function rebuildGovernanceLedgerIndex (activeRoot, options = {}) {
  const index = buildGovernanceLedgerIndex(activeRoot, options)
  return { index, receipt: writeGovernanceLedgerIndex(activeRoot, index, options) }
}

module.exports = {
  INDEX_RELATIVE_PATH,
  INDEX_SCHEMA,
  LEDGER_DEFINITIONS,
  MANIFEST_RELATIVE_PATH,
  MANIFEST_SCHEMA,
  TRANSACTION_RELATIVE_PATH,
  acquireManifestLock,
  allocateGovernanceRecordId,
  buildGovernanceLedgerIndex,
  createLegacyEquivalentManifest,
  governanceLedgerPaths,
  initializeGovernanceLedgerManifest,
  inspectGovernanceLedgerManifest,
  loadGovernanceLedgerManifest,
  manifestDigest,
  normalizeLedgerKind,
  normalizeRecordStatus,
  parseLedgerRecords,
  rebuildGovernanceLedgerIndex,
  resolveAllGovernanceLedgerFamilies,
  resolveGovernanceLedgerFamily,
  resolveInsideActiveRoot,
  sha256,
  stableStringify,
  writeFileAtomic,
  writeGovernanceLedgerIndex,
  writeGovernanceLedgerManifestAtomic
}
