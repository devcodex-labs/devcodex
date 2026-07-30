#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { buildBundle } = require('./lib/control-content-source')
const { validateMarkdownStructure } = require('./lib/markdown-structure')

const ROOT = path.resolve(__dirname, '..')
const valid = '| A | B |\n|---|---|\n| 1 | 2 |\n\n```text\n| not | a table |\n```'
assert.deepStrictEqual(validateMarkdownStructure(valid, 'valid.md'), [])
assert.ok(validateMarkdownStructure('| A | B |\nprose\n| 1 | 2 |', 'orphan.md').some(error => error.includes('missing header separator')))
assert.ok(validateMarkdownStructure('| A | B |\n|---|---|\n| 1 |', 'width.md').some(error => error.includes('column count')))
assert.ok(validateMarkdownStructure('```text\nopen', 'fence.md').some(error => error.includes('unclosed code fence')))
assert.ok(validateMarkdownStructure('```\nplain\n```', 'language.md').some(error => error.includes('missing language tag')))

function collectMarkdownFiles(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir)
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) return collectMarkdownFiles(relative)
    return entry.isFile() && entry.name.endsWith('.md') ? [relative.replace(/\\/g, '/')] : []
  })
}

const staticConsumers = collectMarkdownFiles('agents').map(file => ({
  file,
  content: fs.readFileSync(path.join(ROOT, file), 'utf8')
}))
const controlConsumers = buildBundle(ROOT).files
  .filter(file => file.relative.endsWith('.md') && file.relative !== 'instructions.md')
  .map(file => ({ file: `content/${file.relative}`, content: String(file.content) }))
const consumers = [...staticConsumers, ...controlConsumers].sort((left, right) =>
  left.file.localeCompare(right.file)
)
const errors = consumers.flatMap(({ file, content }) => validateMarkdownStructure(content, file))
assert.deepStrictEqual(errors, [])

for (const { file, content } of controlConsumers.filter(entry => entry.file.endsWith('/SKILL.md'))) {
  const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
  assert.ok(description.length > 0 && Array.from(description).length <= 250, `${file} description must contain 1..250 characters`)
}

const planReview = fs.readFileSync(path.join(ROOT, 'content/skills/dev-plan-review/SKILL.md'), 'utf8')
for (const required of ['BlockerSnapshot', '安全独立检查', 'invalid-premise', 'destructive-side-effect', 'evidence-contamination']) {
  assert.ok(planReview.includes(required), `plan review must define aggregate blocker contract: ${required}`)
}
for (const forbidden of ['任一 🔴 项阻断后**立即停止后续检查**', '任一 🔴 项未通过 → **立即停止后续检查**']) {
  assert.ok(!planReview.includes(forbidden), `plan review must not restore first-red short circuit: ${forbidden}`)
}

console.log(`✓ markdown structure and plan-review aggregation contracts passed for ${consumers.length} normative files`)
