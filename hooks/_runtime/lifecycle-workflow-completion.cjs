'use strict'

const fs = require('fs')
const path = require('path')
const { buildJsonContentIdentity, sha256, stableStringify } = require('./content-identity.cjs')
const { createDerivedStateStore } = require('./derived-state-store.cjs')
const {
  createCommitValidationResult,
  createRiskAcceptanceReceipt,
  createWorkflowEvidenceReceipt,
  evaluateShadowEvidenceWindow,
  evaluateWorkflowCompletion,
  projectWorkflowCompletion,
  validateRiskAcceptanceReceipt,
  validateWorkflowCompletionCandidate,
  validateWorkflowCompletionPlan
} = require('./workflow-completion-contract.cjs')

const LIFECYCLE_STATE_SCHEMA = 'WorkflowCompletionLifecycleStateV1'
const DERIVED_STATE_SCHEMA = 'WorkflowCompletionDerivedStateV1'
const RECONCILIATION_SCHEMA = 'WorkflowCompletionReconciliationV1'
const SOURCE_REF_SCHEMA = 'WorkflowCompletionSourceRefV1'
const MAX_SOURCE_REFS = 100
const MAX_DERIVED_STATE_BYTES = 512 * 1024
const MAX_PROFILE_CONFIG_BYTES = 64 * 1024
const WORKFLOW_INPUT_SCHEMA = 'WorkflowCompletionInputV1'
const RISK_LEDGER_MAX_BYTES = 512 * 1024
const SHADOW_STATE_SCHEMA = 'ShadowEvidenceWindowStateV1'
const SHADOW_STATE_MAX_BYTES = 512 * 1024
const SHADOW_SAMPLE_LIMIT = 1000
const OWNER_SPECS = Object.freeze({
  cp: { sourceKind: 'cp', evidenceLevel: 'E1', satisfiesRequired: true, trusted: true },
  'execution-contract': { sourceKind: 'checkpoint', evidenceLevel: 'E4', satisfiesRequired: false, trusted: false },
  attempt: { sourceKind: 'attempt', evidenceLevel: 'E2', satisfiesRequired: true, trusted: true },
  validation: { sourceKind: 'validation', evidenceLevel: 'E1', satisfiesRequired: true, trusted: true },
  review: { sourceKind: 'review', evidenceLevel: 'E2', satisfiesRequired: true, trusted: true },
  checkpoint: { sourceKind: 'checkpoint', evidenceLevel: 'E3', satisfiesRequired: true, trusted: true },
  sync: { sourceKind: 'sync', evidenceLevel: 'E2', satisfiesRequired: true, trusted: true },
  delivery: { sourceKind: 'delivery', evidenceLevel: 'E1', satisfiesRequired: true, trusted: true },
  manual: { sourceKind: 'manual', evidenceLevel: 'E5', satisfiesRequired: false, trusted: false }
})
const HOST_COMPLETION_ROUTES = Object.freeze({
  codex: Object.freeze({ defaultSurface: 'cli-app', directSurfaces: Object.freeze(['cli-app']), enforcementCeiling: 'partial' }),
  claude: Object.freeze({ defaultSurface: 'code', directSurfaces: Object.freeze(['code']), enforcementCeiling: 'host-supported' }),
  copilot: Object.freeze({ defaultSurface: 'cli-cloud', directSurfaces: Object.freeze(['cli-cloud']), enforcementCeiling: 'surface-dependent' }),
  gemini: Object.freeze({ defaultSurface: 'cli', directSurfaces: Object.freeze(['cli']), enforcementCeiling: 'retry-supported' }),
  grok: Object.freeze({ defaultSurface: 'build', directSurfaces: Object.freeze(['build']), enforcementCeiling: 'pre-tool-only' })
})

class WorkflowCompletionLifecycleError extends Error {
  constructor(code, message, details = []) {
    super(message)
    this.name = 'WorkflowCompletionLifecycleError'
    this.code = code
    this.details = details
  }
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizedNow(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function completionRouteForHost(host, options = {}) {
  const hostId = String(host || '').trim().toLowerCase()
  const definition = HOST_COMPLETION_ROUTES[hostId]
  if (!definition) throw new WorkflowCompletionLifecycleError('WORKFLOW_HOST_UNSUPPORTED', `unsupported workflow completion host: ${hostId || 'missing'}`)
  const surface = String(options.surface || definition.defaultSurface)
  const adapterUsable = options.adapterEnabled !== false && options.trusted !== false
  const surfaceDirectCapable = definition.directSurfaces.includes(surface)
  const directObserved = adapterUsable && surfaceDirectCapable && options.directReplay === true && options.sourceObserved === true
  const evidenceMode = directObserved
    ? 'direct-replay'
    : (adapterUsable ? 'portable-receipt' : 'instruction-fallback')
  return Object.freeze({
    schemaVersion: 'HostCompletionRouteV1',
    hostSurface: hostId,
    surface,
    semanticReducer: 'workflow-completion-contract',
    evidenceMode,
    evidenceCeiling: directObserved ? 'verified' : 'UNVERIFIED',
    enforcementCeiling: definition.enforcementCeiling,
    visibleReplyEvidence: options.outputObserved === true ? 'verified-present' : 'unverified',
    fallbackReason: directObserved
      ? null
      : (!adapterUsable ? (options.trusted === false ? 'adapter-untrusted' : 'adapter-disabled') : (surfaceDirectCapable ? 'direct-replay-unobserved' : 'surface-not-direct-capable'))
  })
}

function stableTaskKey(taskKey) {
  const normalized = String(taskKey || '').normalize('NFKC').trim().replace(/\\/g, '/')
  if (!normalized) throw new WorkflowCompletionLifecycleError('WORKFLOW_TASK_KEY_REQUIRED', 'taskKey is required')
  return normalized
}

function taskKeyDigest(taskKey) {
  return sha256(stableTaskKey(taskKey))
}

function derivedStateRelativePath(taskKey) {
  return path.posix.join('.runtime-state', 'workflow-completion', `${taskKeyDigest(taskKey)}.json`)
}

function normalizeLifecycleState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const refs = Array.isArray(source.sourceRefs) ? source.sourceRefs.filter(item => item && typeof item === 'object').slice(-MAX_SOURCE_REFS) : []
  return {
    schemaVersion: LIFECYCLE_STATE_SCHEMA,
    sourceRefs: refs,
    overflow: source.overflow === true,
    finalReconcileRequested: source.finalReconcileRequested === true,
    lastEvent: text(source.lastEvent) ? source.lastEvent : '',
    lastObservedAt: text(source.lastObservedAt) ? source.lastObservedAt : '',
    lastReconciliation: source.lastReconciliation && typeof source.lastReconciliation === 'object' && !Array.isArray(source.lastReconciliation) ? source.lastReconciliation : null
  }
}

function sourceRefIdentity(owner, raw) {
  return buildJsonContentIdentity({
    sourceKey: `workflow-source:${owner}:${raw.schemaVersion || 'unknown'}`,
    value: raw,
    contractVersion: '1'
  }).identity
}

function normalizeResult(owner, raw) {
  if (owner === 'cp') return raw?.confirmed === true || raw?.status === 'confirmed' ? 'passed' : 'inconclusive'
  if (owner === 'execution-contract') return 'inconclusive'
  if (owner === 'attempt') {
    if (raw?.kind === 'planned' || raw?.plannedOnly === true) return 'inconclusive'
    if (raw?.result === 'passed') return 'passed'
    if (raw?.result === 'failed' || raw?.result === 'error') return 'failed'
    return 'inconclusive'
  }
  if (owner === 'validation') {
    if ((Number.isInteger(raw?.nativeExitCode) && raw.nativeExitCode !== 0) || raw?.failedNode) return 'failed'
    const selected = Number(raw?.selectedNodeCount ?? raw?.selectedNodes?.length ?? 0)
    const executed = Number(raw?.executionCount ?? raw?.executionOrder?.length ?? 0) + Number(raw?.cacheHitCount || 0)
    return selected > 0 && executed >= selected && !(raw?.requiredNodeMisses || []).length ? 'passed' : 'inconclusive'
  }
  if (owner === 'review') {
    const clean = raw?.nextAction === 'accept' && raw?.saturation === 'passed' &&
      [raw?.open, raw?.blocker, raw?.stale, raw?.unreviewed].every(value => Number(value || 0) === 0)
    return clean ? 'passed' : 'inconclusive'
  }
  if (owner === 'checkpoint') return raw?.status === 'pass' && raw?.evidenceState === 'verified' ? 'passed' : raw?.status === 'blocked' ? 'failed' : 'inconclusive'
  if (owner === 'sync') return ['passed', 'synced', 'fresh'].includes(raw?.status) ? 'passed' : raw?.status === 'failed' ? 'failed' : 'inconclusive'
  if (owner === 'delivery') return ['persisted', 'read-back', 'passed'].includes(raw?.status) ? 'passed' : raw?.status === 'failed' ? 'failed' : 'inconclusive'
  return 'inconclusive'
}

function buildSourceRef(input) {
  const owner = String(input?.owner || '')
  if (!OWNER_SPECS[owner]) throw new WorkflowCompletionLifecycleError('WORKFLOW_SOURCE_OWNER_INVALID', `unsupported workflow source owner: ${owner || 'missing'}`)
  if (!text(input?.requirementId)) throw new WorkflowCompletionLifecycleError('WORKFLOW_SOURCE_REQUIREMENT_REQUIRED', 'source requirementId is required')
  const raw = input.raw && typeof input.raw === 'object' ? input.raw : {}
  const observedAt = normalizedNow(input.observedAt || raw.observedAt || raw.completedAt || raw.generatedAt)
  const sourceIdentity = input.sourceIdentity || sourceRefIdentity(owner, raw)
  return Object.freeze({
    schemaVersion: SOURCE_REF_SCHEMA,
    owner,
    requirementId: input.requirementId,
    observedCandidateId: input.observedCandidateId || raw.candidateId || '',
    dependencyBindings: input.dependencyBindings || {},
    sourceSchema: input.sourceSchema || raw.schemaVersion || 'UnknownSourceV1',
    sourceIdentity,
    result: normalizeResult(owner, raw),
    observedAt,
    actor: input.actor || raw.actor || owner,
    host: input.host || raw.host || 'unknown',
    runId: input.runId || raw.runId || raw.eventId || raw.planId || `source-${sourceIdentity.digest.slice(0, 20)}`,
    evidenceRefs: [...new Set((input.evidenceRefs || []).map(value => String(value).trim()).filter(Boolean))].slice(0, MAX_SOURCE_REFS),
    rawStatus: raw.status || raw.result || null
  })
}

function qualificationFor(ref, requirement) {
  const spec = OWNER_SPECS[ref.owner]
  const passed = ref.result === 'passed'
  return {
    level: spec.evidenceLevel,
    satisfiesRequired: passed && spec.satisfiesRequired && requirement.applicability.decision === 'required',
    trusted: spec.trusted,
    observable: ref.owner !== 'manual',
    warning: ref.owner === 'manual' || ref.result === 'inconclusive'
  }
}

function adaptSourceRef(ref, candidate, requirement) {
  if (ref?.schemaVersion !== SOURCE_REF_SCHEMA) {
    throw new WorkflowCompletionLifecycleError('WORKFLOW_SOURCE_SCHEMA_INVALID', 'source ref schema is invalid')
  }
  if (!OWNER_SPECS[ref.owner]) throw new WorkflowCompletionLifecycleError('WORKFLOW_SOURCE_OWNER_INVALID', `unsupported owner: ${ref.owner}`)
  if (ref.requirementId !== requirement.requirementId) throw new WorkflowCompletionLifecycleError('WORKFLOW_SOURCE_REQUIREMENT_MISMATCH', 'source requirement does not match plan requirement')
  return createWorkflowEvidenceReceipt({
    requirementId: ref.requirementId,
    observedCandidateId: ref.observedCandidateId,
    dependencyBindings: ref.dependencyBindings,
    sourceKind: OWNER_SPECS[ref.owner].sourceKind,
    sourceSchema: ref.sourceSchema,
    sourceIdentity: ref.sourceIdentity,
    result: ref.result,
    observedAt: ref.observedAt,
    actor: ref.actor,
    host: ref.host,
    runId: ref.runId,
    evidenceRefs: ref.evidenceRefs,
    qualification: qualificationFor(ref, requirement)
  })
}

function adaptSourceRefs(sourceRefs, candidate, plan) {
  const receipts = []
  const diagnostics = []
  if (!Array.isArray(sourceRefs)) return { valid: false, receipts, diagnostics: ['source-refs-invalid'] }
  if (sourceRefs.length > MAX_SOURCE_REFS) return { valid: false, receipts, diagnostics: ['source-ref-cap-exceeded'] }
  const requirementMap = new Map(plan.requirements.map(item => [item.requirementId, item]))
  for (const ref of sourceRefs) {
    const requirement = requirementMap.get(ref?.requirementId)
    if (!requirement) {
      diagnostics.push(`source-requirement-unknown:${ref?.requirementId || 'missing'}`)
      continue
    }
    try {
      receipts.push(adaptSourceRef(ref, candidate, requirement))
    } catch (error) {
      diagnostics.push(`${error.code || 'WORKFLOW_SOURCE_ADAPT_FAILED'}:${ref?.requirementId || 'missing'}`)
    }
  }
  return { valid: diagnostics.length === 0, receipts, diagnostics }
}

function createCompletionStore({ activeRoot, taskKey, now, maxBytes = MAX_DERIVED_STATE_BYTES, lockWaitMs = 2000, maxWrites = 1 }) {
  if (!text(activeRoot)) throw new WorkflowCompletionLifecycleError('WORKFLOW_ACTIVE_ROOT_REQUIRED', 'activeRoot is required')
  return createDerivedStateStore({
    root: activeRoot,
    relativePath: derivedStateRelativePath(taskKey),
    maxBytes,
    lockWaitMs,
    maxWrites,
    identityField: 'candidateIdentity',
    now
  })
}

function previousHeader(readReceipt) {
  const previous = readReceipt?.value?.current
  if (!previous) return null
  return {
    candidateId: previous.candidateId || null,
    coreSnapshotDigest: previous.coreSnapshotDigest || null,
    generatedAt: previous.generatedAt || null
  }
}

/** Normalize owner receipts, call the sole reducer and atomically cache current + previous header. */
function reconcileWorkflowCompletion(input) {
  const candidateCheck = validateWorkflowCompletionCandidate(input?.candidate)
  const planCheck = validateWorkflowCompletionPlan(input?.plan, input?.candidate)
  if (!candidateCheck.valid || !planCheck.valid) {
    throw new WorkflowCompletionLifecycleError('WORKFLOW_RECONCILIATION_INPUT_INVALID', 'candidate or plan is invalid', [...candidateCheck.errors, ...planCheck.errors])
  }
  const taskKey = stableTaskKey(input.taskKey)
  const adapted = adaptSourceRefs(input.sourceRefs || [], input.candidate, input.plan)
  if (!adapted.valid && adapted.diagnostics.includes('source-ref-cap-exceeded')) {
    return Object.freeze({
      schemaVersion: RECONCILIATION_SCHEMA,
      status: 'UNVERIFIED',
      taskKeyDigest: taskKeyDigest(taskKey),
      snapshot: null,
      storeReceipt: null,
      diagnostics: adapted.diagnostics
    })
  }
  const snapshot = evaluateWorkflowCompletion({
    candidate: input.candidate,
    plan: input.plan,
    receipts: adapted.receipts,
    riskReceipts: input.riskReceipts || [],
    rollout: input.rollout,
    generatedAt: input.generatedAt,
    now: input.nowMs
  })
  const store = input.store || createCompletionStore(input)
  const existing = store.read()
  const value = {
    schemaVersion: DERIVED_STATE_SCHEMA,
    taskKeyDigest: taskKeyDigest(taskKey),
    candidateIdentity: input.candidate.candidateIdentity,
    current: snapshot,
    previous: previousHeader(existing),
    sourceReceiptDigests: adapted.receipts.map(item => item.sourceDigest).sort(),
    adapterDiagnostics: adapted.diagnostics
  }
  const storeReceipt = input.persist === false ? { schemaVersion: 'DerivedStateStoreReceiptV1', status: 'bypassed', errorCode: 'PERSIST_DISABLED' } : store.write(value)
  const persisted = storeReceipt.status === 'persisted'
  return Object.freeze({
    schemaVersion: RECONCILIATION_SCHEMA,
    status: persisted || input.persist === false ? snapshot.coreEvidenceState : 'UNVERIFIED',
    taskKeyDigest: value.taskKeyDigest,
    snapshot,
    storeReceipt,
    diagnostics: persisted || input.persist === false ? adapted.diagnostics : adapted.diagnostics.concat(`store-${storeReceipt.status}:${storeReceipt.errorCode || 'unknown'}`)
  })
}

function readWorkflowCompletionState(input) {
  const taskKey = stableTaskKey(input.taskKey)
  const store = input.store || createCompletionStore(input)
  const receipt = store.read({ expectedIdentity: input.candidateIdentity || null })
  if (receipt.status !== 'fresh') return { status: receipt.status, taskKeyDigest: taskKeyDigest(taskKey), value: null, storeReceipt: receipt }
  if (receipt.value?.schemaVersion !== DERIVED_STATE_SCHEMA || receipt.value.taskKeyDigest !== taskKeyDigest(taskKey)) {
    return { status: 'invalid', taskKeyDigest: taskKeyDigest(taskKey), value: null, storeReceipt: receipt, errorCode: 'WORKFLOW_DERIVED_STATE_SCOPE_MISMATCH' }
  }
  return { status: 'fresh', taskKeyDigest: taskKeyDigest(taskKey), value: receipt.value, storeReceipt: receipt }
}

function workflowInputPath(taskRoot) {
  if (!text(taskRoot)) throw new WorkflowCompletionLifecycleError('WORKFLOW_TASK_ROOT_REQUIRED', 'taskRoot is required')
  return path.join(path.resolve(taskRoot), '.memory', 'workflow-completion-input.json')
}

function validateWorkflowCompletionInput(value) {
  const candidateCheck = validateWorkflowCompletionCandidate(value?.candidate)
  const planCheck = validateWorkflowCompletionPlan(value?.plan, value?.candidate)
  const errors = []
  if (value?.schemaVersion !== WORKFLOW_INPUT_SCHEMA) errors.push('workflow-input-schema-invalid')
  errors.push(...candidateCheck.errors, ...planCheck.errors)
  if (!Array.isArray(value?.sourceRefs)) errors.push('workflow-input-source-refs-invalid')
  else {
    const adapted = candidateCheck.valid && planCheck.valid
      ? adaptSourceRefs(value.sourceRefs, value.candidate, value.plan)
      : { valid: true, diagnostics: [] }
    if (!adapted.valid) errors.push(...adapted.diagnostics.map(error => `workflow-input-${error}`))
  }
  if (value?.rollout?.schemaVersion !== 'RolloutStateV1') errors.push('workflow-input-rollout-schema-invalid')
  if (!['off', 'shadow', 'enforce', 'rolled-back'].includes(value?.rollout?.mode)) errors.push('workflow-input-rollout-mode-invalid')
  if (value?.rollout?.ruleSetDigest !== value?.plan?.ruleSetDigest) errors.push('workflow-input-rollout-ruleset-mismatch')
  if (!Number.isFinite(Date.parse(String(value?.generatedAt || '')))) errors.push('workflow-input-generated-at-invalid')
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

/** Atomically materialize the task-local input consumed by task verify and read-only diagnostics. */
function materializeWorkflowCompletionInput({ taskRoot, value, lockWaitMs = 2000, now = () => Date.now() } = {}) {
  const check = validateWorkflowCompletionInput(value)
  if (!check.valid) throw new WorkflowCompletionLifecycleError('WORKFLOW_INPUT_INVALID', 'workflow completion input is invalid', check.errors)
  const store = createDerivedStateStore({
    root: taskRoot,
    relativePath: path.posix.join('.memory', 'workflow-completion-input.json'),
    maxBytes: MAX_DERIVED_STATE_BYTES,
    lockWaitMs,
    maxWrites: 1,
    identityField: 'candidateIdentity',
    now
  })
  const storeReceipt = store.write(value)
  if (storeReceipt.status !== 'persisted') {
    return { schemaVersion: 'WorkflowCompletionInputWriteResultV1', status: 'UNVERIFIED', filePath: store.filePath, storeReceipt, inputIdentity: null }
  }
  const readBack = readWorkflowCompletionInput(taskRoot)
  const inputIdentity = buildJsonContentIdentity({ sourceKey: `workflow-input:${value.candidate.candidateId}`, value, contractVersion: '1' }).identity
  if (readBack.status !== 'fresh' || stableStringify(readBack.value) !== stableStringify(value)) {
    return { schemaVersion: 'WorkflowCompletionInputWriteResultV1', status: 'UNVERIFIED', filePath: store.filePath, storeReceipt: readBack, inputIdentity: null }
  }
  return { schemaVersion: 'WorkflowCompletionInputWriteResultV1', status: 'persisted', filePath: store.filePath, storeReceipt, inputIdentity }
}

function readWorkflowCompletionRollout(activeRoot, inputRollout = {}) {
  if (!text(activeRoot)) throw new WorkflowCompletionLifecycleError('WORKFLOW_ACTIVE_ROOT_REQUIRED', 'activeRoot is required')
  const filePath = path.join(path.resolve(activeRoot), 'profile', 'config.json')
  let mode = 'shadow'
  let status = 'defaulted'
  if (fs.existsSync(filePath)) {
    let stats
    try { stats = fs.statSync(filePath) } catch (error) { return { status: 'invalid', filePath, value: null, errors: [error.message] } }
    if (!stats.isFile() || stats.size > MAX_PROFILE_CONFIG_BYTES) return { status: 'bypassed', filePath, value: null, errors: ['workflow-rollout-config-capacity-exceeded'] }
    let config
    try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return { status: 'invalid', filePath, value: null, errors: ['workflow-rollout-config-json-invalid'] } }
    const configured = config?.extensions?.devcodex?.workflowCompletion?.mode
    if (configured !== undefined) {
      if (!['off', 'shadow', 'enforce', 'rolled-back'].includes(configured)) return { status: 'invalid', filePath, value: null, errors: ['workflow-rollout-mode-invalid'] }
      mode = configured
      status = 'configured'
    }
  }
  if (!/^[a-f0-9]{64}$/.test(inputRollout?.ruleSetDigest || '')) return { status: 'invalid', filePath, value: null, errors: ['workflow-rollout-ruleset-invalid'] }
  return {
    status,
    filePath,
    value: Object.freeze({
      schemaVersion: 'RolloutStateV1',
      mode,
      ruleSetDigest: inputRollout.ruleSetDigest,
      legacyComparison: inputRollout.legacyComparison || 'not-compared'
    }),
    errors: []
  }
}

function shadowWindowRelativePath() {
  return path.posix.join('.runtime-state', 'workflow-completion', 'shadow-window.json')
}

function shadowRuleSetIdentity(ruleSetDigest) {
  return buildJsonContentIdentity({
    sourceKey: `workflow-shadow:${ruleSetDigest}`,
    value: { schemaVersion: 'WorkflowCompletionRuleSetV1', ruleSetDigest },
    contractVersion: '1'
  }).identity
}

function createShadowWindowStore({ activeRoot, now = Date.now, maxWrites = 1 } = {}) {
  return createDerivedStateStore({
    root: activeRoot,
    relativePath: shadowWindowRelativePath(),
    maxBytes: SHADOW_STATE_MAX_BYTES,
    maxWrites,
    identityField: 'ruleSetIdentity',
    now
  })
}

function readShadowEvidenceWindow({ activeRoot, ruleSetDigest = null } = {}) {
  const store = createShadowWindowStore({ activeRoot, maxWrites: 0 })
  const receipt = store.read({ expectedIdentity: ruleSetDigest ? shadowRuleSetIdentity(ruleSetDigest) : null })
  if (receipt.status !== 'fresh') return receipt
  const value = receipt.value
  if (value?.schemaVersion !== SHADOW_STATE_SCHEMA || !value.current || !Array.isArray(value.current.samples) || value.current.samples.length > SHADOW_SAMPLE_LIMIT) {
    return { ...receipt, status: 'invalid', errorCode: 'SHADOW_STATE_INVALID' }
  }
  return receipt
}

function recordShadowEvidenceSample(input) {
  const sample = input?.sample
  const ruleSetDigest = sample?.ruleSetDigest
  const nowMs = Number.isFinite(input?.nowMs) ? input.nowMs : Date.now()
  const single = evaluateShadowEvidenceWindow([sample], ruleSetDigest, { now: nowMs, windowStartedAt: sample?.observedAt })
  if (sample?.fixture === true || single.uniqueRealSamples !== 1) {
    throw new WorkflowCompletionLifecycleError('SHADOW_SAMPLE_INVALID', 'shadow sample is not an eligible real dev/fix observation')
  }
  const rollout = readWorkflowCompletionRollout(input.activeRoot, { ruleSetDigest, legacyComparison: sample.legacyComparison })
  if (!rollout.value) return { schemaVersion: 'ShadowEvidenceRecordResultV1', status: 'UNVERIFIED', rollout, storeReceipt: null, window: null }
  if (rollout.value.mode !== 'shadow') return { schemaVersion: 'ShadowEvidenceRecordResultV1', status: 'bypassed', rollout, storeReceipt: null, window: null }

  const store = createShadowWindowStore({ activeRoot: input.activeRoot, now: () => nowMs, maxWrites: 1 })
  const existing = store.read()
  if (['invalid', 'bypassed'].includes(existing.status)) return { schemaVersion: 'ShadowEvidenceRecordResultV1', status: 'UNVERIFIED', rollout, storeReceipt: existing, window: null }
  const sameRuleSet = existing.status === 'fresh' && existing.value.current?.ruleSetDigest === ruleSetDigest
  const previous = sameRuleSet ? (existing.value.previous || null) : (existing.status === 'fresh' ? {
    ruleSetDigest: existing.value.current.ruleSetDigest,
    startedAt: existing.value.current.startedAt,
    updatedAt: existing.value.current.updatedAt,
    window: existing.value.current.window
  } : null)
  const samples = sameRuleSet ? [...existing.value.current.samples] : []
  const dedupeKey = `${sample.taskKey}\0${sample.candidateId}\0${sample.ruleSetDigest}`
  if (samples.some(item => `${item.taskKey}\0${item.candidateId}\0${item.ruleSetDigest}` === dedupeKey)) {
    return { schemaVersion: 'ShadowEvidenceRecordResultV1', status: 'duplicate', rollout, storeReceipt: null, window: existing.value.current.window }
  }
  if (samples.length >= SHADOW_SAMPLE_LIMIT) return { schemaVersion: 'ShadowEvidenceRecordResultV1', status: 'UNVERIFIED', rollout, storeReceipt: { status: 'bypassed', errorCode: 'SHADOW_SAMPLE_LIMIT_REACHED' }, window: null }
  samples.push(sample)
  const startedAt = sameRuleSet ? existing.value.current.startedAt : normalizedNow(input.startedAt || sample.observedAt)
  const window = evaluateShadowEvidenceWindow(samples, ruleSetDigest, { now: nowMs, windowStartedAt: startedAt })
  const value = Object.freeze({
    schemaVersion: SHADOW_STATE_SCHEMA,
    ruleSetIdentity: shadowRuleSetIdentity(ruleSetDigest),
    current: Object.freeze({ ruleSetDigest, startedAt, updatedAt: new Date(nowMs).toISOString(), samples: Object.freeze(samples), window }),
    previous
  })
  const storeReceipt = store.write(value)
  if (storeReceipt.status !== 'persisted') return { schemaVersion: 'ShadowEvidenceRecordResultV1', status: 'UNVERIFIED', rollout, storeReceipt, window: null }
  const readBack = store.read({ expectedIdentity: value.ruleSetIdentity })
  const readBackWindow = readBack.value?.current?.window
  if (readBack.status !== 'fresh' || readBackWindow?.ruleSetDigest !== ruleSetDigest) {
    return { schemaVersion: 'ShadowEvidenceRecordResultV1', status: 'UNVERIFIED', rollout, storeReceipt: readBack, window: null }
  }
  return { schemaVersion: 'ShadowEvidenceRecordResultV1', status: 'recorded', rollout, storeReceipt, window: readBackWindow }
}

function riskLedgerPath(taskRoot) {
  if (!text(taskRoot)) throw new WorkflowCompletionLifecycleError('WORKFLOW_TASK_ROOT_REQUIRED', 'taskRoot is required')
  return path.join(path.resolve(taskRoot), '.memory', 'risk-acceptance.jsonl')
}

function readWorkflowCompletionInput(taskRoot) {
  const filePath = workflowInputPath(taskRoot)
  if (!fs.existsSync(filePath)) return { status: 'missing', filePath, value: null, errors: ['workflow-input-missing'] }
  let stats
  try { stats = fs.statSync(filePath) } catch (error) { return { status: 'invalid', filePath, value: null, errors: [error.message] } }
  if (!stats.isFile() || stats.size > MAX_DERIVED_STATE_BYTES) return { status: 'bypassed', filePath, value: null, errors: ['workflow-input-capacity-exceeded'] }
  let value
  try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return { status: 'invalid', filePath, value: null, errors: ['workflow-input-json-invalid'] } }
  const check = validateWorkflowCompletionInput(value)
  return { status: check.valid ? 'fresh' : 'invalid', filePath, value: check.valid ? value : null, errors: check.errors }
}

function readRiskAcceptanceLedger(taskRoot, { now = Date.now() } = {}) {
  const filePath = riskLedgerPath(taskRoot)
  if (!fs.existsSync(filePath)) return { status: 'missing', filePath, receipts: [], errors: [] }
  const stats = fs.statSync(filePath)
  if (!stats.isFile() || stats.size > RISK_LEDGER_MAX_BYTES) return { status: 'bypassed', filePath, receipts: [], errors: ['risk-ledger-capacity-exceeded'] }
  const receipts = []
  const errors = []
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)
  let previousDigest = null
  for (let index = 0; index < lines.length; index += 1) {
    let receipt
    try { receipt = JSON.parse(lines[index]) } catch { errors.push(`risk-ledger-json-invalid:${index + 1}`); continue }
    const check = validateRiskAcceptanceReceipt(receipt, { now })
    if (!check.valid) errors.push(...check.errors.map(error => `risk-ledger-${index + 1}:${error}`))
    if (receipt.previousDigest !== previousDigest) errors.push(`risk-ledger-chain-invalid:${index + 1}`)
    receipts.push(receipt)
    previousDigest = receipt.receiptDigest || null
  }
  return { status: errors.length ? 'invalid' : 'fresh', filePath, receipts, errors }
}

function appendRiskAcceptanceDecision(input) {
  const loaded = readWorkflowCompletionInput(input?.taskRoot)
  if (loaded.status !== 'fresh') throw new WorkflowCompletionLifecycleError('WORKFLOW_INPUT_REQUIRED', 'fresh workflow completion input is required', loaded.errors)
  const { candidate, plan } = loaded.value
  const ledger = readRiskAcceptanceLedger(input.taskRoot, { now: input.nowMs })
  if (ledger.status === 'invalid' || ledger.status === 'bypassed') throw new WorkflowCompletionLifecycleError('RISK_LEDGER_INVALID', 'risk ledger is invalid', ledger.errors)
  if (!['accept', 'revoke'].includes(input.action)) throw new WorkflowCompletionLifecycleError('RISK_ACTION_INVALID', 'risk action must be accept or revoke')
  if (!text(input.reason) || !text(input.actor)) throw new WorkflowCompletionLifecycleError('RISK_ATTRIBUTION_REQUIRED', 'risk actor and reason are required')
  let requirementIds
  let targetReceiptDigest = null
  if (input.action === 'accept') {
    const requirement = plan.requirements.find(item => item.requirementId === input.requirementId)
    if (!requirement) throw new WorkflowCompletionLifecycleError('RISK_SCOPE_INVALID', 'risk requirement is not in the current plan')
    if (requirement.nonWaivable) throw new WorkflowCompletionLifecycleError('RISK_REQUIREMENT_NON_WAIVABLE', 'risk requirement is non-waivable')
    requirementIds = [requirement.requirementId]
  } else {
    const target = ledger.receipts.find(item => item.receiptDigest === input.receiptDigest && item.action === 'accept')
    if (!target || target.candidateId !== candidate.candidateId) throw new WorkflowCompletionLifecycleError('RISK_SCOPE_INVALID', 'risk receipt is missing or outside the current candidate')
    requirementIds = target.requirementIds
    targetReceiptDigest = target.receiptDigest
  }
  const previousDigest = ledger.receipts.at(-1)?.receiptDigest || null
  const createdAt = normalizedNow(input.createdAt)
  const receipt = createRiskAcceptanceReceipt({
    action: input.action,
    candidateId: candidate.candidateId,
    requirementIds,
    actor: input.actor,
    reason: input.reason,
    sourceDigest: input.sourceDigest || sha256(stableStringify({ action: input.action, actor: input.actor, reason: input.reason, requirementIds, targetReceiptDigest })),
    createdAt,
    expiresAt: input.action === 'accept' ? input.expiresAt || null : null,
    targetReceiptDigest,
    previousDigest
  })
  const filePath = ledger.filePath
  const lockPath = `${filePath}.lock`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let descriptor
  try {
    descriptor = fs.openSync(lockPath, 'wx')
    fs.appendFileSync(filePath, `${JSON.stringify(receipt)}\n`, 'utf8')
  } catch (error) {
    if (error?.code === 'EEXIST') throw new WorkflowCompletionLifecycleError('RISK_LEDGER_LOCKED', 'risk ledger is locked by another writer')
    throw error
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch { }
      try { fs.unlinkSync(lockPath) } catch { }
    }
  }
  const readBack = readRiskAcceptanceLedger(input.taskRoot, { now: input.nowMs })
  if (readBack.status !== 'fresh' || readBack.receipts.at(-1)?.receiptDigest !== receipt.receiptDigest) {
    throw new WorkflowCompletionLifecycleError('RISK_LEDGER_READBACK_FAILED', 'risk receipt read-back failed', readBack.errors)
  }
  return { schemaVersion: 'RiskAcceptanceAppendResultV1', filePath, receipt, ledgerHead: receipt.receiptDigest }
}

function completionView(snapshot, commit, deliveryAttempt, nowMs) {
  const validation = createCommitValidationResult(commit || null, { snapshot, deliveryAttempt: deliveryAttempt || null, now: nowMs })
  return projectWorkflowCompletion(snapshot, validation, { generatedAt: new Date(nowMs).toISOString(), now: nowMs })
}

function verifyTaskWorkflowCompletion(input) {
  const loaded = readWorkflowCompletionInput(input.taskRoot)
  if (loaded.status !== 'fresh') return { schemaVersion: 'WorkflowCompletionCliViewV1', status: 'UNVERIFIED', input: loaded, reconciliation: null, projection: null }
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
  const ledger = readRiskAcceptanceLedger(input.taskRoot, { now: nowMs })
  if (ledger.status === 'invalid' || ledger.status === 'bypassed') {
    return { schemaVersion: 'WorkflowCompletionCliViewV1', status: 'UNVERIFIED', input: loaded, riskLedger: ledger, reconciliation: null, projection: null }
  }
  const value = loaded.value
  const rollout = readWorkflowCompletionRollout(input.activeRoot, value.rollout)
  if (rollout.status === 'invalid' || rollout.status === 'bypassed') {
    return { schemaVersion: 'WorkflowCompletionCliViewV1', status: 'UNVERIFIED', input: loaded, riskLedger: ledger, rollout, reconciliation: null, projection: null }
  }
  const reconciliation = reconcileWorkflowCompletion({
    activeRoot: input.activeRoot,
    taskKey: input.taskKey,
    candidate: value.candidate,
    plan: value.plan,
    sourceRefs: value.sourceRefs,
    riskReceipts: [...(value.riskReceipts || []), ...ledger.receipts],
    rollout: rollout.value,
    generatedAt: value.generatedAt || new Date(nowMs).toISOString(),
    nowMs,
    persist: input.persist !== false
  })
  const projection = reconciliation.snapshot ? completionView(reconciliation.snapshot, value.commit, value.deliveryAttempt, nowMs) : null
  return {
    schemaVersion: 'WorkflowCompletionCliViewV1',
    status: projection?.workflowEvidenceState || 'UNVERIFIED',
    input: { status: loaded.status, filePath: loaded.filePath },
    riskLedger: { status: ledger.status, filePath: ledger.filePath, count: ledger.receipts.length },
    rollout,
    reconciliation,
    projection
  }
}

function inspectTaskWorkflowCompletion(input) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
  const state = readWorkflowCompletionState({ activeRoot: input.activeRoot, taskKey: input.taskKey })
  if (state.status !== 'fresh') return { schemaVersion: 'WorkflowCompletionCliViewV1', status: 'UNVERIFIED', state, projection: null }
  const loaded = readWorkflowCompletionInput(input.taskRoot)
  const rollout = readWorkflowCompletionRollout(input.activeRoot, { ruleSetDigest: state.value.current.ruleSetDigest, legacyComparison: state.value.current.rollout?.legacyComparison })
  if (!rollout.value || rollout.value.mode !== state.value.current.rollout?.mode) {
    return { schemaVersion: 'WorkflowCompletionCliViewV1', status: 'UNVERIFIED', state, input: { status: loaded.status, filePath: loaded.filePath }, rollout, projection: null }
  }
  const projection = completionView(state.value.current, loaded.value?.commit, loaded.value?.deliveryAttempt, nowMs)
  return { schemaVersion: 'WorkflowCompletionCliViewV1', status: projection.workflowEvidenceState, state, input: { status: loaded.status, filePath: loaded.filePath }, rollout, projection }
}

function eventBinding(payload) {
  const source = payload?.devcodexWorkflowCompletion || payload?.workflowCompletion || null
  return source && typeof source === 'object' ? source : null
}

function lifecycleSourceFromEvent(eventName, payload, binding, options) {
  if (!binding?.requirementId || !binding?.candidateId || !binding?.dependencyBindings) return null
  const failed = eventName === 'PostToolUseFailure' || payload?.success === false || payload?.is_error === true || payload?.isError === true || Boolean(payload?.error)
  const raw = {
    schemaVersion: eventName === 'PreToolUse' ? 'LifecyclePlannedAttemptV1' : 'ExecutionAttemptEntryV1',
    kind: eventName === 'PreToolUse' ? 'planned' : 'formal',
    plannedOnly: eventName === 'PreToolUse',
    result: eventName === 'PreToolUse' ? 'planned' : failed ? 'failed' : 'passed',
    eventId: binding.eventId || payload?.tool_use_id || payload?.toolUseId || payload?.tool_call_id || payload?.toolCallId,
    observedAt: options.observedAt
  }
  return buildSourceRef({
    owner: 'attempt',
    requirementId: binding.requirementId,
    observedCandidateId: binding.candidateId,
    dependencyBindings: binding.dependencyBindings,
    raw,
    observedAt: options.observedAt,
    actor: binding.actor || 'lifecycle-hook',
    host: options.host || binding.host || 'unknown',
    runId: binding.runId || raw.eventId,
    evidenceRefs: binding.evidenceRefs || []
  })
}

/** Record lifecycle observations only; Stop requests reconciliation but never marks workflow complete. */
function observeWorkflowCompletionEvent(rawState, eventName, payload = {}, options = {}) {
  const state = normalizeLifecycleState(rawState)
  const observedAt = normalizedNow(options.observedAt)
  const binding = eventBinding(payload)
  const sourceRef = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(eventName)
    ? lifecycleSourceFromEvent(eventName, payload, binding, { ...options, observedAt })
    : null
  if (sourceRef) {
    const key = `${sourceRef.owner}:${sourceRef.runId}:${sourceRef.result}`
    const duplicate = state.sourceRefs.some(item => `${item.owner}:${item.runId}:${item.result}` === key)
    if (!duplicate) {
      if (state.sourceRefs.length >= MAX_SOURCE_REFS) state.overflow = true
      else state.sourceRefs.push(sourceRef)
    }
  }
  if (eventName === 'Stop' || eventName === 'AfterAgent') state.finalReconcileRequested = true
  if (eventName === 'UserPromptSubmit' || eventName === 'BeforeAgent') state.finalReconcileRequested = false
  state.lastEvent = String(eventName || '')
  state.lastObservedAt = observedAt
  return Object.freeze(state)
}

function reconciliationIdentity(input) {
  return sha256(stableStringify({
    taskKeyDigest: taskKeyDigest(input.taskKey),
    candidateId: input.candidate?.candidateId || null,
    planDigest: input.plan?.planDigest || null,
    sourceDigests: (input.sourceRefs || []).map(item => item.sourceIdentity?.digest || null).sort()
  }))
}

module.exports = {
  DERIVED_STATE_SCHEMA,
  LIFECYCLE_STATE_SCHEMA,
  MAX_DERIVED_STATE_BYTES,
  MAX_PROFILE_CONFIG_BYTES,
  MAX_SOURCE_REFS,
  HOST_COMPLETION_ROUTES,
  OWNER_SPECS,
  RECONCILIATION_SCHEMA,
  SHADOW_SAMPLE_LIMIT,
  SHADOW_STATE_SCHEMA,
  SOURCE_REF_SCHEMA,
  WorkflowCompletionLifecycleError,
  appendRiskAcceptanceDecision,
  adaptSourceRef,
  adaptSourceRefs,
  buildSourceRef,
  completionRouteForHost,
  createCompletionStore,
  createShadowWindowStore,
  derivedStateRelativePath,
  inspectTaskWorkflowCompletion,
  materializeWorkflowCompletionInput,
  normalizeLifecycleState,
  observeWorkflowCompletionEvent,
  readRiskAcceptanceLedger,
  readShadowEvidenceWindow,
  readWorkflowCompletionRollout,
  readWorkflowCompletionInput,
  readWorkflowCompletionState,
  reconcileWorkflowCompletion,
  reconciliationIdentity,
  recordShadowEvidenceSample,
  riskLedgerPath,
  shadowWindowRelativePath,
  taskKeyDigest,
  verifyTaskWorkflowCompletion,
  validateWorkflowCompletionInput,
  workflowInputPath
}
