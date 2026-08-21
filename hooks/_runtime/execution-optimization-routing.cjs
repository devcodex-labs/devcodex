'use strict'

const path = require('path')
const {
  buildJsonContentIdentity,
  stableStringify,
  validateContentIdentity
} = require('./content-identity.cjs')
const { createRuntimeStateStore } = require('./runtime-state-store.cjs')
const {
  normalizeExecutionOptimizationMode,
  resolveActiveRuntimeRoot,
  resolveExecutionOptimizationModeForCwd
} = require('./workspace-layout.cjs')

const STATE_SCHEMA = 'ExecutionOptimizationStateV2'
const LEGACY_STATE_SCHEMA = 'ExecutionOptimizationStateV1'
const FEATURE_SCHEMA = 'OptimizationFeatureStateV1'
const FEATURE_DECISION_SCHEMA = 'ExecutionOptimizationFeatureDecisionV1'
const POLICY_VERSION = 'execution-optimization-1'
const ALLOWED_MODES = new Set(['safe-auto', 'full-only'])
const ALLOWED_STATES = new Set(['off', 'shadow', 'trial', 'default', 'rolled-back', 'sunset'])

const FEATURE_DEFINITIONS = Object.freeze([
  { id: 'task-index-acceleration', aliases: ['task-index', 'taskIndex'], fullRoute: 'bounded-direct' },
  { id: 'context-computation-reuse', aliases: ['context-cache', 'contextReuse'], fullRoute: 'full-context-read' },
  { id: 'validation-changed-scope', aliases: ['validation-changed', 'changed-validation'], fullRoute: 'direct-validation-plan' },
  { id: 'profile-section-load', aliases: ['profile-progressive-load', 'profile-sections'], fullRoute: 'full-profile-file' },
  { id: 'skill-bundle', aliases: ['skill-bundle-v1', 'skill-selection'], fullRoute: 'full-skill-read' },
  { id: 'project-knowledge-reuse', aliases: ['project-analysis-cache', 'knowledge-snapshot'], fullRoute: 'full-project-analysis' }
])
const FEATURE_BY_ID = new Map(FEATURE_DEFINITIONS.map(item => [item.id, item]))
const FEATURE_ALIAS = new Map(FEATURE_DEFINITIONS.flatMap(item => [item.id, ...item.aliases].map(alias => [alias, item.id])))

class ExecutionOptimizationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ExecutionOptimizationError'
    this.code = code
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function normalizeFeatureId(value) {
  return FEATURE_ALIAS.get(String(value || '').trim()) || ''
}

function normalizeModeValue(value) {
  return normalizeExecutionOptimizationMode(value)
}

function featureRecord(id, lifecycleState = 'trial', details = {}) {
  const normalizedId = normalizeFeatureId(id)
  if (!normalizedId) throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_FEATURE_UNKNOWN', `unknown optimization feature: ${id}`)
  if (!ALLOWED_STATES.has(lifecycleState)) throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_STATE_INVALID', `invalid lifecycle state: ${lifecycleState}`)
  return {
    schemaVersion: FEATURE_SCHEMA,
    featureId: normalizedId,
    lifecycleState,
    evidence: Array.isArray(details.evidence) ? [...new Set(details.evidence.map(String))].sort() : [],
    releaseCandidatesWithoutBenefit: Math.max(0, Number.parseInt(details.releaseCandidatesWithoutBenefit, 10) || 0),
    lastVerdict: String(details.lastVerdict || 'insufficient-evidence'),
    updatedAt: details.updatedAt || null
  }
}

function finalizeState(core) {
  const stateIdentity = buildJsonContentIdentity({
    sourceKey: 'execution-optimization-state',
    value: core,
    contractVersion: POLICY_VERSION
  }).identity
  return { ...core, stateIdentity }
}

function createOptimizationState(options = {}) {
  const requested = options.featureStates && typeof options.featureStates === 'object' ? options.featureStates : {}
  const defaultState = ALLOWED_STATES.has(options.defaultState) ? options.defaultState : 'trial'
  const features = FEATURE_DEFINITIONS.map(definition => featureRecord(
    definition.id,
    requested[definition.id] || requested[definition.aliases.find(alias => requested[alias])] || defaultState
  ))
  return finalizeState({
    schemaVersion: STATE_SCHEMA,
    policyVersion: POLICY_VERSION,
    mode: normalizeModeValue(options.mode).effective,
    features,
    updatedAt: options.updatedAt || null
  })
}

function validateOptimizationState(state) {
  if (!state || state.schemaVersion !== STATE_SCHEMA || state.policyVersion !== POLICY_VERSION) return false
  if (!ALLOWED_MODES.has(state.mode) || !Array.isArray(state.features) || state.features.length !== FEATURE_DEFINITIONS.length) return false
  const ids = new Set()
  for (const record of state.features) {
    if (record?.schemaVersion !== FEATURE_SCHEMA || !FEATURE_BY_ID.has(record.featureId) || !ALLOWED_STATES.has(record.lifecycleState) || ids.has(record.featureId)) return false
    ids.add(record.featureId)
  }
  if (!validateContentIdentity(state.stateIdentity).valid) return false
  const { stateIdentity, ...core } = state
  return stableStringify(finalizeState(core).stateIdentity) === stableStringify(stateIdentity)
}

function migrateLegacyState(raw) {
  if (!raw || raw.schemaVersion !== LEGACY_STATE_SCHEMA) {
    throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_SCHEMA_UNSUPPORTED', 'legacy migration requires ExecutionOptimizationStateV1')
  }
  const modeAlias = raw.mode === 'auto' ? 'safe-auto' : (raw.mode === 'disabled' ? 'full-only' : raw.mode)
  const lifecycleAlias = { enabled: 'trial', disabled: 'off', rollback: 'rolled-back', active: 'default' }
  const states = {}
  const entries = Array.isArray(raw.features)
    ? raw.features.map(item => [item.id || item.featureId, item.state || item.lifecycleState])
    : Object.entries(raw.features || {})
  for (const [legacyId, legacyState] of entries) {
    const id = normalizeFeatureId(legacyId)
    if (!id) continue
    states[id] = lifecycleAlias[legacyState] || legacyState
  }
  const migrated = createOptimizationState({
    mode: normalizeModeValue(modeAlias).effective,
    featureStates: states,
    defaultState: 'off',
    updatedAt: raw.updatedAt || null
  })
  return { state: migrated, migration: { from: LEGACY_STATE_SCHEMA, to: STATE_SCHEMA, status: 'read-only-migrated' } }
}

function normalizeOptimizationState(raw) {
  if (!raw) return { state: createOptimizationState(), migration: null }
  if (raw.schemaVersion === LEGACY_STATE_SCHEMA) return migrateLegacyState(raw)
  if (raw.schemaVersion !== STATE_SCHEMA) {
    throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_SCHEMA_UNSUPPORTED', `unsupported optimization schema: ${raw.schemaVersion || '(missing)'}`)
  }
  if (!validateOptimizationState(raw)) {
    throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_STATE_INVALID', 'optimization state identity or feature contract is invalid')
  }
  return { state: clone(raw), migration: null }
}

function decideFeatureRoute({ mode = 'safe-auto', state, featureId }) {
  const id = normalizeFeatureId(featureId)
  if (!id) throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_FEATURE_UNKNOWN', `unknown optimization feature: ${featureId}`)
  const modeDecision = normalizeModeValue(mode)
  const feature = state?.features?.find(item => item.featureId === id) || featureRecord(id, 'trial')
  const definition = FEATURE_BY_ID.get(id)
  if (modeDecision.effective === 'full-only') {
    return {
      featureId: id,
      lifecycleState: feature.lifecycleState,
      route: definition.fullRoute,
      optimizationAllowed: false,
      reasonCode: modeDecision.errorCode || 'execution-optimization-full-only'
    }
  }
  if (feature.lifecycleState === 'shadow') {
    return { featureId: id, lifecycleState: feature.lifecycleState, route: `shadow:${definition.fullRoute}`, optimizationAllowed: false, reasonCode: 'feature-shadow' }
  }
  if (['off', 'rolled-back', 'sunset'].includes(feature.lifecycleState)) {
    return { featureId: id, lifecycleState: feature.lifecycleState, route: definition.fullRoute, optimizationAllowed: false, reasonCode: `feature-${feature.lifecycleState}` }
  }
  return { featureId: id, lifecycleState: feature.lifecycleState, route: 'optimized', optimizationAllowed: true, reasonCode: `feature-${feature.lifecycleState}` }
}

function optimizationStateStore(activeRoot, options = {}) {
  return createRuntimeStateStore({
    activeRoot,
    relativePath: path.join('execution-optimization', 'v2', 'state.json'),
    maxBytes: options.maxBytes || 256 * 1024,
    maxWrites: options.maxWrites === undefined ? 1 : options.maxWrites,
    identityField: 'stateIdentity'
  })
}

function readOptimizationState(activeRoot, options = {}) {
  const receipt = optimizationStateStore(activeRoot, options).read()
  if (receipt.status !== 'fresh') return { ...receipt, state: null, migration: null }
  try {
    const normalized = normalizeOptimizationState(receipt.value)
    return { ...receipt, value: undefined, state: normalized.state, migration: normalized.migration }
  } catch (error) {
    return { ...receipt, status: 'invalid', state: null, migration: null, errorCode: error.code, message: error.message }
  }
}

function normalizeSuppliedMode(options, cwd) {
  if (options.modeDecision && typeof options.modeDecision === 'object') {
    const effective = options.modeDecision.effective || options.modeDecision.mode
    if (!ALLOWED_MODES.has(effective)) {
      return { requested: effective || null, effective: 'full-only', status: 'fail-closed', errorCode: 'EXECUTION_OPTIMIZATION_MODE_INVALID' }
    }
    if (options.modeDecision.status === 'fail-closed' || options.modeDecision.bindingValid === false || options.modeDecision.errorCode) {
      return { ...options.modeDecision, effective: 'full-only', status: 'fail-closed' }
    }
    return { ...options.modeDecision, effective }
  }
  if (Object.prototype.hasOwnProperty.call(options, 'mode')) return normalizeModeValue(options.mode)
  return resolveExecutionOptimizationModeForCwd(cwd, options.project || '')
}

function resolveExecutionFeatureDecisionForCwd(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  const activeRoot = path.resolve(options.activeRoot || resolveActiveRuntimeRoot(cwd))
  const modeDecision = normalizeSuppliedMode(options, cwd)
  let stateReceipt
  if (Object.prototype.hasOwnProperty.call(options, 'state')) {
    if (options.state === null) stateReceipt = { status: 'missing', state: null, migration: null }
    else {
      try {
        const normalized = normalizeOptimizationState(options.state)
        stateReceipt = { status: 'provided', state: normalized.state, migration: normalized.migration }
      } catch (error) {
        stateReceipt = { status: 'invalid', state: null, migration: null, errorCode: error.code, message: error.message }
      }
    }
  } else {
    stateReceipt = readOptimizationState(activeRoot, { maxWrites: 0 })
  }

  const stateReadFailed = !['fresh', 'provided', 'missing'].includes(stateReceipt.status)
  const state = stateReceipt.state || createOptimizationState({
    mode: stateReadFailed ? 'full-only' : modeDecision.effective,
    defaultState: stateReadFailed ? 'off' : 'trial'
  })
  const effectiveMode = stateReadFailed || modeDecision.effective === 'full-only' || state.mode === 'full-only'
    ? 'full-only'
    : 'safe-auto'
  const routeDecision = decideFeatureRoute({ mode: effectiveMode, state, featureId: options.featureId })
  return {
    schemaVersion: FEATURE_DECISION_SCHEMA,
    ...routeDecision,
    reasonCode: stateReadFailed ? 'execution-optimization-state-invalid' : routeDecision.reasonCode,
    activeRoot,
    configurationMode: modeDecision.effective,
    configurationStatus: modeDecision.status || null,
    stateMode: state.mode,
    stateStatus: stateReceipt.status,
    stateErrorCode: stateReceipt.errorCode || null,
    stateIdentity: stateReceipt.state?.stateIdentity || null,
    migration: stateReceipt.migration || null
  }
}

module.exports = {
  ALLOWED_MODES,
  ALLOWED_STATES,
  ExecutionOptimizationError,
  FEATURE_DECISION_SCHEMA,
  FEATURE_DEFINITIONS,
  FEATURE_SCHEMA,
  LEGACY_STATE_SCHEMA,
  POLICY_VERSION,
  STATE_SCHEMA,
  createOptimizationState,
  decideFeatureRoute,
  featureRecord,
  finalizeState,
  migrateLegacyState,
  normalizeFeatureId,
  normalizeModeValue,
  normalizeOptimizationState,
  optimizationStateStore,
  readOptimizationState,
  resolveExecutionFeatureDecisionForCwd,
  validateOptimizationState
}
