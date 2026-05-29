#!/usr/bin/env node
'use strict'

/**
 * DevCodex unified lifecycle hook — Copilot, Claude Code & Codex
 *
 * Auto-detects platform from tool name casing:
 *   Claude Code  → PascalCase tools (Write, Edit, Bash, Read …)
 *   Copilot      → snake_case / lowercase tools (apply_patch, create_file …)
 *
 * Handles: UserPromptSubmit · PreToolUse · PostToolUse · PreCompact · Stop
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  collectWorkspaceProjectNamespaces,
  findLayoutInfo,
  inferProjectFromCwd
} = require('./workspace-layout.cjs')

const CONTEXT_ROOT = process.cwd()
const PAYLOAD_PREVIEW_LIMIT = 160
const TRANSCRIPT_TAIL_LIMIT = 2 * 1024 * 1024
const STICKY_PROJECT_TTL_MS = 30 * 60 * 1000

// ─── CP Gate constants ────────────────────────────────────────────────────────
const CP1_FILE = '01-需求概述.md'
const CP2_FILE = '02-技术方案.md'
const CP3_FILE = '04-实施计划.md'
const EXECUTION_MODE = { CONFIRM: 'confirm', AUTO: 'auto' }
const ENFORCEMENT_MODE = (() => {
  const mode = String(process.env.DEVCODEX_HOOK_ENFORCEMENT || 'safety-only').trim().toLowerCase()
  return mode === 'strict' ? 'strict' : 'safety-only'
})()
const AUTO_ALLOWED_PATH_PATTERNS = [
  /^\.devcodex\/(?:workspace|[A-Za-z0-9][A-Za-z0-9._-]*|profile|requirements|bugs|optimizations|scenario-tests|reports|\.memory|\.audit-state)(?:\/|$)/,
  /^agents\/devcodex-auto\.agent\.md$/i,
  /^instructions\/01-common\.instructions\.md$/i,
  /^skills\/cp-gate\/SKILL\.md$/i,
  /^skills\/compliance\/SKILL\.md$/i,
  /^hooks\/_runtime\/lifecycle\.cjs$/i,
  /^scripts\/test-hooks-runtime\.js$/i,
  /^scripts\/validate\.js$/i,
  /^README\.md$/i,
  /^AGENTS\.md$/i,
  /^\.agents\/(?:skills)(?:\/|$)/i,
  /^\.codex\/(?:hooks\.json|hooks\/_runtime)(?:\/|$)/i,
  /^codex\/hooks\.json$/i,
  /^\.(?:claude|github)\/(?:instructions|skills|hooks|agents|prompts|data|settings\.json|settings\.local\.json)(?:\/|$)/i
]

// ─── Multi-project workspace guard (v1.9.8+) ─────────────────────────────────────
const MULTI_PROJECT_EXEMPTION_KEYWORDS = [
  'workspace', 'monorepo', '全工作区', 'all projects', '所有项目'
]

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

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function mergeConfig(baseConfig, overlayConfig) {
  const merged = {}
  for (const source of [baseConfig, overlayConfig]) {
    if (!isPlainObject(source)) continue
    for (const [key, value] of Object.entries(source)) {
      if (Array.isArray(value)) {
        merged[key] = value.slice()
      } else if (isPlainObject(value) && isPlainObject(merged[key])) {
        merged[key] = { ...merged[key], ...value }
      } else if (isPlainObject(value)) {
        merged[key] = { ...value }
      } else {
        merged[key] = value
      }
    }
  }
  return merged
}

const LAYOUT = findLayoutInfo(CONTEXT_ROOT)
const WORKSPACE_ROOT = LAYOUT.workspaceRoot

function inferContextProject() {
  return inferProjectFromCwd(CONTEXT_ROOT, LAYOUT)
}

const CONTEXT_PROJECT = inferContextProject()
const DEFAULT_SCOPE = LAYOUT.enabled ? (CONTEXT_PROJECT ? 'project' : 'workspace') : 'project'
const ACTIVE_RUNTIME_ROOT = LAYOUT.enabled
  ? path.join(WORKSPACE_ROOT, '.devcodex', CONTEXT_PROJECT || 'workspace')
  : path.join(WORKSPACE_ROOT, '.devcodex')
const META_STATE_SCOPE_KEY = LAYOUT.enabled ? 'workspace' : 'legacy'
const INTERCEPTION_ACTION = {
  FORBID: 'forbid',
  REQUIRE_COMPLETION: 'require_completion',
  WARN_CONTINUE: 'warn_continue',
  LOG_ONLY: 'log_only'
}
const APPROVAL_TTL_MS = 10 * 60 * 1000

function resolveProjectName(projectName) {
  return String(projectName || '').trim() || CONTEXT_PROJECT || ''
}

function resolveRelativeToContext(p) {
  if (!p) return ''
  try { return path.isAbsolute(p) ? path.normalize(p) : path.resolve(CONTEXT_ROOT, p) } catch { return p }
}

function buildPathNeedles(absolutePath) {
  const needles = [absolutePath]
  try {
    const workspaceRelative = path.relative(WORKSPACE_ROOT, absolutePath)
    if (workspaceRelative && workspaceRelative !== '.') needles.push(workspaceRelative)
  } catch { }
  try {
    const contextRelative = path.relative(CONTEXT_ROOT, absolutePath)
    if (contextRelative && contextRelative !== '.') needles.push(contextRelative)
  } catch { }
  return [...new Set(needles)]
}

function getWorkspaceNamespaceRoot() {
  return path.join(WORKSPACE_ROOT, '.devcodex', 'workspace')
}

function getProjectNamespaceRoot(projectName) {
  return path.join(WORKSPACE_ROOT, '.devcodex', resolveProjectName(projectName))
}

function buildStatePaths(namespaceRoot, scopeKey) {
  const dir = path.join(namespaceRoot, '.memory', 'hooks', scopeKey)
  return {
    dir,
    file: path.join(dir, 'lifecycle-state.json'),
    finalPayloadFlag: path.join(dir, 'capture-final-payload.flag'),
    finalPayloadLog: path.join(dir, 'captured-final-payloads.ndjson'),
    interceptionLog: path.join(dir, 'interceptions.jsonl')
  }
}

function getMetaStatePaths() {
  const namespaceRoot = LAYOUT.enabled ? getWorkspaceNamespaceRoot() : path.join(WORKSPACE_ROOT, '.devcodex')
  return buildStatePaths(namespaceRoot, META_STATE_SCOPE_KEY)
}

function getStatePathsFor(projectName, scope) {
  if (!LAYOUT.enabled) return getMetaStatePaths()
  if (scope === 'workspace' || !projectName) return getMetaStatePaths()
  return buildStatePaths(getProjectNamespaceRoot(projectName), projectName)
}

function getStatePaths(state, explicitProject, explicitScope) {
  const scope = explicitScope || state?.activeScope || DEFAULT_SCOPE
  const projectName = resolveProjectName(explicitProject || state?.activeProject || '')
  return getStatePathsFor(projectName, scope)
}

const META_STATE_PATHS = getMetaStatePaths()
const STATE_DIR = META_STATE_PATHS.dir
const STATE_FILE = META_STATE_PATHS.file
const FINAL_PAYLOAD_FLAG = META_STATE_PATHS.finalPayloadFlag
const FINAL_PAYLOAD_LOG = META_STATE_PATHS.finalPayloadLog
const INTERCEPTION_LOG = META_STATE_PATHS.interceptionLog

function getActiveScope(state) {
  return state?.activeScope || DEFAULT_SCOPE
}

function getWorkspaceProfileConfigPath() {
  if (LAYOUT.enabled) {
    return path.join(getWorkspaceNamespaceRoot(), 'profile', 'config.json')
  }
  return path.join(WORKSPACE_ROOT, '.devcodex', 'profile', 'config.json')
}

function getProjectRoot(projectName) {
  const name = resolveProjectName(projectName)
  if (name) return path.join(WORKSPACE_ROOT, name)
  return CONTEXT_ROOT
}

function getActiveProjectRoot(state) {
  return getProjectRoot(state?.activeProject || CONTEXT_PROJECT || '')
}

function getActiveNamespaceRoot(state, explicitProject, explicitScope) {
  if (!LAYOUT.enabled) {
    return path.join(getProjectRoot(explicitProject || state?.activeProject || ''), '.devcodex')
  }
  const scope = explicitScope || getActiveScope(state)
  const projectName = resolveProjectName(explicitProject || state?.activeProject || '')
  if (scope === 'workspace' || !projectName) return getWorkspaceNamespaceRoot()
  return getProjectNamespaceRoot(projectName)
}

function readResolvedProfileConfig(state, explicitProject) {
  if (!LAYOUT.enabled) {
    const roots = []
    const projectRoot = getProjectRoot(explicitProject || state?.activeProject || '')
    roots.push(projectRoot)
    if (projectRoot !== WORKSPACE_ROOT) roots.push(WORKSPACE_ROOT)
    for (const root of roots) {
      const cfg = readJsonFile(path.join(root, '.devcodex', 'profile', 'config.json'))
      if (cfg) return cfg
    }
    return null
  }
  const workspaceCfg = readJsonFile(path.join(getWorkspaceNamespaceRoot(), 'profile', 'config.json'))
  const projectName = resolveProjectName(explicitProject || state?.activeProject || '')
  const projectCfg = projectName
    ? readJsonFile(path.join(getProjectNamespaceRoot(projectName), 'profile', 'config.json'))
    : null
  if (!workspaceCfg && !projectCfg) return null
  return mergeConfig(workspaceCfg, projectCfg)
}

function readProfileMode(state, explicitProject) {
  const cfg = readResolvedProfileConfig(state, explicitProject)
  return String(cfg?.mode ?? 'prod').trim().toLowerCase() === 'dev' ? 'dev' : 'prod'
}

function readProjectProfileConfig(state, explicitProject) {
  return readResolvedProfileConfig(state, explicitProject)
}

function listMemoryAgents(state) {
  const clientsDir = path.join(getActiveNamespaceRoot(state), '.memory', 'clients')
  if (!fs.existsSync(clientsDir)) return []
  try {
    return fs.readdirSync(clientsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => String(entry.name || '').trim().toLowerCase())
      .filter(Boolean)
  } catch {
    return []
  }
}

function inferBootstrapAgent(state, payload) {
  const existingAgents = new Set(listMemoryAgents(state))
  const platform = detectPlatform(payload || {})

  if (platform === 'claude') return 'claude-code'
  if (platform === 'jetbrains-copilot') return 'jetbrains-copilot'
  if (platform === 'vscode-copilot') {
    if (existingAgents.has('vscode-copilot')) return 'vscode-copilot'
    if (existingAgents.has('copilot')) return 'copilot'
    return 'vscode-copilot'
  }
  if (platform === 'copilot') {
    if (existingAgents.has('copilot')) return 'copilot'
    if (existingAgents.has('vscode-copilot')) return 'vscode-copilot'
    return 'copilot'
  }
  return 'unknown-agent'
}

function getBootstrapAgent(state, payload) {
  const configuredAgent = String(readProjectProfileConfig(state)?.agent || '').trim().toLowerCase()
  return configuredAgent || inferBootstrapAgent(state, payload)
}

function formatDateStamp(date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function getRecentBootstrapTaskStamps() {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  return [formatDateStamp(today), formatDateStamp(yesterday)]
}

function isRecentBootstrapTaskPath(input) {
  const normalized = normalizeText(input)
  return getRecentBootstrapTaskStamps().some(stamp => normalized.endsWith(`/tasks/${stamp}.md`))
}

function normalizeText(v) {
  return String(v || '').replace(/\\/g, '/').trim().toLowerCase()
}

function normalizeKeyPath(v) {
  return String(v || '')
    .replace(/\[\d+\]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\\/g, '/')
    .toLowerCase()
}

function isProjectPayloadKeyPath(keyPath) {
  const normalized = normalizeKeyPath(keyPath)
  return /(^|[./_-])(cwd|workspace|workspace_folder|workspace_folders|folder|folders|root|project|project_root|project_path|repo|repository|path|paths|file|files|uri|uris|url|urls|directory|directories|dir|dirs|location)($|[./_-])/.test(normalized)
}

function normalizePreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, PAYLOAD_PREVIEW_LIMIT)
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Platform detection ───────────────────────────────────────────────────────

/**
 * Detect which AI platform is running the hook.
 * v1.9.6+: env vars take priority over tool-name heuristic.
 * - CLAUDE_CODE_VERSION / CLAUDE_HOOK_COMMAND → claude
 * - IDEA_INITIAL_DIRECTORY / JETBRAINS_IDE / IDEA_* → jetbrains-copilot
 * - TERM_PROGRAM=vscode → vscode-copilot (when not Claude)
 * Fallback: PascalCase tool name → claude; otherwise copilot.
 */
function detectPlatform(payload) {
  if (process.env.CLAUDE_CODE_VERSION || process.env.CLAUDE_HOOK_COMMAND) return 'claude'
  if (process.env.CODEX_SANDBOX || process.env.CODEX_HOME || process.env.OPENAI_CODEX) return 'codex'
  if (process.env.IDEA_INITIAL_DIRECTORY || process.env.JETBRAINS_IDE) return 'jetbrains-copilot'
  const toolName = String(payload.tool_name || payload.toolName || '').trim()
  if (toolName && /^[A-Z]/.test(toolName)) return 'claude'
  if (process.env.TERM_PROGRAM === 'vscode') return 'vscode-copilot'
  return 'copilot'
}

// ─── Platform-specific output builders ───────────────────────────────────────

function noopOutput() { return { continue: true } }

function isStrictEnforcement() { return ENFORCEMENT_MODE === 'strict' }

function decorateHookOutput(output, meta = {}) {
  if (!meta || !Object.keys(meta).length) return output
  if (!output?.hookSpecificOutput || !Object.prototype.hasOwnProperty.call(output.hookSpecificOutput, 'permissionDecision')) {
    return output
  }
  const next = { ...output }
  const hookSpecificOutput = { ...(next.hookSpecificOutput || {}) }
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== null && value !== '') hookSpecificOutput[key] = value
  }
  if (Object.keys(hookSpecificOutput).length) next.hookSpecificOutput = hookSpecificOutput
  return next
}

function normalizeHookEvent(eventName) {
  return String(eventName || '').trim().toLowerCase().replace(/[^a-z]/g, '')
}

function toolBlockOutput(eventName, reason, detail) {
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

function blockOutput(platform, eventName, reason, detail) {
  const event = normalizeHookEvent(eventName)
  const message = detail || reason
  if (platform === 'codex') {
    if (['pretooluse', 'permissionrequest'].includes(event)) {
      return toolBlockOutput(eventName, reason, detail)
    }
    if (['precompact', 'postcompact'].includes(event)) {
      return { continue: false, suppressOutput: false, stopReason: message }
    }
    if (['userpromptsubmit', 'stop', 'subagentstop', 'agentstop'].includes(event)) {
      return { decision: 'block', reason: message }
    }
    return toolBlockOutput(eventName, reason, detail)
  }
  if (platform === 'claude') {
    if (event === 'pretooluse') return toolBlockOutput(eventName, reason, detail)
    return { decision: 'block', reason: message }
  }
  return toolBlockOutput(eventName, reason, detail)
}

function systemMessageOutput(message) {
  return { continue: true, systemMessage: message }
}

function contextMessageOutput(eventName, message) {
  return {
    continue: true,
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: message
    }
  }
}

function warningOutput(reason, detail, eventName) {
  const message = `DevCodex hook warning: ${reason}${detail ? ` — ${detail}` : ''}`
  if (eventName === 'UserPromptSubmit') return contextMessageOutput(eventName, message)
  return systemMessageOutput(message)
}

function eventSupportsHardBlock(platform, eventName) {
  const event = normalizeHookEvent(eventName)
  if (platform === 'jetbrains-copilot' || platform === 'cursor' || platform === 'vscode-copilot') return false
  if (platform === 'claude') {
    return ['pretooluse', 'userpromptsubmit', 'posttooluse', 'stop', 'subagentstop', 'agentstop', 'precompact', 'configchange'].includes(event)
  }
  if (platform === 'codex') {
    return ['pretooluse', 'permissionrequest', 'userpromptsubmit', 'stop', 'subagentstop', 'agentstop', 'precompact', 'postcompact'].includes(event)
  }
  return ['pretooluse', 'permissionrequest'].includes(event)
}

function appendInterception(state, entry) {
  const record = {
    time: new Date().toISOString(),
    eventName: entry.eventName || '',
    platform: entry.platform || 'unknown',
    action: entry.action || INTERCEPTION_ACTION.LOG_ONLY,
    code: entry.code || '',
    effective: !!entry.effective,
    reason: entry.reason || '',
    nextStep: entry.nextStep || '',
    mode: state?.mode || '',
    enforcementMode: ENFORCEMENT_MODE,
    activeProject: state?.activeProject || ''
  }
  const targets = [getStatePaths(state)]
  if (LAYOUT.enabled && targets[0].file !== META_STATE_PATHS.file) targets.push(META_STATE_PATHS)
  for (const target of targets) {
    fs.mkdirSync(target.dir, { recursive: true })
    fs.appendFileSync(target.interceptionLog, `${JSON.stringify(record)}\n`)
  }
}

function recordInterception(state, eventName, platform, action, code, reason, nextStep, effective) {
  state.lastReason = code || reason || state.lastReason
  appendInterception(state, { eventName, platform, action, code, reason, nextStep, effective })
}

function buildInterceptionOutput(state, platform, eventName, action, code, reason, detail, nextStep) {
  const strict = isStrictEnforcement()
  const effective = action === INTERCEPTION_ACTION.FORBID ||
    (action === INTERCEPTION_ACTION.REQUIRE_COMPLETION && strict && eventSupportsHardBlock(platform, eventName))
  const output = effective
    ? blockOutput(platform, eventName, reason, detail)
    : warningOutput(reason, detail, eventName)
  recordInterception(state, eventName, platform, action, code, reason, nextStep, effective)
  return decorateHookOutput(output, {
    devcodexAction: action,
    devcodexCode: code,
    devcodexEffective: effective,
    devcodexNextStep: nextStep
  })
}

// ─── Multi-project workspace detection (v1.9.8+) ──────────────────────────────
function listWorkspaceProjects() {
  if (LAYOUT.enabled) {
    return collectWorkspaceProjectNamespaces(WORKSPACE_ROOT)
  }
  let entries
  try { entries = fs.readdirSync(WORKSPACE_ROOT) } catch { return [] }
  const projects = []
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const dir = path.join(WORKSPACE_ROOT, name)
    let stat
    try { stat = fs.statSync(dir) } catch { continue }
    if (!stat.isDirectory()) continue
    const hasPkg = fs.existsSync(path.join(dir, 'package.json'))
    const hasProfile = fs.existsSync(path.join(dir, '.devcodex', 'profile'))
    if (hasPkg || hasProfile) {
      projects.push(name)
    }
  }
  return projects
}

function isMultiProjectWorkspace() {
  return listWorkspaceProjects().length >= 2
}

function extractUserPrompt(payload) {
  return String(
    payload.prompt || payload.user_prompt || payload.userPrompt ||
    payload.message || payload.text || ''
  )
}

function hasMultiProjectExemption(prompt) {
  if (!prompt) return false
  const lower = prompt.toLowerCase()
  return MULTI_PROJECT_EXEMPTION_KEYWORDS.some(k => lower.includes(k.toLowerCase()))
}

function detectProjectFromPrompt(prompt) {
  if (!prompt) return ''
  const matches = detectPromptProjectMentions(prompt)
  return matches.length === 1 ? matches[0] : ''
}

function detectPromptProjectMentions(prompt) {
  if (!prompt) return []
  const matches = []
  for (const projectName of listWorkspaceProjects()) {
    const escaped = escapeRegExp(projectName)
    const boundary = '(?=$|[\\s,.;:，。；：])'
    const patterns = [
      new RegExp(`\\bin\\s+${escaped}(?:[\\\\/]|${boundary})`, 'i'),
      new RegExp(`\\bfor\\s+${escaped}(?:[\\\\/]|${boundary})`, 'i'),
      new RegExp(`对\\s*${escaped}\\s*项目`, 'i'),
      new RegExp(`项目\\s*${escaped}${boundary}`, 'i'),
      new RegExp(`project\\s+${escaped}${boundary}`, 'i'),
      new RegExp(`${escaped}\\s*(?:项目|的|中|里|下)`, 'i'),
      new RegExp(`${escaped}\\s+project\\b`, 'i'),
      new RegExp(`${escaped}(?:/|\\\\)`, 'i')
    ]
    if (patterns.some(pattern => pattern.test(prompt))) matches.push(projectName)
  }
  return [...new Set(matches)]
}

function detectProjectFromPayload(payload) {
  const strings = collectProjectPayloadStrings(payload).map(normalizeText).filter(Boolean)
  const projects = listWorkspaceProjects()
  const matches = []
  for (const projectName of projects) {
    const hit = strings.some(value => payloadValueMatchesProject(value, projectName))
    if (hit) matches.push(projectName)
  }
  return matches.length === 1 ? matches[0] : ''
}

function detectProjectCandidate(prompt, payload) {
  const promptProject = detectProjectFromPrompt(prompt)
  if (promptProject) return { project: promptProject, source: 'prompt' }
  const payloadProject = detectProjectFromPayload(payload)
  if (payloadProject) return { project: payloadProject, source: 'payload' }
  return { project: '', source: '' }
}

function detectProjectMentions(prompt, payload) {
  const matches = new Set(detectPromptProjectMentions(prompt))
  const strings = collectProjectPayloadStrings(payload).map(normalizeText).filter(Boolean)
  for (const projectName of listWorkspaceProjects()) {
    if (strings.some(value => payloadValueMatchesProject(value, projectName))) {
      matches.add(projectName)
    }
  }
  return [...matches]
}

function payloadValueMatchesProject(value, projectName) {
  const normalizedValue = normalizeText(value)
  const normalizedProject = normalizeText(projectName)
  const projectRoot = normalizeText(path.join(WORKSPACE_ROOT, projectName))
  const workspaceRoot = normalizeText(WORKSPACE_ROOT)
  if (!normalizedValue || !normalizedProject) return false
  if (normalizedValue === normalizedProject) return true
  if (normalizedValue === projectRoot || normalizedValue.startsWith(`${projectRoot}/`)) return true
  const isRemoteUrl = /^[a-z][a-z0-9+.-]*:\/\//.test(normalizedValue) &&
    !normalizedValue.startsWith('file://') &&
    !normalizedValue.includes(workspaceRoot)
  if (isRemoteUrl) return false
  return normalizedValue.startsWith(`${normalizedProject}/`) ||
    normalizedValue.includes(`/${normalizedProject}/`) ||
    normalizedValue.endsWith(`/${normalizedProject}`)
}

function getPayloadSessionKey(payload) {
  const candidates = [
    payload.session_id, payload.sessionId, payload.conversation_id, payload.conversationId,
    payload.thread_id, payload.threadId, payload.chat_id, payload.chatId,
    payload.transcript_path, payload.transcriptPath
  ]
  return candidates.map(value => String(value || '').trim()).find(Boolean) || ''
}

function getValidStickyProject(previousState, payload) {
  const sticky = previousState?.stickyProject || {}
  const project = String(sticky.project || '').trim()
  if (!project) return null
  const now = Date.now()
  const updatedAtMs = Number(sticky.updatedAtMs || 0)
  if (!updatedAtMs || now - updatedAtMs > STICKY_PROJECT_TTL_MS) return null
  const currentSessionKey = getPayloadSessionKey(payload)
  const stickySessionKey = String(sticky.sessionKey || '').trim()
  if (!currentSessionKey || !stickySessionKey) return null
  if (currentSessionKey && stickySessionKey && currentSessionKey !== stickySessionKey) return null
  return { project, source: sticky.source || 'sticky', sessionKey: stickySessionKey }
}

function setStickyProject(state, project, source, payload) {
  if (!project) return
  state.stickyProject = {
    project,
    source: source || 'unknown',
    sessionKey: getPayloadSessionKey(payload),
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now()
  }
}

function clearStickyProject(state, reason) {
  state.stickyProject = { project: '', source: '', sessionKey: '', updatedAt: '', updatedAtMs: 0, reason: reason || '' }
}

function resolvePromptTarget(previousState, payload, prompt, projectCandidate) {
  if (hasMultiProjectExemption(prompt)) {
    return { activeProject: '', activeScope: LAYOUT.enabled ? 'workspace' : 'project', source: 'workspace-exemption', clearSticky: true }
  }
  if (projectCandidate.project) {
    return { activeProject: projectCandidate.project, activeScope: 'project', source: projectCandidate.source || 'explicit' }
  }
  if (CONTEXT_PROJECT) {
    return { activeProject: CONTEXT_PROJECT, activeScope: 'project', source: 'context' }
  }
  if (detectProjectMentions(prompt, payload).length > 1) {
    return { activeProject: '', activeScope: LAYOUT.enabled ? 'workspace' : 'project', source: 'ambiguous-projects', clearSticky: true }
  }
  const sticky = getValidStickyProject(previousState, payload)
  if (sticky) {
    return { activeProject: sticky.project, activeScope: 'project', source: 'sticky' }
  }
  return { activeProject: '', activeScope: LAYOUT.enabled ? 'workspace' : DEFAULT_SCOPE, source: 'workspace' }
}

function readModeForPromptTarget(previousState, target) {
  if (target?.activeProject) return readProfileMode(previousState || null, target.activeProject)
  if (target?.activeScope === 'workspace') {
    return readProfileMode({ ...(previousState || {}), activeProject: '', activeScope: 'workspace' }, '')
  }
  return readProfileMode(previousState || null)
}

function applyPromptTarget(state, target, payload) {
  state.activeProject = target?.activeProject || ''
  state.activeScope = target?.activeScope || DEFAULT_SCOPE
  state.activeProjectSource = target?.source || ''
  if (target?.clearSticky) {
    clearStickyProject(state, target.source)
  } else if (target?.activeProject && target.source !== 'sticky') {
    setStickyProject(state, target.activeProject, target.source, payload)
  }
}

function buildMultiProjectWarningKey(payload) {
  return [
    getPayloadSessionKey(payload) || 'no-session',
    LAYOUT.enabled ? 'workspace-namespace' : 'legacy',
    listWorkspaceProjects().sort().join(',')
  ].join('|')
}

function shouldSuppressMultiProjectWarning(state, payload) {
  if (isStrictEnforcement()) return false
  const key = buildMultiProjectWarningKey(payload)
  if (state.lastMultiProjectWarningKey === key) return true
  state.lastMultiProjectWarningKey = key
  return false
}

function detectExecutionMode(payload) {
  const prompt = extractUserPrompt(payload)
  return /@devcodex-auto\b/i.test(prompt) ? EXECUTION_MODE.AUTO : EXECUTION_MODE.CONFIRM
}

function buildMultiProjectBlockMessage() {
  const profilePath = LAYOUT.enabled ? '.devcodex/workspace/profile/' : '.devcodex/profile/'
  const profileConfigPath = LAYOUT.enabled
    ? '.devcodex/workspace/profile/config.json'
    : '.devcodex/profile/config.json'
  return [
    '⚠️ Multi-project workspace detected.',
    `检测到当前工作区包含多个项目且未在工作区根配置 ${profilePath}。`,
    '请在提示词中明确指定目标项目（如“in cacheHub/”或“对 payment 项目”）后重发。',
    `当前布局期望的 workspace profile 配置为 ${profileConfigPath}；可在工作区根运行 devcodex profile init 生成。`,
    '豁免词：workspace / monorepo / 全工作区 / all projects / 所有项目。'
  ].join(' ')
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

function collectProjectPayloadStrings(value, keyPath = '', out = []) {
  if (typeof value === 'string') {
    if (isProjectPayloadKeyPath(keyPath)) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectProjectPayloadStrings(item, `${keyPath}[${index}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectProjectPayloadStrings(item, keyPath ? `${keyPath}.${key}` : key, out)
    }
  }
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

function extractTextContent(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(item => extractTextContent(item, depth + 1)).filter(Boolean).join('\n')
  }
  if (!value || typeof value !== 'object') return ''
  const parts = []
  for (const key of ['text', 'content', 'value', 'output_text', 'outputText', 'body']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const text = extractTextContent(value[key], depth + 1)
      if (text) parts.push(text)
    }
  }
  return parts.join('\n')
}

function isAssistantRecord(entry) {
  if (!entry || typeof entry !== 'object') return false
  const role = String(
    entry.role || entry.author?.role || entry.message?.role ||
    entry.data?.role || entry.data?.message?.role || ''
  ).trim().toLowerCase()
  const type = String(entry.type || entry.kind || entry.event || '').trim().toLowerCase()
  return role === 'assistant' || type === 'assistant' || type === 'assistant.message'
}

function extractAssistantRecordContent(entry) {
  if (!isAssistantRecord(entry)) return ''
  return extractTextContent(
    entry.content ?? entry.text ?? entry.value ??
    entry.message?.content ?? entry.data?.content ?? entry.data?.message?.content
  )
}

function extractLatestAssistantContentFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index--) {
    const text = extractAssistantRecordContent(messages[index])
    if (text.trim()) return text
  }
  return ''
}

function extractLatestAssistantContentFromChoices(choices) {
  if (!Array.isArray(choices)) return ''
  for (let index = choices.length - 1; index >= 0; index--) {
    const choice = choices[index]
    if (!choice || typeof choice !== 'object') continue
    const messageText = extractAssistantRecordContent(choice.message)
    if (messageText.trim()) return messageText
    const deltaText = extractTextContent(choice.delta?.content)
    if (deltaText.trim()) return deltaText
    const text = extractTextContent(choice.text)
    if (text.trim()) return text
  }
  return ''
}

function readTranscriptTail(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath.trim()) return ''
  const resolved = path.resolve(transcriptPath)
  let stat
  try { stat = fs.statSync(resolved) } catch { return '' }
  if (!stat.isFile()) return ''
  const start = Math.max(0, stat.size - TRANSCRIPT_TAIL_LIMIT)
  const length = stat.size - start
  let fd
  try { fd = fs.openSync(resolved, 'r') } catch { return '' }
  try {
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, start)
    return buffer.toString('utf8')
  } catch {
    return ''
  } finally {
    fs.closeSync(fd)
  }
}

function extractLatestAssistantContentFromTranscriptText(text) {
  if (!text || !String(text).trim()) return ''
  const parsed = safeJsonParse(text)
  if (Array.isArray(parsed)) {
    const messagesText = extractLatestAssistantContentFromMessages(parsed)
    if (messagesText.trim()) return messagesText
  } else if (parsed && typeof parsed === 'object') {
    const nestedMessagesText = extractLatestAssistantContentFromMessages(parsed.messages)
    if (nestedMessagesText.trim()) return nestedMessagesText
    const choicesText = extractLatestAssistantContentFromChoices(parsed.choices)
    if (choicesText.trim()) return choicesText
    const recordText = extractAssistantRecordContent(parsed)
    if (recordText.trim()) return recordText
  }
  const lines = String(text).split(/\r?\n/).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index--) {
    const entry = safeJsonParse(lines[index])
    const content = extractAssistantRecordContent(entry)
    if (content.trim()) return content
  }
  return ''
}

function extractLatestAssistantContentFromTranscript(transcriptPath) {
  const tail = readTranscriptTail(transcriptPath)
  return extractLatestAssistantContentFromTranscriptText(tail)
}

function getVisibleReplyEvidence(payload) {
  const directFieldNames = [
    'assistantMessage', 'assistant_message', 'response',
    'responseText', 'response_text', 'output', 'reply', 'content', 'message'
  ]
  for (const fieldName of directFieldNames) {
    if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) continue
    const text = extractTextContent(payload[fieldName])
    if (text.trim()) return { observed: true, text, source: fieldName }
  }
  const messagesText = extractLatestAssistantContentFromMessages(payload.messages)
  if (messagesText.trim()) return { observed: true, text: messagesText, source: 'messages' }
  const choicesText = extractLatestAssistantContentFromChoices(payload.choices)
  if (choicesText.trim()) return { observed: true, text: choicesText, source: 'choices' }
  if (Object.prototype.hasOwnProperty.call(payload, 'transcript')) {
    const transcriptText = extractLatestAssistantContentFromTranscriptText(payload.transcript)
    if (transcriptText.trim()) return { observed: true, text: transcriptText, source: 'transcript' }
  }
  const transcriptPath = payload.transcript_path || payload.transcriptPath
  const transcriptPathText = extractLatestAssistantContentFromTranscript(transcriptPath)
  if (transcriptPathText.trim()) return { observed: true, text: transcriptPathText, source: 'transcript_path' }
  return { observed: false, text: '', source: '' }
}

function getVisibleReplyText(payload) {
  return getVisibleReplyEvidence(payload).text
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
  return strings.some(s => needles.some(n => s.includes(normalizeText(n))))
}

function buildScopedNeedles(scopeRoot, segments) {
  return buildPathNeedles(path.join(scopeRoot, ...segments))
}

function getBootstrapScopes(state, payload) {
  const namespaceRoot = getActiveNamespaceRoot(state)
  const bootstrapAgent = getBootstrapAgent(state, payload)
  const memorySegments = ['.memory', 'clients']
  const memoryNeedles = bootstrapAgent
    ? buildScopedNeedles(namespaceRoot, [...memorySegments, bootstrapAgent])
    : buildScopedNeedles(namespaceRoot, memorySegments)
  const summaryNeedles = bootstrapAgent
    ? buildScopedNeedles(namespaceRoot, [...memorySegments, bootstrapAgent, 'SUMMARY.md'])
    : []
  const taskNeedles = bootstrapAgent
    ? getRecentBootstrapTaskStamps().flatMap(stamp => buildScopedNeedles(
      namespaceRoot,
      [...memorySegments, bootstrapAgent, 'tasks', `${stamp}.md`]
    ))
    : []
  const profileNeedles = buildScopedNeedles(namespaceRoot, ['profile'])
  if (LAYOUT.enabled && getActiveScope(state) !== 'workspace') {
    profileNeedles.push(...buildScopedNeedles(getWorkspaceNamespaceRoot(), ['profile']))
  }
  return {
    profileNeedles: [...new Set(profileNeedles)],
    memoryNeedles,
    summaryNeedles,
    taskNeedles
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

function buildDefaultState(mode) {
  const m = mode === 'dev' ? 'dev' : 'prod'
  return {
    version: 1, mode: m,
    executionMode: EXECUTION_MODE.CONFIRM,
    phase: 'bootstrapping',
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    promptCount: 0, toolUseCount: 0,
    activeProject: CONTEXT_PROJECT || '',
    activeScope: DEFAULT_SCOPE,
    activeProjectSource: CONTEXT_PROJECT ? 'context' : '',
    bootstrap: { profileRead: false, summaryRead: false, tasksRead: false },
    lastBootstrapWarningKey: '', lastClosureReminderKey: '', lastMultiProjectWarningKey: '',
    bootstrapComplete: false,
    visible: {
      payloadObserved: false, replyEvidence: 'unverified', replySource: '',
      precheckStatus: 'unverified', precheck: false, compliance: false, artifactPaths: false
    },
    stickyProject: { project: CONTEXT_PROJECT || '', source: CONTEXT_PROJECT ? 'context' : '', sessionKey: '', updatedAt: '', updatedAtMs: 0 },
    mutated: false, reportTouched: false, memoryTouched: false,
    dangerousApprovals: {},
    lastEvent: '', lastReason: ''
  }
}

function loadState(modeHint) {
  const metaState = readJsonFile(META_STATE_PATHS.file)
  let saved = metaState
  if (LAYOUT.enabled) {
    const preferredProject = String(metaState?.activeProject || CONTEXT_PROJECT || '').trim()
    const preferredScope = metaState?.activeScope || (preferredProject ? 'project' : DEFAULT_SCOPE)
    const activeState = readJsonFile(getStatePathsFor(preferredProject, preferredScope).file)
    if (activeState && typeof activeState === 'object') {
      saved = activeState
    } else if (CONTEXT_PROJECT) {
      const contextState = readJsonFile(getStatePathsFor(CONTEXT_PROJECT, 'project').file)
      if (contextState && typeof contextState === 'object') saved = contextState
    }
  }
  const mode = modeHint || readProfileMode(saved || metaState || null, saved?.activeProject || metaState?.activeProject || '')
  const current = buildDefaultState(mode)
  if (!saved || typeof saved !== 'object') return current
  return {
    ...current, ...saved, mode,
    bootstrap: { ...current.bootstrap, ...(saved.bootstrap || {}) },
    visible: { ...current.visible, ...(saved.visible || {}) },
    stickyProject: { ...current.stickyProject, ...(saved.stickyProject || {}), ...(metaState?.stickyProject || {}) },
    dangerousApprovals: { ...current.dangerousApprovals, ...(saved.dangerousApprovals || {}) }
  }
}

function saveState(state) {
  state.updatedAt = new Date().toISOString()
  const activePaths = getStatePaths(state)
  fs.mkdirSync(activePaths.dir, { recursive: true })
  fs.writeFileSync(activePaths.file, JSON.stringify(state, null, 2))
  if (LAYOUT.enabled && activePaths.file !== META_STATE_PATHS.file) {
    const metaState = {
      ...state,
      bootstrap: { ...(state.bootstrap || {}) },
      visible: { ...(state.visible || {}) },
      stickyProject: { ...(state.stickyProject || {}) },
      dangerousApprovals: { ...(state.dangerousApprovals || {}) }
    }
    fs.mkdirSync(META_STATE_PATHS.dir, { recursive: true })
    fs.writeFileSync(META_STATE_PATHS.file, JSON.stringify(metaState, null, 2))
  }
}

function resetState(mode, previousState) {
  const state = buildDefaultState(mode)
  state.promptCount = 1
  state.activeProject = previousState?.activeProject || CONTEXT_PROJECT || ''
  state.activeScope = previousState?.activeScope || DEFAULT_SCOPE
  state.activeProjectSource = previousState?.activeProjectSource || (CONTEXT_PROJECT ? 'context' : '')
  state.lastMultiProjectWarningKey = previousState?.lastMultiProjectWarningKey || ''
  state.stickyProject = { ...state.stickyProject, ...(previousState?.stickyProject || {}) }
  state.dangerousApprovals = { ...(previousState?.dangerousApprovals || {}) }
  saveState(state)
  return state
}

// ─── Bootstrap (Copilot dev mode only) ───────────────────────────────────────

function isBootstrapReadTool(payload, state) {
  const tn = getToolName(payload).toLowerCase()
  const scopes = getBootstrapScopes(state, payload)
  // Copilot: read_file/list_dir/file_search/grep_search/semantic_search
  // Claude Code: Read/Glob/Grep (PascalCase → lowercased above)
  const readPatterns = [
    /^read([_-]?file)?$/, /^list[_-]?dir$/, /^file[_-]?search$/,
    /^grep([_-]?search)?$/, /^semantic[_-]?search$/, /^glob$/
  ]
  if (readPatterns.some(p => p.test(tn))) {
    return (
      touchesPath(payload, ...scopes.profileNeedles) ||
      touchesPath(payload, ...scopes.memoryNeedles)
    )
  }
  const shellReadPatterns = [
    /^shell[_-]?command$/, /^run[_-]?in[_-]?terminal$/, /^send[_-]?to[_-]?terminal$/,
    /^bash$/, /^powershell$/
  ]
  if (!shellReadPatterns.some(p => p.test(tn))) return false
  if (!isReadOnlyBootstrapShellCommand(payload)) return false
  return (
    touchesPath(payload, ...scopes.profileNeedles) ||
    touchesPath(payload, ...scopes.memoryNeedles)
  )
}

function isPureReadTool(payload) {
  const tn = getToolName(payload).toLowerCase()
  const readPatterns = [
    /^read([_-]?file)?$/, /^list[_-]?dir$/, /^file[_-]?search$/,
    /^grep([_-]?search)?$/, /^semantic[_-]?search$/, /^glob$/
  ]
  return readPatterns.some(p => p.test(tn))
}

function isClarificationTool(payload) {
  return /^vscode[_-]?askquestions$/.test(getToolName(payload).toLowerCase())
}

function updateBootstrapState(state, payload) {
  const scopes = getBootstrapScopes(state, payload)
  const inputStrings = getToolInputStrings(payload)
  if (touchesPath(payload, ...scopes.profileNeedles)) state.bootstrap.profileRead = true
  if ((scopes.summaryNeedles.length && touchesPath(payload, ...scopes.summaryNeedles)) ||
    (!scopes.summaryNeedles.length &&
      touchesPath(payload, ...scopes.memoryNeedles) &&
      inputStrings.some(s => s.includes('/summary.md')))) {
    state.bootstrap.summaryRead = true
  }
  if ((scopes.taskNeedles.length && touchesPath(payload, ...scopes.taskNeedles)) ||
    (!scopes.taskNeedles.length &&
      touchesPath(payload, ...scopes.memoryNeedles) &&
      inputStrings.some(isRecentBootstrapTaskPath))) {
    state.bootstrap.tasksRead = true
  }
  state.bootstrapComplete = !!(
    state.bootstrap.profileRead && state.bootstrap.summaryRead && state.bootstrap.tasksRead
  )
  if (state.bootstrapComplete) state.phase = 'active'
}

function isReadOnlyBootstrapShellCommand(payload) {
  const command = getCommandText(payload)
  if (!command || !command.trim()) return false
  const cmd = command.toLowerCase()
  // Bootstrap should only allow a single, simple read-only command.
  if (/[;&|`]/.test(command) || /\$\(|\b(?:&&|\|\|)\b/.test(command)) return false
  // Block obvious write/mutation behaviors up front.
  if (
    />{1,2}/.test(command) ||
    /\b(set-content|add-content|out-file|tee|copy-item|move-item|remove-item|new-item|rename-item)\b/i.test(command) ||
    /\b(sc|ac|ni|ri|mi)\b/i.test(command) ||
    /\b(cp|mv|rm|del|erase|touch|mkdir|rmdir|git\s+add|git\s+commit|npm\s+install)\b/i.test(command)
  ) {
    return false
  }
  // Allow common read-only introspection commands.
  return /\b(get-content|cat|type|get-childitem|ls|dir|rg|findstr|select-string|head|tail|more|echo)\b/.test(cmd)
}

function buildBootstrapMessage() {
  return [
    'DevCodex hook-enforced bootstrap is active for this user message.',
    'Load the effective profile (legacy .devcodex/profile/ or workspace-namespace profile roots) and memory files under',
    'the active .devcodex namespace before any substantive work.',
    'Your first user-visible block must be the entry check PC0-PC7 before substantive task content; dev mode adds full PC4 diagnostics.',
    '*** S07 compaction trigger (v1.9.6+): if this turn resumes from /compact, /resume, or summary-restore,',
    'this also counts as "first user-visible reply" — you MUST re-output PC0-PC7 even when instructed to "continue without acknowledging".'
  ].join(' ')
}

function buildBootstrapDenyOutput(state, payload, eventName, platform) {
  const missing = []
  if (!state.bootstrap.profileRead) missing.push('profile')
  if (!state.bootstrap.summaryRead) missing.push('SUMMARY')
  if (!state.bootstrap.tasksRead) missing.push('tasks')
  const toolName = getToolName(payload) || 'tool'
  return buildInterceptionOutput(
    state, platform || 'copilot', eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'bootstrap-incomplete',
    `Blocked tool use before DevCodex bootstrap: ${toolName}`,
    `Read .devcodex/profile/ plus SUMMARY/tasks memory files first. Missing: ${missing.join(', ') || 'none'}.`,
    'Read the effective profile, SUMMARY, and today tasks file, then retry the tool.'
  )
}

function buildBootstrapWarningOutput(state, payload, eventName, platform) {
  const missing = []
  if (!state.bootstrap.profileRead) missing.push('profile')
  if (!state.bootstrap.summaryRead) missing.push('SUMMARY')
  if (!state.bootstrap.tasksRead) missing.push('tasks')
  const toolName = getToolName(payload) || 'tool'
  return buildInterceptionOutput(
    state, platform || 'copilot', eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'bootstrap-incomplete',
    `Bootstrap incomplete before ${toolName}`,
    `Read .devcodex/profile/ plus SUMMARY/tasks memory files as soon as possible. Missing: ${missing.join(', ') || 'none'}. Tool allowed in safety-only mode.`,
    'Read bootstrap files before substantive work.'
  )
}

function buildBootstrapWarningKey(state, payload) {
  const missing = []
  if (!state.bootstrap.profileRead) missing.push('profile')
  if (!state.bootstrap.summaryRead) missing.push('SUMMARY')
  if (!state.bootstrap.tasksRead) missing.push('tasks')
  return [state.promptCount || 0, missing.join(',')].join('|')
}

function buildDedupedBootstrapWarningOutput(state, payload, eventName, platform) {
  const key = buildBootstrapWarningKey(state, payload)
  if (state.lastBootstrapWarningKey === key) return noopOutput()
  state.lastBootstrapWarningKey = key
  return buildBootstrapWarningOutput(state, payload, eventName, platform)
}

// ─── CP Gate ─────────────────────────────────────────────────────────────────

function readCpConfirmations(reqPath) {
  const p = path.join(reqPath, '.memory', 'sessions.md')
  const none = { CP1: false, CP2: false, CP3: false, CP3Exempt: false }
  if (!fs.existsSync(p)) return none
  let text
  try { text = fs.readFileSync(p, 'utf8') } catch { return none }
  const confirmed = { CP1: false, CP2: false, CP3: false, CP3Exempt: false }
  const re = /\|\s*(CP[123])\s*\|\s*✅/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[1] in confirmed) confirmed[m[1]] = true
  }
  const cp3Exempt = /(?:\|\s*CP3\s*\|\s*N\/A\b|CP3\s*[:：]\s*N\/A)/i.test(text)
  if (cp3Exempt) {
    confirmed.CP3 = true
    confirmed.CP3Exempt = true
  }
  return confirmed
}

function directoryContainsFileMatching(dir, matcher, depth = 4) {
  if (!fs.existsSync(dir) || depth < 0) return false
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && matcher(entry.name, full)) return true
    if (entry.isDirectory() && directoryContainsFileMatching(full, matcher, depth - 1)) return true
  }
  return false
}

function hasTaskArtifact(task, phase) {
  const fullPath = task.fullPath
  if (phase === 'CP1') {
    if (fs.existsSync(path.join(fullPath, CP1_FILE))) return true
    if (task.kind === 'bugs') {
      return directoryContainsFileMatching(
        path.join(fullPath, 'reports'),
        name => /^01--.*CP1.*\.md$/i.test(name)
      )
    }
    return false
  }
  if (phase === 'CP2') {
    if (fs.existsSync(path.join(fullPath, CP2_FILE))) return true
    if (task.kind === 'bugs') {
      return directoryContainsFileMatching(
        path.join(fullPath, 'reports'),
        name => /^02--.*CP2.*\.md$/i.test(name)
      )
    }
    return false
  }
  if (phase === 'CP3') return fs.existsSync(path.join(fullPath, CP3_FILE))
  return false
}

function listTaskDirs(state) {
  const taskRoots = getTaskRoots(state)
  const out = []
  for (const root of taskRoots) {
    if (!fs.existsSync(root.dir)) continue
    let entries
    try { entries = fs.readdirSync(root.dir) } catch { continue }
    for (const name of entries) {
      const fullPath = path.join(root.dir, name)
      try {
        const s = fs.statSync(fullPath)
        if (s.isDirectory()) out.push({ kind: root.kind, name, fullPath, mtimeMs: s.mtimeMs || 0 })
      } catch { }
    }
  }
  return out.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
}

function getTaskRoots(state) {
  const namespaceRoot = getActiveNamespaceRoot(state)
  return [
    { kind: 'requirements', dir: path.join(namespaceRoot, 'requirements') },
    { kind: 'bugs', dir: path.join(namespaceRoot, 'bugs') },
    { kind: 'optimizations', dir: path.join(namespaceRoot, 'optimizations') },
    { kind: 'scenario-tests', dir: path.join(namespaceRoot, 'scenario-tests') }
  ]
}

function findIncompleteTask(state) {
  const dirs = listTaskDirs(state)
  if (!dirs.length) return null

  return dirs.find(d => {
    if (fs.existsSync(path.join(d.fullPath, '.archived'))) return false
    if (!hasTaskArtifact(d, 'CP1')) return false
    const cp = readCpConfirmations(d.fullPath)
    if (cp.CP3) return false
    if (!hasTaskArtifact(d, 'CP3')) return true
    return !cp.CP3
  }) || null
}

// Extract file paths from a PreToolUse payload (Claude Code + Copilot field names)
function extractToolPaths(payload) {
  if (!payload) return []
  const input = payload.tool_input || payload.toolInput || {}
  const out = []
  if (typeof input.input === 'string' && input.input) {
    const patchPathRe = /^\*\*\* (?:Update|Add|Delete) File:\s+(.+)$/gm
    let m
    while ((m = patchPathRe.exec(input.input)) !== null) {
      if (m[1]) out.push(m[1].trim())
    }
  }
  if (typeof input.file_path === 'string' && input.file_path) out.push(input.file_path)
  if (typeof input.filePath === 'string' && input.filePath) out.push(input.filePath)
  if (typeof input.path === 'string' && input.path && /[/\\]/.test(input.path)) out.push(input.path)
  if (Array.isArray(input.files)) {
    for (const f of input.files) if (typeof f === 'string' && f) out.push(f)
  }
  // F-006: 从 Bash 命令文本中提取路径（重定向 / tee / Set-Content / Out-File / cp / mv / rm 第一参数）
  if (typeof input.command === 'string' && input.command) {
    const cmd = input.command
    const pathPatterns = [
      />{1,2}\s*['"]?([^\s'";&|]+)/g,
      /\btee\s+(?:-a\s+)?['"]?([^\s'";&|]+)/gi,
      /\bSet-Content\b\s+(?:-Path\s+)?['"]?([^\s'";&|]+)/gi,
      /\bOut-File\b\s+(?:-FilePath\s+)?['"]?([^\s'";&|]+)/gi,
      /\b(?:cp|mv|rm|cat|touch)\s+(?:-[a-zA-Z]+\s+)*['"]?([^\s'";&|]+)/g
    ]
    for (const re of pathPatterns) {
      let m
      while ((m = re.exec(cmd)) !== null) {
        if (m[1] && /[/\\]|\.[a-zA-Z0-9]+$/.test(m[1])) out.push(m[1])
      }
    }
  }
  return out.map(p => { try { return path.normalize(p) } catch { return p } }).filter(Boolean)
}

// Map a file path to its owning task scope (.devcodex/requirements/<X>/... or .devcodex/bugs/<X>/...).
// returns null when the path is not under any supported task directory.
function getTaskScopeFromPath(p, state) {
  if (!p) return null
  let abs = resolveRelativeToContext(p)
  const norm = path.normalize(abs)
  for (const root of getTaskRoots(state)) {
    const rootDir = path.normalize(root.dir)
    if (!norm.toLowerCase().startsWith(rootDir.toLowerCase() + path.sep)) continue
    const rel = path.relative(rootDir, norm)
    const parts = rel.split(path.sep).filter(Boolean)
    if (!parts.length) return null
    return {
      kind: root.kind,
      name: parts[0],
      fullPath: path.join(root.dir, parts[0])
    }
  }
  return null
}

function toWorkspaceRelativePath(p) {
  if (!p) return ''
  let abs = resolveRelativeToContext(p)
  let rel = abs
  try { rel = path.isAbsolute(abs) ? path.relative(WORKSPACE_ROOT, abs) : abs } catch { }
  return String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

function isAutoAllowedPath(p) {
  const rel = toWorkspaceRelativePath(p)
  return AUTO_ALLOWED_PATH_PATTERNS.some(re => re.test(rel))
}

function checkAutoWhitelist(payload, platform, state) {
  if (state.executionMode !== EXECUTION_MODE.AUTO) return null
  if (!isSourceCodeMutation(payload, platform, state)) return null
  const paths = [...new Set(extractToolPaths(payload))]
  if (!paths.length) {
    return {
      allowed: false,
      reason: 'Auto v1.1 无法识别当前变更目标路径，不能安全判定是否属于白名单。'
    }
  }
  const nonWhitelisted = paths.filter(p => !isAutoAllowedPath(p))
  if (!nonWhitelisted.length) return { allowed: true }
  const preview = nonWhitelisted.map(toWorkspaceRelativePath).slice(0, 3).join(', ')
  return {
    allowed: false,
    reason: `Auto v1.1 仅对白名单路径自动推进，以下目标不在白名单内：${preview}`
  }
}

// Path-aware CP gate: when all tool paths belong to specific task dirs,
// only check those tasks' CP status (avoids cross-task deny).
// Falls back to global findIncompleteTask() for mixed/source-code paths.
function findIncompleteTaskForPaths(payload, state) {
  const paths = extractToolPaths(payload)
  if (paths.length === 0) return findIncompleteTask(state)

  const taskScopes = paths.map(p => getTaskScopeFromPath(p, state))
  const allInTask = taskScopes.every(scope => scope !== null)
  if (!allInTask) return findIncompleteTask(state)  // mixed or source-code → preserve original behavior

  const targetMap = new Map()
  for (const scope of taskScopes) targetMap.set(`${scope.kind}:${scope.name}`, scope)
  for (const task of targetMap.values()) {
    if (!fs.existsSync(task.fullPath)) continue
    if (fs.existsSync(path.join(task.fullPath, '.archived'))) continue
    if (!hasTaskArtifact(task, 'CP1')) continue
    const cp = readCpConfirmations(task.fullPath)
    if (cp.CP3) continue
    if (!hasTaskArtifact(task, 'CP3')) return task
    if (!cp.CP3) return task
  }
  return null  // all target tasks have CP3 confirmed → allow
}

function checkCpGate(payload, state) {
  const task = (payload && extractToolPaths(payload).length > 0)
    ? findIncompleteTaskForPaths(payload, state)
    : findIncompleteTask(state)
  if (!task) return null
  const confirmed = readCpConfirmations(task.fullPath)
  if (!hasTaskArtifact(task, 'CP2') || !confirmed.CP2) {
    return { phase: 'CP2', reqName: task.name, reqPath: task.fullPath, kind: task.kind }
  }
  return { phase: 'CP3', reqName: task.name, reqPath: task.fullPath, kind: task.kind }
}

// Source file extensions that indicate code/config being written
const SOURCE_EXT_RE = /\.(js|ts|tsx|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|c|cpp|h|swift|kt|vue|svelte|css|scss|less|html|sql|sh|bash|zsh|ps1|psm1|json|yaml|yml|toml|ini|xml|env)$/i
// F-001/F-037: only governance deployment paths and the active .devcodex namespace are exempt.
// This prevents workspace-namespace projects from treating project/.devcodex/.tmp as managed state.
const DEVCODEX_DEPLOYMENT_PATH_RE = /^(?:\.claude|\.github)\/(?:instructions|skills|hooks|agents|prompts|settings\.json|settings\.local\.json|data)(?:\/|$)|^AGENTS\.md$|^\.agents\/skills(?:\/|$)|^\.codex\/(?:hooks\.json|hooks)(?:\/|$)|^codex\/(?:hooks\.json|hooks)(?:\/|$)/

function isInsideOrSamePath(child, parent) {
  if (!child || !parent) return false
  const normChild = path.normalize(child).toLowerCase()
  const normParent = path.normalize(parent).toLowerCase()
  return normChild === normParent || normChild.startsWith(normParent + path.sep)
}

function isActiveDevCodexNamespacePath(target, state) {
  if (!target) return false
  const abs = resolveRelativeToContext(target)
  if (isInsideOrSamePath(abs, getActiveNamespaceRoot(state))) return true
  if (LAYOUT.enabled && getActiveScope(state) !== 'workspace') {
    return isInsideOrSamePath(abs, path.join(getWorkspaceNamespaceRoot(), 'profile'))
  }
  return false
}

function isDevCodexManagedPath(target, state) {
  if (!target) return false
  const rel = toWorkspaceRelativePath(target)
  if (DEVCODEX_DEPLOYMENT_PATH_RE.test(rel)) return true
  return isActiveDevCodexNamespacePath(target, state)
}

function payloadTouchesOnlyManagedPaths(payload, state) {
  const paths = [...new Set(extractToolPaths(payload))]
  return paths.length > 0 && paths.every(p => isDevCodexManagedPath(p, state))
}

function bashWritesToSourceCode(cmd, state) {
  if (!cmd) return false
  // Detect output redirect  >  or  >>  to a source file
  const redirectRe = />{1,2}\s*['"]?([^\s'";&|]+)/g
  let m
  while ((m = redirectRe.exec(cmd)) !== null) {
    const target = m[1]
    if (SOURCE_EXT_RE.test(target) && !isDevCodexManagedPath(target, state)) return true
  }
  // Detect tee targeting a source file
  const teeRe = /\btee\s+(?:-a\s+)?['"]?([^\s'";&|]+)/g
  while ((m = teeRe.exec(cmd)) !== null) {
    const target = m[1]
    if (SOURCE_EXT_RE.test(target) && !isDevCodexManagedPath(target, state)) return true
  }
  // PowerShell Set-Content / Out-File — extract target path before testing
  const setContentMatch = cmd.match(/\bSet-Content\b\s+(?:-Path\s+)?['"]?([^\s'";&|]+)/i)
  if (setContentMatch && SOURCE_EXT_RE.test(setContentMatch[1]) && !isDevCodexManagedPath(setContentMatch[1], state)) return true
  const outFileMatch = cmd.match(/\bOut-File\b\s+(?:-FilePath\s+)?['"]?([^\s'";&|]+)/i)
  if (outFileMatch && SOURCE_EXT_RE.test(outFileMatch[1]) && !isDevCodexManagedPath(outFileMatch[1], state)) return true
  return false
}

function isSourceCodeMutation(payload, platform, state) {
  const toolName = getToolName(payload)
  const lower = toolName.toLowerCase()

  if (platform === 'claude') {
    // Write/Edit tools
    if (lower === 'write' || lower === 'edit') {
      return !payloadTouchesOnlyManagedPaths(payload, state)
    }
    // Bash: detect redirect/tee writes to source files
    if (lower === 'bash') {
      return bashWritesToSourceCode(getCommandText(payload), state)
    }
    return false
  }

  // Copilot / Codex / instruction-fallback shell tools
  if (['bash', 'shell_command', 'run_in_terminal', 'powershell'].includes(lower)) {
    return bashWritesToSourceCode(getCommandText(payload), state)
  }

  // Copilot / Codex patch-style tools
  const copilotWritePatterns = [
    /^apply[_-]?patch$/,
    /^create[_-]?file$/,
    /^str[_-]?replace[_-]?(based[_-]?edit|editor)?$/,
    /^insert[_-]?code[_-]?at[_-]?line$/,
    /^rewrite[_-]?file$/
  ]
  if (!copilotWritePatterns.some(p => p.test(lower))) return false
  return !payloadTouchesOnlyManagedPaths(payload, state)
}

function buildCpDenyOutput(state, platform, eventName, gate, toolName) {
  const msgs = {
    CP2: 'CP2 (技术方案) 未完成 — 请先输出对应的 CP2 方案产物（如 02-技术方案.md 或 CP2 报告产物），并在 .memory/sessions.md 记录用户确认（✅）后再编码。',
    CP3: `CP3 (实施计划) 未完成 — 请先输出 ${CP3_FILE} 并在 .memory/sessions.md 记录用户确认（✅）后再编码。`
  }
  const msg = msgs[gate.phase]
  return buildInterceptionOutput(
    state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, `cp-gate-${gate.phase}`,
    `CP gate: ${gate.phase} not confirmed for "${gate.reqName}" — ${toolName} denied`,
    msg,
    `Complete and confirm ${gate.phase}, then retry the source mutation.`
  )
}

function buildCpWarningOutput(state, platform, eventName, gate, toolName) {
  const detail = gate.phase === 'CP2'
    ? 'CP2 (技术方案) 未完成；请尽快补齐方案产物与用户确认记录。'
    : `CP3 (实施计划) 未完成；请尽快补齐 ${CP3_FILE} 与用户确认记录。`
  return buildInterceptionOutput(
    state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, `cp-gate-${gate.phase}`,
    `CP gate warning: ${gate.phase} not confirmed for "${gate.reqName}" before ${toolName}`,
    `${detail} Tool allowed in safety-only mode.`,
    `Complete and confirm ${gate.phase}, then retry the source mutation.`
  )
}

// ─── Dangerous command detection ──────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  { re: /\brm\s+-rf\s+(?:\/|[A-Za-z]:\\?)(?:\s|$)/i, reason: 'Blocked: rm -rf root', neverApprove: true },
  { re: /\brm\s+-rf\b/i, reason: 'Blocked: rm -rf' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'Blocked: git reset --hard' },
  { re: /\bdrop\s+table\b/i, reason: 'Blocked: DROP TABLE', neverApprove: true },
  { re: /\bdelete\s+from\b(?:(?!\bwhere\b|;)[\s\S])*(?:;|$)/i, reason: 'Blocked: DELETE FROM without WHERE', neverApprove: true },
  { re: /\btruncate\b/i, reason: 'Blocked: TRUNCATE', neverApprove: true },
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
  const readOnlySearch = /^\s*(?:rg|grep|Select-String)\b/i.test(cmd)
  if (readOnlySearch && !/[;&|`$()]/.test(cmd.replace(/["'][^"']*["']/g, ''))) return null
  const danger = DANGEROUS_PATTERNS.find(p => p.re.test(stripApprovalMarker(cmd)))
  if (!danger) return null
  return { ...danger, command: cmd }
}

function stripApprovalMarker(command) {
  return String(command || '')
    .replace(/(?:#\s*)?\bdevcodex-approve:([a-f0-9]{12})\b/ig, '')
    .replace(/\s+#\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractApprovalId(command) {
  const m = String(command || '').match(/\bdevcodex-approve:([a-f0-9]{12})\b/i)
  return m ? m[1].toLowerCase() : ''
}

function hashDangerousCommand(command, cwd) {
  const canonical = `${path.resolve(cwd || CONTEXT_ROOT)}\n${stripApprovalMarker(command)}`
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function pruneDangerousApprovals(state) {
  const approvals = state.dangerousApprovals || {}
  const now = Date.now()
  for (const [id, approval] of Object.entries(approvals)) {
    if (!approval || approval.used || now - Number(approval.createdAtMs || 0) > APPROVAL_TTL_MS) {
      delete approvals[id]
    }
  }
  state.dangerousApprovals = approvals
}

function createDangerousApproval(state, danger) {
  pruneDangerousApprovals(state)
  const commandHash = hashDangerousCommand(danger.command, CONTEXT_ROOT)
  const approvalId = commandHash.slice(0, 12)
  const existing = state.dangerousApprovals?.[approvalId]
  if (existing && !existing.used && existing.commandHash === commandHash && existing.cwd === path.resolve(CONTEXT_ROOT)) {
    return approvalId
  }
  state.dangerousApprovals[approvalId] = {
    commandHash,
    cwd: path.resolve(CONTEXT_ROOT),
    reason: danger.reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    used: false
  }
  return approvalId
}

function extractApprovalIds(text) {
  return [...String(text || '').matchAll(/\bdevcodex-approve:([a-f0-9]{12})\b/ig)].map(match => match[1].toLowerCase())
}

function promptConfirmsDangerousApproval(prompt) {
  const text = String(prompt || '')
  if (/(?:不(?:确认|同意|批准|允许|执行)|不要|拒绝|deny|do\s+not|don't|not\s+approve)/i.test(text)) return false
  return /(?:确认|同意|批准|允许|执行|继续|重试|approve|approved|confirm|confirmed|yes|ok|okay|proceed|continue)/i.test(text)
}

function confirmDangerousApprovalsFromPrompt(state, prompt, eventName, platform) {
  pruneDangerousApprovals(state)
  const ids = extractApprovalIds(prompt)
  if (!ids.length || !promptConfirmsDangerousApproval(prompt)) return []
  const confirmed = []
  for (const approvalId of ids) {
    const approval = state.dangerousApprovals?.[approvalId]
    if (!approval || approval.used || approval.status === 'confirmed') continue
    approval.status = 'confirmed'
    approval.confirmedAt = new Date().toISOString()
    approval.confirmedBy = 'UserPromptSubmit'
    confirmed.push(approvalId)
    recordInterception(
      state, eventName, platform, INTERCEPTION_ACTION.LOG_ONLY, 'dangerous-command-confirmed',
      approval.reason || 'dangerous command approval confirmed',
      `Dangerous command approval ${approvalId} confirmed by user prompt.`, true
    )
  }
  return confirmed
}

function consumeDangerousApproval(state, danger) {
  pruneDangerousApprovals(state)
  const approvalId = extractApprovalId(danger.command)
  if (!approvalId) return { approved: false }
  const approval = state.dangerousApprovals?.[approvalId]
  const commandHash = hashDangerousCommand(danger.command, CONTEXT_ROOT)
  if (!approval || approval.used || approval.status !== 'confirmed' || approval.commandHash !== commandHash || approval.cwd !== path.resolve(CONTEXT_ROOT)) {
    return { approved: false, approvalId }
  }
  approval.used = true
  approval.status = 'used'
  approval.usedAt = new Date().toISOString()
  return { approved: true, approvalId }
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
  return getVisibleReplyEvidence(payload).observed
}

function hasArtifactPathOutput(text) {
  const lines = String(text || '').split(/\r?\n/)
  let inArtifactSection = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*📂\s*本次会话产物[:：]?\s*$/.test(line)) {
      inArtifactSection = true
      continue
    }
    if (!inArtifactSection) continue
    if (!/^\s*-\s*\[[^\]]+\]\([^\)]+\)\s*$/.test(line)) continue
    const nextLine = String(lines[index + 1] || '').trim()
    if (/^`?[A-Za-z]:\\.+`?$/.test(nextLine)) return true
    if (/^(?:绝对路径|Absolute path)[:：]\s*`?[A-Za-z]:\\.+`?$/.test(nextLine)) return true
    return true
  }
  return false
}

function updateVisibleReplyState(state, payload, eventName) {
  if (eventName !== 'PreCompact' && eventName !== 'Stop') return
  const evidence = getVisibleReplyEvidence(payload)
  state.visible.replyEvidence = evidence.observed ? 'verified' : 'unverified'
  state.visible.replySource = evidence.source || ''
  if (!evidence.observed) return
  const text = evidence.text
  state.visible.payloadObserved = true
  if (/入口检查（|预检查（DEV 模式）|PC0 上下文/.test(text)) {
    state.visible.precheck = true
    state.visible.precheckStatus = 'verified-present'
  } else if (!state.visible.precheck) {
    state.visible.precheckStatus = 'verified-missing'
  }
  if (/🛡️ DEV 模式 \| 合规检查|FC:\s*FC1/.test(text)) state.visible.compliance = true
  if (hasArtifactPathOutput(text)) state.visible.artifactPaths = true
}

function captureFinalPayloadSample(payload, eventName, state) {
  const statePaths = getStatePaths(state)
  if ((eventName !== 'PreCompact' && eventName !== 'Stop') || !fs.existsSync(statePaths.finalPayloadFlag)) return
  fs.mkdirSync(statePaths.dir, { recursive: true })
  const snap = {
    capturedAt: new Date().toISOString(), eventName,
    payloadKeys: Object.keys(payload).sort(),
    visiblePayloadDetected: hasVisibleReplyPayload(payload),
    interestingStrings: collectInterestingStrings(payload),
    state: { mode: state.mode, executionMode: state.executionMode, phase: state.phase, mutated: state.mutated }
  }
  fs.appendFileSync(statePaths.finalPayloadLog, `${JSON.stringify(snap)}\n`)
  if (eventName === 'Stop') fs.unlinkSync(statePaths.finalPayloadFlag)
}

// ─── Closure reminder ─────────────────────────────────────────────────────────

function getPrecheckEvidenceStatus(state) {
  if (state.visible?.precheck) return 'verified-present'
  if (state.visible?.precheckStatus === 'verified-missing') return 'verified-missing'
  if (state.visible?.payloadObserved) return 'verified-missing'
  return 'unverified'
}

function buildClosureReminder(state, eventName) {
  const items = []
  const precheckStatus = getPrecheckEvidenceStatus(state)
  if (eventName === 'Stop' && precheckStatus === 'verified-missing') {
    items.push('entry check block 未输出（S07/C18：首条用户可见回复必须含 PC0~PC7 入口检查块）')
  } else if (eventName === 'Stop' && precheckStatus === 'unverified') {
    items.push(`无法验证最终用户可见回复是否包含入口检查块（Stop/PreCompact 未提供可解析 assistant 内容；如需取证请创建 ${getStatePaths(state).finalPayloadFlag} 后重试）`)
  }
  if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && state.visible && !state.visible.compliance) {
    items.push('合规检查状态块未输出（17-compliance：dev 模式非 chat 回复末尾必须含 🛡️ DEV 模式 | 合规检查 状态块）')
  }
  if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && state.visible && !state.visible.artifactPaths) {
    items.push('产物路径未输出（FC5/T9：回复末尾必须在 📂 本次会话产物 区块列出 Markdown 链接）')
  }
  if (state.mutated && !state.memoryTouched) items.push('记忆文件尚未写入（S05：会话结束前必须写入）')
  if (state.mutated && !state.reportTouched) items.push('报告文件尚未写入（chat 工作流豁免）')
  if (!items.length) return ''
  return `DevCodex closure reminder: ${items.join('; ')}.`
}

function buildDedupedClosureReminder(state, eventName) {
  const reminder = buildClosureReminder(state, eventName)
  if (!reminder) return ''
  const key = [eventName, state.promptCount || 0, reminder].join('|')
  if (state.lastClosureReminderKey === key) return ''
  state.lastClosureReminderKey = key
  return reminder
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
  const prompt = eventName === 'UserPromptSubmit' ? extractUserPrompt(payload) : ''
  const projectCandidate = eventName === 'UserPromptSubmit'
    ? detectProjectCandidate(prompt, payload)
    : { project: '', source: '' }
  let state = loadState()
  const promptTarget = eventName === 'UserPromptSubmit'
    ? resolvePromptTarget(state, payload, prompt, projectCandidate)
    : null
  if (eventName === 'UserPromptSubmit') {
    state = loadState(readModeForPromptTarget(state, promptTarget))
  }
  const mode = state.mode

  updateVisibleReplyState(state, payload, eventName)
  state.lastEvent = eventName || state.lastEvent

  // ── UserPromptSubmit ───────────────────────────────────────────────────────
  if (eventName === 'UserPromptSubmit') {
    state = resetState(mode, state)
    state.executionMode = detectExecutionMode(payload)
    confirmDangerousApprovalsFromPrompt(state, prompt, eventName, platform)
    applyPromptTarget(state, promptTarget, payload)
    // Multi-project workspace guard (v1.9.8+):
    // when no workspace-root profile exists and ≥2 sibling projects detected,
    // require the user to specify the target project explicitly.
    const hasWorkspaceProfile = fs.existsSync(getWorkspaceProfileConfigPath())
    if (!hasWorkspaceProfile && isMultiProjectWorkspace()) {
      if (!hasMultiProjectExemption(prompt) && !state.activeProject) {
        if (!shouldSuppressMultiProjectWarning(state, payload)) {
          state.lastReason = 'multi-project-workspace-block'
          const detail = isStrictEnforcement()
            ? buildMultiProjectBlockMessage()
            : `${buildMultiProjectBlockMessage()} Prompt allowed in safety-only mode.`
          const output = buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'multi-project-workspace',
            'multi-project-workspace', detail, 'Specify the target project or use a workspace-level exemption keyword.'
          )
          saveState(state)
          writeStdout(output)
          return
        }
      }
    }
    saveState(state)
    writeStdout(contextMessageOutput('UserPromptSubmit', buildBootstrapMessage()))
    return
  }

  // ── PreToolUse ─────────────────────────────────────────────────────────────
  const isToolUse = eventName === 'PreToolUse' || (!eventName && getToolName(payload))

  if (isToolUse) {
    state.toolUseCount += 1

    // 1. Dangerous command guard
    const danger = checkDangerousCommand(payload, platform)
    if (danger) {
      const approval = consumeDangerousApproval(state, danger)
      if (approval.approved) {
        recordInterception(
          state, eventName, platform, INTERCEPTION_ACTION.LOG_ONLY, 'dangerous-command-approved',
          danger.reason, `One-time approval ${approval.approvalId} consumed.`, true
        )
      } else {
        const approvalId = danger.neverApprove ? '' : createDangerousApproval(state, danger)
        const detail = danger.neverApprove
          ? `${danger.reason} — 该命令属于不可放行危险操作，请改用安全替代方案（S06）。`
          : `${danger.reason} — 请先输出命令预览并等待用户明确确认（S06）。确认后可在同一 cwd、10 分钟内以 devcodex-approve:${approvalId} 重试同一命令。`
        const output = buildInterceptionOutput(
          state, platform, eventName, INTERCEPTION_ACTION.FORBID, 'dangerous-command',
          danger.reason, detail, danger.neverApprove ? 'Use a safe alternative command.' : `Get explicit user approval, then retry with devcodex-approve:${approvalId}.`
        )
        saveState(state)
        writeStdout(output)
        return
      }
      saveState(state)
    }

    // 2. Bootstrap enforcement (all modes, both Copilot and Claude Code)
    if (!state.bootstrapComplete) {
      if (isPureReadTool(payload) || isClarificationTool(payload)) {
        updateBootstrapState(state, payload)
        state.lastReason = 'bootstrap-read-or-clarification-allowed'
        saveState(state)
        writeStdout(noopOutput())
        return
      }
      if (!isBootstrapReadTool(payload, state)) {
        state.lastReason = 'blocked-before-bootstrap'
        const output = isStrictEnforcement()
          ? buildBootstrapDenyOutput(state, payload, eventName, platform)
          : buildDedupedBootstrapWarningOutput(state, payload, eventName, platform)
        saveState(state)
        writeStdout(output)
        return
      }
      updateBootstrapState(state, payload)
    }

    // 2.5. Auto v1.1 whitelist gate — only whitelisted governance/test/docs paths can bypass CP gate
    const autoWhitelist = checkAutoWhitelist(payload, platform, state)
    if (autoWhitelist && autoWhitelist.allowed) {
      state.lastReason = 'auto-whitelist-bypass'
      updateArtifactTouches(state, payload, platform)
      saveState(state)
      writeStdout(noopOutput())
      return
    }
    if (autoWhitelist && !autoWhitelist.allowed) {
      state.lastReason = 'auto-non-whitelist-block'
      saveState(state)
      if (isStrictEnforcement()) {
        writeStdout(buildInterceptionOutput(
          state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'auto-whitelist-boundary',
          'auto-whitelist-boundary',
          `${autoWhitelist.reason} — 请切回确认模式，或先把变更范围收敛到白名单路径。`,
          'Switch back to confirm mode or keep the mutation within the auto whitelist.'
        ))
      } else {
        writeStdout(buildInterceptionOutput(
          state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'auto-whitelist-boundary',
          'auto-whitelist-boundary',
          `${autoWhitelist.reason} Tool allowed in safety-only mode.`,
          'Switch back to confirm mode or keep the mutation within the auto whitelist.'
        ))
      }
      return
    }

    // 3. CP gate — block source code mutations until checkpoints confirmed
    //    payload-aware: when tool paths target specific requirement dirs, only that requirement's CP is checked
    const gate = checkCpGate(payload, state)
    if (gate && isSourceCodeMutation(payload, platform, state)) {
      state.lastReason = `cp-gate-${gate.phase}`
      saveState(state)
      writeStdout(isStrictEnforcement()
        ? buildCpDenyOutput(state, platform, eventName, gate, getToolName(payload) || 'tool')
        : buildCpWarningOutput(state, platform, eventName, gate, getToolName(payload) || 'tool'))
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
    const reminder = buildDedupedClosureReminder(state, eventName)
    let output = reminder ? systemMessageOutput(reminder) : noopOutput()
    if (reminder) {
      output = buildInterceptionOutput(
        state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'closure-incomplete',
        'DevCodex closure incomplete', reminder,
        eventName === 'Stop'
          ? 'Complete the missing entry/compliance/artifact/memory/report items before ending.'
          : 'Persist missing state before compacting.'
      )
    }
    saveState(state)
    writeStdout(output)
    return
  }

  saveState(state)
  writeStdout(noopOutput())
}

main().catch(err => {
  process.stderr.write(`DevCodex hook error: ${err.message}\n`)
  process.exit(1)
})
