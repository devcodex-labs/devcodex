#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  applyGlobalHostConfig,
  buildGlobalHostConfigPlan,
  inspectGlobalHostConfig
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
  resolveGlobalHostTargets
} = require('./lib/global-host-target.js')
const { projectionDescriptors } = require('./lib/host-surface-descriptors.js')

const packageRoot = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-host config with spaces-'))
const home = path.join(tmp, 'user home')
const workspace = path.join(tmp, 'workspace')
fs.mkdirSync(home, { recursive: true })
fs.mkdirSync(workspace, { recursive: true })

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'global-host-config', 'cases.json'), 'utf8'))
assert.deepStrictEqual(fixture.hosts.map(item => item.id), GLOBAL_HOST_IDS)

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
  [...GLOBAL_HOST_IDS].sort()
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
assert.ok(plan.operations.length > 50)
assert.ok(plan.operations.every(operation => !operation.path.startsWith(workspace)))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.codex', 'AGENTS.md'))))
assert.ok(plan.operations.some(operation => operation.path.endsWith(path.join('.claude', 'settings.json'))))

const dryRun = applyGlobalHostConfig({ packageRoot, env, home, dryRun: true })
assert.strictEqual(dryRun.transaction.status, 'planned')
assert.strictEqual(fs.existsSync(path.join(home, '.grok', 'devcodex', 'global-host-receipt.json')), false)

const applied = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(applied.transaction.status, 'committed')
assert.strictEqual(applied.workspaceHostDirectoriesWritten, false)

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

const inspection = inspectGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(inspection.ready, true)
assert.deepStrictEqual(inspection.hosts.map(host => host.host), GLOBAL_HOST_IDS)
assert.ok(inspection.hosts.every(host => host.ready))

for (const target of targets) {
  const receiptFile = path.join(target.root, 'devcodex', 'global-host-receipt.json')
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
  for (const field of [
    'host',
    'packageVersion',
    'sourceDigest',
    'managedPaths',
    'previousStateRef',
    'result',
    'updatedAt'
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(receipt, field), `${target.host} receipt missing ${field}`)
  }
  assert.strictEqual(receipt.result, 'committed')
  assert.strictEqual(receipt.workspaceHostDirectoriesWritten, false)
  assert.ok(Array.isArray(receipt.managedPaths))
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

const second = applyGlobalHostConfig({ packageRoot, env, home })
assert.strictEqual(second.transaction.changed, 0, 'second apply must be idempotent')

const copilotInstructions = path.join(home, '.copilot', 'copilot-instructions.md')
fs.unlinkSync(copilotInstructions)
const driftedInspection = inspectGlobalHostConfig({ packageRoot, env, home })
const driftedCopilot = driftedInspection.hosts.find(host => host.host === 'copilot')
assert.strictEqual(driftedInspection.ready, false)
assert.strictEqual(driftedCopilot.ready, false)
assert.ok(driftedCopilot.missingConfigFiles.includes(copilotInstructions.replace(/\\/g, '/')))
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

const exactClaudeFile = path.join(home, '.claude.json')
const outsideHomeFile = path.join(home, 'unexpected-global-write.txt')
const claudeTarget = targets.find(target => target.host === 'claude')
assert.ok(claudeTarget.additionalFiles.some(file => path.resolve(file) === path.resolve(exactClaudeFile)))
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
