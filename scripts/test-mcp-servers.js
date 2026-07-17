#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  CONTEXT_READ_CONTRACT,
  validateContextReadPlan
} = require('../hooks/_runtime/context-read-contract.cjs')

const ROOT = path.resolve(__dirname, '..')
const TEMP_ROOT = path.join(os.tmpdir(), `devcodex-mcp-test-${process.pid}`)

function rpcRequest(id, method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params })
}

function runServer(script, requests, cwd = ROOT, env = {}) {
  const input = requests.concat('').join('\n')
  const result = spawnSync(process.execPath, [path.join(ROOT, script), cwd], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${script} exited with failure`).trim())
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

function runConfiguredServer(server, requests, cwd = ROOT) {
  const command = server.command === 'node' ? process.execPath : server.command
  const input = requests.concat('').join('\n')
  const result = spawnSync(command, server.args || [], {
    cwd,
    input,
    encoding: 'utf8',
    shell: false
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${server.command} exited with failure`).trim())
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

function runProfileServerWithReadTrace(requests, cwd) {
  const wrapperPath = path.join(TEMP_ROOT, 'profile-read-trace-hook.cjs')
  const tracePath = path.join(TEMP_ROOT, `profile-read-trace-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`)
  fs.writeFileSync(wrapperPath, [
    "'use strict'",
    "const fs = require('fs')",
    "const originalReadFileSync = fs.readFileSync.bind(fs)",
    "fs.readFileSync = function tracedReadFileSync(file, ...args) {",
    "  try { fs.appendFileSync(process.env.DEVCODEX_READ_TRACE, JSON.stringify(String(file)) + '\\n') } catch {}",
    "  return originalReadFileSync(file, ...args)",
    "}"
  ].join('\n'))
  const input = requests.concat('').join('\n')
  const result = spawnSync(process.execPath, ['--require', wrapperPath, path.join(ROOT, 'mcp', 'profile-server.js'), cwd], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    env: { ...process.env, DEVCODEX_READ_TRACE: tracePath }
  })
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'profile trace server failed').trim())
  const responses = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  const reads = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    : []
  return { responses, reads }
}

function setupConfiguredMcpTarget() {
  const targetRoot = path.join(TEMP_ROOT, 'configured-target')
  fs.mkdirSync(path.join(targetRoot, '.claude', 'mcp'), { recursive: true })
  fs.mkdirSync(path.join(targetRoot, '.claude', 'hooks', '_runtime'), { recursive: true })
  const profileRoot = path.join(targetRoot, '.devcodex', 'profile')
  fs.mkdirSync(profileRoot, { recursive: true })
  fs.writeFileSync(path.join(profileRoot, 'README.md'), [
    '# Configured target Profile',
    '',
    '> Profile 档位：`profile-lite`。',
    '',
    '| 文件 | 说明 | 必须 |',
    '|------|------|:----:|',
    '| `01-项目信息.md` | project | ✅ |',
    '| `02-架构约束.md` | architecture | ✅ |',
    '| `03-代码风格.md` | style | ✅ |'
  ].join('\n'))
  for (const file of ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md']) {
    fs.writeFileSync(path.join(profileRoot, file), `# ${file}\n`)
  }
  fs.copyFileSync(path.join(ROOT, '.mcp.json'), path.join(targetRoot, '.mcp.json'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'memory-server.js'), path.join(targetRoot, '.claude', 'mcp', 'memory-server.js'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'profile-server.js'), path.join(targetRoot, '.claude', 'mcp', 'profile-server.js'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'path-guard.js'), path.join(targetRoot, '.claude', 'mcp', 'path-guard.js'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'profile-contract.js'), path.join(targetRoot, '.claude', 'mcp', 'profile-contract.js'))
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'workspace-layout.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'workspace-layout.cjs')
  )
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'context-read-contract.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'context-read-contract.cjs')
  )
  return targetRoot
}

function resultById(responses, id) {
  const response = responses.find(item => item.id === id)
  assert.ok(response, `missing JSON-RPC response id=${id}`)
  assert.ifError(response.error)
  return response.result
}

function toolJson(result) {
  const text = result.content?.[0]?.text || ''
  assert(text, 'expected a JSON MCP text result')
  return JSON.parse(text)
}

function profileReadBasenames(reads) {
  const profileSegment = `${path.sep}profile${path.sep}`.toLowerCase()
  return reads
    .map(item => path.resolve(item))
    .filter(item => item.toLowerCase().startsWith(path.resolve(TEMP_ROOT).toLowerCase()))
    .filter(item => item.toLowerCase().includes(profileSegment))
    .map(item => path.basename(item))
}

function setupLegacyWorkspace() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'profile'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'CLAUDE.md'), '# CLAUDE.md\n\nDevCodex rules\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', 'README.md'), '# Profile\n\n> Profile 档位：`profile-closed-loop`。\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '01-项目信息.md'), '# 01-项目信息\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '02-架构约束.md'), '# 02-架构约束\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '03-代码风格.md'), '# 03-代码风格\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '04-测试规范.md'), '# 04-测试规范\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '05-发布规范.md'), '# 05-发布规范\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '06-功能清单.md'), '# 06-功能清单\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '07-用户文档与契约规范.md'), '# 07-用户文档与契约规范\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'claude-code' })
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.local.json'),
    JSON.stringify({ connections: { local: { connectionString: 'postgres://local-user:local-password@127.0.0.1:5432/local' } } }, null, 2)
  )
}

function snapshotFiles(paths) {
  return paths.map(filePath => {
    const stat = fs.statSync(filePath)
    return {
      path: path.relative(TEMP_ROOT, filePath),
      content: fs.readFileSync(filePath, 'utf8'),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  })
}

function snapshotTree(root) {
  const files = []
  function visit(directory) {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(root)
  return snapshotFiles(files.sort())
}

function setupMemoryProjectionFixture() {
  setupLegacyWorkspace()
  const clientRoot = path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code')
  const tasksRoot = path.join(clientRoot, 'tasks')
  fs.mkdirSync(tasksRoot, { recursive: true })
  const todayPath = path.join(tasksRoot, '20260717.md')
  const yesterdayPath = path.join(tasksRoot, '20260716.md')
  const summaryPath = path.join(clientRoot, 'SUMMARY.md')
  const todayContent = [
    '# 2026-07-17 任务记录',
    '',
    '## 会话 02 - 已完成任务',
    '',
    '状态：✅ 已完成',
    '',
    'COMPLETED-BODY-SENTINEL',
    '',
    '### ContextHandoffCard',
    '',
    '- next-action：none',
    '',
    '## 会话 03 - 当前任务',
    '',
    '状态：🔄 进行中',
    '',
    '### ContextHandoffCard',
    '',
    '- next-action：STALE-NEXT-ACTION-MUST-NOT-LEAK',
    '',
    '### 工作正文',
    '',
    'ACTIVE-BODY-SENTINEL ' + 'x'.repeat(180),
    '',
    '### ContextHandoffCard',
    '',
    '- source-of-truth：CURRENT-SOURCE',
    '- next-action：NEXT-ACTION-SENTINEL',
    '- blocked-reason：none',
    '',
    '### 其他',
    '',
    'HANDOFF-TAIL-MUST-NOT-LEAK',
    ''
  ].join('\n')
  const yesterdayContent = [
    '# 2026-07-16 任务记录',
    '',
    '## 会话 04 - 阻塞任务',
    '',
    '状态：⛔ 阻塞',
    '',
    'BLOCKED-BODY-SENTINEL',
    ''
  ].join('\n')
  const summaryContent = [
    '# Agent SUMMARY — claude-code',
    '',
    '> 项目：fixture',
    '',
    '| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |',
    '|------|:----:|------|------|---------|---------|:----:|',
    '| 2026-07-14 09:00 | 01 | dev | completed fixture | — | — | ✅ |',
    '| 2026-07-16 10:00 | 04 | resume | blocked fixture | — | — | ⛔ |',
    '| 2026-07-17 10:00 | 03 | dev | active fixture with `manual|auto` mode | report-a | memory-a | 🔄 |',
    '| 2026-07-17 10:05 | 03 | dev | conflicting completed fixture | report-b | memory-b | ✅ |',
    '| 2026-07-17 10:06 | legacy descriptive session | analyze | historical label fixture | report-c | memory-c | ✅ |',
    ''
  ].join('\n')
  fs.writeFileSync(todayPath, todayContent)
  fs.writeFileSync(yesterdayPath, yesterdayContent)
  fs.writeFileSync(summaryPath, summaryContent)
  return {
    paths: [todayPath, yesterdayPath, summaryPath],
    todayPath,
    yesterdayPath,
    summaryPath,
    todayContent,
    yesterdayContent,
    summaryContent
  }
}

function fullDailyActiveSessionOracle(content) {
  return String(content).split(/(?=^##\s+会话\s+)/m)
    .filter(section => /^##\s+会话\s+/m.test(section) && /^状态[：:].*🔄/m.test(section))
    .map(section => {
      const match = /^##\s+会话\s+([^\s—-]+)/m.exec(section)
      return match ? match[1].padStart(2, '0') : ''
    })
    .filter(Boolean)
}

function fullSummaryUnresolvedOracle(content, since) {
  return String(content).split(/\r?\n/)
    .filter(line => /^\|\s*\d{4}-\d{2}-\d{2}/.test(line))
    .filter(line => !since || line.slice(1).trim().slice(0, 10) >= since)
    .filter(line => /(?:🔄|⛔)\s*\|\s*$/.test(line))
    .map(line => {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
      return `${cells[0].slice(0, 10)}#${cells[1].padStart(2, '0')}`
    })
    .reverse()
}

function setupLayoutWorkspace() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, 'chat'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'CLAUDE.md'), '# CLAUDE.md\n\nWorkspace rules\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
    JSON.stringify({ version: 1, mode: 'workspace-namespace' }, null, 2)
  )
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'README.md'), '# workspace README\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', '01-项目信息.md'), '# workspace 01\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', '02-架构约束.md'), '# workspace 02\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', '03-代码风格.md'), '# workspace 03\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'config.json'),
    JSON.stringify({ mode: 'prod', agent: 'claude-code', flags: { read: true, write: false }, tags: ['workspace'] }, null, 2)
  )
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', '03-代码风格.md'), '# chat 03\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', flags: { write: true }, tags: ['project'] }, null, 2)
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', 'config.local.json'),
    JSON.stringify({ connections: { reporting: { connectionString: 'postgres://reporting:local-password@127.0.0.1:5432/reporting' } } }, null, 2)
  )
}

function setupNestedLayoutWorkspace() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-a', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-b', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, 'packages', 'app-a'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, 'packages', 'app-b'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'packages', 'app-a', 'package.json'), '{}')
  fs.writeFileSync(path.join(TEMP_ROOT, 'packages', 'app-b', 'package.json'), '{}')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
    JSON.stringify({ version: 1, mode: 'workspace-namespace' }, null, 2)
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'config.json'),
    JSON.stringify({ mode: 'prod', agent: 'claude-code' }, null, 2)
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-a', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'claude-code', app: 'a' }, null, 2)
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-b', 'profile', 'config.json'),
    JSON.stringify({ mode: 'prod', agent: 'claude-code', app: 'b' }, null, 2)
  )
}

function setupContextPlanWorkspace({ uncatalogued = false } = {}) {
  setupLayoutWorkspace()
  const workspaceProfile = path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile')
  const projectProfile = path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile')
  const workspaceRows = [
    ['01-项目信息.md', 'project facts', '✅'],
    ['02-架构约束.md', 'architecture', '✅'],
    ['03-代码风格.md', 'style', '✅'],
    ['04-测试规范.md', 'tests', '✅'],
    ['05-发布规范.md', 'release', '✅'],
    ['06-功能清单.md', 'features', '✅'],
    ['07-用户文档与契约规范.md', 'docs', '✅'],
    ['08-服务约束.md', 'conditional service', '条件'],
    ['config.json', 'runtime mode', '按需']
  ]
  const table = rows => [
    '| 文件 | 说明 | 必须 |',
    '|------|------|:----:|',
    ...rows.map(([file, description, required]) => `| [\`${file}\`](${file}) | ${description} | ${required} |`)
  ].join('\n')
  fs.writeFileSync(path.join(workspaceProfile, 'README.md'), [
    '# workspace Profile',
    '',
    '> Profile 档位：`profile-closed-loop`。',
    '',
    'WORKSPACE-README-CATALOG-SENTINEL',
    '',
    '## 文件索引',
    '',
    table(workspaceRows)
  ].join('\n'))
  fs.writeFileSync(path.join(projectProfile, 'README.md'), [
    '# chat Profile',
    '',
    '> Profile 档位：`profile-closed-loop`。',
    '',
    'PROJECT-README-LOSSLESS-SENTINEL',
    '',
    '## 文件索引',
    '',
    table([['09-项目扩展.md', 'conditional project extension', '条件']])
  ].join('\n'))
  for (const file of ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md', '04-测试规范.md', '05-发布规范.md', '06-功能清单.md', '07-用户文档与契约规范.md', '08-服务约束.md']) {
    fs.writeFileSync(path.join(workspaceProfile, file), `# ${file}\n\nHIDDEN-BODY-${file}\n`)
  }
  fs.writeFileSync(path.join(projectProfile, '03-代码风格.md'), '# project style\n\nHIDDEN-PROJECT-03\n')
  fs.writeFileSync(path.join(projectProfile, '09-项目扩展.md'), '# project extension\n\nHIDDEN-PROJECT-09\n')
  fs.writeFileSync(path.join(projectProfile, 'config.local.json'), JSON.stringify({ sentinel: 'LOCAL-BODY-SENTINEL' }, null, 2))
  if (uncatalogued) fs.writeFileSync(path.join(projectProfile, '10-custom.md'), '# custom\n\nUNCATALOGUED-BODY-SENTINEL\n')
}

function testProfilePrompts() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'prompts/list'),
    rpcRequest(3, 'prompts/get', { name: 'devcodex-init' })
  ], TEMP_ROOT)

  const init = resultById(responses, 1)
  assert.ok(init.capabilities.tools)
  assert.ok(init.capabilities.prompts)

  const list = resultById(responses, 2)
  const initPrompt = list.prompts.find(prompt => prompt.name === 'devcodex-init')
  assert.ok(initPrompt)
  assert.ok(initPrompt.arguments.some(argument => argument.name === 'project'))

  const prompt = resultById(responses, 3)
  const text = prompt.messages?.[0]?.content?.text || ''
  assert.match(text, /CLAUDE\.md/)
  assert.match(text, /01-项目信息/)
  assert.match(text, /config\.local\.json/)
  assert.match(text, /PC0~PC7/)
}

function testProfilePromptRequiresProjectAtWorkspaceRoot() {
  setupLayoutWorkspace()
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'prompts/get', { name: 'devcodex-init' }),
    rpcRequest(2, 'prompts/get', { name: 'devcodex-init', arguments: { project: 'chat' } }),
    rpcRequest(3, 'tools/call', { name: 'profile_context_plan', arguments: { intent: 'chat' } }),
    rpcRequest(4, 'tools/call', { name: 'profile_context_plan', arguments: { intent: 'chat', project: '../escape' } })
  ], TEMP_ROOT)

  const ambiguous = resultById(responses, 1)
  assert.strictEqual(ambiguous.isError, true)
  assert.match(ambiguous.content?.[0]?.text || '', /project is required|workspace root/i)

  const explicit = resultById(responses, 2)
  assert.notStrictEqual(explicit.isError, true)
  assert.match(explicit.messages?.[0]?.content?.text || '', /项目命名空间（chat）/)
  const missingPlanTarget = resultById(responses, 3)
  assert.strictEqual(missingPlanTarget.isError, true)
  assert.strictEqual(toolJson(missingPlanTarget).errorCode, 'CONTEXT_ACTIVE_TARGET_MISMATCH')
  const traversalPlanTarget = resultById(responses, 4)
  assert.strictEqual(traversalPlanTarget.isError, true)
  assert.strictEqual(toolJson(traversalPlanTarget).errorCode, 'CONTEXT_ACTIVE_TARGET_MISMATCH')
}

function testProfileTierConflictRejected() {
  setupLegacyWorkspace()
  fs.appendFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', 'README.md'), '\nProfile 档位：profile-lite。\n', 'utf8')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', { name: 'profile_load', arguments: {} })
  ], TEMP_ROOT)
  const conflict = resultById(responses, 1)
  assert.strictEqual(conflict.isError, true)
  assert.match(conflict.content?.[0]?.text || '', /multiple profile tiers declared/i)
}

function testProfileModeFallbackAgent() {
  setupLegacyWorkspace()
  fs.rmSync(path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'), { force: true })
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} })
  ], TEMP_ROOT)

  assert.ok(resultById(responses, 1).capabilities.tools)
  const content = resultById(responses, 2).content?.[0]?.text || ''
  const payload = JSON.parse(content)
  assert.strictEqual(payload.mode, 'prod')
  assert.strictEqual(payload.agent, 'claude-code')
  assert.strictEqual(payload.configExists, false)
}

function testProfileAgentUsesRuntimeBeforeProfileFallback() {
  setupLegacyWorkspace()
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'codex' })
  )
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} })
  ], TEMP_ROOT)

  const content = resultById(responses, 2).content?.[0]?.text || ''
  const payload = JSON.parse(content)
  assert.strictEqual(payload.mode, 'dev')
  assert.strictEqual(payload.agent, 'claude-code')
  assert.strictEqual(payload.agentSource, 'runtime')
  assert.strictEqual(payload.profileAgent, 'codex')
}

function testMemoryDefaultAgent() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', content: '# session\n' }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { row: '| 2026-05-24 | #1 | test | mcp | — | — | ✅ |' }
    })
  ], TEMP_ROOT)

  assert.ok(resultById(responses, 1).capabilities.tools)
  assert.ok(resultById(responses, 2).content[0].text.includes('claude-code'))
  assert.ok(resultById(responses, 3).content[0].text.includes('SUMMARY.md'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'SUMMARY.md'
  )))
  const summaryPath = path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'SUMMARY.md')
  const summary = fs.readFileSync(summaryPath, 'utf8')
  assert.ok(summary.includes('# Agent SUMMARY — claude-code'))
  assert.ok(summary.includes('> 项目：'))
  assert.ok(summary.includes('|------|:----:|------|------|---------|---------|:----:|'))
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude')))
}

function testMemoryActualHostEnvAgent() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', content: '# session\n' }
    })
  ], TEMP_ROOT, { DEVCODEX_AGENT: 'codex' })

  assert.ok(resultById(responses, 1).capabilities.tools)
  assert.ok(resultById(responses, 2).content[0].text.includes('codex'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', '.memory', 'clients', 'codex', 'tasks', '20260524.md'
  )))
  assert.ok(!fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
}

function testMemoryCpConfirmForBugs() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: { requirement: 'Bug任务', kind: 'bugs', phase: 'CP2', time: '10:30' }
    })
  ], TEMP_ROOT)

  assert.ok(resultById(responses, 1).capabilities.tools)
  const text = resultById(responses, 2).content?.[0]?.text || ''
  assert.match(text, /CP2/)
  const sessionsPath = path.join(TEMP_ROOT, '.devcodex', 'bugs', 'Bug任务', '.memory', 'sessions.md')
  assert.ok(fs.existsSync(sessionsPath))
  const sessions = fs.readFileSync(sessionsPath, 'utf8')
  assert.match(sessions, /\| CP2 \| ✅ \| 10:30 \|/)
}

function testMemoryCpConfirmForExtendedTaskKinds() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: { requirement: '性能任务', kind: 'optimizations', phase: 'CP3', time: '11:00' }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: { requirement: '场景测试任务', kind: 'scenario-tests', phase: 'CP3', time: '11:05' }
    })
  ], TEMP_ROOT)

  assert.ok(resultById(responses, 1).capabilities.tools)
  assert.match(resultById(responses, 2).content?.[0]?.text || '', /CP3/)
  assert.match(resultById(responses, 3).content?.[0]?.text || '', /CP3/)
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'optimizations', '性能任务', '.memory', 'sessions.md')))
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'scenario-tests', '场景测试任务', '.memory', 'sessions.md')))
}

function testMemoryProjectionQueriesAndZeroWrite() {
  const fixture = setupMemoryProjectionFixture()
  const memoryRoot = path.join(TEMP_ROOT, '.devcodex', '.memory')
  const before = snapshotTree(memoryRoot)
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', { name: 'memory_status', arguments: { limit: 2 } }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', sessionId: '03', limit: 1, maxChars: 12000 }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', sessionId: '03', handoffOnly: true }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', status: 'active', limit: 20, maxChars: 50000 }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', sessionId: '03', maxChars: 40 }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260715', sessionId: '99' }
    }),
    rpcRequest(8, 'tools/call', { name: 'memory_summary_query', arguments: {} }),
    rpcRequest(9, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'unresolved', since: '2026-07-16', limit: 50 }
    }),
    rpcRequest(10, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'all', limit: 2 }
    }),
    rpcRequest(11, 'tools/call', {
      name: 'memory_session_read',
      arguments: { date: '20260717' }
    }),
    rpcRequest(12, 'tools/call', { name: 'memory_summary_read', arguments: {} })
  ], TEMP_ROOT)

  const tools = resultById(responses, 1).tools
  const toolNames = tools.map(tool => tool.name)
  for (const name of ['memory_status', 'memory_session_query', 'memory_summary_query']) {
    assert(toolNames.includes(name), `missing additive memory tool: ${name}`)
  }
  assert(toolNames.includes('memory_session_read'))
  assert(toolNames.includes('memory_session_write'))
  assert.strictEqual(
    tools.find(tool => tool.name === 'memory_status').inputSchema.properties.limit.maximum,
    20
  )
  assert.strictEqual(
    tools.find(tool => tool.name === 'memory_session_query').inputSchema.properties.maxChars.maximum,
    50000
  )
  assert.strictEqual(
    tools.find(tool => tool.name === 'memory_summary_query').inputSchema.properties.limit.maximum,
    50
  )

  const status = toolJson(resultById(responses, 2))
  assert.strictEqual(status.schemaVersion, 'MemoryStatusV1')
  assert.strictEqual(status.activeRoot, path.join(TEMP_ROOT, '.devcodex'))
  assert.strictEqual(status.project, path.basename(TEMP_ROOT))
  assert.strictEqual(status.agent, 'claude-code')
  assert.match(status.today.date, /^\d{8}$/)
  assert.strictEqual(status.summary.exists, true)
  assert.strictEqual(status.latestRows.length, 2)
  assert.strictEqual(status.latestRows[0].summary, 'historical label fixture')
  assert(status.activeSessionIds.includes('2026-07-17#03'))
  assert.deepStrictEqual(status.conflicts, [{ sessionKey: '2026-07-17#03', states: ['active', 'completed'] }])
  assert.strictEqual(status.telemetry.filesRead, 1)
  assert.strictEqual(status.telemetry.tokens, null)

  const exact = toolJson(resultById(responses, 3))
  assert.strictEqual(exact.schemaVersion, 'MemorySessionQueryV1')
  assert.strictEqual(exact.query.sessionId, '03')
  assert.strictEqual(exact.source.activeRoot, path.join(TEMP_ROOT, '.devcodex'))
  assert.strictEqual(exact.matches.length, 1)
  assert.strictEqual(exact.matches[0].sessionId, '03')
  assert.match(exact.matches[0].content, /ACTIVE-BODY-SENTINEL/)
  assert.doesNotMatch(exact.matches[0].content, /COMPLETED-BODY-SENTINEL/)
  assert.strictEqual(exact.truncated, false)

  const handoff = toolJson(resultById(responses, 4))
  assert.strictEqual(handoff.query.handoffOnly, true)
  assert.strictEqual(handoff.matches.length, 1)
  assert.match(handoff.matches[0].content, /ContextHandoffCard/)
  assert.match(handoff.matches[0].content, /NEXT-ACTION-SENTINEL/)
  assert.doesNotMatch(handoff.matches[0].content, /STALE-NEXT-ACTION|ACTIVE-BODY-SENTINEL|HANDOFF-TAIL-MUST-NOT-LEAK/)
  assert(handoff.matches[0].content.length < fixture.todayContent.length)

  const active = toolJson(resultById(responses, 5))
  assert.deepStrictEqual(
    active.matches.map(item => item.sessionId),
    fullDailyActiveSessionOracle(fixture.todayContent),
    'bounded active-session result must match the independent full-file oracle'
  )

  const truncated = toolJson(resultById(responses, 6))
  assert.strictEqual(truncated.matches[0].content.length, 40)
  assert.strictEqual(truncated.matches[0].truncated, true)
  assert.strictEqual(truncated.truncated, true)

  const empty = toolJson(resultById(responses, 7))
  assert.deepStrictEqual(empty.matches, [])
  assert.strictEqual(empty.source.exists, false)
  assert.strictEqual(empty.truncated, false)

  const defaultSummary = toolJson(resultById(responses, 8))
  assert.strictEqual(defaultSummary.schemaVersion, 'MemorySummaryQueryV1')
  assert.strictEqual(defaultSummary.query.status, 'active')
  assert.strictEqual(defaultSummary.totalMatched, 1)
  assert.strictEqual(defaultSummary.rows[0].state, 'active')
  assert.strictEqual(defaultSummary.rows[0].summary, 'active fixture with `manual|auto` mode')

  const unresolved = toolJson(resultById(responses, 9))
  assert.deepStrictEqual(
    unresolved.rows.map(row => `${row.day}#${row.sessionId}`),
    fullSummaryUnresolvedOracle(fixture.summaryContent, '2026-07-16'),
    'bounded unresolved SUMMARY result must match the independent full-file oracle'
  )
  const lastTwo = toolJson(resultById(responses, 10))
  assert.strictEqual(lastTwo.rows.length, 2)
  assert.deepStrictEqual(lastTwo.rows.map(row => row.summary), [
    'historical label fixture',
    'conflicting completed fixture',
  ])
  assert.strictEqual(lastTwo.truncated, true)

  assert.strictEqual(resultById(responses, 11).content[0].text, fixture.todayContent)
  assert.strictEqual(resultById(responses, 12).content[0].text, fixture.summaryContent)
  assert.deepStrictEqual(snapshotTree(memoryRoot), before, 'all new memory projection tools must be zero-write')
}

function testMemoryProjectionErrorsAndMalformedSources() {
  const fixture = setupMemoryProjectionFixture()
  fs.appendFileSync(fixture.summaryPath, '| malformed |\n')
  const malformedDaily = path.join(path.dirname(fixture.todayPath), '20260718.md')
  fs.writeFileSync(malformedDaily, '# malformed daily\n\n状态：🔄 进行中\n')
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', { name: 'memory_status', arguments: { limit: 21 } }),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260230' }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', maxChars: 50001 }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { since: '2026-02-30' }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { unknown: true }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'memory_status',
      arguments: { agent: 'codex ' }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'pending-ish' }
    }),
    rpcRequest(8, 'tools/call', { name: 'memory_status', arguments: [] }),
    rpcRequest(9, 'tools/call', { name: 'memory_summary_query', arguments: { status: 'all' } }),
    rpcRequest(10, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260718', status: 'active' }
    })
  ], TEMP_ROOT)

  for (let id = 1; id <= 8; id += 1) {
    const result = resultById(responses, id)
    assert.strictEqual(result.isError, true)
    const error = toolJson(result)
    assert.strictEqual(error.schemaVersion, 'ContextReadErrorV1')
    assert.strictEqual(error.errorCode, 'MEMORY_QUERY_INVALID')
    assert(error.message)
    assert(error.nextStep)
  }
  const malformed = toolJson(resultById(responses, 9))
  assert.strictEqual(malformed.schemaVersion, 'MemorySummaryQueryV1')
  assert(malformed.warnings.some(item => /malformed SUMMARY row/.test(item)))
  const malformedSession = toolJson(resultById(responses, 10))
  assert.deepStrictEqual(malformedSession.matches, [])
  assert(malformedSession.warnings.some(item => /No canonical session headings/.test(item)))
}

function testMemoryProjectionLayoutTargets() {
  setupLayoutWorkspace()
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', { name: 'memory_status', arguments: {} }),
    rpcRequest(2, 'tools/call', { name: 'memory_status', arguments: { project: 'chat' } }),
    rpcRequest(3, 'tools/call', { name: 'memory_summary_query', arguments: { scope: 'workspace' } }),
    rpcRequest(4, 'tools/call', { name: 'memory_status', arguments: { project: '..\\escape' } })
  ], TEMP_ROOT)

  const ambiguous = resultById(responses, 1)
  assert.strictEqual(ambiguous.isError, true)
  assert.strictEqual(toolJson(ambiguous).errorCode, 'MEMORY_SCOPE_AMBIGUOUS')

  const project = toolJson(resultById(responses, 2))
  assert.strictEqual(project.activeRoot, path.join(TEMP_ROOT, '.devcodex', 'chat'))
  assert.strictEqual(project.project, 'chat')
  assert.strictEqual(project.summary.exists, false)

  const workspace = toolJson(resultById(responses, 3))
  assert.strictEqual(workspace.source.activeRoot, path.join(TEMP_ROOT, '.devcodex', 'workspace'))
  assert.strictEqual(workspace.source.project, '')

  const traversal = resultById(responses, 4)
  assert.strictEqual(traversal.isError, true)
  assert.strictEqual(toolJson(traversal).errorCode, 'MEMORY_QUERY_INVALID')
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'escape')))
}

function testMemoryProjectionAgentAmbiguity() {
  setupMemoryProjectionFixture()
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'codex'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'copilot'), { recursive: true })
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', { name: 'memory_status', arguments: {} }),
    rpcRequest(2, 'tools/call', { name: 'memory_status', arguments: { agent: 'codex' } }),
    rpcRequest(3, 'tools/call', { name: 'memory_status', arguments: {} })
  ], TEMP_ROOT, { DEVCODEX_AGENT: 'codex' })

  const explicitMissing = toolJson(resultById(responses, 2))
  assert.strictEqual(explicitMissing.agent, 'codex')
  assert.strictEqual(explicitMissing.summary.exists, false)
  const runtimePinned = toolJson(resultById(responses, 3))
  assert.strictEqual(runtimePinned.agent, 'codex')

  const unpinned = runServer('mcp/memory-server.js', [
    rpcRequest(4, 'tools/call', { name: 'memory_status', arguments: {} })
  ], TEMP_ROOT, { DEVCODEX_AGENT: '' })
  const ambiguous = resultById(unpinned, 4)
  assert.strictEqual(ambiguous.isError, true)
  const error = toolJson(ambiguous)
  assert.strictEqual(error.schemaVersion, 'ContextReadErrorV1')
  assert.strictEqual(error.errorCode, 'MEMORY_SCOPE_AMBIGUOUS')
  assert.match(error.message, /claude-code, codex, copilot/)
}

function testWorkspaceNamespaceProfileMerge() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md', '03-代码风格.md', 'config.json', 'config.local.json'] }
    })
  ], projectRoot)

  const payload = JSON.parse(resultById(responses, 2).content?.[0]?.text || '{}')
  assert.strictEqual(payload.layoutMode, 'workspace-namespace')
  assert.strictEqual(payload.project, 'chat')
  assert.strictEqual(payload.mode, 'dev')
  assert.strictEqual(payload.agent, 'claude-code')
  assert.deepStrictEqual(payload.sourceRoots.map(item => path.basename(path.dirname(item))), ['profile', 'profile'])

  const profileText = resultById(responses, 3).content?.[0]?.text || ''
  assert.match(profileText, /工作区基座（workspace）/)
  assert.match(profileText, /项目命名空间（chat）/)
  assert.match(profileText, /"tags": \[/)
  assert.match(profileText, /connectionString/)
}

function testProfileLoadWithoutArguments() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_load' }),
    rpcRequest(3, 'tools/call', { name: 'profile_load', arguments: null }),
    rpcRequest(4, 'tools/call', { name: 'profile_load', arguments: {} })
  ], TEMP_ROOT)

  const snapshots = []
  for (const id of [2, 3, 4]) {
    const result = resultById(responses, id)
    snapshots.push(result)
    assert.notStrictEqual(result.isError, true)
    const text = result.content?.[0]?.text || ''
    assert.match(text, /01-项目信息/)
    assert.match(text, /06-功能清单/)
    assert.match(text, /07-用户文档与契约规范/)
    assert.match(text, /config\.local\.json/)
    assert.doesNotMatch(text, /invoke|TypeError/i)
  }
  assert.deepStrictEqual(snapshots[1], snapshots[0], 'profile_load missing/null/empty arguments must keep one legacy snapshot')
  assert.deepStrictEqual(snapshots[2], snapshots[0], 'profile_load missing/null/empty arguments must keep one legacy snapshot')
}

function testProfileContextPlanContract() {
  setupContextPlanWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat' }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', project: 'chat', contextEpoch: 'epoch-missing-change-types' }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-dev-plan' }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-dev-plan' }
    })
  ], projectRoot)

  const tools = resultById(responses, 1).tools
  const planTool = tools.find(tool => tool.name === 'profile_context_plan')
  assert(planTool)
  assert.deepStrictEqual(planTool.inputSchema.required, ['intent'])
  assert.deepStrictEqual(planTool.inputSchema.properties.intent.enum, CONTEXT_READ_CONTRACT.intents)
  assert(tools.some(tool => tool.name === 'profile_load'))
  assert(tools.some(tool => tool.name === 'profile_get_mode'))

  const chatResult = resultById(responses, 2)
  assert.notStrictEqual(chatResult.isError, true)
  const chatPlan = toolJson(chatResult)
  assert.strictEqual(validateContextReadPlan(chatPlan).valid, true)
  assert.match(chatPlan.identity.contextEpoch, /^ctx-/)
  assert.strictEqual(chatPlan.identity.project, 'chat')
  assert.strictEqual(chatPlan.baselineContext.readme.content.includes('PROJECT-README-LOSSLESS-SENTINEL'), true)
  assert.strictEqual(chatPlan.baselineContext.readme.content.includes('WORKSPACE-README-CATALOG-SENTINEL'), false)
  assert.deepStrictEqual(
    chatPlan.baselineContext.readme.sourceRefs.map(ref => ref.layer).sort(),
    ['project:chat', 'workspace'],
    'lossless effective README content must retain every catalog-contributing source reference'
  )
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.flags.read, true)
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.flags.write, true)
  assert.deepStrictEqual(chatPlan.baselineContext.effectiveConfig.tags, ['project'])
  assert(chatPlan.baselineContext.catalog.some(item => item.file === '08-服务约束.md'))
  assert(chatPlan.baselineContext.catalog.some(item => item.file === '09-项目扩展.md'))
  assert.strictEqual(chatPlan.catalogCoverage.unclassifiedIds.length, 0)
  const candidateIds = new Set(chatPlan.baselineContext.inventory.map(item => `profile:${item.file}`))
  const coverageIds = new Set([
    ...chatPlan.catalogCoverage.selectedIds,
    ...chatPlan.catalogCoverage.excludedIds,
    ...chatPlan.catalogCoverage.unclassifiedIds
  ])
  assert.deepStrictEqual([...coverageIds].sort(), [...candidateIds].sort(), 'every bounded Profile candidate needs one coverage class')

  const missingChangeResult = resultById(responses, 3)
  assert.strictEqual(missingChangeResult.isError, true)
  assert.strictEqual(toolJson(missingChangeResult).errorCode, 'CONTEXT_CHANGE_TYPES_REQUIRED')

  const devPlan = toolJson(resultById(responses, 4))
  const repeatedDevPlan = toolJson(resultById(responses, 5))
  assert.strictEqual(validateContextReadPlan(devPlan).valid, true)
  assert.deepStrictEqual(devPlan.profile.selectedFiles, ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md'])
  assert.strictEqual(devPlan.planId, repeatedDevPlan.planId, 'same epoch/scope must keep a stable planId')
  assert(Number.isFinite(devPlan.planningTelemetry.latencyMs))
  const serialized = JSON.stringify(devPlan)
  assert.doesNotMatch(serialized, /HIDDEN-BODY-|HIDDEN-PROJECT-03|LOCAL-BODY-SENTINEL/)
  const styleSource = devPlan.selectedSources.find(source => source.selector === '03-代码风格.md')
  assert(styleSource.sourceRefs.every(ref => ref.layer === 'project:chat'))
}

function testProfileContextPlanConditionalSelectors() {
  setupContextPlanWorkspace({ uncatalogued: true })
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const initial = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan' }
    })
  ], projectRoot)
  const initialPlan = toolJson(resultById(initial, 1))
  assert.strictEqual(initialPlan.exitCondition, 'blocked')
  assert.deepStrictEqual(initialPlan.catalogCoverage.unclassifiedIds, ['profile:10-custom.md'])
  const baselineDigest = initialPlan.baselineContext.baselineDigest
  const selector = {
    file: '10-custom.md',
    reason: 'The current task explicitly targets this custom Profile document.',
    authority: 'user-confirmed-task-scope'
  }
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(2, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest, profileSelectors: [selector] }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest, profileSelectors: [selector] }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest: 'stale', profileSelectors: [selector] }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest,
        profileSelectors: [{ file: '../10-custom.md', reason: 'bad', authority: 'user' }]
      }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest,
        profileSelectors: [{ file: '08-服务约束.md', reason: 'Service work is in scope.', authority: 'project-profile' }]
      }
    })
  ], projectRoot)
  const selected = toolJson(resultById(responses, 2))
  const repeated = toolJson(resultById(responses, 3))
  assert.strictEqual(validateContextReadPlan(selected).valid, true)
  assert.deepStrictEqual(selected.profile.selectedFiles, ['10-custom.md'])
  assert.strictEqual(selected.catalogCoverage.unclassifiedIds.length, 0)
  assert.strictEqual(selected.planId, repeated.planId, 'identical conditional replan must be stable')
  assert.strictEqual(resultById(responses, 4).isError, true)
  assert.strictEqual(toolJson(resultById(responses, 4)).errorCode, 'CONTEXT_BASELINE_STALE')
  assert.strictEqual(resultById(responses, 5).isError, true)
  assert.strictEqual(toolJson(resultById(responses, 5)).errorCode, 'CONTEXT_PLAN_INVALID')
  const servicePlan = toolJson(resultById(responses, 6))
  assert(servicePlan.profile.selectedFiles.includes('08-服务约束.md'))
  assert(servicePlan.catalogCoverage.unclassifiedIds.includes('profile:10-custom.md'), 'an unrelated uncatalogued file must not be silently excluded')
}

function testProfileContextPlanLocalPolicyAndFullEscalation() {
  setupContextPlanWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'dev', changeTypes: ['config'], project: 'chat', contextEpoch: 'epoch-local-policy', configLocalRequested: true
      }
    }),
    rpcRequest(2, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', project: 'chat', contextEpoch: 'epoch-low-confidence', confidence: 0.4 }
    })
  ], projectRoot)
  const localPlan = toolJson(resultById(responses, 1))
  assert(localPlan.profile.selectedFiles.includes('config.local.json'))
  assert.doesNotMatch(JSON.stringify(localPlan), /LOCAL-BODY-SENTINEL/)
  const load = runServer('mcp/profile-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: { project: 'chat', files: localPlan.profile.selectedFiles }
    })
  ], projectRoot)
  assert.match(resultById(load, 3).content?.[0]?.text || '', /LOCAL-BODY-SENTINEL/)
  const fullPlan = toolJson(resultById(responses, 2))
  assert.strictEqual(fullPlan.fullRead, true)
  assert.strictEqual(fullPlan.fullReadReason, 'low-confidence')
  assert(!fullPlan.profile.selectedFiles.includes('config.local.json'), 'full escalation must not bypass local policy')
}

function testProfileContextPlanReadTrace() {
  setupContextPlanWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const planned = runProfileServerWithReadTrace([
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-read-trace' }
    })
  ], projectRoot)
  const plan = toolJson(resultById(planned.responses, 1))
  const planReadNames = profileReadBasenames(planned.reads)
  assert(planReadNames.length > 0)
  for (const file of planReadNames) {
    assert(['README.md', 'config.json'].includes(file), `plan hidden-read detected: ${file}`)
  }

  const invalid = runProfileServerWithReadTrace([
    rpcRequest(2, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'docs', project: 'chat' }
    })
  ], projectRoot)
  assert.strictEqual(resultById(invalid.responses, 2).isError, true)
  assert.deepStrictEqual(profileReadBasenames(invalid.reads), [], 'invalid intent must fail before Profile body acquisition')

  const invalidSelector = runProfileServerWithReadTrace([
    rpcRequest(21, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'chat', project: 'chat', baselineDigest: 'not-reached',
        profileSelectors: [{ file: '08-服务约束.md', authority: 'project-profile' }]
      }
    })
  ], projectRoot)
  assert.strictEqual(resultById(invalidSelector.responses, 21).isError, true)
  assert.strictEqual(toolJson(resultById(invalidSelector.responses, 21)).errorCode, 'CONTEXT_PLAN_INVALID')
  assert.deepStrictEqual(
    profileReadBasenames(invalidSelector.reads),
    [],
    'invalid selector evidence must fail before Profile body acquisition'
  )

  const targeted = runProfileServerWithReadTrace([
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: { project: 'chat', files: plan.profile.selectedFiles }
    })
  ], projectRoot)
  const targetedNames = [...new Set(profileReadBasenames(targeted.reads))].sort()
  assert.deepStrictEqual(targetedNames, [...plan.profile.selectedFiles].sort(), 'targeted loader trace must equal plan.selectedFiles')

  const localPlanTrace = runProfileServerWithReadTrace([
    rpcRequest(4, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'dev', changeTypes: ['config'], project: 'chat', contextEpoch: 'epoch-local-trace', configLocalRequested: true
      }
    })
  ], projectRoot)
  assert(!profileReadBasenames(localPlanTrace.reads).includes('config.local.json'), 'plan may select local metadata but must not read local content')

  const legacy = runProfileServerWithReadTrace([
    rpcRequest(5, 'tools/call', { name: 'profile_load', arguments: { project: 'chat' } })
  ], projectRoot)
  const legacyNames = new Set(profileReadBasenames(legacy.reads))
  for (const file of ['README.md', '01-项目信息.md', '06-功能清单.md', '07-用户文档与契约规范.md', 'config.local.json']) {
    assert(legacyNames.has(file), `legacy full-read compatibility trace lost ${file}`)
  }
}

function testWorkspaceNamespaceMemoryScope() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', content: '# session\n' }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { scope: 'workspace', row: '| 2026-05-24 | #1 | test | workspace | — | — | ✅ |' }
    })
  ], projectRoot)

  assert.ok(resultById(responses, 2).content[0].text.includes('chat'))
  assert.ok(resultById(responses, 3).content[0].text.includes('SUMMARY.md'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'chat', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'clients', 'claude-code', 'SUMMARY.md'
  )))
  const workspaceSummary = fs.readFileSync(path.join(
    TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'clients', 'claude-code', 'SUMMARY.md'
  ), 'utf8')
  assert.ok(workspaceSummary.includes('# Agent SUMMARY — claude-code'))
  assert.ok(workspaceSummary.includes('> 项目：workspace'))
  assert.ok(workspaceSummary.includes('|------|:----:|------|------|---------|---------|:----:|'))
}

function testWorkspaceRootMemoryScopeRequiresExplicitTarget() {
  setupLayoutWorkspace()
  const ambiguous = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', content: '# ambiguous\n' }
    })
  ], TEMP_ROOT)

  const ambiguousResult = resultById(ambiguous, 2)
  assert.strictEqual(ambiguousResult.isError, true)
  assert.match(ambiguousResult.content?.[0]?.text || '', /ambiguous|project|workspace/i)
  assert.ok(!fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))

  const explicitWorkspace = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { scope: 'workspace', row: '| 2026-05-24 | #2 | test | explicit workspace | — | — | ✅ |' }
    })
  ], TEMP_ROOT)
  assert.ok(resultById(explicitWorkspace, 3).content[0].text.includes('SUMMARY.md'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'clients', 'claude-code', 'SUMMARY.md'
  )))

  const explicitProject = runServer('mcp/memory-server.js', [
    rpcRequest(4, 'tools/call', {
      name: 'memory_session_write',
      arguments: { project: 'chat', date: '20260524', content: '# project\n' }
    })
  ], TEMP_ROOT)
  assert.ok(resultById(explicitProject, 4).content[0].text.includes('chat'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'chat', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
}

function testWorkspaceNamespaceNestedProjectInference() {
  setupNestedLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'packages', 'app-a')
  const profileResponses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} })
  ], projectRoot)
  const profilePayload = JSON.parse(resultById(profileResponses, 2).content?.[0]?.text || '{}')
  assert.strictEqual(profilePayload.project, 'packages/app-a')
  assert.strictEqual(profilePayload.mode, 'dev')

  const memoryResponses = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', content: '# nested\n' }
    })
  ], projectRoot)
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'packages', 'app-a', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
  assert.ok(!fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'packages', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
  assert.match(resultById(memoryResponses, 3).content?.[0]?.text || '', /packages[\\/]+app-a|packages\/app-a/)
}

function testWorkspaceNamespaceTraversalRejected() {
  setupLayoutWorkspace()
  const profileResponses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'profile_load',
      arguments: { project: '..\\..\\leak2', files: ['01-项目信息.md'] }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(profileResponses, 2).isError, true)
  assert.match(resultById(profileResponses, 2).content?.[0]?.text || '', /traversal|workspace-relative|reserved|namespace/i)

  const memoryResponses = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_write',
      arguments: { project: '..\\..\\escape-probe', date: '20260524', content: '# blocked\n' }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(memoryResponses, 3).isError, true)
  assert.match(resultById(memoryResponses, 3).content?.[0]?.text || '', /traversal|workspace-relative|reserved|namespace/i)
}

function testAdjacentMcpPathArgumentsRejected() {
  setupLegacyWorkspace()
  const memoryCases = [
    { name: 'memory_session_write', arguments: { agent: '../escape', date: '20260524', content: '# blocked\n' } },
    { name: 'memory_session_write', arguments: { agent: '..\\escape', date: '20260524', content: '# blocked\n' } },
    { name: 'memory_session_write', arguments: { agent: 'C:\\escape', date: '20260524', content: '# blocked\n' } },
    { name: 'memory_session_write', arguments: { agent: 'codex ', date: '20260524', content: '# blocked\n' } },
    { name: 'memory_session_write', arguments: { agent: 'codex\nother', date: '20260524', content: '# blocked\n' } },
    { name: 'memory_session_write', arguments: { agent: 'codex', date: '../escape', content: '# blocked\n' } },
    { name: 'memory_cp_confirm', arguments: { requirement: '../escape', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: '..\\escape', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: 'C:\\escape', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: 'escape/nested', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: 'escape ', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: 'escape\nother', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_summary_append', arguments: { agent: 'codex\\other', row: '| blocked |' } }
  ]
  const memoryResponses = runServer('mcp/memory-server.js', memoryCases.map((item, index) =>
    rpcRequest(index + 1, 'tools/call', item)
  ), TEMP_ROOT)
  for (let id = 1; id <= memoryCases.length; id += 1) {
    const result = resultById(memoryResponses, id)
    assert.strictEqual(result.isError, true)
    assert.match(result.content?.[0]?.text || '', /invalid|allowed root|YYYYMMDD/i)
  }
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'escape')))

  const profileCases = [
    '../outside.md',
    '..\\outside.md',
    'C:\\outside.md',
    'nested/outside.md',
    'outside.md ',
    'outside\nother.md'
  ]
  const profileResponses = runServer('mcp/profile-server.js', profileCases.map((file, index) =>
    rpcRequest(100 + index, 'tools/call', {
      name: 'profile_load',
      arguments: { files: [file] }
    })
  ), TEMP_ROOT)
  for (let index = 0; index < profileCases.length; index += 1) {
    const result = resultById(profileResponses, 100 + index)
    assert.strictEqual(result.isError, true)
    assert.match(result.content?.[0]?.text || '', /invalid|allowed root/i)
  }
}

function testMcpJsonLaunchContract() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'))
  const servers = config.mcpServers || {}
  const targetRoot = setupConfiguredMcpTarget()
  const expected = {
    'devcodex-memory': '.claude/mcp/memory-server.js',
    'devcodex-profile': '.claude/mcp/profile-server.js'
  }

  for (const [name, scriptPath] of Object.entries(expected)) {
    const server = servers[name]
    assert.ok(server, `.mcp.json missing ${name}`)
    assert.strictEqual(server.command, 'node')
    assert.deepStrictEqual(server.args, [scriptPath, '.'])
    assert.ok(!server.args.some(arg => /\$\{/.test(arg)), `${name} args must not require shell expansion`)

    const requests = [rpcRequest(90, 'initialize')]
    if (name === 'devcodex-profile') {
      requests.push(
        rpcRequest(91, 'tools/list'),
        rpcRequest(92, 'tools/call', {
          name: 'profile_context_plan',
          arguments: { intent: 'chat', contextEpoch: 'configured-target-plan' }
        })
      )
    } else {
      requests.push(
        rpcRequest(91, 'tools/list'),
        rpcRequest(92, 'tools/call', { name: 'memory_status', arguments: {} })
      )
    }
    const responses = runConfiguredServer(server, requests, targetRoot)
    assert.strictEqual(resultById(responses, 90).serverInfo.name, name)
    if (name === 'devcodex-profile') {
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'profile_context_plan'))
      const configuredPlan = toolJson(resultById(responses, 92))
      assert.strictEqual(validateContextReadPlan(configuredPlan).valid, true)
      assert.strictEqual(configuredPlan.identity.project, 'configured-target')
    } else {
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'memory_status'))
      const configuredStatus = toolJson(resultById(responses, 92))
      assert.strictEqual(configuredStatus.schemaVersion, 'MemoryStatusV1')
      assert.strictEqual(configuredStatus.project, 'configured-target')
      assert.strictEqual(configuredStatus.activeRoot, path.join(targetRoot, '.devcodex'))
    }
  }
}

testProfilePrompts()
testProfilePromptRequiresProjectAtWorkspaceRoot()
testProfileTierConflictRejected()
testProfileModeFallbackAgent()
testProfileAgentUsesRuntimeBeforeProfileFallback()
testMemoryDefaultAgent()
testMemoryActualHostEnvAgent()
testMemoryCpConfirmForBugs()
testMemoryCpConfirmForExtendedTaskKinds()
testMemoryProjectionQueriesAndZeroWrite()
testMemoryProjectionErrorsAndMalformedSources()
testMemoryProjectionLayoutTargets()
testMemoryProjectionAgentAmbiguity()
testWorkspaceNamespaceProfileMerge()
testProfileLoadWithoutArguments()
testProfileContextPlanContract()
testProfileContextPlanConditionalSelectors()
testProfileContextPlanLocalPolicyAndFullEscalation()
testProfileContextPlanReadTrace()
testWorkspaceNamespaceMemoryScope()
testWorkspaceRootMemoryScopeRequiresExplicitTarget()
testWorkspaceNamespaceNestedProjectInference()
testWorkspaceNamespaceTraversalRejected()
testAdjacentMcpPathArgumentsRejected()
testMcpJsonLaunchContract()
fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
process.stdout.write('mcp servers smoke test passed\n')
