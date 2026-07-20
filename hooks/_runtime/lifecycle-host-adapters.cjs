#!/usr/bin/env node
'use strict'

const path = require('path')
const { spawnSync } = require('child_process')

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
  return byToken[token] || original
}

function normalizeHostPayload(host, payload) {
  const originalEvent = String(
    payload?.hookEventName || payload?.hook_event_name || payload?.eventName || payload?.event || ''
  ).trim()
  let mappedEvent = EVENT_MAP[host]?.[originalEvent]
  if (!mappedEvent && host === 'grok') mappedEvent = mapGrokishEventName(originalEvent)
  if (!mappedEvent) mappedEvent = originalEvent
  const normalized = {
    ...(payload || {}),
    hookEventName: mappedEvent,
    hook_event_name: mappedEvent,
    devcodexHostSurface: host,
    devcodexHostEventName: originalEvent
  }
  // Grok payload uses toolName/toolInput; lifecycle also accepts tool_name/tool_input.
  if (host === 'grok') {
    if (normalized.toolName && !normalized.tool_name) normalized.tool_name = normalized.toolName
    if (normalized.toolInput && !normalized.tool_input) normalized.tool_input = normalized.toolInput
  }
  if (host === 'gemini' && typeof payload?.prompt_response === 'string') normalized.response = payload.prompt_response
  return { originalEvent, mappedEvent, payload: normalized }
}

function normalizeEventToken(eventName) {
  return String(eventName || '').trim().toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Grok Build official PreToolUse contract:
 *   allow → { "decision": "allow" }
 *   deny  → { "decision": "deny", "reason": "..." }
 * PassivePassive events ignore stdout; never emit blocking decisions there.
 * @see ~/.grok/docs/user-guide/10-hooks.md
 */
function adaptGrokOutput(originalEvent, output) {
  const value = output && typeof output === 'object' && !Array.isArray(output) ? { ...output } : { continue: true }
  if (value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object') {
    value.hookSpecificOutput = { ...value.hookSpecificOutput, hookEventName: originalEvent }
  }

  const event = normalizeEventToken(originalEvent)
  const isPreTool = event === 'pretooluse'
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

  // PassivePassive events (UserPromptSubmit, Stop, PreCompact, …): stdout is ignored for model
  // context. Strip hard-block decisions so we never pretend inject/block worked.
  const next = { ...value, continue: true }
  delete next.decision
  if (next.hookSpecificOutput && typeof next.hookSpecificOutput === 'object') {
    const hso = { ...next.hookSpecificOutput }
    delete hso.permissionDecision
    delete hso.permissionDecisionReason
    // Keep systemMessage/additionalContext only as possible UI annotations; do not claim injection.
    next.hookSpecificOutput = hso
    next.devcodexGrokEvidenceMode = 'passive-hook-no-context-injection'
  } else {
    next.devcodexGrokEvidenceMode = 'passive-hook-no-context-injection'
  }
  return next
}

function adaptHostOutput(host, originalEvent, output) {
  const value = output && typeof output === 'object' && !Array.isArray(output) ? { ...output } : { continue: true }
  if (value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object') {
    value.hookSpecificOutput = { ...value.hookSpecificOutput, hookEventName: originalEvent }
  }
  if (host === 'grok') {
    return adaptGrokOutput(originalEvent, value)
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
  const normalized = normalizeHostPayload(host, input)
  const lifecycle = options.lifecycle || path.join(__dirname, 'lifecycle.cjs')
  const child = spawnSync(process.execPath, [lifecycle], {
    input: JSON.stringify(normalized.payload),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, DEVCODEX_HOST_PLATFORM: host }
  })
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

if (require.main === module) {
  const host = String(process.argv[2] || '').trim().toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(EVENT_MAP, host)) {
    process.stderr.write(`Unsupported DevCodex host adapter: ${host || '(missing)'}\n`)
    process.exit(2)
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
  adaptHostOutput,
  adaptGrokOutput,
  normalizeHostPayload,
  runHostAdapter
}
