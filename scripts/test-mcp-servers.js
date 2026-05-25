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

function setupTempWorkspace() {
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

function testProfilePrompts() {
  setupTempWorkspace()
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
  setupTempWorkspace()
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
  setupTempWorkspace()
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
  setupTempWorkspace()
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

testProfilePrompts()
testProfileModeFallbackAgent()
testMemoryDefaultAgent()
testMemoryCpConfirmForBugs()
fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
process.stdout.write('mcp servers smoke test passed\n')
