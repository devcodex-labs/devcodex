'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { withWorkspaceTempArtifact } = require('./lib/workspace-temp.js')
const { fstatSnapshot, filePathSnapshot, normalizeStat } = require('../hooks/_runtime/file-identity.cjs')
const { readBoundedTextFileSync } = require('../mcp/bounded-text-reader.cjs')
const { createMemoryFileTransaction } = require('../mcp/memory-file-transaction.cjs')
const { patchProvesAppend } = require('../hooks/_runtime/patch-append-proof.cjs')
const { createWorkflowOperationalWriteLease, validateWorkflowOperationalWriteLease } = require('../hooks/_runtime/workflow-operational-write-lease.cjs')
const { createTurnLivenessState, prepareTaskOperationRecord, markTaskOperationDispatched, taskOperationTargetSetDigest } = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')
const { commitTaskRecoveryState, readTaskRecoveryState } = require('../hooks/_runtime/task-recovery-store-v5.cjs')

function fileIdentityProbe(root) {
  fs.mkdirSync(root, { recursive: true })
  const filePath = path.join(root, '中文记忆.md')
  const content = '# 任务记忆\r\n\r\n保留原任务意图。\r\n'
  fs.writeFileSync(filePath, content)
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const byHandle = fstatSnapshot(fs, descriptor)
    const byPath = filePathSnapshot(fs, filePath)
    assert.strictEqual(byHandle.ino, byPath.ino)
    assert.strictEqual(byHandle.dev, byPath.dev)
    assert.strictEqual(byHandle.ino, String(fs.fstatSync(descriptor, { bigint: true }).ino))
    assert(byHandle.isFile())
  } finally { fs.closeSync(descriptor) }
  assert.strictEqual(readBoundedTextFileSync(filePath, { maxBytes: 16384 }).content, content)
  const transaction = createMemoryFileTransaction()
  const expectedSnapshot = transaction.readSnapshot(filePath)
  const appended = '\r\n已回读工具结果，继续续办。\r\n'
  const receipt = transaction.commit({ filePath, expectedSnapshot, content: content + appended, appendText: appended })
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), content + appended)
  assert.strictEqual(receipt.durability.readback.status, 'PASS')
  const stale = transaction.readSnapshot(filePath)
  const replacement = path.join(root, 'replacement.md')
  fs.writeFileSync(replacement, stale.content)
  fs.renameSync(replacement, filePath)
  assert.throws(() => transaction.commit({ filePath, expectedSnapshot: stale, content: stale.content + '禁止丢失并发修改' }),
    error => /CAS|IDENTITY/.test(error.code || ''))
  const big = normalizeStat({ dev: 1n, ino: 9007199254740993n, size: 0n, isFile: () => true })
  assert.strictEqual(big.ino, '9007199254740993')
  const fractionalTime = normalizeStat({ dev: 1n, ino: 2n, size: 0n, mtimeMs: 1788770050210n, mtimeNs: 1788770050210545800n })
  assert.strictEqual(fractionalTime.mtime.toISOString(), '2026-09-07T08:34:10.211Z', 'numeric Stats cache timestamps must retain their rounding')
  assert.throws(() => normalizeStat({ dev: 1, ino: 9007199254740992, size: 0 }), /lossless/)
  const lateSwap = path.join(root, 'late-swap.md')
  const lateReplacement = path.join(root, 'late-replacement.md')
  fs.writeFileSync(lateSwap, 'original\n')
  fs.writeFileSync(lateReplacement, 'concurrent\n')
  let pathObservations = 0
  const replacingFs = { ...fs, lstatSync(target, options) {
    // Simulate the final path observation seeing another real regular file.
    // Windows may disallow rename-over-open, so do not depend on that OS policy.
    if (target === lateSwap && ++pathObservations === 2) return fs.lstatSync(lateReplacement, options)
    return fs.lstatSync(target, options)
  } }
  assert.throws(() => filePathSnapshot(replacingFs, lateSwap), error => error.code === 'FILE_IDENTITY_TARGET_CHANGED',
    'a regular-file replacement between reopen and final lstat must not return the old descriptor identity')
  assert.strictEqual(fs.readFileSync(lateSwap, 'utf8'), 'original\n')
  const patch = '*** Begin Patch\n*** Update File: memory.md\n@@\n 原任务\n+续办内容\n*** End Patch'
  assert(patchProvesAppend(patch, '原任务\n'))
  assert(patchProvesAppend(patch, '原任务\r\n'))
  assert(!patchProvesAppend(patch.replace(' 原任务', '-原任务'), '原任务\n'), 'overwriting an old task is not an append')
  assert(!patchProvesAppend(patch.replace('*** Update File: memory.md', '*** Delete File: memory.md'), '原任务\n'))
}

function operationalContinuityProbe(root) {
  const nowMs = Date.now()
  const activeRoot = path.join(root, '.devcodex', 'devcodex')
  const state = {
    activeProject: 'devcodex', activeScope: 'project',
    stickyProject: { leaseDigest: '1'.repeat(64), rootIdentityDigest: '2'.repeat(64),
      authorityDigest: '3'.repeat(64), expiresAtMs: nowMs + 3600000 },
    actualInstructionEnvelope: { contextEpoch: 'ctx-continuity', envelopeDigest: '4'.repeat(64) },
    workflowRouteDecision: { decisionDigest: '5'.repeat(64), routeRevision: '6'.repeat(64) },
    contextAcquisition: { hostSessionId: 'continuity-probe' },
    turnLiveness: { ...createTurnLivenessState({ nowMs }), turnKey: 'continuity-probe' }
  }
  const relativeTargets = ['.memory/clients/codex/tasks/20260907.md', '.memory/clients/codex/tasks/20260908.md']
  const targets = relativeTargets.map(target => path.join(activeRoot, target))
  const existing = '# 旧段落\n重复上下文\n# 当前段落\n重复上下文\n'
  for (const [index, target] of targets.entries()) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, index ? existing.replace(/\n/g, '\r\n') : existing)
  }
  const lease = createWorkflowOperationalWriteLease({ state, activeRoot, projectRoot: root,
    relativeTargets, operation: 'append' }, { nowMs })
  const patch = ['*** Begin Patch', ...targets.flatMap(target => [
    `*** Update File: ${target}`, '@@ # 当前段落', ' 重复上下文', '+继续原任务'
  ]), '*** End Patch'].join('\n')
  const input = { state, activeRoot, projectRoot: root, relativeTargets, operation: 'append',
    footprint: { operation: 'update', normalizedTargets: targets },
    payload: { cwd: root, tool_name: 'apply_patch', tool_input: patch } }
  const allowed = validateWorkflowOperationalWriteLease(lease, input, { nowMs })
  assert.strictEqual(allowed.valid, true, JSON.stringify(allowed.errors))
  const overwrite = validateWorkflowOperationalWriteLease(lease, { ...input,
    payload: { ...input.payload, tool_input: patch.replace(' 重复上下文', '-重复上下文') }
  }, { nowMs })
  assert(overwrite.errors.includes('workflow-operational-append-proof-required'))
  const wrongTargets = validateWorkflowOperationalWriteLease(lease, { ...input,
    relativeTargets: [relativeTargets[0]] }, { nowMs })
  assert(wrongTargets.errors.includes('workflow-operational-target-set-mismatch'))

  let operationState = prepareTaskOperationRecord(state.turnLiveness, {
    operationId: 'append-dispatch', writerGeneration: 0, expectedStateSequence: 0,
    kind: 'append', exactTargets: targets, targetSetDigest: taskOperationTargetSetDigest(targets),
    beforeDigest: '7'.repeat(64)
  }, { nowMs })
  operationState = markTaskOperationDispatched(operationState, 'append-dispatch', { nowMs: nowMs + 100 })
  const dispatchedOperation = { operationId: 'append-dispatch',
    operationRecord: operationState.taskOperationSet.unresolved,
    mutationPreObservation: { operationId: 'append-dispatch' },
    mutationLease: { ownerLeaseDigest: lease.leaseDigest },
    artifactDecision: { operationalLeaseDigest: lease.leaseDigest } }
  const refreshed = { ...state,
    stickyProject: { ...state.stickyProject, leaseDigest: '8'.repeat(64) },
    actualInstructionEnvelope: { contextEpoch: 'ctx-refreshed', envelopeDigest: '9'.repeat(64) },
    workflowRouteDecision: { decisionDigest: 'a'.repeat(64), routeRevision: 'b'.repeat(64) } }
  const post = validateWorkflowOperationalWriteLease(lease, { ...input, state: refreshed, dispatchedOperation },
    { phase: 'post', nowMs: nowMs + 3600000 })
  assert.strictEqual(post.valid, true, JSON.stringify(post.errors))
  assert(post.metadataDrift.length >= 4, 'refresh drift must be recorded while the original dispatch remains verifiable')
  assert.strictEqual(validateWorkflowOperationalWriteLease(lease, { ...input, state: refreshed },
    { phase: 'post', nowMs: nowMs + 3600000 }).valid, false, 'post label alone cannot prove a prior dispatch')

  const reportRelative = 'reports/analysis/codex/20260907/01--continuity-draft.md'
  const reportPath = path.join(activeRoot, reportRelative)
  const reportLease = createWorkflowOperationalWriteLease({ state, activeRoot, projectRoot: root,
    relativeTargets: [reportRelative], operation: 'create' }, { nowMs })
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  const reportContent = '# 续办分析\n\n当前结果需要继续核对。\n'
  fs.writeFileSync(reportPath, reportContent)
  assert.strictEqual(fs.readFileSync(reportPath, 'utf8'), reportContent)
  const withDraft = { ...state, workflowOperationalWriteLeaseCloseout: {
    status: 'consumed', leaseId: reportLease.leaseId, leaseDigest: reportLease.leaseDigest,
    operationId: 'report-create', turnKey: state.turnLiveness.turnKey,
    sessionDigest: state.stickyProject.authorityDigest, draftTargets: [reportPath]
  } }
  const metaDir = path.join(root, 'draft-recovery-hooks')
  const recoveryOptions = { nowMs, reserveBytes: 8192, hardBytes: 128 * 1024 * 1024 }
  const committed = commitTaskRecoveryState({ metaDir, identity: { activeRoot, project: 'devcodex' },
    sessionKey: 'continuity-probe', state: withDraft }, recoveryOptions)
  assert.strictEqual(committed.status, 'ephemeral-stub', JSON.stringify(committed))
  const recovered = readTaskRecoveryState({ metaDir, sessionKey: 'continuity-probe',
    expectedIdentity: { activeRoot, project: 'devcodex' } }, recoveryOptions)
  assert.deepStrictEqual(recovered.state.workflowOperationalWriteLeaseCloseout.draftTargets, [reportPath])
  // Fresh ingress is independent of the persisted draft ownership receipt.
  const draftState = { ...state, workflowOperationalWriteLeaseCloseout: recovered.state.workflowOperationalWriteLeaseCloseout }
  assert.doesNotThrow(() => createWorkflowOperationalWriteLease({ state: draftState, activeRoot, projectRoot: root,
    relativeTargets: [reportRelative], operation: 'update' }, { nowMs }))
  assert.throws(() => createWorkflowOperationalWriteLease({ state, activeRoot, projectRoot: root,
    relativeTargets: [reportRelative], operation: 'update' }, { nowMs }), error => error.code === 'WORKFLOW_OPERATIONAL_REPORT_DRAFT_UNOBSERVED')
}

withWorkspaceTempArtifact(path.resolve(__dirname, '..'), {
  type: 'run', project: 'devcodex', owner: 'task-write-continuity',
  producer: 'test-task-write-continuity', targetName: 'file-identity-probe'
}, ({ targetPath }) => {
  fileIdentityProbe(targetPath)
  operationalContinuityProbe(targetPath)
})
process.stdout.write(`File identity, memory append, delayed receipt and draft recovery probes passed on ${process.version}.\n`)
