#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildWorkflowPlanDecision,
  formatWorkflowPlanInstruction,
  normalizeWorkflowRoutingConfig
} = require('../hooks/_runtime/workflow-plan-decision-v1.cjs')

const simple = buildWorkflowPlanDecision({
  phase: 'precheck',
  prompt: '这是单文件修改，走简单流程并使用最小技术方案，只做定向验证',
  config: { mode: 'standard', showPlan: true },
  facts: { targetKnown: true, changedFileCount: 1, consumerCount: 1 }
})
assert.strictEqual(simple.axes.ceremonyTier.value, 'simple')
assert.strictEqual(simple.axes.ceremonyTier.source, 'user-explicit')
assert.strictEqual(simple.axes.designDepth.value, 'minimal')
assert.strictEqual(simple.axes.assuranceLevel.value, 'targeted')

const publicContract = buildWorkflowPlanDecision({
  prompt: '走简单流程',
  config: { mode: 'adaptive', showPlan: true },
  facts: { targetKnown: true, publicContract: true, schemaChange: true, consumerCount: 3 }
})
assert.strictEqual(publicContract.axes.ceremonyTier.value, 'simple', 'explicit ceremony must remain highest priority')
assert.strictEqual(publicContract.axes.designDepth.value, 'standard')
assert.strictEqual(publicContract.axes.assuranceLevel.value, 'affected')
assert(publicContract.mandatoryObligations.includes('contract-schema-consumer-sync'))

const configured = buildWorkflowPlanDecision({
  config: { mode: 'standard', showPlan: false },
  facts: { targetKnown: true, changedFileCount: 1, consumerCount: 1 }
})
assert.strictEqual(configured.axes.ceremonyTier.value, 'standard')
assert.strictEqual(configured.axes.ceremonyTier.source, 'profile-config')
assert.strictEqual(configured.axes.designDepth.value, 'minimal', 'config must not leak into design depth')
assert.strictEqual(configured.axes.assuranceLevel.value, 'targeted', 'config must not leak into assurance')
assert.strictEqual(configured.showPlan, false)

const explicitAssurance = buildWorkflowPlanDecision({
  userIntent: { assuranceLevel: 'targeted' },
  config: { mode: 'standard' },
  facts: { targetKnown: true, publicContract: true }
})
assert.strictEqual(explicitAssurance.axes.assuranceLevel.value, 'targeted')
assert(explicitAssurance.mandatoryObligations.includes('contract-schema-consumer-sync'))

const legacy = buildWorkflowPlanDecision({
  implementationComplexityLevel: '简单够用',
  config: { mode: 'standard' },
  facts: { targetKnown: true, changedFileCount: 1 }
})
assert.strictEqual(legacy.axes.designDepth.value, 'minimal')
assert.strictEqual(legacy.axes.designDepth.source, 'legacy-design-read-compatibility')
assert.strictEqual(legacy.axes.ceremonyTier.value, 'standard', 'legacy scalar must map to design only')

const unknown = buildWorkflowPlanDecision({ config: { mode: 'adaptive' }, facts: {} })
assert.strictEqual(unknown.axes.ceremonyTier.value, 'standard')
assert.strictEqual(unknown.axes.designDepth.value, 'standard')
assert.strictEqual(unknown.axes.assuranceLevel.value, 'affected')

const expanded = buildWorkflowPlanDecision({
  phase: 'post-context',
  previousDecision: buildWorkflowPlanDecision({ facts: { targetKnown: true, changedFileCount: 1, consumerCount: 1 } }),
  facts: { targetKnown: true, changedFileCount: 4, consumerCount: 3, publicContract: true, scopeExpanded: true }
})
assert.strictEqual(expanded.change.changedFromPrecheck, true)
assert.deepStrictEqual(expanded.change.changedAxes.sort(), ['assuranceLevel', 'ceremonyTier', 'designDepth'])
assert.strictEqual(expanded.change.reason, 'bounded-context-scope-expanded')
assert.match(formatWorkflowPlanInstruction(expanded), /用户明确意图 > 项目配置 > 智能识别 > 回退/)

assert.deepStrictEqual(normalizeWorkflowRoutingConfig({ mode: 'invalid', showPlan: false }), {
  mode: 'adaptive', showPlan: false, source: 'invalid-config-fallback'
})

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'skills', 'cp-gate', 'workflow-plan-decision.v1.schema.json'), 'utf8'))
assert.strictEqual(schema.title, 'WorkflowPlanDecisionV1')
assert.strictEqual(schema.additionalProperties, false)
assert(schema.required.includes('decisionId'))

console.log('workflow plan decision passed: explicit > config > adaptive > fallback; three axes independent')
