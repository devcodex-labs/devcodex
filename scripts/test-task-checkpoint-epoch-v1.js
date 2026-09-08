'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  CHECKPOINT_BOOTSTRAP_TTL_MS,
  TASK_CHECKPOINT_EPOCH_SET_SCHEMA,
  activateTaskCheckpointEpochBootstrap,
  checkpointEpochId,
  compactTaskCheckpointEpochSet,
  digestValue,
  emptyCheckpointPhaseSlot,
  prepareTaskCheckpointEpochBootstrap,
  sealCheckpointEpochBootstrapAuthority,
  sealCheckpointPhaseBinding,
  sealCheckpointPhaseSlot,
  sealTaskCheckpointEpoch,
  sealTaskCheckpointEpochSet,
  validateCheckpointEpochBootstrapAuthority,
  validateTaskCheckpointEpochSet
} = require('../hooks/_runtime/task-checkpoint-epoch-v1.cjs')
const {
  COLD_STUB_MAX_BYTES,
  buildColdResumeStub,
  compactLifecycleStateV5
} = require('../hooks/_runtime/lifecycle-state-projection-v5.cjs')
const {
  commitTaskRecoveryState,
  readTaskRecoveryState
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')

const nowMs = Date.parse('2026-09-05T08:00:00.000Z')
const taskId = '10000000-0000-4000-8000-000000000001'
const activeRoot = path.join(os.tmpdir(), 'devcodex-epoch-active-root')
const activeRootDigest = digestValue(activeRoot.replace(/\\/g, '/').toLowerCase())
const leaseDigest = digestValue('lease-0')
const scopeDigest = digestValue('scope')
const confirmationSourceDigest = digestValue('@rocky-stage-b')
const templateQualificationDigest = digestValue('implementation-plan-template')

function binding(phase, stage, role = 'primary') {
  return sealCheckpointPhaseBinding({
    phase,
    role,
    artifactPath: `requirements/task/${stage}-${phase.toLowerCase()}${role === 'supplement' ? '-supplement' : ''}.md`,
    artifactSha256: digestValue(`${stage}:${phase}:${role}:artifact`),
    artifactVersion: `${stage}-v1`,
    templateQualificationDigest,
    confirmationSourceDigest,
    confirmedAt: new Date(nowMs).toISOString(),
    confirmationMode: role === 'supplement' ? 'task-scoped-auto' : 'bootstrap-import'
  })
}

function confirmedSlot(phase, stage, supplements = []) {
  return sealCheckpointPhaseSlot({
    phase,
    state: 'confirmed',
    currentBinding: binding(phase, stage),
    supplements,
    history: [],
    slotSequence: 1
  })
}

function epoch(input = {}) {
  const ordinal = input.ordinal || 1
  const stage = input.stage || `stage-${ordinal}`
  const status = input.status || 'superseded'
  return sealTaskCheckpointEpoch({
    ordinal,
    parentEpochId: input.parentEpochId || null,
    stageKey: stage,
    status,
    terminalStatus: input.terminalStatus || null,
    task: {
      taskId,
      taskKind: 'requirements',
      project: 'devcodex',
      activeRootDigest,
      admissionId: `admission-${ordinal}`
    },
    lineage: {
      canonicalRevision: ordinal,
      canonicalParentRevision: ordinal > 1 ? ordinal - 1 : null,
      canonicalHeadDigest: digestValue(`head-${ordinal}`),
      scopeDigest
    },
    owner: {
      ownerGeneration: 0,
      leaseRevision: ordinal,
      leaseDigest
    },
    context: {
      contextEpoch: `ctx-${ordinal}`,
      planContentId: `plan-content-${ordinal}`,
      autoGrantDigest: null,
      autoDecisionDigest: null,
      validationAuthorityDigest: null
    },
    phases: {
      CP1: confirmedSlot('CP1', stage),
      CP2: input.complete === false ? emptyCheckpointPhaseSlot('CP2') : confirmedSlot('CP2', stage),
      CP3: input.complete === false ? emptyCheckpointPhaseSlot('CP3') : confirmedSlot('CP3', stage)
    },
    runtime: {
      stateSchemaVersion: 'TaskRecoveryStateV5',
      packageVersion: '1.19.5',
      mcpProtocolVersion: '2025-06-18',
      sourceHead: '38cace34c8bde1157a41c188d6966ef33e6a83f0',
      epochCapability: 1
    },
    createdAt: new Date(nowMs - (10 - ordinal) * 60_000).toISOString(),
    activatedAt: status === 'current' || status === 'superseded' ? new Date(nowMs - (9 - ordinal) * 60_000).toISOString() : null,
    supersededAt: status === 'superseded' ? new Date(nowMs - (8 - ordinal) * 60_000).toISOString() : null,
    terminalAt: input.terminalStatus ? new Date(nowMs - (7 - ordinal) * 60_000).toISOString() : null,
    trigger: 'test-fixture'
  })
}

function bootstrapEvidence() {
  const primary = binding('CP1', 'stage-b')
  const supplement = binding('CP1', 'stage-b', 'supplement')
  return [
    { ...primary, role: 'primary', bindingDigest: undefined },
    { ...supplement, role: 'supplement', bindingDigest: undefined }
  ]
}

function bootstrapAuthority(parentEpochId) {
  return sealCheckpointEpochBootstrapAuthority({
    task: { taskId, taskKind: 'requirements', project: 'devcodex', activeRootDigest },
    target: { stageKey: 'Stage B', expectedOrdinal: 2, parentEpochId },
    evidence: bootstrapEvidence(),
    runtime: {
      sourceHead: '38cace34c8bde1157a41c188d6966ef33e6a83f0',
      stateSchemaVersion: 'TaskRecoveryStateV5',
      packageVersion: '1.19.5',
      mcpProtocolVersion: '2025-06-18',
      epochCapability: 1
    },
    fence: { expectedStateSequence: 0, expectedWriterGeneration: 0, expectedOwnerGeneration: 0 },
    createdBy: 'workflow-single-writer',
    createdAt: new Date(nowMs).toISOString()
  })
}

function targetBinding() {
  return {
    admissionId: 'admission-stage-b',
    lineage: {
      canonicalRevision: 2,
      canonicalParentRevision: 1,
      canonicalHeadDigest: digestValue('stage-b-head'),
      scopeDigest
    },
    owner: { ownerGeneration: 0, leaseRevision: 2, leaseDigest },
    context: {
      contextEpoch: 'ctx-stage-b',
      planContentId: 'plan-content-stage-b',
      autoGrantDigest: digestValue('auto-grant'),
      autoDecisionDigest: digestValue('auto-decision'),
      validationAuthorityDigest: null
    }
  }
}

function expectCode(code, callback) {
  assert.throws(callback, error => error?.code === code, `expected ${code}`)
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-task-epoch-v1-'))
  try {
    const first = epoch({ ordinal: 1, stage: 'stage-a', status: 'superseded' })
    const deterministic = checkpointEpochId({
      taskId,
      ordinal: 1,
      parentEpochId: null,
      stageKey: 'Stage A',
      primaryCp1Digest: first.phases.CP1.currentBinding.artifactSha256
    })
    assert.strictEqual(deterministic, first.epochId)
    assert.notStrictEqual(checkpointEpochId({
      taskId,
      ordinal: 1,
      parentEpochId: null,
      stageKey: 'Stage A revised',
      primaryCp1Digest: first.phases.CP1.currentBinding.artifactSha256
    }), first.epochId)

    const authority = bootstrapAuthority(first.epochId)
    const mixedAuthority = sealCheckpointEpochBootstrapAuthority({
      ...authority, task: { ...authority.task, project: 'MixedA' }
    })
    const mixedDigest = mixedAuthority.authorityDigest
    assert.strictEqual(validateCheckpointEpochBootstrapAuthority(mixedAuthority,
      { project: 'mixeda', activeRootDigest }, { nowMs }).valid, true)
    assert.strictEqual(mixedAuthority.task.project, 'MixedA')
    assert.strictEqual(mixedAuthority.authorityDigest, mixedDigest)
    assert.strictEqual(validateCheckpointEpochBootstrapAuthority(mixedAuthority,
      { project: 'other' }, { nowMs }).errors.includes('authority-project'), true)
    assert.strictEqual(validateCheckpointEpochBootstrapAuthority(mixedAuthority,
      { project: 'mixeda', activeRootDigest: digestValue('other-root') }, { nowMs }).errors.includes('authority-active-root'), true)
    assert.strictEqual(authority.expiresAt, new Date(nowMs + CHECKPOINT_BOOTSTRAP_TTL_MS).toISOString())
    assert.strictEqual(validateCheckpointEpochBootstrapAuthority(authority, { taskId, project: 'devcodex' }, { nowMs }).valid, true)
    assert.strictEqual(validateCheckpointEpochBootstrapAuthority(authority, { taskId }, { nowMs: nowMs + CHECKPOINT_BOOTSTRAP_TTL_MS + 1 }).errors.includes('authority-expired'), true)
    const tamperedAuthority = { ...authority, task: { ...authority.task, project: 'other' } }
    assert.strictEqual(validateCheckpointEpochBootstrapAuthority(tamperedAuthority, {}, { nowMs }).valid, false)

    const prepared = prepareTaskCheckpointEpochBootstrap({
      authority,
      historicalEpochs: [first],
      targetBinding: targetBinding(),
      taskId,
      project: 'devcodex',
      activeRootDigest,
      stateSequence: 0,
      writerGeneration: 0,
      legacyProjectionDigest: digestValue('legacy-current-only')
    }, { nowMs })
    assert.strictEqual(prepared.status, 'prepared')
    assert.strictEqual(prepared.epochSet.schemaVersion, TASK_CHECKPOINT_EPOCH_SET_SCHEMA)
    assert.strictEqual(prepared.epochSet.currentEpochId, null)
    assert.deepStrictEqual(prepared.epochSet.epochs.map(item => item.status), ['superseded', 'preparing'])
    assert.strictEqual(prepareTaskCheckpointEpochBootstrap({
      authority,
      existingSet: prepared.epochSet,
      taskId,
      project: 'devcodex',
      activeRootDigest,
      stateSequence: 0,
      writerGeneration: 0
    }, { nowMs }).status, 'unchanged')

    const driftEvidence = bootstrapEvidence()
    driftEvidence[0] = { ...driftEvidence[0], artifactSha256: digestValue('changed') }
    expectCode('CHECKPOINT_EPOCH_BOOTSTRAP_EVIDENCE_DRIFT', () => activateTaskCheckpointEpochBootstrap({
      epochSet: prepared.epochSet,
      authority,
      observedEvidence: driftEvidence
    }, { nowMs: nowMs + 1_000 }))

    const activated = activateTaskCheckpointEpochBootstrap({
      epochSet: prepared.epochSet,
      authority,
      observedEvidence: bootstrapEvidence()
    }, { nowMs: nowMs + 1_000 })
    assert.strictEqual(activated.status, 'activated')
    assert.strictEqual(activated.authority.status, 'consumed')
    assert.strictEqual(activated.epochSet.migration.status, 'verified')
    assert.strictEqual(activated.epochSet.epochs.filter(item => item.status === 'current').length, 1)
    assert.strictEqual(activated.epochSet.currentEpochId, activated.epochSet.epochs[1].epochId)
    assert.strictEqual(activateTaskCheckpointEpochBootstrap({
      epochSet: activated.epochSet,
      authority: activated.authority
    }, { nowMs: nowMs + 2_000 }).status, 'unchanged')

    const digestTamper = JSON.parse(JSON.stringify(activated.epochSet))
    digestTamper.nextOrdinal += 1
    assert.strictEqual(validateTaskCheckpointEpochSet(digestTamper).errors.includes('set-digest'), true)
    const protocolTamper = { ...activated.epochSet, writeProtocol: 'legacy-flat-write' }
    assert.strictEqual(validateTaskCheckpointEpochSet(protocolTamper).errors.includes('set-noncanonical'), true)
    expectCode('CHECKPOINT_EPOCH_MULTIPLE_CURRENT', () => sealTaskCheckpointEpochSet({
      ...activated.epochSet,
      epochs: activated.epochSet.epochs.map(item => sealTaskCheckpointEpoch({
        ...item,
        status: 'current',
        activatedAt: item.activatedAt || new Date(nowMs).toISOString(),
        supersededAt: null
      })),
      currentEpochId: activated.epochSet.epochs[0].epochId
    }))
    expectCode('CHECKPOINT_PHASE_HISTORY_EXCEEDED', () => sealCheckpointPhaseSlot({
      phase: 'CP2',
      state: 'unstarted',
      history: Array.from({ length: 9 }, () => binding('CP2', 'history')),
      slotSequence: 9
    }))

    const second = sealTaskCheckpointEpoch({
      ...activated.epochSet.epochs[1],
      status: 'superseded',
      supersededAt: new Date(nowMs + 3_000).toISOString()
    })
    const third = epoch({ ordinal: 3, stage: 'stage-c', status: 'superseded', parentEpochId: second.epochId })
    const fourth = epoch({ ordinal: 4, stage: 'stage-d', status: 'current', parentEpochId: third.epochId })
    const multiSet = sealTaskCheckpointEpochSet({
      ...activated.epochSet,
      currentEpochId: fourth.epochId,
      nextOrdinal: 5,
      epochs: [first, second, third, fourth]
    })
    const hot = compactLifecycleStateV5({ version: 5, taskCheckpointEpochSet: multiSet })
    assert.strictEqual(hot.state.taskCheckpointEpochSet.epochs.length, 4)
    const coldSet = compactTaskCheckpointEpochSet(multiSet, { cold: true })
    assert.deepStrictEqual(coldSet.epochs.map(item => item.epochId), [third.epochId, fourth.epochId])
    assert.deepStrictEqual(coldSet.archiveRefs.map(item => item.epochId), [first.epochId, second.epochId])
    const cold = buildColdResumeStub({ version: 5, taskCheckpointEpochSet: multiSet })
    assert(cold.bytes <= COLD_STUB_MAX_BYTES)
    assert.strictEqual(cold.state.taskCheckpointEpochSet.currentEpochId, fourth.epochId)
    assert.strictEqual(cold.state.taskCheckpointEpochSet.epochs.length, 2)

    const metaDir = path.join(tempRoot, 'meta')
    const identity = { activeRoot, project: 'devcodex', taskId, taskStatus: 'active' }
    const preparedCommit = commitTaskRecoveryState({
      metaDir,
      identity,
      state: {
        version: 5,
        activeProject: 'devcodex',
        taskCheckpointEpochSet: prepared.epochSet,
        checkpointEpochBootstrapAuthority: authority
      }
    }, { nowMs, softBytes: 16 * 1024 * 1024, hardBytes: 32 * 1024 * 1024, reserveBytes: 1024 })
    assert.strictEqual(preparedCommit.status, 'committed')
    assert.strictEqual(preparedCommit.sequence, 1)
    assert.strictEqual(preparedCommit.state.taskCheckpointEpochSet.stateSequence, 1)
    let readback = readTaskRecoveryState({ metaDir, identity })
    assert.strictEqual(readback.status, 'fresh')
    assert.strictEqual(readback.state.taskCheckpointEpochSet.stateSequence, readback.envelope.sequence)

    const storedActivation = activateTaskCheckpointEpochBootstrap({
      epochSet: readback.state.taskCheckpointEpochSet,
      authority: readback.state.checkpointEpochBootstrapAuthority,
      observedEvidence: bootstrapEvidence()
    }, { nowMs: nowMs + 1_000 })
    const activationCommit = commitTaskRecoveryState({
      metaDir,
      identity,
      state: {
        ...readback.state,
        taskCheckpointEpochSet: storedActivation.epochSet,
        checkpointEpochBootstrapAuthority: storedActivation.authority
      }
    }, {
      expectedCommitFence: readback.commitFence,
      nowMs: nowMs + 1_000,
      softBytes: 16 * 1024 * 1024,
      hardBytes: 32 * 1024 * 1024,
      reserveBytes: 1024
    })
    assert.strictEqual(activationCommit.status, 'committed')
    assert.strictEqual(activationCommit.sequence, 2)
    assert.strictEqual(activationCommit.state.taskCheckpointEpochSet.stateSequence, 2)
    readback = readTaskRecoveryState({ metaDir, identity })
    assert.strictEqual(readback.state.taskCheckpointEpochSet.currentEpochId, storedActivation.epochSet.currentEpochId)

    const beforeDropSequence = readback.envelope.sequence
    const dropped = commitTaskRecoveryState({
      metaDir,
      identity,
      state: { version: 5, activeProject: 'devcodex' }
    }, {
      expectedCommitFence: readback.commitFence,
      nowMs: nowMs + 2_000,
      softBytes: 16 * 1024 * 1024,
      hardBytes: 32 * 1024 * 1024,
      reserveBytes: 1024
    })
    assert.strictEqual(dropped.errorCode, 'EPOCH_WRITER_CAPABILITY_REQUIRED')
    assert.strictEqual(readTaskRecoveryState({ metaDir, identity }).envelope.sequence, beforeDropSequence)

    const invalidState = JSON.parse(JSON.stringify(readback.state))
    invalidState.taskCheckpointEpochSet.setDigest = '0'.repeat(64)
    const invalidCommit = commitTaskRecoveryState({ metaDir, identity, state: invalidState }, {
      expectedCommitFence: readback.commitFence,
      nowMs: nowMs + 3_000,
      softBytes: 16 * 1024 * 1024,
      hardBytes: 32 * 1024 * 1024,
      reserveBytes: 1024
    })
    assert.strictEqual(invalidCommit.errorCode, 'CHECKPOINT_EPOCH_STATE_INVALID')
    assert.strictEqual(readTaskRecoveryState({ metaDir, identity }).envelope.sequence, beforeDropSequence)

    const legacyTaskId = '10000000-0000-4000-8000-000000000002'
    const legacyIdentity = { activeRoot, project: 'devcodex', taskId: legacyTaskId, taskStatus: 'active' }
    const legacyCommit = commitTaskRecoveryState({
      metaDir,
      identity: legacyIdentity,
      state: { version: 5, activeProject: 'devcodex', phase: 'CP1' }
    }, { nowMs, softBytes: 16 * 1024 * 1024, hardBytes: 32 * 1024 * 1024, reserveBytes: 1024 })
    assert.strictEqual(legacyCommit.status, 'committed')
    assert.strictEqual(readTaskRecoveryState({ metaDir, identity: legacyIdentity }).state.taskCheckpointEpochSet, undefined)

    process.stdout.write('Task checkpoint epoch V1 schema, bootstrap, transition, retention, and V5 fence checks passed\n')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

run()
