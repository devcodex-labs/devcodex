#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { PROFILE_GENERATION_CONTRACT, projectFeatureInventoryState } = require('../mcp/profile-contract.js')
const {
  buildGlobalHostComparison,
  buildScopedHostParity,
  isSourceCandidateMismatch
} = require('./lib/cli-maintenance-commands.js')
const { readControlInstructionRoot, resolveControlAsset } = require('./lib/control-content-delivery')
const { inspectWorkspaceTemp } = require('./lib/workspace-temp.js')

const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'index.js')
const HOST_ENV_SCRUB = {
  CLAUDE_CODE_VERSION: '',
  CLAUDE_HOOK_COMMAND: '',
  CODEX_HOME: '',
  CODEX_ENV_PWD: '',
  OPENAI_CODEX: '',
  IDEA_INITIAL_DIRECTORY: '',
  JETBRAINS_IDE: '',
  TERM_PROGRAM: '',
  VSCODE_PID: '',
  CURSOR_TRACE_ID: '',
  CURSOR_USER_ID: '',
  // HOST-grok: scrub so doctor/status fixtures stay host-neutral under Grok agent hosts
  GROK_AGENT: '',
  GROK_HOME: '',
  GROK_SESSION: '',
  GROK_SESSION_ID: '',
  GROK_BUILD: '',
  XAI_GROK: '',
  XAI_AGENT: '',
  DEVCODEX_AGENT: ''
}
const indexApi = require('../index.js')
const { CODEX_HOOK_COMMAND } = indexApi

for (const legacyWriter of ['cmdInit', 'cmdInitClaude', 'cmdInitCodex', 'cmdInitGemini', 'cmdInitGrok']) {
  assert.strictEqual(indexApi[legacyWriter], undefined, `${legacyWriter} must not be exported in GlobalOnlyHostConfigModeV1`)
}

assert.deepStrictEqual(projectFeatureInventoryState('FeatureInventorySchemaV2', []), {
  schemaVersion: 'FeatureInventorySchemaV2',
  featureCount: 0,
  lifecycleCounts: {},
  evidenceCounts: { unverified: 0 },
  evidenceState: 'unverified',
  asOf: null
})

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '')
}

function runCli(args, cwd, envOverrides = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...HOST_ENV_SCRUB, ...envOverrides }
  })
  if (result.status !== 0) {
    throw new Error(stripAnsi((result.stderr || result.stdout || 'CLI exited with failure').trim()))
  }
  return stripAnsi(`${result.stdout || ''}${result.stderr || ''}`)
}

function runCliFailure(args, cwd, envOverrides = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...HOST_ENV_SCRUB, ...envOverrides }
  })
  assert.notStrictEqual(result.status, 0, `expected CLI failure: ${args.join(' ')}`)
  return stripAnsi(`${result.stdout || ''}${result.stderr || ''}`)
}

function runCliResult(args, cwd, envOverrides = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...HOST_ENV_SCRUB, ...envOverrides }
  })
}

function writeFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}

function writeJson(root, relativePath, value) {
  writeFile(root, relativePath, JSON.stringify(value, null, 2) + '\n')
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

function walk(root) {
  if (!fs.existsSync(root)) return []
  const stat = fs.statSync(root)
  if (!stat.isDirectory()) return [root]
  const results = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    results.push(...walk(path.join(root, entry.name)))
  }
  return results
}

function findBackups(root, baseName) {
  return walk(root).filter(file => path.basename(file).startsWith(`${baseName}.bak.`))
}

function createTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

assert.match(runCli([], ROOT), /Usage:/)
assert.match(runCli(['help'], ROOT), /Usage:/)
assert.strictEqual(runCli(['--version'], ROOT).trim(), require('../package.json').version)
assert.match(runCliFailure(['definitely-unknown-command'], ROOT), /CLI_COMMAND_UNKNOWN/)

const sourceMismatchHost = {
  host: 'codex',
  configured: true,
  adapterReady: false,
  configurationIssues: [
    { code: 'GLOBAL_HOST_RECEIPT_STALE' },
    { code: 'GLOBAL_HOST_MANAGED_CONFIG_DRIFT' }
  ]
}
assert.strictEqual(isSourceCandidateMismatch(sourceMismatchHost, true), true)
assert.strictEqual(isSourceCandidateMismatch(sourceMismatchHost, false), false)
assert.deepStrictEqual(buildGlobalHostComparison(true, {
  hosts: [
    sourceMismatchHost,
    {
      host: 'claude',
      configured: false,
      adapterReady: false,
      configurationIssues: [{ code: 'GLOBAL_HOST_RECEIPT_MISSING' }]
    },
    {
      host: 'grok',
      configured: true,
      adapterReady: true,
      configurationIssues: []
    }
  ]
}), {
  schemaVersion: 'GlobalHostDiagnosticScopeV1',
  scope: 'source-candidate-vs-installed-receipts',
  installedHealthClaim: false,
  candidateMismatchHosts: ['codex'],
  adapterIssueHosts: ['claude']
})
const sourceScopedParity = buildScopedHostParity({
  hardReady: true,
  tier: 'full',
  checks: { pluginRegistered: false },
  failedChecks: ['pluginRegistered'],
  repairSteps: [{ command: 'devcodex update', detail: 'repair plugin registration' }],
  cannotClaim: ['Original installed-health claim']
}, {
  scope: 'source-candidate-vs-installed-receipts',
  installedHealthClaim: false
})
assert.strictEqual(sourceScopedParity.sourceCandidateOnly, true)
assert.strictEqual(sourceScopedParity.installedHealthClaim, false)
assert.strictEqual(sourceScopedParity.hardReady, false)
assert.strictEqual(sourceScopedParity.tier, 'source-candidate-comparison')
assert.deepStrictEqual(sourceScopedParity.checks, {})
assert.deepStrictEqual(sourceScopedParity.failedChecks, [])
assert.deepStrictEqual(sourceScopedParity.repairSteps, [])
assert.deepStrictEqual(sourceScopedParity.withheldChecks, { pluginRegistered: false })
assert.deepStrictEqual(sourceScopedParity.withheldFailedChecks, ['pluginRegistered'])
assert.deepStrictEqual(sourceScopedParity.withheldRepairSteps, [
  { command: 'devcodex update', detail: 'repair plugin registration' }
])
assert.match(sourceScopedParity.cannotClaim[0], /Installed Grok HostParity health is unverified/)
const maintenanceSource = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'cli-maintenance-commands.js'), 'utf8')
assert.ok(maintenanceSource.includes('installed package health is not asserted'))
assert.ok(maintenanceSource.includes('This does not prove the installed adapters are broken'))
assert.ok(maintenanceSource.includes('HostParity details are withheld in source-candidate scope'))

function buildClaudeProject(root) {
  writeFile(root, 'package.json', '{ "name": "tmp-cli-project" }\n')
  writeFile(root, 'CLAUDE.md', '# custom claude instructions\n')
  writeJson(root, '.claude/settings.json', {
    permissions: {
      allow: ['Read'],
      ask: ['Bash'],
      deny: ['DeleteTool']
    },
    hooks: {
      PreToolUse: [{ matcher: 'custom-pre', hooks: [{ type: 'command', command: 'echo custom-pre' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo custom-prompt' }] }]
    },
    enableAllProjectMcpServers: false
  })
  writeJson(root, '.mcp.json', {
    servers: {
      'legacy-custom': {
        type: 'stdio',
        command: 'node',
        args: ['legacy.js']
      }
    },
    mcpServers: {
      'custom-server': {
        type: 'stdio',
        command: 'node',
        args: ['custom.js']
      }
    }
  })
}

function assertRuntimeDataBootstrap(runtimeRoot) {
  for (const name of ['violations.md', 'pending-fixes.md', 'pending-issues.md', 'process-improvements.md', 'gap-registry.md']) {
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'data', name)), `missing runtime data file: ${name}`)
  }
}

function assertDeploymentManifest(runtimeRoot, expectedSurface) {
  const file = path.join(runtimeRoot, 'managed', 'deployment-manifest.json')
  assert.ok(fs.existsSync(file), `missing deployment manifest: ${file}`)
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.strictEqual(manifest.schemaVersion, 1)
  assert.ok(manifest.entries.length > 0)
  assert.ok(manifest.entries.some(entry => entry.surface === expectedSurface))
  assert.deepStrictEqual(manifest.staleEntries, [])
}

function assertCodexAdapterState(root) {
  const sourceInstructions = readControlInstructionRoot(ROOT).toString('utf8')
  const sourceKernel = fs.readFileSync(path.join(ROOT, 'host-projections', 'AGENTS.md'), 'utf8')
  const agentsMd = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  const fullFallback = fs.readFileSync(path.join(root, '.agents', 'devcodex', 'instructions.full.md'), 'utf8')
  const hooks = readJson(root, '.codex/hooks.json')
  const portfolio = JSON.parse(fs.readFileSync(
    resolveControlAsset(ROOT, 'skills/portfolio.json'),
    'utf8'
  ))
  const installedSkillFiles = walk(path.join(root, '.agents', 'skills')).filter(file => path.basename(file) === 'SKILL.md')

  assert.strictEqual(agentsMd, sourceKernel)
  assert.strictEqual(fullFallback, sourceInstructions)
  assert.strictEqual(installedSkillFiles.length, portfolio.summary.activeSkillCount)
  for (const graySkill of portfolio.skills.filter(skill => skill.lifecycleState === 'gray')) {
    assert.ok(!fs.existsSync(path.join(root, '.agents', 'skills', graySkill.id)), `gray Skill must not deploy: ${graySkill.id}`)
  }
  assert.ok(fs.existsSync(path.join(root, '.agents', 'skills', 'routing', 'SKILL.md')))
  assert.ok(fs.existsSync(path.join(root, '.codex', 'hooks', '_runtime', 'lifecycle.cjs')))

  for (const eventName of ['PreToolUse', 'UserPromptSubmit', 'PostToolUse', 'PreCompact', 'Stop']) {
    const entries = hooks.hooks?.[eventName]
    assert.ok(Array.isArray(entries) && entries.length > 0, `missing Codex hook event: ${eventName}`)
    const commands = JSON.stringify(entries)
    assert.ok(
      commands.includes('lifecycle.cjs') && (commands.includes('.codex') || commands.includes('codex')),
      `unexpected hook command for ${eventName}`
    )
  }
  assert.ok(
    JSON.stringify(hooks.hooks.PreCompact).includes('manual|auto'),
    'Codex PreCompact hook must match manual and auto compaction triggers'
  )

  // Codex MCP managed block (devcodex-memory + profile via .claude/mcp)
  assert.ok(fs.existsSync(path.join(root, '.claude', 'mcp', 'memory-server.js')), 'Codex init must deploy memory-server.js')
  assert.ok(fs.existsSync(path.join(root, '.claude', 'mcp', 'profile-server.js')), 'Codex init must deploy profile-server.js')
  assert.ok(fs.existsSync(path.join(root, '.claude', 'mcp', 'stdio-jsonrpc.cjs')), 'Codex init must deploy bounded stdio transport')
  const codexConfig = fs.readFileSync(path.join(root, '.codex', 'config.toml'), 'utf8')
  assert.ok(codexConfig.includes('BEGIN DEVCODEX-MCP-MANAGED'), 'Codex config.toml must include managed MCP block')
  assert.ok(codexConfig.includes('mcp_servers.devcodex-memory'), 'Codex config.toml must register devcodex-memory')
  assert.ok(codexConfig.includes('mcp_servers.devcodex-profile'), 'Codex config.toml must register devcodex-profile')
  assert.ok(
    codexConfig.includes('memory-server.js') && codexConfig.includes('profile-server.js'),
    'Codex MCP args must point at deployed server scripts'
  )
  const ownerToml = String(root).replace(/\\/g, '/')
  assert.ok(
    codexConfig.includes(ownerToml) || codexConfig.includes(path.resolve(root).replace(/\\/g, '/')),
    'Codex MCP args must include owner root as INPUT_ROOT'
  )
}

function assertClaudeMergeState(root, { claudeMdManaged }) {
  const settings = readJson(root, '.claude/settings.json')
  const mcp = readJson(root, '.mcp.json')
  const claudeMd = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')
  const agentsMd = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  const fullFallback = fs.readFileSync(path.join(root, '.agents', 'devcodex', 'instructions.full.md'), 'utf8')
  const sourceKernel = fs.readFileSync(path.join(ROOT, 'host-projections', 'AGENTS.md'), 'utf8')
  const sourceInstructions = readControlInstructionRoot(ROOT).toString('utf8')

  if (claudeMdManaged) {
    const sourceWrapper = fs.readFileSync(path.join(ROOT, 'host-projections', 'CLAUDE.md'), 'utf8')
    assert.strictEqual(claudeMd, sourceWrapper)
  } else {
    assert.strictEqual(claudeMd, '# custom claude instructions\n')
  }
  assert.strictEqual(agentsMd, sourceKernel)
  assert.strictEqual(fullFallback, sourceInstructions)

  assert.deepStrictEqual(settings.permissions.ask, ['Bash'])
  assert.deepStrictEqual(settings.permissions.deny, ['DeleteTool'])
  assert.ok(settings.permissions.allow.includes('Read'))
  assert.ok(settings.permissions.allow.includes('mcp__devcodex-memory'))
  assert.strictEqual(settings.enableAllProjectMcpServers, false)

  const preToolUseHooks = settings.hooks?.PreToolUse || []
  const promptHooks = settings.hooks?.UserPromptSubmit || []
  assert.ok(preToolUseHooks.some(entry => JSON.stringify(entry).includes('echo custom-pre')))
  assert.ok(promptHooks.some(entry => JSON.stringify(entry).includes('echo custom-prompt')))
  assert.ok(preToolUseHooks.some(entry => JSON.stringify(entry).includes('lifecycle.cjs')))
  assert.ok(promptHooks.some(entry => JSON.stringify(entry).includes('lifecycle.cjs')))

  assert.ok(!Object.prototype.hasOwnProperty.call(mcp, 'servers'))
  assert.ok(mcp.mcpServers['legacy-custom'])
  assert.ok(mcp.mcpServers['custom-server'])
  assert.ok(mcp.mcpServers['devcodex-memory'])
  assert.ok(mcp.mcpServers['devcodex-profile'])
}

function testClaudeInitPreservesCustomConfig() {
  const root = createTempRoot('devcodex-cli-init-')
  buildClaudeProject(root)

  runCli(['init', '--claude'], root)
  assertClaudeMergeState(root, { claudeMdManaged: false })
  assertRuntimeDataBootstrap(path.join(root, '.devcodex'))
  assertDeploymentManifest(path.join(root, '.devcodex'), 'claude')

  const backupRoot = indexApi.resolveWorkspaceTempBackupRoot(root)
  assert.strictEqual(findBackups(backupRoot, 'CLAUDE.md').length, 0)
  assert.ok(findBackups(backupRoot, 'settings.json').length >= 1)
  assert.ok(findBackups(backupRoot, '.mcp.json').length >= 1)

  fs.rmSync(root, { recursive: true, force: true })
}

function testClaudeUpdateBacksUpAndPreservesCustomConfig() {
  const root = createTempRoot('devcodex-cli-update-')
  buildClaudeProject(root)

  runCli(['update', '--claude'], root)
  assertClaudeMergeState(root, { claudeMdManaged: true })
  assertRuntimeDataBootstrap(path.join(root, '.devcodex'))
  assertDeploymentManifest(path.join(root, '.devcodex'), 'claude')

  const backupRoot = indexApi.resolveWorkspaceTempBackupRoot(root)
  assert.ok(findBackups(backupRoot, 'CLAUDE.md').length >= 1)
  assert.ok(findBackups(backupRoot, 'settings.json').length >= 1)
  assert.ok(findBackups(backupRoot, '.mcp.json').length >= 1)

  fs.rmSync(root, { recursive: true, force: true })
}

function testDoctorAvoidsCodexBiasInMixedHostRepo() {
  const root = createTempRoot('devcodex-cli-doctor-')
  writeFile(root, 'AGENTS.md', '# AGENTS\n')
  writeFile(root, 'CLAUDE.md', '# CLAUDE\n')
  writeFile(root, '.github/copilot-instructions.md', '# Copilot\n')
  writeFile(root, '.github/hooks/_runtime/lifecycle.cjs', 'module.exports = {}\n')
  writeFile(root, '.claude/hooks/_runtime/lifecycle.cjs', 'module.exports = {}\n')
  writeFile(root, '.agents/skills/example.txt', 'placeholder\n')
  writeFile(root, '.codex/hooks/_runtime/lifecycle.cjs', 'module.exports = {}\n')
  writeJson(root, '.codex/hooks.json', {
    hooks: {
      UserPromptSubmit: [{ command: CODEX_HOOK_COMMAND }]
    }
  })

  const output = runCli(['doctor'], root)
  assert.match(output, /platform:\s+unknown\s+\(unknown\)/)
  assert.match(output, /agent:\s+unknown-agent/)
  assert.match(output, /workspace hosts:\s+codex, claude-code, copilot \(legacy\)/)
  assert.match(output, /global adapters:\s+\d\/6 ready/)
  assert.match(output, /native hosts:\s+\d\/6 ready/)
  assert.match(output, /node runtime:\s+(?:PASS|WARN|BLOCK|UNVERIFIED)/)

  fs.rmSync(root, { recursive: true, force: true })
}

function testDoctorHonorsExplicitAgentBeforeAmbientHints() {
  const root = createTempRoot('devcodex-cli-doctor-explicit-host-')
  writeFile(root, 'package.json', '{ "name": "explicit-host-diagnostic" }\n')
  const doctor = JSON.parse(runCli(['doctor', '--json'], root, {
    DEVCODEX_AGENT: 'codex',
    GROK_AGENT: '1',
    GROK_SESSION_ID: 'stale-grok-session',
    GEMINI_AGENT: '1'
  }))
  assert.strictEqual(doctor.payload.platform, 'codex')
  assert.strictEqual(doctor.payload.platformEvidence.source, 'explicit-agent')
  fs.rmSync(root, { recursive: true, force: true })
}

function testMachineReadableDiagnosticsAndStableErrors() {
  const root = createTempRoot('devcodex-cli-json-diagnostics-')
  writeFile(root, 'package.json', '{ "name": "diagnostic-project" }\n')

  const statusHuman = runCli(['status'], root)
  assert.match(statusHuman, /DevCodex status/)
  assert.match(statusHuman, /node runtime\s+(?:PASS|WARN|BLOCK|UNVERIFIED)/)
  assert.match(statusHuman, /governance/)
  assert.doesNotMatch(statusHuman, /DevCodexCliEnvelopeV1/)

  const status = JSON.parse(runCli(['status', '--json'], root))
  assert.strictEqual(status.schemaVersion, 'DevCodexCliEnvelopeV1')
  assert.strictEqual(status.ok, true)
  assert.strictEqual(status.command, 'status')
  assert.strictEqual(status.packageVersion, require('../package.json').version)
  assert.strictEqual(status.payload.schemaVersion, 'StatusDiagnosticV1')
  assert.strictEqual(status.payload.cwd, root)
  assert.ok(Array.isArray(status.payload.installSurfaces))
  assert.strictEqual(status.payload.globalHostComparison.schemaVersion, 'GlobalHostDiagnosticScopeV1')
  assert.strictEqual(status.payload.globalHostComparison.scope, 'installed-package-vs-user-global-receipts')
  assert.strictEqual(status.payload.globalHostComparison.installedHealthClaim, true)
  assert.strictEqual(status.payload.globalHostRuntime.nodeRuntime.schemaVersion, 'NodeRuntimeReadinessV1')
  assert.match(status.payload.globalHostRuntime.nodeRuntime.status, /^(?:PASS|WARN|BLOCK|UNVERIFIED)$/)
  assert.deepStrictEqual(status.payload.globalHostComparison.candidateMismatchHosts, [])
  assert.ok(Array.isArray(status.payload.globalHostComparison.adapterIssueHosts))
  assert.strictEqual(status.payload.hostParity.diagnosticScope, 'installed-package-vs-user-global-receipts')
  assert.strictEqual(status.payload.hostParity.installedHealthClaim, true)
  assert.strictEqual(status.payload.executionOptimization.config.effective, 'safe-auto')
  assert.deepStrictEqual(status.payload.executionOptimization.writes, [])
  assert.deepStrictEqual(status.payload.hostConfigPolicy, {
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
    workspaceHostConfigWritesAllowed: false,
    legacyWorkspaceArtifacts: 'diagnostic-read-only',
    workspaceManagedArtifactsAllowed: ['.devcodex/**'],
    installCommand: 'devcodex global-adapters apply',
    updateCommand: 'devcodex global-adapters apply'
  })
  assert.strictEqual(status.payload.governanceSummary.schemaVersion, 'GovernanceStatusSummaryV1')
  assert.strictEqual(status.payload.governanceSummary.readOnly, true)
  assert.strictEqual(status.payload.governanceSummary.runtimeState.recordCount, 0)
  assert.strictEqual(status.payload.governanceSummary.skills.schemaVersion, 'SkillSelectionTraceV1')
  assert.strictEqual(status.payload.governanceSummary.executionOptimization.schemaVersion, 'ExecutionOptimizationEvidenceV1')
  assert.strictEqual(status.payload.governanceSummary.fastPathPolicy.visibleMode, 'full')

  const doctor = JSON.parse(runCli(['doctor', '--json'], root))
  assert.strictEqual(doctor.ok, true)
  assert.strictEqual(doctor.command, 'doctor')
  assert.strictEqual(doctor.payload.schemaVersion, 'DoctorDiagnosticV1')
  assert.strictEqual(doctor.payload.sourceRepository, false)
  assert.strictEqual(doctor.payload.globalHostComparison.scope, 'installed-package-vs-user-global-receipts')
  assert.strictEqual(doctor.payload.globalHostComparison.installedHealthClaim, true)
  assert.strictEqual(doctor.payload.hostParity.diagnosticScope, 'installed-package-vs-user-global-receipts')
  assert.strictEqual(doctor.payload.hostParity.installedHealthClaim, true)
  assert.strictEqual(doctor.payload.globalHostRuntime.nodeRuntime.schemaVersion, 'NodeRuntimeReadinessV1')
  assert.strictEqual(doctor.payload.executionOptimization.config.effective, 'safe-auto')
  assert.deepStrictEqual(doctor.payload.hostConfigPolicy, status.payload.hostConfigPolicy)
  assert.strictEqual(doctor.payload.governanceSummary.schemaVersion, 'GovernanceStatusSummaryV1')
  assert.strictEqual(doctor.payload.governanceSummary.gateLifecycle.readOnly, true)
  assert.strictEqual(doctor.payload.governanceSummary.ledgers.mutationAllowed, false)
  assert.deepStrictEqual(doctor.payload.capabilityBoundary, {
    localOnly: true,
    hookEvidence: 'event-dependent',
    instructionFallback: true,
    serverUrl: false,
    auth: false,
    tenant: false,
    telemetry: false
  })

  const failure = JSON.parse(runCliFailure(['status', '--bad', '--json'], root))
  assert.strictEqual(failure.ok, false)
  assert.strictEqual(failure.errorCode, 'CLI_INVALID_OPTION')
  assert.match(failure.nextStep, /status \[--json\]/)

  writeJson(root, '.devcodex/profile/config.json', {
    mode: 'dev',
    extensions: { devcodex: { executionOptimization: { mode: 'full-only' } } }
  })
  const fullOnly = JSON.parse(runCli(['status', '--json'], root))
  assert.strictEqual(fullOnly.payload.executionOptimization.config.effective, 'full-only')
  assert(fullOnly.payload.executionOptimization.features.every(item => item.decision.optimizationAllowed === false))
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', '.runtime-state', 'execution-optimization')), 'status must not initialize optimization state')

  fs.rmSync(root, { recursive: true, force: true })
}

function testDefaultInitBootstrapsActiveRootData() {
  const root = createTempRoot('devcodex-cli-runtime-data-')
  writeFile(root, 'package.json', '{ "name": "tmp-runtime-data" }\n')

  runCli(['init'], root)

  assert.deepStrictEqual(readJson(root, '.devcodex/layout.json'), {
    version: 1,
    mode: 'workspace-namespace',
    workspaceDir: 'workspace'
  })
  assertRuntimeDataBootstrap(path.join(root, '.devcodex', 'workspace'))
  assert.ok(!fs.existsSync(path.join(root, '.gitignore')), 'default init must not create .gitignore')
  for (const relative of ['.github', '.claude', '.codex', '.gemini', '.grok', '.agents', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json']) {
    assert.ok(!fs.existsSync(path.join(root, relative)), `default init must not create ${relative}`)
  }
  const statusAfterInit = runCli(['status'], root)
  assert.match(statusAfterInit, /\.devcodex\s+.*present/)
  assert.doesNotMatch(statusAfterInit, /Workspace runtime not initialized/)
  const statusAfterInitJson = JSON.parse(runCli(['status', '--json'], root))
  assert.strictEqual(statusAfterInitJson.payload.workspaceRuntimeReady, true)
  assert.strictEqual(statusAfterInitJson.payload.workspaceLayoutReady, true)
  assert.strictEqual(statusAfterInitJson.payload.activeRoot, path.join(root, '.devcodex', 'workspace'))
  const updated = JSON.parse(runCli(['update', '--json'], root))
  assert.strictEqual(updated.payload.runtimeRoot, path.join(root, '.devcodex', 'workspace'))
  assert.strictEqual(updated.payload.layoutCreated, false)
  assert.strictEqual(updated.payload.layoutPlanned, false)
  assert.strictEqual(updated.payload.mode, 'GlobalOnlyHostConfigModeV1')
  assert.strictEqual(updated.payload.workspaceCleanMode, 'GlobalOnlyWorkspaceCleanModeV1')
  assert.strictEqual(updated.payload.workspaceHostDirectoriesWritten, false)
  assert.strictEqual(updated.payload.gitignoreModified, false)
  assert.strictEqual(updated.payload.hostConfigNextStep, 'devcodex global-adapters apply')
  fs.rmSync(root, { recursive: true, force: true })
}

function testInitBootstrapsWorkspaceProfileAndOneNamedProject() {
  const root = createTempRoot('devcodex-cli-init-profile-target-')
  writeFile(root, 'apps/api/package.json', '{ "name": "api", "scripts": { "test": "node test.js" } }\n')
  writeFile(root, 'apps/web/package.json', '{ "name": "web" }\n')

  const result = JSON.parse(runCli(['init', '--profile', 'api', '--json'], root))
  const workspaceProfile = path.join(root, '.devcodex', 'workspace', 'profile')
  const apiProfile = path.join(root, '.devcodex', 'apps', 'api', 'profile')
  for (const file of ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md', 'config.json']) {
    assert.ok(fs.existsSync(path.join(workspaceProfile, file)), `init must create workspace profile baseline ${file}`)
  }
  assert.ok(fs.existsSync(path.join(apiProfile, 'README.md')), 'init --profile must initialize the requested project only')
  assert.ok(fs.existsSync(path.join(apiProfile, '06-功能清单.md')), 'init --profile must use the project recommendation instead of forcing profile-lite')
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'apps', 'web', 'profile')), 'init --profile must not initialize siblings')
  assert.strictEqual(result.payload.projectProfile.namespace, 'apps/api')

  const apiReadme = path.join(apiProfile, 'README.md')
  fs.appendFileSync(apiReadme, '\nmanual-profile-content\n', 'utf8')
  runCli(['init', '--profile=apps/api'], root)
  assert.match(fs.readFileSync(apiReadme, 'utf8'), /manual-profile-content/, 'repeated init must preserve project Profile content')

  fs.rmSync(root, { recursive: true, force: true })

  const missingRoot = createTempRoot('devcodex-cli-init-profile-missing-')
  writeFile(missingRoot, 'apps/api/package.json', '{ "name": "api" }\n')
  const missing = JSON.parse(runCliFailure(['init', '--profile', 'missing', '--json'], missingRoot))
  assert.strictEqual(missing.errorCode, 'PROFILE_TARGET_NOT_FOUND')
  assert.ok(!fs.existsSync(path.join(missingRoot, '.devcodex')), 'invalid project target must not write runtime or Profile files')
  fs.rmSync(missingRoot, { recursive: true, force: true })

  const ambiguousRoot = createTempRoot('devcodex-cli-init-profile-ambiguous-')
  writeFile(ambiguousRoot, 'apps/api/package.json', '{ "name": "apps-api" }\n')
  writeFile(ambiguousRoot, 'packages/api/package.json', '{ "name": "packages-api" }\n')
  const ambiguous = JSON.parse(runCliFailure(['init', '--profile', 'api', '--json'], ambiguousRoot))
  assert.strictEqual(ambiguous.errorCode, 'PROFILE_TARGET_AMBIGUOUS')
  assert.ok(!fs.existsSync(path.join(ambiguousRoot, '.devcodex')), 'ambiguous project target must not write runtime or Profile files')
  fs.rmSync(ambiguousRoot, { recursive: true, force: true })
}

function testExplicitProfileTargetsAndDryRunStayPhysicalAndZeroWrite() {
  const dryRunRoot = createTempRoot('devcodex-cli-explicit-target-dry-')
  writeFile(dryRunRoot, 'docs/package.json', '{ "name": "docs" }\n')
  writeFile(dryRunRoot, 'clients/acme/api/package.json', '{ "name": "deep-api" }\n')
  writeFile(dryRunRoot, 'dist/fake/package.json', '{ "name": "derived-fake" }\n')
  const before = walk(dryRunRoot).map(file => path.relative(dryRunRoot, file)).sort()
  const dry = JSON.parse(runCli(['init', '--profile', 'docs', '--dry-run', '--json'], dryRunRoot))
  const after = walk(dryRunRoot).map(file => path.relative(dryRunRoot, file)).sort()
  assert.deepStrictEqual(after, before, 'targeted dry-run must not create layout, Profile, backup, or runtime files')
  assert.strictEqual(dry.payload.projectProfile.namespace, 'docs')
  assert.ok(dry.payload.projectProfile.actions.length > 0)
  assert.ok(dry.payload.projectProfile.actions.every(item =>
    path.resolve(item.dest).startsWith(path.join(dryRunRoot, '.devcodex', 'docs', 'profile') + path.sep)
  ), 'targeted dry-run actions must use the future workspace namespace path')

  const deep = JSON.parse(runCli(['init', '--profile', 'clients/acme/api', '--json'], dryRunRoot))
  assert.strictEqual(deep.payload.projectProfile.namespace, 'clients/acme/api')
  assert.ok(fs.existsSync(path.join(dryRunRoot, '.devcodex', 'clients', 'acme', 'api', 'profile', 'README.md')))
  assert.ok(!fs.existsSync(path.join(dryRunRoot, 'clients', 'acme', 'api', '.devcodex')), 'project-local legacy runtime must not be written')
  fs.rmSync(dryRunRoot, { recursive: true, force: true })

  const containerRoot = createTempRoot('devcodex-cli-explicit-container-')
  writeFile(containerRoot, 'apps/package.json', '{ "name": "apps-project" }\n')
  const container = JSON.parse(runCli(['init', '--profile', 'apps', '--json'], containerRoot))
  assert.strictEqual(container.payload.projectProfile.namespace, 'apps')
  assert.ok(fs.existsSync(path.join(containerRoot, '.devcodex', 'apps', 'profile', 'README.md')))
  fs.rmSync(containerRoot, { recursive: true, force: true })

  const derivedRoot = createTempRoot('devcodex-cli-derived-target-')
  writeFile(derivedRoot, 'dist/fake/package.json', '{ "name": "derived-fake" }\n')
  const derived = JSON.parse(runCliFailure(['init', '--profile', 'fake', '--json'], derivedRoot))
  assert.strictEqual(derived.errorCode, 'PROFILE_TARGET_NOT_FOUND')
  assert.deepStrictEqual(derived.details.candidates, [])
  assert.ok(!fs.existsSync(path.join(derivedRoot, '.devcodex')))
  fs.rmSync(derivedRoot, { recursive: true, force: true })

  const runtimeOnlyRoot = createTempRoot('devcodex-cli-runtime-only-target-')
  writeFile(runtimeOnlyRoot, '.devcodex/history/profile/README.md', '# historical runtime only\n')
  const runtimeOnly = JSON.parse(runCliFailure(['init', '--profile', 'history', '--json'], runtimeOnlyRoot))
  assert.strictEqual(runtimeOnly.errorCode, 'PROFILE_TARGET_NOT_FOUND')
  assert.ok(!fs.existsSync(path.join(runtimeOnlyRoot, '.devcodex', 'layout.json')))
  assert.strictEqual(
    fs.readFileSync(path.join(runtimeOnlyRoot, '.devcodex', 'history', 'profile', 'README.md'), 'utf8'),
    '# historical runtime only\n'
  )
  fs.rmSync(runtimeOnlyRoot, { recursive: true, force: true })
}

function testDefaultInitLayoutOwnershipGuards() {
  const dryRunRoot = createTempRoot('devcodex-cli-runtime-dry-')
  writeFile(dryRunRoot, 'package.json', '{ "name": "tmp-runtime-dry" }\n')
  const dryRun = JSON.parse(runCli(['init', '--dry-run', '--json'], dryRunRoot))
  assert.strictEqual(dryRun.payload.layoutCreated, false)
  assert.strictEqual(dryRun.payload.layoutPlanned, true)
  assert.strictEqual(dryRun.payload.runtimeRoot, path.join(dryRunRoot, '.devcodex', 'workspace'))
  assert.strictEqual(fs.existsSync(path.join(dryRunRoot, '.devcodex')), false)

  const parentRoot = createTempRoot('devcodex-cli-runtime-parent-')
  const childRoot = path.join(parentRoot, 'packages', 'app-a')
  writeJson(parentRoot, '.devcodex/layout.json', {
    version: 1,
    mode: 'workspace-namespace',
    workspaceDir: 'workspace'
  })
  writeFile(childRoot, 'package.json', '{ "name": "app-a" }\n')
  const child = JSON.parse(runCli(['init', '--json'], childRoot))
  assert.strictEqual(child.payload.layoutCreated, false)
  assert.strictEqual(child.payload.workspaceRoot, parentRoot)
  assert.strictEqual(child.payload.runtimeRoot, path.join(parentRoot, '.devcodex', 'packages', 'app-a'))
  assert.strictEqual(fs.existsSync(path.join(childRoot, '.devcodex', 'layout.json')), false)
  assertRuntimeDataBootstrap(path.join(parentRoot, '.devcodex', 'packages', 'app-a'))

  const invalidRoot = createTempRoot('devcodex-cli-runtime-invalid-layout-')
  writeFile(invalidRoot, 'package.json', '{ "name": "tmp-runtime-invalid-layout" }\n')
  writeFile(invalidRoot, '.devcodex/layout.json', '{ invalid json }\n')
  const failure = JSON.parse(runCliFailure(['init', '--json'], invalidRoot))
  assert.strictEqual(failure.errorCode, 'WORKSPACE_LAYOUT_INVALID')
  assert.strictEqual(fs.readFileSync(path.join(invalidRoot, '.devcodex', 'layout.json'), 'utf8'), '{ invalid json }\n')
  assert.strictEqual(fs.existsSync(path.join(invalidRoot, '.devcodex', 'workspace')), false)

  const legacyRoot = createTempRoot('devcodex-cli-runtime-legacy-layout-')
  writeFile(legacyRoot, 'package.json', '{ "name": "tmp-runtime-legacy-layout" }\n')
  writeFile(legacyRoot, '.devcodex/profile/sentinel.txt', 'legacy-state\n')
  const legacyFailure = JSON.parse(runCliFailure(['init', '--json'], legacyRoot))
  assert.strictEqual(legacyFailure.errorCode, 'WORKSPACE_LAYOUT_MIGRATION_REQUIRED')
  assert.deepStrictEqual(legacyFailure.details.legacyRuntimeEntries, ['profile'])
  assert.match(legacyFailure.nextStep, /devcodex migrate-layout plan/)
  assert.strictEqual(fs.existsSync(path.join(legacyRoot, '.devcodex', 'layout.json')), false)
  assert.strictEqual(fs.existsSync(path.join(legacyRoot, '.devcodex', 'workspace')), false)
  assert.strictEqual(
    fs.readFileSync(path.join(legacyRoot, '.devcodex', 'profile', 'sentinel.txt'), 'utf8'),
    'legacy-state\n'
  )

  fs.rmSync(dryRunRoot, { recursive: true, force: true })
  fs.rmSync(parentRoot, { recursive: true, force: true })
  fs.rmSync(invalidRoot, { recursive: true, force: true })
  fs.rmSync(legacyRoot, { recursive: true, force: true })
}

function testUpdateNeverCreatesOrUpgradesProfiles() {
  const root = createTempRoot('devcodex-cli-update-profile-')
  writeFile(root, 'package.json', '{ "name": "update-profile" }\n')

  const updated = JSON.parse(runCli(['update', '--json'], root))
  assert.strictEqual(updated.payload.workspaceProfile.status, 'unchanged-by-update')
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'workspace', 'profile')), 'update must not create a workspace Profile')

  const targeted = JSON.parse(runCliFailure(['update', '--profile', 'api', '--json'], root))
  assert.strictEqual(targeted.errorCode, 'CLI_INVALID_OPTION')
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'workspace', 'profile')), 'rejected update --profile must remain zero-write for Profile')

  fs.rmSync(root, { recursive: true, force: true })
}

function testRuntimeStatusAndPruneAreBounded() {
  const root = createTempRoot('devcodex-cli-runtime-observe-')
  writeFile(root, 'package.json', '{ "name": "runtime-observe" }\n')
  runCli(['init'], root)
  const runtimeRoot = path.join(root, '.devcodex', 'workspace', '.runtime-state', 'workspace')
  const staleTemp = path.join(runtimeRoot, 'context-plan-cache', 'probe.json.tmp-old')
  const activeLock = path.join(runtimeRoot, 'skill-route', 'active.lock')
  const memoryOwner = path.join(runtimeRoot, 'memory-locks', 'fixture-lock', 'owner.json')
  fs.mkdirSync(path.dirname(staleTemp), { recursive: true })
  fs.mkdirSync(path.dirname(activeLock), { recursive: true })
  fs.mkdirSync(path.dirname(memoryOwner), { recursive: true })
  fs.writeFileSync(staleTemp, 'stale\n')
  fs.writeFileSync(activeLock, 'active\n')
  fs.writeFileSync(memoryOwner, JSON.stringify({
    schemaVersion: 'MemoryWriterLockV2',
    pid: process.pid,
    host: os.hostname(),
    file: '.memory/clients/codex/tasks/20260805.md',
    acquiredAt: new Date().toISOString()
  }) + '\n')
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  fs.utimesSync(staleTemp, old, old)

  const status = JSON.parse(runCli(['runtime', 'status', '--json'], root))
  assert.strictEqual(status.payload.schemaVersion, 'RuntimeStateStatusV1')
  assert.strictEqual(status.payload.canonicalRoot, runtimeRoot)
  assert.strictEqual(status.payload.totals.pruneCandidates, 1)
  assert.strictEqual(status.payload.totals.blockedLocks, 2)
  const memoryLock = status.payload.partitions
    .flatMap(partition => partition.blocked)
    .find(item => item.reason === 'memory-writer-lock-never-auto-pruned')
  assert.strictEqual(memoryLock.owner.pid, process.pid)
  assert.strictEqual(memoryLock.owner.file, '.memory/clients/codex/tasks/20260805.md')

  const preview = JSON.parse(runCli(['runtime', 'prune', '--dry-run', '--json'], root))
  assert.strictEqual(preview.payload.mode, 'dry-run')
  assert.ok(fs.existsSync(staleTemp), 'runtime prune preview must be zero-write')
  const applied = JSON.parse(runCli(['runtime', 'prune', '--apply', '--json'], root))
  assert.strictEqual(applied.payload.removed.length, 1)
  assert.ok(!fs.existsSync(staleTemp), 'runtime prune --apply must remove only the selected stale temp file')
  assert.ok(fs.existsSync(activeLock), 'runtime prune must never auto-delete lock files')
  assert.ok(fs.existsSync(memoryOwner), 'runtime prune must never auto-delete memory writer locks')

  fs.rmSync(root, { recursive: true, force: true })
}

function testWorkspaceTempStatusAndPruneAreManifestBounded() {
  const { registerWorkspaceTempArtifactAtRoot } = require('./lib/workspace-temp.js')
  const root = createTempRoot('devcodex-cli-workspace-temp-')
  writeFile(root, 'package.json', '{ "name": "workspace-temp" }\n')
  runCli(['init'], root)
  const tempRoot = indexApi.resolveWorkspaceTempRoot(root)
  const target = path.join(tempRoot, 'runs', 'workspace', 'cli-test', 'expired')
  writeFile(target, 'result.txt', 'expired\n')
  registerWorkspaceTempArtifactAtRoot(tempRoot, {
    artifactId: 'cli-expired-run',
    type: 'run',
    owner: 'cli-behavior-test',
    project: 'workspace',
    producer: 'cli-test',
    targetPath: target,
    createdAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-07-02T00:00:00.000Z'
  })

  const status = JSON.parse(runCli(['tmp', 'status', '--json'], root))
  assert.strictEqual(status.payload.schemaVersion, 'WorkspaceTempStatusV1')
  assert.strictEqual(status.payload.canonicalRoot, tempRoot)
  assert.strictEqual(status.payload.totals.candidates, 1)
  const preview = JSON.parse(runCli(['tmp', 'prune', '--json'], root))
  assert.strictEqual(preview.payload.mode, 'dry-run')
  assert.ok(fs.existsSync(target), 'tmp prune defaults to a zero-write preview')
  const conflict = JSON.parse(runCliFailure(['tmp', 'prune', '--dry-run', '--apply', '--json'], root))
  assert.strictEqual(conflict.errorCode, 'CLI_INVALID_OPTION')
  const applied = JSON.parse(runCli(['tmp', 'prune', '--apply', '--json'], root))
  assert.strictEqual(applied.payload.removed.length, 1)
  assert.ok(!fs.existsSync(target), 'tmp prune --apply removes only the inspected eligible target')
  assert.match(runCli(['help', 'tmp'], root), /canonical workspace temp root/i)

  fs.rmSync(root, { recursive: true, force: true })
}

function testTenantSelectionIsExplicit() {
  const root = createTempRoot('devcodex-cli-tenant-')
  writeFile(root, 'package.json', '{ "name": "tmp-tenant-project" }\n')
  writeFile(root, '.gitignore', '# user-owned\n')

  const result = JSON.parse(runCli(['init', '--tenant', 'example-tenant', '--json'], root))
  assert.strictEqual(result.payload.tenantId, 'example-tenant')
  assert.strictEqual(result.payload.workspaceHostDirectoriesWritten, false)
  assert.ok(fs.existsSync(path.join(root, '.devcodex')))
  assert.strictEqual(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '# user-owned\n')
  for (const relative of ['.github', '.claude', '.codex', '.gemini', '.grok', '.agents', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json']) {
    assert.ok(!fs.existsSync(path.join(root, relative)), `tenant selection must not create ${relative}`)
  }

  const invalidRoot = createTempRoot('devcodex-cli-tenant-invalid-')
  writeFile(invalidRoot, 'package.json', '{ "name": "tmp-invalid-tenant" }\n')
  assert.match(runCliFailure(['init', '--tenant', 'missing'], invalidRoot), /unknown or non-selectable tenant/)
  assert.ok(!fs.existsSync(path.join(invalidRoot, '.github')), 'invalid tenant must fail before deployment')

  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(invalidRoot, { recursive: true, force: true })
}

function testGlobalOnlyHostSelectorsFailClosed() {
  const root = createTempRoot('devcodex-cli-global-only-')
  writeFile(root, 'package.json', '{ "name": "tmp-global-only" }\n')
  for (const host of ['copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor', 'all']) {
    const result = runCliResult(['init', '--host', host, '--json'], root)
    assert.strictEqual(result.status, 2)
    const envelope = JSON.parse(result.stdout)
    assert.strictEqual(envelope.errorCode, 'CLI_HOST_CONFIG_GLOBAL_ONLY')
    assert.strictEqual(envelope.details.host, host)
    assert.strictEqual(envelope.details.workspaceCleanMode, 'GlobalOnlyWorkspaceCleanModeV1')
    assert.strictEqual(envelope.details.workspaceHostDirectoriesWritten, false)
    assert.match(envelope.nextStep, /devcodex global-adapters apply|npm install -g/)
  }
  const update = JSON.parse(runCliFailure(['update', '--claude', '--json'], root))
  assert.strictEqual(update.errorCode, 'CLI_HOST_CONFIG_GLOBAL_ONLY')
  assert.match(update.nextStep, /devcodex global-adapters apply|npm update -g/)
  const uninstall = JSON.parse(runCliFailure(['uninstall', '--host', 'grok', '--json'], root))
  assert.strictEqual(uninstall.errorCode, 'CLI_HOST_CONFIG_GLOBAL_ONLY')
  assert.match(uninstall.nextStep, /not supported/)
  const bareUninstall = JSON.parse(runCliFailure(['uninstall', '--json'], root))
  assert.strictEqual(bareUninstall.errorCode, 'CLI_HOST_CONFIG_GLOBAL_ONLY')
  assert.strictEqual(bareUninstall.details.host, 'all')
  assert.match(bareUninstall.nextStep, /not supported/)
  for (const relative of ['.github', '.claude', '.codex', '.gemini', '.grok']) {
    assert.ok(!fs.existsSync(path.join(root, relative)), `selector must not create ${relative}`)
  }
  fs.rmSync(root, { recursive: true, force: true })
}

function testCodexInitBootstrapsWorkspaceNamespaceData() {
  const root = createTempRoot('devcodex-cli-codex-data-')
  const projectRoot = path.join(root, 'packages', 'app-a')
  writeJson(root, '.devcodex/layout.json', { version: 1, mode: 'workspace-namespace' })
  writeFile(root, 'packages/app-a/package.json', '{ "name": "app-a" }\n')

  runCli(['init', '--codex'], projectRoot)

  assertRuntimeDataBootstrap(path.join(root, '.devcodex', 'packages', 'app-a'))
  assertCodexAdapterState(root)
  assertDeploymentManifest(path.join(root, '.devcodex', 'workspace'), 'codex')
  for (const relative of ['AGENTS.md', '.agents', '.codex']) {
    assert.ok(!fs.existsSync(path.join(projectRoot, relative)), `workspace child must not receive generated ${relative}`)
  }
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'packages', 'app-a', 'managed')), 'project active-root must not own host deployment claims')
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'managed')), 'workspace namespace must not create a parallel root manifest')
  fs.rmSync(root, { recursive: true, force: true })
}

function testCodexInitBacksUpManagedFiles() {
  const root = createTempRoot('devcodex-cli-codex-init-')
  writeFile(root, 'package.json', '{ "name": "tmp-codex-init" }\n')
  writeFile(root, 'AGENTS.md', '# custom agents instructions\n')
  writeJson(root, '.codex/hooks.json', {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'echo custom-stop' }] }]
    }
  })
  // User-owned non-managed key must survive MCP merge
  writeFile(root, '.codex/config.toml', 'sandbox_mode = "danger-full-access"\n\n[mcp_servers.user_keep]\ncommand = "echo"\n')

  runCli(['init', '--codex'], root)

  assertCodexAdapterState(root)
  assertRuntimeDataBootstrap(path.join(root, '.devcodex'))
  assertDeploymentManifest(path.join(root, '.devcodex'), 'codex')

  const codexConfig = fs.readFileSync(path.join(root, '.codex', 'config.toml'), 'utf8')
  assert.ok(codexConfig.includes('sandbox_mode = "danger-full-access"'), 'user sandbox_mode must be preserved')
  assert.ok(codexConfig.includes('mcp_servers.user_keep'), 'user mcp_servers must be preserved')
  assert.ok(codexConfig.includes('BEGIN DEVCODEX-MCP-MANAGED'), 'managed MCP block must be appended')

  // Idempotent second init
  runCli(['init', '--codex'], root)
  const again = fs.readFileSync(path.join(root, '.codex', 'config.toml'), 'utf8')
  const managedCount = (again.match(/BEGIN DEVCODEX-MCP-MANAGED/g) || []).length
  assert.strictEqual(managedCount, 1, 'managed MCP block must remain single after re-init')

  const backupRoot = indexApi.resolveWorkspaceTempBackupRoot(root)
  assert.ok(findBackups(backupRoot, 'AGENTS.md').length >= 1)
  assert.ok(findBackups(backupRoot, 'hooks.json').length >= 1)
  assert.ok(
    findBackups(backupRoot, 'config.toml').length >= 1,
    'changing existing .codex/config.toml must create a backup'
  )
  const tempStatus = inspectWorkspaceTemp(root)
  assert.strictEqual(tempStatus.blocked.some(item => item.reasons.includes('unknown-owner')), false)
  assert.ok(tempStatus.manifests.some(item => item.producer === 'codex-config-toml'))

  const doctor = JSON.parse(runCli(['doctor', '--json'], root))
  assert.strictEqual(doctor.ok, true)
  assert.strictEqual(doctor.payload?.codexConfigState?.mcp?.status, 'ok', 'doctor must report Codex DevCodex MCP ok after init')
  assert.strictEqual(doctor.payload?.codexConfigState?.mcp?.memoryServerExists, true)
  assert.strictEqual(doctor.payload?.codexConfigState?.mcp?.profileServerExists, true)

  fs.rmSync(root, { recursive: true, force: true })
}

function testCodexUpdateRefreshesAdapterInWorkspaceNamespace() {
  const root = createTempRoot('devcodex-cli-codex-update-')
  const projectRoot = path.join(root, 'packages', 'app-a')
  const staleAgents = '# stale codex agent\n'
  writeJson(root, '.devcodex/layout.json', { version: 1, mode: 'workspace-namespace' })
  writeFile(root, 'packages/app-a/package.json', '{ "name": "app-a" }\n')
  writeFile(root, 'packages/app-a/AGENTS.md', staleAgents)
  writeJson(root, 'packages/app-a/.codex/hooks.json', {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo stale-command' }] }]
    }
  })

  runCli(['update', '--codex'], projectRoot)

  assertCodexAdapterState(root)
  assertRuntimeDataBootstrap(path.join(root, '.devcodex', 'packages', 'app-a'))
  assertDeploymentManifest(path.join(root, '.devcodex', 'workspace'), 'codex')
  assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'), staleAgents, 'unowned child artifact must be preserved for reviewed migration')
  assert.match(fs.readFileSync(path.join(projectRoot, '.codex', 'hooks.json'), 'utf8'), /stale-command/)
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'packages', 'app-a', 'managed')), 'project active-root must not own host deployment claims')
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'managed')), 'workspace namespace must keep the host manifest under workspace runtime state')

  fs.rmSync(root, { recursive: true, force: true })
}

function testProfileInitUsesNestedNamespaceRoot() {
  const root = createTempRoot('devcodex-cli-profile-')
  writeJson(root, '.devcodex/layout.json', { version: 1, mode: 'workspace-namespace' })
  writeFile(root, 'packages/app-a/package.json', '{}\n')
  writeFile(root, 'packages/app-b/package.json', '{}\n')

  runCli(['profile', 'init', '--force'], path.join(root, 'packages', 'app-a'))
  runCli(['profile', 'init', '--force'], path.join(root, 'packages', 'app-b'))

  assert.ok(fs.existsSync(path.join(root, '.devcodex', 'packages', 'app-a', 'profile', 'config.json')))
  assert.ok(fs.existsSync(path.join(root, '.devcodex', 'packages', 'app-b', 'profile', 'config.json')))
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'packages', 'profile', 'config.json')))

  fs.rmSync(root, { recursive: true, force: true })
}

function testProfileInitAndStatusShareTierContract() {
  const root = createTempRoot('devcodex-cli-profile-tier-')
  writeFile(root, 'package.json', '{ "name": "tier-project", "version": "1.0.0", "scripts": { "test": "node test.js" } }\n')

  runCli(['profile', 'init', '--tier', 'profile-closed-loop'], root)
  const profileDir = path.join(root, '.devcodex', 'profile')
  for (const file of ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md', '04-测试规范.md', '05-发布规范.md', '06-功能清单.md', '07-用户文档与契约规范.md']) {
    assert.ok(fs.existsSync(path.join(profileDir, file)), `missing closed-loop profile file: ${file}`)
  }
  assert.match(fs.readFileSync(path.join(profileDir, 'README.md'), 'utf8'), /profile-closed-loop/)
  assert.match(fs.readFileSync(path.join(profileDir, '06-功能清单.md'), 'utf8'), /FeatureInventorySchemaV2/)
  assert.match(runCli(['status'], root), /profile-closed-loop; files 8\/8; semantic 4\/4; config present/)
  assert.match(runCli(['doctor'], root), /profile.*✅ profile-closed-loop/)
  const statusJson = JSON.parse(runCli(['status', '--json'], root))
  assert.strictEqual(statusJson.payload.profile.featureInventory.schemaVersion, 'FeatureInventorySchemaV2')
  assert.strictEqual(statusJson.payload.profile.featureInventory.evidenceState, 'source-backed')
  assert.strictEqual(statusJson.payload.profile.featureInventory.lifecycleCounts.implemented, 1)

  writeFile(
    root,
    '.devcodex/profile/06-功能清单.md',
    [
      '# 06 — 功能清单',
      '',
      '> FeatureInventorySchemaV1',
      '',
      '| 能力 ID | 能力组 | 公开面 | 配置入口 | 主要消费者 | 文档入口 | 验证路线 | 事实来源 | 维护责任 | 发布状态 |',
      '|---|---|---|---|---|---|---|---|---|---|',
      '| cli-main | CLI | `devcodex` | 命令参数 | CLI 用户 | `README.md` | `node test.js` | package.json#bin.devcodex | 项目维护者 | unverified |',
      ''
    ].join('\n')
  )
  const legacyStatusJson = JSON.parse(runCli(['status', '--json'], root))
  assert.strictEqual(legacyStatusJson.payload.profile.featureInventory.schemaVersion, 'FeatureInventorySchemaV1')
  assert.strictEqual(legacyStatusJson.payload.profile.featureInventory.evidenceState, 'unverified')
  assert.strictEqual(legacyStatusJson.payload.profile.featureInventory.lifecycleCounts.unknown, 1)
  assert.match(runCli(['status'], root), /profile-closed-loop; files 8\/8; semantic 4\/4; config present/)

  fs.appendFileSync(
    path.join(profileDir, 'README.md'),
    '\n## 档位说明\n\n- profile-lite\n- profile-standard\n- profile-closed-loop\n',
    'utf8'
  )
  assert.match(runCli(['status'], root), /profile-closed-loop; files 8\/8; semantic 4\/4; config present/)

  fs.appendFileSync(path.join(profileDir, 'README.md'), '\nProfile 档位：profile-lite。\n', 'utf8')
  assert.match(runCli(['status'], root), /invalid.*multiple profile tiers declared/)
  assert.match(runCli(['doctor'], root), /invalid.*multiple profile tiers declared/)
  const conflictingReadme = fs.readFileSync(path.join(profileDir, 'README.md'), 'utf8')
  assert.match(runCliFailure(['profile', 'init'], root), /invalid existing Profile tier.*multiple profile tiers declared/)
  assert.strictEqual(fs.readFileSync(path.join(profileDir, 'README.md'), 'utf8'), conflictingReadme, 'invalid existing tier must fail without writing')

  fs.rmSync(root, { recursive: true, force: true })
}

function testProfilePlanAndTierTransitionsAreSafe() {
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(PROFILE_GENERATION_CONTRACT.tiers).map(([tier, contract]) => [tier, contract.defaultGeneratedFiles.length])),
    { 'profile-lite': 5, 'profile-standard': 8, 'profile-closed-loop': 9 },
    'Profile default generation matrix must remain 5/8/9'
  )
  const root = createTempRoot('devcodex-cli-profile-plan-')
  writeFile(root, 'package.json', JSON.stringify({
    name: 'profile-cli-project',
    version: '2.0.0',
    bin: { profilecli: 'index.js' },
    scripts: { test: 'node test.js' }
  }, null, 2) + '\n')

  const plan = runCli(['profile', 'plan', '--tier', 'profile-closed-loop'], root)
  assert.match(plan, /dry-run:\s+no directories, files or backups will be written/)
  assert.match(plan, /recommended tier: profile-closed-loop/)
  assert.ok(!fs.existsSync(path.join(root, '.devcodex')), 'profile plan must not create runtime directories')

  runCli(['profile', 'init'], root)
  const profileDir = path.join(root, '.devcodex', 'profile')
  const readme = path.join(profileDir, 'README.md')
  fs.appendFileSync(readme, '\n## Manual content\n\nKEEP-ME\n', 'utf8')
  runCli(['profile', 'init', '--tier', 'profile-standard'], root)
  assert.match(fs.readFileSync(readme, 'utf8'), /Profile 档位：`profile-standard`/)
  assert.match(fs.readFileSync(readme, 'utf8'), /KEEP-ME/)
  assert.ok(fs.existsSync(path.join(profileDir, '06-功能清单.md')))

  runCli(['profile', 'init', '--tier', 'profile-closed-loop'], root)
  const forceOutput = runCli(['profile', 'init', '--force'], root)
  assert.match(forceOutput, /detected tier:\s+profile-closed-loop/)
  assert.match(forceOutput, /target tier:\s+profile-closed-loop/)
  assert.match(fs.readFileSync(readme, 'utf8'), /profile-closed-loop/)

  assert.match(runCliFailure(['profile', 'init', '--tier', 'profile-lite'], root), /refusing profile downgrade/)
  runCli(['profile', 'init', '--tier', 'profile-lite', '--allow-downgrade'], root)
  assert.match(fs.readFileSync(readme, 'utf8'), /profile-lite/)
  assert.ok(fs.existsSync(path.join(profileDir, '07-用户文档与契约规范.md')), 'safe downgrade retains higher-tier files')

  fs.rmSync(root, { recursive: true, force: true })
}

function testProfileInitRejectsInvalidArguments() {
  const root = createTempRoot('devcodex-cli-profile-invalid-')
  writeFile(root, 'package.json', '{ "name": "invalid-profile-project" }\n')

  assert.match(runCliFailure(['profile', 'init', '--dry-run', '--unknown'], root), /unknown profile init option/)
  assert.match(runCliFailure(['profile', 'init', '--tier'], root), /missing value for --tier/)
  const invalidTier = runCliFailure(['profile', 'init', '--tier', 'not-a-tier'], root)
  assert.match(invalidTier, /invalid --tier value/)
  assert.doesNotMatch(invalidTier, /at cmdProfileInit|node:internal/)
  assert.ok(!fs.existsSync(path.join(root, '.devcodex')), 'invalid arguments must not write Profile files')

  fs.rmSync(root, { recursive: true, force: true })
}

function testSkillPlanHumanJsonFallbackAndNativeExitCodes() {
  const root = createTempRoot('devcodex-cli-skill-plan-')
  writeFile(root, 'package.json', '{ "name": "skill-plan-project" }\n')

  const json = JSON.parse(runCli(['skill', 'plan', 'dev-testing', '--max-bytes', '1000000', '--json'], root))
  assert.strictEqual(json.schemaVersion, 'DevCodexCliEnvelopeV1')
  assert.strictEqual(json.ok, true)
  assert.strictEqual(json.payload.schemaVersion, 'BundleDecisionV2')
  assert.strictEqual(json.payload.completion, 'complete')
  assert.strictEqual(json.payload.budgetDecision.schemaVersion, 'BudgetDecisionV1')
  assert.strictEqual(json.payload.budgetDecision.enforcementStatus, 'enforced')
  assert.strictEqual(json.payload.budgetDecision.optimizedHit, true)
  assert.deepStrictEqual(new Set(json.payload.selected.map(item => item.id)),
    new Set(['api-verification', 'dev-scenario-test', 'dev-testing']))
  assert.match(runCli(['skill', 'plan', 'intent'], root), /Skill bundle plan/)

  const staged = JSON.parse(runCli(['skill', 'plan', 'dev-testing', '--max-skills', '1', '--json'], root))
  assert.strictEqual(staged.payload.completion, 'over-budget-mandatory')
  assert.strictEqual(staged.payload.budgetDecision.enforcementStatus, 'blocked')
  assert.strictEqual(staged.payload.budgetDecision.optimizedHit, false)
  assert(staged.payload.stages.length >= 3)
  const fallback = JSON.parse(runCli(['skill', 'plan', 'intent', '--host-capability', 'unsupported', '--json'], root))
  assert.strictEqual(fallback.payload.completion, 'fallback-full')
  assert.strictEqual(fallback.payload.fallback.route, 'full-skill-read')
  assert.strictEqual(fallback.payload.budgetDecision.enforcementStatus, 'fallback-full')
  assert.strictEqual(fallback.payload.budgetDecision.optimizedHit, false)

  writeJson(root, '.devcodex/profile/config.json', {
    mode: 'dev',
    extensions: { devcodex: { executionOptimization: { mode: 'full-only' } } }
  })
  const configuredFallback = JSON.parse(runCli(['skill', 'plan', 'intent', '--json'], root))
  assert.strictEqual(configuredFallback.payload.completion, 'fallback-full')
  assert.strictEqual(configuredFallback.payload.fallback.route, 'full-skill-read')
  assert.strictEqual(configuredFallback.payload.budgetDecision.enforcementStatus, 'fallback-full')
  assert.strictEqual(configuredFallback.payload.budgetDecision.optimizedHit, false)

  const blocked = runCliResult(['skill', 'plan', 'brand-visual-quality', '--json'], root)
  assert.strictEqual(blocked.status, 1)
  const blockedEnvelope = JSON.parse(stripAnsi(blocked.stdout))
  assert.strictEqual(blockedEnvelope.errorCode, 'SKILL_BUNDLE_BLOCKED')
  assert.strictEqual(blockedEnvelope.details.completion, 'blocked')
  assert.strictEqual(blockedEnvelope.details.budgetDecision.enforcementStatus, 'blocked')
  const invalid = runCliResult(['skill', 'plan', '--json'], root)
  assert.strictEqual(invalid.status, 2)
  assert.strictEqual(JSON.parse(stripAnsi(invalid.stdout)).errorCode, 'CLI_INVALID_OPTION')
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', '.runtime-state')), 'skill plan must remain read-only')

  fs.rmSync(root, { recursive: true, force: true })
}

function testTaskResolveHumanJsonAndNativeExitCodes() {
  const root = createTempRoot('devcodex-cli-task-resolve-')
  writeFile(root, 'package.json', '{ "name": "task-resolve-project" }\n')
  const taskRoot = path.join(root, '.devcodex', 'optimizations', 'CLI任务')
  writeJson(taskRoot, '.memory/task.json', {
    schemaVersion: 'TaskIdentityV1',
    taskId: '5baea296-2392-493c-a615-a84a0cb6e249',
    displayName: 'CLI任务',
    aliases: ['CLI旧任务名'],
    createdAt: '2026-07-18T00:00:00.000Z',
    identityRevision: 1
  })
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  writeFile(taskRoot, '.memory/sessions.md', '# CLI task\n\n> **当前状态**: 🔄 active\n')
  const canonicalBefore = fs.readFileSync(sessionsPath, 'utf8')

  const json = JSON.parse(runCli(['task', 'resolve', 'CLI旧任务名', '--json'], root))
  assert.strictEqual(json.schemaVersion, 'DevCodexCliEnvelopeV1')
  assert.strictEqual(json.ok, true)
  assert.strictEqual(json.payload.status, 'resolved-active')
  assert.strictEqual(json.payload.candidate.taskId, '5baea296-2392-493c-a615-a84a0cb6e249')
  assert.match(runCli(['task', 'resolve', 'CLI任务'], root), /resolved-active/)
  assert.strictEqual(fs.readFileSync(sessionsPath, 'utf8'), canonicalBefore, 'task resolve must not change canonical sessions')

  const missing = runCliResult(['task', 'resolve', '不存在', '--json'], root)
  assert.strictEqual(missing.status, 1)
  assert.strictEqual(JSON.parse(stripAnsi(missing.stdout)).errorCode, 'TASK_NOT_FOUND')
  const invalid = runCliResult(['task', 'resolve', '--json'], root)
  assert.strictEqual(invalid.status, 2)
  assert.strictEqual(JSON.parse(stripAnsi(invalid.stdout)).errorCode, 'CLI_INVALID_OPTION')

  const duplicateRoot = path.join(root, '.devcodex', 'bugs', 'CLI同名副本')
  writeJson(duplicateRoot, '.memory/task.json', {
    schemaVersion: 'TaskIdentityV1',
    taskId: '1d39dc56-903c-4f2e-984e-d75dd8501ff8',
    displayName: 'CLI任务',
    aliases: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    identityRevision: 1
  })
  writeFile(duplicateRoot, '.memory/sessions.md', '# duplicate\n\n> **当前状态**: 🔄 active\n')
  const ambiguous = runCliResult(['task', 'resolve', 'CLI任务', '--json'], root)
  assert.strictEqual(ambiguous.status, 2)
  const ambiguousEnvelope = JSON.parse(stripAnsi(ambiguous.stdout))
  assert.strictEqual(ambiguousEnvelope.errorCode, 'TASK_AMBIGUOUS')
  assert.strictEqual(ambiguousEnvelope.details.candidates.length, 2)

  fs.rmSync(root, { recursive: true, force: true })
}

function testCodexMcpPreventionNegatives() {
  const { buildCliHostUtils } = require('./lib/cli-host-utils')
  const hostUtils = buildCliHostUtils({
    fs,
    path,
    isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    claudeMcpJson: { mcpServers: {} }
  })
  const root = 'E:/Worker'
  const BEGIN = hostUtils.CODEX_MCP_MANAGED_BEGIN
  const END = hostUtils.CODEX_MCP_MANAGED_END

  // F-002 markers
  assert.strictEqual(hostUtils.mergeCodexConfigToml(BEGIN + '\nfoo\n', root).code, 'CODEX_MCP_MARKER_INVALID')
  assert.strictEqual(hostUtils.mergeCodexConfigToml(END + '\n', root).code, 'CODEX_MCP_MARKER_INVALID')
  assert.strictEqual(hostUtils.mergeCodexConfigToml(END + '\n' + BEGIN + '\n', root).code, 'CODEX_MCP_MARKER_INVALID')
  // F-002 identity
  assert.strictEqual(
    hostUtils.mergeCodexConfigToml('["mcp_servers"."devcodex-memory"]\ncommand = "old"\n', root).code,
    'CODEX_MCP_IDENTITY_CONFLICT'
  )
  assert.strictEqual(
    hostUtils.mergeCodexConfigToml('mcp_servers.devcodex-memory.command = "old"\n', root).code,
    'CODEX_MCP_IDENTITY_CONFLICT'
  )
  const ok = hostUtils.mergeCodexConfigToml('sandbox_mode = "workspace-write"\n', root)
  assert.strictEqual(ok.ok, true)
  assert.strictEqual(hostUtils.mergeCodexConfigToml(ok.content, root).changed, false)

  // F-004 cross-table args false positive
  const falsePos = [
    BEGIN,
    '[mcp_servers.devcodex-memory]',
    'command = "node"',
    '',
    '[mcp_servers.devcodex-profile]',
    'command = "node"',
    'args = [',
    '  "profile-only.js",',
    '  "E:/Worker"',
    ']',
    END,
    ''
  ].join('\n')
  assert.deepStrictEqual(hostUtils.extractCodexMcpServerArgs(falsePos, 'devcodex-memory'), [])
  assert.deepStrictEqual(
    hostUtils.extractCodexMcpServerArgs(falsePos, 'devcodex-profile'),
    ['profile-only.js', 'E:/Worker']
  )

  const tmp = createTempRoot('devcodex-cli-codex-mcp-neg-')
  fs.mkdirSync(path.join(tmp, '.codex'), { recursive: true })
  fs.mkdirSync(path.join(tmp, '.claude', 'mcp'), { recursive: true })
  fs.writeFileSync(path.join(tmp, '.claude', 'mcp', 'memory-server.js'), '//x\n')
  fs.writeFileSync(path.join(tmp, '.claude', 'mcp', 'profile-server.js'), '//x\n')
  fs.writeFileSync(path.join(tmp, '.codex', 'config.toml'), falsePos.replace(/E:\/Worker/g, tmp.replace(/\\/g, '/')))
  const inspect = hostUtils.inspectCodexMcpManagedConfig(tmp)
  assert.notStrictEqual(inspect.status, 'ok', 'missing memory args must not report ok')
  assert.strictEqual(inspect.memoryHasArgs, false)

  // F-007 Codex-only host identity
  assert.deepStrictEqual(hostUtils.detectInstalledHostAssets(tmp), ['codex'])
  fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# claude\n')
  assert.ok(hostUtils.detectInstalledHostAssets(tmp).includes('claude-code'))

  // F-001: init must fail closed when markers invalid (existing file preserved)
  const badRoot = createTempRoot('devcodex-cli-codex-failclosed-')
  writeFile(badRoot, 'package.json', '{ "name": "tmp-codex-fc" }\n')
  const badToml = BEGIN + '\nbroken\n'
  writeFile(badRoot, '.codex/config.toml', badToml)
  const failed = runCliResult(['init', '--codex'], badRoot)
  assert.notStrictEqual(failed.status, 0, 'init --codex must fail on invalid markers')
  assert.strictEqual(
    fs.readFileSync(path.join(badRoot, '.codex', 'config.toml'), 'utf8'),
    badToml,
    'fail-closed must not overwrite broken config'
  )

  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(badRoot, { recursive: true, force: true })
}

function testInitHelpMatchesZeroWriteTargetContract() {
  const root = createTempRoot('devcodex-cli-init-help-')
  const output = runCli(['help', 'init'], root)
  assert.match(output, /existing physical project/)
  assert.match(output, /unique name or workspace-relative namespace/)
  assert.match(output, /--dry-run writes nothing/)
  assert.strictEqual(fs.existsSync(path.join(root, '.devcodex')), false, 'read-only init help must not create workspace state')
  fs.rmSync(root, { recursive: true, force: true })
}

function main() {
  require('./test-workspace-temp.js')
  testDoctorAvoidsCodexBiasInMixedHostRepo()
  testDoctorHonorsExplicitAgentBeforeAmbientHints()
  testMachineReadableDiagnosticsAndStableErrors()
  testDefaultInitBootstrapsActiveRootData()
  testInitBootstrapsWorkspaceProfileAndOneNamedProject()
  testExplicitProfileTargetsAndDryRunStayPhysicalAndZeroWrite()
  testDefaultInitLayoutOwnershipGuards()
  testUpdateNeverCreatesOrUpgradesProfiles()
  testRuntimeStatusAndPruneAreBounded()
  testWorkspaceTempStatusAndPruneAreManifestBounded()
  testTenantSelectionIsExplicit()
  testGlobalOnlyHostSelectorsFailClosed()
  testCodexMcpPreventionNegatives()
  testInitHelpMatchesZeroWriteTargetContract()
  testProfileInitUsesNestedNamespaceRoot()
  testProfileInitAndStatusShareTierContract()
  testProfilePlanAndTierTransitionsAreSafe()
  testProfileInitRejectsInvalidArguments()
  testSkillPlanHumanJsonFallbackAndNativeExitCodes()
  testTaskResolveHumanJsonAndNativeExitCodes()
  process.stdout.write('cli behavior test passed\n')
}

main()
