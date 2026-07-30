'use strict'

const fs = require('fs')
const path = require('path')
const { isUnderPhysical, samePath } = require('./global-host-target.js')

const GLOBAL_HOST_TRANSACTION_SCHEMA = 'GlobalHostConfigTransactionV1'

function acceptedByBoundary(destination, scopedRoots, scopedFiles, fsImpl, options = {}) {
  if (scopedRoots.some(root => isUnderPhysical(root, destination, fsImpl))) return true
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

function validateOperation(operation, allowedRoots, allowedFiles = [], allowedByHost = {}, fsImpl = fs) {
  const validContent = typeof operation?.content === 'string' || Buffer.isBuffer(operation?.content)
  if (!operation || !operation.path || !validContent) {
    const error = new Error('GLOBAL_HOST_OPERATION_INVALID')
    error.code = 'GLOBAL_HOST_OPERATION_INVALID'
    throw error
  }
  if (Buffer.isBuffer(operation.content) && operation.kind !== 'binary') {
    const error = new Error('GLOBAL_HOST_BINARY_KIND_REQUIRED')
    error.code = 'GLOBAL_HOST_BINARY_KIND_REQUIRED'
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
  if (operation.host && Object.keys(allowedByHost).length && !hostBoundary) {
    const error = new Error(`GLOBAL_HOST_OPERATION_HOST_UNKNOWN: ${operation.host}`)
    error.code = 'GLOBAL_HOST_OPERATION_HOST_UNKNOWN'
    throw error
  }
  validatePathBoundary(destination, scopedRoots, scopedFiles, fsImpl)
  if (operation.kind === 'json') JSON.parse(operation.content)
  return { ...operation, path: destination, allowedRoots: scopedRoots, allowedFiles: scopedFiles }
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
  const allowedByHost = options.allowedByHost || {}
  if (!allowedRoots.length && !allowedFiles.length) {
    const error = new Error('GLOBAL_HOST_ALLOWED_ROOT_REQUIRED')
    error.code = 'GLOBAL_HOST_ALLOWED_ROOT_REQUIRED'
    throw error
  }

  const validated = uniqueOperations(operations || [])
    .map(operation => validateOperation(operation, allowedRoots, allowedFiles, allowedByHost, fsImpl))
  const receipt = {
    schemaVersion: GLOBAL_HOST_TRANSACTION_SCHEMA,
    status: options.dryRun ? 'planned' : 'pending',
    dryRun: options.dryRun === true,
    startedAt: new Date().toISOString(),
    operations: validated.map(operation => ({
      host: operation.host || null,
      kind: operation.kind || 'text',
      path: operation.path,
      changed: true
    }))
  }

  for (const item of receipt.operations) {
    const operation = validated.find(candidate => candidate.path === item.path)
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
    for (const operation of validated) {
      const destination = operation.path
      const existing = fsImpl.existsSync(destination)
      const binary = operation.kind === 'binary'
      const current = existing ? fsImpl.readFileSync(destination, binary ? null : 'utf8') : null
      if (binary
        ? Buffer.isBuffer(current) && current.equals(operation.content)
        : current === operation.content) continue

      const suffix = `${process.pid}.${Date.now()}.${changedIndex}`
      const staged = `${destination}.devcodex-stage.${suffix}`
      const backup = `${destination}.devcodex-backup.${suffix}`
      validatePathBoundary(staged, operation.allowedRoots, operation.allowedFiles, fsImpl, { sidecarOf: destination })
      validatePathBoundary(backup, operation.allowedRoots, operation.allowedFiles, fsImpl, { sidecarOf: destination })
      let backupCreated = false
      try {
        fsImpl.mkdirSync(path.dirname(destination), { recursive: true })
        fsImpl.writeFileSync(staged, operation.content, binary ? undefined : 'utf8')
        if (operation.kind === 'json') JSON.parse(fsImpl.readFileSync(staged, 'utf8'))
        if (existing) {
          fsImpl.renameSync(destination, backup)
          backupCreated = true
        }
        if (options.failAfter === changedIndex) throw new Error('GLOBAL_HOST_TEST_INJECTED_FAILURE')
        fsImpl.renameSync(staged, destination)
      } catch (error) {
        try {
          if (fsImpl.existsSync(staged)) fsImpl.unlinkSync(staged)
          if (backupCreated && fsImpl.existsSync(backup)) fsImpl.renameSync(backup, destination)
        } catch {
          error.globalHostRollbackIncomplete = true
        }
        throw error
      }
      committed.push({ destination, backup: existing ? backup : null, created: !existing })
      changedIndex += 1
    }

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
    if (error.globalHostRollbackIncomplete) receipt.rollbackIncomplete = true
    for (const entry of committed.reverse()) {
      try {
        if (fsImpl.existsSync(entry.destination)) fsImpl.unlinkSync(entry.destination)
        if (entry.backup && fsImpl.existsSync(entry.backup)) fsImpl.renameSync(entry.backup, entry.destination)
      } catch {
        // Preserve the original failure; receipt exposes rollback failure separately below.
        receipt.rollbackIncomplete = true
      }
    }
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
  uniqueOperations,
  validateOperation
}
