#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  classifyAgentCompletenessSample,
  classifyConsumerValidationSample,
  classifyDesignFitnessSample,
  classifyDocsAudienceSequenceSample,
  classifyModulePerformanceSample,
  classifyValidationFindingRepairSample
} = require('./lib/validate-consumer-evolution-controls')

assert.strictEqual(classifyAgentCompletenessSample({ completenessObject: 'kernel', requestChain: true, feedbackChain: true, crossCutting: true, domainMatrixComplete: true }), 'complete-for-declared-object')
assert.strictEqual(classifyAgentCompletenessSample({ completenessObject: 'enterprise-saas', requestChain: true, feedbackChain: true, crossCutting: true, domainMatrixComplete: true }), 'incomplete')
assert.strictEqual(classifyDocsAudienceSequenceSample({ generatedEvidence: false }), 'unverified')
assert.strictEqual(classifyDocsAudienceSequenceSample({ generatedEvidence: true, pageRolesComplete: true, firstScreenCurrentUser: true, firstTwoSidebarCurrentUser: true, quickStartDistance: 3, quickStartBudget: 2, manualTocOutlineDuplicates: 0 }), 'fail')

const acceptedDenominators = ['feature', 'scenario', 'adapter', 'impact', 'performance', 'release'].map(id => ({ id, applicable: true, state: 'accepted' }))
assert.strictEqual(classifyConsumerValidationSample({ repositoryBinding: true, identityFresh: true, artifactFresh: true, dependencyResolution: true, packedArtifact: true, crossRepositoryCI: true, denominators: acceptedDenominators }), 'accepted')
assert.strictEqual(classifyConsumerValidationSample({ repositoryBinding: true, identityFresh: true, artifactFresh: true, dependencyResolution: true, packedArtifact: true, crossRepositoryCI: true, driftDetected: true, denominators: acceptedDenominators }), 'stale')

const fitFeature = { applicable: true, userTask: true, recommendedPath: true, defaults: true, configurationLayering: true, frameworkConvention: true, publicSurface: true, lifecycle: true, composition: true, compatibilityAuthority: true, maintenanceCost: true, evidence: true, decision: 'accepted' }
assert.strictEqual(classifyDesignFitnessSample({ features: [fitFeature] }), 'accepted')
assert.strictEqual(classifyDesignFitnessSample({ features: [{ ...fitFeature, frameworkConvention: false }] }), 'partial')
assert.strictEqual(classifyConsumerValidationSample({ repositoryBinding: true, identityFresh: true, artifactFresh: true, dependencyResolution: true, packedArtifact: true, crossRepositoryCI: true, denominators: acceptedDenominators, designFitnessApplicable: true, designFitness: { features: [{ ...fitFeature, maintenanceCost: false }] } }), 'partial')

const repairLoop = { findingBound: true, authorizedRepair: true, oldEvidenceStale: true, newIdentityFrozen: true, failedProbeRerun: true, peerBoundaryRerun: true, impactRegressionRerun: true, beforeAfterFresh: true }
assert.strictEqual(classifyValidationFindingRepairSample(repairLoop), 'closed')
assert.strictEqual(classifyValidationFindingRepairSample({ ...repairLoop, oldEvidenceStale: false }), 'incomplete')
assert.strictEqual(classifyValidationFindingRepairSample({ ...repairLoop, fullConsumerRequired: true, fullConsumerRerun: false }), 'incomplete')

const fullModule = { applicable: true, workload: true, budget: true, immutableBaseline: true, candidateComparison: true, capacity: true, resource: true, recovery: true, state: 'accepted' }
assert.strictEqual(classifyModulePerformanceSample({ features: [fullModule], maintenanceTriggers: true, evidenceGovernance: true }), 'accepted')
assert.strictEqual(classifyModulePerformanceSample({ features: [{ ...fullModule, recovery: false }], maintenanceTriggers: true, evidenceGovernance: true }), 'partial')

const root = path.resolve(__dirname, '..')
for (const file of ['skills/consumer-validation-engineering/SKILL.md', 'skills/consumer-validation-engineering/agents/openai.yaml']) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`)
}

console.log('✓ V95 consumer evolution positive and negative controls passed')
