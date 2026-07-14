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
    for (const script of ['test:optimization-controls', 'test:coverage', 'release:dry-run:npmjs', 'release:dry-run:github']) {
      if (!pkg.scripts?.[script]) err(`[V92] missing package script: ${script}`)
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
    if (portfolio.summary.skillCount !== 76) err(`[V92] expected 76 skills, got ${portfolio.summary.skillCount}`)
    if (portfolio.summary.graySkillCount !== 2) err(`[V92] expected two gray skills, got ${portfolio.summary.graySkillCount}`)
    if (portfolio.summary.dependencyEdgeCount < 1) err('[V92] explicit Skill dependency graph has no edges')
    if (portfolio.summary.operationalEvidenceCompleteCount !== 76) err('[V92] operational lifecycle evidence is incomplete')
    if (portfolio.summary.triggerQuality !== 'structural-only') err('[V92] trigger precision must remain structural-only without real samples')
    portfolioErrors.forEach(error => err(`[V92] portfolio: ${error}`))
    const committedText = String(read(path.join(ROOT, 'skills/portfolio.json')))
    if (committedText !== serializePortfolio(portfolio)) err('[V92] committed Skill portfolio is stale')

    const runtimeState = buildRuntimeStateIndex(ACTIVE_DEVCODEX_ROOT)
    if (!runtimeState.readOnlySourcePolicy || runtimeState.schemaVersion !== 1) {
      err('[V92] runtime-state index must stay schema v1 and read-only')
    }

    const readme = read(path.join(ROOT, 'README.md'))
    for (const needle of ['5 分钟快速开始', 'GitHub Packages', 'npm.pkg.github.com', 'NODE_AUTH_TOKEN', 'read:packages', '当前唯一发布通道', '1.0.1']) {
      if (!readme.includes(needle)) err(`[V92] README product path missing: ${needle}`)
    }
    console.log(`[V92] optimization controls checked: skills=76 gray=2 runtimeAlerts=${runtimeState.summary.alertCount}`)
  }

  return { checkV92 }
}

module.exports = { buildOptimizationControlChecks }
