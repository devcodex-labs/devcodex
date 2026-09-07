'use strict'

const { executeValidationPlan } = require('./validation-dag')
const { createValidationEvidenceStore } = require('./validation-evidence-store')
const { createValidationWaveCommandRunner } = require('./validation-wave-executor')

const WORKER_MESSAGE_SCHEMA = 'ValidationWorkerMessageV1'
const RUNNER_COMMAND_SCHEMA = 'ValidationRunnerCommandV1'

// The parent disconnects only after observing the terminal receipt. Keep this
// channel referenced until then; send completion is not a delivery ACK.
process.channel?.ref()

function serializeError(error) {
  return {
    name: error.name || 'Error',
    code: error.code || 'VALIDATION_WORKER_FAILED',
    message: error.message || String(error),
    details: error.details || null,
    stack: error.stack || null
  }
}

function createProtocolSender(runIdentityDigest, attempt) {
  let sequence = 0
  return (type, payload = {}, close = false) => {
    if (!process.send) return
    sequence += 1
    process.send({
      schemaVersion: WORKER_MESSAGE_SCHEMA,
      runIdentityDigest,
      attempt,
      sequence,
      type,
      ...payload
    }, error => {
      if (error && close && process.connected) process.disconnect()
    })
  }
}

process.once('message', message => {
  if (message?.schemaVersion !== RUNNER_COMMAND_SCHEMA || message?.type !== 'execute' ||
      message.runIdentityDigest !== message.payload?.execution?.lease?.runIdentityDigest ||
      !Number.isInteger(message.attempt) || message.attempt < 1) {
    process.exitCode = 2
    return
  }
  const send = createProtocolSender(message.runIdentityDigest, message.attempt)
  const input = message.payload
  send('started', { workerPid: process.pid })
  try {
    const evidenceStore = createValidationEvidenceStore(input.evidenceStore)
    const runCommand = createValidationWaveCommandRunner({
      plan: input.execution.plan,
      repoRoot: input.execution.repoRoot,
      activeRoot: input.execution.activeRoot,
      runId: input.execution.lease?.runId,
      maxConcurrency: input.execution.maxConcurrency,
      resumeResults: input.execution.resumeResults,
      useCache: input.execution.useCache
    })
    const execution = executeValidationPlan({
      ...input.execution,
      runCommand,
      persistTerminal: false,
      getCurrentLease: () => evidenceStore.readLease().lease,
      onNodeStart: node => {
        send('node-start', { node })
      },
      onNode: result => {
        send('node', { result })
      }
    })
    send('result', { execution }, true)
  } catch (error) {
    send('error', { error: serializeError(error) }, true)
    process.exitCode = 1
  }
})
