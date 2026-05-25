#!/usr/bin/env node
'use strict'

/**
 * DevCodex MCP Memory Server — local stdio process (no deployment needed)
 *
 * Implements MCP 2024-11-05 protocol over stdin/stdout (JSON-RPC 2.0).
 *
 * Tools:
 *   memory_session_read   — Read today's/yesterday's session memory file
 *   memory_session_write  — Append a block to the session memory file
 *   memory_cp_confirm     — Record CP checkpoint confirmation in sessions.md
 *   memory_summary_read   — Read agent SUMMARY.md
 *   memory_summary_append — Append one index row to agent SUMMARY.md
 */

const fs = require('fs')
const path = require('path')

const INPUT_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd()

// ─── Server metadata ──────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'devcodex-memory',
  version: '1.0.0'
}

const DEFAULT_AGENT = 'claude-code'
const TASK_KINDS = new Set(['requirements', 'bugs'])

const TOOLS = [
  {
    name: 'memory_session_read',
    description: '读取今日或昨日的会话记忆文件。返回文件内容字符串，不存在时返回空字符串。',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent 标识（如 claude-code / copilot），默认 claude-code' },
        date: { type: 'string', description: 'YYYYMMDD 日期，默认今日' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间。' }
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
        agent: { type: 'string', description: 'Agent 标识，默认 claude-code' },
        date: { type: 'string', description: 'YYYYMMDD 日期，默认今日' },
        content: { type: 'string', description: '追加的 Markdown 内容' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间。' }
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
        kind: { type: 'string', enum: ['requirements', 'bugs'], description: '任务根类型，默认 requirements' },
        phase: { type: 'string', enum: ['CP1', 'CP2', 'CP3'], description: 'CP 阶段' },
        time: { type: 'string', description: '确认时间（如 10:30），默认当前时间' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间。' }
      }
    }
  },
  {
    name: 'memory_summary_read',
    description: '读取 Agent SUMMARY.md 文件内容。',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认 claude-code' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定读取域；默认按当前 cwd 推断。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间。' }
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
        agent: { type: 'string', description: 'Agent 标识，默认 claude-code' },
        row: { type: 'string', description: 'Markdown 表格行（含首尾 |）' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选。集中布局下指定写入域；默认按当前 cwd 推断。' },
        project: { type: 'string', description: '可选。集中布局下显式指定项目命名空间。' }
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

function findLayoutInfo(startDir) {
  let current = path.resolve(startDir)
  while (true) {
    const markerPath = path.join(current, '.devcodex', 'layout.json')
    const marker = readJsonFile(markerPath)
    if (marker && String(marker.mode || '').trim() === 'workspace-namespace') {
      return {
        enabled: true,
        mode: 'workspace-namespace',
        workspaceRoot: current,
        markerPath
      }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return {
    enabled: false,
    mode: 'legacy-project-root',
    workspaceRoot: path.resolve(startDir),
    markerPath: null
  }
}

const LAYOUT = findLayoutInfo(INPUT_ROOT)

function inferContextProject() {
  if (!LAYOUT.enabled) return ''
  const relative = path.relative(LAYOUT.workspaceRoot, INPUT_ROOT)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return ''
  const parts = relative.split(path.sep).filter(Boolean)
  if (!parts.length) return ''
  const first = parts[0]
  if (first === '.devcodex' || first === 'workspace') return ''
  return first
}

const CONTEXT_PROJECT = inferContextProject()
const DEFAULT_SCOPE = LAYOUT.enabled ? (CONTEXT_PROJECT ? 'project' : 'workspace') : 'project'

function resolveProjectName(projectName) {
  return String(projectName || '').trim() || CONTEXT_PROJECT || ''
}

function resolveProjectRoot(projectName) {
  if (!projectName) return INPUT_ROOT
  if (path.isAbsolute(projectName)) return path.resolve(projectName)
  const base = LAYOUT.enabled ? LAYOUT.workspaceRoot : INPUT_ROOT
  return path.resolve(base, projectName)
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
  const scope = resolveScope(args.scope)
  const projectName = resolveProjectName(args.project)
  if (scope === 'workspace' || !projectName) {
    return path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace')
  }
  return path.join(LAYOUT.workspaceRoot, '.devcodex', projectName)
}

function sessionFilePath(agent, date, args = {}) {
  return path.join(
    getActiveRoot(args), '.memory', 'clients',
    agent || DEFAULT_AGENT, 'tasks', `${date || today()}.md`
  )
}

function summaryFilePath(agent, args = {}) {
  return path.join(
    getActiveRoot(args), '.memory', 'clients',
    agent || DEFAULT_AGENT, 'SUMMARY.md'
  )
}

function taskSessionsPath(kind, requirement, args = {}) {
  return path.join(
    getActiveRoot(args), kind,
    requirement, '.memory', 'sessions.md'
  )
}

function appendFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, content, 'utf8')
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

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
    const header = '| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |\n|------|------|------|------|---------|---------|------|\n'
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, header + args.row + '\n', 'utf8')
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
