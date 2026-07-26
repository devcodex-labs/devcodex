'use strict'

/**
 * Stop gate unit tests (T3–T7 / T10 / F-04 / F-07 / F-08 / F-16)
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  evaluateStopCompletionGate,
  extractLastAssistantMessage,
  askingCp2Confirm,
  hasEntryCheck,
  hasCompletionCheck,
  pr1EvidenceOk
} = require('../hooks/_runtime/lifecycle-stop-gate.cjs')
const { buildLifecycleHookOutput } = require('../hooks/_runtime/lifecycle-hook-output.cjs')
const { buildLifecyclePayloadUtils } = require('../hooks/_runtime/lifecycle-payload-utils.cjs')

const { eventSupportsHardBlock } = buildLifecycleHookOutput({
  env: {},
  enforcementMode: 'safety-only'
})
assert.strictEqual(eventSupportsHardBlock('grok', 'Stop'), true)
assert.strictEqual(eventSupportsHardBlock('grok', 'UserPromptSubmit'), false)

// F-03: getVisibleReplyEvidence must observe lastAssistantMessage
{
  const api = buildLifecyclePayloadUtils({
    fs,
    path,
    payloadPreviewLimit: 2000,
    transcriptTailLimit: 2000,
    safeJsonParse: JSON.parse,
    normalizeText: s => String(s || '')
  })
  const body = '### DevCodex · 完成检查\nPASS\n'
  const ev = api.getVisibleReplyEvidence({ lastAssistantMessage: body })
  assert.strictEqual(ev.observed, true)
  assert.strictEqual(ev.source, 'lastAssistantMessage')
  assert.match(ev.text, /完成检查/)
}

assert.strictEqual(extractLastAssistantMessage({ lastAssistantMessage: 'hello' }), 'hello')
assert.strictEqual(extractLastAssistantMessage({ last_assistant_message: 'snake' }), 'snake')

// T5: chat no mutation
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

// T4: no body
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: ''
  })
  assert.strictEqual(r.decision, 'unverified')
  assert.ok(!r.gaps.includes('entry-check-missing'))
}

// T3: mutation + no entry → block (R11 names)
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: 'All work is complete. 已完成。'
  })
  assert.strictEqual(r.decision, 'block')
  assert.ok(r.gaps.includes('entry-check-missing'), `gaps=${r.gaps.join(',')}`)
  assert.ok(r.gaps.includes('completion-check-missing'), `gaps=${r.gaps.join(',')}`)
}

// F-14/F-16: hasCompletionCheck
assert.ok(hasCompletionCheck('### DevCodex · 完成检查\nx'))
assert.ok(!hasCompletionCheck('已完成但没有标题'))

// F-08: artifact exemption
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: [
      '### DevCodex · 入口检查',
      'PC0 | ok',
      '### DevCodex · 完成检查',
      '| 类型 | 命令 | exitCode | runId/计数 |',
      '| 权威 | `npm run test:visible-output` | exitCode 0 | runId=validation-202607230001 / checks=42 |',
      'WorkspaceSyncStatus: skipped (无需同步)',
      'dirty boundary: git status clean; no unrelated dirty',
      'Release actions: push/tag/release/publish 未执行',
      '报告: N/A',
      '记忆: N/A',
      'skipReason: probe'
    ].join('\n')
  })
  assert.ok(!r.gaps.includes('report-missing'), `gaps=${r.gaps.join(',')}`)
  assert.ok(!r.gaps.includes('memory-missing'), `gaps=${r.gaps.join(',')}`)
}

// T6: full entry + completion + FVS + report/memory touches
{
  const text = [
    '### DevCodex · 入口检查',
    '- PC0 [PASS] Context plan',
    '- PC1 [PASS] Intent',
    '- PC2 [PASS] Session',
    '- PC3 [PASS] Project',
    '- PC4 [N/A] skipReason=non-dev',
    '- PC5 [PASS] Host',
    '- PC6 [PASS] Git',
    '- PC7 [PASS] Next',
    '',
    '### DevCodex · 完成检查',
    '| 类型 | 命令 | exitCode | runId/计数 |',
    '| 权威 | `npm run test:visible-output` | exitCode 0 | runId=validation-202607230001 / checks=42 |',
    'WorkspaceSyncStatus: skipped (无需同步)',
    'dirty boundary: git status clean; no unrelated dirty',
    'Release actions: push/tag/release/publish 未执行',
    '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'c'.repeat(64) + '`'
  ].join('\n')
  assert.ok(hasEntryCheck(text))
  assert.ok(hasCompletionCheck(text))
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    reportTouched: true,
    memoryTouched: true,
    lastAssistantMessage: text
  })
  assert.strictEqual(r.decision, 'allow', `gaps=${r.gaps.join(',')}`)
}

// softCap
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: 'incomplete',
    stopHookActive: true,
    continuationCount: 8,
    softCap: 8
  })
  assert.strictEqual(r.decision, 'allow')
  assert.ok(r.honesty.processGaps.includes('stop-continuation-exhausted'))
}

// T10 pr1-skipped
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-gate-pr1-'))
  try {
    const taskRoot = path.join(tmp, 'requirements', 'sample')
    fs.mkdirSync(taskRoot, { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# plan\n', 'utf8')
    const text = '请确认技术方案（确认 CP2）。'
    assert.ok(askingCp2Confirm(text))
    const r = evaluateStopCompletionGate({
      mode: 'dev',
      mutated: false,
      lastAssistantMessage: text,
      taskRoot
    })
    assert.strictEqual(r.decision, 'block')
    assert.ok(r.gaps.includes('pr1-skipped'))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// T10b strong PR-1 ok
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-gate-pr1-ok-'))
  try {
    const taskRoot = path.join(tmp, 'requirements', 'ok')
    fs.mkdirSync(taskRoot, { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# plan\n', 'utf8')
    fs.writeFileSync(
      path.join(taskRoot, '03-方案复审-PR1.md'),
      '# PR-1\nopen blocker = 0\n',
      'utf8'
    )
    const r = evaluateStopCompletionGate({
      mode: 'dev',
      lastAssistantMessage: '请确认技术方案（确认 CP2）。',
      taskRoot
    })
    assert.ok(!r.gaps.includes('pr1-skipped'), `gaps=${r.gaps.join(',')}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// F-04: weak "通过" must NOT pass pr1EvidenceOk
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-gate-pr1-weak-'))
  try {
    const taskRoot = path.join(tmp, 't')
    fs.mkdirSync(taskRoot, { recursive: true })
    fs.writeFileSync(
      path.join(taskRoot, '03-方案复审-PR1.md'),
      '提到 PR-1。\n某某测试通过。\n',
      'utf8'
    )
    assert.strictEqual(pr1EvidenceOk(taskRoot), false)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// F-13: adaptGrokOutput preserves Stop block after gate-shaped output
{
  const { adaptHostOutput } = require('../hooks/_runtime/lifecycle-host-adapters.cjs')
  const out = adaptHostOutput('grok', 'Stop', {
    decision: 'block',
    reason: 'DevCodex Stop gate: incomplete closure — missing: entry-check-missing'
  })
  assert.strictEqual(out.decision, 'block')
  assert.match(out.reason, /entry-check-missing|incomplete/)
  assert.strictEqual(out.devcodexGrokEvidenceMode, 'stop-decision-block')
}

console.log('lifecycle-stop-gate tests passed')
