'use strict'

/**
 * T-ECR: ecr-missing classifier + stop-gate integration samples.
 */

const assert = require('assert')
const {
  classifyEcrClosure,
  classifyDeliveryHonesty,
  ERROR_CODES
} = require('./lib/process-enforcement.js')
const { evaluateStopCompletionGate } = require('../hooks/_runtime/lifecycle-stop-gate.cjs')

// T-ECR-01
{
  const r = classifyEcrClosure({
    mode: 'dev',
    text: '控制面任务已完成 可关闭需求'
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.gap, ERROR_CODES.ECR_MISSING)
}

// T-ECR-02: green table without ECR
{
  const r = classifyEcrClosure({
    mode: 'dev',
    text: [
      '任务完成 可关闭需求',
      '| 权威 | npm run test:x | exitCode 0 |',
      '全绿'
    ].join('\n')
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.gap, ERROR_CODES.ECR_MISSING)
}

// T-ECR-03: ECR + DoD matrix
{
  const r = classifyEcrClosure({
    mode: 'dev',
    text: [
      '任务已完成 可关闭需求',
      'reports/requirements/grok/20260727/01--ECR-闭环报告.md',
      '## ECR 执行闭环复审',
      '| DoD | 结果 |',
      '| D1 | ✅ |',
      '| ECR-1 | ✅ |'
    ].join('\n')
  })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
}

// T-ECR-04: chat
{
  const r = classifyEcrClosure({
    mode: 'chat',
    text: '任务完成了 可关闭需求'
  })
  assert.strictEqual(r.ok, true)
}

// Golden negatives
const bad = [
  '需求已完成 可关闭需求',
  'dev 已完成 宣告完成',
  'DoD 闭环 只差验收',
  '本需求闭环 已完成',
  '控制面 任务完成 全绿',
  'Fix 完成 可关闭需求',
  '实施已完成 需求已完成',
  'ECR 没写但 可关闭需求'
]
let hits = 0
for (const t of bad) {
  const r = classifyEcrClosure({ mode: 'dev', text: t })
  if (!r.ok) hits++
}
assert.ok(hits >= 8, `hits=${hits}`)

// Stop integration
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    workflow: 'dev',
    mutated: true,
    reportTouched: true,
    memoryTouched: true,
    lastAssistantMessage: [
      '### DevCodex · 入口检查',
      'PC0 | ok',
      '### DevCodex · 完成检查',
      '| 类型 | 命令 | exitCode |',
      '| 权威 | `npm run test:x` | exitCode 0 |',
      'reports/x/01--stage.md',
      '任务已完成 可关闭需求'
    ].join('\n')
  })
  assert.strictEqual(r.decision, 'block')
  assert.ok(r.gaps.includes('ecr-missing'), `gaps=${r.gaps.join(',')}`)
}

// Regression: delivery honesty still callable
{
  const r = classifyDeliveryHonesty({
    mode: 'dev',
    text: '控制面已完成 可关闭需求'
  })
  assert.strictEqual(r.ok, false)
}

console.log('test-ecr-closure: T-ECR samples passed')
