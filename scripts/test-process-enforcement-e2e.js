'use strict'

/**
 * Process enforcement E2E-01～10 (isolated pure-function + matrix assertions).
 * Spec: requirements/全宿主流程强制与产物路径准确/02-技术方案.md §8
 *
 * Uses tmp paths only — does not mutate user workspace.
 */

const assert = require('assert')
const path = require('path')
const fs = require('fs')

const {
  shouldHardDenyCpMutation,
  classifyRequirementsArtifactPath,
  classifyPathsForArtifacts,
  classifyReviewChecklistCompletion,
  classifyProcessArtifactCompleteness,
  classifyImplementStartGate,
  probeProcessTriad,
  simpleTaskForbidsPath,
  isStrictProtectedPath,
  ERROR_CODES
} = require('./lib/process-enforcement.js')

const {
  assertSixHosts,
  listHostIds,
  getHostEnforcement,
  summarizeMatrix,
  HOST_ENFORCEMENT_MATRIX_V1
} = require('./lib/host-enforcement-matrix.js')

const {
  evaluateStopCompletionGate,
  askingCp2Confirm
} = require('../hooks/_runtime/lifecycle-stop-gate.cjs')

const lifecycleSrc = fs.readFileSync(
  path.join(__dirname, '../hooks/_runtime/lifecycle.cjs'),
  'utf8'
)
const stopSrc = fs.readFileSync(
  path.join(__dirname, '../hooks/_runtime/lifecycle-stop-gate.cjs'),
  'utf8'
)

// ── E2E-01: no CP2 write website/source → hard deny ─────────────────────────
{
  const gate = { phase: 'CP2', reqName: 'demo' }
  const paths = ['website/docs/guide/development.md', 'hooks/_runtime/lifecycle.cjs']
  for (const p of paths) {
    const r = shouldHardDenyCpMutation(gate, [p], { strictEnv: false })
    assert.strictEqual(r.hardDeny, true, `E2E-01 expect hard deny for ${p}`)
    assert.strictEqual(r.reason, ERROR_CODES.CP2_REQUIRED)
  }
  // Non-protected under safety-only: warn path (not hard)
  const soft = shouldHardDenyCpMutation(gate, ['src/app.js'], { strictEnv: false })
  assert.strictEqual(soft.hardDeny, false, 'E2E-01 non-protected safety-only soft')
  // Strict env still hard
  const strict = shouldHardDenyCpMutation(gate, ['src/app.js'], { strictEnv: true })
  assert.strictEqual(strict.hardDeny, true, 'E2E-01 strict env hard')
  console.log('E2E-01 PASS')
}

// ── E2E-02: orphan control plane ────────────────────────────────────────────
{
  const gate = {
    phase: 'CP3',
    code: 'cp-gate-orphan-control-plane',
    reqName: 'no-bound-task'
  }
  const r = shouldHardDenyCpMutation(gate, ['hooks/_runtime/lifecycle.cjs'], { strictEnv: false })
  assert.strictEqual(r.hardDeny, true)
  assert.strictEqual(r.reason, ERROR_CODES.ORPHAN_CONTROL_PLANE)
  console.log('E2E-02 PASS')
}

// ── E2E-03: CP2 confirmed → no gate → no deny ───────────────────────────────
{
  const r = shouldHardDenyCpMutation(null, ['hooks/_runtime/lifecycle.cjs'], { strictEnv: false })
  assert.strictEqual(r.hardDeny, false)
  console.log('E2E-03 PASS')
}

// ── E2E-04: SimpleTask forbids docs/control plane; allows ordinary file ──────
{
  assert.strictEqual(simpleTaskForbidsPath('website/docs/intro.md'), true)
  assert.strictEqual(simpleTaskForbidsPath('hooks/_runtime/lifecycle.cjs'), true)
  assert.strictEqual(simpleTaskForbidsPath('skills/cp-gate/SKILL.md'), true)
  assert.strictEqual(simpleTaskForbidsPath('src/feature.js'), false)
  assert.strictEqual(simpleTaskForbidsPath('.devcodex/devcodex/reports/x.md'), false)
  assert.doesNotMatch(lifecycleSrc, /simpleTaskForbidsPath/)
  assert.match(lifecycleSrc, /validateSimpleTaskFastPathLease/)
  assert.match(lifecycleSrc, /simpleTaskFastPathAuthority/)
  console.log('E2E-04 PASS')
}

// ── E2E-05: requirements/02-盘点 → ARTIFACT_PATH_INVALID ─────────────────────
{
  const bad = classifyRequirementsArtifactPath(
    'requirements/全宿主流程强制与产物路径准确/02-功能清单盘点.md'
  )
  assert.strictEqual(bad.ok, false)
  assert.strictEqual(bad.code, ERROR_CODES.ARTIFACT_PATH_INVALID)

  const good = classifyRequirementsArtifactPath(
    'requirements/全宿主流程强制与产物路径准确/02-技术方案.md'
  )
  assert.strictEqual(good.ok, true)

  const multi = classifyPathsForArtifacts([
    'requirements/demo/02-完整功能清单.md',
    'src/ok.js'
  ])
  assert.strictEqual(multi.ok, false)
  console.log('E2E-05 PASS')
}

// ── E2E-06: wrong path analysis / 04 slot ───────────────────────────────────
{
  const planBad = classifyRequirementsArtifactPath(
    'requirements/demo/04-遗漏扫盘点.md'
  )
  assert.strictEqual(planBad.ok, false)
  assert.strictEqual(planBad.code, ERROR_CODES.ARTIFACT_PATH_INVALID)

  const planGood = classifyRequirementsArtifactPath(
    'requirements/demo/04-实施计划.md'
  )
  assert.strictEqual(planGood.ok, true)

  // Analysis under reports is not blocked by this classifier
  const report = classifyRequirementsArtifactPath(
    'reports/analysis/grok/20260726/01--功能清单.md'
  )
  assert.strictEqual(report.ok, true)
  console.log('E2E-06 PASS')
}

// ── E2E-07: completion claim R3 without checklist → gap ─────────────────────
{
  const missing = classifyReviewChecklistCompletion({
    completionClaimed: true,
    reviewClass: 'R3',
    text: '已完成 控制面任务 ECR R3 收口',
    hasReviewChecklistPath: false
  })
  assert.strictEqual(missing.ok, false)
  assert.strictEqual(missing.gap, ERROR_CODES.REVIEW_CHECKLIST_MISSING)

  const present = classifyReviewChecklistCompletion({
    completionClaimed: true,
    reviewClass: 'R3',
    text: '已完成 review-checklists/20260726--x.md ECR R3',
    hasReviewChecklistPath: false
  })
  assert.strictEqual(present.ok, true)

  const stop = evaluateStopCompletionGate({
    mode: 'dev',
    workflow: 'dev',
    mutated: true,
    reportTouched: true,
    memoryTouched: true,
    lastAssistantMessage: [
      '### DevCodex · 入口检查',
      'PC0 | ok',
      '### DevCodex · 完成检查',
      '| 类型 | 命令 | exitCode | runId/计数 |',
      '| 权威 | `npm run test:process-enforcement-e2e` | exitCode 0 | runId=pe-e2e / checks=10 |',
      'WorkspaceSyncStatus: skipped (无需同步)',
      'dirty boundary: git status clean; no unrelated dirty',
      '已完成 控制面 reviewClass=R3 ECR 任务完成'
    ].join('\n')
  })
  assert.strictEqual(stop.decision, 'block')
  assert.ok(
    stop.gaps.includes('review-checklist-missing') || stop.gaps.includes('final-validation-summary'),
    `E2E-07 gaps=${stop.gaps.join(',')}`
  )
  // Prefer explicit checklist gap when FVS is also thin; at least one process gap
  assert.ok(stop.gaps.length > 0)
  console.log('E2E-07 PASS')
}

// ── E2E-08: pr1-skipped still works ─────────────────────────────────────────
{
  assert.ok(askingCp2Confirm('请确认技术方案 v1.0'))
  const tmpRoot = path.join(require('os').tmpdir(), `pe-e2e-pr1-${process.pid}`)
  fs.mkdirSync(tmpRoot, { recursive: true })
  fs.writeFileSync(path.join(tmpRoot, '02-技术方案.md'), '# design\n', 'utf8')
  // no PR-1 evidence
  const r = evaluateStopCompletionGate({
    mode: 'dev',
    workflow: 'dev',
    mutated: false,
    lastAssistantMessage: [
      '### DevCodex · 入口检查',
      'PC0 | ok',
      '请确认技术方案',
      '确认 CP2'
    ].join('\n'),
    taskRoot: tmpRoot
  })
  assert.ok(r.gaps.includes('pr1-skipped'), `E2E-08 gaps=${r.gaps.join(',')}`)
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  console.log('E2E-08 PASS')
}

// ── E2E-09: six-host matrix consistent ──────────────────────────────────────
{
  assertSixHosts()
  const ids = listHostIds()
  assert.deepStrictEqual(ids.sort(), ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'grok'].sort())
  for (const id of ids) {
    const h = getHostEnforcement(id)
    assert.ok(h, `host ${id}`)
    assert.ok(
      ['host-owned-advisory', 'hard-deny', 'stop-block', 'honesty-only', 'N/A+platform-limit'].some(
        (v) => h.preToolMutationNoCp2 === v || h.stopCompletion === v || h.upsInject === v
      ) || h.preToolMutationNoCp2 === 'host-owned-advisory',
      `host ${id} fields`
    )
    assert.strictEqual(h.preToolMutationNoCp2, 'host-owned-advisory', `${id} operation authority`)
  }
  const summary = summarizeMatrix()
  assert.strictEqual(summary.length, 6)
  assert.strictEqual(HOST_ENFORCEMENT_MATRIX_V1.schemaVersion, 'HostEnforcementMatrixV1')
  console.log('E2E-09 PASS')
}

// ── E2E-10: Grok UPS N/A — no fake inject green ─────────────────────────────
{
  const grok = getHostEnforcement('grok')
  assert.strictEqual(grok.upsInject, 'N/A+platform-limit')
  assert.ok(/UPS|inject|N\/A/i.test(grok.upsNotes || ''), 'Grok ups notes')
  assert.strictEqual(grok.preToolMutationNoCp2, 'host-owned-advisory')
  assert.strictEqual(grok.stopCompletion, 'stop-block')
  // Must not claim UPS inject as hard-deny success path
  assert.notStrictEqual(grok.upsInject, 'hard-deny')
  console.log('E2E-10 PASS')
}

// ── E2E-10B: Cursor local Beta is hard at PreTool and bounded at Stop ────────
{
  const cursor = getHostEnforcement('cursor')
  assert.strictEqual(cursor.preToolMutationNoCp2, 'host-owned-advisory')
  assert.strictEqual(cursor.stopCompletion, 'stop-followup')
  assert.strictEqual(cursor.upsInject, 'session-start-only')
  assert.match(cursor.preToolNotes, /Cloud user hooks are unavailable/)
  console.log('E2E-10B PASS')
}

// ── Wiring smoke (lifecycle consumes enforcement modules) ───────────────────
{
  assert.match(lifecycleSrc, /process-enforcement\.js/)
  assert.match(lifecycleSrc, /artifact-slot-decision\.cjs/)
  assert.match(lifecycleSrc, /extractMutationFootprint/)
  assert.match(lifecycleSrc, /decideArtifactMutation/)
  assert.match(lifecycleSrc, /reason:\s*'mutation-preflight'/)
  assert.match(lifecycleSrc, /shouldHardDenyCpMutation/)
  assert.match(lifecycleSrc, /classifyPathsForArtifacts/)
  assert.match(stopSrc, /classifyReviewChecklistCompletion/)
  assert.match(stopSrc, /classifyProcessArtifactCompleteness/)
  assert.ok(isStrictProtectedPath('website/docs/x.md'))
  assert.ok(isStrictProtectedPath('scripts/lib/process-enforcement.js'))
  console.log('WIRING PASS')
}

// ── Process package: completion without 05/checklist → gap (anti-skip) ─────
{
  const incomplete = classifyProcessArtifactCompleteness({
    completionClaimed: true,
    controlPlaneTask: true,
    text: '控制面已完成 任务完成 Phase-A ECR R3 闭环',
    hasImplementationPlan: true,
    hasProgressFile: false,
    hasReviewChecklist: false
  })
  assert.strictEqual(incomplete.ok, false, 'process package incomplete')
  assert.ok(
    incomplete.missing.includes('05-实施进度') || incomplete.missing.includes('review-checklist'),
    `missing=${(incomplete.missing || []).join(',')}`
  )

  const complete = classifyProcessArtifactCompleteness({
    completionClaimed: true,
    controlPlaneTask: true,
    text: '控制面已完成 任务完成',
    hasImplementationPlan: true,
    hasProgressFile: true,
    hasReviewChecklist: true
  })
  assert.strictEqual(complete.ok, true)
  console.log('PROCESS-PKG PASS')
}

// ── Layered registry consumer negatives: candidates/reports are not process truth ──
{
  const os = require('os')
  const activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-r3b-consumer-'))
  const taskRoot = path.join(activeRoot, 'bugs', 'candidate-only')
  const project = 'fixture-project'
  try {
    fs.mkdirSync(path.join(activeRoot, 'profile'), { recursive: true })
    fs.writeFileSync(path.join(activeRoot, 'profile', 'artifact-slot-registry.overlay.v2.json'), JSON.stringify({
      schemaVersion: 'ArtifactSlotRegistryOverlayV2',
      contractVersion: '2',
      project,
      baseRegistryId: 'devcodex-shipped-base-v2',
      constraints: { mayWidenProtected: false, allowedRootClasses: ['active-root', 'project-root', 'logical'] },
      slotExtensions: [],
      slots: [{
        slotId: 'fixture-http-verification',
        rootClass: 'active-root',
        scope: 'task',
        taskKinds: ['bugs'],
        artifactClass: 'http-verification',
        stage: 'verification',
        relativePatterns: ['^verify\\.http$'],
        alternativeGroup: null,
        writePolicy: 'bounded-path',
        owner: 'task-owner',
        mutability: 'mutable',
        protected: false,
        destructivePolicy: 'confirm'
      }]
    }, null, 2))
    fs.mkdirSync(taskRoot, { recursive: true })
    for (const [name, body] of [
      ['00-问题概况.md', '# overview\n'],
      ['01-问题确认.md', '# cp1\n'],
      ['02-修复方案-v1.5.0.md', '# candidate cp2\n'],
      ['04-实施计划-v1.5.0.md', '# candidate cp3\n'],
      ['05-实施进度.md', '# progress\n'],
      ['03-复审清单.md', '# review\n']
    ]) fs.writeFileSync(path.join(taskRoot, name), body)

    const candidatePlan = classifyImplementStartGate({
      controlPlaneMutation: true,
      taskRoot,
      fs,
      activeRoot,
      project
    })
    assert.strictEqual(candidatePlan.ok, false)
    assert.strictEqual(candidatePlan.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_PROCESS)
    assert(candidatePlan.triad.candidatePaths.includes('04-实施计划-v1.5.0.md'))
    assert(candidatePlan.missing.includes('04-实施计划'))

    fs.writeFileSync(path.join(taskRoot, '04-实施计划.md'), '# canonical cp3\n')
    const candidateDesign = classifyImplementStartGate({
      controlPlaneMutation: true,
      taskRoot,
      fs,
      activeRoot,
      project
    })
    assert.strictEqual(candidateDesign.ok, false)
    assert.strictEqual(candidateDesign.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_DESIGN)
    assert(candidateDesign.design.candidatePaths.includes('02-修复方案-v1.5.0.md'))
    assert(candidateDesign.missing.includes('02-技术方案.md'))

    fs.writeFileSync(path.join(taskRoot, '02-修复方案.md'), '# canonical cp2\n')
    const canonical = classifyImplementStartGate({
      controlPlaneMutation: true,
      taskRoot,
      fs,
      activeRoot,
      project
    })
    assert.strictEqual(canonical.ok, true, JSON.stringify(canonical))
    assert.match(canonical.triad.mergedRegistryDigest, /^[a-f0-9]{64}$/)

    const wrongProject = probeProcessTriad(taskRoot, fs, { activeRoot, project: 'wrong-project' })
    assert.strictEqual(wrongProject.errorCode, 'ARTIFACT_SLOT_REGISTRY_OVERLAY_INVALID')
    const wrongProjectGate = classifyImplementStartGate({
      controlPlaneMutation: true,
      taskRoot,
      fs,
      activeRoot,
      project: 'wrong-project'
    })
    assert.strictEqual(wrongProjectGate.ok, false)
    assert.strictEqual(wrongProjectGate.code, ERROR_CODES.ARTIFACT_REGISTRY_INVALID)
    console.log('R3B-CONSUMER-NEGATIVE PASS')
  } finally {
    fs.rmSync(activeRoot, { recursive: true, force: true })
  }
}

console.log('test-process-enforcement-e2e: all E2E-01～10 passed')
