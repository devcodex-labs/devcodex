'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  isTransientWindowsFsError,
  retryTransientWindowsFs
} = require('./windows-fs-retry.cjs')

const WORKSPACE_SESSION_ROUTE_INDEX_SCHEMA = 'WorkspaceSessionRouteIndexV1'
const WORKSPACE_SESSION_ROUTE_ENTRY_SCHEMA = 'WorkspaceSessionRouteEntryV1'
const WORKSPACE_SESSION_ROUTE_RECEIPT_SCHEMA = 'WorkspaceSessionRouteIndexReceiptV1'
const WORKSPACE_SESSION_ROUTE_LOCK_SCHEMA = 'WorkspaceSessionRouteLockV1'
const ROUTE_INDEX_SLOT_MAX_BYTES = 1024 * 1024
const ROUTE_INDEX_ENTRY_MAX_BYTES = 1024
const ROUTE_INDEX_TTL_MS = 24 * 60 * 60 * 1000
const ROUTE_INDEX_EVICTION_THRESHOLD_BYTES = Math.floor(ROUTE_INDEX_SLOT_MAX_BYTES * 0.75)
const ROUTE_INDEX_STRIPE_COUNT = 32
const ROUTE_INDEX_LOCK_WAIT_MS = 2000
const ROUTE_INDEX_LOCK_LEASE_MS = 30 * 1000

const ROUTE_WRITE_TRIGGERS = new Set([
  'user-message',
  'project-switch',
  'admission-bind',
  'task-bind',
  'terminal-unbind',
  'same-session-shrink'
])

class WorkspaceSessionRouteIndexError extends Error {
  constructor (code, message, details = {}) {
    super(message)
    this.name = 'WorkspaceSessionRouteIndexError'
    this.code = code
    this.details = details
  }
}

function stableValue (value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function stableStringify (value) {
  return JSON.stringify(stableValue(value))
}

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function isDigest (value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''))
}

function boundedString (value, maximum, field) {
  const text = String(value || '').trim()
  if (Buffer.byteLength(text, 'utf8') > maximum) {
    throw new WorkspaceSessionRouteIndexError(
      'WORKSPACE_SESSION_ROUTE_FIELD_TOO_LARGE',
      `${field} exceeds ${maximum} UTF-8 bytes`,
      { field, maximum }
    )
  }
  return text
}

function digestSessionRef (sessionRef) {
  const value = String(sessionRef || '').trim()
  if (!value) {
    throw new WorkspaceSessionRouteIndexError(
      'WORKSPACE_SESSION_ROUTE_SESSION_REQUIRED',
      'a stable session or turn reference is required'
    )
  }
  return sha256(`devcodex-workspace-session-route-v1\u0000${value}`)
}

function resolveSessionDigest (input = {}) {
  const supplied = String(input.sessionDigest || '').trim().toLowerCase()
  if (supplied) {
    if (!isDigest(supplied)) {
      throw new WorkspaceSessionRouteIndexError(
        'WORKSPACE_SESSION_ROUTE_SESSION_DIGEST_INVALID',
        'sessionDigest must be a lowercase sha256 digest'
      )
    }
    if (String(input.sessionRef || '').trim() && digestSessionRef(input.sessionRef) !== supplied) {
      throw new WorkspaceSessionRouteIndexError(
        'WORKSPACE_SESSION_ROUTE_SESSION_DIGEST_MISMATCH',
        'sessionRef and sessionDigest identify different sessions'
      )
    }
    return supplied
  }
  return digestSessionRef(input.sessionRef)
}

function routeIndexPaths (metaDir, pathImpl = path) {
  if (!String(metaDir || '').trim()) {
    throw new WorkspaceSessionRouteIndexError(
      'WORKSPACE_SESSION_ROUTE_ROOT_REQUIRED',
      'metaDir is required'
    )
  }
  const root = pathImpl.resolve(String(metaDir || ''))
  const storeRoot = pathImpl.join(root, 'workspace-session-route-index-v1')
  return {
    root: storeRoot,
    slots: [
      pathImpl.join(storeRoot, 'index-a.json'),
      pathImpl.join(storeRoot, 'index-b.json')
    ],
    temp: pathImpl.join(storeRoot, 'index-next.tmp'),
    globalLock: pathImpl.join(storeRoot, 'global-route-writer.lock'),
    stripeRoot: pathImpl.join(storeRoot, 'session-stripes')
  }
}

function stripeNumberForDigest (sessionDigest) {
  return Number.parseInt(String(sessionDigest).slice(0, 8), 16) % ROUTE_INDEX_STRIPE_COUNT
}

function stripeLockPath (paths, sessionDigest, pathImpl = path) {
  const stripe = stripeNumberForDigest(sessionDigest)
  return {
    stripe,
    file: pathImpl.join(paths.stripeRoot, `${String(stripe).padStart(2, '0')}.lock`)
  }
}

function jsonBytes (value) {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function entryCore (input, nowMs, existing = null) {
  const trigger = String(input.trigger || '').trim()
  if (!ROUTE_WRITE_TRIGGERS.has(trigger)) {
    throw new WorkspaceSessionRouteIndexError(
      'WORKSPACE_SESSION_ROUTE_TRIGGER_DENIED',
      `route writes are not allowed for trigger: ${trigger || '<empty>'}`
    )
  }
  const sessionDigest = resolveSessionDigest(input)
  const terminal = trigger === 'terminal-unbind'
  const projectRootIdentityDigest = String(
    input.projectRootIdentityDigest || existing?.projectRootIdentityDigest || ''
  ).trim().toLowerCase()
  if (!isDigest(projectRootIdentityDigest)) {
    throw new WorkspaceSessionRouteIndexError(
      'WORKSPACE_SESSION_ROUTE_PROJECT_IDENTITY_REQUIRED',
      'projectRootIdentityDigest must be a lowercase sha256 digest'
    )
  }
  const taskId = terminal || trigger === 'same-session-shrink'
    ? boundedString(input.taskId || '', 256, 'taskId')
    : boundedString(input.taskId || existing?.taskId || '', 256, 'taskId')
  const routeRevision = boundedString(
    input.routeRevision || existing?.routeRevision || 'pending',
    128,
    'routeRevision'
  )
  const lastTerminalReceiptDigest = String(
    input.lastTerminalReceiptDigest || existing?.lastTerminalReceiptDigest || ''
  ).trim().toLowerCase()
  if (lastTerminalReceiptDigest && !isDigest(lastTerminalReceiptDigest)) {
    throw new WorkspaceSessionRouteIndexError(
      'WORKSPACE_SESSION_ROUTE_TERMINAL_DIGEST_INVALID',
      'lastTerminalReceiptDigest must be empty or a lowercase sha256 digest'
    )
  }
  const ttlMs = Number.isInteger(input.ttlMs)
    ? Math.min(Math.max(1, input.ttlMs), ROUTE_INDEX_TTL_MS)
    : ROUTE_INDEX_TTL_MS
  const state = terminal ? 'unbound' : 'live'
  return {
    schemaVersion: WORKSPACE_SESSION_ROUTE_ENTRY_SCHEMA,
    sessionDigest,
    projectRootIdentityDigest,
    ...(taskId ? { taskId } : {}),
    routeRevision,
    state,
    expiresAtMs: nowMs + ttlMs,
    ...(lastTerminalReceiptDigest ? { lastTerminalReceiptDigest } : {})
  }
}

function sealEntry (core) {
  const entry = { ...core, entryDigest: sha256(stableStringify(core)) }
  const bytes = jsonBytes(entry)
  if (bytes > ROUTE_INDEX_ENTRY_MAX_BYTES) {
    throw new WorkspaceSessionRouteIndexError(
      'WORKSPACE_SESSION_ROUTE_ENTRY_CAPACITY_EXCEEDED',
      `route entry exceeds ${ROUTE_INDEX_ENTRY_MAX_BYTES} bytes`,
      { bytes, maximumBytes: ROUTE_INDEX_ENTRY_MAX_BYTES }
    )
  }
  return entry
}

function validateEntry (entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  if (entry.schemaVersion !== WORKSPACE_SESSION_ROUTE_ENTRY_SCHEMA) return false
  if (!isDigest(entry.sessionDigest) || !isDigest(entry.projectRootIdentityDigest)) return false
  if (!['live', 'unbound'].includes(entry.state)) return false
  if (!Number.isFinite(Number(entry.expiresAtMs))) return false
  if (entry.lastTerminalReceiptDigest && !isDigest(entry.lastTerminalReceiptDigest)) return false
  const { entryDigest, ...core } = entry
  return isDigest(entryDigest) && entryDigest === sha256(stableStringify(core)) &&
    jsonBytes(entry) <= ROUTE_INDEX_ENTRY_MAX_BYTES
}

function sealIndex (sequence, entries, nowMs) {
  const core = {
    schemaVersion: WORKSPACE_SESSION_ROUTE_INDEX_SCHEMA,
    sequence,
    writtenAt: new Date(nowMs).toISOString(),
    entries: [...entries].sort((left, right) => left.sessionDigest.localeCompare(right.sessionDigest))
  }
  return { ...core, contentDigest: sha256(stableStringify(core)) }
}

function validateIndex (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.schemaVersion !== WORKSPACE_SESSION_ROUTE_INDEX_SCHEMA) return false
  if (!Number.isInteger(value.sequence) || value.sequence < 1 || !Array.isArray(value.entries)) return false
  if (jsonBytes(value) > ROUTE_INDEX_SLOT_MAX_BYTES || !value.entries.every(validateEntry)) return false
  const digests = value.entries.map(entry => entry.sessionDigest)
  if (new Set(digests).size !== digests.length) return false
  const { contentDigest, ...core } = value
  return isDigest(contentDigest) && contentDigest === sha256(stableStringify(core))
}

function readSlot (file, fsImpl = fs) {
  let stats
  try { stats = fsImpl.statSync(file) } catch (error) {
    return error?.code === 'ENOENT'
      ? { status: 'missing', file }
      : { status: 'invalid', file, errorCode: error?.code || 'ROUTE_INDEX_SLOT_STAT_FAILED' }
  }
  if (!stats.isFile() || stats.size > ROUTE_INDEX_SLOT_MAX_BYTES) {
    return { status: 'invalid', file, bytes: stats.size, errorCode: 'ROUTE_INDEX_SLOT_CAPACITY_INVALID' }
  }
  try {
    const value = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
    return validateIndex(value)
      ? { status: 'fresh', file, bytes: stats.size, value }
      : { status: 'invalid', file, bytes: stats.size, errorCode: 'ROUTE_INDEX_SLOT_INTEGRITY_INVALID' }
  } catch (error) {
    return { status: 'invalid', file, bytes: stats.size, errorCode: error?.code || 'ROUTE_INDEX_SLOT_JSON_INVALID' }
  }
}

function readIndexFromPaths (paths, fsImpl = fs) {
  const slots = paths.slots.map(file => readSlot(file, fsImpl))
  const fresh = slots.filter(slot => slot.status === 'fresh')
    .sort((left, right) => right.value.sequence - left.value.sequence ||
      right.value.contentDigest.localeCompare(left.value.contentDigest))
  if (fresh.length) {
    return { status: 'fresh', index: fresh[0].value, file: fresh[0].file, slots }
  }
  if (slots.every(slot => slot.status === 'missing')) {
    return { status: 'missing', index: null, file: null, slots }
  }
  return { status: 'invalid', index: null, file: null, slots, errorCode: 'WORKSPACE_SESSION_ROUTE_INDEX_CORRUPT' }
}

function waitSync (milliseconds) {
  if (milliseconds <= 0) return
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(sleeper, 0, 0, milliseconds)
}

function readLockRecord (file, fsImpl) {
  try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')) } catch { return null }
}

function localPidAlive (pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    const kill = options.processKill || process.kill.bind(process)
    kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function acquireLock (file, role, options = {}) {
  const fsImpl = options.fs || fs
  const now = options.now || (() => Date.now())
  const waitMs = Number.isInteger(options.lockWaitMs) ? options.lockWaitMs : ROUTE_INDEX_LOCK_WAIT_MS
  const leaseMs = Number.isInteger(options.lockLeaseMs) ? options.lockLeaseMs : ROUTE_INDEX_LOCK_LEASE_MS
  const startedAt = now()
  while (true) {
    let descriptor
    let created = false
    try {
      fsImpl.mkdirSync(path.dirname(file), { recursive: true })
      descriptor = fsImpl.openSync(file, 'wx')
      created = true
      const acquiredAtMs = now()
      const record = {
        schemaVersion: WORKSPACE_SESSION_ROUTE_LOCK_SCHEMA,
        role,
        ownerToken: (options.randomUUID || crypto.randomUUID)(),
        hostname: options.hostname || os.hostname(),
        pid: Number.isInteger(options.pid) ? options.pid : process.pid,
        acquiredAtMs,
        leaseExpiresAtMs: acquiredAtMs + leaseMs
      }
      fsImpl.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
      if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
      return {
        descriptor,
        file,
        record,
        waitedMs: Math.max(0, now() - startedAt),
        retryOptions: {
          platform: options.platform,
          maxAttempts: options.windowsFsRetryMaxAttempts,
          delayMs: options.windowsFsRetryDelayMs
        }
      }
    } catch (error) {
      if (descriptor !== undefined) {
        try { fsImpl.closeSync(descriptor) } catch {}
      }
      if (created) {
        try {
          retryTransientWindowsFs(() => fsImpl.unlinkSync(file), {
            platform: options.platform,
            maxAttempts: options.windowsFsRetryMaxAttempts,
            delayMs: options.windowsFsRetryDelayMs
          })
        } catch {}
      }
      if (error?.code !== 'EEXIST' && !isTransientWindowsFsError(error, options)) throw error
      const record = readLockRecord(file, fsImpl)
      const expiresAtMs = Number(record?.leaseExpiresAtMs)
      const expired = Number.isFinite(expiresAtMs) && expiresAtMs < now()
      const localOwner = record?.hostname === (options.hostname || os.hostname())
      if (expired && (!localOwner || !localPidAlive(Number(record?.pid), options))) {
        try { fsImpl.unlinkSync(file); continue } catch {}
      }
      if (now() - startedAt >= waitMs) return null
      waitSync(Math.min(25, waitMs - (now() - startedAt)))
    }
  }
}

function releaseLock (lock, fsImpl = fs) {
  if (!lock) return
  try { fsImpl.closeSync(lock.descriptor) } catch {}
  try {
    const current = readLockRecord(lock.file, fsImpl)
    if (current?.ownerToken === lock.record.ownerToken) {
      retryTransientWindowsFs(() => fsImpl.unlinkSync(lock.file), lock.retryOptions)
    }
  } catch {}
}

function writeIndexSlot (paths, index, fsImpl = fs, maximumBytes = ROUTE_INDEX_SLOT_MAX_BYTES) {
  const bytes = jsonBytes(index)
  if (bytes > maximumBytes) {
    return { status: 'blocked', errorCode: 'WORKSPACE_SESSION_ROUTE_INDEX_CAPACITY_EXCEEDED', bytes }
  }
  const target = paths.slots[(index.sequence - 1) % paths.slots.length]
  let descriptor
  try {
    fsImpl.mkdirSync(paths.root, { recursive: true })
    try { fsImpl.unlinkSync(paths.temp) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    descriptor = fsImpl.openSync(paths.temp, 'wx')
    fsImpl.writeFileSync(descriptor, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
    fsImpl.closeSync(descriptor)
    descriptor = undefined
    fsImpl.renameSync(paths.temp, target)
    const readback = readSlot(target, fsImpl)
    if (readback.status !== 'fresh' || readback.value.contentDigest !== index.contentDigest) {
      return { status: 'error', errorCode: 'WORKSPACE_SESSION_ROUTE_INDEX_READBACK_MISMATCH', file: target }
    }
    return { status: 'persisted', file: target, bytes }
  } catch (error) {
    if (descriptor !== undefined) {
      try { fsImpl.closeSync(descriptor) } catch {}
    }
    try { fsImpl.unlinkSync(paths.temp) } catch {}
    return { status: 'error', errorCode: error?.code || 'WORKSPACE_SESSION_ROUTE_INDEX_WRITE_FAILED', message: error.message }
  }
}

function pruneReclaimableEntries (entries, nowMs, protectedSessionDigest = '') {
  const retained = []
  const evicted = []
  for (const entry of entries) {
    const reclaimable = Number(entry.expiresAtMs) <= nowMs || entry.state === 'unbound'
    if (reclaimable && entry.sessionDigest !== protectedSessionDigest) evicted.push(entry.sessionDigest)
    else retained.push(entry)
  }
  return { retained, evicted }
}

function receipt (status, details = {}) {
  return {
    schemaVersion: WORKSPACE_SESSION_ROUTE_RECEIPT_SCHEMA,
    status,
    authority: false,
    hintOnly: true,
    ...details
  }
}

function createWorkspaceSessionRouteIndex (options = {}) {
  const fsImpl = options.fs || fs
  const pathImpl = options.path || path
  const now = options.now || (() => Date.now())
  const paths = routeIndexPaths(options.metaDir, pathImpl)
  const slotMaxBytes = options.testMode === true && Number.isInteger(options.slotMaxBytes)
    ? Math.max(4096, Math.min(options.slotMaxBytes, ROUTE_INDEX_SLOT_MAX_BYTES))
    : ROUTE_INDEX_SLOT_MAX_BYTES
  const evictionThresholdBytes = Math.floor(slotMaxBytes * 0.75)

  function read (input = {}) {
    let sessionDigest
    try { sessionDigest = resolveSessionDigest(input) } catch (error) {
      return receipt('invalid', { errorCode: error.code || 'WORKSPACE_SESSION_ROUTE_SESSION_INVALID', message: error.message })
    }
    const observed = readIndexFromPaths(paths, fsImpl)
    if (observed.status !== 'fresh') {
      return receipt(observed.status, { sessionDigest, errorCode: observed.errorCode || null, slots: observed.slots })
    }
    const entry = observed.index.entries.find(candidate => candidate.sessionDigest === sessionDigest)
    if (!entry) return receipt('missing', { sessionDigest, sequence: observed.index.sequence })
    if (Number(entry.expiresAtMs) <= now()) {
      return receipt('expired', { sessionDigest, sequence: observed.index.sequence, entry })
    }
    return receipt(entry.state === 'live' ? 'fresh' : 'unbound', {
      sessionDigest,
      sequence: observed.index.sequence,
      entry
    })
  }

  function withOrderedWriteLease (input, operation) {
    let sessionDigest
    try { sessionDigest = resolveSessionDigest(input) } catch (error) {
      return receipt('invalid', { errorCode: error.code || 'WORKSPACE_SESSION_ROUTE_SESSION_INVALID', message: error.message })
    }
    const stripeInfo = stripeLockPath(paths, sessionDigest, pathImpl)
    let stripeLock
    let globalLock
    try {
      stripeLock = acquireLock(stripeInfo.file, `session-stripe:${stripeInfo.stripe}`, { ...options, fs: fsImpl, now })
      if (!stripeLock) {
        return receipt('blocked', {
          sessionDigest,
          errorCode: 'WORKSPACE_SESSION_ROUTE_STRIPE_LOCK_TIMEOUT',
          lockOrder: [`session-stripe:${stripeInfo.stripe}`, 'global-route']
        })
      }
      globalLock = acquireLock(paths.globalLock, 'global-route', { ...options, fs: fsImpl, now })
      if (!globalLock) {
        return receipt('blocked', {
          sessionDigest,
          errorCode: 'WORKSPACE_SESSION_ROUTE_GLOBAL_LOCK_TIMEOUT',
          lockOrder: [`session-stripe:${stripeInfo.stripe}`, 'global-route']
        })
      }
      return operation({
        sessionDigest,
        stripe: stripeInfo.stripe,
        lockOrder: [`session-stripe:${stripeInfo.stripe}`, 'global-route'],
        readCurrent: () => readIndexFromPaths(paths, fsImpl)
      })
    } finally {
      releaseLock(globalLock, fsImpl)
      releaseLock(stripeLock, fsImpl)
    }
  }

  function update (input = {}) {
    return withOrderedWriteLease(input, lease => {
      const observed = lease.readCurrent()
      if (observed.status === 'invalid') {
        return receipt('blocked', {
          sessionDigest: lease.sessionDigest,
          errorCode: observed.errorCode,
          lockOrder: lease.lockOrder
        })
      }
      const current = observed.status === 'fresh'
        ? observed.index
        : { sequence: 0, entries: [] }
      const existing = current.entries.find(entry => entry.sessionDigest === lease.sessionDigest) || null
      let nextEntry
      try { nextEntry = sealEntry(entryCore({ ...input, sessionDigest: lease.sessionDigest }, now(), existing)) } catch (error) {
        return receipt('invalid', {
          sessionDigest: lease.sessionDigest,
          errorCode: error.code || 'WORKSPACE_SESSION_ROUTE_ENTRY_INVALID',
          message: error.message,
          lockOrder: lease.lockOrder
        })
      }
      if (input.trigger === 'same-session-shrink' && !existing) {
        return receipt('missing', {
          sessionDigest: lease.sessionDigest,
          errorCode: 'WORKSPACE_SESSION_ROUTE_SHRINK_TARGET_MISSING',
          lockOrder: lease.lockOrder
        })
      }
      if (input.trigger === 'same-session-shrink' && jsonBytes(nextEntry) > jsonBytes(existing)) {
        return receipt('blocked', {
          sessionDigest: lease.sessionDigest,
          errorCode: 'WORKSPACE_SESSION_ROUTE_SHRINK_WOULD_GROW',
          lockOrder: lease.lockOrder
        })
      }
      const existingSemantic = existing
        ? stableStringify(Object.fromEntries(Object.entries(existing).filter(([key]) => !['entryDigest', 'expiresAtMs'].includes(key))))
        : ''
      const nextSemantic = stableStringify(Object.fromEntries(Object.entries(nextEntry).filter(([key]) => !['entryDigest', 'expiresAtMs'].includes(key))))
      const exactSemanticMatch = existing && existingSemantic === nextSemantic
      const refreshNeeded = !existing || Number(existing.expiresAtMs) - now() < Math.floor(ROUTE_INDEX_TTL_MS / 2)
      if (exactSemanticMatch && !refreshNeeded) {
        return receipt('semantic-noop', {
          sessionDigest: lease.sessionDigest,
          sequence: current.sequence,
          entry: existing,
          lockOrder: lease.lockOrder
        })
      }
      let entries = current.entries.filter(entry => entry.sessionDigest !== lease.sessionDigest)
      entries.push(nextEntry)
      let candidate = sealIndex(current.sequence + 1, entries, now())
      let evicted = []
      if (jsonBytes(candidate) >= evictionThresholdBytes) {
        const pruned = pruneReclaimableEntries(entries, now(), lease.sessionDigest)
        entries = pruned.retained
        evicted = pruned.evicted
        candidate = sealIndex(current.sequence + 1, entries, now())
      }
      const candidateBytes = jsonBytes(candidate)
      if (candidateBytes > slotMaxBytes) {
        const closeout = input.trigger === 'terminal-unbind' || input.trigger === 'same-session-shrink'
        if (input.trigger === 'terminal-unbind' && existing) {
          const unboundIndex = sealIndex(
            current.sequence + 1,
            current.entries.filter(entry => entry.sessionDigest !== lease.sessionDigest),
            now()
          )
          const unboundWrite = writeIndexSlot(paths, unboundIndex, fsImpl, slotMaxBytes)
          const { status: unboundWriteStatus, ...unboundWriteDetails } = unboundWrite
          return receipt(unboundWriteStatus === 'persisted' ? 'persisted' : 'closeout-continued', {
            sessionDigest: lease.sessionDigest,
            sequence: unboundIndex.sequence,
            entry: null,
            entryCount: unboundIndex.entries.length,
            evicted: [...evicted, lease.sessionDigest],
            terminalReceiptRetained: false,
            liveBindingRemoved: unboundWriteStatus === 'persisted',
            errorCode: unboundWriteStatus === 'persisted'
              ? null
              : (unboundWriteDetails.errorCode || 'WORKSPACE_SESSION_ROUTE_TERMINAL_UNBIND_WRITE_FAILED'),
            mutationAllowed: false,
            admissionAllowed: false,
            closeoutAllowed: true,
            lockOrder: lease.lockOrder,
            ...unboundWriteDetails
          })
        }
        return receipt(closeout ? 'closeout-continued' : 'blocked', {
          sessionDigest: lease.sessionDigest,
          errorCode: 'WORKSPACE_SESSION_ROUTE_INDEX_CAPACITY_EXCEEDED',
          bytes: candidateBytes,
          maximumBytes: slotMaxBytes,
          mutationAllowed: false,
          admissionAllowed: false,
          closeoutAllowed: closeout,
          lockOrder: lease.lockOrder,
          evicted
        })
      }
      const written = writeIndexSlot(paths, candidate, fsImpl, slotMaxBytes)
      return receipt(written.status, {
        sessionDigest: lease.sessionDigest,
        sequence: candidate.sequence,
        entry: nextEntry,
        entryCount: entries.length,
        evicted,
        lockOrder: lease.lockOrder,
        ...written
      })
    })
  }

  return Object.freeze({
    paths,
    read,
    update,
    withOrderedWriteLease
  })
}

module.exports = {
  ROUTE_INDEX_ENTRY_MAX_BYTES,
  ROUTE_INDEX_EVICTION_THRESHOLD_BYTES,
  ROUTE_INDEX_SLOT_MAX_BYTES,
  ROUTE_INDEX_STRIPE_COUNT,
  ROUTE_INDEX_TTL_MS,
  ROUTE_WRITE_TRIGGERS,
  WORKSPACE_SESSION_ROUTE_ENTRY_SCHEMA,
  WORKSPACE_SESSION_ROUTE_INDEX_SCHEMA,
  WORKSPACE_SESSION_ROUTE_RECEIPT_SCHEMA,
  WorkspaceSessionRouteIndexError,
  createWorkspaceSessionRouteIndex,
  digestSessionRef,
  routeIndexPaths,
  stripeNumberForDigest
}
