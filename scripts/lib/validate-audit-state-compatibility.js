'use strict'

const CURRENT_AUDIT_SESSION_SCHEMAS = new Set([
  'AuditSessionStateV1',
  'AuditSessionStateV2'
])

const LEGACY_AUDIT_SCHEMAS = new Set([
  'AuditStateV1'
])

const CLASSIFICATION_KEYS = Object.freeze([
  'currentSession',
  'legacyAuditReadOnly',
  'nonAudit',
  'unsupportedCurrentSession',
  'invalid'
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function looksLikeUnversionedLegacyAuditState(value) {
  if (!isRecord(value) || value.schemaVersion !== undefined) return false
  if (typeof value.sessionId !== 'string' || !value.sessionId.trim()) return false
  if (typeof value.state !== 'string' || !value.state.trim()) return false
  return Array.isArray(value.findings) ||
    Number.isInteger(value.round) ||
    isRecord(value.target) ||
    Array.isArray(value.regressionProbes)
}

function classifyAuditStateDocument(value) {
  if (!isRecord(value)) {
    return {
      kind: 'invalid',
      schemaVersion: null,
      reason: 'document-must-be-an-object'
    }
  }

  const schemaVersion = typeof value.schemaVersion === 'string'
    ? value.schemaVersion.trim()
    : ''

  if (CURRENT_AUDIT_SESSION_SCHEMAS.has(schemaVersion)) {
    return { kind: 'currentSession', schemaVersion, reason: 'supported-current-schema' }
  }
  if (/^AuditSessionStateV\d+$/u.test(schemaVersion)) {
    return { kind: 'unsupportedCurrentSession', schemaVersion, reason: 'unsupported-current-schema' }
  }
  if (LEGACY_AUDIT_SCHEMAS.has(schemaVersion)) {
    return { kind: 'legacyAuditReadOnly', schemaVersion, reason: 'recognized-legacy-schema' }
  }
  if (!schemaVersion && looksLikeUnversionedLegacyAuditState(value)) {
    return { kind: 'legacyAuditReadOnly', schemaVersion: null, reason: 'recognized-unversioned-legacy-shape' }
  }
  return {
    kind: 'nonAudit',
    schemaVersion: schemaVersion || null,
    reason: schemaVersion ? 'other-schema' : 'not-an-audit-state-shape'
  }
}

function parseAndClassifyAuditStateDocument(text) {
  let value
  try {
    value = JSON.parse(String(text))
  } catch (error) {
    return {
      value: null,
      classification: {
        kind: 'invalid',
        schemaVersion: null,
        reason: 'invalid-json',
        detail: String(error && error.message ? error.message : error)
      }
    }
  }
  return { value, classification: classifyAuditStateDocument(value) }
}

function buildAuditStateCompatibilityReceipt(classifications) {
  const counts = Object.fromEntries(CLASSIFICATION_KEYS.map(key => [key, 0]))
  for (const item of classifications || []) {
    const kind = item && item.kind
    if (Object.hasOwn(counts, kind)) counts[kind] += 1
  }
  return {
    schemaVersion: 'AuditStateCompatibilityReceiptV1',
    totalFiles: Object.values(counts).reduce((sum, count) => sum + count, 0),
    counts,
    strictCurrentCount: counts.currentSession,
    readOnlyLegacyCount: counts.legacyAuditReadOnly,
    skippedNonAuditCount: counts.nonAudit,
    errorCount: counts.unsupportedCurrentSession + counts.invalid
  }
}

module.exports = {
  CURRENT_AUDIT_SESSION_SCHEMAS,
  LEGACY_AUDIT_SCHEMAS,
  buildAuditStateCompatibilityReceipt,
  classifyAuditStateDocument,
  looksLikeUnversionedLegacyAuditState,
  parseAndClassifyAuditStateDocument
}
