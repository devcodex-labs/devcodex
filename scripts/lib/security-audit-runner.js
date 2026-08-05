'use strict'

const crypto = require('crypto')

function advisoryIds(payload) {
  const ids = new Set()
  for (const vulnerability of Object.values(payload?.vulnerabilities || {})) {
    for (const via of vulnerability?.via || []) {
      if (!via || typeof via !== 'object' || typeof via.url !== 'string') continue
      const match = via.url.match(/\/(GHSA-[A-Za-z0-9-]+)$/)
      if (match) ids.add(match[1])
    }
  }
  return [...ids].sort()
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

function parseAttempt(result, expectedAdvisories) {
  const rawStdout = String(result?.stdout || '')
  const rawStderr = String(result?.stderr || '')
  if (result?.error || ![0, 1].includes(result?.status)) {
    return {
      classification: 'transport-error',
      retryable: true,
      payload: null,
      actualAdvisories: [],
      error: result?.error?.code || rawStderr || `exit-${result?.status}`
    }
  }
  let payload
  try {
    payload = JSON.parse(rawStdout)
  } catch (error) {
    return {
      classification: 'invalid-json',
      retryable: true,
      payload: null,
      actualAdvisories: [],
      error: error.message
    }
  }
  if (!payload?.metadata?.vulnerabilities || !payload?.vulnerabilities || typeof payload.vulnerabilities !== 'object') {
    return {
      classification: 'invalid-audit-shape',
      retryable: true,
      payload,
      actualAdvisories: advisoryIds(payload),
      error: 'npm audit payload is missing metadata.vulnerabilities or vulnerabilities'
    }
  }
  const actualAdvisories = advisoryIds(payload)
  if (expectedAdvisories.length > 0 && actualAdvisories.length === 0) {
    return {
      classification: 'inconsistent-empty-advisories',
      retryable: true,
      payload,
      actualAdvisories,
      error: `expected advisory evidence for ${expectedAdvisories.join(',')}, received an empty set`
    }
  }
  return {
    classification: 'authoritative-response',
    retryable: false,
    payload,
    actualAdvisories,
    error: null
  }
}

function runAuditWithBoundedRecheck(options = {}) {
  const runAttempt = options.runAttempt
  const expectedAdvisories = [...new Set(options.expectedAdvisories || [])].sort()
  const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 3
  const registry = String(options.registry || '')
  const cwd = String(options.cwd || '')
  const now = options.now || (() => new Date().toISOString())
  if (typeof runAttempt !== 'function') throw new TypeError('runAttempt must be a function')
  if (maxAttempts < 1 || maxAttempts > 3) throw new RangeError('maxAttempts must be between 1 and 3')

  const attempts = []
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runAttempt(attempt)
    const parsed = parseAttempt(result, expectedAdvisories)
    const rawStdout = String(result?.stdout || '')
    const rawStderr = String(result?.stderr || '')
    attempts.push({
      attempt,
      checkedAt: now(),
      registry,
      cwd,
      status: result?.status ?? null,
      errorCode: result?.error?.code || null,
      classification: parsed.classification,
      actualAdvisories: parsed.actualAdvisories,
      stdoutDigest: digest(rawStdout),
      stderrDigest: digest(rawStderr),
      rawStdout,
      rawStderr
    })
    if (!parsed.retryable) {
      return {
        payload: parsed.payload,
        evidence: {
          schemaVersion: 'SecurityAuditRecheckEvidenceV1',
          registry,
          cwd,
          expectedAdvisories,
          attemptCount: attempts.length,
          finalClassification: parsed.classification,
          attempts
        }
      }
    }
  }
  const error = new Error(`SECURITY_AUDIT_RECHECK_EXHAUSTED: ${attempts.at(-1)?.classification || 'unknown'}`)
  error.code = 'SECURITY_AUDIT_RECHECK_EXHAUSTED'
  error.evidence = {
    schemaVersion: 'SecurityAuditRecheckEvidenceV1',
    registry,
    cwd,
    expectedAdvisories,
    attemptCount: attempts.length,
    finalClassification: attempts.at(-1)?.classification || 'unknown',
    attempts
  }
  throw error
}

module.exports = {
  advisoryIds,
  parseAttempt,
  runAuditWithBoundedRecheck
}
