'use strict'

const fs = require('fs')
const path = require('path')

const {
  sha256
} = require('./progressive-skill-route-contract.cjs')

const DEFAULT_REGISTRY_PATH = path.join(__dirname, 'workflow-root-registry.v1.json')
const DIGEST_RE = /^[a-f0-9]{64}$/
const CONDITION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

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
  validateWorkflowRootRegistry,
  loadWorkflowRootRegistry,
  routeKeyForContext,
  resolveWorkflowRoots,
  mergeRoots
}
