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
  MCP_RUNTIME_DEPS,
  inspectGlobalHostConfig,
  inspectGlobalHostConfiguration
} = require('./lib/global-host-config.js')
const {
  mergeHostJsonContent,
  mergeJsonContent,
  mergeManagedBlock,
  mergeManagedTomlTables
} = require('./lib/global-host-config-merge.js')
const {
  executeGlobalHostTransaction
} = require('./lib/global-host-config-transaction.js')
const {
  GLOBAL_HOST_IDS,
  resolveGlobalHostTarget,
  resolveGlobalHostTargets
} = require('./lib/global-host-target.js')
const { projectionDescriptors } = require('./lib/host-surface-descriptors.js')

const packageRoot = path.resolve(__dirname, '..')
const cliEntry = path.join(packageRoot, 'index.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-host config with spaces-'))
const home = path.join(tmp, 'user home')
const workspace = path.join(tmp, 'workspace')
fs.mkdirSync(home, { recursive: true })
fs.mkdirSync(workspace, { recursive: true })
fs.writeFileSync(path.join(workspace, 'package.json'), '{ "name": "global-host-doctor-fixture" }\n')

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'global-host-config', 'cases.json'), 'utf8'))
assert.deepStrictEqual(fixture.hosts.map(item => item.id), GLOBAL_HOST_IDS)
assert.ok(
  MCP_RUNTIME_DEPS.includes('scripts/lib/executable-absorption-gates.js'),
  'global host runtime deps must include host-parity hard dependency: executable-absorption-gates.js'
)

const env = {
  ...process.env,
  DEVCODEX_TEST_HOME: home,
  USERPROFILE: home,
  HOME: home,
  CODEX_HOME: path.join(home, '.codex'),
  CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  GEMINI_CLI_HOME: path.join(home, 'gemini-cli-home'),
  GROK_HOME: path.join(home, '.grok'),
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
  GROK_AGENT: ''
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
assert.strictEqual(targets.length, 5)
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
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
  theme: 'user-owned',
  nested: { keep: true },
  hooks: {
    CustomEvent: [{ hooks: [{ type: 'command', command: 'user-command' }] }],
    PreToolUse: [
      { matcher: 'custom', hooks: [{ type: 'command', command: 'echo custom-pre' }] },
      { matcher: '', hooks: [{ type: 'command', command: 'node .claude/hooks/_runtime/lifecycle.cjs' }] }
    ]
  }
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

const plan = buildGlobalHostConfigPlan({ packageRoot, env, home })
assert.strictEqual(plan.workspaceHostDirectoriesWritten, false)
assert.strictEqual(plan.sharedRuntimeOwnerHost, 'codex')
assert.ok(plan.operations.length > 50)
assert.ok(plan.operations.every(operation => !operation.path.startsWith(workspace)))
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
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.agents', 'devcodex', 'instructions.full.md'))))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.agents', 'skills', 'routing', 'SKILL.md'))))
for (const graySkill of ['brand-visual-quality', 'consumer-validation-engineering', 'rework-prevention-engineering']) {
  assert.ok(
    !plan.operations.some(operation => operation.path.includes(path.join('.agents', 'skills', graySkill))),
    `gray Skill must not enter shared global deployment: ${graySkill}`
  )
  assert.ok(
    !plan.operations.some(operation => operation.path.includes(path.join('.claude', 'skills', graySkill))),
    `gray Skill must not enter Claude global deployment: ${graySkill}`
  )
}

const dryRun = applyGlobalHostConfig({ packageRoot, env, home, dryRun: true })
assert.strictEqual(dryRun.transaction.status, 'planned')
assert.strictEqual(fs.existsSync(path.join(home, '.grok', 'devcodex', 'global-host-receipt.json')), false)

const applied = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(applied.transaction.status, 'committed')
assert.strictEqual(applied.workspaceHostDirectoriesWritten, false)
assert.strictEqual(fs.existsSync(path.join(home, '.agents', 'devcodex', 'instructions.full.md')), true)
assert.strictEqual(fs.existsSync(path.join(home, '.agents', 'skills', 'routing', 'SKILL.md')), true)
assert.strictEqual(fs.existsSync(path.join(home, '.agents', 'skills', 'brand-visual-quality')), false)
assert.strictEqual(fs.existsSync(path.join(home, '.claude', 'skills', 'brand-visual-quality')), false)
assert.strictEqual(fs.existsSync(path.join(home, '.copilot', 'skills', 'routing', 'SKILL.md')), true)

const copilotHooks = JSON.parse(fs.readFileSync(path.join(home, '.copilot', 'hooks', 'devcodex.json'), 'utf8'))
assert.strictEqual(copilotHooks.version, 1)
assert.ok(copilotHooks.hooks.notification)
for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']) {
  assert.ok(Array.isArray(copilotHooks.hooks[event]), `Copilot hook event missing: ${event}`)
  assert.ok(JSON.stringify(copilotHooks.hooks[event]).includes('lifecycle-host-adapters.cjs'))
}
assert.strictEqual(copilotHooks.hooks.PreToolUse[0].matcher, '*')

const copilotMcp = JSON.parse(fs.readFileSync(path.join(home, '.copilot', 'mcp-config.json'), 'utf8'))
assert.strictEqual(copilotMcp.theme, 'user-owned')
assert.ok(copilotMcp.mcpServers.custom)
for (const name of ['devcodex-memory', 'devcodex-profile']) {
  assert.strictEqual(copilotMcp.mcpServers[name].type, 'local')
  assert.deepStrictEqual(copilotMcp.mcpServers[name].tools, ['*'])
  assert.ok(copilotMcp.mcpServers[name].args.some(value => /mcp\/(?:memory|profile)-server\.js$/i.test(value)))
}

const claudeSettings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
assert.strictEqual(claudeSettings.theme, 'user-owned')
assert.strictEqual(claudeSettings.nested.keep, true)
assert.ok(claudeSettings.hooks.CustomEvent)
assert.ok(claudeSettings.hooks.PreToolUse)
assert.ok(JSON.stringify(claudeSettings.hooks).includes('lifecycle-host-adapters.cjs'))
assert.ok(JSON.stringify(claudeSettings.hooks.PreToolUse).includes('custom-pre'))
assert.ok(!JSON.stringify(claudeSettings.hooks).includes('.claude/hooks/_runtime/lifecycle.cjs'))

const codexConfig = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
assert.ok(codexConfig.includes('model = "user-choice"'))
assert.ok(codexConfig.includes('BEGIN DEVCODEX MANAGED: global-codex-mcp'))
assert.ok(codexConfig.includes('[mcp_servers.user-keep]'))
assert.ok(!codexConfig.includes('old-runtime.js'))
assert.ok(!codexConfig.includes('BEGIN DEVCODEX-MCP-MANAGED'))
assert.strictEqual((codexConfig.match(/\[mcp_servers\.devcodex-memory\]/g) || []).length, 1)

// PF-211: Codex host-owned tool approval subtables inside the managed MCP block
// must not trip GLOBAL_HOST_MANAGED_CONFIG_DRIFT, while authority field edits still do.
const codexWithHostTools = codexConfig.replace(
  '[mcp_servers.devcodex-profile]',
  [
    '[mcp_servers.devcodex-memory.tools.memory_session_write]',
    'approval_mode = "approve"',
    '',
    '[mcp_servers.devcodex-memory.tools.memory_summary_query]',
    'approval_mode = "approve"',
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
  codexAfterReapply.includes('[mcp_servers.devcodex-memory.tools.memory_session_write]'),
  're-apply must preserve Codex host-owned tool approval subtables'
)
assert.ok(codexAfterReapply.includes('approval_mode = "approve"'))
const authorityTamper = codexAfterReapply.replace(
  /\[mcp_servers\.devcodex-memory\]\ncommand = "node"/,
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
assert.strictEqual(
  beforeGrokRegistration.hosts.find(host => host.host === 'grok').contractStatus,
  'unverified'
)
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
assert.match(adapterReadyDoctor, /global adapters:\s+5\/5 ready/)
assert.match(adapterReadyDoctor, /native hosts:\s+0\/5 ready/)
assert.match(adapterReadyDoctor, /All user-global adapters are installed and their contracts pass/)
assert.match(adapterReadyDoctor, /Native host CLIs not operationally ready: copilot, claude, codex, gemini, grok/)
assert.doesNotMatch(adapterReadyDoctor, /Repair missing adapters/)

const claudeRuntime = inspection.hosts.find(host => host.host === 'claude').runtimeEntry
const claudeRuntimeSource = fs.readFileSync(claudeRuntime, 'utf8')
fs.writeFileSync(claudeRuntime, claudeRuntimeSource.replace(/\s+claude: CLAUDE_EVENT_MAP,\r?\n/, '\n'), 'utf8')
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
    durableIdentity: false,
    authority: 'sourceDigest'
  })
  assert.strictEqual(Object.prototype.hasOwnProperty.call(receipt, 'packageRoot'), false)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(receipt.sourcePackageEvidence, 'observedRoot'), false)
  assert.ok(Array.isArray(receipt.managedPaths))
  assert.deepStrictEqual(receipt.pendingStaleManagedPaths, [])
}

const codexTarget = targets.find(target => target.host === 'codex')
const codexRuntime = path.join(codexTarget.root, 'devcodex', 'runtime')
require(path.join(codexRuntime, 'scripts', 'lib', 'host-parity-scorecard.js'))
require(path.join(codexRuntime, 'mcp', 'memory-server.js'))

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
  }), /GLOBAL_HOST_OPERATION_OUTSIDE_ROOT/)
}

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
  COPILOT_HOME: path.join(partialHome, '.copilot')
}
const partial = applyGlobalHostConfig({
  packageRoot,
  env: partialEnv,
  home: partialHome,
  failAfterByHost: { claude: 0 }
})
assert.strictEqual(partial.transaction.status, 'partial')
assert.strictEqual(partial.transaction.hosts.length, 5)
assert.strictEqual(partial.transaction.hosts.find(item => item.host === 'claude').status, 'rolled-back')
assert.ok(partial.transaction.hosts
  .filter(item => item.host !== 'claude')
  .every(item => item.status === 'committed'))
assert.strictEqual(
  fs.existsSync(path.join(partialHome, '.claude', 'devcodex', 'global-host-receipt.json')),
  false
)
for (const host of ['.copilot', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok']) {
  assert.ok(
    fs.existsSync(path.join(partialHome, host, 'devcodex', 'global-host-receipt.json')),
    `${host} must commit despite the isolated Claude failure`
  )
}

for (const forbidden of fixture.workspaceForbidden) {
  assert.strictEqual(fs.existsSync(path.join(workspace, forbidden)), false, `${forbidden} must remain absent`)
}

console.log(`global host config tests passed hosts=${GLOBAL_HOST_IDS.length} operations=${plan.operations.length} idempotent=1 rollback=1 workspaceHostDirs=0`)
