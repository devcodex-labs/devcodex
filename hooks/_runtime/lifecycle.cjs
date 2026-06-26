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
const { buildLifecycleBootstrapStateUtils } = require('./lifecycle-bootstrap-state.cjs')
const { buildLifecycleDangerousCommandUtils } = require('./lifecycle-dangerous-command.cjs')
const { buildLifecycleGovernanceIntakeUtils } = require('./lifecycle-governance-intake.cjs')
const { buildLifecycleHookOutput } = require('./lifecycle-hook-output.cjs')
const { buildLifecycleNamespaceStateUtils } = require('./lifecycle-namespace-state.cjs')
const { buildLifecyclePayloadUtils } = require('./lifecycle-payload-utils.cjs')
const { buildLifecycleProjectTargetUtils } = require('./lifecycle-project-target.cjs')
const { buildLifecycleVisibleReplyUtils } = require('./lifecycle-visible-reply.cjs')
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
const CP1_FILES = ['01-需求确认.md', '01-产品需求.md', '01-需求概述.md']
const CP2_FILE = '02-技术方案.md'
const CP3_FILE = '04-实施计划.md'
const CP3_RUNTIME_FILE_THRESHOLD = 5
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
// ─── Platform-specific output builders ───────────────────────────────────────

const {
  detectPlatform,
  noopOutput,
  isStrictEnforcement,
  decorateHookOutput,
  blockOutput,
  systemMessageOutput,
  contextMessageOutput,
  warningOutput,
  eventSupportsHardBlock
} = buildLifecycleHookOutput({
  env: process.env,
  enforcementMode: ENFORCEMENT_MODE
})

const {
  resolveProjectName,
  resolveRelativeToContext,
  buildPathNeedles,
  getWorkspaceNamespaceRoot,
  getProjectNamespaceRoot,
  getStatePathsFor,
  getStatePaths,
  getActiveScope,
  getWorkspaceProfileConfigPath,
  getProjectRoot,
  getActiveProjectRoot,
  getActiveNamespaceRoot,
  readResolvedProfileConfig,
  readProfileMode,
  readProjectProfileConfig,
  listMemoryAgents,
  inferBootstrapAgent,
  getBootstrapAgent,
  META_STATE_PATHS
} = buildLifecycleNamespaceStateUtils({
  fs,
  path,
  CONTEXT_ROOT,
  WORKSPACE_ROOT,
  LAYOUT,
  CONTEXT_PROJECT,
  DEFAULT_SCOPE,
  META_STATE_SCOPE_KEY,
  readJsonFile,
  mergeConfig,
  detectPlatform
})

const STATE_DIR = META_STATE_PATHS.dir
const STATE_FILE = META_STATE_PATHS.file
const FINAL_PAYLOAD_FLAG = META_STATE_PATHS.finalPayloadFlag
const FINAL_PAYLOAD_LOG = META_STATE_PATHS.finalPayloadLog
const INTERCEPTION_LOG = META_STATE_PATHS.interceptionLog

const {
  emptyGovernanceIntakeState,
  buildGovernanceIntakeCandidate,
  updateGovernanceIntakeResolutionState,
  buildGovernanceIntakeReminderItem
} = buildLifecycleGovernanceIntakeUtils()

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
const {
  listWorkspaceProjects,
  isMultiProjectWorkspace,
  extractUserPrompt,
  hasMultiProjectExemption,
  detectProjectCandidate,
  getPayloadSessionKey,
  resolvePromptTarget,
  readModeForPromptTarget,
  applyPromptTarget,
  shouldSuppressMultiProjectWarning,
  detectExecutionMode,
  buildMultiProjectBlockMessage
} = buildLifecycleProjectTargetUtils({
  fs,
  path,
  WORKSPACE_ROOT,
  LAYOUT,
  CONTEXT_PROJECT,
  DEFAULT_SCOPE,
  STICKY_PROJECT_TTL_MS,
  EXECUTION_MODE,
  MULTI_PROJECT_EXEMPTION_KEYWORDS,
  collectWorkspaceProjectNamespaces,
  escapeRegExp,
  collectProjectPayloadStrings,
  normalizeText,
  readProfileMode,
  readProjectProfileConfig,
  isStrictEnforcement
})

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

const {
  collectStrings,
  collectInterestingStrings,
  extractAssistantRecordContent,
  getVisibleReplyEvidence,
  getVisibleReplyText,
  getToolInputStrings,
  getCommandText,
  touchesPath
} = buildLifecyclePayloadUtils({
  fs,
  path,
  payloadPreviewLimit: PAYLOAD_PREVIEW_LIMIT,
  transcriptTailLimit: TRANSCRIPT_TAIL_LIMIT,
  safeJsonParse,
  normalizeText
})

const {
  getBootstrapScopes,
  buildDefaultState,
  loadState,
  saveState,
  resetState,
  isBootstrapReadTool,
  isPureReadTool,
  isClarificationTool,
  updateBootstrapState,
  isReadOnlyBootstrapShellCommand,
  buildBootstrapMessage,
  buildBootstrapDenyOutput,
  buildBootstrapWarningOutput,
  buildBootstrapWarningKey,
  buildDedupedBootstrapWarningOutput
} = buildLifecycleBootstrapStateUtils({
  fs,
  path,
  LAYOUT,
  CONTEXT_PROJECT,
  DEFAULT_SCOPE,
  EXECUTION_MODE,
  readJsonFile,
  META_STATE_PATHS,
  buildPathNeedles,
  getStatePathsFor,
  getStatePaths,
  getActiveScope,
  getActiveNamespaceRoot,
  getBootstrapAgent,
  getWorkspaceNamespaceRoot,
  readProfileMode,
  getToolName,
  touchesPath,
  getToolInputStrings,
  getCommandText,
  getRecentBootstrapTaskStamps,
  isRecentBootstrapTaskPath,
  buildInterceptionOutput,
  INTERCEPTION_ACTION,
  noopOutput,
  emptyGovernanceIntakeState
})

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
    if (CP1_FILES.some(name => fs.existsSync(path.join(fullPath, name)))) return true
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
    if (cp.CP3) {
      clearTaskCp3RuntimeRecord(state, d)
      return false
    }
    if (!hasTaskArtifact(d, 'CP3')) return true
    return !cp.CP3
  }) || null
}

function getTaskRuntimeKey(task) {
  return `${task.kind}:${path.normalize(task.fullPath).toLowerCase()}`
}

function getTaskCp3RuntimeRecord(state, task) {
  if (!isPlainObject(state.cp3Runtime)) state.cp3Runtime = {}
  const key = getTaskRuntimeKey(task)
  if (!isPlainObject(state.cp3Runtime[key])) {
    state.cp3Runtime[key] = {
      kind: task.kind,
      name: task.name,
      reqPath: task.fullPath,
      trackedFiles: [],
      triggered: false,
      triggerType: '',
      triggerReason: '',
      triggerCount: 0,
      triggeredAt: '',
      updatedAt: ''
    }
  }
  return state.cp3Runtime[key]
}

function clearTaskCp3RuntimeRecord(state, task) {
  if (!isPlainObject(state.cp3Runtime)) return
  delete state.cp3Runtime[getTaskRuntimeKey(task)]
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

function extractSourceMutationTargets(payload, state) {
  return [...new Set(extractToolPaths(payload))]
    .map(resolveRelativeToContext)
    .filter(target => SOURCE_EXT_RE.test(target) && !isDevCodexManagedPath(target, state))
}

function isHighRiskCp3RuntimeTarget(target) {
  const rel = toWorkspaceRelativePath(target)
  return [
    /(^|\/)package\.json$/i,
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i,
    /(^|\/)\.env(?:\.[^\/]+)?$/i,
    /(^|\/)(Dockerfile|docker-compose(?:\.[^\/]+)?\.ya?ml)$/i,
    /(^|\/)\.github\/workflows\/.+\.ya?ml$/i,
    /(^|\/)(?:prisma\/schema\.prisma|schema\.prisma)$/i,
    /(^|\/)(?:migrations?|db\/migrations?)\//i
  ].some(re => re.test(rel))
}

function assessBugCp3RuntimeEscalation(task, payload, state) {
  const targets = extractSourceMutationTargets(payload, state)
  if (!targets.length) return null

  const record = getTaskCp3RuntimeRecord(state, task)
  const tracked = new Set(Array.isArray(record.trackedFiles) ? record.trackedFiles : [])
  const nextTargets = targets.map(toWorkspaceRelativePath).filter(Boolean)
  for (const rel of nextTargets) tracked.add(rel)

  record.trackedFiles = [...tracked].sort()
  record.updatedAt = new Date().toISOString()

  const highRiskTarget = targets.find(isHighRiskCp3RuntimeTarget)
  if (highRiskTarget) {
    const rel = toWorkspaceRelativePath(highRiskTarget)
    record.triggered = true
    record.triggerType = 'high-risk'
    record.triggerReason = `执行中新增高风险文件 ${rel}`
    record.triggerCount = tracked.size
    record.triggeredAt = record.updatedAt
    return {
      type: 'high-risk',
      reason: record.triggerReason,
      count: tracked.size,
      threshold: CP3_RUNTIME_FILE_THRESHOLD,
      trackedFiles: record.trackedFiles
    }
  }

  if (tracked.size >= CP3_RUNTIME_FILE_THRESHOLD) {
    record.triggered = true
    record.triggerType = 'file-threshold'
    record.triggerReason = `执行中已触达 ${tracked.size} 个源码/配置文件（阈值 ${CP3_RUNTIME_FILE_THRESHOLD}）`
    record.triggerCount = tracked.size
    record.triggeredAt = record.updatedAt
    return {
      type: 'file-threshold',
      reason: record.triggerReason,
      count: tracked.size,
      threshold: CP3_RUNTIME_FILE_THRESHOLD,
      trackedFiles: record.trackedFiles
    }
  }

  return null
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
    if (cp.CP3) {
      clearTaskCp3RuntimeRecord(state, task)
      continue
    }
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
  if (task.kind === 'bugs' && !confirmed.CP3) {
    const runtimeTrigger = assessBugCp3RuntimeEscalation(task, payload, state)
    if (!runtimeTrigger) return null
    return {
      phase: 'CP3',
      reqName: task.name,
      reqPath: task.fullPath,
      kind: task.kind,
      code: runtimeTrigger.type === 'high-risk'
        ? 'cp-gate-CP3-runtime-risk'
        : 'cp-gate-CP3-runtime-threshold',
      runtimeTrigger
    }
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
  const runtimeDetail = gate.runtimeTrigger
    ? `${gate.runtimeTrigger.reason}，请先回到 CP3 更新实施计划并获得确认后再继续。`
    : ''
  const msg = runtimeDetail || msgs[gate.phase]
  return buildInterceptionOutput(
    state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, gate.code || `cp-gate-${gate.phase}`,
    `CP gate: ${gate.phase} not confirmed for "${gate.reqName}" — ${toolName} denied`,
    msg,
    `Complete and confirm ${gate.phase}, then retry the source mutation.`
  )
}

function buildCpWarningOutput(state, platform, eventName, gate, toolName) {
  const detail = gate.runtimeTrigger
    ? `${gate.runtimeTrigger.reason}，请先回到 CP3 更新实施计划并获得确认。 Tool allowed in safety-only mode.`
    : gate.phase === 'CP2'
    ? 'CP2 (技术方案) 未完成；请尽快补齐方案产物与用户确认记录。'
    : `CP3 (实施计划) 未完成；请尽快补齐 ${CP3_FILE} 与用户确认记录。`
  return buildInterceptionOutput(
    state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, gate.code || `cp-gate-${gate.phase}`,
    `CP gate warning: ${gate.phase} not confirmed for "${gate.reqName}" before ${toolName}`,
    gate.runtimeTrigger ? detail : `${detail} Tool allowed in safety-only mode.`,
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

const {
  checkDangerousCommand,
  stripApprovalMarker,
  pruneDangerousApprovals,
  createDangerousApproval,
  confirmDangerousApprovalsFromPrompt,
  consumeDangerousApproval
} = buildLifecycleDangerousCommandUtils({
  path,
  crypto,
  CONTEXT_ROOT,
  APPROVAL_TTL_MS,
  DANGEROUS_PATTERNS,
  getToolName,
  getCommandText,
  INTERCEPTION_ACTION,
  recordInterception
})

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

const {
  hasVisibleReplyPayload,
  updateVisibleReplyState,
  captureFinalPayloadSample,
  getPrecheckEvidenceStatus,
  buildClosureReminder,
  buildDedupedClosureReminder
} = buildLifecycleVisibleReplyUtils({
  fs,
  getStatePaths,
  getVisibleReplyEvidence,
  collectInterestingStrings,
  buildGovernanceIntakeReminderItem
})

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
  if (eventName === 'PreCompact' || eventName === 'Stop') {
    updateGovernanceIntakeResolutionState(state, getVisibleReplyText(payload), eventName)
  }
  state.lastEvent = eventName || state.lastEvent

  // ── UserPromptSubmit ───────────────────────────────────────────────────────
  if (eventName === 'UserPromptSubmit') {
    state = resetState(mode, state)
    applyPromptTarget(state, promptTarget, payload)
    state.governanceIntake = buildGovernanceIntakeCandidate(prompt)
    state.executionMode = detectExecutionMode(payload, state, promptTarget)
    confirmDangerousApprovalsFromPrompt(state, prompt, eventName, platform)
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
