'use strict'

const fs = require('fs')
const path = require('path')
const {
  createCliFailure,
  createCliSuccess,
  printCliJson
} = require('./cli-json-contract.js')
const {
  applyGlobalHostConfig
} = require('./global-host-config.js')
const {
  describeGlobalAdapterRefresh,
  isDevCodexPackageRoot,
  isDevCodexSourceCheckout,
  readPackageName
} = require('./global-adapter-refresh-guidance.js')
const {
  syncGrokWorkspacePluginInstallation
} = require('./host-adapter-scope.js')
const { buildGrokCliEnv } = require('./grok-cli-env.js')

const COMMAND = 'global-adapters'
const EXPLICIT_HOME_PATH_OVERRIDE_KEYS = new Set([
  'COPILOT_HOME',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'GEMINI_CLI_HOME',
  'GROK_HOME',
  'CURSOR_HOME',
  'DEVCODEX_GLOBAL_SHARED_ROOT',
  'DEVCODEX_GLOBAL_SKILLS_ROOT',
  'DEVCODEX_GLOBAL_SKILLS_RUNTIME',
  'DEVCODEX_GLOBAL_FULL_FALLBACK',
  'DEVCODEX_VSCODE_MCP_PATH',
  'DEVCODEX_VSCODE_USER_DIR'
])

function scopeEnvToExplicitHome(env = {}, explicitHome = null) {
  if (!explicitHome) return env
  return Object.fromEntries(
    Object.entries(env).filter(([key]) =>
      !EXPLICIT_HOME_PATH_OVERRIDE_KEYS.has(String(key).toUpperCase())
    )
  )
}

function resolvePackageRoot(options = {}) {
  const pathImpl = options.path || path
  if (options.packageRoot) return pathImpl.resolve(options.packageRoot)
  return pathImpl.resolve(options.pkgRoot || pathImpl.join(__dirname, '..', '..'))
}

function parseGlobalAdaptersArgv(argv = []) {
  const args = Array.isArray(argv) ? argv.slice() : []
  const subcommand = args[0] && !String(args[0]).startsWith('-') ? args.shift() : null
  const options = {
    subcommand,
    dryRun: false,
    json: false,
    home: null,
    skillsDeployMode: null,
    errors: []
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--home') {
      const value = args[i + 1]
      if (!value || !String(value).trim() || String(value).startsWith('-')) {
        options.errors.push('--home requires a directory path')
      } else {
        options.home = value
        i++
      }
    } else if (arg.startsWith('--home=')) {
      const value = arg.slice('--home='.length)
      if (!String(value).trim()) options.errors.push('--home requires a directory path')
      else options.home = value
    } else if (arg === '--mode') {
      const value = args[i + 1]
      if (!value || String(value).startsWith('-')) {
        options.errors.push('--mode requires hidden|legacy')
      } else {
        options.skillsDeployMode = value
        i++
      }
    } else if (arg.startsWith('--mode=')) {
      options.skillsDeployMode = arg.slice('--mode='.length)
    } else {
      options.errors.push(`unsupported option: ${arg}`)
    }
  }
  return options
}

function buildHandler(deps = {}) {
  const fsImpl = deps.fs || fs
  const pathImpl = deps.path || path
  const processImpl = deps.process || process
  const consoleImpl = deps.console || console
  const c = deps.c || {
    red: s => s,
    dim: s => s,
    green: s => s,
    yellow: s => s,
    cyan: s => s,
    bold: s => s
  }
  const packageJson = deps.packageJson || require('../../package.json')
  const cliMetadata = {
    packageName: packageJson.name,
    packageVersion: packageJson.version
  }
  const apply = deps.applyGlobalHostConfig || applyGlobalHostConfig
  const syncGrok = deps.syncGrokWorkspacePluginInstallation || syncGrokWorkspacePluginInstallation
  const pkgRoot = resolvePackageRoot({ packageRoot: deps.packageRoot, pkgRoot: deps.pkgRoot, path: pathImpl })

  function printHuman(payload, dryRun) {
    consoleImpl.log()
    consoleImpl.log(c.bold('  DevCodex') + c.dim(' — global adapters apply'))
    consoleImpl.log(c.dim('  ──────────────────────────────────────'))
    consoleImpl.log(`  ${c.cyan('Package root:')} ${c.dim(payload.packageRoot)}`)
    consoleImpl.log(`  ${c.cyan('Source kind:')} ${c.dim(payload.sourceKind)}`)
    consoleImpl.log(`  ${c.cyan('Hosts:')} ${c.dim((payload.hosts || []).join(', ') || '(none)')}`)
    if (payload.planDigest) {
      consoleImpl.log(`  ${c.cyan('Plan digest:')} ${c.dim(String(payload.planDigest).slice(0, 16))}…`)
    }
    consoleImpl.log(`  ${c.cyan('Transaction:')} ${c.dim(payload.transactionStatus || 'n/a')}`)
    consoleImpl.log(`  ${c.cyan('Workspace host dirs written:')} ${c.dim(String(payload.workspaceHostDirectoriesWritten))}`)
    if (dryRun) consoleImpl.log(c.yellow('  [DRY RUN] No files were written.'))
    else if (payload.transactionStatus === 'committed') {
      consoleImpl.log(c.green('  ✓ User-level host adapters refreshed from package root.'))
    } else {
      consoleImpl.log(c.red(`  ✗ Apply ended with status ${payload.transactionStatus || 'unknown'}.`))
    }
    consoleImpl.log()
  }

  function cmdGlobalAdapters(argv = []) {
    const parsed = parseGlobalAdaptersArgv(argv)
    if (parsed.errors.length) {
      const envelope = createCliFailure(
        COMMAND,
        'CLI_GLOBAL_ADAPTERS_BAD_ARGS',
        parsed.errors.join('; '),
        'Use: devcodex global-adapters apply [--mode=hidden|legacy] [--dry-run] [--json] [--home <dir>]',
        cliMetadata
      )
      if (parsed.json) printCliJson(consoleImpl, envelope)
      else {
        consoleImpl.log(c.red(`  ${envelope.errorCode}: ${envelope.message}`))
        consoleImpl.log(c.dim(`  ${envelope.nextStep}`))
      }
      processImpl.exitCode = 2
      return envelope
    }

    if (parsed.subcommand !== 'apply') {
      const envelope = createCliFailure(
        COMMAND,
        'CLI_GLOBAL_ADAPTERS_UNKNOWN_SUBCOMMAND',
        `Unknown global-adapters subcommand: ${parsed.subcommand || '(none)'}`,
        'Use: devcodex global-adapters apply [--mode=hidden|legacy] [--dry-run] [--json]',
        cliMetadata
      )
      if (parsed.json) printCliJson(consoleImpl, envelope)
      else {
        consoleImpl.log(c.red(`  ${envelope.errorCode}: ${envelope.message}`))
        consoleImpl.log(c.dim(`  ${envelope.nextStep}`))
      }
      processImpl.exitCode = 2
      return envelope
    }

    if (!isDevCodexPackageRoot(pkgRoot, fsImpl, pathImpl)) {
      const envelope = createCliFailure(
        COMMAND,
        'GLOBAL_ADAPTERS_PACKAGE_ROOT_INVALID',
        `Package root is not a DevCodex package: ${pkgRoot}`,
        'Run from the devcodex / devcodex package root, or install via npm -g.',
        cliMetadata,
        { packageRoot: pkgRoot }
      )
      if (parsed.json) printCliJson(consoleImpl, envelope)
      else {
        consoleImpl.log(c.red(`  ${envelope.errorCode}: ${envelope.message}`))
        consoleImpl.log(c.dim(`  ${envelope.nextStep}`))
      }
      processImpl.exitCode = 2
      return envelope
    }

    const sourceCheckout = isDevCodexSourceCheckout(pkgRoot, fsImpl, pathImpl)
    const sourceKind = sourceCheckout ? 'source-checkout-live' : 'package-root-apply'
    const guidance = describeGlobalAdapterRefresh({
      sourceCheckout,
      packageVersion: packageJson.version
    })

    let result
    try {
      const applyEnv = scopeEnvToExplicitHome(processImpl.env, parsed.home)
      result = apply({
        packageRoot: pkgRoot,
        dryRun: parsed.dryRun === true,
        home: parsed.home || undefined,
        fs: fsImpl,
        env: applyEnv,
        skillsDeployMode: parsed.skillsDeployMode || undefined
      })
    } catch (error) {
      const envelope = createCliFailure(
        COMMAND,
        error.code || 'GLOBAL_ADAPTERS_APPLY_FAILED',
        error.message,
        guidance.nextStepRefresh,
        cliMetadata,
        { packageRoot: pkgRoot, sourceKind }
      )
      if (parsed.json) printCliJson(consoleImpl, envelope)
      else {
        consoleImpl.log(c.red(`  ${envelope.errorCode}: ${envelope.message}`))
        consoleImpl.log(c.dim(`  ${envelope.nextStep}`))
      }
      processImpl.exitCode = 1
      return envelope
    }

    let grokIntegration = null
    let grokIntegrationError = null
    const grokTarget = (result?.targets || []).find(target => target.host === 'grok')
    const grokTransaction = result?.transaction?.hosts?.find(item => item.host === 'grok')
    if (!parsed.dryRun && grokTransaction?.status === 'committed' && grokTarget?.files?.plugin) {
      try {
        if (!grokTarget.root) {
          const error = new Error('Committed Grok target is missing its resolved user-global root')
          error.code = 'GLOBAL_ADAPTERS_GROK_TARGET_ROOT_MISSING'
          throw error
        }
        grokIntegration = syncGrok({
          pluginPath: grokTarget.files.plugin,
          activeRoot: result?.activeRoot || null,
          env: buildGrokCliEnv({
            ...(processImpl.env || {}),
            GROK_HOME: grokTarget.root
          })
        })
      } catch (error) {
        grokIntegrationError = error
        grokIntegration = {
          status: 'failed',
          errorCode: error.code || 'GROK_PLUGIN_INSTALL_FAILED',
          error: error.message
        }
      }
    }

    const transactionStatus = result?.transaction?.status || (parsed.dryRun ? 'planned' : 'unknown')
    const hostsCommitted = transactionStatus === 'committed'
    const committed = parsed.dryRun
      ? transactionStatus === 'planned'
      : hostsCommitted && !grokIntegrationError

    const payload = {
      schemaVersion: 'GlobalAdaptersApplyV1',
      operation: 'apply',
      packageRoot: pkgRoot,
      packageName: readPackageName(pkgRoot, fsImpl, pathImpl),
      packageVersion: packageJson.version,
      sourceKind,
      sourceCheckout,
      dryRun: parsed.dryRun === true,
      planDigest: result?.planDigest || null,
      transactionStatus,
      hostsCommitted,
      hosts: (result?.targets || []).map(target => target.host),
      hostResults: (result?.transaction?.hosts || []).map(item => ({
        host: item.host,
        status: item.status,
        changed: item.changed || 0,
        errorCode: item.errorCode || null
      })),
      workspaceHostDirectoriesWritten: result?.workspaceHostDirectoriesWritten === true,
      guidance: {
        primary: guidance.primary,
        secondary: guidance.secondary
      },
      integrations: { grok: grokIntegration },
      partialState: grokIntegrationError && hostsCommitted
        ? {
            schemaVersion: 'GlobalAdaptersPartialStateV1',
            hostsTransaction: 'committed',
            grokIntegration: 'failed',
            note: 'User-global host adapters were written; Grok plugin integration failed afterward.',
            nextStep: 'Re-run `devcodex global-adapters apply` after fixing Grok home/plugin registration, or repair Grok registration only; do not assume a full rollback of host files.'
          }
        : null
    }

    if (!committed) {
      const nextStep = grokIntegrationError && hostsCommitted
        ? payload.partialState.nextStep
        : guidance.nextStepRefresh
      const message = grokIntegrationError && hostsCommitted
        ? `Host adapters committed, but Grok integration failed: ${grokIntegration.error || grokIntegrationError.message}`
        : (grokIntegrationError
          ? (grokIntegration.error || grokIntegrationError.message)
          : `Global host configuration ended with ${transactionStatus} status`)
      const envelope = createCliFailure(
        COMMAND,
        grokIntegrationError
          ? (hostsCommitted
            ? 'GLOBAL_ADAPTERS_HOSTS_COMMITTED_GROK_FAILED'
            : (grokIntegration.errorCode || 'GROK_PLUGIN_INSTALL_FAILED'))
          : (transactionStatus === 'partial' ? 'GLOBAL_HOST_CONFIG_PARTIAL' : 'GLOBAL_ADAPTERS_APPLY_FAILED'),
        message,
        nextStep,
        cliMetadata,
        payload
      )
      if (parsed.json) printCliJson(consoleImpl, envelope)
      else {
        printHuman(payload, parsed.dryRun)
        if (payload.partialState) {
          consoleImpl.log(c.yellow(`  ⚠ Host transaction committed; Grok integration failed.`))
          consoleImpl.log(c.dim(`  ${payload.partialState.nextStep}`))
        }
        consoleImpl.log(c.red(`  ${envelope.errorCode}: ${envelope.message}`))
      }
      processImpl.exitCode = 1
      return envelope
    }

    const envelope = createCliSuccess(COMMAND, payload, cliMetadata)
    if (parsed.json) printCliJson(consoleImpl, envelope)
    else printHuman(payload, parsed.dryRun)
    processImpl.exitCode = 0
    return envelope
  }

  return { cmdGlobalAdapters, parseGlobalAdaptersArgv }
}

module.exports = {
  COMMAND,
  EXPLICIT_HOME_PATH_OVERRIDE_KEYS,
  buildHandler,
  parseGlobalAdaptersArgv,
  resolvePackageRoot,
  scopeEnvToExplicitHome
}
