'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  isUnder,
  samePath,
  unsafePathComponent
} = require('./global-host-target.js')

const GLOBAL_HOST_TRANSACTION_SCHEMA = 'GlobalHostConfigTransactionV1'

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
  receipt.changed = receipt.operations.filter(item => item.changed).length

  if (receipt.dryRun) {
    receipt.completedAt = new Date().toISOString()
    return receipt
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

      const suffix = `${process.pid}.${Date.now()}.${changedIndex}`
      const staged = `${destination}.devcodex-stage.${suffix}`
      const backup = `${destination}.devcodex-backup.${suffix}`
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
      } catch (error) {
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
    }
    receipt.completedAt = new Date().toISOString()
    return receipt
  } catch (error) {
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
    error.receipt = receipt
    throw error
  }
}

module.exports = {
  GLOBAL_HOST_TRANSACTION_SCHEMA,
  executeGlobalHostTransaction,
  operationDigest,
  uniqueOperations,
  validateOperation
}
