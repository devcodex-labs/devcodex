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
  requiredAuditZeroFindingRounds,
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
assert.strictEqual(evaluateReceiptFreshness({ ...goodReceipt, openCount: 5 }, binding).fresh, false,
  'a persisted validation flag cannot authenticate changed evidence')

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
const audit = plan({ workflow: 'audit', stage: 'audit' })
const auditReceipt = receipt(audit)
const auditInput = { ...saturationInput, receipts: [auditReceipt], oracle: evaluateStableReceiptOracle([auditReceipt], { [auditReceipt.receiptDigest]: 'passed' }) }
assert.strictEqual(audit.exit.requiredZeroFindingRounds, 3)
assert.notStrictEqual(evaluateEvidenceSaturation(audit, { ...auditInput, zeroFindingRounds: 2 }).status, 'passed')
assert.strictEqual(evaluateEvidenceSaturation(audit, { ...auditInput, zeroFindingRounds: 3 }).status, 'passed')
const narrowFacts = { explicitNarrowScope: true, scaleDecision: 'single-pass', crossHostControlPlane: false, multipleConsumers: false }
const narrow = plan({ workflow: 'audit', stage: 'audit', risk: { class: 'normal', flags: [] }, auditConvergence: narrowFacts })
assert.strictEqual(narrow.exit.requiredZeroFindingRounds, 2)
assert.strictEqual(plan({ workflow: 'audit', stage: 'audit', auditConvergence: narrowFacts }).exit.requiredZeroFindingRounds, 3)
assert.strictEqual(plan({ workflow: 'audit', stage: 'audit', risk: { class: 'normal', flags: [] }, auditConvergence: { ...narrowFacts, explicitNarrowScope: false } }).exit.requiredZeroFindingRounds, 3)
for (const roundTrip of [narrow, plan({ workflow: 'audit', stage: 'audit', auditConvergence: {
  explicitNarrowScope: false, scaleDecision: 'batched', crossHostControlPlane: true, multipleConsumers: true
} })]) {
  const serialized = JSON.parse(JSON.stringify(roundTrip))
  assert.deepStrictEqual(createReviewExecutionPlan(serialized), roundTrip)
  const roundReceipt = receipt(serialized)
  const saturated = evaluateEvidenceSaturation(serialized, { ...saturationInput, receipts: [roundReceipt],
    oracle: evaluateStableReceiptOracle([roundReceipt], { [roundReceipt.receiptDigest]: 'passed' }),
    zeroFindingRounds: serialized.exit.requiredZeroFindingRounds })
  assert.strictEqual(saturated.status, 'passed', saturated.reasons.join(', '))
}
const narrowSession = { convergenceMode: 'narrow-2', reviewExecutionPlan: narrow }
assert.strictEqual(requiredAuditZeroFindingRounds(narrowSession), 2)
assert.strictEqual(requiredAuditZeroFindingRounds({}), 3)
assert.strictEqual(requiredAuditZeroFindingRounds({ convergenceMode: 'narrow-2' }), 3)
assert.strictEqual(requiredAuditZeroFindingRounds({ ...narrowSession, reviewExecutionPlan: { ...narrow, exit: { ...narrow.exit, requiredZeroFindingRounds: 1 } } }), 3)
assert.strictEqual(requiredAuditZeroFindingRounds({ ...narrowSession, reviewExecutionPlan: { ...narrow, candidateDigest: 'tampered' } }), 3)
for (const overrides of [
  { risk: { class: 'security', flags: [] } },
  { risk: { class: 'release', flags: [] } },
  { stage: 'release' }, { claims: ['full'] },
  { risk: { class: 'normal', flags: ['control-plane'] } },
  { risk: { class: 'normal', flags: ['multi-source'] } },
  { risk: { class: 'normal', flags: ['security'] } },
  { risk: { class: 'normal', flags: ['release'] } },
  { auditConvergence: { ...narrowFacts, multipleConsumers: true } },
  { auditConvergence: { ...narrowFacts, explicitNarrowScope: false } }
]) {
  const guarded = plan({ workflow: 'audit', stage: 'audit', risk: { class: 'normal', flags: [] }, auditConvergence: narrowFacts, ...overrides })
  assert.strictEqual(requiredAuditZeroFindingRounds({ ...narrowSession, reviewExecutionPlan: guarded }), 3)
}
const documentPlanInput = { workflow: 'audit', stage: 'audit', changedSet: [], affectedClosure: ['requirements.md'],
  risk: { class: 'normal', flags: ['public-contract'] },
  claims: ['behavior-preserved', 'no-runtime-fallback-target'], dimensions: ['contract', 'fallback-applicability'] }
function documentFallbackCase(overrides = {}, factOverrides = {}) {
  const documentPlan = plan({ ...documentPlanInput, ...overrides })
  const evidence = [receipt(documentPlan), receipt(documentPlan, { dimension: 'fallback-applicability', claim: 'no-runtime-fallback-target' })]
  const facts = { schemaVersion: 'ReviewFallbackApplicabilityV1', status: 'not-applicable', kind: 'read-only-document-audit',
    planId: documentPlan.planId, candidateDigest: documentPlan.candidateDigest, scopeDigest: documentPlan.scopeDigest,
    implementationPresent: false, runtimeStatePresent: false, mutableConsumerStatePresent: false, sourceMutationAuthorized: false,
    reason: 'only unconfirmed requirements drafts; no implementation or runtime state',
    residualRisk: 'proposed future implementation remains untested', upgradeCondition: 'implementation, mutable consumers, scope or risk changes',
    evidenceReceiptDigests: [evidence[1].receiptDigest], ...factOverrides }
  const input = { ...saturationInput, receipts: evidence, fallbackEvidencePassed: false, fallbackApplicability: facts,
    zeroFindingRounds: 3, oracle: evaluateStableReceiptOracle(evidence, Object.fromEntries(evidence.map(value => [value.receiptDigest, 'passed']))) }
  return { documentPlan, input, result: evaluateEvidenceSaturation(documentPlan, input) }
}
const documentCase = documentFallbackCase()
assert.strictEqual(documentCase.result.status, 'passed', documentCase.result.reasons.join(', '))
assert.strictEqual(documentCase.result.fallbackApplicability.status, 'not-applicable')
for (const factOverrides of [
  { reason: '' }, { residualRisk: '' }, { upgradeCondition: '' },
  { planId: 'foreign' }, { candidateDigest: 'foreign' }, { scopeDigest: 'foreign' },
  { implementationPresent: true }, { runtimeStatePresent: true }, { mutableConsumerStatePresent: true },
  { sourceMutationAuthorized: true }, { kind: 'any-audit' },
  { evidenceReceiptDigests: [] }, { evidenceReceiptDigests: ['f'.repeat(64)] }
]) assert(documentFallbackCase({}, factOverrides).result.reasons.includes('fallback-evidence-missing'))
for (const overrides of [
  { workflow: 'dev', stage: 'ecr' }, { stage: 'release' }, { claims: ['full', 'no-runtime-fallback-target'] },
  { risk: { class: 'security', flags: [] } }, { risk: { class: 'release', flags: [] } },
  { risk: { class: 'high', flags: ['public-contract'] } }, { risk: { class: 'normal', flags: ['control-plane'] } },
  { risk: { class: 'normal', flags: ['security'] } }, { risk: { class: 'normal', flags: ['release'] } },
  { risk: { class: 'normal', flags: ['unknown-future-risk'] } },
  { changedSet: ['requirements.md'] }, { dimensions: ['contract'] }, { claims: ['behavior-preserved'] }
]) {
  const value = documentFallbackCase(overrides)
  assert.strictEqual(value.result.fallbackApplicability, undefined)
  if (value.documentPlan.exit.requireFallbackEvidence) assert(value.result.reasons.includes('fallback-evidence-missing'))
}
const staleFallback = documentFallbackCase()
staleFallback.input.receipts[1].candidateDigest = 'stale'
assert(evaluateEvidenceSaturation(staleFallback.documentPlan, staleFallback.input).reasons.includes('fallback-evidence-missing'))
assert.strictEqual(evaluateEvidenceSaturation(documentCase.documentPlan, { ...documentCase.input, independentEvidencePassed: false }).status, 'full-required')
assert.strictEqual(evaluateEvidenceSaturation(documentCase.documentPlan, { ...documentCase.input, zeroFindingRounds: 2 }).status, 'full-required')
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
assert.strictEqual(createReviewStateSnapshot(highSmall, { saturation }).nextAction, 'full-required',
  'a passing label without counts, receipts and dirty-boundary observation is incomplete')
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

// Derived policy is part of the canonical plan, not editable caller input.
{
  const owner = require('../hooks/_runtime/review-execution-contract.cjs')
  const plan = owner.createReviewExecutionPlan({ workflow: 'audit', stage: 'audit', userIntent: 'full control-plane audit',
    candidateDigest: 'a'.repeat(64), changedSet: ['runtime.cjs'], affectedClosure: ['runtime.cjs'],
    risk: { class: 'critical', flags: ['control-plane'] }, claims: ['runtime'], dimensions: ['runtime'],
    freshEvidence: ['runtime.cjs'], staleEvidence: [], exclusions: [] })
  const receipt = owner.createReviewEvidenceReceipt({ planId: plan.planId, candidateDigest: plan.candidateDigest,
    stage: plan.stage, scopeDigest: plan.scopeDigest, dimension: 'runtime', claim: 'runtime', lens: 'policy-regression',
    ruleVersion: 'rule-1', skillVersion: 'skill-1', probeVersion: 'probe-1', impactGraphDigest: 'b'.repeat(64),
    environmentDigest: 'c'.repeat(64), intentDigest: plan.intentDigest, riskDigest: plan.riskDigest,
    dependencyDigest: 'd'.repeat(64), consumerDigest: 'e'.repeat(64), command: 'isolated policy regression',
    environment: 'unit', runId: 'plan-output-integrity', result: 'passed', evidenceRefs: ['runtime.cjs'] })
  const input = { receipts: [receipt], zeroFindingRounds: 3, independentEvidencePassed: true,
    negativeEvidencePassed: true, fallbackEvidencePassed: true, dirtyBoundaryMatches: true, unreviewedRelatedSet: [] }
  assert.strictEqual(owner.evaluateEvidenceSaturation(JSON.parse(JSON.stringify(plan)), input).status, 'passed')
  for (const [field, inputField] of [['requireIndependentEvidence', 'independentEvidencePassed'],
    ['requireNegativeEvidence', 'negativeEvidencePassed'], ['requireFallbackEvidence', 'fallbackEvidencePassed'],
    ['requireDirtyBoundaryMatch', 'dirtyBoundaryMatches']]) {
    const tampered = JSON.parse(JSON.stringify(plan));tampered.exit[field] = false
    const result = owner.evaluateEvidenceSaturation(tampered, { ...input, [inputField]: false })
    assert.strictEqual(result.status, 'full-required', field)
    assert(result.reasons.includes('plan-digest-invalid'), field)
  }
  for (const rounds of [0, 2]) {
    const tampered = JSON.parse(JSON.stringify(plan));tampered.exit.requiredZeroFindingRounds = rounds
    assert.strictEqual(owner.evaluateEvidenceSaturation(tampered, { ...input, zeroFindingRounds: rounds }).status, 'full-required')
  }
  const tamperedClass = { ...plan, reviewClass: 'R0' }
  assert.strictEqual(owner.evaluateEvidenceSaturation(tamperedClass, input).status, 'full-required')
}
