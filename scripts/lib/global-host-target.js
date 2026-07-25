'use strict'

const os = require('os')
const fs = require('fs')
const path = require('path')

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

function resolveGlobalSharedTarget(home, env = process.env) {
  const root = path.resolve(env.DEVCODEX_GLOBAL_SHARED_ROOT || path.join(home, '.agents'))
  return {
    root,
    skills: path.resolve(env.DEVCODEX_GLOBAL_SKILLS_ROOT || path.join(root, 'skills')),
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
  const home = resolveHome({ ...options, env })
  const root = hostRoot(normalized, home, env)
  const shared = resolveGlobalSharedTarget(home, env)
  const common = {
    schemaVersion: GLOBAL_HOST_TARGET_SCHEMA,
    host: normalized,
    home,
    root,
    shared,
    runtimeRoot: path.join(root, 'devcodex', 'runtime'),
    receiptFile: path.join(root, 'devcodex', 'global-host-receipt.json'),
    additionalRoots: [shared.root],
    additionalFiles: []
  }

  if (normalized === 'copilot') {
    return assertTargetBoundary({
      ...common,
      support: 'contract-fixture',
      evidenceCeiling: 'Copilot CLI user instructions, Hooks, MCP, and Skills; direct CLI execution is environment-dependent',
      files: {
        instructions: path.join(root, 'copilot-instructions.md'),
        hooks: path.join(root, 'hooks', 'devcodex.json'),
        mcp: path.join(root, 'mcp-config.json'),
        skills: path.join(root, 'skills')
      }
    })
  }
  if (normalized === 'claude') {
    const mcpConfig = env.CLAUDE_CONFIG_DIR
      ? path.join(root, '.claude.json')
      : path.join(home, '.claude.json')
    return assertTargetBoundary({
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
    return assertTargetBoundary({
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
    return assertTargetBoundary({
      ...common,
      support: 'contract-fixture',
      evidenceCeiling: 'Gemini user settings contract; direct binary probe is environment-dependent',
      files: {
        instructions: path.join(root, 'GEMINI.md'),
        settings: path.join(root, 'settings.json')
      }
    })
  }
  return assertTargetBoundary({
    ...common,
    support: 'direct-probe',
    evidenceCeiling: 'Grok user plugin/config plus global launcher',
    files: {
      config: path.join(root, 'config.toml'),
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
  samePath,
  targetAcceptsPath
}
