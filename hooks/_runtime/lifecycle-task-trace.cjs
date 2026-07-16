'use strict'

const crypto = require('crypto')

const LOCAL_TASK_TRACE_SCHEMA_VERSION = 'LocalTaskTraceV1'
const LOCAL_TASK_TRACE_REPLAY_SCHEMA_VERSION = 'LocalTaskTraceReplayV1'
const TRACE_STATUSES = new Set(['open', 'complete', 'failed', 'interrupted'])
const TERMINAL_RESULTS = new Set(['complete', 'failed', 'interrupted'])

class LocalTaskTraceError extends Error {
  constructor(code, message, nextStep) {
    super(message)
    this.name = 'LocalTaskTraceError'
    this.code = code
    this.nextStep = nextStep
  }
}

function nowMsFrom(options = {}) {
  return Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
}

function normalizeIso(value, fallbackMs) {
  const parsed = Date.parse(String(value || ''))
  return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString()
}

function stableId(prefix, parts) {
  const digest = crypto.createHash('sha256').update(parts.map(part => String(part || '')).join('\u001f')).digest('hex')
  return `${prefix}-${digest.slice(0, 20)}`
}

function clonePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value === undefined ? {} : { value: String(value) }
  return { ...value }
}

function createTraceEventId(trace, parts) {
  return stableId('event', [trace?.traceId || '', ...(Array.isArray(parts) ? parts : [parts])])
}

/** Create the current-turn trace; historical turns remain summarized by TurnLiveness. */
function createLocalTaskTrace(options = {}) {
  const nowMs = nowMsFrom(options)
  const turnKey = String(options.turnKey || '').trim()
  if (!turnKey) {
    throw new LocalTaskTraceError('TRACE_NOT_FOUND', 'A LocalTaskTrace requires a non-empty turnKey.', 'Wait for a UserPromptSubmit event before creating a trace.')
  }
  const openedAt = normalizeIso(options.openedAt, nowMs)
  return {
    schemaVersion: LOCAL_TASK_TRACE_SCHEMA_VERSION,
    traceId: stableId('trace', [turnKey, openedAt]),
    turnKey,
    status: 'open',
    sequence: 0,
    openedAt,
    completedAt: null,
    events: []
  }
}

function normalizeLocalTaskTrace(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const turnKey = String(options.turnKey || '').trim()
    return turnKey ? createLocalTaskTrace({ ...options, turnKey }) : null
  }
  return {
    ...raw,
    events: Array.isArray(raw.events)
      ? raw.events.map(event => ({ ...event, payload: clonePayload(event?.payload) }))
      : raw.events
  }
}

function violation(errorCode, message, eventIndex = null) {
  return { errorCode, message, eventIndex }
}

/** Validate identity, strict sequence, terminal uniqueness and completion alignment. */
function validateLocalTaskTrace(raw) {
  const trace = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  const violations = []
  if (
    !trace ||
    trace.schemaVersion !== LOCAL_TASK_TRACE_SCHEMA_VERSION ||
    !trace.traceId ||
    !trace.turnKey ||
    !Number.isFinite(Date.parse(String(trace.openedAt || '')))
  ) {
    violations.push(violation('TRACE_NOT_FOUND', 'LocalTaskTraceV1 identity is missing or invalid.'))
    return { valid: false, violations }
  }
  if (!TRACE_STATUSES.has(trace.status)) violations.push(violation('TRACE_TERMINAL_INVALID', `Invalid trace status: ${trace.status}`))
  if (!Array.isArray(trace.events)) {
    violations.push(violation('TRACE_SEQUENCE_INVALID', 'Trace events must be an array.'))
    return { valid: false, violations }
  }

  const eventIds = new Set()
  const terminalIndexes = []
  trace.events.forEach((event, index) => {
    const expected = index + 1
    const payloadValid = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    if (
      !event ||
      event.sequence !== expected ||
      !String(event.type || '').trim() ||
      !String(event.result || '').trim() ||
      !Number.isFinite(Date.parse(String(event.observedAt || ''))) ||
      !payloadValid
    ) {
      violations.push(violation('TRACE_SEQUENCE_INVALID', `Trace event ${expected} has invalid sequence, type, result, observedAt, or payload.`, index))
    }
    if (!event?.eventId || eventIds.has(event.eventId)) {
      violations.push(violation('TRACE_DUPLICATE_EVENT', `Trace event ${expected} has a missing or duplicate eventId.`, index))
    } else {
      eventIds.add(event.eventId)
    }
    if (event?.type === 'TurnTerminal') terminalIndexes.push(index)
  })
  if (trace.sequence !== trace.events.length) {
    violations.push(violation('TRACE_SEQUENCE_INVALID', `Trace sequence ${trace.sequence} does not match event count ${trace.events.length}.`))
  }
  if (terminalIndexes.length > 1 || (terminalIndexes.length === 1 && terminalIndexes[0] !== trace.events.length - 1)) {
    violations.push(violation('TRACE_TERMINAL_INVALID', 'A terminal event must appear exactly once and must be the final event.'))
  }
  const terminalEvent = terminalIndexes.length === 1 ? trace.events[terminalIndexes[0]] : null
  if (trace.status === 'open') {
    if (terminalEvent || trace.completedAt !== null) violations.push(violation('TRACE_TERMINAL_INVALID', 'An open trace cannot contain terminal evidence or completedAt.'))
  } else {
    if (!terminalEvent || terminalEvent.result !== trace.status || !TERMINAL_RESULTS.has(terminalEvent.result)) {
      violations.push(violation('TRACE_TERMINAL_INVALID', 'Terminal result must match the trace status.'))
    }
    if (!Number.isFinite(Date.parse(String(trace.completedAt || '')))) {
      violations.push(violation('TRACE_TERMINAL_INVALID', 'A terminal trace requires completedAt.'))
    } else if (terminalEvent && Date.parse(trace.completedAt) !== Date.parse(terminalEvent.observedAt)) {
      violations.push(violation('TRACE_TERMINAL_INVALID', 'Trace completedAt must match the terminal event observedAt.'))
    }
  }
  return { valid: violations.length === 0, violations }
}

/** Append one typed event. Invalid, duplicate, out-of-order or post-terminal input is rejected. */
function appendLocalTaskTraceEvent(raw, input = {}, options = {}) {
  const validation = validateLocalTaskTrace(raw)
  if (!validation.valid) {
    const first = validation.violations[0]
    throw new LocalTaskTraceError(first.errorCode, first.message, 'Repair or replace the invalid trace before appending an event.')
  }
  if (raw.status !== 'open') {
    throw new LocalTaskTraceError('TRACE_TERMINAL_INVALID', 'Cannot append after the terminal event.', 'Start a new trace for the next turn.')
  }
  const expectedSequence = raw.sequence + 1
  const suppliedSequence = input.sequence === undefined ? expectedSequence : Number(input.sequence)
  if (!Number.isInteger(suppliedSequence) || suppliedSequence !== expectedSequence) {
    throw new LocalTaskTraceError('TRACE_SEQUENCE_INVALID', `Expected sequence ${expectedSequence}, received ${input.sequence}.`, 'Append the next strict sequence value only.')
  }
  const type = String(input.type || '').trim()
  if (!type) throw new LocalTaskTraceError('TRACE_SEQUENCE_INVALID', 'Trace event type is required.', 'Provide the observed lifecycle event type.')
  const eventId = String(input.eventId || createTraceEventId(raw, [suppliedSequence, type, input.result || 'observed']))
  if (raw.events.some(event => event.eventId === eventId)) {
    throw new LocalTaskTraceError('TRACE_DUPLICATE_EVENT', `Duplicate trace event: ${eventId}`, 'Ignore the duplicate host delivery and retain the existing event.')
  }
  const nowMs = nowMsFrom(options)
  const terminalStatus = input.terminalStatus === undefined ? null : String(input.terminalStatus)
  if (terminalStatus !== null && !TERMINAL_RESULTS.has(terminalStatus)) {
    throw new LocalTaskTraceError('TRACE_TERMINAL_INVALID', `Invalid terminal status: ${terminalStatus}`, 'Use complete, failed, or interrupted.')
  }
  if (terminalStatus !== null && type !== 'TurnTerminal') {
    throw new LocalTaskTraceError('TRACE_TERMINAL_INVALID', 'Terminal status requires a TurnTerminal event.', 'Emit terminal evidence only from the Hook terminal path.')
  }
  const observedAt = normalizeIso(input.observedAt, nowMs)
  const event = {
    eventId,
    sequence: suppliedSequence,
    observedAt,
    type,
    result: terminalStatus || String(input.result || 'observed'),
    payload: clonePayload(input.payload)
  }
  return {
    ...raw,
    status: terminalStatus || 'open',
    sequence: suppliedSequence,
    completedAt: terminalStatus ? observedAt : null,
    events: [...raw.events.map(existing => ({ ...existing, payload: clonePayload(existing.payload) })), event]
  }
}

/** Return an ordered data projection only; payloads are never invoked or dispatched. */
function replayLocalTaskTrace(raw) {
  const validation = validateLocalTaskTrace(raw)
  const base = {
    schemaVersion: LOCAL_TASK_TRACE_REPLAY_SCHEMA_VERSION,
    ok: validation.valid,
    traceId: raw?.traceId || null,
    turnKey: raw?.turnKey || null,
    status: raw?.status || null,
    errorCode: validation.valid ? null : validation.violations[0].errorCode,
    violations: validation.violations,
    capabilityBoundary: {
      readOnly: true,
      stateMutation: false,
      operationReplay: false,
      payloadExecution: false,
      processControl: false
    },
    events: []
  }
  if (!validation.valid) return base
  return {
    ...base,
    events: raw.events.map(event => ({ ...event, payload: clonePayload(event.payload) }))
  }
}

module.exports = {
  LOCAL_TASK_TRACE_REPLAY_SCHEMA_VERSION,
  LOCAL_TASK_TRACE_SCHEMA_VERSION,
  LocalTaskTraceError,
  appendLocalTaskTraceEvent,
  createLocalTaskTrace,
  createTraceEventId,
  normalizeLocalTaskTrace,
  replayLocalTaskTrace,
  validateLocalTaskTrace
}
