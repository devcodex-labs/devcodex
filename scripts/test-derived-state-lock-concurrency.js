#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { createDerivedStateStore } = require('../hooks/_runtime/derived-state-store.cjs')

const WORKER_FLAG = '--derived-state-lock-worker'
const WRITER_COUNT = 20
const WORKER_RETRY_DEADLINE_MS = 20_000
const WORKER_MAX_ATTEMPTS = 10

function waitSync(ms) {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function runWorker(root, writerId) {
  const store = createDerivedStateStore({
    root,
    relativePath: 'counter.json',
    lockWaitMs: 2000,
    maxWrites: 1
  })
  const deadlineAt = Date.now() + WORKER_RETRY_DEADLINE_MS
  let attempts = 0
  let transientTimeouts = 0
  let receipt = null
  while (attempts < WORKER_MAX_ATTEMPTS && Date.now() < deadlineAt) {
    attempts += 1
    receipt = store.update(current => ({
      counter: Number(current.counter || 0) + 1,
      writerIds: [...(Array.isArray(current.writerIds) ? current.writerIds : []), writerId]
    }))
    if (receipt.status === 'persisted') break
    if (receipt.errorCode !== 'DERIVED_STATE_LOCK_TIMEOUT') break
    transientTimeouts += 1
    waitSync(25)
  }
  const workerReceipt = { ...receipt, attempts, transientTimeouts }
  process.stdout.write(`${JSON.stringify(workerReceipt)}\n`)
  process.exit(receipt?.status === 'persisted' ? 0 : 1)
}

function spawnWorker(root, writerIndex) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, WORKER_FLAG, root, String(writerIndex)], {
      cwd: __dirname,
      env: { ...process.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`writer ${writerIndex} timed out`))
    }, 30_000)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ writerIndex, code, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

function removeOwnedTempRoot(root) {
  const tempBase = path.resolve(os.tmpdir())
  const resolved = path.resolve(root)
  const relative = path.relative(tempBase, resolved)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  assert.match(path.basename(resolved), /^devcodex-derived-lock-/)
  fs.rmSync(resolved, { recursive: true, force: true })
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-derived-lock-'))
  try {
    const initial = createDerivedStateStore({
      root,
      relativePath: 'counter.json',
      lockWaitMs: 2000,
      maxWrites: 1
    }).write({ counter: 0, writerIds: [] })
    assert.strictEqual(initial.status, 'persisted')

    const results = await Promise.all(
      Array.from({ length: WRITER_COUNT }, (_, index) => spawnWorker(root, index + 1))
    )
    const receipts = []
    for (const result of results) {
      assert.strictEqual(result.code, 0, `writer ${result.writerIndex} failed: ${result.stderr || result.stdout}`)
      const receipt = JSON.parse(result.stdout)
      assert.strictEqual(receipt.status, 'persisted')
      assert.ok(receipt.attempts >= 1 && receipt.attempts <= WORKER_MAX_ATTEMPTS)
      assert.ok(receipt.transientTimeouts >= 0 && receipt.transientTimeouts < receipt.attempts)
      receipts.push(receipt)
    }

    const verifier = createDerivedStateStore({
      root,
      relativePath: 'counter.json',
      lockWaitMs: 0,
      maxWrites: 0
    })
    const final = verifier.read()
    assert.strictEqual(final.status, 'fresh')
    const recoverySummary = receipts
      .filter(receipt => receipt.staleLockQuarantined)
      .map(receipt => ({
        ownerToken: receipt.ownerToken,
        lockRecoveryReason: receipt.lockRecoveryReason,
        quarantinePath: receipt.quarantinePath
      }))
    assert.strictEqual(
      final.value.counter,
      WRITER_COUNT,
      `lost update; writers=${JSON.stringify(final.value.writerIds)} recoveries=${JSON.stringify(recoverySummary)}`
    )
    assert.strictEqual(new Set(final.value.writerIds).size, WRITER_COUNT)
    assert.strictEqual(fs.existsSync(verifier.lockPath), false)
    const retryCount = receipts.reduce((sum, receipt) => sum + receipt.transientTimeouts, 0)
    process.stdout.write(`derived-state lock concurrency: ${WRITER_COUNT}/${WRITER_COUNT} writers persisted without loss; boundedRetries=${retryCount}\n`)
  } finally {
    removeOwnedTempRoot(root)
  }
}

if (process.argv[2] === WORKER_FLAG) {
  runWorker(path.resolve(process.argv[3]), Number(process.argv[4]))
} else {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exit(1)
  })
}
