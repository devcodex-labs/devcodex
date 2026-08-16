'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveGlobalHostTarget } = require('./global-host-target.js')
const { buildGrokCliEnv } = require('./grok-cli-env.js')
const {
  findLayoutInfo,
  inferProjectFromCwd
} = require('../../hooks/_runtime/workspace-layout.cjs')
const {
  bootstrapSkillRouteForTurn
} = require('../../hooks/_runtime/skill-route-tool.cjs')
const {
  buildPrivateTempOwnerRecord,
  classifyPrivateTempRecovery,
  validatePrivateTempOwnerRecord
} = require('../../grok/plugins/devcodex-workspace/lib/private-temp-contract.cjs')

const GROK_ROUTE_CONTEXT_EPOCH_RE = /^ctx-[A-Za-z0-9-]{8,251}$/
const GROK_ROUTE_PROMPT_MAX_BYTES = 256 * 1024
const GROK_PROMPT_SNAPSHOT_TTL_MS = 60 * 60 * 1000
const GROK_PROMPT_RECOVERY_SCAN_LIMIT = 128
const GROK_MCP_TOOL_NAMES = Object.freeze({
  profileContextPlan: 'devcodex-profile__profile_context_plan',
  profileLoad: 'devcodex-profile__profile_load',
  skillRoute: 'devcodex-profile__skill_route',
  memoryStatus: 'devcodex-memory__memory_status'
})
const GROK_MCP_TOOL_CONTRACT = [
  'DevCodex Grok MCP tool namespace contract:',
  `- Context plan: ${GROK_MCP_TOOL_NAMES.profileContextPlan}`,
  `- Profile body: ${GROK_MCP_TOOL_NAMES.profileLoad}`,
  `- Progressive Skill route: ${GROK_MCP_TOOL_NAMES.skillRoute}`,
  `- Bounded memory status: ${GROK_MCP_TOOL_NAMES.memoryStatus}`,
  '- Use these exact server-qualified names. Do not call unqualified names or another host\'s mcp__ aliases.',
  '- On the first skill_route catalog call, omit cursor entirely; add it only after a non-empty nextCursor is returned. Never send cursor:null.',
  '- skill_route has no replan operation. Activate a late condition with a second op="commit" call using previousPlanDigest, lateConditionId, and the fresh ContextReadBindingV1 before loading that conditional stage.'
].join('\n')

function getGrokLauncherAdapterDigest(options = {}) {
  const fsImpl = options.fs || fs
  const files = [
    path.resolve(options.launcherPath || __filename),
    path.resolve(options.globalHostTargetPath || path.join(__dirname, 'global-host-target.js')),
    path.resolve(options.grokCliEnvPath || path.join(__dirname, 'grok-cli-env.js')),
    path.resolve(options.privateTempContractPath || path.join(
      __dirname,
      '../../grok/plugins/devcodex-workspace/lib/private-temp-contract.cjs'
    ))
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

function isPathInside (root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function resolveGrokLaunchTarget (options, env) {
  const baseline = resolveGlobalHostTarget('grok', {
    env: options.globalHostEnv || env,
    home: options.home
  })
  const supplied = options.globalTarget
  if (!supplied) return baseline
  const invalid = message => {
    const error = new Error(`GROK_GLOBAL_TARGET_INVALID: ${message}`)
    error.code = 'GROK_GLOBAL_TARGET_INVALID'
    throw error
  }
  if (supplied.host !== 'grok') invalid('host must be grok')
  if (!supplied.root || !samePath(supplied.root, baseline.root)) {
    invalid('owner root does not match the requested HOME')
  }
  if (!supplied.runtimeRoot || !isPathInside(baseline.runtimeBaseRoot, supplied.runtimeRoot)) {
    invalid('runtime root escapes the managed Grok root')
  }
  return {
    ...baseline,
    runtimeRoot: path.resolve(supplied.runtimeRoot),
    runtimeGeneration: supplied.runtimeGeneration || baseline.runtimeGeneration
  }
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

function promptCarrierError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

function inspectSinglePromptCarrier(argv = [], cwd = process.cwd()) {
  const carriers = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index])
    if (arg === '-p' || arg === '--single') {
      if (argv[index + 1] === undefined) {
        throw promptCarrierError('GROK_PROMPT_CARRIER_VALUE_MISSING', `${arg} requires a prompt value`)
      }
      carriers.push({ kind: 'inline', index, valueIndex: index + 1, prompt: String(argv[index + 1]) })
      index++
      continue
    }
    if (arg.startsWith('--single=')) {
      carriers.push({ kind: 'inline-equals', index, valueIndex: null, prompt: arg.slice('--single='.length) })
      continue
    }
    if (arg === '--prompt-file') {
      const file = argv[index + 1]
      if (!file) throw promptCarrierError('GROK_PROMPT_CARRIER_VALUE_MISSING', '--prompt-file requires a file path')
      carriers.push({ kind: 'prompt-file', index, valueIndex: index + 1, file: String(file) })
      index++
      continue
    }
    if (arg.startsWith('--prompt-file=')) {
      const file = arg.slice('--prompt-file='.length)
      if (!file) throw promptCarrierError('GROK_PROMPT_CARRIER_VALUE_MISSING', '--prompt-file requires a file path')
      carriers.push({ kind: 'prompt-file-equals', index, valueIndex: null, file })
    }
  }
  if (carriers.length > 1) {
    throw promptCarrierError(
      'GROK_PROMPT_CARRIER_AMBIGUOUS',
      `exactly one single-turn prompt carrier is allowed, received ${carriers.length}`
    )
  }
  if (!carriers.length) return null
  const carrier = carriers[0]
  let buffer
  let sourcePath = null
  if (carrier.kind.startsWith('prompt-file')) {
    sourcePath = path.resolve(cwd, carrier.file)
    let stat
    try {
      stat = fs.statSync(sourcePath)
    } catch (error) {
      throw promptCarrierError('GROK_PROMPT_FILE_UNREADABLE', `${sourcePath}: ${error.code || error.message}`)
    }
    if (!stat.isFile()) throw promptCarrierError('GROK_PROMPT_FILE_NOT_REGULAR', sourcePath)
    if (stat.size > GROK_ROUTE_PROMPT_MAX_BYTES) {
      throw promptCarrierError('GROK_PROMPT_FILE_TOO_LARGE', `${sourcePath}: ${stat.size} bytes`)
    }
    try {
      buffer = fs.readFileSync(sourcePath)
    } catch (error) {
      throw promptCarrierError('GROK_PROMPT_FILE_UNREADABLE', `${sourcePath}: ${error.code || error.message}`)
    }
    if (buffer.length > GROK_ROUTE_PROMPT_MAX_BYTES) {
      throw promptCarrierError('GROK_PROMPT_FILE_TOO_LARGE', `${sourcePath}: ${buffer.length} bytes after read`)
    }
  } else {
    buffer = Buffer.from(carrier.prompt, 'utf8')
    if (buffer.length > GROK_ROUTE_PROMPT_MAX_BYTES) {
      throw promptCarrierError('GROK_PROMPT_TOO_LARGE', `${buffer.length} bytes`)
    }
  }
  const prompt = buffer.toString('utf8')
  if (!Buffer.from(prompt, 'utf8').equals(buffer)) {
    throw promptCarrierError('GROK_PROMPT_ENCODING_INVALID', 'prompt must be valid UTF-8')
  }
  if (buffer.length === 0) {
    throw promptCarrierError('GROK_PROMPT_EMPTY', 'single-turn prompt carrier must not be empty')
  }
  return {
    schemaVersion: 'GrokPromptCarrierV1',
    kind: carrier.kind,
    index: carrier.index,
    valueIndex: carrier.valueIndex,
    sourcePath,
    prompt,
    buffer,
    bytes: buffer.length,
    digest: crypto.createHash('sha256').update(buffer).digest('hex')
  }
}

function extractSinglePrompt(argv = [], cwd = process.cwd()) {
  return inspectSinglePromptCarrier(argv, cwd)?.prompt || ''
}

function buildGrokLaunchPlan(argv = [], options = {}) {
  const env = options.env || process.env
  const invocationCwd = path.resolve(options.cwd || process.cwd())
  const parsed = collectExtraRules(argv)
  const cwd = parsed.requestedCwd ? path.resolve(invocationCwd, parsed.requestedCwd) : invocationCwd
  const globalTarget = resolveGrokLaunchTarget(options, env)
  const workspaceRoot = findWorkspaceRoot(cwd)
  const nestedGitRoot = workspaceRoot ? findNestedGitRoot(cwd, workspaceRoot) : null
  const layout = findLayoutInfo(cwd)
  const canonicalProject = inferProjectFromCwd(cwd, layout) ||
    (workspaceRoot && nestedGitRoot ? path.basename(nestedGitRoot) : null)
  const kernelPath = path.join(globalTarget.runtimeRoot, 'AGENTS.md')
  if (!fs.existsSync(kernelPath)) {
    const error = new Error(`GROK_GLOBAL_ADAPTER_MISSING: ${kernelPath}; run npm install -g devcodex`)
    error.code = 'GROK_GLOBAL_ADAPTER_MISSING'
    throw error
  }
  const kernel = fs.readFileSync(kernelPath, 'utf8')
  const combinedRules = [
    `DevCodex user-global controlling kernel follows. Workspace runtime state remains under .devcodex.\n\n${kernel}`,
    ...parsed.extraRules,
    GROK_MCP_TOOL_CONTRACT
  ].filter(Boolean).join('\n\n')
  const grokArgs = ['--rules', combinedRules, ...parsed.forwarded]
  const hostScope = {
    schemaVersion: 'GlobalGrokHostScopeV1',
    scope: 'user-global',
    ownerRoot: globalTarget.root,
    workspaceRoot,
    project: canonicalProject,
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
  const promptCarrier = inspectSinglePromptCarrier(plan.args.slice(2), plan.cwd)
  const prompt = promptCarrier?.prompt || ''
  plan.promptCarrier = promptCarrier
    ? {
        schemaVersion: promptCarrier.schemaVersion,
        kind: promptCarrier.kind,
        sourcePath: promptCarrier.sourcePath,
        bytes: promptCarrier.bytes,
        digest: promptCarrier.digest,
        status: 'inspected',
        forwarding: promptCarrier.kind.startsWith('prompt-file') ? 'pending-snapshot' : 'inline'
      }
    : null
  if (!promptCarrier) {
    return {
      plan,
      env: { ...(options.env || {}) },
      outcome: null,
      promptCarrier: null
    }
  }
  const env = {
    ...process.env,
    ...(options.env || {})
  }
  const project = plan.hostScope.project || null
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
  const hostAdapterDigest = getGrokLauncherAdapterDigest(options)
  const bootstrap = options.bootstrapSkillRouteForTurn || bootstrapSkillRouteForTurn
  let outcome = null
  if (project) {
    try {
      outcome = bootstrap({
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
    promptDigest: promptCarrier.digest,
    promptCarrierKind: promptCarrier.kind,
    errorCode: outcome?.errorCode || null
  }
  return { plan, env: routeEnv, outcome, promptCarrier }
}

function grokBootstrapError(code, detail) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  return error
}

/** Fail before any prompt snapshot or child process is created. */
function assertGrokSingleTurnSkillRoute(prepared) {
  if (!prepared?.promptCarrier) return
  if (prepared.outcome?.errorCode) {
    throw grokBootstrapError(
      'GROK_FULL_BOOTSTRAP_ERROR',
      String(prepared.outcome.errorCode)
    )
  }
  if (prepared.outcome?.active !== true) {
    throw grokBootstrapError(
      'GROK_FULL_BOOTSTRAP_INACTIVE',
      'single-turn Full launch requires an active, project-bound SkillRoute bootstrap'
    )
  }
}

function promptSnapshotRoot(plan) {
  return path.join(path.resolve(plan.hostScope.ownerRoot), 'devcodex', 'private', 'prompt-snapshots')
}

function writeOwnerRecord(indexPath, record) {
  const temporary = `${indexPath}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  fs.renameSync(temporary, indexPath)
}

function readOwnerRecord(indexPath) {
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  } catch {
    return null
  }
}

function recoverGrokPromptSnapshots(plan, options = {}) {
  const privateRoot = promptSnapshotRoot(plan)
  const indexRoot = path.join(privateRoot, 'index')
  let entries = []
  try {
    entries = fs.readdirSync(indexRoot).filter(name => name.endsWith('.json')).sort()
  } catch {
    return { scanned: 0, recovered: 0, skipped: 0 }
  }
  let recovered = 0
  let skipped = 0
  for (const name of entries.slice(0, GROK_PROMPT_RECOVERY_SCAN_LIMIT)) {
    const indexPath = path.join(indexRoot, name)
    const record = readOwnerRecord(indexPath)
    const recovery = classifyPrivateTempRecovery(record, {
      privateRoot,
      nowMs: options.nowMs,
      hostname: options.hostname,
      kill: options.kill
    })
    if (!recovery.recoverable) {
      skipped += 1
      continue
    }
    // Recovery is limited to a validated, expired record whose exact local PID
    // is proven dead. Unknown or mismatched owners remain fail-closed.
    fs.rmSync(record.ownerRoot, { recursive: true, force: false })
    fs.unlinkSync(indexPath)
    recovered += 1
  }
  return {
    scanned: Math.min(entries.length, GROK_PROMPT_RECOVERY_SCAN_LIMIT),
    recovered,
    skipped,
    truncated: entries.length > GROK_PROMPT_RECOVERY_SCAN_LIMIT
  }
}

function materializePromptCarrier(plan, carrier, options = {}) {
  if (!carrier || !carrier.kind.startsWith('prompt-file')) return null
  const privateRoot = promptSnapshotRoot(plan)
  const ownersRoot = path.join(privateRoot, 'owners')
  const indexRoot = path.join(privateRoot, 'index')
  fs.mkdirSync(ownersRoot, { recursive: true, mode: 0o700 })
  fs.mkdirSync(indexRoot, { recursive: true, mode: 0o700 })
  const recovery = recoverGrokPromptSnapshots(plan, options)
  const ownerId = crypto.randomUUID()
  const ownerToken = crypto.randomBytes(32).toString('hex')
  const ownerRoot = path.join(ownersRoot, ownerId)
  const snapshot = path.join(ownerRoot, 'prompt.txt')
  const indexPath = path.join(indexRoot, `${ownerId}.json`)
  fs.mkdirSync(ownerRoot, { recursive: false, mode: 0o700 })
  const record = buildPrivateTempOwnerRecord({
    privateRoot,
    ownerRoot,
    snapshotPath: snapshot,
    ownerId,
    ownerToken,
    promptDigest: carrier.digest,
    ttlMs: options.promptSnapshotTtlMs || GROK_PROMPT_SNAPSHOT_TTL_MS,
    nowMs: options.nowMs,
    hostname: options.hostname,
    state: 'allocated'
  })
  writeOwnerRecord(indexPath, record)
  fs.writeFileSync(snapshot, carrier.buffer, { flag: 'wx', mode: 0o600 })
  const planIndex = 2 + carrier.index
  if (carrier.kind === 'prompt-file') {
    plan.args[planIndex + 1] = snapshot
  } else {
    plan.args[planIndex] = `--prompt-file=${snapshot}`
  }
  plan.promptCarrier = {
    ...plan.promptCarrier,
    status: 'verified',
    forwarding: 'snapshot-file',
    forwardedDigest: carrier.digest,
    snapshotOwnerId: ownerId,
    recovery
  }
  return { privateRoot, ownerRoot, snapshot, indexPath, ownerId, ownerToken, recovery }
}

function finalizePromptCarrier(materialized) {
  if (!materialized) return { finalized: false }
  const record = readOwnerRecord(materialized.indexPath)
  const validation = validatePrivateTempOwnerRecord(record, materialized.privateRoot)
  const exactOwner = validation.valid &&
    record.ownerId === materialized.ownerId &&
    record.ownerToken === materialized.ownerToken &&
    samePath(record.ownerRoot, materialized.ownerRoot) &&
    samePath(record.snapshotPath, materialized.snapshot)
  if (!exactOwner) {
    throw grokBootstrapError(
      'GROK_PROMPT_SNAPSHOT_OWNER_MISMATCH',
      validation.errors?.join(',') || 'owner identity mismatch'
    )
  }
  fs.rmSync(materialized.ownerRoot, { recursive: true, force: false })
  fs.unlinkSync(materialized.indexPath)
  return {
    finalized: true,
    ownerId: materialized.ownerId,
    snapshotRemoved: !fs.existsSync(materialized.ownerRoot),
    indexRemoved: !fs.existsSync(materialized.indexPath)
  }
}

function launchGrok(argv = [], options = {}) {
  const buildPlan = options.buildGrokLaunchPlan || buildGrokLaunchPlan
  const basePlan = buildPlan(argv, options)
  const prepared = prepareGrokSingleTurnSkillRoute(basePlan, argv, options)
  const plan = prepared.plan
  assertGrokSingleTurnSkillRoute(prepared)
  const runner = options.spawnSync || spawnSync
  const materialized = materializePromptCarrier(plan, prepared.promptCarrier, options)
  if (plan.promptCarrier && !materialized) {
    plan.promptCarrier.status = 'verified'
    plan.promptCarrier.forwardedDigest = prepared.promptCarrier.digest
  }
  let result
  try {
    result = runner(plan.executable, plan.args, {
      cwd: plan.cwd,
      stdio: options.stdio || 'inherit',
      windowsHide: false,
      env: {
        ...buildGrokCliEnv({
          ...process.env,
          ...(options.env || {}),
          ...prepared.env
        }),
        GROK_HOME: plan.hostScope.ownerRoot,
        DEVCODEX_GROK_EVIDENCE_MODE: plan.evidenceMode,
        ...(plan.hostScope.workspaceRoot ? { DEVCODEX_WORKSPACE_ROOT: plan.hostScope.workspaceRoot } : {}),
        ...(plan.hostScope.project ? { DEVCODEX_PROJECT: plan.hostScope.project } : {})
      }
    })
  } finally {
    if (materialized) {
      plan.promptCarrier.finalization = finalizePromptCarrier(materialized)
      plan.promptCarrier.snapshotRemoved = plan.promptCarrier.finalization.snapshotRemoved
    }
  }
  if (result.error) throw result.error
  return { plan, status: Number.isInteger(result.status) ? result.status : 1, signal: result.signal || null }
}

module.exports = {
  GROK_ROUTE_CONTEXT_EPOCH_RE,
  GROK_ROUTE_PROMPT_MAX_BYTES,
  GROK_MCP_TOOL_NAMES,
  GROK_MCP_TOOL_CONTRACT,
  getGrokLauncherAdapterDigest,
  buildGrokLaunchPlan,
  extractSinglePrompt,
  inspectSinglePromptCarrier,
  prepareGrokSingleTurnSkillRoute,
  assertGrokSingleTurnSkillRoute,
  recoverGrokPromptSnapshots,
  materializePromptCarrier,
  finalizePromptCarrier,
  collectExtraRules,
  findNestedGitRoot,
  findWorkspaceRoot,
  launchGrok,
  resolveGrokLaunchTarget
}
