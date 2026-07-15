'use strict'

const fs = require('fs')
const path = require('path')

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

function walk(root) {
  if (!fs.existsSync(root)) return []
  const out = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
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
  return walk(activeRoot)
    .map(file => ({ file, kind: classifySource(activeRoot, file) }))
    .filter(item => item.kind)
    .sort((a, b) => a.file.localeCompare(b.file))
}

function extractClaims(activeRoot, source) {
  const relative = path.relative(activeRoot, source.file).replace(/\\/g, '/')
  const lines = fs.readFileSync(source.file, 'utf8').split(/\r?\n/)
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
  const claims = sources.flatMap(source => extractClaims(activeRoot, source))
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

function writeDerivedIndex(activeRoot, index) {
  const outputDir = path.join(activeRoot, '.runtime-state')
  const output = path.join(outputDir, 'runtime-state-index.json')
  const temp = `${output}.tmp-${process.pid}`
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(temp, JSON.stringify(index, null, 2) + '\n')
  fs.renameSync(temp, output)
  return output
}

module.exports = {
  buildRuntimeStateIndex,
  normalizeStatus,
  resolveDefaultActiveRoot,
  writeDerivedIndex
}
