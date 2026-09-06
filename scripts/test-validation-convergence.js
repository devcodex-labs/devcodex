'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { sha256 } = require('../hooks/_runtime/content-identity.cjs')
const {
  clearReopenedTaskActiveAuthorities,
  commitTaskRecoveryState,
  resolveTaskRecoveryMetaDir
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  LifecycleStateProjectionV5Error,
  VALIDATION_CONVERGENCE_TERMINAL_MAX_BYTES,
  VALIDATION_REPAIR_CONVERGENCE_MAX_BYTES,
  buildColdResumeStub,
  compactValidationExecution
} = require('../hooks/_runtime/lifecycle-state-projection-v5.cjs')
const {
  buildSemanticNodeEvidenceDigest,
  planValidation,
  readValidationManifest
} = require('./lib/validation-dag')
const { createValidationEvidenceStore } = require('./lib/validation-evidence-store')
const {
  ValidationConvergenceError,
  assertFrozenCandidate,
  buildCandidateSnapshot,
  buildQualificationIdentity,
  completeRepairBatch,
  createSuccessfulQualification,
  freezeRepairBatch,
  openRepairBatch,
  qualificationReuseDecision,
  recoverQualificationFromSuccessfulTerminal,
  recoverRepairBatchFromFailedTerminal,
  reopenRepairBatchAfterFailure,
  repairDeltaBetween,
  validateRepairConvergenceState,
  validateSuccessfulQualification
} = require('./lib/validation-convergence-state')
const { resolveRepairPlanScope, resolveValidationConvergenceDecision } = require('./run-validation')

function candidate(id, entries) {
  const dirtyIdentities = Object.entries(entries).map(([file, content]) => ({
    path: file,
    digest: sha256(content)
  }))
  return {
    stable: true,
    candidateId: id,
    head: sha256(`head:${id}`).slice(0, 40),
    changedSource: 'fixture',
    changedFiles: dirtyIdentities.map(entry => entry.path),
    dirtyIdentities
  }
}

function plan(candidateId, suffix = 'base') {
  const selectedNodes = [{
    schemaVersion: 'ValidationNodeV1',
    id: 'validation-authority',
    owner: 'fixture',
    command: 'node',
    args: ['fixture.js'],
    environment: { DEVCODEX_FIXTURE: '1' },
    dependencies: [],
    inputs: ['fixture.js'],
    consumers: [],
    delegatedClosure: [],
    coversNodes: [],
    invariants: ['batch-freeze-before-affected'],
    riskClass: 'high',
    cachePolicy: 'never',
    writeScopes: ['isolated-temp'],
    timeoutMs: 1000,
    estimatedDurationMs: 500,
    exitMap: { success: [0], failure: 'nonzero-or-signal', timeout: 'ETIMEDOUT' },
    evidenceArtifacts: ['ValidationExecutionReceiptV1']
  }]
  return {
    schemaVersion: 'ValidationPlanV3',
    planDigest: sha256(`plan:${candidateId}:${suffix}`),
    manifestIdentity: { digest: sha256(`manifest:${suffix}`) },
    routeResolved: 'changed',
    verificationLevel: 'V2',
    verificationPurpose: 'affected',
    riskClass: 'high',
    affectedBoundaries: ['validation-control-plane'],
    selectedNodes,
    executionBlockers: []
  }
}

function greenTerminal(candidateValue, planValue, nowMs) {
  return {
    schemaVersion: 'ValidationTerminalProjectionV2',
    receiptId: `receipt-${sha256(String(nowMs)).slice(0, 12)}`,
    terminalDigest: sha256(`terminal:${nowMs}`),
    candidateId: candidateValue.candidateId,
    candidateHead: candidateValue.head,
    candidateChangedFiles: candidateValue.changedFiles,
    planDigest: planValue.planDigest,
    verificationLevel: planValue.verificationLevel,
    verificationPurpose: planValue.verificationPurpose,
    routeResolved: planValue.routeResolved,
    selectedNodeCount: planValue.selectedNodes.length,
    terminalStatus: 'completed',
    nativeExitCode: 0,
    completedAt: new Date(nowMs).toISOString()
  }
}

function accepted(write) {
  return ['committed', 'semantic-noop'].includes(write?.status)
}

function run() {
  const nowMs = Date.now()
  const cliSource = fs.readFileSync(path.join(__dirname, 'run-validation.js'), 'utf8')
  const zeroExecutionGateIndex = cliSource.indexOf("if (convergenceDecision.action === 'block-open-batch')")
  const pendingBudgetIndex = cliSource.indexOf('const pendingPlanIdentity = resolvePendingBudgetPlanIdentity({', zeroExecutionGateIndex)
  const budgetAuthorityIndex = cliSource.indexOf('const budgetAuthorityResolution = resolveValidationBudgetAuthority({', pendingBudgetIndex)
  const leaseIndex = cliSource.indexOf('const lease = createCliLease({', budgetAuthorityIndex)
  const workerIndex = cliSource.indexOf('const execution = await runManagedValidation({', leaseIndex)
  assert(zeroExecutionGateIndex > 0)
  assert(zeroExecutionGateIndex < pendingBudgetIndex)
  assert(pendingBudgetIndex < budgetAuthorityIndex)
  assert(budgetAuthorityIndex < leaseIndex)
  assert(leaseIndex < workerIndex)
  const baseline = candidate('candidate-baseline', {
    'scripts/old.js': 'old',
    'scripts/unrelated.js': 'unchanged'
  })
  const repaired = candidate('candidate-repaired', {
    'scripts/old.js': 'new',
    'scripts/unrelated.js': 'unchanged',
    'scripts/new.js': 'added'
  })
  const snapshot = buildCandidateSnapshot(baseline)
  assert.deepStrictEqual(buildCandidateSnapshot(baseline), snapshot)
  const delta = repairDeltaBetween(snapshot, repaired)
  assert.deepStrictEqual(delta.files, ['scripts/new.js', 'scripts/old.js'])
  assert.strictEqual(delta.precision, 'content-identity')
  const unknownCommitDelta = repairDeltaBetween(
    candidate('clean-commit-one', {}),
    candidate('clean-commit-two', {})
  )
  assert.deepStrictEqual(unknownCommitDelta.files, ['__devcodex__/unknown-candidate-drift'])
  assert.strictEqual(unknownCommitDelta.precision, 'unknown-candidate-drift')
  const boundedSnapshot = buildCandidateSnapshot(candidate(
    'candidate-bounded-snapshot',
    Object.fromEntries(Array.from({ length: 600 }, (_, index) => [
      `scripts/generated-${String(index).padStart(3, '0')}.js`,
      `content-${index}`
    ]))
  ))
  assert.strictEqual(boundedSnapshot.scopeOmitted, true)
  assert.strictEqual(boundedSnapshot.scopeCount, 600)
  assert.deepStrictEqual(boundedSnapshot.entries, [])
  assert.throws(() => buildCandidateSnapshot({
    stable: true,
    candidateId: 'candidate-duplicate-path',
    dirtyIdentities: [
      { path: 'scripts/duplicate.js', digest: sha256('one') },
      { path: '.\\scripts\\duplicate.js', digest: sha256('two') }
    ]
  }), error => error instanceof ValidationConvergenceError &&
    error.code === 'VALIDATION_REPAIR_CANDIDATE_DUPLICATE_PATH')

  const issueIds = Array.from({ length: 20 }, (_, index) => `finding-${String(index + 1).padStart(2, '0')}`)
  const open = openRepairBatch({
    candidate: baseline,
    baselineCandidate: baseline,
    issueIds,
    failedNodeIds: ['validation-authority'],
    nowMs
  })
  assert.strictEqual(open.phase, 'batch-open')
  assert.strictEqual(open.issueIds.length, 20)
  assert(validateRepairConvergenceState(open).valid)
  const openPlan = plan(baseline.candidateId)
  for (const issueId of issueIds) {
    const decision = resolveValidationConvergenceDecision({
      state: open,
      qualification: null,
      candidate: baseline,
      plan: { ...openPlan, observationOnlyIssue: issueId },
      nowMs
    })
    assert.strictEqual(decision.action, 'block-open-batch')
  }

  const frozen = freezeRepairBatch({ state: open, candidate: repaired, nowMs: nowMs + 1000 })
  assert.strictEqual(frozen.phase, 'batch-frozen')
  assert.deepStrictEqual(frozen.repairDeltaFiles, ['scripts/new.js', 'scripts/old.js'])
  assert.strictEqual(resolveValidationConvergenceDecision({
    state: frozen,
    qualification: null,
    candidate: repaired,
    plan: plan(repaired.candidateId),
    nowMs
  }).action, 'execute-frozen-batch')
  const prematureFullPlan = {
    ...plan(repaired.candidateId),
    planDigest: sha256('premature-full-plan'),
    verificationLevel: 'V3',
    verificationPurpose: 'full-audit',
    routeResolved: 'full'
  }
  assert.throws(() => resolveValidationConvergenceDecision({
    state: frozen,
    qualification: null,
    candidate: repaired,
    plan: prematureFullPlan,
    nowMs
  }), error => error instanceof ValidationConvergenceError &&
    error.code === 'VALIDATION_AFFECTED_QUALIFICATION_REQUIRED')
  assert.throws(() => assertFrozenCandidate(frozen, candidate('candidate-drift', {
    'scripts/old.js': 'newer'
  })), error => error instanceof ValidationConvergenceError &&
    error.code === 'VALIDATION_REPAIR_BATCH_CANDIDATE_DRIFT')

  const planValue = plan(repaired.candidateId)
  const identity = buildQualificationIdentity({ candidate: repaired, plan: planValue })
  assert.deepStrictEqual(identity.selectedNodeIds, ['validation-authority'])
  const terminal = greenTerminal(repaired, planValue, nowMs + 2000)
  const qualification = createSuccessfulQualification({
    identity,
    candidate: repaired,
    receipt: terminal,
    nowMs: nowMs + 2000
  })
  assert.throws(() => createSuccessfulQualification({
    identity,
    candidate: repaired,
    receipt: { ...terminal, terminalDigest: null },
    nowMs: nowMs + 2000
  }), error => error instanceof ValidationConvergenceError &&
    error.code === 'VALIDATION_QUALIFICATION_TERMINAL_INVALID')
  assert.throws(() => createSuccessfulQualification({
    identity,
    candidate: repaired,
    receipt: { ...terminal, completedAt: new Date(nowMs + (10 * 60 * 1000)).toISOString() },
    nowMs
  }), error => error instanceof ValidationConvergenceError &&
    error.code === 'VALIDATION_QUALIFICATION_TERMINAL_TIME_INVALID')
  assert(validateSuccessfulQualification(qualification, nowMs + 3000).reusable)
  const delayedPersistenceQualification = createSuccessfulQualification({
    identity,
    candidate: repaired,
    receipt: terminal,
    nowMs: nowMs + 3000
  })
  assert(validateSuccessfulQualification(delayedPersistenceQualification, nowMs + 3000).reusable)
  assert(qualificationReuseDecision(qualification, identity, nowMs + 3000).reusable)
  const contextOnlyIdentity = buildQualificationIdentity({
    candidate: repaired,
    plan: { ...planValue, contextEpoch: 'different-context', logs: ['different-log'] }
  })
  assert.strictEqual(contextOnlyIdentity.qualificationDigest, identity.qualificationDigest)
  const changedContractIdentity = buildQualificationIdentity({
    candidate: repaired,
    plan: {
      ...planValue,
      selectedNodes: planValue.selectedNodes.map(node => ({ ...node, args: ['changed.js'] }))
    }
  })
  assert.notStrictEqual(changedContractIdentity.qualificationDigest, identity.qualificationDigest)
  const changedInputContractIdentity = buildQualificationIdentity({
    candidate: repaired,
    plan: {
      ...planValue,
      selectedNodes: planValue.selectedNodes.map(node => ({ ...node, inputs: ['changed-input.js'] }))
    }
  })
  assert.notStrictEqual(changedInputContractIdentity.qualificationDigest, identity.qualificationDigest)
  const changedEnvironmentContractIdentity = buildQualificationIdentity({
    candidate: repaired,
    plan: {
      ...planValue,
      selectedNodes: planValue.selectedNodes.map(node => ({
        ...node,
        environment: { ...node.environment, DEVCODEX_FIXTURE: '2' }
      }))
    }
  })
  assert.notStrictEqual(changedEnvironmentContractIdentity.qualificationDigest, identity.qualificationDigest)
  const tampered = JSON.parse(JSON.stringify(qualification))
  tampered.qualificationIdentity.selectedNodeContractDigest = sha256('tampered-node-contract')
  assert.strictEqual(validateSuccessfulQualification(tampered, nowMs + 3000).valid, false)

  const completed = completeRepairBatch({ state: frozen, qualification, nowMs: nowMs + 3000 })
  assert.strictEqual(completed.phase, 'affected-qualified')
  const qualifiedPlanScope = resolveRepairPlanScope(completed, candidate('candidate-with-preexisting-dirty', {
    'scripts/old.js': 'fixed',
    'scripts/unrelated-user-change.js': 'preserve'
  }), qualification)
  assert.strictEqual(qualifiedPlanScope.repairScoped, true)
  assert.deepStrictEqual(qualifiedPlanScope.changedFiles, completed.repairDeltaFiles)
  assert.deepStrictEqual(qualifiedPlanScope.forcedNodeIds, completed.failedNodeIds)
  assert.strictEqual(qualifiedPlanScope.repairContext.stateDigest, completed.stateDigest)
  assert.strictEqual(resolveRepairPlanScope(open, repaired, qualification).repairScoped, false)
  assert.strictEqual(resolveValidationConvergenceDecision({
    state: completed,
    qualification,
    candidate: repaired,
    plan: planValue,
    nowMs: nowMs + 3000
  }).action, 'already-qualified')
  assert.strictEqual(resolveValidationConvergenceDecision({
    state: completed,
    qualification,
    candidate: candidate('candidate-after-affected', { 'scripts/old.js': 'drift' }),
    plan: plan('candidate-after-affected'),
    nowMs: nowMs + 3000
  }).action, 'open-repair-batch')
  const fullPlan = {
    ...planValue,
    planDigest: sha256('full-plan'),
    verificationLevel: 'V3',
    verificationPurpose: 'full-audit',
    routeResolved: 'full'
  }
  assert.strictEqual(resolveValidationConvergenceDecision({
    state: completed,
    qualification,
    candidate: repaired,
    plan: fullPlan,
    nowMs: nowMs + 3000
  }).action, 'execute-initial')
  const fullTerminal = greenTerminal(repaired, fullPlan, nowMs + 3500)
  const fullQualification = createSuccessfulQualification({
    identity: buildQualificationIdentity({ candidate: repaired, plan: fullPlan }),
    candidate: repaired,
    receipt: fullTerminal,
    nowMs: nowMs + 3500
  })
  const fullCompleted = completeRepairBatch({
    state: completed,
    qualification: fullQualification,
    nowMs: nowMs + 4000
  })
  assert.strictEqual(fullCompleted.phase, 'full-qualified')
  assert.strictEqual(resolveValidationConvergenceDecision({
    state: fullCompleted,
    qualification: fullQualification,
    candidate: repaired,
    plan: fullPlan,
    nowMs: nowMs + 4000
  }).action, 'already-qualified')
  assert.throws(() => resolveValidationConvergenceDecision({
    state: fullCompleted,
    qualification: fullQualification,
    candidate: repaired,
    plan: planValue,
    nowMs: nowMs + 4000
  }), error => error instanceof ValidationConvergenceError &&
    error.code === 'VALIDATION_QUALIFICATION_LEVEL_REGRESSION')
  const projectedExecution = compactValidationExecution({
    schemaVersion: 'ValidationExecutionTaskStateV1',
    repairConvergence: completed,
    lastSuccessfulQualification: qualification,
    unknownField: 'must-not-cross-the-projection'
  })
  assert.strictEqual(projectedExecution.repairConvergence.stateDigest, completed.stateDigest)
  assert.strictEqual(projectedExecution.lastSuccessfulQualification.recordDigest, qualification.recordDigest)
  assert.strictEqual(projectedExecution.unknownField, undefined)
  assert.throws(() => compactValidationExecution({
    repairConvergence: { payload: 'x'.repeat(VALIDATION_REPAIR_CONVERGENCE_MAX_BYTES) }
  }), error => error instanceof LifecycleStateProjectionV5Error &&
    error.code === 'LIFECYCLE_VALIDATION_CONVERGENCE_RECORD_EXCEEDED')
  const coldState = buildColdResumeStub({
    phase: 'CP3',
    validationExecution: {
      schemaVersion: 'ValidationExecutionTaskStateV1',
      repairConvergence: completed,
      lastSuccessfulQualification: qualification,
      currentLease: { leaseDigest: sha256('must-not-survive-cold') },
      runnerState: { status: 'running' }
    }
  }).state
  assert.strictEqual(coldState.validationExecution.repairConvergence.phase, 'affected-qualified')
  assert.strictEqual(coldState.validationExecution.repairConvergence.deltaPrecision,
    'qualification-node-frontier')
  assert.deepStrictEqual(coldState.validationExecution.repairConvergence.failedNodeIds,
    ['validation-authority'])
  assert.strictEqual(coldState.validationExecution.lastSuccessfulQualification.qualificationDigest,
    qualification.qualificationDigest)
  assert.deepStrictEqual(coldState.validationExecution.lastSuccessfulQualification.candidateSnapshot.entries, [])
  assert(validateSuccessfulQualification(
    coldState.validationExecution.lastSuccessfulQualification,
    nowMs + 3000
  ).reusable)
  const coldQualifiedPlanScope = resolveRepairPlanScope(
    coldState.validationExecution.repairConvergence,
    repaired,
    coldState.validationExecution.lastSuccessfulQualification
  )
  assert.strictEqual(coldQualifiedPlanScope.repairScoped, true)
  assert.deepStrictEqual(coldQualifiedPlanScope.changedFiles, [])
  assert.deepStrictEqual(coldQualifiedPlanScope.forcedNodeIds, ['validation-authority'])
  assert.deepStrictEqual(coldQualifiedPlanScope.affectedBoundaries,
    ['validation-control-plane'])
  assert.strictEqual(resolveValidationConvergenceDecision({
    state: coldState.validationExecution.repairConvergence,
    qualification: coldState.validationExecution.lastSuccessfulQualification,
    candidate: repaired,
    plan: planValue,
    nowMs: nowMs + 3000
  }).action, 'already-qualified')
  const actualManifest = readValidationManifest(path.join(__dirname, 'validation-manifest.json'))
  const actualPlan = planValidation({
    manifest: actualManifest,
    route: 'changed',
    changedFiles: ['scripts/run-validation.js'],
    changedSource: 'repair-delta',
    riskClass: 'high',
    candidateStable: true,
    candidateId: repaired.candidateId,
    purpose: 'boundary',
    level: 'V2',
    affectedBoundaries: ['validation-control-plane']
  })
  const actualQualification = createSuccessfulQualification({
    identity: buildQualificationIdentity({ candidate: repaired, plan: actualPlan }),
    candidate: repaired,
    receipt: greenTerminal(repaired, actualPlan, nowMs + 3000),
    nowMs: nowMs + 3000
  })
  const actualOpen = openRepairBatch({
    candidate: repaired,
    baselineCandidate: repaired,
    failedNodeIds: ['validation-authority'],
    nowMs: nowMs + 1000
  })
  const actualFrozen = freezeRepairBatch({
    state: actualOpen,
    candidate: repaired,
    nowMs: nowMs + 2000
  })
  const actualCompleted = completeRepairBatch({
    state: actualFrozen,
    qualification: actualQualification,
    nowMs: nowMs + 3000
  })
  const actualColdExecution = buildColdResumeStub({
    phase: 'CP3',
    validationExecution: {
      schemaVersion: 'ValidationExecutionTaskStateV1',
      repairConvergence: actualCompleted,
      lastSuccessfulQualification: actualQualification
    }
  }).state.validationExecution
  const actualReplayScope = resolveRepairPlanScope(
    actualColdExecution.repairConvergence,
    repaired,
    actualColdExecution.lastSuccessfulQualification
  )
  const actualReplayPlan = planValidation({
    manifest: actualManifest,
    route: 'changed',
    changedFiles: actualReplayScope.changedFiles,
    changedSource: actualReplayScope.changedSource,
    riskClass: 'high',
    candidateStable: true,
    candidateId: repaired.candidateId,
    purpose: 'boundary',
    level: 'V2',
    affectedBoundaries: actualReplayScope.affectedBoundaries,
    forcedNodeIds: actualReplayScope.forcedNodeIds,
    repairContext: actualReplayScope.repairContext
  })
  assert.strictEqual(
    buildQualificationIdentity({ candidate: repaired, plan: actualReplayPlan }).qualificationDigest,
    actualQualification.qualificationDigest
  )
  const coldMismatchedQualifiedState = buildColdResumeStub({
    phase: 'CP3',
    validationExecution: {
      schemaVersion: 'ValidationExecutionTaskStateV1',
      repairConvergence: completed,
      lastSuccessfulQualification: fullQualification
    }
  }).state.validationExecution
  assert.strictEqual(coldMismatchedQualifiedState.repairConvergence.phase, 'batch-open')
  assert.deepStrictEqual(coldMismatchedQualifiedState.repairConvergence.repairDeltaFiles,
    ['__devcodex__/cold-resume-conservative'])
  assert(qualificationReuseDecision(
    coldState.validationExecution.lastSuccessfulQualification,
    identity,
    nowMs + 3000
  ).reusable)
  assert.strictEqual(coldState.validationExecution.currentLease, undefined)
  const coldOpenState = buildColdResumeStub({
    phase: 'CP3',
    validationExecution: {
      schemaVersion: 'ValidationExecutionTaskStateV1',
      repairConvergence: open,
      currentLease: { leaseDigest: sha256('must-not-survive-open-cold') }
    }
  }).state.validationExecution.repairConvergence
  assert.strictEqual(coldOpenState.phase, 'batch-open')
  assert.deepStrictEqual(coldOpenState.repairDeltaFiles, ['__devcodex__/cold-resume-conservative'])
  assert.deepStrictEqual(coldOpenState.baselineCandidate.entries, [])
  assert.deepStrictEqual(coldOpenState.observedCandidate.entries, [])
  assert(validateRepairConvergenceState(coldOpenState).valid)
  const reopenedState = clearReopenedTaskActiveAuthorities({
    validationControlIngress: { action: 'confirm' },
    validationExecution: {
      schemaVersion: 'ValidationExecutionTaskStateV1',
      repairConvergence: completed,
      lastSuccessfulQualification: qualification,
      rootBudgetConfirmation: { receiptDigest: sha256('must-not-survive-reopen') },
      terminalReceipt: terminal
    }
  })
  assert.strictEqual(reopenedState.validationExecution.repairConvergence.stateDigest, completed.stateDigest)
  assert.strictEqual(reopenedState.validationExecution.lastSuccessfulQualification.recordDigest,
    qualification.recordDigest)
  assert.strictEqual(reopenedState.validationExecution.rootBudgetConfirmation, undefined)
  assert.strictEqual(reopenedState.validationExecution.terminalReceipt, undefined)
  assert.strictEqual(reopenedState.validationExecution.convergenceTerminalReceipt.schemaVersion,
    'ValidationConvergenceTerminalV1')
  assert.strictEqual(recoverQualificationFromSuccessfulTerminal({
    candidate: repaired,
    plan: planValue,
    terminal: reopenedState.validationExecution.convergenceTerminalReceipt,
    nowMs: nowMs + 3000
  }).recoverable, true)
  assert.strictEqual(reopenedState.validationControlIngress, undefined)

  const recoveredGreen = recoverQualificationFromSuccessfulTerminal({
    candidate: repaired,
    plan: planValue,
    terminal,
    nowMs: nowMs + 3000
  })
  assert.strictEqual(recoveredGreen.recoverable, true)
  assert.strictEqual(recoveredGreen.qualification.qualificationDigest, identity.qualificationDigest)
  assert.strictEqual(recoverQualificationFromSuccessfulTerminal({
    candidate: repaired,
    plan: planValue,
    terminal: { ...terminal, completedAt: new Date(nowMs - (48 * 60 * 60 * 1000)).toISOString() },
    nowMs
  }).reasonCode, 'terminal-expired')
  assert.strictEqual(recoverQualificationFromSuccessfulTerminal({
    candidate: repaired,
    plan: { ...planValue, planDigest: sha256('other-plan') },
    terminal,
    nowMs
  }).reasonCode, 'plan-mismatch')

  const failedTerminal = {
    ...terminal,
    receiptId: 'failed-receipt',
    terminalDigest: sha256('failed-terminal'),
    terminalStatus: 'failed',
    nativeExitCode: 1,
    failedNode: 'validation-authority',
    failedNodes: ['validation-authority'],
    abortedNodes: ['validation-dag'],
    completedAt: new Date(nowMs + 4000).toISOString()
  }
  const recoveredFailure = recoverRepairBatchFromFailedTerminal({
    candidate: repaired,
    terminal: failedTerminal,
    qualification,
    nowMs: nowMs + 5000
  })
  assert.strictEqual(recoveredFailure.phase, 'batch-open')
  assert.deepStrictEqual(recoveredFailure.failedNodeIds, ['validation-authority', 'validation-dag'])
  assert.deepStrictEqual(recoveredFailure.repairDeltaFiles, ['__devcodex__/bounded-scope-fallback'])
  assert.strictEqual(recoveredFailure.deltaPrecision, 'bounded-scope-fallback')
  const coldFailedTerminal = buildColdResumeStub({
    phase: 'CP3',
    validationExecution: {
      schemaVersion: 'ValidationExecutionTaskStateV1',
      terminalReceipt: failedTerminal
    }
  }).state.validationExecution
  assert.strictEqual(coldFailedTerminal.terminalReceipt, undefined)
  assert.strictEqual(coldFailedTerminal.convergenceTerminalReceipt.schemaVersion,
    'ValidationConvergenceTerminalV1')
  const boundedTerminalState = clearReopenedTaskActiveAuthorities({
    validationExecution: {
      schemaVersion: 'ValidationExecutionTaskStateV1',
      terminalReceipt: {
        ...failedTerminal,
        abortedNodes: Array.from({ length: 100 }, (_, index) =>
          `oversized-node-${index}-${'x'.repeat(2048)}`)
      }
    }
  }).validationExecution
  assert(Buffer.byteLength(JSON.stringify(boundedTerminalState.convergenceTerminalReceipt), 'utf8') <=
    VALIDATION_CONVERGENCE_TERMINAL_MAX_BYTES)
  assert.strictEqual(recoverRepairBatchFromFailedTerminal({
    candidate: repaired,
    terminal: coldFailedTerminal.convergenceTerminalReceipt,
    qualification,
    nowMs: nowMs + 5000
  }).phase, 'batch-open')

  const reopened = reopenRepairBatchAfterFailure({
    state: frozen,
    candidate: repaired,
    receipt: failedTerminal,
    issueIds: ['new-finding'],
    nowMs: nowMs + 5000
  })
  assert(reopened.issueIds.includes('finding-01'))
  assert(reopened.issueIds.includes('new-finding'))
  assert.deepStrictEqual(reopened.failedNodeIds, ['validation-authority', 'validation-dag'])
  assert.strictEqual(reopened.baselineCandidate.candidateId, repaired.candidateId)
  assert.deepStrictEqual(reopened.repairDeltaFiles, [])
  const secondRepair = candidate('candidate-repaired-again', {
    'scripts/old.js': 'newest',
    'scripts/unrelated.js': 'unchanged',
    'scripts/new.js': 'added'
  })
  const extendedReopened = openRepairBatch({
    candidate: secondRepair,
    priorState: reopened,
    nowMs: nowMs + 6000
  })
  assert.deepStrictEqual(extendedReopened.repairDeltaFiles, ['scripts/old.js'])

  const semanticNode = planValue.selectedNodes[0]
  const digestA = buildSemanticNodeEvidenceDigest({
    node: semanticNode,
    evidence: { exitCode: 0, stdout: 'first log', stderr: '', durationMs: 10 }
  })
  const digestB = buildSemanticNodeEvidenceDigest({
    node: semanticNode,
    evidence: { exitCode: 0, stdout: 'different log', stderr: 'noise', durationMs: 999 }
  })
  const digestFailure = buildSemanticNodeEvidenceDigest({
    node: semanticNode,
    evidence: { exitCode: 1, stdout: 'first log', stderr: '', durationMs: 10 }
  })
  assert.strictEqual(digestA, digestB)
  assert.notStrictEqual(digestA, digestFailure)

  const activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validation-convergence-'))
  try {
    const taskId = 'f56ec9f4-652b-481d-81ea-9a12755c31de'
    const sessionKey = 'validation-convergence-session'
    const taskIdentity = { activeRoot, project: 'devcodex', taskId, taskStatus: 'active' }
    const commit = commitTaskRecoveryState({
      metaDir: resolveTaskRecoveryMetaDir({ activeRoot, project: 'devcodex' }),
      identity: taskIdentity,
      sessionKey,
      state: { phase: 'CP3' }
    })
    assert(accepted(commit), JSON.stringify(commit))
    const store = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity,
      taskRecoveryKey: taskId,
      sessionKey
    })
    const openWrite = store.writeRepairConvergence(open, { expectedStateDigest: null, nowMs })
    assert(accepted(openWrite), JSON.stringify(openWrite))
    assert.strictEqual(store.readRepairConvergence().repairConvergence.stateDigest, open.stateDigest)
    const exactRetry = store.writeRepairConvergence(open, { expectedStateDigest: null, nowMs })
    assert(accepted(exactRetry), JSON.stringify(exactRetry))
    const conflicting = openRepairBatch({
      candidate: baseline,
      baselineCandidate: baseline,
      priorState: open,
      issueIds: ['late-finding'],
      nowMs: nowMs + 1
    })
    const conflictWrite = store.writeRepairConvergence(conflicting, { expectedStateDigest: null, nowMs })
    assert.strictEqual(conflictWrite.errorCode, 'VALIDATION_REPAIR_STATE_CAS_CONFLICT')
    const frozenWrite = store.writeRepairConvergence(frozen, { expectedStateDigest: open.stateDigest, nowMs })
    assert(accepted(frozenWrite), JSON.stringify(frozenWrite))
    const outcomeWrite = store.writeConvergenceOutcome({
      repairConvergence: completed,
      lastSuccessfulQualification: qualification
    }, {
      expectedStateDigest: frozen.stateDigest,
      expectedQualificationDigest: null,
      nowMs: nowMs + 3000
    })
    assert(accepted(outcomeWrite), JSON.stringify(outcomeWrite))
    assert.strictEqual(store.readRepairConvergence().repairConvergence.stateDigest, completed.stateDigest)
    assert.strictEqual(store.readLastSuccessfulQualification().lastSuccessfulQualification.recordDigest,
      qualification.recordDigest)
    const outcomeRetry = store.writeConvergenceOutcome({
      repairConvergence: completed,
      lastSuccessfulQualification: qualification
    }, {
      expectedStateDigest: frozen.stateDigest,
      expectedQualificationDigest: null,
      nowMs: nowMs + 3000
    })
    assert(accepted(outcomeRetry), JSON.stringify(outcomeRetry))
  } finally {
    fs.rmSync(activeRoot, { recursive: true, force: true })
  }

  process.stdout.write('test-validation-convergence: ok\n')
}

run()
