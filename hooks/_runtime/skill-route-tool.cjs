'use strict'

const fs = require('fs')
const path = require('path')

const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath
} = require('./workspace-layout.cjs')
const {
  readDevcodexMdEntry
} = require('./devcodex-md-entry.cjs')
const {
  isWorkspaceSkillsEnabled,
  renderSourceSkillContent,
  resolveWorkspaceSkillsRoot
} = require('./skill-resolution.cjs')
const {
  buildRuntimeSkillIdentityIndex
} = require('./runtime-skill-identity-index.cjs')
const {
  resolveCatalogPageIndex,
  encodeCursor,
  decodeCursor
} = require('./model-skill-catalog.cjs')
const {
  resolveWorkflowRoots
} = require('./workflow-root-registry.cjs')
const {
  BODY_PAGE_LIMIT_BYTES,
  buildProgressiveSkillPlan,
  stageRank
} = require('./progressive-skill-plan.cjs')
const {
  getCapabilityDocumentDigest,
  getRuntimeContractDigest,
  resolveSkillRouteMode
} = require('./skill-route-mode.cjs')
const {
  applyBodyCharges,
  projectPlanReservation,
  projectPendingStages
} = require('./skill-route-budget.cjs')
const { replayMcpContextSourceObservations } = require('./context-source-observation.cjs')
const {
  bootstrapSkillRoute,
  collectExpiredTurns,
  deriveTurnBinding,
  loadEnvelope,
  TURN_BINDING_RE,
  transactEnvelope
} = require('./skill-route-state.cjs')
const {
  DIGEST_RE,
  SKILL_ID_RE,
  byteLength,
  makeToolError,
  portable,
  sha256
} = require('./progressive-skill-route-contract.cjs')

const ACCEPTED_CONTEXT_RECEIPT_STATUSES = new Set([
  'relevant-complete',
  'escalated-full',
  'completed',
  'baseline-ready'
])
const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const CONDITION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const STAGE_ID_RE = /^(entry|closeout|execution:[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/
const CONTEXT_BINDING_FIELDS = new Set([
  'schemaVersion',
  'contextEpoch',
  'planId',
  'planContentId',
  'activeRoot',
  'project'
])
const SKILL_ROUTE_FIELDS_BY_OP = Object.freeze({
  catalog: ['op', 'project', 'turnBinding', 'contextEpoch', 'cursor'],
  commit: [
    'op', 'project', 'turnBinding', 'contextEpoch', 'catalogDigest', 'skillId',
    'contextBinding', 'previousPlanDigest', 'lateConditionId'
  ],
  rebind: [
    'op', 'project', 'turnBinding', 'contextEpoch', 'generation', 'planDigest',
    'contextBinding'
  ],
  load_stage: [
    'op', 'project', 'turnBinding', 'contextEpoch', 'generation', 'planDigest',
    'stageId', 'cursor', 'triggerRef'
  ],
  status: ['op', 'project', 'turnBinding', 'contextEpoch']
})
const SKILL_ROUTE_CONTEXT_BINDING_OPS = new Set(['commit', 'rebind'])

function isBoundedText (value, maxLength) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

function resolveProjectTarget (inputRoot, project) {
  const cwd = path.resolve(inputRoot || process.cwd())
  const layout = findLayoutInfo(cwd)
  const name = String(project || inferProjectFromCwd(cwd, layout) || '').trim()
  if (!PROJECT_RE.test(name)) {
    const error = new Error(name ? 'PROJECT_BINDING_INVALID' : 'PROJECT_BINDING_REQUIRED')
    error.code = name ? 'PROJECT_BINDING_INVALID' : 'PROJECT_BINDING_REQUIRED'
    throw error
  }
  if (layout.enabled) {
    return {
      project: name,
      workspaceRoot: layout.workspaceRoot,
      projectRoot: path.join(layout.workspaceRoot, name),
      activeRoot: namespaceRootPath(layout.workspaceRoot, name),
      layout
    }
  }
  const projectRoot = cwd
  return {
    project: name,
    workspaceRoot: layout.workspaceRoot,
    projectRoot,
    activeRoot: path.join(projectRoot, '.devcodex'),
    layout
  }
}

function lifecycleStatePath (target) {
  if (target.layout.enabled) {
    return path.join(
      target.activeRoot,
      '.memory',
      'hooks',
      target.project,
      'lifecycle-state.json'
    )
  }
  return path.join(
    target.activeRoot,
    '.memory',
    'hooks',
    '__workspace__',
    'lifecycle-state.json'
  )
}

function readJson (file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeJsonAtomic (file, value, fsImpl = fs) {
  const dir = path.dirname(file)
  fsImpl.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
  fsImpl.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fsImpl.renameSync(tmp, file)
}

/**
 * When MCP plan observation advanced but Hook PostToolUse never installed the
 * plan into lifecycle-state, skill_route would see MISMATCH/stale against the
 * caller's contextBinding. Rebind from the exact observation when identities match.
 */
function tryRebindLifecycleFromPlanObservation (binding, target, lifecycle, options = {}) {
  const fsImpl = options.fs || fs
  const acquisition = lifecycle?.contextAcquisition
  if (!acquisition || typeof acquisition !== 'object') return { rebound: false, lifecycle }

  const plan = acquisition.plan
  const receipt = acquisition.receipt
  const identityMatches = !!(
    plan &&
    receipt &&
    binding.contextEpoch === acquisition.contextEpoch &&
    binding.contextEpoch === plan.identity?.contextEpoch &&
    binding.planId === plan.planId &&
    binding.planContentId === plan.planContentId &&
    path.resolve(binding.activeRoot) === path.resolve(target.activeRoot) &&
    binding.project === target.project &&
    receipt.contextEpoch === binding.contextEpoch &&
    receipt.planId === binding.planId &&
    receipt.planContentId === binding.planContentId
  )
  if (identityMatches) {
    if (['stale', 'blocked'].includes(receipt.status) || ACCEPTED_CONTEXT_RECEIPT_STATUSES.has(receipt.status)) {
      return { rebound: false, lifecycle }
    }
  }

  let readContextPlanObservation
  let createContextReadReceipt
  let validateContextReadPlan
  try {
    ;({ readContextPlanObservation } = require('./context-plan-observation.cjs'))
    ;({ createContextReadReceipt, validateContextReadPlan } = require('./context-read-contract.cjs'))
  } catch {
    return { rebound: false, lifecycle }
  }

  const observed = readContextPlanObservation({
    activeRoot: target.activeRoot,
    project: target.project,
    contextEpoch: binding.contextEpoch
  })
  if (observed.status !== 'fresh' || !observed.plan) return { rebound: false, lifecycle }
  if (observed.plan.planId !== binding.planId || observed.plan.planContentId !== binding.planContentId) {
    return { rebound: false, lifecycle }
  }
  const validation = validateContextReadPlan(observed.plan)
  if (!validation.valid) return { rebound: false, lifecycle }

  const priorReceipt = acquisition.receipt
  const nextReceipt = createContextReadReceipt(observed.plan, {
    verificationMode: 'structured-plan',
    planObserved: true,
    hostSessionId: acquisition.hostSessionId
  })
  if (priorReceipt && Number.isFinite(Number(priorReceipt.replanCount))) {
    nextReceipt.replanCount = Number(priorReceipt.replanCount)
  }

  acquisition.plan = observed.plan
  acquisition.receipt = nextReceipt
  acquisition.contextEpoch = binding.contextEpoch
  acquisition.activeRoot = path.resolve(target.activeRoot).replace(/\\/g, '/')
  acquisition.project = target.project
  acquisition.targetResolved = true
  acquisition.fallbackActive = false
  acquisition.lastError = null
  acquisition.verificationMode = 'structured-plan'

  lifecycle.contextAcquisition = acquisition
  lifecycle.updatedAt = new Date(options.nowMs || Date.now()).toISOString()
  const statePath = lifecycleStatePath(target)
  try {
    writeJsonAtomic(statePath, lifecycle, fsImpl)
  } catch {
    // Still use in-memory rebinding for this call even if persist fails.
  }
  return { rebound: true, lifecycle }
}

function uniqueSorted (items = []) {
  return [...new Set(items.filter(item => typeof item === 'string' && item.length > 0))].sort()
}

function buildMissingMandatorySourceIds (plan, receipt) {
  const explicitMissing = Array.isArray(receipt?.missingSourceIds)
    ? receipt.missingSourceIds
    : []
  const mandatory = Array.isArray(plan?.mandatorySourceIds)
    ? plan.mandatorySourceIds
    : []
  const satisfied = new Set(Array.isArray(receipt?.satisfiedSourceIds)
    ? receipt.satisfiedSourceIds
    : [])
  return uniqueSorted([
    ...explicitMissing,
    ...mandatory.filter(sourceId => !satisfied.has(sourceId))
  ])
}

function buildContextRecoveryDetails (reasonCode, input = {}) {
  const binding = input.binding || {}
  const target = input.target || {}
  const acquisition = input.acquisition || {}
  const plan = input.plan || acquisition.plan || null
  const receipt = input.receipt || acquisition.receipt || null
  const missingSourceIds = buildMissingMandatorySourceIds(plan, receipt)
  return {
    schemaVersion: 'SkillRouteContextRecoveryV1',
    status: 'refresh-context-required',
    reasonCode,
    project: target.project || binding.project || acquisition.project || null,
    activeRoot: portable(target.activeRoot || binding.activeRoot || acquisition.activeRoot || ''),
    contextEpoch: binding.contextEpoch || acquisition.contextEpoch || plan?.identity?.contextEpoch || null,
    binding: binding && typeof binding === 'object'
      ? {
          planId: binding.planId || null,
          planContentId: binding.planContentId || null,
          project: binding.project || null,
          activeRoot: portable(binding.activeRoot || '')
        }
      : null,
    observed: {
      planId: plan?.planId || null,
      planContentId: plan?.planContentId || null,
      receiptStatus: receipt?.status || null,
      missingSourceIds,
      satisfiedSourceIds: uniqueSorted(receipt?.satisfiedSourceIds || []),
      mandatorySourceIds: uniqueSorted(plan?.mandatorySourceIds || []),
      lastError: acquisition.lastError || null
    },
    nextOperation: {
      refreshContext: [
        'profile_context_plan',
        'memory_status',
        'profile_load'
      ],
      retry: 'retry the same skill_route operation after fresh ContextRead observation; use rebind for an existing committed plan'
    },
    hint: 'Refresh ContextRead with the same project/contextEpoch, observe all mandatory sources, then retry commit or call skill_route rebind before loading pending stages.'
  }
}

function contextBindingErrorForSkillRoute (code, reasonCode, recoveryInput = {}) {
  const error = new Error(code)
  error.code = code
  error.details = buildContextRecoveryDetails(reasonCode, recoveryInput)
  return error
}

function validateTrustedContextBinding (binding, target, options = {}) {
  if (options.trustedContext) return options.trustedContext
  if (!binding ||
      typeof binding !== 'object' ||
      Array.isArray(binding) ||
      Object.keys(binding).some(key => !CONTEXT_BINDING_FIELDS.has(key)) ||
      binding.schemaVersion !== 'ContextReadBindingV1' ||
      !isBoundedText(binding.contextEpoch, 256) ||
      !isBoundedText(binding.planId, 256) ||
      !isBoundedText(binding.planContentId, 256) ||
      !isBoundedText(binding.activeRoot, 4096) ||
      !PROJECT_RE.test(String(binding.project || '')) ||
      String(binding.project).length > 255) {
    throw contextBindingErrorForSkillRoute(
      'CONTEXT_BINDING_INVALID',
      'binding-schema-invalid',
      { binding, target }
    )
  }
  const statePath = lifecycleStatePath(target)
  let lifecycle = readJson(statePath, options.fs || fs)
  if (!lifecycle || typeof lifecycle !== 'object') lifecycle = {}
  if (!lifecycle.contextAcquisition || typeof lifecycle.contextAcquisition !== 'object') {
    lifecycle.contextAcquisition = {}
  }

  const rebound = tryRebindLifecycleFromPlanObservation(binding, target, lifecycle, options)
  lifecycle = rebound.lifecycle
  const acquisition = lifecycle?.contextAcquisition
  const plan = acquisition?.plan
  let receipt = acquisition?.receipt
  if (plan && receipt) {
    const replayed = replayMcpContextSourceObservations(receipt, plan, {
      activeRoot: target.activeRoot,
      project: target.project,
      contextBinding: binding,
      hostSessionId: acquisition.hostSessionId
    }, options)
    if (replayed.status === 'replayed') {
      receipt = replayed.receipt
      acquisition.receipt = receipt
      lifecycle.contextAcquisition = acquisition
      lifecycle.updatedAt = new Date(options.nowMs || Date.now()).toISOString()
      try {
        writeJsonAtomic(statePath, lifecycle, options.fs || fs)
      } catch {
        // The durable source ledger remains authoritative recovery evidence.
      }
    }
  }
  if (!plan || !receipt) {
    throw contextBindingErrorForSkillRoute(
      'CONTEXT_BINDING_PENDING',
      'observed-plan-or-receipt-missing',
      { binding, target, acquisition, plan, receipt }
    )
  }
  const identityMatches =
    binding.contextEpoch === acquisition.contextEpoch &&
    binding.contextEpoch === plan.identity?.contextEpoch &&
    binding.planId === plan.planId &&
    binding.planContentId === plan.planContentId &&
    path.resolve(binding.activeRoot) === path.resolve(target.activeRoot) &&
    binding.project === target.project &&
    receipt.contextEpoch === binding.contextEpoch &&
    receipt.planId === binding.planId &&
    receipt.planContentId === binding.planContentId
  if (!identityMatches) {
    throw contextBindingErrorForSkillRoute(
      'CONTEXT_BINDING_MISMATCH',
      'binding-identity-mismatch',
      { binding, target, acquisition, plan, receipt }
    )
  }
  if (!ACCEPTED_CONTEXT_RECEIPT_STATUSES.has(receipt.status)) {
    throw contextBindingErrorForSkillRoute(
      'CONTEXT_BINDING_PENDING',
      `receipt-status-${String(receipt.status || 'missing')}`,
      { binding, target, acquisition, plan, receipt }
    )
  }
  if (Array.isArray(receipt.missingSourceIds) && receipt.missingSourceIds.length > 0) {
    throw contextBindingErrorForSkillRoute(
      'CONTEXT_BINDING_PENDING',
      'receipt-missing-source-ids',
      { binding, target, acquisition, plan, receipt }
    )
  }
  if (Array.isArray(plan.mandatorySourceIds) && plan.mandatorySourceIds.length > 0) {
    const satisfiedSourceIds = Array.isArray(receipt.satisfiedSourceIds)
      ? new Set(receipt.satisfiedSourceIds)
      : new Set()
    if (plan.mandatorySourceIds.some(sourceId => !satisfiedSourceIds.has(sourceId))) {
      throw contextBindingErrorForSkillRoute(
        'CONTEXT_BINDING_PENDING',
        'mandatory-source-unsatisfied',
        { binding, target, acquisition, plan, receipt }
      )
    }
  }
  if (receipt.status === 'baseline-ready' &&
      (plan.selectedSources?.length || plan.mandatorySourceIds?.length)) {
    throw contextBindingErrorForSkillRoute(
      'CONTEXT_BINDING_PENDING',
      'baseline-ready-with-selected-sources',
      { binding, target, acquisition, plan, receipt }
    )
  }
  const value = {
    schemaVersion: 'TrustedContextBindingV1',
    contextEpoch: binding.contextEpoch,
    planId: binding.planId,
    planContentId: binding.planContentId,
    activeRoot: portable(target.activeRoot),
    project: target.project,
    finalIntent: plan.identity?.finalIntent,
    changeTypes: plan.changeTypes || [],
    receiptId: receipt.receiptId,
    receiptStatus: receipt.status,
    hostSessionId: String(acquisition.hostSessionId || ''),
    statePath: portable(statePath),
    reboundFromObservation: rebound.rebound === true
  }
  value.bindingDigest = sha256(value)
  return value
}

function validateRequestShape (input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'REQUEST_INVALID'
  const op = input.op
  if (!Object.prototype.hasOwnProperty.call(SKILL_ROUTE_FIELDS_BY_OP, op)) return 'OP_INVALID'
  if (Object.keys(input).some(key => !SKILL_ROUTE_FIELDS_BY_OP[op].includes(key))) return 'REQUEST_FIELD_UNSUPPORTED'
  if (!input.project || !input.turnBinding) return 'REQUEST_BINDING_REQUIRED'
  if (!PROJECT_RE.test(String(input.project)) || String(input.project).length > 255) {
    return 'PROJECT_BINDING_INVALID'
  }
  if (!TURN_BINDING_RE.test(String(input.turnBinding))) return 'TURN_BINDING_INVALID'
  if (op !== 'status' && !input.contextEpoch) return 'CONTEXT_EPOCH_REQUIRED'
  if (input.contextEpoch !== undefined &&
      !isBoundedText(input.contextEpoch, 256)) return 'CONTEXT_EPOCH_INVALID'
  if (input.cursor !== undefined &&
      !isBoundedText(input.cursor, 2048)) {
    return 'CURSOR_INVALID'
  }
  if (op === 'commit') {
    if (!Object.prototype.hasOwnProperty.call(input, 'skillId')) return 'SKILL_CHOICE_REQUIRED'
    if (!DIGEST_RE.test(String(input.catalogDigest || ''))) return 'CATALOG_DIGEST_INVALID'
    if (input.skillId !== null &&
        (!SKILL_ID_RE.test(String(input.skillId || '')) ||
          String(input.skillId).length > 128)) return 'SKILL_CHOICE_INVALID'
    if (!input.contextBinding || typeof input.contextBinding !== 'object') {
      return 'CONTEXT_BINDING_REQUIRED'
    }
    if (input.previousPlanDigest !== undefined &&
        !DIGEST_RE.test(String(input.previousPlanDigest))) {
      return 'PREVIOUS_PLAN_BINDING_INVALID'
    }
    if (input.lateConditionId !== undefined &&
        !CONDITION_ID_RE.test(String(input.lateConditionId))) {
      return 'LATE_CONDITION_INVALID'
    }
  }
  if (op === 'load_stage') {
    if (!Number.isInteger(input.generation) || input.generation < 0) return 'GENERATION_INVALID'
    if (!DIGEST_RE.test(String(input.planDigest || '')) ||
        !STAGE_ID_RE.test(String(input.stageId || ''))) return 'PLAN_BINDING_INVALID'
    if (input.triggerRef !== undefined &&
        !isBoundedText(input.triggerRef, 512)) return 'TRIGGER_REF_INVALID'
  }
  if (op === 'rebind') {
    if (!Number.isInteger(input.generation) || input.generation < 0) return 'GENERATION_INVALID'
    if (!DIGEST_RE.test(String(input.planDigest || ''))) return 'PLAN_BINDING_INVALID'
    if (!input.contextBinding || typeof input.contextBinding !== 'object') {
      return 'CONTEXT_BINDING_REQUIRED'
    }
  }
  return null
}

function buildRequestShapeDetails (input, errorCode) {
  const op = Object.prototype.hasOwnProperty.call(SKILL_ROUTE_FIELDS_BY_OP, input?.op)
    ? input.op
    : 'unknown'
  const allowedFields = SKILL_ROUTE_FIELDS_BY_OP[op] || ['op', 'project', 'turnBinding']
  const unsupportedFields = input && typeof input === 'object' && !Array.isArray(input)
    ? Object.keys(input).filter(key => !allowedFields.includes(key)).sort()
    : []
  const contextBindingHint = SKILL_ROUTE_CONTEXT_BINDING_OPS.has(op)
    ? '`contextBinding` is required for this operation.'
    : '`contextBinding` is only accepted by commit and rebind; never send it to catalog, load_stage, or status.'
  return {
    schemaVersion: 'SkillRouteRequestShapeErrorV1',
    errorCode,
    op,
    unsupportedFields,
    allowedFields,
    contextBindingOps: [...SKILL_ROUTE_CONTEXT_BINDING_OPS].sort(),
    hint: errorCode === 'REQUEST_FIELD_UNSUPPORTED'
      ? `Remove unsupported fields for skill_route ${op}. ${contextBindingHint}`
      : `Retry skill_route ${op} with the published operation schema. ${contextBindingHint}`
  }
}

function requestShapeNextStep (input, errorCode) {
  const details = buildRequestShapeDetails(input, errorCode)
  if (errorCode === 'REQUEST_FIELD_UNSUPPORTED') {
    return `${details.hint} Allowed fields: ${details.allowedFields.join(', ')}.`
  }
  return details.hint
}

function cloneJsonObject (value) {
  if (!value || typeof value !== 'object') return null
  return JSON.parse(JSON.stringify(value))
}

function buildSkillRouteErrorDetails (input, error, target) {
  const details = cloneJsonObject(error?.details)
  if (!details) return null
  details.request = {
    op: input?.op || null,
    project: input?.project || target?.project || null,
    turnBinding: input?.turnBinding || null,
    contextEpoch: input?.contextEpoch || null,
    generation: Number.isInteger(input?.generation) ? input.generation : null,
    planDigest: input?.planDigest || null,
    stageId: input?.stageId || null
  }
  if (details.schemaVersion === 'SkillRouteContextRecoveryV1') {
    if (input?.op === 'load_stage' || input?.op === 'rebind') {
      details.nextOperation.rebind = {
        op: 'rebind',
        project: input.project,
        turnBinding: input.turnBinding,
        contextEpoch: input.contextEpoch,
        generation: input.generation,
        planDigest: input.planDigest,
        contextBinding: '<fresh ContextReadBindingV1 from refreshed ContextRead>'
      }
      details.nextOperation.loadStageAfterRebind = input?.stageId
        ? {
            op: 'load_stage',
            project: input.project,
            turnBinding: input.turnBinding,
            contextEpoch: input.contextEpoch,
            stageId: input.stageId,
            generation: '<generation from rebind receipt>',
            planDigest: '<planDigest from rebind receipt>'
          }
        : null
    } else if (input?.op === 'commit') {
      details.nextOperation.retryCommit = {
        op: 'commit',
        project: input.project,
        turnBinding: input.turnBinding,
        contextEpoch: input.contextEpoch,
        catalogDigest: input.catalogDigest || null,
        skillId: Object.prototype.hasOwnProperty.call(input, 'skillId') ? input.skillId : null,
        contextBinding: '<fresh ContextReadBindingV1 from refreshed ContextRead>'
      }
    }
  }
  return details
}

function buildBudgetRecovery (errorCode, budgetProjection) {
  return {
    schemaVersion: 'SkillRouteBudgetRecoveryV1',
    errorCode,
    terminal: true,
    stateChanged: false,
    retrySameCall: false,
    automatic: true,
    action: 'retire-and-rebootstrap-next-user-prompt',
    rebootstrapOnNextUserPrompt: true,
    budgetProjection
  }
}

function terminalRouteRetirement (state) {
  const retirement = state?.routeRetirement
  if (!retirement || retirement.terminal !== true ||
      retirement.schemaVersion !== 'SkillRouteRetirementStateV1') {
    return null
  }
  return retirement
}

function buildRouteRetirementRecovery (retirement, stateChanged = false) {
  return {
    schemaVersion: 'SkillRouteRetirementRecoveryV1',
    reasonCode: retirement.reasonCode,
    terminal: true,
    stateChanged,
    retrySameCall: false,
    automatic: true,
    action: 'retire-and-rebootstrap-next-user-prompt',
    rebootstrapOnNextUserPrompt: true
  }
}

function buildRouteRetirementToolError (
  op,
  state,
  retirement,
  transaction,
  stateChanged = false
) {
  const recovery = buildRouteRetirementRecovery(retirement, stateChanged)
  return bindResponseToTransaction(makeToolError(
    op,
    retirement.reasonCode,
    skillRouteErrorNextStep({ code: retirement.reasonCode }),
    {
      stateChanged,
      receipt: {
        schemaVersion: 'SkillRouteRetirementReceiptV1',
        project: state.project,
        turnBinding: state.turnBinding,
        contextEpoch: state.contextEpoch,
        generation: state.plan?.generation ?? null,
        planDigest: state.plan?.planDigest || null,
        retirement
      },
      details: recovery
    }
  ), transaction, 16 * 1024)
}

function throwBudgetBlocked (errorCode, projection) {
  const error = new Error(errorCode)
  error.code = errorCode
  error.details = buildBudgetRecovery(errorCode, projection)
  throw error
}

function skillRouteErrorNextStep (error) {
  if (error?.code === 'BUDGET_BLOCKED') {
    return 'Do not retry this load_stage call. The pending mandatory bodies cannot fit in the remaining turn budget; retire this route and rebootstrap on the next user prompt.'
  }
  if (error?.code === 'BUDGET_RESERVATION_BLOCKED') {
    return 'Do not retry this commit or rebind unchanged. The candidate plan was not installed because its mandatory worst case cannot fit in the remaining turn budget.'
  }
  if (String(error?.code || '').startsWith('BODY_CHARGE_')) {
    return 'Do not continue this route. Its body charge state failed validation; retire it and rebootstrap on the next user prompt.'
  }
  if (error?.code === 'REBIND_SEMANTIC_DRIFT') {
    return 'Do not retry this rebind or continue the old plan. The refreshed ContextRead changed route semantics; retire this route and rebootstrap on the next user prompt.'
  }
  return 'Refresh the bound bootstrap/catalog/context state and retry the same logical operation.'
}

function finalizeResponse (response, limitBytes) {
  response.delivery.serializedBytes = 0
  for (let index = 0; index < 3; index += 1) {
    response.delivery.serializedBytes = byteLength(response)
  }
  if (response.delivery.serializedBytes > limitBytes) {
    const error = new Error('TOOL_RESULT_BUDGET_BLOCKED')
    error.code = 'TOOL_RESULT_BUDGET_BLOCKED'
    throw error
  }
  return response
}

function successResponse (op, receipt, bodyChunks, limitBytes) {
  return finalizeResponse({
    schemaVersion: 'SkillRouteToolResultV1',
    ok: true,
    op,
    idempotencyKey: '',
    receipt,
    bodyChunks: bodyChunks || [],
    delivery: {
      channel: 'mcp-tool-result',
      serializedBytes: 0,
      limitBytes,
      runtimeServed: true,
      modelObserved: 'unverified'
    }
  }, limitBytes)
}

function bindResponseToTransaction (response, transaction, limitBytes) {
  response.idempotencyKey = transaction.idempotencyKey
  return finalizeResponse(response, limitBytes)
}

function assertRuntimeBinding (state, options = {}) {
  const { getBootRuntimeContractDigest } = require('./skill-route-mode.cjs')
  const runtimeContractDigest = getBootRuntimeContractDigest(options)
  if (!state.runtimeContractDigest ||
      state.runtimeContractDigest !== runtimeContractDigest) {
    const error = new Error('RUNTIME_CONTRACT_STALE')
    error.code = 'RUNTIME_CONTRACT_STALE'
    throw error
  }
  const capabilityDigest = getCapabilityDocumentDigest(options)
  if (state.modeReceipt?.capabilityDigest &&
      state.modeReceipt.capabilityDigest !== capabilityDigest) {
    const error = new Error('MODE_CAPABILITY_STALE')
    error.code = 'MODE_CAPABILITY_STALE'
    throw error
  }
}

function assertEnvelopeBinding (state, input, target, options = {}) {
  if (state.project !== input.project ||
      state.turnBinding !== input.turnBinding ||
      path.resolve(state.activeRoot) !== path.resolve(target.activeRoot)) {
    const error = new Error('PROJECT_BINDING_MISMATCH')
    error.code = 'PROJECT_BINDING_MISMATCH'
    throw error
  }
  if (input.contextEpoch && state.contextEpoch !== input.contextEpoch) {
    const error = new Error('CONTEXT_BINDING_MISMATCH')
    error.code = 'CONTEXT_BINDING_MISMATCH'
    throw error
  }
  assertRuntimeBinding(state, options)
}

function appendLedger (state, item) {
  state.contributionLedger.items.push({
    channel: 'mcp-tool-result',
    modelObserved: 'unverified',
    observedAt: new Date().toISOString(),
    ...item
  })
}

function handleCatalog (input, target, options) {
  return transactEnvelope(
    target.activeRoot,
    input.turnBinding,
    input,
    (envelope, tx) => {
      assertEnvelopeBinding(envelope.state, input, target, options)
      const pageIndex = resolveCatalogPageIndex(
        envelope.state.catalog,
        {
          project: input.project,
          turnBinding: input.turnBinding,
          contextEpoch: input.contextEpoch
        },
        input.cursor
      )
      if (pageIndex < 0) {
        const error = new Error('CATALOG_CURSOR_INVALID')
        error.code = 'CATALOG_CURSOR_INVALID'
        throw error
      }
      const expectedPageIndex = envelope.state.servedCatalogPages.length
      const expectedCursor = expectedPageIndex === 0
        ? null
        : envelope.state.catalog.pages[expectedPageIndex - 1]?.nextCursor
      if (pageIndex !== expectedPageIndex ||
          (input.cursor || null) !== (expectedCursor || null)) {
        const error = new Error('CATALOG_CURSOR_OUT_OF_SEQUENCE')
        error.code = 'CATALOG_CURSOR_OUT_OF_SEQUENCE'
        throw error
      }
      const receipt = envelope.state.catalog.pages[pageIndex]
      if (!envelope.state.servedCatalogPages.includes(pageIndex)) {
        envelope.state.servedCatalogPages.push(pageIndex)
        envelope.state.servedCatalogPages.sort((left, right) => left - right)
      }
      const response = bindResponseToTransaction(
        successResponse('catalog', receipt, [], 8 * 1024),
        tx,
        8 * 1024
      )
      appendLedger(envelope.state, {
        op: 'catalog',
        stageId: null,
        sourceBytes: 0,
        serializedBytes: response.delivery.serializedBytes,
        bodyBytes: 0,
        runtimeServedPages: envelope.state.servedCatalogPages.length,
        expectedPages: envelope.state.catalog.pages.length,
        contextEpoch: input.contextEpoch,
        generation: 0,
        responseDigest: sha256(response),
        replayed: false,
        idempotencyKey: tx.idempotencyKey
      })
      return { envelope, response }
    },
    options
  ).response
}

function rebuildIndex (target, options) {
  return buildRuntimeSkillIdentityIndex({
    ...options,
    cwd: target.projectRoot,
    project: target.project,
    activeRoot: target.activeRoot,
    runtimeRoot: options.runtimeRoot,
    packageRoot: options.packageRoot,
    env: options.env
  })
}

function summarizePlan (plan) {
  return {
    schemaVersion: 'ProgressiveSkillPlanSummaryV1',
    generation: plan.generation,
    planDigest: plan.planDigest,
    planSemanticDigest: plan.planSemanticDigest,
    status: plan.status,
    activatedConditionIds: plan.activatedConditionIds,
    stages: plan.stages.map(stage => ({
      stageId: stage.stageId,
      ordinal: stage.ordinal,
      skillIds: stage.skillIds,
      bodyBytes: stage.bodyBytes
    })),
    availableConditions: plan.conditionalScenarios.map(item => ({
      conditionId: item.conditionId,
      stageId: item.stageId,
      status: item.status,
      bodyBytes: item.resolution.bodyBytes
    })),
    coexistenceScenarios: (plan.coexistenceScenarios || []).map(item => ({
      scenarioId: item.scenarioId,
      conditionIds: item.conditionIds,
      status: item.status,
      bodyBytes: item.resolution.bodyBytes
    })),
    selectedIds: plan.baseResolution.selected.map(item => item.skillId),
    kernelSatisfiedIds: plan.baseResolution.kernelSatisfied.map(item => item.skillId),
    deferredDependencyIds: plan.baseResolution.deferredDependencies.map(item => item.skillId),
    blockedCodes: plan.baseResolution.blocked.map(item => item.code),
    budget: plan.budget
  }
}

function obligationPriority (sources = []) {
  if (sources.includes('explicit')) return 100
  if (sources.includes('free-route')) return 80
  if (sources.includes('workspace-always-on')) return 60
  return 40
}

function buildObligationLedger (plan, stageProgress = {}) {
  const items = plan.baseResolution.selected
    .filter(item => item.mustReplyCore)
    .map(item => ({
      skillId: item.skillId,
      mustReplyCore: item.mustReplyCore,
      sources: [...new Set(item.sources || [])].sort(),
      priority: obligationPriority(item.sources)
    }))
    .sort((left, right) =>
      right.priority - left.priority ||
      left.skillId.localeCompare(right.skillId)
    )
  const requiredStageIds = plan.stages.map(stage => stage.stageId)
  const satisfiedStageIds = requiredStageIds.filter(stageId =>
    stageProgress[stageId]?.status === 'loaded'
  )
  return {
    schemaVersion: 'ObligationLedgerV1',
    items,
    selectedBusinessSkillId: items[0]?.skillId || null,
    requiredStageIds,
    satisfiedStageIds
  }
}

function handleCommit (input, target, options) {
  return transactEnvelope(
    target.activeRoot,
    input.turnBinding,
    input,
    (envelope, tx) => {
      const state = envelope.state
      const fsImpl = options.fs || fs
      assertEnvelopeBinding(state, input, target, options)
      const routeRetirement = terminalRouteRetirement(state)
      if (routeRetirement) {
        return {
          envelope,
          response: buildRouteRetirementToolError(
            'commit',
            state,
            routeRetirement,
            tx,
            false
          )
        }
      }
      const trustedContext = validateTrustedContextBinding(
        input.contextBinding,
        target,
        options
      )
      if (state.catalog.catalogDigest !== input.catalogDigest) {
        const error = new Error('CATALOG_STALE')
        error.code = 'CATALOG_STALE'
        throw error
      }
      const explicitReady = state.explicit?.status === 'ready'
      if (explicitReady && input.skillId !== null) {
        const error = new Error('FREE_WITH_EXPLICIT')
        error.code = 'FREE_WITH_EXPLICIT'
        throw error
      }
      if (!explicitReady &&
          state.servedCatalogPages.length !== state.catalog.pages.length) {
        const error = new Error('CATALOG_PAGE_INCOMPLETE')
        error.code = 'CATALOG_PAGE_INCOMPLETE'
        throw error
      }
      const currentIndex = rebuildIndex(target, options)
      if (currentIndex.indexDigest !== state.index.indexDigest) {
        const error = new Error('CATALOG_STALE')
        error.code = 'CATALOG_STALE'
        throw error
      }
      let selectedEntry = null
      if (input.skillId !== null) {
        selectedEntry = currentIndex.entries.find(entry =>
          entry.skillId === input.skillId && entry.autoSelectable
        )
        if (!selectedEntry) {
          const error = new Error('SKILL_NOT_AUTO_SELECTABLE')
          error.code = 'SKILL_NOT_AUTO_SELECTABLE'
          throw error
        }
      }

      const priorPlan = state.plan
      const isReplan = !!priorPlan
      if (isReplan) {
        if (!input.previousPlanDigest ||
            input.previousPlanDigest !== priorPlan.planDigest ||
            !input.lateConditionId) {
          const error = new Error('PREVIOUS_PLAN_BINDING_REQUIRED')
          error.code = 'PREVIOUS_PLAN_BINDING_REQUIRED'
          throw error
        }
        const priorChoice = state.decision?.skillId || null
        if (input.skillId !== priorChoice) {
          const error = new Error('LATE_REPLAN_CHOICE_CHANGED')
          error.code = 'LATE_REPLAN_CHOICE_CHANGED'
          throw error
        }
        const condition = priorPlan.conditionalScenarios.find(item =>
          item.conditionId === input.lateConditionId
        )
        if (!condition || condition.status !== 'ready') {
          const error = new Error('CONDITIONAL_UNAVAILABLE')
          error.code = 'CONDITIONAL_UNAVAILABLE'
          throw error
        }
        if (condition.activationAuthority !== 'model') {
          const error = new Error('CONDITIONAL_AUTHORITY_UNAVAILABLE')
          error.code = 'CONDITIONAL_AUTHORITY_UNAVAILABLE'
          throw error
        }
      } else if (input.previousPlanDigest || input.lateConditionId) {
        const error = new Error('PREVIOUS_PLAN_UNEXPECTED')
        error.code = 'PREVIOUS_PLAN_UNEXPECTED'
        throw error
      }
      const activatedConditionIds = [...new Set([
        ...(priorPlan?.activatedConditionIds || []),
        ...(input.lateConditionId ? [input.lateConditionId] : [])
      ])]

      const workflow = resolveWorkflowRoots(trustedContext, options)
      const decision = {
        schemaVersion: 'SkillIntentDecisionV1',
        turnBinding: input.turnBinding,
        contextEpoch: input.contextEpoch,
        catalogDigest: input.catalogDigest,
        skillId: explicitReady ? null : (selectedEntry?.skillId || null),
        cardDigest: explicitReady ? null : (selectedEntry?.cardDigest || null),
        effectiveLayer: explicitReady ? null : (selectedEntry?.effectiveLayer || null),
        source: explicitReady ? 'explicit' : (selectedEntry ? 'model-free-route' : 'none'),
        decisionDigest: ''
      }
      decision.decisionDigest = sha256({
        ...decision,
        decisionDigest: null
      })
      const workspaceEntry = readDevcodexMdEntry(target.projectRoot, {
        ...options,
        cwd: target.projectRoot
      })
      const workspaceSkillsRoot = resolveWorkspaceSkillsRoot(target.projectRoot, {
        ...options,
        cwd: target.projectRoot
      })
      const workspaceAlwaysOnDisabledIds = !isWorkspaceSkillsEnabled(options.env)
        ? (workspaceEntry.alwaysOn || []).filter(skillId => {
          const hasGlobal = currentIndex.entries.some(entry =>
            entry.skillId === skillId && entry.effectiveLayer === 'global'
          )
          return !hasGlobal && workspaceSkillsRoot &&
            fsImpl.existsSync(path.join(workspaceSkillsRoot, skillId, 'SKILL.md'))
        })
        : []
      const plan = buildProgressiveSkillPlan({
        project: input.project,
        turnBinding: input.turnBinding,
        contextEpoch: input.contextEpoch,
        generation: isReplan ? priorPlan.generation + 1 : 0,
        catalogDigest: input.catalogDigest,
        decisionDigest: decision.decisionDigest,
        contextBindingDigest: trustedContext.bindingDigest,
        workflowResolution: workflow,
        index: currentIndex,
        workspaceAlwaysOn: workspaceEntry.alwaysOn || [],
        workspaceAlwaysOnDisabledIds,
        explicitSkillId: explicitReady ? state.explicit.skillId : null,
        freeSkillId: selectedEntry?.skillId || null,
        lateConditionId: input.lateConditionId || null,
        activatedConditionIds
      })
      const replanProgressOptions = isReplan
        ? { reopenStageIds: ['closeout'] }
        : {}
      assertReplanProgressCompatible(
        priorPlan,
        plan,
        state.stageProgress,
        replanProgressOptions
      )
      const budgetReservation = plan.status === 'complete'
        ? projectPlanReservation(envelope, plan)
        : null
      if (budgetReservation && !budgetReservation.projection.executable) {
        throwBudgetBlocked('BUDGET_RESERVATION_BLOCKED', budgetReservation.projection)
      }
      state.decision = decision
      state.plan = plan
      state.stageProgress = preserveCompatibleStageProgress(
        priorPlan,
        plan,
        state.stageProgress,
        replanProgressOptions
      )
      state.contextBinding = JSON.parse(JSON.stringify(input.contextBinding))
      state.trustedContextBindingDigest = trustedContext.bindingDigest
      state.hostSessionId = trustedContext.hostSessionId || state.hostSessionId || ''
      if (budgetReservation) state.bodyChargeLedger = budgetReservation.ledger
      state.obligationLedger = buildObligationLedger(plan, state.stageProgress)
      const summary = summarizePlan(plan)
      const response = bindResponseToTransaction(plan.status === 'complete'
        ? successResponse('commit', {
          schemaVersion: 'SkillRouteCommitReceiptV1',
          decision,
           plan: summary,
           contextBindingDigest: trustedContext.bindingDigest,
           obligations: state.obligationLedger,
           budgetReservation: budgetReservation?.projection || null
        }, [], 16 * 1024)
        : makeToolError(
          'commit',
          'ROOT_PLAN_BLOCKED',
          'Resolve the reported mandatory root, conflict, or budget blockers before loading any body.',
          {
            stateChanged: true,
            receipt: {
              schemaVersion: 'SkillRouteCommitReceiptV1',
              decision,
               plan: summary,
               contextBindingDigest: trustedContext.bindingDigest,
               obligations: state.obligationLedger,
               budgetReservation: budgetReservation?.projection || null
            },
            limitBytes: 16 * 1024
          }
        ),
      tx,
      16 * 1024)
      appendLedger(state, {
        op: 'commit',
        stageId: null,
        sourceBytes: 0,
        serializedBytes: response.delivery.serializedBytes,
        bodyBytes: 0,
        runtimeServedPages: state.servedCatalogPages.length,
        expectedPages: state.catalog.pages.length,
        contextEpoch: input.contextEpoch,
        generation: plan.generation,
        responseDigest: sha256(response),
        replayed: false,
        idempotencyKey: tx.idempotencyKey
      })
      return { envelope, response }
    },
    options
  ).response
}

function rebindSemanticDigest (plan) {
  if (!plan) return null
  const {
    generation: _generation,
    contextBindingDigest: _contextBindingDigest,
    planSemanticDigest: _planSemanticDigest,
    planDigest: _planDigest,
    ...semantic
  } = plan
  return sha256(semantic)
}

function handleRebind (input, target, options) {
  return transactEnvelope(
    target.activeRoot,
    input.turnBinding,
    input,
    (envelope, tx) => {
      const state = envelope.state
      const fsImpl = options.fs || fs
      assertEnvelopeBinding(state, input, target, options)
      const existingRetirement = terminalRouteRetirement(state)
      if (existingRetirement) {
        return {
          envelope,
          response: buildRouteRetirementToolError(
            'rebind',
            state,
            existingRetirement,
            tx,
            false
          )
        }
      }
      if (!state.plan || state.plan.status !== 'complete' ||
          state.plan.planDigest !== input.planDigest ||
          state.plan.generation !== input.generation) {
        const error = new Error('PLAN_BINDING_INVALID')
        error.code = 'PLAN_BINDING_INVALID'
        throw error
      }
      const priorPlan = state.plan
      const trustedContext = validateTrustedContextBinding(
        input.contextBinding,
        target,
        options
      )
      const currentIndex = rebuildIndex(target, options)
      if (currentIndex.indexDigest !== state.index.indexDigest) {
        const error = new Error('CATALOG_STALE')
        error.code = 'CATALOG_STALE'
        throw error
      }
      const selectedEntry = state.decision?.skillId
        ? currentIndex.entries.find(entry =>
            entry.skillId === state.decision.skillId &&
            entry.autoSelectable &&
            entry.cardDigest === state.decision.cardDigest &&
            entry.effectiveLayer === state.decision.effectiveLayer
          )
        : null
      if (state.decision?.skillId && !selectedEntry) {
        const error = new Error('REBIND_DECISION_STALE')
        error.code = 'REBIND_DECISION_STALE'
        throw error
      }
      const workflow = resolveWorkflowRoots(trustedContext, options)
      const workspaceEntry = readDevcodexMdEntry(target.projectRoot, {
        ...options,
        cwd: target.projectRoot
      })
      const workspaceSkillsRoot = resolveWorkspaceSkillsRoot(target.projectRoot, {
        ...options,
        cwd: target.projectRoot
      })
      const workspaceAlwaysOnDisabledIds = !isWorkspaceSkillsEnabled(options.env)
        ? (workspaceEntry.alwaysOn || []).filter(skillId => {
          const hasGlobal = currentIndex.entries.some(entry =>
            entry.skillId === skillId && entry.effectiveLayer === 'global'
          )
          return !hasGlobal && workspaceSkillsRoot &&
            fsImpl.existsSync(path.join(workspaceSkillsRoot, skillId, 'SKILL.md'))
        })
        : []
      const plan = buildProgressiveSkillPlan({
        project: input.project,
        turnBinding: input.turnBinding,
        contextEpoch: input.contextEpoch,
        generation: priorPlan.generation + 1,
        catalogDigest: priorPlan.catalogDigest,
        decisionDigest: state.decision.decisionDigest,
        contextBindingDigest: trustedContext.bindingDigest,
        workflowResolution: workflow,
        index: currentIndex,
        workspaceAlwaysOn: workspaceEntry.alwaysOn || [],
        workspaceAlwaysOnDisabledIds,
        explicitSkillId: state.explicit?.status === 'ready'
          ? state.explicit.skillId
          : null,
        freeSkillId: selectedEntry?.skillId || null,
        lateConditionId: null,
        activatedConditionIds: priorPlan.activatedConditionIds || []
      })
      if (rebindSemanticDigest(priorPlan) !== rebindSemanticDigest(plan)) {
        const retirement = {
          schemaVersion: 'SkillRouteRetirementStateV1',
          reasonCode: 'REBIND_SEMANTIC_DRIFT',
          terminal: true,
          retrySameCall: false,
          rebootstrapOnNextUserPrompt: true,
          priorGeneration: priorPlan.generation,
          priorPlanDigest: priorPlan.planDigest,
          attemptedGeneration: plan.generation,
          attemptedPlanDigest: plan.planDigest,
          attemptedContextBindingDigest: trustedContext.bindingDigest,
          recordedAt: new Date(options.now == null ? Date.now() : options.now).toISOString()
        }
        state.routeRetirement = retirement
        const response = buildRouteRetirementToolError(
          'rebind',
          state,
          retirement,
          tx,
          true
        )
        appendLedger(state, {
          op: 'rebind',
          stageId: null,
          sourceBytes: 0,
          serializedBytes: response.delivery.serializedBytes,
          bodyBytes: 0,
          runtimeServedPages: state.servedCatalogPages.length,
          expectedPages: state.catalog.pages.length,
          contextEpoch: input.contextEpoch,
          generation: priorPlan.generation,
          responseDigest: sha256(response),
          replayed: false,
          idempotencyKey: tx.idempotencyKey,
          outcome: 'retired-semantic-drift'
        })
        return { envelope, response }
      }
      assertReplanProgressCompatible(priorPlan, plan, state.stageProgress)
      const budgetReservation = projectPlanReservation(envelope, plan)
      if (!budgetReservation.projection.executable) {
        throwBudgetBlocked('BUDGET_RESERVATION_BLOCKED', budgetReservation.projection)
      }
      state.plan = plan
      state.stageProgress = preserveCompatibleStageProgress(
        priorPlan,
        plan,
        state.stageProgress
      )
      state.contextBinding = JSON.parse(JSON.stringify(input.contextBinding))
      state.trustedContextBindingDigest = trustedContext.bindingDigest
      state.hostSessionId = trustedContext.hostSessionId || state.hostSessionId || ''
      state.bodyChargeLedger = budgetReservation.ledger
      state.obligationLedger = buildObligationLedger(plan, state.stageProgress)
      const pendingStageIds = (state.obligationLedger.requiredStageIds || []).filter(stageId =>
        state.stageProgress[stageId]?.status !== 'loaded'
      )
      const response = bindResponseToTransaction(successResponse('rebind', {
        schemaVersion: 'SkillRouteRebindReceiptV1',
        priorGeneration: priorPlan.generation,
        priorPlanDigest: priorPlan.planDigest,
        plan: summarizePlan(plan),
        contextBindingDigest: trustedContext.bindingDigest,
        obligations: state.obligationLedger,
        budgetReservation: budgetReservation.projection,
        preservedStageProgress: summarizeStageProgress(state.stageProgress),
        nextAction: {
          schemaVersion: 'SkillRouteNextActionV1',
          nextOp: pendingStageIds.length ? 'load_stage' : null,
          pendingStageIds,
          errorCode: null,
          nextCall: pendingStageIds.length
            ? buildLoadStageNextCall(state, pendingStageIds[0])
            : null,
          recovery: null
        }
      }, [], 16 * 1024), tx, 16 * 1024)
      appendLedger(state, {
        op: 'rebind',
        stageId: null,
        sourceBytes: 0,
        serializedBytes: response.delivery.serializedBytes,
        bodyBytes: 0,
        runtimeServedPages: state.servedCatalogPages.length,
        expectedPages: state.catalog.pages.length,
        contextEpoch: input.contextEpoch,
        generation: plan.generation,
        responseDigest: sha256(response),
        replayed: false,
        idempotencyKey: tx.idempotencyKey
      })
      return { envelope, response }
    },
    options
  ).response
}

function stageItems (plan, stageId) {
  return plan.baseResolution.selected.filter(item => item.loadStage === stageId)
}

function stageIdentityKeys (plan, stageId) {
  if (!plan) return []
  return stageItems(plan, stageId)
    .map(item => `${item.skillId}|${item.effectiveLayer}|${item.bodyDigest}`)
    .sort()
}

function stageCompatibilitySignature (plan, stageId) {
  const stage = plan?.stages?.find(item => item.stageId === stageId)
  if (!stage) return null
  return {
    identityKeys: stageIdentityKeys(plan, stageId),
    dependsOn: [...(stage.dependsOn || [])].sort()
  }
}

function compatibleStageDefinition (priorPlan, nextPlan, stageId) {
  const before = stageCompatibilitySignature(priorPlan, stageId)
  const after = stageCompatibilitySignature(nextPlan, stageId)
  return !!before &&
    before.identityKeys.length > 0 &&
    JSON.stringify(before) === JSON.stringify(after)
}

function validProgressPrefix (value) {
  const servedPages = Array.isArray(value?.servedPages) ? value.servedPages : []
  const loadedKeys = Array.isArray(value?.loadedKeys) ? value.loadedKeys : []
  return servedPages.length > 0 &&
    loadedKeys.length > 0 &&
    servedPages.every((pageIndex, index) =>
      Number.isInteger(pageIndex) && pageIndex === index
    )
}

function preserveCompatibleStageProgress (priorPlan, nextPlan, progress = {}, options = {}) {
  if (!priorPlan) return {}
  const reopenStageIds = new Set(options.reopenStageIds || [])
  const preserved = {}
  for (const [stageId, value] of Object.entries(progress || {})) {
    if (!['loading', 'loaded'].includes(value?.status)) continue
    if (reopenStageIds.has(stageId)) continue
    if (compatibleStageDefinition(priorPlan, nextPlan, stageId) &&
        validProgressPrefix(value)) {
      preserved[stageId] = JSON.parse(JSON.stringify(value))
    }
  }
  return preserved
}

function assertReplanProgressCompatible (priorPlan, nextPlan, progress = {}, options = {}) {
  if (!priorPlan) return
  const reopenStageIds = new Set(options.reopenStageIds || [])
  for (const [stageId, value] of Object.entries(progress || {})) {
    if (!value?.loadedKeys?.length) continue
    if (!validProgressPrefix(value)) {
      const error = new Error('LATE_REPLAN_STAGE_INCOMPLETE')
      error.code = 'LATE_REPLAN_STAGE_INCOMPLETE'
      error.stageId = stageId
      throw error
    }
    if (reopenStageIds.has(stageId)) continue
    if (!compatibleStageDefinition(priorPlan, nextPlan, stageId)) {
      const error = new Error('LATE_REPLAN_LOADED_EVICTION')
      error.code = 'LATE_REPLAN_LOADED_EVICTION'
      error.stageId = stageId
      throw error
    }
  }
}

function buildLoadStageNextCall (state, stageId) {
  const servedPageCount = state.stageProgress[stageId]?.servedPages?.length || 0
  return {
    op: 'load_stage',
    project: state.project,
    turnBinding: state.turnBinding,
    contextEpoch: state.contextEpoch,
    generation: state.plan.generation,
    planDigest: state.plan.planDigest,
    stageId,
    ...(servedPageCount > 0
      ? {
          cursor: encodeCursor({
            schemaVersion: 'StageLoadCursorV1',
            project: state.project,
            turnBinding: state.turnBinding,
            contextEpoch: state.contextEpoch,
            planDigest: state.plan.planDigest,
            stageId,
            pageIndex: servedPageCount
          })
        }
      : {})
  }
}

function summarizeStageProgress (stageProgress = {}) {
  return Object.fromEntries(
    Object.entries(stageProgress).map(([stageId, progress]) => [
      stageId,
      {
        status: progress?.status || 'pending',
        servedPageCount: progress?.servedPages?.length || 0,
        servedPagesDigest: sha256(progress?.servedPages || []),
        loadedKeyCount: progress?.loadedKeys?.length || 0,
        loadedKeysDigest: sha256(progress?.loadedKeys || [])
      }
    ])
  )
}

function buildStagePages (state, stageId, options = {}) {
  const fsImpl = options.fs || fs
  const items = stageItems(state.plan, stageId)
  if (!items.length) {
    const error = new Error('STAGE_NOT_FOUND')
    error.code = 'STAGE_NOT_FOUND'
    throw error
  }
  const chunks = items.map(item => {
    const rawContent = fsImpl.readFileSync(item.resolvedPath, 'utf8')
    const content = renderSourceSkillContent(item.resolvedPath, rawContent, fsImpl)
    const digest = sha256(content)
    if (digest !== item.bodyDigest) {
      const error = new Error('SKILL_BODY_STALE')
      error.code = 'SKILL_BODY_STALE'
      throw error
    }
    return {
      skillId: item.skillId,
      effectiveLayer: item.effectiveLayer,
      bodyDigest: item.bodyDigest,
      bytes: Buffer.byteLength(content, 'utf8'),
      content
    }
  })
  const pages = []
  let current = []
  for (const chunk of chunks) {
    const candidate = [...current, chunk]
    const draft = {
      schemaVersion: 'SkillRouteToolResultV1',
      ok: true,
      op: 'load_stage',
      idempotencyKey: 'f'.repeat(64),
      receipt: {
      schemaVersion: 'StageLoadReceiptV1',
      project: state.project,
      turnBinding: state.turnBinding,
      contextEpoch: state.contextEpoch,
      generation: state.plan.generation,
      planDigest: state.plan.planDigest,
      stageId,
      pageIndex: pages.length,
      pageCount: 99,
      pageDigest: 'f'.repeat(64),
      nextCursor: 'x'.repeat(160),
      loadedKeys: candidate.map(item =>
        `${item.skillId}|${item.effectiveLayer}|${item.bodyDigest}|${state.contextEpoch}`
      ),
      bodyBytes: candidate.reduce((sum, item) => sum + item.bytes, 0),
      stageStatus: 'loading',
      replayed: false,
      receiptDigest: 'f'.repeat(64)
      },
      bodyChunks: candidate,
      delivery: {
        channel: 'mcp-tool-result',
        serializedBytes: BODY_PAGE_LIMIT_BYTES,
        limitBytes: BODY_PAGE_LIMIT_BYTES,
        runtimeServed: true,
        modelObserved: 'unverified'
      }
    }
    const draftBytes = byteLength(draft)
    if (current.length && draftBytes > 44 * 1024) {
      const singleDraftBytes = byteLength({
        ...draft,
        receipt: {
          ...draft.receipt,
          loadedKeys: [
            `${chunk.skillId}|${chunk.effectiveLayer}|${chunk.bodyDigest}|${state.contextEpoch}`
          ],
          bodyBytes: chunk.bytes
        },
        bodyChunks: [chunk]
      })
      if (singleDraftBytes > BODY_PAGE_LIMIT_BYTES) {
        const error = new Error('SINGLE_SKILL_BODY_BUDGET')
        error.code = 'SINGLE_SKILL_BODY_BUDGET'
        throw error
      }
      pages.push(current)
      current = [chunk]
    } else if (!current.length && draftBytes > BODY_PAGE_LIMIT_BYTES) {
      const error = new Error('SINGLE_SKILL_BODY_BUDGET')
      error.code = 'SINGLE_SKILL_BODY_BUDGET'
      throw error
    } else {
      current = candidate
    }
  }
  if (current.length) pages.push(current)
  return pages
}

function resolveStagePageIndex (state, stageId, cursor, pageCount) {
  if (!cursor) return 0
  const parsed = decodeCursor(cursor)
  if (!parsed ||
      parsed.schemaVersion !== 'StageLoadCursorV1' ||
      parsed.project !== state.project ||
      parsed.turnBinding !== state.turnBinding ||
      parsed.contextEpoch !== state.contextEpoch ||
      parsed.planDigest !== state.plan.planDigest ||
      parsed.stageId !== stageId ||
      !Number.isInteger(parsed.pageIndex) ||
      parsed.pageIndex < 0 ||
      parsed.pageIndex >= pageCount) return -1
  return parsed.pageIndex
}

function validateRouteContextPrecondition (state, target, options = {}) {
  if (!state.contextBinding) {
    const error = new Error('CONTEXT_BINDING_PENDING')
    error.code = 'CONTEXT_BINDING_PENDING'
    throw error
  }
  const liveContext = validateTrustedContextBinding(
    state.contextBinding,
    target,
    options
  )
  if (liveContext.bindingDigest !== state.trustedContextBindingDigest ||
      liveContext.bindingDigest !== state.plan?.contextBindingDigest) {
    const error = new Error('CONTEXT_BINDING_STALE')
    error.code = 'CONTEXT_BINDING_STALE'
    error.details = {
      ...buildContextRecoveryDetails('route-context-binding-digest-stale', {
        binding: state.contextBinding,
        target
      }),
      observed: {
        planId: state.contextBinding?.planId || null,
        planContentId: state.contextBinding?.planContentId || null,
        receiptStatus: liveContext.receiptStatus || null,
        missingSourceIds: [],
        satisfiedSourceIds: [],
        mandatorySourceIds: [],
        lastError: null
      }
    }
    throw error
  }
  return liveContext
}

function handleLoadStage (input, target, options) {
  return transactEnvelope(
    target.activeRoot,
    input.turnBinding,
    input,
    (envelope, tx) => {
      const state = envelope.state
      assertEnvelopeBinding(state, input, target, options)
      const routeRetirement = terminalRouteRetirement(state)
      if (routeRetirement) {
        return {
          envelope,
          response: buildRouteRetirementToolError(
            'load_stage',
            state,
            routeRetirement,
            tx,
            false
          )
        }
      }
      if (state.mode !== 'unified') {
        const error = new Error('MODE_SHADOW_BODY_DISABLED')
        error.code = 'MODE_SHADOW_BODY_DISABLED'
        throw error
      }
      if (!state.plan || state.plan.status !== 'complete' ||
          state.plan.planDigest !== input.planDigest ||
          state.plan.generation !== input.generation) {
        const error = new Error('PLAN_BINDING_INVALID')
        error.code = 'PLAN_BINDING_INVALID'
        throw error
      }
      validateRouteContextPrecondition(state, target, options)
      const stageId = input.stageId
      const stage = state.plan.stages.find(item => item.stageId === stageId)
      if (!stage) {
        const error = new Error('STAGE_NOT_FOUND')
        error.code = 'STAGE_NOT_FOUND'
        throw error
      }
      const unfinishedDependencies = (stage.dependsOn || []).filter(dependency =>
        state.stageProgress[dependency]?.status !== 'loaded'
      )
      if (unfinishedDependencies.length) {
        const error = new Error('STAGE_ORDER_VIOLATION')
        error.code = 'STAGE_ORDER_VIOLATION'
        error.unfinishedDependencies = unfinishedDependencies
        throw error
      }
      const pages = buildStagePages(state, stageId, options)
      const pageIndex = resolveStagePageIndex(state, stageId, input.cursor, pages.length)
      if (pageIndex < 0) {
        const error = new Error('STAGE_CURSOR_INVALID')
        error.code = 'STAGE_CURSOR_INVALID'
        throw error
      }
      const priorProgress = state.stageProgress[stageId]
      const expectedPageIndex = priorProgress?.servedPages?.length || 0
      const expectedCursor = expectedPageIndex === 0
        ? null
        : encodeCursor({
          schemaVersion: 'StageLoadCursorV1',
          project: state.project,
          turnBinding: state.turnBinding,
          contextEpoch: state.contextEpoch,
          planDigest: state.plan.planDigest,
          stageId,
          pageIndex: expectedPageIndex
        })
      if (pageIndex !== expectedPageIndex ||
          (input.cursor || null) !== (expectedCursor || null)) {
        const error = new Error('STAGE_CURSOR_OUT_OF_SEQUENCE')
        error.code = 'STAGE_CURSOR_OUT_OF_SEQUENCE'
        throw error
      }
      const chunks = pages[pageIndex]
      const nextCursor = pageIndex + 1 < pages.length
        ? encodeCursor({
          schemaVersion: 'StageLoadCursorV1',
          project: state.project,
          turnBinding: state.turnBinding,
          contextEpoch: state.contextEpoch,
          planDigest: state.plan.planDigest,
          stageId,
          pageIndex: pageIndex + 1
        })
        : null
      const loadedKeys = chunks.map(chunk =>
        `${chunk.skillId}|${chunk.effectiveLayer}|${chunk.bodyDigest}|${state.contextEpoch}`
      )
      let chargeResult
      try {
        chargeResult = applyBodyCharges(envelope, chunks, {
          scope: 'load-stage-page',
          stageIds: [stageId],
          errorCode: 'BUDGET_BLOCKED'
        })
      } catch (error) {
        if (error.code === 'BUDGET_BLOCKED') {
          throwBudgetBlocked('BUDGET_BLOCKED', error.details?.budgetProjection || null)
        }
        throw error
      }
      const progress = state.stageProgress[stageId] || {
        status: 'loading',
        servedPages: [],
        loadedKeys: []
      }
      if (!progress.servedPages.includes(pageIndex)) progress.servedPages.push(pageIndex)
      for (const key of loadedKeys) {
        if (!progress.loadedKeys.includes(key)) progress.loadedKeys.push(key)
      }
      progress.servedPages.sort((left, right) => left - right)
      progress.status = progress.servedPages.length === pages.length ? 'loaded' : 'loading'
      state.stageProgress[stageId] = progress
      state.bodyChargeLedger = chargeResult.ledger
      state.budget = chargeResult.budget
      state.obligationLedger = buildObligationLedger(
        state.plan,
        state.stageProgress
      )
      const receipt = {
        schemaVersion: 'StageLoadReceiptV1',
        project: state.project,
        turnBinding: state.turnBinding,
        contextEpoch: state.contextEpoch,
        generation: state.plan.generation,
        planDigest: state.plan.planDigest,
        stageId,
        pageIndex,
        pageCount: pages.length,
        pageDigest: sha256({
          planDigest: state.plan.planDigest,
          stageId,
          pageIndex,
          chunks: chunks.map(chunk => ({
            skillId: chunk.skillId,
            bodyDigest: chunk.bodyDigest,
            bytes: chunk.bytes
          }))
        }),
        nextCursor,
        loadedKeys,
        bodyBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
        chargedBodyBytes: chargeResult.projection.incrementalBodyBytes,
        chargedIdentityCount: chargeResult.projection.newIdentityCount,
        budgetProjection: chargeResult.projection,
        stageStatus: progress.status,
        replayed: false,
        receiptDigest: ''
      }
      receipt.receiptDigest = sha256({ ...receipt, receiptDigest: null })
      const response = bindResponseToTransaction(
        successResponse('load_stage', receipt, chunks, BODY_PAGE_LIMIT_BYTES),
        tx,
        BODY_PAGE_LIMIT_BYTES
      )
      appendLedger(state, {
        op: 'load_stage',
        stageId,
        sourceBytes: receipt.bodyBytes,
        serializedBytes: response.delivery.serializedBytes,
        bodyBytes: chargeResult.projection.incrementalBodyBytes,
        runtimeServedPages: progress.servedPages.length,
        expectedPages: pages.length,
        contextEpoch: input.contextEpoch,
        generation: state.plan.generation,
        responseDigest: sha256(response),
        replayed: false,
        idempotencyKey: tx.idempotencyKey
      })
      return { envelope, response }
    },
    options
  ).response
}

function handleStatus (input, target, options) {
  collectExpiredTurns(target.activeRoot, {
    ...options,
    protectedTurnBindings: [
      ...(options.protectedTurnBindings || []),
      input.turnBinding
    ]
  })
  const { envelope } = loadEnvelope(target.activeRoot, input.turnBinding, options)
  const state = envelope.state
  assertEnvelopeBinding(state, input, target, options)
  const routeRetirement = terminalRouteRetirement(state)
  const retirementErrorCode = routeRetirement?.reasonCode || null
  const retirementRecovery = routeRetirement
    ? buildRouteRetirementRecovery(routeRetirement, false)
    : null
  const requiredStageIds = state.obligationLedger?.requiredStageIds || []
  const satisfiedStageIds = requiredStageIds.filter(stageId =>
    state.stageProgress[stageId]?.status === 'loaded'
  )
  const pendingStageIds = requiredStageIds.filter(stageId =>
    state.stageProgress[stageId]?.status !== 'loaded'
  )
  const budgetResult = routeRetirement
    ? { projection: null }
    : projectPendingStages(envelope, pendingStageIds)
  const budgetErrorCode = !routeRetirement && state.plan?.status === 'complete' &&
    pendingStageIds.length > 0 &&
    !budgetResult.projection.executable
    ? 'BUDGET_BLOCKED'
    : null
  const budgetRecovery = budgetErrorCode
    ? buildBudgetRecovery(budgetErrorCode, budgetResult.projection)
    : null
  let contextErrorCode = null
  let contextRecovery = null
  if (!routeRetirement && !budgetErrorCode && state.plan && pendingStageIds.length) {
    try {
      validateRouteContextPrecondition(state, target, options)
    } catch (error) {
      if (['CONTEXT_BINDING_PENDING', 'CONTEXT_BINDING_MISMATCH', 'CONTEXT_BINDING_STALE'].includes(error.code)) {
        contextErrorCode = error.code
        contextRecovery = buildSkillRouteErrorDetails({
          op: 'load_stage',
          project: target.project,
          turnBinding: state.turnBinding,
          contextEpoch: state.contextEpoch,
          generation: state.plan.generation,
          planDigest: state.plan.planDigest,
          stageId: pendingStageIds[0] || null
        }, error, target)
      } else {
        throw error
      }
    }
  }
  const processComplete = !!state.plan &&
    state.plan.status === 'complete' &&
    !routeRetirement &&
    !budgetErrorCode &&
    !contextErrorCode &&
    requiredStageIds.length === satisfiedStageIds.length
  const nextOp = routeRetirement
    ? null
    : (budgetErrorCode
        ? null
        : (contextErrorCode
            ? 'rebind'
            : (pendingStageIds.length ? 'load_stage' : null)))
  const selectedBusiness = state.obligationLedger?.items?.find(item =>
    item.skillId === state.obligationLedger.selectedBusinessSkillId
  ) || null
  const receipt = {
    schemaVersion: 'SkillRouteStatusV1',
    project: state.project,
    turnBinding: state.turnBinding,
    contextEpoch: state.contextEpoch,
    mode: state.mode,
    catalog: {
      catalogDigest: state.catalog.catalogDigest,
      servedPages: state.servedCatalogPages.length,
      expectedPages: state.catalog.pages.length,
      candidateCount: state.catalog.candidateCount
    },
    decision: state.decision
      ? {
        source: state.decision.source,
        skillId: state.decision.skillId,
        decisionDigest: state.decision.decisionDigest
      }
      : null,
    plan: state.plan ? summarizePlan(state.plan) : null,
    stageProgress: summarizeStageProgress(state.stageProgress),
    budget: {
      ...state.budget,
      projection: budgetResult.projection
    },
    obligations: {
      schemaVersion: 'ObligationStatusV1',
      requiredStageIds,
      satisfiedStageIds,
      processComplete,
      selectedBusiness
    },
    retired: Boolean(routeRetirement),
    retirementReason: retirementErrorCode,
    completionDisposition: routeRetirement ? 'retired-semantic-drift' : null,
    nextAction: {
      schemaVersion: 'SkillRouteNextActionV1',
      nextOp,
      pendingStageIds,
      errorCode: retirementErrorCode || budgetErrorCode || contextErrorCode,
      nextCall: nextOp === 'rebind' && state.plan
        ? {
            op: 'rebind',
            project: state.project,
            turnBinding: state.turnBinding,
            contextEpoch: state.contextEpoch,
            generation: state.plan.generation,
            planDigest: state.plan.planDigest,
            contextBinding: '<fresh ContextReadBindingV1 from refreshed ContextRead>'
          }
        : (nextOp === 'load_stage' && state.plan
            ? buildLoadStageNextCall(state, pendingStageIds[0] || null)
            : null),
      recovery: retirementRecovery || budgetRecovery || contextRecovery
    },
    ledgerSummary: {
      calls: state.contributionLedger.items.length,
      serializedBytes: state.contributionLedger.items.reduce(
        (sum, item) => sum + Number(item.serializedBytes || 0),
        0
      ),
      bodyBytes: state.contributionLedger.items.reduce(
        (sum, item) => sum + Number(item.bodyBytes || 0),
        0
      ),
      modelObserved: state.contributionLedger.items.some(item => item.modelObserved === 'direct-pass')
        ? 'direct-pass'
        : 'unverified'
    }
  }
  const response = successResponse('status', receipt, [], 16 * 1024)
  response.idempotencyKey = sha256({
    project: input.project,
    turnBinding: input.turnBinding,
    contextEpoch: input.contextEpoch || null,
    op: 'status',
    envelopeVersion: envelope.version
  })
  return finalizeResponse(response, 16 * 1024)
}

const ROUTE_RETIREMENT_IDENTITY_ERRORS = new Set([
  'PROJECT_BINDING_MISMATCH',
  'CONTEXT_BINDING_MISMATCH',
  'MODE_CAPABILITY_STALE',
  'RUNTIME_CONTRACT_STALE',
  'RUNTIME_REFRESH_REQUIRED',
  'TURN_ENVELOPE_READBACK_FAILED',
  'TURN_EXPIRED'
])

const TRUSTED_BUSINESS_RETIREMENT_ERRORS = new Set([
  'MODE_CAPABILITY_STALE',
  'RUNTIME_CONTRACT_STALE'
])

/**
 * Summarize immutable process obligations and the selected business reply for
 * Stop evaluation without mutating the durable route envelope.
 *
 * @param {object} state persisted route state
 * @param {object} input lifecycle Stop input
 * @param {object} [options] trust controls for a misbound envelope
 * @returns {{pendingStageIds: string[], business: object|null, businessSatisfied: boolean}}
 */
function summarizeStopObligations (state, input, options = {}) {
  const requiredStageIds = state.obligationLedger?.requiredStageIds || []
  const stageProgress = state.stageProgress || {}
  const pendingStageIds = requiredStageIds.filter(stageId =>
    stageProgress[stageId]?.status !== 'loaded'
  )
  const business = options.trustBusiness === false
    ? null
    : (state.obligationLedger?.items?.find(item =>
        item.skillId === state.obligationLedger.selectedBusinessSkillId
      ) || null)
  const mustReplyCore = String(business?.mustReplyCore || '')
  const businessSatisfied = !business || (
    mustReplyCore.length > 0 &&
    String(input.assistantText || '').includes(mustReplyCore)
  )
  return { pendingStageIds, business, businessSatisfied }
}

function buildBudgetRetiredRouteStop (
  state,
  input,
  turnBinding,
  budgetResult,
  errorCode = 'BUDGET_BLOCKED'
) {
  const { pendingStageIds, business, businessSatisfied } = summarizeStopObligations(
    state,
    input
  )
  const businessActionRequired = businessSatisfied === false
  const budgetProjection = budgetResult?.projection || null
  return {
    schemaVersion: 'ProgressiveSkillRouteStopV1',
    present: true,
    complete: !businessActionRequired,
    turnBinding,
    contextEpoch: state.contextEpoch,
    planDigest: state.plan?.planDigest || null,
    processComplete: false,
    retired: true,
    retirementReason: errorCode,
    completionDisposition: errorCode === 'BUDGET_BLOCKED'
      ? 'retired-budget-exhausted'
      : 'retired-budget-state-invalid',
    pendingStageIds,
    selectedBusinessSkillId: business?.skillId || null,
    mustReplyCore: business?.mustReplyCore || null,
    businessSatisfied,
    errorCode,
    nextOp: businessActionRequired ? 'satisfy_business' : null,
    nextCall: null,
    budgetProjection,
    recovery: {
      schemaVersion: 'SkillRouteBudgetRecoveryV1',
      terminal: true,
      stateChanged: false,
      retrySameCall: false,
      automatic: !businessActionRequired,
      action: businessActionRequired
        ? 'reply-selected-business-core'
        : 'retire-and-rebootstrap-next-user-prompt',
      mustReplyCore: business?.mustReplyCore || null,
      rebootstrapOnNextUserPrompt: true,
      budgetProjection
    }
  }
}

/**
 * Project a route that cannot execute under the current identity as retired.
 * Retirement preserves incomplete process evidence; it only ends obligations
 * that no current-runtime operation can satisfy.
 *
 * @param {object} state persisted route state
 * @param {object} input lifecycle Stop input
 * @param {string} turnBinding active turn binding
 * @param {Error} error binding failure
 * @returns {object|null} retired Stop projection or null for other failures
 */
function buildRetiredRouteStop (state, input, turnBinding, error) {
  const errorCode = error.code || 'SKILL_ROUTE_STOP_BINDING_FAILED'
  if (!ROUTE_RETIREMENT_IDENTITY_ERRORS.has(errorCode)) return null
  const trustBusiness = TRUSTED_BUSINESS_RETIREMENT_ERRORS.has(errorCode)
  const { pendingStageIds, business, businessSatisfied } = summarizeStopObligations(
    state,
    input,
    { trustBusiness }
  )
  const businessActionRequired = businessSatisfied === false
  return {
    schemaVersion: 'ProgressiveSkillRouteStopV1',
    present: true,
    complete: !businessActionRequired,
    turnBinding,
    contextEpoch: state.contextEpoch,
    planDigest: state.plan?.planDigest || null,
    processComplete: false,
    retired: true,
    retirementReason: errorCode,
    completionDisposition: 'retired-stale-identity',
    pendingStageIds,
    selectedBusinessSkillId: business?.skillId || null,
    mustReplyCore: business?.mustReplyCore || null,
    businessSatisfied,
    businessEvaluation: trustBusiness
      ? 'trusted-bound-route'
      : 'not-applicable-untrusted-route-identity',
    errorCode,
    nextOp: businessActionRequired ? 'satisfy_business' : null,
    nextCall: null,
    recovery: {
      schemaVersion: 'SkillRouteRetirementRecoveryV1',
      automatic: !businessActionRequired,
      action: businessActionRequired
        ? 'reply-selected-business-core'
        : 'retire-and-allow-stop',
      mustReplyCore: business?.mustReplyCore || null,
      rebootstrapOnNextUserPrompt: true
    }
  }
}

function buildPersistedRetiredRouteStop (state, turnBinding, retirement) {
  const { pendingStageIds } = summarizeStopObligations(
    state,
    {},
    { trustBusiness: false }
  )
  return {
    schemaVersion: 'ProgressiveSkillRouteStopV1',
    present: true,
    complete: true,
    turnBinding,
    contextEpoch: state.contextEpoch,
    planDigest: state.plan?.planDigest || null,
    processComplete: false,
    retired: true,
    retirementReason: retirement.reasonCode,
    completionDisposition: 'retired-semantic-drift',
    pendingStageIds,
    selectedBusinessSkillId: null,
    mustReplyCore: null,
    businessSatisfied: true,
    businessEvaluation: 'not-applicable-semantic-drift',
    errorCode: retirement.reasonCode,
    nextOp: null,
    nextCall: null,
    recovery: buildRouteRetirementRecovery(retirement, false)
  }
}

function evaluateProgressiveSkillRouteStop (input, options = {}) {
  const target = resolveProjectTarget(
    options.inputRoot || input.cwd || process.cwd(),
    input.project
  )
  const turnBinding = input.turnBinding || deriveTurnBinding(
    target.project,
    target.activeRoot,
    input.contextEpoch
  )
  let envelope
  try {
    envelope = loadEnvelope(target.activeRoot, turnBinding, options).envelope
  } catch (error) {
    if (error.code === 'TURN_NOT_FOUND') {
      return {
        schemaVersion: 'ProgressiveSkillRouteStopV1',
        present: false,
        complete: true,
        turnBinding
      }
    }
    if (error.code === 'TURN_EXPIRED' && error.routeEnvelope?.state) {
      const expiredState = error.routeEnvelope.state
      const requestedHostSessionId = String(input.hostSessionId || '')
      if (requestedHostSessionId &&
          expiredState.hostSessionId &&
          requestedHostSessionId !== expiredState.hostSessionId) {
        return {
          schemaVersion: 'ProgressiveSkillRouteStopV1',
          present: false,
          complete: true,
          turnBinding,
          ignoredReason: 'HOST_SESSION_MISMATCH'
        }
      }
      const retired = buildRetiredRouteStop(expiredState, input, turnBinding, error)
      if (retired) return retired
    }
    return {
      schemaVersion: 'ProgressiveSkillRouteStopV1',
      present: true,
      complete: true,
      turnBinding,
      processComplete: false,
      retired: true,
      retirementReason: error.code || 'SKILL_ROUTE_STOP_READ_FAILED',
      completionDisposition: 'retired-unreadable-route',
      pendingStageIds: [],
      businessSatisfied: true,
      errorCode: error.code || 'SKILL_ROUTE_STOP_READ_FAILED',
      nextOp: null,
      nextCall: null,
      recovery: {
        schemaVersion: 'SkillRouteRetirementRecoveryV1',
        automatic: true,
        action: 'retire-and-rebootstrap-next-user-prompt',
        rebootstrapOnNextUserPrompt: true
      }
    }
  }
  const state = envelope.state
  const requestedHostSessionId = String(input.hostSessionId || '')
  if (requestedHostSessionId &&
      state.hostSessionId &&
      requestedHostSessionId !== state.hostSessionId) {
    return {
      schemaVersion: 'ProgressiveSkillRouteStopV1',
      present: false,
      complete: true,
      turnBinding,
      ignoredReason: 'HOST_SESSION_MISMATCH'
    }
  }
  try {
    assertEnvelopeBinding(state, {
      project: target.project,
      turnBinding,
      contextEpoch: input.contextEpoch
    }, target, options)
  } catch (error) {
    const retired = buildRetiredRouteStop(state, input, turnBinding, error)
    if (retired) return retired
    const { pendingStageIds, business, businessSatisfied } = summarizeStopObligations(
      state,
      input
    )
    return {
      schemaVersion: 'ProgressiveSkillRouteStopV1',
      present: true,
      complete: businessSatisfied,
      turnBinding,
      contextEpoch: state.contextEpoch,
      planDigest: state.plan?.planDigest || null,
      processComplete: false,
      retired: true,
      retirementReason: error.code || 'SKILL_ROUTE_STOP_BINDING_FAILED',
      completionDisposition: 'refresh-required',
      pendingStageIds,
      selectedBusinessSkillId: business?.skillId || null,
      mustReplyCore: business?.mustReplyCore || null,
      businessSatisfied,
      errorCode: error.code || 'SKILL_ROUTE_STOP_BINDING_FAILED',
      nextOp: businessSatisfied ? null : 'satisfy_business',
      nextCall: null,
      recovery: {
        schemaVersion: 'SkillRouteRetirementRecoveryV1',
        automatic: businessSatisfied,
        action: businessSatisfied
          ? 'retire-and-rebootstrap-next-user-prompt'
          : 'reply-selected-business-core',
        mustReplyCore: business?.mustReplyCore || null,
        rebootstrapOnNextUserPrompt: true
      }
    }
  }
  const routeRetirement = terminalRouteRetirement(state)
  if (routeRetirement) {
    return buildPersistedRetiredRouteStop(state, turnBinding, routeRetirement)
  }
  const { pendingStageIds, business, businessSatisfied } = summarizeStopObligations(
    state,
    input
  )
  if (state.plan?.status === 'complete' && pendingStageIds.length) {
    let budgetResult
    try {
      budgetResult = projectPendingStages(envelope, pendingStageIds)
    } catch (error) {
      if (String(error.code || '').startsWith('BODY_CHARGE_')) {
        return buildBudgetRetiredRouteStop(
          state,
          input,
          turnBinding,
          null,
          error.code
        )
      }
      throw error
    }
    if (!budgetResult.projection.executable) {
      return buildBudgetRetiredRouteStop(
        state,
        input,
        turnBinding,
        budgetResult,
        'BUDGET_BLOCKED'
      )
    }
  }
  let contextErrorCode = null
  let contextRecovery = null
  if (state.plan && pendingStageIds.length) {
    try {
      validateRouteContextPrecondition(state, target, options)
    } catch (error) {
      if (['CONTEXT_BINDING_PENDING', 'CONTEXT_BINDING_MISMATCH', 'CONTEXT_BINDING_STALE'].includes(error.code)) {
        contextErrorCode = error.code
        contextRecovery = buildSkillRouteErrorDetails({
          op: 'load_stage',
          project: target.project,
          turnBinding,
          contextEpoch: state.contextEpoch,
          generation: state.plan.generation,
          planDigest: state.plan.planDigest,
          stageId: pendingStageIds[0] || null
        }, error, target)
      } else {
        throw error
      }
    }
  }
  const processComplete = !!state.plan &&
    state.plan.status === 'complete' &&
    !contextErrorCode &&
    pendingStageIds.length === 0
  const rootPlanBlocked = !!state.plan && state.plan.status === 'blocked' &&
    !contextErrorCode
  if (rootPlanBlocked) {
    return {
      schemaVersion: 'ProgressiveSkillRouteStopV1',
      present: true,
      complete: businessSatisfied,
      turnBinding,
      contextEpoch: state.contextEpoch,
      planDigest: state.plan.planDigest || null,
      processComplete: false,
      retired: true,
      retirementReason: 'ROOT_PLAN_BLOCKED',
      completionDisposition: 'retired-root-plan-blocked',
      pendingStageIds: [],
      selectedBusinessSkillId: business?.skillId || null,
      mustReplyCore: business?.mustReplyCore || null,
      businessSatisfied,
      errorCode: 'ROOT_PLAN_BLOCKED',
      nextOp: businessSatisfied ? null : 'satisfy_business',
      nextCall: null,
      recovery: {
        schemaVersion: 'SkillRouteRetirementRecoveryV1',
        automatic: businessSatisfied,
        action: businessSatisfied
          ? 'retire-and-rebootstrap-next-user-prompt'
          : 'reply-selected-business-core',
        mustReplyCore: business?.mustReplyCore || null,
        rebootstrapOnNextUserPrompt: true
      }
    }
  }
  const planMissingNextOp = !state.plan && state.explicit?.status === 'ready'
    ? 'commit'
    : 'catalog'
  const nextOp = contextErrorCode
    ? 'rebind'
    : (pendingStageIds.length
        ? 'load_stage'
        : (!state.plan ? planMissingNextOp : (!businessSatisfied ? 'satisfy_business' : null)))
  const nextCall = nextOp === 'rebind' && state.plan
    ? {
        op: 'rebind',
        project: target.project,
        turnBinding,
        contextEpoch: state.contextEpoch,
        generation: state.plan.generation,
        planDigest: state.plan.planDigest,
        contextBinding: '<fresh ContextReadBindingV1 from refreshed ContextRead>'
      }
    : (nextOp === 'load_stage' && state.plan
        ? buildLoadStageNextCall(state, pendingStageIds[0] || null)
        : (nextOp === 'commit'
            ? {
                op: 'commit',
                project: target.project,
                turnBinding,
                contextEpoch: state.contextEpoch,
                catalogDigest: state.catalog.catalogDigest,
                skillId: null,
                contextBinding: '<current verified ContextReadBindingV1>'
              }
            : (nextOp === 'catalog'
            ? {
                op: 'catalog',
                project: target.project,
                turnBinding,
                contextEpoch: state.contextEpoch
              }
            : null)))
  return {
    schemaVersion: 'ProgressiveSkillRouteStopV1',
    present: true,
    complete: processComplete && businessSatisfied,
    turnBinding,
    contextEpoch: state.contextEpoch,
    planDigest: state.plan?.planDigest || null,
    processComplete,
    pendingStageIds,
    selectedBusinessSkillId: business?.skillId || null,
    mustReplyCore: business?.mustReplyCore || null,
    businessSatisfied,
    errorCode: contextErrorCode || (state.plan
      ? (state.plan.status === 'complete' ? null : 'ROOT_PLAN_BLOCKED')
      : 'PLAN_NOT_COMMITTED'),
    nextOp,
    nextCall,
    recovery: contextRecovery
  }
}

function shouldEnforceProgressiveSkillRouteStop (routeStop, explicitRoutePending, trigger = '') {
  if (!routeStop?.present || routeStop.complete) return false
  if (routeStop.retired === true) {
    return routeStop.businessSatisfied === false
  }
  if (routeStop.errorCode === 'PLAN_NOT_COMMITTED') {
    // Explicit Skill requests remain fail-closed for every lifecycle phase.
    // Non-explicit turns only become enforceable once the model attempts a
    // tool call. This prevents real work from bypassing route selection while
    // leaving tool-free chat free of a Stop/reconciliation loop.
    return explicitRoutePending === true || trigger === 'PreToolUse'
  }
  if (ROUTE_RETIREMENT_IDENTITY_ERRORS.has(routeStop.errorCode)) {
    // Legacy projections without an explicit retirement disposition remain
    // fail-closed. Only the current evaluator may retire a bound route.
    return Boolean(
      routeStop.planDigest ||
      (routeStop.pendingStageIds || []).length
    ) || explicitRoutePending === true
  }
  return true
}

function handleSkillRoute (input, options = {}) {
  const shapeError = validateRequestShape(input)
  if (shapeError) {
    return makeToolError(
      input?.op || 'unknown',
      shapeError,
      requestShapeNextStep(input, shapeError),
      { details: buildRequestShapeDetails(input, shapeError) }
    )
  }
  let target
  try {
    target = resolveProjectTarget(options.inputRoot || process.cwd(), input.project)
    if (target.project !== input.project) {
      const error = new Error('PROJECT_BINDING_MISMATCH')
      error.code = 'PROJECT_BINDING_MISMATCH'
      throw error
    }
    if (input.op === 'catalog') return handleCatalog(input, target, options)
    if (input.op === 'commit') return handleCommit(input, target, options)
    if (input.op === 'rebind') return handleRebind(input, target, options)
    if (input.op === 'load_stage') return handleLoadStage(input, target, options)
    return handleStatus(input, target, options)
  } catch (error) {
    return makeToolError(
      input.op,
      error.code || error.message || 'SKILL_ROUTE_FAILED',
      skillRouteErrorNextStep(error),
      {
        limitBytes: input.op === 'catalog' ? 8 * 1024 : (input.op === 'load_stage' ? 48 * 1024 : 16 * 1024),
        details: buildSkillRouteErrorDetails(input, error, target)
      }
    )
  }
}

function formatSkillRouteBootstrapInjection (bootstrap, options = {}) {
  const grokQualified = String(options.host || '').toLowerCase().startsWith('grok')
  const routeTool = grokQualified
    ? 'devcodex-profile__skill_route'
    : 'skill_route'
  const hostToolContract = grokQualified
    ? [
        'For this Grok host, use only these server-qualified MCP tool names: `devcodex-profile__profile_context_plan`, `devcodex-profile__profile_load`, `devcodex-profile__skill_route`, and `devcodex-memory__memory_status`.',
        'Do not call unqualified names or another host\'s `mcp__...` aliases.'
      ]
    : []
  const injectionText = [
    '### DevCodex · SkillRouteBootstrapV1',
    JSON.stringify(bootstrap),
    '',
    ...hostToolContract,
    `Use the local \`${routeTool}\` Tool. For a non-explicit task, read every catalog page before one \`commit\` choice (\`skillId\` is one id or null).`,
    'For the first `catalog` call, omit `cursor` entirely; never send `cursor:null`. Add `cursor` only when the preceding catalog page returns a non-empty `nextCursor`.',
    'There is no `replan` operation. Activate a ready late condition with another `op:"commit"` call using the current `previousPlanDigest`, `lateConditionId`, and fresh `ContextReadBindingV1` before loading that conditional stage.',
    'A quoted, negated, diagnostic, screenshot, log, report, or explanatory mention of a skill id is not an invocation. Choose null unless the user positively asks to use that skill or its intent clearly matches the actual task.',
    'Do not infer workflow roots, paths, dependencies, or body content. After a complete plan, call `load_stage` only when entering that stage.',
    'If ContextRead becomes stale while stages remain pending, refresh ContextRead and call `rebind` with the current generation/planDigest and fresh contextBinding before retrying `load_stage`.'
  ].join('\n')
  if (byteLength(injectionText) > 4 * 1024) {
    const error = new Error('SKILL_ROUTE_BOOTSTRAP_BUDGET_BLOCKED')
    error.code = 'SKILL_ROUTE_BOOTSTRAP_BUDGET_BLOCKED'
    throw error
  }
  return injectionText
}

function bootstrapSkillRouteForTurn (input, options = {}) {
  const target = resolveProjectTarget(options.inputRoot || input.cwd || process.cwd(), input.project)
  const modeReceipt = resolveSkillRouteMode({
    ...options,
    project: target.project,
    host: input.host
  })
  if (modeReceipt.effective !== 'unified') {
    return {
      schemaVersion: 'SkillRouteBootstrapOutcomeV1',
      active: false,
      modeReceipt,
      bootstrap: null,
      injectionText: ''
    }
  }
  const outcome = bootstrapSkillRoute({
    project: target.project,
    activeRoot: target.activeRoot,
    contextEpoch: input.contextEpoch,
    prompt: input.prompt,
    ...(Object.prototype.hasOwnProperty.call(input, 'explicitSkillId')
      ? { explicitSkillId: input.explicitSkillId }
      : {}),
    mode: modeReceipt.effective,
    modeReceipt,
    runtimeContractDigest: modeReceipt.runtimeContractDigest,
    cwd: target.projectRoot
  }, {
    ...options,
    cwd: target.projectRoot,
    inputRoot: options.inputRoot || input.cwd,
    runtimeRoot: options.runtimeRoot,
    packageRoot: options.packageRoot
  })
  const injectionText = formatSkillRouteBootstrapInjection(outcome.bootstrap, {
    host: input.host
  })
  return {
    schemaVersion: 'SkillRouteBootstrapOutcomeV1',
    active: true,
    modeReceipt,
    bootstrap: outcome.bootstrap,
    reused: outcome.reused,
    injectionText
  }
}

module.exports = {
  ACCEPTED_CONTEXT_RECEIPT_STATUSES,
  resolveProjectTarget,
  lifecycleStatePath,
  validateTrustedContextBinding,
  validateRequestShape,
  finalizeResponse,
  handleSkillRoute,
  evaluateProgressiveSkillRouteStop,
  shouldEnforceProgressiveSkillRouteStop,
  formatSkillRouteBootstrapInjection,
  bootstrapSkillRouteForTurn,
  summarizePlan,
  buildObligationLedger,
  stageItems,
  buildStagePages,
  preserveCompatibleStageProgress,
  assertReplanProgressCompatible,
  summarizeStageProgress,
  stageIdentityKeys,
  stageCompatibilitySignature,
  buildLoadStageNextCall,
  rebindSemanticDigest
}
