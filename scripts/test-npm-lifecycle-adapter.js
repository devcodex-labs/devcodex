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
const { syncGrokWorkspacePluginInstallation } = require('./lib/host-adapter-scope')
const { resolveWorkspaceTempBackupRoot } = require('./lib/workspace-temp-layout.js')
const { readActivationReceipt } = require('./lib/devcodex-readiness.js')

const root = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-npm-lifecycle-'))
const lifecycleHome = path.join(tmp, 'lifecycle-home')
let tempCleaned = false
function cleanupTempFixture() {
  if (tempCleaned) return
  fs.rmSync(tmp, { recursive: true, force: true })
  tempCleaned = true
}
process.once('exit', cleanupTempFixture)

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function fixturePackageRoot(label, { source = false } = {}) {
  const dir = mkdirp(path.join(tmp, label, 'node_modules', 'devcodex'))
  writeJson(path.join(dir, 'package.json'), { name: 'devcodex', version: '0.0.0-test' })
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

function readRegistry(grokHome) {
  return JSON.parse(fs.readFileSync(path.join(grokHome, 'installed-plugins', 'registry.json'), 'utf8'))
}

function writeRegistry(grokHome, value) {
  const file = path.join(grokHome, 'installed-plugins', 'registry.json')
  mkdirp(path.dirname(file))
  writeJson(file, value)
}

function pluginListFromRegistry(grokHome) {
  return Object.entries(readRegistry(grokHome).repos || {}).map(([repoId, entry]) => ({
    status: 'installed',
    name: 'devcodex-workspace',
    repo_key: repoId,
    version: '1.0.0',
    path: entry.path,
    source: entry.kind.source_path,
    marketplace: null
  }))
}

function createGrokDriver(grokHome, options = {}) {
  let installCount = 0
  let failedCanonical = false
  const calls = []
  const driver = (command, args) => {
    calls.push([command, ...args])
    if (command !== 'grok') return { status: null, stdout: '', stderr: '', error: { code: 'ENOENT' } }
    if (args[0] === 'version') return { status: 0, stdout: 'grok fixture\n', stderr: '' }
    if (args[0] === 'plugin' && args[1] === 'list') {
      return { status: 0, stdout: JSON.stringify(pluginListFromRegistry(grokHome)), stderr: '' }
    }
    if (args[0] === 'plugin' && args[1] === 'uninstall') {
      const registry = readRegistry(grokHome)
      const keys = Object.keys(registry.repos || {})
      const key = options.uninstallOrder === 'last' ? keys.at(-1) : keys[0]
      if (key) delete registry.repos[key]
      writeRegistry(grokHome, registry)
      return { status: 0, stdout: 'uninstalled\n', stderr: '' }
    }
    if (args[0] === 'plugin' && args[1] === 'install') {
      const source = path.resolve(args[2])
      if (options.failCanonicalOnce && !failedCanonical && path.resolve(source) === path.resolve(options.canonical)) {
        failedCanonical = true
        if (typeof options.onCanonicalFailure === 'function') options.onCanonicalFailure()
        return { status: 1, stdout: '', stderr: 'fixture canonical install failure' }
      }
      installCount += 1
      const installedPath = path.join(grokHome, 'installed-plugins', `installed-${installCount}`)
      fs.cpSync(source, installedPath, { recursive: true })
      if (
        options.corruptCanonicalAfterInstall &&
        path.resolve(source) === path.resolve(options.canonical)
      ) {
        fs.appendFileSync(
          path.join(installedPath, 'hooks', 'devcodex-workspace.cjs'),
          '\n// fixture digest drift\n',
          'utf8'
        )
      }
      const registry = readRegistry(grokHome)
      registry.repos[`fixture-${installCount}`] = {
        kind: { type: 'Local', source_path: source },
        path: installedPath,
        plugins: { 'devcodex-workspace': { version: '1.0.0' } }
      }
      writeRegistry(grokHome, registry)
      return { status: 0, stdout: 'installed\n', stderr: '' }
    }
    return { status: 2, stdout: '', stderr: `unsupported fixture command: ${args.join(' ')}` }
  }
  driver.calls = calls
  return driver
}

function createDuplicateGrokFixture(label) {
  const fixtureRoot = mkdirp(path.join(tmp, label))
  const grokHome = mkdirp(path.join(fixtureRoot, 'home', '.grok'))
  const canonical = path.join(grokHome, 'devcodex', 'plugins', 'devcodex-workspace')
  const legacy = path.join(fixtureRoot, 'workspace', '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
  fs.cpSync(path.join(root, 'grok', 'plugins', 'devcodex-workspace'), canonical, { recursive: true })
  fs.cpSync(path.join(root, 'grok', 'plugins', 'devcodex-workspace'), legacy, { recursive: true })
  const canonicalInstalled = path.join(grokHome, 'installed-plugins', 'canonical')
  const legacyInstalled = path.join(grokHome, 'installed-plugins', 'legacy')
  fs.cpSync(canonical, canonicalInstalled, { recursive: true })
  fs.cpSync(legacy, legacyInstalled, { recursive: true })
  writeRegistry(grokHome, {
    version: 1,
    repos: {
      canonical: {
        kind: { type: 'Local', source_path: canonical },
        path: canonicalInstalled,
        plugins: { 'devcodex-workspace': { version: '1.0.0' } }
      },
      legacy: {
        kind: { type: 'Local', source_path: legacy },
        path: legacyInstalled,
        plugins: { 'devcodex-workspace': { version: '1.0.0' } }
      }
    }
  })
  fs.writeFileSync(path.join(grokHome, 'config.toml'), '[plugins]\nenabled = ["project-owned"]\n', 'utf8')
  return { fixtureRoot, grokHome, canonical, legacy }
}

const packagedRoot = fixturePackageRoot('packaged')
const sourceRoot = fixturePackageRoot('source', { source: true })
const workspace = fixtureWorkspace('workspace', {
  name: 'consumer',
  dependencies: { 'devcodex': 'file:../pkg.tgz' }
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
writePackageLockRootDependency(firstInstallWorkspace, 'devcodex')
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

// CI skip runs before globalInstall (S-a): real GHA postinstall stays no-op unless forced.
// Prevents global-install-smoke from going green locally while red under GITHUB_ACTIONS.
const ciGlobalDecision = classify({ CI: 'true', npm_config_global: 'true', INIT_CWD: workspace })
assert.strictEqual(ciGlobalDecision.action, 'noop')
assert.strictEqual(ciGlobalDecision.reason, 'ci')
assert.strictEqual(ciGlobalDecision.globalInstall, true)
const ghaGlobalDecision = classify({ GITHUB_ACTIONS: 'true', npm_config_global: 'true', INIT_CWD: workspace })
assert.strictEqual(ghaGlobalDecision.action, 'noop')
assert.strictEqual(ghaGlobalDecision.reason, 'ci')
const ciGlobalWithTestHome = classify({
  CI: 'true',
  npm_config_global: 'true',
  DEVCODEX_TEST_HOME: path.join(tmp, 'isolated-home'),
  INIT_CWD: workspace
})
assert.strictEqual(ciGlobalWithTestHome.action, 'noop', 'DEVCODEX_TEST_HOME alone must not bypass CI skip')
assert.strictEqual(ciGlobalWithTestHome.reason, 'ci')
const ciGlobalForced = classify({
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  npm_config_global: 'true',
  DEVCODEX_POSTINSTALL_FORCE: '1',
  INIT_CWD: workspace
})
assert.strictEqual(ciGlobalForced.action, 'execute')
assert.strictEqual(ciGlobalForced.reason, 'global-install-postinstall')
assert.strictEqual(ciGlobalForced.scope, 'global-install')

const sourceGlobalDecision = classify({ npm_config_global: 'true', INIT_CWD: workspace }, workspace, sourceRoot)
assert.strictEqual(sourceGlobalDecision.action, 'execute')
assert.strictEqual(sourceGlobalDecision.scope, 'global-install')
assert.strictEqual(sourceGlobalDecision.reason, 'global-install-postinstall')

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
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_POSTINSTALL_DRY_RUN: '1', DEVCODEX_TEST_HOME: lifecycleHome, INIT_CWD: workspace },
  cwd: workspace,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: call => calls.push(call)
})
assert.strictEqual(planned.status, 'planned')
assert.strictEqual(calls.length, 0, 'dry-run must not apply global config')

const executed = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_TEST_HOME: lifecycleHome, INIT_CWD: workspace },
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
  syncGrokWorkspacePluginInstallation: call => {
    grokSyncCalls.push(call)
    return { schemaVersion: 'GrokPluginRegistryConvergenceReceiptV2', status: 'verified' }
  }
})
assert.strictEqual(executed.status, 'executed')
assert.strictEqual(path.resolve(calls.at(-1).packageRoot), path.resolve(packagedRoot))
assert.strictEqual(executed.globalHostConfig.workspaceHostDirectoriesWritten, false)
assert.strictEqual(executed.globalHostConfig.transactionStatus, 'committed')
assert.strictEqual(executed.globalHostConfig.maintenanceStatus, 'complete')
assert.strictEqual(executed.globalHostConfig.maintenanceIncomplete, false)
assert.deepStrictEqual(executed.globalHostConfig.hosts, ['codex', 'grok'])
assert.deepStrictEqual(executed.globalHostConfig.hostResults, [
  { host: 'codex', status: 'committed', changed: 1, errorCode: null },
  { host: 'grok', status: 'committed', changed: 1, errorCode: null }
])
assert.strictEqual(grokSyncCalls.length, 1)
assert.strictEqual(executed.globalHostConfig.integrations.grok.status, 'verified')
assert.strictEqual(executed.persistence.status, 'PASS')
const executedActivation = readActivationReceipt({ home: lifecycleHome, env: { DEVCODEX_TEST_HOME: lifecycleHome } })
assert.strictEqual(executedActivation.status, 'PASS')
assert.strictEqual(executedActivation.value.schemaVersion, 'DevCodexActivationReceiptV1')
assert.strictEqual(executedActivation.value.lifecycle.status, 'executed')

const maintenanceWarning = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_TEST_HOME: lifecycleHome, INIT_CWD: workspace },
  cwd: workspace,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: () => ({
    schemaVersion: 'GlobalOnlyHostConfigModeV1',
    planDigest: 'maintenance-warning-fixture',
    targets: [{ host: 'codex' }],
    workspaceHostDirectoriesWritten: false,
    transaction: {
      status: 'committed',
      changed: 1,
      backupCleanupIncomplete: true,
      backupCleanupFailures: [{ host: 'codex', path: 'backup', error: 'fixture' }],
      staleCleanupIncomplete: true,
      staleCleanupFailures: [{ host: 'codex', path: 'stale', error: 'fixture' }],
      receiptFinalizationIncomplete: true,
      receiptFinalizationFailures: [{ host: 'codex', error: 'fixture' }],
      hosts: [{ host: 'codex', status: 'committed', changed: 1 }]
    }
  })
})
assert.strictEqual(maintenanceWarning.status, 'executed')
assert.strictEqual(maintenanceWarning.exitCode, 0)
assert.strictEqual(maintenanceWarning.globalHostConfig.maintenanceStatus, 'incomplete')
assert.strictEqual(maintenanceWarning.globalHostConfig.maintenanceIncomplete, true)
assert.strictEqual(maintenanceWarning.globalHostConfig.backupCleanupFailureCount, 1)
assert.strictEqual(maintenanceWarning.globalHostConfig.staleCleanupFailureCount, 1)
assert.strictEqual(maintenanceWarning.globalHostConfig.receiptFinalizationFailureCount, 1)

const partial = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_TEST_HOME: lifecycleHome, INIT_CWD: workspace },
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
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_TEST_HOME: lifecycleHome, INIT_CWD: workspace },
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
  syncGrokWorkspacePluginInstallation: () => {
    const error = new Error('fixture Grok registration failure')
    error.code = 'GROK_FIXTURE_FAILURE'
    throw error
  }
})
assert.strictEqual(grokFailed.status, 'failed-soft')
assert.strictEqual(grokFailed.errorCode, 'GROK_FIXTURE_FAILURE')
assert.strictEqual(grokFailed.globalHostConfig.hostResults[0].status, 'committed')
assert.strictEqual(grokFailed.globalHostConfig.integrations.grok.status, 'failed')

for (const uninstallOrder of ['first', 'last']) {
  const fixture = createDuplicateGrokFixture(`duplicate-${uninstallOrder}`)
  const driver = createGrokDriver(fixture.grokHome, { uninstallOrder })
  const receipt = syncGrokWorkspacePluginInstallation({
    pluginPath: fixture.canonical,
    legacyPluginPaths: [fixture.legacy],
    backupDir: path.join(fixture.fixtureRoot, 'backups'),
    env: { ...process.env, GROK_HOME: fixture.grokHome },
    spawnSync: driver
  })
  const identities = pluginListFromRegistry(fixture.grokHome)
  assert.strictEqual(receipt.schemaVersion, 'GrokPluginRegistryConvergenceReceiptV2')
  assert.strictEqual(receipt.status, 'verified')
  assert.strictEqual(receipt.refreshMode, 'official-drain-all-install')
  assert.strictEqual(identities.length, 1)
  assert.strictEqual(path.resolve(identities[0].source), path.resolve(fixture.canonical))
  assert(fs.existsSync(fixture.legacy), 'convergence must retain the legacy source')
  assert(fs.existsSync(receipt.backupRoot), 'convergence must retain recovery snapshots')
  assert.strictEqual(driver.calls.filter(call => call[1] === 'plugin' && call[2] === 'uninstall').length, 2)
}

const unknownFixture = createDuplicateGrokFixture('unknown-source')
const unknownSource = path.join(unknownFixture.fixtureRoot, 'third-party', 'devcodex-workspace')
fs.cpSync(path.join(root, 'grok', 'plugins', 'devcodex-workspace'), unknownSource, { recursive: true })
const unknownInstalled = path.join(unknownFixture.grokHome, 'installed-plugins', 'unknown')
fs.cpSync(unknownSource, unknownInstalled, { recursive: true })
const unknownRegistry = readRegistry(unknownFixture.grokHome)
unknownRegistry.repos.unknown = {
  kind: { type: 'Local', source_path: unknownSource },
  path: unknownInstalled,
  plugins: { 'devcodex-workspace': { version: '1.0.0' } }
}
writeRegistry(unknownFixture.grokHome, unknownRegistry)
const unknownDriver = createGrokDriver(unknownFixture.grokHome)
assert.throws(
  () => syncGrokWorkspacePluginInstallation({
    pluginPath: unknownFixture.canonical,
    legacyPluginPaths: [unknownFixture.legacy],
    backupDir: path.join(unknownFixture.fixtureRoot, 'backups'),
    env: { ...process.env, GROK_HOME: unknownFixture.grokHome },
    spawnSync: unknownDriver
  }),
  error => error?.code === 'GROK_PLUGIN_UNKNOWN_SAME_NAME_IDENTITY'
)
assert.strictEqual(
  unknownDriver.calls.some(call => call[1] === 'plugin' && ['install', 'uninstall'].includes(call[2])),
  false,
  'unknown same-name identity must block before mutation'
)

const rollbackFixture = createDuplicateGrokFixture('rollback')
const rollbackDriver = createGrokDriver(rollbackFixture.grokHome, {
  canonical: rollbackFixture.canonical,
  failCanonicalOnce: true
})
let rollbackFailure = null
try {
  syncGrokWorkspacePluginInstallation({
    pluginPath: rollbackFixture.canonical,
    legacyPluginPaths: [rollbackFixture.legacy],
    backupDir: path.join(rollbackFixture.fixtureRoot, 'backups'),
    env: { ...process.env, GROK_HOME: rollbackFixture.grokHome },
    spawnSync: rollbackDriver
  })
} catch (error) {
  rollbackFailure = error
}
assert(rollbackFailure, 'fixture install failure must surface')
assert.strictEqual(rollbackFailure.migrationRollback.registrationRestored, true)
assert.strictEqual(rollbackFailure.migrationRollback.configRestored, true)
assert.strictEqual(pluginListFromRegistry(rollbackFixture.grokHome).length, 2)

const firstInstallRollbackFixture = createDuplicateGrokFixture('first-install-rollback')
writeRegistry(firstInstallRollbackFixture.grokHome, { version: 1, repos: {} })
const firstInstallRollbackDriver = createGrokDriver(firstInstallRollbackFixture.grokHome, {
  canonical: firstInstallRollbackFixture.canonical,
  corruptCanonicalAfterInstall: true
})
let firstInstallRollbackFailure = null
try {
  syncGrokWorkspacePluginInstallation({
    pluginPath: firstInstallRollbackFixture.canonical,
    legacyPluginPaths: [firstInstallRollbackFixture.legacy],
    backupDir: path.join(firstInstallRollbackFixture.fixtureRoot, 'backups'),
    env: { ...process.env, GROK_HOME: firstInstallRollbackFixture.grokHome },
    spawnSync: firstInstallRollbackDriver
  })
} catch (error) {
  firstInstallRollbackFailure = error
}
assert(firstInstallRollbackFailure, 'first-install verification failure must surface')
assert.strictEqual(firstInstallRollbackFailure.migrationRollback.registrationRestored, true)
assert.strictEqual(firstInstallRollbackFailure.migrationRollback.restoredCount, 0)
assert.strictEqual(pluginListFromRegistry(firstInstallRollbackFixture.grokHome).length, 0)
assert(
  firstInstallRollbackDriver.calls.some(call => call[1] === 'plugin' && call[2] === 'uninstall'),
  'first-install rollback must remove the failed canonical registration'
)

const recoveryFixture = createDuplicateGrokFixture('rollback-recovery-source')
const recoveryBackupRoot = resolveWorkspaceTempBackupRoot(recoveryFixture.fixtureRoot)
const recoveryBackup = path.join(recoveryBackupRoot, 'first')
const recoverySecondBackup = path.join(recoveryBackupRoot, 'second')
const recoveryFailureDriver = createGrokDriver(recoveryFixture.grokHome, {
  canonical: recoveryFixture.canonical,
  failCanonicalOnce: true,
  onCanonicalFailure: () => fs.renameSync(recoveryFixture.legacy, `${recoveryFixture.legacy}.unavailable`)
})
let recoveryFailure = null
try {
  syncGrokWorkspacePluginInstallation({
    pluginPath: recoveryFixture.canonical,
    legacyPluginPaths: [recoveryFixture.legacy],
    activeRoot: recoveryFixture.fixtureRoot,
    backupDir: recoveryBackup,
    env: { ...process.env, GROK_HOME: recoveryFixture.grokHome },
    spawnSync: recoveryFailureDriver
  })
} catch (error) {
  recoveryFailure = error
}
assert(recoveryFailure, 'fixture canonical install failure must surface after recovery-source rollback')
assert(
  recoveryFailure.migrationRollback,
  `fixture failure must expose migrationRollback: code=${recoveryFailure.code || 'none'} message=${recoveryFailure.message}`
)
assert.strictEqual(recoveryFailure.migrationRollback.registrationRestored, true)
assert.strictEqual(recoveryFailure.migrationRollback.sourceIdentityChanged, true)
const restoredFromBackup = pluginListFromRegistry(recoveryFixture.grokHome)
  .find(item => path.resolve(item.source).startsWith(path.resolve(recoveryBackup)))
assert(restoredFromBackup, 'rollback must retain a signed managed recovery source when legacy source disappears')
const recoveredReceipt = syncGrokWorkspacePluginInstallation({
  pluginPath: recoveryFixture.canonical,
  legacyPluginPaths: [recoveryFixture.legacy],
  activeRoot: recoveryFixture.fixtureRoot,
  backupDir: recoverySecondBackup,
  env: { ...process.env, GROK_HOME: recoveryFixture.grokHome },
  spawnSync: createGrokDriver(recoveryFixture.grokHome)
})
assert.strictEqual(recoveredReceipt.status, 'verified')
assert(
  recoveredReceipt.identitiesBefore.some(item => item.classification === 'recovery-managed'),
  'the next convergence must recognize a signed source under the managed backup root'
)
assert.strictEqual(pluginListFromRegistry(recoveryFixture.grokHome).length, 1)

const failedSoft = runPostinstall({
  env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_TEST_HOME: lifecycleHome, INIT_CWD: workspace },
  cwd: workspace,
  packageRoot: packagedRoot,
  applyGlobalHostConfig: () => { throw new Error('fixture failure') }
})
assert.strictEqual(failedSoft.status, 'failed-soft')
assert.strictEqual(failedSoft.exitCode, 1)
assert.strictEqual(failedSoft.persistence.status, 'PASS')
const failedActivation = readActivationReceipt({ home: lifecycleHome, env: { DEVCODEX_TEST_HOME: lifecycleHome } })
assert.strictEqual(failedActivation.value.lifecycle.status, 'failed-soft')
assert.strictEqual(failedActivation.value.status, 'BLOCK')

assert.throws(
  () => runPostinstall({
    env: { npm_lifecycle_event: 'postinstall', npm_config_global: 'true', DEVCODEX_POSTINSTALL_STRICT: '1', DEVCODEX_TEST_HOME: lifecycleHome, INIT_CWD: workspace },
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
assert.ok(postinstallSource.includes('global-adapter-refresh-guidance') || postinstallSource.includes('devcodex global-adapters apply') || postinstallSource.includes('npm update -g devcodex'))
assert.ok(postinstallSource.includes('stale managed path(s) remain pending'))
assert.ok(postinstallSource.includes('receipt finalization step(s) remain pending'))
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

cleanupTempFixture()
assert.strictEqual(fs.existsSync(tmp), false, 'npm lifecycle temporary fixture must be removed before success')
console.log('npm lifecycle adapter tests passed global=internal workspace=noop noops=source/ci/skip/transitive dryRun=planned strict=verified tempCleanup=1')
