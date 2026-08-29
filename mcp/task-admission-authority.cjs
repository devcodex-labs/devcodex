'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  digest,
  validateActualInstructionEnvelope,
  validateWorkItemSet
} = require('../hooks/_runtime/actual-instruction-envelope.cjs')
const {
  validateWorkflowRouteDecision,
  verifyWorkflowRouteDecision
} = require('../hooks/_runtime/workflow-route-decision-v2.cjs')
const {
  evaluatePortableTaskIdentityBinding,
  validateTaskIdentity
} = require('../hooks/_runtime/task-continuation-contract.cjs')
const {
  commitFencedTaskWriteOwnerTransition,
  commitTaskAdmissionReconciliation,
  commitTaskAdmissionTransaction,
  admissionContinuationLeaseDigest,
  fencedTaskWriteOwnerDigest,
  readFencedTaskWriteOwner,
  readTaskAdmissionTransaction,
  reconcileEmergencyTaskCloseout,
  resolveTaskRecoveryMetaDir,
  taskAdmissionTransactionDigest,
  taskAdmissionReconciliationReceiptDigest,
  validateAdmissionContinuationLease,
  workflowTaskTerminalReceiptDigest
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const { digestValue } = require('../hooks/_runtime/lifecycle-state-projection-v5.cjs')
const { createMemoryFileTransaction, sha256 } = require('./memory-file-transaction.cjs')

const ADMISSION_POLICY_REVISION = 'TaskAdmissionPolicyV1@1'
const FORMAL_ADMISSION_RECEIPT_SCHEMA = 'FormalTaskAdmissionReceiptV2'
const TASK_DIRECTORY_DECISION_SCHEMA = 'TaskDirectoryNameDecisionV1'
const TASK_IDENTITY_V2_SCHEMA = 'TaskIdentityV2'
const PROJECT_TARGET_LEASE_SCHEMA = 'ProjectTargetLeaseV2'
const FENCED_TASK_WRITE_OWNER_SCHEMA = 'FencedTaskWriteOwnerLeaseV2'
const TASK_WRITE_OWNER_RECEIPT_SCHEMA = 'TaskWriteOwnerTransitionReceiptV1'
const WORKFLOW_TASK_TERMINAL_RECEIPT_SCHEMA = 'WorkflowTaskTerminalReceiptV1'
const TASK_ADMISSION_REQUEST_DIGEST_SCHEMA = 'TaskAdmissionRequestDigestV2'
const WRITE_OWNER_LEASE_MS = 30 * 60 * 1000
const ADMISSION_CONTINUATION_LEASE_MS = 30 * 60 * 1000
const DIGEST_RE = /^[a-f0-9]{64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TASK_KINDS = Object.freeze(['requirements', 'bugs', 'optimizations', 'scenario-tests'])
const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const MAX_OVERVIEW_BYTES = 256 * 1024
const MAX_TASK_SEGMENT_BYTES = 160

class TaskAdmissionError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'TaskAdmissionError'
    this.code = code
    this.details = details
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value || ''))
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function sameStableFileStat(left, right) {
  return String(left?.dev) === String(right?.dev) &&
    String(left?.ino) === String(right?.ino) &&
    Number(left?.size) === Number(right?.size) &&
    Number(left?.mtimeMs) === Number(right?.mtimeMs) &&
    Number(left?.ctimeMs) === Number(right?.ctimeMs)
}

function isInside(root, candidate, { allowEqual = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  if (!relative) return allowEqual
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function normalizeDisplayName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function normalizedNameKey(value) {
  return normalizeDisplayName(value).toLocaleLowerCase('en-US')
}

function normalizedAliases(values, displayName) {
  const displayKey = normalizedNameKey(displayName)
  const seen = new Set()
  const aliases = []
  for (const value of Array.isArray(values) ? values : []) {
    const alias = normalizeDisplayName(value)
    const key = normalizedNameKey(alias)
    if (!key || key === displayKey || seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
  }
  return aliases
}

function assertSafeTaskSegment(value) {
  const segment = normalizeDisplayName(value)
  if (!segment) throw new TaskAdmissionError('TASK_DIRECTORY_NAME_REQUIRED', 'task displayName is required')
  if (Buffer.byteLength(segment, 'utf8') > MAX_TASK_SEGMENT_BYTES) {
    throw new TaskAdmissionError('TASK_DIRECTORY_NAME_TOO_LONG', `task directory name exceeds ${MAX_TASK_SEGMENT_BYTES} UTF-8 bytes`)
  }
  if (/[\u0000-\u001f\u007f]/u.test(segment) || /[<>:"/\\|?*]/u.test(segment)) {
    throw new TaskAdmissionError('TASK_DIRECTORY_NAME_INVALID', 'task directory name contains a control or path-invalid character')
  }
  if (/[. ]$/u.test(segment) || segment === '.' || segment === '..' || RESERVED_WINDOWS_NAMES.test(segment)) {
    throw new TaskAdmissionError('TASK_DIRECTORY_NAME_RESERVED', 'task directory name is reserved or has an unsafe trailing character')
  }
  return segment
}

function assertTaskRootRelative(value, taskKind) {
  const portable = String(value || '').trim().replace(/\\/g, '/')
  const segments = portable.split('/')
  if (segments.length !== 2 || segments[0] !== taskKind || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new TaskAdmissionError(
      'TASK_ROOT_RELATIVE_INVALID',
      `taskRootRelative must be exactly ${taskKind}/<task-directory>`
    )
  }
  const canonicalSegment = assertSafeTaskSegment(segments[1])
  if (canonicalSegment !== segments[1]) {
    throw new TaskAdmissionError('TASK_ROOT_RELATIVE_NON_CANONICAL', 'taskRootRelative must already be NFKC-normalized and trimmed')
  }
  return portable
}

function deterministicTaskId(idempotencyKey) {
  const bytes = Buffer.from(sha256(`devcodex-task-admission-v1\0${idempotencyKey}`).slice(0, 32), 'hex')
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function projectTargetLeaseDigestCore(lease) {
  return {
    schemaVersion: PROJECT_TARGET_LEASE_SCHEMA,
    project: lease.project,
    targetDigest: lease.targetDigest,
    rootIdentityDigest: lease.rootIdentityDigest,
    layoutIdentity: lease.layoutIdentity,
    physicalRoot: normalizedPath(lease.physicalRoot),
    activeRoot: normalizedPath(lease.activeRoot),
    authorityKind: lease.authorityKind,
    authorityDigest: lease.authorityDigest,
    contextEpoch: lease.contextEpoch,
    contextBindingDigest: lease.contextBindingDigest,
    routeRevision: lease.routeRevision,
    revocationEpoch: lease.revocationEpoch,
    issuedAtMs: lease.issuedAtMs,
    expiresAtMs: lease.expiresAtMs
  }
}

function computeProjectTargetLeaseDigest(lease) {
  return crypto.createHash('sha256').update(JSON.stringify(projectTargetLeaseDigestCore(lease))).digest('hex')
}

function projectTargetAdmissionBindingCore(lease) {
  return {
    schemaVersion: 'ProjectTargetAdmissionBindingV1',
    project: lease.project,
    targetDigest: lease.targetDigest,
    rootIdentityDigest: lease.rootIdentityDigest,
    layoutIdentity: lease.layoutIdentity,
    physicalRoot: normalizedPath(lease.physicalRoot),
    activeRoot: normalizedPath(lease.activeRoot),
    authorityKind: lease.authorityKind,
    authorityDigest: lease.authorityDigest,
    routeRevision: lease.routeRevision
  }
}

function computeProjectTargetAdmissionBindingDigest(lease) {
  return digest(projectTargetAdmissionBindingCore(lease))
}

function legacyProjectTargetAdmissionBindingDigest(lease) {
  return digest({
    ...projectTargetAdmissionBindingCore(lease),
    contextEpoch: lease.contextEpoch
  })
}

function workflowRouteAdmissionBindingCore(decision) {
  return {
    schemaVersion: 'WorkflowRouteAdmissionBindingV1',
    decisionStatus: decision.decisionStatus,
    environmentMode: decision.environmentMode,
    topIntent: decision.topIntent,
    subtype: decision.subtype,
    routeKey: decision.routeKey,
    stage: decision.stage,
    routeRevision: decision.routeRevision,
    routeRegistryDigest: decision.routeRegistryDigest,
    routeOwner: decision.routeOwner,
    ownerSkillIds: decision.ownerSkillIds,
    mutationPolicy: decision.mutationPolicy,
    cpPolicy: decision.cpPolicy,
    artifactPolicy: decision.artifactPolicy,
    verificationPolicy: decision.verificationPolicy,
    resumePolicy: decision.resumePolicy,
    workItemDigest: decision.workItemDigest,
    provenanceLevel: decision.provenanceLevel,
    authorityScope: decision.authorityScope
  }
}

function computeWorkflowRouteAdmissionBindingDigest(decision) {
  return digest(workflowRouteAdmissionBindingCore(decision))
}

function validateProjectTargetLease(lease, binding = {}, options = {}) {
  const errors = []
  if (!lease || typeof lease !== 'object' || Array.isArray(lease)) {
    return { valid: false, errors: ['project-target-lease-required'] }
  }
  if (lease.schemaVersion !== PROJECT_TARGET_LEASE_SCHEMA) errors.push('schema-version')
  if (!String(lease.physicalRoot || '').trim() || !path.isAbsolute(String(lease.physicalRoot || ''))) errors.push('physical-root')
  if (!String(lease.activeRoot || '').trim() || !path.isAbsolute(String(lease.activeRoot || ''))) errors.push('active-root-absolute')
  for (const field of ['targetDigest', 'rootIdentityDigest', 'layoutIdentity', 'authorityDigest', 'contextBindingDigest', 'routeRevision']) {
    if (!DIGEST_RE.test(String(lease[field] || ''))) errors.push(field)
  }
  if (!['session', 'turn'].includes(lease.authorityKind)) errors.push('authority-kind')
  if (String(lease.project || '') !== String(binding.project || '')) errors.push('project')
  if (normalizedPath(lease.activeRoot || '.') !== normalizedPath(binding.activeRoot || '.')) errors.push('active-root')
  if (binding.physicalRoot && normalizedPath(lease.physicalRoot || '.') !== normalizedPath(binding.physicalRoot)) errors.push('physical-root-binding')
  if (binding.contextEpoch && lease.contextEpoch !== binding.contextEpoch) errors.push('context-epoch')
  if (binding.routeRevision && lease.routeRevision !== binding.routeRevision) errors.push('route-revision')
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (!Number.isSafeInteger(lease.issuedAtMs) || !Number.isSafeInteger(lease.expiresAtMs) ||
      lease.issuedAtMs > nowMs || lease.expiresAtMs <= nowMs || lease.expiresAtMs <= lease.issuedAtMs) errors.push('lease-time')
  if (!Number.isSafeInteger(lease.revocationEpoch) || lease.revocationEpoch < 0) errors.push('revocation-epoch')
  if (!DIGEST_RE.test(String(lease.leaseDigest || '')) || lease.leaseDigest !== computeProjectTargetLeaseDigest(lease)) {
    errors.push('lease-digest')
  }
  return { valid: errors.length === 0, errors }
}

function createIngressIdempotencyKey(input) {
  return digest({
    schemaVersion: 'IngressIdempotencyKeyV1',
    projectRootIdentity: input.projectRootIdentity,
    hostVariant: input.hostVariant,
    sessionDigest: input.sessionDigest,
    sourceEventId: input.sourceEventId,
    actualInstructionDigest: input.actualInstructionDigest,
    workItemDigest: input.workItemDigest,
    admissionPolicyRevision: input.admissionPolicyRevision || ADMISSION_POLICY_REVISION
  })
}

function overviewName(taskKind, entryVariant) {
  if (taskKind === 'bugs') return '00-问题概况.md'
  if (taskKind === 'requirements' && entryVariant === 'change') return '00-需求变更概况.md'
  return '00-需求概况.md'
}

function entryVariantAllowed(taskKind, entryVariant) {
  const variants = {
    requirements: ['new', 'product-provided', 'change', 'continue', 'reopen'],
    bugs: ['new', 'fix', 'continue', 'reopen'],
    optimizations: ['new', 'continue', 'reopen'],
    'scenario-tests': ['new', 'continue', 'reopen']
  }
  return variants[taskKind]?.includes(entryVariant) === true
}

function readJson(filePath, fsImpl = fs) {
  let raw
  try { raw = fsImpl.readFileSync(filePath, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', filePath }
    throw error
  }
  try { return { status: 'fresh', filePath, raw, value: JSON.parse(raw), digest: sha256(raw) } } catch (error) {
    throw new TaskAdmissionError('TASK_ADMISSION_JSON_INVALID', `invalid JSON at ${filePath}`, { message: error.message })
  }
}

function identityCore(input) {
  return {
    schemaVersion: TASK_IDENTITY_V2_SCHEMA,
    taskId: input.taskId.toLowerCase(),
    displayName: normalizeDisplayName(input.displayName),
    aliases: normalizedAliases(input.aliases, input.displayName),
    project: input.project,
    projectRootIdentityDigest: input.projectRootIdentityDigest,
    taskKind: input.taskKind,
    entryVariant: input.entryVariant,
    taskRootRelative: input.taskRootRelative,
    createdAt: input.createdAt,
    identityVersion: 2
  }
}

function createTaskIdentityV2(input) {
  const core = identityCore(input)
  const identity = { ...core, identityDigest: digest(core) }
  const validation = validateTaskIdentity(identity)
  if (!validation.valid) {
    throw new TaskAdmissionError('TASK_IDENTITY_V2_INVALID', validation.errors.join('; '))
  }
  return identity
}

function assertExistingAncestorsSafe(activeRoot, candidate, fsImpl = fs) {
  const root = path.resolve(activeRoot)
  const target = path.resolve(candidate)
  if (!isInside(root, target, { allowEqual: true })) {
    throw new TaskAdmissionError('TASK_PATH_CONTAINMENT_FAILED', `task path escapes activeRoot: ${target}`)
  }
  let canonicalRoot
  try { canonicalRoot = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(root) : fsImpl.realpathSync(root) } catch (error) {
    throw new TaskAdmissionError('TASK_ACTIVE_ROOT_UNAVAILABLE', `activeRoot cannot be resolved: ${root}`, { cause: error.code })
  }
  const relative = path.relative(root, target)
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let stat
    try { stat = fsImpl.lstatSync(current) } catch (error) {
      if (error?.code === 'ENOENT') break
      throw error
    }
    if (stat.isSymbolicLink()) {
      throw new TaskAdmissionError('TASK_PATH_REPARSE_BLOCKED', `task path crosses a symbolic link or junction: ${current}`)
    }
    const canonical = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(current) : fsImpl.realpathSync(current)
    if (!isInside(canonicalRoot, canonical, { allowEqual: true })) {
      throw new TaskAdmissionError('TASK_PATH_REPARSE_ESCAPE', `task path resolves outside activeRoot: ${current}`)
    }
  }
}

function matchingTaskIdentityAt(taskRoot, taskId, fsImpl = fs) {
  for (const fileName of ['task.json', 'task-identity-v2.json']) {
    const read = readJson(path.join(taskRoot, '.memory', fileName), fsImpl)
    if (read.status !== 'fresh' || read.value.schemaVersion !== TASK_IDENTITY_V2_SCHEMA) continue
    if (validateTaskIdentity(read.value).valid && read.value.taskId.toLowerCase() === String(taskId).toLowerCase()) return true
  }
  return false
}

function decideTaskDirectory(input, options = {}) {
  const fsImpl = options.fs || fs
  const activeRoot = path.resolve(input.activeRoot)
  const taskKind = input.taskKind
  const baseName = assertSafeTaskSegment(input.displayName)
  const kindRoot = path.join(activeRoot, taskKind)
  assertExistingAncestorsSafe(activeRoot, kindRoot, fsImpl)
  let entries = []
  try { entries = fsImpl.readdirSync(kindRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const key = normalizedNameKey(baseName)
  const direct = entries.find(entry => normalizedNameKey(entry.name) === key)
  let selectedName = baseName
  let collision = null
  if (direct && !matchingTaskIdentityAt(path.join(kindRoot, direct.name), input.taskId, fsImpl)) {
    selectedName = assertSafeTaskSegment(`${baseName}--${String(input.taskId).slice(0, 8).toLowerCase()}`)
    collision = direct.name
  } else if (direct) {
    selectedName = direct.name
  }
  const selected = entries.find(entry => normalizedNameKey(entry.name) === normalizedNameKey(selectedName))
  if (selected && !matchingTaskIdentityAt(path.join(kindRoot, selected.name), input.taskId, fsImpl)) {
    throw new TaskAdmissionError(
      'TASK_DIRECTORY_COLLISION',
      `stable task directory is already owned by another task: ${selected.name}`
    )
  }
  const taskRootRelative = `${taskKind}/${selectedName}`
  const core = {
    schemaVersion: TASK_DIRECTORY_DECISION_SCHEMA,
    taskId: input.taskId,
    taskKind,
    displayName: baseName,
    normalizedNameKey: key,
    selectedName,
    taskRootRelative,
    collision,
    suffixPolicy: collision ? 'stable-task-id-prefix-8' : 'none',
    containment: 'active-root-relative',
    mtimeAuthority: false
  }
  return { ...core, decisionDigest: digest(core) }
}

function existingIdentityPlan(input, options = {}) {
  const fsImpl = options.fs || fs
  const taskRootRelative = assertTaskRootRelative(input.task.taskRootRelative, input.task.taskKind)
  const taskRoot = path.join(input.activeRoot, ...taskRootRelative.split('/'))
  assertExistingAncestorsSafe(input.activeRoot, taskRoot, fsImpl)
  const primary = readJson(path.join(taskRoot, '.memory', 'task.json'), fsImpl)
  if (primary.status !== 'fresh') {
    throw new TaskAdmissionError('TASK_IDENTITY_REQUIRED', `existing task identity is missing: ${taskRootRelative}`)
  }
  if (!UUID_RE.test(String(input.task.taskId || '')) || String(primary.value.taskId || '').toLowerCase() !== String(input.task.taskId).toLowerCase()) {
    throw new TaskAdmissionError('TASK_IDENTITY_BINDING_MISMATCH', 'taskId does not match the exact existing task identity')
  }
  const decisionCore = {
    schemaVersion: TASK_DIRECTORY_DECISION_SCHEMA,
    taskId: String(input.task.taskId).toLowerCase(),
    taskKind: input.task.taskKind,
    displayName: normalizeDisplayName(primary.value.displayName || input.task.displayName),
    normalizedNameKey: normalizedNameKey(primary.value.displayName || input.task.displayName),
    selectedName: path.basename(taskRoot),
    taskRootRelative,
    collision: null,
    suffixPolicy: 'existing-exact-path',
    containment: 'active-root-relative',
    mtimeAuthority: false
  }
  const directoryDecision = { ...decisionCore, decisionDigest: digest(decisionCore) }
  if (input.operation === 'bind') {
    let identityRead = primary
    if (primary.value.schemaVersion !== TASK_IDENTITY_V2_SCHEMA) {
      identityRead = readJson(path.join(taskRoot, '.memory', 'task-identity-v2.json'), fsImpl)
    }
    const validation = identityRead.status === 'fresh' ? validateTaskIdentity(identityRead.value) : { valid: false, errors: ['TaskIdentityV2 missing'] }
    if (!validation.valid || identityRead.value.schemaVersion !== TASK_IDENTITY_V2_SCHEMA) {
      throw new TaskAdmissionError('TASK_IDENTITY_V2_REQUIRED', validation.errors.join('; '))
    }
    const identity = identityRead.value
    const portableBinding = evaluatePortableTaskIdentityBinding(identity, {
      taskId: input.task.taskId,
      project: input.project,
      taskKind: input.task.taskKind,
      taskRootRelative,
      currentProjectRootIdentityDigest: input.projectTargetLease.rootIdentityDigest
    })
    if (!portableBinding.valid) {
      throw new TaskAdmissionError('TASK_IDENTITY_V2_BINDING_MISMATCH', portableBinding.errors.join('; '))
    }
    // projectRootIdentityDigest records the physical root that first admitted the
    // task. It is immutable provenance, not a permanent disk-location binding.
    // Current mutation authority remains fenced by ProjectTargetLeaseV2 and the
    // active-root-contained task path, so a workspace relocation can rebind the
    // same stable task without inheriting authority from the old physical root.
    return {
      directoryDecision,
      identity,
      identityPath: identityRead.filePath,
      migration: null,
      relocation: !portableBinding.relocated
        ? null
        : {
            schemaVersion: 'TaskIdentityRelocationObservationV1',
            taskId: identity.taskId,
            originProjectRootIdentityDigest: portableBinding.originProjectRootIdentityDigest,
            currentProjectRootIdentityDigest: portableBinding.currentProjectRootIdentityDigest,
            authority: 'current-project-target-lease',
            mutationAuthority: false
          },
      legacyCpCompatibility: primary.value.schemaVersion === 'TaskIdentityV1'
    }
  }
  if (primary.value.schemaVersion !== 'TaskIdentityV1' || !validateTaskIdentity(primary.value).valid) {
    throw new TaskAdmissionError('TASK_IDENTITY_V1_ADOPTION_REQUIRED', 'adopt requires one valid TaskIdentityV1 at .memory/task.json')
  }
  const identity = createTaskIdentityV2({
    taskId: primary.value.taskId,
    displayName: primary.value.displayName,
    aliases: primary.value.aliases,
    project: input.project,
    projectRootIdentityDigest: input.projectTargetLease.rootIdentityDigest,
    taskKind: input.task.taskKind,
    entryVariant: input.task.entryVariant,
    taskRootRelative,
    createdAt: primary.value.createdAt
  })
  const migrationCore = {
    schemaVersion: 'TaskIdentityMigrationReceiptV1',
    sourceSchema: 'TaskIdentityV1',
    sourceDigest: primary.digest,
    targetSchema: TASK_IDENTITY_V2_SCHEMA,
    targetIdentityDigest: identity.identityDigest,
    taskId: identity.taskId,
    operation: 'adopt'
  }
  return {
    directoryDecision,
    identity,
    identityPath: path.join(taskRoot, '.memory', 'task-identity-v2.json'),
    migration: { ...migrationCore, receiptDigest: digest(migrationCore) },
    legacyCpCompatibility: true
  }
}

function replayAdmissionPlan(input, transaction) {
  const taskRootRelative = assertTaskRootRelative(transaction.taskRootRelative, input.task.taskKind)
  if (transaction.operation !== input.operation || transaction.taskId !== input.task.taskId ||
      transaction.project !== input.project || transaction.projectRootIdentityDigest !== input.projectTargetLease.rootIdentityDigest ||
      transaction.taskKind !== input.task.taskKind || transaction.entryVariant !== input.task.entryVariant) {
    throw new TaskAdmissionError(
      'TASK_ADMISSION_IDEMPOTENCY_CONFLICT',
      'prepared admission journal does not match the current task identity or project lease'
    )
  }
  const identity = createTaskIdentityV2({
    taskId: input.task.taskId,
    displayName: input.task.displayName,
    aliases: input.task.aliases,
    project: input.project,
    projectRootIdentityDigest: input.projectTargetLease.rootIdentityDigest,
    taskKind: input.task.taskKind,
    entryVariant: input.task.entryVariant,
    taskRootRelative,
    createdAt: input.actualInstructionEnvelope.issuedAt
  })
  if (identity.identityDigest !== transaction.taskIdentityDigest) {
    throw new TaskAdmissionError(
      'TASK_ADMISSION_IDEMPOTENCY_CONFLICT',
      'prepared admission journal is bound to different immutable TaskIdentityV2 content'
    )
  }
  const taskRoot = path.join(input.activeRoot, ...taskRootRelative.split('/'))
  return {
    directoryDecision: {
      schemaVersion: TASK_DIRECTORY_DECISION_SCHEMA,
      taskId: input.task.taskId,
      taskKind: input.task.taskKind,
      displayName: identity.displayName,
      selectedName: path.basename(taskRoot),
      taskRootRelative,
      decisionDigest: transaction.directoryDecisionDigest,
      replayedFromPreparedJournal: true
    },
    identity,
    identityPath: path.join(taskRoot, '.memory', 'task.json'),
    migration: null
  }
}

function validateAuthorityIngress(input, options = {}) {
  const envelopeValidation = validateActualInstructionEnvelope(input.actualInstructionEnvelope)
  if (!envelopeValidation.valid || input.actualInstructionEnvelope.instructionAuthority !== true) {
    throw new TaskAdmissionError('TASK_ADMISSION_INSTRUCTION_INVALID', envelopeValidation.errors.join(',') || 'instruction authority unavailable')
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (Date.parse(input.actualInstructionEnvelope.expiresAt) <= nowMs) {
    throw new TaskAdmissionError('TASK_ADMISSION_INSTRUCTION_EXPIRED', 'actual instruction envelope is expired')
  }
  const workItemValidation = validateWorkItemSet(input.workItemSet, input.actualInstructionEnvelope)
  if (!workItemValidation.valid) throw new TaskAdmissionError('TASK_ADMISSION_WORK_ITEM_INVALID', workItemValidation.errors.join(','))
  const routeValidation = validateWorkflowRouteDecision(input.workflowRouteDecision)
  const routeFresh = verifyWorkflowRouteDecision(input.workflowRouteDecision, {
    actualInstructionEnvelope: input.actualInstructionEnvelope,
    workItemSet: input.workItemSet,
    envelopeDigest: input.actualInstructionEnvelope.envelopeDigest,
    workItemDigest: input.workflowRouteDecision.workItemDigest
  })
  if (!routeValidation.valid || !routeFresh.fresh || input.workflowRouteDecision.decisionStatus !== 'selected') {
    throw new TaskAdmissionError('TASK_ADMISSION_ROUTE_INVALID', [...routeValidation.errors, ...routeFresh.errors].join(','))
  }
  const exactResumeRoute = input.workflowRouteDecision.routeKey === 'resume' &&
    input.workflowRouteDecision.topIntent === 'resume'
  if (input.workflowRouteDecision.mutationPolicy !== 'allowed-after-confirmation' &&
      !(options.allowBindRoute === true && exactResumeRoute)) {
    throw new TaskAdmissionError('TASK_ADMISSION_ROUTE_FORBIDDEN', 'formal admission requires a dev/fix/self-fix route')
  }
  const leaseValidation = validateProjectTargetLease(input.projectTargetLease, {
    activeRoot: input.activeRoot,
    project: input.project,
    contextEpoch: input.actualInstructionEnvelope.contextEpoch,
    routeRevision: input.workflowRouteDecision.routeRevision
  }, { nowMs })
  if (!leaseValidation.valid) throw new TaskAdmissionError('TASK_ADMISSION_PROJECT_LEASE_INVALID', leaseValidation.errors.join(','))
}

function validateIngress(input, options = {}) {
  validateAuthorityIngress(input, {
    ...options,
    allowBindRoute: ['adopt', 'bind'].includes(input.operation)
  })
  if (!['admit', 'adopt', 'bind'].includes(input.operation)) throw new TaskAdmissionError('TASK_ADMISSION_OPERATION_INVALID', 'operation must be admit, adopt or bind')
  if (!TASK_KINDS.includes(input.task?.taskKind)) throw new TaskAdmissionError('TASK_ADMISSION_TASK_KIND_INVALID', 'taskKind is not a formal task root')
  if (!entryVariantAllowed(input.task.taskKind, input.task.entryVariant)) {
    throw new TaskAdmissionError('TASK_ADMISSION_ENTRY_VARIANT_INVALID', 'entryVariant is invalid for taskKind')
  }
  const overview = String(input.overview?.content || '')
  if (!overview.trim() || Buffer.byteLength(overview, 'utf8') > MAX_OVERVIEW_BYTES) {
    throw new TaskAdmissionError('TASK_ADMISSION_OVERVIEW_INVALID', `overview content must be 1-${MAX_OVERVIEW_BYTES} UTF-8 bytes`)
  }
  if (input.task.entryVariant === 'product-provided') {
    const source = String(input.overview?.productSourceContent || '')
    if (!source.trim() || Buffer.byteLength(source, 'utf8') > MAX_OVERVIEW_BYTES) {
      throw new TaskAdmissionError('TASK_ADMISSION_PRODUCT_SOURCE_INVALID', 'product-provided admission requires bounded productSourceContent')
    }
  }
}

function normalizeAdmissionIngressSnapshotRef(rawRef, input) {
  if (rawRef == null) return null
  const ref = rawRef && typeof rawRef === 'object' && !Array.isArray(rawRef) ? clone(rawRef) : null
  if (!ref || ref.schemaVersion !== 'AdmissionIngressSnapshotRefV1' ||
      !DIGEST_RE.test(String(ref.snapshotKey || '')) || !DIGEST_RE.test(String(ref.snapshotDigest || '')) ||
      ref.envelopeId !== input.actualInstructionEnvelope.envelopeId ||
      ref.envelopeDigest !== input.actualInstructionEnvelope.envelopeDigest ||
      ref.decisionDigest !== input.workflowRouteDecision.decisionDigest ||
      ref.routeRevision !== input.workflowRouteDecision.routeRevision) {
    throw new TaskAdmissionError(
      'TASK_ADMISSION_CONTINUATION_SNAPSHOT_MISMATCH',
      'admission ingress snapshot ref does not match the exact verified ingress'
    )
  }
  return ref
}

function createAdmissionContinuationLease(transaction, input, snapshotRef, nowMs) {
  if (!snapshotRef) return null
  const issuedAt = new Date(nowMs).toISOString()
  const envelopeExpiryMs = Date.parse(input.actualInstructionEnvelope.expiresAt)
  const expiresAtMs = Math.min(envelopeExpiryMs, nowMs + ADMISSION_CONTINUATION_LEASE_MS)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw new TaskAdmissionError('TASK_ADMISSION_CONTINUATION_EXPIRED', 'admission continuation cannot outlive its verified ingress')
  }
  const leaseSeed = digest({
    admissionId: transaction.admissionId,
    taskId: transaction.taskId,
    snapshotKey: snapshotRef.snapshotKey,
    snapshotDigest: snapshotRef.snapshotDigest
  })
  const core = {
    schemaVersion: 'AdmissionContinuationLeaseV1',
    leaseId: `admission-continuation-${leaseSeed.slice(0, 40)}`,
    status: 'active',
    admissionId: transaction.admissionId,
    taskId: transaction.taskId,
    project: transaction.project,
    projectRootIdentityDigest: transaction.projectRootIdentityDigest,
    sessionDigest: transaction.sessionDigest,
    contextEpoch: input.actualInstructionEnvelope.contextEpoch,
    actualInstructionDigest: transaction.actualInstructionDigest,
    workItemDigest: transaction.workItemDigest,
    routeRevision: transaction.routeRevision,
    snapshotKey: snapshotRef.snapshotKey,
    snapshotDigest: snapshotRef.snapshotDigest,
    issuedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    consumedAt: null,
    ownerLeaseDigest: null
  }
  const lease = { ...core, leaseDigest: admissionContinuationLeaseDigest(core) }
  const validation = validateAdmissionContinuationLease(lease, transaction)
  if (!validation.valid) {
    throw new TaskAdmissionError('TASK_ADMISSION_CONTINUATION_INVALID', validation.errors.join(','))
  }
  return lease
}

function validateOwnerContinuation(transaction, input, operation, nowMs) {
  const lease = transaction.continuationLease
  if (!lease || !['acquire', 'reopen'].includes(operation)) return
  const validation = validateAdmissionContinuationLease(lease, transaction)
  if (!validation.valid) {
    throw new TaskAdmissionError('TASK_ADMISSION_CONTINUATION_INVALID', validation.errors.join(','))
  }
  const ref = normalizeAdmissionIngressSnapshotRef(input.ingressSnapshotRef, input)
  if (!ref || ref.snapshotKey !== lease.snapshotKey || ref.snapshotDigest !== lease.snapshotDigest) {
    throw new TaskAdmissionError(
      'TASK_ADMISSION_CONTINUATION_MISMATCH',
      'owner acquisition requires the exact task-bound admission continuation snapshot'
    )
  }
  if (lease.status === 'active' && Date.parse(lease.expiresAt) <= nowMs) {
    throw new TaskAdmissionError('TASK_ADMISSION_CONTINUATION_EXPIRED', 'admission continuation lease is expired')
  }
}

function consumeOwnerContinuation(transaction, owner, nowMs) {
  const lease = transaction.continuationLease
  if (!lease) return transaction
  if (lease.status === 'consumed') {
    if (lease.ownerLeaseDigest !== owner.leaseDigest) {
      throw new TaskAdmissionError('TASK_ADMISSION_CONTINUATION_REPLAYED', 'admission continuation was already consumed by a different owner lease')
    }
    return transaction
  }
  if (Date.parse(lease.expiresAt) <= nowMs) {
    throw new TaskAdmissionError('TASK_ADMISSION_CONTINUATION_EXPIRED', 'admission continuation lease is expired')
  }
  const consumed = {
    ...clone(lease),
    status: 'consumed',
    consumedAt: new Date(nowMs).toISOString(),
    ownerLeaseDigest: owner.leaseDigest
  }
  consumed.leaseDigest = admissionContinuationLeaseDigest(consumed)
  return { ...transaction, continuationLease: consumed }
}

function compactFileReceipt(receipt) {
  return {
    file: receipt.file,
    route: receipt.route,
    afterDigest: receipt.afterDigest,
    afterBytes: receipt.afterBytes,
    readback: receipt.durability?.readback?.status || 'UNVERIFIED'
  }
}

function createExact(fileTransaction, filePath, content, activeRoot) {
  return fileTransaction.createIfAbsent({
    filePath,
    relativeFile: path.relative(activeRoot, filePath).replace(/\\/g, '/'),
    content
  })
}

function pendingCpBlock() {
  return [
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|',
    '| CP1 | ⏳ | — | — | — | — | — |',
    '| CP2 | ⏹️ | — | — | — | — | — |',
    '| CP3 | ⏹️ | — | — | — | — | — |',
    ''
  ].join('\n')
}

function initialSessionsContent(transaction) {
  return [
    `# ${transaction.displayName} — 工作流状态`,
    '',
    '> **当前状态**: 🔄 active',
    `> **TaskIdentity**: \`${transaction.taskId}\``,
    `> **Admission**: \`${transaction.admissionId}\``,
    `> **Route**: \`${transaction.routeKey}\``,
    `> **Project**: \`${transaction.project}\``,
    '',
    pendingCpBlock()
  ].join('\n')
}

function verifyExistingCp1Confirmation(cp1Cells, sessionsPath, activeRoot, fsImpl = fs, options = {}) {
  const artifactReference = String(cp1Cells[2] || '').trim()
  const expectedDigest = String(cp1Cells[4] || '').toLowerCase()
  const confirmedAt = String(cp1Cells[6] || '').trim()
  const allowLegacyRecord = options.allowLegacyRecord === true
  const legacyTimeOnly = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(confirmedAt)
  if (!artifactReference || artifactReference === '—' || !cp1Cells[3] || cp1Cells[3] === '—' ||
      !DIGEST_RE.test(expectedDigest) || !cp1Cells[5] || cp1Cells[5] === '—' ||
      (!Number.isFinite(Date.parse(confirmedAt)) && !(allowLegacyRecord && legacyTimeOnly))) {
    throw new TaskAdmissionError(
      'TASK_ADMISSION_CP_STATE_CONFLICT',
      'existing CP1 confirmation is not bound to one exact artifact digest, source message and timestamp'
    )
  }
  const taskRoot = path.dirname(path.dirname(sessionsPath))
  const markdownLink = artifactReference.match(/^\[[^\]\r\n]+\]\(([^()\r\n]+)\)$/u)
  let candidate
  let artifactPathKind = 'task-root-relative'
  if (markdownLink) {
    const target = markdownLink[1].trim().replace(/\\/g, '/')
    const segments = target.split('/')
    // memory_cp_confirm owns the CP projection and emits a safe Markdown link
    // relative to .memory/sessions.md. Treat that projection as canonical for
    // both new and legacy tasks; legacy compatibility is only needed for the
    // historical time-only confirmedAt format.
    if (!target || path.isAbsolute(target) || path.posix.isAbsolute(target) ||
        /^[A-Za-z]:/.test(target) || /[%?#]/.test(target) || segments[0] !== '..' ||
        segments.slice(1).some(segment => !segment || segment === '.' || segment === '..')) {
      throw new TaskAdmissionError('TASK_ADMISSION_CP_STATE_CONFLICT', 'legacy CP1 artifact link is ambiguous or unsafe')
    }
    candidate = path.resolve(path.dirname(sessionsPath), ...segments)
    artifactPathKind = 'memory-projected-markdown-relative'
  } else {
    const artifactPath = artifactReference.replace(/\\/g, '/')
    if (path.isAbsolute(artifactPath) || path.posix.isAbsolute(artifactPath) ||
        /^[A-Za-z]:/.test(artifactPath) || artifactPath.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
      throw new TaskAdmissionError('TASK_ADMISSION_CP_STATE_CONFLICT', 'existing CP1 artifact path is ambiguous or unsafe')
    }
    candidate = path.resolve(taskRoot, ...artifactPath.split('/'))
  }
  if (!isInside(taskRoot, candidate)) {
    throw new TaskAdmissionError('TASK_ADMISSION_CP_STATE_CONFLICT', 'existing CP1 artifact path escapes the task root')
  }
  assertExistingAncestorsSafe(activeRoot, candidate, fsImpl)
  let descriptor
  let before
  let after
  let bytes
  try {
    descriptor = fsImpl.openSync(candidate, 'r')
    before = fsImpl.fstatSync(descriptor)
    bytes = fsImpl.readFileSync(descriptor)
    after = fsImpl.fstatSync(descriptor)
  } catch (error) {
    throw new TaskAdmissionError('TASK_ADMISSION_CP_STATE_CONFLICT', 'existing CP1 artifact is unavailable', { cause: error.code })
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor)
  }
  const current = fsImpl.lstatSync(candidate)
  if (!before.isFile() || !current.isFile() || current.isSymbolicLink() || before.size > 8 * 1024 * 1024 || bytes.length !== before.size ||
      !sameStableFileStat(before, after) || !sameStableFileStat(after, current) ||
      sha256(bytes) !== expectedDigest) {
    throw new TaskAdmissionError('TASK_ADMISSION_CP_STATE_CONFLICT', 'existing CP1 artifact readback does not match its confirmation digest')
  }
  const compatibility = legacyTimeOnly
    ? {
        schemaVersion: 'LegacyCpConfirmationCompatibilityV1',
        sourceIdentitySchema: 'TaskIdentityV1',
        artifactPathKind,
        confirmedAtKind: 'legacy-time-only',
        artifactDigest: expectedDigest
      }
    : null
  return { candidate, compatibility }
}

function ensurePendingCpState(fileTransaction, sessionsPath, transaction, activeRoot, options = {}) {
  const snapshot = fileTransaction.readSnapshot(sessionsPath)
  if (!snapshot.exists) {
    return {
      ...createExact(fileTransaction, sessionsPath, initialSessionsContent(transaction), activeRoot),
      cp1Confirmed: false
    }
  }
  const observed = observeExistingCpState(snapshot, sessionsPath, transaction, activeRoot, options)
  if (observed.status === 'complete') return observed.receipt
  const newline = snapshot.content.includes('\r\n') ? '\r\n' : '\n'
  const appendText = `${snapshot.content.trimEnd() ? `${newline}${newline}` : ''}${pendingCpBlock().replace(/\n/g, newline)}`
  return {
    ...fileTransaction.commit({
      filePath: sessionsPath,
      relativeFile: path.relative(activeRoot, sessionsPath).replace(/\\/g, '/'),
      expectedSnapshot: snapshot,
      content: snapshot.content + appendText,
      appendText
    }),
    cp1Confirmed: false
  }
}

function observeExistingCpState(snapshot, sessionsPath, transaction, activeRoot, options = {}) {
  const text = snapshot.content.replace(/\r\n/g, '\n')
  const cpRows = (text.match(/^\|\s*CP[123]\s*\|/gmu) || []).length
  const hasHeading = /^#{1,6}\s+.*CP\s*确认记录\s*$/imu.test(text)
  const hasHeader = /^\|\s*CP\s*\|\s*状态\s*\|\s*artifactPath\s*\|\s*version\s*\|\s*sha256\s*\|\s*sourceMessage\s*\|\s*confirmedAt\s*\|\s*$/imu.test(text)
  if (hasHeading || hasHeader || cpRows) {
    if (!(hasHeading && hasHeader && cpRows === 3)) {
      throw new TaskAdmissionError('TASK_ADMISSION_CP_STATE_CONFLICT', 'existing sessions.md has an incomplete or ambiguous CP table')
    }
    const cp1Line = text.match(/^\|\s*CP1\s*\|.*$/imu)?.[0] || ''
    const cp1Cells = cp1Line.split('|').slice(1, -1).map(cell => cell.trim().replace(/`/g, ''))
    const cp1Confirmed = cp1Cells[1]?.includes('✅') === true
    const cp1Evidence = cp1Confirmed
      ? verifyExistingCp1Confirmation(cp1Cells, sessionsPath, activeRoot, options.fs || fs, options)
      : null
    return {
      status: 'complete',
      receipt: {
        schemaVersion: 'MemoryFileTransactionReceiptV1',
        file: path.relative(activeRoot, sessionsPath).replace(/\\/g, '/'),
        route: 'cp-state-match',
        afterDigest: snapshot.digest,
        afterBytes: snapshot.byteSize,
        bytesWritten: 0,
        cp1Confirmed,
        cp1Compatibility: cp1Evidence?.compatibility || null,
        durability: { readback: { status: 'PASS', scope: 'dedicated-cp-table' } }
      }
    }
  }
  return { status: 'appendable', receipt: null }
}

function verifyAdmissionReadback(input, plan, transaction, paths, fsImpl = fs, options = {}) {
  assertExistingAncestorsSafe(input.activeRoot, paths.taskRoot, fsImpl)
  const identityReadback = readJson(plan.identityPath, fsImpl)
  if (identityReadback.status !== 'fresh' || !validateTaskIdentity(identityReadback.value).valid ||
      identityReadback.value.identityDigest !== transaction.taskIdentityDigest ||
      identityReadback.value.identityDigest !== plan.identity.identityDigest) {
    throw new TaskAdmissionError('TASK_ADMISSION_READBACK_MISMATCH', 'durable TaskIdentityV2 readback no longer matches the admission journal')
  }
  let overview
  try { overview = fsImpl.readFileSync(paths.overviewPath, 'utf8') } catch (error) {
    throw new TaskAdmissionError('TASK_ADMISSION_READBACK_MISMATCH', 'canonical overview is unavailable', { cause: error.code })
  }
  if (overview !== paths.overviewContent || sha256(overview) !== transaction.effects?.overview?.contentDigest) {
    throw new TaskAdmissionError('TASK_ADMISSION_READBACK_MISMATCH', 'canonical overview no longer matches the admission journal')
  }
  if (paths.productSourcePath) {
    let productSource
    try { productSource = fsImpl.readFileSync(paths.productSourcePath, 'utf8') } catch (error) {
      throw new TaskAdmissionError('TASK_ADMISSION_READBACK_MISMATCH', 'product requirement source is unavailable', { cause: error.code })
    }
    const expected = transaction.effects?.overview?.productSource?.afterDigest
    if (productSource !== paths.productSourceContent || sha256(productSource) !== expected) {
      throw new TaskAdmissionError('TASK_ADMISSION_READBACK_MISMATCH', 'product requirement source no longer matches the admission journal')
    }
  }
  let sessions
  try { sessions = fsImpl.readFileSync(paths.sessionsPath, 'utf8').replace(/\r\n/g, '\n') } catch (error) {
    throw new TaskAdmissionError('TASK_ADMISSION_READBACK_MISMATCH', 'workflow CP state is unavailable', { cause: error.code })
  }
  const cpRows = (sessions.match(/^\|\s*CP[123]\s*\|/gmu) || []).length
  const cp1Line = sessions.match(/^\|\s*CP1\s*\|.*$/imu)?.[0] || ''
  const cp1Cells = cp1Line.split('|').slice(1, -1).map(cell => cell.trim().replace(/`/g, ''))
  const cp1Confirmed = cp1Cells[1]?.includes('✅') === true
  const cp1Pending = cp1Cells[1]?.includes('⏳') === true
  if (cpRows !== 3 || (!cp1Confirmed && !cp1Pending) ||
      (transaction.effects?.cpState?.cp1Confirmed === true && !cp1Confirmed)) {
    throw new TaskAdmissionError('TASK_ADMISSION_READBACK_MISMATCH', 'workflow CP state no longer matches the admission journal')
  }
  if (cp1Confirmed) {
    verifyExistingCp1Confirmation(cp1Cells, paths.sessionsPath, input.activeRoot, fsImpl, {
      allowLegacyRecord: options.allowLegacyRecord === true ||
        transaction.effects?.cpState?.compatibility?.schemaVersion === 'LegacyCpConfirmationCompatibilityV1'
    })
  }
}

function nextTransaction(current, phase, effectName, effect, nowMs) {
  const next = {
    ...clone(current),
    phase,
    status: phase === 'finalized'
      ? 'finalized'
      : (phase === 'terminal-closeout'
          ? 'terminal'
          : (phase === 'aborted' ? 'aborted' : (phase === 'needs-reconcile' ? 'needs-reconcile' : 'admitting'))),
    updatedAt: new Date(nowMs).toISOString(),
    effects: effectName
      ? { ...clone(current.effects), [effectName]: effect }
      : clone(current.effects)
  }
  next.transactionDigest = taskAdmissionTransactionDigest(next)
  return next
}

function reconcileTransaction(current, error, nowMs) {
  const next = {
    ...clone(current),
    phase: 'needs-reconcile',
    status: 'needs-reconcile',
    updatedAt: new Date(nowMs).toISOString(),
    error: {
      errorCode: error.code || 'TASK_ADMISSION_EFFECT_FAILED',
      messageDigest: digest(String(error.message || 'task admission effect failed')),
      failedFromPhase: current.phase
    }
  }
  delete next.reconciliation
  next.transactionDigest = taskAdmissionTransactionDigest(next)
  return next
}

function observedFileReceipt(snapshot, filePath, activeRoot) {
  return {
    file: path.relative(activeRoot, filePath).replace(/\\/g, '/'),
    route: 'reconciled-exact-readback',
    afterDigest: snapshot.digest,
    afterBytes: snapshot.byteSize,
    readback: 'PASS'
  }
}

function exactAdmissionSnapshot(fileTransaction, filePath, expectedContent, activeRoot, fsImpl) {
  assertExistingAncestorsSafe(activeRoot, filePath, fsImpl)
  const snapshot = fileTransaction.readSnapshot(filePath)
  if (!snapshot.exists) return null
  const expectedDigest = sha256(expectedContent)
  if (snapshot.content !== expectedContent || snapshot.digest !== expectedDigest || snapshot.byteSize !== Buffer.byteLength(expectedContent, 'utf8')) {
    throw new TaskAdmissionError(
      'TASK_ADMISSION_RECONCILIATION_DRIFT',
      'an observed admission artifact does not match the exact stable request',
      { file: path.relative(activeRoot, filePath).replace(/\\/g, '/') }
    )
  }
  return { snapshot, receipt: observedFileReceipt(snapshot, filePath, activeRoot) }
}

function recoverTaskAdmissionTransaction(input, plan, transaction, paths, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const fileTransaction = options.fileTransaction || createMemoryFileTransaction({
    fs: fsImpl,
    platform: options.platform,
    now: () => new Date(nowMs)
  })
  const expectedIdentityContent = `${JSON.stringify(plan.identity, null, 2)}\n`
  const expectedMigrationContent = plan.migration ? `${JSON.stringify(plan.migration, null, 2)}\n` : null
  const identity = exactAdmissionSnapshot(fileTransaction, plan.identityPath, expectedIdentityContent, input.activeRoot, fsImpl)
  const migrationPath = plan.migration
    ? path.join(paths.taskRoot, '.memory', 'task-identity-migration-v1.json')
    : null
  const migration = migrationPath
    ? exactAdmissionSnapshot(fileTransaction, migrationPath, expectedMigrationContent, input.activeRoot, fsImpl)
    : null
  const overview = exactAdmissionSnapshot(fileTransaction, paths.overviewPath, paths.overviewContent, input.activeRoot, fsImpl)
  const product = paths.productSourcePath
    ? exactAdmissionSnapshot(fileTransaction, paths.productSourcePath, paths.productSourceContent, input.activeRoot, fsImpl)
    : null
  assertExistingAncestorsSafe(input.activeRoot, paths.sessionsPath, fsImpl)
  const sessionsSnapshot = fileTransaction.readSnapshot(paths.sessionsPath)
  const cp = sessionsSnapshot.exists
    ? observeExistingCpState(sessionsSnapshot, paths.sessionsPath, transaction, input.activeRoot, {
        fs: fsImpl,
        allowLegacyRecord: plan.legacyCpCompatibility === true
      })
    : { status: 'missing', receipt: null }

  let observedPhase = 'prepared'
  if (identity && (!migrationPath || migration)) observedPhase = 'identity-written'
  if (observedPhase === 'identity-written' && overview && (!paths.productSourcePath || product)) {
    observedPhase = 'overview-written'
  }
  if (observedPhase === 'overview-written' && cp.status === 'complete') observedPhase = 'cp-state-written'
  const phaseOrder = ['prepared', 'identity-written', 'overview-written', 'cp-state-written']
  const failedFromPhase = String(transaction.error?.failedFromPhase || '')
  if (!phaseOrder.includes(failedFromPhase) || phaseOrder.indexOf(observedPhase) < phaseOrder.indexOf(failedFromPhase)) {
    throw new TaskAdmissionError(
      'TASK_ADMISSION_RECONCILIATION_PHASE_DRIFT',
      'observed admission phase is behind the durable failed-from phase',
      { failedFromPhase, observedPhase }
    )
  }

  const effects = {
    identity: { status: 'pending', path: transaction.effects.identity.path },
    overview: { status: 'pending', path: transaction.effects.overview.path },
    cpState: { status: 'pending', path: transaction.effects.cpState.path },
    owner: { status: 'pending' }
  }
  if (phaseOrder.indexOf(observedPhase) >= 1) {
    effects.identity = {
      status: 'written',
      identityDigest: plan.identity.identityDigest,
      file: identity.receipt,
      migration: migration ? migration.receipt : null
    }
  }
  if (phaseOrder.indexOf(observedPhase) >= 2) {
    effects.overview = {
      status: 'written',
      contentDigest: sha256(paths.overviewContent),
      file: overview.receipt,
      productSource: product ? product.receipt : null
    }
  }
  if (phaseOrder.indexOf(observedPhase) >= 3) {
    effects.cpState = {
      status: cp.receipt.cp1Confirmed === true ? 'confirmed' : 'pending',
      cp1Confirmed: cp.receipt.cp1Confirmed === true,
      compatibility: cp.receipt.cp1Compatibility || null,
      file: compactFileReceipt(cp.receipt)
    }
  }
  const observedEffectsDigest = digestValue({
    schemaVersion: 'TaskAdmissionObservedEffectsV1',
    observedPhase,
    effects
  })
  const receiptSemantic = {
    schemaVersion: 'TaskAdmissionReconciliationReceiptV1',
    admissionId: transaction.admissionId,
    taskId: transaction.taskId,
    requestDigest: transaction.requestDigest,
    priorTransactionDigest: transaction.transactionDigest,
    failedFromPhase,
    observedPhase,
    recoveredPhase: observedPhase,
    observedEffectsDigest,
    recoveredEffectsDigest: digestValue(effects),
    mutationAuthority: false,
    reconciledAt: new Date(nowMs).toISOString()
  }
  const receipt = {
    ...receiptSemantic,
    receiptDigest: taskAdmissionReconciliationReceiptDigest(receiptSemantic)
  }
  const recovered = {
    ...clone(transaction),
    phase: observedPhase,
    status: 'admitting',
    effects,
    error: null,
    reconciliation: receipt,
    updatedAt: receipt.reconciledAt
  }
  recovered.transactionDigest = taskAdmissionTransactionDigest(recovered)
  return { recovered, receipt }
}

function admissionReceipt(transaction, replayed = false) {
  const finalized = ['finalized', 'terminal-closeout'].includes(transaction.phase)
  return {
    schemaVersion: FORMAL_ADMISSION_RECEIPT_SCHEMA,
    status: transaction.phase === 'cp-state-written' ? 'awaiting-owner-fence' : transaction.status,
    phase: transaction.phase,
    admissionId: transaction.admissionId,
    ingressIdempotencyKey: transaction.ingressIdempotencyKey,
    taskId: transaction.taskId,
    taskIdentityDigest: transaction.taskIdentityDigest,
    project: transaction.project,
    taskKind: transaction.taskKind,
    entryVariant: transaction.entryVariant,
    taskRootRelative: transaction.taskRootRelative,
    routeKey: transaction.routeKey,
    routeRevision: transaction.routeRevision,
    transactionDigest: transaction.transactionDigest,
    continuationLease: transaction.continuationLease ? clone(transaction.continuationLease) : null,
    replayed,
    admissionGeneration: transaction.admissionGeneration,
    finalized,
    mutationAuthority: false,
    nextRequiredPhase: transaction.phase === 'cp-state-written'
      ? 'owner-fenced'
      : (transaction.phase === 'owner-fenced' ? 'finalized' : null)
  }
}

function executeTaskAdmission(rawInput = {}, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const input = {
    ...rawInput,
    operation: String(rawInput.operation || 'admit').trim(),
    activeRoot: path.resolve(String(rawInput.activeRoot || '')),
    project: String(rawInput.project || '').trim()
  }
  validateIngress(input, { nowMs })
  const ingressSnapshotRef = normalizeAdmissionIngressSnapshotRef(input.ingressSnapshotRef, input)
  const ingressIdempotencyKey = createIngressIdempotencyKey({
    projectRootIdentity: input.projectTargetLease.rootIdentityDigest,
    hostVariant: input.actualInstructionEnvelope.hostVariant,
    sessionDigest: input.projectTargetLease.authorityDigest,
    sourceEventId: input.actualInstructionEnvelope.sourceEventId,
    actualInstructionDigest: input.actualInstructionEnvelope.actualInstructionDigest,
    workItemDigest: input.workflowRouteDecision.workItemDigest,
    admissionPolicyRevision: ADMISSION_POLICY_REVISION
  })
  let taskId
  if (input.operation === 'admit') {
    if (input.task.taskId) throw new TaskAdmissionError('TASK_ADMISSION_TASK_ID_CALLER_FORBIDDEN', 'admit taskId is generated by the runtime owner')
    taskId = deterministicTaskId(ingressIdempotencyKey)
  } else {
    taskId = String(input.task.taskId || '').toLowerCase()
    if (!UUID_RE.test(taskId)) throw new TaskAdmissionError('TASK_ADMISSION_TASK_ID_REQUIRED', 'adopt/bind requires the exact stable taskId')
  }
  input.task = { ...input.task, taskId }

  const identity = {
    activeRoot: input.activeRoot,
    project: input.project,
    taskId,
    taskStatus: 'active'
  }
  const metaDir = rawInput.metaDir || resolveTaskRecoveryMetaDir({
    activeRoot: input.activeRoot,
    project: input.project
  })
  const existing = readTaskAdmissionTransaction({ metaDir, identity }, { fs: fsImpl })
  if (!['fresh', 'missing'].includes(existing.status)) {
    throw new TaskAdmissionError(
      existing.errorCode || 'TASK_ADMISSION_STORE_INVALID',
      'task admission recovery state is unavailable or invalid'
    )
  }
  let transaction = existing.status === 'fresh' ? existing.transaction : null
  let priorTerminalTransaction = null

  let plan
  if (input.operation === 'admit' && transaction) {
    plan = replayAdmissionPlan(input, transaction)
  } else if (input.operation === 'admit') {
    const directoryDecision = decideTaskDirectory({
      activeRoot: input.activeRoot,
      taskKind: input.task.taskKind,
      displayName: input.task.displayName,
      taskId
    }, { fs: fsImpl })
    const identity = createTaskIdentityV2({
      taskId,
      displayName: input.task.displayName,
      aliases: input.task.aliases,
      project: input.project,
      projectRootIdentityDigest: input.projectTargetLease.rootIdentityDigest,
      taskKind: input.task.taskKind,
      entryVariant: input.task.entryVariant,
      taskRootRelative: directoryDecision.taskRootRelative,
      createdAt: input.actualInstructionEnvelope.issuedAt
    })
    const taskRoot = path.join(input.activeRoot, ...directoryDecision.taskRootRelative.split('/'))
    plan = {
      directoryDecision,
      identity,
      identityPath: path.join(taskRoot, '.memory', 'task.json'),
      migration: null
    }
  } else {
    plan = existingIdentityPlan(input, { fs: fsImpl })
  }

  const taskRootRelative = plan.directoryDecision.taskRootRelative
  const taskRoot = path.join(input.activeRoot, ...taskRootRelative.split('/'))
  const overviewPath = path.join(taskRoot, overviewName(input.task.taskKind, input.task.entryVariant))
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const productSourcePath = input.task.entryVariant === 'product-provided'
    ? path.join(taskRoot, '01-产品需求.md')
    : null
  const overviewContent = String(input.overview.content)
  const productSourceContent = productSourcePath ? String(input.overview.productSourceContent) : ''
  const requestCore = {
    operation: input.operation,
    actualInstructionDigest: input.actualInstructionEnvelope.actualInstructionDigest,
    workItemDigest: input.workflowRouteDecision.workItemDigest,
    workflowRouteBindingDigest: computeWorkflowRouteAdmissionBindingDigest(input.workflowRouteDecision),
    taskIdentityDigest: plan.identity.identityDigest,
    directoryDecisionDigest: plan.directoryDecision.decisionDigest,
    overviewDigest: sha256(overviewContent),
    productSourceDigest: productSourcePath ? sha256(productSourceContent) : null,
    admissionPolicyRevision: ADMISSION_POLICY_REVISION
  }
  const projectTargetLeaseBindingDigest = computeProjectTargetAdmissionBindingDigest(input.projectTargetLease)
  const requestDigest = digest({
    schemaVersion: TASK_ADMISSION_REQUEST_DIGEST_SCHEMA,
    ...requestCore,
    projectTargetLeaseBindingDigest
  })
  const legacyTemporalRequestCore = {
    operation: input.operation,
    envelopeDigest: input.actualInstructionEnvelope.envelopeDigest,
    workItemSetDigest: input.workItemSet.setDigest,
    workflowRouteDigest: input.workflowRouteDecision.decisionDigest,
    taskIdentityDigest: plan.identity.identityDigest,
    directoryDecisionDigest: plan.directoryDecision.decisionDigest,
    overviewDigest: sha256(overviewContent),
    productSourceDigest: productSourcePath ? sha256(productSourceContent) : null,
    admissionPolicyRevision: ADMISSION_POLICY_REVISION
  }
  const legacyRequestDigest = transaction && !transaction.requestDigestSchema
    ? digest({
        ...legacyTemporalRequestCore,
        projectTargetLeaseDigest: transaction.projectTargetLeaseDigest
      })
    : null
  const legacyV2RequestDigest = transaction?.requestDigestSchema === TASK_ADMISSION_REQUEST_DIGEST_SCHEMA &&
      transaction.requestDigestSemantics === undefined
    ? digest({
        schemaVersion: TASK_ADMISSION_REQUEST_DIGEST_SCHEMA,
        ...legacyTemporalRequestCore,
        projectTargetLeaseBindingDigest: legacyProjectTargetAdmissionBindingDigest(input.projectTargetLease)
      })
    : null
  const boundedLegacyResumeReplay = !!transaction &&
    transaction.ingressIdempotencyKey === ingressIdempotencyKey &&
    ['adopt', 'bind'].includes(input.operation) &&
    input.workflowRouteDecision.routeKey === 'resume' &&
    input.workflowRouteDecision.topIntent === 'resume' &&
    transaction.operation === input.operation &&
    transaction.admissionPolicyRevision === ADMISSION_POLICY_REVISION &&
    transaction.project === input.project &&
    transaction.projectRootIdentityDigest === input.projectTargetLease.rootIdentityDigest &&
    transaction.hostVariant === input.actualInstructionEnvelope.hostVariant &&
    transaction.sessionDigest === input.projectTargetLease.authorityDigest &&
    transaction.sourceEventId === input.actualInstructionEnvelope.sourceEventId &&
    transaction.actualInstructionDigest === input.actualInstructionEnvelope.actualInstructionDigest &&
    transaction.workItemDigest === input.workflowRouteDecision.workItemDigest &&
    transaction.routeKey === input.workflowRouteDecision.routeKey &&
    transaction.routeRevision === input.workflowRouteDecision.routeRevision &&
    transaction.taskId === plan.identity.taskId &&
    transaction.taskKind === input.task.taskKind &&
    transaction.entryVariant === input.task.entryVariant &&
    transaction.taskIdentityDigest === plan.identity.identityDigest &&
    transaction.directoryDecisionDigest === plan.directoryDecision.decisionDigest
  const requestMatches = transaction
    ? (transaction.requestDigestSchema === TASK_ADMISSION_REQUEST_DIGEST_SCHEMA
        ? (transaction.requestDigestSemantics === 'stable-admission-binding-v1'
            ? transaction.projectTargetLeaseBindingDigest === projectTargetLeaseBindingDigest &&
              transaction.requestDigest === requestDigest
            : (transaction.projectTargetLeaseBindingDigest === legacyProjectTargetAdmissionBindingDigest(input.projectTargetLease) &&
                transaction.requestDigest === legacyV2RequestDigest) || boundedLegacyResumeReplay)
        : !transaction.requestDigestSchema && !transaction.projectTargetLeaseBindingDigest &&
          (transaction.requestDigest === legacyRequestDigest || boundedLegacyResumeReplay))
    : true
  if (transaction && transaction.phase === 'terminal-closeout' &&
      transaction.ingressIdempotencyKey !== ingressIdempotencyKey &&
      input.task.entryVariant === 'reopen' && ['adopt', 'bind'].includes(input.operation)) {
    priorTerminalTransaction = transaction
    transaction = null
  }
  let replayed = false
  if (existing.status === 'fresh') {
    if (transaction && (transaction.ingressIdempotencyKey !== ingressIdempotencyKey || !requestMatches)) {
      throw new TaskAdmissionError('TASK_ADMISSION_IDEMPOTENCY_CONFLICT', 'same admission identity is already bound to different request content')
    }
    if (transaction?.phase === 'aborted') {
      return { ...admissionReceipt(transaction, true), status: transaction.phase, errorCode: 'TASK_ADMISSION_RECONCILE_REQUIRED' }
    }
    if (transaction?.phase === 'needs-reconcile') {
      let recovery
      try {
        recovery = recoverTaskAdmissionTransaction(input, plan, transaction, {
          taskRoot,
          overviewPath,
          overviewContent,
          productSourcePath,
          productSourceContent,
          sessionsPath
        }, { fs: fsImpl, nowMs, platform: options.platform })
      } catch (error) {
        return {
          ...admissionReceipt(transaction, true),
          status: 'needs-reconcile',
          errorCode: error.code || 'TASK_ADMISSION_RECONCILIATION_FAILED',
          reconciliationErrors: [String(error.message || 'task admission reconciliation failed')]
        }
      }
      const reconciled = commitTaskAdmissionReconciliation({
        metaDir,
        identity,
        hostSessionDigest: input.actualInstructionEnvelope.hostSessionDigest,
        expectedPriorTransactionDigest: transaction.transactionDigest,
        transaction: recovery.recovered,
        receipt: recovery.receipt
      }, { fs: fsImpl, nowMs, ...options.storeOptions })
      if (!['committed', 'semantic-noop'].includes(reconciled.status)) {
        return {
          ...admissionReceipt(transaction, true),
          status: 'needs-reconcile',
          errorCode: reconciled.errorCode || 'TASK_ADMISSION_RECONCILIATION_COMMIT_FAILED',
          reconciliationErrors: reconciled.errors || [reconciled.message || 'task admission reconciliation commit failed']
        }
      }
      transaction = recovery.recovered
      replayed = true
    }
    if (transaction && ['cp-state-written', 'owner-fenced', 'finalized', 'terminal-closeout'].includes(transaction.phase)) {
      verifyAdmissionReadback(input, plan, transaction, {
        taskRoot,
        overviewPath,
        overviewContent,
        productSourcePath,
        productSourceContent,
        sessionsPath
      }, fsImpl, { allowLegacyRecord: plan.legacyCpCompatibility === true })
      return admissionReceipt(transaction, true)
    }
    replayed = !!transaction
  }

  const faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : () => {}
  const fileTransaction = options.fileTransaction || createMemoryFileTransaction({
    fs: fsImpl,
    platform: options.platform,
    now: () => new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now())
  })
  const commitJournal = (next, expectedPreviousPhase = '', extraOptions = {}) => {
    const commit = commitTaskAdmissionTransaction({
      metaDir,
      identity,
      hostSessionDigest: input.actualInstructionEnvelope.hostSessionDigest,
      transaction: next,
      expectedPreviousPhase
    }, {
      fs: fsImpl,
      nowMs,
      ...options.storeOptions,
      ...(priorTerminalTransaction ? { allowReopen: true } : {}),
      ...extraOptions
    })
    if (!['committed', 'semantic-noop'].includes(commit.status)) {
      throw new TaskAdmissionError(commit.errorCode || 'TASK_ADMISSION_JOURNAL_WRITE_FAILED', commit.message || 'task admission journal write failed', commit)
    }
    transaction = next
    return commit
  }

  try {
    if (!transaction) {
      const createdAt = new Date(nowMs).toISOString()
      transaction = {
        schemaVersion: 'TaskAdmissionTransactionV1',
        admissionId: `admission-${ingressIdempotencyKey.slice(0, 40)}`,
        ingressIdempotencyKey,
        admissionGeneration: priorTerminalTransaction
          ? Number(priorTerminalTransaction.admissionGeneration || 1) + 1
          : 1,
        admissionPolicyRevision: ADMISSION_POLICY_REVISION,
        phase: 'prepared',
        status: 'admitting',
        operation: input.operation,
        requestDigest,
        requestDigestSchema: TASK_ADMISSION_REQUEST_DIGEST_SCHEMA,
        requestDigestSemantics: 'stable-admission-binding-v1',
        project: input.project,
        projectRootIdentityDigest: input.projectTargetLease.rootIdentityDigest,
        hostVariant: input.actualInstructionEnvelope.hostVariant,
        sessionDigest: input.projectTargetLease.authorityDigest,
        sourceEventId: input.actualInstructionEnvelope.sourceEventId,
        actualInstructionDigest: input.actualInstructionEnvelope.actualInstructionDigest,
        workItemId: input.workflowRouteDecision.workItemId,
        workItemDigest: input.workflowRouteDecision.workItemDigest,
        workflowRouteDigest: input.workflowRouteDecision.decisionDigest,
        routeKey: input.workflowRouteDecision.routeKey,
        routeRevision: input.workflowRouteDecision.routeRevision,
        projectTargetLeaseDigest: input.projectTargetLease.leaseDigest,
        projectTargetLeaseBindingDigest,
        taskId,
        displayName: plan.identity.displayName,
        taskKind: input.task.taskKind,
        entryVariant: input.task.entryVariant,
        taskIdentityDigest: plan.identity.identityDigest,
        directoryDecisionDigest: plan.directoryDecision.decisionDigest,
        taskRootRelative,
        effects: {
          identity: { status: 'pending', path: path.relative(input.activeRoot, plan.identityPath).replace(/\\/g, '/') },
          overview: { status: 'pending', path: path.relative(input.activeRoot, overviewPath).replace(/\\/g, '/') },
          cpState: { status: 'pending', path: path.relative(input.activeRoot, sessionsPath).replace(/\\/g, '/') },
          owner: { status: 'pending' }
        },
        error: null,
        createdAt,
        updatedAt: createdAt
      }
      if (ingressSnapshotRef) {
        transaction.continuationLease = createAdmissionContinuationLease(transaction, input, ingressSnapshotRef, nowMs)
      }
      transaction.transactionDigest = taskAdmissionTransactionDigest(transaction)
      commitJournal(transaction, priorTerminalTransaction ? 'terminal-closeout' : '')
      faultInjector('after-prepared', { transaction: clone(transaction) })
    } else if (transaction.phase === 'prepared') {
      commitJournal(transaction, 'prepared', { force: true })
      faultInjector('after-prepared-recheck', { transaction: clone(transaction) })
    }

    if (transaction.phase === 'prepared') {
      assertExistingAncestorsSafe(input.activeRoot, taskRoot, fsImpl)
      fsImpl.mkdirSync(path.dirname(plan.identityPath), { recursive: true })
      faultInjector('after-task-directory-effect', { transaction: clone(transaction), taskRoot })
      assertExistingAncestorsSafe(input.activeRoot, taskRoot, fsImpl)
      const identityReceipt = createExact(
        fileTransaction,
        plan.identityPath,
        `${JSON.stringify(plan.identity, null, 2)}\n`,
        input.activeRoot
      )
      let migrationReceipt = null
      if (plan.migration) {
        migrationReceipt = createExact(
          fileTransaction,
          path.join(taskRoot, '.memory', 'task-identity-migration-v1.json'),
          `${JSON.stringify(plan.migration, null, 2)}\n`,
          input.activeRoot
        )
      }
      const identityReadback = readJson(plan.identityPath, fsImpl)
      if (identityReadback.status !== 'fresh' || identityReadback.value.identityDigest !== plan.identity.identityDigest ||
          !validateTaskIdentity(identityReadback.value).valid) {
        throw new TaskAdmissionError('TASK_IDENTITY_V2_READBACK_FAILED', 'TaskIdentityV2 readback did not match the prepared identity')
      }
      faultInjector('after-identity-effect', { transaction: clone(transaction), identityPath: plan.identityPath })
      const next = nextTransaction(transaction, 'identity-written', 'identity', {
        status: 'written',
        identityDigest: plan.identity.identityDigest,
        file: compactFileReceipt(identityReceipt),
        migration: migrationReceipt ? compactFileReceipt(migrationReceipt) : null
      }, nowMs)
      commitJournal(next, 'prepared')
      faultInjector('after-identity-written', { transaction: clone(transaction) })
    }

    if (transaction.phase === 'identity-written') {
      assertExistingAncestorsSafe(input.activeRoot, taskRoot, fsImpl)
      const identityReadback = readJson(plan.identityPath, fsImpl)
      if (identityReadback.status !== 'fresh' || identityReadback.value.identityDigest !== transaction.taskIdentityDigest ||
          !validateTaskIdentity(identityReadback.value).valid) {
        throw new TaskAdmissionError('TASK_IDENTITY_V2_READBACK_FAILED', 'TaskIdentityV2 changed before overview materialization')
      }
      let productReceipt = null
      if (productSourcePath) productReceipt = createExact(fileTransaction, productSourcePath, productSourceContent, input.activeRoot)
      const overviewReceipt = createExact(fileTransaction, overviewPath, overviewContent, input.activeRoot)
      faultInjector('after-overview-effect', { transaction: clone(transaction), overviewPath })
      const next = nextTransaction(transaction, 'overview-written', 'overview', {
        status: 'written',
        contentDigest: sha256(overviewContent),
        file: compactFileReceipt(overviewReceipt),
        productSource: productReceipt ? compactFileReceipt(productReceipt) : null
      }, nowMs)
      commitJournal(next, 'identity-written')
      faultInjector('after-overview-written', { transaction: clone(transaction) })
    }

    if (transaction.phase === 'overview-written') {
      assertExistingAncestorsSafe(input.activeRoot, taskRoot, fsImpl)
      const cpReceipt = ensurePendingCpState(fileTransaction, sessionsPath, transaction, input.activeRoot, {
        fs: fsImpl,
        allowLegacyRecord: plan.legacyCpCompatibility === true
      })
      faultInjector('after-cp-state-effect', { transaction: clone(transaction), sessionsPath })
      const next = nextTransaction(transaction, 'cp-state-written', 'cpState', {
        status: cpReceipt.cp1Confirmed === true ? 'confirmed' : 'pending',
        cp1Confirmed: cpReceipt.cp1Confirmed === true,
        compatibility: cpReceipt.cp1Compatibility || null,
        file: compactFileReceipt(cpReceipt)
      }, nowMs)
      commitJournal(next, 'overview-written')
      faultInjector('after-cp-state-written', { transaction: clone(transaction) })
    }
    return admissionReceipt(transaction, replayed)
  } catch (error) {
    if (error?.simulatedCrash === true || error?.code === 'TASK_ADMISSION_CRASH_INJECTED') throw error
    if (!transaction || ['aborted', 'needs-reconcile'].includes(transaction.phase)) throw error
    const reconcile = reconcileTransaction(transaction, error, nowMs)
    const closeout = commitTaskAdmissionTransaction({
      metaDir,
      identity,
      hostSessionDigest: input.actualInstructionEnvelope.hostSessionDigest,
      transaction: reconcile,
      expectedPreviousPhase: transaction.phase
    }, { fs: fsImpl, nowMs, ...options.storeOptions })
    return {
      ...admissionReceipt(reconcile, replayed),
      status: 'needs-reconcile',
      errorCode: error.code || 'TASK_ADMISSION_EFFECT_FAILED',
      reconcilePersisted: ['committed', 'semantic-noop', 'closeout-reserved'].includes(closeout.status),
      closeoutStatus: closeout.status
    }
  }
}

function ownerNonce(options = {}) {
  if (typeof options.nonceFactory === 'function') {
    const value = String(options.nonceFactory())
    if (/^owner-[a-f0-9]{40}$/.test(value)) return value
  }
  return `owner-${crypto.randomBytes(20).toString('hex')}`
}

function ownerRef(owner) {
  return owner
    ? {
        ownerGeneration: owner.ownerGeneration,
        ownerNonce: owner.ownerNonce,
        leaseRevision: owner.leaseRevision,
        leaseDigest: owner.leaseDigest
      }
    : { mode: 'absent' }
}

function exactOwnerRefMatches(owner, expected) {
  return !!owner && !!expected &&
    owner.ownerGeneration === expected.ownerGeneration &&
    owner.ownerNonce === expected.ownerNonce &&
    owner.leaseRevision === expected.leaseRevision &&
    owner.leaseDigest === expected.leaseDigest
}

function sealOwner(input) {
  const owner = {
    schemaVersion: FENCED_TASK_WRITE_OWNER_SCHEMA,
    taskId: input.taskId,
    projectRootIdentity: input.projectRootIdentity,
    sessionDigest: input.sessionDigest,
    contextEpoch: input.contextEpoch,
    routeRevision: input.routeRevision,
    ownerGeneration: input.ownerGeneration,
    ownerNonce: input.ownerNonce,
    leaseRevision: input.leaseRevision,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    handoffRef: input.handoffRef || null,
    takeoverRef: input.takeoverRef || null,
    transitionRef: input.transitionRef || null,
    reopenGeneration: input.reopenGeneration,
    revocationEpoch: input.revocationEpoch,
    status: input.status
  }
  owner.leaseDigest = fencedTaskWriteOwnerDigest(owner)
  return owner
}

function observedCpState(transaction, activeRoot, fsImpl = fs) {
  const sessionsPath = path.join(activeRoot, ...transaction.taskRootRelative.split('/'), '.memory', 'sessions.md')
  let sessions
  try { sessions = fsImpl.readFileSync(sessionsPath, 'utf8').replace(/\r\n/g, '\n') } catch (error) {
    throw new TaskAdmissionError('TASK_ADMISSION_CP_STATE_UNAVAILABLE', 'workflow CP state is unavailable before owner fencing', { cause: error.code })
  }
  const cpRows = (sessions.match(/^\|\s*CP[123]\s*\|/gmu) || []).length
  const cp1Line = sessions.match(/^\|\s*CP1\s*\|.*$/imu)?.[0] || ''
  const cp1Cells = cp1Line.split('|').slice(1, -1).map(cell => cell.trim().replace(/`/g, ''))
  const cp1Confirmed = cp1Cells[1]?.includes('✅') === true
  const cp1Pending = cp1Cells[1]?.includes('⏳') === true
  if (cpRows !== 3 || (!cp1Confirmed && !cp1Pending)) {
    throw new TaskAdmissionError('TASK_ADMISSION_CP_STATE_CONFLICT', 'workflow CP table is missing or ambiguous before owner fencing')
  }
  if (cp1Confirmed) {
    verifyExistingCp1Confirmation(cp1Cells, sessionsPath, activeRoot, fsImpl, {
      allowLegacyRecord: transaction.effects?.cpState?.compatibility?.schemaVersion === 'LegacyCpConfirmationCompatibilityV1'
    })
  }
  return { cp1Confirmed, sessionsPath }
}

function refreshFinalizedCpObservation(transaction, activeRoot, nowMs, fsImpl = fs) {
  if (transaction?.phase !== 'finalized') return transaction
  const cp = observedCpState(transaction, activeRoot, fsImpl)
  const desiredStatus = cp.cp1Confirmed ? 'confirmed' : 'pending'
  if (transaction.effects?.cpState?.status === desiredStatus &&
      transaction.effects?.cpState?.cp1Confirmed === cp.cp1Confirmed) return transaction
  const refreshed = clone(transaction)
  refreshed.effects = {
    ...refreshed.effects,
    cpState: {
      ...refreshed.effects?.cpState,
      status: desiredStatus,
      cp1Confirmed: cp.cp1Confirmed
    }
  }
  refreshed.updatedAt = new Date(nowMs).toISOString()
  refreshed.transactionDigest = taskAdmissionTransactionDigest(refreshed)
  return refreshed
}

function ownerTransitionRequestDigest(operation, input) {
  const expectedOwner = input.expectedOwner?.mode === 'absent'
    ? { mode: 'absent' }
    : (input.expectedOwner
        ? {
            ownerGeneration: input.expectedOwner.ownerGeneration,
            ownerNonce: input.expectedOwner.ownerNonce,
            leaseRevision: input.expectedOwner.leaseRevision,
            leaseDigest: input.expectedOwner.leaseDigest
          }
        : { mode: 'absent' })
  const terminalEvidence = Array.isArray(input.evidence)
    ? input.evidence.map(item => ({
        role: String(item?.role || '').trim(),
        path: String(item?.path || '').trim().replace(/\\/g, '/'),
        sha256: String(item?.sha256 || '').trim().toLowerCase(),
        bytes: Number(item?.bytes)
      })).sort((left, right) => left.role.localeCompare(right.role) || left.path.localeCompare(right.path))
    : []
  return digest({
    schemaVersion: 'FencedTaskWriteOwnerTransitionRequestV1',
    operation,
    taskId: input.taskId,
    admissionId: input.admissionId,
    sessionDigest: input.projectTargetLease.authorityDigest,
    contextEpoch: input.actualInstructionEnvelope.contextEpoch,
    routeRevision: input.workflowRouteDecision.routeRevision,
    expectedOwner,
    targetSessionDigest: String(input.targetSessionDigest || '').toLowerCase() || null,
    handoffRefDigest: String(input.handoffRefDigest || '').toLowerCase() || null,
    takeoverRefDigest: String(input.takeoverRefDigest || '').toLowerCase() || null,
    terminalStatus: String(input.terminalStatus || '').trim() || null,
    terminalEvidence
  })
}

function buildOwnerTransitionRef(operation, currentOwner, input, committedAt) {
  const core = {
    schemaVersion: 'FencedTaskWriteOwnerTransitionRefV1',
    operation,
    priorLeaseDigest: currentOwner?.leaseDigest || null,
    requestDigest: ownerTransitionRequestDigest(operation, input),
    committedAt
  }
  return { ...core, refDigest: digest(core) }
}

function ownerTransitionReplayMatches(owner, operation, input) {
  const ref = owner?.transitionRef
  return ref?.operation === operation &&
    ref.requestDigest === ownerTransitionRequestDigest(operation, input) &&
    ref.priorLeaseDigest === (input.expectedOwner?.leaseDigest || null)
}

function finalizeAdmission(metaDir, identity, hostSessionDigest, transaction, nowMs, options = {}) {
  const finalized = nextTransaction(transaction, 'finalized', '', null, nowMs)
  const commit = commitTaskAdmissionTransaction({
    metaDir,
    identity,
    hostSessionDigest,
    transaction: finalized,
    expectedPreviousPhase: 'owner-fenced'
  }, { fs: options.fs || fs, nowMs, ...options.storeOptions })
  if (!['committed', 'semantic-noop'].includes(commit.status)) {
    throw new TaskAdmissionError(commit.errorCode || 'TASK_ADMISSION_FINALIZE_FAILED', commit.message || 'admission finalize failed', commit)
  }
  return finalized
}

function taskWriteOwnerReceipt(operation, transaction, owner, replayed = false, nowMs = Date.now()) {
  const finalized = transaction?.phase === 'finalized'
  const cpConfirmed = transaction?.effects?.cpState?.status === 'confirmed'
  const active = owner?.status === 'active' && Date.parse(owner.expiresAt) > nowMs
  return {
    schemaVersion: TASK_WRITE_OWNER_RECEIPT_SCHEMA,
    status: owner?.status || 'missing',
    operation,
    taskId: owner?.taskId || transaction?.taskId || null,
    admissionId: transaction?.admissionId || null,
    admissionGeneration: transaction?.admissionGeneration || null,
    continuationLease: transaction?.continuationLease ? clone(transaction.continuationLease) : null,
    owner: owner || null,
    ownerRef: owner ? ownerRef(owner) : null,
    finalized,
    cp1Confirmed: cpConfirmed,
    mutationAuthority: finalized && cpConfirmed && active,
    replayed
  }
}

function executeTaskWriteOwner(rawInput = {}, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const operation = String(rawInput.operation || '').trim()
  if (!['acquire', 'renew', 'release', 'handoff-prepare', 'handoff-accept', 'takeover-prepare', 'takeover-accept', 'reopen'].includes(operation)) {
    throw new TaskAdmissionError('TASK_WRITE_OWNER_OPERATION_INVALID', 'unsupported fenced task write owner operation')
  }
  const input = {
    ...rawInput,
    operation,
    activeRoot: path.resolve(String(rawInput.activeRoot || '')),
    project: String(rawInput.project || '').trim(),
    taskId: String(rawInput.taskId || '').trim().toLowerCase(),
    admissionId: String(rawInput.admissionId || '').trim()
  }
  validateAuthorityIngress(input, {
    nowMs,
    allowBindRoute: true
  })
  if (!UUID_RE.test(input.taskId) || !/^admission-[a-f0-9]{40}$/.test(input.admissionId)) {
    throw new TaskAdmissionError('TASK_WRITE_OWNER_TASK_INVALID', 'taskId and admissionId are required')
  }
  const identity = { activeRoot: input.activeRoot, project: input.project, taskId: input.taskId, taskStatus: 'active' }
  const metaDir = rawInput.metaDir || resolveTaskRecoveryMetaDir({ activeRoot: input.activeRoot, project: input.project })
  const admissionRead = readTaskAdmissionTransaction({ metaDir, identity }, { fs: fsImpl })
  if (admissionRead.status !== 'fresh' || admissionRead.transaction.admissionId !== input.admissionId) {
    throw new TaskAdmissionError(
      admissionRead.errorCode || 'TASK_ADMISSION_TRANSACTION_MISSING',
      'the exact admission transaction is unavailable for owner fencing'
    )
  }
  let transaction = admissionRead.transaction
  validateOwnerContinuation(transaction, input, operation, nowMs)
  const ownerRead = readFencedTaskWriteOwner({ metaDir, identity }, { fs: fsImpl })
  let currentOwner = ownerRead.status === 'fresh' ? ownerRead.owner : null
  const sessionDigest = input.projectTargetLease.authorityDigest
  const contextEpoch = input.actualInstructionEnvelope.contextEpoch
  const routeRevision = input.workflowRouteDecision.routeRevision
  const projectRootIdentity = input.projectTargetLease.rootIdentityDigest
  const faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : () => {}

  if (operation === 'acquire' && currentOwner?.status === 'released') {
    if (transaction.phase !== 'finalized' || !exactOwnerRefMatches(currentOwner, input.expectedOwner)) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_CAS_MISMATCH', 'reacquire requires the exact released owner ref and finalized admission')
    }
    transaction = refreshFinalizedCpObservation(transaction, input.activeRoot, nowMs, fsImpl)
    const issuedAt = new Date(nowMs).toISOString()
    const nextOwner = sealOwner({
      ...currentOwner,
      sessionDigest,
      contextEpoch,
      routeRevision,
      ownerGeneration: currentOwner.ownerGeneration + 1,
      ownerNonce: ownerNonce(options),
      leaseRevision: currentOwner.leaseRevision + 1,
      issuedAt,
      expiresAt: new Date(nowMs + WRITE_OWNER_LEASE_MS).toISOString(),
      handoffRef: null,
      takeoverRef: null,
      transitionRef: buildOwnerTransitionRef('acquire', currentOwner, input, issuedAt),
      status: 'active'
    })
    const commit = commitFencedTaskWriteOwnerTransition({
      metaDir,
      identity,
      hostSessionDigest: input.actualInstructionEnvelope.hostSessionDigest,
      expectedOwner: ownerRef(currentOwner),
      owner: nextOwner,
      transition: 'reacquire',
      transaction,
      expectedAdmissionPhase: 'finalized',
      reason: 'owner-reacquire'
    }, { fs: fsImpl, nowMs, ...options.storeOptions })
    if (!['committed', 'semantic-noop'].includes(commit.status)) {
      throw new TaskAdmissionError(commit.errorCode || 'TASK_WRITE_OWNER_COMMIT_FAILED', commit.message || 'owner reacquire failed', commit)
    }
    faultInjector('after-owner-reacquired', { owner: clone(nextOwner), transaction: clone(transaction) })
    return taskWriteOwnerReceipt(operation, transaction, nextOwner, false, nowMs)
  }

  if (operation === 'acquire' || operation === 'reopen') {
    if (currentOwner?.status === 'active' && currentOwner.sessionDigest === sessionDigest &&
        currentOwner.contextEpoch === contextEpoch && currentOwner.routeRevision === routeRevision &&
        ['owner-fenced', 'finalized'].includes(transaction.phase) &&
        ownerTransitionReplayMatches(currentOwner, operation, input)) {
      if (transaction.phase === 'owner-fenced') transaction = finalizeAdmission(metaDir, identity, input.actualInstructionEnvelope.hostSessionDigest, transaction, nowMs, { fs: fsImpl, ...options })
      return taskWriteOwnerReceipt(operation, transaction, currentOwner, true, nowMs)
    }
    const reopening = operation === 'reopen'
    if (transaction.phase !== 'cp-state-written') {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_ADMISSION_PHASE_INVALID', `owner ${operation} requires cp-state-written admission`)
    }
    if ((!reopening && currentOwner) || (reopening && currentOwner?.status !== 'terminal')) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_CONFLICT', reopening ? 'reopen requires a terminal owner fence' : 'another owner state already exists')
    }
    if (reopening && !exactOwnerRefMatches(currentOwner, input.expectedOwner)) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_CAS_MISMATCH', 'reopen requires the exact terminal owner ref')
    }
    if (reopening && transaction.admissionGeneration <= Number(ownerRead.terminalReceipt?.admissionGeneration || 0)) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_REOPEN_ADMISSION_STALE', 'reopen requires a newer admission generation')
    }
    const cp = observedCpState(transaction, input.activeRoot, fsImpl)
    const baseGeneration = currentOwner?.ownerGeneration || 0
    const baseRevision = currentOwner?.leaseRevision || 0
    const nextOwner = sealOwner({
      taskId: input.taskId,
      projectRootIdentity,
      sessionDigest,
      contextEpoch,
      routeRevision,
      ownerGeneration: baseGeneration + 1,
      ownerNonce: ownerNonce(options),
      leaseRevision: baseRevision + 1,
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + WRITE_OWNER_LEASE_MS).toISOString(),
      handoffRef: null,
      takeoverRef: null,
      transitionRef: buildOwnerTransitionRef(reopening ? 'reopen' : 'acquire', currentOwner, input, new Date(nowMs).toISOString()),
      reopenGeneration: reopening ? currentOwner.reopenGeneration + 1 : 0,
      revocationEpoch: currentOwner?.revocationEpoch || 0,
      status: 'active'
    })
    let ownerFenced = nextTransaction(transaction, 'owner-fenced', 'owner', {
      status: 'fenced',
      ownerGeneration: nextOwner.ownerGeneration,
      leaseDigest: nextOwner.leaseDigest
    }, nowMs)
    ownerFenced = consumeOwnerContinuation(ownerFenced, nextOwner, nowMs)
    ownerFenced.effects.cpState = {
      ...ownerFenced.effects.cpState,
      status: cp.cp1Confirmed ? 'confirmed' : 'pending',
      cp1Confirmed: cp.cp1Confirmed
    }
    ownerFenced.transactionDigest = taskAdmissionTransactionDigest(ownerFenced)
    const ownerCommit = commitFencedTaskWriteOwnerTransition({
      metaDir,
      identity,
      hostSessionDigest: input.actualInstructionEnvelope.hostSessionDigest,
      expectedOwner: currentOwner ? ownerRef(currentOwner) : { mode: 'absent' },
      owner: nextOwner,
      transition: reopening ? 'reopen' : 'acquire',
      transaction: ownerFenced,
      expectedAdmissionPhase: 'cp-state-written',
      reason: reopening ? 'owner-reopen' : 'owner-acquire'
    }, { fs: fsImpl, nowMs, ...options.storeOptions })
    if (!['committed', 'semantic-noop'].includes(ownerCommit.status)) {
      throw new TaskAdmissionError(ownerCommit.errorCode || 'TASK_WRITE_OWNER_COMMIT_FAILED', ownerCommit.message || 'owner fencing failed', ownerCommit)
    }
    currentOwner = nextOwner
    transaction = ownerFenced
    faultInjector('after-owner-fenced', { owner: clone(currentOwner), transaction: clone(transaction) })
    transaction = finalizeAdmission(metaDir, identity, input.actualInstructionEnvelope.hostSessionDigest, transaction, nowMs, { fs: fsImpl, ...options })
    faultInjector('after-admission-finalized', { owner: clone(currentOwner), transaction: clone(transaction) })
    return taskWriteOwnerReceipt(operation, transaction, currentOwner, false, nowMs)
  }

  if (!currentOwner || currentOwner.status === 'terminal') {
    throw new TaskAdmissionError('TASK_WRITE_OWNER_MISSING', 'an active or pending owner is required')
  }
  if (transaction.phase === 'finalized') {
    const replayed =
      (operation === 'renew' && currentOwner.status === 'active') ||
      (operation === 'release' && currentOwner.status === 'released') ||
      (operation === 'handoff-prepare' && currentOwner.status === 'handoff-pending' &&
        currentOwner.handoffRef?.targetSessionDigest === String(input.targetSessionDigest || '').toLowerCase()) ||
      (operation === 'takeover-prepare' && currentOwner.status === 'takeover-pending' &&
        currentOwner.takeoverRef?.targetSessionDigest === sessionDigest) ||
      (operation === 'handoff-accept' && currentOwner.status === 'active' &&
        currentOwner.handoffRef?.refDigest === input.handoffRefDigest &&
        currentOwner.sessionDigest === sessionDigest && currentOwner.contextEpoch === contextEpoch) ||
      (operation === 'takeover-accept' && currentOwner.status === 'active' &&
        currentOwner.takeoverRef?.refDigest === input.takeoverRefDigest &&
        currentOwner.sessionDigest === sessionDigest && currentOwner.contextEpoch === contextEpoch)
    if (replayed && ownerTransitionReplayMatches(currentOwner, operation, input)) {
      return taskWriteOwnerReceipt(operation, transaction, currentOwner, true, nowMs)
    }
  }
  if (!exactOwnerRefMatches(currentOwner, input.expectedOwner)) {
    throw new TaskAdmissionError('TASK_WRITE_OWNER_CAS_MISMATCH', 'stale owner generation, nonce, revision or digest')
  }
  if (transaction.phase !== 'finalized') {
    throw new TaskAdmissionError('TASK_WRITE_OWNER_ADMISSION_NOT_FINALIZED', 'owner transition requires finalized admission')
  }
  transaction = refreshFinalizedCpObservation(transaction, input.activeRoot, nowMs, fsImpl)
  const issuedAt = new Date(nowMs).toISOString()
  let nextOwner
  let transition = operation
  if (operation === 'renew') {
    if (currentOwner.status !== 'active' || currentOwner.sessionDigest !== sessionDigest ||
        currentOwner.projectRootIdentity !== projectRootIdentity || currentOwner.routeRevision !== routeRevision) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_SESSION_MISMATCH', 'only the current exact session/project/route owner may renew or rebind context')
    }
    const priorExpiryMs = Date.parse(currentOwner.expiresAt)
    const nextExpiryMs = Math.max(nowMs + WRITE_OWNER_LEASE_MS, priorExpiryMs + 1)
    nextOwner = sealOwner({
      ...currentOwner,
      contextEpoch,
      leaseRevision: currentOwner.leaseRevision + 1,
      issuedAt,
      expiresAt: new Date(nextExpiryMs).toISOString()
    })
  } else if (operation === 'release') {
    if (currentOwner.status !== 'active' || currentOwner.sessionDigest !== sessionDigest || currentOwner.contextEpoch !== contextEpoch) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_SESSION_MISMATCH', 'only the current exact session/context owner may release')
    }
    nextOwner = sealOwner({ ...currentOwner, ownerGeneration: currentOwner.ownerGeneration + 1, ownerNonce: ownerNonce(options), leaseRevision: currentOwner.leaseRevision + 1, issuedAt, expiresAt: issuedAt, revocationEpoch: currentOwner.revocationEpoch + 1, status: 'released' })
  } else if (operation === 'handoff-prepare') {
    const targetSessionDigest = String(input.targetSessionDigest || '').toLowerCase()
    if (currentOwner.status !== 'active' || currentOwner.sessionDigest !== sessionDigest || !DIGEST_RE.test(targetSessionDigest)) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_HANDOFF_INVALID', 'handoff prepare requires the active owner and exact target session digest')
    }
    const handoffCore = { schemaVersion: 'FencedTaskWriteOwnerHandoffRefV1', fromLeaseDigest: currentOwner.leaseDigest, targetSessionDigest, preparedAt: issuedAt }
    const handoffRef = { ...handoffCore, refDigest: digest(handoffCore) }
    nextOwner = sealOwner({ ...currentOwner, ownerGeneration: currentOwner.ownerGeneration + 1, ownerNonce: ownerNonce(options), leaseRevision: currentOwner.leaseRevision + 1, issuedAt, expiresAt: issuedAt, handoffRef, revocationEpoch: currentOwner.revocationEpoch + 1, status: 'handoff-pending' })
  } else if (operation === 'handoff-accept') {
    if (currentOwner.status !== 'handoff-pending' || currentOwner.handoffRef?.refDigest !== input.handoffRefDigest || currentOwner.handoffRef?.targetSessionDigest !== sessionDigest) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_HANDOFF_INVALID', 'handoff accept does not match the durable handoff target')
    }
    nextOwner = sealOwner({ ...currentOwner, sessionDigest, contextEpoch, routeRevision, ownerNonce: ownerNonce(options), leaseRevision: currentOwner.leaseRevision + 1, issuedAt, expiresAt: new Date(nowMs + WRITE_OWNER_LEASE_MS).toISOString(), status: 'active' })
  } else if (operation === 'takeover-prepare') {
    const observation = input.serverObservation || {}
    if (!['active', 'handoff-pending', 'takeover-pending'].includes(currentOwner.status) || Date.parse(currentOwner.expiresAt) > nowMs || observation.canonicalTaskReadback !== true || observation.noLiveTurn !== true || !DIGEST_RE.test(String(observation.reconcileReceiptDigest || ''))) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_TAKEOVER_INVALID', 'takeover requires expiry, canonical task readback, no live turn and a server-owned reconcile receipt')
    }
    const takeoverCore = { schemaVersion: 'FencedTaskWriteOwnerTakeoverRefV1', fromLeaseDigest: currentOwner.leaseDigest, targetSessionDigest: sessionDigest, reconcileReceiptDigest: observation.reconcileReceiptDigest, preparedAt: issuedAt }
    const takeoverRef = { ...takeoverCore, refDigest: digest(takeoverCore) }
    nextOwner = sealOwner({ ...currentOwner, sessionDigest, contextEpoch, routeRevision, ownerGeneration: currentOwner.ownerGeneration + 1, ownerNonce: ownerNonce(options), leaseRevision: currentOwner.leaseRevision + 1, issuedAt, expiresAt: issuedAt, handoffRef: null, takeoverRef, revocationEpoch: currentOwner.revocationEpoch + 1, status: 'takeover-pending' })
  } else if (operation === 'takeover-accept') {
    if (currentOwner.status !== 'takeover-pending' || currentOwner.takeoverRef?.refDigest !== input.takeoverRefDigest || currentOwner.takeoverRef?.targetSessionDigest !== sessionDigest) {
      throw new TaskAdmissionError('TASK_WRITE_OWNER_TAKEOVER_INVALID', 'takeover accept does not match the durable takeover target')
    }
    nextOwner = sealOwner({ ...currentOwner, sessionDigest, contextEpoch, routeRevision, ownerNonce: ownerNonce(options), leaseRevision: currentOwner.leaseRevision + 1, issuedAt, expiresAt: new Date(nowMs + WRITE_OWNER_LEASE_MS).toISOString(), status: 'active' })
  }
  nextOwner = sealOwner({
    ...nextOwner,
    transitionRef: buildOwnerTransitionRef(operation, currentOwner, input, issuedAt)
  })
  const commit = commitFencedTaskWriteOwnerTransition({
    metaDir,
    identity,
    hostSessionDigest: input.actualInstructionEnvelope.hostSessionDigest,
    expectedOwner: ownerRef(currentOwner),
    owner: nextOwner,
    transition,
    transaction,
    expectedAdmissionPhase: 'finalized',
    reason: operation === 'release' ? 'owner-release' : `owner-${operation}`
  }, { fs: fsImpl, nowMs, ...options.storeOptions })
  if (!['committed', 'semantic-noop'].includes(commit.status)) {
    throw new TaskAdmissionError(commit.errorCode || 'TASK_WRITE_OWNER_COMMIT_FAILED', commit.message || 'owner transition failed', commit)
  }
  return taskWriteOwnerReceipt(operation, transaction, nextOwner, false, nowMs)
}

function readStableEvidenceFile(activeRoot, taskRoot, evidence, fsImpl = fs) {
  const role = String(evidence?.role || '')
  const relative = String(evidence?.path || '').trim().replace(/\\/g, '/')
  if (!['ecr', 'report', 'memory', 'completion'].includes(role) || !relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_PATH_INVALID', `invalid ${role || 'unknown'} evidence path`)
  }
  const filePath = path.resolve(activeRoot, ...relative.split('/'))
  if (!isInside(activeRoot, filePath)) throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_PATH_INVALID', 'terminal evidence escapes activeRoot')
  if (role !== 'memory' && !isInside(taskRoot, filePath)) {
    throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_SCOPE_INVALID', `${role} evidence must be inside the canonical task root`)
  }
  if (role === 'report' && !isInside(path.join(taskRoot, 'reports'), filePath)) {
    throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_SCOPE_INVALID', 'report evidence must be inside the task reports directory')
  }
  if (role === 'memory' && !isInside(path.join(activeRoot, '.memory'), filePath) && !isInside(path.join(taskRoot, '.memory'), filePath)) {
    throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_SCOPE_INVALID', 'memory evidence must be in project or task memory')
  }
  assertExistingAncestorsSafe(activeRoot, filePath, fsImpl)
  let descriptor
  try {
    descriptor = fsImpl.openSync(filePath, 'r')
    const before = fsImpl.fstatSync(descriptor)
    if (!before.isFile() || before.size < 1 || before.size > 8 * 1024 * 1024) {
      throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_FILE_INVALID', `${role} evidence is not a bounded regular file`)
    }
    const bytes = fsImpl.readFileSync(descriptor)
    const after = fsImpl.fstatSync(descriptor)
    const current = fsImpl.lstatSync(filePath)
    if (!current.isFile() || current.isSymbolicLink() || !sameStableFileStat(before, after) ||
        !sameStableFileStat(after, current) || bytes.length !== after.size) {
      throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_FILE_DRIFT', `${role} evidence changed during readback`)
    }
    const observedDigest = sha256(bytes)
    if (observedDigest !== String(evidence.sha256 || '').toLowerCase() || before.size !== Number(evidence.bytes)) {
      throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_DIGEST_MISMATCH', `${role} evidence identity does not match`)
    }
    return { role, path: relative, sha256: observedDigest, bytes: before.size }
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor)
  }
}

function executeWorkflowTaskTerminal(rawInput = {}, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const input = {
    ...rawInput,
    activeRoot: path.resolve(String(rawInput.activeRoot || '')),
    project: String(rawInput.project || '').trim(),
    taskId: String(rawInput.taskId || '').trim().toLowerCase(),
    admissionId: String(rawInput.admissionId || '').trim(),
    terminalStatus: String(rawInput.terminalStatus || '').trim()
  }
  validateAuthorityIngress(input, { nowMs, allowBindRoute: true })
  if (!UUID_RE.test(input.taskId) || !/^admission-[a-f0-9]{40}$/.test(input.admissionId) || !['completed', 'rejected', 'cancelled', 'failed'].includes(input.terminalStatus)) {
    throw new TaskAdmissionError('TASK_TERMINAL_INPUT_INVALID', 'taskId, admissionId and terminalStatus are required')
  }
  const activeIdentity = { activeRoot: input.activeRoot, project: input.project, taskId: input.taskId, taskStatus: 'active' }
  const terminalIdentity = { ...activeIdentity, taskStatus: input.terminalStatus === 'rejected' ? 'rejected' : 'completed' }
  const metaDir = rawInput.metaDir || resolveTaskRecoveryMetaDir({ activeRoot: input.activeRoot, project: input.project })
  const ownerRead = readFencedTaskWriteOwner({ metaDir, identity: activeIdentity }, { fs: fsImpl })
  if (ownerRead.status !== 'fresh') throw new TaskAdmissionError(ownerRead.errorCode || 'TASK_WRITE_OWNER_MISSING', 'terminal closeout requires a durable owner')
  if (ownerRead.owner.status === 'terminal' && ownerRead.terminalReceipt) {
    if (ownerRead.terminalReceipt.admissionId !== input.admissionId ||
        !ownerTransitionReplayMatches(ownerRead.owner, 'terminal', input)) {
      throw new TaskAdmissionError(
        'TASK_TERMINAL_REPLAY_MISMATCH',
        'terminal replay requires the exact prior owner, session, context, route, status and evidence request'
      )
    }
    return {
      schemaVersion: 'WorkflowTaskTerminalResultV1',
      status: 'terminal',
      receipt: ownerRead.terminalReceipt,
      persistence: ownerRead.source,
      replayed: true,
      mutationAuthority: false
    }
  }
  const currentOwner = ownerRead.owner
  const transaction = ownerRead.transaction
  if (!transaction || transaction.phase !== 'finalized' || transaction.admissionId !== input.admissionId ||
      currentOwner.status !== 'active' || !exactOwnerRefMatches(currentOwner, input.expectedOwner) ||
      currentOwner.sessionDigest !== input.projectTargetLease.authorityDigest || currentOwner.contextEpoch !== input.actualInstructionEnvelope.contextEpoch) {
    throw new TaskAdmissionError('TASK_TERMINAL_OWNER_MISMATCH', 'terminal closeout requires the exact finalized active owner')
  }
  if (input.terminalStatus === 'completed' &&
      (transaction.effects?.cpState?.status !== 'confirmed' || transaction.effects?.cpState?.cp1Confirmed !== true)) {
    throw new TaskAdmissionError(
      'TASK_TERMINAL_CP_CONFIRMATION_REQUIRED',
      'completed terminal closeout requires a verified CP1 confirmation'
    )
  }
  const taskRoot = path.join(input.activeRoot, ...transaction.taskRootRelative.split('/'))
  const evidenceInputs = Array.isArray(input.evidence) ? input.evidence : []
  if (evidenceInputs.length !== 4) {
    throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_INCOMPLETE', 'terminal closeout requires exactly four evidence identities')
  }
  const evidence = evidenceInputs.map(item => readStableEvidenceFile(input.activeRoot, taskRoot, item, fsImpl))
  if (new Set(evidence.map(item => item.role)).size !== 4 || !['ecr', 'report', 'memory', 'completion'].every(role => evidence.some(item => item.role === role))) {
    throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_INCOMPLETE', 'terminal closeout requires exact ECR, report, memory and completion evidence')
  }
  const evidencePathKeys = evidence.map(item => process.platform === 'win32' ? item.path.toLowerCase() : item.path)
  if (new Set(evidencePathKeys).size !== evidence.length) {
    throw new TaskAdmissionError('TASK_TERMINAL_EVIDENCE_DUPLICATE', 'each terminal evidence role requires a distinct file identity')
  }
  const issuedAt = new Date(nowMs).toISOString()
  const terminalOwner = sealOwner({
    ...currentOwner,
    ownerGeneration: currentOwner.ownerGeneration + 1,
    ownerNonce: ownerNonce(options),
    leaseRevision: currentOwner.leaseRevision + 1,
    issuedAt,
    expiresAt: issuedAt,
    revocationEpoch: currentOwner.revocationEpoch + 1,
    transitionRef: buildOwnerTransitionRef('terminal', currentOwner, input, issuedAt),
    status: 'terminal'
  })
  const terminalTransaction = nextTransaction(transaction, 'terminal-closeout', 'owner', {
    status: 'terminal',
    ownerGeneration: terminalOwner.ownerGeneration,
    leaseDigest: terminalOwner.leaseDigest
  }, nowMs)
  const terminalReceipt = {
    schemaVersion: WORKFLOW_TASK_TERMINAL_RECEIPT_SCHEMA,
    taskId: input.taskId,
    admissionId: transaction.admissionId,
    admissionGeneration: transaction.admissionGeneration,
    projectRootIdentity: transaction.projectRootIdentityDigest,
    priorOwnerLeaseDigest: currentOwner.leaseDigest,
    terminalOwnerLeaseDigest: terminalOwner.leaseDigest,
    admissionTransactionDigest: terminalTransaction.transactionDigest,
    ownerGeneration: terminalOwner.ownerGeneration,
    terminalGeneration: terminalOwner.ownerGeneration,
    terminalStatus: input.terminalStatus,
    evidence,
    issuedAt
  }
  terminalReceipt.receiptDigest = workflowTaskTerminalReceiptDigest(terminalReceipt)
  const commit = commitFencedTaskWriteOwnerTransition({
    metaDir,
    identity: terminalIdentity,
    hostSessionDigest: input.actualInstructionEnvelope.hostSessionDigest,
    expectedOwner: ownerRef(currentOwner),
    owner: terminalOwner,
    transition: 'terminal',
    transaction: terminalTransaction,
    expectedAdmissionPhase: 'finalized',
    terminalReceipt,
    reason: 'terminal-closeout'
  }, { fs: fsImpl, nowMs, ...options.storeOptions })
  if (!['committed', 'semantic-noop', 'closeout-reserved'].includes(commit.status)) {
    throw new TaskAdmissionError(commit.errorCode || 'TASK_TERMINAL_CLOSEOUT_FAILED', commit.message || 'terminal closeout failed', commit)
  }
  return {
    schemaVersion: 'WorkflowTaskTerminalResultV1',
    status: commit.status === 'closeout-reserved' ? 'terminal-closeout-reserved' : 'terminal',
    receipt: terminalReceipt,
    owner: terminalOwner,
    transaction: terminalTransaction,
    persistence: commit.status,
    reserveSequence: commit.sequence || null,
    replayed: false,
    mutationAuthority: false
  }
}

function reconcileWorkflowTaskTerminal(rawInput = {}, options = {}) {
  const identity = {
    activeRoot: path.resolve(String(rawInput.activeRoot || '')),
    project: String(rawInput.project || '').trim(),
    taskId: String(rawInput.taskId || '').trim().toLowerCase(),
    taskStatus: 'completed'
  }
  const metaDir = rawInput.metaDir || resolveTaskRecoveryMetaDir(identity)
  return reconcileEmergencyTaskCloseout({
    metaDir,
    identity,
    hostSessionDigest: rawInput.hostSessionDigest || rawInput.sessionKey || ''
  }, options)
}

module.exports = {
  ADMISSION_POLICY_REVISION,
  FORMAL_ADMISSION_RECEIPT_SCHEMA,
  FENCED_TASK_WRITE_OWNER_SCHEMA,
  PROJECT_TARGET_LEASE_SCHEMA,
  TASK_DIRECTORY_DECISION_SCHEMA,
  TASK_IDENTITY_V2_SCHEMA,
  TASK_ADMISSION_REQUEST_DIGEST_SCHEMA,
  TASK_WRITE_OWNER_RECEIPT_SCHEMA,
  TASK_KINDS,
  TaskAdmissionError,
  WORKFLOW_TASK_TERMINAL_RECEIPT_SCHEMA,
  computeProjectTargetAdmissionBindingDigest,
  computeProjectTargetLeaseDigest,
  createIngressIdempotencyKey,
  createTaskIdentityV2,
  decideTaskDirectory,
  deterministicTaskId,
  executeTaskAdmission,
  recoverTaskAdmissionTransaction,
  executeTaskWriteOwner,
  executeWorkflowTaskTerminal,
  reconcileWorkflowTaskTerminal,
  validateProjectTargetLease
}
