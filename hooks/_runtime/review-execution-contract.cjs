'use strict'

const crypto = require('crypto')

const WORKFLOWS = new Set(['dev', 'fix', 'audit', 'analyze', 'self-fix', 'chat'])
const STAGES = new Set(['entry', 'pre-confirmation', 'post-confirmation', 'implementation', 'ecr', 'audit', 'release'])
const RISK_CLASSES = new Set(['low', 'normal', 'high', 'critical', 'security', 'release'])
const HIGH_RISK_FLAGS = new Set(['control-plane', 'public-contract', 'multi-module', 'multi-source', 'security', 'release'])
const RECEIPT_RESULTS = new Set(['passed', 'failed', 'inconclusive'])
const FRESHNESS_FIELDS = [
  'planId', 'candidateDigest', 'stage', 'scopeDigest', 'dimension', 'claim', 'lens',
  'ruleVersion', 'skillVersion', 'probeVersion', 'impactGraphDigest', 'environmentDigest',
  'intentDigest', 'riskDigest', 'dependencyDigest', 'consumerDigest'
]

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function textList(value) {
  return Array.isArray(value) && value.every(text)
}

function riskDigest(risk) {
  return digest({ class: risk.class, flags: [...(risk.flags || [])].sort() })
}

function scopeDigest(changedSet, affectedClosure) {
  return digest({ changedSet: [...changedSet].sort(), affectedClosure: [...affectedClosure].sort() })
}

function selectReviewClass(input) {
  const risk = input?.risk || {}
  const flags = Array.isArray(risk.flags) ? risk.flags : []
  if (!WORKFLOWS.has(input?.workflow) || !STAGES.has(input?.stage) || !RISK_CLASSES.has(risk.class) || flags.some(flag => !text(flag))) {
    return { valid: false, reviewClass: 'R4', fullRequired: true, reason: 'unknown-routing-input' }
  }
  if (input.workflow === 'chat' && input.stage === 'entry' && (input.changedSet || []).length === 0) {
    return { valid: true, reviewClass: 'R0', fullRequired: false, reason: 'chat-no-mutation' }
  }
  if (['security', 'release'].includes(risk.class) || input.stage === 'release' || input.claims?.includes('full')) {
    return { valid: true, reviewClass: 'R4', fullRequired: true, reason: 'full-security-release' }
  }
  if (['high', 'critical'].includes(risk.class) || flags.some(flag => HIGH_RISK_FLAGS.has(flag))) {
    return { valid: true, reviewClass: 'R3', fullRequired: false, reason: 'impact-closed-high-risk' }
  }
  const changedCount = (input.changedSet || []).length
  const affectedCount = (input.affectedClosure || []).length
  if (['post-confirmation', 'ecr', 'audit'].includes(input.stage) || changedCount > 2 || affectedCount > changedCount) {
    return { valid: true, reviewClass: 'R2', fullRequired: false, reason: 'standard-related-closure' }
  }
  return { valid: true, reviewClass: 'R1', fullRequired: false, reason: 'lightweight-bounded' }
}

/**
 * Builds a candidate-bound review plan. Invalid or unknown routing inputs fail closed to R4.
 * @param {Record<string, unknown>} input Review plan inputs.
 * @returns {Record<string, unknown>} ReviewExecutionPlanV1.
 */
function createReviewExecutionPlan(input) {
  const errors = []
  const routing = selectReviewClass(input)
  for (const field of ['userIntent', 'candidateDigest']) if (!text(input?.[field])) errors.push(`${field}-required`)
  for (const field of ['changedSet', 'affectedClosure', 'claims', 'dimensions', 'freshEvidence', 'staleEvidence', 'exclusions']) {
    if (!textList(input?.[field])) errors.push(`${field}-invalid`)
  }
  const changedSet = textList(input?.changedSet) ? [...new Set(input.changedSet)] : []
  const affectedClosure = textList(input?.affectedClosure) ? [...new Set(input.affectedClosure)] : []
  const affected = new Set(affectedClosure)
  if (changedSet.some(file => !affected.has(file))) errors.push('changed-set-outside-affected-closure')
  if (!routing.valid) errors.push(routing.reason)
  if ((input?.claims || []).length === 0 && input?.workflow !== 'chat') errors.push('claims-required')
  if ((input?.dimensions || []).length === 0 && input?.workflow !== 'chat') errors.push('dimensions-required')

  const requiredZeroFindingRounds = routing.reviewClass === 'R4'
    ? 3
    : (input?.workflow === 'audit' || input?.workflow === 'analyze') ? 2 : routing.reviewClass === 'R0' ? 0 : 1
  const core = {
    schemaVersion: 'ReviewExecutionPlanV1',
    workflow: input?.workflow || 'unknown',
    stage: input?.stage || 'unknown',
    userIntent: input?.userIntent || '',
    intentDigest: digest(input?.userIntent || ''),
    candidateDigest: input?.candidateDigest || '',
    changedSet,
    affectedClosure,
    scopeDigest: scopeDigest(changedSet, affectedClosure),
    risk: input?.risk || { class: 'unknown', flags: [] },
    riskDigest: routing.valid ? riskDigest(input.risk) : digest(input?.risk || {}),
    claims: [...new Set(input?.claims || [])],
    dimensions: [...new Set(input?.dimensions || [])],
    freshEvidence: [...new Set(input?.freshEvidence || [])],
    staleEvidence: [...new Set(input?.staleEvidence || [])],
    reviewClass: routing.reviewClass,
    exclusions: input?.exclusions || [],
    escalation: {
      fullRequired: routing.fullRequired || errors.length > 0,
      reason: errors.length ? errors[0] : routing.reason,
      onMismatch: 'full-required'
    },
    exit: {
      requiredZeroFindingRounds,
      requireIndependentEvidence: ['R3', 'R4'].includes(routing.reviewClass),
      requireNegativeEvidence: !['R0', 'R1'].includes(routing.reviewClass),
      requireFallbackEvidence: ['R3', 'R4'].includes(routing.reviewClass),
      requireDirtyBoundaryMatch: routing.reviewClass !== 'R0'
    },
    validation: { valid: errors.length === 0, errors }
  }
  return { ...core, planId: `review-plan-${digest(core)}` }
}

function createReviewEvidenceReceipt(input) {
  const errors = []
  for (const field of FRESHNESS_FIELDS) if (!text(input?.[field])) errors.push(`${field}-required`)
  for (const field of ['command', 'environment', 'runId']) if (!text(input?.[field])) errors.push(`${field}-required`)
  if (!RECEIPT_RESULTS.has(input?.result)) errors.push('result-invalid')
  if (!textList(input?.evidenceRefs)) errors.push('evidence-refs-invalid')
  const core = {
    schemaVersion: 'ReviewEvidenceReceiptV1',
    ...Object.fromEntries(FRESHNESS_FIELDS.map(field => [field, input?.[field] || ''])),
    command: input?.command || '',
    environment: input?.environment || '',
    runId: input?.runId || '',
    result: input?.result || 'inconclusive',
    evidenceRefs: input?.evidenceRefs || [],
    blockerCount: Number.isInteger(input?.blockerCount) ? input.blockerCount : 0,
    openCount: Number.isInteger(input?.openCount) ? input.openCount : 0,
    generatedAt: input?.generatedAt || null,
    reuseEligibility: errors.length === 0 && input?.result === 'passed' && (input?.blockerCount || 0) === 0 && (input?.openCount || 0) === 0,
    validation: { valid: errors.length === 0, errors }
  }
  return { ...core, receiptDigest: digest(core) }
}

function evaluateReceiptFreshness(receipt, binding) {
  const reasons = []
  if (!receipt?.validation?.valid) reasons.push('receipt-invalid')
  if (receipt?.result !== 'passed') reasons.push('receipt-not-passed')
  if (!receipt?.reuseEligibility) reasons.push('receipt-not-reusable')
  for (const field of FRESHNESS_FIELDS) {
    if (!text(binding?.[field]) || receipt?.[field] !== binding[field]) reasons.push(`${field}-changed`)
  }
  return { fresh: reasons.length === 0, status: reasons.length ? 'stale' : 'fresh', reasons }
}

function stableReceiptSample(receipts) {
  const candidates = (receipts || []).filter(item => text(item?.receiptDigest))
    .slice().sort((a, b) => digest(a.receiptDigest).localeCompare(digest(b.receiptDigest)))
  const count = Math.min(candidates.length, Math.min(20, Math.max(3, Math.ceil(candidates.length * 0.05))))
  return candidates.slice(0, count)
}

function evaluateStableReceiptOracle(receipts, replayByDigest) {
  const sample = stableReceiptSample(receipts)
  const mismatches = sample.filter(receipt => replayByDigest?.[receipt.receiptDigest] !== receipt.result)
  return {
    status: mismatches.length ? 'full-required' : 'passed',
    sampleCount: sample.length,
    sampledReceiptDigests: sample.map(item => item.receiptDigest),
    mismatches: mismatches.map(item => item.receiptDigest)
  }
}

function exclusionIsBounded(item) {
  return item && text(item.item) && text(item.reason) && text(item.authority) && text(item.upgradeCondition)
}

function evaluateEvidenceSaturation(plan, input) {
  const reasons = []
  if (!plan?.validation?.valid) reasons.push('plan-invalid')
  const receipts = input?.receipts || []
  const freshReceipts = receipts.filter(receipt => {
    const binding = Object.fromEntries(FRESHNESS_FIELDS.map(field => [field, receipt[field]]))
    binding.planId = plan?.planId
    binding.candidateDigest = plan?.candidateDigest
    binding.stage = plan?.stage
    binding.scopeDigest = plan?.scopeDigest
    binding.intentDigest = plan?.intentDigest
    binding.riskDigest = plan?.riskDigest
    return evaluateReceiptFreshness(receipt, binding).fresh
  })
  const dimensions = new Set(freshReceipts.map(item => item.dimension))
  const claims = new Set(freshReceipts.map(item => item.claim))
  const evidenceRefs = new Set(freshReceipts.flatMap(item => item.evidenceRefs || []))
  const missingDimensions = (plan?.dimensions || []).filter(item => !dimensions.has(item))
  const missingClaims = (plan?.claims || []).filter(item => !claims.has(item))
  const missingEvidence = (plan?.freshEvidence || []).filter(item => !evidenceRefs.has(item))
  if (missingDimensions.length) reasons.push('dimension-evidence-missing')
  if (missingClaims.length) reasons.push('claim-evidence-missing')
  if (missingEvidence.length) reasons.push('fresh-evidence-missing')
  if ((plan?.staleEvidence || []).length) reasons.push('declared-stale-evidence-remains')
  const unreviewed = input?.unreviewedRelatedSet || []
  const unbounded = unreviewed.filter(item => !exclusionIsBounded(item))
  if (unbounded.length) reasons.push('unreviewed-related-set-unbounded')
  if ((input?.openCount || 0) > 0) reasons.push('open-findings-remain')
  if ((input?.blockerCount || 0) > 0) reasons.push('blockers-remain')
  if (plan?.exit?.requireIndependentEvidence && input?.independentEvidencePassed !== true) reasons.push('independent-evidence-missing')
  if (plan?.exit?.requireNegativeEvidence && input?.negativeEvidencePassed !== true) reasons.push('negative-evidence-missing')
  if (plan?.exit?.requireFallbackEvidence && input?.fallbackEvidencePassed !== true) reasons.push('fallback-evidence-missing')
  if (plan?.exit?.requireDirtyBoundaryMatch && input?.dirtyBoundaryMatches !== true) reasons.push('dirty-boundary-mismatch')
  if ((input?.zeroFindingRounds || 0) < (plan?.exit?.requiredZeroFindingRounds || 0)) reasons.push('zero-finding-rounds-insufficient')
  if (input?.oracle?.status === 'full-required') reasons.push('stable-oracle-mismatch')
  return {
    schemaVersion: 'EvidenceSaturationResultV1',
    status: reasons.length ? 'full-required' : 'passed',
    reasons,
    freshReceiptDigests: freshReceipts.map(item => item.receiptDigest),
    missingDimensions,
    missingClaims,
    missingEvidence,
    boundedExclusionCount: unreviewed.length - unbounded.length,
    unboundedRelatedCount: unbounded.length
  }
}

function createReviewStateSnapshot(plan, input) {
  const saturation = input?.saturation
  const core = {
    schemaVersion: 'ReviewStateSnapshotV1',
    planId: plan?.planId || '',
    candidateDigest: plan?.candidateDigest || '',
    stage: plan?.stage || 'unknown',
    reviewClass: plan?.reviewClass || 'R4',
    receiptDigests: [...new Set(input?.receiptDigests || [])].sort(),
    open: input?.open || 0,
    blocker: input?.blocker || 0,
    stale: input?.stale || 0,
    unreviewed: input?.unreviewed || 0,
    saturation: saturation?.status || 'full-required',
    dirtyBoundary: input?.dirtyBoundary || 'unverified',
    nextAction: saturation?.status === 'passed' && !input?.open && !input?.blocker && !input?.stale && !input?.unreviewed
      ? 'accept'
      : 'full-required'
  }
  return { ...core, snapshotDigest: digest(core) }
}

function projectReviewState(snapshot, surface) {
  const allowed = new Set(['checklist', 'report', 'memory', 'progress', 'final'])
  if (!allowed.has(surface)) throw new Error(`unsupported review projection surface: ${surface}`)
  return { schemaVersion: 'ReviewStateProjectionV1', surface, snapshotDigest: snapshot.snapshotDigest, state: stableValue(snapshot) }
}

function createStageTiming(input) {
  const fields = ['planning', 'read', 'evidenceExecution', 'reasoning', 'stateMaterialization', 'reporting', 'externalWait']
  const errors = []
  const values = {}
  for (const field of fields) {
    const value = input?.[field]
    if (value === 'N/A') values[field] = 'N/A'
    else if (Number.isFinite(value) && value >= 0) values[field] = value
    else errors.push(`${field}-invalid`)
  }
  if (!text(input?.clockBasis)) errors.push('clock-basis-required')
  const numericTotal = Object.values(values).filter(Number.isFinite).reduce((sum, value) => sum + value, 0)
  if (Number.isFinite(input?.total) && input.total !== numericTotal) errors.push('timing-total-mismatch')
  return {
    schemaVersion: 'StageTimingV1',
    ...values,
    total: numericTotal,
    clockBasis: input?.clockBasis || 'unverified',
    validation: { valid: errors.length === 0, errors }
  }
}

module.exports = {
  FRESHNESS_FIELDS,
  createReviewEvidenceReceipt,
  createReviewExecutionPlan,
  createReviewStateSnapshot,
  createStageTiming,
  evaluateEvidenceSaturation,
  evaluateReceiptFreshness,
  evaluateStableReceiptOracle,
  projectReviewState,
  selectReviewClass,
  stableReceiptSample
}
