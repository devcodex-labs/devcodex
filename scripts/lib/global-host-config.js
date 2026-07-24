'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  GLOBAL_HOST_IDS,
  resolveGlobalHostTargets,
  samePath,
  targetAcceptsPath
} = require('./global-host-target.js')
const {
  mergeHostJsonContent,
  mergeManagedBlock,
  mergeManagedTomlTables,
  parseJsonObject,
  quoteToml
} = require('./global-host-config-merge.js')
const {
  executeGlobalHostTransaction
} = require('./global-host-config-transaction.js')
const {
  mergeGrokPluginRegistration
} = require('./host-adapter-scope.js')

const GLOBAL_HOST_CONFIG_SCHEMA = 'GlobalOnlyHostConfigModeV1'
const GLOBAL_HOST_RECEIPT_SCHEMA = 'GlobalHostConfigReceiptV1'
const MCP_RUNTIME_DEPS = Object.freeze([
  'scripts/lib/cp-digest.js',
  'scripts/lib/host-parity-scorecard.js',
  'scripts/lib/global-host-target.js',
  'scripts/lib/derived-index-contract.js',
  'scripts/lib/memory-index.js',
  'scripts/lib/summary-type-canon.js'
])

function portable(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/')
}

function shellCommand(filePath, host) {
  const escaped = String(filePath).replace(/"/g, '\\"')
  return `node "${escaped}" ${host}`
}

function readText(file, fsImpl = fs) {
  return fsImpl.existsSync(file) ? fsImpl.readFileSync(file, 'utf8') : ''
}

function readPackage(packageRoot, fsImpl = fs) {
  return parseJsonObject(readText(path.join(packageRoot, 'package.json'), fsImpl), 'package.json')
}

function walkFiles(root, fsImpl = fs) {
  if (!fsImpl.existsSync(root)) return []
  const result = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fsImpl.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) result.push(full)
    }
  }
  return result.sort()
}

function addFileOperation(operations, host, destination, content, kind = 'text') {
  operations.push({ host, path: destination, content, kind })
}

function replaceFileOperation(operations, host, destination, content, kind = 'text') {
  const resolved = path.resolve(destination)
  const index = operations.findIndex(operation =>
    operation.host === host && path.resolve(operation.path) === resolved
  )
  const next = { host, path: destination, content, kind }
  if (index === -1) operations.push(next)
  else operations[index] = next
}

function addSourceFile(operations, host, source, destination, fsImpl = fs) {
  if (!fsImpl.existsSync(source)) {
    const error = new Error(`GLOBAL_HOST_SOURCE_MISSING: ${source}`)
    error.code = 'GLOBAL_HOST_SOURCE_MISSING'
    throw error
  }
  addFileOperation(operations, host, destination, fsImpl.readFileSync(source, 'utf8'))
}

function addSourceTree(operations, host, sourceRoot, destinationRoot, fsImpl = fs) {
  for (const source of walkFiles(sourceRoot, fsImpl)) {
    addSourceFile(
      operations,
      host,
      source,
      path.join(destinationRoot, path.relative(sourceRoot, source)),
      fsImpl
    )
  }
}

function addCommonRuntime(operations, target, packageRoot, fsImpl = fs) {
  const runtime = target.runtimeRoot
  addSourceFile(operations, target.host, path.join(packageRoot, 'instructions.md'), path.join(runtime, 'instructions.full.md'), fsImpl)
  addSourceFile(operations, target.host, path.join(packageRoot, 'host-projections', 'AGENTS.md'), path.join(runtime, 'AGENTS.md'), fsImpl)
  addSourceTree(operations, target.host, path.join(packageRoot, 'hooks', '_runtime'), path.join(runtime, 'hooks', '_runtime'), fsImpl)
  addSourceTree(operations, target.host, path.join(packageRoot, 'mcp'), path.join(runtime, 'mcp'), fsImpl)
  for (const relative of MCP_RUNTIME_DEPS) {
    addSourceFile(
      operations,
      target.host,
      path.join(packageRoot, ...relative.split('/')),
      path.join(runtime, ...relative.split('/')),
      fsImpl
    )
  }
}

function managedInstruction(existing, source, label) {
  return mergeManagedBlock(existing, [
    `# DevCodex global host adapter (${label})`,
    '',
    source.trim(),
    '',
    '> Runtime state remains workspace-scoped under `.devcodex`; this user-level file never owns workspace state.'
  ].join('\n'), { kind: 'markdown', id: `global-${label}` })
}

function hookMap(runtimeFile, host, events) {
  const command = shellCommand(runtimeFile, host)
  return Object.fromEntries(events.map(event => [
    event,
    [{
      ...(event.includes('Tool') ? { matcher: '' } : {}),
      hooks: [{ type: 'command', command }]
    }]
  ]))
}

function buildMcpServers(runtimeRoot) {
  return {
    'devcodex-memory': {
      type: 'stdio',
      command: 'node',
      args: [portable(path.join(runtimeRoot, 'mcp', 'memory-server.js')), '.'],
      _note: 'Global DevCodex runtime; workspace state is discovered from the host cwd.'
    },
    'devcodex-profile': {
      type: 'stdio',
      command: 'node',
      args: [portable(path.join(runtimeRoot, 'mcp', 'profile-server.js')), '.'],
      _note: 'Global DevCodex runtime; workspace Profile remains under .devcodex.'
    }
  }
}

function codexTomlBlock(target) {
  const servers = buildMcpServers(target.runtimeRoot)
  return [
    '# Managed by npm install/update -g devcodex.',
    '[mcp_servers.devcodex-memory]',
    'command = "node"',
    `args = [${servers['devcodex-memory'].args.map(quoteToml).join(', ')}]`,
    'startup_timeout_sec = 30',
    '',
    '[mcp_servers.devcodex-profile]',
    'command = "node"',
    `args = [${servers['devcodex-profile'].args.map(quoteToml).join(', ')}]`,
    'startup_timeout_sec = 30'
  ].join('\n')
}

function transformedHookTemplate(packageRoot, target, sourceRelative, host, fsImpl = fs) {
  const value = parseJsonObject(readText(path.join(packageRoot, sourceRelative), fsImpl), sourceRelative)
  value.hooks = hookMap(
    path.join(target.runtimeRoot, 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'),
    host,
    Object.keys(value.hooks || {})
  )
  return value
}

function addCopilotPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  const destination = target.files.instructions
  const source = readText(path.join(packageRoot, 'host-projections', 'copilot-instructions.md'), fsImpl)
  addFileOperation(operations, target.host, destination, managedInstruction(readText(destination, fsImpl), source, 'copilot'))
}

function addClaudePlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  addSourceTree(operations, target.host, path.join(packageRoot, 'skills'), path.join(target.root, 'skills'), fsImpl)
  const source = readText(path.join(packageRoot, 'host-projections', 'CLAUDE.md'), fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.instructions,
    managedInstruction(readText(target.files.instructions, fsImpl), source, 'claude')
  )
  const managedSettings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    hooks: hookMap(
      path.join(target.runtimeRoot, 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'),
      'claude',
      ['PreToolUse', 'UserPromptSubmit', 'PostToolUse', 'Stop']
    )
  }
  addFileOperation(
    operations,
    target.host,
    target.files.settings,
    mergeHostJsonContent(readText(target.files.settings, fsImpl), managedSettings, 'Claude settings'),
    'json'
  )
  addFileOperation(
    operations,
    target.host,
    target.files.mcp,
    mergeHostJsonContent(
      readText(target.files.mcp, fsImpl),
      { mcpServers: buildMcpServers(target.runtimeRoot) },
      'Claude user MCP'
    ),
    'json'
  )
}

function addCodexPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  addSourceTree(operations, target.host, path.join(packageRoot, 'skills'), target.files.skills, fsImpl)
  const source = readText(path.join(packageRoot, 'host-projections', 'AGENTS.md'), fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.instructions,
    managedInstruction(readText(target.files.instructions, fsImpl), source, 'codex')
  )
  const hooks = transformedHookTemplate(packageRoot, target, path.join('codex', 'hooks.json'), 'codex', fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.hooks,
    mergeHostJsonContent(readText(target.files.hooks, fsImpl), hooks, 'Codex hooks'),
    'json'
  )
  addFileOperation(
    operations,
    target.host,
    target.files.config,
    mergeManagedTomlTables(readText(target.files.config, fsImpl), codexTomlBlock(target), {
      id: 'global-codex-mcp',
      tableNames: ['mcp_servers.devcodex-memory', 'mcp_servers.devcodex-profile'],
      legacyMarkers: [{
        begin: '# BEGIN DEVCODEX-MCP-MANAGED',
        end: '# END DEVCODEX-MCP-MANAGED'
      }]
    }),
    'toml'
  )
}

function addGeminiPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  const source = readText(path.join(packageRoot, 'host-projections', 'GEMINI.md'), fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.instructions,
    managedInstruction(readText(target.files.instructions, fsImpl), source, 'gemini')
  )
  const settings = transformedHookTemplate(packageRoot, target, path.join('gemini', 'settings.json'), 'gemini', fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.settings,
    mergeHostJsonContent(readText(target.files.settings, fsImpl), settings, 'Gemini settings'),
    'json'
  )
}

function addGrokPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  const pluginSource = path.join(packageRoot, 'grok', 'plugins', 'devcodex-workspace')
  addSourceTree(operations, target.host, pluginSource, target.files.plugin, fsImpl)

  const hooks = transformedHookTemplate(
    packageRoot,
    target,
    path.join('grok', 'plugins', 'devcodex-workspace', 'hooks', 'hooks.json'),
    'grok',
    fsImpl
  )
  replaceFileOperation(
    operations,
    target.host,
    path.join(target.files.plugin, 'hooks', 'hooks.json'),
    `${JSON.stringify(hooks, null, 2)}\n`,
    'json'
  )
  replaceFileOperation(
    operations,
    target.host,
    path.join(target.files.plugin, '.mcp.json'),
    `${JSON.stringify({ mcpServers: buildMcpServers(target.runtimeRoot) }, null, 2)}\n`,
    'json'
  )

  const merged = mergeGrokPluginRegistration(readText(target.files.config, fsImpl), target.files.plugin, {
    pluginName: 'devcodex-workspace'
  })
  addFileOperation(operations, target.host, target.files.config, merged.desired, 'toml')
}

function hostPlanBuilder(host) {
  return {
    copilot: addCopilotPlan,
    claude: addClaudePlan,
    codex: addCodexPlan,
    gemini: addGeminiPlan,
    grok: addGrokPlan
  }[host]
}

function digestPlan(operations) {
  const hash = crypto.createHash('sha256')
  for (const operation of operations) {
    hash.update(operation.host || '')
    hash.update('\0')
    hash.update(path.resolve(operation.path))
    hash.update('\0')
    hash.update(operation.content)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function digestText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function readReceipt(file, fsImpl = fs) {
  if (!fsImpl.existsSync(file)) return null
  return parseJsonObject(readText(file, fsImpl), file)
}

function sameStringArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  const normalize = values => values.map(value => portable(value)).sort()
  const first = normalize(left)
  const second = normalize(right)
  return first.every((value, index) => value === second[index])
}

function buildPreviousStateRef(receiptFile, previousReceiptText) {
  if (!previousReceiptText) return null
  return {
    receiptFile: portable(receiptFile),
    receiptDigest: digestText(previousReceiptText)
  }
}

function reusableUpdatedAt(previousReceipt, nextReceipt) {
  if (!previousReceipt || !previousReceipt.updatedAt) return null
  if (previousReceipt.schemaVersion !== GLOBAL_HOST_RECEIPT_SCHEMA) return null
  if (previousReceipt.host !== nextReceipt.host) return null
  if (previousReceipt.packageName !== nextReceipt.packageName) return null
  if (previousReceipt.packageVersion !== nextReceipt.packageVersion) return null
  if (previousReceipt.sourceDigest !== nextReceipt.sourceDigest) return null
  if (previousReceipt.planDigest !== nextReceipt.planDigest) return null
  if (!sameStringArray(previousReceipt.managedPaths, nextReceipt.managedPaths)) return null
  if (previousReceipt.result !== 'committed') return null
  return previousReceipt.updatedAt
}

function staleManagedPaths(previousReceipt, currentManagedPaths, target, fsImpl = fs) {
  const previousPaths = Array.isArray(previousReceipt?.managedPaths)
    ? previousReceipt.managedPaths
    : (Array.isArray(previousReceipt?.configFiles) ? previousReceipt.configFiles : [])
  const current = new Set(currentManagedPaths.map(file => portable(file)))
  return previousPaths
    .map(file => path.resolve(file))
    .filter(file => !current.has(portable(file)))
    .filter(file => targetAcceptsPath(target, file, fsImpl))
    .filter(file => !samePath(file, target.receiptFile))
    .filter(file => fsImpl.existsSync(file))
}

function removeStaleManagedPaths(paths, target, fsImpl = fs) {
  const removed = []
  const failures = []
  for (const file of paths || []) {
    try {
      if (!targetAcceptsPath(target, file, fsImpl) || samePath(file, target.receiptFile)) {
        const error = new Error(`GLOBAL_HOST_STALE_PATH_OUTSIDE_ROOT: ${file}`)
        error.code = 'GLOBAL_HOST_STALE_PATH_OUTSIDE_ROOT'
        throw error
      }
      if (!fsImpl.existsSync(file)) continue
      const stat = fsImpl.statSync(file)
      if (!stat.isFile()) continue
      fsImpl.unlinkSync(file)
      removed.push(file)
    } catch (error) {
      failures.push({
        path: portable(file),
        errorCode: error.code || 'GLOBAL_HOST_STALE_CLEANUP_FAILED',
        error: error.message
      })
    }
  }
  return { removed, failures }
}

function buildGlobalHostConfigPlan(options = {}) {
  const fsImpl = options.fs || fs
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const packageJson = readPackage(packageRoot, fsImpl)
  const targets = resolveGlobalHostTargets({
    env: options.env || process.env,
    home: options.home,
    hosts: options.hosts || GLOBAL_HOST_IDS
  })
  const hostPlans = []

  for (const target of targets) {
    const hostOperations = []
    try {
      hostPlanBuilder(target.host)(hostOperations, target, packageRoot, fsImpl)
      hostPlans.push({
        host: target.host,
        status: 'planned',
        operations: hostOperations
      })
    } catch (error) {
      hostPlans.push({
        host: target.host,
        status: 'plan-failed',
        operations: [],
        errorCode: error.code || 'GLOBAL_HOST_PLAN_FAILED',
        error: error.message
      })
    }
  }

  const operations = hostPlans.flatMap(hostPlan => hostPlan.operations)
  const preReceiptDigest = digestPlan(operations)
  for (const target of targets) {
    const hostPlan = hostPlans.find(item => item.host === target.host)
    if (hostPlan.status !== 'planned') continue
    const hostFiles = hostPlan.operations.map(operation => operation.path)
    const previousReceiptText = options.ignoreExistingReceipts ? '' : readText(target.receiptFile, fsImpl)
    let previousReceipt = null
    if (previousReceiptText) {
      try {
        previousReceipt = parseJsonObject(previousReceiptText, `${target.host} previous receipt`)
      } catch {
        previousReceipt = null
      }
    }
    const managedPaths = hostFiles.map(portable)
    const previousEquivalent = previousReceipt &&
      previousReceipt.schemaVersion === GLOBAL_HOST_RECEIPT_SCHEMA &&
      previousReceipt.host === target.host &&
      previousReceipt.packageName === (packageJson.name || 'devcodex') &&
      previousReceipt.packageVersion === (packageJson.version || 'unknown') &&
      previousReceipt.sourceDigest === preReceiptDigest &&
      previousReceipt.planDigest === preReceiptDigest &&
      sameStringArray(previousReceipt.managedPaths, managedPaths) &&
      previousReceipt.result === 'committed'
    const receipt = {
      schemaVersion: GLOBAL_HOST_RECEIPT_SCHEMA,
      mode: GLOBAL_HOST_CONFIG_SCHEMA,
      host: target.host,
      support: target.support,
      evidenceCeiling: target.evidenceCeiling,
      packageName: packageJson.name || 'devcodex',
      packageVersion: packageJson.version || 'unknown',
      packageRoot: portable(packageRoot),
      runtimeRoot: portable(target.runtimeRoot),
      managedPaths,
      configFiles: managedPaths,
      sourceDigest: preReceiptDigest,
      planDigest: preReceiptDigest,
      previousStateRef: previousEquivalent
        ? (previousReceipt.previousStateRef ?? null)
        : buildPreviousStateRef(target.receiptFile, previousReceiptText),
      result: 'committed',
      updatedAt: null,
      workspaceHostDirectoriesWritten: false
    }
    receipt.updatedAt = reusableUpdatedAt(previousReceipt, receipt) || new Date().toISOString()
    hostPlan.staleManagedPaths = staleManagedPaths(previousReceipt, managedPaths, target, fsImpl)
    addFileOperation(
      hostPlan.operations,
      target.host,
      target.receiptFile,
      `${JSON.stringify(receipt, null, 2)}\n`,
      'json'
    )
  }

  const finalOperations = hostPlans.flatMap(hostPlan => hostPlan.operations)
  return {
    schemaVersion: GLOBAL_HOST_CONFIG_SCHEMA,
    packageRoot,
    packageName: packageJson.name || 'devcodex',
    packageVersion: packageJson.version || 'unknown',
    targets,
    hostPlans,
    operations: finalOperations,
    planDigest: digestPlan(finalOperations),
    workspaceHostDirectoriesWritten: false
  }
}

function applyGlobalHostConfig(options = {}) {
  const plan = buildGlobalHostConfigPlan(options)
  const hostTransactions = []
  const failAfterByHost = options.failAfterByHost || {}
  const fallbackFailureHost = options.failHost || plan.targets[0]?.host

  for (const target of plan.targets) {
    const hostPlan = plan.hostPlans.find(item => item.host === target.host)
    if (hostPlan.status !== 'planned') {
      hostTransactions.push({
        host: target.host,
        status: hostPlan.status,
        changed: 0,
        errorCode: hostPlan.errorCode,
        error: hostPlan.error
      })
      continue
    }

    const hasScopedFailure = Object.prototype.hasOwnProperty.call(failAfterByHost, target.host)
    const failAfter = hasScopedFailure
      ? failAfterByHost[target.host]
      : (options.failAfter !== undefined && target.host === fallbackFailureHost
          ? options.failAfter
          : undefined)
    try {
      const hostTransaction = executeGlobalHostTransaction(hostPlan.operations, {
        fs: options.fs || fs,
        allowedRoots: [target.root, ...(target.additionalRoots || [])],
        allowedFiles: target.additionalFiles || [],
        allowedByHost: {
          [target.host]: {
            allowedRoots: [target.root, ...(target.additionalRoots || [])],
            allowedFiles: target.additionalFiles || []
          }
        },
        dryRun: options.dryRun === true,
        failAfter
      })
      if (!options.dryRun && hostTransaction.status === 'committed') {
        const staleCleanup = removeStaleManagedPaths(hostPlan.staleManagedPaths, target, options.fs || fs)
        hostTransaction.removedStaleManagedPaths = staleCleanup.removed.map(portable)
        if (staleCleanup.failures.length) {
          hostTransaction.staleCleanupIncomplete = true
          hostTransaction.staleCleanupFailures = staleCleanup.failures
        }
      }
      hostTransactions.push({ host: target.host, ...hostTransaction })
    } catch (error) {
      hostTransactions.push({
        host: target.host,
        ...(error.receipt || {
          status: 'failed',
          changed: 0,
          errorCode: error.code || 'GLOBAL_HOST_TRANSACTION_FAILED',
          error: error.message
        })
      })
    }
  }

  const successfulState = options.dryRun ? 'planned' : 'committed'
  const successful = hostTransactions.filter(item => item.status === successfulState)
  const failed = hostTransactions.filter(item => item.status !== successfulState)
  const transaction = {
    schemaVersion: 'GlobalHostConfigBatchTransactionV1',
    status: failed.length === 0
      ? successfulState
      : (successful.length > 0 ? 'partial' : 'failed'),
    dryRun: options.dryRun === true,
    changed: successful.reduce((sum, item) => sum + (item.changed || 0), 0),
    backupCleanupIncomplete: successful.some(item => item.backupCleanupIncomplete === true),
    backupCleanupFailures: successful.flatMap(item =>
      (item.backupCleanupFailures || []).map(failure => ({ host: item.host, ...failure }))
    ),
    staleCleanupIncomplete: successful.some(item => item.staleCleanupIncomplete === true),
    staleCleanupFailures: successful.flatMap(item =>
      (item.staleCleanupFailures || []).map(failure => ({ host: item.host, ...failure }))
    ),
    hosts: hostTransactions
  }
  return { ...plan, transaction }
}

function inspectGlobalHostConfig(options = {}) {
  const fsImpl = options.fs || fs
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const packageJson = readPackage(packageRoot, fsImpl)
  const targets = resolveGlobalHostTargets({
    env: options.env || process.env,
    home: options.home,
    hosts: options.hosts || GLOBAL_HOST_IDS
  })
  const expectedPlan = buildGlobalHostConfigPlan({
    ...options,
    fs: fsImpl,
    packageRoot,
    ignoreExistingReceipts: true
  })
  const hosts = targets.map(target => {
    let receipt = null
    let error = null
    try {
      receipt = parseJsonObject(readText(target.receiptFile, fsImpl), `${target.host} receipt`)
    } catch (caught) {
      error = caught.message
    }
    const runtimeEntry = path.join(target.runtimeRoot, 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')
    const configFiles = Array.isArray(receipt?.configFiles)
      ? receipt.configFiles.map(file => path.resolve(file))
      : []
    const managedPaths = Array.isArray(receipt?.managedPaths)
      ? receipt.managedPaths.map(file => path.resolve(file))
      : []
    const expectedHostPlan = expectedPlan.hostPlans.find(item => item.host === target.host)
    const expectedReceiptOperation = expectedHostPlan?.operations.find(operation =>
      samePath(operation.path, target.receiptFile)
    )
    let expectedReceipt = null
    try {
      expectedReceipt = expectedReceiptOperation
        ? parseJsonObject(expectedReceiptOperation.content, `${target.host} expected receipt`)
        : null
    } catch {
      expectedReceipt = null
    }
    const invalidConfigFiles = configFiles.filter(file => !targetAcceptsPath(target, file, fsImpl))
    const missingConfigFiles = configFiles
      .filter(file => targetAcceptsPath(target, file, fsImpl))
      .filter(file => !fsImpl.existsSync(file))
    const requiredEntrypoints = [
      runtimeEntry,
      ...Object.values(target.files || {}).filter(Boolean)
    ]
    const missingEntrypoints = requiredEntrypoints.filter(file => !fsImpl.existsSync(file))
    const runtimeDeclared = configFiles.some(file => samePath(file, runtimeEntry))
    const receiptFieldsComplete = receipt?.schemaVersion === GLOBAL_HOST_RECEIPT_SCHEMA &&
      receipt.mode === GLOBAL_HOST_CONFIG_SCHEMA &&
      receipt.host === target.host &&
      typeof receipt.packageName === 'string' &&
      typeof receipt.packageVersion === 'string' &&
      typeof receipt.sourceDigest === 'string' &&
      typeof receipt.planDigest === 'string' &&
      Array.isArray(receipt.managedPaths) &&
      Object.prototype.hasOwnProperty.call(receipt, 'previousStateRef') &&
      receipt.result === 'committed' &&
      typeof receipt.updatedAt === 'string'
    const receiptMatchesCurrent = Boolean(expectedReceipt) &&
      receipt?.packageName === expectedReceipt.packageName &&
      receipt?.packageVersion === expectedReceipt.packageVersion &&
      receipt?.sourceDigest === expectedReceipt.sourceDigest &&
      receipt?.planDigest === receipt?.sourceDigest &&
      sameStringArray(receipt?.managedPaths, expectedReceipt.managedPaths)
    const stale = Boolean(receipt) && (!receiptFieldsComplete || !receiptMatchesCurrent)
    const ready = receipt?.schemaVersion === GLOBAL_HOST_RECEIPT_SCHEMA &&
      receipt.host === target.host &&
      receiptFieldsComplete &&
      receiptMatchesCurrent &&
      configFiles.length > 0 &&
      managedPaths.length > 0 &&
      runtimeDeclared &&
      invalidConfigFiles.length === 0 &&
      missingConfigFiles.length === 0 &&
      missingEntrypoints.length === 0
    return {
      host: target.host,
      support: target.support,
      root: target.root,
      receiptFile: target.receiptFile,
      runtimeEntry,
      configFilesDeclared: configFiles.length,
      invalidConfigFiles: invalidConfigFiles.map(portable),
      missingConfigFiles: missingConfigFiles.map(portable),
      missingEntrypoints: missingEntrypoints.map(portable),
      receiptFieldsComplete,
      receiptMatchesCurrent,
      ready,
      stale,
      packageVersion: receipt?.packageVersion || null,
      error
    }
  })
  return {
    schemaVersion: 'GlobalHostConfigInspectionV1',
    mode: GLOBAL_HOST_CONFIG_SCHEMA,
    packageVersion: packageJson.version || 'unknown',
    ready: hosts.every(host => host.ready),
    hosts
  }
}

module.exports = {
  GLOBAL_HOST_CONFIG_SCHEMA,
  GLOBAL_HOST_RECEIPT_SCHEMA,
  MCP_RUNTIME_DEPS,
  applyGlobalHostConfig,
  buildGlobalHostConfigPlan,
  buildMcpServers,
  digestPlan,
  inspectGlobalHostConfig,
  portable,
  shellCommand,
  walkFiles
}
