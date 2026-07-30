#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  createProjectionBundle,
  detectContentCollisions,
  parseMandatoryRules
} = require('./lib/host-instruction-projection.js')
const { readControlInstructionRoot } = require('./lib/control-content-delivery.js')

const ROOT = path.resolve(__dirname, '..')
const source = readControlInstructionRoot(ROOT)
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'host-instruction-projection.json'), 'utf8'))
const gitignoreLines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/)
const clone = value => JSON.parse(JSON.stringify(value))

const parsed = parseMandatoryRules(source)
assert.strictEqual(parsed.rules.size, 29)
assert.deepStrictEqual(parsed.duplicates, [])

const bundle = createProjectionBundle({ source, config })
assert.strictEqual(bundle.receipt.validation.valid, true, bundle.receipt.validation.errors.join(' | '))
assert.strictEqual(bundle.receipt.mode, 'kernel')
assert.strictEqual(bundle.receipt.coverage.percentage, 100)
assert.strictEqual(bundle.receipt.coverage.coveredCount, bundle.receipt.coverage.mandatoryCount)
assert.deepStrictEqual(bundle.receipt.collisions, [])
assert.strictEqual(bundle.receipt.fallback.sourceDigest, bundle.receipt.sourceDigest)

for (const [relative, content] of Object.entries(bundle.files)) {
  const target = path.join(ROOT, relative)
  assert(fs.existsSync(target), `generated output missing: ${relative}`)
  assert.strictEqual(fs.readFileSync(target, 'utf8'), content, `generated output stale: ${relative}`)
}
for (const relative of [config.outputs.sharedKernel, config.outputs.claudeWrapper]) {
  assert(
    gitignoreLines.includes(`!${relative}`),
    `generated host projection must be explicitly tracked: ${relative}`
  )
}
for (const relative of [config.outputs.sharedKernel, config.outputs.copilotKernel]) {
  const metrics = bundle.receipt.outputs[relative]
  assert(metrics.bytes <= config.budgets.kernelMaxBytes)
  assert(metrics.lines <= config.budgets.kernelMaxLines)
}
for (const relative of [config.outputs.claudeWrapper, config.outputs.geminiWrapper]) {
  assert(bundle.receipt.outputs[relative].bytes <= config.budgets.wrapperMaxBytes)
  assert(bundle.files[relative].includes('@devcodex/runtime/AGENTS.md'))
}

const missingRuleSource = source.replace(/^\| S07 \|.*\r?\n/m, '')
const missingRule = createProjectionBundle({ source: missingRuleSource, config })
assert.strictEqual(missingRule.receipt.validation.valid, false)
assert(missingRule.receipt.validation.errors.includes('mandatory-rule-missing:S07'))
assert.strictEqual(missingRule.receipt.mode, 'full-fallback')

const anchorMutationConfig = clone(config)
anchorMutationConfig.semanticGroups.find(group => group.id === 'context').projectionLines = ['- Context projection removed.']
const anchorMutation = createProjectionBundle({ source, config: anchorMutationConfig })
assert.strictEqual(anchorMutation.receipt.validation.valid, false)
assert(anchorMutation.receipt.validation.errors.some(error => error.startsWith('projection-anchor-missing:context:')))

const budgetMutationConfig = clone(config)
budgetMutationConfig.budgets.kernelMaxBytes = 128
const budgetMutation = createProjectionBundle({ source, config: budgetMutationConfig })
assert.strictEqual(budgetMutation.receipt.mode, 'full-fallback')
assert(budgetMutation.receipt.validation.errors.some(error => error.startsWith('kernel-byte-budget-exceeded:')))

assert.strictEqual(detectContentCollisions({ 'a.md': 'same', 'b.md': 'same' }).length, 1)
assert.strictEqual(detectContentCollisions({ 'a.md': 'one', 'b.md': 'two' }).length, 0)

console.log(
  `host instruction projection tests passed coverage=${bundle.receipt.coverage.percentage}% ` +
  `kernelBytes=${bundle.receipt.outputs[config.outputs.sharedKernel].bytes} ` +
  `kernelLines=${bundle.receipt.outputs[config.outputs.sharedKernel].lines}`
)
