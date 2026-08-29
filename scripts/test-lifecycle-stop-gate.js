'use strict'

/**
 * Stop gate unit tests (T3–T7 / T10 / F-04 / F-07 / F-08 / F-16)
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const KEEP_TEST_ARTIFACTS = process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1'

function cleanupTestRoot (root) {
  if (KEEP_TEST_ARTIFACTS) {
    console.log(`[test-artifact-retained] ${root}`)
    return
  }
  fs.rmSync(root, { recursive: true, force: true })
}
const {
  evaluateStopCompletionGate,
  extractLastAssistantMessage,
  askingCp2Confirm,
  hasEntryCheck,
  hasCompletionCheck,
  pr1EvidenceOk,
  findActiveTaskRoot,
  PR1_MIN_BODY_BYTES
} = require('../hooks/_runtime/lifecycle-stop-gate.cjs')
const { createTaskIdentityV2 } = require('../mcp/task-admission-authority.cjs')

/** Substantive PR-1 body that meets length + pass + substance ≥2 */
function makeStrongPr1Body () {
  const core = [
    '# 方案复审 PR-1',
    '',
    '## BlockerSnapshot',
    '| blockerId | status |',
    '| B-sample | closed |',
    '',
    '**open blocker = 0**',
    '',
    '## 验收映射',
    '| 需求 | 设计 | 验证 |',
    '| D1 | path | test |',
    '',
    '## 契约矩阵 / runtimeOwners',
    '| owner | file |',
    '| gate | lifecycle-stop-gate.cjs |',
    '',
    '## CodeTruth',
    '| repoPath | currentBehavior | negativeProbe |',
    '| hooks/_runtime/lifecycle-stop-gate.cjs | weak token green | thin body fail |',
    '',
    '## 根因',
    'pr1EvidenceOk thin-green false positive.',
    '',
    '**PR-1 ✅ 通过**（作者自审）',
    ''
  ].join('\n')
  // Pad to satisfy PR1_MIN_BODY_BYTES without inventing false claims
  const pad = '\n<!-- pad for substantive review body length -->\n'
  let body = core
  while (Buffer.byteLength(body, 'utf8') < PR1_MIN_BODY_BYTES) body += pad
  return body
}
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

// Task continuity contract: only an accepted Stop is release-eligible. A hard
// completion block must retain the live turn/owner; lifecycle integration tests
// verify the corresponding durable owner transition.
{
  const blocked = evaluateStopCompletionGate({
    mode: 'fix',
    mutated: true,
    lastAssistantMessage: '修复已全部完成。'
  })
  const accepted = evaluateStopCompletionGate({
    mode: 'fix',
    mutated: true,
    reportTouched: true,
    memoryTouched: true,
    lastAssistantMessage: [
      '### DevCodex · 入口检查',
      '- PC0 [PASS] Context plan',
      '- PC1 [PASS] Intent',
      '- PC2 [PASS] Session',
      '- PC3 [PASS] Project',
      '- PC4 [PASS] Full spec radar',
      '- PC5 [PASS] Host',
      '- PC6 [PASS] Git',
      '- PC7 [PASS] Next',
      '',
      '当前回合暂停，后续继续。'
    ].join('\n')
  })
  assert.strictEqual(blocked.decision, 'block')
  assert.strictEqual(accepted.decision, 'allow')
}

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

// T3: mutation + work-done claim + no entry → block (R11 names)
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: 'All work is complete. 已完成。'
  })
  assert.strictEqual(r.decision, 'block')
  assert.ok(r.gaps.includes('entry-check-missing'), `gaps=${r.gaps.join(',')}`)
  assert.ok(r.gaps.includes('completion-check-missing'), `gaps=${r.gaps.join(',')}`)
  assert.ok(r.gaps.includes('final-validation-summary'), `gaps=${r.gaps.join(',')}`)
}

// NoisePolicy: mid-task mutation + entry + report/memory, no work-done claim → allow without completion/FVS
{
  const mid = [
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
    'Still implementing; not done yet.'
  ].join('\n')
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    reportTouched: true,
    memoryTouched: true,
    lastAssistantMessage: mid
  })
  assert.strictEqual(r.decision, 'allow', `gaps=${r.gaps.join(',')}`)
  assert.ok(!r.gaps.includes('completion-check-missing'))
  assert.ok(!r.gaps.includes('final-validation-summary'))
}

// NoisePolicy: work-done claim + entry + short FVS only (no FC table) → allow
{
  const shortDone = [
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
    '任务完成。',
    'ECR: N/A',
    'skipReason=simple-task',
    '报告: N/A',
    '',
    '### FinalValidationSummaryV1',
    '**白话：** 修复已验证通过。',
    '**证据：** `npm run test:visible-output` exitCode 0 · 关键计数 1/1',
    'WorkspaceSyncStatus: N/A 未触发',
    'dirty boundary: git status clean-tree; 工作树干净',
    'Release actions: push/tag/publish 未执行'
  ].join('\n')
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    reportTouched: true,
    memoryTouched: true,
    lastAssistantMessage: shortDone
  })
  assert.strictEqual(r.decision, 'allow', `gaps=${r.gaps.join(',')}`)
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

// Stop re-entry is observation-only immediately; never create another continuation.
{
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    mutated: true,
    lastAssistantMessage: 'incomplete',
    stopHookActive: true,
    continuationCount: 0,
    softCap: 8
  })
  assert.strictEqual(r.decision, 'allow')
  assert.ok(r.honesty.processGaps.includes('stop-reentrant-observation-only'))
}

// T10 pr1-skipped
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-stop-gate-pr1-'))
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
    cleanupTestRoot(tmp)
  }
}

// T10b strong PR-1 ok (substantive 03 body — not thin open-blocker-only)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-stop-gate-pr1-ok-'))
  try {
    const taskRoot = path.join(tmp, 'requirements', 'ok')
    fs.mkdirSync(taskRoot, { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# plan\n控制面 lifecycle\n', 'utf8')
    fs.writeFileSync(path.join(taskRoot, '03-方案复审-PR1.md'), makeStrongPr1Body(), 'utf8')
    assert.strictEqual(pr1EvidenceOk(taskRoot), true)
    const r = evaluateStopCompletionGate({
      mode: 'dev',
      lastAssistantMessage: '请确认技术方案（确认 CP2）。',
      taskRoot
    })
    assert.ok(!r.gaps.includes('pr1-skipped'), `gaps=${r.gaps.join(',')}`)
  } finally {
    cleanupTestRoot(tmp)
  }
}

// R3B3b: Stop/PR-1 must use the exact session-bound task, never latest 02 mtime.
{
  const activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-stop-target-first-'))
  try {
    const project = 'fixture-project'
    const rootIdentityDigest = 'a'.repeat(64)
    const taskId = '12345678-1234-4123-8123-1234567890ab'
    const taskRoot = path.join(activeRoot, 'bugs', 'bound-bug')
    const decoyRoot = path.join(activeRoot, 'requirements', 'newer-decoy')
    fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
    fs.mkdirSync(decoyRoot, { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-修复方案.md'), '# bound bug design\n控制面 lifecycle\n', 'utf8')
    fs.writeFileSync(path.join(decoyRoot, '02-技术方案.md'), '# decoy design\n控制面 lifecycle\n', 'utf8')
    fs.writeFileSync(path.join(decoyRoot, '03-方案复审-PR1.md'), makeStrongPr1Body(), 'utf8')
    const portableIdentity = createTaskIdentityV2({
      taskId,
      displayName: 'bound-bug',
      aliases: [],
      project,
      projectRootIdentityDigest: 'b'.repeat(64),
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: 'bugs/bound-bug',
      createdAt: new Date().toISOString()
    })
    const identityPath = path.join(taskRoot, '.memory', 'task-identity-v2.json')
    fs.writeFileSync(identityPath, JSON.stringify(portableIdentity, null, 2), 'utf8')
    const state = {
      activeProject: project,
      stickyProject: {
        schemaVersion: 'ProjectTargetLeaseV2',
        project,
        activeRoot,
        rootIdentityDigest
      },
      taskRecoveryBinding: {
        schemaVersion: 'TaskRecoveryBindingV1',
        taskId,
        displayName: 'bound-bug',
        project,
        kind: 'bugs',
        taskRoot,
        status: 'active'
      }
    }
    assert.strictEqual(findActiveTaskRoot(state), taskRoot)
    const boundResult = evaluateStopCompletionGate({
      mode: 'fix',
      lastAssistantMessage: '请确认修复方案（确认 CP2）。',
      state
    })
    assert.strictEqual(boundResult.decision, 'block')
    assert(boundResult.gaps.includes('pr1-skipped'), `gaps=${boundResult.gaps.join(',')}`)
    assert(!boundResult.gaps.includes('pr1-task-binding-missing'))

    fs.writeFileSync(path.join(taskRoot, '03-方案复审-PR1.md'), makeStrongPr1Body(), 'utf8')
    const reviewed = evaluateStopCompletionGate({
      mode: 'fix',
      lastAssistantMessage: '请确认修复方案（确认 CP2）。',
      state
    })
    assert(!reviewed.gaps.includes('pr1-skipped'), `gaps=${reviewed.gaps.join(',')}`)

    fs.writeFileSync(identityPath, JSON.stringify({
      ...portableIdentity,
      identityDigest: 'c'.repeat(64)
    }, null, 2), 'utf8')
    assert.strictEqual(findActiveTaskRoot(state), null, 'tampered TaskIdentityV2 must fail closed')
    fs.writeFileSync(identityPath, JSON.stringify({
      ...portableIdentity,
      schemaVersion: 'UnknownTaskIdentity'
    }, null, 2), 'utf8')
    assert.strictEqual(findActiveTaskRoot(state), null, 'unknown task identity schema must fail closed')
    fs.writeFileSync(identityPath, JSON.stringify(portableIdentity, null, 2), 'utf8')

    const staleState = JSON.parse(JSON.stringify(state))
    staleState.taskRecoveryBinding.taskId = '87654321-4321-4321-8321-ba0987654321'
    assert.strictEqual(findActiveTaskRoot(staleState), null)
    const missingBinding = evaluateStopCompletionGate({
      mode: 'fix',
      lastAssistantMessage: '请确认修复方案（确认 CP2）。',
      state: staleState
    })
    assert(missingBinding.gaps.includes('pr1-task-binding-missing'))

    const explicitlyStale = evaluateStopCompletionGate({
      mode: 'fix',
      lastAssistantMessage: '请确认修复方案（确认 CP2）。',
      taskRoot,
      taskBindingVerified: false,
      state
    })
    assert(explicitlyStale.gaps.includes('pr1-task-binding-missing'))
  } finally {
    cleanupTestRoot(activeRoot)
  }
}

// F-04: weak "通过" must NOT pass pr1EvidenceOk
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-stop-gate-pr1-weak-'))
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
    cleanupTestRoot(tmp)
  }
}

// D-PR1-1: open blocker = 0 alone is thin-green → false
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-stop-gate-pr1-thin-ob-'))
  try {
    const taskRoot = path.join(tmp, 't')
    fs.mkdirSync(taskRoot, { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# plan\n', 'utf8')
    fs.writeFileSync(path.join(taskRoot, '03-方案复审-PR1.md'), '# PR-1\nopen blocker = 0\n', 'utf8')
    assert.strictEqual(pr1EvidenceOk(taskRoot), false)
  } finally {
    cleanupTestRoot(tmp)
  }
}

// D-PR1-2: bare PR-1 | ✅ table is not a pass signal → false
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-stop-gate-pr1-table-'))
  try {
    const taskRoot = path.join(tmp, 't')
    fs.mkdirSync(taskRoot, { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# plan\n', 'utf8')
    const thin = [
      '# 复审',
      '| CP | 状态 |',
      '| PR-1 | ✅ |',
      'x'.repeat(1300)
    ].join('\n')
    fs.writeFileSync(path.join(taskRoot, '03-方案复审-PR1.md'), thin, 'utf8')
    assert.strictEqual(pr1EvidenceOk(taskRoot), false)
  } finally {
    cleanupTestRoot(tmp)
  }
}

// D-PR1-4: with 02 present, sessions-only PR-1 ✅ is not enough
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-stop-gate-pr1-sess-'))
  try {
    const taskRoot = path.join(tmp, 't')
    fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
    fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# plan\n', 'utf8')
    fs.writeFileSync(
      path.join(taskRoot, '.memory', 'sessions.md'),
      '| PR-1 | ✅ |\n',
      'utf8'
    )
    assert.strictEqual(pr1EvidenceOk(taskRoot), false)
  } finally {
    cleanupTestRoot(tmp)
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
