#!/usr/bin/env node
'use strict'

const path = require('path')
const { spawnSync } = require('child_process')

const EVENT_MAP = Object.freeze({
  gemini: Object.freeze({
    BeforeAgent: 'UserPromptSubmit',
    AfterAgent: 'Stop',
    PreCompress: 'PreCompact',
    BeforeTool: 'PreToolUse',
    AfterTool: 'PostToolUse'
  }),
  grok: Object.freeze({})
})

function normalizeHostPayload(host, payload) {
  const originalEvent = String(
    payload?.hookEventName || payload?.hook_event_name || payload?.eventName || payload?.event || ''
  ).trim()
  const mappedEvent = EVENT_MAP[host]?.[originalEvent] || originalEvent
  const normalized = {
    ...(payload || {}),
    hookEventName: mappedEvent,
    hook_event_name: mappedEvent,
    devcodexHostSurface: host,
    devcodexHostEventName: originalEvent
  }
  if (host === 'gemini' && typeof payload?.prompt_response === 'string') normalized.response = payload.prompt_response
  return { originalEvent, mappedEvent, payload: normalized }
}

function adaptHostOutput(host, originalEvent, output) {
  const value = output && typeof output === 'object' && !Array.isArray(output) ? { ...output } : { continue: true }
  if (value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object') {
    value.hookSpecificOutput = { ...value.hookSpecificOutput, hookEventName: originalEvent }
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
  normalizeHostPayload,
  runHostAdapter
}
