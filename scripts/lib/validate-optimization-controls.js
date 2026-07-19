'use strict'

const { buildPortfolio, serializePortfolio, validatePortfolio } = require('./skill-portfolio-utils')
const { buildRuntimeStateIndex } = require('./runtime-state-index')

function buildOptimizationControlChecks(ctx) {
  const { ROOT, ACTIVE_DEVCODEX_ROOT, fs, path, read, err, console } = ctx

  function requireFile(relative) {
    if (!fs.existsSync(path.join(ROOT, relative))) err(`[V92] missing required artifact: ${relative}`)
  }

  function checkV92() {
    const required = [
      '.github/workflows/ci.yml',
      'scripts/lib/checked-command.js',
      'scripts/validation-manifest.json',
      'scripts/lib/validation-dag.js',
      'scripts/run-validation.js',
      'scripts/test-validation-dag.js',
      'mcp/profile-section-selector.cjs',
      'scripts/test-profile-section-selector.js',
      'scripts/lib/project-knowledge-store.js',
      'scripts/project-analysis-state.js',
      'scripts/test-project-knowledge-store.js',
      'scripts/test-execution-attempt-ledger.js',
      'scripts/publish-dry-run.js',
      'scripts/lib/skill-portfolio-utils.js',
      'scripts/generate-skill-portfolio.js',
      'skills/portfolio-evidence.json',
      'skills/portfolio.json',
      'scripts/lib/runtime-state-index.js',
      'scripts/check-runtime-state.js',
      'scripts/lib/deployment-manifest-utils.js',
      'scripts/test-deployment-manifest.js'
    ]
    required.forEach(requireFile)

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    if (pkg.publishConfig?.registry !== 'https://npm.pkg.github.com/' || pkg.publishConfig?.access !== 'restricted') {
      err('[V92] GitHub Packages publishConfig candidate is not canonical')
    }
    for (const script of [
      'test:optimization-controls',
      'test:profile-section-selector',
      'test:project-knowledge',
      'test:execution-attempt-ledger',
      'test:validation-dag',
      'test:changed',
      'test:profile-deploy',
      'test:package-release',
      'test:skill-portfolio:staged',
      'test:coverage',
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
    const requiredPackageFiles = [
      'scripts/validation-manifest.json',
      'scripts/run-validation.js',
      'scripts/test-validation-dag.js',
      'scripts/test-profile-section-selector.js',
      'scripts/project-analysis-state.js',
      'scripts/test-project-knowledge-store.js',
      'scripts/test-execution-attempt-ledger.js',
      'scripts/lib/project-knowledge-store.js',
      'scripts/lib/validation-dag.js'
    ]
    for (const relative of requiredPackageFiles) {
      if (!pkg.files?.includes(relative)) err(`[V92] package files missing validation DAG consumer: ${relative}`)
    }
    const profileContract = read(path.join(ROOT, 'mcp/profile-server.js'))
    for (const needle of ['profile_skill_plan', 'sectionSelectors', 'ProfileLoadReceiptV2', 'BundleDecisionV2']) {
      if (!profileContract.includes(needle)) err(`[V92] Profile/Skill progressive-load contract missing: ${needle}`)
    }
    const profileSelector = read(path.join(ROOT, 'mcp/profile-section-selector.cjs'))
    for (const needle of ['ProfileSectionSelectorV1', 'ProfileSectionLoadReceiptV1', 'fallback-full']) {
      if (!profileSelector.includes(needle)) err(`[V92] Profile section selector Owner missing: ${needle}`)
    }
    const lifecycleSkill = read(path.join(ROOT, 'skills/skill-lifecycle-governance/SKILL.md'))
    for (const needle of ['BundleDecisionV2', 'sourceBytes', 'full-skill-read', 'PostStageDerivedArtifactFreshnessGate', '--check-staged', 'consumerInventoryDigest']) {
      if (!lifecycleSkill.includes(needle)) err(`[V92] Skill lifecycle V2 consumer missing: ${needle}`)
    }
    const knowledgeStore = read(path.join(ROOT, 'scripts/lib/project-knowledge-store.js'))
    for (const needle of ['ProjectKnowledgeSnapshotV1', 'IncrementalAnalysisPlanV1', 'IncrementalAnalysisReceiptV1', 'selectDeterministicReuseSample', 'persistAcceptedKnowledge']) {
      if (!knowledgeStore.includes(needle)) err(`[V92] ProjectKnowledge runtime missing: ${needle}`)
    }
    const analysisOwner = read(path.join(ROOT, 'skills/incremental-project-analysis/SKILL.md'))
    for (const needle of ['project-analysis-state.js status|plan|accept', '5%', 'full-required', 'BatchValidationResultV1=pass']) {
      if (!analysisOwner.includes(needle)) err(`[V92] incremental analysis consumer missing: ${needle}`)
    }
    if (pkg.devDependencies?.c8 !== '10.1.3') err('[V92] c8 must stay pinned to Node18-compatible 10.1.3')

    const workflow = read(path.join(ROOT, '.github/workflows/ci.yml'))
    for (const needle of ['18.x', '20.x', '22.x', 'windows-latest', 'test:coverage', 'release:dry-run:all']) {
      if (!workflow.includes(needle)) err(`[V92] CI matrix missing: ${needle}`)
    }

    const publishDryRun = read(path.join(ROOT, 'scripts/publish-dry-run.js'))
    for (const needle of ['packageScope', 'buildPublishArgs', '--${scope}:registry=${target.registry}', 'require.main === module']) {
      if (!publishDryRun.includes(needle)) err(`[V92] scoped registry resolution missing: ${needle}`)
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
    if (portfolio.summary.skillCount !== 78) err(`[V92] expected 78 skills, got ${portfolio.summary.skillCount}`)
    if (portfolio.summary.graySkillCount !== 3) err(`[V92] expected three gray skills, got ${portfolio.summary.graySkillCount}`)
    if (portfolio.summary.dependencyEdgeCount < 1) err('[V92] explicit Skill dependency graph has no edges')
    if (portfolio.summary.operationalEvidenceCompleteCount !== 78) err('[V92] operational lifecycle evidence is incomplete')
    if (portfolio.summary.triggerQuality !== 'structural-only') err('[V92] trigger precision must remain structural-only without real samples')
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
    for (const needle of ['5 分钟快速开始', 'GitHub Packages', 'npm.pkg.github.com', 'NODE_AUTH_TOKEN', 'read:packages', '当前唯一发布通道', '1.0.1']) {
      if (!readme.includes(needle)) err(`[V92] README product path missing: ${needle}`)
    }
    console.log(`[V92] optimization controls checked: skills=78 gray=3 runtimeAlerts=${runtimeState.summary.alertCount}`)
  }

  return { checkV92 }
}

module.exports = { buildOptimizationControlChecks }
