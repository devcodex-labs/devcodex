'use strict'

const crypto = require('crypto')
const {
  createCheckpointValidationSet,
  normalizeCheckpointValidationSet,
  validateCheckpointEvidence
} = require('./lifecycle-checkpoint-validation.cjs')
const {
  LocalTaskTraceError,
  appendLocalTaskTraceEvent,
  createLocalTaskTrace,
  createTraceEventId,
  normalizeLocalTaskTrace
} = require('./lifecycle-task-trace.cjs')

const DEFAULT_THRESHOLDS = Object.freeze({
  suspectAfterMs: 2 * 60 * 1000,
  stalledAfterMs: 5 * 60 * 1000,
  operationLeaseMs: 30 * 60 * 1000
})
const TERMINAL_STATES = new Set(['completed', 'error', 'interrupted'])

function nowMsFrom(options = {}) {
  return Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
}

function toIso(nowMs) {
  return new Date(nowMs).toISOString()
}

function parseTime(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function stableId(prefix, parts) {
  const digest = crypto.createHash('sha256').update(parts.map(part => String(part || '')).join('\u001f')).digest('hex')
  return `${prefix}-${digest.slice(0, 20)}`
}

function firstString(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function getTurnKey(payload) {
  return firstString(payload, [
    'session_id', 'sessionId', 'conversation_id', 'conversationId',
    'thread_id', 'threadId', 'request_id', 'requestId'
  ])
}

function getToolCallId(payload) {
  return firstString(payload, [
    'tool_use_id', 'toolUseId', 'tool_call_id', 'toolCallId', 'call_id', 'callId'
  ])
}

function collectArtifactPaths(value, keyPath = '', output = []) {
  if (output.length >= 20 || value === null || value === undefined) return output
  if (typeof value === 'string') {
    const normalizedKeyPath = keyPath.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    if (/(^|[._-])(file|path|cwd|root|directory|uri|url)(s)?($|[._-])/i.test(normalizedKeyPath) && value.trim()) {
      output.push(value.trim())
    }
    return output
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectArtifactPaths(item, `${keyPath}[${index}]`, output))
    return output
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectArtifactPaths(item, keyPath ? `${keyPath}.${key}` : key, output)
    }
  }
  return output
}

function appendStateTrace(state, input, nowMs) {
  if (!state.taskTrace) return
  try {
    state.taskTrace = appendLocalTaskTraceEvent(state.taskTrace, input, { nowMs })
    state.taskTraceLastError = null
  } catch (error) {
    if (!(error instanceof LocalTaskTraceError)) throw error
    if (error.code !== 'TRACE_DUPLICATE_EVENT') {
      state.taskTraceLastError = { errorCode: error.code, message: error.message, observedAt: toIso(nowMs) }
    }
  }
}

function traceEventPayload(payload, toolName = '') {
  return {
    toolCallId: getToolCallId(payload) || null,
    toolName: String(toolName || ''),
    artifactPaths: [...new Set(collectArtifactPaths(payload))].slice(0, 20)
  }
}

function normalizeThresholds(raw = {}) {
  const suspectAfterMs = positiveNumber(raw.suspectAfterMs, DEFAULT_THRESHOLDS.suspectAfterMs)
  const stalledAfterMs = Math.max(
    positiveNumber(raw.stalledAfterMs, DEFAULT_THRESHOLDS.stalledAfterMs),
    suspectAfterMs
  )
  return {
    suspectAfterMs,
    stalledAfterMs,
    operationLeaseMs: positiveNumber(raw.operationLeaseMs, DEFAULT_THRESHOLDS.operationLeaseMs)
  }
}

/**
 * Build the backward-compatible nested state used by lifecycle Hook adapters and
 * the read-only diagnostic sidecar. Time is injectable so state transitions do
 * not depend on sleeps in tests.
 */
function createTurnLivenessState(options = {}) {
  const nowMs = nowMsFrom(options)
  return {
    schemaVersion: 1,
    state: 'idle',
    turnKey: '',
    eventSequence: 0,
    startedAt: '',
    lastEventType: '',
    lastEventAt: '',
    lastToolCallId: '',
    lastToolOutputAt: '',
    continuationAckAt: '',
    inFlightOperation: null,
    checkpoint: {
      phase: '',
      artifactPaths: [],
      nextAction: '',
      resumeToken: '',
      idempotencyKey: ''
    },
    checkpointValidation: createCheckpointValidationSet({ nowMs }),
    taskTrace: null,
    taskTraceLastError: null,
    thresholds: normalizeThresholds(options.thresholds),
    lastRecoveryCard: null,
    lastRecoveryNoticeKey: '',
    previousTurn: null,
    initializedAt: toIso(nowMs)
  }
}

/** Normalize old or partial lifecycle state without changing its semantic state. */
function normalizeTurnLivenessState(raw, options = {}) {
  const base = createTurnLivenessState(options)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const checkpoint = raw.checkpoint && typeof raw.checkpoint === 'object' ? raw.checkpoint : {}
  const artifactPaths = Array.isArray(checkpoint.artifactPaths)
    ? [...new Set(checkpoint.artifactPaths.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))].slice(0, 20)
    : []
  const operation = raw.inFlightOperation && typeof raw.inFlightOperation === 'object'
    ? {
        operationId: String(raw.inFlightOperation.operationId || ''),
        toolName: String(raw.inFlightOperation.toolName || ''),
        startedAt: String(raw.inFlightOperation.startedAt || ''),
        leaseExpiresAt: String(raw.inFlightOperation.leaseExpiresAt || ''),
        ownedByAgent: raw.inFlightOperation.ownedByAgent === true
      }
    : null
  return {
    ...base,
    ...raw,
    schemaVersion: 1,
    eventSequence: Math.max(0, Number.parseInt(raw.eventSequence, 10) || 0),
    inFlightOperation: operation,
    checkpoint: { ...base.checkpoint, ...checkpoint, artifactPaths },
    checkpointValidation: normalizeCheckpointValidationSet(raw.checkpointValidation, options),
    taskTrace: normalizeLocalTaskTrace(raw.taskTrace, {
      nowMs: nowMsFrom(options),
      turnKey: String(raw.turnKey || ''),
      openedAt: raw.startedAt
    }),
    thresholds: normalizeThresholds(raw.thresholds),
    lastRecoveryCard: raw.lastRecoveryCard && typeof raw.lastRecoveryCard === 'object'
      ? { ...raw.lastRecoveryCard }
      : null,
    previousTurn: raw.previousTurn && typeof raw.previousTurn === 'object'
      ? { ...raw.previousTurn }
      : null
  }
}

function isTerminalState(state) {
  return TERMINAL_STATES.has(String(state || ''))
}

/** Derive current liveness without mutating or persisting the supplied state. */
function classifyTurnLiveness(raw, options = {}) {
  const state = normalizeTurnLivenessState(raw, options)
  const nowMs = nowMsFrom(options)
  if (isTerminalState(state.state) || state.state === 'idle') {
    return { state: state.state, reason: state.state, ageMs: 0, leaseActive: false }
  }

  const operation = state.inFlightOperation
  if (operation?.ownedByAgent) {
    const leaseExpiresAtMs = parseTime(operation.leaseExpiresAt)
    if (leaseExpiresAtMs > nowMs) {
      return {
        state: 'running',
        reason: 'active-operation-lease',
        ageMs: Math.max(0, nowMs - parseTime(operation.startedAt)),
        leaseActive: true
      }
    }
    const expiredForMs = Math.max(0, nowMs - leaseExpiresAtMs)
    return {
      state: expiredForMs >= state.thresholds.stalledAfterMs ? 'stalled-recoverable' : 'suspect',
      reason: 'operation-lease-expired',
      ageMs: expiredForMs,
      leaseActive: false
    }
  }

  const referenceMs = parseTime(state.lastToolOutputAt) || parseTime(state.lastEventAt) || parseTime(state.startedAt)
  if (!referenceMs) return { state: state.state || 'idle', reason: 'no-time-evidence', ageMs: 0, leaseActive: false }
  const ageMs = Math.max(0, nowMs - referenceMs)
  if (state.state !== 'awaiting-continuation') {
    const stalledRunningAfterMs = state.thresholds.operationLeaseMs + state.thresholds.stalledAfterMs
    if (ageMs >= stalledRunningAfterMs) {
      return { state: 'stalled-recoverable', reason: 'agent-turn-lease-expired', ageMs, leaseActive: false }
    }
    if (ageMs >= state.thresholds.operationLeaseMs) {
      return { state: 'suspect', reason: 'agent-turn-lease-expired', ageMs, leaseActive: false }
    }
    return { state: 'running', reason: 'agent-turn-within-lease', ageMs, leaseActive: false }
  }
  if (ageMs >= state.thresholds.stalledAfterMs) {
    return { state: 'stalled-recoverable', reason: 'continuation-timeout', ageMs, leaseActive: false }
  }
  if (ageMs >= state.thresholds.suspectAfterMs) {
    return { state: 'suspect', reason: 'continuation-grace-expired', ageMs, leaseActive: false }
  }
  return { state: 'awaiting-continuation', reason: 'within-grace', ageMs, leaseActive: false }
}

function buildTurnRecoveryCard(state, classification, options = {}) {
  const nowMs = nowMsFrom(options)
  const reference = state.lastToolOutputAt || state.lastEventAt || state.startedAt
  const noticeKey = stableId('liveness', [state.turnKey, reference, classification.state, classification.reason])
  return {
    schemaVersion: 1,
    noticeKey,
    observedAt: toIso(nowMs),
    turnKey: state.turnKey,
    priorState: classification.state,
    reason: classification.reason,
    ageMs: classification.ageMs,
    lastEventType: state.lastEventType,
    lastEventAt: state.lastEventAt,
    lastToolOutputAt: state.lastToolOutputAt,
    checkpoint: { ...state.checkpoint, artifactPaths: [...state.checkpoint.artifactPaths] },
    capabilityBoundary: 'hook-event-observation-only',
    recommendedAction: 'Resume from the recorded checkpoint through the host; never replay a mutation without validating the idempotency key.'
  }
}

/** Record an observed host event and preserve stale evidence before recovery. */
function observeTurnEvent(raw, eventName, payload = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const nowIso = toIso(nowMs)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const classificationBefore = classifyTurnLiveness(state, { nowMs })
  let recoveryCard = null
  if (classificationBefore.state === 'suspect' || classificationBefore.state === 'stalled-recoverable') {
    const candidate = buildTurnRecoveryCard(state, classificationBefore, { nowMs })
    if (candidate.noticeKey !== state.lastRecoveryNoticeKey) {
      recoveryCard = candidate
      state.lastRecoveryCard = candidate
      state.lastRecoveryNoticeKey = candidate.noticeKey
    }
  }

  const normalizedEvent = String(eventName || '').trim()
  const priorState = state.state
  const priorTurnKey = state.turnKey
  state.eventSequence += 1
  state.lastEventType = normalizedEvent || state.lastEventType
  state.lastEventAt = nowIso

  if (normalizedEvent === 'UserPromptSubmit') {
    if (priorTurnKey && !isTerminalState(priorState) && priorState !== 'idle') {
      state.previousTurn = {
        turnKey: priorTurnKey,
        terminalState: 'interrupted',
        terminalAt: nowIso,
        reason: recoveryCard ? 'stale-turn-recovered-by-new-prompt' : 'superseded-by-new-prompt'
      }
    }
    state.turnKey = getTurnKey(payload) || stableId('turn', [priorTurnKey, nowIso, state.eventSequence])
    state.startedAt = nowIso
    state.state = 'running'
    state.lastToolCallId = ''
    state.lastToolOutputAt = ''
    state.continuationAckAt = ''
    state.inFlightOperation = null
    state.checkpoint = { ...createTurnLivenessState({ nowMs }).checkpoint }
    state.checkpointValidation = createCheckpointValidationSet({ nowMs })
    state.checkpointValidation.postExecution = validateCheckpointEvidence({
      mode: 'post-execution',
      deadlineAt: toIso(nowMs + state.thresholds.operationLeaseMs + state.thresholds.stalledAfterMs)
    }, { nowMs })
    state.taskTrace = createLocalTaskTrace({ turnKey: state.turnKey, openedAt: nowIso, nowMs })
    state.taskTraceLastError = null
  } else {
    if (normalizedEvent !== 'PostToolUse' && state.lastToolOutputAt && !state.continuationAckAt) {
      state.continuationAckAt = nowIso
    }
    if (normalizedEvent === 'PreToolUse' && !isTerminalState(state.state)) state.state = 'running'
    if (normalizedEvent === 'PreCompact' && !isTerminalState(state.state)) {
      state.state = 'running'
      state.checkpoint.phase = 'pre-compact'
      state.checkpoint.nextAction = state.checkpoint.nextAction || 'rehydrate context and continue'
    }
  }

  state.checkpointValidation.responseTime = validateCheckpointEvidence({
    mode: 'response-time',
    evidence: [{ type: 'host-event', eventName: normalizedEvent, observedAt: nowIso }]
  }, { nowMs })
  if (state.taskTrace) {
    const toolCallId = getToolCallId(payload)
    appendStateTrace(state, {
      eventId: createTraceEventId(state.taskTrace, ['host', normalizedEvent, toolCallId || state.eventSequence]),
      observedAt: nowIso,
      type: normalizedEvent || 'UnknownHostEvent',
      result: 'observed',
      payload: traceEventPayload(payload)
    }, nowMs)
  }

  return { state, classificationBefore, recoveryCard }
}

/** Start an AI-owned operation lease only after the Hook has allowed the tool. */
function startToolLease(raw, payload = {}, toolName = '', options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const operationId = getToolCallId(payload) || stableId('tool', [state.turnKey, state.eventSequence, toolName])
  const artifactPaths = [...new Set([...state.checkpoint.artifactPaths, ...collectArtifactPaths(payload)])].slice(0, 20)
  state.state = 'running'
  state.lastToolCallId = operationId
  state.inFlightOperation = {
    operationId,
    toolName: String(toolName || ''),
    startedAt: toIso(nowMs),
    leaseExpiresAt: toIso(nowMs + state.thresholds.operationLeaseMs),
    ownedByAgent: true
  }
  state.checkpoint = {
    ...state.checkpoint,
    phase: `tool:${String(toolName || 'unknown')}`,
    artifactPaths,
    nextAction: 'await PostToolUse',
    resumeToken: stableId('resume', [state.turnKey, operationId]),
    idempotencyKey: stableId('idem', [state.turnKey, operationId])
  }
  appendStateTrace(state, {
    eventId: createTraceEventId(state.taskTrace, ['lease-start', operationId]),
    type: 'ToolLeaseStarted',
    result: 'allowed',
    payload: traceEventPayload(payload, toolName)
  }, nowMs)
  return state
}

/** Complete a tool lease; a tool result is not a turn terminal state. */
function completeToolLease(raw, payload = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const operationId = getToolCallId(payload) || state.inFlightOperation?.operationId || state.lastToolCallId
  const duplicate = !!(
    operationId && operationId === state.lastToolCallId && state.lastToolOutputAt && !state.inFlightOperation
  )
  if (!duplicate) state.lastToolOutputAt = toIso(nowMs)
  state.lastToolCallId = operationId || state.lastToolCallId
  state.inFlightOperation = null
  state.continuationAckAt = ''
  state.state = 'awaiting-continuation'
  const toolFailed = payload.success === false || payload.is_error === true || payload.isError === true || !!payload.error
  state.checkpoint = {
    ...state.checkpoint,
    phase: toolFailed ? 'tool-error-observed' : 'tool-output-persisted',
    artifactPaths: [...new Set([...state.checkpoint.artifactPaths, ...collectArtifactPaths(payload)])].slice(0, 20),
    nextAction: toolFailed ? 'inspect tool error and continue safely' : 'await continuation ACK',
    resumeToken: state.checkpoint.resumeToken || stableId('resume', [state.turnKey, operationId]),
    idempotencyKey: state.checkpoint.idempotencyKey || stableId('idem', [state.turnKey, operationId])
  }
  if (!duplicate) {
    appendStateTrace(state, {
      eventId: createTraceEventId(state.taskTrace, ['lease-complete', operationId]),
      type: 'ToolLeaseCompleted',
      result: toolFailed ? 'error' : 'success',
      payload: traceEventPayload(payload)
    }, nowMs)
  }
  return state
}

/** Persist an explicit turn terminal and release every AI-owned operation lease. */
function markTurnTerminal(raw, terminalState = 'completed', reason = '', options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const normalizedTerminal = TERMINAL_STATES.has(terminalState) ? terminalState : 'error'
  state.state = normalizedTerminal
  state.inFlightOperation = null
  state.lastEventAt = state.lastEventAt || toIso(nowMs)
  state.previousTurn = {
    turnKey: state.turnKey,
    terminalState: normalizedTerminal,
    terminalAt: toIso(nowMs),
    reason: String(reason || normalizedTerminal)
  }
  state.checkpoint = {
    ...state.checkpoint,
    phase: `terminal:${normalizedTerminal}`,
    nextAction: ''
  }
  state.checkpointValidation.postExecution = validateCheckpointEvidence({
    mode: 'post-execution',
    evidence: [{ type: 'host-terminal-event', terminalState: normalizedTerminal, reason: String(reason || normalizedTerminal) }]
  }, { nowMs })
  const traceTerminal = normalizedTerminal === 'completed' ? 'complete' : (normalizedTerminal === 'error' ? 'failed' : 'interrupted')
  appendStateTrace(state, {
    eventId: createTraceEventId(state.taskTrace, ['terminal', traceTerminal]),
    type: 'TurnTerminal',
    terminalStatus: traceTerminal,
    payload: { reason: String(reason || normalizedTerminal) }
  }, nowMs)
  return state
}

function formatTurnRecoveryMessage(card) {
  if (!card) return ''
  return `[DevCodex TurnRecoveryCard ${card.noticeKey}] priorState=${card.priorState}; reason=${card.reason}; ` +
    `resumeToken=${card.checkpoint.resumeToken || 'none'}; capability=${card.capabilityBoundary}. ${card.recommendedAction}`
}

module.exports = {
  DEFAULT_THRESHOLDS,
  buildTurnRecoveryCard,
  classifyTurnLiveness,
  completeToolLease,
  createTurnLivenessState,
  formatTurnRecoveryMessage,
  isTerminalState,
  markTurnTerminal,
  normalizeTurnLivenessState,
  observeTurnEvent,
  startToolLease
}
