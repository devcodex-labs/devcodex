'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  queryDailyIndex,
  queryStatusIndex,
  querySummaryIndex,
  refreshDailyIndex,
  refreshSummaryIndex
} = require('./lib/memory-index.js')
const { summaryStateConflicts } = require('./lib/memory-summary-state.js')

function document(filePath) {
  const stat = fs.statSync(filePath)
  const content = fs.readFileSync(filePath, 'utf8')
  return {
    path: filePath,
    exists: true,
    bytes: Buffer.byteLength(content),
    chars: content.length,
    modifiedAt: stat.mtime.toISOString(),
    content
  }
}

function runtimeDigest(activeRoot) {
  const root = path.join(activeRoot, '.runtime-state')
  if (!fs.existsSync(root)) return null
  const hash = crypto.createHash('sha256')
  const files = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else files.push(absolute)
    }
  }
  visit(root)
  for (const file of files.sort()) {
    hash.update(path.relative(root, file).replaceAll('\\', '/'))
    hash.update(fs.readFileSync(file))
  }
  return hash.digest('hex')
}

function row(date, sessionId, state, rowNumber) {
  return {
    date: `${date} 10:00`,
    day: date,
    sessionId,
    sessionIdCanonical: true,
    type: 'dev',
    summary: `summary-${sessionId}`,
    report: `report-${sessionId}`,
    memory: `memory-${sessionId}`,
    status: state === 'completed' ? '✅' : state === 'blocked' ? '⛔' : '🔄',
    state,
    rowNumber,
    truncated: false
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-memory-index-'))
const target = {
  activeRoot: root,
  project: 'fixture',
  scope: 'project',
  agent: 'codex'
}
const clientRoot = path.join(root, '.memory', 'clients', 'codex')
fs.mkdirSync(path.join(clientRoot, 'tasks'), { recursive: true })
const summaryPath = path.join(clientRoot, 'SUMMARY.md')
const summaryContent = [
  '# SUMMARY',
  '| 日期 | 会话 | 类型 | 摘要 | 报告 | 记忆 | 状态 |',
  '|---|---|---|---|---|---|---|',
  '| 2026-06-30 10:00 | 01 | dev | old | r | m | ✅ |',
  '| 2026-07-22 10:00 | 02 | dev | active | r | m | 🔄 |',
  '| 2026-07-23 10:00 | 02 | dev | blocked | r | m | ⛔ |',
  '| 2026-07-23 10:30 | 03 | dev | active-before-done | r | m | 🔄 |',
  '| 2026-07-23 11:00 | 03 | dev | done | r | m | ✅ |',
  ''
].join('\n')
fs.writeFileSync(summaryPath, summaryContent)
const summaryRows = [
  row('2026-06-30', '01', 'completed', 4),
  row('2026-07-22', '02', 'active', 5),
  row('2026-07-23', '02', 'blocked', 6),
  row('2026-07-23', '03', 'active', 7),
  row('2026-07-23', '03', 'completed', 8)
]
const summaryRefresh = refreshSummaryIndex({
  target,
  document: document(summaryPath),
  parsed: { rows: summaryRows, warnings: ['fixture-warning'] }
})
assert.equal(summaryRefresh.status, 'persisted')
assert.equal(summaryRefresh.kind, 'summary')

const status = queryStatusIndex({ target, sourcePath: summaryPath, limit: 2 })
assert.equal(status.status, 'fresh')
assert.equal(status.latestRows.length, 2)
assert.equal(status.activeSessionIds[0], '2026-07-22#02')
assert.ok(!status.activeSessionIds.includes('2026-07-23#03'))
assert.deepEqual(status.conflicts, [])
assert.equal(status.warnings[0], 'fixture-warning')
assert.deepEqual(
  summaryStateConflicts([
    row('2026-07-24', '05', 'completed', 1),
    row('2026-07-24', '05', 'active', 2)
  ]),
  [{ sessionKey: '2026-07-24#05', states: ['active', 'completed'] }]
)

const completed = querySummaryIndex({
  target,
  sourcePath: summaryPath,
  status: 'completed',
  limit: 10
})
assert.equal(completed.status, 'fresh')
assert.deepEqual(completed.rows.map(item => item.sessionId), ['03', '01'])
assert.equal(completed.totalMatched, 2)
const completedSecondPage = querySummaryIndex({
  target,
  sourcePath: summaryPath,
  status: 'completed',
  limit: 1,
  offset: 1
})
assert.deepEqual(completedSecondPage.rows.map(item => item.sessionId), ['01'])
assert.equal(completedSecondPage.envelope.nextPointer, null)

const currentActive = querySummaryIndex({
  target,
  sourcePath: summaryPath,
  status: 'active',
  limit: 10
})
assert.deepEqual(currentActive.rows.map(item => `${item.day}#${item.sessionId}`), ['2026-07-22#02'])

const since = querySummaryIndex({
  target,
  sourcePath: summaryPath,
  status: 'unresolved',
  since: '2026-07-01',
  limit: 10
})
assert.equal(since.status, 'fresh')
assert.deepEqual(since.rows.map(item => item.state), ['blocked', 'active'])
assert(since.envelope.telemetry.filesRead >= 4)

const beforeSummaryQuery = runtimeDigest(root)
assert.equal(queryStatusIndex({ target, sourcePath: summaryPath, limit: 1 }).status, 'fresh')
assert.equal(runtimeDigest(root), beforeSummaryQuery, 'summary query must not mutate index state')

fs.appendFileSync(summaryPath, '| 2026-07-23 12:00 | 04 | dev | manual | r | m | 🔄 |\n')
const stale = queryStatusIndex({ target, sourcePath: summaryPath, limit: 2 })
assert.equal(stale.status, 'fallback')
assert.equal(stale.reason, 'source-metadata-drift')
assert(!JSON.stringify(stale.envelope.receipt).includes('summary-03'), 'fallback receipt must not embed partition payload')

const refreshedRows = [...summaryRows, row('2026-07-23', '04', 'active', 9)]
const summaryRefresh2 = refreshSummaryIndex({
  target,
  document: document(summaryPath),
  parsed: { rows: refreshedRows, warnings: [] }
})
assert.equal(summaryRefresh2.status, 'persisted')
assert.equal(summaryRefresh2.generation, 2)
assert.equal(queryStatusIndex({ target, sourcePath: summaryPath, limit: 2 }).status, 'fresh')

const date = '20260723'
const dailyPath = path.join(clientRoot, 'tasks', `${date}.md`)
const firstSession = [
  '## 会话 01 — 第一段',
  '',
  '- **状态**：✅ completed',
  '',
  '正文 alpha'
].join('\n')
const secondSession = [
  '## 会话 02 — 第二段',
  '',
  '- **状态**：🔄 active',
  '',
  '中文正文 beta 😀',
  '',
  '### ContextHandoffCard',
  '',
  '- next: continue'
].join('\n')
const dailyContent = `${firstSession}\n\n${secondSession}\n`
fs.writeFileSync(dailyPath, dailyContent)
const dailyRefresh = refreshDailyIndex({
  target,
  date,
  document: document(dailyPath),
  parsed: {
    sessions: [
      {
        date,
        sessionId: '01',
        title: '第一段',
        status: '✅ completed',
        state: 'completed',
        content: firstSession,
        handoff: '',
        ordinal: 1
      },
      {
        date,
        sessionId: '02',
        title: '第二段',
        status: '🔄 active',
        state: 'active',
        content: secondSession,
        handoff: '### ContextHandoffCard\n\n- next: continue',
        ordinal: 2
      }
    ],
    warnings: []
  }
})
assert.equal(dailyRefresh.status, 'persisted')

const daily = queryDailyIndex({
  target,
  date,
  sourcePath: dailyPath,
  sessionId: '02',
  status: 'all',
  limit: 1,
  maxChars: 2000
})
assert.equal(daily.status, 'fresh')
assert.equal(daily.matches.length, 1)
assert(daily.matches[0].content.includes('中文正文 beta 😀'))
assert(!daily.matches[0].content.includes('\ufffd'), 'UTF-8 byte-range hydration must not corrupt content')
assert(daily.envelope.telemetry.indexBytesRead > 0, 'daily query must report index read bytes')
const dailySecondPage = queryDailyIndex({
  target,
  date,
  sourcePath: dailyPath,
  status: 'all',
  limit: 1,
  offset: 1,
  maxChars: 2000
})
assert.deepEqual(dailySecondPage.matches.map(item => item.sessionId), ['01'])
assert.equal(dailySecondPage.totalMatched, 2)

const handoff = queryDailyIndex({
  target,
  date,
  sourcePath: dailyPath,
  status: 'active',
  limit: 1,
  handoffOnly: true,
  maxChars: 2000,
  extractHandoffCard(content) {
    return content.slice(content.indexOf('### ContextHandoffCard')).trim()
  }
})
assert.equal(handoff.status, 'fresh')
assert.equal(handoff.matches[0].content, '### ContextHandoffCard\n\n- next: continue')

const beforeDailyQuery = runtimeDigest(root)
assert.equal(queryDailyIndex({
  target,
  date,
  sourcePath: dailyPath,
  status: 'all',
  limit: 1,
  maxChars: 20
}).status, 'fresh')
assert.equal(runtimeDigest(root), beforeDailyQuery, 'daily query must be zero-write')

fs.appendFileSync(dailyPath, '\nmanual edit')
assert.equal(queryDailyIndex({
  target,
  date,
  sourcePath: dailyPath,
  status: 'all',
  limit: 1,
  maxChars: 20
}).status, 'fallback')

fs.rmSync(root, { recursive: true, force: true })
console.log('memory index tests passed: summary/month/current/daily/range/stale/zero-write')
