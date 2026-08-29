#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { readValidationManifest } = require('./lib/validation-dag')
const {
  CiValidationPlanError,
  aggregateCiValidation,
  buildCiValidationPlan
} = require('./plan-ci-validation')

const ROOT = path.resolve(__dirname, '..')
const manifest = readValidationManifest(path.join(__dirname, 'validation-manifest.json'))

function plan(changedFiles, options = {}) {
  return buildCiValidationPlan({
    manifest,
    repoRoot: ROOT,
    event: options.event || 'push',
    manualScope: options.manualScope || 'affected',
    head: 'HEAD',
    changedFiles
  })
}

const narrative = plan(['README.md'])
assert.strictEqual(narrative.jobs.affected, false)
assert.strictEqual(narrative.jobs.fullQuality, false)
assert.strictEqual(narrative.jobs.packageBoundary, false)

const affected = plan(['hooks/_runtime/context-read-contract.cjs'])
assert.strictEqual(affected.jobs.impactValidation, true)
assert.strictEqual(affected.jobs.fullQuality, false)
assert.deepStrictEqual(affected.matrix.include.map(item => item.id), ['impact'])
assert.ok(affected.requiredNodeIds.includes('context-read'))

const packagePlan = plan(['scripts/postinstall.js'])
assert.strictEqual(packagePlan.jobs.packageBoundary, true)
assert.ok(packagePlan.impact.affectedBoundaries.includes('package'))

const nightly = plan([], { event: 'schedule' })
assert.strictEqual(nightly.jobs.fullQuality, true)
assert.strictEqual(nightly.matrix.include.length, 5)
assert.ok(nightly.fullReasonCodes.includes('nightly'))

const manualFull = plan([], { event: 'workflow_dispatch', manualScope: 'full' })
assert.strictEqual(manualFull.jobs.fullQuality, true)
assert.ok(manualFull.fullReasonCodes.includes('manual-full'))

const unknown = plan(['unmapped-ci-fixture.bin'])
assert.strictEqual(unknown.jobs.fullQuality, true)
assert.ok(unknown.fullReasonCodes.includes('impact-plan-blocked'))

assert.throws(() => plan([], { event: 'workflow_dispatch', manualScope: 'invalid' }), error =>
  error instanceof CiValidationPlanError && error.code === 'CI_PLAN_MANUAL_SCOPE_INVALID')

const nodeReceiptDigests = Object.fromEntries(affected.requiredNodeIds.map(id => [id, `receipt-${id}`]))
const executionResults = [{
  ok: true,
  data: {
    receipt: {
      receiptId: 'validation-receipt-fixture',
      candidateHead: affected.head,
      terminalStatus: 'completed',
      failedNode: null,
      nodeReceiptDigests
    }
  }
}]
const aggregate = aggregateCiValidation({
  plan: affected,
  jobResults: { plan: 'success', affected: 'success', fullQuality: 'skipped', packageBoundary: 'skipped' },
  executionResults
})
assert.strictEqual(aggregate.status, 'PASS')

const missing = aggregateCiValidation({
  plan: affected,
  jobResults: { plan: 'success', affected: 'success', fullQuality: 'skipped', packageBoundary: 'skipped' },
  executionResults: [{ ...executionResults[0], data: { receipt: { ...executionResults[0].data.receipt, nodeReceiptDigests: {} } } }]
})
assert.strictEqual(missing.status, 'BLOCK')
assert.ok(missing.errors.some(error => error.startsWith('required-node-receipt-missing:')))

console.log('ci validation plan tests passed')
