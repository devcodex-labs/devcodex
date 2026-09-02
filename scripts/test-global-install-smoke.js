#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  resolveExecutableOnPath,
  resolveNpmInvocation,
  resolveWindowsBatchInvocation
} = require('./lib/checked-command')
const { resolveControlAsset } = require('./lib/control-content-delivery')
const { decodeHostHookCommand } = require('./lib/host-command')
const { isDevCodexManagedHookEntry } = require('./lib/global-host-config-merge')
const { cleanupPackageProjection } = require('./lib/package-compatibility-projection')
const { restorePublishedPackageManifest } = require('./lib/published-package-manifest-projection')

const NPM_COMMAND_TIMEOUT_MS = 180000
const PACKAGE_PACK_TIMEOUT_MS = 600000
const packageRoot = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

function parseSmokeArguments(argv) {
  const options = { tarball: null, realCodex: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--tarball') {
      const value = argv[index + 1]
      assert(value && !value.startsWith('-'), '--tarball requires one absolute .tgz path')
      assert(path.isAbsolute(value), '--tarball must be absolute so every consumer reuses one exact artifact')
      options.tarball = path.resolve(value)
      index += 1
    } else if (argument === '--real-codex') {
      options.realCodex = true
    } else {
      assert.fail(`unknown global install smoke argument: ${argument}`)
    }
  }
  return options
}

const smokeOptions = parseSmokeArguments(process.argv.slice(2))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-install-smoke-'))
const packDir = path.join(tmp, 'pack')
const cacheDir = path.join(tmp, 'npm-cache')
const globalHome = path.join(tmp, 'global-home')
const workspaceHome = path.join(tmp, 'workspace-home')
const globalPrefix = path.join(tmp, 'global-prefix')
const workspace = path.join(tmp, 'workspace')
const consumer = path.join(workspace, 'consumer')
const isolatedRoots = [packDir, cacheDir, globalHome, workspaceHome, globalPrefix, workspace]
assert.strictEqual(new Set(isolatedRoots.map(item => path.resolve(item))).size, isolatedRoots.length)
let tempCleaned = false
let realCodexEvidence = null
let installedAdmissionNegativesPassed = false

function cleanupTempFixture() {
  if (tempCleaned) return
  fs.rmSync(tmp, { recursive: true, force: true })
  tempCleaned = true
}

function recoverInterruptedSourcePack() {
  const failures = []
  try {
    restorePublishedPackageManifest(packageRoot)
  } catch (error) {
    failures.push(error)
  }
  try {
    cleanupPackageProjection(packageRoot)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length) {
    const error = new Error('GLOBAL_INSTALL_SMOKE_PACKAGE_PROJECTION_RECOVERY_FAILED')
    error.code = 'GLOBAL_INSTALL_SMOKE_PACKAGE_PROJECTION_RECOVERY_FAILED'
    error.causes = failures
    throw error
  }
}

process.once('exit', cleanupTempFixture)
fs.mkdirSync(packDir, { recursive: true })
fs.mkdirSync(cacheDir, { recursive: true })
fs.mkdirSync(globalHome, { recursive: true })
fs.mkdirSync(workspaceHome, { recursive: true })
fs.mkdirSync(globalPrefix, { recursive: true })
fs.mkdirSync(workspace, { recursive: true })
fs.mkdirSync(consumer, { recursive: true })

fs.mkdirSync(path.join(globalHome, '.codex'), { recursive: true })
fs.writeFileSync(path.join(globalHome, '.codex', 'AGENTS.md'), '# User Codex instruction\n')
const codexConfigSentinel = smokeOptions.realCodex
  ? '# isolated real Codex validation config\n'
  : 'model = "user-model"\n'
fs.writeFileSync(path.join(globalHome, '.codex', 'config.toml'), codexConfigSentinel)
if (smokeOptions.realCodex) {
  const rawSourceHome = String(process.env.USERPROFILE || process.env.HOME || '').trim()
  assert(rawSourceHome, 'real Codex validation requires one credential source HOME')
  const sourceHome = path.resolve(rawSourceHome)
  assert.notStrictEqual(sourceHome, path.resolve(globalHome), 'real Codex validation credential source must remain outside the fixture')
  const sourceAuth = path.join(sourceHome, '.codex', 'auth.json')
  assert.strictEqual(fs.existsSync(sourceAuth), true, 'real Codex validation requires an existing authenticated auth.json')
  fs.copyFileSync(sourceAuth, path.join(globalHome, '.codex', 'auth.json'))
}
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
    npm_config_prefix: options.npmPrefix || globalPrefix,
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
    timeout: options.timeout || NPM_COMMAND_TIMEOUT_MS
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

function rpcRequest(id, method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params })
}

function runInstalledMcp(serverPath, requests, options = {}) {
  const result = runCommand(process.execPath, [serverPath, options.inputRoot || workspace], {
    cwd: options.cwd || workspace,
    env: options.env,
    input: `${requests.join('\n')}\n`,
    timeout: options.timeout || 120000
  })
  return String(result.stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

function mcpResultById(responses, id) {
  const envelope = responses.find(item => item.id === id)
  assert.ok(envelope, `installed MCP response ${id} missing`)
  assert.strictEqual(envelope.error, undefined, envelope.error?.message || `installed MCP response ${id} failed`)
  return envelope.result
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function collectCodexDiagnosticSignals(value, signals, depth = 0) {
  if (value === null || value === undefined || depth > 5 || signals.length >= 12) return
  if (Array.isArray(value)) {
    for (const item of value) collectCodexDiagnosticSignals(item, signals, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (signals.length >= 12) break
    if (/^(?:error|errorCode|message|reason|status|phase|decision|taskId|admissionGeneration|isError|text)$/iu.test(key) &&
      ['string', 'number', 'boolean'].includes(typeof nested)) {
      const text = String(nested).replace(/\s+/gu, ' ').trim()
      if (text) signals.push(`${key}=${text.slice(0, 600)}`)
      continue
    }
    if (nested && typeof nested === 'object') collectCodexDiagnosticSignals(nested, signals, depth + 1)
  }
}

function summarizeCodexJsonl(stdout) {
  const summaries = []
  for (const line of String(stdout || '').split(/\r?\n/u).filter(Boolean)) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      const text = line.replace(/\s+/gu, ' ').trim()
      if (/(?:error|fail|cancel|abort)/iu.test(text)) summaries.push(`unparsed ${text.slice(0, 600)}`)
      continue
    }
    const item = event?.item && typeof event.item === 'object' ? event.item : null
    const type = String(event?.type || 'unknown')
    const itemType = String(item?.type || '')
    const name = String(item?.name || item?.tool || item?.tool_name || '')
    const server = String(item?.server || item?.server_name || '')
    const signals = []
    collectCodexDiagnosticSignals(event?.error, signals)
    collectCodexDiagnosticSignals(event?.message, signals)
    collectCodexDiagnosticSignals(item?.error, signals)
    collectCodexDiagnosticSignals(item?.result, signals)
    collectCodexDiagnosticSignals(item?.output, signals)
    if (typeof event?.message === 'string') signals.push(`message=${event.message.replace(/\s+/gu, ' ').slice(0, 600)}`)
    if (typeof event?.error === 'string') signals.push(`error=${event.error.replace(/\s+/gu, ' ').slice(0, 600)}`)
    if (typeof item?.error === 'string') signals.push(`error=${item.error.replace(/\s+/gu, ' ').slice(0, 600)}`)
    const relevant = /(?:error|fail|cancel|abort)/iu.test(type) ||
      /(?:mcp|tool)/iu.test(itemType) ||
      signals.some(signal => /(?:error|fail|cancel|abort|deny|block)/iu.test(signal))
    if (!relevant) continue
    const header = [type, itemType && `item=${itemType}`, server && `server=${server}`, name && `name=${name}`]
      .filter(Boolean)
      .join(' ')
    summaries.push(`${header}${signals.length ? ` ${signals.join(' | ')}` : ''}`.slice(0, 1600))
  }
  return summaries.slice(-30).join('\n').slice(-8000) || 'no relevant JSONL diagnostic events'
}

function runRealCodexTurn(label, prompt, env, options = {}) {
  const hostEnv = { ...process.env, ...env }
  delete hostEnv.CODEX_INTERNAL_ORIGINATOR_OVERRIDE
  delete hostEnv.CODEX_THREAD_ID
  const executableNames = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
  const executable = executableNames
    .map(name => resolveExecutableOnPath(name, hostEnv))
    .find(Boolean)
  assert(executable, `real Codex executable not found on PATH: ${executableNames.join(' or ')}`)
  const outputPath = path.join(tmp, `${label}-last-message.txt`)
  const args = [
    '-a', 'never',
    '-s', 'workspace-write',
    '--add-dir', options.runtimeRoot,
    '-c', 'model_reasoning_effort="medium"',
    '-c', 'mcp_servers.devcodex-profile.default_tools_approval_mode="approve"',
    '-c', 'mcp_servers.devcodex-memory.default_tools_approval_mode="approve"',
    '--dangerously-bypass-hook-trust',
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--output-last-message', outputPath,
    '--color', 'never',
    prompt
  ]
  const startedAt = Date.now()
  const invocation = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
    ? resolveWindowsBatchInvocation(executable, args, hostEnv)
    : { command: executable, args }
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd || consumer,
    env: hostEnv,
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  })
  const eventSummary = summarizeCodexJsonl(result.stdout)
  assert.strictEqual(
    result.status,
    0,
    `real Codex ${label} failed status=${result.status} signal=${result.signal} error=${result.error?.message || 'none'}\nevent-summary:\n${eventSummary}\nstderr:\n${String(result.stderr || '').slice(-4000)}`
  )
  assert.strictEqual(fs.existsSync(outputPath), true, `real Codex ${label} last-message evidence missing`)
  const lastMessage = fs.readFileSync(outputPath, 'utf8').trim()
  return {
    label,
    pid: result.pid || null,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    outputSha256: sha256File(outputPath),
    stdoutSha256: sha256Text(result.stdout),
    lastMessage,
    eventSummary
  }
}

function readInstalledFormalTaskState(installedRuntimeRoot, taskName, invocation = null) {
  const activeRoot = path.join(workspace, '.devcodex', 'consumer')
  const taskRoot = path.join(activeRoot, 'requirements', taskName)
  const identityPath = path.join(taskRoot, '.memory', 'task.json')
  const diagnostic = invocation?.lastMessage
    ? `\nlast-message:\n${invocation.lastMessage.slice(0, 4000)}\nevent-summary:\n${String(invocation.eventSummary || '').slice(-8000)}`
    : ''
  assert.strictEqual(fs.existsSync(identityPath), true, `real Codex task identity missing: ${identityPath}${diagnostic}`)
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'))
  const recoveryStore = require(path.join(installedRuntimeRoot, 'hooks', '_runtime', 'task-recovery-store-v5.cjs'))
  const metaDir = recoveryStore.resolveTaskRecoveryMetaDir({ activeRoot, project: 'consumer' })
  const recovery = recoveryStore.readTaskRecoveryState({
    metaDir,
    identity: {
      activeRoot,
      project: 'consumer',
      taskId: identity.taskId,
      taskStatus: 'active'
    }
  })
  assert.strictEqual(recovery.status, 'fresh', recovery.errorCode || 'real Codex task recovery state unavailable')
  const overviewPath = path.join(taskRoot, '00-需求概况.md')
  assert.strictEqual(fs.existsSync(overviewPath), true, 'real Codex canonical overview missing')
  return {
    activeRoot,
    taskRoot,
    taskId: identity.taskId,
    overviewPath,
    overview: fs.readFileSync(overviewPath, 'utf8'),
    state: recovery.state
  }
}

function formatRealCodexStateDiagnostic(invocation, taskState) {
  const admission = taskState?.state?.admissionTransaction || {}
  const owner = taskState?.state?.fencedWriteOwner || {}
  return [
    `admission: phase=${admission.phase || 'missing'} status=${admission.status || 'missing'} generation=${admission.admissionGeneration || 0} cp1Confirmed=${admission.effects?.cpState?.cp1Confirmed === true}`,
    `owner: status=${owner.status || 'missing'} generation=${owner.ownerGeneration || 0} leaseRevision=${owner.leaseRevision || 0}`,
    `last-message:\n${String(invocation?.lastMessage || 'missing').slice(0, 4000)}`,
    `event-summary:\n${String(invocation?.eventSummary || 'missing').slice(-8000)}`
  ].join('\n')
}

function isolatedHostEnv(home) {
  // Global postinstall skips when CI/GITHUB_ACTIONS is truthy (see npm-lifecycle-adapter).
  // Smoke inherits process.env from GHA; force + clear CI vars so isolated receipts are written.
  const resolvedHome = path.resolve(home)
  const parsedHome = path.parse(resolvedHome)
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
    COPILOT_HOME: path.join(home, '.copilot'),
    HOME: resolvedHome,
    USERPROFILE: resolvedHome,
    HOMEDRIVE: parsedHome.root.replace(/[\\/]$/u, ''),
    HOMEPATH: resolvedHome.slice(parsedHome.root.length - 1),
    APPDATA: path.join(resolvedHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(resolvedHome, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(resolvedHome, '.config'),
    XDG_CACHE_HOME: path.join(resolvedHome, '.cache'),
    npm_config_prefix: globalPrefix,
    npm_config_cache: cacheDir
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

let packCount = 0
let tarball = smokeOptions.tarball
if (tarball) {
  const stat = fs.lstatSync(tarball)
  assert.strictEqual(stat.isFile(), true, '--tarball must identify one regular file')
  assert.strictEqual(stat.isSymbolicLink(), false, '--tarball must not be a symlink')
  assert.match(path.basename(tarball), /\.tgz$/i, '--tarball must use the npm .tgz format')
  assert.strictEqual(path.resolve(tarball).startsWith(`${path.resolve(tmp)}${path.sep}`), false,
    'external tarball must outlive the isolated smoke root')
} else {
  let pack
  try {
    pack = runNpm(['pack', '--json', '--pack-destination', packDir], { timeout: PACKAGE_PACK_TIMEOUT_MS })
    packCount = 1
  } catch (error) {
    try {
      recoverInterruptedSourcePack()
    } catch (recoveryError) {
      error.packageProjectionRecoveryError = recoveryError
    }
    throw error
  }
  const packResult = JSON.parse(pack.stdout)
  assert.ok(Array.isArray(packResult) && packResult.length === 1)
  tarball = path.join(packDir, packResult[0].filename)
}
assert.strictEqual(fs.existsSync(tarball), true)
const tarballBefore = {
  bytes: fs.statSync(tarball).size,
  sha256: sha256File(tarball)
}

fs.writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({
  name: 'isolated-tarball-consumer',
  private: true,
  dependencies: {
    [packageJson.name]: `file:${tarball.replace(/\\/g, '/')}`
  }
}, null, 2)}\n`)

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

runNpm(['install', '--foreground-scripts'], {
  cwd: consumer,
  env: isolatedHostEnv(workspaceHome),
  timeout: 240000
})
assert.strictEqual(
  fs.existsSync(path.join(consumer, 'node_modules', packageJson.name, 'package.json')),
  true,
  'explicit consumer did not install the exact tarball dependency'
)
for (const host of ['.github', '.claude', '.codex', '.gemini', '.grok', '.cursor', '.agents', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json']) {
  assert.strictEqual(
    fs.existsSync(path.join(consumer, host)),
    false,
    `${host} must not be written by explicit consumer install`
  )
}
for (const host of ['.copilot', '.claude', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok', '.cursor']) {
  assert.strictEqual(
    fs.existsSync(receiptPath(workspaceHome, host)),
    false,
    `${host} receipt must not be written by explicit consumer install`
  )
}

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
const installedGrokGlobalHooks = JSON.parse(fs.readFileSync(
  path.join(globalHome, '.grok', 'hooks', 'devcodex.json'),
  'utf8'
))
assert.strictEqual(
  Object.values(installedGrokGlobalHooks.hooks || {}).flat().some(isDevCodexManagedHookEntry),
  false,
  'packed install must not retain a managed Grok global lifecycle declaration'
)
const installedGrokPluginHooks = JSON.parse(fs.readFileSync(
  path.join(globalHome, '.grok', 'devcodex', 'plugins', 'devcodex-workspace', 'hooks', 'hooks.json'),
  'utf8'
))
for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']) {
  const entries = installedGrokPluginHooks.hooks[event]
  assert.strictEqual(entries.length, 1, `packed Grok ${event} must have one plugin declaration`)
  const decoded = decodeHostHookCommand(entries[0].hooks[0].command)
  assert.ok(decoded, `packed Grok ${event} must use CanonicalHostHookCommandV1`)
  assert.deepStrictEqual(decoded.argv.slice(-1), ['grok'])
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
    installedCopilotHooks.hooks[event].some(hook => {
      const decoded = decodeHostHookCommand(hook.command)
      return decoded && JSON.stringify(decoded.argv.slice(-3)) ===
        JSON.stringify(['copilot', '--event', event])
    }),
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
runCommand(binPath, ['init', '--profile', 'consumer'], { cwd: workspace, env: installedEnv })
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
assert.strictEqual(
  fs.existsSync(path.join(workspace, '.devcodex', 'consumer', 'profile', 'README.md')),
  true,
  'workspace init must provision the explicit consumer project Profile'
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

const installedClaudeLauncher = path.join(
  path.dirname(installedRuntimeRoot('claude')),
  'host-hook-launcher.cjs'
)
const importedClaudeLauncherProbe = runCommand(process.execPath, [installedClaudeLauncher, 'claude'], {
  cwd: workspace,
  env: {
    ...installedEnv,
    GROK_HOOK_EVENT: 'PreToolUse',
    GROK_HOOK_NAME: 'devcodex-global-claude',
    GROK_SESSION_ID: 'installed-grok-import-fixture',
    GROK_WORKSPACE_ROOT: workspace
  },
  shell: false
})
assert.strictEqual(importedClaudeLauncherProbe.stdout, '')
assert.strictEqual(importedClaudeLauncherProbe.stderr, '')

const installedCodexAdapter = path.join(
  path.dirname(installedRuntimeRoot('codex')),
  'host-hook-launcher.cjs'
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
    path.dirname(installedRuntimeRoot(host)),
    'host-hook-launcher.cjs'
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

const installedCodexRuntimeRoot = installedRuntimeRoot('codex')
const installedRuntimeGeneration = JSON.parse(fs.readFileSync(
  path.join(installedCodexRuntimeRoot, 'runtime-generation.json'),
  'utf8'
))
assert.strictEqual(installedRuntimeGeneration.promptAssets?.schemaVersion, 'RuntimePromptAssetManifestV1')
assert.ok(installedRuntimeGeneration.promptAssets.count > 0, 'installed Prompt manifest must not be empty')
assert.strictEqual(
  installedRuntimeGeneration.promptAssets.files.length,
  installedRuntimeGeneration.promptAssets.count
)
for (const asset of installedRuntimeGeneration.promptAssets.files) {
  const installedPrompt = path.join(installedCodexRuntimeRoot, ...asset.path.split('/'))
  const stat = fs.lstatSync(installedPrompt)
  assert.strictEqual(stat.isFile(), true, `installed Prompt must be an ordinary file: ${asset.path}`)
  assert.strictEqual(stat.isSymbolicLink(), false, `installed Prompt must not be a symlink: ${asset.path}`)
  assert.strictEqual(stat.size, asset.bytes, `installed Prompt byte count drifted: ${asset.path}`)
  assert.strictEqual(sha256File(installedPrompt), asset.digest, `installed Prompt digest drifted: ${asset.path}`)
}

const installedMemoryServer = path.join(installedCodexRuntimeRoot, 'mcp', 'memory-server.js')
const consumerProject = 'consumer'
const consumerActiveRoot = path.join(workspace, '.devcodex', consumerProject)
assert.strictEqual(
  fs.existsSync(path.join(consumerActiveRoot, 'profile', 'README.md')),
  true,
  'installed formal-writer project must be explicitly registered before project-scoped MCP calls'
)
const successfulTask = '隔离安装模板写入验证'
const successfulTaskRoot = path.join(consumerActiveRoot, 'requirements', successfulTask)
const successfulArtifact = path.join(successfulTaskRoot, '02-技术方案.md')
fs.mkdirSync(successfulTaskRoot, { recursive: true })
fs.writeFileSync(successfulArtifact, '# 隔离安装技术方案\n\n用于验证已安装正式写入器。\n', 'utf8')
const successfulResponses = runInstalledMcp(installedMemoryServer, [
  rpcRequest(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'devcodex-installed-writer-smoke', version: '1' }
  }),
  rpcRequest(2, 'tools/call', {
    name: 'memory_cp_confirm',
    arguments: {
      requirement: successfulTask,
      kind: 'requirements',
      phase: 'CP2',
      artifactPath: '02-技术方案.md',
      artifactVersion: 'v0.1.0-smoke',
      artifactSha256: sha256File(successfulArtifact),
      sourceMessage: '确认隔离安装正式写入器模板验证',
      scope: 'project',
      project: consumerProject
    }
  })
], { inputRoot: workspace, env: installedEnv })
assert.strictEqual(mcpResultById(successfulResponses, 1).serverInfo?.name, 'devcodex-memory')
const successfulWrite = mcpResultById(successfulResponses, 2)
assert.notStrictEqual(successfulWrite.isError, true, successfulWrite.content?.[0]?.text || 'installed formal writer failed')
assert.strictEqual(successfulWrite.structuredContent?.readbackVerified, true)
assert.strictEqual(successfulWrite.structuredContent?.transaction?.templateQualification?.status, 'qualified')
assert.strictEqual(successfulWrite.structuredContent?.transaction?.templateQualification?.readbackVerified, true)
assert.strictEqual(
  successfulWrite.structuredContent?.transaction?.templateBinding?.resolvedTemplateRef,
  'prompts/requirement-session.prompt.md'
)
const successfulSessions = path.join(successfulTaskRoot, '.memory', 'sessions.md')
assert.strictEqual(fs.existsSync(successfulSessions), true, 'installed formal writer did not persist sessions.md')
assert.match(fs.readFileSync(successfulSessions, 'utf8'), /\| CP2 \| ✅ \|/)

const requiredInstalledTemplate = path.join(installedCodexRuntimeRoot, 'prompts', 'requirement-session.prompt.md')
const withheldInstalledTemplate = `${requiredInstalledTemplate}.missing-smoke`
const rejectedTask = '隔离安装模板缺失验证'
const rejectedTaskRoot = path.join(consumerActiveRoot, 'requirements', rejectedTask)
const rejectedArtifact = path.join(rejectedTaskRoot, '02-技术方案.md')
const rejectedSessions = path.join(rejectedTaskRoot, '.memory', 'sessions.md')
fs.mkdirSync(rejectedTaskRoot, { recursive: true })
fs.writeFileSync(rejectedArtifact, '# 模板缺失技术方案\n\n本产物不得触发 sessions.md 写入。\n', 'utf8')
fs.renameSync(requiredInstalledTemplate, withheldInstalledTemplate)
try {
  const rejectedResponses = runInstalledMcp(installedMemoryServer, [
    rpcRequest(3, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: rejectedTask,
        kind: 'requirements',
        phase: 'CP2',
        artifactPath: '02-技术方案.md',
        artifactVersion: 'v0.1.0-smoke',
        artifactSha256: sha256File(rejectedArtifact),
        sourceMessage: '模板缺失时必须失败关闭',
        scope: 'project',
        project: consumerProject
      }
    })
  ], { inputRoot: workspace, env: installedEnv })
  const rejectedWrite = mcpResultById(rejectedResponses, 3)
  assert.strictEqual(rejectedWrite.isError, true, 'missing installed template must reject the formal write')
  assert.strictEqual(rejectedWrite.structuredContent?.errorCode, 'ARTIFACT_TEMPLATE_SOURCE_MISSING')
  assert.match(rejectedWrite.content?.[0]?.text || '', /ARTIFACT_TEMPLATE_SOURCE_MISSING/)
  assert.strictEqual(fs.existsSync(rejectedSessions), false, 'template rejection must have zero formal write effect')
} finally {
  fs.renameSync(withheldInstalledTemplate, requiredInstalledTemplate)
}
assert.strictEqual(
  sha256File(requiredInstalledTemplate),
  installedRuntimeGeneration.promptAssets.files.find(asset => asset.path === 'prompts/requirement-session.prompt.md').digest,
  'installed template was not restored after the negative probe'
)

const installedPackageRoot = path.join(globalPrefix, 'node_modules', packageJson.name)
assert.strictEqual(fs.existsSync(path.join(installedPackageRoot, 'package.json')), true, 'installed package root missing')
if (smokeOptions.tarball) {
  const installedAdmissionSuite = runCommand(process.execPath, [
    path.join(installedPackageRoot, 'scripts', 'test-task-admission-authority.js')
  ], {
    cwd: workspace,
    env: installedEnv,
    timeout: 300000
  })
  assert.match(installedAdmissionSuite.stdout, /"passed":true/)
  installedAdmissionNegativesPassed = true
}

if (smokeOptions.realCodex) {
  console.log('global install smoke realCodex stage=installed-s15 start')
  const installedS15EvidencePath = path.join(tmp, 'installed-codex-s15.json')
  runCommand(process.execPath, [
    path.join(installedPackageRoot, 'scripts', 'probe-skill-route-s15-host.js'),
    '--host', 'codex',
    '--production-eligible',
    '--exercise-context-rebind',
    '--timeout-ms', '900000',
    '--evidence-output', installedS15EvidencePath
  ], {
    cwd: workspace,
    env: installedEnv,
    timeout: 960000
  })
  const installedS15Evidence = JSON.parse(fs.readFileSync(installedS15EvidencePath, 'utf8'))
  assert.strictEqual(installedS15Evidence.schemaVersion, 'SkillRouteS15EvidenceV1')
  assert.strictEqual(installedS15Evidence.status, 'PASS')
  assert.strictEqual(installedS15Evidence.host, 'codex')
  assert.strictEqual(installedS15Evidence.authorizationSource, 'capability-pass')
  assert.strictEqual(installedS15Evidence.runtimeBinding.source, 'installed-production-receipt')
  console.log('global install smoke realCodex stage=installed-s15 pass')

  const formalTaskName = 'Tarball真实宿主连续性验收'
  const firstPrompt = [
    '@rocky 自动执行当前隔离安装包验收，不要向用户追问。',
    '项目固定为 consumer；当前 cwd 就是带显式 package.json 的独立 consumer，活动根固定为其父目录下的 .devcodex/consumer。不得读取或修改隔离 HOME、consumer、该活动根之外的文件。',
    `使用已安装 DevCodex 的公开 Profile/Memory MCP 创建正式 requirements 任务“${formalTaskName}”，不得走 simple-task fast path。`,
    '按模板生成 00-需求概况.md 和 CP1 需求确认产物，自动确认 CP1，并取得 finalized 的第一代正式准入与写 owner。',
    '调用 memory_cp_confirm 前必须形成当前候选的 R3 ReviewGradeCard，并传入 autoDecisionEvidence：riskClass=R3、无 blockers、无 sideEffectCategories、reviewGradeCard.grade=R3、status=PASS、openBlockers=0。',
    '00-需求概况.md 必须包含独立一行 HOST_G1_READY。保持任务 active，不形成 CP2/CP3，不执行 terminal closeout。',
    'memory_cp_confirm 必须返回非 isError 且读回 CP1 confirmed；如参数、路径或摘要绑定失败，按返回的 nextStep 修正后重试，不得提前结束。',
    '随后显式调用 memory_task_write_owner，以当前精确 owner 执行 release；release receipt 必须读回 cp1Confirmed=true 且 owner.status=released。不得仅依赖 Stop hook 猜测已释放。',
    '只有上述 durable readback 全部成立才能结束。最终只简短报告 taskId、admissionGeneration、CP1、owner 状态和文件读回。'
  ].join('\n')
  console.log('global install smoke realCodex stage=formal-g1 start')
  const realCodexOptions = {
    cwd: consumer,
    runtimeRoot: path.join(workspace, '.devcodex', 'consumer')
  }
  const g1Invocation = runRealCodexTurn('formal-g1', firstPrompt, installedEnv, realCodexOptions)
  const g1 = readInstalledFormalTaskState(installedCodexRuntimeRoot, formalTaskName, g1Invocation)
  const g1Diagnostic = formatRealCodexStateDiagnostic(g1Invocation, g1)
  assert.strictEqual(g1.state.admissionTransaction.phase, 'finalized', g1Diagnostic)
  assert.strictEqual(g1.state.admissionTransaction.status, 'finalized', g1Diagnostic)
  assert.strictEqual(g1.state.admissionTransaction.effects?.cpState?.cp1Confirmed, true, g1Diagnostic)
  assert.strictEqual(g1.state.fencedWriteOwner?.status, 'released', g1Diagnostic)
  assert.match(g1.overview, /^HOST_G1_READY$/mu, g1Diagnostic)
  const g1Generation = g1.state.admissionTransaction.admissionGeneration
  const g1CanonicalRevision = g1.state.taskCanonicalRevision?.revision || 0
  console.log(`global install smoke realCodex stage=formal-g1 pass generation=${g1Generation}`)

  const secondPrompt = [
    '@rocky 自动续办当前隔离安装包验收，不要向用户追问。',
    '项目固定为 consumer；当前 cwd 就是带显式 package.json 的独立 consumer，活动根固定为其父目录下的 .devcodex/consumer。不得读取或修改隔离 HOME、consumer、该活动根之外的文件。',
    `精确续办正式 requirements 任务“${formalTaskName}”，TaskIdentity=${g1.taskId}。`,
    '必须先用 memory_task_resolve 和 memory_task_admit_v2 的 bind/adopt + continue 安全取得下一准入代，禁止新建同名任务。',
    '续代成功后按模板形成并确认 CP2、CP3，把 00-需求概况.md 的 HOST_G1_READY 独立行替换为 HOST_G2_READY，并完成正式写入读回。',
    '每次调用 memory_cp_confirm 前必须形成当前候选的 R3 ReviewGradeCard，并传入 autoDecisionEvidence：riskClass=R3、无 blockers、无 sideEffectCategories、reviewGradeCard.grade=R3、status=PASS、openBlockers=0。',
    '随后按 DevCodex 要求生成 ECR、报告、记忆和完成清单四类证据，执行 completed terminal closeout，确保旧 owner 无写权限。',
    '最终只简短报告 taskId、前后 admissionGeneration、canonical revision、terminalStatus 和文件读回。'
  ].join('\n')
  console.log('global install smoke realCodex stage=formal-g2 start')
  const g2Invocations = [runRealCodexTurn('formal-g2', secondPrompt, installedEnv, realCodexOptions)]
  let g2 = readInstalledFormalTaskState(installedCodexRuntimeRoot, formalTaskName, g2Invocations[0])
  const g2Ready = () => g2.state.admissionTransaction.admissionGeneration > g1Generation &&
    /^HOST_G2_READY$/mu.test(g2.overview) &&
    g2.state.workflowTaskTerminalReceipt?.terminalStatus === 'completed'
  if (!g2Ready()) {
    const retryPrompt = [
      '@rocky 这是同一隔离验收的唯一受控重试，不要新建任务也不要向用户追问。',
      `继续 TaskIdentity=${g1.taskId}；读取当前 durable state，补齐尚未完成的 G2 写入或 completed terminal closeout。`,
      '必须保持 HOST_G2_READY 文件读回、准入代单调递增、旧 owner 失权，并使用模板生成缺失的四类关闭证据。',
      '任何尚未完成的 memory_cp_confirm 都必须传当前 R3 PASS、零 blocker、零 side effect 的 autoDecisionEvidence。'
    ].join('\n')
    console.log('global install smoke realCodex stage=formal-g2 retry')
    g2Invocations.push(runRealCodexTurn('formal-g2-retry', retryPrompt, installedEnv, realCodexOptions))
    g2 = readInstalledFormalTaskState(installedCodexRuntimeRoot, formalTaskName)
  }
  assert(g2.state.admissionTransaction.admissionGeneration > g1Generation, 'real Codex did not create a later admission generation')
  assert((g2.state.taskCanonicalRevision?.revision || 0) > g1CanonicalRevision, 'real Codex canonical revision did not advance')
  assert.match(g2.overview, /^HOST_G2_READY$/mu)
  assert.strictEqual(g2.state.admissionTransaction.phase, 'terminal-closeout')
  assert.strictEqual(g2.state.workflowTaskTerminalReceipt?.terminalStatus, 'completed')
  assert.strictEqual(g2.state.fencedWriteOwner?.status, 'terminal')
  assert.ok(
    Array.isArray(g2.state.autoCheckpointDecisions) &&
      ['CP2', 'CP3'].every(phase => g2.state.autoCheckpointDecisions.some(decision =>
        decision.checkpoint === phase && decision.decision === 'auto-pass')),
    'real Codex did not persist auto-pass decisions for CP2 and CP3'
  )
  realCodexEvidence = {
    s15RawDigest: installedS15Evidence.rawDigest,
    taskId: g1.taskId,
    g1AdmissionGeneration: g1Generation,
    finalAdmissionGeneration: g2.state.admissionTransaction.admissionGeneration,
    g1CanonicalRevision,
    finalCanonicalRevision: g2.state.taskCanonicalRevision.revision,
    terminalStatus: g2.state.workflowTaskTerminalReceipt.terminalStatus,
    invocations: [g1Invocation, ...g2Invocations]
  }
  console.log(`global install smoke realCodex stage=formal-g2 pass generation=${realCodexEvidence.finalAdmissionGeneration}`)
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
assert.strictEqual(fs.readFileSync(path.join(globalHome, '.codex', 'config.toml'), 'utf8'), codexConfigSentinel)
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

cleanupTempFixture()
assert.strictEqual(fs.existsSync(tmp), false, 'global install smoke temporary fixture must be removed before success')
if (smokeOptions.tarball) {
  assert.strictEqual(fs.existsSync(tarball), true, 'external exact tarball was removed with the smoke fixture')
  assert.strictEqual(fs.statSync(tarball).size, tarballBefore.bytes, 'external exact tarball byte count changed')
  assert.strictEqual(sha256File(tarball), tarballBefore.sha256, 'external exact tarball digest changed')
}
console.log(`global install smoke passed pack=${packCount} externalTarball=${smokeOptions.tarball ? 1 : 0} tarballBytes=${tarballBefore.bytes} tarballSha256=${tarballBefore.sha256} realGlobalInstall=1 installedPromptManifest=1 installedFormalWriter=1 templateMissingZeroWrite=1 installedAdmissionNegatives=${installedAdmissionNegativesPassed ? 1 : 0} realCodex=${realCodexEvidence ? 1 : 0} realCodexG1=${realCodexEvidence?.g1AdmissionGeneration || 0} realCodexFinalGeneration=${realCodexEvidence?.finalAdmissionGeneration || 0} realCodexTerminal=${realCodexEvidence?.terminalStatus === 'completed' ? 1 : 0} managedRemove=1 npmUninstall=1 idempotent=1 userContent=1 layeredStatus=1 grokNative=${grokAvailable ? 1 : 0} workspaceNoHostDirs=1 tempCleanup=1 version=${packageJson.version}`)
