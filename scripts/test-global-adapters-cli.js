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
const {
  EXPLICIT_HOME_PATH_OVERRIDE_KEYS,
  buildHandler
} = require('./lib/global-adapters-cli')
const { resolveGlobalHostTargets } = require('./lib/global-host-target')

const ROOT = path.join(__dirname, '..')
assert.strictEqual(isDevCodexSourceCheckout(ROOT), true)

const sourceGuidance = describeGlobalAdapterRefresh({
  sourceCheckout: true,
  packageVersion: '1.15.6'
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
  assert.ok(Array.isArray(dry.payload.hosts) && dry.payload.hosts.length >= 6)
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

  for (const emptyHomeArgs of [
    ['apply', '--dry-run', '--json', '--home='],
    ['apply', '--dry-run', '--json', '--home', '   ']
  ]) {
    fakeProcess.exitCode = 0
    const emptyHome = cmdGlobalAdapters(emptyHomeArgs)
    assert.strictEqual(emptyHome.ok, false, JSON.stringify(emptyHome))
    assert.strictEqual(emptyHome.errorCode, 'CLI_GLOBAL_ADAPTERS_BAD_ARGS')
    assert.match(emptyHome.message, /--home requires a directory path/)
    assert.strictEqual(fakeProcess.exitCode, 2)
  }

  // R-02: explicit --home is the isolation authority for all host/shared target paths.
  const isolatedHome = path.join(home, 'isolated')
  const ambientRoot = path.join(home, 'ambient-overrides')
  const ambientOverrides = Object.fromEntries(
    [...EXPLICIT_HOME_PATH_OVERRIDE_KEYS].map(key => [key, path.join(ambientRoot, key.toLowerCase())])
  )
  const scopedProcess = {
    exitCode: 0,
    env: {
      ...process.env,
      ...ambientOverrides,
      DEVCODEX_TEST_PRESERVED: 'yes'
    }
  }
  let scopedApplyOptions = null
  const plannedResult = options => {
    scopedApplyOptions = options
    const targets = resolveGlobalHostTargets({
      env: options.env,
      home: options.home,
      packageRoot: ROOT,
      runtimeGeneration: false
    })
    return {
      planDigest: 'explicit-home-scope',
      workspaceHostDirectoriesWritten: false,
      targets,
      transaction: {
        status: 'planned',
        hosts: targets.map(target => ({ host: target.host, status: 'planned', changed: 0 }))
      },
      activeRoot: null
    }
  }
  const { cmdGlobalAdapters: scopedCmd } = buildHandler({
    packageRoot: ROOT,
    process: scopedProcess,
    console: logger,
    packageJson: require('../package.json'),
    applyGlobalHostConfig: plannedResult
  })
  const scoped = scopedCmd(['apply', '--dry-run', '--json', '--home', isolatedHome])
  assert.strictEqual(scoped.ok, true, JSON.stringify(scoped))
  assert.ok(scopedApplyOptions)
  assert.strictEqual(scopedApplyOptions.home, isolatedHome)
  assert.strictEqual(scopedApplyOptions.env.DEVCODEX_TEST_PRESERVED, 'yes')
  for (const key of EXPLICIT_HOME_PATH_OVERRIDE_KEYS) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(scopedApplyOptions.env, key), false, key)
    assert.strictEqual(scopedProcess.env[key], ambientOverrides[key], `${key} ambient env mutated`)
  }
  const scopedTargets = resolveGlobalHostTargets({
    env: scopedApplyOptions.env,
    home: scopedApplyOptions.home,
    packageRoot: ROOT,
    runtimeGeneration: false
  })
  const expectedRoots = {
    copilot: path.join(isolatedHome, '.copilot'),
    claude: path.join(isolatedHome, '.claude'),
    codex: path.join(isolatedHome, '.codex'),
    gemini: path.join(isolatedHome, '.gemini'),
    grok: path.join(isolatedHome, '.grok'),
    cursor: path.join(isolatedHome, '.cursor')
  }
  for (const target of scopedTargets) {
    assert.strictEqual(target.root, path.resolve(expectedRoots[target.host]), target.host)
    assert.strictEqual(target.shared.root, path.resolve(path.join(isolatedHome, '.agents')), target.host)
  }

  // Without --home, environment overrides retain their existing target-resolution semantics.
  let ambientApplyOptions = null
  const { cmdGlobalAdapters: ambientCmd } = buildHandler({
    packageRoot: ROOT,
    process: scopedProcess,
    console: logger,
    packageJson: require('../package.json'),
    applyGlobalHostConfig: options => {
      ambientApplyOptions = options
      return {
        planDigest: 'ambient-env-scope',
        workspaceHostDirectoriesWritten: false,
        targets: [],
        transaction: { status: 'planned', hosts: [] },
        activeRoot: null
      }
    }
  })
  const ambient = ambientCmd(['apply', '--dry-run', '--json'])
  assert.strictEqual(ambient.ok, true, JSON.stringify(ambient))
  assert.ok(ambientApplyOptions)
  for (const key of EXPLICIT_HOME_PATH_OVERRIDE_KEYS) {
    assert.strictEqual(ambientApplyOptions.env[key], ambientOverrides[key], key)
  }

  // R-03: hosts committed + Grok integration failure must expose partialState
  const { cmdGlobalAdapters: partialCmd } = buildHandler({
    packageRoot: ROOT,
    process: fakeProcess,
    console: logger,
    packageJson: require('../package.json'),
    applyGlobalHostConfig: () => ({
      planDigest: 'deadbeef',
      workspaceHostDirectoriesWritten: false,
      targets: [
        { host: 'grok', root: path.join(home, '.grok'), files: { plugin: path.join(home, 'plugin') } },
        { host: 'codex', files: {} }
      ],
      transaction: {
        status: 'committed',
        hosts: [
          { host: 'grok', status: 'committed', changed: 1 },
          { host: 'codex', status: 'committed', changed: 1 }
        ]
      },
      activeRoot: null
    }),
    syncGrokWorkspacePluginInstallation: () => {
      const err = new Error('simulated grok register failure')
      err.code = 'GROK_PLUGIN_INSTALL_FAILED'
      throw err
    }
  })
  fakeProcess.exitCode = 0
  const partial = partialCmd(['apply', '--json', '--home', home])
  assert.strictEqual(partial.ok, false)
  assert.strictEqual(partial.errorCode, 'GLOBAL_ADAPTERS_HOSTS_COMMITTED_GROK_FAILED')
  assert.strictEqual(partial.details.hostsCommitted, true)
  assert.ok(partial.details.partialState)
  assert.strictEqual(partial.details.partialState.hostsTransaction, 'committed')
  assert.strictEqual(partial.details.partialState.grokIntegration, 'failed')
  assert.match(String(partial.nextStep || ''), /global-adapters apply|Grok/)
  assert.strictEqual(fakeProcess.exitCode, 1)

  // R-04: --home must scope the official Grok CLI registry through GROK_HOME.
  const ambientGrokHome = path.join(home, 'ambient-grok')
  const isolatedGrokRoot = path.join(isolatedHome, '.grok')
  const isolatedPlugin = path.join(isolatedGrokRoot, 'devcodex', 'plugins', 'devcodex-workspace')
  const isolatedProcess = {
    exitCode: 0,
    env: { ...process.env, GROK_HOME: ambientGrokHome }
  }
  let grokSyncOptions = null
  const { cmdGlobalAdapters: isolatedCmd } = buildHandler({
    packageRoot: ROOT,
    process: isolatedProcess,
    console: logger,
    packageJson: require('../package.json'),
    applyGlobalHostConfig: () => ({
      planDigest: 'isolated-home',
      workspaceHostDirectoriesWritten: false,
      targets: [
        { host: 'grok', root: isolatedGrokRoot, files: { plugin: isolatedPlugin } },
        { host: 'cursor', root: path.join(home, 'isolated', '.cursor'), files: {} }
      ],
      transaction: {
        status: 'committed',
        hosts: [
          { host: 'grok', status: 'committed', changed: 1 },
          { host: 'cursor', status: 'committed', changed: 1 }
        ]
      },
      activeRoot: null
    }),
    syncGrokWorkspacePluginInstallation: options => {
      grokSyncOptions = options
      return { status: 'installed', pluginPath: options.pluginPath }
    }
  })
  const isolated = isolatedCmd(['apply', '--json', '--home', isolatedHome])
  assert.strictEqual(isolated.ok, true, JSON.stringify(isolated))
  assert.ok(grokSyncOptions)
  assert.strictEqual(grokSyncOptions.pluginPath, isolatedPlugin)
  assert.strictEqual(grokSyncOptions.env.GROK_HOME, isolatedGrokRoot)
  assert.strictEqual(grokSyncOptions.env.GROK_CURSOR_HOOKS_ENABLED, 'false')
  assert.notStrictEqual(grokSyncOptions.env, isolatedProcess.env)
  assert.strictEqual(isolatedProcess.env.GROK_HOME, ambientGrokHome)
  assert.strictEqual(isolatedProcess.exitCode, 0)

  // R-05: a malformed committed target must fail closed instead of using ambient GROK_HOME.
  let malformedSyncCalled = false
  const malformedProcess = { exitCode: 0, env: { ...process.env, GROK_HOME: ambientGrokHome } }
  const { cmdGlobalAdapters: malformedCmd } = buildHandler({
    packageRoot: ROOT,
    process: malformedProcess,
    console: logger,
    packageJson: require('../package.json'),
    applyGlobalHostConfig: () => ({
      planDigest: 'missing-grok-root',
      workspaceHostDirectoriesWritten: false,
      targets: [{ host: 'grok', files: { plugin: isolatedPlugin } }],
      transaction: {
        status: 'committed',
        hosts: [{ host: 'grok', status: 'committed', changed: 1 }]
      },
      activeRoot: null
    }),
    syncGrokWorkspacePluginInstallation: () => {
      malformedSyncCalled = true
      return { status: 'installed' }
    }
  })
  const malformed = malformedCmd(['apply', '--json', '--home', isolatedHome])
  assert.strictEqual(malformed.ok, false)
  assert.strictEqual(malformed.errorCode, 'GLOBAL_ADAPTERS_HOSTS_COMMITTED_GROK_FAILED')
  assert.strictEqual(malformed.details.integrations.grok.errorCode, 'GLOBAL_ADAPTERS_GROK_TARGET_ROOT_MISSING')
  assert.strictEqual(malformedSyncCalled, false)
  assert.strictEqual(malformedProcess.env.GROK_HOME, ambientGrokHome)
  assert.strictEqual(malformedProcess.exitCode, 1)
} finally {
  fs.rmSync(home, { recursive: true, force: true })
}

console.log('test-global-adapters-cli: PASS')
