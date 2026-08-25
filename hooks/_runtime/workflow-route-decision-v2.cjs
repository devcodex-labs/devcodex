'use strict'

const {
  loadWorkflowRouteRegistryV2,
  routeKeyForContext,
  validateWorkflowRootRegistryV2
} = require('./workflow-root-registry.cjs')
const {
  digest,
  validateActualInstructionEnvelope,
  validateWorkItemSet
} = require('./actual-instruction-envelope.cjs')

const WORKFLOW_ROUTE_DECISION_SCHEMA = 'WorkflowRouteDecisionV2'
const DIGEST_RE = /^[a-f0-9]{64}$/
const ENVIRONMENT_MODES = new Set(['dev', 'prod'])
const STAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const DECISION_FIELDS = Object.freeze([
  'schemaVersion',
  'decisionStatus',
  'environmentMode',
  'topIntent',
  'subtype',
  'routeKey',
  'stage',
  'routeRevision',
  'routeRegistryDigest',
  'routeOwner',
  'ownerSkillIds',
  'mutationPolicy',
  'cpPolicy',
  'artifactPolicy',
  'verificationPolicy',
  'resumePolicy',
  'envelopeId',
  'envelopeDigest',
  'workItemId',
  'workItemDigest',
  'provenanceLevel',
  'authorityScope',
  'mutationAuthority',
  'releaseAuthority',
  'decisionDigest'
])

function clone (value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function unique (values) {
  return [...new Set(values.filter(Boolean))]
}

function routeTopIntent (routeKey) {
  const key = String(routeKey || '')
  if (key === 'self-fix') return 'self-fix'
  if (['other', 'chat', 'resume'].includes(key)) return key
  return key.split('.')[0]
}

function selectedRouteKey (input, registry) {
  if (input.routeKey) return String(input.routeKey).trim()
  const topIntent = String(input.topIntent || input.finalIntent || '')
  if (!topIntent) return ''
  if (input.subtype) {
    const exact = `${topIntent}.${String(input.subtype)}`
    if (registry.routes.some(route => route.routeKey === exact)) return exact
  }
  return routeKeyForContext(topIntent, input.changeTypes || [])
}

function ownerSkillIdsForRoute (registry, route) {
  const base = registry.baseBundles[route.topIntent] || []
  return unique([
    route.routeOwner?.kind === 'skill' ? route.routeOwner.id : null,
    ...route.roots.map(root => root.skillId),
    ...base.map(root => root.skillId)
  ]).sort((left, right) => left.localeCompare(right))
}

function requireValidEnvelope (envelope) {
  const validation = validateActualInstructionEnvelope(envelope)
  if (!validation.valid || envelope.instructionAuthority !== true) {
    const error = new Error(`INSTRUCTION_AUTHORITY_UNAVAILABLE: ${validation.errors.join(',')}`)
    error.code = 'INSTRUCTION_AUTHORITY_UNAVAILABLE'
    error.validation = validation
    throw error
  }
}

function requireValidWorkItem (workItemSet, workItemId, envelope) {
  if (!workItemSet) return null
  const validation = validateWorkItemSet(workItemSet, envelope)
  if (!validation.valid) {
    const error = new Error(`WORK_ITEM_SET_INVALID: ${validation.errors.join(',')}`)
    error.code = 'WORK_ITEM_SET_INVALID'
    error.validation = validation
    throw error
  }
  const selected = workItemId
    ? workItemSet.items.find(item => item.workItemId === workItemId)
    : workItemSet.items[0]
  if (!selected) {
    const error = new Error('WORK_ITEM_NOT_FOUND')
    error.code = 'WORK_ITEM_NOT_FOUND'
    throw error
  }
  return selected
}

function registryFromOptions (options) {
  if (options.registry) {
    const validation = validateWorkflowRootRegistryV2(options.registry)
    if (!validation.valid) {
      const error = new Error(`WORKFLOW_REGISTRY_V2_STALE: ${validation.errors.join(',')}`)
      error.code = 'WORKFLOW_REGISTRY_V2_STALE'
      error.validation = validation
      throw error
    }
    return options.registry
  }
  return loadWorkflowRouteRegistryV2(options).registry
}

function unresolvedRoute (reasonCode, detail = '', cause = null) {
  const suffix = detail ? `: ${detail}` : ''
  const error = new Error(`WORKFLOW_ROUTE_UNRESOLVED: ${reasonCode}${suffix}`)
  error.code = 'WORKFLOW_ROUTE_UNRESOLVED'
  error.reasonCode = reasonCode
  if (cause?.code) error.causeCode = cause.code
  return error
}

/**
 * Resolves the exact registry-owned route identity without creating mutation,
 * CP or release authority. Public producers use this same resolver so every
 * declared route is either reachable through structured fields or rejected.
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} options
 * @returns {{registry: object, route: object, policy: object, routeKey: string, topIntent: string, stage: string}}
 */
function resolveWorkflowRouteDescriptor (input = {}, options = {}) {
  let registry
  try {
    registry = registryFromOptions(options)
  } catch (error) {
    throw unresolvedRoute('registry-unavailable', error.code || error.message, error)
  }
  if (input.topIntent != null && input.finalIntent != null &&
      String(input.topIntent).trim() !== String(input.finalIntent).trim()) {
    throw unresolvedRoute('intent-conflict', `${input.topIntent}/${input.finalIntent}`)
  }
  const routeKey = selectedRouteKey(input, registry)
  const route = registry.routes.find(item => item.routeKey === routeKey)
  if (!route) throw unresolvedRoute('route-not-found', routeKey || 'missing')
  const topIntent = String(input.topIntent || input.finalIntent || route.topIntent).trim()
  if (topIntent !== route.topIntent || routeTopIntent(routeKey) !== route.topIntent) {
    throw unresolvedRoute('intent-mismatch', `${topIntent || 'missing'}/${routeKey}`)
  }
  if (input.subtype != null && String(input.subtype).trim() !== route.subtype) {
    throw unresolvedRoute('subtype-mismatch', `${input.subtype}/${route.subtype}`)
  }
  const stage = String(input.stage == null ? route.stage : input.stage).trim()
  if (!STAGE_RE.test(stage) || stage !== route.stage) {
    throw unresolvedRoute('stage-mismatch', `${stage || 'missing'}/${route.stage}`)
  }
  if (input.routeRevision != null && String(input.routeRevision) !== registry.routeRevision) {
    throw unresolvedRoute('route-revision-mismatch', `${input.routeRevision}/${registry.routeRevision}`)
  }
  if (input.routeRegistryDigest != null && String(input.routeRegistryDigest) !== registry.registryDigest) {
    throw unresolvedRoute('registry-digest-mismatch', `${input.routeRegistryDigest}/${registry.registryDigest}`)
  }
  const policy = registry.workflowPolicies[route.policyRef]
  if (!policy) throw unresolvedRoute('policy-missing', route.policyRef)
  return { registry, route, policy, routeKey, topIntent, stage }
}

/**
 * Selects one canonical route from structured intent evidence. Environment mode
 * is carried into the receipt but never participates in route selection.
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} options
 * @returns {Record<string, unknown>}
 */
function buildWorkflowRouteDecision (input = {}, options = {}) {
  const envelope = input.actualInstructionEnvelope
  requireValidEnvelope(envelope)
  const selectedWorkItem = requireValidWorkItem(input.workItemSet, input.workItemId, envelope)
  const environmentMode = String(input.environmentMode || '')
  if (!ENVIRONMENT_MODES.has(environmentMode)) {
    const error = new Error(`WORKFLOW_ENVIRONMENT_MODE_INVALID: ${environmentMode || 'missing'}`)
    error.code = 'WORKFLOW_ENVIRONMENT_MODE_INVALID'
    throw error
  }

  const { registry, route, policy, routeKey, topIntent, stage } = resolveWorkflowRouteDescriptor(input, options)
  if (selectedWorkItem && selectedWorkItem.routeCandidate !== null && selectedWorkItem.routeCandidate !== routeKey) {
    throw unresolvedRoute('work-item-route-mismatch', `${selectedWorkItem.routeCandidate}/${routeKey}`)
  }
  const retired = route.disposition === 'retired'
  const core = {
    schemaVersion: WORKFLOW_ROUTE_DECISION_SCHEMA,
    decisionStatus: retired ? 'retired' : 'selected',
    environmentMode,
    topIntent,
    subtype: route.subtype,
    routeKey,
    stage,
    routeRevision: registry.routeRevision,
    routeRegistryDigest: registry.registryDigest,
    routeOwner: clone(route.routeOwner),
    ownerSkillIds: ownerSkillIdsForRoute(registry, route),
    mutationPolicy: retired ? 'forbidden' : policy.mutationPolicy,
    cpPolicy: clone(policy.cpPolicy),
    artifactPolicy: clone(policy.artifactPolicy),
    verificationPolicy: clone(policy.verificationPolicy),
    resumePolicy: clone(retired ? route.migration : policy.resumePolicy),
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.envelopeDigest,
    workItemId: selectedWorkItem?.workItemId || null,
    workItemDigest: selectedWorkItem?.workItemDigest || null,
    provenanceLevel: envelope.provenanceLevel,
    authorityScope: envelope.authorityScope,
    mutationAuthority: false,
    releaseAuthority: false
  }
  return { ...core, decisionDigest: digest(core) }
}

function routeAndPolicyForDecision (decision, registry) {
  const route = registry.routes.find(item => item.routeKey === decision.routeKey)
  const policy = route ? registry.workflowPolicies[route.policyRef] : null
  return { route, policy }
}

/**
 * Validates all policy and registry bindings rather than trusting a stored
 * decision's status or authority-looking fields.
 * @param {Record<string, unknown>} decision
 * @param {{registry?: Record<string, unknown>, registryPath?: string}} options
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateWorkflowRouteDecision (decision, options = {}) {
  const errors = []
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return { valid: false, errors: ['decision-object-required'] }
  }
  let registry
  try { registry = registryFromOptions(options) } catch (error) {
    return { valid: false, errors: [error.code || 'registry-invalid'] }
  }
  if (!Object.keys(decision).every(key => DECISION_FIELDS.includes(key)) ||
      !DECISION_FIELDS.every(key => Object.prototype.hasOwnProperty.call(decision, key))) errors.push('decision-fields')
  if (decision.schemaVersion !== WORKFLOW_ROUTE_DECISION_SCHEMA) errors.push('schema-version')
  if (!['selected', 'retired'].includes(decision.decisionStatus)) errors.push('decision-status')
  if (!ENVIRONMENT_MODES.has(decision.environmentMode)) errors.push('environment-mode')
  if (!decision.topIntent || typeof decision.topIntent !== 'string') errors.push('top-intent')
  if (!decision.subtype || typeof decision.subtype !== 'string') errors.push('subtype')
  if (!decision.routeKey || typeof decision.routeKey !== 'string') errors.push('route-key')
  if (!STAGE_RE.test(String(decision.stage || ''))) errors.push('stage')
  if (!DIGEST_RE.test(String(decision.routeRevision || '')) || decision.routeRevision !== registry.routeRevision) {
    errors.push('route-revision')
  }
  if (!DIGEST_RE.test(String(decision.routeRegistryDigest || '')) || decision.routeRegistryDigest !== registry.registryDigest) {
    errors.push('registry-digest')
  }
  const { route, policy } = routeAndPolicyForDecision(decision, registry)
  if (!route) errors.push('route-missing')
  if (route && (decision.topIntent !== route.topIntent || decision.subtype !== route.subtype ||
      routeTopIntent(decision.routeKey) !== decision.topIntent)) errors.push('route-identity')
  if (route && decision.stage !== route.stage) errors.push('route-stage')
  if (route && digest(decision.routeOwner) !== digest(route.routeOwner)) errors.push('route-owner')
  if (route && digest(decision.ownerSkillIds) !== digest(ownerSkillIdsForRoute(registry, route))) errors.push('owner-skills')
  const retired = route?.disposition === 'retired'
  if (decision.decisionStatus !== (retired ? 'retired' : 'selected')) errors.push('disposition')
  if (policy) {
    if (decision.mutationPolicy !== (retired ? 'forbidden' : policy.mutationPolicy)) errors.push('mutation-policy')
    if (digest(decision.cpPolicy) !== digest(policy.cpPolicy)) errors.push('cp-policy')
    if (digest(decision.artifactPolicy) !== digest(policy.artifactPolicy)) errors.push('artifact-policy')
    if (digest(decision.verificationPolicy) !== digest(policy.verificationPolicy)) errors.push('verification-policy')
    if (digest(decision.resumePolicy) !== digest(retired ? route.migration : policy.resumePolicy)) errors.push('resume-policy')
  }
  if (!/^aie-[a-f0-9]{40}$/.test(String(decision.envelopeId || '')) || !DIGEST_RE.test(String(decision.envelopeDigest || ''))) {
    errors.push('envelope-binding')
  }
  if ((decision.workItemId === null) !== (decision.workItemDigest === null) ||
      (decision.workItemId !== null && (!/^work-[a-f0-9]{40}$/.test(String(decision.workItemId || '')) ||
        !DIGEST_RE.test(String(decision.workItemDigest || ''))))) errors.push('work-item-binding')
  if (!['trusted-host-event', 'caller-attested-portable'].includes(decision.provenanceLevel)) errors.push('provenance-level')
  if (!['trusted-host-workflow-ingress', 'portable-plan-only'].includes(decision.authorityScope)) errors.push('authority-scope')
  if ((decision.provenanceLevel === 'trusted-host-event') !==
      (decision.authorityScope === 'trusted-host-workflow-ingress')) errors.push('provenance-authority-mismatch')
  if (decision.mutationAuthority !== false) errors.push('mutation-authority')
  if (decision.releaseAuthority !== false) errors.push('release-authority')
  const { decisionDigest, ...core } = decision
  if (!DIGEST_RE.test(String(decisionDigest || '')) || decisionDigest !== digest(core)) errors.push('decision-digest')
  return { valid: errors.length === 0, errors }
}

/**
 * Replays a persisted decision against the current registry and exact optional
 * envelope/work-item bindings.
 * @param {Record<string, unknown>} decision
 * @param {Record<string, unknown>} binding
 * @param {Record<string, unknown>} options
 * @returns {{fresh: boolean, status: string, errors: string[]}}
 */
function verifyWorkflowRouteDecision (decision, binding = {}, options = {}) {
  const errors = [...validateWorkflowRouteDecision(decision, options).errors]
  const exact = [
    ['environmentMode', binding.environmentMode],
    ['envelopeDigest', binding.envelopeDigest],
    ['workItemDigest', binding.workItemDigest],
    ['routeKey', binding.routeKey],
    ['topIntent', binding.topIntent],
    ['subtype', binding.subtype],
    ['stage', binding.stage],
    ['routeRevision', binding.routeRevision],
    ['routeRegistryDigest', binding.routeRegistryDigest]
  ]
  for (const [field, expected] of exact) {
    if (expected != null && decision?.[field] !== expected) errors.push(`${field}-mismatch`)
  }
  if (binding.actualInstructionEnvelope) {
    const envelopeValidation = validateActualInstructionEnvelope(binding.actualInstructionEnvelope)
    if (!envelopeValidation.valid || decision?.envelopeId !== binding.actualInstructionEnvelope.envelopeId ||
        decision?.envelopeDigest !== binding.actualInstructionEnvelope.envelopeDigest) errors.push('envelope-readback')
  }
  if (binding.workItemSet) {
    const setValidation = validateWorkItemSet(binding.workItemSet, binding.actualInstructionEnvelope || null)
    const item = binding.workItemSet.items?.find(candidate => candidate.workItemId === decision?.workItemId)
    if (!setValidation.valid || !item || item.workItemDigest !== decision?.workItemDigest ||
        (item.routeCandidate !== null && item.routeCandidate !== decision?.routeKey)) errors.push('work-item-readback')
  }
  return { fresh: errors.length === 0, status: errors.length ? 'stale' : 'fresh', errors }
}

function rehydrateWorkflowRouteDecision (serialized, binding = {}, options = {}) {
  let decision
  try { decision = typeof serialized === 'string' ? JSON.parse(serialized) : clone(serialized) } catch {
    return { decision: null, fresh: false, status: 'stale', errors: ['decision-json-invalid'] }
  }
  return { decision, ...verifyWorkflowRouteDecision(decision, binding, options) }
}

module.exports = {
  ENVIRONMENT_MODES,
  WORKFLOW_ROUTE_DECISION_SCHEMA,
  buildWorkflowRouteDecision,
  rehydrateWorkflowRouteDecision,
  resolveWorkflowRouteDescriptor,
  routeTopIntent,
  validateWorkflowRouteDecision,
  verifyWorkflowRouteDecision
}
