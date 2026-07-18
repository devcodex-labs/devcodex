#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createTaskIdentity,
  materializeTaskIdentity,
  parseContinuationCommand,
  resolveTaskContinuation,
  validateTaskIdentity
} = require('../hooks/_runtime/task-continuation-contract.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), `devcodex-task-continuation-${process.pid}-`))
const indexPath = path.join(root, '.devcodex', 'workspace', '.runtime-state', 'task-continuation-index.json')

function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function writeTask(project, kind, directoryName, options = {}) {
  const taskRoot = path.join(root, '.devcodex', project, kind, directoryName)
  fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
  const displayName = options.displayName || directoryName
  let identity = null
  if (!options.legacy) {
    identity = createTaskIdentity({
      taskId: options.taskId || crypto.randomUUID(),
      displayName,
      aliases: options.aliases || [],
      createdAt: options.createdAt || '2026-07-18T00:00:00.000Z',
      identityRevision: options.identityRevision || 1
    })
    fs.writeFileSync(path.join(taskRoot, '.memory', 'task.json'), JSON.stringify(identity, null, 2) + '\n')
  }
  const statusSymbol = options.status === 'completed' ? '✅ completed' : (options.status === 'rejected' ? '❌ rejected' : '🔄 active')
  const lines = [`# ${displayName}`, '', `> **当前状态**: ${statusSymbol}`]
  if (options.withCp !== false) {
    const artifact = options.artifact || '# confirmed artifact\n'
    fs.writeFileSync(path.join(taskRoot, '01-需求确认.md'), artifact)
    lines.push('', '| CP | 状态 | 绑定产物 | 版本 | SHA-256 | 来源 | 时间 |')
    lines.push('|:--:|:----:|----------|------|---------|------|------|')
    lines.push(`| CP1 | ✅ | \`../01-需求确认.md\` | v1 | \`${digest(artifact)}\` | test | now |`)
  }
  fs.writeFileSync(path.join(taskRoot, '.memory', 'sessions.md'), lines.join('\n') + '\n')
  return { taskRoot, identity }
}

function resolve(name, extra = {}) {
  return resolveTaskContinuation({ cwd: root, name, scope: 'workspace', ...extra })
}

try {
  fs.mkdirSync(path.join(root, '.devcodex'), { recursive: true })
  fs.writeFileSync(path.join(root, '.devcodex', 'layout.json'), JSON.stringify({ mode: 'workspace-namespace' }) + '\n')
  for (const project of ['alpha', 'beta']) fs.mkdirSync(path.join(root, '.devcodex', project, 'profile'), { recursive: true })

  assert.strictEqual(parseContinuationCommand(' 继续长期优化任务 ').displayQuery, '长期优化')
  assert.strictEqual(parseContinuationCommand('继续 长期 优化').displayQuery, '长期 优化')
  assert.strictEqual(parseContinuationCommand('继续 Hook续接任务').displayQuery, 'Hook续接任务', 'spaced form must preserve a business name ending in 任务')
  assert.strictEqual(parseContinuationCommand('请继续长期优化任务'), null)
  assert.strictEqual(parseContinuationCommand('继续'), null)

  const primary = writeTask('alpha', 'optimizations', 'renamed-directory', {
    displayName: 'Current Performance Task',
    aliases: ['Old Performance Task', '旧性能任务']
  })
  assert.strictEqual(validateTaskIdentity(primary.identity).valid, true)

  const unique = resolve('Current Performance Task')
  assert.strictEqual(unique.status, 'resolved-active')
  assert.strictEqual(unique.candidate.project, 'alpha')
  assert.strictEqual(unique.candidate.taskId, primary.identity.taskId)
  assert.strictEqual(unique.confirmationEvidence.every(item => item.verified), true)
  assert.match(unique.index.state, /^rebuilt-/)
  assert.strictEqual(resolve('Old Performance Task').status, 'resolved-active')
  assert.strictEqual(resolve('旧性能任务').candidate.displayName, 'Current Performance Task')
  assert.strictEqual(resolve(primary.identity.taskId).status, 'resolved-active')

  const workspaceTask = writeTask('workspace', 'optimizations', 'workspace-task', { displayName: 'Workspace Task', withCp: false })
  assert.strictEqual(resolve('Workspace Task').candidate.project, 'workspace')
  assert.strictEqual(resolve(workspaceTask.identity.taskId).status, 'resolved-active')

  const reused = resolve('Current Performance Task')
  assert.strictEqual(reused.index.state, 'reused')

  writeTask('alpha', 'requirements', 'legacy-only', { legacy: true, withCp: false })
  const legacy = resolve('legacy-only')
  assert.strictEqual(legacy.status, 'resolved-active')
  assert.strictEqual(legacy.candidate.legacy, true)
  assert.strictEqual(fs.existsSync(path.join(legacy.candidate.taskRoot, '.memory', 'task.json')), false, 'read-only resolution must not materialize legacy identity')
  const materialized = materializeTaskIdentity({
    taskRoot: legacy.candidate.taskRoot,
    taskId: 'b0cff883-e4d4-4af2-990b-797f453a04bf',
    displayName: 'legacy-only',
    createdAt: '2026-07-18T00:00:00.000Z'
  })
  assert.strictEqual(materialized.identity.taskId, 'b0cff883-e4d4-4af2-990b-797f453a04bf')
  assert.throws(() => materializeTaskIdentity({ taskRoot: legacy.candidate.taskRoot, displayName: 'legacy-only' }), /already exists/)

  writeTask('alpha', 'bugs', 'completed-task', { status: 'completed', withCp: false })
  assert.strictEqual(resolve('completed-task').status, 'completed')
  writeTask('alpha', 'bugs', 'rejected-task', { status: 'rejected', withCp: false })
  assert.strictEqual(resolve('rejected-task').status, 'rejected')

  writeTask('alpha', 'requirements', 'same-one', { displayName: 'Shared Name', withCp: false })
  writeTask('beta', 'requirements', 'same-two', { displayName: 'Shared Name', withCp: false })
  const ambiguous = resolve('Shared Name')
  assert.strictEqual(ambiguous.status, 'ambiguous')
  assert.strictEqual(ambiguous.candidates.length, 2)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(ambiguous.candidates[0], 'taskRoot'), false, 'ambiguous output must stay minimal')

  const notFound = resolve('Current Performance Tas')
  assert.strictEqual(notFound.status, 'not-found')
  assert(notFound.suggestions.some(item => item.displayName === 'Current Performance Task'))
  assert(notFound.suggestions.length <= 5)

  const stale = writeTask('alpha', 'requirements', 'stale-task')
  fs.writeFileSync(path.join(stale.taskRoot, '01-需求确认.md'), '# changed after confirmation\n')
  const staleResolution = resolve('stale-task')
  assert.strictEqual(staleResolution.status, 'stale-confirmation')
  assert.strictEqual(staleResolution.errorCode, 'TASK_CONFIRMATION_STALE')
  assert.strictEqual(staleResolution.staleConfirmations[0].phase, 'CP1')

  const identityFile = path.join(primary.taskRoot, '.memory', 'task.json')
  const revised = createTaskIdentity({
    ...primary.identity,
    aliases: [...primary.identity.aliases, 'New Stable Alias'],
    identityRevision: 2
  })
  fs.writeFileSync(identityFile, JSON.stringify(revised, null, 2) + '\n')
  const renamed = resolve('New Stable Alias')
  assert.strictEqual(renamed.status, 'resolved-active')
  assert.match(renamed.index.state, /^rebuilt-/)

  fs.writeFileSync(indexPath, '{ corrupt derived index', 'utf8')
  const corruptRecovery = resolve('Current Performance Task')
  assert.strictEqual(corruptRecovery.status, 'resolved-active')
  assert.strictEqual(corruptRecovery.index.rebuildReason, 'invalid')

  fs.rmSync(indexPath, { force: true })
  fs.writeFileSync(`${indexPath}.lock`, '{"pid":999999}\n')
  const lockBypass = resolveTaskContinuation({ cwd: root, name: 'Current Performance Task', scope: 'workspace', budgets: {}, persistIndex: true, now: (() => {
    let tick = 0
    return () => (tick += 2001)
  })() })
  assert.strictEqual(lockBypass.status, 'resolved-active')
  assert.strictEqual(lockBypass.index.state, 'rebuilt-bypassed')
  assert.strictEqual(fs.existsSync(`${indexPath}.lock`), true, 'foreign lock must remain untouched')
  fs.rmSync(`${indexPath}.lock`, { force: true })

  const scaleBlocked = resolve('Current Performance Task', { budgets: { maxDirectories: 1, maxBytes: 1024 * 1024 }, persistIndex: false })
  assert.strictEqual(scaleBlocked.status, 'scale-blocked')
  assert.strictEqual(scaleBlocked.errorCode, 'TASK_INDEX_SCALE_BLOCKED')

  const projectScoped = resolveTaskContinuation({ cwd: root, name: 'Current Performance Task', project: 'alpha', scope: 'project', persistIndex: false })
  assert.strictEqual(projectScoped.status, 'resolved-active')
  assert.strictEqual(projectScoped.requestedProject, 'alpha')

  process.stdout.write('task continuation identity/index/resolver tests passed\n')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
