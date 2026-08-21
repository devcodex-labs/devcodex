#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  loadControlPlaneContracts,
  validateGateRegistry,
  validateReportSchema,
  validateTestRouteSchema,
  validateCapabilitySurfaceDecisionSchema
} = require('./lib/control-plane-contracts')

const ROOT = path.resolve(__dirname, '..')
const contracts = loadControlPlaneContracts(ROOT)
assert.deepStrictEqual(contracts.errors, [])
const gateGroupIds = new Set(contracts.gateRegistry.groups.map(group => group.id))
assert.strictEqual(gateGroupIds.size, contracts.gateRegistry.groups.length)
assert.ok(contracts.gateRegistry.groups.length >= 44, 'gate registry unexpectedly lost groups')
for (const expected of [
  'repair-prevention-assessment',
  'batch-scope-rebinding',
  'release-efficiency',
  'long-task-budget',
  'runtime-state-truth',
  'local-observability-contract',
  'agent-turn-liveness',
  'context-acquisition',
  'brand-visual-quality',
  'contract-mutation-isolation',
  'phase-delivery-semantics',
  'scenario-durable-workflow',
  'capability-surface-decision'
]) {
  assert.ok(gateGroupIds.has(expected), `missing residual absorption gate group: ${expected}`)
}
assert.strictEqual(contracts.workflow.workflows.length, 8)
assert.deepStrictEqual(Object.keys(contracts.reportSchema.overlays).sort(), ['analyze', 'audit', 'dev', 'fix', 'optimization', 'scenario-test'])
assert.deepStrictEqual(contracts.testRouteSchema.stableInputs, [
  'workflow', 'changeTypes', 'risk', 'publicSurface', 'runtimeBoundary', 'profileConstraints', 'candidateState', 'capabilitySurfaceDecision', 'requestedClaims', 'verificationIntent'
])
assert.deepStrictEqual(contracts.testRouteSchema.verificationIntent.levels, ['V0', 'V1', 'V2', 'V3'])
assert.deepStrictEqual(contracts.testRouteSchema.consumerEdgeTypes,
  ['runtimeConsumer', 'qualificationConsumer', 'releaseConsumer'])
assert.deepStrictEqual(contracts.testRouteSchema.scopedRouteBoundaries,
  { 'profile-deploy': 'profile', 'package-release': 'package' })
assert.strictEqual(contracts.testRouteSchema.executionBinding.cacheSchema, 'ValidationEvidenceV2')
assert.strictEqual(contracts.testRouteSchema.executionBinding.downstreamBinding, 'nodeReceiptDigest')
assert.strictEqual(contracts.testRouteSchema.budgetPolicy.nonReleaseThresholdMs, 600000)
assert.strictEqual(contracts.capabilitySurfaceDecisionSchema.title, 'CapabilitySurfaceDecisionV1')

const owners = new Set(contracts.plugin.skills.map(item => item.id))
const duplicate = JSON.parse(JSON.stringify(contracts.gateRegistry))
duplicate.groups.push(JSON.parse(JSON.stringify(duplicate.groups[0])))
assert.ok(validateGateRegistry(duplicate, owners).some(error => error.includes('duplicate gate group')))
const badOwner = JSON.parse(JSON.stringify(contracts.gateRegistry))
badOwner.groups[0].ownerSkills = ['missing-owner']
assert.ok(validateGateRegistry(badOwner, owners).some(error => error.includes('unknown owner')))
const badReport = { ...contracts.reportSchema, gateRegistryRef: 'wrong.json' }
assert.ok(validateReportSchema(badReport, new Set(contracts.workflow.workflows.map(item => item.id))).some(error => error.includes('ref mismatch')))
const badRoute = { ...contracts.testRouteSchema, stableInputs: ['workflow', 'workflow'] }
assert.ok(validateTestRouteSchema(badRoute).some(error => error.includes('duplicate TestRoute input')))
const missingV3 = JSON.parse(JSON.stringify(contracts.testRouteSchema))
missingV3.verificationIntent.levels = ['V0', 'V1', 'V2']
assert.ok(validateTestRouteSchema(missingV3).some(error => error.includes('verification level missing: V3')))
const missingTypedEdge = JSON.parse(JSON.stringify(contracts.testRouteSchema))
missingTypedEdge.consumerEdgeTypes = ['runtimeConsumer', 'qualificationConsumer']
assert.ok(validateTestRouteSchema(missingTypedEdge).some(error => error.includes('releaseConsumer')))
const silentFullPolicy = JSON.parse(JSON.stringify(contracts.testRouteSchema))
silentFullPolicy.budgetPolicy.unknownImpactAction = 'full'
assert.ok(validateTestRouteSchema(silentFullPolicy).some(error => error.includes('budget/fallback policy mismatch')))
const staleCacheBinding = JSON.parse(JSON.stringify(contracts.testRouteSchema))
staleCacheBinding.executionBinding.cacheSchema = 'ValidationEvidenceV1'
assert.ok(validateTestRouteSchema(staleCacheBinding).some(error => error.includes('execution/cache binding mismatch')))
const leakedScopedRoute = JSON.parse(JSON.stringify(contracts.testRouteSchema))
leakedScopedRoute.scopedRouteBoundaries['profile-deploy'] = 'all'
assert.ok(validateTestRouteSchema(leakedScopedRoute).some(error => error.includes('scoped route boundary mismatch')))
const badCapabilitySchema = JSON.parse(JSON.stringify(contracts.capabilitySurfaceDecisionSchema))
badCapabilitySchema.properties.decisionOwner.const = 'domain-skill'
assert.ok(
  validateCapabilitySurfaceDecisionSchema(badCapabilitySchema).some(error => error.includes('decision owner mismatch'))
)

console.log('✓ governance registry, report, TestRoute and CapabilitySurfaceDecision schema contracts passed')
