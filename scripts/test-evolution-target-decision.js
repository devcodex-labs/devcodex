#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  createEvolutionTargetDecision,
  validateSerializedEvolutionTargetDecision
} = require('./lib/evolution-target-decision')

const WORKSPACE = path.resolve(__dirname, '..', '..')
const ACTIVE_ROOT = path.join(WORKSPACE, '.devcodex', 'devcodex')
const candidatePath = path.join(WORKSPACE, '.devcodex', 'workspace', 'evolution', 'candidates', 'ev-001.json')
const base = {
  candidateId: 'ev-001',
  activeRoot: ACTIVE_ROOT,
  targetEvidenceRefs: ['governance:workspace-local-default'],
  candidatePath
}

const workspaceDefault = createEvolutionTargetDecision(base)
assert.strictEqual(workspaceDefault.target, 'workspace-local')
assert.strictEqual(workspaceDefault.providerMode, 'host-assisted-local')
assert.strictEqual(workspaceDefault.automationControlPlane, null)
assert.strictEqual(workspaceDefault.candidateResolverEligible, false)
assert.strictEqual(workspaceDefault.validation.valid, true, workspaceDefault.validation.errors.join(', '))

const approvedWorkspace = createEvolutionTargetDecision({
  ...base,
  decision: 'approved',
  activePromotionAuthorized: true,
  activePromotionAuthorizationEvidenceRefs: ['decision:workspace-promotion-approved'],
  activeDestination: path.join(WORKSPACE, '.devcodex', 'workspace', 'skills', 'ev-skill', 'SKILL.md')
})
assert.strictEqual(approvedWorkspace.validation.valid, true, approvedWorkspace.validation.errors.join(', '))

const projectWithoutEvidence = createEvolutionTargetDecision({ ...base, target: 'project-local' })
assert.strictEqual(projectWithoutEvidence.validation.valid, false)
assert(projectWithoutEvidence.validation.errors.includes('project-local-project-specific-evidence-required'))

const approvedProject = createEvolutionTargetDecision({
  ...base,
  target: 'project-local',
  projectSpecificEvidenceRefs: ['profile:project-only-stack'],
  decision: 'approved',
  activePromotionAuthorized: true,
  activePromotionAuthorizationEvidenceRefs: ['decision:project-promotion-approved'],
  activeDestination: path.join(WORKSPACE, '.devcodex', 'devcodex', 'skills', 'ev-skill', 'SKILL.md')
})
assert.strictEqual(approvedProject.validation.valid, true, approvedProject.validation.errors.join(', '))

const upstreamWithoutAuthorization = createEvolutionTargetDecision({ ...base, target: 'upstream-package', maintainerAuthorization: 'missing' })
assert.strictEqual(upstreamWithoutAuthorization.validation.valid, false)
assert(upstreamWithoutAuthorization.validation.errors.includes('upstream-package-maintainer-authorization-required'))

const approvedUpstream = createEvolutionTargetDecision({
  ...base,
  target: 'upstream-package',
  maintainerAuthorization: 'explicit-confirmed',
  maintainerAuthorizationEvidenceRefs: ['user:explicit-upstream-maintainer-route'],
  upstreamPackageRoot: path.join(WORKSPACE, 'devcodex'),
  decision: 'approved',
  activePromotionAuthorized: true,
  activePromotionAuthorizationEvidenceRefs: ['decision:upstream-promotion-approved'],
  activeDestination: path.join(WORKSPACE, 'devcodex', 'content', 'skills', 'ev-skill', 'SKILL.md')
})
assert.strictEqual(approvedUpstream.validation.valid, true, approvedUpstream.validation.errors.join(', '))

const upstreamWithoutAuthorizationEvidence = createEvolutionTargetDecision({
  ...base,
  target: 'upstream-package',
  maintainerAuthorization: 'explicit-confirmed',
  upstreamPackageRoot: path.join(WORKSPACE, 'devcodex')
})
assert.strictEqual(upstreamWithoutAuthorizationEvidence.validation.valid, false)
assert(upstreamWithoutAuthorizationEvidence.validation.errors.includes('upstream-package-maintainer-authorization-evidence-required'))

const approvedWithoutPromotionEvidence = createEvolutionTargetDecision({
  ...base,
  decision: 'approved',
  activePromotionAuthorized: true,
  activeDestination: path.join(WORKSPACE, '.devcodex', 'workspace', 'skills', 'ev-skill', 'SKILL.md')
})
assert.strictEqual(approvedWithoutPromotionEvidence.validation.valid, false)
assert(approvedWithoutPromotionEvidence.validation.errors.includes('approved-active-promotion-authorization-evidence-required'))

const wrongUpstreamRoot = createEvolutionTargetDecision({
  ...approvedUpstream,
  upstreamPackageRoot: path.join(WORKSPACE, 'another-package'),
  validation: undefined
})
assert.strictEqual(wrongUpstreamRoot.validation.valid, false)
assert(wrongUpstreamRoot.validation.errors.includes('upstream-package-activeDestination-invalid'))

const externalMissingContract = createEvolutionTargetDecision({ ...base, providerMode: 'external-automation' })
assert.strictEqual(externalMissingContract.validation.valid, false)
assert(externalMissingContract.validation.errors.includes('external-automation-control-plane-required'))

const externalAutomation = createEvolutionTargetDecision({
  ...base,
  providerMode: 'external-automation',
  automationControlPlane: {
    provider: 'approved-provider',
    model: 'approved-model-version',
    tenantAndPermissionScope: 'tenant-a / current active-root only',
    quotaAndCostBudget: '100k tokens / one run / stop on exceed',
    dataPolicy: 'current project evidence only',
    auditLog: 'evolution/evidence/ev-001.json'
  }
})
assert.strictEqual(externalAutomation.validation.valid, true, externalAutomation.validation.errors.join(', '))

const resolverLeak = createEvolutionTargetDecision({ ...base, candidateResolverEligible: true })
assert.strictEqual(resolverLeak.validation.valid, false)
assert(resolverLeak.validation.errors.includes('candidateResolverEligible-must-be-false'))

const pendingDestinationLeak = createEvolutionTargetDecision({
  ...base,
  activeDestination: path.join(WORKSPACE, '.devcodex', 'workspace', 'skills', 'leak', 'SKILL.md')
})
assert.strictEqual(pendingDestinationLeak.validation.valid, false)
assert(pendingDestinationLeak.validation.errors.includes('non-approved-activeDestination-must-be-null'))

const outsideCandidate = createEvolutionTargetDecision({
  ...base,
  candidatePath: path.join(WORKSPACE, 'other', '.devcodex', 'workspace', 'evolution', 'candidates', 'ev-001.json')
})
assert.strictEqual(outsideCandidate.validation.valid, false)
assert(outsideCandidate.validation.errors.includes('candidatePath-must-use-workspace-evolution-candidates'))

const relativeCandidate = createEvolutionTargetDecision({ ...base, candidatePath: '.devcodex/workspace/evolution/candidates/ev-001.json' })
assert.strictEqual(relativeCandidate.validation.valid, false)
assert(relativeCandidate.validation.errors.includes('candidatePath-must-be-absolute'))

const outsideWorkspacePromotion = createEvolutionTargetDecision({
  ...base,
  decision: 'approved',
  activePromotionAuthorized: true,
  activePromotionAuthorizationEvidenceRefs: ['decision:outside-promotion-probe'],
  activeDestination: path.join(WORKSPACE, 'other', '.devcodex', 'workspace', 'skills', 'ev-skill', 'SKILL.md')
})
assert.strictEqual(outsideWorkspacePromotion.validation.valid, false)
assert(outsideWorkspacePromotion.validation.errors.includes('workspace-local-activeDestination-invalid'))

assert.strictEqual(validateSerializedEvolutionTargetDecision(workspaceDefault).valid, true)
const forgedDecision = JSON.parse(JSON.stringify(workspaceDefault))
forgedDecision.candidatePath = path.join(WORKSPACE, 'outside', 'candidate.json')
forgedDecision.validation = { valid: true, errors: [] }
assert.strictEqual(validateSerializedEvolutionTargetDecision(forgedDecision).valid, false)
const injectedDecision = { ...workspaceDefault, unexpected: true }
assert(validateSerializedEvolutionTargetDecision(injectedDecision).errors.includes('serialized-fields-invalid'))

console.log('evolution target decision passed: workspace default/project evidence/upstream authorization/provider modes/candidate isolation')
