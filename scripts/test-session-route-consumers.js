#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  decideTaskContinuationTarget
} = require('../hooks/_runtime/task-continuation-ingress.cjs')
const {
  parseContinuationCommand
} = require('../hooks/_runtime/task-continuation-contract.cjs')
const {
  digestSessionRef
} = require('../hooks/_runtime/workspace-session-route-index-v1.cjs')
const {
  resolveWorkflowRouteDescriptor
} = require('../hooks/_runtime/workflow-route-decision-v2.cjs')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), `devcodex-session-route-consumers-${process.pid}-`))
const CURRENT_ROUTE_REVISION = resolveWorkflowRouteDescriptor({
  topIntent: 'resume',
  routeKey: 'resume'
}).registry.routeRevision
const ALPHA_TASK_ID = '11111111-1111-4111-8111-111111111111'
const BETA_TASK_ID = '22222222-2222-4222-8222-222222222222'
const ALPHA_SECOND_TASK_ID = '33333333-3333-4333-8333-333333333333'

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function writeProfile(root, mode) {
  fs.mkdirSync(root, { recursive: true })
  writeJson(path.join(root, 'config.json'), { mode, agent: 'unknown-agent' })
}

function writeTask(project, taskId, directoryName = `shared-${project}`, displayName = 'Shared Name') {
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', project, 'requirements', directoryName)
  fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
  writeJson(path.join(taskRoot, '.memory', 'task.json'), {
    schemaVersion: 'TaskIdentityV1',
    taskId,
    displayName,
    aliases: [],
    createdAt: '2026-08-25T00:00:00.000Z',
    identityRevision: 1
  })
  fs.writeFileSync(
    path.join(taskRoot, '.memory', 'sessions.md'),
    `# ${displayName}\n\n> **当前状态**: 🔄 active\n`
  )
}

function lifecycleStateFile(project) {
  return path.join(
    TEMP_ROOT,
    '.devcodex',
    project,
    '.memory',
    'hooks',
    project,
    'lifecycle-state.json'
  )
}

function run(payload) {
  const result = spawnSync(process.execPath, [RUNTIME], {
    cwd: TEMP_ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      GROK_AGENT: '',
      GROK_HOME: '',
      GROK_SESSION: '',
      DEVCODEX_TASK_RECOVERY_TEST_MODE: '1',
      DEVCODEX_TASK_RECOVERY_TEST_RESERVE_BYTES: '8192',
      DEVCODEX_HOST_PLATFORM: 'codex'
    }
  })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'lifecycle failed').trim())
  }
  return JSON.parse(result.stdout || '{}')
}

function readState(project) {
  return JSON.parse(fs.readFileSync(lifecycleStateFile(project), 'utf8'))
}

function resolveTask(name, options = {}) {
  const args = { name, scope: options.project ? 'project' : 'workspace', persistIndex: false, locale: 'zh-CN', ...options }
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_task_resolve', arguments: args } }
  const result = spawnSync(process.execPath, [path.join(ROOT, 'mcp', 'memory-server.js'), TEMP_ROOT], {
    cwd: TEMP_ROOT, input: JSON.stringify(request) + '\n', encoding: 'utf8', windowsHide: true,
    env: { ...process.env, DEVCODEX_HOST_PLATFORM: 'codex' }
  })
  assert.strictEqual(result.status, 0, result.stderr)
  const response = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line)).find(item => item.id === 1)?.result
  assert(response && response.isError !== true, JSON.stringify(response))
  return response.structuredContent
}

function assertTargetDecisionNegatives() {
  const command = parseContinuationCommand('继续 Shared Name')
  const sessionDigest = digestSessionRef('session-a')
  const rootDigest = 'a'.repeat(64)
  const lease = {
    schemaVersion: 'ProjectTargetLeaseV2',
    project: 'alpha',
    authorityKind: 'session',
    authorityDigest: sessionDigest,
    rootIdentityDigest: rootDigest,
    routeRevision: CURRENT_ROUTE_REVISION,
    leaseDigest: 'b'.repeat(64)
  }
  const freshInput = {
    command,
    layoutEnabled: true,
    promptTarget: { activeProject: 'alpha', activeScope: 'project', source: 'sticky' },
    sessionRef: 'session-a',
    projectLeaseValidation: { valid: true, reason: '', lease },
    routeHint: {
      status: 'fresh',
      sessionDigest,
      entry: {
        state: 'live',
        sessionDigest,
        projectRootIdentityDigest: rootDigest,
        routeRevision: CURRENT_ROUTE_REVISION
      }
    },
    currentRouteRevision: CURRENT_ROUTE_REVISION
  }
  const fresh = decideTaskContinuationTarget(freshInput)
  assert.strictEqual(fresh.status, 'verified')
  assert.strictEqual(fresh.project, 'alpha')
  assert.strictEqual(fresh.mutationAuthority, false)

  const copiedLease = decideTaskContinuationTarget({
    ...freshInput,
    sessionRef: 'session-b',
    projectLeaseValidation: { valid: false, reason: 'session-or-turn-drift', lease: null }
  })
  assert.strictEqual(copiedLease.status, 'verified')
  assert.strictEqual(copiedLease.scope, 'workspace')
  assert.strictEqual(copiedLease.evidence.discardedHintErrorCode, 'TASK_PROJECT_LEASE_MISMATCH')
  assert.strictEqual(copiedLease.mutationAuthority, false)

  const staleRevision = decideTaskContinuationTarget({
    ...freshInput,
    projectLeaseValidation: {
      valid: true,
      reason: '',
      lease: { ...lease, routeRevision: 'c'.repeat(64) }
    },
    routeHint: {
      ...freshInput.routeHint,
      entry: { ...freshInput.routeHint.entry, routeRevision: 'c'.repeat(64) }
    }
  })
  assert.strictEqual(staleRevision.status, 'verified')
  assert.strictEqual(staleRevision.scope, 'workspace')
  assert.strictEqual(staleRevision.evidence.discardedHintErrorCode, 'TASK_ROUTE_REVISION_STALE')

  const crossedProject = decideTaskContinuationTarget({
    ...freshInput,
    routeHint: {
      ...freshInput.routeHint,
      entry: { ...freshInput.routeHint.entry, projectRootIdentityDigest: 'd'.repeat(64) }
    }
  })
  assert.strictEqual(crossedProject.status, 'verified')
  assert.strictEqual(crossedProject.evidence.discardedHintErrorCode, 'TASK_SESSION_ROUTE_PROJECT_MISMATCH')

  const noStableSession = decideTaskContinuationTarget({
    ...freshInput,
    sessionRef: ''
  })
  assert.strictEqual(noStableSession.status, 'verified')
  assert.strictEqual(noStableSession.evidence.discardedHintErrorCode, 'TASK_SESSION_REQUIRED')

  const unboundName = decideTaskContinuationTarget({ command, layoutEnabled: true })
  assert.strictEqual(unboundName.status, 'verified')
  assert.strictEqual(unboundName.scope, 'workspace')
  assert.strictEqual(unboundName.source, 'named-workspace-locator')
  assert.strictEqual(unboundName.mutationAuthority, false)

  const bare = decideTaskContinuationTarget({ command: parseContinuationCommand('继续'), layoutEnabled: true })
  assert.strictEqual(bare.status, 'verified')
  assert.strictEqual(bare.scope, 'workspace')
  assert.strictEqual(bare.source, 'bare-workspace-locator')
  assert.strictEqual(bare.mutationAuthority, false)

  const stableId = decideTaskContinuationTarget({
    command: parseContinuationCommand(`继续 ${BETA_TASK_ID}`),
    layoutEnabled: true,
    actualInstructionBound: true
  })
  assert.strictEqual(stableId.status, 'verified')
  assert.strictEqual(stableId.scope, 'workspace')
  assert.strictEqual(stableId.source, 'actual-stable-task-id')
}

try {
  assertTargetDecisionNegatives()

  writeJson(path.join(TEMP_ROOT, '.devcodex', 'layout.json'), {
    version: 1,
    mode: 'workspace-namespace'
  })
  writeProfile(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'), 'prod')
  for (const project of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(TEMP_ROOT, project), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, project, 'package.json'), '{}\n')
    writeProfile(path.join(TEMP_ROOT, '.devcodex', project, 'profile'), 'dev')
  }
  writeTask('alpha', ALPHA_TASK_ID)
  writeTask('beta', BETA_TASK_ID)

  // The Hook consumes explicit host facts; the model supplies task selectors
  // through the public locator. Prose and quoted history grant no authority.
  run({ hookEventName: 'UserPromptSubmit', prompt: '检查 alpha 项目' })
  assert.strictEqual(fs.existsSync(lifecycleStateFile('alpha')), false)
  run({ hookEventName: 'UserPromptSubmit', project: 'alpha', prompt: '检查当前项目' })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: path.join(TEMP_ROOT, 'alpha', 'package.json') }
  })
  assert.strictEqual(readState('alpha').lastEvent, 'PreToolUse')
  assert.strictEqual(readState('alpha').stickyProject.authorityKind, 'turn')

  run({ hookEventName: 'UserPromptSubmit', session_id: 'session-alpha', project: 'alpha', prompt: '修复当前项目' })
  run({ hookEventName: 'UserPromptSubmit', session_id: 'session-alpha', prompt: '继续 Shared Name' })
  assert.strictEqual(readState('alpha').activeProject, 'alpha')
  assert.strictEqual(readState('alpha').taskContinuation ?? null, null)

  for (const session of ['session-unbound', undefined]) {
    run({ hookEventName: 'UserPromptSubmit', session_id: session, prompt: '继续 Shared Name' })
    const state = readState('workspace')
    assert.strictEqual(state.activeProject, '')
    assert.strictEqual(state.taskContinuation ?? null, null)
    assert.strictEqual(state.fencedWriteOwner ?? null, null)
  }

  const ambiguous = resolveTask('Shared Name')
  assert.strictEqual(ambiguous.status, 'ambiguous')
  assert.strictEqual(ambiguous.errorCode, 'TASK_AMBIGUOUS')
  assert.strictEqual(ambiguous.candidates.length, 2)
  assert.strictEqual(ambiguous.mutationAuthority, false)

  const alpha = resolveTask('Shared Name', { project: 'alpha' })
  assert.strictEqual(alpha.status, 'resolved-active')
  assert.strictEqual(alpha.candidate.taskId, ALPHA_TASK_ID)
  assert.strictEqual(alpha.mutationAuthority, false)
  const beta = resolveTask(BETA_TASK_ID)
  assert.strictEqual(beta.status, 'resolved-active')
  assert.strictEqual(beta.candidate.project, 'beta')
  assert.strictEqual(beta.mutationAuthority, false)
  const wrongProject = resolveTask(BETA_TASK_ID, { project: 'alpha' })
  assert.notStrictEqual(wrongProject.status, 'resolved-active')
  assert.strictEqual(wrongProject.mutationAuthority, false)
  assert.strictEqual(resolveTask('继续 Shared Name').status, 'not-found')
  assert.strictEqual(resolveTask('Shared Name，项目=beta').status, 'not-found')

  writeTask('alpha', ALPHA_SECOND_TASK_ID, 'second-alpha', 'Second Alpha Task')
  run({
    hookEventName: 'UserPromptSubmit', session_id: 'session-history', prompt: '继续',
    messages: [{ role: 'assistant', content: '上次正在处理 requirements/second-alpha/，请从该任务继续。' }]
  })
  assert.strictEqual(readState('workspace').taskContinuation ?? null, null)
  const second = resolveTask(ALPHA_SECOND_TASK_ID, { project: 'alpha' })
  assert.strictEqual(second.candidate.taskId, ALPHA_SECOND_TASK_ID)
  assert.strictEqual(second.mutationAuthority, false)

  const alphaSessions = path.join(TEMP_ROOT, '.devcodex', 'alpha', 'requirements', 'shared-alpha', '.memory', 'sessions.md')
  fs.unlinkSync(alphaSessions)
  const stale = resolveTask(ALPHA_TASK_ID, { project: 'alpha' })
  assert.strictEqual(stale.status, 'stale-confirmation')
  assert.strictEqual(stale.mutationAuthority, false)

  process.stdout.write('session route and task continuation consumer negatives passed\n')
} finally {
  if (process.env.DEVCODEX_TEST_KEEP_TEMP === '1') {
    process.stdout.write('session consumer fixture retained: ' + TEMP_ROOT + '\n')
  } else {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  }
}
