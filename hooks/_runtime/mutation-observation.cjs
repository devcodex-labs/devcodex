'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { sha256, stableStringify } = require('./content-identity.cjs')

const LEASE_SCHEMA = 'TaskOwnedMutationLeaseV2'
const PRE_OBSERVATION_SCHEMA = 'MutationPreObservationV1'
const FOOTPRINT_PROJECTION_SCHEMA = 'MutationFootprintRecoveryProjectionV2'
const OBSERVATION_SCHEMA = 'MutationObservationReceiptV1'
const CLOSEOUT_SCHEMA = 'ArtifactMutationCloseoutReceiptV2'
const DIGEST_RE = /^[a-f0-9]{64}$/
const MAX_OBSERVATION_ENTRIES = 24
const MAX_HASH_BYTES = 64 * 1024 * 1024
const MAX_PATH_BYTES = 1024
const DEFAULT_LEASE_MS = 5 * 60 * 1000

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function comparable(value) {
  const normalized = path.normalize(String(value || ''))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isLogical(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(value || '')) && !/^[a-z]:[\\/]/i.test(String(value || ''))
}

function insideOrSame(child, parent) {
  const candidate = comparable(child)
  const root = comparable(parent)
  return candidate === root || candidate.startsWith(root + path.sep)
}

function hashFileBounded(file, fsImpl = fs) {
  const stat = fsImpl.statSync(file)
  if (!stat.isFile()) return { digest: null, bytes: stat.size, complete: true }
  if (stat.size > MAX_HASH_BYTES) return { digest: null, bytes: stat.size, complete: false, errorCode: 'mutation-observation-file-too-large' }
  const descriptor = fsImpl.openSync(file, 'r')
  const hasher = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let offset = 0
    while (offset < stat.size) {
      const read = fsImpl.readSync(descriptor, buffer, 0, Math.min(buffer.length, stat.size - offset), offset)
      if (!read) break
      hasher.update(buffer.subarray(0, read))
      offset += read
    }
    if (offset !== stat.size) return { digest: null, bytes: stat.size, complete: false, errorCode: 'mutation-observation-short-read' }
    return { digest: hasher.digest('hex'), bytes: stat.size, complete: true }
  } finally {
    fsImpl.closeSync(descriptor)
  }
}

function findReceiptDigest(value, state = { seen: new Set(), nodes: 0 }) {
  if (!value || typeof value !== 'object' || state.seen.has(value) || state.nodes > 256) return null
  state.seen.add(value)
  state.nodes += 1
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:afterDigest|receiptDigest|targetAfterDigest|writeDigest|payloadDigest)$/i.test(key) && DIGEST_RE.test(String(item || ''))) {
      return String(item)
    }
  }
  for (const item of Object.values(value)) {
    const found = findReceiptDigest(item, state)
    if (found) return found
  }
  return null
}

function snapshotOne(target, options = {}) {
  const fsImpl = options.fs || fs
  if (Buffer.byteLength(String(target || ''), 'utf8') > MAX_PATH_BYTES) {
    return { path: String(target || '').slice(0, MAX_PATH_BYTES), exists: false, kind: 'invalid', digest: null, bytes: 0, complete: false, errorCode: 'mutation-observation-path-too-long' }
  }
  if (isLogical(target)) {
    const receiptDigest = options.phase === 'post' ? findReceiptDigest(options.toolResultPayload) : null
    return {
      path: String(target),
      exists: options.phase === 'post',
      kind: options.phase === 'post' ? 'logical' : 'missing',
      digest: receiptDigest,
      bytes: 0,
      complete: options.phase !== 'post' || !!receiptDigest,
      ...(options.phase === 'post' && !receiptDigest ? { errorCode: 'mutation-logical-receipt-missing' } : {})
    }
  }
  let stat
  try { stat = fsImpl.lstatSync(target) } catch (error) {
    if (error?.code === 'ENOENT') return { path: target, exists: false, kind: 'missing', digest: null, bytes: 0, complete: true }
    return { path: target, exists: false, kind: 'invalid', digest: null, bytes: 0, complete: false, errorCode: error.code || 'mutation-observation-stat-failed' }
  }
  if (stat.isSymbolicLink()) {
    return { path: target, exists: true, kind: 'reparse', digest: null, bytes: stat.size, complete: false, errorCode: 'mutation-observation-reparse-target' }
  }
  if (stat.isFile()) {
    try {
      const hashed = hashFileBounded(target, fsImpl)
      return { path: target, exists: true, kind: 'file', ...hashed }
    } catch (error) {
      return { path: target, exists: true, kind: 'file', digest: null, bytes: stat.size, complete: false, errorCode: error.code || 'mutation-observation-hash-failed' }
    }
  }
  if (stat.isDirectory()) return { path: target, exists: true, kind: 'directory', digest: null, bytes: 0, complete: true }
  return { path: target, exists: true, kind: 'other', digest: null, bytes: stat.size, complete: false, errorCode: 'mutation-observation-kind-unsupported' }
}

function walkControlledRoot(root, options, entries, errors, relative = '') {
  const fsImpl = options.fs || fs
  if (entries.length >= MAX_OBSERVATION_ENTRIES) {
    errors.add('mutation-observation-entry-limit-exceeded')
    return
  }
  let children
  try { children = fsImpl.readdirSync(root, { withFileTypes: true }) } catch (error) {
    errors.add(error.code || 'mutation-observation-root-read-failed')
    return
  }
  children.sort((left, right) => left.name.localeCompare(right.name))
  for (const child of children) {
    if (entries.length >= MAX_OBSERVATION_ENTRIES) {
      errors.add('mutation-observation-entry-limit-exceeded')
      break
    }
    const childRelative = relative ? `${relative}/${child.name}` : child.name
    const target = path.join(root, ...childRelative.split('/'))
    const entry = snapshotOne(target, options)
    entries.push(entry)
    if (!entry.complete && entry.errorCode) errors.add(entry.errorCode)
    if (child.isDirectory() && !child.isSymbolicLink()) walkControlledRoot(root, options, entries, errors, childRelative)
  }
}

function footprintTargets(footprint) {
  return [...new Set([
    ...(footprint?.plannedCreates || []),
    ...(footprint?.plannedModifies || []),
    ...(footprint?.plannedDeletes || []),
    ...(footprint?.plannedMoves || []).flatMap(item => [item?.source, item?.target]),
    ...(footprint?.sourceTargets || []),
    ...(footprint?.targetTargets || [])
  ].filter(Boolean))].sort()
}

function snapshotMutationTargets(footprint, options = {}) {
  const errors = new Set()
  const entries = []
  const targetGranularity = footprint?.observationPlan?.targetGranularity || 'exact-target'
  for (const target of footprintTargets(footprint)) {
    if (entries.length >= MAX_OBSERVATION_ENTRIES) {
      errors.add('mutation-observation-entry-limit-exceeded')
      break
    }
    const entry = snapshotOne(target, options)
    entries.push(entry)
    if (!entry.complete && entry.errorCode) errors.add(entry.errorCode)
    if (targetGranularity === 'controlled-root' && entry.exists && entry.kind === 'directory') {
      walkControlledRoot(target, options, entries, errors)
    }
  }
  const sorted = entries
    .filter((entry, index, all) => all.findIndex(other => comparable(other.path) === comparable(entry.path)) === index)
    .sort((left, right) => comparable(left.path).localeCompare(comparable(right.path)))
  const semantic = {
    entries: sorted,
    coverage: errors.size ? (sorted.length ? 'partial' : 'unavailable') : 'complete',
    errorCodes: [...errors].sort()
  }
  return Object.freeze({ ...semantic, snapshotDigest: digest(semantic) })
}

function projectMutationFootprintForRecovery(footprint) {
  const semantic = {
    schemaVersion: FOOTPRINT_PROJECTION_SCHEMA,
    sourceSchemaVersion: footprint?.schemaVersion || null,
    footprintDigest: footprint?.footprintDigest || null,
    adapterId: footprint?.adapterId || null,
    adapterDigest: footprint?.adapterDigest || null,
    operationClass: footprint?.operationClass || null,
    operation: footprint?.operation || null,
    plannedCreates: (footprint?.plannedCreates || []).slice(0, MAX_OBSERVATION_ENTRIES),
    plannedModifies: (footprint?.plannedModifies || []).slice(0, MAX_OBSERVATION_ENTRIES),
    plannedDeletes: (footprint?.plannedDeletes || []).slice(0, MAX_OBSERVATION_ENTRIES),
    plannedMoves: (footprint?.plannedMoves || []).slice(0, MAX_OBSERVATION_ENTRIES).map(item => ({ source: item.source, target: item.target })),
    sourceTargets: (footprint?.sourceTargets || []).slice(0, MAX_OBSERVATION_ENTRIES),
    targetTargets: (footprint?.targetTargets || []).slice(0, MAX_OBSERVATION_ENTRIES),
    normalizedTargets: (footprint?.normalizedTargets || []).slice(0, MAX_OBSERVATION_ENTRIES),
    plannedSetDigest: footprint?.plannedSetDigest || null,
    observationPlan: footprint?.observationPlan || null,
    coverage: footprint?.coverage || null
  }
  return Object.freeze({ ...semantic, projectionDigest: digest(semantic) })
}

function createMutationPreObservation(input = {}, options = {}) {
  const footprint = input.footprint
  const snapshot = snapshotMutationTargets(footprint, { ...options, phase: 'pre' })
  const errors = [...snapshot.errorCodes]
  if (footprint?.coverage !== 'complete') errors.push('mutation-footprint-coverage-incomplete')
  if (!footprintTargets(footprint).length) errors.push('mutation-target-set-empty')
  const semantic = {
    schemaVersion: PRE_OBSERVATION_SCHEMA,
    operationId: String(input.operationId || ''),
    footprintDigest: footprint?.footprintDigest || null,
    plannedSetDigest: footprint?.plannedSetDigest || null,
    entries: snapshot.entries,
    observationCoverage: errors.length ? (snapshot.entries.length ? 'partial' : 'unavailable') : 'complete',
    errorCodes: [...new Set(errors)].sort(),
    snapshotDigest: snapshot.snapshotDigest,
    observedAt: new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString()
  }
  return Object.freeze({ ...semantic, receiptDigest: digest(semantic) })
}

function createTaskOwnedMutationLease(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(1000, Math.min(options.ttlMs, DEFAULT_LEASE_MS)) : DEFAULT_LEASE_MS
  const decision = input.decision || {}
  const owner = input.owner || {}
  const workflowOperationalLeaseDigest = String(input.workflowOperationalLeaseDigest || '')
  const ownerLeaseDigest = String(owner.leaseDigest || input.simpleTaskLeaseDigest || workflowOperationalLeaseDigest || '')
  const ownerKind = owner.leaseDigest
    ? 'fenced-task-owner'
    : (input.simpleTaskLeaseDigest
        ? 'simple-task-fast-path'
        : (workflowOperationalLeaseDigest ? 'workflow-operational' : 'missing'))
  const semantic = {
    schemaVersion: LEASE_SCHEMA,
    operationId: String(input.operationId || ''),
    project: String(input.project || decision.project || ''),
    taskId: String(input.taskId || decision.taskRecoveryKey || ''),
    ownerKind,
    ownerGeneration: Number.isInteger(owner.ownerGeneration) ? owner.ownerGeneration : null,
    ownerLeaseDigest: ownerLeaseDigest || null,
    contextEpoch: String(input.contextEpoch || decision.contextEpoch || ''),
    routeRevision: String(input.routeRevision || ''),
    adapterDigest: String(decision.adapterDigest || ''),
    mergedRegistryDigest: String(decision.mergedRegistryDigest || ''),
    slotDecisionDigest: String(decision.decisionDigest || ''),
    plannedSetDigest: String(decision.plannedSetDigest || ''),
    nonce: digest({ operationId: input.operationId, ownerLeaseDigest, decisionDigest: decision.decisionDigest, contextEpoch: input.contextEpoch, routeRevision: input.routeRevision }),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    singleUse: true,
    status: 'active'
  }
  return Object.freeze({ ...semantic, leaseDigest: digest(semantic) })
}

function validateTaskOwnedMutationLease(value, binding = null, options = {}) {
  const errors = []
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (value?.schemaVersion !== LEASE_SCHEMA) errors.push('task-mutation-lease-schema-invalid')
  if (!value?.operationId || !value?.project || !value?.contextEpoch || !value?.routeRevision) errors.push('task-mutation-lease-identity-incomplete')
  for (const field of ['ownerLeaseDigest', 'adapterDigest', 'mergedRegistryDigest', 'slotDecisionDigest', 'plannedSetDigest', 'nonce']) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`task-mutation-lease-${field}-invalid`)
  }
  if (!['fenced-task-owner', 'simple-task-fast-path', 'workflow-operational'].includes(value?.ownerKind)) {
    errors.push('task-mutation-owner-missing')
  }
  if (value?.singleUse !== true || value?.status !== 'active') errors.push('task-mutation-lease-not-active')
  if (!Number.isFinite(Date.parse(String(value?.expiresAt || ''))) || Date.parse(value.expiresAt) <= nowMs) errors.push('task-mutation-lease-expired')
  const { leaseDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(leaseDigest || '')) || digest(semantic) !== leaseDigest) errors.push('task-mutation-lease-digest-invalid')
  if (binding) {
    for (const field of ['operationId', 'project', 'taskId', 'contextEpoch', 'routeRevision', 'adapterDigest', 'mergedRegistryDigest', 'slotDecisionDigest', 'plannedSetDigest']) {
      if ((value?.[field] ?? null) !== (binding[field] ?? null)) errors.push(`task-mutation-lease-mismatch:${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function entryMap(entries) {
  return new Map((entries || []).map(entry => [comparable(entry.path), entry]))
}

function effectPathAllowed(target, planned, controlledRoots) {
  const key = comparable(target)
  if (planned.has(key)) return true
  return controlledRoots.some(root => !isLogical(target) && insideOrSame(target, root))
}

function nativeExitCode(payload) {
  for (const value of [payload?.exitCode, payload?.exit_code, payload?.tool_response?.exitCode, payload?.toolResponse?.exitCode, payload?.result?.exitCode]) {
    if (Number.isInteger(value)) return value
  }
  return null
}

function observeMutationEffects(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const footprint = input.footprint || {}
  const decision = input.decision || {}
  const lease = input.lease || {}
  const pre = input.preObservation || {}
  const post = snapshotMutationTargets(footprint, {
    ...options,
    phase: 'post',
    toolResultPayload: input.payload
  })
  const before = entryMap(pre.entries)
  const after = entryMap(post.entries)
  const created = []
  const modified = []
  const deleted = []
  for (const key of [...new Set([...before.keys(), ...after.keys()])]) {
    const left = before.get(key) || { path: after.get(key)?.path, exists: false, kind: 'missing', digest: null }
    const right = after.get(key) || { path: left.path, exists: false, kind: 'missing', digest: null }
    if (!left.exists && right.exists) created.push(right.path)
    else if (left.exists && !right.exists) deleted.push(left.path)
    else if (left.exists && right.exists && (left.digest !== right.digest || left.kind !== right.kind || left.bytes !== right.bytes)) modified.push(right.path)
  }
  const moves = []
  for (const plannedMove of footprint.plannedMoves || []) {
    const sourceBefore = before.get(comparable(plannedMove.source))
    const sourceAfter = after.get(comparable(plannedMove.source))
    const targetAfter = after.get(comparable(plannedMove.target))
    if (sourceBefore?.exists && sourceAfter?.exists === false && targetAfter?.exists &&
        (!sourceBefore.digest || !targetAfter.digest || sourceBefore.digest === targetAfter.digest)) {
      moves.push({ source: plannedMove.source, target: plannedMove.target })
    }
  }
  const plannedCreates = new Set((footprint.plannedCreates || []).map(comparable))
  const plannedModifies = new Set((footprint.plannedModifies || []).map(comparable))
  const plannedDeletes = new Set((footprint.plannedDeletes || []).map(comparable))
  const plannedMoveSources = new Set((footprint.plannedMoves || []).map(item => comparable(item.source)))
  const plannedMoveTargets = new Set((footprint.plannedMoves || []).map(item => comparable(item.target)))
  const allPlanned = new Set([...plannedCreates, ...plannedModifies, ...plannedDeletes, ...plannedMoveSources, ...plannedMoveTargets])
  const controlledRoots = footprint?.observationPlan?.targetGranularity === 'controlled-root'
    ? (footprint.normalizedTargets || []).filter(target => !isLogical(target))
    : []
  const errors = [...(post.errorCodes || [])]
  if (pre.observationCoverage !== 'complete') errors.push('mutation-pre-observation-incomplete')
  if (post.coverage !== 'complete') errors.push('mutation-post-observation-incomplete')
  const exitCode = nativeExitCode(input.payload)
  if (input.success === false || exitCode !== null && exitCode !== 0) errors.push('mutation-tool-reported-failure')
  for (const target of footprint.plannedCreates || []) if (!created.some(item => comparable(item) === comparable(target)) && !controlledRoots.some(root => insideOrSame(target, root) && created.length)) errors.push(`planned-create-missing:${target}`)
  for (const target of footprint.plannedModifies || []) if (!modified.some(item => comparable(item) === comparable(target)) && !controlledRoots.some(root => insideOrSame(target, root) && modified.length)) errors.push(`planned-modify-missing:${target}`)
  for (const target of footprint.plannedDeletes || []) if (!deleted.some(item => comparable(item) === comparable(target))) errors.push(`planned-delete-missing:${target}`)
  for (const item of footprint.plannedMoves || []) if (!moves.some(move => comparable(move.source) === comparable(item.source) && comparable(move.target) === comparable(item.target))) errors.push(`planned-move-missing:${item.source}->${item.target}`)
  for (const target of [...created, ...modified, ...deleted]) {
    if (!effectPathAllowed(target, allPlanned, controlledRoots)) errors.push(`unplanned-effect:${target}`)
  }
  const observedEffects = {
    created: [...new Set(created)].sort(),
    modified: [...new Set(modified)].sort(),
    deleted: [...new Set(deleted)].sort(),
    moved: moves
  }
  const drift = [...new Set(errors)].sort()
  const status = drift.length ? 'needs-reconcile' : 'consumed'
  const semantic = {
    schemaVersion: OBSERVATION_SCHEMA,
    operationId: String(input.operationId || lease.operationId || ''),
    decisionDigest: decision.decisionDigest || null,
    leaseDigest: lease.leaseDigest || null,
    plannedSetDigest: footprint.plannedSetDigest || decision.plannedSetDigest || null,
    observedEffects,
    observationCoverage: drift.some(code => /observation|receipt-missing|too-large|entry-limit/.test(code)) ? 'partial' : 'complete',
    nativeExitCode: exitCode,
    drift,
    reconcileRequired: status !== 'consumed',
    status,
    completedAt: new Date(nowMs).toISOString()
  }
  const receipt = Object.freeze({ ...semantic, receiptDigest: digest(semantic) })
  const closeoutSemantic = {
    schemaVersion: CLOSEOUT_SCHEMA,
    operationId: receipt.operationId,
    decisionDigest: receipt.decisionDigest,
    leaseDigest: receipt.leaseDigest,
    observationReceiptDigest: receipt.receiptDigest,
    decisionStatus: receipt.status,
    reconcileRequired: receipt.reconcileRequired,
    completedAt: receipt.completedAt
  }
  return Object.freeze({
    ...receipt,
    decisionStatus: receipt.status,
    closeout: Object.freeze({ ...closeoutSemantic, closeoutDigest: digest(closeoutSemantic) })
  })
}

function validateMutationObservationReceipt(value) {
  const errors = []
  if (value?.schemaVersion !== OBSERVATION_SCHEMA) errors.push('mutation-observation-schema-invalid')
  for (const field of ['decisionDigest', 'leaseDigest', 'plannedSetDigest']) if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`mutation-observation-${field}-invalid`)
  if (!['consumed', 'needs-reconcile'].includes(value?.status)) errors.push('mutation-observation-status-invalid')
  if (!['complete', 'partial', 'unavailable'].includes(value?.observationCoverage)) errors.push('mutation-observation-coverage-invalid')
  if (!value?.observedEffects || !Array.isArray(value?.drift)) errors.push('mutation-observation-effects-invalid')
  const { receiptDigest, decisionStatus, closeout, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(receiptDigest || '')) || digest(semantic) !== receiptDigest) errors.push('mutation-observation-digest-invalid')
  return { valid: errors.length === 0, errors }
}

module.exports = {
  ARTIFACT_MUTATION_CLOSEOUT_SCHEMA: CLOSEOUT_SCHEMA,
  MAX_HASH_BYTES,
  MAX_OBSERVATION_ENTRIES,
  MUTATION_FOOTPRINT_RECOVERY_PROJECTION_SCHEMA: FOOTPRINT_PROJECTION_SCHEMA,
  MUTATION_OBSERVATION_SCHEMA: OBSERVATION_SCHEMA,
  MUTATION_PRE_OBSERVATION_SCHEMA: PRE_OBSERVATION_SCHEMA,
  TASK_OWNED_MUTATION_LEASE_SCHEMA: LEASE_SCHEMA,
  createMutationPreObservation,
  createTaskOwnedMutationLease,
  observeMutationEffects,
  projectMutationFootprintForRecovery,
  snapshotMutationTargets,
  validateMutationObservationReceipt,
  validateTaskOwnedMutationLease
}
