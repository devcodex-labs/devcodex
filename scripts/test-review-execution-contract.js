'use strict'

const assert = require('assert')
const {
  FRESHNESS_FIELDS,
  createReviewEvidenceReceipt,
  createReviewExecutionPlan,
  createReviewStateSnapshot,
  createStageTiming,
  evaluateEvidenceSaturation,
  evaluateReceiptFreshness,
  evaluateStableReceiptOracle,
  projectReviewState,
  selectReviewClass,
  stableReceiptSample
} = require('../hooks/_runtime/review-execution-contract.cjs')

function plan(overrides = {}) {
  return createReviewExecutionPlan({
    workflow: 'dev',
    stage: 'ecr',
    userIntent: 'verify changed and affected closure',
    candidateDigest: 'candidate-a',
    changedSet: ['a.js'],
    affectedClosure: ['a.js', 'consumer.js'],
    risk: { class: 'high', flags: ['control-plane'] },
    claims: ['behavior-preserved'],
    dimensions: ['contract'],
    freshEvidence: ['evidence-a'],
    staleEvidence: [],
    exclusions: [],
    ...overrides
  })
}

function receipt(reviewPlan, overrides = {}) {
  const values = {
    planId: reviewPlan.planId,
    candidateDigest: reviewPlan.candidateDigest,
    stage: reviewPlan.stage,
    scopeDigest: reviewPlan.scopeDigest,
    dimension: 'contract',
    claim: 'behavior-preserved',
    lens: 'changed-affected-v1',
    ruleVersion: 'rules-v1',
    skillVersion: 'review-skill-v1',
    probeVersion: 'probe-v1',
    impactGraphDigest: 'impact-a',
    environmentDigest: 'env-a',
    intentDigest: reviewPlan.intentDigest,
    riskDigest: reviewPlan.riskDigest,
    dependencyDigest: 'deps-a',
    consumerDigest: 'consumers-a',
    command: 'node test.js',
    environment: 'node20-win32',
    runId: 'run-a',
    result: 'passed',
    evidenceRefs: ['evidence-a'],
    blockerCount: 0,
    openCount: 0,
    ...overrides
  }
  return createReviewEvidenceReceipt(values)
}

const highSmall = plan()
assert.strictEqual(highSmall.validation.valid, true)
assert.strictEqual(highSmall.reviewClass, 'R3', 'small file count must not lower high-risk review')
assert.strictEqual(selectReviewClass({ workflow: 'unknown', stage: 'ecr', risk: { class: 'normal', flags: [] } }).reviewClass, 'R4')
assert.strictEqual(plan({ stage: 'unknown' }).validation.valid, false)
assert.strictEqual(plan({ risk: { class: 'mystery', flags: [] } }).escalation.fullRequired, true)
assert.strictEqual(plan({ affectedClosure: ['consumer.js'] }).validation.errors.includes('changed-set-outside-affected-closure'), true)

const goodReceipt = receipt(highSmall)
assert.strictEqual(goodReceipt.validation.valid, true)
assert.strictEqual(goodReceipt.reuseEligibility, true)
const binding = Object.fromEntries(FRESHNESS_FIELDS.map(field => [field, goodReceipt[field]]))
assert.strictEqual(evaluateReceiptFreshness(goodReceipt, binding).fresh, true)
assert.strictEqual(evaluateReceiptFreshness(goodReceipt, { ...binding, candidateDigest: 'candidate-b' }).fresh, false)
assert.strictEqual(evaluateReceiptFreshness(goodReceipt, { ...binding, dependencyDigest: 'deps-b' }).fresh, false)
assert.strictEqual(createReviewEvidenceReceipt({ ...goodReceipt, result: 'failed' }).reuseEligibility, false)

const oracle = evaluateStableReceiptOracle([goodReceipt], { [goodReceipt.receiptDigest]: 'passed' })
assert.strictEqual(oracle.status, 'passed')
assert.strictEqual(stableReceiptSample(Array.from({ length: 100 }, (_, index) => ({ ...goodReceipt, receiptDigest: `r-${index}` }))).length, 5)
assert.strictEqual(evaluateStableReceiptOracle([goodReceipt], { [goodReceipt.receiptDigest]: 'failed' }).status, 'full-required')

const saturationInput = {
  receipts: [goodReceipt],
  unreviewedRelatedSet: [],
  openCount: 0,
  blockerCount: 0,
  independentEvidencePassed: true,
  negativeEvidencePassed: true,
  fallbackEvidencePassed: true,
  dirtyBoundaryMatches: true,
  zeroFindingRounds: 1,
  oracle
}
const saturation = evaluateEvidenceSaturation(highSmall, saturationInput)
assert.strictEqual(saturation.status, 'passed', saturation.reasons.join(', '))
assert.strictEqual(evaluateEvidenceSaturation(highSmall, { ...saturationInput, dirtyBoundaryMatches: false }).status, 'full-required')
assert.strictEqual(evaluateEvidenceSaturation(highSmall, { ...saturationInput, receipts: [] }).status, 'full-required')
assert.strictEqual(evaluateEvidenceSaturation(highSmall, { ...saturationInput, unreviewedRelatedSet: [{ item: 'x' }] }).status, 'full-required')
assert.strictEqual(evaluateEvidenceSaturation(highSmall, { ...saturationInput, unreviewedRelatedSet: [{ item: 'x', reason: 'out of scope', authority: 'CP1', upgradeCondition: 'scope changes' }] }).status, 'passed')

const snapshot = createReviewStateSnapshot(highSmall, {
  saturation,
  receiptDigests: [goodReceipt.receiptDigest],
  open: 0,
  blocker: 0,
  stale: 0,
  unreviewed: 0,
  dirtyBoundary: 'matched'
})
assert.strictEqual(snapshot.nextAction, 'accept')
const projections = ['checklist', 'report', 'memory', 'progress', 'final'].map(surface => projectReviewState(snapshot, surface))
assert.strictEqual(new Set(projections.map(item => item.snapshotDigest)).size, 1)
assert.strictEqual(new Set(projections.map(item => JSON.stringify(item.state))).size, 1)
assert.throws(() => projectReviewState(snapshot, 'unknown'), /unsupported review projection/)

const timing = createStageTiming({
  planning: 10,
  read: 20,
  evidenceExecution: 30,
  reasoning: 'N/A',
  stateMaterialization: 5,
  reporting: 5,
  externalWait: 10,
  total: 80,
  clockBasis: 'monotonic command timers; reasoning unobservable'
})
assert.strictEqual(timing.validation.valid, true)
assert.strictEqual(timing.total, 80)
assert.strictEqual(createStageTiming({ ...timing, total: 81 }).validation.valid, false)

console.log('review execution contract passed: routing/freshness/saturation/oracle/projection/timing')
