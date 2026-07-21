#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  classifyExternalReviewRecapSample,
  missingRequiredFields,
  buildExternalReviewClaimVerificationReceipt
} = require('./lib/external-review-claim-verification')

// Negative: only summary + advice, no claim matrix
const thin = [
  '# Grok 方案审阅复核',
  '',
  '## 结论',
  '总体合理，建议按 Grok 意见修订。',
  '',
  '## 建议',
  '1. 改方案结构',
  '2. 补证据',
  '',
  '外部审阅输入：Grok 报告'
].join('\n')
assert.strictEqual(classifyExternalReviewRecapSample(thin), 'claim-thin')
assert.ok(missingRequiredFields(thin).includes('claimVerificationMatrix'))

// Negative: missing UNVERIFIED boundary field group
const noUnverified = [
  '# 外部审阅复核',
  'inputClaims: C1,C2',
  '## ClaimVerificationMatrix',
  '| claim | evidence |',
  '| C1 | 文件 a |',
  'projectEvidence: repo path ok',
  'verificationStatus: 已验证',
  '采纳：部分采纳',
  '详细报告：[x.md](./x.md)'
].join('\n')
assert.ok(missingRequiredFields(noUnverified).includes('unverifiedBoundaries'))

// Positive: claim-level matrix with disposition, evidence, UNVERIFIED, report link
const ready = [
  '# 外部审阅复核与证据矩阵',
  '',
  '## 输入主张 inputClaims',
  '- C1 架构边界不足',
  '- C2 缺验证命令',
  '',
  '## ClaimVerificationMatrix',
  '| claimId | projectEvidence | verificationStatus | disposition |',
  '| C1 | skills/foo.md L12 | ✅已验证 | 采纳 adoptedIntoTechDesign |',
  '| C2 | 未跑 npm test | ⚠️待验证 / UNVERIFIED | 部分采纳 |',
  '',
  '## 未验证边界 unverifiedBoundaries',
  '- C2 需本轮执行 npm run test:core',
  '',
  '## 证据台账 EvidenceLedger',
  '- command: node scripts/test-core (pending)',
  '',
  '详细报告：[04--报告质量复核与证据矩阵补充.md](./04--报告质量复核与证据矩阵补充.md)'
].join('\n')
assert.strictEqual(classifyExternalReviewRecapSample(ready), 'claim-ready')
assert.deepStrictEqual(missingRequiredFields(ready), [])
const receipt = buildExternalReviewClaimVerificationReceipt(ready)
assert.strictEqual(receipt.passed, true)
assert.strictEqual(receipt.gate, 'ExternalReviewClaimVerificationGate')

// Non-external ordinary report
assert.strictEqual(classifyExternalReviewRecapSample('# 普通开发报告\n完成功能 X'), 'not-external-review')
assert.strictEqual(buildExternalReviewClaimVerificationReceipt('# 普通开发报告').skipReason, 'not-external-review-recap')

// Final reply without detail report link remains thin when external
const noLink = [
  '外部审阅复核摘要',
  'inputClaims: C1',
  'ClaimVerificationMatrix 见上',
  'projectEvidence: path',
  'verificationStatus: 已验证',
  '采纳',
  'unverifiedBoundaries: 无'
].join('\n')
assert.ok(missingRequiredFields(noLink).includes('detailReportLink'))

console.log('external-review-claim-verification tests passed')
