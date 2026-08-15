'use strict'

const fs = require('fs')
const path = require('path')
const {
  buildContentIdentity
} = require('../../hooks/_runtime/content-identity.cjs')
const {
  buildQueryEnvelope,
  createDerivedIndexStore
} = require('./derived-index-contract.js')
const {
  currentActiveSessionIds,
  foldSummaryRows,
  rowsByCurrentState,
  summaryStateConflicts
} = require('./memory-summary-state.js')

const SUMMARY_CURRENT_SCHEMA = 'MemorySummaryCurrentPartitionV2'
const SUMMARY_STATUS_SCHEMA = 'MemorySummaryStatusPartitionV1'
const SUMMARY_MONTH_SCHEMA = 'MemorySummaryMonthPartitionV1'
const DAILY_SCHEMA = 'MemoryDailyPartitionV1'
const MEMORY_INDEX_RECEIPT_SCHEMA = 'MemoryIndexReceiptV1'
const SUMMARY_WINDOW = 50
const STATUS_WINDOW = 20
const STATUS_LIST_SENTINEL = STATUS_WINDOW + 1

function normalizeTarget(target) {
  if (!target || !String(target.activeRoot || '').trim() || !String(target.agent || '').trim()) {
    throw new Error('memory index target requires activeRoot and agent')
  }
  return {
    activeRoot: path.resolve(target.activeRoot),
    project: String(target.project || ''),
    scope: String(target.scope || 'project'),
    agent: String(target.agent)
  }
}

function assertSourceInside(activeRoot, filePath) {
  const absoluteRoot = path.resolve(activeRoot)
  const absolutePath = path.resolve(filePath)
  const relative = path.relative(absoluteRoot, absolutePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`memory source must stay below activeRoot: ${absolutePath}`)
  }
  return absolutePath
}

function sourceKey(target, kind, discriminator) {
  const project = target.project || 'workspace'
  return `memory://${project}/${target.agent}/${kind}/${discriminator}`
}

function sourceObservation(document) {
  return {
    path: document.path,
    exists: document.exists === true,
    bytes: Number(document.bytes || 0),
    chars: Number(document.chars || 0),
    modifiedAt: document.modifiedAt || null,
    mtimeMs: document.modifiedAt ? Date.parse(document.modifiedAt) : null
  }
}

function observeSource(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return { status: 'invalid', errorCode: 'MEMORY_INDEX_SOURCE_NOT_FILE' }
    return {
      status: 'observed',
      path: filePath,
      exists: true,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      mtimeMs: Math.trunc(stat.mtimeMs)
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        status: 'observed',
        path: filePath,
        exists: false,
        bytes: 0,
        modifiedAt: null,
        mtimeMs: null
      }
    }
    return { status: 'invalid', errorCode: 'MEMORY_INDEX_SOURCE_STAT_FAILED', message: error.message }
  }
}

function observationMatches(expected, observed) {
  return observed.status === 'observed' &&
    expected.path === observed.path &&
    expected.exists === observed.exists &&
    expected.bytes === observed.bytes &&
    expected.modifiedAt === observed.modifiedAt
}

function memorySourceIdentity(target, kind, discriminator, content) {
  return buildContentIdentity({
    sourceKey: sourceKey(target, kind, discriminator),
    content,
    contractVersion: '1'
  })
}

function summaryStore(target) {
  return createDerivedIndexStore({
    activeRoot: target.activeRoot,
    domain: 'memory',
    scopeIdentity: {
      project: target.project,
      scope: target.scope,
      agent: target.agent,
      source: 'summary'
    }
  })
}

function dailyStore(target, date) {
  return createDerivedIndexStore({
    activeRoot: target.activeRoot,
    domain: 'memory',
    scopeIdentity: {
      project: target.project,
      scope: target.scope,
      agent: target.agent,
      source: 'daily',
      date
    }
  })
}

function buildSummaryPartitions(document, parsed) {
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : []
  const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings : []
  const source = sourceObservation(document)
  const states = ['all', 'active', 'completed', 'blocked', 'unresolved']
  const byState = Object.fromEntries(states.map(state => [
    state,
    rowsByCurrentState(rows, state).slice(-SUMMARY_WINDOW)
  ]))
  const counts = Object.fromEntries(states.map(state => [state, rowsByCurrentState(rows, state).length]))
  const windowRows = [...new Map(Object.values(byState)
    .flat()
    .map(row => [row.rowNumber, row])).values()]
    .sort((left, right) => left.rowNumber - right.rowNumber)
  const current = {
    schemaVersion: SUMMARY_CURRENT_SCHEMA,
    source,
    windowRows,
    rowNumbersByState: Object.fromEntries(states.map(state => [
      state,
      byState[state].map(row => row.rowNumber)
    ])),
    counts,
    warnings
  }
  const status = {
    schemaVersion: SUMMARY_STATUS_SCHEMA,
    source,
    latestRows: rows.slice(-STATUS_WINDOW),
    activeSessionIds: currentActiveSessionIds(rows).slice(0, STATUS_LIST_SENTINEL),
    conflicts: summaryStateConflicts(rows).slice(0, STATUS_LIST_SENTINEL),
    nonCanonicalActiveCount: foldSummaryRows(rows).filter(row => row.state === 'active' && !row.sessionIdCanonical).length,
    warnings
  }
  const months = new Map()
  for (const row of rows) {
    const month = String(row.day || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    if (!months.has(month)) months.set(month, [])
    months.get(month).push(row)
  }
  return [
    {
      key: 'summary:status',
      payload: status,
      metadata: { kind: 'summary-status', rowCount: rows.length }
    },
    {
      key: 'summary:current',
      payload: current,
      metadata: { kind: 'summary-current', rowCount: rows.length }
    },
    ...[...months.entries()].map(([month, monthRows]) => ({
      key: `summary:${month}`,
      payload: {
        schemaVersion: SUMMARY_MONTH_SCHEMA,
        month,
        source,
        rows: monthRows
      },
      metadata: { kind: 'summary-month', month, rowCount: monthRows.length }
    }))
  ]
}

function sessionRanges(content) {
  const headings = []
  const expression = /^##\s+会话\s+([^\s—-]+)(?:\s*[-—]\s*(.*))?$/gm
  let match
  while ((match = expression.exec(String(content || ''))) !== null) {
    headings.push({
      id: match[1],
      startChar: match.index
    })
  }
  return headings.map((heading, index) => {
    const endChar = headings[index + 1]?.startChar ?? String(content || '').length
    return {
      id: heading.id,
      startChar: heading.startChar,
      endChar,
      startByte: Buffer.byteLength(String(content || '').slice(0, heading.startChar), 'utf8'),
      endByte: Buffer.byteLength(String(content || '').slice(0, endChar), 'utf8')
    }
  })
}

function buildDailyPartitions(document, date, parsed) {
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : []
  const ranges = sessionRanges(document.content)
  if (ranges.length !== sessions.length) {
    throw new Error(`daily parser/range mismatch: sessions=${sessions.length}, ranges=${ranges.length}`)
  }
  const source = sourceObservation(document)
  const descriptors = sessions.map((session, index) => ({
    ...(() => {
      const handoff = String(session.handoff || '')
      const handoffStartChar = handoff
        ? document.content.indexOf(handoff, ranges[index].startChar)
        : -1
      if (handoff && (handoffStartChar < ranges[index].startChar || handoffStartChar >= ranges[index].endChar)) {
        throw new Error(`daily handoff range mismatch for session ${session.sessionId}`)
      }
      return {
        date: session.date,
        sessionId: session.sessionId,
        title: session.title,
        status: session.status,
        state: session.state,
        ordinal: session.ordinal,
        hasHandoff: Boolean(handoff),
        startByte: ranges[index].startByte,
        endByte: ranges[index].endByte,
        startChar: ranges[index].startChar,
        endChar: ranges[index].endChar,
        handoffStartByte: handoff
          ? Buffer.byteLength(document.content.slice(0, handoffStartChar), 'utf8')
          : null,
        handoffEndByte: handoff
          ? Buffer.byteLength(document.content.slice(0, handoffStartChar + handoff.length), 'utf8')
          : null
      }
    })()
  }))
  return [{
    key: `daily:${date}`,
    payload: {
      schemaVersion: DAILY_SCHEMA,
      date,
      source,
      sessions: descriptors,
      warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : []
    },
    metadata: { kind: 'daily', date, sessionCount: descriptors.length }
  }]
}

function memoryRefreshReceipt(kind, sourceIdentity, commit, extra = {}) {
  return {
    schemaVersion: MEMORY_INDEX_RECEIPT_SCHEMA,
    kind,
    ...extra,
    status: commit.status,
    sourceIdentity,
    domain: commit.domain,
    scopeDigest: commit.scopeDigest,
    generation: commit.generation || null,
    pointerIdentity: commit.pointerIdentity || null,
    manifestIdentity: commit.manifestIdentity || null,
    readbackVerified: commit.readbackVerified === true,
    errorCode: commit.errorCode || null,
    message: commit.message || null,
    commitReceipt: commit
  }
}

function refreshSummaryIndex(input = {}) {
  const target = normalizeTarget(input.target)
  const filePath = assertSourceInside(target.activeRoot, input.document?.path)
  if (filePath !== input.document.path || typeof input.document.content !== 'string') {
    throw new Error('summary refresh requires an exact source document with content')
  }
  const sourceIdentity = memorySourceIdentity(target, 'summary', 'SUMMARY.md', input.document.content)
  const commit = summaryStore(target).commit({
    sourceIdentity,
    freshnessTier: input.freshnessTier || 'writer-attested',
    partitions: buildSummaryPartitions(input.document, input.parsed)
  })
  return memoryRefreshReceipt('summary', sourceIdentity, commit)
}

function refreshDailyIndex(input = {}) {
  const target = normalizeTarget(input.target)
  const date = String(input.date || '')
  if (!/^\d{8}$/.test(date)) throw new Error('daily refresh date must be YYYYMMDD')
  const filePath = assertSourceInside(target.activeRoot, input.document?.path)
  if (filePath !== input.document.path || typeof input.document.content !== 'string') {
    throw new Error('daily refresh requires an exact source document with content')
  }
  const sourceIdentity = memorySourceIdentity(target, 'daily', date, input.document.content)
  const commit = dailyStore(target, date).commit({
    sourceIdentity,
    freshnessTier: input.freshnessTier || 'writer-attested',
    partitions: buildDailyPartitions(input.document, date, input.parsed)
  })
  return memoryRefreshReceipt('daily', sourceIdentity, commit, { date })
}

function compactReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null
  return {
    schemaVersion: receipt.schemaVersion || 'MemoryIndexReadReceiptV1',
    status: receipt.status || 'invalid',
    freshnessTier: receipt.freshnessTier || null,
    errorCode: receipt.errorCode || null,
    filesRead: Number.isInteger(receipt.filesRead) ? receipt.filesRead : null,
    bytesRead: Number.isFinite(receipt.bytesRead) ? receipt.bytesRead : null,
    pointerIdentity: receipt.pointerIdentity || null,
    manifestIdentity: receipt.manifestIdentity || null,
    objectIdentity: receipt.objectIdentity || null,
    expectedSource: receipt.expectedSource || null,
    observedSource: receipt.observedSource || null
  }
}

function fallback(reason, receipt = null) {
  return {
    status: 'fallback',
    reason,
    envelope: buildQueryEnvelope({
      status: 'fallback',
      freshnessTier: receipt?.freshnessTier || 'stale',
      coverage: { status: 'legacy-required', reason },
      receipt: compactReceipt(receipt)
    })
  }
}

function readFreshPartition(store, key, sourcePath) {
  const current = store.readCurrent()
  if (current.status !== 'fresh') return fallback(`index-${current.status}`, current)
  const partition = store.readPartition(key, { current })
  if (partition.status !== 'fresh') return fallback(`partition-${partition.status}`, partition)
  const observed = observeSource(sourcePath)
  if (!observationMatches(partition.payload.source, observed)) {
    return fallback('source-metadata-drift', {
      ...partition,
      freshnessTier: 'stale',
      expectedSource: partition.payload.source,
      observedSource: observed
    })
  }
  return { status: 'fresh', current, partition }
}

function querySummaryIndex(input = {}) {
  try {
    const target = normalizeTarget(input.target)
    const sourcePath = assertSourceInside(target.activeRoot, input.sourcePath)
    const store = summaryStore(target)
    const fresh = readFreshPartition(store, 'summary:current', sourcePath)
    if (fresh.status !== 'fresh') return fresh
    const currentPayload = fresh.partition.payload
    if (currentPayload.schemaVersion !== SUMMARY_CURRENT_SCHEMA) {
      return fallback('summary-current-schema-invalid', fresh.partition)
    }
    const status = input.status || 'active'
    const limit = input.limit || 5
    const since = input.since || null
    let candidates
    let totalMatched
    let filesRead = fresh.partition.filesRead
    let bytesRead = fresh.partition.bytesRead
    const evidencePointers = [
      fresh.partition.pointerIdentity,
      fresh.partition.manifestIdentity,
      fresh.partition.objectIdentity
    ].filter(Boolean)

    if (!since) {
      const rowsByNumber = new Map(currentPayload.windowRows.map(row => [row.rowNumber, row]))
      candidates = (currentPayload.rowNumbersByState[status] || [])
        .map(rowNumber => rowsByNumber.get(rowNumber))
        .filter(Boolean)
      totalMatched = currentPayload.counts[status] || 0
    } else {
      const startMonth = since.slice(0, 7)
      const descriptors = fresh.current.manifest.partitions
        .filter(item => item.metadata?.kind === 'summary-month' && item.metadata.month >= startMonth)
      const rows = []
      for (const descriptor of descriptors) {
        const month = store.readPartition(descriptor.key, { current: fresh.current })
        if (month.status !== 'fresh' || month.payload.schemaVersion !== SUMMARY_MONTH_SCHEMA) {
          return fallback(`summary-month-${month.status}`, month)
        }
        filesRead += 1
        bytesRead += Math.max(0, month.bytesRead - fresh.current.bytesRead)
        evidencePointers.push(month.objectIdentity)
        rows.push(...month.payload.rows)
      }
      candidates = rowsByCurrentState(rows, status).filter(row => row.day >= since)
      totalMatched = candidates.length
    }
    const items = candidates.slice().reverse().slice(0, limit)
    return {
      status: 'fresh',
      source: currentPayload.source,
      rows: items,
      totalMatched,
      warnings: currentPayload.warnings,
      envelope: buildQueryEnvelope({
        status: 'fresh',
        freshnessTier: fresh.current.freshnessTier,
        coverage: { status: 'complete', sourceIdentity: fresh.current.pointer.sourceIdentity },
        items,
        truncated: totalMatched > items.length,
        nextPointer: totalMatched > items.length ? { offset: items.length } : null,
        evidencePointers,
        telemetry: {
          sourceBytes: bytesRead,
          deliveredBytes: null,
          filesRead,
          tokens: null
        },
        receipt: {
          schemaVersion: MEMORY_INDEX_RECEIPT_SCHEMA,
          status: 'fresh',
          kind: 'summary',
          pointerIdentity: fresh.partition.pointerIdentity,
          manifestIdentity: fresh.partition.manifestIdentity
        }
      })
    }
  } catch (error) {
    return fallback('summary-index-query-error', {
      status: 'invalid',
      freshnessTier: 'invalid',
      errorCode: 'MEMORY_INDEX_QUERY_FAILED',
      message: error.message
    })
  }
}

function queryStatusIndex(input = {}) {
  try {
    const target = normalizeTarget(input.target)
    const sourcePath = assertSourceInside(target.activeRoot, input.sourcePath)
    const fresh = readFreshPartition(summaryStore(target), 'summary:status', sourcePath)
    if (fresh.status !== 'fresh') return fresh
    const payload = fresh.partition.payload
    if (payload.schemaVersion !== SUMMARY_STATUS_SCHEMA) {
      return fallback('summary-status-schema-invalid', fresh.partition)
    }
    const items = payload.latestRows.slice().reverse().slice(0, input.limit || 5)
    return {
      status: 'fresh',
      source: payload.source,
      latestRows: items,
      activeSessionIds: payload.activeSessionIds,
      conflicts: payload.conflicts,
      nonCanonicalActiveCount: payload.nonCanonicalActiveCount,
      warnings: payload.warnings,
      envelope: buildQueryEnvelope({
        status: 'fresh',
        freshnessTier: fresh.current.freshnessTier,
        coverage: { status: 'complete', sourceIdentity: fresh.current.pointer.sourceIdentity },
        items,
        truncated: payload.latestRows.length > items.length,
        nextPointer: payload.latestRows.length > items.length ? { offset: items.length } : null,
        evidencePointers: [
          fresh.partition.pointerIdentity,
          fresh.partition.manifestIdentity,
          fresh.partition.objectIdentity
        ].filter(Boolean),
        telemetry: {
          sourceBytes: fresh.partition.bytesRead,
          deliveredBytes: null,
          filesRead: fresh.partition.filesRead,
          tokens: null
        },
        receipt: {
          schemaVersion: MEMORY_INDEX_RECEIPT_SCHEMA,
          status: 'fresh',
          kind: 'summary',
          pointerIdentity: fresh.partition.pointerIdentity,
          manifestIdentity: fresh.partition.manifestIdentity
        }
      })
    }
  } catch (error) {
    return fallback('status-index-query-error', {
      status: 'invalid',
      freshnessTier: 'invalid',
      errorCode: 'MEMORY_INDEX_STATUS_FAILED',
      message: error.message
    })
  }
}

function readUtf8Range(filePath, startByte, endByte, maxChars) {
  const byteLength = Math.max(0, endByte - startByte)
  const maxBytes = Math.min(byteLength, Math.max(4, maxChars * 4 + 4))
  const buffer = Buffer.alloc(maxBytes)
  const descriptor = fs.openSync(filePath, 'r')
  let bytesRead = 0
  try {
    bytesRead = fs.readSync(descriptor, buffer, 0, maxBytes, startByte)
  } finally {
    fs.closeSync(descriptor)
  }
  const content = buffer.subarray(0, bytesRead).toString('utf8')
  return {
    content: content.slice(0, maxChars),
    bytesRead,
    truncated: byteLength > bytesRead || content.length > maxChars
  }
}

function stateMatches(actual, expected) {
  if (expected === 'all') return true
  if (expected === 'unresolved') return actual === 'active' || actual === 'blocked'
  return actual === expected
}

function queryDailyIndex(input = {}) {
  try {
    const target = normalizeTarget(input.target)
    const date = String(input.date || '')
    const sourcePath = assertSourceInside(target.activeRoot, input.sourcePath)
    const store = dailyStore(target, date)
    const fresh = readFreshPartition(store, `daily:${date}`, sourcePath)
    if (fresh.status !== 'fresh') return fresh
    const payload = fresh.partition.payload
    if (payload.schemaVersion !== DAILY_SCHEMA) return fallback('daily-schema-invalid', fresh.partition)
    const candidates = payload.sessions.slice().reverse().filter(session => {
      if (input.sessionId && session.sessionId !== input.sessionId) return false
      if (!stateMatches(session.state, input.status || 'all')) return false
      if (input.handoffOnly && !session.hasHandoff) return false
      return true
    })
    const matches = []
    let remainingChars = input.maxChars || 12000
    let sourceBytes = 0
    for (const session of candidates.slice(0, input.limit || 1)) {
      if (remainingChars <= 0) break
      const startByte = input.handoffOnly ? session.handoffStartByte : session.startByte
      const endByte = input.handoffOnly ? session.handoffEndByte : session.endByte
      const range = readUtf8Range(sourcePath, startByte, endByte, remainingChars)
      sourceBytes += range.bytesRead
      const selected = input.handoffOnly && typeof input.extractHandoffCard === 'function'
        ? input.extractHandoffCard(range.content)
        : range.content
      const content = selected.slice(0, remainingChars)
      matches.push({
        date: session.date,
        sessionId: session.sessionId,
        title: session.title,
        status: session.status,
        state: session.state,
        content,
        chars: content.length,
        truncated: range.truncated || content.length < selected.length
      })
      remainingChars -= content.length
      if (range.truncated) break
    }
    const truncated = candidates.length > matches.length || matches.some(item => item.truncated)
    return {
      status: 'fresh',
      source: payload.source,
      matches,
      warnings: payload.warnings,
      envelope: buildQueryEnvelope({
        status: 'fresh',
        freshnessTier: fresh.current.freshnessTier,
        coverage: { status: 'complete', sourceIdentity: fresh.current.pointer.sourceIdentity },
        items: matches,
        truncated,
        nextPointer: truncated ? { offset: matches.length } : null,
        evidencePointers: [
          fresh.partition.pointerIdentity,
          fresh.partition.manifestIdentity,
          fresh.partition.objectIdentity
        ].filter(Boolean),
        hydrated: matches.length > 0,
        telemetry: {
          sourceBytes,
          indexBytesRead: fresh.partition.bytesRead,
          deliveredBytes: null,
          filesRead: fresh.partition.filesRead + matches.length,
          tokens: null
        },
        receipt: {
          schemaVersion: MEMORY_INDEX_RECEIPT_SCHEMA,
          status: 'fresh',
          kind: 'daily',
          date,
          pointerIdentity: fresh.partition.pointerIdentity,
          manifestIdentity: fresh.partition.manifestIdentity
        }
      })
    }
  } catch (error) {
    return fallback('daily-index-query-error', {
      status: 'invalid',
      freshnessTier: 'invalid',
      errorCode: 'MEMORY_INDEX_DAILY_QUERY_FAILED',
      message: error.message
    })
  }
}

module.exports = {
  DAILY_SCHEMA,
  MEMORY_INDEX_RECEIPT_SCHEMA,
  SUMMARY_CURRENT_SCHEMA,
  SUMMARY_MONTH_SCHEMA,
  SUMMARY_STATUS_SCHEMA,
  buildDailyPartitions,
  buildSummaryPartitions,
  memorySourceIdentity,
  compactReceipt,
  observationMatches,
  observeSource,
  queryDailyIndex,
  queryStatusIndex,
  querySummaryIndex,
  readUtf8Range,
  refreshDailyIndex,
  refreshSummaryIndex,
  sessionRanges,
  sourceObservation
}
