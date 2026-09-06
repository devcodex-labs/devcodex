#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  SAMPLE_LIMIT,
  estimateValidationEta,
  executionNodeContractDigest,
  readValidationPerformanceHistory,
  recordValidationPerformance,
  resolveValidationPerformanceHistoryFile
} = require('./lib/validation-performance-history')

function validationNode(id, durationMs) {
  return {
    id,
    schemaVersion: 'ValidationNodeV1',
    owner: 'fixture-owner',
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    environment: {},
    timeoutMs: 5000,
    estimatedDurationMs: durationMs,
    riskClass: 'normal',
    cachePolicy: 'never',
    writeScopes: [],
    dependencies: [],
    consumers: [],
    delegatedClosure: [],
    evidenceArtifacts: []
  }
}

function safeCleanup(root) {
  const resolved = path.resolve(root)
  const boundary = path.resolve(os.tmpdir())
  const relative = path.relative(boundary, resolved)
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  fs.rmSync(resolved, { recursive: true, force: true })
}

function run() {
  const activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validation-history-'))
  fs.writeFileSync(path.join(activeRoot, 'package.json'), '{"private":true}\n')
  const nodes = [validationNode('history-a', 1000), validationNode('history-b', 2000)]
  const plan = {
    selectedNodes: nodes,
    executionSchedule: { waves: [['history-a', 'history-b']] }
  }
  try {
    const missing = readValidationPerformanceHistory({ activeRoot })
    assert.strictEqual(missing.status, 'missing')
    const low = estimateValidationEta({ plan, activeRoot, history: missing.history })
    assert.strictEqual(low.confidence, 'low')
    assert.strictEqual(low.estimatedRemainingMs, null)
    assert.deepStrictEqual(low.rangeMs, { lower: 1000, upper: 3000 })

    for (let sample = 0; sample < 6; sample += 1) {
      const results = nodes.map((node, index) => ({
        nodeId: node.id,
        nodeContractDigest: executionNodeContractDigest(node, activeRoot),
        status: 'passed',
        cacheStatus: 'disabled',
        exitCode: 0,
        durationMs: (index + 1) * 100 + sample
      }))
      const write = recordValidationPerformance({ activeRoot, results,
        observedAt: new Date(Date.UTC(2026, 8, 5, 0, 0, sample)).toISOString() })
      assert.strictEqual(write.status, 'persisted')
    }

    const fresh = readValidationPerformanceHistory({ activeRoot })
    assert.strictEqual(fresh.status, 'fresh')
    assert.strictEqual(Object.keys(fresh.history.buckets).length, 2)
    const historical = estimateValidationEta({ plan, activeRoot, history: fresh.history })
    assert.strictEqual(historical.confidence, 'historical')
    assert.strictEqual(historical.criticalPathWaveCount, 1)
    assert(historical.estimatedRemainingMs >= 200 && historical.estimatedRemainingMs <= 210)
    const partial = estimateValidationEta({
      plan,
      activeRoot,
      history: fresh.history,
      completedNodeIds: ['history-a']
    })
    assert.strictEqual(partial.remainingNodeCount, 1)
    assert.strictEqual(partial.confidence, 'historical')

    for (let sample = 0; sample < SAMPLE_LIMIT + 5; sample += 1) {
      recordValidationPerformance({
        activeRoot,
        results: [{
          nodeId: nodes[0].id,
          nodeContractDigest: executionNodeContractDigest(nodes[0], activeRoot),
          status: 'passed',
          exitCode: 0,
          durationMs: 300 + sample
        }],
        observedAt: new Date(Date.UTC(2026, 8, 6, 0, 0, sample)).toISOString()
      })
    }
    const bounded = readValidationPerformanceHistory({ activeRoot })
    const firstBucket = Object.values(bounded.history.buckets).find(bucket => bucket.nodeId === 'history-a')
    assert.strictEqual(firstBucket.successSamples.length, SAMPLE_LIMIT)

    const beforeCacheHit = firstBucket.successSamples.length
    recordValidationPerformance({
      activeRoot,
      results: [{
        nodeId: nodes[0].id,
        nodeContractDigest: executionNodeContractDigest(nodes[0], activeRoot),
        status: 'cache-hit',
        exitCode: 0,
        durationMs: 0
      }]
    })
    const afterCacheHit = readValidationPerformanceHistory({ activeRoot })
    assert.strictEqual(Object.values(afterCacheHit.history.buckets)
      .find(bucket => bucket.nodeId === 'history-a').successSamples.length, beforeCacheHit)

    const historyFile = resolveValidationPerformanceHistoryFile(activeRoot)
    assert(historyFile.includes(path.join('.tmp', 'devcodex', 'cache', 'validation-performance')))
    assert(!historyFile.includes(path.join('.devcodex', '.runtime-state')))
    fs.writeFileSync(historyFile, '{invalid json\n')
    assert.strictEqual(readValidationPerformanceHistory({ activeRoot }).status, 'invalid')

    const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validation-history-broken-'))
    try {
      const brokenFile = resolveValidationPerformanceHistoryFile(brokenRoot)
      fs.mkdirSync(brokenFile, { recursive: true })
      const failSoftWrite = recordValidationPerformance({
        activeRoot: brokenRoot,
        results: [{
          nodeId: 'node-a',
          nodeContractDigest: executionNodeContractDigest(plan.selectedNodes[0], brokenRoot),
          status: 'passed',
          exitCode: 0,
          durationMs: 100
        }]
      })
      assert.strictEqual(failSoftWrite.status, 'invalid')
      assert.strictEqual(failSoftWrite.schemaVersion, 'ValidationPerformanceHistoryWriteReceiptV1')
    } finally {
      safeCleanup(brokenRoot)
    }
  } finally {
    safeCleanup(activeRoot)
  }
  process.stdout.write('validation performance history tests passed\n')
}

run()
