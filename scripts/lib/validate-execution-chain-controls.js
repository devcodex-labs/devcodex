'use strict'

const { evaluatePublicReadmeContract } = require('./canonical-consumer-contracts')

const EXPECTED_FEATURE_ROUTES = Object.freeze({
  'task-index-acceleration': 'bounded-direct',
  'context-computation-reuse': 'full-context-read',
  'validation-changed-scope': 'full-validation',
  'profile-section-load': 'full-profile-file',
  'skill-bundle': 'full-skill-read',
  'project-knowledge-reuse': 'full-project-analysis'
})

function buildExecutionChainControlChecks(ctx) {
  const {
    ROOT, ACTIVE_DEVCODEX_ROOT, fs, path, read, err, console,
    loadExecutionOptimization = () => require('./execution-optimization')
  } = ctx

  function requireFile(relative) {
    const full = path.join(ROOT, relative)
    if (!fs.existsSync(full)) err(`[V101] missing execution-chain artifact: ${relative}`)
    return full
  }

  function assertAnchors(relative, anchors, label = 'consumer') {
    const full = requireFile(relative)
    if (!fs.existsSync(full)) return
    const content = read(full)
    if (relative === 'README.md' && evaluatePublicReadmeContract(content).valid) return
    for (const anchor of anchors) {
      if (!content.includes(anchor)) err(`[V101] ${label} ${relative} missing anchor: ${anchor}`)
    }
  }

  function checkRuntimeContract() {
    let runtime
    try {
      runtime = loadExecutionOptimization()
    } catch (error) {
      err(`[V101] execution optimization runtime cannot load: ${error.message}`)
      return
    }
    const featureIds = runtime.FEATURE_DEFINITIONS.map(item => item.id).sort()
    const expectedIds = Object.keys(EXPECTED_FEATURE_ROUTES).sort()
    if (JSON.stringify(featureIds) !== JSON.stringify(expectedIds)) {
      err(`[V101] controlled feature set drifted: ${featureIds.join(', ')}`)
      return
    }

    const trialState = runtime.createOptimizationState({ defaultState: 'trial' })
    if (!runtime.validateOptimizationState(trialState) || trialState.schemaVersion !== 'ExecutionOptimizationStateV2') {
      err('[V101] current optimization state is not identity-valid V2')
      return
    }
    for (const featureId of expectedIds) {
      const decision = runtime.decideFeatureRoute({ mode: 'full-only', state: trialState, featureId })
      if (decision.optimizationAllowed || decision.route !== EXPECTED_FEATURE_ROUTES[featureId]) {
        err(`[V101] full-only route is not fail-closed for ${featureId}`)
      }
    }
    if (runtime.normalizeModeValue('future-mode').effective !== 'full-only') {
      err('[V101] unknown execution optimization mode must fail closed to full-only')
    }
    try {
      const harmful = runtime.transitionFeature(trialState, 'task-index-acceleration', 'promote', {
        prospectiveWorkUnits: 3,
        correctness: { wrongTaskRootCp: 1, falseComplete: 0 },
        directBenefitRatio: 0.8,
        fullFallbackRegression: 0,
        instrumentationOverhead: 0
      })
      if (harmful.receipt.promotionAllowed || harmful.receipt.to !== 'rolled-back') {
        err('[V101] harmful prospective candidate escaped automatic rollback')
      }
    } catch (error) {
      err(`[V101] harmful-candidate fixture failed: ${error.message}`)
    }
  }

  function checkPackageAndManifest() {
    let pkg
    let manifest
    try {
      pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
      manifest = JSON.parse(read(path.join(ROOT, 'scripts', 'validation-manifest.json')))
    } catch (error) {
      err(`[V101] package/manifest JSON cannot be parsed: ${error.message}`)
      return
    }
    const expectedScripts = {
      'test:execution-chain-evolution': 'node scripts/test-execution-chain-evolution.js',
      'benchmark:execution-chain': 'node scripts/benchmark-execution-chain.js'
    }
    for (const [name, command] of Object.entries(expectedScripts)) {
      if (pkg.scripts?.[name] !== command) err(`[V101] package script drift: ${name}`)
    }
    for (const relative of [
      'scripts/lib/execution-optimization.js',
      'scripts/lib/validate-execution-chain-controls.js',
      'scripts/test-execution-chain-evolution.js',
      'scripts/benchmark-execution-chain.js'
    ]) {
      if (!pkg.files?.includes(relative)) err(`[V101] package files missing: ${relative}`)
    }
    if (!pkg.files?.includes('hooks/')) err('[V101] package files omit hook runtime consumers')
    if (!pkg.scripts?.['test:optimization-controls']?.includes('test:execution-chain-evolution')) {
      err('[V101] optimization control suite does not consume the evolution test')
    }
    for (const coverageTarget of ['scripts/lib/execution-optimization.js', 'hooks/_runtime/execution-optimization-routing.cjs']) {
      if (!pkg.scripts?.['test:coverage']?.includes(coverageTarget)) {
        err(`[V101] coverage route omits ${coverageTarget}`)
      }
    }

    const node = manifest.nodes?.find(item => item.id === 'execution-chain-evolution')
    if (!node || node.command !== 'node' || JSON.stringify(node.args) !== JSON.stringify(['scripts/test-execution-chain-evolution.js'])) {
      err('[V101] canonical validation node execution-chain-evolution is missing or malformed')
    } else {
      for (const dependency of [
        'task-continuation', 'context-read', 'validation-dag', 'profile-section-selector',
        'project-knowledge-store', 'execution-attempt-ledger'
      ]) {
        if (!node.dependencies.includes(dependency)) err(`[V101] evolution node dependency missing: ${dependency}`)
      }
    }
    for (const route of ['fast', 'full', 'profile-deploy']) {
      if (!manifest.routes?.[route]?.nodes?.includes('execution-chain-evolution')) {
        err(`[V101] ${route} route omits execution-chain-evolution`)
      }
    }
  }

  function checkConsumerClosure() {
    const sourceConsumers = [
      ['hooks/_runtime/workspace-layout.cjs', ['normalizeExecutionOptimizationMode', 'resolveExecutionOptimizationModeForCwd']],
      ['hooks/_runtime/execution-optimization-routing.cjs', ['ExecutionOptimizationFeatureDecisionV1', 'resolveExecutionFeatureDecisionForCwd', 'execution-optimization-state-invalid']],
      ['scripts/lib/execution-optimization.js', ['execution-optimization-routing.cjs', 'resolveExecutionFeatureDecisionForCwd']],
      ['hooks/_runtime/task-continuation-contract.cjs', ['resolveExecutionFeatureDecisionForCwd', 'task-index-acceleration', 'disabled-full-only']],
      ['hooks/_runtime/context-read-contract.cjs', ['ExecutionOptimizationPlanBindingV1', 'execution-optimization-full-only']],
      ['mcp/profile-server.js', ['resolveExecutionFeatureDecisionForCwd', 'context-computation-reuse', 'profile-section-load', 'skill-bundle']],
      ['scripts/run-validation.js', ['resolveExecutionFeatureDecisionForCwd', 'validation-changed-scope', 'executionOptimization']],
      ['scripts/project-analysis-state.js', ['resolveExecutionFeatureDecisionForCwd', 'project-knowledge-reuse', 'reuseAllowed']],
      ['scripts/lib/cli-maintenance-commands.js', ['inspectExecutionOptimization', 'executionOptimization']],
      ['scripts/lib/cli-execution-commands.js', ['resolveExecutionFeatureDecisionForCwd', 'skill-bundle', 'hostCapability']],
      ['scripts/benchmark-execution-chain.js', ['ExecutionChainBenchmarkCliV1', 'BENCHMARK_INPUT_SCHEMA']]
    ]
    for (const [relative, anchors] of sourceConsumers) assertAnchors(relative, anchors)

    const documentationConsumers = [
      ['instructions.md', ['ExecutionOptimizationStateV2', 'ExecutionOptimizationFeatureDecisionV1', 'safe-auto', 'full-only']],
      ['instructions/01a-profile-loading.instructions.md', ['ExecutionOptimizationPlanBindingV1', 'ExecutionOptimizationFeatureDecisionV1', 'full-only']],
      ['skills/performance-engineering/SKILL.md', ['ExecutionChainBenchmarkResultV1', 'ExecutionOptimizationFeatureDecisionV1', 'prospective trial']],
      ['skills/evolution-governance/SKILL.md', ['OptimizationFeatureStateV1', 'ExecutionOptimizationFeatureDecisionV1', 'rolled-back', 'sunset']],
      ['skills/test-router/SKILL.md', ['execution-chain-evolution', 'ExecutionOptimizationFeatureDecisionV1', 'full-only']],
      ['skills/load-profile/SKILL.md', ['ExecutionOptimizationPlanBindingV1', 'ExecutionOptimizationFeatureDecisionV1', 'full-only']],
      ['skills/skill-lifecycle-governance/SKILL.md', ['ExecutionOptimizationFeatureDecisionV1', 'full-only', 'full-skill-read']],
      ['skills/incremental-project-analysis/SKILL.md', ['ExecutionOptimizationFeatureDecisionV1', 'full-only', 'full-project-analysis']],
      ['prompts/report-optimization.prompt.md', ['ExecutionChainBenchmarkResultV1', 'ExecutionOptimizationFeatureDecisionV1', 'provisional']],
      ['prompts/implementation-progress.prompt.md', ['ExecutionOptimizationStateV2', 'ExecutionOptimizationFeatureDecisionV1', 'full-only']],
      ['README.md', ['继续<任务名>任务', 'ExecutionOptimizationFeatureDecisionV1', 'benchmark:execution-chain', 'full-only']],
      ['changelogs/unreleased.md', ['项目侧执行链性能', 'ExecutionOptimizationFeatureDecisionV1', 'V101']],
      ['website/docs/versions/v1/1.0.1/requirements/p0/project-execution-chain-performance.md', ['ExecutionOptimizationStateV2', 'ExecutionOptimizationFeatureDecisionV1', 'full-only', 'V101']]
    ]
    for (const [relative, anchors] of documentationConsumers) assertAnchors(relative, anchors, 'documentation consumer')

    const profileRoot = path.join(ACTIVE_DEVCODEX_ROOT || '', 'profile')
    if (ACTIVE_DEVCODEX_ROOT && fs.existsSync(profileRoot)) {
      const profileConsumers = [
        ['01-项目信息.md', ['executionOptimization.mode', 'ExecutionOptimizationFeatureDecisionV1', 'safe-auto']],
        ['02-架构约束.md', ['ExecutionOptimizationStateV2', 'ExecutionOptimizationFeatureDecisionV1', 'full-only']],
        ['03-代码风格.md', ['OptimizationFeatureStateV1', 'ExecutionOptimizationFeatureDecisionV1', 'fail-closed']],
        ['04-测试规范.md', ['V101', 'ExecutionOptimizationFeatureDecisionV1', 'test:execution-chain-evolution']],
        ['06-功能清单.md', ['ProjectKnowledgeSnapshotV2', 'SemanticClaimV1', 'ExecutionOptimizationStateV2', 'ExecutionOptimizationFeatureDecisionV1']],
        ['07-用户文档与契约规范.md', ['继续<任务名>任务', 'ExecutionOptimizationFeatureDecisionV1', 'benchmark:execution-chain']]
      ]
      for (const [file, anchors] of profileConsumers) {
        const full = path.join(profileRoot, file)
        if (!fs.existsSync(full)) {
          err(`[V101] active Profile consumer missing: ${file}`)
          continue
        }
        const content = read(full)
        for (const anchor of anchors) {
          if (!content.includes(anchor)) err(`[V101] active Profile ${file} missing anchor: ${anchor}`)
        }
      }
    }
  }

  function checkV101() {
    for (const relative of [
      'hooks/_runtime/execution-optimization-routing.cjs',
      'scripts/lib/execution-optimization.js',
      'scripts/benchmark-execution-chain.js',
      'scripts/test-execution-chain-evolution.js',
      'scripts/lib/validate-execution-chain-controls.js'
    ]) requireFile(relative)
    checkRuntimeContract()
    checkPackageAndManifest()
    checkConsumerClosure()
    console.log('[V101] execution-chain lifecycle / kill-switch / benchmark / consumer closure checked')
  }

  return { checkV101 }
}

module.exports = { buildExecutionChainControlChecks }
