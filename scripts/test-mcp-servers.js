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

function runServer(script, requests, cwd = ROOT) {
  const input = requests.concat('').join('\n')
  const result = spawnSync(process.execPath, [path.join(ROOT, script), cwd], {
    cwd: ROOT,
    input,
    encoding: 'utf8'
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${script} exited with failure`).trim())
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
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
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude')))
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

function testWorkspaceNamespaceProfileMerge() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md', '03-代码风格.md', 'config.json'] }
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
}

testProfilePrompts()
testProfileModeFallbackAgent()
testMemoryDefaultAgent()
testMemoryCpConfirmForBugs()
testWorkspaceNamespaceProfileMerge()
testWorkspaceNamespaceMemoryScope()
fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
process.stdout.write('mcp servers smoke test passed\n')
