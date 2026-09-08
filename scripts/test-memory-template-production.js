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
fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({
  schemaVersion: 'MemoryTemplateProductionTestV1', passed: true,
  production: second.transaction.templateProduction,
  scopedQualification: written.templateQualification, priorSessionUnchanged: true
}, null, 2) + '\n')
console.log(`Memory template production and session isolation passed: ${root}`)
