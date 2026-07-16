'use strict'

const INTENT_DECISION_SCHEMA_VERSION = 'IntentConsistencyDecisionV1'
const EVIDENCE_PRIORITY = Object.freeze([
  'user-current',
  'confirmed-requirement-or-proposal',
  'phase',
  'route-hint',
  'history'
])
const CONFIRM_ACTIONS = new Set(['confirm', 'continue'])
const SHORT_CONFIRMATIONS = new Set(['确认', '继续', '同意', '好的', '可以', 'yes', 'y', 'ok'])

function normalizedConfidence(value) {
  if (Number.isFinite(value)) return Math.max(0, Math.min(1, value))
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high') return 1
  if (normalized === 'medium') return 0.7
  if (normalized === 'low') return 0.3
  return 0
}

function isShortConfirmation(value) {
  return SHORT_CONFIRMATIONS.has(String(value || '').trim().toLowerCase())
}

function buildEvidence(input) {
  const evidence = []
  if (String(input.userText || '').trim()) {
    evidence.push({ source: 'user-current', value: String(input.userText).trim() })
  }
  if (input.requirementRef || input.proposalRef) {
    evidence.push({
      source: 'confirmed-requirement-or-proposal',
      requirementRef: String(input.requirementRef || ''),
      proposalRef: String(input.proposalRef || '')
    })
  }
  if (input.phase) evidence.push({ source: 'phase', value: String(input.phase) })
  for (const value of Array.isArray(input.routeHints) ? input.routeHints : []) {
    evidence.push({ source: 'route-hint', value: String(value) })
  }
  for (const value of Array.isArray(input.historyRefs) ? input.historyRefs : []) {
    evidence.push({ source: 'history', value: String(value) })
  }
  return evidence.sort((left, right) => EVIDENCE_PRIORITY.indexOf(left.source) - EVIDENCE_PRIORITY.indexOf(right.source))
}

function evidenceRows(source, values) {
  return (Array.isArray(values) ? values : []).map(value => ({ source, value: String(value) }))
}

function failedDecision(status, errorCode, reason, nextStep, input, evidence) {
  return {
    schemaVersion: INTENT_DECISION_SCHEMA_VERSION,
    ok: false,
    status,
    selected: null,
    ignored: [
      ...evidenceRows('route-hint', input.routeHints),
      ...evidenceRows('history', input.historyRefs)
    ],
    reason,
    evidence,
    errorCode,
    nextStep
  }
}

/**
 * Validate an already-normalized intent against explicit proposal, requirement,
 * phase and confidence evidence. This contract never substitutes keyword
 * matching for semantic intent classification performed by the caller.
 */
function evaluateIntentConsistency(input = {}) {
  const semanticAction = String(input.semanticAction || '').trim().toLowerCase()
  const phase = String(input.phase || '').trim()
  const proposalRef = String(input.proposalRef || '').trim()
  const requirementRef = String(input.requirementRef || '').trim()
  const confidence = normalizedConfidence(input.confidence)
  const evidence = buildEvidence(input)

  if (!semanticAction || !phase) {
    return failedDecision(
      'clarify',
      'INTENT_STATE_MISSING',
      'Intent consistency requires both semanticAction and phase.',
      'Restore the normalized semantic action and active phase before evaluating the transition.',
      input,
      evidence
    )
  }
  if (confidence < 0.6) {
    return failedDecision(
      'clarify',
      'INTENT_LOW_CONFIDENCE',
      'Intent confidence is insufficient for a state transition.',
      'Clarify the intended action and bind it to the active proposal and requirement.',
      input,
      evidence
    )
  }
  if (input.expectedPhase && phase !== String(input.expectedPhase)) {
    return failedDecision(
      'blocked',
      'INTENT_PHASE_MISMATCH',
      `Intent phase ${phase || '(missing)'} does not match ${input.expectedPhase}.`,
      `Return to ${input.expectedPhase} or refresh the active phase evidence.`,
      input,
      evidence
    )
  }
  if (input.expectedRequirementRef && requirementRef !== String(input.expectedRequirementRef)) {
    return failedDecision(
      'blocked',
      'INTENT_REQUIREMENT_MISMATCH',
      'Intent requirement reference does not match the active requirement.',
      'Reload the active requirement and ask for confirmation against that exact reference.',
      input,
      evidence
    )
  }
  if ((CONFIRM_ACTIONS.has(semanticAction) || isShortConfirmation(input.userText)) && (!proposalRef || !requirementRef)) {
    return failedDecision(
      'clarify',
      'INTENT_STATE_MISSING',
      'A confirmation transition requires both proposalRef and requirementRef.',
      'Restore the active proposal and requirement references before accepting confirmation.',
      input,
      evidence
    )
  }

  return {
    schemaVersion: INTENT_DECISION_SCHEMA_VERSION,
    ok: true,
    status: 'matched',
    selected: {
      semanticAction,
      proposalRef: proposalRef || null,
      requirementRef: requirementRef || null,
      phase: phase || null,
      binding: isShortConfirmation(input.userText) ? 'short-confirmation' : 'explicit-intent'
    },
    ignored: [
      ...evidenceRows('route-hint', input.routeHints),
      ...evidenceRows('history', input.historyRefs)
    ],
    reason: 'Current user evidence is consistent with the active requirement, proposal and phase.',
    evidence,
    errorCode: null,
    nextStep: null
  }
}

module.exports = {
  EVIDENCE_PRIORITY,
  INTENT_DECISION_SCHEMA_VERSION,
  evaluateIntentConsistency,
  isShortConfirmation,
  normalizedConfidence
}
