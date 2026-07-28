#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { performance } = require('perf_hooks')
const contract = require('../hooks/_runtime/context-read-contract.cjs')
const { buildContentIdentity } = require('../hooks/_runtime/content-identity.cjs')

const {
  CONTEXT_READ_CONTRACT,
  buildContextReadPlan,
  completeContextReadReceipt,
  createContextReadReceipt,
  evaluateContextReuse,
  extractContextPlanBody,
  extractContextSourceEvidence,
  measureContextPayload,
  normalizeContextReadState,
  normalizeContextToolOutcome,
  normalizeIntentSeed,
  recordContextReadAttempt,
  recordContextReadOutcome,
  stableDigest,
  validateContextReadPlan
} = contract

const BASE_MS = Date.parse('2026-07-17T02:00:00.000Z')
const ACTIVE_ROOT = 'E:/Worker/devcodex'
const PROFILE_ROOT = 'E:/Worker/.devcodex/devcodex/profile'
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

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function sourceRef(file, options = {}) {
  return {
    path: `${PROFILE_ROOT}/${file}`,
    layer: options.layer || 'project',
    exists: options.exists !== false,
    size: options.exists === false ? null : (options.size || 100 + file.length),
    mtimeMs: options.exists === false ? null : (options.mtimeMs || BASE_MS - file.length)
  }
}

function makeBaseline(options = {}) {
  const files = ['README.md', 'config.json', ...STANDARD_FILES, 'config.local.json', ...(options.extraFiles || [])]
  const catalogFiles = options.catalogFiles || STANDARD_FILES
  return {
    layout: 'workspace-namespace',
    project: 'devcodex',
    mode: 'dev',
    agent: 'rocky',
    profileTier: 'full',
    effectiveConfig: {
      mode: 'dev',
      agent: 'rocky',
      extensions: { devcodex: { concurrency: { mode: 'auto' } } }
    },
    readme: {
      content: '# Profile index\n\nLOSSLESS-README-SENTINEL\n',
      sourceRefs: [sourceRef('README.md')]
    },
    configSourceRefs: [sourceRef('config.json', { layer: 'workspace' }), sourceRef('config.json')],
    catalog: catalogFiles.map((file, index) => ({
      file,
      requiredToExist: index < 7,
      authority: 'README-file-index'
    })),
    inventory: files.map(file => ({
      file,
      sourceRefs: [sourceRef(file)],
      authority: 'bounded-top-level-inventory'
    }))
  }
}

function makeInput(intent, changeTypes, extras = {}) {
  return {
    intentSeed: {
      schemaVersion: 'IntentSeedV1',
      contextEpoch: extras.contextEpoch || 'epoch-context-read-1',
      semantic: intent,
      targetHint: 'devcodex',
      continuationHint: intent === 'resume',
      riskHint: extras.riskHint || 'normal',
      confidence: extras.confidence === undefined ? 0.95 : extras.confidence,
      createdAt: '2026-07-17T02:00:00.000Z'
    },
    identity: {
      activeRoot: ACTIVE_ROOT,
      project: 'devcodex',
      host: extras.host || 'claude-hook-full',
      finalIntent: intent
    },
    changeTypes,
    baselineContext: extras.baseline || makeBaseline(),
    planningTelemetry: extras.planningTelemetry || { latencyMs: 3.5 },
    ...extras
  }
}

function assertPlan(value, message = 'expected a valid ContextReadPlanV2') {
  assert.strictEqual(value.schemaVersion, CONTEXT_READ_CONTRACT.schemas.plan, `${message}: ${value.errorCode || value.message || ''}`)
  const validation = validateContextReadPlan(value)
  assert.strictEqual(validation.valid, true, `${message}: ${validation.errors.join(' | ')}`)
  return value
}

function resignPlan(plan) {
  plan.planId = `plan-${stableDigest({ ...plan, planId: undefined, planningTelemetry: undefined }).slice(0, 24)}`
  return plan
}

function observedEvidence(plan, source, overrides = {}) {
  const body = JSON.stringify({ sourceId: source.sourceId, body: 'fixture' })
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
    resultDigest: stableDigest({ sourceId: source.sourceId, body: 'fixture' }),
    contentIdentity: buildContentIdentity({
      sourceKey: `fixture://${source.sourceId}`,
      content: body,
      contractVersion: source.kind === 'memory' ? 'MemoryStatusV1' : 'ProfileBodyV1'
    }),
    bodyObserved: true,
    hostSessionId: 'host-session-1',
    bytes: 32,
    chars: 32,
    ...overrides
  }
}

function satisfyAll(plan, verificationMode = 'structured-plan') {
  let receipt = createContextReadReceipt(plan, {
    verificationMode,
    planObserved: verificationMode === 'structured-plan',
    toolCallId: 'plan-call-1',
    hostSessionId: 'host-session-1',
    nowMs: BASE_MS
  })
  for (const sourceId of plan.mandatorySourceIds) {
    if (receipt.satisfiedSourceIds.includes(sourceId)) continue
    const source = plan.selectedSources.find(item => item.sourceId === sourceId)
    receipt = recordContextReadOutcome(receipt, plan, observedEvidence(plan, source, {
      toolCallId: `read-${sourceId}`
    }), { nowMs: BASE_MS + receipt.observations.length + 1 })
  }
  return completeContextReadReceipt(receipt, plan, { nowMs: BASE_MS + 100 })
}

assert(Object.keys(contract).length >= 12 && Object.keys(contract).length <= 18,
  'A0 export budget must remain within the frozen 12-18 range')
const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'hooks', '_runtime', 'context-read-contract.cjs'), 'utf8')
for (const forbidden of ["require('fs')", "require('http')", "require('https')", "require('net')", 'writeFile', 'appendFile']) {
  assert(!moduleSource.includes(forbidden), `pure contract contains forbidden I/O token: ${forbidden}`)
}

const seed = normalizeIntentSeed({ intent: 'chat' }, { nowMs: BASE_MS, contextEpoch: 'seed-epoch' })
assert.deepStrictEqual(seed, {
  schemaVersion: 'IntentSeedV1',
  contextEpoch: 'seed-epoch',
  semantic: 'chat',
  targetHint: null,
  continuationHint: false,
  riskHint: 'normal',
  confidence: 1,
  createdAt: '2026-07-17T02:00:00.000Z'
})
assert.strictEqual(normalizeIntentSeed({}).errorCode, 'CONTEXT_INTENT_REQUIRED')
assert.strictEqual(normalizeIntentSeed({ intent: 'docs' }).errorCode, 'CONTEXT_INTENT_INVALID')
assert.strictEqual(normalizeIntentSeed({ intent: 'dev', selectedSources: [] }).errorCode, 'CONTEXT_PLAN_INVALID')
assert.strictEqual(stableDigest({ b: 2, a: 1 }), stableDigest({ a: 1, b: 2 }))

const devPlan = assertPlan(buildContextReadPlan(makeInput('dev', ['source-code']), { nowMs: BASE_MS }))
assert.strictEqual(devPlan.executionOptimization.schemaVersion, CONTEXT_READ_CONTRACT.schemas.executionOptimizationBinding)
assert.strictEqual(devPlan.executionOptimization.mode, 'safe-auto')
assert.strictEqual(devPlan.executionOptimization.status, 'defaulted')
assert.deepStrictEqual(devPlan.contextBinding, {
  schemaVersion: 'ContextReadBindingV1',
  contextEpoch: devPlan.identity.contextEpoch,
  planId: devPlan.planId,
  planContentId: devPlan.planContentId,
  activeRoot: devPlan.identity.activeRoot,
  project: devPlan.identity.project
})
assert.deepStrictEqual(devPlan.profile.selectedFiles, STANDARD_FILES.slice(0, 3))
assert(devPlan.selectedSources.some(source => source.sourceId === 'profile:README.md' && source.kind === 'profile-baseline'))
assert(devPlan.selectedSources.some(source => source.sourceId === 'profile:config.json' && source.kind === 'profile-baseline'))
assert.deepStrictEqual(devPlan.memory.requiredQueries, ['memory_status'])
assert(devPlan.actionEnvelope.allowedActionClasses.includes('source-mutation'))
assert.strictEqual(devPlan.catalogCoverage.unclassifiedIds.length, 0)
const forgedContextBindingPlan = clone(devPlan)
forgedContextBindingPlan.contextBinding.planId = 'plan-forged'
assert.strictEqual(validateContextReadPlan(forgedContextBindingPlan).valid, false)

const stablePlan = assertPlan(buildContextReadPlan(makeInput('dev', ['source-code'], {
  planningTelemetry: { latencyMs: 999, inputTokens: 17 }
}), { nowMs: BASE_MS }))
assert.strictEqual(stablePlan.planContentId, devPlan.planContentId, 'telemetry must not change plan content identity')
assert.notStrictEqual(stablePlan.planId, devPlan.planId, 'each plan invocation must remain isolated')
assert.strictEqual(stablePlan.planningTelemetry.inputTokens, 17)
assert.strictEqual(devPlan.planningTelemetry.inputTokens, null)
const reorderedBaseline = makeBaseline()
reorderedBaseline.catalog.reverse()
reorderedBaseline.inventory.reverse()
const reorderedPlan = assertPlan(buildContextReadPlan(makeInput('dev', ['source-code'], {
  baseline: reorderedBaseline
}), { nowMs: BASE_MS }))
assert.strictEqual(reorderedPlan.planContentId, devPlan.planContentId,
  'catalog and inventory enumeration order must not change plan content identity')

const chatPlan = assertPlan(buildContextReadPlan(makeInput('chat', []), { nowMs: BASE_MS }))
assert.deepStrictEqual(chatPlan.profile.selectedFiles, [])
assert.strictEqual(chatPlan.fullRead, false)
const resumePlan = assertPlan(buildContextReadPlan(makeInput('resume', []), { nowMs: BASE_MS }))
assert.deepStrictEqual(resumePlan.memory.requiredQueries, ['memory_session_query', 'memory_status'])
assert.strictEqual(buildContextReadPlan(makeInput('dev', [])).errorCode, 'CONTEXT_CHANGE_TYPES_REQUIRED')
assert.strictEqual(buildContextReadPlan(makeInput('analyze', [], { explicitFull: true })).errorCode, 'CONTEXT_FULL_REASON_REQUIRED')
const wrongProjectBaseline = makeBaseline()
wrongProjectBaseline.project = 'other-project'
assert.strictEqual(buildContextReadPlan(makeInput('chat', [], { baseline: wrongProjectBaseline })).errorCode, 'CONTEXT_ACTIVE_TARGET_MISMATCH')
const missingReadmeBaseline = makeBaseline()
missingReadmeBaseline.readme.sourceRefs = [sourceRef('README.md', { exists: false })]
assert.strictEqual(buildContextReadPlan(makeInput('chat', [], { baseline: missingReadmeBaseline })).errorCode, 'CONTEXT_PLAN_INVALID')
const analyzeDocsPlan = assertPlan(buildContextReadPlan(makeInput('analyze', ['docs']), { nowMs: BASE_MS }))
assert(!analyzeDocsPlan.actionEnvelope.allowedActionClasses.includes('docs-mutation'), 'analysis intent must remain read-only')

const lowConfidencePlan = assertPlan(buildContextReadPlan(makeInput('dev', [], { confidence: 0.4 }), { nowMs: BASE_MS }))
assert.strictEqual(lowConfidencePlan.fullRead, true)
assert.strictEqual(lowConfidencePlan.fullReadReason, 'low-confidence')
assert.deepStrictEqual(lowConfidencePlan.profile.selectedFiles, STANDARD_FILES)
assert(!lowConfidencePlan.profile.selectedFiles.includes('config.local.json'))

const releasePlan = assertPlan(buildContextReadPlan(makeInput('dev', ['release']), { nowMs: BASE_MS }))
assert.strictEqual(releasePlan.fullRead, true)
assert.deepStrictEqual(releasePlan.profile.selectedFiles, STANDARD_FILES)
assert(releasePlan.triggeredEscalations.includes('release'))
const localPlan = assertPlan(buildContextReadPlan(makeInput('dev', ['config'], {
  configLocalRequested: true
}), { nowMs: BASE_MS }))
assert(localPlan.profile.selectedFiles.includes('config.local.json'))

const selectorBaseline = makeBaseline({ extraFiles: ['10-custom.md'] })
const driftPlan = assertPlan(buildContextReadPlan(makeInput('chat', [], { baseline: selectorBaseline })), 'catalog drift should be represented as a blocked plan')
assert.strictEqual(driftPlan.exitCondition, 'blocked')
assert.deepStrictEqual(driftPlan.catalogCoverage.unclassifiedIds, ['profile:10-custom.md'])
assert(driftPlan.triggeredEscalations.includes('profile-catalog-drift'))
assert.strictEqual(buildContextReadPlan(makeInput('chat', [], {
  baseline: selectorBaseline,
  baselineDigest: 'stale',
  profileSelectors: [{ file: '10-custom.md', reason: 'Task explicitly targets the custom profile.', authority: 'user' }]
})).errorCode, 'CONTEXT_BASELINE_STALE')
assert.strictEqual(buildContextReadPlan(makeInput('chat', [], {
  baseline: selectorBaseline,
  baselineDigest: driftPlan.baselineContext.baselineDigest,
  profileSelectors: [{ file: '../10-custom.md', reason: 'bad', authority: 'user' }]
})).errorCode, 'CONTEXT_PLAN_INVALID')
const selectedCustomPlan = assertPlan(buildContextReadPlan(makeInput('chat', [], {
  baseline: selectorBaseline,
  baselineDigest: driftPlan.baselineContext.baselineDigest,
  profileSelectors: [{ file: '10-custom.md', reason: 'Task explicitly targets the custom profile.', authority: 'user' }]
})))
assert(selectedCustomPlan.profile.selectedFiles.includes('10-custom.md'))
assert.strictEqual(selectedCustomPlan.catalogCoverage.unclassifiedIds.length, 0)
const rewordedCustomPlan = assertPlan(buildContextReadPlan(makeInput('chat', [], {
  baseline: selectorBaseline,
  baselineDigest: driftPlan.baselineContext.baselineDigest,
  profileSelectors: [{ file: '10-custom.md', reason: 'Different display wording for the same selection.', authority: 'user' }]
})))
assert.strictEqual(rewordedCustomPlan.planContentId, selectedCustomPlan.planContentId,
  'free-text reason wording must not pollute controlled plan content identity')

const oracleCases = [
  ['chat', [], []],
  ['analyze', ['project-info'], ['01-项目信息.md']],
  ['analyze', ['architecture'], ['02-架构约束.md']],
  ['analyze', ['source-code'], ['02-架构约束.md']],
  ['analyze', ['code-style'], ['03-代码风格.md']],
  ['analyze', ['testing'], ['04-测试规范.md']],
  ['analyze', ['feature-state'], ['06-功能现状.md']],
  ['analyze', ['docs'], ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md', '07-文档规范.md']],
  ['analyze', ['public-contract'], ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md', '04-测试规范.md', '06-功能现状.md', '07-文档规范.md']],
  ['dev', ['source-code'], STANDARD_FILES.slice(0, 3)],
  ['dev', ['testing'], ['04-测试规范.md']],
  ['dev', ['release'], STANDARD_FILES]
]
let mandatoryMisses = 0
for (const [intent, changeTypes, expectedFiles] of oracleCases) {
  const plan = assertPlan(buildContextReadPlan(makeInput(intent, changeTypes), { nowMs: BASE_MS }))
  const missing = expectedFiles.filter(file => !plan.profile.selectedFiles.includes(file))
  mandatoryMisses += missing.length
  assert.deepStrictEqual(plan.profile.selectedFiles, expectedFiles, `test-only full oracle mismatch for ${intent}/${changeTypes.join('+')}`)
}
assert.strictEqual(mandatoryMisses, 0, 'test-only oracle found a mandatory Profile miss')

const validPlanVariants = [
  { success: true, tool_response: { content: [{ type: 'text', text: JSON.stringify(devPlan) }] } },
  { success: true, toolResponse: { content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(devPlan)}\n\`\`\`` }] } },
  { success: true, tool_result: JSON.stringify(devPlan) },
  { success: true, toolResult: devPlan },
  { success: true, result: devPlan }
]
for (const variant of validPlanVariants) {
  const extracted = extractContextPlanBody(variant)
  assert.strictEqual(extracted.error, null, `valid host result variant rejected: ${extracted.error?.message || ''}`)
  assert.strictEqual(extracted.plan.planId, devPlan.planId)
}
assert.strictEqual(normalizeContextToolOutcome({ success: true }).observable, false)
assert.strictEqual(normalizeContextToolOutcome({
  success: true,
  result: { isError: true, error: { message: 'nested failure' } }
}).transportSuccess, false, 'nested tool failure must override outer success')
assert.strictEqual(extractContextPlanBody({ success: true }).plan, null)
assert.strictEqual(extractContextPlanBody({ success: false, result: devPlan }).plan, null)
const badPlanId = clone(devPlan)
badPlanId.planId = 'plan-spoofed'
assert.strictEqual(extractContextPlanBody({ result: badPlanId }).plan, null)
const siblingPlan = clone(devPlan)
siblingPlan.observations = []
assert.strictEqual(validateContextReadPlan(siblingPlan).valid, false)

const mutations = []
const missingReason = clone(devPlan)
delete missingReason.selectedSources.find(source => source.kind === 'profile').reason
mutations.push(missingReason)
const missingMandatory = clone(devPlan)
missingMandatory.mandatorySourceIds.pop()
mutations.push(missingMandatory)
const badMetadata = clone(devPlan)
badMetadata.selectedSources[0].sourceRefs[0].metadataDigest = 'bad'
mutations.push(badMetadata)
const brokenCoverage = clone(devPlan)
brokenCoverage.catalogCoverage.excludedIds.pop()
mutations.push(brokenCoverage)
const brokenEnvelope = clone(devPlan)
brokenEnvelope.actionEnvelope.allowedActionClasses.push('unknown-write')
mutations.push(resignPlan(brokenEnvelope))
const unknownEscalation = clone(devPlan)
unknownEscalation.triggeredEscalations.push('unknown-escalation')
mutations.push(resignPlan(unknownEscalation))
const forgedOptimization = clone(devPlan)
forgedOptimization.executionOptimization.mode = 'full-only'
mutations.push(forgedOptimization)
for (const mutation of mutations) assert.strictEqual(validateContextReadPlan(mutation).valid, false, 'plan mutation escaped validation')

let receipt = createContextReadReceipt(devPlan, {
  verificationMode: 'structured-plan',
  planObserved: true,
  toolCallId: 'plan-call-1',
  nowMs: BASE_MS
})
assert.strictEqual(receipt.status, 'baseline-ready')
assert.deepStrictEqual(receipt.satisfiedSourceIds, ['profile:README.md', 'profile:config.json'])
assert(receipt.missingSourceIds.length > 0)
receipt = recordContextReadAttempt(receipt, devPlan, {
  toolCallId: 'profile-read-1',
  actionClass: 'source-mutation',
  activeRoot: ACTIVE_ROOT,
  sourceIds: receipt.missingSourceIds
}, { nowMs: BASE_MS + 1 })
assert.strictEqual(receipt.status, 'attempted')
assert.strictEqual(receipt.replanCount, 0, 'compatible action must not request a replan')
assert(receipt.missingSourceIds.length > 0, 'Pre attempt must not satisfy mandatory evidence')
const attemptCount = receipt.observations.length
receipt = recordContextReadAttempt(receipt, devPlan, {
  toolCallId: 'profile-read-1',
  actionClass: 'source-mutation',
  activeRoot: ACTIVE_ROOT,
  sourceIds: receipt.missingSourceIds
}, { nowMs: BASE_MS + 50 })
assert.strictEqual(receipt.observations.length, attemptCount, 'duplicate Pre observation must be idempotent')

const broader = recordContextReadAttempt(receipt, devPlan, {
  toolCallId: 'release-1',
  actionClass: 'release',
  activeRoot: ACTIVE_ROOT
}, { nowMs: BASE_MS + 2 })
assert.strictEqual(broader.status, 'stale')
assert.strictEqual(broader.replanCount, 1)
const repeatedBroader = recordContextReadAttempt(broader, devPlan, {
  toolCallId: 'release-2',
  actionClass: 'release',
  activeRoot: ACTIVE_ROOT
}, { nowMs: BASE_MS + 3 })
assert.strictEqual(repeatedBroader.replanCount, 1, 'the same stale receipt must not create a replan loop')
assert.deepStrictEqual(repeatedBroader.satisfiedSourceIds, [], 'stale receipt must not reuse old satisfied evidence')
assert.deepStrictEqual(repeatedBroader.missingSourceIds, devPlan.mandatorySourceIds)

const analyzeReceipt = createContextReadReceipt(analyzeDocsPlan, {
  verificationMode: 'structured-plan', planObserved: true, nowMs: BASE_MS
})
const analyzeMutation = recordContextReadAttempt(analyzeReceipt, analyzeDocsPlan, {
  toolCallId: 'unexpected-doc-write', actionClass: 'docs-mutation', activeRoot: ACTIVE_ROOT
}, { nowMs: BASE_MS + 1 })
assert.strictEqual(analyzeMutation.status, 'stale')

const completeReceipt = satisfyAll(devPlan)
assert.strictEqual(completeReceipt.status, 'relevant-complete')
assert.deepStrictEqual(completeReceipt.satisfiedSourceIds, devPlan.mandatorySourceIds)
assert.deepStrictEqual(completeReceipt.missingSourceIds, [])
assert(completeReceipt.completedAt)
const duplicateSource = devPlan.selectedSources.find(source => source.sourceId === 'memory:memory_status')
const beforeDuplicatePost = completeReceipt.observations.length
const duplicatePostReceipt = recordContextReadOutcome(completeReceipt, devPlan, observedEvidence(devPlan, duplicateSource, {
  toolCallId: `read-${duplicateSource.sourceId}`
}), { nowMs: BASE_MS + 500 })
assert.strictEqual(duplicatePostReceipt.observations.length, beforeDuplicatePost, 'duplicate Post observation must be idempotent')
const conflictingDuplicate = recordContextReadOutcome(completeReceipt, devPlan, observedEvidence(devPlan, duplicateSource, {
  toolCallId: `read-${duplicateSource.sourceId}`,
  activeRoot: 'E:/Worker/conflicting-root'
}), { nowMs: BASE_MS + 501 })
assert.strictEqual(conflictingDuplicate.status, 'unverified', 'conflicting duplicate Post must remain ambiguous')
assert(conflictingDuplicate.missingSourceIds.includes(duplicateSource.sourceId))
const consumedReceipt = completeContextReadReceipt(completeReceipt, devPlan, { nowMs: BASE_MS + 200, consume: true })
assert.strictEqual(consumedReceipt.status, 'completed')
assert(consumedReceipt.consumedAt)

const targetSource = devPlan.selectedSources.find(source => source.kind === 'profile')
let wrongRootReceipt = createContextReadReceipt(devPlan, {
  verificationMode: 'structured-plan', planObserved: true, nowMs: BASE_MS
})
wrongRootReceipt = recordContextReadOutcome(wrongRootReceipt, devPlan, observedEvidence(devPlan, targetSource, {
  activeRoot: 'E:/Worker/other-project'
}), { nowMs: BASE_MS + 1 })
assert(wrongRootReceipt.missingSourceIds.includes(targetSource.sourceId))
assert.strictEqual(wrongRootReceipt.observations.at(-1).outcome, 'wrong-root')
let unobservableReceipt = createContextReadReceipt(devPlan, {
  verificationMode: 'structured-plan', planObserved: true, nowMs: BASE_MS
})
unobservableReceipt = recordContextReadOutcome(unobservableReceipt, devPlan, observedEvidence(devPlan, targetSource, {
  observable: false
}), { nowMs: BASE_MS + 1 })
assert(unobservableReceipt.missingSourceIds.includes(targetSource.sourceId))
assert.strictEqual(unobservableReceipt.observations.at(-1).outcome, 'unobservable')
let identitylessReceipt = createContextReadReceipt(devPlan, {
  verificationMode: 'structured-plan', planObserved: true, hostSessionId: 'host-session-1', nowMs: BASE_MS
})
identitylessReceipt = recordContextReadOutcome(identitylessReceipt, devPlan, observedEvidence(devPlan, targetSource, {
  contentIdentity: null,
  bodyObserved: false
}), { nowMs: BASE_MS + 1 })
assert(identitylessReceipt.missingSourceIds.includes(targetSource.sourceId),
  'V2 must not complete a body source without ContentIdentityV1 and body observation')

const mutatedReceipt = clone(completeReceipt)
const mutatedObservation = mutatedReceipt.observations.find(item => item.sourceId === 'memory:memory_status')
mutatedObservation.successful = false
const normalizedMutation = normalizeContextReadState({ plan: devPlan, receipt: mutatedReceipt }, { nowMs: BASE_MS + 300 })
assert.notStrictEqual(normalizedMutation.receipt.status, 'relevant-complete')
assert(normalizedMutation.receipt.missingSourceIds.includes('memory:memory_status'))
assert.deepStrictEqual(normalizeContextReadState({ plan: devPlan, receipt: completeReceipt }).bootstrap, {
  profileRead: true,
  summaryRead: true,
  tasksRead: true,
  bootstrapComplete: true
})
const callerReversed = clone(createContextReadReceipt(devPlan, {
  verificationMode: 'structured-plan', planObserved: true, nowMs: BASE_MS
}))
callerReversed.satisfiedSourceIds = [...devPlan.mandatorySourceIds]
callerReversed.missingSourceIds = []
callerReversed.status = 'relevant-complete'
const normalizedReversal = normalizeContextReadState({ plan: devPlan, receipt: callerReversed }, { nowMs: BASE_MS + 301 })
assert.notStrictEqual(normalizedReversal.receipt.status, 'relevant-complete')
assert(normalizedReversal.receipt.missingSourceIds.length > 0)
const receiptSibling = clone(completeReceipt)
receiptSibling.excludedSources = []
assert.strictEqual(normalizeContextReadState({ plan: devPlan, receipt: receiptSibling }).receipt, null)

const fallbackReceipt = satisfyAll(devPlan, 'path-observable')
assert.strictEqual(fallbackReceipt.status, 'unverified')
assert.strictEqual(fallbackReceipt.completedAt, null, 'fallback evidence must not manufacture structured completion')
const legacyState = normalizeContextReadState({
  profileRead: true,
  summaryRead: true,
  tasksRead: true,
  bootstrapComplete: true
})
assert.strictEqual(legacyState.receipt, null)
assert.deepStrictEqual(legacyState.bootstrap, {
  profileRead: true,
  summaryRead: true,
  tasksRead: true,
  bootstrapComplete: false
})

const genericSourceResults = devPlan.selectedSources.slice(0, 2).map((source, index) => ({
  sourceId: source.sourceId,
  successful: index === 0,
  outcome: index === 0 ? 'observed-success' : 'missing',
  sourceLayer: source.sourceLayer,
  sourceRefsMatch: index === 0
}))
const extractedEvidence = extractContextSourceEvidence(devPlan, {
  success: true,
  result: { sourceResults: genericSourceResults }
}, {
  contextEpoch: devPlan.identity.contextEpoch,
  planId: devPlan.planId,
  activeRoot: devPlan.identity.activeRoot
})
assert.strictEqual(extractedEvidence.error, null)
assert.strictEqual(extractedEvidence.evidence.length, 2)
assert.strictEqual(extractedEvidence.evidence.filter(item => item.successful).length, 1, 'aggregate transport success must not batch-satisfy sources')
const uncorrelatedEvidence = extractContextSourceEvidence(devPlan, {
  success: true,
  result: { sourceResults: [genericSourceResults[0]] }
})
assert.strictEqual(uncorrelatedEvidence.evidence[0].contextEpoch, '', 'extractor must not invent Hook correlation identity')
assert.strictEqual(uncorrelatedEvidence.evidence[0].activeRoot, '')
const planEvidence = extractContextSourceEvidence(devPlan, { result: devPlan }, {
  toolName: 'profile_context_plan',
  contextEpoch: devPlan.identity.contextEpoch,
  planId: devPlan.planId,
  activeRoot: devPlan.identity.activeRoot
})
assert.strictEqual(planEvidence.evidence.length, 2)
assert(planEvidence.evidence.every(item => item.outcome === 'baseline-ready'))

const unicodeMeasure = measureContextPayload('汉A')
assert.deepStrictEqual(unicodeMeasure, { bytes: 4, chars: 2, latencyMs: null, tokens: null })
assert.strictEqual(measureContextPayload('abc', { tokens: 7, latencyMs: 1.25 }).tokens, 7)

// V2 identity is stable across independent processes, while each invocation
// remains isolated and every frozen invalidator causes a content miss.
function buildPlanInChild(input) {
  const modulePath = path.join(__dirname, '..', 'hooks', '_runtime', 'context-read-contract.cjs')
  const script = [
    `const { buildContextReadPlan } = require(${JSON.stringify(modulePath)});`,
    "let body=''; process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => { body += chunk });",
    "process.stdin.on('end', () => process.stdout.write(JSON.stringify(buildContextReadPlan(JSON.parse(body)))));"
  ].join('')
  const child = spawnSync(process.execPath, ['-e', script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 10000
  })
  assert.strictEqual(child.status, 0, child.stderr)
  return assertPlan(JSON.parse(child.stdout), 'child process plan')
}

const crossProcessInput = makeInput('dev', ['source-code'])
const processPlanA = buildPlanInChild(crossProcessInput)
const processPlanB = buildPlanInChild(crossProcessInput)
assert.strictEqual(processPlanA.planContentId, processPlanB.planContentId,
  'equivalent plan content must be stable across independent processes')
assert.notStrictEqual(processPlanA.planId, processPlanB.planId,
  'independent invocations must not share planId')

const nextEpochInput = clone(crossProcessInput)
nextEpochInput.intentSeed.contextEpoch = 'epoch-context-read-2'
const nextEpochPlan = buildPlanInChild(nextEpochInput)
assert.strictEqual(nextEpochPlan.planContentId, processPlanA.planContentId,
  'contextEpoch must not pollute plan content identity')
assert.notStrictEqual(nextEpochPlan.planId, processPlanA.planId)

const sourceMutationInput = clone(crossProcessInput)
const changedSource = sourceMutationInput.baselineContext.inventory.find(item => item.file === '01-项目信息.md')
changedSource.sourceRefs[0].size += 1
changedSource.sourceRefs[0].mtimeMs += 1
assert.notStrictEqual(buildPlanInChild(sourceMutationInput).planContentId, processPlanA.planContentId,
  'source metadata mutation must invalidate computation reuse')

const configMutationInput = clone(crossProcessInput)
configMutationInput.baselineContext.effectiveConfig.extensions.devcodex.concurrency.mode = 'serial'
assert.notStrictEqual(buildPlanInChild(configMutationInput).planContentId, processPlanA.planContentId,
  'effective config mutation must invalidate computation reuse')

const wrongRootInput = clone(crossProcessInput)
wrongRootInput.identity.activeRoot = 'E:/Worker/.devcodex/other-project'
const wrongRootPlan = buildPlanInChild(wrongRootInput)
assert.notStrictEqual(wrongRootPlan.planContentId, processPlanA.planContentId)
assert.strictEqual(evaluateContextReuse({ plan: wrongRootPlan, priorPlan: processPlanA }).computation.reasonCode,
  'target-mismatch')

const riskMutationInput = clone(crossProcessInput)
riskMutationInput.intentSeed.riskHint = 'high'
assert.notStrictEqual(buildPlanInChild(riskMutationInput).planContentId, processPlanA.planContentId,
  'risk/action envelope mutation must invalidate computation reuse')

for (const [field, value] of [
  ['plannerTool', 'profile-context-plan@3'],
  ['contextPlan', 'ContextReadPlanV3'],
  ['route', 'context-acquisition@3'],
  ['consumers', 'profile-memory-hook@3']
]) {
  const mutation = clone(processPlanA)
  mutation.identityInputs.versions[field] = value
  mutation.planContentId = `plan-content-${stableDigest(mutation.identityInputs)}`
  mutation.planId = `plan-${stableDigest({
    planContentId: mutation.planContentId,
    contextEpoch: mutation.identity.contextEpoch,
    invocationNonce: mutation.identity.invocationNonce
  }).slice(0, 24)}`
  assert.notStrictEqual(mutation.planContentId, processPlanA.planContentId,
    `${field} mutation must change the claimed content identity`)
  assert.strictEqual(validateContextReadPlan(mutation).valid, false,
    `${field} drift must fail closed until the runtime contract itself is upgraded`)
  assert.strictEqual(evaluateContextReuse({ plan: mutation, priorPlan: processPlanA }).computation.reuse, false)
}

assert.strictEqual(processPlanA.stageTiming.schemaVersion, 'StageTimingV1')
assert(Number.isFinite(processPlanA.stageTiming.plannerInputBytes))
assert(Number.isFinite(processPlanA.stageTiming.plannerResponseBytes))
assert(Number.isFinite(processPlanA.stageTiming.selectedSourceBytes))
assert(Number.isFinite(processPlanA.stageTiming.returnedBodyBytes))
assert.strictEqual(processPlanA.stageTiming.hostDeliveredBytes, null)
assert.strictEqual(processPlanA.stageTiming.ttftMs, null)
assert.strictEqual(processPlanA.cacheDecision.bodyDeliverySkipped, false)

const priorPlan = assertPlan(buildContextReadPlan(makeInput('dev', ['source-code']), {
  nowMs: BASE_MS,
  invocationNonce: 'reuse-prior'
}))
const priorReceipt = satisfyAll(priorPlan)
const currentPlan = assertPlan(buildContextReadPlan(makeInput('dev', ['source-code']), {
  nowMs: BASE_MS + 1,
  invocationNonce: 'reuse-current'
}))
const reusable = evaluateContextReuse({
  plan: currentPlan,
  priorPlan,
  priorReceipt,
  hostSessionId: 'host-session-1',
  sourceIdentities: priorReceipt.sourceIdentities
})
assert.strictEqual(reusable.computation.reuse, true)
assert.strictEqual(reusable.delivery.reuse, true)
const fullOnlyReuse = evaluateContextReuse({
  plan: currentPlan,
  priorPlan,
  priorReceipt,
  hostSessionId: 'host-session-1',
  sourceIdentities: priorReceipt.sourceIdentities,
  executionOptimizationMode: 'full-only'
})
assert.strictEqual(fullOnlyReuse.computation.reuse, false)
assert.strictEqual(fullOnlyReuse.delivery.reuse, false)
assert.strictEqual(fullOnlyReuse.delivery.reasonCode, 'execution-optimization-full-only')
const reusedReceipt = createContextReadReceipt(currentPlan, {
  verificationMode: 'structured-plan',
  planObserved: true,
  toolCallId: 'reused-plan-call',
  hostSessionId: 'host-session-1',
  priorPlan,
  priorReceipt,
  sourceIdentities: priorReceipt.sourceIdentities,
  reuseDecision: reusable,
  nowMs: BASE_MS + 2
})
assert.strictEqual(reusedReceipt.planId, currentPlan.planId)
assert.strictEqual(reusedReceipt.contextEpoch, currentPlan.identity.contextEpoch)
assert.strictEqual(reusedReceipt.delivery.reused, true)
assert.strictEqual(reusedReceipt.status, 'relevant-complete')
assert.strictEqual(reusedReceipt.reuseFrom.receiptId, priorReceipt.receiptId)

const epochDecision = evaluateContextReuse({
  plan: nextEpochPlan,
  priorPlan,
  priorReceipt,
  hostSessionId: 'host-session-1',
  sourceIdentities: priorReceipt.sourceIdentities
})
assert.strictEqual(epochDecision.computation.reuse, true)
assert.strictEqual(epochDecision.delivery.reuse, false)
assert.strictEqual(epochDecision.delivery.reasonCode, 'context-epoch-mismatch')
const sessionDecision = evaluateContextReuse({
  plan: currentPlan,
  priorPlan,
  priorReceipt,
  hostSessionId: 'other-session',
  sourceIdentities: priorReceipt.sourceIdentities
})
assert.strictEqual(sessionDecision.delivery.reuse, false)
assert.strictEqual(sessionDecision.delivery.reasonCode, 'host-session-mismatch')
const changedIdentities = clone(priorReceipt.sourceIdentities)
changedIdentities[0].contentIdentity.digest = '0'.repeat(64)
const sourceDecision = evaluateContextReuse({
  plan: currentPlan,
  priorPlan,
  priorReceipt,
  hostSessionId: 'host-session-1',
  sourceIdentities: changedIdentities
})
assert.strictEqual(sourceDecision.delivery.reuse, false)
assert.strictEqual(sourceDecision.delivery.reasonCode, 'source-identity-mismatch')

const legacyPlan = clone(devPlan)
for (const field of ['planContentId', 'contextBinding', 'identityInputs', 'executionOptimization', 'reusePolicy', 'stageTiming', 'cacheDecision']) delete legacyPlan[field]
legacyPlan.schemaVersion = CONTEXT_READ_CONTRACT.schemas.planV1
legacyPlan.freshness = {
  strategy: 'size+mtimeMs+metadataDigest',
  reuse: false,
  invalidators: ['active-root', 'baseline-digest', 'profile-metadata', 'scope', 'risk']
}
legacyPlan.planId = `plan-${stableDigest({ ...legacyPlan, planId: undefined, planningTelemetry: undefined }).slice(0, 24)}`
assert.strictEqual(validateContextReadPlan(legacyPlan).valid, true, 'V1 plan reader compatibility must remain')
assert.strictEqual(createContextReadReceipt(legacyPlan, {
  verificationMode: 'structured-plan', planObserved: true, nowMs: BASE_MS
}).schemaVersion, CONTEXT_READ_CONTRACT.schemas.receiptV1)

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

function benchmarkSerialization(payloadFactory) {
  const samples = []
  let bytes = 0
  for (let index = 0; index < 35; index += 1) {
    const payload = payloadFactory()
    const startedAt = performance.now()
    const serialized = JSON.stringify(payload)
    const elapsed = performance.now() - startedAt
    bytes = Buffer.byteLength(serialized, 'utf8')
    if (index >= 5) samples.push(elapsed)
  }
  return { bytes, medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) }
}

if (process.argv.includes('--benchmark')) {
  const contents = Object.fromEntries(STANDARD_FILES.map((file, index) => [file, `${file}\n${'x'.repeat(4000 + index * 17)}`]))
  const full = benchmarkSerialization(() => ({
    baseline: devPlan.baselineContext,
    profile: contents,
    memory: { status: 'fixture', session: 'fixture'.repeat(500) }
  }))
  const targeted = benchmarkSerialization(() => ({
    plan: devPlan,
    profile: Object.fromEntries(devPlan.profile.selectedFiles.map(file => [file, contents[file]])),
    memory: { status: 'fixture' }
  }))
  assert(targeted.bytes < full.bytes, 'targeted fixture payload must be smaller than the full-read oracle payload')
  const reduction = ((full.bytes - targeted.bytes) / full.bytes * 100).toFixed(2)
  console.log(
    `benchmark context-read warmups=5 measurements=30 targetedBytes=${targeted.bytes} fullBytes=${full.bytes} ` +
    `payloadReduction=${reduction}% targetedMedianMs=${targeted.medianMs.toFixed(4)} targetedP95Ms=${targeted.p95Ms.toFixed(4)} ` +
    `fullMedianMs=${full.medianMs.toFixed(4)} fullP95Ms=${full.p95Ms.toFixed(4)} tokens=unavailable`
  )
}

console.log(`✓ context-read contract fixtures passed; mandatoryMisses=${mandatoryMisses}; falseComplete=0`)
