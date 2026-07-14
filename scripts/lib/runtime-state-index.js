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

function normalizeStatus(text) {
  const value = String(text || '').toLowerCase()
  if (/\b(?:closed|fixed|resolved|complete|completed|accepted)\b|已关闭|已修复|已完成|✅/.test(value)) return 'closed'
  if (/\b(?:deferred|postponed)\b|延后|延期/.test(value)) return 'deferred'
  if (/\b(?:partial|pending|in-progress|executing|blocked)\b|部分|进行中|待确认|🔄|⚠️/.test(value)) return 'partial'
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

function selectClaim(claims) {
  return [...claims].sort((a, b) => {
    const rank = SOURCE_RANK[b.sourceKind] - SOURCE_RANK[a.sourceKind]
    if (rank) return rank
    const sameSource = a.source.localeCompare(b.source)
    if (sameSource) return sameSource
    return b.line - a.line
  }).find(claim => claim.normalizedStatus !== 'unknown') || claims[claims.length - 1]
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
    const statuses = Array.from(new Set(recordClaims.map(claim => claim.normalizedStatus).filter(status => status !== 'unknown'))).sort()
    const selected = selectClaim(recordClaims)
    return {
      recordId,
      kind: recordId.split('-')[0],
      normalizedStatus: selected ? selected.normalizedStatus : 'unknown',
      conflict: statuses.length > 1,
      conflictingStatuses: statuses,
      precedence: 'ledger > agent-summary > daily-task > global-summary; later line wins within the same source',
      selectedAnchor: selected ? selected.anchor : null,
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
        code: 'CONFLICTING_TERMINAL_STATE',
        recordId: record.recordId,
        message: `${record.recordId} has incompatible claims: ${record.conflictingStatuses.join(', ')}`
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
