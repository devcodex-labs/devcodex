#!/usr/bin/env node
'use strict'

/**
 * SessionStart for Grok workspace plugin (W4).
 * PassivePassive: stdout is ignored for model context. We only stamp local session evidence
 * so doctor/debug can see DevCodex was active in this Grok session.
 */
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const os = require('os')
const {
  buildGrokSessionObservation,
  validateGrokSessionObservation
} = require('../lib/private-temp-contract.cjs')

const SESSION_OBSERVATION_LOCK_SCHEMA = 'GrokSessionObservationLockV1'
const SESSION_OBSERVATION_LOCK_LEASE_MS = 30 * 1000

function sessionPermissionReceipt(targetPath, kind, fsImpl = fs, platform = process.platform) {
  if (platform === 'win32') {
    return { targetPath, kind, platform, status: 'UNVERIFIED', evidence: 'DACL was not probed' }
  }
  const mode = fsImpl.statSync(targetPath).mode & 0o777
  const expectedMode = kind === 'directory' ? 0o700 : 0o600
  return { targetPath, kind, platform, mode, expectedMode, status: mode === expectedMode ? 'PASS' : 'WARN' }
}

function readJson(file, fsImpl = fs) {
  try {
    const value = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function acquireObservationLock(privateRoot, ownerToken, options = {}) {
  const fsImpl = options.fs || fs
  const lockPath = path.join(privateRoot, 'observation.lock')
  const stalePath = `${lockPath}.stale`
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  fsImpl.mkdirSync(privateRoot, { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor
    try {
      descriptor = fsImpl.openSync(lockPath, 'wx', 0o600)
      const lockRecord = {
        schemaVersion: SESSION_OBSERVATION_LOCK_SCHEMA,
        ownerTokenDigest: crypto.createHash('sha256').update(ownerToken).digest('hex'),
        pid: Number.isInteger(options.pid) && options.pid > 0 ? options.pid : process.pid,
        hostname: String(options.hostname || os.hostname()),
        acquiredAtMs: nowMs,
        leaseExpiresAtMs: nowMs + SESSION_OBSERVATION_LOCK_LEASE_MS
      }
      try {
        fsImpl.writeFileSync(descriptor, `${JSON.stringify(lockRecord)}\n`, 'utf8')
        if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
      } catch (error) {
        try { fsImpl.closeSync(descriptor) } catch { }
        descriptor = undefined
        try { fsImpl.unlinkSync(lockPath) } catch { }
        throw error
      }
      return { descriptor, lockPath, stalePath, ownerTokenDigest: lockRecord.ownerTokenDigest }
    } catch (error) {
      if (descriptor !== undefined) try { fsImpl.closeSync(descriptor) } catch { }
      if (error?.code !== 'EEXIST') throw error
      const observed = readJson(lockPath, fsImpl)
      let ageMs = 0
      try { ageMs = Math.max(0, nowMs - fsImpl.statSync(lockPath).mtimeMs) } catch { }
      const leaseExpired = Number(observed?.leaseExpiresAtMs || 0) <= nowMs ||
        ageMs >= SESSION_OBSERVATION_LOCK_LEASE_MS
      if (!leaseExpired || attempt > 0) {
        const locked = new Error('GROK_SESSION_OBSERVATION_LOCKED')
        locked.code = 'GROK_SESSION_OBSERVATION_LOCKED'
        throw locked
      }
      try { if (fsImpl.existsSync(stalePath)) fsImpl.unlinkSync(stalePath) } catch { }
      try {
        fsImpl.renameSync(lockPath, stalePath)
      } catch (renameError) {
        if (renameError?.code === 'ENOENT') continue
        throw renameError
      }
    }
  }
  const locked = new Error('GROK_SESSION_OBSERVATION_LOCKED')
  locked.code = 'GROK_SESSION_OBSERVATION_LOCKED'
  throw locked
}

function releaseObservationLock(lock, fsImpl = fs) {
  try { fsImpl.closeSync(lock.descriptor) } catch { }
  const observed = readJson(lock.lockPath, fsImpl)
  if (observed?.ownerTokenDigest !== lock.ownerTokenDigest) return false
  try { fsImpl.unlinkSync(lock.lockPath) } catch { return false }
  try { if (fsImpl.existsSync(lock.stalePath)) fsImpl.unlinkSync(lock.stalePath) } catch { }
  return true
}

function persistSessionObservation(record, ownerToken, options = {}) {
  const fsImpl = options.fs || fs
  const target = record.observationPath
  const temporary = `${target}.next.tmp`
  const backup = `${target}.replace.v1`
  const lock = acquireObservationLock(record.privateRoot, ownerToken, options)
  let descriptor
  let installed = false
  let hadPrior = false
  try {
    if (fsImpl.existsSync(backup)) {
      if (fsImpl.existsSync(target)) fsImpl.unlinkSync(backup)
      else fsImpl.renameSync(backup, target)
    }
    if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary)
    descriptor = fsImpl.openSync(temporary, 'wx', 0o600)
    fsImpl.writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
    fsImpl.closeSync(descriptor)
    descriptor = undefined
    hadPrior = fsImpl.existsSync(target)
    if (hadPrior) fsImpl.renameSync(target, backup)
    fsImpl.renameSync(temporary, target)
    installed = true
    const readBack = readJson(target, fsImpl)
    const validation = validateGrokSessionObservation(readBack, path.dirname(record.privateRoot))
    if (!validation.valid || readBack.ownerTokenDigest !== record.ownerTokenDigest) {
      const error = new Error(`GROK_SESSION_OBSERVATION_READBACK_FAILED: ${validation.errors.join(',')}`)
      error.code = 'GROK_SESSION_OBSERVATION_READBACK_FAILED'
      throw error
    }
    if (fsImpl.existsSync(backup)) fsImpl.unlinkSync(backup)
    return readBack
  } catch (error) {
    if (descriptor !== undefined) try { fsImpl.closeSync(descriptor) } catch { }
    try { if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary) } catch { }
    if (installed) {
      try { if (fsImpl.existsSync(target)) fsImpl.unlinkSync(target) } catch { }
    }
    if (hadPrior && fsImpl.existsSync(backup) && !fsImpl.existsSync(target)) {
      try { fsImpl.renameSync(backup, target) } catch { }
    }
    throw error
  } finally {
    releaseObservationLock(lock, fsImpl)
  }
}

function runSessionStart(options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const pluginData = env.GROK_PLUGIN_DATA
    || path.join(os.tmpdir(), 'devcodex-grok-plugin-data')
  const ownerToken = String(options.ownerToken || crypto.randomBytes(32).toString('hex'))
  const record = buildGrokSessionObservation({
    pluginData,
    sessionId: env.GROK_SESSION_ID,
    nonce: options.nonce,
    ownerToken,
    nowMs: options.nowMs,
    ttlMs: options.ttlMs,
    pid: options.pid,
    hostname: options.hostname,
    cwd: options.cwd || process.cwd(),
    workspaceRoot: env.GROK_WORKSPACE_ROOT || env.CLAUDE_PROJECT_DIR || null
  })
  const validation = validateGrokSessionObservation(record, pluginData)
  if (!validation.valid) {
    const error = new Error(`GROK_SESSION_OBSERVATION_INVALID: ${validation.errors.join(',')}`)
    error.code = 'GROK_SESSION_OBSERVATION_INVALID'
    throw error
  }
  fsImpl.mkdirSync(record.privateRoot, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    fsImpl.chmodSync(record.privateRoot, 0o700)
  }
  persistSessionObservation(record, ownerToken, { ...options, fs: fsImpl })
  if (process.platform !== 'win32') fsImpl.chmodSync(record.observationPath, 0o600)
  return {
    schemaVersion: 'GrokSessionPrivateObservationReceiptV2',
    status: 'PASS',
    slotIndex: record.slotIndex,
    slotCount: record.slotCount,
    ownerTokenDigest: record.ownerTokenDigest,
    privateRoot: record.privateRoot,
    observationPath: record.observationPath,
    expiresAt: record.expiresAt,
    permissions: [
      sessionPermissionReceipt(record.privateRoot, 'directory', fsImpl),
      sessionPermissionReceipt(record.observationPath, 'file', fsImpl)
    ]
  }
}

function main() {
  try {
    runSessionStart()
  } catch {
    // fail-open
  }
  process.exitCode = 0
}

if (require.main === module) main()

module.exports = {
  acquireObservationLock,
  main,
  persistSessionObservation,
  releaseObservationLock,
  runSessionStart,
  sessionPermissionReceipt
}
