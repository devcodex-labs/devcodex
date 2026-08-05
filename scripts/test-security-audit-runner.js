#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { runAuditWithBoundedRecheck } = require('./lib/security-audit-runner')

function payload(ids = []) {
  const vulnerabilities = Object.fromEntries(ids.map((id, index) => [
    `package-${index}`,
    { via: [{ url: `https://github.com/advisories/${id}` }] }
  ]))
  return {
    vulnerabilities,
    metadata: { vulnerabilities: { total: ids.length, high: ids.length } }
  }
}

function result(body, status = 0) {
  return { status, stdout: JSON.stringify(body), stderr: '', error: null }
}

let attempt = 0
const transportRecovery = runAuditWithBoundedRecheck({
  registry: 'https://registry.npmjs.org',
  cwd: '/fixture/root',
  expectedAdvisories: [],
  now: () => '2026-08-05T04:33:43.000Z',
  runAttempt: () => ++attempt === 1
    ? { status: null, stdout: '', stderr: 'socket reset', error: { code: 'ECONNRESET' } }
    : result(payload())
})
assert.strictEqual(transportRecovery.evidence.attemptCount, 2)
assert.strictEqual(transportRecovery.evidence.attempts[0].classification, 'transport-error')
assert.strictEqual(transportRecovery.evidence.attempts[0].errorCode, 'ECONNRESET')
assert.match(transportRecovery.evidence.attempts[1].stdoutDigest, /^[a-f0-9]{64}$/)

attempt = 0
const emptyRecovery = runAuditWithBoundedRecheck({
  registry: 'https://registry.npmjs.org',
  cwd: '/fixture/website',
  expectedAdvisories: ['GHSA-qwww-vcr4-c8h2'],
  runAttempt: () => ++attempt < 3 ? result(payload()) : result(payload(['GHSA-qwww-vcr4-c8h2']))
})
assert.strictEqual(emptyRecovery.evidence.attemptCount, 3)
assert.deepStrictEqual(emptyRecovery.evidence.attempts.map(item => item.classification), [
  'inconsistent-empty-advisories',
  'inconsistent-empty-advisories',
  'authoritative-response'
])

attempt = 0
const persistentDifference = runAuditWithBoundedRecheck({
  registry: 'https://registry.npmjs.org',
  cwd: '/fixture/website',
  expectedAdvisories: ['GHSA-qwww-vcr4-c8h2'],
  runAttempt: () => {
    attempt += 1
    return result(payload(['GHSA-other-current-result']))
  }
})
assert.strictEqual(attempt, 1, 'a persistent non-empty advisory difference must not be retried or hidden')
assert.deepStrictEqual(persistentDifference.evidence.attempts[0].actualAdvisories, ['GHSA-other-current-result'])

assert.throws(
  () => runAuditWithBoundedRecheck({
    registry: 'https://registry.npmjs.org',
    cwd: '/fixture/website',
    expectedAdvisories: ['GHSA-qwww-vcr4-c8h2'],
    runAttempt: () => result(payload())
  }),
  error => error?.code === 'SECURITY_AUDIT_RECHECK_EXHAUSTED' &&
    error.evidence?.attemptCount === 3 &&
    error.evidence?.attempts.every(item => item.rawStdout.includes('vulnerabilities'))
)

console.log('✓ security audit bounded recheck and fail-closed evidence tests passed')
