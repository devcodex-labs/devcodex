#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { buildModularityControlChecks } = require('./lib/validate-modularity-controls')

const ROOT = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')
const lines = file => read(file).split(/\r?\n/).length

for (const [file, maximum] of [
  ['scripts/validate.js', 350],
  ['scripts/test-spec-governance.js', 150],
  ['index.js', 450],
  ['scripts/lib/validate-governance-tail.js', 100]
]) assert(lines(file) <= maximum, `${file} exceeds ${maximum} lines`)

const validator = read('scripts/validate.js')
assert(validator.includes('createProbeRegistry'))
assert(validator.includes('expectedProbeIds'))
assert(!/\ncheckV\d+\(\)/.test(validator), 'handwritten validator call chain returned')

const specRunner = read('scripts/test-spec-governance.js')
for (const suite of ['Base', 'Review', 'Expert', 'Scale']) {
  assert(specRunner.includes(`runSpecGovernance${suite}Suite`), `missing ${suite} suite runner`)
}
assert(specRunner.includes('runReworkTrustControlSuite'), 'missing rework trust control suite runner')
assert(validator.includes('buildConsumerEvolutionControlChecks'), 'missing V95 consumer evolution validator owner')

const cli = read('index.js')
for (const contract of ['buildCliInstallCommands', 'buildCliMaintenanceCommands', 'createCliCommandRegistry', 'runCliCommand']) {
  assert(cli.includes(contract), `missing CLI composition contract ${contract}`)
}

const modularityErrors = []
const { checkV93 } = buildModularityControlChecks({
  ROOT,
  fs,
  path,
  read: file => fs.readFileSync(file, 'utf8'),
  err: message => modularityErrors.push(message),
  console: { log: () => {} }
})
checkV93()
assert.deepStrictEqual(modularityErrors, [], `V93 errors: ${modularityErrors.join(' | ')}`)

console.log('✓ control-plane entry module contracts passed')
