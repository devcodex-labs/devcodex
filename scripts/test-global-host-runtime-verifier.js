#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  verifyGlobalHostRuntime
} = require('./lib/global-host-runtime-verifier.js')
const {
  resolveGlobalHostTarget
} = require('./lib/global-host-target.js')
const {
  inspectNodeRuntimeReadiness
} = require('./lib/node-runtime-readiness.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-runtime-verifier-'))
const home = path.join(root, 'home')
const grokRoot = path.join(home, '.grok')
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  GROK_HOME: grokRoot,
  CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  CODEX_HOME: path.join(home, '.codex'),
  GEMINI_CLI_HOME: home,
  COPILOT_HOME: path.join(home, '.copilot')
}

const nodeSystemBin = path.join(root, 'Program Files', 'nodejs')
fs.mkdirSync(nodeSystemBin, { recursive: true })
const nodeSystemLauncher = path.join(nodeSystemBin, 'node.exe')
fs.writeFileSync(nodeSystemLauncher, 'fixture\n', 'utf8')
const nodePass = inspectNodeRuntimeReadiness({
  fs,
  env: { PATH: nodeSystemBin, PATHEXT: '.EXE;.CMD' },
  platform: 'win32',
  processExecPath: nodeSystemLauncher,
  processVersion: 'v20.20.2',
  spawnSync: (command, args) => {
    assert.strictEqual(path.resolve(command), path.resolve(nodeSystemLauncher))
    assert.deepStrictEqual(args, ['--version'])
    return { status: 0, stdout: 'v20.20.2\n', stderr: '' }
  }
})
assert.strictEqual(nodePass.schemaVersion, 'NodeRuntimeReadinessV1')
assert.strictEqual(nodePass.status, 'PASS')
assert.strictEqual(nodePass.ambientCommand, 'node')
assert.strictEqual(path.resolve(nodePass.ambientPath), path.resolve(nodeSystemLauncher))
assert.strictEqual(nodePass.provider, 'system')
assert.strictEqual(nodePass.launcherKind, 'binary')
assert.strictEqual(nodePass.smoke.version, 'v20.20.2')

const voltaBin = path.join(root, '.volta', 'bin')
fs.mkdirSync(voltaBin, { recursive: true })
const voltaLauncher = path.join(voltaBin, 'node.exe')
fs.writeFileSync(voltaLauncher, 'fixture\n', 'utf8')
const voltaReadiness = inspectNodeRuntimeReadiness({
  fs,
  env: { PATH: voltaBin, PATHEXT: '.EXE' },
  platform: 'win32',
  spawnSync: () => ({ status: 0, stdout: 'v22.1.0\n', stderr: '' })
})
assert.strictEqual(voltaReadiness.status, 'PASS')
assert.strictEqual(voltaReadiness.provider, 'volta')
assert.strictEqual(voltaReadiness.launcherKind, 'shim')

const emptyNodePath = path.join(root, 'empty-node-path')
fs.mkdirSync(emptyNodePath, { recursive: true })
let missingNodeSpawned = false
const missingNode = inspectNodeRuntimeReadiness({
  fs,
  env: { PATH: emptyNodePath, PATHEXT: '.EXE' },
  platform: 'win32',
  spawnSync: () => { missingNodeSpawned = true }
})
assert.strictEqual(missingNode.status, 'BLOCK')
assert.strictEqual(missingNode.reasonCode, 'ambient-node-missing')
assert.strictEqual(missingNodeSpawned, false)

const deniedNode = inspectNodeRuntimeReadiness({
  fs,
  env: { PATH: nodeSystemBin, PATHEXT: '.EXE' },
  platform: 'win32',
  spawnSync: () => ({
    status: null,
    stdout: '',
    stderr: '',
    error: { code: 'EPERM', message: 'sandbox execution denied' }
  })
})
assert.strictEqual(deniedNode.status, 'BLOCK')
assert.strictEqual(deniedNode.reasonCode, 'sandbox-exec-denied')
assert.match(deniedNode.nextStep, /Approve this Node launcher once in Codex/)
assert.match(deniedNode.startupBoundary, /before DevCodex JavaScript starts/)
const canonicalPlugin = path.join(grokRoot, 'devcodex', 'plugins', 'devcodex-workspace')
const installedPlugin = path.join(grokRoot, 'installed-plugins', 'canonical')
const grokRuntime = resolveGlobalHostTarget('grok', { env, home }).runtimeRoot
fs.mkdirSync(path.join(grokRoot, 'installed-plugins'), { recursive: true })
fs.cpSync(path.join(__dirname, '..', 'grok', 'plugins', 'devcodex-workspace'), canonicalPlugin, { recursive: true })
fs.cpSync(canonicalPlugin, installedPlugin, { recursive: true })
fs.mkdirSync(path.join(grokRuntime, 'mcp'), { recursive: true })
for (const name of ['memory-server.js', 'profile-server.js']) {
  fs.writeFileSync(path.join(grokRuntime, 'mcp', name), 'process.stdin.resume()\n', 'utf8')
}
fs.writeFileSync(path.join(canonicalPlugin, '.mcp.json'), JSON.stringify({
  mcpServers: {
    'devcodex-memory': {
      command: 'node',
      args: [path.join(grokRuntime, 'mcp', 'memory-server.js'), '.']
    },
    'devcodex-profile': {
      command: 'node',
      args: [path.join(grokRuntime, 'mcp', 'profile-server.js'), '.']
    }
  }
}, null, 2), 'utf8')
fs.writeFileSync(path.join(grokRoot, 'installed-plugins', 'registry.json'), JSON.stringify({
  version: 1,
  repos: {
    canonical: {
      kind: { type: 'Local', source_path: canonicalPlugin },
      path: installedPlugin,
      plugins: { 'devcodex-workspace': { version: '1.0.0' } }
    }
  }
}, null, 2), 'utf8')

const hosts = ['copilot', 'claude', 'codex', 'gemini', 'grok'].map(host => ({
  host,
  ready: true,
  runtimeEntry: path.join(
    resolveGlobalHostTarget(host, { env, home }).runtimeRoot,
    'hooks',
    '_runtime',
    'lifecycle-host-adapters.cjs'
  )
}))
for (const host of hosts) {
  fs.mkdirSync(path.dirname(host.runtimeEntry), { recursive: true })
  fs.writeFileSync(host.runtimeEntry, '// fixture\n', 'utf8')
}

const spawnProbe = (command, args) => {
  if (command === process.execPath && args.includes('--contract-probe')) {
    const host = args[1]
    return {
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 'HostLifecycleAdapterContractProbeV1',
        host,
        status: 'passed',
        events: [{ originalEvent: 'Probe', mappedEvent: 'Probe', outputShape: 'object' }]
      }),
      stderr: ''
    }
  }
  return { status: null, stdout: '', stderr: '', error: { code: 'ENOENT' } }
}

const healthy = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts
  },
  env,
  home,
  fs,
  spawnSync: spawnProbe
})
assert.strictEqual(healthy.schemaVersion, 'GlobalHostRuntimeVerificationV2')
assert.strictEqual(healthy.nodeRuntime.schemaVersion, 'NodeRuntimeReadinessV1')
assert.strictEqual(healthy.ready, false)
assert.strictEqual(healthy.overallState, 'degraded')
assert(healthy.hosts.every(host => host.adapterReady))
assert(healthy.hosts.every(host => host.ready === false))
assert(healthy.hosts.every(host => host.operationalState === 'unverified'))
assert.strictEqual(healthy.hosts.find(host => host.host === 'copilot').contractStatus, 'passed')
assert.strictEqual(healthy.hosts.find(host => host.host === 'copilot').nativeStatus, 'unverified')
assert.strictEqual(healthy.hosts.find(host => host.host === 'grok').nativeStatus, 'unverified')

const deniedCodexRoot = path.resolve(env.CODEX_HOME)
const deniedCodexFs = Object.create(fs)
deniedCodexFs.realpathSync = targetPath => {
  const resolved = path.resolve(targetPath)
  if (resolved === deniedCodexRoot || resolved.startsWith(`${deniedCodexRoot}${path.sep}`)) {
    const error = new Error('runtime verifier must not resolve an unverified configuration target')
    error.code = 'EPERM'
    throw error
  }
  return fs.realpathSync(targetPath)
}
deniedCodexFs.realpathSync.native = deniedCodexFs.realpathSync
let permissionIsolatedAdapterProbes = 0
const permissionIsolated = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts: hosts.map(host => host.host === 'codex'
      ? {
          ...host,
          ready: false,
          configured: false,
          inspectionStatus: 'UNVERIFIED',
          configurationIssues: [{
            code: 'GLOBAL_HOST_TARGET_UNVERIFIED',
            reasonCode: 'sandbox-read-denied',
            errorCode: 'EPERM'
          }]
        }
      : host)
  },
  env,
  home,
  fs: deniedCodexFs,
  spawnSync: (command, args) => {
    if (command === process.execPath && args.includes('--contract-probe')) {
      assert.notStrictEqual(args[1], 'codex')
      permissionIsolatedAdapterProbes += 1
    }
    return spawnProbe(command, args)
  }
})
const permissionIsolatedCodex = permissionIsolated.hosts.find(host => host.host === 'codex')
assert.strictEqual(permissionIsolated.overallState, 'degraded')
assert.strictEqual(permissionIsolatedAdapterProbes, 4)
assert.strictEqual(permissionIsolatedCodex.adapterReady, false)
assert.strictEqual(permissionIsolatedCodex.contractStatus, 'unverified')
assert.strictEqual(permissionIsolatedCodex.nativeStatus, 'unverified')
assert.strictEqual(permissionIsolatedCodex.operationalState, 'unverified')
assert.strictEqual(permissionIsolatedCodex.probes.adapter.status, 'skipped')
assert.strictEqual(permissionIsolatedCodex.issues[0].code, 'GLOBAL_HOST_TARGET_UNVERIFIED')

const missingRegistryFile = path.join(grokRoot, 'installed-plugins', 'registry.json')
const missingRegistryContent = fs.readFileSync(missingRegistryFile, 'utf8')
fs.unlinkSync(missingRegistryFile)
const missingGrokRegistry = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts
  },
  env,
  home,
  fs,
  spawnSync: spawnProbe
})
const missingRegistryGrok = missingGrokRegistry.hosts.find(host => host.host === 'grok')
assert.strictEqual(missingRegistryGrok.adapterReady, true)
assert.strictEqual(missingRegistryGrok.contractStatus, 'passed')
assert.strictEqual(missingRegistryGrok.nativeStatus, 'unverified')
assert(missingRegistryGrok.issues.some(issue => issue.code === 'GROK_PLUGIN_REGISTRY_UNVERIFIED'))
fs.writeFileSync(missingRegistryFile, missingRegistryContent, 'utf8')

const deepSpawn = (command, args) => {
  if (
    command === process.execPath &&
    args[1] === '--contract-probe' &&
    /devcodex-workspace\.cjs$/.test(args[0])
  ) {
    return {
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 'GrokWorkspaceHookContractProbeV1',
        status: 'passed',
        workspaceRoot: root,
        adapterProbe: { status: 'passed', host: 'grok' },
        issues: []
      }),
      stderr: ''
    }
  }
  if (command === process.execPath && args.includes('--contract-probe')) return spawnProbe(command, args)
  if (['copilot', 'claude', 'codex', 'gemini'].includes(command) && args[0] === '--version') {
    return { status: 0, stdout: `${command} fixture\n`, stderr: '' }
  }
  if (command === 'grok' && args[0] === 'version') {
    return { status: 0, stdout: 'grok fixture\n', stderr: '' }
  }
  if (command === 'grok' && args[0] === 'plugin' && args[1] === 'list') {
    return {
      status: 0,
      stdout: JSON.stringify([{
        name: 'devcodex-workspace',
        source: canonicalPlugin,
        path: installedPlugin
      }]),
      stderr: ''
    }
  }
  if (command === 'grok' && args[0] === 'inspect') {
    return {
      status: 0,
      stdout: JSON.stringify({
        plugins: [{
          name: 'devcodex-workspace',
          scope: 'user',
          enabled: true,
          provides: { skills: 1, hooks: true, mcpServers: 2 }
        }],
        skills: [{ name: 'devcodex-workspace' }],
        hooks: [{ source: { plugin_name: 'devcodex-workspace' } }],
        mcpServers: [
          { name: 'devcodex-memory', source: { plugin_name: 'devcodex-workspace' } },
          { name: 'devcodex-profile', source: { plugin_name: 'devcodex-workspace' } }
        ]
      }),
      stderr: ''
    }
  }
  if (command === process.execPath && args.some(value => /(?:memory|profile)-server\.js$/.test(value))) {
    return {
      status: 0,
      stdout: [
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'ok' }] } })
      ].join('\n') + '\n',
      stderr: ''
    }
  }
  return { status: null, stdout: '', stderr: '', error: { code: 'ENOENT' } }
}
const healthyDeep = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts
  },
  env,
  home,
  fs,
  depth: 'deep',
  spawnSync: deepSpawn
})
assert.strictEqual(healthyDeep.ready, true)
assert.strictEqual(healthyDeep.overallState, 'ready')
assert(healthyDeep.hosts.every(host => host.ready))
assert(healthyDeep.hosts.every(host => host.adapterReady))
assert.strictEqual(healthyDeep.hosts.find(host => host.host === 'copilot').nativeStatus, 'passed')
assert.strictEqual(healthyDeep.hosts.find(host => host.host === 'grok').nativeStatus, 'passed')
assert.strictEqual(healthyDeep.hosts.find(host => host.host === 'grok').probes.grokDeep.inspectSummary.mcpServers.length, 2)
assert.strictEqual(healthyDeep.hosts.find(host => host.host === 'grok').probes.grokDeep.installedHook.passed, true)

const brokenInstalledHook = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts
  },
  env,
  home,
  fs,
  depth: 'deep',
  spawnSync: (command, args) => {
    if (
      command === process.execPath &&
      args[1] === '--contract-probe' &&
      /devcodex-workspace\.cjs$/.test(args[0])
    ) {
      return { status: 1, stdout: '{"schemaVersion":"GrokWorkspaceHookContractProbeV1","status":"failed"}', stderr: '' }
    }
    return deepSpawn(command, args)
  }
})
assert.strictEqual(brokenInstalledHook.overallState, 'failed')
assert(brokenInstalledHook.hosts.find(host => host.host === 'grok').issues.some(issue =>
  issue.code === 'GROK_INSTALLED_HOOK_CONTRACT_FAILED'
))

const brokenInspect = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts
  },
  env,
  home,
  fs,
  depth: 'deep',
  spawnSync: (command, args) => {
    if (command === 'grok' && args[0] === 'inspect') {
      return { status: 0, stdout: JSON.stringify({ plugins: [], skills: [], hooks: [], mcpServers: [] }), stderr: '' }
    }
    return deepSpawn(command, args)
  }
})
assert.strictEqual(brokenInspect.overallState, 'failed')
assert(brokenInspect.hosts.find(host => host.host === 'grok').issues.some(issue =>
  issue.code === 'GROK_INSPECT_CONTRACT_FAILED'
))

const unavailableInspect = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts
  },
  env,
  home,
  fs,
  depth: 'deep',
  spawnSync: (command, args) => {
    if (command === 'grok' && args[0] === 'inspect') {
      return { status: null, stdout: '', stderr: '', error: { code: 'EACCES' } }
    }
    return deepSpawn(command, args)
  }
})
assert.strictEqual(unavailableInspect.overallState, 'failed')
assert(unavailableInspect.hosts.find(host => host.host === 'grok').issues.some(issue =>
  issue.code === 'GROK_INSPECT_UNAVAILABLE'
))

const unavailableCopilot = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts
  },
  env,
  home,
  fs,
  depth: 'deep',
  spawnSync: (command, args) => {
    if (command === 'copilot' && args[0] === '--version') {
      return { status: null, stdout: '', stderr: '', error: { code: 'ENOENT' } }
    }
    return deepSpawn(command, args)
  }
})
const unavailableCopilotHost = unavailableCopilot.hosts.find(host => host.host === 'copilot')
assert.strictEqual(unavailableCopilot.ready, false)
assert.strictEqual(unavailableCopilot.overallState, 'degraded')
assert.strictEqual(unavailableCopilotHost.adapterReady, true)
assert.strictEqual(unavailableCopilotHost.nativeStatus, 'unavailable')
assert.strictEqual(unavailableCopilotHost.operationalState, 'unavailable')
assert(unavailableCopilotHost.issues.some(issue => issue.code === 'HOST_NATIVE_PROBE_UNAVAILABLE'))

const inaccessibleCodex = verifyGlobalHostRuntime({
  configuration: {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    packageVersion: 'test',
    hosts
  },
  env,
  home,
  fs,
  depth: 'deep',
  spawnSync: (command, args) => {
    if (command === 'codex' && args[0] === '--version') {
      return { status: null, stdout: '', stderr: '', error: { code: 'EACCES' } }
    }
    return deepSpawn(command, args)
  }
})
const inaccessibleCodexHost = inaccessibleCodex.hosts.find(host => host.host === 'codex')
assert.strictEqual(inaccessibleCodexHost.adapterReady, true)
assert.strictEqual(inaccessibleCodexHost.nativeStatus, 'unavailable')
assert.strictEqual(inaccessibleCodexHost.ready, false)
assert(inaccessibleCodexHost.issues.some(issue => issue.code === 'HOST_NATIVE_PROBE_UNAVAILABLE'))

const adapterFailure = verifyGlobalHostRuntime({
  configuration: healthy,
  env,
  home,
  fs,
  spawnSync: (command, args) => {
    if (command === process.execPath && args[1] === 'codex') {
      return { status: 2, stdout: '', stderr: 'unsupported codex adapter' }
    }
    return spawnProbe(command, args)
  }
})
assert.strictEqual(adapterFailure.ready, false)
assert.strictEqual(adapterFailure.overallState, 'failed')
assert.strictEqual(adapterFailure.hosts.find(host => host.host === 'codex').contractStatus, 'failed')

const staleConfigurationWithAdapterFailure = verifyGlobalHostRuntime({
  configuration: {
    ...healthy,
    hosts: healthy.hosts.map(host => (
      host.host === 'codex'
        ? { ...host, ready: false, configured: false }
        : host
    ))
  },
  env,
  home,
  fs,
  spawnSync: (command, args) => {
    if (command === process.execPath && args[1] === 'codex') {
      return { status: 2, stdout: '', stderr: 'unsupported codex adapter' }
    }
    return spawnProbe(command, args)
  }
})
assert.strictEqual(staleConfigurationWithAdapterFailure.overallState, 'failed')
assert.strictEqual(
  staleConfigurationWithAdapterFailure.hosts.find(host => host.host === 'codex').operationalState,
  'failed'
)

const registryFile = path.join(grokRoot, 'installed-plugins', 'registry.json')
const duplicate = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
duplicate.repos.legacy = {
  kind: { type: 'Local', source_path: path.join(root, '.grok', 'devcodex', 'plugins', 'devcodex-workspace') },
  path: path.join(grokRoot, 'installed-plugins', 'legacy'),
  plugins: { 'devcodex-workspace': { version: '1.0.0' } }
}
fs.writeFileSync(registryFile, JSON.stringify(duplicate, null, 2), 'utf8')
const duplicateResult = verifyGlobalHostRuntime({
  configuration: healthy,
  env,
  home,
  fs,
  spawnSync: spawnProbe
})
const grok = duplicateResult.hosts.find(host => host.host === 'grok')
assert.strictEqual(grok.ready, false)
assert.strictEqual(grok.contractStatus, 'failed')
assert(grok.issues.some(issue => issue.code === 'GROK_PLUGIN_DUPLICATE_MANAGED_IDENTITY'))

fs.rmSync(root, { recursive: true, force: true })
console.log('global host runtime verifier tests passed layered readiness, native-unavailable mutations, installed hook contract, and false-green mutations')
