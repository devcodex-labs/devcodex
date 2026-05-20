#!/usr/bin/env node
'use strict'

/**
 * DevCodex unified lifecycle hook — Copilot & Claude Code
 *
 * Auto-detects platform from tool name casing:
 *   Claude Code  → PascalCase tools (Write, Edit, Bash, Read …)
 *   Copilot      → snake_case / lowercase tools (apply_patch, create_file …)
 *
 * Handles: UserPromptSubmit · PreToolUse · PostToolUse · PreCompact · Stop
 */

const fs = require('fs')
const path = require('path')

const WORKSPACE_ROOT = process.cwd()
const STATE_DIR = path.join(WORKSPACE_ROOT, '.devcodex', '.memory', 'hooks')
const STATE_FILE = path.join(STATE_DIR, 'lifecycle-state.json')
const FINAL_PAYLOAD_FLAG = path.join(STATE_DIR, 'capture-final-payload.flag')
const FINAL_PAYLOAD_LOG = path.join(STATE_DIR, 'captured-final-payloads.ndjson')
const PROFILE_CONFIG_FILE = path.join(WORKSPACE_ROOT, '.devcodex', 'profile', 'config.json')
const PAYLOAD_PREVIEW_LIMIT = 160

// ─── CP Gate constants ────────────────────────────────────────────────────────
const CP1_FILE = '01-需求概述.md'
const CP2_FILE = '02-技术方案.md'
const CP3_FILE = '04-实施计划.md'
const REQUIREMENTS_DIR = path.join(WORKSPACE_ROOT, '.devcodex', 'requirements')

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => { buf += c })
    process.stdin.on('end', () => resolve(buf))
    process.stdin.on('error', reject)
  })
}

function safeJsonParse(text) {
  if (!text || !text.trim()) return {}
  try { return JSON.parse(text) } catch { return null }
}

function writeStdout(obj) {
  process.stdout.write(JSON.stringify(obj))
}

function readJsonFile(p) {
  if (!fs.existsSync(p)) return null
  let raw
  try { raw = fs.readFileSync(p, 'utf8') } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  try { return JSON.parse(raw) } catch { return null }
}

function readProfileMode() {
  const cfg = readJsonFile(PROFILE_CONFIG_FILE)
  return String(cfg?.mode ?? 'prod').trim().toLowerCase() === 'dev' ? 'dev' : 'prod'
}

function normalizeText(v) {
  return String(v || '').replace(/\\/g, '/').trim().toLowerCase()
}

function normalizePreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, PAYLOAD_PREVIEW_LIMIT)
}

// ─── Platform detection ───────────────────────────────────────────────────────

/**
 * Detect which AI platform is running the hook.
 * Claude Code uses PascalCase tool names (Write, Edit, Bash).
 * Copilot uses snake_case / lowercase (apply_patch, create_file).
 */
function detectPlatform(payload) {
  const toolName = String(payload.tool_name || payload.toolName || '').trim()
  if (!toolName) return 'copilot' // default for non-tool events
  return /^[A-Z]/.test(toolName) ? 'claude' : 'copilot'
}

// ─── Platform-specific output builders ───────────────────────────────────────

function noopOutput() { return { continue: true } }

function blockOutput(platform, eventName, reason, detail) {
  if (platform === 'claude') {
    return { decision: 'block', reason: detail || reason }
  }
  return {
    continue: true,
    systemMessage: `DevCodex hook: ${reason}`,
    hookSpecificOutput: {
      hookEventName: eventName || 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
      additionalContext: detail || reason
    }
  }
}

function systemMessageOutput(message) {
  return { continue: true, systemMessage: message }
}

// ─── Payload helpers ──────────────────────────────────────────────────────────

function getEventName(payload) {
  return String(
    payload.hookEventName || payload.hook_event_name ||
    payload.eventName || payload.event || payload.phase || ''
  ).trim()
}

function getToolName(payload) {
  return String(payload.tool_name || payload.toolName || '').trim()
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') { out.push(value); return out }
  if (Array.isArray(value)) { value.forEach(i => collectStrings(i, out)); return out }
  if (value && typeof value === 'object') Object.values(value).forEach(i => collectStrings(i, out))
  return out
}

function collectInterestingStrings(value, prefix = '', out = []) {
  if (typeof value === 'string') {
    if (value.trim()) out.push({ path: prefix, value })
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectInterestingStrings(v, prefix ? `${prefix}[${i}]` : `[${i}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      collectInterestingStrings(v, prefix ? `${prefix}.${k}` : k, out)
    }
  }
  return out
}

function getToolInputStrings(payload) {
  const input = payload.tool_input || payload.toolInput || {}
  return collectStrings(input).map(normalizeText).filter(Boolean)
}

function getCommandText(payload) {
  const input = payload.tool_input || payload.toolInput || {}
  return [input.command, input.commandLine, input.text, input.script]
    .filter(v => typeof v === 'string')
    .join('\n')
}

function touchesPath(payload, ...needles) {
  const strings = getToolInputStrings(payload)
  return strings.some(s => needles.some(n => s.includes(n)))
}

// ─── State ────────────────────────────────────────────────────────────────────

function buildDefaultState(mode) {
  const m = mode === 'dev' ? 'dev' : 'prod'
  return {
    version: 1, mode: m,
    phase: m === 'dev' ? 'bootstrapping' : 'active',
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    promptCount: 0, toolUseCount: 0,
    bootstrap: { profileRead: false, summaryRead: false, tasksRead: false },
    bootstrapComplete: m !== 'dev',
    visible: { payloadObserved: false, precheck: false, compliance: false },
    mutated: false, reportTouched: false, memoryTouched: false,
    lastEvent: '', lastReason: ''
  }
}

function loadState(modeHint) {
  const mode = modeHint || readProfileMode()
  const current = buildDefaultState(mode)
  const saved = readJsonFile(STATE_FILE)
  if (!saved || typeof saved !== 'object') return current
  return {
    ...current, ...saved, mode,
    bootstrap: { ...current.bootstrap, ...(saved.bootstrap || {}) },
    visible: { ...current.visible, ...(saved.visible || {}) }
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function resetState(mode) {
  const state = buildDefaultState(mode)
  state.promptCount = 1
  saveState(state)
  return state
}

// ─── Bootstrap (Copilot dev mode only) ───────────────────────────────────────

function isBootstrapReadTool(payload) {
  const tn = getToolName(payload).toLowerCase()
  // Copilot: read_file/list_dir/file_search/grep_search/semantic_search
  // Claude Code: Read/Glob/Grep (PascalCase → lowercased above)
  const readPatterns = [
    /^read([_-]?file)?$/, /^list[_-]?dir$/, /^file[_-]?search$/,
    /^grep([_-]?search)?$/, /^semantic[_-]?search$/, /^glob$/
  ]
  return readPatterns.some(p => p.test(tn)) && touchesPath(payload, '.devcodex/profile/', '.devcodex/.memory/clients/')
}

function updateBootstrapState(state, payload) {
  if (touchesPath(payload, '.devcodex/profile/')) state.bootstrap.profileRead = true
  if (touchesPath(payload, '.devcodex/.memory/clients/') &&
    getToolInputStrings(payload).some(s => s.includes('/summary.md'))) state.bootstrap.summaryRead = true
  if (touchesPath(payload, '.devcodex/.memory/clients/') &&
    getToolInputStrings(payload).some(s => s.includes('/tasks/') && s.endsWith('.md')))
    state.bootstrap.tasksRead = true
  state.bootstrapComplete = !!(
    state.bootstrap.profileRead && state.bootstrap.summaryRead && state.bootstrap.tasksRead
  )
  if (state.bootstrapComplete) state.phase = 'active'
}

function buildBootstrapMessage() {
  return [
    'DevCodex hook-enforced bootstrap is active for this user message.',
    'In dev mode, load the project profile under .devcodex/profile/ and memory files under',
    '.devcodex/.memory/clients/ before any substantive work.',
    'Your first user-visible block must be the DEV precheck PC0-PC4 before substantive task content.'
  ].join(' ')
}

function buildBootstrapDenyOutput(state, payload, eventName, platform) {
  const missing = []
  if (!state.bootstrap.profileRead) missing.push('profile')
  if (!state.bootstrap.summaryRead) missing.push('SUMMARY')
  if (!state.bootstrap.tasksRead) missing.push('tasks')
  const toolName = getToolName(payload) || 'tool'
  return blockOutput(
    platform || 'copilot', eventName,
    `Blocked tool use before dev bootstrap: ${toolName}`,
    `Read .devcodex/profile/ plus SUMMARY/tasks memory files first. Missing: ${missing.join(', ') || 'none'}.`
  )
}

// ─── CP Gate ─────────────────────────────────────────────────────────────────

function readCpConfirmations(reqPath) {
  const p = path.join(reqPath, '.memory', 'sessions.md')
  const none = { CP1: false, CP2: false, CP3: false }
  if (!fs.existsSync(p)) return none
  let text
  try { text = fs.readFileSync(p, 'utf8') } catch { return none }
  const confirmed = { CP1: false, CP2: false, CP3: false }
  const re = /\|\s*(CP[123])\s*\|\s*✅/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[1] in confirmed) confirmed[m[1]] = true
  }
  return confirmed
}

function findIncompleteRequirement() {
  if (!fs.existsSync(REQUIREMENTS_DIR)) return null
  let entries
  try { entries = fs.readdirSync(REQUIREMENTS_DIR) } catch { return null }
  const dirs = entries
    .map(name => {
      const fullPath = path.join(REQUIREMENTS_DIR, name)
      try { const s = fs.statSync(fullPath); return s.isDirectory() ? { name, fullPath } : null }
      catch { return null }
    })
    .filter(Boolean)
  return dirs.find(d => {
    if (fs.existsSync(path.join(d.fullPath, '.archived'))) return false
    if (!fs.existsSync(path.join(d.fullPath, CP1_FILE))) return false
    if (!fs.existsSync(path.join(d.fullPath, CP3_FILE))) return true
    return !readCpConfirmations(d.fullPath).CP3
  }) || null
}

function checkCpGate() {
  const req = findIncompleteRequirement()
  if (!req) return null
  const confirmed = readCpConfirmations(req.fullPath)
  if (!fs.existsSync(path.join(req.fullPath, CP2_FILE)) || !confirmed.CP2) {
    return { phase: 'CP2', reqName: req.name, reqPath: req.fullPath }
  }
  return { phase: 'CP3', reqName: req.name, reqPath: req.fullPath }
}

// Source file extensions that indicate code/config being written
const SOURCE_EXT_RE = /\.(js|ts|tsx|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|c|cpp|h|swift|kt|vue|svelte|css|scss|less|html|sql|sh|bash|zsh|ps1|psm1|json|yaml|yml|toml|ini|xml|env)$/i
const DEVCODEX_PATH_RE = /\.devcodex[/\\]|\.claude[/\\]|\.github[/\\]/

function bashWritesToSourceCode(cmd) {
  if (!cmd || DEVCODEX_PATH_RE.test(cmd)) return false
  // Detect output redirect  >  or  >>  to a source file
  const redirectRe = />{1,2}\s*['"]?([^\s'";&|]+)/g
  let m
  while ((m = redirectRe.exec(cmd)) !== null) {
    const target = m[1]
    if (SOURCE_EXT_RE.test(target) && !DEVCODEX_PATH_RE.test(target)) return true
  }
  // Detect tee targeting a source file
  const teeRe = /\btee\s+(?:-a\s+)?['"]?([^\s'";&|]+)/g
  while ((m = teeRe.exec(cmd)) !== null) {
    const target = m[1]
    if (SOURCE_EXT_RE.test(target) && !DEVCODEX_PATH_RE.test(target)) return true
  }
  // PowerShell Set-Content / Out-File — extract target path before testing
  const setContentMatch = cmd.match(/\bSet-Content\b\s+(?:-Path\s+)?['"]?([^\s'";&|]+)/i)
  if (setContentMatch && SOURCE_EXT_RE.test(setContentMatch[1]) && !DEVCODEX_PATH_RE.test(setContentMatch[1])) return true
  const outFileMatch = cmd.match(/\bOut-File\b\s+(?:-FilePath\s+)?['"]?([^\s'";&|]+)/i)
  if (outFileMatch && SOURCE_EXT_RE.test(outFileMatch[1]) && !DEVCODEX_PATH_RE.test(outFileMatch[1])) return true
  return false
}

function isSourceCodeMutation(payload, platform) {
  const toolName = getToolName(payload)
  const lower = toolName.toLowerCase()

  if (platform === 'claude') {
    // Write/Edit tools
    if (lower === 'write' || lower === 'edit') {
      return !touchesPath(payload, '.devcodex/', '.github/', '.claude/')
    }
    // Bash: detect redirect/tee writes to source files
    if (lower === 'bash') {
      return bashWritesToSourceCode(getCommandText(payload))
    }
    return false
  }

  // Copilot
  const copilotWritePatterns = [
    /^apply[_-]?patch$/,
    /^create[_-]?file$/,
    /^str[_-]?replace[_-]?(based[_-]?edit|editor)?$/,
    /^insert[_-]?code[_-]?at[_-]?line$/,
    /^rewrite[_-]?file$/
  ]
  if (!copilotWritePatterns.some(p => p.test(lower))) return false
  return !touchesPath(payload, '.devcodex/', '.github/', '.claude/')
}

function buildCpDenyOutput(platform, eventName, gate, toolName) {
  const msgs = {
    CP2: `CP2 (技术方案) 未完成 — 请先输出 ${CP2_FILE} 并在 .memory/sessions.md 记录用户确认（✅）后再编码。`,
    CP3: `CP3 (实施计划) 未完成 — 请先输出 ${CP3_FILE} 并在 .memory/sessions.md 记录用户确认（✅）后再编码。`
  }
  const msg = msgs[gate.phase]
  return blockOutput(
    platform, eventName,
    `CP gate: ${gate.phase} not confirmed for "${gate.reqName}" — ${toolName} denied`,
    msg
  )
}

// ─── Dangerous command detection ──────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  { re: /\brm\s+-rf\b/i, reason: 'Blocked: rm -rf' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'Blocked: git reset --hard' },
  { re: /\bdrop\s+table\b/i, reason: 'Blocked: DROP TABLE' },
  { re: /\btruncate\b/i, reason: 'Blocked: TRUNCATE' },
  { re: /\bdel\s+\/f\s+\/q\b/i, reason: 'Blocked: del /f /q' },
  { re: /Remove-Item.*-Recurse.*-Force/i, reason: 'Blocked: Remove-Item -Recurse -Force' }
]

function isCommandTool(payload, platform) {
  const tn = getToolName(payload).toLowerCase()
  if (platform === 'claude') return tn === 'bash'
  return /terminal|shell|powershell|bash|^run[_-]?in[_-]?terminal$|^runcommand$|^command$/.test(tn)
}

function checkDangerousCommand(payload, platform) {
  if (!isCommandTool(payload, platform)) return null
  const cmd = getCommandText(payload)
  return DANGEROUS_PATTERNS.find(p => p.re.test(cmd)) || null
}

// ─── Artifact touches ────────────────────────────────────────────────────────

function isMutatingTool(payload, platform) {
  const tn = getToolName(payload).toLowerCase()
  if (platform === 'claude') return ['write', 'edit', 'bash'].includes(tn)
  const mutatingPatterns = [
    /^apply[_-]?patch$/, /^create[_-]?file$/, /^create[_-]?directory$/,
    /^run[_-]?in[_-]?terminal$/, /^send[_-]?to[_-]?terminal$/, /^kill[_-]?terminal$/,
    /^vscode[_-]?renamesymbol$/, /^manage[_-]?todo[_-]?list$/, /^edit[_-]?notebook[_-]?file$/
  ]
  if (mutatingPatterns.some(p => p.test(tn))) return true
  if (tn === 'memory') {
    const input = payload.tool_input || payload.toolInput || {}
    return /create|insert|str_replace|delete|rename/.test(String(input.command || '').toLowerCase())
  }
  return false
}

function updateArtifactTouches(state, payload, platform) {
  if (touchesPath(payload, '/reports/')) state.reportTouched = true
  if (touchesPath(payload, '/.memory/', '/sessions.md')) state.memoryTouched = true
  if (isMutatingTool(payload, platform)) state.mutated = true
}

// ─── Visible reply inspection (Copilot PreCompact/Stop) ──────────────────────

function hasVisibleReplyPayload(payload) {
  const candidates = [
    payload.assistantMessage, payload.assistant_message, payload.response,
    payload.responseText, payload.response_text, payload.output,
    payload.reply, payload.content, payload.message, payload.transcript
  ]
  return candidates.some(v => typeof v === 'string' && v.trim())
}

function updateVisibleReplyState(state, payload, eventName) {
  if (eventName !== 'PreCompact' && eventName !== 'Stop') return
  if (!hasVisibleReplyPayload(payload)) return
  state.visible.payloadObserved = true
  const text = collectStrings(payload).join('\n')
  if (/预检查（DEV 模式）|PC0 上下文/.test(text)) state.visible.precheck = true
  if (/🛡️ DEV 模式 \| 合规检查|FC:\s*FC1/.test(text)) state.visible.compliance = true
}

function captureFinalPayloadSample(payload, eventName, state) {
  if ((eventName !== 'PreCompact' && eventName !== 'Stop') || !fs.existsSync(FINAL_PAYLOAD_FLAG)) return
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const snap = {
    capturedAt: new Date().toISOString(), eventName,
    payloadKeys: Object.keys(payload).sort(),
    visiblePayloadDetected: hasVisibleReplyPayload(payload),
    interestingStrings: collectInterestingStrings(payload),
    state: { mode: state.mode, phase: state.phase, mutated: state.mutated }
  }
  fs.appendFileSync(FINAL_PAYLOAD_LOG, `${JSON.stringify(snap)}\n`)
  if (eventName === 'Stop') fs.unlinkSync(FINAL_PAYLOAD_FLAG)
}

// ─── Closure reminder ─────────────────────────────────────────────────────────

function buildClosureReminder(state, eventName) {
  const items = []
  if (eventName === 'Stop' && state.mode === 'dev' && state.visible && !state.visible.precheck) {
    items.push('precheck block 未输出（S07/C18：dev 模式首条用户可见回复必须含 PC0~PC4 预检查块）')
  }
  if (state.mutated && !state.memoryTouched) items.push('记忆文件尚未写入（S05：会话结束前必须写入）')
  if (state.mutated && !state.reportTouched) items.push('报告文件尚未写入（chat 工作流豁免）')
  if (!items.length) return ''
  return `DevCodex closure reminder: ${items.join('; ')}.`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const raw = await readStdin()
  const payload = safeJsonParse(raw)

  if (payload === null) {
    process.stderr.write('DevCodex hook: invalid JSON input\n')
    process.exit(1)
  }

  const eventName = getEventName(payload)
  const platform = detectPlatform(payload)
  const mode = readProfileMode()
  let state = loadState(mode)

  updateVisibleReplyState(state, payload, eventName)
  state.lastEvent = eventName || state.lastEvent

  // ── UserPromptSubmit ───────────────────────────────────────────────────────
  if (eventName === 'UserPromptSubmit') {
    state = resetState(mode)
    if (mode === 'dev') {
      writeStdout(systemMessageOutput(buildBootstrapMessage()))
    } else {
      writeStdout(noopOutput())
    }
    return
  }

  // ── PreToolUse ─────────────────────────────────────────────────────────────
  const isToolUse = eventName === 'PreToolUse' || (!eventName && getToolName(payload))

  if (isToolUse) {
    state.toolUseCount += 1

    // 1. Dangerous command guard
    const danger = checkDangerousCommand(payload, platform)
    if (danger) {
      state.lastReason = danger.reason
      saveState(state)
      writeStdout(blockOutput(
        platform, eventName, danger.reason,
        `${danger.reason} — 请先输出命令预览并等待用户明确确认（S06）。`
      ))
      return
    }

    // 2. Bootstrap enforcement (dev mode, both Copilot and Claude Code)
    if (mode === 'dev' && !state.bootstrapComplete) {
      if (!isBootstrapReadTool(payload)) {
        state.lastReason = 'blocked-before-bootstrap'
        saveState(state)
        writeStdout(buildBootstrapDenyOutput(state, payload, eventName, platform))
        return
      }
      updateBootstrapState(state, payload)
    }

    // 3. CP gate — block source code mutations until checkpoints confirmed
    const gate = checkCpGate()
    if (gate && isSourceCodeMutation(payload, platform)) {
      state.lastReason = `cp-gate-${gate.phase}`
      saveState(state)
      writeStdout(buildCpDenyOutput(platform, eventName, gate, getToolName(payload) || 'tool'))
      return
    }

    updateArtifactTouches(state, payload, platform)
    saveState(state)
    writeStdout(noopOutput())
    return
  }

  // ── PostToolUse ────────────────────────────────────────────────────────────
  if (eventName === 'PostToolUse') {
    updateArtifactTouches(state, payload, platform)
    saveState(state)
    writeStdout(noopOutput())
    return
  }

  // ── PreCompact / Stop ──────────────────────────────────────────────────────
  if (eventName === 'PreCompact' || eventName === 'Stop') {
    captureFinalPayloadSample(payload, eventName, state)
    const reminder = buildClosureReminder(state, eventName)
    saveState(state)
    writeStdout(reminder ? systemMessageOutput(reminder) : noopOutput())
    return
  }

  saveState(state)
  writeStdout(noopOutput())
}

main().catch(err => {
  process.stderr.write(`DevCodex hook error: ${err.message}\n`)
  process.exit(1)
})
