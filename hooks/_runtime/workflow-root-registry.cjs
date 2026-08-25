'use strict'

const fs = require('fs')
const path = require('path')

const {
  sha256
} = require('./progressive-skill-route-contract.cjs')

const DEFAULT_REGISTRY_PATH = path.join(__dirname, 'workflow-root-registry.v1.json')
const DEFAULT_REGISTRY_V2_PATH = path.join(__dirname, 'workflow-root-registry.v2.json')
const DIGEST_RE = /^[a-f0-9]{64}$/
const CONDITION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const EXPECTED_V2_ROUTE_KEYS = Object.freeze([
  'dev.default',
  'dev.refactor',
  'dev.database',
  'dev.init',
  'dev.optimization',
  'dev.scenario-test',
  'dev.docs',
  'dev.plan-review',
  'fix.default',
  'fix.security',
  'fix.incident',
  'audit.规范文件',
  'audit.技术方案',
  'audit.需求文档',
  'audit.项目工程',
  'audit.报告',
  'audit.通用文档',
  'audit.发布前审查',
  'analyze.default',
  'analyze.research',
  'self-fix',
  'other',
  'chat',
  'resume'
])

function hasOnlyKeys (value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key))
}

function validateRoot (root) {
  return hasOnlyKeys(root, ['skillId', 'budgetClass', 'loadStage']) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(root.skillId || '')) &&
    ['hard', 'optional'].includes(root.budgetClass) &&
    /^(entry|closeout|execution:[A-Za-z0-9._-]+)$/.test(root.loadStage)
}

function validateWorkflowRootRegistry (registry) {
  const errors = []
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return { valid: false, errors: ['registry-object-required'] }
  }
  if (!hasOnlyKeys(registry, [
    'schemaVersion',
    'sourceEvidence',
    'sourceDigest',
    'baseBundles',
    'routes',
    'conditionals',
    'registryDigest'
  ])) errors.push('top-level-fields')
  if (registry.schemaVersion !== 'WorkflowRootRegistryV1') errors.push('schema-version')
  if (!Array.isArray(registry.sourceEvidence) ||
      registry.sourceEvidence.length < 3 ||
      registry.sourceEvidence.length > 16) {
    errors.push('source-evidence')
  } else if (registry.sourceEvidence.some(item =>
    !hasOnlyKeys(item, ['ref', 'digest']) ||
    typeof item.ref !== 'string' ||
    !item.ref.trim() ||
    !DIGEST_RE.test(String(item.digest || ''))
  )) {
    errors.push('source-evidence-item')
  }
  const expectedSourceDigest = sha256(registry.sourceEvidence || [])
  if (!DIGEST_RE.test(String(registry.sourceDigest || '')) ||
      registry.sourceDigest !== expectedSourceDigest) {
    errors.push('source-digest')
  }
  if (!registry.baseBundles || typeof registry.baseBundles !== 'object' ||
      Array.isArray(registry.baseBundles)) errors.push('base-bundles')
  for (const [intent, roots] of Object.entries(registry.baseBundles || {})) {
    if (!intent || !Array.isArray(roots) || roots.length > 16 ||
        roots.some(root => !validateRoot(root))) {
      errors.push(`base-bundle:${intent}`)
    }
  }
  if (!Array.isArray(registry.routes) || !registry.routes.length ||
      registry.routes.length > 64) errors.push('routes')
  const routeKeys = new Set()
  for (const route of registry.routes || []) {
    if (!hasOnlyKeys(route, ['routeKey', 'roots']) ||
        typeof route.routeKey !== 'string' || !route.routeKey.trim() ||
        routeKeys.has(route.routeKey) ||
        !Array.isArray(route.roots) || route.roots.length > 16 ||
        route.roots.some(root => !validateRoot(root))) {
      errors.push(`route:${route?.routeKey || 'invalid'}`)
    }
    routeKeys.add(route?.routeKey)
  }
  const conditionIds = new Set()
  const conditionalGroups = new Map()
  if (!Array.isArray(registry.conditionals) || registry.conditionals.length > 16) {
    errors.push('conditionals')
  }
  for (const condition of registry.conditionals || []) {
    if (!hasOnlyKeys(condition, [
      'conditionId',
      'intents',
      'roots',
      'activationAuthority',
      'mutualExclusionGroup',
      'sourceRef'
    ]) ||
        !CONDITION_ID_RE.test(String(condition?.conditionId || '')) ||
        conditionIds.has(condition.conditionId) ||
        !Array.isArray(condition.intents) || !condition.intents.length ||
        condition.intents.length > 16 ||
        condition.intents.some(intent => typeof intent !== 'string' || !intent.trim()) ||
        new Set(condition.intents).size !== condition.intents.length ||
        !Array.isArray(condition.roots) || !condition.roots.length ||
        condition.roots.length > 16 ||
        condition.roots.some(root => !validateRoot(root)) ||
        condition.activationAuthority !== 'model' ||
        !condition.sourceRef || typeof condition.sourceRef !== 'string' ||
        (condition.mutualExclusionGroup !== null &&
          condition.mutualExclusionGroup !== undefined &&
          (typeof condition.mutualExclusionGroup !== 'string' ||
            !condition.mutualExclusionGroup.trim()))) {
      errors.push(`conditional:${condition?.conditionId || 'invalid'}`)
    }
    conditionIds.add(condition?.conditionId)
    if (condition?.mutualExclusionGroup) {
      conditionalGroups.set(
        condition.mutualExclusionGroup,
        Number(conditionalGroups.get(condition.mutualExclusionGroup) || 0) + 1
      )
    }
  }
  const combinationCount = [...conditionalGroups.values()]
    .reduce((count, alternatives) => count * alternatives, 1)
  if (combinationCount > 64) errors.push('conditional-combination-limit')
  const expectedDigest = sha256({
    schemaVersion: registry.schemaVersion,
    baseBundles: registry.baseBundles,
    routes: registry.routes,
    conditionals: registry.conditionals
  })
  if (!DIGEST_RE.test(String(registry.registryDigest || '')) ||
      registry.registryDigest !== expectedDigest) errors.push('registry-digest')
  return {
    valid: errors.length === 0,
    errors,
    expectedDigest,
    expectedSourceDigest
  }
}

function validateSourceEvidence (registry, errors) {
  if (!Array.isArray(registry.sourceEvidence) ||
      registry.sourceEvidence.length < 3 ||
      registry.sourceEvidence.length > 16) {
    errors.push('source-evidence')
  } else if (registry.sourceEvidence.some(item =>
    !hasOnlyKeys(item, ['ref', 'digest']) ||
    typeof item.ref !== 'string' || !item.ref.trim() ||
    !DIGEST_RE.test(String(item.digest || ''))
  )) {
    errors.push('source-evidence-item')
  }
  const expectedSourceDigest = sha256(registry.sourceEvidence || [])
  if (!DIGEST_RE.test(String(registry.sourceDigest || '')) ||
      registry.sourceDigest !== expectedSourceDigest) errors.push('source-digest')
  return expectedSourceDigest
}

function validateWorkflowPolicyV2 (intent, policy) {
  if (!hasOnlyKeys(policy, [
    'mutationPolicy',
    'cpPolicy',
    'artifactPolicy',
    'verificationPolicy',
    'resumePolicy'
  ])) return false
  if (!['allowed-after-confirmation', 'forbidden', 'inherited'].includes(policy.mutationPolicy)) return false
  if (!hasOnlyKeys(policy.cpPolicy, ['cp1', 'cp2', 'cp3', 'cp3Rule']) ||
      !['required', 'not-applicable', 'inherited'].includes(policy.cpPolicy.cp1) ||
      !['required', 'not-applicable', 'inherited'].includes(policy.cpPolicy.cp2) ||
      !['conditional', 'not-applicable', 'inherited'].includes(policy.cpPolicy.cp3) ||
      typeof policy.cpPolicy.cp3Rule !== 'string' || !policy.cpPolicy.cp3Rule.trim()) return false
  if (!hasOnlyKeys(policy.artifactPolicy, ['primaryArtifacts', 'writePolicy']) ||
      !Array.isArray(policy.artifactPolicy.primaryArtifacts) || policy.artifactPolicy.primaryArtifacts.length > 16 ||
      policy.artifactPolicy.primaryArtifacts.some(value => typeof value !== 'string' || !value.trim()) ||
      policy.artifactPolicy.writePolicy !== policy.mutationPolicy) return false
  if (!hasOnlyKeys(policy.verificationPolicy, ['mode', 'executionAuthorityRequired']) ||
      !['affected-v0-v2', 'read-only', 'inherited-after-rehydrate'].includes(policy.verificationPolicy.mode) ||
      typeof policy.verificationPolicy.executionAuthorityRequired !== 'boolean') return false
  if (!hasOnlyKeys(policy.resumePolicy, ['mode', 'terminalAction']) ||
      !['persist-round-trip', 'rehydrate-return'].includes(policy.resumePolicy.mode) ||
      policy.resumePolicy.terminalAction !== 'unbind') return false
  if (intent === 'resume' && policy.resumePolicy.mode !== 'rehydrate-return') return false
  if (intent !== 'resume' && policy.resumePolicy.mode !== 'persist-round-trip') return false
  return true
}

function intentForRouteKey (routeKey) {
  if (routeKey === 'self-fix') return 'self-fix'
  if (['other', 'chat', 'resume'].includes(routeKey)) return routeKey
  return String(routeKey || '').split('.')[0]
}

function validateRouteV2 (route, workflowPolicies) {
  if (!hasOnlyKeys(route, [
    'routeKey',
    'topIntent',
    'subtype',
    'stage',
    'disposition',
    'routeOwner',
    'roots',
    'policyRef',
    'migration'
  ])) return false
  if (typeof route.routeKey !== 'string' || !route.routeKey.trim() ||
      route.topIntent !== intentForRouteKey(route.routeKey) ||
      typeof route.subtype !== 'string' || !route.subtype.trim() ||
      !['entry', 'internal-step', 'rehydrate'].includes(route.stage) ||
      !['active', 'retired'].includes(route.disposition) ||
      route.policyRef !== route.topIntent || !workflowPolicies[route.policyRef]) return false
  if (!hasOnlyKeys(route.routeOwner, ['kind', 'id']) ||
      !['skill', 'instruction'].includes(route.routeOwner.kind) ||
      typeof route.routeOwner.id !== 'string' || !route.routeOwner.id.trim()) return false
  if (!Array.isArray(route.roots) || route.roots.length > 16 ||
      route.roots.some(root => !validateRoot(root))) return false
  if (route.routeOwner.kind === 'skill' && !route.roots.some(root => root.skillId === route.routeOwner.id)) return false
  if (route.disposition === 'active' && route.migration !== null) return false
  if (route.disposition === 'retired' && (
    !hasOnlyKeys(route.migration, ['routeKey', 'reason']) ||
    typeof route.migration.routeKey !== 'string' || !route.migration.routeKey.trim() ||
    typeof route.migration.reason !== 'string' || !route.migration.reason.trim()
  )) return false
  return true
}

/**
 * Validates the authoritative V2 route registry. V1 remains readable for the
 * progressive-skill compatibility path but cannot satisfy this contract.
 */
function validateWorkflowRootRegistryV2 (registry) {
  const errors = []
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return { valid: false, errors: ['registry-object-required'] }
  }
  if (!hasOnlyKeys(registry, [
    'schemaVersion',
    'sourceEvidence',
    'sourceDigest',
    'environmentModes',
    'workflowPolicies',
    'baseBundles',
    'routes',
    'conditionals',
    'routeRevision',
    'registryDigest'
  ])) errors.push('top-level-fields')
  if (registry.schemaVersion !== 'WorkflowRootRegistryV2') errors.push('schema-version')
  const expectedSourceDigest = validateSourceEvidence(registry, errors)
  if (!Array.isArray(registry.environmentModes) ||
      registry.environmentModes.join(',') !== 'dev,prod') errors.push('environment-modes')
  const expectedIntents = ['analyze', 'audit', 'chat', 'dev', 'fix', 'other', 'resume', 'self-fix']
  const policyIntents = Object.keys(registry.workflowPolicies || {}).sort()
  if (policyIntents.join(',') !== expectedIntents.join(',')) errors.push('workflow-policies')
  for (const intent of policyIntents) {
    if (!validateWorkflowPolicyV2(intent, registry.workflowPolicies[intent])) errors.push(`workflow-policy:${intent}`)
  }
  if (!registry.baseBundles || typeof registry.baseBundles !== 'object' || Array.isArray(registry.baseBundles)) {
    errors.push('base-bundles')
  }
  for (const [intent, roots] of Object.entries(registry.baseBundles || {})) {
    if (!registry.workflowPolicies?.[intent] || !Array.isArray(roots) || roots.length > 16 ||
        roots.some(root => !validateRoot(root))) errors.push(`base-bundle:${intent}`)
  }
  if (!Array.isArray(registry.routes) || registry.routes.length !== EXPECTED_V2_ROUTE_KEYS.length) {
    errors.push('routes')
  }
  const routeKeys = new Set()
  for (const route of registry.routes || []) {
    if (!validateRouteV2(route, registry.workflowPolicies || {}) || routeKeys.has(route?.routeKey)) {
      errors.push(`route:${route?.routeKey || 'invalid'}`)
    }
    routeKeys.add(route?.routeKey)
  }
  const missingRoutes = EXPECTED_V2_ROUTE_KEYS.filter(routeKey => !routeKeys.has(routeKey))
  const unknownRoutes = [...routeKeys].filter(routeKey => !EXPECTED_V2_ROUTE_KEYS.includes(routeKey))
  if (missingRoutes.length) errors.push(`route-missing:${missingRoutes.join('|')}`)
  if (unknownRoutes.length) errors.push(`route-unknown:${unknownRoutes.join('|')}`)
  const activeRoutes = (registry.routes || []).filter(route => route.disposition === 'active')
  for (const route of registry.routes || []) {
    if (route.disposition === 'retired' && !activeRoutes.some(active => active.routeKey === route.migration?.routeKey)) {
      errors.push(`route-migration:${route.routeKey}`)
    }
  }

  const conditionIds = new Set()
  if (!Array.isArray(registry.conditionals) || registry.conditionals.length > 16) errors.push('conditionals')
  for (const condition of registry.conditionals || []) {
    if (!hasOnlyKeys(condition, [
      'conditionId',
      'intents',
      'roots',
      'activationAuthority',
      'mutualExclusionGroup',
      'sourceRef'
    ]) || !CONDITION_ID_RE.test(String(condition?.conditionId || '')) ||
        conditionIds.has(condition.conditionId) ||
        !Array.isArray(condition.intents) || !condition.intents.length || condition.intents.length > 16 ||
        condition.intents.some(intent => !registry.workflowPolicies?.[intent]) ||
        !Array.isArray(condition.roots) || !condition.roots.length || condition.roots.length > 16 ||
        condition.roots.some(root => !validateRoot(root)) || condition.activationAuthority !== 'model' ||
        typeof condition.sourceRef !== 'string' || !condition.sourceRef.trim() ||
        (condition.mutualExclusionGroup !== null && condition.mutualExclusionGroup !== undefined &&
          (typeof condition.mutualExclusionGroup !== 'string' || !condition.mutualExclusionGroup.trim()))) {
      errors.push(`conditional:${condition?.conditionId || 'invalid'}`)
    }
    conditionIds.add(condition?.conditionId)
  }
  const revisionCore = {
    schemaVersion: registry.schemaVersion,
    environmentModes: registry.environmentModes,
    workflowPolicies: registry.workflowPolicies,
    baseBundles: registry.baseBundles,
    routes: registry.routes,
    conditionals: registry.conditionals
  }
  const expectedRouteRevision = sha256(revisionCore)
  if (!DIGEST_RE.test(String(registry.routeRevision || '')) ||
      registry.routeRevision !== expectedRouteRevision) errors.push('route-revision')
  const expectedDigest = sha256({
    ...revisionCore,
    sourceDigest: registry.sourceDigest,
    routeRevision: registry.routeRevision
  })
  if (!DIGEST_RE.test(String(registry.registryDigest || '')) ||
      registry.registryDigest !== expectedDigest) errors.push('registry-digest')
  return {
    valid: errors.length === 0,
    errors,
    expectedDigest,
    expectedRouteRevision,
    expectedSourceDigest
  }
}

function loadWorkflowRootRegistry (options = {}) {
  const fsImpl = options.fs || fs
  const registryPath = path.resolve(options.registryPath || DEFAULT_REGISTRY_PATH)
  let registry
  try {
    registry = JSON.parse(fsImpl.readFileSync(registryPath, 'utf8'))
  } catch (error) {
    const failure = new Error(`WORKFLOW_REGISTRY_READ_FAILED: ${error.message}`)
    failure.code = 'WORKFLOW_REGISTRY_READ_FAILED'
    throw failure
  }
  const validation = validateWorkflowRootRegistry(registry)
  if (!validation.valid) {
    const error = new Error(`WORKFLOW_REGISTRY_STALE: ${validation.errors.join(',')}`)
    error.code = 'WORKFLOW_REGISTRY_STALE'
    error.validation = validation
    throw error
  }
  return { registry, registryPath, validation }
}

function loadWorkflowRouteRegistryV2 (options = {}) {
  const fsImpl = options.fs || fs
  const registryPath = path.resolve(options.registryPath || DEFAULT_REGISTRY_V2_PATH)
  let registry
  try {
    registry = JSON.parse(fsImpl.readFileSync(registryPath, 'utf8'))
  } catch (error) {
    const failure = new Error(`WORKFLOW_REGISTRY_V2_READ_FAILED: ${error.message}`)
    failure.code = 'WORKFLOW_REGISTRY_V2_READ_FAILED'
    throw failure
  }
  const validation = validateWorkflowRootRegistryV2(registry)
  if (!validation.valid) {
    const error = new Error(`WORKFLOW_REGISTRY_V2_STALE: ${validation.errors.join(',')}`)
    error.code = 'WORKFLOW_REGISTRY_V2_STALE'
    error.validation = validation
    throw error
  }
  return { registry, registryPath, validation }
}

function routeKeyForContext (intent, changeTypes = []) {
  const typeSet = new Set(changeTypes || [])
  if (intent === 'dev') {
    if (typeSet.has('docs') || typeSet.has('public-contract')) return 'dev.docs'
    if (typeSet.has('testing')) return 'dev.scenario-test'
    return 'dev.default'
  }
  if (intent === 'fix') {
    if (typeSet.has('security')) return 'fix.security'
    return 'fix.default'
  }
  if (intent === 'analyze') return 'analyze.default'
  if (intent === 'audit') {
    if (typeSet.has('release')) return 'audit.发布前审查'
    if (typeSet.has('docs') || typeSet.has('public-contract')) return 'audit.通用文档'
    return 'audit.项目工程'
  }
  if (intent === 'self-fix') return 'self-fix'
  if (intent === 'chat') return 'chat'
  if (intent === 'resume') return 'resume'
  return 'other'
}

function mergeRoots (rootGroups) {
  const byId = new Map()
  for (const group of rootGroups) {
    for (const root of group.roots || []) {
      const current = byId.get(root.skillId)
      if (!current) {
        byId.set(root.skillId, {
          ...root,
          sources: [group.source]
        })
        continue
      }
      if (!current.sources.includes(group.source)) current.sources.push(group.source)
      if (root.budgetClass === 'hard') current.budgetClass = 'hard'
      const stageRank = stage => stage === 'entry' ? 0 : (stage.startsWith('execution:') ? 1 : 2)
      if (stageRank(root.loadStage) < stageRank(current.loadStage)) current.loadStage = root.loadStage
    }
  }
  return [...byId.values()].sort((left, right) => left.skillId.localeCompare(right.skillId))
}

function resolveWorkflowRoots (context, options = {}) {
  let loaded
  if (options.registry) {
    const validation = validateWorkflowRootRegistry(options.registry)
    if (!validation.valid) {
      const error = new Error(`WORKFLOW_REGISTRY_STALE: ${validation.errors.join(',')}`)
      error.code = 'WORKFLOW_REGISTRY_STALE'
      error.validation = validation
      throw error
    }
    loaded = { registry: options.registry, validation }
  } else {
    loaded = loadWorkflowRootRegistry(options)
  }
  const registry = loaded.registry
  const intent = String(context.finalIntent || context.intent || 'other')
  const routeKey = String(context.routeKey || routeKeyForContext(intent, context.changeTypes))
  const baseRoots = registry.baseBundles[intent]
  const route = registry.routes.find(item => item.routeKey === routeKey)
  if (!Array.isArray(baseRoots) || !route) {
    const error = new Error(`WORKFLOW_ROUTE_NOT_FOUND: ${intent}/${routeKey}`)
    error.code = 'WORKFLOW_ROUTE_NOT_FOUND'
    throw error
  }
  const committedRoots = mergeRoots([
    { source: `base:${intent}`, roots: baseRoots },
    { source: `route:${routeKey}`, roots: route.roots }
  ])
  const availableConditionRules = registry.conditionals
    .filter(condition => condition.intents.includes(intent))
    .map(condition => ({
      ...condition,
      roots: condition.roots.map(root => ({ ...root }))
    }))
  return {
    schemaVersion: 'WorkflowRootResolutionV1',
    finalIntent: intent,
    routeKey,
    registryDigest: registry.registryDigest,
    committedRoots,
    availableConditionRules
  }
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  DEFAULT_REGISTRY_V2_PATH,
  EXPECTED_V2_ROUTE_KEYS,
  validateWorkflowRootRegistry,
  validateWorkflowRootRegistryV2,
  loadWorkflowRootRegistry,
  loadWorkflowRouteRegistryV2,
  routeKeyForContext,
  resolveWorkflowRoots,
  mergeRoots
}
