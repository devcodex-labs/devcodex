'use strict'

const assert = require('assert')
const { assessRepairPrevention, requiredMode } = require('./lib/repair-prevention-assessment')

function base(overrides = {}) {
  return {
    schemaVersion: 'RepairPreventionAssessmentV1',
    repairId: 'repair-001',
    taskId: 'task-001',
    problemCluster: 'first-observed-contract-drift',
    riskClass: 'normal',
    riskTags: [],
    mode: 'light',
    repeatEscape: false,
    defectRootCause: 'consumer retained a legacy current-writer contract',
    controlFailure: 'current-consumer probe did not bind writer version',
    escapedFrom: ['implementation'],
    detectedAt: 'verification',
    preventionDecision: 'new-control-provisional',
    regressionSeeds: ['legacy-only current consumer'],
    negativeCases: ['legacy-only fixture must fail'],
    controlOwner: 'repair-prevention-assessment',
    consumers: ['fix-default', 'test-router'],
    immediateClosureEvidence: ['focused regression exit 0'],
    prospectiveEvidencePlan: {
      status: 'planned',
      currentEventOnly: true,
      comparableWorkUnits: 0,
      independentContexts: 0,
      metricGaming: false,
      rollbackReady: true,
      authority: 'future comparable repair work units'
    },
    rollbackOrSunset: {
      rollbackTriggers: ['false-positive budget exceeded'],
      sunsetCriteria: ['upstream contract removes legacy reader'],
      reviewAt: 'after 3 comparable work units'
    },
    ...overrides
  }
}

function expectValid(sample, label) {
  const result = assessRepairPrevention(sample)
  assert.strictEqual(result.valid, true, `${label}: ${result.errors.join(', ')}`)
  assert.strictEqual(result.immediateClosureEligible, true, `${label}: immediate closure`)
  return result
}

function expectError(sample, code, label) {
  const result = assessRepairPrevention(sample)
  assert.strictEqual(result.valid, false, `${label}: should fail`)
  assert(result.errors.includes(code), `${label}: expected ${code}, got ${result.errors.join(', ')}`)
}

const first = expectValid(base(), 'first repair')
assert.strictEqual(first.lifecycleState, 'gray')
assert.strictEqual(first.effectivenessStatus, 'retrospective-only')
assert.strictEqual(requiredMode(base()), 'light')

const repeat = expectValid(base({
  repeatEscape: true,
  riskClass: 'high',
  riskTags: ['control-plane'],
  mode: 'full',
  problemCluster: 'known-contract-drift',
  whyMissed: 'known fixture was not attached to the current consumer',
  authorizationEvidence: 'approved repair scope',
  independentReReviewPlan: 'black-box contract replay'
}), 'repeat escape')
assert.strictEqual(repeat.requiredMode, 'full')
expectError(base({ repeatEscape: true, preventionDecision: 'no-new-control' }), 'full-mode-required', 'repeat light mode')

expectValid(base({
  preventionDecision: 'no-new-control',
  noNewControlReason: 'existing-effective-control',
  noNewControlEvidence: ['failure was an isolated execution deviation and the existing probe failed as designed'],
  prospectiveEvidencePlan: {
    status: 'not-required',
    currentEventOnly: true,
    comparableWorkUnits: 0,
    independentContexts: 0,
    metricGaming: false,
    rollbackReady: true,
    authority: 'existing active control remains authoritative'
  }
}), 'no new control')
expectError(base({ preventionDecision: 'no-new-control' }), 'no-new-control-reason-invalid', 'unreasoned no-new-control')

const emergency = expectValid(base({
  riskClass: 'critical',
  riskTags: ['p0', 'security'],
  mode: 'full',
  preventionDecision: 'emergency-active',
  whyMissed: 'critical exploit path was absent from the release matrix',
  authorizationEvidence: 'P0 emergency policy',
  independentReReviewPlan: 'security owner replay',
  emergencyAuthorizationEvidence: 'P0 incident commander authorization',
  prospectiveEvidencePlan: {
    status: 'collecting',
    currentEventOnly: true,
    comparableWorkUnits: 0,
    independentContexts: 0,
    metricGaming: false,
    rollbackReady: true,
    authority: 'post-incident security trial'
  }
}), 'emergency active')
assert.strictEqual(emergency.lifecycleState, 'active-expiring')
expectError(base({ preventionDecision: 'emergency-active' }), 'emergency-active-risk-ineligible', 'ineligible emergency')

expectError(base({ rollbackOrSunset: { rollbackTriggers: [], sunsetCriteria: [], reviewAt: '' } }), 'rollback-triggers-required', 'rollback missing')
expectError(base({
  prospectiveEvidencePlan: {
    status: 'sufficient',
    currentEventOnly: true,
    comparableWorkUnits: 3,
    independentContexts: 0,
    metricGaming: false,
    rollbackReady: true,
    authority: 'current repair rerun'
  }
}), 'prospective-sufficient-evidence-invalid', 'current rerun promotion')

const prospective = expectValid(base({
  preventionDecision: 'existing-control-restored',
  prospectiveEvidencePlan: {
    status: 'sufficient',
    currentEventOnly: false,
    comparableWorkUnits: 3,
    independentContexts: 1,
    metricGaming: false,
    rollbackReady: true,
    authority: 'three later comparable work units'
  }
}), 'prospective evidence')
assert.strictEqual(prospective.effectivenessStatus, 'prospective-sufficient')

console.log('repair prevention assessment passed: first/repeat/no-new/emergency/rollback/sunset')
