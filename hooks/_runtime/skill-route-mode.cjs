'use strict'

const fs = require('fs')
const path = require('path')

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
  'progressive-skill-route-contract.cjs',
  'runtime-skill-identity-index.cjs',
  'model-skill-catalog.cjs',
  'workflow-root-registry.cjs',
  'workflow-root-registry.v1.json',
  'progressive-skill-plan.cjs',
  'skill-route-mode.cjs',
  'skill-route-state.cjs',
  'skill-route-tool.cjs',
  'host-adapter-identity.cjs',
  'global-skill-runtime-root.cjs',
  'context-read-contract.cjs',
  'context-plan-observation.cjs',
  'derived-state-store.cjs',
  'skill-resolution.cjs',
  'workspace-layout.cjs',
  'devcodex-md-entry.cjs',
  'lifecycle-bootstrap-state.cjs',
  'lifecycle-host-adapters.cjs',
  'lifecycle.cjs'
])
const RUNTIME_CONTRACT_SKILL_SCHEMAS = Object.freeze([
  'skill-intent.v1.schema.json',
  'workflow-root-registry.v1.schema.json',
  'progressive-skill-route.v1.schema.json'
])
const CAPABILITY_STATUSES = new Set(['PASS', 'WARN', 'BLOCK', 'UNVERIFIED', 'N/A'])

function readJson (file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function validateCapabilityDocument (document) {
  const errors = []
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { valid: false, errors: ['capability-document-object-required'] }
  }
  if (document.schemaVersion !== 'HostSkillRouteCapabilityV1') {
    errors.push('capability-schema-version')
  }
  if (!Array.isArray(document.capabilities) ||
      !document.capabilities.length ||
      document.capabilities.length > 32) {
    errors.push('capability-list')
    return { valid: false, errors }
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
    }
  }
  return { valid: errors.length === 0, errors }
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
        fsImpl.readFileSync(path.join(__dirname, file), 'utf8')
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
        fsImpl.readFileSync(path.join(skillRuntime.root, '_schemas', file), 'utf8')
      )
    } catch {
      runtimeFileDigests[key] = 'missing'
    }
  }
  const mcpAdapterPath = path.resolve(
    options.mcpAdapterPath ||
    path.join(__dirname, '..', '..', 'mcp', 'profile-server.js')
  )
  try {
    runtimeFileDigests['mcp/profile-server.js'] = sha256(
      fsImpl.readFileSync(mcpAdapterPath, 'utf8')
    )
  } catch {
    runtimeFileDigests['mcp/profile-server.js'] = 'missing'
  }
  return sha256({
    schemaVersion: 'ProgressiveSkillRouteRuntimeContractV1',
    modePolicyVersion: MODE_POLICY_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    tool: 'skill_route',
    ops: ['catalog', 'commit', 'load_stage', 'status'],
    schemas: [
      'SkillIntentV1',
      'WorkflowRootRegistryV1',
      'ProgressiveSkillPlanV1',
      'StageLoadReceiptV1',
      'TurnRouteEnvelopeV1'
    ],
    registryDigest,
    runtimeFileDigests
  })
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
    (env.CLAUDE_PROJECT_DIR ? 'claude-code' : '')
  )
  const project = String(options.project || '').trim()
  const capabilityDoc = readJson(options.capabilityPath || CAPABILITY_PATH, options.fs || fs)
  const capabilityValidation = validateCapabilityDocument(capabilityDoc)
  const capability = capabilityValidation.valid && capabilityDoc.capabilities.find(item =>
    item.hostVariant === hostVariant
  ) || null
  const requested = SOURCE_DEFAULT
  const probe = validateProbeAuthority(
    env.DEVCODEX_SKILL_ROUTE_PROBE_AUTHORITY,
    { project, hostVariant },
    options
  )
  const runtimeContractDigest = getRuntimeContractDigest(options)
  const capabilityRuntimeCurrent = !!capability &&
    DIGEST_RE.test(String(capability.runtimeContractDigest || '')) &&
    capability.runtimeContractDigest === runtimeContractDigest
  const capabilityAdapterCurrent = !!capability &&
    DIGEST_RE.test(String(capability.hostAdapterDigest || '')) &&
    DIGEST_RE.test(String(options.hostAdapterDigest || '')) &&
    capability.hostAdapterDigest === options.hostAdapterDigest
  const capabilityEligible = capability?.status === 'PASS' &&
    capabilityRuntimeCurrent &&
    capabilityAdapterCurrent
  let effective = SOURCE_DEFAULT
  let source = 'source-default'
  let reason = 'unified-default'
  if (probe.valid) {
    effective = 'unified'
    source = 's15-probe-authority'
    reason = probe.reasonCode
  }
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
    hookRuntimeDigest: runtimeContractDigest,
    mcpRuntimeDigest: runtimeContractDigest,
    capabilityDigest: capabilityDoc ? sha256(capabilityDoc) : null,
    capabilityDocumentValid: capabilityValidation.valid,
    capabilityDocumentErrors: capabilityValidation.errors,
    capabilityRuntimeCurrent,
    capabilityAdapterCurrent,
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
  getRuntimeContractDigest,
  validateCapabilityDocument,
  validateProbeAuthority,
  resolveSkillRouteMode
}
