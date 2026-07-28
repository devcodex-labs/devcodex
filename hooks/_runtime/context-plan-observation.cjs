'use strict'

const crypto = require('crypto')
const path = require('path')
const { createDerivedStateStore } = require('./derived-state-store.cjs')
const { stableDigest, validateContextReadPlan } = require('./context-read-contract.cjs')

const CONTEXT_PLAN_OBSERVATION_SCHEMA = 'ContextPlanObservationV1'
const CONTEXT_PLAN_OBSERVATION_SLOT_COUNT = 128
const CONTEXT_PLAN_OBSERVATION_MAX_BYTES = 256 * 1024
const CONTEXT_PLAN_OBSERVATION_FUTURE_SKEW_MS = 5 * 60 * 1000
const OBSERVATION_FIELDS = new Set([
  'schemaVersion',
  'contextEpochDigest',
  'contextEpoch',
  'project',
  'activeRoot',
  'observedAt',
  'planId',
  'planContentId',
  'planDigest',
  'plan'
])

function portableRoot(value) {
  const text = String(value || '').trim()
  return text ? path.resolve(text).replace(/\\/g, '/') : ''
}

function contextEpochDigest(contextEpoch) {
  return crypto.createHash('sha256').update(String(contextEpoch || '').trim()).digest('hex')
}

function contextPlanObservationRelativePath(contextEpoch) {
  const digest = contextEpochDigest(contextEpoch)
  const slot = Number.parseInt(digest.slice(0, 8), 16) % CONTEXT_PLAN_OBSERVATION_SLOT_COUNT
  return path.join(
    '.runtime-state',
    'context-plan-observations',
    'v1',
    `slot-${String(slot).padStart(3, '0')}.json`
  )
}

function buildContextPlanObservation({ activeRoot, project, contextEpoch, plan, nowMs = Date.now() }) {
  return {
    schemaVersion: CONTEXT_PLAN_OBSERVATION_SCHEMA,
    contextEpochDigest: contextEpochDigest(contextEpoch),
    contextEpoch: String(contextEpoch || '').trim(),
    project: String(project || '').trim(),
    activeRoot: portableRoot(activeRoot),
    observedAt: new Date(nowMs).toISOString(),
    planId: String(plan?.planId || '').trim(),
    planContentId: String(plan?.planContentId || '').trim(),
    planDigest: stableDigest(plan),
    plan
  }
}

function validateContextPlanObservation(value, expected = {}) {
  const errors = []
  const observation = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!observation) return { valid: false, errors: ['observation must be an object'], plan: null }

  const unknown = Object.keys(observation).filter(field => !OBSERVATION_FIELDS.has(field))
  if (unknown.length) errors.push(`unsupported observation fields: ${unknown.join(', ')}`)
  if (observation.schemaVersion !== CONTEXT_PLAN_OBSERVATION_SCHEMA) errors.push('invalid observation schema')

  const epoch = String(observation.contextEpoch || '').trim()
  const project = String(observation.project || '').trim()
  const activeRoot = portableRoot(observation.activeRoot)
  if (!epoch || observation.contextEpochDigest !== contextEpochDigest(epoch)) errors.push('invalid context epoch identity')
  if (!project || !activeRoot) errors.push('observation target is incomplete')

  if (expected.contextEpoch && epoch !== String(expected.contextEpoch).trim()) errors.push('context epoch mismatch')
  if (expected.project && project !== String(expected.project).trim()) errors.push('project mismatch')
  if (expected.activeRoot && activeRoot !== portableRoot(expected.activeRoot)) errors.push('active root mismatch')

  const observedAtMs = Date.parse(observation.observedAt)
  const notBeforeMs = expected.notBefore ? Date.parse(expected.notBefore) : null
  const nowMs = Number.isFinite(expected.nowMs) ? expected.nowMs : Date.now()
  if (!Number.isFinite(observedAtMs)) errors.push('invalid observedAt')
  if (Number.isFinite(notBeforeMs) && observedAtMs < notBeforeMs) errors.push('observation predates the matching tool attempt')
  if (Number.isFinite(observedAtMs) && observedAtMs > nowMs + CONTEXT_PLAN_OBSERVATION_FUTURE_SKEW_MS) {
    errors.push('observation timestamp is too far in the future')
  }

  const planValidation = validateContextReadPlan(observation.plan)
  if (!planValidation.valid) errors.push(planValidation.error.message)
  const plan = planValidation.valid ? observation.plan : null
  if (plan) {
    if (observation.planDigest !== stableDigest(plan)) errors.push('plan digest mismatch')
    if (observation.planId !== plan.planId || observation.planContentId !== plan.planContentId) {
      errors.push('plan identity mirror mismatch')
    }
    if (plan.identity.contextEpoch !== epoch ||
        plan.identity.project !== project ||
        portableRoot(plan.identity.activeRoot) !== activeRoot) {
      errors.push('plan target does not match the observation envelope')
    }
  }

  return { valid: errors.length === 0, errors, plan }
}

function observationStore(activeRoot, contextEpoch, maxWrites) {
  return createDerivedStateStore({
    root: activeRoot,
    relativePath: contextPlanObservationRelativePath(contextEpoch),
    maxBytes: CONTEXT_PLAN_OBSERVATION_MAX_BYTES,
    lockWaitMs: 2000,
    maxWrites
  })
}

function persistContextPlanObservation(input) {
  const observation = buildContextPlanObservation(input)
  const validation = validateContextPlanObservation(observation, {
    activeRoot: input.activeRoot,
    project: input.project,
    contextEpoch: input.contextEpoch,
    nowMs: input.nowMs
  })
  if (!validation.valid) {
    return {
      status: 'invalid',
      errorCode: 'CONTEXT_PLAN_OBSERVATION_INVALID',
      errors: validation.errors
    }
  }

  const store = observationStore(input.activeRoot, input.contextEpoch, 1)
  const write = store.write(observation)
  if (write.status !== 'persisted') return write

  const read = store.read()
  const readValidation = read.status === 'fresh'
    ? validateContextPlanObservation(read.value, {
        activeRoot: input.activeRoot,
        project: input.project,
        contextEpoch: input.contextEpoch,
        nowMs: input.nowMs
      })
    : { valid: false, errors: [`observation read-back status is ${read.status}`] }
  if (!readValidation.valid) {
    return {
      status: 'invalid',
      errorCode: 'CONTEXT_PLAN_OBSERVATION_READBACK_INVALID',
      errors: readValidation.errors,
      filePath: store.filePath
    }
  }
  return {
    status: 'persisted',
    filePath: store.filePath,
    bytes: write.bytes,
    planDigest: observation.planDigest
  }
}

function readContextPlanObservation({ activeRoot, project, contextEpoch, notBefore, nowMs }) {
  const store = observationStore(activeRoot, contextEpoch, 0)
  const read = store.read()
  if (read.status !== 'fresh') return { ...read, plan: null }
  const validation = validateContextPlanObservation(read.value, {
    activeRoot,
    project,
    contextEpoch,
    notBefore,
    nowMs
  })
  if (!validation.valid) {
    return {
      status: 'invalid',
      errorCode: 'CONTEXT_PLAN_OBSERVATION_INVALID',
      errors: validation.errors,
      filePath: store.filePath,
      plan: null
    }
  }
  return {
    status: 'fresh',
    filePath: store.filePath,
    bytes: read.bytes,
    observation: read.value,
    plan: validation.plan
  }
}

module.exports = {
  CONTEXT_PLAN_OBSERVATION_SCHEMA,
  CONTEXT_PLAN_OBSERVATION_SLOT_COUNT,
  CONTEXT_PLAN_OBSERVATION_MAX_BYTES,
  buildContextPlanObservation,
  contextEpochDigest,
  contextPlanObservationRelativePath,
  persistContextPlanObservation,
  readContextPlanObservation,
  validateContextPlanObservation
}
