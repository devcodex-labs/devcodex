#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { createValidationWaveCommandRunner } = require('./lib/validation-wave-executor')
const { sha256, stableStringify } = require('../hooks/_runtime/content-identity.cjs')

const ROOT = path.resolve(__dirname, '..')
const WARM_UP_RUNS = 2
const MEASURED_RUNS = 10

function fixtureNode(id) {
  return {
    id,
    schemaVersion: 'ValidationNodeV1',
    owner: 'benchmark-fixture',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => process.exit(0), 150)'],
    environment: {},
    timeoutMs: 5000,
    estimatedDurationMs: 150,
    riskClass: 'normal',
    cachePolicy: 'never',
    writeScopes: [],
    dependencies: [],
    consumers: [],
    invariants: [],
    delegatedClosure: [],
    evidenceArtifacts: []
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]
}

function gitText(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim() || fallback
  } catch {
    return fallback
  }
}

function safeCleanup(root) {
  const resolved = path.resolve(root)
  const boundary = path.resolve(os.tmpdir())
  const relative = path.relative(boundary, resolved)
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  fs.rmSync(resolved, { recursive: true, force: true })
  return !fs.existsSync(resolved)
}

function runFixture(nodes, plan, repoRoot, maxConcurrency, ordinal) {
  const runner = createValidationWaveCommandRunner({
    plan,
    repoRoot,
    activeRoot: repoRoot,
    runId: `benchmark-${maxConcurrency}-${ordinal}-${crypto.randomBytes(4).toString('hex')}`,
    maxConcurrency
  })
  const startedAt = process.hrtime.bigint()
  for (const node of nodes) runner(node)
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
  const execution = runner.executionMetadata()
  if (!execution.cleanupComplete) throw new Error('benchmark scratch cleanup failed')
  return { elapsedMs, execution }
}

function measure(nodes, plan, repoRoot, maxConcurrency) {
  for (let index = 0; index < WARM_UP_RUNS; index += 1) {
    runFixture(nodes, plan, repoRoot, maxConcurrency, `warm-${index}`)
  }
  const samplesMs = []
  let maxObservedConcurrency = 1
  for (let index = 0; index < MEASURED_RUNS; index += 1) {
    const observed = runFixture(nodes, plan, repoRoot, maxConcurrency, `measured-${index}`)
    samplesMs.push(Number(observed.elapsedMs.toFixed(3)))
    maxObservedConcurrency = Math.max(maxObservedConcurrency, observed.execution.maxObservedConcurrency)
  }
  return {
    maxConcurrency,
    maxObservedConcurrency,
    warmUpRuns: WARM_UP_RUNS,
    measuredRuns: MEASURED_RUNS,
    samplesMs,
    p50Ms: Number(percentile(samplesMs, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samplesMs, 0.95).toFixed(3))
  }
}

function reductionPercent(serialMs, parallelMs) {
  return Number(((1 - (parallelMs / serialMs)) * 100).toFixed(2))
}

function run() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validation-benchmark-'))
  fs.writeFileSync(path.join(repoRoot, 'package.json'), '{"private":true}\n')
  const nodes = ['bench-a', 'bench-b', 'bench-c', 'bench-d'].map(fixtureNode)
  const plan = { selectedNodes: nodes, executionSchedule: { waves: [nodes.map(node => node.id)] } }
  let cleanupComplete = false
  try {
    const serial = measure(nodes, plan, repoRoot, 1)
    const defaultParallel = measure(nodes, plan, repoRoot, 2)
    const cappedParallel = measure(nodes, plan, repoRoot, 4)
    const defaultReduction = reductionPercent(serial.p50Ms, defaultParallel.p50Ms)
    const cappedReduction = reductionPercent(serial.p50Ms, cappedParallel.p50Ms)
    cleanupComplete = safeCleanup(repoRoot)
    const status = defaultParallel.p50Ms < serial.p50Ms && cappedReduction >= 50 && cleanupComplete
      ? 'PASS'
      : 'BLOCK'
    const card = {
      schemaVersion: 'ValidationBenchmarkCardV1',
      status,
      sourceHead: gitText(['rev-parse', 'HEAD'], 'unavailable'),
      dirtyDigest: sha256(Buffer.from(gitText(['status', '--porcelain=v1'], ''), 'utf8')),
      fixtureDigest: sha256(Buffer.from(stableStringify(nodes), 'utf8')),
      selectedNodes: nodes.map(node => node.id),
      command: [process.execPath, '-e', 'setTimeout(..., 150)'],
      environment: {
        platform: `${process.platform}-${process.arch}`,
        release: os.release(),
        cpuCount: (os.cpus() || []).length,
        cpuModelDigest: sha256(Buffer.from(String(os.cpus()?.[0]?.model || 'unknown'), 'utf8')),
        totalMemoryBytes: os.totalmem(),
        node: process.version
      },
      cacheState: 'disabled-fixed-fixture',
      serial,
      defaultParallel,
      cappedParallel,
      acceptance: {
        defaultMax2ImprovesWallTime: defaultParallel.p50Ms < serial.p50Ms,
        defaultMax2ReductionPercent: defaultReduction,
        capMax4ReductionTargetPercent: 50,
        capMax4ReductionActualPercent: cappedReduction,
        cleanupComplete
      }
    }
    process.stdout.write(JSON.stringify(card, null, 2) + '\n')
    if (status !== 'PASS') process.exitCode = 1
  } finally {
    if (!cleanupComplete && fs.existsSync(repoRoot)) safeCleanup(repoRoot)
  }
}

run()
