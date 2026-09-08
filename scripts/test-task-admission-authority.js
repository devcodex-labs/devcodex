'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildActualInstructionEnvelope,
  buildWorkItemSet,
  digest
} = require('../hooks/_runtime/actual-instruction-envelope.cjs')
const { buildWorkflowRouteDecision } = require('../hooks/_runtime/workflow-route-decision-v2.cjs')
const { validateTaskIdentity } = require('../hooks/_runtime/task-continuation-contract.cjs')
const {
  advanceTaskCanonicalRevision,
  normalizeIdentity,
  observeFinalizedTaskResumeLiveness,
  readBoundedResumeIngressCapability,
  readFencedTaskWriteOwner,
  readTaskAdmissionTransaction,
  readTaskRecoveryState,
  resolveTaskRecoveryMetaDir,
  commitTaskRecoveryState,
  storePaths,
  taskAdmissionTransactionDigest,
  taskPaths,
  updateTaskRecoveryState,
  validateAdmissionContinuationLease,
  validateTaskAdmissionTransaction,
  validateTaskAdmissionReconciliationReceipt,
  validateTaskCanonicalRevision,
  writeBoundedResumeIngressCapability
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  computeProjectTargetLeaseDigest,
  createTaskIdentityV2,
  executeTaskAdmission,
  recoverOwnerFencedAdmissionForResume,
  executeTaskWriteOwner,
  executeWorkflowTaskTerminal,
  readFormalTaskExecutionReadiness,
  readFinalizedResumeCanonicalEvidence,
  reconcileWorkflowTaskTerminal,
  validateProjectTargetLease
} = require('../mcp/task-admission-authority.cjs')
const {
  taskOperationRecordDigest,
  taskOperationTargetSetDigest,
  taskOperationTerminalSnapshot
} = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')
const {
  createMutationPreObservation,
  observeMutationEffects
} = require('../hooks/_runtime/mutation-observation.cjs')

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-task-admission-'))
const NOW_MS = Date.parse('2026-08-25T00:00:00.000Z')
const STORE_OPTIONS = {
  reserveBytes: 8 * 1024,
  softBytes: 64 * 1024 * 1024,
  hardBytes: 128 * 1024 * 1024,
  diskHeadroomBytes: 0,
  availableDiskBytes: 1024 * 1024 * 1024
}
const KEEP_TEST_ARTIFACTS = process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1'
const TEST_RUNTIME = {
  schemaVersion: 'MemoryRuntimeGenerationRefV1',
  activeVersion: '1.19.5',
  generationId: 'test-runtime-generation-v1',
  contractVersion: 'formal-task-continuity-v3',
  manifestStatus: 'verified',
  runtimeDigest: 'a'.repeat(64)
}

function setupRoot(name) {
  const physicalRoot = path.join(TEMP_ROOT, name)
  const activeRoot = path.join(physicalRoot, '.devcodex')
  fs.mkdirSync(path.join(activeRoot, 'profile'), { recursive: true })
  fs.writeFileSync(path.join(physicalRoot, 'package.json'), '{}\n')
  return { physicalRoot, activeRoot, project: name }
}

function projectLease(root, envelope, route) {
  const core = {
    schemaVersion: 'ProjectTargetLeaseV2',
    project: root.project,
    targetDigest: '1'.repeat(64),
    rootIdentityDigest: '2'.repeat(64),
    layoutIdentity: '3'.repeat(64),
    physicalRoot: root.physicalRoot,
    activeRoot: root.activeRoot,
    authorityKind: 'session',
    authorityDigest: envelope.hostSessionDigest,
    contextEpoch: envelope.contextEpoch,
    contextBindingDigest: '5'.repeat(64),
    routeRevision: route.routeRevision,
    revocationEpoch: 1,
    issuedAtMs: NOW_MS - 1000,
    expiresAtMs: NOW_MS + 24 * 60 * 60 * 1000
  }
  return { ...core, leaseDigest: computeProjectTargetLeaseDigest(core) }
}

function refreshedProjectLease(lease, overrides = {}) {
  const core = {
    ...lease,
    contextBindingDigest: '6'.repeat(64),
    revocationEpoch: Number(lease.revocationEpoch || 0) + 1,
    expiresAtMs: Number(lease.expiresAtMs) + 60 * 60 * 1000,
    ...overrides
  }
  delete core.leaseDigest
  return { ...core, leaseDigest: computeProjectTargetLeaseDigest(core) }
}

function refreshedIngressContext(input, suffix, contextEpoch) {
  const envelope = buildActualInstructionEnvelope({
    prompt: `修复任务 ${suffix}`,
    session_id: `session-${suffix}`,
    event_id: `event-${suffix}`,
    timestamp: new Date(NOW_MS).toISOString()
  }, {
    hostVariant: 'codex-cli',
    contextEpoch,
    trustedHostEvent: true,
    nowMs: NOW_MS
  })
  const workItemSet = buildWorkItemSet(envelope, {
    workItems: [{
      taskKind: input.workflowRouteDecision.topIntent,
      routeCandidate: input.workflowRouteDecision.routeKey
    }]
  })
  const route = buildWorkflowRouteDecision({
    actualInstructionEnvelope: envelope,
    workItemSet,
    workItemId: workItemSet.items[0].workItemId,
    environmentMode: input.workflowRouteDecision.environmentMode,
    routeKey: input.workflowRouteDecision.routeKey
  })
  return {
    ...input,
    actualInstructionEnvelope: envelope,
    workItemSet,
    workflowRouteDecision: route,
    projectTargetLease: projectLease({
      physicalRoot: input.projectTargetLease.physicalRoot,
      activeRoot: input.activeRoot,
      project: input.project
    }, envelope, route)
  }
}

function legacyAdmissionRequestDigest(input, transaction) {
  return digest({
    operation: input.operation,
    envelopeDigest: input.actualInstructionEnvelope.envelopeDigest,
    workItemSetDigest: input.workItemSet.setDigest,
    workflowRouteDigest: input.workflowRouteDecision.decisionDigest,
    projectTargetLeaseDigest: transaction.projectTargetLeaseDigest,
    taskIdentityDigest: transaction.taskIdentityDigest,
    directoryDecisionDigest: transaction.directoryDecisionDigest,
    overviewDigest: crypto.createHash('sha256').update(String(input.overview.content)).digest('hex'),
    productSourceDigest: input.task.entryVariant === 'product-provided'
      ? crypto.createHash('sha256').update(String(input.overview.productSourceContent)).digest('hex')
      : null,
    admissionPolicyRevision: transaction.admissionPolicyRevision
  })
}

function admissionInput(root, suffix = 'base', overrides = {}) {
  const {
    routeTaskKind = 'fix',
    routeCandidate = 'fix.default',
    hostSessionId = `session-${suffix}`,
    contextEpoch = `ctx-${suffix}`,
    ...inputOverrides
  } = overrides
  const envelope = buildActualInstructionEnvelope({
    prompt: `修复任务 ${suffix}`,
    session_id: hostSessionId,
    event_id: `event-${suffix}`,
    timestamp: new Date(NOW_MS).toISOString()
  }, {
    hostVariant: 'codex-cli',
    contextEpoch,
    trustedHostEvent: true,
    nowMs: NOW_MS
  })
  const workItemSet = buildWorkItemSet(envelope, {
    workItems: [{ taskKind: routeTaskKind, routeCandidate }]
  })
  const route = buildWorkflowRouteDecision({
    actualInstructionEnvelope: envelope,
    workItemSet,
    workItemId: workItemSet.items[0].workItemId,
    environmentMode: 'dev',
    routeKey: routeCandidate
  })
  return {
    operation: 'admit',
    activeRoot: root.activeRoot,
    project: root.project,
    actualInstructionEnvelope: envelope,
    workItemSet,
    workflowRouteDecision: route,
    projectTargetLease: projectLease(root, envelope, route),
    task: {
      taskKind: 'bugs',
      entryVariant: 'fix',
      displayName: `任务-${suffix}`,
      aliases: [`别名-${suffix}`]
    },
    overview: { content: `# 问题概况\n\n${suffix}\n` },
    ...inputOverrides
  }
}

function admissionIngressSnapshotRef(input, suffix = 'base') {
  const snapshotKey = crypto.createHash('sha256').update(`snapshot-key:${suffix}`).digest('hex')
  const snapshotDigest = crypto.createHash('sha256').update(`snapshot-content:${suffix}`).digest('hex')
  return {
    schemaVersion: 'AdmissionIngressSnapshotRefV1',
    envelopeId: input.actualInstructionEnvelope.envelopeId,
    envelopeDigest: input.actualInstructionEnvelope.envelopeDigest,
    decisionDigest: input.workflowRouteDecision.decisionDigest,
    routeRevision: input.workflowRouteDecision.routeRevision,
    snapshotKey,
    snapshotDigest
  }
}

function run(input, options = {}) {
  return executeTaskAdmission(input, {
    nowMs: NOW_MS,
    storeOptions: STORE_OPTIONS,
    ...options
  })
}

let ownerNonceSequence = 0

function runOwner(input, nowMs = NOW_MS, options = {}) {
  return executeTaskWriteOwner(input, {
    nowMs,
    storeOptions: STORE_OPTIONS,
    nonceFactory() {
      ownerNonceSequence += 1
      return `owner-${crypto.createHash('sha1').update(String(ownerNonceSequence)).digest('hex')}`
    },
    ...options
  })
}

function ownerInput(ingress, admission, operation, overrides = {}) {
  return {
    operation,
    activeRoot: ingress.activeRoot,
    project: ingress.project,
    actualInstructionEnvelope: ingress.actualInstructionEnvelope,
    workItemSet: ingress.workItemSet,
    workflowRouteDecision: ingress.workflowRouteDecision,
    projectTargetLease: ingress.projectTargetLease,
    ...(ingress.ingressSnapshotRef ? { ingressSnapshotRef: ingress.ingressSnapshotRef } : {}),
    taskId: admission.taskId,
    admissionId: admission.admissionId,
    ...overrides
  }
}

function ownerRef(receipt) {
  return receipt.ownerRef || {
    ownerGeneration: receipt.owner.ownerGeneration,
    ownerNonce: receipt.owner.ownerNonce,
    leaseRevision: receipt.owner.leaseRevision,
    leaseDigest: receipt.owner.leaseDigest
  }
}

function confirmCp(taskRoot, phase, artifactName, version = 'v1') {
  const artifactContent = `# ${phase} 确认\n\n测试确认。\n`
  fs.writeFileSync(path.join(taskRoot, artifactName), artifactContent)
  const artifactDigest = crypto.createHash('sha256').update(artifactContent).digest('hex')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const sessions = fs.readFileSync(sessionsPath, 'utf8')
  const ordinal = Number(phase.slice(2)) || 1
  const confirmedRow = `| ${phase} | ✅ | ${artifactName} | ${version} | ${artifactDigest} | test-confirmed-${phase.toLowerCase()} | 2026-08-25T00:0${ordinal}:00.000Z |`
  fs.writeFileSync(sessionsPath, sessions.replace(new RegExp(`^\\|\\s*${phase}\\s*\\|.*$`, 'mu'), confirmedRow))
  return { phase, artifactName, version, artifactDigest }
}

function reconfirmCp(taskRoot, phase, artifactName, version, marker, confirmedAt) {
  const artifactContent = `# ${phase} 确认\n\n${marker}\n`
  fs.writeFileSync(path.join(taskRoot, artifactName), artifactContent)
  const artifactDigest = crypto.createHash('sha256').update(artifactContent).digest('hex')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const sessions = fs.readFileSync(sessionsPath, 'utf8')
  const sourceMessage = `test-successor-${phase.toLowerCase()}-${version}`
  const confirmedRow = `| ${phase} | ✅ | ${artifactName} | ${version} | ${artifactDigest} | ${sourceMessage} | ${confirmedAt} |`
  fs.writeFileSync(sessionsPath, sessions.replace(new RegExp(`^\\|\\s*${phase}\\s*\\|.*$`, 'mu'), confirmedRow))
  return { phase, artifactName, version, artifactDigest, sourceMessage, confirmedAt }
}

function confirmCp1(taskRoot, artifactName = '01-问题确认.md') {
  return confirmCp(taskRoot, 'CP1', artifactName, 'v1')
}

function evidenceSet(input, admission, suffix = 'terminal') {
  const taskRoot = taskRootFor(input, admission)
  const taskRootRelative = admission.taskRootRelative.replace(/\\/g, '/')
  const definitions = [
    ['ecr', `${taskRootRelative}/07-ECR-${suffix}.md`, `# ECR ${suffix}\n`],
    ['report', `${taskRootRelative}/reports/codex/${suffix}.md`, `# Report ${suffix}\n`],
    ['memory', `${taskRootRelative}/.memory/${suffix}.md`, `# Memory ${suffix}\n`],
    ['completion', `${taskRootRelative}/06-完成清单-${suffix}.md`, `# Completion ${suffix}\n`]
  ]
  return definitions.map(([role, relative, content]) => {
    const filePath = path.join(input.activeRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    const bytes = Buffer.byteLength(content)
    assert.ok(filePath.startsWith(taskRoot))
    return {
      role,
      path: relative,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      bytes
    }
  })
}

function withTerminalExpectedState(ingress, admission, terminalInput, nowMs, options = {}) {
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot: ingress.activeRoot, project: ingress.project })
  const identity = {
    activeRoot: ingress.activeRoot,
    project: ingress.project,
    taskId: admission.taskId,
    taskStatus: 'active'
  }
  const recovery = readTaskRecoveryState({ metaDir, identity }, { nowMs })
  assert.strictEqual(recovery.status, 'fresh')
  const owner = recovery.state.fencedWriteOwner
  const operationSnapshot = taskOperationTerminalSnapshot(recovery.state.turnLiveness)
  if (options.requireReady !== false) assert.strictEqual(operationSnapshot.terminalReady, true)
  return {
    ...terminalInput,
    lifecycleRevision: Number(owner.reopenGeneration || 0) + 1,
    expectedStateSequence: recovery.commitFence.stateSequence,
    expectedWriterGeneration: recovery.commitFence.writerGeneration,
    settledSetDigest: operationSnapshot.settledSetDigest
  }
}

function taskRootFor(input, receipt) {
  return path.join(input.activeRoot, ...receipt.taskRootRelative.split('/'))
}

function setFinalizedResumeLiveness(root, admission, turnLiveness, nowMs) {
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot: root.activeRoot, project: root.project })
  const identity = { activeRoot: root.activeRoot, project: root.project, taskId: admission.taskId, taskStatus: 'active' }
  const result = updateTaskRecoveryState({ metaDir, identity }, state => {
    state.turnLiveness = {
      schemaVersion: 'TurnLivenessStateV1',
      state: 'completed',
      turnKey: `turn-${admission.taskId}`,
      lastEventAt: new Date(nowMs - 1000).toISOString(),
      inFlightOperation: null,
      previousTurn: { terminalState: 'completed' },
      ...turnLiveness
    }
    return state
  }, { nowMs, force: true, reason: 'test-finalized-resume-liveness', ...STORE_OPTIONS })
  assert(['committed', 'persisted', 'semantic-noop'].includes(result.status), result.errorCode || result.status)
}

function buildFinalizedResumeAttempt(root, admission, suffix, nowMs, options = {}) {
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot: root.activeRoot, project: root.project })
  const identity = { activeRoot: root.activeRoot, project: root.project, taskId: admission.taskId, taskStatus: 'active' }
  const recovery = readTaskRecoveryState({ metaDir, identity }, { nowMs })
  assert.strictEqual(recovery.status, 'fresh')
  const transaction = recovery.state.admissionTransaction
  const owner = recovery.state.fencedWriteOwner
  const canonical = readFinalizedResumeCanonicalEvidence(transaction, root.activeRoot, fs, {
    state: recovery.state
  })
  const resumeInput = admissionInput(root, suffix, {
    operation: 'bind',
    routeTaskKind: 'resume',
    routeCandidate: 'resume',
    ...(options.hostSessionId ? { hostSessionId: options.hostSessionId } : {}),
    ...(options.contextEpoch ? { contextEpoch: options.contextEpoch } : {}),
    task: {
      taskId: admission.taskId,
      taskKind: transaction.taskKind,
      entryVariant: 'continue',
      taskRootRelative: transaction.taskRootRelative
    },
    overview: { content: canonical.canonicalOverviewContent },
    serverRuntime: options.runtime || TEST_RUNTIME
  })
  if (options.projectRootIdentityDigest) {
    resumeInput.projectTargetLease = refreshedProjectLease(resumeInput.projectTargetLease, {
      rootIdentityDigest: options.projectRootIdentityDigest
    })
  }
  const ingress = {
    activeProject: root.project,
    activeScope: 'project',
    actualInstructionEnvelope: resumeInput.actualInstructionEnvelope,
    workItemSet: resumeInput.workItemSet,
    workflowRouteDecision: resumeInput.workflowRouteDecision,
    stickyProject: resumeInput.projectTargetLease
  }
  const liveness = observeFinalizedTaskResumeLiveness(recovery.state, owner, {
    nowMs,
    targetSessionDigest: resumeInput.projectTargetLease.authorityDigest,
    targetContextEpoch: resumeInput.actualInstructionEnvelope.contextEpoch
  })
  const attemptDigest = digest({
    schemaVersion: 'TestFinalizedResumeAttemptV1',
    suffix,
    transactionDigest: transaction.transactionDigest,
    ownerLeaseDigest: owner?.leaseDigest || null,
    envelopeDigest: resumeInput.actualInstructionEnvelope.envelopeDigest
  })
  const candidateWrite = writeBoundedResumeIngressCapability({
    metaDir,
    attemptDigest,
    ingress,
    project: root.project,
    activeRoot: root.activeRoot,
    projectRootIdentityDigest: resumeInput.projectTargetLease.rootIdentityDigest,
    taskId: admission.taskId,
    taskRootRelative: transaction.taskRootRelative,
    taskIdentityDigest: canonical.taskIdentityDigest,
    canonicalOverviewDigest: canonical.canonicalOverviewDigest,
    canonicalRevisionDigest: canonical.canonicalRevisionDigest,
    cpArtifactDigest: canonical.cpArtifactDigest,
    cpChainDigest: canonical.cpChainDigest,
    contextBinding: {
      schemaVersion: 'ContextReadBindingV1',
      contextEpoch: resumeInput.actualInstructionEnvelope.contextEpoch,
      planId: `resume-plan-${suffix}`,
      planContentId: `resume-plan-content-${suffix}`
    },
    prior: {
      admissionId: transaction.admissionId,
      admissionGeneration: transaction.admissionGeneration,
      transactionDigest: transaction.transactionDigest,
      ownerGeneration: owner?.ownerGeneration || 0,
      leaseRevision: owner?.leaseRevision || 0,
      ownerLeaseDigest: owner?.leaseDigest || null,
      ownerStatus: owner?.status || 'missing'
    },
    runtime: options.runtime || TEST_RUNTIME,
    liveness
  }, { nowMs })
  assert(['persisted', 'semantic-noop'].includes(candidateWrite.status), JSON.stringify(candidateWrite))
  return {
    input: { ...resumeInput, resumeCandidate: candidateWrite.candidate },
    candidate: candidateWrite.candidate,
    prior: { transaction, owner },
    metaDir,
    identity
  }
}

function recordAuthorizedOverviewEvolution(fixture, content, nowMs) {
  const metaDir = resolveTaskRecoveryMetaDir({
    activeRoot: fixture.root.activeRoot,
    project: fixture.root.project
  })
  const identity = {
    activeRoot: fixture.root.activeRoot,
    project: fixture.root.project,
    taskId: fixture.admission.taskId,
    taskStatus: 'active'
  }
  const recovery = readTaskRecoveryState({ metaDir, identity }, { nowMs })
  assert.strictEqual(recovery.status, 'fresh')
  const state = recovery.state
  const overviewPath = path.join(taskRootFor(fixture.input, fixture.admission), '00-问题概况.md')
  const operationId = `overview-evolution-${fixture.admission.taskId}`
  const plannedSetDigest = digest({ creates: [], modifies: [overviewPath], deletes: [], moves: [] })
  const footprint = {
    schemaVersion: 'MutationFootprintRecoveryProjectionV2',
    footprintDigest: digest({ operationId, overviewPath }),
    plannedSetDigest,
    coverage: 'complete',
    observationPlan: { targetGranularity: 'exact-target', plannedSetDigest },
    plannedCreates: [],
    plannedModifies: [overviewPath],
    plannedDeletes: [],
    plannedMoves: [],
    sourceTargets: [],
    targetTargets: [overviewPath],
    normalizedTargets: [overviewPath]
  }
  const preObservation = createMutationPreObservation({ operationId, footprint }, { nowMs: nowMs - 3000 })
  fs.writeFileSync(overviewPath, content)
  const observation = observeMutationEffects({
    operationId,
    decision: { decisionDigest: 'd'.repeat(64), templateBindings: [] },
    lease: { leaseDigest: 'e'.repeat(64), operationId },
    footprint,
    preObservation,
    trackedContentPaths: [overviewPath],
    payload: { success: true },
    success: true
  }, { nowMs: nowMs - 1000 })
  assert.strictEqual(observation.status, 'consumed')
  const applied = ['created', 'modified', 'deleted', 'moved']
    .some(kind => Array.isArray(observation.observedEffects?.[kind]) && observation.observedEffects[kind].length > 0)
  const recordSemantic = {
    schemaVersion: 'TaskOperationRecordV1',
    operationId,
    idempotencyKey: `idem-${operationId}`,
    writerGeneration: state.fencedWriteOwner.ownerGeneration,
    expectedStateSequence: recovery.commitFence.stateSequence,
    kind: 'update',
    exactTargets: [overviewPath],
    targetSetDigest: taskOperationTargetSetDigest([overviewPath]),
    beforeDigest: preObservation.snapshotDigest,
    phase: 'settled',
    effect: applied ? 'known-applied' : 'known-not-applied',
    preparedAt: new Date(nowMs - 4000).toISOString(),
    dispatchedAt: new Date(nowMs - 3000).toISOString(),
    observedAt: new Date(nowMs - 1000).toISOString(),
    settledAt: new Date(nowMs).toISOString(),
    resultDigest: observation.receiptDigest,
    evidenceDigest: observation.closeout.closeoutDigest
  }
  const operationRecord = {
    ...recordSemantic,
    recordDigest: taskOperationRecordDigest(recordSemantic)
  }
  const canonicalRevision = advanceTaskCanonicalRevision(state, {
    overviewPath,
    preObservation,
    observation,
    operationRecord,
    closeout: observation.closeout
  })
  assert.strictEqual(validateTaskCanonicalRevision(canonicalRevision, state.admissionTransaction).valid, true)
  const persisted = updateTaskRecoveryState({ metaDir, identity }, current => {
    current.taskCanonicalRevision = canonicalRevision
    return current
  }, { nowMs, force: true, reason: 'test-authorized-canonical-overview-evolution', ...STORE_OPTIONS })
  assert(['committed', 'semantic-noop'].includes(persisted.status), persisted.errorCode || persisted.status)
  return canonicalRevision
}

function createFinalizedResumeFixture(name) {
  const root = setupRoot(name)
  const input = admissionInput(root, name)
  const admission = run(input)
  confirmCp1(taskRootFor(input, admission))
  const owner = runOwner(ownerInput(input, admission, 'acquire', { expectedOwner: { mode: 'absent' } }))
  assert.strictEqual(owner.finalized, true)
  assert.strictEqual(owner.mutationAuthority, true)
  return { root, input, admission, owner }
}

function createOwnerFencedCrashFixture(name) {
  const root = setupRoot(name)
  const input = admissionInput(root, name)
  input.ingressSnapshotRef = admissionIngressSnapshotRef(input, name)
  const admission = run(input)
  confirmCp1(taskRootFor(input, admission))
  assert.throws(
    () => runOwner(ownerInput(input, admission, 'acquire', { expectedOwner: { mode: 'absent' } }), NOW_MS, {
      faultInjector(stage) {
        if (stage === 'after-owner-fenced') {
          throw Object.assign(new Error('fixture process exited after owner fence'), {
            code: 'FIXTURE_OWNER_FENCED_PROCESS_EXIT'
          })
        }
      }
    }),
    error => error.code === 'FIXTURE_OWNER_FENCED_PROCESS_EXIT'
  )
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot: root.activeRoot, project: root.project })
  const identity = { activeRoot: root.activeRoot, project: root.project, taskId: admission.taskId, taskStatus: 'active' }
  const crashed = readTaskRecoveryState({ metaDir, identity }, { nowMs: NOW_MS })
  assert.strictEqual(crashed.status, 'fresh')
  assert.strictEqual(crashed.state.admissionTransaction.phase, 'owner-fenced')
  assert.strictEqual(crashed.state.admissionTransaction.status, 'admitting')
  assert.strictEqual(crashed.state.admissionTransaction.continuationLease.status, 'consumed')
  assert.strictEqual(
    crashed.state.admissionTransaction.continuationLease.ownerLeaseDigest,
    crashed.state.fencedWriteOwner.leaseDigest
  )
  return { root, input, admission, metaDir, identity, crashed, owner: crashed.state.fencedWriteOwner }
}

function ownerFencedResumeInput(fixture, suffix = 'resume') {
  const resume = admissionInput(fixture.root, `${fixture.root.project}-${suffix}`, {
    routeTaskKind: 'resume',
    routeCandidate: 'resume'
  })
  return {
    ...resume,
    operation: 'bind',
    task: {
      taskId: fixture.admission.taskId,
      taskKind: fixture.input.task.taskKind,
      entryVariant: 'continue',
      taskRootRelative: fixture.admission.taskRootRelative
    },
    overview: { content: fixture.input.overview.content },
    serverRuntime: TEST_RUNTIME
  }
}

function rewriteAsLegacyOwnerlessFinalizedState(fixture, nowMs) {
  const metaDir = resolveTaskRecoveryMetaDir({
    activeRoot: fixture.root.activeRoot,
    project: fixture.root.project
  })
  const identity = normalizeIdentity({
    activeRoot: fixture.root.activeRoot,
    project: fixture.root.project,
    taskId: fixture.admission.taskId,
    taskStatus: 'active'
  })
  const recovery = readTaskRecoveryState({ metaDir, identity }, { nowMs })
  assert.strictEqual(recovery.status, 'fresh')
  const legacyState = JSON.parse(JSON.stringify(recovery.state))
  delete legacyState.taskRecoveryCommitFence
  delete legacyState.fencedWriteOwner
  delete legacyState.previousFencedWriteOwner
  delete legacyState.resumeIngressCapabilityRef
  delete legacyState.taskCanonicalRevision
  const taskStore = taskPaths(storePaths(metaDir), identity.recoveryKey)
  const resolvedTaskStore = path.resolve(taskStore.dir)
  const resolvedTempRoot = `${path.resolve(TEMP_ROOT)}${path.sep}`
  assert(resolvedTaskStore.startsWith(resolvedTempRoot), 'legacy rewrite must stay inside the isolated test root')
  fs.rmSync(resolvedTaskStore, { recursive: true, force: true })
  const committed = commitTaskRecoveryState({ metaDir, identity, state: legacyState }, {
    nowMs,
    force: true,
    reason: 'test-legacy-ownerless-finalized-state',
    ...STORE_OPTIONS
  })
  assert.strictEqual(committed.status, 'committed', JSON.stringify(committed))
  assert.strictEqual(committed.writerGeneration, 0)
  const readback = readTaskRecoveryState({ metaDir, identity }, { nowMs })
  assert.strictEqual(readback.status, 'fresh')
  assert.strictEqual(readback.state.fencedWriteOwner, undefined)
  assert.strictEqual(readback.commitFence.writerGeneration, 0)
  return readback
}

try {
  const baseRoot = setupRoot('base')
  const baseInput = admissionInput(baseRoot)
  const leaseBinding = {
    project: baseInput.project,
    activeRoot: baseInput.activeRoot,
    physicalRoot: baseRoot.physicalRoot,
    contextEpoch: baseInput.actualInstructionEnvelope.contextEpoch,
    routeRevision: baseInput.workflowRouteDecision.routeRevision
  }
  assert.strictEqual(validateProjectTargetLease(baseInput.projectTargetLease, leaseBinding, { nowMs: NOW_MS }).valid, true)
  const stringTimeLeaseCore = { ...baseInput.projectTargetLease, issuedAtMs: String(NOW_MS - 1000) }
  delete stringTimeLeaseCore.leaseDigest
  const stringTimeLease = {
    ...stringTimeLeaseCore,
    leaseDigest: computeProjectTargetLeaseDigest(stringTimeLeaseCore)
  }
  assert(validateProjectTargetLease(stringTimeLease, leaseBinding, { nowMs: NOW_MS }).errors.includes('lease-time'),
    'ProjectTargetLease times must be real safe integers, not numeric strings')
  const relativePhysicalLeaseCore = { ...baseInput.projectTargetLease, physicalRoot: '.' }
  delete relativePhysicalLeaseCore.leaseDigest
  const relativePhysicalLease = {
    ...relativePhysicalLeaseCore,
    leaseDigest: computeProjectTargetLeaseDigest(relativePhysicalLeaseCore)
  }
  assert(validateProjectTargetLease(relativePhysicalLease, leaseBinding, { nowMs: NOW_MS }).errors.includes('physical-root'),
    'ProjectTargetLease physicalRoot must be a non-empty absolute path')
  const first = run(baseInput)
  assert.strictEqual(first.schemaVersion, 'FormalTaskAdmissionReceiptV2')
  assert.strictEqual(first.status, 'awaiting-owner-fence')
  assert.strictEqual(first.phase, 'cp-state-written')
  assert.strictEqual(first.finalized, false)
  assert.strictEqual(first.mutationAuthority, false)

  const baseTaskRoot = taskRootFor(baseInput, first)
  const identityPath = path.join(baseTaskRoot, '.memory', 'task.json')
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'))
  assert.strictEqual(identity.schemaVersion, 'TaskIdentityV2')
  assert.strictEqual(validateTaskIdentity(identity).valid, true)
  assert.strictEqual(fs.readFileSync(path.join(baseTaskRoot, '00-问题概况.md'), 'utf8'), baseInput.overview.content)
  const sessions = fs.readFileSync(path.join(baseTaskRoot, '.memory', 'sessions.md'), 'utf8')
  assert.match(sessions, /\| CP1 \| ⏳ \|/u)
  assert.doesNotMatch(sessions, /\| CP1 \| ✅ \|/u)

  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot: baseRoot.activeRoot, project: baseRoot.project })
  const recoveryIdentity = { activeRoot: baseRoot.activeRoot, project: baseRoot.project, taskId: first.taskId }
  const sessionBoundRecovery = readTaskRecoveryState({
    metaDir,
    sessionKey: 'session-base',
    expectedIdentity: { activeRoot: baseRoot.activeRoot, project: baseRoot.project }
  })
  assert.strictEqual(sessionBoundRecovery.status, 'fresh')
  assert.strictEqual(sessionBoundRecovery.identity.taskId, first.taskId)
  const digestBoundRecovery = readTaskRecoveryState({
    metaDir,
    hostSessionDigest: baseInput.actualInstructionEnvelope.hostSessionDigest,
    expectedIdentity: { activeRoot: baseRoot.activeRoot, project: baseRoot.project }
  })
  assert.strictEqual(digestBoundRecovery.status, 'fresh')
  assert.strictEqual(digestBoundRecovery.identity.taskId, first.taskId)
  const beforeReplay = readTaskAdmissionTransaction({ metaDir, identity: recoveryIdentity })
  const producedSession = beforeReplay.transaction.effects.cpState.file
  assert.strictEqual(producedSession.templateProduction.schemaVersion, 'ArtifactTemplateProductionV1')
  assert.strictEqual(producedSession.templateProductionScope, 'whole-document')
  assert.strictEqual(producedSession.templateProduction.artifactDigest,
    crypto.createHash('sha256').update(sessions).digest('hex'))
  assert.strictEqual(producedSession.templateIncludes[0].blockId, 'pending-cp')

  // Exercise the real admission producer against changed template bytes; a
  // matching heading or a declared binding alone cannot satisfy this proof.
  const templateRoot = path.join(TEMP_ROOT, 'template-runtime')
  const templatePath = path.join(templateRoot, 'content', 'prompts', 'requirement-session.prompt.md')
  fs.mkdirSync(path.dirname(templatePath), { recursive: true })
  const templateSource = fs.readFileSync(path.join(__dirname, '..', 'content', 'prompts', 'requirement-session.prompt.md'), 'utf8')
  const templateDelta = `模板变更传播 ${crypto.randomUUID()}`
  fs.writeFileSync(templatePath, templateSource.replace('{{cpTable}}', `{{cpTable}}\n\n${templateDelta}`))
  const templateInput = admissionInput(setupRoot('template-production'), 'template-production')
  const templateAdmission = run(templateInput, { runtimeRoot: templateRoot })
  assert.strictEqual(templateAdmission.phase, 'cp-state-written')
  const changedSessions = fs.readFileSync(path.join(taskRootFor(templateInput, templateAdmission), '.memory', 'sessions.md'), 'utf8')
  assert(changedSessions.includes(templateDelta), 'actual producer must use changed template body')
  const changedJournal = readTaskAdmissionTransaction({
    metaDir: resolveTaskRecoveryMetaDir({ activeRoot: templateInput.activeRoot, project: templateInput.project }),
    identity: { activeRoot: templateInput.activeRoot, project: templateInput.project, taskId: templateAdmission.taskId }
  })
  assert.notStrictEqual(changedJournal.transaction.effects.cpState.file.templateProduction.templateDigest,
    producedSession.templateProduction.templateDigest)
  assert.strictEqual(beforeReplay.status, 'fresh')
  assert.strictEqual(beforeReplay.transaction.phase, 'cp-state-written')
  const beforeSequence = beforeReplay.envelope.sequence
  const beforeFiles = fs.readdirSync(storePaths(metaDir).tasks, { recursive: true }).map(String).sort()
  for (let index = 0; index < 100; index += 1) {
    const replay = run(baseInput)
    assert.strictEqual(replay.admissionId, first.admissionId)
    assert.strictEqual(replay.taskId, first.taskId)
    assert.strictEqual(replay.replayed, true)
  }
  const refreshedBaseInput = {
    ...baseInput,
    projectTargetLease: refreshedProjectLease(baseInput.projectTargetLease)
  }
  const refreshedReplay = run(refreshedBaseInput)
  assert.strictEqual(refreshedReplay.admissionId, first.admissionId)
  assert.strictEqual(refreshedReplay.replayed, true, 'lease TTL/context-plan refresh must preserve admission idempotency')
  const nextContextBaseInput = refreshedIngressContext(baseInput, 'base', 'ctx-base-next-turn')
  assert.notStrictEqual(nextContextBaseInput.actualInstructionEnvelope.envelopeDigest, baseInput.actualInstructionEnvelope.envelopeDigest)
  assert.notStrictEqual(nextContextBaseInput.workflowRouteDecision.decisionDigest, baseInput.workflowRouteDecision.decisionDigest)
  assert.strictEqual(nextContextBaseInput.actualInstructionEnvelope.actualInstructionDigest, baseInput.actualInstructionEnvelope.actualInstructionDigest)
  assert.strictEqual(nextContextBaseInput.workflowRouteDecision.workItemDigest, baseInput.workflowRouteDecision.workItemDigest)
  const nextContextReplay = run(nextContextBaseInput)
  assert.strictEqual(nextContextReplay.admissionId, first.admissionId)
  assert.strictEqual(nextContextReplay.replayed, true, 'a real next-turn context refresh must preserve semantic admission idempotency')
  assert.throws(
    () => run({
      ...nextContextBaseInput,
      projectTargetLease: refreshedProjectLease(nextContextBaseInput.projectTargetLease, { targetDigest: '7'.repeat(64) })
    }),
    error => error.code === 'TASK_ADMISSION_IDEMPOTENCY_CONFLICT',
    'a semantic project target drift must not replay an existing admission'
  )
  const afterReplay = readTaskAdmissionTransaction({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(afterReplay.envelope.sequence, beforeSequence)
  assert.deepStrictEqual(fs.readdirSync(storePaths(metaDir).tasks, { recursive: true }).map(String).sort(), beforeFiles)

  const identityBytes = fs.readFileSync(identityPath)
  const overviewBytes = fs.readFileSync(path.join(baseTaskRoot, '00-问题概况.md'))
  assert.throws(
    () => run({ ...baseInput, overview: { content: '# 不同内容\n' } }),
    error => error.code === 'TASK_ADMISSION_IDEMPOTENCY_CONFLICT'
  )
  assert.deepStrictEqual(fs.readFileSync(identityPath), identityBytes)
  assert.deepStrictEqual(fs.readFileSync(path.join(baseTaskRoot, '00-问题概况.md')), overviewBytes)
  fs.writeFileSync(path.join(baseTaskRoot, '00-问题概况.md'), '# 被篡改的概况\n')
  assert.throws(() => run(baseInput), error => error.code === 'TASK_ADMISSION_READBACK_MISMATCH')
  fs.writeFileSync(path.join(baseTaskRoot, '00-问题概况.md'), overviewBytes)

  const productRoot = setupRoot('product-provided')
  const productOverview = '# 需求概况\n\n来源：用户直接提供完整产品需求；本文件只保存来源、范围与映射。\n'
  const productSource = '# 产品需求\n\n这是用户提供的原始产品真相，准入链不得改写。\n'
  const productInput = admissionInput(productRoot, 'product-provided', {
    routeTaskKind: 'dev',
    routeCandidate: 'dev.default',
    task: {
      taskKind: 'requirements',
      entryVariant: 'product-provided',
      displayName: '产品提供型需求',
      aliases: ['原始产品需求']
    },
    overview: {
      content: productOverview,
      productSourceContent: productSource
    }
  })
  const productAdmission = run(productInput)
  const productTaskRoot = taskRootFor(productInput, productAdmission)
  const productOverviewPath = path.join(productTaskRoot, '00-需求概况.md')
  const productSourcePath = path.join(productTaskRoot, '01-产品需求.md')
  assert.strictEqual(fs.readFileSync(productOverviewPath, 'utf8'), productOverview)
  assert.strictEqual(fs.readFileSync(productSourcePath, 'utf8'), productSource)
  assert.strictEqual(fs.existsSync(path.join(productTaskRoot, '01-需求确认.md')), false)
  assert.match(fs.readFileSync(path.join(productTaskRoot, '.memory', 'sessions.md'), 'utf8'), /\| CP1 \| ⏳ \|/u)
  const productOverviewBytes = fs.readFileSync(productOverviewPath)
  const productSourceBytes = fs.readFileSync(productSourcePath)
  const productReplay = run(productInput)
  assert.strictEqual(productReplay.admissionId, productAdmission.admissionId)
  assert.strictEqual(productReplay.taskId, productAdmission.taskId)
  assert.strictEqual(productReplay.replayed, true)
  assert.throws(() => run({
    ...productInput,
    overview: { ...productInput.overview, productSourceContent: `${productSource}\n不得替换。\n` }
  }), error => error.code === 'TASK_ADMISSION_IDEMPOTENCY_CONFLICT')
  assert.deepStrictEqual(fs.readFileSync(productOverviewPath), productOverviewBytes)
  assert.deepStrictEqual(fs.readFileSync(productSourcePath), productSourceBytes)

  const legacyReplayRoot = setupRoot('legacy-request-digest-replay')
  const legacyReplayInput = admissionInput(legacyReplayRoot, 'legacy-request-digest-replay')
  const legacyReplayAdmission = run(legacyReplayInput)
  const legacyReplayMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: legacyReplayRoot.activeRoot,
    project: legacyReplayRoot.project
  })
  const legacyReplayIdentity = {
    activeRoot: legacyReplayRoot.activeRoot,
    project: legacyReplayRoot.project,
    taskId: legacyReplayAdmission.taskId
  }
  const legacyReplayRead = readTaskAdmissionTransaction({ metaDir: legacyReplayMetaDir, identity: legacyReplayIdentity })
  const legacyTransaction = JSON.parse(JSON.stringify(legacyReplayRead.transaction))
  delete legacyTransaction.requestDigestSchema
  delete legacyTransaction.requestDigestSemantics
  delete legacyTransaction.projectTargetLeaseBindingDigest
  legacyTransaction.requestDigest = legacyAdmissionRequestDigest(legacyReplayInput, legacyTransaction)
  legacyTransaction.transactionDigest = taskAdmissionTransactionDigest(legacyTransaction)
  const legacyDowngrade = updateTaskRecoveryState({
    metaDir: legacyReplayMetaDir,
    identity: legacyReplayIdentity
  }, state => ({ ...state, admissionTransaction: legacyTransaction }), STORE_OPTIONS)
  assert.strictEqual(legacyDowngrade.status, 'committed')
  const legacyLeaseReplay = run({
    ...legacyReplayInput,
    projectTargetLease: refreshedProjectLease(legacyReplayInput.projectTargetLease)
  })
  assert.strictEqual(legacyLeaseReplay.admissionId, legacyReplayAdmission.admissionId)
  assert.strictEqual(legacyLeaseReplay.replayed, true, 'pre-V2 request digests must replay across lease-only refresh')
  fs.writeFileSync(productSourcePath, '# 被篡改的产品需求\n')
  assert.throws(() => run(productInput), error => error.code === 'TASK_ADMISSION_READBACK_MISMATCH')
  fs.writeFileSync(productSourcePath, productSourceBytes)
  const productRebindInput = admissionInput(productRoot, 'product-provided-next', {
    operation: 'bind',
    routeTaskKind: 'dev',
    routeCandidate: 'dev.default',
    task: {
      taskId: productAdmission.taskId,
      taskKind: 'requirements',
      entryVariant: 'continue',
      taskRootRelative: productAdmission.taskRootRelative
    },
    overview: { content: '# 当前消息不得替换产品型需求真相\n' }
  })
  fs.writeFileSync(productSourcePath, '# 跨会话接管前发生篡改\n')
  assert.throws(
    () => run(productRebindInput),
    error => error.code === 'TASK_ADMISSION_READBACK_MISMATCH',
    'awaiting-owner rebind must verify the durable product requirement source'
  )
  fs.writeFileSync(productSourcePath, productSourceBytes)
  const reboundProductAdmission = run(productRebindInput)
  assert.strictEqual(reboundProductAdmission.recovery.mode, 'awaiting-owner-rebind')
  assert.deepStrictEqual(fs.readFileSync(productSourcePath), productSourceBytes)

  const awaitingOwnerRoot = setupRoot('awaiting-owner-rebind')
  const awaitingOwnerInput = admissionInput(awaitingOwnerRoot, 'awaiting-owner-rebind')
  const awaitingOwnerAdmission = run(awaitingOwnerInput)
  const awaitingOwnerTaskRoot = taskRootFor(awaitingOwnerInput, awaitingOwnerAdmission)
  const awaitingOwnerOverview = fs.readFileSync(path.join(awaitingOwnerTaskRoot, '00-问题概况.md'), 'utf8')
  confirmCp1(awaitingOwnerTaskRoot)
  const awaitingOwnerRebindInput = admissionInput(awaitingOwnerRoot, 'awaiting-owner-rebind-next', {
    operation: 'bind',
    task: {
      taskId: awaitingOwnerAdmission.taskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: awaitingOwnerAdmission.taskRootRelative
    },
    overview: { content: '# 当前消息不得替换 canonical overview\n' }
  })
  awaitingOwnerRebindInput.projectTargetLease = refreshedProjectLease(
    awaitingOwnerRebindInput.projectTargetLease,
    { rootIdentityDigest: '8'.repeat(64) }
  )
  const reboundAwaitingOwner = run(awaitingOwnerRebindInput)
  assert.notStrictEqual(reboundAwaitingOwner.admissionId, awaitingOwnerAdmission.admissionId)
  assert.strictEqual(reboundAwaitingOwner.admissionGeneration, awaitingOwnerAdmission.admissionGeneration + 1)
  assert.strictEqual(reboundAwaitingOwner.recovery.mode, 'awaiting-owner-rebind')
  assert.strictEqual(reboundAwaitingOwner.recovery.priorAdmissionId, awaitingOwnerAdmission.admissionId)
  const reboundAwaitingOwnerTransaction = readTaskAdmissionTransaction({
    metaDir: resolveTaskRecoveryMetaDir({
      activeRoot: awaitingOwnerRoot.activeRoot,
      project: awaitingOwnerRoot.project
    }),
    identity: {
      activeRoot: awaitingOwnerRoot.activeRoot,
      project: awaitingOwnerRoot.project,
      taskId: reboundAwaitingOwner.taskId
    }
  }).transaction
  const invalidRecoveryTransaction = JSON.parse(JSON.stringify(reboundAwaitingOwnerTransaction))
  invalidRecoveryTransaction.recovery.priorTransactionDigest = 'invalid'
  invalidRecoveryTransaction.transactionDigest = taskAdmissionTransactionDigest(invalidRecoveryTransaction)
  assert(
    validateTaskAdmissionTransaction(invalidRecoveryTransaction).errors.includes('recovery-prior-transaction-digest'),
    'awaiting-owner recovery metadata must be schema-validated independently of the transaction digest'
  )
  assert.strictEqual(
    fs.readFileSync(path.join(awaitingOwnerTaskRoot, '00-问题概况.md'), 'utf8'),
    awaitingOwnerOverview,
    'cross-session recovery must reuse rather than replace the canonical overview'
  )
  assert.throws(
    () => runOwner(ownerInput(awaitingOwnerRebindInput, reboundAwaitingOwner, 'acquire'), NOW_MS, {
      faultInjector(stage) {
        if (stage === 'after-owner-fenced') {
          throw Object.assign(new Error('generation-2 fixture exited after owner fence'), {
            code: 'FIXTURE_GENERATION_2_OWNER_FENCED_EXIT'
          })
        }
      }
    }),
    error => error.code === 'FIXTURE_GENERATION_2_OWNER_FENCED_EXIT'
  )
  const awaitingOwnerCrashResume = admissionInput(awaitingOwnerRoot, 'awaiting-owner-rebind-resume', {
    operation: 'bind',
    routeTaskKind: 'resume',
    routeCandidate: 'resume',
    task: {
      taskId: awaitingOwnerAdmission.taskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: awaitingOwnerAdmission.taskRootRelative
    },
    overview: { content: awaitingOwnerOverview }
  })
  awaitingOwnerCrashResume.projectTargetLease = refreshedProjectLease(
    awaitingOwnerCrashResume.projectTargetLease,
    { rootIdentityDigest: '8'.repeat(64) }
  )
  const reboundAwaitingOwnerRecovery = recoverOwnerFencedAdmissionForResume(awaitingOwnerCrashResume, {
    nowMs: NOW_MS,
    storeOptions: STORE_OPTIONS
  })
  assert.strictEqual(reboundAwaitingOwnerRecovery.status, 'recovered')
  assert.strictEqual(reboundAwaitingOwnerRecovery.mutationAuthority, false)
  const reboundAwaitingOwnerRead = readTaskRecoveryState({
    metaDir: resolveTaskRecoveryMetaDir({ activeRoot: awaitingOwnerRoot.activeRoot, project: awaitingOwnerRoot.project }),
    identity: {
      activeRoot: awaitingOwnerRoot.activeRoot,
      project: awaitingOwnerRoot.project,
      taskId: reboundAwaitingOwner.taskId,
      taskStatus: 'active'
    }
  }, { nowMs: NOW_MS })
  assert.strictEqual(reboundAwaitingOwnerRead.state.admissionTransaction.phase, 'finalized')
  assert.strictEqual(reboundAwaitingOwnerRead.state.admissionTransaction.admissionGeneration, 2)
  assert.strictEqual(reboundAwaitingOwnerRead.state.admissionTransaction.recovery.mode, 'awaiting-owner-rebind')
  assert.strictEqual(reboundAwaitingOwnerRead.state.fencedWriteOwner.projectRootIdentity, '8'.repeat(64))

  const activeContinuationGuardRoot = setupRoot('awaiting-owner-active-continuation')
  let activeContinuationGuardInput = admissionInput(activeContinuationGuardRoot, 'awaiting-owner-active-continuation')
  activeContinuationGuardInput = {
    ...activeContinuationGuardInput,
    ingressSnapshotRef: admissionIngressSnapshotRef(activeContinuationGuardInput, 'awaiting-owner-active-continuation')
  }
  const activeContinuationGuardAdmission = run(activeContinuationGuardInput)
  const blockedActiveContinuationInput = admissionInput(activeContinuationGuardRoot, 'awaiting-owner-active-continuation-next', {
    operation: 'bind',
    task: {
      taskId: activeContinuationGuardAdmission.taskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: activeContinuationGuardAdmission.taskRootRelative
    },
    overview: { content: '# 不得抢占仍有效的 continuation lease\n' }
  })
  assert.throws(
    () => run(blockedActiveContinuationInput),
    error => error.code === 'TASK_ADMISSION_IDEMPOTENCY_CONFLICT',
    'a still-active continuation lease must prevent cross-session awaiting-owner takeover'
  )

  const continuationRoot = setupRoot('admission-continuation')
  let continuationInput = admissionInput(continuationRoot, 'admission-continuation')
  continuationInput = {
    ...continuationInput,
    ingressSnapshotRef: admissionIngressSnapshotRef(continuationInput, 'admission-continuation')
  }
  const continuationAdmission = run(continuationInput)
  assert.strictEqual(continuationAdmission.continuationLease.status, 'active')
  const continuationMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: continuationRoot.activeRoot,
    project: continuationRoot.project
  })
  const continuationIdentity = {
    activeRoot: continuationRoot.activeRoot,
    project: continuationRoot.project,
    taskId: continuationAdmission.taskId
  }
  const continuationPrepared = readTaskAdmissionTransaction({
    metaDir: continuationMetaDir,
    identity: continuationIdentity
  }).transaction
  assert.strictEqual(validateAdmissionContinuationLease(continuationPrepared.continuationLease, continuationPrepared).valid, true)
  confirmCp1(taskRootFor(continuationInput, continuationAdmission))
  const continuationOwnerInput = ownerInput(continuationInput, continuationAdmission, 'acquire')
  const missingSnapshotOwnerInput = { ...continuationOwnerInput }
  delete missingSnapshotOwnerInput.ingressSnapshotRef
  assert.throws(
    () => runOwner(missingSnapshotOwnerInput),
    error => error.code === 'TASK_ADMISSION_CONTINUATION_MISMATCH'
  )
  assert.throws(
    () => runOwner({
      ...continuationOwnerInput,
      ingressSnapshotRef: { ...continuationInput.ingressSnapshotRef, snapshotKey: 'f'.repeat(64) }
    }),
    error => error.code === 'TASK_ADMISSION_CONTINUATION_MISMATCH'
  )
  const continuationOwner = runOwner(continuationOwnerInput)
  assert.strictEqual(continuationOwner.finalized, true)
  assert.strictEqual(continuationOwner.mutationAuthority, true)
  assert.strictEqual(continuationOwner.continuationLease.status, 'consumed')
  assert.strictEqual(continuationOwner.continuationLease.ownerLeaseDigest, continuationOwner.owner.leaseDigest)
  assert.strictEqual(runOwner(continuationOwnerInput).replayed, true, 'exact continuation replay must be idempotent')

  const expiredContinuationRoot = setupRoot('admission-continuation-expired')
  let expiredContinuationInput = admissionInput(expiredContinuationRoot, 'admission-continuation-expired')
  expiredContinuationInput = {
    ...expiredContinuationInput,
    ingressSnapshotRef: admissionIngressSnapshotRef(expiredContinuationInput, 'admission-continuation-expired')
  }
  const expiredContinuationAdmission = run(expiredContinuationInput)
  confirmCp1(taskRootFor(expiredContinuationInput, expiredContinuationAdmission))
  assert.throws(
    () => runOwner(
      ownerInput(expiredContinuationInput, expiredContinuationAdmission, 'acquire'),
      NOW_MS + 31 * 60 * 1000
    ),
    error => error.code === 'TASK_ADMISSION_CONTINUATION_EXPIRED'
  )
  let expiredContinuationRebindInput = admissionInput(expiredContinuationRoot, 'admission-continuation-expired-next', {
    operation: 'bind',
    task: {
      taskId: expiredContinuationAdmission.taskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: expiredContinuationAdmission.taskRootRelative
    },
    overview: { content: '# expired lease 后复用 canonical overview\n' }
  })
  expiredContinuationRebindInput = {
    ...expiredContinuationRebindInput,
    ingressSnapshotRef: admissionIngressSnapshotRef(expiredContinuationRebindInput, 'admission-continuation-expired-next')
  }
  const expiredContinuationRebound = run(expiredContinuationRebindInput, { nowMs: NOW_MS + 31 * 60 * 1000 })
  assert.strictEqual(expiredContinuationRebound.recovery.mode, 'awaiting-owner-rebind')
  const expiredContinuationOwner = runOwner(
    ownerInput(expiredContinuationRebindInput, expiredContinuationRebound, 'acquire'),
    NOW_MS + 31 * 60 * 1000
  )
  assert.strictEqual(expiredContinuationOwner.finalized, true)
  assert.strictEqual(expiredContinuationOwner.mutationAuthority, true)

  const ownerRoot = setupRoot('owner-transitions')
  const ownerAdmissionInput = admissionInput(ownerRoot, 'owner-transitions')
  const ownerAdmission = run(ownerAdmissionInput)
  const initialAcquireInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'acquire', {
    expectedOwner: { mode: 'absent' }
  })
  const initialOwner = runOwner(initialAcquireInput)
  assert.strictEqual(initialOwner.finalized, true)
  assert.strictEqual(initialOwner.cp1Confirmed, false)
  assert.strictEqual(initialOwner.mutationAuthority, false)
  assert.strictEqual(initialOwner.writeContext.schemaVersion, 'CanonicalTaskWriteContextV1')
  assert.strictEqual(initialOwner.writeContext.readback, 'PASS')
  assert.strictEqual(initialOwner.writeContext.writerGeneration, initialOwner.owner.ownerGeneration)
  assert.strictEqual(initialOwner.writeContext.mutationAuthority, false)
  assert.strictEqual(runOwner(initialAcquireInput).replayed, true, 'acquire response-loss retry must be exact replay')
  const prematureTerminalInput = withTerminalExpectedState(ownerAdmissionInput, ownerAdmission, {
    ...ownerInput(ownerAdmissionInput, ownerAdmission, 'release', { expectedOwner: ownerRef(initialOwner) }),
    terminalStatus: 'completed',
    evidence: evidenceSet(ownerAdmissionInput, ownerAdmission, 'premature')
  }, NOW_MS)
  delete prematureTerminalInput.operation
  assert.throws(
    () => executeWorkflowTaskTerminal(prematureTerminalInput, { nowMs: NOW_MS, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_CP_CONFIRMATION_REQUIRED'
  )

  confirmCp1(taskRootFor(ownerAdmissionInput, ownerAdmission))
  const firstRenewInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'renew', {
    expectedOwner: ownerRef(initialOwner)
  })
  const firstRenew = runOwner(firstRenewInput)
  assert.strictEqual(firstRenew.cp1Confirmed, true)
  assert.strictEqual(firstRenew.mutationAuthority, true)
  assert.strictEqual(firstRenew.writeContext.mutationAuthority, true)
  assert.strictEqual(firstRenew.writeContext.holderSession, firstRenew.owner.sessionDigest)
  assert.match(firstRenew.writeContext.contextDigest, /^[a-f0-9]{64}$/)
  assert.strictEqual(runOwner(firstRenewInput).replayed, true, 'renew response-loss retry must not advance the lease')
  const secondRenewInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'renew', {
    expectedOwner: ownerRef(firstRenew)
  })
  const secondRenew = runOwner(secondRenewInput)
  assert(secondRenew.owner.leaseRevision > firstRenew.owner.leaseRevision)
  const renewedReadiness = readFormalTaskExecutionReadiness({
    activeRoot: ownerRoot.activeRoot,
    project: ownerRoot.project,
    taskId: ownerAdmission.taskId,
    expectedOwnerSessionDigest: secondRenew.owner.sessionDigest,
    requiredCpPhases: ['CP1']
  })
  assert.strictEqual(renewedReadiness.status, 'ready')
  assert.strictEqual(renewedReadiness.ownerLeaseDigest, secondRenew.owner.leaseDigest)
  assert.throws(
    () => readFormalTaskExecutionReadiness({
      activeRoot: ownerRoot.activeRoot,
      project: ownerRoot.project,
      taskId: ownerAdmission.taskId,
      expectedOwnerSessionDigest: 'f'.repeat(64),
      requiredCpPhases: ['CP1']
    }),
    error => error.code === 'FORMAL_TASK_EXECUTION_PREFLIGHT_OWNER_SESSION_MISMATCH',
    'a different host session must not inherit validation-card authority from the current owner'
  )
  assert.throws(
    () => readFormalTaskExecutionReadiness({
      activeRoot: ownerRoot.activeRoot,
      project: ownerRoot.project,
      taskId: ownerAdmission.taskId,
      expectedOwnerSessionDigest: secondRenew.owner.sessionDigest,
      requiredCpPhases: ['CP1'],
      taskState: {
        fencedWriteOwner: { leaseDigest: firstRenew.owner.leaseDigest }
      }
    }),
    error => error.code === 'FORMAL_TASK_EXECUTION_PREFLIGHT_OWNER_DRIFT',
    'a stale projected owner must not authorize a validation card'
  )
  assert.throws(
    () => runOwner(firstRenewInput),
    error => error.code === 'TASK_WRITE_OWNER_CAS_MISMATCH',
    'an older renew request must not replay after a newer owner transition'
  )

  const ownerNextContextInput = refreshedIngressContext(
    ownerAdmissionInput,
    'owner-transitions',
    'ctx-owner-transitions-next-turn'
  )
  const ownerNextContextAdmission = run(ownerNextContextInput)
  assert.strictEqual(ownerNextContextAdmission.admissionId, ownerAdmission.admissionId)
  assert.strictEqual(ownerNextContextAdmission.replayed, true)
  const nextContextRenewInput = ownerInput(ownerNextContextInput, ownerAdmission, 'renew', {
    expectedOwner: ownerRef(secondRenew)
  })
  const nextContextRenew = runOwner(nextContextRenewInput)
  assert.strictEqual(nextContextRenew.owner.contextEpoch, 'ctx-owner-transitions-next-turn')
  assert.strictEqual(nextContextRenew.owner.sessionDigest, secondRenew.owner.sessionDigest)
  assert.strictEqual(runOwner(nextContextRenewInput).replayed, true, 'same-session next-context renew must replay exactly')

  const releaseInput = ownerInput(ownerNextContextInput, ownerAdmission, 'release', {
    expectedOwner: ownerRef(nextContextRenew)
  })
  const released = runOwner(releaseInput)
  assert.strictEqual(released.status, 'released')
  assert.strictEqual(runOwner(releaseInput).replayed, true)
  const reacquireInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'acquire', {
    expectedOwner: ownerRef(released)
  })
  const reacquired = runOwner(reacquireInput)
  assert.strictEqual(reacquired.status, 'active')
  assert.strictEqual(reacquired.mutationAuthority, true)
  assert(reacquired.owner.ownerGeneration > released.owner.ownerGeneration)
  assert.strictEqual(runOwner(reacquireInput).replayed, true)
  assert.throws(() => runOwner(releaseInput), error => error.code === 'TASK_WRITE_OWNER_CAS_MISMATCH')

  const handoffIngress = admissionInput(ownerRoot, 'handoff-target')
  const handoffPrepareInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'handoff-prepare', {
    expectedOwner: ownerRef(reacquired),
    targetSessionDigest: handoffIngress.projectTargetLease.authorityDigest
  })
  const handoffPrepared = runOwner(handoffPrepareInput)
  assert.strictEqual(handoffPrepared.status, 'handoff-pending')
  assert.strictEqual(runOwner(handoffPrepareInput).replayed, true)
  const handoffAcceptInput = ownerInput(handoffIngress, ownerAdmission, 'handoff-accept', {
    expectedOwner: ownerRef(handoffPrepared),
    handoffRefDigest: handoffPrepared.owner.handoffRef.refDigest
  })
  const handoffAccepted = runOwner(handoffAcceptInput)
  assert.strictEqual(handoffAccepted.owner.sessionDigest, handoffIngress.projectTargetLease.authorityDigest)
  assert.strictEqual(runOwner(handoffAcceptInput).replayed, true)
  assert.throws(
    () => runOwner(ownerInput(ownerAdmissionInput, ownerAdmission, 'renew', { expectedOwner: ownerRef(reacquired) })),
    error => error.code === 'TASK_WRITE_OWNER_CAS_MISMATCH'
  )

  const takeoverAt = NOW_MS + 60 * 1000
  assert(Date.parse(handoffAccepted.owner.expiresAt) > takeoverAt, 'takeover proof must run before the prior owner TTL')
  const takeoverIngress = admissionInput(ownerRoot, 'takeover-target')
  const takeoverPrepareInput = ownerInput(takeoverIngress, ownerAdmission, 'takeover-prepare', {
    expectedOwner: ownerRef(handoffAccepted),
    serverObservation: {
      canonicalTaskReadback: true,
      noLiveTurn: true,
      reconcileReceiptDigest: '6'.repeat(64)
    }
  })
  const takeoverPrepared = runOwner(takeoverPrepareInput, takeoverAt)
  assert.strictEqual(takeoverPrepared.status, 'takeover-pending')
  assert.strictEqual(runOwner(takeoverPrepareInput, takeoverAt).replayed, true)
  const takeoverAcceptInput = ownerInput(takeoverIngress, ownerAdmission, 'takeover-accept', {
    expectedOwner: ownerRef(takeoverPrepared),
    takeoverRefDigest: takeoverPrepared.owner.takeoverRef.refDigest
  })
  const takeoverAccepted = runOwner(takeoverAcceptInput, takeoverAt)
  assert.strictEqual(takeoverAccepted.status, 'active')
  assert.strictEqual(runOwner(takeoverAcceptInput, takeoverAt).replayed, true)

  const rescueAt = takeoverAt + 31 * 60 * 1000
  const firstRescueIngress = admissionInput(ownerRoot, 'first-rescue')
  const firstRescueInput = ownerInput(firstRescueIngress, ownerAdmission, 'takeover-prepare', {
    expectedOwner: ownerRef(takeoverAccepted),
    serverObservation: { canonicalTaskReadback: true, noLiveTurn: true, reconcileReceiptDigest: '7'.repeat(64) }
  })
  const firstRescue = runOwner(firstRescueInput, rescueAt)
  const secondRescueIngress = admissionInput(ownerRoot, 'second-rescue')
  const secondRescueInput = ownerInput(secondRescueIngress, ownerAdmission, 'takeover-prepare', {
    expectedOwner: ownerRef(firstRescue),
    serverObservation: { canonicalTaskReadback: true, noLiveTurn: true, reconcileReceiptDigest: '8'.repeat(64) }
  })
  const secondRescue = runOwner(secondRescueInput, rescueAt + 1)
  assert.strictEqual(secondRescue.status, 'takeover-pending', 'an expired pending takeover must remain recoverable')
  assert(secondRescue.owner.ownerGeneration > firstRescue.owner.ownerGeneration)
  const secondRescueAcceptInput = ownerInput(secondRescueIngress, ownerAdmission, 'takeover-accept', {
    expectedOwner: ownerRef(secondRescue),
    takeoverRefDigest: secondRescue.owner.takeoverRef.refDigest
  })
  const terminalOwner = runOwner(secondRescueAcceptInput, rescueAt + 1)

  const terminalEvidence = evidenceSet(ownerAdmissionInput, ownerAdmission)
  const duplicateEvidence = terminalEvidence.map(item => ({ ...item }))
  duplicateEvidence[3] = { ...duplicateEvidence[0], role: 'completion' }
  const terminalAt = rescueAt + 1000
  const terminalCommand = withTerminalExpectedState(secondRescueIngress, ownerAdmission, {
    ...ownerInput(secondRescueIngress, ownerAdmission, 'release', {
      expectedOwner: ownerRef(terminalOwner)
    }),
    terminalStatus: 'completed',
    evidence: duplicateEvidence
  }, terminalAt)
  delete terminalCommand.operation
  assert.throws(
    () => executeWorkflowTaskTerminal({
      ...terminalCommand,
      expectedStateSequence: undefined
    }, { nowMs: terminalAt, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_EXPECTED_STATE_REQUIRED'
  )
  const beforeStaleTerminal = readTaskRecoveryState({
    metaDir: resolveTaskRecoveryMetaDir({ activeRoot: ownerRoot.activeRoot, project: ownerRoot.project }),
    identity: {
      activeRoot: ownerRoot.activeRoot,
      project: ownerRoot.project,
      taskId: ownerAdmission.taskId,
      taskStatus: 'active'
    }
  }, { nowMs: terminalAt })
  assert.throws(
    () => executeWorkflowTaskTerminal({
      ...terminalCommand,
      expectedStateSequence: terminalCommand.expectedStateSequence - 1
    }, { nowMs: terminalAt, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_STATE_CAS_MISMATCH'
  )
  const afterStaleTerminal = readTaskRecoveryState({
    metaDir: resolveTaskRecoveryMetaDir({ activeRoot: ownerRoot.activeRoot, project: ownerRoot.project }),
    identity: {
      activeRoot: ownerRoot.activeRoot,
      project: ownerRoot.project,
      taskId: ownerAdmission.taskId,
      taskStatus: 'active'
    }
  }, { nowMs: terminalAt })
  assert.strictEqual(afterStaleTerminal.commitFence.stateSequence, beforeStaleTerminal.commitFence.stateSequence)
  assert.strictEqual(afterStaleTerminal.envelope.payloadDigest, beforeStaleTerminal.envelope.payloadDigest)
  assert.throws(
    () => executeWorkflowTaskTerminal(terminalCommand, { nowMs: terminalAt, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_EVIDENCE_DUPLICATE'
  )
  terminalCommand.evidence = terminalEvidence
  const terminal = executeWorkflowTaskTerminal(terminalCommand, { nowMs: terminalAt, storeOptions: STORE_OPTIONS })
  assert.strictEqual(terminal.status, 'terminal')
  assert.strictEqual(terminal.mutationAuthority, false)
  assert.strictEqual(terminal.writeContext.ownerStatus, 'terminal')
  assert.strictEqual(terminal.writeContext.mutationAuthority, false)
  assert.strictEqual(terminal.writeContext.writerGeneration, terminal.owner.ownerGeneration)
  const terminalReplay = executeWorkflowTaskTerminal(terminalCommand, { nowMs: terminalAt, storeOptions: STORE_OPTIONS })
  assert.strictEqual(terminalReplay.replayed, true)
  assert.strictEqual(terminal.receipt.lifecycleRevision, 1)
  assert.strictEqual(terminal.receipt.settledSetDigest, terminalCommand.settledSetDigest)
  assert.throws(
    () => executeWorkflowTaskTerminal({ ...terminalCommand, terminalStatus: 'failed' }, { nowMs: terminalAt, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_REPLAY_MISMATCH'
  )
  assert.throws(
    () => runOwner(secondRescueAcceptInput, terminalAt),
    error => error.code === 'TASK_WRITE_OWNER_MISSING'
  )

  const reopenAt = terminalAt + 1000
  const reopenIngress = admissionInput(ownerRoot, 'owner-reopen', {
    operation: 'bind',
    task: {
      taskId: ownerAdmission.taskId,
      taskKind: 'bugs',
      entryVariant: 'reopen',
      taskRootRelative: ownerAdmission.taskRootRelative
    },
    overview: { content: ownerAdmissionInput.overview.content }
  })
  const reopenedAdmission = run(reopenIngress, { nowMs: reopenAt })
  assert.strictEqual(reopenedAdmission.admissionGeneration, ownerAdmission.admissionGeneration + 1)
  const terminalOwnerRef = {
    ownerGeneration: terminal.owner.ownerGeneration,
    ownerNonce: terminal.owner.ownerNonce,
    leaseRevision: terminal.owner.leaseRevision,
    leaseDigest: terminal.owner.leaseDigest
  }
  assert.throws(
    () => runOwner(ownerInput(reopenIngress, reopenedAdmission, 'reopen', {
      expectedOwner: { ...terminalOwnerRef, leaseDigest: '9'.repeat(64) }
    }), reopenAt),
    error => error.code === 'TASK_WRITE_OWNER_CAS_MISMATCH'
  )
  const reopenedOwnerInput = ownerInput(reopenIngress, reopenedAdmission, 'reopen', {
    expectedOwner: terminalOwnerRef
  })
  const reopenedOwner = runOwner(reopenedOwnerInput, reopenAt)
  assert.strictEqual(reopenedOwner.status, 'active')
  assert.strictEqual(reopenedOwner.admissionGeneration, reopenedAdmission.admissionGeneration)
  assert.strictEqual(reopenedOwner.mutationAuthority, true)
  assert(reopenedOwner.owner.ownerGeneration > terminal.owner.ownerGeneration)
  assert.strictEqual(runOwner(reopenedOwnerInput, reopenAt).replayed, true)

  const crashStages = [
    'after-prepared',
    'after-task-directory-effect',
    'after-identity-effect',
    'after-identity-written',
    'after-overview-effect',
    'after-overview-written',
    'after-cp-state-effect',
    'after-cp-state-written'
  ]
  for (const [index, stage] of crashStages.entries()) {
    const root = setupRoot(`crash-${index}`)
    const input = admissionInput(root, `crash-${index}`)
    let injected = false
    assert.throws(() => run(input, {
      faultInjector(observedStage) {
        if (!injected && observedStage === stage) {
          injected = true
          const error = new Error(`simulated crash at ${stage}`)
          error.code = 'TASK_ADMISSION_CRASH_INJECTED'
          error.simulatedCrash = true
          throw error
        }
      }
    }), error => error.code === 'TASK_ADMISSION_CRASH_INJECTED')
    const resumed = run(input)
    assert.strictEqual(resumed.phase, 'cp-state-written', stage)
    assert.strictEqual(resumed.status, 'awaiting-owner-fence', stage)
    assert.strictEqual(validateTaskIdentity(JSON.parse(fs.readFileSync(path.join(taskRootFor(input, resumed), '.memory', 'task.json'), 'utf8'))).valid, true)
  }

  const ownerCrashStages = ['after-owner-fenced', 'after-admission-finalized']
  for (const [index, stage] of ownerCrashStages.entries()) {
    const root = setupRoot(`owner-crash-${index}`)
    const input = admissionInput(root, `owner-crash-${index}`)
    const admission = run(input)
    confirmCp1(taskRootFor(input, admission))
    const acquireInput = ownerInput(input, admission, 'acquire', { expectedOwner: { mode: 'absent' } })
    assert.throws(() => runOwner(acquireInput, NOW_MS, {
      faultInjector(observedStage) {
        if (observedStage === stage) {
          const error = new Error(`simulated owner crash at ${stage}`)
          error.code = 'TASK_WRITE_OWNER_CRASH_INJECTED'
          throw error
        }
      }
    }), error => error.code === 'TASK_WRITE_OWNER_CRASH_INJECTED')
    const resumed = runOwner(acquireInput)
    assert.strictEqual(resumed.status, 'active', stage)
    assert.strictEqual(resumed.finalized, true, stage)
    assert.strictEqual(resumed.mutationAuthority, true, stage)
    assert.strictEqual(resumed.replayed, true, stage)
  }

  const unsettledRoot = setupRoot('terminal-unsettled-operation')
  const unsettledInput = admissionInput(unsettledRoot, 'terminal-unsettled-operation')
  const unsettledAdmission = run(unsettledInput)
  confirmCp1(taskRootFor(unsettledInput, unsettledAdmission))
  const unsettledOwner = runOwner(ownerInput(unsettledInput, unsettledAdmission, 'acquire', {
    expectedOwner: { mode: 'absent' }
  }))
  const unsettledMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: unsettledRoot.activeRoot,
    project: unsettledRoot.project
  })
  const unsettledIdentity = {
    activeRoot: unsettledRoot.activeRoot,
    project: unsettledRoot.project,
    taskId: unsettledAdmission.taskId,
    taskStatus: 'active'
  }
  const unsettledWrite = updateTaskRecoveryState({
    metaDir: unsettledMetaDir,
    identity: unsettledIdentity
  }, state => {
    state.turnLiveness = {
      ...(state.turnLiveness || {}),
      state: 'running',
      inFlightOperation: {
        operationId: 'legacy-unsettled-mutation',
        toolName: 'write_file',
        startedAt: new Date(NOW_MS).toISOString(),
        leaseExpiresAt: new Date(NOW_MS + 30 * 60 * 1000).toISOString(),
        ownedByAgent: true,
        mutating: true,
        targetPaths: [path.join(taskRootFor(unsettledInput, unsettledAdmission), 'pending.md')]
      }
    }
    return state
  }, { nowMs: NOW_MS, force: true, reason: 'test-terminal-unsettled-operation', ...STORE_OPTIONS })
  assert.strictEqual(unsettledWrite.status, 'committed')
  const unsettledTerminalInput = withTerminalExpectedState(unsettledInput, unsettledAdmission, {
    ...ownerInput(unsettledInput, unsettledAdmission, 'release', { expectedOwner: ownerRef(unsettledOwner) }),
    terminalStatus: 'completed',
    evidence: evidenceSet(unsettledInput, unsettledAdmission, 'unsettled')
  }, NOW_MS + 1, { requireReady: false })
  delete unsettledTerminalInput.operation
  assert.throws(
    () => executeWorkflowTaskTerminal(unsettledTerminalInput, { nowMs: NOW_MS + 1, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_OPERATION_UNSETTLED' &&
      error.details?.unresolvedOperationId === 'legacy-unsettled-mutation'
  )

  const reserveRoot = setupRoot('terminal-reserve')
  const reserveInput = admissionInput(reserveRoot, 'terminal-reserve')
  const reserveAdmission = run(reserveInput)
  confirmCp1(taskRootFor(reserveInput, reserveAdmission))
  const reserveOwner = runOwner(ownerInput(reserveInput, reserveAdmission, 'acquire', {
    expectedOwner: { mode: 'absent' }
  }))
  const reserveEvidence = evidenceSet(reserveInput, reserveAdmission, 'reserve')
  const reserveTerminalInput = withTerminalExpectedState(reserveInput, reserveAdmission, {
    ...ownerInput(reserveInput, reserveAdmission, 'release', { expectedOwner: ownerRef(reserveOwner) }),
    terminalStatus: 'completed',
    evidence: reserveEvidence
  }, NOW_MS + 1000)
  delete reserveTerminalInput.operation
  const reservedTerminal = executeWorkflowTaskTerminal(reserveTerminalInput, {
    nowMs: NOW_MS + 1000,
    storeOptions: { ...STORE_OPTIONS, reserveBytes: 8 * 1024 * 1024, softBytes: 1, hardBytes: 1 }
  })
  assert.strictEqual(reservedTerminal.status, 'terminal-closeout-reserved')
  const reserveMetaDir = resolveTaskRecoveryMetaDir({ activeRoot: reserveRoot.activeRoot, project: reserveRoot.project })
  const reserveIdentity = {
    activeRoot: reserveRoot.activeRoot,
    project: reserveRoot.project,
    taskId: reserveAdmission.taskId,
    taskStatus: 'completed'
  }
  const reserveRead = readFencedTaskWriteOwner({ metaDir: reserveMetaDir, identity: reserveIdentity })
  assert.strictEqual(reserveRead.status, 'fresh')
  assert.strictEqual(reserveRead.source, 'closeout-reserve')
  assert.strictEqual(reserveRead.owner.status, 'terminal')
  const reconciledTerminal = reconcileWorkflowTaskTerminal({
    activeRoot: reserveRoot.activeRoot,
    project: reserveRoot.project,
    taskId: reserveAdmission.taskId,
    sessionKey: reserveInput.actualInstructionEnvelope.hostSessionDigest
  }, { nowMs: NOW_MS + 2000, ...STORE_OPTIONS, reserveBytes: 8 * 1024 * 1024 })
  assert.ok(['committed', 'semantic-noop'].includes(reconciledTerminal.status))
  const reconciledRead = readFencedTaskWriteOwner({
    metaDir: reserveMetaDir,
    identity: reserveIdentity
  }, { ignoreReserve: true })
  assert.strictEqual(reconciledRead.source, 'primary')
  assert.strictEqual(reconciledRead.owner.status, 'terminal')

  const invalidRoot = setupRoot('invalid-existing-state')
  const invalidInput = admissionInput(invalidRoot, 'invalid-existing-state')
  const invalidAdmission = run(invalidInput)
  const invalidMetaDir = resolveTaskRecoveryMetaDir({ activeRoot: invalidRoot.activeRoot, project: invalidRoot.project })
  const invalidIdentity = {
    activeRoot: invalidRoot.activeRoot,
    project: invalidRoot.project,
    taskId: invalidAdmission.taskId,
    taskStatus: 'active'
  }
  const invalidOwnerRead = readFencedTaskWriteOwner({ metaDir: invalidMetaDir, identity: invalidIdentity })
  const invalidSlots = taskPaths(storePaths(invalidMetaDir), invalidOwnerRead.identity.recoveryKey).slots
    .filter(file => fs.existsSync(file))
  assert(invalidSlots.length > 0)
  for (const file of invalidSlots) fs.writeFileSync(file, '{"corrupt":')
  const corruptedBytes = invalidSlots.map(file => fs.readFileSync(file))
  const invalidUpdate = updateTaskRecoveryState({
    metaDir: invalidMetaDir,
    identity: invalidIdentity,
    readFallback: () => ({ fallbackMustNotRun: true })
  }, state => ({ ...state, overwritten: true }), STORE_OPTIONS)
  assert.strictEqual(invalidUpdate.status, 'error')
  assert.strictEqual(invalidUpdate.observedStatus, 'invalid')
  assert.deepStrictEqual(invalidSlots.map(file => fs.readFileSync(file)), corruptedBytes)

  const mismatchIdentity = normalizeIdentity({
    activeRoot: invalidRoot.activeRoot,
    project: invalidRoot.project,
    taskId: '7de2e0ac-d762-4a9c-8f35-2cc0b736cd48',
    taskStatus: 'active'
  })
  const sourceEnvelope = JSON.parse(fs.readFileSync(storePaths(reserveMetaDir).tasks
    ? taskPaths(storePaths(reserveMetaDir), reserveRead.identity.recoveryKey).slots.find(file => fs.existsSync(file))
    : '', 'utf8'))
  const mismatchPaths = taskPaths(storePaths(invalidMetaDir), mismatchIdentity.recoveryKey)
  fs.mkdirSync(mismatchPaths.dir, { recursive: true })
  fs.writeFileSync(mismatchPaths.slots[0], `${JSON.stringify(sourceEnvelope, null, 2)}\n`)
  const mismatchBefore = fs.readFileSync(mismatchPaths.slots[0])
  const mismatchUpdate = updateTaskRecoveryState({
    metaDir: invalidMetaDir,
    identity: mismatchIdentity,
    readFallback: () => ({ fallbackMustNotRun: true })
  }, state => ({ ...state, overwritten: true }), STORE_OPTIONS)
  assert.strictEqual(mismatchUpdate.status, 'error')
  assert.strictEqual(mismatchUpdate.observedStatus, 'identity-mismatch')
  assert.deepStrictEqual(fs.readFileSync(mismatchPaths.slots[0]), mismatchBefore)

  const adoptRoot = setupRoot('adopt')
  const adoptTaskId = '9d734fb0-6099-4f9e-a5d0-8e10a764b511'
  const adoptRelative = 'bugs/Legacy待采用任务'
  const adoptTaskRoot = path.join(adoptRoot.activeRoot, ...adoptRelative.split('/'))
  fs.mkdirSync(path.join(adoptTaskRoot, '.memory'), { recursive: true })
  const legacyIdentity = {
    schemaVersion: 'TaskIdentityV1',
    taskId: adoptTaskId,
    displayName: 'Legacy待采用任务',
    aliases: ['Legacy旧名称'],
    createdAt: '2026-08-20T00:00:00.000Z',
    identityRevision: 1
  }
  fs.writeFileSync(path.join(adoptTaskRoot, '.memory', 'task.json'), `${JSON.stringify(legacyIdentity, null, 2)}\n`)
  const legacyArtifactRelative = 'reports/codex/20260823/04--legacy-cp1.md'
  const legacyArtifactPath = path.join(adoptTaskRoot, ...legacyArtifactRelative.split('/'))
  const legacyArtifactContent = '# Legacy CP1\n\n已确认。\n'
  fs.mkdirSync(path.dirname(legacyArtifactPath), { recursive: true })
  fs.writeFileSync(legacyArtifactPath, legacyArtifactContent)
  const legacyArtifactDigest = crypto.createHash('sha256').update(legacyArtifactContent).digest('hex')
  fs.writeFileSync(path.join(adoptTaskRoot, '.memory', 'sessions.md'), [
    '# Legacy待采用任务 — 工作流状态',
    '',
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|',
    `| CP1 | ✅ | [${legacyArtifactRelative}](../${legacyArtifactRelative}) | v1 | \`${legacyArtifactDigest.toUpperCase()}\` | user-confirmed | 21:32 |`,
    '| CP2 | ⏹️ | — | — | — | — | — |',
    '| CP3 | ⏹️ | — | — | — | — | — |',
    ''
  ].join('\n'))
  const adoptInput = admissionInput(adoptRoot, 'adopt', {
    operation: 'adopt',
    routeTaskKind: 'resume',
    routeCandidate: 'resume',
    task: {
      taskId: adoptTaskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: adoptRelative
    },
    overview: { content: '# 问题概况\n\n采用 legacy task。\n' }
  })
  const adopted = run(adoptInput)
  assert.strictEqual(adopted.phase, 'cp-state-written')
  const adoptMetaDir = resolveTaskRecoveryMetaDir({ activeRoot: adoptRoot.activeRoot, project: adoptRoot.project })
  const adoptedJournal = readTaskAdmissionTransaction({
    metaDir: adoptMetaDir,
    identity: { activeRoot: adoptRoot.activeRoot, project: adoptRoot.project, taskId: adoptTaskId }
  })
  assert.strictEqual(adoptedJournal.transaction.effects.cpState.status, 'confirmed')
  assert.strictEqual(adoptedJournal.transaction.effects.cpState.compatibility.schemaVersion, 'LegacyCpConfirmationCompatibilityV1')
  assert.strictEqual(adoptedJournal.transaction.effects.cpState.compatibility.confirmedAtKind, 'legacy-time-only')
  const legacyAdoptTransaction = JSON.parse(JSON.stringify(adoptedJournal.transaction))
  delete legacyAdoptTransaction.requestDigestSchema
  delete legacyAdoptTransaction.requestDigestSemantics
  delete legacyAdoptTransaction.projectTargetLeaseBindingDigest
  legacyAdoptTransaction.requestDigest = legacyAdmissionRequestDigest(adoptInput, legacyAdoptTransaction)
  legacyAdoptTransaction.transactionDigest = taskAdmissionTransactionDigest(legacyAdoptTransaction)
  const legacyAdoptDowngrade = updateTaskRecoveryState({
    metaDir: adoptMetaDir,
    identity: { activeRoot: adoptRoot.activeRoot, project: adoptRoot.project, taskId: adoptTaskId }
  }, state => ({ ...state, admissionTransaction: legacyAdoptTransaction }), STORE_OPTIONS)
  assert.strictEqual(legacyAdoptDowngrade.status, 'committed')
  const adoptNextContextInput = refreshedIngressContext(adoptInput, 'adopt', 'ctx-adopt-next-turn')
  const adoptNextContextReplay = run(adoptNextContextInput)
  assert.strictEqual(adoptNextContextReplay.admissionId, adopted.admissionId)
  assert.strictEqual(adoptNextContextReplay.replayed, true, 'bounded legacy next-turn adopt replay must remain available')
  const adoptedOwner = runOwner(ownerInput(adoptNextContextInput, adopted, 'acquire', {
    expectedOwner: { mode: 'absent' }
  }))
  assert.strictEqual(adoptedOwner.status, 'active')
  assert.strictEqual(adoptedOwner.finalized, true)
  assert.strictEqual(adoptedOwner.mutationAuthority, true)
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(adoptTaskRoot, '.memory', 'task.json'), 'utf8')).schemaVersion, 'TaskIdentityV1')
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(adoptTaskRoot, '.memory', 'task-identity-v2.json'), 'utf8')).schemaVersion, 'TaskIdentityV2')
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(adoptTaskRoot, '.memory', 'task-identity-migration-v1.json'), 'utf8')).operation, 'adopt')

  const bindRoot = setupRoot('bind')
  const bindTaskId = 'e915b31a-8c63-4a45-a1ac-d9dc175c94df'
  const bindRelative = 'bugs/已有V2任务'
  const bindTaskRoot = path.join(bindRoot.activeRoot, ...bindRelative.split('/'))
  fs.mkdirSync(path.join(bindTaskRoot, '.memory'), { recursive: true })
  const bindIdentity = createTaskIdentityV2({
    taskId: bindTaskId,
    displayName: '已有V2任务',
    aliases: ['既有任务'],
    project: bindRoot.project,
    // The copied task keeps its original physical-root provenance. Binding in
    // the new root must use the current lease without rewriting task identity.
    projectRootIdentityDigest: '9'.repeat(64),
    taskKind: 'bugs',
    entryVariant: 'continue',
    taskRootRelative: bindRelative,
    createdAt: '2026-08-20T00:00:00.000Z'
  })
  fs.writeFileSync(path.join(bindTaskRoot, '.memory', 'task.json'), `${JSON.stringify(bindIdentity, null, 2)}\n`)
  const confirmedArtifact = '01-问题确认.md'
  const confirmedArtifactContent = '# 问题确认\n\n已确认。\n'
  fs.writeFileSync(path.join(bindTaskRoot, confirmedArtifact), confirmedArtifactContent)
  const confirmedDigest = crypto.createHash('sha256').update(confirmedArtifactContent).digest('hex')
  fs.writeFileSync(path.join(bindTaskRoot, '.memory', 'sessions.md'), [
    '# 已有V2任务 — 工作流状态',
    '',
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|',
    `| CP1 | ✅ | [${confirmedArtifact}](../${confirmedArtifact}) | v1 | ${confirmedDigest} | user-confirmed | 2026-08-24T00:00:00.000Z |`,
    '| CP2 | ⏹️ | — | — | — | — | — |',
    '| CP3 | ⏹️ | — | — | — | — | — |',
    ''
  ].join('\n'))
  const bindInput = admissionInput(bindRoot, 'bind', {
    operation: 'bind',
    task: {
      taskId: bindTaskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: bindRelative
    },
    overview: { content: '# 问题概况\n\n继续已有 V2 task。\n' }
  })
  const bound = run(bindInput)
  assert.strictEqual(bound.phase, 'cp-state-written')
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(bindTaskRoot, '.memory', 'task.json'), 'utf8')).projectRootIdentityDigest,
    '9'.repeat(64),
    'workspace relocation must not rewrite immutable task-origin provenance'
  )
  const bindMetaDir = resolveTaskRecoveryMetaDir({ activeRoot: bindRoot.activeRoot, project: bindRoot.project })
  const boundJournal = readTaskAdmissionTransaction({
    metaDir: bindMetaDir,
    identity: { activeRoot: bindRoot.activeRoot, project: bindRoot.project, taskId: bindTaskId }
  })
  assert.strictEqual(boundJournal.transaction.effects.cpState.cp1Confirmed, true)
  assert.strictEqual(boundJournal.transaction.effects.cpState.status, 'confirmed')
  assert.strictEqual(boundJournal.transaction.effects.cpState.compatibility, null)
  const boundOwner = runOwner(ownerInput(bindInput, bound, 'acquire', {
    expectedOwner: { mode: 'absent' }
  }))
  assert.strictEqual(boundOwner.status, 'active')
  assert.strictEqual(boundOwner.finalized, true)
  assert.strictEqual(boundOwner.mutationAuthority, true)

  const pressureRoot = setupRoot('pressure')
  const pressureInput = admissionInput(pressureRoot, 'pressure')
  const pressure = executeTaskAdmission(pressureInput, {
    nowMs: NOW_MS,
    storeOptions: { ...STORE_OPTIONS, softBytes: 1, hardBytes: 1 }
  })
  assert.strictEqual(pressure.status, 'needs-reconcile')
  assert.strictEqual(fs.existsSync(path.join(pressureRoot.activeRoot, 'bugs')), false, 'prepared capacity failure must have zero business-file effects')

  const identityRecoveryRoot = setupRoot('identity-recovery')
  const identityRecoveryInput = admissionInput(identityRecoveryRoot, 'identity-recovery')
  let identityFaultInjected = false
  const identityNeedsReconcile = run(identityRecoveryInput, {
    faultInjector(stage) {
      if (stage === 'after-identity-effect' && !identityFaultInjected) {
        identityFaultInjected = true
        throw Object.assign(new Error('identity effect reported failure'), { code: 'FIXTURE_IDENTITY_EFFECT_FAILURE' })
      }
    }
  })
  assert.strictEqual(identityNeedsReconcile.status, 'needs-reconcile')
  const identityRecovered = run(identityRecoveryInput)
  assert.strictEqual(identityRecovered.phase, 'cp-state-written')
  const identityRecoveryMeta = resolveTaskRecoveryMetaDir({
    activeRoot: identityRecoveryRoot.activeRoot,
    project: identityRecoveryRoot.project
  })
  const identityRecoveryRead = readTaskAdmissionTransaction({
    metaDir: identityRecoveryMeta,
    identity: {
      activeRoot: identityRecoveryRoot.activeRoot,
      project: identityRecoveryRoot.project,
      taskId: identityRecovered.taskId
    }
  })
  assert.strictEqual(identityRecoveryRead.transaction.reconciliation.recoveredPhase, 'identity-written')
  assert.strictEqual(validateTaskAdmissionReconciliationReceipt(identityRecoveryRead.transaction.reconciliation).valid, true)
  assert.strictEqual(identityRecoveryRead.transaction.reconciliation.mutationAuthority, false)
  assert.strictEqual(run(identityRecoveryInput).replayed, true, 'recovered admission must remain idempotent after reaching CP state')

  const overviewDriftRoot = setupRoot('overview-reconciliation-drift')
  const overviewDriftInput = admissionInput(overviewDriftRoot, 'overview-reconciliation-drift')
  let overviewFaultInjected = false
  const overviewNeedsReconcile = run(overviewDriftInput, {
    faultInjector(stage) {
      if (stage === 'after-overview-effect' && !overviewFaultInjected) {
        overviewFaultInjected = true
        throw Object.assign(new Error('overview effect reported failure'), { code: 'FIXTURE_OVERVIEW_EFFECT_FAILURE' })
      }
    }
  })
  assert.strictEqual(overviewNeedsReconcile.status, 'needs-reconcile')
  const overviewTaskRoot = taskRootFor(overviewDriftInput, overviewNeedsReconcile)
  fs.writeFileSync(path.join(overviewTaskRoot, '00-问题概况.md'), '# drifted overview\n')
  const overviewDriftRetry = run(overviewDriftInput)
  assert.strictEqual(overviewDriftRetry.status, 'needs-reconcile')
  assert.strictEqual(overviewDriftRetry.errorCode, 'TASK_ADMISSION_RECONCILIATION_DRIFT')

  const cpRecoveryRoot = setupRoot('cp-recovery')
  const cpRecoveryInput = admissionInput(cpRecoveryRoot, 'cp-recovery')
  let cpFaultInjected = false
  const cpNeedsReconcile = run(cpRecoveryInput, {
    faultInjector(stage) {
      if (stage === 'after-cp-state-effect' && !cpFaultInjected) {
        cpFaultInjected = true
        throw Object.assign(new Error('cp effect reported failure'), { code: 'FIXTURE_CP_EFFECT_FAILURE' })
      }
    }
  })
  assert.strictEqual(cpNeedsReconcile.status, 'needs-reconcile')
  const cpRecovered = run(cpRecoveryInput)
  assert.strictEqual(cpRecovered.phase, 'cp-state-written')
  const cpRecoveryRead = readTaskAdmissionTransaction({
    metaDir: resolveTaskRecoveryMetaDir({ activeRoot: cpRecoveryRoot.activeRoot, project: cpRecoveryRoot.project }),
    identity: { activeRoot: cpRecoveryRoot.activeRoot, project: cpRecoveryRoot.project, taskId: cpRecovered.taskId }
  })
  assert.strictEqual(cpRecoveryRead.transaction.reconciliation.recoveredPhase, 'cp-state-written')

  const partialProductRoot = setupRoot('partial-product-recovery')
  const partialProductOverview = '# 需求概况\n\n产品来源映射。\n'
  const partialProductSource = '# 产品需求\n\n用户原始产品真相。\n'
  const partialProductInput = admissionInput(partialProductRoot, 'partial-product-recovery', {
    routeTaskKind: 'dev',
    routeCandidate: 'dev.default',
    task: {
      taskKind: 'requirements',
      entryVariant: 'product-provided',
      displayName: '部分产品产物恢复'
    },
    overview: {
      content: partialProductOverview,
      productSourceContent: partialProductSource
    }
  })
  let overviewCreateBlocked = false
  const partialProductFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'linkSync') {
        return (source, destination) => {
          if (!overviewCreateBlocked && path.basename(String(destination)) === '00-需求概况.md') {
            overviewCreateBlocked = true
            throw Object.assign(new Error('fixture blocks the second logical-phase file'), { code: 'FIXTURE_PARTIAL_PRODUCT_PHASE' })
          }
          return target.linkSync(source, destination)
        }
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  const partialProductNeedsReconcile = run(partialProductInput, { fs: partialProductFs })
  assert.strictEqual(partialProductNeedsReconcile.status, 'needs-reconcile')
  const partialProductTaskRoot = taskRootFor(partialProductInput, partialProductNeedsReconcile)
  assert.strictEqual(fs.existsSync(path.join(partialProductTaskRoot, '01-产品需求.md')), true)
  assert.strictEqual(fs.existsSync(path.join(partialProductTaskRoot, '00-需求概况.md')), false)
  const partialProductRecovered = run(partialProductInput)
  assert.strictEqual(partialProductRecovered.phase, 'cp-state-written')
  assert.strictEqual(fs.readFileSync(path.join(partialProductTaskRoot, '01-产品需求.md'), 'utf8'), partialProductSource)
  assert.strictEqual(fs.readFileSync(path.join(partialProductTaskRoot, '00-需求概况.md'), 'utf8'), partialProductOverview)
  const partialProductRecoveryRead = readTaskAdmissionTransaction({
    metaDir: resolveTaskRecoveryMetaDir({ activeRoot: partialProductRoot.activeRoot, project: partialProductRoot.project }),
    identity: {
      activeRoot: partialProductRoot.activeRoot,
      project: partialProductRoot.project,
      taskId: partialProductRecovered.taskId
    }
  })
  assert.strictEqual(partialProductRecoveryRead.transaction.reconciliation.recoveredPhase, 'identity-written')

  const ownerFencedCrash = createOwnerFencedCrashFixture('owner-fenced-crash-recovery')
  const ownerFencedResume = ownerFencedResumeInput(ownerFencedCrash)
  assert.throws(
    () => recoverOwnerFencedAdmissionForResume({
      ...ownerFencedResume,
      overview: { content: `${ownerFencedResume.overview.content}\n带外漂移\n` }
    }, { nowMs: NOW_MS + 31 * 60 * 1000, storeOptions: STORE_OPTIONS }),
    error => error.code === 'OWNER_FENCED_ADMISSION_RECOVERY_CANONICAL_DRIFT'
  )
  assert.strictEqual(
    readTaskAdmissionTransaction({ metaDir: ownerFencedCrash.metaDir, identity: ownerFencedCrash.identity }).transaction.phase,
    'owner-fenced',
    'wrong overview must be zero-write'
  )
  const wrongRoute = admissionInput(ownerFencedCrash.root, 'owner-fenced-wrong-route')
  assert.throws(
    () => recoverOwnerFencedAdmissionForResume({
      ...ownerFencedResume,
      actualInstructionEnvelope: wrongRoute.actualInstructionEnvelope,
      workItemSet: wrongRoute.workItemSet,
      workflowRouteDecision: wrongRoute.workflowRouteDecision,
      projectTargetLease: wrongRoute.projectTargetLease
    }, { nowMs: NOW_MS, storeOptions: STORE_OPTIONS }),
    error => error.code === 'OWNER_FENCED_ADMISSION_RECOVERY_REQUEST_INVALID'
  )
  const ownerFencedWrongRootLeaseCore = {
    ...ownerFencedResume.projectTargetLease,
    rootIdentityDigest: '9'.repeat(64)
  }
  delete ownerFencedWrongRootLeaseCore.leaseDigest
  assert.throws(
    () => recoverOwnerFencedAdmissionForResume({
      ...ownerFencedResume,
      projectTargetLease: {
        ...ownerFencedWrongRootLeaseCore,
        leaseDigest: computeProjectTargetLeaseDigest(ownerFencedWrongRootLeaseCore)
      }
    }, { nowMs: NOW_MS, storeOptions: STORE_OPTIONS }),
    error => error.code === 'OWNER_FENCED_ADMISSION_RECOVERY_TASK_MISMATCH'
  )
  const ownerFencedTaskRoot = taskRootFor(ownerFencedCrash.input, ownerFencedCrash.admission)
  const ownerFencedCpPath = path.join(ownerFencedTaskRoot, '01-问题确认.md')
  const ownerFencedCp = fs.readFileSync(ownerFencedCpPath, 'utf8')
  fs.appendFileSync(ownerFencedCpPath, '\nCP drift\n')
  assert.throws(
    () => recoverOwnerFencedAdmissionForResume(ownerFencedResume, {
      nowMs: NOW_MS + 31 * 60 * 1000,
      storeOptions: STORE_OPTIONS
    }),
    error => /CP|READBACK|CANONICAL/.test(error.code)
  )
  fs.writeFileSync(ownerFencedCpPath, ownerFencedCp)
  assert.strictEqual(
    readTaskAdmissionTransaction({ metaDir: ownerFencedCrash.metaDir, identity: ownerFencedCrash.identity }).transaction.phase,
    'owner-fenced',
    'CP drift must be zero-write'
  )
  const ownerFencedRecovered = recoverOwnerFencedAdmissionForResume(ownerFencedResume, {
    nowMs: NOW_MS + 31 * 60 * 1000,
    storeOptions: STORE_OPTIONS
  })
  assert.strictEqual(ownerFencedRecovered.status, 'recovered')
  assert.strictEqual(ownerFencedRecovered.mutationAuthority, false)
  assert.deepStrictEqual(ownerFencedRecovered.ownerRef, ownerRef({ owner: ownerFencedCrash.owner }))
  const ownerFencedReadback = readTaskRecoveryState({
    metaDir: ownerFencedCrash.metaDir,
    identity: ownerFencedCrash.identity
  }, { nowMs: NOW_MS + 31 * 60 * 1000 })
  assert.strictEqual(ownerFencedReadback.state.admissionTransaction.phase, 'finalized')
  assert.strictEqual(ownerFencedReadback.state.fencedWriteOwner.leaseDigest, ownerFencedCrash.owner.leaseDigest)
  const ownerFencedReplay = recoverOwnerFencedAdmissionForResume(ownerFencedResume, {
    nowMs: NOW_MS + 31 * 60 * 1000,
    storeOptions: STORE_OPTIONS
  })
  assert.strictEqual(ownerFencedReplay.status, 'already-finalized')
  assert.strictEqual(ownerFencedReplay.replayed, true)
  assert.strictEqual(ownerFencedReplay.transactionDigest, ownerFencedRecovered.transactionDigest)

  const ownerMismatchCrash = createOwnerFencedCrashFixture('owner-fenced-owner-mismatch')
  const ownerMismatchWrite = updateTaskRecoveryState({
    metaDir: ownerMismatchCrash.metaDir,
    identity: ownerMismatchCrash.identity
  }, state => {
    state.admissionTransaction.effects.owner.leaseDigest = 'f'.repeat(64)
    state.admissionTransaction.transactionDigest = taskAdmissionTransactionDigest(state.admissionTransaction)
    return state
  }, { nowMs: NOW_MS, force: true, reason: 'test-owner-fenced-owner-mismatch', ...STORE_OPTIONS })
  assert(['committed', 'semantic-noop'].includes(ownerMismatchWrite.status))
  assert.throws(
    () => recoverOwnerFencedAdmissionForResume(ownerFencedResumeInput(ownerMismatchCrash), {
      nowMs: NOW_MS + 31 * 60 * 1000,
      storeOptions: STORE_OPTIONS
    }),
    error => error.code === 'OWNER_FENCED_ADMISSION_RECOVERY_OWNER_MISMATCH'
  )

  const resumeAt = NOW_MS + 6 * 60 * 1000
  const expiredResume = createFinalizedResumeFixture('finalized-expired-resume')
  setFinalizedResumeLiveness(expiredResume.root, expiredResume.admission, {}, resumeAt)
  const expiredAttempt = buildFinalizedResumeAttempt(
    expiredResume.root,
    expiredResume.admission,
    'finalized-expired-resume-next',
    resumeAt
  )
  assert.strictEqual(expiredAttempt.candidate.mutationAuthority, false)
  const resumed = run(expiredAttempt.input, { nowMs: resumeAt })
  assert.strictEqual(resumed.atomicOwnerAcquired, true)
  assert.strictEqual(resumed.mutationAuthority, true)
  assert.strictEqual(resumed.ownerAcquisition.writeContext.schemaVersion, 'CanonicalTaskWriteContextV1')
  assert.strictEqual(resumed.ownerAcquisition.writeContext.readback, 'PASS')
  assert.strictEqual(
    resumed.ownerAcquisition.writeContext.writerGeneration,
    resumed.ownerAcquisition.owner.ownerGeneration
  )
  assert.strictEqual(resumed.admissionGeneration, expiredAttempt.prior.transaction.admissionGeneration + 1)
  assert.strictEqual(resumed.ownerAcquisition.owner.ownerGeneration, expiredAttempt.prior.owner.ownerGeneration + 1)
  assert.strictEqual(resumed.recovery.schemaVersion, 'FinalizedTaskResumeRecoveryReceiptV3')
  const resumedReplay = run(expiredAttempt.input, { nowMs: resumeAt })
  assert.strictEqual(resumedReplay.replayed, true, 'response-loss replay must return the same resumed admission and owner')
  assert.strictEqual(resumedReplay.admissionId, resumed.admissionId)
  assert.strictEqual(resumedReplay.ownerAcquisition.owner.leaseDigest, resumed.ownerAcquisition.owner.leaseDigest)
  const authorizedCandidate = readBoundedResumeIngressCapability({
    metaDir: expiredAttempt.metaDir,
    ingressRef: expiredAttempt.candidate.ingressRef,
    activeRoot: expiredResume.root.activeRoot,
    project: expiredResume.root.project,
    taskId: expiredResume.admission.taskId
  }, { nowMs: resumeAt, requireAuthority: true })
  assert.strictEqual(authorizedCandidate.status, 'fresh')
  assert.strictEqual(authorizedCandidate.authority, true)

  const relocatedResumeAt = resumeAt + 1000
  const relocatedResume = createFinalizedResumeFixture('finalized-relocated-resume')
  setFinalizedResumeLiveness(relocatedResume.root, relocatedResume.admission, {}, relocatedResumeAt)
  const relocatedAttempt = buildFinalizedResumeAttempt(
    relocatedResume.root,
    relocatedResume.admission,
    'finalized-relocated-resume-next',
    relocatedResumeAt,
    { projectRootIdentityDigest: '4'.repeat(64) }
  )
  const relocatedTaskRoot = taskRootFor(relocatedResume.input, relocatedResume.admission)
  const relocatedIdentityBefore = JSON.parse(fs.readFileSync(path.join(relocatedTaskRoot, '.memory', 'task.json'), 'utf8'))
  assert.strictEqual(relocatedIdentityBefore.projectRootIdentityDigest, '2'.repeat(64))
  const relocatedResult = run(relocatedAttempt.input, { nowMs: relocatedResumeAt })
  assert.strictEqual(relocatedResult.mutationAuthority, true)
  assert.strictEqual(relocatedResult.admissionGeneration, relocatedAttempt.prior.transaction.admissionGeneration + 1)
  const relocatedReadback = readTaskRecoveryState({
    metaDir: relocatedAttempt.metaDir,
    identity: relocatedAttempt.identity
  }, { nowMs: relocatedResumeAt })
  assert.strictEqual(relocatedReadback.status, 'fresh')
  assert.strictEqual(relocatedReadback.state.admissionTransaction.projectRootIdentityDigest, '4'.repeat(64))
  assert.strictEqual(relocatedReadback.state.fencedWriteOwner.projectRootIdentity, '4'.repeat(64))
  assert.strictEqual(
    relocatedReadback.state.admissionTransaction.recovery.priorProjectRootIdentityDigest,
    '2'.repeat(64)
  )
  assert.strictEqual(
    relocatedReadback.state.admissionTransaction.recovery.projectRootIdentityDigest,
    '4'.repeat(64)
  )
  assert.strictEqual(
    relocatedReadback.state.admissionTransaction.recovery.relocation.currentProjectRootIdentityDigest,
    '4'.repeat(64)
  )
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(relocatedTaskRoot, '.memory', 'task.json'), 'utf8')).projectRootIdentityDigest,
    '2'.repeat(64),
    'the new admission generation must not rewrite immutable task-origin provenance'
  )
  const relocatedReplay = run(relocatedAttempt.input, { nowMs: relocatedResumeAt })
  assert.strictEqual(relocatedReplay.replayed, true)
  assert.strictEqual(relocatedReplay.admissionId, relocatedResult.admissionId)
  const downstreamRenew = runOwner(ownerInput(expiredAttempt.input, resumed, 'renew', {
    expectedOwner: ownerRef(resumed.ownerAcquisition)
  }), resumeAt)
  assert.strictEqual(downstreamRenew.mutationAuthority, true, 'returned resume ingress must renew the new owner')
  assert.throws(
    () => runOwner(ownerInput(expiredResume.input, expiredResume.admission, 'renew', {
      expectedOwner: ownerRef(expiredResume.owner)
    }), resumeAt),
    error => ['TASK_ADMISSION_TRANSACTION_MISSING', 'TASK_WRITE_OWNER_CAS_MISMATCH'].includes(error.code),
    'the old admission and owner must never regain authority'
  )

  const evolvedResumeAt = NOW_MS + 7 * 60 * 1000
  const evolvedResume = createFinalizedResumeFixture('finalized-authorized-overview-evolution')
  const evolvedTaskRoot = taskRootFor(evolvedResume.input, evolvedResume.admission)
  const evolvedCp2 = confirmCp(evolvedTaskRoot, 'CP2', '02-修复方案.md', 'v2.0.0-candidate')
  const evolvedCp3 = confirmCp(evolvedTaskRoot, 'CP3', '04-实施计划.md', 'v3.0.0-candidate')
  const evolvedContent = [
    '# 问题概况',
    '',
    `> TaskIdentity: \`${evolvedResume.admission.taskId}\``,
    `- CP2 ${evolvedCp2.version}（已确认）`,
    `- CP3 ${evolvedCp3.version}（已确认）`,
    '',
    '已按确认的 CP 链进入实施。',
    ''
  ].join('\n')
  const evolvedRevision = recordAuthorizedOverviewEvolution(evolvedResume, evolvedContent, evolvedResumeAt - 1000)
  assert.strictEqual(evolvedRevision.source, 'authorized-mutation')
  setFinalizedResumeLiveness(evolvedResume.root, evolvedResume.admission, {}, evolvedResumeAt)
  const evolvedAttempt = buildFinalizedResumeAttempt(
    evolvedResume.root,
    evolvedResume.admission,
    'finalized-authorized-overview-evolution-next',
    evolvedResumeAt
  )
  assert.strictEqual(evolvedAttempt.candidate.canonicalRevisionDigest, evolvedRevision.revisionDigest)
  const evolvedResult = run(evolvedAttempt.input, { nowMs: evolvedResumeAt })
  assert.strictEqual(evolvedResult.mutationAuthority, true)
  assert.strictEqual(evolvedResult.admissionGeneration, evolvedAttempt.prior.transaction.admissionGeneration + 1)
  const evolvedRead = readTaskRecoveryState({
    metaDir: evolvedAttempt.metaDir,
    identity: evolvedAttempt.identity
  }, { nowMs: evolvedResumeAt })
  assert.strictEqual(evolvedRead.state.taskCanonicalRevision.source, 'resume-generation')
  assert.strictEqual(
    evolvedRead.state.taskCanonicalRevision.parentRevisionDigest,
    evolvedRevision.revisionDigest
  )
  assert.strictEqual(run(evolvedAttempt.input, { nowMs: evolvedResumeAt }).replayed, true)
  const evolvedSessionsPath = path.join(evolvedTaskRoot, '.memory', 'sessions.md')
  const evolvedSessions = fs.readFileSync(evolvedSessionsPath, 'utf8')
  fs.writeFileSync(
    evolvedSessionsPath,
    evolvedSessions.replace('test-confirmed-cp3', 'tampered-confirmation-source')
  )
  assert.throws(
    () => buildFinalizedResumeAttempt(
      evolvedResume.root,
      evolvedResult,
      'finalized-authorized-overview-evolution-cp-tampered',
      evolvedResumeAt + 500
    ),
    error => error.code === 'FINALIZED_TASK_RESUME_CP_DRIFT',
    'a later admission generation must reject changed CP confirmation provenance even when the artifact digest is unchanged'
  )
  fs.writeFileSync(evolvedSessionsPath, evolvedSessions)
  const evolvedOverviewPath = path.join(evolvedTaskRoot, '00-问题概况.md')
  fs.writeFileSync(evolvedOverviewPath, [
    '# 面向读者的进度说明',
    '',
    '方案已经按既定范围完成实现，现在进入本地复核。',
    '这段正常叙述不携带任务号、阶段名、版本号或机器摘要。',
    ''
  ].join('\n'))
  const evolvedAfterNarrativeChange = readTaskRecoveryState({
    metaDir: evolvedAttempt.metaDir,
    identity: evolvedAttempt.identity
  }, { nowMs: evolvedResumeAt + 1000 })
  const firstReconciliation = readFinalizedResumeCanonicalEvidence(
    evolvedAfterNarrativeChange.state.admissionTransaction,
    evolvedResume.root.activeRoot,
    fs,
    { state: evolvedAfterNarrativeChange.state }
  )
  const replayedReconciliation = readFinalizedResumeCanonicalEvidence(
    evolvedAfterNarrativeChange.state.admissionTransaction,
    evolvedResume.root.activeRoot,
    fs,
    { state: evolvedAfterNarrativeChange.state }
  )
  assert.strictEqual(firstReconciliation.canonicalRevision.source, 'verified-resume-reconciliation')
  assert.strictEqual(replayedReconciliation.canonicalRevisionDigest, firstReconciliation.canonicalRevisionDigest)
  assert.throws(
    () => readFinalizedResumeCanonicalEvidence(
      evolvedAfterNarrativeChange.state.admissionTransaction,
      evolvedResume.root.activeRoot,
      fs,
      {
        state: {
          ...evolvedAfterNarrativeChange.state,
          taskCanonicalRevision: firstReconciliation.canonicalRevision
        }
      }
    ),
    error => error.code === 'FINALIZED_TASK_RESUME_CANONICAL_DRIFT',
    'a process-local reconciliation revision must never become readable durable state'
  )
  setFinalizedResumeLiveness(evolvedResume.root, evolvedResult, {}, evolvedResumeAt + 1000)
  const evolvedReconciledAttempt = buildFinalizedResumeAttempt(
    evolvedResume.root,
    evolvedResult,
    'finalized-authorized-overview-evolution-reconciled',
    evolvedResumeAt + 1000
  )
  assert.strictEqual(evolvedReconciledAttempt.candidate.canonicalRevisionDigest, firstReconciliation.canonicalRevisionDigest)
  const evolvedReconciledResult = run(evolvedReconciledAttempt.input, { nowMs: evolvedResumeAt + 1000 })
  assert.strictEqual(evolvedReconciledResult.mutationAuthority, true)
  assert.strictEqual(evolvedReconciledResult.admissionGeneration, evolvedResult.admissionGeneration + 1)
  const evolvedReconciledRead = readTaskRecoveryState({
    metaDir: evolvedReconciledAttempt.metaDir,
    identity: evolvedReconciledAttempt.identity
  }, { nowMs: evolvedResumeAt + 1000 })
  assert.strictEqual(evolvedReconciledRead.state.taskCanonicalRevision.source, 'resume-generation')
  assert.strictEqual(
    evolvedReconciledRead.state.taskCanonicalRevision.parentRevisionDigest,
    firstReconciliation.canonicalRevisionDigest
  )
  assert.strictEqual(run(evolvedReconciledAttempt.input, { nowMs: evolvedResumeAt + 1000 }).replayed, true)

  const timeOnlyInitialRoot = setupRoot('time-only-initial-confirmation')
  const timeOnlyInitialInput = admissionInput(timeOnlyInitialRoot, 'time-only-initial-confirmation')
  const timeOnlyInitialAdmission = run(timeOnlyInitialInput)
  const timeOnlyInitialTaskRoot = taskRootFor(timeOnlyInitialInput, timeOnlyInitialAdmission)
  const timeOnlyCp1 = reconfirmCp(
    timeOnlyInitialTaskRoot,
    'CP1',
    '01-问题确认.md',
    'v1.0.0-candidate',
    '首次 CP 使用 canonical writer 的人类时间。',
    '16:40'
  )
  const timeOnlyInitialOwner = runOwner(ownerInput(
    timeOnlyInitialInput,
    timeOnlyInitialAdmission,
    'acquire',
    { expectedOwner: { mode: 'absent' } }
  ))
  assert.strictEqual(timeOnlyInitialOwner.finalized, true)
  assert.strictEqual(timeOnlyInitialOwner.mutationAuthority, true)
  const timeOnlyInitialMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: timeOnlyInitialRoot.activeRoot,
    project: timeOnlyInitialRoot.project
  })
  const timeOnlyInitialRead = readTaskRecoveryState({
    metaDir: timeOnlyInitialMetaDir,
    identity: {
      activeRoot: timeOnlyInitialRoot.activeRoot,
      project: timeOnlyInitialRoot.project,
      taskId: timeOnlyInitialAdmission.taskId,
      taskStatus: 'active'
    }
  }, { nowMs: NOW_MS })
  assert.strictEqual(timeOnlyInitialRead.status, 'fresh')
  assert.strictEqual(
    readFinalizedResumeCanonicalEvidence(
      timeOnlyInitialRead.state.admissionTransaction,
      timeOnlyInitialRoot.activeRoot,
      fs,
      { state: timeOnlyInitialRead.state }
    ).confirmedCpEvidence[0].confirmedAt,
    timeOnlyCp1.confirmedAt,
    'the first time-only CP confirmation must remain intact in canonical evidence'
  )

  const legacyEvolutionAt = NOW_MS + 8 * 60 * 1000
  const legacyEvolution = createFinalizedResumeFixture('finalized-legacy-overview-evolution')
  const legacyTaskRoot = taskRootFor(legacyEvolution.input, legacyEvolution.admission)
  const legacyCp2 = reconfirmCp(
    legacyTaskRoot,
    'CP2',
    '02-修复方案.md',
    'v2.1.0-candidate',
    '人类可读时间 CP2。',
    '16:41'
  )
  const legacyCp3 = reconfirmCp(
    legacyTaskRoot,
    'CP3',
    '04-实施计划.md',
    'v3.1.0-candidate',
    '人类可读时间 CP3。',
    '16:42'
  )
  const legacyMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: legacyEvolution.root.activeRoot,
    project: legacyEvolution.root.project
  })
  const legacyEvolutionIdentity = {
    activeRoot: legacyEvolution.root.activeRoot,
    project: legacyEvolution.root.project,
    taskId: legacyEvolution.admission.taskId,
    taskStatus: 'active'
  }
  const strippedLegacy = updateTaskRecoveryState({ metaDir: legacyMetaDir, identity: legacyEvolutionIdentity }, state => {
    delete state.taskCanonicalRevision
    return state
  }, { nowMs: legacyEvolutionAt - 2000, force: true, reason: 'test-legacy-runtime-state', ...STORE_OPTIONS })
  assert(['committed', 'semantic-noop'].includes(strippedLegacy.status))
  const legacySessionsPath = path.join(legacyTaskRoot, '.memory', 'sessions.md')
  const legacySessions = fs.readFileSync(legacySessionsPath, 'utf8')
  fs.writeFileSync(legacySessionsPath, legacySessions.replace('16:42', '25:99'))
  assert.throws(
    () => readFinalizedResumeCanonicalEvidence(
      strippedLegacy.state.admissionTransaction,
      legacyEvolution.root.activeRoot,
      fs,
      { state: strippedLegacy.state }
    ),
    error => error.code === 'FINALIZED_TASK_RESUME_CP_DRIFT',
    'a malformed time outside the existing human-readable HH:mm contract must remain fail closed'
  )
  fs.writeFileSync(legacySessionsPath, legacySessions)
  fs.writeFileSync(path.join(legacyTaskRoot, '00-问题概况.md'), [
    '# 问题概况',
    '',
    '这是旧运行时留下的人类可读任务说明。',
    '',
    '正文不包含任务标识、阶段或候选版本 token；恢复权威只来自机器身份和已确认 CP 链。',
    ''
  ].join('\n'))
  const firstLegacyCanonical = readFinalizedResumeCanonicalEvidence(
    strippedLegacy.state.admissionTransaction,
    legacyEvolution.root.activeRoot,
    fs,
    { state: strippedLegacy.state }
  )
  const replayedLegacyCanonical = readFinalizedResumeCanonicalEvidence(
    strippedLegacy.state.admissionTransaction,
    legacyEvolution.root.activeRoot,
    fs,
    { state: strippedLegacy.state }
  )
  assert.strictEqual(firstLegacyCanonical.canonicalRevision.source, 'legacy-confirmed-cp-chain')
  assert.strictEqual(
    replayedLegacyCanonical.canonicalRevisionDigest,
    firstLegacyCanonical.canonicalRevisionDigest,
    'the same time-only CP state must produce one deterministic canonical revision digest'
  )
  assert.strictEqual(
    firstLegacyCanonical.canonicalRevision.updatedAt,
    new Date(Date.parse(strippedLegacy.state.admissionTransaction.updatedAt)).toISOString(),
    'time-only CP evidence must use the deterministic admission timestamp for revision metadata'
  )
  setFinalizedResumeLiveness(legacyEvolution.root, legacyEvolution.admission, {}, legacyEvolutionAt)
  const legacyEvolutionAttempt = buildFinalizedResumeAttempt(
    legacyEvolution.root,
    legacyEvolution.admission,
    'finalized-legacy-overview-evolution-next',
    legacyEvolutionAt
  )
  const legacyEvolutionResult = run(legacyEvolutionAttempt.input, { nowMs: legacyEvolutionAt })
  assert.strictEqual(legacyEvolutionResult.mutationAuthority, true)
  const legacyEvolutionRead = readTaskRecoveryState({
    metaDir: legacyEvolutionAttempt.metaDir,
    identity: legacyEvolutionAttempt.identity
  }, { nowMs: legacyEvolutionAt })
  assert.strictEqual(legacyEvolutionRead.state.taskCanonicalRevision.source, 'resume-generation')
  assert.strictEqual(legacyEvolutionRead.state.taskCanonicalRevision.revision, 3)

  const successorFirstAt = NOW_MS + 9 * 60 * 1000
  const successorResume = createFinalizedResumeFixture('finalized-confirmed-cp-successor')
  const successorTaskRoot = taskRootFor(successorResume.input, successorResume.admission)
  const successorOldCp2 = confirmCp(successorTaskRoot, 'CP2', '02-修复方案.md', 'v2.2.0-candidate')
  const successorOldCp3 = confirmCp(successorTaskRoot, 'CP3', '04-实施计划.md', 'v3.2.0-candidate')
  recordAuthorizedOverviewEvolution(successorResume, [
    '# 问题概况',
    '',
    `> TaskIdentity: \`${successorResume.admission.taskId}\``,
    `- CP2 ${successorOldCp2.version}（已确认）`,
    `- CP3 ${successorOldCp3.version}（已确认）`,
    '',
    '旧候选已确认。',
    ''
  ].join('\n'), successorFirstAt - 1000)
  setFinalizedResumeLiveness(successorResume.root, successorResume.admission, {}, successorFirstAt)
  const successorFirstAttempt = buildFinalizedResumeAttempt(
    successorResume.root,
    successorResume.admission,
    'finalized-confirmed-cp-successor-g2',
    successorFirstAt
  )
  const successorG2 = run(successorFirstAttempt.input, { nowMs: successorFirstAt })
  assert.strictEqual(successorG2.mutationAuthority, true)

  const successorSecondAt = NOW_MS + 16 * 60 * 1000
  const successorNewCp2 = reconfirmCp(
    successorTaskRoot,
    'CP2',
    '02-修复方案.md',
    'v2.3.0-candidate',
    '合法 CP2 后继候选。',
    '16:46'
  )
  const successorNewCp3 = reconfirmCp(
    successorTaskRoot,
    'CP3',
    '04-实施计划.md',
    'v3.3.0-candidate',
    '合法 CP3 后继候选。',
    '16:47'
  )
  fs.writeFileSync(path.join(successorTaskRoot, '00-问题概况.md'), [
    '# 问题概况',
    '',
    '方案已更新，接下来继续实现。',
    '',
    '这里故意不出现任务标识、阶段名或候选版本；机器 CP successor 才是恢复依据。',
    ''
  ].join('\n'))
  setFinalizedResumeLiveness(successorResume.root, successorG2, {}, successorSecondAt)
  const successorBeforeG3 = readTaskRecoveryState({
    metaDir: resolveTaskRecoveryMetaDir({
      activeRoot: successorResume.root.activeRoot,
      project: successorResume.root.project
    }),
    identity: {
      activeRoot: successorResume.root.activeRoot,
      project: successorResume.root.project,
      taskId: successorResume.admission.taskId,
      taskStatus: 'active'
    }
  }, { nowMs: successorSecondAt })
  const successorCanonical = readFinalizedResumeCanonicalEvidence(
    successorBeforeG3.state.admissionTransaction,
    successorResume.root.activeRoot,
    fs,
    { state: successorBeforeG3.state }
  )
  assert.strictEqual(successorCanonical.canonicalRevision.source, 'confirmed-cp-evolution')
  const successorSecondAttempt = buildFinalizedResumeAttempt(
    successorResume.root,
    successorG2,
    'finalized-confirmed-cp-successor-g3',
    successorSecondAt
  )
  const successorG3 = run(successorSecondAttempt.input, { nowMs: successorSecondAt })
  assert.strictEqual(successorG3.mutationAuthority, true)
  assert.strictEqual(successorG3.admissionGeneration, successorG2.admissionGeneration + 1)
  const successorMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: successorResume.root.activeRoot,
    project: successorResume.root.project
  })
  const successorRead = readTaskRecoveryState({
    metaDir: successorMetaDir,
    identity: {
      activeRoot: successorResume.root.activeRoot,
      project: successorResume.root.project,
      taskId: successorResume.admission.taskId,
      taskStatus: 'active'
    }
  }, { nowMs: successorSecondAt })
  assert.strictEqual(successorRead.state.taskCanonicalRevision.source, 'resume-generation')
  assert.strictEqual(
    successorRead.state.taskCanonicalRevision.parentRevisionDigest,
    successorSecondAttempt.candidate.canonicalRevisionDigest,
    'the persisted resume generation must descend from the confirmed-CP evolution bridge'
  )
  assert.deepStrictEqual(
    successorRead.state.admissionTransaction.effects.cpState.confirmedCpEvidence.map(item => [item.phase, item.version]),
    [['CP1', 'v1'], ['CP2', 'v2.3.0-candidate'], ['CP3', 'v3.3.0-candidate']]
  )
  assert.strictEqual(run(successorSecondAttempt.input, { nowMs: successorSecondAt }).replayed, true)
  const successorSessionsPath = path.join(successorTaskRoot, '.memory', 'sessions.md')
  const successorSessions = fs.readFileSync(successorSessionsPath, 'utf8')
  fs.writeFileSync(
    successorSessionsPath,
    successorSessions.replace(successorNewCp3.sourceMessage, 'tampered-successor-confirmation-source')
  )
  assert.throws(
    () => buildFinalizedResumeAttempt(
      successorResume.root,
      successorG3,
      'finalized-confirmed-cp-successor-tampered',
      successorSecondAt + 500
    ),
    error => error.code === 'FINALIZED_TASK_RESUME_CP_DRIFT',
    'changed confirmation provenance without a new artifact candidate must remain fail closed'
  )

  const historicalDriftFirstAt = NOW_MS + 22 * 60 * 1000
  const historicalDriftResume = createFinalizedResumeFixture('finalized-historical-cp-drift-successor')
  const historicalDriftTaskRoot = taskRootFor(historicalDriftResume.input, historicalDriftResume.admission)
  const historicalOldCp2 = confirmCp(historicalDriftTaskRoot, 'CP2', '02-修复方案.md', 'v2.4.0-candidate')
  const historicalOldCp3 = confirmCp(historicalDriftTaskRoot, 'CP3', '04-实施计划.md', 'v3.4.0-candidate')
  recordAuthorizedOverviewEvolution(historicalDriftResume, [
    '# 问题概况',
    '',
    `> TaskIdentity: \`${historicalDriftResume.admission.taskId}\``,
    `- CP2 ${historicalOldCp2.version}（已确认）`,
    `- CP3 ${historicalOldCp3.version}（已确认）`,
    '',
    '历史 CP1 仍与首代确认一致。',
    ''
  ].join('\n'), historicalDriftFirstAt - 1000)
  setFinalizedResumeLiveness(historicalDriftResume.root, historicalDriftResume.admission, {}, historicalDriftFirstAt)
  const historicalFirstAttempt = buildFinalizedResumeAttempt(
    historicalDriftResume.root,
    historicalDriftResume.admission,
    'finalized-historical-cp-drift-g2',
    historicalDriftFirstAt
  )
  const historicalG2 = run(historicalFirstAttempt.input, { nowMs: historicalDriftFirstAt })
  assert.strictEqual(historicalG2.mutationAuthority, true)

  const historicalDriftSecondAt = NOW_MS + 30 * 60 * 1000
  const historicalCp1Path = path.join(historicalDriftTaskRoot, '01-问题确认.md')
  fs.appendFileSync(historicalCp1Path, '\n后续阶段对历史需求正文的合法扩展。\n')
  const invalidSameVersionCp2 = reconfirmCp(
    historicalDriftTaskRoot,
    'CP2',
    '02-修复方案.md',
    historicalOldCp2.version,
    '摘要变化但版本未续代，不得冒充 successor。',
    '17:01'
  )
  const historicalNewCp3 = reconfirmCp(
    historicalDriftTaskRoot,
    'CP3',
    '04-实施计划-v0.1.9.md',
    'v3.5.0-candidate',
    '合法 CP3 后继迁移到新文件。',
    '17:02'
  )
  const writeHistoricalOverview = cp2 => fs.writeFileSync(path.join(historicalDriftTaskRoot, '00-问题概况.md'), [
    '# 问题概况',
    '',
    `> TaskIdentity: \`${historicalDriftResume.admission.taskId}\``,
    `- CP2 ${cp2.version}（已确认）`,
    `- CP3 ${historicalNewCp3.version}（已确认）`,
    '',
    '历史 CP1 只保留审计，当前 head 由已确认 successor 证明。',
    ''
  ].join('\n'))
  writeHistoricalOverview(invalidSameVersionCp2)
  setFinalizedResumeLiveness(historicalDriftResume.root, historicalG2, {}, historicalDriftSecondAt)
  assert.throws(
    () => buildFinalizedResumeAttempt(
      historicalDriftResume.root,
      historicalG2,
      'finalized-historical-cp-drift-same-version',
      historicalDriftSecondAt
    ),
    error => error.code === 'FINALIZED_TASK_RESUME_CP_DRIFT',
    'a changed artifact digest without a successor version must remain fail closed'
  )

  const historicalNewCp2 = reconfirmCp(
    historicalDriftTaskRoot,
    'CP2',
    '02-修复方案.md',
    'v2.5.0-candidate',
    '合法 CP2 后继候选。',
    '17:03'
  )
  writeHistoricalOverview(historicalNewCp2)
  const historicalMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: historicalDriftResume.root.activeRoot,
    project: historicalDriftResume.root.project
  })
  const historicalIdentity = {
    activeRoot: historicalDriftResume.root.activeRoot,
    project: historicalDriftResume.root.project,
    taskId: historicalDriftResume.admission.taskId,
    taskStatus: 'active'
  }
  const historicalBeforeG3 = readTaskRecoveryState({
    metaDir: historicalMetaDir,
    identity: historicalIdentity
  }, { nowMs: historicalDriftSecondAt })
  const historicalCanonical = readFinalizedResumeCanonicalEvidence(
    historicalBeforeG3.state.admissionTransaction,
    historicalDriftResume.root.activeRoot,
    fs,
    { state: historicalBeforeG3.state }
  )
  assert.deepStrictEqual(
    historicalCanonical.historicalStaleConfirmations.map(item => item.phase),
    ['CP1'],
    'only the superseded CP1 artifact drift should remain diagnostic'
  )
  assert.strictEqual(historicalCanonical.latestConfirmedHead.phase, 'CP3')
  assert.strictEqual(historicalCanonical.latestConfirmedHead.artifactPath, '04-实施计划-v0.1.9.md')
  const historicalSecondAttempt = buildFinalizedResumeAttempt(
    historicalDriftResume.root,
    historicalG2,
    'finalized-historical-cp-drift-g3',
    historicalDriftSecondAt
  )
  const historicalG3 = run(historicalSecondAttempt.input, { nowMs: historicalDriftSecondAt })
  assert.strictEqual(historicalG3.mutationAuthority, true)
  assert.strictEqual(historicalG3.admissionGeneration, historicalG2.admissionGeneration + 1)
  const historicalAfterG3 = readTaskRecoveryState({
    metaDir: historicalMetaDir,
    identity: historicalIdentity
  }, { nowMs: historicalDriftSecondAt })
  assert.deepStrictEqual(
    historicalAfterG3.state.admissionTransaction.effects.cpState.confirmedCpEvidence.map(item => [item.phase, item.version, item.artifactPath]),
    [
      ['CP1', 'v1', '01-问题确认.md'],
      ['CP2', 'v2.5.0-candidate', '02-修复方案.md'],
      ['CP3', 'v3.5.0-candidate', '04-实施计划-v0.1.9.md']
    ]
  )
  const historicalDriftThirdAt = historicalDriftSecondAt + 8 * 60 * 1000
  setFinalizedResumeLiveness(historicalDriftResume.root, historicalG3, {}, historicalDriftThirdAt)
  const historicalThirdAttempt = buildFinalizedResumeAttempt(
    historicalDriftResume.root,
    historicalG3,
    'finalized-historical-cp-drift-g4',
    historicalDriftThirdAt
  )
  const historicalG4 = run(historicalThirdAttempt.input, { nowMs: historicalDriftThirdAt })
  assert.strictEqual(historicalG4.mutationAuthority, true)
  assert.strictEqual(historicalG4.admissionGeneration, historicalG3.admissionGeneration + 1)

  const releasedResumeAt = NOW_MS + 60 * 1000
  const releasedResume = createFinalizedResumeFixture('finalized-released-resume')
  const releasedOwner = runOwner(ownerInput(releasedResume.input, releasedResume.admission, 'release', {
    expectedOwner: ownerRef(releasedResume.owner)
  }), releasedResumeAt)
  assert.strictEqual(releasedOwner.status, 'released')
  setFinalizedResumeLiveness(releasedResume.root, releasedResume.admission, {}, releasedResumeAt)
  const releasedAttempt = buildFinalizedResumeAttempt(
    releasedResume.root,
    releasedResume.admission,
    'finalized-released-resume-next',
    releasedResumeAt
  )
  const releasedResumed = run(releasedAttempt.input, { nowMs: releasedResumeAt })
  assert.strictEqual(releasedResumed.mutationAuthority, true, 'released owner must resume without waiting for idle TTL')

  const releasedSameSessionAt = NOW_MS + 70 * 1000
  const releasedSameSession = createFinalizedResumeFixture('finalized-released-same-session')
  const releasedSameSessionOwner = runOwner(ownerInput(
    releasedSameSession.input,
    releasedSameSession.admission,
    'release',
    { expectedOwner: ownerRef(releasedSameSession.owner) }
  ), releasedSameSessionAt)
  assert.strictEqual(releasedSameSessionOwner.status, 'released')
  setFinalizedResumeLiveness(releasedSameSession.root, releasedSameSession.admission, {
    state: 'running',
    lastEventAt: new Date(releasedSameSessionAt).toISOString(),
    previousTurn: { terminalState: 'completed' }
  }, releasedSameSessionAt)
  const releasedSameSessionAttempt = buildFinalizedResumeAttempt(
    releasedSameSession.root,
    releasedSameSession.admission,
    'finalized-released-same-session-next',
    releasedSameSessionAt,
    { hostSessionId: 'session-finalized-released-same-session' }
  )
  assert.strictEqual(
    releasedSameSessionAttempt.candidate.liveness.releasedSameSessionContextAdvance,
    true,
    'a released owner may resume in the same session under a newly authorized context'
  )
  assert.strictEqual(run(releasedSameSessionAttempt.input, { nowMs: releasedSameSessionAt }).mutationAuthority, true)

  const releasedCrossSessionAt = NOW_MS + 80 * 1000
  const releasedCrossSession = createFinalizedResumeFixture('finalized-released-cross-session')
  const releasedCrossSessionOwner = runOwner(ownerInput(
    releasedCrossSession.input,
    releasedCrossSession.admission,
    'release',
    { expectedOwner: ownerRef(releasedCrossSession.owner) }
  ), releasedCrossSessionAt)
  assert.strictEqual(releasedCrossSessionOwner.status, 'released')
  setFinalizedResumeLiveness(releasedCrossSession.root, releasedCrossSession.admission, {
    state: 'running',
    lastEventAt: new Date(releasedCrossSessionAt).toISOString(),
    previousTurn: { terminalState: 'completed' }
  }, releasedCrossSessionAt)
  const releasedCrossSessionAttempt = buildFinalizedResumeAttempt(
    releasedCrossSession.root,
    releasedCrossSession.admission,
    'finalized-released-cross-session-next',
    releasedCrossSessionAt
  )
  assert.strictEqual(releasedCrossSessionAttempt.candidate.liveness.releasedSameSessionContextAdvance, false)
  assert.throws(
    () => run(releasedCrossSessionAttempt.input, { nowMs: releasedCrossSessionAt }),
    error => error.code === 'FINALIZED_TASK_RESUME_OLD_TURN_LIVE' && error.details?.reasonCode === 'old-turn-live',
    'a released owner must not transfer across sessions while the prior turn is live'
  )

  const noTtlWaitResumeAt = NOW_MS + 60 * 1000
  const noTtlWaitResume = createFinalizedResumeFixture('finalized-no-ttl-wait')
  setFinalizedResumeLiveness(noTtlWaitResume.root, noTtlWaitResume.admission, {}, noTtlWaitResumeAt)
  const noTtlWaitAttempt = buildFinalizedResumeAttempt(
    noTtlWaitResume.root,
    noTtlWaitResume.admission,
    'finalized-no-ttl-wait-next',
    noTtlWaitResumeAt
  )
  assert(Date.parse(noTtlWaitAttempt.prior.owner.expiresAt) > noTtlWaitResumeAt)
  assert.strictEqual(noTtlWaitAttempt.candidate.liveness.ownerLeaseExpiredDiagnostic, false)
  const noTtlWaitResult = run(noTtlWaitAttempt.input, { nowMs: noTtlWaitResumeAt })
  assert.strictEqual(noTtlWaitResult.mutationAuthority, true)
  assert.strictEqual(
    noTtlWaitResult.ownerAcquisition.owner.ownerGeneration,
    noTtlWaitAttempt.prior.owner.ownerGeneration + 1,
    'terminal liveness plus exact CAS must claim immediately without waiting for owner TTL'
  )

  const legacyOwnerlessResumeAt = NOW_MS + 2 * 60 * 1000
  const legacyOwnerlessResume = createFinalizedResumeFixture('finalized-legacy-ownerless')
  rewriteAsLegacyOwnerlessFinalizedState(legacyOwnerlessResume, legacyOwnerlessResumeAt)
  setFinalizedResumeLiveness(
    legacyOwnerlessResume.root,
    legacyOwnerlessResume.admission,
    {},
    legacyOwnerlessResumeAt
  )
  const legacyOwnerlessAttempt = buildFinalizedResumeAttempt(
    legacyOwnerlessResume.root,
    legacyOwnerlessResume.admission,
    'finalized-legacy-ownerless-next',
    legacyOwnerlessResumeAt
  )
  assert.strictEqual(legacyOwnerlessAttempt.prior.owner, undefined)
  assert.strictEqual(legacyOwnerlessAttempt.candidate.prior.ownerStatus, 'missing')
  assert.strictEqual(legacyOwnerlessAttempt.candidate.prior.ownerGeneration, 0)
  const legacyOwnerlessResult = run(legacyOwnerlessAttempt.input, { nowMs: legacyOwnerlessResumeAt })
  assert.strictEqual(legacyOwnerlessResult.mutationAuthority, true)
  assert.strictEqual(legacyOwnerlessResult.ownerAcquisition.owner.ownerGeneration, 1)
  assert.strictEqual(legacyOwnerlessResult.ownerAcquisition.owner.leaseRevision, 1)
  const legacyOwnerlessReplay = run(legacyOwnerlessAttempt.input, { nowMs: legacyOwnerlessResumeAt })
  assert.strictEqual(legacyOwnerlessReplay.replayed, true)
  assert.strictEqual(
    legacyOwnerlessReplay.ownerAcquisition.owner.leaseDigest,
    legacyOwnerlessResult.ownerAcquisition.owner.leaseDigest
  )

  const liveTurnResume = createFinalizedResumeFixture('finalized-live-turn')
  setFinalizedResumeLiveness(liveTurnResume.root, liveTurnResume.admission, {
    state: 'running',
    lastEventAt: new Date(resumeAt - 30 * 1000).toISOString(),
    previousTurn: null
  }, resumeAt)
  const liveTurnAttempt = buildFinalizedResumeAttempt(liveTurnResume.root, liveTurnResume.admission, 'finalized-live-turn-next', resumeAt)
  assert.throws(
    () => run(liveTurnAttempt.input, { nowMs: resumeAt }),
    error => error.code === 'FINALIZED_TASK_RESUME_OLD_TURN_LIVE' && error.details?.reasonCode === 'old-turn-live'
  )

  const expiredLiveTurnAt = NOW_MS + 31 * 60 * 1000
  const expiredLiveTurnResume = createFinalizedResumeFixture('finalized-expired-live-turn')
  setFinalizedResumeLiveness(expiredLiveTurnResume.root, expiredLiveTurnResume.admission, {
    state: 'running',
    lastEventAt: new Date(expiredLiveTurnAt - 30 * 1000).toISOString(),
    previousTurn: null
  }, expiredLiveTurnAt)
  const expiredLiveTurnAttempt = buildFinalizedResumeAttempt(
    expiredLiveTurnResume.root,
    expiredLiveTurnResume.admission,
    'finalized-expired-live-turn-next',
    expiredLiveTurnAt
  )
  assert.strictEqual(expiredLiveTurnAttempt.candidate.liveness.ownerLeaseExpiredDiagnostic, true)
  assert.strictEqual(expiredLiveTurnAttempt.candidate.liveness.noLiveTurn, false)
  assert.throws(
    () => run(expiredLiveTurnAttempt.input, { nowMs: expiredLiveTurnAt }),
    error => error.code === 'FINALIZED_TASK_RESUME_OLD_TURN_LIVE' && error.details?.reasonCode === 'old-turn-live',
    'owner TTL expiry must never transfer authority while the prior turn is still live'
  )

  const unknownSideEffect = createFinalizedResumeFixture('finalized-side-effect-unknown')
  setFinalizedResumeLiveness(unknownSideEffect.root, unknownSideEffect.admission, {
    inFlightOperation: {
      operationId: 'mutation-without-closeout',
      ownedByAgent: true,
      mutating: true,
      leaseExpiresAt: new Date(resumeAt - 1000).toISOString()
    },
    lastMutationCloseout: null
  }, resumeAt)
  const unknownAttempt = buildFinalizedResumeAttempt(
    unknownSideEffect.root,
    unknownSideEffect.admission,
    'finalized-side-effect-unknown-next',
    resumeAt
  )
  assert.throws(
    () => run(unknownAttempt.input, { nowMs: resumeAt }),
    error => error.code === 'FINALIZED_TASK_RESUME_SIDE_EFFECT_UNKNOWN' && error.details?.reasonCode === 'side-effect-unknown'
  )

  const concurrentResume = createFinalizedResumeFixture('finalized-concurrent-resume')
  setFinalizedResumeLiveness(concurrentResume.root, concurrentResume.admission, {}, resumeAt)
  const concurrentAttemptA = buildFinalizedResumeAttempt(
    concurrentResume.root,
    concurrentResume.admission,
    'finalized-concurrent-resume-a',
    resumeAt
  )
  const concurrentAttemptB = buildFinalizedResumeAttempt(
    concurrentResume.root,
    concurrentResume.admission,
    'finalized-concurrent-resume-b',
    resumeAt
  )
  const concurrentWinner = run(concurrentAttemptA.input, { nowMs: resumeAt })
  assert.strictEqual(concurrentWinner.mutationAuthority, true)
  assert.throws(
    () => run(concurrentAttemptB.input, { nowMs: resumeAt }),
    error => error.code === 'FINALIZED_TASK_RESUME_CAS_LOST' && error.details?.reasonCode === 'cas-lost',
    'two fresh sessions must have exactly one CAS winner'
  )

  const driftResume = createFinalizedResumeFixture('finalized-resume-drift')
  setFinalizedResumeLiveness(driftResume.root, driftResume.admission, {}, resumeAt)
  const driftAttempt = buildFinalizedResumeAttempt(driftResume.root, driftResume.admission, 'finalized-resume-drift-next', resumeAt)
  const driftTaskRoot = taskRootFor(driftResume.input, driftResume.admission)
  const overviewPath = path.join(driftTaskRoot, '00-问题概况.md')
  const canonicalOverview = fs.readFileSync(overviewPath, 'utf8')
  fs.writeFileSync(overviewPath, `${canonicalOverview}\n漂移\n`)
  assert.throws(() => run(driftAttempt.input, { nowMs: resumeAt }), error => error.code === 'FINALIZED_TASK_RESUME_CANONICAL_DRIFT')
  fs.writeFileSync(overviewPath, canonicalOverview)
  const identityPathForDrift = path.join(driftTaskRoot, '.memory', 'task.json')
  const canonicalIdentity = fs.readFileSync(identityPathForDrift, 'utf8')
  const changedIdentity = JSON.parse(canonicalIdentity)
  changedIdentity.displayName = `${changedIdentity.displayName}-漂移`
  fs.writeFileSync(identityPathForDrift, `${JSON.stringify(changedIdentity, null, 2)}\n`)
  assert.throws(() => run(driftAttempt.input, { nowMs: resumeAt }), error => error.code === 'FINALIZED_TASK_RESUME_CANONICAL_DRIFT')
  fs.writeFileSync(identityPathForDrift, canonicalIdentity)
  const cpPathForDrift = path.join(driftTaskRoot, '01-问题确认.md')
  const canonicalCp = fs.readFileSync(cpPathForDrift, 'utf8')
  fs.writeFileSync(cpPathForDrift, `${canonicalCp}\n漂移\n`)
  assert.throws(
    () => run(driftAttempt.input, { nowMs: resumeAt }),
    error => error.code === 'FINALIZED_TASK_RESUME_CP_DRIFT' && error.details?.reasonCode === 'cp-drift'
  )
  fs.writeFileSync(cpPathForDrift, canonicalCp)
  const wrongRootLeaseCore = { ...driftAttempt.input.projectTargetLease, rootIdentityDigest: 'b'.repeat(64) }
  delete wrongRootLeaseCore.leaseDigest
  const wrongRootInput = {
    ...driftAttempt.input,
    projectTargetLease: { ...wrongRootLeaseCore, leaseDigest: computeProjectTargetLeaseDigest(wrongRootLeaseCore) }
  }
  assert.throws(() => run(wrongRootInput, { nowMs: resumeAt }), error => error.code === 'FINALIZED_TASK_RESUME_CANDIDATE_MISMATCH')
  assert.throws(
    () => run({
      ...driftAttempt.input,
      serverRuntime: { ...TEST_RUNTIME, generationId: 'stale-runtime-generation', runtimeDigest: 'b'.repeat(64) }
    }, { nowMs: resumeAt }),
    error => error.code === 'FINALIZED_TASK_RESUME_RUNTIME_STALE' && error.details?.reasonCode === 'runtime-generation-stale'
  )
  assert.strictEqual(run(driftAttempt.input, { nowMs: resumeAt }).mutationAuthority, true)

  const reservedRoot = setupRoot('reserved')
  const reservedInput = admissionInput(reservedRoot, 'reserved')
  reservedInput.task = { ...reservedInput.task, displayName: 'CON' }
  assert.throws(() => run(reservedInput), error => error.code === 'TASK_DIRECTORY_NAME_RESERVED')
  assert.strictEqual(fs.existsSync(path.join(reservedRoot.activeRoot, 'bugs')), false)

  const reparseRoot = setupRoot('reparse')
  const outside = path.join(TEMP_ROOT, 'outside-reparse')
  fs.mkdirSync(outside, { recursive: true })
  fs.mkdirSync(path.join(reparseRoot.activeRoot, 'bugs'), { recursive: true })
  fs.symlinkSync(outside, path.join(reparseRoot.activeRoot, 'bugs', '任务-reparse'), process.platform === 'win32' ? 'junction' : 'dir')
  const reparseInput = admissionInput(reparseRoot, 'reparse')
  assert.strictEqual(run(reparseInput).status, 'needs-reconcile')
  assert.strictEqual(fs.readdirSync(outside).length, 0)
  fs.rmSync(path.join(reparseRoot.activeRoot, 'bugs', '任务-reparse'), { recursive: true, force: true })
  const reparseRecovered = run(reparseInput)
  assert.strictEqual(reparseRecovered.phase, 'cp-state-written', 'zero-effect precondition failure must recover after the unsafe path is removed')

  console.log(JSON.stringify({
    schemaVersion: 'TaskAdmissionAuthorityTestReceiptV1',
    passed: true,
    duplicateIngressReplays: 100,
    crashPhases: crashStages.length,
    finalPhase: first.phase
  }))
} finally {
  if (KEEP_TEST_ARTIFACTS) console.log(`[test-artifact-retained] ${TEMP_ROOT}`)
  else fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
}
