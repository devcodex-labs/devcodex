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
  resolvePackageProjectionStatePaths,
  releaseLock
} = require('./lib/package-compatibility-projection')

const ROOT = path.resolve(__dirname, '..')
const REQUIRED_PROJECTION_TARGETS = Object.freeze([
  'instructions.md',
  'skills/portfolio.json',
  'skills/public-taxonomy.json',
  'skills/routing/intent.json'
])

function assertProjectionPlanShape (plan, label) {
  assert.strictEqual(plan.entryCount, plan.files.length, `${label}: entryCount must equal the actual projection plan`)
  assert.strictEqual(new Set(plan.files.map(file => file.target)).size, plan.entryCount, `${label}: projection targets must be unique`)
  const targets = new Set(plan.files.map(file => file.target))
  for (const target of REQUIRED_PROJECTION_TARGETS) {
    assert.ok(targets.has(target), `${label}: required compatibility target missing: ${target}`)
  }
  return plan.entryCount
}

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
const currentExpectedEntryCount = assertProjectionPlanShape(currentPlan, 'source plan')
const currentStatePaths = resolvePackageProjectionStatePaths(ROOT)
assert.ok(currentStatePaths.stateRoot.startsWith(path.join(os.tmpdir(), 'devcodex-package-compatibility-projection')))
assert.strictEqual(currentStatePaths.lockPath, path.join(currentStatePaths.stateRoot, DEFAULT_LOCK))
assert.strictEqual(currentStatePaths.receiptPath, path.join(currentStatePaths.stateRoot, DEFAULT_RECEIPT))
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
  assert.strictEqual(current.trackedTargetCount, currentExpectedEntryCount)
  assert.strictEqual(current.receiptWritten, false)
  assert.strictEqual(fs.existsSync(currentStatePaths.receiptPath), false)
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
    const expectedEntryCount = assertProjectionPlanShape(buildPackageProjectionPlan(root), 'materialization fixture')
    const lock = acquireLock(root, { operation: 'test-concurrent' })
    assert.throws(
      () => preparePackageProjection(root),
      error => error && error.code === 'PACKAGE_PROJECTION_LOCKED'
    )
    releaseLock(lock)

    const statePaths = resolvePackageProjectionStatePaths(root)
    fs.mkdirSync(path.dirname(statePaths.lockPath), { recursive: true })
    fs.writeFileSync(statePaths.lockPath, `${JSON.stringify({
      schemaVersion: LOCK_SCHEMA,
      pid: 999999,
      startedAt: '2000-01-01T00:00:00.000Z',
      operation: 'stale-test',
      planDigest: null
    })}\n`)
    const materialized = preparePackageProjection(root)
    assert.strictEqual(materialized.mode, 'materialize')
    assert.strictEqual(materialized.entryCount, expectedEntryCount)
    assert.strictEqual(materialized.materializedCount, expectedEntryCount)
    assert.strictEqual(materialized.reusedExistingCount, 0)
    assert.strictEqual(fs.existsSync(path.join(root, 'instructions.md')), true)
    assert.strictEqual(fs.existsSync(path.join(root, 'skills', 'portfolio.json')), true)
    assert.strictEqual(fs.existsSync(path.join(root, 'skills', 'public-taxonomy.json')), true)
    assert.strictEqual(fs.existsSync(path.join(root, 'skills', 'routing', 'intent.json')), true)
    assert.strictEqual(fs.existsSync(statePaths.receiptPath), true)

    const repeated = preparePackageProjection(root)
    assert.strictEqual(repeated.mode, 'materialize')
    assert.strictEqual(repeated.entryCount, expectedEntryCount)

    const cleaned = cleanupPackageProjection(root)
    assert.strictEqual(cleaned.status, 'cleaned')
    assert.strictEqual(cleaned.removed.length, expectedEntryCount)
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
    assertProjectionPlanShape(buildPackageProjectionPlan(root), 'staged deletion fixture')
    const first = preparePackageProjection(root)
    const firstReceiptPath = resolvePackageProjectionStatePaths(root).receiptPath
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
    const lockPath = resolvePackageProjectionStatePaths(root).lockPath
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
    assert.strictEqual(fs.existsSync(path.dirname(lockPath)), false)
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
    assert.strictEqual(fs.existsSync(resolvePackageProjectionStatePaths(root).receiptPath), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

{
  const root = fixture()
  try {
    const expectedEntryCount = assertProjectionPlanShape(buildPackageProjectionPlan(root), 'adoption fixture')
    const first = preparePackageProjection(root)
    assert.strictEqual(first.materializedCount, expectedEntryCount)
    fs.unlinkSync(resolvePackageProjectionStatePaths(root).receiptPath)

    const adopted = preparePackageProjection(root)
    assert.strictEqual(adopted.mode, 'materialize')
    assert.strictEqual(adopted.materializedCount, 0)
    assert.strictEqual(adopted.adoptedExistingCount, expectedEntryCount)
    assert.strictEqual(adopted.receiptWritten, true)
    const cleaned = cleanupPackageProjection(root)
    assert.strictEqual(cleaned.status, 'cleaned')
    assert.strictEqual(cleaned.removed.length, expectedEntryCount)
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
