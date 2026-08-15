'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  captureRuntimeProcessIdentity
} = require('./runtime-generation-identity.cjs')

const {
  loadWorkflowRootRegistry
} = require('./workflow-root-registry.cjs')
const {
  DIGEST_RE,
  sha256
} = require('./progressive-skill-route-contract.cjs')
const {
  resolveGlobalSkillRuntimeRoot
} = require('./global-skill-runtime-root.cjs')
const {
  normalizeHostVariant
} = require('./host-adapter-identity.cjs')

const SOURCE_DEFAULT = 'unified'
const MODE_POLICY_VERSION = 'SkillRouteModeV2'
const PROTOCOL_VERSION = '2024-11-05'
const CAPABILITY_PATH = path.join(__dirname, 'host-skill-route-capabilities.v1.json')
const RUNTIME_CONTRACT_FILES = Object.freeze([
  'content-identity.cjs',
  'progressive-skill-route-contract.cjs',
  'runtime-skill-identity-index.cjs',
  'model-skill-catalog.cjs',
  'workflow-root-registry.cjs',
  'workflow-root-registry.v1.json',
  'progressive-skill-plan.cjs',
  'skill-route-mode.cjs',
  'runtime-generation-identity.cjs',
  'runtime-state-store.cjs',
  'skill-route-budget.cjs',
  'skill-route-state.cjs',
  'skill-route-tool.cjs',
  'host-adapter-identity.cjs',
  'global-skill-runtime-root.cjs',
  'context-read-contract.cjs',
  'context-plan-observation.cjs',
  'context-source-observation.cjs',
  'derived-state-store.cjs',
  'execution-optimization-routing.cjs',
  'governance-ledger-integrity.cjs',
  'skill-resolution.cjs',
  'workspace-layout.cjs',
  'devcodex-md-entry.cjs',
  'language-context.cjs',
  'lifecycle-bootstrap-state.cjs',
  'lifecycle-checkpoint-validation.cjs',
  'lifecycle-dangerous-command.cjs',
  'lifecycle-governance-intake.cjs',
  'lifecycle-hook-output.cjs',
  'lifecycle-host-adapters.cjs',
  'lifecycle-namespace-state.cjs',
  'lifecycle-payload-utils.cjs',
  'lifecycle-project-target.cjs',
  'lifecycle-skill-route-coordinator.cjs',
  'lifecycle-stop-gate.cjs',
  'lifecycle-task-trace.cjs',
  'lifecycle-turn-liveness.cjs',
  'lifecycle-visible-reply.cjs',
  'lifecycle-workflow-completion.cjs',
  'stdio-bounds.cjs',
  'task-continuation-contract.cjs',
  'visible-output-contract.cjs',
  'workflow-completion-contract.cjs',
  'lifecycle.cjs'
])
const RUNTIME_CONTRACT_SKILL_SCHEMAS = Object.freeze([
  'skill-intent.v1.schema.json',
  'workflow-root-registry.v1.schema.json',
  'progressive-skill-route.v1.schema.json'
])
const CAPABILITY_STATUSES = new Set(['PASS', 'WARN', 'BLOCK', 'UNVERIFIED', 'N/A'])
const REQUIRED_PROBE_OPS = Object.freeze([
  'profile_context_plan',
  'profile_load',
  'memory_status',
  'catalog',
  'commit',
  'load_stage',
  'status'
])

function readJson (file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function rawSha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function packageRelativeEvidencePath (evidenceRef, options = {}) {
  const value = String(evidenceRef || '').trim()
  const packageRoot = path.resolve(
    options.evidenceRoot || options.packageRoot || path.join(__dirname, '..', '..')
  )
  if (!value || value.includes('\\') || path.isAbsolute(value) ||
      path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    return { valid: false, reasonCode: 'evidence-ref-not-package-relative' }
  }
  const resolved = path.resolve(packageRoot, ...value.split('/'))
  const relative = path.relative(packageRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { valid: false, reasonCode: 'evidence-ref-escapes-package' }
  }
  return { valid: true, packageRoot, evidencePath: resolved, evidenceRef: value }
}

function validateCapabilityEvidence (capability, options = {}) {
  const located = packageRelativeEvidencePath(capability?.evidenceRef, options)
  if (!located.valid) return located
  const fsImpl = options.fs || fs
  let raw
  let evidence
  try {
    const stat = fsImpl.lstatSync(located.evidencePath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { valid: false, reasonCode: 'evidence-file-not-regular' }
    }
    raw = fsImpl.readFileSync(located.evidencePath)
    evidence = JSON.parse(raw.toString('utf8'))
  } catch {
    return { valid: false, reasonCode: 'evidence-file-unreadable' }
  }
  const evidenceDigest = rawSha256(raw)
  if (evidenceDigest !== capability.evidenceDigest) {
    return { valid: false, reasonCode: 'evidence-raw-digest-mismatch', evidenceDigest }
  }
  const observedOps = new Set(Array.isArray(evidence?.probe?.observedOps)
    ? evidence.probe.observedOps
    : [])
  const requiredStages = Array.isArray(evidence?.probe?.requiredStageIds)
    ? evidence.probe.requiredStageIds
    : []
  const loadedStages = new Set(Array.isArray(evidence?.probe?.loadedStageIds)
    ? evidence.probe.loadedStageIds
    : [])
  const retirementAnomalies = evidence?.probe?.retirementAnomalies
  const evidenceValid = evidence?.schemaVersion === 'HostSkillRouteEvidenceV1' &&
    evidence.status === 'PASS' &&
    evidence.portable === true &&
    evidence.hostVariant === capability.hostVariant &&
    evidence.testedVersion === capability.testedVersion &&
    evidence.protocol === capability.protocol &&
    evidence.runtimeContractDigest === capability.runtimeContractDigest &&
    evidence.hostAdapterDigest === capability.hostAdapterDigest &&
    evidence.probe?.schemaVersion === 'SkillRouteProbeSummaryV1' &&
    evidence.probe?.processComplete === true &&
    REQUIRED_PROBE_OPS.every(op => observedOps.has(op)) &&
    requiredStages.includes('entry') &&
    requiredStages.includes('closeout') &&
    requiredStages.every(stage => loadedStages.has(stage)) &&
    retirementAnomalies &&
    Object.values(retirementAnomalies).every(value => value === 0) &&
    evidence.probe?.transport?.kind === 'local-stdio' &&
    evidence.probe.transport.networkListener === false &&
    evidence.probe.transport.longRunningServiceStarted === false
  return evidenceValid
    ? {
        valid: true,
        reasonCode: 'evidence-valid',
        evidenceRef: located.evidenceRef,
        evidenceDigest,
        evidence
      }
    : { valid: false, reasonCode: 'evidence-contract-mismatch', evidenceDigest }
}

function validateCapabilityDocument (document, options = {}) {
  const errors = []
  const evidenceByVariant = {}
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { valid: false, errors: ['capability-document-object-required'], evidenceByVariant }
  }
  if (document.schemaVersion !== 'HostSkillRouteCapabilityV1') {
    errors.push('capability-schema-version')
  }
  if (!Array.isArray(document.capabilities) ||
      !document.capabilities.length ||
      document.capabilities.length > 32) {
    errors.push('capability-list')
    return { valid: false, errors, evidenceByVariant }
  }
  const variants = new Set()
  for (const item of document.capabilities) {
    const variant = String(item?.hostVariant || '').trim()
    if (!variant || variants.has(variant)) {
      errors.push(`capability-variant:${variant || 'missing'}`)
      continue
    }
    variants.add(variant)
    if (!CAPABILITY_STATUSES.has(item.status) ||
        typeof item.testedVersion !== 'string' ||
        !item.testedVersion.trim() ||
        item.protocol !== `MCP ${PROTOCOL_VERSION}`) {
      errors.push(`capability-contract:${variant}`)
    }
    if (item.status === 'PASS' &&
        (!DIGEST_RE.test(String(item.runtimeContractDigest || '')) ||
          !DIGEST_RE.test(String(item.hostAdapterDigest || '')) ||
          !DIGEST_RE.test(String(item.evidenceDigest || '')) ||
          typeof item.evidenceRef !== 'string' ||
          !item.evidenceRef.trim() ||
          item.defaultEligible !== true)) {
      errors.push(`capability-pass-evidence:${variant}`)
    } else if (item.status === 'PASS') {
      const evidence = validateCapabilityEvidence(item, options)
      evidenceByVariant[variant] = evidence
      if (!evidence.valid) {
        errors.push(`capability-evidence:${variant}:${evidence.reasonCode}`)
      }
    }
  }
  return { valid: errors.length === 0, errors, evidenceByVariant }
}

function getCapabilityDocumentDigest (options = {}) {
  const capability = readJson(
    options.capabilityPath || CAPABILITY_PATH,
    options.fs || fs
  )
  return capability ? sha256(capability) : null
}

function getRuntimeContractDigest (options = {}) {
  const fsImpl = options.fs || fs
  const runtimeRoot = path.resolve(options.runtimeRoot || __dirname)
  const packageRoot = path.resolve(options.packageRoot || path.join(runtimeRoot, '..', '..'))
  let registryDigest = 'missing'
  try {
    registryDigest = loadWorkflowRootRegistry(options).registry.registryDigest
  } catch {
    registryDigest = 'missing'
  }
  const runtimeFileDigests = {}
  for (const file of RUNTIME_CONTRACT_FILES) {
    try {
      runtimeFileDigests[file] = sha256(
        fsImpl.readFileSync(path.join(runtimeRoot, file), 'utf8')
      )
    } catch {
      runtimeFileDigests[file] = 'missing'
    }
  }
  let skillRuntime = options.globalRuntime || null
  if (!skillRuntime?.root) {
    skillRuntime = resolveGlobalSkillRuntimeRoot(options)
  }
  for (const file of RUNTIME_CONTRACT_SKILL_SCHEMAS) {
    const key = `skills/_schemas/${file}`
    try {
      if (skillRuntime?.status !== 'resolved' || !skillRuntime.root) {
        throw new Error('global Skill runtime unresolved')
      }
      runtimeFileDigests[key] = sha256(
        fsImpl.readFileSync(path.join(skillRuntime.companionRoot || skillRuntime.root, '_schemas', file), 'utf8')
      )
    } catch {
      runtimeFileDigests[key] = 'missing'
    }
  }
  const mcpAdapterPath = path.resolve(
    options.mcpAdapterPath ||
    path.join(packageRoot, 'mcp', 'profile-server.js')
  )
  try {
    runtimeFileDigests['mcp/profile-server.js'] = sha256(
      fsImpl.readFileSync(mcpAdapterPath, 'utf8')
    )
  } catch {
    runtimeFileDigests['mcp/profile-server.js'] = 'missing'
  }
  const memoryAdapterPath = path.resolve(
    options.memoryAdapterPath ||
    path.join(packageRoot, 'mcp', 'memory-server.js')
  )
  try {
    runtimeFileDigests['mcp/memory-server.js'] = sha256(
      fsImpl.readFileSync(memoryAdapterPath, 'utf8')
    )
  } catch {
    runtimeFileDigests['mcp/memory-server.js'] = 'missing'
  }
  const stdioTransportPath = path.resolve(
    options.stdioTransportPath ||
    path.join(packageRoot, 'mcp', 'stdio-jsonrpc.cjs')
  )
  try {
    runtimeFileDigests['mcp/stdio-jsonrpc.cjs'] = sha256(
      fsImpl.readFileSync(stdioTransportPath, 'utf8')
    )
  } catch {
    runtimeFileDigests['mcp/stdio-jsonrpc.cjs'] = 'missing'
  }
  return sha256({
    schemaVersion: 'ProgressiveSkillRouteRuntimeContractV1',
    modePolicyVersion: MODE_POLICY_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    tool: 'skill_route',
    ops: ['catalog', 'commit', 'rebind', 'load_stage', 'status'],
    schemas: [
      'SkillIntentV1',
      'WorkflowRootRegistryV1',
      'ProgressiveSkillPlanV1',
      'StageLoadReceiptV1',
      'SkillRouteBodyChargeLedgerV1',
      'SkillRouteBudgetProjectionV1',
      'TurnRouteEnvelopeV1'
    ],
    registryDigest,
    runtimeFileDigests
  })
}

let cachedBootRuntimeContractDigest = null

function getBootRuntimeContractDigest (options = {}) {
  const customized = options.fs || options.runtimeRoot || options.packageRoot ||
    options.globalRuntime || options.mcpAdapterPath || options.memoryAdapterPath
  if (customized) return getRuntimeContractDigest(options)
  if (!cachedBootRuntimeContractDigest) {
    cachedBootRuntimeContractDigest = getRuntimeContractDigest(options)
  }
  return cachedBootRuntimeContractDigest
}

function pidAlive (pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function validateProbeAuthority (file, context, options = {}) {
  if (!file) return { valid: false, reasonCode: 'probe-authority-missing' }
  const authority = readJson(file, options.fs || fs)
  if (!authority || authority.schemaVersion !== 'SkillRouteProbeAuthorityV1') {
    return { valid: false, reasonCode: 'probe-authority-invalid' }
  }
  const now = options.now ? new Date(options.now).getTime() : Date.now()
  const issuedAt = Date.parse(authority.issuedAt)
  const expiresAt = Date.parse(authority.expiresAt)
  const runtimeDigest = getRuntimeContractDigest(options)
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      expiresAt <= now || issuedAt > now || expiresAt - issuedAt > 15 * 60 * 1000) {
    return { valid: false, reasonCode: 'probe-authority-expired' }
  }
  if (authority.allowedMode !== 'unified' || authority.probeOnly !== true ||
      authority.project !== context.project ||
      authority.hostVariant !== context.hostVariant ||
      authority.runtimeDigest !== runtimeDigest ||
      !pidAlive(Number(authority.issuerPid))) {
    return { valid: false, reasonCode: 'probe-authority-mismatch' }
  }
  return { valid: true, authority, reasonCode: 'probe-authority-valid' }
}

function resolveSkillRouteMode (options = {}) {
  const env = options.env || process.env
  const hostVariant = normalizeHostVariant(
    options.hostVariant ||
    env.DEVCODEX_HOST_VARIANT ||
    options.host ||
    env.DEVCODEX_AGENT ||
    (env.CLAUDE_PROJECT_DIR ? 'claude-code' : ''),
    { env, sessionId: options.sessionId }
  )
  const project = String(options.project || '').trim()
  const capabilityDoc = readJson(options.capabilityPath || CAPABILITY_PATH, options.fs || fs)
  const capabilityValidation = validateCapabilityDocument(capabilityDoc, options)
  const capability = capabilityValidation.valid && capabilityDoc.capabilities.find(item =>
    item.hostVariant === hostVariant
  ) || null
  const requested = SOURCE_DEFAULT
  const probe = validateProbeAuthority(
    env.DEVCODEX_SKILL_ROUTE_PROBE_AUTHORITY,
    { project, hostVariant },
    options
  )
  const runtimeContractDigest = getBootRuntimeContractDigest(options)
  const capabilityRuntimeCurrent = !!capability &&
    DIGEST_RE.test(String(capability.runtimeContractDigest || '')) &&
    capability.runtimeContractDigest === runtimeContractDigest
  const capabilityAdapterCurrent = !!capability &&
    DIGEST_RE.test(String(capability.hostAdapterDigest || '')) &&
    DIGEST_RE.test(String(options.hostAdapterDigest || '')) &&
    capability.hostAdapterDigest === options.hostAdapterDigest
  const capabilityEvidence = capability
    ? capabilityValidation.evidenceByVariant[capability.hostVariant]
    : null
  const capabilityEvidenceValid = capabilityEvidence?.valid === true
  const capabilityEligible = capability?.status === 'PASS' &&
    capabilityRuntimeCurrent &&
    capabilityAdapterCurrent &&
    capabilityEvidenceValid
  let effective = SOURCE_DEFAULT
  let source = 'source-default'
  let reason = 'unified-default'
  if (probe.valid) {
    effective = 'unified'
    source = 's15-probe-authority'
    reason = probe.reasonCode
  }
  const runtimeRole = String(options.runtimeRole || env.DEVCODEX_RUNTIME_ROLE || 'hook').trim()
  const processRuntimeIdentity = captureRuntimeProcessIdentity({
    role: runtimeRole,
    runtimeRoot: options.runtimeRoot || path.resolve(__dirname, '..', '..'),
    bootRuntimeContractDigest: runtimeContractDigest,
    fs: options.fs
  })
  return {
    schemaVersion: 'SkillRouteModeReceiptV1',
    requested,
    source,
    effective,
    reason,
    hostVariant,
    hostEligibility: capabilityEligible
      ? 'PASS'
      : (capability?.status === 'PASS' ? 'STALE' : (capability?.status || 'UNVERIFIED')),
    sourceDefault: SOURCE_DEFAULT,
    operatorOverride: null,
    runtimeContractDigest,
    hookRuntimeDigest: runtimeRole.includes('hook') ? runtimeContractDigest : null,
    mcpRuntimeDigest: runtimeRole.includes('mcp') ? runtimeContractDigest : null,
    capabilityDigest: capabilityDoc ? sha256(capabilityDoc) : null,
    capabilityDocumentValid: capabilityValidation.valid,
    capabilityDocumentErrors: capabilityValidation.errors,
    capabilityRuntimeCurrent,
    capabilityAdapterCurrent,
    capabilityEvidenceValid,
    capabilityEvidenceReason: capabilityEvidence?.reasonCode || 'evidence-unavailable',
    capabilityEvidenceDigest: capabilityEvidence?.evidenceDigest || null,
    processRuntimeIdentity,
    probeAuthorityReason: probe.reasonCode,
    probeAuthority: probe.valid ? {
      probeRunId: probe.authority.probeRunId,
      expiresAt: probe.authority.expiresAt
    } : null
  }
}

module.exports = {
  SOURCE_DEFAULT,
  MODE_POLICY_VERSION,
  PROTOCOL_VERSION,
  CAPABILITY_PATH,
  normalizeHostVariant,
  getCapabilityDocumentDigest,
  getBootRuntimeContractDigest,
  getRuntimeContractDigest,
  validateCapabilityDocument,
  validateCapabilityEvidence,
  validateProbeAuthority,
  resolveSkillRouteMode
}
