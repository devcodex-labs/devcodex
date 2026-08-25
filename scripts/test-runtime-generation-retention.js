'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  acquirePlannedRuntimeGenerationLease,
  acquireRuntimeGenerationLease,
  releaseRuntimeGenerationLease,
  resolveLeasePaths,
  stopAllRuntimeGenerationLeases
} = require('../hooks/_runtime/runtime-generation-lease.cjs')
const {
  RETENTION_STATE_FILE,
  applyRuntimeGenerationGcPlan,
  buildBoundedRuntimeGenerationGcPreview,
  buildRuntimeGenerationGcPlan,
  createRuntimeGenerationGcClaim,
  inspectGenerationTree,
  inspectRuntimeGenerationRetention,
  releaseRuntimeGenerationGcClaim,
  resolveRuntimeGenerationRetentionState
} = require('./lib/runtime-generation-retention.js')
const {
  MAX_VISIBLE_GENERATIONS_PER_ROOT,
  projectRuntimeGenerationGcPlan,
  projectRuntimeGenerationRetentionStatus
} = require('./lib/cli-runtime-commands.js')
const {
  MAX_VISIBLE_COLLECTION_ITEMS,
  MAX_VISIBLE_STATUS_GENERATIONS,
  MAX_VISIBLE_TASKS,
  projectTaskRecoveryDoctor,
  projectTaskRecoveryMaintenance,
  projectTaskRecoveryStore
} = require('./lib/cli-runtime-projection.js')
const { resolveGlobalHostTargets } = require('./lib/global-host-target.js')

const NOW = Date.parse('2026-08-23T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const DIGEST = 'a'.repeat(64)

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function writeJson (file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function createGeneration (runtimeBaseRoot, generationId, createdAt, extra = {}) {
  const runtimeRoot = path.join(runtimeBaseRoot, `runtime-${generationId}`)
  fs.mkdirSync(path.join(runtimeRoot, 'hooks', '_runtime'), { recursive: true })
  writeJson(path.join(runtimeRoot, 'runtime-generation.json'), {
    schemaVersion: 'RuntimeGenerationManifestV1',
    generationId,
    packageName: 'devcodex',
    packageVersion: '1.18.0',
    runtimeContractVersion: 2,
    runtimeRetentionProtocolVersion: 1,
    runtimeContractDigest: DIGEST,
    sourceDigest: sha256(generationId),
    filesDigest: sha256(`${generationId}:files`),
    fileCount: 2,
    createdAt,
    creationTimeAuthority: 'candidate-changelog',
    runtimeRoot: '.',
    immutable: true,
    ...extra
  })
  fs.writeFileSync(path.join(runtimeRoot, 'hooks', '_runtime', 'entry.cjs'), `'use strict'\nmodule.exports = '${generationId}'\n`)
  return runtimeRoot
}

function fileSet (root) {
  const output = []
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()
    if (!fs.existsSync(current)) continue
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      output.push(path.relative(root, absolute).replace(/\\/g, '/'))
      if (entry.isDirectory()) pending.push(absolute)
    }
  }
  return output.sort()
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-runtime-retention-'))
try {
  const runtimeBaseRoot = path.join(tempRoot, '.codex', 'devcodex')
  const current = createGeneration(runtimeBaseRoot, 'current-aaa', '2026-08-22T00:00:00.000Z')
  const live = createGeneration(runtimeBaseRoot, 'live-bbb', '2026-08-18T00:00:00.000Z')
  const grace = createGeneration(runtimeBaseRoot, 'grace-ccc', '2026-08-22T23:30:00.000Z')
  const candidate = createGeneration(runtimeBaseRoot, 'candidate-ddd', '2026-08-18T00:00:00.000Z')
  const pidReuse = createGeneration(runtimeBaseRoot, 'pid-reuse-eee', '2026-08-18T00:00:00.000Z')
  const invalid = path.join(runtimeBaseRoot, 'runtime-invalid-fff')
  fs.mkdirSync(invalid, { recursive: true })
  fs.writeFileSync(path.join(invalid, 'unknown.txt'), 'not owned\n')

  const state = resolveRuntimeGenerationRetentionState(runtimeBaseRoot, {
    nowMs: NOW - 2 * DAY,
    generationId: 'current-aaa'
  })
  assert.strictEqual(state.status, 'planned')
  fs.mkdirSync(runtimeBaseRoot, { recursive: true })
  fs.writeFileSync(state.file, state.content, 'utf8')

  const receiptFile = path.join(runtimeBaseRoot, 'global-host-receipt.json')
  writeJson(receiptFile, {
    schemaVersion: 'GlobalHostConfigReceiptV1',
    host: 'codex',
    runtimeRoot: current.replace(/\\/g, '/'),
    managedPaths: [path.join(current, 'runtime-generation.json').replace(/\\/g, '/')],
    retainedRuntimeRoots: [live, candidate, pidReuse].map(item => item.replace(/\\/g, '/')),
    retainedManagedArtifacts: []
  })
  const target = {
    host: 'codex',
    runtimeBaseRoot,
    runtimeRoot: current,
    receiptFile
  }

  const adoptionBaseRoot = path.join(tempRoot, '.adoption', 'devcodex')
  const adoptionCurrent = createGeneration(adoptionBaseRoot, 'adoption-current', '2026-08-18T00:00:00.000Z')
  const adoptionState = resolveRuntimeGenerationRetentionState(adoptionBaseRoot, {
    nowMs: NOW - 2 * DAY,
    generationId: 'adoption-current'
  })
  fs.mkdirSync(adoptionBaseRoot, { recursive: true })
  fs.writeFileSync(adoptionState.file, adoptionState.content, 'utf8')
  const recentlyAdopted = createGeneration(adoptionBaseRoot, 'recently-adopted', '2025-01-01T00:00:00.000Z')
  const updatedAdoptionState = resolveRuntimeGenerationRetentionState(adoptionBaseRoot, {
    nowMs: NOW,
    generationId: 'adoption-current'
  })
  fs.writeFileSync(updatedAdoptionState.file, updatedAdoptionState.content, 'utf8')
  const recentAdoptionRecord = updatedAdoptionState.state.generationAdoptions
    .find(item => item.generationId === 'recently-adopted')
  assert.strictEqual(recentAdoptionRecord.authority, 'generation-adoption')
  assert.strictEqual(recentAdoptionRecord.adoptedAt, new Date(NOW).toISOString())
  const adoptionReceiptFile = path.join(adoptionBaseRoot, 'global-host-receipt.json')
  writeJson(adoptionReceiptFile, {
    schemaVersion: 'GlobalHostConfigReceiptV1',
    host: 'codex',
    runtimeRoot: adoptionCurrent.replace(/\\/g, '/'),
    managedPaths: [path.join(adoptionCurrent, 'runtime-generation.json').replace(/\\/g, '/')],
    retainedRuntimeRoots: [recentlyAdopted.replace(/\\/g, '/')]
  })
  const adoptionStatus = inspectRuntimeGenerationRetention({
    targets: [{
      host: 'codex',
      runtimeBaseRoot: adoptionBaseRoot,
      runtimeRoot: adoptionCurrent,
      receiptFile: adoptionReceiptFile
    }],
    nowMs: NOW
  })
  assert.strictEqual(
    adoptionStatus.roots[0].generations.find(item => item.generationId === 'recently-adopted').classification,
    'retained-grace',
    'an old release installed locally now must receive a fresh local adoption grace period'
  )

  const liveLease = acquireRuntimeGenerationLease({
    runtimeRoot: live,
    role: 'profile-mcp',
    now: () => NOW,
    heartbeatIntervalMs: 60 * 60 * 1000,
    leaseTtlMs: 2 * 60 * 60 * 1000
  })
  assert.strictEqual(liveLease.status, 'active')
  const repeatedLiveLease = acquireRuntimeGenerationLease({
    runtimeRoot: process.platform === 'win32'
      ? live.replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`)
      : live,
    role: 'profile-mcp',
    now: () => NOW,
    heartbeatIntervalMs: 60 * 60 * 1000,
    leaseTtlMs: 2 * 60 * 60 * 1000
  })
  assert.strictEqual(repeatedLiveLease.leaseFile, liveLease.leaseFile)
  assert.strictEqual(
    fs.readdirSync(path.dirname(liveLease.leaseFile)).filter(name => name.endsWith('.json')).length,
    1,
    'same process/role must reuse one stable lease file'
  )

  const expiredPidReuseLease = acquireRuntimeGenerationLease({
    runtimeRoot: pidReuse,
    role: 'memory-mcp',
    now: () => NOW - 10 * 60 * 1000,
    heartbeatIntervalMs: 60 * 1000,
    leaseTtlMs: 2 * 60 * 1000
  })
  assert.strictEqual(expiredPidReuseLease.status, 'active')

  const status = inspectRuntimeGenerationRetention({
    targets: [target],
    nowMs: NOW
  })
  assert.strictEqual(status.counts.current, 1)
  assert.strictEqual(status.counts['retained-live'], 1)
  assert.strictEqual(status.counts['retained-grace'], 1)
  assert.strictEqual(status.counts['orphan-gc-candidate'], 1)
  assert.strictEqual(status.counts['blocked-unknown'], 2)
  assert(status.roots[0].generations.find(item => item.runtimeRoot === live.replace(/\\/g, '/')).leases.live.length === 1)
  assert.strictEqual(
    status.roots[0].generations.find(item => item.runtimeRoot === pidReuse.replace(/\\/g, '/')).eligible,
    false,
    'an expired lease with a still-visible PID must fail closed without process-start proof'
  )

  const pidIdentityProbe = (pid, lease) => lease.role === 'memory-mcp'
    ? { status: 'dead', reasonCode: 'pid-start-identity-mismatch' }
    : { status: 'live', reasonCode: 'pid-start-identity-match' }
  const verifiedPidReuseStatus = inspectRuntimeGenerationRetention({
    targets: [target],
    nowMs: NOW,
    pidProbe: pidIdentityProbe
  })
  assert.strictEqual(verifiedPidReuseStatus.counts['orphan-gc-candidate'], 2)

  const beforePreview = fileSet(runtimeBaseRoot)
  const preview = buildRuntimeGenerationGcPlan({ targets: [target], nowMs: NOW, pidProbe: pidIdentityProbe })
  assert.strictEqual(preview.applyReady, true)
  assert.strictEqual(preview.totals.candidates, 2)
  assert.deepStrictEqual(fileSet(runtimeBaseRoot), beforePreview, 'preview must be zero-mutation')
  assert(/^[a-f0-9]{64}$/.test(preview.planDigest))
  const boundedEntries = []
  const boundedPages = []
  let boundedCursor = null
  do {
    const page = buildBoundedRuntimeGenerationGcPreview({
      targets: [target],
      nowMs: NOW,
      pidProbe: pidIdentityProbe,
      maxGenerations: 2,
      resumeCursor: boundedCursor
    })
    boundedPages.push(page)
    assert.strictEqual(page.deletedFiles, 0)
    assert.strictEqual(page.deletedDirectories, 0)
    assert.strictEqual(page.reclaimedBytes, 0)
    assert(page.budget.consumedGenerations <= 2)
    boundedEntries.push(...page.manifest.batch.entries.map(item => item.runtimeRoot))
    boundedCursor = page.resumeCursor
  } while (boundedCursor)
  assert.strictEqual(boundedPages.length, 3)
  assert.deepStrictEqual(boundedPages.map(page => page.progress.scanned), [2, 4, 6])
  assert.strictEqual(new Set(boundedEntries).size, boundedEntries.length, 'cursor resume must not repeat an acknowledged generation')
  assert.strictEqual(boundedPages.at(-1).status, 'complete')
  assert.strictEqual(boundedPages.at(-1).phase, 'manifest-ready')
  assert.strictEqual(boundedPages.at(-1).manifestDigest, preview.planDigest)
  assert.deepStrictEqual(fileSet(runtimeBaseRoot), beforePreview, 'all bounded dry-run pages must remain zero-write')
  let clockTick = 0
  const timeBounded = buildBoundedRuntimeGenerationGcPreview({
    targets: [target],
    nowMs: NOW,
    pidProbe: pidIdentityProbe,
    maxGenerations: 128,
    maxElapsedMs: 5,
    clock: () => clockTick++ * 10
  })
  assert.strictEqual(timeBounded.status, 'in-progress')
  assert.strictEqual(timeBounded.budget.consumedGenerations, 1)
  assert.strictEqual(timeBounded.budget.exhaustedBy, 'time-budget')
  assert.ok(timeBounded.resumeCursor, 'time budget exhaustion must return a safe resume cursor')
  const firstBoundedCursor = boundedPages[0].resumeCursor
  const tamperedCursor = `${firstBoundedCursor.slice(0, -1)}${firstBoundedCursor.endsWith('a') ? 'b' : 'a'}`
  assert.strictEqual(
    buildBoundedRuntimeGenerationGcPreview({
      targets: [target],
      nowMs: NOW,
      pidProbe: pidIdentityProbe,
      maxGenerations: 2,
      resumeCursor: tamperedCursor
    }).errorCode,
    'BOUNDED_MAINTENANCE_CURSOR_INVALID'
  )
  const liveLeaseBody = JSON.parse(fs.readFileSync(liveLease.leaseFile, 'utf8'))
  liveLeaseBody.heartbeatAt = new Date(NOW + 60 * 1000).toISOString()
  liveLeaseBody.expiresAt = new Date(NOW + 3 * 60 * 60 * 1000).toISOString()
  writeJson(liveLease.leaseFile, liveLeaseBody)
  assert.strictEqual(
    buildRuntimeGenerationGcPlan({ targets: [target], nowMs: NOW, pidProbe: pidIdentityProbe }).planDigest,
    preview.planDigest,
    'a heartbeat refresh by the same live process must not invalidate a GC plan'
  )

  const lateGrace = createGeneration(runtimeBaseRoot, 'late-grace-ggg', '2026-08-22T23:45:00.000Z')
  assert.strictEqual(
    buildBoundedRuntimeGenerationGcPreview({
      targets: [target],
      nowMs: NOW,
      pidProbe: pidIdentityProbe,
      maxGenerations: 2,
      resumeCursor: firstBoundedCursor
    }).errorCode,
    'BOUNDED_MAINTENANCE_CURSOR_STALE'
  )
  const inventoryStaleApply = applyRuntimeGenerationGcPlan({
    targets: [target],
    nowMs: NOW,
    pidProbe: pidIdentityProbe,
    planDigest: preview.planDigest
  })
  assert.strictEqual(inventoryStaleApply.status, 'blocked')
  assert.strictEqual(inventoryStaleApply.errorCode, 'RUNTIME_GENERATION_GC_PLAN_STALE')
  assert.strictEqual(inventoryStaleApply.removed.length, 0)

  const inventoryBoundPreview = buildRuntimeGenerationGcPlan({
    targets: [target],
    nowMs: NOW,
    pidProbe: pidIdentityProbe
  })
  const manualClaim = createRuntimeGenerationGcClaim(
    inventoryBoundPreview.candidates.find(item => item.runtimeRoot === candidate.replace(/\\/g, '/')),
    inventoryBoundPreview.planDigest,
    { nowMs: NOW }
  )
  const blockedByClaim = acquireRuntimeGenerationLease({
    runtimeRoot: candidate,
    role: 'profile-mcp-claim-race'
  })
  assert.strictEqual(blockedByClaim.status, 'blocked')
  assert.match(blockedByClaim.reasonCode, /gc-claimed/)
  const blockedActivation = acquirePlannedRuntimeGenerationLease({
    runtimeBaseRoot,
    runtimeRoot: candidate,
    generationId: 'candidate-ddd',
    role: 'global-host-activation',
    registerExit: false
  })
  assert.strictEqual(blockedActivation.status, 'blocked')
  const claimRaceFs = Object.create(fs)
  let claimExistenceChecks = 0
  claimRaceFs.existsSync = file => {
    if (path.resolve(file) === path.resolve(manualClaim.claimFile)) {
      claimExistenceChecks += 1
      if (claimExistenceChecks <= 2) return false
    }
    return fs.existsSync(file)
  }
  const racedLeasePaths = resolveLeasePaths(candidate, 'profile-mcp-post-claim-race', process.pid)
  const postWriteClaimRace = acquireRuntimeGenerationLease({
    fs: claimRaceFs,
    runtimeRoot: candidate,
    role: 'profile-mcp-post-claim-race',
    registerExit: false
  })
  assert.strictEqual(postWriteClaimRace.status, 'blocked')
  assert.strictEqual(fs.existsSync(racedLeasePaths.leaseFile), false, 'a post-write claim race must remove only the blocked process lease')
  releaseRuntimeGenerationGcClaim(manualClaim)
  assert.strictEqual(fs.existsSync(manualClaim.claimFile), false)

  const staleOwnerPid = 987654321
  const staleClaim = createRuntimeGenerationGcClaim(
    inventoryBoundPreview.candidates.find(item => item.runtimeRoot === candidate.replace(/\\/g, '/')),
    inventoryBoundPreview.planDigest,
    { nowMs: NOW - 10 * 60 * 1000, pid: staleOwnerPid }
  )
  assert.throws(
    () => createRuntimeGenerationGcClaim(
      inventoryBoundPreview.candidates.find(item => item.runtimeRoot === candidate.replace(/\\/g, '/')),
      inventoryBoundPreview.planDigest,
      {
        nowMs: NOW,
        gcClaimStaleMs: 60 * 1000,
        pidProbe: () => ({ status: 'live', reasonCode: 'pid-visible' })
      }
    ),
    error => error?.code === 'RUNTIME_GENERATION_GC_CLAIM_BLOCKED'
  )
  const recoveredClaim = createRuntimeGenerationGcClaim(
    inventoryBoundPreview.candidates.find(item => item.runtimeRoot === candidate.replace(/\\/g, '/')),
    inventoryBoundPreview.planDigest,
    {
      nowMs: NOW,
      gcClaimStaleMs: 60 * 1000,
      pidProbe: pid => pid === staleOwnerPid
        ? { status: 'dead', reasonCode: 'pid-missing' }
        : { status: 'live', reasonCode: 'pid-visible' }
    }
  )
  assert.notStrictEqual(recoveredClaim.claim.claimId, staleClaim.claim.claimId)
  assert.strictEqual(
    fs.existsSync(resolveLeasePaths(candidate, 'generation-gc', process.pid).staleClaimFile),
    false,
    'a recovered crashed GC claim must not leave a stale coordination file'
  )
  releaseRuntimeGenerationGcClaim(recoveredClaim)

  const strandedClaim = createRuntimeGenerationGcClaim(
    inventoryBoundPreview.candidates.find(item => item.runtimeRoot === candidate.replace(/\\/g, '/')),
    inventoryBoundPreview.planDigest,
    { nowMs: NOW - 10 * 60 * 1000, pid: staleOwnerPid }
  )
  const strandedPaths = resolveLeasePaths(candidate, 'generation-gc', staleOwnerPid)
  fs.renameSync(strandedClaim.claimFile, strandedPaths.staleClaimFile)
  const afterRecoveryCrash = createRuntimeGenerationGcClaim(
    inventoryBoundPreview.candidates.find(item => item.runtimeRoot === candidate.replace(/\\/g, '/')),
    inventoryBoundPreview.planDigest,
    {
      nowMs: NOW,
      gcClaimStaleMs: 60 * 1000,
      pidProbe: pid => pid === staleOwnerPid
        ? { status: 'dead', reasonCode: 'pid-missing' }
        : { status: 'live', reasonCode: 'pid-visible' }
    }
  )
  assert.strictEqual(fs.existsSync(strandedPaths.staleClaimFile), false)
  releaseRuntimeGenerationGcClaim(afterRecoveryCrash)

  const activationLease = acquirePlannedRuntimeGenerationLease({
    runtimeBaseRoot,
    runtimeRoot: candidate,
    generationId: 'candidate-ddd',
    role: 'global-host-activation',
    registerExit: false,
    now: () => NOW,
    heartbeatIntervalMs: 60 * 60 * 1000,
    leaseTtlMs: 2 * 60 * 60 * 1000
  })
  assert.strictEqual(activationLease.status, 'active')
  const activationBlockedApply = applyRuntimeGenerationGcPlan({
    targets: [target],
    nowMs: NOW,
    pidProbe: pidIdentityProbe,
    planDigest: inventoryBoundPreview.planDigest
  })
  assert.strictEqual(activationBlockedApply.status, 'blocked')
  assert.strictEqual(activationBlockedApply.removed.length, 0)
  assert.strictEqual(releaseRuntimeGenerationLease(activationLease), true)

  const racingLease = acquireRuntimeGenerationLease({
    runtimeRoot: candidate,
    role: 'profile-mcp-race',
    now: () => NOW,
    heartbeatIntervalMs: 60 * 60 * 1000,
    leaseTtlMs: 2 * 60 * 60 * 1000
  })
  const staleApply = applyRuntimeGenerationGcPlan({
    targets: [target],
    nowMs: NOW,
    pidProbe: pidIdentityProbe,
    planDigest: inventoryBoundPreview.planDigest
  })
  assert.strictEqual(staleApply.status, 'blocked')
  assert.strictEqual(staleApply.errorCode, 'RUNTIME_GENERATION_GC_PLAN_STALE')
  assert.strictEqual(staleApply.removed.length, 0)
  assert(fs.existsSync(candidate), 'new lease race must preserve the generation')
  fs.unlinkSync(racingLease.leaseFile)

  const freshPreview = buildRuntimeGenerationGcPlan({ targets: [target], nowMs: NOW, pidProbe: pidIdentityProbe })
  assert.strictEqual(freshPreview.totals.candidates, 2)
  const applied = applyRuntimeGenerationGcPlan({
    targets: [target],
    nowMs: NOW,
    pidProbe: pidIdentityProbe,
    planDigest: freshPreview.planDigest
  })
  assert.strictEqual(applied.status, 'complete')
  assert.strictEqual(applied.removed.length, 2)
  assert.strictEqual(applied.reclaimedBytes > 0, true)
  assert.strictEqual(fs.existsSync(candidate), false)
  assert.strictEqual(fs.existsSync(pidReuse), false)
  assert.strictEqual(fs.existsSync(current), true)
  assert.strictEqual(fs.existsSync(live), true)
  assert.strictEqual(fs.existsSync(grace), true)
  assert.strictEqual(fs.existsSync(lateGrace), true)
  assert.strictEqual(fs.existsSync(invalid), true)
  assert.strictEqual(
    applyRuntimeGenerationGcPlan({
      targets: [target],
      nowMs: NOW,
      pidProbe: pidIdentityProbe,
      planDigest: freshPreview.planDigest
    }).status,
    'blocked',
    'replaying a consumed plan must fail closed'
  )

  const reparseProbe = path.join(tempRoot, 'reparse-probe')
  fs.mkdirSync(reparseProbe, { recursive: true })
  fs.writeFileSync(path.join(reparseProbe, 'child.txt'), 'probe')
  const reparseFs = Object.create(fs)
  reparseFs.lstatSync = file => {
    const stat = fs.lstatSync(file)
    if (path.resolve(file) !== path.resolve(path.join(reparseProbe, 'child.txt'))) return stat
    return { ...stat, isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }
  }
  assert.strictEqual(
    inspectGenerationTree(reparseProbe, { fs: reparseFs }).reasonCode,
    'generation-reparse-or-symlink'
  )

  const permissionFs = Object.create(fs)
  permissionFs.readdirSync = (file, options) => {
    if (path.resolve(file) === path.resolve(grace)) {
      const error = new Error('injected access denial')
      error.code = 'EACCES'
      throw error
    }
    return fs.readdirSync(file, options)
  }
  assert.strictEqual(
    inspectGenerationTree(grace, { fs: permissionFs }).reasonCode,
    'EACCES'
  )

  const projection = projectRuntimeGenerationRetentionStatus({
    ...status,
    roots: [{
      ...status.roots[0],
      currentRefs: Array.from({ length: 40 }, (_, index) => `${status.roots[0].runtimeBaseRoot}/runtime-ref-${index}`),
      receipts: status.roots[0].receipts.map(receipt => ({
        ...receipt,
        currentRefs: Array.from({ length: 40 }, (_, index) => `${status.roots[0].runtimeBaseRoot}/runtime-receipt-ref-${index}`)
      })),
      generations: Array.from({ length: MAX_VISIBLE_GENERATIONS_PER_ROOT + 5 }, (_, index) => ({
        ...status.roots[0].generations[0],
        runtimeRoot: `${status.roots[0].runtimeBaseRoot}/runtime-projection-${String(index).padStart(2, '0')}`
      }))
    }]
  })
  assert.strictEqual(projection.roots[0].generations.length, MAX_VISIBLE_STATUS_GENERATIONS)
  assert.strictEqual(projection.roots[0].generationsTruncated, true)
  assert.strictEqual(projection.visibleGenerationLimitTotal, MAX_VISIBLE_STATUS_GENERATIONS)
  assert.strictEqual(projection.roots[0].currentRefCount, 40)
  assert.strictEqual(projection.roots[0].currentRefs.length, MAX_VISIBLE_STATUS_GENERATIONS)
  assert.strictEqual(projection.roots[0].currentRefsTruncated, true)
  assert.strictEqual(projection.roots[0].receipts[0].currentRefCount, 40)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(projection.roots[0].receipts[0], 'currentRefs'), false)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(projection.roots[0].receipts[0], 'receipt'), false)
  const multiRootProjection = projectRuntimeGenerationRetentionStatus({
    ...status,
    roots: Array.from({ length: 6 }, (_, rootIndex) => ({
      ...status.roots[0],
      runtimeBaseRoot: `${status.roots[0].runtimeBaseRoot}-${rootIndex}`,
      generations: Array.from({ length: MAX_VISIBLE_GENERATIONS_PER_ROOT + 5 }, (_, index) => ({
        ...status.roots[0].generations[0],
        classification: index === 0 ? 'current' : 'retained-grace',
        runtimeRoot: `${status.roots[0].runtimeBaseRoot}-${rootIndex}/runtime-projection-${String(index).padStart(2, '0')}`
      }))
    }))
  })
  assert.strictEqual(
    multiRootProjection.roots.reduce((sum, root) => sum + root.generations.length, 0),
    MAX_VISIBLE_STATUS_GENERATIONS,
    'runtime status generation samples must be capped across all hosts, not per host'
  )
  assert.strictEqual(
    multiRootProjection.roots.filter(root => root.generations.some(item => item.classification === 'current')).length,
    6,
    'the global sample must retain every host current generation before grace-only history'
  )
  assert.ok(
    Buffer.byteLength(JSON.stringify(multiRootProjection, null, 2), 'utf8') < 64 * 1024,
    'projected multi-host generation status must remain below 64 KiB'
  )
  const recoveryTasks = Array.from({ length: 40 }, (_, index) => ({
    recoveryKey: `recovery-${index}`,
    taskId: `task-${index}`,
    bytes: 1024 + index,
    kind: 'hot'
  }))
  const projectedStore = projectTaskRecoveryStore({ tasks: recoveryTasks, topTasks: recoveryTasks.slice(0, 10) })
  assert.strictEqual(projectedStore.taskCount, 40)
  assert.strictEqual(projectedStore.tasks.length, MAX_VISIBLE_TASKS)
  assert.strictEqual(projectedStore.tasksTruncated, true)
  const projectedDoctor = projectTaskRecoveryDoctor({
    status: 'WARN',
    checks: Array.from({ length: 40 }, (_, index) => ({ id: `check-${index}`, status: 'PASS' })),
    store: { tasks: recoveryTasks, topTasks: recoveryTasks.slice(0, 10) },
    nextSteps: Array.from({ length: 20 }, (_, index) => ({ code: `NEXT-${index}` }))
  })
  assert.strictEqual(projectedDoctor.checkCount, 40)
  assert.strictEqual(projectedDoctor.checks.length, MAX_VISIBLE_COLLECTION_ITEMS)
  assert.strictEqual(projectedDoctor.store.tasks.length, MAX_VISIBLE_TASKS)
  assert.strictEqual(projectedDoctor.nextSteps.length, MAX_VISIBLE_TASKS)
  const projectedMaintenance = projectTaskRecoveryMaintenance({
    status: 'partial',
    actions: Array.from({ length: 40 }, (_, index) => ({ action: 'coldify', recoveryKey: `recovery-${index}` })),
    failures: Array.from({ length: 40 }, (_, index) => ({ errorCode: 'FIXTURE', recoveryKey: `recovery-${index}` })),
    before: { tasks: recoveryTasks, topTasks: recoveryTasks.slice(0, 10) },
    after: { tasks: recoveryTasks, topTasks: recoveryTasks.slice(0, 10) }
  })
  assert.strictEqual(projectedMaintenance.actionCount, 40)
  assert.strictEqual(projectedMaintenance.actions.length, MAX_VISIBLE_COLLECTION_ITEMS)
  assert.strictEqual(projectedMaintenance.failureCount, 40)
  assert.strictEqual(projectedMaintenance.failures.length, MAX_VISIBLE_COLLECTION_ITEMS)
  assert.strictEqual(projectedMaintenance.before.tasks.length, MAX_VISIBLE_TASKS)
  assert.strictEqual(projectedMaintenance.after.tasks.length, MAX_VISIBLE_TASKS)
  assert.ok(
    Buffer.byteLength(JSON.stringify(projectedMaintenance, null, 2), 'utf8') < 64 * 1024,
    'projected task maintenance output must remain below 64 KiB when formal task count grows'
  )
  const projectedPlan = projectRuntimeGenerationGcPlan({
    ...preview,
    candidates: Array.from({ length: MAX_VISIBLE_GENERATIONS_PER_ROOT + 5 }, (_, index) => ({
      runtimeRoot: `${runtimeBaseRoot}/runtime-candidate-${index}`,
      generationId: `candidate-${index}`
    }))
  })
  assert.strictEqual(projectedPlan.candidates.length, MAX_VISIBLE_GENERATIONS_PER_ROOT)
  assert.strictEqual(projectedPlan.candidatesTruncated, true)
  const projectedApply = projectRuntimeGenerationGcPlan({
    schemaVersion: 'RuntimeGenerationGcApplyReceiptV1',
    status: 'complete',
    planDigest: preview.planDigest,
    removed: Array.from({ length: MAX_VISIBLE_GENERATIONS_PER_ROOT + 5 }, (_, index) => ({ generationId: `removed-${index}` })),
    failed: [],
    reclaimedBytes: 123
  })
  assert.strictEqual(projectedApply.removed.length, MAX_VISIBLE_GENERATIONS_PER_ROOT)
  assert.strictEqual(projectedApply.removedTruncated, true)

  const cliWorkspace = path.join(tempRoot, 'cli-workspace')
  const cliHome = path.join(tempRoot, 'cli-home')
  fs.mkdirSync(cliWorkspace, { recursive: true })
  fs.writeFileSync(path.join(cliWorkspace, 'package.json'), '{"name":"runtime-retention-cli"}\n')
  const cliEnv = { ...process.env, DEVCODEX_TEST_HOME: cliHome }
  for (const key of [
    'COPILOT_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GEMINI_CLI_HOME', 'GROK_HOME', 'CURSOR_HOME',
    'DEVCODEX_GLOBAL_SHARED_ROOT', 'DEVCODEX_GLOBAL_SKILLS_ROOT', 'DEVCODEX_GLOBAL_SKILLS_RUNTIME',
    'DEVCODEX_GLOBAL_FULL_FALLBACK', 'DEVCODEX_VSCODE_MCP_PATH', 'DEVCODEX_VSCODE_USER_DIR'
  ]) delete cliEnv[key]
  const cli = path.resolve(__dirname, '..', 'index.js')
  const runCli = args => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: cliWorkspace,
      env: cliEnv,
      encoding: 'utf8'
    })
    assert.strictEqual(result.status, 0, result.stderr || result.stdout)
    return JSON.parse(result.stdout)
  }
  runCli(['init', '--json'])
  const cliTargets = resolveGlobalHostTargets({
    home: cliHome,
    env: cliEnv,
    packageRoot: path.resolve(__dirname, '..')
  })
  const cliNow = Date.now()
  let cliCandidateRoot = null
  for (const [index, cliTarget] of cliTargets.entries()) {
    const currentId = cliTarget.runtimeGeneration.generationId
    const currentRoot = createGeneration(cliTarget.runtimeBaseRoot, currentId, new Date(cliNow).toISOString())
    const adoptions = [{
      generationId: currentId,
      adoptedAt: new Date(cliNow).toISOString(),
      authority: 'generation-adoption'
    }]
    if (index === 0) {
      cliCandidateRoot = createGeneration(
        cliTarget.runtimeBaseRoot,
        'cli-candidate-old',
        new Date(cliNow - 3 * DAY).toISOString()
      )
      adoptions.push({
        generationId: 'cli-candidate-old',
        adoptedAt: new Date(cliNow - 3 * DAY).toISOString(),
        authority: 'generation-adoption'
      })
    }
    writeJson(path.join(cliTarget.runtimeBaseRoot, RETENTION_STATE_FILE), {
      schemaVersion: 'RuntimeGenerationRetentionStateV1',
      runtimeBaseRoot: cliTarget.runtimeBaseRoot.replace(/\\/g, '/'),
      leaseSchema: 'RuntimeGenerationLeaseV1',
      protocolVersion: 1,
      installedAt: new Date(cliNow - 3 * DAY).toISOString(),
      installedByGeneration: currentId,
      adoptionGraceMs: DAY,
      generationGraceMs: DAY,
      gcPolicy: 'preview-digest-explicit-apply',
      generationAdoptions: adoptions
    })
    writeJson(cliTarget.receiptFile, {
      schemaVersion: 'GlobalHostConfigReceiptV1',
      host: cliTarget.host,
      runtimeRoot: currentRoot.replace(/\\/g, '/'),
      managedPaths: [path.join(currentRoot, 'runtime-generation.json').replace(/\\/g, '/')],
      retainedRuntimeRoots: index === 0 ? [cliCandidateRoot.replace(/\\/g, '/')] : [],
      result: 'committed'
    })
  }
  const cliBatchEntries = []
  let cliCursor = null
  let cliPreview = null
  do {
    cliPreview = runCli([
      'runtime', 'maintenance', '--dry-run', '--generation-budget', '1',
      ...(cliCursor ? ['--resume-cursor', cliCursor] : []),
      '--json'
    ])
    const bounded = cliPreview.payload.runtimeGenerations
    assert.strictEqual(bounded.schemaVersion, 'BoundedMaintenancePreviewV2')
    assert.strictEqual(bounded.deletedFiles, 0)
    assert.strictEqual(bounded.deletedDirectories, 0)
    assert.strictEqual(bounded.budget.maxGenerations, 1)
    cliBatchEntries.push(...bounded.manifest.batch.entries.map(item => item.runtimeRoot))
    if (bounded.resumeCursor) {
      assert.strictEqual(cliPreview.payload.nextStep.action, 'resume-bounded-preview')
      assert.match(cliPreview.payload.nextStep.command, /--resume-cursor/)
    }
    cliCursor = bounded.resumeCursor
  } while (cliCursor)
  const cliGenerationPreview = cliPreview.payload.runtimeGenerations
  const cliPlanDigest = cliGenerationPreview.planDigest
  assert.strictEqual(cliGenerationPreview.status, 'complete')
  assert.strictEqual(cliGenerationPreview.phase, 'manifest-ready')
  assert.strictEqual(cliGenerationPreview.applyReady, true)
  assert.strictEqual(cliGenerationPreview.manifest.totals.candidates, 1)
  assert.strictEqual(cliPreview.payload.nextStep.action, 'review-generation-plan-before-apply')
  assert.strictEqual(new Set(cliBatchEntries).size, cliBatchEntries.length, 'CLI resume cursor must not repeat acknowledged batches')
  const ordinaryApply = runCli(['runtime', 'maintenance', '--apply', '--json'])
  assert.strictEqual(ordinaryApply.payload.runtimeGenerations.schemaVersion, 'BoundedMaintenancePreviewV2')
  assert.strictEqual(ordinaryApply.payload.runtimeGenerations.deletedFiles, 0)
  assert.strictEqual(fs.existsSync(cliCandidateRoot), true, 'ordinary maintenance apply must preserve immutable generations')
  const exactApply = runCli(['runtime', 'maintenance', '--apply', '--generation-plan', cliPlanDigest, '--json'])
  assert.strictEqual(exactApply.payload.runtimeGenerations.status, 'complete')
  assert.strictEqual(exactApply.payload.runtimeGenerations.removedCount, 1)
  assert.strictEqual(fs.existsSync(cliCandidateRoot), false, 'exact CLI plan apply must remove only the planned candidate')

  stopAllRuntimeGenerationLeases()
  assert.strictEqual(fs.existsSync(liveLease.leaseFile), false, 'normal closeout must remove the process lease')
  console.log('runtime generation retention tests passed')
} finally {
  stopAllRuntimeGenerationLeases()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
