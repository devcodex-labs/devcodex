'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  MAX_RESPONSE_CACHE_BYTES,
  MAX_ROUTE_ROOT_BYTES,
  MAX_TURNS,
  atomicWriteJson,
  assertProjectedCapacity,
  bootstrapSkillRoute,
  collectExpiredTurns,
  parseExplicitSkillId,
  loadEnvelope,
  routeRootForActiveRoot,
  transactEnvelope
} = require('../hooks/_runtime/skill-route-state.cjs')
const {
  evaluateProgressiveSkillRouteStop,
  handleSkillRoute,
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

  const pages = requestCatalogAll(fixture, boot.bootstrap)
  const firstReplay = handleSkillRoute({
    op: 'catalog',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.deepStrictEqual(firstReplay, pages[0])

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
  assert.strictEqual(recordMcpContextSourceObservations({
    activeRoot: fixture.activeRoot,
    project: fixture.project,
    contextBinding: mcpObservedPlan.contextBinding,
    hostSessionId: 'session-mcp-source-observation',
    sourceResults: emptyCarrierResults
  }, { nowMs: BASE_MS + 20 }).ledgerStatus, 'persisted')
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
  // loading must recover from the independent durable source ledger.
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
  assert.strictEqual(recoveredStatusAfterOverwrite.receipt.nextAction.nextOp, 'rebind')
  assert.strictEqual(recoveredStatusAfterOverwrite.receipt.nextAction.errorCode, 'CONTEXT_BINDING_STALE')
  const recoveredRebind = handleSkillRoute({
    ...recoveredStatusAfterOverwrite.receipt.nextAction.nextCall,
    contextBinding: mcpObservedPlan.contextBinding
  }, fixture.runtimeOptions)
  assert.strictEqual(recoveredRebind.ok, true, JSON.stringify(recoveredRebind))
  const recoveredStatusAfterRebind = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: mcpBoot.bootstrap.turnBinding,
    contextEpoch: mcpObservationEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(recoveredStatusAfterRebind.receipt.nextAction.nextOp, 'load_stage')
  assert.strictEqual(recoveredStatusAfterRebind.receipt.nextAction.nextCall.stageId, 'closeout')

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
  const digestDriftLifecycle = JSON.parse(JSON.stringify(lifecycle))
  digestDriftLifecycle.contextAcquisition.receipt.receiptId = 'receipt-live-digest-drift'
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(digestDriftLifecycle, null, 2)}\n`, 'utf8')
  const digestDriftStatus = handleSkillRoute({
    op: 'status',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch
  }, fixture.runtimeOptions)
  assert.strictEqual(digestDriftStatus.ok, true, JSON.stringify(digestDriftStatus))
  assert.strictEqual(digestDriftStatus.receipt.nextAction.nextOp, 'rebind')
  assert.strictEqual(digestDriftStatus.receipt.nextAction.errorCode, 'CONTEXT_BINDING_STALE')
  const digestDriftLoad = handleSkillRoute({
    op: 'load_stage',
    project: fixture.project,
    turnBinding: boot.bootstrap.turnBinding,
    contextEpoch,
    generation: commit.receipt.plan.generation,
    planDigest: commit.receipt.plan.planDigest,
    stageId: 'entry'
  }, fixture.runtimeOptions)
  assert.strictEqual(digestDriftLoad.ok, false)
  assert.strictEqual(digestDriftLoad.errorCode, 'CONTEXT_BINDING_STALE', 'status and execution must share the live binding digest precondition')
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

  loadStageAll(fixture, planBinding, 'closeout')
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
  loadStageAll(fixture, replannedBinding, 'closeout')

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
      generation: firstCommit.receipt.plan.generation,
      planDigest: firstCommit.receipt.plan.planDigest,
      contextBinding: driftBinding
    }, rebindFixture.runtimeOptions)
    assert.strictEqual(semanticDrift.ok, false)
    assert.strictEqual(semanticDrift.errorCode, 'REBIND_SEMANTIC_DRIFT')

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
    loadStageAll(
      rebindFixture,
      {
        turnBinding: rebindBoot.bootstrap.turnBinding,
        contextEpoch: rebindEpoch,
        generation: rebound.receipt.plan.generation,
        planDigest: rebound.receipt.plan.planDigest
      },
      'closeout'
    )
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
          source.startsWith(`${recoveryBoot.paths.envelope}.tmp.`) &&
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
    assert.throws(
      () => bootstrapSkillRoute({
        project: turnCapacityFixture.project,
        activeRoot: turnCapacityFixture.activeRoot,
        contextEpoch: 'ctx-turn-capacity',
        prompt: 'Run turn capacity probe',
        mode: 'unified',
        cwd: turnCapacityFixture.projectRoot
      }, turnCapacityFixture.runtimeOptions),
      error => error && error.code === 'RUNTIME_STATE_CAPACITY_BLOCKED' &&
        error.capacity?.turnCount === MAX_TURNS
    )
  } finally {
    turnCapacityFixture.cleanup()
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
