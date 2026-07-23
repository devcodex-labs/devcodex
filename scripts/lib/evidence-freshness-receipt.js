'use strict'

const crypto = require('crypto')

const CLAIM_CLASSES = new Set([
  'verification',
  'recommendation',
  'audit-finding',
  'requirement-confirmation',
  'solution-fit',
  'release-state',
  'coverage',
  'ordinary'
])
const CLAIM_STRENGTHS = new Set(['strong', 'medium', 'weak'])
const FRESHNESS = new Set(['fresh', 'not-current', 'partial', 'unverifiable', 'N/A'])
const REUSE_DECISIONS = new Set(['fresh', 'rerun-required', 'downgrade-only', 'unverifiable', 'N/A'])
const LINT_STATUSES = new Set(['PASS', 'WARN', 'BLOCK', 'UNVERIFIED', 'N/A'])
const LINT_MODES = new Set(['shadow', 'warn', 'enforce'])
const SUMMARY_ONLY_KINDS = new Set(['memory', 'summary', 'summary-only', 'history-report', 'external-review'])
const EVIDENCE_REF_KINDS = new Set([
  'artifact-anchor',
  'artifact-anchor-projection',
  'command',
  'command-result',
  'document',
  'file',
  'final-validation-summary',
  'url',
  ...SUMMARY_ONLY_KINDS
])

const STRONG_PATTERNS = [
  { claimClass: 'verification', re: /(?:已验证|verified|exitCode\s*0|exitCode[:=]\s*0|通过|passed|无阻断)/i },
  { claimClass: 'recommendation', re: /(?:推荐方案|推荐结论|建议采纳|recommended|recommendation)/i },
  { claimClass: 'audit-finding', re: /(?:采纳\s*(?:Grok|Codex)|external review|AI review|review finding|外部审查|外部审阅)/i },
  { claimClass: 'requirement-confirmation', re: /(?:可确认\s*CP[123]|确认\s*CP[123]|进入下一阶段|confirmation-ready)/i },
  { claimClass: 'coverage', re: /(?:完整|全量|零遗漏|complete coverage|full coverage|no missing)/i },
  { claimClass: 'release-state', re: /(?:已推送|pushed|published|released|tagged|commit\s+[a-f0-9]{7,40})/i }
]

const MEDIUM_PATTERNS = [
  { claimClass: 'solution-fit', re: /(?:合理|可实施|feasible|compatible|fit)/i },
  { claimClass: 'verification', re: /(?:待验证|UNVERIFIED|未验证|需要验证)/i }
]

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function textList(value) {
  return Array.isArray(value) && value.every(text)
}

function validDate(value) {
  return text(value) && Number.isFinite(Date.parse(value))
}

function normalizeIdentity(value = {}, fallbackId = 'unknown') {
  if (text(value)) return { id: value, digest: value }
  const id = text(value.id) ? value.id : fallbackId
  const identity = { ...value, id }
  if (!text(identity.digest)) identity.digest = digest(identity)
  return identity
}

function contentIdentityFromText(content, { id = 'inline', kind = 'markdown' } = {}) {
  const body = String(content || '')
  return {
    schemaVersion: 'ContentIdentityV1',
    id,
    kind,
    byteLength: Buffer.byteLength(body, 'utf8'),
    digest: digest({ id, kind, body })
  }
}

function normalizeEvidenceRef(ref) {
  if (text(ref)) {
    const value = ref.trim()
    const typed = value.match(/^([a-z][a-z0-9-]{1,31}):(.+)$/i)
    const hasWindowsDrive = /^[A-Za-z]:[\\/]/.test(value)
    const kind = typed && !hasWindowsDrive && EVIDENCE_REF_KINDS.has(typed[1].toLowerCase())
      ? typed[1].toLowerCase()
      : 'file'
    const rest = kind === 'file' ? value : typed[2]
    return {
      kind,
      ref: rest,
      digest: digest({ kind, ref: rest })
    }
  }
  const kind = String(ref?.kind || ref?.type || 'file').trim().toLowerCase()
  const normalized = {
    ...ref,
    kind,
    ref: ref?.ref || ref?.path || ref?.command || ref?.id || ref?.digest || ''
  }
  if (!text(normalized.digest)) normalized.digest = digest({
    kind: normalized.kind,
    ref: normalized.ref,
    contentDigest: normalized.contentDigest || null,
    anchorDigest: normalized.anchorDigest || null,
    projectionDigest: normalized.projectionDigest || null,
    summaryDigest: normalized.summaryDigest || null
  })
  return normalized
}

function normalizeEvidenceRefs(refs) {
  if (!Array.isArray(refs)) return []
  const seen = new Set()
  const result = []
  for (const raw of refs) {
    const ref = normalizeEvidenceRef(raw)
    const key = `${ref.kind}:${ref.ref}:${ref.digest}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(ref)
    }
  }
  return result.sort((left, right) => `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`))
}

function isSummaryOnlyRef(ref) {
  return SUMMARY_ONLY_KINDS.has(String(ref?.kind || '').toLowerCase())
}

function allSummaryOnly(refs) {
  return refs.length > 0 && refs.every(isSummaryOnlyRef)
}

function classifyStrongClaimLine(line) {
  const body = normalizeText(line)
  if (!body || /^[-|:\s]+$/.test(body)) {
    return { claimClass: 'ordinary', strength: 'weak', matched: null }
  }
  for (const pattern of STRONG_PATTERNS) {
    if (pattern.re.test(body)) return { claimClass: pattern.claimClass, strength: 'strong', matched: String(pattern.re) }
  }
  for (const pattern of MEDIUM_PATTERNS) {
    if (pattern.re.test(body)) return { claimClass: pattern.claimClass, strength: 'medium', matched: String(pattern.re) }
  }
  return { claimClass: 'ordinary', strength: 'weak', matched: null }
}

function pushEvidence(result, ref) {
  result.push(normalizeEvidenceRef(ref))
}

function extractEvidenceRefsFromLine(line) {
  const result = []
  const body = String(line || '')
  const codeSpans = [...body.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim())
  for (const span of codeSpans) {
    if (/(?:^|[\\/])\.memory(?:[\\/]|$)|(?:^|[\\/])SUMMARY\.md$/i.test(span)) {
      pushEvidence(result, { kind: 'summary-only', ref: span })
    } else if (/^(?:npm|node|npx|pnpm|yarn|git|devcodex)\s+/i.test(span)) {
      pushEvidence(result, { kind: 'command', command: span, ref: span })
    } else if (/[\\/]/.test(span) || /\.(?:md|js|cjs|json|yml|yaml|ts|tsx|jsx|css)$/i.test(span)) {
      pushEvidence(result, { kind: 'file', path: span, ref: span })
    }
  }
  if (/\bexitCode\s*[:=]?\s*0\b/i.test(body) && !result.some((ref) => ref.kind === 'command')) {
    pushEvidence(result, { kind: 'command-result', ref: 'exitCode:0' })
  }
  const anchor = body.match(/\bartifact-anchor-[a-f0-9]{12,64}\b/i)
  if (anchor) pushEvidence(result, { kind: 'artifact-anchor', ref: anchor[0], anchorDigest: anchor[0] })
  const projection = body.match(/\bartifact-anchor-projection-[a-f0-9]{12,64}\b/i)
  if (projection) pushEvidence(result, { kind: 'artifact-anchor-projection', ref: projection[0], projectionDigest: projection[0] })
  const finalSummary = body.match(/\bfinal-validation-summary-[a-f0-9]{12,64}\b/i)
  if (finalSummary || /FinalValidationSummaryV1/i.test(body)) {
    pushEvidence(result, { kind: 'final-validation-summary', ref: finalSummary ? finalSummary[0] : 'FinalValidationSummaryV1' })
  }
  if (/(?:\.memory|SUMMARY|history report|历史报告|外部审查报告|external review)/i.test(body)) {
    pushEvidence(result, { kind: 'summary-only', ref: normalizeText(body).slice(0, 120) })
  }
  return normalizeEvidenceRefs(result)
}

function buildClaimEvidenceRecord(line, index, explicitRefs = []) {
  const classification = classifyStrongClaimLine(line)
  const claimText = normalizeText(line)
  const evidenceRefs = normalizeEvidenceRefs([...extractEvidenceRefsFromLine(line), ...explicitRefs])
  const core = {
    claimText,
    claimClass: CLAIM_CLASSES.has(classification.claimClass) ? classification.claimClass : 'ordinary',
    strength: CLAIM_STRENGTHS.has(classification.strength) ? classification.strength : 'weak',
    line: index + 1
  }
  const claimDigest = digest(core)
  return {
    schemaVersion: 'ClaimEvidenceRecordV1',
    claimId: `claim-${claimDigest.slice(0, 12)}`,
    claimDigest,
    ...core,
    evidenceRefs,
    unsupportedReason: evidenceRefs.length === 0 && core.strength === 'strong' ? 'strong-claim-without-evidence-ref' : null
  }
}

function buildClaimEvidenceIndex(input, options = {}) {
  const content = typeof input === 'string' ? input : String(input?.content || input?.text || '')
  const targetIdentity = normalizeIdentity(options.targetIdentity || input?.targetIdentity ||
    contentIdentityFromText(content, { id: options.targetId || input?.targetId || 'inline', kind: options.surface || input?.surface || 'text' }))
  const workflow = String(options.workflow || input?.workflow || 'other')
  const surface = String(options.surface || input?.surface || 'report')
  const lines = content.split(/\r?\n/)
  const claims = []
  lines.forEach((line, index) => {
    const record = buildClaimEvidenceRecord(line, index)
    if (record.strength !== 'weak') claims.push(record)
  })
  const summaryOnlyRefs = normalizeEvidenceRefs(claims.flatMap((claim) => claim.evidenceRefs.filter(isSummaryOnlyRef)))
  const core = {
    schemaVersion: 'ClaimEvidenceIndexV1',
    targetIdentity,
    workflow,
    surface,
    claims,
    summaryOnlyRefs
  }
  return { ...core, indexDigest: `claim-evidence-index-${digest(core)}` }
}

function validateReceiptCore(receipt) {
  const errors = []
  if (!text(receipt.claimId)) errors.push('claimId-required')
  if (!text(receipt.claimDigest)) errors.push('claimDigest-required')
  if (!Array.isArray(receipt.evidenceRefs) || receipt.evidenceRefs.length === 0) errors.push('evidenceRefs-required')
  if (!text(receipt.sourceIdentity?.digest)) errors.push('sourceIdentity.digest-required')
  if (!text(receipt.contextIdentity?.digest)) errors.push('contextIdentity.digest-required')
  if (!receipt.dependsOn || typeof receipt.dependsOn !== 'object' || Array.isArray(receipt.dependsOn)) errors.push('dependsOn-object-required')
  if (!validDate(receipt.observedAt)) errors.push('observedAt-invalid')
  if (!receipt.leasePolicy || typeof receipt.leasePolicy !== 'object' || Array.isArray(receipt.leasePolicy)) {
    errors.push('leasePolicy-object-required')
  } else if (text(receipt.leasePolicy.expiresAt) && !validDate(receipt.leasePolicy.expiresAt)) {
    errors.push('leasePolicy.expiresAt-invalid')
  }
  if (!FRESHNESS.has(receipt.freshness)) errors.push('freshness-invalid')
  if (!REUSE_DECISIONS.has(receipt.reuseDecision)) errors.push('reuseDecision-invalid')
  return errors
}

function createEvidenceFreshnessReceipt(input = {}) {
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs)
  const sourceIdentity = normalizeIdentity(input.sourceIdentity, 'source')
  const contextIdentity = normalizeIdentity(input.contextIdentity, 'context')
  const summaryOnly = allSummaryOnly(evidenceRefs)
  const freshness = input.freshness || (summaryOnly ? 'partial' : 'fresh')
  const reuseDecision = input.reuseDecision || (summaryOnly ? 'downgrade-only' : 'fresh')
  const core = {
    schemaVersion: 'EvidenceFreshnessReceiptV1',
    claimId: input.claimId || '',
    claimDigest: input.claimDigest || '',
    evidenceRefs,
    sourceIdentity,
    contextIdentity,
    dependsOn: input.dependsOn || {},
    observedAt: input.observedAt || new Date().toISOString(),
    leasePolicy: input.leasePolicy || { mode: 'candidate-bound', ttl: null, expiresAt: null, renewalRequired: false },
    freshness,
    reuseDecision
  }
  const errors = validateReceiptCore(core)
  return {
    ...core,
    receiptDigest: `evidence-freshness-receipt-${digest(core)}`,
    validation: { valid: errors.length === 0, errors },
    summaryOnly
  }
}

function valuesDiffer(left, right) {
  return JSON.stringify(stableValue(left)) !== JSON.stringify(stableValue(right))
}

function compareIdentity(receipt, current, field, reasons, kind) {
  const currentIdentity = current?.[field]
  if (currentIdentity && text(currentIdentity.digest) && receipt?.[field]?.digest !== currentIdentity.digest) {
    reasons.push(`${kind}-digest-changed`)
  }
}

function evaluateArtifactRef(ref, current, reasons) {
  if (['stale', 'blocked'].includes(String(ref.status || '').toLowerCase())) {
    reasons.push(`${ref.kind}-status-${ref.status}`)
  }
  const bindings = current?.artifactAnchors || {}
  if (Object.keys(bindings).length === 0) return
  const key = ref.anchorDigest || ref.projectionDigest || ref.ref || ref.digest
  const expected = bindings[key]
  if (expected === undefined) reasons.push(`${ref.kind}-binding-missing`)
  else if (expected !== true && valuesDiffer(expected, ref.contentDigest || ref.projectionDigest || ref.digest)) {
    reasons.push(`${ref.kind}-binding-changed`)
  }
}

function evaluateFinalSummaryRef(ref, reasons) {
  const commands = Array.isArray(ref.commandEvidence) ? ref.commandEvidence : []
  if (commands.length > 0 && commands.some((command) => command.exitCode !== 0)) {
    reasons.push('final-validation-summary-command-failed')
  }
  if (ref.requireCommandEvidence === true && commands.length === 0) {
    reasons.push('final-validation-summary-command-evidence-missing')
  }
  if (ref.workspaceSyncStatus && !['synced', 'skipped'].includes(ref.workspaceSyncStatus)) {
    reasons.push('final-validation-summary-workspace-sync-not-closed')
  }
}

function evaluateEvidenceFreshnessReceipt(receipt, current = {}, options = {}) {
  const validationErrors = validateReceiptCore(receipt || {})
  if (validationErrors.length) {
    return {
      schemaVersion: 'EvidenceFreshnessEvaluationV1',
      freshness: 'unverifiable',
      reuseDecision: 'unverifiable',
      reasons: validationErrors,
      passed: false
    }
  }

  const rerunReasons = []
  const downgradeReasons = []
  if (text(current.claimDigest) && current.claimDigest !== receipt.claimDigest) rerunReasons.push('claimDigest-changed')
  compareIdentity(receipt, current, 'sourceIdentity', rerunReasons, 'source')
  compareIdentity(receipt, current, 'contextIdentity', downgradeReasons, 'context')

  const currentDependsOn = current.dependsOn || {}
  for (const [key, value] of Object.entries(receipt.dependsOn || {})) {
    if (Object.prototype.hasOwnProperty.call(currentDependsOn, key) && valuesDiffer(currentDependsOn[key], value)) {
      if (/context|projection/i.test(key)) downgradeReasons.push(`${key}-changed`)
      else rerunReasons.push(`${key}-changed`)
    }
  }

  if (allSummaryOnly(receipt.evidenceRefs)) downgradeReasons.push('summary-only-evidence')

  const now = options.now ? Date.parse(options.now) : Date.now()
  if (text(receipt.leasePolicy?.expiresAt) && Date.parse(receipt.leasePolicy.expiresAt) <= now) {
    const reason = 'lease-expired'
    if (receipt.leasePolicy.renewalRequired === true || options.highRisk === true) rerunReasons.push(reason)
    else downgradeReasons.push(reason)
  }

  for (const ref of receipt.evidenceRefs) {
    if (['artifact-anchor', 'artifact-anchor-projection'].includes(ref.kind)) evaluateArtifactRef(ref, current, rerunReasons)
    if (ref.kind === 'final-validation-summary') evaluateFinalSummaryRef(ref, rerunReasons)
  }

  if (rerunReasons.length) {
    return {
      schemaVersion: 'EvidenceFreshnessEvaluationV1',
      freshness: 'not-current',
      reuseDecision: 'rerun-required',
      reasons: [...new Set(rerunReasons)].sort(),
      passed: false
    }
  }
  if (downgradeReasons.length) {
    return {
      schemaVersion: 'EvidenceFreshnessEvaluationV1',
      freshness: 'partial',
      reuseDecision: 'downgrade-only',
      reasons: [...new Set(downgradeReasons)].sort(),
      passed: false
    }
  }
  return {
    schemaVersion: 'EvidenceFreshnessEvaluationV1',
    freshness: 'fresh',
    reuseDecision: 'fresh',
    reasons: [],
    passed: true
  }
}

function receiptLookup(receipts) {
  const map = new Map()
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (text(receipt.claimDigest)) map.set(receipt.claimDigest, receipt)
    if (text(receipt.claimId)) map.set(receipt.claimId, receipt)
  }
  return map
}

function statusForFailures(mode, hasFailures, hasUnverifiable) {
  if (!hasFailures) return 'PASS'
  if (hasUnverifiable && mode !== 'enforce') return 'UNVERIFIED'
  return mode === 'enforce' ? 'BLOCK' : 'WARN'
}

function buildStaleEvidenceLintDecision(input = {}) {
  const index = input.index || buildClaimEvidenceIndex(input.content || '', input)
  const mode = LINT_MODES.has(input.mode) ? input.mode : 'shadow'
  const strongClaims = (index.claims || []).filter((claim) => claim.strength === 'strong')
  if (strongClaims.length === 0) {
    const core = {
      schemaVersion: 'StaleEvidenceLintDecisionV1',
      targetIdentity: index.targetIdentity,
      indexDigest: index.indexDigest,
      status: 'N/A',
      mode,
      claimResults: [],
      downgradeRequired: [],
      rerunRequired: [],
      skipReason: 'no-strong-claims'
    }
    return { ...core, decisionDigest: `stale-evidence-lint-${digest(core)}` }
  }

  const receipts = receiptLookup(input.receipts)
  const claimResults = []
  const downgradeRequired = []
  const rerunRequired = []
  let hasFailures = false
  let hasUnverifiable = false

  for (const claim of strongClaims) {
    const receipt = receipts.get(claim.claimDigest) || receipts.get(claim.claimId)
    let evaluation
    if (!claim.evidenceRefs.length) {
      evaluation = {
        freshness: 'unverifiable',
        reuseDecision: 'unverifiable',
        reasons: ['strong-claim-without-evidence-ref'],
        passed: false
      }
    } else if (allSummaryOnly(claim.evidenceRefs) && !receipt) {
      evaluation = {
        freshness: 'partial',
        reuseDecision: 'downgrade-only',
        reasons: ['summary-only-evidence'],
        passed: false
      }
    } else if (!receipt) {
      evaluation = {
        freshness: 'unverifiable',
        reuseDecision: 'unverifiable',
        reasons: ['freshness-receipt-missing'],
        passed: false
      }
    } else {
      evaluation = evaluateEvidenceFreshnessReceipt(receipt, input.current || {}, input)
    }

    if (!evaluation.passed) hasFailures = true
    if (evaluation.reuseDecision === 'unverifiable') hasUnverifiable = true
    if (evaluation.reuseDecision === 'downgrade-only') downgradeRequired.push(claim.claimId)
    if (evaluation.reuseDecision === 'rerun-required') rerunRequired.push(claim.claimId)
    claimResults.push({
      claimId: claim.claimId,
      claimDigest: claim.claimDigest,
      claimClass: claim.claimClass,
      strength: claim.strength,
      freshness: evaluation.freshness,
      reuseDecision: evaluation.reuseDecision,
      reasons: evaluation.reasons
    })
  }

  const status = statusForFailures(mode, hasFailures, hasUnverifiable)
  if (!LINT_STATUSES.has(status)) throw new Error(`invalid lint status: ${status}`)
  const core = {
    schemaVersion: 'StaleEvidenceLintDecisionV1',
    targetIdentity: index.targetIdentity,
    indexDigest: index.indexDigest,
    status,
    mode,
    claimResults,
    downgradeRequired,
    rerunRequired,
    skipReason: null
  }
  return { ...core, decisionDigest: `stale-evidence-lint-${digest(core)}` }
}

function buildEvidenceFreshnessSummary(decision) {
  if (!decision || decision.schemaVersion !== 'StaleEvidenceLintDecisionV1') {
    return 'EvidenceFreshness: UNVERIFIED (decision missing)'
  }
  if (decision.status === 'N/A') return `EvidenceFreshness: N/A (${decision.skipReason})`
  const rerun = decision.rerunRequired.length
  const downgrade = decision.downgradeRequired.length
  return `EvidenceFreshness: ${decision.status}; claims=${decision.claimResults.length}; rerun=${rerun}; downgrade=${downgrade}`
}

module.exports = {
  CLAIM_CLASSES,
  CLAIM_STRENGTHS,
  FRESHNESS,
  EVIDENCE_REF_KINDS,
  LINT_MODES,
  LINT_STATUSES,
  REUSE_DECISIONS,
  SUMMARY_ONLY_KINDS,
  allSummaryOnly,
  buildClaimEvidenceIndex,
  buildClaimEvidenceRecord,
  buildEvidenceFreshnessSummary,
  buildStaleEvidenceLintDecision,
  classifyStrongClaimLine,
  contentIdentityFromText,
  createEvidenceFreshnessReceipt,
  digest,
  evaluateEvidenceFreshnessReceipt,
  extractEvidenceRefsFromLine,
  isSummaryOnlyRef,
  normalizeEvidenceRef,
  normalizeEvidenceRefs,
  stableValue
}
