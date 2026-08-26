'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  MAX_RESPONSE_CACHE_BYTES,
  MAX_QUARANTINE_DIRECTORIES,
  MAX_RAW_TURN_DIRECTORIES,
  MAX_ROUTE_ROOT_BYTES,
  MAX_TURNS,
  TURN_PRESSURE_LOW_WATER,
  atomicWriteJson,
  assertProjectedCapacity,
  bootstrapSkillRoute,
  collectExpiredTurns,
  parseExplicitSkillId,
  loadEnvelope,
  routeRootForActiveRoot,
  turnPaths,
  transactEnvelope
} = require('../hooks/_runtime/skill-route-state.cjs')
const {
  buildTrustedContextSemanticCore,
  evaluateProgressiveSkillRouteStop,
  handleSkillRoute,
  resolveProjectTarget,
  validateTrustedContextBinding,
  shouldEnforceProgressiveSkillRouteStop
} = require('../hooks/_runtime/skill-route-tool.cjs')
const { buildContentIdentity } = require('../hooks/_runtime/content-identity.cjs')
const {
  buildContextReadPlan,
  createContextReadReceipt,
  stableDigest: contextStableDigest,
  validateContextReadPlan
} = require('../hooks/_runtime/context-read-contract.cjs')
const { persistContextPlanObservation } = require('../hooks/_runtime/context-plan-observation.cjs')
const {
  readMcpContextSourceObservations,
  recordMcpContextSourceObservations
} = require('../hooks/_runtime/context-source-observation.cjs')
const {
  encodeCursor
} = require('../hooks/_runtime/model-skill-catalog.cjs')
const {
  sha256
} = require('../hooks/_runtime/progressive-skill-route-contract.cjs')
const {
  DEFAULT_REGISTRY_PATH
} = require('../hooks/_runtime/workflow-root-registry.cjs')
const {
  createSkillRouteFixture,
  writeContextBindingState,
  writeWorkspaceSkill
} = require('./lib/skill-route-test-fixture')

const BASE_MS = Date.parse('2026-07-31T00:00:00.000Z')

function writeCapacityTurn (fixture, index, options = {}) {
  const turnBinding = options.turnBinding ||
    `turn-${sha256({ project: fixture.project, index, salt: options.salt || '' }).slice(0, 40)}`
  const paths = turnPaths(fixture.activeRoot, turnBinding)
  const requiredStageIds = options.requiredStageIds || []
  const stageProgress = Object.fromEntries(requiredStageIds.map(stageId => [
    stageId,
    { status: options.stageStatus || 'loaded' }
  ]))
  atomicWriteJson(paths.envelope, {
    schemaVersion: 'TurnRouteEnvelopeV1',
    version: 1,
    state: {
      project: fixture.project,
      activeRoot: fixture.activeRoot.replace(/\\/g, '/'),
      turnBinding,
      contextEpoch: options.contextEpoch || `ctx-capacity-${index}`,
      hostSessionId: options.hostSessionId || '',
      decision: options.decision || null,
      plan: options.planStatus ? { status: options.planStatus } : null,
      stageProgress,
      obligationLedger: {
        schemaVersion: 'ObligationLedgerV1',
        items: options.businessItems || [],
        selectedBusinessSkillId: null,
        requiredStageIds,
        satisfiedStageIds: options.stageStatus === 'pending' ? [] : [...requiredStageIds]
      }
    },
    responseCache: {},
    updatedAt: options.updatedAt || '2026-07-31T10:00:00.000Z',
    expiresAt: options.expiresAt || '2026-08-01T10:00:00.000Z'
  })
  return { turnBinding, paths }
}

function fixtureProfileRef (fixture, file, layer = `project:${fixture.project}`) {
  const filePath = path.join(fixture.activeRoot, 'profile', file)
  const stat = fs.statSync(filePath)
  return {
    path: filePath.replace(/\\/g, '/'),
    layer,
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs
  }
}

function buildFixtureBaseline (fixture) {
  const files = ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md']
  return {
    layout: 'workspace-namespace',
    project: fixture.project,
    mode: 'dev',
    agent: 'codex',
    profileTier: 'profile-lite',
    effectiveConfig: { mode: 'dev', agent: 'codex' },
    readme: {
      content: '# Skill route fixture Profile\n',
      sourceRefs: [fixtureProfileRef(fixture, 'README.md')]
    },
    configSourceRefs: [fixtureProfileRef(fixture, 'config.json')],
    catalog: files.map(file => ({
      file,
      requiredToExist: true,
      authority: 'fixture-profile-readme'
    })),
    inventory: ['README.md', 'config.json', ...files, 'config.local.json'].map(file => ({
      file,
      sourceRefs: file === 'config.local.json'
        ? [{
            path: path.join(fixture.activeRoot, 'profile', file).replace(/\\/g, '/'),
            layer: `project:${fixture.project}`,
            exists: false,
            size: null,
            mtimeMs: null
          }]
        : [fixtureProfileRef(fixture, file)],
      authority: 'fixture-bounded-profile-inventory'
    }))
  }
}

function buildFixtureContextPlan (fixture, contextEpoch) {
  const plan = buildContextReadPlan({
    intentSeed: {
      schemaVersion: 'IntentSeedV1',
      contextEpoch,
      semantic: 'dev',
      targetHint: fixture.project,
      continuationHint: false,
      riskHint: 'normal',
      confidence: 0.95,
      createdAt: '2026-07-31T00:00:00.000Z'
    },
    identity: {
      activeRoot: fixture.activeRoot,
      project: fixture.project,
      host: 'codex',
      finalIntent: 'dev'
    },
    changeTypes: ['source-code'],
    baselineContext: buildFixtureBaseline(fixture),
    planningTelemetry: { latencyMs: 1.5 }
  }, { nowMs: BASE_MS })
  const validation = validateContextReadPlan(plan)
  assert.strictEqual(validation.valid, true, validation.errors?.join(' | '))
  return plan
}

function observedMcpSourceResult (plan, sourceId) {
  const source = plan.selectedSources.find(item => item.sourceId === sourceId)
  assert(source, `missing selected source for ${sourceId}`)
  const body = JSON.stringify({ sourceId, body: 'mcp-direct-fixture' })
  return {
    sourceId,
    sourceLayer: source.sourceLayer,
    outcome: 'observed-success',
    successful: true,
    observable: true,
    transportSuccess: true,
    sourceRefsMatch: true,
    schemaMatch: true,
    targetMatch: true,
    resultDigest: contextStableDigest({ sourceId, body }),
    contentIdentity: buildContentIdentity({
      sourceKey: `fixture://${sourceId}`,
      content: body,
      contractVersion: source.kind === 'memory' ? 'MemoryStatusV1' : 'ProfileBodyV1'
    }),
    bodyObserved: true,
    bytes: Buffer.byteLength(body, 'utf8'),
    chars: body.length,
    hostDeliveredBytes: Buffer.byteLength(body, 'utf8')
  }
}

function requestCatalogAll (fixture, bootstrap, options = fixture.runtimeOptions) {
  const responses = []
  let cursor = null
  do {
    const response = handleSkillRoute({
      op: 'catalog',
      project: fixture.project,
      turnBinding: bootstrap.turnBinding,
      contextEpoch: bootstrap.contextEpoch,
      ...(cursor ? { cursor } : {})
    }, options)
    assert.strictEqual(response.ok, true, JSON.stringify(response))
    responses.push(response)
    cursor = response.receipt.nextCursor
  } while (cursor)
  return responses
}

function loadStageAll (fixture, plan, stageId, options = fixture.runtimeOptions) {
  const responses = []
  let cursor = null
  do {
    const response = handleSkillRoute({
      op: 'load_stage',
      project: fixture.project,
      turnBinding: plan.turnBinding,
      contextEpoch: plan.contextEpoch,
      generation: plan.generation,
      planDigest: plan.planDigest,
      stageId,
      triggerRef: `test:${stageId}`,
      ...(cursor ? { cursor } : {})
    }, options)
    assert.strictEqual(response.ok, true, JSON.stringify(response))
    responses.push(response)
    cursor = response.receipt.nextCursor
  } while (cursor)
  return responses
}

const fixture = createSkillRouteFixture()

try {
  const contextEpoch = 'ctx-state-fixture'
  const contextBinding = writeContextBindingState(fixture, contextEpoch, 'dev')
  fs.appendFileSync(
    path.join(
      fixture.root,
      '.devcodex',
      'workspace',
      'skills',
      'workspace-probe',
      'SKILL.md'
    ),
    '\n\n## 必须回复\n\nWORKSPACE_ROUTE_COMPLETE\n',
    'utf8'
  )
  assert.strictEqual(parseExplicitSkillId('使用 report 生成报告'), null)
  assert.strictEqual(parseExplicitSkillId('使用 report Skill'), 'report')
  assert.strictEqual(parseExplicitSkillId('skill:report'), 'report')

  // Acceptance R02 / T01: invalid identities fail before any route mutation.
  const invalidProject = handleSkillRoute({
    op: 'status',
    project: '../escape',
    turnBinding: `turn-${'0'.repeat(40)}`
  }, fixture.runtimeOptions)
  assert.strictEqual(invalidProject.ok, false)
  assert.strictEqual(invalidProject.errorCode, 'PROJECT_BINDING_INVALID')

  const invalidTurnBinding = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: '../../outside'
  }, fixture.runtimeOptions)
  assert.strictEqual(invalidTurnBinding.ok, false)
  assert.strictEqual(invalidTurnBinding.errorCode, 'TURN_BINDING_INVALID')
  assert.strictEqual(
    fs.existsSync(path.join(fixture.activeRoot, '.runtime-state', 'skill-route', 'outside')),
    false
  )

  const boot = bootstrapSkillRoute({
    project: fixture.project,
    activeRoot: fixture.activeRoot,
    contextEpoch,
    prompt: 'Implement the workspace route probe',
    mode: 'unified',
    cwd: fixture.projectRoot
  }, fixture.runtimeOptions)
  assert.strictEqual(boot.reused, false)
  assert.strictEqual(boot.bootstrap.mode, 'unified')
  assert(boot.bootstrap.candidateCount > 70)

  const missingContextBinding = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: 'workspace-probe'
  }, fixture.runtimeOptions)
  assert.strictEqual(missingContextBinding.ok, false)
  assert.strictEqual(missingContextBinding.errorCode, 'CONTEXT_BINDING_REQUIRED')

  const oversizedTriggerRef = handleSkillRoute({
    op: 'load_stage',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    generation: 0,
    planDigest: '0'.repeat(64),
    stageId: 'entry',
    triggerRef: 'x'.repeat(513)
  }, fixture.runtimeOptions)
  assert.strictEqual(oversizedTriggerRef.ok, false)
  assert.strictEqual(oversizedTriggerRef.errorCode, 'TRIGGER_REF_INVALID')

  const incomplete = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding
  }, fixture.runtimeOptions)
  assert.strictEqual(incomplete.ok, false)
  assert.strictEqual(incomplete.errorCode, 'CATALOG_PAGE_INCOMPLETE')

  const skippedCatalogPage = handleSkillRoute({
    op: 'catalog',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    cursor: encodeCursor({
      schemaVersion: 'SkillCatalogCursorV1',
      project: fixture.project,
      turnBinding: boot.bootstrap.turnBinding,
      contextEpoch,
      catalogDigest: boot.bootstrap.catalogDigest,
      pageIndex: 1
    })
  }, fixture.runtimeOptions)
  assert.strictEqual(skippedCatalogPage.ok, false)
  assert.strictEqual(
    skippedCatalogPage.errorCode,
    'CATALOG_CURSOR_OUT_OF_SEQUENCE'
  )

  const catalogPaths = turnPaths(fixture.activeRoot, boot.bootstrap.turnBinding)
  const envelopeBeforeCatalog = fs.readFileSync(catalogPaths.envelope, 'utf8')
  const pages = requestCatalogAll(fixture, boot.bootstrap)
  assert(pages.length <= 5, `expected first catalog to fit in <=5 pages, got ${pages.length}`)
  assert.strictEqual(fs.readFileSync(catalogPaths.envelope, 'utf8'), envelopeBeforeCatalog)
  const catalogProgress = JSON.parse(fs.readFileSync(catalogPaths.catalogProgress, 'utf8'))
  assert.deepStrictEqual(
    catalogProgress.servedCatalogPages,
    pages.map((_, index) => index)
  )
  assert.strictEqual(catalogProgress.catalogLedger.length, pages.length)
  const firstReplay = handleSkillRoute({
    op: 'catalog',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.deepStrictEqual(firstReplay, pages[0])
  assert.strictEqual(fs.readFileSync(catalogPaths.envelope, 'utf8'), envelopeBeforeCatalog)

  const forgedCursor = handleSkillRoute({
    op: 'catalog',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    cursor: `${pages[0].receipt.nextCursor}x`
  }, fixture.runtimeOptions)
  assert.strictEqual(forgedCursor.ok, false)
  assert.strictEqual(forgedCursor.errorCode, 'CATALOG_CURSOR_INVALID')

  const lifecyclePath = path.join(
    fixture.activeRoot,
    '.memory',
    'hooks',
    fixture.project,
    'lifecycle-state.json'
  )
  const incompleteMandatoryLifecycle = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'))
  incompleteMandatoryLifecycle.contextAcquisition.plan.mandatorySourceIds = [
    'profile:README.md',
    'memory:memory_status'
  ]
  incompleteMandatoryLifecycle.contextAcquisition.receipt.status = 'relevant-complete'
  incompleteMandatoryLifecycle.contextAcquisition.receipt.satisfiedSourceIds = ['profile:README.md']
  incompleteMandatoryLifecycle.contextAcquisition.receipt.missingSourceIds = ['memory:memory_status']
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(incompleteMandatoryLifecycle, null, 2)}\n`, 'utf8')
  const missingMandatoryContextSource = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding
  }, fixture.runtimeOptions)
  assert.strictEqual(missingMandatoryContextSource.ok, false)
  assert.strictEqual(missingMandatoryContextSource.errorCode, 'CONTEXT_BINDING_PENDING')
  writeContextBindingState(fixture, contextEpoch, 'dev')

  const mcpObservationEpoch = 'ctx-mcp-source-observation-fixture'
  const mcpObservedPlan = buildFixtureContextPlan(fixture, mcpObservationEpoch)
  const planObservation = persistContextPlanObservation({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextEpoch: mcpObservationEpoch,
    plan: mcpObservedPlan,
    nowMs: BASE_MS + 10
  })
  assert.strictEqual(planObservation.status, 'persisted', JSON.stringify(planObservation))
  const mcpBoot = bootstrapSkillRoute({
    project: fixture.project,
    activeRoot: fixture.activeRoot,
    contextEpoch: mcpObservationEpoch,
    prompt: 'Implement the workspace route probe',
    mode: 'unified',
    cwd: fixture.projectRoot
  }, fixture.runtimeOptions)
  requestCatalogAll(fixture, mcpBoot.bootstrap)
  fs.writeFileSync(
    lifecyclePath,
    `${JSON.stringify({
      contextAcquisition: {
        contextEpoch: mcpObservationEpoch,
        activeRoot: fixture.activeRoot.replace(/\\/g, '/'),
        project: fixture.project,
        hostSessionId: 'session-mcp-source-observation'
      }
    }, null, 2)}\n`,
    'utf8'
  )
  const bridgedSources = recordMcpContextSourceObservations({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    workspaceNamespace: false,
    contextBinding: mcpObservedPlan.contextBinding,
    hostSessionId: '',
    sourceResults: mcpObservedPlan.mandatorySourceIds.map(sourceId => observedMcpSourceResult(mcpObservedPlan, sourceId))
  }, { nowMs: BASE_MS + 20 })
  assert.strictEqual(bridgedSources.status, 'persisted', JSON.stringify(bridgedSources))
  assert.deepStrictEqual(bridgedSources.missingSourceIds, [])
  assert.strictEqual(bridgedSources.receiptStatus, 'relevant-complete')
  assert.strictEqual(
    bridgedSources.statePath.replace(/\\/g, '/').endsWith(`/.memory/hooks/${fixture.project}/lifecycle-state.json`),
    true,
    'workspace-namespace activeRoot must infer the project hook lifecycle path even when MCP omits workspaceNamespace'
  )
  const emptyCarrierResults = mcpObservedPlan.mandatorySourceIds.map(sourceId => ({
    ...observedMcpSourceResult(mcpObservedPlan, sourceId),
    hostSessionId: ''
  }))
  const carriedBridge = recordMcpContextSourceObservations({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextBinding: mcpObservedPlan.contextBinding,
    hostSessionId: 'session-mcp-source-observation',
    sourceResults: emptyCarrierResults
  }, { nowMs: BASE_MS + 20 })
  assert.strictEqual(carriedBridge.ledgerStatus, 'persisted', JSON.stringify(carriedBridge))
  const carriedObservations = readMcpContextSourceObservations({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextBinding: mcpObservedPlan.contextBinding,
    hostSessionId: 'session-mcp-source-observation',
    plan: mcpObservedPlan
  })
  assert.strictEqual(carriedObservations.status, 'fresh')
  assert(carriedObservations.sourceResults.every(item =>
    item.hostSessionId === 'session-mcp-source-observation'
  ), 'empty durable observation carriers must adopt the exact current session during replay')
  fs.writeFileSync(`${bridgedSources.ledgerPath}.lock`, '{"fixture":true}\n', 'utf8')
  const lockedLedgerBridge = recordMcpContextSourceObservations({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextBinding: mcpObservedPlan.contextBinding,
    hostSessionId: '',
    sourceResults: [observedMcpSourceResult(mcpObservedPlan, mcpObservedPlan.mandatorySourceIds[0])]
  }, { nowMs: BASE_MS + 20, lockWaitMs: 0 })
  assert.strictEqual(lockedLedgerBridge.status, 'degraded')
  assert.strictEqual(lockedLedgerBridge.ledgerStatus, 'bypassed')
  assert.strictEqual(lockedLedgerBridge.errorCode, 'CONTEXT_SOURCE_OBSERVATION_LOCK_TIMEOUT')
  fs.unlinkSync(`${bridgedSources.ledgerPath}.lock`)

  // PF-342 regression: automatic recovery provenance is transient diagnostic
  // state, not part of the trusted semantic binding. A recovery followed by a
  // normal read must therefore keep the same digest, while real trusted
  // identity drift must still change it.
  fs.writeFileSync(
    lifecyclePath,
    `${JSON.stringify({
      contextAcquisition: {
        contextEpoch: mcpObservationEpoch,
        activeRoot: fixture.activeRoot.replace(/\\/g, '/'),
        project: fixture.project,
        hostSessionId: 'session-mcp-source-observation'
      }
    }, null, 2)}\n`,
    'utf8'
  )
  const mcpTarget = resolveProjectTarget(fixture.root, fixture.project)
  const reboundTrustedContext = validateTrustedContextBinding(
    mcpObservedPlan.contextBinding,
    mcpTarget,
    fixture.runtimeOptions
  )
  assert.strictEqual(reboundTrustedContext.reboundFromObservation, true)
  assert.strictEqual(reboundTrustedContext.diagnostics.reboundFromObservation, true)
  assert.deepStrictEqual(reboundTrustedContext.observed.missingSourceIds, [])
  assert.deepStrictEqual(
    reboundTrustedContext.observed.mandatorySourceIds,
    [...mcpObservedPlan.mandatorySourceIds].sort()
  )
  const stableTrustedContext = validateTrustedContextBinding(
    mcpObservedPlan.contextBinding,
    mcpTarget,
    fixture.runtimeOptions
  )
  assert.strictEqual(stableTrustedContext.reboundFromObservation, false)
  assert.strictEqual(stableTrustedContext.diagnostics.reboundFromObservation, false)
  assert.strictEqual(
    stableTrustedContext.bindingDigest,
    reboundTrustedContext.bindingDigest,
    'transient recovery provenance must not invalidate an unchanged trusted context'
  )
  const semanticLifecycle = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'))
  const stableSemanticCore = buildTrustedContextSemanticCore({
    plan: semanticLifecycle.contextAcquisition.plan,
    receipt: semanticLifecycle.contextAcquisition.receipt,
    contextEpoch: semanticLifecycle.contextAcquisition.contextEpoch,
    activeRoot: semanticLifecycle.contextAcquisition.activeRoot,
    project: semanticLifecycle.contextAcquisition.project,
    hostSessionId: semanticLifecycle.contextAcquisition.hostSessionId
  })
  const transientLifecycle = JSON.parse(JSON.stringify(semanticLifecycle))
  const transientReceipt = transientLifecycle.contextAcquisition.receipt
  transientReceipt.receiptId = 'receipt-transient-closeout'
  transientReceipt.status = 'completed'
  transientReceipt.completedAt = new Date(BASE_MS + 30).toISOString()
  transientReceipt.consumedAt = new Date(BASE_MS + 31).toISOString()
  transientReceipt.replanCount = 7
  transientReceipt.lastError = { diagnostic: 'must-not-bind' }
  if (transientReceipt.delivery) {
    transientReceipt.delivery.reused = true
    transientReceipt.delivery.reasonCode = 'transient-replay-diagnostic'
  }
  transientReceipt.observations = (transientReceipt.observations || []).map((observation, index) => ({
    ...observation,
    observationId: `transient-observation-${index}`,
    toolCallId: `transient-call-${index}`,
    attemptedAt: new Date(BASE_MS + 32 + index).toISOString(),
    observedAt: new Date(BASE_MS + 42 + index).toISOString(),
    latencyMs: 999 + index,
    tokens: 777 + index,
    cache: !observation.cache
  }))
  const transientSemanticCore = buildTrustedContextSemanticCore({
    plan: transientLifecycle.contextAcquisition.plan,
    receipt: transientReceipt,
    contextEpoch: transientLifecycle.contextAcquisition.contextEpoch,
    activeRoot: transientLifecycle.contextAcquisition.activeRoot,
    project: transientLifecycle.contextAcquisition.project,
    hostSessionId: transientLifecycle.contextAcquisition.hostSessionId
  })
  assert.deepStrictEqual(
    transientSemanticCore,
    stableSemanticCore,
    'receipt ids, replay diagnostics, timing, paging progress and closeout status must not enter the semantic core'
  )
  const sourceDriftLifecycle = JSON.parse(JSON.stringify(semanticLifecycle))
  assert(sourceDriftLifecycle.contextAcquisition.receipt.sourceIdentities.length > 0)
  sourceDriftLifecycle.contextAcquisition.receipt.sourceIdentities[0].contentIdentity.digest = 'f'.repeat(64)
  const sourceDriftCore = buildTrustedContextSemanticCore({
    plan: sourceDriftLifecycle.contextAcquisition.plan,
    receipt: sourceDriftLifecycle.contextAcquisition.receipt,
    contextEpoch: sourceDriftLifecycle.contextAcquisition.contextEpoch,
    activeRoot: sourceDriftLifecycle.contextAcquisition.activeRoot,
    project: sourceDriftLifecycle.contextAcquisition.project,
    hostSessionId: sourceDriftLifecycle.contextAcquisition.hostSessionId
  })
  assert.notStrictEqual(
    sha256(sourceDriftCore),
    sha256(stableSemanticCore),
    'a real successful source identity change must invalidate the semantic core'
  )
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(transientLifecycle, null, 2)}\n`, 'utf8')
  const completedTrustedContext = validateTrustedContextBinding(
    mcpObservedPlan.contextBinding,
    mcpTarget,
    fixture.runtimeOptions
  )
  assert.strictEqual(
    completedTrustedContext.bindingDigest,
    stableTrustedContext.bindingDigest,
    'a repeated closeout/replay of the same observed content must preserve the trusted binding digest'
  )
  Object.assign(semanticLifecycle, JSON.parse(fs.readFileSync(lifecyclePath, 'utf8')))
  semanticLifecycle.contextAcquisition.hostSessionId = 'session-semantic-drift'
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(semanticLifecycle, null, 2)}\n`, 'utf8')
  const driftedTrustedContext = validateTrustedContextBinding(
    mcpObservedPlan.contextBinding,
    mcpTarget,
    fixture.runtimeOptions
  )
  assert.notStrictEqual(
    driftedTrustedContext.bindingDigest,
    stableTrustedContext.bindingDigest,
    'a real host-session identity change must invalidate the trusted context digest'
  )
  semanticLifecycle.contextAcquisition.hostSessionId = stableTrustedContext.hostSessionId
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(semanticLifecycle, null, 2)}\n`, 'utf8')

  const mcpRecoveredCommit = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: mcpBoot.bootstrap.turnBinding,
    contextEpoch: mcpObservationEpoch,
    catalogDigest: mcpBoot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding: mcpObservedPlan.contextBinding
  }, fixture.runtimeOptions)
  assert.strictEqual(mcpRecoveredCommit.ok, true, JSON.stringify(mcpRecoveredCommit))
  const statusBeforeEntry = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: mcpBoot.bootstrap.turnBinding,
    contextEpoch: mcpObservationEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(statusBeforeEntry.ok, true, JSON.stringify(statusBeforeEntry))
  assert.strictEqual(statusBeforeEntry.receipt.nextAction.nextOp, 'load_stage')
  const entryFromStatus = handleSkillRoute(
    statusBeforeEntry.receipt.nextAction.nextCall,
    fixture.runtimeOptions
  )
  assert.strictEqual(entryFromStatus.ok, true, 'status nextCall must be executable without a hidden precondition mismatch')

  // Regression PF-256: a Hook writer may replace the shared lifecycle receipt
  // with a baseline-only snapshot after MCP already delivered every body. Stage
  // loading must recover transparently from the independent durable source
  // ledger when the reconstructed semantic binding is unchanged.
  const overwrittenAfterCommit = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'))
  overwrittenAfterCommit.contextAcquisition.receipt = createContextReadReceipt(mcpObservedPlan, {
    verificationMode: 'structured-plan',
    planObserved: true,
    hostSessionId: 'session-mcp-source-observation'
  })
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(overwrittenAfterCommit, null, 2)}\n`, 'utf8')
  const recoveredStatusAfterOverwrite = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: mcpBoot.bootstrap.turnBinding,
    contextEpoch: mcpObservationEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(recoveredStatusAfterOverwrite.ok, true, JSON.stringify(recoveredStatusAfterOverwrite))
  assert.strictEqual(recoveredStatusAfterOverwrite.receipt.nextAction.nextOp, 'load_stage')
  assert.strictEqual(recoveredStatusAfterOverwrite.receipt.nextAction.nextCall.stageId, 'closeout')

  const writerStaleLifecycle = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'))
  writerStaleLifecycle.contextAcquisition.receipt.status = 'stale'
  writerStaleLifecycle.contextAcquisition.receipt.satisfiedSourceIds = []
  writerStaleLifecycle.contextAcquisition.receipt.missingSourceIds = [...mcpObservedPlan.mandatorySourceIds]
  writerStaleLifecycle.contextAcquisition.receipt.escalations = [{
    trigger: 'scope-drift',
    reason: 'writer-drift',
    observedAt: new Date(BASE_MS + 25).toISOString(),
    action: 'replan-required'
  }]
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(writerStaleLifecycle, null, 2)}\n`, 'utf8')
  const writerRecoveredStatus = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: mcpBoot.bootstrap.turnBinding,
    contextEpoch: mcpObservationEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(writerRecoveredStatus.ok, true, JSON.stringify(writerRecoveredStatus))
  assert.strictEqual(writerRecoveredStatus.receipt.nextAction.nextOp, 'load_stage')
  assert.strictEqual(writerRecoveredStatus.receipt.nextAction.errorCode, null)
  const writerRecoveredLifecycle = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'))
  assert.strictEqual(writerRecoveredLifecycle.contextAcquisition.receipt.status, 'relevant-complete')
  assert.deepStrictEqual(writerRecoveredLifecycle.contextAcquisition.receipt.missingSourceIds, [])
  const stableLifecycleAfterWriterRecovery = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'))

  const driftSource = mcpObservedPlan.selectedSources.find(source =>
    source.kind !== 'memory' && !['profile:README.md', 'profile:config.json'].includes(source.sourceId)
  )
  assert(driftSource?.sourceRefs?.[0]?.path, 'fixture must expose a non-baseline Profile source')
  const driftPath = driftSource.sourceRefs[0].path
  const driftStat = fs.statSync(driftPath)
  const driftOriginal = fs.readFileSync(driftPath, 'utf8')
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(overwrittenAfterCommit, null, 2)}\n`, 'utf8')
  fs.writeFileSync(driftPath, `${driftOriginal}\nchanged-after-context-read\n`, 'utf8')
  const driftedLedgerStatus = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: mcpBoot.bootstrap.turnBinding,
    contextEpoch: mcpObservationEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(driftedLedgerStatus.ok, true, JSON.stringify(driftedLedgerStatus))
  assert.strictEqual(driftedLedgerStatus.receipt.nextAction.nextOp, 'rebind')
  assert.strictEqual(driftedLedgerStatus.receipt.nextAction.errorCode, 'CONTEXT_BINDING_PENDING')
  fs.writeFileSync(driftPath, driftOriginal, 'utf8')
  fs.utimesSync(driftPath, driftStat.atime, driftStat.mtime)
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(stableLifecycleAfterWriterRecovery, null, 2)}\n`, 'utf8')

  // Two MCP writers can each start from a different lifecycle snapshot. The
  // durable ledger is a locked monotonic union, so the later SkillRoute commit
  // still observes every mandatory source instead of only the last writer.
  const splitEpoch = 'ctx-mcp-split-writer-observation-fixture'
  const splitPlan = buildFixtureContextPlan(fixture, splitEpoch)
  assert.strictEqual(persistContextPlanObservation({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextEpoch: splitEpoch,
    plan: splitPlan,
    nowMs: BASE_MS + 21
  }).status, 'persisted')
  const splitBoot = bootstrapSkillRoute({
    project: fixture.project,
    activeRoot: fixture.activeRoot,
    contextEpoch: splitEpoch,
    prompt: 'Implement the split writer route probe',
    mode: 'unified',
    cwd: fixture.projectRoot
  }, fixture.runtimeOptions)
  requestCatalogAll(fixture, splitBoot.bootstrap)
  const splitBaseline = () => ({
    contextAcquisition: {
      schemaVersion: 'ContextReadStateV2',
      contextEpoch: splitEpoch,
      activeRoot: fixture.activeRoot.replace(/\\/g, '/'),
      project: fixture.project,
      hostSessionId: 'session-mcp-split-writer',
      plan: splitPlan,
      receipt: createContextReadReceipt(splitPlan, {
        verificationMode: 'structured-plan',
        planObserved: true,
        hostSessionId: 'session-mcp-split-writer'
      }),
      targetResolved: true,
      fallbackActive: false,
      lastError: null,
      verificationMode: 'structured-plan'
    }
  })
  const splitSourceResults = splitPlan.mandatorySourceIds
    .filter(sourceId => !['profile:README.md', 'profile:config.json'].includes(sourceId))
    .map(sourceId => observedMcpSourceResult(splitPlan, sourceId))
  const splitAt = Math.max(1, Math.ceil(splitSourceResults.length / 2))
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(splitBaseline(), null, 2)}\n`, 'utf8')
  assert.strictEqual(recordMcpContextSourceObservations({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextBinding: splitPlan.contextBinding,
    hostSessionId: 'session-mcp-split-writer',
    sourceResults: splitSourceResults.slice(0, splitAt)
  }, { nowMs: BASE_MS + 22 }).ledgerStatus, 'persisted')
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(splitBaseline(), null, 2)}\n`, 'utf8')
  assert.strictEqual(recordMcpContextSourceObservations({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextBinding: splitPlan.contextBinding,
    hostSessionId: 'session-mcp-split-writer',
    sourceResults: splitSourceResults.slice(splitAt)
  }, { nowMs: BASE_MS + 23 }).ledgerStatus, 'persisted')
  const splitRecoveredCommit = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: splitBoot.bootstrap.turnBinding,
    contextEpoch: splitEpoch,
    catalogDigest: splitBoot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding: splitPlan.contextBinding
  }, fixture.runtimeOptions)
  assert.strictEqual(splitRecoveredCommit.ok, true, JSON.stringify(splitRecoveredCommit))
  writeContextBindingState(fixture, contextEpoch, 'dev')

  const staleReceiptEpoch = 'ctx-mcp-stale-source-observation-fixture'
  const staleReceiptPlan = buildFixtureContextPlan(fixture, staleReceiptEpoch)
  const stalePlanObservation = persistContextPlanObservation({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextEpoch: staleReceiptEpoch,
    plan: staleReceiptPlan,
    nowMs: BASE_MS + 30
  })
  assert.strictEqual(stalePlanObservation.status, 'persisted', JSON.stringify(stalePlanObservation))
  const staleBoot = bootstrapSkillRoute({
    project: fixture.project,
    activeRoot: fixture.activeRoot,
    contextEpoch: staleReceiptEpoch,
    prompt: 'Implement the workspace route probe',
    mode: 'unified',
    cwd: fixture.projectRoot
  }, fixture.runtimeOptions)
  requestCatalogAll(fixture, staleBoot.bootstrap)
  const staleReceipt = createContextReadReceipt(staleReceiptPlan, {
    verificationMode: 'structured-plan',
    planObserved: true,
    hostSessionId: 'session-mcp-stale-source-observation'
  })
  staleReceipt.status = 'stale'
  staleReceipt.satisfiedSourceIds = []
  staleReceipt.missingSourceIds = [...staleReceiptPlan.mandatorySourceIds]
  fs.writeFileSync(
    lifecyclePath,
    `${JSON.stringify({
      contextAcquisition: {
        schemaVersion: 'ContextReadStateV2',
        contextEpoch: staleReceiptEpoch,
        activeRoot: fixture.activeRoot.replace(/\\/g, '/'),
        project: fixture.project,
        hostSessionId: 'session-mcp-stale-source-observation',
        plan: staleReceiptPlan,
        receipt: staleReceipt,
        targetResolved: true,
        fallbackActive: false,
        lastError: null,
        verificationMode: 'structured-plan'
      }
    }, null, 2)}\n`,
    'utf8'
  )
  const staleBridge = recordMcpContextSourceObservations({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    workspaceNamespace: false,
    contextBinding: staleReceiptPlan.contextBinding,
    hostSessionId: 'session-mcp-stale-source-observation',
    sourceResults: staleReceiptPlan.mandatorySourceIds.map(sourceId => observedMcpSourceResult(staleReceiptPlan, sourceId))
  }, { nowMs: BASE_MS + 40 })
  assert.strictEqual(staleBridge.status, 'persisted', JSON.stringify(staleBridge))
  assert.deepStrictEqual(staleBridge.missingSourceIds, [])
  assert.strictEqual(staleBridge.receiptStatus, 'relevant-complete')
  const staleRecoveredCommit = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: staleBoot.bootstrap.turnBinding,
    contextEpoch: staleReceiptEpoch,
    catalogDigest: staleBoot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding: staleReceiptPlan.contextBinding
  }, fixture.runtimeOptions)
  assert.strictEqual(staleRecoveredCommit.ok, true, JSON.stringify(staleRecoveredCommit))
  writeContextBindingState(fixture, contextEpoch, 'dev')

  // Acceptance R01 / R05: choice is exactly null-or-one catalog id and the
  // public Tool schema rejects caller-authored workflow fields.
  const unknownChoice = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: 'not-in-this-catalog',
    contextBinding
  }, fixture.runtimeOptions)
  assert.strictEqual(unknownChoice.ok, false)
  assert.strictEqual(unknownChoice.errorCode, 'SKILL_NOT_AUTO_SELECTABLE')
  const multipleChoice = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: ['workspace-probe', 'report'],
    contextBinding
  }, fixture.runtimeOptions)
  assert.strictEqual(multipleChoice.ok, false)
  assert.strictEqual(multipleChoice.errorCode, 'SKILL_CHOICE_INVALID')
  const callerWorkflow = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding,
    mandatoryIds: ['report']
  }, fixture.runtimeOptions)
  assert.strictEqual(callerWorkflow.ok, false)
  assert.strictEqual(callerWorkflow.errorCode, 'REQUEST_FIELD_UNSUPPORTED')
  assert.strictEqual(callerWorkflow.details.schemaVersion, 'SkillRouteRequestShapeErrorV1')
  assert.deepStrictEqual(callerWorkflow.details.unsupportedFields, ['mandatoryIds'])
  assert.deepStrictEqual(callerWorkflow.details.allowedFields, [
    'op',
    'project',
    'turnBinding',
    'contextEpoch',
    'catalogDigest',
    'skillId',
    'contextBinding',
    'previousPlanDigest',
    'lateConditionId'
  ])
  assert.match(callerWorkflow.nextStep, /Allowed fields/)

  const contextBindingWithUnknownField = {
    ...contextBinding,
    unexpected: true
  }
  const invalidContextBinding = handleSkillRoute({
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding: contextBindingWithUnknownField
  }, fixture.runtimeOptions)
  assert.strictEqual(invalidContextBinding.ok, false)
  assert.strictEqual(invalidContextBinding.errorCode, 'CONTEXT_BINDING_INVALID')

  const commitRequest = {
    op: 'commit',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    catalogDigest: boot.bootstrap.catalogDigest,
    skillId: 'workspace-probe',
    contextBinding
  }
  // Acceptance P09: commit returns a complete plan but no Skill body.
  const commit = handleSkillRoute(commitRequest, fixture.runtimeOptions)
  assert.strictEqual(commit.ok, true, JSON.stringify(commit))
  assert.strictEqual(commit.bodyChunks.length, 0)
  assert.strictEqual(commit.receipt.decision.skillId, 'workspace-probe')
  assert.strictEqual(commit.receipt.plan.status, 'complete')
  assert.strictEqual(
    commit.receipt.obligations.selectedBusinessSkillId,
    'workspace-probe'
  )
  const committedEnvelope = JSON.parse(fs.readFileSync(catalogPaths.envelope, 'utf8'))
  assert.deepStrictEqual(
    committedEnvelope.state.servedCatalogPages,
    pages.map((_, index) => index)
  )
  assert.strictEqual(
    committedEnvelope.state.contributionLedger.items.filter(item => item.op === 'catalog').length,
    pages.length
  )
  const pendingStatus = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(pendingStatus.ok, true)
  assert.strictEqual(pendingStatus.receipt.nextAction.nextOp, 'load_stage')
  assert.strictEqual(pendingStatus.receipt.nextAction.nextCall.stageId, 'entry')
  assert.strictEqual(
    pendingStatus.receipt.nextAction.nextCall.planDigest,
    commit.receipt.plan.planDigest
  )

  const alternateCapabilityPath = path.join(fixture.root, 'capabilities.json')
  fs.writeFileSync(
    alternateCapabilityPath,
    '{"schemaVersion":"HostSkillRouteCapabilityV1","capabilities":[]}\n',
    'utf8'
  )
  const staleCapability = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, {
    ...fixture.runtimeOptions,
    capabilityPath: alternateCapabilityPath
  })
  assert.strictEqual(staleCapability.ok, false)
  assert.strictEqual(staleCapability.errorCode, 'MODE_CAPABILITY_STALE')

  const staleBusinessStop = evaluateProgressiveSkillRouteStop({
    project: fixture.project,
    contextEpoch,
    hostSessionId: `session-${contextEpoch}`,
    assistantText: 'The selected business result is not present.'
  }, {
    ...fixture.runtimeOptions,
    capabilityPath: alternateCapabilityPath
  })
  assert.strictEqual(staleBusinessStop.errorCode, 'MODE_CAPABILITY_STALE')
  assert.strictEqual(staleBusinessStop.retired, true)
  assert.strictEqual(staleBusinessStop.processComplete, false)
  assert(staleBusinessStop.pendingStageIds.length > 0)
  assert.strictEqual(staleBusinessStop.businessSatisfied, false)
  assert.strictEqual(staleBusinessStop.complete, false)
  assert.strictEqual(staleBusinessStop.nextOp, 'satisfy_business')
  assert.strictEqual(staleBusinessStop.nextCall, null)
  assert.strictEqual(
    staleBusinessStop.recovery.action,
    'reply-selected-business-core'
  )
  const satisfiedStaleBusinessStop = evaluateProgressiveSkillRouteStop({
    project: fixture.project,
    contextEpoch,
    hostSessionId: `session-${contextEpoch}`,
    assistantText: `Completed: ${staleBusinessStop.mustReplyCore}`
  }, {
    ...fixture.runtimeOptions,
    capabilityPath: alternateCapabilityPath
  })
  assert.strictEqual(satisfiedStaleBusinessStop.retired, true)
  assert.strictEqual(satisfiedStaleBusinessStop.businessSatisfied, true)
  assert.strictEqual(satisfiedStaleBusinessStop.complete, true)
  assert.strictEqual(satisfiedStaleBusinessStop.processComplete, false)
  assert.strictEqual(satisfiedStaleBusinessStop.nextOp, null)
  assert.strictEqual(
    shouldEnforceProgressiveSkillRouteStop(satisfiedStaleBusinessStop, true),
    false
  )
  const foreignSessionStaleStop = evaluateProgressiveSkillRouteStop({
    project: fixture.project,
    contextEpoch,
    hostSessionId: 'foreign-session',
    assistantText: staleBusinessStop.mustReplyCore
  }, {
    ...fixture.runtimeOptions,
    capabilityPath: alternateCapabilityPath
  })
  assert.strictEqual(foreignSessionStaleStop.present, false)
  assert.strictEqual(foreignSessionStaleStop.complete, true)
  assert.strictEqual(foreignSessionStaleStop.ignoredReason, 'HOST_SESSION_MISMATCH')
  assert.strictEqual(foreignSessionStaleStop.retired, undefined)
  const expiredPendingStop = evaluateProgressiveSkillRouteStop({
    project: fixture.project,
    contextEpoch,
    hostSessionId: `session-${contextEpoch}`,
    assistantText: staleBusinessStop.mustReplyCore
  }, {
    ...fixture.runtimeOptions,
    now: '2100-01-01T00:00:00.000Z'
  })
  assert.strictEqual(expiredPendingStop.errorCode, 'TURN_EXPIRED')
  assert.strictEqual(expiredPendingStop.retired, true)
  assert.strictEqual(expiredPendingStop.retirementReason, 'TURN_EXPIRED')
  assert.strictEqual(expiredPendingStop.processComplete, false)
  assert(expiredPendingStop.pendingStageIds.length > 0)
  assert.strictEqual(expiredPendingStop.businessSatisfied, true)
  assert.strictEqual(expiredPendingStop.complete, true)
  assert.strictEqual(expiredPendingStop.nextOp, null)
  assert.strictEqual(
    expiredPendingStop.recovery.action,
    'retire-and-allow-stop'
  )

  const lifecycle = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'))
  const receiptIdOnlyLifecycle = JSON.parse(JSON.stringify(lifecycle))
  receiptIdOnlyLifecycle.contextAcquisition.receipt.receiptId = 'receipt-transient-identity'
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(receiptIdOnlyLifecycle, null, 2)}\n`, 'utf8')
  const receiptIdOnlyStatus = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(receiptIdOnlyStatus.ok, true, JSON.stringify(receiptIdOnlyStatus))
  assert.strictEqual(receiptIdOnlyStatus.receipt.nextAction.nextOp, 'load_stage')
  assert.strictEqual(receiptIdOnlyStatus.receipt.nextAction.errorCode, null)
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(lifecycle, null, 2)}\n`, 'utf8')

  lifecycle.contextAcquisition.receipt.status = 'planned'
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(lifecycle, null, 2)}\n`, 'utf8')
  const staleContextStatus = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(staleContextStatus.ok, true)
  assert.strictEqual(staleContextStatus.receipt.nextAction.nextOp, 'rebind')
  assert.strictEqual(staleContextStatus.receipt.nextAction.errorCode, 'CONTEXT_BINDING_PENDING')
  const staleContextLoad = handleSkillRoute({
    op: 'load_stage',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    generation: commit.receipt.plan.generation,
    planDigest: commit.receipt.plan.planDigest,
    stageId: 'entry'
  }, fixture.runtimeOptions)
  assert.strictEqual(staleContextLoad.ok, false)
  assert.strictEqual(staleContextLoad.errorCode, 'CONTEXT_BINDING_PENDING')
  assert.strictEqual(staleContextLoad.details.schemaVersion, 'SkillRouteContextRecoveryV1')
  assert.strictEqual(staleContextLoad.details.reasonCode, 'receipt-status-planned')
  assert.deepStrictEqual(staleContextLoad.details.nextOperation.refreshContext, [
    'profile_context_plan',
    'memory_status',
    'profile_load'
  ])
  assert.strictEqual(staleContextLoad.details.nextOperation.rebind.op, 'rebind')
  assert.strictEqual(staleContextLoad.details.nextOperation.loadStageAfterRebind.stageId, 'entry')
  lifecycle.contextAcquisition.receipt.status = 'relevant-complete'
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(lifecycle, null, 2)}\n`, 'utf8')

  // Acceptance P05: stage DAG order is enforced.
  const earlyCloseout = handleSkillRoute({
    op: 'load_stage',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    generation: commit.receipt.plan.generation,
    planDigest: commit.receipt.plan.planDigest,
    stageId: 'closeout'
  }, fixture.runtimeOptions)
  assert.strictEqual(earlyCloseout.ok, false)
  assert.strictEqual(earlyCloseout.errorCode, 'STAGE_ORDER_VIOLATION')

  const planBinding = {
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    generation: commit.receipt.plan.generation,
    planDigest: commit.receipt.plan.planDigest
  }
  const entryPages = loadStageAll(fixture, planBinding, 'entry')
  assert(entryPages.some(response =>
    response.bodyChunks.some(chunk => chunk.skillId === 'workspace-probe')
  ))
  assert(entryPages.every(response => response.delivery.serializedBytes <= 48 * 1024))

  const statusAfterEntry = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  const consumedAfterEntry = statusAfterEntry.receipt.budget.bodyBytesConsumed
  // Acceptance T04: replay returns the exact body response without recharging.
  const entryReplay = handleSkillRoute({
    op: 'load_stage',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    generation: commit.receipt.plan.generation,
    planDigest: commit.receipt.plan.planDigest,
    stageId: 'entry',
    triggerRef: 'retry-with-different-diagnostic'
  }, fixture.runtimeOptions)
  assert.deepStrictEqual(entryReplay, entryPages[0])
  const statusAfterReplay = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(statusAfterReplay.receipt.budget.bodyBytesConsumed, consumedAfterEntry)

  const initialCloseoutPages = loadStageAll(fixture, planBinding, 'closeout')
  assert(initialCloseoutPages.some(page => page.receipt.chargedBodyBytes > 0))
  const statusAfterInitialCloseout = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(statusAfterInitialCloseout.receipt.obligations.processComplete, true)
  assert.strictEqual(statusAfterInitialCloseout.receipt.stageProgress.closeout.status, 'loaded')

  const conditionBeforeReplan = handleSkillRoute({
    op: 'load_stage',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    generation: commit.receipt.plan.generation,
    planDigest: commit.receipt.plan.planDigest,
    stageId: 'execution:test-validation',
    triggerRef: 'test:condition'
  }, fixture.runtimeOptions)
  assert.strictEqual(conditionBeforeReplan.ok, false)
  assert.strictEqual(conditionBeforeReplan.errorCode, 'STAGE_NOT_FOUND')

  // Acceptance P07: late conditions create a new generation and preserve only
  // fully loaded compatible progress.
  const replan = handleSkillRoute({
    ...commitRequest,
    previousPlanDigest: commit.receipt.plan.planDigest,
    lateConditionId: 'test-validation'
  }, fixture.runtimeOptions)
  assert.strictEqual(replan.ok, true, JSON.stringify(replan))
  assert.strictEqual(replan.receipt.plan.generation, 1)
  assert.notStrictEqual(replan.idempotencyKey, commit.idempotencyKey)
  assert(replan.receipt.plan.stages.some(stage =>
    stage.stageId === 'execution:test-validation'
  ))
  const statusAfterLateCloseoutReplan = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(statusAfterLateCloseoutReplan.receipt.stageProgress.entry.status, 'loaded')
  assert.strictEqual(statusAfterLateCloseoutReplan.receipt.stageProgress.closeout, undefined)
  assert.strictEqual(
    statusAfterLateCloseoutReplan.receipt.nextAction.nextCall.stageId,
    'execution:test-validation'
  )

  const changedChoice = handleSkillRoute({
    ...commitRequest,
    skillId: null,
    previousPlanDigest: replan.receipt.plan.planDigest,
    lateConditionId: 'control-plane'
  }, fixture.runtimeOptions)
  assert.strictEqual(changedChoice.ok, false)
  assert.strictEqual(changedChoice.errorCode, 'LATE_REPLAN_CHOICE_CHANGED')

  const secondReplan = handleSkillRoute({
    ...commitRequest,
    previousPlanDigest: replan.receipt.plan.planDigest,
    lateConditionId: 'control-plane'
  }, fixture.runtimeOptions)
  assert.strictEqual(secondReplan.ok, true, JSON.stringify(secondReplan))
  assert.deepStrictEqual(
    secondReplan.receipt.plan.activatedConditionIds,
    ['control-plane', 'test-validation']
  )
  assert(secondReplan.receipt.plan.selectedIds.includes('test-router'))
  assert(secondReplan.receipt.plan.selectedIds.includes('spec-governance'))

  const statusAfterReplan = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(statusAfterReplan.receipt.stageProgress.entry.status, 'loaded')
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      statusAfterReplan.receipt.stageProgress.entry,
      'loadedKeys'
    ),
    false
  )
  assert(statusAfterReplan.receipt.stageProgress.entry.loadedKeyCount > 0)

  const replannedBinding = {
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    generation: secondReplan.receipt.plan.generation,
    planDigest: secondReplan.receipt.plan.planDigest
  }
  const skippedStagePage = handleSkillRoute({
    op: 'load_stage',
    project: fixture.project,
    ...replannedBinding,
    stageId: 'execution:control-plane',
    cursor: encodeCursor({
      schemaVersion: 'StageLoadCursorV1',
      project: fixture.project,
      turnBinding: boot.bootstrap.turnBinding,
      contextEpoch,
      planDigest: secondReplan.receipt.plan.planDigest,
      stageId: 'execution:control-plane',
      pageIndex: 1
    })
  }, fixture.runtimeOptions)
  assert.strictEqual(skippedStagePage.ok, false)
  assert.strictEqual(
    skippedStagePage.errorCode,
    'STAGE_CURSOR_OUT_OF_SEQUENCE'
  )
  loadStageAll(fixture, replannedBinding, 'execution:test-validation')
  loadStageAll(fixture, replannedBinding, 'execution:control-plane')
  const reopenedCloseoutPages = loadStageAll(fixture, replannedBinding, 'closeout')
  assert(reopenedCloseoutPages.every(page => page.receipt.chargedBodyBytes === 0))
  assert(reopenedCloseoutPages.every(page => page.receipt.chargedIdentityCount === 0))

  const persisted = loadEnvelope(
    fixture.activeRoot,
    boot.bootstrap.turnBinding,
    fixture.runtimeOptions
  )
  assert.strictEqual(persisted.envelope.state.plan.generation, 2)
  assert.strictEqual(
    persisted.envelope.state.plan.planDigest,
    secondReplan.receipt.plan.planDigest
  )
  assert.deepStrictEqual(
    persisted.envelope.state.plan.activatedConditionIds,
    ['control-plane', 'test-validation']
  )
  assert.strictEqual(persisted.envelope.state.stageProgress.closeout.status, 'loaded')

  // Acceptance P11: process completion and must-reply are both required.
  const missingBusinessReply = evaluateProgressiveSkillRouteStop({
    project: fixture.project,
    contextEpoch,
    assistantText: 'Implementation finished.'
  }, fixture.runtimeOptions)
  assert.strictEqual(missingBusinessReply.present, true)
  assert.strictEqual(missingBusinessReply.processComplete, true)
  assert.strictEqual(missingBusinessReply.businessSatisfied, false)
  assert.strictEqual(missingBusinessReply.complete, false)
  const completedStop = evaluateProgressiveSkillRouteStop({
    project: fixture.project,
    contextEpoch,
    assistantText: 'WORKSPACE_ROUTE_COMPLETE'
  }, fixture.runtimeOptions)
  assert.strictEqual(completedStop.complete, true)

  // B0 recovery: a fresh ContextRead binding may replace only the binding and
  // generation of an otherwise identical route plan.
  const rebindFixture = createSkillRouteFixture({ project: 'rebind' })
  try {
    const rebindEpoch = 'ctx-rebind'
    const rebindSession = 'session-rebind'
    const firstBinding = writeContextBindingState(
      rebindFixture,
      rebindEpoch,
      'dev',
      rebindSession,
      '-first'
    )
    const rebindBoot = bootstrapSkillRoute({
      project: rebindFixture.project,
      activeRoot: rebindFixture.activeRoot,
      contextEpoch: rebindEpoch,
      prompt: 'Run the rebind probe',
      mode: 'unified',
      cwd: rebindFixture.projectRoot
    }, rebindFixture.runtimeOptions)
    requestCatalogAll(rebindFixture, rebindBoot.bootstrap)
    const firstCommit = handleSkillRoute({
      op: 'commit',
      project: rebindFixture.project,
      turnBinding: rebindBoot.bootstrap.turnBinding,
      contextEpoch: rebindEpoch,
      catalogDigest: rebindBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: firstBinding
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(firstCommit.ok, true, JSON.stringify(firstCommit))
    loadStageAll(
      rebindFixture,
      {
        turnBinding: rebindBoot.bootstrap.turnBinding,
        contextEpoch: rebindEpoch,
        generation: firstCommit.receipt.plan.generation,
        planDigest: firstCommit.receipt.plan.planDigest
      },
      'entry'
    )
    const pendingCloseoutStop = evaluateProgressiveSkillRouteStop({
      project: rebindFixture.project,
      contextEpoch: rebindEpoch,
      hostSessionId: rebindSession,
      assistantText: 'Still working.'
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(pendingCloseoutStop.complete, false)
    assert.strictEqual(pendingCloseoutStop.nextOp, 'load_stage')
    assert.strictEqual(pendingCloseoutStop.nextCall.stageId, 'closeout')
    assert.strictEqual(
      pendingCloseoutStop.nextCall.planDigest,
      firstCommit.receipt.plan.planDigest
    )
    const rebindLifecyclePath = path.join(
      rebindFixture.activeRoot,
      '.memory',
      'hooks',
      rebindFixture.project,
      'lifecycle-state.json'
    )
    const staleLifecycle = JSON.parse(
      fs.readFileSync(rebindLifecyclePath, 'utf8')
    )
    staleLifecycle.contextAcquisition.receipt.status = 'stale'
    fs.writeFileSync(
      rebindLifecyclePath,
      `${JSON.stringify(staleLifecycle, null, 2)}\n`,
      'utf8'
    )
    const recoverableStop = evaluateProgressiveSkillRouteStop({
      project: rebindFixture.project,
      contextEpoch: rebindEpoch,
      hostSessionId: rebindSession,
      assistantText: 'Still working.'
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(recoverableStop.complete, false)
    assert.strictEqual(recoverableStop.errorCode, 'CONTEXT_BINDING_PENDING')
    assert.strictEqual(recoverableStop.nextOp, 'rebind')
    assert.strictEqual(recoverableStop.nextCall.op, 'rebind')
    assert.strictEqual(recoverableStop.nextCall.generation, firstCommit.receipt.plan.generation)
    assert.strictEqual(recoverableStop.nextCall.planDigest, firstCommit.receipt.plan.planDigest)
    assert.strictEqual(recoverableStop.recovery.schemaVersion, 'SkillRouteContextRecoveryV1')
    assert.strictEqual(recoverableStop.recovery.reasonCode, 'receipt-status-stale')
    assert.strictEqual(recoverableStop.recovery.nextOperation.rebind.op, 'rebind')
    const foreignSessionStop = evaluateProgressiveSkillRouteStop({
      project: rebindFixture.project,
      contextEpoch: rebindEpoch,
      hostSessionId: 'another-session',
      assistantText: 'Unrelated task.'
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(foreignSessionStop.present, false)
    assert.strictEqual(foreignSessionStop.complete, true)
    assert.strictEqual(foreignSessionStop.ignoredReason, 'HOST_SESSION_MISMATCH')

    const freshBinding = writeContextBindingState(
      rebindFixture,
      rebindEpoch,
      'dev',
      rebindSession,
      '-fresh'
    )
    const wrongPlan = handleSkillRoute({
      op: 'rebind',
      project: rebindFixture.project,
      turnBinding: rebindBoot.bootstrap.turnBinding,
      contextEpoch: rebindEpoch,
      generation: firstCommit.receipt.plan.generation,
      planDigest: '0'.repeat(64),
      contextBinding: freshBinding
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(wrongPlan.ok, false)
    assert.strictEqual(wrongPlan.errorCode, 'PLAN_BINDING_INVALID')
    const rebound = handleSkillRoute({
      op: 'rebind',
      project: rebindFixture.project,
      turnBinding: rebindBoot.bootstrap.turnBinding,
      contextEpoch: rebindEpoch,
      generation: firstCommit.receipt.plan.generation,
      planDigest: firstCommit.receipt.plan.planDigest,
      contextBinding: freshBinding
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(rebound.ok, true, JSON.stringify(rebound))
    assert.strictEqual(
      rebound.receipt.plan.generation,
      firstCommit.receipt.plan.generation + 1
    )
    assert.strictEqual(
      rebound.receipt.preservedStageProgress.entry.status,
      'loaded'
    )
    assert(rebound.receipt.plan.selectedIds.includes('workspace-probe'))
    assert.strictEqual(
      loadEnvelope(
        rebindFixture.activeRoot,
        rebindBoot.bootstrap.turnBinding,
        rebindFixture.runtimeOptions
      ).envelope.state.decision.skillId,
      'workspace-probe'
    )

    // A real semantic change is never rebound in place. It atomically retires
    // the old route so Status and Stop cannot replay the rejected rebind.
    const driftBinding = writeContextBindingState(
      rebindFixture,
      rebindEpoch,
      'fix',
      rebindSession,
      '-drift'
    )
    const semanticDrift = handleSkillRoute({
      op: 'rebind',
      project: rebindFixture.project,
      turnBinding: rebindBoot.bootstrap.turnBinding,
      contextEpoch: rebindEpoch,
      generation: rebound.receipt.plan.generation,
      planDigest: rebound.receipt.plan.planDigest,
      contextBinding: driftBinding
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(semanticDrift.ok, false)
    assert.strictEqual(semanticDrift.errorCode, 'REBIND_SEMANTIC_DRIFT')
    assert.strictEqual(semanticDrift.stateChanged, true)
    assert.strictEqual(semanticDrift.details.terminal, true)
    assert.strictEqual(semanticDrift.details.retrySameCall, false)
    assert.strictEqual(
      semanticDrift.details.action,
      'retire-and-rebootstrap-next-user-prompt'
    )
    assert(!semanticDrift.nextStep.includes('retry the same'))

    const retiredEnvelope = loadEnvelope(
      rebindFixture.activeRoot,
      rebindBoot.bootstrap.turnBinding,
      rebindFixture.runtimeOptions
    ).envelope
    assert.strictEqual(
      retiredEnvelope.state.routeRetirement.reasonCode,
      'REBIND_SEMANTIC_DRIFT'
    )
    assert.strictEqual(retiredEnvelope.state.routeRetirement.terminal, true)

    const retiredStatus = handleSkillRoute({
      op: 'status',
      project: rebindFixture.project,
      turnBinding: rebindBoot.bootstrap.turnBinding,
      contextEpoch: rebindEpoch
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(retiredStatus.ok, true)
    assert.strictEqual(retiredStatus.receipt.retired, true)
    assert.strictEqual(
      retiredStatus.receipt.nextAction.errorCode,
      'REBIND_SEMANTIC_DRIFT'
    )
    assert.strictEqual(retiredStatus.receipt.nextAction.nextOp, null)
    assert.strictEqual(retiredStatus.receipt.nextAction.nextCall, null)
    assert.strictEqual(
      retiredStatus.receipt.nextAction.recovery.retrySameCall,
      false
    )

    const retiredStop = evaluateProgressiveSkillRouteStop({
      project: rebindFixture.project,
      contextEpoch: rebindEpoch,
      hostSessionId: rebindSession,
      assistantText: 'Still working.'
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(retiredStop.complete, true)
    assert.strictEqual(retiredStop.retired, true)
    assert.strictEqual(retiredStop.retirementReason, 'REBIND_SEMANTIC_DRIFT')
    assert.strictEqual(retiredStop.processComplete, false)
    assert.strictEqual(retiredStop.nextOp, null)
    assert.strictEqual(retiredStop.nextCall, null)
    assert.strictEqual(retiredStop.recovery.retrySameCall, false)
    assert.strictEqual(
      shouldEnforceProgressiveSkillRouteStop(retiredStop, true),
      false
    )

    const postRetirementLoad = handleSkillRoute({
      op: 'load_stage',
      project: rebindFixture.project,
      turnBinding: rebindBoot.bootstrap.turnBinding,
      contextEpoch: rebindEpoch,
      generation: rebound.receipt.plan.generation,
      planDigest: rebound.receipt.plan.planDigest,
      stageId: 'closeout'
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(postRetirementLoad.ok, false)
    assert.strictEqual(postRetirementLoad.op, 'load_stage')
    assert.strictEqual(postRetirementLoad.errorCode, 'REBIND_SEMANTIC_DRIFT')
    assert.strictEqual(postRetirementLoad.stateChanged, false)
    assert.strictEqual(postRetirementLoad.details.retrySameCall, false)

    const postRetirementCommit = handleSkillRoute({
      op: 'commit',
      project: rebindFixture.project,
      turnBinding: rebindBoot.bootstrap.turnBinding,
      contextEpoch: rebindEpoch,
      catalogDigest: rebindBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: driftBinding
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(postRetirementCommit.ok, false)
    assert.strictEqual(postRetirementCommit.op, 'commit')
    assert.strictEqual(postRetirementCommit.errorCode, 'REBIND_SEMANTIC_DRIFT')
    assert.strictEqual(postRetirementCommit.stateChanged, false)
    assert.strictEqual(postRetirementCommit.details.retrySameCall, false)

    const postRetirementBinding = writeContextBindingState(
      rebindFixture,
      rebindEpoch,
      'dev',
      rebindSession,
      '-post-retirement'
    )
    const postRetirementRebind = handleSkillRoute({
      op: 'rebind',
      project: rebindFixture.project,
      turnBinding: rebindBoot.bootstrap.turnBinding,
      contextEpoch: rebindEpoch,
      generation: rebound.receipt.plan.generation,
      planDigest: rebound.receipt.plan.planDigest,
      contextBinding: postRetirementBinding
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(postRetirementRebind.ok, false)
    assert.strictEqual(
      postRetirementRebind.errorCode,
      'REBIND_SEMANTIC_DRIFT'
    )
    assert.strictEqual(postRetirementRebind.stateChanged, false)
    assert.strictEqual(postRetirementRebind.details.retrySameCall, false)
  } finally {
    rebindFixture.cleanup()
  }

  // F-010 regression: a ContextRead refresh must resume a partially loaded
  // compatible stage with a cursor signed for the rebound plan.
  const partialRebindFixture = createSkillRouteFixture({ project: 'rebind-partial' })
  try {
    const partialEpoch = 'ctx-rebind-partial'
    const partialSession = 'session-rebind-partial'
    const partialBinding = writeContextBindingState(
      partialRebindFixture,
      partialEpoch,
      'dev',
      partialSession,
      '-first'
    )
    const partialBoot = bootstrapSkillRoute({
      project: partialRebindFixture.project,
      activeRoot: partialRebindFixture.activeRoot,
      contextEpoch: partialEpoch,
      prompt: 'Run the partial rebind probe',
      mode: 'unified',
      cwd: partialRebindFixture.projectRoot
    }, partialRebindFixture.runtimeOptions)
    requestCatalogAll(partialRebindFixture, partialBoot.bootstrap)
    const partialCommit = handleSkillRoute({
      op: 'commit',
      project: partialRebindFixture.project,
      turnBinding: partialBoot.bootstrap.turnBinding,
      contextEpoch: partialEpoch,
      catalogDigest: partialBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: partialBinding
    }, partialRebindFixture.runtimeOptions)
    assert.strictEqual(partialCommit.ok, true, JSON.stringify(partialCommit))
    const controlPlaneCommit = handleSkillRoute({
      op: 'commit',
      project: partialRebindFixture.project,
      turnBinding: partialBoot.bootstrap.turnBinding,
      contextEpoch: partialEpoch,
      catalogDigest: partialBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: partialBinding,
      previousPlanDigest: partialCommit.receipt.plan.planDigest,
      lateConditionId: 'control-plane'
    }, partialRebindFixture.runtimeOptions)
    assert.strictEqual(controlPlaneCommit.ok, true, JSON.stringify(controlPlaneCommit))
    const controlPlan = {
      turnBinding: partialBoot.bootstrap.turnBinding,
      contextEpoch: partialEpoch,
      generation: controlPlaneCommit.receipt.plan.generation,
      planDigest: controlPlaneCommit.receipt.plan.planDigest
    }
    loadStageAll(partialRebindFixture, controlPlan, 'entry')
    const firstControlPage = handleSkillRoute({
      op: 'load_stage',
      project: partialRebindFixture.project,
      ...controlPlan,
      stageId: 'execution:control-plane',
      triggerRef: 'test:partial-before-rebind'
    }, partialRebindFixture.runtimeOptions)
    assert.strictEqual(firstControlPage.ok, true, JSON.stringify(firstControlPage))
    assert.strictEqual(firstControlPage.receipt.stageStatus, 'loading')
    assert(firstControlPage.receipt.nextCursor)

    const partialLifecyclePath = path.join(
      partialRebindFixture.activeRoot,
      '.memory',
      'hooks',
      partialRebindFixture.project,
      'lifecycle-state.json'
    )
    const partialLifecycle = JSON.parse(
      fs.readFileSync(partialLifecyclePath, 'utf8')
    )
    partialLifecycle.contextAcquisition.receipt.status = 'stale'
    fs.writeFileSync(
      partialLifecyclePath,
      `${JSON.stringify(partialLifecycle, null, 2)}\n`,
      'utf8'
    )
    const partialStop = evaluateProgressiveSkillRouteStop({
      project: partialRebindFixture.project,
      contextEpoch: partialEpoch,
      hostSessionId: partialSession,
      assistantText: 'Still working.'
    }, partialRebindFixture.runtimeOptions)
    assert.strictEqual(partialStop.complete, false)
    assert.strictEqual(partialStop.nextOp, 'rebind')

    const partialFreshBinding = writeContextBindingState(
      partialRebindFixture,
      partialEpoch,
      'dev',
      partialSession,
      '-fresh'
    )
    const partialRebindRequest = {
      op: 'rebind',
      project: partialRebindFixture.project,
      turnBinding: partialBoot.bootstrap.turnBinding,
      contextEpoch: partialEpoch,
      generation: controlPlan.generation,
      planDigest: controlPlan.planDigest,
      contextBinding: partialFreshBinding
    }
    const partialRebound = handleSkillRoute(
      partialRebindRequest,
      partialRebindFixture.runtimeOptions
    )
    assert.strictEqual(partialRebound.ok, true, JSON.stringify(partialRebound))
    assert.strictEqual(
      partialRebound.receipt.preservedStageProgress['execution:control-plane'].status,
      'loading'
    )
    assert.strictEqual(partialRebound.receipt.nextAction.nextOp, 'load_stage')
    assert.strictEqual(
      partialRebound.receipt.nextAction.nextCall.stageId,
      'execution:control-plane'
    )
    assert(partialRebound.receipt.nextAction.nextCall.cursor)
    assert.notStrictEqual(
      partialRebound.receipt.nextAction.nextCall.cursor,
      firstControlPage.receipt.nextCursor
    )
    const reboundPendingStatus = handleSkillRoute({
      op: 'status',
      project: partialRebindFixture.project,
      turnBinding: partialBoot.bootstrap.turnBinding,
      contextEpoch: partialEpoch
    }, partialRebindFixture.runtimeOptions)
    assert.strictEqual(reboundPendingStatus.ok, true)
    assert.deepStrictEqual(
      reboundPendingStatus.receipt.nextAction.nextCall,
      partialRebound.receipt.nextAction.nextCall
    )
    const reboundPendingStop = evaluateProgressiveSkillRouteStop({
      project: partialRebindFixture.project,
      contextEpoch: partialEpoch,
      hostSessionId: partialSession,
      assistantText: 'Still working.'
    }, partialRebindFixture.runtimeOptions)
    assert.strictEqual(reboundPendingStop.complete, false)
    assert.deepStrictEqual(
      reboundPendingStop.nextCall,
      partialRebound.receipt.nextAction.nextCall
    )
    assert.deepStrictEqual(
      handleSkillRoute(partialRebindRequest, partialRebindFixture.runtimeOptions),
      partialRebound
    )

    let resumedCall = partialRebound.receipt.nextAction.nextCall
    let resumedPage
    do {
      resumedPage = handleSkillRoute(resumedCall, partialRebindFixture.runtimeOptions)
      assert.strictEqual(resumedPage.ok, true, JSON.stringify(resumedPage))
      resumedCall = resumedPage.receipt.nextCursor
        ? { ...resumedCall, cursor: resumedPage.receipt.nextCursor }
        : null
    } while (resumedCall)
    assert.strictEqual(resumedPage.receipt.stageStatus, 'loaded')

    const reboundPlan = {
      turnBinding: partialBoot.bootstrap.turnBinding,
      contextEpoch: partialEpoch,
      generation: partialRebound.receipt.plan.generation,
      planDigest: partialRebound.receipt.plan.planDigest
    }
    loadStageAll(partialRebindFixture, reboundPlan, 'closeout')
    const completedPartialStatus = handleSkillRoute({
      op: 'status',
      project: partialRebindFixture.project,
      turnBinding: partialBoot.bootstrap.turnBinding,
      contextEpoch: partialEpoch
    }, partialRebindFixture.runtimeOptions)
    assert.strictEqual(completedPartialStatus.ok, true)
    assert.strictEqual(completedPartialStatus.receipt.obligations.processComplete, true)
  } finally {
    partialRebindFixture.cleanup()
  }

  const staleFixture = createSkillRouteFixture({ project: 'stale' })
  try {
    const staleEpoch = 'ctx-stale'
    const staleBinding = writeContextBindingState(staleFixture, staleEpoch, 'dev')
    const staleBoot = bootstrapSkillRoute({
      project: staleFixture.project,
      activeRoot: staleFixture.activeRoot,
      contextEpoch: staleEpoch,
      prompt: 'Use workspace-probe',
      mode: 'unified',
      cwd: staleFixture.projectRoot
    }, staleFixture.runtimeOptions)
    requestCatalogAll(staleFixture, staleBoot.bootstrap)
    writeWorkspaceSkill(staleFixture.root, 'workspace-probe', '-changed')
    const staleCommit = handleSkillRoute({
      op: 'commit',
      project: staleFixture.project,
      turnBinding: staleBoot.bootstrap.turnBinding,
      contextEpoch: staleEpoch,
      catalogDigest: staleBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: staleBinding
    }, staleFixture.runtimeOptions)
    assert.strictEqual(staleCommit.ok, false)
    assert.strictEqual(staleCommit.errorCode, 'CATALOG_STALE')
    assert.strictEqual(
      staleCommit.details.schemaVersion,
      'SkillRouteCatalogIndexDriftV1'
    )
    assert.strictEqual(staleCommit.details.reasonCode, 'index-digest-mismatch')
    assert.deepStrictEqual(staleCommit.details.addedSkillIds, [])
    assert.deepStrictEqual(staleCommit.details.removedSkillIds, [])
    assert.deepStrictEqual(
      staleCommit.details.changedSkills.map(item => item.skillId),
      ['workspace-probe']
    )
    assert.ok(
      staleCommit.details.changedSkills[0].fields.includes('bodyDigest')
    )
  } finally {
    staleFixture.cleanup()
  }

  const authorityFixture = createSkillRouteFixture({ project: 'authority' })
  try {
    const authorityEpoch = 'ctx-runtime-authority'
    const authorityBinding = writeContextBindingState(
      authorityFixture,
      authorityEpoch,
      'dev'
    )
    const registry = JSON.parse(fs.readFileSync(DEFAULT_REGISTRY_PATH, 'utf8'))
    registry.conditionals.push({
      conditionId: 'runtime-only',
      intents: ['dev'],
      activationAuthority: 'runtime-event',
      roots: [{
        skillId: 'report',
        budgetClass: 'hard',
        loadStage: 'execution:runtime-only'
      }]
    })
    registry.registryDigest = sha256({
      schemaVersion: registry.schemaVersion,
      baseBundles: registry.baseBundles,
      routes: registry.routes,
      conditionals: registry.conditionals
    })
    const authorityOptions = {
      ...authorityFixture.runtimeOptions,
      registry
    }
    const authorityBoot = bootstrapSkillRoute({
      project: authorityFixture.project,
      activeRoot: authorityFixture.activeRoot,
      contextEpoch: authorityEpoch,
      prompt: 'Run the authority probe',
      mode: 'unified',
      cwd: authorityFixture.projectRoot
    }, authorityOptions)
    requestCatalogAll(authorityFixture, authorityBoot.bootstrap, authorityOptions)
    const authorityCommitRequest = {
      op: 'commit',
      project: authorityFixture.project,
      turnBinding: authorityBoot.bootstrap.turnBinding,
      contextEpoch: authorityEpoch,
      catalogDigest: authorityBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: authorityBinding
    }
    const authorityCommit = handleSkillRoute(authorityCommitRequest, authorityOptions)
    assert.strictEqual(authorityCommit.ok, false)
    assert.strictEqual(authorityCommit.errorCode, 'WORKFLOW_REGISTRY_STALE')
  } finally {
    authorityFixture.cleanup()
  }

  // Acceptance P10: a body changed after planning is rejected without leaking
  // either the old or the new body.
  const bodyStaleFixture = createSkillRouteFixture({ project: 'body-stale' })
  try {
    const bodyStaleEpoch = 'ctx-body-stale'
    const bodyStaleBinding = writeContextBindingState(
      bodyStaleFixture,
      bodyStaleEpoch,
      'dev'
    )
    const bodyStaleBoot = bootstrapSkillRoute({
      project: bodyStaleFixture.project,
      activeRoot: bodyStaleFixture.activeRoot,
      contextEpoch: bodyStaleEpoch,
      prompt: 'Run the body stale probe',
      mode: 'unified',
      cwd: bodyStaleFixture.projectRoot
    }, bodyStaleFixture.runtimeOptions)
    requestCatalogAll(bodyStaleFixture, bodyStaleBoot.bootstrap)
    const bodyStaleCommit = handleSkillRoute({
      op: 'commit',
      project: bodyStaleFixture.project,
      turnBinding: bodyStaleBoot.bootstrap.turnBinding,
      contextEpoch: bodyStaleEpoch,
      catalogDigest: bodyStaleBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: bodyStaleBinding
    }, bodyStaleFixture.runtimeOptions)
    assert.strictEqual(bodyStaleCommit.ok, true)
    fs.appendFileSync(
      path.join(
        bodyStaleFixture.root,
        '.devcodex',
        'workspace',
        'skills',
        'workspace-probe',
        'SKILL.md'
      ),
      '\nBODY_CHANGED_AFTER_PLAN\n',
      'utf8'
    )
    const bodyStaleLoad = handleSkillRoute({
      op: 'load_stage',
      project: bodyStaleFixture.project,
      turnBinding: bodyStaleBoot.bootstrap.turnBinding,
      contextEpoch: bodyStaleEpoch,
      generation: bodyStaleCommit.receipt.plan.generation,
      planDigest: bodyStaleCommit.receipt.plan.planDigest,
      stageId: 'entry'
    }, bodyStaleFixture.runtimeOptions)
    assert.strictEqual(bodyStaleLoad.ok, false)
    assert.strictEqual(bodyStaleLoad.errorCode, 'SKILL_BODY_STALE')
    assert.deepStrictEqual(bodyStaleLoad.bodyChunks, [])
  } finally {
    bodyStaleFixture.cleanup()
  }

  // Acceptance R03: explicit selection suppresses the free choice but still
  // produces the complete workflow/budget plan.
  const explicitFixture = createSkillRouteFixture({ project: 'explicit-route' })
  try {
    const explicitEpoch = 'ctx-explicit-route'
    const explicitBinding = writeContextBindingState(
      explicitFixture,
      explicitEpoch,
      'dev'
    )
    const explicitBoot = bootstrapSkillRoute({
      project: explicitFixture.project,
      activeRoot: explicitFixture.activeRoot,
      contextEpoch: explicitEpoch,
      prompt: 'skill: workspace-probe',
      mode: 'unified',
      cwd: explicitFixture.projectRoot
    }, explicitFixture.runtimeOptions)
    assert.strictEqual(explicitBoot.bootstrap.explicitStatus, 'ready')
    const explicitNotCommitted = evaluateProgressiveSkillRouteStop({
      project: explicitFixture.project,
      contextEpoch: explicitEpoch,
      hostSessionId: null,
      assistantText: ''
    }, explicitFixture.runtimeOptions)
    assert.strictEqual(explicitNotCommitted.errorCode, 'PLAN_NOT_COMMITTED')
    assert.strictEqual(explicitNotCommitted.nextOp, 'commit')
    assert.strictEqual(explicitNotCommitted.nextCall.op, 'commit')
    assert.strictEqual(explicitNotCommitted.nextCall.catalogDigest, explicitBoot.bootstrap.catalogDigest)
    const explicitCommit = handleSkillRoute({
      op: 'commit',
      project: explicitFixture.project,
      turnBinding: explicitBoot.bootstrap.turnBinding,
      contextEpoch: explicitEpoch,
      catalogDigest: explicitBoot.bootstrap.catalogDigest,
      skillId: null,
      contextBinding: explicitBinding
    }, explicitFixture.runtimeOptions)
    assert.strictEqual(explicitCommit.ok, true)
    assert.strictEqual(explicitCommit.receipt.decision.source, 'explicit')
    assert.strictEqual(explicitCommit.receipt.decision.skillId, null)
    assert(explicitCommit.receipt.plan.selectedIds.includes('workspace-probe'))

    const explicitWithFree = handleSkillRoute({
      op: 'commit',
      project: explicitFixture.project,
      turnBinding: explicitBoot.bootstrap.turnBinding,
      contextEpoch: explicitEpoch,
      catalogDigest: explicitBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: explicitBinding
    }, explicitFixture.runtimeOptions)
    assert.strictEqual(explicitWithFree.ok, false)
    assert.strictEqual(explicitWithFree.errorCode, 'FREE_WITH_EXPLICIT')
  } finally {
    explicitFixture.cleanup()
  }

  // Acceptance R08: disabling W removes W cards; a workspace-only always-on
  // root becomes an explicit blocked receipt instead of being ignored.
  const killSwitchFixture = createSkillRouteFixture({ project: 'kill-switch' })
  try {
    fs.writeFileSync(
      path.join(
        killSwitchFixture.root,
        '.devcodex',
        'workspace',
        'DEVCODEX.md'
      ),
      '# Workspace\n\n- always-on: workspace-probe\n',
      'utf8'
    )
    const disabledOptions = {
      ...killSwitchFixture.runtimeOptions,
      env: { DEVCODEX_WORKSPACE_SKILLS: '0' }
    }
    const killEpoch = 'ctx-kill-switch'
    const killBinding = writeContextBindingState(
      killSwitchFixture,
      killEpoch,
      'dev'
    )
    const killBoot = bootstrapSkillRoute({
      project: killSwitchFixture.project,
      activeRoot: killSwitchFixture.activeRoot,
      contextEpoch: killEpoch,
      prompt: 'Run the kill switch probe',
      mode: 'unified',
      cwd: killSwitchFixture.projectRoot
    }, disabledOptions)
    const killPages = requestCatalogAll(
      killSwitchFixture,
      killBoot.bootstrap,
      disabledOptions
    )
    assert.strictEqual(
      killPages.some(response => response.receipt.cards.some(card =>
        card.skillId === 'workspace-probe'
      )),
      false
    )
    const killCommit = handleSkillRoute({
      op: 'commit',
      project: killSwitchFixture.project,
      turnBinding: killBoot.bootstrap.turnBinding,
      contextEpoch: killEpoch,
      catalogDigest: killBoot.bootstrap.catalogDigest,
      skillId: null,
      contextBinding: killBinding
    }, disabledOptions)
    assert.strictEqual(killCommit.ok, false, JSON.stringify(killCommit))
    assert.strictEqual(killCommit.errorCode, 'ROOT_PLAN_BLOCKED')
    assert.strictEqual(killCommit.receipt.plan.status, 'blocked')
    assert(killCommit.receipt.plan.blockedCodes.includes(
      'WORKSPACE_ALWAYS_ON_DISABLED'
    ))
    const killEnvelope = loadEnvelope(
      killSwitchFixture.activeRoot,
      killBoot.bootstrap.turnBinding,
      disabledOptions
    )
    assert(killEnvelope.envelope.state.plan.baseResolution.blocked.some(item =>
      item.code === 'WORKSPACE_ALWAYS_ON_DISABLED' &&
      item.skillId === 'workspace-probe'
    ))
    const blockedStop = evaluateProgressiveSkillRouteStop({
      project: killSwitchFixture.project,
      contextEpoch: killEpoch,
      hostSessionId: null,
      assistantText: ''
    }, disabledOptions)
    assert.strictEqual(blockedStop.errorCode, 'ROOT_PLAN_BLOCKED')
    assert.strictEqual(blockedStop.completionDisposition, 'retired-root-plan-blocked', JSON.stringify(blockedStop))
    assert.strictEqual(blockedStop.retired, true)
    assert.strictEqual(blockedStop.recovery.action, 'retire-and-rebootstrap-next-user-prompt')
  } finally {
    killSwitchFixture.cleanup()
  }

  // Acceptance T01a / T07 / M10: bootstrap identity is idempotent per epoch,
  // a new epoch gets a new snapshot, and changed W content cannot rewrite an
  // existing turn.
  const snapshotFixture = createSkillRouteFixture({ project: 'snapshot' })
  try {
    const firstEpoch = 'ctx-snapshot-first'
    const firstBinding = writeContextBindingState(snapshotFixture, firstEpoch, 'dev')
    const firstBoot = bootstrapSkillRoute({
      project: snapshotFixture.project,
      activeRoot: snapshotFixture.activeRoot,
      contextEpoch: firstEpoch,
      prompt: 'Run snapshot probe',
      mode: 'unified',
      cwd: snapshotFixture.projectRoot
    }, snapshotFixture.runtimeOptions)
    const firstReuse = bootstrapSkillRoute({
      project: snapshotFixture.project,
      activeRoot: snapshotFixture.activeRoot,
      contextEpoch: firstEpoch,
      prompt: 'Run snapshot probe',
      mode: 'unified',
      cwd: snapshotFixture.projectRoot
    }, snapshotFixture.runtimeOptions)
    assert.strictEqual(firstReuse.reused, true)
    requestCatalogAll(snapshotFixture, firstBoot.bootstrap)
    const firstCommit = handleSkillRoute({
      op: 'commit',
      project: snapshotFixture.project,
      turnBinding: firstBoot.bootstrap.turnBinding,
      contextEpoch: firstEpoch,
      catalogDigest: firstBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: firstBinding
    }, snapshotFixture.runtimeOptions)
    const firstEntry = loadStageAll(snapshotFixture, {
      turnBinding: firstBoot.bootstrap.turnBinding,
      contextEpoch: firstEpoch,
      generation: firstCommit.receipt.plan.generation,
      planDigest: firstCommit.receipt.plan.planDigest
    }, 'entry')
    assert(firstEntry.some(response => response.bodyChunks.length > 0))

    const secondEpoch = 'ctx-snapshot-second'
    const secondBinding = writeContextBindingState(snapshotFixture, secondEpoch, 'dev')
    const secondBoot = bootstrapSkillRoute({
      project: snapshotFixture.project,
      activeRoot: snapshotFixture.activeRoot,
      contextEpoch: secondEpoch,
      prompt: 'Run snapshot probe',
      mode: 'unified',
      cwd: snapshotFixture.projectRoot
    }, snapshotFixture.runtimeOptions)
    assert.notStrictEqual(
      secondBoot.bootstrap.turnBinding,
      firstBoot.bootstrap.turnBinding
    )
    requestCatalogAll(snapshotFixture, secondBoot.bootstrap)
    const secondCommit = handleSkillRoute({
      op: 'commit',
      project: snapshotFixture.project,
      turnBinding: secondBoot.bootstrap.turnBinding,
      contextEpoch: secondEpoch,
      catalogDigest: secondBoot.bootstrap.catalogDigest,
      skillId: 'workspace-probe',
      contextBinding: secondBinding
    }, snapshotFixture.runtimeOptions)
    const secondEntry = loadStageAll(snapshotFixture, {
      turnBinding: secondBoot.bootstrap.turnBinding,
      contextEpoch: secondEpoch,
      generation: secondCommit.receipt.plan.generation,
      planDigest: secondCommit.receipt.plan.planDigest
    }, 'entry')
    assert(secondEntry.some(response => response.bodyChunks.length > 0))

    writeWorkspaceSkill(snapshotFixture.root, 'workspace-probe', '-changed')
    assert.throws(
      () => bootstrapSkillRoute({
        project: snapshotFixture.project,
        activeRoot: snapshotFixture.activeRoot,
        contextEpoch: firstEpoch,
        prompt: 'Run snapshot probe',
        mode: 'unified',
        cwd: snapshotFixture.projectRoot
      }, snapshotFixture.runtimeOptions),
      error => error && error.code === 'BOOTSTRAP_IDENTITY_COLLISION'
    )
  } finally {
    snapshotFixture.cleanup()
  }

  const replayBudgetFixture = createSkillRouteFixture({ project: 'replay-budget' })
  try {
    const replayBoot = bootstrapSkillRoute({
      project: replayBudgetFixture.project,
      activeRoot: replayBudgetFixture.activeRoot,
      contextEpoch: 'ctx-replay-budget',
      prompt: 'Run replay budget probe',
      mode: 'unified',
      cwd: replayBudgetFixture.projectRoot
    }, replayBudgetFixture.runtimeOptions)
    const envelopeBefore = fs.readFileSync(replayBoot.paths.envelope, 'utf8')
    assert.throws(
      () => transactEnvelope(
        replayBudgetFixture.activeRoot,
        replayBoot.bootstrap.turnBinding,
        {
          op: 'test-overflow',
          project: replayBudgetFixture.project,
          contextEpoch: 'ctx-replay-budget'
        },
        envelope => ({
          envelope,
          response: {
            schemaVersion: 'ReplayBudgetProbeV1',
            payload: 'x'.repeat(MAX_RESPONSE_CACHE_BYTES)
          }
        }),
        replayBudgetFixture.runtimeOptions
      ),
      error => error && error.code === 'RESPONSE_CACHE_BUDGET_BLOCKED'
    )
    assert.strictEqual(
      fs.readFileSync(replayBoot.paths.envelope, 'utf8'),
      envelopeBefore
    )

    // Acceptance T03 / T06: a reused idempotency key with a different request
    // is rejected, while a dead stale lock is recoverable.
    const collisionKey = 'a'.repeat(64)
    const firstTransaction = transactEnvelope(
      replayBudgetFixture.activeRoot,
      replayBoot.bootstrap.turnBinding,
      {
        op: 'collision-probe',
        project: replayBudgetFixture.project,
        contextEpoch: 'ctx-replay-budget',
        value: 1
      },
      envelope => ({
        envelope,
        response: { schemaVersion: 'CollisionProbeV1', value: 1 }
      }),
      {
        ...replayBudgetFixture.runtimeOptions,
        idempotencyKey: collisionKey
      }
    )
    assert.strictEqual(firstTransaction.replayed, false)
    assert.throws(
      () => transactEnvelope(
        replayBudgetFixture.activeRoot,
        replayBoot.bootstrap.turnBinding,
        {
          op: 'collision-probe',
          project: replayBudgetFixture.project,
          contextEpoch: 'ctx-replay-budget',
          value: 2
        },
        () => {
          throw new Error('collision must not mutate')
        },
        {
          ...replayBudgetFixture.runtimeOptions,
          idempotencyKey: collisionKey
        }
      ),
      error => error && error.code === 'IDEMPOTENCY_COLLISION'
    )

    // Acceptance T05: the active-root mutation lock serializes different
    // turns/operations and fails without mutating when the owner is live.
    const rootMutationLock = path.join(
      routeRootForActiveRoot(replayBudgetFixture.activeRoot),
      'skill-route-mutation.lock'
    )
    const beforeRootLockProbe = fs.readFileSync(replayBoot.paths.envelope, 'utf8')
    fs.writeFileSync(rootMutationLock, `${JSON.stringify({
      schemaVersion: 'SkillRouteRootMutationLockV1',
      pid: process.pid,
      op: 'live-root-lock',
      key: 'live-root-lock',
      startedAt: new Date().toISOString()
    })}\n`, 'utf8')
    assert.throws(
      () => transactEnvelope(
        replayBudgetFixture.activeRoot,
        replayBoot.bootstrap.turnBinding,
        {
          op: 'root-lock-probe',
          project: replayBudgetFixture.project,
          contextEpoch: 'ctx-replay-budget'
        },
        () => {
          throw new Error('live root lock must prevent mutation')
        },
        {
          ...replayBudgetFixture.runtimeOptions,
          rootLockTimeoutMs: 20
        }
      ),
      error => error && error.code === 'ROOT_MUTATION_LOCK_TIMEOUT'
    )
    assert.strictEqual(
      fs.readFileSync(replayBoot.paths.envelope, 'utf8'),
      beforeRootLockProbe
    )
    fs.unlinkSync(rootMutationLock)

    fs.writeFileSync(replayBoot.paths.lock, `${JSON.stringify({
      schemaVersion: 'SkillRouteLockV1',
      pid: 2147483647,
      op: 'stale-probe',
      key: 'stale-probe',
      startedAt: '2000-01-01T00:00:00.000Z'
    })}\n`, 'utf8')
    const staleRecovered = transactEnvelope(
      replayBudgetFixture.activeRoot,
      replayBoot.bootstrap.turnBinding,
      {
        op: 'stale-lock-probe',
        project: replayBudgetFixture.project,
        contextEpoch: 'ctx-replay-budget'
      },
      envelope => ({
        envelope,
        response: { schemaVersion: 'StaleLockProbeV1', ok: true }
      }),
      {
        ...replayBudgetFixture.runtimeOptions,
        lockStaleMs: 1
      }
    )
    assert.strictEqual(staleRecovered.response.ok, true)
  } finally {
    replayBudgetFixture.cleanup()
  }

  const recoveryFixture = createSkillRouteFixture({ project: 'envelope-recovery' })
  try {
    const recoveryBoot = bootstrapSkillRoute({
      project: recoveryFixture.project,
      activeRoot: recoveryFixture.activeRoot,
      contextEpoch: 'ctx-envelope-recovery',
      prompt: 'Run envelope recovery probe',
      mode: 'unified',
      cwd: recoveryFixture.projectRoot
    }, recoveryFixture.runtimeOptions)
    const beforeRecovery = fs.readFileSync(recoveryBoot.paths.envelope, 'utf8')
    const interruptedBackup = `${recoveryBoot.paths.envelope}.replace.999999.1`
    fs.renameSync(recoveryBoot.paths.envelope, interruptedBackup)
    const recovered = loadEnvelope(
      recoveryFixture.activeRoot,
      recoveryBoot.bootstrap.turnBinding,
      recoveryFixture.runtimeOptions
    )
    assert.strictEqual(recovered.envelope.state.contextEpoch, 'ctx-envelope-recovery')
    assert.strictEqual(fs.readFileSync(recoveryBoot.paths.envelope, 'utf8'), beforeRecovery)
    assert.strictEqual(fs.existsSync(interruptedBackup), false)

    const stableEnvelope = fs.readFileSync(recoveryBoot.paths.envelope, 'utf8')
    const renameFaultFs = Object.create(fs)
    let renameFaultInjected = false
    renameFaultFs.renameSync = (source, target) => {
      if (!renameFaultInjected &&
          source === `${recoveryBoot.paths.envelope}.next.tmp` &&
          target === recoveryBoot.paths.envelope) {
        renameFaultInjected = true
        const error = new Error('injected envelope rename failure')
        error.code = 'EIO'
        throw error
      }
      return fs.renameSync(source, target)
    }
    assert.throws(
      () => atomicWriteJson(
        recoveryBoot.paths.envelope,
        {
          ...recovered.envelope,
          version: recovered.envelope.version + 1
        },
        renameFaultFs
      ),
      error => error && error.code === 'EIO'
    )
    assert.strictEqual(
      fs.readFileSync(recoveryBoot.paths.envelope, 'utf8'),
      stableEnvelope
    )
    assert.strictEqual(
      fs.readdirSync(path.dirname(recoveryBoot.paths.envelope)).some(name => name.endsWith('.tmp')),
      false,
      'failed SkillRoute writes must not retain writer temp files'
    )
    assert.strictEqual(
      fs.readdirSync(path.dirname(recoveryBoot.paths.envelope)).filter(name => name.startsWith('route-envelope.json.replace.')).length,
      0,
      'failed SkillRoute replacement must restore the prior envelope without backup growth'
    )

    const interruptedRequest = {
      op: 'after-commit-probe',
      project: recoveryFixture.project,
      contextEpoch: 'ctx-envelope-recovery'
    }
    assert.throws(
      () => transactEnvelope(
        recoveryFixture.activeRoot,
        recoveryBoot.bootstrap.turnBinding,
        interruptedRequest,
        envelope => ({
          envelope,
          response: {
            schemaVersion: 'AfterCommitProbeV1',
            ok: true
          }
        }),
        {
          ...recoveryFixture.runtimeOptions,
          afterCommit: () => {
            throw new Error('injected after-commit interruption')
          }
        }
      ),
      /injected after-commit interruption/
    )
    const replayAfterInterruption = transactEnvelope(
      recoveryFixture.activeRoot,
      recoveryBoot.bootstrap.turnBinding,
      interruptedRequest,
      () => {
        throw new Error('cached response must bypass mutation')
      },
      recoveryFixture.runtimeOptions
    )
    assert.strictEqual(replayAfterInterruption.replayed, true)
    assert.strictEqual(replayAfterInterruption.response.ok, true)
  } finally {
    recoveryFixture.cleanup()
  }

  const turnCapacityFixture = createSkillRouteFixture({ project: 'turn-capacity' })
  try {
    const turnsRoot = path.join(
      routeRootForActiveRoot(turnCapacityFixture.activeRoot),
      'turns'
    )
    for (let index = 0; index < MAX_TURNS; index += 1) {
      fs.mkdirSync(path.join(turnsRoot, `turn-capacity-${index}`), { recursive: true })
    }
    const recovered = bootstrapSkillRoute({
      project: turnCapacityFixture.project,
      activeRoot: turnCapacityFixture.activeRoot,
      contextEpoch: 'ctx-turn-capacity',
      hostSessionId: 'session-turn-capacity',
      prompt: 'Run turn capacity probe',
      mode: 'unified',
      cwd: turnCapacityFixture.projectRoot
    }, {
      ...turnCapacityFixture.runtimeOptions,
      now: '2026-07-31T12:00:00.000Z',
      emptyTurnGraceMs: 0
    })
    assert.strictEqual(recovered.retention.removedEmpty.length, MAX_TURNS)
    assert.strictEqual(recovered.envelope.state.hostSessionId, 'session-turn-capacity')
    assert.deepStrictEqual(recovered.retention.failures, [])
  } finally {
    turnCapacityFixture.cleanup()
  }

  const writerOrphanFixture = createSkillRouteFixture({ project: 'writer-orphan-capacity' })
  try {
    const turnsRoot = path.join(
      routeRootForActiveRoot(writerOrphanFixture.activeRoot),
      'turns'
    )
    const staleLockBinding = `turn-${'a'.repeat(40)}`
    const tempOnlyBinding = `turn-${'b'.repeat(40)}`
    const liveLockBinding = `turn-${'c'.repeat(40)}`
    const unknownBinding = `turn-${'d'.repeat(40)}`
    for (const binding of [staleLockBinding, tempOnlyBinding, liveLockBinding, unknownBinding]) {
      fs.mkdirSync(path.join(turnsRoot, binding), { recursive: true })
    }
    fs.writeFileSync(path.join(turnsRoot, staleLockBinding, 'route-envelope.lock'), `${JSON.stringify({
      schemaVersion: 'SkillRouteLockV1',
      pid: 2147483647,
      op: 'bootstrap',
      key: 'crashed-before-envelope',
      startedAt: new Date(0).toISOString()
    })}\n`)
    fs.writeFileSync(path.join(turnsRoot, tempOnlyBinding, 'route-envelope.json.next.tmp'), '{"partial":true}\n')
    fs.writeFileSync(path.join(turnsRoot, liveLockBinding, 'route-envelope.lock'), `${JSON.stringify({
      schemaVersion: 'SkillRouteLockV1',
      pid: process.pid,
      op: 'bootstrap',
      key: 'live-before-envelope',
      startedAt: new Date(0).toISOString()
    })}\n`)
    fs.writeFileSync(path.join(turnsRoot, unknownBinding, 'unknown-state.bin'), 'must remain fail-closed\n')
    const orphanRetention = collectExpiredTurns(writerOrphanFixture.activeRoot, {
      ...writerOrphanFixture.runtimeOptions,
      now: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      emptyTurnGraceMs: 0,
      lockStaleMs: 0,
      gcTurnLockTimeoutMs: 10
    })
    assert(orphanRetention.removedOrphans.includes(staleLockBinding))
    assert(orphanRetention.removedOrphans.includes(tempOnlyBinding))
    assert(orphanRetention.skippedLocked.includes(liveLockBinding))
    assert(orphanRetention.failures.some(item =>
      item.turnBinding === unknownBinding && item.errorCode === 'GC_TURN_ENVELOPE_MISSING'
    ))
    assert.strictEqual(fs.existsSync(path.join(turnsRoot, staleLockBinding)), false)
    assert.strictEqual(fs.existsSync(path.join(turnsRoot, tempOnlyBinding)), false)
    assert.strictEqual(fs.existsSync(path.join(turnsRoot, liveLockBinding)), true)
    assert.strictEqual(fs.existsSync(path.join(turnsRoot, unknownBinding)), true)
  } finally {
    writerOrphanFixture.cleanup()
  }

  const rawTurnCapacityFixture = createSkillRouteFixture({ project: 'raw-turn-capacity' })
  try {
    const turnsRoot = path.join(
      routeRootForActiveRoot(rawTurnCapacityFixture.activeRoot),
      'turns'
    )
    for (let index = 0; index < MAX_RAW_TURN_DIRECTORIES; index += 1) {
      fs.mkdirSync(path.join(turnsRoot, `raw-empty-${index}`), { recursive: true })
    }
    assert.throws(
      () => bootstrapSkillRoute({
        project: rawTurnCapacityFixture.project,
        activeRoot: rawTurnCapacityFixture.activeRoot,
        contextEpoch: 'ctx-raw-turn-capacity',
        hostSessionId: 'session-raw-turn-capacity',
        prompt: 'Run raw turn capacity probe',
        mode: 'unified',
        cwd: rawTurnCapacityFixture.projectRoot
      }, {
        ...rawTurnCapacityFixture.runtimeOptions,
        now: new Date(Date.now() + 1000).toISOString(),
        emptyTurnGraceMs: 60 * 60 * 1000
      }),
      error => error && error.code === 'RUNTIME_STATE_CAPACITY_BLOCKED' &&
        error.capacity?.rawDirectoryCount === MAX_RAW_TURN_DIRECTORIES &&
        error.capacity?.projectedRawDirectoryCount === MAX_RAW_TURN_DIRECTORIES + 1
    )
  } finally {
    rawTurnCapacityFixture.cleanup()
  }

  const quarantineCapacityFixture = createSkillRouteFixture({ project: 'quarantine-capacity' })
  try {
    const quarantineRoot = path.join(
      routeRootForActiveRoot(quarantineCapacityFixture.activeRoot),
      'quarantine'
    )
    for (let index = 0; index < MAX_QUARANTINE_DIRECTORIES; index += 1) {
      const quarantinedTurn = path.join(quarantineRoot, `live-quarantine-${index}`)
      fs.mkdirSync(quarantinedTurn, { recursive: true })
      fs.writeFileSync(path.join(quarantinedTurn, 'route-envelope.lock'), `${JSON.stringify({
        schemaVersion: 'SkillRouteLockV1',
        pid: process.pid,
        op: 'gc',
        key: `live-quarantine-${index}`,
        startedAt: new Date().toISOString()
      })}\n`)
    }
    assert.throws(
      () => bootstrapSkillRoute({
        project: quarantineCapacityFixture.project,
        activeRoot: quarantineCapacityFixture.activeRoot,
        contextEpoch: 'ctx-quarantine-capacity',
        hostSessionId: 'session-quarantine-capacity',
        prompt: 'Run quarantine capacity probe',
        mode: 'unified',
        cwd: quarantineCapacityFixture.projectRoot
      }, quarantineCapacityFixture.runtimeOptions),
      error => error && error.code === 'RUNTIME_STATE_CAPACITY_BLOCKED' &&
        error.capacity?.quarantineDirectoryCount === MAX_QUARANTINE_DIRECTORIES
    )
  } finally {
    quarantineCapacityFixture.cleanup()
  }

  const terminalPressureFixture = createSkillRouteFixture({ project: 'terminal-pressure' })
  try {
    const turns = []
    for (let index = 0; index < MAX_TURNS; index += 1) {
      turns.push(writeCapacityTurn(terminalPressureFixture, index, {
        planStatus: 'complete',
        requiredStageIds: ['entry'],
        updatedAt: new Date(Date.parse('2026-07-31T08:00:00.000Z') + index * 1000).toISOString()
      }))
    }
    const protectedTurn = turns.at(-1).turnBinding
    const pressure = collectExpiredTurns(terminalPressureFixture.activeRoot, {
      ...terminalPressureFixture.runtimeOptions,
      now: '2026-07-31T12:00:00.000Z',
      pressureReclaim: true,
      pressureReclaimGraceMs: 0,
      protectedTurnBindings: [protectedTurn]
    })
    assert(pressure.removedPressure.length >= MAX_TURNS - TURN_PRESSURE_LOW_WATER)
    assert(pressure.removedPressure.every(item => item.reason === 'terminal-process-complete'))
    assert(pressure.capacityAfterPressure.occupiedTurnCount <= TURN_PRESSURE_LOW_WATER)
    assert.strictEqual(fs.existsSync(turns.at(-1).paths.envelope), true)
    assert.deepStrictEqual(pressure.failures, [])
  } finally {
    terminalPressureFixture.cleanup()
  }

  const supersededPressureFixture = createSkillRouteFixture({ project: 'superseded-pressure' })
  try {
    for (let index = 0; index < MAX_TURNS; index += 1) {
      writeCapacityTurn(supersededPressureFixture, index, {
        hostSessionId: 'session-superseded-pressure',
        contextEpoch: `ctx-superseded-${index}`,
        updatedAt: new Date(Date.parse('2026-07-31T08:00:00.000Z') + index * 1000).toISOString()
      })
    }
    const supersededBoot = bootstrapSkillRoute({
      project: supersededPressureFixture.project,
      activeRoot: supersededPressureFixture.activeRoot,
      contextEpoch: 'ctx-superseded-current',
      hostSessionId: 'session-superseded-pressure',
      prompt: 'Run same-session supersession probe',
      mode: 'unified',
      cwd: supersededPressureFixture.projectRoot
    }, {
      ...supersededPressureFixture.runtimeOptions,
      now: '2026-07-31T12:00:00.000Z',
      pressureReclaimGraceMs: 0
    })
    assert(supersededBoot.retention.removedPressure.some(item =>
      item.reason === 'same-session-uncommitted-superseded'
    ))
    assert.strictEqual(
      supersededBoot.retention.capacityAfterPressure.occupiedTurnCount <= TURN_PRESSURE_LOW_WATER,
      true
    )
  } finally {
    supersededPressureFixture.cleanup()
  }

  const activePressureFixture = createSkillRouteFixture({ project: 'active-pressure' })
  try {
    for (let index = 0; index < MAX_TURNS; index += 1) {
      writeCapacityTurn(activePressureFixture, index, {
        hostSessionId: `foreign-session-${index}`,
        contextEpoch: `ctx-active-${index}`
      })
    }
    assert.throws(
      () => bootstrapSkillRoute({
        project: activePressureFixture.project,
        activeRoot: activePressureFixture.activeRoot,
        contextEpoch: 'ctx-active-current',
        hostSessionId: 'session-active-current',
        prompt: 'Run active capacity fail-closed probe',
        mode: 'unified',
        cwd: activePressureFixture.projectRoot
      }, {
        ...activePressureFixture.runtimeOptions,
        now: '2026-07-31T12:00:00.000Z',
        pressureReclaimGraceMs: 0
      }),
      error => error && error.code === 'RUNTIME_STATE_CAPACITY_BLOCKED' &&
        error.capacity?.turnCount === MAX_TURNS &&
        error.capacity?.projectedTurnCount === MAX_TURNS + 1
    )
  } finally {
    activePressureFixture.cleanup()
  }

  const guardedPressureFixture = createSkillRouteFixture({ project: 'guarded-pressure' })
  try {
    for (let index = 0; index < MAX_TURNS - 2; index += 1) {
      writeCapacityTurn(guardedPressureFixture, index, {
        hostSessionId: `guarded-foreign-session-${index}`
      })
    }
    const lockedTerminal = writeCapacityTurn(guardedPressureFixture, MAX_TURNS - 2, {
      planStatus: 'complete',
      requiredStageIds: ['entry'],
      salt: 'locked'
    })
    fs.writeFileSync(lockedTerminal.paths.lock, `${JSON.stringify({
      schemaVersion: 'SkillRouteLockV1',
      pid: process.pid,
      op: 'test',
      key: 'live-pressure-lock',
      startedAt: new Date().toISOString()
    })}\n`)
    const mismatched = writeCapacityTurn(guardedPressureFixture, MAX_TURNS - 1, {
      planStatus: 'complete',
      requiredStageIds: ['entry'],
      salt: 'identity-mismatch'
    })
    const mismatchedEnvelope = JSON.parse(fs.readFileSync(mismatched.paths.envelope, 'utf8'))
    mismatchedEnvelope.state.turnBinding = `turn-${'f'.repeat(40)}`
    atomicWriteJson(mismatched.paths.envelope, mismatchedEnvelope)

    const guarded = collectExpiredTurns(guardedPressureFixture.activeRoot, {
      ...guardedPressureFixture.runtimeOptions,
      now: '2026-07-31T12:00:00.000Z',
      pressureReclaim: true,
      pressureReclaimGraceMs: 0,
      gcTurnLockTimeoutMs: 10
    })
    assert.deepStrictEqual(guarded.removedPressure, [])
    assert(guarded.skippedLocked.includes(lockedTerminal.turnBinding))
    assert(guarded.failures.some(item =>
      item.turnBinding === mismatched.turnBinding &&
      item.errorCode === 'GC_TURN_IDENTITY_MISMATCH'
    ))
    assert.strictEqual(fs.existsSync(lockedTerminal.paths.envelope), true)
    assert.strictEqual(fs.existsSync(mismatched.paths.envelope), true)
    fs.unlinkSync(lockedTerminal.paths.lock)
  } finally {
    guardedPressureFixture.cleanup()
  }

  const byteCapacityFixture = createSkillRouteFixture({ project: 'byte-capacity' })
  try {
    const routeRoot = routeRootForActiveRoot(byteCapacityFixture.activeRoot)
    fs.mkdirSync(routeRoot, { recursive: true })
    const capacityFile = path.join(routeRoot, 'capacity-probe.bin')
    fs.closeSync(fs.openSync(capacityFile, 'w'))
    fs.truncateSync(capacityFile, MAX_ROUTE_ROOT_BYTES)
    assert.throws(
      () => bootstrapSkillRoute({
        project: byteCapacityFixture.project,
        activeRoot: byteCapacityFixture.activeRoot,
        contextEpoch: 'ctx-byte-capacity',
        prompt: 'Run byte capacity probe',
        mode: 'unified',
        cwd: byteCapacityFixture.projectRoot
      }, byteCapacityFixture.runtimeOptions),
      error => error && error.code === 'RUNTIME_STATE_CAPACITY_BLOCKED' &&
        error.capacity?.bytes >= MAX_ROUTE_ROOT_BYTES
    )
  } finally {
    byteCapacityFixture.cleanup()
  }

  const bootstrapProjectedFixture = createSkillRouteFixture({
    project: 'bootstrap-projected-capacity'
  })
  try {
    const routeRoot = routeRootForActiveRoot(bootstrapProjectedFixture.activeRoot)
    fs.mkdirSync(routeRoot, { recursive: true })
    const filler = path.join(routeRoot, 'bootstrap-projected-capacity-probe.bin')
    fs.closeSync(fs.openSync(filler, 'w'))
    fs.truncateSync(filler, MAX_ROUTE_ROOT_BYTES - 8 * 1024)
    assert.throws(
      () => bootstrapSkillRoute({
        project: bootstrapProjectedFixture.project,
        activeRoot: bootstrapProjectedFixture.activeRoot,
        contextEpoch: 'ctx-bootstrap-projected-capacity',
        prompt: 'Run bootstrap projected capacity probe',
        mode: 'unified',
        cwd: bootstrapProjectedFixture.projectRoot
      }, bootstrapProjectedFixture.runtimeOptions),
      error => error && error.code === 'RUNTIME_STATE_CAPACITY_BLOCKED' &&
        error.capacity?.projectedBytes >= MAX_ROUTE_ROOT_BYTES
    )
    const turnsRoot = path.join(routeRoot, 'turns')
    assert.deepStrictEqual(
      fs.readdirSync(turnsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name),
      []
    )
  } finally {
    bootstrapProjectedFixture.cleanup()
  }

  const projectedCapacityFixture = createSkillRouteFixture({
    project: 'projected-capacity'
  })
  try {
    const projectedBoot = bootstrapSkillRoute({
      project: projectedCapacityFixture.project,
      activeRoot: projectedCapacityFixture.activeRoot,
      contextEpoch: 'ctx-projected-capacity',
      prompt: 'Run projected capacity probe',
      mode: 'unified',
      cwd: projectedCapacityFixture.projectRoot
    }, projectedCapacityFixture.runtimeOptions)
    const stableEnvelope = fs.readFileSync(projectedBoot.paths.envelope, 'utf8')
    const routeRoot = routeRootForActiveRoot(projectedCapacityFixture.activeRoot)
    const currentBytes = fs.statSync(projectedBoot.paths.envelope).size
    const filler = path.join(routeRoot, 'projected-capacity-probe.bin')
    fs.closeSync(fs.openSync(filler, 'w'))
    fs.truncateSync(filler, MAX_ROUTE_ROOT_BYTES - currentBytes - 32 * 1024)
    assert.throws(
      () => transactEnvelope(
        projectedCapacityFixture.activeRoot,
        projectedBoot.bootstrap.turnBinding,
        {
          op: 'projected-capacity-probe',
          project: projectedCapacityFixture.project,
          contextEpoch: 'ctx-projected-capacity'
        },
        envelope => ({
          envelope,
          response: {
            schemaVersion: 'ProjectedCapacityProbeV1',
            payload: 'x'.repeat(48 * 1024)
          }
        }),
        projectedCapacityFixture.runtimeOptions
      ),
      error => error && error.code === 'RUNTIME_STATE_CAPACITY_BLOCKED' &&
        error.capacity?.projectedBytes >= MAX_ROUTE_ROOT_BYTES &&
        error.capacity?.atomicPeakBytes >= error.capacity?.projectedBytes
    )
    assert.strictEqual(
      fs.readFileSync(projectedBoot.paths.envelope, 'utf8'),
      stableEnvelope
    )
    assert.throws(
      () => assertProjectedCapacity(
        projectedBoot.paths,
        JSON.parse(stableEnvelope)
      ),
      error => error && error.code === 'RUNTIME_STATE_CAPACITY_BLOCKED'
    )
  } finally {
    projectedCapacityFixture.cleanup()
  }

  const nonExplicitFixture = createSkillRouteFixture({ project: 'non-explicit-obligation' })
  try {
    const nonExplicitEpoch = 'ctx-non-explicit-obligation'
    const nonExplicitBinding = writeContextBindingState(
      nonExplicitFixture,
      nonExplicitEpoch,
      'fix',
      'session-non-explicit-obligation'
    )
    const nonExplicitBoot = bootstrapSkillRoute({
      project: nonExplicitFixture.project,
      activeRoot: nonExplicitFixture.activeRoot,
      contextEpoch: nonExplicitEpoch,
      prompt: 'Inspect the implementation state',
      mode: 'unified',
      cwd: nonExplicitFixture.projectRoot
    }, nonExplicitFixture.runtimeOptions)
    requestCatalogAll(nonExplicitFixture, nonExplicitBoot.bootstrap)
    const nonExplicitCommit = handleSkillRoute({
      op: 'commit',
      project: nonExplicitFixture.project,
      turnBinding: nonExplicitBoot.bootstrap.turnBinding,
      contextEpoch: nonExplicitEpoch,
      catalogDigest: nonExplicitBoot.bootstrap.catalogDigest,
      skillId: null,
      contextBinding: nonExplicitBinding
    }, nonExplicitFixture.runtimeOptions)
    assert.strictEqual(nonExplicitCommit.ok, true, JSON.stringify(nonExplicitCommit))
    const alternateCapabilityPath = path.join(nonExplicitFixture.root, 'capabilities-stale.json')
    fs.writeFileSync(alternateCapabilityPath, '{"schemaVersion":"HostSkillRouteCapabilityV1","capabilities":[]}\n')
    const nonExplicitStaleStop = evaluateProgressiveSkillRouteStop({
      project: nonExplicitFixture.project,
      contextEpoch: nonExplicitEpoch,
      hostSessionId: 'session-non-explicit-obligation',
      assistantText: 'Finished.'
    }, {
      ...nonExplicitFixture.runtimeOptions,
      capabilityPath: alternateCapabilityPath
    })
    assert.strictEqual(nonExplicitStaleStop.errorCode, 'MODE_CAPABILITY_STALE')
    assert.strictEqual(nonExplicitStaleStop.planDigest, nonExplicitCommit.receipt.plan.planDigest)
    assert(nonExplicitStaleStop.pendingStageIds.length > 0)
    assert.strictEqual(nonExplicitStaleStop.retired, true)
    assert.strictEqual(nonExplicitStaleStop.processComplete, false)
    assert.strictEqual(nonExplicitStaleStop.complete, true)
    assert.strictEqual(
      shouldEnforceProgressiveSkillRouteStop(nonExplicitStaleStop, false),
      false,
      'retired model-free obligations remain auditable without replaying impossible work'
    )
  } finally {
    nonExplicitFixture.cleanup()
  }

  const legacyProgressFixture = createSkillRouteFixture({ project: 'catalog-progress-legacy-migration' })
  try {
    const legacyProgressBoot = bootstrapSkillRoute({
      project: legacyProgressFixture.project,
      activeRoot: legacyProgressFixture.activeRoot,
      contextEpoch: 'ctx-catalog-progress-legacy-migration',
      prompt: 'Exercise legacy catalog progress migration',
      mode: 'unified',
      cwd: legacyProgressFixture.projectRoot
    }, legacyProgressFixture.runtimeOptions)
    const legacyPages = requestCatalogAll(legacyProgressFixture, legacyProgressBoot.bootstrap)
    const hydrated = loadEnvelope(
      legacyProgressFixture.activeRoot,
      legacyProgressBoot.bootstrap.turnBinding,
      legacyProgressFixture.runtimeOptions
    ).envelope
    fs.writeFileSync(
      legacyProgressBoot.paths.envelope,
      `${JSON.stringify(hydrated, null, 2)}\n`,
      'utf8'
    )
    fs.rmSync(legacyProgressBoot.paths.catalogProgress, { force: true })
    const migrated = loadEnvelope(
      legacyProgressFixture.activeRoot,
      legacyProgressBoot.bootstrap.turnBinding,
      legacyProgressFixture.runtimeOptions
    ).envelope
    assert.strictEqual(
      migrated.state.contributionLedger.items.filter(item => item.op === 'catalog').length,
      legacyPages.length,
      'rolling-upgrade hydration must not duplicate legacy catalog contributions'
    )
  } finally {
    legacyProgressFixture.cleanup()
  }

  const invalidProgressFixture = createSkillRouteFixture({ project: 'catalog-progress-invalid' })
  try {
    const invalidProgressBoot = bootstrapSkillRoute({
      project: invalidProgressFixture.project,
      activeRoot: invalidProgressFixture.activeRoot,
      contextEpoch: 'ctx-catalog-progress-invalid',
      prompt: 'Exercise catalog progress validation',
      mode: 'unified',
      cwd: invalidProgressFixture.projectRoot
    }, invalidProgressFixture.runtimeOptions)
    requestCatalogAll(invalidProgressFixture, invalidProgressBoot.bootstrap)
    const invalidProgress = JSON.parse(
      fs.readFileSync(invalidProgressBoot.paths.catalogProgress, 'utf8')
    )
    invalidProgress.catalogDigest = '0'.repeat(64)
    fs.writeFileSync(
      invalidProgressBoot.paths.catalogProgress,
      `${JSON.stringify(invalidProgress, null, 2)}\n`,
      'utf8'
    )
    assert.throws(
      () => loadEnvelope(
        invalidProgressFixture.activeRoot,
        invalidProgressBoot.bootstrap.turnBinding,
        invalidProgressFixture.runtimeOptions
      ),
      error => error && error.code === 'CATALOG_PROGRESS_INVALID'
    )
    fs.writeFileSync(invalidProgressBoot.paths.catalogProgress, '{malformed-json', 'utf8')
    assert.throws(
      () => loadEnvelope(
        invalidProgressFixture.activeRoot,
        invalidProgressBoot.bootstrap.turnBinding,
        invalidProgressFixture.runtimeOptions
      ),
      error => error && error.code === 'CATALOG_PROGRESS_INVALID',
      'an existing malformed catalog sidecar must fail closed instead of replaying legacy envelope state'
    )
  } finally {
    invalidProgressFixture.cleanup()
  }

  const incompleteLedgerFixture = createSkillRouteFixture({ project: 'catalog-progress-ledger-incomplete' })
  try {
    const incompleteLedgerBoot = bootstrapSkillRoute({
      project: incompleteLedgerFixture.project,
      activeRoot: incompleteLedgerFixture.activeRoot,
      contextEpoch: 'ctx-catalog-progress-ledger-incomplete',
      prompt: 'Exercise catalog ledger completeness validation',
      mode: 'unified',
      cwd: incompleteLedgerFixture.projectRoot
    }, incompleteLedgerFixture.runtimeOptions)
    requestCatalogAll(incompleteLedgerFixture, incompleteLedgerBoot.bootstrap)
    const incompleteProgress = JSON.parse(
      fs.readFileSync(incompleteLedgerBoot.paths.catalogProgress, 'utf8')
    )
    assert(incompleteProgress.servedCatalogPages.length > 0)
    incompleteProgress.catalogLedger = []
    fs.writeFileSync(
      incompleteLedgerBoot.paths.catalogProgress,
      `${JSON.stringify(incompleteProgress, null, 2)}\n`,
      'utf8'
    )
    assert.throws(
      () => loadEnvelope(
        incompleteLedgerFixture.activeRoot,
        incompleteLedgerBoot.bootstrap.turnBinding,
        incompleteLedgerFixture.runtimeOptions
      ),
      error => error && error.code === 'CATALOG_PROGRESS_INVALID'
    )
  } finally {
    incompleteLedgerFixture.cleanup()
  }

  const progressRecoveryFixture = createSkillRouteFixture({ project: 'catalog-progress-backup-recovery' })
  try {
    const progressRecoveryBoot = bootstrapSkillRoute({
      project: progressRecoveryFixture.project,
      activeRoot: progressRecoveryFixture.activeRoot,
      contextEpoch: 'ctx-catalog-progress-backup-recovery',
      prompt: 'Exercise catalog progress crash recovery',
      mode: 'unified',
      cwd: progressRecoveryFixture.projectRoot
    }, progressRecoveryFixture.runtimeOptions)
    const recoveryPages = requestCatalogAll(progressRecoveryFixture, progressRecoveryBoot.bootstrap)
    const replacementBackup = `${progressRecoveryBoot.paths.catalogProgress}.replace.fixture`
    fs.renameSync(progressRecoveryBoot.paths.catalogProgress, replacementBackup)
    const { envelope: recoveredEnvelope } = loadEnvelope(
      progressRecoveryFixture.activeRoot,
      progressRecoveryBoot.bootstrap.turnBinding,
      progressRecoveryFixture.runtimeOptions
    )
    assert.deepStrictEqual(
      recoveredEnvelope.state.servedCatalogPages,
      recoveryPages.map((_, index) => index)
    )
    assert.strictEqual(fs.existsSync(progressRecoveryBoot.paths.catalogProgress), true)
    assert.strictEqual(fs.existsSync(replacementBackup), false)
  } finally {
    progressRecoveryFixture.cleanup()
  }

  const gcFixture = createSkillRouteFixture({ project: 'gc' })
  try {
    const gcBoot = bootstrapSkillRoute({
      project: gcFixture.project,
      activeRoot: gcFixture.activeRoot,
      contextEpoch: 'ctx-gc-expired',
      prompt: 'Run gc probe',
      mode: 'unified',
      cwd: gcFixture.projectRoot
    }, {
      ...gcFixture.runtimeOptions,
      now: '2026-07-28T00:00:00.000Z',
      turnTtlMs: 1000
    })
    const gc = collectExpiredTurns(gcFixture.activeRoot, {
      ...gcFixture.runtimeOptions,
      now: '2026-07-28T00:00:02.000Z'
    })
    assert(gc.removed.includes(gcBoot.bootstrap.turnBinding))
    assert(gc.quarantined.includes(gcBoot.bootstrap.turnBinding))
    assert.deepStrictEqual(gc.failures, [])
    assert.strictEqual(
      fs.existsSync(path.dirname(gcBoot.paths.envelope)),
      false
    )

    const protectedBoot = bootstrapSkillRoute({
      project: gcFixture.project,
      activeRoot: gcFixture.activeRoot,
      contextEpoch: 'ctx-gc-protected',
      prompt: 'Run protected gc probe',
      mode: 'unified',
      cwd: gcFixture.projectRoot
    }, {
      ...gcFixture.runtimeOptions,
      now: '2026-07-28T00:00:00.000Z',
      turnTtlMs: 1000
    })
    const protectedGc = collectExpiredTurns(gcFixture.activeRoot, {
      ...gcFixture.runtimeOptions,
      now: '2026-07-28T00:00:02.000Z',
      protectedTurnBindings: [protectedBoot.bootstrap.turnBinding]
    })
    assert(protectedGc.skippedReferenced.includes(protectedBoot.bootstrap.turnBinding))
    assert.strictEqual(fs.existsSync(path.dirname(protectedBoot.paths.envelope)), true)
    assert.throws(
      () => bootstrapSkillRoute({
        project: gcFixture.project,
        activeRoot: gcFixture.activeRoot,
        contextEpoch: 'ctx-gc-protected',
        prompt: 'Run protected gc probe',
        mode: 'unified',
        cwd: gcFixture.projectRoot
      }, {
        ...gcFixture.runtimeOptions,
        now: '2026-07-28T00:00:02.000Z',
        turnTtlMs: 1000
      }),
      error => error && error.code === 'TURN_EXPIRED'
    )

    const liveLockFile = protectedBoot.paths.lock
    fs.writeFileSync(liveLockFile, `${JSON.stringify({
      schemaVersion: 'SkillRouteLockV1',
      pid: process.pid,
      op: 'test',
      key: 'live-lock',
      startedAt: new Date().toISOString()
    })}\n`)
    const lockedGc = collectExpiredTurns(gcFixture.activeRoot, {
      ...gcFixture.runtimeOptions,
      now: '2026-07-28T00:00:02.000Z',
      gcTurnLockTimeoutMs: 10
    })
    assert(lockedGc.skippedLocked.includes(protectedBoot.bootstrap.turnBinding))
    assert.strictEqual(fs.existsSync(path.dirname(protectedBoot.paths.envelope)), true)
    fs.unlinkSync(liveLockFile)
  } finally {
    gcFixture.cleanup()
  }
} finally {
  fixture.cleanup()
}

console.log('test-skill-route-state: ok')
