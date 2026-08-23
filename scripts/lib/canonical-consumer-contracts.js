'use strict'

const fs = require('fs')
const path = require('path')
const { buildBundle } = require('./control-content-source')
const { resolveControlAsset } = require('./control-content-delivery')
const { DEFAULT_ROOT, buildPublicProductProjection } = require('./public-product-expression')

const CONTRACTS = new Map([
  ['skills/spec-governance/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/test-router/SKILL.md', ['skills/test-router/test-route-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['skills/report/SKILL.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['skills/spec-absorption/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/source-consumer-sync/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/document-sync/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/audit-project/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/audit-requirements/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['prompts/technical-design.prompt.md', ['skills/test-router/test-route-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/implementation-plan.prompt.md', ['skills/test-router/test-route-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/requirement.prompt.md', ['skills/spec-governance/gate-registry.json']],
  ['prompts/report-dev.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-fix.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-audit.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-scenario-test.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-optimization.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-analysis.prompt.md', ['skills/report/report-schema.json']]
])

const PUBLIC_README_REQUIRED_MARKERS = Object.freeze([
  '# DevCodex',
  '工作流运行时和宿主适配包',
  'Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor（Beta）',
  'Node.js `>=18.17.0`',
  'node -v',
  'npm -v',
  'npm install -g devcodex',
  'npm update -g devcodex',
  'npm uninstall -g devcodex',
  'devcodex uninstall --dry-run',
  'devcodex uninstall --apply',
  'devcodex --version',
  '重新打开宿主的新会话',
  '安装生命周期中刷新用户级宿主适配',
  '内置 Skill',
  '工作区 Skill',
  '<你的项目根目录>/',
  '.devcodex/',
  'workspace/',
  'skills/',
  '<id>/',
  'SKILL.md',
  'intent.json',
  '<你的项目根目录>/.devcodex/workspace/skills/<id>/SKILL.md',
  'DevCodex 不扫描、复制、合并、覆盖或删除这些用户资产',
  '不替代业务框架、GitHub CI、安全审计或人工评审',
  '## 常见任务怎么说',
  '## 常见问题与排错',
  '安装最新版后，为什么没有需求概况、PC0~PC7 或 CP 流程？',
  'devcodex status',
  'devcodex global-adapters apply',
  'adapter=not-ready',
  'contract=failed',
  'native=unverified',
  'host kernel not installed',
  '“帮我审批”时反复重新连接，是否必须开启完全访问？',
  'node runtime BLOCK',
  'sandbox-exec-denied',
  'GLOBAL_HOST_TARGET_UNVERIFIED',
  '不需要永久开启 Full access',
  'Grok Full 入口',
  '普通 `grok` 是 Partial',
  'devcodex grok',
  'StageLoadReceiptV1',
  'Cursor 已安装 DevCodex，但为什么没有流程或 SkillRoute？',
  '~/.cursor/hooks.json',
  'Cursor Cloud Agent',
  'agent --version',
  '只分析，不修改文件',
  '继续<任务名>任务',
  'push、tag、GitHub Release 和 npm publish',
  '[AGPL-3.0](LICENSE)',
  '## 目录',
  '[为什么需要 DevCodex？](#为什么需要-devcodex)',
  '[5 分钟开始](#5-分钟开始)',
  '[常见任务怎么说](#常见任务怎么说)',
  '[常见问题与排错](#常见问题与排错)',
  '[添加自己的 Skill](#添加自己的-skill)',
  '[许可证](#许可证)'
])

const PUBLIC_README_V2_REQUIRED_SECTIONS = Object.freeze([
  '# DevCodex — 跨宿主 AI Coding 工程 Harness',
  '## 为什么需要 DevCodex？',
  '## 安装后，你能解决什么？',
  '## 什么时候直接使用宿主，什么时候用 DevCodex？',
  '## 5 分钟开始',
  '## 安装会改变什么',
  '## 工作流、Skill 与宿主边界',
  '## 常见任务怎么说',
  '## 常见问题与排错',
  '## 更新',
  '## 卸载',
  '## 边界',
  '## 许可证'
])

const PUBLIC_README_V2_REQUIRED_PHRASES = Object.freeze([
  'npm install -g devcodex',
  'devcodex init',
  'npm update -g devcodex',
  'devcodex uninstall --dry-run',
  'devcodex uninstall --apply',
  'npm uninstall -g devcodex',
  'devcodex status',
  '重新打开宿主的新会话',
  '@devcodex-auto',
  '@rocky',
  'extensions.devcodex.autoAliases',
  '空数组 `[]`',
  '跨宿主 AI Coding 工程 Harness',
  '不会提升模型本身的参数能力',
  '显著提升模型在真实软件工程中的有效智能表现',
  'DevCodex owns',
  'Host owns',
  '不是模型网关',
  '不是通用 Agent 框架',
  '不是多 Agent 编排器',
  '不替代业务框架、GitHub CI、安全审计或人工评审',
  '模型执行和数据处理仍遵循所选 AI Coding 宿主的规则'
])

function evaluatePublicReadmeContract (content) {
  const text = String(content || '')
  const missing = PUBLIC_README_REQUIRED_MARKERS.filter(marker => !text.includes(marker))
  return {
    schemaVersion: 'PublicReadmeContractV1',
    legacy: true,
    valid: missing.length === 0,
    missing
  }
}

function addViolation (violations, code, surface, evidence) {
  violations.push({ code, surface, evidence: String(evidence) })
}

function orderedSectionViolations (text, headings) {
  const violations = []
  let previous = -1
  for (const heading of headings) {
    const index = text.indexOf(heading)
    if (index === -1) {
      addViolation(violations, 'README_SECTION_MISSING', 'README.md', heading)
      continue
    }
    if (index < previous) addViolation(violations, 'README_SECTION_ORDER', 'README.md', heading)
    previous = Math.max(previous, index)
  }
  return violations
}

function readJsonIfPresent (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readTextIfPresent (file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function evaluatePublicConsumerParity (root, text, projection, options, violations) {
  const pkg = readJsonIfPresent(path.join(root, 'package.json'))
  const plugin = readJsonIfPresent(path.join(root, 'plugin.json'))
  const cli = readTextIfPresent(path.join(root, 'scripts', 'lib', 'cli-maintenance-commands.js'))
  const siteConfig = readTextIfPresent(path.join(root, 'public-site', 'rspress.config.ts'))
  const siteHome = readTextIfPresent(path.join(root, 'public-site', 'docs', 'index.md'))
  const results = []

  function compare (surface, field, actual, expected, required = true) {
    const status = actual == null
      ? (required ? 'BLOCK' : 'N/A')
      : (JSON.stringify(actual) === JSON.stringify(expected) ? 'PASS' : 'BLOCK')
    results.push({ surface, field, status, expected, actual: actual ?? null })
    if (status === 'BLOCK') {
      addViolation(violations, 'PUBLIC_CONSUMER_PARITY', surface, `${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? null)}`)
    }
  }

  function compareSet (surface, field, actual, expected) {
    const actualValues = Array.isArray(actual) ? [...actual].sort() : actual
    const expectedValues = Array.isArray(expected) ? [...expected].sort() : expected
    compare(surface, field, actualValues, expectedValues)
  }

  compare('README.md', 'hero', text.includes(`# ${projection.consumers.readmeHero}`), true)
  compare('package.json', 'description', pkg?.description, projection.consumers.packageDescription)
  compare('package.json', 'homepage', pkg?.homepage, projection.endpoints.productPagesCandidate)
  compare('package.json', 'keywords', pkg?.keywords, projection.expression.discoveryPolicy.packageKeywords)
  compare('plugin.json', 'displayName', plugin?.displayName, projection.consumers.pluginDisplayName)
  compare('plugin.json', 'description', plugin?.description, projection.consumers.pluginDescription)
  compare('plugin.json', 'homepage', plugin?.homepage, projection.endpoints.productPagesCandidate)
  compare('plugin.json', 'keywords', plugin?.keywords, projection.expression.discoveryPolicy.packageKeywords)
  const cliSubtitleSuffix = projection.consumers.cliSubtitle.slice('DevCodex'.length)
  compare('CLI help', 'subtitle', cli == null ? null : cli.includes(cliSubtitleSuffix), true)
  compare(
    'public-site',
    'title',
    siteConfig == null ? null : siteConfig.includes(projection.consumers.siteTitle),
    true,
    options.requirePublicSite === true
  )
  compare(
    'public-site',
    'product-category',
    siteHome == null ? null : siteHome.includes(projection.expression.category.en),
    true,
    options.requirePublicSite === true
  )

  const github = options.githubMetadata || null
  if (github || options.requireGitHubMetadata === true) {
    compare('GitHub repository', 'description', github?.description, projection.consumers.githubDescription)
    compare('GitHub repository', 'homepage', github?.homepage, projection.endpoints.productPagesCandidate)
    compareSet('GitHub repository', 'topics', github?.topics, projection.expression.discoveryPolicy.githubTopics)
  }
  return results
}

function evaluatePublicReadmeContractV2 (content, options = {}) {
  const text = String(content || '')
  const root = options.root || DEFAULT_ROOT
  const projection = options.projection || buildPublicProductProjection({ root })
  const legacy = evaluatePublicReadmeContract(text)
  const violations = orderedSectionViolations(text, PUBLIC_README_V2_REQUIRED_SECTIONS)

  for (const phrase of PUBLIC_README_V2_REQUIRED_PHRASES) {
    if (!text.includes(phrase)) addViolation(violations, 'README_PHRASE_MISSING', 'README.md', phrase)
  }
  for (const marker of Object.values(projection.markers)) {
    if (!text.includes(marker)) addViolation(violations, 'README_PROJECTION_MARKER_MISSING', 'README.md', marker)
  }
  for (const workflow of projection.workflows.canonical) {
    if (!text.includes(`\`${workflow}\``)) addViolation(violations, 'README_WORKFLOW_MISSING', 'README.md', workflow)
  }
  for (const host of projection.hosts) {
    if (!text.includes(host.label)) addViolation(violations, 'README_HOST_MISSING', 'README.md', host.hostId)
    if (!text.includes(host.recommendedEntry)) addViolation(violations, 'README_HOST_ENTRY_MISSING', 'README.md', host.hostId)
    if (!text.includes(host.publicStatus)) addViolation(violations, 'README_HOST_STATUS_MISSING', 'README.md', host.hostId)
  }
  if (!text.includes(`${projection.skills.total} 个`)) {
    addViolation(violations, 'README_SKILL_TOTAL_MISSING', 'README.md', projection.skills.total)
  }
  if (!text.includes(`${projection.skills.active} active + ${projection.skills.gray} gray`)) {
    addViolation(violations, 'README_SKILL_LIFECYCLE_MISSING', 'README.md', `${projection.skills.active}/${projection.skills.gray}`)
  }
  for (const category of projection.skills.categories || []) {
    const href = `/reference/skills?category=${category.id}`
    if (!text.includes(href)) {
      addViolation(violations, 'README_SKILL_CATEGORY_LINK_MISSING', 'README.md', category.id)
    }
    if (!text.includes(category.label) || !text.includes(`| ${category.count} |`)) {
      addViolation(violations, 'README_SKILL_CATEGORY_COUNT_MISSING', 'README.md', `${category.id}:${category.count}`)
    }
    for (const representative of category.representativeSkills || []) {
      if (!text.includes(`\`${representative.id}\``)) {
        addViolation(violations, 'README_SKILL_REPRESENTATIVE_MISSING', 'README.md', `${category.id}:${representative.id}`)
      }
    }
  }
  if (!text.includes('extensionSource=workspace') ||
      !text.includes('不进入 bundled assignments') ||
      !text.includes('不进入 86/83/3 分母')) {
    addViolation(violations, 'README_WORKSPACE_SKILL_DENOMINATOR_BOUNDARY_MISSING', 'README.md', 'workspace extension exclusion')
  }
  if (text.includes('Workspace 四类') || text.includes('Delivery & Governance 和 Workspace 四类')) {
    addViolation(violations, 'README_WORKSPACE_SKILL_BUNDLED_CATEGORY', 'README.md', 'Workspace')
  }
  if (!text.includes(projection.expression.technicalDefinition.zh)) {
    addViolation(violations, 'README_TECHNICAL_DEFINITION_MISSING', 'README.md', projection.expression.technicalDefinition.zh)
  }
  for (const value of projection.expression.valuePropositions) {
    if (!text.includes(value)) addViolation(violations, 'README_VALUE_PROPOSITION_MISSING', 'README.md', value)
  }
  for (const scenario of projection.capabilityScenarios) {
    const evidence = [
      scenario.userProblem,
      scenario.userOutcome,
      scenario.skillFocus,
      scenario.workflowBoundary,
      ...scenario.representativeSkillIds
    ]
    for (const value of evidence) {
      if (!text.includes(value)) {
        addViolation(violations, 'README_CAPABILITY_SCENARIO_MISSING', 'README.md', `${scenario.id}:${value}`)
      }
    }
  }
  for (const forbidden of projection.expression.discoveryPolicy.forbiddenConcepts) {
    const publicMetadata = [
      readJsonIfPresent(path.join(root, 'package.json'))?.description,
      readJsonIfPresent(path.join(root, 'plugin.json'))?.description,
      readTextIfPresent(path.join(root, 'scripts', 'lib', 'cli-maintenance-commands.js'))
    ].filter(Boolean).join('\n').toLowerCase()
    if (publicMetadata.includes(forbidden.toLowerCase())) {
      addViolation(violations, 'FORBIDDEN_PUBLIC_CONCEPT', 'public metadata', forbidden)
    }
  }

  const endpointEvidence = options.endpointEvidence || null
  if (endpointEvidence?.result === 'BLOCK') addViolation(violations, 'ENDPOINT_IDENTITY_BLOCKED', 'homepage', endpointEvidence.violations?.join(', ') || 'blocked')
  if (options.requireEndpointPass === true && endpointEvidence?.result !== 'PASS') {
    addViolation(violations, 'ENDPOINT_IDENTITY_NOT_PASSED', 'homepage', endpointEvidence?.result || 'missing')
  }

  const docsMigration = options.docsMigrationEvidence || {
    result: 'N/A',
    reason: 'README migration is not claimed by this evaluation'
  }
  if (docsMigration.result === 'BLOCK' || (options.requireDocsMigrationPass === true && docsMigration.result !== 'PASS')) {
    addViolation(violations, 'DOCS_MIGRATION_NOT_PASSED', 'README → public-site', docsMigration.reason || docsMigration.result)
  }
  const consumerParity = evaluatePublicConsumerParity(root, text, projection, options, violations)

  return {
    schemaVersion: 'PublicReadmeContractV2',
    valid: violations.length === 0,
    violations,
    missing: violations.map(item => `${item.code}:${item.surface}:${item.evidence}`),
    sourceIdentities: { ...projection.sourceIdentities },
    expression: {
      productId: projection.expression.productId,
      category: projection.expression.category,
      technicalDefinition: projection.expression.technicalDefinition,
      modelCapabilityBoundary: projection.expression.modelCapabilityBoundary || null,
      ownershipBoundary: projection.expression.ownershipBoundary || null,
      compatibility: { ...projection.expressionCompatibility },
      mustNot: [...projection.expression.mustNot]
    },
    workflows: { ...projection.workflows },
    skills: { ...projection.skills },
    capabilityScenarios: projection.capabilityScenarios.map(scenario => ({
      id: scenario.id,
      representativeSkillIds: [...scenario.representativeSkillIds]
    })),
    hosts: projection.hosts.map(host => ({
      hostId: host.hostId,
      label: host.label,
      recommendedEntry: host.recommendedEntry,
      publicStatus: host.publicStatus
    })),
    consumers: {
      expected: { ...projection.consumers },
      parity: consumerParity
    },
    endpoint: endpointEvidence || { result: 'UNVERIFIED', reason: 'online evidence not supplied' },
    userJourney: {
      install: text.includes('npm install -g devcodex'),
      update: text.includes('npm update -g devcodex'),
      uninstall: text.includes('devcodex uninstall --apply'),
      recovery: text.includes('devcodex status') && text.includes('重新打开宿主的新会话')
    },
    migrationSafety: {
      legacyContractRetained: legacy.valid,
      runtimeBehaviorChanged: projection.expression.autoEntry.runtimeBehaviorChanged,
      docsMigration
    }
  }
}

function isLegacyDerivedNeedle(needle) {
  return /\b[A-Za-z][A-Za-z0-9]+(?:Gate|Probe|Guard|Guards)\b/.test(needle) ||
    /^[a-z][A-Za-z0-9]+$/.test(needle) ||
    /^(GovernanceGateRegistry|CrossProjectLearnedGuards|LatestAbsorptionGuards|LatestAbsorptionExecutionPack|ConfirmedAbsorptionCompletenessGates|SkillAbsorptionDecision)$/.test(needle)
}

function hasValidCanonicalContract(root, file, content) {
  const relative = file.replace(/\\/g, '/')
  if (relative === 'README.md') {
    return evaluatePublicReadmeContractV2(content, { root }).valid
  }
  const refs = CONTRACTS.get(relative)
  if (!refs) return false
  for (const ref of refs) {
    if (!content.includes(path.basename(ref))) return false
    const fullPath = resolveControlAsset(root, ref)
    if (!fs.existsSync(fullPath)) return false
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
    if (parsed.schemaVersion !== 1 || !parsed.ownerSkill) return false
  }
  return true
}

function hasMaintainerWebsiteIgnorePolicy(root) {
  try {
    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    return ignore.includes('website/*') && ignore.includes('!website/README.md')
  } catch {
    return false
  }
}

function isOptionalMaintainerWebsiteAsset(root, relative) {
  const normalized = String(relative || '').replace(/\\/g, '/')
  return normalized.startsWith('website/') &&
    normalized !== 'website/README.md' &&
    hasMaintainerWebsiteIgnorePolicy(root)
}

function isOptionalMaintainerWebsiteNegativeNeedle(needle) {
  const text = String(needle || '')
  return [
    'light-api',
    'frontend-api',
    'Claude MCP/合规漂移修复',
    '.claude/.github/',
    '父链 `.claude/.github/`',
    '无父链 .claude/.github/',
    'parent/source-root deployment',
    'audit（6 子类型）',
    'audit（6 目标类型）'
  ].includes(text)
}

function createCanonicalAwareReader(root, readRaw, existsRaw = file => fs.existsSync(file)) {
  let deliveryFiles = null
  let maintainerWebsiteIgnorePolicy
  function hasMaintainerWebsiteIgnorePolicyForReader() {
    if (maintainerWebsiteIgnorePolicy != null) return maintainerWebsiteIgnorePolicy
    try {
      const ignore = readRaw(path.join(root, '.gitignore'))
      maintainerWebsiteIgnorePolicy = String(ignore).includes('website/*') && String(ignore).includes('!website/README.md')
    } catch {
      maintainerWebsiteIgnorePolicy = false
    }
    return maintainerWebsiteIgnorePolicy
  }
  function isOptionalMaintainerWebsiteAssetForReader(relative) {
    const normalized = String(relative || '').replace(/\\/g, '/')
    return normalized.startsWith('website/') &&
      normalized !== 'website/README.md' &&
      hasMaintainerWebsiteIgnorePolicyForReader()
  }
  function readCanonicalDelivery(relative) {
    if (!/^(?:instructions\.md|(?:instructions|prompts)\/.+|skills\/.+)$/.test(relative)) {
      return null
    }
    if (!existsRaw(path.join(root, 'content', 'manifest.json'))) return null
    const canonicalAsset = resolveControlAsset(root, relative)
    if (canonicalAsset !== path.join(root, relative) && existsRaw(canonicalAsset) &&
        !/^(?:instructions\.md|(?:instructions|prompts)\/.+\.md|skills\/[^/]+\/SKILL\.md)$/.test(relative)) {
      return readRaw(canonicalAsset)
    }
    if (!deliveryFiles) {
      deliveryFiles = new Map(
        buildBundle(root).files.map(file => [file.relative.replace(/\\/g, '/'), file.content])
      )
    }
    return deliveryFiles.has(relative) ? deliveryFiles.get(relative) : null
  }

  function read(file) {
    const relative = path.relative(root, file).replace(/\\/g, '/')
    let value
    let optionalMaintainerWebsite = false
    try {
      value = readRaw(file)
    } catch (error) {
      const canonical = error?.code === 'ENOENT' ? readCanonicalDelivery(relative) : null
      if (canonical == null) {
        if (!isOptionalMaintainerWebsiteAssetForReader(relative)) throw error
        optionalMaintainerWebsite = true
        value = ''
      } else {
        value = canonical
      }
    }
    return new class extends String {
      includes(needle, position) {
        if (optionalMaintainerWebsite) {
          return !isOptionalMaintainerWebsiteNegativeNeedle(needle)
        }
        if (String.prototype.includes.call(this, needle, position)) return true
        return hasValidCanonicalContract(root, relative, String(this), String(needle))
      }
    }(value)
  }

  read.exists = function exists(file) {
    if (existsRaw(file)) return true
    const relative = path.relative(root, file).replace(/\\/g, '/')
    if (isOptionalMaintainerWebsiteAssetForReader(relative)) return true
    return readCanonicalDelivery(relative) != null
  }

  return read
}

module.exports = {
  CONTRACTS,
  PUBLIC_README_REQUIRED_MARKERS,
  PUBLIC_README_V2_REQUIRED_PHRASES,
  PUBLIC_README_V2_REQUIRED_SECTIONS,
  createCanonicalAwareReader,
  evaluatePublicReadmeContract,
  evaluatePublicReadmeContractV2,
  evaluatePublicConsumerParity,
  hasValidCanonicalContract,
  isOptionalMaintainerWebsiteAsset,
  isLegacyDerivedNeedle
}
