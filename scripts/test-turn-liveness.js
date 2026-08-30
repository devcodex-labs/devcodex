#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  DEFAULT_THRESHOLDS,
  classifyTurnLiveness,
  completeToolLease,
  createTurnLivenessState,
  abortPreparedTaskOperation,
  markTaskOperationDispatched,
  markTaskOperationObserved,
  markTurnTerminal,
  normalizeTurnLivenessState,
  observeTurnEvent,
  prepareTaskOperationRecord,
  reconcileTaskOperationRecord,
  settleTaskOperationRecord,
  startToolLease
} = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')

const BASE = Date.parse('2026-07-15T00:00:00.000Z')

function at(offsetMs) {
  return BASE + offsetMs
}

function main() {
  const empty = createTurnLivenessState({ nowMs: at(0) })
  assert.strictEqual(empty.state, 'idle')
  assert.deepStrictEqual(empty.thresholds, DEFAULT_THRESHOLDS)

  let observed = observeTurnEvent(empty, 'UserPromptSubmit', { session_id: 'turn-a' }, { nowMs: at(1000) })
  let state = observed.state
  assert.strictEqual(state.state, 'running')
  assert.strictEqual(state.turnKey, 'turn-a')
  assert.strictEqual(classifyTurnLiveness(state, { nowMs: at(5 * 60 * 1000) }).state, 'running')
  assert.strictEqual(classifyTurnLiveness(state, { nowMs: at(30 * 60 * 1000 + 1000) }).state, 'suspect')

  observed = observeTurnEvent(state, 'PreToolUse', { tool_use_id: 'tool-a' }, { nowMs: at(2000) })
  state = startToolLease(observed.state, {
    tool_use_id: 'tool-a',
    tool_input: { filePath: 'src/example.js' }
  }, 'read_file', { nowMs: at(2000) })
  assert.strictEqual(state.inFlightOperation.operationId, 'tool-a')
  assert.strictEqual(state.inFlightOperation.ownedByAgent, true)
  assert.deepStrictEqual(state.checkpoint.artifactPaths, ['src/example.js'])
  const activeOperationLease = classifyTurnLiveness(state, { nowMs: at(20 * 60 * 1000) })
  assert.strictEqual(activeOperationLease.state, 'running')
  assert.strictEqual(activeOperationLease.reason, 'active-operation-lease')
  assert.strictEqual(classifyTurnLiveness(state, { nowMs: at(30 * 60 * 1000 + 2000) }).state, 'suspect')
  assert.strictEqual(classifyTurnLiveness(state, { nowMs: at(35 * 60 * 1000 + 2000) }).state, 'stalled-recoverable')

  observed = observeTurnEvent(state, 'PostToolUse', { tool_use_id: 'tool-a' }, { nowMs: at(5000) })
  state = completeToolLease(observed.state, { tool_use_id: 'tool-a', success: true }, { nowMs: at(5000) })
  assert.strictEqual(state.state, 'awaiting-continuation')
  assert.strictEqual(state.inFlightOperation, null)
  assert.strictEqual(classifyTurnLiveness(state, { nowMs: at(5000 + DEFAULT_THRESHOLDS.suspectAfterMs - 1) }).state, 'awaiting-continuation')
  assert.strictEqual(classifyTurnLiveness(state, { nowMs: at(5000 + DEFAULT_THRESHOLDS.suspectAfterMs) }).state, 'suspect')
  assert.strictEqual(classifyTurnLiveness(state, { nowMs: at(5000 + DEFAULT_THRESHOLDS.stalledAfterMs) }).state, 'stalled-recoverable')

  const originalToolOutputAt = state.lastToolOutputAt
  const originalIdempotencyKey = state.checkpoint.idempotencyKey
  state = completeToolLease(state, { tool_use_id: 'tool-a', success: true }, { nowMs: at(9000) })
  assert.strictEqual(state.lastToolOutputAt, originalToolOutputAt, 'duplicate PostToolUse must not move the output timestamp')
  assert.strictEqual(state.checkpoint.idempotencyKey, originalIdempotencyKey)

  observed = observeTurnEvent(
    state,
    'PreToolUse',
    { tool_use_id: 'tool-b' },
    { nowMs: at(5000 + DEFAULT_THRESHOLDS.stalledAfterMs + 1) }
  )
  assert.ok(observed.recoveryCard)
  assert.strictEqual(observed.recoveryCard.priorState, 'stalled-recoverable')
  assert.strictEqual(observed.state.state, 'running')
  assert.ok(observed.state.continuationAckAt)
  const noticeKey = observed.recoveryCard.noticeKey
  const repeated = observeTurnEvent(observed.state, 'PreCompact', {}, { nowMs: at(5000 + DEFAULT_THRESHOLDS.stalledAfterMs + 2) })
  assert.strictEqual(repeated.recoveryCard, null, 'the same recovered turn must not emit a duplicate recovery card')
  assert.strictEqual(repeated.state.lastRecoveryNoticeKey, noticeKey)
  assert.strictEqual(repeated.state.checkpoint.phase, 'pre-compact')

  state = startToolLease(repeated.state, { tool_use_id: 'tool-b' }, 'shell_command', { nowMs: at(400000) })
  state = markTurnTerminal(state, 'completed', 'stop-event', { nowMs: at(401000) })
  assert.strictEqual(state.state, 'completed')
  assert.strictEqual(state.inFlightOperation, null)
  assert.strictEqual(state.previousTurn.terminalState, 'completed')
  assert.strictEqual(state.checkpointValidation.postExecution.status, 'pass')

  let prepared = observeTurnEvent(createTurnLivenessState({ nowMs: at(0) }), 'UserPromptSubmit', {
    session_id: 'operation-prepare-turn'
  }, { nowMs: at(1000) }).state
  prepared = startToolLease(prepared, { tool_use_id: 'operation-prepared' }, 'write_file', {
    nowMs: at(2000),
    mutating: true,
    targetPaths: ['D:/workspace/a.md']
  })
  const preparedInput = {
    operationId: 'operation-prepared',
    writerGeneration: 3,
    expectedStateSequence: 7,
    kind: 'update',
    exactTargets: ['D:/workspace/a.md'],
    targetSetDigest: '1'.repeat(64),
    beforeDigest: '2'.repeat(64)
  }
  prepared = prepareTaskOperationRecord(prepared, preparedInput, { nowMs: at(2000) })
  assert.strictEqual(prepared.taskOperationSet.unresolved.phase, 'prepared')
  const exactReplay = prepareTaskOperationRecord(prepared, preparedInput, { nowMs: at(2200) })
  assert.strictEqual(exactReplay.taskOperationSet.unresolved.recordDigest, prepared.taskOperationSet.unresolved.recordDigest)
  assert.strictEqual(exactReplay.taskOperationSet.unresolved.preparedAt, prepared.taskOperationSet.unresolved.preparedAt)
  assert.throws(
    () => prepareTaskOperationRecord(prepared, {
      ...preparedInput,
      exactTargets: ['D:/workspace/different.md']
    }, { nowMs: at(2200) }),
    error => error.code === 'TASK_OPERATION_REPLAY_MISMATCH',
    'the same operationId must not authorize a different prepared target set'
  )
  assert.throws(
    () => prepareTaskOperationRecord(prepared, {
      ...preparedInput,
      writerGeneration: preparedInput.writerGeneration + 1
    }, { nowMs: at(2200) }),
    error => error.code === 'TASK_OPERATION_REPLAY_MISMATCH',
    'the same operationId must not cross a writer generation fence'
  )
  assert.throws(
    () => markTurnTerminal(prepared, 'completed', 'must-not-close', { nowMs: at(2500) }),
    error => error.code === 'TASK_OPERATION_UNSETTLED'
  )
  const aborted = abortPreparedTaskOperation(prepared, 'operation-prepared', { nowMs: at(2600) })
  assert.strictEqual(aborted.taskOperationSet.unresolved, null)
  assert.strictEqual(aborted.taskOperationSet.settled[0].phase, 'aborted-zero-effect')
  assert.doesNotThrow(() => markTurnTerminal(aborted, 'completed', 'zero-effect-abort', { nowMs: at(2700) }))

  let dispatched = observeTurnEvent(createTurnLivenessState({ nowMs: at(0) }), 'UserPromptSubmit', {
    session_id: 'operation-dispatch-turn'
  }, { nowMs: at(1000) }).state
  dispatched = startToolLease(dispatched, { tool_use_id: 'operation-dispatched' }, 'write_file', {
    nowMs: at(2000),
    mutating: true,
    targetPaths: ['D:/workspace/b.md']
  })
  dispatched = prepareTaskOperationRecord(dispatched, {
    operationId: 'operation-dispatched',
    writerGeneration: 4,
    expectedStateSequence: 8,
    kind: 'update',
    exactTargets: ['D:/workspace/b.md'],
    targetSetDigest: '3'.repeat(64),
    beforeDigest: '4'.repeat(64)
  }, { nowMs: at(2000) })
  dispatched = markTaskOperationDispatched(dispatched, 'operation-dispatched', { nowMs: at(2100) })
  assert.throws(
    () => abortPreparedTaskOperation(dispatched, 'operation-dispatched', { nowMs: at(2200) }),
    error => error.code === 'TASK_OPERATION_ABORT_INVALID',
    'a dispatched operation must never be downgraded to zero effect'
  )
  dispatched = completeToolLease(dispatched, {
    tool_use_id: 'operation-dispatched',
    success: true,
    tool_output: { accepted: true }
  }, { nowMs: at(2300) })
  assert.strictEqual(dispatched.taskOperationSet.unresolved.phase, 'observed')
  dispatched = settleTaskOperationRecord(dispatched, 'operation-dispatched', {
    needsReconcile: true,
    effect: 'unknown',
    resultDigest: '5'.repeat(64),
    evidenceDigest: '6'.repeat(64)
  }, { nowMs: at(2400) })
  assert.strictEqual(dispatched.taskOperationSet.unresolved.phase, 'reconcile-required')
  assert.throws(
    () => markTurnTerminal(dispatched, 'completed', 'unknown-effect', { nowMs: at(2500) }),
    error => error.code === 'TASK_OPERATION_UNSETTLED'
  )
  const reconciled = reconcileTaskOperationRecord(dispatched, 'operation-dispatched', {
    effect: 'known-applied',
    resultDigest: '7'.repeat(64),
    evidenceDigest: '8'.repeat(64)
  }, { nowMs: at(2600) })
  assert.strictEqual(reconciled.taskOperationSet.unresolved, null)
  assert.strictEqual(reconciled.taskOperationSet.settled[0].effect, 'known-applied')
  const operationTerminal = markTurnTerminal(reconciled, 'completed', 'settled', { nowMs: at(2700) })
  assert.throws(
    () => markTaskOperationObserved(operationTerminal, 'operation-dispatched', {}, { nowMs: at(2800) }),
    error => error.code === 'TASK_OPERATION_CAS_MISMATCH',
    'a late PostToolUse cannot reopen or overwrite a settled terminal operation'
  )

  const oldState = normalizeTurnLivenessState({ state: 'running', lastEventAt: '2026-07-15T00:00:01.000Z' }, { nowMs: at(0) })
  assert.strictEqual(oldState.schemaVersion, 1)
  assert.strictEqual(oldState.checkpoint.resumeToken, '')
  assert.strictEqual(oldState.checkpointValidation.postExecution.status, 'unverified')
  assert.deepStrictEqual(oldState.thresholds, DEFAULT_THRESHOLDS)

  const staleOld = {
    ...oldState,
    turnKey: 'old-turn',
    state: 'awaiting-continuation',
    lastToolOutputAt: '2026-07-15T00:00:01.000Z'
  }
  const newPrompt = observeTurnEvent(
    staleOld,
    'UserPromptSubmit',
    { session_id: 'new-turn' },
    { nowMs: at(DEFAULT_THRESHOLDS.stalledAfterMs + 2000) }
  )
  assert.strictEqual(newPrompt.state.turnKey, 'new-turn')
  assert.strictEqual(newPrompt.state.previousTurn.terminalState, 'interrupted')
  assert.strictEqual(newPrompt.recoveryCard.priorState, 'stalled-recoverable')

  process.stdout.write('turn liveness state-machine tests passed\n')
}

main()
