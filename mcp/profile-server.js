#!/usr/bin/env node
'use strict'

/**
 * DevCodex MCP Profile Server — local stdio process (no deployment needed)
 *
 * Implements MCP 2024-11-05 protocol over stdin/stdout (JSON-RPC 2.0).
 *
 * Tools:
 *   profile_load     — Read all standard profile files for a project
 *   profile_get_mode — Return ENV_MODE (dev/prod) and resolved runtime agent
 */

const fs = require('fs')
const path = require('path')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath,
  normalizeProjectNamespace,
  readJsonFile,
  resolveLegacyProjectRoot
} = require('../hooks/_runtime/workspace-layout.cjs')

const INPUT_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd()

// ─── Server metadata ──────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'devcodex-profile',
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

// This MCP server is deployed through the Claude Code adapter by default. An
// explicit env value wins for tests or future host-specific launchers.
function detectRuntimeAgent() {
  return normalizeAgent(process.env.DEVCODEX_AGENT) || 'claude-code'
}

const DEFAULT_AGENT = detectRuntimeAgent()

const TOOLS = [
  {
    name: 'profile_load',
    description: '加载 .devcodex/profile/ 下的所有标准 Profile 文件，返回各文件的路径与内容。',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: '可选。指定目标项目命名空间。旧布局下仅允许当前项目；集中布局下命中 <workspace>/.devcodex/<project-namespace>/profile 并按 workspace base + project overlay 解析。'
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
    description: '从 .devcodex/profile/config.json 读取 ENV_MODE（dev 或 prod），并返回当前实际宿主 agent；config.json 的 agent 仅作为兜底提示。',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: '可选。指定目标项目命名空间。旧布局下仅允许当前项目；集中布局下命中 <workspace>/.devcodex/<project-namespace>/profile 并按 workspace base + project overlay 解析。'
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

function readFileText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8') } catch { return null }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function mergeConfig(workspaceConfig, projectConfig) {
  const merged = {}
  for (const source of [workspaceConfig, projectConfig]) {
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

const LAYOUT = findLayoutInfo(INPUT_ROOT)

function inferContextProject() {
  return inferProjectFromCwd(INPUT_ROOT, LAYOUT)
}

const CONTEXT_PROJECT = inferContextProject()

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

function getWorkspaceProfileDir() {
  if (LAYOUT.enabled) {
    // workspace-namespace: workspace base profile
    return path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace', 'profile')
  }
  return path.join(LAYOUT.workspaceRoot, '.devcodex', 'profile')
}

function getProjectNamespaceProfileDir(projectName) {
  const name = resolveProjectName(projectName)
  if (!LAYOUT.enabled || !name) return null
  return path.join(namespaceRootPath(LAYOUT.workspaceRoot, name), 'profile')
}

function getLegacyProfileDirs(projectName) {
  const primary = path.join(resolveProjectRoot(projectName), '.devcodex', 'profile')
  const roots = [primary]
  const workspaceProfile = path.join(LAYOUT.workspaceRoot, '.devcodex', 'profile')
  if (primary !== workspaceProfile) roots.push(workspaceProfile)
  return roots
}

function getLegacySourceLabel(dir, projectName) {
  const projectRoot = resolveProjectRoot(projectName)
  const projectDir = path.join(projectRoot, '.devcodex', 'profile')
  return dir === projectDir ? `项目根（${path.basename(projectRoot)}）` : '工作区根'
}

function resolveProfileFile(name, projectName) {
  if (name === 'config.json') return resolveConfigFile(projectName)

  if (!LAYOUT.enabled) {
    for (const dir of getLegacyProfileDirs(projectName)) {
      const fullPath = path.join(dir, name)
      const content = readFileText(fullPath)
      if (content !== null) {
        return {
          exists: true,
          content,
          fullPath,
          sourceLabel: getLegacySourceLabel(dir, projectName),
          sourcePaths: [fullPath]
        }
      }
    }
    return null
  }

  const projectDir = getProjectNamespaceProfileDir(projectName)
  const workspaceDir = getWorkspaceProfileDir()
  const projectPath = projectDir ? path.join(projectDir, name) : null
  const workspacePath = path.join(workspaceDir, name)

  if (projectPath) {
    const projectContent = readFileText(projectPath)
    if (projectContent !== null) {
      return {
        exists: true,
        content: projectContent,
        fullPath: projectPath,
        sourceLabel: `项目命名空间（${resolveProjectName(projectName)}）`,
        sourcePaths: [projectPath]
      }
    }
  }

  const workspaceContent = readFileText(workspacePath)
  if (workspaceContent !== null) {
    return {
      exists: true,
      content: workspaceContent,
      fullPath: workspacePath,
      sourceLabel: '工作区基座（workspace）',
      sourcePaths: [workspacePath]
    }
  }

  return null
}

function resolveConfigFile(projectName) {
  if (!LAYOUT.enabled) {
    for (const dir of getLegacyProfileDirs(projectName)) {
      const fullPath = path.join(dir, 'config.json')
      const content = readFileText(fullPath)
      if (content !== null) {
        return {
          exists: true,
          content,
          fullPath,
          sourceLabel: getLegacySourceLabel(dir, projectName),
          sourcePaths: [fullPath],
          config: readJsonFile(fullPath) || {}
        }
      }
    }
    return { exists: false, content: null, fullPath: null, sourceLabel: '未命中', sourcePaths: [], config: null }
  }

  const workspaceDir = getWorkspaceProfileDir()
  const projectDir = getProjectNamespaceProfileDir(projectName)
  const workspacePath = path.join(workspaceDir, 'config.json')
  const projectPath = projectDir ? path.join(projectDir, 'config.json') : null
  const workspaceConfig = readJsonFile(workspacePath)
  const projectConfig = projectPath ? readJsonFile(projectPath) : null
  const exists = workspaceConfig !== null || projectConfig !== null
  const merged = mergeConfig(workspaceConfig, projectConfig)
  const sourcePaths = []
  if (workspaceConfig !== null) sourcePaths.push(workspacePath)
  if (projectConfig !== null && projectPath) sourcePaths.push(projectPath)
  return {
    exists,
    content: exists ? JSON.stringify(merged, null, 2) : null,
    fullPath: projectConfig !== null && projectPath ? projectPath : (workspaceConfig !== null ? workspacePath : null),
    sourceLabel: projectConfig !== null
      ? `工作区基座（workspace） + 项目命名空间（${resolveProjectName(projectName)}）`
      : (workspaceConfig !== null ? '工作区基座（workspace）' : '未命中'),
    sourcePaths,
    config: exists ? merged : null
  }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

function handleProfileLoad(args) {
  const names = (args.files && args.files.length > 0) ? args.files : STANDARD_FILES
  const parts = []
  const missing = []

  for (const name of names) {
    const resolved = resolveProfileFile(name, args.project)
    if (resolved) {
      const sourceLines = [
        `> 来源：${resolved.sourceLabel}`
      ]
      for (const sourcePath of resolved.sourcePaths || []) {
        sourceLines.push(`> 路径：${sourcePath}`)
      }
      parts.push(`### ${name}\n\n${sourceLines.join('\n')}\n\n${resolved.content}`)
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
  const resolved = resolveConfigFile(args.project)
  const raw = resolved?.content || null
  let mode = 'prod'
  let agent = DEFAULT_AGENT
  let profileAgent = null
  let agentSource = DEFAULT_AGENT === 'unknown-agent' ? 'unknown' : 'runtime'

  if (resolved?.config) {
    const cfg = resolved.config
    if (cfg.mode && typeof cfg.mode === 'string') mode = cfg.mode.toLowerCase() === 'dev' ? 'dev' : 'prod'
    profileAgent = normalizeAgent(cfg.agent) || null
    if (agent === 'unknown-agent' && profileAgent) {
      agent = profileAgent
      agentSource = 'profile-fallback'
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        mode,
        agent,
        agentSource,
        profileAgent,
        configExists: raw !== null,
        sourceRoot: resolved ? resolved.fullPath : null,
        sourceRoots: resolved?.sourcePaths || [],
        layoutMode: LAYOUT.mode,
        workspaceRoot: LAYOUT.workspaceRoot,
        project: resolveProjectName(args.project) || null
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
  const claudePath = path.join(LAYOUT.workspaceRoot, 'CLAUDE.md')
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
