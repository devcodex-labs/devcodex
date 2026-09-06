'use strict'

const fs = require('fs')
const { workerData } = require('worker_threads')
const { runChecked } = require('./checked-command')

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || error?.evidence?.code || 'VALIDATION_NODE_WORKER_FAILED',
    message: error?.message || String(error),
    evidence: error?.evidence || null
  }
}

const signal = new Int32Array(workerData.signalBuffer)
let state = 1
try {
  const evidence = runChecked(workerData.node.command, workerData.node.args || [], {
    cwd: workerData.cwd,
    env: workerData.node.environment || {},
    timeoutMs: workerData.node.timeoutMs
  })
  fs.writeFileSync(workerData.resultPath, JSON.stringify({
    schemaVersion: 'ValidationNodeWorkerResultV1',
    nodeId: workerData.node.id,
    ok: true,
    evidence
  }) + '\n', { encoding: 'utf8', flag: 'wx' })
} catch (error) {
  try {
    fs.writeFileSync(workerData.resultPath, JSON.stringify({
      schemaVersion: 'ValidationNodeWorkerResultV1',
      nodeId: workerData.node?.id || null,
      ok: false,
      error: serializeError(error)
    }) + '\n', { encoding: 'utf8', flag: 'wx' })
  } catch {
    state = -1
  }
} finally {
  Atomics.store(signal, workerData.signalIndex, state)
  Atomics.notify(signal, workerData.signalIndex, 1)
}
