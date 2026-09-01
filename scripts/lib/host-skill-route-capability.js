'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { sha256 } = require('../../hooks/_runtime/progressive-skill-route-contract.cjs')
const {
  HOST_ENTRY_SURFACES,
  getLifecycleHostAdapterDigest
} = require('../../hooks/_runtime/host-adapter-identity.cjs')
const {
  getRuntimeContractDigest,
  validateCapabilityDocument
} = require('../../hooks/_runtime/skill-route-mode.cjs')

const CODEX_HOST = 'codex'
const CODEX_VARIANT = 'codex-cli/exec-user-global-local-stdio'
const PROTOCOL_VERSION = '2024-11-05'
const CAPABILITY_REF = 'hooks/_runtime/host-skill-route-capabilities.v1.json'
const EVIDENCE_REF = 'hooks/_runtime/evidence/codex-skill-route-pass.v1.json'
const REQUIRED_OPS = Object.freeze([
  'profile_context_plan',
  'profile_load',
  'memory_status',
  'catalog',
  'commit',
  'context-refresh',
  'rebind',
  'load_stage',
  'status'
])
const REQUIRED_STAGES = Object.freeze(['entry', 'closeout'])
const RETIREMENT_ANOMALIES = Object.freeze([
  'legacyFallback',
  'doubleBody',
  'crossRoot',
  'stateCorruption',
  'missingStage',
  'missingCloseout'
])
const DIGEST_RE = /^[a-f0-9]{64}$/

class HostSkillRouteCapabilityError extends Error {
  constructor (code, message, details = {}) {
    super(message)
    this.name = 'HostSkillRouteCapabilityError'
    this.code = code
    this.details = details
  }
}

function fail (code, message, details = {}) {
  throw new HostSkillRouteCapabilityError(code, message, details)
}

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function rawDigest (value) {
  return sha256({ ...value, evidenceDigest: null })
}

function jsonBytes (value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function rawFileDigest (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function arrayExactly (actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
}

function setExactly (actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every(value => actual.includes(value))
}

function currentBindings (options = {}) {
  const runtimePackageRoot = path.resolve(
    options.runtimePackageRoot || options.packageRoot || path.join(__dirname, '..', '..')
  )
  const runtimeContractDigest = getRuntimeContractDigest({
    packageRoot: runtimePackageRoot,
    ...(options.runtimeOptions || {})
  })
  const hostAdapterDigest = getLifecycleHostAdapterDigest(CODEX_HOST, {
    entrySurface: HOST_ENTRY_SURFACES.codex,
    env: {},
    ...(options.adapterOptions || {})
  })
  return { runtimeContractDigest, hostAdapterDigest }
}

function validateHostInvocation (invocation, bindings) {
  if (!invocation || invocation.schemaVersion !== 'HostInvocationEvidenceV1') {
    fail('HOST_SKILL_ROUTE_INVOCATION_INVALID', 'HostInvocationEvidenceV1 is required')
  }
  const descriptor = { ...invocation }
  delete descriptor.descriptorDigest
  if (!DIGEST_RE.test(String(invocation.descriptorDigest || '')) ||
      invocation.descriptorDigest !== sha256(descriptor)) {
    fail('HOST_SKILL_ROUTE_INVOCATION_DIGEST_MISMATCH', 'host invocation descriptor digest is invalid')
  }
  if (invocation.host !== CODEX_HOST || invocation.hostVariant !== CODEX_VARIANT ||
      invocation.entrySurface !== HOST_ENTRY_SURFACES.codex ||
      invocation.hostAdapterDigest !== bindings.hostAdapterDigest ||
      typeof invocation.ambientDesktopMarkersPresent !== 'boolean') {
    fail('HOST_SKILL_ROUTE_INVOCATION_IDENTITY_MISMATCH', 'host invocation is not an isolated Codex CLI exec')
  }
  if (!invocation.executable || !String(invocation.executable.command || '').trim() ||
      !Number.isInteger(invocation.argvCount) || invocation.argvCount < 1 ||
      !DIGEST_RE.test(String(invocation.argvDigest || '')) ||
      !Array.isArray(invocation.boundedArguments) || invocation.argumentsTruncated !== false) {
    fail('HOST_SKILL_ROUTE_INVOCATION_INCOMPLETE', 'host invocation evidence is incomplete')
  }
}

function validateRebind (raw, requiredStages) {
  const rebind = raw.contextRebind
  const order = rebind?.order
  const trace = order?.orderedRouteTrace
  if (rebind?.exercised !== true || rebind.ledgerEntries !== 1 ||
      rebind.finalGeneration !== 1 || raw.planGeneration !== 1 ||
      order?.schemaVersion !== 'SkillRouteS15RebindOrderV1' ||
      order.rebindGeneration !== 1 || order.preRebindStageLoads !== 0 ||
      !setExactly(order.generationOneStageIds, requiredStages) ||
      !Array.isArray(trace)) {
    fail('HOST_SKILL_ROUTE_REBIND_INVALID', 'the S15 evidence does not prove a single safe G0 to G1 rebind')
  }
  const commits = trace.filter(item => item?.op === 'commit' && item.generation === 0)
  const rebinds = trace.filter(item => item?.op === 'rebind' && item.generation === 1)
  const loads = trace.filter(item => item?.op === 'load_stage')
  if (commits.length !== 1 || rebinds.length !== 1 || loads.length < requiredStages.length) {
    fail('HOST_SKILL_ROUTE_REBIND_TRACE_INVALID', 'the rebind trace is missing the required commit, rebind, or stage loads')
  }
  const commit = commits[0]
  const rebound = rebinds[0]
  if (!Number.isInteger(commit.ledgerIndex) || !Number.isInteger(rebound.ledgerIndex) ||
      commit.ledgerIndex >= rebound.ledgerIndex ||
      loads.some(item => item.generation !== 1 || item.ledgerIndex <= rebound.ledgerIndex) ||
      !setExactly([...new Set(loads.map(item => item.stageId))], requiredStages) ||
      order.generationOneStageLoads !== loads.length) {
    fail('HOST_SKILL_ROUTE_REBIND_ORDER_INVALID', 'stage delivery did not occur exclusively after generation 1 rebind')
  }
  return {
    schemaVersion: 'SkillRouteS15RebindOrderV1',
    exercised: true,
    ledgerEntries: rebind.ledgerEntries,
    finalGeneration: rebind.finalGeneration,
    preRebindStageLoads: order.preRebindStageLoads,
    generationOneStageLoads: order.generationOneStageLoads,
    generationOneStageIds: [...order.generationOneStageIds],
    orderedOps: trace.map(item => item.op === 'load_stage'
      ? `load_stage:${item.stageId}@generation-${item.generation}`
      : `${item.op}@generation-${item.generation}`)
  }
}

function validateRawS15Evidence (raw, options = {}) {
  const bindings = currentBindings(options)
  if (!raw || raw.schemaVersion !== 'SkillRouteS15EvidenceV1' || raw.status !== 'PASS') {
    fail('HOST_SKILL_ROUTE_RAW_EVIDENCE_INVALID', 'a PASS SkillRouteS15EvidenceV1 document is required')
  }
  if (raw.host !== CODEX_HOST || raw.hostVariant !== CODEX_VARIANT ||
      raw.protocolVersion !== PROTOCOL_VERSION ||
      !/^s15-codex-probe-[a-f0-9-]{36}$/.test(String(raw.probeRunId || '')) ||
      !String(raw.testedVersion || '').trim()) {
    fail('HOST_SKILL_ROUTE_RAW_IDENTITY_MISMATCH', 'raw evidence must identify the Codex CLI S15 probe')
  }
  if (raw.authorizationSource !== 'isolated-probe-authority' ||
      raw.runtimeBinding?.source !== 'isolated-source-candidate') {
    fail('HOST_SKILL_ROUTE_RAW_AUTHORITY_INVALID', 'source-candidate evidence must use isolated probe authority')
  }
  if (raw.runtimeDigest !== bindings.runtimeContractDigest ||
      raw.runtimeBinding.expectedDigest !== bindings.runtimeContractDigest ||
      raw.runtimeBinding.generationDigest !== bindings.runtimeContractDigest ||
      raw.runtimeBinding.modeReceiptDigest !== bindings.runtimeContractDigest ||
      raw.runtimeBinding.routeEnvelopeDigest !== bindings.runtimeContractDigest) {
    fail('HOST_SKILL_ROUTE_RUNTIME_DIGEST_MISMATCH', 'raw evidence is stale for the current runtime contract')
  }
  if (raw.hostAdapterDigest !== bindings.hostAdapterDigest) {
    fail('HOST_SKILL_ROUTE_ADAPTER_DIGEST_MISMATCH', 'raw evidence is stale for the current Codex host adapter')
  }
  if (raw.routeActivation?.requested !== 'unified' ||
      raw.routeActivation.effective !== 'unified' ||
      raw.routeActivation.probeAuthorityUsed !== true) {
    fail('HOST_SKILL_ROUTE_ACTIVATION_INVALID', 'raw evidence did not exercise the unified route under probe authority')
  }
  validateHostInvocation(raw.hostInvocation, bindings)
  const observedOps = new Set(Array.isArray(raw.observedOps) ? raw.observedOps : [])
  if (!REQUIRED_OPS.every(op => observedOps.has(op)) || raw.processComplete !== true) {
    fail('HOST_SKILL_ROUTE_PROBE_INCOMPLETE', 'raw evidence is missing required S15 operations')
  }
  if (!arrayExactly(raw.requiredStageIds, REQUIRED_STAGES) ||
      !arrayExactly(raw.loadedStageIds, REQUIRED_STAGES)) {
    fail('HOST_SKILL_ROUTE_STAGE_CLOSURE_INVALID', 'entry and closeout must be loaded in dependency order')
  }
  const observedTools = raw.contextAcquisition?.observedTools
  const observedToolLeaf = leaf => Array.isArray(observedTools) && observedTools.some(tool => {
    const value = String(tool || '')
    return value === leaf || value.endsWith(`/${leaf}`) || value.endsWith(`__${leaf}`)
  })
  if (raw.contextAcquisition?.prewritten !== false ||
      raw.contextAcquisition.receiptStatus !== 'relevant-complete' ||
      !Array.isArray(observedTools) ||
      !['profile_load', 'memory_status'].every(observedToolLeaf)) {
    fail('HOST_SKILL_ROUTE_CONTEXT_RECEIPT_INVALID', 'fresh relevant-complete ContextRead evidence is required')
  }
  const rebindSummary = validateRebind(raw, REQUIRED_STAGES)
  if (!raw.retirementAnomalies || RETIREMENT_ANOMALIES.some(key =>
    !Object.prototype.hasOwnProperty.call(raw.retirementAnomalies, key) ||
    raw.retirementAnomalies[key] !== 0
  )) {
    fail('HOST_SKILL_ROUTE_RETIREMENT_ANOMALY', 'all legacy retirement anomaly counters must be zero')
  }
  const transport = raw.transport
  if (transport?.kind !== 'local-stdio' || transport.networkListener !== false ||
      transport.longRunningServiceStarted !== false ||
      transport.childExitedWithHost !== true ||
      !Array.isArray(transport.servers) ||
      !['devcodex-profile', 'devcodex-memory'].every(server => transport.servers.includes(server))) {
    fail('HOST_SKILL_ROUTE_TRANSPORT_INVALID', 'the probe must use bounded local stdio with exited child processes')
  }
  const startedAt = Date.parse(raw.startedAt)
  const completedAt = Date.parse(raw.completedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    fail('HOST_SKILL_ROUTE_TIME_INVALID', 'raw evidence timestamps are invalid')
  }
  const expectedRawDigest = rawDigest(raw)
  if (!DIGEST_RE.test(String(raw.evidenceDigest || '')) || raw.evidenceDigest !== expectedRawDigest) {
    fail('HOST_SKILL_ROUTE_RAW_DIGEST_MISMATCH', 'raw S15 evidence digest is invalid')
  }
  return { bindings, rebindSummary, expectedRawDigest }
}

function buildPortableEvidence (raw, validated) {
  return {
    schemaVersion: 'HostSkillRouteEvidenceV1',
    status: 'PASS',
    portable: true,
    hostVariant: CODEX_VARIANT,
    testedVersion: raw.testedVersion,
    protocol: `MCP ${PROTOCOL_VERSION}`,
    runtimeContractDigest: validated.bindings.runtimeContractDigest,
    hostAdapterDigest: validated.bindings.hostAdapterDigest,
    sourceEvidenceDigest: validated.expectedRawDigest,
    sourceProbe: {
      schemaVersion: raw.schemaVersion,
      probeRunId: raw.probeRunId,
      authorizationSource: raw.authorizationSource,
      contextSource: raw.contextAcquisition.source,
      observationMode: raw.contextAcquisition.observationMode,
      receiptStatus: raw.contextAcquisition.receiptStatus,
      completedAt: raw.completedAt
    },
    runtimeBinding: clone(raw.runtimeBinding),
    probe: {
      schemaVersion: 'SkillRouteProbeSummaryV1',
      processComplete: true,
      observedOps: [...raw.observedOps],
      requiredStageIds: [...raw.requiredStageIds],
      loadedStageIds: [...raw.loadedStageIds],
      contextRebind: validated.rebindSummary,
      retirementAnomalies: clone(raw.retirementAnomalies),
      transport: clone(raw.transport)
    }
  }
}

function candidateCapabilityDocument (current, raw, bindings, evidenceDigest) {
  if (!current || current.schemaVersion !== 'HostSkillRouteCapabilityV1' ||
      !Array.isArray(current.capabilities)) {
    fail('HOST_SKILL_ROUTE_CAPABILITY_DOCUMENT_INVALID', 'canonical capability document is invalid')
  }
  const codex = current.capabilities.filter(item => item?.hostVariant === CODEX_VARIANT)
  if (codex.length !== 1) {
    fail('HOST_SKILL_ROUTE_CODEX_CAPABILITY_CARDINALITY', 'exactly one Codex CLI capability entry is required')
  }
  const unexpectedPass = current.capabilities.find(item =>
    item?.hostVariant !== CODEX_VARIANT && item?.status === 'PASS'
  )
  if (unexpectedPass) {
    fail('HOST_SKILL_ROUTE_NON_CODEX_PASS_PRESENT', 'the Codex promotion may not authorize another host', {
      hostVariant: unexpectedPass.hostVariant
    })
  }
  const next = clone(current)
  const index = next.capabilities.findIndex(item => item.hostVariant === CODEX_VARIANT)
  next.capabilities[index] = {
    ...next.capabilities[index],
    status: 'PASS',
    testedVersion: raw.testedVersion,
    protocol: `MCP ${PROTOCOL_VERSION}`,
    runtimeContractDigest: bindings.runtimeContractDigest,
    hostAdapterDigest: bindings.hostAdapterDigest,
    evidenceRef: EVIDENCE_REF,
    evidenceDigest,
    entrySurface: 'codex exec --ephemeral',
    bootstrapDelivery: next.capabilities[index].bootstrapDelivery ||
      'stable user-global Hook launcher UserPromptSubmit or profile_context_plan fallback',
    defaultEligible: true
  }
  return next
}

function overlayEvidenceFs (fsImpl, evidencePath, evidenceBytes) {
  const expected = path.resolve(evidencePath)
  return new Proxy(fsImpl, {
    get (target, property) {
      if (property === 'readFileSync') {
        return (file, ...args) => path.resolve(file) === expected
          ? (args[0] ? evidenceBytes.toString(args[0]) : Buffer.from(evidenceBytes))
          : target.readFileSync(file, ...args)
      }
      if (property === 'lstatSync') {
        return (file, ...args) => path.resolve(file) === expected
          ? { isFile: () => true, isSymbolicLink: () => false }
          : target.lstatSync(file, ...args)
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

function assertRegularCanonicalFile (file, fsImpl) {
  let stat
  try {
    stat = fsImpl.lstatSync(file)
  } catch {
    fail('HOST_SKILL_ROUTE_CANONICAL_FILE_MISSING', `canonical file is missing: ${file}`)
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('HOST_SKILL_ROUTE_CANONICAL_FILE_UNSAFE', `canonical file must be a regular non-symlink: ${file}`)
  }
}

function replaceCanonicalPair (files, options = {}) {
  const fsImpl = options.fs || fs
  const transactionId = options.transactionId || crypto.randomUUID()
  const states = files.map((item, index) => ({
    ...item,
    stage: `${item.path}.devcodex-stage-${transactionId}-${index}`,
    backup: `${item.path}.devcodex-backup-${transactionId}-${index}`,
    original: fsImpl.readFileSync(item.path),
    backedUp: false,
    replaced: false
  }))
  const cleanup = file => {
    if (fsImpl.existsSync(file)) fsImpl.unlinkSync(file)
  }
  const rollback = () => {
    const errors = []
    for (const state of [...states].reverse()) {
      try {
        if (state.replaced && fsImpl.existsSync(state.path)) fsImpl.unlinkSync(state.path)
        if (state.backedUp && fsImpl.existsSync(state.backup)) fsImpl.renameSync(state.backup, state.path)
        cleanup(state.stage)
        cleanup(state.backup)
        if (!fsImpl.readFileSync(state.path).equals(state.original)) {
          throw new Error(`rollback readback mismatch: ${state.path}`)
        }
      } catch (error) {
        errors.push(String(error.message || error))
      }
    }
    return errors
  }
  try {
    for (const state of states) {
      fsImpl.writeFileSync(state.stage, state.bytes, { flag: 'wx' })
      if (!fsImpl.readFileSync(state.stage).equals(state.bytes)) {
        fail('HOST_SKILL_ROUTE_STAGE_READBACK_FAILED', `staged bytes did not read back: ${state.path}`)
      }
    }
    for (const state of states) {
      fsImpl.renameSync(state.path, state.backup)
      state.backedUp = true
      fsImpl.renameSync(state.stage, state.path)
      state.replaced = true
      if (!fsImpl.readFileSync(state.path).equals(state.bytes)) {
        fail('HOST_SKILL_ROUTE_CANONICAL_READBACK_FAILED', `canonical bytes did not read back: ${state.path}`)
      }
    }
    if (typeof options.validateReadback === 'function') options.validateReadback()
  } catch (error) {
    const rollbackErrors = rollback()
    if (rollbackErrors.length) {
      fail('HOST_SKILL_ROUTE_ROLLBACK_FAILED', 'canonical evidence rollback failed', {
        cause: String(error.message || error),
        rollbackErrors
      })
    }
    fail('HOST_SKILL_ROUTE_PROMOTION_FAILED', 'canonical evidence promotion failed and was rolled back', {
      causeCode: error.code || null,
      cause: String(error.message || error)
    })
  }
  for (const state of states) cleanup(state.backup)
  return { transactionId }
}

function promoteCodexSkillRouteCapability (raw, options = {}) {
  const fsImpl = options.fs || fs
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const capabilityPath = path.resolve(options.capabilityPath || path.join(packageRoot, ...CAPABILITY_REF.split('/')))
  const evidencePath = path.resolve(options.evidencePath || path.join(packageRoot, ...EVIDENCE_REF.split('/')))
  assertRegularCanonicalFile(capabilityPath, fsImpl)
  assertRegularCanonicalFile(evidencePath, fsImpl)
  const validated = validateRawS15Evidence(raw, { ...options, packageRoot })
  const portableEvidence = buildPortableEvidence(raw, validated)
  const evidenceBytes = jsonBytes(portableEvidence)
  const evidenceDigest = rawFileDigest(evidenceBytes)
  const currentCapability = JSON.parse(fsImpl.readFileSync(capabilityPath, 'utf8'))
  const candidateCapability = candidateCapabilityDocument(
    currentCapability,
    raw,
    validated.bindings,
    evidenceDigest
  )
  const capabilityBytes = jsonBytes(candidateCapability)
  const overlay = overlayEvidenceFs(fsImpl, evidencePath, evidenceBytes)
  const preflight = validateCapabilityDocument(candidateCapability, {
    packageRoot,
    fs: overlay
  })
  if (!preflight.valid) {
    fail('HOST_SKILL_ROUTE_CANDIDATE_INVALID', 'candidate capability and portable evidence are inconsistent', {
      errors: preflight.errors
    })
  }
  const transaction = replaceCanonicalPair([
    { path: evidencePath, bytes: evidenceBytes },
    { path: capabilityPath, bytes: capabilityBytes }
  ], {
    fs: fsImpl,
    transactionId: options.transactionId,
    validateReadback: () => {
      const readback = validateCapabilityDocument(
        JSON.parse(fsImpl.readFileSync(capabilityPath, 'utf8')),
        { packageRoot, fs: fsImpl }
      )
      if (!readback.valid) {
        fail('HOST_SKILL_ROUTE_READBACK_INVALID', 'canonical pair failed full readback validation', {
          errors: readback.errors
        })
      }
    }
  })
  const completedAt = options.completedAt || new Date().toISOString()
  const receipt = {
    schemaVersion: 'HostSkillRouteCapabilityPromotionReceiptV1',
    status: 'committed',
    hostVariant: CODEX_VARIANT,
    probeRunId: raw.probeRunId,
    runtimeContractDigest: validated.bindings.runtimeContractDigest,
    hostAdapterDigest: validated.bindings.hostAdapterDigest,
    sourceEvidenceDigest: validated.expectedRawDigest,
    portableEvidenceDigest: evidenceDigest,
    capabilityDocumentDigest: rawFileDigest(capabilityBytes),
    evidenceRef: EVIDENCE_REF,
    transactionId: transaction.transactionId,
    completedAt
  }
  receipt.receiptDigest = sha256({ ...receipt, receiptDigest: null })
  return receipt
}

module.exports = {
  CAPABILITY_REF,
  CODEX_VARIANT,
  EVIDENCE_REF,
  HostSkillRouteCapabilityError,
  PROTOCOL_VERSION,
  REQUIRED_OPS,
  REQUIRED_STAGES,
  buildPortableEvidence,
  currentBindings,
  promoteCodexSkillRouteCapability,
  rawDigest,
  validateRawS15Evidence
}
