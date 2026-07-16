#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { createCliCommandRegistry, runCliCommand } = require('./lib/cli-command-registry')

const calls = []
const handlers = Object.fromEntries([
  'cmdInit', 'cmdInitClaude', 'cmdInitCodex', 'cmdStatus',
  'cmdProfileInit', 'cmdDoctor', 'cmdProbe', 'cmdTrace', 'cmdHelp'
].map(name => [name, argv => calls.push([name, argv])]))
const registry = createCliCommandRegistry(handlers)
const fakeProcess = { exitCode: 0 }
const c = { red: value => value, dim: value => value }
const logger = { log: () => {} }
const migrate = argv => calls.push(['migrate', argv])

assert.strictEqual(runCliCommand({ cmd: 'init', argv: ['--codex', '--dry-run'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'init')
assert.deepStrictEqual(calls.pop(), ['cmdInitCodex', ['--dry-run']])
assert.strictEqual(runCliCommand({ cmd: 'update', argv: ['--claude'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'update')
assert.deepStrictEqual(calls.pop(), ['cmdInitClaude', ['--force']])
assert.strictEqual(runCliCommand({ cmd: 'profile', argv: ['init', '--prod'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'profile-init')
assert.deepStrictEqual(calls.pop(), ['cmdProfileInit', ['--prod']])
assert.strictEqual(runCliCommand({ cmd: 'profile', argv: ['plan', '--tier', 'profile-standard'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'profile-plan')
assert.deepStrictEqual(calls.pop(), ['cmdProfileInit', ['--tier', 'profile-standard', '--dry-run']])
assert.strictEqual(runCliCommand({ cmd: 'migrate-layout', argv: ['plan'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'migrate-layout')
assert.deepStrictEqual(calls.pop(), ['migrate', ['plan']])
assert.strictEqual(runCliCommand({ cmd: 'status', argv: ['--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'status')
assert.deepStrictEqual(calls.pop(), ['cmdStatus', ['--json']])
assert.strictEqual(runCliCommand({ cmd: 'doctor', argv: ['--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'doctor')
assert.deepStrictEqual(calls.pop(), ['cmdDoctor', ['--json']])
assert.strictEqual(runCliCommand({ cmd: 'probe', argv: ['profile', '--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'probe')
assert.deepStrictEqual(calls.pop(), ['cmdProbe', ['profile', '--json']])
assert.strictEqual(runCliCommand({ cmd: 'trace', argv: ['show', '--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'trace')
assert.deepStrictEqual(calls.pop(), ['cmdTrace', ['show', '--json']])
assert.strictEqual(runCliCommand({ cmd: 'unknown', argv: [], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'help')
assert.deepStrictEqual(calls.pop(), ['cmdHelp', undefined])
assert.strictEqual(runCliCommand({ cmd: 'init', argv: ['--claude', '--codex'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'invalid-adapter-target')
assert.strictEqual(fakeProcess.exitCode, 1)
assert.throws(() => createCliCommandRegistry({}), /missing CLI command handler/)

console.log('✓ CLI command registry routing and negative fixtures passed')
