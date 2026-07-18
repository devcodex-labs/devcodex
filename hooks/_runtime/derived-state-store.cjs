'use strict'

const fs = require('fs')
const path = require('path')
const { stableStringify, validateContentIdentity } = require('./content-identity.cjs')

const DERIVED_STATE_RECEIPT_SCHEMA = 'DerivedStateStoreReceiptV1'

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
  maxWrites = 1,
  identityField = 'sourceIdentity',
  now = () => Date.now()
}) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new DerivedStateStoreError('DERIVED_STATE_INVALID_BUDGET', 'maxBytes must be a positive integer')
  }
  if (!Number.isInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > 2000) {
    throw new DerivedStateStoreError('DERIVED_STATE_INVALID_LOCK_WAIT', 'lockWaitMs must be an integer from 0 to 2000')
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
    try { stats = fs.statSync(filePath) } catch (error) {
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
    try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch (error) {
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

  function acquireLock() {
    const startedAt = now()
    while (true) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        const descriptor = fs.openSync(lockPath, 'wx')
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: new Date(now()).toISOString() }) + '\n', 'utf8')
        return { descriptor, waitedMs: Math.max(0, now() - startedAt) }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        const elapsed = now() - startedAt
        if (elapsed >= lockWaitMs) return null
        waitSync(Math.min(25, lockWaitMs - elapsed))
      }
    }
  }

  function write(value) {
    if (writes >= maxWrites) {
      return receipt('bypassed', { errorCode: 'DERIVED_STATE_WRITE_BUDGET_REACHED', maxWrites })
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new DerivedStateStoreError('DERIVED_STATE_INVALID_VALUE', 'derived state must be a JSON object')
    }
    const serialized = JSON.stringify(value, null, 2) + '\n'
    const bytes = Buffer.byteLength(serialized)
    if (bytes > maxBytes) {
      return receipt('bypassed', { errorCode: 'DERIVED_STATE_CAPACITY_EXCEEDED', bytes, maxBytes })
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

    writes += 1
    const tempPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
    try {
      fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' })
      fs.renameSync(tempPath, filePath)
      return receipt('persisted', { bytes, waitedMs: lock.waitedMs, writes, maxWrites })
    } catch (error) {
      try { fs.unlinkSync(tempPath) } catch { }
      return receipt('error', { errorCode: 'DERIVED_STATE_WRITE_FAILED', message: error.message })
    } finally {
      try { fs.closeSync(lock.descriptor) } catch { }
      // This process created this lock and still owns the write critical section.
      try { fs.unlinkSync(lockPath) } catch { }
    }
  }

  return Object.freeze({ filePath, lockPath, read, write })
}

module.exports = {
  DERIVED_STATE_RECEIPT_SCHEMA,
  DerivedStateStoreError,
  createDerivedStateStore,
  resolveInside,
  sameIdentity
}
