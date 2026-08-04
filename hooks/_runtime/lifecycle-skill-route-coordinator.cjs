'use strict'

const crypto = require('crypto')

const COORDINATOR_SCHEMA = 'ActiveReconciliationCoordinatorV1'
const NEXT_ACTION_SCHEMA = 'NextActionEnvelopeV1'
const NO_PROGRESS_LIMIT = 3

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
    stageId: firstString(nested.stageId, input.stageId)
  }
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

function normalizeCoordinatorState (value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    schemaVersion: COORDINATOR_SCHEMA,
    stateFingerprint: String(source.stateFingerprint || ''),
    lastHookRunId: String(source.lastHookRunId || ''),
    noProgressCount: Math.max(0, Number(source.noProgressCount || 0)),
    progressCount: Math.max(0, Number(source.progressCount || 0)),
    circuitOpen: source.circuitOpen === true,
    lastTrigger: String(source.lastTrigger || ''),
    lastAction: String(source.lastAction || ''),
    lastNoticeFingerprint: String(source.lastNoticeFingerprint || ''),
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
  if (routeStop.errorCode === 'PLAN_NOT_COMMITTED' &&
      action.tool === 'skill_route' && ['catalog', 'commit', 'status'].includes(action.op)) {
    return { expected: true, action }
  }
  if (action.tool === 'skill_route' && action.op === 'status') {
    return { expected: true, action }
  }
  return { expected: false, action }
}

function hasExecutableRouteAction (routeStop) {
  if (!routeStop || routeStop.complete === true || routeStop.retired === true) return false
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

  if (!required) {
    Object.assign(coordinator, {
      stateFingerprint: fingerprint,
      lastHookRunId: hookRunId || coordinator.lastHookRunId,
      noProgressCount: 0,
      circuitOpen: false,
      lastTrigger: trigger,
      lastAction: routeStop?.retired === true ? 'retired' : 'complete',
      lastNoticeFingerprint: '',
      updatedAt: new Date().toISOString()
    })
    state.progressiveSkillRouteCoordinator = coordinator
    return {
      required: false,
      allowAction: true,
      duplicate,
      progressObserved,
      coordinator,
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

  let noProgressCount = coordinator.noProgressCount
  if (progressObserved) {
    noProgressCount = 0
    coordinator.progressCount += 1
  } else if (!duplicate && (terminalCheck || attemptedExpectedAction)) {
    noProgressCount = Math.min(NO_PROGRESS_LIMIT, noProgressCount + 1)
  }
  const circuitOpen = noProgressCount >= NO_PROGRESS_LIMIT
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
    updatedAt: new Date().toISOString()
  })
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
    envelope,
    action: expected.action,
    message: circuitOpen
      ? `Progressive Skill route made no durable progress after ${noProgressCount} reconciliation attempts. Execute the exact actionable field in this NextActionEnvelopeV1; do not replay an older hook instruction.`
      : `Progressive Skill route requires ${routeStop?.nextOp || 'completion'} before unrelated work. Use the exact NextActionEnvelopeV1 below.`
  }
}

module.exports = {
  COORDINATOR_SCHEMA,
  NEXT_ACTION_SCHEMA,
  NO_PROGRESS_LIMIT,
  buildNextActionEnvelope,
  buildRouteStateFingerprint,
  getHookRunId,
  hasExecutableRouteAction,
  isExpectedRouteAction,
  normalizeCoordinatorState,
  reconcileProgressiveSkillRoute,
  retireUnexecutableRoute,
  routeActionFromPayload
}
