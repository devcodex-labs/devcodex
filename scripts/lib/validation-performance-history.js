'use strict'

const os = require('os')
const path = require('path')

const { createDerivedStateStore } = require('../../hooks/_runtime/derived-state-store.cjs')
const { sha256, stableStringify } = require('../../hooks/_runtime/content-identity.cjs')
const { resolveWorkspaceTempRoot } = require('./workspace-temp-layout')

const HISTORY_SCHEMA = 'ValidationPerformanceHistoryV1'
const ETA_SCHEMA = 'ValidationEtaProjectionV1'
const HISTORY_RELATIVE_PATH = path.join('cache', 'validation-performance', 'v1', 'history.json')
const HISTORY_MAX_BYTES = 4 * 1024 * 1024
const BUCKET_MAX_BYTES = 64 * 1024
const HISTORY_MAX_BUCKETS = 1024
const SAMPLE_LIMIT = 20
const MIN_CONFIDENT_SAMPLES = 5

function runtimePerformanceContext() {
  const cpus = os.cpus() || []
  const model = String(cpus[0]?.model || 'unknown').trim().replace(/\s+/g, ' ')
  const coreBand = cpus.length >= 16 ? '16+' : (cpus.length >= 8 ? '8-15' : (cpus.length >= 4 ? '4-7' : '1-3'))
  return Object.freeze({
    platform: `${process.platform}-${process.arch}`,
    nodeMajor: String(process.versions.node || '').split('.')[0] || 'unknown',
    cpuClass: `${coreBand}:${sha256(Buffer.from(model, 'utf8')).slice(0, 12)}`
  })
}

function resolveValidationPerformanceHistoryFile(activeRoot) {
  return path.join(resolveWorkspaceTempRoot(activeRoot), HISTORY_RELATIVE_PATH)
}

function emptyHistory(now = new Date().toISOString()) {
  return {
    schemaVersion: HISTORY_SCHEMA,
    updatedAt: now,
    buckets: {}
  }
}

function boundedSamples(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(sample => sample && Number.isFinite(sample.durationMs) && sample.durationMs >= 0 &&
      Number.isFinite(Date.parse(String(sample.observedAt || ''))))
    .slice(-SAMPLE_LIMIT)
}

function normalizeHistory(value) {
  if (!value || value.schemaVersion !== HISTORY_SCHEMA ||
      !value.buckets || typeof value.buckets !== 'object' || Array.isArray(value.buckets)) {
    return emptyHistory()
  }
  const buckets = {}
  for (const [key, bucket] of Object.entries(value.buckets).slice(-HISTORY_MAX_BUCKETS)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !bucket || typeof bucket !== 'object' ||
        !/^[a-f0-9]{64}$/.test(String(bucket.nodeContractDigest || ''))) continue
    const normalized = {
      schemaVersion: 'ValidationPerformanceBucketV1',
      key,
      nodeId: String(bucket.nodeId || ''),
      nodeContractDigest: bucket.nodeContractDigest,
      platform: String(bucket.platform || ''),
      nodeMajor: String(bucket.nodeMajor || ''),
      cpuClass: String(bucket.cpuClass || ''),
      cacheState: String(bucket.cacheState || 'cold'),
      lastUsedAt: Number.isFinite(Date.parse(String(bucket.lastUsedAt || '')))
        ? bucket.lastUsedAt
        : new Date(0).toISOString(),
      successSamples: boundedSamples(bucket.successSamples),
      failureSamples: boundedSamples(bucket.failureSamples)
    }
    if (Buffer.byteLength(stableStringify(normalized), 'utf8') <= BUCKET_MAX_BYTES) buckets[key] = normalized
  }
  return {
    schemaVersion: HISTORY_SCHEMA,
    updatedAt: Number.isFinite(Date.parse(String(value.updatedAt || ''))) ? value.updatedAt : new Date().toISOString(),
    buckets
  }
}

function historyStore(activeRoot, maxWrites = 0) {
  return createDerivedStateStore({
    root: resolveWorkspaceTempRoot(activeRoot),
    relativePath: HISTORY_RELATIVE_PATH,
    maxBytes: HISTORY_MAX_BYTES,
    maxWrites
  })
}

function readValidationPerformanceHistory({ activeRoot }) {
  let observed
  try {
    observed = historyStore(activeRoot).read()
  } catch (error) {
    return { status: 'invalid', errorCode: error.code || 'VALIDATION_HISTORY_READ_FAILED', filePath: null, history: emptyHistory() }
  }
  if (observed.status !== 'fresh') {
    return { status: observed.status, filePath: observed.filePath, history: emptyHistory() }
  }
  const normalized = normalizeHistory(observed.value)
  const valid = normalized.schemaVersion === observed.value.schemaVersion &&
    Object.keys(normalized.buckets).length === Object.keys(observed.value.buckets || {}).length
  return { status: valid ? 'fresh' : 'invalid', filePath: observed.filePath, history: normalized }
}

function bucketIdentity({ nodeContractDigest, cacheState = 'cold', context = runtimePerformanceContext() }) {
  const descriptor = {
    schemaVersion: 'ValidationPerformanceBucketIdentityV1',
    nodeContractDigest,
    platform: context.platform,
    nodeMajor: context.nodeMajor,
    cpuClass: context.cpuClass,
    cacheState
  }
  return { ...descriptor, key: sha256(Buffer.from(stableStringify(descriptor), 'utf8')) }
}

function trimHistory(history) {
  const ordered = Object.entries(history.buckets)
    .sort((left, right) => Date.parse(String(right[1].lastUsedAt || 0)) - Date.parse(String(left[1].lastUsedAt || 0)))
  history.buckets = Object.fromEntries(ordered.slice(0, HISTORY_MAX_BUCKETS))
  while (Buffer.byteLength(JSON.stringify(history, null, 2) + '\n', 'utf8') > HISTORY_MAX_BYTES &&
      Object.keys(history.buckets).length > 0) {
    const oldest = Object.entries(history.buckets)
      .sort((left, right) => Date.parse(String(left[1].lastUsedAt || 0)) - Date.parse(String(right[1].lastUsedAt || 0)))[0]
    delete history.buckets[oldest[0]]
  }
  return history
}

function recordValidationPerformance({ activeRoot, results = [], observedAt = new Date().toISOString() }) {
  const context = runtimePerformanceContext()
  let store
  try {
    store = historyStore(activeRoot, 1)
  } catch (error) {
    return {
      schemaVersion: 'ValidationPerformanceHistoryWriteReceiptV1',
      status: 'error',
      filePath: null,
      errorCode: error.code || 'VALIDATION_HISTORY_WRITE_FAILED',
      bytes: null
    }
  }
  let persisted
  try {
    persisted = store.update(current => {
      const history = normalizeHistory(current)
      for (const result of results) {
        if (!result || !/^[a-f0-9]{64}$/.test(String(result.nodeContractDigest || '')) ||
            result.status === 'cache-hit' || !Number.isFinite(Number(result.durationMs))) continue
        const failed = result.status === 'failed' || result.exitCode !== 0
        const cancelledOrTimedOut = /(?:cancel|timeout|timedout)/i.test(String(result.errorCode || result.signal || ''))
        const identity = bucketIdentity({ nodeContractDigest: result.nodeContractDigest, cacheState: 'cold', context })
        const bucket = history.buckets[identity.key] || {
          schemaVersion: 'ValidationPerformanceBucketV1',
          key: identity.key,
          nodeId: result.nodeId,
          nodeContractDigest: identity.nodeContractDigest,
          platform: identity.platform,
          nodeMajor: identity.nodeMajor,
          cpuClass: identity.cpuClass,
          cacheState: identity.cacheState,
          lastUsedAt: observedAt,
          successSamples: [],
          failureSamples: []
        }
        bucket.nodeId = result.nodeId
        bucket.lastUsedAt = observedAt
        const sample = { durationMs: Math.max(0, Number(result.durationMs)), observedAt }
        if (failed) {
          bucket.failureSamples.push({ ...sample, errorCode: result.errorCode || null })
          bucket.failureSamples = bucket.failureSamples.slice(-SAMPLE_LIMIT)
        } else if (!cancelledOrTimedOut && result.status === 'passed' && result.exitCode === 0) {
          bucket.successSamples.push(sample)
          bucket.successSamples = bucket.successSamples.slice(-SAMPLE_LIMIT)
        }
        if (Buffer.byteLength(stableStringify(bucket), 'utf8') <= BUCKET_MAX_BYTES) {
          history.buckets[identity.key] = bucket
        }
      }
      history.updatedAt = observedAt
      return trimHistory(history)
    })
  } catch (error) {
    return {
      schemaVersion: 'ValidationPerformanceHistoryWriteReceiptV1',
      status: 'error',
      filePath: store.filePath || null,
      errorCode: error.code || 'VALIDATION_HISTORY_WRITE_FAILED',
      bytes: null
    }
  }
  return {
    schemaVersion: 'ValidationPerformanceHistoryWriteReceiptV1',
    status: persisted.status,
    filePath: persisted.filePath,
    errorCode: persisted.errorCode || null,
    bytes: persisted.bytes || null
  }
}

function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) return null
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

function executionNodeContractDigest(node, activeRoot) {
  const executionNode = {
    ...node,
    environment: {
      ...(node.environment || {}),
      ...(activeRoot ? { DEVCODEX_VALIDATION_ACTIVE_ROOT: path.resolve(activeRoot) } : {})
    }
  }
  return sha256(Buffer.from(stableStringify(executionNode), 'utf8'))
}

function estimateValidationEta({ plan, activeRoot, history, completedNodeIds = [] }) {
  const normalized = normalizeHistory(history)
  const context = runtimePerformanceContext()
  const completed = new Set(completedNodeIds)
  const byId = new Map((plan?.selectedNodes || []).map(node => [node.id, node]))
  const waves = plan?.executionSchedule?.waves || [...byId.keys()].map(id => [id])
  let confidentNodes = 0
  let remainingNodes = 0
  let estimateMs = 0
  let lowerMs = 0
  let upperMs = 0
  let criticalPathWaveCount = 0

  for (const wave of waves) {
    const estimates = []
    for (const nodeId of wave) {
      if (completed.has(nodeId)) continue
      const node = byId.get(nodeId)
      if (!node) continue
      remainingNodes += 1
      const nodeContractDigest = executionNodeContractDigest(node, activeRoot)
      const identity = bucketIdentity({ nodeContractDigest, cacheState: 'cold', context })
      const samples = boundedSamples(normalized.buckets[identity.key]?.successSamples).map(item => item.durationMs)
      if (samples.length >= MIN_CONFIDENT_SAMPLES) {
        confidentNodes += 1
        const p50 = percentile(samples, 0.5)
        const p95 = percentile(samples, 0.95)
        estimates.push({ estimate: Math.min(p50, p95), lower: Math.max(0, percentile(samples, 0.25)), upper: p95 })
      } else {
        const declared = Math.max(1, Math.min(Number(node.timeoutMs || 10000), Number(node.estimatedDurationMs || 10000)))
        estimates.push({ estimate: declared, lower: Math.max(1, Math.floor(declared * 0.5)), upper: Math.ceil(declared * 1.5) })
      }
    }
    if (!estimates.length) continue
    criticalPathWaveCount += 1
    estimateMs += Math.max(...estimates.map(item => item.estimate))
    lowerMs += Math.max(...estimates.map(item => item.lower))
    upperMs += Math.max(...estimates.map(item => item.upper))
  }

  const confidence = remainingNodes === 0
    ? 'complete'
    : (confidentNodes === remainingNodes ? 'historical' : 'low')
  return Object.freeze({
    schemaVersion: ETA_SCHEMA,
    confidence,
    remainingNodeCount: remainingNodes,
    confidentNodeCount: confidentNodes,
    sampleCoverage: remainingNodes === 0 ? 1 : Number((confidentNodes / remainingNodes).toFixed(4)),
    estimatedRemainingMs: confidence === 'low' ? null : estimateMs,
    rangeMs: { lower: lowerMs, upper: upperMs },
    criticalPathWaveCount
  })
}

module.exports = {
  BUCKET_MAX_BYTES,
  ETA_SCHEMA,
  HISTORY_MAX_BYTES,
  HISTORY_RELATIVE_PATH,
  HISTORY_SCHEMA,
  MIN_CONFIDENT_SAMPLES,
  SAMPLE_LIMIT,
  bucketIdentity,
  estimateValidationEta,
  executionNodeContractDigest,
  normalizeHistory,
  percentile,
  readValidationPerformanceHistory,
  recordValidationPerformance,
  resolveValidationPerformanceHistoryFile,
  runtimePerformanceContext
}
