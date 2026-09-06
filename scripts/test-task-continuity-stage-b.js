#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')

const {
  activateTaskCheckpointEpochBootstrap,
  activateTaskCheckpointEpochSuccessor,
  checkpointEpochProjectionDigest,
  closeCurrentTaskCheckpointEpoch,
  confirmTaskCheckpointPhase,
  prepareTaskCheckpointEpochBootstrap,
  prepareTaskCheckpointEpochSuccessor,
  sealCheckpointEpochBootstrapAuthority,
  sealCheckpointPhaseBinding,
  validateTaskCheckpointEpochSet
} = require('../hooks/_runtime/task-checkpoint-epoch-v1.cjs')
const {
  advanceCheckpointEpochOperation,
  createCheckpointEpochOperation,
  createCheckpointEpochReceipt,
  finalizeTaskCheckpointProjection,
  parseCurrentEpochMarker,
  renderTaskCheckpointProjection,
  validateCheckpointEpochOperation
} = require('../hooks/_runtime/task-checkpoint-projection-v1.cjs')
const {
  TASK_CONTINUITY_CANDIDATE_MAX,
  TASK_CONTINUITY_VIEW_MAX_BYTES,
  buildTaskContinuityView,
  renderTaskContinuityViewHuman,
  validateTaskContinuityView
} = require('../hooks/_runtime/task-continuity-view-v1.cjs')
const { parseCpSessions } = require('./lib/cp-digest.js')
const { clearReopenedTaskActiveAuthorities } = require('../hooks/_runtime/task-recovery-store-v5.cjs')

const NOW_MS = Date.parse('2026-09-06T00:00:00.000Z')
const TASK_ID = '11111111-2222-4333-8444-555555555555'
const PROJECT = 'stage-b-test'

const reopenedAuthorityFixture = clearReopenedTaskActiveAuthorities({
  workflowTaskTerminalReceipt: { receiptDigest: digestPlaceholder('terminal') },
  taskTerminalLineage: { terminalStatus: 'completed' },
  taskScopedAutoContinuationGrant: { grantDigest: digestPlaceholder('auto') },
  autoCheckpointDecision: { decisionDigest: digestPlaceholder('decision') },
  validationControlIngress: { authorityDigest: digestPlaceholder('control') },
  validationExecution: { authorityDigest: digestPlaceholder('validation') },
  stableTaskIdentity: { taskId: TASK_ID }
})
assert.deepStrictEqual(Object.keys(reopenedAuthorityFixture), ['stableTaskIdentity'])

function digestPlaceholder(label) {
  return crypto.createHash('sha256').update(label).digest('hex')
}

function digest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function binding(phase, suffix, mode = 'explicit') {
  return sealCheckpointPhaseBinding({
    phase,
    artifactPath: phase === 'CP1'
      ? `01-${suffix}.md`
      : (phase === 'CP2' ? `02-${suffix}.md` : `04-${suffix}.md`),
    artifactSha256: digest(`${phase}:${suffix}`),
    artifactVersion: `v-${suffix}`,
    templateQualificationDigest: digest(`template:${phase}:${suffix}`),
    confirmationSourceDigest: digest(`source:${phase}:${suffix}`),
    confirmedAt: new Date(NOW_MS + suffix.length * 1000).toISOString(),
    confirmationMode: mode
  })
}

const runtime = {
  stateSchemaVersion: 'TaskRecoveryStateV5',
  packageVersion: '1.19.5',
  mcpProtocolVersion: '2024-11-05',
  sourceHead: 'stage-b-source-test',
  epochCapability: 1
}
const task = {
  taskId: TASK_ID,
  taskKind: 'requirements',
  project: PROJECT,
  activeRootDigest: 'a'.repeat(64)
}
const owner = {
  ownerGeneration: 3,
  leaseRevision: 4,
  leaseDigest: 'b'.repeat(64)
}
const lineage = {
  canonicalRevision: 2,
  canonicalHeadDigest: 'c'.repeat(64),
  canonicalParentRevision: 1,
  scopeDigest: 'd'.repeat(64)
}
const context = {
  contextEpoch: 'ctx-stage-b-test',
  planContentId: 'plan-content-stage-b-test',
  autoGrantDigest: null,
  autoDecisionDigest: null,
  validationAuthorityDigest: null
}

const cp1a = binding('CP1', 'stage-a')
const authority = sealCheckpointEpochBootstrapAuthority({
  task,
  target: { stageKey: 'stage-a', expectedOrdinal: 1, parentEpochId: null },
  evidence: [cp1a],
  runtime,
  fence: { expectedStateSequence: 7, expectedWriterGeneration: 3, expectedOwnerGeneration: 3 },
  createdBy: 'workflow-single-writer',
  createdAt: new Date(NOW_MS).toISOString(),
  expiresAt: new Date(NOW_MS + 24 * 60 * 60 * 1000).toISOString()
}, { nowMs: NOW_MS })

const prepared = prepareTaskCheckpointEpochBootstrap({
  authority,
  targetBinding: { admissionId: 'admission-stage-b-test', owner, lineage, context },
  legacyProjectionDigest: digest('legacy-sessions')
}, { nowMs: NOW_MS })
assert.strictEqual(prepared.epochSet.currentEpochId, null)
assert.strictEqual(prepared.epochSet.epochs[0].status, 'preparing')

let epochSet = activateTaskCheckpointEpochBootstrap({
  epochSet: prepared.epochSet,
  authority,
  observedEvidence: [cp1a]
}, { nowMs: NOW_MS + 1000 }).epochSet
assert.strictEqual(validateTaskCheckpointEpochSet(epochSet).valid, true)
assert.strictEqual(epochSet.epochs.filter(item => item.status === 'current').length, 1)

const cp2a = binding('CP2', 'stage-a')
epochSet = confirmTaskCheckpointPhase({ epochSet, phase: 'CP2', binding: cp2a }).epochSet
assert.throws(
  () => confirmTaskCheckpointPhase({
    epochSet: activateTaskCheckpointEpochBootstrap({
      epochSet: prepared.epochSet,
      authority,
      observedEvidence: [cp1a]
    }, { nowMs: NOW_MS + 1000 }).epochSet,
    phase: 'CP3',
    binding: binding('CP3', 'invalid-without-cp2')
  }),
  error => error.code === 'CHECKPOINT_EPOCH_CP_PREDECESSOR_MISSING'
)
const cp3a = binding('CP3', 'stage-a')
epochSet = confirmTaskCheckpointPhase({ epochSet, phase: 'CP3', binding: cp3a }).epochSet
assert.strictEqual(epochSet.epochs[0].phases.CP3.state, 'confirmed')

const projectedA = renderTaskCheckpointProjection('', epochSet, {
  requirement: 'Stage B test',
  sourceMessagesByArtifactDigest: {
    [cp1a.artifactSha256]: '确认 Stage A CP1',
    [cp2a.artifactSha256]: '确认 Stage A CP2',
    [cp3a.artifactSha256]: '确认 Stage A CP3'
  }
})
const markerA = parseCurrentEpochMarker(projectedA.content)
assert.strictEqual(markerA.found, true)
assert.strictEqual(markerA.epochId, epochSet.currentEpochId)
assert.strictEqual(markerA.projectionDigest, checkpointEpochProjectionDigest(epochSet))
const parsedA = parseCpSessions(projectedA.content)
assert.strictEqual(parsedA.CP3.confirmed, true)
assert.strictEqual(parsedA.currentEpochId, epochSet.currentEpochId)

const cp2Revision = binding('CP2', 'stage-a-r2')
epochSet = confirmTaskCheckpointPhase({ epochSet, phase: 'CP2', binding: cp2Revision }).epochSet
const currentAfterRevision = epochSet.epochs.find(item => item.epochId === epochSet.currentEpochId)
assert.strictEqual(currentAfterRevision.phases.CP2.currentBinding.bindingDigest, cp2Revision.bindingDigest)
assert.strictEqual(currentAfterRevision.phases.CP3.state, 'unstarted')
assert.strictEqual(currentAfterRevision.phases.CP3.currentBinding, null)
assert.strictEqual(currentAfterRevision.phases.CP3.history.at(-1).bindingDigest, cp3a.bindingDigest)

const cp1b = binding('CP1', 'stage-b')
const successor = prepareTaskCheckpointEpochSuccessor({
  epochSet,
  stageKey: 'stage-b',
  cp1Binding: cp1b,
  authority: { admissionId: 'admission-stage-b-test', owner, lineage, context },
  runtime
}, { nowMs: NOW_MS + 2000 })
assert.strictEqual(successor.epoch.status, 'preparing')
epochSet = activateTaskCheckpointEpochSuccessor({
  epochSet: successor.epochSet,
  epochId: successor.epoch.epochId
}, { nowMs: NOW_MS + 3000 }).epochSet
assert.strictEqual(epochSet.epochs.find(item => item.ordinal === 1).status, 'superseded')
assert.strictEqual(epochSet.epochs.find(item => item.ordinal === 2).status, 'current')
assert.strictEqual(epochSet.epochs.find(item => item.ordinal === 2).phases.CP2.state, 'unstarted')

const projectedB = renderTaskCheckpointProjection(projectedA.content, epochSet, {
  requirement: 'Stage B test',
  sourceMessagesByArtifactDigest: { [cp1b.artifactSha256]: '确认 Stage B CP1' }
})
const parsedB = parseCpSessions(projectedB.content)
assert.strictEqual(parsedB.CP1.artifactSha256, cp1b.artifactSha256.toUpperCase())
assert.strictEqual(parsedB.CP2.confirmed, false)
assert.strictEqual(parsedB.CP3.confirmed, false)
assert.match(projectedB.content, /CP 历史代际（只读审计）/u)
assert.strictEqual((projectedB.content.match(/^\|\s*CP[123]\s*\|/gmu) || []).length, 3)

const cp2b = binding('CP2', 'stage-b')
const operationPrepared = createCheckpointEpochOperation({
  taskId: TASK_ID,
  phase: 'CP2',
  stageKey: 'stage-b',
  bindingDigest: cp2b.bindingDigest,
  expectedStateSequence: 11,
  expectedWriterGeneration: owner.ownerGeneration,
  expectedOwnerLeaseDigest: owner.leaseDigest,
  confirmationMode: 'explicit'
}, { nowMs: NOW_MS + 4000 })
assert.strictEqual(validateCheckpointEpochOperation(operationPrepared).valid, true)
epochSet = confirmTaskCheckpointPhase({ epochSet, phase: 'CP2', binding: cp2b }).epochSet
const operationMachine = advanceCheckpointEpochOperation(operationPrepared, 'machine-committed', {
  epochId: epochSet.currentEpochId,
  desiredProjectionDigest: checkpointEpochProjectionDigest(epochSet)
}, { nowMs: NOW_MS + 5000 })
const projectedForReceipt = renderTaskCheckpointProjection(projectedB.content, epochSet, {
  requirement: 'Stage B test',
  sourceMessagesByArtifactDigest: { [cp2b.artifactSha256]: '确认 Stage B CP2' }
})
const observedDigest = digest(projectedForReceipt.content)
epochSet = finalizeTaskCheckpointProjection(epochSet, observedDigest)
const operationProjected = advanceCheckpointEpochOperation(operationMachine, 'projection-committed', {
  observedProjectionDigest: observedDigest
}, { nowMs: NOW_MS + 6000 })
const operationComplete = advanceCheckpointEpochOperation(operationProjected, 'complete', {}, { nowMs: NOW_MS + 7000 })
const receipt = createCheckpointEpochReceipt({ operation: operationComplete, epochSet })
const replayReceipt = createCheckpointEpochReceipt({ operation: operationComplete, epochSet: { ...epochSet, stateSequence: 99 } })
assert.strictEqual(receipt.receiptDigest, replayReceipt.receiptDigest, 'unrelated recovery CAS must not change an idempotent CP receipt')

const transaction = {
  taskId: TASK_ID,
  taskKind: 'requirements',
  project: PROJECT,
  projectRootIdentityDigest: task.activeRootDigest,
  admissionId: 'admission-stage-b-test',
  workItemDigest: lineage.scopeDigest
}
const canonical = {
  taskId: TASK_ID,
  revision: lineage.canonicalRevision,
  currentOverviewDigest: lineage.canonicalHeadDigest
}
const state = {
  admissionTransaction: transaction,
  fencedWriteOwner: {
    ...owner,
    taskId: TASK_ID,
    projectRootIdentity: task.activeRootDigest,
    contextEpoch: context.contextEpoch,
    status: 'active',
    expiresAt: new Date(NOW_MS + 60_000).toISOString()
  },
  taskCanonicalRevision: canonical,
  contextAcquisition: { planContentId: context.planContentId },
  taskCheckpointEpochSet: epochSet
}
const resolution = {
  status: 'resolved-active',
  candidate: {
    taskId: TASK_ID,
    displayName: 'Stage B 连续性任务',
    project: PROJECT,
    kind: 'requirements',
    relativeTaskPath: 'requirements/stage-b'
  },
  scan: { bytes: 1024 }
}
const readyView = buildTaskContinuityView({
  resolution,
  recoveryRead: { status: 'fresh', state, envelope: { sequence: 99 } },
  projectionMarker: parseCurrentEpochMarker(projectedForReceipt.content),
  project: PROJECT
}, { nowMs: NOW_MS + 10_000 })
assert.strictEqual(validateTaskContinuityView(readyView).valid, true)
assert.strictEqual(readyView.status, 'ready')
assert.strictEqual(readyView.preferredAction, 'mutate-scoped')
assert.match(renderTaskContinuityViewHuman(readyView, { locale: 'zh-CN' }), /已安全恢复/u)
assert(Buffer.byteLength(JSON.stringify(readyView), 'utf8') <= TASK_CONTINUITY_VIEW_MAX_BYTES)

const invalidOwnerExpiryView = buildTaskContinuityView({
  resolution,
  recoveryRead: {
    status: 'fresh',
    state: { ...state, fencedWriteOwner: { ...state.fencedWriteOwner, expiresAt: 'invalid-time' } },
    envelope: { sequence: 99 }
  },
  projectionMarker: parseCurrentEpochMarker(projectedForReceipt.content),
  project: PROJECT
}, { nowMs: NOW_MS + 10_000 })
assert.strictEqual(invalidOwnerExpiryView.writer.status, 'conflict')
assert(!invalidOwnerExpiryView.actions.includes('mutate-scoped'))

const mismatchedResolutionView = buildTaskContinuityView({
  resolution: {
    ...resolution,
    candidate: { ...resolution.candidate, taskId: '99999999-2222-4333-8444-555555555555' }
  },
  recoveryRead: { status: 'fresh', state, envelope: { sequence: 99 } },
  projectionMarker: parseCurrentEpochMarker(projectedForReceipt.content),
  project: PROJECT
}, { nowMs: NOW_MS + 10_000 })
assert(mismatchedResolutionView.degradations.some(item => item.code === 'TASK_CONTINUITY_IDENTITY_MISMATCH'))
assert(!mismatchedResolutionView.actions.includes('mutate-scoped'))

const manyCandidates = Array.from({ length: 20 }, (_, index) => ({
  taskId: `${String(index).padStart(8, '0')}-2222-4333-8444-555555555555`,
  displayName: `候选-${index}`,
  project: PROJECT,
  kind: 'requirements',
  relativeTaskPath: `requirements/candidate-${index}`
}))
const ambiguousResolution = { status: 'ambiguous', candidates: manyCandidates, scan: { bytes: 2048 } }
const firstAmbiguousView = buildTaskContinuityView({
  resolution: ambiguousResolution,
  recoveryRead: { status: 'missing', errorCode: 'TASK_RECOVERY_STATE_UNAVAILABLE' },
  project: PROJECT
}, { nowMs: NOW_MS + 11_000 })
const ambiguousView = buildTaskContinuityView({
  resolution: ambiguousResolution,
  recoveryRead: { status: 'missing', errorCode: 'TASK_RECOVERY_STATE_UNAVAILABLE' },
  project: PROJECT,
  priorDisambiguationReceiptDigest: firstAmbiguousView.disambiguation.receiptDigest
}, { nowMs: NOW_MS + 11_000 })
assert.strictEqual(ambiguousView.candidates.length, TASK_CONTINUITY_CANDIDATE_MAX)
assert.strictEqual(ambiguousView.disambiguation.alreadyPresented, true)
assert(!ambiguousView.actions.includes('disambiguate-once'))
assert.match(renderTaskContinuityViewHuman(ambiguousView, { locale: 'zh-CN' }), /分析继续/u)

epochSet = closeCurrentTaskCheckpointEpoch({
  epochSet,
  terminalStatus: 'completed'
}, { nowMs: NOW_MS + 12_000 }).epochSet
const terminalProjected = renderTaskCheckpointProjection(projectedForReceipt.content, epochSet, { requirement: 'Stage B test' })
epochSet = finalizeTaskCheckpointProjection(epochSet, digest(terminalProjected.content))
const terminalView = buildTaskContinuityView({
  resolution,
  recoveryRead: { status: 'fresh', state: { ...state, taskCheckpointEpochSet: epochSet }, envelope: { sequence: 100 } },
  projectionMarker: parseCurrentEpochMarker(terminalProjected.content),
  project: PROJECT
}, { nowMs: NOW_MS + 13_000 })
assert.strictEqual(terminalView.status, 'terminal')
assert.strictEqual(terminalView.preferredAction, 'reopen-task')

console.log('Stage B task checkpoint saga, current-only projection, continuity view, bounds, idempotency, and terminal tests passed')
