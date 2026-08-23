'use strict'

const crypto = require('crypto')
const path = require('path')

const TARGETS = new Set(['workspace-local', 'project-local', 'upstream-package'])
const PROVIDER_MODES = new Set(['host-assisted-local', 'external-automation'])
const DECISIONS = new Set(['pending', 'approved', 'rejected'])
const AUTOMATION_KEYS = [
  'provider', 'model', 'tenantAndPermissionScope', 'quotaAndCostBudget', 'dataPolicy', 'auditLog'
]
const INPUT_KEYS = new Set([
  'candidateId', 'activeRoot', 'providerMode', 'target', 'targetEvidenceRefs',
  'projectSpecificEvidenceRefs', 'maintainerAuthorization', 'maintainerAuthorizationEvidenceRefs',
  'automationControlPlane',
  'candidatePath', 'activeDestination', 'upstreamPackageRoot', 'candidateResolverEligible', 'decision',
  'activePromotionAuthorized', 'activePromotionAuthorizationEvidenceRefs'
])
const SERIALIZED_KEYS = Object.freeze([
  'schemaVersion', 'decisionId', ...INPUT_KEYS, 'validation'
])

function text(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function textList(value, { nonEmpty = false } = {}) {
  return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every(text) && new Set(value).size === value.length
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function containedChild(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function resolveWorkspaceRuntimeRoot(activeRoot) {
  if (!text(activeRoot) || !path.isAbsolute(activeRoot)) return null
  const resolved = path.resolve(activeRoot)
  const parent = path.dirname(resolved)
  if (path.basename(parent).toLowerCase() !== '.devcodex') return null
  return path.basename(resolved).toLowerCase() === 'workspace'
    ? resolved
    : path.join(parent, 'workspace')
}

function createEvolutionTargetDecision(input = {}) {
  const source = {
    candidateId: input.candidateId,
    activeRoot: input.activeRoot,
    providerMode: input.providerMode || 'host-assisted-local',
    target: input.target || 'workspace-local',
    targetEvidenceRefs: input.targetEvidenceRefs || [],
    projectSpecificEvidenceRefs: input.projectSpecificEvidenceRefs || [],
    maintainerAuthorization: input.maintainerAuthorization || 'not-required',
    maintainerAuthorizationEvidenceRefs: input.maintainerAuthorizationEvidenceRefs || [],
    automationControlPlane: input.automationControlPlane ?? null,
    candidatePath: input.candidatePath,
    activeDestination: input.activeDestination ?? null,
    upstreamPackageRoot: input.upstreamPackageRoot ?? null,
    candidateResolverEligible: input.candidateResolverEligible ?? false,
    decision: input.decision || 'pending',
    activePromotionAuthorized: input.activePromotionAuthorized ?? false,
    activePromotionAuthorizationEvidenceRefs: input.activePromotionAuthorizationEvidenceRefs || []
  }
  const errors = []
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) errors.push(`unsupported-field:${key}`)
  }
  if (!text(source.candidateId)) errors.push('candidateId-required')
  if (!text(source.activeRoot) || !path.isAbsolute(source.activeRoot)) errors.push('activeRoot-must-be-absolute')
  const workspaceRuntimeRoot = resolveWorkspaceRuntimeRoot(source.activeRoot)
  if (!workspaceRuntimeRoot) errors.push('activeRoot-workspace-runtime-unresolved')
  if (!PROVIDER_MODES.has(source.providerMode)) errors.push('providerMode-invalid')
  if (!TARGETS.has(source.target)) errors.push('target-invalid')
  if (!textList(source.targetEvidenceRefs, { nonEmpty: true })) errors.push('targetEvidenceRefs-required')
  if (!textList(source.projectSpecificEvidenceRefs)) errors.push('projectSpecificEvidenceRefs-invalid')
  if (!['not-required', 'explicit-confirmed', 'missing'].includes(source.maintainerAuthorization)) {
    errors.push('maintainerAuthorization-invalid')
  }
  if (!textList(source.maintainerAuthorizationEvidenceRefs)) errors.push('maintainerAuthorizationEvidenceRefs-invalid')
  if (!text(source.candidatePath) || !path.isAbsolute(source.candidatePath)) {
    errors.push('candidatePath-must-be-absolute')
  } else if (!workspaceRuntimeRoot || !containedChild(path.join(workspaceRuntimeRoot, 'evolution', 'candidates'), source.candidatePath)) {
    errors.push('candidatePath-must-use-workspace-evolution-candidates')
  }
  if (source.candidateResolverEligible !== false) errors.push('candidateResolverEligible-must-be-false')
  if (!DECISIONS.has(source.decision)) errors.push('decision-invalid')
  if (typeof source.activePromotionAuthorized !== 'boolean') errors.push('activePromotionAuthorized-invalid')
  if (!textList(source.activePromotionAuthorizationEvidenceRefs)) {
    errors.push('activePromotionAuthorizationEvidenceRefs-invalid')
  }

  if (source.providerMode === 'host-assisted-local') {
    if (source.automationControlPlane !== null) errors.push('host-assisted-local-automationControlPlane-must-be-null')
  } else if (!source.automationControlPlane || typeof source.automationControlPlane !== 'object' || Array.isArray(source.automationControlPlane)) {
    errors.push('external-automation-control-plane-required')
  } else {
    const actualKeys = Object.keys(source.automationControlPlane).sort()
    if (actualKeys.join('|') !== AUTOMATION_KEYS.slice().sort().join('|')) errors.push('external-automation-control-plane-fields-invalid')
    for (const key of AUTOMATION_KEYS) {
      if (!text(source.automationControlPlane[key])) errors.push(`automationControlPlane.${key}-required`)
    }
  }

  if (source.target === 'project-local' && !source.projectSpecificEvidenceRefs.length) {
    errors.push('project-local-project-specific-evidence-required')
  }
  if (source.target === 'upstream-package' && source.maintainerAuthorization !== 'explicit-confirmed') {
    errors.push('upstream-package-maintainer-authorization-required')
  }
  if (source.target === 'upstream-package' && !source.maintainerAuthorizationEvidenceRefs.length) {
    errors.push('upstream-package-maintainer-authorization-evidence-required')
  }
  if (source.target !== 'upstream-package' && source.maintainerAuthorization !== 'not-required') {
    errors.push('local-target-maintainer-authorization-must-be-not-required')
  }
  if (source.target !== 'upstream-package' && source.maintainerAuthorizationEvidenceRefs.length) {
    errors.push('local-target-maintainer-authorization-evidence-forbidden')
  }
  if (source.target === 'upstream-package') {
    if (!text(source.upstreamPackageRoot) || !path.isAbsolute(source.upstreamPackageRoot)) {
      errors.push('upstream-package-root-must-be-absolute')
    }
  } else if (source.upstreamPackageRoot !== null) {
    errors.push('local-target-upstreamPackageRoot-must-be-null')
  }

  if (source.decision === 'approved') {
    if (source.activePromotionAuthorized !== true) errors.push('approved-active-promotion-required')
    if (!source.activePromotionAuthorizationEvidenceRefs.length) {
      errors.push('approved-active-promotion-authorization-evidence-required')
    }
    if (!text(source.activeDestination)) errors.push('approved-activeDestination-required')
    if (text(source.activeDestination) && !path.isAbsolute(source.activeDestination)) {
      errors.push('approved-activeDestination-must-be-absolute')
    }
    if (source.target === 'workspace-local' && (!workspaceRuntimeRoot ||
      !containedChild(path.join(workspaceRuntimeRoot, 'skills'), source.activeDestination || workspaceRuntimeRoot))) {
      errors.push('workspace-local-activeDestination-invalid')
    }
    if (source.target === 'project-local' && (!path.isAbsolute(source.activeRoot || '') ||
      !containedChild(path.join(source.activeRoot, 'skills'), source.activeDestination || source.activeRoot))) {
      errors.push('project-local-activeDestination-invalid')
    }
    if (source.target === 'upstream-package' && (!text(source.upstreamPackageRoot) ||
      !path.isAbsolute(source.upstreamPackageRoot) ||
      !containedChild(path.join(source.upstreamPackageRoot, 'content', 'skills'), source.activeDestination || source.upstreamPackageRoot))) {
      errors.push('upstream-package-activeDestination-invalid')
    }
  } else {
    if (source.activePromotionAuthorized !== false) errors.push('non-approved-active-promotion-forbidden')
    if (source.activePromotionAuthorizationEvidenceRefs.length) {
      errors.push('non-approved-active-promotion-authorization-evidence-forbidden')
    }
    if (source.activeDestination !== null) errors.push('non-approved-activeDestination-must-be-null')
  }

  const decisionId = `evolution-target-${digest(source)}`
  return {
    schemaVersion: 'EvolutionTargetDecisionV1',
    decisionId,
    ...source,
    validation: { valid: errors.length === 0, errors }
  }
}

function validateSerializedEvolutionTargetDecision(value = {}) {
  const errors = []
  if (!hasExactKeys(value, SERIALIZED_KEYS)) errors.push('serialized-fields-invalid')
  if (value.schemaVersion !== 'EvolutionTargetDecisionV1') errors.push('serialized-schemaVersion-invalid')
  const source = Object.fromEntries([...INPUT_KEYS].map(key => [key, value[key]]))
  const canonical = createEvolutionTargetDecision(source)
  if (!canonical.validation.valid) {
    errors.push(...canonical.validation.errors.map(error => `serialized.${error}`))
  }
  if (value.decisionId !== canonical.decisionId) errors.push('serialized-decisionId-mismatch')
  for (const key of INPUT_KEYS) {
    if (JSON.stringify(stableValue(value[key])) !== JSON.stringify(stableValue(canonical[key]))) {
      errors.push(`serialized-${key}-mismatch`)
    }
  }
  if (!hasExactKeys(value.validation, ['valid', 'errors']) ||
      JSON.stringify(value.validation) !== JSON.stringify(canonical.validation)) {
    errors.push('serialized-validation-mismatch')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], canonical }
}

module.exports = {
  createEvolutionTargetDecision,
  digest,
  resolveWorkspaceRuntimeRoot,
  validateSerializedEvolutionTargetDecision
}
