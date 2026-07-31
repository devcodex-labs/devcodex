#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  DEFAULT_LOCK,
  DEFAULT_MALFORMED_LOCK_STALE_MS,
  DEFAULT_RECEIPT,
  LOCK_SCHEMA,
  acquireLock,
  buildPackageProjectionPlan,
  cleanupPackageProjection,
  preparePackageProjection,
  releaseLock
} = require('./lib/package-compatibility-projection')

const ROOT = path.resolve(__dirname, '..')
const EXPECTED_ENTRY_COUNT = 250

function git (root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function fixture () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-package-projection-'))
  fs.cpSync(path.join(ROOT, 'content'), path.join(root, 'content'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'plugin.json'), path.join(root, 'plugin.json'))
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'DevCodex Test'])
  git(root, ['add', 'content', 'plugin.json'])
  return root
}

const currentPlan = buildPackageProjectionPlan(ROOT)
assert.strictEqual(currentPlan.entryCount, EXPECTED_ENTRY_COUNT)
assert.strictEqual(new Set(currentPlan.files.map(file => file.target)).size, EXPECTED_ENTRY_COUNT)
const currentTracked = new Set(git(ROOT, ['ls-files', '-z', '--'])
  .split('\0')
  .filter(Boolean)
  .map(file => file.replace(/\\/g, '/')))
const currentMissingCount = currentPlan.files.filter(file =>
  !fs.existsSync(path.join(ROOT, file.target))
).length
const currentReusableForeignCount = currentPlan.files.filter(file =>
  fs.existsSync(path.join(ROOT, file.target)) && !currentTracked.has(file.target)
).length
const current = preparePackageProjection(ROOT)
if (currentMissingCount === 0 && currentReusableForeignCount === 0) {
  assert.strictEqual(current.mode, 'verify-existing')
  assert.strictEqual(current.trackedTargetCount, EXPECTED_ENTRY_COUNT)
  assert.strictEqual(current.receiptWritten, false)
  assert.strictEqual(fs.existsSync(path.join(ROOT, DEFAULT_RECEIPT)), false)
} else {
  assert.strictEqual(current.mode, 'materialize')
  assert.strictEqual(current.materializedCount, currentMissingCount)
  assert.strictEqual(current.adoptedExistingCount, currentReusableForeignCount)
  assert.strictEqual(current.receiptWritten, true)
  const currentCleanup = cleanupPackageProjection(ROOT)
  assert.strictEqual(currentCleanup.status, 'cleaned')
  assert.strictEqual(currentCleanup.removed.length, currentMissingCount + currentReusableForeignCount)
}

{
  const root = fixture()
  try {
    const lock = acquireLock(root, { operation: 'test-concurrent' })
    assert.throws(
      () => preparePackageProjection(root),
      error => error && error.code === 'PACKAGE_PROJECTION_LOCKED'
    )
    releaseLock(lock)

    fs.mkdirSync(path.dirname(path.join(root, DEFAULT_LOCK)), { recursive: true })
    fs.writeFileSync(path.join(root, DEFAULT_LOCK), `${JSON.stringify({
      schemaVersion: LOCK_SCHEMA,
      pid: 999999,
      startedAt: '2000-01-01T00:00:00.000Z',
      operation: 'stale-test',
      planDigest: null
    })}\n`)
    const materialized = preparePackageProjection(root)
    assert.strictEqual(materialized.mode, 'materialize')
    assert.strictEqual(materialized.entryCount, EXPECTED_ENTRY_COUNT)
    assert.strictEqual(materialized.materializedCount, EXPECTED_ENTRY_COUNT)
    assert.strictEqual(materialized.reusedExistingCount, 0)
    assert.strictEqual(fs.existsSync(path.join(root, 'instructions.md')), true)
    assert.strictEqual(fs.existsSync(path.join(root, 'skills', 'portfolio.json')), true)
    assert.strictEqual(fs.existsSync(path.join(root, 'skills', 'routing', 'intent.json')), true)
    assert.strictEqual(fs.existsSync(path.join(root, DEFAULT_RECEIPT)), true)

    const repeated = preparePackageProjection(root)
    assert.strictEqual(repeated.mode, 'materialize')
    assert.strictEqual(repeated.entryCount, EXPECTED_ENTRY_COUNT)

    const cleaned = cleanupPackageProjection(root)
    assert.strictEqual(cleaned.status, 'cleaned')
    assert.strictEqual(cleaned.removed.length, EXPECTED_ENTRY_COUNT)
    assert.strictEqual(fs.existsSync(path.join(root, 'instructions.md')), false)
    for (const legacyRoot of ['instructions', 'prompts', 'skills']) {
      assert.strictEqual(fs.existsSync(path.join(root, legacyRoot)), false)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

{
  const root = fixture()
  try {
    const first = preparePackageProjection(root)
    const firstReceiptPath = path.join(root, DEFAULT_RECEIPT)
    const firstReceipt = JSON.parse(fs.readFileSync(firstReceiptPath, 'utf8'))
    git(root, ['add', ...firstReceipt.files.map(file => file.target)])
    fs.unlinkSync(firstReceiptPath)
    for (const file of firstReceipt.files) fs.unlinkSync(path.join(root, file.target))

    const stagedDeletion = preparePackageProjection(root)
    assert.strictEqual(stagedDeletion.mode, 'materialize')
    assert.strictEqual(stagedDeletion.materializedCount, first.materializedCount)
    const stagedReceipt = JSON.parse(fs.readFileSync(firstReceiptPath, 'utf8'))
    assert.ok(stagedReceipt.files.every(file => file.trackedAtMaterialize === true))
    const cleaned = cleanupPackageProjection(root)
    assert.strictEqual(cleaned.status, 'cleaned')
    assert.strictEqual(cleaned.removed.length, first.materializedCount)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

{
  const root = fixture()
  try {
    const lockPath = path.join(root, DEFAULT_LOCK)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    const fd = fs.openSync(lockPath, 'wx')
    try {
      assert.throws(
        () => acquireLock(root, { operation: 'partial-lock-probe' }),
        error => error && error.code === 'PACKAGE_PROJECTION_LOCKED_UNREADABLE'
      )
      assert.strictEqual(fs.existsSync(lockPath), true)
    } finally {
      fs.closeSync(fd)
    }

    const stale = new Date(Date.now() - DEFAULT_MALFORMED_LOCK_STALE_MS - 1000)
    fs.utimesSync(lockPath, stale, stale)
    const recovered = acquireLock(root, { operation: 'malformed-stale-recovery' })
    assert.strictEqual(recovered.lock.operation, 'malformed-stale-recovery')
    releaseLock(recovered)
    assert.strictEqual(
      fs.readdirSync(path.dirname(lockPath)).some(name => name.endsWith('.candidate')),
      false
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

{
  const root = fixture()
  try {
    preparePackageProjection(root)
    const modified = path.join(root, 'skills', 'routing', 'intent.json')
    fs.appendFileSync(modified, '\nmanual change\n')
    assert.throws(
      () => cleanupPackageProjection(root),
      error => error && error.code === 'PACKAGE_PROJECTION_CLEANUP_BLOCKED'
    )
    assert.strictEqual(fs.existsSync(modified), true)
    assert.strictEqual(fs.existsSync(path.join(root, DEFAULT_RECEIPT)), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

{
  const root = fixture()
  try {
    const first = preparePackageProjection(root)
    assert.strictEqual(first.materializedCount, EXPECTED_ENTRY_COUNT)
    fs.unlinkSync(path.join(root, DEFAULT_RECEIPT))

    const adopted = preparePackageProjection(root)
    assert.strictEqual(adopted.mode, 'materialize')
    assert.strictEqual(adopted.materializedCount, 0)
    assert.strictEqual(adopted.adoptedExistingCount, EXPECTED_ENTRY_COUNT)
    assert.strictEqual(adopted.receiptWritten, true)
    const cleaned = cleanupPackageProjection(root)
    assert.strictEqual(cleaned.status, 'cleaned')
    assert.strictEqual(cleaned.removed.length, EXPECTED_ENTRY_COUNT)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

{
  const root = fixture()
  try {
    fs.mkdirSync(path.join(root, 'prompts'), { recursive: true })
    fs.writeFileSync(path.join(root, 'prompts', 'report-dev.prompt.md'), 'foreign file\n')
    assert.throws(
      () => preparePackageProjection(root),
      error => error && error.code === 'PACKAGE_PROJECTION_COLLISION'
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

console.log('package compatibility projection tests passed modes=verify-existing,materialize cleanup=owned-only')
