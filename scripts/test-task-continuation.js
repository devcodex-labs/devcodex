#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createTaskIdentity,
  isStableTaskId,
  materializeTaskIdentity,
  parseContinuationCommand,
  resolveTaskContinuation,
  resolveUniqueActiveTaskContinuation,
  validateTaskIdentity
} = require('../hooks/_runtime/task-continuation-contract.cjs')
const { resolveRuntimeStateRoot } = require('../hooks/_runtime/workspace-layout.cjs')
const {
  createOptimizationState,
  persistOptimizationState
} = require('./lib/execution-optimization')

const root = fs.mkdtempSync(path.join(os.tmpdir(), `devcodex-task-continuation-${process.pid}-`))
const workspaceActiveRoot = path.join(root, '.devcodex', 'workspace')
let indexPath

function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value))
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
  indexPath = path.join(resolveRuntimeStateRoot(workspaceActiveRoot, 'workspace').root, 'task-continuation-index.json')
  for (const project of ['alpha', 'beta']) fs.mkdirSync(path.join(root, '.devcodex', project, 'profile'), { recursive: true })

  assert.strictEqual(parseContinuationCommand(' 继续长期优化任务 ').displayQuery, '长期优化')
  assert.strictEqual(parseContinuationCommand('继续 长期 优化').displayQuery, '长期 优化')
  assert.strictEqual(parseContinuationCommand('继续 Hook续接任务').displayQuery, 'Hook续接任务', 'spaced form must preserve a business name ending in 任务')
  const qualifiedCommand = parseContinuationCommand('继续 Shared Name，项目=alpha')
  assert.strictEqual(qualifiedCommand.displayQuery, 'Shared Name')
  assert.strictEqual(qualifiedCommand.projectQuery, 'alpha')
  assert.strictEqual(qualifiedCommand.projectQualifierForm, 'explicit-project-suffix')
  assert.strictEqual(parseContinuationCommand('请继续长期优化任务'), null)
  const bareCommand = parseContinuationCommand('继续')
  assert.strictEqual(bareCommand.form, 'continue-bare')
  assert.strictEqual(bareCommand.bare, true)
  assert.strictEqual(bareCommand.displayQuery, '')

  const primary = writeTask('alpha', 'optimizations', 'renamed-directory', {
    displayName: 'Current Performance Task',
    aliases: ['Old Performance Task', '旧性能任务']
  })
  assert.strictEqual(validateTaskIdentity(primary.identity).valid, true)
  assert.strictEqual(isStableTaskId(primary.identity.taskId), true)
  assert.strictEqual(isStableTaskId('Current Performance Task'), false)

  const unique = resolve('Current Performance Task')
  assert.strictEqual(unique.status, 'resolved-active')
  assert.strictEqual(unique.candidate.project, 'alpha')
  assert.strictEqual(unique.candidate.taskId, primary.identity.taskId)
  assert.strictEqual(unique.mutationAuthority, false, 'locator resolution must never grant mutation authority')
  assert.strictEqual(unique.confirmationEvidence.every(item => item.verified), true)
  assert.match(unique.index.state, /^rebuilt-/)
  assert.strictEqual(resolve('Old Performance Task').status, 'resolved-active')
  assert.strictEqual(resolve('旧性能任务').candidate.displayName, 'Current Performance Task')
  assert.strictEqual(resolve('renamed-directory').candidate.taskId, primary.identity.taskId)
  assert.strictEqual(resolve(primary.identity.taskId).status, 'resolved-active')
  const uniqueActive = resolveUniqueActiveTaskContinuation({ cwd: root, project: 'alpha', scope: 'project' })
  assert.strictEqual(uniqueActive.status, 'resolved-active')
  assert.strictEqual(uniqueActive.candidate.taskId, primary.identity.taskId)

  const workspaceTask = writeTask('workspace', 'optimizations', 'workspace-task', { displayName: 'Workspace Task', withCp: false })
  assert.strictEqual(resolve('Workspace Task').candidate.project, 'workspace')
  assert.strictEqual(resolve(workspaceTask.identity.taskId).status, 'resolved-active')

  const reused = resolve('Current Performance Task')
  assert.strictEqual(reused.index.state, 'reused')

  fs.mkdirSync(path.join(root, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.writeFileSync(path.join(root, '.devcodex', 'workspace', 'profile', 'config.json'), JSON.stringify({
    mode: 'dev',
    extensions: { devcodex: { executionOptimization: { mode: 'full-only' } } }
  }, null, 2) + '\n')
  fs.rmSync(indexPath, { force: true })
  const fullOnlyResolution = resolve('Current Performance Task')
  assert.strictEqual(fullOnlyResolution.status, 'resolved-active')
  assert.strictEqual(fullOnlyResolution.index.state, 'disabled-full-only')
  assert.strictEqual(fs.existsSync(indexPath), false, 'full-only resolver must not read or write the derived index')
  fs.writeFileSync(path.join(root, '.devcodex', 'workspace', 'profile', 'config.json'), JSON.stringify({ mode: 'dev' }, null, 2) + '\n')

  const optimizationRoot = workspaceActiveRoot
  const rolledBackIndex = createOptimizationState({ featureStates: { 'task-index-acceleration': 'rolled-back' } })
  assert.strictEqual(persistOptimizationState(optimizationRoot, rolledBackIndex).status, 'persisted')
  const lifecycleDisabled = resolve('Current Performance Task')
  assert.strictEqual(lifecycleDisabled.index.state, 'disabled-feature-lifecycle')
  assert.strictEqual(lifecycleDisabled.index.featureDecision.lifecycleState, 'rolled-back')
  assert.strictEqual(lifecycleDisabled.index.featureDecision.reasonCode, 'feature-rolled-back')
  fs.rmSync(path.join(resolveRuntimeStateRoot(optimizationRoot, 'workspace').root, 'execution-optimization'), { recursive: true, force: true })

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
  const ambiguousActive = resolveUniqueActiveTaskContinuation({ cwd: root, scope: 'workspace' })
  assert.strictEqual(ambiguousActive.status, 'ambiguous')
  assert.strictEqual(ambiguousActive.errorCode, 'TASK_AMBIGUOUS')
  const projectQualifiedDuplicate = resolveTaskContinuation({
    cwd: root,
    name: qualifiedCommand.displayQuery,
    project: qualifiedCommand.projectQuery,
    scope: 'project',
    persistIndex: false
  })
  assert.strictEqual(projectQualifiedDuplicate.status, 'resolved-active')
  assert.strictEqual(projectQualifiedDuplicate.candidate.project, 'alpha')

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

  const evolved = writeTask('alpha', 'requirements', 'evolved-task')
  fs.writeFileSync(path.join(evolved.taskRoot, '01-需求确认.md'), '# legitimately evolved historical requirement\n')
  const successor = '# confirmed successor design\n'
  fs.writeFileSync(path.join(evolved.taskRoot, '02-技术方案.md'), successor)
  fs.appendFileSync(path.join(evolved.taskRoot, '.memory', 'sessions.md'), `| CP2 | ✅ | \`../02-技术方案.md\` | v2 | \`${digest(successor)}\` | test | later |\n`)
  const evolvedResolution = resolve('evolved-task', { persistIndex: false })
  assert.strictEqual(evolvedResolution.status, 'resolved-active', 'a verified successor head must supersede historical digest drift')
  assert.strictEqual(evolvedResolution.latestConfirmedHead.phase, 'CP2')
  assert.strictEqual(evolvedResolution.latestConfirmedHead.verified, true)
  assert.strictEqual(evolvedResolution.historicalStaleConfirmations.length, 1)
  assert.strictEqual(evolvedResolution.historicalStaleConfirmations[0].phase, 'CP1')

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

  const legacyAggregateBudget = resolve('Current Performance Task', { budgets: { maxDirectories: 1, maxBytes: 1024 }, persistIndex: false })
  assert.strictEqual(legacyAggregateBudget.status, 'resolved-active', 'legacy aggregate limits must not block an exact locator match')
  assert(legacyAggregateBudget.scan.directories > 1)

  const oversizedTaskRoot = path.join(root, '.devcodex', 'beta', 'optimizations', 'oversized-identity')
  fs.mkdirSync(path.join(oversizedTaskRoot, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(oversizedTaskRoot, '.memory', 'task.json'), 'x'.repeat(64 * 1024 + 1))
  fs.writeFileSync(path.join(oversizedTaskRoot, '.memory', 'sessions.md'), '# oversized identity\n\n> **当前状态**: 🔄 active\n')
  const localizedOversize = resolve('Current Performance Task', { persistIndex: false })
  assert.strictEqual(localizedOversize.status, 'resolved-active', 'one oversized identity must not poison unrelated candidates')
  assert(localizedOversize.scan.localizedErrors >= 1)
  const selectedOversize = resolve('oversized-identity', { persistIndex: false })
  assert.strictEqual(selectedOversize.status, 'stale-confirmation')
  assert.strictEqual(selectedOversize.errorCode, 'TASK_IDENTITY_INVALID')

  const mismatchedRoot = path.join(root, '.devcodex', 'alpha', 'requirements', 'mismatched-binding')
  fs.mkdirSync(path.join(mismatchedRoot, '.memory'), { recursive: true })
  const mismatchedCore = {
    schemaVersion: 'TaskIdentityV2',
    taskId: '44444444-4444-4444-8444-444444444444',
    displayName: 'mismatched-binding',
    aliases: [],
    project: 'beta',
    projectRootIdentityDigest: 'a'.repeat(64),
    taskKind: 'bugs',
    entryVariant: 'new',
    taskRootRelative: 'bugs/mismatched-binding',
    createdAt: '2026-07-18T00:00:00.000Z',
    identityVersion: 2
  }
  fs.writeFileSync(path.join(mismatchedRoot, '.memory', 'task.json'), JSON.stringify({
    ...mismatchedCore,
    identityDigest: digest(stableStringify(mismatchedCore))
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(mismatchedRoot, '.memory', 'sessions.md'), '# mismatched-binding\n\n> **当前状态**: 🔄 active\n')
  const mismatchedBinding = resolve('mismatched-binding', { persistIndex: false })
  assert.strictEqual(mismatchedBinding.status, 'stale-confirmation')
  assert.strictEqual(mismatchedBinding.errorCode, 'TASK_IDENTITY_INVALID')
  assert.match(mismatchedBinding.message, /identity project does not match its namespace/)

  const missingSessionsRoot = path.join(root, '.devcodex', 'beta', 'bugs', 'missing-sessions')
  fs.mkdirSync(path.join(missingSessionsRoot, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(missingSessionsRoot, '.memory', 'task.json'), JSON.stringify(createTaskIdentity({
    taskId: '33333333-3333-4333-8333-333333333333',
    displayName: 'missing-sessions',
    createdAt: '2026-07-18T00:00:00.000Z'
  }), null, 2) + '\n')
  const missingSessions = resolve('missing-sessions', { persistIndex: false })
  assert.strictEqual(missingSessions.status, 'stale-confirmation')
  assert.strictEqual(missingSessions.errorCode, 'TASK_CANONICAL_EVIDENCE_UNAVAILABLE')
  assert.match(missingSessions.canonicalErrors[0], /sessions metadata is missing/)
  assert.strictEqual(missingSessions.mutationAuthority, false)

  for (let index = 0; index < 260; index += 1) {
    writeTask('beta', 'scenario-tests', `page-boundary-${String(index).padStart(3, '0')}`, {
      status: 'completed',
      withCp: false
    })
  }
  const paged = resolve('Current Performance Task', { persistIndex: false })
  assert.strictEqual(paged.status, 'resolved-active')
  assert(paged.scan.pages >= 2, 'locator must traverse stable 256-entry pages without aggregate blocking')
  assert.strictEqual(paged.scan.pageSize, 256)

  const projectScoped = resolveTaskContinuation({ cwd: root, name: 'Current Performance Task', project: 'alpha', scope: 'project', persistIndex: false })
  assert.strictEqual(projectScoped.status, 'resolved-active')
  assert.strictEqual(projectScoped.requestedProject, 'alpha')

  process.stdout.write('task continuation identity/index/resolver tests passed\n')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
