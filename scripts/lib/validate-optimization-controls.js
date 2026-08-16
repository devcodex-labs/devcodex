'use strict'

const { buildPortfolio, serializePortfolio, validatePortfolio } = require('./skill-portfolio-utils')
const { buildRuntimeStateIndex } = require('./runtime-state-index')

function buildOptimizationControlChecks(ctx) {
  const { ROOT, ACTIVE_DEVCODEX_ROOT, fs, path, read, err, console } = ctx
  const logicalExists = file => typeof read.exists === 'function' ? read.exists(file) : fs.existsSync(file)

  function requireFile(relative) {
    if (!logicalExists(path.join(ROOT, relative))) err(`[V92] missing required artifact: ${relative}`)
  }

  function checkV92() {
    const required = [
      '.github/workflows/ci.yml',
      'scripts/lib/checked-command.js',
      'hooks/_runtime/stdio-bounds.cjs',
      'mcp/stdio-jsonrpc.cjs',
      'scripts/test-mcp-stdio-transport.js',
      'scripts/critical-risk-coverage.json',
      'scripts/check-critical-risk-coverage.js',
      'scripts/lib/security-audit-runner.js',
      'scripts/test-security-audit-runner.js',
      'scripts/validation-manifest.json',
      'scripts/lib/validation-dag.js',
      'scripts/run-validation.js',
      'scripts/test-validation-dag.js',
      'mcp/profile-section-selector.cjs',
      'scripts/test-profile-section-selector.js',
      'scripts/lib/project-knowledge-store.js',
      'scripts/project-analysis-state.js',
      'scripts/test-project-knowledge-store.js',
      'scripts/test-project-knowledge-v2.js',
      'scripts/test-execution-attempt-ledger.js',
      'scripts/publish-dry-run.js',
      'scripts/lib/skill-portfolio-utils.js',
      'scripts/generate-skill-portfolio.js',
      'skills/portfolio-evidence.json',
      'skills/portfolio.json',
      'scripts/lib/runtime-state-index.js',
      'scripts/check-runtime-state.js',
      'scripts/lib/deployment-manifest-utils.js',
      'scripts/test-deployment-manifest.js',
      'skills/host-instruction-projection/SKILL.md',
      'scripts/host-instruction-projection.json',
      'scripts/lib/host-instruction-projection.js',
      'scripts/lib/host-surface-descriptors.js',
      'scripts/generate-host-instruction-projections.js',
      'scripts/test-host-instruction-projection.js',
      'scripts/test-host-adapters.js',
      'scripts/test-host-installation.js',
      'scripts/test-context-binding.js',
      'host-projections/coverage.json',
      'gemini/settings.json',
      'grok/hooks/devcodex.json'
    ]
    required.forEach(requireFile)

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    if (pkg.name !== 'devcodex' || pkg.publishConfig?.registry !== 'https://registry.npmjs.org/' || pkg.publishConfig?.access !== 'public') {
      err('[V92] npmjs public publishConfig candidate is not canonical')
    }
    for (const script of [
      'test:optimization-controls',
      'test:profile-section-selector',
      'test:project-knowledge',
      'test:project-knowledge-v2',
      'test:execution-attempt-ledger',
      'test:validation-dag',
      'test:changed',
      'test:profile-deploy',
      'test:package-release',
      'test:skill-portfolio:staged',
      'test:host-instruction-projection',
      'test:host-adapters',
      'test:host-installation',
      'test:context-binding',
      'test:coverage',
      'test:mcp-stdio',
      'test:critical-risk-coverage',
      'test:audit-runner',
      'release:dry-run:npmjs',
      'release:dry-run:github'
    ]) {
      if (!pkg.scripts?.[script]) err(`[V92] missing package script: ${script}`)
    }
    if (pkg.scripts?.test !== 'node scripts/run-validation.js --route full' ||
        pkg.scripts?.['test:fast'] !== 'node scripts/run-validation.js --route fast' ||
        pkg.scripts?.['test:full'] !== 'node scripts/run-validation.js --route full') {
      err('[V92] stable test entry points must route through the canonical validation manifest')
    }
    if (pkg.scripts?.['test:skill-portfolio:staged'] !== 'node scripts/generate-skill-portfolio.js --check-staged') {
      err('[V92] staged Skill portfolio command must target the Git index candidate')
    }
    const validationManifest = JSON.parse(read(path.join(ROOT, 'scripts/validation-manifest.json')))
    const portfolioInputGlobs = ['**/*.md', '**/*.js', '**/*.cjs', '**/*.json', '**/*.ts', '**/*.yml', '**/*.yaml']
    for (const nodeId of ['skill-portfolio', 'skill-portfolio-current']) {
      const node = validationManifest.nodes?.find(item => item.id === nodeId)
      for (const input of portfolioInputGlobs) {
        if (!node?.inputs?.includes(input)) err(`[V92] ${nodeId} missing tracked consumer input: ${input}`)
      }
    }
    const globalHostRemovalNode = validationManifest.nodes?.find(item => item.id === 'global-host-removal')
    if (!globalHostRemovalNode || Number(globalHostRemovalNode.timeoutMs) < 600000) {
      err('[V92] global-host-removal timeout must cover the measured Windows six-host removal matrix')
    }
    const requiredPackageFiles = [
      'scripts/validation-manifest.json',
      'scripts/run-validation.js',
      'scripts/test-validation-dag.js',
      'scripts/test-profile-section-selector.js',
      'scripts/project-analysis-state.js',
      'scripts/test-project-knowledge-store.js',
      'scripts/test-project-knowledge-v2.js',
      'scripts/test-execution-attempt-ledger.js',
      'scripts/test-context-binding.js',
      'scripts/test-host-adapters.js',
      'scripts/test-host-installation.js',
      'scripts/test-host-instruction-projection.js',
      'scripts/lib/project-knowledge-store.js',
      'scripts/lib/validation-dag.js',
      'scripts/lib/host-instruction-projection.js',
      'scripts/lib/host-surface-descriptors.js',
      'scripts/test-mcp-stdio-transport.js',
      'scripts/critical-risk-coverage.json',
      'scripts/check-critical-risk-coverage.js',
      'scripts/lib/security-audit-runner.js',
      'scripts/test-security-audit-runner.js'
    ]
    for (const relative of requiredPackageFiles) {
      if (!pkg.files?.includes(relative)) err(`[V92] package files missing validation DAG consumer: ${relative}`)
    }
    const profileContract = read(path.join(ROOT, 'mcp/profile-server.js'))
    for (const needle of ['profile_skill_plan', 'sectionSelectors', 'ProfileLoadReceiptV3', 'BundleDecisionV2']) {
      if (!profileContract.includes(needle)) err(`[V92] Profile/Skill progressive-load contract missing: ${needle}`)
    }
    const profileSelector = read(path.join(ROOT, 'mcp/profile-section-selector.cjs'))
    for (const needle of ['ProfileSectionSelectorV1', 'ProfileSectionLoadReceiptV1', 'fallback-full']) {
      if (!profileSelector.includes(needle)) err(`[V92] Profile section selector Owner missing: ${needle}`)
    }
    const lifecycleSkill = read(path.join(ROOT, 'content/skills/skill-lifecycle-governance/SKILL.md'))
    for (const needle of ['BundleDecisionV2', 'sourceBytes', 'full-skill-read', 'PostStageDerivedArtifactFreshnessGate', '--check-staged', 'consumerInventoryDigest']) {
      if (!lifecycleSkill.includes(needle)) err(`[V92] Skill lifecycle V2 consumer missing: ${needle}`)
    }
    const knowledgeStore = read(path.join(ROOT, 'scripts/lib/project-knowledge-store.js'))
    for (const needle of ['ProjectKnowledgeSnapshotV2', 'FileKnowledgeRecordV2', 'SemanticClaimV1', 'ProjectKnowledgeBindingV1', 'IncrementalAnalysisPlanV2', 'IncrementalAnalysisReceiptV2', 'selectDeterministicReuseSample', 'observeProjectKnowledge', 'bootstrapProjectKnowledge', 'persistAcceptedKnowledge', 'KNOWLEDGE_V1_READ_ONLY']) {
      if (!knowledgeStore.includes(needle)) err(`[V92] ProjectKnowledge runtime missing: ${needle}`)
    }
    const analysisOwner = read(path.join(ROOT, 'content/skills/incremental-project-analysis/SKILL.md'))
    for (const needle of ['project-analysis-state.js status|plan|observe|bootstrap|accept', '5%', 'full-required', 'BatchValidationResultV1=pass', 'SemanticClaimV1', 'V1 只读兼容']) {
      if (!analysisOwner.includes(needle)) err(`[V92] incremental analysis consumer missing: ${needle}`)
    }
    if (pkg.devDependencies?.c8 !== '10.1.3') err('[V92] c8 must stay pinned to Node18-compatible 10.1.3')

    const workflow = read(path.join(ROOT, '.github/workflows/ci.yml'))
    for (const needle of ['18.17.0', '22.x', '24.17.0', '26.x', 'windows-latest', 'test:supported-runtime-control-plane', 'test:windows-control-plane', 'Package boundary', 'test:coverage', 'release:dry-run:all']) {
      if (!workflow.includes(needle)) err(`[V92] CI matrix missing: ${needle}`)
    }
    if (workflow.includes('Website and package')) err('[V92] public CI must not claim a website build that can be conditionally absent')

    const publishDryRun = read(path.join(ROOT, 'scripts/publish-dry-run.js'))
    for (const needle of ['packageScope', 'supportedTargets', 'createCandidateTarball', 'buildPublishArgs', 'packageArtifact', 'REGISTRY_TARGET_UNSUPPORTED', '--${scope}:registry=${target.registry}', 'require.main === module']) {
      if (!publishDryRun.includes(needle)) err(`[V92] scoped registry resolution missing: ${needle}`)
    }
    if (publishDryRun.includes("'--ignore-scripts'")) err('[V92] registry dry-run must use the native candidate tarball rather than metadata-only pack semantics')
    const stdioTransport = read(path.join(ROOT, 'mcp/stdio-jsonrpc.cjs'))
    for (const needle of ['MCP_STDIO_FRAME_TOO_LARGE', 'MCP_STDIO_MESSAGE_TOO_LARGE', 'MCP_STDIO_REQUEST_TIMEOUT', 'discardingOversizeFrame']) {
      if (!stdioTransport.includes(needle)) err(`[V92] bounded MCP stdio contract missing: ${needle}`)
    }
    const hostAdapter = read(path.join(ROOT, 'hooks/_runtime/lifecycle-host-adapters.cjs'))
    for (const needle of ['STDIO_CHILD_TIMEOUT_MS', 'HOST_LIFECYCLE_TIMEOUT', 'HOST_ADAPTER_INPUT_TOO_LARGE']) {
      if (!hostAdapter.includes(needle)) err(`[V92] bounded host adapter contract missing: ${needle}`)
    }
    const securityRunner = read(path.join(ROOT, 'scripts/lib/security-audit-runner.js'))
    for (const needle of ['maxAttempts', 'inconsistent-empty-advisories', 'SECURITY_AUDIT_RECHECK_EXHAUSTED', 'rawStdout']) {
      if (!securityRunner.includes(needle)) err(`[V92] bounded security audit recheck missing: ${needle}`)
    }
    const scopedRegistryConsumers = [
      'skills/release-verification/SKILL.md',
      'skills/audit-release/SKILL.md',
      'skills/test-router/SKILL.md',
      'skills/report/SKILL.md',
      'skills/document-sync/SKILL.md',
      'skills/spec-governance/SKILL.md',
      'skills/source-consumer-sync/SKILL.md',
      'prompts/report-audit.prompt.md',
      'prompts/implementation-plan.prompt.md',
      'README.md',
      'website/docs/guide/release.md',
      'changelogs/releases/v1.13.0.md'
    ]
    for (const relative of scopedRegistryConsumers) {
      if (!read(path.join(ROOT, relative)).includes('ScopedRegistryResolutionGate')) {
        err(`[V92] ScopedRegistryResolutionGate consumer missing: ${relative}`)
      }
    }

    const portfolio = buildPortfolio(ROOT)
    const portfolioErrors = validatePortfolio(portfolio)
    if (portfolio.summary.skillCount !== 86) err(`[V92] expected 86 skills, got ${portfolio.summary.skillCount}`)
    if (portfolio.summary.graySkillCount !== 3) err(`[V92] expected three gray skills, got ${portfolio.summary.graySkillCount}`)
    if (portfolio.summary.dependencyEdgeCount < 1) err('[V92] explicit Skill dependency graph has no edges')
    if (portfolio.summary.operationalEvidenceCompleteCount !== 86) err('[V92] operational lifecycle evidence is incomplete')
    if (portfolio.summary.triggerQuality !== 'mixed') err('[V92] trigger precision must reflect measured kernel samples')
    if (!Number.isInteger(portfolio.generatedFrom.consumerInventoryFileCount) || portfolio.generatedFrom.consumerInventoryFileCount < 50) {
      err('[V92] portfolio consumer inventory is missing or unexpectedly small')
    }
    for (const field of ['consumerInventoryDigest', 'consumerProjectionDigest', 'portfolioInputDigest']) {
      if (!/^[a-f0-9]{64}$/.test(String(portfolio.generatedFrom[field] || ''))) err(`[V92] portfolio missing ${field}`)
    }
    portfolioErrors.forEach(error => err(`[V92] portfolio: ${error}`))
    const committedText = String(read(path.join(ROOT, 'skills/portfolio.json')))
    if (committedText !== serializePortfolio(portfolio)) err('[V92] committed Skill portfolio is stale')

    const runtimeState = buildRuntimeStateIndex(ACTIVE_DEVCODEX_ROOT)
    if (!runtimeState.readOnlySourcePolicy || runtimeState.schemaVersion !== 1) {
      err('[V92] runtime-state index must stay schema v1 and read-only')
    }
    if (!Number.isInteger(runtimeState.summary.historicalTransitionCount) || !Number.isInteger(runtimeState.summary.consumerDriftCount)) {
      err('[V92] runtime-state index must expose transition and consumer-drift diagnostics')
    }

    const readme = read(path.join(ROOT, 'README.md'))
    for (const needle of ['5 分钟快速开始', 'npmjs', 'npm install -g devcodex', 'GitHub Packages', '历史包', '1.0.1']) {
      if (!readme.includes(needle)) err(`[V92] README product path missing: ${needle}`)
    }
    console.log(`[V92] optimization controls checked: skills=86 gray=3 runtimeAlerts=${runtimeState.summary.alertCount}`)
  }

  return { checkV92 }
}

module.exports = { buildOptimizationControlChecks }
