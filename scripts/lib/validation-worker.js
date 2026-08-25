'use strict'

const { executeValidationPlan } = require('./validation-dag')
const { createValidationEvidenceStore } = require('./validation-evidence-store')

const WORKER_MESSAGE_SCHEMA = 'ValidationWorkerMessageV1'
const RUNNER_COMMAND_SCHEMA = 'ValidationRunnerCommandV1'

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
    }, () => {
      if (close) process.disconnect()
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
    const execution = executeValidationPlan({
      ...input.execution,
      persistTerminal: false,
      getCurrentLease: () => evidenceStore.readLease().lease,
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
