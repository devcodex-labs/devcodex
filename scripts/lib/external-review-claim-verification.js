'use strict'

/**
 * ExternalReviewClaimVerificationGate (PF-164)
 * Classifies external-review recap reports: must keep claim-level evidence granularity.
 */

const REQUIRED_FIELD_GROUPS = [
  {
    id: 'inputClaims',
    anyOf: [/inputClaims/i, /输入主张/, /外部主张/, /Claim\s*ID/i, /input claim/i]
  },
  {
    id: 'claimVerificationMatrix',
    anyOf: [/ClaimVerificationMatrix/i, /主张核验矩阵/, /Claim Verification/i, /核验矩阵/]
  },
  {
    id: 'projectEvidence',
    anyOf: [/projectEvidence/i, /项目证据/, /repo path/i, /源码|命令|exitCode|文件路径/]
  },
  {
    id: 'verificationStatus',
    anyOf: [/verificationStatus/i, /验证状态/, /已验证|待验证|UNVERIFIED|未验证/]
  },
  {
    id: 'disposition',
    anyOf: [/采纳|部分采纳|拒绝|adopted|rejected|partial/i, /adoptedIntoRequirement/i, /adoptedIntoTechDesign/i]
  },
  {
    id: 'unverifiedBoundaries',
    anyOf: [/unverifiedBoundaries/i, /未验证边界/, /UNVERIFIED/, /推断边界/]
  },
  {
    id: 'detailReportLink',
    anyOf: [/\[[^\]]+\]\([^)]+\.md\)/, /详细报告|完整报告|确认包/, /reports\//]
  }
]

function matchAny(text, patterns) {
  return patterns.some((re) => re.test(text))
}

function missingRequiredFields(text) {
  const body = String(text || '')
  return REQUIRED_FIELD_GROUPS
    .filter((group) => !matchAny(body, group.anyOf))
    .map((group) => group.id)
}

/**
 * @param {string} sample report markdown or free-text recap
 * @returns {'claim-ready'|'claim-thin'|'not-external-review'}
 */
function classifyExternalReviewRecapSample(sample) {
  const text = String(sample || '')
  const externalCue = /外部审阅|外部审查|Grok|Codex|AI review|review finding|审阅复核|方案审阅|inputClaims|主张核验/i.test(text)
  if (!externalCue) return 'not-external-review'

  const missing = missingRequiredFields(text)
  // Thin: only summary/recommendations without claim matrix granularity
  const thinCue = /(?:^|\n)#+\s*(?:结论|总评|摘要|建议)/m.test(text) &&
    !/ClaimVerificationMatrix|主张核验矩阵|证据台账|EvidenceLedger/i.test(text)
  if (missing.length >= 3 || thinCue) return 'claim-thin'
  if (missing.length === 0) return 'claim-ready'
  // Allow claim-ready when core four present even if one optional weak
  const core = ['inputClaims', 'claimVerificationMatrix', 'projectEvidence', 'verificationStatus', 'disposition']
  const coreMissing = core.filter((id) => missing.includes(id))
  return coreMissing.length === 0 ? 'claim-ready' : 'claim-thin'
}

function buildExternalReviewClaimVerificationReceipt(sample) {
  const classification = classifyExternalReviewRecapSample(sample)
  const missing = missingRequiredFields(sample)
  return {
    schemaVersion: 'ExternalReviewClaimVerificationReceiptV1',
    gate: 'ExternalReviewClaimVerificationGate',
    classification,
    missingFields: missing,
    passed: classification === 'claim-ready' || classification === 'not-external-review',
    skipReason: classification === 'not-external-review' ? 'not-external-review-recap' : null
  }
}

module.exports = {
  REQUIRED_FIELD_GROUPS,
  classifyExternalReviewRecapSample,
  missingRequiredFields,
  buildExternalReviewClaimVerificationReceipt
}
