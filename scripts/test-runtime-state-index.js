#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildRuntimeStateIndex,
  loadRuntimeStateIndex,
  normalizeStatus,
  readRuntimeStateProjection,
  writeDerivedIndex,
  writeRuntimeStateProjection
} = require('./lib/runtime-state-index')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-runtime-state-'))
function write(relative, content) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

function treeSnapshot(rootPath) {
  if (!fs.existsSync(rootPath)) return []
  const entries = []
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else {
        entries.push({
          path: path.relative(rootPath, full).replace(/\\/g, '/'),
          digest: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
        })
      }
    }
  }
  visit(rootPath)
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

try {
  write('data/pending-fixes.md', [
    '| PF-080 | 用户文档缺口 | open |',
    '',
    '### PF-080 状态回写',
    '- 状态：✅ closed',
    '| PF-082 | 消费者漂移 | ✅ closed |'
  ].join('\n'))
  write('data/violations.md', '| VL-020 | Agent SUMMARY missing | ✅ closed |\n')
  write('.memory/clients/codex/tasks/20260713.md', '- PF-080 已关闭\n- PF-082 open\n- VL-020 已关闭\n')
  write('.memory/clients/codex/SUMMARY.md', '- PF-080 closed\n- PF-081 open\n')
  write('.memory/clients/claude-code/SUMMARY.md', '- PF-081 closed\n')
  write('.memory/SUMMARY.md', '- PF-080 closed\n')

  const index = buildRuntimeStateIndex(root)
  const pf080 = index.records.find(record => record.recordId === 'PF-080')
  assert.ok(!pf080.conflict, 'PF-080 append-only open/closed claims are a historical transition, not current conflict')
  assert.strictEqual(pf080.normalizedStatus, 'closed')
  assert.ok(pf080.observedStatuses.includes('open') && pf080.observedStatuses.includes('closed'))
  assert.ok(pf080.historicalTransitions.some(transition => transition.from === 'open' && transition.to === 'closed' && transition.classification === 'legal'))
  assert.ok(!index.consistencyAlerts.some(alert => alert.recordId === 'PF-080'))

  const pf081 = index.records.find(record => record.recordId === 'PF-081')
  assert.ok(pf081.conflict, 'PF-081 differs across two current Agent SUMMARY projections')
  assert.deepStrictEqual(pf081.conflictingStatuses, ['closed', 'open'])
  assert.ok(index.consistencyAlerts.some(alert => alert.code === 'CONFLICTING_CURRENT_STATE' && alert.recordId === 'PF-081'))

  const pf082 = index.records.find(record => record.recordId === 'PF-082')
  assert.ok(!pf082.conflict, 'lower-authority stale consumer is not a current authority conflict')
  assert.strictEqual(pf082.normalizedStatus, 'closed')
  assert.strictEqual(pf082.consumerDrifts.length, 1)
  assert.ok(!index.consistencyAlerts.some(alert => alert.recordId === 'PF-082'))
  assert.ok(index.consistencyAlerts.some(alert => alert.code === 'MISSING_AGENT_SUMMARY' && alert.recordId === 'VL-020'))
  assert.strictEqual(normalizeStatus('状态：延期'), 'deferred')
  assert.strictEqual(normalizeStatus('🟡 residual-tail'), 'partial')
  assert.strictEqual(normalizeStatus('no state'), 'unknown')

  const output = writeDerivedIndex(root, index)
  assert.ok(fs.existsSync(output))
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(output, 'utf8')), index)
  assert.ok(fs.readFileSync(path.join(root, 'data/pending-fixes.md'), 'utf8').includes('| PF-080 | 用户文档缺口 | open |'), 'source ledger must not be rewritten')

  const projectionWrite = writeRuntimeStateProjection(root, index)
  assert.ok(['persisted', 'reused'].includes(projectionWrite.status))
  assert.strictEqual(projectionWrite.readbackVerified, true)
  const runtimeStateRoot = path.join(root, '.runtime-state')
  const beforeQuery = treeSnapshot(runtimeStateRoot)
  const projection = readRuntimeStateProjection(root)
  assert.strictEqual(projection.status, 'fresh')
  assert.strictEqual(projection.freshnessTier, 'metadata-reconciled')
  assert.deepStrictEqual(projection.index.summary, index.summary)
  assert.deepStrictEqual(projection.index.consistencyAlerts, index.consistencyAlerts)
  assert.strictEqual(projection.index.records.length, index.records.length)
  assert.ok(projection.index.records.every(record => !Object.prototype.hasOwnProperty.call(record, 'claims')))
  const loaded = loadRuntimeStateIndex(root)
  assert.strictEqual(loaded.receipt.route, 'derived-index')
  assert.deepStrictEqual(treeSnapshot(runtimeStateRoot), beforeQuery, 'derived reads must remain zero-write')

  write('data/pending-fixes.md', fs.readFileSync(path.join(root, 'data/pending-fixes.md'), 'utf8') + '\n| PF-083 | 新记录 | open |\n')
  assert.strictEqual(readRuntimeStateProjection(root).status, 'stale')
  const fallback = loadRuntimeStateIndex(root)
  assert.strictEqual(fallback.receipt.route, 'source-scan')
  assert.strictEqual(fallback.receipt.status, 'fallback')
  assert.ok(fallback.index.records.some(record => record.recordId === 'PF-083'))
  assert.deepStrictEqual(treeSnapshot(runtimeStateRoot), beforeQuery, 'fallback reads must remain zero-write')

  console.log('✓ runtime-state transitions, compact projection, stale fallback and zero-write fixtures passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
