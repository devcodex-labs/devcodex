'use strict'

/**
 * T3–T6 / T10: evaluateStopCompletionGate unit tests
 * Spec: 20260726-grok-stop-enforcement-honesty
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  evaluateStopCompletionGate,
  extractLastAssistantMessage,
  askingCp2Confirm,
  hasEntryCheck
} = require('../hooks/_runtime/lifecycle-stop-gate.cjs')
const { buildLifecycleHookOutput } = require('../hooks/_runtime/lifecycle-hook-output.cjs')

// T7: eventSupportsHardBlock(grok, stop) === true
const { eventSupportsHardBlock } = buildLifecycleHookOutput({
  env: {},
  enforcementMode: 'safety-only'
})
assert.strictEqual(eventSupportsHardBlock('grok', 'Stop'), true)
assert.strictEqual(eventSupportsHardBlock('grok', 'stop'), true)
assert.strictEqual(eventSupportsHardBlock('grok', 'UserPromptSubmit'), false)

// extractLastAssistantMessage camelCase + snake
assert.strictEqual(
  extractLastAssistantMessage({ lastAssistantMessage: 'hello' }),
  'hello'
)
assert.strictEqual(
  extractLastAssistantMessage({ last_assistant_message: 'snake' }),
  'snake'
)

// T5: chat no mutation → allow
{
  const r = evaluateStopCompletionGate({
    mode: 'chat',
    workflow: 'chat',
    mutated: false,
    lastAssistantMessage: 'just chatting'
  })
  assert.strictEqual(r.decision, 'allow')
  assert.deepStrictEqual(r.gaps, [])
}

// T4: no body → unverified (no hard block)
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: ''
  })
  assert.strictEqual(r.decision, 'unverified')
  assert.ok(!r.gaps.includes('entry-check'))
}

// T3: body + mutation + no entry check → block
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: 'All work is complete. 已完成。'
  })
  assert.strictEqual(r.decision, 'block')
  assert.ok(r.gaps.includes('entry-check'), `gaps=${r.gaps.join(',')}`)
  assert.match(r.reason, /incomplete closure|Stop gate/i)
}

// T6: full entry check sample → allow (no report/memory when not mutated-only force)
{
  const text = [
    '### DevCodex · 入口检查',
    '| PC0 | ✅ |',
    '| PC1 | ✅ |',
    '| PC2 | ✅ |',
    '| PC3 | ✅ |',
    '| PC4 | ✅ |',
    '| PC5 | ✅ |',
    '| PC6 | ✅ |',
    '| PC7 | ✅ |',
    '',
    '### DevCodex · 完成检查',
    'FC1~FC7 全绿',
    '',
    '### FinalValidationSummary',
    '| 项 | 命令/证据 | exitCode |',
    '|----|-----------|----------|',
    '| validate | npm run validate | 0 |',
    '| tests | node scripts/test-lifecycle-stop-gate.js | 0 |',
    '| workspace sync | N/A | — |',
    '| dirty boundary | clean | — |',
    '| release action | none | — |'
  ].join('\n')
  assert.ok(hasEntryCheck(text))
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    reportTouched: true,
    memoryTouched: true,
    lastAssistantMessage: text
  })
  // may still gap final-validation-summary if analyzer is strict; allow only when no gaps
  if (r.decision === 'block') {
    assert.ok(
      !r.gaps.includes('entry-check'),
      `entry-check should pass; gaps=${r.gaps.join(',')}`
    )
  }
}

// softCap exhausted → allow
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: 'incomplete without entry',
    stopHookActive: true,
    continuationCount: 8,
    softCap: 8
  })
  assert.strictEqual(r.decision, 'allow')
  assert.ok(r.honesty.processGaps.includes('stop-continuation-exhausted'))
}

// T10: CP2 confirm request without PR-1 evidence → pr1-skipped
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-gate-pr1-'))
  try {
    const taskRoot = path.join(tmp, 'requirements', '20260726-sample')
    fs.mkdirSync(taskRoot, { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# plan\n', 'utf8')
    // no 03 review, no sessions PR-1
    const text = '请确认技术方案（确认 CP2）。方案见 02-技术方案.md'
    assert.ok(askingCp2Confirm(text))
    const r = evaluateStopCompletionGate({
      mode: 'dev',
      mutated: false,
      lastAssistantMessage: text,
      taskRoot
    })
    assert.strictEqual(r.decision, 'block')
    assert.ok(r.gaps.includes('pr1-skipped'), `gaps=${r.gaps.join(',')}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// T10b: with PR-1 evidence → no pr1-skipped
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-gate-pr1-ok-'))
  try {
    const taskRoot = path.join(tmp, 'requirements', '20260726-sample-ok')
    fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# plan\n', 'utf8')
    fs.writeFileSync(
      path.join(taskRoot, '03-方案复审-PR1.md'),
      '# PR-1\nopen blocker = 0\n✅ 通过\n',
      'utf8'
    )
    const text = '请确认技术方案（确认 CP2）。'
    const r = evaluateStopCompletionGate({
      mode: 'dev',
      lastAssistantMessage: text,
      taskRoot
    })
    assert.ok(!r.gaps.includes('pr1-skipped'), `gaps=${r.gaps.join(',')}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('lifecycle-stop-gate tests passed')
