#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const { buildTurnLivenessControlChecks } = require('./lib/validate-turn-liveness-controls')

const root = path.resolve(__dirname, '..')
const errors = []
const checks = buildTurnLivenessControlChecks({
  ROOT: root,
  ACTIVE_DEVCODEX_ROOT: path.join(root, '.nonexistent-active-root'),
  fs,
  path,
  read: file => fs.readFileSync(file, 'utf8'),
  err: message => errors.push(message),
  console: { log() {} }
})
checks.checkV98()
assert.deepStrictEqual(errors, [], 'clean checkout Turn Liveness consumers must remain complete')

const fixture = path.join(root, 'scripts', 'fixtures', 'turn-liveness', 'stalled-lifecycle-state.json')
const sidecar = path.join(root, 'scripts', 'check-turn-liveness.js')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const beforeHash = hash(fixture)
const run = childProcess.spawnSync(process.execPath, [sidecar, '--state', fixture, '--json'], {
  cwd: root,
  encoding: 'utf8'
})
assert.strictEqual(run.status, 0, run.stderr || run.stdout)
const observation = JSON.parse(run.stdout)
assert.strictEqual(observation.sidecarMode, 'gray-read-only-one-shot')
assert.strictEqual(observation.evidenceMode, 'sidecar-observed')
assert.strictEqual(observation.classification.state, 'stalled-recoverable')
assert.strictEqual(observation.capabilityBoundary.readOnly, true)
assert.strictEqual(observation.capabilityBoundary.processControl, false)
assert.strictEqual(hash(fixture), beforeHash, 'zero-write sidecar must not mutate the observed state file')

const sidecarSource = fs.readFileSync(sidecar, 'utf8')
for (const forbidden of ['writeFileSync(', 'appendFileSync(', 'unlinkSync(', 'rmSync(', 'setInterval(', 'fs.watch(', 'child_process', '.kill(']) {
  assert.ok(!sidecarSource.includes(forbidden), `gray sidecar contains forbidden capability: ${forbidden}`)
}

process.stdout.write('✓ turn liveness consumer, gray sidecar zero-write and clean-checkout fixtures passed\n')
