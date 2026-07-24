#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { createCliCommandRegistry, parseHostSelection, runCliCommand } = require('./lib/cli-command-registry')

const calls = []
const handlers = Object.fromEntries([
  'cmdGrok', 'cmdStatus',
  'cmdProfileInit', 'cmdDoctor', 'cmdProbe', 'cmdTrace', 'cmdSkill', 'cmdTask', 'cmdHelp'
].map(name => [name, argv => calls.push([name, argv])]))
handlers.cmdInitWorkspaceRuntime = (argv, opts) => calls.push(['cmdInitWorkspaceRuntime', argv, opts])
handlers.cmdInitHost = (host, argv) => calls.push(['cmdInitHost', host, argv])
handlers.cmdUninstallHost = (host, argv) => calls.push(['cmdUninstallHost', host, argv])
const registry = createCliCommandRegistry(handlers)
const fakeProcess = { exitCode: 0 }
const c = { red: value => value, dim: value => value }
const logs = []
const logger = { log: (...args) => logs.push(args.join(' ')) }
const migrate = argv => calls.push(['migrate', argv])

assert.strictEqual(runCliCommand({ cmd: 'init', argv: ['--codex', '--dry-run'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_CONFIG_GLOBAL_ONLY')
assert.deepStrictEqual(calls.pop(), ['cmdInitHost', 'codex', ['--operation=init', '--dry-run']])
assert.strictEqual(runCliCommand({ cmd: 'update', argv: ['--claude'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_CONFIG_GLOBAL_ONLY')
assert.deepStrictEqual(calls.pop(), ['cmdInitHost', 'claude', ['--operation=update']])
assert.strictEqual(runCliCommand({ cmd: 'init', argv: ['--host', 'gemini', '--dry-run'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_CONFIG_GLOBAL_ONLY')
assert.deepStrictEqual(calls.pop(), ['cmdInitHost', 'gemini', ['--operation=init', '--dry-run']])
assert.strictEqual(runCliCommand({ cmd: 'update', argv: ['--grok'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_CONFIG_GLOBAL_ONLY')
assert.deepStrictEqual(calls.pop(), ['cmdInitHost', 'grok', ['--operation=update']])
assert.strictEqual(runCliCommand({ cmd: 'init', argv: [], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'init')
assert.deepStrictEqual(calls.pop(), ['cmdInitWorkspaceRuntime', [], { refresh: false }])
assert.strictEqual(runCliCommand({ cmd: 'update', argv: ['--dry-run'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'update')
assert.deepStrictEqual(calls.pop(), ['cmdInitWorkspaceRuntime', ['--dry-run'], { refresh: true }])
assert.strictEqual(runCliCommand({ cmd: 'profile', argv: ['init', '--prod'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'profile-init')
assert.deepStrictEqual(calls.pop(), ['cmdProfileInit', ['--prod']])
assert.strictEqual(runCliCommand({ cmd: 'profile', argv: ['plan', '--tier', 'profile-standard'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'profile-plan')
assert.deepStrictEqual(calls.pop(), ['cmdProfileInit', ['--tier', 'profile-standard', '--dry-run']])
assert.strictEqual(runCliCommand({ cmd: 'migrate-layout', argv: ['plan'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'migrate-layout')
assert.deepStrictEqual(calls.pop(), ['migrate', ['plan']])
assert.strictEqual(runCliCommand({ cmd: 'grok', argv: ['-p', 'check'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'grok')
assert.deepStrictEqual(calls.pop(), ['cmdGrok', ['-p', 'check']])
assert.strictEqual(runCliCommand({ cmd: 'uninstall', argv: ['--host', 'grok', '--dry-run'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_CONFIG_GLOBAL_ONLY')
assert.deepStrictEqual(calls.pop(), ['cmdUninstallHost', 'grok', ['--operation=uninstall', '--dry-run']])
assert.strictEqual(runCliCommand({ cmd: 'uninstall', argv: [], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_REQUIRED')
assert.strictEqual(fakeProcess.exitCode, 2)
assert.strictEqual(runCliCommand({ cmd: 'status', argv: ['--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'status')
assert.deepStrictEqual(calls.pop(), ['cmdStatus', ['--json']])
assert.strictEqual(runCliCommand({ cmd: 'doctor', argv: ['--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'doctor')
assert.deepStrictEqual(calls.pop(), ['cmdDoctor', ['--json']])
assert.strictEqual(runCliCommand({ cmd: 'probe', argv: ['profile', '--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'probe')
assert.deepStrictEqual(calls.pop(), ['cmdProbe', ['profile', '--json']])
assert.strictEqual(runCliCommand({ cmd: 'trace', argv: ['show', '--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'trace')
assert.deepStrictEqual(calls.pop(), ['cmdTrace', ['show', '--json']])
assert.strictEqual(runCliCommand({ cmd: 'skill', argv: ['plan', 'intent', '--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'skill')
assert.deepStrictEqual(calls.pop(), ['cmdSkill', ['plan', 'intent', '--json']])
assert.strictEqual(runCliCommand({ cmd: 'task', argv: ['resolve', 'current', '--json'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'task')
assert.deepStrictEqual(calls.pop(), ['cmdTask', ['resolve', 'current', '--json']])
fakeProcess.exitCode = 0
assert.strictEqual(runCliCommand({ cmd: undefined, argv: [], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'help')
assert.strictEqual(fakeProcess.exitCode, 0)
assert.deepStrictEqual(calls.pop(), ['cmdHelp', undefined])
assert.strictEqual(runCliCommand({ cmd: 'help', argv: [], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'help')
assert.deepStrictEqual(calls.pop(), ['cmdHelp', undefined])
logs.length = 0
assert.strictEqual(runCliCommand({ cmd: '--version', argv: [], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger, packageVersion: '1.2.3' }), 'version')
assert.strictEqual(logs.pop(), '1.2.3')
logs.length = 0
fakeProcess.exitCode = 0
assert.strictEqual(runCliCommand({ cmd: 'unknown', argv: [], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_COMMAND_UNKNOWN')
assert.strictEqual(fakeProcess.exitCode, 2)
assert.deepStrictEqual(calls.pop(), ['cmdHelp', undefined])
assert.ok(logs.some(line => line.includes('CLI_COMMAND_UNKNOWN')))
assert.strictEqual(runCliCommand({ cmd: 'init', argv: ['--claude', '--codex'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_SELECTION_CONFLICT')
assert.strictEqual(fakeProcess.exitCode, 2)
assert.strictEqual(runCliCommand({ cmd: 'init', argv: ['--host', 'unknown'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_UNSUPPORTED')
assert.strictEqual(runCliCommand({ cmd: 'init', argv: ['--host=gemini', '--gemini'], registry, runMigrateLayout: migrate, process: fakeProcess, c, console: logger }), 'CLI_HOST_SELECTION_CONFLICT')
assert.deepStrictEqual(parseHostSelection(['--host', 'all', '--dry-run']), { ok: true, host: 'all', cleanedArgv: ['--dry-run'] })
assert.strictEqual(parseHostSelection(['--host']).code, 'CLI_HOST_UNSUPPORTED')
assert.throws(() => createCliCommandRegistry({}), /missing CLI command handler/)

console.log('✓ CLI command registry routing and negative fixtures passed')
