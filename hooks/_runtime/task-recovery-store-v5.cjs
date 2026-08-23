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

const TASK_RECOVERY_STATE_SCHEMA = 'TaskRecoveryStateV5'
const TASK_RECOVERY_EPHEMERAL_SCHEMA = 'TaskRecoveryEphemeralRingV5'
const TASK_RECOVERY_COMMIT_SCHEMA = 'TaskRecoveryCommitReceiptV5'
const TASK_RECOVERY_STATUS_SCHEMA = 'TaskRecoveryStoreStatusV5'
const TASK_RECOVERY_DOCTOR_SCHEMA = 'TaskRecoveryStoreDoctorV5'
const TASK_RECOVERY_LOCK_SCHEMA = 'TaskRecoveryWriterLockV5'
const TASK_RECOVERY_CLOSEOUT_SCHEMA = 'TaskRecoveryEmergencyCloseoutV5'
const TASK_RECOVERY_KEY_SCHEMA = 'TaskRecoveryKeyV1'
const TASK_RECOVERY_USAGE_SCHEMA = 'TaskRecoveryUsageLedgerV1'

const DEFAULT_SOFT_BYTES = 256 * 1024 * 1024
const DEFAULT_HARD_BYTES = 512 * 1024 * 1024
const DEFAULT_RESERVE_BYTES = 8 * 1024 * 1024
const DEFAULT_DISK_HEADROOM_BYTES = 8 * 1024 * 1024
const DEFAULT_EPHEMERAL_BYTES = 1024 * 1024
const EPHEMERAL_ENTRY_MAX_BYTES = 8 * 1024
const EPHEMERAL_STUB_TARGET_BYTES = EPHEMERAL_ENTRY_MAX_BYTES - (2 * 1024)
const DEFAULT_COLD_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TERMINAL_GRACE_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_LOCK_LEASE_MS = 30 * 1000
const DEFAULT_LOCK_WAIT_MS = 2000
const DEFAULT_TASK_INVENTORY_MAX = 100000
const DEFAULT_MAINTENANCE_THROTTLE_MS = 60 * 1000
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

function buildMutationPreflightState(state) {
  const binding = state?.taskRecoveryBinding || {}
  const context = state?.contextAcquisition || {}
  const turn = state?.turnLiveness || {}
  const operation = turn.inFlightOperation || {}
  const preflight = {
    version: state?.version,
    mode: state?.mode,
    phase: state?.phase,
    activeProject: state?.activeProject,
    activeScope: state?.activeScope,
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
    },
    turnLiveness: {
      schemaVersion: turn.schemaVersion,
      state: turn.state,
      turnKey: boundedRecoveryString(turn.turnKey, 256),
      inFlightOperation: {
        operationId: boundedRecoveryString(operation.operationId, 256),
        toolName: boundedRecoveryString(operation.toolName, 128),
        startedAt: operation.startedAt,
        mutating: operation.mutating === true,
        targetPaths: Array.isArray(operation.targetPaths)
          ? operation.targetPaths.slice(0, 4).map(item => boundedRecoveryString(item, 512))
          : []
      }
    },
    recoveryKind: 'mutation-preflight'
  }
  if (jsonBytes(preflight) > MUTATION_PREFLIGHT_STATE_MAX_BYTES) {
    preflight.taskRecoveryBinding.taskRoot = ''
    preflight.contextAcquisition.activeRoot = ''
    preflight.contextAcquisition.hostSessionId = ''
    preflight.turnLiveness.turnKey = ''
    preflight.turnLiveness.inFlightOperation.targetPaths = []
  }
  const bytes = jsonBytes(preflight)
  if (bytes > MUTATION_PREFLIGHT_STATE_MAX_BYTES) {
    throw new TaskRecoveryStoreV5Error(
      'LIFECYCLE_PREFLIGHT_PAYLOAD_EXCEEDED',
      'mutation preflight recovery record exceeds 4 KiB',
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
      !sameIdentity(previous.identity, current.identity)) return current.state
  return {
    ...previous.state,
    ...current.state,
    taskRecoveryBinding: {
      ...(previous.state?.taskRecoveryBinding || {}),
      ...(current.state?.taskRecoveryBinding || {})
    },
    contextAcquisition: {
      ...(previous.state?.contextAcquisition || {}),
      ...(current.state?.contextAcquisition || {})
    },
    turnLiveness: {
      ...(previous.state?.turnLiveness || {}),
      ...(current.state?.turnLiveness || {})
    }
  }
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
      return { descriptor, lockPath, ownerToken, waitedMs: Math.max(0, now() - started) }
    } catch (error) {
      if (descriptor !== undefined) {
        try { fsImpl.closeSync(descriptor) } catch { }
      }
      if (created) {
        try { fsImpl.unlinkSync(lockPath) } catch { }
      }
      if (error?.code !== 'EEXIST') throw error
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
    if (existing?.ownerToken === lock.ownerToken) fsImpl.unlinkSync(lock.lockPath)
  } catch { }
}

function writeFixedJsonSlot(file, tempFile, value, fsImpl = fs) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
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
  try { fsImpl.unlinkSync(file) } catch (error) {
    if (error?.code !== 'ENOENT') {
      try { fsImpl.unlinkSync(tempFile) } catch { }
      throw error
    }
  }
  try {
    fsImpl.renameSync(tempFile, file)
  } catch (error) {
    try { fsImpl.unlinkSync(tempFile) } catch { }
    throw error
  }
  const readback = readJson(file, fsImpl, Math.max(TASK_STATE_SLOT_MAX_BYTES + 64 * 1024, Buffer.byteLength(serialized) + 1))
  if (readback.status !== 'fresh' || digestValue(readback.value) !== digestValue(value)) {
    try { fsImpl.unlinkSync(file) } catch { }
    throw new TaskRecoveryStoreV5Error('LIFECYCLE_STATE_READBACK_MISMATCH', `state readback mismatch: ${file}`)
  }
  return { file, bytes: Buffer.byteLength(serialized), digest: digestValue(value) }
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

function ephemeralOwnerKey(sessionKey) {
  const key = String(sessionKey || '').trim()
  return key ? digestValue({ sessionKey: key }) : ''
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
    lastMutationCloseout: raw.lastMutationCloseout || null
  }
}

function buildMinimalEphemeralStub (state) {
  const context = state?.contextAcquisition || {}
  const route = state?.progressiveSkillRoute || {}
  const bootstrap = route.bootstrap || {}
  const stop = state?.progressiveSkillRouteStop || {}
  const turn = state?.turnLiveness || {}
  const operation = turn.inFlightOperation?.mutating === true
    ? turn.inFlightOperation
    : null
  const handoff = context.plan || context.handoff || {}
  return {
    version: state?.version,
    mode: boundedRecoveryString(state?.mode, 32),
    activeProject: boundedRecoveryString(state?.activeProject, 128),
    activeScope: boundedRecoveryString(state?.activeScope, 32),
    activeProjectSource: boundedRecoveryString(state?.activeProjectSource, 64),
    taskRecoveryBinding: null,
    progressiveSkillRoute: route && typeof route === 'object' ? {
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
    progressiveSkillRouteStop: stop && typeof stop === 'object' ? {
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
      verificationMode: 'ephemeral-resume-rehydrate',
      handoff: handoff && typeof handoff === 'object' ? {
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
}

function buildEphemeralStub(state) {
  const context = state?.contextAcquisition || {}
  const sticky = state?.stickyProject || {}
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
      sessionKey: sticky.sessionKey
    },
    stickyAuto: state?.stickyAuto,
    taskRecoveryBinding: state?.taskRecoveryBinding || null,
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
    stub.stickyProject = null
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
  return { value, ...writeFixedJsonSlot(paths.manifest, paths.manifestTemp, value, fsImpl) }
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
    if (mutationPreflight && compact.state?.turnLiveness?.inFlightOperation?.mutating !== true) {
      return {
        status: 'error',
        errorCode: 'LIFECYCLE_PREFLIGHT_MUTATION_RECORD_REQUIRED',
        message: 'mutation preflight requires a durable mutating in-flight record',
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
    const serializedBytes = Buffer.byteLength(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
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
      if (options.reason === 'mutation-closeout') {
        try {
          const closeout = writeEmergencyCloseout(paths, {
            observedAt: new Date(nowMs).toISOString(),
            status: options.closeoutStatus || 'needs-reconcile',
            reason: String(options.reason || ''),
            identity,
            inFlightOperation: compact.state?.turnLiveness?.inFlightOperation || null,
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
    if (mutationPreflight && disk.status !== 'PASS') {
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
      if (mutationPreflight) {
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
      write = writeFixedJsonSlot(currentPaths.slots[inactiveIndex], currentPaths.temp, envelope, fsImpl)
    } catch (error) {
      try { writeUsageLedger(paths, usage.taskSlotBytes, { ...options, usageSource: 'commit-rollback' }) } catch { }
      if (options.reason === 'mutation-closeout') {
        try {
          const closeout = writeEmergencyCloseout(paths, {
            observedAt: new Date(nowMs).toISOString(),
            status: options.closeoutStatus || 'needs-reconcile',
            reason: String(options.reason || ''),
            identity,
            inFlightOperation: compact.state?.turnLiveness?.inFlightOperation || null,
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
  const ownerKey = ephemeralOwnerKey(sessionKey)
  if (!ownerKey) return { status: 'skipped', reasonCode: 'session-key-missing' }
  const entry = {
    schemaVersion: 'TaskRecoverySessionLeaseV1',
    ownerKey,
    sessionKeyDigest: ownerKey,
    taskKey: identity?.recoveryKey || null,
    identity: identity || null,
    lastUsedAt: new Date(nowMsFrom(options)).toISOString(),
    state: identity?.recoveryKey ? null : buildEphemeralStub(state),
    semanticDigest: identity?.recoveryKey
      ? digestValue({ recoveryKey: identity.recoveryKey })
      : digestValue(semanticLifecycleProjection(state))
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
      const mapping = writeSessionMapping(paths, null, sessionKey, state, options)
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
        compactBytes: compact.bytes
      }
    } catch (error) {
      return { status: 'error', errorCode: error.code || 'LIFECYCLE_EPHEMERAL_WRITE_FAILED', message: error.message }
    }
  }
  const commit = commitTaskEnvelope(input.metaDir, identity, state, options)
  if (commit.status === 'committed' ||
      (commit.status === 'semantic-noop' && options.touchSessionMapping === true)) {
    try { commit.mapping = writeSessionMapping(paths, identity, sessionKey, state, options) } catch (error) {
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
  const ownerKey = ephemeralOwnerKey(input.sessionKey)
  if (!ownerKey) return { status: 'missing', errorCode: 'LIFECYCLE_SESSION_KEY_REQUIRED' }
  const ring = readEphemeralRing(paths, fsImpl)
  if (ring.status !== 'fresh') return ring
  const entry = ring.current.ring.entries.find(item => item.ownerKey === ownerKey)
  if (!entry) return { status: 'missing', errorCode: 'LIFECYCLE_SESSION_MAPPING_MISSING' }
  const expected = input.expectedIdentity?.activeRoot && input.expectedIdentity?.project
    ? normalizeIdentity(input.expectedIdentity, { allowEphemeral: true })
    : null
  if (entry.identity && expected && !sameIdentity(entry.identity, expected, { allowMissingTask: true })) {
    return { status: 'identity-mismatch', errorCode: 'LIFECYCLE_STATE_IDENTITY_MISMATCH', observedIdentity: entry.identity }
  }
  if (!entry.taskKey) return { status: 'ephemeral-stub', state: entry.state || {}, identity: entry.identity || null }
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

module.exports = {
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
  MUTATION_PREFLIGHT_STATE_MAX_BYTES,
  TASK_RECOVERY_CLOSEOUT_SCHEMA,
  TASK_RECOVERY_COMMIT_SCHEMA,
  TASK_RECOVERY_DOCTOR_SCHEMA,
  TASK_RECOVERY_EPHEMERAL_SCHEMA,
  TASK_RECOVERY_KEY_SCHEMA,
  TASK_RECOVERY_STATE_SCHEMA,
  TASK_RECOVERY_STATUS_SCHEMA,
  TaskRecoveryStoreV5Error,
  appendTaskRecoveryTelemetry,
  commitTaskRecoveryState,
  createTaskRecoveryKey,
  diagnoseTaskRecoveryStore,
  ensureReserve,
  inspectTaskRecoveryStore,
  inspectDiskHeadroom,
  maintainTaskRecoveryStore,
  normalizeIdentity,
  readTaskRecoveryState,
  readTaskSlots,
  resolveTaskRecoveryMetaDir,
  sameIdentity,
  storePaths,
  taskPaths,
  updateTaskRecoveryState,
  writeEmergencyCloseout,
  writeStableProjection
}
