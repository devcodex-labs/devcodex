#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { listControlDeliveryEntries } = require('./lib/control-content-delivery')
const {
  buildExtendedCpTable,
  parseCpSessions
} = require('./lib/cp-digest')
const {
  CONTEXT_READ_CONTRACT,
  validateContextReadPlan
} = require('../hooks/_runtime/context-read-contract.cjs')
const {
  buildJsonContentIdentity,
  validateContentIdentity
} = require('../hooks/_runtime/content-identity.cjs')
const {
  createOptimizationState,
  persistOptimizationState
} = require('./lib/execution-optimization')
const { CLAUDE_MCP_JSON } = require('../index.js')

const ROOT = path.resolve(__dirname, '..')
const TEMP_ROOT = path.join(os.tmpdir(), `devcodex-mcp-test-${process.pid}`)

function rpcRequest(id, method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params })
}

function assertMemoryProjectionIdentity(value, toolName) {
  assert.strictEqual(validateContentIdentity(value.contentIdentity).valid, true)
  const projection = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['contentIdentity', 'telemetry'].includes(key)))
  const expected = buildJsonContentIdentity({
    sourceKey: `memory://${value.project || value.source?.project}/${toolName}#delivered`,
    value: projection,
    contractVersion: value.schemaVersion
  }).identity
  assert.deepStrictEqual(value.contentIdentity, expected)
}

function runServer(script, requests, cwd = ROOT, env = {}) {
  const input = requests.concat('').join('\n')
  // Neutralize ambient host signals (e.g. developer GROK_AGENT) so identity is test-controlled.
  // Default pin DEVCODEX_AGENT=claude-code for suite stability; callers may override or clear.
  const mergedEnv = {
    ...process.env,
    GROK_AGENT: '',
    GROK_HOME: '',
    GROK_SESSION: '',
    GROK_SESSION_ID: '',
    GROK_BUILD: '',
    XAI_GROK: '',
    XAI_AGENT: '',
    DEVCODEX_AGENT: 'claude-code',
    ...env
  }
  if (Object.prototype.hasOwnProperty.call(env, 'DEVCODEX_AGENT')) {
    mergedEnv.DEVCODEX_AGENT = env.DEVCODEX_AGENT
  }
  const result = spawnSync(process.execPath, [path.join(ROOT, script), cwd], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    env: mergedEnv
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${script} exited with failure`).trim())
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

function findToolSchema(listed, name) {
  const tool = listed.find(item => item.name === name)
  assert.ok(tool, `${name} tool must be listed`)
  return tool.inputSchema
}

function findSkillRouteOpSchema(schema, op) {
  const variant = (schema.oneOf || []).find(item => item.properties?.op?.const === op)
  assert.ok(variant, `skill_route schema must include ${op} operation`)
  return variant
}

function compactDateInTimeZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}${values.month}${values.day}`
}

function runConfiguredServer(server, requests, cwd = ROOT) {
  const command = server.command === 'node' ? process.execPath : server.command
  const input = requests.concat('').join('\n')
  const result = spawnSync(command, server.args || [], {
    cwd,
    input,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...(server.env || {}) }
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
  fs.mkdirSync(path.join(targetRoot, '.claude', 'skills'), { recursive: true })
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
  const configuredMcp = JSON.parse(JSON.stringify(CLAUDE_MCP_JSON))
  configuredMcp.mcpServers['devcodex-profile'].env = {
    DEVCODEX_GLOBAL_SKILLS_RUNTIME: path.join(targetRoot, '.claude', 'skills')
  }
  fs.writeFileSync(
    path.join(targetRoot, '.mcp.json'),
    `${JSON.stringify(configuredMcp, null, 2)}\n`
  )
  fs.copyFileSync(path.join(ROOT, 'mcp', 'memory-server.js'), path.join(targetRoot, '.claude', 'mcp', 'memory-server.js'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'profile-server.js'), path.join(targetRoot, '.claude', 'mcp', 'profile-server.js'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'path-guard.js'), path.join(targetRoot, '.claude', 'mcp', 'path-guard.js'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'profile-contract.js'), path.join(targetRoot, '.claude', 'mcp', 'profile-contract.js'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'profile-section-selector.cjs'), path.join(targetRoot, '.claude', 'mcp', 'profile-section-selector.cjs'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'agent-identity.cjs'), path.join(targetRoot, '.claude', 'mcp', 'agent-identity.cjs'))
  fs.cpSync(
    path.join(ROOT, 'hooks', '_runtime'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime'),
    { recursive: true }
  )
  // Deploy MCP runtime script deps under .claude/scripts/lib
  for (const rel of [
    'scripts/lib/cp-digest.js',
    'scripts/lib/host-parity-scorecard.js',
    'scripts/lib/global-adapter-refresh-guidance.js',
    'scripts/lib/global-host-target.js',
    'scripts/lib/derived-index-contract.js',
    'scripts/lib/memory-index.js',
    'scripts/lib/summary-type-canon.js'
  ]) {
    const dest = path.join(targetRoot, '.claude', ...rel.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(ROOT, ...rel.split('/')), dest)
  }
  for (const entry of listControlDeliveryEntries(ROOT, 'skills')) {
    const destination = path.join(targetRoot, '.claude', 'skills', ...entry.relative.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, entry.content, 'utf8')
  }
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'workspace-layout.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'workspace-layout.cjs')
  )
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'context-read-contract.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'context-read-contract.cjs')
  )
  for (const file of ['content-identity.cjs', 'derived-state-store.cjs', 'execution-optimization-routing.cjs', 'task-continuation-contract.cjs']) {
    fs.copyFileSync(
      path.join(ROOT, 'hooks', '_runtime', file),
      path.join(targetRoot, '.claude', 'hooks', '_runtime', file)
    )
  }
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'global-skill-runtime-root.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'global-skill-runtime-root.cjs')
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
  assert.match(text, /user-global runtime kernel/)
  assert.doesNotMatch(text, /工作区根目录未找到 CLAUDE\.md/)
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
      arguments: { row: '| 2026-05-24 | #1 | analyze | mcp | — | — | ✅ |' }
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

function testMemoryTaskResolveContract() {
  setupLegacyWorkspace()
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', 'optimizations', 'MCP续接任务')
  fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(taskRoot, '.memory', 'task.json'), JSON.stringify({
    schemaVersion: 'TaskIdentityV1',
    taskId: '6f5faaf1-9a0c-4b12-99c3-4386e415a305',
    displayName: 'MCP续接任务',
    aliases: ['MCP旧任务名'],
    createdAt: '2026-07-18T00:00:00.000Z',
    identityRevision: 1
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(taskRoot, '.memory', 'sessions.md'), '# session\n\n> **当前状态**: 🔄 active\n')

  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', { name: 'memory_task_resolve', arguments: { name: 'MCP旧任务名' } }),
    rpcRequest(3, 'tools/call', { name: 'memory_task_resolve', arguments: { name: '不存在任务', persistIndex: false } })
  ], TEMP_ROOT)
  assert(resultById(responses, 1).tools.some(tool => tool.name === 'memory_task_resolve'))
  const resolved = resultById(responses, 2)
  assert.strictEqual(resolved.isError, false)
  assert.strictEqual(resolved.structuredContent.status, 'resolved-active')
  assert.strictEqual(toolJson(resolved).candidate.taskId, '6f5faaf1-9a0c-4b12-99c3-4386e415a305')
  const missing = resultById(responses, 3)
  assert.strictEqual(missing.isError, true)
  assert.strictEqual(missing.structuredContent.status, 'not-found')
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
  assert.match(sessions, /artifactPath \| version \| sha256 \| sourceMessage \| confirmedAt/)
  assert.match(sessions, /\| CP2 \| ✅ \| — \| — \| — \| — \| 10:30 \|/)
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

function testMemoryCpConfirmPreservesOrdinaryTables() {
  setupLegacyWorkspace()
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', 'requirements', '表格任务')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const artifactPath = path.join(taskRoot, '02-技术方案.md')
  fs.mkdirSync(path.dirname(sessionsPath), { recursive: true })
  fs.writeFileSync(artifactPath, '# 技术方案\n', 'utf8')
  const ordinaryTable = [
    '# Requirement Sessions — 表格任务',
    '',
    '| 日期 | 会话 | 变更 | 产物 | 状态 |',
    '|---|---|---|---|---|',
    '| 2026-07-20 | codex-01 | 需求确认 | `01.md` | ✅ |',
    ''
  ].join('\n')
  fs.writeFileSync(sessionsPath, ordinaryTable, 'utf8')
  const digest = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex')

  const first = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '表格任务',
        phase: 'CP2',
        time: '12:00',
        artifactPath: '02-技术方案.md',
        artifactVersion: 'v1.0',
        artifactSha256: digest,
        sourceMessage: '批准|确认\n继续'
      }
    })
  ], TEMP_ROOT)
  const confirmation = resultById(first, 1)
  assert.strictEqual(confirmation.isError, undefined)
  assert.strictEqual(confirmation.structuredContent.readbackVerified, true)
  assert.strictEqual(confirmation.structuredContent.cpRowCount, 3)
  let sessions = fs.readFileSync(sessionsPath, 'utf8')
  assert.ok(sessions.startsWith(ordinaryTable.trimEnd()), 'ordinary session table must remain unchanged')
  assert.strictEqual((sessions.match(/^### CP 确认记录$/gm) || []).length, 1)
  assert.strictEqual((sessions.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 3)
  assert.ok(sessions.includes(buildExtendedCpTable({
    phases: {
      CP1: { status: '⏳', artifactPath: '—', artifactVersion: '—', artifactSha256: '—', sourceMessage: '—', confirmedAt: '—' },
      CP2: { status: '✅', artifactPath: '`02-技术方案.md`', artifactVersion: 'v1.0', artifactSha256: `\`${digest.toUpperCase()}\``, sourceMessage: '批准 确认 继续', confirmedAt: '12:00' },
      CP3: { status: '⏹️', artifactPath: '—', artifactVersion: '—', artifactSha256: '—', sourceMessage: '—', confirmedAt: '—' }
    }
  })), 'memory MCP CP writer must match scripts/lib/cp-digest.js renderer')
  const parsedByOwner = parseCpSessions(sessions)
  assert.strictEqual(parsedByOwner.CP2.artifactSha256, digest.toUpperCase())
  assert.strictEqual(parsedByOwner.CP2.sourceMessage, '批准 确认 继续')
  assert.match(sessions, /\| CP2 \| ✅ \| `02-技术方案\.md` \| v1\.0 \| `[A-F0-9]{64}` \| 批准 确认 继续 \| 12:00 \|/)

  const second = runServer('mcp/memory-server.js', [
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '表格任务',
        phase: 'CP3',
        time: '12:05',
        artifactPath: '02-技术方案.md',
        artifactVersion: 'v1.0',
        artifactSha256: digest,
        sourceMessage: '自动确认'
      }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(second, 2).structuredContent.readbackVerified, true)
  sessions = fs.readFileSync(sessionsPath, 'utf8')
  assert.strictEqual((sessions.match(/^### CP 确认记录$/gm) || []).length, 1)
  assert.strictEqual((sessions.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 3)
  assert.match(sessions, /\| CP2 \| ✅ \|/)
  assert.match(sessions, /\| CP3 \| ✅ \|/)

  const legacyTaskRoot = path.join(TEMP_ROOT, '.devcodex', 'requirements', '旧表任务')
  const legacySessions = path.join(legacyTaskRoot, '.memory', 'sessions.md')
  fs.mkdirSync(path.dirname(legacySessions), { recursive: true })
  fs.writeFileSync(legacySessions, [
    '# 旧表任务', '', '### CP 确认记录', '',
    '| CP | 状态 | 时间 |', '|---|---|---|',
    '| CP1 | ✅ | 09:00 |', '| CP2 | ⏹️ | — |', '| CP3 | ⏹️ | — |', ''
  ].join('\n'), 'utf8')
  const legacy = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: { requirement: '旧表任务', phase: 'CP2', time: '12:10' }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(legacy, 3).structuredContent.readbackVerified, true)
  const upgraded = fs.readFileSync(legacySessions, 'utf8')
  assert.match(upgraded, /artifactPath \| version \| sha256 \| sourceMessage \| confirmedAt/)
  assert.match(upgraded, /\| CP1 \| ✅ \| — \| — \| — \| — \| 09:00 \|/)
  assert.match(upgraded, /\| CP2 \| ✅ \| — \| — \| — \| — \| 12:10 \|/)
  const legacyParsedByOwner = parseCpSessions(upgraded)
  assert.strictEqual(legacyParsedByOwner.CP1.confirmed, true)
  assert.strictEqual(legacyParsedByOwner.CP2.confirmed, true)
}

/**
 * PF-162 / GR-068: sessions.md already has a 5-col session index table and no CP section.
 * Writer must append a dedicated CP block (heading + 7-col header + CP1~CP3), never a bare CP row under the index table.
 * Also repairs orphan CP rows previously leaked under the ordinary table.
 */
function testMemoryCpConfirmGenericSessionIndexWithoutCpSection() {
  setupLegacyWorkspace()
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', 'requirements', '会话索引无CP表')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const artifactPath = path.join(taskRoot, '01-需求确认.md')
  fs.mkdirSync(path.dirname(sessionsPath), { recursive: true })
  fs.writeFileSync(artifactPath, '# 需求确认\nv0.1\n', 'utf8')
  const sessionIndex = [
    '# Requirement Sessions — 会话索引无CP表',
    '',
    '| 日期 | 会话 | 变更 | 产物 | 状态 |',
    '|------|------|------|------|------|',
    '| 2026-07-20 | 01 | 需求整理 | `00-需求概况.md` | 🔄 |',
    '| 2026-07-20 | 02 | CP1 草稿 | `01-需求确认.md` | 🔄 |',
    ''
  ].join('\n')
  fs.writeFileSync(sessionsPath, sessionIndex, 'utf8')
  const digest = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex')

  const first = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '会话索引无CP表',
        phase: 'CP1',
        time: '18:32',
        artifactPath: '01-需求确认.md',
        artifactVersion: 'v0.1',
        artifactSha256: digest,
        sourceMessage: '确认需求'
      }
    })
  ], TEMP_ROOT)
  const confirmation = resultById(first, 1)
  assert.strictEqual(confirmation.isError, undefined, 'confirm must succeed')
  assert.strictEqual(confirmation.structuredContent.readbackVerified, true)
  assert.strictEqual(confirmation.structuredContent.cpRowCount, 3)

  let sessions = fs.readFileSync(sessionsPath, 'utf8')
  const beforeCp = sessions.split(/^### CP 确认记录$/m)[0]
  assert.ok(beforeCp.includes('| 日期 | 会话 | 变更 | 产物 | 状态 |'), 'session index header must remain')
  assert.ok(beforeCp.includes('| 2026-07-20 | 01 |'), 'session index rows must remain')
  assert.strictEqual((beforeCp.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 0, 'no CP data rows under session index')
  assert.strictEqual((sessions.match(/^### CP 确认记录$/gm) || []).length, 1)
  assert.match(sessions, /\| CP \| 状态 \| artifactPath \| version \| sha256 \| sourceMessage \| confirmedAt \|/)
  assert.strictEqual((sessions.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 3)
  assert.match(sessions, /\| CP1 \| ✅ \|/)
  const parsed = parseCpSessions(sessions)
  assert.strictEqual(parsed.CP1.confirmed, true)
  assert.strictEqual(parsed.CP1.artifactSha256, digest.toUpperCase())

  // Malformed mixed table: orphan 7-col CP row under 5-col index without CP heading (historical false-success shape)
  const polluted = [
    sessionIndex.trimEnd(),
    '',
    `| CP1 | ✅ | \`01-需求确认.md\` | v0.1 | \`${digest.toUpperCase()}\` | 旧泄漏行 | 17:00 |`,
    ''
  ].join('\n')
  fs.writeFileSync(sessionsPath, polluted, 'utf8')
  const repair = runServer('mcp/memory-server.js', [
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '会话索引无CP表',
        phase: 'CP1',
        time: '18:40',
        artifactPath: '01-需求确认.md',
        artifactVersion: 'v0.1',
        artifactSha256: digest,
        sourceMessage: '修复后重确认'
      }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(repair, 2).structuredContent.readbackVerified, true)
  sessions = fs.readFileSync(sessionsPath, 'utf8')
  const beforeAfterRepair = sessions.split(/^### CP 确认记录$/m)[0]
  assert.strictEqual((beforeAfterRepair.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 0, 'orphan CP row under index must be stripped')
  assert.strictEqual((sessions.match(/^### CP 确认记录$/gm) || []).length, 1)
  assert.strictEqual((sessions.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 3)
  assert.match(sessions, /修复后重确认/)
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
  assertMemoryProjectionIdentity(status, 'memory_status')

  const exact = toolJson(resultById(responses, 3))
  assert.strictEqual(exact.schemaVersion, 'MemorySessionQueryV1')
  assert.strictEqual(exact.query.sessionId, '03')
  assert.strictEqual(exact.source.activeRoot, path.join(TEMP_ROOT, '.devcodex'))
  assert.strictEqual(exact.matches.length, 1)
  assert.strictEqual(exact.matches[0].sessionId, '03')
  assert.match(exact.matches[0].content, /ACTIVE-BODY-SENTINEL/)
  assert.doesNotMatch(exact.matches[0].content, /COMPLETED-BODY-SENTINEL/)
  assert.strictEqual(exact.truncated, false)
  assertMemoryProjectionIdentity(exact, 'memory_session_query')

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
  assertMemoryProjectionIdentity(defaultSummary, 'memory_summary_query')

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

function testAgentIdentitySharedModule() {
  const {
    VALID_AGENTS,
    normalizeAgent,
    detectRuntimeAgent
  } = require(path.join(ROOT, 'mcp', 'agent-identity.cjs'))

  assert.strictEqual(VALID_AGENTS.has('grok'), true)
  assert.strictEqual(normalizeAgent('grok'), 'grok')
  assert.strictEqual(normalizeAgent('claude'), '')
  assert.strictEqual(detectRuntimeAgent({ DEVCODEX_AGENT: 'grok' }), 'grok')
  assert.strictEqual(detectRuntimeAgent({ DEVCODEX_AGENT: 'codex', GROK_AGENT: '1' }), 'codex')
  assert.strictEqual(detectRuntimeAgent({ GROK_AGENT: '1' }), 'grok')
  assert.strictEqual(detectRuntimeAgent({ CLAUDE_CODE_VERSION: '1.0.0' }), 'claude-code')
  assert.strictEqual(detectRuntimeAgent({ CODEX_HOME: 'C:\\x' }), 'codex')
  // Unrecognized host must not impersonate Claude Code
  assert.strictEqual(detectRuntimeAgent({}), 'unknown-agent')
  assert.strictEqual(detectRuntimeAgent({ DEVCODEX_AGENT: '' }), 'unknown-agent')
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

function testGrokAgentMemoryWrite() {
  setupMemoryProjectionFixture()
  const day = compactDateInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: day, content: '# grok session\n', agent: 'grok' }
    }),
    rpcRequest(2, 'tools/call', {
      name: 'memory_status',
      arguments: { agent: 'grok' }
    })
  ], TEMP_ROOT, { DEVCODEX_AGENT: 'grok' })

  const writeResult = resultById(responses, 1)
  assert.notStrictEqual(writeResult.isError, true, writeResult.content?.[0]?.text || 'write failed')
  const statusResult = resultById(responses, 2)
  assert.notStrictEqual(statusResult.isError, true, statusResult.content?.[0]?.text || 'status failed')
  const status = toolJson(statusResult)
  assert.strictEqual(status.agent, 'grok')
  assert.strictEqual(status.today.exists, true)
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'grok', 'tasks', `${day}.md`)))
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
  ], projectRoot, { DEVCODEX_AGENT: 'claude-code' })

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
  // Hard budget: no-args full load is rejected unless explicitFull+fullReadReason
  const blocked = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_load' }),
    rpcRequest(3, 'tools/call', { name: 'profile_load', arguments: null }),
    rpcRequest(4, 'tools/call', { name: 'profile_load', arguments: {} })
  ], TEMP_ROOT)
  for (const id of [2, 3, 4]) {
    const result = resultById(blocked, id)
    assert.strictEqual(result.isError, true)
    const text = result.content?.[0]?.text || ''
    assert.match(text, /PROFILE_LOAD_BUDGET|explicitFull/)
  }

  const fullArgs = {
    explicitFull: true,
    fullReadReason: 'legacy compatibility fixture requires tier full read',
    maxBytes: 500000
  }
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(5, 'tools/call', { name: 'profile_load', arguments: fullArgs }),
    rpcRequest(6, 'tools/call', { name: 'profile_load', arguments: { ...fullArgs } })
  ], TEMP_ROOT)

  for (const id of [5, 6]) {
    const result = resultById(responses, id)
    assert.notStrictEqual(result.isError, true)
    const text = result.content?.[0]?.text || ''
    assert.match(text, /01-项目信息/)
    assert.match(text, /06-功能清单/)
    assert.match(text, /07-用户文档与契约规范/)
    assert.match(text, /config\.local\.json/)
    assert.doesNotMatch(text, /invoke|TypeError/i)
  }
  assert.deepStrictEqual(
    resultById(responses, 6).content,
    resultById(responses, 5).content,
    'explicitFull profile_load must be stable across identical calls'
  )

  const targeted = runServer('mcp/profile-server.js', [
    rpcRequest(7, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md', '03-代码风格.md'] }
    })
  ], TEMP_ROOT)
  const targetedText = resultById(targeted, 7).content?.[0]?.text || ''
  assert.notStrictEqual(resultById(targeted, 7).isError, true)
  assert.match(targetedText, /01-项目信息/)
  assert.match(targetedText, /03-代码风格/)
}

function testContextReadBindingContract() {
  setupLegacyWorkspace()
  const planResponses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'binding-contract-epoch' }
    })
  ], TEMP_ROOT)
  const plan = toolJson(resultById(planResponses, 1))
  const binding = {
    schemaVersion: 'ContextReadBindingV1',
    contextEpoch: plan.identity.contextEpoch,
    planId: plan.planId,
    planContentId: plan.planContentId,
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project
  }

  const profileResponses = runServer('mcp/profile-server.js', [
    rpcRequest(2, 'tools/list'),
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md'], contextBinding: binding }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md'], contextBinding: { ...binding, activeRoot: path.join(TEMP_ROOT, 'other') } }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['intent'], contextBinding: binding }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md'] }
    })
  ], TEMP_ROOT)
  const listedResult = resultById(profileResponses, 2)
  const listed = listedResult.tools
  const toolsListBytes = Buffer.byteLength(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    result: listedResult
  }))
  assert(
    toolsListBytes <= 7680,
    `profile tools/list exceeds Grok local-stdio safety budget: ${toolsListBytes} bytes`
  )
  const skillRouteSchema = findToolSchema(listed, 'skill_route')
  assert.ok(Array.isArray(skillRouteSchema.oneOf), 'skill_route inputSchema must be per-op oneOf')
  assert.strictEqual(
    skillRouteSchema.properties?.contextBinding,
    undefined,
    'skill_route must not expose a top-level contextBinding property'
  )
  for (const op of ['catalog', 'commit', 'rebind', 'load_stage', 'status']) {
    findSkillRouteOpSchema(skillRouteSchema, op)
  }
  assert.strictEqual(
    findSkillRouteOpSchema(skillRouteSchema, 'catalog').properties.contextBinding,
    undefined,
    'catalog must not accept contextBinding'
  )
  assert.strictEqual(
    findSkillRouteOpSchema(skillRouteSchema, 'load_stage').properties.contextBinding,
    undefined,
    'load_stage must not accept contextBinding'
  )
  assert.strictEqual(
    findSkillRouteOpSchema(skillRouteSchema, 'status').properties.contextBinding,
    undefined,
    'status must not accept contextBinding'
  )
  assert.ok(
    findSkillRouteOpSchema(skillRouteSchema, 'commit').required.includes('contextBinding'),
    'commit must require contextBinding'
  )
  assert.ok(
    findSkillRouteOpSchema(skillRouteSchema, 'rebind').required.includes('contextBinding'),
    'rebind must require contextBinding'
  )
  assert.ok(listed.find(tool => tool.name === 'profile_load').inputSchema.properties.contextBinding)
  assert.ok(listed.find(tool => tool.name === 'profile_skill_plan').inputSchema.properties.contextBinding)
  const profileText = resultById(profileResponses, 3).content[0].text
  const profileMeta = JSON.parse(/<!-- profile_load_budget (\{[^\n]+\}) -->/.exec(profileText)[1])
  assert.deepStrictEqual(profileMeta.contextBinding, {
    ...binding,
    activeRoot: plan.identity.activeRoot,
    bindingStatus: 'verified',
    verificationMode: 'request-bound'
  })
  const mismatch = toolJson(resultById(profileResponses, 4))
  assert.strictEqual(resultById(profileResponses, 4).isError, true)
  assert.strictEqual(mismatch.errorCode, 'CONTEXT_BINDING_MISMATCH')
  const skillPlan = toolJson(resultById(profileResponses, 5))
  assert.strictEqual(skillPlan.contextBinding.bindingStatus, 'verified')
  const legacyProfileMeta = JSON.parse(/<!-- profile_load_budget (\{[^\n]+\}) -->/.exec(
    resultById(profileResponses, 6).content[0].text
  )[1])
  assert.strictEqual(legacyProfileMeta.contextBinding.bindingStatus, 'legacy-unbound')

  const memoryResponses = runServer('mcp/memory-server.js', [
    rpcRequest(7, 'tools/list'),
    rpcRequest(8, 'tools/call', { name: 'memory_status', arguments: { contextBinding: binding } }),
    rpcRequest(9, 'tools/call', {
      name: 'memory_status',
      arguments: { contextBinding: { ...binding, project: 'wrong-project' } }
    }),
    rpcRequest(10, 'tools/call', { name: 'memory_status', arguments: {} }),
    rpcRequest(11, 'tools/call', {
      name: 'memory_status',
      arguments: { contextBinding: { ...binding, unsupported: true } }
    })
  ], TEMP_ROOT)
  assert.ok(resultById(memoryResponses, 7).tools
    .find(tool => tool.name === 'memory_status').inputSchema.properties.contextBinding)
  const boundMemory = toolJson(resultById(memoryResponses, 8))
  assert.strictEqual(boundMemory.contextBinding.bindingStatus, 'verified')
  assert.strictEqual(boundMemory.contextBinding.verificationMode, 'request-bound')
  assertMemoryProjectionIdentity(boundMemory, 'memory_status')
  const memoryMismatch = toolJson(resultById(memoryResponses, 9))
  assert.strictEqual(resultById(memoryResponses, 9).isError, true)
  assert.strictEqual(memoryMismatch.errorCode, 'CONTEXT_BINDING_MISMATCH')
  const legacyMemory = toolJson(resultById(memoryResponses, 10))
  assert.strictEqual(legacyMemory.contextBinding.bindingStatus, 'legacy-unbound')
  const invalidMemory = toolJson(resultById(memoryResponses, 11))
  assert.strictEqual(resultById(memoryResponses, 11).isError, true)
  assert.strictEqual(invalidMemory.errorCode, 'CONTEXT_BINDING_INVALID')
}

function testProfileSectionSelectorsAndSkillPlan() {
  setupLegacyWorkspace()
  const safePlanResponses = runServer('mcp/profile-server.js', [
    rpcRequest(70, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'safe-optimization-binding' }
    })
  ], TEMP_ROOT)
  const safeOptimization = toolJson(resultById(safePlanResponses, 70)).executionOptimization
  assert.strictEqual(safeOptimization.mode, 'safe-auto')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '01-项目信息.md'), [
    'Profile preamble.',
    '',
    '# Project',
    '',
    'Project facts.',
    '',
    '## Runtime',
    '',
    'Runtime facts.',
    '',
    '## Security',
    '',
    'Security facts.',
    '',
    '## Large Appendix',
    '',
    'x'.repeat(5000),
    ''
  ].join('\n'))
  const requests = [
    rpcRequest(1, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 20000,
        executionOptimization: safeOptimization,
        sectionSelectors: [{
          file: '01-项目信息.md',
          headingQueries: ['Runtime'],
          requiredQueries: ['Runtime'],
          maxBytes: 4096
        }]
      }
    }),
    rpcRequest(2, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 20000,
        executionOptimization: safeOptimization,
        sectionSelectors: [{
          file: '01-项目信息.md',
          headingQueries: ['Missing'],
          requiredQueries: ['Missing'],
          maxBytes: 4096
        }]
      }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 4096,
        executionOptimization: safeOptimization,
        sectionSelectors: [{
          file: '01-项目信息.md',
          headingQueries: ['Runtime', 'Large Appendix'],
          requiredQueries: ['Runtime'],
          maxBytes: 1024
        }]
      }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['02-架构约束.md'],
        executionOptimization: safeOptimization,
        sectionSelectors: [{ file: '01-项目信息.md', headingQueries: ['Runtime'] }]
      }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['dev-testing'], maxBytes: 1000000, executionOptimization: safeOptimization }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['brand-visual-quality'], executionOptimization: safeOptimization }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['intent'], hostCapability: 'unsupported', executionOptimization: safeOptimization }
    })
  ]
  const responses = runServer('mcp/profile-server.js', requests, TEMP_ROOT)
  const loadMeta = result => {
    const text = result.content?.[0]?.text || ''
    const match = text.match(/<!-- profile_load_budget (\{[^\n]+\}) -->/)
    assert(match, 'missing profile_load_budget receipt')
    return { text, meta: JSON.parse(match[1]) }
  }

  const exact = loadMeta(resultById(responses, 1))
  assert.match(exact.text, /Runtime facts/)
  assert.doesNotMatch(exact.text, /Security facts/)
  assert.strictEqual(exact.meta.schemaVersion, 'ProfileLoadReceiptV2')
  assert.strictEqual(exact.meta.sectionReceipts[0].schemaVersion, 'ProfileSectionLoadReceiptV1')
  assert.strictEqual(exact.meta.sectionReceipts[0].completion, 'complete')
  assert.strictEqual(exact.meta.sectionReceipts[0].requiredSatisfied, true)

  const fallback = loadMeta(resultById(responses, 2))
  assert.match(fallback.text, /Project facts/)
  assert.match(fallback.text, /Security facts/)
  assert.strictEqual(fallback.meta.sectionReceipts[0].completion, 'fallback-full')
  assert.strictEqual(fallback.meta.sectionReceipts[0].fallbackReason, 'required-query-missing-or-ambiguous')

  const partial = loadMeta(resultById(responses, 3))
  assert.match(partial.text, /Runtime facts/)
  assert.doesNotMatch(partial.text, /x{128}/)
  assert.doesNotMatch(partial.text, /truncated by maxBytes/)
  assert.strictEqual(partial.meta.completion, 'partial')
  assert(partial.meta.sectionReceipts[0].deferredSections.some(item => item.query === 'Large Appendix'))

  const invalid = resultById(responses, 4)
  assert.strictEqual(invalid.isError, true)

  const configPath = path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json')
  const fullOnlyConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  fullOnlyConfig.extensions = { devcodex: { executionOptimization: { mode: 'full-only' } } }
  fs.writeFileSync(configPath, JSON.stringify(fullOnlyConfig, null, 2) + '\n')
  const fullOnlyPlanResponses = runServer('mcp/profile-server.js', [
    rpcRequest(80, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'full-only-binding' }
    })
  ], TEMP_ROOT)
  const fullOnlyOptimization = toolJson(resultById(fullOnlyPlanResponses, 80)).executionOptimization
  assert.strictEqual(fullOnlyOptimization.mode, 'full-only')
  const fullOnlyResponses = runServer('mcp/profile-server.js', [
    rpcRequest(8, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 20000,
        executionOptimization: fullOnlyOptimization,
        sectionSelectors: [{ file: '01-项目信息.md', headingQueries: ['Runtime'], requiredQueries: ['Runtime'] }]
      }
    }),
    rpcRequest(9, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['intent'], executionOptimization: fullOnlyOptimization }
    })
  ], TEMP_ROOT)
  const fullOnlyLoad = loadMeta(resultById(fullOnlyResponses, 8))
  assert.strictEqual(fullOnlyLoad.meta.executionOptimizationMode, 'full-only')
  assert.strictEqual(fullOnlyLoad.meta.optimizationFallback, 'full-profile-file')
  assert.strictEqual(fullOnlyLoad.meta.sectionReceipts.length, 0)
  assert.match(fullOnlyLoad.text, /Security facts/)
  const fullOnlySkill = JSON.parse(resultById(fullOnlyResponses, 9).content[0].text)
  assert.strictEqual(fullOnlySkill.completion, 'fallback-full')
  assert.strictEqual(fullOnlySkill.fallback.route, 'full-skill-read')
  assert.strictEqual(fullOnlySkill.budgetDecision.schemaVersion, 'BudgetDecisionV1')
  assert.strictEqual(fullOnlySkill.budgetDecision.enforcementStatus, 'fallback-full')
  assert.strictEqual(fullOnlySkill.budgetDecision.optimizedHit, false)
  assert.match(invalid.content[0].text, /PROFILE_SECTION_FILE_NOT_SELECTED/)

  const bundle = toolJson(resultById(responses, 5))
  assert.strictEqual(bundle.schemaVersion, 'BundleDecisionV2')
  assert.strictEqual(bundle.completion, 'complete')
  assert.strictEqual(bundle.budgetDecision.schemaVersion, 'BudgetDecisionV1')
  assert.strictEqual(bundle.budgetDecision.enforcementStatus, 'enforced')
  assert.strictEqual(bundle.budgetDecision.optimizedHit, true)
  assert.deepStrictEqual(new Set(bundle.selected.map(item => item.id)),
    new Set(['api-verification', 'dev-scenario-test', 'dev-testing']))
  const inactive = toolJson(resultById(responses, 6))
  assert.strictEqual(inactive.completion, 'blocked')
  assert(inactive.blockers.some(item => item.code === 'inactive'))
  const hostFallback = toolJson(resultById(responses, 7))
  assert.strictEqual(hostFallback.completion, 'fallback-full')
  assert.strictEqual(hostFallback.fallback.route, 'full-skill-read')
  assert.strictEqual(hostFallback.budgetDecision.enforcementStatus, 'fallback-full')
  assert.strictEqual(hostFallback.budgetDecision.optimizedHit, false)

  delete fullOnlyConfig.extensions
  fs.writeFileSync(configPath, JSON.stringify(fullOnlyConfig, null, 2) + '\n')
  const lifecycleState = createOptimizationState({
    featureStates: {
      'context-computation-reuse': 'rolled-back',
      'profile-section-load': 'rolled-back',
      'skill-bundle': 'rolled-back'
    }
  })
  assert.strictEqual(persistOptimizationState(path.join(TEMP_ROOT, '.devcodex'), lifecycleState).status, 'persisted')
  const lifecycleResponses = runServer('mcp/profile-server.js', [
    rpcRequest(90, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'feature-lifecycle-rollback' }
    }),
    rpcRequest(91, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 20000,
        executionOptimization: safeOptimization,
        sectionSelectors: [{ file: '01-项目信息.md', headingQueries: ['Runtime'], requiredQueries: ['Runtime'] }]
      }
    }),
    rpcRequest(92, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['intent'], executionOptimization: safeOptimization }
    })
  ], TEMP_ROOT)
  const lifecyclePlan = toolJson(resultById(lifecycleResponses, 90))
  assert.strictEqual(lifecyclePlan.cacheDecision.status, 'bypassed')
  assert.strictEqual(lifecyclePlan.cacheDecision.reasonCode, 'feature-rolled-back')
  const lifecycleLoad = loadMeta(resultById(lifecycleResponses, 91))
  assert.strictEqual(lifecycleLoad.meta.executionOptimizationFeature.lifecycleState, 'rolled-back')
  assert.strictEqual(lifecycleLoad.meta.optimizationFallback, 'full-profile-file')
  assert.strictEqual(lifecycleLoad.meta.sectionReceipts.length, 0)
  const lifecycleSkill = toolJson(resultById(lifecycleResponses, 92))
  assert.strictEqual(lifecycleSkill.completion, 'fallback-full')
  assert.strictEqual(lifecycleSkill.executionOptimization.lifecycleState, 'rolled-back')
  assert.strictEqual(lifecycleSkill.executionOptimization.reasonCode, 'feature-rolled-back')
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
  assert(tools.some(tool => tool.name === 'profile_skill_plan'))
  assert(tools.some(tool => tool.name === 'profile_get_mode'))

  const chatResult = resultById(responses, 2)
  assert.notStrictEqual(chatResult.isError, true)
  const chatPlan = toolJson(chatResult)
  const chatValidation = validateContextReadPlan(chatPlan)
  assert.strictEqual(chatValidation.valid, true,
    `${chatValidation.errors.join(' | ')} cache=${JSON.stringify(chatPlan.cacheDecision)}`)
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
  assert.strictEqual(devPlan.planContentId, repeatedDevPlan.planContentId,
    'same content must keep a stable planContentId')
  assert.notStrictEqual(devPlan.planId, repeatedDevPlan.planId,
    'same epoch still requires an invocation-isolated planId')
  assert.strictEqual(devPlan.cacheDecision.status, 'miss')
  assert.strictEqual(repeatedDevPlan.cacheDecision.status, 'hit')
  assert.strictEqual(repeatedDevPlan.cacheDecision.bodyDeliverySkipped, false)
  const crossProcessResponse = runServer('mcp/profile-server.js', [
    rpcRequest(6, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-dev-plan' }
    })
  ], projectRoot)
  const crossProcessPlan = toolJson(resultById(crossProcessResponse, 6))
  assert.strictEqual(crossProcessPlan.planContentId, devPlan.planContentId)
  assert.notStrictEqual(crossProcessPlan.planId, devPlan.planId)
  assert.strictEqual(crossProcessPlan.cacheDecision.status, 'hit',
    'equivalent content must reuse computation metadata across server processes')

  const cacheDir = path.join(TEMP_ROOT, '.devcodex', 'workspace', '.runtime-state', 'projects', 'chat', 'context-plan-cache')
  const cacheFile = path.join(cacheDir, `${devPlan.planContentId}.json`)
  fs.writeFileSync(cacheFile, '{invalid-json', 'utf8')
  const corruptResponse = runServer('mcp/profile-server.js', [
    rpcRequest(7, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-dev-plan' }
    })
  ], projectRoot)
  const corruptPlan = toolJson(resultById(corruptResponse, 7))
  assert.strictEqual(corruptPlan.cacheDecision.status, 'error')
  assert.strictEqual(validateContextReadPlan(corruptPlan).valid, true,
    'a corrupt derived cache must preserve the correct full-compute result')

  const capacityFile = path.join(cacheDir, 'capacity-probe.json')
  fs.writeFileSync(capacityFile, Buffer.alloc(32 * 1024 * 1024 + 1))
  const bypassResponse = runServer('mcp/profile-server.js', [
    rpcRequest(8, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-capacity-bypass' }
    })
  ], projectRoot)
  const bypassPlan = toolJson(resultById(bypassResponse, 8))
  assert.strictEqual(bypassPlan.cacheDecision.status, 'bypassed')
  assert.strictEqual(bypassPlan.cacheDecision.reasonCode, 'metadata-budget-exceeded')
  assert.strictEqual(validateContextReadPlan(bypassPlan).valid, true,
    'capacity bypass must continue the correct non-cache read path')
  fs.unlinkSync(capacityFile)
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
  assert.strictEqual(selected.planContentId, repeated.planContentId,
    'identical conditional replan content must be stable')
  assert.notStrictEqual(selected.planId, repeated.planId,
    'conditional invocations must remain isolated')
  assert.strictEqual(repeated.cacheDecision.status, 'hit')
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
      arguments: {
        project: 'chat',
        files: localPlan.profile.selectedFiles,
        executionOptimization: localPlan.executionOptimization
      }
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
      arguments: {
        project: 'chat',
        files: plan.profile.selectedFiles,
        executionOptimization: plan.executionOptimization
      }
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
    rpcRequest(5, 'tools/call', {
      name: 'profile_load',
      arguments: {
        project: 'chat',
        explicitFull: true,
        fullReadReason: 'context-read trace fixture full tier',
        maxBytes: 500000
      }
    })
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
      arguments: { scope: 'workspace', row: '| 2026-05-24 | #1 | analyze | workspace | — | — | ✅ |' }
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
      arguments: { scope: 'workspace', row: '| 2026-05-24 | #2 | analyze | explicit workspace | — | — | ✅ |' }
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

function testMemorySessionAllocationAndTransactions() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/list'),
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: '20260524', title: 'first', intent: 'analyze' }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: '20260524', title: 'second', intent: 'dev' }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', content: '追加内容\n' }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { row: '| 2026-05-24 | 01 | analyze | atomic summary | — | — | ✅ |' }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260524', status: 'all', limit: 10 }
    }),
    rpcRequest(8, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'completed', limit: 10 }
    })
  ], projectRoot)

  assert(resultById(responses, 2).tools.some(tool => tool.name === 'memory_session_allocate'))
  const first = JSON.parse(resultById(responses, 3).content[0].text)
  const second = JSON.parse(resultById(responses, 4).content[0].text)
  assert.strictEqual(first.schemaVersion, 'MemorySessionAllocationReceiptV1')
  assert.strictEqual(first.sessionId, '01')
  assert.strictEqual(second.sessionId, '02')
  assert.strictEqual(first.transaction.schemaVersion, 'MemoryTransactionReceiptV1')
  assert.strictEqual(first.transaction.indexReceipt.status, 'persisted')
  assert.strictEqual(second.transaction.indexReceipt.status, 'persisted')
  assert.strictEqual(second.transaction.indexReceipt.generation, 2)
  assert.match(resultById(responses, 5).content[0].text, /MemoryTransactionReceiptV1/)
  assert.match(resultById(responses, 6).content[0].text, /MemoryTransactionReceiptV1/)
  assert.match(resultById(responses, 5).content[0].text, /MemoryIndexReceiptV1/)
  assert.match(resultById(responses, 6).content[0].text, /MemoryIndexReceiptV1/)
  const indexedDaily = toolJson(resultById(responses, 7))
  const indexedSummary = toolJson(resultById(responses, 8))
  assert.strictEqual(indexedDaily.indexReceipt.status, 'fresh')
  assert.strictEqual(indexedDaily.coverage.status, 'complete')
  assert(indexedDaily.telemetry.indexBytesRead > 0)
  assert.strictEqual(indexedSummary.indexReceipt.status, 'fresh')
  assert.strictEqual(indexedSummary.coverage.status, 'complete')

  const dailyPath = path.join(TEMP_ROOT, '.devcodex', 'chat', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md')
  const daily = fs.readFileSync(dailyPath, 'utf8')
  assert.match(daily, /## 会话 01 — first/)
  assert.match(daily, /## 会话 02 — second/)
  assert.match(daily, /追加内容/)
  const summary = fs.readFileSync(path.join(TEMP_ROOT, '.devcodex', 'chat', '.memory', 'clients', 'claude-code', 'SUMMARY.md'), 'utf8')
  assert.match(summary, /atomic summary/)

  const derivedRoot = path.join(TEMP_ROOT, '.devcodex', 'chat', '.runtime-state', 'derived-indexes')
  const beforeQueryOnly = snapshotTree(derivedRoot)
  const queryOnly = runServer('mcp/memory-server.js', [
    rpcRequest(20, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260524', status: 'all', limit: 10 }
    }),
    rpcRequest(21, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'completed', limit: 10 }
    })
  ], projectRoot)
  assert.strictEqual(toolJson(resultById(queryOnly, 20)).indexReceipt.status, 'fresh')
  assert.strictEqual(toolJson(resultById(queryOnly, 21)).indexReceipt.status, 'fresh')
  assert.deepStrictEqual(snapshotTree(derivedRoot), beforeQueryOnly, 'index-backed MCP query must be zero-write')

  const lockedDate = '20260525'
  const activeRoot = path.join(TEMP_ROOT, '.devcodex', 'chat')
  const lockedFile = path.join(activeRoot, '.memory', 'clients', 'claude-code', 'tasks', `${lockedDate}.md`)
  const lockKey = crypto.createHash('sha256').update(`${activeRoot}\0${path.resolve(lockedFile)}`).digest('hex')
  const lockDir = path.join(TEMP_ROOT, '.devcodex', 'workspace', '.runtime-state', 'projects', 'chat', 'memory-locks', lockKey)
  fs.mkdirSync(lockDir, { recursive: true })
  fs.writeFileSync(path.join(lockDir, 'owner.json'), '{"pid":999999}\n', 'utf8')

  const blocked = runServer('mcp/memory-server.js', [
    rpcRequest(7, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: lockedDate, content: '# should-not-write\n' }
    })
  ], projectRoot)
  assert.strictEqual(resultById(blocked, 7).isError, true)
  assert.match(resultById(blocked, 7).content?.[0]?.text || '', /MEMORY_TRANSACTION_LOCKED/)
  assert.strictEqual(fs.existsSync(lockedFile), false, 'locked memory write must not half-write the target')
}

function testMemoryLocalCalendarAndWriterReaderContract() {
  for (const timeZone of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
    setupLegacyWorkspace()
    const day = compactDateInTimeZone(timeZone)
    const responses = runServer('mcp/memory-server.js', [
      rpcRequest(1, 'tools/call', {
        name: 'memory_session_allocate',
        arguments: { title: `timezone-${timeZone}`, intent: 'other' }
      }),
      rpcRequest(2, 'tools/call', {
        name: 'memory_session_query',
        arguments: { date: day, status: 'all' }
      }),
      rpcRequest(3, 'tools/call', {
        name: 'memory_session_write',
        arguments: { date: day, content: '\n状态：✅ 已完成\n' }
      }),
      rpcRequest(4, 'tools/call', {
        name: 'memory_session_query',
        arguments: { date: day, status: 'completed' }
      })
    ], TEMP_ROOT, { TZ: timeZone })

    const allocation = toolJson(resultById(responses, 1))
    assert.strictEqual(allocation.sessionId, '01')
    const active = toolJson(resultById(responses, 2))
    assert.strictEqual(active.matches.length, 1)
    assert.strictEqual(active.matches[0].state, 'active')
    assert.match(active.matches[0].content, new RegExp(`\\*\\*时间\\*\\*：${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} \\d{2}:\\d{2} [+-]\\d{2}:\\d{2}`))
    const completed = toolJson(resultById(responses, 4))
    assert.strictEqual(completed.matches.length, 1)
    assert.strictEqual(completed.matches[0].state, 'completed')
    assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'tasks', `${day}.md`)))
  }

  setupLegacyWorkspace()
  const summaryPath = path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'SUMMARY.md')
  const validRow = '| 2026-07-22 16:30 | 01 | analyze | valid roundtrip | report.md | memory.md | ✅ |'
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(10, 'tools/call', { name: 'memory_summary_append', arguments: { row: validRow } }),
    rpcRequest(11, 'tools/call', { name: 'memory_summary_query', arguments: { status: 'completed', since: '2026-07-22' } }),
    rpcRequest(12, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 02 | malformed |' } }),
    rpcRequest(13, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 02 | analyze | unescaped | pipe | report | memory | ✅ |' } }),
    // SummaryTypeCanonGate negatives
    rpcRequest(14, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 03 | ops | should reject | r.md | m.md | ✅ |' } }),
    rpcRequest(15, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 04 | audit/ECR | should reject | r.md | m.md | ✅ |' } }),
    rpcRequest(16, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 05 | fix/ledger | should reject | r.md | m.md | ✅ |' } }),
    rpcRequest(17, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 06 | analyze+fix | compound ok | r.md | m.md | ✅ |' } })
  ], TEMP_ROOT)

  assert.notStrictEqual(resultById(responses, 10).isError, true)
  const summary = toolJson(resultById(responses, 11))
  assert.strictEqual(summary.rows.length, 1)
  assert.strictEqual(summary.rows[0].summary, 'valid roundtrip')
  assert.strictEqual(summary.rows[0].state, 'completed')
  assert.strictEqual(resultById(responses, 12).isError, true)
  assert.strictEqual(resultById(responses, 13).isError, true)
  assert.strictEqual(resultById(responses, 14).isError, true, 'ops must fail SummaryTypeCanon')
  assert.strictEqual(resultById(responses, 15).isError, true, 'slash type must fail')
  assert.strictEqual(resultById(responses, 16).isError, true, 'fix/ledger must fail')
  assert.notStrictEqual(resultById(responses, 17).isError, true, 'analyze+fix must pass')
  assert.strictEqual(fs.readFileSync(summaryPath, 'utf8').split(validRow).length - 1, 1)
  assert.doesNotMatch(fs.readFileSync(summaryPath, 'utf8'), /malformed|unescaped|\| ops \||audit\/ECR|fix\/ledger/)
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /analyze\+fix/)
}

function testMcpJsonLaunchContract() {
  const packageConfig = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'))
  const packageServers = packageConfig.mcpServers || {}
  const packageExpected = {
    'devcodex-memory': 'mcp/memory-server.js',
    'devcodex-profile': 'mcp/profile-server.js'
  }
  for (const [name, scriptPath] of Object.entries(packageExpected)) {
    const server = packageServers[name]
    assert.ok(server, `package .mcp.json missing ${name}`)
    assert.deepStrictEqual(server.args, [scriptPath, '.'])
    assert.ok(fs.existsSync(path.join(ROOT, scriptPath)), `package MCP script missing: ${scriptPath}`)
    const responses = runConfiguredServer(server, [rpcRequest(88, 'initialize')], ROOT)
    assert.strictEqual(resultById(responses, 88).serverInfo.name, name)
  }

  const targetRoot = setupConfiguredMcpTarget()
  const targetConfig = JSON.parse(fs.readFileSync(path.join(targetRoot, '.mcp.json'), 'utf8'))
  const servers = targetConfig.mcpServers || {}
  const configuredPlanResponses = runConfiguredServer(servers['devcodex-profile'], [
    rpcRequest(89, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'configured-optimization-binding' }
    })
  ], targetRoot)
  const configuredOptimization = toolJson(resultById(configuredPlanResponses, 89)).executionOptimization
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
        }),
        rpcRequest(93, 'tools/call', {
          name: 'profile_skill_plan',
          arguments: {
            candidateIds: ['intent'],
            maxBytes: 100000,
            executionOptimization: configuredOptimization
          }
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
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'profile_skill_plan'))
      const configuredPlan = toolJson(resultById(responses, 92))
      assert.strictEqual(validateContextReadPlan(configuredPlan).valid, true)
      assert.strictEqual(configuredPlan.identity.project, 'configured-target')
      const configuredBundle = toolJson(resultById(responses, 93))
      assert.strictEqual(configuredBundle.schemaVersion, 'BundleDecisionV2')
      assert.strictEqual(configuredBundle.completion, 'complete')
    } else {
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'memory_status'))
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'memory_task_resolve'))
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
testMemoryTaskResolveContract()
testMemoryActualHostEnvAgent()
testMemoryCpConfirmForBugs()
testMemoryCpConfirmForExtendedTaskKinds()
testMemoryCpConfirmPreservesOrdinaryTables()
testMemoryCpConfirmGenericSessionIndexWithoutCpSection()
testMemoryProjectionQueriesAndZeroWrite()
testMemoryProjectionErrorsAndMalformedSources()
testMemoryProjectionLayoutTargets()
testAgentIdentitySharedModule()
testMemoryProjectionAgentAmbiguity()
testGrokAgentMemoryWrite()
testWorkspaceNamespaceProfileMerge()
testProfileLoadWithoutArguments()
testContextReadBindingContract()
testProfileSectionSelectorsAndSkillPlan()
testProfileContextPlanContract()
testProfileContextPlanConditionalSelectors()
testProfileContextPlanLocalPolicyAndFullEscalation()
testProfileContextPlanReadTrace()
testWorkspaceNamespaceMemoryScope()
testWorkspaceRootMemoryScopeRequiresExplicitTarget()
testWorkspaceNamespaceNestedProjectInference()
testWorkspaceNamespaceTraversalRejected()
testMemorySessionAllocationAndTransactions()
testMemoryLocalCalendarAndWriterReaderContract()
testAdjacentMcpPathArgumentsRejected()
testMcpJsonLaunchContract()
fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
process.stdout.write('mcp servers smoke test passed\n')
