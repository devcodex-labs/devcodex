'use strict'

const path = require('path')

const {
  sha256,
  stableStringify
} = require('../../hooks/_runtime/content-identity.cjs')
const { createRuntimeStateStore } = require('../../hooks/_runtime/runtime-state-store.cjs')
const {
  readTaskRecoveryState,
  readEmergencyCloseouts,
  resolveTaskRecoveryMetaDir,
  storePaths,
  updateTaskRecoveryState,
  writeEmergencyCloseout
} = require('../../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  BUDGET_CONFIRMATION_SCHEMA,
  CONTINUATION_AUTHORIZATION_SCHEMA,
  PENDING_BUDGET_SCHEMA,
  transitionValidationContinuation,
  validateBudgetConfirmationReceipt,
  validatePendingBudgetCardBinding,
  validateValidationBudgetProjection,
  validateValidationContinuationAuthorization
} = require('./validation-execution-authority')

const OWNER_STATE_SCHEMA = 'ValidationEvidenceOwnerStateV1'
const FIXED_SLOT_SCHEMA = 'ValidationEvidenceFixedSlotV1'
const RUN_SHARD_SLOT_SCHEMA = 'ValidationRunShardSlotV1'
const RUN_SHARD_WRITER_SCHEMA = 'ValidationRunShardWriterV1'
const TASK_STATE_SCHEMA = 'ValidationExecutionTaskStateV1'
const TERMINAL_PROJECTION_SCHEMA = 'ValidationExecutionTerminalProjectionV3'
const TERMINAL_UNSUPPORTED_VALUE_SCHEMA = 'ValidationTerminalUnsupportedValueV1'
const TERMINAL_LINEAGE_SCHEMA = 'ValidationContinuationTerminalLineageV1'
const RECEIPT_RING_SIZE = 16
const TASKLESS_RUN_SHARD_COUNT = 32
const TASKLESS_RUN_SLOT_COUNT = 2
const ROOT_BUDGET_PROJECTION_MAX_BYTES = 16 * 1024
const RUN_KINDS = new Set(['authority', 'runner', 'terminal'])
const DIGEST_RE = /^[a-f0-9]{64}$/
const OWNER_NAMES = Object.freeze({
  'human-cli': 'manual',
  'trusted-ci': 'ci',
  'release-pipeline': 'release',
  'ai-hook': 'ai'
})

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function evidenceBindingError(code, message, details = null) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function acceptedPrimaryStatus(status) {
  return ['committed', 'semantic-noop', 'persisted'].includes(status)
}

function fixedBase(owner) {
  return path.join('validation-evidence', 'v3', 'owners', owner)
}

function slotStore(activeRoot, project, owner, kind, index) {
  return createRuntimeStateStore({
    activeRoot,
    project,
    relativePath: path.join(fixedBase(owner), kind, `slot-${String(index).padStart(2, '0')}.json`),
    maxBytes: 1024 * 1024,
    maxWrites: 1,
    identityField: 'payloadIdentity'
  })
}

function writerStore(activeRoot, project, owner) {
  return createRuntimeStateStore({
    activeRoot,
    project,
    relativePath: path.join(fixedBase(owner), 'writer-state.json'),
    maxBytes: 16 * 1024,
    maxWrites: 1,
    identityField: 'writerIdentity'
  })
}

function validSlot(value, owner, kind) {
  return value?.schemaVersion === FIXED_SLOT_SCHEMA &&
    value.owner === owner && value.kind === kind &&
    Number.isInteger(value.sequence) && value.sequence > 0 &&
    value.payload && digest(value.payload) === value.payloadDigest
}

function readFixedSlots(activeRoot, project, owner, kind) {
  const count = kind === 'authority' ? 2 : RECEIPT_RING_SIZE
  const observed = []
  for (let index = 0; index < count; index += 1) {
    const read = slotStore(activeRoot, project, owner, kind, index).read()
    if (read.status === 'fresh' && validSlot(read.value, owner, kind)) observed.push(read.value)
  }
  return observed.sort((left, right) => right.sequence - left.sequence)
}

function writeFixedSlot({ activeRoot, project, owner, kind, payload, nowMs = Date.now() }) {
  const count = kind === 'authority' ? 2 : RECEIPT_RING_SIZE
  let writeReceipt = null
  let envelope = null
  const writer = writerStore(activeRoot, project, owner)
  try {
    const coordination = writer.update(current => {
      const slots = readFixedSlots(activeRoot, project, owner, kind)
      const sequence = Math.max(Number(current?.sequences?.[kind] || 0), slots[0]?.sequence || 0) + 1
      const index = sequence % count
      envelope = {
        schemaVersion: FIXED_SLOT_SCHEMA,
        owner,
        kind,
        sequence,
        writtenAt: new Date(nowMs).toISOString(),
        payloadDigest: digest(payload),
        payloadIdentity: {
          schemaVersion: 'ContentIdentityV1',
          sourceKey: `validation-${owner}-${kind}-${index}`,
          digest: digest(payload),
          bytes: Buffer.byteLength(stableStringify(payload), 'utf8'),
          contractVersion: '3'
        },
        payload
      }
      writeReceipt = slotStore(activeRoot, project, owner, kind, index).write(envelope)
      if (writeReceipt.status !== 'persisted') {
        const error = new Error(writeReceipt.errorCode || 'VALIDATION_FIXED_SLOT_WRITE_FAILED')
        error.code = writeReceipt.errorCode || 'VALIDATION_FIXED_SLOT_WRITE_FAILED'
        throw error
      }
      const next = {
        schemaVersion: OWNER_STATE_SCHEMA,
        owner,
        sequences: { ...(current?.sequences || {}), [kind]: sequence },
        updatedAt: new Date(nowMs).toISOString()
      }
      next.writerIdentity = {
        schemaVersion: 'ContentIdentityV1',
        sourceKey: `validation-${owner}-writer`,
        digest: digest({ owner, sequences: next.sequences }),
        bytes: Buffer.byteLength(stableStringify(next.sequences), 'utf8'),
        contractVersion: '3'
      }
      return next
    })
    if (coordination.status !== 'persisted') return coordination
    return {
      status: 'persisted',
      stateOwner: 'legacy-taskless-owner-ring',
      owner,
      kind,
      sequence: envelope.sequence,
      slot: writeReceipt.filePath,
      cardinalityLimit: kind === 'authority' ? 2 : RECEIPT_RING_SIZE
    }
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'VALIDATION_FIXED_SLOT_WRITE_FAILED', message: error.message }
  }
}

function runShardIndex(runIdentityDigest) {
  if (!DIGEST_RE.test(String(runIdentityDigest || ''))) {
    const error = new Error('validation run identity digest is required for taskless persistence')
    error.code = 'VALIDATION_RUN_IDENTITY_REQUIRED'
    throw error
  }
  return Number.parseInt(runIdentityDigest.slice(0, 8), 16) % TASKLESS_RUN_SHARD_COUNT
}

function runShardBase(shard) {
  return path.join('validation-evidence', 'v4', 'taskless-run-shards', `shard-${String(shard).padStart(2, '0')}`)
}

function runShardSlotStore(activeRoot, project, shard, kind, index) {
  return createRuntimeStateStore({
    activeRoot,
    project,
    relativePath: path.join(runShardBase(shard), kind, `slot-${index}.json`),
    maxBytes: 1024 * 1024,
    maxWrites: 1,
    identityField: 'payloadIdentity'
  })
}

function runShardWriterStore(activeRoot, project, shard) {
  return createRuntimeStateStore({
    activeRoot,
    project,
    relativePath: path.join(runShardBase(shard), 'writer-state.json'),
    maxBytes: 16 * 1024,
    maxWrites: 1,
    identityField: 'writerIdentity'
  })
}

function validRunShardSlot(value, shard, kind) {
  return value?.schemaVersion === RUN_SHARD_SLOT_SCHEMA &&
    value.shard === shard && value.kind === kind &&
    DIGEST_RE.test(String(value.runIdentityDigest || '')) &&
    Number.isInteger(value.sequence) && value.sequence > 0 &&
    value.payload && digest(value.payload) === value.payloadDigest
}

function readRunShardSlots(activeRoot, project, shard, kind) {
  const observed = []
  for (let index = 0; index < TASKLESS_RUN_SLOT_COUNT; index += 1) {
    const read = runShardSlotStore(activeRoot, project, shard, kind, index).read()
    if (read.status === 'fresh' && validRunShardSlot(read.value, shard, kind)) {
      observed.push({ ...read.value, index, slot: read.filePath || null })
    }
  }
  return observed.sort((left, right) => right.sequence - left.sequence)
}

function liveShardPayload(slot, nowMs) {
  if (slot.kind === 'terminal') return false
  const payload = slot.payload || {}
  if (slot.kind === 'authority') {
    return payload.status === 'active' && Date.parse(String(payload.hardDeadlineAt || payload.expiresAt || '')) > nowMs
  }
  return ['starting', 'running', 'observing', 'reconciling'].includes(payload.phase) &&
    Date.parse(String(payload.hardDeadlineAt || '')) > nowMs
}

function readRunShardPayload({ activeRoot, project, runIdentityDigest, kind }) {
  const shard = runShardIndex(runIdentityDigest)
  const match = readRunShardSlots(activeRoot, project, shard, kind)
    .find(slot => slot.runIdentityDigest === runIdentityDigest)
  return match
    ? { status: 'fresh', payload: match.payload, sequence: match.sequence, slot: match.slot, shard, stateOwner: 'taskless-run-fixed-shard' }
    : { status: 'missing', payload: null, shard, stateOwner: 'taskless-run-fixed-shard' }
}

function writeRunShardPayload({ activeRoot, project, runIdentityDigest, kind, payload, nowMs = Date.now() }) {
  if (!RUN_KINDS.has(kind)) return { status: 'error', errorCode: 'VALIDATION_RUN_SHARD_KIND_INVALID' }
  let shard
  try { shard = runShardIndex(runIdentityDigest) } catch (error) {
    return { status: 'error', errorCode: error.code, message: error.message }
  }
  const writer = runShardWriterStore(activeRoot, project, shard)
  let envelope = null
  let writeReceipt = null
  let semanticNoop = null
  try {
    const coordination = writer.update(current => {
      const slots = readRunShardSlots(activeRoot, project, shard, kind)
      const sameRun = slots.find(slot => slot.runIdentityDigest === runIdentityDigest)
      const payloadDigest = digest(payload)
      if (sameRun && sameRun.payloadDigest === payloadDigest) {
        semanticNoop = sameRun
        if (current) return current
        const repaired = {
          schemaVersion: RUN_SHARD_WRITER_SCHEMA,
          shard,
          sequences: { [kind]: sameRun.sequence },
          updatedAt: new Date(nowMs).toISOString()
        }
        repaired.writerIdentity = {
          schemaVersion: 'ContentIdentityV1',
          sourceKey: `validation-run-shard-${shard}-writer`,
          digest: digest({ shard, sequences: repaired.sequences }),
          bytes: Buffer.byteLength(stableStringify(repaired.sequences), 'utf8'),
          contractVersion: '4'
        }
        return repaired
      }
      if (kind === 'terminal' && sameRun) {
        const error = new Error('the validation run already has a different terminal receipt')
        error.code = 'VALIDATION_TERMINAL_CONFLICT'
        throw error
      }
      const liveForeignRuns = new Set(slots
        .filter(slot => slot.runIdentityDigest !== runIdentityDigest && liveShardPayload(slot, nowMs))
        .map(slot => slot.runIdentityDigest))
      if (kind !== 'terminal' && !sameRun && liveForeignRuns.size >= TASKLESS_RUN_SLOT_COUNT) {
        const error = new Error('taskless validation shard is occupied by live runs')
        error.code = 'VALIDATION_RUN_SHARD_CAPACITY_REACHED'
        throw error
      }
      const sequence = Math.max(Number(current?.sequences?.[kind] || 0), slots[0]?.sequence || 0) + 1
      const liveIndices = new Set(slots.filter(slot => liveShardPayload(slot, nowMs)).map(slot => slot.index))
      const index = sameRun
        ? sameRun.index
        : (kind === 'terminal'
            ? sequence % TASKLESS_RUN_SLOT_COUNT
            : [...Array(TASKLESS_RUN_SLOT_COUNT).keys()].find(candidateIndex => !liveIndices.has(candidateIndex)))
      if (!Number.isInteger(index)) {
        const error = new Error('taskless validation shard has no non-live physical slot')
        error.code = 'VALIDATION_RUN_SHARD_CAPACITY_REACHED'
        throw error
      }
      envelope = {
        schemaVersion: RUN_SHARD_SLOT_SCHEMA,
        shard,
        kind,
        slotIndex: index,
        sequence,
        runIdentityDigest,
        writtenAt: new Date(nowMs).toISOString(),
        payloadDigest,
        payloadIdentity: {
          schemaVersion: 'ContentIdentityV1',
          sourceKey: `validation-run-shard-${shard}-${kind}-${index}`,
          digest: payloadDigest,
          bytes: Buffer.byteLength(stableStringify(payload), 'utf8'),
          contractVersion: '4'
        },
        payload
      }
      writeReceipt = runShardSlotStore(activeRoot, project, shard, kind, index).write(envelope)
      if (writeReceipt.status !== 'persisted') {
        const error = new Error(writeReceipt.errorCode || 'VALIDATION_RUN_SHARD_WRITE_FAILED')
        error.code = writeReceipt.errorCode || 'VALIDATION_RUN_SHARD_WRITE_FAILED'
        throw error
      }
      const next = {
        schemaVersion: RUN_SHARD_WRITER_SCHEMA,
        shard,
        sequences: { ...(current?.sequences || {}), [kind]: sequence },
        updatedAt: new Date(nowMs).toISOString()
      }
      next.writerIdentity = {
        schemaVersion: 'ContentIdentityV1',
        sourceKey: `validation-run-shard-${shard}-writer`,
        digest: digest({ shard, sequences: next.sequences }),
        bytes: Buffer.byteLength(stableStringify(next.sequences), 'utf8'),
        contractVersion: '4'
      }
      return next
    })
    if (semanticNoop) {
      return {
        status: 'semantic-noop', stateOwner: 'taskless-run-fixed-shard', shard, kind,
        sequence: semanticNoop.sequence, slot: semanticNoop.slot, runIdentityDigest
      }
    }
    if (coordination.status !== 'persisted') return coordination
    return {
      status: 'persisted', stateOwner: 'taskless-run-fixed-shard', shard, kind,
      sequence: envelope.sequence, slot: writeReceipt.filePath, runIdentityDigest,
      cardinalityLimit: TASKLESS_RUN_SHARD_COUNT * TASKLESS_RUN_SLOT_COUNT
    }
  } catch (error) {
    return { status: 'error', errorCode: error.code || 'VALIDATION_RUN_SHARD_WRITE_FAILED', message: error.message, shard, kind }
  }
}

function readLatestTasklessTerminal({ activeRoot, project, actorType = null }) {
  const observed = []
  for (let shard = 0; shard < TASKLESS_RUN_SHARD_COUNT; shard += 1) {
    for (const slot of readRunShardSlots(activeRoot, project, shard, 'terminal')) {
      if (actorType && slot.payload?.actorType !== actorType) continue
      observed.push({ ...slot, shard })
    }
  }
  observed.sort((left, right) => {
    const timeOrder = Date.parse(String(right.payload?.completedAt || right.writtenAt || '')) -
      Date.parse(String(left.payload?.completedAt || left.writtenAt || ''))
    return timeOrder || right.sequence - left.sequence || right.shard - left.shard
  })
  const latest = observed[0]
  return latest
    ? { status: 'fresh', receipt: latest.payload, sequence: latest.sequence, shard: latest.shard, stateOwner: 'taskless-run-fixed-shard' }
    : { status: 'missing', receipt: null, stateOwner: 'taskless-run-fixed-shard' }
}

function normalizeTerminalEvidenceValue(value, seen = new Set()) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? (Object.is(value, -0) ? 0 : value)
      : { schemaVersion: TERMINAL_UNSUPPORTED_VALUE_SCHEMA, type: 'non-finite-number', value: String(value) }
  }
  if (typeof value === 'bigint') {
    return { schemaVersion: TERMINAL_UNSUPPORTED_VALUE_SCHEMA, type: 'bigint', value: String(value) }
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return { schemaVersion: TERMINAL_UNSUPPORTED_VALUE_SCHEMA, type: typeof value }
  }
  if (seen.has(value)) return { schemaVersion: TERMINAL_UNSUPPORTED_VALUE_SCHEMA, type: 'cycle' }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value)
    return {
      schemaVersion: TERMINAL_UNSUPPORTED_VALUE_SCHEMA,
      type: 'bytes',
      bytes: bytes.length,
      digest: sha256(bytes)
    }
  }
  if (value instanceof Date) return value.toISOString()
  seen.add(value)
  try {
    if (value instanceof Error) {
      return {
        name: value.name || 'Error',
        code: value.code || null,
        message: value.message || String(value),
        details: normalizeTerminalEvidenceValue(value.details, seen),
        stack: value.stack || null
      }
    }
    if (Array.isArray(value)) return value.map(item => normalizeTerminalEvidenceValue(item, seen))
    const output = {}
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      output.valueType = value.constructor?.name || 'object'
    }
    for (const key of Object.keys(value).sort()) {
      try {
        output[key] = normalizeTerminalEvidenceValue(value[key], seen)
      } catch (error) {
        output[key] = {
          schemaVersion: TERMINAL_UNSUPPORTED_VALUE_SCHEMA,
          type: 'property-read-error',
          code: error.code || null,
          message: error.message || String(error)
        }
      }
    }
    return output
  } finally {
    seen.delete(value)
  }
}

function compactTerminalValue(value, maxBytes = 8192) {
  if (value == null) return null
  const normalized = normalizeTerminalEvidenceValue(value)
  const serialized = stableStringify(normalized)
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes <= maxBytes) return normalized
  return {
    schemaVersion: 'ValidationTerminalCompactValueV1',
    code: typeof normalized?.code === 'string' ? normalized.code : null,
    bytes,
    digest: sha256(Buffer.from(serialized, 'utf8')),
    truncated: true
  }
}

function compactRunnerProjection(runner) {
  if (!runner || typeof runner !== 'object') return null
  const compactStream = stream => stream
    ? {
        bytes: Number(stream.bytes || 0),
        retainedBytes: Math.min(4096, Number(stream.retainedBytes || 0)),
        truncated: stream.truncated === true || Number(stream.retainedBytes || 0) > 4096,
        digest: stream.digest || null,
        preview: String(stream.text || '').slice(0, 4096)
      }
    : null
  return compactTerminalValue({
    schemaVersion: runner.schemaVersion || null,
    runId: runner.runId || null,
    runIdentityDigest: runner.runIdentityDigest || null,
    command: runner.command || null,
    args: runner.args || [],
    cwd: runner.cwd || null,
    runnerPid: runner.runnerPid || null,
    processOwnership: runner.processOwnership || null,
    pollIntervalMs: runner.pollIntervalMs || null,
    hardDeadlineAt: runner.hardDeadlineAt || null,
    startedAt: runner.startedAt || null,
    completedAt: runner.completedAt || null,
    attempts: (runner.attempts || []).slice(-3),
    restarts: (runner.restarts || []).slice(-3),
    recoveries: (runner.recoveries || []).slice(-3),
    checkpoint: runner.checkpoint
      ? {
          schemaVersion: runner.checkpoint.schemaVersion || null,
          checkpointDigest: runner.checkpoint.checkpointDigest || null,
          completedNodeCount: runner.checkpoint.results?.length || 0,
          completedNodeIds: runner.checkpoint.completedNodeIds || []
        }
      : null,
    ipc: runner.ipc || null,
    stdout: compactStream(runner.stdout),
    stderr: compactStream(runner.stderr),
    termination: runner.termination || null
  }, 24 * 1024)
}

function buildTerminalProjection(receipt) {
  const allCandidateChangedFiles = [...new Set((receipt.candidateIdentity?.changedFiles || [])
    .map(value => String(value || '').replace(/\\/g, '/').trim())
    .filter(Boolean))].sort()
  const candidateChangedFiles = []
  let candidateChangedFileBytes = 0
  for (const file of allCandidateChangedFiles) {
    const nextBytes = Buffer.byteLength(file, 'utf8') + 4
    if (candidateChangedFiles.length >= 256 || candidateChangedFileBytes + nextBytes > 24 * 1024) break
    candidateChangedFiles.push(file)
    candidateChangedFileBytes += nextBytes
  }
  const failedResults = (receipt.results || []).filter(result => result?.status === 'failed' ||
    (receipt.failedNode && result?.nodeId === receipt.failedNode))
  const failedResult = failedResults[0] || null
  const allFailedNodes = [...new Set([
    ...(Array.isArray(receipt.failedNodes) ? receipt.failedNodes : []),
    ...failedResults.map(result => result?.nodeId),
    receipt.failedNode
  ].map(value => String(value || '').trim()).filter(Boolean))]
  const failedNodes = []
  let failedNodeBytes = 0
  for (const nodeId of allFailedNodes) {
    const nextBytes = Buffer.byteLength(nodeId, 'utf8') + 4
    if (failedNodes.length >= 256 || failedNodeBytes + nextBytes > 8 * 1024) break
    failedNodes.push(nodeId)
    failedNodeBytes += nextBytes
  }
  const failureStream = (field) => {
    if (!failedResult) return null
    const value = String(failedResult[field] || '')
    const declared = failedResult[`${field}Summary`] || {}
    const bytes = Number.isInteger(declared.bytes) ? declared.bytes : Buffer.byteLength(value, 'utf8')
    const previewBuffer = Buffer.from(value, 'utf8').subarray(0, 2048)
    return {
      bytes,
      retainedBytes: Buffer.byteLength(value, 'utf8'),
      truncated: declared.truncated === true || bytes > previewBuffer.length,
      digest: declared.digest || sha256(Buffer.from(value, 'utf8')),
      preview: previewBuffer.toString('utf8')
    }
  }
  const failureSummary = failedResult
    ? {
        schemaVersion: 'ValidationFailureSummaryV1',
        nodeId: failedResult.nodeId || receipt.failedNode || null,
        errorCode: failedResult.errorCode || null,
        exitCode: Number.isInteger(failedResult.exitCode) ? failedResult.exitCode : null,
        signal: failedResult.signal || null,
        durationMs: Number(failedResult.durationMs || 0),
        stdout: failureStream('stdout'),
        stderr: failureStream('stderr')
      }
    : null
  const allFailureSummaries = failedResults.map(result => ({
    nodeId: result.nodeId || null,
    errorCode: result.errorCode || null,
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    signal: result.signal || null,
    durationMs: Number(result.durationMs || 0)
  }))
  const failureSummaries = []
  let failureSummaryBytes = 0
  for (const summary of allFailureSummaries) {
    const nextBytes = Buffer.byteLength(stableStringify(summary), 'utf8') + 4
    if (failureSummaries.length >= 64 || failureSummaryBytes + nextBytes > 8 * 1024) break
    failureSummaries.push(summary)
    failureSummaryBytes += nextBytes
  }
  const core = {
    schemaVersion: TERMINAL_PROJECTION_SCHEMA,
    receiptId: receipt.receiptId,
    runId: receipt.runId,
    runIdentityDigest: receipt.runIdentityDigest || receipt.runIdentity?.runIdentityDigest || null,
    runIdentity: receipt.runIdentity || null,
    candidateId: receipt.candidateId,
    candidateHead: receipt.candidateIdentity?.head || null,
    candidateDigest: receipt.runIdentity?.candidateDigest || null,
    dirtyScopeDigest: receipt.runIdentity?.dirtyScopeDigest || null,
    candidateChangedFiles,
    candidateChangedFilesTruncated: candidateChangedFiles.length !== allCandidateChangedFiles.length,
    planDigest: receipt.testRouteDigest,
    budgetDigest: receipt.budgetCard?.digest || null,
    requestDigest: receipt.requestDigest || null,
    authorityDigest: receipt.authorityDigest || null,
    authoritySourceRef: receipt.authoritySourceRef || null,
    authorityLineageDigest: receipt.authorityLineageDigest || null,
    actorType: receipt.authorityActorType || null,
    authorityClass: receipt.authorityClass || null,
    verificationLevel: receipt.verificationLevel || null,
    verificationPurpose: receipt.verificationPurpose || null,
    routeResolved: receipt.routeResolved || null,
    budgetProjection: compactTerminalValue(receipt.budgetProjection || null, 16 * 1024),
    terminalStatus: receipt.terminalStatus || (receipt.nativeExitCode === 0 ? 'completed' : 'failed'),
    claimCeiling: receipt.claimCeiling,
    selectedNodeCount: receipt.selectedNodeCount,
    executionCount: receipt.executionCount,
    cacheHitCount: receipt.cacheHitCount,
    resumedNodeCount: Number(receipt.resumedNodeCount || 0),
    resumedNodeIds: receipt.resumedNodeIds || [],
    failedNode: receipt.failedNode || failedNodes[0] || null,
    failedNodeCount: allFailedNodes.length,
    failedNodes,
    failedNodesTruncated: failedNodes.length !== allFailedNodes.length,
    failureSummary,
    failureSummaries,
    failureSummariesTruncated: failureSummaries.length !== allFailureSummaries.length,
    abortedNodes: receipt.abortedNodes || [],
    abortedNodeReasons: compactTerminalValue(receipt.abortedNodeReasons || {}, 8 * 1024),
    nodeReceiptDigests: receipt.nodeReceiptDigests || {},
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    wallTimeMs: receipt.wallTimeMs,
    nativeExitCode: receipt.nativeExitCode,
    terminalReason: compactTerminalValue(receipt.terminalReason || receipt.cancellationReason || null),
    runner: compactRunnerProjection(receipt.runner),
    reconciliation: compactTerminalValue(receipt.reconciliation || null)
  }
  const canonicalCore = normalizeTerminalEvidenceValue(core)
  return { ...canonicalCore, terminalDigest: digest(canonicalCore) }
}

function createValidationEvidenceStore(options = {}) {
  const activeRoot = path.resolve(options.activeRoot)
  const project = String(options.project || 'devcodex')
  const actorType = String(options.actorType || 'human-cli')
  const owner = OWNER_NAMES[actorType] || 'manual'
  const sessionKey = String(options.sessionKey || '')
  const configuredRunIdentityDigest = String(options.runIdentityDigest || options.runIdentity?.runIdentityDigest || '')
  const configuredTaskRecoveryKey = String(options.taskRecoveryKey || options.runIdentity?.taskRecoveryKey || '').trim().toLowerCase()
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot, project })
  let taskIdentity = options.taskIdentity || null
  if (actorType === 'ai-hook') {
    if (!sessionKey || !configuredTaskRecoveryKey) {
      throw evidenceBindingError(
        'VALIDATION_AI_TASK_EVIDENCE_REQUIRED',
        'AI validation evidence requires the exact session and task recovery key'
      )
    }
    const recovered = readTaskRecoveryState({
      metaDir,
      sessionKey,
      expectedIdentity: { activeRoot, project }
    })
    if (recovered.status !== 'fresh' || !recovered.identity?.taskId) {
      throw evidenceBindingError(
        'VALIDATION_AI_TASK_BINDING_UNAVAILABLE',
        'the current session does not resolve to one fresh server-owned task recovery identity',
        { status: recovered.status || 'missing', errorCode: recovered.errorCode || null }
      )
    }
    const recoveredTaskId = String(recovered.identity.taskId).trim().toLowerCase()
    if (recoveredTaskId !== configuredTaskRecoveryKey ||
        (taskIdentity?.taskId && String(taskIdentity.taskId).trim().toLowerCase() !== recoveredTaskId)) {
      throw evidenceBindingError(
        'VALIDATION_AI_TASK_BINDING_MISMATCH',
        'AI validation task identity does not match the current server-owned session binding'
      )
    }
    taskIdentity = recovered.identity
  }
  const taskBound = Boolean(taskIdentity?.taskId)
  const taskSelector = taskBound
    ? { identity: taskIdentity, ...(sessionKey ? { sessionKey } : {}) }
    : { sessionKey }
  let remainingPrimaryTerminalFailures = process.env.DEVCODEX_VALIDATION_TEST_FAULTS === '1'
    ? Math.max(0, Number(options.__testFaults?.primaryTerminalWrites || 0))
    : 0

  function readTask() {
    return readTaskRecoveryState({
      metaDir,
      ...taskSelector,
      expectedIdentity: { activeRoot, project }
    })
  }

  function updateTask(kind, payload, nowMs = Date.now()) {
    const input = {
      metaDir,
      ...taskSelector,
      expectedIdentity: { activeRoot, project },
      readFallback: () => ({})
    }
    const field = kind === 'authority'
      ? 'currentLease'
      : (kind === 'runner' ? 'runnerState' : 'terminalReceipt')
    const commit = updateTaskRecoveryState(input, state => {
      const currentExecution = state.validationExecution || {}
      const existing = currentExecution[field]
      if (kind === 'terminal' && existing?.runIdentityDigest === payload.runIdentityDigest) {
        if (existing.terminalDigest !== payload.terminalDigest) {
          const error = new Error('the validation run already has a different task-bound terminal receipt')
          error.code = 'VALIDATION_TERMINAL_CONFLICT'
          throw error
        }
        return state
      }
      let continuationAuthorization = currentExecution.continuationAuthorization || null
      if (kind === 'authority') {
        const authoritySourceRef = String(payload.authoritySourceRef || '')
        if (authoritySourceRef.startsWith('budget-confirmation:')) {
          const expectedDigest = authoritySourceRef.slice('budget-confirmation:'.length)
          if (currentExecution.rootBudgetConfirmation?.receiptDigest !== expectedDigest ||
              currentExecution.rootBudgetConfirmation?.budgetDigest !== payload.budgetDigest) {
            throw evidenceBindingError(
              'VALIDATION_CONTINUATION_PERSISTENCE_FAILED',
              'lease authority does not match the persisted root BudgetCard confirmation'
            )
          }
        } else if (authoritySourceRef.startsWith('validation-continuation:')) {
          const expectedDigest = authoritySourceRef.slice('validation-continuation:'.length)
          if (continuationAuthorization?.continuationDigest !== expectedDigest ||
              continuationAuthorization?.newBudgetDigest !== payload.budgetDigest ||
              !['prepared', 'leased'].includes(continuationAuthorization?.status)) {
            throw evidenceBindingError(
              'VALIDATION_CONTINUATION_PERSISTENCE_FAILED',
              'lease authority does not match the persisted continuation authorization'
            )
          }
          if (continuationAuthorization.status === 'prepared') {
            continuationAuthorization = transitionValidationContinuation(continuationAuthorization, 'leased')
          }
        }
      }
      const terminalLineage = kind === 'terminal' && continuationAuthorization?.continuationDigest
        ? {
            schemaVersion: TERMINAL_LINEAGE_SCHEMA,
            rootConfirmationDigest: continuationAuthorization.rootConfirmationDigest,
            parentRunIdentityDigest: continuationAuthorization.parentRunIdentityDigest,
            continuationDigest: continuationAuthorization.continuationDigest,
            terminalDigest: payload.terminalDigest,
            retryOrdinal: continuationAuthorization.retryOrdinal,
            status: payload.terminalStatus,
            completedAt: payload.completedAt
          }
        : continuationAuthorization
      return {
        ...state,
        validationExecution: {
          ...currentExecution,
          schemaVersion: TASK_STATE_SCHEMA,
          [field]: payload,
          ...(kind === 'authority' ? { continuationAuthorization } : {}),
          ...(kind === 'terminal'
            ? {
                pendingBudgetCard: null,
                continuationAuthorization: terminalLineage,
                currentLease: null,
                runnerState: null
              }
            : {}),
          updatedAt: new Date(nowMs).toISOString()
        }
      }
    }, { nowMs, force: true })
    return { ...commit, stateOwner: 'task-recovery-v5', kind }
  }

  function updateTaskControl(kind, payload, writeOptions = {}) {
    if (!taskBound) {
      return {
        status: 'error',
        errorCode: 'VALIDATION_TASK_BOUND_STATE_REQUIRED',
        stateOwner: 'task-recovery-v5'
      }
    }
    const nowMs = Number.isFinite(writeOptions.nowMs) ? writeOptions.nowMs : Date.now()
    const input = {
      metaDir,
      ...taskSelector,
      expectedIdentity: { activeRoot, project },
      readFallback: () => ({})
    }
    try {
      const commit = updateTaskRecoveryState(input, state => {
        const currentExecution = state.validationExecution || {}
        const nextExecution = {
          ...currentExecution,
          schemaVersion: TASK_STATE_SCHEMA,
          updatedAt: new Date(nowMs).toISOString()
        }
        if (kind === 'pending') {
          const validation = validatePendingBudgetCardBinding(payload, null, { nowMs })
          if (!validation.valid) throw evidenceBindingError('VALIDATION_PENDING_BUDGET_STALE', 'pending BudgetCard is not fresh', validation)
          const existing = currentExecution.pendingBudgetCard || null
          if (existing?.bindingDigest === payload.bindingDigest) return state
          if (existing) {
            const expectedDigest = writeOptions.expectedBindingDigest || null
            const expectedRevision = Number.isInteger(writeOptions.expectedStateRevision)
              ? writeOptions.expectedStateRevision
              : null
            if (existing.bindingDigest !== expectedDigest || existing.stateRevision !== expectedRevision) {
              throw evidenceBindingError('VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT', 'pending BudgetCard CAS did not match current state')
            }
          }
          nextExecution.pendingBudgetCard = payload
        } else if (kind === 'root-confirmation') {
          const validation = validateBudgetConfirmationReceipt(payload)
          if (!validation.valid) throw evidenceBindingError('VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT', 'root BudgetCard receipt is invalid', validation)
          const rootProjection = writeOptions.rootBudgetProjection || null
          const projectionValidation = validateValidationBudgetProjection(rootProjection, payload)
          const projectionBytes = rootProjection ? Buffer.byteLength(stableStringify(rootProjection), 'utf8') : 0
          if (!projectionValidation.valid || projectionBytes > ROOT_BUDGET_PROJECTION_MAX_BYTES) {
            throw evidenceBindingError('VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
              'root BudgetCard projection is missing, invalid or too large', {
                errors: projectionValidation.errors,
                bytes: projectionBytes,
                maxBytes: ROOT_BUDGET_PROJECTION_MAX_BYTES
              })
          }
          const pending = currentExecution.pendingBudgetCard
          if (!pending || pending.bindingDigest !== payload.pendingBindingDigest) {
            const existingSame = currentExecution.rootBudgetConfirmation?.receiptDigest === payload.receiptDigest
            if (!existingSame) {
              throw evidenceBindingError('VALIDATION_PENDING_BUDGET_MISSING', 'root confirmation requires the unique current pending BudgetCard')
            }
          }
          const existing = currentExecution.rootBudgetConfirmation || null
          const currentEpoch = Number(currentExecution.revocationEpoch || 0)
          if (payload.revocationEpoch !== currentEpoch) {
            throw evidenceBindingError('VALIDATION_CONTINUATION_REVOKED', 'root BudgetCard revocation epoch is not current')
          }
          if (existing?.receiptDigest === payload.receiptDigest &&
              stableStringify(currentExecution.rootBudgetProjection || null) === stableStringify(rootProjection)) return state
          if (existing && existing.receiptDigest !== writeOptions.expectedRootReceiptDigest) {
            throw evidenceBindingError('VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT', 'root BudgetCard confirmation CAS conflicted')
          }
          const rootChanged = Boolean(existing && existing.receiptDigest !== payload.receiptDigest)
          if (rootChanged && (currentExecution.currentLease || currentExecution.runnerState)) {
            throw evidenceBindingError(
              'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
              'a live validation lease or runner must reach a durable terminal state before root replacement'
            )
          }
          nextExecution.pendingBudgetCard = null
          nextExecution.rootBudgetConfirmation = payload
          nextExecution.rootBudgetProjection = rootProjection
          if (rootChanged) {
            nextExecution.continuationAuthorization = null
            nextExecution.currentLease = null
            nextExecution.runnerState = null
            nextExecution.terminalReceipt = null
          }
        } else if (kind === 'continuation') {
          const validation = validateValidationContinuationAuthorization(payload)
          if (!validation.valid) throw evidenceBindingError('VALIDATION_CONTINUATION_PERSISTENCE_FAILED', 'continuation authorization is invalid', validation)
          if (currentExecution.rootBudgetConfirmation?.receiptDigest !== payload.rootConfirmationDigest) {
            throw evidenceBindingError('VALIDATION_CONTINUATION_PERSISTENCE_FAILED', 'continuation root confirmation is not current')
          }
          if (Number(currentExecution.revocationEpoch || 0) !== payload.revocationEpoch) {
            throw evidenceBindingError('VALIDATION_CONTINUATION_REVOKED', 'continuation revocation epoch is not current')
          }
          const existing = currentExecution.continuationAuthorization || null
          if (existing?.continuationDigest === payload.continuationDigest && existing.status === payload.status) return state
          if (existing && ![TERMINAL_LINEAGE_SCHEMA, CONTINUATION_AUTHORIZATION_SCHEMA].includes(existing.schemaVersion)) {
            throw evidenceBindingError('VALIDATION_CONTINUATION_PERSISTENCE_FAILED', 'current continuation state has an unknown schema')
          }
          if (existing?.schemaVersion === CONTINUATION_AUTHORIZATION_SCHEMA &&
              !['consumed', 'revoked', 'stale'].includes(existing.status) &&
              existing.continuationDigest !== writeOptions.expectedContinuationDigest) {
            throw evidenceBindingError('VALIDATION_CONTINUATION_PERSISTENCE_FAILED', 'continuation authorization CAS conflicted')
          }
          nextExecution.continuationAuthorization = payload
        } else if (kind === 'revoke') {
          const currentEpoch = Number(currentExecution.revocationEpoch || 0)
          const expectedEpoch = Number.isInteger(writeOptions.expectedRevocationEpoch)
            ? writeOptions.expectedRevocationEpoch
            : currentEpoch
          if (currentEpoch !== expectedEpoch) {
            throw evidenceBindingError('VALIDATION_CONTINUATION_REVOKED', 'validation revocation epoch CAS conflicted')
          }
          nextExecution.revocationEpoch = currentEpoch + 1
          nextExecution.pendingBudgetCard = null
          nextExecution.currentLease = null
          nextExecution.runnerState = null
          if (currentExecution.continuationAuthorization?.schemaVersion === CONTINUATION_AUTHORIZATION_SCHEMA &&
              ['prepared', 'leased'].includes(currentExecution.continuationAuthorization.status)) {
            nextExecution.continuationAuthorization = transitionValidationContinuation(
              currentExecution.continuationAuthorization,
              'revoked'
            )
          }
        } else {
          throw evidenceBindingError('VALIDATION_EVIDENCE_KIND_INVALID', `unsupported validation control state kind: ${kind}`)
        }
        return { ...state, validationExecution: nextExecution }
      }, { nowMs, force: true })
      if (!acceptedPrimaryStatus(commit.status)) {
        return { ...commit, stateOwner: 'task-recovery-v5', kind }
      }
      const readback = readTask()
      if (readback.status !== 'fresh') {
        return {
          status: 'error',
          errorCode: 'VALIDATION_CONTINUATION_PERSISTENCE_FAILED',
          write: commit,
          readback,
          stateOwner: 'task-recovery-v5',
          kind
        }
      }
      return { ...commit, readbackVerified: true, stateOwner: 'task-recovery-v5', kind }
    } catch (error) {
      return {
        status: 'error',
        errorCode: error.code || 'VALIDATION_CONTINUATION_PERSISTENCE_FAILED',
        message: error.message,
        details: error.details || null,
        stateOwner: 'task-recovery-v5',
        kind
      }
    }
  }

  function emergencyTerminal(projection, primary) {
    try {
      const closeout = writeEmergencyCloseout(storePaths(metaDir), {
        observedAt: projection.completedAt || new Date().toISOString(),
        status: projection.terminalStatus,
        reason: 'validation-closeout',
        identity: taskIdentity || { activeRoot, project, owner },
        validationTerminal: projection,
        primaryErrorCode: primary.errorCode || primary.status
      })
      return { ...closeout, stateOwner: 'task-recovery-closeout-reserve', primary }
    } catch (error) {
      return {
        status: 'error',
        errorCode: 'VALIDATION_TERMINAL_PERSISTENCE_FAILED',
        primary,
        closeoutErrorCode: error.code || 'LIFECYCLE_CLOSEOUT_WRITE_FAILED',
        message: error.message
      }
    }
  }

  function readReservedTerminal(runIdentityDigest) {
    try {
      const records = readEmergencyCloseouts(metaDir).records
        .filter(item => item.record?.reason === 'validation-closeout' &&
          item.record?.validationTerminal?.runIdentityDigest === runIdentityDigest)
      if (!records.length) return { status: 'missing', receipt: null, stateOwner: 'task-recovery-closeout-reserve' }
      const digests = new Set(records.map(item => item.record.validationTerminal.terminalDigest))
      if (digests.size > 1) {
        return { status: 'invalid', receipt: null, errorCode: 'VALIDATION_TERMINAL_CONFLICT', stateOwner: 'task-recovery-closeout-reserve' }
      }
      return {
        status: 'fresh',
        receipt: records[0].record.validationTerminal,
        sequence: records[0].sequence,
        stateOwner: 'task-recovery-closeout-reserve'
      }
    } catch (error) {
      return { status: 'error', receipt: null, errorCode: error.code || 'VALIDATION_CLOSEOUT_READ_FAILED', stateOwner: 'task-recovery-closeout-reserve' }
    }
  }

  function readTaskField(field, runIdentityDigest, valueKey) {
    const read = readTask()
    if (read.status !== 'fresh') {
      return { status: read.status, [valueKey]: null, errorCode: read.errorCode || null, stateOwner: 'task-recovery-v5' }
    }
    const value = read.state?.validationExecution?.[field] || null
    if (!value || (runIdentityDigest && value.runIdentityDigest !== runIdentityDigest)) {
      return { status: 'missing', [valueKey]: null, stateOwner: 'task-recovery-v5' }
    }
    return { status: 'fresh', [valueKey]: value, stateOwner: 'task-recovery-v5' }
  }

  function readTaskControl(field, valueKey) {
    if (!taskBound) {
      return {
        status: 'missing',
        [valueKey]: null,
        errorCode: 'VALIDATION_TASK_BOUND_STATE_REQUIRED',
        stateOwner: 'task-recovery-v5'
      }
    }
    const read = readTask()
    if (read.status !== 'fresh') {
      return { status: read.status, [valueKey]: null, errorCode: read.errorCode || null, stateOwner: 'task-recovery-v5' }
    }
    const value = read.state?.validationExecution?.[field] || null
    return value
      ? { status: 'fresh', [valueKey]: value, stateOwner: 'task-recovery-v5' }
      : { status: 'missing', [valueKey]: null, stateOwner: 'task-recovery-v5' }
  }

  function readLeaseInternal(runIdentityDigest = configuredRunIdentityDigest) {
    if (taskBound) return readTaskField('currentLease', runIdentityDigest, 'lease')
    if (DIGEST_RE.test(runIdentityDigest)) {
      const read = readRunShardPayload({ activeRoot, project, runIdentityDigest, kind: 'authority' })
      const { payload, ...projection } = read
      return { ...projection, lease: payload }
    }
    const slots = readFixedSlots(activeRoot, project, owner, 'authority')
    return slots.length
      ? { status: 'fresh', lease: slots[0].payload, sequence: slots[0].sequence, stateOwner: 'legacy-taskless-owner-ring' }
      : { status: 'missing', lease: null, stateOwner: 'taskless-run-fixed-shard' }
  }

  function readRunnerStateInternal(runIdentityDigest = configuredRunIdentityDigest) {
    if (!DIGEST_RE.test(runIdentityDigest)) {
      return { status: 'missing', runnerState: null, errorCode: 'VALIDATION_RUN_IDENTITY_REQUIRED', stateOwner: taskBound ? 'task-recovery-v5' : 'taskless-run-fixed-shard' }
    }
    if (taskBound) return readTaskField('runnerState', runIdentityDigest, 'runnerState')
    const read = readRunShardPayload({ activeRoot, project, runIdentityDigest, kind: 'runner' })
    const { payload, ...projection } = read
    return { ...projection, runnerState: payload }
  }

  function readTerminalInternal(runIdentityDigest = configuredRunIdentityDigest) {
    let primary
    if (DIGEST_RE.test(runIdentityDigest)) {
      if (taskBound) primary = readTaskField('terminalReceipt', runIdentityDigest, 'receipt')
      else {
        const read = readRunShardPayload({ activeRoot, project, runIdentityDigest, kind: 'terminal' })
        const { payload, ...projection } = read
        primary = { ...projection, receipt: payload }
      }
      const reserved = readReservedTerminal(runIdentityDigest)
      if (primary.status === 'fresh' && reserved.status === 'fresh' &&
          primary.receipt.terminalDigest !== reserved.receipt.terminalDigest) {
        return { status: 'invalid', receipt: null, errorCode: 'VALIDATION_TERMINAL_CONFLICT', stateOwner: 'terminal-cas' }
      }
      if (primary.status === 'fresh') return { ...primary, replicaState: reserved.status === 'fresh' ? 'primary+reserve' : 'primary' }
      if (reserved.status === 'fresh') return { ...reserved, replicaState: 'reserve-only' }
      if (primary.status === 'invalid' || reserved.status === 'invalid') {
        return { status: 'invalid', receipt: null, errorCode: 'VALIDATION_TERMINAL_CONFLICT', stateOwner: 'terminal-cas' }
      }
      return primary
    }
    if (taskBound) return readTaskField('terminalReceipt', '', 'receipt')
    const latest = readLatestTasklessTerminal({ activeRoot, project, actorType })
    if (latest.status === 'fresh') return latest
    const legacy = readFixedSlots(activeRoot, project, owner, 'receipt')
    return legacy.length
      ? { status: 'fresh', receipt: legacy[0].payload, sequence: legacy[0].sequence, stateOwner: 'legacy-taskless-owner-ring' }
      : latest
  }

  function primaryWrite(kind, payload, runIdentityDigest, nowMs) {
    try {
      if (kind === 'terminal' && remainingPrimaryTerminalFailures > 0) {
        remainingPrimaryTerminalFailures -= 1
        return { status: 'error', errorCode: 'VALIDATION_TEST_PRIMARY_TERMINAL_WRITE_FAILED' }
      }
      return taskBound
        ? updateTask(kind, payload, nowMs)
        : writeRunShardPayload({ activeRoot, project, runIdentityDigest, kind, payload, nowMs })
    } catch (error) {
      return { status: 'error', errorCode: error.code || 'VALIDATION_EVIDENCE_WRITE_FAILED', message: error.message }
    }
  }

  return Object.freeze({
    stateOwner: taskBound ? 'task-recovery-v5' : 'taskless-run-fixed-shard',
    runIdentityDigest: configuredRunIdentityDigest || null,
    readLease: readLeaseInternal,
    readPendingBudgetCard() {
      return readTaskControl('pendingBudgetCard', 'pendingBudgetCard')
    },
    readRootBudgetConfirmation() {
      return readTaskControl('rootBudgetConfirmation', 'rootBudgetConfirmation')
    },
    readRootBudgetProjection() {
      return readTaskControl('rootBudgetProjection', 'rootBudgetProjection')
    },
    readContinuationAuthorization() {
      return readTaskControl('continuationAuthorization', 'continuationAuthorization')
    },
    readRunnerState: readRunnerStateInternal,
    readTerminal: readTerminalInternal,
    writePendingBudgetCard(binding, writeOptions = {}) {
      if (binding?.schemaVersion !== PENDING_BUDGET_SCHEMA) {
        return { status: 'error', errorCode: 'VALIDATION_PENDING_BUDGET_STALE', stateOwner: 'task-recovery-v5' }
      }
      return updateTaskControl('pending', binding, writeOptions)
    },
    writeRootBudgetConfirmation(receipt, writeOptions = {}) {
      if (receipt?.schemaVersion !== BUDGET_CONFIRMATION_SCHEMA) {
        return { status: 'error', errorCode: 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT', stateOwner: 'task-recovery-v5' }
      }
      return updateTaskControl('root-confirmation', receipt, writeOptions)
    },
    writeContinuationAuthorization(authorization, writeOptions = {}) {
      if (authorization?.schemaVersion !== CONTINUATION_AUTHORIZATION_SCHEMA) {
        return { status: 'error', errorCode: 'VALIDATION_CONTINUATION_PERSISTENCE_FAILED', stateOwner: 'task-recovery-v5' }
      }
      return updateTaskControl('continuation', authorization, writeOptions)
    },
    revokeValidationExecution(writeOptions = {}) {
      return updateTaskControl('revoke', null, writeOptions)
    },
    writeLease(lease, writeOptions = {}) {
      const runIdentityDigest = String(lease?.runIdentityDigest || configuredRunIdentityDigest)
      if (!DIGEST_RE.test(runIdentityDigest)) return { status: 'error', errorCode: 'VALIDATION_RUN_IDENTITY_REQUIRED' }
      return primaryWrite('authority', lease, runIdentityDigest, writeOptions.nowMs)
    },
    writeRunnerState(runnerState, writeOptions = {}) {
      const runIdentityDigest = String(runnerState?.runIdentityDigest || configuredRunIdentityDigest)
      if (!DIGEST_RE.test(runIdentityDigest)) return { status: 'error', errorCode: 'VALIDATION_RUN_IDENTITY_REQUIRED' }
      return primaryWrite('runner', runnerState, runIdentityDigest, writeOptions.nowMs)
    },
    writeTerminal(receipt, writeOptions = {}) {
      const projection = buildTerminalProjection(receipt)
      const runIdentityDigest = String(projection.runIdentityDigest || configuredRunIdentityDigest)
      if (!DIGEST_RE.test(runIdentityDigest)) return { status: 'error', errorCode: 'VALIDATION_RUN_IDENTITY_REQUIRED' }
      const existing = readTerminalInternal(runIdentityDigest)
      if (existing.status === 'fresh') {
        if (existing.receipt.terminalDigest !== projection.terminalDigest) {
          return { status: 'error', errorCode: 'VALIDATION_TERMINAL_CONFLICT', stateOwner: existing.stateOwner }
        }
        if (existing.replicaState === 'reserve-only' || existing.stateOwner === 'task-recovery-closeout-reserve') {
          const promoted = primaryWrite('terminal', projection, runIdentityDigest, writeOptions.nowMs)
          return acceptedPrimaryStatus(promoted.status)
            ? { ...promoted, terminalDigest: projection.terminalDigest, reconciliation: 'reserve-to-primary' }
            : { ...existing, status: 'closeout-reserved', terminalDigest: projection.terminalDigest, retry: promoted }
        }
        return { status: 'semantic-noop', stateOwner: existing.stateOwner, terminalDigest: projection.terminalDigest }
      }
      const primary = primaryWrite('terminal', projection, runIdentityDigest, writeOptions.nowMs)
      if (['committed', 'semantic-noop', 'persisted'].includes(primary.status)) {
        return { ...primary, terminalDigest: projection.terminalDigest }
      }
      const reserve = emergencyTerminal(projection, primary)
      if (reserve.status !== 'closeout-reserved') return reserve
      const reconciled = primaryWrite('terminal', projection, runIdentityDigest, writeOptions.nowMs)
      if (['committed', 'semantic-noop', 'persisted'].includes(reconciled.status)) {
        return { ...reconciled, terminalDigest: projection.terminalDigest, reconciliation: 'reserve-to-primary', reserve }
      }
      return { ...reserve, terminalDigest: projection.terminalDigest, reconciliation: 'reserve-pending', retry: reconciled }
    },
    buildTerminalProjection
  })
}

module.exports = {
  FIXED_SLOT_SCHEMA,
  OWNER_STATE_SCHEMA,
  RECEIPT_RING_SIZE,
  RUN_SHARD_SLOT_SCHEMA,
  RUN_SHARD_WRITER_SCHEMA,
  TASKLESS_RUN_SHARD_COUNT,
  TASKLESS_RUN_SLOT_COUNT,
  TASK_STATE_SCHEMA,
  TERMINAL_LINEAGE_SCHEMA,
  TERMINAL_PROJECTION_SCHEMA,
  TERMINAL_UNSUPPORTED_VALUE_SCHEMA,
  buildTerminalProjection,
  createValidationEvidenceStore,
  readFixedSlots,
  readLatestTasklessTerminal,
  readRunShardPayload,
  readRunShardSlots,
  normalizeTerminalEvidenceValue,
  runShardIndex,
  writeRunShardPayload,
  writeFixedSlot
}
