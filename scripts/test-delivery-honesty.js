'use strict'

/**
 * T-HONEST delivery honesty samples (A/B/H + regression hooks).
 */

const assert = require('assert')
const {
  classifyDeliveryHonesty,
  classifyReviewChecklistCompletion,
  classifyProcessArtifactCompleteness,
  ERROR_CODES
} = require('./lib/process-enforcement.js')
const { evaluateStopCompletionGate } = require('../hooks/_runtime/lifecycle-stop-gate.cjs')

// T-HONEST-01: completion + control-plane work + no report path
{
  const r = classifyDeliveryHonesty({
    completionClaimed: true,
    mode: 'dev',
    text: '控制面任务已完成 可关闭需求 Fix-A 全部完成'
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.gaps.includes(ERROR_CODES.STAGE_REPORT_MISSING), r.gaps.join(','))
}

// T-HONEST-04: overclaim without validation evidence
{
  const r = classifyDeliveryHonesty({
    completionClaimed: true,
    mode: 'dev',
    text: '5/6 完成 只差验收 全部✅ 可关闭需求 reports/foo/01--x.md'
  })
  // has report path so no stage-report; overclaim still if no exitCode evidence
  assert.ok(r.gaps.includes(ERROR_CODES.PROGRESS_OVERCLAIM), r.gaps.join(','))
}

// with evidence: no overclaim
{
  const r = classifyDeliveryHonesty({
    completionClaimed: true,
    mode: 'dev',
    text: [
      '任务完成',
      'reports/requirements/grok/20260727/01--诚实报告.md',
      '#### 验证摘要',
      '| 权威 | `npm run test:delivery-honesty` | exitCode 0 |'
    ].join('\n')
  })
  assert.strictEqual(r.ok, true, r.gaps && r.gaps.join(','))
}

// T-HONEST-05: chat
{
  const r = classifyDeliveryHonesty({
    completionClaimed: true,
    mode: 'chat',
    text: '任务完成了 谢谢'
  })
  assert.strictEqual(r.ok, true)
}

// T-HONEST-06: SimpleTask exemption
{
  const r = classifyDeliveryHonesty({
    completionClaimed: true,
    mode: 'dev',
    text: '已完成 SimpleTaskFastPath 报告: N/A skipReason=simple-task'
  })
  assert.strictEqual(r.ok, true)
}

// T-HONEST-03: checklist missing R3
{
  const r = classifyReviewChecklistCompletion({
    completionClaimed: true,
    reviewClass: 'R3',
    text: '已完成 控制面 ECR'
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.gap, ERROR_CODES.REVIEW_CHECKLIST_MISSING)
}

// T-HONEST-02 style process package
{
  const r = classifyProcessArtifactCompleteness({
    completionClaimed: true,
    controlPlaneTask: true,
    text: '控制面已完成',
    hasImplementationPlan: true,
    hasProgressFile: false,
    hasReviewChecklist: true
  })
  assert.strictEqual(r.ok, false)
}

// Golden negative set (>=10 overclaim / missing-report samples)
const goldenBad = [
  'dev 任务已完成 可关闭需求',
  'Fix-1 全 ✅ Fix-2 全 ✅ 任务完成',
  '5/6 完成 只差验收',
  '本需求闭环 全部完成',
  'ECR 完成 控制面 已完成',
  '多批次实施 已完成 全绿',
  'hooks 修改 任务完成 宣告完成',
  'website 已修 可关闭需求',
  'DoD 闭环 全部✅',
  '100% 完成 控制面 已完成',
  'Phase-A 完成 Phase-B 完成 任务完成'
]
let badHits = 0
for (const sample of goldenBad) {
  const r = classifyDeliveryHonesty({ completionClaimed: true, mode: 'dev', text: sample })
  if (!r.ok) badHits++
}
assert.ok(badHits >= 10, `golden bad hits=${badHits}`)

// Stop gate integration: overclaim + no report → includes honesty gap
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
      '5/6 完成 只差验收 控制面 全部完成 可关闭需求'
    ].join('\n')
  })
  assert.strictEqual(r.decision, 'block')
  assert.ok(
    r.gaps.includes('stage-report-missing') ||
      r.gaps.includes('progress-overclaim') ||
      r.gaps.includes('final-validation-summary'),
    `gaps=${r.gaps.join(',')}`
  )
}

console.log('test-delivery-honesty: T-HONEST samples + golden set passed')
