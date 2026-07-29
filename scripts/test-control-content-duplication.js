#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  analyzeDuplication,
  normalizeBlock,
  validateDispositions
} = require('./lib/control-content-duplication')

const ROOT = path.resolve(__dirname, '..')
assert.strictEqual(normalizeBlock('a  b\r\n\r\n\r\nc'), 'a b\n\nc')

const inventory = analyzeDuplication(ROOT)
assert(inventory.counts.exactParagraph > 0)
assert(inventory.counts.total >= inventory.counts.exactParagraph)
assert.strictEqual(new Set(inventory.candidates.map(item => item.id)).size, inventory.counts.total)

const dispositions = validateDispositions(ROOT, inventory)
assert.strictEqual(dispositions.ok, true, dispositions.errors.join('\n'))
assert.strictEqual(dispositions.assignments.length, inventory.counts.total)

console.log(
  `control content duplication tests passed candidates=${inventory.counts.total}`
)
