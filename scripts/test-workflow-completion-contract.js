'use strict'

const assert = require('assert')
const {
  WorkflowCompletionError,
  createCommitValidationResult,
  createRiskAcceptanceReceipt,
  createWorkflowCompletionCandidate,
  createWorkflowCompletionCommit,
  createWorkflowCompletionPlan,
  createWorkflowEvidenceReceipt,
  createVerificationIntent,
  evaluateReceiptFreshness,
  evaluateShadowEvidenceWindow,
  evaluateWorkflowCompletion,
  projectWorkflowCompletion,
  validatePhaseTerminals,
  validateRiskAcceptanceReceipt,
  validateWorkflowCompletionCandidate,
  validateWorkflowCompletionCommit,
  validateWorkflowCompletionPlan,
  validateWorkflowCompletionSnapshot,
  validateWorkflowEvidenceReceipt,
  validateVerificationIntent
} = require('../hooks/_runtime/workflow-completion-contract.cjs')
const { buildContentIdentity, sha256 } = require('../hooks/_runtime/content-identity.cjs')
const { projectWorkflowCompletionVisibleState } = require('../hooks/_runtime/lifecycle-visible-reply.cjs')
const {
  MAX_SOURCE_REFS,
  OWNER_SPECS,
  WorkflowCompletionLifecycleError,
  appendRiskAcceptanceDecision,
  adaptSourceRef,
  adaptSourceRefs,
  buildSourceRef,
  createCompletionStore,
  createShadowWindowStore,
  derivedStateRelativePath,
  inspectTaskWorkflowCompletion,
  materializeWorkflowCompletionInput,
  normalizeLifecycleState,
  observeWorkflowCompletionEvent,
  readWorkflowCompletionState,
  readRiskAcceptanceLedger,
  readShadowEvidenceWindow,
  readWorkflowCompletionInput,
  readWorkflowCompletionRollout,
  reconcileWorkflowCompletion,
  reconciliationIdentity,
  recordShadowEvidenceSample,
  riskLedgerPath,
  shadowWindowRelativePath,
  taskKeyDigest,
  verifyTaskWorkflowCompletion,
  validateWorkflowCompletionInput,
  workflowInputPath
} = require('../hooks/_runtime/lifecycle-workflow-completion.cjs')
const {
  buildWorkflowCompletionControlChecks,
  inspectWorkflowCompletionControls
} = require('./lib/validate-workflow-completion-controls')
const { createCanonicalAwareReader } = require('./lib/canonical-consumer-contracts')
const { buildCliExecutionCommands } = require('./lib/cli-execution-commands')

const NOW = Date.parse('2026-07-22T08:00:00Z')
const OBSERVED_AT = '2026-07-22T15:30:00+08:00'
const GENERATED_AT = '2026-07-22T15:31:00+08:00'
const RULE_SET_DIGEST = sha256('workflow-completion-rules-v1')
const negativeProbes = []

function expectNegative(name, predicate) {
  assert.strictEqual(Boolean(predicate()), true, `negative probe did not fail closed: ${name}`)
  negativeProbes.push(name)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const deliveryIntent = createVerificationIntent({
  level: 'V2',
  purpose: 'delivery',
  affectedBoundaries: ['hook-runtime'],
  riskClass: 'high',
  releaseAuthorized: false,
  explicitFullAudit: false,
  authoritySource: 'fixture-confirmed-cp3'
})
assert.strictEqual(deliveryIntent.schemaVersion, 'VerificationIntentV1')
assert.strictEqual(deliveryIntent.claimCeiling, 'boundary-qualified')
assert.strictEqual(validateVerificationIntent(deliveryIntent).valid, true)
const tamperedIntent = clone(deliveryIntent)
tamperedIntent.level = 'V3'
expectNegative('verification-intent-digest-binding', () => !validateVerificationIntent(tamperedIntent).valid)
assert.throws(() => createVerificationIntent({
  level: 'V3',
  purpose: 'release',
  affectedBoundaries: [],
  riskClass: 'release',
  releaseAuthorized: false,
  explicitFullAudit: false,
  authoritySource: 'fixture-missing-release-authority'
}), error => error instanceof WorkflowCompletionError && error.code === 'VERIFICATION_INTENT_INVALID')
const releaseIntent = createVerificationIntent({
  level: 'V3',
  purpose: 'release',
  affectedBoundaries: [],
  riskClass: 'release',
  releaseAuthorized: true,
  explicitFullAudit: false,
  authoritySource: 'fixture-user-release-authority'
})
assert.strictEqual(releaseIntent.claimCeiling, 'release-candidate')

function taskScope(suffix = 'alpha') {
  const source = JSON.stringify({ project: 'devcodex', task: suffix })
  return {
    project: 'devcodex',
    kind: 'requirements',
    taskId: suffix,
    relativeTaskPath: `requirements/${suffix}`,
    legacyKey: sha256(`legacy:${suffix}`),
    sourceIdentity: buildContentIdentity({ sourceKey: `task:${suffix}`, content: source, contractVersion: '1' })
  }
}

function candidate(suffix = 'alpha', overrides = {}) {
  return createWorkflowCompletionCandidate({
    taskScope: taskScope(suffix),
    components: {
      source: sha256(`source:${suffix}`),
      plan: sha256('plan:v1'),
      delivery: sha256('delivery:v1'),
      rules: RULE_SET_DIGEST,
      ...overrides
    }
  })
}

function requirements(currentCandidate) {
  const dependency = name => ({ [name]: currentCandidate.components[name] })
  return [
    {
      requirementId: 'requirements.coverage', alias: 'T1', planOrder: 0,
      applicability: { decision: 'required', authority: 'compliance', reason: 'required by workflow', owner: 'requirements' },
      dependencyBindings: dependency('source'), nonWaivable: false
    },
    {
      requirementId: 'governance.compliance', alias: 'T5', planOrder: 1,
      applicability: { decision: 'required', authority: 'compliance', reason: 'mandatory governance', owner: 'compliance' },
      dependencyBindings: dependency('rules'), nonWaivable: true
    },
    {
      requirementId: 'workflow.verification', alias: 'T7', planOrder: 2,
      applicability: { decision: 'required', authority: 'test-router', reason: 'selected verification', owner: 'validation' },
      dependencyBindings: dependency('plan'), nonWaivable: false
    },
    {
      requirementId: 'delivery.manifest', alias: 'T9', planOrder: 3,
      applicability: { decision: 'optional', authority: 'visible-output', reason: 'delivery projection', owner: 'delivery' },
      dependencyBindings: dependency('delivery'), nonWaivable: false
    },
    {
      requirementId: 'release.readiness', alias: null, planOrder: 4,
      applicability: { decision: 'N/A', authority: 'release-verification', reason: 'no release requested', owner: 'release' },
      dependencyBindings: dependency('delivery'), nonWaivable: true
    }
  ]
}

function plan(currentCandidate, overrides = {}) {
  return createWorkflowCompletionPlan({
    candidate: currentCandidate,
    workflow: 'dev',
    intent: 'implement workflow completion evidence closure',
    stage: 'implementation',
    ruleSetDigest: RULE_SET_DIGEST,
    requirements: requirements(currentCandidate),
    ...overrides
  })
}

function receipt(currentCandidate, requirement, overrides = {}) {
  const sourceIdentity = overrides.sourceIdentity || `receipt:${requirement.requirementId}:${overrides.result || 'passed'}:${currentCandidate.candidateId}`
  return createWorkflowEvidenceReceipt({
    requirementId: requirement.requirementId,
    observedCandidateId: currentCandidate.candidateId,
    dependencyBindings: requirement.dependencyBindings,
    sourceKind: 'validation',
    sourceSchema: 'ValidationExecutionReceiptV1',
    sourceIdentity,
    result: 'passed',
    observedAt: OBSERVED_AT,
    actor: 'codex-test',
    host: 'node',
    runId: `run-${requirement.planOrder}`,
    evidenceRefs: [`evidence:${requirement.requirementId}`],
    qualification: { level: 'E1', satisfiesRequired: true, trusted: true, observable: true, warning: false },
    ...overrides,
    sourceIdentity
  })
}

function passedReceipts(currentCandidate, currentPlan) {
  return currentPlan.requirements
    .filter(item => item.applicability.decision !== 'N/A')
    .map(item => receipt(currentCandidate, item))
}

function rollout(mode = 'shadow') {
  return { schemaVersion: 'RolloutStateV1', mode, ruleSetDigest: RULE_SET_DIGEST, legacyComparison: 'same' }
}

function snapshot(currentCandidate, currentPlan, receipts, options = {}) {
  return evaluateWorkflowCompletion({
    candidate: currentCandidate,
    plan: currentPlan,
    receipts,
    riskReceipts: options.riskReceipts || [],
    rollout: options.rollout || rollout(),
    generatedAt: GENERATED_AT,
    now: NOW
  })
}

function deliveryRefs() {
  return [
    { kind: 'report', digest: sha256('report-readback'), evidenceRef: 'report:readback' },
    { kind: 'memory', digest: sha256('memory-readback'), evidenceRef: 'memory:readback' },
    { kind: 'manifest', digest: sha256('manifest-readback'), evidenceRef: 'manifest:readback' }
  ]
}

function commit(currentSnapshot, outcome = 'complete', reportContent = '# Completion report\n') {
  return createWorkflowCompletionCommit({
    snapshot: currentSnapshot,
    deliveryReceiptRefs: deliveryRefs(),
    reportIdentity: buildContentIdentity({ sourceKey: 'report.md', content: reportContent, contractVersion: '1' }),
    memoryReceiptRefs: [{ kind: 'memory', digest: sha256('memory-readback'), evidenceRef: 'memory:readback' }],
    artifactManifestEntries: ['report.md', 'memory/task.md', 'memory/SUMMARY.md'],
    commitOutcome: outcome,
    createdAt: '2026-07-22T15:32:00+08:00'
  })
}

const currentCandidate = candidate()
const currentPlan = plan(currentCandidate)
const goodReceipts = passedReceipts(currentCandidate, currentPlan)
const goodSnapshot = snapshot(currentCandidate, currentPlan, goodReceipts)

assert.strictEqual(validateWorkflowCompletionCandidate(currentCandidate).valid, true)
assert.strictEqual(validateWorkflowCompletionPlan(currentPlan, currentCandidate).valid, true)
assert.strictEqual(goodSnapshot.coreEvidenceState, 'PASS')
assert.strictEqual(goodSnapshot.coreEvidenceReady, true)
assert.strictEqual(goodSnapshot.phaseTerminals.length, 4)
assert.strictEqual(goodSnapshot.phaseTerminals.find(item => item.phase === 'workflow').value, false)

expectNegative('candidate-source-identity-invalid', () => {
  const bad = clone(currentCandidate)
  bad.taskScope.sourceIdentity.digest = sha256('tampered')
  return !validateWorkflowCompletionCandidate(bad).valid
})
expectNegative('candidate-components-tampered', () => {
  const bad = clone(currentCandidate)
  bad.components.source = sha256('tampered')
  return !validateWorkflowCompletionCandidate(bad).valid
})
expectNegative('candidate-id-tampered', () => {
  const bad = clone(currentCandidate)
  bad.candidateId = `workflow-candidate-${sha256('other')}`
  return !validateWorkflowCompletionCandidate(bad).valid
})
expectNegative('plan-duplicate-order', () => {
  const bad = clone(currentPlan)
  bad.requirements[1].planOrder = bad.requirements[0].planOrder
  bad.planDigest = sha256('bad')
  return !validateWorkflowCompletionPlan(bad, currentCandidate).valid
})
expectNegative('plan-duplicate-requirement', () => {
  const bad = clone(currentPlan)
  bad.requirements[1].requirementId = bad.requirements[0].requirementId
  return !validateWorkflowCompletionPlan(bad, currentCandidate).valid
})
expectNegative('plan-duplicate-alias', () => {
  const bad = clone(currentPlan)
  bad.requirements[1].alias = bad.requirements[0].alias
  return !validateWorkflowCompletionPlan(bad, currentCandidate).valid
})
expectNegative('plan-applicability-authority-missing', () => {
  const bad = clone(currentPlan)
  bad.requirements[0].applicability.authority = ''
  return !validateWorkflowCompletionPlan(bad, currentCandidate).valid
})
expectNegative('plan-na-authority-missing', () => {
  const bad = clone(currentPlan)
  bad.requirements[4].applicability.authority = ''
  return !validateWorkflowCompletionPlan(bad, currentCandidate).valid
})
expectNegative('plan-dependency-mismatch', () => {
  const bad = clone(currentPlan)
  bad.requirements[0].dependencyBindings.source = sha256('old-source')
  return !validateWorkflowCompletionPlan(bad, currentCandidate).valid
})
expectNegative('plan-digest-tampered', () => {
  const bad = clone(currentPlan)
  bad.planDigest = sha256('wrong-plan')
  return !validateWorkflowCompletionPlan(bad, currentCandidate).valid
})
expectNegative('receipt-unknown-schema', () => {
  const bad = clone(goodReceipts[0])
  bad.schemaVersion = 'UnknownReceiptV9'
  return !validateWorkflowEvidenceReceipt(bad, { now: NOW }).valid
})
expectNegative('receipt-source-digest-mismatch', () => {
  const bad = clone(goodReceipts[0])
  bad.sourceDigest = sha256('wrong-source')
  return !validateWorkflowEvidenceReceipt(bad, { now: NOW }).valid
})
expectNegative('receipt-future-time', () => {
  const bad = clone(goodReceipts[0])
  bad.observedAt = '2026-07-23T15:30:00+08:00'
  return !validateWorkflowEvidenceReceipt(bad, { now: NOW }).valid
})
expectNegative('receipt-timezone-missing', () => {
  const bad = clone(goodReceipts[0])
  bad.observedAt = '2026-07-22T15:30:00'
  return !validateWorkflowEvidenceReceipt(bad, { now: NOW }).valid
})
expectNegative('receipt-e5-required-claim', () => {
  const bad = clone(goodReceipts[0])
  bad.qualification.level = 'E5'
  return !validateWorkflowEvidenceReceipt(bad, { now: NOW }).valid
})
expectNegative('receipt-required-unobservable', () => {
  const bad = clone(goodReceipts[0])
  bad.qualification.observable = false
  return !validateWorkflowEvidenceReceipt(bad, { now: NOW }).valid
})
expectNegative('receipt-ref-cap', () => {
  const bad = clone(goodReceipts[0])
  bad.evidenceRefs = Array.from({ length: 101 }, (_, index) => `evidence:${index}`)
  return !validateWorkflowEvidenceReceipt(bad, { now: NOW }).valid
})

const nextCandidate = candidate('alpha', { delivery: sha256('delivery:v2') })
const nextPlan = plan(nextCandidate)
const reusableRequirement = nextPlan.requirements.find(item => item.requirementId === 'requirements.coverage')
const reusableReceipt = goodReceipts.find(item => item.requirementId === 'requirements.coverage')
assert.strictEqual(evaluateReceiptFreshness(reusableReceipt, nextCandidate, reusableRequirement, { now: NOW }).freshness, 'fresh-reused')
expectNegative('changed-dependency-stale', () => {
  const deliveryRequirement = nextPlan.requirements.find(item => item.requirementId === 'delivery.manifest')
  const oldReceipt = goodReceipts.find(item => item.requirementId === 'delivery.manifest')
  return evaluateReceiptFreshness(oldReceipt, nextCandidate, deliveryRequirement, { now: NOW }).freshness === 'stale'
})
expectNegative('invalid-receipt-fail-closed', () => {
  const bad = clone(goodReceipts[0])
  bad.sourceDigest = sha256('bad')
  return evaluateReceiptFreshness(bad, currentCandidate, currentPlan.requirements[0], { now: NOW }).freshness === 'invalid'
})
expectNegative('missing-required-unverified', () => snapshot(currentCandidate, currentPlan, goodReceipts.slice(1)).coreEvidenceState === 'UNVERIFIED')
expectNegative('optional-missing-warning', () => {
  const withoutOptional = goodReceipts.filter(item => item.requirementId !== 'delivery.manifest')
  return snapshot(currentCandidate, currentPlan, withoutOptional).decisions.find(item => item.requirementId === 'delivery.manifest').state === 'WARN'
})
assert.strictEqual(goodSnapshot.decisions.find(item => item.requirementId === 'release.readiness').state, 'N/A')

const governance = currentPlan.requirements.find(item => item.requirementId === 'governance.compliance')
const sourceRequirement = currentPlan.requirements.find(item => item.requirementId === 'requirements.coverage')
const mixedReceipts = goodReceipts.filter(item => !['governance.compliance', 'requirements.coverage'].includes(item.requirementId)).concat([
  receipt(currentCandidate, governance, { result: 'failed', sourceIdentity: 'governance-failed' }),
  receipt(currentCandidate, sourceRequirement, { result: 'failed', sourceIdentity: 'source-failed' })
])
const mixedSnapshot = snapshot(currentCandidate, currentPlan, mixedReceipts)
assert.strictEqual(mixedSnapshot.diagnostics.firstBlocker.requirementId, 'governance.compliance')
expectNegative('nonwaivable-block-rank', () => mixedSnapshot.diagnostics.firstBlocker.blockingClassRank === 0)
expectNegative('required-block-rank', () => mixedSnapshot.decisions.find(item => item.requirementId === 'requirements.coverage').blockingClassRank === 1)

for (let index = 0; index < 100; index += 1) {
  const rotated = goodReceipts.slice(index % goodReceipts.length).concat(goodReceipts.slice(0, index % goodReceipts.length))
  if (index % 2) rotated.reverse()
  assert.strictEqual(snapshot(currentCandidate, currentPlan, rotated).coreSnapshotDigest, goodSnapshot.coreSnapshotDigest)
}

const acceptedRisk = createRiskAcceptanceReceipt({
  action: 'accept', candidateId: currentCandidate.candidateId, requirementIds: ['requirements.coverage'],
  actor: 'explicit-user', reason: 'time-bounded accepted risk', sourceDigest: sha256('user-message'),
  createdAt: '2026-07-22T15:29:00+08:00', expiresAt: '2026-07-23T15:29:00+08:00',
  targetReceiptDigest: null, previousDigest: null
})
const riskReceipts = goodReceipts.filter(item => item.requirementId !== 'requirements.coverage').concat([
  receipt(currentCandidate, sourceRequirement, { result: 'failed', sourceIdentity: 'waivable-failure' })
])
const riskSnapshot = snapshot(currentCandidate, currentPlan, riskReceipts, { riskReceipts: [acceptedRisk] })
assert.strictEqual(riskSnapshot.coreEvidenceState, 'BLOCK')
assert.strictEqual(riskSnapshot.riskDeliverable, true)
expectNegative('risk-does-not-rewrite-evidence', () => riskSnapshot.coreEvidenceState === 'BLOCK')

const nonwaivableRisk = createRiskAcceptanceReceipt({
  action: 'accept', candidateId: currentCandidate.candidateId, requirementIds: ['governance.compliance'],
  actor: 'explicit-user', reason: 'invalid attempt', sourceDigest: sha256('user-message-2'),
  createdAt: '2026-07-22T15:29:00+08:00', expiresAt: null, targetReceiptDigest: null, previousDigest: null
})
expectNegative('risk-nonwaivable-rejected', () => snapshot(currentCandidate, currentPlan, mixedReceipts, { riskReceipts: [nonwaivableRisk] }).risk.invalid.some(item => item.includes('nonwaivable')))
expectNegative('risk-candidate-mismatch', () => {
  const bad = clone(acceptedRisk)
  bad.candidateId = nextCandidate.candidateId
  return snapshot(currentCandidate, currentPlan, riskReceipts, { riskReceipts: [bad] }).risk.invalid.length > 0
})
expectNegative('risk-chain-mismatch', () => {
  const bad = clone(acceptedRisk)
  bad.previousDigest = sha256('unexpected-previous')
  return snapshot(currentCandidate, currentPlan, riskReceipts, { riskReceipts: [bad] }).risk.invalid.length > 0
})
expectNegative('risk-expired', () => {
  const bad = createRiskAcceptanceReceipt({
    action: 'accept', candidateId: currentCandidate.candidateId, requirementIds: ['requirements.coverage'],
    actor: 'explicit-user', reason: 'expired', sourceDigest: sha256('expired'),
    createdAt: '2026-07-20T15:29:00+08:00', expiresAt: '2026-07-21T15:29:00+08:00', targetReceiptDigest: null, previousDigest: null
  })
  return snapshot(currentCandidate, currentPlan, riskReceipts, { riskReceipts: [bad] }).risk.expired.length === 1
})
const revokeRisk = createRiskAcceptanceReceipt({
  action: 'revoke', candidateId: currentCandidate.candidateId, requirementIds: ['requirements.coverage'],
  actor: 'explicit-user', reason: 'risk withdrawn', sourceDigest: sha256('revoke'),
  createdAt: '2026-07-22T15:30:00+08:00', expiresAt: null,
  targetReceiptDigest: acceptedRisk.receiptDigest, previousDigest: acceptedRisk.receiptDigest
})
expectNegative('risk-revoked-not-active', () => !snapshot(currentCandidate, currentPlan, riskReceipts, { riskReceipts: [acceptedRisk, revokeRisk] }).riskDeliverable)
expectNegative('risk-revoke-target-missing', () => {
  const orphan = createRiskAcceptanceReceipt({
    action: 'revoke', candidateId: currentCandidate.candidateId, requirementIds: ['requirements.coverage'],
    actor: 'explicit-user', reason: 'orphan revoke', sourceDigest: sha256('orphan'),
    createdAt: '2026-07-22T15:30:00+08:00', expiresAt: null,
    targetReceiptDigest: sha256('missing'), previousDigest: null
  })
  return snapshot(currentCandidate, currentPlan, riskReceipts, { riskReceipts: [orphan] }).risk.invalid.length > 0
})

expectNegative('phase-cardinality', () => !validatePhaseTerminals(goodSnapshot.phaseTerminals.slice(0, 3)).valid)
expectNegative('phase-semantic-field-mismatch', () => {
  const bad = clone(goodSnapshot.phaseTerminals)
  bad[0].semanticField = 'workflowComplete'
  return !validatePhaseTerminals(bad).valid
})
expectNegative('phase-na-cannot-be-true', () => {
  const bad = clone(goodSnapshot.phaseTerminals)
  const release = bad.find(item => item.phase === 'release')
  release.value = true
  return !validatePhaseTerminals(bad).valid
})

const goodCommit = commit(goodSnapshot)
assert.strictEqual(validateWorkflowCompletionCommit(goodCommit, { snapshot: goodSnapshot, reportContent: '# Completion report\n' }).valid, true)
const committedProjection = projectWorkflowCompletion(goodSnapshot, createCommitValidationResult(goodCommit, { snapshot: goodSnapshot }), { generatedAt: '2026-07-22T15:33:00+08:00', now: NOW })
assert.strictEqual(committedProjection.completionPhase, 'committed-complete')
assert.strictEqual(committedProjection.workflowComplete, true)
assert.strictEqual(committedProjection.deliveryCommitted, true)
const committedVisible = projectWorkflowCompletionVisibleState(committedProjection)
assert.strictEqual(committedVisible.workflowComplete, true)
assert.strictEqual(committedVisible.projectionDigest, committedProjection.projectionDigest)

expectNegative('commit-self-manifest-cycle', () => {
  try {
    createWorkflowCompletionCommit({
      snapshot: goodSnapshot, deliveryReceiptRefs: deliveryRefs(), reportIdentity: goodCommit.reportIdentity,
      memoryReceiptRefs: goodCommit.memoryReceiptRefs, artifactManifestEntries: ['report.md', 'report.md.completion.json'],
      commitOutcome: 'complete', createdAt: goodCommit.createdAt
    })
    return false
  } catch (error) {
    return error instanceof WorkflowCompletionError && error.code === 'COMMIT_MANIFEST_CYCLE'
  }
})
expectNegative('commit-wrong-snapshot', () => !validateWorkflowCompletionCommit(goodCommit, { snapshot: riskSnapshot }).valid)
expectNegative('commit-wrong-outcome', () => {
  const bad = clone(goodCommit)
  bad.commitOutcome = 'blocked'
  return !validateWorkflowCompletionCommit(bad, { snapshot: goodSnapshot }).valid
})
expectNegative('commit-report-reverse-identity', () => !validateWorkflowCompletionCommit(goodCommit, { snapshot: goodSnapshot, reportContent: '# Changed report\n' }).valid)
expectNegative('commit-digest-tampered', () => {
  const bad = clone(goodCommit)
  bad.commitDigest = sha256('tampered-commit')
  return !validateWorkflowCompletionCommit(bad, { snapshot: goodSnapshot }).valid
})
expectNegative('commit-manifest-digest-tampered', () => {
  const bad = clone(goodCommit)
  bad.artifactManifestDigest = sha256('tampered-manifest')
  return !validateWorkflowCompletionCommit(bad, { snapshot: goodSnapshot }).valid
})

const preparedProjection = projectWorkflowCompletion(goodSnapshot, createCommitValidationResult(null, { snapshot: goodSnapshot }), { generatedAt: '2026-07-22T15:33:00+08:00', now: NOW })
expectNegative('missing-commit-not-failed', () => preparedProjection.completionPhase === 'delivery-prepared' && preparedProjection.projectionDigest === null)
assert.strictEqual(projectWorkflowCompletionVisibleState(preparedProjection).workflowComplete, false)
assert.strictEqual(projectWorkflowCompletionVisibleState({ schemaVersion: 'UnknownProjectionV9' }).status, 'UNVERIFIED')
const wrongAttempt = { candidateId: nextCandidate.candidateId, result: 'failed', observedAt: OBSERVED_AT, attemptDigest: sha256('wrong-attempt') }
const wrongAttemptProjection = projectWorkflowCompletion(goodSnapshot, createCommitValidationResult(null, { snapshot: goodSnapshot, deliveryAttempt: wrongAttempt, now: NOW }), { generatedAt: '2026-07-22T15:33:00+08:00', now: NOW })
expectNegative('wrong-candidate-failure-not-terminal', () => wrongAttemptProjection.completionPhase !== 'commit-failed')
const failedAttempt = { candidateId: currentCandidate.candidateId, result: 'failed', observedAt: OBSERVED_AT, attemptDigest: sha256('delivery-failed') }
const failedProjection = projectWorkflowCompletion(goodSnapshot, createCommitValidationResult(null, { snapshot: goodSnapshot, deliveryAttempt: failedAttempt, now: NOW }), { generatedAt: '2026-07-22T15:33:00+08:00', now: NOW })
expectNegative('fresh-failure-receipt-required', () => failedProjection.completionPhase === 'commit-failed' && failedProjection.workflowComplete === false)

const riskCommit = commit(riskSnapshot, 'risk')
const riskProjection = projectWorkflowCompletion(riskSnapshot, createCommitValidationResult(riskCommit, { snapshot: riskSnapshot }), { generatedAt: '2026-07-22T15:33:00+08:00', now: NOW })
expectNegative('committed-risk-not-complete', () => riskProjection.deliveryCommitted && !riskProjection.workflowComplete && riskProjection.deliveryDecision === 'allowed-with-risk')
const blockedCommit = commit(mixedSnapshot, 'blocked')
const blockedProjection = projectWorkflowCompletion(mixedSnapshot, createCommitValidationResult(blockedCommit, { snapshot: mixedSnapshot }), { generatedAt: '2026-07-22T15:33:00+08:00', now: NOW })
expectNegative('committed-blocked-not-complete', () => blockedProjection.deliveryCommitted && !blockedProjection.workflowComplete && blockedProjection.deliveryDecision === 'forbidden')
const rolledBackSnapshot = snapshot(currentCandidate, currentPlan, goodReceipts, { rollout: rollout('rolled-back') })
const rolledBackCommit = commit(rolledBackSnapshot)
const rolledBackProjection = projectWorkflowCompletion(rolledBackSnapshot, createCommitValidationResult(rolledBackCommit, { snapshot: rolledBackSnapshot }), { generatedAt: '2026-07-22T15:33:00+08:00', now: NOW })
expectNegative('rolled-back-cannot-pass', () => !rolledBackProjection.workflowComplete && rolledBackProjection.workflowEvidenceState === 'UNVERIFIED')

const projectionAgain = projectWorkflowCompletion(goodSnapshot, createCommitValidationResult(goodCommit, { snapshot: goodSnapshot }), { generatedAt: '2026-07-22T18:00:00+08:00', now: NOW })
assert.strictEqual(projectionAgain.projectionDigest, committedProjection.projectionDigest)

// Exercise the complete fail-closed validation surface, not only the reducer happy path.
assert.strictEqual(validateWorkflowCompletionCandidate(null).valid, false)
for (const [field, value] of [
  ['project', ''], ['kind', 'unknown'], ['taskId', ''], ['relativeTaskPath', ''], ['legacyKey', 'bad']
]) {
  const bad = clone(currentCandidate)
  bad.taskScope[field] = value
  assert.strictEqual(validateWorkflowCompletionCandidate(bad).valid, false)
}
const arrayScopeCandidate = clone(currentCandidate)
arrayScopeCandidate.taskScope = []
assert.strictEqual(validateWorkflowCompletionCandidate(arrayScopeCandidate).valid, false)
const unstableCandidate = createWorkflowCompletionCandidate({ taskScope: taskScope('unstable'), components: { source: sha256('unstable') }, stable: false })
assert.strictEqual(unstableCandidate.stable, false)
assert.throws(() => createWorkflowCompletionCandidate(), error => error.code === 'CANDIDATE_INVALID')
assert.throws(() => createWorkflowCompletionCandidate({ taskScope: taskScope('bad-bindings'), components: {} }), error => error.code === 'CANDIDATE_INVALID')

assert.strictEqual(validateWorkflowCompletionPlan(null).valid, false)
assert.strictEqual(validateWorkflowCompletionPlan(currentPlan).valid, true)
for (const mutate of [
  value => { value.schemaVersion = 'UnknownPlan' },
  value => { value.candidateId = 'bad' },
  value => { value.workflow = 'chat' },
  value => { value.intent = '' },
  value => { value.stage = 'done' },
  value => { value.ruleSetDigest = 'bad' },
  value => { value.requirements = [] },
  value => { value.requirements[0].requirementId = 'INVALID ID' },
  value => { value.requirements[0].alias = 'T14' },
  value => { value.requirements[0].planOrder = -1 },
  value => { value.requirements[0].applicability.decision = 'maybe' },
  value => { value.requirements[0].applicability.reason = '' },
  value => { value.requirements[0].applicability.owner = '' },
  value => { value.requirements[0].applicability.evaluatedAtCandidate = nextCandidate.candidateId },
  value => { value.requirements[0].dependencyBindings = {} },
  value => { value.requirements[0].nonWaivable = 'yes' },
  value => { value.planDigest = 'bad' }
]) {
  const bad = clone(currentPlan)
  mutate(bad)
  assert.strictEqual(validateWorkflowCompletionPlan(bad, currentCandidate).valid, false)
}
assert.throws(() => createWorkflowCompletionPlan({ candidate: currentCandidate, requirements: [] }), error => error.code === 'PLAN_INVALID')

const identityReceipt = receipt(currentCandidate, sourceRequirement, {
  sourceIdentity: buildContentIdentity({ sourceKey: 'receipt.json', content: '{}', contractVersion: '1' })
})
assert.strictEqual(validateWorkflowEvidenceReceipt(identityReceipt, { now: NOW }).valid, true)
assert.strictEqual(validateWorkflowEvidenceReceipt(null, { now: NOW }).valid, false)
for (const mutate of [
  value => { value.requirementId = 'INVALID ID' },
  value => { value.observedCandidateId = 'bad' },
  value => { value.dependencyBindings = [] },
  value => { value.sourceKind = 'stdout' },
  value => { value.sourceSchema = '' },
  value => { value.sourceIdentity = null },
  value => { value.result = 'success' },
  value => { value.actor = '' },
  value => { value.host = '' },
  value => { value.runId = '' },
  value => { value.evidenceRefs = ['duplicate', 'duplicate'] },
  value => { value.qualification = null },
  value => { value.qualification.level = 'E9' },
  value => { value.qualification.trusted = 'yes' },
  value => { value.qualification.warning = null }
]) {
  const bad = clone(goodReceipts[0])
  mutate(bad)
  assert.strictEqual(validateWorkflowEvidenceReceipt(bad, { now: NOW }).valid, false)
}
assert.throws(() => createWorkflowEvidenceReceipt({}), error => error.code === 'EVIDENCE_RECEIPT_INVALID')
const mismatchedRequirement = clone(sourceRequirement)
mismatchedRequirement.requirementId = 'requirements.other'
assert.strictEqual(evaluateReceiptFreshness(reusableReceipt, currentCandidate, mismatchedRequirement, { now: NOW }).freshness, 'invalid')

for (const [result, applicability, expected] of [
  ['inconclusive', 'required', 'UNVERIFIED'],
  ['inconclusive', 'optional', 'WARN'],
  ['skipped', 'required', 'UNVERIFIED'],
  ['skipped', 'optional', 'N/A']
]) {
  const target = clone(applicability === 'required' ? sourceRequirement : currentPlan.requirements.find(item => item.requirementId === 'delivery.manifest'))
  const variant = receipt(currentCandidate, target, { result, sourceIdentity: `${result}:${applicability}` })
  const resultSnapshot = snapshot(currentCandidate, currentPlan, goodReceipts.filter(item => item.requirementId !== target.requirementId).concat([variant]))
  assert.strictEqual(resultSnapshot.decisions.find(item => item.requirementId === target.requirementId).state, expected)
}
const warningReceipt = receipt(currentCandidate, sourceRequirement, {
  sourceIdentity: 'warning-receipt',
  qualification: { level: 'E2', satisfiesRequired: true, trusted: true, observable: true, warning: true }
})
const warningSnapshot = snapshot(currentCandidate, currentPlan, goodReceipts.filter(item => item.requirementId !== sourceRequirement.requirementId).concat([warningReceipt]))
assert.strictEqual(warningSnapshot.coreEvidenceState, 'WARN')
const warningCommit = commit(warningSnapshot, 'warning')
assert.strictEqual(projectWorkflowCompletion(warningSnapshot, createCommitValidationResult(warningCommit, { snapshot: warningSnapshot }), { generatedAt: GENERATED_AT, now: NOW }).deliveryDecision, 'allowed-with-warning')
const weakReceipt = receipt(currentCandidate, sourceRequirement, {
  sourceIdentity: 'weak-receipt',
  qualification: { level: 'E4', satisfiesRequired: false, trusted: false, observable: true, warning: true }
})
assert.strictEqual(snapshot(currentCandidate, currentPlan, goodReceipts.filter(item => item.requirementId !== sourceRequirement.requirementId).concat([weakReceipt])).coreEvidenceState, 'UNVERIFIED')

assert.strictEqual(validateRiskAcceptanceReceipt(null, { now: NOW }).valid, false)
for (const mutate of [
  value => { value.schemaVersion = 'UnknownRisk' },
  value => { value.action = 'ignore' },
  value => { value.candidateId = 'bad' },
  value => { value.requirementIds = [] },
  value => { value.actor = '' },
  value => { value.reason = '' },
  value => { value.sourceDigest = 'bad' },
  value => { value.createdAt = 'not-time' },
  value => { value.createdAt = '2026-07-23T15:30:00+08:00' },
  value => { value.expiresAt = 'not-time' },
  value => { value.targetReceiptDigest = 'bad' },
  value => { value.previousDigest = 'bad' },
  value => { value.targetReceiptDigest = sha256('forbidden-target') },
  value => { value.receiptDigest = sha256('tampered-risk') }
]) {
  const bad = clone(acceptedRisk)
  mutate(bad)
  assert.strictEqual(validateRiskAcceptanceReceipt(bad, { now: NOW }).valid, false)
}
assert.throws(() => createRiskAcceptanceReceipt({}), error => error.code === 'RISK_RECEIPT_INVALID')

assert.strictEqual(validateWorkflowCompletionSnapshot(null).valid, false)
for (const mutate of [
  value => { value.schemaVersion = 'UnknownSnapshot' },
  value => { value.candidateId = 'bad' },
  value => { value.planDigest = 'bad' },
  value => { value.generatedAt = 'not-time' },
  value => { value.coreEvidenceState = 'DONE' },
  value => { value.coreEvidenceReady = 'yes' },
  value => { value.coreSnapshotDigest = sha256('tampered-snapshot') }
]) {
  const bad = clone(goodSnapshot)
  mutate(bad)
  assert.strictEqual(validateWorkflowCompletionSnapshot(bad).valid, false)
}
const releasePlan = createWorkflowCompletionPlan({
  candidate: currentCandidate,
  workflow: 'dev', intent: 'release verification', stage: 'release', ruleSetDigest: RULE_SET_DIGEST,
  requirements: requirements(currentCandidate)
})
const releaseSnapshot = snapshot(currentCandidate, releasePlan, passedReceipts(currentCandidate, releasePlan))
assert.strictEqual(releaseSnapshot.phaseTerminals.find(item => item.phase === 'release').applicability, 'required')
const naOnlyPlan = createWorkflowCompletionPlan({
  candidate: currentCandidate, workflow: 'other', intent: 'not applicable only', stage: 'planning', ruleSetDigest: RULE_SET_DIGEST,
  requirements: [requirements(currentCandidate)[4]]
})
assert.strictEqual(snapshot(currentCandidate, naOnlyPlan, []).coreEvidenceState, 'PASS')
assert.strictEqual(snapshot(currentCandidate, currentPlan, goodReceipts, { rollout: undefined }).rollout.mode, 'shadow')
const unknownReceipt = clone(goodReceipts[0])
unknownReceipt.requirementId = 'unknown.requirement'
assert.strictEqual(snapshot(currentCandidate, currentPlan, goodReceipts.concat([unknownReceipt])).coreEvaluationValid, false)

assert.strictEqual(validateWorkflowCompletionCommit(null).valid, false)
assert.strictEqual(validateWorkflowCompletionCommit(goodCommit).valid, true)
for (const mutate of [
  value => { value.schemaVersion = 'UnknownCommit' },
  value => { value.candidateId = 'bad' },
  value => { value.coreSnapshotDigest = 'bad' },
  value => { value.deliveryReceiptRefs = [] },
  value => { value.deliveryReceiptRefs = [deliveryRefs()[0], deliveryRefs()[0], deliveryRefs()[0]] },
  value => { value.reportIdentity = null },
  value => { value.memoryReceiptRefs = [] },
  value => { value.memoryReceiptRefs = [{ kind: 'report', digest: sha256('x'), evidenceRef: 'x' }] },
  value => { value.artifactManifestEntries = ['duplicate', 'duplicate'] },
  value => { value.artifactManifestEntries = ['report.md.completion.json'] },
  value => { value.commitOutcome = 'done' },
  value => { value.createdAt = 'not-time' }
]) {
  const bad = clone(goodCommit)
  mutate(bad)
  assert.strictEqual(validateWorkflowCompletionCommit(bad, { snapshot: goodSnapshot }).valid, false)
}
assert.throws(() => {
  const badSnapshot = clone(goodSnapshot)
  badSnapshot.coreSnapshotDigest = 'bad'
  createWorkflowCompletionCommit({ snapshot: badSnapshot })
}, error => error.code === 'COMMIT_SNAPSHOT_INVALID')
assert.strictEqual(validateWorkflowCompletionCommit(goodCommit, { snapshot: goodSnapshot, artifactManifestEntries: ['different'] }).valid, false)

const invalidCommit = clone(goodCommit)
invalidCommit.commitDigest = sha256('invalid-commit')
const invalidCommitResult = createCommitValidationResult(invalidCommit, { snapshot: goodSnapshot, deliveryAttempt: failedAttempt, now: NOW })
assert.strictEqual(invalidCommitResult.state, 'failed')
assert.strictEqual(invalidCommitResult.deliveryAttempt.attemptDigest, failedAttempt.attemptDigest)
assert.throws(() => projectWorkflowCompletion(goodSnapshot, { state: 'valid', commit: invalidCommit }, { generatedAt: GENERATED_AT, now: NOW }), error => error.code === 'PROJECTION_COMMIT_INVALID')
assert.throws(() => projectWorkflowCompletion(goodSnapshot, { state: 'not-attempted' }, { generatedAt: 'not-time', now: NOW }), error => error.code === 'PROJECTION_TIME_INVALID')
assert.throws(() => projectWorkflowCompletion({ ...goodSnapshot, coreSnapshotDigest: 'bad' }, { state: 'not-attempted' }, { generatedAt: GENERATED_AT, now: NOW }), error => error.code === 'PROJECTION_SNAPSHOT_INVALID')
for (const attempt of [
  null,
  { candidateId: currentCandidate.candidateId, result: 'passed', observedAt: OBSERVED_AT, attemptDigest: sha256('attempt') },
  { candidateId: currentCandidate.candidateId, result: 'failed', observedAt: 'not-time', attemptDigest: sha256('attempt') },
  { candidateId: currentCandidate.candidateId, result: 'failed', observedAt: '2026-07-23T15:30:00+08:00', attemptDigest: sha256('attempt') },
  { candidateId: currentCandidate.candidateId, result: 'failed', observedAt: OBSERVED_AT, attemptDigest: 'bad' }
]) {
  assert.strictEqual(createCommitValidationResult(null, { snapshot: goodSnapshot, deliveryAttempt: attempt, now: NOW }).state, 'not-attempted')
}

function ownerSource(owner, currentCandidate, requirement, raw, overrides = {}) {
  return buildSourceRef({
    owner,
    requirementId: requirement.requirementId,
    observedCandidateId: currentCandidate.candidateId,
    dependencyBindings: requirement.dependencyBindings,
    raw: { schemaVersion: `${owner}-fixture-v1`, ...raw },
    observedAt: OBSERVED_AT,
    actor: 'workflow-adapter-test',
    host: 'node',
    runId: `${owner}-${requirement.planOrder}`,
    evidenceRefs: [`adapter:${owner}`],
    ...overrides
  })
}

const ownerFixtures = {
  cp: [{ confirmed: true }, 'passed'],
  'execution-contract': [{ status: 'active' }, 'inconclusive'],
  attempt: [{ kind: 'formal', result: 'passed' }, 'passed'],
  validation: [{ nativeExitCode: 0, selectedNodeCount: 2, executionCount: 1, cacheHitCount: 1, requiredNodeMisses: [] }, 'passed'],
  review: [{ nextAction: 'accept', saturation: 'passed', open: 0, blocker: 0, stale: 0, unreviewed: 0 }, 'passed'],
  checkpoint: [{ status: 'pass', evidenceState: 'verified' }, 'passed'],
  sync: [{ status: 'synced' }, 'passed'],
  delivery: [{ status: 'read-back' }, 'passed'],
  manual: [{ status: 'passed' }, 'inconclusive']
}
assert.deepStrictEqual(Object.keys(ownerFixtures).sort(), Object.keys(OWNER_SPECS).sort())
for (const [owner, [raw, expectedResult]] of Object.entries(ownerFixtures)) {
  const ref = ownerSource(owner, currentCandidate, sourceRequirement, raw)
  assert.strictEqual(ref.result, expectedResult, `owner normalization drift: ${owner}`)
  const adapted = adaptSourceRef(ref, currentCandidate, sourceRequirement)
  assert.strictEqual(adapted.requirementId, sourceRequirement.requirementId)
  assert.strictEqual(adapted.qualification.satisfiesRequired, expectedResult === 'passed' && owner !== 'execution-contract' && owner !== 'manual')
}

function normalizedOwnerResult(owner, raw) {
  return ownerSource(owner, currentCandidate, sourceRequirement, raw).result
}

assert.strictEqual(normalizedOwnerResult('cp', { status: 'confirmed' }), 'passed')
assert.strictEqual(normalizedOwnerResult('cp', {}), 'inconclusive')
assert.strictEqual(normalizedOwnerResult('attempt', { plannedOnly: true }), 'inconclusive')
assert.strictEqual(normalizedOwnerResult('attempt', { result: 'failed' }), 'failed')
assert.strictEqual(normalizedOwnerResult('attempt', { result: 'error' }), 'failed')
assert.strictEqual(normalizedOwnerResult('attempt', {}), 'inconclusive')
assert.strictEqual(normalizedOwnerResult('validation', { nativeExitCode: 1 }), 'failed')
assert.strictEqual(normalizedOwnerResult('validation', { nativeExitCode: 0, failedNode: 'unit' }), 'failed')
assert.strictEqual(normalizedOwnerResult('validation', { selectedNodes: ['a'], executionOrder: ['a'] }), 'passed')
assert.strictEqual(normalizedOwnerResult('validation', { nativeExitCode: 0, selectedNodeCount: 2, executionCount: 1, requiredNodeMisses: [] }), 'inconclusive')
assert.strictEqual(normalizedOwnerResult('validation', {}), 'inconclusive')
assert.strictEqual(normalizedOwnerResult('review', { nextAction: 'continue', saturation: 'pending', open: 1 }), 'inconclusive')
assert.strictEqual(normalizedOwnerResult('checkpoint', { status: 'blocked' }), 'failed')
assert.strictEqual(normalizedOwnerResult('checkpoint', { status: 'pending' }), 'inconclusive')
assert.strictEqual(normalizedOwnerResult('sync', { status: 'passed' }), 'passed')
assert.strictEqual(normalizedOwnerResult('sync', { status: 'fresh' }), 'passed')
assert.strictEqual(normalizedOwnerResult('sync', { status: 'failed' }), 'failed')
assert.strictEqual(normalizedOwnerResult('sync', {}), 'inconclusive')
assert.strictEqual(normalizedOwnerResult('delivery', { status: 'persisted' }), 'passed')
assert.strictEqual(normalizedOwnerResult('delivery', { status: 'passed' }), 'passed')
assert.strictEqual(normalizedOwnerResult('delivery', { status: 'failed' }), 'failed')
assert.strictEqual(normalizedOwnerResult('delivery', {}), 'inconclusive')

const fallbackSource = buildSourceRef({
  owner: 'cp', requirementId: sourceRequirement.requirementId,
  raw: { status: 'confirmed', candidateId: currentCandidate.candidateId, completedAt: OBSERVED_AT, actor: 'raw-actor', host: 'raw-host', planId: 'raw-plan' }
})
assert.strictEqual(fallbackSource.observedCandidateId, currentCandidate.candidateId)
assert.deepStrictEqual(fallbackSource.dependencyBindings, {})
assert.strictEqual(fallbackSource.sourceSchema, 'UnknownSourceV1')
assert.strictEqual(fallbackSource.actor, 'raw-actor')
assert.strictEqual(fallbackSource.host, 'raw-host')
assert.strictEqual(fallbackSource.runId, 'raw-plan')
assert.strictEqual(fallbackSource.rawStatus, 'confirmed')
const emptySource = buildSourceRef({ owner: 'cp', requirementId: sourceRequirement.requirementId, raw: null })
assert.strictEqual(emptySource.actor, 'cp')
assert.strictEqual(emptySource.host, 'unknown')
assert.strictEqual(emptySource.rawStatus, null)
assert(Number.isFinite(Date.parse(emptySource.observedAt)))
const explicitIdentitySource = buildSourceRef({
  owner: 'attempt', requirementId: sourceRequirement.requirementId, raw: { result: 'passed', runId: 'raw-run' },
  sourceIdentity: currentCandidate.candidateIdentity, evidenceRefs: [' one ', '', 'one']
})
assert.strictEqual(explicitIdentitySource.runId, 'raw-run')
assert.deepStrictEqual(explicitIdentitySource.evidenceRefs, ['one'])

assert.deepStrictEqual(normalizeLifecycleState([]).sourceRefs, [])
assert.deepStrictEqual(normalizeLifecycleState({ sourceRefs: 'invalid' }).sourceRefs, [])
const restoredLifecycle = normalizeLifecycleState({
  sourceRefs: [null, { owner: 'cp' }], overflow: true, finalReconcileRequested: true,
  lastEvent: 'Stop', lastObservedAt: OBSERVED_AT, lastReconciliation: { status: 'PASS' }
})
assert.strictEqual(restoredLifecycle.sourceRefs.length, 1)
assert.strictEqual(restoredLifecycle.overflow, true)
assert.strictEqual(restoredLifecycle.finalReconcileRequested, true)
assert.strictEqual(restoredLifecycle.lastEvent, 'Stop')
assert.strictEqual(restoredLifecycle.lastObservedAt, OBSERVED_AT)
assert.deepStrictEqual(restoredLifecycle.lastReconciliation, { status: 'PASS' })
assert.strictEqual(normalizeLifecycleState({ lastReconciliation: [] }).lastReconciliation, null)

assert.throws(() => buildSourceRef({ owner: 'unknown', requirementId: 'requirements.coverage' }), error => error instanceof WorkflowCompletionLifecycleError && error.code === 'WORKFLOW_SOURCE_OWNER_INVALID')
assert.throws(() => buildSourceRef(), error => error.code === 'WORKFLOW_SOURCE_OWNER_INVALID')
assert.throws(() => buildSourceRef({ owner: 'cp' }), error => error.code === 'WORKFLOW_SOURCE_REQUIREMENT_REQUIRED')
assert.throws(() => createCompletionStore({ activeRoot: '', taskKey: 'task' }), error => error.code === 'WORKFLOW_ACTIVE_ROOT_REQUIRED')
expectNegative('adapter-source-schema-invalid', () => {
  const ref = { ...ownerSource('cp', currentCandidate, sourceRequirement, { confirmed: true }), schemaVersion: 'UnknownSourceRefV9' }
  try { adaptSourceRef(ref, currentCandidate, sourceRequirement); return false } catch (error) { return error.code === 'WORKFLOW_SOURCE_SCHEMA_INVALID' }
})
expectNegative('adapter-source-requirement-mismatch', () => {
  const ref = ownerSource('cp', currentCandidate, sourceRequirement, { confirmed: true }, { requirementId: 'other.requirement' })
  try { adaptSourceRef(ref, currentCandidate, sourceRequirement); return false } catch (error) { return error.code === 'WORKFLOW_SOURCE_REQUIREMENT_MISMATCH' }
})
expectNegative('adapter-unknown-requirement-fails-closed', () => {
  const ref = ownerSource('cp', currentCandidate, sourceRequirement, { confirmed: true }, { requirementId: 'other.requirement' })
  const adapted = adaptSourceRefs([ref], currentCandidate, currentPlan)
  return !adapted.valid && adapted.diagnostics.includes('source-requirement-unknown:other.requirement')
})
assert.strictEqual(adaptSourceRefs(null, currentCandidate, currentPlan).diagnostics[0], 'source-refs-invalid')
expectNegative('adapter-known-requirement-error-diagnostic', () => {
  const bad = { ...ownerSource('cp', currentCandidate, sourceRequirement, { confirmed: true }), schemaVersion: 'UnknownSourceRefV9' }
  const adapted = adaptSourceRefs([bad], currentCandidate, currentPlan)
  return !adapted.valid && adapted.diagnostics.some(item => item.startsWith('WORKFLOW_SOURCE_SCHEMA_INVALID:'))
})
assert.throws(() => adaptSourceRef({ schemaVersion: 'WorkflowCompletionSourceRefV1', owner: 'unknown', requirementId: sourceRequirement.requirementId }, currentCandidate, sourceRequirement), error => error.code === 'WORKFLOW_SOURCE_OWNER_INVALID')

function passingSourceRefs(currentCandidate, currentPlan) {
  const byId = new Map(currentPlan.requirements.map(item => [item.requirementId, item]))
  return [
    ownerSource('cp', currentCandidate, byId.get('requirements.coverage'), { confirmed: true }),
    ownerSource('checkpoint', currentCandidate, byId.get('governance.compliance'), { status: 'pass', evidenceState: 'verified' }),
    ownerSource('validation', currentCandidate, byId.get('workflow.verification'), { nativeExitCode: 0, selectedNodeCount: 1, executionCount: 1, requiredNodeMisses: [] }),
    ownerSource('delivery', currentCandidate, byId.get('delivery.manifest'), { status: 'persisted' })
  ]
}

const lifecycleBinding = {
  requirementId: sourceRequirement.requirementId,
  candidateId: currentCandidate.candidateId,
  dependencyBindings: sourceRequirement.dependencyBindings,
  eventId: 'tool-event-1'
}
const plannedLifecycle = observeWorkflowCompletionEvent(null, 'PreToolUse', { devcodexWorkflowCompletion: lifecycleBinding }, { host: 'codex', observedAt: OBSERVED_AT })
assert.strictEqual(plannedLifecycle.sourceRefs[0].result, 'inconclusive')
const completedLifecycle = observeWorkflowCompletionEvent(plannedLifecycle, 'PostToolUse', { devcodexWorkflowCompletion: lifecycleBinding, success: true }, { host: 'codex', observedAt: OBSERVED_AT })
assert.strictEqual(completedLifecycle.sourceRefs.length, 2)
assert.strictEqual(observeWorkflowCompletionEvent(completedLifecycle, 'PostToolUse', { devcodexWorkflowCompletion: lifecycleBinding, success: true }, { host: 'codex', observedAt: OBSERVED_AT }).sourceRefs.length, 2)
const stoppedLifecycle = observeWorkflowCompletionEvent(completedLifecycle, 'Stop', {}, { host: 'codex', observedAt: OBSERVED_AT })
expectNegative('lifecycle-stop-no-complete', () => stoppedLifecycle.finalReconcileRequested && !Object.prototype.hasOwnProperty.call(stoppedLifecycle, 'workflowComplete'))
assert.strictEqual(observeWorkflowCompletionEvent(stoppedLifecycle, 'UserPromptSubmit', {}, { observedAt: OBSERVED_AT }).finalReconcileRequested, false)
assert.strictEqual(observeWorkflowCompletionEvent(stoppedLifecycle, 'BeforeAgent', {}, { observedAt: OBSERVED_AT }).finalReconcileRequested, false)
assert.strictEqual(observeWorkflowCompletionEvent(completedLifecycle, 'AfterAgent', {}, { observedAt: OBSERVED_AT }).finalReconcileRequested, true)
assert.strictEqual(observeWorkflowCompletionEvent(null, '', null).lastEvent, '')
assert.strictEqual(observeWorkflowCompletionEvent(null, 'PostToolUse', { workflowCompletion: {} }, { observedAt: OBSERVED_AT }).sourceRefs.length, 0)
const failedLifecycle = observeWorkflowCompletionEvent(null, 'PostToolUseFailure', {
  workflowCompletion: { ...lifecycleBinding, eventId: null, actor: 'bound-actor', host: 'bound-host', runId: 'bound-run', evidenceRefs: ['failure:evidence'] },
  tool_use_id: 'tool-use-fallback'
}, { observedAt: OBSERVED_AT })
assert.strictEqual(failedLifecycle.sourceRefs[0].result, 'failed')
assert.strictEqual(failedLifecycle.sourceRefs[0].actor, 'bound-actor')
assert.strictEqual(failedLifecycle.sourceRefs[0].host, 'bound-host')
assert.strictEqual(failedLifecycle.sourceRefs[0].runId, 'bound-run')
assert.deepStrictEqual(failedLifecycle.sourceRefs[0].evidenceRefs, ['failure:evidence'])
for (const payload of [{ success: false }, { is_error: true }, { isError: true }, { error: 'failed' }]) {
  const state = observeWorkflowCompletionEvent(null, 'PostToolUse', { ...payload, workflowCompletion: { ...lifecycleBinding, eventId: `failure-${Object.keys(payload)[0]}` } }, { observedAt: OBSERVED_AT })
  assert.strictEqual(state.sourceRefs[0].result, 'failed')
}
assert.strictEqual(normalizeLifecycleState({ sourceRefs: Array.from({ length: MAX_SOURCE_REFS + 5 }, () => ({})) }).sourceRefs.length, MAX_SOURCE_REFS)
const fullLifecycle = normalizeLifecycleState({ sourceRefs: Array.from({ length: MAX_SOURCE_REFS }, (_, index) => ({ owner: 'attempt', runId: `old-${index}`, result: 'passed' })) })
expectNegative('lifecycle-source-cap', () => observeWorkflowCompletionEvent(fullLifecycle, 'PostToolUse', {
  devcodexWorkflowCompletion: { ...lifecycleBinding, eventId: 'overflow-event' }, success: true
}, { observedAt: OBSERVED_AT }).overflow)

assert.strictEqual(taskKeyDigest(' task\\alpha '), taskKeyDigest('task/alpha'))
assert(derivedStateRelativePath('task/alpha').startsWith('workflow-completion/'))
assert.throws(() => taskKeyDigest(' '), error => error.code === 'WORKFLOW_TASK_KEY_REQUIRED')
assert.throws(() => taskKeyDigest(), error => error.code === 'WORKFLOW_TASK_KEY_REQUIRED')
assert.strictEqual(
  reconciliationIdentity({ taskKey: 'task/alpha', candidate: currentCandidate, plan: currentPlan, sourceRefs: passingSourceRefs(currentCandidate, currentPlan) }),
  reconciliationIdentity({ taskKey: 'task/alpha', candidate: currentCandidate, plan: currentPlan, sourceRefs: passingSourceRefs(currentCandidate, currentPlan).reverse() })
)
assert.strictEqual(typeof reconciliationIdentity({ taskKey: 'task/empty' }), 'string')
assert.throws(() => reconcileWorkflowCompletion({ taskKey: 'invalid', candidate: null, plan: currentPlan }), error => error.code === 'WORKFLOW_RECONCILIATION_INPUT_INVALID' && error.details.length > 0)

const noReceiptReconciliation = reconcileWorkflowCompletion({
  activeRoot: require('os').tmpdir(), taskKey: 'devcodex-workflow-no-receipts', candidate: currentCandidate, plan: currentPlan,
  rollout: rollout(), generatedAt: GENERATED_AT, nowMs: NOW, persist: false
})
assert.strictEqual(noReceiptReconciliation.status, 'UNVERIFIED')
const fakePreviousStore = {
  read: () => ({ status: 'fresh', value: { current: {} } }),
  write: value => ({ schemaVersion: 'DerivedStateStoreReceiptV1', status: 'persisted', value })
}
const previousFallback = reconcileWorkflowCompletion({
  taskKey: 'fake-previous', candidate: currentCandidate, plan: currentPlan,
  sourceRefs: passingSourceRefs(currentCandidate, currentPlan), rollout: rollout(),
  generatedAt: GENERATED_AT, nowMs: NOW, store: fakePreviousStore
})
assert.deepStrictEqual(previousFallback.storeReceipt.value.previous, { candidateId: null, coreSnapshotDigest: null, generatedAt: null })
const unknownStoreFailure = reconcileWorkflowCompletion({
  taskKey: 'fake-store-failure', candidate: currentCandidate, plan: currentPlan,
  sourceRefs: passingSourceRefs(currentCandidate, currentPlan), rollout: rollout(),
  generatedAt: GENERATED_AT, nowMs: NOW,
  store: { read: () => ({ status: 'missing' }), write: () => ({ status: 'error' }) }
})
assert(unknownStoreFailure.diagnostics.includes('store-error:unknown'))
const invalidDerivedState = readWorkflowCompletionState({
  taskKey: 'invalid-derived-state',
  store: { read: () => ({ status: 'fresh', value: { schemaVersion: 'UnknownDerivedStateV9', taskKeyDigest: 'wrong' } }) }
})
assert.strictEqual(invalidDerivedState.errorCode, 'WORKFLOW_DERIVED_STATE_SCOPE_MISMATCH')

{
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-workflow-completion-'))
  const taskKey = 'requirements/workflow-alpha'
  try {
    const store = createCompletionStore({ activeRoot: tempRoot, taskKey, now: () => NOW, maxWrites: 1 })
    const first = reconcileWorkflowCompletion({
      activeRoot: tempRoot, taskKey, candidate: currentCandidate, plan: currentPlan,
      sourceRefs: passingSourceRefs(currentCandidate, currentPlan), rollout: rollout(),
      generatedAt: GENERATED_AT, nowMs: NOW, store
    })
    assert.strictEqual(first.status, 'PASS')
    assert.strictEqual(first.storeReceipt.status, 'persisted')
    assert.strictEqual(readWorkflowCompletionState({ activeRoot: tempRoot, taskKey, candidateIdentity: currentCandidate.candidateIdentity }).status, 'fresh')
    expectNegative('task-isolation', () => readWorkflowCompletionState({ activeRoot: tempRoot, taskKey: 'requirements/workflow-beta', candidateIdentity: currentCandidate.candidateIdentity }).status === 'missing')
    expectNegative('candidate-local-invalidation', () => readWorkflowCompletionState({ activeRoot: tempRoot, taskKey, candidateIdentity: nextCandidate.candidateIdentity }).status === 'stale')

    const writeBudget = reconcileWorkflowCompletion({
      activeRoot: tempRoot, taskKey, candidate: currentCandidate, plan: currentPlan,
      sourceRefs: passingSourceRefs(currentCandidate, currentPlan), rollout: rollout(),
      generatedAt: GENERATED_AT, nowMs: NOW, store
    })
    expectNegative('store-write-budget-fails-closed', () => writeBudget.status === 'UNVERIFIED' && writeBudget.storeReceipt.errorCode === 'DERIVED_STATE_WRITE_BUDGET_REACHED')

    const nextStore = createCompletionStore({ activeRoot: tempRoot, taskKey, now: () => NOW, maxWrites: 1 })
    const second = reconcileWorkflowCompletion({
      activeRoot: tempRoot, taskKey, candidate: nextCandidate, plan: nextPlan,
      sourceRefs: passingSourceRefs(nextCandidate, nextPlan), rollout: rollout(),
      generatedAt: GENERATED_AT, nowMs: NOW, store: nextStore
    })
    assert.strictEqual(second.status, 'PASS')
    const nextState = readWorkflowCompletionState({ activeRoot: tempRoot, taskKey, candidateIdentity: nextCandidate.candidateIdentity })
    assert.strictEqual(nextState.value.previous.candidateId, currentCandidate.candidateId)

    const lockedStore = createCompletionStore({ activeRoot: tempRoot, taskKey: 'requirements/locked', now: () => NOW, lockWaitMs: 0 })
    fs.mkdirSync(path.dirname(lockedStore.lockPath), { recursive: true })
    fs.writeFileSync(lockedStore.lockPath, '{"owner":"fixture"}\n', 'utf8')
    try {
      const locked = reconcileWorkflowCompletion({
        taskKey: 'requirements/locked', candidate: currentCandidate, plan: currentPlan,
        sourceRefs: passingSourceRefs(currentCandidate, currentPlan), rollout: rollout(),
        generatedAt: GENERATED_AT, nowMs: NOW, store: lockedStore
      })
      expectNegative('store-lock-timeout-fails-closed', () => locked.status === 'UNVERIFIED' && locked.storeReceipt.errorCode === 'DERIVED_STATE_LOCK_TIMEOUT')
    } finally {
      fs.unlinkSync(lockedStore.lockPath)
    }

    const smallStore = createCompletionStore({ activeRoot: tempRoot, taskKey: 'requirements/small', now: () => NOW, maxBytes: 64 })
    const capacity = reconcileWorkflowCompletion({
      taskKey: 'requirements/small', candidate: currentCandidate, plan: currentPlan,
      sourceRefs: passingSourceRefs(currentCandidate, currentPlan), rollout: rollout(),
      generatedAt: GENERATED_AT, nowMs: NOW, store: smallStore
    })
    expectNegative('store-capacity-fails-closed', () => capacity.status === 'UNVERIFIED' && capacity.storeReceipt.errorCode === 'DERIVED_STATE_CAPACITY_EXCEEDED')

    const noPersist = reconcileWorkflowCompletion({
      activeRoot: tempRoot, taskKey: 'requirements/no-persist', candidate: currentCandidate, plan: currentPlan,
      sourceRefs: passingSourceRefs(currentCandidate, currentPlan), rollout: rollout(),
      generatedAt: GENERATED_AT, nowMs: NOW, persist: false
    })
    assert.strictEqual(noPersist.status, 'PASS')
    assert.strictEqual(noPersist.storeReceipt.errorCode, 'PERSIST_DISABLED')

    const taskRoot = path.join(tempRoot, 'requirements', 'cli-fixture')
    fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
    assert.strictEqual(readWorkflowCompletionRollout(tempRoot, rollout()).status, 'defaulted')
    fs.mkdirSync(path.join(tempRoot, 'profile'), { recursive: true })
    const profileConfigPath = path.join(tempRoot, 'profile', 'config.json')
    fs.writeFileSync(profileConfigPath, `${JSON.stringify({ extensions: { devcodex: { workflowCompletion: { mode: 'shadow' } } } })}\n`, 'utf8')
    assert.strictEqual(readWorkflowCompletionRollout(tempRoot, rollout()).status, 'configured')
    const inputValue = {
      schemaVersion: 'WorkflowCompletionInputV1',
      candidate: currentCandidate,
      plan: currentPlan,
      sourceRefs: passingSourceRefs(currentCandidate, currentPlan),
      rollout: rollout('enforce'),
      generatedAt: GENERATED_AT
    }
    const inputWrite = materializeWorkflowCompletionInput({ taskRoot, value: inputValue, now: () => NOW })
    assert.strictEqual(inputWrite.status, 'persisted')
    assert.strictEqual(inputWrite.filePath, workflowInputPath(taskRoot))
    assert.strictEqual(readWorkflowCompletionInput(taskRoot).status, 'fresh')
    assert.strictEqual(materializeWorkflowCompletionInput({ taskRoot, value: inputValue }).status, 'persisted')
    expectNegative('workflow-input-schema-fails-closed', () => !validateWorkflowCompletionInput({ ...inputValue, schemaVersion: 'UnknownInputV9' }).valid)
    expectNegative('workflow-input-source-array-fails-closed', () => !validateWorkflowCompletionInput({ ...inputValue, sourceRefs: null }).valid)
    expectNegative('workflow-input-rollout-fails-closed', () => !validateWorkflowCompletionInput({ ...inputValue, rollout: { ...inputValue.rollout, mode: 'invalid', ruleSetDigest: sha256('wrong') } }).valid)
    expectNegative('workflow-input-time-fails-closed', () => !validateWorkflowCompletionInput({ ...inputValue, generatedAt: 'not-a-time' }).valid)
    const oversizedInput = clone(inputValue)
    oversizedInput.sourceRefs[0].evidenceRefs = ['x'.repeat(MAX_SOURCE_REFS * 8192)]
    const oversizedWrite = materializeWorkflowCompletionInput({ taskRoot, value: oversizedInput, now: () => NOW })
    expectNegative('workflow-input-capacity-fails-closed', () => oversizedWrite.status === 'UNVERIFIED' && oversizedWrite.storeReceipt.errorCode === 'DERIVED_STATE_CAPACITY_EXCEEDED')
    assert.throws(() => materializeWorkflowCompletionInput({
      taskRoot,
      value: { ...inputValue, sourceRefs: [{ ...inputValue.sourceRefs[0], requirementId: 'unknown.requirement' }] },
      now: () => NOW
    }), error => error.code === 'WORKFLOW_INPUT_INVALID' && error.details.some(detail => detail.includes('source-requirement-unknown')))
    fs.writeFileSync(`${workflowInputPath(taskRoot)}.lock`, '{"fixture":true}\n', 'utf8')
    try {
      const lockedInputWrite = materializeWorkflowCompletionInput({ taskRoot, value: inputValue, lockWaitMs: 0, now: () => NOW })
      expectNegative('workflow-input-lock-fails-closed', () => lockedInputWrite.status === 'UNVERIFIED' && lockedInputWrite.storeReceipt.errorCode === 'DERIVED_STATE_LOCK_TIMEOUT')
    } finally {
      fs.unlinkSync(`${workflowInputPath(taskRoot)}.lock`)
    }
    const cliVerified = verifyTaskWorkflowCompletion({ activeRoot: tempRoot, taskRoot, taskKey: 'cli-fixture', nowMs: NOW })
    assert.strictEqual(cliVerified.reconciliation.status, 'PASS')
    assert.strictEqual(cliVerified.rollout.value.mode, 'shadow', 'Profile rollout must override task-local mode escalation')
    assert.strictEqual(cliVerified.projection.completionPhase, 'delivery-prepared')
    assert.strictEqual(cliVerified.projection.workflowComplete, false)
    assert.strictEqual(inspectTaskWorkflowCompletion({ activeRoot: tempRoot, taskRoot, taskKey: 'cli-fixture', nowMs: NOW }).projection.coreSnapshotDigest, cliVerified.projection.coreSnapshotDigest)
    fs.writeFileSync(profileConfigPath, `${JSON.stringify({ extensions: { devcodex: { workflowCompletion: { mode: 'rolled-back' } } } })}\n`, 'utf8')
    expectNegative('rollout-config-drift-readonly-unverified', () => inspectTaskWorkflowCompletion({ activeRoot: tempRoot, taskRoot, taskKey: 'cli-fixture', nowMs: NOW }).status === 'UNVERIFIED')
    fs.writeFileSync(profileConfigPath, `${JSON.stringify({ extensions: { devcodex: { workflowCompletion: { mode: 'invalid' } } } })}\n`, 'utf8')
    expectNegative('rollout-config-invalid-fails-closed', () => readWorkflowCompletionRollout(tempRoot, rollout()).status === 'invalid')
    fs.writeFileSync(profileConfigPath, `${JSON.stringify({ extensions: { devcodex: { workflowCompletion: { mode: 'shadow' } } } })}\n`, 'utf8')

    const ledgerFile = riskLedgerPath(taskRoot)
    assert.throws(() => appendRiskAcceptanceDecision({
      taskRoot, action: 'accept', requirementId: 'governance.compliance', actor: 'explicit-user', reason: 'not allowed',
      createdAt: OBSERVED_AT, nowMs: NOW
    }), error => error.code === 'RISK_REQUIREMENT_NON_WAIVABLE')
    assert.strictEqual(fs.existsSync(ledgerFile), false, 'non-waivable rejection must be zero-write')
    const accepted = appendRiskAcceptanceDecision({
      taskRoot, action: 'accept', requirementId: 'requirements.coverage', actor: 'explicit-user', reason: 'time-bounded fixture',
      createdAt: OBSERVED_AT, expiresAt: '2026-07-23T08:00:00Z', nowMs: NOW
    })
    assert.strictEqual(readRiskAcceptanceLedger(taskRoot, { now: NOW }).receipts.length, 1)
    const revoked = appendRiskAcceptanceDecision({
      taskRoot, action: 'revoke', receiptDigest: accepted.receipt.receiptDigest, actor: 'explicit-user', reason: 'fixture revoked',
      createdAt: '2026-07-22T08:01:00Z', nowMs: NOW
    })
    assert.strictEqual(revoked.receipt.action, 'revoke')
    assert.strictEqual(readRiskAcceptanceLedger(taskRoot, { now: NOW }).receipts.length, 2)
    fs.writeFileSync(`${ledgerFile}.lock`, '{"fixture":true}\n', 'utf8')
    try {
      assert.throws(() => appendRiskAcceptanceDecision({
        taskRoot, action: 'accept', requirementId: 'requirements.coverage', actor: 'explicit-user', reason: 'locked',
        createdAt: '2026-07-22T08:01:00Z', nowMs: NOW
      }), error => error.code === 'RISK_LEDGER_LOCKED')
    } finally {
      fs.unlinkSync(`${ledgerFile}.lock`)
    }

    const shadowStore = createShadowWindowStore({ activeRoot: tempRoot, now: () => NOW })
    assert.strictEqual(shadowStore.filePath, path.join(tempRoot, '.runtime-state', ...shadowWindowRelativePath().split('/')))
    const firstShadow = shadowSample(70, { observedAt: '2026-07-22T07:00:00Z' })
    const shadowRecorded = recordShadowEvidenceSample({ activeRoot: tempRoot, sample: firstShadow, startedAt: '2026-06-22T08:00:00Z', nowMs: NOW })
    assert.strictEqual(shadowRecorded.status, 'recorded')
    assert.strictEqual(shadowRecorded.window.uniqueRealSamples, 1)
    assert.strictEqual(recordShadowEvidenceSample({ activeRoot: tempRoot, sample: firstShadow, nowMs: NOW }).status, 'duplicate')
    const shadowBytesBeforeInvalid = fs.statSync(shadowStore.filePath).size
    assert.throws(() => recordShadowEvidenceSample({ activeRoot: tempRoot, sample: { ...firstShadow, fixture: true }, nowMs: NOW }), error => error.code === 'SHADOW_SAMPLE_INVALID')
    assert.strictEqual(fs.statSync(shadowStore.filePath).size, shadowBytesBeforeInvalid, 'invalid shadow sample must be zero-write')
    const nextRuleSetDigest = sha256('workflow-completion-rules-v2')
    const nextShadow = shadowSample(71, { ruleSetDigest: nextRuleSetDigest, observedAt: '2026-07-22T07:30:00Z' })
    assert.strictEqual(recordShadowEvidenceSample({ activeRoot: tempRoot, sample: nextShadow, nowMs: NOW }).status, 'recorded')
    const currentShadow = readShadowEvidenceWindow({ activeRoot: tempRoot, ruleSetDigest: nextRuleSetDigest })
    assert.strictEqual(currentShadow.status, 'fresh')
    assert.strictEqual(currentShadow.value.current.window.uniqueRealSamples, 1)
    assert.strictEqual(currentShadow.value.previous.ruleSetDigest, RULE_SET_DIGEST)
    expectNegative('shadow-ruleset-change-resets-current', () => readShadowEvidenceWindow({ activeRoot: tempRoot, ruleSetDigest: RULE_SET_DIGEST }).status === 'stale')

    const missingTaskRoot = path.join(tempRoot, 'requirements', 'missing-input')
    assert.strictEqual(verifyTaskWorkflowCompletion({ activeRoot: tempRoot, taskRoot: missingTaskRoot, taskKey: 'missing-input', nowMs: NOW }).status, 'UNVERIFIED')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

{
  const logs = []
  const fakeProcess = { exitCode: 0, env: { USERNAME: 'cli-user' }, cwd: () => 'C:/fixture' }
  const identityColor = value => String(value)
  const fakeC = { red: identityColor, dim: identityColor, bold: identityColor, cyan: identityColor, yellow: identityColor, green: identityColor }
  const taskResolution = {
    status: 'resolved-active',
    candidate: { displayName: 'CLI Fixture', project: 'devcodex', kind: 'requirements', taskId: 'cli-id', taskRoot: 'C:/fixture/.devcodex/devcodex/requirements/cli-fixture' }
  }
  let verifyProjection = committedProjection
  let riskCalls = 0
  const cli = buildCliExecutionCommands({
    process: fakeProcess,
    console: { log: value => logs.push(String(value)) },
    c: fakeC,
    resolveTask: () => taskResolution,
    resolveUniqueTask: () => taskResolution,
    verifyCompletion: () => ({ schemaVersion: 'WorkflowCompletionCliViewV1', status: verifyProjection.workflowEvidenceState, projection: verifyProjection }),
    appendRisk: input => {
      riskCalls += 1
      if (input.requirementId === 'governance.compliance') throw new WorkflowCompletionLifecycleError('RISK_REQUIREMENT_NON_WAIVABLE', 'non-waivable')
      return { receipt: { receiptDigest: sha256('cli-risk') } }
    }
  })
  const verified = cli.cmdTask(['verify', '--task', 'CLI Fixture', '--json'])
  assert.strictEqual(verified.completion.projection.projectionDigest, committedProjection.projectionDigest)
  assert.strictEqual(fakeProcess.exitCode, 0)
  assert.strictEqual(JSON.parse(logs.pop()).command, 'task.verify')
  verifyProjection = preparedProjection
  cli.cmdTask(['verify', '--json'])
  assert.strictEqual(fakeProcess.exitCode, 1)
  assert.strictEqual(JSON.parse(logs.pop()).payload.completion.projection.workflowComplete, false)
  cli.cmdTask(['risk', 'accept', '--task', 'CLI Fixture', '--requirement', 'requirements.coverage', '--reason', 'fixture', '--json'])
  assert.strictEqual(fakeProcess.exitCode, 0)
  assert.strictEqual(riskCalls, 1)
  assert.strictEqual(JSON.parse(logs.pop()).command, 'task.risk.accept')
  cli.cmdTask(['risk', 'accept', '--task', 'CLI Fixture', '--requirement', 'governance.compliance', '--reason', 'blocked', '--json'])
  assert.strictEqual(fakeProcess.exitCode, 1)
  assert.strictEqual(JSON.parse(logs.pop()).errorCode, 'RISK_REQUIREMENT_NON_WAIVABLE')
  const callsBeforeInvalid = riskCalls
  cli.cmdTask(['risk', 'revoke', '--receipt', sha256('receipt'), '--reason', 'missing task', '--json'])
  assert.strictEqual(fakeProcess.exitCode, 2)
  assert.strictEqual(riskCalls, callsBeforeInvalid, 'invalid risk selector must be zero-write')
}

expectNegative('source-ref-overflow-no-write', () => {
  const result = reconcileWorkflowCompletion({
    taskKey: 'requirements/overflow', candidate: currentCandidate, plan: currentPlan,
    sourceRefs: Array.from({ length: MAX_SOURCE_REFS + 1 }, () => ownerSource('cp', currentCandidate, sourceRequirement, { confirmed: true })),
    rollout: rollout(), generatedAt: GENERATED_AT, nowMs: NOW
  })
  return result.status === 'UNVERIFIED' && result.snapshot === null && result.storeReceipt === null
})

function shadowSample(index, overrides = {}) {
  const day = String((index % 31) + 1).padStart(2, '0')
  return {
    taskKey: `task-${index}`,
    candidateId: `workflow-candidate-${sha256(`candidate-${index}`)}`,
    ruleSetDigest: RULE_SET_DIGEST,
    workflow: index < 10 ? 'dev' : 'fix',
    observedAt: `2026-07-${day}T00:00:00Z`,
    legacyComparison: 'same',
    fixture: false,
    ...overrides
  }
}

expectNegative('shadow-fixtures-excluded', () => evaluateShadowEvidenceWindow([shadowSample(0, { fixture: true })], RULE_SET_DIGEST, { now: NOW }).uniqueRealSamples === 0)
expectNegative('shadow-deduplicates-task-candidate-rule', () => evaluateShadowEvidenceWindow([shadowSample(0), shadowSample(0)], RULE_SET_DIGEST, { now: NOW }).uniqueRealSamples === 1)
expectNegative('shadow-low-volume-cannot-promote', () => !evaluateShadowEvidenceWindow(Array.from({ length: 19 }, (_, index) => shadowSample(index)), RULE_SET_DIGEST, { now: NOW }).eligibleForPromotion)
expectNegative('shadow-short-window-cannot-promote', () => {
  const samples = Array.from({ length: 20 }, (_, index) => shadowSample(index, { observedAt: `2026-07-${String((index % 20) + 1).padStart(2, '0')}T00:00:00Z` }))
  return !evaluateShadowEvidenceWindow(samples, RULE_SET_DIGEST, { now: NOW }).eligibleForPromotion
})
expectNegative('shadow-dev-floor', () => {
  const samples = Array.from({ length: 20 }, (_, index) => shadowSample(index, { workflow: index < 4 ? 'dev' : 'fix', observedAt: index === 19 ? '2026-07-22T00:00:00Z' : `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00Z` }))
  return !evaluateShadowEvidenceWindow(samples, RULE_SET_DIGEST, { now: NOW }).eligibleForPromotion
})
expectNegative('shadow-fix-floor', () => {
  const samples = Array.from({ length: 20 }, (_, index) => shadowSample(index, { workflow: index < 16 ? 'dev' : 'fix', observedAt: index === 19 ? '2026-07-22T00:00:00Z' : `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00Z` }))
  return !evaluateShadowEvidenceWindow(samples, RULE_SET_DIGEST, { now: NOW }).eligibleForPromotion
})
expectNegative('shadow-false-allow-rolls-back', () => evaluateShadowEvidenceWindow([shadowSample(0, { legacyComparison: 'false-allow' })], RULE_SET_DIGEST, { now: NOW }).recommendedMode === 'rolled-back')
expectNegative('shadow-false-block-rolls-back', () => evaluateShadowEvidenceWindow([shadowSample(0, { legacyComparison: 'false-block' })], RULE_SET_DIGEST, { now: NOW }).recommendedMode === 'rolled-back')
expectNegative('shadow-outside-rolling-window-excluded', () => evaluateShadowEvidenceWindow([shadowSample(0, { observedAt: '2026-06-21T07:59:59Z' })], RULE_SET_DIGEST, { now: NOW, windowStartedAt: '2026-06-22T08:00:00Z' }).uniqueRealSamples === 0)

const promotionSamples = Array.from({ length: 20 }, (_, index) => shadowSample(index, {
  observedAt: new Date(Date.parse('2026-06-22T08:00:00Z') + (index * 86400000)).toISOString()
}))
const promotion = evaluateShadowEvidenceWindow(promotionSamples, RULE_SET_DIGEST, { now: NOW, windowStartedAt: '2026-06-22T08:00:00Z' })
assert.strictEqual(promotion.eligibleForPromotion, true)
assert.strictEqual(promotion.recommendedMode, 'enforce-candidate')

const root = require('path').resolve(__dirname, '..')
assert.deepStrictEqual(inspectWorkflowCompletionControls(root), [])
{
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const unavailableActiveRoot = path.join(os.tmpdir(), 'devcodex-workflow-profile-unavailable')
  assert.deepStrictEqual(inspectWorkflowCompletionControls(root, { activeRoot: unavailableActiveRoot }), [])
  const activeRootFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-workflow-profile-'))
  const profileDir = path.join(activeRootFixture, 'profile')
  try {
    fs.mkdirSync(profileDir, { recursive: true })
    fs.writeFileSync(path.join(profileDir, 'config.json'), `${JSON.stringify({ extensions: { devcodex: { workflowCompletion: { mode: 'shadow' } } } })}\n`, 'utf8')
    const profileAnchors = {
      '01-项目信息.md': 'workflowCompletion.mode\nB5a shadow readiness\n',
      '02-架构约束.md': 'workflow-completion-contract.cjs\nlifecycle-workflow-completion.cjs\n',
      '04-测试规范.md': 'test:workflow-completion\nWorkflow completion / ECR\n',
      '06-功能清单.md': 'workflow-completion\nreleased-shadow-v1.15.4\n',
      '07-用户文档与契约规范.md': 'Workflow completion 契约\nwaiting-external\n'
    }
    for (const [file, content] of Object.entries(profileAnchors)) fs.writeFileSync(path.join(profileDir, file), content, 'utf8')
    assert.deepStrictEqual(inspectWorkflowCompletionControls(root, { activeRoot: activeRootFixture }), [])
    fs.writeFileSync(path.join(profileDir, 'config.json'), `${JSON.stringify({ extensions: { devcodex: { workflowCompletion: { mode: 'enforce' } } } })}\n`, 'utf8')
    expectNegative('v104-profile-rollout-not-shadow', () => inspectWorkflowCompletionControls(root, { activeRoot: activeRootFixture }).includes('profile-rollout-mode-not-shadow'))
  } finally {
    fs.rmSync(activeRootFixture, { recursive: true, force: true })
  }
}
const validatorErrors = []
buildWorkflowCompletionControlChecks({
  ROOT: root,
  fs: require('fs'),
  path: require('path'),
  read: file => require('fs').readFileSync(file, 'utf8'),
  err: message => validatorErrors.push(message),
  console: { log() {} }
}).checkV104()
assert.deepStrictEqual(validatorErrors, [])

const nodeFs = require('fs')
const nodePath = require('path')
const readVirtualBaseline = createCanonicalAwareReader(root, file => nodeFs.readFileSync(file, 'utf8'))
const virtualRelatives = [
  'hooks/_runtime/workflow-completion-contract.cjs',
  'hooks/_runtime/lifecycle-workflow-completion.cjs',
  'skills/compliance/workflow-completion.schema.json',
  'scripts/lib/validate-workflow-completion-controls.js',
  'scripts/test-workflow-completion-contract.js',
  'scripts/lib/completion-report-ecr-check.js',
  'scripts/test-completion-report-ecr-check.js',
  'scripts/lib/cli-execution-commands.js',
  'scripts/lib/cli-maintenance-commands.js',
  'scripts/lib/cli-observability-commands.js',
  'hooks/_runtime/lifecycle-visible-reply.cjs',
  'scripts/test-host-adapters.js',
  'scripts/validation-manifest.json',
  'scripts/critical-coverage.json',
  'package.json',
  'instructions.md',
  'instructions/01-common.instructions.md',
  'instructions/17-compliance.instructions.md',
  'skills/compliance/SKILL.md',
  'scripts/host-instruction-projection.json',
  'website/docs/specs/compliance-framework.md',
  'website/docs/specs/completion-compliance-flow.md',
  'README.md',
  'changelogs/unreleased.md',
  'website/docs/guide/development.md'
]
const virtualBaseline = Object.fromEntries(virtualRelatives.map(relative => [relative, readVirtualBaseline(nodePath.join(root, relative))]))

function virtualContext(mutate) {
  const files = { ...virtualBaseline }
  mutate(files)
  const normalize = value => String(value).replace(/\\/g, '/').replace(/^\.\//, '')
  return {
    files,
    io: {
      fs: {
        existsSync(file) { return Object.prototype.hasOwnProperty.call(files, normalize(file)) },
        readFileSync(file) { return files[normalize(file)] }
      },
      path: { join: (...parts) => normalize(parts.filter(Boolean).join('/')) }
    }
  }
}

function inspectMutation(mutate, expected) {
  const fixture = virtualContext(mutate)
  const issues = inspectWorkflowCompletionControls('', fixture.io)
  assert(issues.some(issue => issue.includes(expected)), `${expected} not reported: ${issues.join(',')}`)
  return fixture
}

inspectMutation(files => { delete files['package.json'] }, 'missing-file:package.json')
inspectMutation(files => { files['skills/compliance/workflow-completion.schema.json'] = '{' }, 'schema-json-invalid')
inspectMutation(files => {
  const value = JSON.parse(files['skills/compliance/workflow-completion.schema.json'])
  value.$id = 'wrong'
  files['skills/compliance/workflow-completion.schema.json'] = JSON.stringify(value)
}, 'schema-id-drift')
inspectMutation(files => {
  const value = JSON.parse(files['skills/compliance/workflow-completion.schema.json'])
  delete value.$defs.WorkflowCompletionCommitV1
  files['skills/compliance/workflow-completion.schema.json'] = JSON.stringify(value)
}, 'schema-definition-missing')
inspectMutation(files => { files['hooks/_runtime/workflow-completion-contract.cjs'] = files['hooks/_runtime/workflow-completion-contract.cjs'].split('createWorkflowCompletionCandidate').join('candidateFactory') }, 'owner-export-missing')
inspectMutation(files => { files['hooks/_runtime/workflow-completion-contract.cjs'] += "\nrequire('fs')\n" }, 'pure-owner-io-forbidden')
inspectMutation(files => { files['hooks/_runtime/workflow-completion-contract.cjs'] += '\nfunction evaluateWorkflowCompletion() {}\n' }, 'aggregate-owner-not-unique')
inspectMutation(files => { files['hooks/_runtime/lifecycle-workflow-completion.cjs'] = files['hooks/_runtime/lifecycle-workflow-completion.cjs'].split('reconcileWorkflowCompletion').join('reconcileCompletion') }, 'lifecycle-adapter-export-missing')
inspectMutation(files => { files['hooks/_runtime/lifecycle-workflow-completion.cjs'] = files['hooks/_runtime/lifecycle-workflow-completion.cjs'].split('completionRouteForHost').join('completionRouteByHost') }, 'lifecycle-adapter-export-missing:completionRouteForHost')
inspectMutation(files => { files['hooks/_runtime/lifecycle-workflow-completion.cjs'] = files['hooks/_runtime/lifecycle-workflow-completion.cjs'].split('recordShadowEvidenceSample').join('recordShadowSample') }, 'lifecycle-adapter-export-missing:recordShadowEvidenceSample')
inspectMutation(files => { files['hooks/_runtime/lifecycle-workflow-completion.cjs'] += '\nconst workflowComplete = true\n' }, 'lifecycle-adapter-direct-completion-forbidden')
inspectMutation(files => { files['scripts/test-host-adapters.js'] = files['scripts/test-host-adapters.js'].split('hostCompletionFixtures').join('hostCompletionSamples') }, 'host-completion-matrix-anchor-missing:hostCompletionFixtures')
inspectMutation(files => { files['README.md'] = files['README.md'].split('npm install -g devcodex').join('') }, 'completion-public-consumer-drift:README.md:PublicReadmeContractV2:README_PHRASE_MISSING:npm install -g devcodex')
inspectMutation(files => {
  files['.git'] = 'source-checkout-fixture'
  delete files['website/docs/guide/development.md']
}, 'missing-source-consumer:website/docs/guide/development.md')
{
  const packagedFixture = virtualContext(files => {
    delete files['website/docs/guide/development.md']
    delete files['website/docs/specs/compliance-framework.md']
    delete files['website/docs/specs/completion-compliance-flow.md']
  })
  const packagedIssues = inspectWorkflowCompletionControls('', packagedFixture.io)
  assert(!packagedIssues.some(issue => issue.includes('website/docs')), `packaged runtime should not require source-only website docs: ${packagedIssues.join(',')}`)
}
inspectMutation(files => { files['scripts/test-workflow-completion-contract.js'] = files['scripts/test-workflow-completion-contract.js'].split('negativeProbes.length >= 36').join('negativeProbes.length >= 35') }, 'main-test-anchor-missing')
inspectMutation(files => {
  const value = JSON.parse(files['package.json'])
  delete value.scripts['test:workflow-completion']
  files['package.json'] = JSON.stringify(value)
}, 'package-script-workflow-completion-missing')
inspectMutation(files => {
  const value = JSON.parse(files['package.json'])
  value.scripts['test:control-plane'] = 'echo no-workflow'
  files['package.json'] = JSON.stringify(value)
}, 'package-script-route-missing:test:control-plane')
inspectMutation(files => {
  const value = JSON.parse(files['package.json'])
  value.scripts['test:coverage-target'] = 'echo no-control-plane'
  files['package.json'] = JSON.stringify(value)
}, 'package-script-route-missing:test:coverage-target')
inspectMutation(files => {
  const value = JSON.parse(files['package.json'])
  value.scripts['test:critical-coverage-target'] = 'echo no-workflow'
  files['package.json'] = JSON.stringify(value)
}, 'critical-coverage-target-missing')
inspectMutation(files => {
  const value = JSON.parse(files['package.json'])
  value.files = value.files.filter(item => item !== 'scripts/test-workflow-completion-contract.js')
  files['package.json'] = JSON.stringify(value)
}, 'package-file-missing')
inspectMutation(files => {
  const value = JSON.parse(files['scripts/critical-coverage.json'])
  value.modules = value.modules.filter(item => item.path !== 'hooks/_runtime/workflow-completion-contract.cjs')
  files['scripts/critical-coverage.json'] = JSON.stringify(value)
}, 'critical-coverage-module-missing')
inspectMutation(files => {
  const value = JSON.parse(files['scripts/critical-coverage.json'])
  value.modules = value.modules.filter(item => item.path !== 'hooks/_runtime/lifecycle-workflow-completion.cjs')
  files['scripts/critical-coverage.json'] = JSON.stringify(value)
}, 'critical-coverage-module-missing:hooks/_runtime/lifecycle-workflow-completion.cjs')
inspectMutation(files => {
  const value = JSON.parse(files['scripts/critical-coverage.json'])
  value.modules.find(item => item.path === 'hooks/_runtime/workflow-completion-contract.cjs').thresholds.branches = 1
  files['scripts/critical-coverage.json'] = JSON.stringify(value)
}, 'critical-coverage-threshold-low')
inspectMutation(files => {
  const value = JSON.parse(files['scripts/validation-manifest.json'])
  value.nodes = value.nodes.filter(item => item.id !== 'workflow-completion-contract')
  files['scripts/validation-manifest.json'] = JSON.stringify(value)
}, 'validation-node-missing')
inspectMutation(files => {
  const value = JSON.parse(files['scripts/validation-manifest.json'])
  const node = value.nodes.find(item => item.id === 'workflow-completion-contract')
  node.inputs = []
  files['scripts/validation-manifest.json'] = JSON.stringify(value)
}, 'validation-node-input-missing')
inspectMutation(files => {
  const value = JSON.parse(files['scripts/validation-manifest.json'])
  const node = value.nodes.find(item => item.id === 'workflow-completion-contract')
  node.evidenceArtifacts = []
  files['scripts/validation-manifest.json'] = JSON.stringify(value)
}, 'validation-node-artifact-missing')
inspectMutation(files => {
  const value = JSON.parse(files['scripts/validation-manifest.json'])
  value.routes.fast.dynamic = false
  files['scripts/validation-manifest.json'] = JSON.stringify(value)
}, 'validation-route-fast-not-dynamic')
inspectMutation(files => { files['instructions.md'] += ['T1', 'T9'].join('~') }, 'legacy-completion-range')
inspectMutation(files => { files['instructions.md'] = files['instructions.md'].replace('| T13 | `post-delivery.self-check` |', '| T13 | `wrong` |') }, 'completion-alias-drift')

const builderFixture = virtualContext(files => { delete files['package.json'] })
const builderErrors = []
buildWorkflowCompletionControlChecks({
  ROOT: '',
  ...builderFixture.io,
  read: file => builderFixture.io.fs.readFileSync(file, 'utf8'),
  err: message => builderErrors.push(message),
  console: { log() {} }
}).checkV104()
assert(builderErrors.some(item => item.includes('[V104] missing-file:package.json')))

assert(negativeProbes.length >= 36, `expected at least 36 negative probes, got ${negativeProbes.length}`)
console.log(`workflow completion contract passed: negativeProbes=${negativeProbes.length} permutations=100 shadowPromotion=${promotion.eligibleForPromotion}`)
