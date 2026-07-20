#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  classifyBaseImpactAdmissionSample,
  classifyBatchScopeRebindSample,
  classifyContractMutationSample,
  classifyDurableBatchSample,
  classifyIsolatedConsumerCwdSample,
  classifyPhaseDeliverySample,
  classifyReleaseEfficiencySample,
  classifyScenarioCoverageSample
} = require('./lib/validate-residual-absorption-controls')

const release = { candidateFrozen: true, candidateIdentity: 'sha', evidenceDependencyGraph: true, budgetMode: 'advisory' }
assert.strictEqual(classifyReleaseEfficiencySample(release), 'accepted')
assert.strictEqual(classifyReleaseEfficiencySample({ ...release, reuseRequested: true, identityMatch: false }), 'invalid-reuse')
assert.strictEqual(classifyReleaseEfficiencySample({ ...release, overBudget: true, incidentCreated: false }), 'incident-required')
assert.strictEqual(classifyReleaseEfficiencySample({ ...release, overBudget: true, incidentCreated: true }), 'accepted-with-incident')

const isolatedConsumer = { explicitConsumerManifest: true, consumerCwdBound: true, sourceIdentityBefore: 'tree', sourceIdentityAfter: 'tree', usedNpmInitPrefix: false, commandCwdMatchesConsumer: true, sourceMutationObserved: false }
assert.strictEqual(classifyIsolatedConsumerCwdSample(isolatedConsumer), 'accepted')
assert.strictEqual(classifyIsolatedConsumerCwdSample({ ...isolatedConsumer, usedNpmInitPrefix: true }), 'unsafe')
assert.strictEqual(classifyIsolatedConsumerCwdSample({ ...isolatedConsumer, sourceIdentityAfter: 'changed' }), 'contaminated')

const batch = { phaseTotalScope: true, allowedFirstBatch: true, actualTargetSet: true, blockedScope: true, dirtyBoundary: true, currentBatchOnly: true, blockedScopeTouched: false, rollbackAuthorized: true }
assert.strictEqual(classifyBatchScopeRebindSample(batch), 'pass')
assert.strictEqual(classifyBatchScopeRebindSample({ ...batch, blockedScopeTouched: true }), 'blocked')

const baseAdmission = {
  changeId: 'PI-140',
  servedIntent: 'keep base stable',
  currentGap: 'no admission classifier',
  absorptionDecision: 'existing-skill-subgate',
  baseClass: 'base-compatible',
  affectedContracts: ['spec-absorption'],
  unaffectedIntents: ['ordinary-chat'],
  consumers: ['spec-absorption'],
  fanout: 1,
  defaultPathDelta: { addsAlwaysOn: false },
  fallbackBehavior: 'legacy path unchanged',
  rollback: 'remove subgate and probe',
  positiveProbe: 'accepted sample',
  negativeProbe: 'base-changing sample',
  disabledOrMisconfiguredProbe: 'missing consumer sample',
  complexityDelta: { runtime: 0, maintenance: 1 },
  replacementOrRetirementCredit: 'retire duplicate local rule',
  owner: 'spec-absorption',
  reviewAt: 'next release',
  deprecationAndDeletionCondition: 'delete when stronger owner replaces it'
}
assert.strictEqual(classifyBaseImpactAdmissionSample(baseAdmission), 'accepted')
assert.strictEqual(classifyBaseImpactAdmissionSample({ ...baseAdmission, consumers: [] }), 'no-consumer')
assert.strictEqual(classifyBaseImpactAdmissionSample({ ...baseAdmission, defaultPathDelta: { addsAlwaysOn: true } }), 'misclassified-base-change')

const contract = { applicable: true, variantIsolationExecuted: true, completionDeletionExecuted: true, schemaSemanticParity: true, docsRuntimeParity: true, siblingFieldAccepted: false, missingCompletionEvidenceAccepted: false }
assert.strictEqual(classifyContractMutationSample(contract), 'pass')
assert.strictEqual(classifyContractMutationSample({ ...contract, missingCompletionEvidenceAccepted: true }), 'escaped')

const phase = { phaseKind: 'implementation', originalIntentTraced: true, planningCoverageExplicit: true, sourceDeliveryExplicit: true, entryExitAligned: true, confirmationAligned: true, closeRule: true, sourceDeliveryClaimed: true }
assert.strictEqual(classifyPhaseDeliverySample(phase), 'pass')
assert.strictEqual(classifyPhaseDeliverySample({ ...phase, phaseKind: 'planning-only' }), 'inconsistent')

const scenario = { inScope: true, scenarioId: 'S1', audienceGoal: 'ship', topology: 'worker', trigger: 'input', config: 'cfg', execute: 'run', expectedState: 'done', failure: 'crash', recovery: 'resume', observe: 'trace', executableEvidence: 'test', status: 'complete', runtimeRequired: true, runtimeExecuted: true }
assert.strictEqual(classifyScenarioCoverageSample({ scenarios: [scenario] }), 'complete')
assert.strictEqual(classifyScenarioCoverageSample({ scenarios: [{ ...scenario, recovery: '' }] }), 'partial')

const durable = { applicable: true, sourceExhaustion: true, persistentCheckpoint: true, boundedPacing: true, atomicAggregation: true, durableCompletion: true, coordinatorRecovery: true, workerRecovery: true, backpressure: true, replayEvidence: true }
assert.strictEqual(classifyDurableBatchSample(durable), 'accepted')
assert.strictEqual(classifyDurableBatchSample({ ...durable, persistentCheckpoint: false }), 'partial')

console.log('✓ V96 residual absorption positive and negative controls passed')
