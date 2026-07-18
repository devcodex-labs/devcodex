#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { PROFILE_GENERATION_CONTRACT, projectFeatureInventoryState } = require('../mcp/profile-contract.js')

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
const { CODEX_HOOK_COMMAND } = require('../index.js')

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
  const sourceInstructions = fs.readFileSync(path.join(ROOT, 'instructions.md'), 'utf8')
  const agentsMd = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  const hooks = readJson(root, '.codex/hooks.json')
  const sourceSkillFiles = walk(path.join(ROOT, 'skills')).filter(file => path.basename(file) === 'SKILL.md')
  const installedSkillFiles = walk(path.join(root, '.agents', 'skills')).filter(file => path.basename(file) === 'SKILL.md')

  assert.strictEqual(agentsMd, sourceInstructions)
  assert.strictEqual(installedSkillFiles.length, sourceSkillFiles.length)
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
}

function assertClaudeMergeState(root, { claudeMdManaged }) {
  const settings = readJson(root, '.claude/settings.json')
  const mcp = readJson(root, '.mcp.json')
  const claudeMd = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')

  if (claudeMdManaged) {
    const sourceInstructions = fs.readFileSync(path.join(ROOT, 'instructions.md'), 'utf8')
    assert.strictEqual(claudeMd, sourceInstructions)
  } else {
    assert.strictEqual(claudeMd, '# custom claude instructions\n')
  }

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

  const backupRoot = path.join(root, '.devcodex', '.tmp', 'backups')
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

  const backupRoot = path.join(root, '.devcodex', '.tmp', 'backups')
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
  assert.match(output, /installed hosts:\s+codex, claude-code, copilot/)

  fs.rmSync(root, { recursive: true, force: true })
}

function testMachineReadableDiagnosticsAndStableErrors() {
  const root = createTempRoot('devcodex-cli-json-diagnostics-')
  writeFile(root, 'package.json', '{ "name": "diagnostic-project" }\n')

  const statusHuman = runCli(['status'], root)
  assert.match(statusHuman, /DevCodex status/)
  assert.doesNotMatch(statusHuman, /DevCodexCliEnvelopeV1/)

  const status = JSON.parse(runCli(['status', '--json'], root))
  assert.strictEqual(status.schemaVersion, 'DevCodexCliEnvelopeV1')
  assert.strictEqual(status.ok, true)
  assert.strictEqual(status.command, 'status')
  assert.strictEqual(status.packageVersion, require('../package.json').version)
  assert.strictEqual(status.payload.schemaVersion, 'StatusDiagnosticV1')
  assert.strictEqual(status.payload.cwd, root)
  assert.ok(Array.isArray(status.payload.installSurfaces))

  const doctor = JSON.parse(runCli(['doctor', '--json'], root))
  assert.strictEqual(doctor.ok, true)
  assert.strictEqual(doctor.command, 'doctor')
  assert.strictEqual(doctor.payload.schemaVersion, 'DoctorDiagnosticV1')
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

  fs.rmSync(root, { recursive: true, force: true })
}

function testDefaultInitBootstrapsActiveRootData() {
  const root = createTempRoot('devcodex-cli-runtime-data-')
  writeFile(root, 'package.json', '{ "name": "tmp-runtime-data" }\n')

  runCli(['init'], root)

  assertRuntimeDataBootstrap(path.join(root, '.devcodex'))
  assertDeploymentManifest(path.join(root, '.devcodex'), 'copilot')
  assert.ok(!fs.existsSync(path.join(root, '.github', 'instructions', 'tenants')), 'default init must not deploy tenant instructions')
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'instructions', 'tenants')), 'default Claude adapter must not deploy tenant instructions')
  fs.rmSync(root, { recursive: true, force: true })
}

function testTenantSelectionIsExplicit() {
  const root = createTempRoot('devcodex-cli-tenant-')
  writeFile(root, 'package.json', '{ "name": "tmp-tenant-project" }\n')

  runCli(['init', '--tenant', 'example-tenant'], root)
  assert.ok(fs.existsSync(path.join(root, '.github', 'instructions', 'tenants', 'example-tenant', '10-dev.instructions.md')))
  assert.ok(fs.existsSync(path.join(root, '.claude', 'instructions', 'tenants', 'example-tenant', '10-dev.instructions.md')))
  assert.ok(!fs.existsSync(path.join(root, '.github', 'instructions', 'tenants', 'README.md')))

  const invalidRoot = createTempRoot('devcodex-cli-tenant-invalid-')
  writeFile(invalidRoot, 'package.json', '{ "name": "tmp-invalid-tenant" }\n')
  assert.match(runCliFailure(['init', '--tenant', 'missing'], invalidRoot), /unknown or non-selectable tenant/)
  assert.ok(!fs.existsSync(path.join(invalidRoot, '.github')), 'invalid tenant must fail before deployment')

  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(invalidRoot, { recursive: true, force: true })
}

function testCodexInitBootstrapsWorkspaceNamespaceData() {
  const root = createTempRoot('devcodex-cli-codex-data-')
  writeJson(root, '.devcodex/layout.json', { version: 1, mode: 'workspace-namespace' })
  writeFile(root, 'packages/app-a/package.json', '{ "name": "app-a" }\n')

  runCli(['init', '--codex'], path.join(root, 'packages', 'app-a'))

  assertRuntimeDataBootstrap(path.join(root, '.devcodex', 'packages', 'app-a'))
  assertDeploymentManifest(path.join(root, '.devcodex', 'packages', 'app-a'), 'codex')
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

  runCli(['init', '--codex'], root)

  assertCodexAdapterState(root)
  assertRuntimeDataBootstrap(path.join(root, '.devcodex'))
  assertDeploymentManifest(path.join(root, '.devcodex'), 'codex')

  const backupRoot = path.join(root, '.devcodex', '.tmp', 'backups')
  assert.ok(findBackups(backupRoot, 'AGENTS.md').length >= 1)
  assert.ok(findBackups(backupRoot, 'hooks.json').length >= 1)

  fs.rmSync(root, { recursive: true, force: true })
}

function testCodexUpdateRefreshesAdapterInWorkspaceNamespace() {
  const root = createTempRoot('devcodex-cli-codex-update-')
  writeJson(root, '.devcodex/layout.json', { version: 1, mode: 'workspace-namespace' })
  writeFile(root, 'packages/app-a/package.json', '{ "name": "app-a" }\n')
  writeFile(root, 'packages/app-a/AGENTS.md', '# stale codex agent\n')
  writeJson(root, 'packages/app-a/.codex/hooks.json', {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo stale-command' }] }]
    }
  })

  runCli(['update', '--codex'], path.join(root, 'packages', 'app-a'))

  assertCodexAdapterState(path.join(root, 'packages', 'app-a'))
  assertRuntimeDataBootstrap(path.join(root, '.devcodex', 'packages', 'app-a'))
  assertDeploymentManifest(path.join(root, '.devcodex', 'packages', 'app-a'), 'codex')
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'managed')), 'workspace namespace must keep manifest under the project active-root')

  const backupRoot = path.join(root, '.devcodex', 'packages', 'app-a', '.tmp', 'backups')
  assert.ok(findBackups(backupRoot, 'AGENTS.md').length >= 1)
  assert.ok(findBackups(backupRoot, 'hooks.json').length >= 1)

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

function main() {
  testClaudeInitPreservesCustomConfig()
  testClaudeUpdateBacksUpAndPreservesCustomConfig()
  testDoctorAvoidsCodexBiasInMixedHostRepo()
  testMachineReadableDiagnosticsAndStableErrors()
  testDefaultInitBootstrapsActiveRootData()
  testTenantSelectionIsExplicit()
  testCodexInitBootstrapsWorkspaceNamespaceData()
  testCodexInitBacksUpManagedFiles()
  testCodexUpdateRefreshesAdapterInWorkspaceNamespace()
  testProfileInitUsesNestedNamespaceRoot()
  testProfileInitAndStatusShareTierContract()
  testProfilePlanAndTierTransitionsAreSafe()
  testProfileInitRejectsInvalidArguments()
  testTaskResolveHumanJsonAndNativeExitCodes()
  process.stdout.write('cli behavior test passed\n')
}

main()
