#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  DEFAULT_THRESHOLDS,
  classifyTurnLiveness,
  completeToolLease,
  createTurnLivenessState,
  markTurnTerminal,
  normalizeTurnLivenessState,
  observeTurnEvent,
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
