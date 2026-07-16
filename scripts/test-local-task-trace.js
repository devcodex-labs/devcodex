#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  LocalTaskTraceError,
  appendLocalTaskTraceEvent,
  createLocalTaskTrace,
  normalizeLocalTaskTrace,
  replayLocalTaskTrace,
  validateLocalTaskTrace
} = require('../hooks/_runtime/lifecycle-task-trace.cjs')
const {
  completeToolLease,
  createTurnLivenessState,
  markTurnTerminal,
  normalizeTurnLivenessState,
  observeTurnEvent,
  startToolLease
} = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')

const BASE = Date.parse('2026-07-16T08:00:00.000Z')
let trace = createLocalTaskTrace({ turnKey: 'trace-unit', nowMs: BASE })
trace = appendLocalTaskTraceEvent(trace, {
  eventId: 'event-1', type: 'UserPromptSubmit', result: 'observed', payload: { prompt: 'fixture' }
}, { nowMs: BASE + 1 })
trace = appendLocalTaskTraceEvent(trace, {
  eventId: 'event-2', type: 'PreToolUse', result: 'observed', payload: { toolCallId: 'tool-1' }
}, { nowMs: BASE + 2 })
trace = appendLocalTaskTraceEvent(trace, {
  eventId: 'event-3', type: 'TurnTerminal', terminalStatus: 'complete', payload: { reason: 'fixture' }
}, { nowMs: BASE + 3 })
assert.strictEqual(trace.status, 'complete')
assert.strictEqual(trace.sequence, 3)
assert.strictEqual(validateLocalTaskTrace(trace).valid, true)
assert.throws(
  () => appendLocalTaskTraceEvent(trace, { type: 'PostTerminal' }, { nowMs: BASE + 4 }),
  error => error instanceof LocalTaskTraceError && error.code === 'TRACE_TERMINAL_INVALID'
)

let duplicate = createLocalTaskTrace({ turnKey: 'trace-duplicate', nowMs: BASE })
duplicate = appendLocalTaskTraceEvent(duplicate, { eventId: 'same', type: 'Observed' }, { nowMs: BASE + 1 })
assert.throws(
  () => appendLocalTaskTraceEvent(duplicate, { eventId: 'same', type: 'ObservedAgain' }, { nowMs: BASE + 2 }),
  error => error instanceof LocalTaskTraceError && error.code === 'TRACE_DUPLICATE_EVENT'
)
assert.throws(
  () => appendLocalTaskTraceEvent(createLocalTaskTrace({ turnKey: 'trace-sequence', nowMs: BASE }), { sequence: 2, type: 'Observed' }),
  error => error instanceof LocalTaskTraceError && error.code === 'TRACE_SEQUENCE_INVALID'
)

const invalidSequence = { ...duplicate, sequence: 3 }
assert.strictEqual(validateLocalTaskTrace(invalidSequence).violations[0].errorCode, 'TRACE_SEQUENCE_INVALID')
const invalidIdentity = { ...duplicate, openedAt: 'not-a-date' }
assert.strictEqual(validateLocalTaskTrace(invalidIdentity).violations[0].errorCode, 'TRACE_NOT_FOUND')
const invalidEvent = JSON.parse(JSON.stringify(duplicate))
delete invalidEvent.events[0].result
assert.strictEqual(validateLocalTaskTrace(invalidEvent).violations[0].errorCode, 'TRACE_SEQUENCE_INVALID')
const terminalNotLast = JSON.parse(JSON.stringify(trace))
terminalNotLast.events.push({ eventId: 'event-4', sequence: 4, observedAt: new Date(BASE + 4).toISOString(), type: 'AfterTerminal', result: 'observed', payload: {} })
terminalNotLast.sequence = 4
assert.ok(validateLocalTaskTrace(terminalNotLast).violations.some(item => item.errorCode === 'TRACE_TERMINAL_INVALID'))
const terminalTimeMismatch = { ...trace, completedAt: new Date(BASE + 5).toISOString() }
assert.ok(validateLocalTaskTrace(terminalTimeMismatch).violations.some(item => item.errorCode === 'TRACE_TERMINAL_INVALID'))
assert.deepStrictEqual(normalizeLocalTaskTrace(trace, { nowMs: BASE }), trace, 'restart normalization must preserve a valid persisted trace')

const beforeReplay = JSON.stringify(trace)
const replay = replayLocalTaskTrace(trace)
assert.strictEqual(replay.ok, true)
assert.strictEqual(replay.capabilityBoundary.operationReplay, false)
assert.strictEqual(replay.capabilityBoundary.payloadExecution, false)
assert.strictEqual(JSON.stringify(trace), beforeReplay, 'replay must not mutate the trace')

let state = createTurnLivenessState({ nowMs: BASE })
state = observeTurnEvent(state, 'UserPromptSubmit', { session_id: 'trace-hook' }, { nowMs: BASE + 10 }).state
state = observeTurnEvent(state, 'PreToolUse', { tool_use_id: 'tool-hook' }, { nowMs: BASE + 20 }).state
state = startToolLease(state, { tool_use_id: 'tool-hook', tool_input: { filePath: 'src/file.js' } }, 'read_file', { nowMs: BASE + 20 })
state = observeTurnEvent(state, 'PostToolUse', { tool_use_id: 'tool-hook' }, { nowMs: BASE + 30 }).state
state = completeToolLease(state, { tool_use_id: 'tool-hook', success: true }, { nowMs: BASE + 30 })
const sequenceBeforeDuplicate = state.taskTrace.sequence
state = completeToolLease(state, { tool_use_id: 'tool-hook', success: true }, { nowMs: BASE + 40 })
assert.strictEqual(state.taskTrace.sequence, sequenceBeforeDuplicate, 'duplicate tool completion must not append a trace event')
state = markTurnTerminal(state, 'completed', 'stop-event-completed', { nowMs: BASE + 50 })
assert.strictEqual(state.taskTrace.status, 'complete')
assert.strictEqual(state.taskTrace.events.at(-1).type, 'TurnTerminal')
assert.deepStrictEqual(state.taskTrace.events.map(event => event.sequence), state.taskTrace.events.map((_, index) => index + 1))
const restarted = normalizeTurnLivenessState(JSON.parse(JSON.stringify(state)), { nowMs: BASE + 60 })
assert.deepStrictEqual(restarted.taskTrace, state.taskTrace)
const nextTurn = observeTurnEvent(restarted, 'UserPromptSubmit', { session_id: 'trace-next' }, { nowMs: BASE + 70 }).state
assert.strictEqual(nextTurn.previousTurn.terminalState, 'completed')
assert.strictEqual(nextTurn.taskTrace.turnKey, 'trace-next')
assert.strictEqual(nextTurn.taskTrace.sequence, 1)

const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'index.js')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-trace-cli-'))
const stateFile = path.join(tempRoot, 'lifecycle-state.json')
const payloadMarker = path.join(tempRoot, 'payload-must-not-run.txt')
const cliState = JSON.parse(JSON.stringify(state))
cliState.taskTrace.events[0].payload = { wouldCreate: payloadMarker, command: 'payload-is-data-only' }
fs.writeFileSync(stateFile, JSON.stringify({ turnLiveness: cliState }, null, 2))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const beforeHash = hash(stateFile)
const runCli = args => spawnSync(process.execPath, [CLI, ...args], { cwd: tempRoot, encoding: 'utf8' })

const show = runCli(['trace', 'show', '--state', stateFile, '--json'])
assert.strictEqual(show.status, 0, show.stderr || show.stdout)
const showEnvelope = JSON.parse(show.stdout)
assert.strictEqual(showEnvelope.payload.schemaVersion, 'LocalTaskTraceViewV1')
assert.strictEqual(showEnvelope.payload.validation.valid, true)
const replayRun = runCli(['trace', 'replay', '--state', stateFile, '--json'])
assert.strictEqual(replayRun.status, 0, replayRun.stderr || replayRun.stdout)
const replayEnvelope = JSON.parse(replayRun.stdout)
assert.strictEqual(replayEnvelope.payload.schemaVersion, 'LocalTaskTraceReplayV1')
assert.strictEqual(replayEnvelope.payload.capabilityBoundary.operationReplay, false)
assert.strictEqual(hash(stateFile), beforeHash, 'trace show/replay must not mutate lifecycle state')
assert.strictEqual(fs.existsSync(payloadMarker), false, 'trace replay must never execute payload data')

const invalidStateFile = path.join(tempRoot, 'invalid-sequence.json')
fs.writeFileSync(invalidStateFile, JSON.stringify({ turnLiveness: { ...cliState, taskTrace: { ...cliState.taskTrace, sequence: 999 } } }, null, 2))
const invalidReplay = runCli(['trace', 'replay', '--state', invalidStateFile, '--json'])
assert.strictEqual(invalidReplay.status, 1)
assert.strictEqual(JSON.parse(invalidReplay.stdout).errorCode, 'TRACE_SEQUENCE_INVALID')
const missing = runCli(['trace', 'show', '--state', path.join(tempRoot, 'missing.json'), '--json'])
assert.strictEqual(missing.status, 1)
assert.strictEqual(JSON.parse(missing.stdout).errorCode, 'TRACE_NOT_FOUND')
const missingStateValue = runCli(['trace', 'show', '--state', '--json'])
assert.strictEqual(missingStateValue.status, 2)
assert.strictEqual(JSON.parse(missingStateValue.stdout).errorCode, 'CLI_INVALID_OPTION')
const human = runCli(['trace', 'show', '--state', stateFile])
assert.strictEqual(human.status, 0)
assert.match(human.stdout, /DevCodex trace show/)
assert.doesNotMatch(human.stdout, /DevCodexCliEnvelopeV1/)

console.log('✓ LocalTaskTrace sequence, duplicate, terminal, restart, CLI replay and zero-write fixtures passed')
