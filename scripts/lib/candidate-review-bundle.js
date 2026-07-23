'use strict'

const PHASE_RULES = {
  CP1: {
    requiredFields: [
      'phaseKind',
      'CandidateReviewBundleV1',
      'RQMatrix',
      'DomainRealityMatrix',
      'ClaimEvidenceMatrix',
      'EscapeAbsorptionQueue'
    ]
  },
  CP2: {
    requiredFields: [
      'phaseKind',
      'CandidateReviewBundleV1',
      'TDMatrix',
      'BlockerSnapshot',
      'ClaimEvidenceMatrix'
    ]
  }
}

const FIELD_PATTERNS = {
  phaseKind: [/phaseKind\s*[:=]\s*CP[12]/i, /阶段类型\s*[:：]\s*CP[12]/, /phase\s*[:=]\s*CP[12]/i],
  CandidateReviewBundleV1: [/CandidateReviewBundleV1/i, /候选审查包/],
  RQMatrix: [/RQMatrix/i, /RQ-1\s*~\s*RQ-8/i, /需求审查矩阵/, /Requirement\s*Matrix/i],
  DomainRealityMatrix: [
    /DomainRealityMatrix/i,
    /DistributionRequirementRealityGate/i,
    /领域现实矩阵/,
    /分发现实/,
    /package\s+channel/i
  ],
  ClaimEvidenceMatrix: [/ClaimEvidenceMatrix/i, /Claim\s*Evidence/i, /主张证据矩阵/, /主张-证据矩阵/],
  EscapeAbsorptionQueue: [/EscapeAbsorptionQueue/i, /遗漏吸纳队列/, /逃逸吸纳队列/, /外部发现吸纳队列/],
  TDMatrix: [/TDMatrix/i, /TD-1\s*~\s*TD-13/i, /技术方案审查矩阵/, /Technical\s*Design\s*Matrix/i],
  BlockerSnapshot: [/BlockerSnapshot/i, /阻断快照/, /阻断项快照/, /Blocker\s*Aggregation/i]
}

const STALE_PATTERNS = [
  /receiptFreshness\s*[:=]\s*stale/i,
  /fresh\s*[:=]\s*false/i,
  /candidateDigestMismatch/i,
  /source\s+HEAD\s+mismatch/i,
  /证据已陈旧/,
  /过期回执/
]

const CONFIRMATION_PATTERNS = [
  /确认\s*CP[12]/i,
  /可确认\s*CP[12]/i,
  /CP[12]\s*(?:confirmed|confirmation-ready)/i,
  /ConfirmBindingGate/i
]

const OPEN_BLOCKER_PATTERNS = [
  /openBlockers\s*[:=]\s*[1-9]/i,
  /blockerStatus\s*[:=]\s*(?:open|blocked)/i,
  /阻断项\s*[:：]\s*(?:open|未关闭|存在)/i,
  /(?:blockerId|blockerSeverity|blockerPriority)\s*[:=]\s*(?:P[01]|BLOCK)\b/i,
  /\bBLOCK\b[^.\n]*(?:open|unresolved|未关闭|存在)/i
]

function normalizePhase(input, options = {}) {
  const raw = options.phase || options.phaseKind || input?.phaseKind || input?.phase
  if (raw && /^CP[12]$/i.test(String(raw))) return String(raw).toUpperCase()
  const text = typeof input === 'string' ? input : JSON.stringify(input || {})
  if (/\bCP1\b|需求确认|RQMatrix/i.test(text)) return 'CP1'
  if (/\bCP2\b|技术方案|TDMatrix/i.test(text)) return 'CP2'
  return null
}

function textOf(input) {
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input || {})
  } catch {
    return ''
  }
}

function hasDeepKey(value, key) {
  if (!value || typeof value !== 'object') return false
  if (Object.prototype.hasOwnProperty.call(value, key)) return true
  return Object.values(value).some(item => hasDeepKey(item, key))
}

function hasField(input, text, field) {
  if (typeof input === 'object' && input && hasDeepKey(input, field)) return true
  return (FIELD_PATTERNS[field] || []).some(pattern => pattern.test(text))
}

function hasFieldSkipReason(text, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`skipReason\\s*[:=][^\\n]*${escaped}|${escaped}[^\\n]*skipReason`, 'i').test(text)
}

function matchAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text))
}

function missingCandidateReviewFields(input, options = {}) {
  const phase = normalizePhase(input, options)
  if (!phase || !PHASE_RULES[phase]) return []
  const text = textOf(input)
  return PHASE_RULES[phase].requiredFields
    .filter(field => !hasField(input, text, field))
    .map(field => ({
      field,
      skipReason: hasFieldSkipReason(text, field)
    }))
}

function classifyCandidateReviewBundle(input, options = {}) {
  const phase = normalizePhase(input, options)
  const text = textOf(input)
  if (!phase || !PHASE_RULES[phase]) return 'not-candidate-review'

  const missing = missingCandidateReviewFields(input, { ...options, phase })
  const hasConfirmationCue = matchAny(text, CONFIRMATION_PATTERNS)
  if (matchAny(text, STALE_PATTERNS)) return 'stale'
  if (missing.length && hasConfirmationCue) return 'confirm-blocked'
  if (missing.length) return 'review-incomplete'
  if (matchAny(text, OPEN_BLOCKER_PATTERNS)) return 'blocked'
  return 'review-ready'
}

function buildCandidateReviewBundleReceipt(input, options = {}) {
  const phase = normalizePhase(input, options)
  const text = textOf(input)
  const missing = missingCandidateReviewFields(input, { ...options, phase })
  const classification = classifyCandidateReviewBundle(input, { ...options, phase })
  const presentFields = phase && PHASE_RULES[phase]
    ? PHASE_RULES[phase].requiredFields.filter(field => hasField(input, text, field))
    : []

  return {
    schemaVersion: 'CandidateReviewBundleReceiptV1',
    gate: 'RequiredCandidateEvidenceGate',
    phase,
    classification,
    presentFields,
    missingFields: missing.map(item => item.field),
    missingWithoutSkipReason: missing.filter(item => !item.skipReason).map(item => item.field),
    stale: classification === 'stale',
    confirmationBlocked: classification === 'confirm-blocked',
    passed: classification === 'review-ready'
  }
}

module.exports = {
  FIELD_PATTERNS,
  PHASE_RULES,
  buildCandidateReviewBundleReceipt,
  classifyCandidateReviewBundle,
  missingCandidateReviewFields
}
