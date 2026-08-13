#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  resolveNpmInvocation,
  resolveWindowsBatchInvocation
} = require('./lib/checked-command')
const { resolveControlAsset } = require('./lib/control-content-delivery')

const packageRoot = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-install-smoke-'))
const packDir = path.join(tmp, 'pack')
const cacheDir = path.join(tmp, 'npm-cache')
const globalHome = path.join(tmp, 'global-home')
const workspaceHome = path.join(tmp, 'workspace-home')
const globalPrefix = path.join(tmp, 'global-prefix')
const workspace = path.join(tmp, 'workspace')
let tempCleaned = false

function cleanupTempFixture() {
  if (tempCleaned) return
  fs.rmSync(tmp, { recursive: true, force: true })
  tempCleaned = true
}

process.once('exit', cleanupTempFixture)
fs.mkdirSync(packDir, { recursive: true })
fs.mkdirSync(cacheDir, { recursive: true })
fs.mkdirSync(globalHome, { recursive: true })
fs.mkdirSync(workspaceHome, { recursive: true })
fs.mkdirSync(globalPrefix, { recursive: true })
fs.mkdirSync(workspace, { recursive: true })

fs.mkdirSync(path.join(globalHome, '.codex'), { recursive: true })
fs.writeFileSync(path.join(globalHome, '.codex', 'AGENTS.md'), '# User Codex instruction\n')
fs.writeFileSync(path.join(globalHome, '.codex', 'config.toml'), 'model = "user-model"\n')
fs.mkdirSync(path.join(globalHome, '.claude'), { recursive: true })
fs.writeFileSync(path.join(globalHome, '.claude', 'settings.json'), `${JSON.stringify({
  theme: 'dark',
  hooks: {
    PreToolUse: [{ hooks: [{ type: 'command', command: 'node user-hook.cjs' }] }]
  }
}, null, 2)}\n`)
fs.mkdirSync(path.join(globalHome, '.grok'), { recursive: true })
fs.writeFileSync(path.join(globalHome, '.grok', 'config.toml'), 'model = "user-model"\n')

function runNpm(args, options = {}) {
  const env = {
    ...process.env,
    npm_config_cache: cacheDir,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    ...options.env
  }
  const invocation = resolveNpmInvocation('npm', args, env)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd || packageRoot,
    env,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout || 180000
  })
  assert.strictEqual(
    result.status,
    0,
    `npm ${args.join(' ')} failed status=${result.status} signal=${result.signal} error=${result.error?.message || 'none'}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )
  return result
}

function runCommand(command, args, options = {}) {
  const env = {
    ...process.env,
    ...options.env
  }
  const invocation = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
    ? resolveWindowsBatchInvocation(command, args, env)
    : { command, args }
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd || workspace,
    env,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout || 120000
  })
  assert.strictEqual(
    result.status,
    0,
    `${command} ${args.join(' ')} failed status=${result.status} signal=${result.signal} error=${result.error?.message || 'none'}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )
  return result
}

function isolatedHostEnv(home) {
  // Global postinstall skips when CI/GITHUB_ACTIONS is truthy (see npm-lifecycle-adapter).
  // Smoke inherits process.env from GHA; force + clear CI vars so isolated receipts are written.
  return {
    DEVCODEX_TEST_HOME: home,
    DEVCODEX_POSTINSTALL_FORCE: '1',
    CI: '',
    GITHUB_ACTIONS: '',
    BUILDKITE: '',
    TF_BUILD: '',
    CODEX_HOME: path.join(home, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    GEMINI_CLI_HOME: path.join(home, 'gemini-cli-home'),
    GROK_HOME: path.join(home, '.grok'),
    CURSOR_HOME: path.join(home, '.cursor'),
    COPILOT_HOME: path.join(home, '.copilot')
  }
}

function receiptPath(home, hostRoot) {
  return path.join(home, hostRoot, 'devcodex', 'global-host-receipt.json')
}

function listFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else files.push(path.relative(root, full).replace(/\\/g, '/'))
    }
  }
  return files.sort()
}

const pack = runNpm(['pack', '--json', '--pack-destination', packDir], { timeout: 180000 })
const packResult = JSON.parse(pack.stdout)
assert.ok(Array.isArray(packResult) && packResult.length === 1)
const tarball = path.join(packDir, packResult[0].filename)
assert.strictEqual(fs.existsSync(tarball), true)

runNpm([
  'install',
  '-g',
  tarball,
  '--prefix',
  globalPrefix,
  '--foreground-scripts'
], {
  env: isolatedHostEnv(globalHome),
  timeout: 240000
})

for (const host of ['.copilot', '.claude', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok', '.cursor']) {
  const file = receiptPath(globalHome, host)
  assert.ok(fs.existsSync(file), `${host} receipt missing after real global install`)
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.strictEqual(receipt.result, 'committed')
  assert.strictEqual(receipt.workspaceHostDirectoriesWritten, false)
  assert.strictEqual(receipt.packageVersion, packageJson.version)
  assert.ok(Array.isArray(receipt.managedPaths), `${host} receipt missing managedPaths`)
  assert.deepStrictEqual(receipt.pendingStaleManagedPaths, [])
  assert.strictEqual(receipt.workspaceCleanMode, 'GlobalOnlyWorkspaceCleanModeV1')
}
const installedCursorRoot = path.join(globalHome, '.cursor')
const installedCursorPlugin = path.join(installedCursorRoot, 'devcodex', 'plugins', 'devcodex-workspace')
assert.strictEqual(fs.existsSync(path.join(installedCursorRoot, 'hooks.json')), true)
const installedCursorManifest = JSON.parse(fs.readFileSync(
  path.join(installedCursorPlugin, '.cursor-plugin', 'plugin.json'),
  'utf8'
))
assert.strictEqual(installedCursorManifest.name, 'devcodex-workspace')
assert.strictEqual(installedCursorManifest.version, packageJson.version)
assert.strictEqual(fs.existsSync(path.join(installedCursorPlugin, 'mcp.json')), true)
assert.strictEqual(fs.existsSync(path.join(installedCursorPlugin, 'hooks')), false)
assert.strictEqual(fs.existsSync(path.join(globalHome, '.agents', 'devcodex', 'instructions.full.md')), true)
assert.strictEqual(
  fs.existsSync(path.join(globalHome, '.agents', 'devcodex', 'skills', 'portfolio.json')),
  true,
  'shared Skill runtime must include portfolio.json for installed SkillRoute bootstrap'
)
assert.strictEqual(fs.existsSync(path.join(globalHome, '.agents', 'devcodex', 'skills', 'routing', 'SKILL.md')), true)
assert.strictEqual(
  fs.existsSync(path.join(globalHome, '.agents', 'skills', 'routing', 'SKILL.md')),
  false,
  'managed DevCodex Skills must not occupy the host-native .agents/skills root'
)
const skillPortfolio = JSON.parse(fs.readFileSync(resolveControlAsset(packageRoot, 'skills/portfolio.json'), 'utf8'))
for (const graySkill of skillPortfolio.skills.filter(skill => skill.lifecycleState === 'gray')) {
  assert.strictEqual(
    fs.existsSync(path.join(globalHome, '.agents', 'devcodex', 'skills', graySkill.id)),
    false,
    `gray Skill must not deploy to shared user-global skills: ${graySkill.id}`
  )
  assert.strictEqual(
    fs.existsSync(path.join(globalHome, '.claude', 'skills', graySkill.id)),
    false,
    `gray Skill must not deploy to Claude user-global skills: ${graySkill.id}`
  )
}
const binPath = process.platform === 'win32'
  ? path.join(globalPrefix, 'devcodex.cmd')
  : path.join(globalPrefix, 'bin', 'devcodex')
assert.ok(fs.existsSync(binPath), 'global devcodex bin missing')

const installedCopilotHooks = JSON.parse(fs.readFileSync(
  path.join(globalHome, '.copilot', 'hooks', 'devcodex.json'),
  'utf8'
))
assert.strictEqual(installedCopilotHooks.version, 1)
for (const event of [
  'userPromptSubmitted',
  'userPromptTransformed',
  'preToolUse',
  'postToolUse',
  'agentStop',
  'preCompact'
]) {
  assert.ok(Array.isArray(installedCopilotHooks.hooks[event]), `packed Copilot hook missing ${event}`)
  assert.ok(
    installedCopilotHooks.hooks[event].some(hook =>
      String(hook.command || '').includes(`--event ${event}`)
    ),
    `packed Copilot hook event binding missing ${event}`
  )
}
const installedCopilotMcp = JSON.parse(fs.readFileSync(
  path.join(globalHome, '.copilot', 'mcp-config.json'),
  'utf8'
))
for (const name of ['devcodex-memory', 'devcodex-profile']) {
  assert.strictEqual(installedCopilotMcp.mcpServers[name].type, 'local')
  assert.deepStrictEqual(installedCopilotMcp.mcpServers[name].tools, ['*'])
}
assert.strictEqual(
  fs.existsSync(path.join(globalHome, '.copilot', 'skills', 'routing', 'SKILL.md')),
  false,
  'Copilot native Skill root must remain host-owned'
)

const installedEnv = isolatedHostEnv(globalHome)
runCommand(binPath, ['init'], { cwd: workspace, env: installedEnv })
assert.ok(fs.existsSync(path.join(workspace, '.devcodex')), 'workspace init must create only .devcodex runtime')
assert.deepStrictEqual(
  JSON.parse(fs.readFileSync(path.join(workspace, '.devcodex', 'layout.json'), 'utf8')),
  {
    version: 1,
    mode: 'workspace-namespace',
    workspaceDir: 'workspace'
  }
)
assert.ok(
  fs.existsSync(path.join(workspace, '.devcodex', 'workspace', 'data', 'pending-fixes.md')),
  'workspace init must bootstrap the workspace namespace runtime'
)

function installedRuntimeRoot(host) {
  const hostRoot = host === 'gemini'
    ? path.join(globalHome, 'gemini-cli-home', '.gemini')
    : path.join(globalHome, `.${host}`)
  const receipt = JSON.parse(fs.readFileSync(
    path.join(hostRoot, 'devcodex', 'global-host-receipt.json'),
    'utf8'
  ))
  assert.strictEqual(receipt.schemaVersion, 'GlobalHostConfigReceiptV1')
  assert.strictEqual(receipt.runtimeGeneration?.schemaVersion, 'RuntimeGenerationManifestV1')
  assert.strictEqual(path.resolve(receipt.runtimeRoot).startsWith(path.resolve(hostRoot)), true)
  return path.resolve(receipt.runtimeRoot)
}

const installedClaudeAdapter = path.join(
  installedRuntimeRoot('claude'),
  'hooks',
  '_runtime',
  'lifecycle-host-adapters.cjs'
)
const importedClaudeHook = JSON.parse(runCommand(process.execPath, [installedClaudeAdapter, 'claude'], {
  cwd: workspace,
  env: installedEnv,
  shell: false,
  input: JSON.stringify({
    hookEventName: 'user_prompt_submit',
    cwd: workspace,
    prompt: 'Grok compatibility import probe'
  })
}).stdout)
assert.strictEqual(importedClaudeHook.continue, true)
assert.strictEqual(importedClaudeHook.devcodexCompatibilityBypass, 'grok-imported-claude-hook')

const installedCodexAdapter = path.join(
  installedRuntimeRoot('codex'),
  'hooks',
  '_runtime',
  'lifecycle-host-adapters.cjs'
)
const installedCodexHook = JSON.parse(runCommand(process.execPath, [installedCodexAdapter, 'codex'], {
  cwd: workspace,
  env: installedEnv,
  shell: false,
  input: JSON.stringify({
    hookEventName: 'UserPromptSubmit',
    cwd: workspace,
    prompt: 'routing installed package smoke',
    session_id: 'installed-package-skill-route'
  })
}).stdout)
const installedCodexContext = `${installedCodexHook.systemMessage || ''}\n${installedCodexHook.hookSpecificOutput?.additionalContext || ''}`
assert.match(
  installedCodexContext,
  /SkillRouteBootstrapV1/,
  'installed Codex hook must expose SkillRoute bootstrap from packed global runtime'
)

for (const host of ['copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor']) {
  const installedAdapter = path.join(
    installedRuntimeRoot(host),
    'hooks',
    '_runtime',
    'lifecycle-host-adapters.cjs'
  )
  const probe = JSON.parse(runCommand(process.execPath, [installedAdapter, host, '--contract-probe'], {
    cwd: workspace,
    env: installedEnv,
    shell: false
  }).stdout)
  assert.strictEqual(probe.schemaVersion, 'HostLifecycleAdapterContractProbeV1')
  assert.strictEqual(probe.host, host)
  assert.strictEqual(probe.status, 'passed')
}

const statusPayload = JSON.parse(runCommand(binPath, ['status', '--json'], {
  cwd: workspace,
  env: installedEnv
}).stdout)
function summarizeHostRuntime(hosts) {
  return JSON.stringify(
    hosts.map(host => ({
      host: host.host,
      configured: host.configured,
      adapterReady: host.adapterReady,
      contractStatus: host.contractStatus,
      nativeStatus: host.nativeStatus,
      ready: host.ready,
      issues: host.issues
    })),
    null,
    2
  )
}

assert.strictEqual(statusPayload.ok, true)
assert.strictEqual(statusPayload.payload.globalHostRuntime.schemaVersion, 'GlobalHostRuntimeVerificationV2')
assert.strictEqual(statusPayload.payload.globalHostRuntime.hosts.length, 6)
assert(
  statusPayload.payload.globalHostRuntime.hosts.every(host => host.configured === true),
  summarizeHostRuntime(statusPayload.payload.globalHostRuntime.hosts)
)
assert(
  statusPayload.payload.globalHostRuntime.hosts.every(host => host.adapterReady === true),
  summarizeHostRuntime(statusPayload.payload.globalHostRuntime.hosts)
)
assert(
  statusPayload.payload.globalHostRuntime.hosts.every(host => host.contractStatus === 'passed'),
  summarizeHostRuntime(statusPayload.payload.globalHostRuntime.hosts)
)
assert(statusPayload.payload.globalHostRuntime.hosts.every(host => host.ready === false))
assert.strictEqual(statusPayload.payload.globalHostRuntime.overallState, 'degraded')
assert.strictEqual(
  statusPayload.payload.globalHostRuntime.hosts.find(host => host.host === 'copilot').nativeStatus,
  'unverified'
)
const cursorRuntime = statusPayload.payload.globalHostRuntime.hosts.find(host => host.host === 'cursor')
assert.strictEqual(cursorRuntime.contractStatus, 'passed')
assert.strictEqual(cursorRuntime.nativeStatus, 'unverified')
assert.strictEqual(cursorRuntime.variants.length, 4)
assert.strictEqual(cursorRuntime.variants.find(variant => variant.id === 'cursor-cloud-agent').support, 'partial')

const grokVersion = spawnSync('grok', ['version'], {
  cwd: workspace,
  env: { ...process.env, ...installedEnv },
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000
})
const grokAvailable = grokVersion.status === 0
if (grokAvailable) {
  const pluginList = JSON.parse(runCommand('grok', ['plugin', 'list', '--json'], {
    cwd: workspace,
    env: installedEnv
  }).stdout)
  const managed = pluginList.filter(item => item?.name === 'devcodex-workspace')
  assert.strictEqual(managed.length, 1, 'isolated Grok registry must converge to one managed identity')
  assert.strictEqual(
    path.resolve(managed[0].source),
    path.resolve(globalHome, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
  )

  const inspect = JSON.parse(runCommand('grok', ['inspect', '--json'], {
    cwd: workspace,
    env: installedEnv
  }).stdout)
  assert.strictEqual(
    inspect.plugins.filter(item => item?.name === 'devcodex-workspace' && item?.enabled === true).length,
    1
  )
  assert.strictEqual(inspect.skills.filter(item => item?.name === 'devcodex-workspace').length, 1)
  assert(inspect.hooks.some(item => item?.source?.plugin_name === 'devcodex-workspace'))
  const mcpNames = new Set(
    inspect.mcpServers
      .filter(item => item?.source?.plugin_name === 'devcodex-workspace')
      .map(item => item.name)
  )
  assert(mcpNames.has('devcodex-memory'))
  assert(mcpNames.has('devcodex-profile'))

  const doctorPayload = JSON.parse(runCommand(binPath, ['doctor', '--json'], {
    cwd: workspace,
    env: installedEnv
  }).stdout)
  const grokDoctor = doctorPayload.payload.globalHostRuntime.hosts.find(host => host.host === 'grok')
  assert.strictEqual(doctorPayload.ok, true)
  assert.strictEqual(grokDoctor.contractStatus, 'passed')
  assert.strictEqual(
    grokDoctor.nativeStatus,
    'passed',
    `Grok doctor did not reach native PASS:\n${JSON.stringify(grokDoctor, null, 2)}`
  )
  assert.strictEqual(grokDoctor.ready, true)
  assert.strictEqual(grokDoctor.probes.grokDeep.inspectSummary.plugins, 1)
  assert.strictEqual(grokDoctor.probes.grokDeep.inspectSummary.skills, 1)
  assert(grokDoctor.probes.grokDeep.inspectSummary.hooks >= 1)
  assert.strictEqual(grokDoctor.probes.grokDeep.inspectSummary.mcpServers.length, 2)
}

const installedReceipts = ['.copilot', '.claude', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok', '.cursor']
  .map(hostRoot => JSON.parse(fs.readFileSync(receiptPath(globalHome, hostRoot), 'utf8')))
const removalPreview = JSON.parse(runCommand(binPath, ['uninstall', '--json'], {
  cwd: workspace,
  env: installedEnv
}).stdout)
assert.strictEqual(removalPreview.ok, true)
assert.strictEqual(removalPreview.payload.operation, 'remove')
assert.strictEqual(removalPreview.payload.dryRun, true)
assert.strictEqual(removalPreview.payload.status, 'planned')
for (const hostRoot of ['.copilot', '.claude', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok', '.cursor']) {
  assert.strictEqual(fs.existsSync(receiptPath(globalHome, hostRoot)), true, `${hostRoot} preview mutated receipt`)
}

const removalApplied = JSON.parse(runCommand(binPath, ['uninstall', '--apply', '--json'], {
  cwd: workspace,
  env: installedEnv,
  timeout: 240000
}).stdout)
assert.strictEqual(removalApplied.ok, true)
assert.strictEqual(removalApplied.payload.status, 'committed')
assert.strictEqual(removalApplied.payload.dryRun, false)
assert.ok(['committed', 'not-applicable'].includes(
  removalApplied.payload.integrations.grokRecoveryCleanup.status
))
assert.deepStrictEqual(removalApplied.payload.recoveryCleanupFailures, [])
for (const hostRoot of ['.copilot', '.claude', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok', '.cursor']) {
  assert.strictEqual(fs.existsSync(receiptPath(globalHome, hostRoot)), false, `${hostRoot} receipt remained after managed removal`)
}
for (const receipt of installedReceipts) {
  for (const artifact of receipt.managedArtifacts || []) {
    if (artifact.ownershipKind === 'whole-file') {
      assert.strictEqual(fs.existsSync(path.resolve(artifact.path)), false, `whole-file residue: ${artifact.path}`)
    }
  }
  for (const artifact of receipt.retainedManagedArtifacts || []) {
    assert.strictEqual(fs.existsSync(path.resolve(artifact.path)), false, `retained runtime residue: ${artifact.path}`)
  }
}
assert.strictEqual(fs.readFileSync(path.join(globalHome, '.codex', 'AGENTS.md'), 'utf8'), '# User Codex instruction\n')
assert.match(fs.readFileSync(path.join(globalHome, '.codex', 'config.toml'), 'utf8'), /model = "user-model"/)
const preservedClaude = JSON.parse(fs.readFileSync(path.join(globalHome, '.claude', 'settings.json'), 'utf8'))
assert.strictEqual(preservedClaude.theme, 'dark')
assert.match(JSON.stringify(preservedClaude.hooks), /user-hook\.cjs/)
assert.doesNotMatch(JSON.stringify(preservedClaude), /devcodex/i)
assert.match(fs.readFileSync(path.join(globalHome, '.grok', 'config.toml'), 'utf8'), /model = "user-model"/)
assert.deepStrictEqual(
  listFiles(path.join(globalHome, '.grok', 'devcodex')),
  [],
  'managed Grok source/runtime residue remained after cleanup'
)

const removalAgain = JSON.parse(runCommand(binPath, ['uninstall', '--apply', '--json'], {
  cwd: workspace,
  env: installedEnv
}).stdout)
assert.strictEqual(removalAgain.ok, true)
assert.strictEqual(removalAgain.payload.status, 'already-absent')

runNpm(['uninstall', '-g', packageJson.name, '--prefix', globalPrefix], {
  env: installedEnv,
  timeout: 180000
})
assert.strictEqual(fs.existsSync(binPath), false, 'global devcodex bin remained after npm uninstall')
assert.strictEqual(fs.existsSync(path.join(globalPrefix, 'node_modules', packageJson.name)), false, 'global package remained after npm uninstall')

fs.writeFileSync(path.join(workspace, 'package.json'), `${JSON.stringify({
  name: 'consumer',
  private: true,
  dependencies: {
    [packageJson.name]: `file:${tarball.replace(/\\/g, '/')}`
  }
}, null, 2)}\n`)

runNpm(['install', '--foreground-scripts'], {
  cwd: workspace,
  env: isolatedHostEnv(workspaceHome),
  timeout: 240000
})

for (const host of ['.github', '.claude', '.codex', '.gemini', '.grok', '.cursor', '.agents', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json']) {
  assert.strictEqual(
    fs.existsSync(path.join(workspace, host)),
    false,
    `${host} must not be written by workspace install`
  )
}
for (const host of ['.copilot', '.claude', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok', '.cursor']) {
  assert.strictEqual(
    fs.existsSync(receiptPath(workspaceHome, host)),
    false,
    `${host} receipt must not be written by workspace install`
  )
}

cleanupTempFixture()
assert.strictEqual(fs.existsSync(tmp), false, 'global install smoke temporary fixture must be removed before success')
console.log(`global install smoke passed pack=1 realGlobalInstall=1 managedRemove=1 npmUninstall=1 idempotent=1 userContent=1 layeredStatus=1 grokNative=${grokAvailable ? 1 : 0} workspaceNoHostDirs=1 tempCleanup=1 version=${packageJson.version}`)
