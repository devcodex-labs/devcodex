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
    const before = fs.fstatSync(fd)
    if (!before.isFile() || before.size > 256 * 1024) fail('TASK_OPERATION_RECOVERY_SIZE', 'only bounded regular reports can be observed')
    const buffer = Buffer.alloc(before.size + 1)
    let total = 0
    while (total < buffer.length) {
      const count = fs.readSync(fd, buffer, total, buffer.length - total, null)
      if (!count) break
      total += count
    }
    const bytes = buffer.subarray(0, total)
    if (total !== before.size || physical(fs.realpathSync(file)) !== physical(path.resolve(file))) {
      fail('TASK_OPERATION_RECOVERY_FILE_DRIFT', 'report size or physical path changed during observation')
    }
    const after = fs.fstatSync(fd)
    const current = fs.lstatSync(file)
    for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
      if (before[key] !== after[key] || after[key] !== current[key]) fail('TASK_OPERATION_RECOVERY_FILE_DRIFT', 'report changed during current-state observation')
    }
    return { path: path.resolve(file), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  } finally { fs.closeSync(fd) }
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

module.exports = { inspectCurrentReportState, observeCurrentReportState, applyCurrentReportStateRecovery }
