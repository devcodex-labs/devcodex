#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildTestHooksRuntimeFixtures } = require('./lib/test-hooks-runtime-fixtures')
const { runHooksRuntimeBootstrapLayoutScenarios } = require('./lib/test-hooks-runtime-bootstrap-layout')
const { runHooksRuntimeVisibilityScenarios } = require('./lib/test-hooks-runtime-visibility')
const { runHooksRuntimeGovernanceIntakeScenarios } = require('./lib/test-hooks-runtime-governance-intake')
const { DEFAULT_THRESHOLDS } = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')
const { stableDigest } = require('../hooks/_runtime/context-read-contract.cjs')
const {
  buildWorkItemSet
} = require('../hooks/_runtime/actual-instruction-envelope.cjs')
const { buildWorkflowRouteDecision } = require('../hooks/_runtime/workflow-route-decision-v2.cjs')
const { resolveLanguageContext } = require('../hooks/_runtime/language-context.cjs')
const { createRuntimeStateStore } = require('../hooks/_runtime/runtime-state-store.cjs')
const { resolveRuntimeStateRoots } = require('../hooks/_runtime/workspace-layout.cjs')
const { buildLifecycleNamespaceStateUtils } = require('../hooks/_runtime/lifecycle-namespace-state.cjs')
const {
  commitTaskRecoveryState,
  MUTATION_PREFLIGHT_STATE_MAX_BYTES,
  readFencedTaskWriteOwner,
  readTaskRecoveryState,
  resolveTaskRecoveryMetaDir,
  storePaths
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const { createWorkspaceSessionRouteIndex } = require('../hooks/_runtime/workspace-session-route-index-v1.cjs')
const {
  executeTaskAdmission,
  executeTaskWriteOwner,
  executeWorkflowTaskTerminal
} = require('../mcp/task-admission-authority.cjs')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')
const PROFILE_SERVER = path.join(ROOT, 'mcp', 'profile-server.js')

function assertOperationAdvisory(output, label = 'operation event') {
  assert.notStrictEqual(output?.continue, false, `${label} must not stop the host operation`)
  assert.doesNotMatch(
    JSON.stringify(output || {}),
    /"(?:decision|permission|permissionDecision|behavior)"\s*:\s*"(?:allow|deny|ask|block)"/,
    `${label} must not project a DevCodex permission decision`
  )
  if (Object.prototype.hasOwnProperty.call(output || {}, 'devcodexEffective')) {
    assert.strictEqual(output.devcodexEffective, false, `${label} telemetry must remain non-effective`)
  }
}

// Use a temp directory as the workspace root to isolate from real requirements
const TEMP_ROOT = path.join(os.tmpdir(), `devcodex-hooks-test-${process.pid}`)
const STATE_DIR = path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'legacy')
const STATE_FILE = path.join(STATE_DIR, 'lifecycle-state.json')
const CAPTURE_FLAG = path.join(STATE_DIR, 'capture-final-payload.flag')
const CAPTURE_LOG = path.join(STATE_DIR, 'v5', 'telemetry-0.ndjson')
const INTERCEPTION_LOG = path.join(STATE_DIR, 'interceptions.jsonl')
const TEST_AGENT = 'claude-code'
const FALLBACK_BOOTSTRAP_AGENT = (() => {
  if (process.env.CLAUDE_CODE_VERSION || process.env.CLAUDE_HOOK_COMMAND) return 'claude-code'
  if (
    process.env.GROK_AGENT ||
    process.env.GROK_HOME ||
    process.env.GROK_SESSION ||
    process.env.GROK_BUILD
  ) return 'grok'
  if (process.env.IDEA_INITIAL_DIRECTORY || process.env.JETBRAINS_IDE) return 'jetbrains-copilot'
  if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID) return 'vscode-copilot'
  return 'copilot'
})()
const WRONG_FALLBACK_AGENT = FALLBACK_BOOTSTRAP_AGENT === 'claude-code' ? 'copilot' : 'claude-code'
const {
  getTaskStamp,
  getMemoryFilePath,
  getLayoutStateFile,
  getLayoutCaptureLog,
  getWorkspaceLayoutStateFile,
  callProfileTool,
  runBootstrapReads: runBootstrapReadsRaw,
  runLayoutBootstrapReads,
  cleanState,
  cleanLayoutState,
  cleanMultiProjectState,
  cleanLayoutMultiProjectState,
  cleanNestedLayoutMultiProjectState,
  cleanToolingSiblingState,
  run: runRaw,
  readInterceptionEntries,
  writeTranscript,
  writeTranscriptEntries
} = buildTestHooksRuntimeFixtures({
  fs,
  path,
  process,
  spawnSync,
  RUNTIME,
  PROFILE_SERVER,
  TEMP_ROOT,
  STATE_FILE,
  TEST_AGENT
})

const completedLegacySkillRoutes = new Set()

function currentLegacySkillRouteKey() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    const bootstrap = state.progressiveSkillRoute?.bootstrap
    if (!bootstrap?.contextEpoch || !bootstrap?.turnBinding) return null
    return `${bootstrap.contextEpoch}:${bootstrap.turnBinding}`
  } catch {
    return null
  }
}

function runBootstrapReads(...args) {
  const result = runBootstrapReadsRaw(...args)
  const key = currentLegacySkillRouteKey()
  if (key) completedLegacySkillRoutes.add(key)
  return result
}

function run(payload, cwd = TEMP_ROOT, env = {}) {
  const eventName = String(payload?.hookEventName || payload?.hook_event_name || '').toLowerCase()
  if (eventName === 'stop' && path.resolve(cwd) === path.resolve(TEMP_ROOT)) {
    const key = currentLegacySkillRouteKey()
    if (key && !completedLegacySkillRoutes.has(key)) {
      runBootstrapReads(TEST_AGENT)
    }
  }
  return runRaw(payload, cwd, env)
}

const runtimeScenarioContext = {
  assert,
  fs,
  path,
  TEMP_ROOT,
  STATE_DIR,
  STATE_FILE,
  CAPTURE_FLAG,
  CAPTURE_LOG,
  TEST_AGENT,
  FALLBACK_BOOTSTRAP_AGENT,
  WRONG_FALLBACK_AGENT,
  stableDigest,
  getTaskStamp,
  getMemoryFilePath,
  getLayoutStateFile,
  getWorkspaceLayoutStateFile,
  callProfileTool,
  runBootstrapReads,
  runLayoutBootstrapReads,
  cleanState,
  cleanLayoutState,
  cleanMultiProjectState,
  cleanLayoutMultiProjectState,
  cleanNestedLayoutMultiProjectState,
  cleanToolingSiblingState,
  run,
  readInterceptionEntries,
  writeTranscript,
  writeTranscriptEntries
}

function runConfirmationPersistenceScenario() {
  process.env.CLAUDE_CODE_VERSION = process.env.CLAUDE_CODE_VERSION || 'r2b-test'
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  const projectionSessionId = 'r2b-ingress-projection-session'
  const ingressOutput = run({
    hookEventName: 'UserPromptSubmit',
    session_id: projectionSessionId,
    prompt: '修复正式任务 owner 与 terminal 生命周期'
  })
  const ingressContext = String(
    ingressOutput.hookSpecificOutput?.additionalContext || ingressOutput.systemMessage || ''
  )
  const projectionLine = ingressContext.split(/\r?\n/u)
    .find(line => line.includes('"schemaVersion":"WorkflowIngressProjectionV1"'))
  assert(projectionLine, 'WorkflowIngressProjectionV1 must be visible on ingress')
  assert.strictEqual(JSON.parse(projectionLine).admissionRef, null)
  const pendingState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const planArgs = {
    intent: 'chat',
    contextEpoch: pendingState.contextAcquisition.contextEpoch,
    ...(pendingState.contextAcquisition.project ? { project: pendingState.contextAcquisition.project } : {})
  }
  const planToolUseId = `r2b-plan-${pendingState.contextAcquisition.contextEpoch}`
  run({
    hookEventName: 'PreToolUse',
    session_id: projectionSessionId,
    tool_use_id: planToolUseId,
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: planArgs
  })
  const planResult = callProfileTool(TEMP_ROOT, 'profile_context_plan', planArgs)
  const planPost = run({
    hookEventName: 'PostToolUse',
    session_id: projectionSessionId,
    tool_use_id: planToolUseId,
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: planArgs,
    tool_response: planResult
  })
  const boundProjectionLine = String(
    planPost.hookSpecificOutput?.additionalContext || planPost.systemMessage || ''
  ).split(/\r?\n/u).find(line => line.includes('"schemaVersion":"WorkflowIngressProjectionV1"'))
  assert(boundProjectionLine, 'route-bound PostToolUse must emit WorkflowIngressProjectionV1')
  const ingressProjection = JSON.parse(boundProjectionLine)
  assert.strictEqual(ingressProjection.admissionRef.schemaVersion, 'WorkflowIngressProjectionRefV1')
  assert.strictEqual(ingressProjection.admissionRef.envelopeDigest, ingressProjection.envelopeDigest)
  assert.strictEqual(ingressProjection.admissionRef.decisionDigest, ingressProjection.decisionDigest)
  const firstRouteBoundState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const firstPlanBinding = firstRouteBoundState.workflowRoutePlanBinding
  assert.match(firstPlanBinding.contextSemanticDigest, /^[a-f0-9]{64}$/)
  const replayPlanToolUseId = `${planToolUseId}-replay`
  run({
    hookEventName: 'PreToolUse',
    session_id: projectionSessionId,
    tool_use_id: replayPlanToolUseId,
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: planArgs
  })
  run({
    hookEventName: 'PostToolUse',
    session_id: projectionSessionId,
    tool_use_id: replayPlanToolUseId,
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: planArgs,
    tool_response: planResult
  })
  const replayRouteBoundState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    replayRouteBoundState.workflowRoutePlanBinding.bindingDigest,
    firstPlanBinding.bindingDigest,
    're-observing the same plan must not change WorkflowRoutePlanBinding because receipt diagnostics were refreshed'
  )

  fs.unlinkSync(STATE_FILE)
  const recoveredReadToolUseId = 'r2b-confirmation-recovery-read'
  run({
    hookEventName: 'PreToolUse',
    session_id: projectionSessionId,
    tool_use_id: recoveredReadToolUseId,
    tool_name: 'Read',
    tool_input: { file_path: path.join(TEMP_ROOT, 'CLAUDE.md') }
  })
  const recoveredIngressState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    recoveredIngressState.actualInstructionEnvelope.envelopeDigest,
    replayRouteBoundState.actualInstructionEnvelope.envelopeDigest,
    'a read-only event after projection loss must recover the confirmed instruction envelope without another user message'
  )
  assert.strictEqual(
    recoveredIngressState.workItemSet.setDigest,
    replayRouteBoundState.workItemSet.setDigest,
    'a read-only event after projection loss must recover the exact work-item set'
  )
  assert.strictEqual(
    recoveredIngressState.workflowRouteDecision.decisionDigest,
    replayRouteBoundState.workflowRouteDecision.decisionDigest,
    'a read-only event after projection loss must recover the selected route instead of asking for confirmation again'
  )
  assert.strictEqual(recoveredIngressState.workflowIngressRecovery?.authorityMode, 'exact')
  run({
    hookEventName: 'PostToolUse',
    session_id: projectionSessionId,
    tool_use_id: recoveredReadToolUseId,
    tool_name: 'Read',
    tool_input: { file_path: path.join(TEMP_ROOT, 'CLAUDE.md') },
    tool_response: { content: [{ type: 'text', text: '# CLAUDE.md' }] },
    success: true
  })

  return {
    envelopeDigest: recoveredIngressState.actualInstructionEnvelope.envelopeDigest,
    decisionDigest: recoveredIngressState.workflowRouteDecision.decisionDigest
  }
}

function runR2BTaskOwnerLifecycleScenarios() {
  runConfirmationPersistenceScenario()

  cleanState({ mode: 'dev', agent: TEST_AGENT })
  const sessionId = 'r2b-task-owner-session'
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: sessionId,
    prompt: '@rocky 修复正式任务 owner 与 terminal 生命周期'
  })
  runBootstrapReads(TEST_AGENT)

  let state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.executionMode, 'auto')
  assert.strictEqual(state.actualInstructionEnvelope.authorityScope, 'trusted-host-workflow-ingress')
  assert.strictEqual(state.actualInstructionEnvelope.provenanceLevel, 'trusted-host-event')
  assert.match(state.actualInstructionEnvelope.sourceEventId, /^event-[a-f0-9]{40}$/)
  const fixWorkItemSet = buildWorkItemSet(state.actualInstructionEnvelope, {
    workItems: [{ taskKind: 'fix', routeCandidate: 'fix.default' }]
  })
  const fixRoute = buildWorkflowRouteDecision({
    actualInstructionEnvelope: state.actualInstructionEnvelope,
    workItemSet: fixWorkItemSet,
    workItemId: fixWorkItemSet.items[0].workItemId,
    environmentMode: 'dev',
    routeKey: 'fix.default'
  })
  state.workItemSet = fixWorkItemSet
  state.workflowRouteDecision = fixRoute
  state.workflowRoutePlanBinding = {
    ...(state.workflowRoutePlanBinding || {}),
    routeKey: fixRoute.routeKey,
    subtype: fixRoute.subtype,
    stage: fixRoute.stage,
    decisionDigest: fixRoute.decisionDigest
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const project = state.stickyProject.project || state.activeProject
  assert(project)
  assert.strictEqual(state.workflowRouteDecision.mutationPolicy, 'allowed-after-confirmation')
  const admissionInput = {
    operation: 'admit',
    activeRoot,
    project,
    actualInstructionEnvelope: state.actualInstructionEnvelope,
    workItemSet: state.workItemSet,
    workflowRouteDecision: state.workflowRouteDecision,
    projectTargetLease: state.stickyProject,
    task: {
      taskKind: 'bugs',
      entryVariant: 'fix',
      displayName: 'R2B Hook owner task'
    },
    overview: { content: '# 问题概况\n\nR2B Hook owner lifecycle.\n' }
  }
  const admission = executeTaskAdmission(admissionInput)
  const taskRoot = path.join(activeRoot, ...admission.taskRootRelative.split('/'))
  const recoveryIdentity = { activeRoot, project, taskId: admission.taskId, taskStatus: 'active' }
  const metaDir = resolveTaskRecoveryMetaDir(recoveryIdentity)
  state.taskRecoveryBinding = {
    schemaVersion: 'TaskRecoveryBindingV1',
    taskId: admission.taskId,
    displayName: 'R2B Hook owner task',
    project,
    kind: 'bugs',
    taskRoot,
    status: 'active',
    identityRevision: 2,
    boundAt: new Date().toISOString()
  }
  const admissionRead = readFencedTaskWriteOwner({ metaDir, identity: recoveryIdentity })
  state.admissionTransaction = admissionRead.transaction
  state.fencedWriteOwner = null
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  assert.strictEqual(commitTaskRecoveryState({
    metaDir,
    identity: recoveryIdentity,
    sessionKey: sessionId,
    state
  }, { force: true, reserveBytes: 8 * 1024 * 1024 }).status, 'committed')

  const preResetState = JSON.parse(JSON.stringify(state))
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: sessionId,
    prompt: '继续复核当前正式任务，不创建新任务'
  })
  const postResetState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(postResetState.executionMode, 'auto')
  assert.strictEqual(postResetState.validationControlIngress?.action, 'auto-authorize')
  assert.strictEqual(postResetState.validationControlIngress?.authorityKind, 'auto')
  assert.strictEqual(postResetState.validationControlIngress?.sourceMessageDigest,
    postResetState.actualInstructionEnvelope.actualInstructionDigest)
  const postResetAdmission = readFencedTaskWriteOwner({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(postResetAdmission.transaction.phase, 'cp-state-written')
  assert.strictEqual(postResetAdmission.transaction.admissionId, admission.admissionId)
  state = preResetState
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  assert.strictEqual(commitTaskRecoveryState({
    metaDir,
    identity: recoveryIdentity,
    sessionKey: sessionId,
    state
  }, { force: true, reserveBytes: 8 * 1024 * 1024 }).status, 'committed')

  const targetFile = path.join(taskRoot, '02-修复方案.md')
  const blocked = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-missing',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# 修复方案\n' }
  })
  assert.match(JSON.stringify(blocked), /FENCED_TASK_WRITE_OWNER_MISSING|TASK_WRITE_OWNER_REQUIRED/)
  assert.strictEqual(fs.existsSync(targetFile), false)

  const confirmationContent = '# 问题确认\n\nHook owner confirmed.\n'
  const confirmationName = '01-问题确认.md'
  fs.writeFileSync(path.join(taskRoot, confirmationName), confirmationContent)
  const confirmationDigest = crypto.createHash('sha256').update(confirmationContent).digest('hex')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const sessions = fs.readFileSync(sessionsPath, 'utf8')
  fs.writeFileSync(sessionsPath, sessions.replace(
    /^\|\s*CP1\s*\|.*$/mu,
    `| CP1 | ✅ | ${confirmationName} | v1 | ${confirmationDigest} | hook-test | ${new Date().toISOString()} |`
  ))
  let nonceSequence = 0
  const acquireInput = {
    operation: 'acquire',
    activeRoot,
    project,
    actualInstructionEnvelope: state.actualInstructionEnvelope,
    workItemSet: state.workItemSet,
    workflowRouteDecision: state.workflowRouteDecision,
    projectTargetLease: state.stickyProject,
    taskId: admission.taskId,
    admissionId: admission.admissionId
  }
  const acquired = executeTaskWriteOwner(acquireInput, {
    nonceFactory() {
      nonceSequence += 1
      return `owner-${crypto.createHash('sha1').update(String(nonceSequence)).digest('hex')}`
    }
  })
  assert.strictEqual(acquired.mutationAuthority, true)

  const autoBypassProbe = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-auto-control-plane-before-design',
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(TEMP_ROOT, 'hooks', '_runtime', 'lifecycle.cjs'),
      content: 'module.exports = true\n'
    }
  })
  assertOperationAdvisory(autoBypassProbe, 'control-plane write before design')
  assert.match(
    JSON.stringify(autoBypassProbe),
    /IMPLEMENT_START_WITHOUT_|cp-gate-CP2|Implement process gate required/i,
    'auto alias plus a valid CP1 owner must not bypass design/implementation gates'
  )

  const allowed = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-allowed',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# 修复方案\n' }
  })
  assert.doesNotMatch(JSON.stringify(allowed), /TASK_WRITE_OWNER_|FENCED_TASK_WRITE_OWNER_/)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    state.fencedTaskWriteOwnerAuthority?.mutationAuthority,
    true,
    `owner-authorized mutation was not admitted: ${JSON.stringify(allowed)}`
  )
  let mutationOperation = state.turnLiveness.inFlightOperation
  assert.strictEqual(
    mutationOperation?.artifactDecision?.schemaVersion,
    'ArtifactSlotDecisionV2',
    `owner-backed artifact mutation preflight missing: ${JSON.stringify(allowed)}`
  )
  assert.strictEqual(mutationOperation?.mutationLease?.schemaVersion, 'TaskOwnedMutationLeaseV2')
  assert.strictEqual(mutationOperation?.mutationFootprint?.schemaVersion, 'MutationFootprintRecoveryProjectionV2')
  assert.strictEqual(mutationOperation?.mutationPreObservation?.schemaVersion, 'MutationPreObservationV1')
  assert.strictEqual(mutationOperation.mutationPreObservation.observationCoverage, 'complete')
  let preflightRead = readTaskRecoveryState({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(preflightRead.envelope.recordType, 'mutation-preflight')
  assert.strictEqual(preflightRead.state.turnLiveness.inFlightOperation.mutationLease.schemaVersion, 'TaskOwnedMutationLeaseV2')
  const preflightStateBytes = Buffer.byteLength(JSON.stringify(preflightRead.envelope.state), 'utf8')
  assert(
    preflightStateBytes <= MUTATION_PREFLIGHT_STATE_MAX_BYTES,
    `R3B2 mutation preflight must remain within the fixed 4 KiB state budget: ${preflightStateBytes}/${MUTATION_PREFLIGHT_STATE_MAX_BYTES}`
  )
  const preflightSequence = preflightRead.envelope.sequence
  const replayAllowed = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-allowed',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# 修复方案\n' }
  })
  assert.doesNotMatch(JSON.stringify(replayAllowed), /MUTATION_REPLAY_|MUTATION_OPERATION_ALREADY_/)
  preflightRead = readTaskRecoveryState({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(preflightRead.envelope.sequence, preflightSequence, 'exact PreToolUse replay must not consume another V5 generation')
  fs.writeFileSync(targetFile, '# 修复方案\n')
  const firstCloseoutOutput = run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-allowed',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# 修复方案\n' },
    success: true
  })
  assert.doesNotMatch(JSON.stringify(firstCloseoutOutput), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.turnLiveness.lastMutationCloseout?.observation?.status, 'consumed')
  const firstReceiptDigest = state.turnLiveness.lastMutationCloseout.observation.receiptDigest
  run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-allowed',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# 修复方案\n' },
    success: true
  })
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    state.turnLiveness.lastMutationCloseout?.observation?.receiptDigest,
    firstReceiptDigest,
    'duplicate PostToolUse must preserve the original one-use closeout receipt'
  )

  const shellAllowed = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3a-codex-exec-direct-write',
    tool_name: 'exec_command',
    tool_input: { cmd: `Set-Content -LiteralPath "${targetFile}" -Value updated` }
  })
  assert.doesNotMatch(JSON.stringify(shellAllowed), /host-tool-adapter-unknown|mutation-footprint-coverage-incomplete|mutation-target-set-empty/)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    state.turnLiveness.inFlightOperation?.artifactDecision?.decisionStatus,
    'allow',
    `Codex exec_command mutation was not admitted: ${JSON.stringify(shellAllowed)}`
  )
  mutationOperation = state.turnLiveness.inFlightOperation
  assert.strictEqual(mutationOperation.mutationLease.slotDecisionDigest, mutationOperation.artifactDecision.decisionDigest)
  assert.strictEqual(mutationOperation.mutationLease.plannedSetDigest, mutationOperation.mutationFootprint.plannedSetDigest)
  fs.writeFileSync(targetFile, '# 修复方案 updated\n')
  const shellCloseoutOutput = run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r3a-codex-exec-direct-write',
    tool_name: 'exec_command',
    tool_input: { cmd: `Set-Content -LiteralPath "${targetFile}" -Value updated` },
    success: true,
    exit_code: 0
  })
  assert.doesNotMatch(JSON.stringify(shellCloseoutOutput), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.turnLiveness.lastMutationCloseout?.observation?.status, 'consumed')
  const durableShellCloseout = readTaskRecoveryState({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(durableShellCloseout.envelope.recordType, undefined)
  assert.strictEqual(durableShellCloseout.state.turnLiveness.lastMutationCloseout?.observation?.status, 'consumed')

  const cp2Content = fs.readFileSync(targetFile, 'utf8')
  const cp2Digest = crypto.createHash('sha256').update(cp2Content).digest('hex')
  const cp2SessionsBefore = fs.readFileSync(sessionsPath, 'utf8')
  const cp2SessionsAfter = cp2SessionsBefore.replace(
    /^\|\s*CP2\s*\|.*$/mu,
    `| CP2 | ✅ | 02-修复方案.md | v1 | ${cp2Digest} | hook-test | ${new Date().toISOString()} |`
  )
  assert.notStrictEqual(cp2SessionsAfter, cp2SessionsBefore, 'fixture must confirm the bound bug CP2')
  fs.writeFileSync(sessionsPath, cp2SessionsAfter)

  // A valid fenced owner restores the original CP3 runtime boundary: four
  // distinct source files are still inside the CP2 implementation window and
  // the fifth requires the CP3 checkpoint.  Ownerless attempts are tested
  // separately below and must never advance this counter.
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  state.executionMode = 'confirm'
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  assert.strictEqual(commitTaskRecoveryState({
    metaDir,
    identity: recoveryIdentity,
    sessionKey: sessionId,
    state
  }, { force: true, reserveBytes: 8 * 1024 * 1024 }).status, 'committed')

  const ownerBackedRuntimeThresholdTargets = Array.from(
    { length: 5 },
    (_, index) => path.join(TEMP_ROOT, 'src', 'r2b-runtime-threshold', `bug-${index + 1}.js`)
  )
  fs.mkdirSync(path.dirname(ownerBackedRuntimeThresholdTargets[0]), { recursive: true })
  ownerBackedRuntimeThresholdTargets.forEach((file, index) => {
    fs.writeFileSync(file, `module.exports = ${index}\n`)
    const operationId = `r2b-owner-runtime-threshold-${index + 1}`
    const content = `module.exports = ${index + 10}\n`
    const output = run({
      hookEventName: 'PreToolUse',
      session_id: sessionId,
      tool_use_id: operationId,
      tool_name: 'Write',
      tool_input: { file_path: file, content }
    })
    if (index < 4) {
      assert.doesNotMatch(
        JSON.stringify(output),
        /cp-gate-CP3-runtime-threshold|执行中已触达 5 个源码\/配置文件/,
        'owner-backed runtime threshold should not warn before the 5th unique source file'
      )
    } else {
      assert.match(
        JSON.stringify(output),
        /cp-gate-CP3-runtime-threshold|执行中已触达 5 个源码\/配置文件/,
        'owner-backed runtime threshold must warn on the 5th unique source file'
      )
    }
    const runtimeState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    const runtimeRecord = Object.values(runtimeState.cp3Runtime || {})
      .find(entry => entry && entry.name === 'R2B Hook owner task')
    assert.strictEqual(
      runtimeRecord?.trackedFiles?.length,
      index + 1,
      `owner-backed CP3 runtime tracking must persist unique file ${index + 1}`
    )
    fs.writeFileSync(file, content)
    const closeout = run({
      hookEventName: 'PostToolUse',
      session_id: sessionId,
      tool_use_id: operationId,
      tool_name: 'Write',
      tool_input: { file_path: file, content },
      success: true
    })
    assert.doesNotMatch(JSON.stringify(closeout), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)
  })
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const ownerBackedRuntimeThreshold = Object.values(state.cp3Runtime || {})
    .find(entry => entry && entry.name === 'R2B Hook owner task')
  assert.strictEqual(ownerBackedRuntimeThreshold?.triggered, true)
  assert.strictEqual(ownerBackedRuntimeThreshold?.triggerCount, 5)

  const decoyTaskRoot = path.join(activeRoot, 'requirements', 'newer-stop-decoy')
  fs.mkdirSync(decoyTaskRoot, { recursive: true })
  fs.writeFileSync(path.join(decoyTaskRoot, '01-需求确认.md'), '# decoy CP1\n')
  fs.writeFileSync(path.join(decoyTaskRoot, '02-技术方案.md'), '# decoy control-plane design\n')
  fs.writeFileSync(path.join(decoyTaskRoot, '03-方案复审-PR1.md'), [
    '# PR-1 decoy',
    'open blocker = 0',
    '## 验收映射',
    '| 需求 | 设计 | 验证 |',
    '| D1 | decoy | decoy |',
    '## 契约矩阵 runtimeOwners',
    '| owner | file |',
    '| decoy | decoy |',
    '## CodeTruth',
    '| repoPath | currentBehavior | negativeProbe |',
    '| decoy | decoy | decoy |',
    '## 根因',
    'decoy must never replace the session-bound bug task.',
    'PR-1 ✅ 通过',
    'bounded substance '.repeat(100)
  ].join('\n'))

  const crossTaskBlocked = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-cross-task-artifact',
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(decoyTaskRoot, '04-实施计划.md'),
      content: '# must remain blocked\n'
    }
  })
  assert.match(
    JSON.stringify(crossTaskBlocked),
    /artifact-task-kind-mismatch|artifact-task-name-mismatch/,
    'the bound bug owner must not authorize a formal artifact in another task'
  )

  const implementationPlan = '# 实施计划\n\nSession-bound control-plane implementation.\n'
  fs.writeFileSync(path.join(taskRoot, '03-复审清单.md'), '# 复审清单\n\n- [ ] independent PR-1 pending\n')
  fs.writeFileSync(path.join(taskRoot, '04-实施计划.md'), implementationPlan)
  fs.writeFileSync(path.join(taskRoot, '05-实施进度.md'), '# 实施进度\n\nR3B fixture.\n')
  const cp3Digest = crypto.createHash('sha256').update(implementationPlan).digest('hex')
  const cp3SessionsBefore = fs.readFileSync(sessionsPath, 'utf8')
  const cp3SessionsAfter = cp3SessionsBefore.replace(
    /^\|\s*CP3\s*\|.*$/mu,
    `| CP3 | ✅ | 04-实施计划.md | v1 | ${cp3Digest} | hook-test | ${new Date().toISOString()} |`
  )
  assert.notStrictEqual(cp3SessionsAfter, cp3SessionsBefore, 'fixture must confirm the bound bug CP3')
  fs.writeFileSync(sessionsPath, cp3SessionsAfter)

  const protectedTarget = path.join(TEMP_ROOT, 'hooks', '_runtime', 'session-bound-target-first.cjs')
  fs.mkdirSync(path.dirname(protectedTarget), { recursive: true })
  const protectedAllowed = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-session-bound-control-plane',
    tool_name: 'Write',
    tool_input: { file_path: protectedTarget, content: 'module.exports = true\n' }
  })
  assert.doesNotMatch(
    JSON.stringify(protectedAllowed),
    /IMPLEMENT_START_WITHOUT_|cp-gate-task-binding-required|newer-stop-decoy/,
    'confirmed control-plane implementation must inspect only the exact session-bound task'
  )
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    state.turnLiveness.inFlightOperation?.artifactDecision?.decisionStatus,
    'allow',
    `session-bound control-plane mutation was not admitted: ${JSON.stringify(protectedAllowed)}`
  )
  fs.writeFileSync(protectedTarget, 'module.exports = true\n')
  const protectedCloseout = run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-session-bound-control-plane',
    tool_name: 'Write',
    tool_input: { file_path: protectedTarget, content: 'module.exports = true\n' },
    success: true
  })
  assert.doesNotMatch(JSON.stringify(protectedCloseout), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)

  // Auto is evaluated only after task/owner/CP authority.  Allowlisted paths
  // proceed without an Auto boundary warning, while non-allowlisted source
  // paths retain safety-only warning / strict denial semantics.
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  state.executionMode = 'auto'
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  assert.strictEqual(commitTaskRecoveryState({
    metaDir,
    identity: recoveryIdentity,
    sessionKey: sessionId,
    state
  }, { force: true, reserveBytes: 8 * 1024 * 1024 }).status, 'committed')

  const autoCodexEntryPath = path.join(TEMP_ROOT, 'AGENTS.md')
  const autoCodexHookPath = path.join(TEMP_ROOT, '.codex', 'hooks.json')
  fs.mkdirSync(path.dirname(autoCodexHookPath), { recursive: true })
  fs.writeFileSync(autoCodexEntryPath, '# before\n')
  fs.writeFileSync(autoCodexHookPath, '{}\n')
  const ownerBackedAutoCodexEntryAndHookAllowed = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-auto-whitelist',
    tool_name: 'apply_patch',
    tool_input: {
      input: [
        '*** Begin Patch',
        `*** Update File: ${autoCodexEntryPath}`,
        '@@',
        '-# before',
        '+# after',
        `*** Update File: ${autoCodexHookPath}`,
        '@@',
        '-{}',
        '+{"enabled":true}',
        '*** End Patch'
      ].join('\n')
    }
  })
  assert.doesNotMatch(
    JSON.stringify(ownerBackedAutoCodexEntryAndHookAllowed),
    /auto-whitelist-boundary|TASK_WRITE_OWNER_|IMPLEMENT_START_WITHOUT_|cp-gate-/
  )
  fs.writeFileSync(autoCodexEntryPath, '# after\n')
  fs.writeFileSync(autoCodexHookPath, '{"enabled":true}\n')
  const ownerBackedAutoWhitelistCloseout = run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-auto-whitelist',
    tool_name: 'apply_patch',
    tool_input: {
      input: [
        '*** Begin Patch',
        `*** Update File: ${autoCodexEntryPath}`,
        '@@',
        '-# before',
        '+# after',
        `*** Update File: ${autoCodexHookPath}`,
        '@@',
        '-{}',
        '+{"enabled":true}',
        '*** End Patch'
      ].join('\n')
    },
    success: true
  })
  assert.doesNotMatch(JSON.stringify(ownerBackedAutoWhitelistCloseout), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)

  const autoNonWhitelistPath = path.join(TEMP_ROOT, 'src', 'owner-backed-auto-non-whitelist.js')
  fs.writeFileSync(autoNonWhitelistPath, 'module.exports = false\n')
  const ownerBackedAutoNonWhitelistWarning = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-auto-non-whitelist',
    tool_name: 'Write',
    tool_input: { file_path: autoNonWhitelistPath, content: 'module.exports = true\n' }
  })
  assert.match(JSON.stringify(ownerBackedAutoNonWhitelistWarning), /auto-whitelist-boundary|仅对白名单路径/)
  assert.strictEqual(ownerBackedAutoNonWhitelistWarning.continue, true)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.turnLiveness.inFlightOperation?.operationId, 'r2b-owner-auto-non-whitelist')
  fs.writeFileSync(autoNonWhitelistPath, 'module.exports = true\n')
  const ownerBackedAutoNonWhitelistCloseout = run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-auto-non-whitelist',
    tool_name: 'Write',
    tool_input: { file_path: autoNonWhitelistPath, content: 'module.exports = true\n' },
    success: true
  })
  assert.doesNotMatch(JSON.stringify(ownerBackedAutoNonWhitelistCloseout), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)

  const ownerBackedAutoNonWhitelistBlockedStrict = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-owner-auto-non-whitelist-strict',
    tool_name: 'Write',
    tool_input: { file_path: autoNonWhitelistPath, content: 'module.exports = false\n' }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assertOperationAdvisory(ownerBackedAutoNonWhitelistBlockedStrict, 'strict auto whitelist boundary')
  assert.match(JSON.stringify(ownerBackedAutoNonWhitelistBlockedStrict), /auto-whitelist-boundary|仅对白名单路径/)

  const sourceRoot = path.join(TEMP_ROOT, 'src', 'r3b-batch')
  fs.mkdirSync(sourceRoot, { recursive: true })
  const batchTargets = Array.from({ length: 9 }, (_, index) => path.join(sourceRoot, `file-${index + 1}.js`))
  batchTargets.forEach((file, index) => fs.writeFileSync(file, `module.exports = ${index}\n`))
  const batchPatch = [
    '*** Begin Patch',
    ...batchTargets.flatMap((file, index) => [
      `*** Update File: ${file}`,
      '@@',
      `-module.exports = ${index}`,
      `+module.exports = ${index + 10}`
    ]),
    '*** End Patch'
  ].join('\n')
  const batchAllowed = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-nine-file-batch',
    tool_name: 'apply_patch',
    tool_input: { input: batchPatch }
  })
  assert.doesNotMatch(
    JSON.stringify(batchAllowed),
    /LIFECYCLE_PREFLIGHT_PAYLOAD_EXCEEDED|MUTATION_PRE_OBSERVATION_INCOMPLETE|ARTIFACT_MUTATION_NEEDS_RECONCILE/
  )
  assert.doesNotMatch(
    JSON.stringify(batchAllowed),
    /cp-gate-CP2[^]*newer-stop-decoy|newer-stop-decoy[^]*CP2/,
    'source mutation CP routing must use the session-bound bug, not the newest incomplete task'
  )
  const batchPreflight = readTaskRecoveryState({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(
    batchPreflight.envelope.recordType,
    'mutation-preflight',
    `nine-file batch was not admitted: ${JSON.stringify(batchAllowed)}`
  )
  assert.strictEqual(
    batchPreflight.envelope.state.turnLiveness.inFlightOperation.mutationRecovery?.schemaVersion,
    'TaskRecoveryMutationPreflightV2'
  )
  assert.strictEqual(
    batchPreflight.envelope.state.turnLiveness.inFlightOperation.mutationRecovery.pathTable.length,
    batchTargets.length
  )
  assert(
    Buffer.byteLength(JSON.stringify(batchPreflight.envelope.state), 'utf8') <= MUTATION_PREFLIGHT_STATE_MAX_BYTES,
    'the confirmed nine-file product batch must fit the fixed V5 preflight budget'
  )
  batchTargets.forEach((file, index) => fs.writeFileSync(file, `module.exports = ${index + 10}\n`))
  const batchCloseout = run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-nine-file-batch',
    tool_name: 'apply_patch',
    tool_input: { input: batchPatch },
    success: true
  })
  assert.doesNotMatch(JSON.stringify(batchCloseout), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.turnLiveness.lastMutationCloseout?.observation?.status, 'consumed')
  assert.strictEqual(state.turnLiveness.lastMutationCloseout.observation.observedEffects.modified.length, batchTargets.length)

  const unobservableScript = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3a-unobservable-script',
    tool_name: 'exec_command',
    tool_input: { cmd: 'node scripts/custom-writer.js' }
  })
  assert.match(JSON.stringify(unobservableScript), /mutation-footprint-coverage-incomplete|mutation-target-set-empty/)

  const readOnlyShell = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3a-read-only-shell',
    tool_name: 'exec_command',
    tool_input: { cmd: 'rg -n "rm -rf|Set-Content" docs' }
  })
  assert.doesNotMatch(JSON.stringify(readOnlyShell), /Mutation target observation unavailable/)
  run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r3a-read-only-shell',
    tool_name: 'exec_command',
    tool_input: { cmd: 'rg -n "rm -rf|Set-Content" docs' },
    success: true,
    exit_code: 1
  })

  const tamperedLeasePre = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-tampered-noop',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# tampered no-op\n' }
  })
  assert.doesNotMatch(JSON.stringify(tamperedLeasePre), /ARTIFACT_RECONCILIATION_REQUIRED|MUTATION_AUTHORITY_BUNDLE_INVALID/)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.turnLiveness.inFlightOperation?.mutationLease?.status, 'active')
  state.turnLiveness.inFlightOperation.mutationLease.contextEpoch = 'tampered-context-epoch'
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  const tamperedCommit = commitTaskRecoveryState({
    metaDir,
    identity: recoveryIdentity,
    sessionKey: sessionId,
    state
  }, { force: true, reserveBytes: 8 * 1024 * 1024 })
  assert.strictEqual(tamperedCommit.status, 'committed')
  const tamperedCloseout = run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-tampered-noop',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# tampered no-op\n' },
    success: true
  })
  assert.match(JSON.stringify(tamperedCloseout), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.turnLiveness.lastMutationCloseout?.result, 'needs-reconcile')
  assert(
    state.turnLiveness.lastMutationCloseout.authorizationErrors.some(code => /lease|context/i.test(code)),
    'tampered one-use lease must be recorded as an authorization reconciliation error'
  )
  assert(
    state.turnLiveness.lastMutationCloseout.observation.drift.some(code => /planned-modify-missing|tool-reported-failure/i.test(code)),
    'native success without the planned file effect must remain needs-reconcile'
  )
  assert.strictEqual(
    state.turnLiveness.lastMutationCloseout.reconciliationInput?.schemaVersion,
    'ArtifactMutationReconciliationInputV1',
    'a zero-effect or partial closeout must retain bounded preflight evidence for server-owned re-observation'
  )
  const blockedAfterReconcile = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-blocked-after-reconcile',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# blocked pending reconcile\n' }
  })
  assert.match(JSON.stringify(blockedAfterReconcile), /ARTIFACT_RECONCILIATION_REQUIRED/)
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const priorCloseout = state.turnLiveness.lastMutationCloseout
  const recoveredObservedEffects = { created: [], modified: [], deleted: [], moved: [] }
  const reconciliationProjectionSemantic = {
    schemaVersion: 'ArtifactMutationReconciliationProjectionV1',
    sourceReceiptSchema: 'ArtifactMutationReconciliationReceiptV1',
    sourceReceiptDigest: '1'.repeat(64),
    project: 'devcodex',
    taskId: recoveryIdentity.taskId,
    operationId: priorCloseout.operationId,
    priorObservationReceiptDigest: priorCloseout.observation.receiptDigest,
    priorCloseoutDigest: priorCloseout.artifactCloseout.closeoutDigest,
    priorPlannedSetDigest: priorCloseout.observation.plannedSetDigest,
    recoveryMode: 'reobserved-from-preflight',
    recoveryInputDigest: priorCloseout.reconciliationInput.inputDigest,
    recoveredObservedEffects,
    recoveredObservedEffectsDigest: stableDigest(recoveredObservedEffects),
    currentEffectSnapshotDigest: '2'.repeat(64),
    mutationAuthority: false,
    reconciledAt: new Date().toISOString()
  }
  state.turnLiveness.lastMutationCloseout = {
    ...priorCloseout,
    result: 'reconciled',
    reconciledAt: reconciliationProjectionSemantic.reconciledAt,
    reconciliation: {
      ...reconciliationProjectionSemantic,
      projectionDigest: stableDigest(reconciliationProjectionSemantic)
    }
  }
  const reconciledCommit = commitTaskRecoveryState({
    metaDir,
    identity: recoveryIdentity,
    sessionKey: sessionId,
    state
  }, { force: true, reserveBytes: 8 * 1024 * 1024 })
  assert.strictEqual(reconciledCommit.status, 'committed')
  const recoveredMutationPre = run({
    hookEventName: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-recovered-write',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# recovered write\n' }
  })
  assert.doesNotMatch(JSON.stringify(recoveredMutationPre), /ARTIFACT_RECONCILIATION_REQUIRED/)
  fs.writeFileSync(targetFile, '# recovered write\n')
  const recoveredMutationPost = run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r3b-recovered-write',
    tool_name: 'Write',
    tool_input: { file_path: targetFile, content: '# recovered write\n' },
    success: true
  })
  assert.doesNotMatch(JSON.stringify(recoveredMutationPost), /ARTIFACT_MUTATION_NEEDS_RECONCILE/)

  run({ hookEventName: 'PreCompact', session_id: sessionId })
  let ownerAfterLifecycle = readFencedTaskWriteOwner({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(ownerAfterLifecycle.owner.status, 'active')
  assert.strictEqual(ownerAfterLifecycle.owner.leaseDigest, acquired.owner.leaseDigest)
  const newestTaskTime = new Date(Date.now() + 1000)
  fs.utimesSync(decoyTaskRoot, newestTaskTime, newestTaskTime)
  const stopOutput = run({
    hookEventName: 'Stop',
    session_id: sessionId,
    success: true,
    lastAssistantMessage: '请确认修复方案（确认 CP2）。'
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert(stopOutput)
  const stopState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert(
    stopState.enforcementHonesty?.processGaps?.includes('pr1-skipped'),
    `Stop PR-1 must inspect the session-bound bug, not the newest requirements design: ${JSON.stringify(stopState.enforcementHonesty)}`
  )
  ownerAfterLifecycle = readFencedTaskWriteOwner({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(ownerAfterLifecycle.owner.status, 'active', 'a hard-blocked Stop must not release the owner')
  assert.strictEqual(ownerAfterLifecycle.owner.leaseDigest, acquired.owner.leaseDigest)
  assert(!['completed', 'error'].includes(String(stopState.turnLiveness?.state || '')),
    'a hard-blocked Stop must not mark the turn terminal')

  const acceptedStop = run({
    hookEventName: 'Stop',
    session_id: sessionId,
    success: true,
    lastAssistantMessage: '当前回合暂停，后续继续。'
  })
  assert.notStrictEqual(acceptedStop?.continue, false)
  ownerAfterLifecycle = readFencedTaskWriteOwner({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(ownerAfterLifecycle.owner.status, 'released', 'an accepted Stop must park the task immediately')
  const releasedGeneration = ownerAfterLifecycle.owner.ownerGeneration
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: sessionId,
    prompt: '继续 R2B Hook owner task'
  })
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  ownerAfterLifecycle = readFencedTaskWriteOwner({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(ownerAfterLifecycle.owner.status, 'active', JSON.stringify(state.lastUserPromptOwnerReacquire || {}))
  assert(ownerAfterLifecycle.owner.ownerGeneration > releasedGeneration, 'same-session next prompt must reacquire with a new fence generation')
  assert.strictEqual(state.lastUserPromptOwnerReacquire?.status, 'committed')
  const activeOwnerRef = {
    ownerGeneration: ownerAfterLifecycle.owner.ownerGeneration,
    ownerNonce: ownerAfterLifecycle.owner.ownerNonce,
    leaseRevision: ownerAfterLifecycle.owner.leaseRevision,
    leaseDigest: ownerAfterLifecycle.owner.leaseDigest
  }

  const evidenceDefinitions = [
    ['ecr', `${admission.taskRootRelative}/07-ECR-hook.md`, '# ECR hook\n'],
    ['report', `${admission.taskRootRelative}/reports/codex/hook.md`, '# Report hook\n'],
    ['memory', `${admission.taskRootRelative}/.memory/hook-closeout.md`, '# Memory hook\n'],
    ['completion', `${admission.taskRootRelative}/06-完成清单-hook.md`, '# Completion hook\n']
  ]
  const evidence = evidenceDefinitions.map(([role, relative, content]) => {
    const filePath = path.join(activeRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    return {
      role,
      path: relative,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      bytes: Buffer.byteLength(content)
    }
  })
  const terminalInput = {
    activeRoot,
    project,
    actualInstructionEnvelope: state.actualInstructionEnvelope,
    workItemSet: state.workItemSet,
    workflowRouteDecision: state.workflowRouteDecision,
    projectTargetLease: state.stickyProject,
    taskId: admission.taskId,
    admissionId: admission.admissionId,
    terminalStatus: 'completed',
    expectedOwner: activeOwnerRef,
    evidence
  }
  const terminal = executeWorkflowTaskTerminal(terminalInput, {
    nonceFactory: () => `owner-${'b'.repeat(40)}`
  })
  run({
    hookEventName: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: 'r2b-terminal-tool',
    tool_name: 'devcodex-memory/memory_task_terminal_v1',
    tool_result: terminal,
    success: true
  })
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.taskRecoveryBinding, null)
  assert.strictEqual(state.workflowTaskTerminalReceipt.receiptDigest, terminal.receipt.receiptDigest)
  assert.strictEqual(state.turnLiveness.workflowTaskTerminal.taskId, admission.taskId)
  const routeIndex = createWorkspaceSessionRouteIndex({ metaDir, fs, path })
  const terminalRoute = routeIndex.read({ sessionDigest: state.stickyProject.authorityDigest })
  assert.strictEqual(terminalRoute.status, 'unbound')

  const terminalRecovery = readTaskRecoveryState({
    metaDir,
    identity: { ...recoveryIdentity, taskStatus: 'completed' }
  })
  assert.strictEqual(commitTaskRecoveryState({
    metaDir,
    identity: { ...recoveryIdentity, taskStatus: 'completed' },
    sessionKey: sessionId,
    state: terminalRecovery.state
  }, {
    force: true,
    nowMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
    reserveBytes: 8 * 1024 * 1024
  }).status, 'committed')
  const agedTerminal = readTaskRecoveryState({
    metaDir,
    identity: { ...recoveryIdentity, taskStatus: 'completed' }
  })
  assert(Date.parse(agedTerminal.envelope.terminalAt) < Date.now() - 7 * 24 * 60 * 60 * 1000)

  try { fs.unlinkSync(STATE_FILE) } catch { }
  for (const file of storePaths(metaDir).ephemeral) {
    try { fs.unlinkSync(file) } catch { }
  }
  const terminalContinuation = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'r2b-terminal-continuation',
    prompt: '修复并继续 R2B Hook owner task'
  })
  assert.doesNotMatch(JSON.stringify(terminalContinuation), /TaskRecoveryBindingV1[^]*R2B Hook owner task/)
  let continuationState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.notStrictEqual(continuationState.taskRecoveryBinding?.taskId, admission.taskId)
  runBootstrapReads(TEST_AGENT)
  continuationState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const reopenWorkItemSet = buildWorkItemSet(continuationState.actualInstructionEnvelope, {
    workItems: [{ taskKind: 'fix', routeCandidate: 'fix.default' }]
  })
  continuationState.workItemSet = reopenWorkItemSet
  continuationState.workflowRouteDecision = buildWorkflowRouteDecision({
    actualInstructionEnvelope: continuationState.actualInstructionEnvelope,
    workItemSet: reopenWorkItemSet,
    workItemId: reopenWorkItemSet.items[0].workItemId,
    environmentMode: 'dev',
    routeKey: 'fix.default'
  })
  fs.writeFileSync(STATE_FILE, JSON.stringify(continuationState, null, 2))

  const reopenAdmissionInput = {
    operation: 'bind',
    activeRoot,
    project,
    actualInstructionEnvelope: continuationState.actualInstructionEnvelope,
    workItemSet: continuationState.workItemSet,
    workflowRouteDecision: continuationState.workflowRouteDecision,
    projectTargetLease: continuationState.stickyProject,
    task: {
      taskId: admission.taskId,
      taskKind: 'bugs',
      entryVariant: 'reopen',
      taskRootRelative: admission.taskRootRelative
    },
    overview: { content: admissionInput.overview.content }
  }
  const reopenedAdmission = executeTaskAdmission(reopenAdmissionInput)
  const terminalOwner = readFencedTaskWriteOwner({
    metaDir,
    identity: { ...recoveryIdentity, taskStatus: 'completed' }
  }).owner
  const reopenedOwner = executeTaskWriteOwner({
    operation: 'reopen',
    activeRoot,
    project,
    actualInstructionEnvelope: continuationState.actualInstructionEnvelope,
    workItemSet: continuationState.workItemSet,
    workflowRouteDecision: continuationState.workflowRouteDecision,
    projectTargetLease: continuationState.stickyProject,
    taskId: admission.taskId,
    admissionId: reopenedAdmission.admissionId,
    expectedOwner: {
      ownerGeneration: terminalOwner.ownerGeneration,
      ownerNonce: terminalOwner.ownerNonce,
      leaseRevision: terminalOwner.leaseRevision,
      leaseDigest: terminalOwner.leaseDigest
    }
  }, { nonceFactory: () => `owner-${'c'.repeat(40)}` })
  assert.strictEqual(reopenedOwner.status, 'active')
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'r2b-terminal-continuation',
    prompt: '继续 R2B Hook owner task'
  })
  const reboundState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(reboundState.taskRecoveryBinding?.taskId, admission.taskId)
  assert.strictEqual(reboundState.taskRecoveryBinding?.status, 'active', JSON.stringify({
    binding: reboundState.taskRecoveryBinding,
    owner: reboundState.fencedWriteOwner,
    admission: reboundState.admissionTransaction,
    continuation: reboundState.taskContinuation,
    ownerReadError: reboundState.lifecycleOwnerTransitionError
  }))

  process.stdout.write('hooks runtime R2B owner + R3B mutation scenarios passed\n')
}

function main() {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-runtime-store-'))
  const projectA = path.join(stateRoot, '.devcodex', 'apps', 'api')
  const projectB = path.join(stateRoot, '.devcodex', 'apps', 'web')
  fs.mkdirSync(projectA, { recursive: true })
  fs.mkdirSync(projectB, { recursive: true })
  fs.writeFileSync(path.join(stateRoot, '.devcodex', 'layout.json'), JSON.stringify({ version: 1, mode: 'workspace-namespace' }))
  const rootsA = resolveRuntimeStateRoots(projectA, 'apps/api')
  const rootsB = resolveRuntimeStateRoots(projectB, 'apps/web')
  assert.notStrictEqual(rootsA.primaryRoot, rootsB.primaryRoot, 'projects must receive isolated runtime partitions')
  assert.ok(!fs.existsSync(rootsA.primaryRoot), 'runtime resolution must remain read-only')

  const invalidProfileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-lifecycle-invalid-profile-'))
  const invalidProjectRoot = path.join(invalidProfileRoot, 'chat')
  fs.mkdirSync(path.join(invalidProfileRoot, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(invalidProfileRoot, '.devcodex', 'chat', 'profile'), { recursive: true })
  fs.mkdirSync(invalidProjectRoot, { recursive: true })
  fs.writeFileSync(
    path.join(invalidProfileRoot, '.devcodex', 'workspace', 'profile', 'config.json'),
    '{"mode":"prod"}\n'
  )
  fs.writeFileSync(
    path.join(invalidProfileRoot, '.devcodex', 'chat', 'profile', 'config.json'),
    '{"mode":"dev", broken}\n'
  )
  const invalidProfileUtils = buildLifecycleNamespaceStateUtils({
    fs,
    path,
    CONTEXT_ROOT: invalidProjectRoot,
    WORKSPACE_ROOT: invalidProfileRoot,
    LAYOUT: { enabled: true },
    CONTEXT_PROJECT: 'chat',
    DEFAULT_SCOPE: 'project',
    META_STATE_SCOPE_KEY: 'workspace',
    mergeConfig: (base, overlay) => ({ ...(base || {}), ...(overlay || {}) }),
    detectPlatform: () => 'codex'
  })
  assert.throws(
    () => invalidProfileUtils.readResolvedProfileConfig({ activeProject: 'chat' }),
    error => error?.code === 'PROFILE_CONFIG_INVALID' && error.filePath.endsWith(path.join('chat', 'profile', 'config.json')),
    'lifecycle must not downgrade a malformed project Profile to workspace config'
  )
  fs.rmSync(invalidProfileRoot, { recursive: true, force: true })

  const legacyFile = path.join(projectA, '.runtime-state', 'compat', 'state.json')
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true })
  fs.writeFileSync(legacyFile, JSON.stringify({ schemaVersion: 'CompatibilityProbeV1', value: 'legacy' }))
  const stateStore = createRuntimeStateStore({
    activeRoot: projectA,
    project: 'apps/api',
    relativePath: path.join('compat', 'state.json'),
    maxWrites: 1
  })
  const compatibilityRead = stateStore.read()
  assert.strictEqual(compatibilityRead.status, 'fresh')
  assert.strictEqual(compatibilityRead.stateSource, 'legacy-read-only')
  assert.strictEqual(stateStore.write({ schemaVersion: 'CompatibilityProbeV1', value: 'canonical' }).status, 'persisted')
  assert.strictEqual(stateStore.read().value.value, 'canonical', 'canonical state must win after the first new write')
  assert.strictEqual(JSON.parse(fs.readFileSync(legacyFile, 'utf8')).value, 'legacy', 'new writes must never mutate the legacy compatibility entry')
  fs.rmSync(stateRoot, { recursive: true, force: true })

  assert.deepStrictEqual(
    resolveLanguageContext({ prompt: '请用中文分析这个项目' }),
    {
      schemaVersion: 'LanguageContextV2', primaryLanguage: 'zh-CN', responseLanguage: 'zh-CN',
      artifactLanguage: 'zh-CN', currentTurnClass: 'explicit-switch', source: 'explicit-current-turn',
      confidence: 'high', updatedPrimary: true
    }
  )
  assert.deepStrictEqual(
    resolveLanguageContext({ prompt: 'Please inspect the project.' }),
    {
      schemaVersion: 'LanguageContextV2', primaryLanguage: 'en', responseLanguage: 'en', artifactLanguage: 'en',
      currentTurnClass: 'substantive', source: 'first-substantive-user-message', confidence: 'high', updatedPrimary: true
    }
  )
  assert.deepStrictEqual(
    resolveLanguageContext({ carrier: { language: 'ja' } }),
    {
      schemaVersion: 'LanguageContextV2', primaryLanguage: 'ja', responseLanguage: 'ja', artifactLanguage: 'ja',
      currentTurnClass: 'neutral', source: 'conversation-primary-language', confidence: 'high', updatedPrimary: false
    }
  )
  assert.deepStrictEqual(
    resolveLanguageContext({}),
    {
      schemaVersion: 'LanguageContextV2', primaryLanguage: 'en', responseLanguage: 'en', artifactLanguage: 'en',
      currentTurnClass: 'neutral', source: 'und-en-fallback', confidence: 'low', updatedPrimary: false
    }
  )

  runHooksRuntimeBootstrapLayoutScenarios(runtimeScenarioContext)
  runHooksRuntimeGovernanceIntakeScenarios(runtimeScenarioContext)
  runHooksRuntimeVisibilityScenarios(runtimeScenarioContext)

  // TaskResolutionV1: a canonical resume message resolves identity before
  // Context Acquisition, while Hook remains a no-payload/no-CP thin adapter.
  cleanState()
  const continuationTask = path.join(TEMP_ROOT, '.devcodex', 'optimizations', 'Hook续接任务')
  fs.mkdirSync(path.join(continuationTask, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(continuationTask, '.memory', 'task.json'), JSON.stringify({
    schemaVersion: 'TaskIdentityV1',
    taskId: '6b31500b-f2c4-4f50-9067-d59ad1f806f1',
    displayName: 'Hook续接任务',
    aliases: ['Hook旧任务名'],
    createdAt: '2026-07-18T00:00:00.000Z',
    identityRevision: 1
  }, null, 2) + '\n')
  const continuationSessions = '# Hook continuation\n\n> **当前状态**: 🔄 active\n'
  fs.writeFileSync(path.join(continuationTask, '.memory', 'sessions.md'), continuationSessions)
  const resolvedContinuation = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'task-continuation-unique',
    prompt: '继续 Hook续接任务'
  })
  const continuationContext = resolvedContinuation.hookSpecificOutput?.additionalContext || resolvedContinuation.systemMessage || ''
  assert.match(continuationContext, /TaskResolutionV1 resolved-active/)
  assert.match(continuationContext, /LanguageContextV2/)
  const continuationStore = storePaths(STATE_DIR)
  const taskSlotFiles = []
  const pendingTaskDirs = [continuationStore.tasks]
  while (pendingTaskDirs.length) {
    const current = pendingTaskDirs.pop()
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) pendingTaskDirs.push(fullPath)
      else if (/^state-[ab]\.json$/.test(entry.name)) taskSlotFiles.push(fullPath)
    }
  }
  assert(taskSlotFiles.length >= 1, 'resolved formal task must create a durable V5 task slot')
  const continuationEnvelope = taskSlotFiles
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
    .sort((left, right) => right.sequence - left.sequence)[0]
  const continuationRecovered = readTaskRecoveryState({
    metaDir: STATE_DIR,
    identity: continuationEnvelope.identity
  })
  assert.strictEqual(continuationRecovered.status, 'fresh')
  continuationRecovered.state.cp3Runtime = {
    ...(continuationRecovered.state.cp3Runtime || {}),
    recoverySentinel: 'formal-task-a-b-rehydrated'
  }
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: STATE_DIR,
    identity: continuationEnvelope.identity,
    sessionKey: 'task-continuation-unique',
    state: continuationRecovered.state
  }, { force: true, reserveBytes: 8192 }).status, 'committed')
  for (const file of continuationStore.ephemeral) {
    try { fs.unlinkSync(file) } catch { }
  }
  try { fs.unlinkSync(STATE_FILE) } catch { }
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'task-continuation-new-session',
    prompt: '继续 Hook续接任务'
  })
  const crossSessionContinuationState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    crossSessionContinuationState.cp3Runtime?.recoverySentinel,
    'formal-task-a-b-rehydrated',
    'a unique formal task continuation must load task A/B before resetting the new turn'
  )
  assert.match(continuationContext, /language: zh-CN/)
  const continuationState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(continuationState.taskContinuation.status, 'resolved-active')
  assert.strictEqual(continuationState.taskContinuation.candidate.taskId, '6b31500b-f2c4-4f50-9067-d59ad1f806f1')
  assert.strictEqual(continuationState.taskContinuation.capabilityBoundary.payloadExecution, false)
  assert.strictEqual(fs.readFileSync(path.join(continuationTask, '.memory', 'sessions.md'), 'utf8'), continuationSessions)

  const ambiguousTask = path.join(TEMP_ROOT, '.devcodex', 'bugs', 'Hook同名副本')
  fs.mkdirSync(path.join(ambiguousTask, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(ambiguousTask, '.memory', 'task.json'), JSON.stringify({
    schemaVersion: 'TaskIdentityV1',
    taskId: 'be5737e8-905c-4211-9ebc-e38df6da505e',
    displayName: 'Hook续接任务',
    aliases: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    identityRevision: 1
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(ambiguousTask, '.memory', 'sessions.md'), '# duplicate\n\n> **当前状态**: 🔄 active\n')
  const ambiguousContinuation = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'task-continuation-ambiguous',
    prompt: '继续Hook续接任务任务'
  })
  assert.match(ambiguousContinuation.systemMessage || ambiguousContinuation.hookSpecificOutput?.additionalContext || '', /ambiguous|Candidates/i)
  fs.rmSync(continuationTask, { recursive: true, force: true })
  fs.rmSync(ambiguousTask, { recursive: true, force: true })
  cleanState()

  // ISSUE-043 P0: blocked tools never receive a lease; successful tool output
  // becomes awaiting-continuation and a later process invocation rehydrates a
  // stale turn into a single recovery card before starting the new turn.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', session_id: 'blocked-turn', prompt: 'liveness blocked tool test' })
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'blocked-tool',
    tool_name: 'Bash',
    tool_input: { command: 'git reset --hard' }
  })
  let livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.inFlightOperation, null)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', session_id: 'liveness-turn-1', prompt: 'liveness replay test' })
  runBootstrapReads()
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'liveness-tool-1',
    tool_name: 'read_file',
    tool_input: { filePath: 'src/liveness.js' }
  })
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.inFlightOperation.operationId, 'liveness-tool-1')
  assert.strictEqual(livenessState.turnLiveness.state, 'running')

  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'liveness-tool-1',
    tool_name: 'read_file',
    tool_input: { filePath: 'src/liveness.js' },
    success: true
  })
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.state, 'awaiting-continuation')
  assert.strictEqual(livenessState.turnLiveness.inFlightOperation, null)
  const staleAt = new Date(Date.now() - DEFAULT_THRESHOLDS.stalledAfterMs - 1000).toISOString()
  livenessState.turnLiveness.lastToolOutputAt = staleAt
  livenessState.turnLiveness.lastEventAt = staleAt
  fs.writeFileSync(STATE_FILE, JSON.stringify(livenessState, null, 2))

  const recoveredTurn = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'liveness-turn-2',
    prompt: 'resume stalled liveness turn'
  })
  assert.match(JSON.stringify(recoveredTurn), /TurnRecoveryCard/)
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.turnKey, 'liveness-turn-2')
  assert.strictEqual(livenessState.turnLiveness.previousTurn.terminalState, 'interrupted')
  assert.strictEqual(livenessState.turnLiveness.lastRecoveryCard.priorState, 'stalled-recoverable')
  const recoveredNoticeKey = livenessState.turnLiveness.lastRecoveryNoticeKey

  run({ hookEventName: 'PreCompact', session_id: 'liveness-turn-2' })
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.lastRecoveryNoticeKey, recoveredNoticeKey)
  run({ hookEventName: 'Stop', session_id: 'liveness-turn-2', success: true })
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.state, 'completed')
  assert.strictEqual(livenessState.turnLiveness.inFlightOperation, null)

  // Auto v1.1: explicit @devcodex-auto or explicit natural-language auto authorization
  // writes executionMode=auto; in safety-only mode, non-whitelisted paths warn instead
  // of hard-blocking.
  cleanState()
  const autoReq = path.join(TEMP_ROOT, '.devcodex', 'requirements', '自动模式需求')
  fs.mkdirSync(path.join(autoReq, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(autoReq, '01-需求概述.md'), '# auto req\n')
  fs.writeFileSync(path.join(autoReq, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  run({ hookEventName: 'UserPromptSubmit', prompt: '@devcodex-auto 修复 auto runtime 行为' })
  runBootstrapReads()
  const autoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(autoState.executionMode, 'auto')

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: '进入 auto 模式执行规范吸纳' })
  runBootstrapReads()
  const naturalAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(naturalAutoState.executionMode, 'auto')

  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'default-alias-session',
    prompt: '@rocky should enter auto by global default alias'
  })
  runBootstrapReads()
  const defaultAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(defaultAliasState.executionMode, 'auto')
  assert.strictEqual(defaultAliasState.stickyAuto?.active, true)
  assert.strictEqual(defaultAliasState.stickyAuto?.source, '@rocky')

  // Sticky Auto: next turn without @rocky stays auto (same session)
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  const stickyAutoOut1 = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-auto-session',
    prompt: '@rocky 开始需求'
  })
  assert.ok(
    /ExecutionModeV1:\s*auto/i.test(String(stickyAutoOut1.systemMessage || '')),
    'UserPromptSubmit should inject ExecutionModeV1: auto'
  )
  let stickyAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(stickyAutoState.executionMode, 'auto')
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-auto-session',
    prompt: '确认'
  })
  stickyAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(stickyAutoState.executionMode, 'auto', 'sticky auto must survive follow-up without @rocky')
  assert.strictEqual(stickyAutoState.stickyAuto?.active, true)

  // Loose CJK adjacency: 请@rocky执行
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'cjk-auto-session',
    prompt: '请@rocky执行当前需求'
  })
  const cjkAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(cjkAutoState.executionMode, 'auto', 'CJK-adjacent @rocky must enter auto')

  // Explicit exit auto clears sticky
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'exit-auto-session',
    prompt: '@rocky 进入任务'
  })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'exit-auto-session',
    prompt: '退出 auto 模式'
  })
  const exitAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(exitAutoState.executionMode, 'confirm')
  assert.strictEqual(exitAutoState.stickyAuto?.active, false)

  // Missing session identity cannot reuse sticky authority from an earlier turn.
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'omit-session-auto',
    prompt: '@rocky 启动'
  })
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: '继续推进'
  })
  const omitSessionSticky = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(omitSessionSticky.executionMode, 'confirm', 'missing session_id must not inherit sticky auto')

  // Negated aliases and natural-language tokens cannot authorize Auto.
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'negated-auto-session',
    prompt: '请不要 @rocky 执行，也不要进入 auto 模式'
  })
  const negatedAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(negatedAutoState.executionMode, 'confirm')

  // Explicit different session_id drops sticky
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-a-auto',
    prompt: '@rocky 启动'
  })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-b-auto',
    prompt: '继续推进'
  })
  const crossSessionSticky = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(crossSessionSticky.executionMode, 'confirm', 'different session_id must not inherit sticky auto')

  cleanState({
    mode: 'dev',
    agent: TEST_AGENT,
    extensions: {
      devcodex: {
        autoAliases: ['@maintainer']
      }
    }
  })
  run({ hookEventName: 'UserPromptSubmit', prompt: '@maintainer 修复 Profile auto alias' })
  runBootstrapReads()
  const profileAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(profileAliasState.executionMode, 'auto')

  cleanState({
    mode: 'dev',
    agent: TEST_AGENT,
    extensions: {
      devcodex: {
        autoAliases: ['@maintainer']
      }
    }
  })
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky should not enter auto when autoAliases replaces defaults' })
  runBootstrapReads()
  const replacedDefaultAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(replacedDefaultAliasState.executionMode, 'confirm')

  cleanState({
    mode: 'dev',
    agent: TEST_AGENT,
    extensions: {
      devcodex: {
        autoAliases: []
      }
    }
  })
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky should not enter auto when autoAliases is an empty replacement' })
  runBootstrapReads()
  const disabledDefaultAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(disabledDefaultAliasState.executionMode, 'confirm')

  cleanState({
    mode: 'dev',
    agent: TEST_AGENT,
    extensions: {
      devcodex: {
        autoAliases: ['rocky', '@auto', '@devcodex', '@bad alias']
      }
    }
  })
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky should not enter auto without a valid configured alias' })
  runBootstrapReads()
  const invalidAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(invalidAliasState.executionMode, 'confirm')

  cleanLayoutState(
    { mode: 'prod', agent: TEST_AGENT },
    { mode: 'dev' }
  )
  const layoutChildDefaultAlias = path.join(TEMP_ROOT, 'chat')
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky 继续修复 chat 项目' }, layoutChildDefaultAlias)
  runLayoutBootstrapReads(TEST_AGENT, layoutChildDefaultAlias)
  const layoutDefaultAliasState = JSON.parse(fs.readFileSync(getLayoutStateFile(), 'utf8'))
  assert.strictEqual(layoutDefaultAliasState.executionMode, 'auto')

  cleanLayoutState(
    { mode: 'prod', agent: TEST_AGENT },
    {
      mode: 'dev',
      extensions: {
        devcodex: {
          autoAliases: ['@chat-auto']
        }
      }
    }
  )
  const layoutChild = path.join(TEMP_ROOT, 'chat')
  run({ hookEventName: 'UserPromptSubmit', prompt: '@chat-auto 继续修复 chat 项目' }, layoutChild)
  runLayoutBootstrapReads(TEST_AGENT, layoutChild)
  const projectOverlayAliasState = JSON.parse(fs.readFileSync(getLayoutStateFile(), 'utf8'))
  assert.strictEqual(projectOverlayAliasState.executionMode, 'auto')

  cleanState({ mode: 'dev', agent: 'claude-code' })
  run({ hookEventName: 'UserPromptSubmit', prompt: 'Codex bootstrap should prefer current host over profile agent' }, TEMP_ROOT, { CODEX_HOME: '1' })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: '.devcodex/profile/config.json' }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: getMemoryFilePath('claude-code', 'SUMMARY.md') }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  const codexMismatchState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(codexMismatchState.bootstrap.profileRead, true)
  assert.strictEqual(codexMismatchState.bootstrap.summaryRead, false)
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: getMemoryFilePath('codex', 'SUMMARY.md') }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: getMemoryFilePath('codex', 'tasks', `${getTaskStamp(0)}.md`) }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  const codexBootstrapState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(codexBootstrapState.bootstrapComplete, false)
  assert.deepStrictEqual(codexBootstrapState.contextAcquisition.legacyObserved, {
    profileRead: true,
    summaryRead: true,
    tasksRead: true,
    bootstrapComplete: false
  }, 'advisory-only raw-file observations must not bypass the structured route/context contract')

  cleanLayoutState(
    { mode: 'prod', agent: TEST_AGENT },
    {
      mode: 'dev',
      extensions: {
        devcodex: {
          autoAliases: ['@rocky']
        }
      }
    }
  )
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky restore auto mode after codex bootstrap replay' }, layoutChild)
  runLayoutBootstrapReads(TEST_AGENT, layoutChild)

  const autoCrossProjectDenied = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assertOperationAdvisory(autoCrossProjectDenied, 'cross-project mutation')
  assert.match(
    JSON.stringify(autoCrossProjectDenied),
    /ARTIFACT_TARGET_OUTSIDE_ALLOWED_ROOTS|outside.*root/i
  )

  const autoSameProjectReadmeDenied = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  }, layoutChild)
  assertOperationAdvisory(autoSameProjectReadmeDenied, 'ownerless README mutation')
  assert.match(
    JSON.stringify(autoSameProjectReadmeDenied),
    /TASK_WRITE_OWNER_BINDING_REQUIRED|Fenced task write owner authority unavailable/i
  )

  const autoCodexEntryDenied = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: AGENTS.md\n*** End Patch'
    }
  }, layoutChild)
  assertOperationAdvisory(autoCodexEntryDenied, 'ownerless AGENTS mutation')

  const autoCodexSkillDenied = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: .agents/skills/compliance/SKILL.md\n*** End Patch'
    }
  }, layoutChild)
  assertOperationAdvisory(autoCodexSkillDenied, 'ownerless skill mutation')

  const autoCodexHookDenied = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: .codex/hooks.json\n*** End Patch'
    }
  }, layoutChild)
  assertOperationAdvisory(autoCodexHookDenied, 'ownerless hook mutation')

  const autoNonWhitelistDenied = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch'
    }
  }, layoutChild)
  assertOperationAdvisory(autoNonWhitelistDenied, 'ownerless source mutation')
  assert.match(
    JSON.stringify(autoNonWhitelistDenied),
    /TASK_WRITE_OWNER_BINDING_REQUIRED|Fenced task write owner authority unavailable/i
  )

  const autoNonWhitelistBlockedStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch'
    }
  }, layoutChild, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assertOperationAdvisory(autoNonWhitelistBlockedStrict, 'strict ownerless source mutation')
  assert.match(
    JSON.stringify(autoNonWhitelistBlockedStrict),
    /TASK_WRITE_OWNER_BINDING_REQUIRED|Fenced task write owner authority unavailable/i
  )

  const autoDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'git reset --hard HEAD~1'
    }
  })
  assertOperationAdvisory(autoDangerousCommand, 'dangerous command classification')
  assert.doesNotMatch(autoDangerousCommand.systemMessage || '', /permission denied by DevCodex/i)
  assert.match(
    JSON.stringify(autoDangerousCommand),
    /TASK_WRITE_OWNER_|Fenced task write owner|Mutation target observation unavailable|Formal artifact mutation denied/i,
    'operation risk remains host-owned even when an independent workflow invariant rejects the mutation'
  )

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()

  // Archive markers affect CP discovery only; they never manufacture a write owner.
  const reqDir = path.join(TEMP_ROOT, '.devcodex', 'requirements', '历史归档需求')
  fs.mkdirSync(path.join(reqDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDir, '01-需求概述.md'), '# req\n')
  fs.writeFileSync(path.join(reqDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
  const warningByOldReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  })
  assertOperationAdvisory(warningByOldReq, 'archived requirement owner advisory')
  assert.match(JSON.stringify(warningByOldReq), /TASK_WRITE_OWNER_|Fenced task write owner/i)
  const blockedByOldReqStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assertOperationAdvisory(blockedByOldReqStrict, 'strict archived requirement owner advisory')
  assert.match(JSON.stringify(blockedByOldReqStrict), /TASK_WRITE_OWNER_|Fenced task write owner/i)
  fs.writeFileSync(path.join(reqDir, '.archived'), '')
  const allowedAfterArchive = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  })
  assertOperationAdvisory(allowedAfterArchive, 'post-archive owner advisory')
  assert.match(JSON.stringify(allowedAfterArchive), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // v1.9.4+ Cross-requirement bypass test:
  // An unfinished requirement should keep warning on global src/ mutations
  // even if another requirement has already entered implementation.
  cleanState()
  const reqIncomplete = path.join(TEMP_ROOT, '.devcodex', 'requirements', '陈旧未完成需求')
  fs.mkdirSync(path.join(reqIncomplete, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqIncomplete, '01-需求概述.md'), '# stale\n')
  fs.writeFileSync(path.join(reqIncomplete, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  // Bootstrap first so we can test CP gate cleanly
  run({ hookEventName: 'UserPromptSubmit', prompt: 'cross-req test' })
  runBootstrapReads()

  // Without an admitted/fenced task owner, CP discovery cannot authorize mutation.
  const warningNoCp3 = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assertOperationAdvisory(warningNoCp3, 'missing CP3 owner advisory')
  assert.match(JSON.stringify(warningNoCp3), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // Add a second requirement that has CP3 confirmed → stale unfinished task must still block
  const reqDone = path.join(TEMP_ROOT, '.devcodex', 'requirements', '当前实施需求')
  fs.mkdirSync(path.join(reqDone, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDone, '01-需求概述.md'), '# done\n')
  fs.writeFileSync(path.join(reqDone, '02-技术方案.md'), '# plan\n')
  fs.writeFileSync(path.join(reqDone, '04-实施计划.md'), '# impl\n')
  fs.writeFileSync(
    path.join(reqDone, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )

  const warningCrossReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assertOperationAdvisory(warningCrossReq, 'cross-requirement owner advisory')
  assert.match(JSON.stringify(warningCrossReq), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // Path-aware test: writing inside reqIncomplete dir while reqDone has CP3
  // must also require the exact task owner; another task's CP3 is not authority.
  const allowedInReqDir = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Write',  // Claude Code PascalCase tool
    tool_input: {
      file_path: path.join(reqIncomplete, '02-技术方案.md'),
      content: '# new plan\n'
    }
  })
  assertOperationAdvisory(allowedInReqDir, 'requirement directory owner advisory')
  assert.match(JSON.stringify(allowedInReqDir), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // CP3 N/A exemptions for docs/init should not keep old requirements blocking later source work.
  cleanState()
  const reqDocsExempt = path.join(TEMP_ROOT, '.devcodex', 'requirements', '文档任务')
  fs.mkdirSync(path.join(reqDocsExempt, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDocsExempt, '01-需求概述.md'), '# docs\n')
  fs.writeFileSync(path.join(reqDocsExempt, '02-技术方案.md'), '# outline\n')
  fs.writeFileSync(
    path.join(reqDocsExempt, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\nCP3: N/A（docs 子类型豁免）\n'
  )
  run({ hookEventName: 'UserPromptSubmit', prompt: 'cp3 exemption test' })
  runBootstrapReads()
  const allowedAfterCp3Exempt = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/exempt.js\n*** End Patch' }
  })
  assertOperationAdvisory(allowedAfterCp3Exempt, 'CP3 exemption owner advisory')
  assert.match(JSON.stringify(allowedAfterCp3Exempt), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // Bug task discovery also cannot replace formal admission and a fenced owner.
  cleanState()
  const bugDir = path.join(TEMP_ROOT, '.devcodex', 'bugs', 'MCP全链路收口')
  fs.mkdirSync(path.join(bugDir, '.memory'), { recursive: true })
  fs.mkdirSync(path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0)), { recursive: true })
  fs.writeFileSync(
    path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0), '01--问题确认与CP1.md'),
    '# cp1\n'
  )
  fs.writeFileSync(path.join(bugDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'bug task gate test' })
  runBootstrapReads()
  const warningBugTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug.js\n*** End Patch' }
  })
  assertOperationAdvisory(warningBugTask, 'bug task owner advisory')
  assert.match(JSON.stringify(warningBugTask), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // CP2/CP3 files alone must not enable writes before admission/owner acquisition.
  fs.writeFileSync(
    path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0), '02--技术方案与CP2.md'),
    '# cp2\n'
  )
  fs.writeFileSync(
    path.join(bugDir, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n'
  )
  for (const fileName of ['bug-1.js', 'bug-2.js', 'bug-3.js', 'bug-4.js']) {
    const allowedBugTask = run({
      hookEventName: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { input: `*** Begin Patch\n*** Update File: src/${fileName}\n*** End Patch` }
    })
    assertOperationAdvisory(allowedBugTask, `bug task owner advisory ${fileName}`)
    assert.match(JSON.stringify(allowedBugTask), /TASK_WRITE_OWNER_|Fenced task write owner/i)
  }

  const bugRuntimeState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const bugRuntimeRecord = Object.values(bugRuntimeState.cp3Runtime || {}).find(entry => entry && entry.name === 'MCP全链路收口')
  assert.strictEqual(bugRuntimeRecord, undefined, 'denied ownerless writes must not advance CP3 runtime tracking')

  const warningBugThreshold = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-5.js\n*** End Patch' }
  })
  assertOperationAdvisory(warningBugThreshold, 'bug threshold owner advisory')
  assert.match(JSON.stringify(warningBugThreshold), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  const blockedBugThresholdStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-5.js\n*** End Patch' }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assertOperationAdvisory(blockedBugThresholdStrict, 'strict bug threshold owner advisory')
  assert.match(JSON.stringify(blockedBugThresholdStrict), /TASK_WRITE_OWNER_|Fenced task write owner/i)
  assert.ok(!readInterceptionEntries().some(entry =>
    entry.code === 'cp-gate-CP3-runtime-threshold' &&
    entry.effective === true
  ), 'owner denial must not pretend that an unauthorized write reached the CP3 runtime threshold')

  // CP3 completion still does not replace the fenced owner.
  fs.writeFileSync(path.join(bugDir, '04-实施计划.md'), '# cp3\n')
  fs.writeFileSync(
    path.join(bugDir, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )
  const allowedAfterBugCp3 = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-after-cp3.js\n*** End Patch' }
  })
  assertOperationAdvisory(allowedAfterBugCp3, 'post-CP3 owner advisory')
  assert.match(JSON.stringify(allowedAfterBugCp3), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // Dual-Track M1: orphan control-plane mutation when no CP1-bound task exists
  cleanState()
  // remove leftover tasks under temp .devcodex if any (cleanState may keep root)
  const tempDev = path.join(TEMP_ROOT, '.devcodex')
  for (const kind of ['requirements', 'bugs', 'optimizations', 'scenario-tests']) {
    const root = path.join(tempDev, kind)
    if (!fs.existsSync(root)) continue
    for (const name of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true })
    }
  }
  run({ hookEventName: 'UserPromptSubmit', prompt: 'orphan control-plane gate test' })
  runBootstrapReads()
  const orphanWarn = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: scripts/lib/orphan-probe.js\n*** End Patch' }
  })
  assertOperationAdvisory(orphanWarn, 'orphan control-plane advisory')
  assert.match(JSON.stringify(orphanWarn), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // extended task roots: optimizations and scenario-tests must also participate in CP gate.
  cleanState()
  const optimizationDir = path.join(TEMP_ROOT, '.devcodex', 'optimizations', '性能优化任务')
  fs.mkdirSync(path.join(optimizationDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(optimizationDir, '01-需求概述.md'), '# optimization\n')
  fs.writeFileSync(path.join(optimizationDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'optimization task gate test' })
  runBootstrapReads()
  const warningOptimizationTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/perf.js\n*** End Patch' }
  })
  assertOperationAdvisory(warningOptimizationTask, 'optimization owner advisory')
  assert.match(JSON.stringify(warningOptimizationTask), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  cleanState()
  const scenarioDir = path.join(TEMP_ROOT, '.devcodex', 'scenario-tests', '端到端任务')
  fs.mkdirSync(path.join(scenarioDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(scenarioDir, '01-需求概述.md'), '# scenario\n')
  fs.writeFileSync(path.join(scenarioDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'scenario task gate test' })
  runBootstrapReads()
  const warningScenarioTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/e2e.js\n*** End Patch' }
  })
  assertOperationAdvisory(warningScenarioTask, 'scenario owner advisory')
  assert.match(JSON.stringify(warningScenarioTask), /TASK_WRITE_OWNER_|Fenced task write owner/i)

  // F-008 (v1.9.5): DEVCODEX_PATH_RE 边缘场景测试
  // Bootstrap a fresh workspace
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'F-008 path-regex tests' })
  runBootstrapReads()

  // F-001: bash writes remain mutations and require an admitted owner.
  const bashWriteClaude = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "console.log(1)" > .claude/foo.js' }
  })
  assertOperationAdvisory(bashWriteClaude, 'Claude path mutation advisory')
  assert.match(JSON.stringify(bashWriteClaude), /TASK_WRITE_OWNER_|Fenced task write owner|artifact-(?:target-mixed-scope|slot-ambiguous|slot-unknown)/i)

  // Governance paths are not an implicit mutation authority either.
  const bashWriteGovernance = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "# test" > .claude/instructions/foo.md' }
  })
  assertOperationAdvisory(bashWriteGovernance, 'governance path mutation advisory')
  assert.match(JSON.stringify(bashWriteGovernance), /TASK_WRITE_OWNER_|Fenced task write owner|artifact-(?:target-mixed-scope|slot-ambiguous|slot-unknown)/i)

  const bashWriteCodexGovernance = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "# test" > AGENTS.md && echo "# test" > .agents/skills/foo/SKILL.md && echo "{}" > .codex/hooks.json && echo "{}" > codex/hooks.json' }
  })
  assertOperationAdvisory(bashWriteCodexGovernance, 'Codex governance path mutation advisory')
  assert.match(JSON.stringify(bashWriteCodexGovernance), /TASK_WRITE_OWNER_|Fenced task write owner|artifact-(?:target-mixed-scope|slot-ambiguous|slot-unknown)/i)

  // F-006: bash cp src.js dest.js 命令路径提取
  const bashCp = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cp src/a.js src/b.js' }
  })
  assertOperationAdvisory(bashCp, 'copy mutation advisory')
  assert.match(JSON.stringify(bashCp), /TASK_WRITE_OWNER_|Fenced task write owner|artifact-(?:target-mixed-scope|slot-ambiguous|slot-unknown)/i)

  cleanState()
  process.stdout.write('hooks runtime smoke test passed\n')
}

if (process.argv.includes('--confirmation-persistence')) {
  const startedAt = Date.now()
  try {
    const receipt = runConfirmationPersistenceScenario()
    const durationMs = Date.now() - startedAt
    assert(
      durationMs <= 30000,
      `confirmation persistence fast path exceeded 30000 ms: ${durationMs} ms`
    )
    process.stdout.write(`confirmation persistence fast path passed in ${durationMs} ms (${receipt.decisionDigest})\n`)
  } finally {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  }
} else if (process.argv.includes('--r2b-task-owner') || process.argv.includes('--r3b-mutation')) {
  try {
    runR2BTaskOwnerLifecycleScenarios()
  } finally {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  }
} else {
  main()
}
