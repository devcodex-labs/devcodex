#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildRuntimeStateIndex,
  normalizeStatus,
  writeDerivedIndex
} = require('./lib/runtime-state-index')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-runtime-state-'))
function write(relative, content) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
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

  console.log('✓ runtime-state transitions, current conflicts, consumer drift, missing-summary and read-only fixtures passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
