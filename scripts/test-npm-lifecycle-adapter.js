#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  GLOBAL_INTERNAL_ACTION,
  classifyNpmLifecycleInstall,
  runPostinstall
} = require('./lib/npm-lifecycle-adapter')

const root = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-npm-lifecycle-'))

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function fixturePackageRoot(label, { source = false } = {}) {
  const dir = mkdirp(path.join(tmp, label, 'node_modules', '@vextjs', 'devcodex'))
  writeJson(path.join(dir, 'package.json'), { name: '@vextjs/devcodex', version: '0.0.0-test' })
  fs.writeFileSync(path.join(dir, 'index.js'), '#!/usr/bin/env node\n', 'utf8')
  if (source) mkdirp(path.join(dir, '.git'))
  return dir
}

function fixtureWorkspace(label, pkg) {
  const dir = mkdirp(path.join(tmp, label))
  writeJson(path.join(dir, 'package.json'), pkg)
  return dir
}

function writePackageLockRootDependency(dir, dependencyName) {
  writeJson(path.join(dir, 'package-lock.json'), {
    name: 'consumer',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'consumer',
        version: '1.0.0',
        dependencies: {
          [dependencyName]: 'file:../pkg.tgz'
        }
      }
    }
  })
}

const packagedRoot = fixturePackageRoot('packaged')
const sourceRoot = fixturePackageRoot('source', { source: true })
const workspace = fixtureWorkspace('workspace', {
  name: 'consumer',
  dependencies: { '@vextjs/devcodex': 'file:../pkg.tgz' }
})
const aliasWorkspace = fixtureWorkspace('alias-workspace', {
  name: 'consumer-alias',
  devDependencies: { devcodex: 'file:../pkg.tgz' }
})
const firstInstallWorkspace = fixtureWorkspace('first-install', {
  name: 'consumer-first-install',
  version: '1.0.0',
  private: true
})
writePackageLockRootDependency(firstInstallWorkspace, '@vextjs/devcodex')
const transitiveWorkspace = fixtureWorkspace('transitive', {
  name: 'consumer-transitive',
  dependencies: { other: '1.0.0' }
})

function classify(env, cwd = workspace, packageRoot = packagedRoot) {
  return classifyNpmLifecycleInstall({ env: { npm_lifecycle_event: 'postinstall', ...env }, cwd, packageRoot })
}

assert.strictEqual(classify({}, workspace, sourceRoot).reason, 'source-checkout')
assert.strictEqual(classify({ CI: 'true' }).reason, 'ci')
assert.strictEqual(classify({ DEVCODEX_SKIP_POSTINSTALL: '1' }).reason, 'skip-env')
assert.strictEqual(classify({ DEVCODEX_POSTINSTALL_CHILD: '1' }).reason, 'child-process')
assert.strictEqual(classify({}, transitiveWorkspace).reason, 'transitive-or-indirect')

const workspaceDecision = classify({ INIT_CWD: workspace })
assert.strictEqual(workspaceDecision.action, 'noop')
assert.strictEqual(workspaceDecision.scope, 'workspace-install')
assert.strictEqual(workspaceDecision.reason, 'workspace-install-global-required')
assert.ok(workspaceDecision.guidance.includes('npm install -g devcodex'))

const aliasDecision = classify({ INIT_CWD: aliasWorkspace })
assert.strictEqual(aliasDecision.action, 'noop')
assert.strictEqual(aliasDecision.scope, 'workspace-install')

const firstInstallDecision = classify({ INIT_CWD: firstInstallWorkspace })
assert.strictEqual(firstInstallDecision.action, 'noop')
assert.strictEqual(firstInstallDecision.scope, 'workspace-install')
assert.strictEqual(firstInstallDecision.reason, 'workspace-install-global-required')

const globalDecision = classify({ npm_config_global: 'true', INIT_CWD: workspace })
assert.strictEqual(globalDecision.action, 'execute')
assert.strictEqual(globalDecision.scope, 'global-install')
assert.strictEqual(globalDecision.targetRoot, null)
assert.strictEqual(globalDecision.command.internal, GLOBAL_INTERNAL_ACTION)

let calls = []
let grokSyncCalls = []
const planned = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_POSTINSTALL_DRY_RUN: '1', INIT_CWD: workspace },
  cwd: workspace,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: call => calls.push(call)
})
assert.strictEqual(planned.status, 'planned')
assert.strictEqual(calls.length, 0, 'dry-run must not apply global config')

const executed = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', INIT_CWD: workspace },
  cwd: workspace,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: call => {
    calls.push(call)
    return {
      schemaVersion: 'GlobalOnlyHostConfigModeV1',
      planDigest: 'fixture',
      targets: [{ host: 'codex' }, { host: 'grok', files: { plugin: path.join(tmp, 'grok-plugin') } }],
      workspaceHostDirectoriesWritten: false,
      transaction: {
        status: 'committed',
        changed: 2,
        hosts: [
          { host: 'codex', status: 'committed', changed: 1 },
          { host: 'grok', status: 'committed', changed: 1 }
        ]
      }
    }
  },
  syncGrokPluginInstallation: call => {
    grokSyncCalls.push(call)
    return { schemaVersion: 'GrokPluginInstallationReceiptV1', status: 'verified' }
  }
})
assert.strictEqual(executed.status, 'executed')
assert.strictEqual(path.resolve(calls.at(-1).packageRoot), path.resolve(packagedRoot))
assert.strictEqual(executed.globalHostConfig.workspaceHostDirectoriesWritten, false)
assert.strictEqual(executed.globalHostConfig.transactionStatus, 'committed')
assert.deepStrictEqual(executed.globalHostConfig.hosts, ['codex', 'grok'])
assert.deepStrictEqual(executed.globalHostConfig.hostResults, [
  { host: 'codex', status: 'committed', changed: 1, errorCode: null },
  { host: 'grok', status: 'committed', changed: 1, errorCode: null }
])
assert.strictEqual(grokSyncCalls.length, 1)
assert.strictEqual(executed.globalHostConfig.integrations.grok.status, 'verified')

const partial = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', INIT_CWD: workspace },
  cwd: workspace,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: () => ({
    schemaVersion: 'GlobalOnlyHostConfigModeV1',
    planDigest: 'partial-fixture',
    targets: [{ host: 'codex' }, { host: 'claude' }],
    workspaceHostDirectoriesWritten: false,
    transaction: {
      status: 'partial',
      changed: 1,
      hosts: [
        { host: 'codex', status: 'committed', changed: 1 },
        { host: 'claude', status: 'rolled-back', changed: 1, errorCode: 'FIXTURE_FAILURE' }
      ]
    }
  })
})
assert.strictEqual(partial.status, 'failed-soft')
assert.strictEqual(partial.errorCode, 'GLOBAL_HOST_CONFIG_PARTIAL')
assert.strictEqual(partial.globalHostConfig.transactionStatus, 'partial')
assert.strictEqual(partial.globalHostConfig.hostResults[1].errorCode, 'FIXTURE_FAILURE')

const grokFailed = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', INIT_CWD: workspace },
  cwd: workspace,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: () => ({
    schemaVersion: 'GlobalOnlyHostConfigModeV1',
    planDigest: 'grok-failure-fixture',
    targets: [{ host: 'grok', files: { plugin: path.join(tmp, 'grok-plugin') } }],
    workspaceHostDirectoriesWritten: false,
    transaction: {
      status: 'committed',
      changed: 1,
      hosts: [{ host: 'grok', status: 'committed', changed: 1 }]
    }
  }),
  syncGrokPluginInstallation: () => {
    const error = new Error('fixture Grok registration failure')
    error.code = 'GROK_FIXTURE_FAILURE'
    throw error
  }
})
assert.strictEqual(grokFailed.status, 'failed-soft')
assert.strictEqual(grokFailed.errorCode, 'GROK_FIXTURE_FAILURE')
assert.strictEqual(grokFailed.globalHostConfig.hostResults[0].status, 'committed')
assert.strictEqual(grokFailed.globalHostConfig.integrations.grok.status, 'failed')

const failedSoft = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', INIT_CWD: workspace },
  cwd: workspace,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: () => { throw new Error('fixture failure') }
})
assert.strictEqual(failedSoft.status, 'failed-soft')
assert.strictEqual(failedSoft.exitCode, 1)

assert.throws(
  () => runPostinstall({
    env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_POSTINSTALL_STRICT: '1', INIT_CWD: workspace },
    cwd: workspace,
    packageRoot: packagedRoot,
    applyGlobalHostConfig: () => { throw new Error('fixture failure') }
  }),
  /DEVCODEX_POSTINSTALL_FAILED/
)

const workspacePostinstall = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', INIT_CWD: workspace },
  cwd: packagedRoot,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: () => { throw new Error('must not run') }
})
assert.strictEqual(workspacePostinstall.status, 'skipped')
assert.strictEqual(workspacePostinstall.reason, 'workspace-install-global-required')

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const postinstallSource = fs.readFileSync(path.join(root, 'scripts', 'postinstall.js'), 'utf8')
assert.ok(postinstallSource.includes('global postinstall incomplete'))
assert.ok(postinstallSource.includes('npm update -g devcodex'))
assert.strictEqual(pkg.scripts.postinstall, 'node scripts/postinstall.js')
for (const expected of [
  'scripts/postinstall.js',
  'scripts/lib/npm-lifecycle-adapter.js',
  'scripts/test-npm-lifecycle-adapter.js',
  'scripts/lib/global-host-config.js',
  'scripts/test-global-host-config.js',
  'scripts/test-global-install-smoke.js'
]) {
  assert(pkg.files.includes(expected), `package files missing ${expected}`)
}
for (const forbidden of ['global init', 'init --global', 'sync --global', 'runtime start', 'runtime stop', 'runtime restart']) {
  assert(!JSON.stringify(pkg.scripts).includes(forbidden), `forbidden first-batch command leaked: ${forbidden}`)
}

console.log('npm lifecycle adapter tests passed global=internal workspace=noop noops=source/ci/skip/transitive dryRun=planned strict=verified')
