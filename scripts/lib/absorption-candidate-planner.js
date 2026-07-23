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
  if (!Array.isArray(candidate.validationRoute) || candidate.validationRoute.length === 0) {
    issues.push(issue(`${pathPrefix}.validationRoute`, 'validation-route-required', 'validationRoute must be non-empty'))
  }
  issues.push(...validateLayerChecks(candidate.layerChecks, `${pathPrefix}.layerChecks`))
  if (candidate.commonDecision === 'absorb' && candidate.backlogClass !== 'pure-open' && !candidate.skipReason) {
    issues.push(issue(`${pathPrefix}.skipReason`, 'non-pure-open-needs-skip', 'non pure-open candidate cannot be absorbed without skipReason'))
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
  if (candidate.backlogClass !== 'pure-open') blockers.push('backlog-class-not-pure-open')
  if (!candidate.targetOwner) blockers.push('target-owner-missing')
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
  planAbsorptionCandidates,
  sha256,
  stableStringify,
  validateAbsorptionCandidateMatrix
}
