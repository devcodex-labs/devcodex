#!/usr/bin/env node
'use strict'

/**
 * DevCodex MCP Profile Server — local stdio process (no deployment needed)
 *
 * Implements MCP 2024-11-05 protocol over stdin/stdout (JSON-RPC 2.0).
 *
 * Tools:
 *   profile_load     — Read all standard profile files for a project
 *   profile_get_mode — Return ENV_MODE (dev/prod) from config.json
 */

const fs = require('fs')
const path = require('path')

const WORKSPACE_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd()

// ─── Server metadata ──────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'devcodex-profile',
  version: '1.0.0'
}

const DEFAULT_AGENT = 'claude-code'

const TOOLS = [
  {
    name: 'profile_load',
    description: '加载 .devcodex/profile/ 下的所有标准 Profile 文件，返回各文件的路径与内容。',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: '可选。工作区模式下指定目标项目目录名；命中后优先读取 <project>/.devcodex/profile，缺失时再回退到工作区根。'
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '指定要加载的文件名列表（如 ["01-项目信息.md"]），省略则加载全部标准文件'
        }
      }
    }
  },
  {
    name: 'profile_get_mode',
    description: '从 .devcodex/profile/config.json 读取 ENV_MODE（dev 或 prod）及 agent 字段。Profile 不存在时返回 prod（保守默认）。',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: '可选。工作区模式下指定目标项目目录名；命中后优先读取 <project>/.devcodex/profile，缺失时再回退到工作区根。'
        }
      }
    }
  }
]

// ─── Prompts ──────────────────────────────────────────────────────────────────

const PROMPTS = [
  {
    name: 'devcodex-init',
    description: '一键加载 DevCodex 工作流规范与当前项目 Profile。在新建会话时使用，实现免手敲挂载规范。',
    arguments: []
  }
]

// ─── Standard profile files ───────────────────────────────────────────────────

const STANDARD_FILES = [
  'README.md',
  '01-项目信息.md',
  '02-架构约束.md',
  '03-代码风格.md',
  '04-测试规范.md',
  '05-发布规范.md',
  'config.json'
]

const REQUIRED_FILES = new Set(['01-项目信息.md', '02-架构约束.md', '03-代码风格.md'])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveProjectRoot(projectName) {
  if (!projectName) return WORKSPACE_ROOT
  const candidate = path.isAbsolute(projectName)
    ? path.resolve(projectName)
    : path.resolve(WORKSPACE_ROOT, projectName)
  return candidate
}

function profileRoots(projectName) {
  const primary = resolveProjectRoot(projectName)
  const roots = [primary]
  if (primary !== WORKSPACE_ROOT) roots.push(WORKSPACE_ROOT)
  return roots
}

function profileDir(projectName) {
  return path.join(resolveProjectRoot(projectName), '.devcodex', 'profile')
}

function resolveProfileFile(name, projectName) {
  for (const root of profileRoots(projectName)) {
    const fullPath = path.join(root, '.devcodex', 'profile', name)
    const content = readFileText(fullPath)
    if (content !== null) {
      return { fullPath, content, root }
    }
  }
  return null
}

function readFileText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8') } catch { return null }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

function handleProfileLoad(args) {
  const names = (args.files && args.files.length > 0) ? args.files : STANDARD_FILES
  const parts = []
  const missing = []

  for (const name of names) {
    const resolved = resolveProfileFile(name, args.project)
    if (resolved) {
      const sourceRoot = resolved.root === WORKSPACE_ROOT
        ? '工作区根'
        : `项目根（${path.basename(resolved.root)}）`
      parts.push(`### ${name}\n\n> 来源：${sourceRoot}\n> 路径：${resolved.fullPath}\n\n${resolved.content}`)
    } else if (REQUIRED_FILES.has(name)) {
      parts.push(`### ${name}\n\n（⚠️ 必需文件不存在）`)
      missing.push(name)
    } else {
      parts.push(`### ${name}\n\n（文件不存在，跳过）`)
    }
  }

  let text = parts.join('\n\n---\n\n')
  if (missing.length > 0) {
    text = `⚠️ 必需 Profile 文件缺失，AI 将以保守降级模式运行：${missing.join('、')}\n\n---\n\n` + text
  }

  return {
    content: [{
      type: 'text',
      text
    }]
  }
}

function handleProfileGetMode(args = {}) {
  const resolved = resolveProfileFile('config.json', args.project)
  const raw = resolved?.content || null
  let mode = 'prod'
  let agent = DEFAULT_AGENT

  if (raw) {
    try {
      const cfg = JSON.parse(raw)
      if (cfg.mode && typeof cfg.mode === 'string') mode = cfg.mode.toLowerCase() === 'dev' ? 'dev' : 'prod'
      if (cfg.agent && typeof cfg.agent === 'string') agent = cfg.agent
    } catch { /* keep defaults */ }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        mode,
        agent,
        configExists: raw !== null,
        sourceRoot: resolved ? resolved.root : null
      }, null, 2)
    }]
  }
}

function handlePromptsList() {
  return { prompts: PROMPTS }
}

function handlePromptsGet(args) {
  if (args.name !== 'devcodex-init') {
    throw Object.assign(new Error(`Unknown prompt: ${args.name}`), { code: -32601 })
  }

  // 读取 CLAUDE.md
  const claudePath = path.join(WORKSPACE_ROOT, 'CLAUDE.md')
  let claudeContent = readFileText(claudePath)
  if (!claudeContent) {
    claudeContent = '（⚠️ 工作区根目录未找到 CLAUDE.md）'
  }

  // 复用 handleProfileLoad 获取 Profile 内容
  const profileResponse = handleProfileLoad({})
  const profileText = profileResponse.content[0].text

  const promptText = `请严格遵循以下工作流规范与项目配置执行后续任务：\n\n## 1. 核心规范 (CLAUDE.md)\n\n${claudeContent}\n\n## 2. 项目专属配置 (Profile)\n\n${profileText}\n\n请在充分理解上述规范后，输出预检查块 (PC0~PC7) 并等待我的进一步指示。`

  return {
    description: PROMPTS[0].description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: promptText }
      }
    ]
  }
}

// ─── MCP JSON-RPC dispatcher ──────────────────────────────────────────────────

function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, prompts: {} },
        serverInfo: SERVER_INFO
      }

    case 'tools/list':
      return { tools: TOOLS }

    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments || {}
      try {
        switch (name) {
          case 'profile_load': return handleProfileLoad(args)
          case 'profile_get_mode': return handleProfileGetMode(args)
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

    case 'prompts/list':
      return handlePromptsList()

    case 'prompts/get': {
      const args = params || {}
      try {
        return handlePromptsGet(args)
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
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop()
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
