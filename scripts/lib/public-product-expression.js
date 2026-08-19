'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { HOST_IDS, projectionDescriptors } = require('./host-surface-descriptors')
const { GLOBAL_HOST_IDS } = require('./global-host-target')
const { buildHostAdapterCompatibilityMatrix } = require('./always-on-governance')
const { cursorVariantMatrix } = require('./global-host-runtime-verifier')

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..')

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function readJson (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function resolveExisting (root, candidates) {
  const found = candidates.map(candidate => path.join(root, candidate)).find(file => fs.existsSync(file))
  if (!found) throw new Error(`Missing public product source: ${candidates.join(' or ')}`)
  return found
}

function loadSources (root = DEFAULT_ROOT) {
  const packagePath = path.join(root, 'package.json')
  const expressionPath = path.join(root, 'public-product-expression.json')
  const workflowPath = resolveExisting(root, [
    'content/skills/routing/workflow-capabilities.json',
    'skills/routing/workflow-capabilities.json'
  ])
  const portfolioPath = resolveExisting(root, [
    'content/skills/portfolio.json',
    'skills/portfolio.json'
  ])
  return {
    packagePath,
    expressionPath,
    workflowPath,
    portfolioPath,
    package: readJson(packagePath),
    expression: readJson(expressionPath),
    workflow: readJson(workflowPath),
    portfolio: readJson(portfolioPath)
  }
}

function workflowIds (workflow) {
  return (workflow.workflows || []).map(item => item.id)
}

function validateWorkflowPresentation (presentation, canonicalIds) {
  const primary = Array.isArray(presentation?.primary) ? presentation.primary : []
  const advanced = Array.isArray(presentation?.advanced) ? presentation.advanced : []
  const presented = [...primary, ...advanced]
  const errors = []
  if (new Set(presented).size !== presented.length) errors.push('workflow-presentation-duplicate')
  const expected = [...canonicalIds].sort()
  const actual = [...presented].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push('workflow-presentation-not-bijective')
  if (presented.includes('plan')) errors.push('plan-promoted-to-canonical-workflow')
  return errors
}

function validateRoutePresentation (presentation) {
  const errors = []
  const fields = ['userTaskSubtypes', 'internalStepRouteKeys', 'auditTargets']
  const values = {}
  for (const field of fields) {
    values[field] = Array.isArray(presentation?.[field]) ? presentation[field] : []
    if (!Array.isArray(presentation?.[field])) errors.push(`route-presentation-${field}-missing`)
    if (new Set(values[field]).size !== values[field].length) {
      errors.push(`route-presentation-${field}-duplicate`)
    }
  }
  const all = fields.flatMap(field => values[field])
  if (new Set(all).size !== all.length) errors.push('route-presentation-layer-overlap')
  if (values.userTaskSubtypes.includes('dev.plan-review')) {
    errors.push('plan-review-promoted-to-user-subtype')
  }
  if (values.userTaskSubtypes.some(routeKey => !/^(dev|fix|analyze)\./.test(routeKey))) {
    errors.push('route-presentation-user-subtype-prefix')
  }
  if (values.internalStepRouteKeys.some(routeKey => routeKey !== 'dev.plan-review')) {
    errors.push('route-presentation-internal-step-unknown')
  }
  if (values.auditTargets.some(routeKey => !routeKey.startsWith('audit.'))) {
    errors.push('route-presentation-audit-target-prefix')
  }
  return errors
}

function validateCapabilityScenarios (scenarios, portfolio) {
  const errors = []
  if (!Array.isArray(scenarios) || scenarios.length !== 4) {
    return ['capability-scenario-count']
  }

  const seenIds = new Set()
  const skillById = new Map((portfolio?.skills || []).map(skill => [skill.id, skill]))
  const requiredFields = ['userProblem', 'userOutcome', 'skillFocus', 'workflowBoundary', 'nextHref']
  for (const [index, scenario] of scenarios.entries()) {
    const hasScenarioId = typeof scenario?.id === 'string' && Boolean(scenario.id.trim())
    const scenarioId = hasScenarioId ? scenario.id.trim() : `index-${index}`
    if (!hasScenarioId) {
      errors.push(`capability-scenario-id:${index}`)
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenarioId)) {
      errors.push(`capability-scenario-id-format:${scenarioId}`)
    } else if (seenIds.has(scenarioId)) {
      errors.push(`capability-scenario-duplicate-id:${scenarioId}`)
    }
    seenIds.add(scenarioId)

    for (const field of requiredFields) {
      if (typeof scenario?.[field] !== 'string' || !scenario[field].trim()) {
        errors.push(`capability-scenario-${field}:${scenarioId}`)
      }
    }
    if (typeof scenario?.nextHref === 'string' &&
      (!scenario.nextHref.startsWith('/') || scenario.nextHref.startsWith('//'))) {
      errors.push(`capability-scenario-next-href:${scenarioId}`)
    }

    const skillIds = Array.isArray(scenario?.representativeSkillIds)
      ? scenario.representativeSkillIds
      : []
    if (!skillIds.length) {
      errors.push(`capability-scenario-skill-ids:${scenarioId}`)
    }
    if (new Set(skillIds).size !== skillIds.length) {
      errors.push(`capability-scenario-skill-duplicate:${scenarioId}`)
    }
    for (const skillId of skillIds) {
      if (typeof skillId !== 'string' || !skillId.trim()) {
        errors.push(`capability-scenario-skill-id:${scenarioId}`)
        continue
      }
      const skill = skillById.get(skillId)
      if (!skill) {
        errors.push(`capability-scenario-skill-missing:${skillId}`)
      } else if (skill.lifecycleState !== 'active') {
        errors.push(`capability-scenario-skill-not-active:${skillId}`)
      }
    }

    const scenarioText = [
      scenario?.userProblem,
      scenario?.userOutcome,
      scenario?.skillFocus,
      scenario?.workflowBoundary
    ].filter(value => typeof value === 'string').join(' ')
    if (/(?:全部|所有|全量).{0,8}(?:skill|技能).{0,8}(?:加载|生效)|all\s+skills?\s+(?:are\s+)?(?:loaded|active)/i.test(scenarioText)) {
      errors.push(`capability-scenario-overclaim:${scenarioId}`)
    }
  }
  return errors
}

function hostVariantsFor (hostId, compatibility, cursorVariants) {
  const match = compatibility.hosts.filter(item => {
    if (hostId === 'copilot') return item.hostId.startsWith('copilot-')
    if (hostId === 'claude') return item.hostId === 'claude-code'
    if (hostId === 'codex') return item.hostId === 'codex'
    if (hostId === 'gemini') return item.hostId === 'gemini-cli'
    if (hostId === 'grok') return item.hostId.startsWith('grok-')
    if (hostId === 'cursor') return item.hostId === 'cursor'
    return false
  })
  if (hostId !== 'cursor') return match
  return match.concat(cursorVariants.map(item => ({
    hostId: item.id,
    scope: item.id === 'cursor-cloud-agent' ? 'cloud' : 'local',
    hardBlockCapability: item.support,
    mcpCapability: 'see-runtime-owner',
    ao3ClaimLevel: item.nativeStatus,
    validationRoute: ['global-host-runtime-verifier'],
    fallback: item.evidence
  })))
}

function buildHostProjection (expression) {
  const compatibility = buildHostAdapterCompatibilityMatrix()
  const cursorVariants = cursorVariantMatrix()
  const descriptorHosts = new Set(
    projectionDescriptors(HOST_IDS)
      .map(item => item.surface)
      .filter(item => HOST_IDS.includes(item))
  )
  return HOST_IDS.map(hostId => {
    const variants = hostVariantsFor(hostId, compatibility, cursorVariants)
    const presentation = expression.hostPresentation[hostId]
    return {
      hostId,
      label: presentation.label,
      recommendedEntry: presentation.recommendedEntry,
      publicStatus: presentation.publicStatus,
      installedSurfacePresent: descriptorHosts.has(hostId),
      identityOwner: 'scripts/lib/host-surface-descriptors.js',
      installOwner: 'scripts/lib/global-host-target.js',
      capabilityOwner: 'scripts/lib/always-on-governance.js',
      variantOwner: hostId === 'cursor'
        ? 'scripts/lib/global-host-runtime-verifier.js'
        : 'scripts/lib/always-on-governance.js',
      variants: variants.map(item => item.hostId),
      evidenceCeilings: Array.from(new Set(variants.map(item => item.ao3ClaimLevel))).sort(),
      validationRoutes: Array.from(new Set(variants.flatMap(item => item.validationRoute || []))).sort()
    }
  })
}

function validatePublicProductExpression (expression, workflow, portfolio) {
  const errors = []
  if (expression?.schemaVersion !== 'PublicProductExpressionV1') errors.push('expression-schema-version')
  if (expression?.productId !== 'devcodex') errors.push('expression-product-id')
  if (!expression?.category?.zh || !expression?.category?.en) errors.push('expression-category')
  if (!Array.isArray(expression?.mustNot) || expression.mustNot.length < 5) errors.push('expression-must-not')
  const semanticInvariants = expression?.category?.semanticInvariants || []
  for (const invariant of ['intent-driven', 'AI coding workflow', 'runtime']) {
    if (!semanticInvariants.includes(invariant)) errors.push(`expression-semantic-invariant:${invariant}`)
  }
  if (expression?.autoEntry?.canonical !== '@devcodex-auto') errors.push('expression-auto-canonical')
  if (expression?.autoEntry?.defaultShortcut !== '@rocky') errors.push('expression-auto-shortcut')
  if (expression?.autoEntry?.runtimeBehaviorChanged !== false) errors.push('expression-auto-runtime-drift')
  errors.push(...validateWorkflowPresentation(expression?.workflowPresentation, workflowIds(workflow)))
  errors.push(...validateRoutePresentation(workflow?.routePresentation))
  errors.push(...validateCapabilityScenarios(expression?.capabilityScenarios, portfolio))
  const summary = portfolio?.summary || {}
  if (summary.skillCount !== summary.activeSkillCount + summary.graySkillCount) errors.push('portfolio-lifecycle-count')
  if (summary.skillCount !== (portfolio?.skills || []).length) errors.push('portfolio-skill-count')
  if (JSON.stringify(HOST_IDS) !== JSON.stringify(GLOBAL_HOST_IDS)) errors.push('host-owner-identity-conflict')
  const hostKeys = Object.keys(expression?.hostPresentation || {}).sort()
  if (JSON.stringify(hostKeys) !== JSON.stringify([...HOST_IDS].sort())) errors.push('host-presentation-coverage')
  const discovery = expression?.discoveryPolicy || {}
  const packageKeywords = Array.isArray(discovery.packageKeywords) ? discovery.packageKeywords : []
  const githubTopics = Array.isArray(discovery.githubTopics) ? discovery.githubTopics : []
  const forbidden = Array.isArray(discovery.forbiddenConcepts) ? discovery.forbiddenConcepts : []
  if (JSON.stringify(packageKeywords) !== JSON.stringify(githubTopics)) errors.push('discovery-surface-drift')
  if (packageKeywords.some(keyword => forbidden.includes(keyword))) errors.push('discovery-forbidden-concept')
  const consumers = Object.values(expression?.consumers || {})
  if (consumers.length < 7 || consumers.some(value => typeof value !== 'string' || !value.trim())) {
    errors.push('expression-consumer-coverage')
  }
  const consumerText = consumers.join('\n').toLowerCase()
  if (forbidden.some(value => consumerText.includes(String(value).toLowerCase()))) {
    errors.push('expression-consumer-forbidden-concept')
  }
  if (expression?.endpointPolicy?.repositoryFallback !== expression?.repository) {
    errors.push('endpoint-repository-fallback-drift')
  }
  return errors
}

function buildProjectionMarkers (projection) {
  const hostVariantCount = projection.hosts.reduce((total, host) => total + host.variants.length, 0)
  return {
    workflows: `<!-- devcodex-public:workflows primary=${projection.workflows.primary.join(',')} advanced=${projection.workflows.advanced.join(',')} -->`,
    skills: `<!-- devcodex-public:skills total=${projection.skills.total} active=${projection.skills.active} gray=${projection.skills.gray} bucket=${projection.skills.bucket} -->`,
    hosts: `<!-- devcodex-public:hosts ids=${projection.hosts.map(item => item.hostId).join(',')} variants=${hostVariantCount} -->`,
    auto: `<!-- devcodex-public:auto canonical=${projection.expression.autoEntry.canonical} default=${projection.expression.autoEntry.defaultShortcut} profile-replacement=true empty-array-disables=true -->`,
    capabilities: `<!-- devcodex-public:capabilities ids=${projection.capabilityScenarios.map(item => item.id).join(',')} -->`
  }
}

/**
 * Builds the public projection from stable product semantics and current machine owners.
 * Dynamic workflow, Skill, host, version, and external endpoint facts are never copied
 * back into the stable expression file.
 */
function buildPublicProductProjection (options = {}) {
  const root = options.root || DEFAULT_ROOT
  const sources = loadSources(root)
  const errors = validatePublicProductExpression(sources.expression, sources.workflow, sources.portfolio)
  if (errors.length) {
    const error = new Error(`Invalid PublicProductExpressionV1: ${errors.join(', ')}`)
    error.code = 'PUBLIC_PRODUCT_EXPRESSION_INVALID'
    error.issues = errors
    throw error
  }
  const canonical = workflowIds(sources.workflow)
  const summary = sources.portfolio.summary
  const projection = {
    schemaVersion: 'PublicProductProjectionV1',
    release: {
      version: sources.package.version
    },
    expression: sources.expression,
    workflows: {
      canonical,
      primary: [...sources.expression.workflowPresentation.primary],
      advanced: [...sources.expression.workflowPresentation.advanced],
      routeLayers: {
        userTaskSubtypes: [...sources.workflow.routePresentation.userTaskSubtypes],
        internalStepRouteKeys: [...sources.workflow.routePresentation.internalStepRouteKeys],
        auditTargets: [...sources.workflow.routePresentation.auditTargets]
      }
    },
    skills: {
      total: summary.skillCount,
      active: summary.activeSkillCount,
      gray: summary.graySkillCount,
      bucket: `${Math.floor(summary.skillCount / 10) * 10}+`
    },
    capabilityScenarios: sources.expression.capabilityScenarios.map(scenario => ({
      ...scenario,
      representativeSkillIds: [...scenario.representativeSkillIds]
    })),
    hosts: buildHostProjection(sources.expression),
    consumers: { ...sources.expression.consumers },
    endpoints: { ...sources.expression.endpointPolicy },
    sourceIdentities: {
      package: sha256(fs.readFileSync(sources.packagePath)),
      expression: sha256(fs.readFileSync(sources.expressionPath)),
      workflows: sha256(fs.readFileSync(sources.workflowPath)),
      portfolio: sha256(fs.readFileSync(sources.portfolioPath))
    }
  }
  projection.markers = buildProjectionMarkers(projection)
  return projection
}

module.exports = {
  DEFAULT_ROOT,
  buildProjectionMarkers,
  buildPublicProductProjection,
  loadSources,
  validateCapabilityScenarios,
  validatePublicProductExpression,
  validateRoutePresentation,
  validateWorkflowPresentation
}
