'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { sha256, stableStringify } = require('./content-identity.cjs')
const {
  findArtifactTemplateQualification,
  qualifyArtifactFile,
  validateArtifactTemplateBinding,
  validateArtifactTemplateBindingProjection,
  validateArtifactTemplateQualification
} = require('./artifact-template-contract.cjs')

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

function statIdentity(stat) {
  return {
    dev: String(stat?.dev),
    ino: String(stat?.ino),
    size: Number(stat?.size),
    mtimeMs: Number(stat?.mtimeMs),
    ctimeMs: Number(stat?.ctimeMs)
  }
}

function sameStatIdentity(left, right) {
  const a = statIdentity(left)
  const b = statIdentity(right)
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}

function realpathExisting(fsImpl, target) {
  const resolved = typeof fsImpl.realpathSync?.native === 'function'
    ? fsImpl.realpathSync.native(target)
    : fsImpl.realpathSync(target)
  return path.resolve(resolved)
}

function hashFileBounded(file, fsImpl = fs) {
  const initialPath = fsImpl.lstatSync(file)
  if (initialPath.isSymbolicLink()) {
    return { digest: null, bytes: initialPath.size, complete: false, errorCode: 'mutation-observation-reparse-target' }
  }
  if (!initialPath.isFile()) return { digest: null, bytes: initialPath.size, complete: true }
  if (initialPath.size > MAX_HASH_BYTES) return { digest: null, bytes: initialPath.size, complete: false, errorCode: 'mutation-observation-file-too-large' }
  const descriptor = fsImpl.openSync(file, 'r')
  const hasher = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    const before = fsImpl.fstatSync(descriptor)
    if (!before.isFile() || !sameStatIdentity(initialPath, before)) {
      return { digest: null, bytes: Number(before.size || 0), complete: false, errorCode: 'mutation-observation-file-drift' }
    }
    let offset = 0
    while (offset < before.size) {
      const read = fsImpl.readSync(descriptor, buffer, 0, Math.min(buffer.length, before.size - offset), offset)
      if (!read) break
      hasher.update(buffer.subarray(0, read))
      offset += read
    }
    const after = fsImpl.fstatSync(descriptor)
    const currentPath = fsImpl.lstatSync(file)
    if (!currentPath.isFile() || currentPath.isSymbolicLink() ||
        !sameStatIdentity(before, after) || !sameStatIdentity(after, currentPath)) {
      return { digest: null, bytes: Number(after.size || 0), complete: false, errorCode: 'mutation-observation-file-drift' }
    }
    if (offset !== before.size) return { digest: null, bytes: before.size, complete: false, errorCode: 'mutation-observation-short-read' }
    return { digest: hasher.digest('hex'), bytes: before.size, complete: true }
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

function walkControlledRoot(root, options, entries, errors, relative = '', boundary = null) {
  const fsImpl = options.fs || fs
  if (entries.length >= MAX_OBSERVATION_ENTRIES) {
    errors.add('mutation-observation-entry-limit-exceeded')
    return
  }
  const logicalRoot = path.resolve(root)
  const currentRoot = relative
    ? path.join(logicalRoot, ...relative.split('/'))
    : logicalRoot
  if (!insideOrSame(currentRoot, logicalRoot)) {
    errors.add('mutation-observation-root-escape')
    return
  }
  let children
  let nextBoundary = boundary
  try {
    const before = fsImpl.lstatSync(currentRoot)
    if (!before.isDirectory() || before.isSymbolicLink()) {
      errors.add('mutation-observation-root-reparse-or-kind-invalid')
      return
    }
    const physicalBefore = realpathExisting(fsImpl, currentRoot)
    if (!nextBoundary) nextBoundary = { logicalRoot, physicalRoot: physicalBefore }
    if (!insideOrSame(physicalBefore, nextBoundary.physicalRoot)) {
      errors.add('mutation-observation-root-physical-escape')
      return
    }
    children = fsImpl.readdirSync(currentRoot, { withFileTypes: true })
    const after = fsImpl.lstatSync(currentRoot)
    const physicalAfter = realpathExisting(fsImpl, currentRoot)
    if (!after.isDirectory() || after.isSymbolicLink() || !sameStatIdentity(before, after) ||
        comparable(physicalBefore) !== comparable(physicalAfter) ||
        !insideOrSame(physicalAfter, nextBoundary.physicalRoot)) {
      errors.add('mutation-observation-root-drift')
      return
    }
  } catch (error) {
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
    const target = path.join(logicalRoot, ...childRelative.split('/'))
    const entry = snapshotOne(target, options)
    entries.push(entry)
    if (!entry.complete && entry.errorCode) errors.add(entry.errorCode)
    if (entry.kind === 'directory') walkControlledRoot(logicalRoot, options, entries, errors, childRelative, nextBoundary)
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

function validateMutationFootprintRecoveryProjection(value) {
  const errors = []
  if (value?.schemaVersion !== FOOTPRINT_PROJECTION_SCHEMA) errors.push('mutation-footprint-recovery-schema-invalid')
  if (!String(value?.sourceSchemaVersion || '').trim() || !String(value?.adapterId || '').trim() ||
      !['read', 'direct-write', 'shell', 'indirect-writer', 'destructive', 'service-lifecycle', 'unknown'].includes(value?.operationClass) ||
      !['create-or-update', 'update', 'delete', 'move', 'copy', 'unknown'].includes(value?.operation)) {
    errors.push('mutation-footprint-recovery-identity-invalid')
  }
  for (const field of ['footprintDigest', 'adapterDigest', 'plannedSetDigest']) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`mutation-footprint-recovery-${field}-invalid`)
  }
  const comparableArray = values => (Array.isArray(values) ? values : []).map(comparable)
  for (const field of ['plannedCreates', 'plannedModifies', 'plannedDeletes', 'sourceTargets', 'targetTargets', 'normalizedTargets']) {
    const entries = value?.[field]
    if (!Array.isArray(entries) || entries.length > MAX_OBSERVATION_ENTRIES || entries.some(item =>
      !String(item || '').trim() || Buffer.byteLength(String(item), 'utf8') > MAX_PATH_BYTES ||
      (!isLogical(item) && !path.isAbsolute(String(item)))) ||
      new Set(comparableArray(entries)).size !== entries.length) {
      errors.push(`mutation-footprint-recovery-${field}-invalid`)
    }
  }
  if (!Array.isArray(value?.plannedMoves) || value.plannedMoves.length > MAX_OBSERVATION_ENTRIES ||
      value.plannedMoves.some(item => !item || typeof item !== 'object' ||
        !String(item.source || '').trim() || !String(item.target || '').trim() ||
        Buffer.byteLength(String(item.source), 'utf8') > MAX_PATH_BYTES ||
        Buffer.byteLength(String(item.target), 'utf8') > MAX_PATH_BYTES ||
        (!isLogical(item.source) && !path.isAbsolute(String(item.source))) ||
        (!isLogical(item.target) && !path.isAbsolute(String(item.target)))) ||
      new Set((value?.plannedMoves || []).map(item => `${comparable(item?.source)}\u0000${comparable(item?.target)}`)).size !==
        (value?.plannedMoves || []).length) {
    errors.push('mutation-footprint-recovery-plannedMoves-invalid')
  }
  const expectedPlannedSetDigest = digest({
    creates: value?.plannedCreates || [],
    modifies: value?.plannedModifies || [],
    deletes: value?.plannedDeletes || [],
    moves: value?.plannedMoves || []
  })
  if (value?.plannedSetDigest !== expectedPlannedSetDigest ||
      value?.observationPlan?.plannedSetDigest !== expectedPlannedSetDigest) {
    errors.push('mutation-footprint-recovery-planned-set-digest-invalid')
  }
  const normalized = new Set(comparableArray(value?.normalizedTargets))
  const sourceAndTarget = new Set(comparableArray([...(value?.sourceTargets || []), ...(value?.targetTargets || [])]))
  const plannedPaths = [
    ...(value?.plannedCreates || []),
    ...(value?.plannedModifies || []),
    ...(value?.plannedDeletes || []),
    ...(value?.plannedMoves || []).flatMap(item => [item?.source, item?.target])
  ].map(comparable)
  if (normalized.size !== sourceAndTarget.size || [...normalized].some(target => !sourceAndTarget.has(target)) ||
      plannedPaths.some(target => !normalized.has(target))) {
    errors.push('mutation-footprint-recovery-target-binding-invalid')
  }
  if (value?.coverage !== 'complete' || !value?.observationPlan || typeof value.observationPlan !== 'object' ||
      !['exact-target', 'controlled-root'].includes(value?.observationPlan?.targetGranularity)) {
    errors.push('mutation-footprint-recovery-coverage-invalid')
  }
  const { projectionDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(projectionDigest || '')) || digest(semantic) !== projectionDigest) {
    errors.push('mutation-footprint-recovery-digest-invalid')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
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

function validateMutationPreObservation(value, binding = null) {
  const errors = []
  if (value?.schemaVersion !== PRE_OBSERVATION_SCHEMA || !String(value?.operationId || '').trim() ||
      Buffer.byteLength(String(value?.operationId || ''), 'utf8') > 256) {
    errors.push('mutation-pre-observation-schema-or-operation-invalid')
  }
  for (const field of ['footprintDigest', 'plannedSetDigest', 'snapshotDigest']) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`mutation-pre-observation-${field}-invalid`)
  }
  if (!Array.isArray(value?.entries) || value.entries.length < 1 || value.entries.length > MAX_OBSERVATION_ENTRIES) {
    errors.push('mutation-pre-observation-entries-invalid')
  } else {
    const seenPaths = new Set()
    for (const entry of value.entries) {
      if (!entry || typeof entry !== 'object' || !String(entry.path || '').trim() ||
          Buffer.byteLength(String(entry.path), 'utf8') > MAX_PATH_BYTES ||
          typeof entry.exists !== 'boolean' || !['missing', 'file', 'directory', 'logical'].includes(entry.kind) ||
          !Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.complete !== true ||
          (entry.exists && !['file', 'directory'].includes(entry.kind)) ||
          (!entry.exists && entry.kind !== 'missing') ||
          (entry.exists && entry.kind === 'file' && !DIGEST_RE.test(String(entry.digest || ''))) ||
          (entry.exists && entry.kind === 'directory' && entry.digest !== null) ||
          (!entry.exists && entry.digest !== null)) {
        errors.push('mutation-pre-observation-entry-invalid')
      }
      const key = comparable(entry?.path)
      if (seenPaths.has(key)) errors.push('mutation-pre-observation-entry-duplicate')
      seenPaths.add(key)
    }
  }
  if (value?.observationCoverage !== 'complete' || !Array.isArray(value?.errorCodes) || value.errorCodes.length !== 0 ||
      !Number.isFinite(Date.parse(String(value?.observedAt || '')))) {
    errors.push('mutation-pre-observation-coverage-invalid')
  }
  const { receiptDigest, ...semantic } = value || {}
  const expectedSnapshotDigest = digest({ entries: value?.entries || [], coverage: 'complete', errorCodes: [] })
  if (value?.snapshotDigest !== expectedSnapshotDigest) errors.push('mutation-pre-observation-snapshot-digest-invalid')
  if (!DIGEST_RE.test(String(receiptDigest || '')) || digest(semantic) !== receiptDigest) {
    errors.push('mutation-pre-observation-digest-invalid')
  }
  if (binding) {
    for (const field of ['operationId', 'footprintDigest', 'plannedSetDigest']) {
      if (String(value?.[field] || '') !== String(binding[field] || '')) errors.push(`mutation-pre-observation-binding-${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
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

function observeTemplateQualifications(decision, payload, options = {}) {
  const qualifications = []
  const errors = []
  for (const binding of decision?.templateBindings || []) {
    const bindingValidation = binding?.schemaVersion === 'ArtifactTemplateBindingProjectionV1'
      ? validateArtifactTemplateBindingProjection(binding)
      : validateArtifactTemplateBinding(binding)
    if (!bindingValidation.valid) {
      errors.push(...bindingValidation.errors)
      continue
    }
    const logical = isLogical(binding.targetRef)
    const qualification = logical
      ? (findArtifactTemplateQualification(payload, binding.bindingDigest) || findArtifactTemplateQualification(payload))
      : qualifyArtifactFile(binding, binding.targetRef, { slotId: binding.slotId }, options)
    const qualificationValidation = validateArtifactTemplateQualification(qualification, logical ? null : binding)
    const logicalBindingMatch = !logical || ['slotId', 'targetRef', 'templateRef', 'templateDigest', 'contractDigest', 'requiredSemanticDigest']
      .every(field => String(qualification?.[field] || '') === String(binding?.[field] || ''))
    if (!qualificationValidation.valid || !logicalBindingMatch || qualification?.status !== 'qualified' || qualification?.readbackVerified !== true) {
      errors.push('artifact-template-qualification-rejected')
      if (!logicalBindingMatch) errors.push('artifact-template-logical-binding-mismatch')
      errors.push(...qualificationValidation.errors)
      errors.push(...(qualification?.errorCodes || []))
    }
    if (qualification) qualifications.push(qualification)
  }
  return { qualifications, errors: [...new Set(errors)] }
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
  const templateObservation = observeTemplateQualifications(decision, input.payload, options)
  errors.push(...templateObservation.errors)
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
    templateQualifications: templateObservation.qualifications,
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
  if (!String(value?.operationId || '').trim() || Buffer.byteLength(String(value?.operationId || ''), 'utf8') > 256) {
    errors.push('mutation-observation-operation-invalid')
  }
  for (const field of ['decisionDigest', 'leaseDigest', 'plannedSetDigest']) if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`mutation-observation-${field}-invalid`)
  if (!['consumed', 'needs-reconcile'].includes(value?.status)) errors.push('mutation-observation-status-invalid')
  if (!['complete', 'partial', 'unavailable'].includes(value?.observationCoverage)) errors.push('mutation-observation-coverage-invalid')
  const effects = value?.observedEffects
  if (!effects || typeof effects !== 'object' || Array.isArray(effects) ||
      !['created', 'modified', 'deleted', 'moved'].every(key => Array.isArray(effects[key]))) {
    errors.push('mutation-observation-effects-invalid')
  } else {
    const scalarPaths = [...effects.created, ...effects.modified, ...effects.deleted]
    const movePaths = []
    for (const item of effects.moved) {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          !String(item.source || '').trim() || !String(item.target || '').trim()) {
        errors.push('mutation-observation-move-invalid')
        continue
      }
      movePaths.push(item.source, item.target)
    }
    const allPaths = [...scalarPaths, ...movePaths]
    if (allPaths.some(item => !String(item || '').trim() || Buffer.byteLength(String(item), 'utf8') > MAX_PATH_BYTES)) {
      errors.push('mutation-observation-path-invalid')
    }
    if (new Set(allPaths.map(comparable)).size > MAX_OBSERVATION_ENTRIES ||
        [effects.created, effects.modified, effects.deleted, effects.moved].some(items => items.length > MAX_OBSERVATION_ENTRIES)) {
      errors.push('mutation-observation-effect-limit-exceeded')
    }
  }
  if (!Array.isArray(value?.drift) || value.drift.length > MAX_OBSERVATION_ENTRIES ||
      value.drift.some(item => !String(item || '').trim() || Buffer.byteLength(String(item), 'utf8') > MAX_PATH_BYTES)) {
    errors.push('mutation-observation-drift-invalid')
  }
  if (value?.templateQualifications !== undefined && (!Array.isArray(value.templateQualifications) || value.templateQualifications.length > MAX_OBSERVATION_ENTRIES)) {
    errors.push('mutation-observation-template-qualifications-invalid')
  } else {
    for (const qualification of value?.templateQualifications || []) {
      const validation = validateArtifactTemplateQualification(qualification)
      if (!validation.valid) errors.push(...validation.errors)
      if (value.status === 'consumed' && (qualification.status !== 'qualified' || qualification.readbackVerified !== true)) {
        errors.push('mutation-observation-template-qualification-not-final')
      }
    }
  }
  if (value?.reconcileRequired !== (value?.status === 'needs-reconcile')) {
    errors.push('mutation-observation-reconcile-status-mismatch')
  }
  const { receiptDigest, decisionStatus, closeout, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(receiptDigest || '')) || digest(semantic) !== receiptDigest) errors.push('mutation-observation-digest-invalid')
  return { valid: errors.length === 0, errors }
}

function validateArtifactMutationCloseoutReceipt(value, observation = null) {
  const errors = []
  if (value?.schemaVersion !== CLOSEOUT_SCHEMA) errors.push('artifact-mutation-closeout-schema-invalid')
  if (!String(value?.operationId || '').trim() || Buffer.byteLength(String(value?.operationId || ''), 'utf8') > 256) {
    errors.push('artifact-mutation-closeout-operation-invalid')
  }
  for (const field of ['decisionDigest', 'leaseDigest', 'observationReceiptDigest']) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`artifact-mutation-closeout-${field}-invalid`)
  }
  if (!['consumed', 'needs-reconcile'].includes(value?.decisionStatus)) errors.push('artifact-mutation-closeout-status-invalid')
  if (value?.reconcileRequired !== (value?.decisionStatus === 'needs-reconcile')) {
    errors.push('artifact-mutation-closeout-reconcile-status-mismatch')
  }
  if (!Number.isFinite(Date.parse(String(value?.completedAt || '')))) errors.push('artifact-mutation-closeout-time-invalid')
  const { closeoutDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(closeoutDigest || '')) || digest(semantic) !== closeoutDigest) {
    errors.push('artifact-mutation-closeout-digest-invalid')
  }
  if (observation) {
    if (value?.operationId !== observation.operationId || value?.decisionDigest !== observation.decisionDigest ||
        value?.leaseDigest !== observation.leaseDigest || value?.observationReceiptDigest !== observation.receiptDigest ||
        value?.decisionStatus !== observation.status || value?.reconcileRequired !== observation.reconcileRequired) {
      errors.push('artifact-mutation-closeout-observation-binding-invalid')
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
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
  validateArtifactMutationCloseoutReceipt,
  validateMutationFootprintRecoveryProjection,
  validateMutationObservationReceipt,
  validateMutationPreObservation,
  validateTaskOwnedMutationLease
}
