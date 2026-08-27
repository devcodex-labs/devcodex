'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { stableStringify, validateContentIdentity } = require('./content-identity.cjs')
const {
  isTransientWindowsFsError,
  retryTransientWindowsFs,
  waitSync
} = require('./windows-fs-retry.cjs')

const DERIVED_STATE_RECEIPT_SCHEMA = 'DerivedStateStoreReceiptV1'
const DERIVED_STATE_LOCK_SCHEMA = 'DerivedStateLockV2'

class DerivedStateStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DerivedStateStoreError'
    this.code = code
  }
}

function resolveInside(root, relativePath) {
  const absoluteRoot = path.resolve(root)
  const absolutePath = path.resolve(absoluteRoot, String(relativePath || ''))
  const relative = path.relative(absoluteRoot, absolutePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new DerivedStateStoreError('DERIVED_STATE_PATH_ESCAPE', `derived-state path must stay below ${absoluteRoot}`)
  }
  return absolutePath
}

function sameIdentity(left, right) {
  const leftValidation = validateContentIdentity(left)
  const rightValidation = validateContentIdentity(right)
  if (!leftValidation.valid || !rightValidation.valid) return false
  return stableStringify(left) === stableStringify(right)
}

function stateDigest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function createDerivedStateStore({
  root,
  relativePath,
  maxBytes = 4 * 1024 * 1024,
  lockWaitMs = 2000,
  lockLeaseMs = 30 * 1000,
  maxWrites = 1,
  identityField = 'sourceIdentity',
  now = () => Date.now(),
  fs: fsImpl = fs,
  hostname = () => os.hostname(),
  pid = process.pid,
  processKill = process.kill.bind(process),
  randomUUID = () => crypto.randomUUID()
}) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new DerivedStateStoreError('DERIVED_STATE_INVALID_BUDGET', 'maxBytes must be a positive integer')
  }
  if (!Number.isInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > 2000) {
    throw new DerivedStateStoreError('DERIVED_STATE_INVALID_LOCK_WAIT', 'lockWaitMs must be an integer from 0 to 2000')
  }
  if (!Number.isInteger(lockLeaseMs) || lockLeaseMs < 1000 || lockLeaseMs > 5 * 60 * 1000) {
    throw new DerivedStateStoreError('DERIVED_STATE_INVALID_LOCK_LEASE', 'lockLeaseMs must be an integer from 1000 to 300000')
  }
  if (!Number.isInteger(maxWrites) || maxWrites < 0) {
    throw new DerivedStateStoreError('DERIVED_STATE_INVALID_WRITE_BUDGET', 'maxWrites must be a non-negative integer')
  }

  const filePath = resolveInside(root, relativePath)
  const lockPath = `${filePath}.lock`
  let writes = 0

  function receipt(status, details = {}) {
    return {
      schemaVersion: DERIVED_STATE_RECEIPT_SCHEMA,
      status,
      filePath,
      ...details
    }
  }

  function read({ expectedIdentity = null } = {}) {
    let stats
    try { stats = fsImpl.statSync(filePath) } catch (error) {
      if (error?.code === 'ENOENT') return receipt('missing')
      return receipt('invalid', { errorCode: 'DERIVED_STATE_READ_FAILED', message: error.message })
    }
    if (!stats.isFile()) return receipt('invalid', { errorCode: 'DERIVED_STATE_NOT_FILE' })
    if (stats.size > maxBytes) {
      return receipt('bypassed', {
        errorCode: 'DERIVED_STATE_CAPACITY_EXCEEDED',
        bytes: stats.size,
        maxBytes
      })
    }

    let value
    try { value = JSON.parse(fsImpl.readFileSync(filePath, 'utf8')) } catch (error) {
      return receipt('invalid', { errorCode: 'DERIVED_STATE_INVALID_JSON', message: error.message })
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return receipt('invalid', { errorCode: 'DERIVED_STATE_INVALID_SHAPE' })
    }
    if (expectedIdentity && !sameIdentity(value[identityField], expectedIdentity)) {
      return receipt('stale', { value, observedIdentity: value[identityField] || null })
    }
    return receipt('fresh', { value, bytes: stats.size })
  }

  function parseLockRecord(raw) {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  function readLockRecord() {
    try {
      return parseLockRecord(fsImpl.readFileSync(lockPath, 'utf8'))
    } catch {
      return null
    }
  }

  function isValidLockRecord(record) {
    return Boolean(
      record &&
      record.schemaVersion === DERIVED_STATE_LOCK_SCHEMA &&
      typeof record.ownerToken === 'string' && record.ownerToken &&
      typeof record.hostname === 'string' && record.hostname &&
      Number.isInteger(record.pid) && record.pid > 0 &&
      Number.isFinite(record.leaseExpiresAtMs)
    )
  }

  function ownerLiveness(record) {
    if (!isValidLockRecord(record)) return 'unknown'
    if (record.hostname !== hostname()) return 'unknown'
    try {
      processKill(record.pid, 0)
      return 'live'
    } catch (error) {
      return error?.code === 'ESRCH' ? 'dead' : 'unknown'
    }
  }

  function lockStatIdentity(stats) {
    return {
      dev: Number.isFinite(stats?.dev) ? stats.dev : null,
      ino: Number.isFinite(stats?.ino) ? stats.ino : null,
      size: Number.isFinite(stats?.size) ? stats.size : null,
      mtimeMs: Number.isFinite(stats?.mtimeMs) ? stats.mtimeMs : null
    }
  }

  function sameLockStat(left, right) {
    return stableStringify(lockStatIdentity(left)) === stableStringify(lockStatIdentity(right))
  }

  function readLockObservation() {
    let before
    try {
      before = fsImpl.statSync(lockPath)
    } catch (error) {
      return error?.code === 'ENOENT'
        ? { status: 'missing', identity: null, record: null }
        : { status: 'protected-unknown', identity: null, record: null, errorCode: error?.code || 'LOCK_STAT_FAILED' }
    }
    if (!before.isFile()) {
      return { status: 'protected-unknown', identity: null, record: null, errorCode: 'LOCK_NOT_FILE' }
    }

    let raw
    try {
      raw = fsImpl.readFileSync(lockPath, 'utf8')
    } catch (error) {
      return error?.code === 'ENOENT'
        ? { status: 'missing', identity: null, record: null }
        : { status: 'protected-unknown', identity: null, record: null, errorCode: error?.code || 'LOCK_READ_FAILED' }
    }

    let after
    try {
      after = fsImpl.statSync(lockPath)
    } catch (error) {
      return error?.code === 'ENOENT'
        ? { status: 'missing', identity: null, record: null }
        : { status: 'protected-unknown', identity: null, record: null, errorCode: error?.code || 'LOCK_RESTAT_FAILED' }
    }
    if (!sameLockStat(before, after)) {
      return { status: 'changed', identity: null, record: null }
    }

    const identity = {
      ...lockStatIdentity(after),
      contentDigest: crypto.createHash('sha256').update(raw).digest('hex')
    }
    const record = parseLockRecord(raw)
    if (!isValidLockRecord(record)) {
      const modifiedAtMs = Number(after.mtimeMs)
      const ageMs = Number.isFinite(modifiedAtMs) ? Math.max(0, now() - modifiedAtMs) : 0
      return {
        status: Number.isFinite(modifiedAtMs) && ageMs > lockLeaseMs
          ? 'stale-malformed'
          : 'fresh-malformed',
        identity,
        record: null,
        ageMs
      }
    }

    const liveness = ownerLiveness(record)
    if (liveness === 'live') return { status: 'valid-live', identity, record }
    if (liveness === 'dead') return { status: 'valid-dead', identity, record }
    return {
      status: record.leaseExpiresAtMs < now()
        ? 'valid-expired-unknown'
        : 'valid-unexpired-unknown',
      identity,
      record
    }
  }

  function lockRecoveryReason(observation) {
    if (observation?.status === 'valid-dead') return 'dead-owner'
    if (observation?.status === 'valid-expired-unknown') return 'expired-unknown-owner'
    if (observation?.status === 'stale-malformed') return 'stale-malformed'
    return null
  }

  function sameLockObservation(left, right) {
    if (!left?.identity || !right?.identity) return false
    return stableStringify(left.identity) === stableStringify(right.identity)
  }

  function quarantineRecoverableLock(observation) {
    const recoveryReason = lockRecoveryReason(observation)
    if (!recoveryReason) return null
    const confirmed = readLockObservation()
    if (!sameLockObservation(observation, confirmed) || lockRecoveryReason(confirmed) !== recoveryReason) return null
    const quarantinePath = `${lockPath}.quarantine`
    try {
      if (fsImpl.existsSync(quarantinePath)) fsImpl.unlinkSync(quarantinePath)
      fsImpl.renameSync(lockPath, quarantinePath)
      return { quarantinePath, recoveryReason }
    } catch (error) {
      if (error?.code === 'ENOENT') return { quarantinePath: '', recoveryReason: null }
      return null
    }
  }

  function acquireLock() {
    const startedAt = now()
    let staleLockQuarantined = false
    let quarantinePath = ''
    let lockRecoveryReason = null
    while (true) {
      try {
        fsImpl.mkdirSync(path.dirname(filePath), { recursive: true })
        const descriptor = fsImpl.openSync(lockPath, 'wx')
        const acquiredAtMs = now()
        const ownerToken = randomUUID()
        const record = {
          schemaVersion: DERIVED_STATE_LOCK_SCHEMA,
          ownerToken,
          hostname: hostname(),
          pid,
          acquiredAtMs,
          acquiredAt: new Date(acquiredAtMs).toISOString(),
          leaseExpiresAtMs: acquiredAtMs + lockLeaseMs
        }
        try {
          fsImpl.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
          if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
        } catch (error) {
          try { fsImpl.closeSync(descriptor) } catch { }
          try { retryTransientWindowsFs(() => fsImpl.unlinkSync(lockPath)) } catch { }
          throw error
        }
        return {
          descriptor,
          ownerToken,
          waitedMs: Math.max(0, now() - startedAt),
          staleLockQuarantined,
          quarantinePath,
          lockRecoveryReason
        }
      } catch (error) {
        if (error?.code !== 'EEXIST' && !isTransientWindowsFsError(error)) throw error
        const observed = readLockObservation()
        const quarantined = quarantineRecoverableLock(observed)
        if (quarantined !== null) {
          if (quarantined.quarantinePath) {
            staleLockQuarantined = true
            quarantinePath = quarantined.quarantinePath
            lockRecoveryReason = quarantined.recoveryReason
          }
          continue
        }
        const elapsed = now() - startedAt
        if (elapsed >= lockWaitMs) return null
        waitSync(Math.min(25, lockWaitMs - elapsed))
      }
    }
  }

  function releaseLock(lock) {
    try { fsImpl.closeSync(lock.descriptor) } catch { }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const observed = readLockRecord()
      if (!observed || observed.ownerToken !== lock.ownerToken) return false
      try {
        fsImpl.unlinkSync(lockPath)
        return true
      } catch (error) {
        if (!isTransientWindowsFsError(error) || attempt === 39) return false
        waitSync(5)
      }
    }
    return false
  }

  function persistLocked(value, lock) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new DerivedStateStoreError('DERIVED_STATE_INVALID_VALUE', 'derived state must be a JSON object')
    }
    const serialized = JSON.stringify(value, null, 2) + '\n'
    const bytes = Buffer.byteLength(serialized)
    if (bytes > maxBytes) {
      return receipt('bypassed', { errorCode: 'DERIVED_STATE_CAPACITY_EXCEEDED', bytes, maxBytes })
    }

    writes += 1
    const tempPath = `${filePath}.next.tmp`
    try {
      if (fsImpl.existsSync(tempPath)) fsImpl.unlinkSync(tempPath)
      const descriptor = fsImpl.openSync(tempPath, 'wx')
      try {
        fsImpl.writeFileSync(descriptor, serialized, 'utf8')
        if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
      } finally {
        fsImpl.closeSync(descriptor)
      }
      const replacement = retryTransientWindowsFs(() => fsImpl.renameSync(tempPath, filePath))
      const readback = read()
      if (readback.status !== 'fresh' || stableStringify(readback.value) !== stableStringify(value)) {
        return receipt('error', { errorCode: 'DERIVED_STATE_READBACK_MISMATCH' })
      }
      return receipt('persisted', {
        bytes,
        waitedMs: lock.waitedMs,
        writes,
        maxWrites,
        ownerToken: lock.ownerToken,
        staleLockQuarantined: lock.staleLockQuarantined,
        quarantinePath: lock.quarantinePath || null,
        lockRecoveryReason: lock.lockRecoveryReason || null,
        replaceRetries: replacement.retries
      })
    } catch (error) {
      try { fsImpl.unlinkSync(tempPath) } catch { }
      return receipt('error', { errorCode: 'DERIVED_STATE_WRITE_FAILED', message: error.message })
    }
  }

  function write(value) {
    if (writes >= maxWrites) {
      return receipt('bypassed', { errorCode: 'DERIVED_STATE_WRITE_BUDGET_REACHED', maxWrites })
    }
    let lock
    try { lock = acquireLock() } catch (error) {
      return receipt('error', { errorCode: 'DERIVED_STATE_LOCK_FAILED', message: error.message })
    }
    if (!lock) {
      return receipt('bypassed', {
        errorCode: 'DERIVED_STATE_LOCK_TIMEOUT',
        lockWaitMs,
        staleLockCleanupRequired: false
      })
    }

    try {
      return persistLocked(value, lock)
    } finally {
      releaseLock(lock)
    }
  }

  function update(updater, { expectedIdentity = null, expectedDigest = null } = {}) {
    if (writes >= maxWrites) {
      return receipt('bypassed', { errorCode: 'DERIVED_STATE_WRITE_BUDGET_REACHED', maxWrites })
    }
    if (typeof updater !== 'function') {
      throw new DerivedStateStoreError('DERIVED_STATE_INVALID_UPDATER', 'derived-state updater must be a function')
    }
    let lock
    try { lock = acquireLock() } catch (error) {
      return receipt('error', { errorCode: 'DERIVED_STATE_LOCK_FAILED', message: error.message })
    }
    if (!lock) {
      return receipt('bypassed', {
        errorCode: 'DERIVED_STATE_LOCK_TIMEOUT',
        lockWaitMs,
        staleLockCleanupRequired: true
      })
    }
    try {
      const current = read({ expectedIdentity })
      if (!['fresh', 'missing'].includes(current.status)) return current
      const observedDigest = current.status === 'fresh' ? stateDigest(current.value) : null
      if (expectedDigest !== null && observedDigest !== expectedDigest) {
        return receipt('stale', {
          errorCode: 'DERIVED_STATE_CAS_MISMATCH',
          expectedDigest,
          observedDigest
        })
      }
      const next = updater(current.status === 'fresh' ? current.value : {}, current)
      return persistLocked(next, lock)
    } finally {
      releaseLock(lock)
    }
  }

  return Object.freeze({ filePath, lockPath, read, write, update })
}

module.exports = {
  DERIVED_STATE_RECEIPT_SCHEMA,
  DERIVED_STATE_LOCK_SCHEMA,
  DerivedStateStoreError,
  createDerivedStateStore,
  resolveInside,
  sameIdentity,
  stateDigest
}
