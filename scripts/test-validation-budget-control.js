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
  createFormalTaskExecutionPreflight,
  createPendingBudgetCardBinding,
  createVerificationExecutionLease,
  planBudgetProjection
} = require('./lib/validation-execution-authority')
const {
  createCliLease,
  resolveAiBudgetAuthority: resolveAiBudgetAuthorityRuntime,
  resolveFormalTaskExecutionPreflight,
  resolvePendingBudgetPlanIdentity
} = require('./run-validation')

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
  const requestSourceRef = overrides.requestSourceRef || `fixture-plan-request:${suffix}`
  const identitySeed = stableStringify({ suffix, contextEpoch, requestSourceRef })
  return {
    schemaVersion: 'ValidationPlanV3',
    planDigest: sha256(`plan-${identitySeed}`),
    changedScopeDigest: sha256(`scope-${suffix}`),
    requestDigest: sha256(`request-${identitySeed}`),
    riskClass: overrides.riskClass || 'normal',
    verificationLevel: overrides.verificationLevel || 'V2',
    verificationPurpose: overrides.verificationPurpose || 'boundary',
    verificationIntent: {
      project: 'devcodex',
      taskRecoveryKey: taskId,
      contextEpoch,
      requestSourceRef
    },
    affectedBoundaries: overrides.affectedBoundaries || ['validation-authority'],
    selectedNodes,
    selectedNodeCount: selectedNodes.length,
    budgetCard: {
      schemaVersion: 'BudgetCardV1',
      digest: sha256(`budget-${identitySeed}`),
      estimatedDurationMs: overrides.estimatedDurationMs || 700000,
      hardTimeoutUpperBoundMs: overrides.hardTimeoutUpperBoundMs || 1200000,
      logBudgetBytes: overrides.logBudgetBytes || 4096,
      heavyNodeIds: overrides.heavyNodeIds || ['validation-authority'],
      sideEffectCategories: overrides.sideEffectCategories || [],
      confirmationRequired: true,
      status: 'awaiting-confirmation'
    },
    executionState: 'awaiting-budget'
  }
}

function fixtureCandidate(suffix = 'root', overrides = {}) {
  const changedFiles = overrides.changedFiles || ['scripts/run-validation.js']
  const deletedFiles = new Set(overrides.deletedFiles || [])
  return {
    candidateId: `validation-candidate-${suffix}`,
    stable: overrides.stable === true,
    head: overrides.head || 'a'.repeat(40),
    changedSource: 'fixture',
    changedFiles,
    dirtyIdentities: changedFiles.map(file => deletedFiles.has(file)
      ? { path: file, deleted: true }
      : { path: file, digest: sha256(`dirty-${suffix}-${file}`) })
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

function resolveAiBudgetAuthority(input) {
  const fixtureDigest = suffix => sha256(`${suffix}:${input.authorityContext.taskRecoveryKey}`)
  input.authorityContext.formalTaskExecutionPreflight = createFormalTaskExecutionPreflight({
      authorityRead: {
        taskId: input.authorityContext.taskRecoveryKey,
        project: 'devcodex',
        projectRootIdentityDigest: fixtureDigest('admitted-project-root'),
        admissionId: `admission-${fixtureDigest('admission-id').slice(0, 40)}`,
        admissionGeneration: 1,
        admissionDigest: fixtureDigest('admission'),
        ownerLeaseDigest: fixtureDigest('owner'),
        canonicalOverviewDigest: fixtureDigest('overview'),
        canonicalRevisionDigest: fixtureDigest('revision'),
        cpChainDigest: fixtureDigest('cp-chain'),
        currentCpDigests: { CP2: fixtureDigest('cp2'), CP3: fixtureDigest('cp3') },
        resumeReadiness: 'canonical-ready',
        confirmationReachability: 'next-turn-card-confirmation'
      },
      validationProjectRootDigest: validationProjectRootIdentity(input.gitRepoRoot || REPO_ROOT).digest,
      candidate: input.candidate,
      plan: input.plan,
      observedAt: new Date(NOW).toISOString()
  }, { nowMs: NOW })
  return resolveAiBudgetAuthorityRuntime(input)
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
    const mismatchedDigestControl = controlReceipt({
      prompt: `确认当前验证卡 ${'f'.repeat(64)}`,
      mode: 'confirm',
      sessionKey: confirmSession,
      taskId: confirmTaskId,
      contextEpoch,
      suffix: 'confirm-mismatched-digest'
    })
    updateControl({
      activeRoot,
      identity: confirmSeed.identity,
      metaDir: confirmSeed.metaDir,
      sessionKey: confirmSession,
      control: mismatchedDigestControl
    })
    const mismatchedPreview = resolveAiBudgetAuthority({
      options: {},
      plan: confirmPlan,
      candidate: confirmCandidate,
      authorityContext: authorityContext({
        identity: confirmSeed.identity,
        sessionKey: confirmSession,
        contextEpoch,
        control: mismatchedDigestControl
      }),
      activeRoot,
      execute: false
    })
    assert.strictEqual(mismatchedPreview.decision, 'awaiting-current-budget-confirmation')
    assert.strictEqual(mismatchedPreview.pending.budgetDigest, confirmPlan.budgetCard.digest)
    expectCode(() => resolveAiBudgetAuthority({
      options: {},
      plan: confirmPlan,
      candidate: confirmCandidate,
      authorityContext: authorityContext({
        identity: confirmSeed.identity,
        sessionKey: confirmSession,
        contextEpoch,
        control: mismatchedDigestControl
      }),
      activeRoot,
      execute: true
    }), 'VALIDATION_CONFIRMED_BUDGET_DIGEST_MISMATCH')
    const confirmControl = controlReceipt({
      prompt: `\`确认当前验证卡 ${confirmPlan.budgetCard.digest}\``,
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

    const intentTaskId = '00000000-0000-4000-8000-000000000369'
    const intentSession = 'validation-intent-confirm-session'
    const intentOrdinaryControl = controlReceipt({
      prompt: '继续处理当前任务',
      mode: 'confirm',
      sessionKey: intentSession,
      taskId: intentTaskId,
      contextEpoch,
      suffix: 'intent-ordinary'
    })
    const intentSeed = seedTask({
      activeRoot,
      taskId: intentTaskId,
      sessionKey: intentSession,
      control: intentOrdinaryControl
    })
    const intentPlan = fixturePlan(intentTaskId, contextEpoch, 'intent-confirm-root')
    const intentCandidate = fixtureCandidate('intent-confirm-root')
    assert.strictEqual(resolveAiBudgetAuthority({
      options: {},
      plan: intentPlan,
      candidate: intentCandidate,
      authorityContext: authorityContext({
        identity: intentSeed.identity,
        sessionKey: intentSession,
        contextEpoch,
        control: intentOrdinaryControl
      }),
      activeRoot,
      execute: false
    }).decision, 'awaiting-current-budget-confirmation')
    const negativeIntentControl = controlReceipt({
      prompt: '不要确认当前验证卡',
      mode: 'confirm',
      sessionKey: intentSession,
      taskId: intentTaskId,
      contextEpoch,
      suffix: 'intent-negative'
    })
    assert.strictEqual(negativeIntentControl.action, 'none')
    updateControl({
      activeRoot,
      identity: intentSeed.identity,
      metaDir: intentSeed.metaDir,
      sessionKey: intentSession,
      control: negativeIntentControl
    })
    expectCode(() => resolveAiBudgetAuthority({
      options: {},
      plan: intentPlan,
      candidate: intentCandidate,
      authorityContext: authorityContext({
        identity: intentSeed.identity,
        sessionKey: intentSession,
        contextEpoch,
        control: negativeIntentControl
      }),
      activeRoot,
      execute: true
    }), 'VALIDATION_BUDGET_APPROVAL_REQUIRED')
    const bareIntentControl = controlReceipt({
      prompt: '确认',
      mode: 'confirm',
      sessionKey: intentSession,
      taskId: intentTaskId,
      contextEpoch,
      suffix: 'intent-bare-confirm'
    })
    updateControl({
      activeRoot,
      identity: intentSeed.identity,
      metaDir: intentSeed.metaDir,
      sessionKey: intentSession,
      control: bareIntentControl
    })
    const bareIntentConfirmed = resolveAiBudgetAuthority({
      options: {},
      plan: intentPlan,
      candidate: intentCandidate,
      authorityContext: authorityContext({
        identity: intentSeed.identity,
        sessionKey: intentSession,
        contextEpoch,
        control: bareIntentControl
      }),
      activeRoot,
      execute: true
    })
    assert.strictEqual(bareIntentConfirmed.decision, 'user-confirmed')
    assert.strictEqual(bareIntentConfirmed.authority.authorityKind, 'user-confirmation')

    const expiredPlanTaskId = '00000000-0000-4000-8000-000000000370'
    const expiredPlanSession = 'validation-expired-plan-only-session'
    const expiredPlanPriorControlSession = 'validation-expired-plan-only-prior-session'
    const expiredPlanEpoch = 'context-expired-plan-only'
    const expiredPlanControl = controlReceipt({
      prompt: '确认当前验证卡，然后继续修复',
      mode: 'confirm',
      sessionKey: expiredPlanPriorControlSession,
      taskId: expiredPlanTaskId,
      contextEpoch: expiredPlanEpoch,
      suffix: 'expired-plan-only',
      nowMs: NOW - 60000,
      ttlMs: 1
    })
    assert.strictEqual(expiredPlanControl.action, 'confirm-current-budget')
    const expiredPlanSeed = seedTask({
      activeRoot,
      taskId: expiredPlanTaskId,
      sessionKey: expiredPlanSession,
      control: expiredPlanControl
    })
    const expiredPlan = fixturePlan(expiredPlanTaskId, expiredPlanEpoch, 'expired-plan-only', {
      requestSourceRef: `validation-control:${expiredPlanControl.receiptDigest}`
    })
    const expiredPlanCandidate = fixtureCandidate('expired-plan-only')
    const expiredPlanContext = authorityContext({
      identity: expiredPlanSeed.identity,
      sessionKey: expiredPlanSession,
      contextEpoch: expiredPlanEpoch,
      control: expiredPlanControl
    })
    const expiredPlanPreview = resolveAiBudgetAuthority({
      options: { nowMs: NOW },
      plan: expiredPlan,
      candidate: expiredPlanCandidate,
      authorityContext: expiredPlanContext,
      activeRoot,
      execute: false
    })
    assert.strictEqual(expiredPlanPreview.decision, 'confirmation-stale-new-card')
    assert.deepStrictEqual(expiredPlanPreview.controlErrors, ['validation-control-ingress-expired'])
    assert.strictEqual(expiredPlanPreview.pending.budgetDigest, expiredPlan.budgetCard.digest)
    assert.strictEqual(expiredPlanPreview.pending.hostSessionDigest, sha256(expiredPlanSession),
      'a replacement card must bind the current task session, not an expired prior-session control receipt')
    assert.notStrictEqual(expiredPlanPreview.pending.hostSessionDigest, expiredPlanControl.hostSessionDigest)
    expectCode(() => resolveAiBudgetAuthority({
      options: { nowMs: NOW },
      plan: expiredPlan,
      candidate: expiredPlanCandidate,
      authorityContext: expiredPlanContext,
      activeRoot,
      execute: true
    }), 'VALIDATION_AI_CONTROL_INGRESS_REQUIRED')
    const freshExpiredPlanControl = controlReceipt({
      prompt: '确认',
      mode: 'confirm',
      sessionKey: expiredPlanSession,
      taskId: expiredPlanTaskId,
      contextEpoch: expiredPlanEpoch,
      suffix: 'expired-plan-only-fresh-confirm',
      nowMs: NOW + 1000
    })
    updateControl({
      activeRoot,
      identity: expiredPlanSeed.identity,
      metaDir: expiredPlanSeed.metaDir,
      sessionKey: expiredPlanSession,
      control: freshExpiredPlanControl
    })
    const freshExpiredPlanConfirmation = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 1000 },
      plan: expiredPlan,
      candidate: expiredPlanCandidate,
      authorityContext: authorityContext({
        identity: expiredPlanSeed.identity,
        sessionKey: expiredPlanSession,
        contextEpoch: expiredPlanEpoch,
        control: freshExpiredPlanControl
      }),
      activeRoot,
      execute: true
    })
    assert.strictEqual(freshExpiredPlanConfirmation.decision, 'user-confirmed')
    assert.strictEqual(freshExpiredPlanConfirmation.authority.authorityKind, 'user-confirmation')
    const rootReplayMismatchControl = controlReceipt({
      prompt: `确认当前验证卡 ${'e'.repeat(64)}`,
      mode: 'confirm',
      sessionKey: confirmSession,
      taskId: confirmTaskId,
      contextEpoch,
      suffix: 'confirmed-root-mismatched-digest'
    })
    expectCode(() => resolveAiBudgetAuthority({
      options: {},
      plan: confirmPlan,
      candidate: confirmCandidate,
      authorityContext: authorityContext({
        identity: confirmSeed.identity,
        sessionKey: confirmSession,
        contextEpoch,
        control: rootReplayMismatchControl
      }),
      activeRoot,
      execute: true
    }), 'VALIDATION_CONFIRMED_BUDGET_DIGEST_MISMATCH')

    const crossTurnTaskId = '00000000-0000-4000-8000-000000000363'
    const crossTurnSession = 'validation-cross-turn-confirm-session'
    const displayEpoch = 'context-cross-turn-display'
    const displayControl = controlReceipt({
      prompt: '继续处理并显示当前验证卡',
      mode: 'confirm',
      sessionKey: crossTurnSession,
      taskId: crossTurnTaskId,
      contextEpoch: displayEpoch,
      suffix: 'cross-turn-display'
    })
    const crossTurnSeed = seedTask({
      activeRoot,
      taskId: crossTurnTaskId,
      sessionKey: crossTurnSession,
      control: displayControl
    })
    const crossTurnCandidate = fixtureCandidate('cross-turn-confirm')
    const displayedPlan = fixturePlan(crossTurnTaskId, displayEpoch, 'cross-turn-confirm', {
      requestSourceRef: `validation-control:${displayControl.receiptDigest}`
    })
    assert.strictEqual(resolveAiBudgetAuthority({
      options: {},
      plan: displayedPlan,
      candidate: crossTurnCandidate,
      authorityContext: authorityContext({
        identity: crossTurnSeed.identity,
        sessionKey: crossTurnSession,
        contextEpoch: displayEpoch,
        control: displayControl
      }),
      activeRoot,
      execute: false
    }).decision, 'awaiting-current-budget-confirmation')

    const confirmationEpoch = 'context-cross-turn-confirm'
    const crossTurnConfirmControl = controlReceipt({
      prompt: '这是阻断问题，要一起修复，确认当前验证卡，然后继续复核',
      mode: 'confirm',
      sessionKey: crossTurnSession,
      taskId: crossTurnTaskId,
      contextEpoch: confirmationEpoch,
      suffix: 'cross-turn-confirm'
    })
    updateControl({
      activeRoot,
      identity: crossTurnSeed.identity,
      metaDir: crossTurnSeed.metaDir,
      sessionKey: crossTurnSession,
      control: crossTurnConfirmControl
    })
    const crossTurnRecovered = readTaskRecoveryState({
      metaDir: crossTurnSeed.metaDir,
      identity: crossTurnSeed.identity,
      sessionKey: crossTurnSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const crossTurnContext = authorityContext({
      identity: crossTurnSeed.identity,
      sessionKey: crossTurnSession,
      contextEpoch: confirmationEpoch,
      control: crossTurnConfirmControl,
      state: crossTurnRecovered.state
    })
    const rebuiltFromCurrentTurn = fixturePlan(crossTurnTaskId, confirmationEpoch, 'cross-turn-confirm', {
      requestSourceRef: `validation-control:${crossTurnConfirmControl.receiptDigest}`
    })
    assert.notStrictEqual(rebuiltFromCurrentTurn.planDigest, displayedPlan.planDigest,
      'a real confirmation turn must produce a different volatile request identity before pending replay')
    const restoredPlanIdentity = resolvePendingBudgetPlanIdentity({
      actorType: 'ai-hook',
      authorityContext: crossTurnContext,
      candidate: crossTurnCandidate,
      repoRoot: REPO_ROOT,
      nowMs: NOW + 1000
    })
    assert(restoredPlanIdentity, 'the exact server-owned pending card must restore its frozen plan identity')
    assert.strictEqual(restoredPlanIdentity.contextEpoch, displayEpoch)
    assert.strictEqual(restoredPlanIdentity.requestSourceRef, displayedPlan.verificationIntent.requestSourceRef)
    const replayedDisplayedPlan = fixturePlan(
      crossTurnTaskId,
      restoredPlanIdentity.contextEpoch,
      'cross-turn-confirm',
      { requestSourceRef: restoredPlanIdentity.requestSourceRef }
    )
    assert.strictEqual(resolveAiBudgetAuthority({
      options: {},
      plan: replayedDisplayedPlan,
      candidate: crossTurnCandidate,
      authorityContext: crossTurnContext,
      activeRoot,
      execute: false
    }).decision, 'confirmation-ready')
    const crossTurnConfirmed = resolveAiBudgetAuthority({
      options: {},
      plan: replayedDisplayedPlan,
      candidate: crossTurnCandidate,
      authorityContext: crossTurnContext,
      activeRoot,
      execute: true
    })
    assert.strictEqual(crossTurnConfirmed.decision, 'user-confirmed')
    assert.strictEqual(crossTurnConfirmed.authority.contextEpoch, displayEpoch,
      'the confirmation receipt must retain the frozen card plan context')
    const crossTurnLease = createCliLease({
      options: {},
      plan: crossTurnConfirmed.plan,
      candidate: crossTurnCandidate,
      actorType: 'ai-hook',
      authorityContext: crossTurnContext,
      budgetAuthority: crossTurnConfirmed.authority
    })
    assert.strictEqual(crossTurnLease.contextEpoch, confirmationEpoch,
      'execution authority must bind the current confirmation ContextRead epoch')
    assert.strictEqual(crossTurnLease.sourceMessageDigest, crossTurnConfirmControl.sourceMessageDigest)

    const driftTaskId = '00000000-0000-4000-8000-000000000364'
    const driftSession = 'validation-stale-card-session'
    const driftDisplayEpoch = 'context-stale-card-display'
    const driftDisplayControl = controlReceipt({
      prompt: '显示变更前验证卡',
      mode: 'confirm',
      sessionKey: driftSession,
      taskId: driftTaskId,
      contextEpoch: driftDisplayEpoch,
      suffix: 'stale-card-display'
    })
    const driftSeed = seedTask({
      activeRoot,
      taskId: driftTaskId,
      sessionKey: driftSession,
      control: driftDisplayControl
    })
    const driftOldCandidate = fixtureCandidate('stale-card-old')
    const driftOldPlan = fixturePlan(driftTaskId, driftDisplayEpoch, 'stale-card-old', {
      requestSourceRef: `validation-control:${driftDisplayControl.receiptDigest}`
    })
    resolveAiBudgetAuthority({
      options: {},
      plan: driftOldPlan,
      candidate: driftOldCandidate,
      authorityContext: authorityContext({
        identity: driftSeed.identity,
        sessionKey: driftSession,
        contextEpoch: driftDisplayEpoch,
        control: driftDisplayControl
      }),
      activeRoot,
      execute: false
    })
    const driftConfirmationEpoch = 'context-stale-card-confirm'
    const driftConfirmControl = controlReceipt({
      prompt: '确认当前验证卡',
      mode: 'confirm',
      sessionKey: driftSession,
      taskId: driftTaskId,
      contextEpoch: driftConfirmationEpoch,
      suffix: 'stale-card-confirm'
    })
    updateControl({
      activeRoot,
      identity: driftSeed.identity,
      metaDir: driftSeed.metaDir,
      sessionKey: driftSession,
      control: driftConfirmControl
    })
    const driftRecovered = readTaskRecoveryState({
      metaDir: driftSeed.metaDir,
      identity: driftSeed.identity,
      sessionKey: driftSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const driftContext = authorityContext({
      identity: driftSeed.identity,
      sessionKey: driftSession,
      contextEpoch: driftConfirmationEpoch,
      control: driftConfirmControl,
      state: driftRecovered.state
    })
    const driftNewCandidate = fixtureCandidate('stale-card-new')
    assert.strictEqual(resolvePendingBudgetPlanIdentity({
      actorType: 'ai-hook',
      authorityContext: driftContext,
      candidate: driftNewCandidate,
      repoRoot: REPO_ROOT,
      nowMs: NOW + 1000
    }), null, 'candidate drift must never reuse the old pending plan identity')
    const driftNewPlan = fixturePlan(driftTaskId, driftConfirmationEpoch, 'stale-card-new', {
      requestSourceRef: `validation-control:${driftConfirmControl.receiptDigest}`
    })
    const driftPreview = resolveAiBudgetAuthority({
      options: {},
      plan: driftNewPlan,
      candidate: driftNewCandidate,
      authorityContext: driftContext,
      activeRoot,
      execute: false
    })
    assert.strictEqual(driftPreview.decision, 'confirmation-stale-new-card')
    assert.strictEqual(driftPreview.pending.requestSourceRef,
      `validation-control:${driftConfirmControl.receiptDigest}`)
    assert.throws(() => createBudgetConfirmationReceipt({
      pendingBudgetCard: driftPreview.pending,
      authorityKind: 'user-confirmation',
      sourceMessageDigest: driftConfirmControl.sourceMessageDigest,
      revocationEpoch: 0
    }, {
      currentUserInstruction: true,
      currentSourceMessageDigest: driftConfirmControl.sourceMessageDigest,
      currentRequestSourceRef: `validation-control:${driftConfirmControl.receiptDigest}`
    }), error => error.code === 'VALIDATION_FRESH_BUDGET_CONFIRMATION_REQUIRED')
    expectCode(() => resolveAiBudgetAuthority({
      options: {},
      plan: driftNewPlan,
      candidate: driftNewCandidate,
      authorityContext: driftContext,
      activeRoot,
      execute: true
    }), 'VALIDATION_FRESH_BUDGET_CONFIRMATION_REQUIRED')
    const freshDriftConfirmationEpoch = 'context-stale-card-fresh-confirm'
    const freshDriftControl = controlReceipt({
      prompt: `确认当前验证卡 ${driftNewPlan.budgetCard.digest}`,
      mode: 'confirm',
      sessionKey: driftSession,
      taskId: driftTaskId,
      contextEpoch: freshDriftConfirmationEpoch,
      suffix: 'stale-card-fresh-confirm'
    })
    updateControl({
      activeRoot,
      identity: driftSeed.identity,
      metaDir: driftSeed.metaDir,
      sessionKey: driftSession,
      control: freshDriftControl
    })
    const freshDriftRecovered = readTaskRecoveryState({
      metaDir: driftSeed.metaDir,
      identity: driftSeed.identity,
      sessionKey: driftSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const freshDriftContext = authorityContext({
      identity: driftSeed.identity,
      sessionKey: driftSession,
      contextEpoch: freshDriftConfirmationEpoch,
      control: freshDriftControl,
      state: freshDriftRecovered.state
    })
    const freshDriftIdentity = resolvePendingBudgetPlanIdentity({
      actorType: 'ai-hook',
      authorityContext: freshDriftContext,
      candidate: driftNewCandidate,
      repoRoot: REPO_ROOT,
      nowMs: NOW + 1000
    })
    assert(freshDriftIdentity)
    const freshDriftPlan = fixturePlan(
      driftTaskId,
      freshDriftIdentity.contextEpoch,
      'stale-card-new',
      { requestSourceRef: freshDriftIdentity.requestSourceRef }
    )
    assert.strictEqual(resolveAiBudgetAuthority({
      options: {},
      plan: freshDriftPlan,
      candidate: driftNewCandidate,
      authorityContext: freshDriftContext,
      activeRoot,
      execute: true
    }).decision, 'user-confirmed')

    const successorTaskId = '00000000-0000-4000-8000-000000000365'
    const successorSession = 'validation-successor-session'
    const successorDisplayEpoch = 'context-successor-display'
    const successorDisplayControl = controlReceipt({
      prompt: '显示待确认的同范围验证卡',
      mode: 'confirm',
      sessionKey: successorSession,
      taskId: successorTaskId,
      contextEpoch: successorDisplayEpoch,
      suffix: 'successor-display'
    })
    const successorSeed = seedTask({
      activeRoot,
      taskId: successorTaskId,
      sessionKey: successorSession,
      control: successorDisplayControl
    })
    const successorParentCandidate = fixtureCandidate('successor-parent', {
      stable: true,
      changedFiles: ['scripts/lib/validation-execution-authority.js', 'scripts/run-validation.js']
    })
    const successorParentPlan = fixturePlan(successorTaskId, successorDisplayEpoch, 'successor-parent', {
      requestSourceRef: `validation-control:${successorDisplayControl.receiptDigest}`
    })
    const successorParentPreview = resolveAiBudgetAuthority({
      options: { nowMs: NOW },
      plan: successorParentPlan,
      candidate: successorParentCandidate,
      authorityContext: authorityContext({
        identity: successorSeed.identity,
        sessionKey: successorSession,
        contextEpoch: successorDisplayEpoch,
        control: successorDisplayControl
      }),
      activeRoot,
      execute: false
    })
    const successorConfirmEpoch = 'context-successor-confirm'
    const successorConfirmControl = controlReceipt({
      prompt: '确认当前验证卡，并继续同范围修复后的验证',
      mode: 'confirm',
      sessionKey: successorSession,
      taskId: successorTaskId,
      contextEpoch: successorConfirmEpoch,
      suffix: 'successor-confirm',
      nowMs: NOW + 1000
    })
    updateControl({
      activeRoot,
      identity: successorSeed.identity,
      metaDir: successorSeed.metaDir,
      sessionKey: successorSession,
      control: successorConfirmControl
    })
    const successorRecovered = readTaskRecoveryState({
      metaDir: successorSeed.metaDir,
      identity: successorSeed.identity,
      sessionKey: successorSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const successorContext = authorityContext({
      identity: successorSeed.identity,
      sessionKey: successorSession,
      contextEpoch: successorConfirmEpoch,
      control: successorConfirmControl,
      state: successorRecovered.state
    })
    const successorCandidate = fixtureCandidate('successor-current', {
      stable: true,
      changedFiles: ['scripts/run-validation.js']
    })
    const successorPlan = fixturePlan(successorTaskId, successorConfirmEpoch, 'successor-current', {
      requestSourceRef: `validation-control:${successorConfirmControl.receiptDigest}`
    })
    const successorAuthorized = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 1000 },
      plan: successorPlan,
      candidate: successorCandidate,
      authorityContext: successorContext,
      activeRoot,
      execute: false
    })
    assert.strictEqual(successorAuthorized.decision, 'validation-successor-authorized-plan-only')
    assert.strictEqual(successorAuthorized.successorDecision.decision, 'auto-pass')
    assert.strictEqual(successorAuthorized.authority.authorityKind, 'auto')
    assert.strictEqual(successorAuthorized.authority.pendingBindingDigest,
      successorParentPreview.pending.bindingDigest)
    assert.strictEqual(successorAuthorized.authority.successorDecisionDigest,
      successorAuthorized.successorDecision.decisionDigest)
    const successorStore = createValidationEvidenceStore({
      activeRoot,
      project: 'devcodex',
      actorType: 'ai-hook',
      taskIdentity: successorSeed.identity,
      taskRecoveryKey: successorTaskId,
      sessionKey: successorSession
    })
    assert.strictEqual(successorStore.readPendingBudgetCard().status, 'missing',
      'the successor root CAS must clear the parent pending card atomically')
    const successorRoot = successorStore.readRootBudgetConfirmation()
    assert.strictEqual(successorRoot.status, 'fresh')
    assert.strictEqual(successorRoot.rootBudgetConfirmation.candidateId, successorCandidate.candidateId)
    assert.strictEqual(successorStore.readLease().status, 'missing')
    assert.strictEqual(successorStore.readTerminal().status, 'missing')
    const successorReplay = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 1000 },
      plan: successorPlan,
      candidate: successorCandidate,
      authorityContext: successorContext,
      activeRoot,
      execute: true
    })
    assert.strictEqual(successorReplay.decision, 'root-replay-or-reconcile')
    assert.strictEqual(successorReplay.authority.receiptDigest,
      successorRoot.rootBudgetConfirmation.receiptDigest)

    assert.throws(() => createPendingBudgetCardBinding({
      plan: fixturePlan(successorTaskId, successorConfirmEpoch, 'successor-invalid-risk', {
        riskClass: 'unknown-risk'
      }),
      candidate: fixtureCandidate('successor-invalid-risk', { stable: true }),
      repoRoot: REPO_ROOT,
      project: 'devcodex',
      taskRecoveryKey: successorTaskId,
      hostSessionDigest: successorConfirmControl.hostSessionDigest,
      contextEpoch: successorConfirmEpoch
    }), error => error?.code === 'VALIDATION_PENDING_BUDGET_INVALID',
    'an unknown validation risk must fail closed instead of being normalized to normal')
    const unsafePathPending = createPendingBudgetCardBinding({
      plan: fixturePlan(successorTaskId, successorConfirmEpoch, 'successor-unsafe-path'),
      candidate: fixtureCandidate('successor-unsafe-path', {
        stable: true,
        changedFiles: ['../outside-scope.js']
      }),
      repoRoot: REPO_ROOT,
      project: 'devcodex',
      taskRecoveryKey: successorTaskId,
      hostSessionDigest: successorConfirmControl.hostSessionDigest,
      contextEpoch: successorConfirmEpoch
    })
    assert.strictEqual(unsafePathPending.candidateChangedFilesTruncated, true,
      'an unsafe candidate path must make successor scope incomplete')

    const successorNegativeCases = [
      {
        name: 'path-expansion',
        candidate: { stable: true, changedFiles: ['scripts/run-validation.js', 'scripts/lib/validation-execution-authority.js', 'scripts/new-scope.js'] },
        plan: {},
        blocker: 'candidate-paths-expanded'
      },
      { name: 'head-change', candidate: { stable: true, head: 'b'.repeat(40) }, plan: {}, blocker: 'candidate-head-changed' },
      { name: 'unstable', candidate: { stable: false }, plan: {}, blocker: 'candidate-scope-incomplete' },
      {
        name: 'deletion',
        candidate: { stable: true, deletedFiles: ['scripts/run-validation.js'] },
        plan: {},
        blocker: 'candidate-scope-incomplete'
      },
      { name: 'risk-change', candidate: { stable: true }, plan: { riskClass: 'high' }, blocker: 'validation-risk-changed' },
      {
        name: 'node-change',
        candidate: { stable: true },
        plan: { selectedNodes: [{ id: 'validation-authority', writeScopes: [] }, { id: 'validation-extra', writeScopes: [] }] },
        blocker: 'selected-nodes-changed'
      },
      { name: 'boundary-change', candidate: { stable: true }, plan: { affectedBoundaries: ['validation-other'] }, blocker: 'affected-boundaries-changed' },
      { name: 'heavy-change', candidate: { stable: true }, plan: { heavyNodeIds: ['validation-other'] }, blocker: 'heavy-nodes-changed' },
      { name: 'side-effect-change', candidate: { stable: true }, plan: { sideEffectCategories: ['install'] }, blocker: 'side-effects-changed' },
      { name: 'budget-increase', candidate: { stable: true }, plan: { estimatedDurationMs: 700001 }, blocker: 'estimated-duration-increased' },
      {
        name: 'successor-control-lineage',
        candidate: { stable: true },
        plan: { requestSourceRef: 'validation-control:' + 'f'.repeat(64) },
        blocker: 'successor-control-lineage-mismatch'
      },
      {
        name: 'truncated-scope',
        candidate: { stable: true, changedFiles: Array.from({ length: 41 }, (_, index) => `scripts/scope-${index}.js`) },
        plan: {},
        blocker: 'candidate-scope-incomplete'
      }
    ]
    for (const [index, negative] of successorNegativeCases.entries()) {
      const taskId = `00000000-0000-4000-8000-${String(800 + index).padStart(12, '0')}`
      const sessionKey = `validation-successor-negative-${negative.name}`
      const displayEpoch = `context-successor-negative-display-${index}`
      const displayControl = controlReceipt({
        prompt: '显示当前验证卡',
        mode: 'confirm',
        sessionKey,
        taskId,
        contextEpoch: displayEpoch,
        suffix: `successor-negative-display-${index}`,
        nowMs: NOW + index * 10
      })
      const seeded = seedTask({ activeRoot, taskId, sessionKey, control: displayControl })
      const parentCandidate = fixtureCandidate(`successor-negative-parent-${index}`, {
        stable: true,
        changedFiles: ['scripts/lib/validation-execution-authority.js', 'scripts/run-validation.js']
      })
      const parentPlan = fixturePlan(taskId, displayEpoch, `successor-negative-parent-${index}`, {
        requestSourceRef: `validation-control:${displayControl.receiptDigest}`
      })
      resolveAiBudgetAuthority({
        options: { nowMs: NOW + index * 10 },
        plan: parentPlan,
        candidate: parentCandidate,
        authorityContext: authorityContext({ identity: seeded.identity, sessionKey, contextEpoch: displayEpoch, control: displayControl }),
        activeRoot,
        execute: false
      })
      const confirmEpoch = `context-successor-negative-confirm-${index}`
      const confirmControl = controlReceipt({
        prompt: '确认当前验证卡',
        mode: 'confirm',
        sessionKey,
        taskId,
        contextEpoch: confirmEpoch,
        suffix: `successor-negative-confirm-${index}`,
        nowMs: NOW + 1000 + index * 10
      })
      updateControl({
        activeRoot,
        identity: seeded.identity,
        metaDir: seeded.metaDir,
        sessionKey,
        control: confirmControl
      })
      const recoveredNegative = readTaskRecoveryState({
        metaDir: seeded.metaDir,
        identity: seeded.identity,
        sessionKey,
        expectedIdentity: { activeRoot, project: 'devcodex' }
      })
      const negativeCandidate = fixtureCandidate(`successor-negative-current-${index}`, {
        stable: negative.candidate.stable,
        head: negative.candidate.head,
        changedFiles: negative.candidate.changedFiles || ['scripts/run-validation.js'],
        deletedFiles: negative.candidate.deletedFiles || []
      })
      const negativePlan = fixturePlan(taskId, confirmEpoch, `successor-negative-current-${index}`, {
        requestSourceRef: `validation-control:${confirmControl.receiptDigest}`,
        ...negative.plan
      })
      const negativeResult = resolveAiBudgetAuthority({
        options: { nowMs: NOW + 1000 + index * 10 },
        plan: negativePlan,
        candidate: negativeCandidate,
        authorityContext: authorityContext({
          identity: seeded.identity,
          sessionKey,
          contextEpoch: confirmEpoch,
          control: confirmControl,
          state: recoveredNegative.state
        }),
        activeRoot,
        execute: false
      })
      assert.strictEqual(negativeResult.decision, 'confirmation-stale-new-card', negative.name)
      assert(negativeResult.successorDecision.blockers.includes(negative.blocker),
        `${negative.name} missing ${negative.blocker}: ${JSON.stringify(negativeResult.successorDecision.blockers)}`)
      assert.strictEqual(createValidationEvidenceStore({
        activeRoot,
        project: 'devcodex',
        actorType: 'ai-hook',
        taskIdentity: seeded.identity,
        taskRecoveryKey: taskId,
        sessionKey
      }).readRootBudgetConfirmation().status, 'missing', `${negative.name} must not create a root`)
    }

    const legacySuccessorTaskId = '00000000-0000-4000-8000-000000000900'
    const legacySuccessorSession = 'validation-successor-legacy'
    const legacyDisplayEpoch = 'context-successor-legacy-display'
    const legacyDisplayControl = controlReceipt({
      prompt: '显示 legacy 候选卡',
      mode: 'confirm',
      sessionKey: legacySuccessorSession,
      taskId: legacySuccessorTaskId,
      contextEpoch: legacyDisplayEpoch,
      suffix: 'successor-legacy-display',
      nowMs: NOW
    })
    const legacySeed = seedTask({
      activeRoot,
      taskId: legacySuccessorTaskId,
      sessionKey: legacySuccessorSession,
      control: legacyDisplayControl
    })
    resolveAiBudgetAuthority({
      options: { nowMs: NOW },
      plan: fixturePlan(legacySuccessorTaskId, legacyDisplayEpoch, 'successor-legacy-parent', {
        requestSourceRef: `validation-control:${legacyDisplayControl.receiptDigest}`
      }),
      candidate: fixtureCandidate('successor-legacy-parent', { stable: true }),
      authorityContext: authorityContext({
        identity: legacySeed.identity,
        sessionKey: legacySuccessorSession,
        contextEpoch: legacyDisplayEpoch,
        control: legacyDisplayControl
      }),
      activeRoot,
      execute: false
    })
    const legacyMutation = updateTaskRecoveryState({
      metaDir: legacySeed.metaDir,
      identity: legacySeed.identity,
      sessionKey: legacySuccessorSession,
      expectedIdentity: { activeRoot, project: 'devcodex' },
      readFallback: () => ({})
    }, state => {
      const pending = { ...state.validationExecution.pendingBudgetCard }
      for (const field of [
        'candidateStable', 'candidateHead', 'candidateChangedFiles', 'candidateChangedFilesTruncated',
        'candidateChangedFilesDigest', 'candidateHasDeletions', 'riskClass', 'requestSourceRef', 'bindingDigest'
      ]) delete pending[field]
      pending.bindingDigest = sha256(stableStringify(pending))
      return {
        ...state,
        validationExecution: { ...state.validationExecution, pendingBudgetCard: pending }
      }
    }, { force: true, nowMs: NOW + 500 })
    assert(['committed', 'semantic-noop'].includes(legacyMutation.status), JSON.stringify(legacyMutation))
    const legacyConfirmEpoch = 'context-successor-legacy-confirm'
    const legacyConfirmControl = controlReceipt({
      prompt: '确认当前验证卡',
      mode: 'confirm',
      sessionKey: legacySuccessorSession,
      taskId: legacySuccessorTaskId,
      contextEpoch: legacyConfirmEpoch,
      suffix: 'successor-legacy-confirm',
      nowMs: NOW + 1000
    })
    updateControl({
      activeRoot,
      identity: legacySeed.identity,
      metaDir: legacySeed.metaDir,
      sessionKey: legacySuccessorSession,
      control: legacyConfirmControl
    })
    const legacyRecovered = readTaskRecoveryState({
      metaDir: legacySeed.metaDir,
      identity: legacySeed.identity,
      sessionKey: legacySuccessorSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const legacyResult = resolveAiBudgetAuthority({
      options: { nowMs: NOW + 1000 },
      plan: fixturePlan(legacySuccessorTaskId, legacyConfirmEpoch, 'successor-legacy-current', {
        requestSourceRef: `validation-control:${legacyConfirmControl.receiptDigest}`
      }),
      candidate: fixtureCandidate('successor-legacy-current', { stable: true }),
      authorityContext: authorityContext({
        identity: legacySeed.identity,
        sessionKey: legacySuccessorSession,
        contextEpoch: legacyConfirmEpoch,
        control: legacyConfirmControl,
        state: legacyRecovered.state
      }),
      activeRoot,
      execute: false
    })
    assert.strictEqual(legacyResult.decision, 'confirmation-stale-new-card')
    assert(legacyResult.successorDecision.blockers.includes('candidate-scope-incomplete'))
    assert(legacyResult.successorDecision.blockers.includes('parent-confirmation-lineage-missing'))

    const blockedPreflightTaskId = '7b3fe84f-5a5d-4a09-8f54-23827dd9c21a'
    const blockedPreflightSession = 'session-formal-task-preflight-blocked'
    const blockedPreflightEpoch = 'context-formal-task-preflight-blocked'
    const blockedPreflightControl = controlReceipt({
      prompt: '生成当前验证计划',
      mode: 'confirm',
      sessionKey: blockedPreflightSession,
      taskId: blockedPreflightTaskId,
      contextEpoch: blockedPreflightEpoch,
      suffix: 'formal-task-preflight-blocked'
    })
    const blockedPreflightSeed = seedTask({
      activeRoot,
      taskId: blockedPreflightTaskId,
      sessionKey: blockedPreflightSession,
      control: blockedPreflightControl
    })
    const blockedPreflightRecovered = readTaskRecoveryState({
      metaDir: blockedPreflightSeed.metaDir,
      identity: blockedPreflightSeed.identity,
      sessionKey: blockedPreflightSession,
      expectedIdentity: { activeRoot, project: 'devcodex' }
    })
    const blockedPreflightContext = authorityContext({
      identity: blockedPreflightSeed.identity,
      sessionKey: blockedPreflightSession,
      contextEpoch: blockedPreflightEpoch,
      control: blockedPreflightControl,
      state: blockedPreflightRecovered.state
    })
    const blockedPreflightPlan = fixturePlan(blockedPreflightTaskId, blockedPreflightEpoch, 'formal-preflight-block')
    const blockedPreflightCandidate = fixtureCandidate('formal-preflight-block')
    let blockedPreflightError = null
    try {
      resolveFormalTaskExecutionPreflight({
        authorityContext: blockedPreflightContext,
        plan: blockedPreflightPlan,
        candidate: blockedPreflightCandidate,
        activeRoot,
        repoRoot: REPO_ROOT,
        nowMs: NOW
      })
    } catch (error) {
      blockedPreflightError = error
    }
    assert.strictEqual(blockedPreflightError?.code, 'FORMAL_TASK_EXECUTION_PREFLIGHT_BLOCKED')
    assert.strictEqual(blockedPreflightError?.details?.card, null)
    assert.strictEqual(blockedPreflightError?.details?.executed, 0)
    assert.strictEqual(blockedPreflightError?.details?.preflight?.status, 'BLOCK')
    assert.strictEqual(
      createValidationEvidenceStore({
        activeRoot,
        project: 'devcodex',
        actorType: 'ai-hook',
        taskIdentity: blockedPreflightSeed.identity,
        taskRecoveryKey: blockedPreflightTaskId,
        sessionKey: blockedPreflightSession
      }).readPendingBudgetCard().status,
      'missing',
      'failed formal-task preflight must not persist a pending BudgetCard'
    )

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
