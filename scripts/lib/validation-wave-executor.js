'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Worker } = require('worker_threads')

const { CheckedCommandError, runChecked } = require('./checked-command')
const { cacheReuseEligibility, parallelExecutionEligibility } = require('./validation-dag')
const { resolveWorkspaceTempRoot } = require('./workspace-temp-layout')

const NODE_WORKER_PATH = path.join(__dirname, 'validation-node-worker.js')
const RESULT_MAX_BYTES = 256 * 1024

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function clampConcurrency(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return 2
  return Math.max(1, Math.min(4, parsed))
}

function prepareExecutionNode(node, { activeRoot = null } = {}) {
  return {
    ...node,
    environment: {
      ...(node.environment || {}),
      ...(activeRoot ? { DEVCODEX_VALIDATION_ACTIVE_ROOT: path.resolve(activeRoot) } : {})
    }
  }
}

function resultError(outcome, node) {
  const evidence = outcome?.error?.evidence || {
    code: outcome?.error?.code || 'VALIDATION_NODE_WORKER_FAILED',
    command: node.command,
    args: node.args || [],
    cwd: null,
    exitCode: null,
    signal: null,
    durationMs: 0,
    stdout: '',
    stderr: outcome?.error?.message || 'validation node worker failed'
  }
  return new CheckedCommandError(outcome?.error?.message || `Validation node worker failed: ${node.id}`, evidence)
}

function readWorkerOutcome(resultPath, node) {
  let stats
  try { stats = fs.statSync(resultPath) } catch {
    return { ok: false, error: { code: 'VALIDATION_NODE_WORKER_RESULT_MISSING', message: `missing worker result for ${node.id}` } }
  }
  if (!stats.isFile() || stats.size > RESULT_MAX_BYTES) {
    return { ok: false, error: { code: 'VALIDATION_NODE_WORKER_RESULT_INVALID', message: `invalid worker result for ${node.id}` } }
  }
  try {
    const value = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    if (value?.schemaVersion !== 'ValidationNodeWorkerResultV1' || value.nodeId !== node.id || typeof value.ok !== 'boolean') {
      throw new Error('worker result binding mismatch')
    }
    return value
  } catch (error) {
    return { ok: false, error: { code: 'VALIDATION_NODE_WORKER_RESULT_INVALID', message: error.message } }
  }
}

function executeWorkerBatch(nodes, options) {
  const maxConcurrency = clampConcurrency(options.maxConcurrency)
  const tempRoot = resolveWorkspaceTempRoot(options.repoRoot)
  const operationId = `validation-wave-${String(options.runId || 'local').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64)}-${crypto.randomBytes(6).toString('hex')}`
  const runRoot = path.join(tempRoot, 'runs', operationId)
  if (!contained(tempRoot, runRoot)) throw new Error('VALIDATION_WAVE_TEMP_PATH_INVALID')
  fs.mkdirSync(runRoot, { recursive: true })

  const signalBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * nodes.length)
  const signal = new Int32Array(signalBuffer)
  const pending = nodes.map((node, index) => ({ node, index }))
  const active = new Map()
  const outcomes = new Map()
  let maxObservedConcurrency = 0
  let cleanupStatus = 'pending'

  function launch(item) {
    const resultPath = path.join(runRoot, `${String(item.index).padStart(4, '0')}-${item.node.id}.json`)
    const worker = new Worker(options.workerPath || NODE_WORKER_PATH, {
      workerData: {
        node: item.node,
        cwd: path.resolve(options.repoRoot),
        resultPath,
        signalBuffer,
        signalIndex: item.index
      }
    })
    active.set(item.index, {
      ...item,
      worker,
      resultPath,
      deadlineMs: Date.now() + Math.max(1000, Number(item.node.timeoutMs || 0)) + 5000
    })
    maxObservedConcurrency = Math.max(maxObservedConcurrency, active.size)
  }

  try {
    while (pending.length || active.size) {
      while (pending.length && active.size < maxConcurrency) launch(pending.shift())
      let progressed = false
      for (const [index, item] of [...active]) {
        const state = Atomics.load(signal, index)
        if (state === 0 && Date.now() < item.deadlineMs) continue
        let outcome
        if (state === 1) outcome = readWorkerOutcome(item.resultPath, item.node)
        else if (state === -1) {
          outcome = { ok: false, error: { code: 'VALIDATION_NODE_WORKER_WRITE_FAILED', message: `worker result write failed for ${item.node.id}` } }
        } else {
          outcome = { ok: false, error: { code: 'ETIMEDOUT', message: `worker result deadline exceeded for ${item.node.id}` } }
          void item.worker.terminate()
        }
        outcomes.set(item.node.id, outcome)
        active.delete(index)
        progressed = true
      }
      if (!progressed && active.size) {
        const [index] = active.keys()
        Atomics.wait(signal, index, 0, 25)
      }
    }
  } finally {
    for (const item of active.values()) void item.worker.terminate()
    if (!contained(tempRoot, runRoot) || path.resolve(runRoot) === path.resolve(tempRoot)) {
      cleanupStatus = 'blocked-unsafe-target'
    } else {
      fs.rmSync(runRoot, { recursive: true, force: true })
      cleanupStatus = fs.existsSync(runRoot) ? 'failed' : 'complete'
    }
  }

  return {
    outcomes,
    receipt: {
      schemaVersion: 'ValidationWaveExecutionReceiptV1',
      operationId,
      requestedConcurrency: maxConcurrency,
      maxObservedConcurrency,
      nodeIds: nodes.map(node => node.id),
      tempRoot,
      runRoot,
      cleanupStatus
    }
  }
}

function createValidationWaveCommandRunner({ plan, repoRoot, activeRoot, runId, maxConcurrency = 2,
  resumeResults = [], workerPath = null, useCache = true } = {}) {
  const requestedConcurrency = clampConcurrency(maxConcurrency)
  const byId = new Map((plan?.selectedNodes || []).map(node => [node.id, node]))
  const waveByNode = new Map()
  for (const [waveIndex, wave] of (plan?.executionSchedule?.waves || []).entries()) {
    for (const nodeId of wave) waveByNode.set(nodeId, waveIndex)
  }
  const resumed = new Set((resumeResults || []).map(result => result.nodeId))
  const prepared = new Map()
  const outcomes = new Map()
  const returned = new Map()
  const waveReceipts = []
  const cacheDeferredNodeIds = new Set()

  function observe(nodeId, ok) {
    returned.set(nodeId, ok ? 'passed' : 'failed')
  }

  function executeOne(node) {
    try {
      const evidence = runChecked(node.command, node.args || [], {
        cwd: repoRoot,
        env: node.environment || {},
        timeoutMs: node.timeoutMs
      })
      outcomes.set(node.id, { ok: true, evidence })
      return evidence
    } catch (error) {
      outcomes.set(node.id, { ok: false, error: { code: error.code, message: error.message, evidence: error.evidence || null } })
      throw error
    }
  }

  const runner = node => {
    if (outcomes.has(node.id)) {
      const outcome = outcomes.get(node.id)
      observe(node.id, outcome.ok)
      if (outcome.ok) return outcome.evidence
      throw resultError(outcome, node)
    }
    const eligibility = parallelExecutionEligibility(node)
    if (requestedConcurrency === 1 || !eligibility.eligible) {
      try {
        const evidence = executeOne(node)
        observe(node.id, true)
        return evidence
      } catch (error) {
        observe(node.id, false)
        throw error
      }
    }

    const waveIndex = waveByNode.get(node.id)
    const wave = plan?.executionSchedule?.waves?.[waveIndex] || [node.id]
    const batch = []
    for (const nodeId of wave) {
      if (resumed.has(nodeId) || outcomes.has(nodeId)) continue
      const raw = byId.get(nodeId)
      if (!raw || !parallelExecutionEligibility(raw).eligible) continue
      // executeValidationPlan owns cache lookup and invalidation. A future
      // candidate-bound node must reach that decision point before its command
      // can run; speculative execution would make a later cache-hit receipt lie.
      if (useCache && nodeId !== node.id && cacheReuseEligibility(raw).eligible) {
        cacheDeferredNodeIds.add(nodeId)
        continue
      }
      if ((raw.dependencies || []).some(dependency => returned.get(dependency) !== 'passed')) continue
      const executionNode = nodeId === node.id ? node : prepareExecutionNode(raw, { activeRoot })
      prepared.set(nodeId, executionNode)
      batch.push(executionNode)
    }
    if (batch.length < 2) {
      try {
        const evidence = executeOne(node)
        observe(node.id, true)
        return evidence
      } catch (error) {
        observe(node.id, false)
        throw error
      }
    }

    const batchResult = executeWorkerBatch(batch, {
      maxConcurrency: requestedConcurrency,
      repoRoot,
      activeRoot,
      runId,
      workerPath
    })
    waveReceipts.push(batchResult.receipt)
    for (const [nodeId, outcome] of batchResult.outcomes) outcomes.set(nodeId, outcome)
    const outcome = outcomes.get(node.id)
    observe(node.id, outcome?.ok === true)
    if (outcome?.ok) return outcome.evidence
    throw resultError(outcome, prepared.get(node.id) || node)
  }

  runner.executionMetadata = () => ({
    schemaVersion: 'ValidationWaveExecutorSummaryV1',
    requestedConcurrency,
    effectiveMode: waveReceipts.some(receipt => receipt.maxObservedConcurrency > 1)
      ? 'bounded-parallel'
      : 'serial-fallback',
    parallelBatchCount: waveReceipts.length,
    parallelNodeCount: waveReceipts.reduce((sum, receipt) => sum + receipt.nodeIds.length, 0),
    maxObservedConcurrency: waveReceipts.reduce((max, receipt) => Math.max(max, receipt.maxObservedConcurrency), 1),
    cacheDeferredNodeCount: cacheDeferredNodeIds.size,
    cacheDeferredNodeIds: [...cacheDeferredNodeIds].sort(),
    cleanupComplete: waveReceipts.every(receipt => receipt.cleanupStatus === 'complete'),
    waveReceipts
  })
  return runner
}

module.exports = {
  NODE_WORKER_PATH,
  clampConcurrency,
  createValidationWaveCommandRunner,
  executeWorkerBatch,
  parallelEligibility: parallelExecutionEligibility,
  prepareExecutionNode
}
