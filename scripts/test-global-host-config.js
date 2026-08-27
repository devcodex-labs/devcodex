#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  applyGlobalHostConfig,
  buildGlobalHostConfigPlan,
  grokGlobalHookDelegationDocument,
  MCP_RUNTIME_DEPS,
  inspectGlobalHostConfig,
  inspectGlobalHostConfiguration,
  mergeVscodeUserMcpContent,
  shellCommand
} = require('./lib/global-host-config.js')
const {
  isDevCodexManagedHookEntry,
  mergeHostJsonContent,
  mergeJsonContent,
  mergeManagedBlock,
  mergeManagedTomlTables,
  quoteToml,
  tomlManagedFileMatches
} = require('./lib/global-host-config-merge.js')
const {
  buildHostHookCommand,
  canonicalNodeExecutable,
  decodeHostHookCommand
} = require('./lib/host-command.js')
const {
  patchProbeHookCommand
} = require('./probe-skill-route-s15-host.js')
const {
  contextAcquisitionObservationMode,
  contextAcquisitionObservedTools
} = require('./lib/s15-context-evidence.js')
const {
  isGrokImportedClaudeHook,
  resolveCurrentAdapter
} = require('../hooks/_runtime/host-hook-launcher.cjs')
const {
  executeGlobalHostTransaction: executeGlobalHostTransactionRaw
} = require('./lib/global-host-config-transaction.js')
const {
  GLOBAL_HOST_IDS,
  resolveGlobalHostTarget,
  resolveGlobalHostTargets,
  resolveVscodeUserMcpPaths
} = require('./lib/global-host-target.js')
const { projectionDescriptors } = require('./lib/host-surface-descriptors.js')
const {
  assertRuntimeClosureCovered
} = require('./lib/runtime-dependency-closure.js')

const packageRoot = path.resolve(__dirname, '..')
const cliEntry = path.join(packageRoot, 'index.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-host config with spaces-'))
let tempCleaned = false
function executeGlobalHostTransaction(operations, options = {}) {
  return executeGlobalHostTransactionRaw(operations, {
    ...options,
    transactionRoot: options.transactionRoot || path.join(options.allowedRoots[0], '.devcodex-test-transactions')
  })
}
function cleanupTempFixture() {
  if (tempCleaned) return
  fs.rmSync(tmp, { recursive: true, force: true })
  tempCleaned = true
}
process.once('exit', cleanupTempFixture)
const home = path.join(tmp, 'user home')
const workspace = path.join(tmp, 'workspace')
fs.mkdirSync(home, { recursive: true })
fs.mkdirSync(workspace, { recursive: true })
fs.writeFileSync(path.join(workspace, 'package.json'), '{ "name": "global-host-doctor-fixture" }\n')
fs.mkdirSync(path.join(workspace, '.devcodex', 'workspace', 'skills', 'test'), { recursive: true })
fs.writeFileSync(path.join(workspace, '.devcodex', 'layout.json'), `${JSON.stringify({
  version: 1,
  mode: 'workspace-namespace'
}, null, 2)}\n`)
fs.writeFileSync(path.join(workspace, '.devcodex', 'workspace', 'skills', 'test', 'SKILL.md'), [
  '---',
  'name: test',
  'description: 当用户发送「test」时使用。',
  '---',
  '# test',
  '',
  '## 必须回复',
  '- 小朋友真可爱',
  ''
].join('\n'))

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'global-host-config', 'cases.json'), 'utf8'))
assert.deepStrictEqual(fixture.hosts.map(item => item.id), GLOBAL_HOST_IDS)
assertRuntimeClosureCovered(packageRoot, MCP_RUNTIME_DEPS, { label: 'global host runtime deps' })

const env = {
  ...process.env,
  DEVCODEX_TEST_HOME: home,
  USERPROFILE: home,
  HOME: home,
  CODEX_HOME: path.join(home, '.codex'),
  CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  GEMINI_CLI_HOME: path.join(home, 'gemini-cli-home'),
  GROK_HOME: path.join(home, '.grok'),
  CURSOR_HOME: path.join(home, '.cursor'),
  COPILOT_HOME: path.join(home, '.copilot')
}
const emptyPath = path.join(tmp, 'empty-path')
fs.mkdirSync(emptyPath, { recursive: true })
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH'
const doctorEnv = {
  ...env,
  [pathKey]: emptyPath,
  DEVCODEX_AGENT: '',
  CLAUDE_CODE_VERSION: '',
  OPENAI_CODEX: '',
  GEMINI_AGENT: '',
  GROK_AGENT: '',
  CURSOR_VERSION: ''
}
const trustedNodeExecutable = canonicalNodeExecutable()

function hookCommandArgv(command) {
  const decoded = decodeHostHookCommand(command)
  assert.ok(decoded, `expected CanonicalHostHookCommandV1: ${command}`)
  return decoded.argv
}

function runDoctorHuman() {
  const result = spawnSync(process.execPath, [cliEntry, 'doctor'], {
    cwd: workspace,
    encoding: 'utf8',
    env: doctorEnv
  })
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  return String(`${result.stdout || ''}${result.stderr || ''}`).replace(/\x1b\[[0-9;]*m/g, '')
}

const targets = resolveGlobalHostTargets({ env, home })
assert.strictEqual(targets.length, 6)
for (const target of targets) {
  assert.ok(target.root.startsWith(home), `${target.host} root escaped isolated home`)
}
assert.strictEqual(
  targets.find(target => target.host === 'gemini').root,
  path.join(home, 'gemini-cli-home', '.gemini')
)
const surfaceDescriptors = projectionDescriptors(['all'])
assert.ok(surfaceDescriptors.length >= GLOBAL_HOST_IDS.length)
assert.ok(surfaceDescriptors.every(item => item.scope === 'user-global'))
assert.ok(surfaceDescriptors.every(item => item.workspaceWrite === false))
assert.deepStrictEqual(
  Array.from(new Set(surfaceDescriptors.map(item => item.surface))).sort(),
  [...GLOBAL_HOST_IDS, 'shared-agent-runtime'].sort()
)

fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
const legacyClaudeCompatibleCommand = `node "${path.join(
  home,
  '.claude',
  'devcodex',
  'runtime-1.17.2-legacy-generation',
  'hooks',
  '_runtime',
  'lifecycle-cursor-compatible.cjs'
)}" claude`
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
  theme: 'user-owned',
  nested: { keep: true },
  hooks: {
    CustomEvent: [{ hooks: [{ type: 'command', command: 'user-command' }] }],
    PreToolUse: [
      { matcher: 'custom', hooks: [{ type: 'command', command: 'echo custom-pre' }] },
      { matcher: '', hooks: [{ type: 'command', command: 'node .claude/hooks/_runtime/lifecycle.cjs' }] },
      { matcher: '', hooks: [{ type: 'command', command: legacyClaudeCompatibleCommand }] }
    ],
    UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: legacyClaudeCompatibleCommand }] }],
    PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: legacyClaudeCompatibleCommand }] }],
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: legacyClaudeCompatibleCommand }] }]
  }
}, null, 2) + '\n')
const cursorManagedEvents = [
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
const legacyCursorCompatibleCommand = `node "${path.join(
  home,
  '.cursor',
  'devcodex',
  'runtime-1.17.2-legacy-generation',
  'hooks',
  '_runtime',
  'lifecycle-cursor-compatible.cjs'
)}" cursor --cursor-plugin-path "${path.join(home, '.cursor', 'devcodex', 'plugins', 'devcodex-workspace')}"`
const userCursorCompatibleCommand = `node "${path.join(
  home,
  'user-tools',
  'lifecycle-cursor-compatible.cjs'
)}" cursor`
const userSharedAdapterCommand = `node "${path.join(
  home,
  'user-tools',
  'lifecycle-host-adapters.cjs'
)}" cursor`
const userCursorNativeSharedCommand = `node "${path.join(
  home,
  '.cursor',
  'hooks',
  '_runtime',
  'lifecycle-host-adapters.cjs'
)}" cursor`
const userClaudeCustomLifecycleCommand = `node "${path.join(
  home,
  '.claude',
  'hooks',
  '_runtime',
  'lifecycle-company.cjs'
)}"`
assert.strictEqual(isDevCodexManagedHookEntry(legacyCursorCompatibleCommand), true)
assert.strictEqual(isDevCodexManagedHookEntry(legacyClaudeCompatibleCommand), true)
assert.strictEqual(isDevCodexManagedHookEntry(userCursorCompatibleCommand), false)
assert.strictEqual(isDevCodexManagedHookEntry(userSharedAdapterCommand), false)
assert.strictEqual(isDevCodexManagedHookEntry(userCursorNativeSharedCommand), false)
assert.strictEqual(isDevCodexManagedHookEntry(userClaudeCustomLifecycleCommand), false)
assert.strictEqual(isDevCodexManagedHookEntry(
  legacyCursorCompatibleCommand.replace(
    'lifecycle-cursor-compatible.cjs',
    'lifecycle-cursor-compatible.cjs.backup'
  )
), false)
assert.strictEqual(isDevCodexManagedHookEntry('node devcodex/runtime-old/hooks/_runtime/lifecycle.cjs.backup'), false)
assert.strictEqual(isDevCodexManagedHookEntry('node .claude/hooks/_runtime/lifecycle.cjs'), true)
assert.strictEqual(isDevCodexManagedHookEntry('node .gemini/hooks/_runtime/lifecycle-host-adapters.cjs gemini'), true)
assert.strictEqual(isDevCodexManagedHookEntry({
  command: 'echo user-command',
  metadata: 'documentation example: node devcodex/runtime-old/hooks/_runtime/lifecycle.cjs'
}), false)
assert.strictEqual(isDevCodexManagedHookEntry({
  matcher: '',
  hooks: [{ type: 'command', command: legacyClaudeCompatibleCommand }]
}), true)
const legacyGrokManagedCommand = 'node .grok/hooks/_runtime/lifecycle-host-adapters.cjs grok'
const grokUserCommand = 'echo grok-user-hook'
assert.strictEqual(isDevCodexManagedHookEntry(legacyGrokManagedCommand), true)
fs.mkdirSync(path.join(home, '.grok', 'hooks'), { recursive: true })
fs.writeFileSync(path.join(home, '.grok', 'hooks', 'devcodex.json'), JSON.stringify({
  description: 'legacy global Grok hooks with user-owned content',
  hooks: {
    PreToolUse: [
      { matcher: 'user', hooks: [{ type: 'command', command: grokUserCommand }] },
      { matcher: '', hooks: [{ type: 'command', command: legacyGrokManagedCommand }] }
    ],
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: legacyGrokManagedCommand }] }]
  }
}, null, 2) + '\n')
fs.mkdirSync(path.join(home, '.cursor'), { recursive: true })
fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), JSON.stringify({
  version: 1,
  userOwned: { keep: true },
  hooks: Object.fromEntries(cursorManagedEvents.map(event => [
    event,
    [
      ...(event === 'preToolUse'
        ? [
            { command: 'echo cursor-user', matcher: 'custom', timeout: 9 },
            { command: userCursorCompatibleCommand, matcher: 'user-compatible', timeout: 9 },
            { command: userSharedAdapterCommand, matcher: 'user-shared-adapter', timeout: 9 },
            { command: userCursorNativeSharedCommand, matcher: 'user-cursor-native-shared', timeout: 9 }
          ]
        : []),
      { command: legacyCursorCompatibleCommand, timeout: 30 }
    ]
  ]))
}, null, 2) + '\n')
fs.mkdirSync(path.join(home, '.copilot', 'hooks'), { recursive: true })
fs.writeFileSync(path.join(home, '.copilot', 'hooks', 'devcodex.json'), JSON.stringify({
  version: 1,
  hooks: {
    notification: [{ type: 'command', command: 'echo user-notification' }]
  }
}, null, 2) + '\n')
fs.writeFileSync(path.join(home, '.copilot', 'mcp-config.json'), JSON.stringify({
  theme: 'user-owned',
  mcpServers: {
    custom: { type: 'local', command: 'custom', args: [], env: {}, tools: ['*'] }
  }
}, null, 2) + '\n')
fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
fs.writeFileSync(path.join(home, '.codex', 'config.toml'), [
  'model = "user-choice"',
  '',
  '# BEGIN DEVCODEX-MCP-MANAGED',
  '[mcp_servers.devcodex-memory]',
  'command = "node"',
  'args = ["old-runtime.js"]',
  '',
  '[mcp_servers.devcodex-profile]',
  'command = "node"',
  'args = ["old-profile.js"]',
  '# END DEVCODEX-MCP-MANAGED',
  '',
  '[mcp_servers.user-keep]',
  'command = "custom"',
  ''
].join('\n'))

assert.throws(
  () => mergeVscodeUserMcpContent('{ invalid user JSON', path.join(home, 'runtime'), { host: 'copilot' }),
  error => error?.code === 'GLOBAL_HOST_JSON_INVALID',
  'invalid VS Code user mcp.json must fail closed instead of being replaced with a managed-only document'
)

const hostileHookRoot = path.join(tmp, 'hook %PATH% !DEVCODEX_EXPAND! & shell')
const hostileHookScript = path.join(hostileHookRoot, 'hook probe.cjs')
fs.mkdirSync(hostileHookRoot, { recursive: true })
fs.writeFileSync(hostileHookScript, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n', 'utf8')
const hostileHookCommand = shellCommand(hostileHookScript, 'grok')
assert.ok(hostileHookCommand.includes(path.resolve(process.execPath)), 'Hook command must bind the current Node executable')
assert.ok(!hostileHookCommand.includes(hostileHookScript), 'Hook script path must not remain shell-interpretable')
assert.doesNotMatch(hostileHookCommand, /%PATH%|!DEVCODEX_EXPAND!|& shell/)
const hostileHookProbe = spawnSync(hostileHookCommand, {
  cwd: workspace,
  shell: true,
  encoding: 'utf8',
  env: { ...env, DEVCODEX_EXPAND: 'MUST_NOT_EXPAND' }
})
assert.strictEqual(hostileHookProbe.status, 0, hostileHookProbe.stderr || hostileHookProbe.stdout)
assert.deepStrictEqual(JSON.parse(hostileHookProbe.stdout), ['grok'])
const directHostHookCommand = buildHostHookCommand(hostileHookScript, ['grok'])
assert.deepStrictEqual(hookCommandArgv(directHostHookCommand), [hostileHookScript, 'grok'])
if (process.platform === 'win32') {
  assert.match(directHostHookCommand, /^cmd\.exe \/d \/s \/c call /)
  const powershellHookProbe = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    directHostHookCommand
  ], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...env, DEVCODEX_EXPAND: 'MUST_NOT_EXPAND' },
    windowsHide: true
  })
  assert.strictEqual(
    powershellHookProbe.status,
    0,
    powershellHookProbe.stderr || powershellHookProbe.stdout
  )
  assert.deepStrictEqual(JSON.parse(powershellHookProbe.stdout), ['grok'])
}

const plan = buildGlobalHostConfigPlan({ packageRoot, env, home })
assert.strictEqual(plan.workspaceHostDirectoriesWritten, false)
assert.strictEqual(plan.sharedRuntimeOwnerHost, 'codex')
assert.ok(plan.operations.length > 50)
assert.ok(plan.operations.every(operation => !operation.path.startsWith(workspace)))
assert.ok(plan.operations.every(operation =>
  (/^[a-f0-9]{64}$/.test(operation.expectedDigest || '') && operation.expectAbsent !== true) ||
  (operation.expectAbsent === true && operation.expectedDigest == null)
), 'every global config plan operation must carry exactly one plan-time CAS precondition')
const operationOwners = new Map()
for (const operation of plan.operations) {
  const destination = path.resolve(operation.path).toLowerCase()
  if (!operationOwners.has(destination)) operationOwners.set(destination, new Set())
  operationOwners.get(destination).add(operation.host)
}
assert.deepStrictEqual(
  [...operationOwners.entries()].filter(([, owners]) => owners.size > 1),
  [],
  'every global destination must have one transaction owner'
)
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.codex', 'AGENTS.md'))))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.claude', 'settings.json'))))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.grok', 'hooks', 'devcodex.json'))))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.cursor', 'hooks.json'))))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.cursor', 'devcodex', 'plugins', 'devcodex-workspace', '.cursor-plugin', 'plugin.json'))))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.cursor', 'devcodex', 'plugins', 'devcodex-workspace', 'mcp.json'))))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.agents', 'devcodex', 'instructions.full.md'))))
// Default skillsDeployMode=hidden → G_RUNTIME under .agents/devcodex/skills (not L1 scan roots)
assert.ok(
  plan.operations.some(operation =>
    operation.path.endsWith(path.join('.agents', 'devcodex', 'skills', 'routing', 'SKILL.md'))
  ),
  'hidden mode must deploy active skills to G_RUNTIME'
)
assert.ok(
  !plan.operations.some(operation =>
    operation.path.includes(path.join('.agents', 'skills', 'routing'))
  ),
  'hidden mode must not deploy skills into scan root .agents/skills'
)
assert.ok(
  !plan.operations.some(operation =>
    operation.path.includes(path.join('.claude', 'skills', 'routing'))
  ),
  'hidden mode must not deploy skills into Claude scan root'
)
assert.strictEqual(plan.skillsDeployMode, 'hidden')
for (const graySkill of ['brand-visual-quality', 'consumer-validation-engineering', 'rework-prevention-engineering']) {
  assert.ok(
    !plan.operations.some(operation => operation.path.includes(path.join('.agents', 'skills', graySkill))),
    `gray Skill must not enter shared scan deployment: ${graySkill}`
  )
  assert.ok(
    !plan.operations.some(operation => operation.path.includes(path.join('devcodex', 'skills', graySkill))),
    `gray Skill must not enter G_RUNTIME deployment: ${graySkill}`
  )
  assert.ok(
    !plan.operations.some(operation => operation.path.includes(path.join('.claude', 'skills', graySkill))),
    `gray Skill must not enter Claude global deployment: ${graySkill}`
  )
}

const dryRun = applyGlobalHostConfig({ packageRoot, env, home, dryRun: true })
assert.strictEqual(dryRun.transaction.status, 'planned')
assert.strictEqual(fs.existsSync(path.join(home, '.grok', 'devcodex', 'global-host-receipt.json')), false)
assert.strictEqual(fs.existsSync(path.join(home, '.cursor', 'devcodex', 'global-host-receipt.json')), false)

const applied = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(applied.transaction.status, 'committed')
assert.strictEqual(applied.transaction.activationLeaseCleanupIncomplete, false)
for (const target of applied.targets) {
  assert.strictEqual(
    fs.existsSync(path.join(target.runtimeBaseRoot, '.runtime-generation-leases')),
    false,
    `${target.host} activation lease directory must be removed after the host transaction`
  )
}
assert.strictEqual(applied.workspaceHostDirectoriesWritten, false)
for (const [host, configPath] of [
  ['codex', path.join(home, '.codex', 'hooks.json')],
  ['claude', path.join(home, '.claude', 'settings.json')]
]) {
  const originalConfig = fs.readFileSync(configPath, 'utf8')
  const restoreProbeHook = patchProbeHookCommand(
    host,
    path.join(tmp, `${host}-authority.json`),
    path.join(tmp, `${host}-route.jsonl`),
    path.join(tmp, `${host}-lifecycle.jsonl`),
    workspace,
    `ctx-${host}`,
    false,
    { env, home }
  )
  const patchedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const patchedArgv = []
  function collectPatchedArgv(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'command' && typeof child === 'string') {
        const decoded = decodeHostHookCommand(child)
        if (decoded?.argv?.[0]?.endsWith('host-hook-launcher.cjs')) patchedArgv.push(decoded.argv)
      } else {
        collectPatchedArgv(child)
      }
    }
  }
  collectPatchedArgv(patchedConfig)
  assert.ok(patchedArgv.length > 0, `${host} S15 must locate canonical managed hook commands`)
  for (const argv of patchedArgv) {
    assert.deepStrictEqual(argv.slice(-10), [
      '--skill-route-probe-authority', path.join(tmp, `${host}-authority.json`),
      '--skill-route-trace', path.join(tmp, `${host}-route.jsonl`),
      '--lifecycle-trace', path.join(tmp, `${host}-lifecycle.jsonl`),
      '--workspace-root', workspace,
      '--context-epoch', `ctx-${host}`
    ])
  }
  restoreProbeHook()
  assert.strictEqual(
    fs.readFileSync(configPath, 'utf8'),
    originalConfig,
    `${host} S15 hook patch must restore canonical host config exactly`
  )
}
for (const target of targets) {
  const launcher = path.join(target.runtimeBaseRoot, 'host-hook-launcher.cjs')
  assert.strictEqual(fs.existsSync(launcher), true, `${target.host} stable Hook launcher missing`)
  const resolution = resolveCurrentAdapter(target.host, { baseRoot: target.runtimeBaseRoot })
  assert.strictEqual(path.resolve(resolution.runtimeRoot), path.resolve(target.runtimeRoot))
  assert.strictEqual(
    path.basename(resolution.adapter),
    ['claude', 'cursor'].includes(target.host)
      ? 'lifecycle-cursor-compatible.cjs'
      : 'lifecycle-host-adapters.cjs'
  )
  const probe = spawnSync(process.execPath, [launcher, target.host, '--contract-probe'], {
    cwd: workspace,
    env,
    encoding: 'utf8',
    windowsHide: true
  })
  assert.strictEqual(probe.status, 0, `${target.host} stable Hook launcher probe failed: ${probe.stderr}`)
  const probePayload = JSON.parse(probe.stdout)
  assert.strictEqual(probePayload.schemaVersion, 'HostLifecycleAdapterContractProbeV1')
  assert.strictEqual(probePayload.host, target.host)
  assert.strictEqual(probePayload.status, 'passed')
}
const grokReservedEnvNames = [
  'GROK_HOOK_EVENT',
  'GROK_HOOK_NAME',
  'GROK_SESSION_ID',
  'GROK_WORKSPACE_ROOT'
]
const cleanLauncherEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
  !grokReservedEnvNames.some(name => name.toLowerCase() === key.toLowerCase())
))
const importedClaudeEnv = {
  ...cleanLauncherEnv,
  GROK_HOOK_EVENT: 'PreToolUse',
  GROK_HOOK_NAME: 'devcodex-global-claude',
  GROK_SESSION_ID: 'grok-session-fixture',
  GROK_WORKSPACE_ROOT: workspace
}
assert.strictEqual(isGrokImportedClaudeHook('claude', importedClaudeEnv), true)
assert.strictEqual(isGrokImportedClaudeHook('grok', importedClaudeEnv), false)
for (const missingName of grokReservedEnvNames) {
  const incompleteEnv = { ...importedClaudeEnv }
  delete incompleteEnv[missingName]
  assert.strictEqual(isGrokImportedClaudeHook('claude', incompleteEnv), false)
}
const sourceStableLauncher = path.join(packageRoot, 'hooks', '_runtime', 'host-hook-launcher.cjs')
const importedClaudeProbe = spawnSync(process.execPath, [sourceStableLauncher, 'claude'], {
  cwd: workspace,
  env: importedClaudeEnv,
  encoding: 'utf8',
  windowsHide: true
})
assert.strictEqual(importedClaudeProbe.status, 0, importedClaudeProbe.stderr || importedClaudeProbe.stdout)
assert.strictEqual(importedClaudeProbe.stdout, '')
assert.strictEqual(importedClaudeProbe.stderr, '')
const nativeClaudeProbe = spawnSync(process.execPath, [sourceStableLauncher, 'claude'], {
  cwd: workspace,
  env: cleanLauncherEnv,
  encoding: 'utf8',
  windowsHide: true
})
assert.strictEqual(nativeClaudeProbe.status, 2)
assert.match(nativeClaudeProbe.stderr, /GLOBAL_HOST_LAUNCHER_METADATA_INVALID/)
const launcherEscapeRoot = path.join(tmp, 'launcher-runtime-escape')
fs.mkdirSync(launcherEscapeRoot, { recursive: true })
fs.writeFileSync(path.join(launcherEscapeRoot, 'global-host-receipt.json'), JSON.stringify({
  schemaVersion: 'GlobalHostConfigReceiptV1',
  result: 'committed',
  host: 'codex',
  runtimeRoot: path.dirname(launcherEscapeRoot)
}))
assert.throws(
  () => resolveCurrentAdapter('codex', { baseRoot: launcherEscapeRoot }),
  error => error?.code === 'GLOBAL_HOST_LAUNCHER_RUNTIME_ESCAPE'
)
assert.deepStrictEqual(contextAcquisitionObservedTools({
  postHistory: [
    { canonical: 'devcodex-profile/profile_context_plan' },
    { canonical: 'devcodex-profile/profile_context_plan' },
    { canonical: 'devcodex-profile/skill_route' }
  ]
}), [
  'devcodex-profile/profile_context_plan',
  'devcodex-profile/skill_route'
])
assert.deepStrictEqual(contextAcquisitionObservedTools({
  receipt: {
    observations: [
      { successful: true, outcome: 'baseline-ready', sourceKind: 'profile-baseline' },
      { successful: true, outcome: 'observed-success', sourceKind: 'profile' },
      { successful: true, outcome: 'observed-success', sourceKind: 'memory' }
    ]
  }
}), [
  'devcodex-profile/profile_context_plan',
  'devcodex-profile/profile_load',
  'devcodex-memory/memory_status'
])
assert.strictEqual(contextAcquisitionObservationMode({
  postHistory: [{ canonical: 'devcodex-profile/profile_context_plan' }]
}), 'hook-post-history')
assert.strictEqual(contextAcquisitionObservationMode({
  receipt: { observations: [] }
}), 'structured-context-receipt')
const casPlan = buildGlobalHostConfigPlan({ packageRoot, env, home, hosts: ['codex'] })
const casTarget = casPlan.targets.find(target => target.host === 'codex')
const casOperation = casPlan.hostPlans.find(item => item.host === 'codex').operations.find(operation =>
  path.resolve(operation.path) === path.resolve(casTarget.files.config)
)
assert.ok(casOperation?.expectedDigest)
const casOriginal = fs.readFileSync(casOperation.path, 'utf8')
fs.writeFileSync(casOperation.path, `${casOriginal}\n# concurrent user edit\n`, 'utf8')
assert.throws(() => executeGlobalHostTransaction([casOperation], {
  allowedRoots: [casTarget.root, ...(casTarget.additionalRoots || [])],
  allowedFiles: casTarget.additionalFiles || []
}), error => error?.code === 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED')
assert.match(fs.readFileSync(casOperation.path, 'utf8'), /concurrent user edit/)
fs.writeFileSync(casOperation.path, casOriginal, 'utf8')
const casRaceOperation = {
  ...casOperation,
  content: `${casOriginal}\n# devcodex planned update\n`
}
let casRenameRaceInjected = false
const casRenameRaceFs = Object.create(fs)
casRenameRaceFs.renameSync = (source, destination) => {
  if (!casRenameRaceInjected && path.resolve(source) === path.resolve(casRaceOperation.path) &&
      String(destination).startsWith(`${casRaceOperation.path}.devcodex-backup.`)) {
    casRenameRaceInjected = true
    fs.writeFileSync(source, `${casOriginal}\n# rename-window concurrent edit\n`, 'utf8')
  }
  return fs.renameSync(source, destination)
}
assert.throws(() => executeGlobalHostTransaction([casRaceOperation], {
  fs: casRenameRaceFs,
  allowedRoots: [casTarget.root, ...(casTarget.additionalRoots || [])],
  allowedFiles: casTarget.additionalFiles || []
}), error => error?.code === 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED')
assert.match(fs.readFileSync(casOperation.path, 'utf8'), /rename-window concurrent edit/)
fs.writeFileSync(casOperation.path, casOriginal, 'utf8')
const grokGlobalHooks = JSON.parse(fs.readFileSync(
  path.join(home, '.grok', 'hooks', 'devcodex.json'),
  'utf8'
))
const grokGlobalTarget = targets.find(target => target.host === 'grok')
const grokGlobalRuntimeEntry = path.join(grokGlobalTarget.runtimeBaseRoot, 'host-hook-launcher.cjs')
assert.deepStrictEqual(grokGlobalHookDelegationDocument().hooks, {})
assert.match(grokGlobalHooks.description, /owned by the enabled devcodex-workspace plugin/)
assert.strictEqual(
  Object.values(grokGlobalHooks.hooks || {}).flat().some(isDevCodexManagedHookEntry),
  false,
  'Grok global hooks must not retain a DevCodex lifecycle declaration'
)
assert.deepStrictEqual(grokGlobalHooks.hooks.PreToolUse, [
  { matcher: 'user', hooks: [{ type: 'command', command: grokUserCommand }] }
])
assert.strictEqual(grokGlobalHooks.hooks.Stop, undefined)
const grokPluginHooks = JSON.parse(fs.readFileSync(
  path.join(grokGlobalTarget.files.plugin, 'hooks', 'hooks.json'),
  'utf8'
))
for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']) {
  assert.strictEqual(grokPluginHooks.hooks[event].length, 1, `Grok ${event} must have one plugin owner`)
  assert.deepStrictEqual(
    hookCommandArgv(grokPluginHooks.hooks[event][0].hooks[0].command),
    [grokGlobalRuntimeEntry, 'grok']
  )
}
const cursorTarget = targets.find(target => target.host === 'cursor')
const cursorSourceManifest = JSON.parse(fs.readFileSync(
  path.join(packageRoot, 'cursor', 'plugins', 'devcodex-workspace', '.cursor-plugin', 'plugin.json'),
  'utf8'
))
assert.strictEqual(cursorSourceManifest.version, require('../package.json').version)
const cursorHooks = JSON.parse(fs.readFileSync(cursorTarget.files.hooks, 'utf8'))
assert.strictEqual(cursorHooks.userOwned.keep, true)
for (const event of cursorManagedEvents) {
  assert.ok(Array.isArray(cursorHooks.hooks[event]), `Cursor hook event missing: ${event}`)
  const managed = cursorHooks.hooks[event].filter(isDevCodexManagedHookEntry)
  assert.strictEqual(managed.length, 1, `Cursor ${event} must retain exactly one managed generation`)
  assert.deepStrictEqual(hookCommandArgv(managed[0].command), [
    path.join(cursorTarget.runtimeBaseRoot, 'host-hook-launcher.cjs'),
    'cursor',
    '--cursor-plugin-path',
    cursorTarget.files.plugin
  ])
}
assert.ok(cursorHooks.hooks.preToolUse.some(entry => entry.command === 'echo cursor-user'))
assert.ok(cursorHooks.hooks.preToolUse.some(entry => entry.command === userCursorCompatibleCommand))
assert.ok(cursorHooks.hooks.preToolUse.some(entry => entry.command === userSharedAdapterCommand))
assert.ok(cursorHooks.hooks.preToolUse.some(entry => entry.command === userCursorNativeSharedCommand))
const cursorPluginManifest = JSON.parse(fs.readFileSync(
  path.join(cursorTarget.files.plugin, '.cursor-plugin', 'plugin.json'),
  'utf8'
))
assert.strictEqual(cursorPluginManifest.name, 'devcodex-workspace')
assert.strictEqual(cursorPluginManifest.version, require('../package.json').version)
assert.strictEqual(cursorPluginManifest.skills, './skills')
assert.strictEqual(cursorPluginManifest.mcpServers, './mcp.json')
assert.strictEqual(fs.existsSync(path.join(cursorTarget.files.plugin, 'hooks')), false)
assert.strictEqual(fs.existsSync(path.join(cursorTarget.files.plugin, 'skills', 'devcodex-workspace', 'SKILL.md')), true)
const cursorMcp = JSON.parse(fs.readFileSync(path.join(cursorTarget.files.plugin, 'mcp.json'), 'utf8'))
for (const name of ['devcodex-memory', 'devcodex-profile']) {
  assert.strictEqual(cursorMcp.mcpServers[name].type, 'stdio')
  assert.strictEqual(path.resolve(cursorMcp.mcpServers[name].command), trustedNodeExecutable)
  assert.strictEqual(cursorMcp.mcpServers[name].env.DEVCODEX_AGENT, 'cursor')
  assert.ok(cursorMcp.mcpServers[name].args.some(value => /mcp[\\/](?:memory|profile)-server\.js$/i.test(value)))
  assert.strictEqual(cursorMcp.mcpServers[name].args[1], '${workspaceFolder}')
}
const promptEventByHost = {
  copilot: 'userPromptTransformed',
  claude: 'UserPromptSubmit',
  codex: 'UserPromptSubmit',
  gemini: 'BeforeAgent',
  grok: 'user_prompt_submit',
  cursor: 'beforeSubmitPrompt'
}
for (const target of targets) {
  const adapter = path.join(
    target.runtimeRoot,
    'hooks',
    '_runtime',
    ['claude', 'cursor'].includes(target.host)
      ? 'lifecycle-cursor-compatible.cjs'
      : 'lifecycle-host-adapters.cjs'
  )
  const cursorWorkspaceRoot = process.platform === 'win32'
    ? `/${workspace.replace(/\\/g, '/')}`
    : workspace
  const replayPayload = {
    hookEventName: promptEventByHost[target.host],
    prompt: 'test',
    transformedPrompt: 'test transformed',
    session_id: `global-host-workspace-skill-${target.host}`
  }
  if (target.host === 'cursor') {
    delete replayPayload.hookEventName
    replayPayload.hook_event_name = promptEventByHost[target.host]
    replayPayload.cursor_version = 'fixture-3.15.6'
    replayPayload.conversation_id = 'global-host-workspace-skill-cursor'
    replayPayload.generation_id = 'global-host-generation-cursor'
    replayPayload.workspace_roots = [cursorWorkspaceRoot]
  }
  const result = spawnSync(process.execPath, [adapter, target.host], {
    cwd: workspace,
    encoding: 'utf8',
    env,
    input: `${target.host === 'cursor' ? '\uFEFF' : ''}${JSON.stringify(replayPayload)}`
  })
  assert.strictEqual(result.status, 0, `${target.host} UserPromptSubmit replay failed: ${result.stderr || result.stdout}`)
  const output = JSON.parse(result.stdout || '{}')
  assert.strictEqual(typeof output, 'object', `${target.host} replay must return JSON object`)
  if (target.host === 'copilot') {
    assert.match(
      output.modifiedTransformedPrompt || '',
      /SkillRouteBootstrapV1/,
      'copilot replay must expose unified skill route bootstrap through transformed prompt'
    )
    assert.doesNotMatch(output.modifiedTransformedPrompt || '', /小朋友真可爱/)
  } else if (['claude', 'codex', 'gemini'].includes(target.host)) {
    const context = `${output.systemMessage || ''}\n${output.hookSpecificOutput?.additionalContext || ''}`
    assert.match(context, /SkillRouteBootstrapV1/, `${target.host} replay must expose unified skill route context`)
    assert.doesNotMatch(context, /小朋友真可爱/, `${target.host} replay must not preload a skill body`)
  } else if (target.host === 'cursor') {
    assert.deepStrictEqual(output, { continue: true }, 'Cursor prompt hook must use the official allow shape')
  }
}
assert.strictEqual(fs.existsSync(path.join(home, '.agents', 'devcodex', 'instructions.full.md')), true)
assert.strictEqual(
  fs.existsSync(path.join(home, '.agents', 'devcodex', 'skills', 'routing', 'SKILL.md')),
  true,
  'hidden apply must materialize skills under G_RUNTIME'
)
assert.strictEqual(fs.existsSync(path.join(home, '.agents', 'skills', 'routing', 'SKILL.md')), false)
assert.strictEqual(fs.existsSync(path.join(home, '.agents', 'skills', 'brand-visual-quality')), false)
assert.strictEqual(fs.existsSync(path.join(home, '.claude', 'skills', 'brand-visual-quality')), false)
assert.strictEqual(
  fs.existsSync(path.join(home, '.copilot', 'skills', 'routing', 'SKILL.md')),
  false,
  'hidden mode must not fill Copilot scan skills tree'
)
assert.strictEqual(fs.existsSync(path.join(home, '.claude', 'skills', 'routing', 'SKILL.md')), false)

const copilotHooks = JSON.parse(fs.readFileSync(path.join(home, '.copilot', 'hooks', 'devcodex.json'), 'utf8'))
assert.strictEqual(copilotHooks.version, 1)
assert.ok(copilotHooks.hooks.notification)
for (const event of ['userPromptSubmitted', 'userPromptTransformed', 'preToolUse', 'postToolUse', 'agentStop', 'preCompact']) {
  assert.ok(Array.isArray(copilotHooks.hooks[event]), `Copilot hook event missing: ${event}`)
  assert.deepStrictEqual(hookCommandArgv(copilotHooks.hooks[event][0].command), [
    path.join(targets.find(target => target.host === 'copilot').runtimeBaseRoot, 'host-hook-launcher.cjs'),
    'copilot',
    '--event',
    event
  ])
}
assert.strictEqual(copilotHooks.hooks.preToolUse[0].matcher, '.*')
assert.strictEqual(copilotHooks.hooks.postToolUse[0].matcher, '.*')

const copilotMcp = JSON.parse(fs.readFileSync(path.join(home, '.copilot', 'mcp-config.json'), 'utf8'))
assert.strictEqual(copilotMcp.theme, 'user-owned')
assert.ok(copilotMcp.mcpServers.custom)
// VS Code User mcp.json co-refreshed with the same apply (global surface)
const vscodeMcpPath = resolveVscodeUserMcpPaths(home, env)[0]
assert.strictEqual(fs.existsSync(vscodeMcpPath), true, 'apply must write VS Code User mcp.json')
const vscodeMcp = JSON.parse(fs.readFileSync(vscodeMcpPath, 'utf8'))
assert.ok(vscodeMcp.servers, 'VS Code mcp.json must have servers')
for (const name of ['devcodex-memory', 'devcodex-profile']) {
  assert.ok(vscodeMcp.servers[name], `VS Code servers missing ${name}`)
  assert.strictEqual(path.resolve(vscodeMcp.servers[name].command), trustedNodeExecutable)
  assert.ok(
    String(vscodeMcp.servers[name].args[0]).includes('memory-server.js') ||
    String(vscodeMcp.servers[name].args[0]).includes('profile-server.js') ||
    name === 'devcodex-memory' || name === 'devcodex-profile'
  )
}
assert.ok(String(vscodeMcp.servers['devcodex-memory'].args[0]).replace(/\\/g, '/').includes('/mcp/memory-server.js'))
assert.ok(String(vscodeMcp.servers['devcodex-profile'].args[0]).replace(/\\/g, '/').includes('/mcp/profile-server.js'))
// preserve non-DevCodex keys on re-apply
fs.writeFileSync(vscodeMcpPath, JSON.stringify({
  inputs: [{ id: 'KEEP_ME', type: 'promptString' }],
  servers: {
    custom: { command: 'echo', args: ['hi'] },
    'devcodex-memory': { command: 'node', args: ['old'] }
  }
}, null, 2))
assert.strictEqual(applyGlobalHostConfig({ packageRoot, env, home }).transaction.status, 'committed')
const vscodeMerged = JSON.parse(fs.readFileSync(vscodeMcpPath, 'utf8'))
assert.strictEqual(vscodeMerged.inputs[0].id, 'KEEP_ME')
assert.strictEqual(vscodeMerged.servers.custom.command, 'echo')
assert.ok(String(vscodeMerged.servers['devcodex-memory'].args[0]).includes('memory-server.js'))
for (const name of ['devcodex-memory', 'devcodex-profile']) {
  assert.strictEqual(copilotMcp.mcpServers[name].type, 'local')
  assert.deepStrictEqual(copilotMcp.mcpServers[name].tools, ['*'])
  assert.ok(copilotMcp.mcpServers[name].args.some(value => /mcp\/(?:memory|profile)-server\.js$/i.test(value)))
  assert.strictEqual(copilotMcp.mcpServers[name].env?.DEVCODEX_AGENT, 'copilot')
}

const geminiTarget = targets.find(target => target.host === 'gemini')
const geminiSettings = JSON.parse(fs.readFileSync(geminiTarget.files.settings, 'utf8'))
for (const name of ['devcodex-memory', 'devcodex-profile']) {
  assert.strictEqual(path.resolve(geminiSettings.mcpServers[name].command), trustedNodeExecutable)
  // gemini has no VALID_AGENTS mapping; do not inject DEVCODEX_AGENT
  assert.deepStrictEqual(
    Object.keys(geminiSettings.mcpServers[name]).sort(),
    ['args', 'command', 'type']
  )
  assert.ok(geminiSettings.mcpServers[name].args.some(value =>
    /mcp\/(?:memory|profile)-server\.js$/i.test(value.replace(/\\/g, '/'))
  ))
}

const claudeSettings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
assert.strictEqual(claudeSettings.theme, 'user-owned')
assert.strictEqual(claudeSettings.nested.keep, true)
assert.ok(claudeSettings.hooks.CustomEvent)
assert.ok(claudeSettings.hooks.PreToolUse)
assert.ok(JSON.stringify(claudeSettings.hooks.PreToolUse).includes('custom-pre'))
assert.ok(!JSON.stringify(claudeSettings.hooks).includes('.claude/hooks/_runtime/lifecycle.cjs'))
assert.ok(!JSON.stringify(claudeSettings.hooks).includes('runtime-1.17.2-legacy-generation'))
for (const event of ['PreToolUse', 'UserPromptSubmit', 'PostToolUse', 'Stop']) {
  const managed = claudeSettings.hooks[event].filter(isDevCodexManagedHookEntry)
  assert.strictEqual(managed.length, 1, `Claude ${event} must retain exactly one managed generation`)
  assert.deepStrictEqual(hookCommandArgv(managed[0].hooks[0].command), [
    path.join(targets.find(target => target.host === 'claude').runtimeBaseRoot, 'host-hook-launcher.cjs'),
    'claude'
  ])
}

const codexConfig = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
assert.ok(codexConfig.includes('model = "user-choice"'))
assert.ok(codexConfig.includes('BEGIN DEVCODEX MANAGED: global-codex-mcp'))
assert.ok(codexConfig.includes('DEVCODEX_AGENT') && codexConfig.includes('codex'))
assert.ok(codexConfig.includes('[mcp_servers.user-keep]'))
assert.ok(!codexConfig.includes('old-runtime.js'))
assert.ok(!codexConfig.includes('BEGIN DEVCODEX-MCP-MANAGED'))
assert.strictEqual((codexConfig.match(/\[mcp_servers\.devcodex-memory\]/g) || []).length, 1)
for (const tool of ['profile_context_plan', 'profile_load', 'skill_route']) {
  assert.ok(codexConfig.includes(`[mcp_servers.devcodex-profile.tools.${tool}]`))
}

// PF-211: unknown Codex host-owned tool approval subtables inside the managed MCP
// block must survive re-merge, while generated authority tables remain managed.
const codexWithHostTools = codexConfig.replace(
  '[mcp_servers.devcodex-profile]',
  [
    '[mcp_servers.devcodex-profile.tools.user_keep_policy]',
    'approval_mode = "ask"',
    '',
    '[mcp_servers.devcodex-profile]'
  ].join('\n')
)
fs.writeFileSync(path.join(home, '.codex', 'config.toml'), codexWithHostTools)
const afterHostToolPolicy = inspectGlobalHostConfiguration({ packageRoot, env, home })
const codexAfterHostTools = afterHostToolPolicy.hosts.find(host => host.host === 'codex')
assert.strictEqual(afterHostToolPolicy.ready, true, 'Codex host tool approval subtables must not fail configuration ready')
assert.strictEqual(codexAfterHostTools.driftedConfigFiles.length, 0)
assert.strictEqual(codexAfterHostTools.stale, false)
const reapplyHostTools = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(reapplyHostTools.transaction.status, 'committed')
const codexAfterReapply = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
assert.ok(
  codexAfterReapply.includes('[mcp_servers.devcodex-profile.tools.user_keep_policy]'),
  're-apply must preserve Codex host-owned tool approval subtables'
)
assert.ok(codexAfterReapply.includes('approval_mode = "ask"'))
const authorityToolTamper = codexAfterReapply.replace(
  /\[mcp_servers\.devcodex-profile\.tools\.skill_route\]\napproval_mode = "approve"/,
  '[mcp_servers.devcodex-profile.tools.skill_route]\napproval_mode = "ask"'
)
fs.writeFileSync(path.join(home, '.codex', 'config.toml'), authorityToolTamper)
const afterAuthorityToolTamper = inspectGlobalHostConfiguration({ packageRoot, env, home })
const codexAuthorityToolTamper = afterAuthorityToolTamper.hosts.find(host => host.host === 'codex')
assert.strictEqual(afterAuthorityToolTamper.ready, false)
assert.ok(codexAuthorityToolTamper.driftedConfigFiles.some(file => /config\.toml$/.test(file)))
fs.writeFileSync(path.join(home, '.codex', 'config.toml'), codexAfterReapply)
const authorityTamper = codexAfterReapply.replace(
  `[mcp_servers.devcodex-memory]\ncommand = ${quoteToml(trustedNodeExecutable)}`,
  '[mcp_servers.devcodex-memory]\ncommand = "node-tampered"'
)
fs.writeFileSync(path.join(home, '.codex', 'config.toml'), authorityTamper)
const afterAuthorityTamper = inspectGlobalHostConfiguration({ packageRoot, env, home })
const codexAuthorityTamper = afterAuthorityTamper.hosts.find(host => host.host === 'codex')
assert.strictEqual(afterAuthorityTamper.ready, false)
assert.ok(codexAuthorityTamper.driftedConfigFiles.some(file => /config\.toml$/.test(file)))
// Restore host-tool policy state for later cases
fs.writeFileSync(path.join(home, '.codex', 'config.toml'), codexAfterReapply)
assert.strictEqual(inspectGlobalHostConfiguration({ packageRoot, env, home }).ready, true)

const configurationOnly = inspectGlobalHostConfiguration({ packageRoot, env, home })
assert.strictEqual(configurationOnly.ready, true)
const userEditedClaudeSettings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
userEditedClaudeSettings.theme = 'new-user-owned-theme'
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(userEditedClaudeSettings, null, 4) + '\n')
const afterUnmanagedEdit = inspectGlobalHostConfiguration({ packageRoot, env, home })
assert.strictEqual(afterUnmanagedEdit.ready, true, 'unmanaged user config edits must not stale global receipts')
assert.ok(afterUnmanagedEdit.hosts.every(host => host.receiptMatchesCurrent))
assert.ok(afterUnmanagedEdit.hosts.every(host => host.driftedConfigFiles.length === 0))
const unmanagedReapply = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(unmanagedReapply.transaction.status, 'committed')
assert.strictEqual(unmanagedReapply.transaction.changed, 0, 'unmanaged user config edits must remain idempotent')
assert.strictEqual(
  JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')).theme,
  'new-user-owned-theme'
)
const managedDriftSettings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
managedDriftSettings.hooks.Stop[0].hooks[0].command = 'node user-replaced-managed-hook.js'
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(managedDriftSettings, null, 2) + '\n')
const afterManagedEdit = inspectGlobalHostConfiguration({ packageRoot, env, home })
const managedDriftClaude = afterManagedEdit.hosts.find(host => host.host === 'claude')
assert.strictEqual(afterManagedEdit.ready, false)
assert.strictEqual(managedDriftClaude.configured, true)
assert.ok(
  managedDriftClaude.driftedConfigFiles.includes(path.join(home, '.claude', 'settings.json').replace(/\\/g, '/'))
)
const managedDriftRuntime = inspectGlobalHostConfig({ packageRoot, env, home })
const managedDriftRuntimeClaude = managedDriftRuntime.hosts.find(host => host.host === 'claude')
assert.strictEqual(managedDriftRuntimeClaude.contractStatus, 'failed')
assert(managedDriftRuntimeClaude.issues.some(issue =>
  issue.code === 'GLOBAL_HOST_MANAGED_CONFIG_DRIFT'
))
assert.strictEqual(applyGlobalHostConfig({ packageRoot, env, home }).transaction.status, 'committed')
const beforeGrokRegistration = inspectGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(beforeGrokRegistration.ready, false)
const beforeGrokRegistrationHost = beforeGrokRegistration.hosts.find(host => host.host === 'grok')
assert.strictEqual(beforeGrokRegistrationHost.adapterReady, true)
assert.strictEqual(beforeGrokRegistrationHost.contractStatus, 'passed')
assert.strictEqual(beforeGrokRegistrationHost.nativeStatus, 'unverified')
assert(beforeGrokRegistrationHost.issues.some(issue =>
  issue.code === 'GROK_PLUGIN_REGISTRY_UNVERIFIED'
))
const grokTarget = targets.find(target => target.host === 'grok')
const registryFile = path.join(grokTarget.root, 'installed-plugins', 'registry.json')
fs.mkdirSync(path.dirname(registryFile), { recursive: true })
fs.writeFileSync(registryFile, `${JSON.stringify({
  version: 1,
  repos: {
    canonical: {
      kind: { type: 'Local', source_path: grokTarget.files.plugin },
      path: grokTarget.files.plugin,
      plugins: { 'devcodex-workspace': { version: '1.0.0' } }
    }
  }
}, null, 2)}\n`)

const inspection = inspectGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(inspection.ready, false)
assert.strictEqual(inspection.overallState, 'degraded')
assert.strictEqual(inspection.schemaVersion, 'GlobalHostRuntimeVerificationV2')
assert.deepStrictEqual(inspection.hosts.map(host => host.host), GLOBAL_HOST_IDS)
assert.ok(inspection.hosts.every(host => host.adapterReady))
assert.ok(inspection.hosts.every(host => host.ready === false))
assert.ok(inspection.hosts.every(host => host.nativeStatus === 'unverified'))
const adapterReadyDoctor = runDoctorHuman()
assert.match(adapterReadyDoctor, /global adapters:\s+6\/6 ready/)
assert.match(adapterReadyDoctor, /native hosts:\s+0\/6 ready/)
assert.match(adapterReadyDoctor, /All user-global adapters are installed and their contracts pass/)
assert.match(adapterReadyDoctor, /Native host CLIs not operationally ready: copilot, claude, codex, gemini, grok, cursor/)
assert.doesNotMatch(adapterReadyDoctor, /Repair missing adapters/)

const claudeRuntime = inspection.hosts.find(host => host.host === 'claude').runtimeEntry
const claudeRuntimeSource = fs.readFileSync(claudeRuntime, 'utf8')
fs.writeFileSync(
  claudeRuntime,
  claudeRuntimeSource.replace("new Set(['claude', 'cursor'])", "new Set(['cursor'])"),
  'utf8'
)
const adapterDrift = inspectGlobalHostConfig({ packageRoot, env, home })
const driftedClaude = adapterDrift.hosts.find(host => host.host === 'claude')
assert.strictEqual(adapterDrift.ready, false)
assert.strictEqual(driftedClaude.contractStatus, 'failed')
assert(driftedClaude.issues.some(issue => issue.code === 'HOST_ADAPTER_CONTRACT_FAILED'))
assert.strictEqual(applyGlobalHostConfig({ packageRoot, env, home }).transaction.status, 'committed')

for (const target of targets) {
  const receiptFile = path.join(target.root, 'devcodex', 'global-host-receipt.json')
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
  for (const field of [
    'host',
    'packageVersion',
    'sourceDigest',
    'managedPaths',
    'pendingStaleManagedPaths',
    'previousStateRef',
    'result',
    'updatedAt'
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(receipt, field), `${target.host} receipt missing ${field}`)
  }
  assert.strictEqual(receipt.result, 'committed')
  assert.strictEqual(receipt.workspaceCleanMode, 'GlobalOnlyWorkspaceCleanModeV1')
  assert.strictEqual(receipt.workspaceHostDirectoriesWritten, false)
  assert.deepStrictEqual(receipt.sourcePackageEvidence, {
    rootLifetime: 'install-process-only',
    durableIdentity: true,
    authority: 'RuntimeGenerationManifestV1'
  })
  assert.strictEqual(receipt.runtimeGeneration.schemaVersion, 'RuntimeGenerationManifestV1')
  assert.strictEqual(receipt.runtimeGeneration.generationId, target.runtimeGeneration.generationId)
  assert.match(receipt.runtimeGeneration.runtimeContractDigest, /^[a-f0-9]{64}$/)
  assert.match(receipt.runtimeGeneration.filesDigest, /^[a-f0-9]{64}$/)
  assert.match(receipt.runtimeGeneration.createdAt, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/)
  assert.strictEqual(
    receipt.runtimeGeneration.creationTimeAuthority,
    target.runtimeGeneration.creationTimeAuthority
  )
  assert.ok(
    ['candidate-changelog', 'release-changelog'].includes(
      receipt.runtimeGeneration.creationTimeAuthority
    )
  )
  assert.strictEqual(receipt.runtimeGeneration.runtimeRoot, '.')
  assert.strictEqual(path.resolve(receipt.runtimeRoot), path.resolve(target.runtimeRoot))
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(target.runtimeRoot, 'runtime-generation.json'), 'utf8')),
    receipt.runtimeGeneration
  )
  assert.strictEqual(Object.prototype.hasOwnProperty.call(receipt, 'packageRoot'), false)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(receipt.sourcePackageEvidence, 'observedRoot'), false)
  assert.ok(Array.isArray(receipt.managedPaths))
  assert.deepStrictEqual(receipt.pendingStaleManagedPaths, [])
}

const codexTarget = targets.find(target => target.host === 'codex')
const codexRuntime = codexTarget.runtimeRoot
require(path.join(codexRuntime, 'scripts', 'lib', 'host-parity-scorecard.js'))
require(path.join(codexRuntime, 'mcp', 'memory-server.js'))
const sourceSkillRouteMode = require(path.join(packageRoot, 'hooks', '_runtime', 'skill-route-mode.cjs'))
const installedSkillRouteMode = require(path.join(codexRuntime, 'hooks', '_runtime', 'skill-route-mode.cjs'))
const installedProgressiveEnforcement = require(path.join(
  codexRuntime,
  'hooks',
  '_runtime',
  'progressive-skill-route-enforcement.cjs'
))
assert.strictEqual(
  installedProgressiveEnforcement.resolveProgressiveSkillRouteEnforcement({
    hostVariant: 'codex-cli/exec-user-global-local-stdio',
    eventName: 'PreToolUse'
  }).hardEnforcement,
  false,
  'a host refresh must not resurrect Codex progressive PreToolUse hard enforcement'
)
assert.strictEqual(
  installedProgressiveEnforcement.resolveProgressiveSkillRouteEnforcement({
    hostVariant: 'codex-desktop/app-user-global-local-stdio',
    eventName: 'Stop'
  }).hardEnforcement,
  false,
  'a host refresh must not resurrect Codex progressive Stop hard enforcement'
)
const sourceRuntimeContractDigest = sourceSkillRouteMode.getRuntimeContractDigest({
  globalRuntime: {
    status: 'resolved',
    root: path.join(packageRoot, 'content', 'skills'),
    companionRoot: path.join(packageRoot, 'content', 'skills')
  }
})
const installedRuntimeContractDigest = installedSkillRouteMode.getRuntimeContractDigest({
  globalRuntime: {
    status: 'resolved',
    root: codexTarget.shared.skillsRuntime
  }
})
assert.strictEqual(installedRuntimeContractDigest, sourceRuntimeContractDigest)
const installedGeneration = JSON.parse(fs.readFileSync(
  path.join(codexRuntime, 'runtime-generation.json'),
  'utf8'
))
assert.strictEqual(installedGeneration.runtimeContractDigest, installedRuntimeContractDigest)
const installedProcessIdentity = require(path.join(
  codexRuntime,
  'hooks',
  '_runtime',
  'runtime-generation-identity.cjs'
)).captureRuntimeProcessIdentity({
  role: 'test-installed-runtime',
  runtimeRoot: codexRuntime,
  bootRuntimeContractDigest: installedRuntimeContractDigest,
  noCache: true
})
assert.strictEqual(installedProcessIdentity.generationId, installedGeneration.generationId)
assert.strictEqual(installedProcessIdentity.runtimeContractAligned, true)
const installedSkillRouteCapabilities = JSON.parse(fs.readFileSync(
  path.join(codexRuntime, 'hooks', '_runtime', 'host-skill-route-capabilities.v1.json'),
  'utf8'
))
const installedCodexCapability = installedSkillRouteCapabilities.capabilities.find(item =>
  item.hostVariant === 'codex-cli/exec-user-global-local-stdio'
)
assert.ok(installedCodexCapability)
const installedCapabilityValidation = installedSkillRouteMode.validateCapabilityDocument(
  installedSkillRouteCapabilities,
  { packageRoot: codexRuntime }
)
assert.strictEqual(
  installedCapabilityValidation.valid,
  true,
  installedCapabilityValidation.errors.join(', ')
)
assert.strictEqual(installedCodexCapability.status, 'PASS')
assert.strictEqual(installedCodexCapability.runtimeContractDigest, installedRuntimeContractDigest)
const installedHostAdapterIdentity = require(path.join(
  codexRuntime,
  'hooks',
  '_runtime',
  'host-adapter-identity.cjs'
))
assert.strictEqual(
  installedCodexCapability.hostAdapterDigest,
  installedHostAdapterIdentity.getLifecycleHostAdapterDigest('codex', {
    entrySurface: 'codex-cli-exec',
    env: {},
    runtimeRoot: path.join(codexRuntime, 'hooks', '_runtime')
  })
)
assert.strictEqual(
  installedCapabilityValidation.evidenceByVariant[installedCodexCapability.hostVariant]?.valid,
  true
)
assert.strictEqual(
  installedCodexCapability.evidenceRef,
  'hooks/_runtime/evidence/codex-skill-route-pass.v1.json'
)
assert.strictEqual(installedCodexCapability.defaultEligible, true)
const installedDesktopCapability = installedSkillRouteCapabilities.capabilities.find(item =>
  item.hostVariant === 'codex-desktop/app-user-global-local-stdio'
)
assert.ok(installedDesktopCapability)
assert.strictEqual(installedDesktopCapability.status, 'UNVERIFIED')
assert.strictEqual(installedDesktopCapability.evidenceRef, null)
assert.strictEqual(installedDesktopCapability.defaultEligible, false)

const retainedReceiptFile = path.join(codexTarget.root, 'devcodex', 'global-host-receipt.json')
const retainedReceiptOriginal = fs.readFileSync(retainedReceiptFile, 'utf8')
const retainedReceipt = JSON.parse(retainedReceiptOriginal)
const retainedRuntimeRoot = path.join(codexTarget.runtimeBaseRoot, 'runtime-retained-doctor-fixture')
const retainedArtifactPath = path.join(retainedRuntimeRoot, 'retained.txt')
fs.mkdirSync(retainedRuntimeRoot, { recursive: true })
fs.writeFileSync(retainedArtifactPath, 'retained generation fixture\n', 'utf8')
const retainedDigest = require('crypto').createHash('sha256')
  .update(fs.readFileSync(retainedArtifactPath))
  .digest('hex')
retainedReceipt.retainedRuntimeRoots = [retainedRuntimeRoot.replace(/\\/g, '/')]
retainedReceipt.retainedManagedArtifacts = [{
  path: retainedArtifactPath.replace(/\\/g, '/'),
  ownershipKind: 'whole-file',
  managedDigest: retainedDigest,
  contentDigest: retainedDigest
}]
fs.writeFileSync(retainedReceiptFile, `${JSON.stringify(retainedReceipt, null, 2)}\n`, 'utf8')
const retainedInspection = inspectGlobalHostConfiguration({ packageRoot, env, home })
const retainedCodexInspection = retainedInspection.hosts.find(item => item.host === 'codex')
assert.strictEqual(
  retainedInspection.ready,
  true,
  `Doctor must use retained-generation facts from the current receipt: ${JSON.stringify(retainedCodexInspection)}`
)
assert.strictEqual(retainedCodexInspection.receiptMatchesCurrent, true)
fs.writeFileSync(retainedReceiptFile, retainedReceiptOriginal, 'utf8')
fs.rmSync(retainedRuntimeRoot, { recursive: true, force: true })

const forgedReceiptFile = path.join(codexTarget.root, 'devcodex', 'global-host-receipt.json')
const forgedReceipt = JSON.parse(fs.readFileSync(forgedReceiptFile, 'utf8'))
fs.writeFileSync(forgedReceiptFile, `${JSON.stringify({
  ...forgedReceipt,
  sourceDigest: 'forged-source-digest'
}, null, 2)}\n`)
const forgedInspection = inspectGlobalHostConfig({ packageRoot, env, home })
const forgedCodex = forgedInspection.hosts.find(host => host.host === 'codex')
assert.strictEqual(forgedInspection.ready, false)
assert.strictEqual(forgedCodex.ready, false)
assert.strictEqual(forgedCodex.stale, true)
assert.strictEqual(applyGlobalHostConfig({ packageRoot, env, home }).transaction.status, 'committed')

const obsoleteManagedFile = path.join(codexTarget.runtimeRoot, 'obsolete-managed-file.txt')
fs.writeFileSync(obsoleteManagedFile, 'old managed content\n')
const receiptWithObsolete = JSON.parse(fs.readFileSync(forgedReceiptFile, 'utf8'))
receiptWithObsolete.managedPaths.push(obsoleteManagedFile.replace(/\\/g, '/'))
receiptWithObsolete.configFiles.push(obsoleteManagedFile.replace(/\\/g, '/'))
fs.writeFileSync(forgedReceiptFile, `${JSON.stringify(receiptWithObsolete, null, 2)}\n`)
const staleCleanupResult = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(staleCleanupResult.transaction.status, 'committed')
assert.strictEqual(fs.existsSync(obsoleteManagedFile), false)

const retryManagedFile = path.join(codexTarget.runtimeRoot, 'retry-managed-file.txt')
fs.writeFileSync(retryManagedFile, 'retry me\n')
const receiptWithRetry = JSON.parse(fs.readFileSync(forgedReceiptFile, 'utf8'))
receiptWithRetry.managedPaths.push(retryManagedFile.replace(/\\/g, '/'))
receiptWithRetry.configFiles.push(retryManagedFile.replace(/\\/g, '/'))
fs.writeFileSync(forgedReceiptFile, `${JSON.stringify(receiptWithRetry, null, 2)}\n`)
let injectedRetryFailure = true
const cleanupRetryFs = Object.create(fs)
cleanupRetryFs.unlinkSync = file => {
  if (injectedRetryFailure && path.resolve(file) === path.resolve(retryManagedFile)) {
    injectedRetryFailure = false
    const error = new Error('injected stale cleanup failure')
    error.code = 'EACCES'
    throw error
  }
  return fs.unlinkSync(file)
}
const retryCleanupFailure = applyGlobalHostConfig({ packageRoot, env, home, fs: cleanupRetryFs })
assert.strictEqual(retryCleanupFailure.transaction.status, 'committed')
assert.strictEqual(retryCleanupFailure.transaction.staleCleanupIncomplete, true)
assert.strictEqual(fs.existsSync(retryManagedFile), true)
const retryFailureReceipt = JSON.parse(fs.readFileSync(forgedReceiptFile, 'utf8'))
assert.deepStrictEqual(
  retryFailureReceipt.pendingStaleManagedPaths,
  [retryManagedFile.replace(/\\/g, '/')]
)
const pendingCleanupInspection = inspectGlobalHostConfiguration({ packageRoot, env, home })
const pendingCleanupCodex = pendingCleanupInspection.hosts.find(host => host.host === 'codex')
assert.strictEqual(pendingCleanupInspection.ready, false)
assert.strictEqual(pendingCleanupCodex.ready, false)
assert(pendingCleanupCodex.configurationIssues.some(issue =>
  issue.code === 'GLOBAL_HOST_STALE_CLEANUP_PENDING'
))
const retryCleanupSuccess = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(retryCleanupSuccess.transaction.status, 'committed')
assert.strictEqual(fs.existsSync(retryManagedFile), false)
const retrySuccessReceipt = JSON.parse(fs.readFileSync(forgedReceiptFile, 'utf8'))
assert.deepStrictEqual(retrySuccessReceipt.pendingStaleManagedPaths, [])
assert.strictEqual(inspectGlobalHostConfiguration({ packageRoot, env, home }).ready, true)

const finalizationManagedFile = path.join(codexTarget.runtimeRoot, 'receipt-finalization-managed-file.txt')
fs.writeFileSync(finalizationManagedFile, 'remove before receipt finalization\n')
const receiptBeforeFinalizationFailure = JSON.parse(fs.readFileSync(forgedReceiptFile, 'utf8'))
receiptBeforeFinalizationFailure.managedPaths.push(finalizationManagedFile.replace(/\\/g, '/'))
receiptBeforeFinalizationFailure.configFiles.push(finalizationManagedFile.replace(/\\/g, '/'))
fs.writeFileSync(forgedReceiptFile, `${JSON.stringify(receiptBeforeFinalizationFailure, null, 2)}\n`)
let codexReceiptStageWrites = 0
const finalizationFailureFs = Object.create(fs)
finalizationFailureFs.writeFileSync = (file, ...args) => {
  if (String(file).startsWith(`${forgedReceiptFile}.devcodex-stage.`)) {
    codexReceiptStageWrites += 1
    if (codexReceiptStageWrites === 2) {
      const error = new Error('injected receipt finalization failure')
      error.code = 'EPERM'
      throw error
    }
  }
  return fs.writeFileSync(file, ...args)
}
const finalizationFailure = applyGlobalHostConfig({
  packageRoot,
  env,
  home,
  fs: finalizationFailureFs
})
assert.strictEqual(finalizationFailure.transaction.status, 'committed')
assert.strictEqual(finalizationFailure.transaction.receiptFinalizationIncomplete, true)
assert.strictEqual(finalizationFailure.transaction.receiptFinalizationFailures.length, 1)
assert.strictEqual(
  finalizationFailure.transaction.hosts.find(item => item.host === 'codex').receiptFinalizationIncomplete,
  true
)
assert.strictEqual(fs.existsSync(finalizationManagedFile), false)
const receiptAfterFinalizationFailure = JSON.parse(fs.readFileSync(forgedReceiptFile, 'utf8'))
assert.deepStrictEqual(
  receiptAfterFinalizationFailure.pendingStaleManagedPaths,
  [finalizationManagedFile.replace(/\\/g, '/')]
)
const finalizationPendingInspection = inspectGlobalHostConfiguration({ packageRoot, env, home })
assert.strictEqual(finalizationPendingInspection.ready, false)
assert(finalizationPendingInspection.hosts.find(host => host.host === 'codex').configurationIssues
  .some(issue => issue.code === 'GLOBAL_HOST_STALE_CLEANUP_PENDING'))
const finalizationRetry = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(finalizationRetry.transaction.status, 'committed')
assert.strictEqual(finalizationRetry.transaction.receiptFinalizationIncomplete, false)
assert.deepStrictEqual(
  JSON.parse(fs.readFileSync(forgedReceiptFile, 'utf8')).pendingStaleManagedPaths,
  []
)
assert.strictEqual(inspectGlobalHostConfiguration({ packageRoot, env, home }).ready, true)

const sharedFallback = path.join(home, '.agents', 'devcodex', 'instructions.full.md')
const grokReceiptFile = path.join(grokTarget.root, 'devcodex', 'global-host-receipt.json')
const grokReceiptWithLegacySharedOwner = JSON.parse(fs.readFileSync(grokReceiptFile, 'utf8'))
grokReceiptWithLegacySharedOwner.managedPaths.push(sharedFallback.replace(/\\/g, '/'))
grokReceiptWithLegacySharedOwner.configFiles.push(sharedFallback.replace(/\\/g, '/'))
fs.writeFileSync(grokReceiptFile, `${JSON.stringify(grokReceiptWithLegacySharedOwner, null, 2)}\n`)
const ownershipMigration = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(ownershipMigration.transaction.status, 'committed')
assert.strictEqual(
  fs.existsSync(sharedFallback),
  true,
  'a former host owner must not delete a shared path still owned by the current global plan'
)

const second = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(second.transaction.changed, 0, 'second apply must be idempotent')

const copilotInstructions = path.join(home, '.copilot', 'copilot-instructions.md')
fs.unlinkSync(copilotInstructions)
const driftedInspection = inspectGlobalHostConfig({ packageRoot, env, home })
const driftedCopilot = driftedInspection.hosts.find(host => host.host === 'copilot')
assert.strictEqual(driftedInspection.ready, false)
assert.strictEqual(driftedCopilot.ready, false)
assert.ok(driftedCopilot.missingConfigFiles.includes(copilotInstructions.replace(/\\/g, '/')))
const missingCopilotRuntime = inspectGlobalHostConfig({ packageRoot, env, home })
const missingCopilotRuntimeHost = missingCopilotRuntime.hosts.find(host => host.host === 'copilot')
assert.strictEqual(missingCopilotRuntimeHost.contractStatus, 'failed')
assert(missingCopilotRuntimeHost.issues.some(issue =>
  issue.code === 'GLOBAL_HOST_CONFIG_PATH_MISSING'
))
const missingAdapterDoctor = runDoctorHuman()
assert.match(missingAdapterDoctor, /Missing adapters: copilot\. Repair with `npm install -g devcodex`\./)
const repaired = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(repaired.transaction.changed, 1)
assert.strictEqual(applyGlobalHostConfig({ packageRoot, env, home }).transaction.changed, 0)

const preservedJson = mergeJsonContent('{"user":{"keep":true}}', { managed: { enabled: true } }, 'fixture')
assert.deepStrictEqual(JSON.parse(preservedJson), { user: { keep: true }, managed: { enabled: true } })
const upgradedJson = JSON.parse(mergeHostJsonContent(JSON.stringify({
  hooks: {
    Stop: [
      { hooks: [{ type: 'command', command: 'echo user-stop' }] },
      { hooks: [{ type: 'command', command: 'node old/devcodex/lifecycle.cjs' }] }
    ]
  },
  mcpServers: {
    custom: { command: 'custom' },
    'devcodex-memory': { command: 'node', args: ['old-runtime.js'] }
  }
}), {
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'node new/devcodex/lifecycle-host-adapters.cjs' }] }]
  },
  mcpServers: {
    'devcodex-memory': { command: 'node', args: ['new-runtime.js'] }
  }
}, 'upgrade fixture'))
assert.ok(JSON.stringify(upgradedJson.hooks.Stop).includes('user-stop'))
assert.ok(JSON.stringify(upgradedJson.hooks.Stop).includes('new/devcodex'))
assert.ok(!JSON.stringify(upgradedJson.hooks.Stop).includes('old/devcodex'))
assert.deepStrictEqual(upgradedJson.mcpServers.custom, { command: 'custom' })
assert.deepStrictEqual(upgradedJson.mcpServers['devcodex-memory'].args, ['new-runtime.js'])
const customDevCodexCommand = JSON.parse(mergeHostJsonContent(JSON.stringify({
  hooks: {
    Stop: [
      { hooks: [{ type: 'command', command: 'node C:/tools/devcodex-custom/check.js' }] },
      { hooks: [{ type: 'command', command: 'node old/devcodex/lifecycle.cjs' }] }
    ]
  }
}), {
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'node new/devcodex/lifecycle-host-adapters.cjs' }] }]
  }
}, 'custom hook preserve fixture'))
assert.ok(JSON.stringify(customDevCodexCommand.hooks.Stop).includes('devcodex-custom/check.js'))
assert.ok(JSON.stringify(customDevCodexCommand.hooks.Stop).includes('lifecycle-host-adapters.cjs'))
assert.ok(!JSON.stringify(customDevCodexCommand.hooks.Stop).includes('old/devcodex/lifecycle.cjs'))
assert.throws(
  () => mergeManagedBlock('# BEGIN DEVCODEX MANAGED: broken\nx=1\n', 'x=2', { id: 'broken' }),
  /GLOBAL_HOST_MARKER_CONFLICT/
)
assert.throws(
  () => mergeManagedTomlTables(
    '["mcp_servers"."devcodex-memory"]\ncommand = "node"\n',
    '[mcp_servers.devcodex-memory]\ncommand = "node"',
    {
      id: 'global-codex-mcp',
      tableNames: ['mcp_servers.devcodex-memory']
    }
  ),
  /GLOBAL_HOST_TOML_IDENTITY_CONFLICT/
)
const migratedBareToml = mergeManagedTomlTables(
  '[mcp_servers.devcodex-memory]\ncommand = "old"\n\n[mcp_servers.user-keep]\ncommand = "custom"\n',
  '[mcp_servers.devcodex-memory]\ncommand = "new"',
  {
    id: 'global-codex-mcp',
    tableNames: ['mcp_servers.devcodex-memory']
  }
)
assert.ok(!migratedBareToml.includes('command = "old"'))
assert.ok(migratedBareToml.includes('[mcp_servers.user-keep]'))
assert.throws(
  () => mergeManagedTomlTables(
    '# BEGIN DEVCODEX-MCP-MANAGED\n[mcp_servers.devcodex-memory]\ncommand = "old"\n',
    '[mcp_servers.devcodex-memory]\ncommand = "new"',
    {
      id: 'global-codex-mcp',
      tableNames: ['mcp_servers.devcodex-memory'],
      legacyMarkers: [{
        begin: '# BEGIN DEVCODEX-MCP-MANAGED',
        end: '# END DEVCODEX-MCP-MANAGED'
      }]
    }
  ),
  /GLOBAL_HOST_MARKER_CONFLICT/
)

// A real-world old managed block may contain only a subset of the now-managed
// approval tables. Re-merge must add every declared table exactly once, retain
// unknown host policy, and detect the old block as stale.
const codexAuthorityFixture = [
  '# Managed by DevCodex.',
  '[mcp_servers.devcodex-memory]',
  'command = "node"',
  '',
  '[mcp_servers.devcodex-profile]',
  'command = "node"',
  '',
  '[mcp_servers.devcodex-memory.tools.memory_session_write]',
  'approval_mode = "approve"',
  '',
  '[mcp_servers.devcodex-memory.tools.memory_status]',
  'approval_mode = "approve"',
  '',
  '[mcp_servers.devcodex-profile.tools.profile_context_plan]',
  'approval_mode = "approve"',
  '',
  '[mcp_servers.devcodex-profile.tools.profile_load]',
  'approval_mode = "approve"',
  '',
  '[mcp_servers.devcodex-profile.tools.skill_route]',
  'approval_mode = "approve"'
].join('\n')
const codexTruncatedFixture = [
  '# BEGIN DEVCODEX MANAGED: global-codex-mcp',
  '# Managed by DevCodex.',
  '[mcp_servers.devcodex-memory]',
  'command = "node"',
  '',
  '[mcp_servers.devcodex-profile]',
  'command = "node"',
  '',
  '[mcp_servers.devcodex-memory.tools.memory_session_write]',
  'approval_mode = "approve"',
  '',
  '[mcp_servers.devcodex-profile.tools.user_keep_policy]',
  'approval_mode = "ask"',
  '# END DEVCODEX MANAGED: global-codex-mcp',
  ''
].join('\n')
const codexAuthorityTables = [
  'mcp_servers.devcodex-memory',
  'mcp_servers.devcodex-profile',
  'mcp_servers.devcodex-memory.tools.memory_session_write',
  'mcp_servers.devcodex-memory.tools.memory_status',
  'mcp_servers.devcodex-profile.tools.profile_context_plan',
  'mcp_servers.devcodex-profile.tools.profile_load',
  'mcp_servers.devcodex-profile.tools.skill_route'
]
const upgradedCodexFixture = mergeManagedTomlTables(
  codexTruncatedFixture,
  codexAuthorityFixture,
  { id: 'global-codex-mcp', tableNames: codexAuthorityTables }
)
for (const tableName of codexAuthorityTables) {
  assert.strictEqual(
    (upgradedCodexFixture.match(new RegExp(`\\[${tableName.replace(/\./g, '\\.')}\\]`, 'g')) || []).length,
    1,
    `${tableName} must be present exactly once after upgrade`
  )
}
assert.ok(upgradedCodexFixture.includes('[mcp_servers.devcodex-profile.tools.user_keep_policy]'))
assert.strictEqual(tomlManagedFileMatches(
  codexTruncatedFixture,
  upgradedCodexFixture,
  codexAuthorityFixture,
  { id: 'global-codex-mcp' }
), false)
assert.strictEqual(tomlManagedFileMatches(
  upgradedCodexFixture,
  upgradedCodexFixture,
  codexAuthorityFixture,
  { id: 'global-codex-mcp' }
), true)
assert.strictEqual(
  mergeManagedTomlTables(upgradedCodexFixture, codexAuthorityFixture, {
    id: 'global-codex-mcp',
    tableNames: codexAuthorityTables
  }),
  upgradedCodexFixture
)

const rollbackRoot = path.join(tmp, 'rollback')
fs.mkdirSync(rollbackRoot, { recursive: true })
const first = path.join(rollbackRoot, 'first.txt')
const secondFile = path.join(rollbackRoot, 'second.txt')
fs.writeFileSync(first, 'before\n')
assert.throws(() => executeGlobalHostTransaction([
  { path: first, content: 'after\n' },
  { path: secondFile, content: 'created\n' }
], {
  allowedRoots: [rollbackRoot],
  failAfter: 1
}), /GLOBAL_HOST_TEST_INJECTED_FAILURE/)
assert.strictEqual(fs.readFileSync(first, 'utf8'), 'before\n')
assert.strictEqual(fs.existsSync(secondFile), false)

const transientTransactionRoot = path.join(tmp, 'transient-transaction-lock')
fs.mkdirSync(transientTransactionRoot, { recursive: true })
const transientTransactionFile = path.join(transientTransactionRoot, 'target.txt')
let transientTransactionOpenAttempts = 0
let transientTransactionUnlinkAttempts = 0
const transientTransactionFs = Object.create(fs)
transientTransactionFs.openSync = (file, flags, ...rest) => {
  if (flags === 'wx' && path.basename(String(file)) === 'owner.lock') {
    transientTransactionOpenAttempts += 1
    if (transientTransactionOpenAttempts <= 2) throw Object.assign(new Error('injected transaction lock EPERM'), { code: 'EPERM' })
  }
  return fs.openSync(file, flags, ...rest)
}
transientTransactionFs.unlinkSync = file => {
  if (path.basename(String(file)) === 'owner.lock') {
    transientTransactionUnlinkAttempts += 1
    if (transientTransactionUnlinkAttempts === 1) throw Object.assign(new Error('injected transaction unlock EBUSY'), { code: 'EBUSY' })
  }
  return fs.unlinkSync(file)
}
const transientTransactionReceipt = executeGlobalHostTransaction([
  { path: transientTransactionFile, content: 'transient lock recovered\n' }
], {
  allowedRoots: [transientTransactionRoot],
  fs: transientTransactionFs,
  platform: 'win32',
  windowsFsRetryMaxAttempts: 3,
  windowsFsRetryDelayMs: 0
})
assert.strictEqual(transientTransactionReceipt.status, 'committed')
assert.strictEqual(transientTransactionOpenAttempts, 3)
assert.strictEqual(transientTransactionUnlinkAttempts, 2)
assert.strictEqual(fs.readFileSync(transientTransactionFile, 'utf8'), 'transient lock recovered\n')

const nonWindowsTransactionRoot = path.join(tmp, 'non-windows-transaction-lock')
fs.mkdirSync(nonWindowsTransactionRoot, { recursive: true })
let nonWindowsTransactionOpenAttempts = 0
const nonWindowsTransactionFs = Object.create(fs)
nonWindowsTransactionFs.openSync = (file, flags, ...rest) => {
  if (flags === 'wx' && path.basename(String(file)) === 'owner.lock') {
    nonWindowsTransactionOpenAttempts += 1
    throw Object.assign(new Error('injected non-Windows transaction lock EPERM'), { code: 'EPERM' })
  }
  return fs.openSync(file, flags, ...rest)
}
assert.throws(() => executeGlobalHostTransaction([
  { path: path.join(nonWindowsTransactionRoot, 'target.txt'), content: 'must not be written\n' }
], {
  allowedRoots: [nonWindowsTransactionRoot],
  fs: nonWindowsTransactionFs,
  platform: 'linux',
  windowsFsRetryMaxAttempts: 3,
  windowsFsRetryDelayMs: 0
}), error => error?.code === 'EPERM')
assert.strictEqual(nonWindowsTransactionOpenAttempts, 1)

const metadataRoot = path.join(tmp, 'replacement-metadata')
fs.mkdirSync(metadataRoot, { recursive: true })
const metadataFile = path.join(metadataRoot, 'restricted.txt')
fs.writeFileSync(metadataFile, 'before metadata-preserving replacement\n', 'utf8')
fs.chmodSync(metadataFile, 0o444)
const metadataModeBefore = fs.statSync(metadataFile).mode & 0o777
executeGlobalHostTransaction([{ path: metadataFile, content: 'after metadata-preserving replacement\n' }], {
  allowedRoots: [metadataRoot]
})
assert.strictEqual(fs.statSync(metadataFile).mode & 0o777, metadataModeBefore)
assert.strictEqual(fs.readFileSync(metadataFile, 'utf8'), 'after metadata-preserving replacement\n')
fs.chmodSync(metadataFile, 0o666)

const rollbackDriftRoot = path.join(tmp, 'rollback-drift')
fs.mkdirSync(rollbackDriftRoot, { recursive: true })
const rollbackDriftFirst = path.join(rollbackDriftRoot, 'first.txt')
const rollbackDriftSecond = path.join(rollbackDriftRoot, 'second.txt')
fs.writeFileSync(rollbackDriftFirst, 'first-before\n')
fs.writeFileSync(rollbackDriftSecond, 'second-before\n')
let rollbackDriftInjected = false
const rollbackDriftFs = Object.create(fs)
rollbackDriftFs.renameSync = (source, destination) => {
  const result = fs.renameSync(source, destination)
  if (!rollbackDriftInjected && path.resolve(source) === path.resolve(rollbackDriftSecond) &&
      String(destination).startsWith(`${rollbackDriftSecond}.devcodex-backup.`)) {
    rollbackDriftInjected = true
    fs.writeFileSync(rollbackDriftFirst, 'concurrent-user-content\n')
  }
  return result
}
let rollbackDriftError = null
try {
  executeGlobalHostTransaction([
    { path: rollbackDriftFirst, content: 'first-after\n' },
    { path: rollbackDriftSecond, content: 'second-after\n' }
  ], {
    fs: rollbackDriftFs,
    allowedRoots: [rollbackDriftRoot],
    failAfter: 1
  })
} catch (error) {
  rollbackDriftError = error
}
assert(rollbackDriftError)
assert.strictEqual(rollbackDriftError.receipt.rollbackIncomplete, true)
assert.strictEqual(rollbackDriftError.receipt.rollbackFailures.length, 1)
assert.strictEqual(
  path.resolve(rollbackDriftError.receipt.rollbackFailures[0].destination),
  path.resolve(rollbackDriftFirst)
)
assert.ok(rollbackDriftError.receipt.rollbackFailures[0].backup)
assert.strictEqual(fs.readFileSync(rollbackDriftFirst, 'utf8'), 'concurrent-user-content\n')
assert.strictEqual(fs.readFileSync(rollbackDriftSecond, 'utf8'), 'second-before\n')

const renameFailureRoot = path.join(tmp, 'rename-failure')
fs.mkdirSync(renameFailureRoot, { recursive: true })
const renameFailureFile = path.join(renameFailureRoot, 'existing.txt')
fs.writeFileSync(renameFailureFile, 'preserved\n')
const renameFailureFs = Object.create(fs)
renameFailureFs.renameSync = (source, destination) => {
  if (
    path.resolve(source) === path.resolve(renameFailureFile) &&
    String(destination).startsWith(`${renameFailureFile}.devcodex-backup.`)
  ) {
    const error = new Error('injected backup rename failure')
    error.code = 'EPERM'
    throw error
  }
  return fs.renameSync(source, destination)
}
assert.throws(() => executeGlobalHostTransaction([
  { path: renameFailureFile, content: 'not-committed\n' }
], {
  fs: renameFailureFs,
  allowedRoots: [renameFailureRoot]
}), /injected backup rename failure/)
assert.strictEqual(fs.readFileSync(renameFailureFile, 'utf8'), 'preserved\n')
assert.strictEqual(
  fs.readdirSync(renameFailureRoot).some(file => file.includes('.devcodex-stage.')),
  false
)

const exactClaudeFile = path.join(env.CLAUDE_CONFIG_DIR, '.claude.json')
const outsideHomeFile = path.join(home, 'unexpected-global-write.txt')
const claudeTarget = targets.find(target => target.host === 'claude')
assert.strictEqual(path.resolve(claudeTarget.files.mcp), path.resolve(exactClaudeFile))
assert.strictEqual(claudeTarget.additionalFiles.length, 0)
assert.ok(!claudeTarget.additionalRoots.some(root => path.resolve(root) === path.resolve(home)))
assert.strictEqual(executeGlobalHostTransaction([
  { path: exactClaudeFile, content: '{}\n', kind: 'json' }
], {
  allowedRoots: [claudeTarget.root],
  allowedFiles: claudeTarget.additionalFiles,
  dryRun: true
}).status, 'planned')
assert.throws(() => executeGlobalHostTransaction([
  { path: outsideHomeFile, content: 'forbidden\n' }
], {
  allowedRoots: [claudeTarget.root],
  allowedFiles: claudeTarget.additionalFiles,
  dryRun: true
}), /GLOBAL_HOST_OPERATION_OUTSIDE_ROOT/)
assert.throws(() => executeGlobalHostTransaction([
  null
], {
  allowedRoots: [claudeTarget.root],
  dryRun: true
}), error => error.code === 'GLOBAL_HOST_OPERATION_INVALID')

const defaultClaudeTarget = resolveGlobalHostTarget('claude', {
  env: { ...env, CLAUDE_CONFIG_DIR: '' },
  home
})
const defaultClaudeMcpFile = path.join(home, '.claude.json')
assert.strictEqual(path.resolve(defaultClaudeTarget.files.mcp), path.resolve(defaultClaudeMcpFile))
assert.ok(defaultClaudeTarget.additionalFiles.some(file =>
  path.resolve(file) === path.resolve(defaultClaudeMcpFile)
))
assert.throws(() => executeGlobalHostTransaction([
  { host: 'claude', path: path.join(home, '.codex', 'cross-host.txt'), content: 'forbidden\n' }
], {
  allowedRoots: targets.map(target => target.root),
  allowedByHost: Object.fromEntries(targets.map(target => [
    target.host,
    {
      allowedRoots: [target.root, ...(target.additionalRoots || [])],
      allowedFiles: target.additionalFiles || []
    }
  ])),
  dryRun: true
}), /GLOBAL_HOST_OPERATION_OUTSIDE_ROOT/)

const physicalBoundaryRoot = path.join(tmp, 'physical-boundary')
const physicalOutsideRoot = path.join(tmp, 'physical-outside')
const physicalEscapeLink = path.join(physicalBoundaryRoot, 'linked-outside')
fs.mkdirSync(physicalBoundaryRoot, { recursive: true })
fs.mkdirSync(physicalOutsideRoot, { recursive: true })
let physicalEscapeProbeCreated = false
try {
  fs.symlinkSync(physicalOutsideRoot, physicalEscapeLink, process.platform === 'win32' ? 'junction' : 'dir')
  physicalEscapeProbeCreated = true
} catch (error) {
  console.warn(`physical boundary symlink probe skipped: ${error.code || error.message}`)
}
if (physicalEscapeProbeCreated) {
  assert.throws(() => executeGlobalHostTransaction([
    { path: path.join(physicalEscapeLink, 'escaped.txt'), content: 'forbidden\n' }
  ], {
    allowedRoots: [physicalBoundaryRoot],
    dryRun: true
  }), error => error.code === 'GLOBAL_HOST_OPERATION_REPARSE')

  const physicalRootLink = path.join(tmp, 'physical-root-link')
  fs.symlinkSync(physicalOutsideRoot, physicalRootLink, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => executeGlobalHostTransaction([
    { path: path.join(physicalRootLink, 'escaped-via-root.txt'), content: 'forbidden\n' }
  ], {
    allowedRoots: [physicalRootLink, physicalBoundaryRoot],
    safetyRoots: [physicalRootLink, physicalBoundaryRoot],
    transactionRoot: path.join(physicalBoundaryRoot, '.root-link-probe-transactions'),
    dryRun: true
  }), error => error.code === 'GLOBAL_HOST_OPERATION_ROOT_UNSAFE')

  assert.throws(() => resolveGlobalHostTargets({
    packageRoot,
    home,
    env: { ...env, CURSOR_HOME: physicalRootLink },
    hosts: ['cursor']
  }), error => error.code === 'GLOBAL_HOST_TARGET_ROOT_UNSAFE')

  const physicalInsideTarget = path.join(physicalBoundaryRoot, 'inside-target')
  const physicalInsideLink = path.join(physicalBoundaryRoot, 'linked-inside')
  fs.mkdirSync(physicalInsideTarget, { recursive: true })
  fs.symlinkSync(physicalInsideTarget, physicalInsideLink, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => executeGlobalHostTransaction([
    { path: path.join(physicalInsideLink, 'inside-via-link.txt'), content: 'forbidden\n' }
  ], {
    allowedRoots: [physicalBoundaryRoot],
    dryRun: true
  }), error => error.code === 'GLOBAL_HOST_OPERATION_REPARSE')

  const exactAllowedFile = path.join(physicalEscapeLink, 'exact-allowed.json')
  fs.writeFileSync(path.join(physicalOutsideRoot, 'exact-allowed.json'), '{}\n')
  assert.throws(() => executeGlobalHostTransaction([
    { path: exactAllowedFile, content: '{"managed":true}\n', kind: 'json' }
  ], {
    allowedRoots: [rollbackRoot, physicalBoundaryRoot],
    allowedFiles: [exactAllowedFile],
    safetyRoots: [physicalBoundaryRoot],
    transactionRoot: path.join(physicalBoundaryRoot, '.exact-file-probe-transactions'),
    dryRun: true
  }), error => error.code === 'GLOBAL_HOST_OPERATION_REPARSE')

  assert.throws(() => resolveGlobalHostTarget('claude', {
    packageRoot,
    home: physicalRootLink,
    env: {}
  }), error => error.code === 'GLOBAL_HOST_TARGET_ROOT_UNSAFE')
}

const deniedCodexRoot = path.resolve(env.CODEX_HOME)
const deniedCodexFs = Object.create(fs)
deniedCodexFs.realpathSync = targetPath => {
  const resolved = path.resolve(targetPath)
  if (resolved === deniedCodexRoot || resolved.startsWith(`${deniedCodexRoot}${path.sep}`)) {
    const error = new Error(`sandbox denied realpath for ${resolved}`)
    error.code = 'EPERM'
    throw error
  }
  return fs.realpathSync(targetPath)
}
deniedCodexFs.realpathSync.native = deniedCodexFs.realpathSync
const permissionIsolatedInspection = inspectGlobalHostConfiguration({
  packageRoot,
  env,
  home,
  fs: deniedCodexFs
})
const permissionDeniedCodex = permissionIsolatedInspection.hosts.find(item => item.host === 'codex')
assert.strictEqual(permissionIsolatedInspection.ready, false)
assert.strictEqual(permissionDeniedCodex.inspectionStatus, 'UNVERIFIED')
assert.strictEqual(permissionDeniedCodex.configured, false)
assert.strictEqual(permissionDeniedCodex.ready, false)
assert.strictEqual(permissionDeniedCodex.configurationIssues.length, 1)
assert.strictEqual(permissionDeniedCodex.configurationIssues[0].code, 'GLOBAL_HOST_TARGET_UNVERIFIED')
assert.strictEqual(permissionDeniedCodex.configurationIssues[0].reasonCode, 'sandbox-read-denied')
assert.strictEqual(permissionDeniedCodex.configurationIssues[0].errorCode, 'EPERM')
assert.ok(permissionDeniedCodex.configurationIssues[0].evidence.length <= 512)
assert.ok(permissionIsolatedInspection.hosts
  .filter(item => item.host !== 'codex')
  .every(item => item.inspectionStatus === 'PASS'))
assert.throws(
  () => buildGlobalHostConfigPlan({ packageRoot, env, home, fs: deniedCodexFs }),
  error => error && error.code === 'EPERM'
)
assert.throws(
  () => applyGlobalHostConfig({ packageRoot, env, home, fs: deniedCodexFs, dryRun: true }),
  error => error && error.code === 'EPERM'
)

const unexpectedTargetFailureFs = Object.create(fs)
unexpectedTargetFailureFs.realpathSync = targetPath => {
  const resolved = path.resolve(targetPath)
  if (resolved === deniedCodexRoot || resolved.startsWith(`${deniedCodexRoot}${path.sep}`)) {
    const error = new Error('injected non-permission realpath failure')
    error.code = 'EIO'
    throw error
  }
  return fs.realpathSync(targetPath)
}
unexpectedTargetFailureFs.realpathSync.native = unexpectedTargetFailureFs.realpathSync
assert.throws(
  () => inspectGlobalHostConfiguration({ packageRoot, env, home, fs: unexpectedTargetFailureFs }),
  error => error && error.code === 'EIO'
)

const cleanupRoot = path.join(tmp, 'cleanup')
fs.mkdirSync(cleanupRoot, { recursive: true })
const cleanupFirst = path.join(cleanupRoot, 'first.txt')
const cleanupSecond = path.join(cleanupRoot, 'second.txt')
fs.writeFileSync(cleanupFirst, 'before-first\n')
fs.writeFileSync(cleanupSecond, 'before-second\n')
const cleanupFs = Object.create(fs)
cleanupFs.unlinkSync = file => {
  if (String(file).startsWith(`${cleanupSecond}.devcodex-backup.`)) {
    const error = new Error('injected backup cleanup failure')
    error.code = 'EPERM'
    throw error
  }
  return fs.unlinkSync(file)
}
const cleanupReceipt = executeGlobalHostTransaction([
  { path: cleanupFirst, content: 'after-first\n' },
  { path: cleanupSecond, content: 'after-second\n' }
], {
  fs: cleanupFs,
  allowedRoots: [cleanupRoot]
})
assert.strictEqual(cleanupReceipt.status, 'committed')
assert.strictEqual(cleanupReceipt.backupCleanupIncomplete, true)
assert.strictEqual(cleanupReceipt.backupCleanupFailures.length, 1)
assert.strictEqual(fs.readFileSync(cleanupFirst, 'utf8'), 'after-first\n')
assert.strictEqual(fs.readFileSync(cleanupSecond, 'utf8'), 'after-second\n')

const partialHome = path.join(tmp, 'partial-home')
const partialEnv = {
  ...env,
  DEVCODEX_TEST_HOME: partialHome,
  USERPROFILE: partialHome,
  HOME: partialHome,
  CODEX_HOME: path.join(partialHome, '.codex'),
  CLAUDE_CONFIG_DIR: path.join(partialHome, '.claude'),
  GEMINI_CLI_HOME: path.join(partialHome, 'gemini-cli-home'),
  GROK_HOME: path.join(partialHome, '.grok'),
  CURSOR_HOME: path.join(partialHome, '.cursor'),
  COPILOT_HOME: path.join(partialHome, '.copilot')
}
const partial = applyGlobalHostConfig({
  packageRoot,
  env: partialEnv,
  home: partialHome,
  failAfterByHost: { claude: 0 }
})
assert.strictEqual(partial.transaction.status, 'partial')
assert.strictEqual(partial.transaction.hosts.length, 6)
assert.strictEqual(partial.transaction.hosts.find(item => item.host === 'claude').status, 'rolled-back')
assert.ok(partial.transaction.hosts
  .filter(item => item.host !== 'claude')
  .every(item => item.status === 'committed'))
assert.strictEqual(partial.transaction.activationLeaseCleanupIncomplete, false)
for (const target of partial.targets) {
  assert.strictEqual(
    fs.existsSync(path.join(target.runtimeBaseRoot, '.runtime-generation-leases')),
    false,
    `${target.host} activation lease directory must be removed after partial/rolled-back execution`
  )
}
assert.strictEqual(
  fs.existsSync(path.join(partialHome, '.claude', 'devcodex', 'global-host-receipt.json')),
  false
)
for (const host of ['.copilot', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok', '.cursor']) {
  assert.ok(
    fs.existsSync(path.join(partialHome, host, 'devcodex', 'global-host-receipt.json')),
    `${host} must commit despite the isolated Claude failure`
  )
}

for (const forbidden of fixture.workspaceForbidden) {
  assert.strictEqual(fs.existsSync(path.join(workspace, forbidden)), false, `${forbidden} must remain absent`)
}

cleanupTempFixture()
assert.strictEqual(fs.existsSync(tmp), false, 'global host config temporary fixture must be removed before success')
console.log(`global host config tests passed hosts=${GLOBAL_HOST_IDS.length} operations=${plan.operations.length} idempotent=1 rollback=1 workspaceHostDirs=0 tempCleanup=1`)
