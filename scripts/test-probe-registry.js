#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { createProbeRegistry, runProbeRegistry } = require('./lib/probe-registry')

function checkV1() {}
function checkV2() {}
function checkV3() {}

const registry = createProbeRegistry([
  { owner: 'core-contract', checks: [checkV3, checkV1], dependencies: { V3: ['V1'] } },
  { owner: 'quality-delivery', checks: [checkV2] }
], { expectedIds: ['V1', 'V2', 'V3'] })

assert.deepStrictEqual(registry.map(item => item.id), ['V1', 'V2', 'V3'])
assert.deepStrictEqual(
  registry.map(({ id, owner, dependencies, run }) => ({ id, owner, dependencies, run: typeof run })),
  [
    { id: 'V1', owner: 'core-contract', dependencies: [], run: 'function' },
    { id: 'V2', owner: 'quality-delivery', dependencies: [], run: 'function' },
    { id: 'V3', owner: 'core-contract', dependencies: ['V1'], run: 'function' }
  ]
)

const executed = []
function checkV4() { executed.push('V4') }
function checkV5() { executed.push('V5') }
const runnerIds = []
runProbeRegistry(createProbeRegistry([{ owner: 'runner', checks: [checkV5, checkV4] }]), {
  afterRun: descriptor => runnerIds.push(descriptor.id)
})
assert.deepStrictEqual(executed, ['V4', 'V5'])
assert.deepStrictEqual(runnerIds, ['V4', 'V5'])

const invalidCases = [
  {
    name: 'invalid afterRun callback',
    run: () => runProbeRegistry(registry, { afterRun: true }),
    pattern: /afterRun must be a function/
  },
  {
    name: 'duplicate id',
    run: () => createProbeRegistry([
      { owner: 'one', checks: [checkV1] },
      { owner: 'two', checks: [checkV1] }
    ]),
    pattern: /duplicate probe id/
  },
  {
    name: 'invalid owner',
    run: () => createProbeRegistry([{ owner: '', checks: [checkV1] }]),
    pattern: /invalid probe owner/
  },
  {
    name: 'non-function',
    run: () => createProbeRegistry([{ owner: 'one', checks: [null] }]),
    pattern: /non-function/
  },
  {
    name: 'invalid function name',
    run: () => createProbeRegistry([{ owner: 'one', checks: [function probeOne() {}] }]),
    pattern: /invalid probe function name/
  },
  {
    name: 'missing dependency',
    run: () => createProbeRegistry([{ owner: 'one', checks: [checkV1], dependencies: { V1: ['V9'] } }]),
    pattern: /missing dependency V9/
  },
  {
    name: 'self dependency',
    run: () => createProbeRegistry([{ owner: 'one', checks: [checkV1], dependencies: { V1: ['V1'] } }]),
    pattern: /cannot depend on itself/
  },
  {
    name: 'cycle',
    run: () => createProbeRegistry([{
      owner: 'one',
      checks: [checkV1, checkV2],
      dependencies: { V1: ['V2'], V2: ['V1'] }
    }]),
    pattern: /dependency cycle/
  },
  {
    name: 'expected sequence mismatch',
    run: () => createProbeRegistry([{ owner: 'one', checks: [checkV1] }], { expectedIds: ['V1', 'V2'] }),
    pattern: /do not match expected sequence/
  }
]

for (const fixture of invalidCases) assert.throws(fixture.run, fixture.pattern, fixture.name)

console.log('✓ probe registry determinism and negative fixtures passed')
