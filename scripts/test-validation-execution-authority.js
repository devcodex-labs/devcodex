'use strict'

const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { sha256, stableStringify } = require('../hooks/_runtime/content-identity.cjs')
const {
  BUDGET_CONFIRMATION_SCHEMA,
  CONTINUATION_AUTHORIZATION_SCHEMA,
  LEGACY_LEASE_SCHEMA,
  LEASE_SCHEMA,
  PENDING_BUDGET_SCHEMA,
  RUN_IDENTITY_SCHEMA,
  ValidationAuthorityError,
  approvePlanFromBudgetAuthority,
  createBudgetConfirmationReceipt,
  createPendingBudgetCardBinding,
  createValidationContinuationAuthorization,
  createValidationRunIdentity,
  createVerificationExecutionLease,
  hostSessionIdentity,
  leaseBindingFromPlan,
  planBudgetProjection,
  renewVerificationExecutionLease,
  transitionValidationContinuation,
  transitionLease,
  validateBudgetConfirmationReceipt,
  validatePendingBudgetCardBinding,
  validateValidationContinuationAuthorization,
  validateVerificationExecutionLease
} = require('./lib/validation-execution-authority')
const {
  TASKLESS_RUN_SHARD_COUNT,
  createValidationEvidenceStore
} = require('./lib/validation-evidence-store')
const {
  buildRunCheckpoint,
  runManagedValidation,
  terminateOwnedTree
} = require('./lib/managed-validation-runner')
const { buildCandidateIdentity } = require('./lib/validation-dag')
const { verifyReleaseValidationReceipt } = require('./verify-release-validation-receipt')
const {
  commitTaskRecoveryState,
  resolveTaskRecoveryMetaDir
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validation-authority-'))
const activeRoot = path.join(fixtureRoot, '.devcodex', 'devcodex')
const workerPath = path.join(__dirname, 'fixtures', 'managed-validation-worker-fixture.js')
const FORMAL_TASK_ID = '00000000-0000-4000-8000-000000000343'
const FORMAL_SESSION_KEY = 'validation-task-session'

function countFiles(root) {
  let count = 0
  function visit(dir) {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else count += 1
    }
  }
  visit(root)
  return count
}

const candidate = {
  candidateId: 'validation-candidate-authority-fixture',
  stable: true,
  head: 'b'.repeat(40),
  changedSource: 'explicit',
  changedFiles: ['scripts/fixture.js']
}
const plan = {
  schemaVersion: 'ValidationPlanV3',
  planDigest: sha256('fixture-plan'),
  changedScopeDigest: sha256('fixture-scope'),
  requestDigest: sha256('fixture-request'),
  verificationLevel: 'V1',
  verificationPurpose: 'delivery',
  verificationIntent: {
    project: 'devcodex',
    taskRecoveryKey: null,
    contextEpoch: null
  },
  budgetCard: {
    schemaVersion: 'BudgetCardV1',
    digest: sha256('fixture-budget'),
    estimatedDurationMs: 30000,
    hardTimeoutUpperBoundMs: 120000,
    confirmationRequired: false,
    status: 'not-required'
  },
  routeRequested: 'changed',
  routeResolved: 'changed',
  claimCeiling: 'delivery-scope',
  selectedNodes: [{ id: 'fixture' }],
  selectedNodeCount: 1
}
const binding = leaseBindingFromPlan({ plan, candidate, project: 'devcodex', repoRoot: fixtureRoot })

function fixtureLease(overrides = {}, options = {}) {
  const leasePlan = overrides.plan || plan
  const leaseCandidate = overrides.candidate || candidate
  const actorType = overrides.actorType || 'human-cli'
  const authoritySourceRef = overrides.authoritySourceRef || 'fixture:human-cli-attestation'
  return createVerificationExecutionLease({
    actorType,
    authorityClass: overrides.authorityClass || 'scoped',
    actorIdentityEvidence: overrides.actorIdentityEvidence || { fixtureActor: actorType },
    repoRoot: overrides.repoRoot || fixtureRoot,
    plan: leasePlan,
    candidate: leaseCandidate,
    project: 'devcodex',
    taskRecoveryKey: overrides.taskRecoveryKey === undefined ? null : overrides.taskRecoveryKey,
    contextEpoch: overrides.contextEpoch === undefined ? null : overrides.contextEpoch,
    authoritySourceRef,
    sourceMessageDigest: overrides.sourceMessageDigest || null,
    policyDigest: overrides.policyDigest || null,
    revocationEpoch: overrides.revocationEpoch || 0,
    leaseWindowMs: overrides.leaseWindowMs
  }, options)
}

async function main() {
  const priorFaultMode = process.env.DEVCODEX_VALIDATION_TEST_FAULTS
  process.env.DEVCODEX_VALIDATION_TEST_FAULTS = '1'
  try {
    const lease = fixtureLease()
    assert.strictEqual(lease.schemaVersion, LEASE_SCHEMA)
    assert.strictEqual(lease.runIdentity.schemaVersion, RUN_IDENTITY_SCHEMA)
    assert.strictEqual(lease.runId, `validation-run-${lease.runIdentityDigest}`)
    assert.strictEqual(validateVerificationExecutionLease(lease, binding).valid, true)
    assert.strictEqual(validateVerificationExecutionLease(lease, { ...binding, planDigest: sha256('drift') }).valid, false)
    assert.strictEqual(validateVerificationExecutionLease(lease, { ...binding, projectRootIdentity: {
      ...binding.projectRootIdentity,
      normalizedRoot: binding.projectRootIdentity.normalizedRoot + '-drift'
    } }).valid, false)
    assert.strictEqual(validateVerificationExecutionLease(lease, { ...binding, candidateDigest: sha256('candidate-drift') }).valid, false)
    assert.strictEqual(validateVerificationExecutionLease(lease, { ...binding, candidateHead: 'c'.repeat(40) }).valid, false)
    assert.strictEqual(validateVerificationExecutionLease(lease, { ...binding, dirtyScopeDigest: sha256('dirty-drift') }).valid, false)
    assert.strictEqual(validateVerificationExecutionLease(lease, { ...binding, budgetDigest: sha256('budget-drift') }).valid, false)
    assert.strictEqual(validateVerificationExecutionLease(lease, { ...binding, actorType: 'trusted-ci' }).valid, false)
    assert.strictEqual(validateVerificationExecutionLease(lease, { ...binding, contextEpoch: 'context-drift' }).valid, false)
    assert.strictEqual(validateVerificationExecutionLease(transitionLease(lease, 'consumed'), binding).valid, false)
    assert.deepStrictEqual(
      createValidationRunIdentity({
        actorType: 'human-cli', authorityClass: 'scoped', actorIdentityEvidence: { fixtureActor: 'human-cli' },
        repoRoot: fixtureRoot, plan, candidate, project: 'devcodex', authoritySourceRef: 'fixture:human-cli-attestation'
      }),
      createValidationRunIdentity({
        actorType: 'human-cli', authorityClass: 'scoped', actorIdentityEvidence: { fixtureActor: 'human-cli' },
        repoRoot: fixtureRoot, plan, candidate, project: 'devcodex', authoritySourceRef: 'fixture:human-cli-attestation'
      })
    )
    assert.deepStrictEqual(validateVerificationExecutionLease({ schemaVersion: LEGACY_LEASE_SCHEMA }), {
      valid: false,
      errors: ['lease-v1-read-only'],
      status: 'read-only'
    })
    assert.throws(() => fixtureLease({
      plan: { ...plan, verificationLevel: 'V3', verificationPurpose: 'full-audit' },
      authorityClass: 'scoped'
    }), error => error instanceof ValidationAuthorityError)
    const approvedV3Plan = {
      ...plan,
      verificationLevel: 'V3',
      verificationPurpose: 'full-audit',
      planDigest: sha256('approved-v3-plan'),
      changedScopeDigest: sha256('approved-v3-scope'),
      requestDigest: sha256('approved-v3-request'),
      budgetCard: {
        schemaVersion: 'BudgetCardV1', digest: sha256('approved-v3-budget'), estimatedDurationMs: 60000,
        hardTimeoutUpperBoundMs: 180000, confirmationRequired: true, status: 'approved'
      }
    }
    assert.strictEqual(fixtureLease({ plan: approvedV3Plan, authorityClass: 'full-audit' }).maxLevel, 'V3')
    assert.throws(() => fixtureLease({
      plan: { ...approvedV3Plan, verificationPurpose: 'release' },
      authorityClass: 'release'
    }), error => error instanceof ValidationAuthorityError && error.details.errors.includes('lease-release-actor-invalid'))
    assert.strictEqual(fixtureLease({
      plan: { ...approvedV3Plan, verificationPurpose: 'release' },
      actorType: 'release-pipeline',
      authorityClass: 'release',
      authoritySourceRef: 'fixture:release-policy',
      policyDigest: sha256('fixture-release-policy')
    }).authorityClass, 'release')
    assert.throws(() => fixtureLease({
      actorType: 'ai-hook',
      authoritySourceRef: 'fixture:ai-hook',
      sourceMessageDigest: sha256('fixture-message')
    }), error => error instanceof ValidationAuthorityError && error.details.errors.includes('lease-ai-task-evidence-required'))

    // Keep every authority artifact on one deterministic-in-run clock while
    // avoiding a fixture that expires merely because the calendar advanced.
    const authorityNow = Date.now()
    const rootPlan = {
      ...plan,
      planDigest: sha256('continuation-root-plan'),
      changedScopeDigest: sha256('continuation-root-scope'),
      requestDigest: sha256('continuation-root-request'),
      affectedBoundaries: ['validation-authority'],
      verificationLevel: 'V2',
      verificationPurpose: 'boundary',
      verificationIntent: {
        project: 'devcodex',
        taskRecoveryKey: FORMAL_TASK_ID,
        contextEpoch: 'context-root'
      },
      selectedNodes: [{ id: 'fixture', writeScopes: [] }],
      selectedNodeCount: 1,
      budgetCard: {
        schemaVersion: 'BudgetCardV1',
        digest: sha256('continuation-root-budget'),
        estimatedDurationMs: 30000,
        hardTimeoutUpperBoundMs: 120000,
        logBudgetBytes: 1024,
        heavyNodeIds: [],
        sideEffectCategories: [],
        confirmationRequired: true,
        status: 'awaiting-confirmation'
      }
    }
    const pendingBudgetCard = createPendingBudgetCardBinding({
      plan: rootPlan,
      candidate,
      repoRoot: fixtureRoot,
      project: 'devcodex',
      taskRecoveryKey: FORMAL_TASK_ID,
      sessionKey: FORMAL_SESSION_KEY,
      contextEpoch: 'context-root'
    }, { nowMs: authorityNow })
    assert.strictEqual(pendingBudgetCard.schemaVersion, PENDING_BUDGET_SCHEMA)
    assert.strictEqual(validatePendingBudgetCardBinding(pendingBudgetCard, null, { nowMs: authorityNow }).valid, true)
    assert.strictEqual(validatePendingBudgetCardBinding(pendingBudgetCard, null, {
      nowMs: authorityNow + (25 * 60 * 60 * 1000)
    }).status, 'stale')
    const confirmationMessageDigest = sha256('confirm-current-budget-card')
    const rootConfirmation = createBudgetConfirmationReceipt({
      pendingBudgetCard,
      authorityKind: 'user-confirmation',
      sourceMessageDigest: confirmationMessageDigest,
      revocationEpoch: 0
    }, {
      nowMs: authorityNow,
      currentUserInstruction: true,
      currentSourceMessageDigest: confirmationMessageDigest
    })
    assert.strictEqual(rootConfirmation.schemaVersion, BUDGET_CONFIRMATION_SCHEMA)
    assert.strictEqual(validateBudgetConfirmationReceipt(rootConfirmation).valid, true)
    assert.strictEqual(rootConfirmation.hostSessionDigest, hostSessionIdentity(FORMAL_SESSION_KEY))
    const malformedRootConfirmation = {
      ...rootConfirmation,
      projectRootIdentity: {
        schemaVersion: 'ProjectRootIdentityV1',
        normalizedRoot: '',
        digest: sha256('forged-project-root')
      }
    }
    const malformedRootSemantic = { ...malformedRootConfirmation }
    delete malformedRootSemantic.confirmationId
    delete malformedRootSemantic.receiptDigest
    malformedRootConfirmation.receiptDigest = sha256(Buffer.from(stableStringify(malformedRootSemantic), 'utf8'))
    malformedRootConfirmation.confirmationId = `budget-confirmation-${malformedRootConfirmation.receiptDigest}`
    assert(validateBudgetConfirmationReceipt(malformedRootConfirmation).errors.includes(
      'budget-confirmation-project-root-invalid'
    ))
    const differentProjectRoot = {
      schemaVersion: 'ProjectRootIdentityV1',
      normalizedRoot: `${rootConfirmation.projectRootIdentity.normalizedRoot}/different`,
      digest: null
    }
    differentProjectRoot.digest = sha256(Buffer.from(stableStringify({
      schemaVersion: differentProjectRoot.schemaVersion,
      normalizedRoot: differentProjectRoot.normalizedRoot
    }), 'utf8'))
    assert(validateBudgetConfirmationReceipt(rootConfirmation, {
      projectRootIdentity: differentProjectRoot
    }).errors.includes('budget-confirmation-binding-mismatch:projectRootIdentity'))
    assert.throws(() => createBudgetConfirmationReceipt({
      pendingBudgetCard,
      authorityKind: 'auto',
      autoAuthorityRef: 'auto-authority:caller-string'
    }, { nowMs: authorityNow }), error => error.code === 'VALIDATION_AUTO_AUTHORITY_INVALID')

    const approvedRootPlan = approvePlanFromBudgetAuthority(rootPlan, rootConfirmation)
    const parentLease = createVerificationExecutionLease({
      actorType: 'ai-hook',
      authorityClass: 'scoped',
      actorIdentityEvidence: { fixtureActor: 'ai-hook' },
      repoRoot: fixtureRoot,
      plan: approvedRootPlan,
      candidate,
      project: 'devcodex',
      taskRecoveryKey: FORMAL_TASK_ID,
      contextEpoch: 'context-root',
      authoritySourceRef: `budget-confirmation:${rootConfirmation.receiptDigest}`,
      sourceMessageDigest: confirmationMessageDigest,
      revocationEpoch: 0
    }, { nowMs: authorityNow })
    const parentTerminal = {
      terminalStatus: 'failed',
      nativeExitCode: 1,
      failedNode: 'fixture',
      runIdentityDigest: parentLease.runIdentityDigest,
      terminalDigest: sha256('continuation-parent-terminal'),
      candidateChangedFiles: candidate.changedFiles,
      candidateChangedFilesTruncated: false
    }
    const sameScopeRetry = createValidationContinuationAuthorization({
      rootConfirmation,
      rootPlan,
      newPlan: rootPlan,
      newCandidate: candidate,
      parentRunIdentity: parentLease.runIdentity,
      parentTerminal,
      originalAuthorityRef: parentLease.authoritySourceRef,
      taskRecoveryKey: FORMAL_TASK_ID,
      project: 'devcodex',
      projectRootIdentity: rootConfirmation.projectRootIdentity,
      hostSessionDigest: rootConfirmation.hostSessionDigest,
      oldContextEpoch: 'context-root',
      newContextEpoch: 'context-root',
      continuationReceiptDigest: sha256('same-scope-context-continuation'),
      repairProofKind: 'same-scope-retry',
      retryOrdinal: 1,
      revocationEpoch: 0
    }, { nowMs: authorityNow + 500 })
    assert.strictEqual(sameScopeRetry.repairProofKind, 'same-scope-retry')
    assert.strictEqual(validateValidationContinuationAuthorization(sameScopeRetry).valid, true)
    const infrastructureTerminal = {
      ...parentTerminal,
      terminalStatus: 'blocked',
      nativeExitCode: null,
      failedNode: null,
      terminalReason: { code: 'VALIDATION_RUNNER_STATE_PERSISTENCE_FAILED' },
      terminalDigest: sha256('continuation-infrastructure-terminal')
    }
    const infrastructureRetry = createValidationContinuationAuthorization({
      rootConfirmation,
      rootPlan,
      newPlan: rootPlan,
      newCandidate: candidate,
      parentRunIdentity: parentLease.runIdentity,
      parentTerminal: infrastructureTerminal,
      originalAuthorityRef: parentLease.authoritySourceRef,
      taskRecoveryKey: FORMAL_TASK_ID,
      project: 'devcodex',
      projectRootIdentity: rootConfirmation.projectRootIdentity,
      hostSessionDigest: rootConfirmation.hostSessionDigest,
      oldContextEpoch: 'context-root',
      newContextEpoch: 'context-root',
      continuationReceiptDigest: sha256('infrastructure-context-continuation'),
      repairProofKind: 'same-scope-retry',
      retryOrdinal: 1,
      revocationEpoch: 0
    }, { nowMs: authorityNow + 600 })
    assert.strictEqual(infrastructureRetry.failedNodeId, 'VALIDATION_RUNNER_STATE_PERSISTENCE_FAILED')
    assert.strictEqual(validateValidationContinuationAuthorization(infrastructureRetry).valid, true)
    assert.throws(() => createValidationContinuationAuthorization({
      rootConfirmation,
      rootPlan,
      newPlan: rootPlan,
      newCandidate: { ...candidate, changedFiles: [...candidate.changedFiles, 'unrelated/new-file.js'] },
      parentRunIdentity: parentLease.runIdentity,
      parentTerminal,
      originalAuthorityRef: parentLease.authoritySourceRef,
      taskRecoveryKey: FORMAL_TASK_ID,
      project: 'devcodex',
      projectRootIdentity: rootConfirmation.projectRootIdentity,
      hostSessionDigest: rootConfirmation.hostSessionDigest,
      oldContextEpoch: 'context-root',
      newContextEpoch: 'context-root',
      continuationReceiptDigest: sha256('same-scope-negative-context'),
      repairProofKind: 'same-scope-retry',
      retryOrdinal: 1,
      revocationEpoch: 0
    }), error => error instanceof ValidationAuthorityError && error.code === 'VALIDATION_CONTINUATION_FOOTPRINT_UNPROVEN')
    const childPlan = {
      ...rootPlan,
      planDigest: sha256('continuation-child-plan'),
      changedScopeDigest: sha256('continuation-child-scope'),
      requestDigest: sha256('continuation-child-request'),
      selectedNodes: [
        { id: 'fixture', writeScopes: [] },
        { id: 'derived-consumer', writeScopes: [] }
      ],
      selectedNodeCount: 2,
      budgetCard: {
        ...rootPlan.budgetCard,
        digest: sha256('continuation-child-budget'),
        estimatedDurationMs: 31000,
        status: 'awaiting-confirmation'
      }
    }
    const contextContinuationReceiptDigest = sha256('context-continuation-receipt')
    const continuation = createValidationContinuationAuthorization({
      rootConfirmation,
      rootPlan,
      newPlan: childPlan,
      parentRunIdentity: parentLease.runIdentity,
      parentTerminal,
      originalAuthorityRef: parentLease.authoritySourceRef,
      taskRecoveryKey: FORMAL_TASK_ID,
      project: 'devcodex',
      projectRootIdentity: rootConfirmation.projectRootIdentity,
      hostSessionDigest: rootConfirmation.hostSessionDigest,
      oldContextEpoch: 'context-root',
      newContextEpoch: 'context-root',
      continuationReceiptDigest: contextContinuationReceiptDigest,
      repairMutationFootprintDigest: sha256('repair-footprint'),
      repairObservationReceiptDigest: sha256('repair-observation'),
      repairFootprintProven: true,
      allowedAddedNodeIds: ['derived-consumer'],
      addedConsumerEdgeTypes: ['qualificationConsumer'],
      unrelatedDirtyFiles: [],
      retryOrdinal: 1,
      revocationEpoch: 0
    }, { nowMs: authorityNow + 1000 })
    assert.strictEqual(continuation.schemaVersion, CONTINUATION_AUTHORIZATION_SCHEMA)
    assert.strictEqual(continuation.repairProofKind, 'mutation-observation')
    assert.strictEqual(validateValidationContinuationAuthorization(continuation).valid, true)
    assert.strictEqual(transitionValidationContinuation(continuation, 'leased').continuationDigest, continuation.continuationDigest)
    const approvedChildPlan = approvePlanFromBudgetAuthority(childPlan, continuation)
    const childLease = createVerificationExecutionLease({
      actorType: 'ai-hook',
      authorityClass: 'scoped',
      actorIdentityEvidence: { fixtureActor: 'ai-hook' },
      repoRoot: fixtureRoot,
      plan: approvedChildPlan,
      candidate,
      project: 'devcodex',
      taskRecoveryKey: FORMAL_TASK_ID,
      contextEpoch: 'context-root',
      authoritySourceRef: `validation-continuation:${continuation.continuationDigest}`,
      sourceMessageDigest: confirmationMessageDigest,
      revocationEpoch: 0
    }, { nowMs: authorityNow + 1000 })
    assert.strictEqual(childLease.budgetDigest, childPlan.budgetCard.digest)
    assert.throws(() => createValidationContinuationAuthorization({
      rootConfirmation,
      rootPlan,
      newPlan: { ...childPlan, verificationLevel: 'V3', verificationPurpose: 'full-audit' },
      parentRunIdentity: parentLease.runIdentity,
      parentTerminal,
      originalAuthorityRef: parentLease.authoritySourceRef,
      taskRecoveryKey: FORMAL_TASK_ID,
      project: 'devcodex',
      projectRootIdentity: rootConfirmation.projectRootIdentity,
      hostSessionDigest: rootConfirmation.hostSessionDigest,
      continuationReceiptDigest: contextContinuationReceiptDigest,
      repairMutationFootprintDigest: sha256('repair-footprint'),
      repairObservationReceiptDigest: sha256('repair-observation'),
      repairFootprintProven: true,
      allowedAddedNodeIds: ['derived-consumer'],
      retryOrdinal: 1,
      revocationEpoch: 0
    }), error => error.code === 'VALIDATION_CONTINUATION_SCOPE_WIDENED')
    assert.throws(() => createValidationContinuationAuthorization({
      rootConfirmation,
      rootPlan,
      newPlan: childPlan,
      parentRunIdentity: parentLease.runIdentity,
      parentTerminal,
      originalAuthorityRef: parentLease.authoritySourceRef,
      taskRecoveryKey: FORMAL_TASK_ID,
      project: 'devcodex',
      projectRootIdentity: rootConfirmation.projectRootIdentity,
      hostSessionDigest: rootConfirmation.hostSessionDigest,
      continuationReceiptDigest: contextContinuationReceiptDigest,
      repairMutationFootprintDigest: sha256('repair-footprint'),
      repairObservationReceiptDigest: sha256('repair-observation'),
      repairFootprintProven: false,
      allowedAddedNodeIds: ['derived-consumer'],
      retryOrdinal: 1,
      revocationEpoch: 0
    }), error => error.code === 'VALIDATION_CONTINUATION_FOOTPRINT_UNPROVEN')
    assert.throws(() => createValidationContinuationAuthorization({
      rootConfirmation,
      rootPlan,
      newPlan: childPlan,
      parentRunIdentity: parentLease.runIdentity,
      parentTerminal,
      originalAuthorityRef: parentLease.authoritySourceRef,
      taskRecoveryKey: FORMAL_TASK_ID,
      project: 'devcodex',
      projectRootIdentity: rootConfirmation.projectRootIdentity,
      hostSessionDigest: rootConfirmation.hostSessionDigest,
      continuationReceiptDigest: contextContinuationReceiptDigest,
      repairMutationFootprintDigest: sha256('repair-footprint'),
      repairObservationReceiptDigest: sha256('repair-observation'),
      repairFootprintProven: true,
      allowedAddedNodeIds: ['derived-consumer'],
      retryOrdinal: 3,
      revocationEpoch: 0
    }), error => error.code === 'VALIDATION_CONTINUATION_RETRY_EXHAUSTED')

    const longPlan = {
      ...plan,
      planDigest: sha256('long-plan'),
      changedScopeDigest: sha256('long-scope'),
      requestDigest: sha256('long-request'),
      budgetCard: {
        schemaVersion: 'BudgetCardV1', digest: sha256('long-budget'), estimatedDurationMs: 1200000,
        hardTimeoutUpperBoundMs: 1800000, confirmationRequired: true, status: 'approved'
      }
    }
    const baseNow = Date.parse('2026-08-25T00:00:00.000Z')
    const longLease = fixtureLease({ plan: longPlan }, { nowMs: baseNow })
    assert(Date.parse(longLease.expiresAt) - Date.parse(longLease.issuedAt) > 15 * 60 * 1000,
      'budget-derived lease window must not silently retain the old fixed 15 minute TTL')
    const renewed = renewVerificationExecutionLease(longLease, { nowMs: baseNow + 1000 })
    assert.strictEqual(renewed.hardDeadlineAt, longLease.hardDeadlineAt)
    assert.strictEqual(renewed.runIdentityDigest, longLease.runIdentityDigest)
    assert(Date.parse(renewed.expiresAt) <= Date.parse(renewed.hardDeadlineAt))
    assert.strictEqual(renewed.leaseGeneration, 1)
    const reduced = renewVerificationExecutionLease(lease, { maxLevel: 'V0' })
    assert.strictEqual(reduced.maxLevel, 'V0')
    assert.throws(() => renewVerificationExecutionLease(reduced, { maxLevel: 'V1' }), error =>
      error instanceof ValidationAuthorityError && error.code === 'VALIDATION_LEASE_SCOPE_WIDENING_DENIED')
    assert.throws(() => renewVerificationExecutionLease(longLease, {
      nowMs: Date.parse(longLease.hardDeadlineAt)
    }), error => error instanceof ValidationAuthorityError && error.code === 'VALIDATION_LEASE_RENEWAL_DENIED')

    const nodeStarts = []
    const heartbeats = []
    const completed = await runManagedValidation({
      manifest: {},
      plan,
      candidate,
      repoRoot: fixtureRoot,
      activeRoot,
      lease,
      actorType: 'human-cli',
      project: 'devcodex',
      workerPath,
      pollIntervalMs: 100,
      heartbeatIntervalMs: 25,
      onNodeStart: node => nodeStarts.push(node),
      onHeartbeat: heartbeat => heartbeats.push(heartbeat)
    })
    assert.strictEqual(completed.receipt.terminalStatus, 'completed', JSON.stringify(completed))
    assert.strictEqual(completed.receipt.nativeExitCode, 0)
    assert.strictEqual(completed.persistence.status, 'persisted')
    assert.strictEqual(completed.persistence.stateOwner, 'taskless-run-fixed-shard')
    assert.deepStrictEqual(nodeStarts.map(node => node.nodeId), ['fixture'])
    assert(heartbeats.some(item => item.schemaVersion === 'ValidationRunHeartbeatV1' && item.totalNodeCount === 1))

    const driftAwareRepo = path.join(fixtureRoot, 'candidate-reconciliation-repo')
    fs.mkdirSync(driftAwareRepo, { recursive: true })
    fs.writeFileSync(path.join(driftAwareRepo, 'tracked.js'), 'module.exports = 1\n')
    for (const args of [
      ['init', '--quiet'],
      ['config', 'core.autocrlf', 'false'],
      ['config', 'user.email', 'devcodex-fixture@example.invalid'],
      ['config', 'user.name', 'DevCodex Fixture'],
      ['add', 'tracked.js'],
      ['commit', '--quiet', '-m', 'fixture']
    ]) execFileSync('git', args, { cwd: driftAwareRepo, stdio: 'ignore', windowsHide: true })
    const driftAwareCandidate = buildCandidateIdentity({ repoRoot: driftAwareRepo })
    const driftAwarePlan = {
      ...plan,
      candidateId: driftAwareCandidate.candidateId,
      planDigest: sha256('drift-aware-plan'),
      changedScopeDigest: sha256('drift-aware-scope'),
      requestDigest: sha256('drift-aware-request'),
      budgetCard: { ...plan.budgetCard, digest: sha256('drift-aware-budget') }
    }
    const driftAwareLease = fixtureLease({
      plan: driftAwarePlan,
      candidate: driftAwareCandidate,
      repoRoot: driftAwareRepo
    })
    const driftBlocked = await runManagedValidation({
      manifest: {}, plan: driftAwarePlan, candidate: driftAwareCandidate,
      repoRoot: driftAwareRepo, activeRoot, lease: driftAwareLease,
      actorType: 'human-cli', project: 'devcodex', workerPath,
      pollIntervalMs: 100,
      onNode: () => fs.writeFileSync(path.join(driftAwareRepo, 'tracked.js'), 'module.exports = 2\n')
    })
    assert.strictEqual(driftBlocked.receipt.terminalStatus, 'blocked')
    assert.strictEqual(driftBlocked.receipt.nativeExitCode, 2)
    assert.strictEqual(driftBlocked.receipt.claimCeiling, 'non-qualifying')
    assert.strictEqual(
      driftBlocked.receipt.terminalReason.code,
      'VALIDATION_CANDIDATE_DRIFT_DURING_EXECUTION'
    )
    assert.strictEqual(driftBlocked.receipt.terminalReason.expected.candidateId, driftAwareCandidate.candidateId)
    assert.notStrictEqual(
      driftBlocked.receipt.terminalReason.observed.candidateId,
      driftAwareCandidate.candidateId
    )

    const cancelCandidate = { ...candidate, candidateId: 'validation-candidate-cancel-fixture', cancelProbe: true }
    const cancelPlan = {
      ...plan,
      planDigest: sha256('cancel-plan'),
      changedScopeDigest: sha256('cancel-scope'),
      requestDigest: sha256('cancel-request')
    }
    const cancelLease = fixtureLease({ plan: cancelPlan, candidate: cancelCandidate })
    const cancelPromise = runManagedValidation({
      manifest: {},
      plan: cancelPlan,
      candidate: cancelCandidate,
      repoRoot: fixtureRoot,
      activeRoot,
      lease: cancelLease,
      actorType: 'human-cli',
      project: 'devcodex',
      workerPath,
      pollIntervalMs: 100
    })
    setTimeout(() => {
      createValidationEvidenceStore({
        activeRoot,
        project: 'devcodex',
        actorType: 'human-cli'
      }).writeLease(transitionLease(cancelLease, 'revoked'))
    }, 150)
    const cancelled = await cancelPromise
    assert.strictEqual(cancelled.receipt.terminalStatus, 'cancelled')
    assert.strictEqual(cancelled.receipt.claimCeiling, 'non-qualifying')
    assert.strictEqual(cancelled.receipt.nativeExitCode, 130)
    assert.strictEqual(cancelled.persistence.status, 'persisted')

    async function runFault(label, fault, options = {}) {
      const faultCandidate = {
        ...candidate,
        candidateId: `validation-candidate-fault-${label}`,
        runnerFault: fault
      }
      const faultPlan = {
        ...plan,
        planDigest: sha256(`fault-plan-${label}`),
        changedScopeDigest: sha256(`fault-scope-${label}`),
        requestDigest: sha256(`fault-request-${label}`),
        budgetCard: { ...plan.budgetCard, digest: sha256(`fault-budget-${label}`) }
      }
      const faultLease = fixtureLease({ plan: faultPlan, candidate: faultCandidate })
      const result = await runManagedValidation({
        manifest: {}, plan: faultPlan, candidate: faultCandidate,
        repoRoot: fixtureRoot, activeRoot, lease: faultLease,
        actorType: 'human-cli', project: 'devcodex', workerPath,
        pollIntervalMs: 50, finalIpcGraceMs: 50,
        ...options
      })
      const observed = createValidationEvidenceStore({
        activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: faultLease.runIdentity
      }).readTerminal()
      assert.strictEqual(observed.status, 'fresh', `${label}: ${JSON.stringify(observed)}`)
      assert.strictEqual(observed.receipt.runIdentityDigest, faultLease.runIdentityDigest)
      assert.strictEqual(observed.receipt.terminalDigest, result.persistence.terminalDigest || observed.receipt.terminalDigest)
      return result
    }

    const restarted = await runFault('restart', 'restart')
    assert.strictEqual(restarted.receipt.terminalStatus, 'completed', JSON.stringify(restarted))
    assert.strictEqual(restarted.runner.restarts.length, 1)
    const checkpointRestarted = await runFault('checkpoint-restart', 'checkpoint-restart')
    assert.strictEqual(checkpointRestarted.receipt.terminalStatus, 'completed', JSON.stringify(checkpointRestarted))
    assert.strictEqual(checkpointRestarted.receipt.resumedNodeCount, 1)
    assert.deepStrictEqual(checkpointRestarted.receipt.resumedNodeIds, ['fixture'])
    assert.strictEqual(checkpointRestarted.runner.restarts.length, 1)
    assert.strictEqual((await runFault('crash', 'crash', { maxWorkerAttempts: 2 })).receipt.terminalStatus, 'abandoned')
    assert.strictEqual((await runFault('ipc-exit', 'ipc-exit', { maxWorkerAttempts: 1 })).receipt.terminalStatus, 'abandoned')
    const missingWorker = await runFault('spawn', null, {
      maxWorkerAttempts: 1,
      workerPath: path.join(fixtureRoot, 'missing-worker.js')
    })
    assert.strictEqual(missingWorker.receipt.terminalStatus, 'blocked')
    assert.strictEqual(missingWorker.receipt.terminalReason.code, 'VALIDATION_WORKER_ENTRY_UNAVAILABLE')
    assert.strictEqual((await runFault('protocol', 'protocol', { maxWorkerAttempts: 1 })).receipt.terminalStatus, 'blocked')
    const hung = await runFault('hang', 'hang', { maxWorkerAttempts: 1, runnerHardTimeoutMs: 250 })
    assert.strictEqual(hung.receipt.terminalStatus, 'cancelled')
    assert.strictEqual(hung.receipt.nativeExitCode, 124)
    assert.strictEqual((await runFault('worker-error', 'error', { maxWorkerAttempts: 1 })).receipt.terminalStatus, 'failed')
    assert.strictEqual((await runFault('ipc-budget', 'ipc-budget', { maxWorkerAttempts: 1 })).receipt.terminalStatus, 'blocked')
    const sendFailure = await runFault('send', null, {
      maxWorkerAttempts: 1,
      workerFaultMode: 'disconnect-before-command'
    })
    assert.strictEqual(sendFailure.receipt.terminalStatus, 'blocked')
    assert.strictEqual(sendFailure.receipt.terminalReason.code, 'VALIDATION_WORKER_SEND_FAILED')
    const terminalRecovery = await runFault('terminal-persistence', null, {
      maxWorkerAttempts: 1,
      __testEvidenceFaults: { primaryTerminalWrites: 1 }
    })
    assert.strictEqual(terminalRecovery.receipt.terminalStatus, 'completed')
    assert.strictEqual(terminalRecovery.persistence.reconciliation, 'reserve-to-primary')
    const reservePending = await runFault('terminal-reserve-pending', null, {
      maxWorkerAttempts: 1,
      __testEvidenceFaults: { primaryTerminalWrites: 2 }
    })
    assert.strictEqual(reservePending.persistence.status, 'closeout-reserved')
    const reserveRecoveryStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'human-cli',
      runIdentity: reservePending.receipt.runIdentity
    })
    assert.strictEqual(reserveRecoveryStore.readTerminal().replicaState, 'reserve-only')
    const promotedTerminal = reserveRecoveryStore.writeTerminal(reservePending.receipt)
    assert.strictEqual(promotedTerminal.reconciliation, 'reserve-to-primary')
    assert.strictEqual(reserveRecoveryStore.readTerminal().replicaState, 'primary+reserve')
    const compactProjection = createValidationEvidenceStore({
      activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: lease.runIdentity
    }).buildTerminalProjection({
      ...completed.receipt,
      failedNode: 'fixture-failure',
      failedNodes: ['fixture-failure', 'fixture-second-failure'],
      abortedNodes: ['fixture-dependent'],
      abortedNodeReasons: {
        'fixture-dependent': { code: 'VALIDATION_DEPENDENCY_FAILED', failedDependencies: ['fixture-failure'] }
      },
      results: [
        {
          nodeId: 'fixture-failure',
          status: 'failed',
          exitCode: 17,
          errorCode: 'FIXTURE_FAILURE',
          durationMs: 42,
          stdout: 'bounded stdout evidence',
          stderr: 'bounded stderr evidence'
        },
        {
          nodeId: 'fixture-second-failure',
          status: 'failed',
          exitCode: 19,
          errorCode: 'FIXTURE_SECOND_FAILURE',
          durationMs: 21,
          stdout: '',
          stderr: 'second failure'
        }
      ],
      terminalReason: { code: 'LARGE-REASON', detail: 'r'.repeat(200000) },
      runner: {
        ...completed.runner,
        stdout: { text: 'o'.repeat(300000), bytes: 300000, retainedBytes: 300000, truncated: false, digest: sha256('stdout') },
        stderr: { text: 'e'.repeat(300000), bytes: 300000, retainedBytes: 300000, truncated: false, digest: sha256('stderr') }
      }
    })
    assert(Buffer.byteLength(JSON.stringify(compactProjection), 'utf8') < 64 * 1024,
      'stable terminal projection must remain writable to the 64 KiB closeout payload')
    assert.strictEqual(compactProjection.failureSummary.schemaVersion, 'ValidationFailureSummaryV1')
    assert.strictEqual(compactProjection.failureSummary.nodeId, 'fixture-failure')
    assert.strictEqual(compactProjection.failureSummary.exitCode, 17)
    assert.strictEqual(compactProjection.failureSummary.stderr.preview, 'bounded stderr evidence')
    assert.deepStrictEqual(compactProjection.failedNodes, ['fixture-failure', 'fixture-second-failure'])
    assert.strictEqual(compactProjection.failedNodeCount, 2)
    assert.strictEqual(compactProjection.failedNodesTruncated, false)
    assert.deepStrictEqual(compactProjection.failureSummaries.map(item => item.nodeId),
      ['fixture-failure', 'fixture-second-failure'])
    assert.strictEqual(compactProjection.abortedNodeReasons['fixture-dependent'].code,
      'VALIDATION_DEPENDENCY_FAILED')
    assert.strictEqual((await terminateOwnedTree({ pid: process.pid }, {
      runIdentityDigest: lease.runIdentityDigest
    })).status, 'denied', 'process cleanup without an exact ownership receipt must never signal a process')

    const restartCandidate = { ...candidate, candidateId: 'validation-candidate-host-restart' }
    const restartPlan = {
      ...plan,
      planDigest: sha256('host-restart-plan'),
      changedScopeDigest: sha256('host-restart-scope'),
      requestDigest: sha256('host-restart-request'),
      budgetCard: { ...plan.budgetCard, digest: sha256('host-restart-budget') }
    }
    const restartLease = fixtureLease({ plan: restartPlan, candidate: restartCandidate })
    const restartStore = createValidationEvidenceStore({
      activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: restartLease.runIdentity
    })
    const staleRunnerCore = {
      schemaVersion: 'ManagedValidationRunnerStateV2',
      runId: restartLease.runId,
      runIdentityDigest: restartLease.runIdentityDigest,
      phase: 'starting',
      attempt: 0,
      maxAttempts: 2,
      runnerPid: 2147483646,
      workerPid: null,
      processOwnership: null,
      leaseDigest: restartLease.authorityDigest,
      hardDeadlineAt: restartLease.hardDeadlineAt,
      startedAt: restartLease.issuedAt,
      updatedAt: restartLease.issuedAt,
      terminalDigest: null,
      lastEvent: 'fixture-host-crash'
    }
    const staleRunnerState = {
      ...staleRunnerCore,
      stateDigest: sha256(Buffer.from(stableStringify(staleRunnerCore), 'utf8'))
    }
    assert.strictEqual(restartStore.writeRunnerState(staleRunnerState).status, 'persisted')
    const reconciled = await runManagedValidation({
      manifest: {}, plan: restartPlan, candidate: restartCandidate,
      repoRoot: fixtureRoot, activeRoot, lease: restartLease,
      actorType: 'human-cli', project: 'devcodex', workerPath, pollIntervalMs: 50
    })
    assert.strictEqual(reconciled.receipt.terminalStatus, 'abandoned')
    assert.strictEqual(reconciled.reconciled, true)

    const checkpointCandidate = { ...candidate, candidateId: 'validation-candidate-host-checkpoint-resume' }
    const checkpointPlan = {
      ...plan,
      planDigest: sha256('host-checkpoint-plan'),
      changedScopeDigest: sha256('host-checkpoint-scope'),
      requestDigest: sha256('host-checkpoint-request'),
      budgetCard: { ...plan.budgetCard, digest: sha256('host-checkpoint-budget') }
    }
    const checkpointLease = fixtureLease({ plan: checkpointPlan, candidate: checkpointCandidate })
    const checkpointStore = createValidationEvidenceStore({
      activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: checkpointLease.runIdentity
    })
    const hostCheckpoint = buildRunCheckpoint({
      lease: checkpointLease,
      plan: checkpointPlan,
      candidate: checkpointCandidate,
      manifest: {},
      results: [{ nodeId: 'fixture', status: 'passed', exitCode: 0, nodeReceiptDigest: 'a'.repeat(64) }],
      now: checkpointLease.issuedAt
    })
    const checkpointRunnerCore = {
      ...staleRunnerCore,
      runId: checkpointLease.runId,
      runIdentityDigest: checkpointLease.runIdentityDigest,
      leaseDigest: checkpointLease.authorityDigest,
      hardDeadlineAt: checkpointLease.hardDeadlineAt,
      startedAt: checkpointLease.issuedAt,
      updatedAt: checkpointLease.issuedAt,
      lastEvent: 'fixture-host-crash-after-node',
      checkpoint: hostCheckpoint
    }
    const checkpointRunnerState = {
      ...checkpointRunnerCore,
      stateDigest: sha256(Buffer.from(stableStringify(checkpointRunnerCore), 'utf8'))
    }
    assert.strictEqual(checkpointStore.writeRunnerState(checkpointRunnerState).status, 'persisted')
    const resumedHostRun = await runManagedValidation({
      manifest: {}, plan: checkpointPlan, candidate: checkpointCandidate,
      repoRoot: fixtureRoot, activeRoot, lease: checkpointLease,
      actorType: 'human-cli', project: 'devcodex', workerPath, pollIntervalMs: 50
    })
    assert.strictEqual(resumedHostRun.receipt.terminalStatus, 'completed', JSON.stringify(resumedHostRun))
    assert.strictEqual(resumedHostRun.receipt.resumedNodeCount, 1)
    assert.strictEqual(resumedHostRun.runner.recoveries[0].kind, 'dead-host-exact-checkpoint')

    function runFixture(index, extra = {}) {
      const runCandidate = {
        ...candidate,
        candidateId: `validation-candidate-run-${index}`,
        ...(extra.candidate || {})
      }
      const runPlan = {
        ...plan,
        planDigest: sha256(`run-plan-${index}`),
        changedScopeDigest: sha256(`run-scope-${index}`),
        requestDigest: sha256(`run-request-${index}`),
        budgetCard: { ...plan.budgetCard, digest: sha256(`run-budget-${index}`) },
        ...(extra.plan || {})
      }
      const runLease = fixtureLease({ plan: runPlan, candidate: runCandidate, ...(extra.lease || {}) })
      const runReceipt = {
        ...completed.receipt,
        runId: runLease.runId,
        runIdentity: runLease.runIdentity,
        runIdentityDigest: runLease.runIdentityDigest,
        receiptId: `validation-receipt-run-${index}`,
        candidateId: runCandidate.candidateId,
        candidateIdentity: runCandidate,
        testRouteDigest: runPlan.planDigest,
        budgetCard: runPlan.budgetCard,
        requestDigest: runPlan.requestDigest,
        authorityDigest: runLease.authorityDigest,
        authorityActorType: runLease.actorType,
        authorityClass: runLease.authorityClass,
        completedAt: new Date().toISOString()
      }
      return { candidate: runCandidate, plan: runPlan, lease: runLease, receipt: runReceipt }
    }

    const concurrentByShard = new Map()
    let concurrentPair = null
    for (let index = 0; index < 1000 && !concurrentPair; index += 1) {
      const current = runFixture(`concurrent-${index}`)
      const shard = Number.parseInt(current.lease.runIdentityDigest.slice(0, 8), 16) % TASKLESS_RUN_SHARD_COUNT
      if (concurrentByShard.has(shard)) concurrentPair = [concurrentByShard.get(shard), current]
      else concurrentByShard.set(shard, current)
    }
    assert(concurrentPair, 'fixture must find two distinct same-actor runs in one fixed shard')
    const [concurrentA, concurrentB] = concurrentPair
    const concurrentResults = await Promise.all([concurrentA, concurrentB].map(current => runManagedValidation({
      manifest: {}, plan: current.plan, candidate: current.candidate,
      repoRoot: fixtureRoot, activeRoot, lease: current.lease,
      actorType: 'human-cli', project: 'devcodex', workerPath,
      pollIntervalMs: 50
    })))
    assert(concurrentResults.every(result => result.receipt.terminalStatus === 'completed'),
      JSON.stringify(concurrentResults.map(result => result.receipt.terminalStatus)))
    for (const current of [concurrentA, concurrentB]) {
      const observed = createValidationEvidenceStore({
        activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: current.lease.runIdentity
      }).readTerminal()
      assert.strictEqual(observed.status, 'fresh')
      assert.strictEqual(observed.receipt.runIdentityDigest, current.lease.runIdentityDigest)
    }

    const firstRun = runFixture('same-actor-a')
    const secondRun = runFixture('same-actor-b')
    const firstStore = createValidationEvidenceStore({
      activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: firstRun.lease.runIdentity
    })
    const secondStore = createValidationEvidenceStore({
      activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: secondRun.lease.runIdentity
    })
    assert.strictEqual(firstStore.writeTerminal(firstRun.receipt).status, 'persisted')
    assert.strictEqual(secondStore.writeTerminal(secondRun.receipt).status, 'persisted')
    assert.strictEqual(firstStore.readTerminal().receipt.runIdentityDigest, firstRun.lease.runIdentityDigest)
    assert.strictEqual(secondStore.readTerminal().receipt.runIdentityDigest, secondRun.lease.runIdentityDigest)
    assert.strictEqual(firstStore.writeTerminal(firstRun.receipt).status, 'semantic-noop')
    assert.strictEqual(firstStore.writeTerminal({ ...firstRun.receipt, receiptId: 'conflicting-terminal' }).errorCode,
      'VALIDATION_TERMINAL_CONFLICT')

    const shardWrites = new Map()
    const terminalSlots = new Set()
    let cardinalityIndex = 0
    while ([...shardWrites.values()].some(count => count < 2) || shardWrites.size < TASKLESS_RUN_SHARD_COUNT) {
      const current = runFixture(`cardinality-${cardinalityIndex++}`)
      const shard = Number.parseInt(current.lease.runIdentityDigest.slice(0, 8), 16) % TASKLESS_RUN_SHARD_COUNT
      if ((shardWrites.get(shard) || 0) >= 2) continue
      const store = createValidationEvidenceStore({
        activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: current.lease.runIdentity
      })
      const write = store.writeTerminal(current.receipt)
      assert.strictEqual(write.status, 'persisted', JSON.stringify(write))
      terminalSlots.add(write.slot)
      shardWrites.set(shard, (shardWrites.get(shard) || 0) + 1)
      assert(cardinalityIndex < 10000, 'fixture must cover all fixed shards without unbounded search')
    }
    assert.strictEqual(shardWrites.size, TASKLESS_RUN_SHARD_COUNT)
    assert.strictEqual(terminalSlots.size, TASKLESS_RUN_SHARD_COUNT * 2)
    const saturatedFileCount = countFiles(activeRoot)
    for (let index = 0; index < 1000; index += 1) {
      const current = runFixture(`bounded-${index}`)
      const store = createValidationEvidenceStore({
        activeRoot, project: 'devcodex', actorType: 'human-cli', runIdentity: current.lease.runIdentity
      })
      assert.strictEqual(store.writeTerminal(current.receipt).status, 'persisted')
    }
    assert.strictEqual(countFiles(activeRoot), saturatedFileCount,
      'taskless run-keyed persistence must reuse fixed shard files instead of creating per-run files')

    const releaseCandidate = {
      ...candidate,
      candidateId: 'validation-candidate-release-fixture',
      stable: true
    }
    const releasePlan = {
      ...approvedV3Plan,
      verificationPurpose: 'release',
      routeResolved: 'full',
      planDigest: sha256('release-plan'),
      changedScopeDigest: sha256('release-scope'),
      requestDigest: sha256('release-request'),
      budgetCard: { ...approvedV3Plan.budgetCard, digest: sha256('release-budget') }
    }
    const releaseLease = fixtureLease({
      plan: releasePlan,
      candidate: releaseCandidate,
      actorType: 'release-pipeline',
      authorityClass: 'release',
      authoritySourceRef: 'fixture:release-policy',
      policyDigest: sha256('fixture-release-policy')
    })
    const releaseStore = createValidationEvidenceStore({
      activeRoot, project: 'devcodex', actorType: 'release-pipeline', runIdentity: releaseLease.runIdentity
    })
    const completedAt = new Date().toISOString()
    const releaseWrite = releaseStore.writeTerminal({
      ...completed.receipt,
      receiptId: 'validation-release-receipt-fixture',
      runId: releaseLease.runId,
      runIdentity: releaseLease.runIdentity,
      runIdentityDigest: releaseLease.runIdentityDigest,
      candidateId: releaseCandidate.candidateId,
      candidateIdentity: releaseCandidate,
      testRouteDigest: releasePlan.planDigest,
      budgetCard: releasePlan.budgetCard,
      requestDigest: releasePlan.requestDigest,
      authorityDigest: releaseLease.authorityDigest,
      authorityActorType: 'release-pipeline',
      authorityClass: 'release',
      verificationLevel: 'V3',
      verificationPurpose: 'release',
      routeResolved: 'full',
      terminalStatus: 'completed',
      completedAt,
      nativeExitCode: 0
    })
    assert.strictEqual(releaseWrite.status, 'persisted')
    const releaseVerification = verifyReleaseValidationReceipt({
      repoRoot: fixtureRoot,
      activeRoot,
      candidate: releaseCandidate,
      nowMs: Date.parse(completedAt) + 1000
    })
    assert.strictEqual(releaseVerification.valid, true, JSON.stringify(releaseVerification.errors))
    const driftedReleaseVerification = verifyReleaseValidationReceipt({
      repoRoot: fixtureRoot,
      activeRoot,
      candidate: { ...releaseCandidate, candidateId: 'drifted-candidate' },
      nowMs: Date.parse(completedAt) + 1000
    })
    assert.strictEqual(driftedReleaseVerification.valid, false)
    assert(driftedReleaseVerification.errors.includes('release-candidate-id-mismatch'))
    assert(!driftedReleaseVerification.errors.includes('release-candidate-head-mismatch'))

    const taskIdentity = {
      activeRoot,
      project: 'devcodex',
      taskId: FORMAL_TASK_ID,
      taskStatus: 'active'
    }
    const taskSessionKey = FORMAL_SESSION_KEY
    const taskSeed = commitTaskRecoveryState({
      metaDir: resolveTaskRecoveryMetaDir({ activeRoot, project: 'devcodex' }),
      identity: taskIdentity,
      sessionKey: taskSessionKey,
      state: { phase: 'validation-authority-fixture' }
    })
    assert.strictEqual(taskSeed.status, 'committed', JSON.stringify(taskSeed))
    assert.throws(() => createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity,
      taskRecoveryKey: '00000000-0000-4000-8000-000000000999',
      sessionKey: taskSessionKey
    }), error => error.code === 'VALIDATION_AI_TASK_BINDING_MISMATCH')
    assert.throws(() => createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity,
      taskRecoveryKey: taskIdentity.taskId
    }), error => error.code === 'VALIDATION_AI_TASK_EVIDENCE_REQUIRED')
    const taskStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity,
      taskRecoveryKey: taskIdentity.taskId,
      sessionKey: taskSessionKey
    })
    const pendingWrite = taskStore.writePendingBudgetCard(pendingBudgetCard)
    assert(['committed', 'semantic-noop'].includes(pendingWrite.status), JSON.stringify(pendingWrite))
    assert.strictEqual(taskStore.readPendingBudgetCard().pendingBudgetCard.bindingDigest, pendingBudgetCard.bindingDigest)
    const rootWrite = taskStore.writeRootBudgetConfirmation(rootConfirmation, {
      rootBudgetProjection: planBudgetProjection(rootPlan)
    })
    assert(['committed', 'semantic-noop'].includes(rootWrite.status), JSON.stringify(rootWrite))
    assert.strictEqual(taskStore.readPendingBudgetCard().status, 'missing')
    assert.strictEqual(taskStore.readRootBudgetConfirmation().rootBudgetConfirmation.receiptDigest, rootConfirmation.receiptDigest)
    const continuationWrite = taskStore.writeContinuationAuthorization(continuation)
    assert(['committed', 'semantic-noop'].includes(continuationWrite.status), JSON.stringify(continuationWrite))
    const childLeaseWrite = taskStore.writeLease(childLease)
    assert(['committed', 'semantic-noop'].includes(childLeaseWrite.status), JSON.stringify(childLeaseWrite))
    assert.strictEqual(taskStore.readContinuationAuthorization().continuationAuthorization.status, 'leased')
    const childTerminalWrite = taskStore.writeTerminal({
      ...completed.receipt,
      receiptId: 'validation-child-terminal-fixture',
      runId: childLease.runId,
      runIdentity: childLease.runIdentity,
      runIdentityDigest: childLease.runIdentityDigest,
      candidateId: candidate.candidateId,
      candidateIdentity: candidate,
      testRouteDigest: childPlan.planDigest,
      budgetCard: childPlan.budgetCard,
      requestDigest: childPlan.requestDigest,
      authorityDigest: childLease.authorityDigest,
      authoritySourceRef: childLease.authoritySourceRef,
      authorityActorType: childLease.actorType,
      authorityClass: childLease.authorityClass,
      verificationLevel: childPlan.verificationLevel,
      verificationPurpose: childPlan.verificationPurpose,
      routeResolved: 'boundary',
      terminalStatus: 'completed',
      nativeExitCode: 0,
      completedAt: new Date(authorityNow + 2000).toISOString()
    })
    assert(['committed', 'semantic-noop'].includes(childTerminalWrite.status), JSON.stringify(childTerminalWrite))
    assert.strictEqual(taskStore.readLease().status, 'missing')
    assert.strictEqual(taskStore.readContinuationAuthorization().continuationAuthorization.schemaVersion,
      'ValidationContinuationTerminalLineageV1')
    const firstTaskRun = runFixture('task-0')
    const firstTaskWrite = taskStore.writeTerminal(firstTaskRun.receipt)
    assert(['committed', 'semantic-noop'].includes(firstTaskWrite.status), JSON.stringify(firstTaskWrite))
    assert.strictEqual(taskStore.writeTerminal(firstTaskRun.receipt).status, 'semantic-noop')
    const secondTaskRun = runFixture('task-1')
    const secondTaskWrite = taskStore.writeTerminal(secondTaskRun.receipt)
    assert(['committed', 'semantic-noop'].includes(secondTaskWrite.status), JSON.stringify(secondTaskWrite))
    const taskFileCount = countFiles(activeRoot)
    for (let index = 2; index < 1000; index += 1) {
      const write = taskStore.writeTerminal(runFixture(`task-${index}`).receipt)
      assert(['committed', 'semantic-noop'].includes(write.status), JSON.stringify(write))
    }
    assert.strictEqual(countFiles(activeRoot), taskFileCount, '1,000 same-task terminal writes must reuse the same physical V5 files')
    process.stdout.write('test-validation-execution-authority: ok\n')
  } finally {
    if (priorFaultMode === undefined) delete process.env.DEVCODEX_VALIDATION_TEST_FAULTS
    else process.env.DEVCODEX_VALIDATION_TEST_FAULTS = priorFaultMode
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  process.stderr.write((error.stack || error.message) + '\n')
  process.exitCode = 1
})
