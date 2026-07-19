'use strict'

const DECISIONS = new Set([
  'existing-control-restored',
  'new-control-provisional',
  'no-new-control',
  'emergency-active'
])
const RISK_CLASSES = new Set(['low', 'normal', 'high', 'critical'])
const HIGH_RISK_TAGS = new Set([
  'p0', 'p1', 'security', 'control-plane', 'public-contract', 'release', 'multi-batch', 'role-handoff'
])
const NO_NEW_CONTROL_REASONS = new Set([
  'existing-effective-control',
  'one-off-non-generalizable',
  'prevention-cost-exceeds-risk',
  'no-earlier-detection-point'
])

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasTextList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(hasText)
}

function requiredMode(sample) {
  const tags = Array.isArray(sample?.riskTags) ? sample.riskTags : []
  return sample?.repeatEscape === true || ['high', 'critical'].includes(sample?.riskClass) || tags.some(tag => HIGH_RISK_TAGS.has(tag))
    ? 'full'
    : 'light'
}

function checkProspectivePlan(plan, errors) {
  if (!plan || typeof plan !== 'object') {
    errors.push('prospectiveEvidencePlan-required')
    return { enough: false, currentEventOnly: false, status: null }
  }
  if (!['not-required', 'planned', 'collecting', 'sufficient'].includes(plan.status)) errors.push('prospective-status-invalid')
  if (typeof plan.currentEventOnly !== 'boolean') errors.push('prospective-current-event-flag-required')
  if (!Number.isInteger(plan.comparableWorkUnits) || plan.comparableWorkUnits < 0) errors.push('prospective-work-units-invalid')
  if (!Number.isInteger(plan.independentContexts) || plan.independentContexts < 0) errors.push('prospective-contexts-invalid')
  if (typeof plan.metricGaming !== 'boolean') errors.push('prospective-metric-gaming-flag-required')
  if (typeof plan.rollbackReady !== 'boolean') errors.push('prospective-rollback-ready-flag-required')
  if (!hasText(plan.authority)) errors.push('prospective-authority-required')
  const enough = (plan.comparableWorkUnits >= 3 || plan.independentContexts >= 2) && plan.metricGaming === false && plan.rollbackReady === true
  if (plan.status === 'sufficient' && (plan.currentEventOnly || !enough)) errors.push('prospective-sufficient-evidence-invalid')
  return { enough, currentEventOnly: plan.currentEventOnly === true, status: plan.status }
}

function checkRollbackOrSunset(value, errors) {
  if (!value || typeof value !== 'object') {
    errors.push('rollback-or-sunset-required')
    return
  }
  if (!hasTextList(value.rollbackTriggers)) errors.push('rollback-triggers-required')
  if (!hasTextList(value.sunsetCriteria)) errors.push('sunset-criteria-required')
  if (!hasText(value.reviewAt)) errors.push('sunset-review-required')
}

/**
 * Validates the repair-wide prevention decision without treating the current repair rerun as
 * prospective effectiveness evidence.
 * @param {Record<string, unknown>} sample RepairPreventionAssessmentV1 candidate.
 * @returns {{valid:boolean, errors:string[], requiredMode:string, lifecycleState:string, immediateClosureEligible:boolean, effectivenessStatus:string}}
 */
function assessRepairPrevention(sample) {
  const errors = []
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return {
      valid: false,
      errors: ['assessment-object-required'],
      requiredMode: 'full',
      lifecycleState: 'invalid',
      immediateClosureEligible: false,
      effectivenessStatus: 'unverified'
    }
  }

  if (sample.schemaVersion !== 'RepairPreventionAssessmentV1') errors.push('schema-version-invalid')
  for (const field of ['repairId', 'taskId', 'problemCluster', 'defectRootCause', 'controlFailure', 'detectedAt', 'controlOwner']) {
    if (!hasText(sample[field])) errors.push(`${field}-required`)
  }
  for (const field of ['escapedFrom', 'regressionSeeds', 'negativeCases', 'consumers', 'immediateClosureEvidence']) {
    if (!hasTextList(sample[field])) errors.push(`${field}-required`)
  }
  if (!RISK_CLASSES.has(sample.riskClass)) errors.push('risk-class-invalid')
  if (!Array.isArray(sample.riskTags) || !sample.riskTags.every(hasText)) errors.push('risk-tags-invalid')
  if (typeof sample.repeatEscape !== 'boolean') errors.push('repeat-escape-flag-required')
  if (!DECISIONS.has(sample.preventionDecision)) errors.push('prevention-decision-invalid')

  const mode = requiredMode(sample)
  if (!['light', 'full'].includes(sample.mode)) errors.push('mode-invalid')
  if (mode === 'full' && sample.mode !== 'full') errors.push('full-mode-required')
  if (sample.mode === 'full') {
    for (const field of ['whyMissed', 'authorizationEvidence', 'independentReReviewPlan']) {
      if (!hasText(sample[field])) errors.push(`${field}-required-in-full-mode`)
    }
  }

  const prospective = checkProspectivePlan(sample.prospectiveEvidencePlan, errors)
  checkRollbackOrSunset(sample.rollbackOrSunset, errors)

  if (sample.repeatEscape && !['new-control-provisional', 'emergency-active'].includes(sample.preventionDecision)) {
    errors.push('repeat-escape-requires-new-or-emergency-control')
  }
  if (sample.preventionDecision === 'new-control-provisional' && !['planned', 'collecting'].includes(prospective.status)) {
    errors.push('provisional-control-requires-prospective-plan')
  }
  if (sample.preventionDecision === 'no-new-control') {
    if (!NO_NEW_CONTROL_REASONS.has(sample.noNewControlReason)) errors.push('no-new-control-reason-invalid')
    if (!hasTextList(sample.noNewControlEvidence)) errors.push('no-new-control-evidence-required')
    if (prospective.status !== 'not-required') errors.push('no-new-control-prospective-status-invalid')
  }
  if (sample.preventionDecision === 'existing-control-restored' && prospective.status === 'sufficient' && prospective.currentEventOnly) {
    errors.push('restored-control-current-rerun-not-effectiveness-proof')
  }
  if (sample.preventionDecision === 'emergency-active') {
    const emergencyRisk = ['high', 'critical'].includes(sample.riskClass) && (sample.riskTags || []).some(tag => ['p0', 'security', 'control-plane'].includes(tag))
    if (!emergencyRisk) errors.push('emergency-active-risk-ineligible')
    if (sample.mode !== 'full') errors.push('emergency-active-full-mode-required')
    if (!hasText(sample.emergencyAuthorizationEvidence)) errors.push('emergency-authorization-required')
    if (prospective.status === 'not-required') errors.push('emergency-active-prospective-followup-required')
  }

  let lifecycleState = 'invalid'
  if (sample.preventionDecision === 'existing-control-restored') lifecycleState = 'existing-active-control'
  if (sample.preventionDecision === 'new-control-provisional') lifecycleState = 'gray'
  if (sample.preventionDecision === 'no-new-control') lifecycleState = 'none'
  if (sample.preventionDecision === 'emergency-active') lifecycleState = 'active-expiring'

  let effectivenessStatus = 'prospective-pending'
  if (sample.preventionDecision === 'no-new-control') effectivenessStatus = 'not-applicable'
  else if (prospective.currentEventOnly) effectivenessStatus = 'retrospective-only'
  else if (prospective.status === 'sufficient' && prospective.enough) effectivenessStatus = 'prospective-sufficient'

  return {
    valid: errors.length === 0,
    errors,
    requiredMode: mode,
    lifecycleState: errors.length === 0 ? lifecycleState : 'invalid',
    immediateClosureEligible: errors.length === 0 && hasTextList(sample.immediateClosureEvidence),
    effectivenessStatus
  }
}

module.exports = {
  assessRepairPrevention,
  requiredMode
}
