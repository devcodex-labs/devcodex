'use strict'

const crypto = require('crypto')
const os = require('os')
const path = require('path')

const PRIVATE_TEMP_SCHEMA_VERSION = 'GrokPrivateTempOwnerV1'
const SESSION_PRIVATE_SCHEMA_VERSION = 'GrokSessionPrivateOwnerV1'
const OWNER_ID_RE = /^[a-f0-9-]{16,80}$/i

function samePath(left, right) {
  const a = path.resolve(String(left || ''))
  const b = path.resolve(String(right || ''))
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

function buildPrivateTempOwnerRecord(input = {}) {
  const privateRoot = path.resolve(String(input.privateRoot || ''))
  const ownerId = String(input.ownerId || '').trim()
  const ownerRoot = path.resolve(String(input.ownerRoot || ''))
  const snapshotPath = path.resolve(String(input.snapshotPath || ''))
  const ownerToken = String(input.ownerToken || '')
  if (!privateRoot || !OWNER_ID_RE.test(ownerId) || !ownerToken) {
    throw Object.assign(new Error('GROK_PRIVATE_TEMP_OWNER_INVALID'), { code: 'GROK_PRIVATE_TEMP_OWNER_INVALID' })
  }
  if (!isPathInside(privateRoot, ownerRoot) || !isPathInside(ownerRoot, snapshotPath)) {
    throw Object.assign(new Error('GROK_PRIVATE_TEMP_PATH_ESCAPE'), { code: 'GROK_PRIVATE_TEMP_PATH_ESCAPE' })
  }
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
  const ttlMs = Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : 60 * 60 * 1000
  return {
    schemaVersion: PRIVATE_TEMP_SCHEMA_VERSION,
    ownerId,
    ownerToken,
    ownerTokenDigest: tokenDigest(ownerToken),
    privateRoot,
    ownerRoot,
    snapshotPath,
    promptDigest: String(input.promptDigest || ''),
    state: String(input.state || 'allocated'),
    pid: Number.isInteger(input.pid) && input.pid > 0 ? input.pid : process.pid,
    hostname: String(input.hostname || os.hostname()),
    createdAt: new Date(nowMs).toISOString(),
    createdAtMs: nowMs,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    expiresAtMs: nowMs + ttlMs
  }
}

function validatePrivateTempOwnerRecord(record, expectedPrivateRoot) {
  const errors = []
  if (!record || typeof record !== 'object') return { valid: false, errors: ['record-invalid'] }
  if (record.schemaVersion !== PRIVATE_TEMP_SCHEMA_VERSION) errors.push('schema-version-invalid')
  if (!OWNER_ID_RE.test(String(record.ownerId || ''))) errors.push('owner-id-invalid')
  if (!record.ownerToken || tokenDigest(record.ownerToken) !== record.ownerTokenDigest) errors.push('owner-token-invalid')
  if (!Number.isInteger(record.pid) || record.pid <= 0) errors.push('pid-invalid')
  if (!String(record.hostname || '').trim()) errors.push('hostname-invalid')
  if (!Number.isFinite(Number(record.expiresAtMs))) errors.push('expiry-invalid')
  try {
    const privateRoot = path.resolve(String(record.privateRoot || ''))
    const ownerRoot = path.resolve(String(record.ownerRoot || ''))
    const snapshotPath = path.resolve(String(record.snapshotPath || ''))
    if (expectedPrivateRoot && !samePath(privateRoot, expectedPrivateRoot)) errors.push('private-root-mismatch')
    if (!isPathInside(privateRoot, ownerRoot)) errors.push('owner-root-escape')
    if (!isPathInside(ownerRoot, snapshotPath)) errors.push('snapshot-path-escape')
    if (path.basename(ownerRoot).toLowerCase() !== String(record.ownerId || '').toLowerCase()) {
      errors.push('owner-root-identity-mismatch')
    }
  } catch {
    errors.push('path-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function probeOwnerProcess(record, options = {}) {
  const hostname = String(options.hostname || os.hostname())
  if (String(record?.hostname || '') !== hostname) return 'unknown'
  const kill = options.kill || process.kill.bind(process)
  try {
    kill(Number(record.pid), 0)
    return 'live'
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead'
    return 'unknown'
  }
}

function classifyPrivateTempRecovery(record, options = {}) {
  const validation = validatePrivateTempOwnerRecord(record, options.privateRoot)
  if (!validation.valid) return { recoverable: false, reason: 'record-invalid', validation }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const expired = nowMs >= Number(record.expiresAtMs)
  const ownerState = probeOwnerProcess(record, options)
  return {
    recoverable: expired && ownerState === 'dead',
    reason: !expired ? 'not-expired' : (ownerState === 'dead' ? 'expired-dead-owner' : `owner-${ownerState}`),
    expired,
    ownerState,
    validation
  }
}

function buildGrokSessionPrivateOwner(input = {}) {
  const pluginData = path.resolve(String(input.pluginData || ''))
  if (!String(input.pluginData || '').trim()) {
    throw Object.assign(new Error('GROK_SESSION_PRIVATE_ROOT_INVALID'), { code: 'GROK_SESSION_PRIVATE_ROOT_INVALID' })
  }
  const sessionId = String(input.sessionId || '').trim()
  const nonce = String(input.nonce || crypto.randomBytes(24).toString('hex'))
  const ownerToken = String(input.ownerToken || crypto.randomBytes(32).toString('hex'))
  if (!nonce || !ownerToken) {
    throw Object.assign(new Error('GROK_SESSION_PRIVATE_OWNER_INVALID'), { code: 'GROK_SESSION_PRIVATE_OWNER_INVALID' })
  }
  const ownerId = crypto.createHash('sha256')
    .update(`${sessionId || '<missing-session>'}\0${nonce}`)
    .digest('hex')
    .slice(0, 40)
  const privateRoot = path.join(pluginData, 'private-sessions')
  const ownerRoot = path.join(privateRoot, ownerId)
  const stampPath = path.join(ownerRoot, 'session.json')
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
  const ttlMs = Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : 24 * 60 * 60 * 1000
  return {
    schemaVersion: SESSION_PRIVATE_SCHEMA_VERSION,
    ownerId,
    ownerToken,
    ownerTokenDigest: tokenDigest(ownerToken),
    privateRoot,
    ownerRoot,
    stampPath,
    sessionBindingDigest: tokenDigest(sessionId || '<missing-session>'),
    sessionIdPresent: Boolean(sessionId),
    nonceDigest: tokenDigest(nonce),
    state: 'active',
    pid: Number.isInteger(input.pid) && input.pid > 0 ? input.pid : process.pid,
    hostname: String(input.hostname || os.hostname()),
    cwd: path.resolve(String(input.cwd || process.cwd())),
    workspaceRoot: input.workspaceRoot ? path.resolve(String(input.workspaceRoot)) : null,
    createdAt: new Date(nowMs).toISOString(),
    createdAtMs: nowMs,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    expiresAtMs: nowMs + ttlMs,
    cleanupPolicy: 'expired-dead-owner-only',
    note: 'SessionStart cannot inject PC0; models must still emit entry-check. Prefer devcodex grok for Full kernel.'
  }
}

function validateGrokSessionPrivateOwner(record, expectedPluginData) {
  const errors = []
  if (!record || typeof record !== 'object') return { valid: false, errors: ['record-invalid'] }
  if (record.schemaVersion !== SESSION_PRIVATE_SCHEMA_VERSION) errors.push('schema-version-invalid')
  if (!OWNER_ID_RE.test(String(record.ownerId || ''))) errors.push('owner-id-invalid')
  if (!record.ownerToken || tokenDigest(record.ownerToken) !== record.ownerTokenDigest) errors.push('owner-token-invalid')
  if (!/^[a-f0-9]{64}$/.test(String(record.sessionBindingDigest || ''))) errors.push('session-binding-invalid')
  if (!/^[a-f0-9]{64}$/.test(String(record.nonceDigest || ''))) errors.push('nonce-invalid')
  if (record.state !== 'active') errors.push('state-invalid')
  if (!Number.isInteger(record.pid) || record.pid <= 0) errors.push('pid-invalid')
  if (!Number.isFinite(Number(record.expiresAtMs))) errors.push('expiry-invalid')
  try {
    const expectedPrivateRoot = path.join(path.resolve(String(expectedPluginData || path.dirname(record.privateRoot))), 'private-sessions')
    if (!samePath(record.privateRoot, expectedPrivateRoot)) errors.push('private-root-mismatch')
    if (!isPathInside(record.privateRoot, record.ownerRoot)) errors.push('owner-root-escape')
    if (!isPathInside(record.ownerRoot, record.stampPath)) errors.push('stamp-path-escape')
    if (path.basename(record.ownerRoot).toLowerCase() !== String(record.ownerId || '').toLowerCase()) {
      errors.push('owner-root-identity-mismatch')
    }
  } catch {
    errors.push('path-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function classifyGrokSessionPrivateRecovery(record, options = {}) {
  const validation = validateGrokSessionPrivateOwner(record, options.pluginData)
  if (!validation.valid) return { recoverable: false, reason: 'record-invalid', validation }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const expired = nowMs >= Number(record.expiresAtMs)
  const ownerState = probeOwnerProcess(record, options)
  return {
    recoverable: expired && ownerState === 'dead',
    reason: !expired ? 'not-expired' : (ownerState === 'dead' ? 'expired-dead-owner' : `owner-${ownerState}`),
    expired,
    ownerState,
    validation
  }
}

module.exports = {
  PRIVATE_TEMP_SCHEMA_VERSION,
  SESSION_PRIVATE_SCHEMA_VERSION,
  buildGrokSessionPrivateOwner,
  buildPrivateTempOwnerRecord,
  classifyGrokSessionPrivateRecovery,
  classifyPrivateTempRecovery,
  isPathInside,
  probeOwnerProcess,
  samePath,
  tokenDigest,
  validateGrokSessionPrivateOwner,
  validatePrivateTempOwnerRecord
}
