'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveGlobalHostTarget } = require('./global-host-target.js')
const {
  findLayoutInfo,
  inferProjectFromCwd
} = require('../../hooks/_runtime/workspace-layout.cjs')
const {
  bootstrapSkillRouteForTurn
} = require('../../hooks/_runtime/skill-route-tool.cjs')

const GROK_ROUTE_CONTEXT_EPOCH_RE = /^ctx-[A-Za-z0-9-]{8,251}$/
const GROK_ROUTE_PROMPT_MAX_BYTES = 256 * 1024

function getGrokLauncherAdapterDigest(options = {}) {
  const fsImpl = options.fs || fs
  const files = [
    path.resolve(options.launcherPath || __filename),
    path.resolve(options.globalHostTargetPath || path.join(__dirname, 'global-host-target.js'))
  ]
  return crypto.createHash('sha256').update(JSON.stringify(
    files.map(file => ({
      name: path.basename(file),
      digest: crypto.createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex')
    }))
  )).digest('hex')
}

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

function extractSinglePrompt(argv = [], cwd = process.cwd()) {
  const readPromptFile = file => {
    try {
      const target = path.resolve(cwd, file)
      const stat = fs.statSync(target)
      if (!stat.isFile() || stat.size > GROK_ROUTE_PROMPT_MAX_BYTES) return ''
      return fs.readFileSync(target, 'utf8')
    } catch {
      return ''
    }
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index])
    if (arg === '-p' || arg === '--single') return String(argv[index + 1] || '')
    if (arg.startsWith('--single=')) return arg.slice('--single='.length)
    if (arg === '--prompt-file') {
      const file = argv[index + 1]
      if (!file) return ''
      return readPromptFile(file)
    }
    if (arg.startsWith('--prompt-file=')) {
      return readPromptFile(arg.slice('--prompt-file='.length))
    }
  }
  return ''
}

function buildGrokLaunchPlan(argv = [], options = {}) {
  const env = options.env || process.env
  const invocationCwd = path.resolve(options.cwd || process.cwd())
  const parsed = collectExtraRules(argv)
  const cwd = parsed.requestedCwd ? path.resolve(invocationCwd, parsed.requestedCwd) : invocationCwd
  const globalTarget = resolveGlobalHostTarget('grok', {
    env: options.globalHostEnv || env,
    home: options.home
  })
  const workspaceRoot = findWorkspaceRoot(cwd)
  const nestedGitRoot = workspaceRoot ? findNestedGitRoot(cwd, workspaceRoot) : null
  const kernelPath = path.join(globalTarget.runtimeRoot, 'AGENTS.md')
  if (!fs.existsSync(kernelPath)) {
    const error = new Error(`GROK_GLOBAL_ADAPTER_MISSING: ${kernelPath}; run npm install -g devcodex`)
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

function prepareGrokSingleTurnSkillRoute(plan, argv = [], options = {}) {
  const prompt = extractSinglePrompt(argv, plan.cwd)
  if (!prompt) {
    return {
      plan,
      env: { ...(options.env || {}) },
      outcome: null
    }
  }
  const env = {
    ...process.env,
    ...(options.env || {})
  }
  const layout = findLayoutInfo(plan.cwd)
  const project = inferProjectFromCwd(plan.cwd, layout)
  const requestedContextEpoch = String(env.DEVCODEX_CONTEXT_EPOCH || '').trim()
  const contextEpoch = GROK_ROUTE_CONTEXT_EPOCH_RE.test(requestedContextEpoch)
    ? requestedContextEpoch
    : `ctx-${crypto.randomUUID()}`
  const routeEnv = {
    ...env,
    DEVCODEX_AGENT: 'grok-cli-single',
    DEVCODEX_HOST_PLATFORM: 'grok',
    DEVCODEX_CONTEXT_EPOCH: contextEpoch,
    DEVCODEX_GROK_SINGLE_TURN: '1'
  }
  const hostAdapterDigest = getGrokLauncherAdapterDigest()
  let outcome = null
  if (project) {
    try {
      outcome = bootstrapSkillRouteForTurn({
        project,
        contextEpoch,
        prompt,
        host: 'grok-cli-single',
        cwd: plan.cwd
      }, {
        inputRoot: plan.cwd,
        env: routeEnv,
        hostAdapterDigest
      })
    } catch (error) {
      outcome = {
        schemaVersion: 'SkillRouteBootstrapOutcomeV1',
        active: false,
        bootstrap: null,
        injectionText: '',
        errorCode: String(error.code || error.message || 'SKILL_ROUTE_BOOTSTRAP_FAILED')
      }
    }
  }
  if (outcome?.active && outcome.injectionText) {
    const rulesIndex = plan.args.indexOf('--rules')
    if (rulesIndex >= 0 && typeof plan.args[rulesIndex + 1] === 'string') {
      plan.args[rulesIndex + 1] = [
        plan.args[rulesIndex + 1],
        'DevCodex Grok single-turn progressive Skill route:',
        outcome.injectionText
      ].join('\n\n')
    }
  }
  plan.skillRoute = {
    schemaVersion: 'GrokSingleTurnSkillRouteLaunchV1',
    project: project || null,
    contextEpoch,
    active: outcome?.active === true,
    modeReceipt: outcome?.modeReceipt || null,
    bootstrap: outcome?.bootstrap || null,
    injectionBytes: Buffer.byteLength(outcome?.injectionText || '', 'utf8'),
    hostAdapterDigest,
    errorCode: outcome?.errorCode || null
  }
  return { plan, env: routeEnv, outcome }
}

function launchGrok(argv = [], options = {}) {
  const basePlan = buildGrokLaunchPlan(argv, options)
  const prepared = prepareGrokSingleTurnSkillRoute(basePlan, argv, options)
  const plan = prepared.plan
  const runner = options.spawnSync || spawnSync
  const result = runner(plan.executable, plan.args, {
    cwd: plan.cwd,
    stdio: options.stdio || 'inherit',
    windowsHide: false,
    env: {
      ...process.env,
      ...(options.env || {}),
      ...prepared.env,
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
  GROK_ROUTE_CONTEXT_EPOCH_RE,
  GROK_ROUTE_PROMPT_MAX_BYTES,
  getGrokLauncherAdapterDigest,
  buildGrokLaunchPlan,
  extractSinglePrompt,
  prepareGrokSingleTurnSkillRoute,
  collectExtraRules,
  findNestedGitRoot,
  findWorkspaceRoot,
  launchGrok
}
