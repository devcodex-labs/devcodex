'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-memory-template-'))
const projectRoot = path.join(root, 'project')
const activeRoot = path.join(projectRoot, '.devcodex')
fs.mkdirSync(activeRoot, { recursive: true })
fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"template-fixture"}\n')
const env = {
  ...process.env, DEVCODEX_TEST_HOME: path.join(root, 'home'),
  HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
  CODEX_HOME: path.join(root, 'home', '.codex'), DEVCODEX_AGENT: 'codex',
  DEVCODEX_HOST_SESSION_ID: '', GROK_AGENT: '', GROK_HOME: ''
}
function call(name, args) {
  const child = spawnSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'memory-server.js'), projectRoot], {
    cwd: projectRoot, env, encoding: 'utf8', timeout: 30000,
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n'
  })
  assert.strictEqual(child.status, 0, child.stderr)
  const response = child.stdout.trim().split(/\r?\n/).map(JSON.parse).find(value => value.id === 1)
  assert(!response.error && !response.result?.isError, JSON.stringify(response))
  return response.result.structuredContent || JSON.parse(response.result.content[0].text)
}
const date = '20260908'
const first = call('memory_session_allocate', { date, title: '已有完整会话', intent: 'audit' })
const second = call('memory_session_allocate', { date, title: '本次会话', intent: 'fix' })
assert.strictEqual(first.transaction.templateProductionReadback, 'PASS')
assert.strictEqual(first.transaction.templateQualification.status, 'qualified')
assert.strictEqual(second.transaction.templateProductionReadback, 'PASS')
assert.strictEqual(second.transaction.templateQualification.status, 'qualified')
assert.strictEqual(second.transaction.templateQualification.intentSatisfaction, 'UNVERIFIED')
const dailyPath = path.join(activeRoot, '.memory', 'clients', 'codex', 'tasks', `${date}.md`)
const before = fs.readFileSync(dailyPath, 'utf8')
const secondStart = before.indexOf(`## 会话 ${second.sessionId}`)
assert(secondStart > 0)
// Corrupt only the current session's structure. The old complete session must
// remain intact and must not make a fragment qualify as a complete session.
const prior = before.slice(0, secondStart)
fs.writeFileSync(dailyPath, prior + before.slice(secondStart).replace('### 📨 对话记录', '### 当前进度'))
const written = call('memory_session_write', {
  date, sessionId: second.sessionId, sessionBinding: second.sessionBinding,
  content: '正在复核本次模板问题，尚未完成。\n'
})
assert.strictEqual(written.templateQualification.status, 'rejected')
assert.strictEqual(written.templateQualification.artifactScope.sessionId, second.sessionId)
assert.strictEqual(written.templateQualification.intentSatisfaction, 'UNVERIFIED')
const after = fs.readFileSync(dailyPath, 'utf8')
assert.strictEqual(after.slice(0, secondStart), prior)
assert.strictEqual(written.templateQualification.artifactDigest,
  crypto.createHash('sha256').update(after.slice(secondStart)).digest('hex'))
assert.strictEqual(written.sessionWrite.nonTargetStable, true)
const summary = call('memory_summary_append', {
  entry: { date, sessionId: second.sessionId, type: 'fix', summary: '本次会话结构缺失已观测，任务仍在验证。', status: 'active' }
})
assert.strictEqual(summary.rowProductionMode, 'template-rendered')
assert.deepStrictEqual(summary.templateProductions.map(value => value.blockId), ['summary-header', 'summary-row'])
assert.strictEqual(summary.templateQualification.intentSatisfaction, 'UNVERIFIED')
const legacy = call('memory_summary_append', {
  row: `| 2026-09-08 | ${second.sessionId} | fix | 后续验证仍未完成 | — | — | active |`
})
assert.strictEqual(legacy.rowProductionMode, 'legacy-caller-row')
assert.deepStrictEqual(legacy.templateProductions, [])
console.log(`Memory template production and session isolation passed: ${root}`)

// One desktop conversation can contain several requests for the same task.
// The production allocator must isolate those requests without losing retry identity.
const lifecycleDir = path.join(activeRoot, '.memory', 'hooks', 'legacy')
fs.mkdirSync(lifecycleDir, { recursive: true })
const lifecyclePath = path.join(lifecycleDir, 'lifecycle-state.json')
env.DEVCODEX_HOST_SESSION_ID = 'template-request-owner'
function requestEpoch(epoch, host = env.DEVCODEX_HOST_SESSION_ID) {
  fs.writeFileSync(lifecyclePath, JSON.stringify({
    contextAcquisition: { hostSessionId: host, contextEpoch: epoch },
    taskRecoveryBinding: { taskId: 'same-formal-task' }
  }))
}
requestEpoch('request-one')
const requestOne = call('memory_session_allocate', { date, title: '检查安装', intent: 'analyze' })
const requestRetry = call('memory_session_allocate', { date, title: '检查安装', intent: 'analyze' })
assert.strictEqual(requestRetry.sessionBinding, requestOne.sessionBinding)
requestEpoch('request-two')
const requestTwo = call('memory_session_allocate', { date, title: '重启后验证', intent: 'analyze' })
assert.notStrictEqual(requestTwo.sessionId, requestOne.sessionId, 'new request needs its own summary identity')
assert.notStrictEqual(requestTwo.sessionBinding, requestOne.sessionBinding)
const implicit = call('memory_session_write', { date, content: '仅属于第二个请求。\n' })
assert.strictEqual(implicit.templateQualification.artifactScope.sessionId, requestTwo.sessionId)
const explicit = call('memory_session_write', {
  date, sessionId: requestOne.sessionId, sessionBinding: requestOne.sessionBinding,
  content: '显式绑定仍可补充历史请求。\n'
})
assert.strictEqual(explicit.templateQualification.artifactScope.sessionId, requestOne.sessionId)
requestEpoch('foreign-one', 'different-host')
const foreignOne = call('memory_session_allocate', { date, title: '兼容回退', intent: 'analyze' })
requestEpoch('foreign-two', 'different-host')
const foreignTwo = call('memory_session_allocate', { date, title: '兼容回退', intent: 'analyze' })
assert.strictEqual(foreignOne.sessionBinding, foreignTwo.sessionBinding, 'foreign epochs must not affect this host')
console.log('Request epoch isolation, retry, legacy binding and foreign-host probes passed')

const profileChild = spawnSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'profile-server.js'), projectRoot], {
  cwd: projectRoot, env, encoding: 'utf8', timeout: 30000,
  input: [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
      name: 'profile_context_plan', arguments: { intent: 'analyze', stage: 'validation' }
    } }
  ].map(JSON.stringify).join('\n') + '\n'
})
assert.strictEqual(profileChild.status, 0, profileChild.stderr)
const profileResponses = profileChild.stdout.trim().split(/\r?\n/).map(JSON.parse)
const profileTools = profileResponses.find(value => value.id === 1).result.tools
const contextTool = profileTools.find(tool => tool.name === 'profile_context_plan')
assert(contextTool, 'context tool must be discoverable')
for (const field of ['routeKey', 'subtype', 'stage']) {
  assert(contextTool.inputSchema.properties[field].description.includes('全部省略'))
}
const partialRoute = profileResponses.find(value => value.id === 2).result
assert.strictEqual(JSON.parse(partialRoute.content[0].text).errorCode, 'WORKFLOW_ROUTE_UNRESOLVED')
fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({
  schemaVersion: 'MemoryTemplateProductionTestV1', passed: true,
  production: second.transaction.templateProduction,
  scopedQualification: written.templateQualification, priorSessionUnchanged: true,
  requestEpochIsolation: true, routeContractDescription: true
}, null, 2) + '\n')
