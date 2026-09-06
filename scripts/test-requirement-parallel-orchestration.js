#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildAgentWorkLeases,
  buildHostSubagentCancelFence,
  buildHostSubagentDispatchPlan,
  buildRootAgentIntegrationReceipt,
  buildRequirementParallelOrchestration,
  childAgentEvidenceDigest,
  classifyRequirementIndependence,
  hostCapabilityDigest,
  normalizePathFragment,
  pathsOverlap,
  resolvePhysicalCandidate,
  rootsOverlap,
  validateChildAgentEvidence,
  validateHostNativeCollaborationCapability,
  validateParallelLaunchCard
} = require('./lib/requirement-parallel-orchestration')
const { createCanonicalAwareReader } = require('./lib/canonical-consumer-contracts')
const { planValidation } = require('./lib/validation-dag')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'requirement-parallel-orchestration')
const readSource = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'))
}

function source(relativePath) {
  return readSource(path.join(ROOT, relativePath))
}

assert.strictEqual(normalizePathFragment('E:\\Worker\\devcodex\\skills\\a\\'), 'e:/worker/devcodex/skills/a')
assert.strictEqual(pathsOverlap('skills/a', 'skills/a/SKILL.md'), true)
assert.strictEqual(pathsOverlap('skills/a', 'skills/alpha/SKILL.md'), false)
assert.strictEqual(resolvePhysicalCandidate(path.join(ROOT, 'not-created', 'child')), path.join(ROOT, 'not-created', 'child'))
assert.strictEqual(rootsOverlap(ROOT, path.join(ROOT, '.tmp', 'nested')), true)
assert.strictEqual(rootsOverlap(ROOT, path.resolve(ROOT, '..', 'sibling')), false)

const independent = fixture('independent-disjoint-requirements.json')
const independentReceipt = buildRequirementParallelOrchestration(independent.input)
assert.strictEqual(independentReceipt.classification, independent.expected.classification)
assert.strictEqual(independentReceipt.launchCards.length, independent.expected.launchCards)
assert(independentReceipt.launchCardValidations.every(validation => validation.valid))

const weak = fixture('weak-coupled-shared-portfolio.json')
const weakDecision = classifyRequirementIndependence(weak.input)
assert.strictEqual(weakDecision.classification, weak.expected.classification)
assert(weakDecision.locks.some(lock => lock.surface === weak.expected.lockSurface && lock.policy === 'weak-lock'))

const serial = fixture('serial-shared-source-mutation.json')
const serialDecision = classifyRequirementIndependence(serial.input)
assert.strictEqual(serialDecision.classification, serial.expected.classification)
assert(serialDecision.reasonCodes.includes(serial.expected.reasonCode))

const missingCard = fixture('launch-card-missing-fields.json')
const missingCardValidation = validateParallelLaunchCard(missingCard.card)
assert.strictEqual(missingCardValidation.classification, missingCard.expected.classification)
for (const field of missingCard.expected.missingFields) {
  assert(missingCardValidation.missingFields.includes(field), `missing expected field ${field}`)
}

const missingMerge = fixture('missing-merge-protocol.json')
const missingMergeValidation = validateParallelLaunchCard(missingMerge.card)
assert.strictEqual(missingMergeValidation.classification, missingMerge.expected.classification)

const policy = fixture('allow-parallel-mutations-policy-violation.json')
const policyDecision = classifyRequirementIndependence(policy.input)
assert.strictEqual(policyDecision.classification, policy.expected.classification)
assert.strictEqual(policyDecision.status, 'serial-required')

const NOW = '2026-09-06T00:00:00.000Z'
const SOURCE_HEAD = 'a'.repeat(40)
const DIRTY_DIGEST = 'b'.repeat(64)

function capability(overrides = {}) {
  const value = {
    schemaVersion: 'HostNativeCollaborationCapabilityV1',
    status: 'PASS',
    observationMode: 'direct-host-tool-inventory',
    hostId: 'codex',
    hostVariant: 'codex-desktop/current-task',
    operations: {
      spawn: 'collaboration.spawn_agent',
      wait: 'collaboration.wait_agent',
      interrupt: 'collaboration.interrupt_agent',
      followup: 'collaboration.followup_task'
    },
    supportedModes: ['read-only', 'isolated-validation', 'isolated-worktree-patch'],
    maxFanout: 4,
    maxDepth: 1,
    observedAt: '2026-09-05T23:59:00.000Z',
    expiresAt: '2026-09-07T00:00:00.000Z',
    evidenceRef: 'current-root-tool-inventory',
    ...overrides
  }
  value.capabilityDigest = hostCapabilityDigest(value)
  return value
}

function workGraph(overrides = {}) {
  return {
    taskId: 'task-stage-b-b6',
    viewDigest: 'c'.repeat(64),
    sourceHead: SOURCE_HEAD,
    dirtyDigest: DIRTY_DIGEST,
    activeRoot: ROOT,
    freshness: 'current',
    budget: { fanout: 3, depth: 1 },
    economicEvidence: {
      estimatedSerialMs: 240000,
      estimatedSavingsMs: 90000,
      coordinationCostRatio: 0.2,
      source: 'bounded-estimate'
    },
    workItems: [
      {
        id: 'read-a',
        displayName: 'Read A',
        kind: 'review',
        activeRoot: ROOT,
        allowedPaths: ['src/a'],
        expectedWrites: [],
        requestedMode: 'read-only',
        validationRoute: ['review-a']
      },
      {
        id: 'read-b',
        displayName: 'Read B',
        kind: 'review',
        activeRoot: ROOT,
        allowedPaths: ['src/b'],
        expectedWrites: [],
        requestedMode: 'read-only',
        validationRoute: ['review-b']
      }
    ],
    ...overrides
  }
}

function childEvidence(plan, lease, overrides = {}) {
  const value = {
    schemaVersion: 'ChildAgentEvidenceV1',
    planDigest: plan.planDigest,
    leaseDigest: lease.leaseDigest,
    workItemId: lease.workItemId,
    attempt: lease.attempt,
    hostChildId: `child-${lease.workItemId}`,
    status: 'completed',
    baseHead: lease.baseHead,
    dirtyDigest: lease.dirtyDigest,
    actualChangedRealpaths: [],
    forbiddenSharedSurfacesTouched: [],
    patchDigest: null,
    validationReceipts: [{ id: 'child-local-check', status: 'PASS', evidenceDigest: 'd'.repeat(64) }],
    cleanup: { complete: true, ownedResidueCount: 0 },
    completedAt: '2026-09-06T00:01:00.000Z',
    ...overrides
  }
  value.evidenceDigest = childAgentEvidenceDigest(value)
  return value
}

const directCapability = capability()
const directCapabilityValidation = validateHostNativeCollaborationCapability(directCapability, { now: NOW })
assert.strictEqual(directCapabilityValidation.status, 'PASS')
assert.strictEqual(directCapabilityValidation.directEligible, true)

const directPlan = buildHostSubagentDispatchPlan(workGraph(), {
  hostCapabilityEvidence: directCapability,
  now: NOW
})
assert.strictEqual(directPlan.status, 'parallel-eligible')
assert.strictEqual(directPlan.budget.fanout, 2)
assert.strictEqual(directPlan.budget.depth, 1)
assert.strictEqual(directPlan.serialFallback.required, false)
assert.deepStrictEqual(directPlan.mergeProtocol.mergeOrder, ['read-a', 'read-b'])

const directLeases = buildAgentWorkLeases(directPlan, { now: NOW, ttlMs: 5 * 60 * 1000 })
assert.strictEqual(directLeases.length, 2)
assert(directLeases.every(lease => lease.schemaVersion === 'AgentWorkLeaseV1'))
assert.strictEqual(new Set(directLeases.map(lease => lease.cancelFence)).size, 1)

const acceptedEvidence = directLeases.map(lease => childEvidence(directPlan, lease))
for (let index = 0; index < directLeases.length; index += 1) {
  const validation = validateChildAgentEvidence(directPlan, directLeases[index], acceptedEvidence[index])
  assert.strictEqual(validation.classification, 'accepted-for-root-review')
  assert.strictEqual(validation.childCompletionIsTaskCompletion, false)
}
const integration = buildRootAgentIntegrationReceipt(directPlan, directLeases, acceptedEvidence, {
  now: '2026-09-06T00:02:00.000Z'
})
assert.strictEqual(integration.status, 'root-integration-required')
assert.deepStrictEqual(integration.acceptedEvidenceWorkItemIds, ['read-a', 'read-b'])
assert.strictEqual(integration.taskCompletion, false)
assert.strictEqual(integration.formalWriteOwner, 'root-agent-single-writer')

const reversedEvidenceIntegration = buildRootAgentIntegrationReceipt(
  directPlan,
  directLeases,
  [...acceptedEvidence].reverse(),
  { now: '2026-09-06T00:02:00.000Z' }
)
assert.deepStrictEqual(reversedEvidenceIntegration.acceptedEvidenceWorkItemIds, ['read-a', 'read-b'])

const staleCapability = capability({ expiresAt: '2026-09-05T23:59:30.000Z' })
const stalePlan = buildHostSubagentDispatchPlan(workGraph(), {
  hostCapabilityEvidence: staleCapability,
  now: NOW
})
assert.strictEqual(stalePlan.status, 'serial-fallback')
assert(stalePlan.serialFallback.reasonCodes.includes('host-capability:capability-expired'))
assert.deepStrictEqual(buildAgentWorkLeases(stalePlan, { now: NOW }), [])

const absentCapabilityPlan = buildHostSubagentDispatchPlan(workGraph(), { now: NOW })
assert.strictEqual(absentCapabilityPlan.status, 'serial-fallback')
assert(absentCapabilityPlan.serialFallback.reasonCodes.some(code => code.startsWith('host-capability:')))

const tamperedCapability = capability()
tamperedCapability.maxFanout = 99
const tamperedCapabilityPlan = buildHostSubagentDispatchPlan(workGraph(), {
  hostCapabilityEvidence: tamperedCapability,
  now: NOW
})
assert.strictEqual(tamperedCapabilityPlan.status, 'serial-fallback')
assert(tamperedCapabilityPlan.serialFallback.reasonCodes.includes('host-capability:capability-digest-invalid'))

const documentationOnly = capability({ observationMode: 'official-documentation' })
const docsPlan = buildHostSubagentDispatchPlan(workGraph(), {
  hostCapabilityEvidence: documentationOnly,
  now: NOW
})
assert.strictEqual(docsPlan.status, 'serial-fallback')
assert(docsPlan.serialFallback.reasonCodes.includes('host-capability:direct-observation-required'))

const cheapPlan = buildHostSubagentDispatchPlan(workGraph({
  economicEvidence: {
    estimatedSerialMs: 60000,
    estimatedSavingsMs: 10000,
    coordinationCostRatio: 0.4,
    source: 'bounded-estimate'
  }
}), { hostCapabilityEvidence: directCapability, now: NOW })
assert.strictEqual(cheapPlan.status, 'serial-fallback')
assert(cheapPlan.serialFallback.reasonCodes.includes('serial-estimate-below-threshold'))
assert(cheapPlan.serialFallback.reasonCodes.includes('estimated-savings-below-threshold'))
assert(cheapPlan.serialFallback.reasonCodes.includes('coordination-cost-above-threshold'))

const sharedPlan = buildHostSubagentDispatchPlan(serial.input, {
  hostCapabilityEvidence: directCapability,
  now: NOW
})
assert.strictEqual(sharedPlan.status, 'serial-fallback')
assert.strictEqual(sharedPlan.serialFallback.preservesWorkGraph, true)

function patchGraph(isolationMode = 'separate-worktree') {
  return workGraph({
    workItems: ['a', 'b'].map(letter => ({
      id: `patch-${letter}`,
      displayName: `Patch ${letter.toUpperCase()}`,
      kind: 'implementation',
      activeRoot: ROOT,
      allowedPaths: [`src/${letter}`],
      expectedWrites: [{ path: `src/${letter}/index.js`, surface: 'source-mutation' }],
      isolationMode,
      validationRoute: [`test-${letter}`]
    }))
  })
}

const patchPlan = buildHostSubagentDispatchPlan(patchGraph(), {
  hostCapabilityEvidence: directCapability,
  now: NOW
})
assert.strictEqual(patchPlan.status, 'parallel-eligible')
assert(patchPlan.workItems.every(item => item.mode === 'isolated-worktree-patch'))
assert.deepStrictEqual(buildAgentWorkLeases(patchPlan, { now: NOW }), [])
const patchIsolationRoots = {
  'patch-a': path.resolve(ROOT, '..', 'devcodex-b6-worktree-a'),
  'patch-b': path.resolve(ROOT, '..', 'devcodex-b6-worktree-b')
}
const patchLeases = buildAgentWorkLeases(patchPlan, {
  now: NOW,
  isolationRootsByWorkItem: patchIsolationRoots
})
assert.strictEqual(patchLeases.length, 2)
assert(patchLeases.every(lease => lease.isolationRoot !== ROOT))
assert.deepStrictEqual(buildAgentWorkLeases(patchPlan, {
  now: NOW,
  isolationRootsByWorkItem: {
    'patch-a': path.join(ROOT, '.tmp', 'nested-a'),
    'patch-b': path.join(ROOT, '.tmp', 'nested-b')
  }
}), [])
assert.deepStrictEqual(buildAgentWorkLeases(patchPlan, {
  now: NOW,
  isolationRootsByWorkItem: {
    'patch-a': patchIsolationRoots['patch-a'],
    'patch-b': patchIsolationRoots['patch-a']
  }
}), [])
assert.deepStrictEqual(buildAgentWorkLeases(patchPlan, {
  now: NOW,
  isolationRootsByWorkItem: {
    'patch-a': patchIsolationRoots['patch-a'],
    'patch-b': path.join(patchIsolationRoots['patch-a'], 'nested-b')
  }
}), [])
const patchEvidence = patchLeases.map((lease, index) => childEvidence(patchPlan, lease, {
  actualChangedRealpaths: [path.join(lease.isolationRoot, 'src', index === 0 ? 'a' : 'b', 'index.js')],
  patchDigest: 'e'.repeat(64)
}))
const patchIntegration = buildRootAgentIntegrationReceipt(patchPlan, patchLeases, patchEvidence, { now: NOW })
assert.deepStrictEqual(patchIntegration.rootPatchApplyOrder, ['patch-a', 'patch-b'])
assert.strictEqual(patchIntegration.rootRetestRequired, true)

const sharedCheckoutPlan = buildHostSubagentDispatchPlan(patchGraph('same-active-root-disjoint-paths'), {
  hostCapabilityEvidence: directCapability,
  now: NOW
})
assert.strictEqual(sharedCheckoutPlan.status, 'serial-fallback')
assert(sharedCheckoutPlan.serialFallback.reasonCodes.some(code => code.startsWith('worktree-isolation-required:')))

const noWorktreeCapability = capability({ supportedModes: ['read-only', 'isolated-validation'] })
const noWorktreePlan = buildHostSubagentDispatchPlan(patchGraph(), {
  hostCapabilityEvidence: noWorktreeCapability,
  now: NOW
})
assert.strictEqual(noWorktreePlan.status, 'serial-fallback')
assert(noWorktreePlan.serialFallback.reasonCodes.some(code => code.includes('host-mode-unsupported')))

const unsafeScopePlan = buildHostSubagentDispatchPlan(workGraph({
  workItems: [
    ...workGraph().workItems.slice(0, 1),
    {
      ...workGraph().workItems[1],
      allowedPaths: ['../outside-root']
    }
  ]
}), { hostCapabilityEvidence: directCapability, now: NOW })
assert.strictEqual(unsafeScopePlan.status, 'serial-fallback')
assert(unsafeScopePlan.serialFallback.reasonCodes.includes('allowed-realpaths-invalid:read-b'))

const explicitOutsideRealpathPlan = buildHostSubagentDispatchPlan(workGraph({
  workItems: [
    workGraph().workItems[0],
    {
      ...workGraph().workItems[1],
      allowedRealpaths: [path.resolve(ROOT, '..', 'outside-root')]
    }
  ]
}), { hostCapabilityEvidence: directCapability, now: NOW })
assert.strictEqual(explicitOutsideRealpathPlan.status, 'serial-fallback')
assert(explicitOutsideRealpathPlan.serialFallback.reasonCodes.includes('allowed-realpaths-invalid:read-b'))

const relativeRealpathPlan = buildHostSubagentDispatchPlan(workGraph({
  workItems: [
    workGraph().workItems[0],
    {
      ...workGraph().workItems[1],
      allowedRealpaths: ['src/b']
    }
  ]
}), { hostCapabilityEvidence: directCapability, now: NOW })
assert.strictEqual(relativeRealpathPlan.status, 'serial-fallback')
assert(relativeRealpathPlan.serialFallback.reasonCodes.includes('allowed-realpaths-not-absolute:read-b'))

const duplicateWorkItemPlan = buildHostSubagentDispatchPlan(workGraph({
  workItems: [workGraph().workItems[0], { ...workGraph().workItems[1], id: 'read-a' }]
}), { hostCapabilityEvidence: directCapability, now: NOW })
assert.strictEqual(duplicateWorkItemPlan.status, 'serial-fallback')
assert(duplicateWorkItemPlan.serialFallback.reasonCodes.includes('duplicate-work-item-id:read-a'))

const cancelled = buildHostSubagentCancelFence(directPlan, directLeases, {
  now: '2026-09-06T00:01:30.000Z',
  reason: 'root-timeout-fallback'
})
const cancelledValidation = validateChildAgentEvidence(directPlan, directLeases[0], acceptedEvidence[0], {
  currentCancelFence: cancelled.cancelFence,
  rootFallbackStarted: true
})
assert.strictEqual(cancelledValidation.classification, 'quarantined')
assert(cancelledValidation.quarantineReasons.includes('cancel-fence-changed'))
assert(cancelledValidation.quarantineReasons.includes('root-serial-fallback-already-started'))

const lateEvidence = childEvidence(directPlan, directLeases[0], {
  completedAt: '2026-09-06T00:06:00.000Z'
})
const lateValidation = validateChildAgentEvidence(directPlan, directLeases[0], lateEvidence)
assert(lateValidation.quarantineReasons.includes('lease-expired-or-time-invalid'))

const escapedEvidence = childEvidence(patchPlan, patchLeases[0], {
  actualChangedRealpaths: [path.resolve(ROOT, '..', 'escape.js')],
  patchDigest: 'f'.repeat(64)
})
const escapedValidation = validateChildAgentEvidence(patchPlan, patchLeases[0], escapedEvidence)
assert(escapedValidation.quarantineReasons.includes('changed-realpath-outside-lease'))

const readOnlyMutationEvidence = childEvidence(directPlan, directLeases[0], {
  actualChangedRealpaths: [path.join(ROOT, 'src', 'a', 'unexpected.js')]
})
const readOnlyMutationValidation = validateChildAgentEvidence(
  directPlan,
  directLeases[0],
  readOnlyMutationEvidence
)
assert(readOnlyMutationValidation.quarantineReasons.includes('read-only-mode-mutated'))

const relativeChangedPathEvidence = childEvidence(directPlan, directLeases[0], {
  actualChangedRealpaths: ['src/a/untrusted-relative.js']
})
const relativeChangedPathValidation = validateChildAgentEvidence(
  directPlan,
  directLeases[0],
  relativeChangedPathEvidence
)
assert(relativeChangedPathValidation.quarantineReasons.includes('changed-realpath-not-absolute'))

const missingPatchDigestEvidence = childEvidence(patchPlan, patchLeases[0], {
  actualChangedRealpaths: [path.join(patchLeases[0].isolationRoot, 'src', 'a', 'index.js')]
})
const missingPatchDigestValidation = validateChildAgentEvidence(
  patchPlan,
  patchLeases[0],
  missingPatchDigestEvidence
)
assert(missingPatchDigestValidation.quarantineReasons.includes('patch-digest-missing'))

const missingValidationEvidence = childEvidence(directPlan, directLeases[0], {
  validationReceipts: []
})
const missingValidationEvidenceResult = validateChildAgentEvidence(
  directPlan,
  directLeases[0],
  missingValidationEvidence
)
assert(missingValidationEvidenceResult.quarantineReasons.includes('validation-evidence-incomplete'))

const driftedEvidence = childEvidence(directPlan, directLeases[0], { dirtyDigest: '0'.repeat(64) })
const driftedValidation = validateChildAgentEvidence(directPlan, directLeases[0], driftedEvidence)
assert(driftedValidation.quarantineReasons.includes('source-identity-drift'))

const forbiddenEvidence = childEvidence(directPlan, directLeases[0], {
  forbiddenSharedSurfacesTouched: ['memory']
})
const forbiddenValidation = validateChildAgentEvidence(directPlan, directLeases[0], forbiddenEvidence)
assert(forbiddenValidation.quarantineReasons.includes('forbidden-shared-surface-touched'))

const dirtyCleanupEvidence = childEvidence(directPlan, directLeases[0], {
  cleanup: { complete: false, ownedResidueCount: 1 }
})
const dirtyCleanupValidation = validateChildAgentEvidence(directPlan, directLeases[0], dirtyCleanupEvidence)
assert(dirtyCleanupValidation.quarantineReasons.includes('owned-resource-cleanup-incomplete'))

const tamperedEvidence = childEvidence(directPlan, directLeases[0])
tamperedEvidence.hostChildId = 'tampered-after-digest'
const tamperedEvidenceValidation = validateChildAgentEvidence(directPlan, directLeases[0], tamperedEvidence)
assert(tamperedEvidenceValidation.quarantineReasons.includes('child-evidence-digest-invalid'))

const tamperedLease = { ...directLeases[0], expiresAt: '2026-09-06T00:10:00.000Z' }
const tamperedLeaseValidation = validateChildAgentEvidence(directPlan, tamperedLease, acceptedEvidence[0])
assert(tamperedLeaseValidation.quarantineReasons.includes('lease-invalid'))

const timeoutEvidence = childEvidence(directPlan, directLeases[0], { status: 'timeout' })
const timeoutValidation = validateChildAgentEvidence(directPlan, directLeases[0], timeoutEvidence)
assert(timeoutValidation.quarantineReasons.includes('child-terminal:timeout'))
assert.strictEqual(timeoutValidation.serialFallbackRequired, true)

const serialIntegration = buildRootAgentIntegrationReceipt(stalePlan, [], [], { now: NOW })
assert.strictEqual(serialIntegration.status, 'serial-fallback-required')
assert.deepStrictEqual(serialIntegration.serialTakeoverWorkItemIds, ['read-a', 'read-b'])

const missingChildIntegration = buildRootAgentIntegrationReceipt(
  directPlan,
  directLeases,
  [acceptedEvidence[1]],
  { now: NOW }
)
assert.strictEqual(missingChildIntegration.status, 'serial-fallback-required')
assert.deepStrictEqual(missingChildIntegration.acceptedEvidenceWorkItemIds, ['read-b'])
assert.deepStrictEqual(missingChildIntegration.serialTakeoverWorkItemIds, ['read-a'])
assert.deepStrictEqual(missingChildIntegration.mergeOrder, ['read-a', 'read-b'])

const duplicateEvidenceIntegration = buildRootAgentIntegrationReceipt(
  directPlan,
  directLeases,
  [acceptedEvidence[0], acceptedEvidence[0], acceptedEvidence[1]],
  { now: NOW }
)
assert.strictEqual(duplicateEvidenceIntegration.status, 'serial-fallback-required')
assert.deepStrictEqual(duplicateEvidenceIntegration.serialTakeoverWorkItemIds, ['read-a'])
assert(duplicateEvidenceIntegration.validations.some(validation =>
  validation.workItemId === 'read-a' && validation.quarantineReasons.includes('child-result-duplicate')
))

const duplicateHostChildEvidence = childEvidence(directPlan, directLeases[1], {
  hostChildId: acceptedEvidence[0].hostChildId
})
const duplicateHostChildIntegration = buildRootAgentIntegrationReceipt(
  directPlan,
  directLeases,
  [acceptedEvidence[0], duplicateHostChildEvidence],
  { now: NOW }
)
assert.deepStrictEqual(duplicateHostChildIntegration.serialTakeoverWorkItemIds, ['read-a', 'read-b'])
assert(duplicateHostChildIntegration.validations.every(validation =>
  validation.quarantineReasons.includes('host-child-identity-duplicate')
))

const unplannedEvidence = {
  ...acceptedEvidence[0],
  workItemId: 'unplanned-work-item'
}
unplannedEvidence.evidenceDigest = childAgentEvidenceDigest(unplannedEvidence)
const unplannedEvidenceIntegration = buildRootAgentIntegrationReceipt(
  directPlan,
  directLeases,
  [...acceptedEvidence, unplannedEvidence],
  { now: NOW }
)
assert.deepStrictEqual(unplannedEvidenceIntegration.unexpectedEvidenceWorkItemIds, ['unplanned-work-item'])
assert.deepStrictEqual(unplannedEvidenceIntegration.serialTakeoverWorkItemIds, ['read-a', 'read-b'])
assert(unplannedEvidenceIntegration.validations.some(validation =>
  validation.workItemId === 'unplanned-work-item' &&
  validation.quarantineReasons.includes('child-result-unplanned')
))

const duplicateLeaseIntegration = buildRootAgentIntegrationReceipt(
  directPlan,
  [directLeases[0], directLeases[0], directLeases[1]],
  acceptedEvidence,
  { now: NOW }
)
assert.deepStrictEqual(duplicateLeaseIntegration.serialTakeoverWorkItemIds, ['read-a'])
assert(duplicateLeaseIntegration.validations.some(validation =>
  validation.workItemId === 'read-a' && validation.quarantineReasons.includes('agent-work-lease-duplicate')
))

const fiveItems = Array.from({ length: 5 }, (_, index) => ({
  id: `fanout-${index}`,
  displayName: `Fanout ${index}`,
  kind: 'review',
  activeRoot: ROOT,
  allowedPaths: [`src/fanout-${index}`],
  expectedWrites: [],
  requestedMode: 'read-only',
  validationRoute: [`review-${index}`]
}))
const cappedPlan = buildHostSubagentDispatchPlan(workGraph({
  budget: { fanout: 10, depth: 9 },
  workItems: fiveItems
}), {
  hostCapabilityEvidence: capability({ maxFanout: 10, maxDepth: 9 }),
  now: NOW
})
assert.strictEqual(cappedPlan.status, 'parallel-eligible')
assert.strictEqual(cappedPlan.budget.fanout, 4)
assert.strictEqual(cappedPlan.budget.depth, 1)
assert.deepStrictEqual(buildAgentWorkLeases(directPlan, { now: NOW, ttlMs: 1 }), [])

const sourceAnchors = [
  ['skills/requirement-parallel-orchestration/SKILL.md', [
    'RequirementIndependenceGate',
    'ParallelLaunchCardV1',
    'IntegrationMergeProtocolV1',
    'HostNativeCollaborationCapabilityV1',
    'HostSubagentDispatchPlanV1',
    'AgentWorkLeaseV1',
    'ChildAgentEvidenceV1',
    'RootAgentIntegrationReceiptV1',
    'HostSubagentCancelFenceV1',
    'allowParallelMutations',
    'npm run test:requirement-parallel-orchestration'
  ]],
  ['skills/dev-default/SKILL.md', ['requirement-parallel-orchestration', 'HostSubagentDispatchPlanV1', 'AgentWorkLeaseV1']],
  ['skills/fix-default/SKILL.md', ['requirement-parallel-orchestration', 'HostSubagentDispatchPlanV1', 'AgentWorkLeaseV1']],
  ['skills/execution-contract/SKILL.md', ['ParallelLaunchCardV1', 'HostSubagentDispatchPlanV1', 'AgentWorkLeaseV1']],
  ['skills/test-router/SKILL.md', ['requirementParallelOrchestration', 'ChildAgentEvidenceV1', 'HostSubagentCancelFenceV1']],
  ['skills/memory/SKILL.md', ['ParallelLaunchCardV1', 'ChildAgentEvidenceV1', 'AgentWorkLeaseV1']],
  ['skills/report/SKILL.md', ['RequirementIndependenceDecisionV1', 'HostSubagentDispatchPlanV1', 'serial takeover']]
]

for (const [relativePath, anchors] of sourceAnchors) {
  const content = source(relativePath)
  for (const anchor of anchors) {
    assert(content.includes(anchor), `${relativePath} missing ${anchor}`)
  }
}

const packageJson = JSON.parse(source('package.json'))
assert.strictEqual(
  packageJson.scripts['test:requirement-parallel-orchestration'],
  'node scripts/test-requirement-parallel-orchestration.js'
)
assert(packageJson.scripts['test:control-plane'].includes('npm run test:requirement-parallel-orchestration'))
assert(packageJson.files.includes('scripts/lib/requirement-parallel-orchestration.js'))
assert(packageJson.files.includes('scripts/test-requirement-parallel-orchestration.js'))
assert(packageJson.files.includes('scripts/fixtures/requirement-parallel-orchestration/'))

const plugin = JSON.parse(source('plugin.json'))
assert(plugin.skills.some(skill => skill.id === 'requirement-parallel-orchestration'))

const manifest = JSON.parse(source('scripts/validation-manifest.json'))
assert(manifest.criticalInputs.includes('scripts/lib/requirement-parallel-orchestration.js'))
assert.strictEqual(manifest.routes.fast.dynamic, true)
assert(manifest.routes.full.nodes.includes('requirement-parallel-orchestration'))
const manifestNode = manifest.nodes.find(node => node.id === 'requirement-parallel-orchestration')
assert(manifestNode, 'validation manifest missing requirement-parallel-orchestration node')
assert(manifestNode.inputs.includes('scripts/fixtures/requirement-parallel-orchestration/**'))
for (const artifact of [
  'HostNativeCollaborationCapabilityValidationV1',
  'HostSubagentDispatchPlanV1',
  'AgentWorkLeaseV1',
  'HostSubagentCancelFenceV1',
  'ChildAgentEvidenceValidationV1',
  'RootAgentIntegrationReceiptV1'
]) {
  assert(manifestNode.evidenceArtifacts.includes(artifact), `validation manifest missing ${artifact}`)
}
const fastPlan = planValidation({
  manifest,
  route: 'fast',
  changedFiles: ['scripts/lib/requirement-parallel-orchestration.js'],
  changedSource: 'requirement-parallel-fixture',
  candidateStable: true,
  candidateId: 'requirement-parallel-fast-fixture'
})
assert(fastPlan.selectedNodes.some(node => node.id === 'requirement-parallel-orchestration'))
assert.notStrictEqual(fastPlan.verificationLevel, 'V3')

console.log('requirement parallel orchestration tests passed')
