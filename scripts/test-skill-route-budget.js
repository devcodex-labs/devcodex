'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  applyBodyCharges,
  normalizeBodyChargeLedger,
  projectPendingStages,
  projectPlanReservation
} = require('../hooks/_runtime/skill-route-budget.cjs')
const {
  hasExecutableRouteAction,
  reconcileProgressiveSkillRoute,
  retireUnexecutableRoute
} = require('../hooks/_runtime/lifecycle-skill-route-coordinator.cjs')
const {
  sha256
} = require('../hooks/_runtime/progressive-skill-route-contract.cjs')
const {
  bootstrapSkillRoute,
  loadEnvelope,
  turnPaths
} = require('../hooks/_runtime/skill-route-state.cjs')
const {
  buildStagePages,
  evaluateProgressiveSkillRouteStop,
  handleSkillRoute
} = require('../hooks/_runtime/skill-route-tool.cjs')
const {
  createSkillRouteFixture,
  resolveFixtureGlobalRuntime,
  writeContextBindingState,
  writeJson
} = require('./lib/skill-route-test-fixture')

function identityItem (skillId, bytes, stage = 'closeout', content = null) {
  const body = content == null ? `${skillId}:${bytes}` : content
  return {
    skillId,
    effectiveLayer: 'project',
    bodyDigest: sha256(body),
    bodyBytes: bytes,
    loadStage: stage,
    ...(content == null ? {} : { content: body })
  }
}

function planFor (items, coexistenceScenarios = []) {
  const stageIds = [...new Set(items.map(item => item.loadStage))]
  return {
    baseResolution: { selected: items },
    coexistenceScenarios,
    stages: stageIds.map(stageId => ({ stageId }))
  }
}

function canonicalEnvelope (options = {}) {
  const contextEpoch = options.contextEpoch || 'ctx-budget-unit'
  const consumed = options.consumed || 0
  return {
    state: {
      contextEpoch,
      budget: {
        bodyBytesConsumed: consumed,
        bodyLimitBytes: options.limit || 262144
      },
      bodyChargeLedger: {
        schemaVersion: 'SkillRouteBodyChargeLedgerV1',
        items: options.items || [],
        unattributedBodyBytes: options.unattributed == null ? consumed : options.unattributed
      },
      plan: options.plan || planFor([]),
      stageProgress: {}
    },
    responseCache: {}
  }
}

function requestCatalogAll (fixture, bootstrap) {
  let cursor = null
  do {
    const response = handleSkillRoute({
      op: 'catalog',
      project: fixture.project,
      turnBinding: bootstrap.turnBinding,
      contextEpoch: bootstrap.contextEpoch,
      ...(cursor ? { cursor } : {})
    }, fixture.runtimeOptions)
    assert.strictEqual(response.ok, true, JSON.stringify(response))
    cursor = response.receipt.nextCursor
  } while (cursor)
}

function prepareCommittedFixture (contextEpoch) {
  const fixture = createSkillRouteFixture()
  const contextBinding = writeContextBindingState(fixture, contextEpoch, 'dev')
  const boot = bootstrapSkillRoute({
    project: fixture.project,
    activeRoot: fixture.activeRoot,
    contextEpoch,
    prompt: 'Run the workspace route budget probe',
    mode: 'unified',
    cwd: fixture.projectRoot
  }, fixture.runtimeOptions)
  requestCatalogAll(fixture, boot.bootstrap)
  const commitRequest = {
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding
  }
  const commit = handleSkillRoute(commitRequest, fixture.runtimeOptions)
  assert.strictEqual(commit.ok, true, JSON.stringify(commit))
  return { fixture, contextBinding, boot, commit, commitRequest }
}

function envelopeFile (fixture, turnBinding) {
  return turnPaths(fixture.activeRoot, turnBinding).envelope
}

function readRaw (file) {
  return fs.readFileSync(file, 'utf8')
}

// PF-267: cumulative budget must retire without replaying load_stage.
const screenshotPending = identityItem('pending-closeout', 44087)
const screenshot = canonicalEnvelope({
  consumed: 250072,
  limit: 262144,
  plan: planFor([screenshotPending])
})
const screenshotProjection = projectPendingStages(screenshot, ['closeout']).projection
assert.strictEqual(screenshotProjection.consumedBodyBytes, 250072)
assert.strictEqual(screenshotProjection.incrementalBodyBytes, 44087)
assert.strictEqual(screenshotProjection.projectedBodyBytes, 294159)
assert.strictEqual(screenshotProjection.deficitBodyBytes, 32015)
assert.strictEqual(screenshotProjection.executable, false)

const exactBoundary = canonicalEnvelope({
  consumed: 250072,
  limit: 294159,
  plan: planFor([screenshotPending])
})
assert.strictEqual(
  projectPendingStages(exactBoundary, ['closeout']).projection.executable,
  true
)

const plusOne = canonicalEnvelope({
  consumed: 250072,
  limit: 294158,
  plan: planFor([screenshotPending])
})
const plusOneBefore = JSON.stringify(plusOne)
assert.throws(
  () => applyBodyCharges(plusOne, [screenshotPending]),
  error => error?.code === 'BUDGET_BLOCKED' &&
    error.details?.budgetProjection?.deficitBodyBytes === 1
)
assert.strictEqual(JSON.stringify(plusOne), plusOneBefore)

const priorBody = 'closeout-cache-body'
const prior = identityItem(
  'closeout-cache',
  Buffer.byteLength(priorBody, 'utf8'),
  'closeout',
  priorBody
)
const priorKey = `${prior.skillId}|${prior.effectiveLayer}|${prior.bodyDigest}|ctx-legacy`
const legacy = {
  state: {
    contextEpoch: 'ctx-legacy',
    budget: { bodyBytesConsumed: 100, bodyLimitBytes: 262144 },
    plan: planFor([prior]),
    stageProgress: {}
  },
  responseCache: {
    cached: {
      response: {
        ok: true,
        op: 'load_stage',
        receipt: {
          schemaVersion: 'StageLoadReceiptV1',
          contextEpoch: 'ctx-legacy',
          loadedKeys: [priorKey]
        },
        bodyChunks: [{
          skillId: prior.skillId,
          effectiveLayer: prior.effectiveLayer,
          bodyDigest: prior.bodyDigest,
          bytes: prior.bodyBytes,
          content: priorBody
        }]
      }
    }
  }
}
const legacyLedger = normalizeBodyChargeLedger(legacy).ledger
assert.strictEqual(legacyLedger.items.length, 1)
assert.strictEqual(legacyLedger.items[0].key, priorKey)
assert.strictEqual(legacyLedger.unattributedBodyBytes, 100 - prior.bodyBytes)
assert.strictEqual(
  projectPendingStages(legacy, ['closeout']).projection.incrementalBodyBytes,
  0,
  'a closeout recovered from a prior generation response cache must not be charged again'
)

const unattributed = {
  state: {
    contextEpoch: 'ctx-unattributed',
    budget: { bodyBytesConsumed: 100, bodyLimitBytes: 109 },
    plan: planFor([identityItem('unknown-history-next', 10)]),
    stageProgress: {}
  },
  responseCache: {}
}
const unattributedResult = projectPendingStages(unattributed, ['closeout'])
assert.strictEqual(unattributedResult.ledger.unattributedBodyBytes, 100)
assert.strictEqual(unattributedResult.projection.projectedBodyBytes, 110)
assert.strictEqual(unattributedResult.projection.executable, false)

const invalidLedger = canonicalEnvelope({ consumed: 1, unattributed: 0 })
assert.throws(
  () => normalizeBodyChargeLedger(invalidLedger),
  error => error?.code === 'BODY_CHARGE_LEDGER_INVALID' &&
    error.details?.reason === 'consumption-mismatch'
)

const foreignEpochBody = identityItem('foreign-epoch-ledger', 10)
const foreignEpochEnvelope = canonicalEnvelope({
  consumed: 10,
  unattributed: 0,
  items: [{
    skillId: foreignEpochBody.skillId,
    effectiveLayer: foreignEpochBody.effectiveLayer,
    bodyDigest: foreignEpochBody.bodyDigest,
    contextEpoch: 'ctx-foreign-epoch',
    bytes: 10
  }]
})
assert.throws(
  () => normalizeBodyChargeLedger(foreignEpochEnvelope),
  error => error?.code === 'BODY_CHARGE_LEDGER_INVALID' &&
    error.details?.reason === 'context-epoch-mismatch'
)

const chargedIdentity = identityItem('charged-size-conflict', 10)
const chargedIdentityKey = `${chargedIdentity.skillId}|${chargedIdentity.effectiveLayer}|${chargedIdentity.bodyDigest}|ctx-budget-unit`
const chargedSizeConflict = canonicalEnvelope({
  consumed: 10,
  unattributed: 0,
  items: [{
    key: chargedIdentityKey,
    skillId: chargedIdentity.skillId,
    effectiveLayer: chargedIdentity.effectiveLayer,
    bodyDigest: chargedIdentity.bodyDigest,
    contextEpoch: 'ctx-budget-unit',
    bytes: 10
  }],
  plan: planFor([{ ...chargedIdentity, bodyBytes: 11 }])
})
assert.throws(
  () => projectPendingStages(chargedSizeConflict, ['closeout']),
  error => error?.code === 'BODY_CHARGE_IDENTITY_CONFLICT' &&
    error.details?.chargedBytes === 10 &&
    error.details?.candidateBytes === 11
)

const foreignCache = {
  state: {
    contextEpoch: 'ctx-cache-current',
    budget: { bodyBytesConsumed: 10, bodyLimitBytes: 262144 },
    plan: planFor([]),
    stageProgress: {}
  },
  responseCache: {
    foreign: {
      response: {
        ok: true,
        op: 'load_stage',
        receipt: {
          schemaVersion: 'StageLoadReceiptV1',
          contextEpoch: 'ctx-cache-foreign',
          loadedKeys: [
            `${foreignEpochBody.skillId}|${foreignEpochBody.effectiveLayer}|${foreignEpochBody.bodyDigest}|ctx-cache-foreign`
          ]
        },
        bodyChunks: [{
          skillId: foreignEpochBody.skillId,
          effectiveLayer: foreignEpochBody.effectiveLayer,
          bodyDigest: foreignEpochBody.bodyDigest,
          bytes: 10
        }]
      }
    }
  }
}
assert.throws(
  () => normalizeBodyChargeLedger(foreignCache),
  error => error?.code === 'BODY_CHARGE_LEGACY_CACHE_INVALID' &&
    error.details?.reason === 'context-epoch-mismatch'
)

const scenarioBase = identityItem('scenario-base', 10, 'entry')
const scenarioExtra = identityItem('scenario-extra', 20, 'closeout')
const reservationEnvelope = canonicalEnvelope({ consumed: 80, limit: 100 })
const reservation = projectPlanReservation(
  reservationEnvelope,
  planFor([scenarioBase], [{
    scenarioId: 'base+hard-closeout',
    status: 'complete',
    resolution: { selected: [scenarioBase, scenarioExtra] }
  }])
).projection
assert.strictEqual(reservation.worstCaseScenarioId, 'base+hard-closeout')
assert.strictEqual(reservation.projectedBodyBytes, 110)
assert.strictEqual(reservation.executable, false)

const legacyStop = {
  schemaVersion: 'ProgressiveSkillRouteStopV1',
  present: true,
  complete: false,
  processComplete: false,
  retired: false,
  turnBinding: 'turn-budget-legacy',
  contextEpoch: 'ctx-budget-legacy',
  planDigest: 'a'.repeat(64),
  pendingStageIds: ['closeout'],
  errorCode: 'BUDGET_BLOCKED',
  nextOp: 'load_stage',
  nextCall: {
    op: 'load_stage',
    generation: 7,
    planDigest: 'a'.repeat(64),
    stageId: 'closeout'
  },
  recovery: { automatic: true, action: 'retry-load-stage' },
  businessSatisfied: true
}
assert.strictEqual(hasExecutableRouteAction(legacyStop), false)
const normalizedStop = retireUnexecutableRoute(legacyStop)
assert.strictEqual(normalizedStop.retired, true)
assert.strictEqual(normalizedStop.nextCall, null)
assert.strictEqual(normalizedStop.completionDisposition, 'retired-budget-exhausted')
const coordinatorState = {}
for (let index = 0; index < 100; index += 1) {
  const reconciliation = reconcileProgressiveSkillRoute(coordinatorState, legacyStop, {
    trigger: 'Stop',
    sessionKey: 'budget-terminal-session',
    payload: { hookRunId: `budget-stop-${index}` }
  })
  assert.strictEqual(reconciliation.required, false)
  assert.strictEqual(reconciliation.envelope.status, 'retired')
  assert.strictEqual(reconciliation.envelope.nextCall, null)
  assert.strictEqual(reconciliation.coordinator.noProgressCount, 0)
}
const businessOnly = retireUnexecutableRoute({
  ...legacyStop,
  businessSatisfied: false,
  mustReplyCore: 'BUDGET_BUSINESS_REPLY'
})
assert.strictEqual(businessOnly.nextOp, 'satisfy_business')
assert.strictEqual(businessOnly.nextCall, null)
assert.strictEqual(businessOnly.recovery.automatic, false)

const packagedLayoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-packaged-skill-route-'))
try {
  writeJson(path.join(packagedLayoutRoot, 'skills', 'portfolio.json'), { skills: [] })
  const packagedRuntime = resolveFixtureGlobalRuntime(packagedLayoutRoot)
  assert.strictEqual(packagedRuntime.root, path.join(packagedLayoutRoot, 'skills'))
  assert.strictEqual(packagedRuntime.portfolioPath, path.join(packagedLayoutRoot, 'skills', 'portfolio.json'))
} finally {
  fs.rmSync(packagedLayoutRoot, { recursive: true, force: true })
}

const fixtures = []
try {
  const exact = prepareCommittedFixture('ctx-budget-exact')
  fixtures.push(exact.fixture)
  const exactFile = envelopeFile(exact.fixture, exact.boot.bootstrap.turnBinding)
  const exactEnvelope = loadEnvelope(
    exact.fixture.activeRoot,
    exact.boot.bootstrap.turnBinding,
    exact.fixture.runtimeOptions
  ).envelope
  const exactPages = buildStagePages(exactEnvelope.state, 'entry', exact.fixture.runtimeOptions)
  const exactPageBytes = exactPages[0].reduce((sum, chunk) => sum + chunk.bytes, 0)
  exactEnvelope.state.budget.bodyLimitBytes = exactPageBytes
  writeJson(exactFile, exactEnvelope)
  const exactLoad = handleSkillRoute({
    op: 'load_stage',
    project: exact.fixture.project,
    turnBinding: exact.boot.bootstrap.turnBinding,
    contextEpoch: 'ctx-budget-exact',
    generation: exact.commit.receipt.plan.generation,
    planDigest: exact.commit.receipt.plan.planDigest,
    stageId: 'entry'
  }, exact.fixture.runtimeOptions)
  assert.strictEqual(exactLoad.ok, true, JSON.stringify(exactLoad))
  assert.strictEqual(exactLoad.receipt.chargedBodyBytes, exactPageBytes)
  assert.strictEqual(exactLoad.receipt.budgetProjection.projectedBodyBytes, exactPageBytes)

  const blocked = prepareCommittedFixture('ctx-budget-blocked')
  fixtures.push(blocked.fixture)
  const blockedFile = envelopeFile(blocked.fixture, blocked.boot.bootstrap.turnBinding)
  const blockedEnvelope = loadEnvelope(
    blocked.fixture.activeRoot,
    blocked.boot.bootstrap.turnBinding,
    blocked.fixture.runtimeOptions
  ).envelope
  const blockedPages = buildStagePages(blockedEnvelope.state, 'entry', blocked.fixture.runtimeOptions)
  const blockedPageBytes = blockedPages[0].reduce((sum, chunk) => sum + chunk.bytes, 0)
  blockedEnvelope.state.budget.bodyLimitBytes = blockedPageBytes - 1
  writeJson(blockedFile, blockedEnvelope)
  const blockedBefore = sha256(readRaw(blockedFile))
  const blockedLoad = handleSkillRoute({
    op: 'load_stage',
    project: blocked.fixture.project,
    turnBinding: blocked.boot.bootstrap.turnBinding,
    contextEpoch: 'ctx-budget-blocked',
    generation: blocked.commit.receipt.plan.generation,
    planDigest: blocked.commit.receipt.plan.planDigest,
    stageId: 'entry'
  }, blocked.fixture.runtimeOptions)
  assert.strictEqual(blockedLoad.ok, false)
  assert.strictEqual(blockedLoad.errorCode, 'BUDGET_BLOCKED')
  assert.strictEqual(blockedLoad.stateChanged, false)
  assert.strictEqual(blockedLoad.details.retrySameCall, false)
  assert.match(blockedLoad.nextStep, /Do not retry/)
  assert.strictEqual(sha256(readRaw(blockedFile)), blockedBefore)

  const staleBudgetEnvelope = JSON.parse(readRaw(blockedFile))
  staleBudgetEnvelope.state.contextBinding.planContentId = 'stale-context-content'
  writeJson(blockedFile, staleBudgetEnvelope)
  const budgetBeforeContext = handleSkillRoute({
    op: 'status',
    project: blocked.fixture.project,
    turnBinding: blocked.boot.bootstrap.turnBinding,
    contextEpoch: 'ctx-budget-blocked'
  }, blocked.fixture.runtimeOptions)
  assert.strictEqual(budgetBeforeContext.ok, true)
  assert.strictEqual(budgetBeforeContext.receipt.nextAction.errorCode, 'BUDGET_BLOCKED')
  assert.strictEqual(budgetBeforeContext.receipt.nextAction.nextOp, null)
  assert.strictEqual(budgetBeforeContext.receipt.nextAction.nextCall, null)
  assert.strictEqual(budgetBeforeContext.receipt.nextAction.recovery.retrySameCall, false)
  assert(budgetBeforeContext.delivery.serializedBytes <= 16 * 1024)

  const selectedBusiness = staleBudgetEnvelope.state.obligationLedger.items.find(item =>
    item.skillId === staleBudgetEnvelope.state.obligationLedger.selectedBusinessSkillId
  )
  const budgetStop = evaluateProgressiveSkillRouteStop({
    project: blocked.fixture.project,
    contextEpoch: 'ctx-budget-blocked',
    assistantText: selectedBusiness?.mustReplyCore || ''
  }, blocked.fixture.runtimeOptions)
  assert.strictEqual(budgetStop.retired, true)
  assert.strictEqual(budgetStop.processComplete, false)
  assert.strictEqual(budgetStop.retirementReason, 'BUDGET_BLOCKED')
  assert.strictEqual(budgetStop.completionDisposition, 'retired-budget-exhausted')
  assert.strictEqual(budgetStop.nextCall, null)

  const freshBinding = writeContextBindingState(
    blocked.fixture,
    'ctx-budget-blocked',
    'dev',
    'session-ctx-budget-blocked',
    '-refresh'
  )
  const rebindEnvelope = JSON.parse(readRaw(blockedFile))
  rebindEnvelope.state.contextBinding = blocked.contextBinding
  rebindEnvelope.state.budget.bodyBytesConsumed = rebindEnvelope.state.budget.bodyLimitBytes - 1
  rebindEnvelope.state.bodyChargeLedger = {
    schemaVersion: 'SkillRouteBodyChargeLedgerV1',
    items: [],
    unattributedBodyBytes: rebindEnvelope.state.budget.bodyBytesConsumed
  }
  writeJson(blockedFile, rebindEnvelope)
  const rebindBefore = sha256(readRaw(blockedFile))
  const blockedRebind = handleSkillRoute({
    op: 'rebind',
    project: blocked.fixture.project,
    turnBinding: blocked.boot.bootstrap.turnBinding,
    contextEpoch: 'ctx-budget-blocked',
    generation: blocked.commit.receipt.plan.generation,
    planDigest: blocked.commit.receipt.plan.planDigest,
    contextBinding: freshBinding
  }, blocked.fixture.runtimeOptions)
  assert.strictEqual(blockedRebind.ok, false)
  assert.strictEqual(blockedRebind.errorCode, 'BUDGET_RESERVATION_BLOCKED')
  assert.strictEqual(blockedRebind.stateChanged, false)
  assert.strictEqual(blockedRebind.details.retrySameCall, false)
  assert.strictEqual(sha256(readRaw(blockedFile)), rebindBefore)

  const commitBlocked = createSkillRouteFixture()
  fixtures.push(commitBlocked)
  const commitEpoch = 'ctx-budget-commit-reservation'
  const commitBinding = writeContextBindingState(commitBlocked, commitEpoch, 'dev')
  const commitBoot = bootstrapSkillRoute({
    project: commitBlocked.project,
    activeRoot: commitBlocked.activeRoot,
    contextEpoch: commitEpoch,
    prompt: 'Run the commit reservation probe',
    mode: 'unified',
    cwd: commitBlocked.projectRoot
  }, commitBlocked.runtimeOptions)
  requestCatalogAll(commitBlocked, commitBoot.bootstrap)
  const commitFile = envelopeFile(commitBlocked, commitBoot.bootstrap.turnBinding)
  const beforeCommitEnvelope = JSON.parse(readRaw(commitFile))
  beforeCommitEnvelope.state.budget.bodyBytesConsumed =
    beforeCommitEnvelope.state.budget.bodyLimitBytes - 1
  beforeCommitEnvelope.state.bodyChargeLedger = {
    schemaVersion: 'SkillRouteBodyChargeLedgerV1',
    items: [],
    unattributedBodyBytes: beforeCommitEnvelope.state.budget.bodyBytesConsumed
  }
  writeJson(commitFile, beforeCommitEnvelope)
  const commitBefore = sha256(readRaw(commitFile))
  const rejectedCommit = handleSkillRoute({
    op: 'commit',
    project: commitBlocked.project,
    turnBinding: commitBoot.bootstrap.turnBinding,
    contextEpoch: commitEpoch,
    catalogDigest: commitBoot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding: commitBinding
  }, commitBlocked.runtimeOptions)
  assert.strictEqual(rejectedCommit.ok, false)
  assert.strictEqual(rejectedCommit.errorCode, 'BUDGET_RESERVATION_BLOCKED')
  assert.strictEqual(rejectedCommit.stateChanged, false)
  assert.strictEqual(sha256(readRaw(commitFile)), commitBefore)
  assert.strictEqual(JSON.parse(readRaw(commitFile)).state.plan, null)
} finally {
  for (const fixture of fixtures.reverse()) fixture.cleanup()
}

console.log('test-skill-route-budget: PASS')
