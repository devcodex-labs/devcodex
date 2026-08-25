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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function writeProfile(root, mode) {
  fs.mkdirSync(root, { recursive: true })
  writeJson(path.join(root, 'config.json'), { mode, agent: 'unknown-agent' })
}

function writeTask(project, taskId) {
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', project, 'requirements', `shared-${project}`)
  fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
  writeJson(path.join(taskRoot, '.memory', 'task.json'), {
    schemaVersion: 'TaskIdentityV1',
    taskId,
    displayName: 'Shared Name',
    aliases: [],
    createdAt: '2026-08-25T00:00:00.000Z',
    identityRevision: 1
  })
  fs.writeFileSync(
    path.join(taskRoot, '.memory', 'sessions.md'),
    '# Shared Name\n\n> **当前状态**: 🔄 active\n'
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
      DEVCODEX_TASK_RECOVERY_TEST_RESERVE_BYTES: '8192'
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

function outputText(output) {
  return String(output.systemMessage || output.hookSpecificOutput?.additionalContext || '')
}

function injectCrossProjectSentinel() {
  for (const project of ['alpha', 'workspace']) {
    const file = lifecycleStateFile(project)
    if (!fs.existsSync(file)) continue
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.cp3Runtime = {
      ...(state.cp3Runtime || {}),
      crossProjectSentinel: 'must-not-cross-session'
    }
    writeJson(file, state)
  }
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
  assert.strictEqual(copiedLease.errorCode, 'TASK_PROJECT_LEASE_MISMATCH')

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
  assert.strictEqual(staleRevision.status, 'stale')
  assert.strictEqual(staleRevision.errorCode, 'TASK_ROUTE_REVISION_STALE')

  const crossedProject = decideTaskContinuationTarget({
    ...freshInput,
    routeHint: {
      ...freshInput.routeHint,
      entry: { ...freshInput.routeHint.entry, projectRootIdentityDigest: 'd'.repeat(64) }
    }
  })
  assert.strictEqual(crossedProject.errorCode, 'TASK_SESSION_ROUTE_PROJECT_MISMATCH')

  const noStableSession = decideTaskContinuationTarget({
    ...freshInput,
    sessionRef: ''
  })
  assert.strictEqual(noStableSession.errorCode, 'TASK_SESSION_REQUIRED')

  const unboundName = decideTaskContinuationTarget({ command, layoutEnabled: true })
  assert.strictEqual(unboundName.errorCode, 'TASK_PROJECT_REQUIRED')

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

  run({
    hookEventName: 'UserPromptSubmit',
    prompt: '检查 alpha 项目'
  })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: path.join(TEMP_ROOT, 'alpha', 'package.json') }
  })
  assert.strictEqual(readState('alpha').lastEvent, 'PreToolUse')
  assert.strictEqual(readState('alpha').stickyProject.authorityKind, 'turn')

  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-alpha',
    prompt: '修复 alpha 项目'
  })
  const sameSession = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-alpha',
    prompt: '继续 Shared Name'
  })
  assert.match(outputText(sameSession), /TaskResolutionV1 resolved-active: alpha\//)
  assert.strictEqual(readState('alpha').taskContinuation.candidate.project, 'alpha')
  assert.strictEqual(readState('alpha').taskContinuation.targetDecision.source, 'session-project-lease')

  injectCrossProjectSentinel()
  const newSession = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-unbound',
    prompt: '继续 Shared Name'
  })
  assert.match(outputText(newSession), /TASK_PROJECT_REQUIRED|task name cannot select a project/i)
  let workspaceState = readState('workspace')
  assert.strictEqual(workspaceState.activeProject, '')
  assert.strictEqual(workspaceState.taskContinuation.errorCode, 'TASK_PROJECT_REQUIRED')
  assert.strictEqual(workspaceState.cp3Runtime?.crossProjectSentinel, undefined)

  injectCrossProjectSentinel()
  const noSession = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '继续 Shared Name'
  })
  assert.match(outputText(noSession), /TASK_PROJECT_REQUIRED|task name cannot select a project/i)
  workspaceState = readState('workspace')
  assert.strictEqual(workspaceState.activeProject, '')
  assert.strictEqual(workspaceState.cp3Runtime?.crossProjectSentinel, undefined)

  const qualified = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-qualified',
    prompt: '继续 Shared Name，项目=beta'
  })
  assert.match(outputText(qualified), /TaskResolutionV1 resolved-active: beta\//)
  const betaState = readState('beta')
  assert.strictEqual(betaState.taskContinuation.status, 'resolved-active')
  assert.strictEqual(betaState.taskContinuation.candidate.project, 'beta')
  assert.strictEqual(betaState.taskContinuation.targetDecision.source, 'continuation-project-qualifier')

  const byStableId = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-task-id',
    prompt: `继续 ${BETA_TASK_ID}`
  })
  assert.match(outputText(byStableId), /TaskResolutionV1 resolved-active: beta\//)
  assert.strictEqual(readState('beta').taskContinuation.candidate.taskId, BETA_TASK_ID)
  assert.strictEqual(readState('beta').taskContinuation.targetDecision.source, 'actual-stable-task-id')

  process.stdout.write('session route and task continuation consumer negatives passed\n')
} finally {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
}
