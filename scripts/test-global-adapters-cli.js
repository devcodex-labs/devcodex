#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  describeGlobalAdapterRefresh,
  isDevCodexSourceCheckout
} = require('./lib/global-adapter-refresh-guidance')
const { buildHandler } = require('./lib/global-adapters-cli')

const ROOT = path.join(__dirname, '..')
assert.strictEqual(isDevCodexSourceCheckout(ROOT), true)

const sourceGuidance = describeGlobalAdapterRefresh({
  sourceCheckout: true,
  packageVersion: '1.15.3'
})
assert.strictEqual(sourceGuidance.primary, 'devcodex global-adapters apply')
assert.match(sourceGuidance.secondary, /npm install -g \./)

const publishedGuidance = describeGlobalAdapterRefresh({ sourceCheckout: false })
assert.strictEqual(publishedGuidance.primary, 'npm update -g devcodex')

const logs = []
const logger = {
  log: (...args) => logs.push(args.join(' '))
}
const fakeProcess = { exitCode: 0, env: process.env }
const { cmdGlobalAdapters } = buildHandler({
  packageRoot: ROOT,
  process: fakeProcess,
  console: logger,
  packageJson: require('../package.json')
})

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-adapters-'))
try {
  fakeProcess.exitCode = 0
  const dry = cmdGlobalAdapters(['apply', '--dry-run', '--json', '--home', home])
  assert.strictEqual(dry.ok, true, JSON.stringify(dry))
  assert.strictEqual(dry.payload.sourceKind, 'source-checkout-live')
  assert.strictEqual(dry.payload.sourceCheckout, true)
  assert.strictEqual(dry.payload.workspaceHostDirectoriesWritten, false)
  assert.ok(Array.isArray(dry.payload.hosts) && dry.payload.hosts.length >= 5)
  assert.ok(['planned', 'committed'].includes(dry.payload.transactionStatus))
  assert.strictEqual(fakeProcess.exitCode, 0)

  fakeProcess.exitCode = 0
  const bad = cmdGlobalAdapters(['nope', '--json'])
  assert.strictEqual(bad.ok, false)
  assert.strictEqual(bad.errorCode, 'CLI_GLOBAL_ADAPTERS_UNKNOWN_SUBCOMMAND')
  assert.strictEqual(fakeProcess.exitCode, 2)

  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'not-devcodex-'))
  fs.writeFileSync(path.join(otherRoot, 'package.json'), JSON.stringify({ name: 'other' }, null, 2))
  const { cmdGlobalAdapters: badRootCmd } = buildHandler({
    packageRoot: otherRoot,
    process: fakeProcess,
    console: logger,
    packageJson: { name: 'other', version: '0.0.0' }
  })
  fakeProcess.exitCode = 0
  const invalid = badRootCmd(['apply', '--json', '--home', home])
  assert.strictEqual(invalid.ok, false)
  assert.strictEqual(invalid.errorCode, 'GLOBAL_ADAPTERS_PACKAGE_ROOT_INVALID')
  assert.strictEqual(fakeProcess.exitCode, 2)
} finally {
  fs.rmSync(home, { recursive: true, force: true })
}

console.log('test-global-adapters-cli: PASS')
