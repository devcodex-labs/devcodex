'use strict'

const WORKER_MESSAGE_SCHEMA = 'ValidationWorkerMessageV1'
const RUNNER_COMMAND_SCHEMA = 'ValidationRunnerCommandV1'

if (process.env.DEVCODEX_VALIDATION_WORKER_FAULT === 'disconnect-before-command') {
  if (process.connected) process.disconnect()
  // Keep the disconnected process alive past the runner's delayed dispatch so
  // the fixture deterministically exercises the send-error closeout branch.
  setTimeout(() => process.exit(19), 1000)
}

function createSender(message) {
  let sequence = 0
  return (type, payload = {}, close = false) => {
    if (!process.send) return
    sequence += 1
    process.send({
      schemaVersion: WORKER_MESSAGE_SCHEMA,
      runIdentityDigest: message.runIdentityDigest,
      attempt: message.attempt,
      sequence,
      type,
      ...payload
    }, () => {
      if (close) process.disconnect()
    })
  }
}

function receiptFor(input) {
  const now = new Date().toISOString()
  const resumedNodeIds = (input.resumeResults || []).map(result => result.nodeId)
  return {
    schemaVersion: 'ValidationExecutionReceiptV3',
    contractVersion: '3',
    runId: input.lease.runId,
    runIdentity: input.lease.runIdentity,
    runIdentityDigest: input.lease.runIdentityDigest,
    receiptId: `validation-receipt-managed-fixture-${input.lease.runIdentityDigest}`,
    candidateId: input.candidate.candidateId,
    candidateIdentity: {
      candidateId: input.candidate.candidateId,
      stable: true,
      head: input.candidate.head,
      changedSource: 'explicit',
      changedFiles: input.candidate.changedFiles
    },
    testRouteDigest: input.plan.planDigest,
    budgetCard: input.plan.budgetCard,
    requestDigest: input.plan.requestDigest,
    authorityDigest: input.lease.authorityDigest,
    authorityActorType: input.lease.actorType,
    authorityClass: input.lease.authorityClass,
    claimCeiling: input.plan.claimCeiling,
    selectedNodeCount: 1,
    executionCount: resumedNodeIds.length ? 0 : 1,
    cacheHitCount: resumedNodeIds.length,
    resumedNodeIds,
    resumedNodeCount: resumedNodeIds.length,
    failedNode: null,
    abortedNodes: [],
    nodeReceiptDigests: { fixture: 'a'.repeat(64) },
    startedAt: now,
    completedAt: now,
    wallTimeMs: 1,
    nativeExitCode: 0
  }
}

process.once('message', message => {
  if (message?.schemaVersion !== RUNNER_COMMAND_SCHEMA || message?.type !== 'execute') return
  const send = createSender(message)
  const input = message.payload.execution
  const fault = input.candidate.runnerFault || (input.candidate.cancelProbe ? 'hang' : null)
  if (fault === 'protocol') {
    process.send?.({ type: 'node', sequence: 99, result: {} })
    return
  }
  send('started', { workerPid: process.pid })
  if (fault === 'crash' || (fault === 'restart' && message.attempt === 1)) {
    setTimeout(() => process.exit(17), 10)
    return
  }
  if (fault === 'ipc-exit') {
    setTimeout(() => process.exit(0), 10)
    return
  }
  if (fault === 'error') {
    send('error', { error: { code: 'VALIDATION_FIXTURE_ERROR', message: 'fixture error' } }, true)
    return
  }
  send('node-start', {
    node: { nodeId: 'fixture', ordinal: 1, total: 1, timeoutMs: 1000 }
  })
  const resumed = (input.resumeResults || [])[0]
  send('node', {
    result: {
      ...(resumed || {}),
      nodeId: 'fixture',
      status: resumed ? 'cache-hit' : 'passed',
      cacheStatus: resumed ? 'hit-run-checkpoint' : 'disabled',
      nodeReceiptDigest: 'a'.repeat(64),
      evidenceDigest: 'b'.repeat(64),
      exitCode: 0,
      durationMs: 1,
      stdout: fault === 'ipc-budget' ? 'x'.repeat(2 * 1024 * 1024) : 'ok',
      stderr: ''
    }
  })
  if (fault === 'checkpoint-restart' && message.attempt === 1) {
    setTimeout(() => process.exit(17), 10)
    return
  }
  if (fault === 'checkpoint-restart' && message.attempt > 1 && !resumed) {
    send('error', { error: { code: 'VALIDATION_FIXTURE_CHECKPOINT_MISSING', message: 'checkpoint was not resumed' } }, true)
    return
  }
  if (fault === 'hang') {
    setInterval(() => {}, 1000)
    return
  }
  setTimeout(() => {
    send('result', { execution: { receipt: receiptFor(input) } }, true)
  }, 25)
})
