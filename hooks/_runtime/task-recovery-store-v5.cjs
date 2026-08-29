'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const {
  COLD_STUB_MAX_BYTES,
  TASK_STATE_SLOT_MAX_BYTES,
  buildColdResumeStub,
  compactLifecycleStateV5,
  digestValue,
  jsonBytes,
  semanticLifecycleProjection
} = require('./lifecycle-state-projection-v5.cjs')
const {
  projectArtifactMutationReconciliationReceipt,
  validateArtifactMutationReconciliationInput
} = require('./artifact-mutation-reconciliation.cjs')
const {
  isTransientWindowsFsError,
  retryTransientWindowsFs
} = require('./windows-fs-retry.cjs')
const {
  validateActualInstructionEnvelope,
  validateWorkItemSet
} = require('./actual-instruction-envelope.cjs')
const {
  buildWorkflowRouteDecision,
  verifyWorkflowRouteDecision
} = require('./workflow-route-decision-v2.cjs')

const TASK_RECOVERY_STATE_SCHEMA = 'TaskRecoveryStateV5'
const TASK_RECOVERY_EPHEMERAL_SCHEMA = 'TaskRecoveryEphemeralRingV5'
const TASK_RECOVERY_COMMIT_SCHEMA = 'TaskRecoveryCommitReceiptV5'
const TASK_RECOVERY_STATUS_SCHEMA = 'TaskRecoveryStoreStatusV5'
const TASK_RECOVERY_DOCTOR_SCHEMA = 'TaskRecoveryStoreDoctorV5'
const TASK_RECOVERY_LOCK_SCHEMA = 'TaskRecoveryWriterLockV5'
const TASK_RECOVERY_CLOSEOUT_SCHEMA = 'TaskRecoveryEmergencyCloseoutV5'
const TASK_RECOVERY_KEY_SCHEMA = 'TaskRecoveryKeyV1'
const TASK_RECOVERY_USAGE_SCHEMA = 'TaskRecoveryUsageLedgerV1'
const TASK_ADMISSION_TRANSACTION_SCHEMA = 'TaskAdmissionTransactionV1'
const TASK_ADMISSION_RECONCILIATION_SCHEMA = 'TaskAdmissionReconciliationReceiptV1'
const ADMISSION_INGRESS_SNAPSHOT_SCHEMA = 'AdmissionIngressSnapshotV1'
const ADMISSION_INGRESS_SNAPSHOT_REF_SCHEMA = 'AdmissionIngressSnapshotRefV1'
const ADMISSION_CONTINUATION_LEASE_SCHEMA = 'AdmissionContinuationLeaseV1'
const FENCED_TASK_WRITE_OWNER_SCHEMA = 'FencedTaskWriteOwnerLeaseV2'
const WORKFLOW_TASK_TERMINAL_RECEIPT_SCHEMA = 'WorkflowTaskTerminalReceiptV1'
const TASKLESS_WORKFLOW_INGRESS_RECOVERY_SCHEMA = 'TasklessWorkflowIngressRecoveryV1'
const TASK_ADMISSION_PHASES = Object.freeze([
  'prepared',
  'identity-written',
  'overview-written',
  'cp-state-written',
  'owner-fenced',
  'finalized',
  'terminal-closeout',
  'aborted',
  'needs-reconcile'
])
const CLOSEOUT_REASONS = new Set([
  'mutation-closeout',
  'admission-abort',
  'admission-reconcile',
  'terminal-closeout',
  'terminal-closeout-reconcile'
])

const DEFAULT_SOFT_BYTES = 256 * 1024 * 1024
const DEFAULT_HARD_BYTES = 512 * 1024 * 1024
const DEFAULT_RESERVE_BYTES = 8 * 1024 * 1024
const DEFAULT_DISK_HEADROOM_BYTES = 8 * 1024 * 1024
const DEFAULT_EPHEMERAL_BYTES = 1024 * 1024
const ADMISSION_INGRESS_SNAPSHOT_MAX_BYTES = 512 * 1024
const EPHEMERAL_ENTRY_MAX_BYTES = 8 * 1024
const EPHEMERAL_STUB_TARGET_BYTES = EPHEMERAL_ENTRY_MAX_BYTES - 1024
const DEFAULT_COLD_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TERMINAL_GRACE_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_LOCK_LEASE_MS = 30 * 1000
const DEFAULT_LOCK_WAIT_MS = 2000
const DEFAULT_TASK_INVENTORY_MAX = 100000
const DEFAULT_MAINTENANCE_THROTTLE_MS = 60 * 1000
const DEFAULT_FIXED_SLOT_REPLACE_RETRY_DELAYS_MS = Object.freeze([5, 15, 35, 75, 150, 300, 600])
const TRANSIENT_FIXED_SLOT_REPLACE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])
const CLOSEOUT_MAGIC = 'TRV5CL01'
const CLOSEOUT_HEADER_BYTES = 80
const RESERVE_ALLOCATION_MAGIC = Buffer.from('TRV5RS01', 'ascii')
const RESERVE_WRITE_CHUNK_BYTES = 64 * 1024
const USAGE_LEDGER_MAX_BYTES = 4 * 1024
const MUTATION_PREFLIGHT_STATE_MAX_BYTES = 4 * 1024
const TELEMETRY_SEGMENT_MAX_BYTES = 1024 * 1024
const TELEMETRY_RECORD_MAX_BYTES = 16 * 1024
const TELEMETRY_TOTAL_MAX_BYTES = 4 * TELEMETRY_SEGMENT_MAX_BYTES
const SEMANTIC_CACHE_MAX_ENTRIES = 256
const semanticCache = new Map()

class TaskRecoveryStoreV5Error extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'TaskRecoveryStoreV5Error'
    this.code = code
    this.details = details
  }
}

function nowMsFrom(options = {}) {
  return Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
}

function portableRoot(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  let resolved = path.resolve(raw).replace(/\\/g, '/')
  if (process.platform === 'win32') resolved = resolved.toLowerCase()
  return resolved.replace(/\/$/, '')
}

function normalizedProject(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
}

function workspaceNamespaceAnchor(activeRoot) {
  let current = path.resolve(String(activeRoot || ''))
  while (true) {
    if (path.basename(current).toLowerCase() === '.devcodex') return current
    const parent = path.dirname(current)
    if (parent === current) return ''
    current = parent
  }
}

function inferWorkspaceNamespaceLayout(activeRoot, project) {
  const root = path.resolve(String(activeRoot || ''))
  const anchor = workspaceNamespaceAnchor(root)
  if (!anchor || root === anchor) return false
  const relative = path.relative(anchor, root).replace(/\\/g, '/')
  const projectKey = String(project || '').trim().replace(/\\/g, '/')
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return false
  if (['workspace', '__workspace__'].includes(projectKey.toLowerCase())) {
    return relative.toLowerCase() === 'workspace'
  }
  return !!projectKey && relative.toLowerCase() === projectKey.toLowerCase()
}

function taskRecoveryPartition(input = {}) {
  const explicitLayout = typeof input.workspaceNamespace === 'boolean'
  const workspaceNamespace = explicitLayout
    ? input.workspaceNamespace
    : inferWorkspaceNamespaceLayout(input.activeRoot, input.project)
  if (!workspaceNamespace) return 'legacy'
  const raw = String(input.project || '').trim().replace(/\\/g, '/')
  if (!raw || ['workspace', '__workspace__'].includes(raw.toLowerCase())) return 'workspace'
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(raw) ||
      raw.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_TASK_RECOVERY_PARTITION_INVALID',
      'workspace TaskRecovery partition must be one canonical project namespace',
      { project: raw }
    )
  }
  return raw
}

function resolveTaskRecoveryMetaDir(input = {}) {
  const rawActiveRoot = String(input.activeRoot || '').trim()
  if (!rawActiveRoot) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_ACTIVE_ROOT_REQUIRED',
      'activeRoot is required to resolve the TaskRecoveryStoreV5 partition'
    )
  }
  const explicitLayout = typeof input.workspaceNamespace === 'boolean'
  const workspaceNamespace = explicitLayout
    ? input.workspaceNamespace
    : inferWorkspaceNamespaceLayout(rawActiveRoot, input.project)
  let activeRoot = path.resolve(rawActiveRoot)
  let partition = taskRecoveryPartition({ ...input, workspaceNamespace })
  if (workspaceNamespace && input.scope === 'workspace') {
    const anchor = workspaceNamespaceAnchor(activeRoot)
    if (!anchor) {
      throw new TaskRecoveryStoreV5Error(
        'LIFECYCLE_WORKSPACE_NAMESPACE_ROOT_INVALID',
        'workspace TaskRecovery scope requires an activeRoot beneath .devcodex'
      )
    }
    activeRoot = path.join(anchor, 'workspace')
    partition = 'workspace'
  }
  return path.join(activeRoot, '.memory', 'hooks', partition)
}

function createTaskRecoveryKey(input = {}) {
  const material = {
    schemaVersion: TASK_RECOVERY_KEY_SCHEMA,
    canonicalActiveRoot: portableRoot(input.activeRoot),
    project: normalizedProject(input.project),
    taskId: String(input.taskId || '').trim().toLowerCase()
  }
  if (!material.canonicalActiveRoot || !material.project || !material.taskId) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_TASK_IDENTITY_REQUIRED',
      'activeRoot, project and taskId are required for durable task recovery',
      material
    )
  }
  return digestValue(material)
}

function normalizeIdentity(input = {}, { allowEphemeral = false } = {}) {
  const identity = {
    schemaVersion: 'TaskRecoveryIdentityV1',
    canonicalActiveRoot: portableRoot(input.activeRoot || input.canonicalActiveRoot),
    project: normalizedProject(input.project),
    taskId: String(input.taskId || '').trim().toLowerCase(),
    taskStatus: String(input.taskStatus || 'active').trim().toLowerCase(),
    recoveryKey: null
  }
  if (!identity.canonicalActiveRoot || !identity.project || (!allowEphemeral && !identity.taskId)) {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_TASK_IDENTITY_REQUIRED', 'task recovery identity is incomplete', identity)
  }
  if (identity.taskId) identity.recoveryKey = createTaskRecoveryKey({
    activeRoot: identity.canonicalActiveRoot,
    project: identity.project,
    taskId: identity.taskId
  })
  return identity
}

function sameIdentity(left, right, { allowMissingTask = false } = {}) {
  if (!left || !right) return false
  if (portableRoot(left.canonicalActiveRoot) !== portableRoot(right.canonicalActiveRoot)) return false
  if (normalizedProject(left.project) !== normalizedProject(right.project)) return false
  if (!allowMissingTask || (left.taskId && right.taskId)) {
    if (String(left.taskId || '').toLowerCase() !== String(right.taskId || '').toLowerCase()) return false
  }
  if (left.recoveryKey && right.recoveryKey && left.recoveryKey !== right.recoveryKey) return false
  return true
}

function storePaths(metaDir) {
  const root = path.join(path.resolve(metaDir), 'v5')
  return {
    root,
    tasks: path.join(root, 'tasks'),
    ephemeral: [path.join(root, 'ephemeral-a.json'), path.join(root, 'ephemeral-b.json')],
    ephemeralLock: path.join(root, 'ephemeral.lock'),
    storeLock: path.join(root, 'store.lock'),
    reserve: [path.join(root, 'emergency-a.bin'), path.join(root, 'emergency-b.bin')],
    telemetry: [0, 1, 2, 3].map(index => path.join(root, `telemetry-${index}.ndjson`)),
    manifest: path.join(root, 'manifest.json'),
    manifestTemp: path.join(root, 'manifest-next.tmp')
  }
}

function taskPaths(paths, recoveryKey) {
  const dir = path.join(paths.tasks, recoveryKey.slice(0, 2), recoveryKey)
  return {
    dir,
    slots: [path.join(dir, 'state-a.json'), path.join(dir, 'state-b.json')],
    lock: path.join(dir, 'writer.lock'),
    temp: path.join(dir, 'state-next.tmp')
  }
}

function nearestExistingDirectory(start, fsImpl = fs) {
  let current = path.resolve(start)
  while (true) {
    try {
      const stats = fsImpl.statSync(current)
      if (stats.isDirectory()) return current
    } catch { }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function finiteByteCount(value) {
  if (typeof value === 'bigint') {
    return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value)
  }
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null
}

function missingReserveBytes(paths, options = {}) {
  const fsImpl = options.fs || fs
  const reserveBytes = Number.isInteger(options.reserveBytes) ? options.reserveBytes : DEFAULT_RESERVE_BYTES
  const each = Math.floor(reserveBytes / 2)
  return paths.reserve.reduce((sum, file) => {
    try {
      const stats = fsImpl.statSync(file)
      if (stats.isFile() && stats.size === each && reserveAllocationMarkerPresent(file, each, fsImpl)) {
        return sum
      }
      return sum + each
    } catch {
      return sum + each
    }
  }, 0)
}

function inspectDiskHeadroom(paths, projectedAtomicWriteBytes, options = {}) {
  const fsImpl = options.fs || fs
  const headroomBytes = Number.isInteger(options.diskHeadroomBytes)
    ? Math.max(0, options.diskHeadroomBytes)
    : DEFAULT_DISK_HEADROOM_BYTES
  const atomicWriteBytes = Math.max(0, Math.trunc(projectedAtomicWriteBytes || 0))
  const reserveGrowthBytes = missingReserveBytes(paths, options)
  const requiredFreeBytes = atomicWriteBytes + reserveGrowthBytes + headroomBytes
  let availableBytes = Number.isInteger(options.availableDiskBytes)
    ? Math.max(0, options.availableDiskBytes)
    : null
  let probePath = null
  let errorCode = null
  let message = null
  if (availableBytes === null) {
    probePath = nearestExistingDirectory(paths.root, fsImpl)
    if (!probePath || typeof fsImpl.statfsSync !== 'function') {
      errorCode = 'LIFECYCLE_DISK_CAPACITY_UNVERIFIED'
      message = 'filesystem capacity probe is unavailable'
    } else {
      try {
        const stats = fsImpl.statfsSync(probePath)
        const blocks = finiteByteCount(stats.bavail)
        const blockSize = finiteByteCount(stats.bsize || stats.frsize)
        if (blocks === null || blockSize === null) throw new Error('statfs returned invalid capacity fields')
        availableBytes = Math.min(Number.MAX_SAFE_INTEGER, blocks * blockSize)
      } catch (error) {
        errorCode = 'LIFECYCLE_DISK_CAPACITY_UNVERIFIED'
        message = error.message
      }
    }
  }
  const status = availableBytes === null
    ? 'UNVERIFIED'
    : (availableBytes >= requiredFreeBytes ? 'PASS' : 'BLOCK')
  return {
    status,
    probePath,
    availableBytes,
    requiredFreeBytes,
    projectedAtomicWriteBytes: atomicWriteBytes,
    missingReserveBytes: reserveGrowthBytes,
    headroomBytes,
    errorCode,
    message
  }
}

function waitSync(milliseconds) {
  if (milliseconds <= 0) return
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

function readJson(file, fsImpl = fs, maxBytes = TASK_STATE_SLOT_MAX_BYTES + 64 * 1024) {
  let stats
  try { stats = fsImpl.statSync(file) } catch (error) {
    return error?.code === 'ENOENT'
      ? { status: 'missing', file }
      : { status: 'invalid', file, errorCode: 'LIFECYCLE_STATE_READ_FAILED', message: error.message }
  }
  if (!stats.isFile()) return { status: 'invalid', file, errorCode: 'LIFECYCLE_STATE_NOT_FILE' }
  if (stats.size > maxBytes) return { status: 'invalid', file, errorCode: 'LIFECYCLE_STATE_PAYLOAD_EXCEEDED', bytes: stats.size, maxBytes }
  try {
    return { status: 'fresh', file, bytes: stats.size, value: JSON.parse(fsImpl.readFileSync(file, 'utf8')), mtimeMs: stats.mtimeMs }
  } catch (error) {
    return { status: 'invalid', file, errorCode: 'LIFECYCLE_STATE_INVALID_JSON', message: error.message }
  }
}

function envelopeDigest(envelope) {
  return digestValue({
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    recordType: envelope.recordType,
    baseSequence: envelope.baseSequence,
    sequence: envelope.sequence,
    committedAt: envelope.committedAt,
    lastAccessedAt: envelope.lastAccessedAt,
    terminalAt: envelope.terminalAt || null,
    identity: envelope.identity,
    semanticDigest: envelope.semanticDigest,
    state: envelope.state
  })
}

function validateEnvelope(raw, expectedIdentity = null, expectedRecoveryKey = '') {
  if (!raw || raw.schemaVersion !== TASK_RECOVERY_STATE_SCHEMA || !['hot', 'cold'].includes(raw.kind)) {
    return { valid: false, errorCode: 'LIFECYCLE_STATE_SCHEMA_INVALID' }
  }
  if (!Number.isInteger(raw.sequence) || raw.sequence < 1 || !raw.identity || !raw.semanticDigest || !raw.payloadDigest) {
    return { valid: false, errorCode: 'LIFECYCLE_STATE_SHAPE_INVALID' }
  }
  let normalized
  try { normalized = normalizeIdentity(raw.identity) } catch {
    return { valid: false, errorCode: 'LIFECYCLE_STATE_IDENTITY_INVALID' }
  }
  if (normalized.recoveryKey !== raw.identity.recoveryKey ||
      (expectedRecoveryKey && normalized.recoveryKey !== expectedRecoveryKey)) {
    return { valid: false, errorCode: 'LIFECYCLE_STATE_IDENTITY_MISMATCH', observedIdentity: raw.identity }
  }
  if (raw.recordType && raw.recordType !== 'mutation-preflight') {
    return { valid: false, errorCode: 'LIFECYCLE_STATE_RECORD_TYPE_INVALID' }
  }
  if (raw.recordType === 'mutation-preflight' && (!Number.isInteger(raw.baseSequence) || raw.baseSequence < 0)) {
    return { valid: false, errorCode: 'LIFECYCLE_PREFLIGHT_BASE_INVALID' }
  }
  if (expectedIdentity && !sameIdentity(raw.identity, expectedIdentity)) {
    return { valid: false, errorCode: 'LIFECYCLE_STATE_IDENTITY_MISMATCH', observedIdentity: raw.identity }
  }
  if (raw.payloadDigest !== envelopeDigest(raw)) {
    return { valid: false, errorCode: 'LIFECYCLE_STATE_DIGEST_MISMATCH' }
  }
  return { valid: true }
}

function readTaskSlots(paths, identity = null, fsImpl = fs) {
  const expectedRecoveryKey = path.basename(paths.dir)
  const reads = paths.slots.map(file => readJson(file, fsImpl))
  const valid = reads.flatMap(read => {
    if (read.status !== 'fresh') return []
    const validation = validateEnvelope(read.value, identity, expectedRecoveryKey)
    return validation.valid ? [{ ...read, envelope: read.value }] : []
  }).sort((left, right) => right.envelope.sequence - left.envelope.sequence)
  if (valid.length) return { status: 'fresh', current: valid[0], previous: valid[1] || null, reads }
  const mismatch = reads.find(read => read.status === 'fresh' &&
    validateEnvelope(read.value, identity, expectedRecoveryKey).errorCode === 'LIFECYCLE_STATE_IDENTITY_MISMATCH')
  return {
    status: mismatch ? 'identity-mismatch' : (reads.every(read => read.status === 'missing') ? 'missing' : 'invalid'),
    errorCode: mismatch ? 'LIFECYCLE_STATE_IDENTITY_MISMATCH' : 'LIFECYCLE_STATE_UNAVAILABLE',
    reads
  }
}

function boundedRecoveryString(value, maxLength = 512) {
  const text = String(value || '')
  return text.length <= maxLength ? text : text.slice(0, maxLength)
}

function cloneRecoveryValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : null
}

function tasklessWorkflowIngressRecoveryCore(state, authorityMode = 'exact') {
  const envelope = state?.actualInstructionEnvelope
  const workItemSet = state?.workItemSet
  const decision = state?.workflowRouteDecision
  const planBinding = state?.workflowRoutePlanBinding
  const sticky = state?.stickyProject
  if (!envelope?.envelopeId || !envelope?.envelopeDigest || !workItemSet?.setDigest ||
      !decision?.decisionDigest || !decision?.routeRevision || !planBinding?.bindingDigest ||
      !sticky?.leaseDigest) return null
  return {
    schemaVersion: TASKLESS_WORKFLOW_INGRESS_RECOVERY_SCHEMA,
    authorityMode,
    envelopeId: boundedRecoveryString(envelope.envelopeId, 128),
    envelopeDigest: boundedRecoveryString(envelope.envelopeDigest, 64),
    workItemSetDigest: boundedRecoveryString(workItemSet.setDigest, 64),
    decisionDigest: boundedRecoveryString(decision.decisionDigest, 64),
    planBindingDigest: boundedRecoveryString(planBinding.bindingDigest, 64),
    projectLeaseDigest: boundedRecoveryString(sticky.leaseDigest, 64),
    contextEpoch: boundedRecoveryString(envelope.contextEpoch, 256),
    routeRevision: boundedRecoveryString(decision.routeRevision, 64),
    expiresAt: boundedRecoveryString(envelope.expiresAt, 64)
  }
}

function buildTasklessWorkflowIngressRecovery(state, authorityMode = 'exact') {
  const core = tasklessWorkflowIngressRecoveryCore(state, authorityMode)
  return core ? { ...core, recoveryDigest: digestValue(core) } : null
}

function compactInstructionEnvelopeIdentity(envelope) {
  if (!envelope || typeof envelope !== 'object') return null
  return {
    schemaVersion: boundedRecoveryString(envelope.schemaVersion, 64),
    envelopeId: boundedRecoveryString(envelope.envelopeId, 128),
    envelopeDigest: boundedRecoveryString(envelope.envelopeDigest, 64),
    actualInstructionDigest: boundedRecoveryString(envelope.actualInstructionDigest, 64),
    contextEpoch: boundedRecoveryString(envelope.contextEpoch, 256),
    provenanceLevel: boundedRecoveryString(envelope.provenanceLevel, 64),
    instructionAuthority: envelope.instructionAuthority === true,
    expiresAt: boundedRecoveryString(envelope.expiresAt, 64)
  }
}

function compactWorkItemSetIdentity(workItemSet) {
  if (!workItemSet || typeof workItemSet !== 'object') return null
  return {
    schemaVersion: boundedRecoveryString(workItemSet.schemaVersion, 64),
    envelopeId: boundedRecoveryString(workItemSet.envelopeId, 128),
    envelopeDigest: boundedRecoveryString(workItemSet.envelopeDigest, 64),
    setDigest: boundedRecoveryString(workItemSet.setDigest, 64),
    items: Array.isArray(workItemSet.items)
      ? workItemSet.items.slice(0, 32).map(item => ({
          workItemId: boundedRecoveryString(item?.workItemId, 128),
          workItemDigest: boundedRecoveryString(item?.workItemDigest, 64),
          taskKind: boundedRecoveryString(item?.taskKind, 64),
          routeCandidate: item?.routeCandidate == null ? null : boundedRecoveryString(item.routeCandidate, 128)
        }))
      : []
  }
}

function compactWorkflowRouteIdentity(decision) {
  if (!decision || typeof decision !== 'object') return null
  return {
    projectionKind: 'taskless-recovery-identity',
    schemaVersion: boundedRecoveryString(decision.schemaVersion, 64),
    decisionStatus: boundedRecoveryString(decision.decisionStatus, 32),
    environmentMode: boundedRecoveryString(decision.environmentMode, 32),
    topIntent: boundedRecoveryString(decision.topIntent, 32),
    subtype: boundedRecoveryString(decision.subtype, 64),
    routeKey: boundedRecoveryString(decision.routeKey, 96),
    stage: boundedRecoveryString(decision.stage, 96),
    routeRevision: boundedRecoveryString(decision.routeRevision, 64),
    routeRegistryDigest: boundedRecoveryString(decision.routeRegistryDigest, 64),
    envelopeId: boundedRecoveryString(decision.envelopeId, 128),
    envelopeDigest: boundedRecoveryString(decision.envelopeDigest, 64),
    workItemId: boundedRecoveryString(decision.workItemId, 128) || null,
    workItemDigest: boundedRecoveryString(decision.workItemDigest, 64) || null,
    provenanceLevel: boundedRecoveryString(decision.provenanceLevel, 64),
    authorityScope: boundedRecoveryString(decision.authorityScope, 64),
    decisionDigest: boundedRecoveryString(decision.decisionDigest, 64),
    mutationAuthority: false,
    releaseAuthority: false
  }
}

function compactWorkflowRoutePlanBindingIdentity(binding) {
  if (!binding || typeof binding !== 'object') return null
  return {
    projectionKind: 'taskless-recovery-identity',
    schemaVersion: boundedRecoveryString(binding.schemaVersion, 64),
    contextEpoch: boundedRecoveryString(binding.contextEpoch, 256),
    planId: boundedRecoveryString(binding.planId, 256),
    planContentId: boundedRecoveryString(binding.planContentId, 256),
    routeKey: boundedRecoveryString(binding.routeKey, 96),
    routeRevision: boundedRecoveryString(binding.routeRevision, 64),
    decisionDigest: boundedRecoveryString(binding.decisionDigest, 64),
    bindingDigest: boundedRecoveryString(binding.bindingDigest, 64)
  }
}

function validateTasklessWorkflowIngressRecovery(state, options = {}) {
  const recovery = state?.workflowIngressRecovery
  if (!recovery) return { valid: true, status: 'legacy-unverified' }
  if (recovery.schemaVersion !== TASKLESS_WORKFLOW_INGRESS_RECOVERY_SCHEMA ||
      !['exact', 'identity-only'].includes(recovery.authorityMode)) {
    return { valid: false, errorCode: 'TASKLESS_INGRESS_RECOVERY_SCHEMA_INVALID' }
  }
  const { recoveryDigest, ...core } = recovery
  if (!/^[a-f0-9]{64}$/.test(String(recoveryDigest || '')) || recoveryDigest !== digestValue(core)) {
    return { valid: false, errorCode: 'TASKLESS_INGRESS_RECOVERY_DIGEST_MISMATCH' }
  }
  const envelope = state.actualInstructionEnvelope || {}
  const workItemSet = state.workItemSet || {}
  let decision = state.workflowRouteDecision || {}
  const planBinding = state.workflowRoutePlanBinding || {}
  const sticky = state.stickyProject || {}
  const exactBindings = [
    [recovery.envelopeId, envelope.envelopeId],
    [recovery.envelopeDigest, envelope.envelopeDigest],
    [recovery.workItemSetDigest, workItemSet.setDigest],
    [recovery.decisionDigest, decision.decisionDigest],
    [recovery.planBindingDigest, planBinding.bindingDigest],
    [recovery.projectLeaseDigest, sticky.leaseDigest],
    [recovery.contextEpoch, envelope.contextEpoch],
    [recovery.routeRevision, decision.routeRevision]
  ]
  if (exactBindings.some(([expected, observed]) => !expected || expected !== observed) ||
      workItemSet.envelopeId !== envelope.envelopeId || workItemSet.envelopeDigest !== envelope.envelopeDigest ||
      decision.envelopeId !== envelope.envelopeId || decision.envelopeDigest !== envelope.envelopeDigest ||
      planBinding.contextEpoch !== envelope.contextEpoch || planBinding.routeRevision !== decision.routeRevision ||
      planBinding.decisionDigest !== decision.decisionDigest || sticky.contextEpoch !== envelope.contextEpoch ||
      sticky.routeRevision !== decision.routeRevision || sticky.project !== state.activeProject) {
    return { valid: false, errorCode: 'TASKLESS_INGRESS_RECOVERY_BINDING_MISMATCH' }
  }
  const nowMs = nowMsFrom(options)
  const expiresAtMs = Date.parse(String(recovery.expiresAt || envelope.expiresAt || ''))
  const projectExpiresAtMs = Number(sticky.expiresAtMs) || Date.parse(String(sticky.expiresAt || ''))
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs ||
      !Number.isFinite(projectExpiresAtMs) || projectExpiresAtMs <= nowMs) {
    return { valid: false, errorCode: 'TASKLESS_INGRESS_RECOVERY_EXPIRED' }
  }
  if (recovery.authorityMode === 'identity-only') {
    return { valid: true, status: 'identity-only', authority: false }
  }
  const envelopeValidation = validateActualInstructionEnvelope(envelope)
  const workItemValidation = validateWorkItemSet(workItemSet, envelope)
  if (decision.projectionKind === 'taskless-recovery-identity' &&
      envelopeValidation.valid && workItemValidation.valid) {
    try {
      const rebuilt = buildWorkflowRouteDecision({
        actualInstructionEnvelope: envelope,
        workItemSet,
        workItemId: decision.workItemId,
        environmentMode: decision.environmentMode,
        topIntent: decision.topIntent,
        subtype: decision.subtype,
        routeKey: decision.routeKey,
        stage: decision.stage,
        routeRevision: decision.routeRevision,
        routeRegistryDigest: decision.routeRegistryDigest
      })
      if (rebuilt.decisionDigest !== decision.decisionDigest || rebuilt.envelopeId !== decision.envelopeId ||
          rebuilt.envelopeDigest !== decision.envelopeDigest || rebuilt.workItemId !== decision.workItemId ||
          rebuilt.workItemDigest !== decision.workItemDigest) {
        return { valid: false, errorCode: 'TASKLESS_INGRESS_RECOVERY_ROUTE_REBUILD_MISMATCH' }
      }
      state.workflowRouteDecision = rebuilt
      decision = rebuilt
    } catch (error) {
      return {
        valid: false,
        errorCode: error.code || 'TASKLESS_INGRESS_RECOVERY_ROUTE_REBUILD_FAILED',
        errors: [error.message]
      }
    }
  }
  const routeValidation = verifyWorkflowRouteDecision(decision, {
    environmentMode: decision.environmentMode,
    envelopeDigest: envelope.envelopeDigest,
    workItemDigest: decision.workItemDigest,
    routeKey: decision.routeKey,
    topIntent: decision.topIntent,
    subtype: decision.subtype,
    stage: decision.stage,
    routeRevision: decision.routeRevision,
    routeRegistryDigest: decision.routeRegistryDigest,
    actualInstructionEnvelope: envelope,
    workItemSet
  })
  const { bindingDigest, projectionKind, ...bindingCore } = planBinding
  const bindingValid = projectionKind === 'taskless-recovery-identity'
    ? bindingDigest === recovery.planBindingDigest
    : bindingDigest === digestValue(bindingCore)
  if (!envelopeValidation.valid || !workItemValidation.valid || !routeValidation.fresh || !bindingValid) {
    return {
      valid: false,
      errorCode: 'TASKLESS_INGRESS_RECOVERY_AUTHORITY_INVALID',
      errors: [
        ...envelopeValidation.errors,
        ...workItemValidation.errors,
        ...routeValidation.errors,
        ...(bindingValid ? [] : ['plan-binding-digest'])
      ]
    }
  }
  return { valid: true, status: 'exact', authority: true }
}

function admissionIngressRefCore(state = {}) {
  const envelope = state.actualInstructionEnvelope || {}
  const decision = state.workflowRouteDecision || {}
  if (!/^aie-[a-f0-9]{40}$/.test(String(envelope.envelopeId || '')) ||
      !/^[a-f0-9]{64}$/.test(String(envelope.envelopeDigest || '')) ||
      !/^[a-f0-9]{64}$/.test(String(decision.decisionDigest || '')) ||
      !/^[a-f0-9]{64}$/.test(String(decision.routeRevision || ''))) return null
  return {
    schemaVersion: 'WorkflowIngressProjectionRefV1',
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.envelopeDigest,
    decisionDigest: decision.decisionDigest,
    routeRevision: decision.routeRevision
  }
}

function admissionIngressSnapshotKey(ingressRef = {}) {
  return digestValue({
    schemaVersion: ADMISSION_INGRESS_SNAPSHOT_REF_SCHEMA,
    envelopeId: ingressRef.envelopeId,
    envelopeDigest: ingressRef.envelopeDigest,
    decisionDigest: ingressRef.decisionDigest,
    routeRevision: ingressRef.routeRevision
  })
}

function validateAdmissionIngressState(state = {}, options = {}) {
  const errors = []
  const envelope = state.actualInstructionEnvelope || {}
  const workItemSet = state.workItemSet || {}
  const decision = state.workflowRouteDecision || {}
  const sticky = state.stickyProject || {}
  const ingressRef = admissionIngressRefCore(state)
  const envelopeValidation = validateActualInstructionEnvelope(envelope)
  const workItemValidation = validateWorkItemSet(workItemSet, envelope)
  const routeValidation = verifyWorkflowRouteDecision(decision, {
    envelopeDigest: envelope.envelopeDigest,
    workItemDigest: decision.workItemDigest,
    routeRevision: decision.routeRevision,
    actualInstructionEnvelope: envelope,
    workItemSet
  })
  if (!ingressRef) errors.push('ingress-ref')
  if (!envelopeValidation.valid || envelope.instructionAuthority !== true) errors.push(...envelopeValidation.errors, 'instruction-authority')
  if (!workItemValidation.valid) errors.push(...workItemValidation.errors)
  if (!routeValidation.fresh || decision.decisionStatus !== 'selected') errors.push(...routeValidation.errors, 'route-decision')
  if (workItemSet.envelopeId !== envelope.envelopeId || workItemSet.envelopeDigest !== envelope.envelopeDigest ||
      decision.envelopeId !== envelope.envelopeId || decision.envelopeDigest !== envelope.envelopeDigest) errors.push('ingress-binding')
  if (sticky.schemaVersion !== 'ProjectTargetLeaseV2' || sticky.project !== state.activeProject ||
      sticky.contextEpoch !== envelope.contextEpoch || sticky.routeRevision !== decision.routeRevision ||
      !/^[a-f0-9]{64}$/.test(String(sticky.leaseDigest || '')) ||
      !/^[a-f0-9]{64}$/.test(String(sticky.rootIdentityDigest || ''))) errors.push('project-lease-binding')
  const nowMs = nowMsFrom(options)
  if (!Number.isFinite(Date.parse(String(envelope.expiresAt || ''))) || Date.parse(envelope.expiresAt) <= nowMs) errors.push('envelope-expired')
  if (state.workflowIngressRecovery) {
    const recoveryValidation = validateTasklessWorkflowIngressRecovery(state, options)
    if (!recoveryValidation.valid || recoveryValidation.authority !== true) {
      errors.push(recoveryValidation.errorCode || 'workflow-ingress-recovery')
    }
  }
  return { valid: errors.length === 0, errors, ingressRef }
}

function admissionIngressSnapshotPaths(metaDir, snapshotKey) {
  const root = path.join(path.resolve(metaDir), 'admission-ingress')
  return {
    root,
    snapshot: path.join(root, `${snapshotKey}.json`),
    latest: path.join(root, 'latest.json')
  }
}

function writeAdmissionIngressSnapshot(input = {}, options = {}) {
  const fsImpl = options.fs || fs
  const state = input.state || input
  const validation = validateAdmissionIngressState(state, options)
  if (!validation.valid) {
    const hasCompleteIngress = Boolean(
      state.actualInstructionEnvelope && state.workItemSet && state.workflowRouteDecision && state.stickyProject?.project
    )
    const expired = validation.errors.some(error => error === 'envelope-expired' || /_EXPIRED$/u.test(String(error)))
    if (expired) return { status: 'skipped', reasonCode: 'admission-ingress-expired' }
    return hasCompleteIngress
      ? { status: 'error', errorCode: 'ADMISSION_INGRESS_SNAPSHOT_INPUT_INVALID', errors: validation.errors }
      : { status: 'skipped', reasonCode: 'admission-ingress-unavailable' }
  }
  const ingressRef = validation.ingressRef
  const snapshotKey = admissionIngressSnapshotKey(ingressRef)
  const core = {
    schemaVersion: ADMISSION_INGRESS_SNAPSHOT_SCHEMA,
    snapshotKey,
    ingressRef,
    project: state.activeProject,
    activeRoot: state.stickyProject.activeRoot,
    projectRootIdentityDigest: state.stickyProject.rootIdentityDigest,
    actualInstructionEnvelope: cloneRecoveryValue(state.actualInstructionEnvelope),
    workItemSet: cloneRecoveryValue(state.workItemSet),
    workflowRouteDecision: cloneRecoveryValue(state.workflowRouteDecision),
    projectTargetLease: cloneRecoveryValue(state.stickyProject),
    issuedAt: state.actualInstructionEnvelope.issuedAt,
    expiresAt: state.actualInstructionEnvelope.expiresAt
  }
  let snapshot = { ...core, snapshotDigest: digestValue(core) }
  let serializedBytes = jsonBytes(snapshot)
  if (serializedBytes > ADMISSION_INGRESS_SNAPSHOT_MAX_BYTES) {
    return {
      status: 'error',
      errorCode: 'ADMISSION_INGRESS_SNAPSHOT_TOO_LARGE',
      bytes: serializedBytes,
      maxBytes: ADMISSION_INGRESS_SNAPSHOT_MAX_BYTES
    }
  }
  const paths = admissionIngressSnapshotPaths(input.metaDir, snapshotKey)
  fsImpl.mkdirSync(paths.root, { recursive: true })
  const existing = readJson(paths.snapshot, fsImpl, ADMISSION_INGRESS_SNAPSHOT_MAX_BYTES)
  let status = 'persisted'
  if (existing.status === 'fresh') {
    const existingSnapshot = existing.value || {}
    const { snapshotDigest: existingDigest, ...existingCore } = existingSnapshot
    const sameImmutableBinding = existingSnapshot.schemaVersion === ADMISSION_INGRESS_SNAPSHOT_SCHEMA &&
      existingDigest === digestValue(existingCore) &&
      existingSnapshot.snapshotKey === snapshotKey &&
      existingSnapshot.project === snapshot.project &&
      recoveryComparablePath(existingSnapshot.activeRoot) === recoveryComparablePath(snapshot.activeRoot) &&
      existingSnapshot.projectRootIdentityDigest === snapshot.projectRootIdentityDigest &&
      existingSnapshot.actualInstructionEnvelope?.envelopeDigest === snapshot.actualInstructionEnvelope.envelopeDigest &&
      existingSnapshot.workItemSet?.setDigest === snapshot.workItemSet.setDigest &&
      existingSnapshot.workflowRouteDecision?.decisionDigest === snapshot.workflowRouteDecision.decisionDigest
    if (!sameImmutableBinding) {
      return { status: 'error', errorCode: 'ADMISSION_INGRESS_SNAPSHOT_CONFLICT', snapshotKey }
    }
    snapshot = existingSnapshot
    serializedBytes = jsonBytes(snapshot)
    status = 'semantic-noop'
  } else if (existing.status !== 'missing') {
    return { status: 'error', errorCode: 'ADMISSION_INGRESS_SNAPSHOT_EXISTING_INVALID', snapshotKey }
  } else {
    try {
      writeFixedJsonSlot(paths.snapshot, `${paths.snapshot}.${process.pid}.tmp`, snapshot, fsImpl)
    } catch (error) {
      return { status: 'error', errorCode: error.code || 'ADMISSION_INGRESS_SNAPSHOT_WRITE_FAILED', message: error.message }
    }
  }
  const ref = {
    ...ingressRef,
    schemaVersion: ADMISSION_INGRESS_SNAPSHOT_REF_SCHEMA,
    snapshotKey,
    snapshotDigest: snapshot.snapshotDigest
  }
  const latest = { ...ref, project: snapshot.project, activeRoot: snapshot.activeRoot, expiresAt: snapshot.expiresAt }
  const latestWrite = writeStableProjection(paths.latest, latest, { fs: fsImpl })
  if (latestWrite.status !== 'persisted') {
    return { status: 'error', errorCode: latestWrite.errorCode || 'ADMISSION_INGRESS_LATEST_WRITE_FAILED', message: latestWrite.message }
  }
  return { status, ref, snapshotDigest: snapshot.snapshotDigest, bytes: serializedBytes }
}

function readAdmissionIngressSnapshot(input = {}, options = {}) {
  const fsImpl = options.fs || fs
  const ingressRef = input.ingressRef || {}
  const snapshotKey = admissionIngressSnapshotKey(ingressRef)
  const paths = admissionIngressSnapshotPaths(input.metaDir, snapshotKey)
  const read = readJson(paths.snapshot, fsImpl, ADMISSION_INGRESS_SNAPSHOT_MAX_BYTES)
  if (read.status !== 'fresh') {
    return { status: read.status, errorCode: read.status === 'missing' ? 'ADMISSION_INGRESS_SNAPSHOT_MISSING' : 'ADMISSION_INGRESS_SNAPSHOT_INVALID' }
  }
  const snapshot = read.value || {}
  const { snapshotDigest, ...core } = snapshot
  const refMatches = snapshot.snapshotKey === snapshotKey &&
    snapshot.ingressRef?.envelopeId === ingressRef.envelopeId &&
    snapshot.ingressRef?.envelopeDigest === ingressRef.envelopeDigest &&
    snapshot.ingressRef?.decisionDigest === ingressRef.decisionDigest &&
    snapshot.ingressRef?.routeRevision === ingressRef.routeRevision
  if (snapshot.schemaVersion !== ADMISSION_INGRESS_SNAPSHOT_SCHEMA || !refMatches ||
      !/^[a-f0-9]{64}$/.test(String(snapshotDigest || '')) || snapshotDigest !== digestValue(core)) {
    return { status: 'invalid', errorCode: 'ADMISSION_INGRESS_SNAPSHOT_DIGEST_MISMATCH' }
  }
  if (input.project && snapshot.project !== input.project) {
    return { status: 'identity-mismatch', errorCode: 'ADMISSION_INGRESS_SNAPSHOT_PROJECT_MISMATCH' }
  }
  if (input.activeRoot && recoveryComparablePath(snapshot.activeRoot) !== recoveryComparablePath(input.activeRoot)) {
    return { status: 'identity-mismatch', errorCode: 'ADMISSION_INGRESS_SNAPSHOT_ROOT_MISMATCH' }
  }
  const state = {
    activeProject: snapshot.project,
    activeScope: 'project',
    actualInstructionEnvelope: snapshot.actualInstructionEnvelope,
    workItemSet: snapshot.workItemSet,
    workflowRouteDecision: snapshot.workflowRouteDecision,
    workflowRoutePlanBinding: null,
    workflowIngressRecovery: null,
    stickyProject: snapshot.projectTargetLease
  }
  const validation = validateAdmissionIngressState(state, options)
  if (!validation.valid) {
    return {
      status: validation.errors.includes('envelope-expired') ? 'expired' : 'invalid',
      errorCode: validation.errors.includes('envelope-expired')
        ? 'ADMISSION_INGRESS_SNAPSHOT_EXPIRED'
        : 'ADMISSION_INGRESS_SNAPSHOT_AUTHORITY_INVALID',
      errors: validation.errors
    }
  }
  return {
    status: 'fresh',
    snapshot,
    ref: {
      ...snapshot.ingressRef,
      schemaVersion: ADMISSION_INGRESS_SNAPSHOT_REF_SCHEMA,
      snapshotKey,
      snapshotDigest
    },
    state
  }
}

function admissionContinuationLeaseDigest(lease = {}) {
  const value = cloneRecoveryValue(lease || {})
  delete value.leaseDigest
  return digestValue(value)
}

function validateAdmissionContinuationLease(lease, transaction = null) {
  const errors = []
  if (!lease || typeof lease !== 'object' || Array.isArray(lease)) return { valid: false, errors: ['lease-object-required'] }
  if (lease.schemaVersion !== ADMISSION_CONTINUATION_LEASE_SCHEMA) errors.push('schema-version')
  if (!['active', 'consumed'].includes(lease.status)) errors.push('status')
  if (!/^admission-continuation-[a-f0-9]{40}$/.test(String(lease.leaseId || ''))) errors.push('lease-id')
  for (const field of ['projectRootIdentityDigest', 'sessionDigest', 'actualInstructionDigest', 'workItemDigest', 'routeRevision', 'snapshotKey', 'snapshotDigest']) {
    if (!/^[a-f0-9]{64}$/.test(String(lease[field] || ''))) errors.push(field)
  }
  if (!/^admission-[a-f0-9]{40}$/.test(String(lease.admissionId || ''))) errors.push('admission-id')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(lease.taskId || ''))) errors.push('task-id')
  if (!String(lease.project || '').trim() || !String(lease.contextEpoch || '').trim()) errors.push('project-context')
  const issuedAtMs = Date.parse(String(lease.issuedAt || ''))
  const expiresAtMs = Date.parse(String(lease.expiresAt || ''))
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) errors.push('timestamps')
  if (lease.status === 'active' && (lease.consumedAt !== null || lease.ownerLeaseDigest !== null)) errors.push('active-consumption')
  if (lease.status === 'consumed' &&
      (!Number.isFinite(Date.parse(String(lease.consumedAt || ''))) || !/^[a-f0-9]{64}$/.test(String(lease.ownerLeaseDigest || '')))) {
    errors.push('consumed-binding')
  }
  if (!/^[a-f0-9]{64}$/.test(String(lease.leaseDigest || '')) || lease.leaseDigest !== admissionContinuationLeaseDigest(lease)) errors.push('lease-digest')
  if (transaction) {
    const bindings = [
      [lease.admissionId, transaction.admissionId],
      [lease.taskId, transaction.taskId],
      [lease.project, transaction.project],
      [lease.projectRootIdentityDigest, transaction.projectRootIdentityDigest],
      [lease.sessionDigest, transaction.sessionDigest],
      [lease.actualInstructionDigest, transaction.actualInstructionDigest],
      [lease.workItemDigest, transaction.workItemDigest],
      [lease.routeRevision, transaction.routeRevision]
    ]
    if (bindings.some(([expected, observed]) => expected !== observed)) errors.push('transaction-binding')
    if (['owner-fenced', 'finalized', 'terminal-closeout'].includes(transaction.phase) && lease.status !== 'consumed') errors.push('phase-consumption')
  }
  return { valid: errors.length === 0, errors }
}

function recoveryComparablePath(value) {
  const normalized = path.normalize(String(value || ''))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function recoveryPathInside(child, parent) {
  const candidate = recoveryComparablePath(child)
  const root = recoveryComparablePath(parent)
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function compactRecoveryDigest(value) {
  const text = String(value || '')
  return /^[a-f0-9]{64}$/i.test(text)
    ? `~${Buffer.from(text, 'hex').toString('base64').replace(/=+$/u, '')}`
    : (value ?? null)
}

function materializeRecoveryDigest(value) {
  const text = String(value || '')
  if (!/^~[A-Za-z0-9+/]{43}$/u.test(text)) return value ?? null
  return Buffer.from(`${text.slice(1)}=`, 'base64').toString('hex')
}

function simpleRiskMask(value = {}) {
  return [
    'crossModule',
    'sharedContract',
    'publicApiOrSchema',
    'securitySensitive',
    'dependencyChange',
    'releaseImpact'
  ].reduce((mask, field, index) => value[field] === true ? mask | (1 << index) : mask, 0)
}

function materializeSimpleRiskAssessment(changeClass, mask) {
  const value = { changeClass: String(changeClass || '') }
  for (const [index, field] of [
    'crossModule',
    'sharedContract',
    'publicApiOrSchema',
    'securitySensitive',
    'dependencyChange',
    'releaseImpact'
  ].entries()) value[field] = (Number(mask) & (1 << index)) !== 0
  return value
}

function buildMutationOwnerAuthorityRecovery(state, mutationLease) {
  if (!['simple-task-fast-path', 'workflow-operational'].includes(mutationLease?.ownerKind)) return null
  const sticky = state?.stickyProject || {}
  const context = state?.contextAcquisition || {}
  const route = state?.workflowRouteDecision || {}
  const planBinding = state?.workflowRoutePlanBinding || {}
  const binding = [
    String(state?.activeProject || ''),
    String(route.topIntent || ''),
    String(route.subtype || ''),
    String(sticky.schemaVersion || ''),
    compactRecoveryDigest(sticky.targetDigest),
    compactRecoveryDigest(sticky.rootIdentityDigest),
    compactRecoveryDigest(sticky.layoutIdentity),
    String(sticky.authorityKind || ''),
    compactRecoveryDigest(sticky.authorityDigest),
    String(sticky.contextEpoch || ''),
    compactRecoveryDigest(sticky.contextBindingDigest),
    compactRecoveryDigest(sticky.routeRevision),
    Number(sticky.revocationEpoch) || 0,
    Number(sticky.issuedAtMs) || 0,
    Number(sticky.expiresAtMs) || 0,
    compactRecoveryDigest(sticky.leaseDigest),
    String(sticky.source || ''),
    String(context.hostSessionId || ''),
    compactRecoveryDigest(planBinding.bindingDigest)
  ]
  if (mutationLease.ownerKind === 'simple-task-fast-path') {
    const lease = state?.simpleTaskFastPathLease
    const usage = state?.simpleTaskFastPathUsage
    if (lease?.schemaVersion !== 'SimpleTaskFastPathLeaseV1' || usage?.schemaVersion !== 'SimpleTaskFastPathUsageV1' ||
        lease.leaseDigest !== mutationLease.ownerLeaseDigest || usage.leaseDigest !== lease.leaseDigest) {
      throw new TaskRecoveryStoreV5Error(
        'LIFECYCLE_PREFLIGHT_SIMPLE_AUTHORITY_INCOMPLETE',
        'simple-task mutation preflight requires the exact active lease and usage state'
      )
    }
    return {
      v: 1,
      binding,
      lease: [
        's', lease.leaseId, lease.project,
        compactRecoveryDigest(lease.projectRootIdentityDigest),
        compactRecoveryDigest(lease.projectTargetLeaseDigest),
        compactRecoveryDigest(lease.sessionDigest),
        lease.turnKey, lease.contextEpoch,
        compactRecoveryDigest(lease.instructionEnvelopeDigest),
        compactRecoveryDigest(lease.actualInstructionDigest),
        compactRecoveryDigest(lease.routeDecisionDigest),
        compactRecoveryDigest(lease.routeRevision),
        lease.routeKey, lease.operation, lease.relativeTargets,
        compactRecoveryDigest(lease.targetSetDigest),
        lease.slotId, lease.moduleBoundary,
        [lease.riskAssessment?.changeClass || '', simpleRiskMask(lease.riskAssessment)],
        compactRecoveryDigest(lease.riskEvidenceDigest),
        // Recovered from the enclosing TaskOwnedMutationLeaseV2 projection.
        null,
        lease.issuedAt, lease.expiresAt,
        // ownerLeaseDigest in the enclosing lease is this exact digest.
      ],
      usage: [
        // Both digests are carried by the enclosing simple-task lease.
        null,
        null,
        usage.maxUses, usage.useCount, usage.operationIds,
        (usage.observedTargetSetDigests || []).map(compactRecoveryDigest),
        usage.status, usage.updatedAt
      ]
    }
  }
  const lease = state?.workflowOperationalWriteLease
  if (lease?.schemaVersion !== 'WorkflowOperationalWriteLeaseV1' ||
      lease.leaseDigest !== mutationLease.ownerLeaseDigest) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_PREFLIGHT_OPERATIONAL_AUTHORITY_INCOMPLETE',
      'workflow-operational mutation preflight requires the exact active lease'
    )
  }
  return {
    v: 1,
    binding,
    lease: [
      'o', lease.leaseId, lease.project,
      compactRecoveryDigest(lease.activeRootIdentityDigest),
      compactRecoveryDigest(lease.projectRootIdentityDigest),
      compactRecoveryDigest(lease.projectTargetLeaseDigest),
      compactRecoveryDigest(lease.sessionDigest),
      lease.turnKey, lease.contextEpoch,
      compactRecoveryDigest(lease.instructionEnvelopeDigest),
      compactRecoveryDigest(lease.routeDecisionDigest),
      compactRecoveryDigest(lease.routeRevision),
      lease.taskId, lease.operation, lease.relativeTargets,
      compactRecoveryDigest(lease.targetSetDigest),
      lease.slotId, lease.authorityRole,
      // Recovered from the enclosing TaskOwnedMutationLeaseV2 projection.
      null,
      lease.issuedAt, lease.expiresAt,
      // ownerLeaseDigest in the enclosing lease is this exact digest.
    ]
  }
}

function materializeMutationOwnerAuthorityRecovery(value, roots, mutationLease = null) {
  if (!((value?.schemaVersion === 'MutationOwnerAuthorityRecoveryV1') || value?.v === 1) ||
      !Array.isArray(value.binding) || !Array.isArray(value.lease) || !Array.isArray(roots)) return null
  const binding = value.binding
  const leaseValues = value.lease
  const kind = leaseValues[0]
  if (!['s', 'o'].includes(kind)) return null
  const stickyProject = {
    schemaVersion: binding[3],
    targetDigest: materializeRecoveryDigest(binding[4]),
    rootIdentityDigest: materializeRecoveryDigest(binding[5]),
    layoutIdentity: materializeRecoveryDigest(binding[6]),
    project: binding[0],
    physicalRoot: roots[1],
    activeRoot: roots[0],
    authorityKind: binding[7],
    authorityDigest: materializeRecoveryDigest(binding[8]),
    contextEpoch: binding[9],
    contextBindingDigest: materializeRecoveryDigest(binding[10]),
    routeRevision: materializeRecoveryDigest(binding[11]),
    revocationEpoch: binding[12],
    issuedAtMs: binding[13],
    expiresAtMs: binding[14],
    leaseDigest: materializeRecoveryDigest(binding[15]),
    source: binding[16]
  }
  stickyProject.leaseId = `project-target-lease-${String(stickyProject.leaseDigest || '').slice(0, 24)}`
  const common = {
    activeProject: binding[0],
    activeScope: 'project',
    stickyProject,
    contextAcquisition: {
      contextEpoch: stickyProject.contextEpoch,
      activeRoot: roots[0],
      project: binding[0],
      targetResolved: true,
      hostSessionId: binding[17]
    },
    workflowRoutePlanBinding: {
      bindingDigest: materializeRecoveryDigest(binding[18]),
      routeRevision: stickyProject.routeRevision
    }
  }
  if (kind === 's') {
    const riskAssessment = materializeSimpleRiskAssessment(leaseValues[18]?.[0], leaseValues[18]?.[1])
    const lease = {
      schemaVersion: 'SimpleTaskFastPathLeaseV1',
      leaseId: leaseValues[1],
      project: leaseValues[2],
      projectRootIdentityDigest: materializeRecoveryDigest(leaseValues[3]),
      projectTargetLeaseDigest: materializeRecoveryDigest(leaseValues[4]),
      sessionDigest: materializeRecoveryDigest(leaseValues[5]),
      turnKey: leaseValues[6],
      contextEpoch: leaseValues[7],
      instructionEnvelopeDigest: materializeRecoveryDigest(leaseValues[8]),
      actualInstructionDigest: materializeRecoveryDigest(leaseValues[9]),
      routeDecisionDigest: materializeRecoveryDigest(leaseValues[10]),
      routeRevision: materializeRecoveryDigest(leaseValues[11]),
      routeKey: leaseValues[12],
      operation: leaseValues[13],
      relativeTargets: leaseValues[14],
      targetSetDigest: materializeRecoveryDigest(leaseValues[15]),
      slotId: leaseValues[16],
      moduleBoundary: leaseValues[17],
      riskAssessment,
      riskEvidenceDigest: materializeRecoveryDigest(leaseValues[19]),
      mergedRegistryDigest: leaseValues[20]
        ? materializeRecoveryDigest(leaseValues[20])
        : mutationLease?.mergedRegistryDigest,
      maxTargets: 2,
      maxUses: 2,
      issuedAt: leaseValues[21],
      expiresAt: leaseValues[22],
      status: 'active',
      mutationAuthority: true,
      productMutationAuthority: true,
      formalArtifactAuthority: false,
      controlPlaneAuthority: false,
      releaseAuthority: false,
      leaseDigest: leaseValues[23]
        ? materializeRecoveryDigest(leaseValues[23])
        : mutationLease?.ownerLeaseDigest
    }
    const usageValues = value.usage || []
    const usageSemantic = {
      schemaVersion: 'SimpleTaskFastPathUsageV1',
      leaseDigest: usageValues[0] ? materializeRecoveryDigest(usageValues[0]) : lease.leaseDigest,
      targetSetDigest: usageValues[1] ? materializeRecoveryDigest(usageValues[1]) : lease.targetSetDigest,
      maxUses: usageValues[2],
      useCount: usageValues[3],
      operationIds: usageValues[4] || [],
      observedTargetSetDigests: (usageValues[5] || []).map(materializeRecoveryDigest),
      status: usageValues[6],
      updatedAt: usageValues[7]
    }
    const usage = {
      ...usageSemantic,
      usageDigest: usageValues[8]
        ? materializeRecoveryDigest(usageValues[8])
        : digestValue(usageSemantic)
    }
    return {
      ...common,
      actualInstructionEnvelope: {
        contextEpoch: lease.contextEpoch,
        envelopeDigest: lease.instructionEnvelopeDigest,
        actualInstructionDigest: lease.actualInstructionDigest,
        instructionAuthority: true
      },
      workflowRouteDecision: {
        decisionDigest: lease.routeDecisionDigest,
        routeRevision: lease.routeRevision,
        routeKey: lease.routeKey,
        topIntent: binding[1],
        subtype: binding[2]
      },
      turnLiveness: { turnKey: lease.turnKey },
      simpleTaskFastPathLease: lease,
      simpleTaskFastPathUsage: usage
    }
  }
  const lease = {
    schemaVersion: 'WorkflowOperationalWriteLeaseV1',
    leaseId: leaseValues[1],
    project: leaseValues[2],
    activeRootIdentityDigest: materializeRecoveryDigest(leaseValues[3]),
    projectRootIdentityDigest: materializeRecoveryDigest(leaseValues[4]),
    projectTargetLeaseDigest: materializeRecoveryDigest(leaseValues[5]),
    sessionDigest: materializeRecoveryDigest(leaseValues[6]),
    turnKey: leaseValues[7],
    contextEpoch: leaseValues[8],
    instructionEnvelopeDigest: materializeRecoveryDigest(leaseValues[9]),
    routeDecisionDigest: materializeRecoveryDigest(leaseValues[10]),
    routeRevision: materializeRecoveryDigest(leaseValues[11]),
    taskId: leaseValues[12],
    operation: leaseValues[13],
    relativeTargets: leaseValues[14],
    targetSetDigest: materializeRecoveryDigest(leaseValues[15]),
    slotId: leaseValues[16],
    authorityRole: leaseValues[17],
    mergedRegistryDigest: leaseValues[18]
      ? materializeRecoveryDigest(leaseValues[18])
      : mutationLease?.mergedRegistryDigest,
    issuedAt: leaseValues[19],
    expiresAt: leaseValues[20],
    singleUse: true,
    status: 'active',
    mutationAuthority: true,
    productMutationAuthority: false,
    formalArtifactAuthority: false,
    releaseAuthority: false,
    leaseDigest: leaseValues[21]
      ? materializeRecoveryDigest(leaseValues[21])
      : mutationLease?.ownerLeaseDigest
  }
  return {
    ...common,
    actualInstructionEnvelope: {
      contextEpoch: lease.contextEpoch,
      envelopeDigest: lease.instructionEnvelopeDigest,
      instructionAuthority: true
    },
    workflowRouteDecision: {
      decisionDigest: lease.routeDecisionDigest,
      routeRevision: lease.routeRevision,
      topIntent: binding[1],
      subtype: binding[2]
    },
    turnLiveness: { turnKey: lease.turnKey },
    workflowOperationalWriteLease: lease
  }
}

function buildMutationRecoveryPreflightV2(decision, lease, footprint, preObservation, ownerAuthority = null) {
  const roots = [
    boundedRecoveryString(decision.activeRootIdentity?.canonicalPath, 1024),
    boundedRecoveryString(decision.projectRootIdentity?.canonicalPath, 1024)
  ]
  if (roots.some(root => !root)) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_PREFLIGHT_ROOT_IDENTITY_INCOMPLETE',
      'mutation preflight requires canonical active and project roots'
    )
  }
  const pathTable = []
  const pathIndex = new Map()
  const encodePath = raw => {
    const target = String(raw || '')
    const logical = /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\/]/i.test(target)
    let encoded
    if (logical) {
      encoded = [-1, boundedRecoveryString(target, 1024)]
    } else {
      const absolute = path.resolve(target)
      const rootIndex = roots.findIndex(root => recoveryPathInside(absolute, root))
      if (rootIndex < 0) {
        throw new TaskRecoveryStoreV5Error(
          'LIFECYCLE_PREFLIGHT_PATH_OUTSIDE_ROOTS',
          `mutation preflight path is outside the decision roots: ${target}`
        )
      }
      encoded = [rootIndex, boundedRecoveryString(path.relative(roots[rootIndex], absolute).replace(/\\/g, '/'), 1024)]
    }
    const key = `${encoded[0]}:${process.platform === 'win32' ? encoded[1].toLowerCase() : encoded[1]}`
    if (!pathIndex.has(key)) {
      pathIndex.set(key, pathTable.length)
      pathTable.push(encoded)
    }
    return pathIndex.get(key)
  }
  const encodePaths = values => (values || []).map(encodePath)
  const record = {
    schemaVersion: 'TaskRecoveryMutationPreflightV2',
    roots,
    pathTable,
    decision: [
      decision.schemaVersion,
      compactRecoveryDigest(decision.targetSetDigest),
      compactRecoveryDigest(decision.footprintDigest),
      compactRecoveryDigest(decision.baseRegistryDigest),
      compactRecoveryDigest(decision.overlayDigest),
      compactRecoveryDigest(decision.activeRootIdentity?.digest),
      compactRecoveryDigest(decision.projectRootIdentity?.digest),
      decision.decisionStatus,
      decision.expiresAt,
      decision.singleUse === true,
      decision.status,
      compactRecoveryDigest(decision.decisionDigest)
    ],
    lease: [
      lease.schemaVersion,
      lease.operationId,
      lease.project,
      lease.taskId,
      lease.ownerKind,
      lease.ownerGeneration,
      compactRecoveryDigest(lease.ownerLeaseDigest),
      lease.contextEpoch,
      compactRecoveryDigest(lease.routeRevision),
      compactRecoveryDigest(lease.adapterDigest),
      compactRecoveryDigest(lease.mergedRegistryDigest),
      compactRecoveryDigest(lease.slotDecisionDigest),
      compactRecoveryDigest(lease.plannedSetDigest),
      compactRecoveryDigest(lease.nonce),
      lease.issuedAt,
      lease.expiresAt,
      lease.singleUse === true,
      lease.status,
      compactRecoveryDigest(lease.leaseDigest)
    ],
    footprint: {
      schemaVersion: footprint.schemaVersion,
      sourceSchemaVersion: footprint.sourceSchemaVersion || null,
      operation: footprint.operation,
      plannedCreates: encodePaths(footprint.plannedCreates),
      plannedModifies: encodePaths(footprint.plannedModifies),
      plannedDeletes: encodePaths(footprint.plannedDeletes),
      plannedMoves: (footprint.plannedMoves || []).map(item => [encodePath(item.source), encodePath(item.target)]),
      sourceTargets: encodePaths(footprint.sourceTargets),
      normalizedTargets: footprint.observationPlan?.targetGranularity === 'controlled-root'
        ? encodePaths(footprint.normalizedTargets)
        : [],
      observationPlan: footprint.observationPlan || null,
      coverage: footprint.coverage || null
    },
    preObservation: {
      schemaVersion: preObservation.schemaVersion,
      entries: (preObservation.entries || []).map(entry => [
        encodePath(entry.path),
        entry.exists === true,
        entry.kind,
        compactRecoveryDigest(entry.digest),
        Number.isFinite(entry.bytes) ? entry.bytes : 0,
        entry.complete === true,
        entry.errorCode || null
      ]),
      observationCoverage: preObservation.observationCoverage,
      errorCodes: preObservation.errorCodes || [],
      snapshotDigest: compactRecoveryDigest(preObservation.snapshotDigest),
      observedAt: preObservation.observedAt,
      receiptDigest: compactRecoveryDigest(preObservation.receiptDigest)
    },
    ...(ownerAuthority ? { ownerAuthority } : {})
  }
  return record
}

function materializeMutationRecoveryPreflightV2(record) {
  if (record?.schemaVersion !== 'TaskRecoveryMutationPreflightV2' ||
      !Array.isArray(record.roots) || !Array.isArray(record.pathTable) ||
      !Array.isArray(record.decision) || !Array.isArray(record.lease)) return null
  const decodePath = index => {
    const encoded = record.pathTable[index]
    if (!Array.isArray(encoded) || encoded.length !== 2) return ''
    if (encoded[0] === -1) return String(encoded[1] || '')
    const root = record.roots[encoded[0]]
    if (!root) return ''
    const target = path.resolve(root, ...String(encoded[1] || '').split('/'))
    return recoveryPathInside(target, root) ? target : ''
  }
  const decodePaths = values => (values || []).map(decodePath).filter(Boolean)
  const decisionValues = record.decision
  const leaseValues = record.lease
  const footprintValue = record.footprint || {}
  const preValue = record.preObservation || {}
  const plannedCreates = decodePaths(footprintValue.plannedCreates)
  const plannedModifies = decodePaths(footprintValue.plannedModifies)
  const plannedDeletes = decodePaths(footprintValue.plannedDeletes)
  const plannedMoves = (footprintValue.plannedMoves || []).map(item => ({
    source: decodePath(item?.[0]),
    target: decodePath(item?.[1])
  })).filter(item => item.source && item.target)
  const sourceTargets = decodePaths(footprintValue.sourceTargets)
  const explicitNormalizedTargets = decodePaths(footprintValue.normalizedTargets)
  const normalizedTargets = explicitNormalizedTargets.length
    ? explicitNormalizedTargets
    : [...new Map([
        ...plannedCreates,
        ...plannedModifies,
        ...plannedDeletes,
        ...plannedMoves.flatMap(item => [item.source, item.target])
      ].map(item => [recoveryComparablePath(item), item])).values()]
  const lease = {
    schemaVersion: leaseValues[0],
    operationId: leaseValues[1],
    project: leaseValues[2],
    taskId: leaseValues[3],
    ownerKind: leaseValues[4],
    ownerGeneration: leaseValues[5],
    ownerLeaseDigest: materializeRecoveryDigest(leaseValues[6]),
    contextEpoch: leaseValues[7],
    routeRevision: materializeRecoveryDigest(leaseValues[8]),
    adapterDigest: materializeRecoveryDigest(leaseValues[9]),
    mergedRegistryDigest: materializeRecoveryDigest(leaseValues[10]),
    slotDecisionDigest: materializeRecoveryDigest(leaseValues[11]),
    plannedSetDigest: materializeRecoveryDigest(leaseValues[12]),
    nonce: materializeRecoveryDigest(leaseValues[13]),
    issuedAt: leaseValues[14],
    expiresAt: leaseValues[15],
    singleUse: leaseValues[16] === true,
    status: leaseValues[17],
    leaseDigest: materializeRecoveryDigest(leaseValues[18])
  }
  const footprint = {
    schemaVersion: footprintValue.schemaVersion,
    sourceSchemaVersion: footprintValue.sourceSchemaVersion || null,
    footprintDigest: materializeRecoveryDigest(decisionValues[2]),
    adapterDigest: lease.adapterDigest,
    operation: footprintValue.operation,
    plannedCreates,
    plannedModifies,
    plannedDeletes,
    plannedMoves,
    sourceTargets,
    targetTargets: [],
    normalizedTargets,
    plannedSetDigest: lease.plannedSetDigest,
    observationPlan: footprintValue.observationPlan || null,
    coverage: footprintValue.coverage || null
  }
  const decision = {
    schemaVersion: decisionValues[0],
    projectionKind: 'digest-only',
    project: lease.project,
    taskRecoveryKey: lease.taskId || null,
    contextEpoch: lease.contextEpoch,
    operation: footprint.operation,
    targetSetDigest: materializeRecoveryDigest(decisionValues[1]),
    footprintDigest: materializeRecoveryDigest(decisionValues[2]),
    adapterDigest: lease.adapterDigest,
    plannedSetDigest: lease.plannedSetDigest,
    mergedRegistryDigest: lease.mergedRegistryDigest,
    ...(decisionValues[3] ? { baseRegistryDigest: materializeRecoveryDigest(decisionValues[3]) } : {}),
    ...(decisionValues[4] !== undefined ? { overlayDigest: materializeRecoveryDigest(decisionValues[4]) } : {}),
    activeRootIdentity: { canonicalPath: record.roots[0], digest: materializeRecoveryDigest(decisionValues[5]) },
    projectRootIdentity: { canonicalPath: record.roots[1], digest: materializeRecoveryDigest(decisionValues[6]) },
    decisionStatus: decisionValues[7],
    expiresAt: decisionValues[8],
    singleUse: decisionValues[9] === true,
    status: decisionValues[10],
    decisionDigest: materializeRecoveryDigest(decisionValues[11])
  }
  const preObservation = {
    schemaVersion: preValue.schemaVersion,
    operationId: lease.operationId,
    footprintDigest: decision.footprintDigest,
    plannedSetDigest: lease.plannedSetDigest,
    entries: (preValue.entries || []).map(entry => ({
      path: decodePath(entry?.[0]),
      exists: entry?.[1] === true,
      kind: entry?.[2],
      digest: materializeRecoveryDigest(entry?.[3]),
      bytes: Number.isFinite(entry?.[4]) ? entry[4] : 0,
      complete: entry?.[5] === true,
      ...(entry?.[6] ? { errorCode: entry[6] } : {})
    })).filter(entry => entry.path),
    observationCoverage: preValue.observationCoverage,
    errorCodes: preValue.errorCodes || [],
    snapshotDigest: materializeRecoveryDigest(preValue.snapshotDigest),
    observedAt: preValue.observedAt,
    receiptDigest: materializeRecoveryDigest(preValue.receiptDigest)
  }
  return {
    decision,
    lease,
    footprint,
    preObservation,
    ownerState: materializeMutationOwnerAuthorityRecovery(record.ownerAuthority, record.roots, lease)
  }
}

function applyMutationOwnerAuthorityRecovery(state, ownerState) {
  if (!ownerState) return state
  state.activeProject = ownerState.activeProject
  state.activeScope = ownerState.activeScope
  state.stickyProject = ownerState.stickyProject
  state.actualInstructionEnvelope = ownerState.actualInstructionEnvelope
  state.workflowRouteDecision = ownerState.workflowRouteDecision
  state.workflowRoutePlanBinding = ownerState.workflowRoutePlanBinding
  state.contextAcquisition = {
    ...(state.contextAcquisition || {}),
    ...(ownerState.contextAcquisition || {})
  }
  state.turnLiveness = {
    ...(state.turnLiveness || {}),
    turnKey: ownerState.turnLiveness?.turnKey || state.turnLiveness?.turnKey || ''
  }
  if (ownerState.simpleTaskFastPathLease) {
    state.simpleTaskFastPathLease = ownerState.simpleTaskFastPathLease
    state.simpleTaskFastPathUsage = ownerState.simpleTaskFastPathUsage
  }
  if (ownerState.workflowOperationalWriteLease) {
    state.workflowOperationalWriteLease = ownerState.workflowOperationalWriteLease
  }
  return state
}

function materializeEphemeralMutationState(raw) {
  const state = JSON.parse(JSON.stringify(raw || {}))
  delete state.dangerousApprovals
  delete state.dangerousApprovalRecovery
  const operation = state.turnLiveness?.inFlightOperation
  const recovered = materializeMutationRecoveryPreflightV2(operation?.mutationRecovery)
  if (!recovered) return state
  applyMutationOwnerAuthorityRecovery(state, recovered.ownerState)
  operation.operationId = operation.operationId || recovered.lease.operationId
  operation.startedAt = operation.startedAt || recovered.lease.issuedAt
  operation.artifactDecision = recovered.decision
  operation.mutationLease = recovered.lease
  operation.mutationFootprint = recovered.footprint
  operation.mutationPreObservation = recovered.preObservation
  delete operation.mutationRecovery
  return state
}

function buildMutationPreflightState(state) {
  const binding = state?.taskRecoveryBinding || {}
  const context = state?.contextAcquisition || {}
  const turn = state?.turnLiveness || {}
  const operation = turn.inFlightOperation || {}
  const artifactDecision = operation.artifactDecision && typeof operation.artifactDecision === 'object'
    ? operation.artifactDecision
    : null
  const mutationLease = operation.mutationLease && typeof operation.mutationLease === 'object'
    ? operation.mutationLease
    : null
  const mutationFootprint = operation.mutationFootprint && typeof operation.mutationFootprint === 'object'
    ? operation.mutationFootprint
    : null
  const mutationPreObservation = operation.mutationPreObservation && typeof operation.mutationPreObservation === 'object'
    ? operation.mutationPreObservation
    : null
  const v2Parts = [mutationLease, mutationFootprint, mutationPreObservation]
  const hasAnyV2Authority = v2Parts.some(Boolean)
  const hasV2Authority = !!artifactDecision && v2Parts.every(Boolean)
  if (hasAnyV2Authority && !hasV2Authority) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_PREFLIGHT_AUTHORITY_INCOMPLETE',
      'mutation preflight requires decision, lease, footprint projection and pre-observation together'
    )
  }
  if (hasV2Authority && (
    artifactDecision.schemaVersion !== 'ArtifactSlotDecisionV2' ||
    mutationLease.schemaVersion !== 'TaskOwnedMutationLeaseV2' ||
    mutationFootprint.schemaVersion !== 'MutationFootprintRecoveryProjectionV2' ||
    mutationPreObservation.schemaVersion !== 'MutationPreObservationV1'
  )) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_PREFLIGHT_AUTHORITY_SCHEMA_INVALID',
      'mutation preflight V2 authority schemas are invalid'
    )
  }
  const mutationRecovery = hasV2Authority
    ? buildMutationRecoveryPreflightV2(
        artifactDecision,
        mutationLease,
        mutationFootprint,
        mutationPreObservation,
        buildMutationOwnerAuthorityRecovery(state, mutationLease)
      )
    : null
  const cp3Runtime = {}
  const boundTaskRootInput = String(binding.taskRoot || '').trim()
  const boundTaskRoot = boundTaskRootInput ? path.normalize(boundTaskRootInput).toLowerCase() : ''
  const boundTaskRuntimeKey = boundTaskRoot
    ? `${String(binding.kind || '').trim()}:${boundTaskRoot}`
    : ''
  if (boundTaskRoot && state?.cp3Runtime && typeof state.cp3Runtime === 'object' && !Array.isArray(state.cp3Runtime)) {
    for (const [key, value] of Object.entries(state.cp3Runtime)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          String(key).toLowerCase() !== boundTaskRuntimeKey) continue
      cp3Runtime[key] = {
        kind: boundedRecoveryString(value.kind, 64),
        name: boundedRecoveryString(value.name, 128),
        trackedFiles: Array.isArray(value.trackedFiles)
          ? value.trackedFiles.slice(0, 5).map(item => boundedRecoveryString(item, 256))
          : [],
        trackedFileDigests: Array.isArray(value.trackedFileDigests)
          ? value.trackedFileDigests.slice(0, 5).map(item => boundedRecoveryString(item, 64))
          : [],
        triggered: value.triggered === true,
        triggerType: boundedRecoveryString(value.triggerType, 32),
        triggerReason: boundedRecoveryString(value.triggerReason, 256),
        triggerCount: Number.isInteger(value.triggerCount) ? value.triggerCount : 0,
        triggeredAt: boundedRecoveryString(value.triggeredAt, 64),
        updatedAt: boundedRecoveryString(value.updatedAt, 64)
      }
      break
    }
  }
  const preflight = {
    version: state?.version,
    ...(hasV2Authority ? {} : {
      mode: state?.mode,
      phase: state?.phase,
      activeProject: state?.activeProject,
      activeScope: state?.activeScope
    }),
    ...(hasV2Authority ? {} : {
      taskRecoveryBinding: {
          taskId: boundedRecoveryString(binding.taskId, 128),
          project: boundedRecoveryString(binding.project, 128),
          kind: boundedRecoveryString(binding.kind, 64),
          taskRoot: boundedRecoveryString(binding.taskRoot, 768),
          status: boundedRecoveryString(binding.status, 64),
          identityRevision: binding.identityRevision
        },
      contextAcquisition: {
          schemaVersion: context.schemaVersion,
          contextEpoch: boundedRecoveryString(context.contextEpoch, 256),
          activeRoot: boundedRecoveryString(context.activeRoot, 768),
          project: boundedRecoveryString(context.project, 128),
          targetResolved: context.targetResolved === true,
          hostSessionId: boundedRecoveryString(context.hostSessionId, 256)
        }
    }),
    ...(Object.keys(cp3Runtime).length ? { cp3Runtime } : {}),
    turnLiveness: {
      ...(hasV2Authority ? {} : { schemaVersion: turn.schemaVersion }),
      state: turn.state,
      ...(hasV2Authority ? {} : { turnKey: boundedRecoveryString(turn.turnKey, 256) }),
      inFlightOperation: {
        ...(hasV2Authority ? {} : { operationId: boundedRecoveryString(operation.operationId, 256) }),
        toolName: boundedRecoveryString(operation.toolName, 128),
        ...(hasV2Authority ? {} : { startedAt: operation.startedAt }),
        mutating: operation.mutating === true,
        targetPaths: hasV2Authority
          ? []
          : Array.isArray(operation.targetPaths)
          ? operation.targetPaths.slice(0, 4).map(item => boundedRecoveryString(item, 512))
          : [],
        artifactAuthorization: artifactDecision && !hasV2Authority
          ? {
              schemaVersion: 'ArtifactMutationPreflightV1',
              artifactDecisionDigest: boundedRecoveryString(artifactDecision.decisionDigest, 64),
              footprintDigest: boundedRecoveryString(artifactDecision.footprintDigest, 64),
              targetSetDigest: boundedRecoveryString(artifactDecision.targetSetDigest, 64),
              operation: boundedRecoveryString(artifactDecision.operation, 32),
              slotId: boundedRecoveryString(artifactDecision.slotId, 128),
              targetCount: Number.isInteger(artifactDecision.targetCount) ? artifactDecision.targetCount : 0,
              observability: boundedRecoveryString(artifactDecision.observability, 32),
              authoritySourceRef: boundedRecoveryString(artifactDecision.authoritySourceRef, 512),
              expiresAt: boundedRecoveryString(artifactDecision.expiresAt, 64),
              singleUse: artifactDecision.singleUse === true
            }
          : null,
        ...(hasV2Authority
          ? { mutationRecovery }
          : {
              artifactDecision: null,
              mutationLease: null,
              mutationFootprint: null,
              mutationPreObservation: null
            })
      }
    },
    recoveryKind: hasV2Authority ? 'mutation-preflight-v2' : 'mutation-preflight'
  }
  if (jsonBytes(preflight) > MUTATION_PREFLIGHT_STATE_MAX_BYTES) {
    if (!hasV2Authority) {
      preflight.taskRecoveryBinding.taskRoot = ''
      preflight.contextAcquisition.activeRoot = ''
      preflight.contextAcquisition.hostSessionId = ''
      preflight.turnLiveness.turnKey = ''
    }
    preflight.turnLiveness.inFlightOperation.targetPaths = []
  }
  const bytes = jsonBytes(preflight)
  if (bytes > MUTATION_PREFLIGHT_STATE_MAX_BYTES) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_PREFLIGHT_PAYLOAD_EXCEEDED',
      `mutation preflight recovery record exceeds 4 KiB (${bytes}/${MUTATION_PREFLIGHT_STATE_MAX_BYTES} bytes)`,
      { bytes, maxBytes: MUTATION_PREFLIGHT_STATE_MAX_BYTES }
    )
  }
  return { state: JSON.parse(JSON.stringify(preflight)), bytes }
}

function materializeRecoveryState(read) {
  const current = read?.current?.envelope
  if (!current) return null
  if (current.recordType !== 'mutation-preflight') return current.state
  const previous = read.previous?.envelope
  if (!previous || previous.sequence !== current.baseSequence ||
      !sameIdentity(previous.identity, current.identity)) {
    return materializeEphemeralMutationState(current.state)
  }
  const previousState = JSON.parse(JSON.stringify(previous.state || {}))
  const currentState = JSON.parse(JSON.stringify(current.state || {}))
  const materialized = {
    ...previousState,
    ...currentState,
    cp3Runtime: {
      ...(previousState.cp3Runtime || {}),
      ...(currentState.cp3Runtime || {})
    },
    taskRecoveryBinding: {
      ...(previousState.taskRecoveryBinding || {}),
      ...(currentState.taskRecoveryBinding || {})
    },
    contextAcquisition: {
      ...(previousState.contextAcquisition || {}),
      ...(currentState.contextAcquisition || {})
    },
    turnLiveness: {
      ...(previousState.turnLiveness || {}),
      ...(currentState.turnLiveness || {})
    }
  }
  const operation = materialized.turnLiveness?.inFlightOperation
  const recoveredAuthority = materializeMutationRecoveryPreflightV2(operation?.mutationRecovery)
  if (recoveredAuthority) {
    applyMutationOwnerAuthorityRecovery(materialized, recoveredAuthority.ownerState)
    operation.operationId = operation.operationId || recoveredAuthority.lease.operationId
    operation.startedAt = operation.startedAt || recoveredAuthority.lease.issuedAt
    operation.artifactDecision = recoveredAuthority.decision
    operation.mutationLease = recoveredAuthority.lease
    operation.mutationFootprint = recoveredAuthority.footprint
    operation.mutationPreObservation = recoveredAuthority.preObservation
    delete operation.mutationRecovery
  }
  if (operation?.artifactDecision?.schemaVersion === 'ArtifactSlotDecisionV2' &&
      operation?.mutationLease?.schemaVersion === 'TaskOwnedMutationLeaseV2' &&
      operation?.mutationFootprint?.schemaVersion === 'MutationFootprintRecoveryProjectionV2' &&
      operation?.mutationPreObservation?.schemaVersion === 'MutationPreObservationV1') {
    const lease = operation.mutationLease || {}
    operation.artifactDecision = {
      ...(operation.artifactDecision || {}),
      project: operation.artifactDecision?.project || lease.project || '',
      taskRecoveryKey: operation.artifactDecision?.taskRecoveryKey || lease.taskId || null,
      contextEpoch: operation.artifactDecision?.contextEpoch || lease.contextEpoch || '',
      operation: operation.artifactDecision?.operation || operation.mutationFootprint?.operation || 'unknown',
      adapterDigest: operation.artifactDecision?.adapterDigest || lease.adapterDigest || null,
      plannedSetDigest: operation.artifactDecision?.plannedSetDigest || lease.plannedSetDigest || null,
      mergedRegistryDigest: operation.artifactDecision?.mergedRegistryDigest || lease.mergedRegistryDigest || null
    }
    operation.mutationFootprint = {
      ...(operation.mutationFootprint || {}),
      footprintDigest: operation.mutationFootprint?.footprintDigest || operation.artifactDecision.footprintDigest || null,
      adapterDigest: operation.mutationFootprint?.adapterDigest || lease.adapterDigest || null,
      plannedSetDigest: operation.mutationFootprint?.plannedSetDigest || lease.plannedSetDigest || null
    }
  }
  return materialized
}

function slotFingerprint(paths, fsImpl = fs) {
  return paths.slots.map(file => {
    try {
      const stats = fsImpl.statSync(file)
      return `${stats.size}:${stats.mtimeMs}`
    } catch {
      return '-'
    }
  }).join('|')
}

function cacheKey(metaDir, recoveryKey) {
  return `${portableRoot(metaDir)}:${recoveryKey}`
}

function rememberSemanticState(metaDir, currentPaths, semanticDigest, sequence, fsImpl = fs) {
  const key = cacheKey(metaDir, path.basename(currentPaths.dir))
  semanticCache.delete(key)
  semanticCache.set(key, { semanticDigest, sequence, fingerprint: slotFingerprint(currentPaths, fsImpl) })
  while (semanticCache.size > SEMANTIC_CACHE_MAX_ENTRIES) semanticCache.delete(semanticCache.keys().next().value)
}

function cachedSemanticNoop(metaDir, currentPaths, semanticDigest, fsImpl = fs) {
  const key = cacheKey(metaDir, path.basename(currentPaths.dir))
  const cached = semanticCache.get(key)
  if (!cached || cached.semanticDigest !== semanticDigest || cached.fingerprint !== slotFingerprint(currentPaths, fsImpl)) return null
  semanticCache.delete(key)
  semanticCache.set(key, cached)
  return cached
}

function lockRecord(lockPath, fsImpl) {
  try { return JSON.parse(fsImpl.readFileSync(lockPath, 'utf8')) } catch { return null }
}

function localProcessIsAlive(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (typeof options.isProcessAlive === 'function') return options.isProcessAlive(pid) === true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function recoverableExpiredLock(lockPath, record, nowMs, leaseMs, fsImpl, options = {}) {
  if (record) {
    const expiresAtMs = Number(record.leaseExpiresAtMs)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs >= nowMs) return false
    const localHostname = String(options.hostname || os.hostname())
    if (String(record.hostname || '') === localHostname &&
        localProcessIsAlive(Number(record.pid), options)) return false
    return true
  }
  try {
    const stats = fsImpl.statSync(lockPath)
    return nowMs - stats.mtimeMs >= leaseMs
  } catch {
    return false
  }
}

function acquireLock(lockPath, options = {}) {
  const fsImpl = options.fs || fs
  const now = options.now || (() => Date.now())
  const started = now()
  const waitMs = Number.isInteger(options.lockWaitMs) ? options.lockWaitMs : DEFAULT_LOCK_WAIT_MS
  const leaseMs = Number.isInteger(options.lockLeaseMs) ? options.lockLeaseMs : DEFAULT_LOCK_LEASE_MS
  const ownerToken = String(options.ownerToken || crypto.randomUUID())
  while (true) {
    let descriptor
    let created = false
    try {
      fsImpl.mkdirSync(path.dirname(lockPath), { recursive: true })
      descriptor = fsImpl.openSync(lockPath, 'wx')
      created = true
      const acquiredAtMs = now()
      const record = {
        schemaVersion: TASK_RECOVERY_LOCK_SCHEMA,
        ownerToken,
        hostname: os.hostname(),
        pid: process.pid,
        acquiredAtMs,
        leaseExpiresAtMs: acquiredAtMs + leaseMs
      }
      fsImpl.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
      if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
      return {
        descriptor,
        lockPath,
        ownerToken,
        waitedMs: Math.max(0, now() - started),
        retryOptions: {
          platform: options.platform,
          maxAttempts: options.windowsFsRetryMaxAttempts,
          delayMs: options.windowsFsRetryDelayMs
        }
      }
    } catch (error) {
      if (descriptor !== undefined) {
        try { fsImpl.closeSync(descriptor) } catch { }
      }
      if (created) {
        try {
          retryTransientWindowsFs(() => fsImpl.unlinkSync(lockPath), {
            platform: options.platform,
            maxAttempts: options.windowsFsRetryMaxAttempts,
            delayMs: options.windowsFsRetryDelayMs
          })
        } catch { }
      }
      if (error?.code !== 'EEXIST' && !isTransientWindowsFsError(error, options)) throw error
      const existing = lockRecord(lockPath, fsImpl)
      if (recoverableExpiredLock(lockPath, existing, now(), leaseMs, fsImpl, options)) {
        try { fsImpl.unlinkSync(lockPath); continue } catch { }
      }
      if (now() - started >= waitMs) return null
      waitSync(Math.min(25, waitMs - (now() - started)))
    }
  }
}

function releaseLock(lock, fsImpl = fs) {
  if (!lock) return
  try { fsImpl.closeSync(lock.descriptor) } catch { }
  try {
    const existing = lockRecord(lock.lockPath, fsImpl)
    if (existing?.ownerToken === lock.ownerToken) {
      retryTransientWindowsFs(() => fsImpl.unlinkSync(lock.lockPath), lock.retryOptions)
    }
  } catch { }
}

function serializeFixedJsonSlot(value, options = {}) {
  return options.compact === true
    ? `${JSON.stringify(value)}\n`
    : `${JSON.stringify(value, null, 2)}\n`
}

function fixedSlotReplaceRetryDelays(options = {}) {
  const configured = options.replaceRetryDelaysMs
  if (!Array.isArray(configured)) return DEFAULT_FIXED_SLOT_REPLACE_RETRY_DELAYS_MS
  return configured
    .filter(delay => Number.isFinite(delay) && delay >= 0)
    .slice(0, 16)
    .map(delay => Math.trunc(delay))
}

function isTransientFixedSlotReplaceError(error) {
  return TRANSIENT_FIXED_SLOT_REPLACE_CODES.has(String(error?.code || '').toUpperCase())
}

function runFixedSlotReplaceOperation(operation, retryDelays) {
  let attempts = 0
  while (true) {
    attempts += 1
    try {
      return { value: operation(), attempts }
    } catch (error) {
      const retryDelay = retryDelays[attempts - 1]
      if (!isTransientFixedSlotReplaceError(error) || retryDelay === undefined) {
        return { error, attempts }
      }
      waitSync(retryDelay)
    }
  }
}

function writeFixedJsonSlot(file, tempFile, value, fsImpl = fs, options = {}) {
  const serialized = serializeFixedJsonSlot(value, options)
  const retryDelays = fixedSlotReplaceRetryDelays(options)
  fsImpl.mkdirSync(path.dirname(file), { recursive: true })
  let descriptor
  let writeError = null
  try {
    descriptor = fsImpl.openSync(tempFile, 'w')
    fsImpl.writeFileSync(descriptor, serialized, 'utf8')
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
  } catch (error) {
    writeError = error
  } finally {
    if (descriptor !== undefined) {
      try { fsImpl.closeSync(descriptor) } catch (error) { if (!writeError) writeError = error }
    }
  }
  if (writeError) {
    try { fsImpl.unlinkSync(tempFile) } catch { }
    throw writeError
  }
  const removal = runFixedSlotReplaceOperation(() => fsImpl.unlinkSync(file), retryDelays)
  const targetMissing = removal.error?.code === 'ENOENT'
  const copyAfterRemovalFailure = Boolean(
    removal.error &&
    !targetMissing &&
    options.allowVerifiedCopyFallback === true &&
    isTransientFixedSlotReplaceError(removal.error)
  )
  if (removal.error && !targetMissing && !copyAfterRemovalFailure) {
    try { fsImpl.unlinkSync(tempFile) } catch { }
    throw removal.error
  }
  const replacement = copyAfterRemovalFailure
    ? { error: removal.error, attempts: 0 }
    : runFixedSlotReplaceOperation(() => fsImpl.renameSync(tempFile, file), retryDelays)
  let replaceMode = 'rename'
  let copyAttempts = 0
  if (replacement.error) {
    if (options.allowVerifiedCopyFallback !== true || !isTransientFixedSlotReplaceError(replacement.error)) {
      try { fsImpl.unlinkSync(tempFile) } catch { }
      throw replacement.error
    }
    const copied = runFixedSlotReplaceOperation(() => fsImpl.copyFileSync(tempFile, file), retryDelays)
    copyAttempts = copied.attempts
    if (copied.error) {
      try { fsImpl.unlinkSync(tempFile) } catch { }
      throw copied.error
    }
    replaceMode = 'verified-copy'
    try { fsImpl.unlinkSync(tempFile) } catch { }
  }
  const readback = readJson(file, fsImpl, Math.max(TASK_STATE_SLOT_MAX_BYTES + 64 * 1024, Buffer.byteLength(serialized) + 1))
  if (readback.status !== 'fresh' || digestValue(readback.value) !== digestValue(value)) {
    try { fsImpl.unlinkSync(file) } catch { }
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_STATE_READBACK_MISMATCH', `state readback mismatch: ${file}`)
  }
  return {
    file,
    bytes: Buffer.byteLength(serialized),
    digest: digestValue(value),
    replaceMode,
    unlinkAttempts: removal.attempts,
    renameAttempts: replacement.attempts,
    copyAttempts
  }
}

function writeStableProjection(file, state, options = {}) {
  const fsImpl = options.fs || fs
  try {
    return { status: 'persisted', ...writeFixedJsonSlot(file, `${file}.v5.tmp`, state, fsImpl) }
  } catch (error) {
    return { status: 'warn', file, errorCode: error.code || 'LIFECYCLE_PROJECTION_WRITE_FAILED', message: error.message }
  }
}

function compactTelemetryRecord(record, options = {}) {
  const maxBytes = Number.isInteger(options.telemetryRecordMaxBytes)
    ? Math.max(256, options.telemetryRecordMaxBytes)
    : TELEMETRY_RECORD_MAX_BYTES
  const cloned = JSON.parse(JSON.stringify(record || {}))
  const source = `${JSON.stringify(cloned)}\n`
  const sourceBytes = Buffer.byteLength(source, 'utf8')
  if (sourceBytes <= maxBytes) return { value: cloned, line: source, truncated: false, sourceBytes }
  const value = {
    schemaVersion: 'TaskRecoveryTelemetryRecordV1',
    recordType: boundedRecoveryString(cloned.recordType || 'unknown', 128),
    observedAt: cloned.observedAt || cloned.capturedAt || cloned.time || new Date(nowMsFrom(options)).toISOString(),
    truncated: true,
    sourceBytes,
    sourceDigest: digestValue(cloned),
    eventName: boundedRecoveryString(cloned.eventName, 128),
    platform: boundedRecoveryString(cloned.platform, 128),
    action: boundedRecoveryString(cloned.action, 128),
    code: boundedRecoveryString(cloned.code, 256),
    effective: cloned.effective === true,
    activeProject: boundedRecoveryString(cloned.activeProject, 256),
    visiblePayloadDetected: cloned.visiblePayloadDetected === true
  }
  let line = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(line, 'utf8') > maxBytes) {
    for (const key of ['activeProject', 'code', 'action', 'platform', 'eventName']) delete value[key]
    line = `${JSON.stringify(value)}\n`
  }
  if (Buffer.byteLength(line, 'utf8') > maxBytes) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_TELEMETRY_RECORD_EXCEEDED',
      'compacted telemetry record exceeds its fixed record budget',
      { bytes: Buffer.byteLength(line, 'utf8'), maxBytes }
    )
  }
  return { value, line, truncated: true, sourceBytes }
}

function appendTaskRecoveryTelemetry(metaDir, record, options = {}) {
  const fsImpl = options.fs || fs
  const paths = storePaths(metaDir)
  const segmentMaxBytes = Number.isInteger(options.telemetrySegmentMaxBytes)
    ? Math.max(512, options.telemetrySegmentMaxBytes)
    : TELEMETRY_SEGMENT_MAX_BYTES
  let projected
  try {
    projected = compactTelemetryRecord(record, {
      ...options,
      telemetryRecordMaxBytes: Math.min(
        Number.isInteger(options.telemetryRecordMaxBytes) ? options.telemetryRecordMaxBytes : TELEMETRY_RECORD_MAX_BYTES,
        segmentMaxBytes
      )
    })
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'LIFECYCLE_TELEMETRY_RECORD_INVALID', message: error.message }
  }
  const lineBytes = Buffer.byteLength(projected.line, 'utf8')
  let storeLock
  try {
    storeLock = acquireLock(paths.storeLock, options)
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'LIFECYCLE_STORE_LEASE_FAILED', message: error.message }
  }
  if (!storeLock) return { status: 'error', errorCode: 'LIFECYCLE_STORE_LEASE_CONFLICT' }
  let descriptor
  try {
    const slots = paths.telemetry.map((file, index) => {
      try {
        const stats = fsImpl.statSync(file)
        return { file, index, bytes: stats.size, mtimeMs: stats.mtimeMs }
      } catch {
        return { file, index, bytes: 0, mtimeMs: 0 }
      }
    })
    const oversized = slots.find(slot => slot.bytes > segmentMaxBytes)
    const populated = slots.filter(slot => slot.bytes > 0)
      .sort((left, right) => right.mtimeMs - left.mtimeMs || right.index - left.index)
    const active = populated[0] || null
    let target = oversized || active || slots[0]
    let flags = 'a'
    let rotated = false
    if (oversized) {
      flags = 'w'
      rotated = true
    } else if (!active) {
      flags = 'w'
    } else if (active.bytes + lineBytes > segmentMaxBytes) {
      target = slots[(active.index + 1) % slots.length]
      flags = 'w'
      rotated = true
    }
    fsImpl.mkdirSync(paths.root, { recursive: true })
    descriptor = fsImpl.openSync(target.file, flags)
    fsImpl.writeFileSync(descriptor, projected.line, 'utf8')
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
    fsImpl.closeSync(descriptor)
    descriptor = undefined
    const bytes = fsImpl.statSync(target.file).size
    if (bytes > segmentMaxBytes) {
      throw new TaskRecoveryStoreV5Error(
        'LIFECYCLE_TELEMETRY_SEGMENT_EXCEEDED',
        'telemetry segment exceeded its fixed byte budget after write',
        { file: target.file, bytes, maxBytes: segmentMaxBytes }
      )
    }
    return {
      status: 'persisted',
      file: target.file,
      segment: target.index,
      bytes,
      lineBytes,
      truncated: projected.truncated,
      rotated
    }
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'LIFECYCLE_TELEMETRY_WRITE_FAILED', message: error.message }
  } finally {
    if (descriptor !== undefined) try { fsImpl.closeSync(descriptor) } catch { }
    releaseLock(storeLock, fsImpl)
  }
}

function ringDigest(ring) {
  return digestValue({
    schemaVersion: ring.schemaVersion,
    sequence: ring.sequence,
    updatedAt: ring.updatedAt,
    entries: ring.entries
  })
}

function readEphemeralRing(paths, fsImpl = fs) {
  const reads = paths.ephemeral.map(file => readJson(file, fsImpl, DEFAULT_EPHEMERAL_BYTES + 64 * 1024))
  const valid = reads.flatMap(read => {
    const ring = read.value
    if (read.status !== 'fresh' || ring?.schemaVersion !== TASK_RECOVERY_EPHEMERAL_SCHEMA || !Number.isInteger(ring.sequence) || !Array.isArray(ring.entries)) return []
    if (ring.payloadDigest !== ringDigest(ring)) return []
    return [{ ...read, ring }]
  }).sort((left, right) => right.ring.sequence - left.ring.sequence)
  return valid.length
    ? { status: 'fresh', current: valid[0], previous: valid[1] || null }
    : { status: reads.every(read => read.status === 'missing') ? 'missing' : 'invalid', reads }
}

function rawHostSessionDigest(sessionKey) {
  const key = String(sessionKey || '').trim()
  return key ? crypto.createHash('sha256').update(key).digest('hex') : ''
}

function legacyEphemeralOwnerKey(sessionKey) {
  const key = String(sessionKey || '').trim()
  return key ? digestValue({ sessionKey: key }) : ''
}

function sessionOwnerKeys(input = {}) {
  const sessionKey = String(input.sessionKey || '').trim()
  const suppliedDigest = String(input.hostSessionDigest || '').trim().toLowerCase()
  if (suppliedDigest && !/^[a-f0-9]{64}$/.test(suppliedDigest)) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_HOST_SESSION_DIGEST_INVALID',
      'hostSessionDigest must be one lowercase SHA-256 digest'
    )
  }
  const derivedDigest = rawHostSessionDigest(sessionKey)
  if (suppliedDigest && derivedDigest && suppliedDigest !== derivedDigest) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_HOST_SESSION_BINDING_MISMATCH',
      'hostSessionDigest does not match the supplied raw session key'
    )
  }
  const hostSessionDigest = suppliedDigest || derivedDigest
  if (!hostSessionDigest) return { primary: '', legacy: '' }
  return {
    primary: digestValue({ hostSessionDigest }),
    legacy: sessionKey ? legacyEphemeralOwnerKey(sessionKey) : ''
  }
}

function ephemeralOwnerKey(sessionKey) {
  return sessionOwnerKeys({ sessionKey }).primary
}

function compactModeReceiptForEphemeral (raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    schemaVersion: raw.schemaVersion,
    effective: raw.effective,
    sourceDefault: raw.sourceDefault,
    hostVariant: raw.hostVariant,
    runtimeContractDigest: raw.runtimeContractDigest,
    capabilityDigest: raw.capabilityDigest,
    processRuntimeIdentity: raw.processRuntimeIdentity || null
  }
}

function compactBootstrapForEphemeral (raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    schemaVersion: raw.schemaVersion,
    project: raw.project,
    turnBinding: raw.turnBinding,
    contextEpoch: raw.contextEpoch,
    generation: raw.generation,
    mode: raw.mode,
    hostVariant: raw.hostVariant,
    runtimeContractDigest: raw.runtimeContractDigest,
    capabilityDigest: raw.capabilityDigest,
    explicitStatus: raw.explicitStatus,
    explicitSkillId: raw.explicitSkillId,
    catalogDigest: raw.catalogDigest,
    candidateCount: raw.candidateCount,
    tool: raw.tool,
    nextOp: raw.nextOp,
    bootstrapDigest: raw.bootstrapDigest
  }
}

function compactEnforcementDecisionForEphemeral (raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    schemaVersion: raw.schemaVersion,
    feature: raw.feature,
    hostFamily: raw.hostFamily,
    hostVariant: raw.hostVariant,
    eventName: raw.eventName,
    bootstrap: raw.bootstrap,
    observe: raw.observe,
    hardEnforcement: raw.hardEnforcement,
    reasonCode: raw.reasonCode,
    capabilityClaim: raw.capabilityClaim,
    source: raw.source
  }
}

function compactEnforcementStateForEphemeral (raw) {
  if (!raw || typeof raw !== 'object') return null
  const decisions = Object.fromEntries(
    Object.entries(raw.decisions || {}).slice(-5).map(([key, value]) => [
      key,
      compactEnforcementDecisionForEphemeral(value)
    ])
  )
  return {
    schemaVersion: raw.schemaVersion,
    decisions,
    lastDecision: compactEnforcementDecisionForEphemeral(raw.lastDecision),
    observedAt: raw.observedAt
  }
}

function compactRouteStopForEphemeral (raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    schemaVersion: raw.schemaVersion,
    present: raw.present,
    complete: raw.complete,
    turnBinding: raw.turnBinding,
    contextEpoch: raw.contextEpoch,
    planDigest: raw.planDigest,
    processComplete: raw.processComplete,
    retired: raw.retired,
    retirementReason: raw.retirementReason,
    completionDisposition: raw.completionDisposition,
    pendingStageIds: Array.isArray(raw.pendingStageIds) ? raw.pendingStageIds.slice(0, 16) : [],
    selectedBusinessSkillId: raw.selectedBusinessSkillId,
    mustReplyCore: raw.mustReplyCore,
    businessSatisfied: raw.businessSatisfied,
    errorCode: raw.errorCode,
    nextOp: raw.nextOp,
    nextCall: raw.nextCall || null,
    recovery: raw.recovery || null
  }
}

function compactMutationCloseoutForEphemeral(raw) {
  if (!raw || typeof raw !== 'object') return null
  const observation = raw.observation && typeof raw.observation === 'object' ? raw.observation : null
  const effects = observation?.observedEffects || {}
  const compactPaths = values => Array.isArray(values)
    ? values.slice(0, 24).map(item => boundedRecoveryString(item, 512))
    : []
  let reconciliation = null
  if (raw.reconciliation && typeof raw.reconciliation === 'object') {
    try {
      reconciliation = raw.reconciliation.schemaVersion === 'ArtifactMutationReconciliationProjectionV1'
        ? JSON.parse(JSON.stringify(raw.reconciliation))
        : projectArtifactMutationReconciliationReceipt(raw.reconciliation)
    } catch { reconciliation = null }
  }
  const reconciliationInput = validateArtifactMutationReconciliationInput(raw.reconciliationInput).valid
    ? JSON.parse(JSON.stringify(raw.reconciliationInput))
    : null
  return {
    schemaVersion: raw.schemaVersion,
    operationId: boundedRecoveryString(raw.operationId, 256),
    toolName: boundedRecoveryString(raw.toolName, 128),
    completedAt: raw.completedAt || null,
    result: boundedRecoveryString(raw.result, 64),
    authorizationErrors: Array.isArray(raw.authorizationErrors)
      ? raw.authorizationErrors.slice(0, 24).map(item => boundedRecoveryString(item, 256))
      : [],
    reconciledAt: raw.reconciledAt || null,
    reconciliation,
    reconciliationInput,
    observation: observation ? {
      schemaVersion: observation.schemaVersion,
      operationId: boundedRecoveryString(observation.operationId, 256),
      decisionDigest: boundedRecoveryString(observation.decisionDigest, 64),
      leaseDigest: boundedRecoveryString(observation.leaseDigest, 64),
      plannedSetDigest: boundedRecoveryString(observation.plannedSetDigest, 64),
      observedEffects: {
        created: compactPaths(effects.created),
        modified: compactPaths(effects.modified),
        deleted: compactPaths(effects.deleted),
        moved: Array.isArray(effects.moved)
          ? effects.moved.slice(0, 24).map(item => ({
              source: boundedRecoveryString(item?.source, 512),
              target: boundedRecoveryString(item?.target, 512)
            }))
          : []
      },
      observationCoverage: observation.observationCoverage,
      nativeExitCode: observation.nativeExitCode,
      drift: Array.isArray(observation.drift)
        ? observation.drift.slice(0, 24).map(item => boundedRecoveryString(item, 512))
        : [],
      reconcileRequired: observation.reconcileRequired === true,
      status: observation.status,
      completedAt: observation.completedAt,
      receiptDigest: boundedRecoveryString(observation.receiptDigest, 64)
    } : null,
    artifactCloseout: raw.artifactCloseout && typeof raw.artifactCloseout === 'object'
      ? {
          schemaVersion: raw.artifactCloseout.schemaVersion,
          operationId: boundedRecoveryString(raw.artifactCloseout.operationId, 256),
          decisionDigest: boundedRecoveryString(raw.artifactCloseout.decisionDigest, 64),
          leaseDigest: boundedRecoveryString(raw.artifactCloseout.leaseDigest, 64),
          observationReceiptDigest: boundedRecoveryString(raw.artifactCloseout.observationReceiptDigest, 64),
          decisionStatus: raw.artifactCloseout.decisionStatus,
          reconcileRequired: raw.artifactCloseout.reconcileRequired === true,
          completedAt: raw.artifactCloseout.completedAt,
          closeoutDigest: boundedRecoveryString(raw.artifactCloseout.closeoutDigest, 64)
        }
      : null
  }
}

function compactTurnLivenessForEphemeral (raw) {
  if (!raw || typeof raw !== 'object') return null
  const operation = raw.inFlightOperation
  return {
    schemaVersion: raw.schemaVersion,
    state: raw.state,
    turnKey: raw.turnKey,
    inFlightOperation: operation?.mutating === true ? {
      operationId: operation.operationId,
      toolName: operation.toolName,
      startedAt: operation.startedAt,
      mutating: true,
      targetPaths: Array.isArray(operation.targetPaths) ? operation.targetPaths.slice(0, 8) : []
    } : null,
    checkpoint: raw.checkpoint ? {
      phase: raw.checkpoint.phase,
      observedAt: raw.checkpoint.observedAt,
      summary: raw.checkpoint.summary
    } : null,
    lastMutationCloseout: compactMutationCloseoutForEphemeral(raw.lastMutationCloseout)
  }
}

function compactWorkflowOperationalWriteLeaseCloseout(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    schemaVersion: boundedRecoveryString(raw.schemaVersion, 64),
    leaseDigest: boundedRecoveryString(raw.leaseDigest, 64),
    operationId: boundedRecoveryString(raw.operationId, 256),
    status: boundedRecoveryString(raw.status, 32),
    completedAt: boundedRecoveryString(raw.completedAt, 64),
    receiptDigest: boundedRecoveryString(raw.receiptDigest, 64),
    reconciliationReceiptDigest: boundedRecoveryString(raw.reconciliationReceiptDigest, 64)
  }
}

function compactSimpleTaskFastPathLeaseCloseout(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    schemaVersion: boundedRecoveryString(raw.schemaVersion, 64),
    leaseDigest: boundedRecoveryString(raw.leaseDigest, 64),
    operationId: boundedRecoveryString(raw.operationId, 256),
    useCount: Number(raw.useCount) || 0,
    status: boundedRecoveryString(raw.status, 32),
    completedAt: boundedRecoveryString(raw.completedAt, 64),
    usageDigest: boundedRecoveryString(raw.usageDigest, 64),
    receiptDigest: boundedRecoveryString(raw.receiptDigest, 64),
    closeoutDigest: boundedRecoveryString(raw.closeoutDigest, 64),
    reconciliationReceiptDigest: boundedRecoveryString(raw.reconciliationReceiptDigest, 64)
  }
}

function buildTasklessAuthorityEphemeralStub(state) {
  const hasOperationalAuthority = !!state?.workflowOperationalWriteLease
  const hasSimpleAuthority = !!state?.simpleTaskFastPathLease
  if (!hasOperationalAuthority && !hasSimpleAuthority) return null
  if (hasSimpleAuthority && !state?.simpleTaskFastPathUsage) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_EPHEMERAL_SIMPLE_USAGE_INCOMPLETE',
      'active simple-task authority requires its exact usage state in the recovery projection'
    )
  }
  const context = state.contextAcquisition || {}
  const route = state.progressiveSkillRoute || {}
  const workflowRoute = state.workflowRouteDecision || {}
  const envelope = state.actualInstructionEnvelope || {}
  const sticky = state.stickyProject || {}
  const bootstrap = route.bootstrap || {}
  const modeReceipt = route.modeReceipt || {}
  const stop = state.progressiveSkillRouteStop || {}
  const turn = state.turnLiveness || {}
  const stub = {
    version: state.version,
    mode: boundedRecoveryString(state.mode, 32),
    activeProject: boundedRecoveryString(state.activeProject, 128),
    activeScope: boundedRecoveryString(state.activeScope, 32),
    activeProjectSource: boundedRecoveryString(state.activeProjectSource, 64),
    taskRecoveryBinding: null,
    stickyProject: {
      schemaVersion: sticky.schemaVersion,
      leaseId: boundedRecoveryString(sticky.leaseId, 128),
      targetDigest: boundedRecoveryString(sticky.targetDigest, 64),
      layoutIdentity: boundedRecoveryString(sticky.layoutIdentity, 64),
      project: boundedRecoveryString(sticky.project, 128),
      physicalRoot: boundedRecoveryString(sticky.physicalRoot, 1024),
      activeRoot: boundedRecoveryString(sticky.activeRoot, 1024),
      source: boundedRecoveryString(sticky.source, 64),
      leaseDigest: boundedRecoveryString(sticky.leaseDigest, 64),
      rootIdentityDigest: boundedRecoveryString(sticky.rootIdentityDigest, 64),
      authorityKind: boundedRecoveryString(sticky.authorityKind, 32),
      authorityDigest: boundedRecoveryString(sticky.authorityDigest, 64),
      contextEpoch: boundedRecoveryString(sticky.contextEpoch, 256),
      contextBindingDigest: boundedRecoveryString(sticky.contextBindingDigest, 64),
      routeRevision: boundedRecoveryString(sticky.routeRevision, 64),
      revocationEpoch: sticky.revocationEpoch,
      issuedAtMs: sticky.issuedAtMs,
      expiresAtMs: sticky.expiresAtMs
    },
    actualInstructionEnvelope: {
      schemaVersion: boundedRecoveryString(envelope.schemaVersion, 64),
      envelopeId: boundedRecoveryString(envelope.envelopeId, 128),
      envelopeDigest: boundedRecoveryString(envelope.envelopeDigest, 64),
      actualInstructionDigest: boundedRecoveryString(envelope.actualInstructionDigest, 64),
      contextEpoch: boundedRecoveryString(envelope.contextEpoch, 256),
      instructionAuthority: envelope.instructionAuthority === true
    },
    workflowRouteDecision: {
      schemaVersion: boundedRecoveryString(workflowRoute.schemaVersion, 64),
      decisionDigest: boundedRecoveryString(workflowRoute.decisionDigest, 64),
      routeRevision: boundedRecoveryString(workflowRoute.routeRevision, 64),
      routeKey: boundedRecoveryString(workflowRoute.routeKey, 96),
      topIntent: boundedRecoveryString(workflowRoute.topIntent, 32),
      subtype: boundedRecoveryString(workflowRoute.subtype, 64)
    },
    workflowRoutePlanBinding: {
      bindingDigest: boundedRecoveryString(state.workflowRoutePlanBinding?.bindingDigest, 64),
      routeRevision: boundedRecoveryString(state.workflowRoutePlanBinding?.routeRevision, 64)
    },
    workflowOperationalWriteLease: hasOperationalAuthority
      ? JSON.parse(JSON.stringify(state.workflowOperationalWriteLease))
      : null,
    workflowOperationalWriteLeaseCloseout: compactWorkflowOperationalWriteLeaseCloseout(
      state.workflowOperationalWriteLeaseCloseout
    ),
    simpleTaskFastPathLease: hasSimpleAuthority
      ? JSON.parse(JSON.stringify(state.simpleTaskFastPathLease))
      : null,
    simpleTaskFastPathUsage: hasSimpleAuthority
      ? JSON.parse(JSON.stringify(state.simpleTaskFastPathUsage))
      : null,
    simpleTaskFastPathLeaseCloseout: compactSimpleTaskFastPathLeaseCloseout(
      state.simpleTaskFastPathLeaseCloseout
    ),
    progressiveSkillRoute: {
      schemaVersion: boundedRecoveryString(route.schemaVersion, 64),
      modeReceipt: route.modeReceipt ? {
        schemaVersion: boundedRecoveryString(modeReceipt.schemaVersion, 64),
        effective: typeof modeReceipt.effective === 'boolean'
          ? modeReceipt.effective
          : boundedRecoveryString(modeReceipt.effective, 32),
        hostVariant: boundedRecoveryString(modeReceipt.hostVariant, 64)
      } : null,
      bootstrap: route.bootstrap ? {
        schemaVersion: boundedRecoveryString(bootstrap.schemaVersion, 64),
        project: boundedRecoveryString(bootstrap.project, 128),
        turnBinding: boundedRecoveryString(bootstrap.turnBinding, 128),
        contextEpoch: boundedRecoveryString(bootstrap.contextEpoch, 256),
        bootstrapDigest: boundedRecoveryString(bootstrap.bootstrapDigest, 128),
        explicitStatus: boundedRecoveryString(bootstrap.explicitStatus, 32)
      } : null,
      active: route.active === true,
      errorCode: boundedRecoveryString(route.errorCode, 128)
    },
    progressiveSkillRouteStop: stop && typeof stop === 'object' ? {
      schemaVersion: boundedRecoveryString(stop.schemaVersion, 64),
      present: stop.present === true,
      complete: stop.complete === true,
      turnBinding: boundedRecoveryString(stop.turnBinding, 128),
      contextEpoch: boundedRecoveryString(stop.contextEpoch, 256),
      planDigest: boundedRecoveryString(stop.planDigest, 128),
      processComplete: stop.processComplete === true,
      retired: stop.retired === true,
      errorCode: boundedRecoveryString(stop.errorCode, 128)
    } : null,
    turnLiveness: {
      schemaVersion: turn.schemaVersion,
      state: boundedRecoveryString(turn.state, 64),
      turnKey: boundedRecoveryString(turn.turnKey, 256),
      inFlightOperation: null,
      checkpoint: turn.checkpoint ? {
        phase: boundedRecoveryString(turn.checkpoint.phase, 96)
      } : null
    },
    contextAcquisition: {
      schemaVersion: boundedRecoveryString(context.schemaVersion, 64),
      contextEpoch: boundedRecoveryString(context.contextEpoch, 256),
      activeRoot: boundedRecoveryString(context.activeRoot, 1024),
      project: boundedRecoveryString(context.project, 128),
      targetResolved: context.targetResolved === true,
      hostCapability: boundedRecoveryString(context.hostCapability, 64),
      hostSessionId: boundedRecoveryString(context.hostSessionId, 256),
      verificationMode: hasOperationalAuthority && hasSimpleAuthority
        ? 'ephemeral-taskless-authority'
        : (hasSimpleAuthority ? 'ephemeral-simple-authority' : 'ephemeral-operational-authority')
    },
    productMutationBeforePrecheck: state.productMutationBeforePrecheck === true,
    productMutationCountThisTurn: Number(state.productMutationCountThisTurn) || 0,
    s07ProductWarnEmitted: state.s07ProductWarnEmitted === true,
    mutated: state.mutated === true,
    reportTouched: state.reportTouched === true,
    memoryTouched: state.memoryTouched === true,
    recoveryKind: 'ephemeral-resume-stub',
    recoveryCompaction: hasOperationalAuthority && hasSimpleAuthority
      ? 'taskless-authority-budget'
      : (hasSimpleAuthority ? 'simple-authority-budget' : 'operational-authority-budget')
  }
  if (jsonBytes(stub) > EPHEMERAL_STUB_TARGET_BYTES) {
    stub.progressiveSkillRouteStop = stop && typeof stop === 'object' ? {
      schemaVersion: boundedRecoveryString(stop.schemaVersion, 64),
      present: stop.present === true,
      complete: stop.complete === true,
      processComplete: stop.processComplete === true,
      retired: stop.retired === true,
      errorCode: boundedRecoveryString(stop.errorCode, 128)
    } : null
  }
  if (jsonBytes(stub) > EPHEMERAL_STUB_TARGET_BYTES) {
    stub.progressiveSkillRoute = route && typeof route === 'object' ? {
      schemaVersion: boundedRecoveryString(route.schemaVersion, 64),
      modeReceipt: route.modeReceipt ? {
        hostVariant: boundedRecoveryString(modeReceipt.hostVariant, 64)
      } : null,
      bootstrap: route.bootstrap ? {
        turnBinding: boundedRecoveryString(bootstrap.turnBinding, 128),
        contextEpoch: boundedRecoveryString(bootstrap.contextEpoch, 256),
        bootstrapDigest: boundedRecoveryString(bootstrap.bootstrapDigest, 128)
      } : null,
      active: route.active === true,
      errorCode: boundedRecoveryString(route.errorCode, 128)
    } : null
  }
  if (jsonBytes(stub) > EPHEMERAL_STUB_TARGET_BYTES) {
    stub.progressiveSkillRoute = null
    stub.progressiveSkillRouteStop = null
  }
  return stub
}

function buildMinimalEphemeralStub (state) {
  const context = state?.contextAcquisition || {}
  const route = state?.progressiveSkillRoute || {}
  const workflowRoute = state?.workflowRouteDecision || {}
  const envelope = state?.actualInstructionEnvelope || {}
  const sticky = state?.stickyProject || {}
  const bootstrap = route.bootstrap || {}
  const stop = state?.progressiveSkillRouteStop || {}
  const turn = state?.turnLiveness || {}
  const operation = turn.inFlightOperation?.mutating === true
    ? turn.inFlightOperation
    : null
  const handoff = context.plan || context.handoff || {}
  const ingressRecovery = buildTasklessWorkflowIngressRecovery(state, 'exact')
  const stub = {
    version: state?.version,
    mode: boundedRecoveryString(state?.mode, 32),
    activeProject: boundedRecoveryString(state?.activeProject, 128),
    activeScope: boundedRecoveryString(state?.activeScope, 32),
    activeProjectSource: boundedRecoveryString(state?.activeProjectSource, 64),
    taskRecoveryBinding: null,
    stickyProject: (state?.workflowOperationalWriteLease || ingressRecovery) ? {
      schemaVersion: sticky.schemaVersion,
      leaseId: boundedRecoveryString(sticky.leaseId, 128),
      targetDigest: boundedRecoveryString(sticky.targetDigest, 64),
      layoutIdentity: boundedRecoveryString(sticky.layoutIdentity, 64),
      project: boundedRecoveryString(sticky.project, 128),
      physicalRoot: boundedRecoveryString(sticky.physicalRoot, 1024),
      activeRoot: boundedRecoveryString(sticky.activeRoot, 1024),
      source: boundedRecoveryString(sticky.source, 64),
      sessionKey: boundedRecoveryString(sticky.sessionKey, 256),
      leaseDigest: boundedRecoveryString(sticky.leaseDigest, 64),
      rootIdentityDigest: boundedRecoveryString(sticky.rootIdentityDigest, 64),
      authorityKind: boundedRecoveryString(sticky.authorityKind, 32),
      authorityDigest: boundedRecoveryString(sticky.authorityDigest, 64),
      contextEpoch: boundedRecoveryString(sticky.contextEpoch, 256),
      contextBindingDigest: boundedRecoveryString(sticky.contextBindingDigest, 64),
      routeRevision: boundedRecoveryString(sticky.routeRevision, 64),
      revocationEpoch: sticky.revocationEpoch,
      issuedAtMs: sticky.issuedAtMs,
      expiresAtMs: sticky.expiresAtMs
    } : null,
    actualInstructionEnvelope: ingressRecovery
      ? cloneRecoveryValue(state.actualInstructionEnvelope)
      : (state?.workflowOperationalWriteLease ? compactInstructionEnvelopeIdentity(envelope) : null),
    workItemSet: ingressRecovery ? cloneRecoveryValue(state.workItemSet) : null,
    workflowRouteDecision: ingressRecovery
      ? compactWorkflowRouteIdentity(state.workflowRouteDecision)
      : (state?.workflowOperationalWriteLease ? compactWorkflowRouteIdentity(workflowRoute) : null),
    workflowRoutePlanBinding: ingressRecovery
      ? compactWorkflowRoutePlanBindingIdentity(state.workflowRoutePlanBinding)
      : (state?.workflowOperationalWriteLease
          ? compactWorkflowRoutePlanBindingIdentity(state.workflowRoutePlanBinding)
          : null),
    workflowIngressRecovery: ingressRecovery,
    workflowOperationalWriteLease: state?.workflowOperationalWriteLease
      ? JSON.parse(JSON.stringify(state.workflowOperationalWriteLease))
      : null,
    progressiveSkillRoute: !ingressRecovery && route && typeof route === 'object' ? {
      schemaVersion: boundedRecoveryString(route.schemaVersion, 64),
      modeReceipt: route.modeReceipt ? {
      schemaVersion: boundedRecoveryString(route.modeReceipt.schemaVersion, 64),
        effective: route.modeReceipt.effective === true,
        sourceDefault: boundedRecoveryString(route.modeReceipt.sourceDefault, 32),
        hostVariant: boundedRecoveryString(route.modeReceipt.hostVariant, 64),
        runtimeContractDigest: boundedRecoveryString(route.modeReceipt.runtimeContractDigest, 128),
        capabilityDigest: boundedRecoveryString(route.modeReceipt.capabilityDigest, 128)
      } : null,
      bootstrap: route.bootstrap ? {
        schemaVersion: boundedRecoveryString(bootstrap.schemaVersion, 64),
        project: boundedRecoveryString(bootstrap.project, 128),
        turnBinding: boundedRecoveryString(bootstrap.turnBinding, 128),
        contextEpoch: boundedRecoveryString(bootstrap.contextEpoch, 256),
        generation: bootstrap.generation,
        mode: boundedRecoveryString(bootstrap.mode, 32),
        hostVariant: boundedRecoveryString(bootstrap.hostVariant, 64),
        runtimeContractDigest: boundedRecoveryString(bootstrap.runtimeContractDigest, 128),
        capabilityDigest: boundedRecoveryString(bootstrap.capabilityDigest, 128),
        catalogDigest: boundedRecoveryString(bootstrap.catalogDigest, 128),
        bootstrapDigest: boundedRecoveryString(bootstrap.bootstrapDigest, 128),
        nextOp: boundedRecoveryString(bootstrap.nextOp, 64)
      } : null,
      active: route.active === true,
      errorCode: boundedRecoveryString(route.errorCode, 128)
    } : null,
    progressiveSkillRouteStop: !ingressRecovery && stop && typeof stop === 'object' ? {
      schemaVersion: boundedRecoveryString(stop.schemaVersion, 64),
      present: stop.present === true,
      complete: stop.complete === true,
      turnBinding: boundedRecoveryString(stop.turnBinding, 128),
      contextEpoch: boundedRecoveryString(stop.contextEpoch, 256),
      planDigest: boundedRecoveryString(stop.planDigest, 128),
      processComplete: stop.processComplete === true,
      retired: stop.retired === true,
      pendingStageIds: Array.isArray(stop.pendingStageIds)
        ? stop.pendingStageIds.slice(0, 8).map(item => boundedRecoveryString(item, 96))
        : [],
      errorCode: boundedRecoveryString(stop.errorCode, 128),
      nextOp: boundedRecoveryString(stop.nextOp, 64)
    } : null,
    turnLiveness: {
      schemaVersion: turn.schemaVersion,
      state: boundedRecoveryString(turn.state, 64),
      turnKey: boundedRecoveryString(turn.turnKey, 256),
      inFlightOperation: operation ? {
        operationId: boundedRecoveryString(operation.operationId, 256),
        toolName: boundedRecoveryString(operation.toolName, 128),
        startedAt: boundedRecoveryString(operation.startedAt, 64),
        mutating: true,
        targetPaths: Array.isArray(operation.targetPaths)
          ? operation.targetPaths.slice(0, 4).map(item => boundedRecoveryString(item, 512))
          : []
      } : null,
      checkpoint: turn.checkpoint ? {
        phase: boundedRecoveryString(turn.checkpoint.phase, 96),
        observedAt: boundedRecoveryString(turn.checkpoint.observedAt, 64),
        summary: boundedRecoveryString(turn.checkpoint.summary, 256)
      } : null,
      lastMutationCloseout: compactMutationCloseoutForEphemeral(turn.lastMutationCloseout)
    },
    contextAcquisition: {
      schemaVersion: boundedRecoveryString(context.schemaVersion, 64),
      contextEpoch: boundedRecoveryString(context.contextEpoch, 256),
      activeRoot: boundedRecoveryString(context.activeRoot, 1024),
      project: boundedRecoveryString(context.project, 128),
      targetResolved: context.targetResolved === true,
      hostCapability: boundedRecoveryString(context.hostCapability, 64),
      hostSessionId: boundedRecoveryString(context.hostSessionId, 256),
      verificationMode: 'ephemeral-resume-rehydrate',
      handoff: !ingressRecovery && handoff && typeof handoff === 'object' ? {
        contextEpoch: boundedRecoveryString(context.contextEpoch || handoff.contextEpoch, 256),
        planId: boundedRecoveryString(handoff.planId, 256),
        planContentId: boundedRecoveryString(handoff.planContentId, 256),
        status: boundedRecoveryString(context.receipt?.status || handoff.status || 'stale', 64),
        activeRoot: boundedRecoveryString(context.activeRoot || handoff.activeRoot, 1024),
        project: boundedRecoveryString(context.project || handoff.project, 128)
      } : null
    },
    mutated: state?.mutated === true,
    reportTouched: state?.reportTouched === true,
    memoryTouched: state?.memoryTouched === true,
    recoveryKind: 'ephemeral-resume-stub',
    recoveryCompaction: 'minimal-budget'
  }
  if (jsonBytes(stub) > EPHEMERAL_STUB_TARGET_BYTES && ingressRecovery) {
    stub.actualInstructionEnvelope = compactInstructionEnvelopeIdentity(state.actualInstructionEnvelope)
    stub.workItemSet = compactWorkItemSetIdentity(state.workItemSet)
    stub.workflowRouteDecision = compactWorkflowRouteIdentity(state.workflowRouteDecision)
    stub.workflowRoutePlanBinding = compactWorkflowRoutePlanBindingIdentity(state.workflowRoutePlanBinding)
    stub.workflowIngressRecovery = buildTasklessWorkflowIngressRecovery(state, 'identity-only')
    stub.recoveryCompaction = 'minimal-identity-only'
  }
  return stub
}

function buildEphemeralStub(state) {
  if (state?.workflowOperationalWriteLease || state?.simpleTaskFastPathLease) {
    const tasklessAuthority = buildTasklessAuthorityEphemeralStub(state)
    if (jsonBytes(tasklessAuthority) <= EPHEMERAL_STUB_TARGET_BYTES) {
      return JSON.parse(JSON.stringify(tasklessAuthority))
    }
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_EPHEMERAL_ENTRY_EXCEEDED',
      'taskless authority resume stub exceeds 8 KiB',
      {
        bytes: jsonBytes(tasklessAuthority),
        maxBytes: EPHEMERAL_STUB_TARGET_BYTES,
        operationalTargetCount: state.workflowOperationalWriteLease?.relativeTargets?.length || 0,
        simpleTargetCount: state.simpleTaskFastPathLease?.relativeTargets?.length || 0
      }
    )
  }
  const context = state?.contextAcquisition || {}
  const sticky = state?.stickyProject || {}
  const ingressRecovery = buildTasklessWorkflowIngressRecovery(state, 'exact')
  const stub = {
    version: state?.version,
    mode: state?.mode,
    activeProject: state?.activeProject,
    activeScope: state?.activeScope,
    activeProjectSource: state?.activeProjectSource,
    stickyProject: {
      schemaVersion: sticky.schemaVersion,
      leaseId: sticky.leaseId,
      targetDigest: sticky.targetDigest,
      layoutIdentity: sticky.layoutIdentity,
      project: sticky.project,
      physicalRoot: sticky.physicalRoot,
      activeRoot: sticky.activeRoot,
      source: sticky.source,
      expiresAt: sticky.expiresAt,
      expiresAtMs: sticky.expiresAtMs,
      sessionKey: sticky.sessionKey,
      leaseDigest: sticky.leaseDigest,
      rootIdentityDigest: sticky.rootIdentityDigest,
      authorityKind: sticky.authorityKind,
      authorityDigest: sticky.authorityDigest,
      contextEpoch: sticky.contextEpoch,
      contextBindingDigest: sticky.contextBindingDigest,
      routeRevision: sticky.routeRevision,
      revocationEpoch: sticky.revocationEpoch,
      issuedAtMs: sticky.issuedAtMs
    },
    stickyAuto: state?.stickyAuto,
    taskRecoveryBinding: state?.taskRecoveryBinding || null,
    workflowOperationalWriteLease: state?.workflowOperationalWriteLease
      ? JSON.parse(JSON.stringify(state.workflowOperationalWriteLease))
      : null,
    actualInstructionEnvelope: ingressRecovery
      ? cloneRecoveryValue(state.actualInstructionEnvelope)
      : (state?.workflowOperationalWriteLease ? compactInstructionEnvelopeIdentity(state.actualInstructionEnvelope) : null),
    workItemSet: ingressRecovery ? cloneRecoveryValue(state.workItemSet) : null,
    workflowRouteDecision: ingressRecovery
      ? cloneRecoveryValue(state.workflowRouteDecision)
      : (state?.workflowOperationalWriteLease ? compactWorkflowRouteIdentity(state.workflowRouteDecision) : null),
    workflowRoutePlanBinding: ingressRecovery
      ? cloneRecoveryValue(state.workflowRoutePlanBinding)
      : (state?.workflowOperationalWriteLease
          ? compactWorkflowRoutePlanBindingIdentity(state.workflowRoutePlanBinding)
          : null),
    workflowIngressRecovery: ingressRecovery,
    languageContext: state?.languageContext || null,
    progressiveSkillRoute: state?.progressiveSkillRoute || null,
    progressiveSkillRouteCoordinator: state?.progressiveSkillRouteCoordinator || null,
    progressiveSkillRouteCoordinatorError: state?.progressiveSkillRouteCoordinatorError || null,
    progressiveSkillRouteEnforcement: state?.progressiveSkillRouteEnforcement || null,
    progressiveSkillRouteStop: state?.progressiveSkillRouteStop || null,
    turnLiveness: compactTurnLivenessForEphemeral(state?.turnLiveness),
    workflowCompletionLifecycle: state?.workflowCompletionLifecycle || null,
    visible: state?.visible || null,
    mutated: state?.mutated === true,
    reportTouched: state?.reportTouched === true,
    memoryTouched: state?.memoryTouched === true,
    contextAcquisition: {
      schemaVersion: context.schemaVersion,
      contextEpoch: context.contextEpoch,
      activeRoot: context.activeRoot,
      project: context.project,
      targetResolved: context.targetResolved,
      hostCapability: context.hostCapability,
      hostSessionId: context.hostSessionId,
      verificationMode: 'ephemeral-resume-rehydrate',
      handoff: context.plan ? {
        contextEpoch: context.contextEpoch,
        planId: context.plan.planId || '',
        planContentId: context.plan.planContentId || '',
        status: context.receipt?.status || 'stale',
        activeRoot: context.activeRoot,
        project: context.project
      } : context.handoff || null
    },
    recoveryKind: 'ephemeral-resume-stub'
  }
  if (jsonBytes(stub) > EPHEMERAL_STUB_TARGET_BYTES) {
    stub.progressiveSkillRoute = state?.progressiveSkillRoute ? {
      schemaVersion: state.progressiveSkillRoute.schemaVersion,
      modeReceipt: compactModeReceiptForEphemeral(state.progressiveSkillRoute.modeReceipt),
      bootstrap: compactBootstrapForEphemeral(state.progressiveSkillRoute.bootstrap),
      pending: state.progressiveSkillRoute.pending || null,
      active: state.progressiveSkillRoute.active === true,
      errorCode: state.progressiveSkillRoute.errorCode || null
    } : null
    stub.progressiveSkillRouteCoordinator = state?.progressiveSkillRouteCoordinator ? {
      schemaVersion: state.progressiveSkillRouteCoordinator.schemaVersion,
      stateFingerprint: state.progressiveSkillRouteCoordinator.stateFingerprint,
      noProgressCount: state.progressiveSkillRouteCoordinator.noProgressCount,
      progressCount: state.progressiveSkillRouteCoordinator.progressCount,
      circuitOpen: state.progressiveSkillRouteCoordinator.circuitOpen,
      lastAction: state.progressiveSkillRouteCoordinator.lastAction,
      updatedAt: state.progressiveSkillRouteCoordinator.updatedAt
    } : null
    stub.progressiveSkillRouteEnforcement = compactEnforcementStateForEphemeral(
      state?.progressiveSkillRouteEnforcement
    )
    stub.progressiveSkillRouteStop = compactRouteStopForEphemeral(state?.progressiveSkillRouteStop)
  }
  if (jsonBytes(stub) > EPHEMERAL_STUB_TARGET_BYTES) {
    if (ingressRecovery) {
      stub.languageContext = null
      stub.progressiveSkillRoute = null
      stub.progressiveSkillRouteCoordinator = null
      stub.progressiveSkillRouteCoordinatorError = null
      stub.progressiveSkillRouteEnforcement = null
      stub.progressiveSkillRouteStop = null
    } else {
      stub.stickyProject = null
    }
    stub.stickyAuto = null
    stub.visible = null
    stub.workflowCompletionLifecycle = null
  }
  if (jsonBytes(stub) > EPHEMERAL_STUB_TARGET_BYTES) {
    stub.progressiveSkillRouteCoordinator = null
    stub.progressiveSkillRouteEnforcement = state?.progressiveSkillRouteEnforcement?.lastDecision
      ? {
          schemaVersion: state.progressiveSkillRouteEnforcement.schemaVersion,
          decisions: {
            [state.progressiveSkillRouteEnforcement.lastDecision.eventName]: compactEnforcementDecisionForEphemeral(
              state.progressiveSkillRouteEnforcement.lastDecision
            )
          },
          lastDecision: compactEnforcementDecisionForEphemeral(state.progressiveSkillRouteEnforcement.lastDecision),
          observedAt: state.progressiveSkillRouteEnforcement.observedAt
        }
      : null
  }
  if (jsonBytes(stub) > EPHEMERAL_STUB_TARGET_BYTES) {
    const minimal = buildMinimalEphemeralStub(state)
    if (jsonBytes(minimal) <= EPHEMERAL_STUB_TARGET_BYTES) {
      return JSON.parse(JSON.stringify(minimal))
    }
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_EPHEMERAL_ENTRY_EXCEEDED', 'minimal ephemeral resume stub exceeds 8 KiB', {
      bytes: jsonBytes(minimal),
      maxBytes: EPHEMERAL_STUB_TARGET_BYTES
    })
  }
  return JSON.parse(JSON.stringify(stub))
}

function updateEphemeralRing(paths, entry, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = nowMsFrom(options)
  const lock = acquireLock(paths.ephemeralLock, options)
  if (!lock) return { status: 'bypassed', errorCode: 'LIFECYCLE_EPHEMERAL_LOCK_TIMEOUT' }
  try {
    const current = readEphemeralRing(paths, fsImpl)
    const prior = current.status === 'fresh' ? current.current.ring : { sequence: 0, entries: [] }
    const existing = prior.entries.find(item => item?.ownerKey === entry.ownerKey)
    if (existing?.semanticDigest && existing.semanticDigest === entry.semanticDigest && options.force !== true) {
      return { status: 'semantic-noop', sequence: prior.sequence, entryCount: prior.entries.length, fullStateWrite: false }
    }
    let entries = prior.entries
      .filter(item => item?.ownerKey && item.ownerKey !== entry.ownerKey)
      .filter(item => nowMs - Date.parse(String(item.lastUsedAt || '')) <= (options.ephemeralTtlMs || DEFAULT_EPHEMERAL_TTL_MS))
    entries.push(entry)
    entries.sort((left, right) => Date.parse(String(left.lastUsedAt || '')) - Date.parse(String(right.lastUsedAt || '')))
    let ring
    do {
      ring = {
        schemaVersion: TASK_RECOVERY_EPHEMERAL_SCHEMA,
        sequence: prior.sequence + 1,
        updatedAt: new Date(nowMs).toISOString(),
        entries
      }
      ring.payloadDigest = ringDigest(ring)
      if (jsonBytes(ring) <= (options.ephemeralMaxBytes || DEFAULT_EPHEMERAL_BYTES)) break
      entries.shift()
    } while (entries.length)
    const targetIndex = prior.sequence % 2
    const write = writeFixedJsonSlot(paths.ephemeral[targetIndex], `${paths.root}${path.sep}ephemeral-next.tmp`, ring, fsImpl)
    return { status: 'persisted', sequence: ring.sequence, entryCount: entries.length, ...write }
  } finally {
    releaseLock(lock, fsImpl)
  }
}

function ensureReserve(paths, options = {}) {
  const fsImpl = options.fs || fs
  const reserveBytes = Number.isInteger(options.reserveBytes) ? options.reserveBytes : DEFAULT_RESERVE_BYTES
  const each = Math.floor(reserveBytes / 2)
  fsImpl.mkdirSync(paths.root, { recursive: true })
  const results = []
  for (const file of paths.reserve) {
    try {
      const stats = fsImpl.statSync(file)
      if (stats.isFile() && stats.size === each && reserveAllocationMarkerPresent(file, each, fsImpl)) {
        results.push({ file, bytes: stats.size, reused: true })
        continue
      }
    } catch { }
    let descriptor
    let allocationAttempted = false
    try {
      descriptor = fsImpl.openSync(file, fsImpl.existsSync(file) ? 'r+' : 'w+')
      allocationAttempted = true
      materializeReserveFile(descriptor, each, fsImpl)
      if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
      results.push({
        file,
        bytes: typeof fsImpl.fstatSync === 'function' ? fsImpl.fstatSync(descriptor).size : each,
        materialized: true
      })
    } catch (error) {
      if (descriptor !== undefined && allocationAttempted && typeof fsImpl.ftruncateSync === 'function') {
        try { fsImpl.ftruncateSync(descriptor, 0) } catch { }
      }
      throw error
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor)
    }
  }
  return { status: 'ready', bytes: results.reduce((sum, item) => sum + item.bytes, 0), files: results }
}

function reserveAllocationMarkerPresent(file, bytes, fsImpl = fs) {
  if (bytes < RESERVE_ALLOCATION_MAGIC.length) return false
  let descriptor
  try {
    descriptor = fsImpl.openSync(file, 'r')
    const marker = Buffer.alloc(RESERVE_ALLOCATION_MAGIC.length)
    const count = fsImpl.readSync(
      descriptor,
      marker,
      0,
      marker.length,
      bytes - marker.length
    )
    return count === marker.length && marker.equals(RESERVE_ALLOCATION_MAGIC)
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) try { fsImpl.closeSync(descriptor) } catch { }
  }
}

function materializeReserveFile(descriptor, bytes, fsImpl = fs) {
  if (!Number.isInteger(bytes) || bytes < CLOSEOUT_HEADER_BYTES + RESERVE_ALLOCATION_MAGIC.length + 256) {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_RESERVE_SIZE_INVALID', 'closeout reserve slot is too small')
  }
  if (typeof fsImpl.ftruncateSync !== 'function' || typeof fsImpl.writeSync !== 'function') {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_RESERVE_ALLOCATION_UNAVAILABLE', 'reserve allocation primitives are unavailable')
  }
  fsImpl.ftruncateSync(descriptor, 0)
  const chunk = Buffer.alloc(Math.min(RESERVE_WRITE_CHUNK_BYTES, bytes))
  let offset = 0
  while (offset < bytes) {
    const length = Math.min(chunk.length, bytes - offset)
    let chunkOffset = 0
    while (chunkOffset < length) {
      const written = fsImpl.writeSync(
        descriptor,
        chunk,
        chunkOffset,
        length - chunkOffset,
        offset + chunkOffset
      )
      if (!Number.isInteger(written) || written <= 0) {
        throw new TaskRecoveryStoreV5Error('LIFECYCLE_RESERVE_ALLOCATION_FAILED', 'reserve materialization made no progress')
      }
      chunkOffset += written
    }
    offset += length
  }
  fsImpl.writeSync(
    descriptor,
    RESERVE_ALLOCATION_MAGIC,
    0,
    RESERVE_ALLOCATION_MAGIC.length,
    bytes - RESERVE_ALLOCATION_MAGIC.length
  )
}

function readCloseoutSlot(file, fsImpl = fs) {
  let descriptor
  try {
    descriptor = fsImpl.openSync(file, 'r')
    const header = Buffer.alloc(CLOSEOUT_HEADER_BYTES)
    const count = fsImpl.readSync(descriptor, header, 0, header.length, 0)
    if (count !== header.length || header.subarray(0, 8).toString('ascii') !== CLOSEOUT_MAGIC) return null
    const sequence = header.readUInt32LE(8)
    const length = header.readUInt32LE(12)
    const expectedDigest = header.subarray(16, 80).toString('ascii')
    if (!length || length > 64 * 1024) return null
    const payload = Buffer.alloc(length)
    if (fsImpl.readSync(descriptor, payload, 0, length, CLOSEOUT_HEADER_BYTES) !== length) return null
    if (crypto.createHash('sha256').update(payload).digest('hex') !== expectedDigest) return null
    const value = JSON.parse(payload.toString('utf8'))
    return value?.schemaVersion === TASK_RECOVERY_CLOSEOUT_SCHEMA ? { sequence, value } : null
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) try { fsImpl.closeSync(descriptor) } catch { }
  }
}

function writeEmergencyCloseout(paths, value, options = {}) {
  const fsImpl = options.fs || fs
  const reserve = ensureReserve(paths, options)
  const reads = paths.reserve.map(file => readCloseoutSlot(file, fsImpl))
  const sequence = Math.max(0, ...reads.map(item => item?.sequence || 0)) + 1
  const targetIndex = sequence % 2
  const payloadValue = { schemaVersion: TASK_RECOVERY_CLOSEOUT_SCHEMA, sequence, ...value }
  const payload = Buffer.from(JSON.stringify(payloadValue), 'utf8')
  const reserveSlotBytes = Math.floor(reserve.bytes / 2)
  const maximumPayloadBytes = Math.min(
    64 * 1024,
    reserveSlotBytes - CLOSEOUT_HEADER_BYTES - RESERVE_ALLOCATION_MAGIC.length
  )
  if (payload.length > maximumPayloadBytes) {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_CLOSEOUT_PAYLOAD_EXCEEDED', 'emergency closeout exceeds 64 KiB')
  }
  const header = Buffer.alloc(CLOSEOUT_HEADER_BYTES)
  header.write(CLOSEOUT_MAGIC, 0, 'ascii')
  header.writeUInt32LE(sequence, 8)
  header.writeUInt32LE(payload.length, 12)
  header.write(crypto.createHash('sha256').update(payload).digest('hex'), 16, 'ascii')
  let descriptor
  try {
    descriptor = fsImpl.openSync(paths.reserve[targetIndex], 'r+')
    fsImpl.writeSync(descriptor, header, 0, header.length, 0)
    fsImpl.writeSync(descriptor, payload, 0, payload.length, CLOSEOUT_HEADER_BYTES)
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fsImpl.writeSync(descriptor, Buffer.alloc(CLOSEOUT_MAGIC.length), 0, CLOSEOUT_MAGIC.length, 0)
        if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
      } catch { }
    }
    throw error
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor)
  }
  const readback = readCloseoutSlot(paths.reserve[targetIndex], fsImpl)
  if (!readback || readback.sequence !== sequence) {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_CLOSEOUT_WRITE_FAILED', 'emergency closeout readback failed')
  }
  return { status: 'closeout-reserved', sequence, file: paths.reserve[targetIndex], reserve }
}

function readEmergencyCloseouts(metaDir, options = {}) {
  const fsImpl = options.fs || fs
  const paths = storePaths(metaDir)
  const slots = paths.reserve.map((file, index) => {
    const read = readCloseoutSlot(file, fsImpl)
    if (!read) return { index, file, status: 'empty-or-invalid', sequence: 0, record: null }
    return {
      index,
      file,
      status: 'fresh',
      sequence: read.sequence,
      record: read.value,
      recordDigest: digestValue(read.value)
    }
  })
  const records = slots
    .filter(slot => slot.status === 'fresh')
    .sort((left, right) => right.sequence - left.sequence)
  return {
    schemaVersion: 'TaskRecoveryEmergencyCloseoutReadV1',
    status: records.length ? 'fresh' : 'missing',
    records,
    slots
  }
}

function latestEmergencyCloseoutForIdentity(metaDir, identity, options = {}) {
  let normalized
  try { normalized = normalizeIdentity(identity) } catch (error) {
    return { status: 'invalid', errorCode: error.code || 'LIFECYCLE_IDENTITY_INVALID', message: error.message }
  }
  const read = readEmergencyCloseouts(metaDir, options)
  const match = read.records.find(item => {
    try { return sameIdentity(item.record?.identity, normalized) } catch { return false }
  })
  return match
    ? { status: 'fresh', ...match, identity: normalized }
    : { status: 'missing', errorCode: 'LIFECYCLE_CLOSEOUT_RECORD_MISSING', identity: normalized }
}

function inventoryTaskDirectories(paths, options = {}) {
  const fsImpl = options.fs || fs
  const maxTaskDirectories = Number.isInteger(options.maxTaskDirectories)
    ? Math.max(1, options.maxTaskDirectories)
    : DEFAULT_TASK_INVENTORY_MAX
  const directories = []
  let shards
  try { shards = fsImpl.readdirSync(paths.tasks, { withFileTypes: true }) } catch {
    return { directories, truncated: false, maxTaskDirectories }
  }
  for (const shard of shards.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) continue
    let tasks
    try { tasks = fsImpl.readdirSync(path.join(paths.tasks, shard.name), { withFileTypes: true }) } catch { continue }
    for (const task of tasks.sort((left, right) => left.name.localeCompare(right.name))) {
      if (directories.length >= maxTaskDirectories) {
        return { directories, truncated: true, maxTaskDirectories }
      }
      if (task.isDirectory() && /^[a-f0-9]{64}$/.test(task.name)) directories.push(taskPaths(paths, task.name))
    }
  }
  return { directories, truncated: false, maxTaskDirectories }
}

function usageLedgerDigest(value) {
  return digestValue({
    schemaVersion: value.schemaVersion,
    sequence: value.sequence,
    updatedAt: value.updatedAt,
    taskSlotBytes: value.taskSlotBytes,
    source: value.source,
    lastMaintenanceAt: value.lastMaintenanceAt
  })
}

function readUsageLedger(paths, fsImpl = fs) {
  const read = readJson(paths.manifest, fsImpl, USAGE_LEDGER_MAX_BYTES)
  const value = read.value
  if (read.status !== 'fresh' || value?.schemaVersion !== TASK_RECOVERY_USAGE_SCHEMA ||
      !Number.isInteger(value.sequence) || value.sequence < 1 ||
      !Number.isInteger(value.taskSlotBytes) || value.taskSlotBytes < 0 ||
      (value.lastMaintenanceAt !== undefined && value.lastMaintenanceAt !== null &&
        !Number.isFinite(Date.parse(String(value.lastMaintenanceAt)))) ||
      value.payloadDigest !== usageLedgerDigest(value)) {
    return { status: read.status === 'missing' ? 'missing' : 'invalid', read }
  }
  return { status: 'fresh', value, read }
}

function scanTaskSlotUsage(paths, options = {}) {
  const fsImpl = options.fs || fs
  let taskSlotBytes = 0
  let taskSlotFiles = 0
  const inventory = inventoryTaskDirectories(paths, options)
  if (inventory.truncated) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_TASK_INVENTORY_LIMIT_REACHED',
      'task recovery inventory exceeded its diagnostic scan bound',
      { maxTaskDirectories: inventory.maxTaskDirectories }
    )
  }
  for (const currentPaths of inventory.directories) {
    for (const file of currentPaths.slots) {
      try {
        const stats = fsImpl.statSync(file)
        taskSlotBytes += stats.size
        taskSlotFiles += 1
      } catch { }
    }
  }
  return { taskSlotBytes, taskSlotFiles }
}

function fixedManagedUsage(paths, options = {}) {
  const fsImpl = options.fs || fs
  let ephemeralBytes = 0
  let otherBytes = 0
  let files = 0
  for (const file of paths.ephemeral) {
    try { const stats = fsImpl.statSync(file); ephemeralBytes += stats.size; files += 1 } catch { }
  }
  for (const file of [...paths.telemetry, paths.manifest]) {
    try { const stats = fsImpl.statSync(file); otherBytes += stats.size; files += 1 } catch { }
  }
  return { ephemeralBytes, otherBytes, files, managedBytes: ephemeralBytes + otherBytes }
}

function usageSnapshot(paths, options = {}) {
  const fsImpl = options.fs || fs
  const ledger = readUsageLedger(paths, fsImpl)
  const scanned = ledger.status === 'fresh' ? null : scanTaskSlotUsage(paths, options)
  const taskSlotBytes = ledger.status === 'fresh' ? ledger.value.taskSlotBytes : scanned.taskSlotBytes
  const fixed = fixedManagedUsage(paths, options)
  const ephemeralBudget = Number.isInteger(options.ephemeralMaxBytes) ? options.ephemeralMaxBytes : DEFAULT_EPHEMERAL_BYTES
  return {
    ledger,
    taskSlotBytes,
    actualManagedBytes: taskSlotBytes + fixed.managedBytes,
    capacityManagedBytes: taskSlotBytes + Math.max(fixed.ephemeralBytes, ephemeralBudget) +
      Math.max(fixed.otherBytes, TELEMETRY_TOTAL_MAX_BYTES + USAGE_LEDGER_MAX_BYTES),
    fixed
  }
}

function writeUsageLedger(paths, taskSlotBytes, options = {}) {
  const fsImpl = options.fs || fs
  const prior = readUsageLedger(paths, fsImpl)
  const value = {
    schemaVersion: TASK_RECOVERY_USAGE_SCHEMA,
    sequence: prior.status === 'fresh' ? prior.value.sequence + 1 : 1,
    updatedAt: new Date(nowMsFrom(options)).toISOString(),
    taskSlotBytes: Math.max(0, Math.trunc(taskSlotBytes)),
    source: String(options.usageSource || 'incremental'),
    lastMaintenanceAt: options.lastMaintenanceAt ||
      (prior.status === 'fresh' ? prior.value.lastMaintenanceAt : null) || null
  }
  value.payloadDigest = usageLedgerDigest(value)
  if (jsonBytes(value) > USAGE_LEDGER_MAX_BYTES) {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_USAGE_LEDGER_EXCEEDED', 'usage ledger exceeds its fixed budget')
  }
  return {
    value,
    ...writeFixedJsonSlot(paths.manifest, paths.manifestTemp, value, fsImpl, {
      allowVerifiedCopyFallback: true,
      replaceRetryDelaysMs: options.usageLedgerRenameRetryDelaysMs
    })
  }
}

function inspectTaskRecoveryStore(metaDir, options = {}) {
  const fsImpl = options.fs || fs
  const paths = storePaths(metaDir)
  const tasks = []
  let managedBytes = 0
  let managedFiles = 0
  let taskSlotBytes = 0
  let taskSlotFiles = 0
  const counts = { hot: 0, cold: 0, terminal: 0, invalid: 0 }
  const inventory = inventoryTaskDirectories(paths, options)
  for (const currentPaths of inventory.directories) {
    const read = readTaskSlots(currentPaths, null, fsImpl)
    for (const file of currentPaths.slots) {
      try {
        const stats = fsImpl.statSync(file)
        managedBytes += stats.size
        managedFiles += 1
        taskSlotBytes += stats.size
        taskSlotFiles += 1
      } catch { }
    }
    if (read.status !== 'fresh') { counts.invalid += 1; continue }
    const envelope = read.current.envelope
    counts[envelope.kind] += 1
    if (envelope.terminalAt) counts.terminal += 1
    tasks.push({
      recoveryKey: envelope.identity.recoveryKey,
      project: envelope.identity.project,
      taskId: envelope.identity.taskId,
      kind: envelope.kind,
      bytes: currentPaths.slots.reduce((sum, file) => {
        try { return sum + fsImpl.statSync(file).size } catch { return sum }
      }, 0),
      sequence: envelope.sequence,
      lastAccessedAt: envelope.lastAccessedAt,
      terminalAt: envelope.terminalAt || null,
      mutating: envelope.state?.turnLiveness?.inFlightOperation?.mutating === true
    })
  }
  for (const file of [...paths.ephemeral, paths.manifest, ...paths.telemetry]) {
    try { const stats = fsImpl.statSync(file); managedBytes += stats.size; managedFiles += 1 } catch { }
  }
  const reserveBytes = paths.reserve.reduce((sum, file) => {
    try { return sum + fsImpl.statSync(file).size } catch { return sum }
  }, 0)
  const expectedReserveBytes = Number.isInteger(options.reserveBytes) ? options.reserveBytes : DEFAULT_RESERVE_BYTES
  const expectedReserveSlotBytes = Math.floor(expectedReserveBytes / 2)
  const reserveSlots = paths.reserve.map(file => {
    try {
      const stats = fsImpl.statSync(file)
      const markerPresent = stats.isFile() && stats.size === expectedReserveSlotBytes &&
        reserveAllocationMarkerPresent(file, expectedReserveSlotBytes, fsImpl)
      return { file, bytes: stats.size, markerPresent, ready: markerPresent }
    } catch {
      return { file, bytes: 0, markerPresent: false, ready: false }
    }
  })
  const reserveReady = reserveBytes === expectedReserveBytes && reserveSlots.every(slot => slot.ready)
  const telemetrySlots = paths.telemetry.map(file => {
    try {
      const stats = fsImpl.statSync(file)
      return { file, bytes: stats.size, withinBudget: stats.isFile() && stats.size <= TELEMETRY_SEGMENT_MAX_BYTES }
    } catch {
      return { file, bytes: 0, withinBudget: true }
    }
  })
  const telemetryBytes = telemetrySlots.reduce((sum, slot) => sum + slot.bytes, 0)
  const telemetryWithinBudget = telemetrySlots.every(slot => slot.withinBudget) && telemetryBytes <= TELEMETRY_TOTAL_MAX_BYTES
  const ephemeral = readEphemeralRing(paths, fsImpl)
  const usageLedger = readUsageLedger(paths, fsImpl)
  const softBytes = options.softBytes || DEFAULT_SOFT_BYTES
  const hardBytes = options.hardBytes || DEFAULT_HARD_BYTES
  const sortedTasks = tasks.sort((left, right) => right.bytes - left.bytes)
  const pressure = managedBytes >= hardBytes
    ? 'hard'
    : (managedBytes >= softBytes ? 'soft' : 'normal')
  const disk = inspectDiskHeadroom(
    paths,
    (TASK_STATE_SLOT_MAX_BYTES * 3) + USAGE_LEDGER_MAX_BYTES,
    options
  )
  return {
    schemaVersion: TASK_RECOVERY_STATUS_SCHEMA,
    root: paths.root,
    managedBytes,
    managedFiles,
    taskSlotBytes,
    taskSlotFiles,
    inventoryComplete: !inventory.truncated,
    inventoryLimit: inventory.maxTaskDirectories,
    reserveBytes,
    expectedReserveBytes,
    reserveReady,
    reserveSlots,
    telemetryBytes,
    telemetryWithinBudget,
    telemetrySlots,
    diskBytes: managedBytes + reserveBytes,
    softBytes,
    hardBytes,
    pressure,
    disk,
    counts: {
      ...counts,
      ephemeral: ephemeral.status === 'fresh' ? ephemeral.current.ring.entries.length : 0
    },
    ephemeralStatus: ephemeral.status,
    usageLedgerStatus: usageLedger.status,
    usageLedgerTaskSlotBytes: usageLedger.status === 'fresh' ? usageLedger.value.taskSlotBytes : null,
    tasks: sortedTasks,
    topTasks: sortedTasks.slice(0, 10),
    nextStep: pressure === 'hard'
      ? {
          code: 'TASK_RECOVERY_HARD_PRESSURE',
          action: 'block-new-stateful-mutation',
          command: 'devcodex runtime maintenance --dry-run --json'
        }
      : (pressure === 'soft'
          ? {
              code: 'TASK_RECOVERY_SOFT_PRESSURE',
              action: 'preview-cache-maintenance',
              command: 'devcodex runtime maintenance --dry-run --json'
            }
          : {
              code: 'TASK_RECOVERY_HEALTHY',
              action: 'none',
              command: null
            })
  }
}

function diagnoseTaskRecoveryStore(metaDir, options = {}) {
  const fsImpl = options.fs || fs
  const paths = storePaths(metaDir)
  const exists = fsImpl.existsSync(paths.root)
  const status = inspectTaskRecoveryStore(metaDir, options)
  if (!exists) {
    return {
      schemaVersion: TASK_RECOVERY_DOCTOR_SCHEMA,
      status: 'N/A',
      root: paths.root,
      checks: [],
      store: status,
      nextSteps: [{
        code: 'TASK_RECOVERY_NOT_INITIALIZED',
        action: 'none',
        message: 'TaskRecoveryStoreV5 initializes on the first lifecycle persistence milestone.'
      }]
    }
  }

  const checks = []
  checks.push({
    id: 'task-inventory',
    status: status.inventoryComplete ? 'PASS' : 'BLOCK',
    observed: { complete: status.inventoryComplete, limit: status.inventoryLimit }
  })
  checks.push({
    id: 'telemetry-ring',
    status: status.telemetryWithinBudget ? 'PASS' : 'BLOCK',
    observed: {
      bytes: status.telemetryBytes,
      maximumBytes: TELEMETRY_TOTAL_MAX_BYTES,
      slots: status.telemetrySlots
    }
  })
  checks.push({
    id: 'task-slots',
    status: status.counts.invalid === 0 ? 'PASS' : 'BLOCK',
    observed: { invalidTasks: status.counts.invalid }
  })
  checks.push({
    id: 'usage-ledger',
    status: status.usageLedgerStatus === 'fresh' &&
      status.usageLedgerTaskSlotBytes === status.taskSlotBytes
      ? 'PASS'
      : 'WARN',
    observed: {
      ledgerStatus: status.usageLedgerStatus,
      ledgerTaskSlotBytes: status.usageLedgerTaskSlotBytes,
      scannedTaskSlotBytes: status.taskSlotBytes
    }
  })
  checks.push({
    id: 'ephemeral-ring',
    status: ['fresh', 'missing'].includes(status.ephemeralStatus) ? 'PASS' : 'WARN',
    observed: { status: status.ephemeralStatus, entries: status.counts.ephemeral }
  })
  const durableTaskCount = status.counts.hot + status.counts.cold
  checks.push({
    id: 'closeout-reserve',
    status: durableTaskCount === 0 && status.reserveBytes === 0
      ? 'N/A'
      : (status.reserveReady ? 'PASS' : 'BLOCK'),
    observed: {
      actualBytes: status.reserveBytes,
      expectedBytes: status.expectedReserveBytes,
      ready: status.reserveReady,
      slots: status.reserveSlots
    }
  })
  checks.push({
    id: 'capacity-pressure',
    status: status.pressure === 'hard' ? 'BLOCK' : (status.pressure === 'soft' ? 'WARN' : 'PASS'),
    observed: {
      pressure: status.pressure,
      managedBytes: status.managedBytes,
      softBytes: status.softBytes,
      hardBytes: status.hardBytes
    }
  })
  checks.push({
    id: 'physical-disk-headroom',
    status: status.disk.status === 'PASS'
      ? 'PASS'
      : (status.disk.status === 'BLOCK' ? 'BLOCK' : 'WARN'),
    observed: status.disk
  })

  const staleFixedArtifacts = []
  for (const file of [paths.manifestTemp, path.join(paths.root, 'ephemeral-next.tmp'), paths.storeLock, paths.ephemeralLock]) {
    try {
      const stats = fsImpl.statSync(file)
      staleFixedArtifacts.push({ file, ageMs: Math.max(0, nowMsFrom(options) - stats.mtimeMs) })
    } catch { }
  }
  checks.push({
    id: 'fixed-temp-locks',
    status: staleFixedArtifacts.some(item => item.ageMs > DEFAULT_LOCK_LEASE_MS) ? 'WARN' : 'PASS',
    observed: { artifacts: staleFixedArtifacts }
  })

  const overall = checks.some(check => check.status === 'BLOCK')
    ? 'BLOCK'
    : (checks.some(check => check.status === 'WARN') ? 'WARN' : 'PASS')
  const nextSteps = []
  if (checks.find(check => check.id === 'usage-ledger')?.status === 'WARN') {
    nextSteps.push({
      code: 'TASK_RECOVERY_USAGE_RECONCILE_REQUIRED',
      action: 'preview-maintenance',
      command: 'devcodex runtime maintenance --dry-run --json'
    })
  }
  if (status.counts.invalid > 0) {
    nextSteps.push({
      code: 'TASK_RECOVERY_SLOT_REPAIR_REQUIRED',
      action: 'manual-recovery',
      message: 'Inspect invalid task A/B slots; do not delete legacy or live task state automatically.'
    })
  }
  if (!status.inventoryComplete) {
    nextSteps.push({
      code: 'TASK_RECOVERY_INVENTORY_BOUND_REACHED',
      action: 'rerun-with-explicit-scan-bound',
      message: 'Diagnostics stopped at the scan safety bound; no task admission cap was applied.'
    })
  }
  if (!status.reserveReady && durableTaskCount > 0) {
    nextSteps.push({
      code: 'TASK_RECOVERY_RESERVE_REPAIR_REQUIRED',
      action: 'restart-and-verify',
      message: 'Restart the active host after updating DevCodex, then rerun runtime doctor before stateful mutation.'
    })
  }
  if (status.pressure !== 'normal') nextSteps.push(status.nextStep)
  if (status.disk.status !== 'PASS') {
    nextSteps.push({
      code: status.disk.status === 'BLOCK'
        ? 'TASK_RECOVERY_DISK_HEADROOM_REQUIRED'
        : 'TASK_RECOVERY_DISK_CAPACITY_UNVERIFIED',
      action: status.disk.status === 'BLOCK' ? 'free-disk-space' : 'verify-filesystem-capacity',
      message: status.disk.status === 'BLOCK'
        ? 'Free physical disk space before starting another stateful mutation.'
        : 'Verify filesystem capacity support before starting another stateful mutation.'
    })
  }
  return {
    schemaVersion: TASK_RECOVERY_DOCTOR_SCHEMA,
    status: overall,
    root: paths.root,
    checks,
    store: status,
    nextSteps
  }
}

function removeV5File(file, root, fsImpl) {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_MAINTENANCE_PATH_ESCAPE', `maintenance path escapes V5 root: ${file}`)
  }
  fsImpl.unlinkSync(file)
}

function removeEmptyV5Directory(dir, root, fsImpl) {
  const relative = path.relative(path.resolve(root), path.resolve(dir))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_MAINTENANCE_PATH_ESCAPE', `maintenance directory escapes V5 root: ${dir}`)
  }
  try { fsImpl.rmdirSync(dir) } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error
  }
}

function hasSafeColdCheckpoint(envelope) {
  const checkpoint = envelope?.state?.turnLiveness?.checkpoint
  if (!checkpoint || !String(checkpoint.phase || '').trim()) return false
  return Boolean(
    String(checkpoint.nextAction || '').trim() ||
    String(checkpoint.resumeToken || '').trim() ||
    String(checkpoint.idempotencyKey || '').trim() ||
    (Array.isArray(checkpoint.artifactPaths) && checkpoint.artifactPaths.length)
  )
}

function maintainWriterOwnedArtifacts(paths, inventory, actions, failures, options = {}) {
  const fsImpl = options.fs || fs
  const apply = options.apply === true
  const nowMs = nowMsFrom(options)
  const candidates = [
    paths.manifestTemp,
    ...inventory.directories.map(currentPaths => currentPaths.temp)
  ]
  for (const file of candidates) {
    try {
      const stats = fsImpl.statSync(file)
      actions.push({ action: 'remove-writer-temp', file, bytes: stats.size })
      if (apply) removeV5File(file, paths.root, fsImpl)
    } catch (error) {
      if (error?.code !== 'ENOENT') failures.push({
        action: 'remove-writer-temp',
        file,
        errorCode: error.code || 'LIFECYCLE_TEMP_CLEANUP_FAILED',
        message: error.message
      })
    }
  }
  for (const currentPaths of inventory.directories) {
    try {
      const record = lockRecord(currentPaths.lock, fsImpl)
      if (!recoverableExpiredLock(
        currentPaths.lock,
        record,
        nowMs,
        options.lockLeaseMs || DEFAULT_LOCK_LEASE_MS,
        fsImpl,
        options
      )) continue
      const stats = fsImpl.statSync(currentPaths.lock)
      actions.push({ action: 'remove-expired-task-lock', file: currentPaths.lock, bytes: stats.size })
      if (apply) removeV5File(currentPaths.lock, paths.root, fsImpl)
    } catch (error) {
      if (error?.code !== 'ENOENT') failures.push({
        action: 'remove-expired-task-lock',
        file: currentPaths.lock,
        errorCode: error.code || 'LIFECYCLE_LOCK_CLEANUP_FAILED',
        message: error.message
      })
    }
  }
}

function maintainEphemeralCache(paths, actions, failures, options = {}) {
  const fsImpl = options.fs || fs
  const apply = options.apply === true
  const lock = acquireLock(paths.ephemeralLock, options)
  if (!lock) {
    failures.push({ action: 'expire-ephemeral', errorCode: 'LIFECYCLE_EPHEMERAL_LOCK_TIMEOUT' })
    return
  }
  try {
    const tempFile = path.join(paths.root, 'ephemeral-next.tmp')
    try {
      const stats = fsImpl.statSync(tempFile)
      actions.push({ action: 'remove-writer-temp', file: tempFile, bytes: stats.size })
      if (apply) removeV5File(tempFile, paths.root, fsImpl)
    } catch (error) {
      if (error?.code !== 'ENOENT') failures.push({
        action: 'remove-writer-temp',
        file: tempFile,
        errorCode: error.code || 'LIFECYCLE_TEMP_CLEANUP_FAILED',
        message: error.message
      })
    }
    const current = readEphemeralRing(paths, fsImpl)
    if (current.status === 'missing') return
    if (current.status !== 'fresh') {
      failures.push({ action: 'expire-ephemeral', errorCode: 'LIFECYCLE_EPHEMERAL_RING_INVALID' })
      return
    }
    const nowMs = nowMsFrom(options)
    const ttlMs = options.ephemeralTtlMs || DEFAULT_EPHEMERAL_TTL_MS
    const prior = current.current.ring
    const entries = prior.entries.filter(entry => {
      const lastUsedMs = Date.parse(String(entry?.lastUsedAt || ''))
      return Number.isFinite(lastUsedMs) && nowMs - lastUsedMs <= ttlMs
    })
    if (entries.length === prior.entries.length) return
    actions.push({
      action: 'expire-ephemeral',
      removedEntries: prior.entries.length - entries.length,
      retainedEntries: entries.length
    })
    if (!apply) return
    const ring = {
      schemaVersion: TASK_RECOVERY_EPHEMERAL_SCHEMA,
      sequence: prior.sequence + 1,
      updatedAt: new Date(nowMs).toISOString(),
      entries
    }
    ring.payloadDigest = ringDigest(ring)
    const targetIndex = prior.sequence % 2
    writeFixedJsonSlot(paths.ephemeral[targetIndex], tempFile, ring, fsImpl)
  } catch (error) {
    failures.push({
      action: 'expire-ephemeral',
      errorCode: error.code || 'LIFECYCLE_EPHEMERAL_MAINTENANCE_FAILED',
      message: error.message
    })
  } finally {
    releaseLock(lock, fsImpl)
  }
}

function maintainTaskRecoveryStore(metaDir, options = {}) {
  const fsImpl = options.fs || fs
  const paths = storePaths(metaDir)
  const ownsStoreLock = options.storeLockHeld !== true
  let storeLock
  try {
    storeLock = ownsStoreLock ? acquireLock(paths.storeLock, options) : { inherited: true }
  } catch (error) {
    return {
      schemaVersion: 'TaskRecoveryMaintenanceV5',
      mode: options.apply === true ? 'apply' : 'dry-run',
      status: 'error',
      errorCode: error.code || 'LIFECYCLE_STORE_LEASE_FAILED',
      message: error.message
    }
  }
  if (!storeLock) {
    return { schemaVersion: 'TaskRecoveryMaintenanceV5', mode: options.apply === true ? 'apply' : 'dry-run', status: 'error', errorCode: 'LIFECYCLE_STORE_LEASE_CONFLICT' }
  }
  try {
    const nowMs = nowMsFrom(options)
    const apply = options.apply === true
    const excludedKey = String(options.excludedRecoveryKey || '')
    const actions = []
    const failures = []
    let reclaimedBytes = 0
    const before = inspectTaskRecoveryStore(metaDir, options)
    const inventory = inventoryTaskDirectories(paths, options)
    if (inventory.truncated) {
      return {
        schemaVersion: 'TaskRecoveryMaintenanceV5',
        mode: apply ? 'apply' : 'dry-run',
        status: 'error',
        errorCode: 'LIFECYCLE_TASK_INVENTORY_LIMIT_REACHED',
        inventoryLimit: inventory.maxTaskDirectories,
        actions,
        failures,
        before,
        after: before
      }
    }
    const usageLedgerNeedsReconcile = before.usageLedgerStatus !== 'fresh' ||
      before.usageLedgerTaskSlotBytes !== before.taskSlotBytes
    if (usageLedgerNeedsReconcile) {
      actions.push({
        action: 'reconcile-usage-ledger',
        ledgerStatus: before.usageLedgerStatus,
        ledgerTaskSlotBytes: before.usageLedgerTaskSlotBytes,
        scannedTaskSlotBytes: before.taskSlotBytes,
        ledgerAdjustmentBytes: Number.isInteger(before.usageLedgerTaskSlotBytes)
          ? before.taskSlotBytes - before.usageLedgerTaskSlotBytes
          : null
      })
    }
    maintainWriterOwnedArtifacts(paths, inventory, actions, failures, { ...options, apply })
    maintainEphemeralCache(paths, actions, failures, { ...options, apply })
    const taskRecords = inventory.directories
      .map(currentPaths => ({ currentPaths, read: readTaskSlots(currentPaths, null, fsImpl) }))
      .filter(item => item.read.status === 'fresh')
      .sort((left, right) => {
        const leftMs = Date.parse(String(left.read.current.envelope.lastAccessedAt || left.read.current.envelope.committedAt || ''))
        const rightMs = Date.parse(String(right.read.current.envelope.lastAccessedAt || right.read.current.envelope.committedAt || ''))
        return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0)
      })
    for (const { currentPaths, read } of taskRecords) {
    const envelope = read.current.envelope
    if (envelope.identity.recoveryKey === excludedKey || envelope.state?.turnLiveness?.inFlightOperation?.mutating === true) continue
    const lastMs = Date.parse(String(envelope.lastAccessedAt || envelope.committedAt || ''))
    const terminalMs = Date.parse(String(envelope.terminalAt || ''))
    if (envelope.terminalAt && Number.isFinite(terminalMs) && nowMs - terminalMs >= (options.terminalGraceMs || DEFAULT_TERMINAL_GRACE_MS)) {
      for (const file of currentPaths.slots) {
        try {
          const bytes = fsImpl.statSync(file).size
          actions.push({ action: 'retire-terminal', file, bytes, recoveryKey: envelope.identity.recoveryKey })
          if (apply) { removeV5File(file, paths.root, fsImpl); reclaimedBytes += bytes }
        } catch { }
      }
      if (apply) {
        removeEmptyV5Directory(currentPaths.dir, paths.root, fsImpl)
        removeEmptyV5Directory(path.dirname(currentPaths.dir), paths.root, fsImpl)
      }
      continue
    }
    if (envelope.kind === 'hot' && hasSafeColdCheckpoint(envelope) &&
        Number.isFinite(lastMs) && nowMs - lastMs >= (options.coldAfterMs || DEFAULT_COLD_AFTER_MS)) {
      try {
        const cold = buildColdResumeStub(envelope.state)
        const next = {
          schemaVersion: TASK_RECOVERY_STATE_SCHEMA,
          kind: 'cold',
          sequence: envelope.sequence + 1,
          committedAt: new Date(nowMs).toISOString(),
          lastAccessedAt: new Date(nowMs).toISOString(),
          terminalAt: envelope.terminalAt || null,
          identity: envelope.identity,
          semanticDigest: digestValue(semanticLifecycleProjection(cold.state)),
          state: cold.state
        }
        next.payloadDigest = envelopeDigest(next)
        actions.push({ action: 'coldify', recoveryKey: envelope.identity.recoveryKey, bytesBefore: currentPaths.slots.reduce((sum, file) => {
          try { return sum + fsImpl.statSync(file).size } catch { return sum }
        }, 0), bytesAfter: jsonBytes(next) })
        if (apply) {
          const lock = acquireLock(currentPaths.lock, options)
          if (lock) {
            try {
              const activeIndex = path.resolve(read.current.file) === path.resolve(currentPaths.slots[0]) ? 0 : 1
              const inactiveIndex = activeIndex === 0 ? 1 : 0
              writeFixedJsonSlot(currentPaths.slots[inactiveIndex], currentPaths.temp, next, fsImpl)
              const verified = readTaskSlots(currentPaths, envelope.identity, fsImpl)
              if (verified.status !== 'fresh' || verified.current.envelope.sequence !== next.sequence ||
                  verified.current.envelope.kind !== 'cold') {
                throw new TaskRecoveryStoreV5Error(
                  'LIFECYCLE_COLDIFY_READBACK_MISMATCH',
                  'cold recovery slot did not become the verified current state'
                )
              }
              removeV5File(currentPaths.slots[activeIndex], paths.root, fsImpl)
            } finally { releaseLock(lock, fsImpl) }
          } else {
            failures.push({
              action: 'coldify',
              recoveryKey: envelope.identity.recoveryKey,
              errorCode: 'LIFECYCLE_TASK_LEASE_CONFLICT'
            })
          }
        }
      } catch (error) {
        failures.push({
          action: 'coldify',
          recoveryKey: envelope.identity.recoveryKey,
          errorCode: error.code || 'LIFECYCLE_COLDIFY_FAILED',
          message: error.message
        })
      }
    }
    }
    let after = apply ? inspectTaskRecoveryStore(metaDir, options) : before
    if (apply) {
      writeUsageLedger(paths, after.taskSlotBytes, {
        ...options,
        usageSource: 'maintenance-reconcile',
        lastMaintenanceAt: new Date(nowMs).toISOString()
      })
      after = inspectTaskRecoveryStore(metaDir, options)
    }
    return {
      schemaVersion: 'TaskRecoveryMaintenanceV5',
      mode: apply ? 'apply' : 'dry-run',
      status: failures.length ? 'partial' : 'complete',
      actions,
      failures,
      reclaimedBytes: apply ? Math.max(reclaimedBytes, before.managedBytes - after.managedBytes) : 0,
      before,
      after
    }
  } finally {
    if (ownsStoreLock) releaseLock(storeLock, fsImpl)
  }
}

function commitTaskEnvelope(metaDir, identity, state, options = {}) {
  const fsImpl = options.fs || fs
  const paths = storePaths(metaDir)
  const currentPaths = taskPaths(paths, identity.recoveryKey)
  let candidateSemanticDigest
  try {
    candidateSemanticDigest = digestValue(semanticLifecycleProjection(state))
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'LIFECYCLE_STATE_PROJECTION_FAILED', message: error.message, identity }
  }
  if (options.force !== true) {
    const cached = cachedSemanticNoop(metaDir, currentPaths, candidateSemanticDigest, fsImpl)
    if (cached) {
      return {
        schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
        status: 'semantic-noop',
        fullStateWrite: false,
        sequence: cached.sequence,
        identity
      }
    }
    const optimistic = readTaskSlots(currentPaths, identity, fsImpl)
    if (optimistic.status === 'identity-mismatch') return { status: 'error', errorCode: optimistic.errorCode, identity }
    if (optimistic.status === 'fresh' && optimistic.current.envelope.semanticDigest === candidateSemanticDigest) {
      rememberSemanticState(metaDir, currentPaths, candidateSemanticDigest, optimistic.current.envelope.sequence, fsImpl)
      return {
        schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
        status: 'semantic-noop',
        fullStateWrite: false,
        sequence: optimistic.current.envelope.sequence,
        identity
      }
    }
  }
  const ownsStoreLock = options.storeLockHeld !== true
  let storeLock = ownsStoreLock ? null : { inherited: true }
  if (ownsStoreLock) {
    try {
      storeLock = acquireLock(paths.storeLock, options)
    } catch (error) {
      return {
        status: 'error',
        errorCode: error.code || 'LIFECYCLE_STORE_LEASE_FAILED',
        message: error.message,
        identity
      }
    }
  }
  if (!storeLock) return { status: 'error', errorCode: 'LIFECYCLE_STORE_LEASE_CONFLICT', identity }
  try {
    let prior = readTaskSlots(currentPaths, identity, fsImpl)
    if (prior.status === 'identity-mismatch') return { status: 'error', errorCode: prior.errorCode, identity }
    if (prior.status === 'fresh' && prior.current.envelope.semanticDigest === candidateSemanticDigest && options.force !== true) {
      rememberSemanticState(metaDir, currentPaths, candidateSemanticDigest, prior.current.envelope.sequence, fsImpl)
      return {
        schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
        status: 'semantic-noop',
        fullStateWrite: false,
        sequence: prior.current.envelope.sequence,
        identity
      }
    }
    const compact = compactLifecycleStateV5(state)
    const mutationPreflight = options.reason === 'mutation-preflight'
    const admissionPreflight = options.reason === 'admission-preflight'
    const durablePreflight = mutationPreflight || admissionPreflight
    if (mutationPreflight && prior.current?.envelope?.recordType === 'mutation-preflight') {
      return {
        status: 'error',
        errorCode: 'LIFECYCLE_PREFLIGHT_PRIOR_OPERATION_OPEN',
        message: 'a prior mutation preflight must close or reconcile before a new preflight',
        identity
      }
    }
    if (mutationPreflight && compact.state?.turnLiveness?.inFlightOperation?.mutating !== true) {
      return {
        status: 'error',
        errorCode: 'LIFECYCLE_PREFLIGHT_MUTATION_RECORD_REQUIRED',
        message: 'mutation preflight requires a durable mutating in-flight record',
        identity
      }
    }
    if (admissionPreflight &&
        (compact.state?.admissionTransaction?.schemaVersion !== TASK_ADMISSION_TRANSACTION_SCHEMA ||
         compact.state?.admissionTransaction?.phase !== 'prepared')) {
      return {
        status: 'error',
        errorCode: 'LIFECYCLE_ADMISSION_PREFLIGHT_RECORD_REQUIRED',
        message: 'admission preflight requires one durable prepared TaskAdmissionTransactionV1 record',
        identity
      }
    }
    const preflight = mutationPreflight ? buildMutationPreflightState(compact.state) : null
    const persistedState = preflight ? preflight.state : compact.state
    const semanticDigest = digestValue(semanticLifecycleProjection(persistedState))
    let sequence = prior.status === 'fresh' ? prior.current.envelope.sequence + 1 : 1
    const nowMs = nowMsFrom(options)
    const taskStatus = String(identity.taskStatus || 'active')
    const terminal = ['completed', 'rejected', 'terminal'].includes(taskStatus)
    const envelope = {
      schemaVersion: TASK_RECOVERY_STATE_SCHEMA,
      kind: 'hot',
      ...(mutationPreflight
        ? { recordType: 'mutation-preflight', baseSequence: prior.status === 'fresh' ? prior.current.envelope.sequence : 0 }
        : {}),
      sequence,
      committedAt: new Date(nowMs).toISOString(),
      lastAccessedAt: new Date(nowMs).toISOString(),
      terminalAt: terminal ? new Date(nowMs).toISOString() : null,
      identity,
      semanticDigest,
      state: persistedState
    }
    envelope.payloadDigest = envelopeDigest(envelope)
    const taskSlotSerialization = { compact: true }
    const serializedBytes = Buffer.byteLength(serializeFixedJsonSlot(envelope, taskSlotSerialization), 'utf8')
    if (serializedBytes > TASK_STATE_SLOT_MAX_BYTES) {
      return { status: 'error', errorCode: 'LIFECYCLE_STATE_PAYLOAD_EXCEEDED', bytes: serializedBytes, identity }
    }
    let usage = usageSnapshot(paths, options)
    const inactiveIndex = prior.status === 'fresh'
      ? (path.resolve(prior.current.file) === path.resolve(currentPaths.slots[0]) ? 1 : 0)
      : 0
    let replacedBytes = 0
    try { replacedBytes = fsImpl.statSync(currentPaths.slots[inactiveIndex]).size } catch { }
    let projectedTaskSlotBytes = usage.taskSlotBytes - replacedBytes + serializedBytes
    let projectedBytes = usage.capacityManagedBytes - usage.taskSlotBytes + projectedTaskSlotBytes
    let maintenance = null
    const softBytes = options.softBytes || DEFAULT_SOFT_BYTES
    const hardBytes = options.hardBytes || DEFAULT_HARD_BYTES
    const lastMaintenanceMs = usage.ledger.status === 'fresh'
      ? Date.parse(String(usage.ledger.value.lastMaintenanceAt || ''))
      : NaN
    const maintenanceDue = projectedBytes > hardBytes || !Number.isFinite(lastMaintenanceMs) ||
      nowMs - lastMaintenanceMs >= (options.maintenanceThrottleMs || DEFAULT_MAINTENANCE_THROTTLE_MS)
    if (projectedBytes > softBytes && maintenanceDue) {
      maintenance = maintainTaskRecoveryStore(metaDir, {
        ...options,
        apply: true,
        excludedRecoveryKey: identity.recoveryKey,
        storeLockHeld: true
      })
      usage = usageSnapshot(paths, options)
      try { replacedBytes = fsImpl.statSync(currentPaths.slots[inactiveIndex]).size } catch { replacedBytes = 0 }
      projectedTaskSlotBytes = usage.taskSlotBytes - replacedBytes + serializedBytes
      projectedBytes = usage.capacityManagedBytes - usage.taskSlotBytes + projectedTaskSlotBytes
    }
    if (projectedBytes > hardBytes) {
      const pressureStatus = inspectTaskRecoveryStore(metaDir, options)
      if (CLOSEOUT_REASONS.has(options.reason)) {
        try {
          const closeout = writeEmergencyCloseout(paths, {
            observedAt: new Date(nowMs).toISOString(),
            status: options.closeoutStatus || 'needs-reconcile',
            reason: String(options.reason || ''),
            identity,
            admissionTransaction: compact.state?.admissionTransaction || null,
            fencedWriteOwner: compact.state?.fencedWriteOwner || null,
            workflowTaskTerminalReceipt: compact.state?.workflowTaskTerminalReceipt || null,
            inFlightOperation: compact.state?.turnLiveness?.inFlightOperation || null,
            lastMutationCloseout: compact.state?.turnLiveness?.lastMutationCloseout || null,
            stateDigest: compact.payloadDigest
          }, options)
          return {
            schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
            ...closeout,
            fullStateWrite: false,
            errorCode: 'LIFECYCLE_STORAGE_BUDGET_EXCEEDED',
            actualBytes: usage.actualManagedBytes,
            projectedBytes,
            softBytes: options.softBytes || DEFAULT_SOFT_BYTES,
            hardBytes: options.hardBytes || DEFAULT_HARD_BYTES,
            reserveBytes: pressureStatus.reserveBytes,
            counts: pressureStatus.counts,
            topTasks: pressureStatus.topTasks,
            identity,
            maintenance
          }
        } catch (error) {
          return {
            status: 'error',
            errorCode: 'LIFECYCLE_CLOSEOUT_WRITE_FAILED',
            causeCode: error.code || 'LIFECYCLE_CLOSEOUT_WRITE_FAILED',
            message: error.message,
            identity
          }
        }
      }
      return {
        schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
        status: 'error',
        errorCode: 'LIFECYCLE_STORAGE_BUDGET_EXCEEDED',
        actualBytes: usage.actualManagedBytes,
        projectedBytes,
        softBytes: options.softBytes || DEFAULT_SOFT_BYTES,
        hardBytes: options.hardBytes || DEFAULT_HARD_BYTES,
        reserveBytes: paths.reserve.reduce((sum, file) => {
          try { return sum + fsImpl.statSync(file).size } catch { return sum }
        }, 0),
        counts: pressureStatus.counts,
        identity,
        maintenance,
        topTasks: pressureStatus.topTasks
      }
    }
    const disk = inspectDiskHeadroom(
      paths,
      serializedBytes + USAGE_LEDGER_MAX_BYTES + (compact.bytes * 2),
      options
    )
    if (durablePreflight && disk.status !== 'PASS') {
      const pressureStatus = inspectTaskRecoveryStore(metaDir, options)
      return {
        schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
        status: 'error',
        errorCode: disk.status === 'BLOCK'
          ? 'LIFECYCLE_DISK_HEADROOM_INSUFFICIENT'
          : 'LIFECYCLE_DISK_CAPACITY_UNVERIFIED',
        identity,
        disk,
        actualBytes: usage.actualManagedBytes,
        projectedBytes,
        softBytes: options.softBytes || DEFAULT_SOFT_BYTES,
        hardBytes: options.hardBytes || DEFAULT_HARD_BYTES,
        reserveBytes: pressureStatus.reserveBytes,
        counts: pressureStatus.counts,
        topTasks: pressureStatus.topTasks,
        maintenance
      }
    }
    let reserve
    try { reserve = ensureReserve(paths, options) } catch (error) {
      if (durablePreflight) {
        return {
          schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
          status: 'error',
          errorCode: 'LIFECYCLE_RESERVE_INIT_FAILED',
          causeCode: error.code || 'LIFECYCLE_RESERVE_INIT_FAILED',
          message: error.message,
          identity,
          disk
        }
      }
      reserve = {
        status: 'warn',
        errorCode: 'LIFECYCLE_RESERVE_INIT_FAILED',
        causeCode: error.code || 'LIFECYCLE_RESERVE_INIT_FAILED',
        message: error.message
      }
    }
    let write
    try {
      writeUsageLedger(paths, projectedTaskSlotBytes, { ...options, usageSource: 'commit-precharge' })
      write = writeFixedJsonSlot(
        currentPaths.slots[inactiveIndex],
        currentPaths.temp,
        envelope,
        fsImpl,
        taskSlotSerialization
      )
    } catch (error) {
      try { writeUsageLedger(paths, usage.taskSlotBytes, { ...options, usageSource: 'commit-rollback' }) } catch { }
      if (CLOSEOUT_REASONS.has(options.reason)) {
        try {
          const closeout = writeEmergencyCloseout(paths, {
            observedAt: new Date(nowMs).toISOString(),
            status: options.closeoutStatus || 'needs-reconcile',
            reason: String(options.reason || ''),
            identity,
            admissionTransaction: compact.state?.admissionTransaction || null,
            fencedWriteOwner: compact.state?.fencedWriteOwner || null,
            workflowTaskTerminalReceipt: compact.state?.workflowTaskTerminalReceipt || null,
            inFlightOperation: compact.state?.turnLiveness?.inFlightOperation || null,
            lastMutationCloseout: compact.state?.turnLiveness?.lastMutationCloseout || null,
            stateDigest: compact.payloadDigest,
            primaryErrorCode: error.code || 'LIFECYCLE_STATE_COMMIT_FAILED'
          }, options)
          return {
            schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
            ...closeout,
            fullStateWrite: false,
            errorCode: error.code || 'LIFECYCLE_STATE_COMMIT_FAILED',
            identity,
            disk,
            maintenance
          }
        } catch (closeoutError) {
          return {
            schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
            status: 'error',
            errorCode: 'LIFECYCLE_CLOSEOUT_WRITE_FAILED',
            message: closeoutError.message,
            primaryErrorCode: error.code || 'LIFECYCLE_STATE_COMMIT_FAILED',
            identity,
            disk
          }
        }
      }
      throw error
    }
    prior = readTaskSlots(currentPaths, identity, fsImpl)
    if (prior.status !== 'fresh' || prior.current.envelope.sequence !== sequence) {
      return { status: 'error', errorCode: 'LIFECYCLE_STATE_READBACK_MISMATCH', identity }
    }
    rememberSemanticState(metaDir, currentPaths, semanticDigest, sequence, fsImpl)
    return {
      schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
      status: 'committed',
      fullStateWrite: true,
      sequence,
      semanticDigest,
      identity,
      slot: path.basename(write.file),
      bytes: write.bytes,
      sourceBytes: compact.sourceBytes,
      compactBytes: compact.bytes,
      targetBytes: compact.targetBytes,
      pressure: projectedBytes > (options.softBytes || DEFAULT_SOFT_BYTES) ? 'soft' : 'normal',
      actualBytes: usage.actualManagedBytes,
      projectedBytes,
      softBytes: options.softBytes || DEFAULT_SOFT_BYTES,
      hardBytes: options.hardBytes || DEFAULT_HARD_BYTES,
      reserve,
      disk,
      maintenance,
      recordType: mutationPreflight ? 'mutation-preflight' : 'state',
      preflightBytes: preflight?.bytes || 0,
      state: compact.state
    }
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'LIFECYCLE_STATE_COMMIT_FAILED', message: error.message, details: error.details, identity }
  } finally {
    if (ownsStoreLock) releaseLock(storeLock, fsImpl)
  }
}

function writeSessionMapping(paths, identity, sessionKey, state, options = {}) {
  const ownerKey = sessionOwnerKeys({
    sessionKey,
    hostSessionDigest: options.hostSessionDigest
  }).primary
  if (!ownerKey) return { status: 'skipped', reasonCode: 'session-key-missing' }
  const ephemeralState = identity?.recoveryKey
    ? null
    : (options.ephemeralStateOverride || buildEphemeralStub(state))
  const entry = {
    schemaVersion: 'TaskRecoverySessionLeaseV1',
    ownerKey,
    sessionKeyDigest: ownerKey,
    taskKey: identity?.recoveryKey || null,
    identity: identity || null,
    lastUsedAt: new Date(nowMsFrom(options)).toISOString(),
    state: identity?.recoveryKey ? null : ephemeralState,
    semanticDigest: identity?.recoveryKey
      ? digestValue({ recoveryKey: identity.recoveryKey })
      : digestValue(semanticLifecycleProjection(ephemeralState))
  }
  if (jsonBytes(entry) > EPHEMERAL_ENTRY_MAX_BYTES) {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_EPHEMERAL_ENTRY_EXCEEDED', 'session lease exceeds 8 KiB')
  }
  return updateEphemeralRing(paths, entry, options)
}

function commitTaskRecoveryState(input = {}, options = {}) {
  const paths = storePaths(input.metaDir)
  const state = input.state
  const sessionKey = String(input.sessionKey || '')
  let identity = null
  try {
    if (input.identity?.taskId) identity = normalizeIdentity(input.identity)
    else if (input.identity?.activeRoot && input.identity?.project) identity = normalizeIdentity(input.identity, { allowEphemeral: true })
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'LIFECYCLE_TASK_IDENTITY_REQUIRED', message: error.message }
  }
  if (!identity?.recoveryKey) {
    try {
      const compact = compactLifecycleStateV5(state)
      const mutationPreflight = options.reason === 'mutation-preflight'
      if (mutationPreflight && compact.state?.turnLiveness?.inFlightOperation?.mutating !== true) {
        return {
          status: 'error',
          errorCode: 'LIFECYCLE_PREFLIGHT_MUTATION_RECORD_REQUIRED',
          message: 'ephemeral mutation preflight requires one mutating in-flight record',
          identity
        }
      }
      const preflight = mutationPreflight ? buildMutationPreflightState(compact.state) : null
      const mapping = writeSessionMapping(paths, null, sessionKey, state, {
        ...options,
        hostSessionDigest: input.hostSessionDigest,
        ...(preflight ? { ephemeralStateOverride: preflight.state } : {})
      })
      return {
        schemaVersion: TASK_RECOVERY_COMMIT_SCHEMA,
        status: mapping.status === 'persisted'
          ? 'ephemeral-stub'
          : (mapping.status === 'semantic-noop' ? 'semantic-noop' : mapping.status),
        fullStateWrite: false,
        identity,
        mapping,
        state: compact.state,
        sourceBytes: compact.sourceBytes,
        compactBytes: compact.bytes,
        ...(mutationPreflight
          ? { recordType: 'mutation-preflight', preflightBytes: preflight.bytes }
          : {})
      }
    } catch (error) {
      return { status: 'error', errorCode: error.code || 'LIFECYCLE_EPHEMERAL_WRITE_FAILED', message: error.message }
    }
  }
  const commit = commitTaskEnvelope(input.metaDir, identity, state, options)
  if (commit.status === 'committed' ||
      (commit.status === 'semantic-noop' && options.touchSessionMapping === true)) {
    try {
      commit.mapping = writeSessionMapping(paths, identity, sessionKey, state, {
        ...options,
        hostSessionDigest: input.hostSessionDigest
      })
    } catch (error) {
      commit.mapping = { status: 'warn', errorCode: error.code || 'LIFECYCLE_SESSION_MAPPING_FAILED', message: error.message }
    }
  } else if (commit.status === 'semantic-noop') {
    commit.mapping = { status: 'semantic-noop', fullStateWrite: false }
  }
  return commit
}

function readTaskRecoveryState(input = {}, options = {}) {
  const fsImpl = options.fs || fs
  const paths = storePaths(input.metaDir)
  let identity = null
  if (input.identity?.taskId) {
    try { identity = normalizeIdentity(input.identity) } catch (error) {
      return { status: 'error', errorCode: error.code, message: error.message }
    }
  }
  if (identity) {
    const read = readTaskSlots(taskPaths(paths, identity.recoveryKey), identity, fsImpl)
    if (read.status !== 'fresh') return read
    return {
      status: 'fresh',
      state: materializeRecoveryState(read),
      envelope: read.current.envelope,
      identity
    }
  }
  let ownerKeys
  try {
    ownerKeys = sessionOwnerKeys(input)
  } catch (error) {
    return { status: 'error', errorCode: error.code, message: error.message }
  }
  if (!ownerKeys.primary) return { status: 'missing', errorCode: 'LIFECYCLE_SESSION_KEY_REQUIRED' }
  const ring = readEphemeralRing(paths, fsImpl)
  if (ring.status !== 'fresh') return ring
  const entry = ring.current.ring.entries.find(item => item.ownerKey === ownerKeys.primary) ||
    (ownerKeys.legacy
      ? ring.current.ring.entries.find(item => item.ownerKey === ownerKeys.legacy)
      : null)
  if (!entry) return { status: 'missing', errorCode: 'LIFECYCLE_SESSION_MAPPING_MISSING' }
  const expected = input.expectedIdentity?.activeRoot && input.expectedIdentity?.project
    ? normalizeIdentity(input.expectedIdentity, { allowEphemeral: true })
    : null
  if (entry.identity && expected && !sameIdentity(entry.identity, expected, { allowMissingTask: true })) {
    return { status: 'identity-mismatch', errorCode: 'LIFECYCLE_STATE_IDENTITY_MISMATCH', observedIdentity: entry.identity }
  }
  if (!entry.taskKey) {
    const state = materializeEphemeralMutationState(entry.state)
    const ingressRecovery = validateTasklessWorkflowIngressRecovery(state, options)
    if (!ingressRecovery.valid) {
      return {
        status: 'invalid',
        errorCode: ingressRecovery.errorCode,
        errors: ingressRecovery.errors || [],
        identity: entry.identity || null
      }
    }
    return {
      status: 'ephemeral-stub',
      state,
      ingressRecovery,
      identity: entry.identity || null
    }
  }
  const read = readTaskSlots(taskPaths(paths, entry.taskKey), entry.identity, fsImpl)
  if (read.status !== 'fresh') return read
  if (expected && !sameIdentity(read.current.envelope.identity, expected, { allowMissingTask: true })) {
    return { status: 'identity-mismatch', errorCode: 'LIFECYCLE_STATE_IDENTITY_MISMATCH', observedIdentity: read.current.envelope.identity }
  }
  return {
    status: 'fresh',
    state: materializeRecoveryState(read),
    envelope: read.current.envelope,
    identity: read.current.envelope.identity,
    mapping: entry
  }
}

function updateTaskRecoveryState(input, updater, options = {}) {
  if (typeof updater !== 'function') {
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_UPDATER_INVALID', 'task recovery updater must be a function')
  }
  const fsImpl = options.fs || fs
  const paths = storePaths(input.metaDir)
  let storeLock
  try {
    storeLock = acquireLock(paths.storeLock, options)
  } catch (error) {
    return {
      status: 'error',
      errorCode: error.code || 'LIFECYCLE_STORE_LEASE_FAILED',
      message: error.message
    }
  }
  if (!storeLock) return { status: 'error', errorCode: 'LIFECYCLE_STORE_LEASE_CONFLICT' }
  try {
    const read = readTaskRecoveryState(input, options)
    if (!['fresh', 'ephemeral-stub', 'missing'].includes(read.status)) {
      return {
        status: 'error',
        errorCode: read.errorCode || 'LIFECYCLE_STATE_READ_FAILED',
        message: 'existing task recovery state is not safe to replace',
        observedStatus: read.status,
        observedIdentity: read.observedIdentity || read.identity || null
      }
    }
    const base = ['fresh', 'ephemeral-stub'].includes(read.status)
      ? read.state
      : (typeof input.readFallback === 'function' ? input.readFallback() : {})
    const state = updater(JSON.parse(JSON.stringify(base || {})))
    const identity = input.identity?.taskId ? input.identity : (read.identity || input.identity)
    return commitTaskRecoveryState(
      { ...input, identity, state },
      { ...options, storeLockHeld: true }
    )
  } finally {
    releaseLock(storeLock, fsImpl)
  }
}

function taskAdmissionTransactionDigest(transaction) {
  const value = JSON.parse(JSON.stringify(transaction || {}))
  delete value.transactionDigest
  return digestValue(value)
}

function taskAdmissionReconciliationReceiptDigest(receipt) {
  const value = JSON.parse(JSON.stringify(receipt || {}))
  delete value.receiptDigest
  return digestValue(value)
}

function validateTaskAdmissionReconciliationReceipt(receipt, binding = null) {
  const errors = []
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { valid: false, errors: ['admission-reconciliation-object-required'] }
  }
  if (receipt.schemaVersion !== TASK_ADMISSION_RECONCILIATION_SCHEMA) errors.push('admission-reconciliation-schema')
  if (!/^admission-[a-f0-9]{40}$/.test(String(receipt.admissionId || ''))) errors.push('admission-reconciliation-admission-id')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(receipt.taskId || ''))) {
    errors.push('admission-reconciliation-task-id')
  }
  for (const field of ['requestDigest', 'priorTransactionDigest', 'observedEffectsDigest', 'recoveredEffectsDigest']) {
    if (!/^[a-f0-9]{64}$/.test(String(receipt[field] || ''))) errors.push(`admission-reconciliation-${field}`)
  }
  if (!['prepared', 'identity-written', 'overview-written', 'cp-state-written'].includes(receipt.failedFromPhase) ||
      !['prepared', 'identity-written', 'overview-written', 'cp-state-written'].includes(receipt.recoveredPhase) ||
      !['prepared', 'identity-written', 'overview-written', 'cp-state-written'].includes(receipt.observedPhase)) {
    errors.push('admission-reconciliation-phase')
  }
  const ordinal = ['prepared', 'identity-written', 'overview-written', 'cp-state-written']
  if (ordinal.indexOf(receipt.recoveredPhase) !== ordinal.indexOf(receipt.observedPhase) ||
      ordinal.indexOf(receipt.recoveredPhase) < ordinal.indexOf(receipt.failedFromPhase)) {
    errors.push('admission-reconciliation-phase-contiguity')
  }
  if (receipt.mutationAuthority !== false || !Number.isFinite(Date.parse(String(receipt.reconciledAt || '')))) {
    errors.push('admission-reconciliation-authority-or-time')
  }
  const { receiptDigest, ...semantic } = receipt
  if (!/^[a-f0-9]{64}$/.test(String(receiptDigest || '')) || taskAdmissionReconciliationReceiptDigest(receipt) !== receiptDigest) {
    errors.push('admission-reconciliation-digest')
  }
  if (binding) {
    for (const field of ['admissionId', 'taskId', 'requestDigest', 'priorTransactionDigest', 'recoveredPhase', 'recoveredEffectsDigest']) {
      if (Object.prototype.hasOwnProperty.call(binding, field) &&
          String(receipt[field] || '') !== String(binding[field] || '')) {
        errors.push(`admission-reconciliation-binding-${field}`)
      }
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function fencedTaskWriteOwnerDigest(owner) {
  const value = JSON.parse(JSON.stringify(owner || {}))
  delete value.leaseDigest
  return digestValue(value)
}

function validateFencedTaskWriteOwner(owner, expectedIdentity = null) {
  const errors = []
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) {
    return { valid: false, errors: ['owner-object-required'] }
  }
  if (owner.schemaVersion !== FENCED_TASK_WRITE_OWNER_SCHEMA) errors.push('schema-version')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(owner.taskId || ''))) {
    errors.push('task-id')
  }
  for (const field of ['projectRootIdentity', 'sessionDigest', 'routeRevision']) {
    if (!/^[a-f0-9]{64}$/.test(String(owner[field] || ''))) errors.push(field)
  }
  if (!String(owner.contextEpoch || '').trim() || Buffer.byteLength(String(owner.contextEpoch || ''), 'utf8') > 256) {
    errors.push('context-epoch')
  }
  if (!Number.isInteger(owner.ownerGeneration) || owner.ownerGeneration < 1) errors.push('owner-generation')
  if (!/^owner-[a-f0-9]{40}$/.test(String(owner.ownerNonce || ''))) errors.push('owner-nonce')
  if (!Number.isInteger(owner.leaseRevision) || owner.leaseRevision < 1) errors.push('lease-revision')
  if (!Number.isInteger(owner.reopenGeneration) || owner.reopenGeneration < 0) errors.push('reopen-generation')
  if (!Number.isInteger(owner.revocationEpoch) || owner.revocationEpoch < 0) errors.push('revocation-epoch')
  if (!['active', 'released', 'handoff-pending', 'takeover-pending', 'terminal'].includes(owner.status)) errors.push('status')
  const issuedAtMs = Date.parse(String(owner.issuedAt || ''))
  const expiresAtMs = Date.parse(String(owner.expiresAt || ''))
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs < issuedAtMs) errors.push('lease-time')
  if (owner.status === 'active' && expiresAtMs <= issuedAtMs) errors.push('active-lease-duration')
  if (owner.handoffRef !== null && owner.handoffRef !== undefined &&
      (!owner.handoffRef || typeof owner.handoffRef !== 'object' || Array.isArray(owner.handoffRef))) errors.push('handoff-ref')
  if (owner.takeoverRef !== null && owner.takeoverRef !== undefined &&
      (!owner.takeoverRef || typeof owner.takeoverRef !== 'object' || Array.isArray(owner.takeoverRef))) errors.push('takeover-ref')
  if (owner.transitionRef !== null && owner.transitionRef !== undefined) {
    const ref = owner.transitionRef
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) ||
        !['acquire', 'reacquire', 'renew', 'release', 'handoff-prepare', 'handoff-accept', 'takeover-prepare', 'takeover-accept', 'reopen', 'terminal'].includes(ref.operation) ||
        (ref.priorLeaseDigest !== null && !/^[a-f0-9]{64}$/.test(String(ref.priorLeaseDigest || ''))) ||
        !/^[a-f0-9]{64}$/.test(String(ref.requestDigest || '')) ||
        !Number.isFinite(Date.parse(String(ref.committedAt || ''))) ||
        !/^[a-f0-9]{64}$/.test(String(ref.refDigest || ''))) {
      errors.push('transition-ref')
    } else {
      const refCore = JSON.parse(JSON.stringify(ref))
      delete refCore.refDigest
      if (ref.refDigest !== digestValue(refCore)) errors.push('transition-ref-digest')
    }
  }
  if (expectedIdentity) {
    let normalized
    try { normalized = normalizeIdentity(expectedIdentity) } catch { normalized = null }
    if (!normalized || normalized.taskId !== String(owner.taskId || '').toLowerCase()) errors.push('identity-binding')
  }
  if (!/^[a-f0-9]{64}$/.test(String(owner.leaseDigest || '')) || owner.leaseDigest !== fencedTaskWriteOwnerDigest(owner)) {
    errors.push('lease-digest')
  }
  return { valid: errors.length === 0, errors }
}

function workflowTaskTerminalReceiptDigest(receipt) {
  const value = JSON.parse(JSON.stringify(receipt || {}))
  delete value.receiptDigest
  return digestValue(value)
}

function validateWorkflowTaskTerminalReceipt(receipt, expectedIdentity = null) {
  const errors = []
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { valid: false, errors: ['terminal-receipt-object-required'] }
  }
  if (receipt.schemaVersion !== WORKFLOW_TASK_TERMINAL_RECEIPT_SCHEMA) errors.push('schema-version')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(receipt.taskId || ''))) errors.push('task-id')
  if (!/^admission-[a-f0-9]{40}$/.test(String(receipt.admissionId || ''))) errors.push('admission-id')
  for (const field of ['projectRootIdentity', 'priorOwnerLeaseDigest', 'terminalOwnerLeaseDigest', 'admissionTransactionDigest']) {
    if (!/^[a-f0-9]{64}$/.test(String(receipt[field] || ''))) errors.push(field)
  }
  if (!Number.isInteger(receipt.admissionGeneration) || receipt.admissionGeneration < 1) errors.push('admission-generation')
  if (!Number.isInteger(receipt.ownerGeneration) || receipt.ownerGeneration < 1) errors.push('owner-generation')
  if (!Number.isInteger(receipt.terminalGeneration) || receipt.terminalGeneration < 1) errors.push('terminal-generation')
  if (!['completed', 'rejected', 'cancelled', 'failed'].includes(receipt.terminalStatus)) errors.push('terminal-status')
  if (!Number.isFinite(Date.parse(String(receipt.issuedAt || '')))) errors.push('issued-at')
  const evidence = Array.isArray(receipt.evidence) ? receipt.evidence : []
  const roles = new Set()
  for (const item of evidence) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !['ecr', 'report', 'memory', 'completion'].includes(item.role) || roles.has(item.role) ||
        !String(item.path || '').trim() || !/^[a-f0-9]{64}$/.test(String(item.sha256 || '')) ||
        !Number.isInteger(item.bytes) || item.bytes < 1) {
      errors.push('evidence')
      continue
    }
    roles.add(item.role)
  }
  if (roles.size !== 4 || !['ecr', 'report', 'memory', 'completion'].every(role => roles.has(role))) errors.push('evidence-roles')
  if (expectedIdentity) {
    let normalized
    try { normalized = normalizeIdentity(expectedIdentity) } catch { normalized = null }
    if (!normalized || normalized.taskId !== String(receipt.taskId || '').toLowerCase()) errors.push('identity-binding')
  }
  if (!/^[a-f0-9]{64}$/.test(String(receipt.receiptDigest || '')) ||
      receipt.receiptDigest !== workflowTaskTerminalReceiptDigest(receipt)) errors.push('receipt-digest')
  return { valid: errors.length === 0, errors }
}

function validateTaskAdmissionTransaction(transaction, expectedIdentity = null) {
  const errors = []
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    return { valid: false, errors: ['transaction-object-required'] }
  }
  const digestFields = [
    'ingressIdempotencyKey', 'requestDigest', 'projectRootIdentityDigest', 'sessionDigest',
    'actualInstructionDigest', 'workItemDigest', 'workflowRouteDigest',
    'projectTargetLeaseDigest', 'taskIdentityDigest', 'directoryDecisionDigest', 'routeRevision'
  ]
  if (transaction.schemaVersion !== TASK_ADMISSION_TRANSACTION_SCHEMA) errors.push('schema-version')
  if (!/^admission-[a-f0-9]{40}$/.test(String(transaction.admissionId || ''))) errors.push('admission-id')
  for (const field of digestFields) {
    if (!/^[a-f0-9]{64}$/.test(String(transaction[field] || ''))) errors.push(field)
  }
  if (transaction.requestDigestSchema !== undefined) {
    if (transaction.requestDigestSchema !== 'TaskAdmissionRequestDigestV2') errors.push('request-digest-schema')
    if (transaction.requestDigestSemantics !== undefined &&
        transaction.requestDigestSemantics !== 'stable-admission-binding-v1') errors.push('request-digest-semantics')
    if (!/^[a-f0-9]{64}$/.test(String(transaction.projectTargetLeaseBindingDigest || ''))) {
      errors.push('project-target-lease-binding-digest')
    }
  } else if (transaction.projectTargetLeaseBindingDigest !== undefined || transaction.requestDigestSemantics !== undefined) {
    errors.push('legacy-request-binding-digest')
  }
  if (transaction.admissionId !== `admission-${String(transaction.ingressIdempotencyKey || '').slice(0, 40)}`) {
    errors.push('admission-idempotency-binding')
  }
  if (!TASK_ADMISSION_PHASES.includes(transaction.phase)) errors.push('phase')
  if (!['admitting', 'finalized', 'terminal', 'aborted', 'needs-reconcile'].includes(transaction.status)) errors.push('status')
  if (!['admit', 'adopt', 'bind'].includes(transaction.operation)) errors.push('operation')
  if (!Number.isInteger(transaction.admissionGeneration) || transaction.admissionGeneration < 1) errors.push('admission-generation')
  if (!String(transaction.admissionPolicyRevision || '').trim()) errors.push('admission-policy-revision')
  if (!String(transaction.project || '').trim()) errors.push('project')
  if (!String(transaction.hostVariant || '').trim() || Buffer.byteLength(String(transaction.hostVariant || ''), 'utf8') > 128) {
    errors.push('host-variant')
  }
  if (!/^(?:event|portable)-[a-f0-9]{40}$/.test(String(transaction.sourceEventId || ''))) errors.push('source-event-id')
  if (!/^work-[a-f0-9]{40}$/.test(String(transaction.workItemId || ''))) errors.push('work-item-id')
  if (!String(transaction.routeKey || '').trim() || Buffer.byteLength(String(transaction.routeKey || ''), 'utf8') > 128) {
    errors.push('route-key')
  }
  const taskKinds = ['requirements', 'bugs', 'optimizations', 'scenario-tests']
  if (!taskKinds.includes(transaction.taskKind)) errors.push('task-kind')
  const entryVariants = {
    requirements: ['new', 'product-provided', 'change', 'continue', 'reopen'],
    bugs: ['new', 'fix', 'continue', 'reopen'],
    optimizations: ['new', 'continue', 'reopen'],
    'scenario-tests': ['new', 'continue', 'reopen']
  }
  if (!entryVariants[transaction.taskKind]?.includes(transaction.entryVariant)) errors.push('entry-variant')
  if (!String(transaction.displayName || '').trim() || Buffer.byteLength(String(transaction.displayName || ''), 'utf8') > 160) {
    errors.push('display-name')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(transaction.taskId || ''))) {
    errors.push('task-id')
  }
  const taskRootRelative = String(transaction.taskRootRelative || '').replace(/\\/g, '/')
  const taskRootSegments = taskRootRelative.split('/')
  if (!taskRootRelative || path.isAbsolute(taskRootRelative) || taskRootSegments.length !== 2 ||
      taskRootSegments[0] !== transaction.taskKind ||
      taskRootSegments.some(segment => !segment || segment === '.' || segment === '..')) {
    errors.push('task-root-relative')
  }
  const effects = transaction.effects
  if (!effects || typeof effects !== 'object' || Array.isArray(effects) ||
      !['identity', 'overview', 'cpState', 'owner'].every(key => effects[key] && typeof effects[key] === 'object' && !Array.isArray(effects[key]))) {
    errors.push('effects')
  } else {
    const phaseOrdinal = ['prepared', 'identity-written', 'overview-written', 'cp-state-written', 'owner-fenced', 'finalized', 'terminal-closeout'].indexOf(transaction.phase)
    if (phaseOrdinal >= 0) {
      if ((phaseOrdinal === 0 ? effects.identity.status !== 'pending' : effects.identity.status !== 'written') ||
          (phaseOrdinal < 2 ? effects.overview.status !== 'pending' : effects.overview.status !== 'written') ||
          (phaseOrdinal < 3
            ? effects.cpState.status !== 'pending'
            : !['pending', 'confirmed'].includes(effects.cpState.status)) ||
          (phaseOrdinal < 4
            ? effects.owner.status !== 'pending'
            : !['fenced', 'terminal'].includes(effects.owner.status))) errors.push('effect-phase')
    }
  }
  if (!Number.isFinite(Date.parse(String(transaction.createdAt || ''))) ||
      !Number.isFinite(Date.parse(String(transaction.updatedAt || '')))) errors.push('timestamps')
  if (['aborted', 'needs-reconcile'].includes(transaction.phase)) {
    if (!transaction.error || typeof transaction.error !== 'object' || Array.isArray(transaction.error)) errors.push('error')
  } else if (transaction.error !== null) {
    errors.push('error')
  }
  if (transaction.reconciliation !== undefined && transaction.reconciliation !== null) {
    const reconciliationValidation = validateTaskAdmissionReconciliationReceipt(transaction.reconciliation, {
      admissionId: transaction.admissionId,
      taskId: transaction.taskId,
      requestDigest: transaction.requestDigest
    })
    const progression = ['prepared', 'identity-written', 'overview-written', 'cp-state-written', 'owner-fenced', 'finalized', 'terminal-closeout']
    if (!reconciliationValidation.valid || ['aborted', 'needs-reconcile'].includes(transaction.phase) ||
        progression.indexOf(transaction.phase) < progression.indexOf(transaction.reconciliation.recoveredPhase)) {
      errors.push(...reconciliationValidation.errors, 'admission-reconciliation-phase-binding')
    }
  }
  if (transaction.recovery !== undefined && transaction.recovery !== null) {
    const recovery = transaction.recovery
    if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)) {
      errors.push('recovery-object')
    } else {
      if (recovery.schemaVersion !== 'TaskAdmissionRecoveryV1') errors.push('recovery-schema-version')
      if (recovery.mode !== 'awaiting-owner-rebind') errors.push('recovery-mode')
      if (!/^admission-[a-f0-9]{40}$/.test(String(recovery.priorAdmissionId || ''))) {
        errors.push('recovery-prior-admission-id')
      }
      if (!Number.isInteger(recovery.priorAdmissionGeneration) || recovery.priorAdmissionGeneration < 1 ||
          recovery.priorAdmissionGeneration >= transaction.admissionGeneration) {
        errors.push('recovery-prior-admission-generation')
      }
      if (!/^[a-f0-9]{64}$/.test(String(recovery.priorTransactionDigest || ''))) {
        errors.push('recovery-prior-transaction-digest')
      }
      if (!/^[a-f0-9]{64}$/.test(String(recovery.canonicalOverviewDigest || ''))) {
        errors.push('recovery-canonical-overview-digest')
      }
      if (!Number.isFinite(Date.parse(String(recovery.recoveredAt || ''))) ||
          recovery.recoveredAt !== transaction.createdAt) {
        errors.push('recovery-timestamp')
      }
      if (transaction.entryVariant !== 'continue') errors.push('recovery-entry-variant')
    }
  }
  if (transaction.continuationLease !== undefined && transaction.continuationLease !== null) {
    const continuationValidation = validateAdmissionContinuationLease(transaction.continuationLease, transaction)
    if (!continuationValidation.valid) {
      errors.push(...continuationValidation.errors.map(error => `continuation-${error}`))
    }
  }
  const expectedStatus = transaction.phase === 'finalized'
    ? 'finalized'
    : (transaction.phase === 'terminal-closeout'
        ? 'terminal'
        : (transaction.phase === 'aborted' ? 'aborted' : (transaction.phase === 'needs-reconcile' ? 'needs-reconcile' : 'admitting')))
  if (transaction.status !== expectedStatus) errors.push('phase-status')
  if (expectedIdentity) {
    let normalized
    try { normalized = normalizeIdentity(expectedIdentity) } catch { normalized = null }
    if (!normalized || normalized.taskId !== String(transaction.taskId || '').toLowerCase() ||
        normalized.project !== normalizedProject(transaction.project)) errors.push('identity-binding')
  }
  if (!/^[a-f0-9]{64}$/.test(String(transaction.transactionDigest || '')) ||
      transaction.transactionDigest !== taskAdmissionTransactionDigest(transaction)) errors.push('transaction-digest')
  return { valid: errors.length === 0, errors }
}

function taskAdmissionTransitionAllowed(previousPhase, nextPhase) {
  if (previousPhase === nextPhase) return true
  if (['aborted', 'needs-reconcile', 'terminal-closeout'].includes(previousPhase)) return false
  if (['aborted', 'needs-reconcile'].includes(nextPhase)) return true
  const ordered = [
    'prepared', 'identity-written', 'overview-written', 'cp-state-written',
    'owner-fenced', 'finalized', 'terminal-closeout'
  ]
  return ordered.indexOf(nextPhase) === ordered.indexOf(previousPhase) + 1
}

function readTaskAdmissionTransaction(input = {}, options = {}) {
  const read = readTaskRecoveryState(input, options)
  if (read.status !== 'fresh') return read
  const transaction = read.state?.admissionTransaction
  if (!transaction) {
    return { status: 'missing', errorCode: 'TASK_ADMISSION_TRANSACTION_MISSING', identity: read.identity }
  }
  const validation = validateTaskAdmissionTransaction(transaction, read.identity)
  if (!validation.valid) {
    return {
      status: 'invalid',
      errorCode: 'TASK_ADMISSION_TRANSACTION_INVALID',
      errors: validation.errors,
      identity: read.identity
    }
  }
  return { status: 'fresh', transaction, state: read.state, envelope: read.envelope, identity: read.identity }
}

function commitTaskAdmissionTransaction(input = {}, options = {}) {
  const transaction = JSON.parse(JSON.stringify(input.transaction || {}))
  const validation = validateTaskAdmissionTransaction(transaction, input.identity)
  if (!validation.valid) {
    return {
      status: 'error',
      errorCode: 'TASK_ADMISSION_TRANSACTION_INVALID',
      errors: validation.errors
    }
  }
  const expectedPreviousPhase = String(input.expectedPreviousPhase || '')
  const fallback = () => input.baseState || {
    version: 2,
    mode: 'formal-admission',
    phase: 'CP1',
    activeProject: transaction.project,
    activeScope: 'project',
    taskRecoveryBinding: {
      taskId: transaction.taskId,
      displayName: transaction.displayName || path.basename(transaction.taskRootRelative),
      project: transaction.project,
      kind: transaction.taskKind,
      taskRoot: path.join(path.resolve(input.identity.activeRoot), ...transaction.taskRootRelative.split('/')),
      status: 'admitting',
      identityRevision: 2,
      boundAt: transaction.createdAt
    }
  }
  let result
  try {
    result = updateTaskRecoveryState({
      metaDir: input.metaDir,
      identity: input.identity,
      sessionKey: input.sessionKey,
      hostSessionDigest: input.hostSessionDigest,
      readFallback: fallback
    }, state => {
      const current = state.admissionTransaction
      if (current) {
        const currentValidation = validateTaskAdmissionTransaction(current, input.identity)
        if (!currentValidation.valid) {
          throw new TaskRecoveryStoreV5Error(
            'TASK_ADMISSION_TRANSACTION_INVALID',
            'existing task admission transaction is invalid',
            { errors: currentValidation.errors }
          )
        }
        const reopening = options.allowReopen === true &&
          current.phase === 'terminal-closeout' && transaction.phase === 'prepared' &&
          transaction.entryVariant === 'reopen' && current.taskId === transaction.taskId &&
          transaction.admissionGeneration === current.admissionGeneration + 1
        const continuationLease = current.continuationLease || null
        const commitNowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
        const continuationExpired = continuationLease?.status === 'active' &&
          Date.parse(continuationLease.expiresAt) <= commitNowMs
        const recovery = transaction.recovery
        const awaitingOwnerRebind = options.allowAwaitingOwnerRebind === true &&
          current.phase === 'cp-state-written' && transaction.phase === 'prepared' &&
          current.status === 'admitting' && current.effects?.owner?.status === 'pending' &&
          !state.fencedWriteOwner && transaction.entryVariant === 'continue' &&
          current.project === transaction.project && current.taskId === transaction.taskId &&
          current.taskKind === transaction.taskKind && current.taskRootRelative === transaction.taskRootRelative &&
          current.taskIdentityDigest === transaction.taskIdentityDigest &&
          current.admissionPolicyRevision === transaction.admissionPolicyRevision &&
          transaction.admissionGeneration === current.admissionGeneration + 1 &&
          (!continuationLease || continuationExpired) &&
          recovery?.schemaVersion === 'TaskAdmissionRecoveryV1' &&
          recovery.mode === 'awaiting-owner-rebind' && recovery.priorAdmissionId === current.admissionId &&
          recovery.priorAdmissionGeneration === current.admissionGeneration &&
          recovery.priorTransactionDigest === current.transactionDigest &&
          recovery.canonicalOverviewDigest === current.effects?.overview?.contentDigest
        if (reopening) {
          state.previousAdmissionTransaction = {
            schemaVersion: 'PreviousTaskAdmissionTransactionRefV1',
            admissionId: current.admissionId,
            admissionGeneration: current.admissionGeneration,
            transactionDigest: current.transactionDigest,
            terminalAt: current.updatedAt
          }
        } else if (awaitingOwnerRebind) {
          state.previousAdmissionTransaction = {
            schemaVersion: 'PreviousTaskAdmissionTransactionRefV2',
            admissionId: current.admissionId,
            admissionGeneration: current.admissionGeneration,
            transactionDigest: current.transactionDigest,
            disposition: 'awaiting-owner-rebind',
            replacedAt: transaction.createdAt
          }
        } else if (current.ingressIdempotencyKey !== transaction.ingressIdempotencyKey ||
            current.admissionId !== transaction.admissionId ||
            current.requestDigest !== transaction.requestDigest) {
          throw new TaskRecoveryStoreV5Error(
            'TASK_ADMISSION_IDEMPOTENCY_CONFLICT',
            'an existing admission journal is bound to different ingress or request content'
          )
        }
        if (!reopening && !awaitingOwnerRebind && expectedPreviousPhase && current.phase !== expectedPreviousPhase && current.phase !== transaction.phase) {
          throw new TaskRecoveryStoreV5Error(
            'TASK_ADMISSION_PHASE_CAS_MISMATCH',
            `expected admission phase ${expectedPreviousPhase}, observed ${current.phase}`
          )
        }
        if (!reopening && !awaitingOwnerRebind && !taskAdmissionTransitionAllowed(current.phase, transaction.phase)) {
          throw new TaskRecoveryStoreV5Error(
            'TASK_ADMISSION_PHASE_TRANSITION_INVALID',
            `cannot transition task admission from ${current.phase} to ${transaction.phase}`
          )
        }
        if (!reopening && !awaitingOwnerRebind && current.phase === transaction.phase && current.transactionDigest !== transaction.transactionDigest) {
          throw new TaskRecoveryStoreV5Error(
            'TASK_ADMISSION_PHASE_CONTENT_CONFLICT',
            `admission phase ${current.phase} already has different durable content`
          )
        }
        if (!reopening && !awaitingOwnerRebind && current.transactionDigest === transaction.transactionDigest) return state
      } else if (transaction.phase !== 'prepared') {
        throw new TaskRecoveryStoreV5Error(
          'TASK_ADMISSION_PREPARE_REQUIRED',
          'the first durable admission journal phase must be prepared'
        )
      }
      state.admissionTransaction = transaction
      state.phase = transaction.phase === 'cp-state-written' ? 'CP1' : (state.phase || 'CP1')
      state.taskRecoveryBinding = {
        ...(state.taskRecoveryBinding || {}),
        taskId: transaction.taskId,
        displayName: transaction.displayName || state.taskRecoveryBinding?.displayName || '',
        project: transaction.project,
        kind: transaction.taskKind,
        taskRoot: path.join(path.resolve(input.identity.activeRoot), ...transaction.taskRootRelative.split('/')),
        status: transaction.status === 'admitting' ? 'admitting' : transaction.status,
        identityRevision: 2,
        boundAt: state.taskRecoveryBinding?.boundAt || transaction.createdAt
      }
      return state
    }, {
      ...options,
      reason: transaction.phase === 'prepared'
        ? 'admission-preflight'
        : (transaction.phase === 'aborted'
            ? 'admission-abort'
            : (transaction.phase === 'needs-reconcile' ? 'admission-reconcile' : 'admission-transition'))
    })
  } catch (error) {
    return {
      status: 'error',
      errorCode: error.code || 'TASK_ADMISSION_TRANSACTION_COMMIT_FAILED',
      message: error.message,
      details: error.details
    }
  }
  return { ...result, transaction }
}

function commitTaskAdmissionReconciliation(input = {}, options = {}) {
  const transaction = JSON.parse(JSON.stringify(input.transaction || {}))
  const receipt = JSON.parse(JSON.stringify(input.receipt || transaction.reconciliation || {}))
  const validation = validateTaskAdmissionTransaction(transaction, input.identity)
  const receiptValidation = validateTaskAdmissionReconciliationReceipt(receipt, {
    admissionId: transaction.admissionId,
    taskId: transaction.taskId,
    requestDigest: transaction.requestDigest,
    priorTransactionDigest: String(input.expectedPriorTransactionDigest || ''),
    recoveredPhase: transaction.phase,
    recoveredEffectsDigest: digestValue(transaction.effects)
  })
  if (!validation.valid || !receiptValidation.valid || transaction.reconciliation?.receiptDigest !== receipt.receiptDigest) {
    return {
      status: 'error',
      errorCode: 'TASK_ADMISSION_RECONCILIATION_INVALID',
      errors: [...validation.errors, ...receiptValidation.errors, ...(transaction.reconciliation?.receiptDigest === receipt.receiptDigest ? [] : ['transaction-reconciliation-binding'])]
    }
  }
  let result
  try {
    result = updateTaskRecoveryState({
      metaDir: input.metaDir,
      identity: input.identity,
      sessionKey: input.sessionKey,
      hostSessionDigest: input.hostSessionDigest
    }, state => {
      const current = state.admissionTransaction
      const currentValidation = validateTaskAdmissionTransaction(current, input.identity)
      if (!currentValidation.valid) {
        throw new TaskRecoveryStoreV5Error('TASK_ADMISSION_TRANSACTION_INVALID', 'existing task admission transaction is invalid', { errors: currentValidation.errors })
      }
      if (current.transactionDigest === transaction.transactionDigest) return state
      if (current.phase !== 'needs-reconcile' || current.transactionDigest !== input.expectedPriorTransactionDigest ||
          current.admissionId !== transaction.admissionId || current.requestDigest !== transaction.requestDigest ||
          receipt.priorTransactionDigest !== current.transactionDigest) {
        throw new TaskRecoveryStoreV5Error(
          'TASK_ADMISSION_RECONCILIATION_CAS_MISMATCH',
          'task admission reconciliation does not match the current needs-reconcile transaction'
        )
      }
      state.admissionTransaction = transaction
      state.phase = transaction.phase === 'cp-state-written' ? 'CP1' : (state.phase || 'CP1')
      state.taskRecoveryBinding = {
        ...(state.taskRecoveryBinding || {}),
        taskId: transaction.taskId,
        displayName: transaction.displayName || state.taskRecoveryBinding?.displayName || '',
        project: transaction.project,
        kind: transaction.taskKind,
        taskRoot: path.join(path.resolve(input.identity.activeRoot), ...transaction.taskRootRelative.split('/')),
        status: 'admitting',
        identityRevision: 2,
        boundAt: state.taskRecoveryBinding?.boundAt || transaction.createdAt
      }
      return state
    }, { ...options, reason: 'admission-reconciliation' })
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'TASK_ADMISSION_RECONCILIATION_COMMIT_FAILED', message: error.message, details: error.details }
  }
  return { ...result, transaction, receipt }
}

function ownerCasMatches(current, expected) {
  if (expected === null || expected?.mode === 'absent') return !current
  if (!current || !expected || typeof expected !== 'object') return false
  return current.ownerGeneration === expected.ownerGeneration &&
    current.ownerNonce === expected.ownerNonce &&
    current.leaseRevision === expected.leaseRevision &&
    current.leaseDigest === expected.leaseDigest
}

function ownerTransitionErrors(current, next, transition) {
  const errors = []
  if (current?.leaseDigest === next.leaseDigest) return errors
  if (transition === 'acquire') {
    if (current) errors.push('acquire-owner-present')
    if (next.status !== 'active' || next.ownerGeneration !== 1 || next.leaseRevision !== 1) errors.push('acquire-shape')
  } else if (transition === 'reacquire') {
    if (!current || current.status !== 'released' || next.status !== 'active' ||
        next.ownerGeneration !== current.ownerGeneration + 1 || next.ownerNonce === current.ownerNonce ||
        next.leaseRevision !== current.leaseRevision + 1 || next.revocationEpoch !== current.revocationEpoch ||
        Date.parse(next.expiresAt) <= Date.parse(next.issuedAt)) errors.push('reacquire-shape')
  } else if (transition === 'renew') {
    if (!current || current.status !== 'active' || next.status !== 'active' ||
        next.ownerGeneration !== current.ownerGeneration || next.ownerNonce !== current.ownerNonce ||
        next.leaseRevision !== current.leaseRevision + 1 || next.revocationEpoch !== current.revocationEpoch ||
        Date.parse(next.expiresAt) <= Date.parse(current.expiresAt)) errors.push('renew-shape')
  } else if (['release', 'handoff-prepare', 'takeover-prepare', 'terminal'].includes(transition)) {
    const expectedStatus = {
      release: 'released',
      'handoff-prepare': 'handoff-pending',
      'takeover-prepare': 'takeover-pending',
      terminal: 'terminal'
    }[transition]
    const currentStatusAllowed = transition === 'takeover-prepare'
      ? ['active', 'handoff-pending', 'takeover-pending'].includes(current?.status)
      : current?.status === 'active'
    if (!current || !currentStatusAllowed || next.status !== expectedStatus ||
        next.ownerGeneration !== current.ownerGeneration + 1 || next.ownerNonce === current.ownerNonce ||
        next.leaseRevision !== current.leaseRevision + 1 || next.revocationEpoch !== current.revocationEpoch + 1) {
      errors.push(`${transition}-shape`)
    }
  } else if (['handoff-accept', 'takeover-accept'].includes(transition)) {
    const expectedStatus = transition === 'handoff-accept' ? 'handoff-pending' : 'takeover-pending'
    if (!current || current.status !== expectedStatus || next.status !== 'active' ||
        next.ownerGeneration !== current.ownerGeneration || next.ownerNonce === current.ownerNonce ||
        next.leaseRevision !== current.leaseRevision + 1 || next.revocationEpoch !== current.revocationEpoch) {
      errors.push(`${transition}-shape`)
    }
  } else if (transition === 'reopen') {
    if (!current || current.status !== 'terminal' || next.status !== 'active' ||
        next.ownerGeneration !== current.ownerGeneration + 1 || next.ownerNonce === current.ownerNonce ||
        next.leaseRevision !== current.leaseRevision + 1 || next.reopenGeneration !== current.reopenGeneration + 1 ||
        next.revocationEpoch !== current.revocationEpoch) errors.push('reopen-shape')
  } else if (transition !== 'replay') {
    errors.push('transition-unsupported')
  }
  return errors
}

function commitFencedTaskWriteOwnerTransition(input = {}, options = {}) {
  const nextOwner = JSON.parse(JSON.stringify(input.owner || {}))
  const ownerValidation = validateFencedTaskWriteOwner(nextOwner, input.identity)
  if (!ownerValidation.valid) {
    return { status: 'error', errorCode: 'FENCED_TASK_WRITE_OWNER_INVALID', errors: ownerValidation.errors }
  }
  const transaction = input.transaction ? JSON.parse(JSON.stringify(input.transaction)) : null
  if (transaction) {
    const transactionValidation = validateTaskAdmissionTransaction(transaction, input.identity)
    if (!transactionValidation.valid) {
      return { status: 'error', errorCode: 'TASK_ADMISSION_TRANSACTION_INVALID', errors: transactionValidation.errors }
    }
  }
  const terminalReceipt = input.terminalReceipt
    ? JSON.parse(JSON.stringify(input.terminalReceipt))
    : null
  if (terminalReceipt) {
    const terminalValidation = validateWorkflowTaskTerminalReceipt(terminalReceipt, input.identity)
    if (!terminalValidation.valid) {
      return { status: 'error', errorCode: 'WORKFLOW_TASK_TERMINAL_RECEIPT_INVALID', errors: terminalValidation.errors }
    }
  }
  let result
  try {
    result = updateTaskRecoveryState({
      metaDir: input.metaDir,
      identity: input.identity,
      sessionKey: input.sessionKey,
      hostSessionDigest: input.hostSessionDigest
    }, state => {
      const currentOwner = state.fencedWriteOwner || null
      if (currentOwner) {
        const currentOwnerValidation = validateFencedTaskWriteOwner(currentOwner, input.identity)
        if (!currentOwnerValidation.valid) {
          throw new TaskRecoveryStoreV5Error(
            'FENCED_TASK_WRITE_OWNER_INVALID',
            'existing fenced task write owner is invalid',
            { errors: currentOwnerValidation.errors }
          )
        }
      }
      if (!ownerCasMatches(currentOwner, input.expectedOwner)) {
        throw new TaskRecoveryStoreV5Error(
          'FENCED_TASK_WRITE_OWNER_CAS_MISMATCH',
          'expected owner generation, nonce, revision and digest do not match the durable owner'
        )
      }
      const transitionErrors = ownerTransitionErrors(currentOwner, nextOwner, String(input.transition || ''))
      if (transitionErrors.length) {
        throw new TaskRecoveryStoreV5Error(
          'FENCED_TASK_WRITE_OWNER_TRANSITION_INVALID',
          'fenced owner transition is invalid',
          { errors: transitionErrors }
        )
      }
      const currentTransaction = state.admissionTransaction
      if (!currentTransaction) {
        throw new TaskRecoveryStoreV5Error('TASK_ADMISSION_TRANSACTION_MISSING', 'fenced owner requires one durable admission transaction')
      }
      const currentTransactionValidation = validateTaskAdmissionTransaction(currentTransaction, input.identity)
      if (!currentTransactionValidation.valid) {
        throw new TaskRecoveryStoreV5Error(
          'TASK_ADMISSION_TRANSACTION_INVALID',
          'existing admission transaction is invalid',
          { errors: currentTransactionValidation.errors }
        )
      }
      if (transaction) {
        if (currentTransaction.admissionId !== transaction.admissionId ||
            currentTransaction.taskId !== transaction.taskId ||
            currentTransaction.admissionGeneration !== transaction.admissionGeneration) {
          throw new TaskRecoveryStoreV5Error('TASK_ADMISSION_OWNER_BINDING_MISMATCH', 'owner transition targets another admission generation')
        }
        if (input.expectedAdmissionPhase && currentTransaction.phase !== input.expectedAdmissionPhase &&
            currentTransaction.transactionDigest !== transaction.transactionDigest) {
          throw new TaskRecoveryStoreV5Error('TASK_ADMISSION_PHASE_CAS_MISMATCH', `expected admission phase ${input.expectedAdmissionPhase}`)
        }
        if (!taskAdmissionTransitionAllowed(currentTransaction.phase, transaction.phase)) {
          throw new TaskRecoveryStoreV5Error('TASK_ADMISSION_PHASE_TRANSITION_INVALID', `cannot transition admission from ${currentTransaction.phase} to ${transaction.phase}`)
        }
        state.admissionTransaction = transaction
      }
      if (nextOwner.taskId !== currentTransaction.taskId ||
          nextOwner.projectRootIdentity !== currentTransaction.projectRootIdentityDigest) {
        throw new TaskRecoveryStoreV5Error('FENCED_TASK_WRITE_OWNER_BINDING_MISMATCH', 'owner is not bound to the exact task/project identity')
      }
      if (terminalReceipt) {
        const effectiveTransaction = transaction || currentTransaction
        if (terminalReceipt.terminalOwnerLeaseDigest !== nextOwner.leaseDigest ||
            terminalReceipt.admissionTransactionDigest !== effectiveTransaction.transactionDigest ||
            terminalReceipt.admissionId !== effectiveTransaction.admissionId ||
            terminalReceipt.ownerGeneration !== nextOwner.ownerGeneration) {
          throw new TaskRecoveryStoreV5Error('WORKFLOW_TASK_TERMINAL_BINDING_MISMATCH', 'terminal receipt does not bind the durable owner/admission state')
        }
        state.workflowTaskTerminalReceipt = terminalReceipt
      }
      state.fencedWriteOwner = nextOwner
      state.taskRecoveryBinding = {
        ...(state.taskRecoveryBinding || {}),
        taskId: nextOwner.taskId,
        project: currentTransaction.project,
        status: nextOwner.status === 'terminal' ? 'terminal' : (transaction?.status || currentTransaction.status),
        identityRevision: 2
      }
      return state
    }, {
      ...options,
      reason: String(input.reason || '')
    })
  } catch (error) {
    return {
      status: 'error',
      errorCode: error.code || 'FENCED_TASK_WRITE_OWNER_COMMIT_FAILED',
      message: error.message,
      details: error.details
    }
  }
  return { ...result, owner: nextOwner, transaction, terminalReceipt }
}

function readFencedTaskWriteOwner(input = {}, options = {}) {
  const primary = readTaskRecoveryState(input, options)
  const reserve = options.ignoreReserve === true
    ? { status: 'missing' }
    : latestEmergencyCloseoutForIdentity(input.metaDir, input.identity, options)
  if (reserve.status === 'fresh' && reserve.record?.fencedWriteOwner) {
    const owner = reserve.record.fencedWriteOwner
    const validation = validateFencedTaskWriteOwner(owner, input.identity)
    if (validation.valid && (!primary.state?.fencedWriteOwner ||
        owner.ownerGeneration >= Number(primary.state.fencedWriteOwner.ownerGeneration || 0))) {
      return {
        status: 'fresh',
        source: 'closeout-reserve',
        owner,
        transaction: reserve.record.admissionTransaction || null,
        terminalReceipt: reserve.record.workflowTaskTerminalReceipt || null,
        reserveSequence: reserve.sequence,
        identity: reserve.identity
      }
    }
  }
  if (primary.status !== 'fresh') return primary
  if (!primary.state?.fencedWriteOwner) {
    return {
      status: 'missing',
      source: 'primary',
      errorCode: 'FENCED_TASK_WRITE_OWNER_MISSING',
      transaction: primary.state?.admissionTransaction || null,
      state: primary.state,
      envelope: primary.envelope,
      identity: primary.identity
    }
  }
  const validation = validateFencedTaskWriteOwner(primary.state.fencedWriteOwner, primary.identity)
  if (!validation.valid) {
    return { status: 'invalid', errorCode: 'FENCED_TASK_WRITE_OWNER_INVALID', errors: validation.errors, identity: primary.identity }
  }
  return {
    status: 'fresh',
    source: 'primary',
    owner: primary.state.fencedWriteOwner,
    transaction: primary.state.admissionTransaction || null,
    terminalReceipt: primary.state.workflowTaskTerminalReceipt || null,
    state: primary.state,
    envelope: primary.envelope,
    identity: primary.identity
  }
}

function reconcileEmergencyTaskCloseout(input = {}, options = {}) {
  const reserve = latestEmergencyCloseoutForIdentity(input.metaDir, input.identity, options)
  if (reserve.status !== 'fresh') return reserve
  const record = reserve.record
  if (!record?.fencedWriteOwner || !record?.admissionTransaction || !record?.workflowTaskTerminalReceipt) {
    return { status: 'invalid', errorCode: 'LIFECYCLE_CLOSEOUT_RECORD_INCOMPLETE', sequence: reserve.sequence }
  }
  const primary = readFencedTaskWriteOwner({ ...input }, { ...options, ignoreReserve: true })
  if (primary.status === 'fresh' && primary.source === 'primary' &&
      primary.terminalReceipt?.receiptDigest === record.workflowTaskTerminalReceipt.receiptDigest) {
    return { status: 'semantic-noop', sequence: reserve.sequence, reconciled: true, terminalReceipt: primary.terminalReceipt }
  }
  const expected = primary.status === 'fresh' && primary.source === 'primary'
    ? {
        ownerGeneration: primary.owner.ownerGeneration,
        ownerNonce: primary.owner.ownerNonce,
        leaseRevision: primary.owner.leaseRevision,
        leaseDigest: primary.owner.leaseDigest
      }
    : { mode: 'absent' }
  if (record.workflowTaskTerminalReceipt.priorOwnerLeaseDigest !== expected.leaseDigest) {
    return { status: 'blocked', errorCode: 'LIFECYCLE_CLOSEOUT_PRIMARY_OWNER_DRIFT', sequence: reserve.sequence }
  }
  return commitFencedTaskWriteOwnerTransition({
    metaDir: input.metaDir,
    identity: input.identity,
    sessionKey: input.sessionKey,
    hostSessionDigest: input.hostSessionDigest,
    expectedOwner: expected,
    owner: record.fencedWriteOwner,
    transition: 'terminal',
    transaction: record.admissionTransaction,
    expectedAdmissionPhase: 'finalized',
    terminalReceipt: record.workflowTaskTerminalReceipt,
    reason: 'terminal-closeout-reconcile'
  }, options)
}

module.exports = {
  ADMISSION_CONTINUATION_LEASE_SCHEMA,
  ADMISSION_INGRESS_SNAPSHOT_REF_SCHEMA,
  ADMISSION_INGRESS_SNAPSHOT_SCHEMA,
  TELEMETRY_RECORD_MAX_BYTES,
  TELEMETRY_SEGMENT_MAX_BYTES,
  TELEMETRY_TOTAL_MAX_BYTES,
  DEFAULT_COLD_AFTER_MS,
  DEFAULT_DISK_HEADROOM_BYTES,
  DEFAULT_EPHEMERAL_BYTES,
  DEFAULT_EPHEMERAL_TTL_MS,
  DEFAULT_HARD_BYTES,
  DEFAULT_RESERVE_BYTES,
  DEFAULT_SOFT_BYTES,
  DEFAULT_TERMINAL_GRACE_MS,
  EPHEMERAL_ENTRY_MAX_BYTES,
  FENCED_TASK_WRITE_OWNER_SCHEMA,
  MUTATION_PREFLIGHT_STATE_MAX_BYTES,
  TASK_ADMISSION_PHASES,
  TASK_ADMISSION_RECONCILIATION_SCHEMA,
  TASK_ADMISSION_TRANSACTION_SCHEMA,
  TASK_RECOVERY_CLOSEOUT_SCHEMA,
  TASK_RECOVERY_COMMIT_SCHEMA,
  TASK_RECOVERY_DOCTOR_SCHEMA,
  TASK_RECOVERY_EPHEMERAL_SCHEMA,
  TASK_RECOVERY_KEY_SCHEMA,
  TASK_RECOVERY_STATE_SCHEMA,
  TASK_RECOVERY_STATUS_SCHEMA,
  TASKLESS_WORKFLOW_INGRESS_RECOVERY_SCHEMA,
  WORKFLOW_TASK_TERMINAL_RECEIPT_SCHEMA,
  TaskRecoveryStoreV5Error,
  admissionContinuationLeaseDigest,
  appendTaskRecoveryTelemetry,
  commitFencedTaskWriteOwnerTransition,
  commitTaskAdmissionReconciliation,
  commitTaskAdmissionTransaction,
  commitTaskRecoveryState,
  createTaskRecoveryKey,
  diagnoseTaskRecoveryStore,
  ensureReserve,
  fencedTaskWriteOwnerDigest,
  inspectTaskRecoveryStore,
  inspectDiskHeadroom,
  maintainTaskRecoveryStore,
  normalizeIdentity,
  readEmergencyCloseouts,
  readAdmissionIngressSnapshot,
  readFencedTaskWriteOwner,
  readTaskAdmissionTransaction,
  readTaskRecoveryState,
  readTaskSlots,
  resolveTaskRecoveryMetaDir,
  reconcileEmergencyTaskCloseout,
  sameIdentity,
  storePaths,
  taskPaths,
  taskAdmissionTransactionDigest,
  taskAdmissionReconciliationReceiptDigest,
  updateTaskRecoveryState,
  validateFencedTaskWriteOwner,
  validateAdmissionContinuationLease,
  validateTasklessWorkflowIngressRecovery,
  validateTaskAdmissionTransaction,
  validateTaskAdmissionReconciliationReceipt,
  validateWorkflowTaskTerminalReceipt,
  workflowTaskTerminalReceiptDigest,
  writeAdmissionIngressSnapshot,
  writeEmergencyCloseout,
  writeStableProjection
}
