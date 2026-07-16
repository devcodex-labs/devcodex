#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  CLI_ENVELOPE_SCHEMA_VERSION,
  createCliFailure,
  createCliSuccess,
  parseJsonArgs
} = require('./lib/cli-json-contract')

const metadata = { packageName: '@vextjs/devcodex', packageVersion: '1.14.0' }
assert.deepStrictEqual(createCliSuccess('status', { ready: true }, metadata), {
  schemaVersion: CLI_ENVELOPE_SCHEMA_VERSION,
  ok: true,
  command: 'status',
  packageName: '@vextjs/devcodex',
  packageVersion: '1.14.0',
  payload: { ready: true }
})

assert.deepStrictEqual(
  createCliFailure('doctor', 'CLI_INVALID_OPTION', 'unsupported option: --bad', 'Use: devcodex doctor [--json]', metadata, { options: ['--bad'] }),
  {
    schemaVersion: CLI_ENVELOPE_SCHEMA_VERSION,
    ok: false,
    command: 'doctor',
    packageName: '@vextjs/devcodex',
    packageVersion: '1.14.0',
    errorCode: 'CLI_INVALID_OPTION',
    message: 'unsupported option: --bad',
    nextStep: 'Use: devcodex doctor [--json]',
    details: { options: ['--bad'] }
  }
)

assert.deepStrictEqual(parseJsonArgs(['--json']), { json: true, errors: [] })
assert.deepStrictEqual(parseJsonArgs(['--bad', '--json']), { json: true, errors: ['unsupported option: --bad'] })
assert.deepStrictEqual(parseJsonArgs(null), { json: false, errors: [] })

console.log('✓ CLI JSON envelope contract and negative fixtures passed')
