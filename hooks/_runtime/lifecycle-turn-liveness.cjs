'use strict'

const path = require('path')
const { extractMutationFootprint, MAX_TARGETS } = require('./mutation-footprint.cjs')

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
const EXECUTION_ATTEMPT_LEDGER_SCHEMA = 'ExecutionAttemptLedgerV1'
const EXECUTION_ATTEMPT_TERMINALS = new Set(['completed', 'error', 'aborted', 'cancelled', 'stopped'])
const TASK_OPERATION_RECORD_SCHEMA = 'TaskOperationRecordV1'
const TASK_OPERATION_SET_SCHEMA = 'TaskOperationSetV1'
const TASK_OPERATION_PHASES = new Set([
  'prepared', 'dispatched', 'observed', 'settled', 'reconcile-required',
  'aborted-zero-effect', 'terminal-observed'
])
const TASK_OPERATION_EFFECTS = new Set(['none', 'known-not-applied', 'known-applied', 'unknown'])

class ExecutionAttemptLedgerError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ExecutionAttemptLedgerError'
    this.code = code
  }
}

class TaskOperationRecordError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'TaskOperationRecordError'
    this.code = code
    this.details = details
  }
}

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

function stableValueDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalizedOperationTargets(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort()
}

function comparableOperationTarget(value) {
  const normalized = path.normalize(String(value || ''))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function taskOperationTargetSetDigest(values) {
  return stableValueDigest(normalizedOperationTargets(values).map(comparableOperationTarget))
}

function taskOperationRecordDigest(value = {}) {
  const semantic = { ...value }
  delete semantic.recordDigest
  return stableValueDigest(semantic)
}

function sealTaskOperationRecord(value = {}) {
  const semantic = {
    schemaVersion: TASK_OPERATION_RECORD_SCHEMA,
    operationId: String(value.operationId || ''),
    idempotencyKey: String(value.idempotencyKey || ''),
    writerGeneration: Number.isSafeInteger(value.writerGeneration) && value.writerGeneration >= 0
      ? value.writerGeneration
      : 0,
    expectedStateSequence: Number.isSafeInteger(value.expectedStateSequence) && value.expectedStateSequence >= 0
      ? value.expectedStateSequence
      : 0,
    kind: String(value.kind || 'mutation'),
    exactTargets: normalizedOperationTargets(value.exactTargets),
    targetSetDigest: String(value.targetSetDigest || ''),
    beforeDigest: value.beforeDigest === null || value.beforeDigest === undefined
      ? null
      : String(value.beforeDigest),
    phase: TASK_OPERATION_PHASES.has(value.phase) ? value.phase : 'prepared',
    effect: TASK_OPERATION_EFFECTS.has(value.effect) ? value.effect : 'none',
    preparedAt: String(value.preparedAt || ''),
    dispatchedAt: value.dispatchedAt ? String(value.dispatchedAt) : null,
    observedAt: value.observedAt ? String(value.observedAt) : null,
    settledAt: value.settledAt ? String(value.settledAt) : null,
    resultDigest: value.resultDigest ? String(value.resultDigest) : null,
    evidenceDigest: value.evidenceDigest ? String(value.evidenceDigest) : null
  }
  if (!semantic.targetSetDigest) semantic.targetSetDigest = taskOperationTargetSetDigest(semantic.exactTargets)
  return { ...semantic, recordDigest: stableValueDigest(semantic) }
}

function validateTaskOperationRecord(value) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schemaVersion !== TASK_OPERATION_RECORD_SCHEMA) {
    return { valid: false, errors: ['task-operation-record-required'] }
  }
  if (!String(value.operationId || '').trim() || !String(value.idempotencyKey || '').trim()) {
    errors.push('task-operation-identity')
  }
  if (!Number.isSafeInteger(value.writerGeneration) || value.writerGeneration < 0 ||
      !Number.isSafeInteger(value.expectedStateSequence) || value.expectedStateSequence < 0) {
    errors.push('task-operation-fence')
  }
  if (!TASK_OPERATION_PHASES.has(value.phase) || !TASK_OPERATION_EFFECTS.has(value.effect)) {
    errors.push('task-operation-phase-effect')
  }
  const targets = normalizedOperationTargets(value.exactTargets)
  const targetDigestMatches = [
    taskOperationTargetSetDigest(targets),
    stableValueDigest(targets) // V1 records written before comparable-path digest binding.
  ].includes(value.targetSetDigest)
  if (!targets.length || targets.length > MAX_TARGETS ||
      JSON.stringify(targets) !== JSON.stringify(value.exactTargets) ||
      !/^[a-f0-9]{64}$/.test(String(value.targetSetDigest || '')) ||
      !targetDigestMatches) {
    errors.push('task-operation-targets')
  }
  if (value.beforeDigest !== null && !/^[a-f0-9]{64}$/.test(String(value.beforeDigest || ''))) {
    errors.push('task-operation-before-digest')
  }
  for (const field of ['preparedAt']) {
    if (!Number.isFinite(Date.parse(String(value[field] || '')))) errors.push(`task-operation-${field}`)
  }
  for (const field of ['dispatchedAt', 'observedAt', 'settledAt']) {
    if (value[field] !== null && !Number.isFinite(Date.parse(String(value[field] || '')))) {
      errors.push(`task-operation-${field}`)
    }
  }
  for (const field of ['resultDigest', 'evidenceDigest']) {
    if (value[field] !== null && !/^[a-f0-9]{64}$/.test(String(value[field] || ''))) {
      errors.push(`task-operation-${field}`)
    }
  }
  if (value.phase === 'prepared' && (value.dispatchedAt !== null || value.effect !== 'none')) {
    errors.push('task-operation-prepared-shape')
  }
  if (['dispatched', 'observed', 'reconcile-required', 'settled', 'terminal-observed'].includes(value.phase) &&
      value.dispatchedAt === null) errors.push('task-operation-dispatch-required')
  if (['observed', 'reconcile-required', 'settled', 'terminal-observed'].includes(value.phase) &&
      value.observedAt === null) errors.push('task-operation-observation-required')
  if (['settled', 'aborted-zero-effect'].includes(value.phase) && value.settledAt === null) {
    errors.push('task-operation-settle-required')
  }
  if (value.phase === 'reconcile-required' && value.effect !== 'unknown') {
    errors.push('task-operation-reconcile-effect')
  }
  if (value.phase === 'aborted-zero-effect' && value.effect !== 'none') {
    errors.push('task-operation-abort-effect')
  }
  if (!/^[a-f0-9]{64}$/.test(String(value.recordDigest || '')) ||
      taskOperationRecordDigest(value) !== value.recordDigest) errors.push('task-operation-record-digest')
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function taskOperationRef(record) {
  return {
    operationId: record.operationId,
    writerGeneration: record.writerGeneration,
    phase: record.phase,
    effect: record.effect,
    recordDigest: record.recordDigest,
    settledAt: record.settledAt
  }
}

function taskOperationSettledSetDigest(settled = []) {
  return stableValueDigest({ schemaVersion: TASK_OPERATION_SET_SCHEMA, settled })
}

function createTaskOperationSet() {
  const settled = []
  return {
    schemaVersion: TASK_OPERATION_SET_SCHEMA,
    unresolved: null,
    settled,
    settledSetDigest: taskOperationSettledSetDigest(settled)
  }
}

function normalizeTaskOperationSet(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createTaskOperationSet()
  const settled = Array.isArray(raw.settled)
    ? raw.settled.filter(item => item && typeof item === 'object').map(item => ({ ...item })).slice(-64)
    : []
  return {
    schemaVersion: TASK_OPERATION_SET_SCHEMA,
    unresolved: raw.unresolved && typeof raw.unresolved === 'object'
      ? JSON.parse(JSON.stringify(raw.unresolved))
      : null,
    settled,
    settledSetDigest: String(raw.settledSetDigest || taskOperationSettledSetDigest(settled))
  }
}

function validateTaskOperationSet(raw) {
  const set = normalizeTaskOperationSet(raw)
  const errors = []
  if (raw && raw.schemaVersion !== TASK_OPERATION_SET_SCHEMA) errors.push('task-operation-set-schema')
  if (set.unresolved) {
    const validation = validateTaskOperationRecord(set.unresolved)
    if (!validation.valid || ['settled', 'aborted-zero-effect'].includes(set.unresolved.phase)) {
      errors.push('task-operation-unresolved-invalid', ...validation.errors)
    }
  }
  const seen = new Set()
  for (const item of set.settled) {
    if (!item || typeof item !== 'object' || !String(item.operationId || '').trim() ||
        !Number.isSafeInteger(item.writerGeneration) || item.writerGeneration < 0 ||
        !['settled', 'aborted-zero-effect'].includes(item.phase) ||
        !TASK_OPERATION_EFFECTS.has(item.effect) ||
        !/^[a-f0-9]{64}$/.test(String(item.recordDigest || '')) ||
        !Number.isFinite(Date.parse(String(item.settledAt || '')))) {
      errors.push('task-operation-settled-ref-invalid')
    }
    if (seen.has(item.operationId)) errors.push('task-operation-settled-ref-duplicate')
    seen.add(item.operationId)
  }
  if (set.unresolved && seen.has(set.unresolved.operationId)) {
    errors.push('task-operation-cross-history-duplicate')
  }
  if (set.settledSetDigest !== taskOperationSettledSetDigest(set.settled)) {
    errors.push('task-operation-set-digest')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], set }
}

function replaceUnresolvedTaskOperation(state, record) {
  const set = normalizeTaskOperationSet(state.taskOperationSet)
  set.unresolved = record
  set.settledSetDigest = taskOperationSettledSetDigest(set.settled)
  state.taskOperationSet = set
  if (state.inFlightOperation?.operationId === record.operationId) {
    state.inFlightOperation.operationRecord = record
  }
  return state
}

function prepareTaskOperationRecord(raw, input = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const setValidation = validateTaskOperationSet(state.taskOperationSet)
  if (!setValidation.valid) {
    throw new TaskOperationRecordError('TASK_OPERATION_SET_INVALID', 'task operation set failed integrity validation', setValidation)
  }
  if (setValidation.set.unresolved && setValidation.set.unresolved.operationId !== input.operationId) {
    throw new TaskOperationRecordError('TASK_OPERATION_IN_FLIGHT', 'another mutating task operation is unresolved')
  }
  const existing = setValidation.set.unresolved
  if (existing?.operationId === input.operationId) {
    const existingValidation = validateTaskOperationRecord(existing)
    const replay = sealTaskOperationRecord({
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey || stableId('idem', [state.turnKey, input.operationId]),
      writerGeneration: input.writerGeneration,
      expectedStateSequence: input.expectedStateSequence,
      kind: input.kind || 'mutation',
      exactTargets: input.exactTargets,
      targetSetDigest: input.targetSetDigest,
      beforeDigest: input.beforeDigest ?? null,
      phase: 'prepared',
      effect: 'none',
      preparedAt: existing.preparedAt
    })
    if (existingValidation.valid && existing.phase === 'prepared' && replay.recordDigest === existing.recordDigest) {
      return replaceUnresolvedTaskOperation(state, existing)
    }
    throw new TaskOperationRecordError('TASK_OPERATION_REPLAY_MISMATCH', 'operation replay does not match one prepared record')
  }
  if (setValidation.set.settled.some(item => item.operationId === input.operationId)) {
    throw new TaskOperationRecordError(
      'TASK_OPERATION_ALREADY_SETTLED',
      'a settled task operation identity cannot be prepared again'
    )
  }
  const record = sealTaskOperationRecord({
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey || stableId('idem', [state.turnKey, input.operationId]),
    writerGeneration: input.writerGeneration,
    expectedStateSequence: input.expectedStateSequence,
    kind: input.kind || 'mutation',
    exactTargets: input.exactTargets,
    targetSetDigest: input.targetSetDigest,
    beforeDigest: input.beforeDigest ?? null,
    phase: 'prepared',
    effect: 'none',
    preparedAt: toIso(nowMs)
  })
  const validation = validateTaskOperationRecord(record)
  if (!validation.valid) {
    throw new TaskOperationRecordError('TASK_OPERATION_PREPARE_INVALID', 'prepared task operation is invalid', validation)
  }
  return replaceUnresolvedTaskOperation(state, record)
}

function transitionTaskOperation(raw, operationId, phase, values = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const setValidation = validateTaskOperationSet(state.taskOperationSet)
  const current = setValidation.set.unresolved
  if (!setValidation.valid || !current || current.operationId !== operationId) {
    throw new TaskOperationRecordError('TASK_OPERATION_CAS_MISMATCH', 'the exact unresolved task operation is unavailable', setValidation)
  }
  const next = sealTaskOperationRecord({ ...current, ...values, phase })
  const validation = validateTaskOperationRecord(next)
  if (!validation.valid) {
    throw new TaskOperationRecordError('TASK_OPERATION_TRANSITION_INVALID', `task operation cannot transition to ${phase}`, validation)
  }
  return replaceUnresolvedTaskOperation(state, next)
}

function markTaskOperationDispatched(raw, operationId, options = {}) {
  const nowMs = nowMsFrom(options)
  return transitionTaskOperation(raw, operationId, 'dispatched', {
    dispatchedAt: toIso(nowMs),
    effect: 'unknown'
  }, { ...options, nowMs })
}

function markTaskOperationObserved(raw, operationId, values = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const current = normalizeTaskOperationSet(state.taskOperationSet).unresolved
  return transitionTaskOperation(state, operationId, 'observed', {
    dispatchedAt: current?.dispatchedAt || toIso(nowMs),
    observedAt: toIso(nowMs),
    effect: 'unknown',
    resultDigest: values.resultDigest || null,
    evidenceDigest: values.evidenceDigest || null
  }, { ...options, nowMs })
}

function settleTaskOperationRecord(raw, operationId, values = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const setValidation = validateTaskOperationSet(state.taskOperationSet)
  const current = setValidation.set.unresolved
  if (!setValidation.valid || !current || current.operationId !== operationId) {
    throw new TaskOperationRecordError('TASK_OPERATION_CAS_MISMATCH', 'the exact observed task operation is unavailable', setValidation)
  }
  const needsReconcile = values.needsReconcile === true
  const phase = needsReconcile ? 'reconcile-required' : 'settled'
  const effect = needsReconcile
    ? 'unknown'
    : (['known-applied', 'known-not-applied', 'none'].includes(values.effect) ? values.effect : 'known-not-applied')
  const record = sealTaskOperationRecord({
    ...current,
    phase,
    effect,
    observedAt: current.observedAt || toIso(nowMs),
    settledAt: needsReconcile ? null : toIso(nowMs),
    resultDigest: values.resultDigest || current.resultDigest,
    evidenceDigest: values.evidenceDigest || current.evidenceDigest
  })
  const validation = validateTaskOperationRecord(record)
  if (!validation.valid) {
    throw new TaskOperationRecordError('TASK_OPERATION_SETTLEMENT_INVALID', 'task operation settlement is invalid', validation)
  }
  const set = setValidation.set
  state.lastTaskOperationRecord = record
  if (needsReconcile) {
    set.unresolved = record
  } else {
    const prior = set.settled.find(item => item.operationId === record.operationId)
    const ref = taskOperationRef(record)
    if (prior && prior.recordDigest !== ref.recordDigest) {
      throw new TaskOperationRecordError('TASK_OPERATION_SETTLEMENT_REPLAY_MISMATCH', 'settled operation replay changed its result')
    }
    if (!prior) set.settled = [...set.settled, ref].slice(-64)
    set.unresolved = null
  }
  set.settledSetDigest = taskOperationSettledSetDigest(set.settled)
  state.taskOperationSet = set
  return state
}

function reconcileTaskOperationRecord(raw, operationId, values = {}, options = {}) {
  const state = normalizeTurnLivenessState(raw, options)
  const current = normalizeTaskOperationSet(state.taskOperationSet).unresolved
  if (!current || current.operationId !== operationId || current.phase !== 'reconcile-required') {
    throw new TaskOperationRecordError('TASK_OPERATION_RECONCILE_CAS_MISMATCH', 'only the exact reconcile-required operation can settle')
  }
  return settleTaskOperationRecord(state, operationId, {
    needsReconcile: false,
    effect: values.effect,
    resultDigest: values.resultDigest,
    evidenceDigest: values.evidenceDigest
  }, options)
}

function abortPreparedTaskOperation(raw, operationId, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const setValidation = validateTaskOperationSet(state.taskOperationSet)
  const current = setValidation.set.unresolved
  if (!setValidation.valid || !current || current.operationId !== operationId || current.phase !== 'prepared') {
    throw new TaskOperationRecordError('TASK_OPERATION_ABORT_INVALID', 'only an exact un-dispatched prepared operation can abort with zero effect')
  }
  const record = sealTaskOperationRecord({
    ...current,
    phase: 'aborted-zero-effect',
    effect: 'none',
    settledAt: toIso(nowMs)
  })
  const set = setValidation.set
  set.unresolved = null
  set.settled = [...set.settled, taskOperationRef(record)].slice(-64)
  set.settledSetDigest = taskOperationSettledSetDigest(set.settled)
  state.taskOperationSet = set
  state.lastTaskOperationRecord = record
  if (state.inFlightOperation?.operationId === operationId) state.inFlightOperation = null
  return state
}

function taskOperationTerminalSnapshot(raw) {
  const state = raw && typeof raw === 'object' ? raw : {}
  const validation = validateTaskOperationSet(state.taskOperationSet)
  const legacyInFlight = state.inFlightOperation?.mutating === true &&
    !validation.set.unresolved
  const legacyReconcile = state.lastMutationCloseout?.result === 'needs-reconcile' &&
    !validation.set.unresolved
  return {
    schemaVersion: 'TaskOperationTerminalSnapshotV1',
    valid: validation.valid,
    errors: validation.errors,
    unresolvedOperationId: validation.set.unresolved?.operationId ||
      (legacyInFlight ? state.inFlightOperation.operationId || 'legacy-in-flight' :
        (legacyReconcile ? state.lastMutationCloseout.operationId || 'legacy-reconcile' : null)),
    unresolvedPhase: validation.set.unresolved?.phase ||
      (legacyInFlight ? 'legacy-in-flight' : (legacyReconcile ? 'reconcile-required' : null)),
    settledCount: validation.set.settled.length,
    settledSetDigest: validation.set.settledSetDigest,
    terminalReady: validation.valid && !validation.set.unresolved && !legacyInFlight && !legacyReconcile
  }
}

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function createExecutionAttemptLedger() {
  return {
    schemaVersion: EXECUTION_ATTEMPT_LEDGER_SCHEMA,
    entries: [],
    stopSnapshot: null,
    terminal: null,
    duplicateEvents: 0
  }
}

function normalizeExecutionAttemptLedger(raw) {
  const base = createExecutionAttemptLedger()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  return {
    schemaVersion: EXECUTION_ATTEMPT_LEDGER_SCHEMA,
    entries: Array.isArray(raw.entries) ? raw.entries.filter(item => item && typeof item === 'object').map(item => ({ ...item })).slice(-100) : [],
    stopSnapshot: raw.stopSnapshot && typeof raw.stopSnapshot === 'object' ? { ...raw.stopSnapshot } : null,
    terminal: raw.terminal && typeof raw.terminal === 'object' ? { ...raw.terminal } : null,
    duplicateEvents: Math.max(0, Number.parseInt(raw.duplicateEvents, 10) || 0)
  }
}

function attemptKey(value = {}) {
  return [String(value.candidateId || ''), String(value.phase || ''), String(value.commandSignature || value.command || '')].join('\u001f')
}

function attemptSemanticId(value = {}) {
  return stableId('attempt-event', [
    value.eventId, value.kind, value.candidateId, value.phase, value.commandSignature || value.command,
    value.result, value.failureSignature, value.sourceDelta, value.evidenceDelta,
    value.commandWallMs, value.externalWaitMs, value.waitingUserMs, value.modelReasoningMs
  ])
}

function noProgressFailureStreak(entries, key, failureSignature) {
  let streak = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.kind !== 'formal') continue
    if (entry.attemptKey !== key || entry.result !== 'failed' || entry.failureSignature !== failureSignature || entry.sourceDelta !== 0 || entry.evidenceDelta !== 0) break
    streak += 1
  }
  return streak
}

function evaluateExecutionAttempt(raw, attempt = {}) {
  const ledger = normalizeExecutionAttemptLedger(raw?.executionAttemptLedger || raw)
  const key = attemptKey(attempt)
  const failureSignature = String(attempt.failureSignature || '')
  const stopped = ledger.stopSnapshot && ledger.stopSnapshot.attemptKey === key
  const streak = failureSignature ? noProgressFailureStreak(ledger.entries, key, failureSignature) : 0
  return {
    schemaVersion: 'ExecutionAttemptDecisionV1',
    allowed: !ledger.terminal && !isTerminalState(raw?.state) && !stopped && streak < 2,
    decision: (ledger.terminal || isTerminalState(raw?.state)) ? 'terminal' : ((stopped || streak >= 2) ? 'stop-before-third' : 'allow'),
    noProgressFailureStreak: streak,
    stopSnapshot: ledger.stopSnapshot
  }
}

/** Record qualification/formal evidence inside the existing TurnLiveness state. */
function recordExecutionAttempt(raw, attempt = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const ledger = normalizeExecutionAttemptLedger(state.executionAttemptLedger)
  const kind = attempt.kind === 'qualification' ? 'qualification' : 'formal'
  const candidateId = String(attempt.candidateId || '').trim()
  const phase = String(attempt.phase || '').trim()
  const commandSignature = String(attempt.commandSignature || attempt.command || '').trim()
  if (!candidateId || !phase || !commandSignature) {
    throw new ExecutionAttemptLedgerError('ATTEMPT_IDENTITY_REQUIRED', 'candidateId, phase and commandSignature are required')
  }
  const eventId = String(attempt.eventId || stableId('attempt', [state.turnKey, candidateId, phase, commandSignature, ledger.entries.length + 1])).trim()
  const semanticId = attemptSemanticId({ ...attempt, eventId, kind, candidateId, phase, commandSignature })
  const duplicate = ledger.entries.find(entry => entry.eventId === eventId)
  if (duplicate) {
    if (duplicate.semanticId !== semanticId) throw new ExecutionAttemptLedgerError('ATTEMPT_DUPLICATE_CONFLICT', `conflicting duplicate attempt event: ${eventId}`)
    ledger.duplicateEvents += 1
    state.executionAttemptLedger = ledger
    return { state, decision: { schemaVersion: 'ExecutionAttemptDecisionV1', allowed: false, decision: 'duplicate-ignored', eventId } }
  }
  if (ledger.terminal || isTerminalState(state.state)) {
    return { state, decision: { schemaVersion: 'ExecutionAttemptDecisionV1', allowed: false, decision: 'terminal' } }
  }

  const key = attemptKey({ candidateId, phase, commandSignature })
  const result = ['passed', 'failed', 'inconclusive', 'cancelled', 'aborted'].includes(attempt.result) ? attempt.result : 'inconclusive'
  if (kind === 'formal') {
    const currentDecision = evaluateExecutionAttempt(ledger, { candidateId, phase, commandSignature, failureSignature: attempt.failureSignature })
    if (!currentDecision.allowed) {
      state.executionAttemptLedger = ledger
      return { state, decision: currentDecision }
    }
    if (attempt.qualificationAvailable === true) {
      const qualification = [...ledger.entries].reverse().find(entry => entry.kind === 'qualification' && entry.attemptKey === key)
      if (!qualification || qualification.result !== 'passed') {
        state.executionAttemptLedger = ledger
        return {
          state,
          decision: { schemaVersion: 'ExecutionAttemptDecisionV1', allowed: false, decision: 'qualification-required', attemptKey: key }
        }
      }
    }
  }
  const attemptNo = ledger.entries.filter(entry => entry.kind === kind && entry.attemptKey === key).length + 1
  const entry = {
    schemaVersion: 'ExecutionAttemptEntryV1',
    eventId,
    semanticId,
    observedAt: toIso(nowMs),
    turnKey: state.turnKey,
    kind,
    candidateId,
    phase,
    commandSignature,
    attemptKey: key,
    attemptNo,
    qualificationEvidence: normalizeStringListForLedger(attempt.qualificationEvidence),
    result,
    failureSignature: result === 'failed' ? String(attempt.failureSignature || 'unknown-failure') : '',
    sourceDelta: nonNegativeNumber(attempt.sourceDelta),
    evidenceDelta: nonNegativeNumber(attempt.evidenceDelta),
    firstPassYield: kind === 'formal' && attemptNo === 1 && result === 'passed' ? 1 : 0,
    commandWallMs: nonNegativeNumber(attempt.commandWallMs),
    externalWaitMs: nonNegativeNumber(attempt.externalWaitMs),
    waitingUserMs: nonNegativeNumber(attempt.waitingUserMs),
    modelReasoningMs: nonNegativeNumber(attempt.modelReasoningMs),
    terminal: ['cancelled', 'aborted'].includes(result) ? result : null
  }
  ledger.entries.push(entry)
  ledger.entries = ledger.entries.slice(-100)
  let decision = { schemaVersion: 'ExecutionAttemptDecisionV1', allowed: true, decision: 'recorded', attemptNo }
  if (kind === 'formal' && result === 'failed') {
    const streak = noProgressFailureStreak(ledger.entries, key, entry.failureSignature)
    if (streak >= 2) {
      ledger.stopSnapshot = {
        schemaVersion: 'StopSnapshotV1',
        reason: 'repeated-formal-failure-zero-delta',
        observedAt: entry.observedAt,
        candidateId,
        phase,
        commandSignature,
        attemptKey: key,
        failureSignature: entry.failureSignature,
        consecutiveAttempts: streak,
        sourceDelta: 0,
        evidenceDelta: 0,
        nextAction: 'stop new mutation before the third formal run; inspect or request a new authorized cycle'
      }
      state.checkpoint = {
        ...state.checkpoint,
        phase: 'execution-stop-required',
        nextAction: ledger.stopSnapshot.nextAction
      }
      decision = { schemaVersion: 'ExecutionAttemptDecisionV1', allowed: false, decision: 'stop-before-third', attemptNo, stopSnapshot: ledger.stopSnapshot }
    }
  }
  state.executionAttemptLedger = ledger
  return { state, decision, entry }
}

function normalizeStringListForLedger(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 20)
}

function finalizeExecutionAttemptLedger(raw, terminalState, evidence = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  const ledger = normalizeExecutionAttemptLedger(state.executionAttemptLedger)
  if (ledger.terminal || isTerminalState(state.state)) return state
  const status = EXECUTION_ATTEMPT_TERMINALS.has(terminalState) ? terminalState : 'error'
  ledger.terminal = {
    status,
    observedAt: toIso(nowMs),
    reason: String(evidence.reason || status),
    cancelFinalizer: ['cancelled', 'aborted'].includes(status)
      ? {
          status: evidence.cancelFinalizerStatus || 'unverified',
          serviceLifecycleCleanup: evidence.serviceLifecycleCleanup || 'unverified'
        }
      : null
  }
  state.executionAttemptLedger = ledger
  state.inFlightOperation = null
  if (['cancelled', 'aborted'].includes(status)) {
    state.state = 'interrupted'
    state.previousTurn = {
      turnKey: state.turnKey,
      terminalState: status,
      terminalAt: ledger.terminal.observedAt,
      reason: ledger.terminal.reason
    }
    state.checkpoint = { ...state.checkpoint, phase: `terminal:${status}`, nextAction: '' }
  }
  return state
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

function collectArtifactPaths(payload) {
  const footprint = extractMutationFootprint(payload, { cwd: process.cwd() })
  const raw = footprint.parseEvidence.map(item => item.raw).filter(Boolean)
  return [...new Set(raw.length ? raw : footprint.normalizedTargets)].slice(0, 20)
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
    taskOperationSet: createTaskOperationSet(),
    lastTaskOperationRecord: null,
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
    executionAttemptLedger: createExecutionAttemptLedger(),
    previousExecutionAttemptLedger: null,
    workflowTaskTerminal: null,
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
        ownedByAgent: raw.inFlightOperation.ownedByAgent === true,
        mutating: raw.inFlightOperation.mutating === true,
        targetPaths: Array.isArray(raw.inFlightOperation.targetPaths)
          ? raw.inFlightOperation.targetPaths.slice(0, 20).map(String)
          : [],
        artifactDecision: raw.inFlightOperation.artifactDecision && typeof raw.inFlightOperation.artifactDecision === 'object'
          ? JSON.parse(JSON.stringify(raw.inFlightOperation.artifactDecision))
          : null,
        mutationLease: raw.inFlightOperation.mutationLease && typeof raw.inFlightOperation.mutationLease === 'object'
          ? JSON.parse(JSON.stringify(raw.inFlightOperation.mutationLease))
          : null,
        mutationFootprint: raw.inFlightOperation.mutationFootprint && typeof raw.inFlightOperation.mutationFootprint === 'object'
          ? JSON.parse(JSON.stringify(raw.inFlightOperation.mutationFootprint))
          : null,
        mutationPreObservation: raw.inFlightOperation.mutationPreObservation && typeof raw.inFlightOperation.mutationPreObservation === 'object'
          ? JSON.parse(JSON.stringify(raw.inFlightOperation.mutationPreObservation))
          : null,
        operationRecord: raw.inFlightOperation.operationRecord && typeof raw.inFlightOperation.operationRecord === 'object'
          ? JSON.parse(JSON.stringify(raw.inFlightOperation.operationRecord))
          : null
      }
    : null
  return {
    ...base,
    ...raw,
    schemaVersion: 1,
    eventSequence: Math.max(0, Number.parseInt(raw.eventSequence, 10) || 0),
    inFlightOperation: operation,
    taskOperationSet: normalizeTaskOperationSet(raw.taskOperationSet),
    lastTaskOperationRecord: raw.lastTaskOperationRecord && typeof raw.lastTaskOperationRecord === 'object'
      ? JSON.parse(JSON.stringify(raw.lastTaskOperationRecord))
      : null,
    checkpoint: { ...base.checkpoint, ...checkpoint, artifactPaths },
    checkpointValidation: normalizeCheckpointValidationSet(raw.checkpointValidation, options),
    taskTrace: normalizeLocalTaskTrace(raw.taskTrace, {
      nowMs: nowMsFrom(options),
      turnKey: String(raw.turnKey || ''),
      openedAt: raw.startedAt
    }),
    executionAttemptLedger: normalizeExecutionAttemptLedger(raw.executionAttemptLedger),
    previousExecutionAttemptLedger: raw.previousExecutionAttemptLedger && typeof raw.previousExecutionAttemptLedger === 'object'
      ? normalizeExecutionAttemptLedger(raw.previousExecutionAttemptLedger)
      : null,
    workflowTaskTerminal: raw.workflowTaskTerminal && typeof raw.workflowTaskTerminal === 'object'
      ? { ...raw.workflowTaskTerminal }
      : null,
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
    if (state.executionAttemptLedger.terminal) {
      state.previousExecutionAttemptLedger = normalizeExecutionAttemptLedger(state.executionAttemptLedger)
      state.executionAttemptLedger = createExecutionAttemptLedger()
    }
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
  const observedPaths = Array.isArray(options.targetPaths) ? options.targetPaths : collectArtifactPaths(payload)
  const artifactPaths = [...new Set([...state.checkpoint.artifactPaths, ...observedPaths])].slice(0, 20)
  state.state = 'running'
  state.lastToolCallId = operationId
  state.inFlightOperation = {
    operationId,
    toolName: String(toolName || ''),
    startedAt: toIso(nowMs),
    leaseExpiresAt: toIso(nowMs + state.thresholds.operationLeaseMs),
    ownedByAgent: true,
    mutating: options.mutating === true,
    targetPaths: [...new Set(observedPaths)].slice(0, 20),
    artifactDecision: options.artifactDecision && typeof options.artifactDecision === 'object'
      ? JSON.parse(JSON.stringify(options.artifactDecision))
      : null,
    mutationLease: options.mutationLease && typeof options.mutationLease === 'object'
      ? JSON.parse(JSON.stringify(options.mutationLease))
      : null,
    mutationFootprint: options.mutationFootprint && typeof options.mutationFootprint === 'object'
      ? JSON.parse(JSON.stringify(options.mutationFootprint))
      : null,
    mutationPreObservation: options.mutationPreObservation && typeof options.mutationPreObservation === 'object'
      ? JSON.parse(JSON.stringify(options.mutationPreObservation))
      : null
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
  const completingOperation = state.inFlightOperation ? { ...state.inFlightOperation } : null
  const operationId = getToolCallId(payload) || state.inFlightOperation?.operationId || state.lastToolCallId
  const duplicate = !!(
    operationId && operationId === state.lastToolCallId && state.lastToolOutputAt && !state.inFlightOperation
  )
  if (!duplicate && completingOperation?.operationRecord?.operationId === operationId) {
    const resultDigest = stableValueDigest({
      operationId,
      success: !(payload.success === false || payload.is_error === true || payload.isError === true || !!payload.error),
      toolOutput: payload.tool_output ?? payload.toolOutput ?? payload.output ?? null,
      error: payload.error ?? null
    })
    const observed = markTaskOperationObserved(state, operationId, { resultDigest }, { ...options, nowMs })
    state.taskOperationSet = observed.taskOperationSet
    state.lastTaskOperationRecord = observed.lastTaskOperationRecord
    completingOperation.operationRecord = observed.taskOperationSet.unresolved
  }
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
  if (completingOperation?.mutating === true) {
    state.lastMutationCloseout = {
      operationId: completingOperation.operationId,
      toolName: completingOperation.toolName,
      completedAt: toIso(nowMs),
      result: toolFailed ? 'error' : 'success',
      taskOperationRecord: completingOperation.operationRecord || null,
      checkpoint: { ...state.checkpoint, artifactPaths: [...state.checkpoint.artifactPaths] }
    }
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
  const operationSnapshot = taskOperationTerminalSnapshot(state)
  if (!operationSnapshot.terminalReady) {
    throw new TaskOperationRecordError(
      'TASK_OPERATION_UNSETTLED',
      'turn terminal requires every mutating task operation to settle or reconcile first',
      operationSnapshot
    )
  }
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
  if (state.executionAttemptLedger.entries.length && !state.executionAttemptLedger.terminal) {
    state.executionAttemptLedger.terminal = {
      status: normalizedTerminal === 'completed' ? 'completed' : (normalizedTerminal === 'interrupted' ? 'aborted' : 'error'),
      observedAt: toIso(nowMs),
      reason: String(reason || normalizedTerminal),
      cancelFinalizer: null
    }
  }
  return state
}

/** Record a server-reconciled business-task terminal without changing turn liveness. */
function applyWorkflowTaskTerminalReceipt(raw, receipt = {}, options = {}) {
  const nowMs = nowMsFrom(options)
  const state = normalizeTurnLivenessState(raw, { ...options, nowMs })
  state.workflowTaskTerminal = {
    schemaVersion: 'WorkflowTaskTerminalObservationV1',
    taskId: String(receipt.taskId || '').trim().toLowerCase(),
    admissionId: String(receipt.admissionId || '').trim(),
    admissionGeneration: Number(receipt.admissionGeneration) || 0,
    terminalStatus: String(receipt.terminalStatus || '').trim(),
    terminalGeneration: Number(receipt.terminalGeneration) || 0,
    receiptDigest: String(receipt.receiptDigest || '').trim().toLowerCase(),
    observedAt: toIso(nowMs)
  }
  return state
}

function formatTurnRecoveryMessage(card) {
  if (!card) return ''
  return `[DevCodex TurnRecoveryCard ${card.noticeKey}] priorState=${card.priorState}; reason=${card.reason}; ` +
    `resumeToken=${card.checkpoint.resumeToken || 'none'}; capability=${card.capabilityBoundary}. ${card.recommendedAction}`
}

module.exports = {
  DEFAULT_THRESHOLDS,
  EXECUTION_ATTEMPT_LEDGER_SCHEMA,
  TASK_OPERATION_RECORD_SCHEMA,
  TASK_OPERATION_SET_SCHEMA,
  ExecutionAttemptLedgerError,
  TaskOperationRecordError,
  abortPreparedTaskOperation,
  buildTurnRecoveryCard,
  classifyTurnLiveness,
  completeToolLease,
  applyWorkflowTaskTerminalReceipt,
  createExecutionAttemptLedger,
  createTurnLivenessState,
  evaluateExecutionAttempt,
  finalizeExecutionAttemptLedger,
  formatTurnRecoveryMessage,
  isTerminalState,
  markTurnTerminal,
  markTaskOperationDispatched,
  markTaskOperationObserved,
  normalizeExecutionAttemptLedger,
  normalizeTurnLivenessState,
  observeTurnEvent,
  prepareTaskOperationRecord,
  reconcileTaskOperationRecord,
  recordExecutionAttempt,
  settleTaskOperationRecord,
  startToolLease,
  taskOperationRecordDigest,
  taskOperationTargetSetDigest,
  taskOperationSettledSetDigest,
  taskOperationTerminalSnapshot,
  validateTaskOperationRecord,
  validateTaskOperationSet
}
