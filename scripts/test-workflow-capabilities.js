#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/routing/workflow-capabilities.json'), 'utf8'))
const byId = new Map(matrix.workflows.map(item => [item.id, item]))

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

const consumers = {
  'skills/routing/SKILL.md': ['workflow-capabilities.json', 'CP3 条件'],
  'skills/cp-gate/SKILL.md': ['workflow-capabilities.json', '条件触发'],
  'skills/plan/SKILL.md': ['workflow-capabilities.json', '禁止 source mutation'],
  'instructions/18-spec-radar.instructions.md': ['独立授权', '不触发任何修复动作']
}
for (const [file, needles] of Object.entries(consumers)) {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8')
  for (const needle of needles) assert.ok(content.includes(needle), `${file} missing ${needle}`)
}

console.log('✓ workflow capability matrix and read-only boundaries passed')
