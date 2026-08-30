'use strict'

const crypto = require('crypto')
const { digest } = require('./actual-instruction-envelope.cjs')
const {
  FENCED_TASK_WRITE_OWNER_SCHEMA,
  commitFencedTaskWriteOwnerTransition,
  fencedTaskWriteOwnerDigest,
  readFencedTaskWriteOwner
} = require('./task-recovery-store-v5.cjs')

const WRITE_OWNER_LEASE_MS = 5 * 60 * 1000
const DIGEST_RE = /^[a-f0-9]{64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class FencedTaskWriteOwnerError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'FencedTaskWriteOwnerError'
    this.code = code
    this.details = details
  }
}

function ownerNonce(options = {}) {
  if (typeof options.nonceFactory === 'function') {
    const value = String(options.nonceFactory())
    if (/^owner-[a-f0-9]{40}$/.test(value)) return value
  }
  return `owner-${crypto.randomBytes(20).toString('hex')}`
}

function ownerRef(owner) {
  return owner
    ? {
        ownerGeneration: owner.ownerGeneration,
        ownerNonce: owner.ownerNonce,
        leaseRevision: owner.leaseRevision,
        leaseDigest: owner.leaseDigest
      }
    : { mode: 'absent' }
}

function exactOwnerRefMatches(owner, expected) {
  return !!owner && !!expected &&
    owner.ownerGeneration === expected.ownerGeneration &&
    owner.ownerNonce === expected.ownerNonce &&
    owner.leaseRevision === expected.leaseRevision &&
    owner.leaseDigest === expected.leaseDigest
}

function sealOwner(input) {
  const owner = {
    schemaVersion: FENCED_TASK_WRITE_OWNER_SCHEMA,
    taskId: input.taskId,
    projectRootIdentity: input.projectRootIdentity,
    sessionDigest: input.sessionDigest,
    contextEpoch: input.contextEpoch,
    routeRevision: input.routeRevision,
    ownerGeneration: input.ownerGeneration,
    ownerNonce: input.ownerNonce,
    leaseRevision: input.leaseRevision,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    handoffRef: input.handoffRef || null,
    takeoverRef: input.takeoverRef || null,
    transitionRef: input.transitionRef || null,
    reopenGeneration: input.reopenGeneration,
    revocationEpoch: input.revocationEpoch,
    status: input.status
  }
  owner.leaseDigest = fencedTaskWriteOwnerDigest(owner)
  return owner
}

function ownerTransitionRequestDigest(operation, input) {
  const expectedOwner = input.expectedOwner?.mode === 'absent'
    ? { mode: 'absent' }
    : (input.expectedOwner
        ? {
            ownerGeneration: input.expectedOwner.ownerGeneration,
            ownerNonce: input.expectedOwner.ownerNonce,
            leaseRevision: input.expectedOwner.leaseRevision,
            leaseDigest: input.expectedOwner.leaseDigest
          }
        : { mode: 'absent' })
  const terminalEvidence = Array.isArray(input.evidence)
    ? input.evidence.map(item => ({
        role: String(item?.role || '').trim(),
        path: String(item?.path || '').trim().replace(/\\/g, '/'),
        sha256: String(item?.sha256 || '').trim().toLowerCase(),
        bytes: Number(item?.bytes)
      })).sort((left, right) => left.role.localeCompare(right.role) || left.path.localeCompare(right.path))
    : []
  return digest({
    schemaVersion: 'FencedTaskWriteOwnerTransitionRequestV1',
    operation,
    taskId: input.taskId,
    admissionId: input.admissionId,
    sessionDigest: input.projectTargetLease.authorityDigest,
    contextEpoch: input.actualInstructionEnvelope.contextEpoch,
    routeRevision: input.workflowRouteDecision.routeRevision,
    expectedOwner,
    targetSessionDigest: String(input.targetSessionDigest || '').toLowerCase() || null,
    handoffRefDigest: String(input.handoffRefDigest || '').toLowerCase() || null,
    takeoverRefDigest: String(input.takeoverRefDigest || '').toLowerCase() || null,
    terminalStatus: String(input.terminalStatus || '').trim() || null,
    terminalEvidence
  })
}

function buildOwnerTransitionRef(operation, currentOwner, input, committedAt) {
  const core = {
    schemaVersion: 'FencedTaskWriteOwnerTransitionRefV1',
    operation,
    priorLeaseDigest: currentOwner?.leaseDigest || null,
    requestDigest: ownerTransitionRequestDigest(operation, input),
    committedAt
  }
  return { ...core, refDigest: digest(core) }
}

function ownerTransitionReplayMatches(owner, operation, input) {
  const ref = owner?.transitionRef
  return ref?.operation === operation &&
    ref.requestDigest === ownerTransitionRequestDigest(operation, input) &&
    ref.priorLeaseDigest === (input.expectedOwner?.leaseDigest || null)
}

function lifecycleOwnerReceipt(operation, transaction, owner, replayed, nowMs) {
  const finalized = transaction?.phase === 'finalized'
  const cpConfirmed = transaction?.effects?.cpState?.status === 'confirmed' &&
    transaction?.effects?.cpState?.cp1Confirmed === true
  const active = owner?.status === 'active'
  const expiresAtMs = Date.parse(String(owner?.expiresAt || ''))
  const leaseFreshDiagnostic = Number.isFinite(expiresAtMs) && expiresAtMs > nowMs
  return {
    schemaVersion: 'TaskWriteOwnerTransitionReceiptV1',
    status: owner?.status || 'missing',
    operation,
    taskId: owner?.taskId || transaction?.taskId || null,
    admissionId: transaction?.admissionId || null,
    admissionGeneration: transaction?.admissionGeneration || null,
    continuationLease: transaction?.continuationLease || null,
    owner: owner || null,
    ownerRef: owner ? ownerRef(owner) : null,
    finalized,
    cp1Confirmed: cpConfirmed,
    leaseFreshDiagnostic,
    leaseExpiredDiagnostic: active && !leaseFreshDiagnostic,
    mutationAuthority: finalized && cpConfirmed && active,
    replayed
  }
}

function executeLifecycleTaskWriteOwner(rawInput = {}, options = {}) {
  const fsImpl = options.fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const operation = String(rawInput.operation || '').trim()
  if (!['acquire', 'renew', 'release'].includes(operation)) {
    throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_OPERATION_INVALID', 'lifecycle supports acquire, renew or release only')
  }
  const input = {
    ...rawInput,
    operation,
    taskId: String(rawInput.taskId || '').trim().toLowerCase(),
    admissionId: String(rawInput.admissionId || '').trim()
  }
  const sessionDigest = String(input.projectTargetLease?.authorityDigest || '')
  const projectRootIdentity = String(input.projectTargetLease?.rootIdentityDigest || '')
  const contextEpoch = String(input.actualInstructionEnvelope?.contextEpoch || '')
  const routeRevision = String(input.workflowRouteDecision?.routeRevision || '')
  if (!UUID_RE.test(input.taskId) || !/^admission-[a-f0-9]{40}$/.test(input.admissionId) ||
      !DIGEST_RE.test(sessionDigest) || !DIGEST_RE.test(projectRootIdentity) ||
      !contextEpoch || !DIGEST_RE.test(routeRevision)) {
    throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_INGRESS_INVALID', 'lifecycle owner transition requires exact task, admission, project, session, context and route bindings')
  }
  const ownerRead = readFencedTaskWriteOwner({
    metaDir: input.metaDir,
    identity: input.identity
  }, { fs: fsImpl, nowMs })
  if (ownerRead.status !== 'fresh' || ownerRead.source !== 'primary' || !ownerRead.owner ||
      ownerRead.transaction?.admissionId !== input.admissionId) {
    throw new FencedTaskWriteOwnerError(ownerRead.errorCode || 'TASK_WRITE_OWNER_STATE_UNAVAILABLE', 'primary finalized owner state is unavailable')
  }
  const transaction = ownerRead.transaction
  const currentOwner = ownerRead.owner
  if (transaction.phase !== 'finalized' || transaction.status !== 'finalized') {
    throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_ADMISSION_NOT_FINALIZED', 'lifecycle owner transition requires finalized admission')
  }
  const cpRequired = operation === 'acquire' || operation === 'renew'
  const cpConfirmed = input.cpConfirmed === true && transaction.effects?.cpState?.status === 'confirmed' &&
    transaction.effects?.cpState?.cp1Confirmed === true
  if (cpRequired && !cpConfirmed) {
    throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_CP_CONFIRMATION_REQUIRED', 'owner activation requires current digest-bound CP1 confirmation')
  }
  const replayed = (
    (operation === 'acquire' && currentOwner.status === 'active') ||
    (operation === 'renew' && currentOwner.status === 'active') ||
    (operation === 'release' && currentOwner.status === 'released')
  ) && ownerTransitionReplayMatches(currentOwner, operation, input)
  if (replayed) return lifecycleOwnerReceipt(operation, transaction, currentOwner, true, nowMs)
  if (!exactOwnerRefMatches(currentOwner, input.expectedOwner)) {
    throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_CAS_MISMATCH', 'stale owner generation, nonce, revision or digest')
  }
  if (currentOwner.projectRootIdentity !== projectRootIdentity) {
    throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_PROJECT_MISMATCH', 'owner project root identity does not match the current project lease')
  }
  const issuedAt = new Date(nowMs).toISOString()
  let nextOwner
  let transition = operation
  if (operation === 'acquire') {
    if (currentOwner.status !== 'released' || currentOwner.sessionDigest !== sessionDigest) {
      throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_SESSION_MISMATCH', 'only the same exact released session may reacquire through lifecycle')
    }
    nextOwner = sealOwner({
      ...currentOwner,
      sessionDigest,
      contextEpoch,
      routeRevision,
      ownerGeneration: currentOwner.ownerGeneration + 1,
      ownerNonce: ownerNonce(options),
      leaseRevision: currentOwner.leaseRevision + 1,
      issuedAt,
      expiresAt: new Date(nowMs + WRITE_OWNER_LEASE_MS).toISOString(),
      handoffRef: null,
      takeoverRef: null,
      transitionRef: buildOwnerTransitionRef('acquire', currentOwner, input, issuedAt),
      status: 'active'
    })
    transition = 'reacquire'
  } else if (operation === 'renew') {
    if (currentOwner.status !== 'active' || currentOwner.sessionDigest !== sessionDigest ||
        currentOwner.routeRevision !== routeRevision) {
      throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_SESSION_MISMATCH', 'only the current exact session/project/route owner may renew')
    }
    const nextExpiryMs = Math.max(nowMs + WRITE_OWNER_LEASE_MS, Date.parse(currentOwner.expiresAt) + 1)
    nextOwner = sealOwner({
      ...currentOwner,
      contextEpoch,
      leaseRevision: currentOwner.leaseRevision + 1,
      issuedAt,
      expiresAt: new Date(nextExpiryMs).toISOString(),
      transitionRef: buildOwnerTransitionRef('renew', currentOwner, input, issuedAt)
    })
  } else {
    if (currentOwner.status !== 'active' || currentOwner.sessionDigest !== sessionDigest ||
        currentOwner.contextEpoch !== contextEpoch || currentOwner.routeRevision !== routeRevision) {
      throw new FencedTaskWriteOwnerError('TASK_WRITE_OWNER_SESSION_MISMATCH', 'only the current exact session/context/route owner may release')
    }
    nextOwner = sealOwner({
      ...currentOwner,
      ownerGeneration: currentOwner.ownerGeneration + 1,
      ownerNonce: ownerNonce(options),
      leaseRevision: currentOwner.leaseRevision + 1,
      issuedAt,
      expiresAt: issuedAt,
      revocationEpoch: currentOwner.revocationEpoch + 1,
      transitionRef: buildOwnerTransitionRef('release', currentOwner, input, issuedAt),
      status: 'released'
    })
  }
  const commit = commitFencedTaskWriteOwnerTransition({
    metaDir: input.metaDir,
    identity: input.identity,
    hostSessionDigest: input.actualInstructionEnvelope.hostSessionDigest,
    expectedOwner: ownerRef(currentOwner),
    owner: nextOwner,
    transition,
    transaction,
    expectedAdmissionPhase: 'finalized',
    reason: operation === 'release' ? 'owner-release' : `owner-${transition}`
  }, { fs: fsImpl, nowMs })
  if (!['committed', 'semantic-noop'].includes(commit.status)) {
    throw new FencedTaskWriteOwnerError(commit.errorCode || 'TASK_WRITE_OWNER_COMMIT_FAILED', commit.message || 'lifecycle owner transition failed', commit)
  }
  return lifecycleOwnerReceipt(operation, transaction, nextOwner, false, nowMs)
}

module.exports = {
  FENCED_TASK_WRITE_OWNER_SCHEMA,
  WRITE_OWNER_LEASE_MS,
  FencedTaskWriteOwnerError,
  buildOwnerTransitionRef,
  exactOwnerRefMatches,
  executeLifecycleTaskWriteOwner,
  ownerNonce,
  ownerRef,
  ownerTransitionReplayMatches,
  ownerTransitionRequestDigest,
  sealOwner
}
