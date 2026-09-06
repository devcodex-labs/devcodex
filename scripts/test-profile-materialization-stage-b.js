#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  PROFILE_LOCK_LEASE_MS,
  PROFILE_MATERIALIZATION_RECEIPT_FILE,
  materializeProfileDraft,
  verifyProfileReadback
} = require('./lib/profile-materialization-v1.js')
const {
  inspectProfileAvailability
} = require('../hooks/_runtime/profile-availability-v1.cjs')

const roots = []

function createRoot(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `devcodex-b2-${name}-`))
  roots.push(root)
  const projectRoot = path.join(root, 'apps', 'api')
  const runtimeRoot = path.join(root, '.devcodex', 'apps', 'api')
  const profileRoot = path.join(runtimeRoot, 'profile')
  fs.mkdirSync(projectRoot, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"api"}\n', 'utf8')
  return { root, projectRoot, runtimeRoot, profileRoot }
}

function contents() {
  return {
    'README.md': '# Profile\n\n> Profile 路径契约：`portable-v1`。\n- Profile 档位：profile-lite。\n',
    '01-项目信息.md': '# 01 — 项目信息\n\n- 状态：unverified\n',
    '02-架构约束.md': '# 02 — 架构约束\n\n- 状态：unverified\n',
    '03-代码风格.md': '# 03 — 代码风格\n\n- 状态：unverified\n',
    'config.json': '{"mode":"dev","agent":"codex"}\n'
  }
}

function input(target, extra = {}) {
  return {
    projectIdentity: 'apps/api',
    projectRoot: target.projectRoot,
    runtimeRoot: target.runtimeRoot,
    profileRoot: target.profileRoot,
    tier: 'profile-lite',
    templateVersion: 'test-v1',
    generatorVersion: 'test',
    sourceScan: { package: 'api' },
    contents: contents(),
    operationId: extra.operationId || 'operation-a',
    ...extra
  }
}

function ownedTempExists(target) {
  return fs.existsSync(path.join(target.projectRoot, '.tmp', 'devcodex-profile'))
}

function testDryRunIsZeroWrite() {
  const target = createRoot('dry')
  const before = fs.readdirSync(target.projectRoot).sort()
  const receipt = materializeProfileDraft(input(target, { dryRun: true }))
  assert.strictEqual(receipt.status, 'planned')
  assert.strictEqual(receipt.lifecycleState, 'missing')
  assert.strictEqual(receipt.staging.written, false)
  assert.deepStrictEqual(fs.readdirSync(target.projectRoot).sort(), before)
  assert.strictEqual(fs.existsSync(target.profileRoot), false)
  assert.strictEqual(ownedTempExists(target), false)

  const existing = createRoot('dry-existing')
  fs.mkdirSync(existing.profileRoot, { recursive: true })
  for (const [file, text] of Object.entries(contents())) {
    fs.writeFileSync(path.join(existing.profileRoot, file), text, 'utf8')
  }
  const existingPreview = materializeProfileDraft(input(existing, { operationId: 'dry-existing', dryRun: true }))
  assert.strictEqual(existingPreview.lifecycleState, 'generated-draft', 'an unreceipted existing Profile must not be previewed as reviewed')

  const incomplete = createRoot('dry-incomplete')
  fs.mkdirSync(incomplete.profileRoot, { recursive: true })
  fs.writeFileSync(path.join(incomplete.profileRoot, 'README.md'), contents()['README.md'], 'utf8')
  const incompletePreview = materializeProfileDraft(input(incomplete, { operationId: 'dry-incomplete', dryRun: true }))
  assert.strictEqual(incompletePreview.lifecycleState, 'partial-invalid')
}

function testCommitReadbackAndRerun() {
  const target = createRoot('commit')
  const receipt = materializeProfileDraft(input(target), {
    validateProfile: () => ({ ok: true, status: 0, validator: 'fixture', errors: [], warnings: [] })
  })
  assert.strictEqual(receipt.status, 'committed')
  assert.strictEqual(receipt.lifecycleState, 'generated-draft')
  assert.strictEqual(receipt.commit.status, 'readback-verified')
  assert.ok(/^[a-f0-9]{64}$/.test(receipt.receiptDigest))
  const persisted = JSON.parse(fs.readFileSync(path.join(target.profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE), 'utf8'))
  assert.strictEqual(persisted.receiptDigest, receipt.receiptDigest)
  assert.strictEqual(verifyProfileReadback(target.profileRoot, receipt.manifest).ok, true)
  assert.strictEqual(ownedTempExists(target), false)

  const rerun = materializeProfileDraft(input(target, { operationId: 'operation-b' }))
  assert.strictEqual(rerun.status, 'unchanged')
  assert.strictEqual(rerun.lifecycleState, 'generated-draft')
  assert.strictEqual(ownedTempExists(target), false)
}

function testPreCommitFaultsLeaveNoTarget() {
  for (const phase of ['after-lock', 'after-stage', 'after-validation', 'before-commit']) {
    const target = createRoot(phase)
    assert.throws(
      () => materializeProfileDraft(input(target, { operationId: `fault-${phase}`, faultAt: phase })),
      error => error.code === 'PROFILE_MATERIALIZATION_FAULT_INJECTED' && error.profileCommitted === false
    )
    assert.strictEqual(fs.existsSync(target.profileRoot), false, `${phase} must not leave a target Profile`)
    assert.strictEqual(ownedTempExists(target), false, `${phase} must clean its owned temp root`)
  }
}

function testPostCommitFaultLeavesCompleteDraft() {
  const target = createRoot('post-commit')
  assert.throws(
    () => materializeProfileDraft(input(target, { operationId: 'fault-after-commit', faultAt: 'after-commit' })),
    error => error.code === 'PROFILE_MATERIALIZATION_FAULT_INJECTED' && error.profileCommitted === true
  )
  for (const file of Object.keys(contents())) assert.ok(fs.existsSync(path.join(target.profileRoot, file)))
  const persisted = JSON.parse(fs.readFileSync(path.join(target.profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE), 'utf8'))
  assert.strictEqual(persisted.lifecycleState, 'generated-draft')
  assert.strictEqual(verifyProfileReadback(target.profileRoot, persisted.manifest).ok, true)
  assert.strictEqual(ownedTempExists(target), false)

  const recovered = materializeProfileDraft(input(target, { operationId: 'recover-after-commit' }))
  assert.strictEqual(recovered.status, 'unchanged')
  assert.strictEqual(recovered.commit.status, 'existing-target')
  const recoveredPersisted = JSON.parse(fs.readFileSync(path.join(target.profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE), 'utf8'))
  assert.strictEqual(recoveredPersisted.commit.status, 'readback-verified')
}

function testValidationFailureAndRaceAreLocal() {
  const invalid = createRoot('invalid')
  assert.throws(
    () => materializeProfileDraft(input(invalid), {
      validateProfile: () => ({ ok: false, status: 1, validator: 'fixture', errors: ['invalid'], warnings: [] })
    }),
    error => error.code === 'PROFILE_MATERIALIZATION_VALIDATION_FAILED'
  )
  assert.strictEqual(fs.existsSync(invalid.profileRoot), false)
  assert.strictEqual(ownedTempExists(invalid), false)

  const raced = createRoot('race')
  const result = materializeProfileDraft(input(raced), {
    beforeCommit() {
      fs.mkdirSync(raced.profileRoot, { recursive: true })
      fs.writeFileSync(path.join(raced.profileRoot, 'owner.txt'), 'peer\n', 'utf8')
    }
  })
  assert.strictEqual(result.status, 'unchanged-race')
  assert.strictEqual(result.lifecycleState, 'partial-invalid', 'a peer-created incomplete target must never be promoted to reviewed')
  assert.strictEqual(fs.readFileSync(path.join(raced.profileRoot, 'owner.txt'), 'utf8'), 'peer\n')
  assert.strictEqual(ownedTempExists(raced), false)
}

function testTamperedReceiptNeverBecomesReviewed() {
  const target = createRoot('tampered-receipt')
  fs.mkdirSync(target.profileRoot, { recursive: true })
  for (const [file, text] of Object.entries(contents())) {
    fs.writeFileSync(path.join(target.profileRoot, file), text, 'utf8')
  }
  fs.writeFileSync(path.join(target.profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE), JSON.stringify({
    schemaVersion: 'ProfileMaterializationReceiptV1',
    lifecycleState: 'reviewed',
    receiptDigest: '0'.repeat(64)
  }), 'utf8')
  const result = materializeProfileDraft(input(target, { operationId: 'tampered-rerun' }))
  assert.strictEqual(result.status, 'unchanged')
  assert.strictEqual(result.lifecycleState, 'partial-invalid')
  const availability = inspectProfileAvailability({
    binding: {
      projectNamespace: 'apps/api',
      activeRoot: target.runtimeRoot,
      physicalRoot: target.projectRoot
    },
    taskId: 'profile-tamper-test',
    languageContext: { responseLanguage: 'zh-CN' }
  })
  assert.strictEqual(availability.lifecycleState, 'partial-invalid')
  assert.strictEqual(availability.fallback, 'workspace-base/project-facts-unverified')
}

function testContentDriftKeepsUserFilesAndDegradesReceipt() {
  const target = createRoot('content-drift')
  materializeProfileDraft(input(target, { operationId: 'content-drift-create' }))
  const readme = path.join(target.profileRoot, 'README.md')
  fs.appendFileSync(readme, '\nUSER_EDIT_MUST_SURVIVE\n', 'utf8')
  const result = materializeProfileDraft(input(target, { operationId: 'content-drift-rerun' }))
  assert.strictEqual(result.status, 'unchanged')
  assert.strictEqual(result.lifecycleState, 'partial-invalid')
  assert.match(fs.readFileSync(readme, 'utf8'), /USER_EDIT_MUST_SURVIVE/)
  const availability = inspectProfileAvailability({
    binding: { projectNamespace: 'apps/api', activeRoot: target.runtimeRoot, physicalRoot: target.projectRoot },
    taskId: 'profile-content-drift',
    languageContext: { responseLanguage: 'zh-CN' }
  })
  assert.strictEqual(availability.lifecycleState, 'partial-invalid')
}

function testLockConflictDoesNotStealOwner() {
  const target = createRoot('lock')
  const lockKey = crypto.createHash('sha256').update(JSON.stringify({
    profileRoot: target.profileRoot,
    projectIdentity: 'apps/api'
  })).digest('hex').slice(0, 32)
  const lockPath = path.join(target.projectRoot, '.tmp', 'devcodex-profile', '.locks', lockKey)
  fs.mkdirSync(lockPath, { recursive: true })
  fs.writeFileSync(path.join(lockPath, 'owner.json'), '{"operationId":"peer"}\n', 'utf8')
  assert.throws(
    () => materializeProfileDraft(input(target)),
    error => error.code === 'PROFILE_MATERIALIZATION_BUSY'
  )
  assert.strictEqual(fs.existsSync(path.join(lockPath, 'owner.json')), true)
  assert.strictEqual(fs.existsSync(target.profileRoot), false)
}

function testExpiredLockAndOwnedResidueAreRecoveredExactly() {
  const target = createRoot('stale-lock')
  const operationId = 'stale-peer'
  const lockKey = crypto.createHash('sha256').update(JSON.stringify({
    profileRoot: target.profileRoot,
    projectIdentity: 'apps/api'
  })).digest('hex').slice(0, 32)
  const tempBase = path.join(target.projectRoot, '.tmp', 'devcodex-profile')
  const lockPath = path.join(tempBase, '.locks', lockKey)
  const staleOperationRoot = path.join(tempBase, operationId)
  fs.mkdirSync(lockPath, { recursive: true })
  fs.mkdirSync(staleOperationRoot, { recursive: true })
  fs.writeFileSync(path.join(staleOperationRoot, 'owned.txt'), 'stale\n', 'utf8')
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
    schemaVersion: 'ProfileMaterializationLockOwnerV1',
    operationId,
    operationRoot: staleOperationRoot,
    ownerToken: 'stale-owner',
    pid: 999999,
    profileRoot: target.profileRoot,
    expiresAt: new Date(Date.now() - PROFILE_LOCK_LEASE_MS).toISOString()
  }), 'utf8')

  const result = materializeProfileDraft(input(target, { operationId: 'stale-recovery' }))
  assert.strictEqual(result.status, 'committed')
  assert.strictEqual(result.commit.status, 'readback-verified')
  assert.strictEqual(fs.existsSync(staleOperationRoot), false)
  assert.strictEqual(ownedTempExists(target), false)
}

function testLostLockCannotCommitOrDeletePeerLock() {
  const target = createRoot('lost-lock')
  assert.throws(
    () => materializeProfileDraft(input(target, { operationId: 'losing-owner' }), {
      beforeCommit() {
        const lockRoot = path.join(target.projectRoot, '.tmp', 'devcodex-profile', '.locks')
        const lockPath = path.join(lockRoot, fs.readdirSync(lockRoot)[0])
        const ownerPath = path.join(lockPath, 'owner.json')
        const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'))
        fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, ownerToken: 'peer-owner' }), 'utf8')
      }
    }),
    error => error.code === 'PROFILE_MATERIALIZATION_LOCK_LOST' && error.profileCommitted === false
  )
  assert.strictEqual(fs.existsSync(target.profileRoot), false)
  const lockRoot = path.join(target.projectRoot, '.tmp', 'devcodex-profile', '.locks')
  const remainingLocks = fs.readdirSync(lockRoot)
  assert.strictEqual(remainingLocks.length, 1)
  const owner = JSON.parse(fs.readFileSync(path.join(lockRoot, remainingLocks[0], 'owner.json'), 'utf8'))
  assert.strictEqual(owner.ownerToken, 'peer-owner')
  fs.rmSync(path.join(target.projectRoot, '.tmp'), { recursive: true, force: true })
}

try {
  testDryRunIsZeroWrite()
  testCommitReadbackAndRerun()
  testPreCommitFaultsLeaveNoTarget()
  testPostCommitFaultLeavesCompleteDraft()
  testValidationFailureAndRaceAreLocal()
  testTamperedReceiptNeverBecomesReviewed()
  testContentDriftKeepsUserFilesAndDegradesReceipt()
  testLockConflictDoesNotStealOwner()
  testExpiredLockAndOwnedResidueAreRecoveredExactly()
  testLostLockCannotCommitOrDeletePeerLock()
  console.log('Stage B B2 Profile materialization tests passed')
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
}
