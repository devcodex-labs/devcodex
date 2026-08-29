'use strict'

const fs = require('fs')
const path = require('path')
const {
  acquireManifestLock,
  governanceLedgerPaths,
  loadGovernanceLedgerManifest,
  manifestDigest,
  rebuildGovernanceLedgerIndex,
  resolveInsideActiveRoot,
  sha256,
  stableStringify,
  writeFileAtomic,
  writeGovernanceLedgerManifestAtomic
} = require('./governance-ledger-resolver.js')

const PLAN_SCHEMA = 'GovernanceLedgerMigrationPlanV1'
const RECEIPT_SCHEMA = 'GovernanceLedgerMigrationReceiptV1'
const TRANSACTION_SCHEMA = 'GovernanceLedgerMigrationTransactionV1'
const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const MAX_CANDIDATES = 100

function numericId (id) {
  return Number(String(id || '').match(/\d+$/)?.[0] || 0)
}

function isTerminalGapStatus (value) {
  const status = String(value || '').trim().toLowerCase()
  if (!status || /partial(?:ly)?-?closed|residual|部分关闭|部分完成/.test(status)) return false
  return /\b(?:closed|completed|absorbed|released)\b|已关闭|已完成|已吸纳|已发布/.test(status)
}

function parseGapRegistrySections (content) {
  const text = String(content || '')
  const headings = [...text.matchAll(/^##\s+([^\r\n]+)$/gm)].map(match => ({
    title: match[1],
    start: match.index,
    heading: match[0]
  }))
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? text.length
    const section = text.slice(heading.start, end)
    const id = heading.title.match(/^(GR-\d{3,})(?:\s|$)/i)?.[1]?.toUpperCase() || null
    const date = section.match(/^\s*-\s*日期[:：]\s*(\d{4})-(\d{2})-(\d{2})\s*$/mi)
    const status = section.match(/^\s*-\s*状态[:：]\s*(.+)$/mi)?.[1]?.trim() || ''
    const containedPrimaryIds = [...section.matchAll(/^(?:\|\s*(GR-\d{3,})\s*\|\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\s*\||#{2,}\s+(GR-\d{3,})(?:\s|$))/gmi)]
      .map(match => String(match[1] || match[2]).toUpperCase())
    const foreignPrimaryIds = [...new Set(containedPrimaryIds.filter(value => value !== id))]
    const terminalStatus = Boolean(id && date && isTerminalGapStatus(status))
    return {
      ...heading,
      end,
      section,
      id,
      date: date ? `${date[1]}-${date[2]}-${date[3]}` : null,
      year: date ? Number(date[1]) : null,
      status,
      terminalStatus,
      selfContained: foreignPrimaryIds.length === 0,
      foreignPrimaryIds,
      terminal: terminalStatus && foreignPrimaryIds.length === 0
    }
  })
}

function archiveContent (year, sections, eol) {
  const body = sections.map(section => section.section.trim()).join(`${eol}${eol}`)
  return [
    `# 维度盲区 / 检测盲点登记归档（${year}）`,
    '',
    '> GovernanceLedgerManifestV1 管理的不可变归档分片；活动记录与 reopened overlay 仍写入 `data/gap-registry.md`。',
    '',
    '## 登记表',
    '',
    '| 编号 | 日期 | 归档状态 |',
    '|---|---|---|',
    ...sections.map(section => `| ${section.id} | ${section.date} | archived-terminal |`),
    '',
    body,
    ''
  ].join(eol)
}

function removeSections (content, sections) {
  let cursor = 0
  const pieces = []
  for (const section of [...sections].sort((left, right) => left.start - right.start)) {
    pieces.push(content.slice(cursor, section.start))
    cursor = section.end
  }
  pieces.push(content.slice(cursor))
  return pieces.join('')
}

function prepareGapRegistryMigration (activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const loaded = loadGovernanceLedgerManifest(activeRoot, {
    fs: fsImpl,
    allowLegacyFallback: false,
    allowInProgress: options.allowInProgress === true
  })
  const family = loaded.manifest.ledgerFamilies.GR
  const activeFile = resolveInsideActiveRoot(activeRoot, family.activePath)
  const sourceBytes = fsImpl.readFileSync(activeFile)
  if (sourceBytes.length > MAX_SOURCE_BYTES) {
    const error = new Error(`GOVERNANCE_LEDGER_MIGRATION_SOURCE_TOO_LARGE: ${sourceBytes.length}`)
    error.code = 'GOVERNANCE_LEDGER_MIGRATION_SOURCE_TOO_LARGE'
    throw error
  }
  const sourceContent = sourceBytes.toString('utf8')
  const sourceDigest = sha256(sourceBytes)
  const eol = sourceContent.includes('\r\n') ? '\r\n' : '\n'
  const sections = parseGapRegistrySections(sourceContent)
  const candidates = sections.filter(section => section.terminal)
  const excludedNonSelfContained = sections
    .filter(section => section.terminalStatus && !section.selfContained)
    .map(section => ({ id: section.id, foreignPrimaryIds: section.foreignPrimaryIds }))
  if (candidates.length > MAX_CANDIDATES) {
    const error = new Error(`GOVERNANCE_LEDGER_MIGRATION_CANDIDATE_LIMIT: ${candidates.length} > ${MAX_CANDIDATES}`)
    error.code = 'GOVERNANCE_LEDGER_MIGRATION_CANDIDATE_LIMIT'
    throw error
  }
  const byYear = new Map()
  for (const candidate of candidates) {
    if (!byYear.has(candidate.year)) byYear.set(candidate.year, [])
    byYear.get(candidate.year).push(candidate)
  }
  const shardArtifacts = [...byYear.entries()].sort(([left], [right]) => left - right).map(([year, yearSections]) => {
    const orderedIds = yearSections.map(section => section.id).sort((left, right) => numericId(left) - numericId(right))
    const firstId = orderedIds[0]
    const lastId = orderedIds.at(-1)
    const lastSequence = String(numericId(lastId)).padStart(3, '0')
    const content = archiveContent(year, yearSections, eol)
    const digest = sha256(Buffer.from(content, 'utf8'))
    const baseName = `${firstId}--${lastSequence}`
    const basePath = `data/archive/gap-registry/${year}/${baseName}.md`
    const baseFile = resolveInsideActiveRoot(activeRoot, basePath)
    const relativePath = fsImpl.existsSync(baseFile) && sha256(fsImpl.readFileSync(baseFile)) !== digest
      ? `data/archive/gap-registry/${year}/${baseName}-${digest.slice(0, 12)}.md`
      : basePath
    return {
      relativePath,
      content,
      manifestEntry: {
        path: relativePath,
        year,
        firstId,
        lastId,
        ids: orderedIds,
        digest,
        immutable: true
      }
    }
  })
  const retainedContent = removeSections(sourceContent, candidates)
  const rollbackPath = `data/archive/gap-registry/rollback/${sourceDigest}.md`
  const planCore = {
    schemaVersion: PLAN_SCHEMA,
    operation: 'gap-registry-pilot',
    ledgerKind: 'GR',
    activeRootDigest: sha256(Buffer.from(path.resolve(activeRoot).toLowerCase(), 'utf8')),
    manifestDigest: loaded.inspection.manifestDigest,
    source: {
      path: family.activePath,
      digest: sourceDigest,
      bytes: sourceBytes.length
    },
    candidateCount: candidates.length,
    candidateIds: candidates.map(section => section.id),
    excludedNonSelfContained,
    retained: {
      digest: sha256(Buffer.from(retainedContent, 'utf8')),
      bytes: Buffer.byteLength(retainedContent, 'utf8')
    },
    rollbackSource: {
      path: rollbackPath,
      digest: sourceDigest
    },
    shards: shardArtifacts.map(artifact => ({
      path: artifact.manifestEntry.path,
      year: artifact.manifestEntry.year,
      firstId: artifact.manifestEntry.firstId,
      lastId: artifact.manifestEntry.lastId,
      ids: artifact.manifestEntry.ids,
      digest: artifact.manifestEntry.digest,
      bytes: Buffer.byteLength(artifact.content, 'utf8')
    }))
  }
  const planDigest = sha256(Buffer.from(stableStringify(planCore), 'utf8'))
  return {
    plan: { ...planCore, planDigest },
    artifacts: {
      sourceBytes,
      retainedContent,
      candidates,
      shardArtifacts
    },
    loaded
  }
}

function buildGapRegistryMigrationPlan (activeRoot, options = {}) {
  return prepareGapRegistryMigration(activeRoot, options).plan
}

function ensureExactFile (activeRoot, relativePath, content, expectedDigest, fsImpl) {
  const file = resolveInsideActiveRoot(activeRoot, relativePath)
  if (fsImpl.existsSync(file)) {
    const currentDigest = sha256(fsImpl.readFileSync(file))
    if (currentDigest !== expectedDigest) {
      const error = new Error(`GOVERNANCE_LEDGER_ARCHIVE_CONFLICT: ${relativePath}`)
      error.code = 'GOVERNANCE_LEDGER_ARCHIVE_CONFLICT'
      throw error
    }
    return { file, status: 'reused' }
  }
  writeFileAtomic(file, content, fsImpl)
  const readbackDigest = sha256(fsImpl.readFileSync(file))
  if (readbackDigest !== expectedDigest) {
    const error = new Error(`GOVERNANCE_LEDGER_ARCHIVE_READBACK_FAILED: ${relativePath}`)
    error.code = 'GOVERNANCE_LEDGER_ARCHIVE_READBACK_FAILED'
    throw error
  }
  return { file, status: 'written' }
}

function writeTransaction (activeRoot, transaction, fsImpl) {
  const file = governanceLedgerPaths(activeRoot).transaction
  writeFileAtomic(file, `${JSON.stringify(transaction, null, 2)}\n`, fsImpl)
  return file
}

function removeTransaction (activeRoot, fsImpl) {
  const file = governanceLedgerPaths(activeRoot).transaction
  try { fsImpl.unlinkSync(file) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function applyGapRegistryMigration (activeRoot, planDigest, options = {}) {
  const fsImpl = options.fs || fs
  if (!/^[a-f0-9]{64}$/.test(String(planDigest || ''))) {
    const error = new Error('GOVERNANCE_LEDGER_MIGRATION_PLAN_REQUIRED')
    error.code = 'GOVERNANCE_LEDGER_MIGRATION_PLAN_REQUIRED'
    throw error
  }
  const lock = acquireManifestLock(activeRoot, { fs: fsImpl })
  let transactionWritten = false
  let manifestCommitted = false
  let prepared
  let rollbackWrite = null
  let shardWrites = []
  try {
    prepared = prepareGapRegistryMigration(activeRoot, { fs: fsImpl })
    if (prepared.plan.planDigest !== planDigest) {
      const error = new Error('GOVERNANCE_LEDGER_MIGRATION_PLAN_STALE')
      error.code = 'GOVERNANCE_LEDGER_MIGRATION_PLAN_STALE'
      throw error
    }
    if (!prepared.plan.candidateCount) {
      return {
        schemaVersion: RECEIPT_SCHEMA,
        operation: 'gap-registry-pilot-apply',
        status: 'noop',
        planDigest,
        candidateCount: 0,
        candidateIds: [],
        manifestDigest: prepared.loaded.inspection.manifestDigest
      }
    }

    rollbackWrite = ensureExactFile(
      activeRoot,
      prepared.plan.rollbackSource.path,
      prepared.artifacts.sourceBytes,
      prepared.plan.rollbackSource.digest,
      fsImpl
    )
    shardWrites = prepared.artifacts.shardArtifacts.map(artifact => ensureExactFile(
      activeRoot,
      artifact.relativePath,
      artifact.content,
      artifact.manifestEntry.digest,
      fsImpl
    ))

    const transaction = {
      schemaVersion: TRANSACTION_SCHEMA,
      operation: 'gap-registry-pilot-apply',
      phase: 'prepared',
      planDigest,
      sourceDigest: prepared.plan.source.digest,
      manifestDigest: prepared.plan.manifestDigest
    }
    writeTransaction(activeRoot, transaction, fsImpl)
    transactionWritten = true

    const activeFile = resolveInsideActiveRoot(activeRoot, prepared.plan.source.path)
    writeFileAtomic(activeFile, prepared.artifacts.retainedContent, fsImpl)
    if (sha256(fsImpl.readFileSync(activeFile)) !== prepared.plan.retained.digest) {
      const error = new Error('GOVERNANCE_LEDGER_ACTIVE_READBACK_FAILED')
      error.code = 'GOVERNANCE_LEDGER_ACTIVE_READBACK_FAILED'
      throw error
    }

    const nextManifest = JSON.parse(JSON.stringify(prepared.loaded.manifest))
    const family = nextManifest.ledgerFamilies.GR
    const previousShards = family.shards
    const additions = prepared.artifacts.shardArtifacts.map(artifact => artifact.manifestEntry)
    family.shards = [...previousShards, ...additions]
      .sort((left, right) => numericId(left.firstId) - numericId(right.firstId) || left.path.localeCompare(right.path))
    family.rollback = {
      planDigest,
      sourcePath: prepared.plan.rollbackSource.path,
      sourceDigest: prepared.plan.rollbackSource.digest,
      previousShards
    }
    nextManifest.manifestRevision += 1
    const manifestWrite = writeGovernanceLedgerManifestAtomic(activeRoot, nextManifest, {
      fs: fsImpl,
      expectedDigest: prepared.loaded.inspection.manifestDigest
    })
    manifestCommitted = true
    removeTransaction(activeRoot, fsImpl)
    transactionWritten = false
    const index = rebuildGovernanceLedgerIndex(activeRoot, { fs: fsImpl })
    return {
      schemaVersion: RECEIPT_SCHEMA,
      operation: 'gap-registry-pilot-apply',
      status: 'applied',
      planDigest,
      candidateCount: prepared.plan.candidateCount,
      candidateIds: prepared.plan.candidateIds,
      activePath: prepared.plan.source.path,
      retainedDigest: prepared.plan.retained.digest,
      rollbackSource: { ...prepared.plan.rollbackSource, writeStatus: rollbackWrite.status },
      shards: prepared.plan.shards.map((shard, indexPosition) => ({ ...shard, writeStatus: shardWrites[indexPosition].status })),
      manifestDigest: manifestWrite.manifestDigest,
      indexDigest: index.receipt.digest
    }
  } catch (error) {
    if (transactionWritten && prepared && !manifestCommitted) {
      try {
        const activeFile = resolveInsideActiveRoot(activeRoot, prepared.plan.source.path)
        writeFileAtomic(activeFile, prepared.artifacts.sourceBytes, fsImpl)
        removeTransaction(activeRoot, fsImpl)
        transactionWritten = false
        for (const write of shardWrites.filter(item => item.status === 'written')) {
          try { fsImpl.unlinkSync(write.file) } catch {}
        }
        if (rollbackWrite?.status === 'written') {
          try { fsImpl.unlinkSync(rollbackWrite.file) } catch {}
        }
      } catch (rollbackError) {
        error.rollbackError = rollbackError.message
      }
    } else if (transactionWritten && manifestCommitted) {
      try { removeTransaction(activeRoot, fsImpl) } catch {}
    }
    throw error
  } finally {
    lock.release()
  }
}

function rollbackGapRegistryMigration (activeRoot, planDigest, options = {}) {
  const fsImpl = options.fs || fs
  const lock = acquireManifestLock(activeRoot, { fs: fsImpl })
  let transactionWritten = false
  let manifestCommitted = false
  let activeFile = null
  let currentActiveBytes = null
  try {
    const loaded = loadGovernanceLedgerManifest(activeRoot, { fs: fsImpl, allowLegacyFallback: false })
    const rollback = loaded.manifest.ledgerFamilies.GR.rollback
    if (!rollback) {
      return {
        schemaVersion: RECEIPT_SCHEMA,
        operation: 'gap-registry-pilot-rollback',
        status: 'noop',
        reason: 'rollback-not-available',
        manifestDigest: loaded.inspection.manifestDigest
      }
    }
    if (planDigest && rollback.planDigest !== planDigest) {
      const error = new Error('GOVERNANCE_LEDGER_ROLLBACK_PLAN_MISMATCH')
      error.code = 'GOVERNANCE_LEDGER_ROLLBACK_PLAN_MISMATCH'
      throw error
    }
    const sourceFile = resolveInsideActiveRoot(activeRoot, rollback.sourcePath)
    const sourceBytes = fsImpl.readFileSync(sourceFile)
    if (sha256(sourceBytes) !== rollback.sourceDigest) {
      const error = new Error('GOVERNANCE_LEDGER_ROLLBACK_SOURCE_DRIFT')
      error.code = 'GOVERNANCE_LEDGER_ROLLBACK_SOURCE_DRIFT'
      throw error
    }
    writeTransaction(activeRoot, {
      schemaVersion: TRANSACTION_SCHEMA,
      operation: 'gap-registry-pilot-rollback',
      phase: 'prepared',
      planDigest: rollback.planDigest,
      sourceDigest: rollback.sourceDigest,
      manifestDigest: loaded.inspection.manifestDigest
    }, fsImpl)
    transactionWritten = true
    const nextManifest = JSON.parse(JSON.stringify(loaded.manifest))
    const family = nextManifest.ledgerFamilies.GR
    activeFile = resolveInsideActiveRoot(activeRoot, family.activePath)
    currentActiveBytes = fsImpl.readFileSync(activeFile)
    writeFileAtomic(activeFile, sourceBytes, fsImpl)
    family.shards = rollback.previousShards
    delete family.rollback
    nextManifest.manifestRevision += 1
    const manifestWrite = writeGovernanceLedgerManifestAtomic(activeRoot, nextManifest, {
      fs: fsImpl,
      expectedDigest: loaded.inspection.manifestDigest
    })
    manifestCommitted = true
    removeTransaction(activeRoot, fsImpl)
    transactionWritten = false
    const index = rebuildGovernanceLedgerIndex(activeRoot, { fs: fsImpl })
    return {
      schemaVersion: RECEIPT_SCHEMA,
      operation: 'gap-registry-pilot-rollback',
      status: 'rolled-back',
      planDigest: rollback.planDigest,
      restoredDigest: rollback.sourceDigest,
      manifestDigest: manifestWrite.manifestDigest,
      indexDigest: index.receipt.digest,
      retainedShardPolicy: 'unreferenced-immutable-shards-kept'
    }
  } catch (error) {
    if (transactionWritten && !manifestCommitted && activeFile && currentActiveBytes) {
      try {
        writeFileAtomic(activeFile, currentActiveBytes, fsImpl)
        removeTransaction(activeRoot, fsImpl)
        transactionWritten = false
      } catch (recoveryError) {
        error.rollbackError = recoveryError.message
      }
    } else if (transactionWritten && manifestCommitted) {
      try {
        removeTransaction(activeRoot, fsImpl)
        transactionWritten = false
      } catch (cleanupError) {
        error.cleanupError = cleanupError.message
      }
    }
    throw error
  } finally {
    lock.release()
  }
}

module.exports = {
  MAX_CANDIDATES,
  MAX_SOURCE_BYTES,
  PLAN_SCHEMA,
  RECEIPT_SCHEMA,
  TRANSACTION_SCHEMA,
  applyGapRegistryMigration,
  buildGapRegistryMigrationPlan,
  isTerminalGapStatus,
  parseGapRegistrySections,
  prepareGapRegistryMigration,
  rollbackGapRegistryMigration
}
