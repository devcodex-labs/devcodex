'use strict'

const assert = require('assert')
const {
  CANONICAL_SUMMARY_TYPES,
  validateSummaryType,
  validateAllocateIntent,
  assertSummaryType,
  assertAllocateIntent
} = require('./lib/summary-type-canon.js')

function testCanonicalPass() {
  for (const type of CANONICAL_SUMMARY_TYPES) {
    const r = validateSummaryType(type)
    assert.strictEqual(r.ok, true, type)
    assert.strictEqual(r.normalized, type)
  }
  assert.strictEqual(assertSummaryType('analyze+fix'), 'analyze+fix')
  assert.strictEqual(assertSummaryType('DEV'), 'dev')
  assert.strictEqual(assertSummaryType('Self-Fix+Audit'), 'self-fix+audit')
}

function testCanonicalFail() {
  const cases = [
    ['', 'SUMMARY_TYPE_EMPTY'],
    ['ops', 'SUMMARY_TYPE_NON_CANONICAL'],
    ['fix/ledger', 'SUMMARY_TYPE_SLASH'],
    ['audit/ECR', 'SUMMARY_TYPE_SLASH'],
    ['release+dev', 'SUMMARY_TYPE_NON_CANONICAL'],
    ['self-fix+governance-record', 'SUMMARY_TYPE_NON_CANONICAL'],
    ['✅', 'SUMMARY_TYPE_NON_CANONICAL'],
    ['analyze fix', 'SUMMARY_TYPE_WHITESPACE']
  ]
  for (const [input, code] of cases) {
    const r = validateSummaryType(input)
    assert.strictEqual(r.ok, false, String(input))
    assert.strictEqual(r.errorCode, code, String(input))
    assert.throws(() => assertSummaryType(input), err => err.code === code)
  }
}

function testAllocate() {
  assert.strictEqual(assertAllocateIntent(undefined), 'unspecified')
  assert.strictEqual(assertAllocateIntent(''), 'unspecified')
  assert.strictEqual(assertAllocateIntent('unspecified'), 'unspecified')
  assert.strictEqual(assertAllocateIntent('analyze'), 'analyze')
  assert.strictEqual(assertAllocateIntent('fix+dev'), 'fix+dev')
  const bad = validateAllocateIntent('ops')
  assert.strictEqual(bad.ok, false)
  assert.strictEqual(bad.errorCode, 'SUMMARY_TYPE_NON_CANONICAL')
}

function main() {
  testCanonicalPass()
  testCanonicalFail()
  testAllocate()
  console.log('test-summary-type-canon: PASS')
}

main()
