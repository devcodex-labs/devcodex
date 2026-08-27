'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { fork, spawn } = require('child_process')

const { sha256, stableStringify } = require('../../hooks/_runtime/content-identity.cjs')

const {
  assertVerificationExecutionLease,
  leaseBindingFromPlan,
  transitionLease,
  validateVerificationExecutionLease
} = require('./validation-execution-authority')
const { buildCandidateIdentity, manifestIdentity } = require('./validation-dag')
const { createValidationEvidenceStore } = require('./validation-evidence-store')

const RUNNER_SCHEMA = 'ManagedValidationRunnerV2'
const RUNNER_STATE_SCHEMA = 'ManagedValidationRunnerStateV2'
const PROCESS_OWNERSHIP_SCHEMA = 'ValidationProcessOwnershipReceiptV1'
const WORKER_MESSAGE_SCHEMA = 'ValidationWorkerMessageV1'
const RUNNER_COMMAND_SCHEMA = 'ValidationRunnerCommandV1'
const RUN_CHECKPOINT_SCHEMA = 'ValidationRunCheckpointV1'
const RUN_HEARTBEAT_SCHEMA = 'ValidationRunHeartbeatV1'
const WORKER_PATH = path.join(__dirname, 'validation-worker.js')
// Checkpoints share the 256 KiB TaskRecoveryStoreV5 hot-state slot with the
// workflow state. Keep a fixed half-slot ceiling and persist only evidence
// identities; the selected plan reconstructs executable fields on resume.
const RUN_CHECKPOINT_MAX_BYTES = 128 * 1024

function acceptedActivePersistence(status) {
  return ['committed', 'semantic-noop', 'persisted'].includes(status)
}

function acceptedTerminalPersistence(status) {
  return acceptedActivePersistence(status) || status === 'closeout-reserved'
}

function acceptedPersistence(status) {
  return acceptedTerminalPersistence(status)
}

function semanticDigest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function executionNodeIds(plan) {
  const selected = new Map((plan?.selectedNodes || []).map(node => [node.id, node]))
  const ordered = []
  for (const wave of plan?.executionSchedule?.waves || []) {
    for (const nodeId of wave) if (selected.has(nodeId)) ordered.push(nodeId)
  }
  return ordered.length ? ordered : [...selected.keys()]
}

function compactCheckpointResult(result) {
  return {
    nodeId: result.nodeId,
    nodeContractDigest: result.nodeContractDigest || null,
    inputBindingDigest: result.inputBindingDigest || null,
    nodeVerificationPolicyDigest: result.nodeVerificationPolicyDigest || null,
    dependencyReceiptDigests: result.dependencyReceiptDigests || [],
    delegatedClosureDigest: result.delegatedClosureDigest || null,
    status: result.status,
    cacheStatus: result.cacheStatus || null,
    exitCode: result.exitCode,
    evidenceDigest: result.evidenceDigest || null,
    nodeReceiptDigest: result.nodeReceiptDigest || null
  }
}

function buildRunCheckpoint({ lease, plan, candidate, manifest, results, now = new Date().toISOString() }) {
  const successful = []
  for (const result of results || []) {
    if (!['passed', 'cache-hit'].includes(result?.status) || result.exitCode !== 0) break
    successful.push(compactCheckpointResult(result))
  }
  const core = {
    schemaVersion: RUN_CHECKPOINT_SCHEMA,
    runId: lease.runId,
    runIdentityDigest: lease.runIdentityDigest,
    leaseDigest: lease.authorityDigest,
    candidateId: candidate.candidateId,
    planDigest: plan.planDigest,
    manifestDigest: manifestIdentity(manifest).digest,
    executionNodeIds: executionNodeIds(plan),
    completedNodeIds: successful.map(result => result.nodeId),
    results: successful,
    updatedAt: now
  }
  const checkpoint = Object.freeze({ ...core, checkpointDigest: semanticDigest(core) })
  if (Buffer.byteLength(stableStringify(checkpoint), 'utf8') > RUN_CHECKPOINT_MAX_BYTES) {
    const error = new Error('validation run checkpoint exceeds its bounded persistence budget')
    error.code = 'VALIDATION_RUN_CHECKPOINT_TOO_LARGE'
    throw error
  }
  return checkpoint
}

function validateRunCheckpoint(checkpoint, { lease, plan, candidate, manifest, runnerLeaseDigest = null }) {
  const errors = []
  if (!checkpoint || checkpoint.schemaVersion !== RUN_CHECKPOINT_SCHEMA) errors.push('checkpoint-schema-invalid')
  if (checkpoint?.runId !== lease.runId || checkpoint?.runIdentityDigest !== lease.runIdentityDigest) errors.push('checkpoint-run-mismatch')
  if (!/^[a-f0-9]{64}$/.test(String(checkpoint?.leaseDigest || ''))) errors.push('checkpoint-lease-digest-invalid')
  if (runnerLeaseDigest !== null && checkpoint?.leaseDigest !== runnerLeaseDigest) errors.push('checkpoint-runner-lease-mismatch')
  if (checkpoint?.candidateId !== candidate.candidateId) errors.push('checkpoint-candidate-mismatch')
  if (checkpoint?.planDigest !== plan.planDigest) errors.push('checkpoint-plan-mismatch')
  if (checkpoint?.manifestDigest !== manifestIdentity(manifest).digest) errors.push('checkpoint-manifest-mismatch')
  const expectedNodeIds = executionNodeIds(plan)
  if (stableStringify(checkpoint?.executionNodeIds || []) !== stableStringify(expectedNodeIds)) errors.push('checkpoint-execution-order-mismatch')
  const results = Array.isArray(checkpoint?.results) ? checkpoint.results : []
  const completedNodeIds = Array.isArray(checkpoint?.completedNodeIds) ? checkpoint.completedNodeIds : []
  if (results.length !== completedNodeIds.length || results.length > expectedNodeIds.length ||
      results.some((result, index) => result?.nodeId !== expectedNodeIds[index] || completedNodeIds[index] !== result?.nodeId ||
        !['passed', 'cache-hit'].includes(result?.status) || result?.exitCode !== 0)) {
    errors.push('checkpoint-prefix-invalid')
  }
  if (Buffer.byteLength(stableStringify(checkpoint || null), 'utf8') > RUN_CHECKPOINT_MAX_BYTES) errors.push('checkpoint-too-large')
  if (checkpoint?.checkpointDigest) {
    const { checkpointDigest, ...core } = checkpoint
    if (semanticDigest(core) !== checkpointDigest) errors.push('checkpoint-digest-invalid')
  } else errors.push('checkpoint-digest-missing')
  return {
    valid: errors.length === 0,
    errors,
    results,
    leaseRebound: checkpoint?.leaseDigest !== lease.authorityDigest,
    sourceLeaseDigest: checkpoint?.leaseDigest || null,
    activeLeaseDigest: lease.authorityDigest
  }
}

function buildRunHeartbeat({ lease, attempt, currentNode, completedNodeCount, totalNodeCount, startedAt,
  hardDeadlineAt, observedAt = new Date().toISOString() }) {
  const core = {
    schemaVersion: RUN_HEARTBEAT_SCHEMA,
    runIdentityDigest: lease.runIdentityDigest,
    attempt,
    currentNode: currentNode || null,
    completedNodeCount,
    totalNodeCount,
    elapsedMs: Math.max(0, Date.parse(observedAt) - Date.parse(startedAt)),
    hardDeadlineAt,
    observedAt
  }
  return Object.freeze({ ...core, heartbeatDigest: semanticDigest(core) })
}

function createProcessOwnershipReceipt({ child, lease, workerPath, repoRoot, attempt, startedAt }) {
  const core = {
    schemaVersion: PROCESS_OWNERSHIP_SCHEMA,
    runIdentityDigest: lease.runIdentityDigest,
    runnerPid: process.pid,
    workerPid: child.pid,
    command: process.execPath,
    args: [path.resolve(workerPath)],
    cwd: path.resolve(repoRoot),
    attempt,
    detached: process.platform !== 'win32',
    startedAt
  }
  return Object.freeze({ ...core, ownershipDigest: semanticDigest(core) })
}

function validateProcessOwnershipReceipt(receipt, child, runIdentityDigest, options = {}) {
  if (!receipt || receipt.schemaVersion !== PROCESS_OWNERSHIP_SCHEMA) return false
  const { ownershipDigest, ...core } = receipt
  const runnerOwned = receipt.runnerPid === process.pid ||
    (options.allowDeadPriorRunner === true && !processAlive(receipt.runnerPid))
  return receipt.runIdentityDigest === runIdentityDigest && receipt.workerPid === child?.pid &&
    runnerOwned && semanticDigest(core) === ownershipDigest
}

function buildRunnerState(input) {
  const core = {
    schemaVersion: RUNNER_STATE_SCHEMA,
    runId: input.lease.runId,
    runIdentityDigest: input.lease.runIdentityDigest,
    phase: input.phase,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    runnerPid: process.pid,
    workerPid: input.processOwnership?.workerPid || null,
    processOwnership: input.processOwnership || null,
    leaseDigest: input.lease.authorityDigest,
    hardDeadlineAt: input.hardDeadlineAt,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt || new Date().toISOString(),
    terminalDigest: input.terminalDigest || null,
    lastEvent: input.lastEvent || null,
    currentNode: input.currentNode || null,
    heartbeat: input.heartbeat || null,
    checkpoint: input.checkpoint || null
  }
  return Object.freeze({ ...core, stateDigest: semanticDigest(core) })
}

function validateRunnerState(state, lease) {
  if (!state || state.schemaVersion !== RUNNER_STATE_SCHEMA ||
      state.runId !== lease.runId || state.runIdentityDigest !== lease.runIdentityDigest ||
      !['starting', 'running', 'observing', 'reconciling', 'terminal'].includes(state.phase) ||
      !Number.isInteger(state.attempt) || state.attempt < 0 ||
      !Number.isInteger(state.maxAttempts) || state.maxAttempts < 1 ||
      !Number.isInteger(state.runnerPid) || state.runnerPid < 1 ||
      !Number.isFinite(Date.parse(String(state.hardDeadlineAt || ''))) ||
      !Number.isFinite(Date.parse(String(state.startedAt || '')))) return false
  if (['running', 'observing', 'reconciling'].includes(state.phase)) {
    const ownership = state.processOwnership
    if (!ownership || ownership.schemaVersion !== PROCESS_OWNERSHIP_SCHEMA ||
        ownership.runIdentityDigest !== lease.runIdentityDigest ||
        ownership.runnerPid !== state.runnerPid || ownership.workerPid !== state.workerPid ||
        ownership.attempt !== state.attempt) return false
    const { ownershipDigest, ...ownershipCore } = ownership
    if (semanticDigest(ownershipCore) !== ownershipDigest) return false
  }
  const { stateDigest, ...core } = state
  return semanticDigest(core) === stateDigest
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function boundedText(value, limitBytes) {
  const source = String(value || '')
  const bytes = Buffer.byteLength(source, 'utf8')
  if (bytes <= limitBytes) return { text: source, bytes, truncated: false, digest: sha256(Buffer.from(source, 'utf8')) }
  const buffer = Buffer.from(source, 'utf8')
  const text = buffer.subarray(0, limitBytes).toString('utf8')
  return { text, bytes, truncated: true, digest: sha256(buffer) }
}

function createStreamCapture(limitBytes) {
  const chunks = []
  const hash = crypto.createHash('sha256')
  let bytes = 0
  let retainedBytes = 0
  return {
    push(chunk) {
      const buffer = Buffer.from(chunk)
      bytes += buffer.length
      hash.update(buffer)
      if (retainedBytes < limitBytes) {
        const retained = buffer.subarray(0, limitBytes - retainedBytes)
        chunks.push(retained)
        retainedBytes += retained.length
      }
    },
    snapshot() {
      return {
        text: Buffer.concat(chunks).toString('utf8'),
        bytes,
        retainedBytes,
        truncated: bytes > retainedBytes,
        digest: hash.copy().digest('hex')
      }
    }
  }
}

function terminateOwnedTree(child, options = {}) {
  if (!child?.pid) return Promise.resolve({ status: 'missing', pid: null })
  if (!validateProcessOwnershipReceipt(
    options.ownershipReceipt,
    child,
    options.runIdentityDigest,
    { allowDeadPriorRunner: options.allowDeadPriorRunner === true }
  )) {
    return Promise.resolve({ status: 'denied', pid: child.pid, errorCode: 'VALIDATION_PROCESS_OWNERSHIP_REQUIRED' })
  }
  const pid = child.pid
  if (process.platform === 'win32') {
    return new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.once('error', error => resolve({ status: 'error', pid, errorCode: error.code || 'TASKKILL_FAILED' }))
      killer.once('exit', code => resolve({ status: code === 0 || code === 128 ? 'terminated' : 'error', pid, exitCode: code }))
    })
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch (error) {
    if (error.code === 'ESRCH') return Promise.resolve({ status: 'terminated', pid })
    return Promise.resolve({ status: 'error', pid, errorCode: error.code || 'SIGTERM_FAILED' })
  }
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL') } catch { }
      resolve({ status: 'terminated', pid, signal: 'SIGKILL' })
    }, Math.min(5000, Math.max(500, Number(options.killGraceMs || 2000))))
    if (typeof child.once === 'function') {
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve({ status: 'terminated', pid, signal: 'SIGTERM' })
      })
    }
  })
}

function validationBudgetProjectionForReceipt(plan = {}) {
  const budgetCard = plan.budgetCard || {}
  return {
    schemaVersion: 'ValidationBudgetTerminalProjectionV1',
    planDigest: plan.planDigest || null,
    budgetDigest: budgetCard.digest || null,
    level: plan.verificationLevel || null,
    purpose: plan.verificationPurpose || null,
    affectedBoundaries: [...new Set(plan.affectedBoundaries || [])].sort(),
    heavyNodeIds: [...new Set(budgetCard.heavyNodeIds || [])].sort(),
    sideEffectCategories: [...new Set(budgetCard.sideEffectCategories || [])].sort(),
    selectedNodeIds: [...new Set((plan.selectedNodes || []).map(node => node.id))].sort(),
    selectedNodeCount: Number(plan.selectedNodeCount || 0),
    estimatedDurationMs: Number(budgetCard.estimatedDurationMs || 0),
    hardTimeoutUpperBoundMs: Number(budgetCard.hardTimeoutUpperBoundMs || 0),
    logBudgetBytes: Number(budgetCard.logBudgetBytes || 0)
  }
}

function controlTerminalReceipt({ plan, candidate, lease, startedAt, reason, results, runner,
  terminalStatus = 'cancelled', nativeExitCode = 130, reconciliation = null }) {
  const completedAt = new Date().toISOString()
  const completedNodeIds = new Set(results.map(result => result.nodeId))
  const abortedNodes = plan.selectedNodes.map(node => node.id).filter(id => !completedNodeIds.has(id))
  const controlCode = String(reason?.code || 'VALIDATION_CONTROL_ABORTED')
  const abortedNodeReasons = Object.fromEntries(abortedNodes.map(nodeId => [nodeId, {
    code: 'VALIDATION_CONTROL_ABORTED',
    controlCode
  }]))
  return {
    schemaVersion: 'ValidationExecutionReceiptV3',
    contractVersion: '3',
    runId: lease.runId,
    runIdentity: lease.runIdentity,
    runIdentityDigest: lease.runIdentityDigest,
    receiptId: `validation-receipt-${terminalStatus}-${lease.runIdentityDigest}`,
    candidateId: candidate.candidateId,
    candidateIdentity: {
      candidateId: candidate.candidateId,
      stable: candidate.stable,
      head: candidate.head || null,
      changedSource: candidate.changedSource || 'unknown',
      changedFiles: candidate.changedFiles || []
    },
    validationPlanSchema: plan.schemaVersion,
    routeRequested: plan.routeRequested,
    routeResolved: plan.routeResolved,
    verificationIntent: plan.verificationIntent,
    verificationLevel: plan.verificationLevel,
    verificationPurpose: plan.verificationPurpose,
    requestDigest: plan.requestDigest,
    authorityDigest: lease.authorityDigest,
    authoritySourceRef: lease.authoritySourceRef,
    authorityLineageDigest: String(lease.authoritySourceRef || '').split(':').at(-1) || null,
    authorityActorType: lease.actorType,
    authorityClass: lease.authorityClass,
    claimCeiling: 'non-qualifying',
    terminalStatus,
    terminalReason: reason,
    cancellationReason: terminalStatus === 'cancelled' ? reason : null,
    testRouteDigest: plan.planDigest,
    budgetCard: plan.budgetCard,
    budgetProjection: validationBudgetProjectionForReceipt(plan),
    selectedNodes: plan.selectedNodes.map(node => node.id),
    results,
    nodeReceiptDigests: Object.fromEntries(results.map(result => [result.nodeId, result.nodeReceiptDigest || null])),
    selectedNodeCount: plan.selectedNodeCount,
    executionCount: results.filter(result => result.status !== 'cache-hit').length,
    cacheHitCount: results.filter(result => result.status === 'cache-hit').length,
    failedNode: null,
    abortedNodes,
    abortedNodeReasons,
    startedAt,
    completedAt,
    wallTimeMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    nativeExitCode,
    runner,
    reconciliation
  }
}

function sanitizeNodeResult(result, logLimitBytes) {
  const stdout = boundedText(result?.stdout, logLimitBytes)
  const stderr = boundedText(result?.stderr, logLimitBytes)
  return {
    ...(result || {}),
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutSummary: stdout,
    stderrSummary: stderr
  }
}

function sanitizeWorkerReceipt(receipt, { lease, plan, candidate, results, runner, logLimitBytes }) {
  const sourceResults = Array.isArray(receipt?.results) ? receipt.results : results
  const boundedResults = sourceResults.map(result => sanitizeNodeResult(result, logLimitBytes))
  return {
    ...(receipt || {}),
    schemaVersion: 'ValidationExecutionReceiptV3',
    contractVersion: '3',
    runId: lease.runId,
    runIdentity: lease.runIdentity,
    runIdentityDigest: lease.runIdentityDigest,
    candidateId: candidate.candidateId,
    candidateIdentity: receipt?.candidateIdentity || {
      candidateId: candidate.candidateId,
      stable: candidate.stable,
      head: candidate.head || null,
      changedSource: candidate.changedSource || 'unknown',
      changedFiles: candidate.changedFiles || []
    },
    testRouteDigest: plan.planDigest,
    budgetCard: plan.budgetCard,
    requestDigest: plan.requestDigest,
    authorityDigest: lease.authorityDigest,
    authoritySourceRef: lease.authoritySourceRef,
    authorityLineageDigest: String(lease.authoritySourceRef || '').split(':').at(-1) || null,
    authorityActorType: lease.actorType,
    authorityClass: lease.authorityClass,
    budgetProjection: validationBudgetProjectionForReceipt(plan),
    results: boundedResults,
    nodeReceiptDigests: receipt?.nodeReceiptDigests ||
      Object.fromEntries(boundedResults.map(result => [result.nodeId, result.nodeReceiptDigest || null])),
    runner
  }
}

function compactCandidateProjection(candidate) {
  const changedFiles = [...new Set((candidate?.changedFiles || []).map(value => String(value || ''))
    .filter(Boolean))].sort()
  return {
    candidateId: candidate?.candidateId || null,
    head: candidate?.head || null,
    stable: candidate?.stable === true,
    changedSource: candidate?.changedSource || 'unknown',
    changedFileCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, 256),
    changedFilesTruncated: changedFiles.length > 256,
    changedFilesDigest: sha256(Buffer.from(stableStringify(changedFiles), 'utf8')),
    statusDigest: candidate?.identityInputs?.statusDigest || null
  }
}

function reconcileSuccessfulCandidate(receipt, { candidate, repoRoot, manifest }) {
  if (receipt?.nativeExitCode !== 0 ||
      candidate?.identityInputs?.schemaVersion !== 'ValidationCandidateIdentityV1') return receipt

  let observed = null
  let observationError = null
  try {
    observed = buildCandidateIdentity({
      repoRoot,
      narrativeMarkdownExclusions: manifest?.narrativeMarkdownExclusions
    })
  } catch (error) {
    observationError = {
      code: error.code || 'VALIDATION_CANDIDATE_RECONCILIATION_FAILED',
      message: error.message
    }
  }
  if (!observationError && observed.candidateId === candidate.candidateId && observed.head === candidate.head) {
    return receipt
  }

  return {
    ...receipt,
    terminalStatus: 'blocked',
    executionState: 'blocked',
    claimCeiling: 'non-qualifying',
    nativeExitCode: 2,
    terminalReason: {
      schemaVersion: 'ValidationCandidateDriftV1',
      code: observationError
        ? 'VALIDATION_CANDIDATE_RECONCILIATION_FAILED'
        : 'VALIDATION_CANDIDATE_DRIFT_DURING_EXECUTION',
      expected: compactCandidateProjection(candidate),
      observed: observed ? compactCandidateProjection(observed) : null,
      observationError
    }
  }
}

function validWorkerMessage(message, { lease, attempt, expectedSequence }) {
  return message?.schemaVersion === WORKER_MESSAGE_SCHEMA &&
    message.runIdentityDigest === lease.runIdentityDigest &&
    message.attempt === attempt && message.sequence === expectedSequence &&
    ['started', 'node-start', 'node', 'result', 'error'].includes(message.type)
}

async function runManagedValidation(input = {}) {
  const {
    manifest,
    plan,
    candidate,
    repoRoot,
    activeRoot,
    lease,
    actorType = null,
    project = plan?.verificationIntent?.project || 'devcodex',
    taskRecoveryKey = plan?.verificationIntent?.taskRecoveryKey || null,
    contextEpoch = plan?.verificationIntent?.contextEpoch || null,
    revocationEpoch = 0,
    taskIdentity = null,
    sessionKey = '',
    useCache = true,
    onNodeStart = null,
    onHeartbeat = null,
    onNode = null
  } = input
  const binding = leaseBindingFromPlan({
    plan,
    candidate,
    project,
    repoRoot,
    taskRecoveryKey,
    contextEpoch,
    revocationEpoch,
    actorType,
    lease
  })
  assertVerificationExecutionLease(lease, binding)
  const evidenceStoreOptions = {
    activeRoot,
    project,
    actorType: lease.actorType,
    runIdentity: lease.runIdentity,
    runIdentityDigest: lease.runIdentityDigest,
    taskIdentity,
    sessionKey,
    ...(process.env.DEVCODEX_VALIDATION_TEST_FAULTS === '1' && input.__testEvidenceFaults
      ? { __testFaults: input.__testEvidenceFaults }
      : {})
  }
  const evidenceStore = createValidationEvidenceStore(evidenceStoreOptions)
  const pollIntervalMs = Math.min(2000, Math.max(100, Number(input.pollIntervalMs || 500)))
  const workerPath = input.workerPath ? path.resolve(input.workerPath) : WORKER_PATH
  const startedAt = new Date().toISOString()
  const leaseHardDeadlineMs = Date.parse(lease.hardDeadlineAt)
  const requestedRunnerDeadlineMs = Number.isFinite(input.runnerHardTimeoutMs)
    ? Date.now() + Math.max(1, Number(input.runnerHardTimeoutMs))
    : leaseHardDeadlineMs
  const hardDeadlineMs = Math.min(leaseHardDeadlineMs, requestedRunnerDeadlineMs)
  const hardDeadlineAt = new Date(hardDeadlineMs).toISOString()
  const maxAttempts = Math.min(3, Math.max(1, Math.floor(Number(input.maxWorkerAttempts || 2))))
  const heartbeatIntervalMs = process.env.DEVCODEX_VALIDATION_TEST_FAULTS === '1' && Number.isFinite(input.heartbeatIntervalMs)
    ? Math.max(25, Number(input.heartbeatIntervalMs))
    : 30000
  const perNodeLogBytes = Math.max(1024, Math.min(64 * 1024,
    Math.ceil(Number(plan.budgetCard?.logBudgetBytes || 8000) / Math.max(1, plan.selectedNodeCount))))
  const maxIpcBytes = Math.min(16 * 1024 * 1024, Math.max(1024 * 1024,
    Number(plan.budgetCard?.logBudgetBytes || 0) * 4))
  const maxIpcMessages = Math.min(4096, Math.max(32, Number(plan.selectedNodeCount || 0) * 4 + 16))
  const streamLimitBytes = Math.min(256 * 1024, Math.max(16 * 1024,
    Number(plan.budgetCard?.logBudgetBytes || 0)))
  const stdoutCapture = createStreamCapture(streamLimitBytes)
  const stderrCapture = createStreamCapture(streamLimitBytes)
  const metrics = { ipcMessageCount: 0, ipcBytes: 0, maxIpcMessages, maxIpcBytes }
  let checkpoint = null
  const runner = {
    schemaVersion: RUNNER_SCHEMA,
    runId: lease.runId,
    runIdentityDigest: lease.runIdentityDigest,
    command: process.execPath,
    args: [workerPath],
    cwd: path.resolve(repoRoot),
    runnerPid: process.pid,
    processOwnership: 'runner-child-tree',
    pollIntervalMs,
    heartbeatIntervalMs,
    hardDeadlineAt,
    startedAt,
    attempts: [],
    restarts: [],
    recoveries: []
  }

  function runnerSnapshot(extra = {}) {
    return {
      ...runner,
      checkpoint: typeof checkpoint === 'undefined' || !checkpoint
        ? null
        : {
            schemaVersion: checkpoint.schemaVersion,
            checkpointDigest: checkpoint.checkpointDigest,
            completedNodeIds: checkpoint.completedNodeIds,
            results: checkpoint.results
          },
      ipc: { ...metrics },
      stdout: stdoutCapture.snapshot(),
      stderr: stderrCapture.snapshot(),
      ...extra
    }
  }

  function terminalResult(receipt, leaseStatus, extra = {}) {
    const terminalLease = transitionLease(lease, leaseStatus)
    const terminalLeasePersistence = evidenceStore.writeLease(terminalLease)
    const terminalReceipt = {
      ...receipt,
      terminalStatus: receipt.terminalStatus || (receipt.nativeExitCode === 0 ? 'completed' : 'failed'),
      runner: receipt.runner || runnerSnapshot({ completedAt: new Date().toISOString() })
    }
    const projection = evidenceStore.buildTerminalProjection(terminalReceipt)
    const terminalRunnerState = buildRunnerState({
      lease,
      phase: 'terminal',
      attempt: runner.attempts.length,
      maxAttempts,
      hardDeadlineAt,
      startedAt,
      processOwnership: terminalReceipt.runner?.attempts?.at(-1)?.processOwnership || null,
      terminalDigest: projection.terminalDigest,
      lastEvent: terminalReceipt.terminalStatus
    })
    // Persist the final runner projection before terminal closeout. TaskRecovery
    // terminal CAS then strips currentLease/runnerState so a completed task never
    // retains live execution authority after this function returns.
    const runnerStatePersistence = evidenceStore.writeRunnerState(terminalRunnerState)
    const persistence = evidenceStore.writeTerminal(terminalReceipt)
    if (!acceptedTerminalPersistence(persistence.status)) {
      const observed = evidenceStore.readTerminal(lease.runIdentityDigest)
      if (observed.status === 'fresh') {
        return {
          receipt: observed.receipt,
          persistence: { ...persistence, reconciliation: 'existing-terminal-won' },
          leasePersistence: extra.leasePersistence || null,
          terminalLeasePersistence,
          runner: terminalReceipt.runner,
          reconciled: true
        }
      }
      terminalReceipt.terminalStatus = 'blocked'
      terminalReceipt.claimCeiling = 'non-qualifying'
      terminalReceipt.nativeExitCode = 2
      terminalReceipt.terminalPersistenceError = persistence
    }
    return {
      receipt: terminalReceipt,
      persistence,
      leasePersistence: extra.leasePersistence || null,
      terminalLeasePersistence,
      runnerStatePersistence,
      runner: terminalReceipt.runner,
      ...extra
    }
  }

  function replayTerminal(observed, extra = {}) {
    return Promise.resolve({
      receipt: observed.receipt,
      persistence: { status: 'semantic-noop', stateOwner: observed.stateOwner, replayed: true },
      leasePersistence: null,
      terminalLeasePersistence: null,
      runner: observed.receipt?.runner || runnerSnapshot(),
      replayed: true,
      ...extra
    })
  }

  const priorTerminal = evidenceStore.readTerminal(lease.runIdentityDigest)
  if (priorTerminal.status === 'fresh') return replayTerminal(priorTerminal)

  let recoveredCheckpoint = null
  const priorRunner = evidenceStore.readRunnerState(lease.runIdentityDigest)
  if (priorRunner.status === 'fresh' && ['starting', 'running', 'observing', 'reconciling'].includes(priorRunner.runnerState?.phase)) {
    const state = priorRunner.runnerState
    if (!validateRunnerState(state, lease)) {
      const receipt = controlTerminalReceipt({
        plan, candidate, lease, startedAt,
        reason: { code: 'VALIDATION_RUNNER_STATE_INVALID' }, results: [],
        runner: runnerSnapshot({ invalidPriorState: true }), terminalStatus: 'blocked', nativeExitCode: 2,
        reconciliation: { state: 'invalid-runner-state' }
      })
      return Promise.resolve(terminalResult(receipt, 'revoked', { reconciled: true }))
    }
    if (processAlive(state.runnerPid)) {
      return new Promise(resolve => {
        const observer = setInterval(() => {
          const observed = evidenceStore.readTerminal(lease.runIdentityDigest)
          if (observed.status === 'fresh') {
            clearInterval(observer)
            resolve({
              receipt: observed.receipt,
              persistence: { status: 'semantic-noop', stateOwner: observed.stateOwner, observedExistingRun: true },
              runner: observed.receipt?.runner || state,
              replayed: true
            })
          } else if (Date.now() >= hardDeadlineMs) {
            clearInterval(observer)
            const receipt = controlTerminalReceipt({
              plan, candidate, lease, startedAt: state.startedAt || startedAt,
              reason: { code: 'VALIDATION_EXISTING_RUN_HARD_DEADLINE' }, results: [],
              runner: runnerSnapshot({ observedExistingRun: state.stateDigest }),
              terminalStatus: 'blocked', nativeExitCode: 2,
              reconciliation: { state: 'live-run-deadline', priorStateDigest: state.stateDigest }
            })
            resolve(terminalResult(receipt, 'revoked', { reconciled: true }))
          }
        }, pollIntervalMs)
      })
    }
    let termination = { status: 'missing', pid: state.workerPid || null }
    if (processAlive(state.workerPid) && state.processOwnership) {
      termination = await terminateOwnedTree({ pid: state.workerPid }, {
        ownershipReceipt: state.processOwnership,
        runIdentityDigest: lease.runIdentityDigest,
        allowDeadPriorRunner: true,
        killGraceMs: input.killGraceMs
      })
    }
    if (state.checkpoint) {
      const checkpointValidation = validateRunCheckpoint(state.checkpoint, {
        lease,
        plan,
        candidate,
        manifest,
        runnerLeaseDigest: state.leaseDigest || null
      })
      if (!checkpointValidation.valid || !['missing', 'terminated'].includes(termination.status)) {
        const receipt = controlTerminalReceipt({
          plan, candidate, lease, startedAt: state.startedAt || startedAt,
          reason: {
            code: 'VALIDATION_RUN_CHECKPOINT_INVALID',
            errors: checkpointValidation.errors,
            termination
          },
          results: [], runner: runnerSnapshot({ priorRunnerState: state.stateDigest, termination }),
          terminalStatus: 'blocked', nativeExitCode: 2,
          reconciliation: {
            state: 'checkpoint-invalid',
            priorStateDigest: state.stateDigest,
            checkpointDigest: state.checkpoint.checkpointDigest || null,
            completedNodeCount: state.checkpoint.results?.length || 0,
            termination
          }
        })
        return terminalResult(receipt, 'revoked', { reconciled: true })
      }
      recoveredCheckpoint = state.checkpoint
      checkpoint = recoveredCheckpoint
      runner.recoveries.push({
        kind: checkpointValidation.leaseRebound
          ? 'dead-host-exact-checkpoint-rebound'
          : 'dead-host-exact-checkpoint',
        priorStateDigest: state.stateDigest,
        checkpointDigest: state.checkpoint.checkpointDigest,
        completedNodeCount: state.checkpoint.results.length,
        sourceLeaseDigest: checkpointValidation.sourceLeaseDigest,
        activeLeaseDigest: checkpointValidation.activeLeaseDigest,
        termination
      })
    } else {
      const receipt = controlTerminalReceipt({
        plan, candidate, lease, startedAt: state.startedAt || startedAt,
        reason: { code: 'VALIDATION_ABANDONED_RUN_RECONCILED', priorPhase: state.phase }, results: [],
        runner: runnerSnapshot({ priorRunnerState: state.stateDigest, termination }),
        terminalStatus: 'abandoned', nativeExitCode: 2,
        reconciliation: { state: 'abandoned', priorStateDigest: state.stateDigest, termination }
      })
      return terminalResult(receipt, 'revoked', { reconciled: true })
    }
  }

  const leasePersistence = evidenceStore.writeLease(lease)
  if (!acceptedActivePersistence(leasePersistence.status)) {
    const receipt = controlTerminalReceipt({
      plan, candidate, lease, startedAt,
      reason: { code: 'VALIDATION_AUTHORITY_PERSISTENCE_FAILED', persistence: leasePersistence },
      results: [], runner: runnerSnapshot(), terminalStatus: 'blocked', nativeExitCode: 2
    })
    return Promise.resolve(terminalResult(receipt, 'revoked', { leasePersistence }))
  }

  const startingState = buildRunnerState({
    lease, phase: 'starting', attempt: 0, maxAttempts, hardDeadlineAt, startedAt,
    lastEvent: recoveredCheckpoint ? 'checkpoint-recovered' : 'authority-prewritten',
    checkpoint: recoveredCheckpoint
  })
  const startingPersistence = evidenceStore.writeRunnerState(startingState)
  if (!acceptedActivePersistence(startingPersistence.status)) {
    const receipt = controlTerminalReceipt({
      plan, candidate, lease, startedAt,
      reason: { code: 'VALIDATION_RUNNER_STATE_PERSISTENCE_FAILED', persistence: startingPersistence },
      results: [], runner: runnerSnapshot(), terminalStatus: 'blocked', nativeExitCode: 2
    })
    return Promise.resolve(terminalResult(receipt, 'revoked', { leasePersistence, startingPersistence }))
  }

  return new Promise(resolve => {
    let terminalClaimed = false
    let poll = null
    let hardTimer = null
    let silenceTimer = null
    let heartbeatTimer = null
    let activeChild = null
    let activeOwnership = null
    let attempt = 0
    let expectedSequence = 1
    let lastActivityMs = Date.now()
    let results = []
    let currentNode = null

    function clearTimers() {
      if (poll) clearInterval(poll)
      poll = null
      if (hardTimer) clearTimeout(hardTimer)
      hardTimer = null
      if (silenceTimer) clearInterval(silenceTimer)
      silenceTimer = null
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    function progressHeartbeat(observedAt = new Date().toISOString()) {
      return buildRunHeartbeat({
        lease,
        attempt,
        currentNode,
        completedNodeCount: checkpoint?.results?.length || 0,
        totalNodeCount: executionNodeIds(plan).length,
        startedAt,
        hardDeadlineAt,
        observedAt
      })
    }

    function persistProgress(lastEvent, phase = 'observing') {
      const heartbeat = progressHeartbeat()
      const state = buildRunnerState({
        lease, phase, attempt, maxAttempts, hardDeadlineAt, startedAt,
        processOwnership: activeOwnership,
        lastEvent,
        currentNode,
        heartbeat,
        checkpoint
      })
      const persistence = evidenceStore.writeRunnerState(state)
      if (onHeartbeat) onHeartbeat(heartbeat)
      if (!acceptedActivePersistence(persistence.status)) {
        terminateAndFinish({ code: 'VALIDATION_RUNNER_STATE_PERSISTENCE_FAILED', persistence }, 'blocked', 2)
        return false
      }
      return true
    }

    function finish(receipt, leaseStatus, extra = {}) {
      clearTimers()
      try { activeChild?.disconnect() } catch { }
      resolve(terminalResult(receipt, leaseStatus, { leasePersistence, startingPersistence, ...extra }))
    }

    async function terminateAndFinish(reason, terminalStatus = 'cancelled', nativeExitCode = 130) {
      if (terminalClaimed) return
      terminalClaimed = true
      clearTimers()
      const termination = activeChild && activeOwnership
        ? await terminateOwnedTree(activeChild, {
            ownershipReceipt: activeOwnership,
            runIdentityDigest: lease.runIdentityDigest,
            killGraceMs: input.killGraceMs
          })
        : { status: 'missing', pid: activeChild?.pid || null }
      runner.termination = termination
      const receipt = controlTerminalReceipt({
        plan,
        candidate,
        lease,
        startedAt,
        reason,
        results,
        runner: runnerSnapshot({ completedAt: new Date().toISOString() }),
        terminalStatus,
        nativeExitCode
      })
      finish(receipt, 'revoked')
    }

    poll = setInterval(() => {
      const observed = evidenceStore.readLease()
      const validation = validateVerificationExecutionLease(observed.lease, binding)
      if (!validation.valid) terminateAndFinish({
        code: 'VALIDATION_AUTHORITY_REVOKED',
        stateOwner: observed.stateOwner,
        errors: validation.errors
      })
    }, pollIntervalMs)
    const hardDelayMs = Math.max(1, hardDeadlineMs - Date.now())
    function armHardTimer() {
      const remainingMs = hardDeadlineMs - Date.now()
      if (remainingMs <= 0) {
        terminateAndFinish({ code: 'VALIDATION_RUNNER_HARD_DEADLINE' }, 'cancelled', 124)
        return
      }
      hardTimer = setTimeout(() => {
        hardTimer = null
        armHardTimer()
      }, Math.min(2147483647, remainingMs))
    }
    armHardTimer()
    const maxNodeTimeoutMs = Math.max(1000, ...plan.selectedNodes.map(node => Number(node.timeoutMs || 0)))
    const silenceLimitMs = Math.min(Math.max(5000, maxNodeTimeoutMs + 5000), Math.max(5000, hardDelayMs))
    silenceTimer = setInterval(() => {
      if (Date.now() - lastActivityMs > silenceLimitMs) {
        terminateAndFinish({ code: 'VALIDATION_WORKER_HANG', silenceLimitMs }, 'cancelled', 124)
      }
    }, Math.min(2000, Math.max(250, Math.floor(silenceLimitMs / 4))))

    function startWorker() {
      if (terminalClaimed) return
      let workerEntryAvailable = false
      try {
        workerEntryAvailable = fs.statSync(workerPath).isFile()
      } catch {}
      if (!workerEntryAvailable) {
        terminateAndFinish({
          code: 'VALIDATION_WORKER_ENTRY_UNAVAILABLE',
          workerPath: path.resolve(workerPath)
        }, 'blocked', 2)
        return
      }
      attempt += 1
      expectedSequence = 1
      lastActivityMs = Date.now()
      results = []
      currentNode = null
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = null
      let child
      try {
        child = fork(workerPath, [], {
          cwd: path.resolve(repoRoot),
          env: {
            ...process.env,
            DEVCODEX_VALIDATION_ATTEMPT: String(attempt),
            ...(process.env.DEVCODEX_VALIDATION_TEST_FAULTS === '1' && input.workerFaultMode
              ? { DEVCODEX_VALIDATION_WORKER_FAULT: String(input.workerFaultMode) }
              : {})
          },
          detached: process.platform !== 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        })
      } catch (error) {
        terminateAndFinish({ code: error.code || 'VALIDATION_WORKER_SPAWN_FAILED', message: error.message }, 'blocked', 2)
        return
      }
      activeChild = child
      const processStartedAt = new Date().toISOString()
      activeOwnership = createProcessOwnershipReceipt({
        child, lease, workerPath, repoRoot, attempt, startedAt: processStartedAt
      })
      runner.attempts.push({
        attempt,
        workerPid: child.pid,
        processOwnershipDigest: activeOwnership.ownershipDigest,
        processOwnership: activeOwnership,
        startedAt: processStartedAt
      })
      const runningState = buildRunnerState({
        lease, phase: 'running', attempt, maxAttempts, hardDeadlineAt, startedAt,
        processOwnership: activeOwnership, lastEvent: 'worker-spawned', checkpoint
      })
      const runningPersistence = evidenceStore.writeRunnerState(runningState)
      if (!acceptedActivePersistence(runningPersistence.status)) {
        terminateAndFinish({ code: 'VALIDATION_RUNNER_STATE_PERSISTENCE_FAILED', persistence: runningPersistence }, 'blocked', 2)
        return
      }
      child.stdout?.on('data', chunk => stdoutCapture.push(chunk))
      child.stderr?.on('data', chunk => stderrCapture.push(chunk))
      heartbeatTimer = setInterval(() => {
        if (!terminalClaimed && child === activeChild) persistProgress('heartbeat')
      }, heartbeatIntervalMs)

      child.on('message', message => {
        if (terminalClaimed || child !== activeChild) return
        const messageBytes = Buffer.byteLength(stableStringify(message), 'utf8')
        metrics.ipcMessageCount += 1
        metrics.ipcBytes += messageBytes
        if (metrics.ipcMessageCount > maxIpcMessages || metrics.ipcBytes > maxIpcBytes) {
          terminateAndFinish({ code: 'VALIDATION_WORKER_IPC_BUDGET_EXCEEDED', messageBytes, ...metrics }, 'blocked', 2)
          return
        }
        if (!validWorkerMessage(message, { lease, attempt, expectedSequence })) {
          terminateAndFinish({
            code: 'VALIDATION_WORKER_PROTOCOL_INVALID', expectedSequence,
            observedType: message?.type || null, observedSequence: message?.sequence || null
          }, 'blocked', 2)
          return
        }
        expectedSequence += 1
        lastActivityMs = Date.now()
        if (message.type === 'started') {
          const observingState = buildRunnerState({
            lease, phase: 'observing', attempt, maxAttempts, hardDeadlineAt, startedAt,
            processOwnership: activeOwnership, lastEvent: 'worker-started',
            heartbeat: progressHeartbeat(), checkpoint
          })
          const persistence = evidenceStore.writeRunnerState(observingState)
          if (!acceptedActivePersistence(persistence.status)) {
            terminateAndFinish({ code: 'VALIDATION_RUNNER_STATE_PERSISTENCE_FAILED', persistence }, 'blocked', 2)
          }
        } else if (message.type === 'node-start') {
          currentNode = message.node || null
          if (!persistProgress('node-start')) return
          if (onNodeStart) onNodeStart(currentNode)
        } else if (message.type === 'node') {
          const result = sanitizeNodeResult(message.result, perNodeLogBytes)
          results.push(result)
          currentNode = null
          if (['passed', 'cache-hit'].includes(result.status) && result.exitCode === 0) {
            try {
              const nextCheckpoint = buildRunCheckpoint({ lease, plan, candidate, manifest, results })
              if (nextCheckpoint.results.length >= (checkpoint?.results?.length || 0)) checkpoint = nextCheckpoint
            } catch (error) {
              terminateAndFinish({ code: error.code || 'VALIDATION_RUN_CHECKPOINT_FAILED', message: error.message }, 'blocked', 2)
              return
            }
          }
          if (!persistProgress(result.status === 'failed' ? 'node-failed' : 'node-completed')) return
          if (onNode) onNode(result)
        } else if (message.type === 'result') {
          if (terminalClaimed) return
          terminalClaimed = true
          let receipt = sanitizeWorkerReceipt(message.execution?.receipt, {
            lease, plan, candidate, results,
            runner: runnerSnapshot({ completedAt: new Date().toISOString() }),
            logLimitBytes: perNodeLogBytes
          })
          receipt = reconcileSuccessfulCandidate(receipt, { candidate, repoRoot, manifest })
          receipt.terminalStatus = receipt.terminalStatus || (receipt.nativeExitCode === 0 ? 'completed' : 'failed')
          finish(receipt, 'consumed')
        } else if (message.type === 'error') {
          terminateAndFinish({ code: message.error?.code || 'VALIDATION_WORKER_FAILED', error: message.error }, 'failed', 2)
        }
      })

      child.once('error', error => {
        if (terminalClaimed || child !== activeChild) return
        terminateAndFinish({ code: error.code || 'VALIDATION_WORKER_SPAWN_FAILED', message: error.message }, 'blocked', 2)
      })

      child.once('exit', (code, signal) => {
        if (terminalClaimed || child !== activeChild) return
        const attemptRecord = runner.attempts.find(item => item.attempt === attempt)
        if (attemptRecord) Object.assign(attemptRecord, { exitCode: code, signal, exitedAt: new Date().toISOString() })
        setTimeout(() => {
          if (terminalClaimed || child !== activeChild) return
          if (attempt < maxAttempts && Date.now() < hardDeadlineMs) {
            runner.restarts.push({ fromAttempt: attempt, reason: 'worker-exit-without-terminal', exitCode: code, signal })
            if (heartbeatTimer) clearInterval(heartbeatTimer)
            heartbeatTimer = null
            activeChild = null
            activeOwnership = null
            startWorker()
            return
          }
          terminalClaimed = true
          const receipt = controlTerminalReceipt({
            plan, candidate, lease, startedAt,
            reason: {
              code: 'VALIDATION_WORKER_EXITED_WITHOUT_RECEIPT', exitCode: code, signal,
              stdout: stdoutCapture.snapshot(), stderr: stderrCapture.snapshot()
            },
            results,
            runner: runnerSnapshot({ completedAt: new Date().toISOString() }),
            terminalStatus: 'abandoned',
            nativeExitCode: 2,
            reconciliation: { attempts: attempt, exhausted: true }
          })
          finish(receipt, 'revoked')
        }, Math.min(500, Math.max(25, Number(input.finalIpcGraceMs || 100))))
      })

      const command = {
        schemaVersion: RUNNER_COMMAND_SCHEMA,
        type: 'execute',
        runIdentityDigest: lease.runIdentityDigest,
        attempt,
        payload: {
          evidenceStore: evidenceStoreOptions,
          execution: {
            manifest,
            plan,
            candidate,
            repoRoot,
            activeRoot,
            lease,
            actorType,
            project,
            taskRecoveryKey,
            contextEpoch,
            revocationEpoch,
            useCache,
            resumeResults: checkpoint?.results || []
          }
        }
      }
      const dispatch = () => {
        try {
          child.send(command, error => {
            if (error && !terminalClaimed && child === activeChild) {
              terminateAndFinish({ code: 'VALIDATION_WORKER_SEND_FAILED', errorCode: error.code || null, message: error.message }, 'blocked', 2)
            }
          })
        } catch (error) {
          terminateAndFinish({ code: 'VALIDATION_WORKER_SEND_FAILED', errorCode: error.code || null, message: error.message }, 'blocked', 2)
        }
      }
      if (process.env.DEVCODEX_VALIDATION_TEST_FAULTS === '1' && input.workerFaultMode === 'disconnect-before-command') {
        setTimeout(dispatch, 50)
      } else dispatch()
    }

    startWorker()
  })
}

module.exports = {
  PROCESS_OWNERSHIP_SCHEMA,
  RUN_CHECKPOINT_SCHEMA,
  RUN_HEARTBEAT_SCHEMA,
  RUNNER_COMMAND_SCHEMA,
  RUNNER_SCHEMA,
  RUNNER_STATE_SCHEMA,
  WORKER_MESSAGE_SCHEMA,
  acceptedActivePersistence,
  acceptedPersistence,
  acceptedTerminalPersistence,
  buildRunnerState,
  buildRunCheckpoint,
  buildRunHeartbeat,
  controlTerminalReceipt,
  createProcessOwnershipReceipt,
  runManagedValidation,
  reconcileSuccessfulCandidate,
  terminateOwnedTree,
  validationBudgetProjectionForReceipt,
  validateProcessOwnershipReceipt,
  validateRunCheckpoint,
  validateRunnerState
}
