'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveGlobalHostTarget, samePath } = require('./global-host-target.js')
const { isDevCodexManagedHookEntry } = require('./global-host-config-merge.js')
const { buildGrokCliEnv } = require('./grok-cli-env.js')
const { inspectNodeRuntimeReadiness } = require('./node-runtime-readiness.js')

const EXECUTABLE_ADAPTER_HOSTS = Object.freeze(['copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor'])
const NATIVE_COMMANDS = Object.freeze({
  copilot: { command: 'copilot', args: ['--version'] },
  claude: { command: 'claude', args: ['--version'] },
  codex: { command: 'codex', args: ['--version'] },
  gemini: { command: 'gemini', args: ['--version'] },
  grok: { command: 'grok', args: ['version'] },
  cursor: {
    command: 'agent',
    windowsCommandCandidates: Object.freeze(['cursor-agent', 'agent']),
    args: ['--version'],
    identityArgs: ['--help'],
    identityPattern: /\bcursor\b/i,
    rejectedIdentities: Object.freeze([
      Object.freeze({ host: 'grok', pattern: /\bgrok\b/i })
    ])
  }
})

function readJson(file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function probeIssue(code, phase, evidence, nextStep) {
  return { code, phase, evidence: String(evidence || ''), nextStep: String(nextStep || '') }
}

function unavailable(result) {
  return Boolean(
    result?.error?.code === 'ENOENT' ||
    result?.error?.code === 'EACCES' ||
    (result?.status === null && !result?.signal && !result?.stdout && !result?.stderr)
  )
}

function envValue(env, name) {
  const key = Object.keys(env || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase())
  return key ? String(env[key] || '') : ''
}

function resolveWindowsNativeCommand(command, options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const raw = String(command || '').trim()
  if (!raw) return { status: 'missing', command: raw, resolvedPath: null, accessErrors: [] }
  const extensions = path.extname(raw)
    ? ['']
    : (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => value.startsWith('.') ? value : `.${value}`)
  const entries = /[\\/]/.test(raw)
    ? ['']
    : envValue(env, 'PATH')
        .split(';')
        .map(value => value.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
        .slice(0, 128)
  const accessErrors = []
  for (const entry of entries) {
    for (const extension of extensions) {
      const candidate = path.resolve(entry || '.', `${raw}${extension}`)
      try {
        if (fsImpl.statSync(candidate).isFile()) {
          return {
            status: 'resolved',
            command: raw,
            resolvedPath: candidate,
            extension: path.extname(candidate).toLowerCase(),
            accessErrors
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR' && accessErrors.length < 5) {
          accessErrors.push({ path: candidate, errorCode: error?.code || 'UNKNOWN' })
        }
      }
    }
  }
  return {
    status: accessErrors.length ? 'unverified' : 'missing',
    command: raw,
    resolvedPath: null,
    accessErrors
  }
}

function buildWindowsNativeInvocation(command, args, options = {}) {
  const env = options.env || process.env
  const resolution = options.resolution || resolveWindowsNativeCommand(command, options)
  if (resolution.status !== 'resolved') {
    return { command, args, resolution, windowsVerbatimArguments: false }
  }
  if (resolution.extension === '.cmd' || resolution.extension === '.bat') {
    const comspec = envValue(env, 'COMSPEC') || path.join(envValue(env, 'SystemRoot') || 'C:\\Windows', 'System32', 'cmd.exe')
    return {
      command: comspec,
      args: ['/d', '/c', resolution.resolvedPath, ...args],
      resolution,
      windowsVerbatimArguments: false
    }
  }
  return {
    command: resolution.resolvedPath,
    args,
    resolution,
    windowsVerbatimArguments: false
  }
}

function nativeProbeInvocation(spec, args, options = {}) {
  const platform = options.platform || process.platform
  const shouldResolveWindows = platform === 'win32' && (
    options.resolveWindowsCommand === true || options.nativeSpawnInjected !== true
  )
  if (!shouldResolveWindows) {
    return {
      command: spec.command,
      args,
      resolution: { status: 'ambient', command: spec.command, resolvedPath: null },
      windowsVerbatimArguments: false
    }
  }
  const candidates = Array.isArray(spec.windowsCommandCandidates) && spec.windowsCommandCandidates.length
    ? spec.windowsCommandCandidates
    : [spec.command]
  for (const command of candidates) {
    const resolution = resolveWindowsNativeCommand(command, options)
    if (resolution.status === 'resolved') {
      return buildWindowsNativeInvocation(command, args, { ...options, resolution })
    }
  }
  return buildWindowsNativeInvocation(spec.command, args, options)
}

function parseProbeOutput(result) {
  try {
    return JSON.parse(String(result?.stdout || '').trim())
  } catch {
    return null
  }
}

function adapterContractProbe(host, runtimeEntry, options = {}) {
  if (!EXECUTABLE_ADAPTER_HOSTS.includes(host) || !runtimeEntry || !options.fs.existsSync(runtimeEntry)) {
    return {
      status: 'failed',
      evidence: { runtimeEntry: runtimeEntry || null },
      issues: [probeIssue(
        'HOST_ADAPTER_ENTRY_MISSING',
        'contract',
        runtimeEntry || '(missing)',
        'Run npm install -g devcodex to restore the user-global runtime.'
      )]
    }
  }
  const result = options.spawnSync(process.execPath, [runtimeEntry, host, '--contract-probe'], {
    encoding: 'utf8',
    windowsHide: true,
    env: options.env,
    timeout: options.timeoutMs
  })
  if (unavailable(result)) {
    return {
      status: 'unverified',
      evidence: { runtimeEntry, error: result?.error?.code || 'spawn-unavailable' },
      issues: [probeIssue(
        'HOST_ADAPTER_PROBE_UNAVAILABLE',
        'contract',
        result?.error?.code || 'spawn unavailable',
        'Run devcodex doctor after Node execution is available.'
      )]
    }
  }
  const payload = parseProbeOutput(result)
  if (
    result.status !== 0 ||
    payload?.schemaVersion !== 'HostLifecycleAdapterContractProbeV1' ||
    payload?.host !== host ||
    payload?.status !== 'passed'
  ) {
    return {
      status: 'failed',
      evidence: {
        runtimeEntry,
        exitCode: result.status,
        stderr: String(result.stderr || '').trim(),
        payload
      },
      issues: [probeIssue(
        'HOST_ADAPTER_CONTRACT_FAILED',
        'contract',
        String(result.stderr || result.stdout || `exit ${result.status}`).trim(),
        'Refresh the global package and inspect the installed lifecycle adapter.'
      )]
    }
  }
  return { status: 'passed', evidence: payload, issues: [] }
}

function grokPluginIdentities(target, fsImpl = fs) {
  const registryFile = path.join(target.root, 'installed-plugins', 'registry.json')
  const registry = readJson(registryFile, fsImpl)
  const identities = Object.entries(registry?.repos || {})
    .filter(([, entry]) => Object.prototype.hasOwnProperty.call(entry?.plugins || {}, 'devcodex-workspace'))
    .map(([repoId, entry]) => ({
      repoId,
      source: entry?.kind?.source_path ? path.resolve(entry.kind.source_path) : null,
      installedPath: entry?.path ? path.resolve(entry.path) : null,
      canonical: Boolean(entry?.kind?.source_path && samePath(entry.kind.source_path, target.files.plugin))
    }))
  return { registryFile, present: Boolean(registry), identities }
}

function grokStaticContract(target, options = {}) {
  const issues = []
  const registry = grokPluginIdentities(target, options.fs)
  const canonical = registry.identities.filter(identity => identity.canonical)
  let registryStatus = 'passed'
  if (!registry.present || registry.identities.length === 0) {
    registryStatus = 'unverified'
    issues.push(probeIssue(
      'GROK_PLUGIN_REGISTRY_UNVERIFIED',
      'contract',
      registry.registryFile,
      'Run npm install -g devcodex with Grok CLI available, then re-run doctor.'
    ))
  } else if (registry.identities.length !== 1 || canonical.length !== 1) {
    registryStatus = 'failed'
    issues.push(probeIssue(
      'GROK_PLUGIN_DUPLICATE_MANAGED_IDENTITY',
      'contract',
      JSON.stringify(registry.identities),
      'Run npm install -g devcodex to converge the managed Grok plugin identity.'
    ))
  }

  const mcpFile = path.join(target.files.plugin, '.mcp.json')
  const mcp = readJson(mcpFile, options.fs)
  const expectedServers = {
    'devcodex-memory': path.join(target.runtimeRoot, 'mcp', 'memory-server.js'),
    'devcodex-profile': path.join(target.runtimeRoot, 'mcp', 'profile-server.js')
  }
  let mcpStatus = 'passed'
  for (const [name, serverPath] of Object.entries(expectedServers)) {
    const args = mcp?.mcpServers?.[name]?.args || []
    if (!options.fs.existsSync(serverPath) || !args.some(value => samePath(String(value), serverPath))) {
      mcpStatus = 'failed'
      issues.push(probeIssue(
        'GROK_MCP_CONTRACT_FAILED',
        'contract',
        `${name}:${mcpFile}`,
        'Refresh the Grok user-global plugin and stable runtime.'
      ))
    }
  }
  const status = registryStatus === 'failed' || mcpStatus === 'failed'
    ? 'failed'
    : (registryStatus === 'unverified' ? 'unverified' : 'passed')
  return { status, registryStatus, mcpStatus, registry, mcpFile, expectedServers, issues }
}

function cursorStaticContract(target, options = {}) {
  const fsImpl = options.fs || fs
  const issues = []
  const hooks = readJson(target.files.hooks, fsImpl)
  const runtimeEntry = path.join(target.runtimeRoot, 'hooks', '_runtime', 'lifecycle-cursor-compatible.cjs')
  const requiredEvents = [
    'workspaceOpen',
    'sessionStart',
    'sessionEnd',
    'beforeSubmitPrompt',
    'preToolUse',
    'postToolUse',
    'postToolUseFailure',
    'afterAgentResponse',
    'preCompact',
    'stop'
  ]
  const eventStatus = {}
  const eventManagedCounts = {}
  const expectedCommand = `node "${runtimeEntry}" cursor --cursor-plugin-path "${target.files.plugin}"`
  const normalizeCommand = value => String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase()
  for (const event of requiredEvents) {
    const entries = Array.isArray(hooks?.hooks?.[event]) ? hooks.hooks[event] : []
    const managed = entries.filter(isDevCodexManagedHookEntry)
    const current = managed.filter(entry =>
      normalizeCommand(entry?.command) === normalizeCommand(expectedCommand)
    )
    eventManagedCounts[event] = {
      current: current.length,
      managed: managed.length
    }
    eventStatus[event] = current.length === 1 && managed.length === 1
    if (!eventStatus[event]) {
      issues.push(probeIssue(
        'CURSOR_HOOK_CONTRACT_FAILED',
        'contract',
        `${event}:current=${current.length}:managed=${managed.length}:${target.files.hooks}`,
        'Refresh the Cursor user-global Hook configuration.'
      ))
    }
  }

  const manifestFile = path.join(target.files.plugin, '.cursor-plugin', 'plugin.json')
  const manifest = readJson(manifestFile, fsImpl)
  const skillFile = path.join(target.files.plugin, 'skills', 'devcodex-workspace', 'SKILL.md')
  const pluginHooksFile = path.join(target.files.plugin, 'hooks', 'hooks.json')
  const skillContractAnchors = [
    'skill_route',
    'Never invent project, turnBinding, contextEpoch, generation or',
    'Next call (exact)'
  ]
  let skillContent = ''
  try {
    skillContent = fsImpl.readFileSync(skillFile, 'utf8')
  } catch {}
  const missingSkillAnchors = skillContractAnchors.filter(anchor => !skillContent.includes(anchor))
  const skillContractStatus = missingSkillAnchors.length === 0
  const pluginStatus = Boolean(
    manifest?.name === 'devcodex-workspace' &&
    typeof manifest?.version === 'string' &&
    manifest.version &&
    manifest.skills === './skills' &&
    manifest.mcpServers === './mcp.json' &&
    fsImpl.existsSync(skillFile) &&
    skillContractStatus &&
    !fsImpl.existsSync(pluginHooksFile)
  )
  if (!pluginStatus) {
    issues.push(probeIssue(
      'CURSOR_PLUGIN_CONTRACT_FAILED',
      'contract',
      manifestFile,
      'Refresh the Cursor user-global DevCodex Plugin.'
    ))
  }

  const mcpFile = path.join(target.files.plugin, 'mcp.json')
  const mcp = readJson(mcpFile, fsImpl)
  const expectedServers = {
    'devcodex-memory': path.join(target.runtimeRoot, 'mcp', 'memory-server.js'),
    'devcodex-profile': path.join(target.runtimeRoot, 'mcp', 'profile-server.js')
  }
  let mcpStatus = true
  for (const [name, serverPath] of Object.entries(expectedServers)) {
    const server = mcp?.mcpServers?.[name]
    const args = Array.isArray(server?.args) ? server.args : []
    if (
      server?.type !== 'stdio' ||
      server?.command !== 'node' ||
      server?.env?.DEVCODEX_AGENT !== 'cursor' ||
      !fsImpl.existsSync(serverPath) ||
      !args.some(value => samePath(String(value), serverPath)) ||
      args[1] !== '${workspaceFolder}'
    ) {
      mcpStatus = false
      issues.push(probeIssue(
        'CURSOR_MCP_CONTRACT_FAILED',
        'contract',
        name + ':' + mcpFile,
        'Refresh the Cursor Plugin and immutable DevCodex runtime.'
      ))
    }
  }

  return {
    status: issues.length ? 'failed' : 'passed',
    hooksFile: target.files.hooks,
    eventStatus,
    eventManagedCounts,
    manifestFile,
    pluginStatus,
    skillFile,
    skillContractStatus,
    missingSkillAnchors,
    pluginHooksAbsent: !fsImpl.existsSync(pluginHooksFile),
    mcpFile,
    mcpStatus,
    expectedServers,
    issues
  }
}

function cursorVariantMatrix(adapterReady, nativeProbe) {
  const cliDetected = nativeProbe?.status === 'passed'
  const cliEvidence = cliDetected
    ? 'agent --version passed; direct Hook/MCP replay still pending'
    : 'Cursor agent CLI not directly available; native replay pending'
  return [
    {
      id: 'cursor-ide-local',
      support: 'beta',
      configured: adapterReady,
      adapterReady,
      nativeStatus: 'unverified',
      evidence: 'user-global Hook and Plugin contract only; direct Desktop replay pending'
    },
    {
      id: 'cursor-cli-interactive',
      support: 'beta',
      configured: adapterReady,
      adapterReady,
      nativeStatus: 'unverified',
      cliDetected,
      evidence: cliEvidence
    },
    {
      id: 'cursor-cli-headless',
      support: 'beta',
      configured: adapterReady,
      adapterReady,
      nativeStatus: 'unverified',
      cliDetected,
      evidence: cliEvidence
    },
    {
      id: 'cursor-cloud-agent',
      support: 'partial',
      configured: false,
      adapterReady: false,
      nativeStatus: 'unverified',
      evidence: 'Cursor Cloud does not load user-level Hooks, workspaceOpen or sessionStart'
    }
  ]
}

function nativeVersionProbe(host, options = {}) {
  if (options.depth !== 'deep') {
    return { status: 'unverified', evidence: { reason: 'status-light-probe' }, issues: [] }
  }
  const spec = NATIVE_COMMANDS[host]
  const spawn = options.spawnSync || spawnSync
  const invocation = nativeProbeInvocation(spec, spec.args, options)
  const result = spawn(invocation.command, invocation.args, {
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    env: options.env,
    timeout: options.timeoutMs
  })
  const resolvedCommand = invocation.resolution?.resolvedPath || invocation.resolution?.command || spec.command
  if (unavailable(result)) {
    return {
      status: 'unavailable',
      evidence: { command: spec.command, resolvedCommand, error: result?.error?.code || 'not-found' },
      issues: [probeIssue(
        'HOST_NATIVE_PROBE_UNAVAILABLE',
        'native',
        `${resolvedCommand}: ${result?.error?.code || 'not-found'}`,
        `Install or repair the ${host} CLI, then re-run devcodex doctor.`
      )]
    }
  }
  if (result.status !== 0) {
    return {
      status: 'failed',
      evidence: {
        command: spec.command,
        resolvedCommand,
        exitCode: result.status,
        output: String(result.stderr || result.stdout || '').trim()
      },
      issues: [probeIssue(
        'HOST_NATIVE_PROBE_FAILED',
        'native',
        `${spec.command} exit ${result.status}`,
        `Repair the ${host} CLI, then re-run devcodex doctor.`
      )]
    }
  }
  const version = String(result.stdout || result.stderr || '').trim()
  if (spec.identityPattern && !spec.identityPattern.test(version)) {
    const identityInvocation = Array.isArray(spec.identityArgs)
      ? nativeProbeInvocation(spec, spec.identityArgs, {
          ...options,
          resolution: invocation.resolution
        })
      : null
    const identityResult = identityInvocation
      ? spawn(identityInvocation.command, identityInvocation.args, {
          encoding: 'utf8',
          windowsHide: true,
          windowsVerbatimArguments: identityInvocation.windowsVerbatimArguments,
          env: options.env,
          timeout: options.timeoutMs
        })
      : null
    const identityOutput = String(identityResult?.stdout || identityResult?.stderr || '').trim()
    const combinedIdentityOutput = `${version}\n${identityOutput}`.trim()
    if (!spec.identityPattern.test(combinedIdentityOutput)) {
      const rejected = (spec.rejectedIdentities || []).find(item => item.pattern.test(combinedIdentityOutput))
      const code = rejected ? 'HOST_NATIVE_IDENTITY_MISMATCH' : 'HOST_NATIVE_IDENTITY_UNVERIFIED'
      const detail = rejected
        ? `${resolvedCommand} resolved to ${rejected.host}, not ${host}`
        : `${resolvedCommand} output did not identify ${host}`
      return {
        status: 'unverified',
        evidence: {
          command: spec.command,
          resolvedCommand,
          version,
          identityOutput: identityOutput.slice(0, 300),
          identityStatus: rejected ? 'mismatch' : 'unverified',
          detectedHost: rejected?.host || null
        },
        issues: [probeIssue(
          code,
          'native',
          detail,
          `Ensure the ${host} CLI executable is available as cursor-agent or agent on PATH, then re-run devcodex doctor.`
        )]
      }
    }
  }
  return {
    status: 'passed',
    evidence: {
      command: spec.command,
      resolvedCommand,
      version,
      identityStatus: spec.identityPattern ? 'matched' : 'not-required'
    },
    issues: []
  }
}

function mcpInitializeProbe(serverPath, cwd, options = {}) {
  const spawn = options.spawnSync || spawnSync
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  const result = spawn(process.execPath, [serverPath, cwd], {
    cwd,
    input: `${request}\n`,
    encoding: 'utf8',
    windowsHide: true,
    env: options.env,
    timeout: options.timeoutMs
  })
  const lines = String(result?.stdout || '').trim().split(/\r?\n/).filter(Boolean)
  let response = null
  try { response = lines.length ? JSON.parse(lines[0]) : null } catch { response = null }
  return {
    passed: result?.status === 0 && response?.id === 1 && Boolean(response?.result),
    exitCode: result?.status,
    response,
    error: result?.error?.code || String(result?.stderr || '').trim() || null
  }
}

/**
 * Bounded tools/call smoke (M0). Default deadline 8000ms.
 * @returns {{ passed: boolean, timedOut?: boolean, exitCode?: number|null, textHead?: string, latencyMs?: number|null, error?: string|null }}
 */
function mcpToolCallProbe(serverPath, cwd, toolName, toolArgs = {}, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000
  const spawn = options.spawnSync || spawnSync
  if (!serverPath || (options.fs || fs).existsSync?.(serverPath) === false) {
    if (options.fs && typeof options.fs.existsSync === 'function' && !options.fs.existsSync(serverPath)) {
      return { passed: false, error: 'server-missing', textHead: '', latencyMs: null }
    }
    if (!options.fs && serverPath && !fs.existsSync(serverPath)) {
      return { passed: false, error: 'server-missing', textHead: '', latencyMs: null }
    }
  }
  const init = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'devcodex-mcp-probe', version: '1' } }
  })
  const call = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: toolName, arguments: toolArgs || {} }
  })
  const t0 = Date.now()
  const result = spawn(process.execPath, [serverPath, cwd || process.cwd()], {
    cwd: cwd || process.cwd(),
    input: `${init}\n${call}\n`,
    encoding: 'utf8',
    windowsHide: true,
    env: options.env || process.env,
    timeout: timeoutMs
  })
  const latencyMs = Date.now() - t0
  const timedOut = Boolean(result?.error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM')
  if (timedOut) {
    return {
      passed: false,
      timedOut: true,
      exitCode: result?.status,
      textHead: 'timeout',
      latencyMs,
      error: 'ETIMEDOUT'
    }
  }
  const lines = String(result?.stdout || '').trim().split(/\r?\n/).filter(Boolean)
  let toolResponse = null
  for (const line of lines) {
    try {
      const msg = JSON.parse(line)
      if (msg.id === 2) toolResponse = msg
    } catch { /* ignore partial */ }
  }
  if (!toolResponse) {
    return {
      passed: false,
      timedOut: false,
      exitCode: result?.status,
      textHead: String(result?.stdout || result?.stderr || '').slice(0, 200),
      latencyMs,
      error: result?.error?.code || 'no-tools-call-response'
    }
  }
  const text = String(toolResponse.result?.content?.[0]?.text || toolResponse.error?.message || '')
  const isError = Boolean(toolResponse.result?.isError || toolResponse.error)
  // Deploy health: MODULE_NOT_FOUND is always fail; other isError may be valid business errors
  if (/Cannot find module|MODULE_NOT_FOUND|executable-absorption-gates/i.test(text)) {
    return {
      passed: false,
      timedOut: false,
      exitCode: result?.status,
      textHead: text.slice(0, 300),
      latencyMs,
      error: 'module-missing'
    }
  }
  if (options.requireSuccess === true && isError) {
    return {
      passed: false,
      timedOut: false,
      exitCode: result?.status,
      textHead: text.slice(0, 300),
      latencyMs,
      error: 'tool-is-error'
    }
  }
  // Default: got a tools/call response within deadline and no missing-module → pass (smoke)
  return {
    passed: true,
    timedOut: false,
    exitCode: result?.status,
    textHead: text.slice(0, 300),
    latencyMs,
    error: null,
    isError
  }
}

function grokInstalledHookProbe(installedPath, cwd, options = {}) {
  const hookPath = installedPath
    ? path.join(installedPath, 'hooks', 'devcodex-workspace.cjs')
    : null
  if (!hookPath || !options.fs.existsSync(hookPath)) {
    return {
      passed: false,
      hookPath,
      payload: null,
      error: 'installed hook entry missing'
    }
  }
  const result = options.spawnSync(process.execPath, [hookPath, '--contract-probe'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: options.env,
    timeout: options.timeoutMs
  })
  const payload = parseProbeOutput(result)
  return {
    passed: result?.status === 0 &&
      payload?.schemaVersion === 'GrokWorkspaceHookContractProbeV1' &&
      payload?.status === 'passed',
    hookPath,
    exitCode: result?.status,
    payload,
    error: result?.error?.code || String(result?.stderr || '').trim() || null
  }
}

function deepGrokProbe(target, cwd, options = {}) {
  if (options.depth !== 'deep') return { status: 'unverified', evidence: {}, issues: [] }
  const issues = []
  const pluginList = options.spawnSync('grok', ['plugin', 'list', '--json'], {
    encoding: 'utf8',
    windowsHide: true,
    env: options.env,
    timeout: options.timeoutMs
  })
  let pluginListPayload = null
  try { pluginListPayload = JSON.parse(String(pluginList.stdout || '')) } catch { pluginListPayload = null }
  const managedPluginList = (Array.isArray(pluginListPayload) ? pluginListPayload : [])
    .filter(item => item?.name === 'devcodex-workspace')
  if (unavailable(pluginList)) {
    issues.push(probeIssue(
      'GROK_PLUGIN_LIST_UNAVAILABLE',
      'native',
      pluginList?.error?.code || 'spawn unavailable',
      'Repair the Grok CLI plugin command and re-run doctor.'
    ))
  } else if (
      pluginList.status !== 0 ||
      managedPluginList.length !== 1 ||
      !managedPluginList[0]?.source ||
      !samePath(managedPluginList[0].source, target.files.plugin)
  ) {
    issues.push(probeIssue(
      'GROK_PLUGIN_LIST_FAILED',
      'native',
      String(pluginList.stderr || pluginList.stdout || `managed identities=${managedPluginList.length}`).trim(),
      'Converge Grok to one canonical DevCodex plugin identity and re-run doctor.'
    ))
  }
  const inspect = options.spawnSync('grok', ['inspect', '--json'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: options.env,
    timeout: options.timeoutMs
  })
  let inspectPayload = null
  try { inspectPayload = JSON.parse(String(inspect.stdout || '')) } catch { inspectPayload = null }
  const inspectedPlugins = (Array.isArray(inspectPayload?.plugins) ? inspectPayload.plugins : [])
    .filter(item => item?.name === 'devcodex-workspace')
  const inspectedSkills = (Array.isArray(inspectPayload?.skills) ? inspectPayload.skills : [])
    .filter(item => item?.name === 'devcodex-workspace')
  const inspectedHooks = (Array.isArray(inspectPayload?.hooks) ? inspectPayload.hooks : [])
    .filter(item => item?.source?.plugin_name === 'devcodex-workspace')
  const inspectedMcp = new Set(
    (Array.isArray(inspectPayload?.mcpServers) ? inspectPayload.mcpServers : [])
      .filter(item => item?.source?.plugin_name === 'devcodex-workspace')
      .map(item => item.name)
  )
  if (unavailable(inspect)) {
    issues.push(probeIssue(
      'GROK_INSPECT_UNAVAILABLE',
      'native',
      inspect?.error?.code || 'spawn unavailable',
      'Repair the Grok CLI inspect command and re-run doctor.'
    ))
  } else if (
      inspect.status !== 0 ||
      inspectedPlugins.length !== 1 ||
      inspectedPlugins[0]?.scope !== 'user' ||
      inspectedPlugins[0]?.enabled !== true ||
      inspectedSkills.length !== 1 ||
      inspectedHooks.length < 1 ||
      !inspectedMcp.has('devcodex-memory') ||
      !inspectedMcp.has('devcodex-profile')
  ) {
    issues.push(probeIssue(
      'GROK_INSPECT_CONTRACT_FAILED',
      'native',
      String(inspect.stderr || inspect.stdout || 'Grok inspect contract incomplete').trim(),
      'Refresh the canonical Grok plugin and verify Skill, Hook, and both MCP servers.'
    ))
  }
  const installedHook = grokInstalledHookProbe(managedPluginList[0]?.path, cwd, options)
  if (!installedHook.passed) {
    issues.push(probeIssue(
      'GROK_INSTALLED_HOOK_CONTRACT_FAILED',
      'native',
      installedHook.error || `exit ${installedHook.exitCode}`,
      'Refresh the canonical Grok plugin and verify its user-global Hook bridge.'
    ))
  }
  const mcp = {}
  for (const [name, serverPath] of Object.entries({
    memory: path.join(target.runtimeRoot, 'mcp', 'memory-server.js'),
    profile: path.join(target.runtimeRoot, 'mcp', 'profile-server.js')
  })) {
    mcp[name] = mcpInitializeProbe(serverPath, cwd, options)
    if (!mcp[name].passed) {
      issues.push(probeIssue(
        'GROK_MCP_INITIALIZE_FAILED',
        'native',
        `${name}:${mcp[name].error || `exit ${mcp[name].exitCode}`}`,
        'Refresh the global runtime and run the MCP initialize probe again.'
      ))
    }
  }
  // M0: tools/call smoke — catches missing runtime deps that initialize never loads
  const toolSmoke = {
    memory: mcpToolCallProbe(
      path.join(target.runtimeRoot, 'mcp', 'memory-server.js'),
      cwd,
      'memory_status',
      { agent: 'grok', project: path.basename(cwd) || 'devcodex', limit: 3 },
      { ...options, timeoutMs: options.toolTimeoutMs || 8000 }
    ),
    profile: mcpToolCallProbe(
      path.join(target.runtimeRoot, 'mcp', 'profile-server.js'),
      cwd,
      'profile_compose_entry_check',
      { project: path.basename(cwd) || 'devcodex', status: 'PASS', nextStep: 'probe' },
      { ...options, timeoutMs: options.toolTimeoutMs || 8000 }
    )
  }
  for (const [name, smoke] of Object.entries(toolSmoke)) {
    mcp[`${name}Tool`] = smoke
    if (!smoke.passed) {
      issues.push(probeIssue(
        'GROK_MCP_TOOL_SMOKE_FAILED',
        'native',
        `${name}:${smoke.error || smoke.textHead || 'tool-smoke-failed'}`,
        smoke.error === 'module-missing'
          ? 'Sync runtime dependency closure allowlists and re-apply global runtime.'
          : 'Re-run MCP tools/call smoke after fixing runtime; ensure tool returns within timeout.'
      ))
    }
  }
  return {
    status: issues.length ? 'failed' : 'passed',
    evidence: {
      pluginListExit: pluginList.status,
      pluginIdentities: managedPluginList.map(item => ({
        source: item.source || null,
        path: item.path || null
      })),
      inspectExit: inspect.status,
      inspectSummary: {
        plugins: inspectedPlugins.length,
        skills: inspectedSkills.length,
        hooks: inspectedHooks.length,
        mcpServers: Array.from(inspectedMcp).sort()
      },
      installedHook,
      mcp
    },
    issues
  }
}

function operationalState(configured, contractStatus, nativeStatus) {
  if (contractStatus === 'failed' || nativeStatus === 'failed') return 'failed'
  if (!configured) return 'unavailable'
  if (nativeStatus === 'unavailable') return 'unavailable'
  if (contractStatus !== 'passed' || nativeStatus !== 'passed') return 'unverified'
  return 'ready'
}

function verifyGlobalHostRuntime(options = {}) {
  const fsImpl = options.fs || fs
  const spawn = options.spawnSync || spawnSync
  const env = options.env || process.env
  const depth = options.depth === 'deep' ? 'deep' : 'status'
  const configuration = options.configuration || { hosts: [] }
  const cwd = path.resolve(options.cwd || process.cwd())
  const common = {
    fs: fsImpl,
    spawnSync: spawn,
    env,
    depth,
    timeoutMs: options.timeoutMs || 15000,
    platform: options.platform || process.platform,
    nativeSpawnInjected: typeof options.spawnSync === 'function',
    resolveWindowsCommand: options.resolveWindowsCommand === true
  }
  const nodeRuntime = options.nodeRuntime || inspectNodeRuntimeReadiness({
    fs: fsImpl,
    spawnSync: spawn,
    env,
    timeoutMs: options.timeoutMs,
    ...(options.nodeRuntimeOptions || {})
  })

  const hosts = (configuration.hosts || []).map(configurationHost => {
    if (configurationHost.inspectionStatus === 'UNVERIFIED') {
      const configurationIssues = Array.isArray(configurationHost.configurationIssues)
        ? configurationHost.configurationIssues
        : []
      return {
        ...configurationHost,
        configured: false,
        adapterReady: false,
        contractStatus: 'unverified',
        nativeStatus: 'unverified',
        operationalState: 'unverified',
        ready: false,
        issues: configurationIssues,
        probes: {
          adapter: { status: 'skipped', reasonCode: 'configuration-unverified' },
          native: { status: 'skipped', reasonCode: 'configuration-unverified' }
        }
      }
    }
    const hostCommon = configurationHost.host === 'grok'
      ? { ...common, env: buildGrokCliEnv(env) }
      : common
    const target = resolveGlobalHostTarget(configurationHost.host, {
      env: hostCommon.env,
      home: options.home,
      fs: fsImpl
    })
    const configured = configurationHost.ready === true || configurationHost.configured === true
    const adapter = adapterContractProbe(configurationHost.host, configurationHost.runtimeEntry, hostCommon)
    let contractStatus = adapter.status
    const configurationIssues = Array.isArray(configurationHost.configurationIssues)
      ? configurationHost.configurationIssues
      : []
    const issues = [...configurationIssues, ...adapter.issues]
    const probes = { adapter: adapter.evidence }
    if (configurationIssues.length && contractStatus !== 'failed') contractStatus = 'failed'

    if (configurationHost.host === 'grok') {
      const staticGrok = grokStaticContract(target, hostCommon)
      probes.grokStatic = staticGrok
      issues.push(...staticGrok.issues)
      if (staticGrok.status === 'failed') contractStatus = 'failed'
    }
    if (configurationHost.host === 'cursor') {
      const staticCursor = cursorStaticContract(target, hostCommon)
      probes.cursorStatic = staticCursor
      issues.push(...staticCursor.issues)
      if (staticCursor.status === 'failed') contractStatus = 'failed'
    }

    const native = nativeVersionProbe(configurationHost.host, hostCommon)
    let nativeStatus = native.status
    probes.native = native.evidence
    issues.push(...native.issues)

    if (configurationHost.host === 'grok' && native.status === 'passed') {
      const deep = deepGrokProbe(target, cwd, hostCommon)
      probes.grokDeep = deep.evidence
      issues.push(...deep.issues)
      if (deep.status === 'failed') nativeStatus = 'failed'
    }

    const adapterReady = configured && contractStatus === 'passed'
    const variants = configurationHost.host === 'cursor'
      ? cursorVariantMatrix(adapterReady, native)
      : undefined
    if (configurationHost.host === 'cursor' && nativeStatus !== 'failed') {
      nativeStatus = 'unverified'
    }
    const state = operationalState(configured, contractStatus, nativeStatus)
    return {
      ...configurationHost,
      configured,
      adapterReady,
      contractStatus,
      nativeStatus,
      operationalState: state,
      ready: state === 'ready',
      issues,
      probes,
      ...(variants ? { variants } : {})
    }
  })

  const overallState = hosts.some(host => host.operationalState === 'failed')
    ? 'failed'
    : (hosts.every(host => host.operationalState === 'ready') ? 'ready' : 'degraded')
  return {
    schemaVersion: 'GlobalHostRuntimeVerificationV2',
    mode: configuration.mode || 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: configuration.workspaceCleanMode || 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: configuration.packageVersion || 'unknown',
    depth,
    configured: hosts.every(host => host.configured),
    ready: hosts.every(host => host.ready),
    overallState,
    nodeRuntime,
    hosts
  }
}

module.exports = {
  EXECUTABLE_ADAPTER_HOSTS,
  adapterContractProbe,
  cursorStaticContract,
  cursorVariantMatrix,
  buildWindowsNativeInvocation,
  grokPluginIdentities,
  grokStaticContract,
  mcpInitializeProbe,
  mcpToolCallProbe,
  nativeVersionProbe,
  nativeProbeInvocation,
  resolveWindowsNativeCommand,
  grokInstalledHookProbe,
  verifyGlobalHostRuntime
}
