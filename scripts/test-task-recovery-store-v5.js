'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  appendTaskRecoveryTelemetry,
  commitTaskAdmissionTransaction,
  commitTaskRecoveryState,
  createTaskRecoveryKey,
  diagnoseTaskRecoveryStore,
  ensureReserve,
  EPHEMERAL_ENTRY_MAX_BYTES,
  inspectDiskHeadroom,
  MUTATION_PREFLIGHT_STATE_MAX_BYTES,
  inspectTaskRecoveryStore,
  maintainTaskRecoveryStore,
  readTaskRecoveryState,
  readTaskAdmissionTransaction,
  storePaths,
  taskPaths,
  taskAdmissionTransactionDigest,
  updateTaskRecoveryState,
  writeStableProjection
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  compactLifecycleStateV5,
  buildColdResumeStub,
  digestValue,
  jsonBytes
} = require('../hooks/_runtime/lifecycle-state-projection-v5.cjs')
const {
  resolveTaskRecoveryConfigForCwd
} = require('../hooks/_runtime/task-recovery-config-v1.cjs')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-task-recovery-v5-'))
const metaDir = path.join(tempRoot, 'hooks', 'devcodex')
const activeRoot = path.join(tempRoot, '.devcodex', 'devcodex')
const baseOptions = {
  reserveBytes: 8 * 1024,
  softBytes: 64 * 1024 * 1024,
  hardBytes: 128 * 1024 * 1024,
  nowMs: Date.parse('2026-08-22T00:00:00Z')
}

function identity(taskId, taskStatus = 'active') {
  return { activeRoot, project: 'devcodex', taskId, taskStatus }
}

function state(taskId, phase = 'CP3') {
  return {
    version: 2,
    mode: 'fix',
    phase,
    activeProject: 'devcodex',
    activeScope: 'project',
    activeProjectSource: 'test',
    promptCount: 1,
    toolUseCount: 1,
    updatedAt: '2026-08-22T00:00:00Z',
    taskRecoveryBinding: {
      taskId,
      displayName: `task-${taskId}`,
      project: 'devcodex',
      kind: 'bugs',
      taskRoot: path.join(activeRoot, 'bugs', taskId),
      status: 'active',
      identityRevision: 1,
      boundAt: '2026-08-22T00:00:00Z'
    },
    contextAcquisition: {
      schemaVersion: 'ContextReadStateV2',
      contextEpoch: 'ctx-test',
      activeRoot,
      project: 'devcodex',
      targetResolved: true,
      hostSessionId: 'session-test',
      verificationMode: 'hook-verified',
      plan: { schemaVersion: 'ContextReadPlanV2', planId: 'plan-test', planContentId: 'plan-content-test', selectedSources: [] },
      receipt: { schemaVersion: 'ContextReadReceiptV2', status: 'complete', satisfiedSourceIds: [] },
      postHistory: []
    },
    turnLiveness: {
      schemaVersion: 1,
      state: 'running',
      turnKey: 'session-test',
      checkpoint: { phase: '', artifactPaths: [], nextAction: '', resumeToken: '', idempotencyKey: '' },
      taskTrace: null,
      executionAttemptLedger: { schemaVersion: 'ExecutionAttemptLedgerV1', entries: [], terminal: null, stopSnapshot: null, duplicateEvents: 0 },
      previousExecutionAttemptLedger: null,
      inFlightOperation: null,
      lastRecoveryCard: null
    }
  }
}

function admissionTransaction(taskId, phase = 'prepared', overrides = {}) {
  const key = overrides.ingressIdempotencyKey || 'a'.repeat(64)
  const phaseOrdinal = ['prepared', 'identity-written', 'overview-written', 'cp-state-written', 'owner-fenced', 'finalized', 'terminal-closeout'].indexOf(phase)
  const value = {
    schemaVersion: 'TaskAdmissionTransactionV1',
    admissionId: `admission-${key.slice(0, 40)}`,
    ingressIdempotencyKey: key,
    admissionPolicyRevision: 'TaskAdmissionPolicyV1@1',
    admissionGeneration: 1,
    phase,
    status: 'admitting',
    operation: 'admit',
    requestDigest: 'b'.repeat(64),
    project: 'devcodex',
    projectRootIdentityDigest: 'c'.repeat(64),
    sessionDigest: 'd'.repeat(64),
    hostVariant: 'codex-cli',
    sourceEventId: `event-${'5'.repeat(40)}`,
    actualInstructionDigest: 'e'.repeat(64),
    workItemId: `work-${'6'.repeat(40)}`,
    workItemDigest: 'f'.repeat(64),
    workflowRouteDigest: '1'.repeat(64),
    routeKey: 'fix.default',
    routeRevision: '7'.repeat(64),
    projectTargetLeaseDigest: '2'.repeat(64),
    taskId,
    displayName: `task-${taskId}`,
    taskKind: 'bugs',
    entryVariant: 'fix',
    taskIdentityDigest: '3'.repeat(64),
    directoryDecisionDigest: '4'.repeat(64),
    taskRootRelative: `bugs/${taskId}`,
    effects: {
      identity: { status: phaseOrdinal < 1 ? 'pending' : 'written' },
      overview: { status: phaseOrdinal < 2 ? 'pending' : 'written' },
      cpState: { status: phaseOrdinal < 3 ? 'pending' : 'confirmed' },
      owner: { status: phaseOrdinal < 4 ? 'pending' : (phase === 'terminal-closeout' ? 'terminal' : 'fenced') }
    },
    error: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides
  }
  value.transactionDigest = taskAdmissionTransactionDigest(value)
  return value
}

function mutationState(taskId, phase = 'implementation') {
  const value = state(taskId, phase)
  const targetPath = path.join(activeRoot, 'bugs', taskId, '02-修复方案.md')
  value.turnLiveness.inFlightOperation = {
    operationId: `operation-${taskId}`,
    toolName: 'apply_patch',
    startedAt: '2026-08-22T00:00:00Z',
    mutating: true,
    targetPaths: [targetPath],
    artifactDecision: {
      schemaVersion: 'ArtifactSlotDecisionV1',
      decisionDigest: 'a'.repeat(64),
      footprintDigest: 'b'.repeat(64),
      targetSetDigest: 'c'.repeat(64),
      operation: 'update',
      slotId: 'bug-cp2',
      targetCount: 1,
      observability: 'complete',
      authoritySourceRef: `fixture:${taskId}`,
      expiresAt: '2026-08-22T00:10:00.000Z',
      singleUse: true
    }
  }
  return value
}

function mutationStateV2Ephemeral() {
  const value = state('00000000-0000-4000-8000-000000000099', 'implementation')
  value.taskRecoveryBinding = null
  const operationId = 'ephemeral-mutation-v2'
  const targetPath = path.join(tempRoot, 'src', 'ephemeral-source.js')
  const decisionDigest = 'a'.repeat(64)
  const footprintDigest = 'b'.repeat(64)
  const plannedSetDigest = 'c'.repeat(64)
  const adapterDigest = 'd'.repeat(64)
  const registryDigest = 'e'.repeat(64)
  value.stickyProject = {
    schemaVersion: 'ProjectTargetLeaseV2',
    targetDigest: '0'.repeat(64),
    rootIdentityDigest: '1'.repeat(64),
    layoutIdentity: '2'.repeat(64),
    project: 'devcodex',
    physicalRoot: tempRoot,
    activeRoot,
    authorityKind: 'session',
    authorityDigest: '3'.repeat(64),
    contextEpoch: 'ctx-test',
    contextBindingDigest: '4'.repeat(64),
    routeRevision: '5'.repeat(64),
    revocationEpoch: 1,
    issuedAtMs: baseOptions.nowMs,
    expiresAtMs: baseOptions.nowMs + 10 * 60 * 1000,
    leaseDigest: '6'.repeat(64),
    source: 'test'
  }
  value.actualInstructionEnvelope = {
    schemaVersion: 'ActualInstructionEnvelopeV1',
    envelopeId: 'aie-0000000000000000000000000000000000000000',
    envelopeDigest: '7'.repeat(64),
    actualInstructionDigest: '8'.repeat(64),
    contextEpoch: 'ctx-test',
    instructionAuthority: true
  }
  value.workflowRouteDecision = {
    schemaVersion: 'WorkflowRouteDecisionV2',
    decisionDigest: '9'.repeat(64),
    routeRevision: '5'.repeat(64),
    routeKey: 'dev.default',
    topIntent: 'dev',
    subtype: 'default'
  }
  value.workflowRoutePlanBinding = {
    bindingDigest: '4'.repeat(64),
    routeRevision: '5'.repeat(64)
  }
  const simpleLeaseSemantic = {
    schemaVersion: 'SimpleTaskFastPathLeaseV1',
    leaseId: `simple-${'a'.repeat(40)}`,
    project: 'devcodex',
    projectRootIdentityDigest: value.stickyProject.rootIdentityDigest,
    projectTargetLeaseDigest: value.stickyProject.leaseDigest,
    sessionDigest: value.stickyProject.authorityDigest,
    turnKey: value.turnLiveness.turnKey,
    contextEpoch: 'ctx-test',
    instructionEnvelopeDigest: value.actualInstructionEnvelope.envelopeDigest,
    actualInstructionDigest: value.actualInstructionEnvelope.actualInstructionDigest,
    routeDecisionDigest: value.workflowRouteDecision.decisionDigest,
    routeRevision: value.workflowRouteDecision.routeRevision,
    routeKey: value.workflowRouteDecision.routeKey,
    operation: 'create-or-update',
    relativeTargets: ['src/ephemeral-source.js'],
    targetSetDigest: 'b'.repeat(64),
    slotId: 'project-source',
    moduleBoundary: 'implementation:src',
    riskAssessment: {
      changeClass: 'local-implementation',
      crossModule: false,
      sharedContract: false,
      publicApiOrSchema: false,
      securitySensitive: false,
      dependencyChange: false,
      releaseImpact: false
    },
    riskEvidenceDigest: 'c'.repeat(64),
    mergedRegistryDigest: registryDigest,
    maxTargets: 2,
    maxUses: 2,
    issuedAt: '2026-08-22T00:00:00.000Z',
    expiresAt: '2026-08-22T00:05:00.000Z',
    status: 'active',
    mutationAuthority: true,
    productMutationAuthority: true,
    formalArtifactAuthority: false,
    controlPlaneAuthority: false,
    releaseAuthority: false
  }
  value.simpleTaskFastPathLease = {
    ...simpleLeaseSemantic,
    leaseDigest: digestValue(simpleLeaseSemantic)
  }
  const simpleUsageSemantic = {
    schemaVersion: 'SimpleTaskFastPathUsageV1',
    leaseDigest: value.simpleTaskFastPathLease.leaseDigest,
    targetSetDigest: value.simpleTaskFastPathLease.targetSetDigest,
    maxUses: 2,
    useCount: 0,
    operationIds: [],
    observedTargetSetDigests: [],
    status: 'active',
    updatedAt: value.simpleTaskFastPathLease.issuedAt
  }
  value.simpleTaskFastPathUsage = {
    ...simpleUsageSemantic,
    usageDigest: digestValue(simpleUsageSemantic)
  }
  value.turnLiveness.inFlightOperation = {
    operationId,
    toolName: 'apply_patch',
    startedAt: '2026-08-22T00:00:00.000Z',
    mutating: true,
    targetPaths: [targetPath],
    artifactDecision: {
      schemaVersion: 'ArtifactSlotDecisionV2',
      project: 'devcodex',
      taskRecoveryKey: null,
      contextEpoch: 'ctx-test',
      operation: 'create-or-update',
      targetSetDigest: 'f'.repeat(64),
      footprintDigest,
      adapterDigest,
      plannedSetDigest,
      mergedRegistryDigest: registryDigest,
      baseRegistryDigest: '1'.repeat(64),
      overlayDigest: null,
      activeRootIdentity: { canonicalPath: activeRoot, digest: '2'.repeat(64) },
      projectRootIdentity: { canonicalPath: tempRoot, digest: '3'.repeat(64) },
      decisionStatus: 'allow',
      expiresAt: '2026-08-22T00:10:00.000Z',
      singleUse: true,
      status: 'active',
      decisionDigest
    },
    mutationLease: {
      schemaVersion: 'TaskOwnedMutationLeaseV2',
      operationId,
      project: 'devcodex',
      taskId: '',
      ownerKind: 'simple-task-fast-path',
      ownerGeneration: null,
      ownerLeaseDigest: value.simpleTaskFastPathLease.leaseDigest,
      contextEpoch: 'ctx-test',
      routeRevision: '5'.repeat(64),
      adapterDigest,
      mergedRegistryDigest: registryDigest,
      slotDecisionDigest: decisionDigest,
      plannedSetDigest,
      nonce: '6'.repeat(64),
      issuedAt: '2026-08-22T00:00:00.000Z',
      expiresAt: '2026-08-22T00:05:00.000Z',
      singleUse: true,
      status: 'active',
      leaseDigest: '7'.repeat(64)
    },
    mutationFootprint: {
      schemaVersion: 'MutationFootprintRecoveryProjectionV2',
      sourceSchemaVersion: 'MutationFootprintV2',
      footprintDigest,
      adapterDigest,
      operation: 'create-or-update',
      plannedCreates: [targetPath],
      plannedModifies: [],
      plannedDeletes: [],
      plannedMoves: [],
      sourceTargets: [],
      targetTargets: [targetPath],
      normalizedTargets: [targetPath],
      plannedSetDigest,
      observationPlan: { method: 'pre-post-byte-identity', targetGranularity: 'exact-target' },
      coverage: 'complete'
    },
    mutationPreObservation: {
      schemaVersion: 'MutationPreObservationV1',
      operationId,
      footprintDigest,
      plannedSetDigest,
      entries: [{ path: targetPath, exists: false, kind: 'missing', digest: null, bytes: 0, complete: true }],
      observationCoverage: 'complete',
      errorCodes: [],
      snapshotDigest: '8'.repeat(64),
      observedAt: '2026-08-22T00:00:00.000Z',
      receiptDigest: '9'.repeat(64)
    }
  }
  return value
}

function listNames(root) {
  const out = []
  function visit(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else out.push(path.relative(root, full).replace(/\\/g, '/'))
    }
  }
  visit(root)
  return out.sort()
}

function faultInjectingFs(kind) {
  const descriptors = new Map()
  let renamedTarget = ''
  let tripped = false
  function fault(code) {
    const error = new Error(`injected ${kind} failure`)
    error.code = code
    tripped = true
    throw error
  }
  return new Proxy(fs, {
    get(target, property) {
      if (property === 'openSync') return (file, flags, ...rest) => {
        if (!tripped && kind === 'open' && /state-next\.tmp$/i.test(String(file))) fault('EIO')
        const descriptor = target.openSync(file, flags, ...rest)
        descriptors.set(descriptor, String(file))
        return descriptor
      }
      if (property === 'closeSync') return descriptor => {
        descriptors.delete(descriptor)
        return target.closeSync(descriptor)
      }
      if (property === 'fsyncSync') return descriptor => {
        if (!tripped && kind === 'fsync' && /state-next\.tmp$/i.test(descriptors.get(descriptor) || '')) fault('EIO')
        if (!tripped && kind === 'reserve' && /emergency-[ab]\.bin$/i.test(descriptors.get(descriptor) || '')) fault('ENOSPC')
        return target.fsyncSync(descriptor)
      }
      if (property === 'renameSync') return (source, destination) => {
        if (!tripped && kind === 'rename' && /state-next\.tmp$/i.test(String(source))) fault('EIO')
        const result = target.renameSync(source, destination)
        if (!tripped && kind === 'readback' && /state-next\.tmp$/i.test(String(source))) renamedTarget = path.resolve(destination)
        return result
      }
      if (property === 'readFileSync') return (file, ...rest) => {
        if (!tripped && renamedTarget && path.resolve(String(file)) === renamedTarget) {
          tripped = true
          return '{injected-broken-readback'
        }
        return target.readFileSync(file, ...rest)
      }
      return target[property]
    }
  })
}

function lockWriteFailureFs() {
  const descriptors = new Map()
  let tripped = false
  let closed = false
  const proxy = new Proxy(fs, {
    get(target, property) {
      if (property === 'openSync') return (file, flags, ...rest) => {
        const descriptor = target.openSync(file, flags, ...rest)
        descriptors.set(descriptor, String(file))
        return descriptor
      }
      if (property === 'writeFileSync') return (targetFile, ...rest) => {
        if (!tripped && Number.isInteger(targetFile) && /store\.lock$/i.test(descriptors.get(targetFile) || '')) {
          tripped = true
          const error = new Error('injected lock write failure')
          error.code = 'EIO'
          throw error
        }
        return target.writeFileSync(targetFile, ...rest)
      }
      if (property === 'closeSync') return descriptor => {
        if (/store\.lock$/i.test(descriptors.get(descriptor) || '')) closed = true
        descriptors.delete(descriptor)
        return target.closeSync(descriptor)
      }
      return target[property]
    }
  })
  return { fs: proxy, wasClosed: () => closed }
}

function taskReadLockTrackingFs(metaDir) {
  const paths = storePaths(metaDir)
  let unlockedTaskSlotReads = 0
  const proxy = new Proxy(fs, {
    get(target, property) {
      if (property === 'readFileSync') return (file, ...rest) => {
        if (/state-[ab]\.json$/i.test(String(file)) && !target.existsSync(paths.storeLock)) {
          unlockedTaskSlotReads += 1
        }
        return target.readFileSync(file, ...rest)
      }
      return target[property]
    }
  })
  return { fs: proxy, unlockedTaskSlotReads: () => unlockedTaskSlotReads }
}

try {
  const stableKey = createTaskRecoveryKey(identity('00000000-0000-4000-8000-000000000001'))
  const caseVariantKey = createTaskRecoveryKey({
    activeRoot: activeRoot.toUpperCase(),
    project: 'DEVCODEX',
    taskId: '00000000-0000-4000-8000-000000000001'
  })
  if (process.platform === 'win32') assert.strictEqual(stableKey, caseVariantKey)
  else assert.notStrictEqual(stableKey, caseVariantKey)

  const oversized = state('00000000-0000-4000-8000-000000000001')
  const dataUrl = `data:image/jpeg;base64,${'A'.repeat(600000)}`
  oversized.turnLiveness.checkpoint.artifactPaths = [dataUrl, path.join(activeRoot, 'README.md')]
  oversized.turnLiveness.lastRecoveryCard = {
    schemaVersion: 1,
    noticeKey: 'notice',
    checkpoint: { phase: 'tool-output-persisted', artifactPaths: [dataUrl, path.join(activeRoot, 'README.md')] }
  }
  const compact = compactLifecycleStateV5(oversized)
  assert(compact.bytes < 256 * 1024)
  assert(!JSON.stringify(compact.state).includes('data:image'))
  assert(compact.state.turnLiveness.checkpoint.artifactPaths.some(item => item.endsWith('README.md')))

  const compactSerializationTaskId = '00000000-0000-4000-8000-0000000000c5'
  const compactSerializationState = state(compactSerializationTaskId)
  compactSerializationState.serializationProbe = Array.from(
    { length: 4000 },
    (_, index) => ({ index, left: 'x', right: 'y' })
  )
  const compactSerializationProjection = compactLifecycleStateV5(compactSerializationState)
  assert(compactSerializationProjection.bytes < 256 * 1024)
  assert(Buffer.byteLength(`${JSON.stringify(compactSerializationProjection.state, null, 2)}\n`, 'utf8') > 256 * 1024)
  const compactSerializationCommit = commitTaskRecoveryState({
    metaDir,
    identity: identity(compactSerializationTaskId),
    sessionKey: 'compact-serialization-session',
    state: compactSerializationState
  }, baseOptions)
  assert.strictEqual(compactSerializationCommit.status, 'committed', JSON.stringify(compactSerializationCommit))
  const compactSerializationPaths = taskPaths(
    storePaths(metaDir),
    createTaskRecoveryKey(identity(compactSerializationTaskId))
  )
  const compactSerializationSlot = compactSerializationPaths.slots.find(file => fs.existsSync(file))
  assert(compactSerializationSlot)
  assert(fs.statSync(compactSerializationSlot).size <= 256 * 1024)
  assert.strictEqual(fs.readFileSync(compactSerializationSlot, 'utf8').split('\n').length, 2)

  const taskId = '00000000-0000-4000-8000-000000000001'
  const first = commitTaskRecoveryState({
    metaDir,
    identity: identity(taskId),
    sessionKey: 'session-test',
    state: state(taskId)
  }, baseOptions)
  assert.strictEqual(first.status, 'committed')
  assert.strictEqual(first.fullStateWrite, true)

  const admissionTaskId = '00000000-0000-4000-8000-0000000000a1'
  const preparedAdmission = admissionTransaction(admissionTaskId)
  const admissionPrepared = commitTaskAdmissionTransaction({
    metaDir,
    identity: identity(admissionTaskId),
    transaction: preparedAdmission
  }, baseOptions)
  assert.strictEqual(admissionPrepared.status, 'committed', JSON.stringify(admissionPrepared))
  const preparedReadback = readTaskAdmissionTransaction({ metaDir, identity: identity(admissionTaskId) })
  assert.strictEqual(preparedReadback.status, 'fresh')
  assert.strictEqual(preparedReadback.transaction.phase, 'prepared')
  assert.strictEqual(buildColdResumeStub(preparedReadback.state).state.admissionTransaction.phase, 'prepared')
  const identityWrittenAdmission = admissionTransaction(admissionTaskId, 'identity-written', {
    effects: {
      identity: { status: 'written', identityDigest: '3'.repeat(64) },
      overview: { status: 'pending' },
      cpState: { status: 'pending' },
      owner: { status: 'pending' }
    }
  })
  const admissionIdentityWritten = commitTaskAdmissionTransaction({
    metaDir,
    identity: identity(admissionTaskId),
    transaction: identityWrittenAdmission,
    expectedPreviousPhase: 'prepared'
  }, baseOptions)
  assert.strictEqual(admissionIdentityWritten.status, 'committed')
  assert.strictEqual(commitTaskAdmissionTransaction({
    metaDir,
    identity: identity(admissionTaskId),
    transaction: identityWrittenAdmission,
    expectedPreviousPhase: 'identity-written'
  }, baseOptions).status, 'semantic-noop')
  const skippedAdmission = admissionTransaction(admissionTaskId, 'cp-state-written')
  assert.strictEqual(commitTaskAdmissionTransaction({
    metaDir,
    identity: identity(admissionTaskId),
    transaction: skippedAdmission,
    expectedPreviousPhase: 'identity-written'
  }, baseOptions).errorCode, 'TASK_ADMISSION_PHASE_TRANSITION_INVALID')
  const invalidAdmission = admissionTransaction('00000000-0000-4000-8000-0000000000a2', 'prepared', {
    taskRootRelative: 'requirements/wrong-kind'
  })
  assert.strictEqual(commitTaskAdmissionTransaction({
    metaDir,
    identity: identity('00000000-0000-4000-8000-0000000000a2'),
    transaction: invalidAdmission
  }, baseOptions).errorCode, 'TASK_ADMISSION_TRANSACTION_INVALID')

  const paths = storePaths(metaDir)
  for (const reserveFile of paths.reserve) {
    const reserve = fs.readFileSync(reserveFile)
    assert.strictEqual(reserve.subarray(reserve.length - 8).toString('ascii'), 'TRV5RS01')
  }
  const corruptReserve = paths.reserve[0]
  const corruptDescriptor = fs.openSync(corruptReserve, 'r+')
  try {
    fs.writeSync(corruptDescriptor, Buffer.alloc(8), 0, 8, fs.statSync(corruptReserve).size - 8)
    fs.fsyncSync(corruptDescriptor)
  } finally {
    fs.closeSync(corruptDescriptor)
  }
  const corruptReserveHeadroom = inspectDiskHeadroom(paths, 0, {
    ...baseOptions,
    availableDiskBytes: (baseOptions.reserveBytes / 2) - 1,
    diskHeadroomBytes: 0
  })
  assert.strictEqual(corruptReserveHeadroom.status, 'BLOCK')
  assert.strictEqual(corruptReserveHeadroom.missingReserveBytes, baseOptions.reserveBytes / 2)
  assert.strictEqual(
    diagnoseTaskRecoveryStore(metaDir, baseOptions).checks.find(check => check.id === 'closeout-reserve').status,
    'BLOCK'
  )
  ensureReserve(paths, baseOptions)
  const ownerPaths = taskPaths(paths, stableKey)
  const namesAfterFirst = listNames(paths.root)
  const slotMtimes = ownerPaths.slots.map(file => fs.existsSync(file) ? fs.statSync(file).mtimeMs : null)
  for (let index = 0; index < 10000; index += 1) {
    const nextState = state(taskId)
    nextState.toolUseCount = index + 2
    nextState.updatedAt = new Date(baseOptions.nowMs + index + 1).toISOString()
    nextState.turnLiveness.lastEventAt = nextState.updatedAt
    const noop = commitTaskRecoveryState({
      metaDir,
      identity: identity(taskId),
      sessionKey: 'session-test',
      state: nextState
    }, { ...baseOptions, nowMs: baseOptions.nowMs + index + 1 })
    assert.strictEqual(noop.status, 'semantic-noop')
    assert.strictEqual(noop.fullStateWrite, false)
  }
  assert.deepStrictEqual(listNames(paths.root), namesAfterFirst)
  assert.deepStrictEqual(ownerPaths.slots.map(file => fs.existsSync(file) ? fs.statSync(file).mtimeMs : null), slotMtimes)

  const secondState = state(taskId, 'implementation')
  const second = commitTaskRecoveryState({
    metaDir,
    identity: identity(taskId),
    sessionKey: 'session-test',
    state: secondState
  }, { ...baseOptions, nowMs: baseOptions.nowMs + 20000 })
  assert.strictEqual(second.status, 'committed')
  assert.strictEqual(ownerPaths.slots.filter(file => fs.existsSync(file)).length, 2)
  const third = commitTaskRecoveryState({
    metaDir,
    identity: identity(taskId),
    sessionKey: 'session-test',
    state: state(taskId, 'validation')
  }, { ...baseOptions, nowMs: baseOptions.nowMs + 30000 })
  assert.strictEqual(third.status, 'committed')
  assert.strictEqual(ownerPaths.slots.filter(file => fs.existsSync(file)).length, 2)
  assert(!listNames(paths.root).some(name => /[0-9a-f]{8}-[0-9a-f]{4}/i.test(path.basename(name))))
  assert(!listNames(paths.root).some(name => /\.tmp-/.test(name)))

  const slotValues = ownerPaths.slots.map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
  const newestIndex = slotValues[0].sequence > slotValues[1].sequence ? 0 : 1
  fs.writeFileSync(ownerPaths.slots[newestIndex], '{broken', 'utf8')
  const recovered = readTaskRecoveryState({ metaDir, identity: identity(taskId) })
  assert.strictEqual(recovered.status, 'fresh')
  assert.strictEqual(recovered.envelope.sequence, 2)

  const mismatch = readTaskRecoveryState({
    metaDir,
    identity: { ...identity(taskId), project: 'smart-listing' }
  })
  assert.notStrictEqual(mismatch.status, 'fresh')

  const preflightMeta = path.join(tempRoot, 'preflight-hooks')
  const preflightId = '00000000-0000-4000-8000-000000000004'
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: preflightMeta,
    identity: identity(preflightId),
    sessionKey: 'preflight-session',
    state: state(preflightId, 'implementation')
  }, baseOptions).status, 'committed')
  const preflightCommit = commitTaskRecoveryState({
    metaDir: preflightMeta,
    identity: identity(preflightId),
    sessionKey: 'preflight-session',
    state: mutationState(preflightId)
  }, { ...baseOptions, nowMs: baseOptions.nowMs + 1, reason: 'mutation-preflight', force: true })
  assert.strictEqual(preflightCommit.status, 'committed')
  assert.strictEqual(preflightCommit.recordType, 'mutation-preflight')
  assert(preflightCommit.preflightBytes <= MUTATION_PREFLIGHT_STATE_MAX_BYTES)
  const preflightRead = readTaskRecoveryState({ metaDir: preflightMeta, identity: identity(preflightId) })
  assert.strictEqual(preflightRead.status, 'fresh')
  assert.strictEqual(preflightRead.envelope.recordType, 'mutation-preflight')
  assert.strictEqual(preflightRead.state.contextAcquisition.plan.planId, 'plan-test')
  assert.strictEqual(preflightRead.state.turnLiveness.inFlightOperation.mutating, true)
  assert.deepStrictEqual(preflightRead.state.turnLiveness.inFlightOperation.artifactAuthorization, {
    schemaVersion: 'ArtifactMutationPreflightV1',
    artifactDecisionDigest: 'a'.repeat(64),
    footprintDigest: 'b'.repeat(64),
    targetSetDigest: 'c'.repeat(64),
    operation: 'update',
    slotId: 'bug-cp2',
    targetCount: 1,
    observability: 'complete',
    authoritySourceRef: `fixture:${preflightId}`,
    expiresAt: '2026-08-22T00:10:00.000Z',
    singleUse: true
  })

  const ephemeralPreflightMeta = path.join(tempRoot, 'ephemeral-preflight-hooks')
  const ephemeralPreflight = commitTaskRecoveryState({
    metaDir: ephemeralPreflightMeta,
    identity: { activeRoot, project: 'devcodex' },
    sessionKey: 'ephemeral-preflight-session',
    state: mutationStateV2Ephemeral()
  }, { ...baseOptions, reason: 'mutation-preflight', force: true })
  assert.strictEqual(ephemeralPreflight.status, 'ephemeral-stub')
  assert.strictEqual(ephemeralPreflight.recordType, 'mutation-preflight')
  assert(ephemeralPreflight.preflightBytes <= MUTATION_PREFLIGHT_STATE_MAX_BYTES)
  const ephemeralPreflightRead = readTaskRecoveryState({
    metaDir: ephemeralPreflightMeta,
    sessionKey: 'ephemeral-preflight-session'
  })
  assert.strictEqual(ephemeralPreflightRead.status, 'ephemeral-stub')
  assert.strictEqual(
    ephemeralPreflightRead.state.turnLiveness.inFlightOperation.artifactDecision.schemaVersion,
    'ArtifactSlotDecisionV2'
  )
  assert.strictEqual(
    ephemeralPreflightRead.state.turnLiveness.inFlightOperation.mutationLease.ownerKind,
    'simple-task-fast-path'
  )
  assert.strictEqual(
    ephemeralPreflightRead.state.simpleTaskFastPathLease.leaseDigest,
    mutationStateV2Ephemeral().simpleTaskFastPathLease.leaseDigest,
    'standalone mutation preflight must recover the exact simple-task owner lease'
  )
  assert.strictEqual(ephemeralPreflightRead.state.simpleTaskFastPathUsage.useCount, 0)
  assert.deepStrictEqual(
    ephemeralPreflightRead.state.turnLiveness.inFlightOperation.mutationFootprint.normalizedTargets,
    [path.join(tempRoot, 'src', 'ephemeral-source.js')],
    'digest-only preflight must reconstruct the exact normalized target set'
  )
  assert.strictEqual(
    ephemeralPreflightRead.state.turnLiveness.inFlightOperation.mutationPreObservation.observationCoverage,
    'complete'
  )

  const secondUseMeta = path.join(tempRoot, 'ephemeral-preflight-second-use-hooks')
  const secondUseState = mutationStateV2Ephemeral()
  const priorOperationId = `simple-prior-${'p'.repeat(80)}`
  const currentOperationId = `simple-current-${'c'.repeat(80)}`
  const secondUseUsageSemantic = {
    ...secondUseState.simpleTaskFastPathUsage,
    useCount: 1,
    operationIds: [priorOperationId],
    observedTargetSetDigests: ['d'.repeat(64)],
    updatedAt: '2026-08-22T00:01:00.000Z'
  }
  delete secondUseUsageSemantic.usageDigest
  secondUseState.simpleTaskFastPathUsage = {
    ...secondUseUsageSemantic,
    usageDigest: digestValue(secondUseUsageSemantic)
  }
  secondUseState.turnLiveness.inFlightOperation.operationId = currentOperationId
  secondUseState.turnLiveness.inFlightOperation.mutationLease.operationId = currentOperationId
  const secondUsePreflight = commitTaskRecoveryState({
    metaDir: secondUseMeta,
    identity: { activeRoot, project: 'devcodex' },
    sessionKey: 'ephemeral-preflight-second-use-session',
    state: secondUseState
  }, { ...baseOptions, reason: 'mutation-preflight', force: true })
  assert.strictEqual(secondUsePreflight.status, 'ephemeral-stub')
  assert(secondUsePreflight.preflightBytes <= MUTATION_PREFLIGHT_STATE_MAX_BYTES)
  const secondUseRead = readTaskRecoveryState({
    metaDir: secondUseMeta,
    sessionKey: 'ephemeral-preflight-second-use-session'
  })
  assert.strictEqual(secondUseRead.state.simpleTaskFastPathUsage.useCount, 1)
  assert.deepStrictEqual(secondUseRead.state.simpleTaskFastPathUsage.operationIds, [priorOperationId])
  assert.strictEqual(secondUseRead.state.turnLiveness.inFlightOperation.operationId, currentOperationId)

  const lowDiskMeta = path.join(tempRoot, 'low-disk-hooks')
  const lowDiskId = '00000000-0000-4000-8000-000000000005'
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: lowDiskMeta,
    identity: identity(lowDiskId),
    sessionKey: 'low-disk-session',
    state: state(lowDiskId, 'implementation')
  }, baseOptions).status, 'committed')
  const lowDisk = commitTaskRecoveryState({
    metaDir: lowDiskMeta,
    identity: identity(lowDiskId),
    sessionKey: 'low-disk-session',
    state: mutationState(lowDiskId)
  }, {
    ...baseOptions,
    availableDiskBytes: 0,
    diskHeadroomBytes: 1,
    reason: 'mutation-preflight',
    force: true
  })
  assert.strictEqual(lowDisk.errorCode, 'LIFECYCLE_DISK_HEADROOM_INSUFFICIENT')
  const lowDiskReadback = readTaskRecoveryState({ metaDir: lowDiskMeta, identity: identity(lowDiskId) })
  assert.strictEqual(lowDiskReadback.status, 'fresh')
  assert.strictEqual(lowDiskReadback.state.turnLiveness.inFlightOperation, null)

  const lockFailureMeta = path.join(tempRoot, 'lock-write-failure-hooks')
  const lockFailureId = '00000000-0000-4000-8000-000000000006'
  const lockFailureFs = lockWriteFailureFs()
  const lockFailure = commitTaskRecoveryState({
    metaDir: lockFailureMeta,
    identity: identity(lockFailureId),
    state: state(lockFailureId)
  }, { ...baseOptions, fs: lockFailureFs.fs })
  assert.strictEqual(lockFailure.status, 'error')
  assert.strictEqual(lockFailure.errorCode, 'EIO')
  assert.strictEqual(lockFailureFs.wasClosed(), true)
  assert.strictEqual(fs.existsSync(storePaths(lockFailureMeta).storeLock), false)
  assert.strictEqual(readTaskRecoveryState({ metaDir: lockFailureMeta, identity: identity(lockFailureId) }).status, 'missing')

  const invalidStaleLockMeta = path.join(tempRoot, 'invalid-stale-lock-hooks')
  const invalidStalePaths = storePaths(invalidStaleLockMeta)
  fs.mkdirSync(invalidStalePaths.root, { recursive: true })
  fs.writeFileSync(invalidStalePaths.storeLock, '{partial-lock')
  const staleLockTime = new Date(Date.now() - 60 * 1000)
  fs.utimesSync(invalidStalePaths.storeLock, staleLockTime, staleLockTime)
  const staleLockId = '00000000-0000-4000-8000-000000000009'
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: invalidStaleLockMeta,
    identity: identity(staleLockId),
    state: state(staleLockId)
  }, { ...baseOptions, lockLeaseMs: 10 }).status, 'committed')

  const liveExpiredLockMeta = path.join(tempRoot, 'live-expired-lock-hooks')
  const liveExpiredPaths = storePaths(liveExpiredLockMeta)
  fs.mkdirSync(liveExpiredPaths.root, { recursive: true })
  fs.writeFileSync(liveExpiredPaths.storeLock, JSON.stringify({
    schemaVersion: 'TaskRecoveryWriterLockV5',
    ownerToken: 'live-owner',
    hostname: os.hostname(),
    pid: process.pid,
    acquiredAtMs: Date.now() - 60 * 1000,
    leaseExpiresAtMs: Date.now() - 30 * 1000
  }))
  const liveExpiredId = '00000000-0000-4000-8000-000000000010'
  const liveExpired = commitTaskRecoveryState({
    metaDir: liveExpiredLockMeta,
    identity: identity(liveExpiredId),
    state: state(liveExpiredId)
  }, { ...baseOptions, lockWaitMs: 5, lockLeaseMs: 10 })
  assert.strictEqual(liveExpired.errorCode, 'LIFECYCLE_STORE_LEASE_CONFLICT')
  assert.strictEqual(fs.existsSync(liveExpiredPaths.storeLock), true)

  const transactionalMeta = path.join(tempRoot, 'transactional-update-hooks')
  const transactionalId = '00000000-0000-4000-8000-000000000011'
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: transactionalMeta,
    identity: identity(transactionalId),
    sessionKey: 'transactional-session',
    state: state(transactionalId)
  }, baseOptions).status, 'committed')
  const lockTracking = taskReadLockTrackingFs(transactionalMeta)
  const transactionalUpdate = updateTaskRecoveryState({
    metaDir: transactionalMeta,
    identity: identity(transactionalId),
    sessionKey: 'transactional-session'
  }, current => ({ ...current, phase: 'transactional-update' }), {
    ...baseOptions,
    fs: lockTracking.fs,
    force: true
  })
  assert.strictEqual(transactionalUpdate.status, 'committed')
  assert.strictEqual(lockTracking.unlockedTaskSlotReads(), 0, 'transactional update must read task slots only while the store lock is held')

  const usageDriftMeta = path.join(tempRoot, 'usage-drift-hooks')
  const usageDriftId = '00000000-0000-4000-8000-000000000013'
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: usageDriftMeta,
    identity: identity(usageDriftId),
    state: state(usageDriftId)
  }, baseOptions).status, 'committed')
  const usageDriftPaths = storePaths(usageDriftMeta)
  const driftedLedger = JSON.parse(fs.readFileSync(usageDriftPaths.manifest, 'utf8'))
  driftedLedger.taskSlotBytes += 123
  driftedLedger.payloadDigest = digestValue({
    schemaVersion: driftedLedger.schemaVersion,
    sequence: driftedLedger.sequence,
    updatedAt: driftedLedger.updatedAt,
    taskSlotBytes: driftedLedger.taskSlotBytes,
    source: driftedLedger.source,
    lastMaintenanceAt: driftedLedger.lastMaintenanceAt
  })
  fs.writeFileSync(usageDriftPaths.manifest, `${JSON.stringify(driftedLedger, null, 2)}\n`, 'utf8')
  const driftedDoctor = diagnoseTaskRecoveryStore(usageDriftMeta, baseOptions)
  assert.strictEqual(driftedDoctor.checks.find(check => check.id === 'usage-ledger').status, 'WARN')
  const reconcilePreview = maintainTaskRecoveryStore(usageDriftMeta, baseOptions)
  const previewReconcileAction = reconcilePreview.actions.find(action => action.action === 'reconcile-usage-ledger')
  assert(previewReconcileAction, 'dry-run must disclose usage-ledger reconciliation')
  assert.strictEqual(previewReconcileAction.ledgerAdjustmentBytes, -123)
  assert.strictEqual(
    diagnoseTaskRecoveryStore(usageDriftMeta, baseOptions).checks.find(check => check.id === 'usage-ledger').status,
    'WARN',
    'dry-run must not reconcile the usage ledger'
  )
  const reconcileApply = maintainTaskRecoveryStore(usageDriftMeta, { ...baseOptions, apply: true })
  assert(reconcileApply.actions.some(action => action.action === 'reconcile-usage-ledger'))
  assert.strictEqual(
    diagnoseTaskRecoveryStore(usageDriftMeta, baseOptions).checks.find(check => check.id === 'usage-ledger').status,
    'PASS'
  )

  const telemetryMeta = path.join(tempRoot, 'telemetry-hooks')
  fs.mkdirSync(telemetryMeta, { recursive: true })
  const retainedLegacyLog = path.join(telemetryMeta, 'interceptions.jsonl')
  fs.writeFileSync(retainedLegacyLog, '{"legacy":true}\n')
  for (let index = 0; index < 24; index += 1) {
    const telemetryWrite = appendTaskRecoveryTelemetry(telemetryMeta, {
      schemaVersion: 'TaskRecoveryTelemetryProbeV1',
      recordType: 'interception',
      observedAt: new Date(baseOptions.nowMs + index).toISOString(),
      code: `probe-${index}`,
      detail: 'x'.repeat(180)
    }, {
      ...baseOptions,
      telemetrySegmentMaxBytes: 1024,
      telemetryRecordMaxBytes: 512
    })
    assert.strictEqual(telemetryWrite.status, 'persisted')
  }
  assert.strictEqual(fs.readFileSync(retainedLegacyLog, 'utf8'), '{"legacy":true}\n')
  const oversizedTelemetry = appendTaskRecoveryTelemetry(telemetryMeta, {
    schemaVersion: 'TaskRecoveryTelemetryProbeV1',
    recordType: 'final-payload-sample',
    observedAt: new Date(baseOptions.nowMs + 100).toISOString(),
    detail: 'y'.repeat(10000)
  }, {
    ...baseOptions,
    telemetrySegmentMaxBytes: 1024,
    telemetryRecordMaxBytes: 512
  })
  assert.strictEqual(oversizedTelemetry.status, 'persisted')
  const telemetryFiles = storePaths(telemetryMeta).telemetry.filter(file => fs.existsSync(file))
  assert(telemetryFiles.length <= 4)
  assert(telemetryFiles.every(file => fs.statSync(file).size <= 1024))
  const telemetryRecords = telemetryFiles.flatMap(file => fs.readFileSync(file, 'utf8')
    .trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)))
  assert(telemetryRecords.some(record => record.recordType === 'final-payload-sample' && record.truncated === true))

  const reserveFailureMeta = path.join(tempRoot, 'reserve-failure-hooks')
  const reserveFailureId = '00000000-0000-4000-8000-000000000007'
  const reserveFailure = commitTaskRecoveryState({
    metaDir: reserveFailureMeta,
    identity: identity(reserveFailureId),
    state: mutationState(reserveFailureId)
  }, {
    ...baseOptions,
    fs: faultInjectingFs('reserve'),
    availableDiskBytes: 1024 * 1024 * 1024,
    reason: 'mutation-preflight',
    force: true
  })
  assert.strictEqual(reserveFailure.errorCode, 'LIFECYCLE_RESERVE_INIT_FAILED')
  assert.strictEqual(readTaskRecoveryState({ metaDir: reserveFailureMeta, identity: identity(reserveFailureId) }).status, 'missing')

  const closeoutReserveFailureMeta = path.join(tempRoot, 'closeout-reserve-failure-hooks')
  const closeoutReserveFailure = commitTaskRecoveryState({
    metaDir: closeoutReserveFailureMeta,
    identity: identity('00000000-0000-4000-8000-000000000008'),
    state: mutationState('00000000-0000-4000-8000-000000000008')
  }, {
    ...baseOptions,
    fs: faultInjectingFs('reserve'),
    softBytes: 1,
    hardBytes: 1,
    reason: 'mutation-closeout',
    force: true
  })
  assert.strictEqual(closeoutReserveFailure.errorCode, 'LIFECYCLE_CLOSEOUT_WRITE_FAILED')

  const capacityMeta = path.join(tempRoot, 'capacity-hooks')
  const blocked = commitTaskRecoveryState({
    metaDir: capacityMeta,
    identity: identity('00000000-0000-4000-8000-000000000002'),
    sessionKey: 'capacity-session',
    state: mutationState('00000000-0000-4000-8000-000000000002')
  }, { ...baseOptions, softBytes: 1, hardBytes: 1, reason: 'mutation-preflight' })
  assert.strictEqual(blocked.errorCode, 'LIFECYCLE_STORAGE_BUDGET_EXCEEDED')
  const closeout = commitTaskRecoveryState({
    metaDir: capacityMeta,
    identity: identity('00000000-0000-4000-8000-000000000002'),
    sessionKey: 'capacity-session',
    state: mutationState('00000000-0000-4000-8000-000000000002')
  }, { ...baseOptions, softBytes: 1, hardBytes: 1, reason: 'mutation-closeout', closeoutStatus: 'completed' })
  assert.strictEqual(closeout.status, 'closeout-reserved')

  const lifecycleMeta = path.join(tempRoot, 'lifecycle-hooks')
  const terminalId = '00000000-0000-4000-8000-000000000003'
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: lifecycleMeta,
    identity: identity(terminalId, 'completed'),
    sessionKey: 'terminal-session',
    state: state(terminalId, 'complete')
  }, baseOptions).status, 'committed')
  const retirement = maintainTaskRecoveryStore(lifecycleMeta, {
    ...baseOptions,
    nowMs: baseOptions.nowMs + 8 * 24 * 60 * 60 * 1000,
    apply: true
  })
  assert(retirement.actions.some(action => action.action === 'retire-terminal'))
  assert.strictEqual(inspectTaskRecoveryStore(lifecycleMeta, baseOptions).counts.hot, 0)

  const coldMeta = path.join(tempRoot, 'cold-hooks')
  const coldId = '00000000-0000-4000-8000-000000000006'
  const checkpointed = state(coldId, 'implementation')
  checkpointed.turnLiveness.checkpoint = {
    phase: 'pre-compact:implementation',
    artifactPaths: [path.join(activeRoot, 'bugs', coldId, '05-实施进度.md')],
    nextAction: 'resume validation',
    resumeToken: 'resume-cold-test',
    idempotencyKey: 'cold-test'
  }
  checkpointed.validationControlIngress = {
    schemaVersion: 'ValidationControlIngressReceiptV1',
    receiptDigest: '1'.repeat(64)
  }
  checkpointed.validationExecution = {
    schemaVersion: 'ValidationExecutionTaskStateV1',
    pendingBudgetCard: { schemaVersion: 'PendingBudgetCardBindingV1', bindingDigest: '2'.repeat(64) },
    rootBudgetConfirmation: { schemaVersion: 'BudgetConfirmationReceiptV1', receiptDigest: '3'.repeat(64) },
    rootBudgetProjection: { schemaVersion: 'ValidationBudgetProjectionV1', selectedNodeIds: ['cold-fixture'] },
    continuationAuthorization: { schemaVersion: 'ValidationContinuationAuthorizationV1', continuationDigest: '4'.repeat(64) },
    currentLease: { schemaVersion: 'VerificationExecutionLeaseV2', authorityDigest: '5'.repeat(64) },
    runnerState: { schemaVersion: 'ManagedValidationRunnerStateV1', stateDigest: '6'.repeat(64) }
  }
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: coldMeta,
    identity: identity(coldId),
    state: checkpointed
  }, baseOptions).status, 'committed')
  const coldMaintenance = maintainTaskRecoveryStore(coldMeta, {
    ...baseOptions,
    nowMs: baseOptions.nowMs + 8 * 24 * 60 * 60 * 1000,
    apply: true
  })
  assert(coldMaintenance.actions.some(action => action.action === 'coldify'))
  assert.strictEqual(inspectTaskRecoveryStore(coldMeta, baseOptions).counts.cold, 1)
  const coldRead = readTaskRecoveryState({ metaDir: coldMeta, identity: identity(coldId) }, baseOptions)
  assert.strictEqual(coldRead.status, 'fresh')
  assert.strictEqual(coldRead.envelope.kind, 'cold')
  assert.strictEqual(coldRead.state.validationControlIngress, null)
  assert.strictEqual(coldRead.state.validationExecution, null,
    'cold resume stubs must strip every live or replayable validation authority record')

  const coldFaultMeta = path.join(tempRoot, 'cold-fault-hooks')
  const coldFaultId = '00000000-0000-4000-8000-000000000012'
  const coldFaultState = state(coldFaultId, 'implementation')
  coldFaultState.turnLiveness.checkpoint = {
    phase: 'pre-compact:implementation',
    artifactPaths: [path.join(activeRoot, 'bugs', coldFaultId, '05-实施进度.md')],
    nextAction: 'resume after coldify fault',
    resumeToken: 'resume-cold-fault',
    idempotencyKey: 'cold-fault'
  }
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: coldFaultMeta,
    identity: identity(coldFaultId),
    state: coldFaultState
  }, baseOptions).status, 'committed')
  const coldFaultMaintenance = maintainTaskRecoveryStore(coldFaultMeta, {
    ...baseOptions,
    fs: faultInjectingFs('rename'),
    nowMs: baseOptions.nowMs + 8 * 24 * 60 * 60 * 1000,
    apply: true
  })
  assert.strictEqual(coldFaultMaintenance.status, 'partial')
  const recoveredAfterColdFault = readTaskRecoveryState({
    metaDir: coldFaultMeta,
    identity: identity(coldFaultId)
  })
  assert.strictEqual(recoveredAfterColdFault.status, 'fresh')
  assert.strictEqual(recoveredAfterColdFault.envelope.kind, 'hot')
  assert.strictEqual(recoveredAfterColdFault.state.turnLiveness.checkpoint.resumeToken, 'resume-cold-fault')

  const simpleEphemeralMeta = path.join(tempRoot, 'simple-ephemeral-hooks')
  const simpleEphemeralState = mutationStateV2Ephemeral()
  simpleEphemeralState.turnLiveness.inFlightOperation = null
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: simpleEphemeralMeta,
    identity: { activeRoot, project: 'devcodex' },
    sessionKey: 'simple-ephemeral-session',
    state: simpleEphemeralState
  }, baseOptions).status, 'ephemeral-stub')
  const simpleEphemeralRead = readTaskRecoveryState({
    metaDir: simpleEphemeralMeta,
    sessionKey: 'simple-ephemeral-session'
  }, baseOptions)
  assert.strictEqual(simpleEphemeralRead.status, 'ephemeral-stub')
  assert.strictEqual(simpleEphemeralRead.state.recoveryCompaction, 'simple-authority-budget')
  assert.deepStrictEqual(
    simpleEphemeralRead.state.simpleTaskFastPathLease,
    simpleEphemeralState.simpleTaskFastPathLease,
    'fixed A/B recovery must preserve the exact simple-task lease'
  )
  assert.deepStrictEqual(
    simpleEphemeralRead.state.simpleTaskFastPathUsage,
    simpleEphemeralState.simpleTaskFastPathUsage,
    'fixed A/B recovery must preserve the exact bounded usage ledger'
  )

  const ephemeralMeta = path.join(tempRoot, 'ephemeral-hooks')
  const ephemeralState = state('ephemeral')
  ephemeralState.taskRecoveryBinding = null
  const operationalLeaseSemantic = {
    schemaVersion: 'WorkflowOperationalWriteLeaseV1',
    leaseId: `operational-${'1'.repeat(40)}`,
    project: 'devcodex',
    activeRootIdentityDigest: '1'.repeat(64),
    projectRootIdentityDigest: '2'.repeat(64),
    projectTargetLeaseDigest: '3'.repeat(64),
    sessionDigest: '4'.repeat(64),
    turnKey: 'session-test',
    contextEpoch: 'ctx-test',
    instructionEnvelopeDigest: '5'.repeat(64),
    routeDecisionDigest: '6'.repeat(64),
    routeRevision: '7'.repeat(64),
    taskId: null,
    operation: 'create',
    relativeTargets: ['reports/analysis/codex/20260825/01--operational.md'],
    targetSetDigest: '8'.repeat(64),
    slotId: 'project-report',
    authorityRole: 'workflow-owner',
    mergedRegistryDigest: '9'.repeat(64),
    issuedAt: '2026-08-22T00:00:00.000Z',
    expiresAt: '2026-08-22T00:05:00.000Z',
    singleUse: true,
    status: 'active',
    mutationAuthority: true,
    productMutationAuthority: false,
    formalArtifactAuthority: false,
    releaseAuthority: false
  }
  ephemeralState.workflowOperationalWriteLease = {
    ...operationalLeaseSemantic,
    leaseDigest: digestValue(operationalLeaseSemantic)
  }
  ephemeralState.stickyProject = {
    schemaVersion: 'ProjectTargetLeaseV2',
    leaseId: 'project-target-lease-fixture',
    targetDigest: 'a'.repeat(64),
    layoutIdentity: 'b'.repeat(64),
    project: 'devcodex',
    physicalRoot: tempRoot,
    activeRoot,
    source: 'test',
    leaseDigest: '3'.repeat(64),
    rootIdentityDigest: '2'.repeat(64),
    authorityKind: 'session',
    authorityDigest: '4'.repeat(64),
    contextEpoch: 'ctx-test',
    contextBindingDigest: 'c'.repeat(64),
    routeRevision: '7'.repeat(64),
    revocationEpoch: 1,
    issuedAtMs: baseOptions.nowMs,
    expiresAtMs: baseOptions.nowMs + 10 * 60 * 1000
  }
  ephemeralState.actualInstructionEnvelope = {
    schemaVersion: 'ActualInstructionEnvelopeV1',
    envelopeId: 'envelope-operational-fixture',
    envelopeDigest: '5'.repeat(64),
    contextEpoch: 'ctx-test',
    instructionAuthority: true
  }
  ephemeralState.workflowRouteDecision = {
    schemaVersion: 'WorkflowRouteDecisionV2',
    decisionDigest: '6'.repeat(64),
    routeRevision: '7'.repeat(64)
  }
  ephemeralState.workflowRoutePlanBinding = {
    bindingDigest: 'c'.repeat(64),
    routeRevision: '7'.repeat(64)
  }
  ephemeralState.progressiveSkillRoute = {
    schemaVersion: 'LifecycleSkillRouteStateV1',
    modeReceipt: {
      schemaVersion: 'SkillRouteModeReceiptV1',
      effective: 'unified',
      hostVariant: 'codex-cli',
      processRuntimeIdentity: { diagnosticBody: 'm'.repeat(12 * 1024) }
    },
    bootstrap: {
      schemaVersion: 'SkillRouteBootstrapV1',
      project: 'devcodex',
      turnBinding: 'turn-operational-fixture',
      contextEpoch: 'ctx-test',
      bootstrapDigest: 'd'.repeat(64),
      explicitStatus: 'none',
      diagnosticBody: 'b'.repeat(12 * 1024)
    },
    active: true,
    errorCode: null
  }
  ephemeralState.progressiveSkillRouteStop = {
    schemaVersion: 'ProgressiveSkillRouteStopV1',
    present: true,
    complete: true,
    turnBinding: 'turn-operational-fixture',
    contextEpoch: 'ctx-test',
    planDigest: 'e'.repeat(64),
    processComplete: true,
    retired: false,
    diagnosticBody: 's'.repeat(12 * 1024)
  }
  ephemeralState.workflowOperationalWriteLeaseCloseout = {
    schemaVersion: 'WorkflowOperationalWriteLeaseCloseoutV1',
    leaseDigest: 'f'.repeat(64),
    operationId: 'prior-operational-write',
    status: 'consumed',
    completedAt: '2026-08-22T00:00:00.000Z',
    receiptDigest: 'a'.repeat(64)
  }
  ephemeralState.turnLiveness.lastMutationCloseout = {
    schemaVersion: 'LifecycleMutationCloseoutV2',
    operationId: 'prior-operational-write',
    result: 'success',
    observation: { diagnosticBody: 'o'.repeat(16 * 1024) }
  }
  ephemeralState.dangerousApprovals = Object.fromEntries(Array.from({ length: 11 }, (_, index) => {
    const approvalId = index.toString(16).padStart(12, '0')
    const confirmed = index % 2 === 1
    return [approvalId, {
      commandHash: index.toString(16).padStart(64, '0'),
      cwd: activeRoot,
      reason: `dangerous fixture ${index}`,
      status: confirmed ? 'confirmed' : 'pending',
      createdAt: new Date(baseOptions.nowMs + index).toISOString(),
      createdAtMs: baseOptions.nowMs + index,
      used: index === 10,
      ...(confirmed
        ? {
            confirmedAt: new Date(baseOptions.nowMs + index + 1).toISOString(),
            confirmedBy: 'UserPromptSubmit'
          }
        : {})
    }]
  }))
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: ephemeralMeta,
    identity: { activeRoot, project: 'devcodex' },
    sessionKey: 'ephemeral-session',
    state: ephemeralState
  }, baseOptions).status, 'ephemeral-stub')
  const approvalEphemeralRead = readTaskRecoveryState({
    metaDir: ephemeralMeta,
    sessionKey: 'ephemeral-session'
  }, baseOptions)
  assert.strictEqual(approvalEphemeralRead.status, 'ephemeral-stub')
  assert.strictEqual(
    approvalEphemeralRead.state.workflowOperationalWriteLease.leaseDigest,
    ephemeralState.workflowOperationalWriteLease.leaseDigest,
    'taskless fixed A/B projection must preserve the exact active operational lease'
  )
  assert.strictEqual(
    approvalEphemeralRead.state.recoveryCompaction,
    'operational-authority-budget',
    'active operational authority must use the bounded dedicated recovery projection'
  )
  assert.strictEqual(
    approvalEphemeralRead.state.workflowOperationalWriteLeaseCloseout.leaseDigest,
    ephemeralState.workflowOperationalWriteLeaseCloseout.leaseDigest,
    'the prior consumed lease digest must survive to reject result replay'
  )
  assert.strictEqual(
    approvalEphemeralRead.state.turnLiveness.lastMutationCloseout,
    undefined,
    'superseded mutation closeout detail must not crowd out active authority'
  )
  assert.strictEqual(
    approvalEphemeralRead.state.dangerousApprovals,
    undefined,
    'legacy DevCodex-owned operation approvals must not survive V5 projection; the host owns permission state'
  )
  const ephemeralMaintenance = maintainTaskRecoveryStore(ephemeralMeta, {
    ...baseOptions,
    nowMs: baseOptions.nowMs + 2 * 24 * 60 * 60 * 1000,
    apply: true
  })
  assert(ephemeralMaintenance.actions.some(action => action.action === 'expire-ephemeral'))
  assert.strictEqual(inspectTaskRecoveryStore(ephemeralMeta, baseOptions).counts.ephemeral, 0)

  const oversizedEphemeralMeta = path.join(tempRoot, 'oversized-ephemeral-hooks')
  const oversizedEphemeralState = state('oversized-ephemeral')
  oversizedEphemeralState.taskRecoveryBinding = null
  oversizedEphemeralState.progressiveSkillRoute = {
    schemaVersion: 'ProgressiveSkillRouteStateV1',
    bootstrap: {
      schemaVersion: 'ProgressiveSkillRouteBootstrapV1',
      project: 'devcodex',
      turnBinding: 'turn-' + 'a'.repeat(40),
      contextEpoch: 'ctx-test',
      planId: 'plan-test',
      planContentId: 'plan-content-test',
      tool: { diagnosticBody: 'x'.repeat(24 * 1024) }
    },
    pending: { diagnosticBody: 'y'.repeat(24 * 1024) },
    active: true
  }
  oversizedEphemeralState.progressiveSkillRouteStop = {
    schemaVersion: 'ProgressiveSkillRouteStopV1',
    present: true,
    complete: false,
    turnBinding: 'turn-' + 'a'.repeat(40),
    contextEpoch: 'ctx-test',
    nextCall: { diagnosticBody: 'z'.repeat(24 * 1024) }
  }
  const oversizedEphemeralCommit = commitTaskRecoveryState({
    metaDir: oversizedEphemeralMeta,
    identity: { activeRoot, project: 'devcodex' },
    sessionKey: 'oversized-ephemeral-session',
    state: oversizedEphemeralState
  }, baseOptions)
  assert.strictEqual(oversizedEphemeralCommit.status, 'ephemeral-stub')
  const oversizedEphemeralRead = readTaskRecoveryState({
    metaDir: oversizedEphemeralMeta,
    sessionKey: 'oversized-ephemeral-session',
    expectedIdentity: { activeRoot, project: 'devcodex' }
  }, baseOptions)
  assert.strictEqual(oversizedEphemeralRead.status, 'ephemeral-stub')
  assert.strictEqual(oversizedEphemeralRead.state.recoveryCompaction, 'minimal-budget')
  assert.strictEqual(oversizedEphemeralRead.state.contextAcquisition.handoff.planId, 'plan-test')
  const oversizedRingFiles = storePaths(oversizedEphemeralMeta).ephemeral
    .filter(file => fs.existsSync(file))
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
    .sort((left, right) => right.sequence - left.sequence)
  const oversizedEntry = oversizedRingFiles[0].entries.find(entry => entry.sessionKeyDigest)
  assert(jsonBytes(oversizedEntry) <= EPHEMERAL_ENTRY_MAX_BYTES)

  for (const faultKind of ['open', 'fsync', 'rename', 'readback']) {
    const faultMeta = path.join(tempRoot, `fault-${faultKind}`)
    const faultId = `20000000-0000-4000-8000-${faultKind.padEnd(12, '0').slice(0, 12)}`
    assert.strictEqual(commitTaskRecoveryState({
      metaDir: faultMeta,
      identity: identity(faultId),
      state: state(faultId, 'before-fault')
    }, baseOptions).status, 'committed')
    const failed = commitTaskRecoveryState({
      metaDir: faultMeta,
      identity: identity(faultId),
      state: state(faultId, `after-${faultKind}`)
    }, { ...baseOptions, fs: faultInjectingFs(faultKind), force: true })
    assert.strictEqual(failed.status, 'error', `${faultKind} must fail the attempted commit`)
    const afterFault = readTaskRecoveryState({ metaDir: faultMeta, identity: identity(faultId) })
    assert.strictEqual(afterFault.status, 'fresh')
    assert.strictEqual(afterFault.envelope.sequence, 1, `${faultKind} must preserve the prior valid slot`)
    assert(!listNames(storePaths(faultMeta).root).some(name => name.endsWith('.tmp')))
  }

  const closeoutFaultMeta = path.join(tempRoot, 'fault-closeout')
  const closeoutFaultId = '30000000-0000-4000-8000-000000000001'
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: closeoutFaultMeta,
    identity: identity(closeoutFaultId),
    state: state(closeoutFaultId, 'before-mutation')
  }, baseOptions).status, 'committed')
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: closeoutFaultMeta,
    identity: identity(closeoutFaultId),
    state: mutationState(closeoutFaultId)
  }, { ...baseOptions, reason: 'mutation-preflight', force: true }).status, 'committed')
  const reservedCloseout = commitTaskRecoveryState({
    metaDir: closeoutFaultMeta,
    identity: identity(closeoutFaultId),
    state: mutationState(closeoutFaultId, 'mutation-finished')
  }, {
    ...baseOptions,
    fs: faultInjectingFs('rename'),
    reason: 'mutation-closeout',
    closeoutStatus: 'needs-reconcile',
    force: true
  })
  assert.strictEqual(reservedCloseout.status, 'closeout-reserved')
  assert.strictEqual(readTaskRecoveryState({
    metaDir: closeoutFaultMeta,
    identity: identity(closeoutFaultId)
  }).envelope.recordType, 'mutation-preflight')

  const scaleMeta = path.join(tempRoot, 'scale-hooks')
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index.toString(16).padStart(12, '0')
    const id = `10000000-0000-4000-8000-${suffix}`
    const result = commitTaskRecoveryState({
      metaDir: scaleMeta,
      identity: identity(id),
      state: state(id)
    }, baseOptions)
    assert.strictEqual(result.status, 'committed')
    assert.notStrictEqual(result.errorCode, 'LIFECYCLE_OWNER_CAPACITY_EXCEEDED')
  }
  const scaleStatus = inspectTaskRecoveryStore(scaleMeta, baseOptions)
  assert.strictEqual(scaleStatus.counts.hot, 1000)
  assert(scaleStatus.managedFiles <= 2 * 1000 + 16)

  fs.mkdirSync(path.join(tempRoot, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(tempRoot, '.devcodex', 'devcodex', 'profile'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, '.devcodex', 'layout.json'), JSON.stringify({ mode: 'workspace-namespace' }))
  fs.writeFileSync(path.join(tempRoot, '.devcodex', 'workspace', 'profile', 'config.json'), JSON.stringify({
    extensions: { devcodex: { taskRecovery: { hardLimitMiB: 768 } } }
  }))
  fs.writeFileSync(path.join(tempRoot, '.devcodex', 'devcodex', 'profile', 'config.json'), JSON.stringify({
    extensions: { devcodex: { taskRecovery: { hardLimitMiB: 1024 } } }
  }))
  const configuredRecovery = resolveTaskRecoveryConfigForCwd(tempRoot, 'devcodex')
  assert.strictEqual(configuredRecovery.status, 'configured')
  assert.strictEqual(configuredRecovery.softLimitMiB, 256)
  assert.strictEqual(configuredRecovery.hardLimitMiB, 1024)
  assert.strictEqual(configuredRecovery.hardBytes, 1024 * 1024 * 1024)
  fs.writeFileSync(path.join(tempRoot, '.devcodex', 'devcodex', 'profile', 'config.json'), JSON.stringify({
    extensions: { devcodex: { taskRecovery: { hardLimitMiB: 256 } } }
  }))
  const invalidRecovery = resolveTaskRecoveryConfigForCwd(tempRoot, 'devcodex')
  assert.strictEqual(invalidRecovery.status, 'fail-closed')
  assert.strictEqual(invalidRecovery.errorCode, 'TASK_RECOVERY_CONFIG_INVALID')
  assert.strictEqual(invalidRecovery.hardLimitMiB, 512)

  const projectionFile = path.join(tempRoot, 'projection', 'lifecycle-state.json')
  assert.strictEqual(
    digestValue({ omitted: undefined, values: [undefined] }),
    digestValue({ values: [null] }),
    'stable digest must follow JSON semantics for optional undefined fields'
  )
  assert.throws(() => digestValue(undefined), error => error?.code === 'LIFECYCLE_STATE_DIGEST_INPUT_INVALID')
  assert.strictEqual(jsonBytes(undefined), 0)
  assert.strictEqual(writeStableProjection(projectionFile, state(taskId)).status, 'persisted')
  assert.strictEqual(writeStableProjection(projectionFile, state(taskId, 'next')).status, 'persisted')
  assert(!fs.existsSync(`${projectionFile}.v5.tmp`))

  console.log(JSON.stringify({
    schemaVersion: 'TaskRecoveryStoreV5TestReceipt',
    passed: true,
    eventNoopIterations: 10000,
    formalTasks: scaleStatus.counts.hot,
    configuredHardLimitMiB: configuredRecovery.hardLimitMiB,
    managedFiles: scaleStatus.managedFiles,
    reserveBytes: scaleStatus.reserveBytes,
    tempRoot
  }))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
