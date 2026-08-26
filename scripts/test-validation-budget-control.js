'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { sha256 } = require('../hooks/_runtime/content-identity.cjs')
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

function persistRepairCloseout({ activeRoot, metaDir, identity, sessionKey, repairPath, suffix, nowMs }) {
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
        operationId: `repair-operation-${suffix}`,
        completedAt: new Date(nowMs).toISOString(),
        result: 'success',
        authorizationErrors: [],
        observation: {
          schemaVersion: 'MutationObservationReceiptV1',
          operationId: `repair-operation-${suffix}`,
          plannedSetDigest: sha256(`repair-planned-set-${suffix}`),
          observedEffects: { created: [], modified: [repairPath], deleted: [], moved: [] },
          observationCoverage: 'complete',
          nativeExitCode: 0,
          drift: [],
          reconcileRequired: false,
          status: 'consumed',
          completedAt: new Date(nowMs).toISOString(),
          receiptDigest: sha256(`repair-observation-${suffix}`)
        }
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
  for (let index = 0; index < 3; index += 1) {
    const timestamp = `2020-01-01T00:00:0${index}Z`
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
  }
  return {
    repoRoot,
    ancestorHead: heads[0],
    previousHead: heads[1],
    currentHead: heads[2]
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
      nowMs: NOW + 3000
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
      ancestorHead
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
