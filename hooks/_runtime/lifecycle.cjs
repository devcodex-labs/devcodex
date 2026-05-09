#!/usr/bin/env node
'use strict'

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      input += chunk
    })
    process.stdin.on('end', () => resolve(input))
    process.stdin.on('error', reject)
  })
}

function safeJsonParse(text) {
  if (!text || !text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function success(output) {
  process.stdout.write(JSON.stringify(output))
}

function buildNoopOutput() {
  return { continue: true }
}

function getEventName(payload) {
  return String(
    payload.hookEventName ||
    payload.hook_event_name ||
    payload.eventName ||
    payload.event ||
    payload.phase ||
    ''
  ).trim()
}

function getToolName(payload) {
  return String(payload.tool_name || payload.toolName || '').trim()
}

function shouldInspectTool(payload) {
  const toolName = getToolName(payload).toLowerCase()
  if (!toolName) return false

  const commandToolPatterns = [
    /terminal/,
    /shell/,
    /powershell/,
    /bash/,
    /^run[_-]?in[_-]?terminal$/,
    /^runcommand$/,
    /^command$/
  ]

  return commandToolPatterns.some(pattern => pattern.test(toolName))
}

function collectCommandCandidates(toolInput) {
  const candidates = []
  const pushString = value => {
    if (typeof value === 'string' && value.trim()) {
      candidates.push(value)
    }
  }
  const pushArray = value => {
    if (Array.isArray(value)) {
      value.forEach(item => pushString(item))
    }
  }

  if (!toolInput || typeof toolInput !== 'object') return candidates

  pushString(toolInput.command)
  pushString(toolInput.commandLine)
  pushString(toolInput.text)
  pushString(toolInput.script)
  pushArray(toolInput.commands)
  pushArray(toolInput.args)
  pushArray(toolInput.arguments)

  return candidates
}

function getCommandText(payload) {
  const toolInput = payload.tool_input || payload.toolInput || {}
  return collectCommandCandidates(toolInput).join('\n')
}

function matchDangerousPattern(text) {
  const patterns = [
    {
      re: /\brm\s+-rf\b/i,
      reason: 'Blocked destructive rm -rf command'
    },
    {
      re: /\bgit\s+reset\s+--hard\b/i,
      reason: 'Blocked git reset --hard command'
    },
    {
      re: /\bdrop\s+table\b/i,
      reason: 'Blocked DROP TABLE statement'
    },
    {
      re: /\btruncate\b/i,
      reason: 'Blocked TRUNCATE statement'
    },
    {
      re: /\bdel\s+\/f\s+\/q\b/i,
      reason: 'Blocked forced delete command'
    }
  ]

  return patterns.find(pattern => pattern.re.test(text)) || null
}

async function main() {
  const rawInput = await readStdin()
  const payload = safeJsonParse(rawInput)

  if (payload === null) {
    process.stderr.write('DevCodex hook received invalid JSON input\n')
    process.exit(1)
  }

  const eventName = getEventName(payload)
  const isToolUseEvent = eventName === 'PreToolUse' || (!eventName && getToolName(payload))

  if (isToolUseEvent) {
    const commandText = shouldInspectTool(payload) ? getCommandText(payload) : ''
    const matched = commandText ? matchDangerousPattern(commandText) : null

    if (matched) {
      success({
        continue: true,
        systemMessage: 'DevCodex hook blocked a dangerous operation before tool execution.',
        hookSpecificOutput: {
          hookEventName: eventName || 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: matched.reason,
          additionalContext: 'This operation matches DevCodex destructive-command guardrails and must be reviewed manually.'
        }
      })
      return
    }
  }

  success(buildNoopOutput())
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})