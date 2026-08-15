'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  unsafePathComponent,
  resolveGlobalSharedTarget,
  resolveHome
} = require('./global-host-target.js')
const { getRuntimeContractDigest } = require('../../hooks/_runtime/skill-route-mode.cjs')

const READINESS_SCHEMA = 'DevCodexReadinessV1'
const ACTIVATION_RECEIPT_SCHEMA = 'DevCodexActivationReceiptV1'
const STATUS = Object.freeze(['PASS', 'WARN', 'BLOCK', 'UNVERIFIED', 'N/A'])
const DRIFT_CODES = new Set([
  'GLOBAL_HOST_RECEIPT_STALE',
  'GLOBAL_HOST_MANAGED_CONFIG_DRIFT',
  'GLOBAL_HOST_STALE_CLEANUP_PENDING'
])
const CURRENT_SESSION_STATE_LIMIT_BYTES = 4 * 1024 * 1024
const CURRENT_SESSION_MAX_STATE_FILES = 64
const CURRENT_SESSION_MAX_AGE_MS = 15 * 60 * 1000

function normalizeStatus(value, fallback = 'UNVERIFIED') {
  const status = String(value || '').toUpperCase()
  return STATUS.includes(status) ? status : fallback
}

function fact(status, value, evidence = {}) {
  return { status: normalizeStatus(status), value: Boolean(value), ...evidence }
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function lifecycleStateCandidates(activeRoot, fsImpl = fs) {
  if (!activeRoot) return []
  const hooksRoot = path.join(path.resolve(activeRoot), '.memory', 'hooks')
  let entries
  try {
    entries = fsImpl.readdirSync(hooksRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const candidates = []
  for (const entry of entries.slice(0, CURRENT_SESSION_MAX_STATE_FILES)) {
    if (!entry.isDirectory()) continue
    const file = path.join(hooksRoot, entry.name, 'lifecycle-state.json')
    try {
      const stat = fsImpl.statSync(file)
      if (!stat.isFile() || stat.size <= 0 || stat.size > CURRENT_SESSION_STATE_LIMIT_BYTES) continue
      candidates.push({ file, mtimeMs: Number(stat.mtimeMs || 0) })
    } catch {}
  }
  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
}

function readCurrentSessionEvidence(options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const sessionId = String(env.CODEX_THREAD_ID || '').trim()
  if (!sessionId) return null
  const nowMs = options.now ? Date.parse(options.now) : Date.now()
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? Math.max(0, options.maxAgeMs)
    : CURRENT_SESSION_MAX_AGE_MS
  for (const candidate of lifecycleStateCandidates(options.activeRoot, fsImpl)) {
    let state
    try {
      state = JSON.parse(fsImpl.readFileSync(candidate.file, 'utf8'))
    } catch {
      continue
    }
    const liveness = state?.turnLiveness || {}
    if (String(liveness.turnKey || '').trim() !== sessionId) continue
    const observedAt = liveness.lastEventAt || state.updatedAt || null
    const observedMs = Date.parse(observedAt)
    const fresh = Number.isFinite(observedMs) && Number.isFinite(nowMs) &&
      observedMs <= nowMs && nowMs - observedMs <= maxAgeMs
    const events = Array.isArray(liveness.taskTrace?.events) ? liveness.taskTrace.events : []
    const userPromptObserved = events.some(event =>
      event?.type === 'UserPromptSubmit' && event?.result === 'observed'
    )
    const routeToolObserved = events.some(event => {
      const toolName = String(event?.payload?.toolName || event?.payload?.tool_name || '')
      return event?.type === 'ToolLeaseStarted' && event?.result === 'allowed' &&
        /(?:^|__)skill_route$/i.test(toolName)
    })
    const route = state?.progressiveSkillRoute || {}
    const hostVariant = String(route.modeReceipt?.hostVariant || '')
    const runtimeContractDigest = String(route.modeReceipt?.runtimeContractDigest || '')
    let expectedRuntimeContractDigest = String(options.expectedRuntimeContractDigest || '').trim()
    if (!expectedRuntimeContractDigest) {
      try { expectedRuntimeContractDigest = getRuntimeContractDigest() } catch {}
    }
    const runtimeContractMatch = /^[a-f0-9]{64}$/.test(runtimeContractDigest) &&
      /^[a-f0-9]{64}$/.test(expectedRuntimeContractDigest) &&
      runtimeContractDigest === expectedRuntimeContractDigest
    const routeBootstrapObserved = route.bootstrap?.schemaVersion === 'SkillRouteBootstrapV1'
    const hostObserved = userPromptObserved && routeToolObserved && routeBootstrapObserved
    const hostStatus = hostObserved && runtimeContractMatch &&
      hostVariant === 'codex-desktop/app-user-global-local-stdio'
      ? 'PASS'
      : 'UNVERIFIED'
    const projection = {
      sessionId,
      stateFile: candidate.file.replace(/\\/g, '/'),
      observedAt,
      eventSequence: Number(liveness.eventSequence || 0),
      hostVariant,
      routeBootstrapObserved,
      routeToolObserved,
      runtimeContractDigest: runtimeContractDigest || null,
      expectedRuntimeContractDigest: expectedRuntimeContractDigest || null,
      runtimeContractMatch
    }
    return {
      status: fresh ? 'PASS' : 'UNVERIFIED',
      fresh,
      hostStatus,
      hostObserved,
      currentTask: true,
      host: 'codex-desktop',
      evidenceId: sha256(projection),
      observedAt,
      stateFile: projection.stateFile,
      hostVariant,
      routeBootstrapObserved,
      routeToolObserved,
      runtimeContractDigest: projection.runtimeContractDigest,
      expectedRuntimeContractDigest: projection.expectedRuntimeContractDigest,
      runtimeContractMatch
    }
  }
  return null
}

function resolveActivationReceiptFile(options = {}) {
  const env = options.env || process.env
  const home = resolveHome({ env, home: options.home })
  const shared = resolveGlobalSharedTarget(home, env)
  return path.join(shared.root, 'devcodex', 'activation-readiness.json')
}

function readActivationReceipt(options = {}) {
  const fsImpl = options.fs || fs
  const file = options.file || resolveActivationReceiptFile(options)
  try {
    const value = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
    if (value?.schemaVersion !== ACTIVATION_RECEIPT_SCHEMA) {
      return { status: 'UNVERIFIED', file, value: null, error: 'activation-receipt-schema-invalid' }
    }
    return { status: 'PASS', file, value, error: null }
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'N/A', file, value: null, error: null }
    return {
      status: 'UNVERIFIED',
      file,
      value: null,
      error: error?.code || error?.message || 'activation-receipt-read-failed'
    }
  }
}

function persistActivationReceipt(lifecycleReceipt, options = {}) {
  const fsImpl = options.fs || fs
  const file = options.file || resolveActivationReceiptFile(options)
  const directory = path.dirname(file)
  let temporary = null
  try {
    const sharedRoot = path.dirname(directory)
    const unsafeBefore = unsafePathComponent(sharedRoot, file, fsImpl)
    if (unsafeBefore) {
      const error = new Error(`activation receipt path is unsafe: ${unsafeBefore.path}`)
      error.code = 'ACTIVATION_RECEIPT_PATH_UNSAFE'
      throw error
    }
    fsImpl.mkdirSync(directory, { recursive: true })
    const unsafeAfter = unsafePathComponent(sharedRoot, file, fsImpl)
    if (unsafeAfter) {
      const error = new Error(`activation receipt path is unsafe: ${unsafeAfter.path}`)
      error.code = 'ACTIVATION_RECEIPT_PATH_UNSAFE'
      throw error
    }
    temporary = path.join(
      directory,
      `.activation-readiness.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    )
    const payload = {
      schemaVersion: ACTIVATION_RECEIPT_SCHEMA,
      packageName: 'devcodex',
      packageVersion: lifecycleReceipt?.packageVersion || null,
      status: lifecycleReceipt?.status === 'executed' ? 'PASS' : 'BLOCK',
      completedAt: lifecycleReceipt?.completedAt || new Date().toISOString(),
      lifecycle: lifecycleReceipt
    }
    fsImpl.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    fsImpl.renameSync(temporary, file)
    temporary = null
    return { status: 'PASS', file, error: null }
  } catch (error) {
    if (temporary) {
      try { fsImpl.rmSync(temporary, { force: true }) } catch {}
    }
    return {
      status: 'UNVERIFIED',
      file,
      error: error?.code || error?.message || 'activation-receipt-write-failed'
    }
  }
}

function packageFact(input) {
  const alwaysOn = input.governanceSummary?.alwaysOn || {}
  const surface = alwaysOn.surfaceMatrix || {}
  const layout = surface.controlContentLayout || (input.sourceRepository ? 'source' : 'delivery')
  const deliveryAssetsPresent = Number(surface.requiredMissingCount || 0) === 0 &&
    Number(surface.sourceApplyToFiles || 0) > 0
  return {
    status: deliveryAssetsPresent ? 'PASS' : 'BLOCK',
    version: input.packageVersion || null,
    sourceRepository: input.sourceRepository === true,
    deliveryLayout: layout,
    deliveryAssetsPresent
  }
}

function physicalFacts(hostParity = {}) {
  const physical = hostParity?.evidence?.physicalPresence || {}
  const checks = hostParity?.checks && Object.keys(hostParity.checks).length
    ? hostParity.checks
    : (hostParity?.withheldChecks || {})
  const kernel = physical.globalKernelFilesPresent ?? checks.globalKernelAgentsMd
  const lifecycle = physical.globalLifecycleFilesPresent ?? checks.globalCodexLifecycleReachable
  return {
    globalKernelFilesPresent: fact(kernel === true ? 'PASS' : 'BLOCK', kernel === true, {
      evidenceSource: 'user-global-filesystem'
    }),
    globalLifecycleFilesPresent: fact(lifecycle === true ? 'PASS' : 'BLOCK', lifecycle === true, {
      evidenceSource: 'user-global-filesystem'
    })
  }
}

function configFacts(globalHostConfig = {}) {
  const hosts = Array.isArray(globalHostConfig.hosts) ? globalHostConfig.hosts : []
  const codex = hosts.find(host => host.host === 'codex') || {}
  const issueRows = hosts.flatMap(host => (Array.isArray(host.configurationIssues) ? host.configurationIssues : [])
    .map(issue => ({ host: host.host, code: issue.code || 'UNKNOWN' })))
  const issueCodes = [...new Set(issueRows.map(issue => issue.code))].sort()
  const driftHosts = [...new Set(issueRows.filter(issue => DRIFT_CODES.has(issue.code)).map(issue => issue.host))].sort()
  const configInspectionUnverified = hosts.length === 0 || hosts.some(host => host.inspectionStatus === 'UNVERIFIED')
  const configStatus = configInspectionUnverified
    ? 'UNVERIFIED'
    : (issueRows.length ? 'BLOCK' : 'PASS')
  const adapterStatus = codex.adapterContractStatus === 'passed'
    ? 'PASS'
    : (codex.adapterContractStatus === 'failed' ? 'BLOCK' : 'UNVERIFIED')
  return {
    codexAdapterContractReady: fact(adapterStatus, adapterStatus === 'PASS', {
      contractStatus: codex.adapterContractStatus || 'unverified'
    }),
    managedConfigDrift: {
      status: configStatus,
      value: driftHosts.length > 0,
      driftHosts,
      issueCodes,
      inspectionUnverified: configInspectionUnverified
    }
  }
}

function currentTaskFacts(input = {}) {
  const evidence = input.currentSessionEvidence || null
  if (!evidence) {
    return {
      sessionFreshness: fact('UNVERIFIED', false, { reason: 'current-task-session-evidence-missing' }),
      hostEvidence: fact('UNVERIFIED', false, {
        host: input.platform || 'unknown',
        reason: 'current-task-host-event-evidence-missing'
      })
    }
  }
  const sessionStatus = evidence.fresh === true ? normalizeStatus(evidence.status, 'PASS') : 'UNVERIFIED'
  const hostObserved = evidence.hostObserved === true && evidence.currentTask === true
  const hostStatus = hostObserved ? normalizeStatus(evidence.hostStatus, 'PASS') : 'UNVERIFIED'
  return {
    sessionFreshness: fact(sessionStatus, sessionStatus === 'PASS', {
      evidenceId: evidence.evidenceId || null,
      observedAt: evidence.observedAt || null
    }),
    hostEvidence: fact(hostStatus, hostStatus === 'PASS', {
      host: evidence.host || input.platform || 'unknown',
      evidenceId: evidence.evidenceId || null,
      currentTask: evidence.currentTask === true
    })
  }
}

function activationFact(input = {}) {
  const receipt = input.activationReceipt?.value || null
  if (!receipt) {
    return {
      status: normalizeStatus(input.activationReceipt?.status, 'N/A'),
      value: false,
      receiptFile: input.activationReceipt?.file || null,
      lifecycleStatus: null
    }
  }
  const lifecycleStatus = receipt.lifecycle?.status || receipt.status || null
  const status = lifecycleStatus === 'executed'
    ? 'PASS'
    : (lifecycleStatus === 'failed-soft' ? 'BLOCK' : 'WARN')
  return {
    status,
    value: status === 'PASS',
    receiptFile: input.activationReceipt.file || null,
    lifecycleStatus,
    packageVersion: receipt.packageVersion || receipt.lifecycle?.packageVersion || null,
    completedAt: receipt.completedAt || receipt.lifecycle?.completedAt || null
  }
}

function chooseNextAction(facts, input = {}) {
  const refreshCommand = (facts.hostParity?.repairSteps || [])
    .find(step => step.status === 'failed')?.command || input.adapterRefreshCommand || 'npm update -g devcodex'
  if (facts.package.status === 'BLOCK') {
    return { id: 'repair-package-delivery', command: refreshCommand, reason: 'package-delivery-assets-missing' }
  }
  if (facts.activation.status === 'BLOCK' ||
      facts.globalKernelFilesPresent.status === 'BLOCK' ||
      facts.globalLifecycleFilesPresent.status === 'BLOCK' ||
      facts.codexAdapterContractReady.status === 'BLOCK' ||
      facts.managedConfigDrift.status === 'BLOCK') {
    return { id: 'refresh-global-adapters', command: refreshCommand, reason: 'global-runtime-or-managed-config-not-ready' }
  }
  if (facts.workspace.status === 'BLOCK') {
    return { id: 'initialize-workspace', command: 'devcodex init', reason: 'workspace-runtime-missing' }
  }
  if (facts.profile.status === 'BLOCK') {
    return { id: 'plan-profile', command: 'devcodex profile plan', reason: 'profile-incomplete' }
  }
  if (facts.sessionFreshness.status !== 'PASS' || facts.hostEvidence.status !== 'PASS') {
    return {
      id: 'start-fresh-host-task',
      command: null,
      reason: 'current-task-host-evidence-unverified',
      instruction: 'Start a new task in the target host, then run devcodex doctor --json from that task.'
    }
  }
  return null
}

function overallStatus(coreFacts) {
  const statuses = coreFacts.map(item => item.status)
  if (statuses.includes('BLOCK')) return 'BLOCK'
  if (statuses.includes('WARN')) return 'WARN'
  if (statuses.includes('UNVERIFIED')) return 'UNVERIFIED'
  return 'PASS'
}

function buildDevCodexReadiness(input = {}) {
  const packageState = packageFact(input)
  const physical = physicalFacts(input.hostParity)
  const config = configFacts(input.globalHostConfig)
  const currentTask = currentTaskFacts(input)
  const workspace = fact(input.workspaceRuntimeReady === true ? 'PASS' : 'BLOCK', input.workspaceRuntimeReady === true, {
    activeRoot: input.activeRoot || null,
    layoutReady: input.workspaceLayoutReady === true
  })
  const profile = fact(input.profile?.complete === true ? 'PASS' : 'BLOCK', input.profile?.complete === true, {
    directory: input.profile?.directory || null,
    tier: input.profile?.tier || null,
    error: input.profile?.error || null
  })
  const activation = activationFact(input)
  const facts = {
    schemaVersion: READINESS_SCHEMA,
    package: packageState,
    ...physical,
    ...config,
    workspace,
    profile,
    ...currentTask,
    activation,
    hostParity: input.hostParity || null
  }
  const core = [
    packageState,
    physical.globalKernelFilesPresent,
    physical.globalLifecycleFilesPresent,
    config.codexAdapterContractReady,
    config.managedConfigDrift,
    workspace,
    profile,
    currentTask.sessionFreshness,
    currentTask.hostEvidence,
    activation
  ]
  const status = overallStatus(core)
  const nextAction = chooseNextAction(facts, input)
  return {
    schemaVersion: READINESS_SCHEMA,
    status,
    ready: status === 'PASS',
    package: packageState,
    ...physical,
    ...config,
    workspace,
    profile,
    ...currentTask,
    activation,
    nextAction
  }
}

function createReadinessCollector(options = {}) {
  return function collectDevCodexReadiness(input = {}) {
    const env = options.env || process.env
    const fsImpl = options.fs || fs
    const adapterRefreshCommand = typeof options.adapterRefreshCommandForCwd === 'function'
      ? options.adapterRefreshCommandForCwd(input.cwd)
      : options.adapterRefreshCommand
    return buildDevCodexReadiness({
      ...input,
      packageVersion: options.packageVersion || input.packageVersion,
      activationReceipt: input.activationReceipt || readActivationReceipt({ env, fs: fsImpl }),
      currentSessionEvidence: input.currentSessionEvidence || readCurrentSessionEvidence({
        activeRoot: input.activeRoot,
        env,
        fs: fsImpl
      }),
      adapterRefreshCommand
    })
  }
}

module.exports = {
  ACTIVATION_RECEIPT_SCHEMA,
  READINESS_SCHEMA,
  STATUS,
  buildDevCodexReadiness,
  createReadinessCollector,
  persistActivationReceipt,
  readActivationReceipt,
  readCurrentSessionEvidence,
  resolveActivationReceiptFile
}
