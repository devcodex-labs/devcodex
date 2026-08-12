#!/usr/bin/env node
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')

const {
  STDIO_MAX_FRAME_BYTES,
  createBoundedTextAccumulator
} = require('./stdio-bounds.cjs')
const {
  EVENT_MAP,
  applyCliEnvironmentOverrides,
  adaptCursorOutput,
  probeHostAdapterContract,
  runHostAdapter
} = require('./lifecycle-host-adapters.cjs')

const ALLOWED_HOSTS = new Set(['claude', 'cursor'])
const COMPATIBLE_IDENTITY_PRELOAD = path.join(
  __dirname,
  'lifecycle-cursor-compatible-preload.cjs'
)

function parseHostHookPayload(inputText) {
  let text = String(inputText ?? '')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  return text.trim() ? JSON.parse(text) : {}
}

function normalizeCursorWorkspacePath(value, platform = process.platform) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (platform !== 'win32') return text
  return /^[\\/][A-Za-z]:[\\/]/.test(text) ? text.slice(1) : text
}

function normalizeCursorMcpToolName(value) {
  if (typeof value !== 'string') return value
  return value.replace(/^MCP:\s*/i, '')
}

function normalizeCursorPayload(payload, platform = process.platform) {
  const normalized = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...payload }
    : {}
  if (Array.isArray(normalized.workspace_roots)) {
    normalized.workspace_roots = normalized.workspace_roots.map(root =>
      normalizeCursorWorkspacePath(root, platform)
    )
  }
  if (normalized.cwd) {
    normalized.cwd = normalizeCursorWorkspacePath(normalized.cwd, platform)
  }
  if (!normalized.cwd && normalized.workspace_roots?.[0]) {
    normalized.cwd = normalized.workspace_roots[0]
  }
  for (const key of ['tool_name', 'toolName']) {
    if (normalized[key]) normalized[key] = normalizeCursorMcpToolName(normalized[key])
  }
  return normalized
}

function parseLifecycleOutput(result) {
  if (!result || result.status !== 0) return null
  const text = String(result.stdout || '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function applyCursorRecoveryContext(result, lifecycleOutput) {
  if (result?.status !== 0 || result?.output?.permission !== 'deny') return result
  const specific = lifecycleOutput?.hookSpecificOutput &&
    typeof lifecycleOutput.hookSpecificOutput === 'object'
    ? lifecycleOutput.hookSpecificOutput
    : {}
  const agentMessage = String(
    specific.additionalContext ||
    lifecycleOutput?.additionalContext ||
    lifecycleOutput?.systemMessage ||
    ''
  ).trim()
  if (!agentMessage) return result
  return {
    ...result,
    output: {
      ...result.output,
      agent_message: agentMessage
    }
  }
}

function isCursorImportedClaudePayload(host, payload, originalEvent) {
  const strongCursorFingerprint = typeof payload?.cursor_version === 'string' || Boolean(
    typeof payload?.conversation_id === 'string' &&
    typeof payload?.generation_id === 'string' &&
    Array.isArray(payload?.workspace_roots)
  )
  return host === 'claude'
    && typeof payload?.hook_event_name === 'string'
    && typeof payload?.hookEventName !== 'string'
    && !EVENT_MAP.claude[originalEvent]
    && Boolean(EVENT_MAP.cursor[originalEvent])
    && strongCursorFingerprint
}

function runCompatibleHostAdapter(host, payload, options = {}) {
  const originalEvent = String(
    payload?.hookEventName || payload?.hook_event_name || payload?.eventName || payload?.event || ''
  ).trim()
  if (isCursorImportedClaudePayload(host, payload, originalEvent)) {
    return {
      status: 0,
      error: '',
      output: adaptCursorOutput(originalEvent, { continue: true }, payload, options),
      compatibilityBypass: 'cursor-imported-claude-hook'
    }
  }
  const execute = options.spawnSync || spawnSync
  const spawnWithCompatibleIdentity = (command, args, spawnOptions) => execute(
    command,
    ['--require', COMPATIBLE_IDENTITY_PRELOAD, ...args],
    spawnOptions
  )
  if (host !== 'cursor') {
    return runHostAdapter(host, payload, {
      ...options,
      spawnSync: spawnWithCompatibleIdentity
    })
  }

  const platform = options.platform || process.platform
  const nextPayload = normalizeCursorPayload(payload, platform)
  const nextEnv = { ...(options.env || process.env) }
  if (nextEnv.CURSOR_PROJECT_DIR) {
    nextEnv.CURSOR_PROJECT_DIR = normalizeCursorWorkspacePath(
      nextEnv.CURSOR_PROJECT_DIR,
      platform
    )
  }
  let lifecycleOutput = null
  const captureSpawn = (command, args, spawnOptions) => {
    const result = spawnWithCompatibleIdentity(command, args, spawnOptions)
    lifecycleOutput = parseLifecycleOutput(result)
    return result
  }
  const result = runHostAdapter(host, nextPayload, {
    ...options,
    env: nextEnv,
    spawnSync: captureSpawn
  })
  return applyCursorRecoveryContext(result, lifecycleOutput)
}

function main(argv = process.argv, inputStream = process.stdin) {
  const host = String(argv[2] || '').trim().toLowerCase()
  if (!ALLOWED_HOSTS.has(host)) {
    process.stderr.write(`Unsupported Cursor-compatible host adapter: ${host || '(missing)'}\n`)
    process.exit(2)
    return
  }
  if (argv[3] === '--contract-probe') {
    const probe = probeHostAdapterContract(host)
    process.stdout.write(JSON.stringify(probe))
    process.exit(probe.status === 'passed' ? 0 : 1)
    return
  }
  applyCliEnvironmentOverrides(argv.slice(3))
  const input = createBoundedTextAccumulator({ maxBytes: STDIO_MAX_FRAME_BYTES })
  inputStream.setEncoding('utf8')
  inputStream.on('data', chunk => { input.push(chunk) })
  inputStream.on('end', () => {
    if (input.overflowed) {
      process.stderr.write(`HOST_ADAPTER_INPUT_TOO_LARGE: maximum ${input.maxBytes} bytes\n`)
      process.exit(2)
      return
    }
    let payload
    try { payload = parseHostHookPayload(input.snapshot()) } catch (error) {
      process.stderr.write(`Invalid host hook payload: ${error.message}\n`)
      process.exit(2)
      return
    }
    if (!payload.hookEventName && !payload.hook_event_name &&
        process.env.DEVCODEX_HOST_EVENT) {
      payload.hookEventName = process.env.DEVCODEX_HOST_EVENT
    }
    const result = runCompatibleHostAdapter(host, payload)
    if (result.status !== 0) {
      process.stderr.write(`${result.error}\n`)
      process.exit(result.status)
      return
    }
    process.stdout.write(JSON.stringify(result.output))
  })
}

if (require.main === module) main()

module.exports = {
  ALLOWED_HOSTS,
  applyCursorRecoveryContext,
  isCursorImportedClaudePayload,
  main,
  normalizeCursorMcpToolName,
  normalizeCursorPayload,
  normalizeCursorWorkspacePath,
  parseHostHookPayload,
  runCompatibleHostAdapter
}
