#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildPublicProductProjection,
  validateCapabilityScenarios,
  validatePublicProductExpression,
  validateRoutePresentation,
  validateWorkflowPresentation
} = require('./lib/public-product-expression')
const { classifyEndpointIdentity } = require('./lib/public-endpoint-identity')
const { PUBLIC_SITE_REQUIRED_MD } = require('./lib/docs-surface-inventory')
const {
  PUBLIC_README_REQUIRED_MARKERS,
  PUBLIC_README_V2_REQUIRED_PHRASES,
  PUBLIC_README_V2_REQUIRED_SECTIONS,
  evaluatePublicReadmeContract,
  evaluatePublicReadmeContractV2
} = require('./lib/canonical-consumer-contracts')
const {
  formatReadmeSkillCategories,
  replaceReadmeSkillCategoryBlock
} = require('./generate-public-site-data')

const ROOT = path.resolve(__dirname, '..')
const projection = buildPublicProductProjection({ root: ROOT })
const sourceWorkflow = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'content', 'skills', 'routing', 'workflow-capabilities.json'),
  'utf8'
))
const sourcePortfolio = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'content', 'skills', 'portfolio.json'),
  'utf8'
))
const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const publicSitePackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'public-site', 'package.json'), 'utf8'))
const publicSiteConfig = fs.readFileSync(path.join(ROOT, 'public-site', 'rspress.config.ts'), 'utf8')
const publicSiteHome = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'index.md'), 'utf8')
const publicSiteHosts = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'reference', 'hosts.md'), 'utf8')
const workflowOverview = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'workflows', 'index.md'), 'utf8')
const workflowChange = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'workflows', 'change.md'), 'utf8')
const workflowReadOnly = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'workflows', 'read-only.md'), 'utf8')
const workflowSession = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'workflows', 'session.md'), 'utf8')
const workflowReference = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'reference', 'workflows.md'), 'utf8')
const skillReference = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'reference', 'skills.mdx'), 'utf8')
const skillCatalogComponent = fs.readFileSync(path.join(ROOT, 'public-site', 'components', 'SkillCatalog.tsx'), 'utf8')
const skillCatalogCss = fs.readFileSync(path.join(ROOT, 'public-site', 'components', 'skill-catalog.css'), 'utf8')
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
const pagesWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8')

assert.strictEqual(projection.schemaVersion, 'PublicProductProjectionV1')
assert.strictEqual(projection.release.version, rootPackage.version)
assert.deepStrictEqual(projection.workflows.canonical, [
  'dev', 'fix', 'self-fix', 'analyze', 'audit', 'other', 'chat', 'resume'
])
assert.deepStrictEqual(projection.workflows.primary, ['dev', 'fix', 'analyze', 'audit', 'resume', 'chat'])
assert.deepStrictEqual(projection.workflows.advanced, ['self-fix', 'other'])
assert.deepStrictEqual(projection.workflows.routeLayers.userTaskSubtypes, [
  'dev.default', 'dev.docs', 'dev.refactor', 'dev.database', 'dev.init',
  'dev.optimization', 'dev.scenario-test', 'fix.default', 'fix.incident',
  'fix.security', 'analyze.default', 'analyze.research'
])
assert.deepStrictEqual(projection.workflows.routeLayers.internalStepRouteKeys, ['dev.plan-review'])
assert.deepStrictEqual(projection.workflows.routeLayers.auditTargets, [
  'audit.规范文件', 'audit.技术方案', 'audit.需求文档', 'audit.项目工程',
  'audit.报告', 'audit.通用文档', 'audit.发布前审查'
])
assert.deepStrictEqual(validateRoutePresentation(sourceWorkflow.routePresentation), [])
assert.strictEqual(projection.skills.total, 86)
assert.strictEqual(projection.skills.active, 83)
assert.strictEqual(projection.skills.gray, 3)
assert.strictEqual(projection.skills.bucket, '80+')
assert.deepStrictEqual(projection.skills.categoryCounts, {
  'workflow-routing': 20,
  'domain-architecture': 21,
  'quality-delivery': 28,
  'runtime-governance': 17
})
assert.strictEqual(projection.skills.categories.length, 4)
assert.strictEqual(projection.skills.catalog.length, 86)
assert.strictEqual(new Set(projection.skills.catalog.map(skill => skill.id)).size, 86)
assert(projection.skills.catalog.every(skill => typeof skill.publicCategory === 'string'))
assert(projection.skills.categories.every(category =>
  category.representativeSkills.length > 0 &&
  category.representativeSkills.every(skill => skill.lifecycleState === 'active')
))
assert.strictEqual(projection.skills.extensionPolicy.extensionSource, 'workspace')
assert.strictEqual(projection.skills.extensionPolicy.includedInAssignments, false)
assert.strictEqual(projection.skills.extensionPolicy.includedInBundledCounts, false)
assert.strictEqual(projection.capabilityScenarios.length, 4)
assert(projection.capabilityScenarios.every((scenario) =>
  scenario.representativeSkillIds.length > 0 && scenario.nextHref.startsWith('/')
))
assert.deepStrictEqual(validateCapabilityScenarios(projection.capabilityScenarios, sourcePortfolio), [])
assert.deepStrictEqual(projection.hosts.map(item => item.hostId), [
  'copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor'
])
assert(projection.hosts.every(item => item.installedSurfacePresent))
assert(projection.hosts.every(item => item.variants.length > 0))
for (const host of projection.hosts) {
  assert(publicSiteHosts.includes(host.label), `host label drift: ${host.hostId}`)
  assert(publicSiteHosts.includes(host.recommendedEntry), `host entry drift: ${host.hostId}`)
  assert(publicSiteHosts.includes(host.publicStatus), `host status drift: ${host.hostId}`)
}
assert.strictEqual(Object.keys(projection.sourceIdentities).length, 5)
assert.strictEqual(projection.expression.autoEntry.runtimeBehaviorChanged, false)
assert.strictEqual(publicSitePackage.private, true)
assert.strictEqual(publicSitePackage.devDependencies['@rspress/core'], '2.0.18')
assert.strictEqual(Object.keys(rootPackage.dependencies || {}).length, 0)
assert(!rootPackage.files.includes('public-site/'))
assert.strictEqual(fs.existsSync(path.join(ROOT, 'public-site', 'docs', 'reference', 'skills.md')), false)
for (const category of projection.skills.categories) {
  assert(skillReference.includes(`/reference/skills?category=${category.id}`), `Skill reference missing category ${category.id}`)
  assert(skillReference.includes(`| ${category.count} |`), `Skill reference missing count ${category.id}`)
}
for (const needle of [
  "import { SkillCatalog } from '../../components/SkillCatalog'",
  '<SkillCatalog />',
  '不进入 bundled assignments',
  '不进入 86/83/3 分母'
]) assert(skillReference.includes(needle), needle)
for (const needle of [
  'filterSkillCatalog',
  'URLSearchParams',
  'type="search"',
  '<select',
  'value="active"',
  'value="gray"',
  'aria-live="polite"',
  'data-skill-id={skill.id}',
  'skillProjection.catalog'
]) assert(skillCatalogComponent.includes(needle), needle)
for (const needle of ['@media (max-width: 900px)', '@media (max-width: 640px)', ':focus-visible']) {
  assert(skillCatalogCss.includes(needle), needle)
}
for (const needle of [
  "base: '/devcodex/'",
  "outDir: 'doc_build'",
  'checkDeadLinks: true',
  'checkAnchors: true',
  projection.consumers.siteTitle,
  "icon: '/favicon.png'",
  "logoText: 'DevCodex'"
]) assert(publicSiteConfig.includes(needle), needle)
for (const needle of [
  "{ text: '工作流选择', link: '/workflows/' }",
  "{ text: '开发与修复', link: '/workflows/change' }",
  "{ text: '分析、审查与规划', link: '/workflows/read-only' }",
  "{ text: '对话与任务续接', link: '/workflows/session' }"
]) assert(publicSiteConfig.includes(needle), needle)
for (const legacyItem of ['dev', 'fix', 'analyze', 'audit', 'resume', 'chat']) {
  assert(!publicSiteConfig.includes(`{ text: '${legacyItem}', link: '/workflows/${legacyItem}' }`))
}
assert(fs.existsSync(path.join(ROOT, 'public-site', 'docs', 'public', 'favicon.png')))
for (const needle of [
  'pull_request:',
  'workflow_dispatch:',
  'npm --prefix public-site ci',
  'actions/configure-pages@v5',
  'actions/upload-pages-artifact@v3',
  'actions/deploy-pages@v4',
  "github.event_name != 'pull_request'"
]) assert(pagesWorkflow.includes(needle), needle)

for (const rel of PUBLIC_SITE_REQUIRED_MD) {
  assert(fs.existsSync(path.join(ROOT, rel)), rel)
}
const groupedWorkflowDocs = [workflowChange, workflowReadOnly, workflowSession].join('\n')
const workflowPublicDocs = [workflowOverview, groupedWorkflowDocs, workflowReference].join('\n')
for (const workflowId of projection.workflows.canonical) {
  assert(workflowOverview.includes(`\`${workflowId}\``), `workflow overview missing ${workflowId}`)
}
for (const routeKey of projection.workflows.routeLayers.userTaskSubtypes) {
  assert(groupedWorkflowDocs.includes(`\`${routeKey}\``), `grouped workflow docs missing ${routeKey}`)
}
for (const routeKey of projection.workflows.routeLayers.internalStepRouteKeys) {
  assert(workflowPublicDocs.includes(`\`${routeKey}\``), `workflow docs missing internal step ${routeKey}`)
  assert(!workflowReadOnly.includes(`| \`${routeKey}\` |`), `internal step presented as user choice ${routeKey}`)
}
for (const routeKey of projection.workflows.routeLayers.auditTargets) {
  assert(workflowReadOnly.includes(`\`${routeKey}\``), `read-only workflow docs missing ${routeKey}`)
}
assert(workflowOverview.includes('8 个 canonical workflow'))
assert(workflowReference.includes('用户任务 subtype（12）'))
assert(workflowReference.includes('内部步骤 route key（1）'))
assert(workflowReference.includes('audit target（7）'))
const committed = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'public-site', 'data', 'public-product-projection.json'),
  'utf8'
))
assert.strictEqual(committed.schemaVersion, projection.schemaVersion)
assert.deepStrictEqual(committed.release, projection.release)
assert.deepStrictEqual(committed.workflows, projection.workflows)
assert.deepStrictEqual(committed.skills, projection.skills)
assert.deepStrictEqual(committed.capabilityScenarios, projection.capabilityScenarios)
assert.deepStrictEqual(committed.markers, projection.markers)
assert.deepStrictEqual(
  committed.hosts.map((item) => item.hostId),
  projection.hosts.map((item) => item.hostId)
)
for (const marker of Object.values(projection.markers)) {
  assert(publicSiteHome.includes(marker), marker)
  assert(readme.includes(marker), marker)
}

assert.deepStrictEqual(
  validateWorkflowPresentation({ primary: ['dev'], advanced: ['dev'] }, projection.workflows.canonical),
  ['workflow-presentation-duplicate', 'workflow-presentation-not-bijective']
)
assert(validateWorkflowPresentation({
  primary: projection.workflows.primary,
  advanced: [...projection.workflows.advanced, 'plan']
}, projection.workflows.canonical).includes('plan-promoted-to-canonical-workflow'))

const invalidRoutePresentation = JSON.parse(JSON.stringify(sourceWorkflow.routePresentation))
invalidRoutePresentation.userTaskSubtypes.push('dev.plan-review')
assert(validateRoutePresentation(invalidRoutePresentation).includes('plan-review-promoted-to-user-subtype'))
assert(validateRoutePresentation(invalidRoutePresentation).includes('route-presentation-layer-overlap'))

const invalid = JSON.parse(JSON.stringify(projection.expression))
invalid.autoEntry.canonical = '@wrong'
assert(validatePublicProductExpression(invalid, {
  workflows: projection.workflows.canonical.map(id => ({ id }))
}, {
  summary: { skillCount: 86, activeSkillCount: 83, graySkillCount: 3 },
  skills: Array.from({ length: 86 }, (_, index) => ({ id: `s-${index}` }))
}).includes('expression-auto-canonical'))

const invalidSkillSummary = {
  summary: { skillCount: 86, activeSkillCount: 82, graySkillCount: 3 },
  skills: Array.from({ length: 86 }, (_, index) => ({ id: `s-${index}` }))
}
assert(validatePublicProductExpression(projection.expression, {
  workflows: projection.workflows.canonical.map(id => ({ id }))
}, invalidSkillSummary).includes('portfolio-lifecycle-count'))

const invalidGraySkill = JSON.parse(JSON.stringify(projection.expression))
invalidGraySkill.capabilityScenarios[0].representativeSkillIds = ['brand-visual-quality']
assert(validatePublicProductExpression(invalidGraySkill, sourceWorkflow, sourcePortfolio)
  .includes('capability-scenario-skill-not-active:brand-visual-quality'))

const invalidOverclaim = JSON.parse(JSON.stringify(projection.expression))
invalidOverclaim.capabilityScenarios[0].workflowBoundary = '全部 Skill 已加载并生效'
assert(validatePublicProductExpression(invalidOverclaim, sourceWorkflow, sourcePortfolio)
  .includes('capability-scenario-overclaim:turn-ambiguous-request-into-action'))

const missingHost = JSON.parse(JSON.stringify(projection.expression))
delete missingHost.hostPresentation.cursor
assert(validatePublicProductExpression(missingHost, {
  workflows: projection.workflows.canonical.map(id => ({ id }))
}, {
  summary: { skillCount: 86, activeSkillCount: 83, graySkillCount: 3 },
  skills: Array.from({ length: 86 }, (_, index) => ({ id: `s-${index}` }))
}).includes('host-presentation-coverage'))

const forbiddenDiscovery = JSON.parse(JSON.stringify(projection.expression))
forbiddenDiscovery.discoveryPolicy.packageKeywords.push('agent-runtime')
forbiddenDiscovery.discoveryPolicy.githubTopics.push('agent-runtime')
assert(validatePublicProductExpression(forbiddenDiscovery, {
  workflows: projection.workflows.canonical.map(id => ({ id }))
}, {
  summary: { skillCount: 86, activeSkillCount: 83, graySkillCount: 3 },
  skills: Array.from({ length: 86 }, (_, index) => ({ id: `s-${index}` }))
}).includes('discovery-forbidden-concept'))

const fixtures = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'public-product-expression', 'endpoint-cases.json'),
  'utf8'
))
for (const fixture of fixtures.cases) {
  const result = classifyEndpointIdentity(fixture.input)
  assert.strictEqual(result.result, fixture.expected, fixture.id)
  if (fixture.expected === 'BLOCK') assert(result.violations.length > 0, fixture.id)
}

const syntheticReadme = [
  ...PUBLIC_README_V2_REQUIRED_SECTIONS,
  ...PUBLIC_README_REQUIRED_MARKERS,
  ...PUBLIC_README_V2_REQUIRED_PHRASES,
  projection.expression.technicalDefinition.zh,
  ...projection.expression.valuePropositions,
  ...projection.capabilityScenarios.flatMap(scenario => [
    scenario.userProblem,
    scenario.userOutcome,
    scenario.skillFocus,
    scenario.workflowBoundary,
    ...scenario.representativeSkillIds
  ]),
  ...Object.values(projection.markers),
  ...projection.workflows.canonical.map(id => `\`${id}\``),
  ...projection.hosts.flatMap(host => [host.label, host.recommendedEntry, host.publicStatus]),
  ...projection.skills.categories.flatMap(category => [
    category.label,
    `| ${category.count} |`,
    `/reference/skills?category=${category.id}`,
    ...category.representativeSkills.map(skill => `\`${skill.id}\``)
  ]),
  'extensionSource=workspace',
  '不进入 bundled assignments',
  '不进入 86/83/3 分母',
  `${projection.skills.total} 个 Skill（${projection.skills.active} active + ${projection.skills.gray} gray）`
].join('\n\n')
const v2 = evaluatePublicReadmeContractV2(syntheticReadme, { root: ROOT, projection })
const legacyV1 = evaluatePublicReadmeContract(syntheticReadme)
assert.strictEqual(legacyV1.schemaVersion, 'PublicReadmeContractV1')
assert.strictEqual(legacyV1.legacy, true)
assert.strictEqual(legacyV1.valid, true)
assert.strictEqual(v2.schemaVersion, 'PublicReadmeContractV2')
assert.deepStrictEqual(v2.violations, [])
assert.strictEqual(v2.valid, true)
assert.strictEqual(v2.migrationSafety.legacyContractRetained, true)
assert.strictEqual(v2.endpoint.result, 'UNVERIFIED')
assert(v2.consumers.parity.every(item => item.status === 'PASS' || item.status === 'N/A'))

const currentReadme = evaluatePublicReadmeContractV2(readme, { root: ROOT, projection })
assert.strictEqual(currentReadme.valid, true, JSON.stringify(currentReadme.violations))

const migrationReady = evaluatePublicReadmeContractV2(syntheticReadme, {
  root: ROOT,
  projection,
  requirePublicSite: true,
  requireDocsMigrationPass: true,
  docsMigrationEvidence: { result: 'PASS', reason: 'nine public pages exist and are build/link gated' }
})
assert.strictEqual(migrationReady.valid, true)

const githubMetadataReady = evaluatePublicReadmeContractV2(syntheticReadme, {
  root: ROOT,
  projection,
  requireGitHubMetadata: true,
  githubMetadata: {
    description: projection.consumers.githubDescription,
    homepage: projection.endpoints.productPagesCandidate,
    topics: [...projection.expression.discoveryPolicy.githubTopics].sort()
  }
})
assert.strictEqual(githubMetadataReady.valid, true)
assert(githubMetadataReady.consumers.parity
  .filter(item => item.surface === 'GitHub repository')
  .every(item => item.status === 'PASS'))

const missingWorkflow = evaluatePublicReadmeContractV2(
  syntheticReadme.replace('`self-fix`', 'self-fix'),
  { root: ROOT, projection }
)
assert(missingWorkflow.violations.some(item => item.code === 'README_WORKFLOW_MISSING' && item.evidence === 'self-fix'))

const missingCategoryLink = evaluatePublicReadmeContractV2(
  syntheticReadme.replace('/reference/skills?category=workflow-routing', '/reference/skills'),
  { root: ROOT, projection }
)
assert(missingCategoryLink.violations.some(item =>
  item.code === 'README_SKILL_CATEGORY_LINK_MISSING' && item.evidence === 'workflow-routing'
))

const workspaceAsBundled = evaluatePublicReadmeContractV2(
  `${syntheticReadme}\nWorkspace 四类`,
  { root: ROOT, projection }
)
assert(workspaceAsBundled.violations.some(item => item.code === 'README_WORKSPACE_SKILL_BUNDLED_CATEGORY'))

const formattedSkillCategories = formatReadmeSkillCategories(projection.skills)
for (const category of projection.skills.categories) {
  assert(formattedSkillCategories.includes(`/reference/skills?category=${category.id}`))
  assert(formattedSkillCategories.includes(`| ${category.count} |`))
}
assert(replaceReadmeSkillCategoryBlock(
  '<!-- devcodex-public:skill-categories:start -->\nstale\n<!-- devcodex-public:skill-categories:end -->',
  projection.skills
).includes(formattedSkillCategories))

const blockedEndpoint = classifyEndpointIdentity(fixtures.cases.find(item => item.id === 'parked-200-block').input)
assert(evaluatePublicReadmeContractV2(syntheticReadme, {
  root: ROOT,
  projection,
  endpointEvidence: blockedEndpoint
}).violations.some(item => item.code === 'ENDPOINT_IDENTITY_BLOCKED'))

console.log(`public product expression checks passed: workflows=${projection.workflows.canonical.length}, skills=${projection.skills.total}/${projection.skills.active}/${projection.skills.gray}, hosts=${projection.hosts.length}`)
