#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { fork } = require('child_process')

const {
  createValidationWaveCommandRunner,
  executeWorkerBatch,
  parallelEligibility
} = require('./lib/validation-wave-executor')
const { planValidation, validateValidationManifest } = require('./lib/validation-dag')
const { createVerificationExecutionLease } = require('./lib/validation-execution-authority')
const { createValidationEvidenceStore } = require('./lib/validation-evidence-store')

function node(id, source, options = {}) {
  return {
    id,
    owner: 'fixture-owner',
    command: process.execPath,
    args: ['-e', source],
    environment: {},
    timeoutMs: 5000,
    riskClass: 'normal',
    cachePolicy: 'never',
    writeScopes: [],
    dependencies: [],
    consumers: [],
    delegatedClosure: [],
    evidenceArtifacts: [],
    ...options
  }
}

function safeCleanup(root) {
  const resolved = path.resolve(root)
  const boundary = path.resolve(os.tmpdir())
  const relative = path.relative(boundary, resolved)
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  fs.rmSync(resolved, { recursive: true, force: true })
}

function workerManifest(nodes) {
  const ids = nodes.map(item => item.id)
  return {
    schemaVersion: 'ValidationManifestV1',
    contractVersion: '3',
    description: 'validation worker integration fixture',
    consumerGraphComplete: true,
    ciCompatibilityMatrix: [],
    narrativeMarkdownExclusions: ['README.md', 'public-site/**/*.md', 'website/**/*.md'],
    iterativeEscalationInputs: ['fixture/**'],
    verificationBoundaries: { fixture: { inputs: ['fixture/**'], nodes: ids, enforceForMatchingInputs: false } },
    nodeVerificationPolicies: { defaultConsumerEdgeType: 'runtimeConsumer', overrides: {} },
    criticalInputs: ['fixture/**'],
    invariantNodes: [ids[0]],
    iterativeInvariantNodes: [ids[0]],
    routes: {
      fast: { dynamic: true },
      full: { nodes: ids },
      changed: { dynamic: true },
      delivery: { dynamic: true },
      boundary: { dynamic: true },
      'profile-deploy': { nodes: ids },
      'package-release': { nodes: ids }
    },
    nodes
  }
}

function executeActualValidationWorker({ manifest, plan, candidate, repoRoot, activeRoot, lease, evidenceStore }) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'lib', 'validation-worker.js'), [], {
      cwd: __dirname,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    const messages = []
    let timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { }
      reject(new Error('actual validation worker fixture timed out'))
    }, 15000)
    child.on('message', message => {
      messages.push(message)
      // Match the production runner: acknowledge terminal delivery by closing
      // the channel only after the receiver has observed the final message.
      if (['result', 'error'].includes(message.type) && child.connected) child.disconnect()
    })
    child.once('error', reject)
    child.once('exit', code => {
      clearTimeout(timer)
      timer = null
      const terminal = messages.find(message => message.type === 'result')
      if (code !== 0 || !terminal) {
        reject(new Error(`actual validation worker failed: code=${code} messages=${JSON.stringify(messages)}`))
        return
      }
      resolve({ messages, execution: terminal.execution })
    })
    child.send({
      schemaVersion: 'ValidationRunnerCommandV1',
      type: 'execute',
      runIdentityDigest: lease.runIdentityDigest,
      attempt: 1,
      payload: {
        evidenceStore,
        execution: {
          manifest,
          plan,
          candidate,
          repoRoot,
          activeRoot,
          lease,
          actorType: 'human-cli',
          project: 'devcodex',
          useCache: false,
          maxConcurrency: 2,
          resumeResults: []
        }
      }
    })
  })
}

async function run() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validation-wave-'))
  fs.writeFileSync(path.join(repoRoot, 'package.json'), '{"private":true}\n')
  try {
    const sleepers = [
      node('sleep-a', 'setTimeout(() => process.stdout.write("a"), 180)'),
      node('sleep-b', 'setTimeout(() => process.stdout.write("b"), 180)'),
      node('sleep-c', 'setTimeout(() => process.stdout.write("c"), 180)'),
      node('sleep-d', 'setTimeout(() => process.stdout.write("d"), 180)')
    ]
    const startedAt = Date.now()
    const batch = executeWorkerBatch(sleepers, {
      maxConcurrency: 2,
      repoRoot,
      activeRoot: repoRoot,
      runId: 'fixture-parallel'
    })
    const elapsedMs = Date.now() - startedAt
    assert.strictEqual(batch.outcomes.size, 4)
    assert([...batch.outcomes.values()].every(outcome => outcome.ok === true))
    assert.strictEqual(batch.receipt.maxObservedConcurrency, 2)
    assert.strictEqual(batch.receipt.cleanupStatus, 'complete')
    assert(!fs.existsSync(batch.receipt.runRoot))
    assert(elapsedMs < 1500, `bounded parallel fixture unexpectedly slow: ${elapsedMs}ms`)

    const failed = executeWorkerBatch([
      node('pass-one', 'process.stdout.write("ok")'),
      node('fail-one', 'process.stderr.write("expected"); process.exit(7)')
    ], {
      maxConcurrency: 2,
      repoRoot,
      activeRoot: repoRoot,
      runId: 'fixture-failure'
    })
    assert.strictEqual(failed.outcomes.get('pass-one').ok, true)
    assert.strictEqual(failed.outcomes.get('fail-one').ok, false)
    assert.strictEqual(failed.outcomes.get('fail-one').error.evidence.exitCode, 7)
    assert.strictEqual(failed.receipt.cleanupStatus, 'complete')

    const plan = {
      selectedNodes: sleepers.slice(0, 2),
      executionSchedule: { waves: [['sleep-a', 'sleep-b']] }
    }
    const runner = createValidationWaveCommandRunner({
      plan,
      repoRoot,
      activeRoot: repoRoot,
      runId: 'fixture-runner',
      maxConcurrency: 2
    })
    assert.strictEqual(runner(sleepers[0]).exitCode, 0)
    assert.strictEqual(runner(sleepers[1]).exitCode, 0)
    const metadata = runner.executionMetadata()
    assert.strictEqual(metadata.effectiveMode, 'bounded-parallel')
    assert.strictEqual(metadata.parallelNodeCount, 2)
    assert.strictEqual(metadata.cleanupComplete, true)

    const serial = createValidationWaveCommandRunner({
      plan,
      repoRoot,
      activeRoot: repoRoot,
      runId: 'fixture-serial',
      maxConcurrency: 1
    })
    serial(sleepers[0])
    serial(sleepers[1])
    assert.strictEqual(serial.executionMetadata().effectiveMode, 'serial-fallback')
    assert.strictEqual(serial.executionMetadata().parallelBatchCount, 0)

    const cacheable = [
      node('cache-a', 'process.exit(0)', { cachePolicy: 'candidate-bound' }),
      node('cache-b', 'process.exit(0)', { cachePolicy: 'candidate-bound' })
    ]
    const cacheAware = createValidationWaveCommandRunner({
      plan: { selectedNodes: cacheable, executionSchedule: { waves: [cacheable.map(item => item.id)] } },
      repoRoot,
      activeRoot: repoRoot,
      runId: 'fixture-cache-aware',
      maxConcurrency: 2,
      useCache: true
    })
    cacheAware(cacheable[0])
    const cacheAwareAfterFirst = cacheAware.executionMetadata()
    assert.strictEqual(cacheAwareAfterFirst.parallelBatchCount, 0,
      'a future candidate-bound node must not execute before its cache lookup')
    assert.deepStrictEqual(cacheAwareAfterFirst.cacheDeferredNodeIds, ['cache-b'])
    cacheAware(cacheable[1])

    assert.strictEqual(parallelEligibility(node('safe-node', 'process.exit(0)')).eligible, true)
    assert.strictEqual(parallelEligibility(node('package-install', 'process.exit(0)')).eligible, false)
    assert.strictEqual(parallelEligibility(node('shared-write', 'process.exit(0)', { writeScopes: ['shared-state'] })).eligible, false)
    assert.strictEqual(parallelEligibility(node('isolated-write', 'process.exit(0)', { writeScopes: ['isolated-temp:fixture'] })).eligible, true)

    const integrationNodes = [
      node('worker-a', 'setTimeout(() => process.stdout.write("a"), 120)', {
        schemaVersion: 'ValidationNodeV1', inputs: ['fixture/**'], invariants: ['worker-a'], estimatedDurationMs: 120,
        exitMap: { success: [0], failure: 'nonzero-or-signal', timeout: 'ETIMEDOUT' }
      }),
      node('worker-b', 'setTimeout(() => process.stdout.write("b"), 120)', {
        schemaVersion: 'ValidationNodeV1', inputs: ['fixture/**'], invariants: ['worker-b'], estimatedDurationMs: 120,
        exitMap: { success: [0], failure: 'nonzero-or-signal', timeout: 'ETIMEDOUT' }
      })
    ]
    const manifest = workerManifest(integrationNodes)
    validateValidationManifest(manifest)
    const candidate = {
      candidateId: 'validation-candidate-worker-fixture',
      stable: true,
      head: 'a'.repeat(40),
      changedSource: 'explicit',
      changedFiles: ['fixture/input.js'],
      dirtyIdentities: [{ path: 'fixture/input.js', deleted: false, digest: 'b'.repeat(64), bytes: 1 }],
      scopeIdentities: [{ path: 'fixture/input.js', deleted: false, digest: 'b'.repeat(64), bytes: 1 }]
    }
    const integrationPlan = planValidation({
      manifest,
      route: 'changed',
      changedFiles: candidate.changedFiles,
      changedSource: candidate.changedSource,
      riskClass: 'normal',
      candidateStable: true,
      candidateId: candidate.candidateId,
      project: 'devcodex'
    })
    assert.strictEqual(integrationPlan.executionState, 'awaiting-authority')
    const lease = createVerificationExecutionLease({
      actorType: 'human-cli',
      authorityClass: 'scoped',
      actorIdentityEvidence: { fixtureActor: 'human-cli' },
      repoRoot,
      plan: integrationPlan,
      candidate,
      project: 'devcodex',
      taskRecoveryKey: integrationPlan.verificationIntent.taskRecoveryKey,
      contextEpoch: integrationPlan.verificationIntent.contextEpoch,
      authoritySourceRef: 'fixture:validation-worker'
    })
    const evidenceStoreOptions = {
      activeRoot: path.join(repoRoot, '.devcodex', 'devcodex'),
      project: 'devcodex',
      actorType: 'human-cli',
      runIdentity: lease.runIdentity,
      runIdentityDigest: lease.runIdentityDigest,
      sessionKey: ''
    }
    const evidenceStore = createValidationEvidenceStore(evidenceStoreOptions)
    assert(['persisted', 'committed'].includes(evidenceStore.writeLease(lease).status))
    const integrated = await executeActualValidationWorker({
      manifest,
      plan: integrationPlan,
      candidate,
      repoRoot,
      activeRoot: evidenceStoreOptions.activeRoot,
      lease,
      evidenceStore: evidenceStoreOptions
    })
    assert.strictEqual(integrated.execution.receipt.nativeExitCode, 0)
    assert.strictEqual(integrated.execution.receipt.executionMode, 'orchestrated-bounded-parallel')
    assert.strictEqual(integrated.execution.receipt.executorSummary.maxObservedConcurrency, 2)
    assert.strictEqual(integrated.execution.receipt.executorSummary.cleanupComplete, true)
    assert.deepStrictEqual(integrated.messages.filter(message => message.type === 'node')
      .map(message => message.result.nodeId), ['worker-a', 'worker-b'])
    assert(!fs.existsSync(path.join(repoRoot, '.devcodex', '.runtime-state', 'validation-evidence')))
    assert(!fs.existsSync(path.join(repoRoot, '.tmp', 'devcodex', 'runs')) ||
      fs.readdirSync(path.join(repoRoot, '.tmp', 'devcodex', 'runs')).length === 0)
  } finally {
    safeCleanup(repoRoot)
  }
  process.stdout.write('validation wave executor tests passed\n')
}

run().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
