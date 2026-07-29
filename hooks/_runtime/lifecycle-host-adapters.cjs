#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const CLAUDE_EVENT_MAP = Object.freeze({
  PreToolUse: 'PreToolUse',
  UserPromptSubmit: 'UserPromptSubmit',
  PostToolUse: 'PostToolUse',
  Stop: 'Stop'
})

const CODEX_EVENT_MAP = Object.freeze({
  PreToolUse: 'PreToolUse',
  UserPromptSubmit: 'UserPromptSubmit',
  PostToolUse: 'PostToolUse',
  PreCompact: 'PreCompact',
  Stop: 'Stop'
})

const COPILOT_EVENT_MAP = Object.freeze({
  userPromptTransformed: 'UserPromptSubmit',
  userPromptSubmitted: 'UserPromptSubmit',
  UserPromptSubmit: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  PreToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  PostToolUse: 'PostToolUse',
  agentStop: 'Stop',
  Stop: 'Stop',
  preCompact: 'PreCompact',
  PreCompact: 'PreCompact'
})

// Grok Build docs use snake_case hookEventName (e.g. pre_tool_use). Lifecycle compares PascalCase.
const GROK_EVENT_MAP = Object.freeze({
  pre_tool_use: 'PreToolUse',
  PreToolUse: 'PreToolUse',
  post_tool_use: 'PostToolUse',
  PostToolUse: 'PostToolUse',
  post_tool_use_failure: 'PostToolUse',
  user_prompt_submit: 'UserPromptSubmit',
  UserPromptSubmit: 'UserPromptSubmit',
  session_start: 'SessionStart',
  SessionStart: 'SessionStart',
  session_end: 'SessionEnd',
  SessionEnd: 'SessionEnd',
  stop: 'Stop',
  Stop: 'Stop',
  stop_failure: 'Stop',
  pre_compact: 'PreCompact',
  PreCompact: 'PreCompact',
  post_compact: 'PostCompact',
  PostCompact: 'PostCompact',
  subagent_start: 'SubagentStart',
  SubagentStart: 'SubagentStart',
  subagent_stop: 'SubagentStop',
  SubagentStop: 'SubagentStop',
  subagent_end: 'SubagentStop',
  notification: 'Notification',
  Notification: 'Notification',
  permission_denied: 'PermissionDenied'
})

const EVENT_MAP = Object.freeze({
  copilot: COPILOT_EVENT_MAP,
  claude: CLAUDE_EVENT_MAP,
  codex: CODEX_EVENT_MAP,
  gemini: Object.freeze({
    BeforeAgent: 'UserPromptSubmit',
    AfterAgent: 'Stop',
    PreCompress: 'PreCompact',
    BeforeTool: 'PreToolUse',
    AfterTool: 'PostToolUse'
  }),
  grok: GROK_EVENT_MAP
})

function adapterTracePath(env = process.env) {
  const raw = String(env.DEVCODEX_LIFECYCLE_TRACE || '').trim()
  if (!raw) return ''
  const target = path.resolve(raw)
  const workspaceRoot = String(env.DEVCODEX_WORKSPACE_ROOT || '').trim()
  if (!workspaceRoot) return ''
  const relative = path.relative(path.resolve(workspaceRoot), target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return ''
  return target
}

function lifecycleStateTraceSummary(env = process.env) {
  const workspaceRoot = String(env.DEVCODEX_WORKSPACE_ROOT || '').trim()
  if (!workspaceRoot) return null
  const namespaceRoot = path.join(path.resolve(workspaceRoot), '.devcodex')
  if (!fs.existsSync(namespaceRoot)) return null
  const candidates = []
  for (const projectEntry of fs.readdirSync(namespaceRoot, { withFileTypes: true }).slice(0, 32)) {
    if (!projectEntry.isDirectory()) continue
    const hooksRoot = path.join(namespaceRoot, projectEntry.name, '.memory', 'hooks')
    if (!fs.existsSync(hooksRoot)) continue
    for (const hookEntry of fs.readdirSync(hooksRoot, { withFileTypes: true }).slice(0, 32)) {
      if (!hookEntry.isDirectory()) continue
      const file = path.join(hooksRoot, hookEntry.name, 'lifecycle-state.json')
      if (fs.existsSync(file)) {
        candidates.push({
          file,
          workspaceMeta: projectEntry.name.toLowerCase() === 'workspace'
        })
      }
    }
  }
  if (!candidates.length) return null
  const expectedEpoch = String(env.DEVCODEX_CONTEXT_EPOCH || '').trim()
  const parsedCandidates = candidates.map(candidate => ({
    ...candidate,
    state: JSON.parse(fs.readFileSync(candidate.file, 'utf8')),
    mtimeMs: fs.statSync(candidate.file).mtimeMs
  }))
  const selected = parsedCandidates.sort((left, right) => {
    const leftEpochMatch = left.state.contextAcquisition?.contextEpoch === expectedEpoch ? 1 : 0
    const rightEpochMatch = right.state.contextAcquisition?.contextEpoch === expectedEpoch ? 1 : 0
    if (leftEpochMatch !== rightEpochMatch) return rightEpochMatch - leftEpochMatch
    if (left.workspaceMeta !== right.workspaceMeta) return left.workspaceMeta ? 1 : -1
    return right.mtimeMs - left.mtimeMs
  })[0]
  const file = selected.file
  const state = selected.state
  const acquisition = state.contextAcquisition || {}
  const receipt = acquisition.receipt || {}
  return {
    file: path.relative(path.resolve(workspaceRoot), file).replace(/\\/g, '/'),
    activeProject: state.activeProject || null,
    project: acquisition.project || state.activeProject || null,
    contextEpoch: acquisition.contextEpoch || null,
    planId: acquisition.plan?.planId || null,
    receiptStatus: receipt.status || null,
    satisfiedSourceIds: receipt.satisfiedSourceIds || [],
    missingSourceIds: receipt.missingSourceIds || [],
    inFlight: (acquisition.inFlight || []).map(item => ({
      canonical: item.canonical,
      toolCallId: item.toolCallId
    })),
    postHistory: (acquisition.postHistory || []).slice(-8).map(item => ({
      canonical: item.canonical,
      toolCallId: item.toolCallId,
      outcome: item.outcome
    })),
    lastError: acquisition.lastError || receipt.lastError || null
  }
}

function appendAdapterTrace(host, phase, input, normalized, result, env = process.env) {
  const target = adapterTracePath(env)
  if (!target) return
  try {
    const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const normalizedPayload = normalized?.payload &&
      typeof normalized.payload === 'object' &&
      !Array.isArray(normalized.payload)
      ? normalized.payload
      : {}
    const toolInput = payload.toolInput || payload.tool_input || payload.toolArgs || {}
    const toolResult = payload.toolResult || payload.tool_result || payload.toolResponse || payload.tool_response || {}
    const normalizedToolInput = normalizedPayload.tool_input || normalizedPayload.toolInput || {}
    const normalizedToolResult = normalizedPayload.tool_result || normalizedPayload.toolResult || {}
    const entry = {
      schemaVersion: 'LifecycleHostAdapterTraceV1',
      observedAt: new Date().toISOString(),
      host,
      phase,
      originalEvent: normalized?.originalEvent || null,
      mappedEvent: normalized?.mappedEvent || null,
      payloadKeys: Object.keys(payload).sort().slice(0, 64),
      adapterCwd: process.cwd(),
      payloadCwd: String(payload.cwd || payload.workingDirectory || ''),
      promptPreview: String(
        payload.prompt || payload.userPrompt || payload.user_prompt || ''
      ).slice(0, 512),
      toolName: String(payload.toolName || payload.tool_name || ''),
      toolUseId: String(payload.toolUseId || payload.tool_use_id || ''),
      normalizedToolCallId: String(
        normalizedPayload.tool_call_id || normalizedPayload.toolCallId || ''
      ),
      toolInputKeys: toolInput && typeof toolInput === 'object'
        ? Object.keys(toolInput).sort().slice(0, 64)
        : [],
      normalizedToolInputDigest: crypto.createHash('sha256')
        .update(JSON.stringify(stableJsonValue(normalizedToolInput)))
        .digest('hex'),
      normalizedToolInputPreview: JSON.stringify(stableJsonValue(normalizedToolInput)).slice(0, 1024),
      dispatchedServer: String(
        toolInput?.server || toolInput?.serverName || toolInput?.server_name || ''
      ),
      dispatchedTool: String(
        toolInput?.tool || toolInput?.toolName || toolInput?.tool_name || toolInput?.name || ''
      ),
      toolResultKeys: toolResult && typeof toolResult === 'object'
        ? Object.keys(toolResult).sort().slice(0, 64)
        : [],
      normalizedToolResultPreview: (() => {
        const value = typeof normalizedToolResult === 'string'
          ? normalizedToolResult
          : JSON.stringify(normalizedToolResult)
        return String(value || '').slice(0, 512)
      })(),
      status: result?.status ?? null,
      outputKeys: result?.output && typeof result.output === 'object'
        ? Object.keys(result.output).sort().slice(0, 32)
        : [],
      lifecycleState: phase === 'output' ? lifecycleStateTraceSummary(env) : null
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const prior = fs.existsSync(target)
      ? fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean).slice(-127)
      : []
    fs.writeFileSync(target, `${[...prior, JSON.stringify(entry)].join('\n')}\n`, 'utf8')
  } catch {
    // Diagnostics are opt-in and must never change Hook enforcement.
  }
}

function mapGrokishEventName(raw) {
  const original = String(raw || '').trim()
  if (!original) return ''
  if (GROK_EVENT_MAP[original]) return GROK_EVENT_MAP[original]
  const token = original.toLowerCase().replace(/[^a-z]/g, '')
  const byToken = {
    pretooluse: 'PreToolUse',
    posttooluse: 'PostToolUse',
    posttoolusefailure: 'PostToolUse',
    userpromptsubmit: 'UserPromptSubmit',
    sessionstart: 'SessionStart',
    sessionend: 'SessionEnd',
    stop: 'Stop',
    stopfailure: 'Stop',
    precompact: 'PreCompact',
    postcompact: 'PostCompact',
    subagentstart: 'SubagentStart',
    subagentstop: 'SubagentStop',
    subagentend: 'SubagentStop',
    notification: 'Notification',
    permissiondenied: 'PermissionDenied'
  }
  return byToken[token] || ''
}

function parseToolInputEnvelope(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableJsonValue(value[key])])
  )
}

function copilotToolCallId(payload) {
  const material = JSON.stringify(stableJsonValue({
    sessionId: payload.session_id || payload.sessionId || '',
    toolName: payload.tool_name || payload.toolName || '',
    toolInput: payload.tool_input || payload.toolInput || {}
  }))
  return `copilot-${crypto.createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

function normalizeGrokToolResult(value) {
  const output = value && typeof value === 'object' && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'output')
    ? value.output
    : value
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output
  if (Object.prototype.hasOwnProperty.call(output, 'OkayOutput')) {
    return output.OkayOutput
  }
  if (Object.prototype.hasOwnProperty.call(output, 'ErrorOutput')) {
    return {
      success: false,
      error: output.ErrorOutput
    }
  }
  return output
}

function normalizeHostPayload(host, payload) {
  const originalEvent = String(
    payload?.hookEventName || payload?.hook_event_name || payload?.eventName || payload?.event || ''
  ).trim()
  let mappedEvent = EVENT_MAP[host]?.[originalEvent]
  if (!mappedEvent && host === 'grok') mappedEvent = mapGrokishEventName(originalEvent)
  const normalized = {
    ...(payload || {}),
    hookEventName: mappedEvent,
    hook_event_name: mappedEvent,
    devcodexHostSurface: host,
    devcodexHostEventName: originalEvent
  }
  if (normalized.toolResponse !== undefined && normalized.tool_result === undefined) {
    normalized.tool_result = normalized.toolResponse
  }
  if (normalized.tool_response !== undefined && normalized.tool_result === undefined) {
    normalized.tool_result = normalized.tool_response
  }
  // Grok and Copilot camelCase payloads are normalized to the lifecycle field names.
  if (host === 'grok' || host === 'copilot') {
    if (normalized.toolName && !normalized.tool_name) normalized.tool_name = normalized.toolName
    if (normalized.toolInput && !normalized.tool_input) normalized.tool_input = normalized.toolInput
    if (normalized.toolArgs && !normalized.tool_input) normalized.tool_input = normalized.toolArgs
  }
  if (host === 'grok') {
    const envelope = normalized.tool_input
    const envelopeName = envelope && typeof envelope === 'object'
      ? String(envelope.tool_name || envelope.toolName || '')
      : ''
    if (
      envelopeName &&
      envelopeName === String(normalized.tool_name || '') &&
      Object.prototype.hasOwnProperty.call(envelope, 'tool_input')
    ) {
      const inner = parseToolInputEnvelope(envelope.tool_input)
      if (inner) {
        normalized.tool_input = inner
        normalized.toolInput = inner
      }
    }
    if (normalized.toolResult && !normalized.tool_result) {
      normalized.tool_result = normalizeGrokToolResult(normalized.toolResult)
    }
  }
  if (host === 'copilot') {
    if (normalized.sessionId && !normalized.session_id) normalized.session_id = normalized.sessionId
    if (normalized.transcriptPath && !normalized.transcript_path) normalized.transcript_path = normalized.transcriptPath
    if (normalized.stopReason && !normalized.stop_reason) normalized.stop_reason = normalized.stopReason
    if (typeof normalized.tool_input === 'string') {
      normalized.tool_input = parseToolInputEnvelope(normalized.tool_input) || normalized.tool_input
    }
    if (!normalized.tool_call_id && !normalized.toolCallId) {
      normalized.tool_call_id = copilotToolCallId(normalized)
      normalized.toolCallId = normalized.tool_call_id
    }
    if (normalized.toolResult && !normalized.tool_result) {
      const result = normalized.toolResult
      normalized.tool_result = typeof result.textResultForLlm === 'string'
        ? {
            success: result.resultType === 'success',
            result: result.textResultForLlm,
            ...(result.resultType === 'success'
              ? {}
              : { error: result.textResultForLlm || 'Copilot tool call failed.' })
          }
        : result
    }
    const continuationPrompts = [
      normalized.prompt,
      normalized.transformedPrompt,
      normalized.transformed_prompt
    ]
    if ((originalEvent === 'userPromptSubmitted' ||
         originalEvent === 'userPromptTransformed') &&
        continuationPrompts.some(value =>
          /^Progressive Skill route is incomplete:/i.test(String(value || '').trim())
        )) {
      normalized.devcodex_host_continuation = true
    }
    if (originalEvent === 'userPromptTransformed') {
      normalized.devcodex_host_transform_only = true
    }
  }
  if (host === 'gemini' && typeof payload?.prompt_response === 'string') normalized.response = payload.prompt_response
  return { originalEvent, mappedEvent, payload: normalized }
}

function normalizeEventToken(eventName) {
  return String(eventName || '').trim().toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Detect a DevCodex Claude hook invoked through Grok's Claude compatibility scanner.
 * The dedicated Grok plugin owns lifecycle execution, so this imported copy must no-op.
 *
 * @param {string} host
 * @param {object} payload
 * @param {string} originalEvent
 * @returns {boolean}
 */
function isGrokImportedClaudePayload(host, payload, originalEvent) {
  return host === 'claude'
    && typeof payload?.hookEventName === 'string'
    && typeof payload?.hook_event_name !== 'string'
    && !CLAUDE_EVENT_MAP[originalEvent]
    && Boolean(mapGrokishEventName(originalEvent))
}

/**
 * Grok Build official contracts (see ~/.grok/docs/user-guide/10-hooks.md):
 *   PreToolUse allow/deny → { "decision": "allow"|"deny", "reason"? }
 *   Stop/SubagentStop block → { "decision": "block", "reason": "..." } (fed back to model)
 * UserPromptSubmit / other non-tool events: do not claim context inject; strip hard deny there.
 */
function adaptGrokOutput(originalEvent, output) {
  const value = output && typeof output === 'object' && !Array.isArray(output) ? { ...output } : { continue: true }
  if (value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object') {
    value.hookSpecificOutput = { ...value.hookSpecificOutput, hookEventName: originalEvent }
  }

  const event = normalizeEventToken(originalEvent)
  const isPreTool = event === 'pretooluse'
  const isStop = event === 'stop' || event === 'subagentstop' || event === 'agentstop'
  const permission = value.hookSpecificOutput?.permissionDecision
  const reason = value.reason
    || value.hookSpecificOutput?.permissionDecisionReason
    || (typeof value.hookSpecificOutput?.additionalContext === 'string' ? value.hookSpecificOutput.additionalContext : '')
    || 'DevCodex denied this tool call.'
  const wantsDeny = permission === 'deny' || value.decision === 'deny' || value.decision === 'block'
  const wantsAllow = permission === 'allow' || value.decision === 'allow'

  if (isPreTool) {
    if (wantsDeny) {
      return Object.freeze({ decision: 'deny', reason: String(reason) })
    }
    if (wantsAllow) {
      return Object.freeze({ decision: 'allow' })
    }
    // noop / continue-only: Grok treats exit 0 as allow; keep minimal shape.
    if (value.continue === true || value.continue === undefined) {
      return Object.freeze({ decision: 'allow' })
    }
    return value
  }

  // Stop Decision Control: preserve block so incomplete closure can force another turn.
  if (isStop) {
    if (value.decision === 'block' || value.decision === 'deny') {
      return Object.freeze({
        decision: 'block',
        reason: String(reason || 'DevCodex requires another agent turn.'),
        devcodexGrokEvidenceMode: 'stop-decision-block'
      })
    }
    if (value.decision === 'allow') {
      return Object.freeze({ decision: 'allow', devcodexGrokEvidenceMode: 'stop-decision-allow' })
    }
    // Soft reminder only
    const soft = { continue: true, devcodexGrokEvidenceMode: 'stop-soft' }
    if (value.systemMessage) soft.systemMessage = value.systemMessage
    if (value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object') {
      soft.hookSpecificOutput = { ...value.hookSpecificOutput }
    }
    return Object.freeze(soft)
  }

  // Other non-tool events: do not claim UPS inject / hard-block parity.
  const next = { ...value, continue: true }
  delete next.decision
  if (next.hookSpecificOutput && typeof next.hookSpecificOutput === 'object') {
    const hso = { ...next.hookSpecificOutput }
    delete hso.permissionDecision
    delete hso.permissionDecisionReason
    next.hookSpecificOutput = hso
    next.devcodexGrokEvidenceMode = 'passive-hook-no-context-injection'
  } else {
    next.devcodexGrokEvidenceMode = 'passive-hook-no-context-injection'
  }
  return next
}

function adaptCopilotOutput(originalEvent, output, input = {}) {
  const value = output && typeof output === 'object' && !Array.isArray(output) ? { ...output } : {}
  const event = normalizeEventToken(originalEvent)
  const specific = value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object'
    ? value.hookSpecificOutput
    : {}

  if (event === 'pretooluse') {
    const permission = specific.permissionDecision || value.permissionDecision
    if (!['allow', 'deny', 'ask'].includes(permission)) return {}
    return {
      permissionDecision: permission,
      ...(permission === 'deny'
        ? {
            permissionDecisionReason: String(
              specific.permissionDecisionReason ||
              value.permissionDecisionReason ||
              value.reason ||
              'DevCodex denied this tool call.'
            )
          }
        : {}),
      ...(value.modifiedArgs && typeof value.modifiedArgs === 'object'
        ? { modifiedArgs: value.modifiedArgs }
        : {})
    }
  }

  if (event === 'posttooluse') {
    const additionalContext = specific.additionalContext || value.additionalContext
    return {
      ...(typeof additionalContext === 'string' && additionalContext
        ? { additionalContext }
        : {}),
      ...(value.modifiedResult && typeof value.modifiedResult === 'object'
        ? { modifiedResult: value.modifiedResult }
        : {})
    }
  }

  if (event === 'userprompttransformed') {
    const additionalContext = [
      value.systemMessage,
      specific.additionalContext,
      value.additionalContext
    ].filter(item => typeof item === 'string' && item.trim()).join('\n\n')
    const transformedPrompt = String(
      input.transformedPrompt || input.transformed_prompt || input.prompt || ''
    )
    return additionalContext
      ? {
          modifiedTransformedPrompt: [transformedPrompt, additionalContext]
            .filter(Boolean)
            .join('\n\n')
        }
      : {}
  }

  if (event === 'agentstop' || event === 'stop') {
    if (value.decision === 'block') {
      return {
        decision: 'block',
        reason: String(value.reason || 'DevCodex requires another agent turn.')
      }
    }
    return value.decision === 'allow' ? { decision: 'allow' } : {}
  }

  // userPromptSubmitted and preCompact are notification-only in Copilot CLI.
  return {}
}

function adaptHostOutput(host, originalEvent, output, input = {}) {
  const value = output && typeof output === 'object' && !Array.isArray(output) ? { ...output } : { continue: true }
  if (value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object') {
    value.hookSpecificOutput = { ...value.hookSpecificOutput, hookEventName: originalEvent }
  }
  if (host === 'grok') {
    return adaptGrokOutput(originalEvent, value)
  }
  if (host === 'copilot') {
    return adaptCopilotOutput(originalEvent, value, input)
  }
  if (host !== 'gemini') return value

  if (value.decision === 'block') value.decision = 'deny'
  const permission = value.hookSpecificOutput?.permissionDecision
  if (permission) {
    value.decision = permission === 'deny' ? 'deny' : 'allow'
    if (value.hookSpecificOutput.permissionDecisionReason && !value.reason) {
      value.reason = value.hookSpecificOutput.permissionDecisionReason
    }
    const nextSpecific = { ...value.hookSpecificOutput }
    delete nextSpecific.permissionDecision
    delete nextSpecific.permissionDecisionReason
    value.hookSpecificOutput = nextSpecific
  }
  if (originalEvent === 'PreCompress') {
    delete value.decision
    delete value.reason
    value.continue = true
  }
  return value
}

function runHostAdapter(host, input, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(EVENT_MAP, host)) {
    return { status: 2, error: `Unsupported DevCodex host adapter: ${host || '(missing)'}`, output: null }
  }
  const normalized = normalizeHostPayload(host, input)
  appendAdapterTrace(host, 'input', input, normalized, null, options.env || process.env)
  // Grok imports ~/.claude/settings.json hooks by default and invokes them with
  // camelCase payload keys plus Grok event values. Its dedicated DevCodex plugin
  // owns the lifecycle, so the imported Claude copy must not execute it twice.
  if (isGrokImportedClaudePayload(host, input, normalized.originalEvent)) {
    const bypass = {
      status: 0,
      error: '',
      output: {
        continue: true,
        devcodexCompatibilityBypass: 'grok-imported-claude-hook'
      }
    }
    appendAdapterTrace(host, 'output', input, normalized, bypass, options.env || process.env)
    return bypass
  }
  if (!normalized.originalEvent || !normalized.mappedEvent) {
    return {
      status: 2,
      error: `Unsupported ${host} hook event: ${normalized.originalEvent || '(missing)'}`,
      output: null
    }
  }
  const lifecycle = options.lifecycle || path.join(__dirname, 'lifecycle.cjs')
  const spawn = options.spawnSync || spawnSync
  const payloadCwd = String(input?.cwd || input?.workingDirectory || '').trim()
  const lifecycleCwd = (() => {
    if (!payloadCwd) return undefined
    try {
      return fs.statSync(payloadCwd).isDirectory() ? path.resolve(payloadCwd) : undefined
    } catch {
      return undefined
    }
  })()
  const child = spawn(process.execPath, [lifecycle], {
    input: JSON.stringify(normalized.payload),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    ...(lifecycleCwd ? { cwd: lifecycleCwd } : {}),
    env: { ...(options.env || process.env), DEVCODEX_HOST_PLATFORM: host }
  })
  if (child.error) {
    return {
      status: 1,
      error: `lifecycle spawn failed: ${child.error.code || child.error.message}`,
      output: null
    }
  }
  if (child.status !== 0) {
    const error = String(child.stderr || child.stdout || `lifecycle exited ${child.status}`).trim()
    return { status: child.status || 1, error, output: null }
  }
  let output
  try { output = child.stdout.trim() ? JSON.parse(child.stdout) : { continue: true } } catch (error) {
    return { status: 1, error: `invalid lifecycle output: ${error.message}`, output: null }
  }
  const result = {
    status: 0,
    error: '',
    output: adaptHostOutput(host, normalized.originalEvent, output, input)
  }
  appendAdapterTrace(host, 'output', input, normalized, result, options.env || process.env)
  return result
}

function probeHostAdapterContract(host) {
  if (!Object.prototype.hasOwnProperty.call(EVENT_MAP, host)) {
    return {
      schemaVersion: 'HostLifecycleAdapterContractProbeV1',
      host,
      status: 'failed',
      errorCode: 'HOST_ADAPTER_UNSUPPORTED',
      events: []
    }
  }
  const events = Object.keys(EVENT_MAP[host]).map(originalEvent => {
    const normalized = normalizeHostPayload(host, { hookEventName: originalEvent })
    const output = adaptHostOutput(host, originalEvent, { continue: true })
    return {
      originalEvent,
      mappedEvent: normalized.mappedEvent,
      outputShape: output && typeof output === 'object' && !Array.isArray(output) ? 'object' : 'invalid'
    }
  })
  const passed = events.length > 0 && events.every(event => event.mappedEvent && event.outputShape === 'object')
  return {
    schemaVersion: 'HostLifecycleAdapterContractProbeV1',
    host,
    status: passed ? 'passed' : 'failed',
    errorCode: passed ? null : 'HOST_ADAPTER_CONTRACT_FAILED',
    events
  }
}

function applyCliEnvironmentOverrides (argv, env = process.env) {
  const authorityIndex = argv.indexOf('--skill-route-probe-authority')
  if (authorityIndex >= 0 && argv[authorityIndex + 1]) {
    env.DEVCODEX_SKILL_ROUTE_PROBE_AUTHORITY = path.resolve(argv[authorityIndex + 1])
  }
  const routeTraceIndex = argv.indexOf('--skill-route-trace')
  if (routeTraceIndex >= 0 && argv[routeTraceIndex + 1]) {
    env.DEVCODEX_SKILL_ROUTE_TRACE = path.resolve(argv[routeTraceIndex + 1])
  }
  const lifecycleTraceIndex = argv.indexOf('--lifecycle-trace')
  if (lifecycleTraceIndex >= 0 && argv[lifecycleTraceIndex + 1]) {
    env.DEVCODEX_LIFECYCLE_TRACE = path.resolve(argv[lifecycleTraceIndex + 1])
  }
  const workspaceRootIndex = argv.indexOf('--workspace-root')
  if (workspaceRootIndex >= 0 && argv[workspaceRootIndex + 1]) {
    env.DEVCODEX_WORKSPACE_ROOT = path.resolve(argv[workspaceRootIndex + 1])
  }
  const contextEpochIndex = argv.indexOf('--context-epoch')
  if (contextEpochIndex >= 0 && argv[contextEpochIndex + 1]) {
    env.DEVCODEX_CONTEXT_EPOCH = String(argv[contextEpochIndex + 1]).trim()
    env.DEVCODEX_CONTEXT_EPOCH_SOURCE = 'host-adapter-cli'
  }
  const eventIndex = argv.indexOf('--event')
  if (eventIndex >= 0 && argv[eventIndex + 1]) {
    env.DEVCODEX_HOST_EVENT = String(argv[eventIndex + 1]).trim()
  }
  return env
}

if (require.main === module) {
  const host = String(process.argv[2] || '').trim().toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(EVENT_MAP, host)) {
    process.stderr.write(`Unsupported DevCodex host adapter: ${host || '(missing)'}\n`)
    process.exit(2)
  }
  if (process.argv[3] === '--contract-probe') {
    const probe = probeHostAdapterContract(host)
    process.stdout.write(JSON.stringify(probe))
    process.exit(probe.status === 'passed' ? 0 : 1)
  }
  applyCliEnvironmentOverrides(process.argv.slice(3))
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { input += chunk })
  process.stdin.on('end', () => {
    let payload
    try { payload = input.trim() ? JSON.parse(input) : {} } catch (error) {
      process.stderr.write(`Invalid host hook payload: ${error.message}\n`)
      process.exit(2)
      return
    }
    if (!payload.hookEventName && !payload.hook_event_name &&
        process.env.DEVCODEX_HOST_EVENT) {
      payload.hookEventName = process.env.DEVCODEX_HOST_EVENT
    }
    const result = runHostAdapter(host, payload)
    if (result.status !== 0) {
      process.stderr.write(`${result.error}\n`)
      process.exit(result.status)
      return
    }
    process.stdout.write(JSON.stringify(result.output))
  })
}

module.exports = {
  EVENT_MAP,
  applyCliEnvironmentOverrides,
  adaptCopilotOutput,
  adaptHostOutput,
  adaptGrokOutput,
  isGrokImportedClaudePayload,
  normalizeHostPayload,
  probeHostAdapterContract,
  runHostAdapter
}
