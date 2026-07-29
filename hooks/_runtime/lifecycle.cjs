#!/usr/bin/env node
'use strict'

/**
 * DevCodex unified lifecycle hook — Copilot, Claude Code, Codex, Gemini & Grok
 *
 * Auto-detects platform from tool name casing:
 *   Claude Code  → PascalCase tools (Write, Edit, Bash, Read …)
 *   Copilot      → snake_case / lowercase tools (apply_patch, create_file …)
 *
 * Handles normalized: UserPromptSubmit · PreToolUse · PostToolUse · PreCompact · Stop
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { buildLifecycleBootstrapStateUtils } = require('./lifecycle-bootstrap-state.cjs')
const {
  CONTEXT_READ_CONTRACT,
  createContextReadReceipt,
  evaluateContextReuse,
  extractContextPlanBody,
  extractContextSourceEvidence,
  markContextReadReceiptStale,
  normalizeContextReadState,
  normalizeContextToolOutcome,
  recordContextReadAttempt,
  recordContextReadOutcome,
  stableDigest,
  validateContextReadPlan
} = require('./context-read-contract.cjs')
const { buildLifecycleDangerousCommandUtils } = require('./lifecycle-dangerous-command.cjs')
const { buildLifecycleGovernanceIntakeUtils } = require('./lifecycle-governance-intake.cjs')
const { buildLifecycleHookOutput } = require('./lifecycle-hook-output.cjs')
const { buildLifecycleNamespaceStateUtils } = require('./lifecycle-namespace-state.cjs')
const { buildLifecyclePayloadUtils } = require('./lifecycle-payload-utils.cjs')
const { buildLifecycleProjectTargetUtils } = require('./lifecycle-project-target.cjs')
const {
  completeToolLease,
  createTurnLivenessState,
  formatTurnRecoveryMessage,
  markTurnTerminal,
  normalizeTurnLivenessState,
  observeTurnEvent,
  startToolLease
} = require('./lifecycle-turn-liveness.cjs')
const { buildLifecycleVisibleReplyUtils } = require('./lifecycle-visible-reply.cjs')
const { observeWorkflowCompletionEvent } = require('./lifecycle-workflow-completion.cjs')
const {
  collectWorkspaceProjectNamespaces,
  findLayoutInfo,
  inferProjectFromCwd
} = require('./workspace-layout.cjs')
const {
  TaskContinuationError,
  parseContinuationCommand,
  resolveTaskContinuation
} = require('./task-continuation-contract.cjs')
const {
  evaluateStopCompletionGate,
  extractLastAssistantMessage
} = require('./lifecycle-stop-gate.cjs')
const {
  shouldHardDenyCpMutation,
  classifyPathsForArtifacts,
  isStrictProtectedPath,
  simpleTaskForbidsPath,
  classifyImplementStartGate,
  ERROR_CODES: PROCESS_ENFORCEMENT_CODES
} = require('../../scripts/lib/process-enforcement.js')

const CONTEXT_ROOT = process.cwd()
const PAYLOAD_PREVIEW_LIMIT = 160
const TRANSCRIPT_TAIL_LIMIT = 2 * 1024 * 1024
const STICKY_PROJECT_TTL_MS = 30 * 60 * 1000

// ─── CP Gate constants ────────────────────────────────────────────────────────
const CP1_FILES = ['01-需求确认.md', '01-产品需求.md', '01-需求概述.md']
const CP2_FILE = '02-技术方案.md'
const CP3_FILE = '04-实施计划.md'
const CP3_RUNTIME_FILE_THRESHOLD = 5
// Dual-Track Closure (PI-154 / PF-171): control-plane source paths that require a bound task+CP when mutated.
// PF-process-enforcement: full website/docs + skills/mcp/prompts (aligned with process-enforcement STRICT_PROTECTED).
const CONTROL_PLANE_SOURCE_RE = /(?:^|[/\\])(?:scripts|hooks|instructions|host-projections|mcp|prompts|agents)(?:[/\\]|$)|(?:^|[/\\])package\.json$|(?:^|[/\\])plugin\.json$|(?:^|[/\\])skills[/\\]|(?:^|[/\\])website[/\\]docs(?:[/\\]|$)/i
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
  normalizeGovernanceIntakeState,
  registerGovernanceIntakeCandidate,
  buildGovernanceIntakeContextMessage,
  observeGovernanceLedgerWrite,
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
  setStickyProject,
  shouldSuppressMultiProjectWarning,
  detectExecutionMode,
  buildExecutionModeContextMessage,
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
  const raw = String(
    payload.hookEventName || payload.hook_event_name ||
    payload.eventName || payload.event || payload.phase || ''
  ).trim()
  if (!raw) return ''
  // Normalize Grok/Cursor snake_case and Claude PascalCase to lifecycle canonical names.
  const token = raw.toLowerCase().replace(/[^a-z]/g, '')
  const canonical = {
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
    beforeagent: 'UserPromptSubmit',
    afteragent: 'Stop',
    beforetool: 'PreToolUse',
    aftertool: 'PostToolUse',
    precompress: 'PreCompact'
  }
  return canonical[token] || raw
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
  beginContextAcquisition,
  markContextAcquisitionStale,
  markContextPostMutationStale,
  recordContextPreToolUse,
  recordContextPostToolUse,
  getContextAcquisitionDecision,
  buildBootstrapMessage,
  buildBootstrapDenyOutput,
  buildDedupedBootstrapWarningOutput
} = buildLifecycleBootstrapStateUtils({
  fs,
  path,
  crypto,
  env: process.env,
  CONTEXT_ROOT,
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
  getPayloadSessionKey,
  getRecentBootstrapTaskStamps,
  isRecentBootstrapTaskPath,
  buildInterceptionOutput,
  INTERCEPTION_ACTION,
  noopOutput,
  emptyGovernanceIntakeState,
  normalizeGovernanceIntakeState,
  createTurnLivenessState,
  normalizeTurnLivenessState,
  CONTEXT_READ_CONTRACT,
  createContextReadReceipt,
  evaluateContextReuse,
  extractContextPlanBody,
  extractContextSourceEvidence,
  markContextReadReceiptStale,
  normalizeContextReadState,
  normalizeContextToolOutcome,
  recordContextReadAttempt,
  recordContextReadOutcome,
  stableDigest,
  validateContextReadPlan,
  extractToolPaths,
  isSourceCodeMutation
})

// ─── CP Gate ─────────────────────────────────────────────────────────────────

function readCpConfirmations(reqPath) {
  const p = path.join(reqPath, '.memory', 'sessions.md')
  const none = { CP1: false, CP2: false, CP3: false, CP3Exempt: false }
  if (!fs.existsSync(p)) return none
  let text
  try { text = fs.readFileSync(p, 'utf8') } catch { return none }
  const confirmed = { CP1: false, CP2: false, CP3: false, CP3Exempt: false }

  // ConfirmBindingGate: prefer digest-aware parser when available.
  // Legacy tables without sha256 remain valid (ok + legacy).
  // Extended tables with sha256 must match on-disk artifact or confirmation is rejected.
  try {
    const cpDigestPath = path.join(__dirname, '..', '..', 'scripts', 'lib', 'cp-digest.js')
    if (fs.existsSync(cpDigestPath)) {
      const { parseCpSessions, verifyArtifactDigest } = require(cpDigestPath)
      const parsed = parseCpSessions(text)
      for (const phase of ['CP1', 'CP2', 'CP3']) {
        const row = parsed[phase]
        if (!row || !row.confirmed) continue
        if (row.artifactSha256) {
          const verify = verifyArtifactDigest(reqPath, row)
          if (!verify.ok) continue
        }
        confirmed[phase] = true
      }
      if (parsed.CP3Exempt) {
        confirmed.CP3 = true
        confirmed.CP3Exempt = true
      }
      return confirmed
    }
  } catch (_) {
    // fall through to legacy regex
  }

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

function toControlPlaneRelPath(target) {
  return toWorkspaceRelativePath(target).replace(/\\/g, '/')
}

function isControlPlaneSourcePath(target, state) {
  if (!target || isDevCodexManagedPath(target, state)) return false
  // Workspace custom skills must never be treated as package control-plane skills/
  try {
    const { isWorkspaceSkillPath } = require('./skill-resolution.cjs')
    if (isWorkspaceSkillPath(resolveRelativeToContext(target), { cwd: CONTEXT_ROOT || WORKSPACE_ROOT })) {
      return false
    }
  } catch {
    /* skill-resolution optional during partial deploys */
  }
  const rel = toControlPlaneRelPath(target)
  return CONTROL_PLANE_SOURCE_RE.test(rel)
}

function payloadTouchesControlPlaneSource(payload, state) {
  const paths = [...new Set(extractToolPaths(payload))]
  if (!paths.length) return false
  return paths.some(p => isControlPlaneSourcePath(p, state))
}

/**
 * Dual-Track M1: control-plane source mutation with no CP1-bound task at all → orphan CP3.
 * Incomplete tasks remain handled by findIncompleteTask*; dirs with CP1 keep normal CP2/CP3 gate.
 */
function checkOrphanControlPlaneGate(payload, state) {
  if (!payloadTouchesControlPlaneSource(payload, state)) return null
  const dirs = listTaskDirs(state).filter(d =>
    !fs.existsSync(path.join(d.fullPath, '.archived')) && hasTaskArtifact(d, 'CP1')
  )
  if (dirs.length > 0) return null
  return {
    phase: 'CP3',
    reqName: 'no-bound-task',
    reqPath: getActiveNamespaceRoot(state),
    kind: 'requirements',
    code: 'cp-gate-orphan-control-plane'
  }
}

function checkCpGate(payload, state) {
  const task = (payload && extractToolPaths(payload).length > 0)
    ? findIncompleteTaskForPaths(payload, state)
    : findIncompleteTask(state)
  if (!task) {
    return checkOrphanControlPlaneGate(payload, state)
  }
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
const SOURCE_EXT_RE = /\.(js|ts|tsx|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|c|cpp|h|swift|kt|vue|svelte|css|scss|less|html|sql|sh|bash|zsh|ps1|psm1|json|yaml|yml|toml|ini|xml|env|md|mdx)$/i
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
  // Carve-out: workspace skills are user-editable extensions, not managed G/runtime state
  try {
    const { isWorkspaceSkillPath } = require('./skill-resolution.cjs')
    if (isWorkspaceSkillPath(resolveRelativeToContext(target), { cwd: CONTEXT_ROOT || WORKSPACE_ROOT })) {
      return false
    }
  } catch {
    /* optional */
  }
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
  if (['bash', 'shell_command', 'run_in_terminal', 'run_terminal_command', 'powershell'].includes(lower)) {
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
  const orphanDetail = gate.code === 'cp-gate-orphan-control-plane'
    ? `控制面源码 mutation 无绑定任务（orphan）— 请先创建 requirements/bugs 任务并完成 CP1~CP3（含 ${CP3_FILE}）后再改 scripts/hooks/package 等控制面路径。`
    : ''
  const runtimeDetail = gate.runtimeTrigger
    ? `${gate.runtimeTrigger.reason}，请先回到 CP3 更新实施计划并获得确认后再继续。`
    : ''
  const msg = orphanDetail || runtimeDetail || msgs[gate.phase]
  return buildInterceptionOutput(
    state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, gate.code || `cp-gate-${gate.phase}`,
    `CP gate: ${gate.phase} not confirmed for "${gate.reqName}" — ${toolName} denied`,
    msg,
    `Complete and confirm ${gate.phase}, then retry the source mutation.`
  )
}

function buildCpWarningOutput(state, platform, eventName, gate, toolName) {
  let detail
  if (gate.code === 'cp-gate-orphan-control-plane') {
    detail = `控制面源码 mutation 无绑定任务（orphan）；请补任务与 ${CP3_FILE}+确认。 Tool allowed in safety-only mode.`
  } else if (gate.runtimeTrigger) {
    detail = `${gate.runtimeTrigger.reason}，请先回到 CP3 更新实施计划并获得确认。 Tool allowed in safety-only mode.`
  } else if (gate.phase === 'CP2') {
    detail = 'CP2 (技术方案) 未完成；请尽快补齐方案产物与用户确认记录。 Tool allowed in safety-only mode.'
  } else {
    detail = `CP3 (实施计划) 未完成；请尽快补齐 ${CP3_FILE} 与用户确认记录。 Tool allowed in safety-only mode.`
  }
  return buildInterceptionOutput(
    state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, gate.code || `cp-gate-${gate.phase}`,
    `CP gate warning: ${gate.phase} not confirmed for "${gate.reqName}" before ${toolName}`,
    detail,
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
  { re: /Remove-Item[\s\S]*-Recurse[\s\S]*-Force|Remove-Item[\s\S]*-Force[\s\S]*-Recurse/i, reason: 'Blocked: Remove-Item -Recurse -Force' }
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
  WORKSPACE_ROOT,
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

/** Product-artifact paths: reports, memory, runtime ledgers (S07 order / VL-004). */
const PRODUCT_ARTIFACT_PATH_NEEDLES = [
  '/reports/',
  '\\reports\\',
  '/.memory/',
  '\\.memory\\',
  '/data/violations.md',
  '/data/process-improvements.md',
  '/data/pending-fixes.md',
  '/data/pending-issues.md',
  '/data/gap-registry.md'
]

function isWriteLikeToolName(toolName) {
  const tn = String(toolName || '').toLowerCase()
  return (
    /^(?:write|edit|search[_-]?replace|str[_-]?replace|apply[_-]?patch|create[_-]?file|multi[_-]?edit|insert[_-]?code|rewrite[_-]?file)$/i.test(tn) ||
    /memory_(?:session_write|summary_append|cp_confirm)|memory-(?:session-write|summary-append|cp-confirm)/i.test(tn)
  )
}

/**
 * True when a mutating tool targets product artifacts that must not precede first user-visible PC0.
 * Read-only tools never match. Mid-turn precheck is almost never verified-present on tool-loop hosts.
 */
function isProductArtifactMutation(payload, platform) {
  const toolName = getToolName(payload)
  const writeLike = isWriteLikeToolName(toolName)
  const mutating = isMutatingTool(payload, platform)
  if (!writeLike && !mutating) return false
  if (touchesPath(payload, ...PRODUCT_ARTIFACT_PATH_NEEDLES)) return true
  // MCP memory writes often omit path strings in tool_input
  if (/memory_(?:session_write|summary_append)|memory-(?:session-write|summary-append)/i.test(toolName)) return true
  return false
}

function markProductMutationOrder(state, payload, platform) {
  if (!isProductArtifactMutation(payload, platform)) return false
  const precheckStatus = getPrecheckEvidenceStatus(state)
  if (precheckStatus !== 'verified-present') {
    state.productMutationBeforePrecheck = true
    state.productMutationCountThisTurn = (state.productMutationCountThisTurn || 0) + 1
  }
  return true
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
  const eventSessionKey = getPayloadSessionKey(payload)
  let state = loadState(undefined, eventSessionKey)
  const promptTarget = eventName === 'UserPromptSubmit'
    ? resolvePromptTarget(state, payload, prompt, projectCandidate)
    : null
  if (eventName === 'UserPromptSubmit') {
    state = loadState(readModeForPromptTarget(state, promptTarget), eventSessionKey)
  }
  const mode = state.mode

  updateVisibleReplyState(state, payload, eventName)
  if (eventName === 'PreCompact' || eventName === 'Stop') {
    updateGovernanceIntakeResolutionState(state, getVisibleReplyText(payload), eventName, {
      activeRoot: getActiveNamespaceRoot(state),
      contextRoot: CONTEXT_ROOT
    })
  }
  let livenessObservation = null
  const livenessEventName = eventName || (getToolName(payload) ? 'PreToolUse' : '')
  if (livenessEventName && livenessEventName !== 'UserPromptSubmit') {
    livenessObservation = observeTurnEvent(state.turnLiveness, livenessEventName, payload)
    state.turnLiveness = livenessObservation.state
  }
  state.workflowCompletionLifecycle = observeWorkflowCompletionEvent(state.workflowCompletionLifecycle, eventName, payload, { host: platform })
  state.lastEvent = eventName || state.lastEvent

  // ── UserPromptSubmit ───────────────────────────────────────────────────────
  if (eventName === 'UserPromptSubmit') {
    if (payload.devcodex_host_continuation === true) {
      state.lastReason = 'host-route-continuation'
      saveState(state)
      writeStdout(noopOutput())
      return
    }
    if (payload.devcodex_host_transform_only === true &&
        state.contextAcquisition?.contextEpoch) {
      let progressiveSkillRouteMsg = ''
      try {
        const {
          formatSkillRouteBootstrapInjection
        } = require('./skill-route-tool.cjs')
        if (state.progressiveSkillRoute?.bootstrap) {
          progressiveSkillRouteMsg = formatSkillRouteBootstrapInjection(
            state.progressiveSkillRoute.bootstrap
          )
        }
      } catch {}
      state.lastReason = 'copilot-transform-projection'
      saveState(state)
      writeStdout(contextMessageOutput(
        'UserPromptSubmit',
        [
          buildBootstrapMessage(state),
          buildExecutionModeContextMessage(state),
          buildGovernanceIntakeContextMessage(state.governanceIntake),
          progressiveSkillRouteMsg
        ].filter(Boolean).join('\n\n')
      ))
      return
    }
    const workflowCompletionLifecycle = state.workflowCompletionLifecycle
    state = resetState(mode, state)
    state.workflowCompletionLifecycle = workflowCompletionLifecycle
    livenessObservation = observeTurnEvent(state.turnLiveness, eventName, payload)
    state.turnLiveness = livenessObservation.state
    applyPromptTarget(state, promptTarget, payload)
    const continuationCommand = parseContinuationCommand(prompt)
    let continuationResolution = null
    if (continuationCommand) {
      try {
        continuationResolution = resolveTaskContinuation({
          cwd: CONTEXT_ROOT,
          name: continuationCommand.displayQuery,
          project: projectCandidate.project || '',
          scope: projectCandidate.project ? 'project' : 'workspace'
        })
      } catch (error) {
        if (!(error instanceof TaskContinuationError)) throw error
        continuationResolution = {
          schemaVersion: 'TaskResolutionV1',
          status: 'not-found',
          errorCode: error.code,
          message: error.message,
          nextStep: error.nextStep || 'Specify the exact task name and project.'
        }
      }
      const resolvedProject = continuationResolution?.candidate?.project || ''
      if (resolvedProject) {
        const workspaceTask = resolvedProject === 'workspace'
        state.activeProject = workspaceTask ? '' : resolvedProject
        state.activeScope = workspaceTask ? 'workspace' : 'project'
        state.activeProjectSource = 'task-continuation'
        if (!workspaceTask) setStickyProject(state, resolvedProject, 'task-continuation', payload)
        state.mode = readModeForPromptTarget(state, {
          activeProject: workspaceTask ? '' : resolvedProject,
          activeScope: workspaceTask ? 'workspace' : 'project'
        })
      }
      state.taskContinuation = {
        schemaVersion: 'TaskContinuationHookEvidenceV1',
        command: continuationCommand,
        status: continuationResolution.status,
        errorCode: continuationResolution.errorCode || null,
        candidate: continuationResolution.candidate ? {
          taskId: continuationResolution.candidate.taskId,
          displayName: continuationResolution.candidate.displayName,
          project: continuationResolution.candidate.project,
          kind: continuationResolution.candidate.kind,
          status: continuationResolution.candidate.status
        } : null,
        indexState: continuationResolution.index?.state || null,
        observedAt: new Date().toISOString(),
        capabilityBoundary: {
          payloadExecution: false,
          taskStatusMutation: false,
          cpMutation: false,
          processWakeup: false
        }
      }
    }
    beginContextAcquisition(state, payload, platform)
    state.governanceIntake = registerGovernanceIntakeCandidate(state.governanceIntake, prompt)
    state.executionMode = detectExecutionMode(payload, state, promptTarget)
    confirmDangerousApprovalsFromPrompt(state, prompt, eventName, platform)
    if (continuationResolution && continuationResolution.status !== 'resolved-active') {
      const candidates = continuationResolution.candidates || continuationResolution.suggestions || []
      const candidateText = candidates.slice(0, 5).map(candidate => `${candidate.project}/${candidate.kind}/${candidate.displayName}`).join(', ')
      const detail = [
        `Task continuation status=${continuationResolution.status}.`,
        continuationResolution.message || '',
        candidateText ? `Candidates: ${candidateText}.` : ''
      ].filter(Boolean).join(' ')
      state.lastReason = `task-continuation-${continuationResolution.status}`
      const output = buildInterceptionOutput(
        state,
        platform,
        eventName,
        INTERCEPTION_ACTION.REQUIRE_COMPLETION,
        `task-continuation-${continuationResolution.status}`,
        `task-continuation-${continuationResolution.status}`,
        detail,
        continuationResolution.nextStep || 'Specify the exact active task and retry.'
      )
      saveState(state)
      writeStdout(output)
      return
    }
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
    // The progressive route is the only catalog/body owner after B4 cutover.
    let progressiveSkillRouteMsg = ''
    let progressiveSkillRouteMode = 'unified'
    try {
      const { bootstrapSkillRouteForTurn } = require('./skill-route-tool.cjs')
      const {
        getLifecycleHostAdapterDigest
      } = require('./host-adapter-identity.cjs')
      const route = bootstrapSkillRouteForTurn({
        project: state.contextAcquisition?.project,
        contextEpoch: state.contextAcquisition?.contextEpoch,
        prompt,
        host: platform,
        cwd: CONTEXT_ROOT
      }, {
        inputRoot: CONTEXT_ROOT,
        env: process.env,
        hostAdapterDigest: getLifecycleHostAdapterDigest(platform)
      })
      progressiveSkillRouteMode = route.modeReceipt?.effective || 'unified'
      progressiveSkillRouteMsg = route.injectionText || ''
      state.progressiveSkillRoute = {
        schemaVersion: 'LifecycleSkillRouteStateV1',
        modeReceipt: route.modeReceipt,
        bootstrap: route.bootstrap,
        active: route.active === true,
        errorCode: null
      }
    } catch (error) {
      state.progressiveSkillRoute = {
        schemaVersion: 'LifecycleSkillRouteStateV1',
        modeReceipt: null,
        bootstrap: null,
        active: false,
        errorCode: String(error.code || error.message || 'SKILL_ROUTE_BOOTSTRAP_FAILED')
      }
      progressiveSkillRouteMsg = [
        '### DevCodex · SkillRouteBootstrapErrorV1',
        `errorCode: ${state.progressiveSkillRoute.errorCode}`,
        'Do not fall back to legacy WorkspaceSkillIntent or preload a skill body. Continue without a free-route skill and report the routing error.'
      ].join('\n')
    }

    state.workspaceSkillAutoMatch = null

    saveState(state)
    writeStdout(contextMessageOutput(
      'UserPromptSubmit',
      [
        buildBootstrapMessage(state),
        buildExecutionModeContextMessage(state),
        continuationResolution
          ? `TaskResolutionV1 resolved-active: ${continuationResolution.candidate.project}/${continuationResolution.candidate.kind}/${continuationResolution.candidate.displayName}. The name only locates the task; rehydrate identity, sessions, and current bound artifacts before continuing.`
          : '',
        buildGovernanceIntakeContextMessage(state.governanceIntake),
        formatTurnRecoveryMessage(livenessObservation.recoveryCard),
        progressiveSkillRouteMsg
      ].filter(Boolean).join('\n\n')
    ))
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

    // 2. Context acquisition: PreToolUse records an attempt only. A compatible
    // action reuses the current plan; a broader/unknown action makes it stale.
    // Fallback warnings are carried forward so Auto/CP/permission gates still run.
    const contextPre = recordContextPreToolUse(state, payload, platform)
    const contextDecision = getContextAcquisitionDecision(state, contextPre)
    let contextGateOutput = null
    if (!['complete', 'allowed-read'].includes(contextDecision.status)) {
      if (contextDecision.hardBlockEligible && isStrictEnforcement()) {
        state.lastReason = 'context-acquisition-incomplete'
        const output = buildBootstrapDenyOutput(state, payload, eventName, platform)
        saveState(state)
        writeStdout(output)
        return
      }
      contextGateOutput = buildDedupedBootstrapWarningOutput(state, payload, eventName, platform)
    }

    // 2.5. Auto v1.1 whitelist gate — only whitelisted governance/test/docs paths can bypass CP gate
    const autoWhitelist = checkAutoWhitelist(payload, platform, state)
    if (autoWhitelist && autoWhitelist.allowed) {
      state.lastReason = 'auto-whitelist-bypass'
      markProductMutationOrder(state, payload, platform)
      updateArtifactTouches(state, payload, platform)
      state.turnLiveness = startToolLease(state.turnLiveness, payload, getToolName(payload))
      saveState(state)
      writeStdout(contextGateOutput || noopOutput())
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

    // 2.5 ArtifactPathGate — requirements/02|04 slot semantics (always hard when invalid)
    if (isSourceCodeMutation(payload, platform, state) || isProductArtifactMutation(payload, platform)) {
      const toolPaths = extractToolPaths(payload)
      const art = classifyPathsForArtifacts(toolPaths)
      if (!art.ok) {
        state.lastReason = art.code || 'ARTIFACT_PATH_INVALID'
        saveState(state)
        writeStdout(buildInterceptionOutput(
          state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, art.code || 'ARTIFACT_PATH_INVALID',
          `Artifact path denied: ${art.code}`,
          art.message || 'Illegal requirements artifact path.',
          'Place analysis reports under reports/analysis/…; reserve 02- for technical design.'
        ))
        return
      }
    }

    // 2.6 SimpleTask path forbid — website/docs + control-plane protected paths (D2)
    if (
      (state.simpleTaskFastPath === true || state.taskPathMode === 'simple') &&
      isSourceCodeMutation(payload, platform, state)
    ) {
      const toolPaths = extractToolPaths(payload)
      const forbidden = toolPaths.find(p => simpleTaskForbidsPath(p))
      if (forbidden) {
        state.lastReason = PROCESS_ENFORCEMENT_CODES.SIMPLE_TASK_PATH_FORBIDDEN
        saveState(state)
        writeStdout(buildInterceptionOutput(
          state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION,
          PROCESS_ENFORCEMENT_CODES.SIMPLE_TASK_PATH_FORBIDDEN,
          'SimpleTask path forbidden',
          `SimpleTaskFastPath may not mutate protected path: ${forbidden}`,
          'Upgrade to full CP task, or keep changes outside website/docs and control-plane sources.'
        ))
        return
      }
    }

    // 2.7 E: implement-start gate — control-plane mutation needs 04+05+复审清单 triad
    // (P0-1 / ESC-01: yes-implement must not skip CP3 materialization)
    if (
      isSourceCodeMutation(payload, platform, state) &&
      !(state.simpleTaskFastPath === true || state.taskPathMode === 'simple')
    ) {
      const toolPaths = extractToolPaths(payload)
      const hitsProtected = toolPaths.some(p => isStrictProtectedPath(p))
      if (hitsProtected) {
        const task = (typeof findIncompleteTaskForPaths === 'function')
          ? findIncompleteTaskForPaths(payload, state)
          : null
        const bound = task || (typeof findIncompleteTask === 'function' ? findIncompleteTask(state) : null)
        // Fail-closed when no bound task: was the loophole for skip-process after promising 概况/方案
        const taskRoot = bound && bound.fullPath ? bound.fullPath : null
        const startGate = classifyImplementStartGate({
          controlPlaneMutation: true,
          taskRoot,
          fs
        })
        if (!startGate.ok) {
          const code = startGate.code || PROCESS_ENFORCEMENT_CODES.IMPLEMENT_START_WITHOUT_PROCESS
          state.lastReason = code
          saveState(state)
          let detail
          let next
          if (code === PROCESS_ENFORCEMENT_CODES.IMPLEMENT_START_WITHOUT_TASK_BINDING || startGate.unbound) {
            detail = '控制面 mutation 必须绑定 active 需求/bug 任务目录（禁止无任务包直接改 hooks/scripts/instructions）。'
            next = 'Create or resume a requirements/<name>/ package (00/01/02 + 04/05/checklist), bind the task, then retry the edit.'
          } else if (code === PROCESS_ENFORCEMENT_CODES.IMPLEMENT_START_WITHOUT_DESIGN) {
            detail = `控制面 mutation 前须有设计产物（缺: ${(startGate.missing || []).join(', ')}）${bound ? `：${bound.name || bound.fullPath}` : ''}`
            next = 'Write 00-需求概况/01-需求确认 and 02-技术方案 under the bound task, then 04/05/checklist, then mutate control-plane files.'
          } else {
            detail = `控制面 mutation 前须在任务目录齐备 04-实施计划.md + 05-实施进度.md + 复审清单（缺: ${(startGate.missing || []).join(', ')}）：${bound ? (bound.name || bound.fullPath) : ''}`
            next = 'Create 04-实施计划.md, 05-实施进度.md, and 03-复审清单*.md under the active requirement before mutating hooks/skills/instructions.'
          }
          writeStdout(buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION,
            code,
            'Implement process gate required',
            detail,
            next
          ))
          return
        }
      }
    }

    // 3. CP gate — block source code mutations until checkpoints confirmed
    //    PF-process-enforcement: hard-deny for strict-protected paths even under safety-only (D1)
    //    Non-protected paths: legacy safety-only warning + Honesty cp2-unconfirmed-write
    const gate = checkCpGate(payload, state)
    if (gate && isSourceCodeMutation(payload, platform, state)) {
      const toolPaths = extractToolPaths(payload)
      const hard = shouldHardDenyCpMutation(gate, toolPaths, { strictEnv: isStrictEnforcement() })
      const useHardDeny = hard.hardDeny === true
      state.lastReason = `cp-gate-${gate.phase}${useHardDeny ? '-hard' : '-warn'}`
      if (!useHardDeny && (gate.phase === 'CP2' || gate.code === 'cp-gate-orphan-control-plane')) {
        const honesty = state.enforcementHonesty && typeof state.enforcementHonesty === 'object'
          ? { ...state.enforcementHonesty }
          : {}
        const gaps = Array.isArray(honesty.processGaps) ? honesty.processGaps.slice() : []
        if (!gaps.includes('cp2-unconfirmed-write')) gaps.push('cp2-unconfirmed-write')
        honesty.processGaps = gaps
        honesty.thisTurn = {
          ...(honesty.thisTurn || {}),
          preToolHardDeny: false,
          preToolSafetyOnlyAllow: true,
          cpGatePhase: gate.phase
        }
        state.enforcementHonesty = honesty
      }
      if (useHardDeny) {
        const honesty = state.enforcementHonesty && typeof state.enforcementHonesty === 'object'
          ? { ...state.enforcementHonesty }
          : {}
        honesty.thisTurn = {
          ...(honesty.thisTurn || {}),
          preToolHardDeny: true,
          preToolSafetyOnlyAllow: false,
          cpGatePhase: gate.phase,
          processEnforcementReason: hard.reason
        }
        state.enforcementHonesty = honesty
      }
      saveState(state)
      writeStdout(useHardDeny
        ? buildCpDenyOutput(state, platform, eventName, gate, getToolName(payload) || 'tool')
        : buildCpWarningOutput(state, platform, eventName, gate, getToolName(payload) || 'tool'))
      return
    }

    // 3.5 S07 product-artifact order (VL-004): reports/memory/ledgers vs first user-visible PC
    // Note: tool-loop hosts rarely have verified-present precheck mid-turn; late is expected if products write first.
    if (isProductArtifactMutation(payload, platform)) {
      markProductMutationOrder(state, payload, platform)
      const precheckStatus = getPrecheckEvidenceStatus(state)
      if (precheckStatus !== 'verified-present') {
        const reason = 's07-product-before-entry-check'
        const detailZh = 'S07 时序：产物 mutation（reports/.memory/台账）须在用户首次可见 PC0~PC7 之后；禁止最终文首补 PC 冒充先输出。'
        const detailEn = 'S07 order: product artifact writes require first user-visible PC0-PC7 before reports/memory/ledger mutations.'
        if (isStrictEnforcement()) {
          state.lastReason = reason
          saveState(state)
          writeStdout(buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, reason,
            reason, detailZh, detailEn
          ))
          return
        }
        if (!state.s07ProductWarnEmitted) {
          state.s07ProductWarnEmitted = true
          state.lastReason = `${reason}-warn`
          updateArtifactTouches(state, payload, platform)
          state.turnLiveness = startToolLease(state.turnLiveness, payload, getToolName(payload))
          saveState(state)
          writeStdout(buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, reason,
            reason,
            `${detailZh} Tool allowed in safety-only mode.`,
            `${detailEn} Tool allowed in safety-only mode.`
          ))
          return
        }
      }
    }

    updateArtifactTouches(state, payload, platform)
    state.turnLiveness = startToolLease(state.turnLiveness, payload, getToolName(payload))
    saveState(state)
    writeStdout(contextGateOutput || noopOutput())
    return
  }

  // ── PostToolUse ────────────────────────────────────────────────────────────
  if (eventName === 'PostToolUse') {
    recordContextPostToolUse(state, payload)
    markContextPostMutationStale(state, payload, platform)
    observeGovernanceLedgerWrite(state, payload, {
      activeRoot: getActiveNamespaceRoot(state),
      contextRoot: CONTEXT_ROOT,
      eventName,
      toolName: getToolName(payload)
    })
    markProductMutationOrder(state, payload, platform)
    updateArtifactTouches(state, payload, platform)
    state.turnLiveness = completeToolLease(state.turnLiveness, payload)
    saveState(state)
    writeStdout(noopOutput())
    return
  }

  // ── PreCompact / Stop ──────────────────────────────────────────────────────
  if (eventName === 'PreCompact' || eventName === 'Stop') {
    if (eventName === 'PreCompact') markContextAcquisitionStale(state, 'compact')
    captureFinalPayloadSample(payload, eventName, state)

    if (eventName === 'Stop' && state.contextAcquisition?.contextEpoch) {
      try {
        const {
          evaluateProgressiveSkillRouteStop
        } = require('./skill-route-tool.cjs')
        const routeStop = evaluateProgressiveSkillRouteStop({
          project: state.contextAcquisition.project,
          contextEpoch: state.contextAcquisition.contextEpoch,
          assistantText: getVisibleReplyText(payload) || ''
        }, {
          inputRoot: CONTEXT_ROOT,
          env: process.env
        })
        state.progressiveSkillRouteStop = routeStop
        const explicitRoutePending =
          state.progressiveSkillRoute?.bootstrap?.explicitStatus === 'ready'
        if (
          routeStop.present &&
          !routeStop.complete &&
          (routeStop.errorCode !== 'PLAN_NOT_COMMITTED' || explicitRoutePending)
        ) {
          const enforceCount = Number(state.progressiveSkillRouteStopCount || 0)
          if (enforceCount < 2) {
            state.progressiveSkillRouteStopCount = enforceCount + 1
            const reason = routeStop.pendingStageIds?.length
              ? `Progressive Skill route stages remain pending: ${routeStop.pendingStageIds.join(', ')}.`
              : (routeStop.mustReplyCore && !routeStop.businessSatisfied
                  ? `The selected Skill requires this core reply: ${routeStop.mustReplyCore}`
                  : `Progressive Skill route is incomplete: ${routeStop.errorCode || 'unknown'}.`)
            const output = eventSupportsHardBlock(platform, eventName)
              ? decorateHookOutput(
                  blockOutput(platform, eventName, 'progressive-skill-route', reason),
                  {
                    devcodexAction: INTERCEPTION_ACTION.REQUIRE_COMPLETION,
                    devcodexCode: 'progressive-skill-route',
                    devcodexEffective: true,
                    devcodexNextStep: reason
                  }
                )
              : buildInterceptionOutput(
                  state,
                  platform,
                  eventName,
                  INTERCEPTION_ACTION.REQUIRE_COMPLETION,
                  'progressive-skill-route',
                  'Progressive Skill route incomplete',
                  reason,
                  reason
                )
            saveState(state)
            writeStdout(output)
            return
          }
        }
      } catch (error) {
        state.progressiveSkillRouteStop = {
          schemaVersion: 'ProgressiveSkillRouteStopV1',
          present: false,
          complete: false,
          errorCode: String(error.code || error.message || 'STOP_GATE_FAILED')
        }
      }
    }

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
    if (eventName === 'Stop') {
      // B2: evaluateStopCompletionGate — Grok always hard-blocks when supported; others keep strict-only hard path
      const lastAssistantMessage =
        extractLastAssistantMessage(payload) ||
        getVisibleReplyText(payload) ||
        ''
      const stopHookActive = !!(payload.stopHookActive || payload.stop_hook_active)
      const continuationCount = Number(state.stopContinuationCount || 0)
      const gateResult = evaluateStopCompletionGate({
        mode: state.mode || '',
        workflow: state.workflow || state.mode || '',
        mutated: !!state.mutated,
        reportTouched: !!state.reportTouched,
        memoryTouched: !!state.memoryTouched,
        lastAssistantMessage,
        stopHookActive,
        continuationCount,
        softCap: 8,
        state
      })
      const hardEvents = ['pretooluse', 'stop'].filter(ev => eventSupportsHardBlock(platform, ev))
      const priorHonesty = state.enforcementHonesty && typeof state.enforcementHonesty === 'object'
        ? state.enforcementHonesty
        : {}
      state.enforcementHonesty = {
        ...priorHonesty,
        ...gateResult.honesty,
        host: platform,
        hardBlockEventsEnabled: hardEvents,
        processGaps: [
          ...new Set([
            ...(priorHonesty.processGaps || []),
            ...(gateResult.gaps || []),
            ...((gateResult.honesty && gateResult.honesty.processGaps) || [])
          ])
        ],
        evidenceMode: platform === 'grok' ? 'path-observable+stop-conditional' : 'host-native'
      }

      if (gateResult.decision === 'block') {
        const forceHard = platform === 'grok' || isStrictEnforcement()
        if (forceHard && eventSupportsHardBlock(platform, eventName)) {
          state.stopContinuationCount = continuationCount + 1
          output = decorateHookOutput(
            blockOutput(platform, eventName, gateResult.reason, gateResult.reason),
            {
              devcodexAction: INTERCEPTION_ACTION.REQUIRE_COMPLETION,
              devcodexCode: 'stop-completion-gate',
              devcodexEffective: true,
              devcodexNextStep: 'Complete missing entry/PR-1/FVS/report/memory then finish.',
              devcodexProcessGaps: (gateResult.gaps || []).join(',')
            }
          )
          recordInterception(
            state,
            eventName,
            platform,
            INTERCEPTION_ACTION.REQUIRE_COMPLETION,
            'stop-completion-gate',
            gateResult.reason,
            'Complete missing items then finish.',
            true
          )
        } else if (!reminder) {
          output = buildInterceptionOutput(
            state,
            platform,
            eventName,
            INTERCEPTION_ACTION.REQUIRE_COMPLETION,
            'stop-completion-gate',
            'DevCodex Stop gate incomplete',
            gateResult.reason,
            'Complete missing items then finish.'
          )
        }
      }

      const failed = payload.success === false || payload.is_error === true || payload.isError === true || !!payload.error
      state.turnLiveness = markTurnTerminal(
        state.turnLiveness,
        failed ? 'error' : 'completed',
        failed ? 'stop-event-error' : 'stop-event-completed'
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
