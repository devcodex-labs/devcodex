'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveGlobalHostTarget } = require('./global-host-target.js')

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function findNestedGitRoot(cwd, workspaceRoot) {
  let current = path.resolve(cwd)
  const boundary = path.resolve(workspaceRoot)
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return samePath(current, boundary) ? null : current
    if (samePath(current, boundary)) return null
    const parent = path.dirname(current)
    if (parent === current) return null
    const relative = path.relative(boundary, parent)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    current = parent
  }
}

function findWorkspaceRoot(start) {
  let current = path.resolve(start)
  while (true) {
    if (fs.existsSync(path.join(current, '.devcodex'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function collectExtraRules(argv) {
  const forwarded = []
  const extraRules = []
  let requestedCwd = null
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (
      arg === '--system-prompt-override' ||
      arg === '--system-prompt' ||
      arg.startsWith('--system-prompt-override=') ||
      arg.startsWith('--system-prompt=')
    ) {
      const error = new Error('GROK_LAUNCHER_SYSTEM_OVERRIDE_CONFLICT: DevCodex launcher cannot guarantee the controlling kernel with a system prompt override')
      error.code = 'GROK_LAUNCHER_SYSTEM_OVERRIDE_CONFLICT'
      throw error
    }
    if (arg === '--cwd' || arg.startsWith('--cwd=')) {
      const value = arg === '--cwd' ? argv[++index] : arg.slice('--cwd='.length)
      if (!value) {
        const error = new Error('GROK_LAUNCHER_CWD_VALUE_MISSING')
        error.code = 'GROK_LAUNCHER_CWD_VALUE_MISSING'
        throw error
      }
      if (requestedCwd !== null) {
        const error = new Error('GROK_LAUNCHER_CWD_CONFLICT: --cwd is non-repeatable')
        error.code = 'GROK_LAUNCHER_CWD_CONFLICT'
        throw error
      }
      requestedCwd = String(value)
      continue
    }
    if (arg === '--rules') {
      const value = argv[index + 1]
      if (value === undefined) {
        const error = new Error('GROK_LAUNCHER_RULES_VALUE_MISSING')
        error.code = 'GROK_LAUNCHER_RULES_VALUE_MISSING'
        throw error
      }
      extraRules.push(String(value))
      index++
      continue
    }
    if (arg.startsWith('--rules=')) {
      extraRules.push(arg.slice('--rules='.length))
      continue
    }
    forwarded.push(arg)
  }
  return { forwarded, extraRules, requestedCwd }
}

function buildGrokLaunchPlan(argv = [], options = {}) {
  const env = options.env || process.env
  const invocationCwd = path.resolve(options.cwd || process.cwd())
  const parsed = collectExtraRules(argv)
  const cwd = parsed.requestedCwd ? path.resolve(invocationCwd, parsed.requestedCwd) : invocationCwd
  const globalTarget = resolveGlobalHostTarget('grok', {
    env,
    home: options.home
  })
  const workspaceRoot = findWorkspaceRoot(cwd)
  const nestedGitRoot = workspaceRoot ? findNestedGitRoot(cwd, workspaceRoot) : null
  const kernelPath = path.join(globalTarget.runtimeRoot, 'AGENTS.md')
  if (!fs.existsSync(kernelPath)) {
    const error = new Error(`GROK_GLOBAL_ADAPTER_MISSING: ${kernelPath}; run npm install -g @devcodex/devcodex`)
    error.code = 'GROK_GLOBAL_ADAPTER_MISSING'
    throw error
  }
  const kernel = fs.readFileSync(kernelPath, 'utf8')
  const combinedRules = [
    `DevCodex user-global controlling kernel follows. Workspace runtime state remains under .devcodex.\n\n${kernel}`,
    ...parsed.extraRules
  ].filter(Boolean).join('\n\n')
  const grokArgs = ['--rules', combinedRules, ...parsed.forwarded]
  const hostScope = {
    schemaVersion: 'GlobalGrokHostScopeV1',
    scope: 'user-global',
    ownerRoot: globalTarget.root,
    workspaceRoot,
    project: workspaceRoot && nestedGitRoot ? path.basename(nestedGitRoot) : null,
    pluginRoot: globalTarget.files.plugin
  }
  return {
    schemaVersion: 'GrokGlobalLaunchPlanV1',
    invocationCwd,
    cwd,
    hostScope,
    nestedGitRoot,
    kernelRequired: true,
    kernelPath,
    kernelDigest: crypto.createHash('sha256').update(kernel).digest('hex'),
    evidenceMode: 'global-launcher-rules',
    executable: options.executable || 'grok',
    args: grokArgs
  }
}

function launchGrok(argv = [], options = {}) {
  const plan = buildGrokLaunchPlan(argv, options)
  const runner = options.spawnSync || spawnSync
  const result = runner(plan.executable, plan.args, {
    cwd: plan.cwd,
    stdio: options.stdio || 'inherit',
    windowsHide: false,
    env: {
      ...process.env,
      ...(options.env || {}),
      GROK_HOME: plan.hostScope.ownerRoot,
      DEVCODEX_GROK_EVIDENCE_MODE: plan.evidenceMode,
      ...(plan.hostScope.workspaceRoot ? { DEVCODEX_WORKSPACE_ROOT: plan.hostScope.workspaceRoot } : {}),
      ...(plan.hostScope.project ? { DEVCODEX_PROJECT: plan.hostScope.project } : {})
    }
  })
  if (result.error) throw result.error
  return { plan, status: Number.isInteger(result.status) ? result.status : 1, signal: result.signal || null }
}

module.exports = {
  buildGrokLaunchPlan,
  collectExtraRules,
  findNestedGitRoot,
  findWorkspaceRoot,
  launchGrok
}
