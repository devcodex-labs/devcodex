#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  DEFAULT_SHADOW_SAMPLES,
  buildAlwaysOnGovernanceSummary,
  buildAlwaysOnLayerMatrix,
  buildAlwaysOnLoadReceipt,
  buildAlwaysOnSurfaceMatrix,
  buildHostAdapterCompatibilityMatrix,
  classifyAlwaysOnUpgradeTriggers,
  countApplyToAll,
  evaluateAlwaysOnShadowSamples
} = require('./lib/always-on-governance.js')

const ROOT = path.resolve(__dirname, '..')
const WORKSPACE = path.dirname(ROOT)

const summary = buildAlwaysOnGovernanceSummary({
  packageRoot: ROOT,
  workspaceRoot: WORKSPACE
})
assert.strictEqual(summary.schemaVersion, 'AlwaysOnGovernanceSummaryV1')
assert.strictEqual(summary.readOnly, true)
assert.strictEqual(summary.defaultBehaviorChanged, false)
assert.strictEqual(summary.ao3Enabled, false)
assert.strictEqual(summary.validation.valid, true, summary.validation.errors.join(' | '))
assert.ok(summary.surfaceMatrix.sourceApplyToFiles >= 15)
assert.ok(summary.surfaceMatrix.sourceApplyToBytes > 100000)
assert.ok(summary.surfaceMatrix.sourceApplyToAllCount >= summary.surfaceMatrix.sourceApplyToFiles)
assert.ok(summary.layerMatrix.mandatoryRuleCount >= 29)
assert.strictEqual(summary.layerMatrix.l0MandatoryCount, summary.layerMatrix.mandatoryRuleCount)
assert.strictEqual(summary.hostMatrix.grokModeCount, 3)
assert.ok(summary.hostMatrix.hostCount >= 10)
assert.strictEqual(summary.shadow.sampleCount, 40)
assert.strictEqual(summary.shadow.p0MissedCount, 0)
assert.strictEqual(summary.shadow.decision, 'pass')

const surfaceMatrix = buildAlwaysOnSurfaceMatrix({ packageRoot: ROOT, workspaceRoot: WORKSPACE })
assert.strictEqual(surfaceMatrix.schemaVersion, 'AlwaysOnSurfaceMatrixV1')
assert.strictEqual(surfaceMatrix.validation.valid, true, surfaceMatrix.validation.errors.join(' | '))
const sourceInstructions = surfaceMatrix.surfaces.find(surface => surface.id === 'source-instructions')
assert(sourceInstructions)
assert.strictEqual(sourceInstructions.required, true)
assert.ok(sourceInstructions.fileDetails.every(file => file.applyToAllCount >= 1))
const sharedKernel = surfaceMatrix.surfaces.find(surface => surface.id === 'shared-host-kernel')
assert(sharedKernel)
assert.strictEqual(sharedKernel.exists, true)
assert.ok(sharedKernel.bytes > 0)

const layerMatrix = buildAlwaysOnLayerMatrix({ packageRoot: ROOT })
assert.strictEqual(layerMatrix.schemaVersion, 'AlwaysOnLayerMatrixV1')
assert.strictEqual(layerMatrix.validation.valid, true, layerMatrix.validation.errors.join(' | '))
for (const id of ['S01', 'S07', 'C02', 'C18', 'C22']) {
  const entry = layerMatrix.entries.find(item => item.ruleId === id)
  assert(entry, `missing mandatory layer entry ${id}`)
  assert.strictEqual(entry.layer, 'L0')
}
assert(layerMatrix.entries.some(entry => entry.ruleId === 'L99FullFallback' && entry.layer === 'L99'))

const hostMatrix = buildHostAdapterCompatibilityMatrix()
assert.strictEqual(hostMatrix.schemaVersion, 'HostAdapterCompatibilityMatrixV1')
assert.strictEqual(hostMatrix.validation.valid, true, hostMatrix.validation.errors.join(' | '))
const hostById = Object.fromEntries(hostMatrix.hosts.map(host => [host.hostId, host]))
assert.strictEqual(hostById['gemini-cli'].ao3ClaimLevel, 'beta-unverified')
assert.strictEqual(hostById['copilot-vscode'].hardBlockCapability, 'instruction-only')
assert.strictEqual(hostById['claude-code'].ao3ClaimLevel, 'full-with-direct-evidence')
assert.strictEqual(hostById.codex.ao3ClaimLevel, 'codex-surface-backed-beta')
assert.strictEqual(hostById['grok-root-native'].ao3ClaimLevel, 'root-native-with-direct-evidence')
assert.strictEqual(hostById['grok-plain-child'].ao3ClaimLevel, 'child-plain-partial')
assert.strictEqual(hostById['grok-launcher'].ao3ClaimLevel, 'launcher-full')
assert.strictEqual(hostById['chatgpt-plain'].ao3ClaimLevel, 'unsupported')
assert.notStrictEqual(hostById['grok-plain-child'].ao3ClaimLevel, hostById['grok-launcher'].ao3ClaimLevel)

const lowChat = classifyAlwaysOnUpgradeTriggers({ taskKind: 'chat', riskClass: 'low' })
assert.strictEqual(lowChat.layer, 'L0')
assert.deepStrictEqual(lowChat.upgradeTriggers, [])
assert.strictEqual(lowChat.route, 'kernel-only')

const sourceMutation = classifyAlwaysOnUpgradeTriggers({ taskKind: 'dev', sourceMutation: true })
assert.strictEqual(sourceMutation.layer, 'L2')
assert.ok(sourceMutation.upgradeTriggers.includes('source-mutation'))
assert.ok(sourceMutation.upgradeTriggers.includes('workflow-dev-fix'))

const invalidState = classifyAlwaysOnUpgradeTriggers({ taskKind: 'dev', unknownSchema: true })
assert.strictEqual(invalidState.layer, 'L99')
assert.strictEqual(invalidState.route, 'full-fallback')
assert.strictEqual(invalidState.fallbackReason, 'state-or-schema-invalid')

const badReceipt = buildAlwaysOnLoadReceipt({
  turnId: 'turn-bad',
  intentSeed: { taskKind: 'dev', sourceMutation: true }
})
assert.strictEqual(badReceipt.schemaVersion, 'AlwaysOnLoadReceiptV1')
assert.strictEqual(badReceipt.validation.valid, false)
assert.strictEqual(badReceipt.status, 'fallback-full')
assert.ok(badReceipt.validation.errors.includes('context-plan-missing'))
assert.ok(badReceipt.validation.errors.includes('skills-loaded-missing'))

const goodReceipt = buildAlwaysOnLoadReceipt({
  turnId: 'turn-good',
  intentSeed: { taskKind: 'dev', sourceMutation: true },
  contextPlan: { schemaVersion: 'ContextReadPlanV2', planId: 'fixture-plan' },
  skillsLoaded: [{ skill: 'dev-default', digest: 'fixture-digest' }],
  profileEvidence: [{ file: 'profile/04-测试规范.md', digest: 'fixture-digest' }],
  surfaceRefs: ['source-instructions', 'shared-host-kernel']
})
assert.strictEqual(goodReceipt.validation.valid, true, goodReceipt.validation.errors.join(' | '))
assert.strictEqual(goodReceipt.status, 'pass')
assert.strictEqual(goodReceipt.defaultBehaviorChanged, false)

const shadow = evaluateAlwaysOnShadowSamples(DEFAULT_SHADOW_SAMPLES)
assert.strictEqual(shadow.sampleCount, 40)
assert.strictEqual(shadow.validation.valid, true, shadow.validation.errors.join(' | '))
assert.deepStrictEqual(Object.values(shadow.scenarioCounts), [5, 5, 5, 5, 5, 5, 5, 5])
assert.strictEqual(shadow.p0MissedCount, 0)
assert.strictEqual(shadow.matchedCount, 40)

assert.strictEqual(countApplyToAll('applyTo: "**"\napplyTo:"**"\napplyTo: "*"'), 2)

console.log(
  'always-on governance tests passed: ' +
  `surfaces=${summary.surfaceMatrix.surfaceCount} ` +
  `sourceApplyToFiles=${summary.surfaceMatrix.sourceApplyToFiles} ` +
  `hosts=${summary.hostMatrix.hostCount} ` +
  `shadow=${summary.shadow.sampleCount}/${summary.shadow.p0MissedCount}`
)
