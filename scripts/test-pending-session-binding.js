'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildTestHooksRuntimeFixtures } = require('./lib/test-hooks-runtime-fixtures')

const root = path.resolve(__dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-pending-session-'))
const fixtures = buildTestHooksRuntimeFixtures({
  fs, path, process, spawnSync,
  RUNTIME: path.join(root, 'hooks', '_runtime', 'lifecycle.cjs'),
  PROFILE_SERVER: path.join(root, 'mcp', 'profile-server.js'),
  TEMP_ROOT: tempRoot,
  STATE_FILE: path.join(tempRoot, '.devcodex', '.memory', 'hooks', 'legacy', 'lifecycle-state.json'),
  TEST_AGENT: 'codex'
})
const env = { DEVCODEX_HOST_PLATFORM: 'codex' }
const readWorkspace = () => JSON.parse(fs.readFileSync(fixtures.getWorkspaceLayoutStateFile(), 'utf8'))

function admitFixture() {
  const args = {
    operation: 'admit', project: 'devcodex', scope: 'project',
    task: { taskKind: 'bugs', entryVariant: 'fix', displayName: 'pending-binding-fixture' },
    overview: { content: '# Pending binding fixture\n\nRestore this session only.\n' }
  }
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_task_admit_v2', arguments: args } }
  const child = spawnSync(process.execPath, [path.join(root, 'mcp', 'memory-server.js'), tempRoot], {
    cwd: tempRoot, input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: { ...process.env, DEVCODEX_AGENT: 'codex', DEVCODEX_HOST_SESSION_ID: '', DEVCODEX_CONTEXT_EPOCH: '' }
  })
  assert.strictEqual(child.status, 0, child.stderr)
  const response = JSON.parse(child.stdout.trim().split(/\r?\n/)[0]).result
  assert.notStrictEqual(response.isError, true, JSON.stringify(response))
  return response.structuredContent || JSON.parse(response.content[0].text)
}

/** Exercise real Hook/MCP boundaries, including a foreign shared projection. */
function scenario(interleave) {
  fixtures.cleanLayoutMultiProjectState({ workspaceProfile: true })
  const session = `pending-session-${interleave}`
  const profile = path.join(tempRoot, '.devcodex', 'devcodex', 'profile')
  fs.writeFileSync(path.join(profile, 'README.md'), '# Profile\n\nProfile 档位：`profile-lite`。\n')
  for (const name of ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md']) {
    fs.writeFileSync(path.join(profile, name), `# ${name}\n\nFixture.\n`)
  }
  fixtures.run({ hookEventName: 'UserPromptSubmit', session_id: session, prompt: '检查当前工作区状态' }, tempRoot, env)
  const ingress = readWorkspace()
  assert.strictEqual(ingress.contextAcquisition.targetResolved, false)
  const args = {
    intent: 'fix', project: 'devcodex', changeTypes: ['source-code'],
    contextEpoch: ingress.contextAcquisition.contextEpoch,
    host: 'codex-cli/exec-user-global-local-stdio'
  }
  const foreign = () => fixtures.run({
    hookEventName: 'UserPromptSubmit', session_id: 'foreign-session', prompt: '检查另一个当前会话'
  }, tempRoot, env)
  const event = {
    session_id: session, tool_use_id: `plan-${interleave}`,
    tool_name: 'mcp__devcodex-profile__profile_context_plan', tool_input: args
  }
  if (interleave === 'before-pre') foreign()
  fixtures.run({ ...event, hookEventName: 'PreToolUse' }, tempRoot, env)
  const before = readWorkspace()
  assert.strictEqual(before.contextAcquisition.contextEpoch, args.contextEpoch,
    `${interleave}: PreToolUse must recover the caller's canonical epoch`)
  assert.strictEqual(before.actualInstructionEnvelope.envelopeDigest, ingress.actualInstructionEnvelope.envelopeDigest)
  const durable = require('../hooks/_runtime/task-recovery-store-v5.cjs').readTaskRecoveryState({
    metaDir: path.dirname(fixtures.getWorkspaceLayoutStateFile()), sessionKey: session
  })
  assert(durable.state?.contextAcquisition?.inFlight?.length,
    `${interleave}: the canonical ring must retain the pending read before another session can overwrite the projection`)
  const result = fixtures.callProfileTool(tempRoot, 'profile_context_plan', args)
  assert.notStrictEqual(result.isError, true, JSON.stringify(result))
  if (interleave === 'before-post') foreign()
  fixtures.run({ ...event, hookEventName: 'PostToolUse', tool_response: result }, tempRoot, env)
  const rebound = JSON.parse(fs.readFileSync(fixtures.getLayoutStateFile('devcodex'), 'utf8'))
  assert.strictEqual(rebound.activeProject, 'devcodex', `${interleave}: target must bind`)
  assert.strictEqual(rebound.contextAcquisition.contextEpoch, args.contextEpoch)
  assert.strictEqual(rebound.contextAcquisition.hostSessionId, session)
  assert.strictEqual(rebound.actualInstructionEnvelope.envelopeDigest, ingress.actualInstructionEnvelope.envelopeDigest,
    'a foreign instruction must never authorize this context')
  assert.strictEqual(rebound.stickyProject.contextEpoch, args.contextEpoch)
  assert.strictEqual(rebound.workflowRouteDecision.routeKey, 'fix.default')
  if (interleave === 'none') {
    const admission = admitFixture()
    assert.strictEqual(admission.finalized, true)
    foreign()
    fixtures.run({
      hookEventName: 'PreToolUse', session_id: session,
      tool_name: 'mcp__devcodex-profile__profile_get_mode', tool_input: { project: 'devcodex' }
    }, tempRoot, env)
    const current = require('../hooks/_runtime/task-recovery-store-v5.cjs').readTaskRecoveryState({
      metaDir: path.dirname(fixtures.getLayoutStateFile('devcodex')), sessionKey: session
    })
    assert.strictEqual(current.status, 'fresh', 'a formal admission must supersede the old workspace stub')
    assert.strictEqual(current.state.taskRecoveryBinding.taskId, admission.taskId)
    assert.strictEqual(current.state.contextAcquisition.contextEpoch, args.contextEpoch)
  }
  process.stdout.write(`pending session ${interleave}: PASS\n`)
}

try {
  for (const interleave of ['none', 'before-pre', 'before-post']) scenario(interleave)
} finally {
  if (process.env.DEVCODEX_TEST_KEEP_TEMP !== '1') fs.rmSync(tempRoot, { recursive: true, force: true })
  else process.stdout.write(`Retained pending-session fixture: ${tempRoot}\n`)
}
