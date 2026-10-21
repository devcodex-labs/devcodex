'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  sealTaskOperationRecord, taskOperationRef,
  taskOperationSettledSetDigest, validateTaskOperationSet
} = require('./lifecycle-turn-liveness.cjs')
const { inspectTarget, readLayeredArtifactSlotRegistry } = require('./artifact-slot-decision.cjs')
const { currentStateRecoveryDigest, validateCurrentStateRecoveryReceipt } = require('./task-operation-current-state-receipt.cjs')
const { digest: instructionDigest } = require('./actual-instruction-envelope.cjs')

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function canonicalReportSnapshot(file, taskRoot, projectRegistry = null) {
  const relative = path.relative(taskRoot, file)
  if (path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) ||
      (!projectRegistry && !/^reports\/(?:codex|claude-code|copilot|gemini|grok|cursor)\/\d{8}\/\d{2}--[^/]+\.md$/u.test(relative.split(path.sep).join('/')))) {
    fail('TASK_OPERATION_RECOVERY_REPORT_ONLY', 'current-state recovery is restricted to exact task report Markdown files')
  }
  if (projectRegistry) {
    const target = inspectTarget(file, { activeRoot: taskRoot, projectRoot: taskRoot }, projectRegistry)
    if (target.status !== 'inside' || target.classified?.slot?.slotId !== 'project-report' ||
        target.classified?.slot?.scope !== 'project' || !relative.split(path.sep).join('/').startsWith('reports/') ||
        !/\/\d{8}\/\d{2}--[^/]+\.md$/u.test(relative.split(path.sep).join('/'))) {
      fail('TASK_OPERATION_RECOVERY_REPORT_ONLY', 'taskless recovery is restricted to exact project report slots')
    }
  }
  return canonicalFileSnapshot(file, taskRoot)
}

// A snapshot accepts present bytes only; it never reconstructs a lost tool exit.
function canonicalFileSnapshot(file, taskRoot) {
  const relative = path.relative(taskRoot, file)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    fail('TASK_OPERATION_RECOVERY_PATH_OUTSIDE_ROOT', 'the exact file must be inside its physical root')
  }
  const parts = relative.split(path.sep)
  let parent = taskRoot
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part)
    if (fs.lstatSync(parent).isSymbolicLink()) fail('TASK_OPERATION_RECOVERY_SYMLINK', 'report parents must not be symlinks')
  }
  const physical = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (physical(fs.realpathSync(taskRoot)) !== physical(path.resolve(taskRoot)) ||
      physical(fs.realpathSync(file)) !== physical(path.resolve(file)) || fs.lstatSync(file).isSymbolicLink()) {
    fail('TASK_OPERATION_RECOVERY_SYMLINK', 'the exact task/report path must be physical')
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const before = fs.fstatSync(fd, { bigint: true })
    if (!before.isFile() || before.size > 256 * 1024) fail('TASK_OPERATION_RECOVERY_SIZE', 'only bounded regular reports can be observed')
    const buffer = Buffer.alloc(Number(before.size) + 1)
    let total = 0
    while (total < buffer.length) {
      const count = fs.readSync(fd, buffer, total, buffer.length - total, null)
      if (!count) break
      total += count
    }
    const bytes = buffer.subarray(0, total)
    if (total !== Number(before.size) || physical(fs.realpathSync(file)) !== physical(path.resolve(file))) {
      fail('TASK_OPERATION_RECOVERY_FILE_DRIFT', 'report size or physical path changed during observation')
    }
    const after = fs.fstatSync(fd, { bigint: true })
    // Windows Node 22.12 path stat may report dev=0. Compare two opened
    // handles instead, retaining both object identity and path replacement checks.
    const currentFd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    try {
      const current = fs.fstatSync(currentFd, { bigint: true })
      if (fs.lstatSync(file).isSymbolicLink() || physical(fs.realpathSync(file)) !== physical(path.resolve(file))) {
        fail('TASK_OPERATION_RECOVERY_SYMLINK', 'the observed file path must remain physical')
      }
      for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
        if (before[key] !== after[key] || after[key] !== current[key]) fail('TASK_OPERATION_RECOVERY_FILE_DRIFT', 'file changed during current-state observation')
      }
    } finally { fs.closeSync(currentFd) }
    return { path: path.resolve(file), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  } finally { fs.closeSync(fd) }
}

/**
 * Inspect one admitted unknown source operation without acquiring write authority.
 * Expired leases may describe lost effects, but another session/owner may not accept them.
 */
function inspectCurrentSourceState(input) {
  const state = input.state
  const validation = validateTaskOperationSet(state?.turnLiveness?.taskOperationSet)
  const operation = validation.set.unresolved
  if (!validation.valid || !operation || operation.operationId !== input.operationId || operation.effect !== 'unknown' ||
      !['dispatched', 'reconcile-required'].includes(operation.phase)) {
    fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'one exact unknown source operation is required')
  }
  if (state.turnLiveness.inFlightOperation || state.turnLiveness.lastMutationCloseout?.result === 'needs-reconcile') {
    fail('TASK_OPERATION_RECOVERY_CLOSEOUT_REQUIRED', 'existing in-flight/closeout recovery takes precedence')
  }
  const owner = state.fencedWriteOwner
  const { validateFencedTaskWriteOwner } = require('./task-recovery-store-v5.cjs')
  const activeRoot = path.resolve(input.activeRoot)
  const taskRoot = path.resolve(activeRoot, String(state.admissionTransaction?.taskRootRelative || ''))
  const taskRelative = path.relative(activeRoot, taskRoot).split(path.sep).join('/')
  const sourceRoot = path.resolve(input.projectRoot)
  const samePath = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() : path.resolve(a)) ===
    (process.platform === 'win32' ? path.resolve(b).toLowerCase() : path.resolve(b))
  if (!input.taskId || state.taskRecoveryBinding?.taskId !== input.taskId ||
      state.admissionTransaction?.taskId !== input.taskId ||
      !/^(?:bugs|requirements|optimizations)\/[^/]+$/u.test(taskRelative) ||
      state.admissionTransaction.taskRootRelative !== taskRelative ||
      (state.taskRecoveryBinding.taskRoot && !samePath(state.taskRecoveryBinding.taskRoot, taskRoot)) ||
      state.activeProject !== input.project || !state.stickyProject?.physicalRoot ||
      !samePath(state.stickyProject.physicalRoot, sourceRoot) ||
      state.stickyProject.rootIdentityDigest !== input.projectRootIdentityDigest ||
      state.admissionTransaction.projectRootIdentityDigest !== input.projectRootIdentityDigest) {
    fail('TASK_OPERATION_RECOVERY_TASK_MISMATCH', 'source recovery requires the exact admitted task and project root')
  }
  if (!validateFencedTaskWriteOwner(owner, { activeRoot, project: input.project, taskId: input.taskId }).valid ||
      owner.status !== 'active' || owner.sessionDigest !== input.hostSessionDigest ||
      owner.projectRootIdentity !== input.projectRootIdentityDigest) {
    fail('TASK_OPERATION_RECOVERY_OWNER_MISMATCH', 'source recovery must bind the original active owner/session')
  }
  if (!operation.exactTargets.length || operation.exactTargets.length > 2 ||
      !['create', 'update', 'append', 'edit', 'create-or-update'].includes(operation.kind)) {
    fail('TASK_OPERATION_RECOVERY_SOURCE_SCOPE', 'only bounded existing source-file edits can recover')
  }
  const observations = operation.exactTargets.map(file => {
    const relative = path.relative(sourceRoot, file)
    if (!path.isAbsolute(file) || !relative || path.isAbsolute(relative) || relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        relative.split(path.sep).some(part => ['.git', '.devcodex', 'node_modules'].includes(part.toLowerCase()))) {
      fail('TASK_OPERATION_RECOVERY_SOURCE_SCOPE', 'source targets cannot escape the project or address managed state')
    }
    if (fs.lstatSync(file, { bigint: true }).nlink !== 1n) {
      fail('TASK_OPERATION_RECOVERY_SOURCE_ALIAS', 'source recovery does not accept hard-linked files')
    }
    return canonicalFileSnapshot(path.resolve(file), sourceRoot)
  })
  return { schemaVersion: 'TaskOperationCurrentSourceStateProposalV1', project: input.project, taskId: input.taskId,
    sourceRoot, projectRootIdentityDigest: input.projectRootIdentityDigest, ownerBindingDigest: owner.leaseDigest,
    operationId: operation.operationId, expectedOperationDigest: operation.recordDigest,
    idempotencyKey: operation.idempotencyKey, observations, historicalEffect: 'unknown', mutationAuthority: false }
}

/** Reobserve accepted bytes under the V5 transaction lock before producing a source receipt. */
function observeCurrentSourceState(input, options = {}) {
  const proposal = inspectCurrentSourceState(input)
  for (const key of ['expectedOperationDigest', 'idempotencyKey', 'ownerBindingDigest']) {
    if (proposal[key] !== input[key]) fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'source operation or owner changed')
  }
  const expected = input.observations
  if (!Array.isArray(expected) || expected.length !== proposal.observations.length ||
      proposal.observations.some(entry => !expected.some(item => item && item.path === entry.path &&
        item.sha256 === entry.sha256 && item.bytes === entry.bytes))) {
    fail('TASK_OPERATION_RECOVERY_SNAPSHOT_MISMATCH', 'accept the exact inspected source hashes and sizes')
  }
  const receipt = { schemaVersion: 'TaskOperationCurrentSourceStateReceiptV1', resolution: 'accept-current-source-state',
    project: proposal.project, taskId: proposal.taskId, sourceRoot: proposal.sourceRoot,
    projectRootIdentityDigest: proposal.projectRootIdentityDigest, ownerBindingDigest: proposal.ownerBindingDigest,
    operationId: proposal.operationId, idempotencyKey: proposal.idempotencyKey,
    priorRecordDigest: proposal.expectedOperationDigest, entries: proposal.observations,
    ingressEnvelopeDigest: input.ingressEnvelopeDigest, hostSessionDigest: input.hostSessionDigest,
    historicalEffect: 'unknown', mutationAuthority: false,
    observedAt: new Date(options.nowMs ?? Date.now()).toISOString() }
  receipt.recoveryDigest = currentStateRecoveryDigest(receipt)
  if (!validateCurrentStateRecoveryReceipt(receipt).valid) fail('TASK_OPERATION_RECOVERY_RECEIPT_INVALID', 'source receipt is invalid')
  return receipt
}

/** Commit only the matching inspected source operation; the caller owns the V5 CAS transaction. */
function applyCurrentSourceStateRecovery(state, receipt) {
  const current = validateTaskOperationSet(state?.turnLiveness?.taskOperationSet).set.unresolved
  if (receipt?.schemaVersion !== 'TaskOperationCurrentSourceStateReceiptV1' ||
      !validateCurrentStateRecoveryReceipt(receipt, { project: state.activeProject,
        sourceRoot: state.stickyProject?.physicalRoot && path.resolve(state.stickyProject.physicalRoot),
        projectRootIdentityDigest: state.admissionTransaction?.projectRootIdentityDigest,
        ownerBindingDigest: state.fencedWriteOwner?.leaseDigest, idempotencyKey: current?.idempotencyKey }).valid ||
      state.fencedWriteOwner?.sessionDigest !== receipt.hostSessionDigest ||
      receipt.entries.length !== current?.exactTargets.length ||
      receipt.entries.some(entry => !current.exactTargets.some(target => path.resolve(target) === entry.path))) {
    fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'source recovery scope changed before commit')
  }
  return applyCurrentStateRecovery(state, receipt)
}

function inspectCurrentReportState(input) {
  const state = input.state
  const validation = validateTaskOperationSet(state?.turnLiveness?.taskOperationSet)
  const operation = validation.set.unresolved
  if (!validation.valid || !operation || (input.operationId && operation.operationId !== input.operationId) || operation.effect !== 'unknown' ||
      !['dispatched', 'reconcile-required'].includes(operation.phase)) {
    fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'the exact valid unknown operation is required')
  }
  if (state.turnLiveness.inFlightOperation || state.turnLiveness.lastMutationCloseout?.result === 'needs-reconcile') {
    fail('TASK_OPERATION_RECOVERY_CLOSEOUT_REQUIRED', 'in-flight or failed-closeout operations must use their existing closeout recovery')
  }
  const binding = state.taskRecoveryBinding
  const admission = state.admissionTransaction
  const active = path.resolve(input.activeRoot)
  const projectScope = !input.taskId
  const root = projectScope ? active : path.resolve(active, String(admission?.taskRootRelative || ''))
  const relative = path.relative(active, root).split(path.sep).join('/')
  if (projectScope) {
    if (binding || admission || state.activeProject !== input.project ||
        state.stickyProject?.rootIdentityDigest !== input.projectRootIdentityDigest) {
      fail('TASK_OPERATION_RECOVERY_PROJECT_MISMATCH', 'taskless recovery requires the exact current project binding and no formal task')
    }
  } else if (!binding || binding.taskId !== input.taskId || admission?.taskId !== input.taskId ||
      (binding.taskRoot && path.resolve(binding.taskRoot) !== root) ||
      !/^(?:bugs|requirements|optimizations)\/[^/]+$/u.test(relative) ||
      admission.taskRootRelative !== relative ||
      admission.projectRootIdentityDigest !== input.projectRootIdentityDigest) {
    fail('TASK_OPERATION_RECOVERY_TASK_MISMATCH', 'current ingress must bind the exact admitted physical task root')
  }
  if (!operation.exactTargets.length || operation.exactTargets.length > 2 ||
      operation.exactTargets.some(file => !path.isAbsolute(file))) {
    fail('TASK_OPERATION_RECOVERY_REPORT_ONLY', 'only one or two exact physical report targets can recover')
  }
  const registry = projectScope ? readLayeredArtifactSlotRegistry({ activeRoot: active, project: input.project }) : null
  const entries = operation.exactTargets.map(file => canonicalReportSnapshot(path.resolve(file), root, registry))
  return { schemaVersion: 'TaskOperationCurrentReportStateProposalV1', taskId: input.taskId || null,
    operationId: operation.operationId, expectedOperationDigest: operation.recordDigest,
    observations: entries, historicalEffect: 'unknown', mutationAuthority: false }
}

function observeCurrentReportState(input, options = {}) {
  const proposal = inspectCurrentReportState(input)
  if (proposal.operationId !== input.operationId || proposal.expectedOperationDigest !== input.expectedOperationDigest) {
    fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'the exact operation record digest must match the accepted proposal')
  }
  const entries = proposal.observations
  const expected = input.observations
  if (entries.length > 2 || !Array.isArray(expected) || expected.length !== entries.length ||
      entries.some(entry => !expected.some(wanted => wanted && typeof wanted.path === 'string' && path.resolve(wanted.path) === entry.path &&
        wanted.sha256 === entry.sha256 && wanted.bytes === entry.bytes))) {
    fail('TASK_OPERATION_RECOVERY_SNAPSHOT_MISMATCH', 'caller must accept the exact current report hashes and byte counts')
  }
  const receipt = {
    schemaVersion: input.taskId ? 'TaskOperationCurrentReportStateReceiptV1' : 'TaskOperationCurrentReportStateReceiptV2',
    ...(!input.taskId ? { scope: 'project', project: input.project } : {}),
    resolution: 'accept-current-report-state', operationId: proposal.operationId,
    priorRecordDigest: proposal.expectedOperationDigest, historicalEffect: 'unknown',
    taskId: input.taskId || null, projectRootIdentityDigest: input.projectRootIdentityDigest,
    ingressEnvelopeDigest: input.ingressEnvelopeDigest, hostSessionDigest: input.hostSessionDigest,
    entries, observedAt: new Date(options.nowMs ?? Date.now()).toISOString(), mutationAuthority: false
  }
  receipt.recoveryDigest = currentStateRecoveryDigest(receipt)
  if (!validateCurrentStateRecoveryReceipt(receipt).valid) fail('TASK_OPERATION_RECOVERY_RECEIPT_INVALID', 'current report recovery receipt is invalid')
  return receipt
}

function applyCurrentReportStateRecovery(state, receipt) {
  if (!['TaskOperationCurrentReportStateReceiptV1', 'TaskOperationCurrentReportStateReceiptV2'].includes(receipt?.schemaVersion)) {
    fail('TASK_OPERATION_RECOVERY_RECEIPT_INVALID', 'the report recovery path only accepts report receipts')
  }
  return applyCurrentStateRecovery(state, receipt)
}

function applyCurrentStateRecovery(state, receipt) {
  const validation = validateTaskOperationSet(state.turnLiveness?.taskOperationSet)
  const current = validation.set.unresolved
  if ((receipt?.scope === 'project' && (state.taskRecoveryBinding || state.admissionTransaction)) ||
      !validation.valid || !current || !validateCurrentStateRecoveryReceipt(receipt, {
    operationId: current.operationId, priorRecordDigest: current.recordDigest,
    taskId: state.taskRecoveryBinding?.taskId || null,
    ...(receipt?.scope === 'project' ? { project: state.activeProject, projectRootIdentityDigest: state.stickyProject?.rootIdentityDigest } : {})
  }).valid || current.effect !== 'unknown' || state.turnLiveness.inFlightOperation) {
    fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'unknown operation changed before recovery commit')
  }
  const record = sealTaskOperationRecord({ ...current, phase: 'settled', effect: 'accepted-current-state',
    observedAt: receipt.observedAt, settledAt: receipt.observedAt,
    evidenceDigest: receipt.recoveryDigest, currentStateRecovery: receipt })
  const set = validation.set
  set.unresolved = null
  set.settled = [...set.settled, taskOperationRef(record)].slice(-64)
  set.settledSetDigest = taskOperationSettledSetDigest(set.settled)
  state.turnLiveness.taskOperationSet = set
  state.turnLiveness.lastTaskOperationRecord = record
  return state
}

// Rich lifecycle files are derived projections. Carry only already validated,
// same-project/session recovery receipts from canonical V5 into a stale view;
// never discard an unrelated unknown or manufacture a successful old effect.
function restoreTasklessReportRecoveryFromCanonical(state, canonical) {
  if (!state || !canonical || state.taskRecoveryBinding || canonical.taskRecoveryBinding ||
      state.admissionTransaction || canonical.admissionTransaction || state.fencedWriteOwner || canonical.fencedWriteOwner) return state
  const project = state.activeProject
  const rootDigest = state.stickyProject?.rootIdentityDigest
  const sessionId = String(state.contextAcquisition?.hostSessionId || '').trim()
  const canonicalSessionId = String(canonical.contextAcquisition?.hostSessionId || '').trim()
  const sessionDigest = sessionId ? instructionDigest(sessionId) : ''
  const root = state.contextAcquisition?.activeRoot
  const canonicalRoot = canonical.contextAcquisition?.activeRoot
  if (!project || project !== canonical.activeProject || !rootDigest ||
      rootDigest !== canonical.stickyProject?.rootIdentityDigest || !sessionDigest ||
      sessionId !== canonicalSessionId ||
      (state.actualInstructionEnvelope?.hostSessionDigest && state.actualInstructionEnvelope.hostSessionDigest !== sessionDigest) ||
      (canonical.actualInstructionEnvelope?.hostSessionDigest && canonical.actualInstructionEnvelope.hostSessionDigest !== sessionDigest) ||
      !root || !canonicalRoot ||
      path.resolve(root) !== path.resolve(canonicalRoot)) return state
  if (state.turnLiveness?.taskOperationSet?.schemaVersion !== 'TaskOperationSetV1' ||
      canonical.turnLiveness?.taskOperationSet?.schemaVersion !== 'TaskOperationSetV1') return state
  const source = validateTaskOperationSet(canonical.turnLiveness.taskOperationSet)
  if (!source.valid || !validateTaskOperationSet(state.turnLiveness.taskOperationSet).valid) return state
  for (const ref of source.set.settled) {
    const receipt = ref.currentStateRecovery
    if (ref.effect !== 'accepted-current-state' || receipt?.schemaVersion !== 'TaskOperationCurrentReportStateReceiptV2' ||
        receipt.hostSessionDigest !== sessionDigest || !validateCurrentStateRecoveryReceipt(receipt, {
          taskId: null, project, projectRootIdentityDigest: rootDigest, operationId: ref.operationId
        }).valid) continue
    const current = validateTaskOperationSet(state.turnLiveness.taskOperationSet).set
    if (current.unresolved?.operationId === ref.operationId) {
      if (current.unresolved.recordDigest !== receipt.priorRecordDigest || state.turnLiveness.inFlightOperation) continue
      applyCurrentReportStateRecovery(state, receipt)
      continue
    }
    const existing = current.settled.find(item => item.operationId === ref.operationId)
    if (existing) {
      if (existing.recordDigest !== ref.recordDigest) {
        fail('TASK_OPERATION_RECOVERY_PROJECTION_CONFLICT', 'derived operation history conflicts with canonical recovery')
      }
      continue
    }
    current.settled = [...current.settled, ref].slice(-64)
    current.settledSetDigest = taskOperationSettledSetDigest(current.settled)
    state.turnLiveness.taskOperationSet = current
  }
  return state
}

module.exports = { inspectCurrentReportState, observeCurrentReportState, applyCurrentReportStateRecovery,
  inspectCurrentSourceState, observeCurrentSourceState, applyCurrentSourceStateRecovery,
  restoreTasklessReportRecoveryFromCanonical }
