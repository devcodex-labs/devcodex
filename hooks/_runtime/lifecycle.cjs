#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const WORKSPACE_ROOT = process.cwd()
const STATE_DIR = path.join(WORKSPACE_ROOT, '.devcodex', '.memory', 'hooks')
const STATE_FILE = path.join(STATE_DIR, 'lifecycle-state.json')
const FINAL_PAYLOAD_CAPTURE_FLAG = path.join(STATE_DIR, 'capture-final-payload.flag')
const FINAL_PAYLOAD_CAPTURE_LOG = path.join(STATE_DIR, 'captured-final-payloads.ndjson')
const PROFILE_CONFIG_FILE = path.join(WORKSPACE_ROOT, '.devcodex', 'profile', 'config.json')
const PAYLOAD_PREVIEW_LIMIT = 160

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

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function readProfileMode() {
  const profile = readJsonFile(PROFILE_CONFIG_FILE)
  const mode = String(profile && profile.mode ? profile.mode : 'prod').trim().toLowerCase()
  return mode === 'dev' ? 'dev' : 'prod'
}

function buildDefaultState(mode) {
  const normalizedMode = mode === 'dev' ? 'dev' : 'prod'
  return {
    version: 1,
    mode: normalizedMode,
    phase: normalizedMode === 'dev' ? 'bootstrapping' : 'active',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    promptCount: 0,
    toolUseCount: 0,
    bootstrap: {
      profileRead: false,
      summaryRead: false,
      tasksRead: false
    },
    bootstrapComplete: normalizedMode !== 'dev',
    visible: {
      payloadObserved: false,
      precheck: false,
      compliance: false
    },
    mutated: false,
    reportTouched: false,
    memoryTouched: false,
    lastEvent: '',
    lastReason: ''
  }
}

function loadState(modeHint) {
  const mode = modeHint || readProfileMode()
  const current = buildDefaultState(mode)
  const saved = readJsonFile(STATE_FILE)
  if (!saved || typeof saved !== 'object') return current

  return {
    ...current,
    ...saved,
    mode,
    bootstrap: {
      ...current.bootstrap,
      ...(saved.bootstrap || {})
    },
    visible: {
      ...current.visible,
      ...(saved.visible || {})
    }
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function normalizePreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, PAYLOAD_PREVIEW_LIMIT)
}

function shouldCaptureFinalPayload() {
  return fs.existsSync(FINAL_PAYLOAD_CAPTURE_FLAG)
}

function collectInterestingStrings(value, currentPath = '', depth = 0, out = []) {
  if (out.length >= 24 || depth > 3) return out

  if (typeof value === 'string') {
    const normalizedPath = currentPath || '<root>'
    if (/(assistant|response|reply|content|message|transcript|text|output)/i.test(normalizedPath) && value.trim()) {
      out.push({
        path: normalizedPath,
        length: value.length,
        preview: normalizePreview(value)
      })
    }
    return out
  }

  if (Array.isArray(value)) {
    value.slice(0, 5).forEach((item, index) => {
      const nextPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`
      collectInterestingStrings(item, nextPath, depth + 1, out)
    })
    return out
  }

  if (!value || typeof value !== 'object') return out

  Object.entries(value).slice(0, 20).forEach(([key, item]) => {
    const nextPath = currentPath ? `${currentPath}.${key}` : key
    collectInterestingStrings(item, nextPath, depth + 1, out)
  })

  return out
}

function collectTopLevelStrings(payload) {
  return Object.entries(payload)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .slice(0, 20)
    .map(([key, value]) => ({
      path: key,
      length: value.length,
      preview: normalizePreview(value)
    }))
}

function captureFinalPayloadSample(payload, eventName, state) {
  if ((eventName !== 'PreCompact' && eventName !== 'Stop') || !shouldCaptureFinalPayload()) return

  fs.mkdirSync(STATE_DIR, { recursive: true })
  const snapshot = {
    capturedAt: new Date().toISOString(),
    eventName,
    payloadKeys: Object.keys(payload).sort(),
    visiblePayloadDetected: hasVisibleReplyPayload(payload),
    topLevelStrings: collectTopLevelStrings(payload),
    interestingStrings: collectInterestingStrings(payload),
    state: {
      mode: state.mode,
      phase: state.phase,
      bootstrapComplete: state.bootstrapComplete,
      mutated: state.mutated,
      reportTouched: state.reportTouched,
      memoryTouched: state.memoryTouched
    }
  }

  fs.appendFileSync(FINAL_PAYLOAD_CAPTURE_LOG, `${JSON.stringify(snapshot)}\n`)

  if (eventName === 'Stop' && fs.existsSync(FINAL_PAYLOAD_CAPTURE_FLAG)) {
    fs.unlinkSync(FINAL_PAYLOAD_CAPTURE_FLAG)
  }
}

function resetState(mode) {
  const state = buildDefaultState(mode)
  state.promptCount = 1
  saveState(state)
  return state
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

function normalizeText(value) {
  return String(value || '').replace(/\\/g, '/').trim().toLowerCase()
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, out))
    return out
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStrings(item, out))
  }
  return out
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

function getToolInputStrings(payload) {
  const toolInput = payload.tool_input || payload.toolInput || {}
  return collectStrings(toolInput).map(normalizeText).filter(Boolean)
}

function touchesProfilePayload(payload) {
  return getToolInputStrings(payload).some(text => text.includes('.devcodex/profile/'))
}

function touchesSummaryPayload(payload) {
  return getToolInputStrings(payload).some(text =>
    text.includes('.devcodex/.memory/clients/') && text.includes('/summary.md')
  )
}

function touchesTasksPayload(payload) {
  return getToolInputStrings(payload).some(text =>
    text.includes('.devcodex/.memory/clients/') && text.includes('/tasks/') && text.endsWith('.md')
  )
}

function touchesBootstrapArea(payload) {
  return getToolInputStrings(payload).some(text =>
    text.includes('.devcodex/profile/') || text.includes('.devcodex/.memory/clients/')
  )
}

function updateBootstrapState(state, payload) {
  if (touchesProfilePayload(payload)) state.bootstrap.profileRead = true
  if (touchesSummaryPayload(payload)) state.bootstrap.summaryRead = true
  if (touchesTasksPayload(payload)) state.bootstrap.tasksRead = true

  state.bootstrapComplete = Boolean(
    state.bootstrap.profileRead &&
    state.bootstrap.summaryRead &&
    state.bootstrap.tasksRead
  )

  if (state.bootstrapComplete) {
    state.phase = 'active'
  }
}

function hasVisibleReplyPayload(payload) {
  const candidates = [
    payload.assistantMessage,
    payload.assistant_message,
    payload.response,
    payload.responseText,
    payload.response_text,
    payload.output,
    payload.reply,
    payload.content,
    payload.message,
    payload.transcript
  ]

  return candidates.some(value => typeof value === 'string' && value.trim())
}

function updateVisibleReplyState(state, payload, eventName) {
  if (eventName !== 'PreCompact' && eventName !== 'Stop') return
  if (!hasVisibleReplyPayload(payload)) return

  state.visible.payloadObserved = true
  const allText = collectStrings(payload).join('\n')
  if (/预检查（DEV 模式）|PC0 上下文/.test(allText)) {
    state.visible.precheck = true
  }
  if (/🛡️ DEV 模式 \| 合规检查|FC:\s*FC1/.test(allText)) {
    state.visible.compliance = true
  }
}

function isBootstrapReadTool(payload) {
  const toolName = getToolName(payload).toLowerCase()
  const readOnlyPatterns = [
    /^read[_-]?file$/,
    /^list[_-]?dir$/,
    /^file[_-]?search$/,
    /^grep[_-]?search$/,
    /^semantic[_-]?search$/
  ]

  return readOnlyPatterns.some(pattern => pattern.test(toolName)) && touchesBootstrapArea(payload)
}

function isMutatingTool(payload) {
  const toolName = getToolName(payload).toLowerCase()
  const mutatingPatterns = [
    /^apply[_-]?patch$/,
    /^create[_-]?file$/,
    /^create[_-]?directory$/,
    /^run[_-]?in[_-]?terminal$/,
    /^send[_-]?to[_-]?terminal$/,
    /^kill[_-]?terminal$/,
    /^vscode[_-]?renamesymbol$/,
    /^manage[_-]?todo[_-]?list$/,
    /^edit[_-]?notebook[_-]?file$/
  ]

  if (mutatingPatterns.some(pattern => pattern.test(toolName))) return true

  if (toolName === 'memory') {
    const toolInput = payload.tool_input || payload.toolInput || {}
    return /create|insert|str_replace|delete|rename/.test(String(toolInput.command || '').toLowerCase())
  }

  return false
}

function updateArtifactTouches(state, payload) {
  const strings = getToolInputStrings(payload)
  if (strings.some(text => text.includes('/reports/'))) {
    state.reportTouched = true
  }
  if (strings.some(text => text.includes('/.memory/') || text.endsWith('/sessions.md'))) {
    state.memoryTouched = true
  }
  if (isMutatingTool(payload)) {
    state.mutated = true
  }
}

function buildBootstrapMessage() {
  return [
    'DevCodex hook-enforced bootstrap is active for this user message.',
    'In dev mode, load the project profile under .devcodex/profile/ and memory files under .devcodex/.memory/clients/ before any substantive work.',
    'Your first user-visible block must be the DEV precheck PC0-PC4 before substantive task content.',
    'For non-chat dev/fix/analyze/audit replies, finish with the DEV compliance status block when applicable.'
  ].join(' ')
}

function buildBootstrapDenyOutput(state, payload) {
  const toolName = getToolName(payload) || 'tool'
  const missing = []
  if (!state.bootstrap.profileRead) missing.push('profile')
  if (!state.bootstrap.summaryRead) missing.push('SUMMARY')
  if (!state.bootstrap.tasksRead) missing.push('tasks')

  return {
    continue: true,
    systemMessage: 'DevCodex hook blocked tool execution until dev bootstrap is complete.',
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Blocked tool use before dev bootstrap: ${toolName}`,
      additionalContext: `Read .devcodex/profile/ plus SUMMARY/tasks memory files first. Missing: ${missing.join(', ') || 'none'}.`
    }
  }
}

function buildClosureReminder(state) {
  const reminders = []
  if (state.visible.payloadObserved && !state.visible.precheck) {
    reminders.push('the DEV precheck block was not detected in the visible reply payload')
  }
  if (state.mutated && !state.memoryTouched) reminders.push('memory files were not touched for this mutating turn')
  if (state.mutated && !state.reportTouched) reminders.push('report files were not touched for this mutating turn')
  if (!reminders.length) return ''

  return `DevCodex closure reminder: ${reminders.join('; ')}.`
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
  const mode = readProfileMode()
  let state = loadState(mode)

  updateVisibleReplyState(state, payload, eventName)
  state.lastEvent = eventName || state.lastEvent

  if (eventName === 'UserPromptSubmit') {
    state = resetState(mode)
    success(mode === 'dev' ? { continue: true, systemMessage: buildBootstrapMessage() } : buildNoopOutput())
    return
  }

  const isToolUseEvent = eventName === 'PreToolUse' || (!eventName && getToolName(payload))

  if (isToolUseEvent) {
    state.toolUseCount += 1

    const commandText = shouldInspectTool(payload) ? getCommandText(payload) : ''
    const matched = commandText ? matchDangerousPattern(commandText) : null

    if (matched) {
      state.lastReason = matched.reason
      saveState(state)
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

    if (mode === 'dev' && !state.bootstrapComplete) {
      if (!isBootstrapReadTool(payload)) {
        state.lastReason = 'blocked-before-bootstrap'
        saveState(state)
        success(buildBootstrapDenyOutput(state, payload))
        return
      }

      updateBootstrapState(state, payload)
    }

    updateArtifactTouches(state, payload)
    saveState(state)
    success(buildNoopOutput())
    return
  }

  if (eventName === 'PostToolUse') {
    updateArtifactTouches(state, payload)
    saveState(state)
    success(buildNoopOutput())
    return
  }

  if (eventName === 'PreCompact' || eventName === 'Stop') {
    captureFinalPayloadSample(payload, eventName, state)
    const reminder = buildClosureReminder(state)
    saveState(state)
    success(reminder ? { continue: true, systemMessage: reminder } : buildNoopOutput())
    return
  }

  saveState(state)
  success(buildNoopOutput())
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})