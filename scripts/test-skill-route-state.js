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
  handleSkillRoute
} = require('../hooks/_runtime/skill-route-tool.cjs')
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
  const commit = handleSkillRoute(commitRequest, fixture.runtimeOptions)
  assert.strictEqual(commit.ok, true, JSON.stringify(commit))
  assert.strictEqual(commit.bodyChunks.length, 0)
  assert.strictEqual(commit.receipt.decision.skillId, 'workspace-probe')
  assert.strictEqual(commit.receipt.plan.status, 'complete')
  assert.strictEqual(
    commit.receipt.obligations.selectedBusinessSkillId,
    'workspace-probe'
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

  const lifecyclePath = path.join(
    fixture.activeRoot,
    '.memory',
    'hooks',
    fixture.project,
    'lifecycle-state.json'
  )
  const lifecycle = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'))
  lifecycle.contextAcquisition.receipt.status = 'planned'
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(lifecycle, null, 2)}\n`, 'utf8')
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
  lifecycle.contextAcquisition.receipt.status = 'relevant-complete'
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(lifecycle, null, 2)}\n`, 'utf8')

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
