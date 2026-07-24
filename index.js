#!/usr/bin/env node
/**
 * DevCodex CLI – npx devcodex <command>
 * Commands and aliases are defined by the shared CLI command registry.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildCliHostUtils } = require('./scripts/lib/cli-host-utils.js')
const { buildCliRuntimeUtils } = require('./scripts/lib/cli-runtime-utils.js')
const { buildProfileBootstrapUtils } = require('./scripts/lib/profile-bootstrap-utils.js')
const { buildCliInstallCommands } = require('./scripts/lib/cli-install-commands.js')
const { buildCliMaintenanceCommands } = require('./scripts/lib/cli-maintenance-commands.js')
const { buildCliObservabilityCommands } = require('./scripts/lib/cli-observability-commands.js')
const { buildCliExecutionCommands } = require('./scripts/lib/cli-execution-commands.js')
const { createCliCommandRegistry, runCliCommand } = require('./scripts/lib/cli-command-registry.js')
const { launchGrok } = require('./scripts/lib/grok-workspace-launcher.js')
const { resolveTenantSelection, shouldIncludeInstructionFile } = require('./scripts/lib/tenant-selection.js')
const { createDeploymentSession, writeManifestAtomic } = require('./scripts/lib/deployment-manifest-utils.js')
const {
  grokUserConfigPath,
  retireWorkspaceProjectHostManifest,
  resolveHostAdapterScope,
  syncGrokPluginInstallation, syncGrokWorkspacePluginInstallation, uninstallGrokPluginInstallation,
  writeGrokPluginRegistration
} = require('./scripts/lib/host-adapter-scope.js')
const { runCli: runMigrateLayout } = require('./scripts/migrate-layout.js')
const {
  detectProfileTier, filesForProfileTier, inspectProfileContract, normalizeProfileTier,
  compareProfileTiers, updateProfileTierDeclaration, FEATURE_INVENTORY_SCHEMA_VERSION,
  FEATURE_INVENTORY_COLUMN_LABELS
} = require('./mcp/profile-contract.js')
const {
  findLayoutInfo: sharedFindLayoutInfo,
  inferProjectFromCwd: sharedInferProjectFromCwd,
  resolveActiveRuntimeRoot: sharedResolveActiveRuntimeRoot,
  resolveProfileDir: sharedResolveProfileDir
} = require('./hooks/_runtime/workspace-layout.cjs')
const { createAnsiHelpers, walkDir: walkDirFs } = require('./scripts/lib/cli-console-utils.js')
const c = createAnsiHelpers()
const walkDir = dir => walkDirFs(fs, dir)

// ─── Source directories (inside the npm package) ─────────────────────────────
const PKG_ROOT = __dirname
const SOURCES = [
  { from: 'skills', to: 'skills' },
  { from: 'instructions', to: 'instructions' },
  { from: 'prompts', to: 'prompts' },
  { from: 'hooks', to: 'hooks' },
  { from: 'agents', to: 'agents' },
  { from: 'data/templates', to: 'data' },
]

/**
 * Files copied by devcodex init --claude into .claude/
 * hooks/_runtime is shared with Copilot (same unified lifecycle.cjs).
 * devcodex.lifecycle.json is Copilot-only and not needed in .claude/.
 */
const CLAUDE_SOURCES = [
  { from: 'hooks/_runtime', to: 'hooks/_runtime' },
  { from: 'mcp', to: 'mcp' },
  { from: 'skills', to: 'skills' },
  { from: 'instructions', to: 'instructions' },
  { from: 'prompts', to: 'prompts' },
  { from: 'data/templates', to: 'data' },
]

/**
 * Allowlist of scripts/lib modules deployed next to Claude MCP servers.
 * Keep tight: only modules actually required by mcp/*.js (today: memory + profile).
 * Do not ship the entire package scripts/lib tree into consumer projects.
 */
const CLAUDE_MCP_RUNTIME_SCRIPT_DEPS = Object.freeze([
  'scripts/lib/cp-digest.js',
  'scripts/lib/host-parity-scorecard.js',
  'scripts/lib/global-host-target.js',
  'scripts/lib/derived-index-contract.js',
  'scripts/lib/memory-index.js',
  'scripts/lib/summary-type-canon.js'
])

const CODEX_SOURCES = [
  { from: 'hooks/_runtime', to: path.join('.codex', 'hooks', '_runtime') },
  { from: 'codex', to: '.codex' },
]

const { buildDeploymentDescriptors: buildDeploymentDescriptorsImpl } = require('./scripts/lib/deployment-descriptors.js')

function buildDeploymentDescriptors(surfaces, { tenantId = null, grokWorkspaceBridge = false, grokWorkspaceScope = false } = {}) {
  return buildDeploymentDescriptorsImpl(PKG_ROOT, surfaces, {
    SOURCES,
    CLAUDE_SOURCES,
    CLAUDE_MCP_RUNTIME_SCRIPT_DEPS,
    CODEX_SOURCES,
    tenantId,
    grokWorkspaceBridge,
    grokWorkspaceScope
  })
}

function beginManagedDeployment(cwd, surfaces, { tenantId = null, grokWorkspaceBridge = false, grokWorkspaceScope = false } = {}) {
  const runtimeRoot = resolveActiveRuntimeRoot(cwd)
  const manifestFile = path.join(runtimeRoot, 'managed', 'deployment-manifest.json')
  const packageJson = readJsonFile(path.join(PKG_ROOT, 'package.json')) || {}
  const session = createDeploymentSession({
    packageRoot: PKG_ROOT,
    targetRoot: cwd,
    manifestFile,
    descriptors: buildDeploymentDescriptors(surfaces, { tenantId, grokWorkspaceBridge, grokWorkspaceScope }),
    packageName: packageJson.name || '@vextjs/devcodex',
    packageVersion: packageJson.version || 'unknown'
  })
  const preview = session.preview
  console.log(c.dim(
    `  Managed preview: ${preview.add.length} add, ${preview.update.length} update, ` +
    `${preview.unchanged.length} unchanged, ${preview.stale.length} stale, ${preview.unowned.length} unowned`
  ))
  for (const entry of preview.stale.slice(0, 10)) console.log(c.yellow(`  ! stale managed: ${entry.destination}`))
  for (const destination of preview.unowned.slice(0, 10)) console.log(c.dim(`  ? unowned: ${destination}`))
  if (preview.stale.length > 10 || preview.unowned.length > 10) console.log(c.dim('  … additional manifest preview entries omitted'))
  return session
}

function finishManagedDeployment(session, dryRun) {
  if (dryRun) {
    console.log(c.dim('  Managed manifest dry run: no file written.'))
    return null
  }
  const output = writeManifestAtomic(session)
  console.log(c.green(`  ✓ managed manifest: ${output}`))
  return output
}

// v1.9.8+: agents/ 已恢复 Copilot 默认分发；保留数组便于后续遗留迁移项。
const LEGACY_TARGETS = []

/** Check if cwd is the DevCodex source repo itself */
function isSourceRepo(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg.name === '@vextjs/devcodex'
  } catch { return false }
}

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function findLayoutInfo(startDir) {
  return sharedFindLayoutInfo(startDir)
}

function inferProjectFromCwd(cwd, layout) {
  return sharedInferProjectFromCwd(cwd, layout || sharedFindLayoutInfo(cwd))
}

function resolveActiveRuntimeRoot(cwd) {
  return sharedResolveActiveRuntimeRoot(cwd)
}

const DEVCODEX_GITIGNORE_ENTRIES = [
  '.devcodex/.memory/',
  '.devcodex/.audit-state/',
  '.devcodex/.tmp/',
  '.devcodex/profile/config.local.json',
  '.devcodex/workspace/profile/config.local.json',
  '.devcodex/*/.memory/',
  '.devcodex/*/.audit-state/',
  '.devcodex/*/.tmp/',
  '.devcodex/*/profile/config.local.json'
]

/**
 * Hook command: walk up for lifecycle.cjs + project marker (.devcodex/ or package.json).
 * Why: settings may live at workspace root while host runs in a project subdir (monorepo-safe).
 */
const CLAUDE_HOOK_COMMAND = `node -e "let d=process.cwd(),fs=require('fs'),p=require('path');while(true){const f=p.join(d,'.claude','hooks','_runtime','lifecycle.cjs');if(fs.existsSync(f)&&(fs.existsSync(p.join(d,'.devcodex'))||fs.existsSync(p.join(d,'package.json')))){require(f);break}const n=p.dirname(d);if(n===d){process.exit(0)}d=n}"`
const CODEX_HOOK_COMMAND = `node -e "let d=process.cwd(),fs=require('fs'),p=require('path');while(true){const f=p.join(d,'.codex','hooks','_runtime','lifecycle.cjs');if(fs.existsSync(f)&&(fs.existsSync(p.join(d,'.devcodex'))||fs.existsSync(p.join(d,'package.json')))){require(f);break}const n=p.dirname(d);if(n===d){process.exit(0)}d=n}"`

/** Claude Code settings.json hook configuration */
const CLAUDE_SETTINGS_HOOKS = {
  hooks: {
    PreToolUse: [{
      matcher: '',
      hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }]
    }],
    UserPromptSubmit: [{
      hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }]
    }],
    PostToolUse: [{
      matcher: '',
      hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }]
    }],
    Stop: [{
      hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }]
    }]
  }
}

/** Claude Code project settings: minimal pre-approve for DevCodex surface (ABS-14 / FIX-19) */
const CLAUDE_SETTINGS_PERMISSIONS = {
  $schema: 'https://json.schemastore.org/claude-code-settings.json',
  permissions: {
    allow: [
      // Prefer scoped tools; bare "Bash" removed — use Bash(node:*) / project scripts when needed
      'Bash(node:*)',
      'Bash(npm:*)',
      'Bash(npx:*)',
      'BashOutput',
      'Edit',
      'Glob',
      'Grep',
      'KillBash',
      'LS',
      'MultiEdit',
      'NotebookEdit',
      'NotebookRead',
      'Read',
      'Task',
      'TodoWrite',
      'WebFetch',
      'WebSearch',
      'Write',
      'mcp__devcodex-memory',
      'mcp__devcodex-memory__*',
      'mcp__devcodex-profile',
      'mcp__devcodex-profile__*'
    ],
    ask: ['Bash'],
    deny: []
  },
  // Only auto-enable DevCodex MCP servers, not every project MCP
  enableAllProjectMcpServers: false
}

/** Claude Code .mcp.json content written to target project root */
const CLAUDE_MCP_JSON = {
  mcpServers: {
    'devcodex-memory': {
      type: 'stdio',
      command: 'node',
      args: ['.claude/mcp/memory-server.js', '.'],
      _note: 'Reads/writes .devcodex/.memory/ session files and records CP confirmations.'
    },
    'devcodex-profile': {
      type: 'stdio',
      command: 'node',
      args: ['.claude/mcp/profile-server.js', '.'],
      _note: 'Loads .devcodex/profile/ files and returns ENV_MODE / agent config.'
    }
  }
}

const {
  normalizeStringArray,
  mergeUniqueStringArrays,
  mergeClaudeHooks,
  mergeClaudeMcpConfig,
  mergeCodexConfigToml,
  CODEX_MCP_MANAGED_BEGIN,
  inspectCodexMcpManagedConfig,
  detectInstalledHostAssets,
  detectHostPlatform,
  inspectHostInstructionSurfaces
} = buildCliHostUtils({
  fs,
  path,
  isPlainObject,
  claudeMcpJson: CLAUDE_MCP_JSON
})

function getCodexConfigState(cwd) {
  const userConfig = path.join(os.homedir(), '.codex', 'config.toml')
  const workspaceConfig = path.join(cwd, '.codex', 'config.toml')
  const mcp = inspectCodexMcpManagedConfig(cwd)
  return {
    userConfig,
    workspaceConfig,
    hasUserConfig: fs.existsSync(userConfig),
    hasWorkspaceConfig: fs.existsSync(workspaceConfig),
    mcp
  }
}

const {
  resolveGitignoreRoot,
  ensureRuntimeDirs,
  resolveProfileDir,
  ensureDevCodexGitignore,
  getLegacyCounts,
  copyManagedTextFile,
  readJsonFileWithStatus,
  writeManagedJsonFile
} = buildCliRuntimeUtils({
  fs,
  path,
  walkDir,
  pkgRoot: PKG_ROOT,
  findLayoutInfo,
  resolveActiveRuntimeRoot,
  resolveProfileDirImpl: sharedResolveProfileDir,
  legacyTargets: LEGACY_TARGETS,
  devcodexGitignoreEntries: DEVCODEX_GITIGNORE_ENTRIES
})

const {
  readJsonSafe,
  safeFirstLine,
  detectArch,
  listTopDirs,
  detectStyle,
  genProfileReadme,
  genProjectInfo,
  genArchitecture,
  genStyle,
  genTestSpec,
  genReleaseSpec,
  genFeatureInventory,
  recommendProfileTier,
  genUserContractSpec,
  genConfigJson,
  detectAgent
} = buildProfileBootstrapUtils({
  fs,
  path,
  detectHostPlatform,
  detectInstalledHostAssets,
  processEnv: process.env,
  featureInventorySchemaVersion: FEATURE_INVENTORY_SCHEMA_VERSION,
  featureInventoryColumnLabels: FEATURE_INVENTORY_COLUMN_LABELS
})

const { cmdInitWorkspaceRuntime, cmdInitHost, cmdUninstallHost } = buildCliInstallCommands({
  fs, path, process, console, c, PKG_ROOT, SOURCES, CLAUDE_SOURCES,
  CLAUDE_MCP_RUNTIME_SCRIPT_DEPS,
  CODEX_SOURCES, CLAUDE_SETTINGS_HOOKS, CLAUDE_SETTINGS_PERMISSIONS,
  CLAUDE_MCP_JSON, CODEX_HOOK_COMMAND, isSourceRepo, beginManagedDeployment,
  finishManagedDeployment, copyManagedTextFile, readJsonFileWithStatus,
  writeManagedJsonFile, normalizeStringArray, mergeUniqueStringArrays,
  mergeClaudeHooks, mergeClaudeMcpConfig, mergeCodexConfigToml, CODEX_MCP_MANAGED_BEGIN,
  ensureRuntimeDirs, ensureDevCodexGitignore, walkDir,
  resolveActiveRuntimeRoot, resolveGitignoreRoot, getLegacyCounts, isPlainObject,
  resolveHostAdapterScope, writeGrokPluginRegistration,
  syncGrokPluginInstallation, syncGrokWorkspacePluginInstallation,
  uninstallGrokPluginInstallation,
  retireWorkspaceProjectHostManifest,
  resolveTenantSelection, shouldIncludeInstructionFile
})

// ─── Codex init ───────────────────────────────────────────────────────────────

// ─── Profile bootstrap (v1.9.2+) ──────────────────────────────────────────────

function inspectProfileState(profileDir) {
  let availableFiles = []
  try { availableFiles = fs.readdirSync(profileDir).filter(file => fs.statSync(path.join(profileDir, file)).isFile()) } catch { }
  const documents = Object.fromEntries(availableFiles.filter(file => file.endsWith('.md')).map(file => {
    try { return [file, fs.readFileSync(path.join(profileDir, file), 'utf8')] } catch { return [file, ''] }
  }))
  const corpus = Object.values(documents).join('\n')
  let tier = 'profile-lite'
  let error = null
  try { tier = detectProfileTier(corpus) } catch (err) { error = err.message }
  const state = inspectProfileContract(tier, availableFiles, corpus, documents)
  const configExists = fs.existsSync(path.join(profileDir, 'config.json'))
  return { ...state, complete: !error && state.complete, configExists, error }
}

const { cmdStatus, cmdProfileInit, cmdDoctor, cmdHelp } = buildCliMaintenanceCommands({
  fs, os, path, process, console, c, SOURCES, CODEX_HOOK_COMMAND,
  walkDir, isSourceRepo, resolveActiveRuntimeRoot, resolveProfileDir, getLegacyCounts,
  getCodexConfigState, inspectProfileState, detectProfileTier,
  inspectProfileContract, normalizeProfileTier, filesForProfileTier,
  compareProfileTiers, updateProfileTierDeclaration,
  readJsonSafe, safeFirstLine, detectArch, listTopDirs, detectStyle,
  genProfileReadme, genProjectInfo, genArchitecture, genStyle, genTestSpec,
  genReleaseSpec, genFeatureInventory, genUserContractSpec, genConfigJson,
  recommendProfileTier,
  detectAgent, detectHostPlatform, detectInstalledHostAssets, inspectHostInstructionSurfaces,
  resolveHostAdapterScope, grokUserConfigPath
})
const { cmdProbe, cmdTrace } = buildCliObservabilityCommands({
  fs, process, console, c, resolveProfileDir, inspectProfileState, detectHostPlatform, detectInstalledHostAssets
})
const { cmdSkill, cmdTask } = buildCliExecutionCommands({ process, console, c })
function cmdGrok(argv) {
  try {
    const result = launchGrok(argv, { cwd: process.cwd() })
    process.exitCode = result.status
    return result
  } catch (error) {
    console.error(c.red(`  ${error.code || 'GROK_LAUNCHER_FAILED'}: ${error.message}`))
    process.exitCode = 2
    return null
  }
}

const cliCommandRegistry = createCliCommandRegistry({
  cmdInitWorkspaceRuntime, cmdInitHost, cmdUninstallHost, cmdGrok, cmdStatus, cmdProfileInit, cmdDoctor, cmdProbe, cmdTrace, cmdSkill, cmdTask, cmdHelp
})

if (require.main === module) {
  const [, , cmd, ...argv] = process.argv
  runCliCommand({ cmd, argv, registry: cliCommandRegistry, runMigrateLayout, process, c, console, packageVersion: readJsonFile(path.join(PKG_ROOT, 'package.json'))?.version || null })
}

module.exports = {
  walkDir, cmdInitWorkspaceRuntime, cmdInitHost,
  cmdUninstallHost, cmdGrok, cmdStatus, cmdHelp, cmdProfileInit, cmdDoctor, cmdProbe, cmdTrace,
  cmdSkill, cmdTask, isSourceRepo, findLayoutInfo, inferProjectFromCwd, resolveActiveRuntimeRoot,
  resolveHostAdapterScope, resolveGitignoreRoot, ensureRuntimeDirs, SOURCES, CLAUDE_SOURCES,
  CLAUDE_MCP_RUNTIME_SCRIPT_DEPS, CODEX_SOURCES, CLAUDE_HOOK_COMMAND, CLAUDE_MCP_JSON,
  CODEX_HOOK_COMMAND, buildDeploymentDescriptors, beginManagedDeployment, finishManagedDeployment,
  runMigrateLayout
}
