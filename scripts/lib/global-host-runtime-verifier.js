'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveGlobalHostTarget, samePath } = require('./global-host-target.js')

const EXECUTABLE_ADAPTER_HOSTS = Object.freeze(['copilot', 'claude', 'codex', 'gemini', 'grok'])
const NATIVE_COMMANDS = Object.freeze({
  copilot: { command: 'copilot', args: ['--version'] },
  claude: { command: 'claude', args: ['--version'] },
  codex: { command: 'codex', args: ['--version'] },
  gemini: { command: 'gemini', args: ['--version'] },
  grok: { command: 'grok', args: ['version'] }
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

function nativeVersionProbe(host, options = {}) {
  if (options.depth !== 'deep') {
    return { status: 'unverified', evidence: { reason: 'status-light-probe' }, issues: [] }
  }
  const spec = NATIVE_COMMANDS[host]
  const result = options.spawnSync(spec.command, spec.args, {
    encoding: 'utf8',
    windowsHide: true,
    env: options.env,
    timeout: options.timeoutMs
  })
  if (unavailable(result)) {
    return {
      status: 'unavailable',
      evidence: { command: spec.command, error: result?.error?.code || 'not-found' },
      issues: [probeIssue(
        'HOST_NATIVE_PROBE_UNAVAILABLE',
        'native',
        `${spec.command}: ${result?.error?.code || 'not-found'}`,
        `Install or repair the ${host} CLI, then re-run devcodex doctor.`
      )]
    }
  }
  if (result.status !== 0) {
    return {
      status: 'failed',
      evidence: {
        command: spec.command,
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
  return {
    status: 'passed',
    evidence: { command: spec.command, version: String(result.stdout || result.stderr || '').trim() },
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
      { agent: 'grok', project: path.basename(cwd) || 'devcodex-v1', limit: 3 },
      { ...options, timeoutMs: options.toolTimeoutMs || 8000 }
    ),
    profile: mcpToolCallProbe(
      path.join(target.runtimeRoot, 'mcp', 'profile-server.js'),
      cwd,
      'profile_compose_entry_check',
      { project: path.basename(cwd) || 'devcodex-v1', status: 'PASS', nextStep: 'probe' },
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
          ? 'Sync CLAUDE_MCP_RUNTIME_SCRIPT_DEPS (include executable-absorption-gates.js) and re-apply global runtime.'
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
  const common = { fs: fsImpl, spawnSync: spawn, env, depth, timeoutMs: options.timeoutMs || 15000 }

  const hosts = (configuration.hosts || []).map(configurationHost => {
    const target = resolveGlobalHostTarget(configurationHost.host, {
      env,
      home: options.home,
      fs: fsImpl
    })
    const configured = configurationHost.ready === true || configurationHost.configured === true
    const adapter = adapterContractProbe(configurationHost.host, configurationHost.runtimeEntry, common)
    let contractStatus = adapter.status
    const configurationIssues = Array.isArray(configurationHost.configurationIssues)
      ? configurationHost.configurationIssues
      : []
    const issues = [...configurationIssues, ...adapter.issues]
    const probes = { adapter: adapter.evidence }
    if (configurationIssues.length && contractStatus !== 'failed') contractStatus = 'failed'

    if (configurationHost.host === 'grok') {
      const staticGrok = grokStaticContract(target, common)
      probes.grokStatic = staticGrok
      issues.push(...staticGrok.issues)
      if (staticGrok.status === 'failed') contractStatus = 'failed'
      else if (staticGrok.status === 'unverified' && contractStatus === 'passed') contractStatus = 'unverified'
    }

    const native = nativeVersionProbe(configurationHost.host, common)
    let nativeStatus = native.status
    probes.native = native.evidence
    issues.push(...native.issues)

    if (configurationHost.host === 'grok' && native.status === 'passed') {
      const deep = deepGrokProbe(target, cwd, common)
      probes.grokDeep = deep.evidence
      issues.push(...deep.issues)
      if (deep.status === 'failed') nativeStatus = 'failed'
    }

    const adapterReady = configured && contractStatus === 'passed'
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
      probes
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
    hosts
  }
}

module.exports = {
  EXECUTABLE_ADAPTER_HOSTS,
  adapterContractProbe,
  grokPluginIdentities,
  grokStaticContract,
  mcpInitializeProbe,
  mcpToolCallProbe,
  nativeVersionProbe,
  grokInstalledHookProbe,
  verifyGlobalHostRuntime
}
