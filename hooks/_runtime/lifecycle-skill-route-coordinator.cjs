'use strict'

const crypto = require('crypto')
const {
  compareRuntimeProcessIdentity
} = require('./runtime-generation-identity.cjs')

const COORDINATOR_SCHEMA = 'ActiveReconciliationCoordinatorV1'
const NEXT_ACTION_SCHEMA = 'NextActionEnvelopeV1'
const NO_PROGRESS_LIMIT = 3
const DIGEST_RE = /^[a-f0-9]{64}$/
const TERMINAL_DISPOSITIONS = new Set([
  'retired-no-progress',
  'terminal-tool-failure',
  'generation-superseded',
  'refresh-required'
])
const BUDGET_TERMINAL_ERRORS = new Set([
  'BUDGET_BLOCKED',
  'BUDGET_RESERVATION_BLOCKED'
])
const TERMINAL_TOOL_FAILURE_ERRORS = new Set([
  'BUDGET_BLOCKED',
  'BUDGET_RESERVATION_BLOCKED',
  'MODE_CAPABILITY_STALE',
  'REBIND_SEMANTIC_DRIFT',
  'RUNTIME_CONTRACT_STALE',
  'RUNTIME_REFRESH_REQUIRED',
  'TURN_ENVELOPE_READBACK_FAILED',
  'TURN_EXPIRED'
])
const PRECOMMIT_BOUND_CONTEXT_TOOLS = new Set([
  'profile_load',
  'memory_status',
  'memory_session_query',
  'memory_summary_query'
])

function stableValue (value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])])
  )
}

function digest (value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function firstString (...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function getHookRunId (payload = {}) {
  return firstString(
    payload.hookRunId,
    payload.hook_run_id,
    payload.devcodexHookRunId,
    payload.devcodex_hook_run_id,
    payload.metadata?.hookRunId,
    payload.metadata?.hook_run_id
  )
}

function getToolInput (payload = {}) {
  const direct = payload.tool_input ?? payload.toolInput ?? payload.input ?? payload.arguments
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct
  if (typeof direct === 'string') {
    try {
      const parsed = JSON.parse(direct)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {}
  }
  return {}
}

function normalizeToolName (value) {
  const raw = String(value || '').trim().toLowerCase()
  const mcp = raw.match(/^mcp__(?:devcodex[_-])?(?:profile|memory)__([a-z0-9_]+)$/)
  if (mcp) return mcp[1]
  const pair = raw.match(/(?:^|[/_-])((?:profile_context_plan|profile_load|skill_route|memory_status|memory_session_query|memory_summary_query))$/)
  if (pair) return pair[1]
  return raw
}

function routeActionFromPayload (payload = {}, contextPost = null) {
  const input = getToolInput(payload)
  const nested = input.tool_input && typeof input.tool_input === 'object'
    ? input.tool_input
    : input
  const attempt = contextPost?.attempt || null
  const tool = normalizeToolName(firstString(
    attempt?.canonical,
    payload.tool_name,
    payload.toolName,
    input.tool,
    input.tool_name,
    input.toolName,
    input.name
  ))
  return {
    tool,
    op: firstString(nested.op, input.op),
    project: firstString(nested.project, input.project),
    turnBinding: firstString(nested.turnBinding, input.turnBinding),
    contextEpoch: firstString(nested.contextEpoch, input.contextEpoch),
    generation: nested.generation ?? input.generation,
    planDigest: firstString(nested.planDigest, input.planDigest),
    stageId: firstString(nested.stageId, input.stageId),
    contextBinding: nested.contextBinding && typeof nested.contextBinding === 'object'
      ? nested.contextBinding
      : (input.contextBinding && typeof input.contextBinding === 'object'
          ? input.contextBinding
          : null)
  }
}

function hasMatchingPrecommitContextBinding (action, routeStop) {
  const binding = action?.contextBinding
  if (!binding || binding.schemaVersion !== 'ContextReadBindingV1') return false
  const expectedProject = firstString(routeStop?.nextCall?.project)
  if (!binding.project || !binding.contextEpoch || !binding.planId || !binding.planContentId || !binding.activeRoot) {
    return false
  }
  if (routeStop?.contextEpoch && binding.contextEpoch !== routeStop.contextEpoch) return false
  if (expectedProject && binding.project !== expectedProject) return false
  if (action.project && binding.project !== action.project) return false
  if (action.contextEpoch && binding.contextEpoch !== action.contextEpoch) return false
  return true
}

function buildRouteStateFingerprint (routeStop = {}, input = {}) {
  return digest({
    sessionKey: String(input.sessionKey || ''),
    turnBinding: String(routeStop.turnBinding || ''),
    contextEpoch: String(routeStop.contextEpoch || ''),
    generation: routeStop.nextCall?.generation ?? null,
    planDigest: String(routeStop.planDigest || routeStop.nextCall?.planDigest || ''),
    processComplete: routeStop.processComplete === true,
    retired: routeStop.retired === true,
    retirementReason: routeStop.retirementReason || null,
    completionDisposition: routeStop.completionDisposition || null,
    pendingStageIds: [...(routeStop.pendingStageIds || [])].sort(),
    errorCode: routeStop.errorCode || null,
    nextOp: routeStop.nextOp || null,
    nextCall: routeStop.nextCall || null,
    selectedBusinessSkillId: routeStop.selectedBusinessSkillId || null,
    mustReplyCore: routeStop.mustReplyCore || null,
    businessSatisfied: routeStop.businessSatisfied !== false
  })
}

function boundedCounter (value, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= maximum
    ? numeric
    : 0
}

function normalizeCoordinatorState (value) {
  const source = value && typeof value === 'object' ? value : {}
  const stateFingerprint = String(source.stateFingerprint || '')
  const noProgressCount = boundedCounter(source.noProgressCount, NO_PROGRESS_LIMIT)
  const progressCount = boundedCounter(source.progressCount)
  const circuitOpen = source.circuitOpen === true && noProgressCount === NO_PROGRESS_LIMIT
  const terminalFingerprint = String(source.terminalFingerprint || '')
  const terminalDisposition = String(source.terminalDisposition || '')
  const terminalReasonCode = String(source.terminalReasonCode || '')
  const terminalEvidenceDigest = String(source.terminalEvidenceDigest || '')
  const terminalStateValid = terminalFingerprint === stateFingerprint &&
    DIGEST_RE.test(terminalFingerprint) &&
    TERMINAL_DISPOSITIONS.has(terminalDisposition) &&
    terminalReasonCode.trim().length > 0 &&
    DIGEST_RE.test(terminalEvidenceDigest) &&
    (terminalDisposition !== 'retired-no-progress' || circuitOpen)
  return {
    schemaVersion: COORDINATOR_SCHEMA,
    stateFingerprint,
    lastHookRunId: String(source.lastHookRunId || ''),
    noProgressCount,
    progressCount,
    circuitOpen,
    lastTrigger: String(source.lastTrigger || ''),
    lastAction: String(source.lastAction || ''),
    lastNoticeFingerprint: String(source.lastNoticeFingerprint || ''),
    terminalFingerprint: terminalStateValid ? terminalFingerprint : '',
    terminalDisposition: terminalStateValid ? terminalDisposition : '',
    terminalReasonCode: terminalStateValid ? terminalReasonCode : '',
    terminalEvidenceDigest: terminalStateValid ? terminalEvidenceDigest : '',
    generationReconciliation: source.generationReconciliation &&
      typeof source.generationReconciliation === 'object'
      ? source.generationReconciliation
      : null,
    updatedAt: String(source.updatedAt || '')
  }
}

function callsMatch (action, expected) {
  if (!expected || action.tool !== 'skill_route') return false
  if (action.op !== expected.op) return false
  for (const key of ['project', 'turnBinding', 'contextEpoch', 'planDigest', 'stageId']) {
    if (expected[key] !== undefined && expected[key] !== null &&
        String(expected[key]) !== String(action[key] || '')) return false
  }
  if (expected.generation !== undefined && expected.generation !== null &&
      Number(expected.generation) !== Number(action.generation)) return false
  return true
}

function isExpectedRouteAction (routeStop, payload, contextPost = null) {
  const action = routeActionFromPayload(payload, contextPost)
  if (!routeStop?.present || routeStop.complete) return { expected: true, action }
  if (callsMatch(action, routeStop.nextCall)) return { expected: true, action }
  // ContextRead owns the binding that every committed route consumes. Allow
  // its read-only planner to refresh that binding before the route has had a
  // chance to project nextOp=rebind; otherwise load_stage and ContextRead form
  // a deadlock where neither side can make the route observably stale.
  if (action.tool === 'profile_context_plan') {
    return { expected: true, action }
  }
  if (routeStop.nextOp === 'rebind') {
    const refreshTools = new Set([
      'profile_context_plan',
      'profile_load',
      'memory_status',
      'memory_session_query',
      'memory_summary_query'
    ])
    if (refreshTools.has(action.tool)) return { expected: true, action }
    if (action.tool === 'skill_route' && ['status', 'rebind'].includes(action.op)) {
      return { expected: true, action }
    }
  }
  if (routeStop.errorCode === 'PLAN_NOT_COMMITTED') {
    if (action.tool === 'skill_route' && ['catalog', 'commit', 'status'].includes(action.op)) {
      return { expected: true, action }
    }
    // ContextRead must finish before commit can validate its binding. Only
    // bound, project/epoch-matching reads may cross the route gate; the
    // ContextRead owner still validates selected files and sourceIds later.
    if (PRECOMMIT_BOUND_CONTEXT_TOOLS.has(action.tool) &&
        hasMatchingPrecommitContextBinding(action, routeStop)) {
      return { expected: true, action }
    }
  }
  if (action.tool === 'skill_route' && action.op === 'status') {
    return { expected: true, action }
  }
  return { expected: false, action }
}

function isBudgetTerminalRoute (routeStop) {
  const errorCode = String(routeStop?.errorCode || routeStop?.retirementReason || '')
  return BUDGET_TERMINAL_ERRORS.has(errorCode) || errorCode.startsWith('BODY_CHARGE_')
}

function hasExecutableRouteAction (routeStop) {
  if (!routeStop || routeStop.complete === true || routeStop.retired === true) return false
  if (isBudgetTerminalRoute(routeStop)) {
    return routeStop.businessSatisfied === false &&
      typeof routeStop.mustReplyCore === 'string' && routeStop.mustReplyCore.trim().length > 0
  }
  if (routeStop.nextCall && typeof routeStop.nextCall === 'object' &&
      typeof routeStop.nextCall.op === 'string' && routeStop.nextCall.op.trim()) {
    return true
  }
  if (routeStop.recovery?.automatic === true &&
      typeof routeStop.recovery.action === 'string' && routeStop.recovery.action.trim()) {
    return true
  }
  return routeStop.businessSatisfied === false &&
    typeof routeStop.mustReplyCore === 'string' && routeStop.mustReplyCore.trim().length > 0
}

function retireUnexecutableRoute (routeStop) {
  if (routeStop?.present && isBudgetTerminalRoute(routeStop)) {
    const businessActionRequired = routeStop.businessSatisfied === false &&
      typeof routeStop.mustReplyCore === 'string' && routeStop.mustReplyCore.trim().length > 0
    const reason = routeStop.errorCode || routeStop.retirementReason || 'BUDGET_BLOCKED'
    return {
      ...routeStop,
      complete: !businessActionRequired,
      processComplete: false,
      retired: true,
      retirementReason: reason,
      completionDisposition: reason === 'BUDGET_BLOCKED'
        ? 'retired-budget-exhausted'
        : (reason === 'BUDGET_RESERVATION_BLOCKED'
            ? 'retired-budget-reservation-blocked'
            : 'retired-budget-state-invalid'),
      nextOp: businessActionRequired ? 'satisfy_business' : null,
      nextCall: null,
      recovery: {
        schemaVersion: 'SkillRouteBudgetRecoveryV1',
        terminal: true,
        stateChanged: false,
        retrySameCall: false,
        automatic: !businessActionRequired,
        action: businessActionRequired
          ? 'reply-selected-business-core'
          : 'retire-and-rebootstrap-next-user-prompt',
        mustReplyCore: routeStop.mustReplyCore || null,
        rebootstrapOnNextUserPrompt: true,
        budgetProjection: routeStop.budgetProjection ||
          routeStop.recovery?.budgetProjection || null
      }
    }
  }
  if (!routeStop?.present || routeStop.complete === true || routeStop.retired === true ||
      hasExecutableRouteAction(routeStop)) {
    return routeStop
  }
  const reason = routeStop.errorCode || 'NO_EXECUTABLE_NEXT_ACTION'
  return {
    ...routeStop,
    complete: true,
    processComplete: false,
    retired: true,
    retirementReason: reason,
    completionDisposition: 'retired-no-executable-action',
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

function parseOutcomeObject (outcome) {
  const value = outcome?.payload
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function hasTerminalRecovery (value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return false
  seen.add(value)
  if (value.terminal === true && value.retrySameCall === false) return true
  for (const key of ['details', 'recovery', 'receipt', 'retirement', 'structuredContent', 'result']) {
    if (hasTerminalRecovery(value[key], depth + 1, seen)) return true
  }
  return false
}

function isTerminalToolErrorCode (errorCode) {
  const code = String(errorCode || '')
  return TERMINAL_TOOL_FAILURE_ERRORS.has(code) || code.startsWith('BODY_CHARGE_')
}

function terminalRouteProjection (routeStop, terminal) {
  const businessPending = routeStop?.businessSatisfied === false
  return {
    ...routeStop,
    complete: !businessPending,
    processComplete: false,
    retired: true,
    retirementReason: terminal.reasonCode,
    completionDisposition: terminal.disposition,
    errorCode: terminal.reasonCode,
    nextOp: null,
    nextCall: null,
    recovery: {
      schemaVersion: 'SkillRouteTerminalReconciliationV2',
      terminal: true,
      stateChanged: terminal.stateChanged === true,
      retrySameCall: false,
      automatic: !businessPending,
      action: businessPending
        ? 'preserve-business-evidence-without-route-replay'
        : 'retire-and-rebootstrap-next-user-prompt',
      mustReplyCore: routeStop?.mustReplyCore || null,
      rebootstrapOnNextUserPrompt: true,
      evidenceDigest: terminal.evidenceDigest || null
    }
  }
}

function storedTerminalProjection (routeStop, coordinator) {
  return terminalRouteProjection(routeStop, {
    disposition: coordinator.terminalDisposition || 'terminal-tool-failure',
    reasonCode: coordinator.terminalReasonCode || 'SKILL_ROUTE_TERMINAL',
    evidenceDigest: coordinator.terminalEvidenceDigest || null,
    stateChanged: false
  })
}

function classifyPostToolTerminal (input, expected, progressObserved) {
  if (String(input.trigger || '') !== 'PostToolUse' || expected?.action?.tool !== 'skill_route') {
    return { terminal: null, generationReconciliation: null }
  }
  const outcome = input.contextPost?.outcome || null
  if (!outcome) return { terminal: null, generationReconciliation: null }
  const producer = outcome.producerIdentity || null
  const consumer = input.consumerIdentity || null
  let generationReconciliation = null
  if (producer && consumer) {
    const comparison = compareRuntimeProcessIdentity(producer, consumer)
    generationReconciliation = {
      schemaVersion: 'RuntimeGenerationHandshakeV1',
      status: comparison.status,
      reasonCode: comparison.reasonCode,
      producerGenerationId: producer.generationId || null,
      consumerGenerationId: consumer.generationId || null,
      producerRuntimeContractVersion: producer.runtimeContractVersion ?? null,
      consumerRuntimeContractVersion: consumer.runtimeContractVersion ?? null,
      durableProgressObserved: progressObserved,
      observedAt: new Date().toISOString()
    }
    if (!comparison.current) {
      if (comparison.status === 'generation-superseded' && progressObserved) {
        generationReconciliation.status = 'durable-state-reconciled'
      } else {
        const disposition = comparison.status === 'generation-superseded'
          ? 'generation-superseded'
          : 'refresh-required'
        return {
          terminal: {
            disposition,
            reasonCode: comparison.reasonCode,
            stateChanged: outcome.stateChanged === true,
            evidenceDigest: digest({
              resultDigest: outcome.resultDigest || null,
              producerIdentityDigest: producer.identityDigest || null,
              consumerIdentityDigest: consumer.identityDigest || null,
              comparison: comparison.status
            })
          },
          generationReconciliation
        }
      }
    }
  } else {
    generationReconciliation = {
      schemaVersion: 'RuntimeGenerationHandshakeV1',
      status: 'identity-unavailable',
      reasonCode: producer ? 'consumer-identity-missing' : 'producer-identity-missing',
      durableProgressObserved: progressObserved,
      observedAt: new Date().toISOString()
    }
  }
  const body = parseOutcomeObject(outcome)
  const errorCode = String(outcome.errorCode || body?.errorCode || '')
  const failed = outcome.success === false || outcome.ok === false || !!outcome.error
  if (failed && (hasTerminalRecovery(body) || isTerminalToolErrorCode(errorCode))) {
    return {
      terminal: {
        disposition: 'terminal-tool-failure',
        reasonCode: errorCode || 'TERMINAL_TOOL_FAILURE',
        stateChanged: outcome.stateChanged === true,
        evidenceDigest: digest({
          resultDigest: outcome.resultDigest || null,
          errorCode: errorCode || null,
          terminalRecovery: hasTerminalRecovery(body)
        })
      },
      generationReconciliation
    }
  }
  return { terminal: null, generationReconciliation }
}

function buildNextActionEnvelope (routeStop, input = {}) {
  const required = input.required !== false
  return {
    schemaVersion: NEXT_ACTION_SCHEMA,
    devcodexCode: 'progressive-skill-route',
    hookRunId: String(input.hookRunId || ''),
    stateFingerprint: String(input.stateFingerprint || ''),
    trigger: String(input.trigger || ''),
    status: required
      ? (input.circuitOpen ? 'blocked-no-progress' : 'action-required')
      : (routeStop?.completionDisposition === 'refresh-required'
          ? 'refresh-required'
          : (routeStop?.retired === true ? 'retired' : 'complete')),
    circuitOpen: input.circuitOpen === true,
    noProgressCount: Number(input.noProgressCount || 0),
    processComplete: routeStop?.processComplete === true,
    retired: routeStop?.retired === true,
    retirementReason: routeStop?.retirementReason || null,
    completionDisposition: routeStop?.completionDisposition || null,
    businessSatisfied: routeStop?.businessSatisfied !== false,
    mustReplyCore: routeStop?.mustReplyCore || null,
    errorCode: routeStop?.errorCode || null,
    pendingStageIds: routeStop?.pendingStageIds || [],
    nextOp: routeStop?.nextOp || null,
    nextCall: routeStop?.nextCall || null,
    recovery: routeStop?.recovery || null
  }
}

function reconcileProgressiveSkillRoute (state, routeStop, input = {}) {
  routeStop = retireUnexecutableRoute(routeStop)
  const coordinator = normalizeCoordinatorState(state?.progressiveSkillRouteCoordinator)
  const trigger = String(input.trigger || '')
  const hookRunId = getHookRunId(input.payload || {})
  const fingerprint = buildRouteStateFingerprint(routeStop, {
    sessionKey: input.sessionKey || ''
  })
  const requiresBusiness = input.requireBusiness === true
  const processPending = !!routeStop?.present &&
    routeStop.retired !== true &&
    routeStop.processComplete !== true
  const businessPending = requiresBusiness && routeStop?.businessSatisfied === false
  const required = processPending || businessPending
  const expected = isExpectedRouteAction(routeStop, input.payload || {}, input.contextPost)
  const duplicate = !!hookRunId && hookRunId === coordinator.lastHookRunId &&
    fingerprint === coordinator.stateFingerprint
  const fingerprintChanged = !!coordinator.stateFingerprint &&
    coordinator.stateFingerprint !== fingerprint
  const progressObserved = fingerprintChanged
  const terminalCheck = trigger === 'Stop' || trigger === 'PreCompact'
  const attemptedExpectedAction = trigger === 'PostToolUse' && expected.expected

  if (required && coordinator.terminalFingerprint === fingerprint) {
    const terminalRoute = storedTerminalProjection(routeStop, coordinator)
    Object.assign(coordinator, {
      lastHookRunId: hookRunId || coordinator.lastHookRunId,
      lastTrigger: trigger,
      lastAction: 'terminal-replay-suppressed',
      updatedAt: new Date().toISOString()
    })
    state.progressiveSkillRouteCoordinator = coordinator
    return {
      required: false,
      allowAction: true,
      duplicate,
      noticeSuppressed: true,
      progressObserved: false,
      coordinator,
      routeStop: terminalRoute,
      envelope: buildNextActionEnvelope(terminalRoute, {
        hookRunId,
        stateFingerprint: fingerprint,
        trigger,
        noProgressCount: coordinator.noProgressCount,
        circuitOpen: coordinator.circuitOpen,
        required: false
      }),
      action: expected.action,
      message: 'Progressive Skill route terminal state already reconciled; no route instruction was replayed.'
    }
  }

  if (!required) {
    Object.assign(coordinator, {
      stateFingerprint: fingerprint,
      lastHookRunId: hookRunId || coordinator.lastHookRunId,
      noProgressCount: 0,
      circuitOpen: false,
      lastTrigger: trigger,
      lastAction: routeStop?.retired === true ? 'retired' : 'complete',
      lastNoticeFingerprint: '',
      terminalFingerprint: '',
      terminalDisposition: '',
      terminalReasonCode: '',
      terminalEvidenceDigest: '',
      generationReconciliation: null,
      updatedAt: new Date().toISOString()
    })
    state.progressiveSkillRouteCoordinator = coordinator
    return {
      required: false,
      allowAction: true,
      duplicate,
      progressObserved,
      coordinator,
      routeStop,
      envelope: buildNextActionEnvelope(routeStop, {
        hookRunId,
        stateFingerprint: fingerprint,
        trigger,
        noProgressCount: 0,
        circuitOpen: false,
        required: false
      })
    }
  }

  if (coordinator.terminalFingerprint && coordinator.terminalFingerprint !== fingerprint) {
    coordinator.terminalFingerprint = ''
    coordinator.terminalDisposition = ''
    coordinator.terminalReasonCode = ''
    coordinator.terminalEvidenceDigest = ''
  }

  let noProgressCount = coordinator.noProgressCount
  if (progressObserved) {
    noProgressCount = 0
    coordinator.progressCount += 1
  } else if (!duplicate && (terminalCheck || attemptedExpectedAction)) {
    noProgressCount = Math.min(NO_PROGRESS_LIMIT, noProgressCount + 1)
  }
  const circuitOpen = noProgressCount >= NO_PROGRESS_LIMIT
  const postToolTerminal = classifyPostToolTerminal(input, expected, progressObserved)
  const terminal = postToolTerminal.terminal || (circuitOpen
    ? {
        disposition: 'retired-no-progress',
        reasonCode: 'NO_PROGRESS_LIMIT_REACHED',
        stateChanged: false,
        evidenceDigest: digest({ fingerprint, noProgressCount, nextOp: routeStop?.nextOp || null })
      }
    : null)
  const noticeFingerprint = terminalCheck
    ? digest({
        stateFingerprint: fingerprint,
        circuitOpen,
        noProgressCount,
        nextOp: routeStop?.nextOp || null,
        errorCode: routeStop?.errorCode || null
      })
    : ''
  const noticeSuppressed = terminalCheck &&
    coordinator.lastNoticeFingerprint === noticeFingerprint
  Object.assign(coordinator, {
    stateFingerprint: fingerprint,
    lastHookRunId: hookRunId || coordinator.lastHookRunId,
    noProgressCount,
    circuitOpen,
    lastTrigger: trigger,
    lastAction: expected.expected ? 'expected-route-action' : 'blocked-unrelated-action',
    lastNoticeFingerprint: terminalCheck
      ? noticeFingerprint
      : coordinator.lastNoticeFingerprint,
    generationReconciliation: postToolTerminal.generationReconciliation ||
      coordinator.generationReconciliation,
    updatedAt: new Date().toISOString()
  })
  if (terminal) {
    const terminalRoute = terminalRouteProjection(routeStop, terminal)
    Object.assign(coordinator, {
      terminalFingerprint: fingerprint,
      terminalDisposition: terminal.disposition,
      terminalReasonCode: terminal.reasonCode,
      terminalEvidenceDigest: terminal.evidenceDigest || '',
      lastAction: terminal.disposition
    })
    state.progressiveSkillRouteCoordinator = coordinator
    return {
      required: false,
      allowAction: true,
      duplicate,
      noticeSuppressed,
      progressObserved,
      coordinator,
      routeStop: terminalRoute,
      envelope: buildNextActionEnvelope(terminalRoute, {
        hookRunId,
        stateFingerprint: fingerprint,
        trigger,
        noProgressCount,
        circuitOpen,
        required: false
      }),
      action: expected.action,
      message: terminal.disposition === 'retired-no-progress'
        ? `Progressive Skill route retired after ${noProgressCount} reconciliation attempts without durable progress.`
        : `Progressive Skill route retired with ${terminal.disposition}; the old instruction will not be replayed.`
    }
  }
  state.progressiveSkillRouteCoordinator = coordinator
  const envelope = buildNextActionEnvelope(routeStop, {
    hookRunId,
    stateFingerprint: fingerprint,
    trigger,
    noProgressCount,
    circuitOpen,
    required: true
  })
  return {
    required: true,
    allowAction: expected.expected && !businessPending,
    duplicate,
    noticeSuppressed,
    progressObserved,
    coordinator,
    routeStop,
    envelope,
    action: expected.action,
    message: `Progressive Skill route requires ${routeStop?.nextOp || 'completion'} before unrelated work. Use the exact next call in the structured recovery card.`
  }
}

module.exports = {
  BUDGET_TERMINAL_ERRORS,
  COORDINATOR_SCHEMA,
  NEXT_ACTION_SCHEMA,
  NO_PROGRESS_LIMIT,
  TERMINAL_TOOL_FAILURE_ERRORS,
  buildNextActionEnvelope,
  buildRouteStateFingerprint,
  getHookRunId,
  hasExecutableRouteAction,
  isBudgetTerminalRoute,
  isExpectedRouteAction,
  normalizeCoordinatorState,
  reconcileProgressiveSkillRoute,
  retireUnexecutableRoute,
  routeActionFromPayload
}
