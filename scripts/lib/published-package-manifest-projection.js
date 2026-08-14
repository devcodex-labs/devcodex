'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  acquireLock,
  releaseLock,
  resolvePackageProjectionStatePaths
} = require('./package-compatibility-projection')
const {
  buildPublishedPackageManifest,
  validatePublishedPackageManifest,
  validatePublishedPackageRoot
} = require('./published-package-scripts-contract')

const PROJECTION_SCHEMA = 'PublishedPackageManifestProjectionV1'
const RECEIPT_SCHEMA = 'PublishedPackageManifestProjectionReceiptV1'
const DEFAULT_RECEIPT = 'published-package-manifest-projection.receipt.json'
const DEFAULT_BACKUP = 'published-package-manifest-projection.original.json'

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function writeAtomic (target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.devcodex-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(temporary, content, { flag: 'wx' })
  try {
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function resolvePublishedManifestProjectionPaths (root, options = {}) {
  const stateRoot = resolvePackageProjectionStatePaths(root, options).stateRoot
  return {
    stateRoot,
    receiptPath: options.manifestReceiptFile || path.join(stateRoot, DEFAULT_RECEIPT),
    backupPath: options.manifestBackupFile || path.join(stateRoot, DEFAULT_BACKUP),
    manifestPath: path.join(path.resolve(root), 'package.json')
  }
}

function readReceipt (paths) {
  if (!fs.existsSync(paths.receiptPath)) return null
  const receipt = JSON.parse(fs.readFileSync(paths.receiptPath, 'utf8'))
  if (receipt.schemaVersion !== RECEIPT_SCHEMA || receipt.root !== path.dirname(paths.manifestPath)) {
    const error = new Error('PUBLISHED_PACKAGE_MANIFEST_RECEIPT_INVALID')
    error.code = 'PUBLISHED_PACKAGE_MANIFEST_RECEIPT_INVALID'
    throw error
  }
  return receipt
}

function removeStateFile (target) {
  try {
    fs.unlinkSync(target)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function restoreUnderLock (root, paths) {
  const receipt = readReceipt(paths)
  if (!receipt) {
    if (!fs.existsSync(paths.backupPath)) return { status: 'no-op', restored: false }
    const current = fs.readFileSync(paths.manifestPath)
    const backup = fs.readFileSync(paths.backupPath)
    if (sha256(current) !== sha256(backup)) {
      const error = new Error('PUBLISHED_PACKAGE_MANIFEST_ORPHAN_BACKUP_CONFLICT')
      error.code = 'PUBLISHED_PACKAGE_MANIFEST_ORPHAN_BACKUP_CONFLICT'
      throw error
    }
    removeStateFile(paths.backupPath)
    return { status: 'orphan-backup-cleaned', restored: false }
  }
  if (!fs.existsSync(paths.backupPath)) {
    const error = new Error('PUBLISHED_PACKAGE_MANIFEST_BACKUP_MISSING')
    error.code = 'PUBLISHED_PACKAGE_MANIFEST_BACKUP_MISSING'
    throw error
  }
  const backup = fs.readFileSync(paths.backupPath)
  if (sha256(backup) !== receipt.sourceDigest) {
    const error = new Error('PUBLISHED_PACKAGE_MANIFEST_BACKUP_DIGEST_MISMATCH')
    error.code = 'PUBLISHED_PACKAGE_MANIFEST_BACKUP_DIGEST_MISMATCH'
    throw error
  }
  const current = fs.readFileSync(paths.manifestPath)
  const currentDigest = sha256(current)
  let restored = false
  if (currentDigest === receipt.projectedDigest) {
    writeAtomic(paths.manifestPath, backup)
    restored = true
  } else if (currentDigest !== receipt.sourceDigest) {
    const error = new Error('PUBLISHED_PACKAGE_MANIFEST_RESTORE_CONFLICT')
    error.code = 'PUBLISHED_PACKAGE_MANIFEST_RESTORE_CONFLICT'
    error.currentDigest = currentDigest
    throw error
  }
  removeStateFile(paths.receiptPath)
  removeStateFile(paths.backupPath)
  return { status: restored ? 'restored' : 'already-restored', restored }
}

function projectPublishedPackageManifest (root, options = {}) {
  const absoluteRoot = path.resolve(root)
  const paths = resolvePublishedManifestProjectionPaths(absoluteRoot, options)
  const lock = acquireLock(absoluteRoot, { ...options, operation: 'published-manifest-project' })
  try {
    const recovery = restoreUnderLock(absoluteRoot, paths)
    const sourceBytes = fs.readFileSync(paths.manifestPath)
    const sourceManifest = JSON.parse(sourceBytes.toString('utf8'))
    const projectedManifest = buildPublishedPackageManifest(sourceManifest)
    const validation = validatePublishedPackageManifest(absoluteRoot, projectedManifest)
    const projectedBytes = Buffer.from(`${JSON.stringify(projectedManifest, null, 2)}\n`, 'utf8')
    const receipt = {
      schemaVersion: RECEIPT_SCHEMA,
      root: absoluteRoot,
      createdAt: new Date().toISOString(),
      sourceDigest: sha256(sourceBytes),
      projectedDigest: sha256(projectedBytes),
      scriptNames: validation.scriptNames,
      closureFileCount: validation.closureFileCount
    }
    if (fs.existsSync(paths.backupPath) || fs.existsSync(paths.receiptPath)) {
      const error = new Error('PUBLISHED_PACKAGE_MANIFEST_STATE_CONFLICT')
      error.code = 'PUBLISHED_PACKAGE_MANIFEST_STATE_CONFLICT'
      throw error
    }
    writeAtomic(paths.backupPath, sourceBytes)
    writeAtomic(paths.receiptPath, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`))
    try {
      writeAtomic(paths.manifestPath, projectedBytes)
      const readback = validatePublishedPackageRoot(absoluteRoot)
      if (sha256(fs.readFileSync(paths.manifestPath)) !== receipt.projectedDigest) {
        const error = new Error('PUBLISHED_PACKAGE_MANIFEST_READBACK_MISMATCH')
        error.code = 'PUBLISHED_PACKAGE_MANIFEST_READBACK_MISMATCH'
        throw error
      }
      return {
        schemaVersion: PROJECTION_SCHEMA,
        status: 'projected',
        recoveryStatus: recovery.status,
        sourceDigest: receipt.sourceDigest,
        projectedDigest: receipt.projectedDigest,
        scriptCount: readback.scriptCount,
        receiptPath: paths.receiptPath
      }
    } catch (error) {
      try { restoreUnderLock(absoluteRoot, paths) } catch (restoreError) { error.restoreError = restoreError }
      throw error
    }
  } finally {
    releaseLock(lock)
  }
}

function restorePublishedPackageManifest (root, options = {}) {
  const absoluteRoot = path.resolve(root)
  const paths = resolvePublishedManifestProjectionPaths(absoluteRoot, options)
  const lock = acquireLock(absoluteRoot, { ...options, operation: 'published-manifest-restore' })
  try {
    return restoreUnderLock(absoluteRoot, paths)
  } finally {
    releaseLock(lock)
  }
}

module.exports = {
  DEFAULT_BACKUP,
  DEFAULT_RECEIPT,
  PROJECTION_SCHEMA,
  RECEIPT_SCHEMA,
  projectPublishedPackageManifest,
  resolvePublishedManifestProjectionPaths,
  restorePublishedPackageManifest
}
