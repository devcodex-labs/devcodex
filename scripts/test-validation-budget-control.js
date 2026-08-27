'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { sha256, stableStringify } = require('../hooks/_runtime/content-identity.cjs')
const { projectArtifactMutationReconciliationReceipt } = require('../hooks/_runtime/artifact-mutation-reconciliation.cjs')
const { buildActualInstructionEnvelope } = require('../hooks/_runtime/actual-instruction-envelope.cjs')
const {
  applyValidationControlIngress,
  createValidationControlIngressReceipt,
  validationProjectRootIdentity
} = require('../hooks/_runtime/workflow-completion-contract.cjs')
const {
  commitTaskRecoveryState,
  readTaskRecoveryState,
  resolveTaskRecoveryMetaDir,
  updateTaskRecoveryState
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const { createValidationEvidenceStore } = require('./lib/validation-evidence-store')
const { ValidationDagError } = require('./lib/validation-dag')
const {
  createBudgetConfirmationReceipt,
  createPendingBudgetCardBinding,
  createVerificationExecutionLease,
  planBudgetProjection
} = require('./lib/validation-execution-authority')
const { resolveAiBudgetAuthority } = require('./run-validation')

const REPO_ROOT = path.resolve(__dirname, '..')
const NOW = Date.now()

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

function controlReceipt({ prompt, mode, sessionKey, taskId, contextEpoch, suffix, nowMs = NOW, ttlMs = null }) {
  const envelope = buildActualInstructionEnvelope({
    prompt,
    sourceEventId: `validation-budget-control-${suffix}`,
    issuedAt: new Date(nowMs).toISOString()
  }, {
    actualInstruction: prompt,
    hostVariant: 'codex',
    hostSessionId: sessionKey,
    turnId: `turn-${suffix}`,
    contextEpoch,
    trustedHostEvent: true,
    nowMs
  }, {
    nowMs,
    ...(Number.isFinite(ttlMs) ? { ttlMs } : {})
  })
  return createValidationControlIngressReceipt({
    actualInstructionEnvelope: envelope,
    actualInstruction: prompt,
    executionMode: mode,
    taskRecoveryKey: taskId,
    project: 'devcodex',
    projectRootIdentity: validationProjectRootIdentity(REPO_ROOT)
  })
}

function fixturePlan(taskId, contextEpoch, suffix = 'root', overrides = {}) {
  const selectedNodes = overrides.selectedNodes || [{ id: 'validation-authority', writeScopes: [] }]
  return {
    schemaVersion: 'ValidationPlanV3',
    planDigest: sha256(`plan-${suffix}`),
    changedScopeDigest: sha256(`scope-${suffix}`),
    requestDigest: sha256(`request-${suffix}`),
    verificationLevel: overrides.verificationLevel || 'V2',
    verificationPurpose: overrides.verificationPurpose || 'boundary',
    verificationIntent: {
      project: 'devcodex',
      taskRecoveryKey: taskId,
      contextEpoch
    },
    affectedBoundaries: ['validation-authority'],
    selectedNodes,
    selectedNodeCount: selectedNodes.length,
    budgetCard: {
      schemaVersion: 'BudgetCardV1',
      digest: sha256(`budget-${suffix}`),
      estimatedDurationMs: 700000,
      hardTimeoutUpperBoundMs: 1200000,
      logBudgetBytes: 4096,
      heavyNodeIds: ['validation-authority'],
      sideEffectCategories: [],
      confirmationRequired: true,
      status: 'awaiting-confirmation'
    },
    executionState: 'awaiting-budget'
  }
}

function fixtureCandidate(suffix = 'root') {
  return {
    candidateId: `validation-candidate-${suffix}`,
    stable: false,
    head: 'a'.repeat(40),
    changedSource: 'fixture',
    changedFiles: ['scripts/run-validation.js'],
    dirtyIdentities: [{ path: 'scripts/run-validation.js', digest: sha256(`dirty-${suffix}`) }]
  }
}

function seedTask({ activeRoot, taskId, sessionKey, control }) {
  const identity = { activeRoot, project: 'devcodex', taskId, taskStatus: 'active' }
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot, project: 'devcodex' })
  const commit = commitTaskRecoveryState({
    metaDir,
    identity,
    sessionKey,
    state: { phase: 'CP3', validationControlIngress: control }
  })
  assert(['committed', 'semantic-noop'].includes(commit.status), JSON.stringify(commit))
  return { identity, metaDir }
}

function updateControl({ activeRoot, identity, metaDir, sessionKey, control }) {
  const result = updateTaskRecoveryState({
    metaDir,
    identity,
    sessionKey,
    expectedIdentity: { activeRoot, project: 'devcodex' },
    readFallback: () => ({})
  }, state => {
    const next = { ...state }
    applyValidationControlIngress(next, control)
    return next
  }, { force: true, nowMs: NOW + 1000 })
  assert(['committed', 'semantic-noop'].includes(result.status), JSON.stringify(result))
}

function authorityContext({ identity, sessionKey, contextEpoch, control, state = {} }) {
  return {
    taskIdentity: identity,
    sessionKey,
    taskRecoveryKey: identity.taskId,
    contextEpoch,
    validationControlIngress: control,
    sourceMessageDigest: control.sourceMessageDigest,
    authoritySourceRef: `validation-control:${control.receiptDigest}`,
    taskState: state
  }
}

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof ValidationDagError && error.code === code, code)
}

function persistRunTerminal({
  store, plan, candidate, authority, control, taskId, contextEpoch, failedNode = null, terminalStatus = 'failed'
}) {
  const authoritySourceRef = authority.schemaVersion === 'BudgetConfirmationReceiptV1'
    ? `budget-confirmation:${authority.receiptDigest}`
    : `validation-continuation:${authority.continuationDigest}`
  const lease = createVerificationExecutionLease({
    actorType: 'ai-hook',
    authorityClass: 'scoped',
    actorIdentityEvidence: { fixtureActor: 'ai-hook' },
    repoRoot: REPO_ROOT,
    plan,
    candidate,
    project: 'devcodex',
    taskRecoveryKey: taskId,
    contextEpoch,
    authoritySourceRef,
    sourceMessageDigest: control.sourceMessageDigest,
    revocationEpoch: authority.revocationEpoch
  })
  assert(['committed', 'semantic-noop'].includes(store.writeLease(lease).status))
  const write = store.writeTerminal({
    schemaVersion: 'ValidationExecutionReceiptV3',
    receiptId: `validation-receipt-${lease.runIdentityDigest}`,
    runId: lease.runId,
    runIdentity: lease.runIdentity,
    runIdentityDigest: lease.runIdentityDigest,
    candidateId: candidate.candidateId,
    candidateIdentity: candidate,
    testRouteDigest: plan.planDigest,
    requestDigest: plan.requestDigest,
    budgetCard: plan.budgetCard,
    budgetProjection: planBudgetProjection(plan),
    authorityDigest: lease.authorityDigest,
    authoritySourceRef: lease.authoritySourceRef,
    authorityActorType: 'ai-hook',
    authorityClass: 'scoped',
    verificationLevel: 'V2',
    verificationPurpose: 'boundary',
    terminalStatus,
    claimCeiling: terminalStatus === 'completed' ? 'boundary-qualified' : 'non-qualifying',
    selectedNodeCount: plan.selectedNodeCount,
    executionCount: 1,
    cacheHitCount: 0,
    failedNode: terminalStatus === 'completed' ? null : failedNode,
    abortedNodes: [],
    nodeReceiptDigests: {},
    startedAt: new Date(NOW).toISOString(),
    completedAt: new Date(NOW + 1000).toISOString(),
    wallTimeMs: 1000,
    nativeExitCode: terminalStatus === 'completed' ? 0 : 1
  })
  assert(['committed', 'semantic-noop'].includes(write.status), JSON.stringify(write))
  return lease
}

function persistRepairCloseout({ activeRoot, metaDir, identity, sessionKey, repairPath, suffix, nowMs, projection = false }) {
  const operationId = `repair-operation-${suffix}`
  const absoluteRepairPath = path.join(REPO_ROOT, ...String(repairPath).replace(/\\/g, '/').split('/'))
  const priorObservationReceiptDigest = sha256(`repair-observation-${suffix}`)
  const priorCloseoutDigest = sha256(`repair-closeout-${suffix}`)
  const priorPlannedSetDigest = sha256(`repair-planned-set-${suffix}`)
  const repairStat = fs.statSync(absoluteRepairPath)
  const snapshotSemantic = {
    schemaVersion: 'ArtifactMutationReconciliationSnapshotV1',
    entries: [{
      path: absoluteRepairPath,
      rootKind: 'project-root',
      expectedState: 'present',
      state: 'present',
      kind: 'file',
      bytes: repairStat.size,
      contentDigest: sha256(fs.readFileSync(absoluteRepairPath)),
      identity: {
        dev: String(repairStat.dev),
        ino: String(repairStat.ino),
        size: repairStat.size,
        mtimeMs: repairStat.mtimeMs,
        ctimeMs: repairStat.ctimeMs
      }
    }],
    observedAt: new Date(nowMs).toISOString()
  }
  const currentEffectSnapshot = {
    ...snapshotSemantic,
    snapshotDigest: sha256(stableStringify(snapshotSemantic))
  }
  const reconciliationSemantic = {
    schemaVersion: 'ArtifactMutationReconciliationReceiptV1',
    resolution: 'accept-observed-effects',
    sourceKind: 'primary',
    reserveSequence: null,
    reserveRecordDigest: null,
    project: 'devcodex',
    taskId: identity.taskId,
    operationId,
    priorObservationReceiptDigest,
    priorCloseoutDigest,
    priorPlannedSetDigest,
    recoveryMode: 'prior-complete-observation',
    recoveryInputDigest: null,
    recoveredObservedEffects: { created: [], modified: [absoluteRepairPath], deleted: [], moved: [] },
    recoveredObservedEffectsDigest: sha256(stableStringify({ created: [], modified: [absoluteRepairPath], deleted: [], moved: [] })),
    activeRootDigest: sha256(activeRoot),
    projectRootDigest: sha256(REPO_ROOT),
    ingressEnvelopeDigest: sha256(`repair-envelope-${suffix}`),
    ingressDecisionDigest: sha256(`repair-decision-${suffix}`),
    ingressRouteRevision: sha256(`repair-route-${suffix}`),
    projectTargetLeaseDigest: sha256(`repair-lease-${suffix}`),
    hostSessionDigest: sha256(sessionKey),
    currentEffectSnapshot,
    mutationAuthority: false,
    reconciledAt: new Date(nowMs).toISOString()
  }
  const reconciliation = {
    ...reconciliationSemantic,
    receiptDigest: sha256(stableStringify(reconciliationSemantic))
  }
  const storedReconciliation = projection
    ? projectArtifactMutationReconciliationReceipt(reconciliation)
    : reconciliation
  const result = updateTaskRecoveryState({
    metaDir,
    identity,
    sessionKey,
    expectedIdentity: { activeRoot, project: 'devcodex' },
    readFallback: () => ({})
  }, state => ({
    ...state,
    turnLiveness: {
      ...(state.turnLiveness || {}),
      lastMutationCloseout: {
        schemaVersion: 'LifecycleMutationCloseoutV2',
        operationId,
        completedAt: new Date(nowMs).toISOString(),
        result: 'reconciled',
        authorizationErrors: ['mutation-tool-reported-failure'],
        observation: {
          schemaVersion: 'MutationObservationReceiptV1',
          operationId,
          plannedSetDigest: priorPlannedSetDigest,
          observedEffects: { created: [], modified: [absoluteRepairPath], deleted: [], moved: [] },
          observationCoverage: 'complete',
          nativeExitCode: 1,
          drift: ['mutation-tool-reported-failure'],
          reconcileRequired: true,
          status: 'needs-reconcile',
          completedAt: new Date(nowMs).toISOString(),
          receiptDigest: priorObservationReceiptDigest
        },
        artifactCloseout: { closeoutDigest: priorCloseoutDigest },
        reconciliation: storedReconciliation
      }
    }
  }), { force: true, nowMs })
  assert(['committed', 'semantic-noop'].includes(result.status), JSON.stringify(result))
  const read = readTaskRecoveryState({
    metaDir,
    identity,
    sessionKey,
    expectedIdentity: { activeRoot, project: 'devcodex' }
  })
  assert.strictEqual(read.status, 'fresh')
  return read.state
}

function createGitLineageFixture(fixtureRoot) {
  const repoRoot = path.join(fixtureRoot, 'git-lineage')
  fs.mkdirSync(repoRoot, { recursive: true })
  execFileSync('git', ['init', '--quiet'], {
    cwd: repoRoot,
    windowsHide: true
  })
  const heads = []
  const commitFiles = []
  for (let index = 0; index < 3; index += 1) {
    const timestamp = `2020-01-01T00:00:0${index}Z`
    const relativeFile = `lineage-${index}.txt`
    fs.writeFileSync(path.join(repoRoot, relativeFile), `lineage-${index}\n`, 'utf8')
    execFileSync('git', ['add', '--', relativeFile], {
      cwd: repoRoot,
      windowsHide: true
    })
    execFileSync('git', [
      '-c', 'user.name=DevCodex Test',
      '-c', 'user.email=devcodex-test@example.invalid',
      '-c', 'commit.gpgSign=false',
      'commit', '--allow-empty', '--quiet', '--no-gpg-sign', '-m', `lineage-${index}`
    ], {
      cwd: repoRoot,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: timestamp,
        GIT_COMMITTER_DATE: timestamp
      }
    })
    heads.push(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    }).trim())
    commitFiles.push(relativeFile)
  }
  return {
    repoRoot,
    ancestorHead: heads[0],
    previousHead: heads[1],
    currentHead: heads[2],
    commitFiles
  }
}

function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validation-budget-control-'))
  const activeRoot = path.join(fixtureRoot, '.devcodex', 'devcodex')
  try {
    const autoTaskId = '00000000-0000-4000-8000-000000000361'
    const autoSession = 'validation-auto-session'
    const contextEpoch = 'ctx-validation-budget'
    const autoControl = controlReceipt({
      prompt: '@rocky 自动推进',
      mode: 'auto',
      sessionKey: autoSession,
      taskId: autoTaskId,
      contextEpoch,
      suffix: 'auto'
    })
    const autoSeed = seedTask({ activeRoot, taskId: autoTaskId, sessionKey: autoSession, control: autoControl })
    const autoPlan = fixturePlan(autoTaskId, contextEpoch, 'auto-root')
    const candidate = fixtureCandidate('auto-root')
    const autoContext = authorityContext({
      identity: autoSeed.identity,
      sessionKey: autoSession,
      contextEpoch,
      control: autoControl
    })
    const planOnly = resolveAiBudgetAuthority({
      options: {}, plan: autoPlan, candidate, authorityContext: autoContext, activeRoot, execute: false
    })
    assert.strictEqual(planOnly.decision, 'auto-ready-plan-only')
    assert.strictEqual(planOnly.authority, null)
    const autoStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity: autoSeed.identity,
      taskRecoveryKey: autoTaskId,
      sessionKey: autoSession
    })
    assert.strictEqual(autoStore.readPendingBudgetCard().status, 'fresh')
    assert.strictEqual(autoStore.readRootBudgetConfirmation().status, 'missing')
    const autoExecution = resolveAiBudgetAuthority({
      options: {}, plan: autoPlan, candidate, authorityContext: autoContext, activeRoot, execute: true
    })
    assert.strictEqual(autoExecution.decision, 'auto-authorized')
    assert.strictEqual(autoExecution.plan.budgetCard.status, 'approved')
    assert.strictEqual(autoExecution.authority.authorityKind, 'auto')
    assert.strictEqual(autoStore.readPendingBudgetCard().status, 'missing')
    assert.strictEqual(autoStore.readRootBudgetConfirmation().status, 'fresh')
    const replay = resolveAiBudgetAuthority({
      options: {}, plan: autoPlan, candidate, authorityContext: autoContext, activeRoot, execute: true
    })
    assert.strictEqual(replay.decision, 'root-replay-or-reconcile')

    const parentLease = createVerificationExecutionLease({
      actorType: 'ai-hook',
      authorityClass: 'scoped',
      actorIdentityEvidence: { fixtureActor: 'ai-hook' },
      repoRoot: REPO_ROOT,
      plan: autoExecution.plan,
      candidate,
      project: 'devcodex',
      taskRecoveryKey: autoTaskId,
      contextEpoch,
      authoritySourceRef: `budget-confirmation:${autoExecution.authority.receiptDigest}`,
      sourceMessageDigest: autoControl.sourceMessageDigest,
      revocationEpoch: 0
    })
    assert(['committed', 'semantic-noop'].includes(autoStore.writeLease(parentLease).status))
    const liveReplacementPlan = fixturePlan(autoTaskId, contextEpoch, 'live-root-replacement')
    const liveReplacementCandidate = fixtureCandidate('live-root-replacement')
    for (const execute of [false, true]) {
      expectCode(() => resolveAiBudgetAuthority({
        options: {},
        plan: liveReplacementPlan,
        candidate: liveReplacementCandidate,
        authorityContext: autoContext,
        activeRoot,
        execute
      }), 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT')
    }
    assert.strictEqual(autoStore.readPendingBudgetCard().status, 'missing',
      'live root replacement rejection must not leave a new pending card')
    assert.strictEqual(autoStore.readRootBudgetConfirmation().rootBudgetConfirmation.receiptDigest,
      autoExecution.authority.receiptDigest, 'live root replacement must preserve the original root')
    assert.strictEqual(autoStore.readLease().lease.runIdentityDigest, parentLease.runIdentityDigest,
      'live root replacement must preserve the original execution lease')
    const directReplacementPending = createPendingBudgetCardBinding({
      plan: liveReplacementPlan,
      candidate: liveReplacementCandidate,
      repoRoot: REPO_ROOT,
      project: 'devcodex',
      taskRecoveryKey: autoTaskId,
      hostSessionDigest: autoControl.hostSessionDigest,
      contextEpoch,
      stateRevision: 1
    })
    assert(['committed', 'semantic-noop'].includes(autoStore.writePendingBudgetCard(directReplacementPending).status))
    const directReplacementReceipt = createBudgetConfirmationReceipt({
      pendingBudgetCard: directReplacementPending,
      authorityKind: 'auto',
      autoAuthorityRef: autoControl.autoAuthorityRef,
      revocationEpoch: 0
    }, { serverOwnedAutoAuthorityRef: autoControl.autoAuthorityRef })
    const directReplacementWrite = autoStore.writeRootBudgetConfirmation(directReplacementReceipt, {
      expectedRootReceiptDigest: autoExecution.authority.receiptDigest,
      rootBudgetProjection: planBudgetProjection(liveReplacementPlan)
    })
    assert.strictEqual(directReplacementWrite.status, 'error')
    assert.strictEqual(directReplacementWrite.errorCode, 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT')
    assert.strictEqual(autoStore.readRootBudgetConfirmation().rootBudgetConfirmation.receiptDigest,
      autoExecution.authority.receiptDigest, 'server-owned store must reject direct live root replacement')
    assert.strictEqual(autoStore.readLease().lease.runIdentityDigest, parentLease.runIdentityDigest,
      'server-owned store must not clear the live lease on rejected direct replacement')
    const parentTerminalWrite = autoStore.writeTerminal({
      schemaVersion: 'ValidationExecutionReceiptV3',
      receiptId: `validation-receipt-${parentLease.runIdentityDigest}`,
      runId: parentLease.runId,
      runIdentity: parentLease.runIdentity,
      runIdentityDigest: parentLease.runIdentityDigest,
      candidateId: candidate.candidateId,
      candidateIdentity: candidate,
      testRouteDigest: autoPlan.planDigest,
      requestDigest: autoPlan.requestDigest,
      budgetCard: autoPlan.budgetCard,
      budgetProjection: planBudgetProjection(autoPlan),
      authorityDigest: parentLease.authorityDigest,
      authoritySourceRef: parentLease.authoritySourceRef,
      authorityActorType: 'ai-hook',
      authorityClass: 'scoped',
      verificationLevel: 'V2',
      verificationPurpose: 'boundary',
      terminalStatus: 'failed',
      claimCeiling: 'non-qualifying',
      selectedNodeCount: 1,
      executionCount: 1,
      cacheHitCount: 0,
      failedNode: 'validation-authority',
      abortedNodes: [],
      nodeReceiptDigests: {},
      startedAt: new Date(NOW).toISOString(),
      completedAt: new Date(NOW + 1000).toISOString(),
      wallTimeMs: 1000,
      nativeExitCode: 1
    })
    assert(['committed', 'semantic-noop'].includes(parentTerminalWrite.status), JSON.stringify(parentTerminalWrite))
    const repairPath = 'scripts/lib/validation-execution-authority.js'
    const repairObservationDigest = sha256('repair-observation')
    const repairPlannedSetDigest = sha256('repair-planned-set')
    updateTaskRecoveryState({
      metaDir: autoSeed.metaDir,
      identity: autoSeed.identity,
      sessionKey: autoSession,
      expectedIdentity: { activeRoot, project: 'devcodex' },
      readFallback: () => ({})
    }, state => ({
      ...state,
      turnLiveness: {
        ...(state.turnLiveness || {}),
        lastMutationCloseout: {
          schemaVersion: 'LifecycleMutationCloseoutV2',
          operationId: 'repair-operation',
          completedAt: new Date(NOW + 2000).toISOString(),
          result: 'success',
          authorizationErrors: [],
          observation: {
            schemaVersion: 'MutationObservationReceiptV1',
            operationId: 'repair-operation',
            plannedSetDigest: repairPlannedSetDigest,
            observedEffects: { created: [], modified: [repairPath], deleted: [], moved: [] },
            observationCoverage: 'complete',
            nativeExitCode: 0,
            drift: [],
            reconcileRequired: false,
            status: 'consumed',
            completedAt: new Date(NOW + 2000).toISOString(),
            receiptDigest: repairObservationDigest
          }
        }
      }
    }), { force: true, nowMs: NOW + 2000 })
    const stateAfterRepair = readTaskRecoveryState({
      metaDir: autoSeed.metaDir,
      identity: autoSeed.identity,
      sessionKey: autoSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const childPlan = fixturePlan(autoTaskId, contextEpoch, 'auto-child', {
      selectedNodes: [
        { id: 'validation-authority', writeScopes: [] },
        { id: 'validation-budget-control', writeScopes: [] }
      ]
    })
    childPlan.budgetCard.estimatedDurationMs = 710000
    childPlan.budgetCard.heavyNodeIds = ['validation-authority']
    const childCandidate = {
      ...fixtureCandidate('auto-child'),
      changedFiles: ['scripts/run-validation.js', repairPath],
      dirtyIdentities: [
        { path: 'scripts/run-validation.js', digest: sha256('dirty-auto-root') },
        { path: repairPath, digest: sha256('dirty-auto-child') }
      ]
    }
    const childExecution = resolveAiBudgetAuthority({
      options: {},
      plan: childPlan,
      candidate: childCandidate,
      authorityContext: authorityContext({
        identity: autoSeed.identity,
        sessionKey: autoSession,
        contextEpoch,
        control: autoControl,
        state: stateAfterRepair.state
      }),
      activeRoot,
      execute: true
    })
    assert.strictEqual(childExecution.decision, 'auto-continuation-authorized')
    assert.strictEqual(childExecution.authority.schemaVersion, 'ValidationContinuationAuthorizationV1')
    assert.strictEqual(childExecution.authority.retryOrdinal, 1)
    assert.strictEqual(autoStore.readRootBudgetConfirmation().rootBudgetConfirmation.receiptDigest,
      autoExecution.authority.receiptDigest, 'bounded continuation must preserve the immutable root receipt')
    persistRunTerminal({
      store: autoStore,
      plan: childExecution.plan,
      candidate: childCandidate,
      authority: childExecution.authority,
      control: autoControl,
      taskId: autoTaskId,
      contextEpoch,
      failedNode: 'validation-budget-control'
    })
    const secondRepairPath = 'scripts/lib/validation-evidence-store.js'
    const secondRepairState = persistRepairCloseout({
      activeRoot,
      metaDir: autoSeed.metaDir,
      identity: autoSeed.identity,
      sessionKey: autoSession,
      repairPath: secondRepairPath,
      suffix: 'second',
      nowMs: NOW + 3000,
      projection: true
    })
    const secondChildPlan = fixturePlan(autoTaskId, contextEpoch, 'auto-child-2', {
      selectedNodes: childPlan.selectedNodes
    })
    secondChildPlan.budgetCard.estimatedDurationMs = 720000
    secondChildPlan.budgetCard.heavyNodeIds = ['validation-authority']
    const secondChildCandidate = {
      ...fixtureCandidate('auto-child-2'),
      changedFiles: ['scripts/run-validation.js', repairPath, secondRepairPath],
      dirtyIdentities: [
        { path: 'scripts/run-validation.js', digest: sha256('dirty-auto-root') },
        { path: repairPath, digest: sha256('dirty-auto-child') },
        { path: secondRepairPath, digest: sha256('dirty-auto-child-2') }
      ]
    }
    const secondChildExecution = resolveAiBudgetAuthority({
      options: {},
      plan: secondChildPlan,
      candidate: secondChildCandidate,
      authorityContext: authorityContext({
        identity: autoSeed.identity,
        sessionKey: autoSession,
        contextEpoch,
        control: autoControl,
        state: secondRepairState
      }),
      activeRoot,
      execute: true
    })
    assert.strictEqual(secondChildExecution.decision, 'auto-continuation-authorized')
    assert.strictEqual(secondChildExecution.authority.retryOrdinal, 2)
    persistRunTerminal({
      store: autoStore,
      plan: secondChildExecution.plan,
      candidate: secondChildCandidate,
      authority: secondChildExecution.authority,
      control: autoControl,
      taskId: autoTaskId,
      contextEpoch,
      failedNode: 'validation-budget-control'
    })
    const thirdRepairPath = 'scripts/test-validation-budget-control.js'
    const thirdRepairState = persistRepairCloseout({
      activeRoot,
      metaDir: autoSeed.metaDir,
      identity: autoSeed.identity,
      sessionKey: autoSession,
      repairPath: thirdRepairPath,
      suffix: 'third',
      nowMs: NOW + 4000
    })
    const thirdChildPlan = fixturePlan(autoTaskId, contextEpoch, 'auto-child-3', {
      selectedNodes: childPlan.selectedNodes
    })
    thirdChildPlan.budgetCard.estimatedDurationMs = 730000
    thirdChildPlan.budgetCard.heavyNodeIds = ['validation-authority']
    const thirdChildCandidate = {
      ...fixtureCandidate('auto-child-3'),
      changedFiles: ['scripts/run-validation.js', repairPath, secondRepairPath, thirdRepairPath],
      dirtyIdentities: [
        { path: 'scripts/run-validation.js', digest: sha256('dirty-auto-root') },
        { path: repairPath, digest: sha256('dirty-auto-child') },
        { path: secondRepairPath, digest: sha256('dirty-auto-child-2') },
        { path: thirdRepairPath, digest: sha256('dirty-auto-child-3') }
      ]
    }
    expectCode(() => resolveAiBudgetAuthority({
      options: {},
      plan: thirdChildPlan,
      candidate: thirdChildCandidate,
      authorityContext: authorityContext({
        identity: autoSeed.identity,
        sessionKey: autoSession,
        contextEpoch,
        control: autoControl,
        state: thirdRepairState
      }),
      activeRoot,
      execute: true
    }), 'VALIDATION_CONTINUATION_RETRY_EXHAUSTED')

    // A terminal failed root remains immutable, but a later committed strict
    // descendant may start one new same-scope Auto root.  This is the bounded
    // long-task rollover path: no live lease, no branch rewrite, no V2 scope or
    // budget widening, and the old root/terminal lineage stays in the receipt.
    const rolloverTaskId = '00000000-0000-4000-8000-000000000347'
    const rolloverSession = 'validation-budget-root-rollover-session'
    const rolloverControl = controlReceipt({
      prompt: '@rocky 自动推进到当前任务完成',
      mode: 'auto',
      sessionKey: rolloverSession,
      taskId: rolloverTaskId,
      contextEpoch,
      suffix: 'root-rollover',
      nowMs: NOW,
      ttlMs: 1000
    })
    const rolloverSeed = seedTask({
      activeRoot,
      taskId: rolloverTaskId,
      sessionKey: rolloverSession,
      control: rolloverControl
    })
    const {
      repoRoot: rolloverGitRoot,
      currentHead,
      previousHead,
      ancestorHead,
      commitFiles
    } = createGitLineageFixture(fixtureRoot)
    const rolloverRootPlan = fixturePlan(rolloverTaskId, contextEpoch, 'root-rollover-parent')
    const rolloverRootCandidate = { ...fixtureCandidate('root-rollover-parent'), head: ancestorHead }
    const rolloverContext = authorityContext({
      identity: rolloverSeed.identity,
      sessionKey: rolloverSession,
      contextEpoch,
      control: rolloverControl
    })
    const rolloverRoot = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 500 },
      plan: rolloverRootPlan,
      candidate: rolloverRootCandidate,
      authorityContext: rolloverContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    const rolloverStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity: rolloverSeed.identity,
      taskRecoveryKey: rolloverTaskId,
      sessionKey: rolloverSession
    })
    persistRunTerminal({
      store: rolloverStore,
      plan: rolloverRoot.plan,
      candidate: rolloverRootCandidate,
      authority: rolloverRoot.authority,
      control: rolloverControl,
      taskId: rolloverTaskId,
      contextEpoch,
      failedNode: 'validation-authority'
    })
    const rolloverState = readTaskRecoveryState({
      metaDir: rolloverSeed.metaDir,
      identity: rolloverSeed.identity,
      sessionKey: rolloverSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const rolloverNextPlan = fixturePlan(rolloverTaskId, contextEpoch, 'root-rollover-child')
    const rolloverNextCandidate = { ...fixtureCandidate('root-rollover-child'), head: previousHead }
    const rolloverNextContext = authorityContext({
      identity: rolloverSeed.identity,
      sessionKey: rolloverSession,
      contextEpoch,
      control: rolloverControl,
      state: rolloverState.state
    })
    const widenedRolloverPlan = fixturePlan(rolloverTaskId, contextEpoch, 'root-rollover-widened', {
      selectedNodes: [{ id: 'validation-budget-control', writeScopes: [] }]
    })
    widenedRolloverPlan.affectedBoundaries = ['validation-budget-control']
    for (const execute of [false, true]) {
      expectCode(() => resolveAiBudgetAuthority({
        options: { nowMs: NOW + 2000 },
        plan: widenedRolloverPlan,
        candidate: rolloverNextCandidate,
        authorityContext: rolloverNextContext,
        activeRoot,
        execute,
        gitRepoRoot: rolloverGitRoot
      }), 'VALIDATION_CONTINUATION_SCOPE_WIDENED')
    }
    const narrowedRolloverPlan = fixturePlan(rolloverTaskId, contextEpoch, 'root-rollover-narrowed', {
      selectedNodes: []
    })
    narrowedRolloverPlan.affectedBoundaries = []
    for (const execute of [false, true]) {
      assert.throws(() => resolveAiBudgetAuthority({
        options: { nowMs: NOW + 2000 },
        plan: narrowedRolloverPlan,
        candidate: rolloverNextCandidate,
        authorityContext: rolloverNextContext,
        activeRoot,
        execute,
        gitRepoRoot: rolloverGitRoot
      }), error => error instanceof ValidationDagError &&
        error.code === 'VALIDATION_CONTINUATION_FOOTPRINT_UNPROVEN' &&
        error.details?.rootRolloverReason === 'auto-root-rollover-scope-changed',
      'a strict descendant cannot replace the immutable root with a narrowed validation scope')
    }
    const rolloverPreview = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 2000 },
      plan: rolloverNextPlan,
      candidate: rolloverNextCandidate,
      authorityContext: rolloverNextContext,
      activeRoot,
      execute: false,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(rolloverPreview.decision, 'auto-root-rollover-plan-only')
    const rolloverExecution = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 2000 },
      plan: rolloverNextPlan,
      candidate: rolloverNextCandidate,
      authorityContext: rolloverNextContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(rolloverExecution.decision, 'auto-root-rollover-authorized')
    assert.strictEqual(rolloverExecution.authority.parentRootReceiptDigest, rolloverRoot.authority.receiptDigest)
    assert.match(rolloverExecution.authority.parentTerminalDigest, /^[a-f0-9]{64}$/)
    assert.strictEqual(rolloverExecution.authority.rootRolloverReason, 'strict-descendant-same-scope')
    assert.notStrictEqual(rolloverExecution.authority.receiptDigest, rolloverRoot.authority.receiptDigest)
    persistRunTerminal({
      store: rolloverStore,
      plan: rolloverExecution.plan,
      candidate: rolloverNextCandidate,
      authority: rolloverExecution.authority,
      control: rolloverControl,
      taskId: rolloverTaskId,
      contextEpoch,
      terminalStatus: 'completed'
    })
    const completedRolloverState = readTaskRecoveryState({
      metaDir: rolloverSeed.metaDir,
      identity: rolloverSeed.identity,
      sessionKey: rolloverSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const completedRolloverPlan = fixturePlan(rolloverTaskId, contextEpoch, 'root-rollover-completed-child')
    const completedRolloverCandidate = {
      ...fixtureCandidate('root-rollover-completed-child'),
      head: currentHead
    }
    const completedRolloverContext = authorityContext({
      identity: rolloverSeed.identity,
      sessionKey: rolloverSession,
      contextEpoch,
      control: rolloverControl,
      state: completedRolloverState.state
    })
    const completedRolloverPreview = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 3000 },
      plan: completedRolloverPlan,
      candidate: completedRolloverCandidate,
      authorityContext: completedRolloverContext,
      activeRoot,
      execute: false,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(completedRolloverPreview.decision, 'auto-root-rollover-plan-only')
    const completedRolloverExecution = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 3000 },
      plan: completedRolloverPlan,
      candidate: completedRolloverCandidate,
      authorityContext: completedRolloverContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(completedRolloverExecution.decision, 'auto-root-rollover-authorized')
    assert.strictEqual(completedRolloverExecution.authority.parentRootReceiptDigest,
      rolloverExecution.authority.receiptDigest)
    assert.match(completedRolloverExecution.authority.parentTerminalDigest, /^[a-f0-9]{64}$/)

    // A real later Auto turn has a new server-owned control receipt and a new
    // ContextRead epoch.  Fresh current authority may rebind those two fields,
    // but only for the same task/project/root/session/revocation and an exact
    // validation scope on a strict descendant commit.
    const reboundTaskId = '00000000-0000-4000-8000-000000000348'
    const reboundSession = 'validation-budget-root-rebind-session'
    const reboundRootControl = controlReceipt({
      prompt: '@rocky 自动推进到当前任务完成',
      mode: 'auto',
      sessionKey: reboundSession,
      taskId: reboundTaskId,
      contextEpoch,
      suffix: 'root-rebind-parent',
      nowMs: NOW
    })
    const reboundSeed = seedTask({
      activeRoot,
      taskId: reboundTaskId,
      sessionKey: reboundSession,
      control: reboundRootControl
    })
    const reboundRootPlan = fixturePlan(reboundTaskId, contextEpoch, 'root-rebind-parent')
    const reboundRootCandidate = { ...fixtureCandidate('root-rebind-parent'), head: ancestorHead }
    const reboundRootContext = authorityContext({
      identity: reboundSeed.identity,
      sessionKey: reboundSession,
      contextEpoch,
      control: reboundRootControl
    })
    const reboundRoot = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 250 },
      plan: reboundRootPlan,
      candidate: reboundRootCandidate,
      authorityContext: reboundRootContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    const reboundStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity: reboundSeed.identity,
      taskRecoveryKey: reboundTaskId,
      sessionKey: reboundSession
    })
    persistRunTerminal({
      store: reboundStore,
      plan: reboundRoot.plan,
      candidate: reboundRootCandidate,
      authority: reboundRoot.authority,
      control: reboundRootControl,
      taskId: reboundTaskId,
      contextEpoch,
      failedNode: 'validation-authority'
    })
    const reboundContextEpoch = 'ctx-validation-budget-current-auto-rebind'
    const reboundCurrentControl = controlReceipt({
      prompt: '@rocky 继续当前任务并自动完成',
      mode: 'auto',
      sessionKey: reboundSession,
      taskId: reboundTaskId,
      contextEpoch: reboundContextEpoch,
      suffix: 'root-rebind-current',
      nowMs: NOW + 900
    })
    updateControl({
      activeRoot,
      identity: reboundSeed.identity,
      metaDir: reboundSeed.metaDir,
      sessionKey: reboundSession,
      control: reboundCurrentControl
    })
    const reboundState = readTaskRecoveryState({
      metaDir: reboundSeed.metaDir,
      identity: reboundSeed.identity,
      sessionKey: reboundSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const reboundNextPlan = fixturePlan(reboundTaskId, reboundContextEpoch, 'root-rebind-child')
    const reboundNextCandidate = { ...fixtureCandidate('root-rebind-child'), head: previousHead }
    const reboundNextContext = authorityContext({
      identity: reboundSeed.identity,
      sessionKey: reboundSession,
      contextEpoch: reboundContextEpoch,
      control: reboundCurrentControl,
      state: reboundState.state
    })
    const reboundPreview = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 1500 },
      plan: reboundNextPlan,
      candidate: reboundNextCandidate,
      authorityContext: reboundNextContext,
      activeRoot,
      execute: false,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(reboundPreview.decision, 'auto-root-rollover-plan-only')
    const reboundExecution = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 1500 },
      plan: reboundNextPlan,
      candidate: reboundNextCandidate,
      authorityContext: reboundNextContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(reboundExecution.decision, 'auto-root-rollover-authorized')
    assert.strictEqual(
      reboundExecution.authority.rootRolloverReason,
      'strict-descendant-exact-scope-current-auto-rebind'
    )
    assert.strictEqual(reboundExecution.authority.parentRootReceiptDigest, reboundRoot.authority.receiptDigest)
    assert.notStrictEqual(reboundExecution.authority.autoAuthorityRef, reboundRoot.authority.autoAuthorityRef)
    assert.strictEqual(reboundExecution.authority.contextEpoch, reboundContextEpoch)

    // A later, distinct user Auto instruction is new root authority rather than
    // a child continuation.  It may bind the current exact V2 impact scope even
    // when batch repairs changed boundaries or nodes, but only after the parent
    // is terminal and while task/project/root/session/revocation stay exact.
    const rescopeTaskId = '00000000-0000-4000-8000-000000000349'
    const rescopeSession = 'validation-budget-root-rescope-session'
    const rescopeRootControl = controlReceipt({
      prompt: '@rocky 自动执行当前受影响范围',
      mode: 'auto',
      sessionKey: rescopeSession,
      taskId: rescopeTaskId,
      contextEpoch,
      suffix: 'root-rescope-parent',
      nowMs: NOW
    })
    const rescopeSeed = seedTask({
      activeRoot,
      taskId: rescopeTaskId,
      sessionKey: rescopeSession,
      control: rescopeRootControl
    })
    const rescopeRootPlan = fixturePlan(rescopeTaskId, contextEpoch, 'root-rescope-parent')
    const rescopeRootCandidate = { ...fixtureCandidate('root-rescope-parent'), head: ancestorHead }
    const rescopeRootContext = authorityContext({
      identity: rescopeSeed.identity,
      sessionKey: rescopeSession,
      contextEpoch,
      control: rescopeRootControl
    })
    const rescopeRoot = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 250 },
      plan: rescopeRootPlan,
      candidate: rescopeRootCandidate,
      authorityContext: rescopeRootContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    const rescopeStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity: rescopeSeed.identity,
      taskRecoveryKey: rescopeTaskId,
      sessionKey: rescopeSession
    })
    persistRunTerminal({
      store: rescopeStore,
      plan: rescopeRoot.plan,
      candidate: rescopeRootCandidate,
      authority: rescopeRoot.authority,
      control: rescopeRootControl,
      taskId: rescopeTaskId,
      contextEpoch,
      failedNode: 'validation-authority'
    })
    const prematureContextEpoch = 'ctx-validation-budget-premature-auto-rescope'
    const prematureRescopeControl = controlReceipt({
      prompt: '@rocky 提前重建验证范围',
      mode: 'auto',
      sessionKey: rescopeSession,
      taskId: rescopeTaskId,
      contextEpoch: prematureContextEpoch,
      suffix: 'root-rescope-premature',
      nowMs: NOW + 500
    })
    updateControl({
      activeRoot,
      identity: rescopeSeed.identity,
      metaDir: rescopeSeed.metaDir,
      sessionKey: rescopeSession,
      control: prematureRescopeControl
    })
    const prematureRescopeState = readTaskRecoveryState({
      metaDir: rescopeSeed.metaDir,
      identity: rescopeSeed.identity,
      sessionKey: rescopeSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const prematureRescopePlan = fixturePlan(rescopeTaskId, prematureContextEpoch, 'root-rescope-premature', {
      selectedNodes: [
        { id: 'validation-authority', writeScopes: [] },
        { id: 'validation-budget-control', writeScopes: [] }
      ]
    })
    prematureRescopePlan.affectedBoundaries = ['validation-authority', 'validation-budget-control']
    const rescopeNextCandidate = { ...fixtureCandidate('root-rescope-child'), head: previousHead }
    for (const execute of [false, true]) {
      expectCode(() => resolveAiBudgetAuthority({
        options: { nowMs: NOW + 750 },
        plan: prematureRescopePlan,
        candidate: rescopeNextCandidate,
        authorityContext: authorityContext({
          identity: rescopeSeed.identity,
          sessionKey: rescopeSession,
          contextEpoch: prematureContextEpoch,
          control: prematureRescopeControl,
          state: prematureRescopeState.state
        }),
        activeRoot,
        execute,
        gitRepoRoot: rolloverGitRoot
      }), 'VALIDATION_CONTINUATION_SCOPE_WIDENED')
    }
    const rescopeContextEpoch = 'ctx-validation-budget-current-auto-rescope'
    const currentRescopeControl = controlReceipt({
      prompt: '@rocky 按当前完整影响范围自动推进',
      mode: 'auto',
      sessionKey: rescopeSession,
      taskId: rescopeTaskId,
      contextEpoch: rescopeContextEpoch,
      suffix: 'root-rescope-current',
      nowMs: NOW + 1500
    })
    updateControl({
      activeRoot,
      identity: rescopeSeed.identity,
      metaDir: rescopeSeed.metaDir,
      sessionKey: rescopeSession,
      control: currentRescopeControl
    })
    const currentRescopeState = readTaskRecoveryState({
      metaDir: rescopeSeed.metaDir,
      identity: rescopeSeed.identity,
      sessionKey: rescopeSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const currentRescopePlan = fixturePlan(rescopeTaskId, rescopeContextEpoch, 'root-rescope-current', {
      selectedNodes: prematureRescopePlan.selectedNodes
    })
    currentRescopePlan.affectedBoundaries = prematureRescopePlan.affectedBoundaries
    const currentRescopeContext = authorityContext({
      identity: rescopeSeed.identity,
      sessionKey: rescopeSession,
      contextEpoch: rescopeContextEpoch,
      control: currentRescopeControl,
      state: currentRescopeState.state
    })
    const rescopePreview = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 2000 },
      plan: currentRescopePlan,
      candidate: rescopeNextCandidate,
      authorityContext: currentRescopeContext,
      activeRoot,
      execute: false,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(rescopePreview.decision, 'auto-root-rollover-plan-only')
    const rescopeExecution = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 2000 },
      plan: currentRescopePlan,
      candidate: rescopeNextCandidate,
      authorityContext: currentRescopeContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(rescopeExecution.decision, 'auto-root-rollover-authorized')
    assert.strictEqual(rescopeExecution.authority.rootRolloverReason, 'strict-descendant-current-auto-rescope')
    assert.strictEqual(rescopeExecution.authority.parentRootReceiptDigest, rescopeRoot.authority.receiptDigest)
    assert.notStrictEqual(rescopeExecution.authority.autoAuthorityRef, rescopeRoot.authority.autoAuthorityRef)
    assert.strictEqual(rescopeExecution.authority.contextEpoch, rescopeContextEpoch)

    // A clean strict-descendant repair commit is an immutable server-observed
    // footprint when the host could not supply a mutation closeout.  It may use
    // the same Auto root for one bounded child continuation; it must not create
    // a replacement root or accept paths outside the commit diff.
    const committedRepairTaskId = '00000000-0000-4000-8000-000000000350'
    const committedRepairSession = 'validation-budget-committed-repair-session'
    const committedRepairControl = controlReceipt({
      prompt: '@rocky 自动完成当前任务的批量修复与统一验证',
      mode: 'auto',
      sessionKey: committedRepairSession,
      taskId: committedRepairTaskId,
      contextEpoch,
      suffix: 'committed-repair-root',
      nowMs: NOW
    })
    const committedRepairSeed = seedTask({
      activeRoot,
      taskId: committedRepairTaskId,
      sessionKey: committedRepairSession,
      control: committedRepairControl
    })
    const committedRepairRootPlan = fixturePlan(committedRepairTaskId, contextEpoch, 'committed-repair-root')
    const committedRepairRootCandidate = {
      ...fixtureCandidate('committed-repair-root'),
      stable: true,
      head: ancestorHead,
      changedFiles: [commitFiles[0]],
      dirtyIdentities: []
    }
    const committedRepairRootContext = authorityContext({
      identity: committedRepairSeed.identity,
      sessionKey: committedRepairSession,
      contextEpoch,
      control: committedRepairControl
    })
    const committedRepairRoot = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 100 },
      plan: committedRepairRootPlan,
      candidate: committedRepairRootCandidate,
      authorityContext: committedRepairRootContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    const committedRepairStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity: committedRepairSeed.identity,
      taskRecoveryKey: committedRepairTaskId,
      sessionKey: committedRepairSession
    })
    persistRunTerminal({
      store: committedRepairStore,
      plan: committedRepairRoot.plan,
      candidate: committedRepairRootCandidate,
      authority: committedRepairRoot.authority,
      control: committedRepairControl,
      taskId: committedRepairTaskId,
      contextEpoch,
      failedNode: 'validation-authority'
    })
    const committedRepairState = readTaskRecoveryState({
      metaDir: committedRepairSeed.metaDir,
      identity: committedRepairSeed.identity,
      sessionKey: committedRepairSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const committedRepairPlan = fixturePlan(committedRepairTaskId, contextEpoch, 'committed-repair-child', {
      selectedNodes: [
        { id: 'validation-authority', writeScopes: [] },
        { id: 'validation-budget-control', writeScopes: [] }
      ]
    })
    committedRepairPlan.budgetCard = {
      ...committedRepairPlan.budgetCard,
      estimatedDurationMs: committedRepairRootPlan.budgetCard.estimatedDurationMs + 20000,
      hardTimeoutUpperBoundMs: committedRepairRootPlan.budgetCard.hardTimeoutUpperBoundMs + 40000,
      logBudgetBytes: committedRepairRootPlan.budgetCard.logBudgetBytes + 128
    }
    const committedRepairCandidate = {
      ...fixtureCandidate('committed-repair-child'),
      stable: true,
      head: previousHead,
      changedFiles: [commitFiles[0], commitFiles[1]],
      dirtyIdentities: []
    }
    const committedRepairContext = authorityContext({
      identity: committedRepairSeed.identity,
      sessionKey: committedRepairSession,
      contextEpoch,
      control: committedRepairControl,
      state: committedRepairState.state
    })
    expectCode(() => resolveAiBudgetAuthority({
      options: { nowMs: NOW + 2000 },
      plan: committedRepairPlan,
      candidate: {
        ...committedRepairCandidate,
        changedFiles: [...committedRepairCandidate.changedFiles, 'not-in-commit.txt']
      },
      authorityContext: committedRepairContext,
      activeRoot,
      execute: false,
      gitRepoRoot: rolloverGitRoot
    }), 'VALIDATION_CONTINUATION_FOOTPRINT_UNPROVEN')
    const committedRepairOverBudgetPlan = {
      ...committedRepairPlan,
      budgetCard: {
        ...committedRepairPlan.budgetCard,
        digest: sha256('committed-repair-over-budget'),
        hardTimeoutUpperBoundMs: committedRepairRootPlan.budgetCard.hardTimeoutUpperBoundMs + 70000
      }
    }
    expectCode(() => resolveAiBudgetAuthority({
      options: { nowMs: NOW + 2000 },
      plan: committedRepairOverBudgetPlan,
      candidate: committedRepairCandidate,
      authorityContext: committedRepairContext,
      activeRoot,
      execute: false,
      gitRepoRoot: rolloverGitRoot
    }), 'VALIDATION_CONTINUATION_BUDGET_EXCEEDED')
    const committedRepairPreview = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 2000 },
      plan: committedRepairPlan,
      candidate: committedRepairCandidate,
      authorityContext: committedRepairContext,
      activeRoot,
      execute: false,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(committedRepairPreview.decision, 'root-continuation-plan-only')
    const committedRepairExecution = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 2000 },
      plan: committedRepairPlan,
      candidate: committedRepairCandidate,
      authorityContext: committedRepairContext,
      activeRoot,
      execute: true,
      gitRepoRoot: rolloverGitRoot
    })
    assert.strictEqual(committedRepairExecution.decision, 'auto-continuation-authorized')
    assert.strictEqual(committedRepairExecution.authority.repairProofKind, 'committed-repair-diff')
    assert.strictEqual(committedRepairExecution.authority.retryOrdinal, 1)
    assert.strictEqual(committedRepairStore.readRootBudgetConfirmation().rootBudgetConfirmation.receiptDigest,
      committedRepairRoot.authority.receiptDigest, 'committed repair must preserve the immutable root')

    const exactRetryTaskId = '00000000-0000-4000-8000-000000000346'
    const exactRetrySession = 'validation-budget-exact-retry-session'
    const exactRetryControl = controlReceipt({
      prompt: '@rocky 自动执行同范围验证',
      mode: 'auto',
      sessionKey: exactRetrySession,
      taskId: exactRetryTaskId,
      contextEpoch,
      suffix: 'exact-retry'
    })
    const exactRetrySeed = seedTask({
      activeRoot,
      taskId: exactRetryTaskId,
      sessionKey: exactRetrySession,
      control: exactRetryControl
    })
    const exactRetryPlan = fixturePlan(exactRetryTaskId, contextEpoch, 'exact-retry-root')
    const exactRetryCandidate = { ...fixtureCandidate('exact-retry-root'), stable: true }
    const exactRetryContext = authorityContext({
      identity: exactRetrySeed.identity,
      sessionKey: exactRetrySession,
      contextEpoch,
      control: exactRetryControl
    })
    const exactRetryRoot = resolveAiBudgetAuthority({
      options: {}, plan: exactRetryPlan, candidate: exactRetryCandidate,
      authorityContext: exactRetryContext, activeRoot, execute: true
    })
    const exactRetryStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity: exactRetrySeed.identity,
      taskRecoveryKey: exactRetryTaskId,
      sessionKey: exactRetrySession
    })
    persistRunTerminal({
      store: exactRetryStore,
      plan: exactRetryRoot.plan,
      candidate: exactRetryCandidate,
      authority: exactRetryRoot.authority,
      control: exactRetryControl,
      taskId: exactRetryTaskId,
      contextEpoch,
      failedNode: 'validation-authority'
    })
    const expiredExactRetryControl = controlReceipt({
      prompt: '@rocky 自动执行同范围验证',
      mode: 'auto',
      sessionKey: exactRetrySession,
      taskId: exactRetryTaskId,
      contextEpoch,
      suffix: 'exact-retry-expired',
      nowMs: NOW - 60000,
      ttlMs: 1
    })
    updateControl({
      activeRoot,
      identity: exactRetrySeed.identity,
      metaDir: exactRetrySeed.metaDir,
      sessionKey: exactRetrySession,
      control: expiredExactRetryControl
    })
    const expiredExactRetryState = readTaskRecoveryState({
      metaDir: exactRetrySeed.metaDir,
      identity: exactRetrySeed.identity,
      sessionKey: exactRetrySession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const expiredExactRetryContext = authorityContext({
      identity: exactRetrySeed.identity,
      sessionKey: exactRetrySession,
      contextEpoch,
      control: expiredExactRetryControl,
      state: expiredExactRetryState.state
    })
    const expiredPreview = resolveAiBudgetAuthority({
      options: {}, plan: exactRetryPlan, candidate: exactRetryCandidate,
      authorityContext: expiredExactRetryContext, activeRoot, execute: false
    })
    assert.strictEqual(expiredPreview.decision, 'root-continuation-plan-only')
    assert.strictEqual(exactRetryStore.readContinuationAuthorization().status, 'missing',
      'plan-only continuation preflight must not persist or consume child authority')
    const widenedPreviewPlan = fixturePlan(exactRetryTaskId, contextEpoch, 'exact-retry-widened-purpose', {
      verificationPurpose: 'delivery'
    })
    expectCode(() => resolveAiBudgetAuthority({
      options: {}, plan: widenedPreviewPlan, candidate: exactRetryCandidate,
      authorityContext: expiredExactRetryContext, activeRoot, execute: false
    }), 'VALIDATION_CONTINUATION_SCOPE_WIDENED')
    assert.strictEqual(exactRetryStore.readContinuationAuthorization().status, 'missing')
    const exactRetryFirst = resolveAiBudgetAuthority({
      options: {}, plan: exactRetryPlan, candidate: exactRetryCandidate,
      authorityContext: expiredExactRetryContext, activeRoot, execute: true
    })
    assert.strictEqual(exactRetryFirst.decision, 'auto-continuation-authorized')
    assert.strictEqual(exactRetryFirst.authority.repairProofKind, 'same-scope-retry')
    assert.strictEqual(exactRetryFirst.authority.retryOrdinal, 1)
    persistRunTerminal({
      store: exactRetryStore,
      plan: exactRetryFirst.plan,
      candidate: exactRetryCandidate,
      authority: exactRetryFirst.authority,
      control: exactRetryControl,
      taskId: exactRetryTaskId,
      contextEpoch,
      failedNode: 'validation-authority'
    })
    const exactRetrySecond = resolveAiBudgetAuthority({
      options: {}, plan: exactRetryPlan, candidate: exactRetryCandidate,
      authorityContext: expiredExactRetryContext, activeRoot, execute: true
    })
    assert.strictEqual(exactRetrySecond.decision, 'auto-continuation-authorized')
    assert.strictEqual(exactRetrySecond.authority.retryOrdinal, 2)
    persistRunTerminal({
      store: exactRetryStore,
      plan: exactRetrySecond.plan,
      candidate: exactRetryCandidate,
      authority: exactRetrySecond.authority,
      control: exactRetryControl,
      taskId: exactRetryTaskId,
      contextEpoch,
      failedNode: 'validation-authority'
    })
    expectCode(() => resolveAiBudgetAuthority({
      options: {}, plan: exactRetryPlan, candidate: exactRetryCandidate,
      authorityContext: expiredExactRetryContext, activeRoot, execute: true
    }), 'VALIDATION_CONTINUATION_RETRY_EXHAUSTED')

    const v3Plan = fixturePlan(autoTaskId, contextEpoch, 'v3', {
      verificationLevel: 'V3',
      verificationPurpose: 'full-audit'
    })
    expectCode(() => resolveAiBudgetAuthority({
      options: {}, plan: v3Plan, candidate, authorityContext: autoContext, activeRoot, execute: true
    }), 'VALIDATION_INDEPENDENT_V3_AUTHORITY_REQUIRED')

    const pauseControl = controlReceipt({
      prompt: '先暂停验证',
      mode: 'auto',
      sessionKey: autoSession,
      taskId: autoTaskId,
      contextEpoch,
      suffix: 'pause'
    })
    updateControl({ activeRoot, identity: autoSeed.identity, metaDir: autoSeed.metaDir, sessionKey: autoSession, control: pauseControl })
    expectCode(() => resolveAiBudgetAuthority({
      options: {},
      plan: autoPlan,
      candidate,
      authorityContext: authorityContext({
        identity: autoSeed.identity, sessionKey: autoSession, contextEpoch, control: pauseControl,
        state: { validationExecution: { revocationEpoch: 1 } }
      }),
      activeRoot,
      execute: true
    }), 'VALIDATION_CONTINUATION_REVOKED')
    const resumedAutoControl = controlReceipt({
      prompt: '@rocky 继续自动推进',
      mode: 'auto',
      sessionKey: autoSession,
      taskId: autoTaskId,
      contextEpoch,
      suffix: 'resume-auto'
    })
    updateControl({
      activeRoot,
      identity: autoSeed.identity,
      metaDir: autoSeed.metaDir,
      sessionKey: autoSession,
      control: resumedAutoControl
    })
    const resumedState = readTaskRecoveryState({
      metaDir: autoSeed.metaDir,
      identity: autoSeed.identity,
      sessionKey: autoSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const resumed = resolveAiBudgetAuthority({
      options: {},
      plan: autoPlan,
      candidate,
      authorityContext: authorityContext({
        identity: autoSeed.identity,
        sessionKey: autoSession,
        contextEpoch,
        control: resumedAutoControl,
        state: resumedState.state
      }),
      activeRoot,
      execute: true
    })
    assert.strictEqual(resumed.decision, 'auto-authorized')
    assert.strictEqual(resumed.authority.revocationEpoch, 1)

    const confirmTaskId = '00000000-0000-4000-8000-000000000362'
    const confirmSession = 'validation-confirm-session'
    const ordinaryControl = controlReceipt({
      prompt: '继续处理当前任务',
      mode: 'confirm',
      sessionKey: confirmSession,
      taskId: confirmTaskId,
      contextEpoch,
      suffix: 'ordinary'
    })
    const confirmSeed = seedTask({ activeRoot, taskId: confirmTaskId, sessionKey: confirmSession, control: ordinaryControl })
    const confirmPlan = fixturePlan(confirmTaskId, contextEpoch, 'confirm-root')
    const confirmCandidate = fixtureCandidate('confirm-root')
    const ordinaryContext = authorityContext({
      identity: confirmSeed.identity,
      sessionKey: confirmSession,
      contextEpoch,
      control: ordinaryControl
    })
    assert.strictEqual(resolveAiBudgetAuthority({
      options: {}, plan: confirmPlan, candidate: confirmCandidate,
      authorityContext: ordinaryContext, activeRoot, execute: false
    }).decision, 'awaiting-current-budget-confirmation')
    expectCode(() => resolveAiBudgetAuthority({
      options: {}, plan: confirmPlan, candidate: confirmCandidate,
      authorityContext: ordinaryContext, activeRoot, execute: true
    }), 'VALIDATION_BUDGET_APPROVAL_REQUIRED')
    const confirmControl = controlReceipt({
      prompt: '确认当前验证卡',
      mode: 'confirm',
      sessionKey: confirmSession,
      taskId: confirmTaskId,
      contextEpoch,
      suffix: 'confirm'
    })
    updateControl({ activeRoot, identity: confirmSeed.identity, metaDir: confirmSeed.metaDir, sessionKey: confirmSession, control: confirmControl })
    const confirmed = resolveAiBudgetAuthority({
      options: {},
      plan: confirmPlan,
      candidate: confirmCandidate,
      authorityContext: authorityContext({
        identity: confirmSeed.identity,
        sessionKey: confirmSession,
        contextEpoch,
        control: confirmControl
      }),
      activeRoot,
      execute: true
    })
    assert.strictEqual(confirmed.decision, 'user-confirmed')
    assert.strictEqual(confirmed.authority.authorityKind, 'user-confirmation')

    const beforeCardinality = countFiles(activeRoot)
    for (let index = 0; index < 100; index += 1) {
      const changingPlan = fixturePlan(confirmTaskId, contextEpoch, `bounded-${index}`)
      resolveAiBudgetAuthority({
        options: {},
        plan: changingPlan,
        candidate: fixtureCandidate(`bounded-${index}`),
        authorityContext: ordinaryContext,
        activeRoot,
        execute: false
      })
    }
    assert.strictEqual(countFiles(activeRoot), beforeCardinality,
      '100 pending BudgetCard replacements must reuse the same TaskRecoveryStoreV5 A/B files')
    const recovered = readTaskRecoveryState({
      metaDir: confirmSeed.metaDir,
      identity: confirmSeed.identity,
      sessionKey: confirmSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    assert.strictEqual(recovered.status, 'fresh')
    assert.strictEqual(recovered.state.validationExecution.pendingBudgetCard.schemaVersion, 'PendingBudgetCardBindingV1')
    const confirmStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity: confirmSeed.identity,
      taskRecoveryKey: confirmTaskId,
      sessionKey: confirmSession
    })
    const currentPending = confirmStore.readPendingBudgetCard().pendingBudgetCard
    const conflictingPlan = fixturePlan(confirmTaskId, contextEpoch, 'cas-conflict')
    const conflictingPending = createPendingBudgetCardBinding({
      plan: conflictingPlan,
      candidate: fixtureCandidate('cas-conflict'),
      repoRoot: REPO_ROOT,
      projectRootIdentity: validationProjectRootIdentity(REPO_ROOT),
      project: 'devcodex',
      taskRecoveryKey: confirmTaskId,
      hostSessionDigest: currentPending.hostSessionDigest,
      contextEpoch,
      stateRevision: currentPending.stateRevision + 1
    })
    const casConflict = confirmStore.writePendingBudgetCard(conflictingPending, {
      expectedBindingDigest: 'f'.repeat(64),
      expectedStateRevision: currentPending.stateRevision
    })
    assert.strictEqual(casConflict.status, 'error')
    assert.strictEqual(casConflict.errorCode, 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT')
    assert.strictEqual(confirmStore.readPendingBudgetCard().pendingBudgetCard.bindingDigest,
      currentPending.bindingDigest, 'failed pending CAS must preserve the unique current binding')
    process.stdout.write('test-validation-budget-control: ok\n')
  } finally {
    if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1') {
      process.stderr.write(`[test-validation-budget-control] retained ${fixtureRoot}\n`)
    } else {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  }
}

main()
