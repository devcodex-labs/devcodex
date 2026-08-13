#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  LocalProbeContractError,
  createLocalProbeRegistry,
  runLocalProbes
} = require('./lib/local-probe.js')

const FIXED_TIME = Date.parse('2026-07-16T08:00:00.000Z')
const registry = createLocalProbeRegistry([
  { id: 'base', owner: 'test-owner', description: 'base', dependencies: [], run: () => ({ evidence: { ready: true } }) },
  { id: 'child', owner: 'test-owner', description: 'child', dependencies: ['base'], run: () => ({ evidence: { child: true } }) }
])
const successful = runLocalProbes(registry, { ids: ['child'], clock: () => FIXED_TIME })
assert.deepStrictEqual(successful.executed, ['base', 'child'])
assert.deepStrictEqual(successful.results.map(result => result.status), ['pass', 'pass'])
assert.ok(successful.results.every(result => result.schemaVersion === 'LocalProbeResultV1'))

let blockedExecuted = false
const failingRegistry = createLocalProbeRegistry([
  { id: 'fail', owner: 'test-owner', description: 'fail', dependencies: [], run: () => { throw new Error('fixture failure') } },
  { id: 'blocked', owner: 'test-owner', description: 'blocked', dependencies: ['fail'], run: () => { blockedExecuted = true } }
])
const failed = runLocalProbes(failingRegistry, { ids: ['blocked'], clock: () => FIXED_TIME })
assert.deepStrictEqual(failed.results.map(result => [result.id, result.status, result.errorCode]), [
  ['fail', 'fail', 'PROBE_EXECUTION_FAILED'],
  ['blocked', 'skipped', 'PROBE_DEPENDENCY_FAILED']
])
assert.strictEqual(blockedExecuted, false, 'dependency failure must prevent dependent execution')

assert.throws(
  () => runLocalProbes(registry, { ids: ['missing'] }),
  error => error instanceof LocalProbeContractError && error.code === 'PROBE_UNKNOWN'
)
assert.throws(() => createLocalProbeRegistry([
  { id: 'one', owner: 'test-owner', description: 'one', dependencies: ['two'], run: () => ({}) }
]), /missing dependency/)
assert.throws(() => createLocalProbeRegistry([
  { id: 'one', owner: 'test-owner', description: 'one', dependencies: ['two'], run: () => ({}) },
  { id: 'two', owner: 'test-owner', description: 'two', dependencies: ['one'], run: () => ({}) }
]), /dependency cycle/)

const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'index.js')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-local-probe-'))
let tempCleaned = false
function cleanupTempFixture() {
  if (tempCleaned) return
  fs.rmSync(tempRoot, { recursive: true, force: true })
  tempCleaned = true
}
process.once('exit', cleanupTempFixture)
fs.writeFileSync(path.join(tempRoot, 'marker.txt'), 'zero-write\n')

function treeDigest(root) {
  const hash = crypto.createHash('sha256')
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name)
      const relative = path.relative(root, full).replace(/\\/g, '/')
      hash.update(relative)
      if (entry.isDirectory()) visit(full)
      else hash.update(fs.readFileSync(full))
    }
  }
  visit(root)
  return hash.digest('hex')
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: tempRoot, encoding: 'utf8' })
}

const before = treeDigest(tempRoot)
const passingCli = runCli(['probe', 'workspace', 'host', '--json'])
assert.strictEqual(passingCli.status, 0, passingCli.stderr || passingCli.stdout)
const passingEnvelope = JSON.parse(passingCli.stdout)
assert.strictEqual(passingEnvelope.schemaVersion, 'DevCodexCliEnvelopeV1')
assert.strictEqual(passingEnvelope.ok, true)
assert.strictEqual(passingEnvelope.payload.schemaVersion, 'LocalProbeRunV1')
assert.deepStrictEqual(passingEnvelope.payload.results.map(result => result.status), ['pass', 'pass'])
assert.strictEqual(treeDigest(tempRoot), before, 'local probe CLI must not mutate the inspected workspace')

const missingProfile = runCli(['probe', 'profile', '--json'])
assert.strictEqual(missingProfile.status, 1, missingProfile.stderr || missingProfile.stdout)
const missingProfileEnvelope = JSON.parse(missingProfile.stdout)
assert.strictEqual(missingProfileEnvelope.errorCode, 'PROBE_EXECUTION_FAILED')
assert.deepStrictEqual(missingProfileEnvelope.details.results.map(result => result.status), ['pass', 'fail'])

const unknown = runCli(['probe', 'missing', '--json'])
assert.strictEqual(unknown.status, 2)
assert.strictEqual(JSON.parse(unknown.stdout).errorCode, 'PROBE_UNKNOWN')
const invalidOption = runCli(['probe', '--bad', '--json'])
assert.strictEqual(invalidOption.status, 2)
assert.strictEqual(JSON.parse(invalidOption.stdout).errorCode, 'CLI_INVALID_OPTION')
const human = runCli(['probe', 'workspace'])
assert.strictEqual(human.status, 0)
assert.match(human.stdout, /DevCodex local probes/)
assert.doesNotMatch(human.stdout, /DevCodexCliEnvelopeV1/)
assert.strictEqual(treeDigest(tempRoot), before, 'human probe mode must also remain zero-write')

cleanupTempFixture()
assert.strictEqual(fs.existsSync(tempRoot), false, 'local probe temporary fixture must be removed before success')
console.log('✓ local probe descriptor, dependency, error, CLI, zero-write and temp-cleanup fixtures passed')
