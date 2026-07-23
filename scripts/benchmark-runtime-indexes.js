#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const { stableStringify } = require('../hooks/_runtime/content-identity.cjs')
const {
  buildSummaryPartitions,
  queryDailyIndex,
  queryStatusIndex,
  refreshDailyIndex,
  refreshSummaryIndex
} = require('./lib/memory-index.js')
const {
  buildRuntimeStateIndex,
  loadRuntimeStateIndex,
  resolveDefaultActiveRoot,
  writeRuntimeStateProjection
} = require('./lib/runtime-state-index.js')
const {
  queryReportIndex,
  rebuildReportIndex,
  scanReportCatalog
} = require('./lib/report-index.js')
const {
  parseDailySessions,
  parseSummaryRows,
  readMemoryDocument
} = require('../mcp/memory-server.js')

const SOURCE_ROOT = path.resolve(__dirname, '..')
const BENCHMARK_SCHEMA = 'RuntimeDerivedIndexBenchmarkV1'

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function percentile(values, ratio) {
  const sorted = values.slice().sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

function summarizeTimes(values) {
  return {
    samples: values.length,
    meanMs: values.reduce((total, value) => total + value, 0) / values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values)
  }
}

function timed(operation) {
  const started = process.hrtime.bigint()
  const value = operation()
  return {
    value,
    elapsedMs: Number(process.hrtime.bigint() - started) / 1e6
  }
}

function measure(operation, warmup, measurements) {
  for (let index = 0; index < warmup; index += 1) operation()
  const values = []
  let sample = null
  for (let index = 0; index < measurements; index += 1) {
    const result = timed(operation)
    sample = result.value
    values.push(result.elapsedMs)
  }
  return { timing: summarizeTimes(values), sample }
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value))
}

function valueDigest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function reductionPercent(baseline, candidate) {
  if (!Number.isFinite(baseline) || baseline <= 0) return null
  return ((baseline - candidate) / baseline) * 100
}

function normalizeMemoryStatus(payload, limit) {
  return {
    latestRows: payload.latestRows.slice().reverse().slice(0, limit),
    activeSessionIds: payload.activeSessionIds,
    conflicts: payload.conflicts,
    nonCanonicalActiveCount: payload.nonCanonicalActiveCount,
    warnings: payload.warnings
  }
}

function benchmarkOperation(id, baselineOperation, candidateOperation, warmup, measurements, cold = {}) {
  const baselineCold = timed(baselineOperation)
  const candidateCold = timed(candidateOperation)
  const baseline = measure(baselineOperation, warmup, measurements)
  const candidate = measure(candidateOperation, warmup, measurements)
  const baselineNormalized = baseline.sample.normalized
  const candidateNormalized = candidate.sample.normalized
  const correctness = stableStringify(baselineNormalized) === stableStringify(candidateNormalized)
  const baselineReadBytes = Number(baseline.sample.sourceBytes || 0) + Number(baseline.sample.indexBytes || 0)
  const candidateReadBytes = Number(candidate.sample.sourceBytes || 0) + Number(candidate.sample.indexBytes || 0)
  return {
    id,
    correctness: {
      mismatchCount: correctness ? 0 : 1,
      baselineDigest: valueDigest(baselineNormalized),
      candidateDigest: valueDigest(candidateNormalized)
    },
    cold: {
      baselineMs: baselineCold.elapsedMs,
      candidateQueryMs: candidateCold.elapsedMs,
      candidateBuildMs: cold.candidateBuildMs ?? null,
      candidateBuildStatus: cold.candidateBuildStatus ?? null
    },
    warm: {
      baseline: baseline.timing,
      candidate: candidate.timing,
      p95DeltaPercent: reductionPercent(baseline.timing.p95Ms, candidate.timing.p95Ms) === null
        ? null
        : -reductionPercent(baseline.timing.p95Ms, candidate.timing.p95Ms)
    },
    bytes: {
      baselineSourceBytes: baseline.sample.sourceBytes,
      candidateSourceBytes: candidate.sample.sourceBytes,
      baselineIndexBytes: baseline.sample.indexBytes || 0,
      candidateIndexBytes: candidate.sample.indexBytes || 0,
      baselineTotalReadBytes: baselineReadBytes,
      candidateTotalReadBytes: candidateReadBytes,
      totalReadReductionPercent: reductionPercent(baselineReadBytes, candidateReadBytes),
      baselineDeliveredBytes: baseline.sample.deliveredBytes,
      candidateDeliveredBytes: candidate.sample.deliveredBytes,
      deliveredDeltaPercent: baseline.sample.deliveredBytes
        ? ((candidate.sample.deliveredBytes - baseline.sample.deliveredBytes) / baseline.sample.deliveredBytes) * 100
        : null
    }
  }
}

function documentFrom(filePath) {
  return readMemoryDocument(filePath)
}

function findAgent(activeRoot) {
  const clientsRoot = path.join(activeRoot, '.memory', 'clients')
  if (fs.existsSync(path.join(clientsRoot, 'codex', 'SUMMARY.md'))) return 'codex'
  const candidate = fs.readdirSync(clientsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(clientsRoot, entry.name, 'SUMMARY.md')))
    .map(entry => entry.name)
    .sort()[0]
  if (!candidate) throw new Error('benchmark requires one memory client with SUMMARY.md')
  return candidate
}

function findLatestDaily(activeRoot, agent) {
  const tasksRoot = path.join(activeRoot, '.memory', 'clients', agent, 'tasks')
  const dates = fs.readdirSync(tasksRoot)
    .filter(name => /^\d{8}\.md$/.test(name))
    .sort()
  if (!dates.length) throw new Error('benchmark requires one canonical daily memory file')
  const name = dates[dates.length - 1]
  return { date: name.slice(0, 8), filePath: path.join(tasksRoot, name) }
}

function compactRuntimeRecords(index, state = 'closed', limit = 20) {
  return index.records
    .filter(record => !state || record.normalizedStatus === state)
    .slice(0, limit)
    .map(record => ({
      recordId: record.recordId,
      normalizedStatus: record.normalizedStatus,
      conflict: record.conflict,
      selectedAnchor: record.selectedAnchor,
      consumerDrifts: record.consumerDrifts
    }))
}

function chooseReportTask(scan, requested) {
  if (requested && scan.entries.some(entry => entry.task === requested && entry.classification === 'primary-report')) return requested
  return scan.entries.find(entry => entry.task && entry.classification === 'primary-report')?.task || null
}

function legacyReportResult(activeRoot, task, limit) {
  const scan = scanReportCatalog(activeRoot, { readHeaders: true })
  const items = scan.entries
    .filter(entry => entry.classification === 'primary-report')
    .filter(entry => !task || entry.task === task)
    .sort((left, right) =>
      right.date.localeCompare(left.date) ||
      right.modifiedAt.localeCompare(left.modifiedAt) ||
      left.path.localeCompare(right.path))
    .slice(0, limit)
  return {
    normalized: items,
    sourceBytes: scan.sourceBytesRead,
    indexBytes: 0,
    deliveredBytes: jsonBytes(items)
  }
}

function runWorker() {
  const activeRoot = path.resolve(argument('--root', resolveDefaultActiveRoot(SOURCE_ROOT)))
  const warmup = Number(argument('--warmup', '5'))
  const measurements = Number(argument('--measurements', '30'))
  const requestedTask = argument('--task')
  const agent = findAgent(activeRoot)
  const target = {
    activeRoot,
    project: path.basename(activeRoot),
    scope: 'project',
    agent
  }

  const summaryPath = path.join(activeRoot, '.memory', 'clients', agent, 'SUMMARY.md')
  const summaryDocument = documentFrom(summaryPath)
  const summaryParsed = parseSummaryRows(summaryDocument.content)
  const summaryBuild = timed(() => refreshSummaryIndex({
    target,
    document: summaryDocument,
    parsed: summaryParsed,
    freshnessTier: 'writer-attested'
  }))
  const summaryPayload = buildSummaryPartitions(summaryDocument, summaryParsed)
    .find(partition => partition.key === 'summary:status').payload
  const memoryLimit = 5
  const w1 = benchmarkOperation(
    'W1-memory-latest-active',
    () => {
      const document = documentFrom(summaryPath)
      const parsed = parseSummaryRows(document.content)
      const payload = buildSummaryPartitions(document, parsed)
        .find(partition => partition.key === 'summary:status').payload
      const normalized = normalizeMemoryStatus(payload, memoryLimit)
      return {
        normalized,
        sourceBytes: document.bytes,
        indexBytes: 0,
        deliveredBytes: jsonBytes(normalized)
      }
    },
    () => {
      const result = queryStatusIndex({ target, sourcePath: summaryPath, limit: memoryLimit })
      if (result.status !== 'fresh') throw new Error(`W1 candidate route was ${result.status}`)
      const normalized = {
        latestRows: result.latestRows,
        activeSessionIds: result.activeSessionIds,
        conflicts: result.conflicts,
        nonCanonicalActiveCount: result.nonCanonicalActiveCount,
        warnings: result.warnings
      }
      return {
        normalized,
        sourceBytes: 0,
        indexBytes: result.envelope.telemetry.sourceBytes,
        deliveredBytes: jsonBytes(normalized)
      }
    },
    warmup,
    measurements,
    { candidateBuildMs: summaryBuild.elapsedMs, candidateBuildStatus: summaryBuild.value.status }
  )
  if (!summaryPayload.latestRows.length) throw new Error('W1 requires at least one summary row')

  const daily = findLatestDaily(activeRoot, agent)
  const dailyDocument = documentFrom(daily.filePath)
  const dailyParsed = parseDailySessions(dailyDocument.content, daily.date)
  const selectedSession = dailyParsed.sessions[dailyParsed.sessions.length - 1]
  if (!selectedSession) throw new Error('W2 requires one parsed daily session')
  const dailyBuild = timed(() => refreshDailyIndex({
    target,
    date: daily.date,
    document: dailyDocument,
    parsed: dailyParsed,
    freshnessTier: 'writer-attested'
  }))
  const dailyMaxChars = 4000
  const w2 = benchmarkOperation(
    'W2-memory-exact-daily-session',
    () => {
      const document = documentFrom(daily.filePath)
      const parsed = parseDailySessions(document.content, daily.date)
      const session = parsed.sessions.find(item => item.sessionId === selectedSession.sessionId)
      const normalized = {
        sessionId: session.sessionId,
        title: session.title,
        state: session.state,
        content: session.content.slice(0, dailyMaxChars).trim()
      }
      return {
        normalized,
        sourceBytes: document.bytes,
        indexBytes: 0,
        deliveredBytes: jsonBytes(normalized)
      }
    },
    () => {
      const result = queryDailyIndex({
        target,
        sourcePath: daily.filePath,
        date: daily.date,
        sessionId: selectedSession.sessionId,
        limit: 1,
        maxChars: dailyMaxChars
      })
      if (result.status !== 'fresh' || !result.matches[0]) throw new Error(`W2 candidate route was ${result.status}`)
      const session = result.matches[0]
      const normalized = {
        sessionId: session.sessionId,
        title: session.title,
        state: session.state,
        content: session.content.slice(0, dailyMaxChars).trim()
      }
      return {
        normalized,
        sourceBytes: result.envelope.telemetry.sourceBytes,
        indexBytes: result.envelope.telemetry.indexBytesRead,
        deliveredBytes: jsonBytes(normalized)
      }
    },
    warmup,
    measurements,
    { candidateBuildMs: dailyBuild.elapsedMs, candidateBuildStatus: dailyBuild.value.status }
  )

  const runtimeBuild = timed(() => {
    const index = buildRuntimeStateIndex(activeRoot)
    return {
      index,
      commit: writeRuntimeStateProjection(activeRoot, index)
    }
  })
  const w3 = benchmarkOperation(
    'W3-runtime-state-by-status',
    () => {
      const index = buildRuntimeStateIndex(activeRoot)
      const normalized = compactRuntimeRecords(index)
      return {
        normalized,
        sourceBytes: index.sourceObservations.reduce((total, item) => total + item.bytes, 0),
        indexBytes: 0,
        deliveredBytes: jsonBytes(normalized)
      }
    },
    () => {
      const loaded = loadRuntimeStateIndex(activeRoot)
      if (loaded.receipt.route !== 'derived-index') throw new Error(`W3 candidate route was ${loaded.receipt.route}`)
      const normalized = compactRuntimeRecords(loaded.index)
      return {
        normalized,
        sourceBytes: 0,
        indexBytes: loaded.receipt.deliveredBytes,
        deliveredBytes: jsonBytes(normalized)
      }
    },
    warmup,
    measurements,
    {
      candidateBuildMs: runtimeBuild.elapsedMs,
      candidateBuildStatus: runtimeBuild.value.commit.status
    }
  )

  const initialReportScan = scanReportCatalog(activeRoot)
  const reportTask = chooseReportTask(initialReportScan, requestedTask)
  const reportBuild = timed(() => rebuildReportIndex(activeRoot))
  const reportLimit = 5
  const w4 = benchmarkOperation(
    'W4-report-by-task-date-class',
    () => legacyReportResult(activeRoot, reportTask, reportLimit),
    () => {
      const result = queryReportIndex(activeRoot, { task: reportTask, limit: reportLimit })
      if (result.status !== 'fresh') throw new Error(`W4 candidate route was ${result.status}`)
      return {
        normalized: result.items,
        sourceBytes: result.telemetry.sourceBytes,
        indexBytes: result.telemetry.indexBytesRead,
        deliveredBytes: jsonBytes(result.items)
      }
    },
    warmup,
    measurements,
    { candidateBuildMs: reportBuild.elapsedMs, candidateBuildStatus: reportBuild.value.status }
  )

  return {
    schemaVersion: 'RuntimeDerivedIndexBenchmarkRoundV1',
    pid: process.pid,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    activeRoot,
    warmup,
    measurements,
    reportTask,
    workloads: [w1, w2, w3, w4]
  }
}

function aggregateRounds(rounds) {
  const workloadIds = rounds[0].workloads.map(workload => workload.id)
  return workloadIds.map(id => {
    const samples = rounds.map(round => round.workloads.find(workload => workload.id === id))
    const first = samples[0]
    const correctnessMismatchCount = samples.reduce((total, sample) => total + sample.correctness.mismatchCount, 0)
    const sourceReduction = samples.map(sample => sample.bytes.totalReadReductionPercent)
    const p95Delta = samples.map(sample => sample.warm.p95DeltaPercent)
    return {
      id,
      correctnessMismatchCount,
      rounds: samples.length,
      sourceReadReductionPercent: {
        min: Math.min(...sourceReduction),
        mean: sourceReduction.reduce((total, value) => total + value, 0) / sourceReduction.length,
        max: Math.max(...sourceReduction)
      },
      warmP95DeltaPercent: {
        min: Math.min(...p95Delta),
        mean: p95Delta.reduce((total, value) => total + value, 0) / p95Delta.length,
        max: Math.max(...p95Delta)
      },
      deliveredDeltaPercent: first.bytes.deliveredDeltaPercent,
      sampleBytes: first.bytes,
      sampleCold: first.cold
    }
  })
}

function runParent() {
  const activeRoot = path.resolve(argument('--root', resolveDefaultActiveRoot(SOURCE_ROOT)))
  const roundsRequested = Number(argument('--rounds', '3'))
  const warmup = Number(argument('--warmup', '5'))
  const measurements = Number(argument('--measurements', '30'))
  const task = argument('--task', '运行态产物分层存储与索引')
  const rounds = []
  for (let round = 1; round <= roundsRequested; round += 1) {
    const args = [
      __filename,
      '--worker',
      '--root', activeRoot,
      '--warmup', String(warmup),
      '--measurements', String(measurements),
      '--task', task
    ]
    const child = spawnSync(process.execPath, args, {
      cwd: SOURCE_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    })
    if (child.status !== 0) {
      throw new Error(`benchmark round ${round} failed: ${String(child.stderr || child.stdout).trim()}`)
    }
    rounds.push(JSON.parse(child.stdout))
  }
  const aggregates = aggregateRounds(rounds)
  const acceptance = {
    correctness: aggregates.every(item => item.correctnessMismatchCount === 0),
    sourceRead: aggregates
      .filter(item => ['W1-memory-latest-active', 'W3-runtime-state-by-status', 'W4-report-by-task-date-class'].includes(item.id))
      .every(item => item.sourceReadReductionPercent.min >= 70),
    delivered: aggregates
      .filter(item => item.id === 'W1-memory-latest-active')
      .every(item => item.deliveredDeltaPercent <= 5),
    latency: aggregates.every(item => item.warmP95DeltaPercent.max <= 10)
  }
  const result = {
    schemaVersion: BENCHMARK_SCHEMA,
    generatedAt: new Date().toISOString(),
    protocol: {
      rounds: roundsRequested,
      independentProcesses: true,
      warmup,
      measurements,
      sourceSnapshot: activeRoot,
      cacheState: 'warm measurements after per-process warmup; cold build/query reported separately'
    },
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: process.env.PROCESSOR_IDENTIFIER || null
    },
    tokenMeasurement: {
      status: 'provisional',
      measured: false,
      reason: 'host token telemetry is unavailable; bytes are not reported as tokens'
    },
    aggregates,
    acceptance,
    status: Object.values(acceptance).every(Boolean) ? 'accepted' : 'not-accepted',
    rounds
  }
  const output = argument('--output')
  if (output) {
    const outputPath = path.resolve(output)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8')
  }
  if (!process.argv.includes('--quiet')) process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (result.status !== 'accepted') process.exitCode = 1
}

if (process.argv.includes('--worker')) {
  process.stdout.write(JSON.stringify(runWorker()) + '\n')
} else {
  runParent()
}
