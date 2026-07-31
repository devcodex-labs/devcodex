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
  if (identityMatches && ACCEPTED_CONTEXT_RECEIPT_STATUSES.has(receipt.status)) {
    return { rebound: false, lifecycle }
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
  const statePath = lifecycleStatePath(target)
  try {
    writeJsonAtomic(statePath, lifecycle, fsImpl)
  } catch {
    // Still use in-memory rebinding for this call even if persist fails.
  }
  return { rebound: true, lifecycle }
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
    const error = new Error('CONTEXT_BINDING_INVALID')
    error.code = 'CONTEXT_BINDING_INVALID'
    throw error
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
  const receipt = acquisition?.receipt
  if (!plan || !receipt) {
    const error = new Error('CONTEXT_BINDING_PENDING')
    error.code = 'CONTEXT_BINDING_PENDING'
    throw error
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
    const error = new Error('CONTEXT_BINDING_MISMATCH')
    error.code = 'CONTEXT_BINDING_MISMATCH'
    throw error
  }
  if (!ACCEPTED_CONTEXT_RECEIPT_STATUSES.has(receipt.status)) {
    const error = new Error('CONTEXT_BINDING_PENDING')
    error.code = 'CONTEXT_BINDING_PENDING'
    throw error
  }
  if (Array.isArray(receipt.missingSourceIds) && receipt.missingSourceIds.length > 0) {
    const error = new Error('CONTEXT_BINDING_PENDING')
    error.code = 'CONTEXT_BINDING_PENDING'
    throw error
  }
  if (Array.isArray(plan.mandatorySourceIds) && plan.mandatorySourceIds.length > 0) {
    const satisfiedSourceIds = Array.isArray(receipt.satisfiedSourceIds)
      ? new Set(receipt.satisfiedSourceIds)
      : new Set()
    if (plan.mandatorySourceIds.some(sourceId => !satisfiedSourceIds.has(sourceId))) {
      const error = new Error('CONTEXT_BINDING_PENDING')
      error.code = 'CONTEXT_BINDING_PENDING'
      throw error
    }
  }
  if (receipt.status === 'baseline-ready' &&
      (plan.selectedSources?.length || plan.mandatorySourceIds?.length)) {
    const error = new Error('CONTEXT_BINDING_PENDING')
    error.code = 'CONTEXT_BINDING_PENDING'
    throw error
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
  const allowedByOp = {
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
  }
  if (!Object.prototype.hasOwnProperty.call(allowedByOp, op)) return 'OP_INVALID'
  if (Object.keys(input).some(key => !allowedByOp[op].includes(key))) return 'REQUEST_FIELD_UNSUPPORTED'
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
  const runtimeContractDigest = getRuntimeContractDigest(options)
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
      if (isReplan && state.stageProgress.closeout?.status === 'loaded') {
        const error = new Error('LATE_CONDITION_AFTER_CLOSEOUT')
        error.code = 'LATE_CONDITION_AFTER_CLOSEOUT'
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
      assertReplanProgressCompatible(priorPlan, plan, state.stageProgress)
      state.decision = decision
      state.plan = plan
      state.stageProgress = preserveCompatibleStageProgress(
        priorPlan,
        plan,
        state.stageProgress
      )
      state.contextBinding = JSON.parse(JSON.stringify(input.contextBinding))
      state.trustedContextBindingDigest = trustedContext.bindingDigest
      state.hostSessionId = trustedContext.hostSessionId || state.hostSessionId || ''
      state.obligationLedger = buildObligationLedger(plan, state.stageProgress)
      const summary = summarizePlan(plan)
      const response = bindResponseToTransaction(plan.status === 'complete'
        ? successResponse('commit', {
          schemaVersion: 'SkillRouteCommitReceiptV1',
          decision,
           plan: summary,
           contextBindingDigest: trustedContext.bindingDigest,
           obligations: state.obligationLedger
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
               obligations: state.obligationLedger
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
        const error = new Error('REBIND_SEMANTIC_DRIFT')
        error.code = 'REBIND_SEMANTIC_DRIFT'
        throw error
      }
      assertReplanProgressCompatible(priorPlan, plan, state.stageProgress)
      state.plan = plan
      state.stageProgress = preserveCompatibleStageProgress(
        priorPlan,
        plan,
        state.stageProgress
      )
      state.contextBinding = JSON.parse(JSON.stringify(input.contextBinding))
      state.trustedContextBindingDigest = trustedContext.bindingDigest
      state.hostSessionId = trustedContext.hostSessionId || state.hostSessionId || ''
      state.obligationLedger = buildObligationLedger(plan, state.stageProgress)
      const response = bindResponseToTransaction(successResponse('rebind', {
        schemaVersion: 'SkillRouteRebindReceiptV1',
        priorGeneration: priorPlan.generation,
        priorPlanDigest: priorPlan.planDigest,
        plan: summarizePlan(plan),
        contextBindingDigest: trustedContext.bindingDigest,
        obligations: state.obligationLedger,
        preservedStageProgress: summarizeStageProgress(state.stageProgress)
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

function preserveCompatibleStageProgress (priorPlan, nextPlan, progress = {}) {
  if (!priorPlan) return {}
  const preserved = {}
  for (const [stageId, value] of Object.entries(progress || {})) {
    if (value?.status !== 'loaded') continue
    const before = stageIdentityKeys(priorPlan, stageId)
    const after = stageIdentityKeys(nextPlan, stageId)
    if (before.length && JSON.stringify(before) === JSON.stringify(after)) {
      preserved[stageId] = JSON.parse(JSON.stringify(value))
    }
  }
  return preserved
}

function assertReplanProgressCompatible (priorPlan, nextPlan, progress = {}) {
  if (!priorPlan) return
  for (const [stageId, value] of Object.entries(progress || {})) {
    if (!value?.loadedKeys?.length) continue
    if (value.status !== 'loaded') {
      const error = new Error('LATE_REPLAN_STAGE_INCOMPLETE')
      error.code = 'LATE_REPLAN_STAGE_INCOMPLETE'
      error.stageId = stageId
      throw error
    }
    const before = stageIdentityKeys(priorPlan, stageId)
    const after = stageIdentityKeys(nextPlan, stageId)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const error = new Error('LATE_REPLAN_LOADED_EVICTION')
      error.code = 'LATE_REPLAN_LOADED_EVICTION'
      error.stageId = stageId
      throw error
    }
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

function handleLoadStage (input, target, options) {
  return transactEnvelope(
    target.activeRoot,
    input.turnBinding,
    input,
    (envelope, tx) => {
      const state = envelope.state
      assertEnvelopeBinding(state, input, target, options)
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
      const liveContext = validateTrustedContextBinding(
        state.contextBinding,
        target,
        options
      )
      if (liveContext.bindingDigest !== state.trustedContextBindingDigest ||
          liveContext.bindingDigest !== state.plan.contextBindingDigest) {
        const error = new Error('CONTEXT_BINDING_STALE')
        error.code = 'CONTEXT_BINDING_STALE'
        throw error
      }
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
      const newlyCharged = loadedKeys.filter(key =>
        !Object.values(state.stageProgress)
          .some(other => other !== progress && (other.loadedKeys || []).includes(key))
      )
      const chargedBytes = chunks
        .filter(chunk => newlyCharged.some(key => key.startsWith(`${chunk.skillId}|`)))
        .reduce((sum, chunk) => sum + chunk.bytes, 0)
      if (state.budget.bodyBytesConsumed + chargedBytes > state.budget.bodyLimitBytes) {
        const error = new Error('BUDGET_BLOCKED')
        error.code = 'BUDGET_BLOCKED'
        throw error
      }
      state.budget.bodyBytesConsumed += chargedBytes
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
        bodyBytes: chargedBytes,
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
  const requiredStageIds = state.obligationLedger?.requiredStageIds || []
  const satisfiedStageIds = requiredStageIds.filter(stageId =>
    state.stageProgress[stageId]?.status === 'loaded'
  )
  const processComplete = !!state.plan &&
    state.plan.status === 'complete' &&
    requiredStageIds.length === satisfiedStageIds.length
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
    budget: state.budget,
    obligations: {
      schemaVersion: 'ObligationStatusV1',
      requiredStageIds,
      satisfiedStageIds,
      processComplete,
      selectedBusiness
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
    return {
      schemaVersion: 'ProgressiveSkillRouteStopV1',
      present: true,
      complete: false,
      turnBinding,
      errorCode: error.code || 'SKILL_ROUTE_STOP_READ_FAILED'
    }
  }
  try {
    assertEnvelopeBinding(envelope.state, {
      project: target.project,
      turnBinding,
      contextEpoch: input.contextEpoch
    }, target, options)
  } catch (error) {
    return {
      schemaVersion: 'ProgressiveSkillRouteStopV1',
      present: true,
      complete: false,
      turnBinding,
      errorCode: error.code || 'SKILL_ROUTE_STOP_BINDING_FAILED'
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
  const requiredStageIds = state.obligationLedger?.requiredStageIds || []
  const pendingStageIds = requiredStageIds.filter(stageId =>
    state.stageProgress[stageId]?.status !== 'loaded'
  )
  const business = state.obligationLedger?.items?.find(item =>
    item.skillId === state.obligationLedger.selectedBusinessSkillId
  ) || null
  const businessSatisfied = !business ||
    String(input.assistantText || '').includes(business.mustReplyCore)
  let contextErrorCode = null
  if (state.plan && pendingStageIds.length && state.contextBinding) {
    try {
      validateTrustedContextBinding(state.contextBinding, target, options)
    } catch (error) {
      if (['CONTEXT_BINDING_PENDING', 'CONTEXT_BINDING_MISMATCH'].includes(error.code)) {
        contextErrorCode = error.code
      } else {
        throw error
      }
    }
  }
  const processComplete = !!state.plan &&
    state.plan.status === 'complete' &&
    !contextErrorCode &&
    pendingStageIds.length === 0
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
    nextOp: contextErrorCode ? 'rebind' : null
  }
}

const NON_RECOVERABLE_ROUTE_IDENTITY_ERRORS = new Set([
  'MODE_CAPABILITY_STALE',
  'RUNTIME_CONTRACT_STALE'
])

function shouldEnforceProgressiveSkillRouteStop (routeStop, explicitRoutePending) {
  if (!routeStop?.present || routeStop.complete) return false
  if (routeStop.errorCode === 'PLAN_NOT_COMMITTED') {
    return explicitRoutePending === true
  }
  if (NON_RECOVERABLE_ROUTE_IDENTITY_ERRORS.has(routeStop.errorCode)) {
    // A runtime/capability refresh invalidates the frozen turn identity. A
    // non-explicit route has no body obligation, so fail closed without
    // trapping Stop in a continuation that cannot repair the old envelope.
    return explicitRoutePending === true
  }
  return true
}

function handleSkillRoute (input, options = {}) {
  const shapeError = validateRequestShape(input)
  if (shapeError) return makeToolError(input?.op || 'unknown', shapeError)
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
      'Refresh the bound bootstrap/catalog/context state and retry the same logical operation.',
      { limitBytes: input.op === 'catalog' ? 8 * 1024 : (input.op === 'load_stage' ? 48 * 1024 : 16 * 1024) }
    )
  }
}

function formatSkillRouteBootstrapInjection (bootstrap) {
  const injectionText = [
    '### DevCodex · SkillRouteBootstrapV1',
    JSON.stringify(bootstrap),
    '',
    'Use the local `skill_route` Tool. For a non-explicit task, read every catalog page before one `commit` choice (`skillId` is one id or null).',
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
  const injectionText = formatSkillRouteBootstrapInjection(outcome.bootstrap)
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
  rebindSemanticDigest
}
