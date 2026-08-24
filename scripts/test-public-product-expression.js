#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildPublicProductProjection,
  normalizePublicProductExpression,
  validateCapabilityScenarios,
  validatePublicProductExpression,
  validateRoutePresentation,
  validateWorkflowPresentation
} = require('./lib/public-product-expression')
const { classifyEndpointIdentity } = require('./lib/public-endpoint-identity')

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
const skillReference = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'reference', 'skills.mdx'), 'utf8')
const skillCatalogComponent = fs.readFileSync(path.join(ROOT, 'public-site', 'components', 'SkillCatalog.tsx'), 'utf8')
const skillCatalogCss = fs.readFileSync(path.join(ROOT, 'public-site', 'components', 'skill-catalog.css'), 'utf8')
const pagesWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8')

assert.strictEqual(projection.schemaVersion, 'PublicProductProjectionV2')
assert.strictEqual(projection.expression.schemaVersion, 'PublicProductExpressionV2')
assert.deepStrictEqual(projection.expressionCompatibility, {
  schemaVersion: 'PublicProductExpressionCompatibilityReceiptV1',
  sourceSchemaVersion: 'PublicProductExpressionV2',
  readMode: 'current-v2',
  modelCapabilityBoundary: 'declared',
  ownershipBoundary: 'declared'
})
assert.strictEqual(projection.expression.modelCapabilityBoundary.changesModelParameters, false)
assert(projection.expression.ownershipBoundary.devcodexOwns.includes('validation'))
assert(projection.expression.ownershipBoundary.hostOwns.includes('native-agent-loop'))
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
assert.strictEqual(Object.keys(projection.sourceIdentities).length, 5)
assert.strictEqual(projection.expression.autoEntry.runtimeBehaviorChanged, false)
assert.strictEqual(publicSitePackage.private, true)
assert.strictEqual(publicSitePackage.devDependencies['@rspress/core'], '2.0.18')
assert.strictEqual(Object.keys(rootPackage.dependencies || {}).length, 0)
assert(!rootPackage.files.includes('public-site/'))
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

const committed = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'public-site', 'data', 'public-product-projection.json'),
  'utf8'
))
assert.strictEqual(committed.schemaVersion, projection.schemaVersion)
assert.deepStrictEqual(committed.release, projection.release)
assert.deepStrictEqual(committed.workflows, projection.workflows)
assert.deepStrictEqual(committed.skills, projection.skills)
assert.deepStrictEqual(committed.capabilityScenarios, projection.capabilityScenarios)
assert.strictEqual(Object.prototype.hasOwnProperty.call(committed, 'markers'), false)
assert.deepStrictEqual(
  committed.hosts.map((item) => item.hostId),
  projection.hosts.map((item) => item.hostId)
)
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

const legacyExpression = JSON.parse(JSON.stringify(projection.expression))
legacyExpression.schemaVersion = 'PublicProductExpressionV1'
legacyExpression.category = {
  zh: '意图驱动的 AI Coding 工作流运行时',
  en: 'Intent-driven AI coding workflow runtime',
  semanticInvariants: ['intent-driven', 'AI coding workflow', 'runtime']
}
legacyExpression.technicalDefinition = {
  zh: '本地优先、文件支撑的控制层与六宿主适配包。',
  en: 'A local-first, file-backed control layer and six-host adapter package.'
}
delete legacyExpression.modelCapabilityBoundary
delete legacyExpression.ownershipBoundary
legacyExpression.mustNot = legacyExpression.mustNot.filter(value =>
  !['model-parameter-enhancer', 'native-agent-loop-replacement'].includes(value)
)
legacyExpression.discoveryPolicy.packageKeywords = legacyExpression.discoveryPolicy.packageKeywords
  .filter(value => value !== 'coding-harness')
legacyExpression.discoveryPolicy.githubTopics = legacyExpression.discoveryPolicy.githubTopics
  .filter(value => value !== 'coding-harness')
const legacyCompatibility = normalizePublicProductExpression(legacyExpression)
assert.strictEqual(legacyCompatibility.compatibility.readMode, 'legacy-v1-read-only')
assert.strictEqual(legacyCompatibility.compatibility.modelCapabilityBoundary, 'UNVERIFIED')
assert.strictEqual(legacyCompatibility.compatibility.ownershipBoundary, 'UNVERIFIED')
const legacyErrors = validatePublicProductExpression(legacyExpression, sourceWorkflow, sourcePortfolio)
assert(!legacyErrors.includes('expression-schema-version'))
assert(!legacyErrors.some(value => value.startsWith('expression-model-parameter-enhancer')))
assert.throws(
  () => normalizePublicProductExpression({ schemaVersion: 'PublicProductExpressionV99' }),
  error => error.code === 'PUBLIC_PRODUCT_EXPRESSION_SCHEMA_UNSUPPORTED'
)

const bareHarness = JSON.parse(JSON.stringify(projection.expression))
bareHarness.technicalDefinition.semanticInvariants = ['workflow runtime']
assert(validatePublicProductExpression(bareHarness, sourceWorkflow, sourcePortfolio)
  .includes('expression-bare-harness-overclaim'))

const modelEnhancer = JSON.parse(JSON.stringify(projection.expression))
modelEnhancer.modelCapabilityBoundary.changesModelParameters = true
assert(validatePublicProductExpression(modelEnhancer, sourceWorkflow, sourcePortfolio)
  .includes('expression-model-parameter-enhancer-overclaim'))

const hostReplacement = JSON.parse(JSON.stringify(projection.expression))
hostReplacement.ownershipBoundary.hostOwns = hostReplacement.ownershipBoundary.hostOwns
  .filter(value => value !== 'native-agent-loop')
assert(validatePublicProductExpression(hostReplacement, sourceWorkflow, sourcePortfolio)
  .includes('expression-host-ownership-boundary'))

const missingHarnessDiscovery = JSON.parse(JSON.stringify(projection.expression))
missingHarnessDiscovery.discoveryPolicy.packageKeywords = missingHarnessDiscovery.discoveryPolicy.packageKeywords
  .filter(value => value !== 'coding-harness')
missingHarnessDiscovery.discoveryPolicy.githubTopics = missingHarnessDiscovery.discoveryPolicy.githubTopics
  .filter(value => value !== 'coding-harness')
assert(validatePublicProductExpression(missingHarnessDiscovery, sourceWorkflow, sourcePortfolio)
  .includes('discovery-harness-runtime-pair-missing'))

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

console.log(`public product expression checks passed: workflows=${projection.workflows.canonical.length}, skills=${projection.skills.total}/${projection.skills.active}/${projection.skills.gray}, hosts=${projection.hosts.length}`)
