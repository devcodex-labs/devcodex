#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  PUBLISHED_RECEIPT_SCHEMA,
  createPublishedArtifactReceiptFromExact,
  evaluatePublishedMetadata,
  queryPublishedMetadata,
  verifyPublishedArtifactReceipt
} = require('./exact-release-artifact')

const ROOT = path.resolve(__dirname, '..')
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8')
const exactReceipt = {
  receiptDigest: 'a'.repeat(64),
  packageName: 'devcodex',
  packageVersion: '9.9.9',
  artifactFile: 'devcodex-9.9.9.tgz',
  bytes: 123,
  sha256: 'b'.repeat(64),
  integrity: 'sha512-fixture',
  npmPack: { shasum: 'c'.repeat(40) },
  candidateHead: 'd'.repeat(40)
}
const matchingMetadata = {
  version: exactReceipt.packageVersion,
  'dist.integrity': exactReceipt.integrity,
  'dist.shasum': exactReceipt.npmPack.shasum,
  'dist.attestations': { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } }
}

const optionalGitHead = evaluatePublishedMetadata(exactReceipt, matchingMetadata)
assert.strictEqual(optionalGitHead.valid, true)
assert.deepStrictEqual(optionalGitHead.warnings, ['published-git-head-missing'])

const mismatchedGitHead = evaluatePublishedMetadata(exactReceipt, {
  ...matchingMetadata,
  gitHead: 'e'.repeat(40)
})
assert.strictEqual(mismatchedGitHead.valid, false)
assert.ok(mismatchedGitHead.errors.includes('published-git-head-mismatch'))

const integrityMismatch = evaluatePublishedMetadata(exactReceipt, {
  ...matchingMetadata,
  'dist.integrity': 'sha512-wrong'
})
assert.strictEqual(integrityMismatch.valid, false)
assert.ok(integrityMismatch.errors.includes('published-integrity-mismatch'))

const provenancePending = evaluatePublishedMetadata(exactReceipt, {
  ...matchingMetadata,
  'dist.attestations': undefined
}, { requireProvenance: false })
assert.strictEqual(provenancePending.valid, true)
assert.ok(provenancePending.warnings.includes('published-provenance-pending'))

const receipt = createPublishedArtifactReceiptFromExact(exactReceipt, {
  publicationStatus: 'published',
  workflowRunId: '123',
  workflowRunAttempt: '1',
  publishedAt: '2026-08-29T00:00:00.000Z'
})
assert.strictEqual(receipt.schemaVersion, PUBLISHED_RECEIPT_SCHEMA)
assert.strictEqual(verifyPublishedArtifactReceipt(receipt, exactReceipt).valid, true)
assert.strictEqual(verifyPublishedArtifactReceipt({ ...receipt, integrity: 'tampered' }, exactReceipt).valid, false)

const missing = queryPublishedMetadata({
  runCommand() {
    const error = new Error('missing')
    error.evidence = { stdout: '', stderr: 'npm error code E404' }
    throw error
  }
}, exactReceipt)
assert.strictEqual(missing.status, 'missing')

const pending = queryPublishedMetadata({
  runCommand() {
    const error = new Error('timeout')
    error.evidence = { stdout: '', stderr: 'network timeout' }
    throw error
  }
}, exactReceipt)
assert.strictEqual(pending.status, 'pending')

const available = queryPublishedMetadata({
  runCommand() { return { stdout: JSON.stringify(matchingMetadata) } }
}, exactReceipt)
assert.strictEqual(available.status, 'available')

assert.match(workflow, /^  qualify:/m)
assert.match(workflow, /^  publish:/m)
assert.match(workflow, /^  finalize:/m)
assert.match(workflow, /workflow_dispatch:[\s\S]*finalize-only/)
assert.strictEqual((workflow.match(/npm publish /g) || []).length, 1)
assert.ok(workflow.indexOf('npm publish ') < workflow.indexOf('mark-published'))
assert.match(workflow, /PublishedArtifactReceiptV1/)
assert.match(workflow, /published-release-\$\{\{ github\.ref_name \}\}/)
assert.match(workflow, /run-id: \$\{\{ inputs\.publish_run_id \}\}/)
assert.match(workflow, /STATUS.*-ne 75/s)
assert.match(workflow, /DELAY=\$\(\(DELAY \* 2\)\)/)

const finalizeSection = workflow.slice(workflow.indexOf('\n  finalize:'))
assert.ok(!finalizeSection.includes('npm publish '), 'finalize-only path must never call npm publish')

console.log('publish workflow replay tests passed')
