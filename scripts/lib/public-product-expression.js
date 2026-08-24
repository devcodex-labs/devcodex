'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { HOST_IDS, projectionDescriptors } = require('./host-surface-descriptors')
const { GLOBAL_HOST_IDS } = require('./global-host-target')
const { buildHostAdapterCompatibilityMatrix } = require('./always-on-governance')
const { cursorVariantMatrix } = require('./global-host-runtime-verifier')
const {
  publicCategoryCounts,
  validatePublicSkillTaxonomy
} = require('./public-skill-taxonomy')

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..')
const CURRENT_EXPRESSION_SCHEMA = 'PublicProductExpressionV2'
const LEGACY_EXPRESSION_SCHEMA = 'PublicProductExpressionV1'
const CURRENT_PROJECTION_SCHEMA = 'PublicProductProjectionV2'

const V2_CATEGORY_INVARIANTS = Object.freeze([
  'cross-host',
  'AI coding',
  'engineering harness',
  'workflow runtime'
])
const TECHNICAL_DEFINITION_INVARIANTS = Object.freeze([
  'intent-driven',
  'local-first',
  'file-backed',
  'workflow runtime',
  'host-adapter layer'
])
const DEVCODEX_OWNERSHIP = Object.freeze([
  'intent-project-routing',
  'profile-context-memory',
  'progressive-skills',
  'confirmation-authorization',
  'validation',
  'reports-evidence-handoff',
  'cross-host-adapters'
])
const HOST_OWNERSHIP = Object.freeze([
  'model-inference',
  'native-agent-loop',
  'primary-tool-execution',
  'session-transport-lifecycle',
  'authentication',
  'sandbox-environment'
])

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function readJson (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function normalizePublicProductExpression (expression) {
  const sourceSchemaVersion = expression?.schemaVersion || null
  if (sourceSchemaVersion === CURRENT_EXPRESSION_SCHEMA) {
    return {
      expression,
      compatibility: {
        schemaVersion: 'PublicProductExpressionCompatibilityReceiptV1',
        sourceSchemaVersion,
        readMode: 'current-v2',
        modelCapabilityBoundary: 'declared',
        ownershipBoundary: 'declared'
      }
    }
  }
  if (sourceSchemaVersion === LEGACY_EXPRESSION_SCHEMA) {
    return {
      expression,
      compatibility: {
        schemaVersion: 'PublicProductExpressionCompatibilityReceiptV1',
        sourceSchemaVersion,
        readMode: 'legacy-v1-read-only',
        modelCapabilityBoundary: 'UNVERIFIED',
        ownershipBoundary: 'UNVERIFIED'
      }
    }
  }
  const error = new Error(`Unsupported public product expression schema: ${sourceSchemaVersion || 'missing'}`)
  error.code = 'PUBLIC_PRODUCT_EXPRESSION_SCHEMA_UNSUPPORTED'
  throw error
}

function canonicalizeTextForDigest (value) {
  return String(value).replace(/\r\n?/g, '\n')
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
  const taxonomyPath = resolveExisting(root, [
    'content/skills/public-taxonomy.json',
    'skills/public-taxonomy.json'
  ])
  const normalizedExpression = normalizePublicProductExpression(readJson(expressionPath))
  return {
    packagePath,
    expressionPath,
    workflowPath,
    portfolioPath,
    taxonomyPath,
    package: readJson(packagePath),
    expression: normalizedExpression.expression,
    expressionCompatibility: normalizedExpression.compatibility,
    workflow: readJson(workflowPath),
    portfolio: readJson(portfolioPath),
    taxonomy: readJson(taxonomyPath)
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

function validatePublicSkillCatalog (portfolio, taxonomy, taxonomyDigest) {
  const errors = []
  const skills = Array.isArray(portfolio?.skills) ? portfolio.skills : []
  const projectedTaxonomy = portfolio?.publicTaxonomy || {}
  const sourceTaxonomy = taxonomy || {
    ...projectedTaxonomy,
    assignments: skills.map(skill => ({
      skillId: skill.id,
      publicCategory: skill.publicCategory
    }))
  }
  errors.push(...validatePublicSkillTaxonomy(sourceTaxonomy, skills).map(issue => `public-skill-${issue}`))

  if (taxonomy) {
    const sourceProjection = {
      schemaVersion: taxonomy.schemaVersion,
      registrySource: taxonomy.registrySource,
      assignmentKey: taxonomy.assignmentKey,
      extensionPolicy: taxonomy.extensionPolicy,
      categories: taxonomy.categories
    }
    if (JSON.stringify(projectedTaxonomy) !== JSON.stringify(sourceProjection)) {
      errors.push('public-skill-taxonomy-projection-stale')
    }
    const sourceAssignments = new Map((taxonomy.assignments || []).map(item => [item.skillId, item.publicCategory]))
    for (const skill of skills) {
      if (sourceAssignments.get(skill.id) !== skill.publicCategory) {
        errors.push(`public-skill-assignment-stale:${skill.id}`)
      }
    }
  }

  if (taxonomyDigest && portfolio?.generatedFrom?.publicTaxonomyDigest !== taxonomyDigest) {
    errors.push('public-skill-taxonomy-digest-stale')
  }
  const counts = publicCategoryCounts(skills, projectedTaxonomy.categories || [])
  if (JSON.stringify(portfolio?.summary?.publicCategoryCounts || {}) !== JSON.stringify(counts)) {
    errors.push('public-skill-category-counts-stale')
  }
  if (Object.values(counts).reduce((total, count) => total + count, 0) !== skills.length) {
    errors.push('public-skill-category-counts-not-bijective')
  }
  return errors
}

function buildPublicSkillProjection (portfolio) {
  const catalog = portfolio.skills.map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    lifecycleState: skill.lifecycleState,
    publicCategory: skill.publicCategory
  }))
  const byId = new Map(catalog.map(skill => [skill.id, skill]))
  const categories = portfolio.publicTaxonomy.categories.map(category => {
    const categorySkills = catalog.filter(skill => skill.publicCategory === category.id)
    return {
      id: category.id,
      label: category.label,
      description: category.description,
      count: categorySkills.length,
      active: categorySkills.filter(skill => skill.lifecycleState === 'active').length,
      gray: categorySkills.filter(skill => skill.lifecycleState === 'gray').length,
      representativeSkills: category.representativeSkillIds.map(skillId => ({ ...byId.get(skillId) }))
    }
  })
  return {
    categoryCounts: { ...portfolio.summary.publicCategoryCounts },
    categories,
    catalog,
    extensionPolicy: { ...portfolio.publicTaxonomy.extensionPolicy }
  }
}

function validatePublicProductExpression (expression, workflow, portfolio, taxonomy, taxonomyDigest) {
  const errors = []
  const schemaVersion = expression?.schemaVersion
  if (![CURRENT_EXPRESSION_SCHEMA, LEGACY_EXPRESSION_SCHEMA].includes(schemaVersion)) {
    errors.push('expression-schema-version')
  }
  if (expression?.productId !== 'devcodex') errors.push('expression-product-id')
  if (!expression?.category?.zh || !expression?.category?.en) errors.push('expression-category')
  if (!Array.isArray(expression?.mustNot) || expression.mustNot.length < 5) errors.push('expression-must-not')
  const semanticInvariants = expression?.category?.semanticInvariants || []
  const expectedCategoryInvariants = schemaVersion === CURRENT_EXPRESSION_SCHEMA
    ? V2_CATEGORY_INVARIANTS
    : ['intent-driven', 'AI coding workflow', 'runtime']
  for (const invariant of expectedCategoryInvariants) {
    if (!semanticInvariants.includes(invariant)) errors.push(`expression-semantic-invariant:${invariant}`)
  }
  if (schemaVersion === CURRENT_EXPRESSION_SCHEMA) {
    if (expression.category.zh !== '跨宿主 AI Coding 工程 Harness' ||
      expression.category.en !== 'Cross-host AI Coding Engineering Harness') {
      errors.push('expression-harness-category-drift')
    }
    const technicalInvariants = expression?.technicalDefinition?.semanticInvariants || []
    if (TECHNICAL_DEFINITION_INVARIANTS.some(value => !technicalInvariants.includes(value)) ||
      !expression?.technicalDefinition?.zh || !expression?.technicalDefinition?.en) {
      errors.push('expression-bare-harness-overclaim')
    }
    const modelBoundary = expression?.modelCapabilityBoundary
    const modelFlags = [
      modelBoundary?.changesModelParameters,
      modelBoundary?.changesModelWeights,
      modelBoundary?.changesContextWindow,
      modelBoundary?.changesBaseReasoningCeiling
    ]
    if (modelFlags.some(value => value !== false) ||
      !modelBoundary?.engineeringEffect?.zh || !modelBoundary?.engineeringEffect?.en ||
      !Array.isArray(modelBoundary?.effectMechanisms) || modelBoundary.effectMechanisms.length < 5) {
      errors.push('expression-model-parameter-enhancer-overclaim')
    }
    const devcodexOwns = expression?.ownershipBoundary?.devcodexOwns || []
    const hostOwns = expression?.ownershipBoundary?.hostOwns || []
    if (DEVCODEX_OWNERSHIP.some(value => !devcodexOwns.includes(value))) {
      errors.push('expression-devcodex-ownership-boundary')
    }
    if (HOST_OWNERSHIP.some(value => !hostOwns.includes(value))) {
      errors.push('expression-host-ownership-boundary')
    }
    for (const value of ['model-parameter-enhancer', 'native-agent-loop-replacement']) {
      if (!expression.mustNot.includes(value)) errors.push(`expression-must-not-boundary:${value}`)
    }
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
  errors.push(...validatePublicSkillCatalog(portfolio, taxonomy, taxonomyDigest))
  if (JSON.stringify(HOST_IDS) !== JSON.stringify(GLOBAL_HOST_IDS)) errors.push('host-owner-identity-conflict')
  const hostKeys = Object.keys(expression?.hostPresentation || {}).sort()
  if (JSON.stringify(hostKeys) !== JSON.stringify([...HOST_IDS].sort())) errors.push('host-presentation-coverage')
  const discovery = expression?.discoveryPolicy || {}
  const packageKeywords = Array.isArray(discovery.packageKeywords) ? discovery.packageKeywords : []
  const githubTopics = Array.isArray(discovery.githubTopics) ? discovery.githubTopics : []
  const forbidden = Array.isArray(discovery.forbiddenConcepts) ? discovery.forbiddenConcepts : []
  if (JSON.stringify(packageKeywords) !== JSON.stringify(githubTopics)) errors.push('discovery-surface-drift')
  if (packageKeywords.some(keyword => forbidden.includes(keyword))) errors.push('discovery-forbidden-concept')
  if (schemaVersion === CURRENT_EXPRESSION_SCHEMA &&
    (!packageKeywords.includes('workflow-runtime') || !packageKeywords.includes('coding-harness'))) {
    errors.push('discovery-harness-runtime-pair-missing')
  }
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

/**
 * Builds the public projection from stable product semantics and current machine owners.
 * Dynamic workflow, Skill, host, version, and external endpoint facts are never copied
 * back into the stable expression file.
 */
function buildPublicProductProjection (options = {}) {
  const root = options.root || DEFAULT_ROOT
  const sources = loadSources(root)
  const taxonomyDigest = sha256(canonicalizeTextForDigest(fs.readFileSync(sources.taxonomyPath, 'utf8')))
  const errors = validatePublicProductExpression(
    sources.expression,
    sources.workflow,
    sources.portfolio,
    sources.taxonomy,
    taxonomyDigest
  )
  if (errors.length) {
    const error = new Error(`Invalid ${sources.expression.schemaVersion || 'public product expression'}: ${errors.join(', ')}`)
    error.code = 'PUBLIC_PRODUCT_EXPRESSION_INVALID'
    error.issues = errors
    throw error
  }
  const canonical = workflowIds(sources.workflow)
  const summary = sources.portfolio.summary
  const publicSkills = buildPublicSkillProjection(sources.portfolio)
  const projection = {
    schemaVersion: CURRENT_PROJECTION_SCHEMA,
    release: {
      version: sources.package.version
    },
    expression: sources.expression,
    expressionCompatibility: { ...sources.expressionCompatibility },
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
      bucket: `${Math.floor(summary.skillCount / 10) * 10}+`,
      ...publicSkills
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
      portfolio: sha256(fs.readFileSync(sources.portfolioPath)),
      taxonomy: taxonomyDigest
    }
  }
  return projection
}

module.exports = {
  DEFAULT_ROOT,
  CURRENT_EXPRESSION_SCHEMA,
  CURRENT_PROJECTION_SCHEMA,
  buildPublicProductProjection,
  buildPublicSkillProjection,
  loadSources,
  normalizePublicProductExpression,
  validateCapabilityScenarios,
  validatePublicProductExpression,
  validatePublicSkillCatalog,
  validateRoutePresentation,
  validateWorkflowPresentation
}
