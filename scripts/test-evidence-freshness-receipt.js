#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildClaimEvidenceIndex,
  buildEvidenceFreshnessSummary,
  buildStaleEvidenceLintDecision,
  contentIdentityFromText,
  createEvidenceFreshnessReceipt,
  evaluateEvidenceFreshnessReceipt,
  extractEvidenceRefsFromLine,
  normalizeEvidenceRef
} = require('./lib/evidence-freshness-receipt')

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'evidence-freshness')

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8')
}

const freshText = fixture('fresh-report.md')
const freshIndex = buildClaimEvidenceIndex(freshText, { workflow: 'analyze', surface: 'report', targetId: 'fresh-report.md' })
assert(freshIndex.indexDigest.startsWith('claim-evidence-index-'))
assert(freshIndex.claims.some((claim) => claim.claimClass === 'recommendation'))
assert(freshIndex.claims.some((claim) => claim.evidenceRefs.some((ref) => ref.kind === 'command')))

const verifiedClaim = freshIndex.claims.find((claim) => claim.claimClass === 'verification')
const sourceIdentity = contentIdentityFromText(freshText, { id: 'fresh-report.md' })
const contextIdentity = { id: 'ctx-1', digest: 'ctx-digest-1', planContentId: 'plan-1' }
const receipt = createEvidenceFreshnessReceipt({
  claimId: verifiedClaim.claimId,
  claimDigest: verifiedClaim.claimDigest,
  evidenceRefs: verifiedClaim.evidenceRefs,
  sourceIdentity,
  contextIdentity,
  dependsOn: {
    ruleSetDigest: 'rules-a',
    toolDigest: 'tool-a',
    artifactAnchorDigest: 'artifact-anchor-a',
    finalValidationSummaryDigest: 'final-summary-a'
  },
  observedAt: '2026-07-23T03:30:00.000Z',
  leasePolicy: { mode: 'candidate-bound', ttl: 'PT1H', expiresAt: '2026-07-23T04:30:00.000Z', renewalRequired: false }
})
assert.strictEqual(receipt.validation.valid, true)
assert.strictEqual(receipt.reuseDecision, 'fresh')

const freshEvaluation = evaluateEvidenceFreshnessReceipt(receipt, {
  sourceIdentity,
  contextIdentity,
  dependsOn: {
    ruleSetDigest: 'rules-a',
    toolDigest: 'tool-a',
    artifactAnchorDigest: 'artifact-anchor-a',
    finalValidationSummaryDigest: 'final-summary-a'
  }
}, { now: '2026-07-23T03:45:00.000Z' })
assert.strictEqual(freshEvaluation.reuseDecision, 'fresh')
assert.strictEqual(freshEvaluation.passed, true)

const changedDependency = evaluateEvidenceFreshnessReceipt(receipt, {
  sourceIdentity,
  contextIdentity,
  dependsOn: { ruleSetDigest: 'rules-b' }
}, { now: '2026-07-23T03:45:00.000Z' })
assert.strictEqual(changedDependency.reuseDecision, 'rerun-required')
assert(changedDependency.reasons.includes('ruleSetDigest-changed'))

const expiredLease = evaluateEvidenceFreshnessReceipt(receipt, {
  sourceIdentity,
  contextIdentity,
  dependsOn: { ruleSetDigest: 'rules-a' }
}, { now: '2026-07-23T04:31:00.000Z' })
assert.strictEqual(expiredLease.reuseDecision, 'downgrade-only')
assert(expiredLease.reasons.includes('lease-expired'))

const summaryIndex = buildClaimEvidenceIndex(fixture('summary-only-report.md'), {
  workflow: 'audit',
  surface: 'report',
  targetId: 'summary-only-report.md'
})
const summaryDecision = buildStaleEvidenceLintDecision({
  index: summaryIndex,
  mode: 'warn'
})
assert.strictEqual(summaryDecision.status, 'WARN')
assert.strictEqual(summaryDecision.downgradeRequired.length, 1)

const missingIndex = buildClaimEvidenceIndex(fixture('missing-evidence.md'), {
  workflow: 'audit',
  surface: 'report',
  targetId: 'missing-evidence.md'
})
const missingDecision = buildStaleEvidenceLintDecision({
  index: missingIndex,
  mode: 'enforce'
})
assert.strictEqual(missingDecision.status, 'BLOCK')
assert.strictEqual(missingDecision.claimResults[0].reuseDecision, 'unverifiable')

const anchorReceipt = createEvidenceFreshnessReceipt({
  claimId: 'claim-anchor',
  claimDigest: 'claim-anchor-digest',
  evidenceRefs: [{
    kind: 'artifact-anchor',
    ref: 'artifact-anchor-a',
    anchorDigest: 'artifact-anchor-a',
    contentDigest: 'content-a',
    status: 'fresh'
  }],
  sourceIdentity: { id: 'manifest', digest: 'manifest-a' },
  contextIdentity,
  dependsOn: { artifactAnchorDigest: 'artifact-anchor-a' },
  observedAt: '2026-07-23T03:30:00.000Z',
  leasePolicy: { mode: 'candidate-bound', ttl: null, expiresAt: null, renewalRequired: false }
})
const anchorChanged = evaluateEvidenceFreshnessReceipt(anchorReceipt, {
  sourceIdentity: { id: 'manifest', digest: 'manifest-a' },
  contextIdentity,
  artifactAnchors: { 'artifact-anchor-a': 'content-b' }
})
assert.strictEqual(anchorChanged.reuseDecision, 'rerun-required')
assert(anchorChanged.reasons.includes('artifact-anchor-binding-changed'))

const finalSummaryReceipt = createEvidenceFreshnessReceipt({
  claimId: 'claim-final',
  claimDigest: 'claim-final-digest',
  evidenceRefs: [{
    kind: 'final-validation-summary',
    ref: 'final-validation-summary-a',
    summaryDigest: 'summary-a',
    requireCommandEvidence: true,
    commandEvidence: [{ command: 'npm test', exitCode: 1 }],
    workspaceSyncStatus: 'synced'
  }],
  sourceIdentity: { id: 'final', digest: 'final-a' },
  contextIdentity,
  dependsOn: { finalValidationSummaryDigest: 'summary-a' },
  observedAt: '2026-07-23T03:30:00.000Z',
  leasePolicy: { mode: 'candidate-bound', ttl: null, expiresAt: null, renewalRequired: false }
})
const finalSummaryFailed = evaluateEvidenceFreshnessReceipt(finalSummaryReceipt, {
  sourceIdentity: { id: 'final', digest: 'final-a' },
  contextIdentity,
  dependsOn: { finalValidationSummaryDigest: 'summary-a' }
})
assert.strictEqual(finalSummaryFailed.reuseDecision, 'rerun-required')
assert(finalSummaryFailed.reasons.includes('final-validation-summary-command-failed'))

const refs = extractEvidenceRefsFromLine('已验证：`node scripts/test-evidence-freshness-receipt.js` exitCode 0 and FinalValidationSummaryV1.')
assert(refs.some((ref) => ref.kind === 'command'))
assert(refs.some((ref) => ref.kind === 'final-validation-summary'))
const windowsRef = normalizeEvidenceRef('E:\\Worker\\devcodex\\reports\\fresh.md')
assert.strictEqual(windowsRef.kind, 'file')
assert.strictEqual(windowsRef.ref, 'E:\\Worker\\devcodex\\reports\\fresh.md')

const lint = buildStaleEvidenceLintDecision({
  index: freshIndex,
  receipts: [receipt],
  current: {
    sourceIdentity,
    contextIdentity,
    dependsOn: {
      ruleSetDigest: 'rules-a',
      toolDigest: 'tool-a',
      artifactAnchorDigest: 'artifact-anchor-a',
      finalValidationSummaryDigest: 'final-summary-a'
    }
  },
  mode: 'shadow',
  now: '2026-07-23T03:45:00.000Z'
})
assert(['PASS', 'UNVERIFIED'].includes(lint.status))
assert(buildEvidenceFreshnessSummary(lint).startsWith('EvidenceFreshness:'))

console.log('evidence freshness receipt tests passed')
