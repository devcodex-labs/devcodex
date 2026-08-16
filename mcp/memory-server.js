#!/usr/bin/env node
'use strict'

/**
 * DevCodex MCP Memory Server — local stdio process (deployed to .claude/mcp/; needs .claude/scripts/lib deps)
 *
 * Implements MCP 2024-11-05 protocol over stdin/stdout (JSON-RPC 2.0).
 *
 * Tools:
 *   memory_status         — Read bounded today/yesterday/SUMMARY metadata
 *   memory_session_query  — Read exact bounded daily-memory session sections
 *   memory_summary_query  — Read bounded latest/unresolved SUMMARY rows
 *   memory_session_allocate — Atomically reserve the next daily session section
 *   memory_task_resolve   — Resolve an exact task identity without loading task bodies
 *   memory_session_read   — Read today's/yesterday's session memory file
 *   memory_session_write  — Append a block to one allocation-bound daily session
 *   memory_cp_confirm     — Record CP checkpoint confirmation in sessions.md
 *   memory_summary_read   — Read agent SUMMARY.md
 *   memory_summary_append — Append one index row to agent SUMMARY.md
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { assertSingleSegment, resolveInside, resolveExistingRegularFileInside } = require('./path-guard')
const { createJsonLineServer } = require('./stdio-jsonrpc.cjs')
const { createMemoryFileTransaction } = require('./memory-file-transaction.cjs')
const {
  readBoundedTextFileSync,
  scanBoundedTextLinesSync
} = require('./bounded-text-reader.cjs')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath,
  PROJECT_NAMESPACE_SCHEMA_PATTERN,
  normalizeProjectNamespace,
  resolveLegacyProjectRoot,
  resolveRuntimeStateRoot
} = require('../hooks/_runtime/workspace-layout.cjs')
const {
  CONTEXT_READ_CONTRACT,
  buildContextReadError
} = require('../hooks/_runtime/context-read-contract.cjs')
const { buildJsonContentIdentity } = require('../hooks/_runtime/content-identity.cjs')
const {
  authorizeContextRead,
  recordMcpContextSourceObservations
} = require('../hooks/_runtime/context-source-observation.cjs')
const {
  currentActiveSessionIds,
  rowsByCurrentState,
  summaryStateConflicts
} = require('../scripts/lib/memory-summary-state.js')
const {
  TaskContinuationError,
  resolveTaskContinuation
} = require('../hooks/_runtime/task-continuation-contract.cjs')

function loadCpDigestContract() {
  try {
    return require('../scripts/lib/cp-digest.js')
  } catch {
    return null
  }
}

const CP_DIGEST_CONTRACT = loadCpDigestContract()

function loadMemoryIndexContract() {
  try {
    return require('../scripts/lib/memory-index.js')
  } catch {
    return null
  }
}

const MEMORY_INDEX_CONTRACT = loadMemoryIndexContract()
const MEMORY_FILE_TRANSACTION = createMemoryFileTransaction()

function loadSummaryTypeCanon() {
  try {
    return require('../scripts/lib/summary-type-canon.js')
  } catch {
    return null
  }
}

const SUMMARY_TYPE_CANON = loadSummaryTypeCanon()

const INPUT_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd()

// ─── Server metadata ──────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'devcodex-memory',
  version: '1.0.0'
}

const {
  VALID_AGENTS,
  normalizeAgent,
  detectRuntimeAgent
} = require('./agent-identity.cjs')

// Prefer DEVCODEX_AGENT; otherwise infer host env (incl. grok). Never default to claude-code.
const EXPLICIT_RUNTIME_AGENT = normalizeAgent(process.env.DEVCODEX_AGENT)
const DEFAULT_AGENT = detectRuntimeAgent()
const TASK_KINDS = new Set(['requirements', 'bugs', 'optimizations', 'scenario-tests'])
const MAX_MEMORY_SESSION_WRITE_CHARS = 262144
const MEMORY_SESSION_WRITE_REQUIRED_FIELDS = Object.freeze(['content', 'sessionId', 'sessionBinding'])
const MEMORY_SOURCE_MAX_BYTES = 8 * 1024 * 1024
const WORKSPACE_CONTEXT_PROJECT = '__workspace__'
const PROJECT_NAMESPACE_INPUT_SCHEMA = Object.freeze({
  type: 'string',
  pattern: PROJECT_NAMESPACE_SCHEMA_PATTERN
})

const CONTEXT_READ_BINDING_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'contextEpoch', 'planId', 'planContentId', 'activeRoot', 'project'],
  properties: {
    schemaVersion: { const: 'ContextReadBindingV1' },
    contextEpoch: { type: 'string', minLength: 1 },
    planId: { type: 'string', minLength: 1 },
    planContentId: { type: 'string', minLength: 1 },
    activeRoot: { type: 'string', minLength: 1 },
    project: { type: 'string' }
  },
  additionalProperties: false
}

const TOOLS = [
  {
    name: 'memory_task_resolve',
    description: '按稳定 taskId、active displayName 或 alias 精确定位任务。只读取有界 identity/session/CP 元数据，不把任务名或派生索引当作状态真相。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 300, description: '精确任务名、alias 或稳定 taskId' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '可选项目命名空间；提供后限制为 project scope' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选；默认按 cwd/project 推断' },
        persistIndex: { type: 'boolean', description: '是否持久化可重建索引；默认 true' }
      }
    }
  },
  {
    name: 'memory_status',
    description: '返回当前目标的紧凑记忆状态：今日/昨日元数据、有限 SUMMARY 行、活动会话与状态冲突。不返回整文件正文。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '集中布局下的项目命名空间' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'latestRows 数量，默认 5，最大 20' },
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_session_query',
    description: '按日期、会话、状态或 ContextHandoffCard 精确读取 daily memory 的有限片段。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '集中布局下的项目命名空间' },
        date: { type: 'string', pattern: '^\\d{8}$', description: 'YYYYMMDD，默认今日' },
        sessionId: { type: 'string', minLength: 1, maxLength: 64, description: '精确会话编号，如 01 或 02a' },
        status: { type: 'string', enum: ['active', 'completed', 'blocked', 'unresolved', 'all'], description: '会话状态，默认 all' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回会话数，默认 1' },
        handoffOnly: { type: 'boolean', description: '仅返回 ContextHandoffCard' },
        maxChars: { type: 'integer', minimum: 1, maximum: 50000, description: '正文总字符预算，默认 12000' },
        cursor: { type: 'string', minLength: 1, maxLength: 8192, description: '上一页返回的 opaque MemoryCursorV1；必须与同一 tool/target/context/query/source 完全匹配' },
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_summary_query',
    description: '返回有限的 SUMMARY 行；默认仅返回 active，支持 unresolved、since 与 last-N。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '集中布局下的项目命名空间' },
        status: { type: 'string', enum: ['active', 'completed', 'blocked', 'unresolved', 'all'], description: '默认 active' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '最多返回行数，默认 5，最大 50' },
        since: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '只返回该日期及之后的行' },
        cursor: { type: 'string', minLength: 1, maxLength: 8192, description: '上一页返回的 opaque MemoryCursorV1；必须与同一 tool/target/context/query/source 完全匹配' },
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_session_allocate',
    description: '在 active-root/agent/date 作用域内原子分配下一会话编号与不透明 sessionBinding，并写入 reserved daily memory 段；后续写入必须回传二者，避免多写者串写。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的写入域' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '集中布局下的项目命名空间' },
        date: { type: 'string', pattern: '^\\d{8}$', description: 'YYYYMMDD，默认今日' },
        title: { type: 'string', minLength: 1, maxLength: 160, description: '会话标题，默认 未命名任务' },
        intent: { type: 'string', maxLength: 120, description: '意图标签，默认 unspecified' },
        sourceMessage: { type: 'string', maxLength: 300, description: '用户消息摘要，可选' }
      }
    }
  },
  {
    name: 'memory_session_read',
    description: '兼容读取今日或昨日的会话记忆文件；仍要求当前计划授权。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      properties: {
        agent: { type: 'string', description: 'Agent 标识（如 claude-code / codex / copilot / grok），默认当前实际宿主' },
        date: { type: 'string', description: 'YYYYMMDD 日期，默认今日' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定读取域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误读项目记忆。' },
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_session_write',
    description: '把内容追加到已分配的精确会话段。必须传 memory_session_allocate 返回的 sessionId 与 sessionBinding；旧版无绑定会话保持只读，需先分配新的绑定会话。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [...MEMORY_SESSION_WRITE_REQUIRED_FIELDS],
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        date: { type: 'string', description: 'YYYYMMDD 日期，默认今日' },
        content: { type: 'string', minLength: 1, maxLength: MAX_MEMORY_SESSION_WRITE_CHARS, description: '追加的 Markdown 内容，最多 262144 字符' },
        sessionId: { type: 'string', minLength: 1, maxLength: 64, description: 'memory_session_allocate 返回的精确会话编号。每次写入必填。' },
        sessionBinding: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'memory_session_allocate 返回的不透明绑定值。每次写入必填且必须原样回传。' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误写项目记忆。' }
      }
    }
  },
  {
    name: 'memory_cp_confirm',
    description: '在任务的 .memory/sessions.md 中记录 CP 确认状态（✅）。控制面/推荐路径应传入 artifactPath+artifactSha256（ConfirmBindingGate）；仅 phase/time 为 legacy 兼容。',
    inputSchema: {
      type: 'object',
      required: ['requirement', 'phase'],
      properties: {
        requirement: { type: 'string', description: '任务目录名（兼容旧字段名；配合 kind 指向 .devcodex/requirements/<name> 或 .devcodex/bugs/<name>）' },
        kind: { type: 'string', enum: ['requirements', 'bugs', 'optimizations', 'scenario-tests'], description: '任务根类型，默认 requirements' },
        phase: { type: 'string', enum: ['CP1', 'CP2', 'CP3'], description: 'CP 阶段' },
        time: { type: 'string', description: '确认时间（如 10:30），默认当前时间' },
        artifactPath: { type: 'string', description: 'ConfirmBindingGate：被确认产物相对当前任务目录的规范路径（如 01-需求确认.md）' },
        artifactVersion: { type: 'string', description: 'ConfirmBindingGate：产物版本号（如 v0.4.0）' },
        artifactSha256: { type: 'string', description: 'ConfirmBindingGate：确认前对产物全文计算的 SHA-256（hex，大小写不敏感）' },
        sourceMessage: { type: 'string', description: '用户确认原话摘要' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误写任务确认。' }
      }
    }
  },
  {
    name: 'memory_summary_read',
    description: '兼容读取 Agent SUMMARY.md 文件内容；仍要求当前计划授权。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定读取域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误读 SUMMARY。' },
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_summary_append',
    description: '向 Agent SUMMARY.md 追加一条状态事件；同一日期/会话的最后事件形成当前状态，历史行保留用于审计。',
    inputSchema: {
      type: 'object',
      required: ['row'],
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        row: { type: 'string', description: 'Markdown 表格行（含首尾 |）' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误写 SUMMARY。' }
      }
    }
  }
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLocalDate(date = new Date()) {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('')
}

function formatLocalDateTime(date = new Date()) {
  const compactDate = formatLocalDate(date)
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  const offset = `${offsetSign}${String(Math.floor(absoluteOffset / 60)).padStart(2, '0')}:${String(absoluteOffset % 60).padStart(2, '0')}`
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)} ${currentTime(date)} ${offset}`
}

function today() {
  return formatLocalDate()
}

function currentTime(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function isRealCompactDate(value) {
  const text = String(value || '')
  if (!/^\d{8}$/.test(text)) return false
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  const parsed = new Date(`${iso}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
}

function validateDate(date) {
  if (!date) return
  if (!/^\d{8}$/.test(String(date))) throw new Error(`date must be YYYYMMDD, got: ${date}`)
  if (!isRealCompactDate(date)) throw new Error(`date is not a real calendar date: ${date}`)
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8') } catch (err) {
    if (err.code === 'ENOENT') return ''
    throw err
  }
}

function readJsonFile(filePath) {
  const raw = readFile(filePath)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

const LAYOUT = findLayoutInfo(INPUT_ROOT)

function inferContextProject() {
  return inferProjectFromCwd(INPUT_ROOT, LAYOUT)
}

const CONTEXT_PROJECT = inferContextProject()
const DEFAULT_SCOPE = LAYOUT.enabled ? (CONTEXT_PROJECT ? 'project' : 'workspace') : 'project'

function resolveProjectName(projectName) {
  const normalized = normalizeProjectNamespace(projectName, {
    layout: LAYOUT,
    contextProject: LAYOUT.enabled ? CONTEXT_PROJECT : '',
    allowEmpty: true
  })
  if (LAYOUT.enabled || !normalized) return normalized
  return path.basename(resolveLegacyProjectRoot(INPUT_ROOT, normalized))
}

function resolveProjectRoot(projectName) {
  return resolveLegacyProjectRoot(INPUT_ROOT, projectName)
}

function resolveScope(scope) {
  const value = String(scope || '').trim().toLowerCase()
  if (value === 'workspace' || value === 'project') return value
  return DEFAULT_SCOPE
}

function getActiveRoot(args = {}) {
  if (!LAYOUT.enabled) {
    return path.join(resolveProjectRoot(args.project), '.devcodex')
  }
  const explicitScope = Object.prototype.hasOwnProperty.call(args, 'scope') && String(args.scope || '').trim()
  const projectName = resolveProjectName(args.project)
  const scope = explicitScope ? resolveScope(args.scope) : (projectName ? 'project' : DEFAULT_SCOPE)
  if (!explicitScope && !projectName) {
    throw new Error('workspace-namespace memory scope is ambiguous at workspace root; pass project or explicit scope:"workspace"')
  }
  if (scope === 'project' && !projectName) {
    throw new Error('workspace-namespace project memory requires project when cwd is workspace root')
  }
  if (scope === 'workspace' || !projectName) {
    return path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace')
  }
  return namespaceRootPath(LAYOUT.workspaceRoot, projectName)
}

function sessionFilePath(agent, date, args = {}) {
  const candidate = agent === undefined || agent === null || agent === ''
    ? DEFAULT_AGENT
    : assertSingleSegment(agent, 'agent')
  const safeAgent = normalizeAgent(candidate)
  if (!safeAgent) throw new Error('invalid agent')
  return resolveInside(getActiveRoot(args), '.memory', 'clients', safeAgent, 'tasks', `${date || today()}.md`)
}

function summaryFilePath(agent, args = {}) {
  const candidate = agent === undefined || agent === null || agent === ''
    ? DEFAULT_AGENT
    : assertSingleSegment(agent, 'agent')
  const safeAgent = normalizeAgent(candidate)
  if (!safeAgent) throw new Error('invalid agent')
  return resolveInside(getActiveRoot(args), '.memory', 'clients', safeAgent, 'SUMMARY.md')
}

function summaryProjectLabel(args = {}) {
  if (!LAYOUT.enabled) return path.basename(resolveProjectRoot(args.project)) || 'project'
  const explicitScope = Object.prototype.hasOwnProperty.call(args, 'scope') && String(args.scope || '').trim()
  const projectName = resolveProjectName(args.project)
  const scope = explicitScope ? resolveScope(args.scope) : (projectName ? 'project' : DEFAULT_SCOPE)
  if (scope === 'workspace') return 'workspace'
  return projectName || CONTEXT_PROJECT || 'project'
}

function summaryHeader(agent, args = {}) {
  return [
    `# Agent SUMMARY — ${agent || DEFAULT_AGENT}`,
    '',
    `> 项目：${summaryProjectLabel(args)}`,
    '',
    '| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |',
    '|------|:----:|------|------|---------|---------|:----:|'
  ].join('\n') + '\n'
}

function taskSessionsPath(kind, requirement, args = {}) {
  return resolveInside(getActiveRoot(args), kind, assertSingleSegment(requirement, 'requirement'), '.memory', 'sessions.md')
}

const CP_HEADING_RE = /^#{1,6}\s+.*CP\s*确认记录\s*$/i
const CP_TABLE_HEADER_RE = /^\|\s*CP\s*\|\s*状态\s*\|\s*(?:时间\s*\||artifactPath\s*\|\s*version\s*\|\s*sha256\s*\|\s*sourceMessage\s*\|\s*confirmedAt\s*\|)\s*$/i
const EXTENDED_CP_TABLE_HEADER_RE = /^\|\s*CP\s*\|\s*状态\s*\|\s*artifactPath\s*\|\s*version\s*\|\s*sha256\s*\|\s*sourceMessage\s*\|\s*confirmedAt\s*\|\s*$/i

function parseCpTableRows(text) {
  if (CP_DIGEST_CONTRACT) return CP_DIGEST_CONTRACT.parseCpSessions(text)
  const rows = { CP1: null, CP2: null, CP3: null }
  const lineRe = /^\|\s*(CP[123])\s*\|\s*([^|\n]+)\|(.*)$/gm
  let match
  while ((match = lineRe.exec(String(text || ''))) !== null) {
    const cells = String(match[3] || '').split('|').map(cell => cell.trim()).filter(Boolean)
    rows[match[1]] = {
      confirmed: match[2].includes('✅') && !/stale/i.test(match[2]),
      stale: /stale/i.test(match[2]),
      artifactPath: cells.length >= 5 ? cells[0] : null,
      artifactVersion: cells.length >= 5 ? cells[1] : null,
      artifactSha256: cells.length >= 5 ? String(cells[2] || '').replace(/`/g, '').toUpperCase() : null,
      sourceMessage: cells.length >= 5 ? cells[3] : null,
      confirmedAt: cells.length >= 5 ? cells[4] : (cells.length === 1 ? cells[0] : null)
    }
  }
  return rows
}

function renderExtendedCpTable(phases) {
  if (CP_DIGEST_CONTRACT) return CP_DIGEST_CONTRACT.buildExtendedCpTable({ phases })
  const lines = [
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|'
  ]
  for (const phase of ['CP1', 'CP2', 'CP3']) {
    const row = phases[phase]
    lines.push(`| ${phase} | ${row.status} | ${row.artifactPath} | ${row.artifactVersion} | ${row.artifactSha256} | ${row.sourceMessage} | ${row.confirmedAt} |`)
  }
  lines.push('')
  return lines.join('\n')
}

function taskMemoryTransactionTarget(args = {}) {
  const activeRoot = getActiveRoot(args)
  const project = LAYOUT.enabled
    ? (resolveProjectName(args.project) || CONTEXT_PROJECT || '')
    : (path.basename(resolveProjectRoot(args.project)) || path.basename(INPUT_ROOT))
  const workspaceRoot = LAYOUT.enabled ? path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace') : ''
  return {
    activeRoot,
    project: path.resolve(activeRoot) === path.resolve(workspaceRoot || activeRoot) && workspaceRoot ? '' : project,
    scope: workspaceRoot && path.resolve(activeRoot) === path.resolve(workspaceRoot) ? 'workspace' : 'project',
    agent: EXPLICIT_RUNTIME_AGENT || DEFAULT_AGENT
  }
}

function isCpDataRow(line) {
  return /^\|\s*CP[123]\s*\|/.test(String(line || '').trim())
}

/**
 * Locate the dedicated CP confirmation table only.
 * Must not treat ordinary session/index Markdown tables as CP tables (PF-162 / GR-068).
 */
function locateCpTableBlock(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const headingIndex = lines.findIndex(line => CP_HEADING_RE.test(line.trim()))
  let headerIndex = -1
  if (headingIndex >= 0) {
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
      if (/^#{1,6}\s+/.test(lines[index]) && index > headingIndex + 1) break
      if (CP_TABLE_HEADER_RE.test(lines[index].trim())) {
        headerIndex = index
        break
      }
    }
  }
  // Only scan global headers when they are true CP headers (not any table with a "状态" column)
  if (headerIndex < 0) headerIndex = lines.findIndex(line => CP_TABLE_HEADER_RE.test(line.trim()))
  if (headerIndex < 0 && headingIndex < 0) return { lines, found: false }

  if (headerIndex < 0) {
    // Heading without a CP table: treat as incomplete block to be replaced
    return {
      lines,
      found: true,
      start: headingIndex,
      end: headingIndex + 1,
      headingLine: lines[headingIndex],
      incomplete: true
    }
  }

  let end = headerIndex + 1
  while (end < lines.length && (lines[end].trim() === '' || lines[end].trim().startsWith('|'))) end += 1
  const start = headingIndex >= 0 && headingIndex < headerIndex ? headingIndex : headerIndex
  return {
    lines,
    found: true,
    start,
    end,
    headingLine: headingIndex >= 0 && headingIndex < headerIndex ? lines[headingIndex] : '### CP 确认记录',
    incomplete: false
  }
}

/** Strip orphan | CP1 | rows that leaked outside a dedicated CP table (false-success repair). */
function stripOrphanCpRowsOutsideBlock(text) {
  const location = locateCpTableBlock(text)
  const lines = location.lines
  const protectedStart = location.found ? location.start : lines.length
  const protectedEnd = location.found ? location.end : lines.length
  const cleaned = lines.filter((line, index) => {
    if (index >= protectedStart && index < protectedEnd) return true
    return !isCpDataRow(line)
  })
  return cleaned.join('\n')
}

/**
 * Fail closed if CP data rows appear before the dedicated CP section
 * (pollution of ordinary 5-col session index tables).
 */
function assertNoCpRowsOutsideDedicatedBlock(text) {
  const location = locateCpTableBlock(text)
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const start = location.found ? location.start : lines.length
  const end = location.found ? location.end : lines.length
  for (let index = 0; index < lines.length; index += 1) {
    if (index >= start && index < end) continue
    if (isCpDataRow(lines[index])) {
      throw new Error('ConfirmBindingGate: CP rows leaked into non-CP section of sessions.md')
    }
  }
}

function cpCodeCell(value) {
  const normalized = String(value || '').replace(/`/g, '').trim()
  return normalized && normalized !== '—' ? `\`${normalized}\`` : '—'
}

function cpTextCell(value, fallback = '—') {
  const normalized = String(value || '').replace(/[|\r\n]+/g, ' ').trim()
  return normalized || fallback
}

function existingCpPhaseRow(parsed, phase) {
  const row = parsed[phase]
  return {
    status: row?.confirmed ? '✅' : (row?.stale ? '⚠️ stale' : (phase === 'CP1' ? '⏳' : '⏹️')),
    artifactPath: cpCodeCell(row?.artifactPath),
    artifactVersion: cpTextCell(row?.artifactVersion),
    artifactSha256: cpCodeCell(row?.artifactSha256),
    sourceMessage: cpTextCell(row?.sourceMessage),
    confirmedAt: cpTextCell(row?.confirmedAt)
  }
}

function renderCpConfirmation(existing, args, binding) {
  const newline = String(existing || '').includes('\r\n') ? '\r\n' : '\n'
  // Drop orphan CP rows that were previously appended under ordinary tables (PF-162 repair)
  const sanitized = stripOrphanCpRowsOutsideBlock(existing)
  const location = locateCpTableBlock(sanitized)
  const priorBlock = location.found && !location.incomplete
    ? location.lines.slice(location.start, location.end).join('\n')
    : ''
  const parsed = parseCpTableRows(priorBlock)
  const phases = Object.fromEntries(['CP1', 'CP2', 'CP3'].map(phase => [phase, existingCpPhaseRow(parsed, phase)]))
  const active = phases[args.phase]
  active.status = '✅'
  active.confirmedAt = cpTextCell(binding.time)
  if (binding.hasDigest) {
    active.artifactPath = cpCodeCell(binding.artifactPath)
    active.artifactVersion = cpTextCell(binding.artifactVersion)
    active.artifactSha256 = cpCodeCell(binding.sha)
    active.sourceMessage = cpTextCell(binding.sourceMessage)
  }

  const renderedLines = renderExtendedCpTable(phases).split('\n')
  renderedLines[0] = (location.found && location.headingLine) || (sanitized ? '### CP 确认记录' : `# ${args.requirement} — CP 确认记录`)
  const rendered = renderedLines.join('\n')
  let output
  if (location.found) {
    output = [
      ...location.lines.slice(0, location.start),
      ...rendered.split('\n'),
      ...location.lines.slice(location.end)
    ].join('\n')
  } else {
    // Never append a bare CP data row; always materialize heading + header + CP1~CP3
    output = `${String(sanitized || '').trimEnd()}${sanitized ? '\n\n' : ''}${rendered}`
  }
  return output.replace(/\n/g, newline).replace(new RegExp(`${newline}*$`), newline)
}

function fileDigest(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex')
}

function relativeToActiveRoot(target, filePath) {
  return path.relative(target.activeRoot, filePath).replace(/\\/g, '/')
}

function memoryLockDir(target, filePath) {
  const key = crypto
    .createHash('sha256')
    .update(`${target.activeRoot}\0${path.resolve(filePath)}`)
    .digest('hex')
  return resolveInside(resolveRuntimeStateRoot(target.activeRoot, target.project).root, 'memory-locks', key)
}

const MEMORY_LOCK_LEGACY_STALE_MS = 30 * 60 * 1000

function readMemoryLockOwner(lockDir) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'))
    return owner && typeof owner === 'object' && !Array.isArray(owner) ? owner : null
  } catch {
    return null
  }
}

function memoryLockAgeMs(lockDir) {
  try {
    return Math.max(0, Date.now() - fs.statSync(lockDir).mtimeMs)
  } catch {
    return 0
  }
}

function memoryLockProcessState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead'
    return 'unknown'
  }
}

function assessMemoryLockRecovery(lockDir) {
  const owner = readMemoryLockOwner(lockDir)
  const processState = memoryLockProcessState(owner?.pid)
  if (owner?.schemaVersion === 'MemoryWriterLockV2') {
    if (owner.host !== os.hostname()) {
      return { recoverable: false, reason: 'cross-host-owner', owner, processState }
    }
    return {
      recoverable: processState === 'dead',
      reason: processState === 'dead' ? 'same-host-dead-pid' : 'same-host-owner-not-proven-dead',
      owner,
      processState
    }
  }
  const ageMs = memoryLockAgeMs(lockDir)
  const oldEnough = ageMs >= MEMORY_LOCK_LEGACY_STALE_MS
  const ownerAllowsRecovery = owner?.pid
    ? processState === 'dead'
    : true
  return {
    recoverable: oldEnough && ownerAllowsRecovery,
    reason: !oldEnough
      ? 'legacy-lock-within-safety-window'
      : (ownerAllowsRecovery ? 'legacy-stale-owner' : 'legacy-owner-not-proven-dead'),
    owner,
    processState,
    ageMs
  }
}

function quarantineRecoverableMemoryLock(lockDir) {
  const assessment = assessMemoryLockRecovery(lockDir)
  if (!assessment.recoverable) return { reclaimed: false, raced: false, assessment }
  const quarantineDir = `${lockDir}.stale.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`
  try {
    fs.renameSync(lockDir, quarantineDir)
    return { reclaimed: true, raced: false, quarantineDir, assessment }
  } catch (error) {
    if (error?.code === 'ENOENT') return { reclaimed: false, raced: true, assessment }
    throw error
  }
}

function acquireMemoryLock(target, filePath) {
  const lockDir = memoryLockDir(target, filePath)
  fs.mkdirSync(path.dirname(lockDir), { recursive: true })
  const quarantines = []
  let acquired = false
  for (let attempt = 0; attempt < 3 && !acquired; attempt += 1) {
    try {
      fs.mkdirSync(lockDir)
      acquired = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const recovery = quarantineRecoverableMemoryLock(lockDir)
      if (recovery.reclaimed) {
        quarantines.push(recovery.quarantineDir)
        continue
      }
      if (recovery.raced) continue
      throw new Error(`MEMORY_TRANSACTION_LOCKED: ${relativeToActiveRoot(target, filePath)} is locked by another writer (${recovery.assessment.reason})`)
    }
  }
  if (!acquired) {
    throw new Error(`MEMORY_TRANSACTION_LOCKED: ${relativeToActiveRoot(target, filePath)} lock acquisition raced repeatedly`)
  }
  const token = crypto.randomBytes(16).toString('hex')
  const owner = {
    schemaVersion: 'MemoryWriterLockV2',
    pid: process.pid,
    host: os.hostname(),
    token,
    file: relativeToActiveRoot(target, filePath),
    acquiredAt: new Date().toISOString()
  }
  try {
    fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    try { fs.rmSync(lockDir, { recursive: true, force: true }) } catch { /* leave fail-closed */ }
    throw error
  }
  for (const quarantineDir of quarantines) {
    try { fs.rmSync(quarantineDir, { recursive: true, force: true }) } catch { /* status exposes residual quarantine */ }
  }
  return { lockDir, token }
}

function releaseMemoryLock(lock) {
  const owner = readMemoryLockOwner(lock.lockDir)
  if (!owner || owner.schemaVersion !== 'MemoryWriterLockV2' || owner.token !== lock.token) return
  try {
    fs.rmSync(lock.lockDir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup. A stale lock is safer than deleting an unknown path.
  }
}

function withMemoryTransaction(target, filePath, operation) {
  const lock = acquireMemoryLock(target, filePath)
  const startedAt = new Date().toISOString()
  try {
    const expectedSnapshot = MEMORY_FILE_TRANSACTION.readSnapshot(filePath)
    const planned = operation(expectedSnapshot.content)
    const content = typeof planned === 'string' ? planned : planned?.content
    const appendText = typeof planned === 'object' && typeof planned?.appendText === 'string'
      ? planned.appendText
      : null
    if (typeof content !== 'string') {
      throw new Error('MEMORY_TRANSACTION_PLAN_INVALID: writer must return a string or { content, appendText }.')
    }
    return MEMORY_FILE_TRANSACTION.commit({
      filePath,
      relativeFile: relativeToActiveRoot(target, filePath),
      expectedSnapshot,
      content,
      appendText,
      startedAt,
      receiptContext: {
        activeRoot: target.activeRoot,
        project: target.project,
        scope: target.scope,
        agent: target.agent
      }
    })
  } finally {
    releaseMemoryLock(lock)
  }
}

function parseExistingSessionNumbers(content) {
  const ids = []
  const re = /^##\s+会话\s+#?(\d+)\b/gm
  let match
  while ((match = re.exec(content || '')) !== null) {
    ids.push(Number(match[1]))
  }
  return ids.filter(Number.isFinite)
}

function formatSessionId(number) {
  return number < 100 ? String(number).padStart(2, '0') : String(number)
}

const MEMORY_SESSION_BINDING_RE = /^[a-f0-9]{64}$/
const MEMORY_SESSION_BINDING_MARKER_RE = /<!--\s*devcodex:memory-session-binding\s+v1\s+session=([^\s]+)\s+token=([a-f0-9]{64})\s*-->/gi
const MEMORY_SESSION_ALLOCATE_FIELDS = new Set([
  'agent', 'scope', 'project', 'date', 'title', 'intent', 'sourceMessage'
])
const MEMORY_SESSION_WRITE_FIELDS = new Set([
  'agent', 'scope', 'project', 'date', 'content', 'sessionId', 'sessionBinding'
])

function memorySessionBindingMarker(sessionId, sessionBinding) {
  return `<!-- devcodex:memory-session-binding v1 session=${sessionId} token=${sessionBinding} -->`
}

function parseDailySessionBlocks(content) {
  const source = String(content || '')
  const headingRe = /^##[ \t]+会话[ \t]+([^\s—-]+)(?:[ \t]*[-—][ \t]*([^\r\n]*))?[ \t]*\r?$/gm
  const headings = []
  let match
  while ((match = headingRe.exec(source)) !== null) {
    let sessionId
    try {
      sessionId = normalizeSessionId(match[1])
    } catch (error) {
      throw memoryQueryError(
        `Daily memory contains an invalid session heading: ${match[1]}.`,
        'Repair the malformed daily session heading before retrying the write.',
        'MEMORY_SESSION_LAYOUT_INVALID'
      )
    }
    headings.push({ start: match.index, sessionId, title: String(match[2] || '').trim() })
  }
  const candidateHeadings = source.match(/^##[ \t]+会话(?:[ \t]|$).*$/gm) || []
  if (candidateHeadings.length !== headings.length) {
    throw memoryQueryError(
      'Daily memory contains a malformed canonical session heading.',
      'Repair the malformed daily session heading before retrying the write.',
      'MEMORY_SESSION_LAYOUT_INVALID'
    )
  }
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? source.length
    const raw = source.slice(heading.start, end)
    const bindings = []
    MEMORY_SESSION_BINDING_MARKER_RE.lastIndex = 0
    let bindingMatch
    while ((bindingMatch = MEMORY_SESSION_BINDING_MARKER_RE.exec(raw)) !== null) {
      let markerSessionId
      try {
        markerSessionId = normalizeSessionId(bindingMatch[1])
      } catch (error) {
        throw memoryQueryError(
          `Daily memory session ${heading.sessionId} contains an invalid binding marker identity.`,
          'Repair the invalid session binding marker before retrying the write.',
          'MEMORY_SESSION_LAYOUT_INVALID'
        )
      }
      if (markerSessionId !== heading.sessionId) {
        throw memoryQueryError(
          `Daily memory session ${heading.sessionId} contains a binding marker for session ${markerSessionId}.`,
          'Repair the cross-session binding marker before retrying the write.',
          'MEMORY_SESSION_LAYOUT_INVALID'
        )
      }
      bindings.push(bindingMatch[2])
    }
    if (bindings.length > 1) {
      throw memoryQueryError(
        `Daily memory session ${heading.sessionId} contains multiple binding markers.`,
        'Repair the duplicate session binding markers before retrying the write.',
        'MEMORY_SESSION_LAYOUT_INVALID'
      )
    }
    return {
      ...heading,
      end,
      raw,
      binding: bindings[0] || null,
      digest: fileDigest(raw)
    }
  })
}

function normalizeMemorySessionWriteBinding(args) {
  const hasSessionId = args.sessionId !== undefined && args.sessionId !== null
  const hasSessionBinding = args.sessionBinding !== undefined && args.sessionBinding !== null
  if (hasSessionBinding && !hasSessionId) {
    throw memoryQueryError(
      'sessionBinding cannot be used without sessionId.',
      'Pass the exact sessionId and sessionBinding returned by memory_session_allocate.',
      'MEMORY_SESSION_BINDING_INVALID'
    )
  }
  const sessionId = hasSessionId ? normalizeSessionId(args.sessionId) : null
  if (hasSessionId && !sessionId) {
    throw memoryQueryError(
      'sessionId must not be empty.',
      'Pass the exact sessionId returned by memory_session_allocate.',
      'MEMORY_SESSION_BINDING_INVALID'
    )
  }
  if (hasSessionBinding && !MEMORY_SESSION_BINDING_RE.test(String(args.sessionBinding))) {
    throw memoryQueryError(
      'sessionBinding must be the exact 64-character lowercase value returned by memory_session_allocate.',
      'Pass the allocation receipt values without editing them.',
      'MEMORY_SESSION_BINDING_INVALID'
    )
  }
  return {
    sessionId,
    sessionBinding: hasSessionBinding ? String(args.sessionBinding) : null
  }
}

function validateMemoryWriterArgs(args, allowedFields, toolName, requiredFields = []) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw memoryQueryError(
      `${toolName} arguments must be an object.`,
      `Pass only the published ${toolName} fields.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  const unknown = Object.keys(args).filter(field => !allowedFields.has(field))
  if (unknown.length) {
    throw memoryQueryError(
      `${toolName} received unsupported fields: ${unknown.join(', ')}.`,
      `Remove unsupported fields and pass only the published ${toolName} schema.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  const missing = requiredFields.filter(field => !Object.prototype.hasOwnProperty.call(args, field))
  if (missing.length) {
    throw memoryQueryError(
      `${toolName} is missing required fields: ${missing.join(', ')}.`,
      `Pass every field published in the ${toolName} required list.`,
      'MEMORY_WRITER_ARGUMENT_REQUIRED'
    )
  }
}

function normalizeMemoryAllocationLine(value, fallback, field, maxLength) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') {
    throw memoryQueryError(
      `${field} must be a string.`,
      `Pass one bounded single-line ${field} value.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  const normalized = value.trim()
  if (!normalized) return fallback
  if (normalized.length > maxLength) {
    throw memoryQueryError(
      `${field} exceeds the ${maxLength}-character limit.`,
      `Shorten ${field} and retry the allocation.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized) ||
      /devcodex:memory-session-binding/i.test(normalized)) {
    throw memoryQueryError(
      `${field} must be a safe single line and cannot contain reserved memory binding syntax.`,
      `Remove line breaks, control characters, or reserved binding text from ${field}.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  return normalized
}

function insertMemorySessionContent(existing, content, binding) {
  const blocks = parseDailySessionBlocks(existing)
  if (!binding.sessionId || !binding.sessionBinding) {
    throw memoryQueryError(
      'A memory write requires an allocated sessionId and sessionBinding.',
      'Pass the exact sessionId and sessionBinding returned by memory_session_allocate.',
      'MEMORY_SESSION_BINDING_REQUIRED'
    )
  }
  const matches = blocks.filter(block => block.sessionId === binding.sessionId)
  if (!matches.length) {
    throw memoryQueryError(
      `Memory session ${binding.sessionId} was not found in the selected daily file.`,
      'Reallocate or query the exact date/project/agent session before retrying.',
      'MEMORY_SESSION_NOT_FOUND'
    )
  }
  if (matches.length > 1) {
    throw memoryQueryError(
      `Memory session ${binding.sessionId} is ambiguous in the selected daily file.`,
      'Repair duplicate session headings before retrying.',
      'MEMORY_SESSION_AMBIGUOUS'
    )
  }
  const target = matches[0]
  if (!target.binding) {
    throw memoryQueryError(
      `Legacy memory session ${target.sessionId} has no allocation binding and is read-only.`,
      'Allocate a new managed session and write using its returned sessionId and sessionBinding.',
      'MEMORY_SESSION_BINDING_UNAVAILABLE'
    )
  }
  if (binding.sessionBinding !== target.binding) {
    throw memoryQueryError(
      `Memory session ${target.sessionId} rejected a mismatched allocation binding.`,
      'Use the sessionBinding from the same allocation receipt as sessionId.',
      'MEMORY_SESSION_BINDING_MISMATCH'
    )
  }

  const targetPrefix = existing.slice(0, target.end).replace(/[ \t]*$/, '')
  const suffix = existing.slice(target.end)
  const separator = targetPrefix.endsWith('\n') ? '' : '\n'
  const contentSuffix = String(content).endsWith('\n') ? '' : '\n'
  const next = `${targetPrefix}${separator}${content}${contentSuffix}${suffix}`

  const afterBlocks = parseDailySessionBlocks(next)
  const targetAfter = afterBlocks.find(block => block.sessionId === target.sessionId)
  const nonTargetBefore = blocks.filter(block => block.start !== target.start)
  const nonTargetAfter = afterBlocks.filter(block => block.start !== targetAfter?.start)
  const nonTargetStable = nonTargetBefore.length === nonTargetAfter.length && nonTargetBefore.every((block, index) => (
    block.sessionId === nonTargetAfter[index]?.sessionId && block.raw === nonTargetAfter[index]?.raw
  ))
  const targetChanged = Boolean(targetAfter && targetAfter.raw !== target.raw)
  const targetContainsWrite = Boolean(targetAfter && targetAfter.raw.includes(String(content)))
  if (!nonTargetStable || !targetChanged || !targetContainsWrite) {
    throw memoryQueryError(
      'Memory session write isolation verification failed before persistence.',
      'Do not retry blindly; inspect the daily session layout and writer contract.',
      'MEMORY_SESSION_WRITE_VERIFICATION_FAILED'
    )
  }

  return {
    content: next,
    receipt: {
      schemaVersion: 'MemorySessionWriteReceiptV1',
      mode: 'bound-session',
      sessionId: target.sessionId,
      bindingStatus: 'verified',
      writeDigest: fileDigest(content),
      targetBeforeDigest: target.digest,
      targetAfterDigest: targetAfter.digest,
      nonTargetStable,
      readbackVerified: true
    }
  }
}

// ─── Bounded read-only projection helpers ───────────────────────────────────

const MEMORY_QUERY_STATUSES = new Set(['active', 'completed', 'blocked', 'unresolved', 'all'])
const MEMORY_STATUS_FIELDS = new Set(['agent', 'scope', 'project', 'limit', 'contextBinding'])
const MEMORY_SESSION_QUERY_FIELDS = new Set([
  'agent', 'scope', 'project', 'date', 'sessionId', 'status', 'limit', 'handoffOnly', 'maxChars', 'cursor', 'contextBinding'
])
const MEMORY_SUMMARY_QUERY_FIELDS = new Set(['agent', 'scope', 'project', 'status', 'limit', 'since', 'cursor', 'contextBinding'])
const MAX_SUMMARY_ROWS_FOR_STATUS = 20

function elapsedMs(startedAt) {
  return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(3))
}

function yesterday() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return formatLocalDate(date)
}

function validateQueryDate(value, field = 'date') {
  if (!/^\d{8}$/.test(String(value || ''))) {
    throw memoryQueryError(`${field} must be YYYYMMDD.`)
  }
  if (!isRealCompactDate(value)) {
    throw memoryQueryError(`${field} is not a real calendar date.`)
  }
}

function validateSince(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw memoryQueryError('since must be YYYY-MM-DD.')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw memoryQueryError('since is not a real calendar date.')
  }
}

function memoryQueryError(message, nextStep, code = 'MEMORY_QUERY_INVALID') {
  const error = new Error(message)
  error.contextReadCode = code
  error.nextStep = nextStep || 'Correct the bounded memory query and retry once.'
  return error
}

const MEMORY_CURSOR_SCHEMA = 'MemoryCursorV1'
const MEMORY_CURSOR_PREFIX = 'mcv1'
const MEMORY_CURSOR_MAX_OFFSET = 1000000

function stableCursorValue(value) {
  if (Array.isArray(value)) return value.map(stableCursorValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().flatMap(key => (
    value[key] === undefined ? [] : [[key, stableCursorValue(value[key])]]
  )))
}

function memoryCursorDigest(value) {
  return fileDigest(JSON.stringify(stableCursorValue(value)))
}

function memoryCursorBinding(tool, target, contextBinding, query) {
  return {
    tool,
    targetDigest: memoryCursorDigest({
      activeRoot: comparableActiveRoot(target.activeRoot),
      project: target.project,
      scope: target.scope,
      agent: target.agent
    }),
    contextBindingDigest: memoryCursorDigest(contextBinding),
    queryDigest: memoryCursorDigest(query)
  }
}

function encodeMemoryCursor(input) {
  const payload = {
    schemaVersion: MEMORY_CURSOR_SCHEMA,
    tool: input.tool,
    targetDigest: input.targetDigest,
    contextBindingDigest: input.contextBindingDigest,
    queryDigest: input.queryDigest,
    sourceIdentity: input.sourceIdentity,
    offset: input.offset
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const integrity = fileDigest(`${MEMORY_CURSOR_SCHEMA}\0${body}`)
  return `${MEMORY_CURSOR_PREFIX}.${body}.${integrity}`
}

function decodeMemoryCursor(token, expected) {
  if (typeof token !== 'string' || !token || token.length > 8192 || token !== token.trim()) {
    throw memoryQueryError(
      'cursor must be one exact opaque MemoryCursorV1 token.',
      'Pass nextCursor unchanged with the same query.',
      'MEMORY_CURSOR_INVALID'
    )
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== MEMORY_CURSOR_PREFIX || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) {
    throw memoryQueryError('cursor encoding is invalid.', 'Pass nextCursor unchanged with the same query.', 'MEMORY_CURSOR_INVALID')
  }
  const integrity = fileDigest(`${MEMORY_CURSOR_SCHEMA}\0${parts[1]}`)
  const supplied = Buffer.from(parts[2], 'hex')
  const computed = Buffer.from(integrity, 'hex')
  if (supplied.length !== computed.length || !crypto.timingSafeEqual(supplied, computed)) {
    throw memoryQueryError('cursor integrity check failed.', 'Pass nextCursor unchanged with the same query.', 'MEMORY_CURSOR_INVALID')
  }
  let payload
  try {
    const decoded = Buffer.from(parts[1], 'base64url')
    if (decoded.toString('base64url') !== parts[1]) throw new Error('non-canonical base64url')
    payload = JSON.parse(decoded.toString('utf8'))
  } catch {
    throw memoryQueryError('cursor payload is invalid.', 'Pass nextCursor unchanged with the same query.', 'MEMORY_CURSOR_INVALID')
  }
  const validShape = payload && !Array.isArray(payload) && payload.schemaVersion === MEMORY_CURSOR_SCHEMA &&
    typeof payload.tool === 'string' && /^[a-f0-9]{64}$/.test(payload.targetDigest || '') &&
    /^[a-f0-9]{64}$/.test(payload.contextBindingDigest || '') && /^[a-f0-9]{64}$/.test(payload.queryDigest || '') &&
    /^[a-f0-9]{64}$/.test(payload.sourceIdentity || '') && Number.isInteger(payload.offset) &&
    payload.offset >= 0 && payload.offset <= MEMORY_CURSOR_MAX_OFFSET
  if (!validShape) {
    throw memoryQueryError('cursor payload does not satisfy MemoryCursorV1.', 'Use a current nextCursor from this tool.', 'MEMORY_CURSOR_INVALID')
  }
  for (const field of ['tool', 'targetDigest', 'contextBindingDigest', 'queryDigest']) {
    if (payload[field] !== expected[field]) {
      throw memoryQueryError(
        `cursor ${field} does not match this request.`,
        'Restart from the first page after changing tool, target, context binding, or query fields.',
        'MEMORY_CURSOR_BINDING_MISMATCH'
      )
    }
  }
  return payload
}

function memoryCursorSourceIdentity(projection) {
  const source = projection.source || {}
  return memoryCursorDigest({
    path: source.path || null,
    exists: source.exists === true,
    bytes: Number(source.bytes || 0),
    modifiedAt: source.modifiedAt || null,
    sourceDigest: source.sourceDigest || null,
    sourcePrefixDigest: source.sourcePrefixDigest || null,
    indexSourceIdentity: projection.coverage?.sourceIdentity || null
  })
}

function resolveMemoryCursor(inputCursor, binding) {
  if (inputCursor === undefined) return { offset: 0, payload: null }
  const payload = decodeMemoryCursor(inputCursor, binding)
  return { offset: payload.offset, payload }
}

function applyMemoryCursor(projection, options) {
  const sourceIdentity = memoryCursorSourceIdentity(projection)
  if (options.cursorState.payload && options.cursorState.payload.sourceIdentity !== sourceIdentity) {
    throw memoryQueryError(
      'Memory source changed after this cursor was issued.',
      'Restart from the first page so the result set is based on one source identity.',
      'MEMORY_CURSOR_SOURCE_CHANGED'
    )
  }
  const returned = Number(options.returned || 0)
  const hasMore = options.hasMore === true
  const nextOffset = options.cursorState.offset + returned
  const sourceComplete = projection.canonicalSourceTrust?.status !== 'partial' &&
    projection.fallbackCoverage?.status !== 'partial'
  const nextCursor = hasMore && sourceComplete && returned > 0
    ? encodeMemoryCursor({
        ...options.binding,
        sourceIdentity,
        offset: nextOffset
      })
    : null
  projection.pagination = {
    schemaVersion: 'MemoryPaginationV1',
    cursorAccepted: Boolean(options.cursorState.payload),
    returned,
    hasMore,
    sourceComplete,
    nextCursor,
    blockedReason: hasMore && !nextCursor
      ? (returned === 0 ? 'page-made-no-progress' : 'canonical-source-partial')
      : null
  }
  projection.nextCursor = nextCursor
  return projection
}

function comparableActiveRoot(value) {
  const resolved = path.resolve(String(value || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function resolveContextReadBinding(binding, target, sourceId) {
  if (binding === undefined || binding === null) {
    throw memoryQueryError(
      'A current ContextReadBindingV1 is required before reading governed Memory content.',
      'Generate a ContextReadPlanV2 for the resolved target and pass its exact contextBinding.',
      'CONTEXT_BINDING_REQUIRED'
    )
  }
  if (typeof binding !== 'object' || Array.isArray(binding)) {
    throw memoryQueryError(
      'contextBinding must be an object.',
      'Pass the exact ContextReadBindingV1 derived from the current ContextReadPlanV2.',
      'CONTEXT_BINDING_INVALID'
    )
  }
  const allowed = new Set(['schemaVersion', 'contextEpoch', 'planId', 'planContentId', 'activeRoot', 'project'])
  const unknown = Object.keys(binding).filter(key => !allowed.has(key))
  const requiredStrings = ['contextEpoch', 'planId', 'planContentId', 'activeRoot']
  if (unknown.length || binding.schemaVersion !== 'ContextReadBindingV1' ||
      requiredStrings.some(field => typeof binding[field] !== 'string' || !binding[field].trim()) ||
      typeof binding.project !== 'string') {
    throw memoryQueryError(
      'contextBinding does not match the published ContextReadBindingV1 request schema.',
      'Pass only schemaVersion/contextEpoch/planId/planContentId/activeRoot/project from the current plan.',
      'CONTEXT_BINDING_INVALID'
    )
  }
  if (comparableActiveRoot(binding.activeRoot) !== comparableActiveRoot(target.activeRoot) ||
      binding.project.trim() !== String(target.project || '').trim()) {
    throw memoryQueryError(
      'contextBinding target does not match the resolved active root and project.',
      'Regenerate the ContextReadPlanV2 for the resolved memory target.',
      'CONTEXT_BINDING_MISMATCH'
    )
  }
  const authorization = authorizeContextRead({
    activeRoot: target.activeRoot,
    project: target.project,
    contextBinding: binding,
    requestedSources: sourceId ? [sourceId] : []
  })
  if (authorization.status !== 'authorized') {
    throw memoryQueryError(
      authorization.message || 'Context read authorization failed.',
      'Generate a current ContextReadPlanV2 that selects this Memory source and retry once.',
      authorization.errorCode || 'CONTEXT_BINDING_INVALID'
    )
  }
  return authorization.binding
}

function normalizeBoundedInteger(value, fallback, max, field) {
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw memoryQueryError(`${field} must be an integer between 1 and ${max}.`)
  }
  return value
}

function normalizeQueryStatus(value, fallback) {
  if (value !== undefined && value !== null && (
    typeof value !== 'string' || value !== value.trim() || value !== value.toLowerCase()
  )) {
    throw memoryQueryError('status must use one exact lowercase published value.')
  }
  const status = String(value === undefined || value === null ? fallback : value)
  if (!MEMORY_QUERY_STATUSES.has(status)) {
    throw memoryQueryError(`status must be one of: ${[...MEMORY_QUERY_STATUSES].join(', ')}.`)
  }
  return status
}

function normalizeSessionId(value) {
  const raw = String(value || '').trim().replace(/^#/, '').replace(/^会话\s*/i, '')
  if (!raw) return ''
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(raw)) {
    throw memoryQueryError('sessionId must be a bounded identifier such as 01 or 02a.')
  }
  return /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw.toLowerCase()
}

function normalizeSummarySessionId(value) {
  const raw = String(value || '').trim().replace(/^#/, '').replace(/^会话\s*/i, '')
  if (!raw) return ''
  return /^\d+$/.test(raw) ? raw.padStart(2, '0') : clipText(raw, 64).text
}

function validateProjectionArgs(args, allowedFields) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw memoryQueryError('Memory query arguments must be an object.')
  }
  const unknown = Object.keys(args).filter(key => !allowedFields.has(key))
  if (unknown.length) throw memoryQueryError(`Unsupported memory query fields: ${unknown.join(', ')}.`)
  if (args.scope !== undefined && (
    typeof args.scope !== 'string' || !['project', 'workspace'].includes(args.scope)
  )) {
    throw memoryQueryError('scope must be project or workspace.')
  }
  if (args.project !== undefined && (typeof args.project !== 'string' || !args.project.trim())) {
    throw memoryQueryError('project must be a non-empty namespace when supplied.')
  }
}

function resolveMemoryAgent(agent, activeRoot) {
  const explicit = agent !== undefined && agent !== null && agent !== ''
  if (!explicit && EXPLICIT_RUNTIME_AGENT) return EXPLICIT_RUNTIME_AGENT
  if (!explicit) {
    const clientsRoot = resolveInside(activeRoot, '.memory', 'clients')
    let candidates = []
    try {
      candidates = fs.readdirSync(clientsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && VALID_AGENTS.has(entry.name.toLowerCase()))
        .map(entry => entry.name.toLowerCase())
        .sort()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) {
      // Prefer runtime-detected host when multi-client dirs exist (common in monorepos).
      // Only fail closed when inference is unknown or not among candidates.
      const inferred = normalizeAgent(DEFAULT_AGENT) || detectRuntimeAgent()
      if (inferred && inferred !== 'unknown-agent' && candidates.includes(inferred)) {
        return inferred
      }
      throw memoryQueryError(
        `memory agent is ambiguous; available clients: ${candidates.join(', ')}.`,
        'Pass the current actual host in agent.',
        'MEMORY_SCOPE_AMBIGUOUS'
      )
    }
  }
  const candidate = explicit ? assertSingleSegment(agent, 'agent') : DEFAULT_AGENT
  const safeAgent = normalizeAgent(candidate)
  if (!safeAgent) throw memoryQueryError('invalid agent')
  return safeAgent
}

function resolveMemoryTarget(args) {
  try {
    const activeRoot = getActiveRoot(args)
    const agent = resolveMemoryAgent(args.agent, activeRoot)
    if (!LAYOUT.enabled) {
      return {
        activeRoot,
        project: path.basename(resolveProjectRoot(args.project)) || path.basename(INPUT_ROOT),
        agent,
        scope: 'project'
      }
    }
    const explicitScope = Object.prototype.hasOwnProperty.call(args, 'scope') && String(args.scope || '').trim()
    const projectName = resolveProjectName(args.project)
    const scope = explicitScope ? resolveScope(args.scope) : (projectName ? 'project' : DEFAULT_SCOPE)
    return {
      activeRoot,
      project: scope === 'workspace' ? WORKSPACE_CONTEXT_PROJECT : (projectName || CONTEXT_PROJECT || ''),
      agent,
      scope
    }
  } catch (error) {
    if (error.contextReadCode) throw error
    const code = /ambiguous|requires project|workspace root/i.test(error.message)
      ? 'MEMORY_SCOPE_AMBIGUOUS'
      : 'MEMORY_QUERY_INVALID'
    throw memoryQueryError(
      error.message,
      code === 'MEMORY_SCOPE_AMBIGUOUS'
        ? 'Pass one explicit project or scope:"workspace".'
        : 'Correct the active memory target and retry once.',
      code
    )
  }
}

function memoryClientPath(target, ...segments) {
  return resolveInside(target.activeRoot, '.memory', 'clients', target.agent, ...segments)
}

function memoryFileMetadata(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw memoryQueryError(`Memory source is not a file: ${filePath}`)
    return {
      path: filePath,
      exists: true,
      bytes: stat.size,
      chars: null,
      modifiedAt: stat.mtime.toISOString()
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { path: filePath, exists: false, bytes: 0, chars: 0, modifiedAt: null }
    }
    throw error
  }
}

function readMemoryDocument(filePath) {
  const document = readBoundedTextFileSync(filePath, {
    maxBytes: MEMORY_SOURCE_MAX_BYTES,
    allowMissing: true
  })
  if (!document.exists) {
    return {
      path: document.path,
      exists: false,
      bytes: 0,
      chars: 0,
      modifiedAt: null,
      sourceBytesRead: 0,
      maxSourceBytes: MEMORY_SOURCE_MAX_BYTES,
      content: ''
    }
  }
  return {
    path: document.path,
    exists: true,
    bytes: document.logicalBytes,
    chars: document.chars,
    modifiedAt: document.modifiedAt,
    sourceBytesRead: document.sourceBytesRead,
    maxSourceBytes: MEMORY_SOURCE_MAX_BYTES,
    content: document.content
  }
}

function memoryScanDocument(filePath, onLine) {
  let scannedChars = 0
  const scan = scanBoundedTextLinesSync(filePath, {
    maxBytes: MEMORY_SOURCE_MAX_BYTES,
    allowMissing: true,
    onLine(line) {
      if (line.text !== null) scannedChars += line.text.length + 1
      onLine(line)
    }
  })
  return {
    path: scan.path,
    exists: scan.exists,
    bytes: scan.logicalBytes,
    chars: scannedChars,
    modifiedAt: scan.modifiedAt || null,
    sourceBytesRead: scan.sourceBytesRead,
    maxSourceBytes: MEMORY_SOURCE_MAX_BYTES,
    sourceScanComplete: scan.scanComplete,
    sourceDigest: scan.sourceDigest,
    sourcePrefixDigest: scan.sourcePrefixDigest,
    continuation: scan.continuation
  }
}

function scanSummaryDocument(filePath) {
  const rows = []
  const warnings = []
  let headerFound = false
  let stopped = false
  let sawContent = false
  const document = memoryScanDocument(filePath, line => {
    if (stopped) return
    if (line.oversized) {
      warnings.push(`Skipped oversized SUMMARY line ${line.line}.`)
      return
    }
    const text = String(line.text || '')
    if (text.trim()) sawContent = true
    const cells = splitMarkdownRow(text)
    if (!headerFound) {
      if (cells.length >= 7 && cells[0] === '日期' && cells[1] === '会话' && cells[6] === '状态') {
        headerFound = true
      }
      return
    }
    if (!text.trim()) return
    if (!cells.length) {
      if (/^#/.test(text.trim())) stopped = true
      else warnings.push(`Skipped non-table SUMMARY line ${line.line}.`)
      return
    }
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) return
    if (cells.length < 7) {
      warnings.push(`Skipped malformed SUMMARY row ${line.line}.`)
      return
    }
    try {
      const normalizedCells = cells.length === 7
        ? cells
        : [...cells.slice(0, 3), cells.slice(3, -3).join('|'), ...cells.slice(-3)]
      if (cells.length > 7) warnings.push(`Normalized unescaped SUMMARY separator at row ${line.line}.`)
      const row = projectSummaryRow(normalizedCells, line.line)
      if (!row.day || !row.sessionId) {
        warnings.push(`Skipped SUMMARY row ${line.line} without a canonical date/session.`)
        return
      }
      if (row.truncated) warnings.push(`SUMMARY row ${line.line} was field-bounded.`)
      rows.push(row)
    } catch (error) {
      warnings.push(`Skipped SUMMARY row ${line.line}: ${error.message}`)
    }
  })
  if (!headerFound && sawContent && document.sourceScanComplete) {
    warnings.push('SUMMARY table header was not found.')
  }
  if (!document.sourceScanComplete) {
    warnings.push('SUMMARY source scan reached its byte budget; continue from source.continuation before claiming complete coverage.')
  }
  return { document, rows, warnings: warnings.slice(0, 20) }
}

function appendSessionLine(session, line, maxChars) {
  const separator = session.contentParts.length ? '\n' : ''
  const fragment = `${separator}${line}`
  const remaining = Math.max(0, maxChars - session.contentChars)
  if (remaining > 0) {
    const selected = fragment.slice(0, remaining)
    session.contentParts.push(selected)
    session.contentChars += selected.length
  }
  if (fragment.length > remaining) session.contentTruncated = true
}

function appendHandoffLine(session, line, maxChars) {
  const separator = session.handoffParts.length ? '\n' : ''
  const fragment = `${separator}${line}`
  const remaining = Math.max(0, maxChars - session.handoffChars)
  if (remaining > 0) {
    const selected = fragment.slice(0, remaining)
    session.handoffParts.push(selected)
    session.handoffChars += selected.length
  }
  if (fragment.length > remaining) session.handoffTruncated = true
}

function scanDailyQueryDocument(filePath, date, query) {
  const sessions = []
  const warnings = []
  let matchedCount = 0
  let current = null
  let headingCount = 0
  let sawContent = false
  const maxSessionChars = query.maxChars

  const finalize = () => {
    if (!current || !current.sessionId) return
    const status = current.statuses[current.statuses.length - 1] || ''
    const state = normalizedMemoryState(status)
    const content = current.contentParts.join('').trim()
    const handoff = current.handoffParts.join('').trim()
    if (query.normalizedSession && current.sessionId !== query.normalizedSession) return
    if (!memoryStateMatches(state, query.status)) return
    if (query.handoffOnly && !handoff) return
    matchedCount += 1
    sessions.push({
      date,
      sessionId: current.sessionId,
      title: current.title,
      status,
      state,
      content,
      handoff,
      contentTruncated: current.contentTruncated,
      handoffTruncated: current.handoffTruncated
    })
    while (sessions.length > query.limit) sessions.shift()
  }

  const document = memoryScanDocument(filePath, line => {
    if (line.oversized) {
      if (current) current.contentTruncated = true
      warnings.push(`Skipped oversized daily-memory line ${line.line}.`)
      return
    }
    const text = String(line.text || '')
    if (text.trim()) sawContent = true
    const sessionHeading = /^##\s+会话\s+([^\s—-]+)(?:\s*[-—]\s*(.*))?$/.exec(text.trim())
    if (sessionHeading) {
      finalize()
      headingCount += 1
      let sessionId = ''
      try { sessionId = normalizeSessionId(sessionHeading[1]) } catch {}
      current = {
        sessionId,
        title: clipText(sessionHeading[2] || '', 300).text,
        statuses: [],
        contentParts: [],
        contentChars: 0,
        contentTruncated: false,
        handoffParts: [],
        handoffChars: 0,
        handoffTruncated: false,
        handoffActive: false,
        handoffLevel: 0
      }
      appendSessionLine(current, text, maxSessionChars)
      return
    }
    if (!current) return
    appendSessionLine(current, text, maxSessionChars)
    const statusMatch = /^\s*(?:-\s*)?(?:\*\*)?状态(?:\*\*)?\s*[：:]\s*(.*)$/.exec(text)
    if (statusMatch && normalizedMemoryState(statusMatch[1]) !== 'unknown') {
      current.statuses.push(statusMatch[1].trim())
    }
    const heading = /^(#{1,6})\s+/.exec(text.trim())
    const handoffHeading = /^(#{2,6})\s+.*ContextHandoffCard\b/i.exec(text.trim())
    if (handoffHeading) {
      current.handoffParts = []
      current.handoffChars = 0
      current.handoffTruncated = false
      current.handoffActive = true
      current.handoffLevel = handoffHeading[1].length
      appendHandoffLine(current, text, maxSessionChars)
    } else if (current.handoffActive) {
      if (heading && heading[1].length <= current.handoffLevel) {
        current.handoffActive = false
      } else {
        appendHandoffLine(current, text, maxSessionChars)
      }
    }
  })
  if (document.sourceScanComplete) finalize()
  else if (current) warnings.push('The final daily-memory session was deferred because the source scan ended mid-session.')
  if (!headingCount && sawContent && document.sourceScanComplete) {
    warnings.push('No canonical session headings were found.')
  }
  if (!document.sourceScanComplete) {
    warnings.push('Daily-memory source scan reached its byte budget; continue from source.continuation before claiming complete coverage.')
  }
  return { document, sessions, matchedCount, warnings: warnings.slice(0, 20) }
}

function publicSourceMetadata(document) {
  const { content, ...metadata } = document
  return metadata
}

function splitMarkdownRow(line) {
  const value = String(line || '').trim()
  if (!value.startsWith('|') || !value.endsWith('|')) return []
  const cells = []
  let current = ''
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index]
    if (char === '|' && value[index - 1] !== '\\') {
      cells.push(current.trim().replace(/\\\|/g, '|'))
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim().replace(/\\\|/g, '|'))
  return cells
}

function normalizedMemoryState(value) {
  const status = String(value || '').trim().toLowerCase()
  if (/✅|completed?|complete|closed|done|完成|已关闭/.test(status)) return 'completed'
  if (/⛔|blocked|paused|阻塞|暂停/.test(status)) return 'blocked'
  if (/🔄|⏳|active|in[- ]?progress|pending|进行中|处理中|等待/.test(status)) return 'active'
  return 'unknown'
}

function memoryStateMatches(actual, expected) {
  if (expected === 'all') return true
  if (expected === 'unresolved') return actual === 'active' || actual === 'blocked'
  return actual === expected
}

function clipText(value, maxChars) {
  const text = String(value || '')
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false }
}

function projectSummaryRow(cells, rowNumber) {
  const date = clipText(cells[0], 40)
  const session = clipText(cells[1], 64)
  const type = clipText(cells[2], 160)
  const summary = clipText(cells[3], 2000)
  const report = clipText(cells[4], 500)
  const memory = clipText(cells[5], 500)
  const status = clipText(cells[6], 100)
  const day = /^\d{4}-\d{2}-\d{2}/.test(date.text) ? date.text.slice(0, 10) : ''
  return {
    date: date.text,
    day,
    sessionId: normalizeSummarySessionId(session.text),
    sessionIdCanonical: /^[A-Za-z0-9._-]{1,64}$/.test(normalizeSummarySessionId(session.text)),
    type: type.text,
    summary: summary.text,
    report: report.text,
    memory: memory.text,
    status: status.text,
    state: normalizedMemoryState(status.text),
    rowNumber,
    truncated: [date, session, type, summary, report, memory, status].some(item => item.truncated)
  }
}

function parseSummaryRows(content) {
  const lines = String(content || '').split(/\r?\n/)
  const warnings = []
  let headerIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitMarkdownRow(lines[index])
    if (cells.length >= 7 && cells[0] === '日期' && cells[1] === '会话' && cells[6] === '状态') {
      headerIndex = index
      break
    }
  }
  if (headerIndex < 0) {
    if (String(content || '').trim()) warnings.push('SUMMARY table header was not found.')
    return { rows: [], warnings }
  }
  const rows = []
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue
    const cells = splitMarkdownRow(line)
    if (!cells.length) {
      if (/^#/.test(line.trim())) break
      warnings.push(`Skipped non-table SUMMARY line ${index + 1}.`)
      continue
    }
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue
    if (cells.length < 7) {
      warnings.push(`Skipped malformed SUMMARY row ${index + 1}.`)
      continue
    }
    try {
      const normalizedCells = cells.length === 7
        ? cells
        : [...cells.slice(0, 3), cells.slice(3, -3).join('|'), ...cells.slice(-3)]
      if (cells.length > 7) warnings.push(`Normalized unescaped SUMMARY separator at row ${index + 1}.`)
      const row = projectSummaryRow(normalizedCells, index + 1)
      if (!row.day || !row.sessionId) {
        warnings.push(`Skipped SUMMARY row ${index + 1} without a canonical date/session.`)
        continue
      }
      if (row.truncated) warnings.push(`SUMMARY row ${index + 1} was field-bounded.`)
      rows.push(row)
    } catch (error) {
      warnings.push(`Skipped SUMMARY row ${index + 1}: ${error.message}`)
    }
  }
  return { rows, warnings: warnings.slice(0, 20) }
}

function findSummaryConflicts(rows) {
  return summaryStateConflicts(rows)
}

function extractHandoffCard(content) {
  const lines = String(content || '').split(/\r?\n/)
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{2,6})\s+.*ContextHandoffCard\b/i.exec(lines[index].trim())
    if (match) {
      start = index
      level = match[1].length
    }
  }
  if (start < 0) return ''
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+/.exec(lines[index].trim())
    if (heading && heading[1].length <= level) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n').trim()
}

function parseDailySessions(content, date) {
  const lines = String(content || '').split(/\r?\n/)
  const headings = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^##\s+会话\s+([^\s—-]+)(?:\s*[-—]\s*(.*))?$/.exec(lines[index].trim())
    if (match) headings.push({ index, id: match[1], title: match[2] || '' })
  }
  if (!headings.length) {
    return {
      sessions: [],
      warnings: String(content || '').trim() ? ['No canonical session headings were found.'] : []
    }
  }
  const sessions = []
  for (let cursor = 0; cursor < headings.length; cursor += 1) {
    const heading = headings[cursor]
    const end = headings[cursor + 1]?.index ?? lines.length
    const raw = lines.slice(heading.index, end).join('\n').trim()
    const statuses = raw.split(/\r?\n/)
      .map(line => /^\s*(?:-\s*)?(?:\*\*)?状态(?:\*\*)?\s*[：:]\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map(match => match[1].trim())
      .filter(value => normalizedMemoryState(value) !== 'unknown')
    const status = statuses[statuses.length - 1] || ''
    try {
      sessions.push({
        date,
        sessionId: normalizeSessionId(heading.id),
        title: clipText(heading.title, 300).text,
        status,
        state: normalizedMemoryState(status),
        content: raw,
        handoff: extractHandoffCard(raw),
        ordinal: cursor + 1
      })
    } catch (error) {
      // A malformed heading is ignored without fabricating a session identity.
    }
  }
  return { sessions, warnings: [] }
}

function indexedSourceMetadata(source) {
  if (!source) return null
  const { mtimeMs, ...metadata } = source
  return metadata
}

function memoryIndexFallbackReceipt(kind, result) {
  return {
    schemaVersion: 'MemoryIndexReceiptV1',
    status: 'fallback',
    kind,
    reason: result?.reason || 'index-unavailable',
    receipt: result?.envelope?.receipt || null
  }
}

function memoryIndexProjectionState(kind, result, canonicalDocument = null) {
  const fresh = result?.status === 'fresh'
  const reason = fresh ? null : (result?.reason || 'index-unavailable')
  const freshnessTier = fresh
    ? (result?.envelope?.freshnessTier || 'content-verified')
    : (result?.envelope?.freshnessTier || (reason === 'index-module-unavailable' ? 'invalid' : 'stale'))
  const canonicalMetadata = canonicalDocument
    ? publicSourceMetadata(canonicalDocument)
    : indexedSourceMetadata(result?.source)
  const missingIndexAndSource = reason === 'index-missing' && canonicalDocument?.exists === false
  const runtimeUnavailable = reason === 'index-module-unavailable'
  const repairNeeded = !fresh && !missingIndexAndSource && !runtimeUnavailable
  const canonicalComplete = !canonicalDocument || canonicalDocument.exists === false ||
    canonicalDocument.sourceScanComplete !== false
  const repairFingerprint = repairNeeded
    ? fileDigest(JSON.stringify({
        schemaVersion: 'MemoryIndexRepairDiagnosticV1',
        kind,
        reason,
        canonicalSource: canonicalMetadata,
        canonicalContentDigest: canonicalDocument
          ? (canonicalDocument.sourceDigest || canonicalDocument.sourcePrefixDigest ||
              (canonicalDocument.content !== undefined ? fileDigest(canonicalDocument.content) : null))
          : null,
        observedIndexSource: result?.envelope?.receipt?.observedSource || null
      }))
    : null

  return {
    derivedIndexFreshness: {
      status: fresh
        ? 'fresh'
        : (runtimeUnavailable ? 'unavailable' : (freshnessTier === 'invalid' ? 'invalid' : 'stale')),
      freshnessTier,
      reason
    },
    canonicalSourceTrust: {
      status: canonicalComplete ? 'trusted' : 'partial',
      authority: 'canonical-markdown',
      basis: canonicalDocument
        ? (canonicalDocument.exists
            ? (canonicalComplete ? 'bounded-source-scan-complete' : 'bounded-source-scan-partial')
            : 'source-absence-observed')
        : 'writer-attested-metadata-reconciled',
      source: canonicalMetadata
    },
    fallbackCoverage: {
      status: fresh ? 'not-used' : (canonicalComplete ? 'complete' : 'partial'),
      source: fresh ? null : 'canonical-markdown',
      reason,
      continuation: canonicalComplete ? null : canonicalDocument?.continuation || null
    },
    repairState: {
      status: runtimeUnavailable
        ? 'blocked'
        : (repairNeeded ? 'repair-needed' : 'not-needed'),
      owner: runtimeUnavailable ? 'runtime-package' : 'memory-mcp-writer',
      mode: repairNeeded ? 'next-specialized-write' : null,
      diagnosticFingerprint: repairFingerprint,
      dedupeKey: repairFingerprint ? `memory-index-repair:${repairFingerprint}` : null
    }
  }
}

function queryStatusIndex(target, sourcePath, limit) {
  if (!MEMORY_INDEX_CONTRACT) return { status: 'fallback', reason: 'index-module-unavailable' }
  return MEMORY_INDEX_CONTRACT.queryStatusIndex({ target, sourcePath, limit })
}

function querySummaryIndex(target, sourcePath, status, limit, since, offset = 0) {
  if (!MEMORY_INDEX_CONTRACT) return { status: 'fallback', reason: 'index-module-unavailable' }
  return MEMORY_INDEX_CONTRACT.querySummaryIndex({ target, sourcePath, status, limit, since, offset })
}

function queryDailyIndex(target, sourcePath, input) {
  if (!MEMORY_INDEX_CONTRACT) return { status: 'fallback', reason: 'index-module-unavailable' }
  return MEMORY_INDEX_CONTRACT.queryDailyIndex({
    target,
    sourcePath,
    date: input.date,
    sessionId: input.sessionId,
    status: input.status,
    limit: input.limit,
    handoffOnly: input.handoffOnly,
    maxChars: input.maxChars,
    offset: input.offset,
    extractHandoffCard
  })
}

function refreshSummaryMemoryIndex(target, filePath) {
  if (!MEMORY_INDEX_CONTRACT) {
    return {
      schemaVersion: 'MemoryIndexReceiptV1',
      status: 'bypassed',
      kind: 'summary',
      reason: 'index-module-unavailable'
    }
  }
  try {
    const document = readMemoryDocument(filePath)
    return MEMORY_INDEX_CONTRACT.refreshSummaryIndex({
      target,
      document,
      parsed: parseSummaryRows(document.content),
      freshnessTier: 'writer-attested'
    })
  } catch (error) {
    return {
      schemaVersion: 'MemoryIndexReceiptV1',
      status: 'error',
      kind: 'summary',
      errorCode: 'MEMORY_INDEX_REFRESH_FAILED',
      message: error.message
    }
  }
}

function refreshDailyMemoryIndex(target, filePath, date) {
  if (!MEMORY_INDEX_CONTRACT) {
    return {
      schemaVersion: 'MemoryIndexReceiptV1',
      status: 'bypassed',
      kind: 'daily',
      date,
      reason: 'index-module-unavailable'
    }
  }
  try {
    const document = readMemoryDocument(filePath)
    return MEMORY_INDEX_CONTRACT.refreshDailyIndex({
      target,
      date,
      document,
      parsed: parseDailySessions(document.content, date),
      freshnessTier: 'writer-attested'
    })
  } catch (error) {
    return {
      schemaVersion: 'MemoryIndexReceiptV1',
      status: 'error',
      kind: 'daily',
      date,
      errorCode: 'MEMORY_INDEX_REFRESH_FAILED',
      message: error.message
    }
  }
}

function projectionTelemetry(value, sourceDocuments, startedAt) {
  const serialized = JSON.stringify(value)
  const sourceBytesRead = sourceDocuments.reduce(
    (sum, item) => sum + Number(item.sourceBytesRead ?? item.bytes ?? 0),
    0
  )
  return {
    bytes: Buffer.byteLength(serialized, 'utf8'),
    chars: serialized.length,
    sourceBytes: sourceBytesRead,
    sourceBytesRead,
    sourceChars: sourceDocuments.reduce((sum, item) => sum + Number(item.chars || 0), 0),
    filesRead: sourceDocuments.filter(item =>
      item.exists && (item.content !== undefined || Number(item.sourceBytesRead || 0) > 0)
    ).length,
    latencyMs: elapsedMs(startedAt),
    tokens: null
  }
}

function withProjectionIdentity(projection, toolName, target, sourceDocuments, startedAt, telemetryOverride = null) {
  const contentIdentity = buildJsonContentIdentity({
    sourceKey: `memory://${target.project}/${toolName}#delivered`,
    value: projection,
    contractVersion: projection.schemaVersion
  }).identity
  const identified = { ...projection, contentIdentity }
  const telemetry = projectionTelemetry(identified, sourceDocuments, startedAt)
  let contextObservation
  try {
    contextObservation = recordMcpContextSourceObservations({
      activeRoot: target.activeRoot,
      project: target.project,
      workspaceNamespace: LAYOUT.enabled,
      contextBinding: projection.contextBinding,
      hostSessionId: String(process.env.DEVCODEX_HOST_SESSION_ID || ''),
      sourceResults: [{
        sourceId: `memory:${toolName}`,
        sourceLayer: 'memory-query',
        outcome: 'observed-success',
        successful: true,
        observable: true,
        transportSuccess: true,
        sourceRefsMatch: true,
        schemaMatch: true,
        targetMatch: true,
        contentIdentity,
        bodyObserved: true,
        bytes: contentIdentity.bytes,
        chars: contentIdentity.bytes,
        hostDeliveredBytes: telemetry.bytes
      }]
    })
  } catch (error) {
    contextObservation = {
      status: 'degraded',
      errorCode: error.code || 'CONTEXT_SOURCE_OBSERVATION_FAILED',
      message: error.message
    }
  }
  return {
    ...identified,
    contextObservation: {
      schemaVersion: 'ContextSourceObservationWriteReceiptV1',
      status: contextObservation?.status || 'degraded',
      errorCode: contextObservation?.errorCode || null,
      ledgerStatus: contextObservation?.ledgerStatus || null,
      lifecycleStatus: contextObservation?.lifecycleStatus || null,
      receiptStatus: contextObservation?.receiptStatus || null,
      satisfiedSourceIds: (contextObservation?.satisfiedSourceIds || []).slice(0, 20),
      missingSourceIds: (contextObservation?.missingSourceIds || []).slice(0, 20)
    },
    telemetry: telemetryOverride
      ? {
          ...telemetry,
          sourceBytes: telemetryOverride.sourceBytes,
          sourceBytesRead: telemetryOverride.sourceBytesRead ?? telemetryOverride.sourceBytes,
          filesRead: telemetryOverride.filesRead,
          tokens: telemetryOverride.tokens ?? null,
          indexLatencyMs: telemetryOverride.latencyMs ?? null,
          ...(Number.isFinite(telemetryOverride.indexBytesRead)
            ? { indexBytesRead: telemetryOverride.indexBytesRead }
            : {})
        }
      : telemetry
  }
}

function memoryProjectionResult(value) {
  const isError = value?.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {})
  }
}

function runMemoryProjection(args, allowedFields, handler) {
  try {
    validateProjectionArgs(args, allowedFields)
    return memoryProjectionResult(handler(args))
  } catch (error) {
    const errorCode = error.contextReadCode || (/ambiguous|requires project|workspace root/i.test(error.message)
      ? 'MEMORY_SCOPE_AMBIGUOUS'
      : 'MEMORY_QUERY_INVALID')
    return memoryProjectionResult(buildContextReadError(
      errorCode,
      error.message,
      error.nextStep || 'Correct the bounded memory query and retry once.'
    ))
  }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

function handleMemoryStatus(args) {
  return runMemoryProjection(args, MEMORY_STATUS_FIELDS, input => {
    const startedAt = process.hrtime.bigint()
    const target = resolveMemoryTarget(input)
    const contextBinding = resolveContextReadBinding(
      input.contextBinding,
      target,
      'memory:memory_status'
    )
    const limit = normalizeBoundedInteger(input.limit, 5, 20, 'limit')
    const todayDate = today()
    const yesterdayDate = yesterday()
    const todayMetadata = memoryFileMetadata(memoryClientPath(target, 'tasks', `${todayDate}.md`))
    const yesterdayMetadata = memoryFileMetadata(memoryClientPath(target, 'tasks', `${yesterdayDate}.md`))
    const summaryPath = memoryClientPath(target, 'SUMMARY.md')
    const indexed = queryStatusIndex(target, summaryPath, limit)
    if (indexed.status === 'fresh') {
      const activeSessionIds = indexed.activeSessionIds.slice(0, MAX_SUMMARY_ROWS_FOR_STATUS)
      const conflicts = indexed.conflicts.slice(0, MAX_SUMMARY_ROWS_FOR_STATUS)
      const boundWarnings = []
      if (indexed.activeSessionIds.length > activeSessionIds.length) {
        boundWarnings.push(`activeSessionIds was bounded to ${MAX_SUMMARY_ROWS_FOR_STATUS}.`)
      }
      if (indexed.conflicts.length > conflicts.length) {
        boundWarnings.push(`conflicts was bounded to ${MAX_SUMMARY_ROWS_FOR_STATUS}.`)
      }
      if (indexed.nonCanonicalActiveCount) {
        boundWarnings.push(`${indexed.nonCanonicalActiveCount} active SUMMARY row(s) use non-canonical session labels; inspect latestRows.`)
      }
      const projection = {
        schemaVersion: 'MemoryStatusV1',
        activeRoot: target.activeRoot,
        project: target.project,
        agent: target.agent,
        today: { date: todayDate, ...todayMetadata },
        yesterday: { date: yesterdayDate, ...yesterdayMetadata },
        summary: indexedSourceMetadata(indexed.source),
        latestRows: indexed.latestRows,
        activeSessionIds,
        conflicts,
        warnings: [...boundWarnings, ...indexed.warnings].slice(0, 20),
        indexReceipt: indexed.envelope.receipt,
        coverage: indexed.envelope.coverage,
        ...memoryIndexProjectionState('summary', indexed),
        contextBinding
      }
      return withProjectionIdentity(
        projection,
        'memory_status',
        target,
        [],
        startedAt,
        indexed.envelope.telemetry
      )
    }
    const scannedSummary = scanSummaryDocument(summaryPath)
    const summaryDocument = scannedSummary.document
    const parsed = { rows: scannedSummary.rows, warnings: scannedSummary.warnings }
    const latestRows = parsed.rows.slice().reverse().slice(0, limit)
    const currentRows = rowsByCurrentState(parsed.rows, 'unresolved')
    const nonCanonicalActiveRows = currentRows.filter(row => row.state === 'active' && !row.sessionIdCanonical)
    const allActiveSessionIds = currentActiveSessionIds(parsed.rows)
    const allConflicts = findSummaryConflicts(parsed.rows)
    const activeSessionIds = allActiveSessionIds.slice(0, MAX_SUMMARY_ROWS_FOR_STATUS)
    const conflicts = allConflicts.slice(0, MAX_SUMMARY_ROWS_FOR_STATUS)
    const boundWarnings = []
    if (allActiveSessionIds.length > activeSessionIds.length) {
      boundWarnings.push(`activeSessionIds was bounded to ${MAX_SUMMARY_ROWS_FOR_STATUS}.`)
    }
    if (allConflicts.length > conflicts.length) {
      boundWarnings.push(`conflicts was bounded to ${MAX_SUMMARY_ROWS_FOR_STATUS}.`)
    }
    if (nonCanonicalActiveRows.length) {
      boundWarnings.push(`${nonCanonicalActiveRows.length} active SUMMARY row(s) use non-canonical session labels; inspect latestRows.`)
    }
    const summary = publicSourceMetadata(summaryDocument)
    const projection = {
      schemaVersion: 'MemoryStatusV1',
      activeRoot: target.activeRoot,
      project: target.project,
      agent: target.agent,
      today: { date: todayDate, ...todayMetadata },
      yesterday: { date: yesterdayDate, ...yesterdayMetadata },
      summary,
      latestRows,
      activeSessionIds,
      conflicts,
      warnings: [...boundWarnings, ...parsed.warnings].slice(0, 20),
      indexReceipt: memoryIndexFallbackReceipt('summary', indexed),
      coverage: {
        status: summaryDocument.sourceScanComplete ? 'legacy-complete' : 'partial',
        reason: indexed.reason || 'index-fallback',
        continuation: summaryDocument.continuation
      },
      ...memoryIndexProjectionState('summary', indexed, summaryDocument),
      contextBinding
    }
    return withProjectionIdentity(projection, 'memory_status', target, [summaryDocument], startedAt)
  })
}

function handleMemorySessionQuery(args) {
  return runMemoryProjection(args, MEMORY_SESSION_QUERY_FIELDS, input => {
    const startedAt = process.hrtime.bigint()
    const target = resolveMemoryTarget(input)
    const contextBinding = resolveContextReadBinding(
      input.contextBinding,
      target,
      'memory:memory_session_query'
    )
    if (input.date !== undefined && (typeof input.date !== 'string' || !input.date)) {
      throw memoryQueryError('date must be a non-empty YYYYMMDD string when supplied.')
    }
    const date = input.date === undefined ? today() : input.date
    validateQueryDate(date)
    if (input.sessionId !== undefined && (
      typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId !== input.sessionId.trim()
    )) {
      throw memoryQueryError('sessionId must be a non-empty exact identifier when supplied.')
    }
    const requestedSessionId = input.sessionId === undefined ? '' : input.sessionId
    const normalizedSession = requestedSessionId ? normalizeSessionId(requestedSessionId) : ''
    const status = normalizeQueryStatus(input.status, 'all')
    const limit = normalizeBoundedInteger(input.limit, 1, 20, 'limit')
    const maxChars = normalizeBoundedInteger(input.maxChars, 12000, 50000, 'maxChars')
    if (input.handoffOnly !== undefined && typeof input.handoffOnly !== 'boolean') {
      throw memoryQueryError('handoffOnly must be boolean.')
    }
    const handoffOnly = input.handoffOnly === true
    const query = {
      date,
      sessionId: requestedSessionId || null,
      status,
      limit,
      handoffOnly,
      maxChars
    }
    const cursorBinding = memoryCursorBinding('memory_session_query', target, contextBinding, query)
    const cursorState = resolveMemoryCursor(input.cursor, cursorBinding)
    const dailyPath = memoryClientPath(target, 'tasks', `${date}.md`)
    const indexed = queryDailyIndex(target, dailyPath, {
      date,
      sessionId: normalizedSession,
      status,
      limit,
      handoffOnly,
      maxChars,
      offset: cursorState.offset
    })
    if (indexed.status === 'fresh') {
      const source = {
        activeRoot: target.activeRoot,
        project: target.project,
        agent: target.agent,
        date,
        ...indexedSourceMetadata(indexed.source)
      }
      const projection = {
        schemaVersion: 'MemorySessionQueryV1',
        query,
        matches: indexed.matches,
        totalMatched: indexed.totalMatched,
        truncated: indexed.envelope.truncated,
        source,
        warnings: indexed.warnings,
        indexReceipt: indexed.envelope.receipt,
        coverage: indexed.envelope.coverage,
        ...memoryIndexProjectionState('daily', indexed),
        contextBinding
      }
      applyMemoryCursor(projection, {
        binding: cursorBinding,
        cursorState,
        returned: indexed.matches.length,
        hasMore: Boolean(indexed.envelope.nextPointer)
      })
      return withProjectionIdentity(
        projection,
        'memory_session_query',
        target,
        [],
        startedAt,
        indexed.envelope.telemetry
      )
    }
    const scannedDaily = scanDailyQueryDocument(dailyPath, date, {
      normalizedSession,
      status,
      limit: Math.min(MEMORY_CURSOR_MAX_OFFSET, cursorState.offset + limit),
      handoffOnly,
      maxChars
    })
    const document = scannedDaily.document
    const candidates = scannedDaily.sessions.slice().reverse().slice(cursorState.offset, cursorState.offset + limit)
    const matches = []
    let remainingChars = maxChars
    let contentTruncated = false
    for (const session of candidates) {
      if (remainingChars <= 0) {
        contentTruncated = true
        break
      }
      const sourceContent = handoffOnly ? session.handoff : session.content
      const boundedContent = sourceContent.slice(0, remainingChars)
      const truncated = boundedContent.length < sourceContent.length ||
        (handoffOnly ? session.handoffTruncated : session.contentTruncated)
      matches.push({
        date: session.date,
        sessionId: session.sessionId,
        title: session.title,
        status: session.status,
        state: session.state,
        content: boundedContent,
        chars: boundedContent.length,
        truncated
      })
      remainingChars -= boundedContent.length
      if (truncated) {
        contentTruncated = true
        break
      }
    }
    const source = {
      activeRoot: target.activeRoot,
      project: target.project,
      agent: target.agent,
      date,
      ...publicSourceMetadata(document)
    }
    const projection = {
      schemaVersion: 'MemorySessionQueryV1',
      query,
      matches,
      totalMatched: scannedDaily.matchedCount,
      truncated: !document.sourceScanComplete || scannedDaily.matchedCount > cursorState.offset + matches.length || contentTruncated,
      source,
      warnings: scannedDaily.warnings,
      indexReceipt: memoryIndexFallbackReceipt('daily', indexed),
      coverage: {
        status: document.sourceScanComplete ? 'legacy-complete' : 'partial',
        reason: indexed.reason || 'index-fallback',
        continuation: document.continuation
      },
      ...memoryIndexProjectionState('daily', indexed, document),
      contextBinding
    }
    applyMemoryCursor(projection, {
      binding: cursorBinding,
      cursorState,
      returned: matches.length,
      hasMore: scannedDaily.matchedCount > cursorState.offset + matches.length
    })
    return withProjectionIdentity(projection, 'memory_session_query', target, [document], startedAt)
  })
}

function handleMemorySummaryQuery(args) {
  return runMemoryProjection(args, MEMORY_SUMMARY_QUERY_FIELDS, input => {
    const startedAt = process.hrtime.bigint()
    const target = resolveMemoryTarget(input)
    const contextBinding = resolveContextReadBinding(
      input.contextBinding,
      target,
      'memory:memory_summary_query'
    )
    const status = normalizeQueryStatus(input.status, 'active')
    const limit = normalizeBoundedInteger(input.limit, 5, 50, 'limit')
    if (input.since !== undefined && (
      typeof input.since !== 'string' || !input.since || input.since !== input.since.trim()
    )) {
      throw memoryQueryError('since must be a non-empty exact YYYY-MM-DD string when supplied.')
    }
    const since = input.since === undefined ? null : input.since
    if (since !== null) validateSince(since)
    const query = { status, limit, since }
    const cursorBinding = memoryCursorBinding('memory_summary_query', target, contextBinding, query)
    const cursorState = resolveMemoryCursor(input.cursor, cursorBinding)
    const summaryPath = memoryClientPath(target, 'SUMMARY.md')
    const indexed = querySummaryIndex(target, summaryPath, status, limit, since, cursorState.offset)
    if (indexed.status === 'fresh') {
      const source = {
        activeRoot: target.activeRoot,
        project: target.project,
        agent: target.agent,
        ...indexedSourceMetadata(indexed.source)
      }
      const projection = {
        schemaVersion: 'MemorySummaryQueryV1',
        query,
        rows: indexed.rows,
        totalMatched: indexed.totalMatched,
        truncated: indexed.envelope.truncated,
        source,
        warnings: indexed.warnings,
        indexReceipt: indexed.envelope.receipt,
        coverage: indexed.envelope.coverage,
        ...memoryIndexProjectionState('summary', indexed),
        contextBinding
      }
      applyMemoryCursor(projection, {
        binding: cursorBinding,
        cursorState,
        returned: indexed.rows.length,
        hasMore: Boolean(indexed.envelope.nextPointer)
      })
      return withProjectionIdentity(
        projection,
        'memory_summary_query',
        target,
        [],
        startedAt,
        indexed.envelope.telemetry
      )
    }
    const scannedSummary = scanSummaryDocument(summaryPath)
    const document = scannedSummary.document
    const filtered = rowsByCurrentState(scannedSummary.rows, status).filter(row => !since || row.day >= since)
    const rows = filtered.slice().reverse().slice(cursorState.offset, cursorState.offset + limit)
    const source = {
      activeRoot: target.activeRoot,
      project: target.project,
      agent: target.agent,
      ...publicSourceMetadata(document)
    }
    const projection = {
      schemaVersion: 'MemorySummaryQueryV1',
      query,
      rows,
      totalMatched: filtered.length,
      truncated: !document.sourceScanComplete || filtered.length > cursorState.offset + rows.length,
      source,
      warnings: scannedSummary.warnings,
      indexReceipt: memoryIndexFallbackReceipt('summary', indexed),
      coverage: {
        status: document.sourceScanComplete ? 'legacy-complete' : 'partial',
        reason: indexed.reason || 'index-fallback',
        continuation: document.continuation
      },
      ...memoryIndexProjectionState('summary', indexed, document),
      contextBinding
    }
    applyMemoryCursor(projection, {
      binding: cursorBinding,
      cursorState,
      returned: rows.length,
      hasMore: filtered.length > cursorState.offset + rows.length
    })
    return withProjectionIdentity(projection, 'memory_summary_query', target, [document], startedAt)
  })
}

function handleMemorySessionRead(args) {
  validateDate(args.date)
  const target = resolveMemoryTarget(args)
  resolveContextReadBinding(
    args.contextBinding,
    target,
    'memory:memory_session_query'
  )
  const p = memoryClientPath(target, 'tasks', `${args.date || today()}.md`)
  const document = readMemoryDocument(p)
  return { content: [{ type: 'text', text: document.content || '（文件不存在或为空）' }] }
}

function handleMemorySessionWrite(args) {
  validateMemoryWriterArgs(
    args,
    MEMORY_SESSION_WRITE_FIELDS,
    'memory_session_write',
    MEMORY_SESSION_WRITE_REQUIRED_FIELDS
  )
  if (typeof args.content !== 'string' || !args.content.length) {
    throw memoryQueryError(
      'content must be a non-empty string.',
      'Pass bounded Markdown content from the current task.',
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  if (args.content.length > MAX_MEMORY_SESSION_WRITE_CHARS) {
    throw memoryQueryError(
      `content exceeds the ${MAX_MEMORY_SESSION_WRITE_CHARS}-character limit.`,
      'Split the memory update into bounded writes using the same allocation binding.',
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  validateDate(args.date)
  const binding = normalizeMemorySessionWriteBinding(args)
  const target = resolveMemoryTarget(args)
  const p = memoryClientPath(target, 'tasks', `${args.date || today()}.md`)
  let sessionWriteReceipt = null
  const receipt = withMemoryTransaction(target, p, existing => {
    const rendered = insertMemorySessionContent(existing, args.content, binding)
    sessionWriteReceipt = rendered.receipt
    return {
      content: rendered.content,
      appendText: rendered.content.startsWith(existing)
        ? rendered.content.slice(existing.length)
        : null
    }
  })
  receipt.sessionWrite = sessionWriteReceipt
  receipt.indexReceipt = refreshDailyMemoryIndex(target, p, args.date || today())
  return {
    content: [{
      type: 'text',
      text: `已追加到 ${relativeToActiveRoot(target, p)}\n${JSON.stringify(receipt)}`
    }],
    structuredContent: receipt
  }
}

function handleMemorySessionAllocate(args) {
  validateMemoryWriterArgs(args, MEMORY_SESSION_ALLOCATE_FIELDS, 'memory_session_allocate')
  validateDate(args.date)
  const input = { ...args, date: args.date || today() }
  const target = resolveMemoryTarget(input)
  const p = memoryClientPath(target, 'tasks', `${input.date}.md`)
  let allocatedId = null
  const sessionBinding = crypto.randomBytes(32).toString('hex')
  const receipt = withMemoryTransaction(target, p, existing => {
    const maxId = Math.max(0, ...parseExistingSessionNumbers(existing))
    allocatedId = formatSessionId(maxId + 1)
    const title = normalizeMemoryAllocationLine(input.title, '未命名任务', 'title', 160)
    let intent = normalizeMemoryAllocationLine(input.intent, 'unspecified', 'intent', 120)
    if (SUMMARY_TYPE_CANON) {
      const intentCheck = SUMMARY_TYPE_CANON.validateAllocateIntent(intent)
      if (!intentCheck.ok) {
        throw memoryQueryError(
          `Invalid allocate intent: ${intentCheck.message}`,
          'Use canonical workflow intents (dev|fix|analyze|audit|self-fix|chat|resume|other) joined by +, or unspecified.',
          intentCheck.errorCode || 'SUMMARY_TYPE_NON_CANONICAL'
        )
      }
      intent = intentCheck.normalized
    }
    const sourceMessage = normalizeMemoryAllocationLine(input.sourceMessage, '—', 'sourceMessage', 300)
    const block = [
      `## 会话 ${allocatedId} — ${title}`,
      '',
      `- **时间**：${formatLocalDateTime()}`,
      `- **意图**：${intent}`,
      '- **状态**：🔄 reserved / awaiting content',
      `- **sourceMessage**：${sourceMessage}`,
      memorySessionBindingMarker(allocatedId, sessionBinding),
      '',
      '### 📨 对话记录',
      '',
      '| 轮次 | 👤 用户消息 | 🤖 AI执行 | 状态 |',
      '|:----:|-----------|----------|:----:|',
      ''
    ].join('\n')
    const separator = existing ? '\n\n' : ''
    const appendText = separator + block
    return { content: existing + appendText, appendText }
  })
  receipt.indexReceipt = refreshDailyMemoryIndex(target, p, input.date)
  const allocation = {
    schemaVersion: 'MemorySessionAllocationReceiptV1',
    sessionId: allocatedId,
    sessionBinding,
    sessionBindingSchemaVersion: 'MemorySessionBindingV1',
    transaction: receipt
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(allocation) }],
    structuredContent: allocation
  }
}

function handleMemoryCpConfirm(args) {
  if (!args.requirement) throw new Error('requirement is required')
  if (!args.phase) throw new Error('phase is required')
  const kind = args.kind || 'requirements'
  if (!TASK_KINDS.has(kind)) throw new Error(`kind must be one of: ${[...TASK_KINDS].join(', ')}`)

  const p = taskSessionsPath(kind, args.requirement, args)
  const time = args.time || currentTime()
  const hasDigest = Boolean(args.artifactPath || args.artifactSha256 || args.artifactVersion)
  if (hasDigest && (!args.artifactPath || !args.artifactSha256)) {
    throw new Error('ConfirmBindingGate: artifactPath and artifactSha256 are required together')
  }
  const sha = args.artifactSha256 ? String(args.artifactSha256).replace(/`/g, '').toUpperCase() : null
  let artifactPath = args.artifactPath ? String(args.artifactPath).replace(/\\/g, '/') : null
  const artifactVersion = args.artifactVersion || '—'
  const sourceMessage = args.sourceMessage || '—'
  let artifactAuthority = null

  if (hasDigest && artifactPath) {
    const taskDir = path.dirname(path.dirname(p)) // .../<task>/.memory/sessions.md
    let candidate
    try {
      candidate = resolveExistingRegularFileInside(taskDir, artifactPath, { label: 'artifactPath' })
    } catch (error) {
      throw new Error(`ConfirmBindingGate: invalid artifactPath ${artifactPath}: ${error.message}`)
    }
    const descriptor = fs.openSync(candidate, 'r')
    let actual
    try {
      const descriptorStat = fs.fstatSync(descriptor)
      if (!descriptorStat.isFile()) {
        throw new Error(`ConfirmBindingGate: artifactPath is not a regular file: ${artifactPath}`)
      }
      const canonicalRoot = fs.realpathSync.native
        ? fs.realpathSync.native(taskDir)
        : fs.realpathSync(taskDir)
      const verifyCurrentPathIdentity = () => {
        const currentPath = fs.realpathSync.native
          ? fs.realpathSync.native(candidate)
          : fs.realpathSync(candidate)
        const relative = path.relative(canonicalRoot, currentPath)
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error(`ConfirmBindingGate: artifactPath escaped its task root during verification: ${artifactPath}`)
        }
        const currentStat = fs.statSync(currentPath)
        if (!currentStat.isFile() || String(currentStat.dev) !== String(descriptorStat.dev) ||
            String(currentStat.ino) !== String(descriptorStat.ino)) {
          throw new Error(`ConfirmBindingGate: artifactPath identity changed during verification: ${artifactPath}`)
        }
        return { currentPath, relative: relative.replace(/\\/g, '/') }
      }
      const beforeRead = verifyCurrentPathIdentity()
      actual = crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex').toUpperCase()
      const afterRead = verifyCurrentPathIdentity()
      if (beforeRead.currentPath !== afterRead.currentPath || beforeRead.relative !== afterRead.relative) {
        throw new Error(`ConfirmBindingGate: artifactPath changed during verification: ${artifactPath}`)
      }
      artifactPath = afterRead.relative
      const rootStat = fs.statSync(canonicalRoot)
      artifactAuthority = {
        schemaVersion: 'MemoryCpArtifactAuthorityV1',
        rootKind: 'task',
        canonicalRoot,
        canonicalRelativePath: artifactPath,
        rootIdentity: crypto.createHash('sha256')
          .update(`${canonicalRoot.replace(/\\/g, '/')}\0${rootStat.dev}\0${rootStat.ino}`)
          .digest('hex')
      }
    } finally {
      fs.closeSync(descriptor)
    }
    if (actual !== sha) {
      throw new Error(
        `ConfirmBindingGate: artifactSha256 mismatch for ${artifactPath} (disk=${actual}). ` +
        'Re-hash the file on disk AFTER the last edit (sha256 of current bytes), then call memory_cp_confirm again. ' +
        'Do not reuse a hash computed before subsequent writes.'
      )
    }
  }

  const target = taskMemoryTransactionTarget(args)
  const transaction = withMemoryTransaction(target, p, existing => renderCpConfirmation(existing, args, {
    hasDigest,
    sha,
    artifactPath,
    artifactVersion,
    sourceMessage,
    time
  }))
  const persisted = readFile(p)
  assertNoCpRowsOutsideDedicatedBlock(persisted)
  const block = locateCpTableBlock(persisted)
  const blockText = block.found ? block.lines.slice(block.start, block.end).join('\n') : ''
  const parsed = parseCpTableRows(blockText)
  const phaseRow = parsed[args.phase]
  const cpRowCount = (blockText.match(/^\|\s*CP[123]\s*\|/gm) || []).length
  if (!block.found || block.incomplete ||
      !EXTENDED_CP_TABLE_HEADER_RE.test(blockText.split('\n').find(line => EXTENDED_CP_TABLE_HEADER_RE.test(line.trim())) || '') ||
      cpRowCount !== 3 || !phaseRow?.confirmed) {
    throw new Error('ConfirmBindingGate: CP confirmation readback is incomplete or malformed')
  }
  if (hasDigest) {
    const persistedPath = String(phaseRow.artifactPath || '').replace(/`/g, '')
    if (persistedPath !== artifactPath || phaseRow.artifactSha256 !== sha) {
      throw new Error('ConfirmBindingGate: CP confirmation readback does not match artifact binding')
    }
  }
  const confirmation = {
    schemaVersion: 'MemoryCpConfirmationReceiptV1',
    phase: args.phase,
    status: 'confirmed',
    digestBound: hasDigest,
    artifactPath,
    artifactSha256: sha,
    artifactAuthority,
    confirmedAt: time,
    cpRowCount,
    readbackVerified: true,
    transaction
  }
  return {
    content: [{ type: 'text', text: `已在 sessions.md 记录 ${args.phase} ✅ (${time})${hasDigest ? ' digest-bound' : ''}\n${JSON.stringify(confirmation)}` }],
    structuredContent: confirmation
  }
}

function handleMemorySummaryRead(args) {
  const target = resolveMemoryTarget(args)
  resolveContextReadBinding(
    args.contextBinding,
    target,
    'memory:memory_summary_query'
  )
  const p = memoryClientPath(target, 'SUMMARY.md')
  const document = readMemoryDocument(p)
  return { content: [{ type: 'text', text: document.content || '（SUMMARY.md 不存在或为空）' }] }
}

function handleMemorySummaryAppend(args) {
  if (!args.row) throw new Error('row is required')
  if (typeof args.row !== 'string' || args.row !== args.row.trim() || /[\r\n]/.test(args.row)) {
    throw memoryQueryError('Invalid SUMMARY row: pass one trimmed Markdown table row.')
  }
  const cells = splitMarkdownRow(args.row)
  if (cells.length !== 7) {
    throw memoryQueryError('Invalid SUMMARY row: exactly seven columns are required; escape literal pipes as \\|.')
  }
  const day = String(cells[0] || '').slice(0, 10)
  validateSince(day)
  if (!/^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$/.test(cells[0])) {
    throw memoryQueryError('Invalid SUMMARY date: use YYYY-MM-DD or YYYY-MM-DD HH:mm.')
  }
  if (!normalizeSessionId(cells[1])) {
    throw memoryQueryError('Invalid SUMMARY row: session is required.')
  }
  if (!String(cells[2] || '').trim() || !String(cells[3] || '').trim()) {
    throw memoryQueryError('Invalid SUMMARY row: type and summary are required.')
  }
  // SummaryTypeCanonGate：类型列仅允许 canonical 工作流意图（+ 连接）
  let normalizedType = String(cells[2] || '').trim()
  if (SUMMARY_TYPE_CANON) {
    const typeCheck = SUMMARY_TYPE_CANON.validateSummaryType(normalizedType)
    if (!typeCheck.ok) {
      throw memoryQueryError(
        `Invalid SUMMARY type: ${typeCheck.message}`,
        'Allowed: dev|fix|analyze|audit|self-fix|chat|resume|other joined by + only (no slash/free labels).',
        typeCheck.errorCode || 'SUMMARY_TYPE_NON_CANONICAL'
      )
    }
    normalizedType = typeCheck.normalized
  }
  if (normalizedMemoryState(cells[6]) === 'unknown') {
    throw memoryQueryError('Invalid SUMMARY row: status must map to active, completed, or blocked.')
  }
  // Prefer original row when type already matches normalized form (stable spacing)
  const finalRow = String(cells[2] || '').trim() === normalizedType
    ? args.row
    : `| ${cells[0]} | ${cells[1]} | ${normalizedType} | ${cells[3]} | ${cells[4]} | ${cells[5]} | ${cells[6]} |`
  const target = resolveMemoryTarget(args)
  const p = memoryClientPath(target, 'SUMMARY.md')
  const receipt = withMemoryTransaction(target, p, existing => {
    const appendText = existing
      ? finalRow + '\n'
      : summaryHeader(args.agent || target.agent, args) + finalRow + '\n'
    return { content: existing + appendText, appendText }
  })
  receipt.indexReceipt = refreshSummaryMemoryIndex(target, p)
  const parsed = parseSummaryRows(readFile(p))
  const appended = parsed.rows[parsed.rows.length - 1]
  if (!appended || appended.day !== day || appended.sessionId !== normalizeSessionId(cells[1])) {
    throw memoryQueryError(
      'SUMMARY write completed but readback did not reproduce the appended row.',
      'Inspect SUMMARY.md and retry after repairing the writer-reader contract.',
      'MEMORY_SUMMARY_READBACK_FAILED'
    )
  }
  receipt.summaryEvent = {
    schemaVersion: 'MemorySummaryEventReceiptV1',
    semantics: 'append-only-last-event-wins',
    sessionKey: `${appended.day}#${appended.sessionId}`,
    currentState: appended.state,
    rowNumber: appended.rowNumber
  }
  return {
    content: [{ type: 'text', text: `已追加到 SUMMARY.md\n${JSON.stringify(receipt)}` }],
    structuredContent: receipt
  }
}

function handleMemoryTaskResolve(args) {
  if (!String(args.name || '').trim()) throw new TaskContinuationError('TASK_NAME_REQUIRED', 'name is required')
  const resolution = resolveTaskContinuation({
    cwd: INPUT_ROOT,
    name: args.name,
    project: args.project || '',
    scope: args.scope || 'auto',
    persistIndex: args.persistIndex !== false
  })
  return {
    content: [{ type: 'text', text: JSON.stringify(resolution, null, 2) }],
    structuredContent: resolution,
    isError: resolution.status !== 'resolved-active'
  }
}

// ─── MCP JSON-RPC dispatcher ──────────────────────────────────────────────────

function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      }

    case 'tools/list':
      return { tools: TOOLS }

    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments || {}
      try {
        switch (name) {
          case 'memory_task_resolve': return handleMemoryTaskResolve(args)
          case 'memory_status': return handleMemoryStatus(args)
          case 'memory_session_query': return handleMemorySessionQuery(args)
          case 'memory_summary_query': return handleMemorySummaryQuery(args)
          case 'memory_session_allocate': return handleMemorySessionAllocate(args)
          case 'memory_session_read': return handleMemorySessionRead(args)
          case 'memory_session_write': return handleMemorySessionWrite(args)
          case 'memory_cp_confirm': return handleMemoryCpConfirm(args)
          case 'memory_summary_read': return handleMemorySummaryRead(args)
          case 'memory_summary_append': return handleMemorySummaryAppend(args)
          default:
            throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 })
        }
      } catch (err) {
        const errorCode = err.contextReadCode || null
        return {
          content: [{ type: 'text', text: `Error: ${errorCode ? `${errorCode}: ` : ''}${err.message}` }],
          ...(errorCode ? {
            structuredContent: {
              schemaVersion: 'MemoryWriterErrorV1',
              errorCode,
              message: err.message,
              nextStep: err.nextStep || 'Correct the memory writer request and retry once.'
            }
          } : {}),
          isError: true
        }
      }
    }

    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }
}

if (require.main === module) {
  createJsonLineServer({ dispatch, onEnd: () => process.exit(0) })
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
}

module.exports = {
  applyMemoryCursor,
  decodeMemoryCursor,
  dispatch,
  encodeMemoryCursor,
  memoryCursorBinding,
  memoryCursorSourceIdentity,
  parseDailySessions,
  parseSummaryRows,
  readMemoryDocument
}
