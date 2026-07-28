'use strict'

const assert = require('assert')
const contract = require('../hooks/_runtime/context-read-contract.cjs')

const {
  CONTEXT_READ_CONTRACT,
  buildContextReadPlan,
  createContextReadReceipt,
  evaluateContextReuse,
  recordContextReadOutcome,
  stableDigest,
  validateContextReadPlan
} = contract

const BASE_MS = Date.parse('2026-07-19T02:00:00.000Z')
const STANDARD_FILES = [
  '01-项目信息.md',
  '02-架构约束.md',
  '03-代码风格.md',
  '04-测试规范.md',
  '05-部署规范.md',
  '06-功能现状.md',
  '07-文档规范.md',
  '08-服务约束.md',
  '09-扩展约束.md'
]

function sourceRef(profileRoot, file, layer = 'project') {
  return {
    path: `${profileRoot}/${file}`,
    layer,
    exists: true,
    size: 100 + file.length,
    mtimeMs: BASE_MS - file.length
  }
}

function makeInput(project, activeRoot) {
  const profileRoot = `E:/Worker/.devcodex/${project}/profile`
  const inventoryFiles = ['README.md', 'config.json', ...STANDARD_FILES, 'config.local.json']
  return {
    intentSeed: {
      schemaVersion: 'IntentSeedV1',
      contextEpoch: `epoch-${project}`,
      semantic: 'dev',
      targetHint: project,
      continuationHint: false,
      riskHint: 'normal',
      confidence: 0.98,
      createdAt: '2026-07-19T02:00:00.000Z'
    },
    identity: { activeRoot, project, host: 'fixture', finalIntent: 'dev' },
    changeTypes: ['source-code'],
    baselineContext: {
      layout: 'workspace-namespace',
      project,
      mode: 'dev',
      agent: 'rocky',
      profileTier: 'full',
      effectiveConfig: { mode: 'dev', agent: 'rocky' },
      readme: {
        content: '# Profile index\n',
        sourceRefs: [sourceRef(profileRoot, 'README.md')]
      },
      configSourceRefs: [sourceRef(profileRoot, 'config.json')],
      catalog: STANDARD_FILES.map((file, index) => ({
        file,
        requiredToExist: index < 7,
        authority: 'README-file-index'
      })),
      inventory: inventoryFiles.map(file => ({
        file,
        sourceRefs: [sourceRef(profileRoot, file)],
        authority: 'bounded-top-level-inventory'
      }))
    }
  }
}

function assertPlan(plan) {
  assert.strictEqual(plan.schemaVersion, CONTEXT_READ_CONTRACT.schemas.plan)
  const validation = validateContextReadPlan(plan)
  assert.strictEqual(validation.valid, true, validation.errors.join(' | '))
  assert.deepStrictEqual(validation.errors, [])
  return plan
}

function evidence(plan, source, overrides = {}) {
  return {
    sourceId: source.sourceId,
    contextEpoch: plan.identity.contextEpoch,
    planId: plan.planId,
    activeRoot: plan.identity.activeRoot,
    sourceLayer: source.sourceLayer,
    outcome: 'observed-success',
    successful: true,
    observable: true,
    transportSuccess: true,
    sourceRefsMatch: true,
    schemaMatch: true,
    targetMatch: true,
    resultDigest: stableDigest({ sourceId: source.sourceId }),
    bodyObserved: true,
    hostSessionId: 'binding-test-session',
    ...overrides
  }
}

const plan = assertPlan(buildContextReadPlan(
  makeInput('devcodex', 'E:/Worker/devcodex'),
  { nowMs: BASE_MS }
))
const otherPlan = assertPlan(buildContextReadPlan(
  makeInput('other-project', 'E:/Worker/other-project'),
  { nowMs: BASE_MS + 1 }
))
assert.strictEqual(evaluateContextReuse({ plan, priorPlan: otherPlan }).computation.reasonCode, 'target-mismatch')

const profileSource = plan.selectedSources.find(source => source.kind !== 'memory')
const memorySource = plan.selectedSources.find(source => source.kind === 'memory')
assert(profileSource && memorySource)

function rejectedOutcome(source, overrides, expectedOutcome = 'invalid') {
  const receipt = createContextReadReceipt(plan, {
    verificationMode: 'structured-plan',
    planObserved: true,
    hostSessionId: 'binding-test-session',
    nowMs: BASE_MS
  })
  const next = recordContextReadOutcome(receipt, plan, evidence(plan, source, overrides), { nowMs: BASE_MS + 10 })
  assert(next.missingSourceIds.includes(source.sourceId), `${source.sourceId} must remain missing`)
  assert.strictEqual(next.observations.at(-1).outcome, expectedOutcome)
  assert.strictEqual(next.observations.at(-1).successful, false)
}

rejectedOutcome(profileSource, { activeRoot: 'E:/Worker/wrong-root' }, 'wrong-root')
rejectedOutcome(profileSource, { contextEpoch: 'epoch-wrong' })
rejectedOutcome(profileSource, { planId: 'plan-wrong' })
rejectedOutcome(memorySource, { targetMatch: false })
rejectedOutcome(memorySource, { schemaMatch: false })

const legacyPlan = JSON.parse(JSON.stringify(plan))
for (const field of ['planContentId', 'contextBinding', 'identityInputs', 'executionOptimization', 'reusePolicy', 'stageTiming', 'cacheDecision']) {
  delete legacyPlan[field]
}
legacyPlan.schemaVersion = CONTEXT_READ_CONTRACT.schemas.planV1
legacyPlan.freshness = {
  strategy: 'size+mtimeMs+metadataDigest',
  reuse: false,
  invalidators: ['active-root', 'baseline-digest', 'profile-metadata', 'scope', 'risk']
}
legacyPlan.planId = `plan-${stableDigest({
  ...legacyPlan,
  planId: undefined,
  planningTelemetry: undefined
}).slice(0, 24)}`
const legacyValidation = validateContextReadPlan(legacyPlan)
assert.strictEqual(legacyValidation.valid, true, legacyValidation.errors.join('; '))
const legacyReceipt = createContextReadReceipt(legacyPlan, { nowMs: BASE_MS })
assert.strictEqual(legacyReceipt.schemaVersion, CONTEXT_READ_CONTRACT.schemas.receiptV1)
assert.notStrictEqual(legacyReceipt.status, 'relevant-complete')
assert.strictEqual(evaluateContextReuse({ plan, priorPlan: legacyPlan }).delivery.reasonCode, 'legacy-or-missing-prior-plan')

console.log('context binding tests passed wrongTarget/root/epoch/plan/query=0 legacyComplete=0')
