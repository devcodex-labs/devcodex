#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  loadControlPlaneContracts,
  validateGateRegistry,
  validateReportSchema,
  validateTestRouteSchema
} = require('./lib/control-plane-contracts')

const ROOT = path.resolve(__dirname, '..')
const contracts = loadControlPlaneContracts(ROOT)
assert.deepStrictEqual(contracts.errors, [])
assert.strictEqual(contracts.gateRegistry.groups.length, 40)
const gateGroupIds = new Set(contracts.gateRegistry.groups.map(group => group.id))
for (const expected of [
  'batch-scope-rebinding',
  'release-efficiency',
  'runtime-state-truth',
  'agent-turn-liveness',
  'brand-visual-quality',
  'contract-mutation-isolation',
  'phase-delivery-semantics',
  'scenario-durable-workflow'
]) {
  assert.ok(gateGroupIds.has(expected), `missing residual absorption gate group: ${expected}`)
}
assert.strictEqual(contracts.workflow.workflows.length, 8)
assert.deepStrictEqual(Object.keys(contracts.reportSchema.overlays).sort(), ['analyze', 'audit', 'dev', 'fix', 'optimization', 'scenario-test'])
assert.deepStrictEqual(contracts.testRouteSchema.stableInputs, [
  'workflow', 'changeTypes', 'risk', 'publicSurface', 'runtimeBoundary', 'profileConstraints', 'candidateState', 'requestedClaims'
])

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

console.log('✓ governance registry, report schema and TestRoute schema contracts passed')
