#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

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

function setupConfiguredMcpTarget() {
  const targetRoot = path.join(TEMP_ROOT, 'configured-target')
  fs.mkdirSync(path.join(targetRoot, '.claude', 'mcp'), { recursive: true })
  fs.mkdirSync(path.join(targetRoot, '.claude', 'hooks', '_runtime'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, '.mcp.json'), path.join(targetRoot, '.mcp.json'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'memory-server.js'), path.join(targetRoot, '.claude', 'mcp', 'memory-server.js'))
  fs.copyFileSync(path.join(ROOT, 'mcp', 'profile-server.js'), path.join(targetRoot, '.claude', 'mcp', 'profile-server.js'))
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'workspace-layout.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'workspace-layout.cjs')
  )
  return targetRoot
}

function resultById(responses, id) {
  const response = responses.find(item => item.id === id)
  assert.ok(response, `missing JSON-RPC response id=${id}`)
  assert.ifError(response.error)
  return response.result
}

function setupLegacyWorkspace() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'profile'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'CLAUDE.md'), '# CLAUDE.md\n\nDevCodex rules\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '01-项目信息.md'), '# 01-项目信息\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '02-架构约束.md'), '# 02-架构约束\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '03-代码风格.md'), '# 03-代码风格\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'claude-code' })
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.local.json'),
    JSON.stringify({ connections: { local: { urlEnv: 'LOCAL_DB_URL' } } }, null, 2)
  )
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
    JSON.stringify({ connections: { reporting: { urlEnv: 'REPORTING_DB_URL' } } }, null, 2)
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
  assert.ok(list.prompts.some(prompt => prompt.name === 'devcodex-init'))

  const prompt = resultById(responses, 3)
  const text = prompt.messages?.[0]?.content?.text || ''
  assert.match(text, /CLAUDE\.md/)
  assert.match(text, /01-项目信息/)
  assert.match(text, /config\.local\.json/)
  assert.match(text, /PC0~PC7/)
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
  assert.match(profileText, /REPORTING_DB_URL/)
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

    const responses = runConfiguredServer(server, [rpcRequest(90, 'initialize')], targetRoot)
    assert.strictEqual(resultById(responses, 90).serverInfo.name, name)
  }
}

testProfilePrompts()
testProfileModeFallbackAgent()
testProfileAgentUsesRuntimeBeforeProfileFallback()
testMemoryDefaultAgent()
testMemoryActualHostEnvAgent()
testMemoryCpConfirmForBugs()
testMemoryCpConfirmForExtendedTaskKinds()
testWorkspaceNamespaceProfileMerge()
testWorkspaceNamespaceMemoryScope()
testWorkspaceRootMemoryScopeRequiresExplicitTarget()
testWorkspaceNamespaceNestedProjectInference()
testWorkspaceNamespaceTraversalRejected()
testMcpJsonLaunchContract()
fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
process.stdout.write('mcp servers smoke test passed\n')
