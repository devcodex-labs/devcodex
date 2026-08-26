'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildActualInstructionEnvelope,
  buildWorkItemSet,
  digest
} = require('../hooks/_runtime/actual-instruction-envelope.cjs')
const { buildWorkflowRouteDecision } = require('../hooks/_runtime/workflow-route-decision-v2.cjs')
const { validateTaskIdentity } = require('../hooks/_runtime/task-continuation-contract.cjs')
const {
  normalizeIdentity,
  readFencedTaskWriteOwner,
  readTaskAdmissionTransaction,
  readTaskRecoveryState,
  resolveTaskRecoveryMetaDir,
  storePaths,
  taskAdmissionTransactionDigest,
  taskPaths,
  updateTaskRecoveryState
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  computeProjectTargetLeaseDigest,
  createTaskIdentityV2,
  executeTaskAdmission,
  executeTaskWriteOwner,
  executeWorkflowTaskTerminal,
  reconcileWorkflowTaskTerminal
} = require('../mcp/task-admission-authority.cjs')

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-task-admission-'))
const NOW_MS = Date.parse('2026-08-25T00:00:00.000Z')
const STORE_OPTIONS = {
  reserveBytes: 8 * 1024,
  softBytes: 64 * 1024 * 1024,
  hardBytes: 128 * 1024 * 1024,
  diskHeadroomBytes: 0,
  availableDiskBytes: 1024 * 1024 * 1024
}
const KEEP_TEST_ARTIFACTS = process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1'

function setupRoot(name) {
  const physicalRoot = path.join(TEMP_ROOT, name)
  const activeRoot = path.join(physicalRoot, '.devcodex')
  fs.mkdirSync(path.join(activeRoot, 'profile'), { recursive: true })
  fs.writeFileSync(path.join(physicalRoot, 'package.json'), '{}\n')
  return { physicalRoot, activeRoot, project: name }
}

function projectLease(root, envelope, route) {
  const core = {
    schemaVersion: 'ProjectTargetLeaseV2',
    project: root.project,
    targetDigest: '1'.repeat(64),
    rootIdentityDigest: '2'.repeat(64),
    layoutIdentity: '3'.repeat(64),
    physicalRoot: root.physicalRoot,
    activeRoot: root.activeRoot,
    authorityKind: 'session',
    authorityDigest: envelope.hostSessionDigest,
    contextEpoch: envelope.contextEpoch,
    contextBindingDigest: '5'.repeat(64),
    routeRevision: route.routeRevision,
    revocationEpoch: 1,
    issuedAtMs: NOW_MS - 1000,
    expiresAtMs: NOW_MS + 24 * 60 * 60 * 1000
  }
  return { ...core, leaseDigest: computeProjectTargetLeaseDigest(core) }
}

function refreshedProjectLease(lease, overrides = {}) {
  const core = {
    ...lease,
    contextBindingDigest: '6'.repeat(64),
    revocationEpoch: Number(lease.revocationEpoch || 0) + 1,
    expiresAtMs: Number(lease.expiresAtMs) + 60 * 60 * 1000,
    ...overrides
  }
  delete core.leaseDigest
  return { ...core, leaseDigest: computeProjectTargetLeaseDigest(core) }
}

function refreshedIngressContext(input, suffix, contextEpoch) {
  const envelope = buildActualInstructionEnvelope({
    prompt: `修复任务 ${suffix}`,
    session_id: `session-${suffix}`,
    event_id: `event-${suffix}`,
    timestamp: new Date(NOW_MS).toISOString()
  }, {
    hostVariant: 'codex-cli',
    contextEpoch,
    trustedHostEvent: true,
    nowMs: NOW_MS
  })
  const workItemSet = buildWorkItemSet(envelope, {
    workItems: [{
      taskKind: input.workflowRouteDecision.topIntent,
      routeCandidate: input.workflowRouteDecision.routeKey
    }]
  })
  const route = buildWorkflowRouteDecision({
    actualInstructionEnvelope: envelope,
    workItemSet,
    workItemId: workItemSet.items[0].workItemId,
    environmentMode: input.workflowRouteDecision.environmentMode,
    routeKey: input.workflowRouteDecision.routeKey
  })
  return {
    ...input,
    actualInstructionEnvelope: envelope,
    workItemSet,
    workflowRouteDecision: route,
    projectTargetLease: projectLease({
      physicalRoot: input.projectTargetLease.physicalRoot,
      activeRoot: input.activeRoot,
      project: input.project
    }, envelope, route)
  }
}

function legacyAdmissionRequestDigest(input, transaction) {
  return digest({
    operation: input.operation,
    envelopeDigest: input.actualInstructionEnvelope.envelopeDigest,
    workItemSetDigest: input.workItemSet.setDigest,
    workflowRouteDigest: input.workflowRouteDecision.decisionDigest,
    projectTargetLeaseDigest: transaction.projectTargetLeaseDigest,
    taskIdentityDigest: transaction.taskIdentityDigest,
    directoryDecisionDigest: transaction.directoryDecisionDigest,
    overviewDigest: crypto.createHash('sha256').update(String(input.overview.content)).digest('hex'),
    productSourceDigest: input.task.entryVariant === 'product-provided'
      ? crypto.createHash('sha256').update(String(input.overview.productSourceContent)).digest('hex')
      : null,
    admissionPolicyRevision: transaction.admissionPolicyRevision
  })
}

function admissionInput(root, suffix = 'base', overrides = {}) {
  const {
    routeTaskKind = 'fix',
    routeCandidate = 'fix.default',
    ...inputOverrides
  } = overrides
  const envelope = buildActualInstructionEnvelope({
    prompt: `修复任务 ${suffix}`,
    session_id: `session-${suffix}`,
    event_id: `event-${suffix}`,
    timestamp: new Date(NOW_MS).toISOString()
  }, {
    hostVariant: 'codex-cli',
    contextEpoch: `ctx-${suffix}`,
    trustedHostEvent: true,
    nowMs: NOW_MS
  })
  const workItemSet = buildWorkItemSet(envelope, {
    workItems: [{ taskKind: routeTaskKind, routeCandidate }]
  })
  const route = buildWorkflowRouteDecision({
    actualInstructionEnvelope: envelope,
    workItemSet,
    workItemId: workItemSet.items[0].workItemId,
    environmentMode: 'dev',
    routeKey: routeCandidate
  })
  return {
    operation: 'admit',
    activeRoot: root.activeRoot,
    project: root.project,
    actualInstructionEnvelope: envelope,
    workItemSet,
    workflowRouteDecision: route,
    projectTargetLease: projectLease(root, envelope, route),
    task: {
      taskKind: 'bugs',
      entryVariant: 'fix',
      displayName: `任务-${suffix}`,
      aliases: [`别名-${suffix}`]
    },
    overview: { content: `# 问题概况\n\n${suffix}\n` },
    ...inputOverrides
  }
}

function run(input, options = {}) {
  return executeTaskAdmission(input, {
    nowMs: NOW_MS,
    storeOptions: STORE_OPTIONS,
    ...options
  })
}

let ownerNonceSequence = 0

function runOwner(input, nowMs = NOW_MS, options = {}) {
  return executeTaskWriteOwner(input, {
    nowMs,
    storeOptions: STORE_OPTIONS,
    nonceFactory() {
      ownerNonceSequence += 1
      return `owner-${crypto.createHash('sha1').update(String(ownerNonceSequence)).digest('hex')}`
    },
    ...options
  })
}

function ownerInput(ingress, admission, operation, overrides = {}) {
  return {
    operation,
    activeRoot: ingress.activeRoot,
    project: ingress.project,
    actualInstructionEnvelope: ingress.actualInstructionEnvelope,
    workItemSet: ingress.workItemSet,
    workflowRouteDecision: ingress.workflowRouteDecision,
    projectTargetLease: ingress.projectTargetLease,
    taskId: admission.taskId,
    admissionId: admission.admissionId,
    ...overrides
  }
}

function ownerRef(receipt) {
  return receipt.ownerRef || {
    ownerGeneration: receipt.owner.ownerGeneration,
    ownerNonce: receipt.owner.ownerNonce,
    leaseRevision: receipt.owner.leaseRevision,
    leaseDigest: receipt.owner.leaseDigest
  }
}

function confirmCp1(taskRoot, artifactName = '01-问题确认.md') {
  const artifactContent = '# 问题确认\n\n测试确认。\n'
  fs.writeFileSync(path.join(taskRoot, artifactName), artifactContent)
  const artifactDigest = crypto.createHash('sha256').update(artifactContent).digest('hex')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const sessions = fs.readFileSync(sessionsPath, 'utf8')
  const confirmedRow = `| CP1 | ✅ | ${artifactName} | v1 | ${artifactDigest} | test-confirmed | 2026-08-25T00:00:00.000Z |`
  fs.writeFileSync(sessionsPath, sessions.replace(/^\|\s*CP1\s*\|.*$/mu, confirmedRow))
}

function evidenceSet(input, admission, suffix = 'terminal') {
  const taskRoot = taskRootFor(input, admission)
  const taskRootRelative = admission.taskRootRelative.replace(/\\/g, '/')
  const definitions = [
    ['ecr', `${taskRootRelative}/07-ECR-${suffix}.md`, `# ECR ${suffix}\n`],
    ['report', `${taskRootRelative}/reports/codex/${suffix}.md`, `# Report ${suffix}\n`],
    ['memory', `${taskRootRelative}/.memory/${suffix}.md`, `# Memory ${suffix}\n`],
    ['completion', `${taskRootRelative}/06-完成清单-${suffix}.md`, `# Completion ${suffix}\n`]
  ]
  return definitions.map(([role, relative, content]) => {
    const filePath = path.join(input.activeRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    const bytes = Buffer.byteLength(content)
    assert.ok(filePath.startsWith(taskRoot))
    return {
      role,
      path: relative,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      bytes
    }
  })
}

function taskRootFor(input, receipt) {
  return path.join(input.activeRoot, ...receipt.taskRootRelative.split('/'))
}

try {
  const baseRoot = setupRoot('base')
  const baseInput = admissionInput(baseRoot)
  const first = run(baseInput)
  assert.strictEqual(first.schemaVersion, 'FormalTaskAdmissionReceiptV2')
  assert.strictEqual(first.status, 'awaiting-owner-fence')
  assert.strictEqual(first.phase, 'cp-state-written')
  assert.strictEqual(first.finalized, false)
  assert.strictEqual(first.mutationAuthority, false)

  const baseTaskRoot = taskRootFor(baseInput, first)
  const identityPath = path.join(baseTaskRoot, '.memory', 'task.json')
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'))
  assert.strictEqual(identity.schemaVersion, 'TaskIdentityV2')
  assert.strictEqual(validateTaskIdentity(identity).valid, true)
  assert.strictEqual(fs.readFileSync(path.join(baseTaskRoot, '00-问题概况.md'), 'utf8'), baseInput.overview.content)
  const sessions = fs.readFileSync(path.join(baseTaskRoot, '.memory', 'sessions.md'), 'utf8')
  assert.match(sessions, /\| CP1 \| ⏳ \|/u)
  assert.doesNotMatch(sessions, /\| CP1 \| ✅ \|/u)

  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot: baseRoot.activeRoot, project: baseRoot.project })
  const recoveryIdentity = { activeRoot: baseRoot.activeRoot, project: baseRoot.project, taskId: first.taskId }
  const sessionBoundRecovery = readTaskRecoveryState({
    metaDir,
    sessionKey: 'session-base',
    expectedIdentity: { activeRoot: baseRoot.activeRoot, project: baseRoot.project }
  })
  assert.strictEqual(sessionBoundRecovery.status, 'fresh')
  assert.strictEqual(sessionBoundRecovery.identity.taskId, first.taskId)
  const digestBoundRecovery = readTaskRecoveryState({
    metaDir,
    hostSessionDigest: baseInput.actualInstructionEnvelope.hostSessionDigest,
    expectedIdentity: { activeRoot: baseRoot.activeRoot, project: baseRoot.project }
  })
  assert.strictEqual(digestBoundRecovery.status, 'fresh')
  assert.strictEqual(digestBoundRecovery.identity.taskId, first.taskId)
  const beforeReplay = readTaskAdmissionTransaction({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(beforeReplay.status, 'fresh')
  assert.strictEqual(beforeReplay.transaction.phase, 'cp-state-written')
  const beforeSequence = beforeReplay.envelope.sequence
  const beforeFiles = fs.readdirSync(storePaths(metaDir).tasks, { recursive: true }).map(String).sort()
  for (let index = 0; index < 100; index += 1) {
    const replay = run(baseInput)
    assert.strictEqual(replay.admissionId, first.admissionId)
    assert.strictEqual(replay.taskId, first.taskId)
    assert.strictEqual(replay.replayed, true)
  }
  const refreshedBaseInput = {
    ...baseInput,
    projectTargetLease: refreshedProjectLease(baseInput.projectTargetLease)
  }
  const refreshedReplay = run(refreshedBaseInput)
  assert.strictEqual(refreshedReplay.admissionId, first.admissionId)
  assert.strictEqual(refreshedReplay.replayed, true, 'lease TTL/context-plan refresh must preserve admission idempotency')
  const nextContextBaseInput = refreshedIngressContext(baseInput, 'base', 'ctx-base-next-turn')
  assert.notStrictEqual(nextContextBaseInput.actualInstructionEnvelope.envelopeDigest, baseInput.actualInstructionEnvelope.envelopeDigest)
  assert.notStrictEqual(nextContextBaseInput.workflowRouteDecision.decisionDigest, baseInput.workflowRouteDecision.decisionDigest)
  assert.strictEqual(nextContextBaseInput.actualInstructionEnvelope.actualInstructionDigest, baseInput.actualInstructionEnvelope.actualInstructionDigest)
  assert.strictEqual(nextContextBaseInput.workflowRouteDecision.workItemDigest, baseInput.workflowRouteDecision.workItemDigest)
  const nextContextReplay = run(nextContextBaseInput)
  assert.strictEqual(nextContextReplay.admissionId, first.admissionId)
  assert.strictEqual(nextContextReplay.replayed, true, 'a real next-turn context refresh must preserve semantic admission idempotency')
  assert.throws(
    () => run({
      ...nextContextBaseInput,
      projectTargetLease: refreshedProjectLease(nextContextBaseInput.projectTargetLease, { targetDigest: '7'.repeat(64) })
    }),
    error => error.code === 'TASK_ADMISSION_IDEMPOTENCY_CONFLICT',
    'a semantic project target drift must not replay an existing admission'
  )
  const afterReplay = readTaskAdmissionTransaction({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(afterReplay.envelope.sequence, beforeSequence)
  assert.deepStrictEqual(fs.readdirSync(storePaths(metaDir).tasks, { recursive: true }).map(String).sort(), beforeFiles)

  const identityBytes = fs.readFileSync(identityPath)
  const overviewBytes = fs.readFileSync(path.join(baseTaskRoot, '00-问题概况.md'))
  assert.throws(
    () => run({ ...baseInput, overview: { content: '# 不同内容\n' } }),
    error => error.code === 'TASK_ADMISSION_IDEMPOTENCY_CONFLICT'
  )
  assert.deepStrictEqual(fs.readFileSync(identityPath), identityBytes)
  assert.deepStrictEqual(fs.readFileSync(path.join(baseTaskRoot, '00-问题概况.md')), overviewBytes)
  fs.writeFileSync(path.join(baseTaskRoot, '00-问题概况.md'), '# 被篡改的概况\n')
  assert.throws(() => run(baseInput), error => error.code === 'TASK_ADMISSION_READBACK_MISMATCH')
  fs.writeFileSync(path.join(baseTaskRoot, '00-问题概况.md'), overviewBytes)

  const productRoot = setupRoot('product-provided')
  const productOverview = '# 需求概况\n\n来源：用户直接提供完整产品需求；本文件只保存来源、范围与映射。\n'
  const productSource = '# 产品需求\n\n这是用户提供的原始产品真相，准入链不得改写。\n'
  const productInput = admissionInput(productRoot, 'product-provided', {
    routeTaskKind: 'dev',
    routeCandidate: 'dev.default',
    task: {
      taskKind: 'requirements',
      entryVariant: 'product-provided',
      displayName: '产品提供型需求',
      aliases: ['原始产品需求']
    },
    overview: {
      content: productOverview,
      productSourceContent: productSource
    }
  })
  const productAdmission = run(productInput)
  const productTaskRoot = taskRootFor(productInput, productAdmission)
  const productOverviewPath = path.join(productTaskRoot, '00-需求概况.md')
  const productSourcePath = path.join(productTaskRoot, '01-产品需求.md')
  assert.strictEqual(fs.readFileSync(productOverviewPath, 'utf8'), productOverview)
  assert.strictEqual(fs.readFileSync(productSourcePath, 'utf8'), productSource)
  assert.strictEqual(fs.existsSync(path.join(productTaskRoot, '01-需求确认.md')), false)
  assert.match(fs.readFileSync(path.join(productTaskRoot, '.memory', 'sessions.md'), 'utf8'), /\| CP1 \| ⏳ \|/u)
  const productOverviewBytes = fs.readFileSync(productOverviewPath)
  const productSourceBytes = fs.readFileSync(productSourcePath)
  const productReplay = run(productInput)
  assert.strictEqual(productReplay.admissionId, productAdmission.admissionId)
  assert.strictEqual(productReplay.taskId, productAdmission.taskId)
  assert.strictEqual(productReplay.replayed, true)
  assert.throws(() => run({
    ...productInput,
    overview: { ...productInput.overview, productSourceContent: `${productSource}\n不得替换。\n` }
  }), error => error.code === 'TASK_ADMISSION_IDEMPOTENCY_CONFLICT')
  assert.deepStrictEqual(fs.readFileSync(productOverviewPath), productOverviewBytes)
  assert.deepStrictEqual(fs.readFileSync(productSourcePath), productSourceBytes)

  const legacyReplayRoot = setupRoot('legacy-request-digest-replay')
  const legacyReplayInput = admissionInput(legacyReplayRoot, 'legacy-request-digest-replay')
  const legacyReplayAdmission = run(legacyReplayInput)
  const legacyReplayMetaDir = resolveTaskRecoveryMetaDir({
    activeRoot: legacyReplayRoot.activeRoot,
    project: legacyReplayRoot.project
  })
  const legacyReplayIdentity = {
    activeRoot: legacyReplayRoot.activeRoot,
    project: legacyReplayRoot.project,
    taskId: legacyReplayAdmission.taskId
  }
  const legacyReplayRead = readTaskAdmissionTransaction({ metaDir: legacyReplayMetaDir, identity: legacyReplayIdentity })
  const legacyTransaction = JSON.parse(JSON.stringify(legacyReplayRead.transaction))
  delete legacyTransaction.requestDigestSchema
  delete legacyTransaction.requestDigestSemantics
  delete legacyTransaction.projectTargetLeaseBindingDigest
  legacyTransaction.requestDigest = legacyAdmissionRequestDigest(legacyReplayInput, legacyTransaction)
  legacyTransaction.transactionDigest = taskAdmissionTransactionDigest(legacyTransaction)
  const legacyDowngrade = updateTaskRecoveryState({
    metaDir: legacyReplayMetaDir,
    identity: legacyReplayIdentity
  }, state => ({ ...state, admissionTransaction: legacyTransaction }), STORE_OPTIONS)
  assert.strictEqual(legacyDowngrade.status, 'committed')
  const legacyLeaseReplay = run({
    ...legacyReplayInput,
    projectTargetLease: refreshedProjectLease(legacyReplayInput.projectTargetLease)
  })
  assert.strictEqual(legacyLeaseReplay.admissionId, legacyReplayAdmission.admissionId)
  assert.strictEqual(legacyLeaseReplay.replayed, true, 'pre-V2 request digests must replay across lease-only refresh')
  fs.writeFileSync(productSourcePath, '# 被篡改的产品需求\n')
  assert.throws(() => run(productInput), error => error.code === 'TASK_ADMISSION_READBACK_MISMATCH')
  fs.writeFileSync(productSourcePath, productSourceBytes)

  const ownerRoot = setupRoot('owner-transitions')
  const ownerAdmissionInput = admissionInput(ownerRoot, 'owner-transitions')
  const ownerAdmission = run(ownerAdmissionInput)
  const initialAcquireInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'acquire', {
    expectedOwner: { mode: 'absent' }
  })
  const initialOwner = runOwner(initialAcquireInput)
  assert.strictEqual(initialOwner.finalized, true)
  assert.strictEqual(initialOwner.cp1Confirmed, false)
  assert.strictEqual(initialOwner.mutationAuthority, false)
  assert.strictEqual(runOwner(initialAcquireInput).replayed, true, 'acquire response-loss retry must be exact replay')
  const prematureTerminalInput = {
    ...ownerInput(ownerAdmissionInput, ownerAdmission, 'release', { expectedOwner: ownerRef(initialOwner) }),
    terminalStatus: 'completed',
    evidence: evidenceSet(ownerAdmissionInput, ownerAdmission, 'premature')
  }
  delete prematureTerminalInput.operation
  assert.throws(
    () => executeWorkflowTaskTerminal(prematureTerminalInput, { nowMs: NOW_MS, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_CP_CONFIRMATION_REQUIRED'
  )

  confirmCp1(taskRootFor(ownerAdmissionInput, ownerAdmission))
  const firstRenewInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'renew', {
    expectedOwner: ownerRef(initialOwner)
  })
  const firstRenew = runOwner(firstRenewInput)
  assert.strictEqual(firstRenew.cp1Confirmed, true)
  assert.strictEqual(firstRenew.mutationAuthority, true)
  assert.strictEqual(runOwner(firstRenewInput).replayed, true, 'renew response-loss retry must not advance the lease')
  const secondRenewInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'renew', {
    expectedOwner: ownerRef(firstRenew)
  })
  const secondRenew = runOwner(secondRenewInput)
  assert(secondRenew.owner.leaseRevision > firstRenew.owner.leaseRevision)
  assert.throws(
    () => runOwner(firstRenewInput),
    error => error.code === 'TASK_WRITE_OWNER_CAS_MISMATCH',
    'an older renew request must not replay after a newer owner transition'
  )

  const ownerNextContextInput = refreshedIngressContext(
    ownerAdmissionInput,
    'owner-transitions',
    'ctx-owner-transitions-next-turn'
  )
  const ownerNextContextAdmission = run(ownerNextContextInput)
  assert.strictEqual(ownerNextContextAdmission.admissionId, ownerAdmission.admissionId)
  assert.strictEqual(ownerNextContextAdmission.replayed, true)
  const nextContextRenewInput = ownerInput(ownerNextContextInput, ownerAdmission, 'renew', {
    expectedOwner: ownerRef(secondRenew)
  })
  const nextContextRenew = runOwner(nextContextRenewInput)
  assert.strictEqual(nextContextRenew.owner.contextEpoch, 'ctx-owner-transitions-next-turn')
  assert.strictEqual(nextContextRenew.owner.sessionDigest, secondRenew.owner.sessionDigest)
  assert.strictEqual(runOwner(nextContextRenewInput).replayed, true, 'same-session next-context renew must replay exactly')

  const releaseInput = ownerInput(ownerNextContextInput, ownerAdmission, 'release', {
    expectedOwner: ownerRef(nextContextRenew)
  })
  const released = runOwner(releaseInput)
  assert.strictEqual(released.status, 'released')
  assert.strictEqual(runOwner(releaseInput).replayed, true)
  const reacquireInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'acquire', {
    expectedOwner: ownerRef(released)
  })
  const reacquired = runOwner(reacquireInput)
  assert.strictEqual(reacquired.status, 'active')
  assert.strictEqual(reacquired.mutationAuthority, true)
  assert(reacquired.owner.ownerGeneration > released.owner.ownerGeneration)
  assert.strictEqual(runOwner(reacquireInput).replayed, true)
  assert.throws(() => runOwner(releaseInput), error => error.code === 'TASK_WRITE_OWNER_CAS_MISMATCH')

  const handoffIngress = admissionInput(ownerRoot, 'handoff-target')
  const handoffPrepareInput = ownerInput(ownerAdmissionInput, ownerAdmission, 'handoff-prepare', {
    expectedOwner: ownerRef(reacquired),
    targetSessionDigest: handoffIngress.projectTargetLease.authorityDigest
  })
  const handoffPrepared = runOwner(handoffPrepareInput)
  assert.strictEqual(handoffPrepared.status, 'handoff-pending')
  assert.strictEqual(runOwner(handoffPrepareInput).replayed, true)
  const handoffAcceptInput = ownerInput(handoffIngress, ownerAdmission, 'handoff-accept', {
    expectedOwner: ownerRef(handoffPrepared),
    handoffRefDigest: handoffPrepared.owner.handoffRef.refDigest
  })
  const handoffAccepted = runOwner(handoffAcceptInput)
  assert.strictEqual(handoffAccepted.owner.sessionDigest, handoffIngress.projectTargetLease.authorityDigest)
  assert.strictEqual(runOwner(handoffAcceptInput).replayed, true)
  assert.throws(
    () => runOwner(ownerInput(ownerAdmissionInput, ownerAdmission, 'renew', { expectedOwner: ownerRef(reacquired) })),
    error => error.code === 'TASK_WRITE_OWNER_CAS_MISMATCH'
  )

  const takeoverAt = NOW_MS + 31 * 60 * 1000
  const takeoverIngress = admissionInput(ownerRoot, 'takeover-target')
  const takeoverPrepareInput = ownerInput(takeoverIngress, ownerAdmission, 'takeover-prepare', {
    expectedOwner: ownerRef(handoffAccepted),
    serverObservation: {
      canonicalTaskReadback: true,
      noLiveTurn: true,
      reconcileReceiptDigest: '6'.repeat(64)
    }
  })
  const takeoverPrepared = runOwner(takeoverPrepareInput, takeoverAt)
  assert.strictEqual(takeoverPrepared.status, 'takeover-pending')
  assert.strictEqual(runOwner(takeoverPrepareInput, takeoverAt).replayed, true)
  const takeoverAcceptInput = ownerInput(takeoverIngress, ownerAdmission, 'takeover-accept', {
    expectedOwner: ownerRef(takeoverPrepared),
    takeoverRefDigest: takeoverPrepared.owner.takeoverRef.refDigest
  })
  const takeoverAccepted = runOwner(takeoverAcceptInput, takeoverAt)
  assert.strictEqual(takeoverAccepted.status, 'active')
  assert.strictEqual(runOwner(takeoverAcceptInput, takeoverAt).replayed, true)

  const rescueAt = takeoverAt + 31 * 60 * 1000
  const firstRescueIngress = admissionInput(ownerRoot, 'first-rescue')
  const firstRescueInput = ownerInput(firstRescueIngress, ownerAdmission, 'takeover-prepare', {
    expectedOwner: ownerRef(takeoverAccepted),
    serverObservation: { canonicalTaskReadback: true, noLiveTurn: true, reconcileReceiptDigest: '7'.repeat(64) }
  })
  const firstRescue = runOwner(firstRescueInput, rescueAt)
  const secondRescueIngress = admissionInput(ownerRoot, 'second-rescue')
  const secondRescueInput = ownerInput(secondRescueIngress, ownerAdmission, 'takeover-prepare', {
    expectedOwner: ownerRef(firstRescue),
    serverObservation: { canonicalTaskReadback: true, noLiveTurn: true, reconcileReceiptDigest: '8'.repeat(64) }
  })
  const secondRescue = runOwner(secondRescueInput, rescueAt + 1)
  assert.strictEqual(secondRescue.status, 'takeover-pending', 'an expired pending takeover must remain recoverable')
  assert(secondRescue.owner.ownerGeneration > firstRescue.owner.ownerGeneration)
  const secondRescueAcceptInput = ownerInput(secondRescueIngress, ownerAdmission, 'takeover-accept', {
    expectedOwner: ownerRef(secondRescue),
    takeoverRefDigest: secondRescue.owner.takeoverRef.refDigest
  })
  const terminalOwner = runOwner(secondRescueAcceptInput, rescueAt + 1)

  const terminalEvidence = evidenceSet(ownerAdmissionInput, ownerAdmission)
  const duplicateEvidence = terminalEvidence.map(item => ({ ...item }))
  duplicateEvidence[3] = { ...duplicateEvidence[0], role: 'completion' }
  const terminalAt = rescueAt + 1000
  const terminalCommand = {
    ...ownerInput(secondRescueIngress, ownerAdmission, 'release', {
      expectedOwner: ownerRef(terminalOwner)
    }),
    terminalStatus: 'completed',
    evidence: duplicateEvidence
  }
  delete terminalCommand.operation
  assert.throws(
    () => executeWorkflowTaskTerminal(terminalCommand, { nowMs: terminalAt, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_EVIDENCE_DUPLICATE'
  )
  terminalCommand.evidence = terminalEvidence
  const terminal = executeWorkflowTaskTerminal(terminalCommand, { nowMs: terminalAt, storeOptions: STORE_OPTIONS })
  assert.strictEqual(terminal.status, 'terminal')
  assert.strictEqual(terminal.mutationAuthority, false)
  const terminalReplay = executeWorkflowTaskTerminal(terminalCommand, { nowMs: terminalAt, storeOptions: STORE_OPTIONS })
  assert.strictEqual(terminalReplay.replayed, true)
  assert.throws(
    () => executeWorkflowTaskTerminal({ ...terminalCommand, terminalStatus: 'failed' }, { nowMs: terminalAt, storeOptions: STORE_OPTIONS }),
    error => error.code === 'TASK_TERMINAL_REPLAY_MISMATCH'
  )
  assert.throws(
    () => runOwner(secondRescueAcceptInput, terminalAt),
    error => error.code === 'TASK_WRITE_OWNER_MISSING'
  )

  const reopenAt = terminalAt + 1000
  const reopenIngress = admissionInput(ownerRoot, 'owner-reopen', {
    operation: 'bind',
    task: {
      taskId: ownerAdmission.taskId,
      taskKind: 'bugs',
      entryVariant: 'reopen',
      taskRootRelative: ownerAdmission.taskRootRelative
    },
    overview: { content: ownerAdmissionInput.overview.content }
  })
  const reopenedAdmission = run(reopenIngress, { nowMs: reopenAt })
  assert.strictEqual(reopenedAdmission.admissionGeneration, ownerAdmission.admissionGeneration + 1)
  const terminalOwnerRef = {
    ownerGeneration: terminal.owner.ownerGeneration,
    ownerNonce: terminal.owner.ownerNonce,
    leaseRevision: terminal.owner.leaseRevision,
    leaseDigest: terminal.owner.leaseDigest
  }
  assert.throws(
    () => runOwner(ownerInput(reopenIngress, reopenedAdmission, 'reopen', {
      expectedOwner: { ...terminalOwnerRef, leaseDigest: '9'.repeat(64) }
    }), reopenAt),
    error => error.code === 'TASK_WRITE_OWNER_CAS_MISMATCH'
  )
  const reopenedOwnerInput = ownerInput(reopenIngress, reopenedAdmission, 'reopen', {
    expectedOwner: terminalOwnerRef
  })
  const reopenedOwner = runOwner(reopenedOwnerInput, reopenAt)
  assert.strictEqual(reopenedOwner.status, 'active')
  assert.strictEqual(reopenedOwner.admissionGeneration, reopenedAdmission.admissionGeneration)
  assert.strictEqual(reopenedOwner.mutationAuthority, true)
  assert(reopenedOwner.owner.ownerGeneration > terminal.owner.ownerGeneration)
  assert.strictEqual(runOwner(reopenedOwnerInput, reopenAt).replayed, true)

  const crashStages = [
    'after-prepared',
    'after-task-directory-effect',
    'after-identity-effect',
    'after-identity-written',
    'after-overview-effect',
    'after-overview-written',
    'after-cp-state-effect',
    'after-cp-state-written'
  ]
  for (const [index, stage] of crashStages.entries()) {
    const root = setupRoot(`crash-${index}`)
    const input = admissionInput(root, `crash-${index}`)
    let injected = false
    assert.throws(() => run(input, {
      faultInjector(observedStage) {
        if (!injected && observedStage === stage) {
          injected = true
          const error = new Error(`simulated crash at ${stage}`)
          error.code = 'TASK_ADMISSION_CRASH_INJECTED'
          error.simulatedCrash = true
          throw error
        }
      }
    }), error => error.code === 'TASK_ADMISSION_CRASH_INJECTED')
    const resumed = run(input)
    assert.strictEqual(resumed.phase, 'cp-state-written', stage)
    assert.strictEqual(resumed.status, 'awaiting-owner-fence', stage)
    assert.strictEqual(validateTaskIdentity(JSON.parse(fs.readFileSync(path.join(taskRootFor(input, resumed), '.memory', 'task.json'), 'utf8'))).valid, true)
  }

  const ownerCrashStages = ['after-owner-fenced', 'after-admission-finalized']
  for (const [index, stage] of ownerCrashStages.entries()) {
    const root = setupRoot(`owner-crash-${index}`)
    const input = admissionInput(root, `owner-crash-${index}`)
    const admission = run(input)
    confirmCp1(taskRootFor(input, admission))
    const acquireInput = ownerInput(input, admission, 'acquire', { expectedOwner: { mode: 'absent' } })
    assert.throws(() => runOwner(acquireInput, NOW_MS, {
      faultInjector(observedStage) {
        if (observedStage === stage) {
          const error = new Error(`simulated owner crash at ${stage}`)
          error.code = 'TASK_WRITE_OWNER_CRASH_INJECTED'
          throw error
        }
      }
    }), error => error.code === 'TASK_WRITE_OWNER_CRASH_INJECTED')
    const resumed = runOwner(acquireInput)
    assert.strictEqual(resumed.status, 'active', stage)
    assert.strictEqual(resumed.finalized, true, stage)
    assert.strictEqual(resumed.mutationAuthority, true, stage)
    assert.strictEqual(resumed.replayed, true, stage)
  }

  const reserveRoot = setupRoot('terminal-reserve')
  const reserveInput = admissionInput(reserveRoot, 'terminal-reserve')
  const reserveAdmission = run(reserveInput)
  confirmCp1(taskRootFor(reserveInput, reserveAdmission))
  const reserveOwner = runOwner(ownerInput(reserveInput, reserveAdmission, 'acquire', {
    expectedOwner: { mode: 'absent' }
  }))
  const reserveEvidence = evidenceSet(reserveInput, reserveAdmission, 'reserve')
  const reserveTerminalInput = {
    ...ownerInput(reserveInput, reserveAdmission, 'release', { expectedOwner: ownerRef(reserveOwner) }),
    terminalStatus: 'completed',
    evidence: reserveEvidence
  }
  delete reserveTerminalInput.operation
  const reservedTerminal = executeWorkflowTaskTerminal(reserveTerminalInput, {
    nowMs: NOW_MS + 1000,
    storeOptions: { ...STORE_OPTIONS, reserveBytes: 8 * 1024 * 1024, softBytes: 1, hardBytes: 1 }
  })
  assert.strictEqual(reservedTerminal.status, 'terminal-closeout-reserved')
  const reserveMetaDir = resolveTaskRecoveryMetaDir({ activeRoot: reserveRoot.activeRoot, project: reserveRoot.project })
  const reserveIdentity = {
    activeRoot: reserveRoot.activeRoot,
    project: reserveRoot.project,
    taskId: reserveAdmission.taskId,
    taskStatus: 'completed'
  }
  const reserveRead = readFencedTaskWriteOwner({ metaDir: reserveMetaDir, identity: reserveIdentity })
  assert.strictEqual(reserveRead.status, 'fresh')
  assert.strictEqual(reserveRead.source, 'closeout-reserve')
  assert.strictEqual(reserveRead.owner.status, 'terminal')
  const reconciledTerminal = reconcileWorkflowTaskTerminal({
    activeRoot: reserveRoot.activeRoot,
    project: reserveRoot.project,
    taskId: reserveAdmission.taskId,
    sessionKey: reserveInput.actualInstructionEnvelope.hostSessionDigest
  }, { nowMs: NOW_MS + 2000, ...STORE_OPTIONS, reserveBytes: 8 * 1024 * 1024 })
  assert.ok(['committed', 'semantic-noop'].includes(reconciledTerminal.status))
  const reconciledRead = readFencedTaskWriteOwner({
    metaDir: reserveMetaDir,
    identity: reserveIdentity
  }, { ignoreReserve: true })
  assert.strictEqual(reconciledRead.source, 'primary')
  assert.strictEqual(reconciledRead.owner.status, 'terminal')

  const invalidRoot = setupRoot('invalid-existing-state')
  const invalidInput = admissionInput(invalidRoot, 'invalid-existing-state')
  const invalidAdmission = run(invalidInput)
  const invalidMetaDir = resolveTaskRecoveryMetaDir({ activeRoot: invalidRoot.activeRoot, project: invalidRoot.project })
  const invalidIdentity = {
    activeRoot: invalidRoot.activeRoot,
    project: invalidRoot.project,
    taskId: invalidAdmission.taskId,
    taskStatus: 'active'
  }
  const invalidOwnerRead = readFencedTaskWriteOwner({ metaDir: invalidMetaDir, identity: invalidIdentity })
  const invalidSlots = taskPaths(storePaths(invalidMetaDir), invalidOwnerRead.identity.recoveryKey).slots
    .filter(file => fs.existsSync(file))
  assert(invalidSlots.length > 0)
  for (const file of invalidSlots) fs.writeFileSync(file, '{"corrupt":')
  const corruptedBytes = invalidSlots.map(file => fs.readFileSync(file))
  const invalidUpdate = updateTaskRecoveryState({
    metaDir: invalidMetaDir,
    identity: invalidIdentity,
    readFallback: () => ({ fallbackMustNotRun: true })
  }, state => ({ ...state, overwritten: true }), STORE_OPTIONS)
  assert.strictEqual(invalidUpdate.status, 'error')
  assert.strictEqual(invalidUpdate.observedStatus, 'invalid')
  assert.deepStrictEqual(invalidSlots.map(file => fs.readFileSync(file)), corruptedBytes)

  const mismatchIdentity = normalizeIdentity({
    activeRoot: invalidRoot.activeRoot,
    project: invalidRoot.project,
    taskId: '7de2e0ac-d762-4a9c-8f35-2cc0b736cd48',
    taskStatus: 'active'
  })
  const sourceEnvelope = JSON.parse(fs.readFileSync(storePaths(reserveMetaDir).tasks
    ? taskPaths(storePaths(reserveMetaDir), reserveRead.identity.recoveryKey).slots.find(file => fs.existsSync(file))
    : '', 'utf8'))
  const mismatchPaths = taskPaths(storePaths(invalidMetaDir), mismatchIdentity.recoveryKey)
  fs.mkdirSync(mismatchPaths.dir, { recursive: true })
  fs.writeFileSync(mismatchPaths.slots[0], `${JSON.stringify(sourceEnvelope, null, 2)}\n`)
  const mismatchBefore = fs.readFileSync(mismatchPaths.slots[0])
  const mismatchUpdate = updateTaskRecoveryState({
    metaDir: invalidMetaDir,
    identity: mismatchIdentity,
    readFallback: () => ({ fallbackMustNotRun: true })
  }, state => ({ ...state, overwritten: true }), STORE_OPTIONS)
  assert.strictEqual(mismatchUpdate.status, 'error')
  assert.strictEqual(mismatchUpdate.observedStatus, 'identity-mismatch')
  assert.deepStrictEqual(fs.readFileSync(mismatchPaths.slots[0]), mismatchBefore)

  const adoptRoot = setupRoot('adopt')
  const adoptTaskId = '9d734fb0-6099-4f9e-a5d0-8e10a764b511'
  const adoptRelative = 'bugs/Legacy待采用任务'
  const adoptTaskRoot = path.join(adoptRoot.activeRoot, ...adoptRelative.split('/'))
  fs.mkdirSync(path.join(adoptTaskRoot, '.memory'), { recursive: true })
  const legacyIdentity = {
    schemaVersion: 'TaskIdentityV1',
    taskId: adoptTaskId,
    displayName: 'Legacy待采用任务',
    aliases: ['Legacy旧名称'],
    createdAt: '2026-08-20T00:00:00.000Z',
    identityRevision: 1
  }
  fs.writeFileSync(path.join(adoptTaskRoot, '.memory', 'task.json'), `${JSON.stringify(legacyIdentity, null, 2)}\n`)
  const legacyArtifactRelative = 'reports/codex/20260823/04--legacy-cp1.md'
  const legacyArtifactPath = path.join(adoptTaskRoot, ...legacyArtifactRelative.split('/'))
  const legacyArtifactContent = '# Legacy CP1\n\n已确认。\n'
  fs.mkdirSync(path.dirname(legacyArtifactPath), { recursive: true })
  fs.writeFileSync(legacyArtifactPath, legacyArtifactContent)
  const legacyArtifactDigest = crypto.createHash('sha256').update(legacyArtifactContent).digest('hex')
  fs.writeFileSync(path.join(adoptTaskRoot, '.memory', 'sessions.md'), [
    '# Legacy待采用任务 — 工作流状态',
    '',
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|',
    `| CP1 | ✅ | [${legacyArtifactRelative}](../${legacyArtifactRelative}) | v1 | \`${legacyArtifactDigest.toUpperCase()}\` | user-confirmed | 21:32 |`,
    '| CP2 | ⏹️ | — | — | — | — | — |',
    '| CP3 | ⏹️ | — | — | — | — | — |',
    ''
  ].join('\n'))
  const adoptInput = admissionInput(adoptRoot, 'adopt', {
    operation: 'adopt',
    routeTaskKind: 'resume',
    routeCandidate: 'resume',
    task: {
      taskId: adoptTaskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: adoptRelative
    },
    overview: { content: '# 问题概况\n\n采用 legacy task。\n' }
  })
  const adopted = run(adoptInput)
  assert.strictEqual(adopted.phase, 'cp-state-written')
  const adoptMetaDir = resolveTaskRecoveryMetaDir({ activeRoot: adoptRoot.activeRoot, project: adoptRoot.project })
  const adoptedJournal = readTaskAdmissionTransaction({
    metaDir: adoptMetaDir,
    identity: { activeRoot: adoptRoot.activeRoot, project: adoptRoot.project, taskId: adoptTaskId }
  })
  assert.strictEqual(adoptedJournal.transaction.effects.cpState.status, 'confirmed')
  assert.strictEqual(adoptedJournal.transaction.effects.cpState.compatibility.schemaVersion, 'LegacyCpConfirmationCompatibilityV1')
  assert.strictEqual(adoptedJournal.transaction.effects.cpState.compatibility.confirmedAtKind, 'legacy-time-only')
  const legacyAdoptTransaction = JSON.parse(JSON.stringify(adoptedJournal.transaction))
  delete legacyAdoptTransaction.requestDigestSchema
  delete legacyAdoptTransaction.requestDigestSemantics
  delete legacyAdoptTransaction.projectTargetLeaseBindingDigest
  legacyAdoptTransaction.requestDigest = legacyAdmissionRequestDigest(adoptInput, legacyAdoptTransaction)
  legacyAdoptTransaction.transactionDigest = taskAdmissionTransactionDigest(legacyAdoptTransaction)
  const legacyAdoptDowngrade = updateTaskRecoveryState({
    metaDir: adoptMetaDir,
    identity: { activeRoot: adoptRoot.activeRoot, project: adoptRoot.project, taskId: adoptTaskId }
  }, state => ({ ...state, admissionTransaction: legacyAdoptTransaction }), STORE_OPTIONS)
  assert.strictEqual(legacyAdoptDowngrade.status, 'committed')
  const adoptNextContextInput = refreshedIngressContext(adoptInput, 'adopt', 'ctx-adopt-next-turn')
  const adoptNextContextReplay = run(adoptNextContextInput)
  assert.strictEqual(adoptNextContextReplay.admissionId, adopted.admissionId)
  assert.strictEqual(adoptNextContextReplay.replayed, true, 'bounded legacy next-turn adopt replay must remain available')
  const adoptedOwner = runOwner(ownerInput(adoptNextContextInput, adopted, 'acquire', {
    expectedOwner: { mode: 'absent' }
  }))
  assert.strictEqual(adoptedOwner.status, 'active')
  assert.strictEqual(adoptedOwner.finalized, true)
  assert.strictEqual(adoptedOwner.mutationAuthority, true)
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(adoptTaskRoot, '.memory', 'task.json'), 'utf8')).schemaVersion, 'TaskIdentityV1')
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(adoptTaskRoot, '.memory', 'task-identity-v2.json'), 'utf8')).schemaVersion, 'TaskIdentityV2')
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(adoptTaskRoot, '.memory', 'task-identity-migration-v1.json'), 'utf8')).operation, 'adopt')

  const bindRoot = setupRoot('bind')
  const bindTaskId = 'e915b31a-8c63-4a45-a1ac-d9dc175c94df'
  const bindRelative = 'bugs/已有V2任务'
  const bindTaskRoot = path.join(bindRoot.activeRoot, ...bindRelative.split('/'))
  fs.mkdirSync(path.join(bindTaskRoot, '.memory'), { recursive: true })
  const bindIdentity = createTaskIdentityV2({
    taskId: bindTaskId,
    displayName: '已有V2任务',
    aliases: ['既有任务'],
    project: bindRoot.project,
    // The copied task keeps its original physical-root provenance. Binding in
    // the new root must use the current lease without rewriting task identity.
    projectRootIdentityDigest: '9'.repeat(64),
    taskKind: 'bugs',
    entryVariant: 'continue',
    taskRootRelative: bindRelative,
    createdAt: '2026-08-20T00:00:00.000Z'
  })
  fs.writeFileSync(path.join(bindTaskRoot, '.memory', 'task.json'), `${JSON.stringify(bindIdentity, null, 2)}\n`)
  const confirmedArtifact = '01-问题确认.md'
  const confirmedArtifactContent = '# 问题确认\n\n已确认。\n'
  fs.writeFileSync(path.join(bindTaskRoot, confirmedArtifact), confirmedArtifactContent)
  const confirmedDigest = crypto.createHash('sha256').update(confirmedArtifactContent).digest('hex')
  fs.writeFileSync(path.join(bindTaskRoot, '.memory', 'sessions.md'), [
    '# 已有V2任务 — 工作流状态',
    '',
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|',
    `| CP1 | ✅ | ${confirmedArtifact} | v1 | ${confirmedDigest} | user-confirmed | 2026-08-24T00:00:00.000Z |`,
    '| CP2 | ⏹️ | — | — | — | — | — |',
    '| CP3 | ⏹️ | — | — | — | — | — |',
    ''
  ].join('\n'))
  const bindInput = admissionInput(bindRoot, 'bind', {
    operation: 'bind',
    task: {
      taskId: bindTaskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: bindRelative
    },
    overview: { content: '# 问题概况\n\n继续已有 V2 task。\n' }
  })
  const bound = run(bindInput)
  assert.strictEqual(bound.phase, 'cp-state-written')
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(bindTaskRoot, '.memory', 'task.json'), 'utf8')).projectRootIdentityDigest,
    '9'.repeat(64),
    'workspace relocation must not rewrite immutable task-origin provenance'
  )
  const bindMetaDir = resolveTaskRecoveryMetaDir({ activeRoot: bindRoot.activeRoot, project: bindRoot.project })
  const boundJournal = readTaskAdmissionTransaction({
    metaDir: bindMetaDir,
    identity: { activeRoot: bindRoot.activeRoot, project: bindRoot.project, taskId: bindTaskId }
  })
  assert.strictEqual(boundJournal.transaction.effects.cpState.cp1Confirmed, true)
  assert.strictEqual(boundJournal.transaction.effects.cpState.status, 'confirmed')

  const pressureRoot = setupRoot('pressure')
  const pressureInput = admissionInput(pressureRoot, 'pressure')
  const pressure = executeTaskAdmission(pressureInput, {
    nowMs: NOW_MS,
    storeOptions: { ...STORE_OPTIONS, softBytes: 1, hardBytes: 1 }
  })
  assert.strictEqual(pressure.status, 'needs-reconcile')
  assert.strictEqual(fs.existsSync(path.join(pressureRoot.activeRoot, 'bugs')), false, 'prepared capacity failure must have zero business-file effects')

  const reservedRoot = setupRoot('reserved')
  const reservedInput = admissionInput(reservedRoot, 'reserved')
  reservedInput.task = { ...reservedInput.task, displayName: 'CON' }
  assert.throws(() => run(reservedInput), error => error.code === 'TASK_DIRECTORY_NAME_RESERVED')
  assert.strictEqual(fs.existsSync(path.join(reservedRoot.activeRoot, 'bugs')), false)

  const reparseRoot = setupRoot('reparse')
  const outside = path.join(TEMP_ROOT, 'outside-reparse')
  fs.mkdirSync(outside, { recursive: true })
  fs.mkdirSync(path.join(reparseRoot.activeRoot, 'bugs'), { recursive: true })
  fs.symlinkSync(outside, path.join(reparseRoot.activeRoot, 'bugs', '任务-reparse'), process.platform === 'win32' ? 'junction' : 'dir')
  const reparseInput = admissionInput(reparseRoot, 'reparse')
  assert.strictEqual(run(reparseInput).status, 'needs-reconcile')
  assert.strictEqual(fs.readdirSync(outside).length, 0)

  console.log(JSON.stringify({
    schemaVersion: 'TaskAdmissionAuthorityTestReceiptV1',
    passed: true,
    duplicateIngressReplays: 100,
    crashPhases: crashStages.length,
    finalPhase: first.phase
  }))
} finally {
  if (KEEP_TEST_ARTIFACTS) console.log(`[test-artifact-retained] ${TEMP_ROOT}`)
  else fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
}
