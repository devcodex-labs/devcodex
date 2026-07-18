'use strict'

const fs = require('fs')
const path = require('path')
const {
  ALLOWED_MODES,
  ExecutionOptimizationError,
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
} = require('../../hooks/_runtime/execution-optimization-routing.cjs')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath,
  resolveActiveRuntimeRoot
} = require('../../hooks/_runtime/workspace-layout.cjs')

const INSPECTION_SCHEMA = 'ExecutionOptimizationInspectionV1'
const TRANSITION_SCHEMA = 'OptimizationTransitionReceiptV1'
const BENCHMARK_INPUT_SCHEMA = 'ExecutionChainBenchmarkInputV1'
const BENCHMARK_RESULT_SCHEMA = 'ExecutionChainBenchmarkResultV1'
const FEATURE_BY_ID = new Map(FEATURE_DEFINITIONS.map(item => [item.id, item]))

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function readJsonRecord(filePath) {
  if (!fs.existsSync(filePath)) return { filePath, status: 'missing', value: null }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config root must be an object')
    return { filePath, status: 'loaded', value }
  } catch (error) {
    return { filePath, status: 'invalid', value: null, error: error.message }
  }
}

function resolveProfileConfigRecords(cwd) {
  const absoluteCwd = path.resolve(cwd)
  const layout = findLayoutInfo(absoluteCwd)
  if (!layout.enabled) return [readJsonRecord(path.join(absoluteCwd, '.devcodex', 'profile', 'config.json'))]
  const records = [readJsonRecord(path.join(layout.workspaceRoot, '.devcodex', 'workspace', 'profile', 'config.json'))]
  const project = inferProjectFromCwd(absoluteCwd, layout)
  if (project) records.push(readJsonRecord(path.join(namespaceRootPath(layout.workspaceRoot, project), 'profile', 'config.json')))
  return records
}

function resolveExecutionOptimizationMode(configRecords = []) {
  const invalid = configRecords.find(record => record?.status === 'invalid')
  if (invalid) {
    return {
      requested: null,
      effective: 'full-only',
      status: 'fail-closed',
      errorCode: 'EXECUTION_OPTIMIZATION_CONFIG_INVALID',
      sourcePaths: configRecords.map(record => record.filePath),
      details: invalid.error
    }
  }
  let requested
  let sourcePath = null
  for (const record of configRecords) {
    if (record?.status !== 'loaded') continue
    const candidate = record.value?.extensions?.devcodex?.executionOptimization?.mode
    if (candidate !== undefined) {
      requested = candidate
      sourcePath = record.filePath
    }
  }
  return {
    ...normalizeModeValue(requested),
    sourcePath,
    sourcePaths: configRecords.map(record => record.filePath)
  }
}

function correctnessIsZero(correctness = {}) {
  const values = Object.values(correctness)
  return values.length > 0 && values.every(value => Number(value) === 0)
}

function transitionFeature(stateInput, featureId, action, evidence = {}) {
  const { state } = normalizeOptimizationState(stateInput)
  const id = normalizeFeatureId(featureId)
  if (!id) throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_FEATURE_UNKNOWN', `unknown optimization feature: ${featureId}`)
  const current = state.features.find(item => item.featureId === id)
  let nextState = current.lifecycleState
  let verdict = 'insufficient-evidence'
  let promotionAllowed = false
  const reasons = []

  if (action === 'shadow') {
    if (!['off', 'rolled-back'].includes(current.lifecycleState)) reasons.push('shadow-requires-off-or-rolled-back')
    else nextState = 'shadow'
  } else if (action === 'start-trial') {
    if (current.lifecycleState !== 'shadow') reasons.push('trial-requires-shadow')
    if (evidence.baselineComparable !== true || evidence.prospectiveTrialPlanned !== true) reasons.push('prospective-trial-contract-missing')
    if (!reasons.length) nextState = 'trial'
  } else if (action === 'promote') {
    if (current.lifecycleState !== 'trial') reasons.push('promotion-requires-trial')
    const enoughProspective = Number(evidence.prospectiveWorkUnits || 0) >= 3 || Number(evidence.independentContexts || 0) >= 2
    if (!enoughProspective) reasons.push('prospective-sample-insufficient')
    if (!correctnessIsZero(evidence.correctness)) reasons.push('correctness-nonzero')
    if (Number(evidence.directBenefitRatio) < 0.2) reasons.push('direct-benefit-below-threshold')
    if (Number(evidence.fullFallbackRegression) > 0.05) reasons.push('full-fallback-regression')
    if (Number(evidence.instrumentationOverhead) > 0.03) reasons.push('instrumentation-overhead')
    if (Number(evidence.falsePositiveRate || 0) > 0.05) reasons.push('false-positive-cost')
    if (reasons.includes('correctness-nonzero')) {
      nextState = 'rolled-back'
      verdict = 'harmful'
    } else if (!reasons.length) {
      nextState = 'default'
      verdict = 'effective'
      promotionAllowed = true
    }
  } else if (action === 'rollback') {
    if (['off', 'sunset'].includes(current.lifecycleState)) reasons.push('rollback-not-applicable')
    else {
      nextState = 'rolled-back'
      verdict = evidence.reason === 'correctness' ? 'harmful' : 'ineffective'
    }
  } else if (action === 'sunset') {
    const noBenefitCount = Math.max(current.releaseCandidatesWithoutBenefit, Number(evidence.releaseCandidatesWithoutBenefit || 0))
    const maintenanceExceedsBenefit = Number(evidence.maintenanceCostRatio || 0) > Number(evidence.benefitRatio || 0)
    if (noBenefitCount < 2 && !maintenanceExceedsBenefit) reasons.push('sunset-threshold-not-met')
    else {
      nextState = 'sunset'
      verdict = 'ineffective'
    }
  } else {
    throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_ACTION_UNKNOWN', `unknown lifecycle action: ${action}`)
  }

  const features = state.features.map(item => item.featureId === id
    ? featureRecord(id, nextState, {
      ...item,
      evidence: [...(item.evidence || []), ...(evidence.evidence || [])],
      releaseCandidatesWithoutBenefit: Math.max(item.releaseCandidatesWithoutBenefit || 0, Number(evidence.releaseCandidatesWithoutBenefit || 0)),
      lastVerdict: verdict,
      updatedAt: evidence.updatedAt || null
    })
    : item)
  const next = finalizeState({
    schemaVersion: STATE_SCHEMA,
    policyVersion: POLICY_VERSION,
    mode: state.mode,
    features,
    updatedAt: evidence.updatedAt || state.updatedAt || null
  })
  return {
    state: next,
    receipt: {
      schemaVersion: TRANSITION_SCHEMA,
      featureId: id,
      action,
      from: current.lifecycleState,
      to: nextState,
      verdict,
      promotionAllowed,
      reasons: [...new Set(reasons)].sort(),
      fullRoute: FEATURE_BY_ID.get(id).fullRoute
    }
  }
}

function persistOptimizationState(activeRoot, state, options = {}) {
  const normalized = normalizeOptimizationState(state)
  if (normalized.migration) throw new ExecutionOptimizationError('EXECUTION_OPTIMIZATION_MIGRATION_WRITE_BLOCKED', 'legacy state must be explicitly rewritten as the current schema')
  return optimizationStateStore(activeRoot, options).write(normalized.state)
}

function inspectExecutionOptimization(cwd, options = {}) {
  const configRecords = options.configRecords || resolveProfileConfigRecords(cwd)
  const config = resolveExecutionOptimizationMode(configRecords)
  const activeRoot = options.activeRoot || resolveActiveRuntimeRoot(cwd)
  let stateReceipt
  if (Object.prototype.hasOwnProperty.call(options, 'state')) {
    try {
      stateReceipt = { status: 'provided', state: normalizeOptimizationState(options.state).state, migration: null }
    } catch (error) {
      stateReceipt = { status: 'invalid', state: null, migration: null, errorCode: error.code, message: error.message }
    }
  } else {
    stateReceipt = readOptimizationState(activeRoot, { maxWrites: 0 })
  }
  const stateReadFailed = !['fresh', 'provided', 'missing'].includes(stateReceipt.status)
  const state = stateReceipt.state || createOptimizationState({
    mode: stateReadFailed ? 'full-only' : config.effective,
    defaultState: stateReadFailed ? 'off' : 'trial'
  })
  const decisionMode = stateReadFailed || config.effective === 'full-only' || state.mode === 'full-only'
    ? 'full-only'
    : 'safe-auto'
  return {
    schemaVersion: INSPECTION_SCHEMA,
    activeRoot,
    config,
    stateStatus: stateReceipt.status,
    migration: stateReceipt.migration || null,
    stateIdentity: state.stateIdentity,
    features: FEATURE_DEFINITIONS.map(definition => ({
      ...state.features.find(item => item.featureId === definition.id),
      decision: decideFeatureRoute({ mode: decisionMode, state, featureId: definition.id })
    })),
    writes: []
  }
}

function percentile(samples, fraction) {
  const values = samples.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  if (!values.length) return null
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)]
}

function summarizeMetric(metric = {}) {
  const samples = Array.isArray(metric.samples) ? metric.samples.map(Number).filter(Number.isFinite) : []
  return {
    unit: String(metric.unit || 'ratio-unit'),
    samples,
    sampleCount: samples.length,
    minimumSamples: Math.max(1, Number.parseInt(metric.minimumSamples, 10) || 3),
    median: percentile(samples, 0.5),
    p95: percentile(samples, 0.95)
  }
}

function evaluateExecutionChainBenchmark(input = {}) {
  if (input.schemaVersion !== BENCHMARK_INPUT_SCHEMA) throw new ExecutionOptimizationError('EXECUTION_BENCHMARK_SCHEMA_INVALID', `expected ${BENCHMARK_INPUT_SCHEMA}`)
  const dimensionIds = ['validationWallTime', 'contextDeliveredBytes', 'analysisRecomputeWork', 'resumeSetupCost']
  const dimensions = []
  for (const id of dimensionIds) {
    const baseline = summarizeMetric(input.baseline?.[id])
    const candidate = summarizeMetric(input.candidate?.[id])
    const unitsMatch = baseline.unit === candidate.unit
    const ratio = unitsMatch && baseline.median > 0 && candidate.median !== null ? candidate.median / baseline.median : null
    dimensions.push({
      id,
      baseline,
      candidate,
      comparable: unitsMatch && ratio !== null,
      samplePolicyPassed: baseline.sampleCount >= baseline.minimumSamples && candidate.sampleCount >= candidate.minimumSamples,
      ratio,
      improvement: ratio === null ? null : 1 - ratio,
      regression: ratio === null ? null : ratio - 1
    })
  }
  const comparable = input.environment?.baselineKey && input.environment.baselineKey === input.environment.candidateKey && dimensions.every(item => item.comparable)
  const ratios = dimensions.map(item => item.ratio).filter(value => value !== null && value > 0)
  const geometricRatio = ratios.length === dimensionIds.length
    ? Math.exp(ratios.reduce((sum, value) => sum + Math.log(value), 0) / ratios.length)
    : null
  const overallImprovement = geometricRatio === null ? null : 1 - geometricRatio
  const correctnessPassed = correctnessIsZero(input.correctness)
  const samplePolicyPassed = dimensions.every(item => item.samplePolicyPassed)
  const improvedDimensions = dimensions.filter(item => item.improvement !== null && item.improvement >= 0.2).length
  const regressionPassed = dimensions.every(item => item.regression === null || item.regression <= 0.05)
  const instrumentationPassed = Number(input.instrumentationOverhead || 0) <= 0.03
  let status = 'provisional'
  const reasons = []
  if (!comparable) reasons.push('environment-or-dimension-not-comparable')
  if (!samplePolicyPassed) reasons.push('sample-policy-incomplete')
  if (!correctnessPassed) reasons.push('correctness-nonzero')
  if (!regressionPassed) reasons.push('dimension-regression-over-5pct')
  if (!instrumentationPassed) reasons.push('instrumentation-overhead-over-3pct')
  if (overallImprovement === null || overallImprovement < 0.25) reasons.push('overall-improvement-below-25pct')
  if (improvedDimensions < 3) reasons.push('fewer-than-three-dimensions-improved-20pct')
  if (!correctnessPassed || !regressionPassed) status = 'rejected'
  else if (!reasons.length) status = 'accepted'
  return {
    schemaVersion: BENCHMARK_RESULT_SCHEMA,
    candidateId: String(input.candidateId || ''),
    environment: clone(input.environment || {}),
    dimensions,
    geometricRatio,
    overallImprovement,
    improvedDimensions,
    correctness: clone(input.correctness || {}),
    instrumentationOverhead: Number(input.instrumentationOverhead || 0),
    status,
    promotionAllowed: status === 'accepted',
    reasons: [...new Set(reasons)].sort(),
    tokenMetrics: input.tokenMetrics || { status: 'N/A', reason: 'host token/TTFT counter unavailable' }
  }
}

module.exports = {
  ALLOWED_MODES,
  BENCHMARK_INPUT_SCHEMA,
  BENCHMARK_RESULT_SCHEMA,
  ExecutionOptimizationError,
  FEATURE_DEFINITIONS,
  FEATURE_SCHEMA,
  INSPECTION_SCHEMA,
  LEGACY_STATE_SCHEMA,
  STATE_SCHEMA,
  TRANSITION_SCHEMA,
  createOptimizationState,
  decideFeatureRoute,
  evaluateExecutionChainBenchmark,
  inspectExecutionOptimization,
  migrateLegacyState,
  normalizeFeatureId,
  normalizeModeValue,
  normalizeOptimizationState,
  persistOptimizationState,
  readOptimizationState,
  resolveExecutionFeatureDecisionForCwd,
  resolveExecutionOptimizationMode,
  resolveProfileConfigRecords,
  summarizeMetric,
  transitionFeature,
  validateOptimizationState
}
