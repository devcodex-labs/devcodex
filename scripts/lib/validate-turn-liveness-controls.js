'use strict'
const {
  DEFAULT_THRESHOLDS,
  classifyTurnLiveness,
  completeToolLease,
  createTurnLivenessState,
  finalizeExecutionAttemptLedger,
  markTurnTerminal,
  observeTurnEvent,
  recordExecutionAttempt,
  startToolLease
} = require('../../hooks/_runtime/lifecycle-turn-liveness.cjs')
const {
  replayLocalTaskTrace,
  validateLocalTaskTrace
} = require('../../hooks/_runtime/lifecycle-task-trace.cjs')

function buildTurnLivenessControlChecks(ctx) {
  const { ROOT, ACTIVE_DEVCODEX_ROOT, fs, path, read, err, console } = ctx
  const logicalExists = file => typeof read.exists === 'function' ? read.exists(file) : fs.existsSync(file)

  function checkFile(relative, needles) {
    const file = path.join(ROOT, relative)
    if (!logicalExists(file)) {
      err(`[V98] missing required artifact: ${relative}`)
      return
    }
    const content = read(file)
    for (const needle of needles) {
      if (!content.includes(needle)) err(`[V98] ${relative} missing: ${needle}`)
    }
  }

  function checkV98() {
    const required = [
      ['hooks/_runtime/lifecycle-turn-liveness.cjs', ['classifyTurnLiveness', 'startToolLease', 'completeToolLease', 'TurnRecoveryCard', 'hook-event-observation-only', 'ExecutionAttemptLedgerV1', 'stop-before-third', 'finalizeExecutionAttemptLedger']],
      ['hooks/_runtime/lifecycle-checkpoint-validation.cjs', ['CheckpointValidationResultV1', 'response-time', 'post-execution', 'TRACE_COMPLETION_TIMEOUT']],
      ['hooks/_runtime/lifecycle-task-trace.cjs', ['LocalTaskTraceV1', 'LocalTaskTraceReplayV1', 'TRACE_DUPLICATE_EVENT', 'payloadExecution']],
      ['hooks/_runtime/lifecycle-bootstrap-state.cjs', ['turnLiveness', 'normalizeTurnLivenessState']],
      ['hooks/_runtime/lifecycle.cjs', ['observeTurnEvent', 'startToolLease', 'markTurnTerminal']],
      ['scripts/lib/cli-observability-commands.js', ['LocalProbeContractError', 'cmdProbe', 'cmdTrace', 'legacy-normalized-unverified']],
      ['skills/ai-agent-system-architecture/SKILL.md', ['TurnLivenessRecoveryGate', 'LocalTaskTraceGate', 'checkpointValidation', 'payloadExecution']],
      ['skills/execution-contract/SKILL.md', ['turnLivenessContract', 'allowedRecoveryActions', 'forbiddenRecoveryActions', 'CheckpointValidationResultV1', 'LocalTaskTraceV1', 'ExecutionAttemptLedgerGate', 'StopSnapshotV1']],
      ['skills/host-contract-verification/SKILL.md', ['turnLiveness', 'hook-event-verified', 'sidecar-observed', 'localProbe', 'checkpointValidation', 'localTaskTrace']],
      ['skills/rework-prevention-engineering/SKILL.md', ['Turn Liveness Prevention Trial', 'FalseStallRate', 'DuplicateMutationRate']],
      ['skills/test-router/SKILL.md', ['agent-turn-liveness', 'local-observability-contract', 'CheckpointValidationResultV1', 'LocalTaskTraceV1']],
      ['skills/report/report-schema.json', ['CliDiagnosticContract', 'CheckpointValidation', 'LocalTaskTrace', 'ExecutionAttemptLedger', 'TurnLivenessRecovery']],
      ['skills/spec-governance/gate-registry.json', ['local-observability-contract', 'agent-turn-liveness', 'CheckpointValidationResultV1', 'LocalTaskTraceV1', 'V98']],
      ['instructions/01-common.instructions.md', ['host-contract-verification', 'CheckpointValidation', 'LocalTaskTrace']],
      ['prompts/technical-design.prompt.md', ['agent-turn-liveness', 'TurnLivenessRecoveryGate', 'CheckpointValidationResultV1', 'LocalTaskTraceV1']],
      ['prompts/implementation-plan.prompt.md', ['agent-turn-liveness', 'CheckpointValidation', 'LocalTaskTrace']],
      ['prompts/implementation-progress.prompt.md', ['CliDiagnosticContract', 'CheckpointValidation', 'LocalTaskTrace', 'ExecutionAttemptLedger']],
      ['prompts/delivery-checklist.prompt.md', ['CliDiagnosticContract', 'CheckpointValidation', 'LocalTaskTrace']],
      ['prompts/report-dev.prompt.md', ['CliDiagnosticContract', 'CheckpointValidation', 'LocalTaskTrace', 'TurnLivenessRecovery']],
      ['prompts/report-fix.prompt.md', ['CliDiagnosticContract', 'CheckpointValidation', 'LocalTaskTrace', 'TurnLivenessRecovery']],
      ['prompts/report-audit.prompt.md', ['CliDiagnosticContract', 'CheckpointValidation', 'LocalTaskTrace', 'TurnLivenessRecovery']],
      ['scripts/check-turn-liveness.js', ['gray-read-only-one-shot', 'sidecar-observed', 'operationReplay', 'processControl']],
      ['package.json', ['test:local-probe', 'test:checkpoint-validation', 'test:local-task-trace', 'test:execution-attempt-ledger', 'check:turn-liveness', 'scripts/check-turn-liveness.js']],
      ['changelogs/unreleased.md', ['ISSUE-043', 'Turn Liveness', 'V98', 'LocalTaskTraceV1']],
      ['scripts/test-turn-liveness.js', ['active-operation-lease', 'stalled-recoverable']],
      ['scripts/test-checkpoint-validation.js', ['incomplete-timeout', 'host-terminal-event']],
      ['scripts/test-local-task-trace.js', ['TRACE_DUPLICATE_EVENT', 'payload-must-not-run', 'CLI_INVALID_OPTION']],
      ['scripts/test-execution-attempt-ledger.js', ['qualification-required', 'stop-before-third', 'cancelled', 'ATTEMPT_DUPLICATE_CONFLICT']],
      ['scripts/test-local-probe.js', ['PROBE_DEPENDENCY_FAILED', 'zero-write']],
      ['scripts/test-turn-liveness-controls.js', ['zero-write', 'gray-read-only-one-shot']],
      ['scripts/test-hooks-runtime.js', ['liveness-turn-2', 'TurnRecoveryCard']]
    ]
    for (const [file, needles] of required) checkFile(file, needles)

    let state = createTurnLivenessState({ nowMs: 0 })
    state = observeTurnEvent(state, 'UserPromptSubmit', { session_id: 'v98-turn' }, { nowMs: 1000 }).state
    if (classifyTurnLiveness(state, { nowMs: 5 * 60 * 1000 }).state !== 'running') {
      err('[V98] running agent turn must remain covered by the long agent lease')
    }
    state = observeTurnEvent(state, 'PreToolUse', { tool_use_id: 'v98-tool' }, { nowMs: 2000 }).state
    state = startToolLease(state, { tool_use_id: 'v98-tool' }, 'read_file', { nowMs: 2000 })
    state = observeTurnEvent(state, 'PostToolUse', { tool_use_id: 'v98-tool' }, { nowMs: 3000 }).state
    state = completeToolLease(state, { tool_use_id: 'v98-tool' }, { nowMs: 3000 })
    const stalled = classifyTurnLiveness(state, { nowMs: 3000 + DEFAULT_THRESHOLDS.stalledAfterMs })
    if (stalled.state !== 'stalled-recoverable') err(`[V98] no-continuation fixture expected stalled-recoverable, got ${stalled.state}`)
    if (state.checkpointValidation.postExecution.status === 'pass') {
      err('[V98] PostToolUse must not satisfy post-execution checkpoint validation')
    }
    state = markTurnTerminal(state, 'completed', 'v98-terminal', { nowMs: 4000 })
    if (state.checkpointValidation.postExecution.status !== 'pass') {
      err('[V98] Hook terminal evidence must satisfy post-execution checkpoint validation')
    }
    const traceValidation = validateLocalTaskTrace(state.taskTrace)
    if (!traceValidation.valid) err(`[V98] LocalTaskTraceV1 invalid: ${JSON.stringify(traceValidation.violations)}`)
    const replay = replayLocalTaskTrace(state.taskTrace)
    if (!replay.ok || replay.capabilityBoundary.operationReplay || replay.capabilityBoundary.payloadExecution) {
      err('[V98] LocalTaskTrace replay must remain a valid read-only data projection')
    }
    let attemptState = createTurnLivenessState({ nowMs: 4500 })
    attemptState = observeTurnEvent(attemptState, 'UserPromptSubmit', { session_id: 'v98-attempt-turn' }, { nowMs: 4500 }).state
    let attempt = recordExecutionAttempt(attemptState, {
      eventId: 'v98-attempt-1', kind: 'formal', candidateId: 'v98-candidate', phase: 'test',
      commandSignature: 'node:test', result: 'failed', failureSignature: 'v98-failure', sourceDelta: 0, evidenceDelta: 0
    }, { nowMs: 5000 })
    attempt = recordExecutionAttempt(attempt.state, {
      eventId: 'v98-attempt-2', kind: 'formal', candidateId: 'v98-candidate', phase: 'test',
      commandSignature: 'node:test', result: 'failed', failureSignature: 'v98-failure', sourceDelta: 0, evidenceDelta: 0
    }, { nowMs: 6000 })
    if (attempt.decision.decision !== 'stop-before-third' || !attempt.state.executionAttemptLedger.stopSnapshot) {
      err('[V98] repeated zero-delta formal failure must stop before the third run')
    }
    const cancelled = finalizeExecutionAttemptLedger(attempt.state, 'cancelled', {
      cancelFinalizerStatus: 'passed', serviceLifecycleCleanup: 'N/A'
    }, { nowMs: 7000 })
    if (cancelled.executionAttemptLedger.terminal?.status !== 'cancelled' || cancelled.inFlightOperation) {
      err('[V98] cancellation must persist terminal evidence and release the operation lease')
    }

    const profileRoot = path.join(ACTIVE_DEVCODEX_ROOT, 'profile')
    if (fs.existsSync(profileRoot)) {
      for (const [file, needles] of [
        ['01-项目信息.md', ['Turn Liveness', 'scripts/check-turn-liveness.js']],
        ['02-架构约束.md', ['lifecycle-turn-liveness.cjs', 'lifecycle-checkpoint-validation.cjs', 'lifecycle-task-trace.cjs']],
        ['03-代码风格.md', ['LocalTaskTraceV1', 'local probe']],
        ['04-测试规范.md', ['V98', 'test-local-probe.js', 'test-checkpoint-validation.js', 'test-local-task-trace.js']],
        ['06-功能清单.md', ['local-observability', 'turn-liveness', 'CheckpointValidation', 'LocalTaskTraceV1']],
        ['07-用户文档与契约规范.md', ['本地 probe 契约', 'CheckpointValidation', 'LocalTaskTrace']]
      ]) {
        const target = path.join(profileRoot, file)
        const content = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
        for (const needle of needles) {
          if (!content.includes(needle)) err(`[V98] active Profile missing ${needle}: ${file}`)
        }
      }
    } else {
      console.log('[V98] active Profile corpus unavailable — repository consumers remain authoritative')
    }
    console.log('[V98] turn liveness core, host boundary and consumer controls checked')
  }

  return { checkV98 }
}

module.exports = { buildTurnLivenessControlChecks }
