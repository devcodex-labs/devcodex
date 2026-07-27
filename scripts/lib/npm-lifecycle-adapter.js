'use strict'

const fs = require('fs')
const path = require('path')
const { applyGlobalHostConfig } = require('./global-host-config.js')
const { syncGrokWorkspacePluginInstallation } = require('./host-adapter-scope.js')

const RECEIPT_SCHEMA = 'DevCodexNpmLifecycleAdapterReceiptV1'
const PACKAGE_NAMES = Object.freeze(['@devcodex/devcodex', 'devcodex'])
const GLOBAL_INTERNAL_ACTION = 'apply-global-host-config'

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim())
}

function readJson(filePath, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function normalizePath(value, pathImpl = path) {
  return pathImpl.resolve(String(value || '.'))
}

function packageRootFrom(baseDir, pathImpl = path) {
  return pathImpl.resolve(baseDir || pathImpl.join(__dirname, '..', '..'))
}

function isSourceCheckout(packageRoot, fsImpl = fs, pathImpl = path) {
  const root = packageRootFrom(packageRoot, pathImpl)
  return fsImpl.existsSync(pathImpl.join(root, '.git')) &&
    readJson(pathImpl.join(root, 'package.json'), fsImpl)?.name === '@devcodex/devcodex'
}

function directDependencyNames(targetRoot, fsImpl = fs, pathImpl = path) {
  const pkg = readJson(pathImpl.join(targetRoot, 'package.json'), fsImpl)
  const names = []
  if (pkg) {
    const sections = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.optionalDependencies,
      pkg.peerDependencies
    ].filter(section => section && typeof section === 'object' && !Array.isArray(section))
    names.push(...sections.flatMap(section => Object.keys(section)))
  }
  const lock = readJson(pathImpl.join(targetRoot, 'package-lock.json'), fsImpl)
  const rootPackage = lock?.packages?.['']
  if (rootPackage) {
    const lockSections = [
      rootPackage.dependencies,
      rootPackage.devDependencies,
      rootPackage.optionalDependencies,
      rootPackage.peerDependencies
    ].filter(section => section && typeof section === 'object' && !Array.isArray(section))
    names.push(...lockSections.flatMap(section => Object.keys(section)))
  }
  return Array.from(new Set(names))
}

function declaresDevCodexDependency(targetRoot, fsImpl = fs, pathImpl = path) {
  const names = directDependencyNames(targetRoot, fsImpl, pathImpl)
  return PACKAGE_NAMES.some(name => names.includes(name))
}

function packageLockRootDependencyNames(targetRoot, fsImpl = fs, pathImpl = path) {
  const lock = readJson(pathImpl.join(targetRoot, 'package-lock.json'), fsImpl)
  const rootPackage = lock?.packages?.['']
  if (!rootPackage) return []
  const sections = [
    rootPackage.dependencies,
    rootPackage.devDependencies,
    rootPackage.optionalDependencies,
    rootPackage.peerDependencies
  ].filter(section => section && typeof section === 'object' && !Array.isArray(section))
  return Array.from(new Set(sections.flatMap(section => Object.keys(section))))
}

function classifyNpmLifecycleInstall(options = {}) {
  const env = options.env || process.env
  const fsImpl = options.fs || fs
  const pathImpl = options.path || path
  const cwd = normalizePath(options.cwd || process.cwd(), pathImpl)
  const packageRoot = packageRootFrom(options.packageRoot, pathImpl)
  const initCwd = env.INIT_CWD ? normalizePath(env.INIT_CWD, pathImpl) : cwd
  const force = truthy(env.DEVCODEX_POSTINSTALL_FORCE)
  const isPostinstall = String(env.npm_lifecycle_event || '') === 'postinstall' || force
  const globalInstall = truthy(env.npm_config_global) || String(env.npm_config_location || '').toLowerCase() === 'global'
  const ci = truthy(env.CI) || truthy(env.GITHUB_ACTIONS) || truthy(env.BUILDKITE) || truthy(env.TF_BUILD)

  const base = {
    schemaVersion: RECEIPT_SCHEMA,
    packageNames: PACKAGE_NAMES,
    packageRoot,
    cwd,
    initCwd,
    lifecycleEvent: env.npm_lifecycle_event || null,
    globalInstall,
    dryRun: truthy(env.DEVCODEX_POSTINSTALL_DRY_RUN),
    force
  }

  function noOp(reason, extra = {}) {
    return { ...base, action: 'noop', reason, targetRoot: null, command: null, ...extra }
  }

  if (!isPostinstall) return noOp('not-postinstall')
  if (truthy(env.DEVCODEX_SKIP_POSTINSTALL)) return noOp('skip-env')
  if (truthy(env.DEVCODEX_POSTINSTALL_CHILD)) return noOp('child-process')
  if (!force && ci) return noOp('ci')
  if (globalInstall) {
    return {
      ...base,
      action: 'execute',
      scope: 'global-install',
      reason: 'global-install-postinstall',
      targetRoot: null,
      command: { internal: GLOBAL_INTERNAL_ACTION }
    }
  }
  if (!force && isSourceCheckout(packageRoot, fsImpl, pathImpl)) return noOp('source-checkout')

  if (!fsImpl.existsSync(initCwd)) return noOp('target-missing')
  if (!declaresDevCodexDependency(initCwd, fsImpl, pathImpl)) {
    return noOp('transitive-or-indirect', { targetRoot: initCwd })
  }

  return noOp('workspace-install-global-required', {
    scope: 'workspace-install',
    targetRoot: initCwd,
    guidance: 'Host config requires a global install: npm install -g devcodex'
  })
}

function runPostinstall(options = {}) {
  const env = options.env || process.env
  const pathImpl = options.path || path
  const packageRoot = packageRootFrom(options.packageRoot, pathImpl)
  const decision = classifyNpmLifecycleInstall({ ...options, packageRoot })
  const receipt = {
    ...decision,
    status: decision.action === 'execute' ? 'pending' : 'skipped',
    startedAt: new Date().toISOString()
  }

  if (decision.action !== 'execute') {
    receipt.completedAt = new Date().toISOString()
    return receipt
  }

  if (decision.dryRun) {
    receipt.status = 'planned'
    receipt.completedAt = new Date().toISOString()
    return receipt
  }

  try {
    const apply = options.applyGlobalHostConfig || applyGlobalHostConfig
    const result = apply({
      packageRoot,
      env,
      home: options.home,
      dryRun: false
    })
    const grokTarget = (result?.targets || []).find(target => target.host === 'grok')
    const grokTransaction = result?.transaction?.hosts?.find(item => item.host === 'grok')
    let grokIntegration = null
    let grokIntegrationError = null
    const staleCleanupFailureCount = result?.transaction?.staleCleanupFailures?.length || 0
    const receiptFinalizationFailureCount = result?.transaction?.receiptFinalizationFailures?.length || 0
    const backupCleanupFailureCount = result?.transaction?.backupCleanupFailures?.length || 0
    const maintenanceIncomplete = (
      staleCleanupFailureCount +
      receiptFinalizationFailureCount +
      backupCleanupFailureCount
    ) > 0
    receipt.globalHostConfig = {
      schemaVersion: result?.schemaVersion || null,
      workspaceCleanMode: result?.workspaceCleanMode || null,
      planDigest: result?.planDigest || null,
      transactionStatus: result?.transaction?.status || null,
      hosts: (result?.targets || []).map(target => target.host),
      changed: result?.transaction?.changed ?? null,
      maintenanceStatus: maintenanceIncomplete ? 'incomplete' : 'complete',
      maintenanceIncomplete,
      backupCleanupIncomplete: result?.transaction?.backupCleanupIncomplete === true,
      backupCleanupFailureCount,
      staleCleanupIncomplete: result?.transaction?.staleCleanupIncomplete === true,
      staleCleanupFailureCount,
      receiptFinalizationIncomplete: result?.transaction?.receiptFinalizationIncomplete === true,
      receiptFinalizationFailureCount,
      hostResults: (result?.transaction?.hosts || []).map(item => ({
        host: item.host,
        status: item.status,
        changed: item.changed || 0,
        errorCode: item.errorCode || null
      })),
      workspaceHostDirectoriesWritten: result?.workspaceHostDirectoriesWritten ?? null,
      integrations: {
        grok: null
      }
    }
    if (grokTransaction?.status === 'committed' && grokTarget?.files?.plugin) {
      try {
        const syncGrok = options.syncGrokWorkspacePluginInstallation ||
          options.syncGrokPluginInstallation ||
          syncGrokWorkspacePluginInstallation
        grokIntegration = syncGrok({
          pluginPath: grokTarget.files.plugin,
          activeRoot: result?.activeRoot || null,
          env
        })
      } catch (error) {
        grokIntegrationError = error
        grokIntegration = {
          schemaVersion: 'GrokPluginInstallationReceiptV1',
          status: 'failed',
          errorCode: error.code || 'GROK_PLUGIN_INSTALL_FAILED',
          error: error.message
        }
      }
    }
    receipt.globalHostConfig.integrations.grok = grokIntegration
    const configCommitted = result?.transaction?.status === 'committed'
    receipt.status = configCommitted && !grokIntegrationError ? 'executed' : 'failed-soft'
    receipt.exitCode = receipt.status === 'executed' ? 0 : 1
    if (!configCommitted) {
      receipt.errorCode = result?.transaction?.status === 'partial'
        ? 'GLOBAL_HOST_CONFIG_PARTIAL'
        : 'GLOBAL_HOST_CONFIG_FAILED'
      receipt.error = `Global host configuration ended with ${result?.transaction?.status || 'unknown'} status`
    } else if (grokIntegrationError) {
      receipt.errorCode = grokIntegration.errorCode
      receipt.error = grokIntegration.error
    }
  } catch (error) {
    receipt.status = 'failed-soft'
    receipt.exitCode = 1
    receipt.errorCode = error.code || 'GLOBAL_HOST_CONFIG_FAILED'
    receipt.error = error.message
    if (truthy(env.DEVCODEX_POSTINSTALL_STRICT)) {
      const strictError = new Error(`DEVCODEX_POSTINSTALL_FAILED: ${receipt.errorCode}`)
      receipt.completedAt = new Date().toISOString()
      strictError.receipt = receipt
      throw strictError
    }
  }
  receipt.completedAt = new Date().toISOString()

  if (receipt.status !== 'executed' && truthy(env.DEVCODEX_POSTINSTALL_STRICT)) {
    const error = new Error(`DEVCODEX_POSTINSTALL_FAILED: ${receipt.errorCode || receipt.exitCode || 'unknown'}`)
    error.receipt = receipt
    throw error
  }
  return receipt
}

module.exports = {
  GLOBAL_INTERNAL_ACTION,
  PACKAGE_NAMES,
  RECEIPT_SCHEMA,
  classifyNpmLifecycleInstall,
  declaresDevCodexDependency,
  directDependencyNames,
  isSourceCheckout,
  packageLockRootDependencyNames,
  runPostinstall,
  truthy
}
