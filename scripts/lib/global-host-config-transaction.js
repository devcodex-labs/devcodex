'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  isUnder,
  samePath,
  unsafePathComponent
} = require('./global-host-target.js')

const GLOBAL_HOST_TRANSACTION_SCHEMA = 'GlobalHostConfigTransactionV1'
const GLOBAL_HOST_JOURNAL_SCHEMA = 'GlobalHostConfigJournalV1'
const GLOBAL_HOST_JOURNAL_INDEX_SCHEMA = 'GlobalHostConfigJournalIndexV1'
const GLOBAL_HOST_JOURNAL_LOCK_SCHEMA = 'GlobalHostConfigJournalLockV1'

function jsonObject(file, fsImpl = fs) {
  try {
    const value = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function durableJsonWrite(file, value, fsImpl = fs) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  const temp = `${file}.next.tmp`
  fsImpl.mkdirSync(path.dirname(file), { recursive: true })
  let descriptor
  try {
    if (fsImpl.existsSync(temp)) fsImpl.unlinkSync(temp)
    descriptor = fsImpl.openSync(temp, 'wx')
    fsImpl.writeFileSync(descriptor, serialized, 'utf8')
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
    fsImpl.closeSync(descriptor)
    descriptor = undefined
    fsImpl.renameSync(temp, file)
  } catch (error) {
    if (descriptor !== undefined) try { fsImpl.closeSync(descriptor) } catch { }
    try { fsImpl.unlinkSync(temp) } catch { }
    throw error
  }
  if (fsImpl.readFileSync(file, 'utf8') !== serialized) {
    const error = new Error(`GLOBAL_HOST_JOURNAL_READBACK_MISMATCH: ${file}`)
    error.code = 'GLOBAL_HOST_JOURNAL_READBACK_MISMATCH'
    throw error
  }
}

function resolveTransactionRoot(options, allowedRoots, safetyRoots, fsImpl) {
  if (!options.transactionRoot) {
    const error = new Error('GLOBAL_HOST_TRANSACTION_ROOT_REQUIRED')
    error.code = 'GLOBAL_HOST_TRANSACTION_ROOT_REQUIRED'
    throw error
  }
  const root = path.resolve(options.transactionRoot)
  const boundary = allowedRoots.find(candidate => isUnder(candidate, root) || samePath(candidate, root))
  if (!boundary) {
    const error = new Error(`GLOBAL_HOST_TRANSACTION_ROOT_OUTSIDE_OWNER: ${root}`)
    error.code = 'GLOBAL_HOST_TRANSACTION_ROOT_OUTSIDE_OWNER'
    throw error
  }
  const safetyBoundary = safetyRoots.find(candidate => isUnder(candidate, root) || samePath(candidate, root))
  if (!safetyBoundary || unsafePathComponent(safetyBoundary, root, fsImpl)) {
    const error = new Error(`GLOBAL_HOST_TRANSACTION_ROOT_UNSAFE: ${root}`)
    error.code = 'GLOBAL_HOST_TRANSACTION_ROOT_UNSAFE'
    throw error
  }
  return root
}

function acquireJournalLock(transactionRoot, options = {}) {
  const fsImpl = options.fs || fs
  const hostname = options.hostname || os.hostname()
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid
  const ownerToken = String(options.ownerToken || crypto.randomUUID())
  const lockFile = path.join(transactionRoot, 'owner.lock')
  const leaseMs = 30 * 1000
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  fsImpl.mkdirSync(transactionRoot, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fsImpl.openSync(lockFile, 'wx')
      const record = {
        schemaVersion: GLOBAL_HOST_JOURNAL_LOCK_SCHEMA,
        ownerToken,
        hostname,
        pid,
        acquiredAt: new Date(nowMs).toISOString(),
        leaseExpiresAtMs: nowMs + leaseMs
      }
      try {
        fsImpl.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
        if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
      } catch (error) {
        try { fsImpl.closeSync(descriptor) } catch { }
        try { fsImpl.unlinkSync(lockFile) } catch { }
        throw error
      }
      return { descriptor, file: lockFile, ownerToken }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const observed = jsonObject(lockFile, fsImpl)
      let dead = false
      if (observed?.schemaVersion === GLOBAL_HOST_JOURNAL_LOCK_SCHEMA &&
          observed.hostname === hostname && Number.isInteger(observed.pid) && observed.pid > 0) {
        try {
          const processKill = options.processKill || process.kill.bind(process)
          processKill(observed.pid, 0)
        } catch (livenessError) {
          dead = livenessError?.code === 'ESRCH'
        }
      }
      if (!dead || attempt > 0) {
        const locked = new Error(`GLOBAL_HOST_TRANSACTION_LOCKED: ${lockFile}`)
        locked.code = 'GLOBAL_HOST_TRANSACTION_LOCKED'
        throw locked
      }
      const quarantine = `${lockFile}.quarantine`
      if (fsImpl.existsSync(quarantine)) fsImpl.unlinkSync(quarantine)
      fsImpl.renameSync(lockFile, quarantine)
    }
  }
  const error = new Error(`GLOBAL_HOST_TRANSACTION_LOCKED: ${lockFile}`)
  error.code = 'GLOBAL_HOST_TRANSACTION_LOCKED'
  throw error
}

function releaseJournalLock(lock, fsImpl = fs) {
  try { fsImpl.closeSync(lock.descriptor) } catch { }
  const observed = jsonObject(lock.file, fsImpl)
  if (!observed || observed.ownerToken !== lock.ownerToken) return false
  try {
    fsImpl.unlinkSync(lock.file)
    if (typeof fsImpl.rmdirSync === 'function') {
      try { fsImpl.rmdirSync(path.join(path.dirname(lock.file), 'journals')) } catch { }
      try { fsImpl.rmdirSync(path.dirname(lock.file)) } catch { }
    }
    return true
  } catch {
    return false
  }
}

function fileState(file, fsImpl = fs) {
  if (!fsImpl.existsSync(file)) return { state: 'absent' }
  const stat = fsImpl.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) return { state: 'invalid' }
  return {
    state: 'present',
    digest: operationDigest(fsImpl.readFileSync(file)),
    mode: stat.mode,
    uid: stat.uid,
    gid: stat.gid,
    bytes: stat.size
  }
}

function stateMatches(actual, expected) {
  if (expected?.state === 'absent') return actual?.state === 'absent'
  return actual?.state === 'present' && actual.digest === expected?.digest
}

function updateJournal(journalFile, journal, fsImpl, phase) {
  journal.phase = phase
  journal.updatedAt = new Date().toISOString()
  durableJsonWrite(journalFile, journal, fsImpl)
}

function journalIndexFile(transactionRoot) {
  return path.join(transactionRoot, 'index.json')
}

function addJournalToIndex(transactionRoot, journalFile, transactionId, fsImpl) {
  const indexFile = journalIndexFile(transactionRoot)
  const current = jsonObject(indexFile, fsImpl)
  const entries = current?.schemaVersion === GLOBAL_HOST_JOURNAL_INDEX_SCHEMA && Array.isArray(current.entries)
    ? current.entries.filter(item => item && typeof item === 'object')
    : []
  const next = {
    schemaVersion: GLOBAL_HOST_JOURNAL_INDEX_SCHEMA,
    entries: [
      ...entries.filter(item => item.transactionId !== transactionId),
      { transactionId, journalFile: path.resolve(journalFile) }
    ],
    updatedAt: new Date().toISOString()
  }
  durableJsonWrite(indexFile, next, fsImpl)
}

function removeJournalFromIndex(transactionRoot, transactionId, fsImpl) {
  const indexFile = journalIndexFile(transactionRoot)
  const current = jsonObject(indexFile, fsImpl)
  if (current?.schemaVersion !== GLOBAL_HOST_JOURNAL_INDEX_SCHEMA || !Array.isArray(current.entries)) return
  const next = {
    ...current,
    entries: current.entries.filter(item => item?.transactionId !== transactionId),
    updatedAt: new Date().toISOString()
  }
  durableJsonWrite(indexFile, next, fsImpl)
  if (!next.entries.length) {
    try { fsImpl.unlinkSync(indexFile) } catch { }
  }
}

function cleanupCommittedJournal(transactionRoot, journalFile, transactionId, fsImpl) {
  removeJournalFromIndex(transactionRoot, transactionId, fsImpl)
  try { fsImpl.unlinkSync(journalFile) } catch { }
}

function operationDigest(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
  return crypto.createHash('sha256').update(content).digest('hex')
}

function assertExpectedCurrent(operation, fsImpl) {
  if (operation.expectAbsent === true) {
    if (!fsImpl.existsSync(operation.path)) return
    const error = new Error(`GLOBAL_HOST_OPERATION_PRECONDITION_FAILED: ${operation.path}`)
    error.code = 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED'
    throw error
  }
  if (operation.expectedDigest == null) return
  if (!/^[a-f0-9]{64}$/i.test(operation.expectedDigest) || !fsImpl.existsSync(operation.path)) {
    const error = new Error(`GLOBAL_HOST_OPERATION_PRECONDITION_FAILED: ${operation.path}`)
    error.code = 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED'
    throw error
  }
  const actual = operationDigest(fsImpl.readFileSync(operation.path))
  if (actual !== operation.expectedDigest) {
    const error = new Error(`GLOBAL_HOST_OPERATION_PRECONDITION_FAILED: ${operation.path}`)
    error.code = 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED'
    throw error
  }
}

function acceptedByBoundary(destination, scopedRoots, scopedFiles, fsImpl, options = {}) {
  for (const root of scopedRoots) {
    if (isUnder(root, destination)) return true
  }
  if (scopedFiles.some(file => samePath(file, destination))) return true
  const sidecarOf = options.sidecarOf ? path.resolve(options.sidecarOf) : null
  if (!sidecarOf) return false
  if (!scopedFiles.some(file => samePath(file, sidecarOf))) return false
  if (!samePath(path.dirname(sidecarOf), path.dirname(destination))) return false
  return path.basename(destination).startsWith(`${path.basename(sidecarOf)}.devcodex-`)
}

function validatePathBoundary(destination, scopedRoots, scopedFiles, fsImpl, options = {}) {
  if (!acceptedByBoundary(destination, scopedRoots, scopedFiles, fsImpl, options)) {
    const error = new Error(`GLOBAL_HOST_OPERATION_OUTSIDE_ROOT: ${destination}`)
    error.code = 'GLOBAL_HOST_OPERATION_OUTSIDE_ROOT'
    throw error
  }
}

function assertOperationPathSafe(operation, fsImpl) {
  validatePathBoundary(operation.path, operation.allowedRoots, operation.allowedFiles, fsImpl)
  const matchingSafetyRoots = (operation.safetyRoots || operation.allowedRoots)
    .filter(root => isUnder(root, operation.path))
  if (!matchingSafetyRoots.length) {
    const error = new Error(`GLOBAL_HOST_OPERATION_SAFETY_ROOT_REQUIRED: ${operation.path}`)
    error.code = 'GLOBAL_HOST_OPERATION_SAFETY_ROOT_REQUIRED'
    throw error
  }
  for (const root of matchingSafetyRoots) {
    const unsafe = unsafePathComponent(root, operation.path, fsImpl)
    if (!unsafe) continue
    const rootUnsafe = samePath(unsafe.path, root)
    const error = new Error(`${rootUnsafe ? 'GLOBAL_HOST_OPERATION_ROOT_UNSAFE' : 'GLOBAL_HOST_OPERATION_REPARSE'}: ${unsafe.path}`)
    error.code = rootUnsafe ? 'GLOBAL_HOST_OPERATION_ROOT_UNSAFE' : 'GLOBAL_HOST_OPERATION_REPARSE'
    throw error
  }
  if (!fsImpl.existsSync(operation.path)) return
  const stat = fsImpl.lstatSync(operation.path)
  if (stat.isSymbolicLink()) {
    const error = new Error(`GLOBAL_HOST_OPERATION_SYMLINK: ${operation.path}`)
    error.code = 'GLOBAL_HOST_OPERATION_SYMLINK'
    throw error
  }
  if (operation.action === 'remove' && !stat.isFile()) {
    const error = new Error(`GLOBAL_HOST_REMOVE_NOT_FILE: ${operation.path}`)
    error.code = 'GLOBAL_HOST_REMOVE_NOT_FILE'
    throw error
  }
}

function assertSidecarAbsent(sidecar, fsImpl) {
  if (!fsImpl.existsSync(sidecar)) return
  const error = new Error(`GLOBAL_HOST_OPERATION_SIDECAR_EXISTS: ${sidecar}`)
  error.code = 'GLOBAL_HOST_OPERATION_SIDECAR_EXISTS'
  throw error
}

function validateOperation(operation, allowedRoots, allowedFiles = [], allowedByHost = {}, fsImpl = fs, safetyRoots = allowedRoots) {
  const action = operation?.action || 'write'
  const validContent = typeof operation?.content === 'string' || Buffer.isBuffer(operation?.content)
  if (!operation || !operation.path || !['write', 'remove'].includes(action) || (action === 'write' && !validContent)) {
    const error = new Error('GLOBAL_HOST_OPERATION_INVALID')
    error.code = 'GLOBAL_HOST_OPERATION_INVALID'
    throw error
  }
  if (action === 'write' && Buffer.isBuffer(operation.content) && operation.kind !== 'binary') {
    const error = new Error('GLOBAL_HOST_BINARY_KIND_REQUIRED')
    error.code = 'GLOBAL_HOST_BINARY_KIND_REQUIRED'
    throw error
  }
  const expectedDigestValid = operation.expectedDigest == null || /^[a-f0-9]{64}$/i.test(operation.expectedDigest)
  if (!expectedDigestValid || (operation.expectAbsent != null && typeof operation.expectAbsent !== 'boolean') ||
      (operation.expectAbsent === true && operation.expectedDigest != null)) {
    const error = new Error('GLOBAL_HOST_OPERATION_INVALID')
    error.code = 'GLOBAL_HOST_OPERATION_INVALID'
    throw error
  }
  const destination = path.resolve(operation.path)
  const hostBoundary = operation.host ? allowedByHost[operation.host] : null
  const scopedRoots = hostBoundary
    ? (hostBoundary.allowedRoots || []).map(root => path.resolve(root))
    : allowedRoots
  const scopedFiles = hostBoundary
    ? (hostBoundary.allowedFiles || []).map(file => path.resolve(file))
    : allowedFiles
  const scopedSafetyRoots = hostBoundary
    ? (hostBoundary.safetyRoots || hostBoundary.allowedRoots || []).map(root => path.resolve(root))
    : safetyRoots
  if (operation.host && Object.keys(allowedByHost).length && !hostBoundary) {
    const error = new Error(`GLOBAL_HOST_OPERATION_HOST_UNKNOWN: ${operation.host}`)
    error.code = 'GLOBAL_HOST_OPERATION_HOST_UNKNOWN'
    throw error
  }
  if (action === 'write' && operation.kind === 'json') JSON.parse(operation.content)
  const validated = {
    ...operation,
    action,
    path: destination,
    allowedRoots: scopedRoots,
    allowedFiles: scopedFiles,
    safetyRoots: scopedSafetyRoots
  }
  assertOperationPathSafe(validated, fsImpl)
  return validated
}

function uniqueOperations(operations) {
  const seen = new Set()
  return operations.map(operation => {
    const key = process.platform === 'win32'
      ? path.resolve(operation.path).toLowerCase()
      : path.resolve(operation.path)
    if (seen.has(key)) {
      const error = new Error(`GLOBAL_HOST_OPERATION_DUPLICATE: ${operation.path}`)
      error.code = 'GLOBAL_HOST_OPERATION_DUPLICATE'
      throw error
    }
    seen.add(key)
    return operation
  })
}

function recoverJournal(journal, journalFile, boundaries, fsImpl) {
  if (journal?.schemaVersion !== GLOBAL_HOST_JOURNAL_SCHEMA ||
      typeof journal.transactionId !== 'string' || !Array.isArray(journal.operations)) {
    const error = new Error(`GLOBAL_HOST_JOURNAL_INVALID: ${journalFile}`)
    error.code = 'GLOBAL_HOST_JOURNAL_INVALID'
    throw error
  }
  for (const operation of journal.operations) {
    if (!operation || !['write', 'remove'].includes(operation.action) || !operation.path ||
        !operation.preimageState || !operation.targetState) {
      const error = new Error(`GLOBAL_HOST_JOURNAL_INVALID: ${journalFile}`)
      error.code = 'GLOBAL_HOST_JOURNAL_INVALID'
      throw error
    }
    validatePathBoundary(operation.path, boundaries.allowedRoots, boundaries.allowedFiles, fsImpl)
    validatePathBoundary(operation.staged, boundaries.allowedRoots, boundaries.allowedFiles, fsImpl, {
      sidecarOf: operation.path
    })
    validatePathBoundary(operation.backup, boundaries.allowedRoots, boundaries.allowedFiles, fsImpl, {
      sidecarOf: operation.path
    })
  }

  const allAtTarget = journal.operations.every(operation => (
    stateMatches(fileState(operation.path, fsImpl), operation.targetState)
  ))
  if (allAtTarget) {
    updateJournal(journalFile, journal, fsImpl, 'recovered-committed')
    for (const operation of journal.operations) {
      for (const sidecar of [operation.staged, operation.backup]) {
        if (!fsImpl.existsSync(sidecar)) continue
        const sidecarState = fileState(sidecar, fsImpl)
        const expected = sidecar === operation.backup ? operation.preimageState : operation.targetState
        if (stateMatches(sidecarState, expected)) fsImpl.unlinkSync(sidecar)
      }
    }
    return 'recovered-committed'
  }

  for (const operation of journal.operations) {
    const actual = fileState(operation.path, fsImpl)
    if (stateMatches(actual, operation.preimageState)) continue
    const backup = fileState(operation.backup, fsImpl)
    const destinationRecoverable = stateMatches(actual, operation.targetState) || actual.state === 'absent'
    const canRestorePresent = operation.preimageState.state === 'present' &&
      stateMatches(backup, operation.preimageState) && destinationRecoverable
    const canRestoreAbsent = operation.preimageState.state === 'absent' && destinationRecoverable
    if (!canRestorePresent && !canRestoreAbsent) {
      const error = new Error(`GLOBAL_HOST_RECOVERY_DRIFT: ${operation.path}`)
      error.code = 'GLOBAL_HOST_RECOVERY_DRIFT'
      error.journalFile = journalFile
      throw error
    }
  }

  for (const operation of [...journal.operations].reverse()) {
    const actual = fileState(operation.path, fsImpl)
    if (!stateMatches(actual, operation.preimageState)) {
      if (actual.state !== 'absent') fsImpl.unlinkSync(operation.path)
      if (operation.preimageState.state === 'present') fsImpl.renameSync(operation.backup, operation.path)
    }
    if (fsImpl.existsSync(operation.staged)) {
      const staged = fileState(operation.staged, fsImpl)
      if (stateMatches(staged, operation.targetState)) fsImpl.unlinkSync(operation.staged)
    }
    if (fsImpl.existsSync(operation.backup) && stateMatches(fileState(operation.path, fsImpl), operation.preimageState)) {
      const backup = fileState(operation.backup, fsImpl)
      if (stateMatches(backup, operation.preimageState)) fsImpl.unlinkSync(operation.backup)
    }
  }
  updateJournal(journalFile, journal, fsImpl, 'recovered-rolled-back')
  return 'recovered-rolled-back'
}

function recoverIndexedTransactions(transactionRoot, boundaries, fsImpl) {
  const indexFile = journalIndexFile(transactionRoot)
  if (!fsImpl.existsSync(indexFile)) return []
  const index = jsonObject(indexFile, fsImpl)
  if (index?.schemaVersion !== GLOBAL_HOST_JOURNAL_INDEX_SCHEMA || !Array.isArray(index.entries)) {
    const error = new Error(`GLOBAL_HOST_JOURNAL_INDEX_INVALID: ${indexFile}`)
    error.code = 'GLOBAL_HOST_JOURNAL_INDEX_INVALID'
    throw error
  }
  const journalRoot = path.join(transactionRoot, 'journals')
  const recovered = []
  for (const entry of index.entries) {
    const journalFile = path.resolve(String(entry?.journalFile || ''))
    if (!entry?.transactionId || !isUnder(journalRoot, journalFile) ||
        path.basename(journalFile) !== `${entry.transactionId}.json`) {
      const error = new Error(`GLOBAL_HOST_JOURNAL_INDEX_INVALID: ${indexFile}`)
      error.code = 'GLOBAL_HOST_JOURNAL_INDEX_INVALID'
      throw error
    }
    const journal = jsonObject(journalFile, fsImpl)
    const status = recoverJournal(journal, journalFile, boundaries, fsImpl)
    recovered.push({ transactionId: entry.transactionId, status, journalFile })
    cleanupCommittedJournal(transactionRoot, journalFile, entry.transactionId, fsImpl)
  }
  return recovered
}

function executeGlobalHostTransaction(operations, options = {}) {
  const fsImpl = options.fs || fs
  const allowedRoots = (options.allowedRoots || []).map(root => path.resolve(root))
  const allowedFiles = (options.allowedFiles || []).map(file => path.resolve(file))
  const safetyRoots = (options.safetyRoots || options.allowedRoots || []).map(root => path.resolve(root))
  const allowedByHost = options.allowedByHost || {}
  if (!allowedRoots.length && !allowedFiles.length) {
    const error = new Error('GLOBAL_HOST_ALLOWED_ROOT_REQUIRED')
    error.code = 'GLOBAL_HOST_ALLOWED_ROOT_REQUIRED'
    throw error
  }
  const transactionRoot = resolveTransactionRoot(options, allowedRoots, safetyRoots, fsImpl)

  const validated = uniqueOperations((operations || [])
    .map(operation => validateOperation(
      operation,
      allowedRoots,
      allowedFiles,
      allowedByHost,
      fsImpl,
      safetyRoots
    )))
  const receipt = {
    schemaVersion: GLOBAL_HOST_TRANSACTION_SCHEMA,
    status: options.dryRun ? 'planned' : 'pending',
    dryRun: options.dryRun === true,
    startedAt: new Date().toISOString(),
    operations: validated.map(operation => ({
      host: operation.host || null,
      action: operation.action,
      kind: operation.kind || 'text',
      path: operation.path,
      expectedDigest: operation.expectedDigest || null,
      expectAbsent: operation.expectAbsent === true,
      changed: true
    }))
  }

  let journalLock = null
  let recoveredTransactions = []
  if (!receipt.dryRun) {
    journalLock = acquireJournalLock(transactionRoot, {
      fs: fsImpl,
      hostname: options.hostname,
      pid: options.pid,
      processKill: options.processKill,
      ownerToken: options.ownerToken,
      nowMs: options.nowMs
    })
    try {
      recoveredTransactions = recoverIndexedTransactions(transactionRoot, {
        allowedRoots,
        allowedFiles,
        safetyRoots
      }, fsImpl)
    } catch (error) {
      releaseJournalLock(journalLock, fsImpl)
      throw error
    }
  }
  receipt.recoveredTransactions = recoveredTransactions

  try {
    for (const item of receipt.operations) {
      const operation = validated.find(candidate => candidate.path === item.path)
      assertOperationPathSafe(operation, fsImpl)
      assertExpectedCurrent(operation, fsImpl)
      if (operation.action === 'remove') {
        item.changed = fsImpl.existsSync(item.path)
        continue
      }
      const binary = operation.kind === 'binary'
      const current = fsImpl.existsSync(item.path)
        ? fsImpl.readFileSync(item.path, binary ? null : 'utf8')
        : null
      const desired = operation.content
      item.changed = binary
        ? !(Buffer.isBuffer(current) && current.equals(desired))
        : current !== desired
    }
  } catch (error) {
    if (journalLock) releaseJournalLock(journalLock, fsImpl)
    throw error
  }
  receipt.changed = receipt.operations.filter(item => item.changed).length

  if (receipt.dryRun) {
    receipt.completedAt = new Date().toISOString()
    return receipt
  }

  if (!receipt.changed) {
    receipt.status = 'committed'
    receipt.completedAt = new Date().toISOString()
    releaseJournalLock(journalLock, fsImpl)
    return receipt
  }

  const transactionId = String(options.transactionId || crypto.randomUUID())
  const journalFile = path.join(transactionRoot, 'journals', `${transactionId}.json`)
  const changedOperations = validated.filter(operation => {
    const item = receipt.operations.find(candidate => candidate.path === operation.path)
    return item?.changed === true
  })
  const journal = {
    schemaVersion: GLOBAL_HOST_JOURNAL_SCHEMA,
    transactionId,
    phase: 'preparing',
    startedAt: receipt.startedAt,
    owner: {
      ownerToken: journalLock.ownerToken,
      hostname: options.hostname || os.hostname(),
      pid: Number.isInteger(options.pid) ? options.pid : process.pid
    },
    operations: changedOperations.map((operation, index) => {
      const preimageState = fileState(operation.path, fsImpl)
      const targetState = operation.action === 'remove'
        ? { state: 'absent' }
        : {
            state: 'present',
            digest: operationDigest(operation.content),
            bytes: Buffer.byteLength(operation.content)
          }
      const suffix = `${transactionId}.${index}`
      return {
        index,
        host: operation.host || null,
        action: operation.action,
        kind: operation.kind || 'text',
        path: operation.path,
        preimageState,
        targetState,
        staged: `${operation.path}.devcodex-stage.${suffix}`,
        backup: `${operation.path}.devcodex-backup.${suffix}`,
        phase: 'prepared'
      }
    })
  }
  try {
    durableJsonWrite(journalFile, journal, fsImpl)
    addJournalToIndex(transactionRoot, journalFile, transactionId, fsImpl)
    updateJournal(journalFile, journal, fsImpl, 'prepared')
  } catch (error) {
    releaseJournalLock(journalLock, fsImpl)
    throw error
  }
  receipt.transactionId = transactionId
  receipt.journalFile = journalFile

  function markOperationPhase(journalOperation, phase) {
    journalOperation.phase = phase
    updateJournal(journalFile, journal, fsImpl, `${phase}:${journalOperation.index}`)
    if (options.crashAfterPhase === `${phase}:${journalOperation.index}` || options.crashAfterPhase === phase) {
      const error = new Error(`GLOBAL_HOST_TEST_SIMULATED_CRASH: ${phase}:${journalOperation.index}`)
      error.code = 'GLOBAL_HOST_TEST_SIMULATED_CRASH'
      error.simulatedCrash = true
      throw error
    }
  }

  const committed = []
  try {
    let changedIndex = 0
    const assertAbsenceGuards = () => {
      for (const operation of validated) {
        if (operation.action === 'remove' && operation.expectAbsent === true) {
          assertExpectedCurrent(operation, fsImpl)
        }
      }
    }
    for (const operation of validated) {
      const destination = operation.path
      assertAbsenceGuards()
      assertOperationPathSafe(operation, fsImpl)
      assertExpectedCurrent(operation, fsImpl)
      const existing = fsImpl.existsSync(destination)
      if (operation.action === 'remove' && !existing) continue
      const binary = operation.kind === 'binary'
      const current = existing ? fsImpl.readFileSync(destination, binary ? null : 'utf8') : null
      if (operation.action === 'write' && (binary
        ? Buffer.isBuffer(current) && current.equals(operation.content)
        : current === operation.content)) continue

      const journalOperation = journal.operations.find(item => item.path === destination)
      if (!journalOperation) {
        const error = new Error(`GLOBAL_HOST_JOURNAL_OPERATION_MISSING: ${destination}`)
        error.code = 'GLOBAL_HOST_JOURNAL_OPERATION_MISSING'
        throw error
      }
      const staged = journalOperation.staged
      const backup = journalOperation.backup
      validatePathBoundary(staged, operation.allowedRoots, operation.allowedFiles, fsImpl, { sidecarOf: destination })
      validatePathBoundary(backup, operation.allowedRoots, operation.allowedFiles, fsImpl, { sidecarOf: destination })
      let backupCreated = false
      try {
        fsImpl.mkdirSync(path.dirname(destination), { recursive: true })
        assertOperationPathSafe(operation, fsImpl)
        assertExpectedCurrent(operation, fsImpl)
        assertSidecarAbsent(staged, fsImpl)
        assertSidecarAbsent(backup, fsImpl)
        if (operation.action === 'write') {
          if (existing) {
            const sourceStat = fsImpl.statSync(destination)
            fsImpl.copyFileSync(destination, staged, fs.constants.COPYFILE_EXCL)
            fsImpl.chmodSync(staged, sourceStat.mode | 0o200)
            fsImpl.writeFileSync(staged, operation.content, binary
              ? { flag: 'w' }
              : { encoding: 'utf8', flag: 'w' })
            fsImpl.chmodSync(staged, sourceStat.mode)
            if (process.platform !== 'win32' && typeof fsImpl.chownSync === 'function') {
              fsImpl.chownSync(staged, sourceStat.uid, sourceStat.gid)
            }
          } else {
            fsImpl.writeFileSync(staged, operation.content, binary
              ? { flag: 'wx' }
              : { encoding: 'utf8', flag: 'wx' })
          }
          if (operation.kind === 'json') JSON.parse(fsImpl.readFileSync(staged, 'utf8'))
          markOperationPhase(journalOperation, 'staged')
        }
        if (existing) {
          assertOperationPathSafe(operation, fsImpl)
          assertExpectedCurrent(operation, fsImpl)
          fsImpl.renameSync(destination, backup)
          backupCreated = true
          if (operation.expectedDigest != null &&
              operationDigest(fsImpl.readFileSync(backup)) !== operation.expectedDigest) {
            const error = new Error(`GLOBAL_HOST_OPERATION_PRECONDITION_FAILED: ${destination}`)
            error.code = 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED'
            throw error
          }
          markOperationPhase(journalOperation, 'backed-up')
        }
        if (options.failAfter === changedIndex) throw new Error('GLOBAL_HOST_TEST_INJECTED_FAILURE')
        if (operation.action === 'write') {
          assertOperationPathSafe(operation, fsImpl)
          if (fsImpl.existsSync(destination)) {
            const error = new Error(`GLOBAL_HOST_OPERATION_PRECONDITION_FAILED: ${destination}`)
            error.code = 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED'
            throw error
          }
          fsImpl.renameSync(staged, destination)
        }
        markOperationPhase(journalOperation, 'installed')
        const installedState = fileState(destination, fsImpl)
        if (!stateMatches(installedState, journalOperation.targetState)) {
          const error = new Error(`GLOBAL_HOST_OPERATION_VERIFY_FAILED: ${destination}`)
          error.code = 'GLOBAL_HOST_OPERATION_VERIFY_FAILED'
          throw error
        }
        markOperationPhase(journalOperation, 'verified')
      } catch (error) {
        if (error.simulatedCrash) throw error
        try {
          if (fsImpl.existsSync(staged)) fsImpl.unlinkSync(staged)
          if (backupCreated && fsImpl.existsSync(backup)) {
            if (fsImpl.existsSync(destination)) {
              const rollbackError = new Error(`GLOBAL_HOST_ROLLBACK_DESTINATION_CONFLICT: ${destination}`)
              rollbackError.code = 'GLOBAL_HOST_ROLLBACK_DESTINATION_CONFLICT'
              throw rollbackError
            }
            assertOperationPathSafe(operation, fsImpl)
            fsImpl.renameSync(backup, destination)
          }
        } catch (rollbackError) {
          error.globalHostRollbackIncomplete = true
          error.globalHostRollbackFailure = {
            destination,
            backup: backupCreated && fsImpl.existsSync(backup) ? backup : null,
            errorCode: rollbackError.code || 'GLOBAL_HOST_ROLLBACK_FAILED',
            error: rollbackError.message
          }
        }
        throw error
      }
      committed.push({
        destination,
        backup: existing ? backup : null,
        created: operation.action === 'write' && !existing,
        removed: operation.action === 'remove',
        committedDigest: operation.action === 'write' ? operationDigest(operation.content) : null,
        backupDigest: existing ? operationDigest(current) : null,
        operation
      })
      changedIndex += 1
    }

    assertAbsenceGuards()

    for (const operation of journal.operations) {
      if (!stateMatches(fileState(operation.path, fsImpl), operation.targetState)) {
        const error = new Error(`GLOBAL_HOST_OPERATION_VERIFY_FAILED: ${operation.path}`)
        error.code = 'GLOBAL_HOST_OPERATION_VERIFY_FAILED'
        throw error
      }
    }
    updateJournal(journalFile, journal, fsImpl, 'committed')

    const backupCleanupFailures = []
    for (const entry of committed) {
      if (!entry.backup || !fsImpl.existsSync(entry.backup)) continue
      try {
        fsImpl.unlinkSync(entry.backup)
      } catch (error) {
        backupCleanupFailures.push({
          path: entry.backup,
          errorCode: error.code || 'GLOBAL_HOST_BACKUP_CLEANUP_FAILED',
          error: error.message
        })
      }
    }
    receipt.status = 'committed'
    if (backupCleanupFailures.length) {
      receipt.backupCleanupIncomplete = true
      receipt.backupCleanupFailures = backupCleanupFailures
    } else {
      cleanupCommittedJournal(transactionRoot, journalFile, transactionId, fsImpl)
    }
    receipt.completedAt = new Date().toISOString()
    releaseJournalLock(journalLock, fsImpl)
    return receipt
  } catch (error) {
    if (error.simulatedCrash) {
      receipt.status = 'recovery-required'
      receipt.errorCode = error.code
      receipt.error = error.message
      receipt.completedAt = new Date().toISOString()
      error.receipt = receipt
      releaseJournalLock(journalLock, fsImpl)
      throw error
    }
    try { updateJournal(journalFile, journal, fsImpl, 'rollback-started') } catch { }
    const rollbackFailures = []
    if (error.globalHostRollbackIncomplete) receipt.rollbackIncomplete = true
    if (error.globalHostRollbackFailure) rollbackFailures.push(error.globalHostRollbackFailure)
    for (const entry of committed.reverse()) {
      try {
        if (fsImpl.existsSync(entry.destination)) {
          if (entry.removed) {
            const rollbackError = new Error(`GLOBAL_HOST_ROLLBACK_DESTINATION_CONFLICT: ${entry.destination}`)
            rollbackError.code = 'GLOBAL_HOST_ROLLBACK_DESTINATION_CONFLICT'
            throw rollbackError
          }
          assertOperationPathSafe(entry.operation, fsImpl)
          const destinationStat = fsImpl.lstatSync(entry.destination)
          if (!destinationStat.isFile() || destinationStat.isSymbolicLink() ||
              operationDigest(fsImpl.readFileSync(entry.destination)) !== entry.committedDigest) {
            const rollbackError = new Error(`GLOBAL_HOST_ROLLBACK_DESTINATION_DRIFT: ${entry.destination}`)
            rollbackError.code = 'GLOBAL_HOST_ROLLBACK_DESTINATION_DRIFT'
            throw rollbackError
          }
          fsImpl.unlinkSync(entry.destination)
        }
        if (entry.backup && fsImpl.existsSync(entry.backup)) {
          if (fsImpl.existsSync(entry.destination)) {
            const rollbackError = new Error(`GLOBAL_HOST_ROLLBACK_DESTINATION_CONFLICT: ${entry.destination}`)
            rollbackError.code = 'GLOBAL_HOST_ROLLBACK_DESTINATION_CONFLICT'
            throw rollbackError
          }
          validatePathBoundary(
            entry.backup,
            entry.operation.allowedRoots,
            entry.operation.allowedFiles,
            fsImpl,
            { sidecarOf: entry.destination }
          )
          const backupStat = fsImpl.lstatSync(entry.backup)
          if (!backupStat.isFile() || backupStat.isSymbolicLink() ||
              operationDigest(fsImpl.readFileSync(entry.backup)) !== entry.backupDigest) {
            const rollbackError = new Error(`GLOBAL_HOST_ROLLBACK_BACKUP_DRIFT: ${entry.backup}`)
            rollbackError.code = 'GLOBAL_HOST_ROLLBACK_BACKUP_DRIFT'
            throw rollbackError
          }
          assertOperationPathSafe(entry.operation, fsImpl)
          fsImpl.renameSync(entry.backup, entry.destination)
        }
      } catch (rollbackError) {
        // Preserve the original failure; receipt exposes rollback failure separately below.
        receipt.rollbackIncomplete = true
        rollbackFailures.push({
          destination: entry.destination,
          backup: entry.backup && fsImpl.existsSync(entry.backup) ? entry.backup : null,
          errorCode: rollbackError.code || 'GLOBAL_HOST_ROLLBACK_FAILED',
          error: rollbackError.message
        })
      }
    }
    if (rollbackFailures.length) receipt.rollbackFailures = rollbackFailures
    receipt.status = receipt.rollbackIncomplete ? 'rollback-incomplete' : 'rolled-back'
    receipt.errorCode = error.code || 'GLOBAL_HOST_TRANSACTION_FAILED'
    receipt.error = error.message
    receipt.completedAt = new Date().toISOString()
    try {
      updateJournal(journalFile, journal, fsImpl, receipt.status)
      if (!receipt.rollbackIncomplete) cleanupCommittedJournal(transactionRoot, journalFile, transactionId, fsImpl)
    } catch (journalError) {
      receipt.rollbackIncomplete = true
      receipt.journalError = journalError.message
    }
    error.receipt = receipt
    releaseJournalLock(journalLock, fsImpl)
    throw error
  }
}

module.exports = {
  GLOBAL_HOST_JOURNAL_INDEX_SCHEMA,
  GLOBAL_HOST_JOURNAL_LOCK_SCHEMA,
  GLOBAL_HOST_JOURNAL_SCHEMA,
  GLOBAL_HOST_TRANSACTION_SCHEMA,
  executeGlobalHostTransaction,
  fileState,
  operationDigest,
  recoverIndexedTransactions,
  uniqueOperations,
  validateOperation
}
