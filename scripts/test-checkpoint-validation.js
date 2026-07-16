#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  createCheckpointValidationSet,
  normalizeCheckpointValidationSet,
  validateCheckpointEvidence
} = require('../hooks/_runtime/lifecycle-checkpoint-validation.cjs')
const {
  createTurnLivenessState,
  markTurnTerminal,
  normalizeTurnLivenessState,
  observeTurnEvent
} = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')

const BASE = Date.parse('2026-07-16T08:00:00.000Z')
const responseMissing = validateCheckpointEvidence({ mode: 'response-time' }, { nowMs: BASE })
assert.strictEqual(responseMissing.status, 'unverified')
assert.strictEqual(responseMissing.blocking, false)
assert.strictEqual(responseMissing.errorCode, 'HOST_RESULT_INCOMPLETE')

const responsePass = validateCheckpointEvidence({
  mode: 'response-time',
  evidence: [{ type: 'request', id: 'request-1' }]
}, { nowMs: BASE })
assert.strictEqual(responsePass.status, 'pass')
assert.strictEqual(responsePass.evidenceState, 'verified')

const blocked = validateCheckpointEvidence({
  mode: 'response-time',
  evidence: [{ type: 'request' }],
  blockingIssues: ['CP1 missing'],
  requiredActions: ['complete CP1']
}, { nowMs: BASE })
assert.strictEqual(blocked.status, 'blocked')
assert.strictEqual(blocked.blocking, true)
assert.deepStrictEqual(blocked.requiredActions, ['complete CP1'])

const deadlineAt = new Date(BASE + 1000).toISOString()
const postBeforeDeadline = validateCheckpointEvidence({ mode: 'post-execution', deadlineAt }, { nowMs: BASE })
assert.strictEqual(postBeforeDeadline.status, 'unverified')
assert.strictEqual(postBeforeDeadline.blocking, true)
const postAfterDeadline = validateCheckpointEvidence({ mode: 'post-execution', deadlineAt }, { nowMs: BASE + 1000 })
assert.strictEqual(postAfterDeadline.status, 'incomplete-timeout')
assert.strictEqual(postAfterDeadline.errorCode, 'TRACE_COMPLETION_TIMEOUT')

const invalidMode = validateCheckpointEvidence({ mode: 'eventual' }, { nowMs: BASE })
assert.strictEqual(invalidMode.status, 'blocked')
assert.strictEqual(invalidMode.errorCode, 'CHECKPOINT_MODE_INVALID')

const defaults = createCheckpointValidationSet({ nowMs: BASE })
assert.deepStrictEqual([defaults.responseTime.status, defaults.postExecution.status], ['unverified', 'unverified'])
const normalized = normalizeCheckpointValidationSet(defaults, { nowMs: BASE })
assert.strictEqual(normalized.postExecution.status, 'unverified')

const oldState = normalizeTurnLivenessState({ state: 'running', turnKey: 'legacy-turn' }, { nowMs: BASE })
assert.strictEqual(oldState.checkpointValidation.postExecution.status, 'unverified')
let state = createTurnLivenessState({ nowMs: BASE })
state = observeTurnEvent(state, 'UserPromptSubmit', { session_id: 'turn-checkpoint' }, { nowMs: BASE + 100 }).state
assert.strictEqual(state.checkpointValidation.responseTime.status, 'pass')
assert.strictEqual(state.checkpointValidation.postExecution.status, 'unverified')
assert.ok(state.checkpointValidation.postExecution.deadlineAt)
state = observeTurnEvent(state, 'PreCompact', {}, { nowMs: BASE + 200 }).state
assert.strictEqual(state.checkpointValidation.postExecution.status, 'unverified', 'PreCompact is not terminal evidence')
state = markTurnTerminal(state, 'completed', 'stop-event-completed', { nowMs: BASE + 300 })
assert.strictEqual(state.checkpointValidation.postExecution.status, 'pass')
assert.strictEqual(state.checkpointValidation.postExecution.evidence[0].type, 'host-terminal-event')

console.log('✓ two-phase checkpoint validation, timeout and Hook terminal evidence fixtures passed')
