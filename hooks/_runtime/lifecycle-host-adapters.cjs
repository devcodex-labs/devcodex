#!/usr/bin/env node
'use strict'

const path = require('path')
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
  // Grok and Copilot camelCase payloads are normalized to the lifecycle field names.
  if (host === 'grok' || host === 'copilot') {
    if (normalized.toolName && !normalized.tool_name) normalized.tool_name = normalized.toolName
    if (normalized.toolInput && !normalized.tool_input) normalized.tool_input = normalized.toolInput
    if (normalized.toolArgs && !normalized.tool_input) normalized.tool_input = normalized.toolArgs
  }
  if (host === 'copilot') {
    if (normalized.sessionId && !normalized.session_id) normalized.session_id = normalized.sessionId
    if (normalized.transcriptPath && !normalized.transcript_path) normalized.transcript_path = normalized.transcriptPath
    if (normalized.stopReason && !normalized.stop_reason) normalized.stop_reason = normalized.stopReason
    if (normalized.toolResult && !normalized.tool_result) normalized.tool_result = normalized.toolResult
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

function adaptCopilotOutput(originalEvent, output) {
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

function adaptHostOutput(host, originalEvent, output) {
  const value = output && typeof output === 'object' && !Array.isArray(output) ? { ...output } : { continue: true }
  if (value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object') {
    value.hookSpecificOutput = { ...value.hookSpecificOutput, hookEventName: originalEvent }
  }
  if (host === 'grok') {
    return adaptGrokOutput(originalEvent, value)
  }
  if (host === 'copilot') {
    return adaptCopilotOutput(originalEvent, value)
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
  // Grok imports ~/.claude/settings.json hooks by default and invokes them with
  // camelCase payload keys plus Grok event values. Its dedicated DevCodex plugin
  // owns the lifecycle, so the imported Claude copy must not execute it twice.
  if (isGrokImportedClaudePayload(host, input, normalized.originalEvent)) {
    return {
      status: 0,
      error: '',
      output: {
        continue: true,
        devcodexCompatibilityBypass: 'grok-imported-claude-hook'
      }
    }
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
  const child = spawn(process.execPath, [lifecycle], {
    input: JSON.stringify(normalized.payload),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
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
  return { status: 0, error: '', output: adaptHostOutput(host, normalized.originalEvent, output) }
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
  adaptCopilotOutput,
  adaptHostOutput,
  adaptGrokOutput,
  isGrokImportedClaudePayload,
  normalizeHostPayload,
  probeHostAdapterContract,
  runHostAdapter
}
