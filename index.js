#!/usr/bin/env node
/**
 * DevCodex CLI – npx devcodex <command>
 *
 * Commands:
 *   init    Copy all DevCodex files into your project's .github/ directory
 *   update  Overwrite installed files with the latest version from the package
 *   status  Show what DevCodex files are installed in the current project
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
const { resolveTenantSelection, shouldIncludeInstructionFile } = require('./scripts/lib/tenant-selection.js')
const { createDeploymentSession, writeManifestAtomic } = require('./scripts/lib/deployment-manifest-utils.js')
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

// ─── Tiny ANSI helpers ────────────────────────────────────────────────────────
const c = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Walk a directory recursively, return all file paths */
function walkDir(dir) {
  if (!fs.existsSync(dir)) return []
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walkDir(full))
    else results.push(full)
  }
  return results
}

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

const CODEX_SOURCES = [
  { from: 'skills', to: path.join('.agents', 'skills') },
  { from: 'hooks/_runtime', to: path.join('.codex', 'hooks', '_runtime') },
  { from: 'codex', to: '.codex' },
]

const { buildDeploymentDescriptors: buildDeploymentDescriptorsImpl } = require('./scripts/lib/deployment-descriptors.js')

function buildDeploymentDescriptors(surfaces, { tenantId = null } = {}) {
  return buildDeploymentDescriptorsImpl(PKG_ROOT, surfaces, {
    SOURCES, CLAUDE_SOURCES, CODEX_SOURCES, tenantId
  })
}

function beginManagedDeployment(cwd, surfaces, { tenantId = null } = {}) {
  const runtimeRoot = resolveActiveRuntimeRoot(cwd)
  const manifestFile = path.join(runtimeRoot, 'managed', 'deployment-manifest.json')
  const packageJson = readJsonFile(path.join(PKG_ROOT, 'package.json')) || {}
  const session = createDeploymentSession({
    packageRoot: PKG_ROOT,
    targetRoot: cwd,
    manifestFile,
    descriptors: buildDeploymentDescriptors(surfaces, { tenantId }),
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

// v1.9.8+: agents/ 已恢复 Copilot 端默认分发（Q1），不再视为遗留物。
// 保留此数组结构以便后续可重新引入其他遗留迁移项。
const LEGACY_TARGETS = []

// ─── Source repo self-detection ───────────────────────────────────────────────

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

// ─── Commands ─────────────────────────────────────────────────────────────────

// ─── Claude Code init ─────────────────────────────────────────────────────────

/**
 * Hook command: locate .claude/hooks/_runtime/lifecycle.cjs by walking up from cwd.
 * Why: settings.json may live at workspace root while Claude Code runs in a project subdir.
 * v1.9.7+ monorepo-safe: requires lifecycle.cjs AND a project-root marker (.devcodex/ or
 * package.json) to coexist at the same level, otherwise keeps walking. Prevents false hits
 * on ancestor .claude/ directories that belong to a different (outer) workspace.
 * Silently exits if no DevCodex install is found.
 */
const CLAUDE_HOOK_COMMAND = `node -e "let d=process.cwd(),fs=require('fs'),p=require('path');while(true){const f=p.join(d,'.claude','hooks','_runtime','lifecycle.cjs');if(fs.existsSync(f)&&(fs.existsSync(p.join(d,'.devcodex'))||fs.existsSync(p.join(d,'package.json')))){require(f);break}const n=p.dirname(d);if(n===d){process.exit(0)}d=n}"`

// Monorepo-safe: walk up for .codex/hooks/_runtime/lifecycle.cjs with project marker (parity with Claude).
const CODEX_HOOK_COMMAND = `node -e "let d=process.cwd(),fs=require('fs'),p=require('path');while(true){const f=p.join(d,'.codex','hooks','_runtime','lifecycle.cjs');if(fs.existsSync(f)&&(fs.existsSync(p.join(d,'.devcodex'))||fs.existsSync(p.join(d,'package.json')))){require(f);break}const n=p.dirname(d);if(n===d){process.exit(0)}d=n}"`

function getCodexConfigState(cwd) {
  const userConfig = path.join(os.homedir(), '.codex', 'config.toml')
  const workspaceConfig = path.join(cwd, '.codex', 'config.toml')
  return {
    userConfig,
    workspaceConfig,
    hasUserConfig: fs.existsSync(userConfig),
    hasWorkspaceConfig: fs.existsSync(workspaceConfig),
  }
}

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
  detectInstalledHostAssets,
  detectHostPlatform
} = buildCliHostUtils({
  fs,
  path,
  isPlainObject,
  claudeMcpJson: CLAUDE_MCP_JSON
})

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

const { cmdInit, cmdInitClaude, cmdInitCodex } = buildCliInstallCommands({
  fs, path, process, console, c, PKG_ROOT, SOURCES, CLAUDE_SOURCES,
  CODEX_SOURCES, CLAUDE_SETTINGS_HOOKS, CLAUDE_SETTINGS_PERMISSIONS,
  CLAUDE_MCP_JSON, CODEX_HOOK_COMMAND, isSourceRepo, beginManagedDeployment,
  finishManagedDeployment, copyManagedTextFile, readJsonFileWithStatus,
  writeManagedJsonFile, normalizeStringArray, mergeUniqueStringArrays,
  mergeClaudeHooks, mergeClaudeMcpConfig,
  ensureRuntimeDirs, ensureDevCodexGitignore, walkDir,
  resolveActiveRuntimeRoot, resolveGitignoreRoot, getLegacyCounts, isPlainObject,
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
  detectAgent, detectHostPlatform, detectInstalledHostAssets
})
const { cmdProbe, cmdTrace } = buildCliObservabilityCommands({
  fs, process, console, c, resolveProfileDir, inspectProfileState, detectHostPlatform, detectInstalledHostAssets
})
const { cmdTask } = buildCliExecutionCommands({ process, console, c })

const cliCommandRegistry = createCliCommandRegistry({
  cmdInit, cmdInitClaude, cmdInitCodex, cmdStatus, cmdProfileInit, cmdDoctor, cmdProbe, cmdTrace, cmdTask, cmdHelp
})

// ─── Entry point ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const [, , cmd, ...argv] = process.argv
  runCliCommand({ cmd, argv, registry: cliCommandRegistry, runMigrateLayout, process, c, console })
}

module.exports = {
  walkDir,
  cmdInit,
  cmdInitClaude,
  cmdInitCodex,
  cmdStatus,
  cmdHelp,
  cmdProfileInit,
  cmdDoctor,
  cmdProbe,
  cmdTrace,
  cmdTask,
  isSourceRepo,
  findLayoutInfo,
  inferProjectFromCwd,
  resolveActiveRuntimeRoot,
  resolveGitignoreRoot,
  ensureRuntimeDirs,
  SOURCES,
  CLAUDE_SOURCES,
  CODEX_SOURCES,
  CLAUDE_HOOK_COMMAND,
  CODEX_HOOK_COMMAND,
  buildDeploymentDescriptors,
  beginManagedDeployment,
  finishManagedDeployment,
  runMigrateLayout
}
