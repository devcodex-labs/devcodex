'use strict'

const crypto = require('crypto')
const DIGEST = /^[a-f0-9]{64}$/

function currentStateRecoveryDigest(value) {
  const semantic = { ...value }
  delete semantic.recoveryDigest
  return crypto.createHash('sha256').update(JSON.stringify(semantic)).digest('hex')
}

function validateCurrentStateRecoveryReceipt(value, expected = {}) {
  const errors = []
  const projectScope = value?.schemaVersion === 'TaskOperationCurrentReportStateReceiptV2' &&
    value.scope === 'project' && value.taskId === null && typeof value.project === 'string' && value.project.trim().length > 0
  const formalScope = value?.schemaVersion === 'TaskOperationCurrentReportStateReceiptV1' &&
    /^[a-f0-9-]{36}$/.test(String(value.taskId || ''))
  if (!value || (!projectScope && !formalScope) ||
      value.resolution !== 'accept-current-report-state' || value.historicalEffect !== 'unknown' ||
      value.mutationAuthority !== false || !String(value.operationId || '') ||
      !Number.isFinite(Date.parse(value.observedAt))) errors.push('current-report-recovery-shape')
  for (const key of ['priorRecordDigest', 'projectRootIdentityDigest', 'ingressEnvelopeDigest', 'hostSessionDigest']) {
    if (!DIGEST.test(String(value?.[key] || ''))) errors.push(`current-report-recovery-${key}`)
  }
  const entries = value?.entries
  const entryList = Array.isArray(entries) ? entries : []
  if (!Array.isArray(entries) || !entries.length || entries.length > 2 || entries.some(entry =>
    !entry || !String(entry.path || '') || !DIGEST.test(String(entry.sha256 || '')) ||
    !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 256 * 1024) ||
    new Set(entryList.map(entry => entry?.path)).size !== entryList.length) errors.push('current-report-recovery-entries')
  for (const key of ['operationId', 'priorRecordDigest', 'taskId', 'project', 'projectRootIdentityDigest']) {
    if (Object.hasOwn(expected, key) && value?.[key] !== expected[key]) errors.push(`current-report-recovery-${key}-mismatch`)
  }
  if (!DIGEST.test(String(value?.recoveryDigest || '')) ||
      currentStateRecoveryDigest(value) !== value?.recoveryDigest) errors.push('current-report-recovery-digest')
  return { valid: errors.length === 0, errors }
}

module.exports = { currentStateRecoveryDigest, validateCurrentStateRecoveryReceipt }
