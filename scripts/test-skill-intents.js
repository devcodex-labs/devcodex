#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  validateSkillIntent
} = require('../hooks/_runtime/progressive-skill-route-contract.cjs')
const {
  parseFrontmatter
} = require('./lib/skill-portfolio-utils')
const {
  buildSkillIntent,
  intentPath,
  loadActiveSkills,
  processSkillIntents,
  resolveSkillRoot,
  serializeIntent
} = require('./generate-skill-intents')

const ROOT = path.resolve(__dirname, '..')
const activeSkills = loadActiveSkills()

assert.deepStrictEqual(
  parseFrontmatter('---\nname: folded\ndescription: >\n  First line.\n  Second line.\n---\n', 'fallback'),
  { name: 'folded', description: 'First line.\nSecond line.' }
)
assert.deepStrictEqual(
  parseFrontmatter('---\nname: literal\ndescription: |\n  Literal line.\n---\n', 'fallback'),
  { name: 'literal', description: 'Literal line.' }
)
assert.deepStrictEqual(
  parseFrontmatter('---\nname: inline\ndescription: "Inline description."\n---\n', 'fallback'),
  { name: 'inline', description: 'Inline description.' }
)
assert.deepStrictEqual(
  parseFrontmatter('# no frontmatter\n', 'fallback'),
  { name: 'fallback', description: '' }
)

const semanticFallback = buildSkillIntent({
  id: 'semantic-fallback',
  name: 'semantic-fallback',
  description: '>',
  skillIndex: { triggers: { terms: [] } }
})
assert.strictEqual(semanticFallback.summary, 'Use for semantic-fallback domain work.')
assert.strictEqual(semanticFallback.intents[0].label, 'semantic-fallback')
assert.strictEqual(validateSkillIntent({
  ...semanticFallback,
  summary: '>'
}, { skillId: 'semantic-fallback' }).ok, false)
assert.strictEqual(validateSkillIntent({
  ...semanticFallback,
  intents: [{ ...semanticFallback.intents[0], label: '|' }]
}, { skillId: 'semantic-fallback' }).ok, false)

assert.strictEqual(activeSkills.length, 83)
for (const skill of activeSkills) {
  const target = intentPath(skill.id)
  assert(fs.existsSync(target), `missing intent sidecar: ${skill.id}`)
  const raw = JSON.parse(fs.readFileSync(target, 'utf8'))
  const validation = validateSkillIntent(raw, { skillId: skill.id })
  assert.strictEqual(
    validation.ok,
    true,
    `invalid intent sidecar ${skill.id}: ${validation.reasonCode}`
  )
  assert.strictEqual(
    fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n'),
    serializeIntent(buildSkillIntent(skill)),
    `stale generated intent sidecar: ${skill.id}`
  )
}

const packagedLayoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-packaged-intents-'))
try {
  fs.mkdirSync(path.join(packagedLayoutRoot, 'skills'), { recursive: true })
  fs.writeFileSync(path.join(packagedLayoutRoot, 'skills', 'portfolio.json'), '{"skills":[]}\n', 'utf8')
  assert.strictEqual(resolveSkillRoot(packagedLayoutRoot), path.join(packagedLayoutRoot, 'skills'))
} finally {
  fs.rmSync(packagedLayoutRoot, { recursive: true, force: true })
}

const check = processSkillIntents()
assert.strictEqual(check.activeCount, 83)
assert.strictEqual(check.selectedCount, 83)
assert.strictEqual(check.mismatchCount, 0)
assert.strictEqual(check.written, 0)

console.log('test-skill-intents: ok')
