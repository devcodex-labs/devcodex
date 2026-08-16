#!/usr/bin/env node
'use strict'

/**
 * SessionStart for Grok workspace plugin (W4).
 * PassivePassive: stdout is ignored for model context. We only stamp local session evidence
 * so doctor/debug can see DevCodex was active in this Grok session.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  buildGrokSessionPrivateOwner,
  validateGrokSessionPrivateOwner
} = require('../lib/private-temp-contract.cjs')

function sessionPermissionReceipt(targetPath, kind, fsImpl = fs, platform = process.platform) {
  if (platform === 'win32') {
    return { targetPath, kind, platform, status: 'UNVERIFIED', evidence: 'DACL was not probed' }
  }
  const mode = fsImpl.statSync(targetPath).mode & 0o777
  const expectedMode = kind === 'directory' ? 0o700 : 0o600
  return { targetPath, kind, platform, mode, expectedMode, status: mode === expectedMode ? 'PASS' : 'WARN' }
}

function runSessionStart(options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const pluginData = env.GROK_PLUGIN_DATA
    || path.join(os.tmpdir(), 'devcodex-grok-plugin-data')
  const record = buildGrokSessionPrivateOwner({
    pluginData,
    sessionId: env.GROK_SESSION_ID,
    nonce: options.nonce,
    ownerToken: options.ownerToken,
    nowMs: options.nowMs,
    ttlMs: options.ttlMs,
    pid: options.pid,
    hostname: options.hostname,
    cwd: options.cwd || process.cwd(),
    workspaceRoot: env.GROK_WORKSPACE_ROOT || env.CLAUDE_PROJECT_DIR || null
  })
  const validation = validateGrokSessionPrivateOwner(record, pluginData)
  if (!validation.valid) {
    const error = new Error(`GROK_SESSION_PRIVATE_OWNER_INVALID: ${validation.errors.join(',')}`)
    error.code = 'GROK_SESSION_PRIVATE_OWNER_INVALID'
    throw error
  }
  fsImpl.mkdirSync(record.privateRoot, { recursive: true, mode: 0o700 })
  fsImpl.mkdirSync(record.ownerRoot, { recursive: false, mode: 0o700 })
  if (process.platform !== 'win32') {
    fsImpl.chmodSync(record.privateRoot, 0o700)
    fsImpl.chmodSync(record.ownerRoot, 0o700)
  }
  fsImpl.writeFileSync(record.stampPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  })
  if (process.platform !== 'win32') fsImpl.chmodSync(record.stampPath, 0o600)
  return {
    schemaVersion: 'GrokSessionPrivateOwnerReceiptV1',
    status: 'PASS',
    ownerId: record.ownerId,
    ownerTokenDigest: record.ownerTokenDigest,
    privateRoot: record.privateRoot,
    ownerRoot: record.ownerRoot,
    stampPath: record.stampPath,
    expiresAt: record.expiresAt,
    permissions: [
      sessionPermissionReceipt(record.privateRoot, 'directory', fsImpl),
      sessionPermissionReceipt(record.ownerRoot, 'directory', fsImpl),
      sessionPermissionReceipt(record.stampPath, 'file', fsImpl)
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

module.exports = { main, runSessionStart, sessionPermissionReceipt }
