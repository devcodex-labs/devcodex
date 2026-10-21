#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { digestSessionRef } = require('../hooks/_runtime/workspace-session-route-index-v1.cjs')
const { readFencedTaskWriteOwner, readTaskRecoveryState, resolveTaskRecoveryMetaDir,
  updateTaskRecoveryState } = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const { taskOperationTerminalSnapshot, validateTaskOperationSet } = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')
const { validateCurrentStateRecoveryReceipt } = require('../hooks/_runtime/task-operation-current-state-receipt.cjs')
const { inspectCurrentSourceState, observeCurrentSourceState,
  applyCurrentSourceStateRecovery } = require('../hooks/_runtime/task-operation-current-state-recovery.cjs')

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

/** Parse the explicit maintenance command; never consume another option as a value. */
function parseArgs(argv) {
  const result = {}
  const names = { '--active-root': 'activeRoot', '--project': 'project', '--task-id': 'taskId',
    '--session-id': 'sessionId', '--operation-id': 'operationId', '--accept': 'proposalPath', '--output': 'output' }
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]
    if (name === '--inspect') {
      if (result.inspect) fail('SOURCE_RECOVERY_ARGUMENT', 'duplicate --inspect')
      result.inspect = true
      continue
    }
    const key = names[name]
    if (!key || result[key] || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      fail('SOURCE_RECOVERY_ARGUMENT', `unknown, duplicate or missing argument: ${name}`)
    }
    result[key] = argv[++index]
  }
  if (!result.activeRoot || !result.project || !result.taskId || !result.sessionId ||
      Boolean(result.inspect) === Boolean(result.proposalPath) || (result.inspect && !result.operationId)) {
    fail('SOURCE_RECOVERY_ARGUMENT', 'require active root, project, task, session and exactly one inspect/accept mode')
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(result.project) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.taskId)) {
    fail('SOURCE_RECOVERY_ARGUMENT', 'invalid project or task identity')
  }
  return result
}

function readProposal(file) {
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256 * 1024) {
    fail('SOURCE_RECOVERY_PROPOSAL', 'proposal must be a bounded regular JSON file')
  }
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  return value.proposal || value
}

/** Recover through the existing canonical transaction owner without editing source files or leasing a new writer. */
function recoverSourceOperation(args) {
  const activeRoot = path.resolve(args.activeRoot)
  const identity = { activeRoot, project: args.project, taskId: args.taskId.toLowerCase(), taskStatus: 'active' }
  const hostSessionDigest = digestSessionRef(args.sessionId)
  const storeInput = { metaDir: resolveTaskRecoveryMetaDir({ activeRoot, project: args.project }), identity, hostSessionDigest }
  const primary = readFencedTaskWriteOwner(storeInput, { fs, ignoreReserve: true })
  const owner = primary.owner
  const state = primary.state
  if (primary.status !== 'fresh' || owner?.status !== 'active' || owner.sessionDigest !== hostSessionDigest ||
      state.activeProject !== args.project || state.taskRecoveryBinding?.taskId !== identity.taskId ||
      primary.transaction?.taskId !== identity.taskId || primary.terminalReceipt) {
    fail('TASK_OPERATION_RECOVERY_OWNER_MISMATCH', 'the exact active task owner/session is required')
  }
  const proposal = args.proposal || (args.proposalPath ? readProposal(args.proposalPath) : null)
  const operationId = args.operationId || proposal?.operationId
  if (!operationId || (args.operationId && proposal && proposal.operationId !== args.operationId)) {
    fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'the exact operation id is required')
  }
  const input = { state, activeRoot, project: args.project, taskId: identity.taskId, operationId,
    projectRoot: state.stickyProject?.physicalRoot,
    projectRootIdentityDigest: primary.transaction.projectRootIdentityDigest,
    hostSessionDigest, ingressEnvelopeDigest: state.actualInstructionEnvelope?.envelopeDigest }
  if (args.inspect) return { schemaVersion: 'TaskSourceRecoveryCommandResultV1', status: 'inspection-only',
    proposal: inspectCurrentSourceState(input), stateChanged: false, mutationAuthority: false }
  if (proposal?.schemaVersion !== 'TaskOperationCurrentSourceStateProposalV1' ||
      proposal.project !== args.project || proposal.taskId !== identity.taskId ||
      proposal.historicalEffect !== 'unknown' || proposal.mutationAuthority !== false) {
    fail('SOURCE_RECOVERY_PROPOSAL', 'accept requires the exact inspected source proposal')
  }
  const set = validateTaskOperationSet(state.turnLiveness?.taskOperationSet)
  if (!set.valid) fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'the canonical operation set is invalid')
  const prior = set.set.settled.find(item => item.operationId === operationId)
  if (prior) {
    const receipt = prior.currentStateRecovery
    if (prior.effect !== 'accepted-current-state' || !validateCurrentStateRecoveryReceipt(receipt, {
      operationId, priorRecordDigest: proposal.expectedOperationDigest, taskId: identity.taskId,
      project: args.project, sourceRoot: proposal.sourceRoot, projectRootIdentityDigest: proposal.projectRootIdentityDigest,
      ownerBindingDigest: proposal.ownerBindingDigest, idempotencyKey: proposal.idempotencyKey }).valid ||
        receipt.entries.length !== proposal.observations?.length ||
        receipt.entries.some(entry => !proposal.observations.some(item => item && item.path === entry.path &&
          item.sha256 === entry.sha256 && item.bytes === entry.bytes))) {
      fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'replay must match the exact accepted receipt')
    }
    return { schemaVersion: 'TaskSourceRecoveryCommandResultV1', status: 'reconciled-current-state', receipt,
      replayed: true, stateChanged: false, currentSnapshotRechecked: false, mutationAuthority: false,
      terminal: taskOperationTerminalSnapshot(state.turnLiveness) }
  }
  if (proposal.sourceRoot !== path.resolve(input.projectRoot) ||
      proposal.projectRootIdentityDigest !== input.projectRootIdentityDigest) {
    fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'the accepted project root changed')
  }
  const accepted = { ...input, expectedOperationDigest: proposal.expectedOperationDigest,
    idempotencyKey: proposal.idempotencyKey, ownerBindingDigest: proposal.ownerBindingDigest,
    observations: proposal.observations }
  const receipt = observeCurrentSourceState(accepted)
  const commit = updateTaskRecoveryState(storeInput, current => {
    const again = observeCurrentSourceState({ ...accepted, state: current }, { nowMs: Date.parse(receipt.observedAt) })
    if (again.recoveryDigest !== receipt.recoveryDigest) {
      fail('TASK_OPERATION_RECOVERY_CAS_MISMATCH', 'source/owner snapshot changed before commit')
    }
    return applyCurrentSourceStateRecovery(current, receipt)
  }, { fs, reason: 'task-operation-current-source-state-recovery', touchSessionMapping: true })
  if (!['committed', 'semantic-noop'].includes(commit.status)) {
    fail(commit.errorCode || 'TASK_OPERATION_RECOVERY_COMMIT_FAILED', 'source recovery did not commit')
  }
  const readback = readTaskRecoveryState(storeInput, { fs })
  const verified = validateTaskOperationSet(readback.state?.turnLiveness?.taskOperationSet)
  const settled = verified.set.settled.find(item => item.operationId === operationId)
  if (readback.status !== 'fresh' || !verified.valid || verified.set.unresolved?.operationId === operationId ||
      settled?.currentStateRecovery?.recoveryDigest !== receipt.recoveryDigest) {
    fail('TASK_OPERATION_RECOVERY_READBACK_FAILED', 'the exact source recovery receipt was not persisted')
  }
  return { schemaVersion: 'TaskSourceRecoveryCommandResultV1', status: 'reconciled-current-state', receipt,
    replayed: false, stateChanged: true, currentSnapshotRechecked: true, mutationAuthority: false,
    terminal: taskOperationTerminalSnapshot(readback.state.turnLiveness) }
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const result = recoverSourceOperation(args)
    const text = JSON.stringify(result, null, 2) + '\n'
    if (args.output) fs.writeFileSync(path.resolve(args.output), text, { flag: 'wx' })
    process.stdout.write(text)
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: 'error', errorCode: error.code || 'SOURCE_RECOVERY_FAILED',
      message: error.message }) + '\n')
    process.exitCode = error.code ? 2 : 1
  }
}

module.exports = { parseArgs, recoverSourceOperation }
