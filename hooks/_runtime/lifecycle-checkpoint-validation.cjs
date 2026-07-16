'use strict'

const CHECKPOINT_VALIDATION_SCHEMA_VERSION = 'CheckpointValidationResultV1'
const CHECKPOINT_MODES = new Set(['response-time', 'post-execution'])

function nowIso(options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  return { nowMs, observedAt: new Date(nowMs).toISOString() }
}

function stringList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(Boolean))]
}

function evidenceList(value) {
  return (Array.isArray(value) ? value : [])
    .filter(item => item !== null && item !== undefined)
    .map(item => (item && typeof item === 'object' ? { ...item } : { value: String(item) }))
}

function normalizeDeadline(value) {
  const text = String(value || '')
  return Number.isFinite(Date.parse(text)) ? new Date(Date.parse(text)).toISOString() : null
}

/** Evaluate response-time or post-execution evidence without inferring missing host results. */
function validateCheckpointEvidence(input = {}, options = {}) {
  const { nowMs, observedAt } = nowIso(options)
  const mode = String(input.mode || '')
  const evidence = evidenceList(input.evidence)
  const blockingIssues = stringList(input.blockingIssues)
  const suppliedActions = stringList(input.requiredActions)
  const deadlineAt = normalizeDeadline(input.deadlineAt)

  if (!CHECKPOINT_MODES.has(mode)) {
    return {
      schemaVersion: CHECKPOINT_VALIDATION_SCHEMA_VERSION,
      mode,
      status: 'blocked',
      blocking: true,
      requiredActions: suppliedActions.length ? suppliedActions : ['select-response-time-or-post-execution-mode'],
      evidenceState: 'unverified',
      evidence,
      blockingIssues,
      observedAt,
      errorCode: 'CHECKPOINT_MODE_INVALID',
      deadlineAt
    }
  }

  if (blockingIssues.length) {
    return {
      schemaVersion: CHECKPOINT_VALIDATION_SCHEMA_VERSION,
      mode,
      status: 'blocked',
      blocking: true,
      requiredActions: suppliedActions.length ? suppliedActions : blockingIssues,
      evidenceState: evidence.length ? 'source-backed' : 'unverified',
      evidence,
      blockingIssues,
      observedAt,
      errorCode: null,
      deadlineAt
    }
  }

  if (!evidence.length) {
    const timedOut = mode === 'post-execution' && deadlineAt && nowMs >= Date.parse(deadlineAt)
    return {
      schemaVersion: CHECKPOINT_VALIDATION_SCHEMA_VERSION,
      mode,
      status: timedOut ? 'incomplete-timeout' : 'unverified',
      blocking: mode === 'post-execution',
      requiredActions: suppliedActions.length
        ? suppliedActions
        : [timedOut ? 'record-timeout-and-recover' : `collect-${mode}-evidence`],
      evidenceState: 'unverified',
      evidence,
      blockingIssues: [],
      observedAt,
      errorCode: timedOut ? 'TRACE_COMPLETION_TIMEOUT' : 'HOST_RESULT_INCOMPLETE',
      deadlineAt
    }
  }

  return {
    schemaVersion: CHECKPOINT_VALIDATION_SCHEMA_VERSION,
    mode,
    status: 'pass',
    blocking: false,
    requiredActions: suppliedActions,
    evidenceState: 'verified',
    evidence,
    blockingIssues: [],
    observedAt,
    errorCode: null,
    deadlineAt
  }
}

function normalizeCheckpointValidationResult(raw, mode, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const evidence = evidenceList(source.evidence)
  if (!evidence.length || source.status === 'unverified' || source.status === 'incomplete-timeout') {
    return validateCheckpointEvidence({
      mode,
      evidence,
      blockingIssues: source.blockingIssues,
      requiredActions: source.requiredActions,
      deadlineAt: source.deadlineAt
    }, options)
  }
  if (source.status === 'blocked') {
    return validateCheckpointEvidence({
      mode,
      evidence,
      blockingIssues: stringList(source.blockingIssues).length ? source.blockingIssues : ['persisted-blocking-checkpoint'],
      requiredActions: source.requiredActions,
      deadlineAt: source.deadlineAt
    }, options)
  }
  return validateCheckpointEvidence({ mode, evidence, deadlineAt: source.deadlineAt }, options)
}

function createCheckpointValidationSet(options = {}) {
  return {
    responseTime: validateCheckpointEvidence({ mode: 'response-time' }, options),
    postExecution: validateCheckpointEvidence({ mode: 'post-execution' }, options)
  }
}

function normalizeCheckpointValidationSet(raw, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    responseTime: normalizeCheckpointValidationResult(source.responseTime, 'response-time', options),
    postExecution: normalizeCheckpointValidationResult(source.postExecution, 'post-execution', options)
  }
}

module.exports = {
  CHECKPOINT_MODES,
  CHECKPOINT_VALIDATION_SCHEMA_VERSION,
  createCheckpointValidationSet,
  normalizeCheckpointValidationResult,
  normalizeCheckpointValidationSet,
  validateCheckpointEvidence
}
