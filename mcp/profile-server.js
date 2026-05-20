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

const TOOLS = [
  {
    name: 'profile_load',
    description: '加载 .devcodex/profile/ 下的所有标准 Profile 文件，返回各文件的路径与内容。',
    inputSchema: {
      type: 'object',
      properties: {
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
      properties: {}
    }
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

function profileDir() {
  return path.join(WORKSPACE_ROOT, '.devcodex', 'profile')
}

function readFileText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8') } catch { return null }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

function handleProfileLoad(args) {
  const dir = profileDir()
  const names = (args.files && args.files.length > 0) ? args.files : STANDARD_FILES
  const parts = []
  const missing = []

  for (const name of names) {
    const fullPath = path.join(dir, name)
    const content = readFileText(fullPath)
    if (content !== null) {
      parts.push(`### ${name}\n\n${content}`)
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

function handleProfileGetMode() {
  const configPath = path.join(profileDir(), 'config.json')
  const raw = readFileText(configPath)
  let mode = 'prod'
  let agent = 'claude'

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
      text: JSON.stringify({ mode, agent, configExists: raw !== null }, null, 2)
    }]
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
          case 'profile_load': return handleProfileLoad(args)
          case 'profile_get_mode': return handleProfileGetMode()
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
