'use strict'

const crypto = require('crypto')

const CONTENT_IDENTITY_SCHEMA = 'ContentIdentityV1'
const CONTENT_IDENTITY_ALGORITHM = 'sha256'

class ContentIdentityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ContentIdentityError'
    this.code = code
  }
}

function normalizeSourceKey(value) {
  const sourceKey = String(value || '').normalize('NFKC').trim().replace(/\\/g, '/')
  if (!sourceKey) throw new ContentIdentityError('CONTENT_SOURCE_REQUIRED', 'sourceKey is required')
  return sourceKey
}

function normalizeCanonicalValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ContentIdentityError('CONTENT_NON_FINITE_NUMBER', 'canonical JSON does not allow non-finite numbers')
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== 'object') {
    throw new ContentIdentityError('CONTENT_UNSUPPORTED_VALUE', `canonical JSON does not support ${typeof value}`)
  }
  if (seen.has(value)) throw new ContentIdentityError('CONTENT_CYCLE', 'canonical JSON does not allow cycles')
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map(item => normalizeCanonicalValue(item, seen))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ContentIdentityError('CONTENT_UNSUPPORTED_OBJECT', 'canonical JSON only accepts plain objects')
    }
    const out = {}
    for (const key of Object.keys(value).sort((left, right) => (left < right ? -1 : (left > right ? 1 : 0)))) {
      out[key] = normalizeCanonicalValue(value[key], seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
}

/** Return deterministic UTF-8 JSON; timestamps and invocation data must be removed by the caller. */
function stableStringify(value) {
  return JSON.stringify(normalizeCanonicalValue(value))
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  throw new ContentIdentityError('CONTENT_BYTES_REQUIRED', 'content must be a string, Buffer, or Uint8Array')
}

function sha256(value) {
  return crypto.createHash(CONTENT_IDENTITY_ALGORITHM).update(toBuffer(value)).digest('hex')
}

/** Build a stable identity for one observable byte sequence. */
function buildContentIdentity({ sourceKey, content, contractVersion = '1' }) {
  const bytes = toBuffer(content)
  return Object.freeze({
    schemaVersion: CONTENT_IDENTITY_SCHEMA,
    algorithm: CONTENT_IDENTITY_ALGORITHM,
    sourceKey: normalizeSourceKey(sourceKey),
    contractVersion: String(contractVersion || '1'),
    digest: sha256(bytes),
    bytes: bytes.length
  })
}

function buildJsonContentIdentity({ sourceKey, value, contractVersion = '1' }) {
  const canonicalJson = stableStringify(value)
  return {
    identity: buildContentIdentity({ sourceKey, content: canonicalJson, contractVersion }),
    canonicalJson
  }
}

function validateContentIdentity(value) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push('identity must be an object')
  else {
    if (value.schemaVersion !== CONTENT_IDENTITY_SCHEMA) errors.push(`schemaVersion must be ${CONTENT_IDENTITY_SCHEMA}`)
    if (value.algorithm !== CONTENT_IDENTITY_ALGORITHM) errors.push(`algorithm must be ${CONTENT_IDENTITY_ALGORITHM}`)
    if (!String(value.sourceKey || '').trim()) errors.push('sourceKey is required')
    if (!/^[a-f0-9]{64}$/.test(String(value.digest || ''))) errors.push('digest must be lowercase sha256 hex')
    if (!Number.isInteger(value.bytes) || value.bytes < 0) errors.push('bytes must be a non-negative integer')
    if (!String(value.contractVersion || '').trim()) errors.push('contractVersion is required')
  }
  return { valid: errors.length === 0, errors }
}

function matchesContentIdentity(identity, content) {
  const validation = validateContentIdentity(identity)
  if (!validation.valid) return false
  const bytes = toBuffer(content)
  return identity.bytes === bytes.length && identity.digest === sha256(bytes)
}

module.exports = {
  CONTENT_IDENTITY_ALGORITHM,
  CONTENT_IDENTITY_SCHEMA,
  ContentIdentityError,
  buildContentIdentity,
  buildJsonContentIdentity,
  matchesContentIdentity,
  normalizeCanonicalValue,
  normalizeSourceKey,
  sha256,
  stableStringify,
  validateContentIdentity
}
