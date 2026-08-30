#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildBundle,
  inventory,
  materialize,
  renderContent
} = require('./lib/control-content-source')

const ROOT = path.resolve(__dirname, '..')

function write (root, relative, content) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}

function fixtureRoot () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-control-content-'))
  write(root, 'content/manifest.json', JSON.stringify({
    schemaVersion: 'ControlContentManifestV1',
    sourceRoot: 'content',
    expectedMarkdownEntries: 1,
    mirrors: []
  }))
  return root
}

const sourceInventory = inventory(ROOT)
assert.strictEqual(sourceInventory.actual, 136)
assert.deepStrictEqual(
  sourceInventory.entries.reduce((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] || 0) + 1
    return counts
  }, {}),
  { 'instruction-root': 1, instruction: 18, prompt: 31, skill: 86 }
)

const repoBundle = buildBundle(ROOT, { mode: 'check' })
assert.strictEqual(repoBundle.receipt.entryCount, 136)
assert.ok(
  repoBundle.receipt.fresh || repoBundle.receipt.stale.length === 136,
  repoBundle.receipt.stale.join(', ')
)
assert.strictEqual(repoBundle.receipt.mirrorCount, 1)

const root = fixtureRoot()
write(root, 'content/instructions.md', 'before\n<!-- devcodex:include shared/example.md -->\nafter\n')
write(root, 'content/shared/example.md', 'shared\n')
write(root, 'instructions.md', 'stale\n')
assert.throws(() => buildBundle(root), /at least two consumers/)

write(root, 'content/instructions/second.md', '<!-- devcodex:include shared/example.md -->\n')
const manifestPath = path.join(root, 'content/manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.expectedMarkdownEntries = 2
fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')
const receipt = materialize(root)
assert.strictEqual(receipt.fresh, true)
assert.strictEqual(fs.readFileSync(path.join(root, 'instructions.md'), 'utf8'), 'before\nshared\nafter\n')
assert.strictEqual(fs.readFileSync(path.join(root, 'instructions/second.md'), 'utf8'), 'shared\n')

write(root, 'content/shared/eol.md', 'first\nsecond')
assert.strictEqual(
  renderContent('<!-- devcodex:include shared/eol.md -->\r\n', {
    sourceRoot: path.join(root, 'content')
  }).content,
  'first\r\nsecond\r\n'
)

assert.throws(
  () => renderContent('<!-- devcodex:include shared/../secret.md -->\n', {
    sourceRoot: path.join(root, 'content')
  }),
  /invalid include directive|unsafe include path/
)
write(root, 'content/shared/nested.md', '<!-- devcodex:include shared/example.md -->\n')
assert.throws(
  () => renderContent('<!-- devcodex:include shared/nested.md -->\n', {
    sourceRoot: path.join(root, 'content')
  }),
  /nested include forbidden/
)

fs.rmSync(root, { recursive: true, force: true })
console.log('control content source tests passed')
