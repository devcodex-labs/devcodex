#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  BENCHMARK_INPUT_SCHEMA,
  ExecutionOptimizationError,
  FEATURE_DEFINITIONS,
  createOptimizationState,
  decideFeatureRoute,
  evaluateExecutionChainBenchmark,
  inspectExecutionOptimization,
  migrateLegacyState,
  normalizeModeValue,
  normalizeOptimizationState,
  persistOptimizationState,
  readOptimizationState,
  resolveExecutionFeatureDecisionForCwd,
  resolveExecutionOptimizationMode,
  transitionFeature,
  validateOptimizationState
} = require('./lib/execution-optimization')

const ROOT = path.resolve(__dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-execution-evolution-'))

const initial = createOptimizationState({ defaultState: 'off', updatedAt: '2026-07-19T00:00:00.000Z' })
assert.strictEqual(validateOptimizationState(initial), true)
assert.strictEqual(normalizeModeValue(undefined).effective, 'safe-auto')
assert.strictEqual(normalizeModeValue('full-only').effective, 'full-only')
assert.strictEqual(normalizeModeValue('future-auto').effective, 'full-only')
assert.strictEqual(normalizeModeValue('future-auto').status, 'fail-closed')

const modeFromLayers = resolveExecutionOptimizationMode([
  { filePath: 'base', status: 'loaded', value: { extensions: { devcodex: { executionOptimization: { mode: 'full-only' } } } } },
  { filePath: 'overlay', status: 'loaded', value: { extensions: { devcodex: { executionOptimization: { mode: 'safe-auto' } } } } }
])
assert.strictEqual(modeFromLayers.effective, 'safe-auto')
assert.strictEqual(modeFromLayers.sourcePath, 'overlay')
assert.strictEqual(resolveExecutionOptimizationMode([{ filePath: 'bad', status: 'invalid', error: 'bad json' }]).effective, 'full-only')

const legacy = migrateLegacyState({
  schemaVersion: 'ExecutionOptimizationStateV1',
  mode: 'auto',
  features: { taskIndex: 'enabled', 'context-cache': 'rollback', 'skill-bundle-v1': 'disabled' }
})
assert.strictEqual(legacy.migration.status, 'read-only-migrated')
assert.strictEqual(legacy.state.features.find(item => item.featureId === 'task-index-acceleration').lifecycleState, 'trial')
assert.strictEqual(legacy.state.features.find(item => item.featureId === 'context-computation-reuse').lifecycleState, 'rolled-back')
assert.throws(
  () => normalizeOptimizationState({ schemaVersion: 'ExecutionOptimizationStateV99' }),
  error => error instanceof ExecutionOptimizationError && error.code === 'EXECUTION_OPTIMIZATION_SCHEMA_UNSUPPORTED'
)

let transition = transitionFeature(initial, 'task-index', 'shadow', { evidence: ['shadow-plan'] })
assert.strictEqual(transition.receipt.to, 'shadow')
transition = transitionFeature(transition.state, 'task-index-acceleration', 'start-trial', {
  baselineComparable: true,
  prospectiveTrialPlanned: true,
  evidence: ['trial-window']
})
assert.strictEqual(transition.receipt.to, 'trial')
const insufficient = transitionFeature(transition.state, 'task-index-acceleration', 'promote', {
  prospectiveWorkUnits: 2,
  correctness: { wrongTask: 0, wrongRoot: 0, wrongCp: 0 },
  directBenefitRatio: 0.4,
  fullFallbackRegression: 0,
  instrumentationOverhead: 0
})
assert.strictEqual(insufficient.receipt.promotionAllowed, false)
assert.strictEqual(insufficient.receipt.to, 'trial')
const promoted = transitionFeature(transition.state, 'task-index-acceleration', 'promote', {
  prospectiveWorkUnits: 3,
  correctness: { wrongTask: 0, wrongRoot: 0, wrongCp: 0 },
  directBenefitRatio: 0.4,
  fullFallbackRegression: 0.02,
  instrumentationOverhead: 0.01,
  falsePositiveRate: 0
})
assert.strictEqual(promoted.receipt.promotionAllowed, true)
assert.strictEqual(promoted.receipt.to, 'default')

const harmful = transitionFeature(transition.state, 'task-index-acceleration', 'promote', {
  prospectiveWorkUnits: 3,
  correctness: { wrongTask: 1 },
  directBenefitRatio: 0.9,
  fullFallbackRegression: 0,
  instrumentationOverhead: 0
})
assert.strictEqual(harmful.receipt.verdict, 'harmful')
assert.strictEqual(harmful.receipt.to, 'rolled-back')
assert.strictEqual(decideFeatureRoute({ mode: 'safe-auto', state: harmful.state, featureId: 'task-index' }).route, 'bounded-direct')
assert.strictEqual(decideFeatureRoute({ mode: 'full-only', state: promoted.state, featureId: 'validation-changed' }).route, 'direct-validation-plan')

const sunset = transitionFeature(harmful.state, 'task-index-acceleration', 'sunset', { releaseCandidatesWithoutBenefit: 2 })
assert.strictEqual(sunset.receipt.to, 'sunset')
assert.strictEqual(sunset.receipt.promotionAllowed, false)

const persisted = persistOptimizationState(tempRoot, promoted.state)
assert.strictEqual(persisted.status, 'persisted')
const readBack = readOptimizationState(tempRoot)
assert.strictEqual(readBack.status, 'fresh')
assert.strictEqual(readBack.state.stateIdentity.digest, promoted.state.stateIdentity.digest)
const capacityBypass = persistOptimizationState(path.join(tempRoot, 'tiny'), promoted.state, { maxBytes: 64 })
assert.strictEqual(capacityBypass.status, 'bypassed')
assert.strictEqual(capacityBypass.errorCode, 'DERIVED_STATE_CAPACITY_EXCEEDED')

const lifecycleRoot = path.join(tempRoot, 'lifecycle-consumer')
const rolledBackState = createOptimizationState({
  featureStates: Object.fromEntries(FEATURE_DEFINITIONS.map(feature => [feature.id, 'rolled-back']))
})
assert.strictEqual(persistOptimizationState(lifecycleRoot, rolledBackState).status, 'persisted')
for (const feature of FEATURE_DEFINITIONS) {
  const decision = resolveExecutionFeatureDecisionForCwd({
    cwd: ROOT,
    activeRoot: lifecycleRoot,
    mode: 'safe-auto',
    featureId: feature.id
  })
  assert.strictEqual(decision.optimizationAllowed, false, feature.id)
  assert.strictEqual(decision.lifecycleState, 'rolled-back', feature.id)
  assert.strictEqual(decision.route, feature.fullRoute, feature.id)
  assert.strictEqual(decision.reasonCode, 'feature-rolled-back', feature.id)
}
const missingStateDecision = resolveExecutionFeatureDecisionForCwd({
  cwd: ROOT,
  activeRoot: path.join(tempRoot, 'missing-lifecycle-state'),
  mode: 'safe-auto',
  featureId: 'task-index-acceleration'
})
assert.strictEqual(missingStateDecision.stateStatus, 'missing')
assert.strictEqual(missingStateDecision.optimizationAllowed, true)
const failClosedBindingDecision = resolveExecutionFeatureDecisionForCwd({
  cwd: ROOT,
  activeRoot: path.join(tempRoot, 'missing-lifecycle-state'),
  modeDecision: { effective: 'safe-auto', status: 'fail-closed', errorCode: 'FIXTURE_BINDING_ERROR' },
  state: null,
  featureId: 'profile-section-load'
})
assert.strictEqual(failClosedBindingDecision.configurationMode, 'full-only')
assert.strictEqual(failClosedBindingDecision.optimizationAllowed, false)

const invalidRoot = path.join(tempRoot, 'invalid-lifecycle-state')
const invalidPath = path.join(invalidRoot, '.runtime-state', 'execution-optimization', 'v2', 'state.json')
fs.mkdirSync(path.dirname(invalidPath), { recursive: true })
fs.writeFileSync(invalidPath, '{"schemaVersion":"ExecutionOptimizationStateV99"}\n', 'utf8')
const invalidStateDecision = resolveExecutionFeatureDecisionForCwd({
  cwd: ROOT,
  activeRoot: invalidRoot,
  mode: 'safe-auto',
  featureId: 'skill-bundle'
})
assert.strictEqual(invalidStateDecision.stateStatus, 'invalid')
assert.strictEqual(invalidStateDecision.optimizationAllowed, false)
assert.strictEqual(invalidStateDecision.reasonCode, 'execution-optimization-state-invalid')

const fullOnlyInspection = inspectExecutionOptimization(ROOT, {
  activeRoot: path.join(tempRoot, 'inspect'),
  configRecords: [{ filePath: 'fixture', status: 'loaded', value: { extensions: { devcodex: { executionOptimization: { mode: 'full-only' } } } } }],
  state: promoted.state
})
assert.strictEqual(fullOnlyInspection.config.effective, 'full-only')
assert(fullOnlyInspection.features.every(item => item.decision.optimizationAllowed === false))
assert.deepStrictEqual(fullOnlyInspection.writes, [])
const stateModeInspection = inspectExecutionOptimization(ROOT, {
  activeRoot: path.join(tempRoot, 'inspect-state-mode'),
  configRecords: [],
  state: createOptimizationState({ mode: 'full-only' })
})
assert(stateModeInspection.features.every(item => item.decision.optimizationAllowed === false))
const invalidInspection = inspectExecutionOptimization(ROOT, {
  activeRoot: path.join(tempRoot, 'inspect-invalid'),
  configRecords: [],
  state: { schemaVersion: 'ExecutionOptimizationStateV99' }
})
assert.strictEqual(invalidInspection.stateStatus, 'invalid')
assert(invalidInspection.features.every(item => item.decision.optimizationAllowed === false))

function benchmarkInput(candidateScale = 0.5, correctness = { wrongTaskRootCp: 0, falseComplete: 0, requiredMiss: 0 }) {
  const metric = (unit, values) => ({ unit, samples: values, minimumSamples: 3 })
  return {
    schemaVersion: BENCHMARK_INPUT_SCHEMA,
    candidateId: 'fixture-candidate',
    environment: { baselineKey: 'node20-win-fixture', candidateKey: 'node20-win-fixture' },
    baseline: {
      validationWallTime: metric('ms', [100, 101, 99]),
      contextDeliveredBytes: metric('bytes', [1000, 1000, 1000]),
      analysisRecomputeWork: metric('files', [100, 100, 100]),
      resumeSetupCost: metric('ms', [40, 41, 39])
    },
    candidate: {
      validationWallTime: metric('ms', [100 * candidateScale, 101 * candidateScale, 99 * candidateScale]),
      contextDeliveredBytes: metric('bytes', [1000 * candidateScale, 1000 * candidateScale, 1000 * candidateScale]),
      analysisRecomputeWork: metric('files', [100 * candidateScale, 100 * candidateScale, 100 * candidateScale]),
      resumeSetupCost: metric('ms', [40 * candidateScale, 41 * candidateScale, 39 * candidateScale])
    },
    correctness,
    instrumentationOverhead: 0.01
  }
}

const acceptedBenchmark = evaluateExecutionChainBenchmark(benchmarkInput())
assert.strictEqual(acceptedBenchmark.status, 'accepted')
assert.strictEqual(acceptedBenchmark.promotionAllowed, true)
assert.strictEqual(acceptedBenchmark.improvedDimensions, 4)
const rejectedBenchmark = evaluateExecutionChainBenchmark(benchmarkInput(0.5, { wrongTaskRootCp: 1, falseComplete: 0, requiredMiss: 0 }))
assert.strictEqual(rejectedBenchmark.status, 'rejected')
assert.strictEqual(rejectedBenchmark.promotionAllowed, false)
const provisionalInput = benchmarkInput()
provisionalInput.candidate.validationWallTime.samples = [50]
assert.strictEqual(evaluateExecutionChainBenchmark(provisionalInput).status, 'provisional')

const inputPath = path.join(tempRoot, 'benchmark-input.json')
fs.writeFileSync(inputPath, JSON.stringify(benchmarkInput(), null, 2) + '\n')
const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'benchmark-execution-chain.js'), '--input', inputPath, '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true
})
assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout)
const cliResult = JSON.parse(cli.stdout)
assert.strictEqual(cliResult.schemaVersion, 'ExecutionChainBenchmarkCliV1')
assert.strictEqual(cliResult.data.status, 'accepted')

const validationCli = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'run-validation.js'),
  '--route', 'changed',
  '--changed', 'README.md',
  '--plan',
  '--json'
], {
  cwd: ROOT,
  env: { ...process.env, DEVCODEX_VALIDATION_ACTIVE_ROOT: lifecycleRoot },
  encoding: 'utf8',
  windowsHide: true
})
assert.strictEqual(validationCli.status, 0, validationCli.stderr || validationCli.stdout)
const validationResult = JSON.parse(validationCli.stdout)
assert.strictEqual(validationResult.data.plan.executionOptimization.routeApplied, 'changed')
assert.strictEqual(validationResult.data.plan.executionOptimization.reasonCode, 'feature-rolled-back')
assert.strictEqual(validationResult.data.plan.executionOptimization.fallback, null)
assert.strictEqual(validationResult.data.plan.executionOptimization.precisionStatus, 'explicit-route-retained-cache-disabled')

const consumerRepo = path.join(tempRoot, 'consumer-repo')
fs.mkdirSync(path.join(consumerRepo, '.devcodex'), { recursive: true })
fs.writeFileSync(path.join(consumerRepo, 'package.json'), '{"name":"execution-consumer-fixture","version":"1.0.0"}\n', 'utf8')
fs.writeFileSync(path.join(consumerRepo, 'index.js'), "module.exports = 'fixture'\n", 'utf8')
assert.strictEqual(persistOptimizationState(path.join(consumerRepo, '.devcodex'), rolledBackState).status, 'persisted')
const projectAnalysisCli = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'project-analysis-state.js'),
  'plan',
  '--repo', consumerRepo,
  '--active-root', path.join(consumerRepo, '.devcodex'),
  '--json'
], { cwd: consumerRepo, encoding: 'utf8', windowsHide: true })
assert.strictEqual(projectAnalysisCli.status, 0, projectAnalysisCli.stderr || projectAnalysisCli.stdout)
const projectAnalysisResult = JSON.parse(projectAnalysisCli.stdout)
assert.strictEqual(projectAnalysisResult.data.executionOptimization.optimizationAllowed, false)
assert.strictEqual(projectAnalysisResult.data.executionOptimization.reasonCode, 'feature-rolled-back')

const skillCli = spawnSync(process.execPath, [path.join(ROOT, 'index.js'), 'skill', 'plan', 'intent', '--json'], {
  cwd: consumerRepo,
  encoding: 'utf8',
  windowsHide: true
})
assert.strictEqual(skillCli.status, 0, skillCli.stderr || skillCli.stdout)
const skillResult = JSON.parse(skillCli.stdout)
assert.strictEqual(skillResult.payload.completion, 'fallback-full')
assert.strictEqual(skillResult.payload.executionOptimization.optimizationAllowed, false)
assert.strictEqual(skillResult.payload.executionOptimization.reasonCode, 'feature-rolled-back')

fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('execution-chain evolution tests passed: V1→V2/alias/shadow/trial/promotion/rollback/full-only/sunset/budget/benchmark closed')
