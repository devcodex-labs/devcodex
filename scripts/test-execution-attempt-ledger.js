#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  ExecutionAttemptLedgerError,
  createTurnLivenessState,
  evaluateExecutionAttempt,
  finalizeExecutionAttemptLedger,
  normalizeTurnLivenessState,
  observeTurnEvent,
  recordExecutionAttempt,
  startToolLease
} = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')

const BASE = Date.parse('2026-07-19T00:00:00.000Z')
let state = createTurnLivenessState({ nowMs: BASE })
state = observeTurnEvent(state, 'UserPromptSubmit', { session_id: 'attempt-turn' }, { nowMs: BASE + 1 }).state
assert.strictEqual(state.executionAttemptLedger.schemaVersion, 'ExecutionAttemptLedgerV1')

const blockedByQualification = recordExecutionAttempt(state, {
  eventId: 'formal-before-probe',
  kind: 'formal',
  candidateId: 'candidate-a',
  phase: 'test',
  commandSignature: 'npm:test',
  qualificationAvailable: true,
  result: 'failed',
  failureSignature: 'exit-1'
}, { nowMs: BASE + 2 })
assert.strictEqual(blockedByQualification.decision.decision, 'qualification-required')
assert.strictEqual(blockedByQualification.state.executionAttemptLedger.entries.length, 0)

let recorded = recordExecutionAttempt(state, {
  eventId: 'qualification-pass',
  kind: 'qualification',
  candidateId: 'candidate-a',
  phase: 'test',
  commandSignature: 'npm:test',
  result: 'passed',
  qualificationEvidence: ['focused-test-pass'],
  commandWallMs: 50
}, { nowMs: BASE + 3 })
state = recorded.state
assert.strictEqual(recorded.entry.attemptNo, 1)
assert.strictEqual(recorded.decision.decision, 'recorded')

recorded = recordExecutionAttempt(state, {
  eventId: 'formal-fail-1',
  kind: 'formal',
  candidateId: 'candidate-a',
  phase: 'test',
  commandSignature: 'npm:test',
  qualificationAvailable: true,
  result: 'failed',
  failureSignature: 'exit-1:fixture',
  sourceDelta: 0,
  evidenceDelta: 0,
  commandWallMs: 100,
  externalWaitMs: 40,
  waitingUserMs: 20,
  modelReasoningMs: 30
}, { nowMs: BASE + 4 })
state = recorded.state
assert.strictEqual(recorded.decision.allowed, true)
assert.strictEqual(recorded.entry.attemptNo, 1)
assert.strictEqual(recorded.entry.firstPassYield, 0)
assert.deepStrictEqual(
  [recorded.entry.commandWallMs, recorded.entry.externalWaitMs, recorded.entry.waitingUserMs, recorded.entry.modelReasoningMs],
  [100, 40, 20, 30],
  'timing dimensions must remain separate'
)

recorded = recordExecutionAttempt(state, {
  eventId: 'formal-fail-2',
  kind: 'formal',
  candidateId: 'candidate-a',
  phase: 'test',
  commandSignature: 'npm:test',
  qualificationAvailable: true,
  result: 'failed',
  failureSignature: 'exit-1:fixture',
  sourceDelta: 0,
  evidenceDelta: 0
}, { nowMs: BASE + 5 })
state = recorded.state
assert.strictEqual(recorded.decision.decision, 'stop-before-third')
assert.strictEqual(recorded.decision.allowed, false)
assert.strictEqual(state.checkpoint.phase, 'execution-stop-required')
assert.strictEqual(state.executionAttemptLedger.stopSnapshot.consecutiveAttempts, 2)

const beforeThird = state.executionAttemptLedger.entries.length
recorded = recordExecutionAttempt(state, {
  eventId: 'formal-fail-3-must-not-run',
  kind: 'formal',
  candidateId: 'candidate-a',
  phase: 'test',
  commandSignature: 'npm:test',
  result: 'failed',
  failureSignature: 'exit-1:fixture'
}, { nowMs: BASE + 6 })
assert.strictEqual(recorded.decision.decision, 'stop-before-third')
assert.strictEqual(recorded.state.executionAttemptLedger.entries.length, beforeThird)
assert.strictEqual(evaluateExecutionAttempt(state, {
  candidateId: 'candidate-a', phase: 'test', commandSignature: 'npm:test', failureSignature: 'exit-1:fixture'
}).allowed, false)

const duplicate = recordExecutionAttempt(state, {
  eventId: 'formal-fail-2',
  kind: 'formal',
  candidateId: 'candidate-a',
  phase: 'test',
  commandSignature: 'npm:test',
  qualificationAvailable: true,
  result: 'failed',
  failureSignature: 'exit-1:fixture',
  sourceDelta: 0,
  evidenceDelta: 0
}, { nowMs: BASE + 7 })
assert.strictEqual(duplicate.decision.decision, 'duplicate-ignored')
assert.strictEqual(duplicate.state.executionAttemptLedger.duplicateEvents, 1)
assert.throws(
  () => recordExecutionAttempt(state, {
    eventId: 'formal-fail-2', kind: 'formal', candidateId: 'candidate-a', phase: 'test', commandSignature: 'npm:test',
    result: 'failed', failureSignature: 'different-failure'
  }, { nowMs: BASE + 8 }),
  error => error instanceof ExecutionAttemptLedgerError && error.code === 'ATTEMPT_DUPLICATE_CONFLICT'
)

let deltaState = createTurnLivenessState({ nowMs: BASE })
deltaState = observeTurnEvent(deltaState, 'UserPromptSubmit', { session_id: 'delta-turn' }, { nowMs: BASE + 10 }).state
for (const attempt of [
  { eventId: 'delta-1', sourceDelta: 0, evidenceDelta: 0 },
  { eventId: 'delta-2', sourceDelta: 1, evidenceDelta: 0 },
  { eventId: 'delta-3', sourceDelta: 0, evidenceDelta: 0 }
]) {
  deltaState = recordExecutionAttempt(deltaState, {
    ...attempt,
    kind: 'formal', candidateId: 'candidate-delta', phase: 'test', commandSignature: 'node:test',
    result: 'failed', failureSignature: 'same-failure'
  }, { nowMs: BASE + 10 + Number(attempt.eventId.at(-1)) }).state
}
assert.strictEqual(deltaState.executionAttemptLedger.stopSnapshot, null, 'source delta must reset the no-progress streak')
assert.strictEqual(evaluateExecutionAttempt(deltaState, {
  candidateId: 'candidate-delta', phase: 'test', commandSignature: 'node:test', failureSignature: 'same-failure'
}).noProgressFailureStreak, 1)

let passState = createTurnLivenessState({ nowMs: BASE })
passState = observeTurnEvent(passState, 'UserPromptSubmit', { session_id: 'pass-turn' }, { nowMs: BASE + 20 }).state
const firstPass = recordExecutionAttempt(passState, {
  eventId: 'pass-1', kind: 'formal', candidateId: 'candidate-pass', phase: 'test', commandSignature: 'node:focused', result: 'passed'
}, { nowMs: BASE + 21 })
assert.strictEqual(firstPass.entry.firstPassYield, 1)

let cancelState = startToolLease(firstPass.state, { tool_use_id: 'owned-tool' }, 'shell_command', { nowMs: BASE + 22 })
cancelState = finalizeExecutionAttemptLedger(cancelState, 'cancelled', {
  reason: 'explicit-user-cancel',
  cancelFinalizerStatus: 'passed',
  serviceLifecycleCleanup: 'no-ai-started-service'
}, { nowMs: BASE + 23 })
assert.strictEqual(cancelState.state, 'interrupted')
assert.strictEqual(cancelState.inFlightOperation, null)
assert.strictEqual(cancelState.executionAttemptLedger.terminal.status, 'cancelled')
assert.strictEqual(cancelState.executionAttemptLedger.terminal.cancelFinalizer.status, 'passed')
assert.strictEqual(cancelState.previousTurn.terminalState, 'cancelled')

const restarted = normalizeTurnLivenessState(JSON.parse(JSON.stringify(cancelState)), { nowMs: BASE + 24 })
assert.strictEqual(restarted.executionAttemptLedger.terminal.status, 'cancelled')
assert.strictEqual(restarted.executionAttemptLedger.entries.length, cancelState.executionAttemptLedger.entries.length)
assert.notStrictEqual(restarted.executionAttemptLedger.terminal.status, 'completed', 'restart must not promote an old in-progress/cancelled ledger')
const afterTerminal = recordExecutionAttempt(restarted, {
  eventId: 'after-terminal', kind: 'formal', candidateId: 'candidate-pass', phase: 'test', commandSignature: 'node:focused', result: 'passed'
}, { nowMs: BASE + 25 })
assert.strictEqual(afterTerminal.decision.decision, 'terminal')
assert.strictEqual(afterTerminal.state.executionAttemptLedger.entries.length, restarted.executionAttemptLedger.entries.length)
assert.strictEqual(finalizeExecutionAttemptLedger(restarted, 'completed', {}, { nowMs: BASE + 26 }).executionAttemptLedger.terminal.status, 'cancelled')

const nextPrompt = observeTurnEvent(restarted, 'UserPromptSubmit', { session_id: 'next-attempt-cycle' }, { nowMs: BASE + 27 }).state
assert.strictEqual(nextPrompt.executionAttemptLedger.terminal, null)
assert.strictEqual(nextPrompt.executionAttemptLedger.entries.length, 0)
assert.strictEqual(nextPrompt.previousExecutionAttemptLedger.terminal.status, 'cancelled')
const nextCycleAttempt = recordExecutionAttempt(nextPrompt, {
  eventId: 'next-cycle-pass', kind: 'formal', candidateId: 'candidate-next', phase: 'test', commandSignature: 'node:next', result: 'passed'
}, { nowMs: BASE + 28 })
assert.strictEqual(nextCycleAttempt.decision.decision, 'recorded')
assert.strictEqual(nextCycleAttempt.state.executionAttemptLedger.entries.length, 1)

console.log('execution attempt ledger tests passed: qualification/no-progress/cancel/restart/duplicate-event third-run-stop=closed')
