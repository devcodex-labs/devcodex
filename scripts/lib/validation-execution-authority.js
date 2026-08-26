'use strict'

const path = require('path')

const {
  sha256,
  stableStringify
} = require('../../hooks/_runtime/content-identity.cjs')

const RUN_IDENTITY_SCHEMA = 'ValidationRunIdentityV1'
const LEASE_SCHEMA = 'VerificationExecutionLeaseV2'
const LEGACY_LEASE_SCHEMA = 'VerificationExecutionLeaseV1'
const PENDING_BUDGET_SCHEMA = 'PendingBudgetCardBindingV1'
const BUDGET_CONFIRMATION_SCHEMA = 'BudgetConfirmationReceiptV1'
const CONTINUATION_AUTHORIZATION_SCHEMA = 'ValidationContinuationAuthorizationV1'
const ACTOR_TYPES = new Set(['ai-hook', 'human-cli', 'trusted-ci', 'release-pipeline'])
const AUTHORITY_CLASSES = new Set(['scoped', 'full-audit', 'release'])
const LEASE_STATUSES = new Set(['active', 'consumed', 'revoked', 'expired'])
const PENDING_BUDGET_STATUSES = new Set(['pending', 'confirmed', 'stale', 'revoked'])
const CONTINUATION_STATUSES = new Set(['prepared', 'leased', 'consumed', 'revoked', 'stale'])
const CONTINUATION_REPAIR_PROOF_KINDS = new Set(['mutation-observation', 'same-scope-retry'])
const RECOVERABLE_TERMINAL_STATUSES = new Set(['failed', 'blocked', 'timed-out'])
const LEVEL_RANK = Object.freeze({ V0: 0, V1: 1, V2: 2, V3: 3 })
const DIGEST_RE = /^[a-f0-9]{64}$/
const MIN_LEASE_WINDOW_MS = 60 * 1000
const LEASE_MARGIN_FLOOR_MS = 30 * 1000
const PENDING_BUDGET_TTL_MS = 24 * 60 * 60 * 1000
const MAX_AUTHORITY_RECORD_BYTES = 4 * 1024
const MAX_CONTINUATION_RETRIES = 2

class ValidationAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'ValidationAuthorityError'
    this.code = code
    this.details = details
  }
}

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function text(value, maxLength = 4096) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function iso(value) {
  return text(value, 64) && Number.isFinite(Date.parse(value))
}

function withoutDigest(value) {
  const { authorityDigest, ...semantic } = value || {}
  return semantic
}

function withoutRunIdentityDigest(value) {
  const { runIdentityDigest, runId, ...semantic } = value || {}
  return semantic
}

function withoutNamedDigest(value, field) {
  const semantic = { ...(value || {}) }
  delete semantic[field]
  return semantic
}

function canonicalStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value).trim()).filter(Boolean))].sort()
}

function stringSetDigest(schemaVersion, values = []) {
  return digest({ schemaVersion, values: canonicalStrings(values) })
}

function recordBytes(value) {
  return Buffer.byteLength(stableStringify(value), 'utf8')
}

function recordSizeError(value, code) {
  const bytes = recordBytes(value)
  return bytes <= MAX_AUTHORITY_RECORD_BYTES
    ? null
    : { code, bytes, maxBytes: MAX_AUTHORITY_RECORD_BYTES }
}

function planSideEffectCategories(plan = {}) {
  const declared = plan.budgetCard?.sideEffectCategories || plan.budget?.sideEffectCategories
  if (Array.isArray(declared)) return canonicalStrings(declared)
  const categories = []
  for (const node of plan.selectedNodes || []) {
    const id = String(node.id || '').toLowerCase()
    const scopes = canonicalStrings(node.writeScopes)
    if (scopes.length > 0) categories.push('managed-write')
    for (const scope of scopes) {
      const normalized = scope.toLowerCase()
      if (normalized.includes('package') || normalized.includes('pack')) categories.push('package')
      if (normalized.includes('deploy')) categories.push('deploy')
      if (normalized.includes('global') || normalized.includes('host')) categories.push('global-host')
      if (normalized.includes('git')) categories.push('shared-git')
    }
    if (/(?:^|-)pack(?:-|$)/.test(id)) categories.push('package')
    if (/(?:^|-)install(?:-|$)/.test(id)) categories.push('install')
    if (/(?:^|-)deploy(?:-|$)/.test(id)) categories.push('deploy')
    if (/(?:^|-)global(?:-|$)/.test(id)) categories.push('global-host')
  }
  return canonicalStrings(categories)
}

function planBudgetProjection(plan = {}) {
  const budgetCard = plan.budgetCard || {}
  const selectedNodeIds = canonicalStrings((plan.selectedNodes || []).map(node => node.id))
  const affectedBoundaries = canonicalStrings(plan.affectedBoundaries)
  const heavyNodeIds = canonicalStrings(budgetCard.heavyNodeIds || plan.budget?.heavyNodeIds)
  const sideEffectCategories = planSideEffectCategories(plan)
  return Object.freeze({
    schemaVersion: 'ValidationBudgetProjectionV1',
    planDigest: String(plan.planDigest || ''),
    budgetDigest: String(budgetCard.digest || ''),
    level: String(plan.verificationLevel || ''),
    purpose: String(plan.verificationPurpose || ''),
    affectedBoundaries,
    affectedBoundaryDigest: stringSetDigest('ValidationAffectedBoundarySetV1', affectedBoundaries),
    heavyNodeIds,
    heavyNodeDigest: stringSetDigest('ValidationHeavyNodeSetV1', heavyNodeIds),
    sideEffectCategories,
    sideEffectCategoryDigest: stringSetDigest('ValidationSideEffectCategorySetV1', sideEffectCategories),
    selectedNodeIds,
    selectedNodeDigest: stringSetDigest('ValidationSelectedNodeSetV1', selectedNodeIds),
    selectedNodeCount: Number.isInteger(plan.selectedNodeCount) ? plan.selectedNodeCount : selectedNodeIds.length,
    estimatedDurationMs: Number(budgetCard.estimatedDurationMs || 0),
    hardTimeoutUpperBoundMs: Number(budgetCard.hardTimeoutUpperBoundMs || 0),
    logBudgetBytes: Number(budgetCard.logBudgetBytes || 0)
  })
}

function validateValidationBudgetProjection(projection, rootConfirmation = null) {
  const errors = []
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return { valid: false, errors: ['budget-projection-invalid'] }
  }
  if (projection.schemaVersion !== 'ValidationBudgetProjectionV1') errors.push('budget-projection-schema-invalid')
  for (const field of ['planDigest', 'budgetDigest', 'affectedBoundaryDigest', 'heavyNodeDigest',
    'sideEffectCategoryDigest', 'selectedNodeDigest']) {
    if (!DIGEST_RE.test(String(projection[field] || ''))) errors.push(`budget-projection-${field}-invalid`)
  }
  if (!Object.hasOwn(LEVEL_RANK, projection.level) || LEVEL_RANK[projection.level] > LEVEL_RANK.V3) {
    errors.push('budget-projection-level-invalid')
  }
  if (!['edit-loop', 'delivery', 'boundary', 'full-audit', 'release'].includes(projection.purpose)) {
    errors.push('budget-projection-purpose-invalid')
  }
  for (const field of ['affectedBoundaries', 'heavyNodeIds', 'sideEffectCategories', 'selectedNodeIds']) {
    if (!Array.isArray(projection[field]) ||
        stableStringify(projection[field]) !== stableStringify(canonicalStrings(projection[field]))) {
      errors.push(`budget-projection-${field}-invalid`)
    }
  }
  for (const field of ['selectedNodeCount', 'estimatedDurationMs', 'hardTimeoutUpperBoundMs', 'logBudgetBytes']) {
    if (!Number.isInteger(projection[field]) || projection[field] < 0) errors.push(`budget-projection-${field}-invalid`)
  }
  if (Array.isArray(projection.selectedNodeIds) && projection.selectedNodeCount !== projection.selectedNodeIds.length) {
    errors.push('budget-projection-selected-node-count-mismatch')
  }
  const expectedDigests = {
    affectedBoundaryDigest: stringSetDigest('ValidationAffectedBoundarySetV1', projection.affectedBoundaries),
    heavyNodeDigest: stringSetDigest('ValidationHeavyNodeSetV1', projection.heavyNodeIds),
    sideEffectCategoryDigest: stringSetDigest('ValidationSideEffectCategorySetV1', projection.sideEffectCategories),
    selectedNodeDigest: stringSetDigest('ValidationSelectedNodeSetV1', projection.selectedNodeIds)
  }
  for (const [field, expected] of Object.entries(expectedDigests)) {
    if (projection[field] !== expected) errors.push(`budget-projection-${field}-mismatch`)
  }
  if (rootConfirmation && errors.length === 0) {
    const bindings = {
      planDigest: rootConfirmation.planDigest,
      budgetDigest: rootConfirmation.budgetDigest,
      level: rootConfirmation.maxLevel,
      purpose: rootConfirmation.purpose,
      affectedBoundaryDigest: rootConfirmation.rootAffectedBoundaryDigest,
      heavyNodeDigest: rootConfirmation.rootHeavyNodeDigest,
      sideEffectCategoryDigest: rootConfirmation.rootSideEffectCategoryDigest,
      selectedNodeDigest: rootConfirmation.rootSelectedNodeDigest,
      selectedNodeCount: rootConfirmation.rootSelectedNodeCount,
      estimatedDurationMs: rootConfirmation.rootEstimatedDurationMs,
      hardTimeoutUpperBoundMs: rootConfirmation.rootHardTimeoutUpperBoundMs,
      logBudgetBytes: rootConfirmation.rootLogBudgetBytes
    }
    for (const [field, expected] of Object.entries(bindings)) {
      if (projection[field] !== expected) errors.push(`budget-projection-root-binding-mismatch:${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], bytes: recordBytes(projection) }
}

function candidateIdentityForAuthority(candidate = {}) {
  const binding = candidateBinding(candidate)
  return {
    candidateId: String(candidate.candidateId || ''),
    candidateDigest: binding.candidateDigest
  }
}

function hostSessionIdentity(value) {
  if (DIGEST_RE.test(String(value || ''))) return String(value)
  if (!text(value, 4096)) return ''
  return digest({ schemaVersion: 'ValidationHostSessionIdentityV1', sessionKey: String(value) })
}

function validatePendingBudgetCardBinding(binding, expected = null, options = {}) {
  const errors = []
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { valid: false, errors: ['pending-budget-invalid'], status: 'invalid' }
  }
  if (binding.schemaVersion !== PENDING_BUDGET_SCHEMA) errors.push('pending-budget-schema-invalid')
  for (const [field, maxLength] of [
    ['taskRecoveryKey', 256], ['project', 255], ['hostSessionDigest', 64], ['contextEpoch', 256],
    ['candidateId', 256], ['candidateDigest', 64], ['planDigest', 64], ['budgetDigest', 64],
    ['level', 2], ['purpose', 32], ['affectedBoundaryDigest', 64], ['heavyNodeDigest', 64],
    ['sideEffectCategoryDigest', 64], ['selectedNodeDigest', 64], ['bindingDigest', 64]
  ]) {
    if (!text(binding[field], maxLength)) errors.push(`pending-budget-${field}-required`)
  }
  for (const field of [
    'hostSessionDigest', 'candidateDigest', 'planDigest', 'budgetDigest', 'affectedBoundaryDigest',
    'heavyNodeDigest', 'sideEffectCategoryDigest', 'selectedNodeDigest', 'bindingDigest'
  ]) {
    if (!DIGEST_RE.test(String(binding[field] || ''))) errors.push(`pending-budget-${field}-invalid`)
  }
  const root = binding.projectRootIdentity
  if (!root || root.schemaVersion !== 'ProjectRootIdentityV1' || !text(root.normalizedRoot, 4096) ||
      !DIGEST_RE.test(String(root.digest || '')) ||
      digest({ schemaVersion: root.schemaVersion, normalizedRoot: root.normalizedRoot }) !== root.digest) {
    errors.push('pending-budget-project-root-invalid')
  }
  if (!Object.hasOwn(LEVEL_RANK, binding.level) || LEVEL_RANK[binding.level] > LEVEL_RANK.V2) errors.push('pending-budget-level-invalid')
  if (!['edit-loop', 'delivery', 'boundary'].includes(binding.purpose)) errors.push('pending-budget-purpose-invalid')
  for (const field of ['selectedNodeCount', 'estimatedDurationMs', 'hardTimeoutUpperBoundMs', 'logBudgetBytes', 'stateRevision']) {
    if (!Number.isInteger(binding[field]) || binding[field] < 0) errors.push(`pending-budget-${field}-invalid`)
  }
  if (binding.hardTimeoutUpperBoundMs <= 0) errors.push('pending-budget-hard-timeout-required')
  if (!PENDING_BUDGET_STATUSES.has(binding.status)) errors.push('pending-budget-status-invalid')
  if (!iso(binding.createdAt) || !iso(binding.expiresAt)) errors.push('pending-budget-time-invalid')
  const createdAtMs = Date.parse(String(binding.createdAt || ''))
  const expiresAtMs = Date.parse(String(binding.expiresAt || ''))
  if (Number.isFinite(createdAtMs) && Number.isFinite(expiresAtMs) &&
      (expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > PENDING_BUDGET_TTL_MS)) {
    errors.push('pending-budget-expiry-window-invalid')
  }
  if (errors.length === 0 && digest(withoutNamedDigest(binding, 'bindingDigest')) !== binding.bindingDigest) {
    errors.push('pending-budget-digest-mismatch')
  }
  const size = recordSizeError(binding, 'VALIDATION_PENDING_BUDGET_TOO_LARGE')
  if (size) errors.push('pending-budget-record-too-large')
  if (expected && errors.length === 0) {
    for (const field of [
      'taskRecoveryKey', 'project', 'hostSessionDigest', 'contextEpoch', 'candidateId', 'candidateDigest',
      'planDigest', 'budgetDigest', 'level', 'purpose', 'affectedBoundaryDigest', 'heavyNodeDigest',
      'sideEffectCategoryDigest', 'selectedNodeDigest', 'stateRevision'
    ]) {
      if (Object.hasOwn(expected, field) && expected[field] !== binding[field]) errors.push(`pending-budget-binding-mismatch:${field}`)
    }
    if (expected.projectRootIdentity && stableStringify(expected.projectRootIdentity) !== stableStringify(binding.projectRootIdentity)) {
      errors.push('pending-budget-binding-mismatch:projectRootIdentity')
    }
  }
  let status = binding.status
  if (errors.length === 0 && status === 'pending' && expiresAtMs <= nowMs) status = 'stale'
  if (status !== 'pending') errors.push(`pending-budget-not-pending:${status}`)
  return { valid: errors.length === 0, errors: [...new Set(errors)], status, bytes: recordBytes(binding) }
}

function createPendingBudgetCardBinding(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const plan = input.plan || {}
  const candidate = input.candidate || { candidateId: plan.candidateId }
  const budget = planBudgetProjection(plan)
  const candidateIdentity = candidateIdentityForAuthority(candidate)
  const createdAt = input.createdAt || new Date(nowMs).toISOString()
  const expiresAt = input.expiresAt || new Date(nowMs + PENDING_BUDGET_TTL_MS).toISOString()
  const semantic = {
    schemaVersion: PENDING_BUDGET_SCHEMA,
    taskRecoveryKey: String(input.taskRecoveryKey || plan.verificationIntent?.taskRecoveryKey || ''),
    project: String(input.project || plan.verificationIntent?.project || ''),
    projectRootIdentity: input.projectRootIdentity || projectRootIdentity(input.repoRoot),
    hostSessionDigest: hostSessionIdentity(input.hostSessionDigest || input.sessionKey),
    contextEpoch: String(input.contextEpoch || plan.verificationIntent?.contextEpoch || ''),
    candidateId: candidateIdentity.candidateId || String(plan.candidateId || ''),
    candidateDigest: candidateIdentity.candidateDigest,
    planDigest: budget.planDigest,
    budgetDigest: budget.budgetDigest,
    level: budget.level,
    purpose: budget.purpose,
    affectedBoundaryDigest: budget.affectedBoundaryDigest,
    heavyNodeDigest: budget.heavyNodeDigest,
    sideEffectCategoryDigest: budget.sideEffectCategoryDigest,
    selectedNodeDigest: budget.selectedNodeDigest,
    selectedNodeCount: budget.selectedNodeCount,
    estimatedDurationMs: budget.estimatedDurationMs,
    hardTimeoutUpperBoundMs: budget.hardTimeoutUpperBoundMs,
    logBudgetBytes: budget.logBudgetBytes,
    createdAt,
    expiresAt,
    stateRevision: Number.isInteger(input.stateRevision) ? input.stateRevision : 1,
    status: 'pending'
  }
  const binding = Object.freeze({ ...semantic, bindingDigest: digest(semantic) })
  const validation = validatePendingBudgetCardBinding(binding, null, { nowMs })
  if (!validation.valid) {
    throw new ValidationAuthorityError('VALIDATION_PENDING_BUDGET_INVALID', 'pending BudgetCard binding is invalid', validation)
  }
  return binding
}

function confirmationSemantic(value = {}) {
  const semantic = withoutNamedDigest(value, 'receiptDigest')
  delete semantic.confirmationId
  return semantic
}

function validateBudgetConfirmationReceipt(receipt, binding = null) {
  const errors = []
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { valid: false, errors: ['budget-confirmation-invalid'] }
  }
  if (receipt.schemaVersion !== BUDGET_CONFIRMATION_SCHEMA) errors.push('budget-confirmation-schema-invalid')
  if (!['user-confirmation', 'auto'].includes(receipt.authorityKind)) errors.push('budget-confirmation-authority-kind-invalid')
  for (const [field, maxLength] of [
    ['confirmationId', 96], ['taskRecoveryKey', 256], ['project', 255], ['hostSessionDigest', 64],
    ['contextEpoch', 256], ['candidateId', 256], ['candidateDigest', 64], ['budgetDigest', 64],
    ['planDigest', 64], ['maxLevel', 2], ['purpose', 32], ['rootAffectedBoundaryDigest', 64],
    ['rootHeavyNodeDigest', 64], ['rootSideEffectCategoryDigest', 64], ['rootSelectedNodeDigest', 64],
    ['pendingBindingDigest', 64], ['receiptDigest', 64]
  ]) {
    if (!text(receipt[field], maxLength)) errors.push(`budget-confirmation-${field}-required`)
  }
  for (const field of [
    'hostSessionDigest', 'candidateDigest', 'budgetDigest', 'planDigest', 'rootAffectedBoundaryDigest',
    'rootHeavyNodeDigest', 'rootSideEffectCategoryDigest', 'rootSelectedNodeDigest', 'pendingBindingDigest', 'receiptDigest'
  ]) {
    if (!DIGEST_RE.test(String(receipt[field] || ''))) errors.push(`budget-confirmation-${field}-invalid`)
  }
  if (receipt.authorityKind === 'user-confirmation') {
    if (!DIGEST_RE.test(String(receipt.sourceMessageDigest || ''))) errors.push('budget-confirmation-source-message-required')
    if (receipt.autoAuthorityRef !== null) errors.push('budget-confirmation-auto-ref-unexpected')
  } else {
    if (!text(receipt.autoAuthorityRef, 1024)) errors.push('budget-confirmation-auto-ref-required')
    if (receipt.sourceMessageDigest !== null) errors.push('budget-confirmation-source-message-unexpected')
  }
  if (!Object.hasOwn(LEVEL_RANK, receipt.maxLevel) || LEVEL_RANK[receipt.maxLevel] > LEVEL_RANK.V2) errors.push('budget-confirmation-level-invalid')
  if (!['edit-loop', 'delivery', 'boundary'].includes(receipt.purpose)) errors.push('budget-confirmation-purpose-invalid')
  for (const field of [
    'rootSelectedNodeCount', 'rootEstimatedDurationMs', 'rootHardTimeoutUpperBoundMs', 'rootLogBudgetBytes', 'revocationEpoch'
  ]) {
    if (!Number.isInteger(receipt[field]) || receipt[field] < 0) errors.push(`budget-confirmation-${field}-invalid`)
  }
  if (!iso(receipt.confirmedAt) || !iso(receipt.consumedAt)) errors.push('budget-confirmation-time-invalid')
  if (receipt.status !== 'consumed') errors.push('budget-confirmation-status-invalid')
  const rolloverFields = [
    receipt.parentRootReceiptDigest,
    receipt.parentTerminalDigest,
    receipt.rootRolloverReason
  ]
  if (rolloverFields.some(value => value != null)) {
    if (receipt.authorityKind !== 'auto') errors.push('budget-confirmation-rollover-authority-invalid')
    if (!DIGEST_RE.test(String(receipt.parentRootReceiptDigest || ''))) {
      errors.push('budget-confirmation-parent-root-digest-invalid')
    }
    if (!DIGEST_RE.test(String(receipt.parentTerminalDigest || ''))) {
      errors.push('budget-confirmation-parent-terminal-digest-invalid')
    }
    if (receipt.rootRolloverReason !== 'strict-descendant-same-scope') {
      errors.push('budget-confirmation-rollover-reason-invalid')
    }
  }
  if (errors.length === 0 && digest(confirmationSemantic(receipt)) !== receipt.receiptDigest) errors.push('budget-confirmation-digest-mismatch')
  if (errors.length === 0 && receipt.confirmationId !== `budget-confirmation-${receipt.receiptDigest}`) errors.push('budget-confirmation-id-mismatch')
  if (recordSizeError(receipt, 'VALIDATION_BUDGET_CONFIRMATION_TOO_LARGE')) errors.push('budget-confirmation-record-too-large')
  if (binding && errors.length === 0) {
    for (const field of [
      'taskRecoveryKey', 'project', 'hostSessionDigest', 'contextEpoch', 'candidateId', 'candidateDigest',
      'budgetDigest', 'planDigest', 'maxLevel', 'purpose', 'revocationEpoch'
    ]) {
      if (Object.hasOwn(binding, field) && binding[field] !== receipt[field]) errors.push(`budget-confirmation-binding-mismatch:${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], bytes: recordBytes(receipt) }
}

function createBudgetConfirmationReceipt(input = {}, options = {}) {
  const pending = input.pendingBudgetCard
  const pendingValidation = validatePendingBudgetCardBinding(pending, input.pendingBinding || null, options)
  if (!pendingValidation.valid) {
    const code = pendingValidation.status === 'stale' ? 'VALIDATION_PENDING_BUDGET_STALE' : 'VALIDATION_PENDING_BUDGET_MISSING'
    throw new ValidationAuthorityError(code, 'one fresh exact pending BudgetCard is required', pendingValidation)
  }
  const authorityKind = String(input.authorityKind || '')
  const sourceMessageDigest = input.sourceMessageDigest == null ? null : String(input.sourceMessageDigest)
  const autoAuthorityRef = input.autoAuthorityRef == null ? null : String(input.autoAuthorityRef)
  if (authorityKind === 'user-confirmation') {
    if (options.currentUserInstruction !== true || !DIGEST_RE.test(sourceMessageDigest) ||
        (options.currentSourceMessageDigest && options.currentSourceMessageDigest !== sourceMessageDigest)) {
      throw new ValidationAuthorityError('VALIDATION_BUDGET_CONFIRMATION_SOURCE_INVALID', 'BudgetCard confirmation must come from the current user instruction segment')
    }
  } else if (authorityKind === 'auto') {
    if (!text(autoAuthorityRef, 1024) || options.serverOwnedAutoAuthorityRef !== autoAuthorityRef) {
      throw new ValidationAuthorityError('VALIDATION_AUTO_AUTHORITY_INVALID', 'Auto BudgetCard authority must be issued by the current server-owned session')
    }
  } else {
    throw new ValidationAuthorityError('VALIDATION_BUDGET_CONFIRMATION_AUTHORITY_INVALID', 'BudgetCard authority kind is invalid')
  }
  const confirmedAt = input.confirmedAt || new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString()
  const semantic = {
    schemaVersion: BUDGET_CONFIRMATION_SCHEMA,
    authorityKind,
    sourceMessageDigest: authorityKind === 'user-confirmation' ? sourceMessageDigest : null,
    autoAuthorityRef: authorityKind === 'auto' ? autoAuthorityRef : null,
    taskRecoveryKey: pending.taskRecoveryKey,
    project: pending.project,
    projectRootIdentity: pending.projectRootIdentity,
    hostSessionDigest: pending.hostSessionDigest,
    contextEpoch: pending.contextEpoch,
    candidateId: pending.candidateId,
    candidateDigest: pending.candidateDigest,
    budgetDigest: pending.budgetDigest,
    planDigest: pending.planDigest,
    maxLevel: pending.level,
    purpose: pending.purpose,
    rootAffectedBoundaryDigest: pending.affectedBoundaryDigest,
    rootHeavyNodeDigest: pending.heavyNodeDigest,
    rootSideEffectCategoryDigest: pending.sideEffectCategoryDigest,
    rootSelectedNodeDigest: pending.selectedNodeDigest,
    rootSelectedNodeCount: pending.selectedNodeCount,
    rootEstimatedDurationMs: pending.estimatedDurationMs,
    rootHardTimeoutUpperBoundMs: pending.hardTimeoutUpperBoundMs,
    rootLogBudgetBytes: pending.logBudgetBytes,
    pendingBindingDigest: pending.bindingDigest,
    ...(input.parentRootReceiptDigest
      ? {
          parentRootReceiptDigest: String(input.parentRootReceiptDigest),
          parentTerminalDigest: String(input.parentTerminalDigest || ''),
          rootRolloverReason: String(input.rootRolloverReason || '')
        }
      : {}),
    revocationEpoch: Number.isInteger(input.revocationEpoch) ? input.revocationEpoch : 0,
    confirmedAt,
    consumedAt: confirmedAt,
    status: 'consumed'
  }
  const receiptDigest = digest(semantic)
  const receipt = Object.freeze({
    ...semantic,
    receiptDigest,
    confirmationId: `budget-confirmation-${receiptDigest}`
  })
  const validation = validateBudgetConfirmationReceipt(receipt)
  if (!validation.valid) {
    throw new ValidationAuthorityError('VALIDATION_BUDGET_CONFIRMATION_INVALID', 'BudgetCard confirmation receipt is invalid', validation)
  }
  return receipt
}

function continuationDigestSemantic(value = {}) {
  const semantic = withoutNamedDigest(value, 'continuationDigest')
  semantic.status = 'prepared'
  return semantic
}

function validateValidationContinuationAuthorization(authorization, binding = null) {
  const errors = []
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return { valid: false, errors: ['continuation-invalid'], status: 'invalid' }
  }
  if (authorization.schemaVersion !== CONTINUATION_AUTHORIZATION_SCHEMA) errors.push('continuation-schema-invalid')
  for (const [field, maxLength] of [
    ['rootConfirmationDigest', 64], ['parentRunId', 96], ['parentRunIdentityDigest', 64],
    ['parentBudgetDigest', 64], ['newBudgetDigest', 64], ['originalAuthorityRef', 1024],
    ['taskRecoveryKey', 256], ['project', 255], ['hostSessionDigest', 64], ['oldContextEpoch', 256],
    ['newContextEpoch', 256], ['continuationReceiptDigest', 64], ['failedNodeId', 256],
    ['parentTerminalDigest', 64], ['repairMutationFootprintDigest', 64],
    ['repairObservationReceiptDigest', 64], ['repairProofKind', 64],
    ['nodeDeltaDigest', 64], ['continuationDigest', 64]
  ]) {
    if (!text(authorization[field], maxLength)) errors.push(`continuation-${field}-required`)
  }
  for (const field of [
    'rootConfirmationDigest', 'parentRunIdentityDigest', 'parentBudgetDigest', 'newBudgetDigest',
    'hostSessionDigest', 'continuationReceiptDigest', 'parentTerminalDigest', 'repairMutationFootprintDigest',
    'repairObservationReceiptDigest', 'nodeDeltaDigest', 'continuationDigest'
  ]) {
    if (!DIGEST_RE.test(String(authorization[field] || ''))) errors.push(`continuation-${field}-invalid`)
  }
  if (!Array.isArray(authorization.addedNodeIds) || !Array.isArray(authorization.removedNodeIds)) errors.push('continuation-node-delta-invalid')
  if (!CONTINUATION_REPAIR_PROOF_KINDS.has(authorization.repairProofKind)) errors.push('continuation-repair-proof-kind-invalid')
  if (!Number.isInteger(authorization.estimatedDeltaMs)) errors.push('continuation-estimated-delta-invalid')
  if (!Number.isInteger(authorization.hardTimeoutDeltaMs)) errors.push('continuation-hard-timeout-delta-invalid')
  if (!Number.isInteger(authorization.logBudgetDeltaBytes)) errors.push('continuation-log-budget-delta-invalid')
  if (!Number.isInteger(authorization.retryOrdinal) || authorization.retryOrdinal < 1 || authorization.retryOrdinal > MAX_CONTINUATION_RETRIES) {
    errors.push('continuation-retry-ordinal-invalid')
  }
  if (!Number.isInteger(authorization.revocationEpoch) || authorization.revocationEpoch < 0) errors.push('continuation-revocation-epoch-invalid')
  if (!iso(authorization.issuedAt)) errors.push('continuation-issued-at-invalid')
  if (!CONTINUATION_STATUSES.has(authorization.status)) errors.push('continuation-status-invalid')
  if (errors.length === 0 && digest(continuationDigestSemantic(authorization)) !== authorization.continuationDigest) {
    errors.push('continuation-digest-mismatch')
  }
  if (recordSizeError(authorization, 'VALIDATION_CONTINUATION_TOO_LARGE')) errors.push('continuation-record-too-large')
  if (binding && errors.length === 0) {
    for (const field of [
      'rootConfirmationDigest', 'taskRecoveryKey', 'project', 'hostSessionDigest', 'newContextEpoch',
      'newBudgetDigest', 'revocationEpoch', 'retryOrdinal'
    ]) {
      if (Object.hasOwn(binding, field) && binding[field] !== authorization[field]) errors.push(`continuation-binding-mismatch:${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], status: authorization.status, bytes: recordBytes(authorization) }
}

function setSubset(values, allowed) {
  const allowedSet = new Set(canonicalStrings(allowed))
  return canonicalStrings(values).every(value => allowedSet.has(value))
}

function recoverableParentTerminal(terminal = {}) {
  if (RECOVERABLE_TERMINAL_STATUSES.has(terminal.terminalStatus)) return true
  return terminal.terminalStatus === 'cancelled' && Number(terminal.nativeExitCode) === 124
}

function recoverableTerminalFailureId(terminal = {}) {
  const value = String(terminal.failedNode || terminal.failedNodeId || terminal.terminalReason?.code || '')
  return text(value, 256) ? value : ''
}

function createValidationContinuationAuthorization(input = {}, options = {}) {
  const root = input.rootConfirmation
  const rootValidation = validateBudgetConfirmationReceipt(root)
  if (!rootValidation.valid) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_PARENT_INELIGIBLE', 'root BudgetCard confirmation is invalid', rootValidation)
  }
  const rootPlan = input.rootPlan || {}
  const nextPlan = input.newPlan || {}
  const rootBudget = input.rootBudgetProjection || planBudgetProjection(rootPlan)
  const nextBudget = planBudgetProjection(nextPlan)
  const rootProjectionValidation = validateValidationBudgetProjection(rootBudget, root)
  if (!rootProjectionValidation.valid) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_PARENT_INELIGIBLE', 'root plan no longer matches the immutable root confirmation')
  }
  const parentRun = input.parentRunIdentity || {}
  const terminal = input.parentTerminal || {}
  const failedNodeId = recoverableTerminalFailureId(terminal)
  if (!recoverableParentTerminal(terminal) || !DIGEST_RE.test(String(terminal.terminalDigest || '')) ||
      parentRun.runIdentityDigest !== terminal.runIdentityDigest || !failedNodeId) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_PARENT_INELIGIBLE', 'parent run has no exact recoverable terminal failure')
  }
  const exactTaskFields = [
    ['taskRecoveryKey', input.taskRecoveryKey || parentRun.taskRecoveryKey, root.taskRecoveryKey],
    ['project', input.project || parentRun.project, root.project],
    ['hostSessionDigest', hostSessionIdentity(input.hostSessionDigest || input.sessionKey), root.hostSessionDigest]
  ]
  if (exactTaskFields.some(([, observed, expected]) => String(observed || '') !== String(expected || '')) ||
      stableStringify(input.projectRootIdentity || parentRun.projectRootIdentity) !== stableStringify(root.projectRootIdentity)) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_SCOPE_WIDENED', 'continuation task, project, root or host session changed')
  }
  if (!Object.hasOwn(LEVEL_RANK, nextBudget.level) || LEVEL_RANK[nextBudget.level] > LEVEL_RANK.V2 ||
      LEVEL_RANK[nextBudget.level] > LEVEL_RANK[root.maxLevel] || nextBudget.purpose !== root.purpose ||
      !setSubset(nextBudget.affectedBoundaries, rootBudget.affectedBoundaries) ||
      !setSubset(nextBudget.heavyNodeIds, rootBudget.heavyNodeIds) ||
      !setSubset(nextBudget.sideEffectCategories, rootBudget.sideEffectCategories)) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_SCOPE_WIDENED', 'continuation widened level, purpose, boundary, heavy node or side-effect scope')
  }
  const rootNodeSet = new Set(rootBudget.selectedNodeIds)
  const nextNodeSet = new Set(nextBudget.selectedNodeIds)
  const addedNodeIds = [...nextNodeSet].filter(id => !rootNodeSet.has(id)).sort()
  const removedNodeIds = [...rootNodeSet].filter(id => !nextNodeSet.has(id)).sort()
  const allowedAddedNodeIds = canonicalStrings(input.allowedAddedNodeIds)
  const addedConsumerEdgeTypes = canonicalStrings(input.addedConsumerEdgeTypes)
  const repairProofKind = CONTINUATION_REPAIR_PROOF_KINDS.has(input.repairProofKind)
    ? input.repairProofKind
    : 'mutation-observation'
  let repairMutationFootprintDigest = String(input.repairMutationFootprintDigest || '')
  let repairObservationReceiptDigest = String(input.repairObservationReceiptDigest || '')
  let repairProofValid = input.repairFootprintProven === true &&
    DIGEST_RE.test(repairMutationFootprintDigest) && DIGEST_RE.test(repairObservationReceiptDigest)
  if (repairProofKind === 'same-scope-retry') {
    const currentCandidate = input.newCandidate || {}
    const currentBinding = candidateBinding(currentCandidate)
    const priorChangedFiles = canonicalStrings(terminal.candidateChangedFiles)
    const currentChangedFiles = canonicalStrings(currentCandidate.changedFiles)
    const sameTrackedScope = terminal.candidateChangedFilesTruncated !== true && currentCandidate.stable === true &&
      String(currentCandidate.head || '') === String(parentRun.candidateHead || '') &&
      setSubset(currentChangedFiles, priorChangedFiles)
    const sameOrNarrowerPlan = addedNodeIds.length === 0 &&
      nextBudget.estimatedDurationMs <= root.rootEstimatedDurationMs &&
      nextBudget.hardTimeoutUpperBoundMs <= root.rootHardTimeoutUpperBoundMs &&
      nextBudget.logBudgetBytes <= root.rootLogBudgetBytes
    repairProofValid = sameTrackedScope && sameOrNarrowerPlan
    repairMutationFootprintDigest = digest({
      schemaVersion: 'ValidationSameScopeRetryProofV1',
      parentCandidateDigest: parentRun.candidateDigest,
      currentCandidateDigest: currentBinding.candidateDigest,
      priorChangedFiles,
      currentChangedFiles
    })
    repairObservationReceiptDigest = digest({
      schemaVersion: 'ValidationSameScopeRetryTriggerV1',
      parentTerminalDigest: terminal.terminalDigest,
      failedNodeId,
      continuationReceiptDigest: input.continuationReceiptDigest,
      retryOrdinal: Number(input.retryOrdinal)
    })
  }
  if (!repairProofValid ||
      !setSubset(addedNodeIds, allowedAddedNodeIds) || addedConsumerEdgeTypes.includes('releaseConsumer') ||
      (Array.isArray(input.unrelatedDirtyFiles) && input.unrelatedDirtyFiles.length > 0)) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_FOOTPRINT_UNPROVEN', 'repair footprint or typed consumer lineage does not prove every continuation delta')
  }
  const maxAddedNodes = Math.min(3, Math.max(1, Math.ceil(root.rootSelectedNodeCount * 0.05)))
  const estimatedDeltaMs = nextBudget.estimatedDurationMs - root.rootEstimatedDurationMs
  const hardTimeoutDeltaMs = nextBudget.hardTimeoutUpperBoundMs - root.rootHardTimeoutUpperBoundMs
  const logBudgetDeltaBytes = nextBudget.logBudgetBytes - root.rootLogBudgetBytes
  const maxEstimatedDeltaMs = Math.min(60000, Math.ceil(root.rootEstimatedDurationMs * 0.05))
  if (addedNodeIds.length > maxAddedNodes || estimatedDeltaMs > maxEstimatedDeltaMs ||
      hardTimeoutDeltaMs > 0 || logBudgetDeltaBytes > 0) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_BUDGET_EXCEEDED', 'continuation exceeds the immutable root node, estimate, hard-timeout or log budget')
  }
  const retryOrdinal = Number(input.retryOrdinal)
  if (!Number.isInteger(retryOrdinal) || retryOrdinal < 1 || retryOrdinal > MAX_CONTINUATION_RETRIES) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_RETRY_EXHAUSTED', 'continuation retry ordinal exceeds the root allowance')
  }
  if (Number(input.revocationEpoch) !== root.revocationEpoch) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_REVOKED', 'continuation authority was revoked or changed')
  }
  const oldContextEpoch = String(input.oldContextEpoch || parentRun.contextEpoch || '')
  const newContextEpoch = String(input.newContextEpoch || nextPlan.verificationIntent?.contextEpoch || '')
  const contextReceiptDigest = String(input.continuationReceiptDigest || '')
  if (!DIGEST_RE.test(contextReceiptDigest) ||
      (oldContextEpoch !== newContextEpoch && options.serverOwnedContextContinuationReceiptDigest !== contextReceiptDigest)) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_REVOKED', 'context continuation lacks a current server-owned receipt')
  }
  const nodeDeltaDigest = digest({ schemaVersion: 'ValidationNodeDeltaV1', addedNodeIds, removedNodeIds })
  const semantic = {
    schemaVersion: CONTINUATION_AUTHORIZATION_SCHEMA,
    rootConfirmationDigest: root.receiptDigest,
    parentRunId: String(parentRun.runId || ''),
    parentRunIdentityDigest: String(parentRun.runIdentityDigest || ''),
    parentBudgetDigest: String(parentRun.budgetDigest || ''),
    newBudgetDigest: nextBudget.budgetDigest,
    originalAuthorityRef: String(input.originalAuthorityRef || ''),
    taskRecoveryKey: root.taskRecoveryKey,
    project: root.project,
    projectRootIdentity: root.projectRootIdentity,
    hostSessionDigest: root.hostSessionDigest,
    oldContextEpoch,
    newContextEpoch,
    continuationReceiptDigest: contextReceiptDigest,
    failedNodeId,
    parentTerminalDigest: String(terminal.terminalDigest || ''),
    repairMutationFootprintDigest,
    repairObservationReceiptDigest,
    repairProofKind,
    addedNodeIds,
    removedNodeIds,
    nodeDeltaDigest,
    estimatedDeltaMs,
    hardTimeoutDeltaMs,
    logBudgetDeltaBytes,
    retryOrdinal,
    revocationEpoch: root.revocationEpoch,
    issuedAt: input.issuedAt || new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString(),
    status: 'prepared'
  }
  const authorization = Object.freeze({ ...semantic, continuationDigest: digest(semantic) })
  const validation = validateValidationContinuationAuthorization(authorization)
  if (!validation.valid) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_INVALID', 'continuation authorization is invalid', validation)
  }
  return authorization
}

function transitionValidationContinuation(authorization, status) {
  const validation = validateValidationContinuationAuthorization(authorization)
  if (!validation.valid) throw new ValidationAuthorityError('VALIDATION_CONTINUATION_INVALID', 'continuation authorization is invalid', validation)
  const allowed = {
    prepared: new Set(['leased', 'revoked', 'stale']),
    leased: new Set(['consumed', 'revoked', 'stale'])
  }
  if (!allowed[authorization.status]?.has(status)) {
    throw new ValidationAuthorityError('VALIDATION_CONTINUATION_TRANSITION_INVALID', 'continuation state transition is invalid')
  }
  const next = Object.freeze({ ...authorization, status })
  const nextValidation = validateValidationContinuationAuthorization(next)
  if (!nextValidation.valid) throw new ValidationAuthorityError('VALIDATION_CONTINUATION_INVALID', 'transitioned continuation is invalid', nextValidation)
  return next
}

function approvePlanFromBudgetAuthority(plan, authority) {
  const budgetDigest = authority?.schemaVersion === BUDGET_CONFIRMATION_SCHEMA
    ? authority.budgetDigest
    : authority?.newBudgetDigest
  if (!DIGEST_RE.test(String(budgetDigest || '')) || budgetDigest !== plan?.budgetCard?.digest) {
    throw new ValidationAuthorityError('VALIDATION_AUTHORITY_REQUIRED', 'BudgetCard authority does not match the exact plan')
  }
  return Object.freeze({
    ...plan,
    budgetCard: Object.freeze({ ...plan.budgetCard, status: 'approved', authorityDigest: authority.receiptDigest || authority.continuationDigest }),
    executionState: Array.isArray(plan.selectedNodes) && plan.selectedNodes.length > 0 ? 'awaiting-authority' : 'ready'
  })
}

function normalizeProjectRoot(repoRoot) {
  const resolved = path.resolve(String(repoRoot || ''))
  const normalized = resolved.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function projectRootIdentity(repoRoot) {
  const normalizedRoot = normalizeProjectRoot(repoRoot)
  return Object.freeze({
    schemaVersion: 'ProjectRootIdentityV1',
    normalizedRoot,
    digest: digest({ schemaVersion: 'ProjectRootIdentityV1', normalizedRoot })
  })
}

function candidateBinding(candidate = {}) {
  const semantic = {
    schemaVersion: 'ValidationCandidateBindingV1',
    candidateId: String(candidate.candidateId || ''),
    stable: candidate.stable === true,
    head: candidate.head == null ? null : String(candidate.head),
    changedSource: String(candidate.changedSource || 'unknown'),
    changedFiles: [...new Set((candidate.changedFiles || []).map(String))].sort(),
    dirtyIdentities: candidate.dirtyIdentities || [],
    scopeIdentities: candidate.scopeIdentities || candidate.dirtyIdentities || [],
    identityInputs: candidate.identityInputs || null
  }
  return {
    candidateDigest: digest(semantic),
    dirtyScopeDigest: digest({
      schemaVersion: 'ValidationDirtyScopeBindingV1',
      dirtyIdentities: semantic.dirtyIdentities,
      scopeIdentities: semantic.scopeIdentities
    })
  }
}

function actorIdentity(input = {}) {
  const semantic = {
    schemaVersion: 'ValidationActorIdentityV1',
    actorType: String(input.actorType || ''),
    authoritySourceRef: String(input.authoritySourceRef || ''),
    sourceMessageDigest: input.sourceMessageDigest == null ? null : String(input.sourceMessageDigest),
    policyDigest: input.policyDigest == null ? null : String(input.policyDigest),
    evidence: input.actorIdentityEvidence && typeof input.actorIdentityEvidence === 'object'
      ? input.actorIdentityEvidence
      : null
  }
  return Object.freeze({ ...semantic, digest: digest(semantic) })
}

function validateValidationRunIdentity(runIdentity) {
  const errors = []
  if (!runIdentity || typeof runIdentity !== 'object' || Array.isArray(runIdentity)) {
    return { valid: false, errors: ['run-identity-invalid'] }
  }
  if (runIdentity.schemaVersion !== RUN_IDENTITY_SCHEMA) errors.push('run-identity-schema-invalid')
  if (!ACTOR_TYPES.has(runIdentity.actorType)) errors.push('run-identity-actor-invalid')
  if (!AUTHORITY_CLASSES.has(runIdentity.authorityClass)) errors.push('run-identity-authority-class-invalid')
  for (const [field, maxLength] of [
    ['project', 255], ['candidateId', 256], ['planDigest', 64], ['budgetDigest', 64],
    ['requestDigest', 64], ['maxLevel', 2], ['purpose', 32], ['runId', 96]
  ]) {
    if (!text(runIdentity[field], maxLength)) errors.push(`run-identity-${field}-required`)
  }
  for (const field of [
    'actorIdentityDigest', 'candidateDigest', 'dirtyScopeDigest', 'changedScopeDigest',
    'planDigest', 'budgetDigest', 'requestDigest', 'runIdentityDigest'
  ]) {
    if (!DIGEST_RE.test(String(runIdentity[field] || ''))) errors.push(`run-identity-${field}-invalid`)
  }
  const root = runIdentity.projectRootIdentity
  if (!root || root.schemaVersion !== 'ProjectRootIdentityV1' || !text(root.normalizedRoot, 4096) ||
      !DIGEST_RE.test(String(root.digest || '')) ||
      digest({ schemaVersion: root.schemaVersion, normalizedRoot: root.normalizedRoot }) !== root.digest) {
    errors.push('run-identity-project-root-invalid')
  }
  if (runIdentity.candidateHead !== null && !text(runIdentity.candidateHead, 128)) errors.push('run-identity-candidate-head-invalid')
  if (runIdentity.taskRecoveryKey !== null && !text(runIdentity.taskRecoveryKey, 256)) errors.push('run-identity-task-key-invalid')
  if (runIdentity.contextEpoch !== null && !text(runIdentity.contextEpoch, 256)) errors.push('run-identity-context-epoch-invalid')
  if (!Object.hasOwn(LEVEL_RANK, runIdentity.maxLevel)) errors.push('run-identity-max-level-invalid')
  if (!['edit-loop', 'delivery', 'boundary', 'full-audit', 'release'].includes(runIdentity.purpose)) errors.push('run-identity-purpose-invalid')
  if (!Number.isInteger(runIdentity.estimatedDurationMs) || runIdentity.estimatedDurationMs < 0) {
    errors.push('run-identity-estimated-duration-invalid')
  }
  if (!Number.isInteger(runIdentity.hardTimeoutUpperBoundMs) || runIdentity.hardTimeoutUpperBoundMs <= 0) {
    errors.push('run-identity-hard-timeout-invalid')
  }
  if (Number.isInteger(runIdentity.estimatedDurationMs) && Number.isInteger(runIdentity.hardTimeoutUpperBoundMs) &&
      runIdentity.estimatedDurationMs > runIdentity.hardTimeoutUpperBoundMs) errors.push('run-identity-budget-order-invalid')
  if (typeof runIdentity.budgetConfirmationRequired !== 'boolean') errors.push('run-identity-budget-confirmation-invalid')
  if (!['not-required', 'approved'].includes(runIdentity.budgetStatus)) errors.push('run-identity-budget-status-invalid')
  if (runIdentity.budgetConfirmationRequired && runIdentity.budgetStatus !== 'approved') {
    errors.push('run-identity-budget-approval-required')
  }
  if (runIdentity.maxLevel === 'V3' &&
      (!runIdentity.budgetConfirmationRequired || runIdentity.budgetStatus !== 'approved')) {
    errors.push('run-identity-v3-budget-approval-required')
  }
  if (runIdentity.maxLevel === 'V3' && !['full-audit', 'release'].includes(runIdentity.purpose)) {
    errors.push('run-identity-v3-purpose-invalid')
  } else if (runIdentity.maxLevel !== 'V3' && ['full-audit', 'release'].includes(runIdentity.purpose)) {
    errors.push('run-identity-v3-purpose-without-v3')
  }
  if (!Number.isInteger(runIdentity.revocationEpoch) || runIdentity.revocationEpoch < 0) errors.push('run-identity-revocation-epoch-invalid')
  if (errors.length === 0) {
    const expectedDigest = digest(withoutRunIdentityDigest(runIdentity))
    if (expectedDigest !== runIdentity.runIdentityDigest) errors.push('run-identity-digest-mismatch')
    if (runIdentity.runId !== `validation-run-${runIdentity.runIdentityDigest}`) errors.push('run-identity-id-mismatch')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function createValidationRunIdentity(input = {}) {
  if (!text(input.repoRoot, 4096)) {
    throw new ValidationAuthorityError('VALIDATION_PROJECT_ROOT_REQUIRED', 'validation run identity requires the exact project root')
  }
  const plan = input.plan || {}
  const candidate = input.candidate || {}
  const budgetCard = plan.budgetCard || input.budgetCard || {}
  const actor = actorIdentity(input)
  const candidateEvidence = candidateBinding(candidate)
  const semantic = {
    schemaVersion: RUN_IDENTITY_SCHEMA,
    actorType: String(input.actorType || ''),
    actorIdentityDigest: actor.digest,
    authorityClass: String(input.authorityClass || ''),
    project: String(input.project || plan.verificationIntent?.project || ''),
    projectRootIdentity: projectRootIdentity(input.repoRoot),
    taskRecoveryKey: input.taskRecoveryKey == null
      ? (plan.verificationIntent?.taskRecoveryKey == null ? null : String(plan.verificationIntent.taskRecoveryKey))
      : String(input.taskRecoveryKey),
    contextEpoch: input.contextEpoch == null
      ? (plan.verificationIntent?.contextEpoch == null ? null : String(plan.verificationIntent.contextEpoch))
      : String(input.contextEpoch),
    candidateId: String(candidate.candidateId || input.candidateId || ''),
    candidateHead: (candidate.head == null ? input.candidateHead : candidate.head) == null
      ? null
      : String(candidate.head == null ? input.candidateHead : candidate.head),
    candidateDigest: candidateEvidence.candidateDigest,
    dirtyScopeDigest: candidateEvidence.dirtyScopeDigest,
    changedScopeDigest: String(plan.changedScopeDigest || input.changedScopeDigest || ''),
    planDigest: String(plan.planDigest || input.planDigest || ''),
    budgetDigest: String(budgetCard.digest || input.budgetDigest || ''),
    requestDigest: String(plan.requestDigest || input.requestDigest || ''),
    maxLevel: String(plan.verificationLevel || input.maxLevel || ''),
    purpose: String(plan.verificationPurpose || input.purpose || ''),
    estimatedDurationMs: Number(budgetCard.estimatedDurationMs || input.estimatedDurationMs || 0),
    hardTimeoutUpperBoundMs: Number(budgetCard.hardTimeoutUpperBoundMs || input.hardTimeoutUpperBoundMs || 0),
    budgetConfirmationRequired: budgetCard.confirmationRequired === true,
    budgetStatus: budgetCard.confirmationRequired === true
      ? String(budgetCard.status || '')
      : 'not-required',
    revocationEpoch: Number.isInteger(input.revocationEpoch) ? input.revocationEpoch : 0
  }
  const runIdentityDigest = digest(semantic)
  const runIdentity = Object.freeze({
    ...semantic,
    runIdentityDigest,
    runId: `validation-run-${runIdentityDigest}`
  })
  const validation = validateValidationRunIdentity(runIdentity)
  if (!validation.valid) {
    throw new ValidationAuthorityError('VALIDATION_RUN_IDENTITY_INVALID', 'validation run identity is invalid', validation)
  }
  return runIdentity
}

function deriveLeaseWindowMs(runIdentity, requestedWindowMs = null) {
  const hardMs = runIdentity.hardTimeoutUpperBoundMs
  if (Number.isInteger(requestedWindowMs) && requestedWindowMs > 0) return Math.min(hardMs, requestedWindowMs)
  const estimate = Number(runIdentity.estimatedDurationMs || 0)
  const margin = Math.max(LEASE_MARGIN_FLOOR_MS, Math.ceil(estimate * 0.25))
  return Math.min(hardMs, Math.max(Math.min(MIN_LEASE_WINDOW_MS, hardMs), estimate + margin))
}

function validateVerificationExecutionLease(lease, binding = null, options = {}) {
  const errors = []
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (!lease || typeof lease !== 'object' || Array.isArray(lease)) {
    return { valid: false, errors: ['lease-invalid'], status: 'invalid' }
  }
  if (lease.schemaVersion === LEGACY_LEASE_SCHEMA) {
    return { valid: false, errors: ['lease-v1-read-only'], status: 'read-only' }
  }
  if (lease.schemaVersion !== LEASE_SCHEMA) errors.push('lease-schema-invalid')
  const runIdentityValidation = validateValidationRunIdentity(lease.runIdentity)
  if (!runIdentityValidation.valid) errors.push(...runIdentityValidation.errors)
  if (!ACTOR_TYPES.has(lease.actorType)) errors.push('lease-actor-invalid')
  if (!AUTHORITY_CLASSES.has(lease.authorityClass)) errors.push('lease-authority-class-invalid')
  for (const [field, maxLength] of [
    ['project', 255],
    ['candidateId', 256],
    ['candidateDigest', 64],
    ['dirtyScopeDigest', 64],
    ['planDigest', 64],
    ['budgetDigest', 64],
    ['requestDigest', 64],
    ['runIdentityDigest', 64],
    ['runId', 96],
    ['maxLevel', 2],
    ['purpose', 32],
    ['authoritySourceRef', 1024]
  ]) {
    if (!text(lease[field], maxLength)) errors.push(`lease-${field}-required`)
  }
  for (const field of [
    'actorIdentityDigest', 'candidateDigest', 'dirtyScopeDigest', 'changedScopeDigest',
    'planDigest', 'budgetDigest', 'requestDigest', 'runIdentityDigest'
  ]) {
    if (!DIGEST_RE.test(String(lease[field] || ''))) errors.push(`lease-${field}-invalid`)
  }
  if (!lease.projectRootIdentity || stableStringify(lease.projectRootIdentity) !== stableStringify(lease.runIdentity?.projectRootIdentity)) {
    errors.push('lease-project-root-identity-invalid')
  }
  if (lease.candidateHead !== null && !text(lease.candidateHead, 128)) errors.push('lease-candidate-head-invalid')
  if (lease.taskRecoveryKey !== null && !text(lease.taskRecoveryKey, 256)) errors.push('lease-task-key-invalid')
  if (lease.contextEpoch !== null && !text(lease.contextEpoch, 256)) errors.push('lease-context-epoch-invalid')
  if (!Object.hasOwn(LEVEL_RANK, lease.maxLevel)) errors.push('lease-max-level-invalid')
  if (!['edit-loop', 'delivery', 'boundary', 'full-audit', 'release'].includes(lease.purpose)) errors.push('lease-purpose-invalid')
  if (lease.sourceMessageDigest !== null && !DIGEST_RE.test(String(lease.sourceMessageDigest || ''))) errors.push('lease-source-message-digest-invalid')
  if (lease.policyDigest !== null && !DIGEST_RE.test(String(lease.policyDigest || ''))) errors.push('lease-policy-digest-invalid')
  if (actorIdentity(lease).digest !== lease.actorIdentityDigest) errors.push('lease-actor-identity-mismatch')
  if (!iso(lease.issuedAt) || !iso(lease.expiresAt) || !iso(lease.hardDeadlineAt) ||
      (lease.lastRenewedAt !== null && !iso(lease.lastRenewedAt))) errors.push('lease-time-invalid')
  const issuedAtMs = Date.parse(String(lease.issuedAt || ''))
  const expiresAtMs = Date.parse(String(lease.expiresAt || ''))
  const hardDeadlineAtMs = Date.parse(String(lease.hardDeadlineAt || ''))
  if (Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs <= issuedAtMs) errors.push('lease-expiry-order-invalid')
  if (Number.isFinite(expiresAtMs) && Number.isFinite(hardDeadlineAtMs) && expiresAtMs > hardDeadlineAtMs) {
    errors.push('lease-hard-deadline-exceeded')
  }
  if (Number.isFinite(issuedAtMs) && Number.isFinite(hardDeadlineAtMs) &&
      hardDeadlineAtMs !== issuedAtMs + Number(lease.runIdentity?.hardTimeoutUpperBoundMs || 0)) {
    errors.push('lease-hard-deadline-binding-invalid')
  }
  if (!Number.isInteger(lease.leaseWindowMs) || lease.leaseWindowMs <= 0 ||
      lease.leaseWindowMs > Number(lease.runIdentity?.hardTimeoutUpperBoundMs || 0)) errors.push('lease-window-invalid')
  if (!Number.isInteger(lease.leaseGeneration) || lease.leaseGeneration < 0) errors.push('lease-generation-invalid')
  if (!Number.isInteger(lease.renewalCount) || lease.renewalCount < 0 || lease.renewalCount !== lease.leaseGeneration) {
    errors.push('lease-renewal-count-invalid')
  }
  if (!Number.isInteger(lease.revocationEpoch) || lease.revocationEpoch < 0) errors.push('lease-revocation-epoch-invalid')
  if (lease.singleUse !== true) errors.push('lease-single-use-required')
  if (!LEASE_STATUSES.has(lease.status)) errors.push('lease-status-invalid')
  if (!DIGEST_RE.test(String(lease.authorityDigest || ''))) errors.push('lease-digest-invalid')

  if (lease.authorityClass === 'scoped' && LEVEL_RANK[lease.maxLevel] > LEVEL_RANK.V2) errors.push('lease-scoped-level-exceeded')
  if (lease.authorityClass === 'full-audit' && (lease.maxLevel !== 'V3' || lease.purpose !== 'full-audit')) errors.push('lease-full-audit-binding-invalid')
  if (lease.authorityClass === 'release' && (lease.maxLevel !== 'V3' || lease.purpose !== 'release')) errors.push('lease-release-binding-invalid')
  if (lease.actorType === 'ai-hook' && lease.authorityClass !== 'scoped') errors.push('lease-ai-scoped-only')
  if (lease.authorityClass === 'release' && lease.actorType !== 'release-pipeline') errors.push('lease-release-actor-invalid')
  if (lease.actorType === 'ai-hook' && (!lease.taskRecoveryKey || !lease.contextEpoch || !lease.sourceMessageDigest)) {
    errors.push('lease-ai-task-evidence-required')
  }
  if (['trusted-ci', 'release-pipeline'].includes(lease.actorType) && !lease.policyDigest) {
    errors.push('lease-policy-evidence-required')
  }
  const mirroredFields = [
    'runId', 'runIdentityDigest', 'actorType', 'actorIdentityDigest', 'authorityClass', 'project',
    'taskRecoveryKey', 'contextEpoch', 'candidateId', 'candidateHead', 'candidateDigest',
    'dirtyScopeDigest', 'changedScopeDigest', 'planDigest', 'budgetDigest', 'requestDigest', 'purpose'
  ]
  for (const field of mirroredFields) {
    const expected = lease.runIdentity?.[field] == null ? null : lease.runIdentity[field]
    const observed = lease[field] == null ? null : lease[field]
    if (expected !== observed) errors.push(`lease-run-identity-mismatch:${field}`)
  }
  if (Object.hasOwn(LEVEL_RANK, lease.maxLevel) && Object.hasOwn(LEVEL_RANK, lease.runIdentity?.maxLevel) &&
      LEVEL_RANK[lease.maxLevel] > LEVEL_RANK[lease.runIdentity.maxLevel]) errors.push('lease-run-level-widened')
  if (lease.revocationEpoch < Number(lease.runIdentity?.revocationEpoch || 0)) errors.push('lease-revocation-epoch-regressed')
  if (errors.length === 0 && digest(withoutDigest(lease)) !== lease.authorityDigest) errors.push('lease-digest-mismatch')

  let status = lease.status
  if (errors.length === 0 && lease.status === 'active' && hardDeadlineAtMs <= nowMs) status = 'expired-hard-deadline'
  else if (errors.length === 0 && lease.status === 'active' && expiresAtMs <= nowMs) status = 'expired'
  if (binding && errors.length === 0) {
    const exactFields = [
      'actorType', 'actorIdentityDigest', 'authorityClass', 'project', 'taskRecoveryKey', 'contextEpoch',
      'candidateId', 'candidateHead', 'candidateDigest', 'dirtyScopeDigest', 'changedScopeDigest',
      'planDigest', 'budgetDigest', 'requestDigest', 'purpose', 'runIdentityDigest', 'runId'
    ]
    for (const field of exactFields) {
      if (!Object.hasOwn(binding, field)) continue
      const expected = binding[field] == null ? null : binding[field]
      const observed = lease[field] == null ? null : lease[field]
      if (expected !== observed) errors.push(`lease-binding-mismatch:${field}`)
    }
    if (binding.projectRootIdentity && stableStringify(binding.projectRootIdentity) !== stableStringify(lease.projectRootIdentity)) {
      errors.push('lease-binding-mismatch:projectRootIdentity')
    }
    if (Object.hasOwn(LEVEL_RANK, binding.level) && Object.hasOwn(LEVEL_RANK, lease.maxLevel) &&
        LEVEL_RANK[binding.level] > LEVEL_RANK[lease.maxLevel]) errors.push('lease-level-exceeded')
    if (Number.isInteger(binding.revocationEpoch) && binding.revocationEpoch !== lease.revocationEpoch) {
      errors.push('lease-revocation-epoch-mismatch')
    }
  }
  if (status !== 'active') errors.push(`lease-not-active:${status}`)
  return { valid: errors.length === 0, errors: [...new Set(errors)], status }
}

function createVerificationExecutionLease(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const runIdentity = input.runIdentity || createValidationRunIdentity(input)
  const runValidation = validateValidationRunIdentity(runIdentity)
  if (!runValidation.valid) {
    throw new ValidationAuthorityError('VALIDATION_RUN_IDENTITY_INVALID', 'validation run identity is invalid', runValidation)
  }
  const issuedAt = input.issuedAt || new Date(nowMs).toISOString()
  const issuedAtMs = Date.parse(issuedAt)
  const hardDeadlineAt = input.hardDeadlineAt ||
    new Date(issuedAtMs + runIdentity.hardTimeoutUpperBoundMs).toISOString()
  const leaseWindowMs = deriveLeaseWindowMs(runIdentity, input.leaseWindowMs || options.leaseWindowMs)
  const expiresAt = input.expiresAt || new Date(Math.min(
    Date.parse(hardDeadlineAt),
    issuedAtMs + leaseWindowMs
  )).toISOString()
  const semantic = {
    schemaVersion: LEASE_SCHEMA,
    runIdentity,
    runId: runIdentity.runId,
    runIdentityDigest: runIdentity.runIdentityDigest,
    actorType: runIdentity.actorType,
    actorIdentityDigest: runIdentity.actorIdentityDigest,
    actorIdentityEvidence: input.actorIdentityEvidence && typeof input.actorIdentityEvidence === 'object'
      ? input.actorIdentityEvidence
      : null,
    authorityClass: runIdentity.authorityClass,
    project: runIdentity.project,
    projectRootIdentity: runIdentity.projectRootIdentity,
    taskRecoveryKey: runIdentity.taskRecoveryKey,
    contextEpoch: runIdentity.contextEpoch,
    candidateId: runIdentity.candidateId,
    candidateHead: runIdentity.candidateHead,
    candidateDigest: runIdentity.candidateDigest,
    dirtyScopeDigest: runIdentity.dirtyScopeDigest,
    changedScopeDigest: runIdentity.changedScopeDigest,
    planDigest: runIdentity.planDigest,
    budgetDigest: runIdentity.budgetDigest,
    requestDigest: runIdentity.requestDigest,
    maxLevel: runIdentity.maxLevel,
    purpose: runIdentity.purpose,
    authoritySourceRef: String(input.authoritySourceRef || ''),
    sourceMessageDigest: input.sourceMessageDigest == null ? null : String(input.sourceMessageDigest),
    policyDigest: input.policyDigest == null ? null : String(input.policyDigest),
    issuedAt,
    expiresAt,
    hardDeadlineAt,
    leaseWindowMs,
    lastRenewedAt: null,
    leaseGeneration: 0,
    renewalCount: 0,
    revocationEpoch: runIdentity.revocationEpoch,
    singleUse: true,
    status: String(input.status || 'active')
  }
  const lease = Object.freeze({ ...semantic, authorityDigest: digest(semantic) })
  const validation = validateVerificationExecutionLease(lease, null, { nowMs })
  if (!validation.valid) {
    throw new ValidationAuthorityError('VALIDATION_LEASE_INVALID', 'verification execution lease is invalid', validation)
  }
  return lease
}

function leaseBindingFromPlan({ plan, candidate, project, repoRoot, taskRecoveryKey = null, contextEpoch = null,
  revocationEpoch = 0, actorType = null, actorIdentityDigest = null, lease = null }) {
  const candidateEvidence = candidateBinding(candidate)
  const binding = {
    project,
    projectRootIdentity: projectRootIdentity(repoRoot),
    taskRecoveryKey,
    contextEpoch,
    candidateId: candidate.candidateId,
    candidateHead: candidate.head || null,
    candidateDigest: candidateEvidence.candidateDigest,
    dirtyScopeDigest: candidateEvidence.dirtyScopeDigest,
    changedScopeDigest: plan.changedScopeDigest,
    planDigest: plan.planDigest,
    budgetDigest: plan.budgetCard.digest,
    requestDigest: plan.requestDigest,
    level: plan.verificationLevel,
    purpose: plan.verificationPurpose,
    authorityClass: plan.verificationPurpose === 'release'
      ? 'release'
      : (plan.verificationLevel === 'V3' ? 'full-audit' : 'scoped'),
    revocationEpoch
  }
  if (actorType !== null) binding.actorType = actorType
  if (actorIdentityDigest !== null) binding.actorIdentityDigest = actorIdentityDigest
  if (lease?.runIdentityDigest) {
    binding.runIdentityDigest = lease.runIdentityDigest
    binding.runId = lease.runId
  }
  return binding
}

function assertVerificationExecutionLease(lease, binding, options = {}) {
  const validation = validateVerificationExecutionLease(lease, binding, options)
  if (!validation.valid) {
    throw new ValidationAuthorityError(
      String(validation.status).startsWith('expired') ? 'VALIDATION_LEASE_EXPIRED' : 'VALIDATION_AUTHORITY_REQUIRED',
      'current execution authority does not match the exact validation candidate, plan and budget',
      validation
    )
  }
  return validation
}

function renewVerificationExecutionLease(lease, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const current = validateVerificationExecutionLease(lease, null, { nowMs })
  if (!current.valid) {
    throw new ValidationAuthorityError('VALIDATION_LEASE_RENEWAL_DENIED', 'only a current active lease can be renewed', current)
  }
  const requestedMaxLevel = options.maxLevel == null ? lease.maxLevel : String(options.maxLevel)
  if (!Object.hasOwn(LEVEL_RANK, requestedMaxLevel) ||
      LEVEL_RANK[requestedMaxLevel] > LEVEL_RANK[lease.maxLevel]) {
    throw new ValidationAuthorityError('VALIDATION_LEASE_SCOPE_WIDENING_DENIED', 'lease renewal may preserve or reduce scope, never widen it')
  }
  if (lease.authorityClass !== 'scoped' && requestedMaxLevel !== lease.maxLevel) {
    throw new ValidationAuthorityError('VALIDATION_LEASE_SCOPE_REDUCTION_INVALID', 'V3 authority cannot be rewritten as a lower-class lease')
  }
  const hardDeadlineMs = Date.parse(lease.hardDeadlineAt)
  const requestedWindowMs = Number.isInteger(options.leaseWindowMs) && options.leaseWindowMs > 0
    ? Math.min(options.leaseWindowMs, lease.leaseWindowMs)
    : lease.leaseWindowMs
  const nextExpiryMs = Math.min(
    hardDeadlineMs,
    Math.max(Date.parse(lease.expiresAt), nowMs + requestedWindowMs)
  )
  const next = {
    ...withoutDigest(lease),
    maxLevel: requestedMaxLevel,
    expiresAt: new Date(nextExpiryMs).toISOString(),
    lastRenewedAt: new Date(nowMs).toISOString(),
    leaseWindowMs: requestedWindowMs,
    leaseGeneration: lease.leaseGeneration + 1,
    renewalCount: lease.renewalCount + 1
  }
  const renewed = Object.freeze({ ...next, authorityDigest: digest(next) })
  const validation = validateVerificationExecutionLease(renewed, null, { nowMs })
  if (!validation.valid) {
    throw new ValidationAuthorityError('VALIDATION_LEASE_RENEWAL_INVALID', 'renewed verification lease is invalid', validation)
  }
  return renewed
}

function transitionLease(lease, status, options = {}) {
  if (!['consumed', 'revoked', 'expired'].includes(status)) {
    throw new ValidationAuthorityError('VALIDATION_LEASE_TRANSITION_INVALID', 'lease terminal transition is invalid')
  }
  const next = {
    ...withoutDigest(lease),
    status,
    ...(status === 'revoked' ? { revocationEpoch: lease.revocationEpoch + 1 } : {})
  }
  return Object.freeze({ ...next, authorityDigest: digest(next) })
}

module.exports = {
  ACTOR_TYPES,
  AUTHORITY_CLASSES,
  BUDGET_CONFIRMATION_SCHEMA,
  CONTINUATION_AUTHORIZATION_SCHEMA,
  LEGACY_LEASE_SCHEMA,
  LEASE_SCHEMA,
  MAX_AUTHORITY_RECORD_BYTES,
  MAX_CONTINUATION_RETRIES,
  PENDING_BUDGET_SCHEMA,
  PENDING_BUDGET_TTL_MS,
  RUN_IDENTITY_SCHEMA,
  ValidationAuthorityError,
  approvePlanFromBudgetAuthority,
  assertVerificationExecutionLease,
  candidateBinding,
  createBudgetConfirmationReceipt,
  createPendingBudgetCardBinding,
  createValidationRunIdentity,
  createValidationContinuationAuthorization,
  createVerificationExecutionLease,
  deriveLeaseWindowMs,
  hostSessionIdentity,
  leaseBindingFromPlan,
  planBudgetProjection,
  projectRootIdentity,
  renewVerificationExecutionLease,
  transitionValidationContinuation,
  transitionLease,
  validateBudgetConfirmationReceipt,
  validatePendingBudgetCardBinding,
  validateValidationBudgetProjection,
  validateValidationContinuationAuthorization,
  validateValidationRunIdentity,
  validateVerificationExecutionLease
}
