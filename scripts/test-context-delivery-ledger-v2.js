'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  getContextDeliveryDecision,
  observeContextDeliveryFromPayload
} = require('../hooks/_runtime/context-delivery-ledger-v2.cjs')
const {
  commitTaskRecoveryState,
  readTaskRecoveryState,
  resolveTaskRecoveryMetaDir
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-context-delivery-v2-'))
const activeRoot = path.join(tempRoot, '.devcodex', 'devcodex')
const metaDir = path.join(activeRoot, '.memory', 'hooks', 'devcodex')
const taskId = '20000000-0000-4000-8000-000000000001'
const sessionKey = 'conversation-a'
const contextEpoch = 'ctx-delivery-test'
const profileBody = 'bounded profile body for delivery evidence'
const identity = { activeRoot, project: 'devcodex', taskId, taskStatus: 'active' }
const storeOptions = {
  reserveBytes: 8 * 1024,
  softBytes: 16 * 1024 * 1024,
  hardBytes: 32 * 1024 * 1024,
  nowMs: Date.parse('2026-08-22T00:00:00Z')
}

function baseState() {
  return {
    version: 2,
    mode: 'fix',
    phase: 'implementation',
    activeProject: 'devcodex',
    activeScope: 'project',
    taskRecoveryBinding: {
      schemaVersion: 'TaskRecoveryBindingV1',
      taskId,
      displayName: 'delivery-test',
      project: 'devcodex',
      kind: 'bugs',
      taskRoot: path.join(activeRoot, 'bugs', 'delivery-test'),
      status: 'active',
      identityRevision: 1,
      boundAt: '2026-08-22T00:00:00Z'
    },
    contextAcquisition: {
      schemaVersion: 'ContextReadStateV2',
      contextEpoch,
      activeRoot,
      project: 'devcodex',
      targetResolved: true,
      hostSessionId: sessionKey,
      plan: null,
      receipt: null,
      inFlight: [],
      postHistory: []
    },
    contextDeliveryReceipts: [],
    turnLiveness: {
      schemaVersion: 1,
      state: 'active-turn',
      turnKey: sessionKey,
      checkpoint: { phase: '', artifactPaths: [] },
      inFlightOperation: null
    }
  }
}

function decision(overrides = {}) {
  return getContextDeliveryDecision({
    metaDir,
    activeRoot,
    project: 'devcodex',
    conversationId: sessionKey,
    contextEpoch,
    sourceKey: 'profile-load:plan-content-test',
    sourceDigest: 'a'.repeat(64),
    bodyCarrier: 'profile-load-text-v1',
    bodyIdentity: profileBody,
    bodyBytes: Buffer.byteLength(profileBody, 'utf8'),
    ...overrides
  }, storeOptions)
}

function profileResponseBytes(body, deliveryDecision) {
  const meta = {
    bodyDeliverySkipped: deliveryDecision.bodyDeliverySkipped === true,
    bodyDelivered: deliveryDecision.bodyDeliverySkipped !== true,
    contextDelivery: {
      schemaVersion: deliveryDecision.schemaVersion,
      status: deliveryDecision.status,
      reasonCode: deliveryDecision.reasonCode,
      bodyDeliverySkipped: deliveryDecision.bodyDeliverySkipped === true,
      observedAt: deliveryDecision.observedAt || null,
      deliveredBodyBytes: deliveryDecision.deliveredBodyBytes ?? Buffer.byteLength(body, 'utf8'),
      deduplicatedBodyBytes: deliveryDecision.deduplicatedBodyBytes || 0,
      tokenEquivalentEstimate: deliveryDecision.tokenEquivalentEstimate || null
    }
  }
  const deliveredText = deliveryDecision.bodyDeliverySkipped === true
    ? [
        'ContextDeliveryReuseV2: the identical Profile body was already observed for this formal task, conversation, context epoch, and source identity.',
        `sourceDigest=${deliveryDecision.descriptor.sourceDigest}`,
        'The body is omitted from this tool result. If any identity or source evidence changes, profile_load returns the full bounded body again.'
      ].join('\n')
    : body
  return Buffer.byteLength(JSON.stringify({
    content: [{
      type: 'text',
      text: `<!-- profile_load_budget ${JSON.stringify(meta)} -->\n\n${deliveredText}`
    }],
    _meta: {
      devcodexContextDelivery: deliveryDecision.descriptor,
      bodyDeliverySkipped: deliveryDecision.bodyDeliverySkipped === true,
      contextDeliveryStatus: deliveryDecision.status
    }
  }), 'utf8')
}

try {
  assert.strictEqual(typeof resolveTaskRecoveryMetaDir, 'function')
  const legacyActiveRoot = path.join(tempRoot, 'legacy-project', '.devcodex')
  const legacyMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: legacyActiveRoot,
    project: 'legacy-project',
    workspaceNamespace: false
  })
  assert.strictEqual(
    legacyMetaDir,
    path.join(legacyActiveRoot, '.memory', 'hooks', 'legacy'),
    'legacy TaskRecovery must share the lifecycle hooks/legacy truth partition'
  )
  assert.strictEqual(resolveTaskRecoveryMetaDir({
    activeRoot,
    project: 'devcodex',
    workspaceNamespace: true
  }), metaDir)
  assert.strictEqual(resolveTaskRecoveryMetaDir({
    activeRoot: path.join(tempRoot, '.devcodex', 'workspace'),
    project: '__workspace__',
    workspaceNamespace: true
  }), path.join(tempRoot, '.devcodex', 'workspace', '.memory', 'hooks', 'workspace'))

  const firstCommit = commitTaskRecoveryState({
    metaDir,
    identity,
    sessionKey,
    state: baseState()
  }, storeOptions)
  assert.strictEqual(firstCommit.status, 'committed')

  const first = decision()
  assert.strictEqual(first.bodyDeliverySkipped, false)
  assert.strictEqual(first.reasonCode, 'delivery-receipt-missing')
  assert(first.descriptor)

  const loaded = readTaskRecoveryState({ metaDir, identity }, storeOptions)
  assert.strictEqual(loaded.status, 'fresh')
  const observedState = JSON.parse(JSON.stringify(loaded.state))
  const descriptorOnly = observeContextDeliveryFromPayload(observedState, {
    session_id: sessionKey,
    tool_response: { _meta: { devcodexContextDelivery: first.descriptor } }
  }, storeOptions)
  assert.strictEqual(descriptorOnly.status, 'rejected')
  assert.strictEqual(descriptorOnly.reasonCode, 'delivery-observation-body-unverified')
  assert.strictEqual(observedState.contextDeliveryReceipts.length, 0)
  const observation = observeContextDeliveryFromPayload(observedState, {
    session_id: sessionKey,
    tool_response: {
      content: [{
        type: 'text',
        text: `<!-- profile_load_budget {} -->\n\n${profileBody}`
      }],
      _meta: { devcodexContextDelivery: first.descriptor }
    }
  }, storeOptions)
  assert.strictEqual(observation.status, 'observed')
  const observationCommit = commitTaskRecoveryState({
    metaDir,
    identity,
    sessionKey,
    state: observedState
  }, { ...storeOptions, force: true, reason: 'context-observation' })
  assert.strictEqual(observationCommit.status, 'committed')

  const repeated = decision()
  assert.strictEqual(repeated.bodyDeliverySkipped, true)
  assert.strictEqual(repeated.reasonCode, 'delivery-receipt-observed')
  assert.strictEqual(repeated.descriptor.deliveryLeaseId, first.descriptor.deliveryLeaseId)
  assert.strictEqual(repeated.deliveredBodyBytes, 0)
  assert.strictEqual(repeated.deduplicatedBodyBytes, Buffer.byteLength(profileBody, 'utf8'))
  assert.strictEqual(repeated.tokenEquivalentEstimate.actualHostTokens, null)
  assert.strictEqual(repeated.tokenEquivalentEstimate.status, 'UNVERIFIED')

  const benchmarkBody = 'P'.repeat(402848)
  const benchmarkInput = {
    metaDir,
    activeRoot,
    project: 'devcodex',
    conversationId: sessionKey,
    contextEpoch,
    sourceKey: 'profile-load:benchmark-plan-content',
    sourceDigest: 'd'.repeat(64),
    bodyCarrier: 'profile-load-text-v1',
    bodyIdentity: benchmarkBody,
    bodyBytes: Buffer.byteLength(benchmarkBody, 'utf8')
  }
  const benchmarkBaseline = getContextDeliveryDecision(benchmarkInput, storeOptions)
  assert.strictEqual(benchmarkBaseline.bodyDeliverySkipped, false)
  const benchmarkState = readTaskRecoveryState({ metaDir, identity }, storeOptions).state
  const benchmarkObservation = observeContextDeliveryFromPayload(benchmarkState, {
    session_id: sessionKey,
    tool_response: {
      content: [{
        type: 'text',
        text: `<!-- profile_load_budget {} -->\n\n${benchmarkBody}`
      }],
      _meta: { devcodexContextDelivery: benchmarkBaseline.descriptor }
    }
  }, storeOptions)
  assert.strictEqual(benchmarkObservation.status, 'observed')
  assert.strictEqual(commitTaskRecoveryState({
    metaDir,
    identity,
    sessionKey,
    state: benchmarkState
  }, { ...storeOptions, force: true, reason: 'context-delivery-benchmark-observation' }).status, 'committed')
  const benchmarkCandidates = Array.from({ length: 3 }, () => (
    getContextDeliveryDecision(benchmarkInput, storeOptions)
  ))
  const benchmarkBaselineSerializedBytes = profileResponseBytes(benchmarkBody, benchmarkBaseline)
  const benchmarkCandidateMetrics = benchmarkCandidates.map(candidate => {
    const serializedBytes = profileResponseBytes(benchmarkBody, candidate)
    const bodyReductionRatio = 1 - (candidate.deliveredBodyBytes / benchmarkInput.bodyBytes)
    const serializedReductionRatio = 1 - (serializedBytes / benchmarkBaselineSerializedBytes)
    assert.strictEqual(candidate.bodyDeliverySkipped, true)
    assert(bodyReductionRatio >= 0.8)
    assert(serializedReductionRatio >= 0.6)
    assert.strictEqual(candidate.tokenEquivalentEstimate.actualHostTokens, null)
    assert.strictEqual(candidate.tokenEquivalentEstimate.status, 'UNVERIFIED')
    return {
      deliveredBodyBytes: candidate.deliveredBodyBytes,
      deduplicatedBodyBytes: candidate.deduplicatedBodyBytes,
      serializedBytes,
      bodyReductionRatio,
      serializedReductionRatio,
      tokenEquivalentEstimate: candidate.tokenEquivalentEstimate
    }
  })

  assert.strictEqual(decision({ conversationId: 'conversation-b' }).bodyDeliverySkipped, false)
  assert.strictEqual(decision({ contextEpoch: 'ctx-after-compact' }).bodyDeliverySkipped, false)
  assert.strictEqual(decision({ sourceDigest: 'b'.repeat(64) }).bodyDeliverySkipped, false)
  const byteDrift = decision({ bodyBytes: Buffer.byteLength(profileBody, 'utf8') + 1 })
  assert.strictEqual(byteDrift.bodyDeliverySkipped, false)
  assert.notStrictEqual(byteDrift.descriptor.deliveryLeaseId, repeated.descriptor.deliveryLeaseId)

  const cleared = readTaskRecoveryState({ metaDir, identity }, storeOptions).state
  cleared.contextDeliveryReceipts = []
  assert.strictEqual(commitTaskRecoveryState({
    metaDir,
    identity,
    sessionKey,
    state: cleared
  }, { ...storeOptions, force: true, reason: 'pre-compact' }).status, 'committed')
  assert.strictEqual(decision().bodyDeliverySkipped, false)
  const benchmarkRollback = getContextDeliveryDecision(benchmarkInput, storeOptions)
  assert.strictEqual(benchmarkRollback.bodyDeliverySkipped, false)
  assert.strictEqual(benchmarkRollback.deliveredBodyBytes, benchmarkInput.bodyBytes)

  const ephemeralMeta = path.join(tempRoot, 'ephemeral-hooks')
  assert.strictEqual(getContextDeliveryDecision({
    metaDir: ephemeralMeta,
    activeRoot,
    project: 'devcodex',
    conversationId: 'ephemeral',
    contextEpoch,
    sourceKey: 'profile-load:plan-content-test',
    sourceDigest: 'a'.repeat(64),
    bodyCarrier: 'profile-load-text-v1',
    bodyIdentity: profileBody,
    bodyBytes: Buffer.byteLength(profileBody, 'utf8')
  }, storeOptions).reasonCode, 'delivery-formal-task-unbound')

  const legacyIdentity = {
    activeRoot: legacyActiveRoot,
    project: 'legacy-project',
    taskId: '20000000-0000-4000-8000-000000000002',
    taskStatus: 'active'
  }
  const legacyState = baseState()
  legacyState.activeProject = 'legacy-project'
  legacyState.taskRecoveryBinding = {
    ...legacyState.taskRecoveryBinding,
    taskId: legacyIdentity.taskId,
    project: legacyIdentity.project
  }
  legacyState.contextAcquisition = {
    ...legacyState.contextAcquisition,
    activeRoot: legacyActiveRoot,
    project: legacyIdentity.project,
    hostSessionId: 'legacy-conversation'
  }
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: legacyMetaDir,
    identity: legacyIdentity,
    sessionKey: 'legacy-conversation',
    state: legacyState
  }, storeOptions).status, 'committed')
  const legacyDecision = getContextDeliveryDecision({
    metaDir: legacyMetaDir,
    activeRoot: legacyActiveRoot,
    project: legacyIdentity.project,
    conversationId: 'legacy-conversation',
    contextEpoch,
    sourceKey: 'profile-load:legacy-plan',
    sourceDigest: 'c'.repeat(64),
    bodyCarrier: 'profile-load-text-v1',
    bodyIdentity: profileBody,
    bodyBytes: Buffer.byteLength(profileBody, 'utf8')
  }, storeOptions)
  assert.strictEqual(legacyDecision.reasonCode, 'delivery-receipt-missing')
  assert.strictEqual(legacyDecision.descriptor.taskId, legacyIdentity.taskId)

  console.log(JSON.stringify({
    schemaVersion: 'ContextDeliveryLedgerV2TestReceipt',
    passed: true,
    firstDeliverySkipped: first.bodyDeliverySkipped,
    repeatDeliverySkipped: repeated.bodyDeliverySkipped,
    failSafeCases: 7,
    performanceAcceptance: {
      baseline: {
        deliveredBodyBytes: benchmarkBaseline.deliveredBodyBytes,
        serializedBytes: benchmarkBaselineSerializedBytes
      },
      candidates: benchmarkCandidateMetrics,
      rollback: {
        bodyDeliverySkipped: benchmarkRollback.bodyDeliverySkipped,
        deliveredBodyBytes: benchmarkRollback.deliveredBodyBytes,
        serializedBytes: profileResponseBytes(benchmarkBody, benchmarkRollback)
      },
      modelObservedTokens: null,
      modelObservedTokensStatus: 'UNVERIFIED'
    }
  }))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
