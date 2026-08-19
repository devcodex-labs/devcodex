#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { createCanonicalAwareReader } = require('./lib/canonical-consumer-contracts')
const { resolveControlAsset } = require('./lib/control-content-delivery')

const ROOT = path.resolve(__dirname, '..')
const read = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))
const matrix = JSON.parse(fs.readFileSync(
  resolveControlAsset(ROOT, 'skills/routing/workflow-capabilities.json'),
  'utf8'
))
const byId = new Map(matrix.workflows.map(item => [item.id, item]))
const registry = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'hooks', '_runtime', 'workflow-root-registry.v1.json'),
  'utf8'
))

assert.strictEqual(matrix.schemaVersion, 1)
assert.strictEqual(matrix.ownerSkill, 'routing')
assert.deepStrictEqual([...byId.keys()].sort(), ['analyze', 'audit', 'chat', 'dev', 'fix', 'other', 'resume', 'self-fix'])
for (const id of ['analyze', 'audit', 'other', 'chat']) {
  assert.strictEqual(byId.get(id).mutation, 'forbidden', `${id} must remain read-only`)
}
for (const id of ['dev', 'fix', 'self-fix']) {
  assert.strictEqual(byId.get(id).cp1, 'required')
  assert.strictEqual(byId.get(id).cp2, 'required')
  assert.strictEqual(byId.get(id).cp3, 'conditional')
}
assert.match(byId.get('audit').cp3Rule, /independently authorized repair workflow/)
assert.match(byId.get('other').cp3Rule, /explicit file mutation belongs to dev, fix or self-fix/)

assert.deepStrictEqual(matrix.routePresentation.userTaskSubtypes, [
  'dev.default',
  'dev.docs',
  'dev.refactor',
  'dev.database',
  'dev.init',
  'dev.optimization',
  'dev.scenario-test',
  'fix.default',
  'fix.incident',
  'fix.security',
  'analyze.default',
  'analyze.research'
])
assert.deepStrictEqual(matrix.routePresentation.internalStepRouteKeys, ['dev.plan-review'])
assert.deepStrictEqual(matrix.routePresentation.auditTargets, [
  'audit.规范文件',
  'audit.技术方案',
  'audit.需求文档',
  'audit.项目工程',
  'audit.报告',
  'audit.通用文档',
  'audit.发布前审查'
])
assert(!matrix.routePresentation.userTaskSubtypes.includes('dev.plan-review'))
assert(!matrix.routePresentation.userTaskSubtypes.includes('plan'))
const presentedRouteKeys = Object.values(matrix.routePresentation).flat().sort()
const registryRouteKeys = registry.routes.map(item => item.routeKey).filter(routeKey => routeKey.includes('.')).sort()
assert.deepStrictEqual(presentedRouteKeys, registryRouteKeys)

const consumers = {
  'skills/routing/SKILL.md': ['workflow-capabilities.json', 'CP3 条件'],
  'skills/cp-gate/SKILL.md': ['workflow-capabilities.json', '条件触发'],
  'skills/plan/SKILL.md': ['workflow-capabilities.json', '禁止 source mutation'],
  'instructions/18-spec-radar.instructions.md': ['独立授权', '不触发任何修复动作']
}
for (const [file, needles] of Object.entries(consumers)) {
  const content = read(path.join(ROOT, file))
  for (const needle of needles) assert.ok(content.includes(needle), `${file} missing ${needle}`)
}

console.log('✓ workflow capability matrix, route layers, and read-only boundaries passed')
