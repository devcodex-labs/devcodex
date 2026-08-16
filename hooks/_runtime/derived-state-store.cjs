'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { stableStringify, validateContentIdentity } = require('./content-identity.cjs')

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

function waitSync(milliseconds) {
  if (milliseconds <= 0) return
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
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

  function readLockRecord() {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(lockPath, 'utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  function ownerLiveness(record) {
    if (!record || record.schemaVersion !== DERIVED_STATE_LOCK_SCHEMA ||
        typeof record.ownerToken !== 'string' || !record.ownerToken ||
        typeof record.hostname !== 'string' || !record.hostname ||
        !Number.isInteger(record.pid) || record.pid <= 0 ||
        !Number.isFinite(record.leaseExpiresAtMs)) {
      return 'unknown'
    }
    if (record.hostname !== hostname()) return 'unknown'
    try {
      processKill(record.pid, 0)
      return 'live'
    } catch (error) {
      return error?.code === 'ESRCH' ? 'dead' : 'unknown'
    }
  }

  function quarantineDeadLock(record) {
    if (ownerLiveness(record) !== 'dead') return null
    const quarantinePath = `${lockPath}.quarantine-${record.ownerToken}-${randomUUID()}`
    try {
      fsImpl.renameSync(lockPath, quarantinePath)
      return quarantinePath
    } catch (error) {
      if (error?.code === 'ENOENT') return ''
      return null
    }
  }

  function acquireLock() {
    const startedAt = now()
    let staleLockQuarantined = false
    let quarantinePath = ''
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
          try { fsImpl.unlinkSync(lockPath) } catch { }
          throw error
        }
        return {
          descriptor,
          ownerToken,
          waitedMs: Math.max(0, now() - startedAt),
          staleLockQuarantined,
          quarantinePath
        }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        if (!staleLockQuarantined) {
          const observed = readLockRecord()
          const quarantined = quarantineDeadLock(observed)
          if (quarantined !== null) {
            staleLockQuarantined = true
            quarantinePath = quarantined
            continue
          }
        }
        const elapsed = now() - startedAt
        if (elapsed >= lockWaitMs) return null
        waitSync(Math.min(25, lockWaitMs - elapsed))
      }
    }
  }

  function releaseLock(lock) {
    try { fsImpl.closeSync(lock.descriptor) } catch { }
    const observed = readLockRecord()
    if (!observed || observed.ownerToken !== lock.ownerToken) return false
    try {
      fsImpl.unlinkSync(lockPath)
      return true
    } catch {
      return false
    }
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
    const tempPath = `${filePath}.tmp-${pid}-${randomUUID()}`
    try {
      const descriptor = fsImpl.openSync(tempPath, 'wx')
      try {
        fsImpl.writeFileSync(descriptor, serialized, 'utf8')
        if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
      } finally {
        fsImpl.closeSync(descriptor)
      }
      fsImpl.renameSync(tempPath, filePath)
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
        quarantinePath: lock.quarantinePath || null
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
