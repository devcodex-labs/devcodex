'use strict'

const fs = require('fs')
const path = require('path')
const { resolveRuntimeStateRoot } = require('../../hooks/_runtime/workspace-layout.cjs')
const {
  buildContentIdentity,
  stableStringify
} = require('../../hooks/_runtime/content-identity.cjs')
const { createDerivedIndexStore } = require('./derived-index-contract.js')

const RECORD_PATTERN = /\b(PI|PF|VL|GR|ISSUE)-\d+\b/g
const SOURCE_RANK = {
  ledger: 100,
  'agent-summary': 80,
  'daily-task': 70,
  'global-summary': 60
}
const CANONICAL_LEDGER_BY_KIND = {
  PI: 'data/process-improvements.md',
  PF: 'data/pending-fixes.md',
  VL: 'data/violations.md',
  GR: 'data/gap-registry.md',
  ISSUE: 'data/pending-issues.md'
}

function normalizeStatus(text) {
  const value = String(text || '').toLowerCase()
  if (/\b(?:closed|fixed|resolved|complete|completed|accepted)\b|已关闭|已修复|已完成|✅/.test(value)) return 'closed'
  if (/\b(?:deferred|postponed)\b|延后|延期/.test(value)) return 'deferred'
  if (/\b(?:partial|residual-tail|pending|in-progress|executing|blocked)\b|部分|进行中|待确认|🔄|⚠️/.test(value)) return 'partial'
  if (/\b(?:open|todo|not-started)\b|待处理|未开始|⏹️/.test(value)) return 'open'
  return 'unknown'
}

function statusTextForLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed.startsWith('|')) return trimmed
  const cells = trimmed.split('|').map(cell => cell.trim()).filter(Boolean)
  return cells.length ? cells[cells.length - 1] : trimmed
}

function classifySource(activeRoot, file) {
  const relative = path.relative(activeRoot, file).replace(/\\/g, '/')
  if (/^data\/(?:process-improvements|pending-fixes|violations|gap-registry|pending-issues)\.md$/.test(relative)) return 'ledger'
  if (/^\.memory\/clients\/[^/]+\/SUMMARY\.md$/.test(relative)) return 'agent-summary'
  if (/^\.memory\/clients\/[^/]+\/tasks\/\d{8}\.md$/.test(relative)) return 'daily-task'
  if (relative === '.memory/SUMMARY.md') return 'global-summary'
  return null
}

function discoverSources(activeRoot) {
  const candidates = Object.values(CANONICAL_LEDGER_BY_KIND)
    .map(relative => path.join(activeRoot, relative))
  const clientsRoot = path.join(activeRoot, '.memory', 'clients')
  if (fs.existsSync(clientsRoot)) {
    for (const agent of fs.readdirSync(clientsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const agentRoot = path.join(clientsRoot, agent.name)
      candidates.push(path.join(agentRoot, 'SUMMARY.md'))
      const tasksRoot = path.join(agentRoot, 'tasks')
      if (!fs.existsSync(tasksRoot)) continue
      for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
        if (entry.isFile() && /^\d{8}\.md$/.test(entry.name)) candidates.push(path.join(tasksRoot, entry.name))
      }
    }
  }
  candidates.push(path.join(activeRoot, '.memory', 'SUMMARY.md'))
  return candidates
    .filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
    .map(file => ({ file, kind: classifySource(activeRoot, file) }))
    .filter(item => item.kind)
    .sort((a, b) => a.file.localeCompare(b.file))
}

function sourceObservation(activeRoot, source, content = null) {
  const stat = fs.statSync(source.file)
  const relative = path.relative(activeRoot, source.file).replace(/\\/g, '/')
  return {
    path: relative,
    kind: source.kind,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    contentIdentity: content === null
      ? null
      : buildContentIdentity({
          sourceKey: `runtime-state://${relative}`,
          content,
          contractVersion: '1'
        })
  }
}

function observeRuntimeStateSources(activeRoot) {
  return discoverSources(activeRoot).map(source => sourceObservation(activeRoot, source))
}

function sourceIdentityFor(activeRoot, observations) {
  return buildContentIdentity({
    sourceKey: `runtime-state://${path.basename(path.resolve(activeRoot))}/sources`,
    content: stableStringify(observations.map(observation => ({
      path: observation.path,
      kind: observation.kind,
      bytes: observation.bytes,
      contentIdentity: observation.contentIdentity
    }))),
    contractVersion: '1'
  })
}

function extractClaims(activeRoot, source, content) {
  const relative = path.relative(activeRoot, source.file).replace(/\\/g, '/')
  const lines = content.split(/\r?\n/)
  const claims = []
  let headingRecordIds = []
  lines.forEach((line, index) => {
    const ids = Array.from(new Set(Array.from(line.matchAll(RECORD_PATTERN), match => match[0])))
    const normalizedStatus = normalizeStatus(statusTextForLine(line))
    if (/^#{1,6}\s/.test(line)) headingRecordIds = ids
    const claimIds = ids.length ? ids : (normalizedStatus !== 'unknown' ? headingRecordIds : [])
    if (!claimIds.length) return
    for (const recordId of claimIds) {
      claims.push({
        recordId,
        kind: recordId.split('-')[0],
        source: relative,
        sourceKind: source.kind,
        anchor: `${relative}:${index + 1}`,
        line: index + 1,
        normalizedStatus,
        excerpt: line.trim().slice(0, 280)
      })
    }
  })
  return claims
}

const LEGAL_TRANSITIONS = new Set([
  'open>partial',
  'open>deferred',
  'open>closed',
  'partial>open',
  'partial>deferred',
  'partial>closed',
  'deferred>open',
  'deferred>partial',
  'deferred>closed',
  'closed>open',
  'closed>partial',
  'closed>deferred'
])

function classifyTransition(from, to) {
  if (from === to) return 'unchanged'
  return LEGAL_TRANSITIONS.has(`${from}>${to}`) ? 'legal' : 'unrecognized'
}

function authorityRankForClaim(claim) {
  if (claim.sourceKind !== 'ledger') return SOURCE_RANK[claim.sourceKind]
  return claim.source === CANONICAL_LEDGER_BY_KIND[claim.kind] ? SOURCE_RANK.ledger : 75
}

/** Keep only the last known status in each physical source; append-only history is not current conflict. */
function projectClaimsBySource(claims) {
  const grouped = new Map()
  for (const claim of claims) {
    if (!grouped.has(claim.source)) grouped.set(claim.source, [])
    grouped.get(claim.source).push(claim)
  }

  const sourceProjections = []
  const historicalTransitions = []
  for (const [source, sourceClaims] of grouped) {
    const known = sourceClaims
      .filter(claim => claim.normalizedStatus !== 'unknown')
      .sort((a, b) => a.line - b.line)
    for (let index = 1; index < known.length; index += 1) {
      const previous = known[index - 1]
      const current = known[index]
      if (previous.normalizedStatus === current.normalizedStatus) continue
      historicalTransitions.push({
        source,
        sourceKind: current.sourceKind,
        from: previous.normalizedStatus,
        to: current.normalizedStatus,
        classification: classifyTransition(previous.normalizedStatus, current.normalizedStatus),
        fromAnchor: previous.anchor,
        toAnchor: current.anchor
      })
    }
    const selected = known[known.length - 1]
    if (selected) {
      sourceProjections.push({
        source,
        sourceKind: selected.sourceKind,
        authorityRank: authorityRankForClaim(selected),
        normalizedStatus: selected.normalizedStatus,
        anchor: selected.anchor,
        line: selected.line
      })
    }
  }

  sourceProjections.sort((a, b) =>
    b.authorityRank - a.authorityRank ||
    a.source.localeCompare(b.source) ||
    b.line - a.line
  )
  historicalTransitions.sort((a, b) =>
    a.source.localeCompare(b.source) ||
    a.toAnchor.localeCompare(b.toAnchor, undefined, { numeric: true })
  )
  return { sourceProjections, historicalTransitions }
}

function buildRuntimeStateIndex(activeRoot) {
  const sources = discoverSources(activeRoot)
  const documents = sources.map(source => {
    const content = fs.readFileSync(source.file, 'utf8')
    return {
      source,
      content,
      observation: sourceObservation(activeRoot, source, content)
    }
  })
  const sourceObservations = documents.map(document => document.observation)
  const sourceIdentity = sourceIdentityFor(activeRoot, sourceObservations)
  const claims = documents.flatMap(document => extractClaims(activeRoot, document.source, document.content))
  const grouped = new Map()
  for (const claim of claims) {
    if (!grouped.has(claim.recordId)) grouped.set(claim.recordId, [])
    grouped.get(claim.recordId).push(claim)
  }

  const records = Array.from(grouped, ([recordId, recordClaims]) => {
    const observedStatuses = Array.from(new Set(recordClaims
      .map(claim => claim.normalizedStatus)
      .filter(status => status !== 'unknown'))).sort()
    const { sourceProjections, historicalTransitions } = projectClaimsBySource(recordClaims)
    const currentAuthorityRank = sourceProjections.length ? sourceProjections[0].authorityRank : null
    const authorityProjections = sourceProjections.filter(projection => projection.authorityRank === currentAuthorityRank)
    const conflictingStatuses = Array.from(new Set(authorityProjections.map(projection => projection.normalizedStatus))).sort()
    const currentAuthorityQualified = currentAuthorityRank !== null && currentAuthorityRank >= SOURCE_RANK['agent-summary']
    const conflict = currentAuthorityQualified && conflictingStatuses.length > 1
    const currentProjection = authorityProjections[0] || null
    // Lower-authority stale consumers remain visible, but they do not block strict validation.
    const consumerDrifts = conflict || !currentProjection
      ? []
      : sourceProjections
          .filter(projection =>
            projection.authorityRank < currentAuthorityRank &&
            projection.normalizedStatus !== currentProjection.normalizedStatus
          )
          .map(projection => ({
            source: projection.source,
            sourceKind: projection.sourceKind,
            authorityRank: projection.authorityRank,
            normalizedStatus: projection.normalizedStatus,
            expectedStatus: currentProjection.normalizedStatus,
            anchor: projection.anchor
          }))
    return {
      recordId,
      kind: recordId.split('-')[0],
      normalizedStatus: currentProjection ? currentProjection.normalizedStatus : 'unknown',
      observedStatuses,
      sourceProjections,
      historicalTransitions,
      currentAuthorityRank,
      currentAuthorityQualified,
      currentProjection,
      consumerDrifts,
      conflict,
      conflictingStatuses: conflict ? conflictingStatuses : [],
      precedence: 'last known status per source; canonical ledger > agent-summary > cross-ledger reference > daily-task > global-summary; conflict only within a qualified current authority rank',
      selectedAnchor: currentProjection ? currentProjection.anchor : null,
      claims: recordClaims.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line)
    }
  }).sort((a, b) => a.recordId.localeCompare(b.recordId, undefined, { numeric: true }))

  const consistencyAlerts = []
  for (const record of records) {
    const kinds = new Set(record.claims.map(claim => claim.sourceKind))
    if (
      record.kind === 'VL' &&
      record.normalizedStatus === 'closed' &&
      kinds.has('ledger') &&
      kinds.has('daily-task') &&
      !kinds.has('agent-summary')
    ) {
      consistencyAlerts.push({
        code: 'MISSING_AGENT_SUMMARY',
        recordId: record.recordId,
        message: `${record.recordId} is closed in ledger/daily evidence but absent from Agent SUMMARY`
      })
    }
    if (record.conflict) {
      consistencyAlerts.push({
        code: 'CONFLICTING_CURRENT_STATE',
        recordId: record.recordId,
        message: `${record.recordId} has incompatible current claims at authority rank ${record.currentAuthorityRank}: ${record.conflictingStatuses.join(', ')}`
      })
    }
  }

  return {
    schemaVersion: 1,
    activeRoot: path.resolve(activeRoot),
    sourceModel: ['ledger', 'agent-summary', 'daily-task', 'global-summary'],
    readOnlySourcePolicy: true,
    sourceIdentity,
    sourceObservations,
    summary: {
      sourceFileCount: sources.length,
      recordCount: records.length,
      conflictCount: records.filter(record => record.conflict).length,
      historicalTransitionCount: records.reduce((total, record) => total + record.historicalTransitions.length, 0),
      consumerDriftCount: records.reduce((total, record) => total + record.consumerDrifts.length, 0),
      alertCount: consistencyAlerts.length
    },
    consistencyAlerts,
    records
  }
}

function resolveDefaultActiveRoot(sourceRoot) {
  const workspaceRoot = path.dirname(sourceRoot)
  const layoutPath = path.join(workspaceRoot, '.devcodex', 'layout.json')
  if (fs.existsSync(layoutPath)) {
    try {
      const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'))
      if (layout.mode === 'workspace-namespace') return path.join(workspaceRoot, '.devcodex', path.basename(sourceRoot))
    } catch { /* fall back to legacy root */ }
  }
  return path.join(sourceRoot, '.devcodex')
}

function runtimeStateStore(activeRoot) {
  return createDerivedIndexStore({
    activeRoot,
    domain: 'runtime-state',
    scopeIdentity: {
      project: path.basename(path.resolve(activeRoot)),
      scope: 'current'
    }
  })
}

function compactRuntimeStateRecord(record) {
  return {
    recordId: record.recordId,
    kind: record.kind,
    normalizedStatus: record.normalizedStatus,
    currentAuthorityRank: record.currentAuthorityRank,
    conflict: record.conflict,
    conflictingStatuses: record.conflictingStatuses,
    consumerDrifts: record.consumerDrifts,
    selectedAnchor: record.selectedAnchor
  }
}

function compactSourceObservation(observation) {
  return {
    path: observation.path,
    kind: observation.kind,
    bytes: observation.bytes,
    modifiedAt: observation.modifiedAt
  }
}

function observationsMatch(expected, observed) {
  if (expected.length !== observed.length) return false
  return expected.every((item, index) =>
    item.path === observed[index].path &&
    item.kind === observed[index].kind &&
    item.bytes === observed[index].bytes &&
    item.modifiedAt === observed[index].modifiedAt)
}

function writeRuntimeStateProjection(activeRoot, index) {
  if (!index?.sourceIdentity || !Array.isArray(index?.sourceObservations)) {
    throw new Error('runtime-state projection requires an index built from exact source documents')
  }
  const partitions = [{
    key: 'current',
    metadata: { recordCount: index.records.length },
    payload: {
      schemaVersion: 'RuntimeStateCurrentProjectionV2',
      activeRoot: index.activeRoot,
      sourceModel: index.sourceModel,
      readOnlySourcePolicy: true,
      sourceObservations: index.sourceObservations.map(compactSourceObservation),
      summary: index.summary,
      consistencyAlerts: index.consistencyAlerts,
      records: index.records.map(compactRuntimeStateRecord)
    }
  }]
  const byKind = new Map()
  for (const record of index.records) {
    if (!byKind.has(record.kind)) byKind.set(record.kind, [])
    byKind.get(record.kind).push(record)
  }
  for (const [kind, records] of Array.from(byKind).sort(([left], [right]) => left.localeCompare(right))) {
    partitions.push({
      key: `detail:${kind.toLowerCase()}`,
      metadata: { kind, recordCount: records.length },
      payload: {
        schemaVersion: 'RuntimeStateDetailPartitionV2',
        kind,
        records
      }
    })
  }
  return runtimeStateStore(activeRoot).commit({
    sourceIdentity: index.sourceIdentity,
    freshnessTier: 'writer-attested',
    partitions
  })
}

function readRuntimeStateProjection(activeRoot) {
  const store = runtimeStateStore(activeRoot)
  const current = store.readCurrent()
  if (current.status !== 'fresh') {
    return {
      schemaVersion: 'RuntimeStateProjectionReadV2',
      status: current.status,
      freshnessTier: current.freshnessTier || 'stale',
      receipt: current
    }
  }
  const partition = store.readPartition('current', { current })
  const payload = partition.payload
  if (partition.status !== 'fresh' || payload?.schemaVersion !== 'RuntimeStateCurrentProjectionV2') {
    return {
      schemaVersion: 'RuntimeStateProjectionReadV2',
      status: 'invalid',
      freshnessTier: 'invalid',
      receipt: partition
    }
  }
  const observed = observeRuntimeStateSources(activeRoot)
  const fresh = observationsMatch(payload.sourceObservations || [], observed)
  if (!fresh) {
    return {
      schemaVersion: 'RuntimeStateProjectionReadV2',
      status: 'stale',
      freshnessTier: 'stale',
      receipt: {
        status: 'stale',
        errorCode: 'RUNTIME_STATE_SOURCE_OBSERVATION_DRIFT',
        filesRead: partition.filesRead,
        bytesRead: partition.bytesRead
      }
    }
  }
  const sourceBytes = observed.reduce((total, item) => total + item.bytes, 0)
  return {
    schemaVersion: 'RuntimeStateProjectionReadV2',
    status: 'fresh',
    freshnessTier: 'metadata-reconciled',
    index: {
      schemaVersion: 1,
      projectionSchemaVersion: payload.schemaVersion,
      activeRoot: payload.activeRoot,
      sourceModel: payload.sourceModel,
      readOnlySourcePolicy: true,
      sourceIdentity: current.pointer.sourceIdentity,
      sourceObservations: payload.sourceObservations,
      summary: payload.summary,
      consistencyAlerts: payload.consistencyAlerts,
      records: payload.records
    },
    receipt: {
      schemaVersion: 'RuntimeStateIndexLoadReceiptV1',
      status: 'fresh',
      route: 'derived-index',
      freshnessTier: 'metadata-reconciled',
      generation: current.pointer.generation,
      sourceIdentity: current.pointer.sourceIdentity,
      filesRead: partition.filesRead,
      sourceBytes,
      deliveredBytes: partition.bytesRead,
      pointerIdentity: partition.pointerIdentity,
      manifestIdentity: partition.manifestIdentity,
      objectIdentity: partition.objectIdentity
    }
  }
}

function loadRuntimeStateIndex(activeRoot, options = {}) {
  if (options.preferDerived !== false) {
    const projection = readRuntimeStateProjection(activeRoot)
    if (projection.status === 'fresh') return { index: projection.index, receipt: projection.receipt }
    if (options.fallback === false) return { index: null, receipt: projection.receipt }
    const index = buildRuntimeStateIndex(activeRoot)
    return {
      index,
      receipt: {
        schemaVersion: 'RuntimeStateIndexLoadReceiptV1',
        status: 'fallback',
        route: 'source-scan',
        freshnessTier: projection.freshnessTier || 'stale',
        fallbackReason: projection.status,
        filesRead: index.summary.sourceFileCount,
        sourceBytes: index.sourceObservations.reduce((total, item) => total + item.bytes, 0),
        deliveredBytes: null
      }
    }
  }
  const index = buildRuntimeStateIndex(activeRoot)
  return {
    index,
    receipt: {
      schemaVersion: 'RuntimeStateIndexLoadReceiptV1',
      status: 'fallback',
      route: 'source-scan',
      freshnessTier: 'content-verified',
      fallbackReason: 'derived-index-disabled',
      filesRead: index.summary.sourceFileCount,
      sourceBytes: index.sourceObservations.reduce((total, item) => total + item.bytes, 0),
      deliveredBytes: null
    }
  }
}

function writeDerivedIndex(activeRoot, index) {
  const outputDir = resolveRuntimeStateRoot(activeRoot).root
  const output = path.join(outputDir, 'runtime-state-index.json')
  const temp = `${output}.tmp-${process.pid}`
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(temp, JSON.stringify(index, null, 2) + '\n')
  fs.renameSync(temp, output)
  return output
}

module.exports = {
  buildRuntimeStateIndex,
  discoverSources,
  loadRuntimeStateIndex,
  normalizeStatus,
  observeRuntimeStateSources,
  readRuntimeStateProjection,
  resolveDefaultActiveRoot,
  writeDerivedIndex,
  writeRuntimeStateProjection
}
