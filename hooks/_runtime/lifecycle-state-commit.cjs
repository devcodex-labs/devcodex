'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { stableStringify } = require('./content-identity.cjs')
const { createDerivedStateStore } = require('./derived-state-store.cjs')

const LIFECYCLE_STATE_COMMIT_SCHEMA = 'LifecycleStateCommitV3'
const LIFECYCLE_STATE_POINTER_SCHEMA = 'LifecycleStatePointerV3'
const MAX_COMMITTED_GENERATIONS = 64

function digestValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function atomicWriteJson(file, value, { fs: fsImpl = fs, token = crypto.randomUUID() } = {}) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  const tempFile = `${file}.tmp-${process.pid}-${token}`
  fsImpl.mkdirSync(path.dirname(file), { recursive: true })
  let descriptor
  try {
    descriptor = fsImpl.openSync(tempFile, 'wx')
    fsImpl.writeFileSync(descriptor, serialized, 'utf8')
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor)
  }
  try {
    fsImpl.renameSync(tempFile, file)
  } catch (error) {
    try { fsImpl.unlinkSync(tempFile) } catch { }
    throw error
  }
  const readback = fsImpl.readFileSync(file, 'utf8')
  if (readback !== serialized) {
    throw Object.assign(new Error(`lifecycle state readback mismatch: ${file}`), {
      code: 'LIFECYCLE_STATE_READBACK_MISMATCH'
    })
  }
  return { file, bytes: Buffer.byteLength(serialized), digest: digestValue(value) }
}

function writeGeneration(target, transaction, state, options = {}) {
  const fsImpl = options.fs || fs
  const role = String(target.role || 'active').replace(/[^a-z0-9_.-]+/gi, '-')
  const generationDir = path.join(path.resolve(target.dir), 'generations')
  const file = path.join(generationDir, `${transaction.transactionId}-${role}.json`)
  const generation = {
    schemaVersion: LIFECYCLE_STATE_COMMIT_SCHEMA,
    transactionId: transaction.transactionId,
    committedAt: transaction.committedAt,
    role,
    identity: transaction.identity,
    stateDigest: transaction.stateDigest,
    state
  }
  const serialized = `${JSON.stringify(generation, null, 2)}\n`
  fsImpl.mkdirSync(generationDir, { recursive: true })
  const descriptor = fsImpl.openSync(file, 'wx')
  try {
    fsImpl.writeFileSync(descriptor, serialized, 'utf8')
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
  } finally {
    fsImpl.closeSync(descriptor)
  }
  const observed = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  if (digestValue(observed) !== digestValue(generation)) {
    throw Object.assign(new Error(`lifecycle generation readback mismatch: ${file}`), {
      code: 'LIFECYCLE_GENERATION_READBACK_MISMATCH'
    })
  }
  return {
    role,
    file: path.resolve(file),
    generationDigest: digestValue(generation),
    stateDigest: transaction.stateDigest
  }
}

function validateGeneration(entry, transaction, fsImpl = fs) {
  try {
    const generation = JSON.parse(fsImpl.readFileSync(entry.file, 'utf8'))
    if (!generation || generation.schemaVersion !== LIFECYCLE_STATE_COMMIT_SCHEMA ||
        generation.transactionId !== transaction.transactionId ||
        generation.stateDigest !== transaction.stateDigest ||
        digestValue(generation) !== entry.generationDigest ||
        digestValue(generation.state) !== transaction.stateDigest) return null
    return generation
  } catch {
    return null
  }
}

function normalizeIdentity(identity = {}) {
  return {
    project: String(identity.project || ''),
    scope: String(identity.scope || ''),
    sessionKey: String(identity.sessionKey || '')
  }
}

function commitLifecycleState({ metaDir, state, identity = {}, targets = [] }, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw Object.assign(new Error('lifecycle state must be a JSON object'), { code: 'LIFECYCLE_STATE_INVALID' })
  }
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const transactionId = String(options.transactionId || crypto.randomUUID())
  const transaction = {
    transactionId,
    committedAt: new Date(nowMs).toISOString(),
    identity: normalizeIdentity(identity),
    stateDigest: digestValue(state)
  }
  const uniqueTargets = []
  const seen = new Set()
  for (const target of targets) {
    const key = `${path.resolve(target.dir)}\0${String(target.role || 'active')}`
    if (seen.has(key)) continue
    seen.add(key)
    uniqueTargets.push(target)
  }
  if (!uniqueTargets.length) uniqueTargets.push({ role: 'meta', dir: metaDir })
  const entries = uniqueTargets.map(target => writeGeneration(target, transaction, state, { fs: fsImpl }))
  const pointerStore = createDerivedStateStore({
    root: metaDir,
    relativePath: 'current.json',
    maxBytes: 16 * 1024 * 1024,
    maxWrites: 1,
    fs: fsImpl,
    now: options.now || (() => Date.now()),
    hostname: options.hostname,
    pid: options.pid,
    processKill: options.processKill,
    randomUUID: options.randomUUID
  })
  const pointerWrite = pointerStore.update(current => {
    const previous = current?.schemaVersion === LIFECYCLE_STATE_POINTER_SCHEMA && Array.isArray(current.transactions)
      ? current.transactions.filter(item => item && typeof item === 'object')
      : []
    const committed = {
      ...transaction,
      entries
    }
    return {
      schemaVersion: LIFECYCLE_STATE_POINTER_SCHEMA,
      currentTransactionId: transactionId,
      transactions: [...previous.filter(item => item.transactionId !== transactionId), committed]
        .slice(-MAX_COMMITTED_GENERATIONS),
      updatedAt: transaction.committedAt
    }
  })
  if (pointerWrite.status !== 'persisted') {
    return {
      status: 'error',
      errorCode: pointerWrite.errorCode || 'LIFECYCLE_POINTER_COMMIT_FAILED',
      transactionId,
      entries,
      pointerPath: pointerStore.filePath
    }
  }
  return {
    status: 'committed',
    schemaVersion: LIFECYCLE_STATE_COMMIT_SCHEMA,
    transactionId,
    stateDigest: transaction.stateDigest,
    entries,
    pointerPath: pointerStore.filePath,
    pointerWrite
  }
}

function readLifecycleStateCommit({ metaDir, sessionKey = '' }, options = {}) {
  const fsImpl = options.fs || fs
  const pointerStore = createDerivedStateStore({
    root: metaDir,
    relativePath: 'current.json',
    maxBytes: 16 * 1024 * 1024,
    maxWrites: 0,
    fs: fsImpl
  })
  const read = pointerStore.read()
  if (read.status !== 'fresh') return { ...read, pointerPath: pointerStore.filePath }
  const pointer = read.value
  if (pointer?.schemaVersion !== LIFECYCLE_STATE_POINTER_SCHEMA || !Array.isArray(pointer.transactions)) {
    return {
      status: 'invalid',
      errorCode: 'LIFECYCLE_POINTER_INVALID',
      pointerPath: pointerStore.filePath
    }
  }
  const requestedSession = String(sessionKey || '')
  const candidates = [...pointer.transactions].reverse().filter(transaction => (
    !requestedSession || String(transaction?.identity?.sessionKey || '') === requestedSession
  ))
  for (const transaction of candidates) {
    if (!Array.isArray(transaction.entries) || !transaction.entries.length ||
        typeof transaction.stateDigest !== 'string') continue
    const generations = transaction.entries.map(entry => validateGeneration(entry, transaction, fsImpl))
    if (generations.some(value => !value)) continue
    return {
      status: 'fresh',
      state: generations[0].state,
      identity: transaction.identity,
      transactionId: transaction.transactionId,
      stateDigest: transaction.stateDigest,
      pointerPath: pointerStore.filePath,
      entries: transaction.entries
    }
  }
  return {
    status: 'stale',
    errorCode: requestedSession ? 'LIFECYCLE_SESSION_COMMIT_NOT_FOUND' : 'LIFECYCLE_COMMIT_INVALID',
    pointerPath: pointerStore.filePath
  }
}

function updateLifecycleStateCommit(input, updater, options = {}) {
  if (typeof updater !== 'function') {
    throw Object.assign(new Error('lifecycle state updater must be a function'), { code: 'LIFECYCLE_UPDATER_INVALID' })
  }
  const fsImpl = options.fs || fs
  const pointerStore = createDerivedStateStore({
    root: input.metaDir,
    relativePath: 'current.json',
    maxBytes: 16 * 1024 * 1024,
    maxWrites: 1,
    fs: fsImpl,
    now: options.now || (() => Date.now()),
    hostname: options.hostname,
    pid: options.pid,
    processKill: options.processKill,
    randomUUID: options.randomUUID
  })
  const requestedSession = String(input.identity?.sessionKey || '')
  let committed = null
  let previousStatus = 'missing'
  const pointerWrite = pointerStore.update(current => {
    const previous = current?.schemaVersion === LIFECYCLE_STATE_POINTER_SCHEMA && Array.isArray(current.transactions)
      ? current.transactions.filter(item => item && typeof item === 'object')
      : []
    let priorState = null
    for (const transaction of [...previous].reverse()) {
      if (requestedSession && String(transaction?.identity?.sessionKey || '') !== requestedSession) continue
      const generations = Array.isArray(transaction.entries)
        ? transaction.entries.map(entry => validateGeneration(entry, transaction, fsImpl))
        : []
      if (generations.length && generations.every(Boolean)) {
        priorState = generations[0].state
        previousStatus = 'fresh'
        break
      }
    }
    if (!priorState && typeof input.readFallback === 'function') {
      priorState = input.readFallback()
      previousStatus = priorState ? 'legacy-fallback' : previousStatus
    }
    const base = priorState && typeof priorState === 'object' && !Array.isArray(priorState) ? priorState : {}
    const state = updater(JSON.parse(JSON.stringify(base)))
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw Object.assign(new Error('lifecycle state updater returned an invalid value'), {
        code: 'LIFECYCLE_STATE_INVALID'
      })
    }
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
    const transaction = {
      transactionId: String(options.transactionId || crypto.randomUUID()),
      committedAt: new Date(nowMs).toISOString(),
      identity: normalizeIdentity(input.identity),
      stateDigest: digestValue(state)
    }
    const seen = new Set()
    const targets = (input.targets || []).filter(target => {
      const key = `${path.resolve(target.dir)}\0${String(target.role || 'active')}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (!targets.length) targets.push({ role: 'meta', dir: input.metaDir })
    const entries = targets.map(target => writeGeneration(target, transaction, state, { fs: fsImpl }))
    committed = { ...transaction, entries, state }
    return {
      schemaVersion: LIFECYCLE_STATE_POINTER_SCHEMA,
      currentTransactionId: transaction.transactionId,
      transactions: [...previous.filter(item => item.transactionId !== transaction.transactionId), {
        transactionId: transaction.transactionId,
        committedAt: transaction.committedAt,
        identity: transaction.identity,
        stateDigest: transaction.stateDigest,
        entries
      }].slice(-MAX_COMMITTED_GENERATIONS),
      updatedAt: transaction.committedAt
    }
  })
  if (pointerWrite.status !== 'persisted' || !committed) {
    return {
      status: 'error',
      errorCode: pointerWrite.errorCode || 'LIFECYCLE_POINTER_COMMIT_FAILED',
      pointerPath: pointerStore.filePath,
      previousStatus
    }
  }
  return {
    status: 'committed',
    schemaVersion: LIFECYCLE_STATE_COMMIT_SCHEMA,
    transactionId: committed.transactionId,
    stateDigest: committed.stateDigest,
    entries: committed.entries,
    state: committed.state,
    pointerPath: pointerStore.filePath,
    pointerWrite,
    previousStatus
  }
}

module.exports = {
  LIFECYCLE_STATE_COMMIT_SCHEMA,
  LIFECYCLE_STATE_POINTER_SCHEMA,
  MAX_COMMITTED_GENERATIONS,
  atomicWriteJson,
  commitLifecycleState,
  digestValue,
  readLifecycleStateCommit,
  updateLifecycleStateCommit
}
