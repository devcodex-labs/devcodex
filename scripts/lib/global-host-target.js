'use strict'

const os = require('os')
const fs = require('fs')
const path = require('path')
const {
  buildRuntimeGeneration,
  runtimeGenerationDirectoryName
} = require('./runtime-generation.js')

const GLOBAL_HOST_TARGET_SCHEMA = 'GlobalHostTargetV1'
const GLOBAL_HOST_IDS = Object.freeze(['copilot', 'claude', 'codex', 'gemini', 'grok'])

function resolveHome(options = {}) {
  const env = options.env || process.env
  const explicit = options.home || env.DEVCODEX_TEST_HOME
  return path.resolve(explicit || env.USERPROFILE || env.HOME || os.homedir())
}

function hostRoot(host, home, env) {
  if (host === 'copilot') return path.resolve(env.COPILOT_HOME || path.join(home, '.copilot'))
  if (host === 'claude') return path.resolve(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'))
  if (host === 'codex') return path.resolve(env.CODEX_HOME || path.join(home, '.codex'))
  if (host === 'gemini') {
    const geminiHome = env.GEMINI_CLI_HOME ? path.resolve(env.GEMINI_CLI_HOME) : home
    return path.resolve(path.join(geminiHome, '.gemini'))
  }
  if (host === 'grok') return path.resolve(env.GROK_HOME || path.join(home, '.grok'))
  throw new Error(`GLOBAL_HOST_UNSUPPORTED: ${host}`)
}

/**
 * VS Code user-profile MCP config (global, all workspaces).
 * Prefer paths under the resolved home so tests with a temp home never touch real APPDATA.
 * Override: DEVCODEX_VSCODE_MCP_PATH (single file) or DEVCODEX_VSCODE_USER_DIR.
 */
function resolveVscodeAppDataRoot (home, env = process.env) {
  const homeAbs = path.resolve(home)
  if (process.platform === 'win32') {
    const appData = env.APPDATA && isUnder(homeAbs, env.APPDATA)
      ? path.resolve(env.APPDATA)
      : path.join(homeAbs, 'AppData', 'Roaming')
    return appData
  }
  if (process.platform === 'darwin') {
    return path.join(homeAbs, 'Library', 'Application Support')
  }
  const xdg = env.XDG_CONFIG_HOME && isUnder(homeAbs, env.XDG_CONFIG_HOME)
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(homeAbs, '.config')
  return xdg
}

function resolveVscodeUserMcpPaths (home, env = process.env, fsImpl = fs) {
  if (env.DEVCODEX_VSCODE_MCP_PATH) {
    return [path.resolve(env.DEVCODEX_VSCODE_MCP_PATH)]
  }
  if (env.DEVCODEX_VSCODE_USER_DIR) {
    return [path.join(path.resolve(env.DEVCODEX_VSCODE_USER_DIR), 'mcp.json')]
  }
  const appData = resolveVscodeAppDataRoot(home, env)
  const paths = [path.join(appData, 'Code', 'User', 'mcp.json')]
  // Also refresh Insiders when that product tree already exists (do not create product shell only for us)
  const insidersUser = path.join(appData, 'Code - Insiders', 'User')
  if (fsImpl.existsSync(path.join(appData, 'Code - Insiders')) || fsImpl.existsSync(insidersUser)) {
    paths.push(path.join(insidersUser, 'mcp.json'))
  }
  return paths
}

function resolveGlobalSharedTarget(home, env = process.env) {
  const root = path.resolve(env.DEVCODEX_GLOBAL_SHARED_ROOT || path.join(home, '.agents'))
  // SCAN root (host L1). Optional DEVCODEX_GLOBAL_SKILLS_ROOT still overrides scan path for legacy tests.
  const skills = path.resolve(env.DEVCODEX_GLOBAL_SKILLS_ROOT || path.join(root, 'skills'))
  // G_RUNTIME — non-scan managed tree for skillsDeployMode=hidden
  const skillsRuntime = path.resolve(
    env.DEVCODEX_GLOBAL_SKILLS_RUNTIME || path.join(root, 'devcodex', 'skills')
  )
  return {
    root,
    skills,
    skillsRuntime,
    fullFallback: path.resolve(env.DEVCODEX_GLOBAL_FULL_FALLBACK || path.join(root, 'devcodex', 'instructions.full.md'))
  }
}

function isUnder(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function realpathSyncSafe(fsImpl, targetPath) {
  const realpathSync = fsImpl.realpathSync && (fsImpl.realpathSync.native || fsImpl.realpathSync)
  if (!realpathSync) return path.resolve(targetPath)
  return path.resolve(realpathSync.call(fsImpl.realpathSync, targetPath))
}

function realpathExistingPrefix(targetPath, fsImpl = fs) {
  const resolved = path.resolve(targetPath)
  const missingParts = []
  let cursor = resolved
  while (!fsImpl.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) return resolved
    missingParts.unshift(path.basename(cursor))
    cursor = parent
  }
  return path.resolve(realpathSyncSafe(fsImpl, cursor), ...missingParts)
}

function isUnderPhysical(root, target, fsImpl = fs) {
  return isUnder(realpathExistingPrefix(root, fsImpl), realpathExistingPrefix(target, fsImpl))
}

function samePath(left, right) {
  const first = path.resolve(left)
  const second = path.resolve(right)
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second
}

function targetAcceptsPath(target, file, fsImpl = fs) {
  const acceptedRoots = [target.root, ...(target.additionalRoots || [])]
  const acceptedFiles = target.additionalFiles || []
  return acceptedRoots.some(root => isUnderPhysical(root, file, fsImpl)) ||
    acceptedFiles.some(accepted => samePath(accepted, file))
}

function assertTargetBoundary(target, fsImpl = fs) {
  const owned = [
    target.runtimeRoot,
    target.receiptFile,
    ...Object.values(target.files || {}).filter(Boolean),
    ...Object.values(target.shared || {}).filter(Boolean)
  ]
  for (const file of owned) {
    if (!targetAcceptsPath(target, file, fsImpl)) {
      const error = new Error(`GLOBAL_HOST_TARGET_ESCAPE: ${target.host} -> ${file}`)
      error.code = 'GLOBAL_HOST_TARGET_ESCAPE'
      throw error
    }
  }
  return target
}

function resolveGlobalHostTarget(host, options = {}) {
  const normalized = String(host || '').trim().toLowerCase()
  if (!GLOBAL_HOST_IDS.includes(normalized)) {
    const error = new Error(`GLOBAL_HOST_UNSUPPORTED: ${normalized || '(empty)'}`)
    error.code = 'GLOBAL_HOST_UNSUPPORTED'
    throw error
  }

  const env = options.env || process.env
  const fsImpl = options.fs || fs
  const home = resolveHome({ ...options, env })
  const root = hostRoot(normalized, home, env)
  const shared = resolveGlobalSharedTarget(home, env)
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const runtimeGeneration = options.runtimeGeneration === false
    ? null
    : (options.runtimeGeneration || buildRuntimeGeneration(packageRoot, fsImpl))
  const finalizeTarget = target => assertTargetBoundary(target, fsImpl)
  const runtimeBaseRoot = path.join(root, 'devcodex')
  const common = {
    schemaVersion: GLOBAL_HOST_TARGET_SCHEMA,
    host: normalized,
    home,
    root,
    shared,
    runtimeBaseRoot,
    runtimeGeneration,
    runtimeRoot: runtimeGeneration
      ? path.join(runtimeBaseRoot, runtimeGenerationDirectoryName(runtimeGeneration))
      : path.join(runtimeBaseRoot, 'runtime'),
    receiptFile: path.join(root, 'devcodex', 'global-host-receipt.json'),
    additionalRoots: [shared.root],
    additionalFiles: []
  }

  if (normalized === 'copilot') {
    const vscodeMcpPaths = resolveVscodeUserMcpPaths(home, env)
    const vscodeUserDirs = [...new Set(vscodeMcpPaths.map(file => path.dirname(file)))]
    return finalizeTarget({
      ...common,
      support: 'contract-fixture',
      evidenceCeiling: 'Copilot CLI user instructions, Hooks, MCP, and Skills; VS Code user mcp.json is co-refreshed with apply',
      files: {
        instructions: path.join(root, 'copilot-instructions.md'),
        hooks: path.join(root, 'hooks', 'devcodex.json'),
        mcp: path.join(root, 'mcp-config.json'),
        skills: path.join(root, 'skills'),
        // Primary VS Code User MCP (first path); extras go via additionalFiles
        vscodeMcp: vscodeMcpPaths[0]
      },
      additionalRoots: [shared.root, ...vscodeUserDirs],
      additionalFiles: vscodeMcpPaths.slice(1)
    })
  }
  if (normalized === 'claude') {
    const mcpConfig = env.CLAUDE_CONFIG_DIR
      ? path.join(root, '.claude.json')
      : path.join(home, '.claude.json')
    return finalizeTarget({
      ...common,
      support: 'contract-fixture',
      evidenceCeiling: 'user settings and MCP contract; direct Claude binary probe is environment-dependent',
      files: {
        instructions: path.join(root, 'CLAUDE.md'),
        settings: path.join(root, 'settings.json'),
        mcp: mcpConfig
      },
      additionalFiles: env.CLAUDE_CONFIG_DIR ? [] : [mcpConfig]
    })
  }
  if (normalized === 'codex') {
    return finalizeTarget({
      ...common,
      support: 'direct-probe',
      evidenceCeiling: 'Codex CLI/app user configuration and global instruction projection',
      files: {
        instructions: path.join(root, 'AGENTS.md'),
        hooks: path.join(root, 'hooks.json'),
        config: path.join(root, 'config.toml'),
        skills: shared.skills
      }
    })
  }
  if (normalized === 'gemini') {
    return finalizeTarget({
      ...common,
      support: 'contract-fixture',
      evidenceCeiling: 'Gemini user settings contract; direct binary probe is environment-dependent',
      files: {
        instructions: path.join(root, 'GEMINI.md'),
        settings: path.join(root, 'settings.json')
      }
    })
  }
  return finalizeTarget({
    ...common,
    support: 'direct-probe',
    evidenceCeiling: 'Grok user plugin/config plus global launcher',
    files: {
      config: path.join(root, 'config.toml'),
      hooks: path.join(root, 'hooks', 'devcodex.json'),
      plugin: path.join(root, 'devcodex', 'plugins', 'devcodex-workspace')
    }
  })
}

function resolveGlobalHostTargets(options = {}) {
  const hosts = options.hosts || GLOBAL_HOST_IDS
  return hosts.map(host => resolveGlobalHostTarget(host, options))
}

module.exports = {
  GLOBAL_HOST_IDS,
  GLOBAL_HOST_TARGET_SCHEMA,
  assertTargetBoundary,
  isUnder,
  isUnderPhysical,
  realpathExistingPrefix,
  resolveGlobalSharedTarget,
  resolveGlobalHostTarget,
  resolveGlobalHostTargets,
  resolveHome,
  resolveVscodeAppDataRoot,
  resolveVscodeUserMcpPaths,
  samePath,
  targetAcceptsPath
}
