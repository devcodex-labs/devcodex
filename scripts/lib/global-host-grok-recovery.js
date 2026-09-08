'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { samePath, isUnderPhysical } = require('./global-host-target.js')
const { portable } = require('./global-host-config.js')
const { parseJsonObject } = require('./global-host-config-merge.js')
const { executeGlobalHostTransaction, operationDigest } = require('./global-host-config-transaction.js')

// Grok registration compensation and its exact owned recovery artifacts.
const digestText = value => crypto.createHash('sha256').update(String(value)).digest('hex')
const readText = (file, fsImpl) => fsImpl.existsSync(file) ? fsImpl.readFileSync(file, 'utf8') : ''
const samePathValue = (left, right) => Boolean(left && right && samePath(left, right))

function buildGrokConfigCompensationOperation(snapshot, integration, fsImpl = fs) {
  const currentExists = fsImpl.existsSync(snapshot.path)
  const currentBytes = currentExists ? fsImpl.readFileSync(snapshot.path) : null
  const currentDigest = operationDigest(currentBytes == null ? '' : currentBytes)
  const beforeDigest = operationDigest(snapshot.content)
  const authorizedAfter = integration?.dryRun === false &&
    integration.beforeDigest === beforeDigest &&
    integration.afterDigest === currentDigest

  if (snapshot.existed) {
    if (currentExists && currentDigest === beforeDigest) return null
    if (!currentExists) {
      return {
        host: 'grok',
        action: 'write',
        path: snapshot.path,
        kind: 'toml',
        content: snapshot.content,
        expectAbsent: true
      }
    }
    if (authorizedAfter) {
      return {
        host: 'grok',
        action: 'write',
        path: snapshot.path,
        kind: 'toml',
        content: snapshot.content,
        expectedDigest: currentDigest
      }
    }
  } else {
    if (!currentExists) return null
    if (authorizedAfter) {
      return {
        host: 'grok',
        action: 'remove',
        path: snapshot.path,
        kind: 'toml',
        expectedDigest: currentDigest
      }
    }
  }

  const error = new Error(`GLOBAL_HOST_REMOVAL_GROK_COMPENSATION_DRIFT: ${snapshot.path}`)
  error.code = 'GLOBAL_HOST_REMOVAL_GROK_COMPENSATION_DRIFT'
  throw error
}

function workspaceTempRootFromManifest(manifestPath) {
  let current = path.dirname(path.resolve(manifestPath))
  while (true) {
    if (path.basename(current).toLowerCase() === 'manifests') {
      const candidate = path.dirname(current)
      if (path.basename(candidate).toLowerCase() === 'devcodex' &&
          path.basename(path.dirname(candidate)).toLowerCase() === '.tmp') return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function cleanupGrokRecoveryArtifact(integration, fsImpl = fs) {
  const backupPath = integration?.backupPath ? path.resolve(integration.backupPath) : null
  const manifestPath = integration?.backupManifestPath ? path.resolve(integration.backupManifestPath) : null
  if (!backupPath && !manifestPath) {
    return { status: 'not-applicable', transaction: null, failures: [] }
  }
  const failures = []
  if (!backupPath || !manifestPath) {
    failures.push({
      errorCode: 'GLOBAL_HOST_GROK_RECOVERY_PROOF_INCOMPLETE',
      error: 'Grok recovery cleanup requires both backupPath and backupManifestPath'
    })
    return { status: 'blocked', transaction: null, failures }
  }
  const tempRoot = workspaceTempRootFromManifest(manifestPath)
  if (!tempRoot ||
      !isUnderPhysical(tempRoot, backupPath, fsImpl) ||
      !isUnderPhysical(path.join(tempRoot, 'manifests'), manifestPath, fsImpl)) {
    failures.push({
      errorCode: 'GLOBAL_HOST_GROK_RECOVERY_PATH_INVALID',
      error: 'Grok recovery paths are outside one canonical workspace temp root'
    })
    return { status: 'blocked', transaction: null, failures }
  }
  if (!fsImpl.existsSync(manifestPath) || fsImpl.lstatSync(manifestPath).isSymbolicLink() ||
      !fsImpl.lstatSync(manifestPath).isFile()) {
    failures.push({
      errorCode: 'GLOBAL_HOST_GROK_RECOVERY_MANIFEST_INVALID',
      path: portable(manifestPath),
      error: 'Grok recovery manifest is missing or not a regular file'
    })
    return { status: 'blocked', transaction: null, failures }
  }
  let manifest
  try {
    manifest = parseJsonObject(readText(manifestPath, fsImpl), 'Grok recovery manifest')
  } catch (error) {
    failures.push({ errorCode: error.code || 'GLOBAL_HOST_GROK_RECOVERY_MANIFEST_INVALID', error: error.message })
    return { status: 'blocked', transaction: null, failures }
  }
  const v1Proof = manifest.schemaVersion === 'WorkspaceTempManifestV1' &&
    path.isAbsolute(String(manifest.targetPath || '')) &&
    samePathValue(manifest.targetPath, backupPath)
  const v2Target = manifest.schemaVersion === 'WorkspaceTempManifestV2'
    ? path.resolve(tempRoot, String(manifest.targetRelativePath || ''))
    : null
  const v2ManifestPath = manifest.schemaVersion === 'WorkspaceTempManifestV2'
    ? path.join(
        tempRoot,
        'manifests',
        'v2',
        crypto.createHash('sha256').update(String(manifest.project || '')).digest('hex'),
        'backups',
        `${manifest.artifactId}.json`
      )
    : null
  const v2Proof = manifest.schemaVersion === 'WorkspaceTempManifestV2' &&
    manifest.type === 'backup' &&
    manifest.lifecycleState === 'finalized' &&
    manifest.finalDisposition === 'retained' &&
    /^[a-f0-9]{64}$/.test(String(manifest.ownerTokenDigest || '')) &&
    samePathValue(v2Target, backupPath) &&
    samePathValue(v2ManifestPath, manifestPath)
  if ((!v1Proof && !v2Proof) ||
      manifest.owner !== 'devcodex-grok-adapter' ||
      manifest.producer !== 'grok-plugin-uninstall') {
    failures.push({
      errorCode: 'GLOBAL_HOST_GROK_RECOVERY_OWNERSHIP_INVALID',
      path: portable(manifestPath),
      error: 'Grok recovery manifest does not prove exact DevCodex uninstall ownership'
    })
    return { status: 'blocked', transaction: null, failures }
  }
  const operations = []
  if (fsImpl.existsSync(backupPath)) {
    const stat = fsImpl.lstatSync(backupPath)
    if (stat.isSymbolicLink() || !stat.isFile() ||
        !/^[a-f0-9]{64}$/i.test(String(integration.beforeDigest || '')) ||
        digestText(fsImpl.readFileSync(backupPath, 'utf8')) !== integration.beforeDigest) {
      failures.push({
        errorCode: 'GLOBAL_HOST_GROK_RECOVERY_BACKUP_MODIFIED',
        path: portable(backupPath),
        error: 'Grok recovery backup is modified or not a regular file'
      })
      return { status: 'blocked', transaction: null, failures }
    }
    operations.push({
      host: 'grok-recovery',
      action: 'remove',
      path: backupPath,
      kind: 'text',
      expectedDigest: operationDigest(fsImpl.readFileSync(backupPath))
    })
  }
  operations.push({
    host: 'grok-recovery',
    action: 'remove',
    path: manifestPath,
    kind: 'json',
    expectedDigest: operationDigest(fsImpl.readFileSync(manifestPath))
  })
  try {
    const transaction = executeGlobalHostTransaction(operations, {
      fs: fsImpl,
      allowedRoots: [tempRoot],
      safetyRoots: [tempRoot],
      transactionRoot: path.join(tempRoot, 'transactions'),
      allowedByHost: {
        'grok-recovery': { allowedRoots: [tempRoot], allowedFiles: [] }
      }
    })
    return {
      status: transaction.backupCleanupIncomplete ? 'cleanup-incomplete' : 'committed',
      transaction,
      failures: transaction.backupCleanupFailures || []
    }
  } catch (error) {
    return {
      status: 'blocked',
      transaction: error.receipt || null,
      failures: [{ errorCode: error.code || 'GLOBAL_HOST_GROK_RECOVERY_CLEANUP_FAILED', error: error.message }]
    }
  }
}

module.exports = { buildGrokConfigCompensationOperation, cleanupGrokRecoveryArtifact }
