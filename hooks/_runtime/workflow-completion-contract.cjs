'use strict'

const path = require('path')

const {
  buildJsonContentIdentity,
  matchesContentIdentity,
  sha256,
  stableStringify,
  validateContentIdentity
} = require('./content-identity.cjs')
const {
  digest: actualInstructionDigest,
  separateEmbeddedEvidence,
  validateActualInstructionEnvelope
} = require('./actual-instruction-envelope.cjs')

const SCHEMAS = Object.freeze({
  candidate: 'WorkflowCompletionCandidateV1',
  plan: 'WorkflowCompletionPlanV1',
  receipt: 'WorkflowEvidenceReceiptV1',
  snapshot: 'WorkflowCompletionSnapshotV1',
  phase: 'PhaseTerminalStateV1',
  risk: 'RiskAcceptanceReceiptV1',
  commit: 'WorkflowCompletionCommitV1',
  commitValidation: 'CommitValidationResultV1',
  projection: 'WorkflowCompletionProjectionV1',
  shadow: 'ShadowEvidenceWindowV1',
  verificationIntent: 'VerificationIntentV2',
  verificationIntentV1: 'VerificationIntentV1',
  validationControlIngress: 'ValidationControlIngressReceiptV1'
})

const STATUS = new Set(['PASS', 'WARN', 'BLOCK', 'UNVERIFIED', 'N/A'])
const WORKFLOWS = new Set(['dev', 'fix', 'audit', 'analyze', 'self-fix', 'other'])
const STAGES = new Set(['planning', 'implementation', 'ecr', 'delivery', 'release'])
const APPLICABILITY = new Set(['required', 'optional', 'N/A'])
const RECEIPT_RESULTS = new Set(['passed', 'failed', 'inconclusive', 'skipped'])
const SOURCE_KINDS = new Set(['cp', 'attempt', 'validation', 'review', 'checkpoint', 'sync', 'delivery', 'manual'])
const ROLLOUT_MODES = new Set(['off', 'shadow', 'enforce', 'rolled-back'])
const VERIFICATION_LEVELS = new Set(['V0', 'V1', 'V2', 'V3'])
const VERIFICATION_PURPOSES = new Set(['edit-loop', 'delivery', 'boundary', 'full-audit', 'release'])
const VERIFICATION_RISK_CLASSES = new Set(['normal', 'high', 'release', 'security', 'destructive'])
const VERIFICATION_REQUESTER_CLASSES = new Set(['ai-hook', 'human-cli', 'trusted-ci', 'release-pipeline'])
const VERIFICATION_CLAIM_CEILINGS = Object.freeze({
  V0: 'edit-evidence-only',
  V1: 'delivery-scope',
  V2: 'boundary-qualified',
  V3: 'full-audit'
})
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
const DIGEST = /^[a-f0-9]{64}$/
const CANDIDATE_ID = /^workflow-candidate-[a-f0-9]{64}$/
const REQUIREMENT_ID = /^[a-z][a-z0-9.-]*(?::[A-Za-z0-9._-]+)?$/
const PHASE_FIELDS = Object.freeze({
  turn: 'turnTerminal',
  execution: 'executionTerminal',
  workflow: 'workflowComplete',
  release: 'releaseReady'
})
const BLOCKING_RANK = Object.freeze({
  NON_WAIVABLE_BLOCK: 0,
  REQUIRED_BLOCK: 1,
  REQUIRED_UNVERIFIED: 2,
  WARN: 3,
  PASS: 4,
  NA: 5
})

class WorkflowCompletionError extends Error {
  constructor(code, message, details = []) {
    super(message)
    this.name = 'WorkflowCompletionError'
    this.code = code
    this.details = details
  }
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function digest(value) {
  return sha256(stableStringify(value))
}

function zonedDateTime(value) {
  return text(value) && ZONED_DATE_TIME.test(value) && Number.isFinite(Date.parse(value))
}

function uniqueTextList(value, { maxItems = Infinity } = {}) {
  return Array.isArray(value) && value.length <= maxItems && value.every(text) && new Set(value).size === value.length
}

function validBindings(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 &&
    Object.entries(value).every(([key, valueDigest]) => text(key) && DIGEST.test(valueDigest))
}

function sortedBindings(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)))
}

function sortedUnique(values) {
  return [...new Set(values || [])].sort((left, right) => String(left).localeCompare(String(right)))
}

function without(object, fields) {
  return Object.fromEntries(Object.entries(object || {}).filter(([key]) => !fields.includes(key)))
}

function validation(valid, errors) {
  return { valid, errors: [...new Set(errors)] }
}

function requireValid(result, code, message) {
  if (!result.valid) throw new WorkflowCompletionError(code, message, result.errors)
}

function validationProjectRootIdentity(root) {
  let normalizedRoot = path.resolve(String(root || '')).replace(/\\/g, '/')
  if (process.platform === 'win32') normalizedRoot = normalizedRoot.toLowerCase()
  const core = { schemaVersion: 'ProjectRootIdentityV1', normalizedRoot }
  return Object.freeze({ ...core, digest: digest(core) })
}

function normalizeValidationControlInstruction(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
}

function classifyValidationControlInstruction(value) {
  const normalized = normalizeValidationControlInstruction(value)
  const compact = normalized.replace(/[。！!]+$/g, '').trim()
  if (/^(?:先)?(?:暂停|别急|停止|先停一下|pause|stop)(?:\b|下|一下|验证|执行|当前)/i.test(compact) ||
      /^(?:请)?缩小(?:验证)?范围/i.test(compact)) {
    return { action: 'revoke', reason: 'user-pause-stop-or-scope-reduction' }
  }
  if (/^(?:确认当前验证卡|确认当前\s*budgetcard|确认当前\s*budget\s*card)$/i.test(compact)) {
    return { action: 'confirm-current-budget', reason: 'exact-current-budget-confirmation' }
  }
  return { action: 'none', reason: 'no-validation-control-instruction' }
}

function validateValidationControlIngressReceipt(receipt, binding = null, options = {}) {
  const errors = []
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return validation(false, ['validation-control-ingress-invalid'])
  }
  if (receipt.schemaVersion !== SCHEMAS.validationControlIngress) errors.push('validation-control-ingress-schema-invalid')
  for (const field of [
    'envelopeId', 'envelopeDigest', 'sourceMessageDigest', 'hostSessionDigest', 'contextEpoch',
    'taskRecoveryKey', 'project', 'receiptDigest'
  ]) {
    if (!text(receipt[field])) errors.push(`validation-control-ingress-${field}-required`)
  }
  for (const field of ['envelopeDigest', 'sourceMessageDigest', 'hostSessionDigest', 'receiptDigest']) {
    if (!DIGEST.test(String(receipt[field] || ''))) errors.push(`validation-control-ingress-${field}-invalid`)
  }
  if (!['confirm', 'auto'].includes(receipt.executionMode)) errors.push('validation-control-ingress-mode-invalid')
  if (!['none', 'confirm-current-budget', 'auto-authorize', 'revoke'].includes(receipt.action)) errors.push('validation-control-ingress-action-invalid')
  if (!['none', 'user-confirmation', 'auto'].includes(receipt.authorityKind)) errors.push('validation-control-ingress-authority-kind-invalid')
  if (receipt.action === 'confirm-current-budget' && receipt.authorityKind !== 'user-confirmation') {
    errors.push('validation-control-ingress-confirm-authority-invalid')
  }
  if (receipt.action === 'auto-authorize') {
    if (receipt.authorityKind !== 'auto' || !text(receipt.autoAuthorityRef)) errors.push('validation-control-ingress-auto-authority-invalid')
  } else if (receipt.autoAuthorityRef !== null) errors.push('validation-control-ingress-auto-ref-unexpected')
  if (receipt.action === 'revoke' && receipt.revocationRequested !== true) errors.push('validation-control-ingress-revocation-invalid')
  if (receipt.action !== 'revoke' && receipt.revocationRequested !== false) errors.push('validation-control-ingress-revocation-unexpected')
  if (receipt.authorityCeiling !== 'V2') errors.push('validation-control-ingress-ceiling-invalid')
  if (!zonedDateTime(receipt.issuedAt) || !zonedDateTime(receipt.expiresAt) ||
      Date.parse(receipt.expiresAt) <= Date.parse(receipt.issuedAt)) errors.push('validation-control-ingress-time-invalid')
  const root = receipt.projectRootIdentity
  if (!root || root.schemaVersion !== 'ProjectRootIdentityV1' || !text(root.normalizedRoot) ||
      !DIGEST.test(String(root.digest || '')) || root.digest !== digest({ schemaVersion: root.schemaVersion, normalizedRoot: root.normalizedRoot })) {
    errors.push('validation-control-ingress-project-root-invalid')
  }
  const core = without(receipt, ['receiptDigest'])
  if (DIGEST.test(String(receipt.receiptDigest || '')) && digest(core) !== receipt.receiptDigest) errors.push('validation-control-ingress-digest-mismatch')
  if (binding) {
    for (const field of ['hostSessionDigest', 'contextEpoch', 'taskRecoveryKey', 'project']) {
      if (Object.hasOwn(binding, field) && binding[field] !== receipt[field]) errors.push(`validation-control-ingress-binding-mismatch:${field}`)
    }
    if (binding.projectRootIdentity && stableStringify(binding.projectRootIdentity) !== stableStringify(root)) {
      errors.push('validation-control-ingress-binding-mismatch:projectRootIdentity')
    }
  }
  if (Number.isFinite(options.now) && Date.parse(receipt.expiresAt) <= options.now) errors.push('validation-control-ingress-expired')
  return validation(errors.length === 0, errors)
}

function createValidationControlIngressReceipt(input = {}, options = {}) {
  const envelope = input.actualInstructionEnvelope
  const envelopeValidation = validateActualInstructionEnvelope(envelope)
  requireValid(envelopeValidation, 'VALIDATION_CONTROL_ENVELOPE_INVALID', 'validation control requires one valid ActualInstructionEnvelope')
  if (envelope.authorityScope !== 'trusted-host-workflow-ingress' || envelope.instructionAuthority !== true) {
    throw new WorkflowCompletionError('VALIDATION_CONTROL_ENVELOPE_UNTRUSTED', 'validation control requires the current trusted host user-instruction event')
  }
  const separated = separateEmbeddedEvidence(input.actualInstruction)
  if (actualInstructionDigest(separated.instruction) !== envelope.actualInstructionDigest) {
    throw new WorkflowCompletionError('VALIDATION_CONTROL_INSTRUCTION_MISMATCH', 'validation control text does not match the current ActualInstructionEnvelope')
  }
  const classified = classifyValidationControlInstruction(separated.instruction)
  const executionMode = input.executionMode === 'auto' ? 'auto' : 'confirm'
  const action = classified.action === 'revoke'
    ? 'revoke'
    : (classified.action === 'confirm-current-budget'
        ? 'confirm-current-budget'
        : (executionMode === 'auto' ? 'auto-authorize' : 'none'))
  const authorityKind = action === 'confirm-current-budget'
    ? 'user-confirmation'
    : (action === 'auto-authorize' ? 'auto' : 'none')
  const projectRoot = input.projectRootIdentity || validationProjectRootIdentity(input.projectRoot)
  const issuedAt = input.issuedAt || envelope.issuedAt
  const requestedTtlMs = Number.isFinite(options.ttlMs) ? Math.max(1000, options.ttlMs) : 15 * 60 * 1000
  const expiresAtMs = Math.min(Date.parse(envelope.expiresAt), Date.parse(issuedAt) + requestedTtlMs)
  const autoAuthorityRef = authorityKind === 'auto'
    ? `validation-auto:${digest({
        schemaVersion: 'ValidationAutoAuthorityRefV1',
        envelopeDigest: envelope.envelopeDigest,
        hostSessionDigest: envelope.hostSessionDigest,
        contextEpoch: envelope.contextEpoch,
        taskRecoveryKey: String(input.taskRecoveryKey || ''),
        project: String(input.project || ''),
        projectRootIdentity: projectRoot,
        authorityCeiling: 'V2'
      })}`
    : null
  const core = {
    schemaVersion: SCHEMAS.validationControlIngress,
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.envelopeDigest,
    sourceMessageDigest: envelope.actualInstructionDigest,
    hostSessionDigest: envelope.hostSessionDigest,
    contextEpoch: String(envelope.contextEpoch || ''),
    taskRecoveryKey: String(input.taskRecoveryKey || ''),
    project: String(input.project || ''),
    projectRootIdentity: projectRoot,
    executionMode,
    action,
    authorityKind,
    authorityCeiling: 'V2',
    autoAuthorityRef,
    revocationRequested: action === 'revoke',
    reason: classified.reason,
    issuedAt,
    expiresAt: new Date(expiresAtMs).toISOString()
  }
  const receipt = Object.freeze({ ...core, receiptDigest: digest(core) })
  const receiptValidation = validateValidationControlIngressReceipt(receipt)
  requireValid(receiptValidation, 'VALIDATION_CONTROL_RECEIPT_INVALID', 'validation control ingress receipt is invalid')
  return receipt
}

function applyValidationControlIngress(state, receipt) {
  const receiptValidation = validateValidationControlIngressReceipt(receipt)
  requireValid(receiptValidation, 'VALIDATION_CONTROL_RECEIPT_INVALID', 'validation control ingress receipt is invalid')
  state.validationControlIngress = receipt
  if (receipt.action !== 'revoke') return state
  const current = state.validationExecution || {}
  const continuation = current.continuationAuthorization
  state.validationExecution = {
    ...current,
    schemaVersion: current.schemaVersion || 'ValidationExecutionTaskStateV1',
    revocationEpoch: Number(current.revocationEpoch || 0) + 1,
    pendingBudgetCard: null,
    currentLease: null,
    runnerState: null,
    continuationAuthorization: continuation?.schemaVersion === 'ValidationContinuationAuthorizationV1' &&
        ['prepared', 'leased'].includes(continuation.status)
      ? { ...continuation, status: 'revoked' }
      : continuation || null,
    updatedAt: receipt.issuedAt
  }
  return state
}

/** Own the requested evidence boundary without granting execution authority. */
function createVerificationIntent(input = {}) {
  const requestedLevel = String(input.requestedLevel || input.level || '')
  const requestedPurpose = String(input.requestedPurpose || input.purpose || '')
  const affectedBoundaries = sortedUnique((input.affectedBoundaries || []).map(String))
  const riskClass = String(input.riskClass || 'normal')
  const requesterClass = String(input.requesterClass || 'human-cli')
  const requestSourceRef = String(input.requestSourceRef || input.authoritySource || '')
  const project = String(input.project || '')
  const taskRecoveryKey = input.taskRecoveryKey == null ? null : String(input.taskRecoveryKey)
  const contextEpoch = input.contextEpoch == null ? null : String(input.contextEpoch)
  const candidateId = String(input.candidateId || '')
  const changedScopeDigest = String(input.changedScopeDigest || '')
  const claimCeiling = requestedPurpose === 'release'
    ? 'release-candidate'
    : VERIFICATION_CLAIM_CEILINGS[requestedLevel]
  const semanticIntent = {
    schemaVersion: SCHEMAS.verificationIntent,
    requesterClass,
    requestedLevel,
    requestedPurpose,
    affectedBoundaries,
    riskClass,
    requestSourceRef,
    project,
    taskRecoveryKey,
    contextEpoch,
    candidateId,
    changedScopeDigest,
    claimCeiling
  }
  const intent = Object.freeze({
    ...semanticIntent,
    requestDigest: digest(semanticIntent)
  })
  requireValid(validateVerificationIntent(intent), 'VERIFICATION_INTENT_INVALID', 'verification intent is invalid')
  return intent
}

function validateVerificationIntent(intent) {
  const errors = []
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    return validation(false, ['verification-intent-invalid'])
  }
  if (intent.schemaVersion === SCHEMAS.verificationIntentV1) return validateVerificationIntentV1(intent)
  if (intent.schemaVersion !== SCHEMAS.verificationIntent) errors.push('verification-intent-schema-invalid')
  if (!VERIFICATION_REQUESTER_CLASSES.has(intent.requesterClass)) errors.push('verification-requester-class-invalid')
  if (!VERIFICATION_LEVELS.has(intent.requestedLevel)) errors.push('verification-level-invalid')
  if (!VERIFICATION_PURPOSES.has(intent.requestedPurpose)) errors.push('verification-purpose-invalid')
  if (!uniqueTextList(intent.affectedBoundaries || [], { maxItems: 32 })) errors.push('verification-boundaries-invalid')
  if (!VERIFICATION_RISK_CLASSES.has(intent.riskClass)) errors.push('verification-risk-invalid')
  if (!text(intent.requestSourceRef) || intent.requestSourceRef.length > 1024) errors.push('verification-request-source-required')
  if (!text(intent.project) || intent.project.length > 255) errors.push('verification-project-required')
  if (intent.taskRecoveryKey !== null && (!text(intent.taskRecoveryKey) || intent.taskRecoveryKey.length > 256)) errors.push('verification-task-key-invalid')
  if (intent.contextEpoch !== null && (!text(intent.contextEpoch) || intent.contextEpoch.length > 256)) errors.push('verification-context-epoch-invalid')
  if (!text(intent.candidateId) || intent.candidateId.length > 256) errors.push('verification-candidate-invalid')
  if (!DIGEST.test(intent.changedScopeDigest || '')) errors.push('verification-changed-scope-digest-invalid')
  if (intent.requestedLevel === 'V3' && !['full-audit', 'release'].includes(intent.requestedPurpose)) {
    errors.push('verification-v3-purpose-invalid')
  } else if (intent.requestedLevel !== 'V3' && ['full-audit', 'release'].includes(intent.requestedPurpose)) {
    errors.push('verification-v3-purpose-without-v3')
  }
  const expectedCeiling = intent.requestedPurpose === 'release'
    ? 'release-candidate'
    : VERIFICATION_CLAIM_CEILINGS[intent.requestedLevel]
  if (intent.claimCeiling !== expectedCeiling) errors.push('verification-claim-ceiling-invalid')
  if (!DIGEST.test(intent.requestDigest || '')) errors.push('verification-request-digest-invalid')
  if (errors.length === 0) {
    const semanticIntent = without(intent, ['requestDigest'])
    if (digest(semanticIntent) !== intent.requestDigest) errors.push('verification-request-digest-mismatch')
  }
  return validation(errors.length === 0, errors)
}

/** Historical receipts remain readable, but their booleans never become execution authority. */
function validateVerificationIntentV1(intent) {
  const errors = []
  if (intent?.schemaVersion !== SCHEMAS.verificationIntentV1) errors.push('verification-intent-schema-invalid')
  if (!VERIFICATION_LEVELS.has(intent?.level)) errors.push('verification-level-invalid')
  if (!VERIFICATION_PURPOSES.has(intent?.purpose)) errors.push('verification-purpose-invalid')
  if (!uniqueTextList(intent?.affectedBoundaries || [], { maxItems: 32 })) errors.push('verification-boundaries-invalid')
  if (!VERIFICATION_RISK_CLASSES.has(intent?.riskClass)) errors.push('verification-risk-invalid')
  if (typeof intent?.releaseAuthorized !== 'boolean') errors.push('verification-release-authorization-invalid')
  if (typeof intent?.explicitFullAudit !== 'boolean') errors.push('verification-full-audit-authorization-invalid')
  if (!text(intent?.authoritySource)) errors.push('verification-authority-source-required')
  const expectedCeiling = intent?.purpose === 'release'
    ? 'release-candidate'
    : VERIFICATION_CLAIM_CEILINGS[intent?.level]
  if (intent?.claimCeiling !== expectedCeiling) errors.push('verification-claim-ceiling-invalid')
  if (!DIGEST.test(intent?.authorizationDigest || '')) errors.push('verification-authorization-digest-invalid')
  if (!DIGEST.test(intent?.intentDigest || '')) errors.push('verification-intent-digest-invalid')
  if (errors.length === 0) {
    if (digest(without(intent, ['authorizationDigest', 'intentDigest'])) !== intent.intentDigest) {
      errors.push('verification-intent-digest-mismatch')
    }
    const expectedAuthorization = digest({
      level: intent.level,
      purpose: intent.purpose,
      releaseAuthorized: intent.releaseAuthorized,
      explicitFullAudit: intent.explicitFullAudit,
      authoritySource: intent.authoritySource
    })
    if (expectedAuthorization !== intent.authorizationDigest) errors.push('verification-authorization-digest-mismatch')
  }
  return validation(errors.length === 0, errors)
}

function validateTaskScope(scope) {
  const errors = []
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return validation(false, ['task-scope-invalid'])
  if (!text(scope.project)) errors.push('task-project-required')
  if (!['requirements', 'bugs', 'optimizations', 'tasks'].includes(scope.kind)) errors.push('task-kind-invalid')
  if (scope.taskId !== null && !text(scope.taskId)) errors.push('task-id-invalid')
  if (!text(scope.relativeTaskPath)) errors.push('task-path-required')
  if (!DIGEST.test(scope.legacyKey || '')) errors.push('task-legacy-key-invalid')
  const identity = validateContentIdentity(scope.sourceIdentity)
  if (!identity.valid) errors.push(...identity.errors.map(item => `task-source-${item}`))
  return validation(errors.length === 0, errors)
}

/** Build the stable candidate identity from task scope and component digests. */
function createWorkflowCompletionCandidate(input) {
  const taskValidation = validateTaskScope(input?.taskScope)
  if (!validBindings(input?.components)) taskValidation.errors.push('candidate-components-invalid')
  requireValid(validation(taskValidation.errors.length === 0, taskValidation.errors), 'CANDIDATE_INVALID', 'workflow candidate input is invalid')
  const payload = {
    schemaVersion: SCHEMAS.candidate,
    taskScope: input.taskScope,
    components: sortedBindings(input.components),
    stable: input.stable !== false
  }
  const { identity } = buildJsonContentIdentity({
    sourceKey: `workflow-candidate:${input.taskScope.legacyKey}`,
    value: payload,
    contractVersion: '1'
  })
  return Object.freeze({
    ...payload,
    candidateIdentity: identity,
    candidateId: `workflow-candidate-${identity.digest}`
  })
}

function validateWorkflowCompletionCandidate(candidate) {
  const errors = []
  if (candidate?.schemaVersion !== SCHEMAS.candidate) errors.push('candidate-schema-invalid')
  errors.push(...validateTaskScope(candidate?.taskScope).errors)
  if (!validBindings(candidate?.components)) errors.push('candidate-components-invalid')
  if (typeof candidate?.stable !== 'boolean') errors.push('candidate-stable-invalid')
  const identityValidation = validateContentIdentity(candidate?.candidateIdentity)
  if (!identityValidation.valid) errors.push('candidate-identity-invalid')
  if (!CANDIDATE_ID.test(candidate?.candidateId || '')) errors.push('candidate-id-invalid')
  if (errors.length === 0) {
    const payload = {
      schemaVersion: SCHEMAS.candidate,
      taskScope: candidate.taskScope,
      components: sortedBindings(candidate.components),
      stable: candidate.stable
    }
    if (!matchesContentIdentity(candidate.candidateIdentity, stableStringify(payload))) errors.push('candidate-identity-mismatch')
    if (candidate.candidateId !== `workflow-candidate-${candidate.candidateIdentity.digest}`) errors.push('candidate-id-mismatch')
  }
  return validation(errors.length === 0, errors)
}

function validateRequirement(requirement, candidate) {
  const errors = []
  if (!REQUIREMENT_ID.test(requirement?.requirementId || '')) errors.push('requirement-id-invalid')
  if (requirement?.alias !== null && !/^T(?:[1-9]|1[0-3])$/.test(requirement?.alias || '')) errors.push('requirement-alias-invalid')
  if (!Number.isInteger(requirement?.planOrder) || requirement.planOrder < 0) errors.push('requirement-plan-order-invalid')
  if (!APPLICABILITY.has(requirement?.applicability?.decision)) errors.push('applicability-decision-invalid')
  for (const field of ['authority', 'reason', 'owner']) {
    if (!text(requirement?.applicability?.[field])) errors.push(`applicability-${field}-required`)
  }
  if (requirement?.applicability?.evaluatedAtCandidate !== candidate?.candidateId) errors.push('applicability-candidate-mismatch')
  if (!validBindings(requirement?.dependencyBindings)) errors.push('requirement-dependencies-invalid')
  else if (Object.entries(requirement.dependencyBindings).some(([key, value]) => candidate?.components?.[key] !== value)) {
    errors.push('requirement-dependency-mismatch')
  }
  if (typeof requirement?.nonWaivable !== 'boolean') errors.push('requirement-nonwaivable-invalid')
  return validation(errors.length === 0, errors)
}

/** Create a candidate-bound, deterministically ordered completion plan. */
function createWorkflowCompletionPlan(input) {
  requireValid(validateWorkflowCompletionCandidate(input?.candidate), 'PLAN_CANDIDATE_INVALID', 'completion plan candidate is invalid')
  const requirements = (input?.requirements || []).map(item => ({
    requirementId: item.requirementId,
    alias: item.alias ?? null,
    planOrder: item.planOrder,
    applicability: { ...item.applicability, evaluatedAtCandidate: input.candidate.candidateId },
    dependencyBindings: sortedBindings(item.dependencyBindings),
    nonWaivable: item.nonWaivable === true
  }))
  const core = {
    schemaVersion: SCHEMAS.plan,
    candidateId: input.candidate.candidateId,
    workflow: input.workflow || '',
    intent: input.intent || '',
    stage: input.stage || '',
    requirements,
    ruleSetDigest: input.ruleSetDigest || ''
  }
  const plan = { ...core, planDigest: digest(core) }
  requireValid(validateWorkflowCompletionPlan(plan, input.candidate), 'PLAN_INVALID', 'workflow completion plan is invalid')
  return Object.freeze(plan)
}

function validateWorkflowCompletionPlan(plan, candidate) {
  const errors = []
  if (plan?.schemaVersion !== SCHEMAS.plan) errors.push('plan-schema-invalid')
  if (!CANDIDATE_ID.test(plan?.candidateId || '')) errors.push('plan-candidate-invalid')
  if (candidate && plan?.candidateId !== candidate.candidateId) errors.push('plan-candidate-mismatch')
  if (!WORKFLOWS.has(plan?.workflow)) errors.push('plan-workflow-invalid')
  if (!text(plan?.intent)) errors.push('plan-intent-required')
  if (!STAGES.has(plan?.stage)) errors.push('plan-stage-invalid')
  if (!DIGEST.test(plan?.ruleSetDigest || '')) errors.push('plan-ruleset-invalid')
  if (!Array.isArray(plan?.requirements) || plan.requirements.length === 0) errors.push('plan-requirements-required')
  else {
    const ids = plan.requirements.map(item => item.requirementId)
    const orders = plan.requirements.map(item => item.planOrder)
    const aliases = plan.requirements.map(item => item.alias).filter(Boolean)
    if (new Set(ids).size !== ids.length) errors.push('plan-requirement-duplicate')
    if (new Set(orders).size !== orders.length) errors.push('plan-order-duplicate')
    if (new Set(aliases).size !== aliases.length) errors.push('plan-alias-duplicate')
    if (candidate) {
      for (const item of plan.requirements) errors.push(...validateRequirement(item, candidate).errors.map(error => `${item.requirementId || 'unknown'}:${error}`))
    }
  }
  if (!DIGEST.test(plan?.planDigest || '')) errors.push('plan-digest-invalid')
  else if (plan.planDigest !== digest(without(plan, ['planDigest']))) errors.push('plan-digest-mismatch')
  return validation(errors.length === 0, errors)
}

function validateQualification(qualification) {
  const errors = []
  if (!['E1', 'E2', 'E3', 'E4', 'E5'].includes(qualification?.level)) errors.push('qualification-level-invalid')
  for (const field of ['satisfiesRequired', 'trusted', 'observable', 'warning']) {
    if (typeof qualification?.[field] !== 'boolean') errors.push(`qualification-${field}-invalid`)
  }
  if (qualification?.level === 'E5' && qualification?.satisfiesRequired) errors.push('qualification-e5-cannot-satisfy-required')
  if (qualification?.satisfiesRequired && !qualification?.observable) errors.push('qualification-required-must-be-observable')
  return validation(errors.length === 0, errors)
}

function sourceDigest(sourceIdentity) {
  if (sourceIdentity === undefined || sourceIdentity === null) return ''
  return sourceIdentity?.schemaVersion === 'ContentIdentityV1'
    ? sourceIdentity.digest
    : digest(sourceIdentity)
}

function createWorkflowEvidenceReceipt(input) {
  const core = {
    schemaVersion: SCHEMAS.receipt,
    requirementId: input?.requirementId,
    observedCandidateId: input?.observedCandidateId,
    dependencyBindings: sortedBindings(input?.dependencyBindings),
    sourceKind: input?.sourceKind,
    sourceSchema: input?.sourceSchema,
    sourceIdentity: input?.sourceIdentity,
    sourceDigest: input?.sourceDigest || sourceDigest(input?.sourceIdentity),
    result: input?.result,
    observedAt: input?.observedAt,
    actor: input?.actor,
    host: input?.host,
    runId: input?.runId,
    evidenceRefs: sortedUnique(input?.evidenceRefs),
    qualification: input?.qualification
  }
  requireValid(validateWorkflowEvidenceReceipt(core), 'EVIDENCE_RECEIPT_INVALID', 'workflow evidence receipt is invalid')
  return Object.freeze(core)
}

function validateWorkflowEvidenceReceipt(receipt, { now = Date.now() } = {}) {
  const errors = []
  if (receipt?.schemaVersion !== SCHEMAS.receipt) errors.push('receipt-schema-invalid')
  if (!REQUIREMENT_ID.test(receipt?.requirementId || '')) errors.push('receipt-requirement-invalid')
  if (!CANDIDATE_ID.test(receipt?.observedCandidateId || '')) errors.push('receipt-candidate-invalid')
  if (!validBindings(receipt?.dependencyBindings)) errors.push('receipt-dependencies-invalid')
  if (!SOURCE_KINDS.has(receipt?.sourceKind)) errors.push('receipt-source-kind-invalid')
  if (!text(receipt?.sourceSchema)) errors.push('receipt-source-schema-required')
  if (!(text(receipt?.sourceIdentity) || validateContentIdentity(receipt?.sourceIdentity).valid)) errors.push('receipt-source-identity-invalid')
  if (!DIGEST.test(receipt?.sourceDigest || '') || receipt?.sourceDigest !== sourceDigest(receipt?.sourceIdentity)) errors.push('receipt-source-digest-mismatch')
  if (!RECEIPT_RESULTS.has(receipt?.result)) errors.push('receipt-result-invalid')
  if (!zonedDateTime(receipt?.observedAt)) errors.push('receipt-observed-at-invalid')
  else if (Date.parse(receipt.observedAt) > now + 5 * 60 * 1000) errors.push('receipt-observed-at-future')
  for (const field of ['actor', 'host', 'runId']) if (!text(receipt?.[field])) errors.push(`receipt-${field}-required`)
  if (!uniqueTextList(receipt?.evidenceRefs, { maxItems: 100 })) errors.push('receipt-evidence-refs-invalid')
  errors.push(...validateQualification(receipt?.qualification).errors)
  return validation(errors.length === 0, errors)
}

function evaluateReceiptFreshness(receipt, candidate, requirement, options = {}) {
  const receiptValidation = validateWorkflowEvidenceReceipt(receipt, options)
  if (!receiptValidation.valid) return { freshness: 'invalid', fresh: false, reboundFromCandidateId: null, reasons: receiptValidation.errors }
  if (receipt.requirementId !== requirement.requirementId) {
    return { freshness: 'invalid', fresh: false, reboundFromCandidateId: null, reasons: ['receipt-requirement-mismatch'] }
  }
  const bindingKeys = new Set([...Object.keys(requirement.dependencyBindings), ...Object.keys(receipt.dependencyBindings)])
  const changed = [...bindingKeys].filter(key =>
    requirement.dependencyBindings[key] !== receipt.dependencyBindings[key] ||
    candidate.components[key] !== receipt.dependencyBindings[key]
  )
  if (changed.length) return { freshness: 'stale', fresh: false, reboundFromCandidateId: null, reasons: changed.map(key => `dependency-changed:${key}`) }
  if (receipt.observedCandidateId === candidate.candidateId) {
    return { freshness: 'fresh', fresh: true, reboundFromCandidateId: null, reasons: [] }
  }
  return { freshness: 'fresh-reused', fresh: true, reboundFromCandidateId: receipt.observedCandidateId, reasons: [] }
}

function blockingRank(requirement, state) {
  if (state === 'BLOCK' && requirement.nonWaivable) return BLOCKING_RANK.NON_WAIVABLE_BLOCK
  if (state === 'BLOCK' && requirement.applicability.decision === 'required') return BLOCKING_RANK.REQUIRED_BLOCK
  if (state === 'UNVERIFIED' && requirement.applicability.decision === 'required') return BLOCKING_RANK.REQUIRED_UNVERIFIED
  if (state === 'WARN' || state === 'BLOCK' || state === 'UNVERIFIED') return BLOCKING_RANK.WARN
  if (state === 'PASS') return BLOCKING_RANK.PASS
  return BLOCKING_RANK.NA
}

function receiptState(receipt, requirement) {
  if (receipt.result === 'failed') return 'BLOCK'
  if (receipt.result === 'inconclusive') return requirement.applicability.decision === 'required' ? 'UNVERIFIED' : 'WARN'
  if (receipt.result === 'skipped') return requirement.applicability.decision === 'required' ? 'UNVERIFIED' : 'N/A'
  if (requirement.applicability.decision === 'required' && !receipt.qualification.satisfiesRequired) return 'UNVERIFIED'
  return receipt.qualification.warning ? 'WARN' : 'PASS'
}

function decisionForRequirement(requirement, receipts, candidate, options) {
  if (requirement.applicability.decision === 'N/A') {
    return {
      requirementId: requirement.requirementId,
      alias: requirement.alias,
      planOrder: requirement.planOrder,
      applicability: 'N/A',
      nonWaivable: requirement.nonWaivable,
      state: 'N/A',
      freshness: 'N/A',
      blockingClassRank: BLOCKING_RANK.NA,
      sourceKind: null,
      sourceDigest: null,
      evidenceRefs: [],
      reason: requirement.applicability.reason,
      recommendedAction: 'none',
      reboundFromCandidateId: null
    }
  }

  const evaluated = receipts.map(receipt => ({ receipt, freshness: evaluateReceiptFreshness(receipt, candidate, requirement, options) }))
  const fresh = evaluated.filter(item => item.freshness.fresh).map(item => ({ ...item, state: receiptState(item.receipt, requirement) }))
  const invalid = evaluated.filter(item => item.freshness.freshness === 'invalid')
  const stale = evaluated.filter(item => item.freshness.freshness === 'stale')
  const candidates = fresh.sort((left, right) => {
    const leftRank = blockingRank(requirement, left.state)
    const rightRank = blockingRank(requirement, right.state)
    return leftRank - rightRank || left.receipt.sourceKind.localeCompare(right.receipt.sourceKind) || left.receipt.sourceDigest.localeCompare(right.receipt.sourceDigest)
  })
  const selected = candidates[0]
  let state
  let reason
  let recommendedAction
  if (selected) {
    state = selected.state
    reason = state === 'PASS' ? 'qualified-fresh-evidence' : `evidence-${selected.receipt.result}`
    recommendedAction = state === 'PASS' || state === 'N/A' ? 'none' : `resolve:${requirement.requirementId}`
  } else if (invalid.length) {
    state = 'UNVERIFIED'
    reason = 'invalid-evidence'
    recommendedAction = `replace-invalid-evidence:${requirement.requirementId}`
  } else if (stale.length) {
    state = requirement.applicability.decision === 'required' ? 'UNVERIFIED' : 'WARN'
    reason = 'stale-evidence'
    recommendedAction = `rerun:${requirement.requirementId}`
  } else {
    state = requirement.applicability.decision === 'required' ? 'UNVERIFIED' : 'WARN'
    reason = 'evidence-missing'
    recommendedAction = `collect:${requirement.requirementId}`
  }
  return {
    requirementId: requirement.requirementId,
    alias: requirement.alias,
    planOrder: requirement.planOrder,
    applicability: requirement.applicability.decision,
    nonWaivable: requirement.nonWaivable,
    state,
    freshness: selected?.freshness.freshness || (stale.length ? 'stale' : 'missing'),
    blockingClassRank: blockingRank(requirement, state),
    sourceKind: selected?.receipt.sourceKind || null,
    sourceDigest: selected?.receipt.sourceDigest || null,
    evidenceRefs: selected?.receipt.evidenceRefs || [],
    reason,
    recommendedAction,
    reboundFromCandidateId: selected?.freshness.reboundFromCandidateId || null
  }
}

function decisionSort(left, right) {
  return left.blockingClassRank - right.blockingClassRank ||
    left.planOrder - right.planOrder ||
    left.requirementId.localeCompare(right.requirementId) ||
    String(left.sourceKind || '').localeCompare(String(right.sourceKind || '')) ||
    String(left.sourceDigest || '').localeCompare(String(right.sourceDigest || ''))
}

function createRiskAcceptanceReceipt(input) {
  const core = {
    schemaVersion: SCHEMAS.risk,
    action: input?.action || '',
    candidateId: input?.candidateId || '',
    requirementIds: sortedUnique(input?.requirementIds),
    actor: input?.actor || '',
    reason: input?.reason || '',
    sourceDigest: input?.sourceDigest || '',
    createdAt: input?.createdAt || '',
    expiresAt: input?.expiresAt ?? null,
    targetReceiptDigest: input?.targetReceiptDigest ?? null,
    previousDigest: input?.previousDigest ?? null
  }
  const receipt = { ...core, receiptDigest: digest(core) }
  requireValid(validateRiskAcceptanceReceipt(receipt), 'RISK_RECEIPT_INVALID', 'risk acceptance receipt is invalid')
  return Object.freeze(receipt)
}

function validateRiskAcceptanceReceipt(receipt, { now = Date.now() } = {}) {
  const errors = []
  if (receipt?.schemaVersion !== SCHEMAS.risk) errors.push('risk-schema-invalid')
  if (!['accept', 'revoke'].includes(receipt?.action)) errors.push('risk-action-invalid')
  if (!CANDIDATE_ID.test(receipt?.candidateId || '')) errors.push('risk-candidate-invalid')
  if (!uniqueTextList(receipt?.requirementIds) || receipt.requirementIds.length === 0) errors.push('risk-requirements-invalid')
  for (const field of ['actor', 'reason']) if (!text(receipt?.[field])) errors.push(`risk-${field}-required`)
  if (!DIGEST.test(receipt?.sourceDigest || '')) errors.push('risk-source-digest-invalid')
  if (!zonedDateTime(receipt?.createdAt)) errors.push('risk-created-at-invalid')
  else if (Date.parse(receipt.createdAt) > now + 5 * 60 * 1000) errors.push('risk-created-at-future')
  if (receipt?.expiresAt !== null && !zonedDateTime(receipt?.expiresAt)) errors.push('risk-expires-at-invalid')
  if (receipt?.targetReceiptDigest !== null && !DIGEST.test(receipt?.targetReceiptDigest || '')) errors.push('risk-target-invalid')
  if (receipt?.previousDigest !== null && !DIGEST.test(receipt?.previousDigest || '')) errors.push('risk-previous-invalid')
  if (receipt?.action === 'accept' && receipt?.targetReceiptDigest !== null) errors.push('risk-accept-target-forbidden')
  if (receipt?.action === 'revoke' && !DIGEST.test(receipt?.targetReceiptDigest || '')) errors.push('risk-revoke-target-required')
  if (!DIGEST.test(receipt?.receiptDigest || '') || receipt.receiptDigest !== digest(without(receipt, ['receiptDigest']))) errors.push('risk-digest-mismatch')
  return validation(errors.length === 0, errors)
}

function evaluateRiskLedger(receipts, candidate, requirements, now) {
  const active = new Map()
  const revoked = new Set()
  const expired = []
  const invalid = []
  let previousDigest = null
  const requirementMap = new Map(requirements.map(item => [item.requirementId, item]))
  for (const receipt of receipts || []) {
    const check = validateRiskAcceptanceReceipt(receipt, { now })
    const receiptErrors = [...check.errors]
    if (receipt?.candidateId !== candidate.candidateId) receiptErrors.push('risk-candidate-mismatch')
    if (receipt?.previousDigest !== previousDigest) receiptErrors.push('risk-chain-mismatch')
    if ((receipt?.requirementIds || []).some(id => !requirementMap.has(id))) receiptErrors.push('risk-requirement-unknown')
    if ((receipt?.requirementIds || []).some(id => requirementMap.get(id)?.nonWaivable)) receiptErrors.push('risk-requirement-nonwaivable')
    if (receiptErrors.length) {
      invalid.push(`${receipt?.receiptDigest || 'unknown'}:${receiptErrors.join(',')}`)
      continue
    }
    previousDigest = receipt.receiptDigest
    if (receipt.expiresAt && Date.parse(receipt.expiresAt) <= now) {
      expired.push(receipt.receiptDigest)
      continue
    }
    if (receipt.action === 'accept') active.set(receipt.receiptDigest, receipt)
    else if (!active.has(receipt.targetReceiptDigest)) invalid.push(`${receipt.receiptDigest}:risk-revoke-target-missing`)
    else {
      active.delete(receipt.targetReceiptDigest)
      revoked.add(receipt.targetReceiptDigest)
      revoked.add(receipt.receiptDigest)
    }
  }
  return {
    activeReceipts: [...active.values()],
    projection: {
      active: [...active.keys()].sort(),
      revoked: [...revoked].sort(),
      expired: expired.sort(),
      invalid: invalid.sort()
    }
  }
}

function terminal(phase, applicability, value, evidenceState, sourceOwner, sourceDigestValue, evidenceRefs, reason) {
  return {
    schemaVersion: SCHEMAS.phase,
    phase,
    applicability,
    semanticField: PHASE_FIELDS[phase],
    value,
    evidenceState,
    sourceOwner,
    sourceDigest: sourceDigestValue,
    evidenceRefs,
    reason
  }
}

function createCorePhaseTerminals(coreEvidenceState, coreEvaluationValid, plan) {
  const coreReady = coreEvaluationValid && ['PASS', 'WARN'].includes(coreEvidenceState)
  const releaseApplicable = plan.stage === 'release'
  return [
    terminal('turn', 'required', coreEvaluationValid, coreEvaluationValid ? 'PASS' : 'UNVERIFIED', 'workflow-completion', plan.planDigest, [], coreEvaluationValid ? 'reducer-evaluated' : 'reducer-invalid'),
    terminal('execution', 'required', coreReady, coreEvidenceState, 'workflow-completion', plan.planDigest, [], coreReady ? 'required-evidence-ready' : 'required-evidence-not-ready'),
    terminal('workflow', 'required', false, coreEvidenceState, 'workflow-completion', plan.planDigest, [], 'delivery-commit-required'),
    terminal('release', releaseApplicable ? 'required' : 'N/A', releaseApplicable ? false : null, releaseApplicable ? 'UNVERIFIED' : 'N/A', releaseApplicable ? 'release-verification' : null, releaseApplicable ? plan.planDigest : null, [], releaseApplicable ? 'release-evidence-required' : 'release-not-applicable')
  ]
}

function validatePhaseTerminals(terminals) {
  const errors = []
  if (!Array.isArray(terminals) || terminals.length !== 4) return validation(false, ['phase-terminals-cardinality-invalid'])
  const phases = terminals.map(item => item?.phase)
  if (new Set(phases).size !== 4 || Object.keys(PHASE_FIELDS).some(phase => !phases.includes(phase))) errors.push('phase-terminals-set-invalid')
  for (const item of terminals) {
    if (item?.schemaVersion !== SCHEMAS.phase) errors.push('phase-schema-invalid')
    if (item?.semanticField !== PHASE_FIELDS[item?.phase]) errors.push('phase-semantic-field-invalid')
    if (!APPLICABILITY.has(item?.applicability)) errors.push('phase-applicability-invalid')
    if (!STATUS.has(item?.evidenceState)) errors.push('phase-evidence-state-invalid')
    if (item?.applicability === 'N/A' && (item.value !== null || item.evidenceState !== 'N/A')) errors.push('phase-na-value-invalid')
    if (item?.applicability !== 'N/A' && typeof item?.value !== 'boolean') errors.push('phase-value-invalid')
    if (!text(item?.reason)) errors.push('phase-reason-required')
    if (!Array.isArray(item?.evidenceRefs) || !item.evidenceRefs.every(text)) errors.push('phase-evidence-refs-invalid')
  }
  return validation(errors.length === 0, errors)
}

/** Reduce normalized receipt references into one immutable core snapshot. */
function evaluateWorkflowCompletion({ candidate, plan, receipts = [], riskReceipts = [], rollout, generatedAt, now = Date.now() }) {
  const candidateValidation = validateWorkflowCompletionCandidate(candidate)
  const planValidation = validateWorkflowCompletionPlan(plan, candidate)
  const rolloutValue = rollout || { schemaVersion: 'RolloutStateV1', mode: 'shadow', ruleSetDigest: plan?.ruleSetDigest, legacyComparison: 'not-compared' }
  const structuralErrors = [...candidateValidation.errors, ...planValidation.errors]
  if (!ROLLOUT_MODES.has(rolloutValue?.mode) || rolloutValue?.ruleSetDigest !== plan?.ruleSetDigest) structuralErrors.push('rollout-invalid')
  if (!zonedDateTime(generatedAt)) structuralErrors.push('snapshot-generated-at-invalid')

  const byRequirement = new Map()
  for (const receipt of receipts || []) {
    const key = receipt?.requirementId || 'unknown'
    if (!byRequirement.has(key)) byRequirement.set(key, [])
    byRequirement.get(key).push(receipt)
  }
  const decisions = (plan?.requirements || []).map(requirement =>
    decisionForRequirement(requirement, byRequirement.get(requirement.requirementId) || [], candidate, { now })
  ).sort(decisionSort)
  const invalidUnknownReceipts = (receipts || []).filter(receipt => !plan?.requirements?.some(item => item.requirementId === receipt?.requirementId))
  if (invalidUnknownReceipts.length) structuralErrors.push('receipt-requirement-unknown')

  const counts = Object.fromEntries([...STATUS].map(state => [state, decisions.filter(item => item.state === state).length]))
  let coreEvidenceState = decisions[0]?.state || 'UNVERIFIED'
  if (coreEvidenceState === 'N/A') coreEvidenceState = 'PASS'
  if (structuralErrors.length) coreEvidenceState = 'UNVERIFIED'
  const coreEvaluationValid = structuralErrors.length === 0
  const coreEvidenceReady = coreEvaluationValid && ['PASS', 'WARN'].includes(coreEvidenceState)
  const riskResult = evaluateRiskLedger(riskReceipts, candidate, plan?.requirements || [], now)
  const unresolved = decisions.filter(item => ['BLOCK', 'UNVERIFIED'].includes(item.state) && item.applicability === 'required')
  const covered = new Set(riskResult.activeReceipts.flatMap(item => item.requirementIds))
  const riskDeliverable = unresolved.length > 0 && unresolved.every(item => !item.nonWaivable && covered.has(item.requirementId))
  const blockers = decisions.filter(item => item.blockingClassRank <= BLOCKING_RANK.REQUIRED_UNVERIFIED)
  const diagnostics = {
    firstBlocker: blockers[0] || null,
    allBlockers: blockers,
    missingRequired: decisions.filter(item => item.applicability === 'required' && item.freshness === 'missing').map(item => item.requirementId),
    staleEvidence: decisions.filter(item => item.freshness === 'stale').map(item => item.requirementId),
    recommendedActions: sortedUnique(decisions.filter(item => item.recommendedAction !== 'none').map(item => item.recommendedAction)),
    invalidEvidence: sortedUnique(structuralErrors.concat(riskResult.projection.invalid))
  }
  const core = {
    schemaVersion: SCHEMAS.snapshot,
    candidateId: candidate?.candidateId || '',
    planDigest: plan?.planDigest || '',
    ruleSetDigest: plan?.ruleSetDigest || '',
    generatedAt,
    counts,
    decisions,
    coreEvaluationValid,
    coreEvidenceState,
    coreEvidenceReady,
    riskDeliverable,
    risk: riskResult.projection,
    phaseTerminals: createCorePhaseTerminals(coreEvidenceState, coreEvaluationValid, plan),
    diagnostics,
    rollout: rolloutValue
  }
  const coreSnapshotDigest = digest(core)
  return Object.freeze({ ...core, coreSnapshotDigest })
}

function validateWorkflowCompletionSnapshot(snapshot) {
  const errors = []
  if (snapshot?.schemaVersion !== SCHEMAS.snapshot) errors.push('snapshot-schema-invalid')
  if (!CANDIDATE_ID.test(snapshot?.candidateId || '')) errors.push('snapshot-candidate-invalid')
  for (const field of ['planDigest', 'ruleSetDigest', 'coreSnapshotDigest']) if (!DIGEST.test(snapshot?.[field] || '')) errors.push(`snapshot-${field}-invalid`)
  if (!zonedDateTime(snapshot?.generatedAt)) errors.push('snapshot-generated-at-invalid')
  if (!STATUS.has(snapshot?.coreEvidenceState)) errors.push('snapshot-evidence-state-invalid')
  if (typeof snapshot?.coreEvaluationValid !== 'boolean' || typeof snapshot?.coreEvidenceReady !== 'boolean' || typeof snapshot?.riskDeliverable !== 'boolean') errors.push('snapshot-booleans-invalid')
  errors.push(...validatePhaseTerminals(snapshot?.phaseTerminals).errors)
  if (snapshot?.coreSnapshotDigest !== digest(without(snapshot, ['coreSnapshotDigest']))) errors.push('snapshot-digest-mismatch')
  return validation(errors.length === 0, errors)
}

function createWorkflowCompletionCommit(input) {
  const snapshotValidation = validateWorkflowCompletionSnapshot(input?.snapshot)
  requireValid(snapshotValidation, 'COMMIT_SNAPSHOT_INVALID', 'completion commit snapshot is invalid')
  const manifestEntries = sortedUnique(input?.artifactManifestEntries)
  if (manifestEntries.some(item => /\.completion\.json$/i.test(item))) {
    throw new WorkflowCompletionError('COMMIT_MANIFEST_CYCLE', 'completion sidecar cannot appear in its own artifact manifest')
  }
  const core = {
    schemaVersion: SCHEMAS.commit,
    candidateId: input.snapshot.candidateId,
    coreSnapshotDigest: input.snapshot.coreSnapshotDigest,
    deliveryReceiptRefs: [...(input.deliveryReceiptRefs || [])].sort((left, right) => `${left.kind}:${left.digest}`.localeCompare(`${right.kind}:${right.digest}`)),
    reportIdentity: input.reportIdentity,
    memoryReceiptRefs: [...(input.memoryReceiptRefs || [])].sort((left, right) => `${left.kind}:${left.digest}`.localeCompare(`${right.kind}:${right.digest}`)),
    artifactManifestDigest: digest(manifestEntries),
    artifactManifestEntries: manifestEntries,
    commitOutcome: input.commitOutcome,
    createdAt: input.createdAt
  }
  const commit = { ...core, commitDigest: digest(core) }
  requireValid(validateWorkflowCompletionCommit(commit, { snapshot: input.snapshot }), 'COMMIT_INVALID', 'workflow completion commit is invalid')
  return Object.freeze(commit)
}

function validateDeliveryRef(ref) {
  return ref && ['report', 'memory', 'manifest'].includes(ref.kind) && DIGEST.test(ref.digest || '') && text(ref.evidenceRef)
}

function expectedCommitOutcomes(snapshot) {
  if (snapshot.coreEvidenceReady) return new Set([snapshot.coreEvidenceState === 'WARN' ? 'warning' : 'complete'])
  if (snapshot.riskDeliverable) return new Set(['risk'])
  return new Set(['blocked'])
}

function validateWorkflowCompletionCommit(commit, context = {}) {
  const errors = []
  if (commit?.schemaVersion !== SCHEMAS.commit) errors.push('commit-schema-invalid')
  if (!CANDIDATE_ID.test(commit?.candidateId || '')) errors.push('commit-candidate-invalid')
  if (!DIGEST.test(commit?.coreSnapshotDigest || '')) errors.push('commit-snapshot-digest-invalid')
  if (!Array.isArray(commit?.deliveryReceiptRefs) || commit.deliveryReceiptRefs.length < 3 || !commit.deliveryReceiptRefs.every(validateDeliveryRef)) errors.push('commit-delivery-refs-invalid')
  else if (['report', 'memory', 'manifest'].some(kind => !commit.deliveryReceiptRefs.some(item => item.kind === kind))) errors.push('commit-delivery-kinds-incomplete')
  if (!validateContentIdentity(commit?.reportIdentity).valid) errors.push('commit-report-identity-invalid')
  if (!Array.isArray(commit?.memoryReceiptRefs) || commit.memoryReceiptRefs.length === 0 || !commit.memoryReceiptRefs.every(item => validateDeliveryRef(item) && item.kind === 'memory')) errors.push('commit-memory-refs-invalid')
  if (!DIGEST.test(commit?.artifactManifestDigest || '') || commit.artifactManifestDigest !== digest(sortedUnique(commit?.artifactManifestEntries))) errors.push('commit-manifest-digest-mismatch')
  if (!uniqueTextList(commit?.artifactManifestEntries)) errors.push('commit-manifest-entries-invalid')
  if ((commit?.artifactManifestEntries || []).some(item => /\.completion\.json$/i.test(item))) errors.push('commit-manifest-cycle')
  if (!['complete', 'warning', 'risk', 'blocked'].includes(commit?.commitOutcome)) errors.push('commit-outcome-invalid')
  if (!zonedDateTime(commit?.createdAt)) errors.push('commit-created-at-invalid')
  if (!DIGEST.test(commit?.commitDigest || '') || commit.commitDigest !== digest(without(commit, ['commitDigest']))) errors.push('commit-digest-mismatch')
  if (context.snapshot) {
    const snapshotCheck = validateWorkflowCompletionSnapshot(context.snapshot)
    if (!snapshotCheck.valid) errors.push('commit-context-snapshot-invalid')
    if (commit?.candidateId !== context.snapshot.candidateId || commit?.coreSnapshotDigest !== context.snapshot.coreSnapshotDigest) errors.push('commit-snapshot-mismatch')
    if (!expectedCommitOutcomes(context.snapshot).has(commit?.commitOutcome)) errors.push('commit-outcome-mismatch')
  }
  if (context.reportContent !== undefined && !matchesContentIdentity(commit?.reportIdentity, context.reportContent)) errors.push('commit-report-reverse-identity-mismatch')
  if (context.artifactManifestEntries && digest(sortedUnique(context.artifactManifestEntries)) !== commit?.artifactManifestDigest) errors.push('commit-manifest-context-mismatch')
  return validation(errors.length === 0, errors)
}

function validateDeliveryAttempt(attempt, candidateId, { now = Date.now() } = {}) {
  const errors = []
  if (!attempt || typeof attempt !== 'object') return validation(false, ['delivery-attempt-required'])
  if (attempt.candidateId !== candidateId) errors.push('delivery-attempt-candidate-mismatch')
  if (attempt.result !== 'failed') errors.push('delivery-attempt-result-invalid')
  if (!zonedDateTime(attempt.observedAt)) errors.push('delivery-attempt-time-invalid')
  else if (Date.parse(attempt.observedAt) > now + 5 * 60 * 1000) errors.push('delivery-attempt-time-future')
  if (!DIGEST.test(attempt.attemptDigest || '')) errors.push('delivery-attempt-digest-invalid')
  return validation(errors.length === 0, errors)
}

function createCommitValidationResult(commit, context = {}) {
  if (!commit) {
    const attemptCheck = context.deliveryAttempt ? validateDeliveryAttempt(context.deliveryAttempt, context.snapshot?.candidateId, context) : validation(true, [])
    return {
      schemaVersion: SCHEMAS.commitValidation,
      state: context.deliveryAttempt && attemptCheck.valid ? 'failed' : 'not-attempted',
      commit: null,
      deliveryAttempt: context.deliveryAttempt && attemptCheck.valid ? context.deliveryAttempt : null,
      validation: attemptCheck
    }
  }
  const check = validateWorkflowCompletionCommit(commit, context)
  return {
    schemaVersion: SCHEMAS.commitValidation,
    state: check.valid ? 'valid' : 'failed',
    commit: check.valid ? commit : null,
    deliveryAttempt: check.valid ? null : (validateDeliveryAttempt(context.deliveryAttempt, context.snapshot?.candidateId, context).valid ? context.deliveryAttempt : null),
    validation: check
  }
}

function projectionTerminals(snapshot, workflowComplete, workflowState, commitDigestValue) {
  return snapshot.phaseTerminals.map(item => {
    if (item.phase !== 'workflow') return { ...item }
    return terminal('workflow', 'required', workflowComplete, workflowState, 'workflow-completion-commit', commitDigestValue, commitDigestValue ? [`commit:${commitDigestValue}`] : [], workflowComplete ? 'valid-completion-commit' : 'workflow-not-complete')
  })
}

/** Rebuild the final state from core plus a validated commit or stable failure attempt. */
function projectWorkflowCompletion(snapshot, commitValidation, { generatedAt, now = Date.now() } = {}) {
  requireValid(validateWorkflowCompletionSnapshot(snapshot), 'PROJECTION_SNAPSHOT_INVALID', 'projection snapshot is invalid')
  if (!zonedDateTime(generatedAt)) throw new WorkflowCompletionError('PROJECTION_TIME_INVALID', 'projection generatedAt must include a timezone')
  const state = commitValidation?.state
  let commit = null
  let deliveryAttempt = null
  if (state === 'valid') {
    const check = validateWorkflowCompletionCommit(commitValidation.commit, { snapshot })
    requireValid(check, 'PROJECTION_COMMIT_INVALID', 'projection commit is invalid')
    commit = commitValidation.commit
  } else if (state === 'failed') {
    const attemptCheck = validateDeliveryAttempt(commitValidation.deliveryAttempt, snapshot.candidateId, { now })
    if (attemptCheck.valid) deliveryAttempt = commitValidation.deliveryAttempt
  }

  let completionPhase = snapshot.coreEvidenceReady ? 'delivery-prepared' : snapshot.coreEvidenceState === 'BLOCK' ? 'core-blocked' : 'core-unverified'
  let deliveryCommitted = false
  let workflowComplete = false
  let workflowEvidenceState = snapshot.coreEvidenceState
  let deliveryDecision = snapshot.diagnostics.firstBlocker?.nonWaivable ? 'forbidden' : 'blocked'
  if (state === 'failed' && deliveryAttempt) completionPhase = 'commit-failed'
  if (commit) {
    deliveryCommitted = true
    completionPhase = `committed-${commit.commitOutcome}`
    workflowComplete = ['complete', 'warning'].includes(commit.commitOutcome)
    deliveryDecision = commit.commitOutcome === 'complete'
      ? 'allowed'
      : commit.commitOutcome === 'warning'
        ? 'allowed-with-warning'
        : commit.commitOutcome === 'risk'
          ? 'allowed-with-risk'
          : snapshot.diagnostics.firstBlocker?.nonWaivable ? 'forbidden' : 'blocked'
  }
  if (snapshot.rollout.mode === 'rolled-back') {
    workflowComplete = false
    workflowEvidenceState = 'UNVERIFIED'
    deliveryDecision = 'forbidden'
  }
  const commitDigestValue = commit?.commitDigest || null
  const deliveryAttemptDigest = deliveryAttempt?.attemptDigest || null
  const projectionCore = {
    schemaVersion: SCHEMAS.projection,
    candidateId: snapshot.candidateId,
    planDigest: snapshot.planDigest,
    coreSnapshotDigest: snapshot.coreSnapshotDigest,
    commitValidationState: commit ? 'valid' : deliveryAttempt ? 'failed' : 'not-attempted',
    commitDigest: commitDigestValue,
    deliveryAttemptDigest,
    ruleSetDigest: snapshot.ruleSetDigest
  }
  const projectionDigest = projectionCore.commitValidationState === 'not-attempted' ? null : digest(projectionCore)
  return Object.freeze({
    ...projectionCore,
    projectionDigest,
    generatedAt,
    completionPhase,
    deliveryCommitted,
    workflowEvidenceState,
    workflowComplete,
    deliveryDecision,
    phaseTerminals: projectionTerminals(snapshot, workflowComplete, workflowEvidenceState, commitDigestValue),
    diagnostics: snapshot.diagnostics,
    rollout: snapshot.rollout
  })
}

function evaluateShadowEvidenceWindow(samples, ruleSetDigest, { now = Date.now(), windowStartedAt = null } = {}) {
  if (!DIGEST.test(ruleSetDigest || '')) throw new WorkflowCompletionError('SHADOW_RULESET_INVALID', 'shadow ruleSetDigest is invalid')
  const rollingCutoff = now - (30 * 86400000)
  const unique = new Map()
  for (const sample of samples || []) {
    if (sample?.fixture === true || sample?.ruleSetDigest !== ruleSetDigest) continue
    if (!text(sample?.taskKey) || !CANDIDATE_ID.test(sample?.candidateId || '') || !zonedDateTime(sample?.observedAt)) continue
    if (!['dev', 'fix'].includes(sample?.workflow) || !['same', 'false-allow', 'false-block'].includes(sample?.legacyComparison)) continue
    const observedAtMs = Date.parse(sample.observedAt)
    if (observedAtMs < rollingCutoff || observedAtMs > now + 5 * 60 * 1000) continue
    unique.set(`${sample.taskKey}\0${sample.candidateId}\0${sample.ruleSetDigest}`, sample)
  }
  const accepted = [...unique.values()]
  const inferredStart = accepted.length ? Math.min(...accepted.map(item => Date.parse(item.observedAt))) : now
  const configuredStart = zonedDateTime(windowStartedAt) ? Date.parse(windowStartedAt) : inferredStart
  const windowDays = Math.max(0, Math.min(30, (now - configuredStart) / 86400000))
  const devSamples = accepted.filter(item => item.workflow === 'dev').length
  const fixSamples = accepted.filter(item => item.workflow === 'fix').length
  const falseAllow = accepted.filter(item => item.legacyComparison === 'false-allow').length
  const falseBlock = accepted.filter(item => item.legacyComparison === 'false-block').length
  const eligibleForPromotion = accepted.length >= 20 && devSamples >= 5 && fixSamples >= 5 && windowDays >= 30 && falseAllow === 0 && falseBlock === 0
  return Object.freeze({
    schemaVersion: SCHEMAS.shadow,
    ruleSetDigest,
    mode: 'shadow',
    uniqueRealSamples: accepted.length,
    devSamples,
    fixSamples,
    windowDays,
    falseAllow,
    falseBlock,
    eligibleForPromotion,
    recommendedMode: falseAllow > 0 || falseBlock > 0 ? 'rolled-back' : eligibleForPromotion ? 'enforce-candidate' : 'shadow'
  })
}

module.exports = {
  BLOCKING_RANK,
  SCHEMAS,
  VERIFICATION_CLAIM_CEILINGS,
  VERIFICATION_LEVELS,
  VERIFICATION_PURPOSES,
  VERIFICATION_REQUESTER_CLASSES,
  WorkflowCompletionError,
  applyValidationControlIngress,
  classifyValidationControlInstruction,
  createCommitValidationResult,
  createRiskAcceptanceReceipt,
  createWorkflowCompletionCandidate,
  createWorkflowCompletionCommit,
  createWorkflowCompletionPlan,
  createWorkflowEvidenceReceipt,
  createVerificationIntent,
  createValidationControlIngressReceipt,
  decisionSort,
  evaluateReceiptFreshness,
  evaluateShadowEvidenceWindow,
  evaluateWorkflowCompletion,
  projectWorkflowCompletion,
  validatePhaseTerminals,
  validateRiskAcceptanceReceipt,
  validateWorkflowCompletionCandidate,
  validateWorkflowCompletionCommit,
  validateWorkflowCompletionPlan,
  validateWorkflowCompletionSnapshot,
  validateWorkflowEvidenceReceipt,
  validateVerificationIntent,
  validateVerificationIntentV1,
  validateValidationControlIngressReceipt,
  validationProjectRootIdentity
}
