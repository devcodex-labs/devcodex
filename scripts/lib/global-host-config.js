'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { isDeepStrictEqual } = require('util')
const {
  GLOBAL_HOST_IDS,
  resolveGlobalHostTarget,
  resolveGlobalHostTargets,
  samePath,
  targetAcceptsPath,
  targetSafetyRoots,
  isUnderPhysical
} = require('./global-host-target.js')
const {
  mergeHostJsonContent,
  mergeManagedBlock,
  mergeManagedTomlTables,
  parseJsonObject,
  quoteToml,
  tomlManagedFileMatches
} = require('./global-host-config-merge.js')
const {
  executeGlobalHostTransaction,
  operationDigest
} = require('./global-host-config-transaction.js')
const {
  createSkillDeployFileFilter,
  listManagedSkillIds,
  listPrunableSkillIds,
  MANAGED_SKILL_MARKER,
  pruneManagedSkillDirs,
  verifyManagedSkillDirOwnership,
  buildPreservedCollision
} = require('./skill-deploy-filter.js')
const { resolveSkillsDeployMode } = require('./skills-deploy-mode.js')
const {
  mergeGrokPluginRegistration
} = require('./host-adapter-scope.js')
const {
  describeGlobalAdapterRefreshForPackageRoot
} = require('./global-adapter-refresh-guidance.js')
const {
  collectRuntimeScriptDeps
} = require('./runtime-dependency-closure.js')
const {
  listControlDeliveryEntries,
  readControlInstructionRoot
} = require('./control-content-delivery.js')
const {
  buildHostHookCommand,
  canonicalNodeExecutable
} = require('./host-command.js')

const GLOBAL_HOST_CONFIG_SCHEMA = 'GlobalOnlyHostConfigModeV1'
const GLOBAL_HOST_RECEIPT_SCHEMA = 'GlobalHostConfigReceiptV1'
const { buildRuntimeGeneration } = require('./runtime-generation.js')
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const MCP_RUNTIME_DEPS = Object.freeze(collectRuntimeScriptDeps(PACKAGE_ROOT))
const INSPECTION_RESOLVED_TARGETS = Symbol('inspectionResolvedTargets')
const INSPECTION_SHARED_RUNTIME_OWNER = Symbol('inspectionSharedRuntimeOwner')

function isHostTargetPermissionError(error) {
  return error && (error.code === 'EPERM' || error.code === 'EACCES')
}

function boundedHostTargetEvidence(error) {
  const message = String(error?.message || error?.code || 'Host target access was denied.')
  return message.length > 512 ? `${message.slice(0, 509)}...` : message
}

function buildHostTargetUnverifiedIssue(error) {
  return {
    code: 'GLOBAL_HOST_TARGET_UNVERIFIED',
    phase: 'configuration',
    reasonCode: 'sandbox-read-denied',
    errorCode: error.code,
    evidence: boundedHostTargetEvidence(error),
    nextStep: 'Grant read access to this host configuration directory, then rerun `devcodex status`.'
  }
}

function buildUnverifiedHostInspection(host, issue) {
  return {
    host,
    support: 'unverified',
    root: null,
    receiptFile: null,
    runtimeEntry: null,
    configFilesDeclared: 0,
    invalidConfigFiles: [],
    invalidPendingStaleManagedPaths: [],
    pendingStaleManagedPaths: [],
    missingConfigFiles: [],
    missingEntrypoints: [],
    driftedConfigFiles: [],
    configured: false,
    configurationIssues: [issue],
    receiptFieldsComplete: false,
    receiptMatchesCurrent: false,
    ready: false,
    stale: false,
    packageVersion: null,
    error: issue.evidence,
    inspectionStatus: 'UNVERIFIED'
  }
}

function portable(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/')
}

function shellCommand(filePath, host, args = []) {
  return buildHostHookCommand(filePath, [host, ...args])
}

function stableHostHookLauncher(target) {
  return path.join(target.runtimeBaseRoot, 'host-hook-launcher.cjs')
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

function addFileOperation(operations, host, destination, content, kind = 'text', managedContent = content) {
  operations.push({ host, path: destination, content, kind, managedContent })
}

function replaceFileOperation(operations, host, destination, content, kind = 'text', managedContent = content) {
  const resolved = path.resolve(destination)
  const index = operations.findIndex(operation =>
    operation.host === host && path.resolve(operation.path) === resolved
  )
  const next = { host, path: destination, content, kind, managedContent }
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

function addSourceTree(operations, host, sourceRoot, destinationRoot, fsImpl = fs, fileFilter = null) {
  for (const source of walkFiles(sourceRoot, fsImpl)) {
    const relative = path.relative(sourceRoot, source)
    if (fileFilter && !fileFilter(relative)) continue
    addSourceFile(
      operations,
      host,
      source,
      path.join(destinationRoot, relative),
      fsImpl
    )
  }
}

function addInstructionRoot(operations, host, packageRoot, destination, fsImpl = fs) {
  const content = readControlInstructionRoot(packageRoot, fsImpl)
  if (content == null) {
    const error = new Error('GLOBAL_HOST_SOURCE_MISSING: content/instructions.md')
    error.code = 'GLOBAL_HOST_SOURCE_MISSING'
    throw error
  }
  addFileOperation(operations, host, destination, content)
}

function addSkillRuntimeTree(operations, host, packageRoot, destinationRoot, fsImpl = fs) {
  const deployFilter = createSkillDeployFileFilter(packageRoot)
  const contentEntries = listControlDeliveryEntries(packageRoot, 'skills', fsImpl)
  if (!contentEntries) {
    addSourceTree(
      operations,
      host,
      path.join(packageRoot, 'skills'),
      destinationRoot,
      fsImpl,
      deployFilter
    )
    return
  }
  for (const entry of contentEntries) {
    if (!deployFilter(entry.relative)) continue
    addFileOperation(
      operations,
      host,
      path.join(destinationRoot, entry.relative),
      entry.content,
      Buffer.isBuffer(entry.content) ? 'binary' : 'text'
    )
  }
}

function skillsDeployDestination (target) {
  const mode = target.skillsDeployMode || 'hidden'
  if (mode === 'legacy') return target.shared && target.shared.skills
  return target.shared && (target.shared.skillsRuntime || path.join(target.shared.root, 'devcodex', 'skills'))
}

function addSharedRuntime(operations, target, packageRoot, fsImpl = fs) {
  if (!target.shared || target.sharedRuntimeOwner !== true) return
  addInstructionRoot(operations, target.host, packageRoot, target.shared.fullFallback, fsImpl)
  const skillsDest = skillsDeployDestination(target)
  if (!skillsDest) return
  addSkillRuntimeTree(operations, target.host, packageRoot, skillsDest, fsImpl)
}

function addCommonRuntime(operations, target, packageRoot, fsImpl = fs) {
  const runtime = target.runtimeRoot
  addSharedRuntime(operations, target, packageRoot, fsImpl)
  addSourceFile(
    operations,
    target.host,
    path.join(packageRoot, 'hooks', '_runtime', 'host-hook-launcher.cjs'),
    stableHostHookLauncher(target),
    fsImpl
  )
  addInstructionRoot(operations, target.host, packageRoot, path.join(runtime, 'instructions.full.md'), fsImpl)
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
  if (target.runtimeGeneration) {
    addFileOperation(
      operations,
      target.host,
      path.join(runtime, 'runtime-generation.json'),
      `${JSON.stringify(target.runtimeGeneration, null, 2)}\n`,
      'json'
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

/**
 * Per-host command-hook wall clock.
 * Claude / Codex / Grok: seconds. Gemini CLI: milliseconds. Copilot uses timeoutSec separately.
 * Unified product target: 30s (heavy UPS: digest + skill bootstrap + heuristic).
 */
function hookCommandTimeout(host) {
  if (host === 'gemini') return 30000
  return 30
}

function hookMap(runtimeFile, host, events) {
  const command = shellCommand(runtimeFile, host)
  const timeout = hookCommandTimeout(host)
  return Object.fromEntries(events.map(event => [
    event,
    [{
      ...(event.includes('Tool') ? { matcher: '' } : {}),
      hooks: [{ type: 'command', command, timeout }]
    }]
  ]))
}

function copilotHookDocument(runtimeFile) {
  const entry = (event, matcher) => ({
    type: 'command',
    command: shellCommand(runtimeFile, 'copilot', ['--event', event]),
    ...(matcher ? { matcher } : {}),
    timeoutSec: 30
  })
  return {
    version: 1,
    hooks: {
      userPromptSubmitted: [entry('userPromptSubmitted')],
      userPromptTransformed: [entry('userPromptTransformed')],
      preToolUse: [entry('preToolUse', '.*')],
      postToolUse: [entry('postToolUse', '.*')],
      agentStop: [entry('agentStop')],
      preCompact: [entry('preCompact')]
    }
  }
}

function cursorShellCommand(runtimeFile, pluginPath) {
  return shellCommand(runtimeFile, 'cursor', ['--cursor-plugin-path', pluginPath])
}

function cursorHookDocument(runtimeFile, pluginPath) {
  const command = cursorShellCommand(runtimeFile, pluginPath)
  const entry = (options = {}) => ({
    command,
    timeout: 30,
    ...options
  })
  return {
    version: 1,
    hooks: {
      workspaceOpen: [entry()],
      sessionStart: [entry()],
      sessionEnd: [entry()],
      beforeSubmitPrompt: [entry({ failClosed: true })],
      preToolUse: [entry({ matcher: '.*', failClosed: true })],
      postToolUse: [entry({ matcher: '.*' })],
      postToolUseFailure: [entry({ matcher: '.*' })],
      afterAgentResponse: [entry()],
      preCompact: [entry()],
      stop: [entry({ failClosed: true, loop_limit: 5 })]
    }
  }
}

/**
 * Map global host id → memory/profile agent identity (VALID_AGENTS).
 * Claude host root is `.claude` but agent id is `claude-code`.
 */
function hostToRuntimeAgent (host) {
  const normalized = String(host || '').trim().toLowerCase()
  if (normalized === 'claude') return 'claude-code'
  if (normalized === 'copilot' || normalized === 'codex' || normalized === 'grok' || normalized === 'cursor') return normalized
  // gemini / unknown: leave unset so detectRuntimeAgent can still apply
  return ''
}

function buildMcpServers(runtimeRoot, options = {}) {
  const agent = hostToRuntimeAgent(options.agent || options.host)
  const env = agent ? { DEVCODEX_AGENT: agent } : undefined
  const inputRoot = String(options.inputRoot || '.').trim() || '.'
  const base = {
    type: 'stdio',
    command: canonicalNodeExecutable()
  }
  return {
    'devcodex-memory': {
      ...base,
      args: [portable(path.join(runtimeRoot, 'mcp', 'memory-server.js')), inputRoot],
      ...(env ? { env } : {})
    },
    'devcodex-profile': {
      ...base,
      args: [portable(path.join(runtimeRoot, 'mcp', 'profile-server.js')), inputRoot],
      ...(env ? { env } : {})
    }
  }
}

function buildCopilotMcpServers(runtimeRoot, options = {}) {
  return Object.fromEntries(
    Object.entries(buildMcpServers(runtimeRoot, options)).map(([name, server]) => [
      name,
      {
        type: 'local',
        command: server.command,
        args: server.args,
        env: server.env && typeof server.env === 'object' ? { ...server.env } : {},
        tools: ['*']
      }
    ])
  )
}

/** VS Code user mcp.json "servers" entries (stdio). */
function buildVscodeMcpServers (runtimeRoot, options = {}) {
  return Object.fromEntries(
    Object.entries(buildMcpServers(runtimeRoot, { agent: options.agent || options.host || 'copilot' })).map(([name, server]) => [
      name,
      {
        type: 'stdio',
        command: server.command,
        args: server.args,
        ...(server.env ? { env: server.env } : {})
      }
    ])
  )
}

/**
 * Merge DevCodex servers into VS Code User mcp.json without wiping inputs / other servers.
 */
function mergeVscodeUserMcpContent (existingText, runtimeRoot, options = {}) {
  const doc = parseJsonObject(existingText, 'VS Code user mcp.json')
  if (!doc.servers || typeof doc.servers !== 'object' || Array.isArray(doc.servers)) {
    doc.servers = {}
  }
  const managed = buildVscodeMcpServers(runtimeRoot, options)
  for (const [name, server] of Object.entries(managed)) {
    doc.servers[name] = server
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}

const CODEX_MCP_APPROVED_TOOLS = Object.freeze({
  'devcodex-memory': Object.freeze([
    'memory_cp_confirm',
    'memory_session_allocate',
    'memory_session_query',
    'memory_session_read',
    'memory_session_write',
    'memory_status',
    'memory_summary_append',
    'memory_summary_query',
    'memory_summary_read',
    'memory_task_resolve'
  ]),
  'devcodex-profile': Object.freeze([
    'profile_context_plan',
    'profile_load',
    'skill_route'
  ])
})

function codexMcpTableNames () {
  return Object.entries(CODEX_MCP_APPROVED_TOOLS).flatMap(([server, tools]) => [
    `mcp_servers.${server}`,
    ...tools.map(tool => `mcp_servers.${server}.tools.${tool}`)
  ])
}

function codexTomlBlock(target) {
  const servers = buildMcpServers(target.runtimeRoot, { host: target.host || 'codex' })
  const agent = hostToRuntimeAgent(target.host || 'codex')
  const envLine = agent ? `env = { DEVCODEX_AGENT = ${quoteToml(agent)} }` : null
  const lines = [
    '# Managed by npm install/update -g devcodex.',
    '[mcp_servers.devcodex-memory]',
    `command = ${quoteToml(servers['devcodex-memory'].command)}`,
    `args = [${servers['devcodex-memory'].args.map(quoteToml).join(', ')}]`,
    ...(envLine ? [envLine] : []),
    'startup_timeout_sec = 30',
    '',
    '[mcp_servers.devcodex-profile]',
    `command = ${quoteToml(servers['devcodex-profile'].command)}`,
    `args = [${servers['devcodex-profile'].args.map(quoteToml).join(', ')}]`,
    ...(envLine ? [envLine] : []),
    'startup_timeout_sec = 30'
  ]
  for (const [server, tools] of Object.entries(CODEX_MCP_APPROVED_TOOLS)) {
    for (const tool of tools) {
      lines.push(
        '',
        `[mcp_servers.${server}.tools.${tool}]`,
        'approval_mode = "approve"'
      )
    }
  }
  return lines.join('\n')
}

function transformedHookTemplate(packageRoot, target, sourceRelative, host, fsImpl = fs) {
  const value = parseJsonObject(readText(path.join(packageRoot, sourceRelative), fsImpl), sourceRelative)
  value.hooks = hookMap(
    stableHostHookLauncher(target),
    host,
    Object.keys(value.hooks || {})
  )
  return value
}

function addCopilotPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  if ((target.skillsDeployMode || 'hidden') === 'legacy') {
    addSkillRuntimeTree(operations, target.host, packageRoot, target.files.skills, fsImpl)
  }
  const destination = target.files.instructions
  const source = readText(path.join(packageRoot, 'host-projections', 'copilot-instructions.md'), fsImpl)
  addFileOperation(
    operations,
    target.host,
    destination,
    managedInstruction(readText(destination, fsImpl), source, 'copilot'),
    'text',
    managedInstruction('', source, 'copilot')
  )
  const hooks = copilotHookDocument(
    stableHostHookLauncher(target)
  )
  addFileOperation(
    operations,
    target.host,
    target.files.hooks,
    mergeHostJsonContent(readText(target.files.hooks, fsImpl), hooks, 'Copilot hooks'),
    'json',
    `${JSON.stringify(hooks, null, 2)}\n`
  )
  const mcp = { mcpServers: buildCopilotMcpServers(target.runtimeRoot, { host: 'copilot' }) }
  addFileOperation(
    operations,
    target.host,
    target.files.mcp,
    mergeHostJsonContent(readText(target.files.mcp, fsImpl), mcp, 'Copilot user MCP'),
    'json',
    `${JSON.stringify(mcp, null, 2)}\n`
  )
  // Co-refresh VS Code User mcp.json (global) on the same apply transaction as Copilot host
  const vscodePaths = []
  if (target.files && target.files.vscodeMcp) vscodePaths.push(target.files.vscodeMcp)
  if (Array.isArray(target.additionalFiles)) {
    for (const file of target.additionalFiles) {
      if (file && /mcp\.json$/i.test(file)) vscodePaths.push(file)
    }
  }
  const seenVscode = new Set()
  for (const vscodeMcpPath of vscodePaths) {
    const key = portable(vscodeMcpPath)
    if (seenVscode.has(key)) continue
    seenVscode.add(key)
    const existing = readText(vscodeMcpPath, fsImpl)
    const merged = mergeVscodeUserMcpContent(existing, target.runtimeRoot, { host: 'copilot' })
    const managedVscode = {
      servers: buildVscodeMcpServers(target.runtimeRoot, { host: 'copilot' })
    }
    addFileOperation(
      operations,
      target.host,
      vscodeMcpPath,
      merged,
      'json',
      `${JSON.stringify(managedVscode, null, 2)}\n`
    )
  }
}

function addClaudePlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  if ((target.skillsDeployMode || 'hidden') === 'legacy') {
    addSkillRuntimeTree(operations, target.host, packageRoot, path.join(target.root, 'skills'), fsImpl)
  }
  const source = readText(path.join(packageRoot, 'host-projections', 'CLAUDE.md'), fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.instructions,
    managedInstruction(readText(target.files.instructions, fsImpl), source, 'claude'),
    'text',
    managedInstruction('', source, 'claude')
  )
  const managedSettings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    hooks: hookMap(
      stableHostHookLauncher(target),
      'claude',
      ['PreToolUse', 'UserPromptSubmit', 'PostToolUse', 'Stop']
    )
  }
  addFileOperation(
    operations,
    target.host,
    target.files.settings,
    mergeHostJsonContent(readText(target.files.settings, fsImpl), managedSettings, 'Claude settings'),
    'json',
    `${JSON.stringify(managedSettings, null, 2)}\n`
  )
  addFileOperation(
    operations,
    target.host,
    target.files.mcp,
    mergeHostJsonContent(
      readText(target.files.mcp, fsImpl),
      { mcpServers: buildMcpServers(target.runtimeRoot, { host: 'claude' }) },
      'Claude user MCP'
    ),
    'json',
    `${JSON.stringify({ mcpServers: buildMcpServers(target.runtimeRoot, { host: 'claude' }) }, null, 2)}\n`
  )
}

function addCodexPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  // shared skills tree is owned by sharedRuntimeOwner; only write codex-specific skills path in legacy when distinct
  if (
    (target.skillsDeployMode || 'hidden') === 'legacy' &&
    target.files.skills &&
    (!target.shared || !samePath(target.files.skills, target.shared.skills))
  ) {
    addSkillRuntimeTree(operations, target.host, packageRoot, target.files.skills, fsImpl)
  }
  const source = readText(path.join(packageRoot, 'host-projections', 'AGENTS.md'), fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.instructions,
    managedInstruction(readText(target.files.instructions, fsImpl), source, 'codex'),
    'text',
    managedInstruction('', source, 'codex')
  )
  const hooks = transformedHookTemplate(packageRoot, target, path.join('codex', 'hooks.json'), 'codex', fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.hooks,
    mergeHostJsonContent(readText(target.files.hooks, fsImpl), hooks, 'Codex hooks'),
    'json',
    `${JSON.stringify(hooks, null, 2)}\n`
  )
  const managedCodexToml = codexTomlBlock(target)
  const codexTomlOperation = {
    host: target.host,
    path: target.files.config,
    content: mergeManagedTomlTables(readText(target.files.config, fsImpl), managedCodexToml, {
      id: 'global-codex-mcp',
      tableNames: codexMcpTableNames(),
      legacyMarkers: [{
        begin: '# BEGIN DEVCODEX-MCP-MANAGED',
        end: '# END DEVCODEX-MCP-MANAGED'
      }]
    }),
    kind: 'toml',
    managedContent: managedCodexToml,
    managedBlockId: 'global-codex-mcp'
  }
  operations.push(codexTomlOperation)
}

function addGeminiPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  const source = readText(path.join(packageRoot, 'host-projections', 'GEMINI.md'), fsImpl)
  addFileOperation(
    operations,
    target.host,
    target.files.instructions,
    managedInstruction(readText(target.files.instructions, fsImpl), source, 'gemini'),
    'text',
    managedInstruction('', source, 'gemini')
  )
  const settings = transformedHookTemplate(packageRoot, target, path.join('gemini', 'settings.json'), 'gemini', fsImpl)
  settings.mcpServers = buildMcpServers(target.runtimeRoot, { host: 'gemini' })
  addFileOperation(
    operations,
    target.host,
    target.files.settings,
    mergeHostJsonContent(readText(target.files.settings, fsImpl), settings, 'Gemini settings'),
    'json',
    `${JSON.stringify(settings, null, 2)}\n`
  )
}

function addGrokPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  const globalHooks = transformedHookTemplate(
    packageRoot,
    target,
    path.join('grok', 'hooks', 'devcodex.json'),
    'grok',
    fsImpl
  )
  addFileOperation(
    operations,
    target.host,
    target.files.hooks,
    mergeHostJsonContent(
      readText(target.files.hooks, fsImpl),
      globalHooks,
      'Grok global hooks'
    ),
    'json',
    `${JSON.stringify(globalHooks, null, 2)}\n`
  )
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
    `${JSON.stringify({ mcpServers: buildMcpServers(target.runtimeRoot, { host: 'grok' }) }, null, 2)}\n`,
    'json'
  )

  const merged = mergeGrokPluginRegistration(readText(target.files.config, fsImpl), target.files.plugin, {
    pluginName: 'devcodex-workspace'
  })
  const managedGrokRegistration = mergeGrokPluginRegistration('', target.files.plugin, {
    pluginName: 'devcodex-workspace'
  }).desired
  addFileOperation(
    operations,
    target.host,
    target.files.config,
    merged.desired,
    'toml',
    managedGrokRegistration
  )
}

function addCursorPlan(operations, target, packageRoot, fsImpl) {
  addCommonRuntime(operations, target, packageRoot, fsImpl)
  const hooks = cursorHookDocument(stableHostHookLauncher(target), target.files.plugin)
  addFileOperation(
    operations,
    target.host,
    target.files.hooks,
    mergeHostJsonContent(readText(target.files.hooks, fsImpl), hooks, 'Cursor user hooks'),
    'json',
    JSON.stringify(hooks, null, 2) + '\n'
  )

  const pluginSource = path.join(packageRoot, 'cursor', 'plugins', 'devcodex-workspace')
  addSourceTree(operations, target.host, pluginSource, target.files.plugin, fsImpl)
  const packageJson = readPackage(packageRoot, fsImpl)
  const sourceManifest = parseJsonObject(
    readText(path.join(pluginSource, '.cursor-plugin', 'plugin.json'), fsImpl),
    'Cursor plugin manifest'
  )
  const manifest = {
    ...sourceManifest,
    version: packageJson.version || sourceManifest.version,
    skills: './skills',
    mcpServers: './mcp.json'
  }
  replaceFileOperation(
    operations,
    target.host,
    path.join(target.files.plugin, '.cursor-plugin', 'plugin.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'json'
  )
  replaceFileOperation(
    operations,
    target.host,
    path.join(target.files.plugin, 'mcp.json'),
    JSON.stringify({
      mcpServers: buildMcpServers(target.runtimeRoot, {
        host: 'cursor',
        inputRoot: '${workspaceFolder}'
      })
    }, null, 2) + '\n',
    'json'
  )
}

function hostPlanBuilder(host) {
  return {
    copilot: addCopilotPlan,
    claude: addClaudePlan,
    codex: addCodexPlan,
    gemini: addGeminiPlan,
    grok: addGrokPlan,
    cursor: addCursorPlan
  }[host]
}

function digestPlan(operations) {
  const hash = crypto.createHash('sha256')
  for (const operation of operations) {
    hash.update(operation.host || '')
    hash.update('\0')
    hash.update(path.resolve(operation.path))
    hash.update('\0')
    hash.update(operation.managedContent ?? operation.content)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function operationMatchesCurrent(operation, fsImpl = fs) {
  if (!fsImpl.existsSync(operation.path)) return false
  const current = fsImpl.readFileSync(operation.path, operation.kind === 'binary' ? null : 'utf8')
  if (operation.kind === 'binary') {
    return Buffer.isBuffer(operation.content) && current.equals(operation.content)
  }
  if (operation.kind === 'json') {
    try {
      return isDeepStrictEqual(JSON.parse(current), JSON.parse(operation.content))
    } catch {
      return false
    }
  }
  // Codex (and other TOML managed-marker files): compare DevCodex authority
  // fields only. Host-owned tool policy subtables inside the managed block are
  // allowed so legitimate Codex approval_mode writes do not trip drift.
  if (operation.kind === 'toml' && operation.managedContent != null) {
    return tomlManagedFileMatches(
      current,
      operation.content,
      operation.managedContent,
      { id: operation.managedBlockId || 'global-codex-mcp' }
    )
  }
  return current === operation.content
}

function preserveSemanticallyEquivalentContent(operations, fsImpl = fs) {
  return operations.map(operation => {
    if (!operationMatchesCurrent(operation, fsImpl)) return operation
    return {
      ...operation,
      content: fsImpl.readFileSync(operation.path, operation.kind === 'binary' ? null : 'utf8')
    }
  })
}

function bindPlanTimePrecondition(operation, fsImpl = fs) {
  if (fsImpl.existsSync(operation.path)) {
    return {
      ...operation,
      expectedDigest: operationDigest(fsImpl.readFileSync(operation.path))
    }
  }
  return {
    ...operation,
    expectAbsent: true
  }
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
  if (!isDeepStrictEqual(
    previousReceipt.managedFileDigests || {},
    nextReceipt.managedFileDigests || {}
  )) return null
  if (!isDeepStrictEqual(previousReceipt.managedArtifacts || [], nextReceipt.managedArtifacts || [])) return null
  if (!isDeepStrictEqual(
    previousReceipt.retainedManagedArtifacts || [],
    nextReceipt.retainedManagedArtifacts || []
  )) return null
  if (!sameStringArray(previousReceipt.retainedRuntimeRoots || [], nextReceipt.retainedRuntimeRoots || [])) return null
  if (!sameStringArray(
    previousReceipt.pendingStaleManagedPaths || [],
    nextReceipt.pendingStaleManagedPaths || []
  )) return null
  if (previousReceipt.result !== 'committed') return null
  return previousReceipt.updatedAt
}

function staleManagedPaths(previousReceipt, currentManagedPaths, target, fsImpl = fs, globallyManagedPaths = []) {
  const previousManagedPaths = Array.isArray(previousReceipt?.managedPaths)
    ? previousReceipt.managedPaths
    : (Array.isArray(previousReceipt?.configFiles) ? previousReceipt.configFiles : [])
  const previousPaths = [
    ...previousManagedPaths,
    ...(Array.isArray(previousReceipt?.pendingStaleManagedPaths)
      ? previousReceipt.pendingStaleManagedPaths
      : [])
  ]
  const current = new Set(currentManagedPaths.map(file => portable(file)))
  const globallyManaged = new Set(globallyManagedPaths.map(file => portable(file)))
  return Array.from(new Set(previousPaths.map(file => portable(file))))
    .map(file => path.resolve(file))
    .filter(file => !current.has(portable(file)))
    .filter(file => !globallyManaged.has(portable(file)))
    .filter(file => targetAcceptsPath(target, file, fsImpl))
    .filter(file => !samePath(file, target.receiptFile))
    .filter(file => fsImpl.existsSync(file))
}

function removeStaleManagedPaths(paths, target, fsImpl = fs, options = {}) {
  const removed = []
  const failures = []
  const requiredDigests = options.requiredDigests || {}
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
      const key = portable(file)
      if (Object.prototype.hasOwnProperty.call(requiredDigests, key)) {
        const expected = String(requiredDigests[key] || '')
        if (!/^[a-f0-9]{64}$/.test(expected)) {
          const error = new Error(`GLOBAL_HOST_STALE_OWNERSHIP_PROOF_MISSING: ${file}`)
          error.code = 'GLOBAL_HOST_STALE_OWNERSHIP_PROOF_MISSING'
          throw error
        }
        const actual = digestText(fsImpl.readFileSync(file, 'utf8'))
        if (actual !== expected) {
          const error = new Error(`GLOBAL_HOST_STALE_MANAGED_MODIFIED: ${file}`)
          error.code = 'GLOBAL_HOST_STALE_MANAGED_MODIFIED'
          throw error
        }
      }
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

function collectHostNativeSkillRoots (target) {
  const roots = []
  if (!target) return roots
  if (target.shared && target.shared.skills && target.sharedRuntimeOwner !== false) roots.push(target.shared.skills)
  if (target.host === 'claude') roots.push(path.join(target.root, 'skills'))
  if (target.host === 'copilot' && target.files && target.files.skills) roots.push(target.files.skills)
  return Array.from(new Set(roots.map(root => path.resolve(root))))
}

function pathIsInside (root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function receiptManagedDigest (receipt, file) {
  for (const [candidate, digest] of Object.entries(receipt?.managedFileDigests || {})) {
    if (samePath(candidate, file)) return String(digest)
  }
  return null
}

function operationOwnershipKind (operation, target) {
  const destination = path.resolve(operation.path)
  if (target.files?.instructions && samePath(destination, target.files.instructions)) {
    return { ownershipKind: 'markdown-block', blockId: `global-${target.host}` }
  }
  if (target.host === 'codex' && target.files?.config && samePath(destination, target.files.config)) {
    return { ownershipKind: 'codex-toml-block', blockId: operation.managedBlockId || 'global-codex-mcp' }
  }
  if (target.host === 'grok' && target.files?.config && samePath(destination, target.files.config)) {
    return { ownershipKind: 'grok-plugin-registration', pluginName: 'devcodex-workspace' }
  }
  const structuredJsonFiles = [
    target.files?.hooks,
    target.files?.settings,
    target.files?.mcp,
    target.files?.vscodeMcp,
    ...(target.additionalFiles || [])
  ].filter(Boolean)
  if (operation.kind === 'json' && structuredJsonFiles.some(file => samePath(destination, file))) {
    return { ownershipKind: 'json-managed' }
  }
  return { ownershipKind: 'whole-file' }
}

function buildManagedArtifact (operation, target) {
  const managed = Object.prototype.hasOwnProperty.call(operation, 'managedContent')
    ? operation.managedContent
    : operation.content
  const ownership = operationOwnershipKind(operation, target)
  return {
    path: portable(operation.path),
    ...ownership,
    managedDigest: digestText(managed),
    ...(ownership.ownershipKind === 'whole-file'
      ? { contentDigest: digestText(operation.content) }
      : {})
  }
}

function retainedManagedArtifacts (previousReceipt, retainedRoots) {
  const roots = (retainedRoots || []).map(root => path.resolve(root))
  if (!previousReceipt || !roots.length) return []
  const priorArtifacts = Array.isArray(previousReceipt.retainedManagedArtifacts)
    ? previousReceipt.retainedManagedArtifacts
    : []
  const byPath = new Map()
  for (const artifact of priorArtifacts) {
    if (!artifact?.path) continue
    byPath.set(portable(artifact.path), { ...artifact, path: portable(artifact.path) })
  }
  for (const candidate of previousReceipt.managedPaths || []) {
    const file = path.resolve(candidate)
    if (!roots.some(root => pathIsInside(root, file))) continue
    const digest = receiptManagedDigest(previousReceipt, file)
    byPath.set(portable(file), {
      path: portable(file),
      ownershipKind: 'whole-file',
      managedDigest: digest,
      contentDigest: digest
    })
  }
  return [...byPath.values()]
    .filter(artifact => roots.some(root => pathIsInside(root, artifact.path)))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function addNativeSkillOwnershipMarkers (operations, roots, skillIds) {
  const allowedIds = new Set(skillIds || [])
  for (const root of roots || []) {
    const bySkill = new Map()
    for (const operation of operations) {
      const rel = path.relative(root, path.resolve(operation.path))
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
      const [skillId] = rel.split(path.sep)
      if (!allowedIds.has(skillId) ||
          path.basename(operation.path) === MANAGED_SKILL_MARKER) continue
      if (!bySkill.has(skillId)) bySkill.set(skillId, [])
      bySkill.get(skillId).push(operation)
    }
    for (const [skillId, skillOperations] of bySkill) {
      const skillDir = path.join(root, skillId)
      const files = skillOperations
        .map(operation => ({
          path: path.relative(skillDir, operation.path).replace(/\\/g, '/'),
          digest: digestText(
            Object.prototype.hasOwnProperty.call(operation, 'managedContent')
              ? operation.managedContent
              : operation.content
          )
        }))
        .sort((left, right) => left.path.localeCompare(right.path))
      const marker = {
        schemaVersion: 'DevCodexManagedSkillOwnershipV1',
        owner: 'devcodex',
        skillId,
        files
      }
      addFileOperation(
        operations,
        skillOperations[0].host,
        path.join(skillDir, MANAGED_SKILL_MARKER),
        `${JSON.stringify(marker, null, 2)}\n`,
        'json'
      )
    }
  }
}

function previousReceiptSkillDirOwnership (previousReceipt, skillDir, fsImpl = fs) {
  return verifyManagedSkillDirOwnership(skillDir, fsImpl, {
    ownershipPaths: previousReceipt?.managedPaths || [],
    ownershipDigests: previousReceipt?.managedFileDigests || {}
  })
}

function resolveNativeSkillOperation (operation, roots, skillIds) {
  const ids = skillIds instanceof Set ? skillIds : new Set(skillIds || [])
  for (const root of roots) {
    const rel = path.relative(root, path.resolve(operation.path))
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    const skillId = rel.split(path.sep)[0]
    if (!ids.has(skillId)) continue
    return { root, skillId, skillDir: path.join(root, skillId) }
  }
  return null
}

function preserveUnownedNativeSkillOperations (
  operations,
  roots,
  skillIds,
  previousReceipt,
  fsImpl = fs
) {
  const blockedDirs = new Map()
  const idSet = new Set(skillIds || [])
  for (const operation of operations) {
    const match = resolveNativeSkillOperation(operation, roots, idSet)
    if (!match || !fsImpl.existsSync(match.skillDir)) continue
    const ownership = previousReceiptSkillDirOwnership(previousReceipt, match.skillDir, fsImpl)
    if (ownership.owned) continue
    blockedDirs.set(portable(match.skillDir), {
      ...match,
      reasonCode: ownership.reasonCode
    })
  }
  const filtered = operations.filter(operation => {
    const match = resolveNativeSkillOperation(operation, roots, idSet)
    return !match || !blockedDirs.has(portable(match.skillDir))
  })
  const preservedCollisions = [...blockedDirs.values()].map(match =>
    buildPreservedCollision(match.skillDir, match.skillId, match.reasonCode, fsImpl)
  )
  return { operations: filtered, preservedCollisions }
}

function collectUnownedNativeSkillCollisions (
  roots,
  skillIds,
  previousReceipt,
  fsImpl = fs
) {
  const collisions = []
  for (const root of roots) {
    for (const skillId of skillIds || []) {
      const skillDir = path.join(root, skillId)
      if (!fsImpl.existsSync(skillDir)) continue
      const ownership = previousReceiptSkillDirOwnership(previousReceipt, skillDir, fsImpl)
      if (ownership.owned) continue
      collisions.push(buildPreservedCollision(
        skillDir,
        skillId,
        ownership.reasonCode,
        fsImpl
      ))
    }
  }
  return collisions
}

function buildGlobalHostConfigPlan(options = {}) {
  const fsImpl = options.fs || fs
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const packageJson = readPackage(packageRoot, fsImpl)
  const runtimeGeneration = buildRuntimeGeneration(packageRoot, fsImpl)
  const env = options.env || process.env
  const skillsDeployMode = resolveSkillsDeployMode(env, options)
  const targets = options[INSPECTION_RESOLVED_TARGETS] || resolveGlobalHostTargets({
    env,
    home: options.home,
    hosts: options.hosts || GLOBAL_HOST_IDS,
    packageRoot,
    fs: fsImpl,
    runtimeGeneration
  })
  const sharedRuntimeOwnerHost = options[INSPECTION_SHARED_RUNTIME_OWNER] || (
    targets.some(target => target.host === 'codex')
      ? 'codex'
      : targets[0]?.host
  )
  const hostPlans = []
  const managedSkillIds = listManagedSkillIds(packageRoot)
  // Hidden mode must also remove gray/historical package skill dirs from L1 scan roots
  const prunableSkillIds = listPrunableSkillIds(packageRoot)
  const pruneRootsSeen = new Set()

  for (const target of targets) {
    const hostOperations = []
    try {
      const targetWithOwner = {
        ...target,
        sharedRuntimeOwner: target.host === sharedRuntimeOwnerHost,
        skillsDeployMode
      }
      hostPlanBuilder(target.host)(hostOperations, targetWithOwner, packageRoot, fsImpl)
      const nativeRoots = collectHostNativeSkillRoots(targetWithOwner)
      addNativeSkillOwnershipMarkers(hostOperations, nativeRoots, prunableSkillIds)
      const previousReceiptText = options.ignoreExistingReceipts ? '' : readText(target.receiptFile, fsImpl)
      let previousReceipt = null
      if (previousReceiptText) {
        try {
          previousReceipt = parseJsonObject(previousReceiptText, `${target.host} previous receipt`)
        } catch {
          previousReceipt = null
        }
      }
      const ownershipFilter = preserveUnownedNativeSkillOperations(
        hostOperations,
        nativeRoots,
        prunableSkillIds,
        previousReceipt,
        fsImpl
      )
      hostOperations.splice(0, hostOperations.length, ...ownershipFilter.operations)
      const preservedNativeSkillCollisions = [
        ...ownershipFilter.preservedCollisions,
        ...collectUnownedNativeSkillCollisions(
          nativeRoots,
          prunableSkillIds,
          previousReceipt,
          fsImpl
        )
      ].filter((item, index, all) =>
        all.findIndex(other => other.path === item.path) === index
      )
      const pruneRoots = []
      if (skillsDeployMode === 'hidden') {
        for (const root of nativeRoots) {
          const key = portable(root)
          // shared.skills prune once (owner host only)
          if (target.shared && samePath(root, target.shared.skills) && target.host !== sharedRuntimeOwnerHost) {
            continue
          }
          if (pruneRootsSeen.has(key)) continue
          pruneRootsSeen.add(key)
          pruneRoots.push(root)
        }
      }
      hostPlans.push({
        host: target.host,
        status: 'planned',
        operations: hostOperations,
        pruneManagedSkillRoots: pruneRoots,
        pruneManagedSkillRequests: pruneRoots.map(root => ({
          root,
          skillIds: [...prunableSkillIds]
        })),
        nativeSkillRoots: nativeRoots,
        managedSkillIds,
        prunableSkillIds,
        previousManagedPaths: Array.isArray(previousReceipt?.managedPaths)
          ? previousReceipt.managedPaths.slice()
          : [],
        previousManagedFileDigests: previousReceipt?.managedFileDigests &&
          typeof previousReceipt.managedFileDigests === 'object'
          ? { ...previousReceipt.managedFileDigests }
          : {},
        preservedNativeSkillCollisions,
        previousReceipt,
        previousReceiptText
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
  const globallyManagedPaths = operations.map(operation => operation.path)
  try {
    const {
      assertApplyDestinationNotWorkspaceSkills
    } = require('../../hooks/_runtime/skill-resolution.cjs')
    assertApplyDestinationNotWorkspaceSkills(globallyManagedPaths, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env
    })
  } catch (error) {
    if (error && error.code === 'GLOBAL_HOST_DEST_IN_WORKSPACE_SKILLS') throw error
    // Missing resolution module must not hide destination bugs on partial checkouts
    if (error && /Cannot find module/.test(String(error.message || ''))) {
      /* optional in incomplete trees */
    } else {
      throw error
    }
  }
  const preReceiptDigest = digestPlan(operations)
  for (const target of targets) {
    const hostPlan = hostPlans.find(item => item.host === target.host)
    if (hostPlan.status !== 'planned') continue
    const hostFiles = hostPlan.operations.map(operation => operation.path)
    const previousReceiptText = hostPlan.previousReceiptText || ''
    const previousReceipt = hostPlan.previousReceipt || null
    const managedPaths = hostFiles.map(portable)
    const managedArtifacts = hostPlan.operations.map(operation => buildManagedArtifact(operation, target))
    const managedFileDigests = Object.fromEntries(
      hostPlan.operations.map(operation => [
        portable(operation.path),
        digestText(
          Object.prototype.hasOwnProperty.call(operation, 'managedContent')
            ? operation.managedContent
            : operation.content
        )
      ])
    )
    const allStaleManagedPaths = staleManagedPaths(
      previousReceipt,
      managedPaths,
      target,
      fsImpl,
      globallyManagedPaths
    )
    const previousRuntimeRoot = previousReceipt?.runtimeRoot
      ? path.resolve(previousReceipt.runtimeRoot)
      : null
    const retainPreviousRuntime = previousRuntimeRoot &&
      !samePath(previousRuntimeRoot, target.runtimeRoot) &&
      pathIsInside(target.runtimeBaseRoot, previousRuntimeRoot)
    const generationSafeStaleManagedPaths = retainPreviousRuntime
      ? allStaleManagedPaths.filter(file => !pathIsInside(previousRuntimeRoot, file))
      : allStaleManagedPaths
    hostPlan.retainedRuntimeRoots = Array.from(new Set([
      ...(Array.isArray(previousReceipt?.retainedRuntimeRoots)
        ? previousReceipt.retainedRuntimeRoots
        : []),
      ...(retainPreviousRuntime ? [portable(previousRuntimeRoot)] : [])
    ].map(portable)))
      .filter(root => !samePath(root, target.runtimeRoot))
      .filter(root => pathIsInside(target.runtimeBaseRoot, root))
      .sort()
    hostPlan.retainedManagedArtifacts = retainedManagedArtifacts(
      previousReceipt,
      hostPlan.retainedRuntimeRoots
    )
    const nativeStaleByRoot = new Map()
    hostPlan.nativeStaleFileDigests = {}
    hostPlan.staleManagedPaths = generationSafeStaleManagedPaths.filter(file => {
      const root = (hostPlan.nativeSkillRoots || []).find(candidate =>
        pathIsInside(candidate, file)
      )
      if (!root) return true
      const rel = path.relative(root, file)
      const skillId = rel.split(path.sep)[0]
      if (!skillId || skillId === '..') return true
      const skillDir = path.join(root, skillId)
      const stillManagedInNativeRoot = hostPlan.operations.some(operation =>
        pathIsInside(skillDir, operation.path)
      )
      if (stillManagedInNativeRoot) {
        hostPlan.nativeStaleFileDigests[portable(file)] =
          receiptManagedDigest(previousReceipt, file)
        return true
      }
      const key = portable(root)
      if (!nativeStaleByRoot.has(key)) {
        nativeStaleByRoot.set(key, { root, skillIds: new Set() })
      }
      nativeStaleByRoot.get(key).skillIds.add(skillId)
      return false
    })
    for (const request of nativeStaleByRoot.values()) {
      const existing = (hostPlan.pruneManagedSkillRequests || []).find(item =>
        samePath(item.root, request.root)
      )
      if (existing) {
        existing.skillIds = [...new Set([
          ...(existing.skillIds || []),
          ...request.skillIds
        ])]
      } else {
        hostPlan.pruneManagedSkillRequests.push({
          root: request.root,
          skillIds: [...request.skillIds]
        })
      }
    }
    hostPlan.pruneManagedSkillRoots = (hostPlan.pruneManagedSkillRequests || [])
      .map(request => request.root)
    const pendingStaleManagedPaths = hostPlan.staleManagedPaths.map(portable)
    const previousEquivalent = previousReceipt &&
      previousReceipt.schemaVersion === GLOBAL_HOST_RECEIPT_SCHEMA &&
      previousReceipt.host === target.host &&
      previousReceipt.packageName === (packageJson.name || 'devcodex') &&
      previousReceipt.packageVersion === (packageJson.version || 'unknown') &&
      previousReceipt.sourceDigest === preReceiptDigest &&
      previousReceipt.planDigest === preReceiptDigest &&
      sameStringArray(previousReceipt.managedPaths, managedPaths) &&
      isDeepStrictEqual(previousReceipt.managedFileDigests || {}, managedFileDigests) &&
      isDeepStrictEqual(previousReceipt.managedArtifacts || [], managedArtifacts) &&
      isDeepStrictEqual(
        previousReceipt.retainedManagedArtifacts || [],
        hostPlan.retainedManagedArtifacts || []
      ) &&
      sameStringArray(previousReceipt.retainedRuntimeRoots || [], hostPlan.retainedRuntimeRoots || []) &&
      sameStringArray(previousReceipt.pendingStaleManagedPaths || [], pendingStaleManagedPaths) &&
      isDeepStrictEqual(
        previousReceipt.preservedNativeSkillCollisions || [],
        hostPlan.preservedNativeSkillCollisions || []
      ) &&
      previousReceipt.result === 'committed'
    const receipt = {
      schemaVersion: GLOBAL_HOST_RECEIPT_SCHEMA,
      mode: GLOBAL_HOST_CONFIG_SCHEMA,
      workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
      skillsDeployMode,
      skillsRuntimeRoot: target.shared && target.shared.skillsRuntime
        ? portable(target.shared.skillsRuntime)
        : null,
      host: target.host,
      support: target.support,
      evidenceCeiling: target.evidenceCeiling,
      packageName: packageJson.name || 'devcodex',
      packageVersion: packageJson.version || 'unknown',
      runtimeGeneration: target.runtimeGeneration || null,
      retainedRuntimeRoots: hostPlan.retainedRuntimeRoots || [],
      sourcePackageEvidence: {
        rootLifetime: 'install-process-only',
        durableIdentity: true,
        authority: 'RuntimeGenerationManifestV1'
      },
      runtimeRoot: portable(target.runtimeRoot),
      managedPaths,
      managedFileDigests,
      managedArtifacts,
      retainedManagedArtifacts: hostPlan.retainedManagedArtifacts || [],
      configFiles: managedPaths,
      pendingStaleManagedPaths,
      preservedNativeSkillCollisions: hostPlan.preservedNativeSkillCollisions || [],
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
    addFileOperation(
      hostPlan.operations,
      target.host,
      target.receiptFile,
      `${JSON.stringify(receipt, null, 2)}\n`,
      'json'
    )
    hostPlan.operations = hostPlan.operations.map(operation => bindPlanTimePrecondition(operation, fsImpl))
  }

  const finalOperations = hostPlans.flatMap(hostPlan => hostPlan.operations)
  return {
    schemaVersion: GLOBAL_HOST_CONFIG_SCHEMA,
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    skillsDeployMode,
    packageRoot,
    packageName: packageJson.name || 'devcodex',
    packageVersion: packageJson.version || 'unknown',
    sharedRuntimeOwnerHost,
    targets,
    hostPlans,
    operations: finalOperations,
    planDigest: preReceiptDigest,
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
      const fsImpl = options.fs || fs
      const transactionOperations = preserveSemanticallyEquivalentContent(hostPlan.operations, fsImpl)
      const safetyRoots = targetSafetyRoots(target)
      const hostTransaction = executeGlobalHostTransaction(transactionOperations, {
        fs: fsImpl,
        allowedRoots: [target.root, ...(target.additionalRoots || [])],
        allowedFiles: target.additionalFiles || [],
        safetyRoots,
        allowedByHost: {
          [target.host]: {
            allowedRoots: [target.root, ...(target.additionalRoots || [])],
            allowedFiles: target.additionalFiles || [],
            safetyRoots
          }
        },
        dryRun: options.dryRun === true,
        failAfter
      })
      hostTransaction.preservedNativeSkillCollisions = [
        ...(hostPlan.preservedNativeSkillCollisions || [])
      ]
      if (!options.dryRun && hostTransaction.status === 'committed') {
        const staleCleanup = removeStaleManagedPaths(
          hostPlan.staleManagedPaths,
          target,
          fsImpl,
          { requiredDigests: hostPlan.nativeStaleFileDigests || {} }
        )
        hostTransaction.removedStaleManagedPaths = staleCleanup.removed.map(portable)
        const pendingStaleManagedPaths = staleCleanup.failures.map(failure => failure.path)
        if (staleCleanup.failures.length) {
          hostTransaction.staleCleanupIncomplete = true
          hostTransaction.staleCleanupFailures = staleCleanup.failures
        }
        // Directory prune for hidden mode (must not use file-only stale cleanup)
        const pruneRequests = Array.isArray(hostPlan.pruneManagedSkillRequests)
          ? hostPlan.pruneManagedSkillRequests
          : (hostPlan.pruneManagedSkillRoots || []).map(root => ({
              root,
              skillIds: hostPlan.prunableSkillIds || hostPlan.managedSkillIds || []
            }))
        if (pruneRequests.length) {
          const pruned = []
          const pruneFailures = []
          for (const request of pruneRequests) {
            const scanRoot = request.root
            if (!targetAcceptsPath(target, scanRoot, fsImpl) &&
                !(target.shared && isUnderPhysical(target.shared.root, scanRoot, fsImpl))) {
              continue
            }
            const result = pruneManagedSkillDirs(
              scanRoot,
              request.skillIds || [],
              fsImpl,
              {
                dryRun: false,
                ownershipPaths: hostPlan.previousManagedPaths || [],
                ownershipDigests: hostPlan.previousManagedFileDigests || {}
              }
            )
            pruned.push(...result.removed.map(portable))
            pruneFailures.push(...result.failures)
            hostTransaction.preservedNativeSkillCollisions = [
              ...(hostTransaction.preservedNativeSkillCollisions || []),
              ...(result.preservedCollisions || [])
            ]
          }
          hostTransaction.prunedManagedSkillDirs = pruned
          hostTransaction.preservedNativeSkillCollisions = [
            ...(hostPlan.preservedNativeSkillCollisions || []),
            ...(hostTransaction.preservedNativeSkillCollisions || [])
          ].filter((item, index, all) =>
            all.findIndex(other => other.path === item.path) === index
          )
          if (pruneFailures.length) {
            hostTransaction.pruneManagedSkillIncomplete = true
            hostTransaction.pruneManagedSkillFailures = pruneFailures
          }
        }
        if (hostPlan.staleManagedPaths.length || pruneRequests.length) {
          const receiptOperation = hostPlan.operations.find(operation =>
            samePath(operation.path, target.receiptFile)
          )
          try {
            const receipt = parseJsonObject(receiptOperation.content, `${target.host} receipt finalization`)
            const finalizedReceipt = {
              ...receipt,
              pendingStaleManagedPaths,
              preservedNativeSkillCollisions:
                hostTransaction.preservedNativeSkillCollisions || [],
              updatedAt: sameStringArray(
                receipt.pendingStaleManagedPaths || [],
                pendingStaleManagedPaths
              ) && isDeepStrictEqual(
                receipt.preservedNativeSkillCollisions || [],
                hostTransaction.preservedNativeSkillCollisions || []
              )
                ? receipt.updatedAt
                : new Date().toISOString()
            }
            const finalizedContent = `${JSON.stringify(finalizedReceipt, null, 2)}\n`
            const finalizedOperation = bindPlanTimePrecondition({
              ...receiptOperation,
              content: finalizedContent,
              managedContent: finalizedContent
            }, fsImpl)
            const receiptFinalization = executeGlobalHostTransaction([finalizedOperation], {
              fs: fsImpl,
              allowedRoots: [target.root, ...(target.additionalRoots || [])],
              allowedFiles: target.additionalFiles || [],
              safetyRoots,
              allowedByHost: {
                [target.host]: {
                  allowedRoots: [target.root, ...(target.additionalRoots || [])],
                  allowedFiles: target.additionalFiles || [],
                  safetyRoots
                }
              }
            })
            hostTransaction.changed += receiptFinalization.changed || 0
            hostTransaction.receiptFinalization = receiptFinalization.status
          } catch (error) {
            hostTransaction.receiptFinalizationIncomplete = true
            hostTransaction.receiptFinalizationError = error.message
          }
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
    receiptFinalizationIncomplete: successful.some(item => item.receiptFinalizationIncomplete === true),
    receiptFinalizationFailures: successful
      .filter(item => item.receiptFinalizationIncomplete === true)
      .map(item => ({
        host: item.host,
        error: item.receiptFinalizationError || 'receipt finalization failed'
      })),
    staleCleanupIncomplete: successful.some(item => item.staleCleanupIncomplete === true),
    staleCleanupFailures: successful.flatMap(item =>
      (item.staleCleanupFailures || []).map(failure => ({ host: item.host, ...failure }))
    ),
    hosts: hostTransactions
  }
  return { ...plan, transaction }
}

function inspectGlobalHostConfiguration(options = {}) {
  const fsImpl = options.fs || fs
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const packageJson = readPackage(packageRoot, fsImpl)
  const runtimeGeneration = buildRuntimeGeneration(packageRoot, fsImpl)
  const requestedHosts = options.hosts || GLOBAL_HOST_IDS
  const targetResults = requestedHosts.map(host => {
    try {
      return {
        host,
        target: resolveGlobalHostTarget(host, {
          env: options.env || process.env,
          home: options.home,
          packageRoot,
          fs: fsImpl,
          runtimeGeneration
        }),
        issue: null
      }
    } catch (error) {
      if (!isHostTargetPermissionError(error)) throw error
      return {
        host,
        target: null,
        issue: buildHostTargetUnverifiedIssue(error)
      }
    }
  })
  const targets = targetResults.flatMap(result => result.target ? [result.target] : [])
  const sharedRuntimeOwnerHost = requestedHosts.includes('codex')
    ? 'codex'
    : requestedHosts[0]
  const expectedPlan = buildGlobalHostConfigPlan({
    ...options,
    fs: fsImpl,
    packageRoot,
    [INSPECTION_RESOLVED_TARGETS]: targets,
    [INSPECTION_SHARED_RUNTIME_OWNER]: sharedRuntimeOwnerHost
  })
  const hosts = targetResults.map(result => {
    if (!result.target) {
      return buildUnverifiedHostInspection(result.host, result.issue)
    }
    const target = result.target
    try {
    let receipt = null
    let error = null
    try {
      receipt = parseJsonObject(readText(target.receiptFile, fsImpl), `${target.host} receipt`)
    } catch (caught) {
      if (isHostTargetPermissionError(caught)) throw caught
      error = caught.message
    }
    const runtimeEntry = path.join(
      target.runtimeRoot,
      'hooks',
      '_runtime',
      ['claude', 'cursor'].includes(target.host)
        ? 'lifecycle-cursor-compatible.cjs'
        : 'lifecycle-host-adapters.cjs'
    )
    const configFiles = Array.isArray(receipt?.configFiles)
      ? receipt.configFiles.map(file => path.resolve(file))
      : []
    const managedPaths = Array.isArray(receipt?.managedPaths)
      ? receipt.managedPaths.map(file => path.resolve(file))
      : []
    const pendingStaleManagedPaths = Array.isArray(receipt?.pendingStaleManagedPaths)
      ? receipt.pendingStaleManagedPaths.map(file => path.resolve(file))
      : []
    const expectedHostPlan = expectedPlan.hostPlans.find(item => item.host === target.host)
    const expectedReceiptOperation = expectedHostPlan?.operations.find(operation =>
      samePath(operation.path, target.receiptFile)
    )
    const driftedConfigFiles = (expectedHostPlan?.operations || [])
      .filter(operation => !samePath(operation.path, target.receiptFile))
      .filter(operation => fsImpl.existsSync(operation.path))
      .filter(operation => !operationMatchesCurrent(operation, fsImpl))
      .map(operation => operation.path)
    let expectedReceipt = null
    try {
      expectedReceipt = expectedReceiptOperation
        ? parseJsonObject(expectedReceiptOperation.content, `${target.host} expected receipt`)
        : null
    } catch {
      expectedReceipt = null
    }
    const invalidConfigFiles = configFiles.filter(file => !targetAcceptsPath(target, file, fsImpl))
    const invalidPendingStaleManagedPaths = pendingStaleManagedPaths
      .filter(file => !targetAcceptsPath(target, file, fsImpl))
    const missingConfigFiles = configFiles
      .filter(file => targetAcceptsPath(target, file, fsImpl))
      .filter(file => !fsImpl.existsSync(file))
    // Entrypoints depend on skillsDeployMode: hidden requires G_RUNTIME, not empty L1 scan roots.
    const modeForInspect = (receipt && receipt.skillsDeployMode) ||
      resolveSkillsDeployMode(options.env || process.env, options)
    const sharedEntrypoints = []
    if (target.shared) {
      if (target.shared.fullFallback) sharedEntrypoints.push(target.shared.fullFallback)
      if (modeForInspect === 'legacy') {
        if (target.shared.skills) sharedEntrypoints.push(target.shared.skills)
      } else if (target.shared.skillsRuntime) {
        sharedEntrypoints.push(target.shared.skillsRuntime)
      }
    }
    const fileEntrypoints = Object.entries(target.files || {})
      .filter(([key, value]) => {
        if (!value) return false
        if (modeForInspect !== 'legacy' && key === 'skills') return false
        return true
      })
      .map(([, value]) => value)
    const requiredEntrypoints = [
      runtimeEntry,
      path.join(target.runtimeRoot, 'runtime-generation.json'),
      ...fileEntrypoints,
      ...sharedEntrypoints
    ]
    const missingEntrypoints = requiredEntrypoints.filter(file => !fsImpl.existsSync(file))
    const runtimeDeclared = configFiles.some(file => samePath(file, runtimeEntry))
    const receiptFieldsComplete = receipt?.schemaVersion === GLOBAL_HOST_RECEIPT_SCHEMA &&
      receipt.mode === GLOBAL_HOST_CONFIG_SCHEMA &&
      receipt.workspaceCleanMode === 'GlobalOnlyWorkspaceCleanModeV1' &&
      receipt.host === target.host &&
      typeof receipt.packageName === 'string' &&
      typeof receipt.packageVersion === 'string' &&
      receipt.runtimeGeneration?.schemaVersion === 'RuntimeGenerationManifestV1' &&
      receipt.runtimeGeneration?.generationId === target.runtimeGeneration?.generationId &&
      samePath(receipt.runtimeRoot, target.runtimeRoot) &&
      typeof receipt.sourceDigest === 'string' &&
      typeof receipt.planDigest === 'string' &&
      Array.isArray(receipt.managedPaths) &&
      Array.isArray(receipt.managedArtifacts) &&
      Array.isArray(receipt.retainedManagedArtifacts) &&
      Array.isArray(receipt.retainedRuntimeRoots) &&
      receipt.managedFileDigests &&
      typeof receipt.managedFileDigests === 'object' &&
      !Array.isArray(receipt.managedFileDigests) &&
      Array.isArray(receipt.pendingStaleManagedPaths) &&
      Object.prototype.hasOwnProperty.call(receipt, 'previousStateRef') &&
      receipt.result === 'committed' &&
      typeof receipt.updatedAt === 'string'
    const receiptMatchesCurrent = Boolean(expectedReceipt) &&
      receipt?.packageName === expectedReceipt.packageName &&
      receipt?.packageVersion === expectedReceipt.packageVersion &&
      receipt?.runtimeGeneration?.generationId === expectedReceipt.runtimeGeneration?.generationId &&
      samePath(receipt?.runtimeRoot, expectedReceipt.runtimeRoot) &&
      receipt?.sourceDigest === expectedReceipt.sourceDigest &&
      receipt?.planDigest === receipt?.sourceDigest &&
      sameStringArray(receipt?.managedPaths, expectedReceipt.managedPaths) &&
      isDeepStrictEqual(
        receipt?.managedFileDigests || {},
        expectedReceipt.managedFileDigests || {}
      ) &&
      isDeepStrictEqual(
        receipt?.managedArtifacts || [],
        expectedReceipt.managedArtifacts || []
      ) &&
      isDeepStrictEqual(
        receipt?.retainedManagedArtifacts || [],
        expectedReceipt.retainedManagedArtifacts || []
      ) &&
      sameStringArray(receipt?.retainedRuntimeRoots || [], expectedReceipt.retainedRuntimeRoots || []) &&
      sameStringArray(receipt?.pendingStaleManagedPaths, expectedReceipt.pendingStaleManagedPaths)
    const stale = Boolean(receipt) && (!receiptFieldsComplete || !receiptMatchesCurrent)
    const configured = Boolean(receipt) &&
      configFiles.length > 0 &&
      managedPaths.length > 0 &&
      runtimeDeclared
    const guidance = describeGlobalAdapterRefreshForPackageRoot(packageRoot, {
      fs: fsImpl,
      packageVersion: expectedReceipt?.packageVersion || null
    })
    const configurationIssues = []
    if (error) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_RECEIPT_INVALID',
        phase: 'configuration',
        evidence: error,
        nextStep: guidance.nextStepInstall
      })
    } else if (!receipt) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_RECEIPT_MISSING',
        phase: 'configuration',
        evidence: target.receiptFile,
        nextStep: guidance.nextStepInstall
      })
    } else if (stale) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_RECEIPT_STALE',
        phase: 'configuration',
        evidence: target.receiptFile,
        nextStep: guidance.nextStepRefresh
      })
    }
    for (const file of invalidConfigFiles) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_CONFIG_PATH_INVALID',
        phase: 'configuration',
        evidence: portable(file),
        nextStep: 'Review the receipt boundary, then reinstall the global package.'
      })
    }
    for (const file of invalidPendingStaleManagedPaths) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_STALE_PATH_OUTSIDE_ROOT',
        phase: 'configuration',
        evidence: portable(file),
        nextStep: 'Review the receipt boundary, then reinstall the global package.'
      })
    }
    for (const file of pendingStaleManagedPaths.filter(file => targetAcceptsPath(target, file, fsImpl))) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_STALE_CLEANUP_PENDING',
        phase: 'configuration',
        evidence: portable(file),
        nextStep: guidance.nextStepRefresh
      })
    }
    for (const file of missingConfigFiles) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_CONFIG_PATH_MISSING',
        phase: 'configuration',
        evidence: portable(file),
        nextStep: guidance.nextStepInstall
      })
    }
    for (const file of missingEntrypoints) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_ENTRYPOINT_MISSING',
        phase: 'configuration',
        evidence: portable(file),
        nextStep: guidance.nextStepInstall
      })
    }
    for (const file of driftedConfigFiles) {
      configurationIssues.push({
        code: 'GLOBAL_HOST_MANAGED_CONFIG_DRIFT',
        phase: 'configuration',
        evidence: portable(file),
        nextStep: guidance.nextStepRefresh
      })
    }
    const ready = receipt?.schemaVersion === GLOBAL_HOST_RECEIPT_SCHEMA &&
      receipt.host === target.host &&
      receiptFieldsComplete &&
      receiptMatchesCurrent &&
      configFiles.length > 0 &&
      managedPaths.length > 0 &&
      runtimeDeclared &&
      invalidConfigFiles.length === 0 &&
      invalidPendingStaleManagedPaths.length === 0 &&
      pendingStaleManagedPaths.length === 0 &&
      missingConfigFiles.length === 0 &&
      missingEntrypoints.length === 0 &&
      driftedConfigFiles.length === 0
    return {
      host: target.host,
      support: target.support,
      root: target.root,
      receiptFile: target.receiptFile,
      runtimeEntry,
      configFilesDeclared: configFiles.length,
      invalidConfigFiles: invalidConfigFiles.map(portable),
      invalidPendingStaleManagedPaths: invalidPendingStaleManagedPaths.map(portable),
      pendingStaleManagedPaths: pendingStaleManagedPaths.map(portable),
      missingConfigFiles: missingConfigFiles.map(portable),
      missingEntrypoints: missingEntrypoints.map(portable),
      driftedConfigFiles: driftedConfigFiles.map(portable),
      configured,
      configurationIssues,
      receiptFieldsComplete,
      receiptMatchesCurrent,
      ready,
      stale,
      packageVersion: receipt?.packageVersion || null,
      error,
      inspectionStatus: 'PASS'
    }
    } catch (error) {
      if (!isHostTargetPermissionError(error)) throw error
      return buildUnverifiedHostInspection(
        result.host,
        buildHostTargetUnverifiedIssue(error)
      )
    }
  })
  return {
    schemaVersion: 'GlobalHostConfigInspectionV1',
    mode: GLOBAL_HOST_CONFIG_SCHEMA,
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: packageJson.version || 'unknown',
    ready: hosts.every(host => host.ready),
    hosts
  }
}

function inspectGlobalHostConfig(options = {}) {
  const configuration = inspectGlobalHostConfiguration(options)
  const { verifyGlobalHostRuntime } = require('./global-host-runtime-verifier.js')
  return verifyGlobalHostRuntime({
    configuration,
    fs: options.fs || fs,
    spawnSync: options.spawnSync,
    env: options.env || process.env,
    home: options.home,
    cwd: options.cwd,
    depth: options.depth,
    timeoutMs: options.timeoutMs
  })
}

module.exports = {
  GLOBAL_HOST_CONFIG_SCHEMA,
  GLOBAL_HOST_RECEIPT_SCHEMA,
  MCP_RUNTIME_DEPS,
  applyGlobalHostConfig,
  buildGlobalHostConfigPlan,
  buildCopilotMcpServers,
  cursorHookDocument,
  buildMcpServers,
  buildVscodeMcpServers,
  hostToRuntimeAgent,
  mergeVscodeUserMcpContent,
  copilotHookDocument,
  digestPlan,
  inspectGlobalHostConfig,
  inspectGlobalHostConfiguration,
  portable,
  shellCommand,
  walkFiles
}
