'use strict'

const crypto = require('crypto')

const REQUIRED_MATRIX_FIELDS = ['schemaVersion', 'phaseKind', 'candidates']
const REQUIRED_CANDIDATE_FIELDS = [
  'candidateId',
  'sourceNamespace',
  'rawSummary',
  'backlogClass',
  'commonDecision',
  'layerChecks',
  'validationRoute'
]
const LAYER_KEYS = [
  'commonInstruction',
  'skill',
  'promptTemplate',
  'executionConsumer',
  'validationProbe',
  'publicDocs',
  'deployCopy'
]
const BACKLOG_CLASSES = new Set(['pure-open', 'residual-tail', 'already-fixed', 'misclassified'])
const COMMON_DECISIONS = new Set(['absorb', 'case-evidence-only', 'project-local', 'docs-only', 'already-covered', 'reject', 'defer'])
const CLASSIFICATIONS = new Set([
  'global-invariant',
  'existing-skill-subgate',
  'new-skill-required',
  'docs-only',
  'case-evidence-only',
  'project-local',
  'already-covered'
])
const EXISTENCE_STATUSES = new Set(['absent', 'partial', 'present', 'equivalent-covered', 'unverified'])
const LEDGER_DISPOSITIONS = new Set(['absorb-candidate', 'residual-candidate', 'close-ledger', 'defer'])
const COVERED_EXISTENCE = new Set(['present', 'equivalent-covered'])
const ENFORCEMENT_LEVELS = new Set(['hard-probe', 'structural-gate', 'conditional-probe', 'checklist-only', 'none'])
const PROBE_CLASSES = new Set([
  'machine-sample',
  'structural-schema',
  'fixture-replay',
  'extend-existing',
  'checklist-only',
  'probe-forbidden'
])
const PROBE_NECESSITIES = new Set(['required', 'conditional', 'not-required', 'forbidden'])
const ALWAYS_ON_IMPACTS = new Set(['none', 'test-only', 'conditional-path', 'always-on-path'])
const WEAK_ENFORCEMENT = new Set(['checklist-only', 'none'])

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function issue(path, code, message) {
  return { path, code, message }
}

function validateLayerChecks(layerChecks, pathPrefix) {
  const issues = []
  if (!layerChecks || typeof layerChecks !== 'object' || Array.isArray(layerChecks)) {
    return [issue(pathPrefix, 'layer-checks-required', 'layerChecks must be an object')]
  }
  for (const key of LAYER_KEYS) {
    const item = layerChecks[key]
    if (!item || typeof item !== 'object') {
      issues.push(issue(`${pathPrefix}.${key}`, 'layer-missing', `${key} layer check is required`))
      continue
    }
    if (!['required', 'covered', 'not-applicable', 'blocked'].includes(item.state)) {
      issues.push(issue(`${pathPrefix}.${key}.state`, 'layer-state-invalid', `${key} has invalid state`))
    }
    if (item.state === 'not-applicable' && !item.skipReason) {
      issues.push(issue(`${pathPrefix}.${key}.skipReason`, 'skip-reason-required', `${key} needs skipReason`))
    }
  }
  return issues
}

function validateSourceExistence(sourceExistence, pathPrefix, commonDecision) {
  const issues = []
  if (commonDecision === 'absorb') {
    if (!sourceExistence || typeof sourceExistence !== 'object' || Array.isArray(sourceExistence)) {
      return [issue(pathPrefix, 'source-existence-required', 'commonDecision=absorb requires sourceExistence')]
    }
  } else if (!sourceExistence) {
    return issues
  } else if (typeof sourceExistence !== 'object' || Array.isArray(sourceExistence)) {
    return [issue(pathPrefix, 'source-existence-invalid', 'sourceExistence must be an object')]
  }

  const required = [
    'claimedCapability',
    'searchAnchors',
    'sourceRoot',
    'existenceStatus',
    'hitEvidence',
    'nearNeighborCoverage',
    'ledgerDisposition',
    'verifiedBy'
  ]
  for (const field of required) {
    if (sourceExistence[field] === undefined || sourceExistence[field] === null || sourceExistence[field] === '') {
      issues.push(issue(`${pathPrefix}.${field}`, 'source-existence-field-missing', `${field} is required on sourceExistence`))
    }
  }
  if (!EXISTENCE_STATUSES.has(sourceExistence.existenceStatus)) {
    issues.push(issue(`${pathPrefix}.existenceStatus`, 'existence-status-invalid', 'existenceStatus is invalid'))
  }
  if (!LEDGER_DISPOSITIONS.has(sourceExistence.ledgerDisposition)) {
    issues.push(issue(`${pathPrefix}.ledgerDisposition`, 'ledger-disposition-invalid', 'ledgerDisposition is invalid'))
  }
  if (!Array.isArray(sourceExistence.searchAnchors) || sourceExistence.searchAnchors.length === 0) {
    issues.push(issue(`${pathPrefix}.searchAnchors`, 'search-anchors-required', 'searchAnchors must be non-empty'))
  }
  if (!Array.isArray(sourceExistence.hitEvidence)) {
    issues.push(issue(`${pathPrefix}.hitEvidence`, 'hit-evidence-array', 'hitEvidence must be an array'))
  } else if (
    COVERED_EXISTENCE.has(sourceExistence.existenceStatus) ||
    sourceExistence.existenceStatus === 'partial'
  ) {
    if (sourceExistence.hitEvidence.length === 0) {
      issues.push(issue(`${pathPrefix}.hitEvidence`, 'hit-evidence-required', 'present/partial/equivalent-covered requires hitEvidence'))
    }
  }
  if (commonDecision === 'absorb') {
    if (sourceExistence.existenceStatus === 'unverified') {
      issues.push(issue(`${pathPrefix}.existenceStatus`, 'existence-unverified', 'cannot absorb while existenceStatus=unverified'))
    }
    if (COVERED_EXISTENCE.has(sourceExistence.existenceStatus)) {
      issues.push(issue(`${pathPrefix}.existenceStatus`, 'existence-already-covered', 'present/equivalent-covered cannot use commonDecision=absorb'))
    }
    if (sourceExistence.ledgerDisposition === 'close-ledger') {
      issues.push(issue(`${pathPrefix}.ledgerDisposition`, 'close-ledger-not-absorb', 'close-ledger disposition cannot absorb'))
    }
  }
  return issues
}

/**
 * Classifier for SourceExistenceVerificationGate free-text / object samples.
 * @returns {'absorb-ok'|'residual-ok'|'close-ledger'|'ledger-status-only'|'existence-unverified'|'invalid-absorb-covered'}
 */
function classifySourceExistenceVerificationSample(sample) {
  const text = typeof sample === 'string' ? sample : ''
  const obj = sample && typeof sample === 'object' && !Array.isArray(sample) ? sample : null
  const status = obj?.existenceStatus ||
    (/existenceStatus\s*[:=]\s*([a-z-]+)/i.exec(text)?.[1]) ||
    (/existenceStatus[=:]\s*([a-z-]+)/i.exec(text)?.[1])
  const hasSearch = (Array.isArray(obj?.searchAnchors) && obj.searchAnchors.length > 0) ||
    /searchAnchors|sourceRoot|source-root|在 source|源码检索|rg |grep /i.test(text)
  const ledgerOnly = /状态[：:]\s*(open|active|pending)|pending absorption|只根据台账|ledger-status-only/i.test(text) && !hasSearch
  if (ledgerOnly || (!hasSearch && /absorb|可吸纳|pure-open/i.test(text))) {
    return 'ledger-status-only'
  }
  if (!hasSearch || status === 'unverified' || (!status && /未验证|unverified/i.test(text))) {
    return 'existence-unverified'
  }
  if (status === 'present' || status === 'equivalent-covered' || /already-covered|already-fixed|可关账|close-ledger/i.test(text)) {
    if (/commonDecision\s*[:=]\s*absorb|decision\s*=\s*absorb|标 absorb|整包吸纳/i.test(text) &&
      !/不得|禁止|reject|close-ledger/i.test(text)) {
      return 'invalid-absorb-covered'
    }
    return 'close-ledger'
  }
  if (status === 'partial' || /residual-tail|residual-candidate|补洞/i.test(text)) {
    return 'residual-ok'
  }
  if (status === 'absent' || /existenceStatus\s*[:=]\s*absent|absent\b/i.test(text)) {
    return 'absorb-ok'
  }
  return 'existence-unverified'
}

function validateProbeNecessity(probeNecessity, pathPrefix, commonDecision, enforcementLevel) {
  const issues = []
  if (commonDecision !== 'absorb') {
    return issues
  }
  if (!probeNecessity || typeof probeNecessity !== 'object' || Array.isArray(probeNecessity)) {
    return [issue(pathPrefix, 'probe-necessity-required', 'commonDecision=absorb requires probeNecessity')]
  }
  const required = [
    'probeClass',
    'necessity',
    'rationale',
    'probePlan',
    'existingProbeReuse',
    'alwaysOnImpact',
    'complexityDelta',
    'falsePositiveRisk'
  ]
  for (const field of required) {
    if (probeNecessity[field] === undefined || probeNecessity[field] === null || probeNecessity[field] === '') {
      issues.push(issue(`${pathPrefix}.${field}`, 'probe-necessity-field-missing', `${field} is required on probeNecessity`))
    }
  }
  if (!PROBE_CLASSES.has(probeNecessity.probeClass)) {
    issues.push(issue(`${pathPrefix}.probeClass`, 'probe-class-invalid', 'probeClass is invalid'))
  }
  if (!PROBE_NECESSITIES.has(probeNecessity.necessity)) {
    issues.push(issue(`${pathPrefix}.necessity`, 'probe-necessity-invalid', 'necessity is invalid'))
  }
  if (!ALWAYS_ON_IMPACTS.has(probeNecessity.alwaysOnImpact)) {
    issues.push(issue(`${pathPrefix}.alwaysOnImpact`, 'always-on-impact-invalid', 'alwaysOnImpact is invalid'))
  }
  if (
    (probeNecessity.necessity === 'not-required' || probeNecessity.necessity === 'forbidden') &&
    !probeNecessity.skipProbeReason
  ) {
    issues.push(issue(`${pathPrefix}.skipProbeReason`, 'skip-probe-reason-required', 'not-required/forbidden needs skipProbeReason'))
  }
  if (probeNecessity.necessity === 'required' && /以后|后续|待定|TODO|以后再说/i.test(String(probeNecessity.probePlan || ''))) {
    issues.push(issue(`${pathPrefix}.probePlan`, 'probe-plan-deferred', 'required probe cannot defer probePlan'))
  }
  if (probeNecessity.probeClass === 'checklist-only' && commonDecision === 'absorb') {
    issues.push(issue(`${pathPrefix}.probeClass`, 'checklist-only-not-active-absorb', 'checklist-only cannot absorb as enforceable active'))
  }
  if (probeNecessity.alwaysOnImpact === 'always-on-path' && !/UnaffectedIntent|base-changing|单独确认/i.test(String(probeNecessity.rationale || '') + String(probeNecessity.falsePositiveRisk || ''))) {
    issues.push(issue(`${pathPrefix}.alwaysOnImpact`, 'always-on-needs-base-note', 'always-on-path requires base-impact note in rationale or falsePositiveRisk'))
  }
  if (enforcementLevel && WEAK_ENFORCEMENT.has(enforcementLevel)) {
    issues.push(issue(`${pathPrefix.replace('probeNecessity', 'enforcementLevel')}`, 'weak-enforcement', 'absorb cannot use checklist-only/none enforcementLevel'))
  }
  if (enforcementLevel === 'hard-probe' && !['machine-sample', 'fixture-replay', 'extend-existing', 'structural-schema'].includes(probeNecessity.probeClass)) {
    issues.push(issue(`${pathPrefix}.probeClass`, 'hard-probe-class-mismatch', 'hard-probe requires machine/fixture/extend/structural class'))
  }
  return issues
}

/**
 * @returns {'enforceable'|'text-only-fake'|'checklist-fake'|'probe-deferred'|'ok-structural'|'ok-probe'}
 */
function classifyExecutableAbsorptionSample(sample) {
  const text = typeof sample === 'string' ? sample : JSON.stringify(sample || {})
  if (/只改 (Skill|正文|Markdown)|text-only|无消费者|无探针.*absorbed|假吸纳/i.test(text) && !/禁止|invalid|blocked/i.test(text)) {
    return 'text-only-fake'
  }
  if (/checklist-only|仅清单|人工自觉/i.test(text) && /absorb|absorbed|active/i.test(text) && !/不得|禁止|否/i.test(text)) {
    return 'checklist-fake'
  }
  if (/necessity\s*[:=]\s*required/i.test(text) && /以后再说|TODO|待定|后续再补探针/i.test(text)) {
    return 'probe-deferred'
  }
  if (/enforcementLevel\s*[:=]\s*structural-gate|structural-schema/i.test(text)) {
    return 'ok-structural'
  }
  if (/enforcementLevel\s*[:=]\s*(hard-probe|conditional-probe)|probeClass\s*[:=]\s*(machine-sample|extend-existing|fixture-replay)/i.test(text)) {
    return 'ok-probe'
  }
  if (/ExecutableAbsorption|不按流程|谁会红/i.test(text) && /hard-probe|structural-gate|conditional-probe/i.test(text)) {
    return 'enforceable'
  }
  return 'text-only-fake'
}

function validateCandidate(candidate, index) {
  const pathPrefix = `candidates[${index}]`
  const issues = []
  for (const field of REQUIRED_CANDIDATE_FIELDS) {
    if (candidate[field] === undefined || candidate[field] === null || candidate[field] === '') {
      issues.push(issue(`${pathPrefix}.${field}`, 'required-field-missing', `${field} is required`))
    }
  }
  if (!BACKLOG_CLASSES.has(candidate.backlogClass)) {
    issues.push(issue(`${pathPrefix}.backlogClass`, 'backlog-class-invalid', 'backlogClass is invalid'))
  }
  if (!COMMON_DECISIONS.has(candidate.commonDecision)) {
    issues.push(issue(`${pathPrefix}.commonDecision`, 'common-decision-invalid', 'commonDecision is invalid'))
  }
  if (candidate.targetLayer && !CLASSIFICATIONS.has(candidate.targetLayer)) {
    issues.push(issue(`${pathPrefix}.targetLayer`, 'target-layer-invalid', 'targetLayer is invalid'))
  }
  if (candidate.enforcementLevel && !ENFORCEMENT_LEVELS.has(candidate.enforcementLevel)) {
    issues.push(issue(`${pathPrefix}.enforcementLevel`, 'enforcement-level-invalid', 'enforcementLevel is invalid'))
  }
  if (!Array.isArray(candidate.validationRoute) || candidate.validationRoute.length === 0) {
    issues.push(issue(`${pathPrefix}.validationRoute`, 'validation-route-required', 'validationRoute must be non-empty'))
  }
  issues.push(...validateLayerChecks(candidate.layerChecks, `${pathPrefix}.layerChecks`))
  issues.push(...validateSourceExistence(candidate.sourceExistence, `${pathPrefix}.sourceExistence`, candidate.commonDecision))
  issues.push(...validateProbeNecessity(
    candidate.probeNecessity,
    `${pathPrefix}.probeNecessity`,
    candidate.commonDecision,
    candidate.enforcementLevel
  ))
  if (candidate.commonDecision === 'absorb' && !candidate.enforcementLevel) {
    issues.push(issue(`${pathPrefix}.enforcementLevel`, 'enforcement-level-required', 'absorb requires enforcementLevel'))
  }
  if (candidate.commonDecision === 'absorb' && WEAK_ENFORCEMENT.has(candidate.enforcementLevel)) {
    issues.push(issue(`${pathPrefix}.enforcementLevel`, 'weak-enforcement', 'absorb cannot use checklist-only/none'))
  }
  if (candidate.commonDecision === 'absorb' && candidate.backlogClass !== 'pure-open' && candidate.backlogClass !== 'residual-tail' && !candidate.skipReason) {
    issues.push(issue(`${pathPrefix}.skipReason`, 'non-pure-open-needs-skip', 'non pure-open/residual-tail candidate cannot be absorbed without skipReason'))
  }
  if (candidate.commonDecision === 'absorb' && candidate.backlogClass === 'residual-tail') {
    if (candidate.sourceExistence?.existenceStatus !== 'partial') {
      issues.push(issue(`${pathPrefix}.sourceExistence.existenceStatus`, 'residual-needs-partial', 'residual-tail absorb requires existenceStatus=partial'))
    }
  }
  if (candidate.commonDecision === 'absorb' && candidate.backlogClass === 'pure-open') {
    if (candidate.sourceExistence?.existenceStatus && candidate.sourceExistence.existenceStatus !== 'absent') {
      issues.push(issue(`${pathPrefix}.sourceExistence.existenceStatus`, 'pure-open-needs-absent', 'pure-open absorb requires existenceStatus=absent'))
    }
  }
  return issues
}

function validateAbsorptionCandidateMatrix(matrix) {
  const issues = []
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    return [issue('$', 'matrix-required', 'matrix must be an object')]
  }
  for (const field of REQUIRED_MATRIX_FIELDS) {
    if (matrix[field] === undefined || matrix[field] === null || matrix[field] === '') {
      issues.push(issue(field, 'required-field-missing', `${field} is required`))
    }
  }
  if (matrix.schemaVersion !== 'AbsorptionCandidateMatrixV1') {
    issues.push(issue('schemaVersion', 'schema-version-invalid', 'schemaVersion must be AbsorptionCandidateMatrixV1'))
  }
  if (!['intake', 'planning', 'implementation', 'review'].includes(matrix.phaseKind)) {
    issues.push(issue('phaseKind', 'phase-kind-invalid', 'phaseKind is invalid'))
  }
  if (!Array.isArray(matrix.candidates) || matrix.candidates.length === 0) {
    issues.push(issue('candidates', 'candidates-required', 'candidates must be non-empty'))
  } else {
    matrix.candidates.forEach((candidate, index) => {
      issues.push(...validateCandidate(candidate || {}, index))
    })
  }
  return issues
}

function inferClassification(candidate) {
  if (candidate.targetLayer) return candidate.targetLayer
  if (candidate.commonDecision === 'docs-only') return 'docs-only'
  if (candidate.commonDecision === 'case-evidence-only') return 'case-evidence-only'
  if (candidate.commonDecision === 'project-local') return 'project-local'
  if (candidate.commonDecision === 'already-covered') return 'already-covered'
  return 'existing-skill-subgate'
}

function buildLayeredAbsorptionDecision(candidate) {
  const blockers = []
  const classification = inferClassification(candidate)
  if (candidate.commonDecision !== 'absorb') {
    return {
      schemaVersion: 'LayeredAbsorptionDecisionV1',
      candidateId: candidate.candidateId,
      classification,
      targetOwner: candidate.targetOwner || '',
      targetSkill: candidate.targetOwner || '',
      triggerTerms: candidate.triggerTerms || [],
      ownedArtifacts: candidate.ownedArtifacts || [],
      layerChecks: candidate.layerChecks || {},
      validationRoute: candidate.validationRoute || [],
      consumerSync: candidate.consumerSync || [],
      status: 'skipped',
      blockers,
      skipReason: candidate.skipReason || `commonDecision=${candidate.commonDecision}`,
      prevention: candidate.prevention || null
    }
  }
  if (candidate.backlogClass !== 'pure-open' && candidate.backlogClass !== 'residual-tail') {
    blockers.push('backlog-class-not-absorbable')
  }
  if (!candidate.targetOwner) blockers.push('target-owner-missing')
  if (!candidate.sourceExistence) blockers.push('source-existence-missing')
  else {
    if (candidate.sourceExistence.existenceStatus === 'unverified') blockers.push('existence-unverified')
    if (COVERED_EXISTENCE.has(candidate.sourceExistence.existenceStatus)) blockers.push('existence-already-covered')
    if (candidate.backlogClass === 'pure-open' && candidate.sourceExistence.existenceStatus !== 'absent') {
      blockers.push('pure-open-requires-absent')
    }
    if (candidate.backlogClass === 'residual-tail' && candidate.sourceExistence.existenceStatus !== 'partial') {
      blockers.push('residual-requires-partial')
    }
  }
  if (!candidate.probeNecessity) blockers.push('probe-necessity-missing')
  if (!candidate.enforcementLevel) blockers.push('enforcement-level-missing')
  if (WEAK_ENFORCEMENT.has(candidate.enforcementLevel)) blockers.push('weak-enforcement')
  for (const key of LAYER_KEYS) {
    if (candidate.layerChecks?.[key]?.state === 'blocked') blockers.push(`layer-blocked:${key}`)
  }
  return {
    schemaVersion: 'LayeredAbsorptionDecisionV1',
    candidateId: candidate.candidateId,
    classification,
    targetOwner: candidate.targetOwner || '',
    targetSkill: candidate.targetOwner || '',
    triggerTerms: candidate.triggerTerms || [],
    ownedArtifacts: candidate.ownedArtifacts || [],
    layerChecks: candidate.layerChecks || {},
    validationRoute: candidate.validationRoute || [],
    consumerSync: candidate.consumerSync || [],
    status: blockers.length ? 'blocked' : 'ready',
    blockers,
    skipReason: blockers.length ? 'blocked layers must be resolved before implementation' : '',
    prevention: candidate.prevention || null
  }
}

function planAbsorptionCandidates(matrix) {
  const validationIssues = validateAbsorptionCandidateMatrix(matrix)
  const decisions = Array.isArray(matrix?.candidates)
    ? matrix.candidates.map(buildLayeredAbsorptionDecision)
    : []
  const summary = decisions.reduce((acc, decision) => {
    acc.total += 1
    acc[decision.status] = (acc[decision.status] || 0) + 1
    acc.openBlockers += decision.blockers.length
    return acc
  }, { total: 0, ready: 0, blocked: 0, skipped: 0, openBlockers: validationIssues.length })
  return {
    schemaVersion: 'AbsorptionCandidatePlanV1',
    matrixDigest: matrix ? sha256(matrix) : null,
    validation: {
      status: validationIssues.length ? 'invalid' : 'valid',
      issues: validationIssues
    },
    decisions,
    summary,
    readonly: true,
    sideEffects: []
  }
}

module.exports = {
  LAYER_KEYS,
  buildLayeredAbsorptionDecision,
  classifyExecutableAbsorptionSample,
  classifySourceExistenceVerificationSample,
  planAbsorptionCandidates,
  sha256,
  stableStringify,
  validateAbsorptionCandidateMatrix,
  validateProbeNecessity,
  validateSourceExistence
}
