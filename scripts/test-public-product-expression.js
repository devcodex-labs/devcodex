#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildPublicProductProjection,
  validatePublicProductExpression,
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

const ROOT = path.resolve(__dirname, '..')
const projection = buildPublicProductProjection({ root: ROOT })
const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const publicSitePackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'public-site', 'package.json'), 'utf8'))
const publicSiteConfig = fs.readFileSync(path.join(ROOT, 'public-site', 'rspress.config.ts'), 'utf8')
const publicSiteHome = fs.readFileSync(path.join(ROOT, 'public-site', 'docs', 'index.md'), 'utf8')
const pagesWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8')

assert.strictEqual(projection.schemaVersion, 'PublicProductProjectionV1')
assert.deepStrictEqual(projection.workflows.canonical, [
  'dev', 'fix', 'self-fix', 'analyze', 'audit', 'other', 'chat', 'resume'
])
assert.deepStrictEqual(projection.workflows.primary, ['dev', 'fix', 'analyze', 'audit', 'resume', 'chat'])
assert.deepStrictEqual(projection.workflows.advanced, ['self-fix', 'other'])
assert.strictEqual(projection.skills.total, 86)
assert.strictEqual(projection.skills.active, 83)
assert.strictEqual(projection.skills.gray, 3)
assert.strictEqual(projection.skills.bucket, '80+')
assert.deepStrictEqual(projection.hosts.map(item => item.hostId), [
  'copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor'
])
assert(projection.hosts.every(item => item.installedSurfacePresent))
assert(projection.hosts.every(item => item.variants.length > 0))
assert.strictEqual(Object.keys(projection.sourceIdentities).length, 3)
assert.strictEqual(projection.expression.autoEntry.runtimeBehaviorChanged, false)
assert.strictEqual(publicSitePackage.private, true)
assert.strictEqual(publicSitePackage.devDependencies['@rspress/core'], '2.0.18')
assert.strictEqual(Object.keys(rootPackage.dependencies || {}).length, 0)
assert(!rootPackage.files.includes('public-site/'))
for (const needle of [
  "base: '/devcodex/'",
  "outDir: 'doc_build'",
  'checkDeadLinks: true',
  'checkAnchors: true',
  projection.consumers.siteTitle
]) assert(publicSiteConfig.includes(needle), needle)
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
const committed = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'public-site', 'data', 'public-product-projection.json'),
  'utf8'
))
assert.strictEqual(committed.schemaVersion, projection.schemaVersion)
assert.deepStrictEqual(committed.workflows, projection.workflows)
assert.deepStrictEqual(committed.skills, projection.skills)
assert.deepStrictEqual(committed.markers, projection.markers)
assert.deepStrictEqual(
  committed.hosts.map((item) => item.hostId),
  projection.hosts.map((item) => item.hostId)
)
for (const marker of Object.values(projection.markers)) assert(publicSiteHome.includes(marker), marker)

assert.deepStrictEqual(
  validateWorkflowPresentation({ primary: ['dev'], advanced: ['dev'] }, projection.workflows.canonical),
  ['workflow-presentation-duplicate', 'workflow-presentation-not-bijective']
)
assert(validateWorkflowPresentation({
  primary: projection.workflows.primary,
  advanced: [...projection.workflows.advanced, 'plan']
}, projection.workflows.canonical).includes('plan-promoted-to-canonical-workflow'))

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
  ...Object.values(projection.markers),
  ...projection.workflows.canonical.map(id => `\`${id}\``),
  ...projection.hosts.flatMap(host => [host.label, host.recommendedEntry, host.publicStatus]),
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

const blockedEndpoint = classifyEndpointIdentity(fixtures.cases.find(item => item.id === 'parked-200-block').input)
assert(evaluatePublicReadmeContractV2(syntheticReadme, {
  root: ROOT,
  projection,
  endpointEvidence: blockedEndpoint
}).violations.some(item => item.code === 'ENDPOINT_IDENTITY_BLOCKED'))

console.log(`public product expression checks passed: workflows=${projection.workflows.canonical.length}, skills=${projection.skills.total}/${projection.skills.active}/${projection.skills.gray}, hosts=${projection.hosts.length}`)
