#!/usr/bin/env node
'use strict'

/**
 * DevCodex MCP Memory Server — local stdio process (no deployment needed)
 *
 * Implements MCP 2024-11-05 protocol over stdin/stdout (JSON-RPC 2.0).
 *
 * Tools:
 *   memory_status         — Read bounded today/yesterday/SUMMARY metadata
 *   memory_session_query  — Read exact bounded daily-memory session sections
 *   memory_summary_query  — Read bounded latest/unresolved SUMMARY rows
 *   memory_session_read   — Read today's/yesterday's session memory file
 *   memory_session_write  — Append a block to the session memory file
 *   memory_cp_confirm     — Record CP checkpoint confirmation in sessions.md
 *   memory_summary_read   — Read agent SUMMARY.md
 *   memory_summary_append — Append one index row to agent SUMMARY.md
 */

const fs = require('fs')
const path = require('path')
const { assertSingleSegment, resolveInside } = require('./path-guard')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath,
  normalizeProjectNamespace,
  resolveLegacyProjectRoot
} = require('../hooks/_runtime/workspace-layout.cjs')
const {
  CONTEXT_READ_CONTRACT,
  buildContextReadError
} = require('../hooks/_runtime/context-read-contract.cjs')

const INPUT_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd()

// ─── Server metadata ──────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'devcodex-memory',
  version: '1.0.0'
}

const VALID_AGENTS = new Set([
  'copilot',
  'vscode-copilot',
  'jetbrains-copilot',
  'claude-code',
  'codex',
  'cursor',
  'unknown-agent'
])

function normalizeAgent(value) {
  const agent = String(value || '').trim().toLowerCase()
  return VALID_AGENTS.has(agent) ? agent : ''
}

// This server is normally launched by Claude Code. DEVCODEX_AGENT lets other
// launchers/tests pin the actual host without consulting profile config.
function detectRuntimeAgent() {
  return normalizeAgent(process.env.DEVCODEX_AGENT) || 'claude-code'
}

const EXPLICIT_RUNTIME_AGENT = normalizeAgent(process.env.DEVCODEX_AGENT)
const DEFAULT_AGENT = detectRuntimeAgent()
const TASK_KINDS = new Set(['requirements', 'bugs', 'optimizations', 'scenario-tests'])

const TOOLS = [
  {
    name: 'memory_status',
    description: '返回当前目标的紧凑记忆状态：今日/昨日元数据、有限 SUMMARY 行、活动会话与状态冲突。不返回整文件正文。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { type: 'string', description: '集中布局下的项目命名空间' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'latestRows 数量，默认 5，最大 20' }
      }
    }
  },
  {
    name: 'memory_session_query',
    description: '按日期、会话、状态或 ContextHandoffCard 精确读取 daily memory 的有限片段。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { type: 'string', description: '集中布局下的项目命名空间' },
        date: { type: 'string', pattern: '^\\d{8}$', description: 'YYYYMMDD，默认今日' },
        sessionId: { type: 'string', minLength: 1, maxLength: 64, description: '精确会话编号，如 01 或 02a' },
        status: { type: 'string', enum: ['active', 'completed', 'blocked', 'unresolved', 'all'], description: '会话状态，默认 all' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回会话数，默认 1' },
        handoffOnly: { type: 'boolean', description: '仅返回 ContextHandoffCard' },
        maxChars: { type: 'integer', minimum: 1, maximum: 50000, description: '正文总字符预算，默认 12000' }
      }
    }
  },
  {
    name: 'memory_summary_query',
    description: '返回有限的 SUMMARY 行；默认仅返回 active，支持 unresolved、since 与 last-N。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { type: 'string', description: '集中布局下的项目命名空间' },
        status: { type: 'string', enum: ['active', 'completed', 'blocked', 'unresolved', 'all'], description: '默认 active' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '最多返回行数，默认 5，最大 50' },
        since: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '只返回该日期及之后的行' }
      }
    }
  },
  {
    name: 'memory_session_read',
    description: '读取今日或昨日的会话记忆文件。返回文件内容字符串，不存在时返回空字符串。',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent 标识（如 claude-code / codex / copilot），默认当前实际宿主' },
        date: { type: 'string', description: 'YYYYMMDD 日期，默认今日' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定读取域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误读项目记忆。' }
      }
    }
  },
  {
    name: 'memory_session_write',
    description: '追加内容到会话记忆文件（不覆盖已有内容）。文件不存在时自动创建。',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        date: { type: 'string', description: 'YYYYMMDD 日期，默认今日' },
        content: { type: 'string', description: '追加的 Markdown 内容' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误写项目记忆。' }
      }
    }
  },
  {
    name: 'memory_cp_confirm',
    description: '在任务的 .memory/sessions.md 中记录 CP 确认状态（✅）。',
    inputSchema: {
      type: 'object',
      required: ['requirement', 'phase'],
      properties: {
        requirement: { type: 'string', description: '任务目录名（兼容旧字段名；配合 kind 指向 .devcodex/requirements/<name> 或 .devcodex/bugs/<name>）' },
        kind: { type: 'string', enum: ['requirements', 'bugs', 'optimizations', 'scenario-tests'], description: '任务根类型，默认 requirements' },
        phase: { type: 'string', enum: ['CP1', 'CP2', 'CP3'], description: 'CP 阶段' },
        time: { type: 'string', description: '确认时间（如 10:30），默认当前时间' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误写任务确认。' }
      }
    }
  },
  {
    name: 'memory_summary_read',
    description: '读取 Agent SUMMARY.md 文件内容。',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定读取域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误读 SUMMARY。' }
      }
    }
  },
  {
    name: 'memory_summary_append',
    description: '向 Agent SUMMARY.md 追加一行会话索引。',
    inputSchema: {
      type: 'object',
      required: ['row'],
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        row: { type: 'string', description: 'Markdown 表格行（含首尾 |）' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。若 cwd 在 workspace 根，必须显式传 project 或 scope:"workspace"。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间；旧布局下仅允许当前项目，避免 workspace 根误写 SUMMARY。' }
      }
    }
  }
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function currentTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function validateDate(date) {
  if (date && !/^\d{8}$/.test(date)) throw new Error(`date must be YYYYMMDD, got: ${date}`)
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
  if (LAYOUT.enabled) {
    return normalizeProjectNamespace(projectName, {
      layout: LAYOUT,
      contextProject: CONTEXT_PROJECT,
      allowEmpty: true
    })
  }
  const raw = String(projectName || '').trim()
  if (!raw) return ''
  return path.basename(resolveLegacyProjectRoot(INPUT_ROOT, raw))
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

function appendFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, content, 'utf8')
}

// ─── Bounded read-only projection helpers ───────────────────────────────────

const MEMORY_QUERY_STATUSES = new Set(['active', 'completed', 'blocked', 'unresolved', 'all'])
const MEMORY_STATUS_FIELDS = new Set(['agent', 'scope', 'project', 'limit'])
const MEMORY_SESSION_QUERY_FIELDS = new Set([
  'agent', 'scope', 'project', 'date', 'sessionId', 'status', 'limit', 'handoffOnly', 'maxChars'
])
const MEMORY_SUMMARY_QUERY_FIELDS = new Set(['agent', 'scope', 'project', 'status', 'limit', 'since'])
const MAX_SUMMARY_ROWS_FOR_STATUS = 20

function elapsedMs(startedAt) {
  return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(3))
}

function yesterday() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10).replace(/-/g, '')
}

function compactDateToIso(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function validateQueryDate(value, field = 'date') {
  if (!/^\d{8}$/.test(String(value || ''))) {
    throw memoryQueryError(`${field} must be YYYYMMDD.`)
  }
  const iso = compactDateToIso(String(value))
  const parsed = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
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
      project: scope === 'workspace' ? '' : (projectName || CONTEXT_PROJECT || ''),
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
  const metadata = memoryFileMetadata(filePath)
  if (!metadata.exists) return { ...metadata, content: '' }
  const content = fs.readFileSync(filePath, 'utf8')
  return {
    ...metadata,
    bytes: Buffer.byteLength(content, 'utf8'),
    chars: content.length,
    content
  }
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
  const bySession = new Map()
  for (const row of rows) {
    const key = `${row.day}#${row.sessionId}`
    if (!bySession.has(key)) bySession.set(key, new Set())
    if (row.state !== 'unknown') bySession.get(key).add(row.state)
  }
  return [...bySession.entries()]
    .filter(([, states]) => states.size > 1)
    .map(([sessionKey, states]) => ({ sessionKey, states: [...states].sort() }))
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
    const statusLine = raw.split(/\r?\n/).find(line => /^状态[：:]/.test(line.trim())) || ''
    const status = statusLine.replace(/^状态[：:]\s*/, '').trim()
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

function projectionTelemetry(value, sourceDocuments, startedAt) {
  const serialized = JSON.stringify(value)
  return {
    bytes: Buffer.byteLength(serialized, 'utf8'),
    chars: serialized.length,
    sourceBytes: sourceDocuments.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
    sourceChars: sourceDocuments.reduce((sum, item) => sum + Number(item.chars || 0), 0),
    filesRead: sourceDocuments.filter(item => item.exists && item.content !== undefined).length,
    latencyMs: elapsedMs(startedAt),
    tokens: null
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
    const limit = normalizeBoundedInteger(input.limit, 5, 20, 'limit')
    const todayDate = today()
    const yesterdayDate = yesterday()
    const todayMetadata = memoryFileMetadata(memoryClientPath(target, 'tasks', `${todayDate}.md`))
    const yesterdayMetadata = memoryFileMetadata(memoryClientPath(target, 'tasks', `${yesterdayDate}.md`))
    const summaryDocument = readMemoryDocument(memoryClientPath(target, 'SUMMARY.md'))
    const parsed = parseSummaryRows(summaryDocument.content)
    const latestRows = parsed.rows.slice().reverse().slice(0, limit)
    const nonCanonicalActiveRows = parsed.rows.filter(row => row.state === 'active' && !row.sessionIdCanonical)
    const allActiveSessionIds = [...new Set(parsed.rows.slice().reverse()
      .filter(row => row.state === 'active' && row.sessionIdCanonical)
      .map(row => `${row.day}#${row.sessionId}`))]
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
      warnings: [...boundWarnings, ...parsed.warnings].slice(0, 20)
    }
    return {
      ...projection,
      telemetry: projectionTelemetry(projection, [summaryDocument], startedAt)
    }
  })
}

function handleMemorySessionQuery(args) {
  return runMemoryProjection(args, MEMORY_SESSION_QUERY_FIELDS, input => {
    const startedAt = process.hrtime.bigint()
    const target = resolveMemoryTarget(input)
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
    const document = readMemoryDocument(memoryClientPath(target, 'tasks', `${date}.md`))
    const parsed = parseDailySessions(document.content, date)
    const candidates = parsed.sessions.slice().reverse().filter(session => {
      if (normalizedSession && session.sessionId !== normalizedSession) return false
      if (!memoryStateMatches(session.state, status)) return false
      if (handoffOnly && !session.handoff) return false
      return true
    })
    const matches = []
    let remainingChars = maxChars
    let contentTruncated = false
    for (const session of candidates.slice(0, limit)) {
      if (remainingChars <= 0) {
        contentTruncated = true
        break
      }
      const sourceContent = handoffOnly ? session.handoff : session.content
      const boundedContent = sourceContent.slice(0, remainingChars)
      const truncated = boundedContent.length < sourceContent.length
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
    const query = {
      date,
      sessionId: requestedSessionId || null,
      status,
      limit,
      handoffOnly,
      maxChars
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
      truncated: candidates.length > matches.length || contentTruncated,
      source,
      warnings: parsed.warnings
    }
    return {
      ...projection,
      telemetry: projectionTelemetry(projection, [document], startedAt)
    }
  })
}

function handleMemorySummaryQuery(args) {
  return runMemoryProjection(args, MEMORY_SUMMARY_QUERY_FIELDS, input => {
    const startedAt = process.hrtime.bigint()
    const target = resolveMemoryTarget(input)
    const status = normalizeQueryStatus(input.status, 'active')
    const limit = normalizeBoundedInteger(input.limit, 5, 50, 'limit')
    if (input.since !== undefined && (
      typeof input.since !== 'string' || !input.since || input.since !== input.since.trim()
    )) {
      throw memoryQueryError('since must be a non-empty exact YYYY-MM-DD string when supplied.')
    }
    const since = input.since === undefined ? null : input.since
    if (since !== null) validateSince(since)
    const document = readMemoryDocument(memoryClientPath(target, 'SUMMARY.md'))
    const parsed = parseSummaryRows(document.content)
    const filtered = parsed.rows.filter(row => {
      if (since && row.day < since) return false
      return memoryStateMatches(row.state, status)
    })
    const rows = filtered.slice().reverse().slice(0, limit)
    const query = { status, limit, since }
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
      truncated: filtered.length > rows.length,
      source,
      warnings: parsed.warnings
    }
    return {
      ...projection,
      telemetry: projectionTelemetry(projection, [document], startedAt)
    }
  })
}

function handleMemorySessionRead(args) {
  validateDate(args.date)
  const p = sessionFilePath(args.agent, args.date, args)
  const content = readFile(p)
  return { content: [{ type: 'text', text: content || '（文件不存在或为空）' }] }
}

function handleMemorySessionWrite(args) {
  if (!args.content) throw new Error('content is required')
  validateDate(args.date)
  const p = sessionFilePath(args.agent, args.date, args)
  const separator = fs.existsSync(p) ? '\n' : ''
  appendFile(p, separator + args.content)
  return { content: [{ type: 'text', text: `已追加到 ${path.relative(LAYOUT.workspaceRoot, p)}` }] }
}

function handleMemoryCpConfirm(args) {
  if (!args.requirement) throw new Error('requirement is required')
  if (!args.phase) throw new Error('phase is required')
  const kind = args.kind || 'requirements'
  if (!TASK_KINDS.has(kind)) throw new Error(`kind must be one of: ${[...TASK_KINDS].join(', ')}`)

  const p = taskSessionsPath(kind, args.requirement, args)
  const time = args.time || currentTime()
  const existing = readFile(p)

  if (!existing) {
    // Create sessions.md with full CP table
    const header = [
      `# ${args.requirement} — CP 确认记录`,
      '',
      '| CP  | 状态 | 时间  |',
      '|:---:|:----:|-------|',
      `| CP1 | ${args.phase === 'CP1' ? '✅' : '⏳'} | ${args.phase === 'CP1' ? time : '—'} |`,
      `| CP2 | ${args.phase === 'CP2' ? '✅' : '⏹️'} | ${args.phase === 'CP2' ? time : '—'} |`,
      `| CP3 | ${args.phase === 'CP3' ? '✅' : '⏹️'} | ${args.phase === 'CP3' ? time : '—'} |`,
      ''
    ].join('\n')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, header, 'utf8')
    return { content: [{ type: 'text', text: `已创建 sessions.md 并记录 ${args.phase} ✅` }] }
  }

  // Update existing table row in-place
  const phaseNum = args.phase.replace('CP', '')
  const rowRe = new RegExp(`(\\|\\s*CP${phaseNum}\\s*\\|\\s*)([^|]*)(\\|\\s*)([^|]*)(\\|)`)
  let updated = existing

  if (rowRe.test(existing)) {
    updated = existing.replace(rowRe, `| ${args.phase} | ✅ | ${time} |`)
  } else {
    // Row not found — append it
    updated = existing.trimEnd() + `\n| ${args.phase} | ✅ | ${time} |\n`
  }

  fs.writeFileSync(p, updated, 'utf8')
  return { content: [{ type: 'text', text: `已在 sessions.md 记录 ${args.phase} ✅ (${time})` }] }
}

function handleMemorySummaryRead(args) {
  const p = summaryFilePath(args.agent, args)
  const content = readFile(p)
  return { content: [{ type: 'text', text: content || '（SUMMARY.md 不存在或为空）' }] }
}

function handleMemorySummaryAppend(args) {
  if (!args.row) throw new Error('row is required')
  const p = summaryFilePath(args.agent, args)
  const existing = readFile(p)

  if (!existing) {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, summaryHeader(args.agent || DEFAULT_AGENT, args) + args.row + '\n', 'utf8')
  } else {
    appendFile(p, args.row + '\n')
  }
  return { content: [{ type: 'text', text: `已追加到 SUMMARY.md` }] }
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
          case 'memory_status': return handleMemoryStatus(args)
          case 'memory_session_query': return handleMemorySessionQuery(args)
          case 'memory_summary_query': return handleMemorySummaryQuery(args)
          case 'memory_session_read': return handleMemorySessionRead(args)
          case 'memory_session_write': return handleMemorySessionWrite(args)
          case 'memory_cp_confirm': return handleMemoryCpConfirm(args)
          case 'memory_summary_read': return handleMemorySummaryRead(args)
          case 'memory_summary_append': return handleMemorySummaryAppend(args)
          default:
            throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 })
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        }
      }
    }

    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }
}

// ─── stdio transport ──────────────────────────────────────────────────────────

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result })
  process.stdout.write(msg + '\n')
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
  process.stdout.write(msg + '\n')
}

let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop() // keep incomplete line
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let req
    try { req = JSON.parse(trimmed) } catch {
      sendError(null, -32700, 'Parse error')
      continue
    }
    try {
      const result = dispatch(req.method, req.params)
      if (req.id !== undefined) sendResponse(req.id, result)
    } catch (err) {
      if (req.id !== undefined) sendError(req.id, err.code || -32603, err.message)
    }
  }
})

process.stdin.on('end', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
