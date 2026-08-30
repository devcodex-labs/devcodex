#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { spawn, spawnSync } = require('child_process')

const { applyGlobalHostConfig } = require('./lib/global-host-config.js')
const { resolveGlobalHostTarget } = require('./lib/global-host-target.js')
const {
  extractContextPlanBody,
  normalizeCompatibleContextReadPlan,
  stableDigest,
  validateContextReadPlan
} = require('../hooks/_runtime/context-read-contract.cjs')
const {
  buildContextPlanObservation,
  contextPlanObservationRelativePath
} = require('../hooks/_runtime/context-plan-observation.cjs')
const { resolveRuntimeStateRoot } = require('../hooks/_runtime/workspace-layout.cjs')
const {
  commitFencedTaskWriteOwnerTransition,
  fencedTaskWriteOwnerDigest,
  normalizeIdentity,
  readTaskRecoveryState,
  resolveTaskRecoveryMetaDir,
  storePaths,
  taskPaths
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  compactLifecycleStateV5,
  digestValue,
  semanticLifecycleProjection
} = require('../hooks/_runtime/lifecycle-state-projection-v5.cjs')
const {
  readRuntimeGenerationStatus
} = require('../hooks/_runtime/runtime-generation-identity.cjs')

const PACKAGE_ROOT = path.resolve(__dirname, '..')
const REGISTRY_MODE = process.argv.includes('--registry')

function digestBuffer (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function writeV1194TaskRecoveryEnvelope (metaDir, identityInput, state, committedAt) {
  const identity = normalizeIdentity(identityInput)
  const persistedState = compactLifecycleStateV5(state).state
  const envelope = {
    schemaVersion: 'TaskRecoveryStateV5',
    kind: 'hot',
    sequence: 1,
    committedAt,
    lastAccessedAt: committedAt,
    terminalAt: null,
    identity,
    semanticDigest: digestValue(semanticLifecycleProjection(persistedState)),
    state: persistedState
  }
  envelope.payloadDigest = digestValue({
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    recordType: envelope.recordType,
    baseSequence: envelope.baseSequence,
    sequence: envelope.sequence,
    committedAt: envelope.committedAt,
    lastAccessedAt: envelope.lastAccessedAt,
    terminalAt: envelope.terminalAt,
    identity: envelope.identity,
    semanticDigest: envelope.semanticDigest,
    state: envelope.state
  })
  const legacyPaths = taskPaths(storePaths(metaDir), identity.recoveryKey)
  fs.mkdirSync(legacyPaths.dir, { recursive: true })
  fs.writeFileSync(legacyPaths.slots[0], `${JSON.stringify(envelope)}\n`, 'utf8')
  return envelope
}

function safeTempCleanup (root) {
  const temp = path.resolve(os.tmpdir())
  const target = path.resolve(root)
  assert(target.startsWith(temp + path.sep))
  assert(path.basename(target).startsWith('devcodex-runtime-rolling-upgrade-'))
  fs.rmSync(target, { recursive: true, force: true })
}

function runProfilePlan (server, workspace, args) {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'profile_context_plan', arguments: args }
  }
  const result = spawnSync(process.execPath, [server, workspace], {
    cwd: workspace,
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    env: process.env,
    timeout: 30000
  })
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  const response = String(result.stdout).split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .find(item => item.id === 1)
  assert(response?.result, result.stdout)
  return response.result
}

function downgradePlanToN1 (current) {
  const legacy = JSON.parse(JSON.stringify(current))
  legacy.actionEnvelope.allowedActionClasses = legacy.actionEnvelope.allowedActionClasses
    .filter(action => action !== 'workflow-closeout')
  legacy.actionEnvelope.mutationExpected = legacy.actionEnvelope.allowedActionClasses.some(action => [
    'docs-mutation', 'source-mutation', 'release', 'dangerous'
  ].includes(action))
  legacy.identityInputs.intent.actionEnvelope = JSON.parse(JSON.stringify(legacy.actionEnvelope))
  legacy.planContentId = `plan-content-${stableDigest(legacy.identityInputs)}`
  legacy.planId = `plan-${stableDigest({
    planContentId: legacy.planContentId,
    contextEpoch: legacy.identity.contextEpoch,
    invocationNonce: legacy.identity.invocationNonce
  }).slice(0, 24)}`
  legacy.contextBinding.planId = legacy.planId
  legacy.contextBinding.planContentId = legacy.planContentId
  let bytes = 0
  for (let index = 0; index < 4; index += 1) {
    legacy.stageTiming.plannerResponseBytes = bytes
    const next = Buffer.byteLength(JSON.stringify(legacy, null, 2), 'utf8')
    if (next === bytes) break
    bytes = next
  }
  legacy.stageTiming.plannerResponseBytes = Buffer.byteLength(JSON.stringify(legacy, null, 2), 'utf8')
  return legacy
}

function startMcp (server, cwd, env = {}) {
  const child = spawn(process.execPath, [server, cwd], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env }
  })
  const pending = new Map()
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let value
    try { value = JSON.parse(line) } catch { return }
    const waiter = pending.get(value.id)
    if (waiter) {
      pending.delete(value.id)
      waiter.resolve(value)
    }
  })
  const call = request => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request.id)
      reject(new Error(`MCP response timeout for ${request.id}`))
    }, 15000)
    pending.set(request.id, {
      resolve: value => {
        clearTimeout(timer)
        resolve(value)
      }
    })
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
  return { child, call }
}

function runLifecycleHook (server, cwd, payload, env, contextEpoch) {
  const result = spawnSync(process.execPath, [
    server,
    'codex',
    '--workspace-root',
    cwd,
    '--context-epoch',
    contextEpoch
  ], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
    timeout: 30000
  })
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  return result.stdout ? JSON.parse(result.stdout) : {}
}

function writeLegacyObservation (plan) {
  const stateRoot = resolveRuntimeStateRoot(plan.identity.activeRoot, plan.identity.project).root
  const file = path.join(stateRoot, contextPlanObservationRelativePath(plan.identity.contextEpoch))
  const observation = buildContextPlanObservation({
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project,
    contextEpoch: plan.identity.contextEpoch,
    plan
  })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(observation, null, 2)}\n`, 'utf8')
  return file
}

function findLifecycleState (root, contextEpoch) {
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    if (!fs.existsSync(current)) continue
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(file)
      if (!entry.isFile() || entry.name !== 'lifecycle-state.json') continue
      const state = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (state.contextAcquisition?.contextEpoch === contextEpoch) return { file, state }
    }
  }
  return null
}

function writeLegacyReceipt (target, serverFile) {
  fs.mkdirSync(path.dirname(target.receiptFile), { recursive: true })
  const raw = fs.readFileSync(serverFile)
  const managedPath = serverFile.replace(/\\/g, '/')
  fs.writeFileSync(target.receiptFile, `${JSON.stringify({
    schemaVersion: 'GlobalHostConfigReceiptV1',
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    skillsDeployMode: 'hidden',
    skillsRuntimeRoot: null,
    host: 'codex',
    support: 'direct-probe',
    evidenceCeiling: 'legacy fixture',
    packageName: 'devcodex',
    packageVersion: '1.16.2',
    sourcePackageEvidence: { rootLifetime: 'install-process-only', durableIdentity: false, authority: 'sourceDigest' },
    runtimeRoot: target.runtimeRoot.replace(/\\/g, '/'),
    managedPaths: [managedPath],
    managedFileDigests: { [managedPath]: digestBuffer(raw) },
    configFiles: [managedPath],
    pendingStaleManagedPaths: [],
    preservedNativeSkillCollisions: [],
    sourceDigest: digestBuffer(raw),
    planDigest: digestBuffer(raw),
    previousStateRef: null,
    result: 'committed',
    updatedAt: '2026-08-04T00:00:00.000Z',
    workspaceHostDirectoriesWritten: false
  }, null, 2)}\n`, 'utf8')
}

function runFormalTaskContinuityUpgradeProbe (tempRoot) {
  const currentVersion = require('../package.json').version
  assert.strictEqual(currentVersion, '1.19.5')
  const activeRoot = path.join(tempRoot, 'v1.19.4-active-root')
  const project = 'rolling-upgrade-fixture'
  const taskId = '00000000-0000-4000-8000-000000001194'
  const taskRoot = path.join(activeRoot, 'bugs', 'v1.19.4-formal-task')
  fs.mkdirSync(taskRoot, { recursive: true })
  const identity = { activeRoot, project, taskId, taskStatus: 'active' }
  const metaDir = resolveTaskRecoveryMetaDir(identity)
  const issuedAtMs = Date.parse('2026-08-29T00:00:00.000Z')
  const ownerCore = {
    schemaVersion: 'FencedTaskWriteOwnerLeaseV2',
    taskId,
    projectRootIdentity: '1'.repeat(64),
    sessionDigest: '2'.repeat(64),
    contextEpoch: 'ctx-v1.19.4-formal-task',
    routeRevision: '3'.repeat(64),
    ownerGeneration: 4,
    ownerNonce: `owner-${'4'.repeat(40)}`,
    leaseRevision: 7,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + 5 * 60 * 1000).toISOString(),
    handoffRef: null,
    takeoverRef: null,
    transitionRef: null,
    reopenGeneration: 0,
    revocationEpoch: 0,
    status: 'active'
  }
  const owner = { ...ownerCore, leaseDigest: fencedTaskWriteOwnerDigest(ownerCore) }
  const legacyState = {
    version: 2,
    mode: 'fix',
    phase: 'CP2',
    activeProject: project,
    activeScope: 'project',
    runtimeUpgradeFixture: { writerVersion: '1.19.4' },
    taskRecoveryBinding: {
      schemaVersion: 'TaskRecoveryBindingV1',
      taskId,
      displayName: 'v1.19.4 formal task',
      project,
      kind: 'bugs',
      taskRoot,
      status: 'active',
      identityRevision: 2,
      boundAt: new Date(issuedAtMs).toISOString()
    },
    fencedWriteOwner: owner
  }
  const legacyEnvelope = writeV1194TaskRecoveryEnvelope(
    metaDir,
    identity,
    legacyState,
    new Date(issuedAtMs).toISOString()
  )
  assert.strictEqual(legacyEnvelope.writerGeneration, undefined)
  const read = readTaskRecoveryState({ metaDir, identity })
  assert.strictEqual(read.status, 'fresh')
  assert.deepStrictEqual(read.commitFence, {
    schemaVersion: 'TaskRecoveryCommitFenceV1',
    stateSequence: 1,
    writerGeneration: owner.ownerGeneration
  })
  assert.strictEqual(read.state.fencedWriteOwner.ownerNonce, owner.ownerNonce)
  assert.strictEqual(read.state.resumeIngressCapabilityRef, undefined)

  const renewedCore = {
    ...owner,
    leaseRevision: owner.leaseRevision + 1,
    issuedAt: new Date(issuedAtMs + 1000).toISOString(),
    expiresAt: new Date(issuedAtMs + 5 * 60 * 1000 + 1000).toISOString()
  }
  delete renewedCore.leaseDigest
  const renewedOwner = { ...renewedCore, leaseDigest: fencedTaskWriteOwnerDigest(renewedCore) }
  const staleNonce = commitFencedTaskWriteOwnerTransition({
    metaDir,
    identity,
    expectedOwner: {
      ownerGeneration: owner.ownerGeneration,
      ownerNonce: `owner-${'5'.repeat(40)}`,
      leaseRevision: owner.leaseRevision,
      leaseDigest: owner.leaseDigest
    },
    owner: renewedOwner,
    transition: 'renew',
    reason: 'v1.19.4-stale-nonce-probe'
  })
  assert.strictEqual(staleNonce.errorCode, 'FENCED_TASK_WRITE_OWNER_CAS_MISMATCH')
  return {
    fromVersion: '1.19.4',
    toVersion: currentVersion,
    legacyReader: 'PASS',
    staleNonceRejected: true
  }
}

async function main () {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-runtime-rolling-upgrade-'))
  const home = path.join(tempRoot, 'home')
  const workspace = path.join(tempRoot, 'workspace')
  const projectRoot = path.join(workspace, 'rolling-upgrade-fixture')
  const planFile = path.join(tempRoot, 'legacy-plan.json')
  let oldProcess = null
  let newProcess = null
  try {
    fs.mkdirSync(projectRoot, { recursive: true })
    const taskContinuityUpgrade = runFormalTaskContinuityUpgradeProbe(tempRoot)
    fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"rolling-upgrade-workspace","private":true,"workspaces":["rolling-upgrade-fixture"]}\n')
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"rolling-upgrade-fixture","private":true}\n')
    const init = spawnSync(process.execPath, [
      path.join(PACKAGE_ROOT, 'index.js'),
      'init',
      '--profile',
      'rolling-upgrade-fixture'
    ], {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, DEVCODEX_TEST_HOME: home, USERPROFILE: home, HOME: home },
      timeout: 30000
    })
    assert.strictEqual(init.status, 0, init.stderr || init.stdout)

    const planArgs = {
      intent: 'fix',
      changeTypes: ['source-code'],
      project: 'rolling-upgrade-fixture',
      contextEpoch: 'ctx-runtime-rolling-upgrade'
    }
    let oldServer
    let oldTarget
    if (REGISTRY_MODE) {
      const installRoot = path.join(tempRoot, 'registry-old')
      const install = spawnSync('npm', [
        'install', '--ignore-scripts', '--no-audit', '--no-fund',
        '--prefix', installRoot, 'devcodex@1.16.2'
      ], { encoding: 'utf8', timeout: 120000 })
      assert.strictEqual(install.status, 0, install.stderr || install.stdout)
      const oldPackage = path.join(installRoot, 'node_modules', 'devcodex')
      const oldConfig = require(path.join(oldPackage, 'scripts/lib/global-host-config.js'))
      const env = { ...process.env, DEVCODEX_TEST_HOME: home, USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, '.codex') }
      const appliedOld = oldConfig.applyGlobalHostConfig({ packageRoot: oldPackage, home, env, hosts: ['codex'] })
      assert.strictEqual(appliedOld.transaction.status, 'committed')
      oldTarget = appliedOld.targets[0]
      oldServer = path.join(oldTarget.runtimeRoot, 'mcp', 'profile-server.js')
      const oldResult = runProfilePlan(oldServer, workspace, planArgs)
      const oldPlan = JSON.parse(oldResult.content[0].text)
      fs.writeFileSync(planFile, `${JSON.stringify(oldPlan, null, 2)}\n`)
    } else {
      const currentResult = runProfilePlan(path.join(PACKAGE_ROOT, 'mcp/profile-server.js'), workspace, planArgs)
      assert.strictEqual(currentResult.isError, undefined, currentResult.content?.[0]?.text)
      const currentPlan = JSON.parse(currentResult.content[0].text)
      const legacyPlan = downgradePlanToN1(currentPlan)
      assert.deepStrictEqual(validateContextReadPlan(legacyPlan).errors, [
        'actionEnvelope is not derived from intent scope'
      ])
      fs.writeFileSync(planFile, `${JSON.stringify(legacyPlan, null, 2)}\n`)
      oldTarget = resolveGlobalHostTarget('codex', {
        home,
        env: { ...process.env, DEVCODEX_TEST_HOME: home, CODEX_HOME: path.join(home, '.codex') },
        runtimeGeneration: false
      })
      oldServer = path.join(oldTarget.runtimeRoot, 'mcp', 'profile-server.js')
      fs.mkdirSync(path.dirname(oldServer), { recursive: true })
      fs.copyFileSync(
        path.join(PACKAGE_ROOT, 'scripts/fixtures/runtime-rolling-upgrade/legacy-profile-server.js'),
        oldServer
      )
      writeLegacyReceipt(oldTarget, oldServer)
    }

    const live = startMcp(oldServer, workspace, {
      DEVCODEX_LEGACY_PLAN_FILE: planFile,
      DEVCODEX_TEST_HOME: home,
      USERPROFILE: home,
      HOME: home,
      CODEX_HOME: path.join(home, '.codex')
    })
    oldProcess = live.child
    const oldPid = oldProcess.pid
    const initialized = await live.call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    assert(initialized.result)

    const env = {
      ...process.env,
      DEVCODEX_TEST_HOME: home,
      USERPROFILE: home,
      HOME: home,
      CODEX_HOME: path.join(home, '.codex')
    }
    const candidate = applyGlobalHostConfig({
      packageRoot: PACKAGE_ROOT,
      home,
      env,
      hosts: ['codex']
    })
    assert.strictEqual(candidate.transaction.status, 'committed')
    const newTarget = candidate.targets[0]
    assert.notStrictEqual(path.resolve(newTarget.runtimeRoot), path.resolve(oldTarget.runtimeRoot))
    assert(fs.existsSync(oldServer), 'candidate activation must retain the running old runtime generation')
    assert(fs.existsSync(path.join(newTarget.runtimeRoot, 'runtime-generation.json')))
    process.kill(oldPid, 0)

    const supersededRuntimeStatus = readRuntimeGenerationStatus(oldTarget.runtimeRoot, {
      receiptFile: newTarget.receiptFile
    })
    assert.strictEqual(supersededRuntimeStatus.alignment, 'runtime-mismatch')
    assert.strictEqual(supersededRuntimeStatus.restartRequired, true)
    assert.strictEqual(supersededRuntimeStatus.reasonCode, 'active-runtime-generation-superseded')
    assert.strictEqual(
      supersededRuntimeStatus.configuredRuntimeGeneration.generationId,
      newTarget.runtimeGeneration.generationId
    )
    const currentRuntimeStatus = readRuntimeGenerationStatus(newTarget.runtimeRoot, {
      receiptFile: newTarget.receiptFile
    })
    assert.strictEqual(currentRuntimeStatus.alignment, 'aligned')
    assert.strictEqual(currentRuntimeStatus.restartRequired, false)
    assert.strictEqual(currentRuntimeStatus.reasonCode, 'active-runtime-generation-current')

    const currentMcp = startMcp(path.join(newTarget.runtimeRoot, 'mcp', 'profile-server.js'), workspace, env)
    newProcess = currentMcp.child
    const currentInitialized = await currentMcp.call({ jsonrpc: '2.0', id: 101, method: 'initialize', params: {} })
    assert(currentInitialized.result)
    const currentLeaseRoot = path.join(
      newTarget.runtimeBaseRoot,
      '.runtime-generation-leases',
      newTarget.runtimeGeneration.generationId
    )
    const currentLeaseFiles = fs.readdirSync(currentLeaseRoot)
      .filter(name => name.endsWith('.json') && name !== '.gc-claim.json')
    assert.strictEqual(currentLeaseFiles.length, 1, 'installed long-lived MCP must own one stable generation lease')
    const currentLease = JSON.parse(fs.readFileSync(path.join(currentLeaseRoot, currentLeaseFiles[0]), 'utf8'))
    assert.strictEqual(currentLease.role, 'profile-mcp')
    assert.strictEqual(path.resolve(currentLease.runtimeRoot), path.resolve(newTarget.runtimeRoot))
    currentMcp.child.stdin.end()
    await new Promise(resolve => newProcess.once('exit', resolve))
    newProcess = null
    assert.strictEqual(
      fs.existsSync(path.join(currentLeaseRoot, currentLeaseFiles[0])),
      false,
      'normal MCP closeout must remove its generation lease'
    )

    const hookEnv = {
      ...env,
      DEVCODEX_AGENT: 'codex',
      DEVCODEX_CONTEXT_EPOCH: planArgs.contextEpoch,
      DEVCODEX_CONTEXT_EPOCH_SOURCE: 'host-adapter-cli'
    }
    const lifecycleServer = path.join(
      newTarget.runtimeRoot,
      'hooks',
      '_runtime',
      'lifecycle-host-adapters.cjs'
    )
    const hostSessionId = 'runtime-rolling-upgrade-session'
    runLifecycleHook(lifecycleServer, workspace, {
      hookEventName: 'UserPromptSubmit',
      session_id: hostSessionId,
      prompt: 'Fix project rolling-upgrade-fixture rolling upgrade compatibility.'
    }, hookEnv, planArgs.contextEpoch)
    const planToolInput = {
      intent: planArgs.intent,
      changeTypes: planArgs.changeTypes,
      project: planArgs.project,
      contextEpoch: planArgs.contextEpoch
    }
    runLifecycleHook(lifecycleServer, workspace, {
      hookEventName: 'PreToolUse',
      session_id: hostSessionId,
      tool_use_id: 'rolling-upgrade-plan',
      tool_name: 'mcp__devcodex_profile__profile_context_plan',
      tool_input: planToolInput
    }, hookEnv, planArgs.contextEpoch)

    const response = await live.call({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'profile_context_plan', arguments: planArgs }
    })
    if (!REGISTRY_MODE) writeLegacyObservation(JSON.parse(response.result.content[0].text))
    runLifecycleHook(lifecycleServer, workspace, {
      hookEventName: 'PostToolUse',
      session_id: hostSessionId,
      tool_use_id: 'rolling-upgrade-plan',
      tool_name: 'mcp__devcodex_profile__profile_context_plan',
      tool_input: planToolInput,
      tool_response: response.result
    }, hookEnv, planArgs.contextEpoch)
    const extracted = extractContextPlanBody(response.result)
    assert.strictEqual(extracted.error, null, JSON.stringify(extracted.error))
    assert(['legacy-n-1', 'migrated-n-1'].includes(extracted.compatibilityReceipt.status))
    assert.strictEqual(validateContextReadPlan(extracted.plan).valid, true)
    assert(extracted.plan.actionEnvelope.allowedActionClasses.includes('workflow-closeout'))
    assert.strictEqual(oldProcess.exitCode, null)
    const lifecycleState = findLifecycleState(
      path.join(workspace, '.devcodex'),
      planArgs.contextEpoch
    )
    assert(lifecycleState, 'new Hook lifecycle state for the legacy MCP response missing')
    assert(
      lifecycleState.state.contextAcquisition.plan,
      JSON.stringify(lifecycleState.state.contextAcquisition, null, 2)
    )
    assert.strictEqual(lifecycleState.state.contextAcquisition.plan.schemaVersion, 'ContextReadPlanV2')
    assert(['legacy-n-1', 'migrated-n-1'].includes(
      lifecycleState.state.contextAcquisition.runtimeCompatibility.status
    ))
    assert.strictEqual(lifecycleState.state.contextAcquisition.targetResolved, true)
    assert.strictEqual(lifecycleState.state.contextAcquisition.fallbackActive, false)

    const unsupported = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(planFile, 'utf8'))))
    unsupported.actionEnvelope.allowedActionClasses = unsupported.actionEnvelope.allowedActionClasses
      .filter(action => action !== 'analysis-read')
    assert.strictEqual(normalizeCompatibleContextReadPlan(unsupported).status, 'refresh-required')

    console.log(JSON.stringify({
      schemaVersion: 'RuntimeRollingUpgradeReceiptV1',
      mode: REGISTRY_MODE ? 'registry-v1.16.2' : 'deterministic-legacy-fixture',
      oldPid,
      oldRuntimeRoot: oldTarget.runtimeRoot.replace(/\\/g, '/'),
      newRuntimeRoot: newTarget.runtimeRoot.replace(/\\/g, '/'),
      newGenerationId: newTarget.runtimeGeneration.generationId,
      compatibilityStatus: extracted.compatibilityReceipt.status,
      hookCompatibilityStatus: lifecycleState.state.contextAcquisition.runtimeCompatibility.status,
      hookLifecycleState: lifecycleState.file.replace(/\\/g, '/'),
      taskContinuityUpgrade,
      processStayedAlive: true,
      result: 'PASS'
    }))
  } finally {
    if (newProcess && newProcess.exitCode === null) {
      newProcess.kill()
      await new Promise(resolve => newProcess.once('exit', resolve))
    }
    if (oldProcess && oldProcess.exitCode === null) {
      oldProcess.kill()
      await new Promise(resolve => oldProcess.once('exit', resolve))
    }
    safeTempCleanup(tempRoot)
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
