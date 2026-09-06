'use strict'

const {
  sha256,
  stableStringify
} = require('../../hooks/_runtime/content-identity.cjs')

const REPAIR_CONVERGENCE_SCHEMA = 'RepairConvergenceStateV1'
const QUALIFICATION_IDENTITY_SCHEMA = 'ValidationQualificationIdentityV1'
const SUCCESSFUL_QUALIFICATION_SCHEMA = 'ValidationSuccessfulQualificationV1'
const CANDIDATE_SNAPSHOT_SCHEMA = 'ValidationCandidateSnapshotV1'
const CONVERGENCE_TERMINAL_SCHEMA = 'ValidationConvergenceTerminalV1'
const REPAIR_PHASES = new Set([
  'batch-open',
  'batch-frozen',
  'affected-qualified',
  'full-qualified'
])
const REPAIR_BATCH_ACTIONS = new Set(['status', 'open', 'freeze'])
const DEFAULT_QUALIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_SNAPSHOT_PATHS = 512
const MAX_SNAPSHOT_BYTES = 48 * 1024
const MAX_REPAIR_ISSUES = 128
const MAX_FAILED_NODES = 256
const MAX_SELECTED_NODE_ID_BYTES = 8 * 1024
const MAX_REPAIR_STATE_BYTES = 96 * 1024
const MAX_QUALIFICATION_BYTES = 64 * 1024
const MAX_ITEM_BYTES = 256
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const DIGEST_RE = /^[a-f0-9]{64}$/

class ValidationConvergenceError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'ValidationConvergenceError'
    this.code = code
    this.details = details
  }
}

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function withoutField(value, field) {
  const copy = { ...value }
  delete copy[field]
  return copy
}

function normalizedStrings(values, maxItems, label) {
  if (!Array.isArray(values)) return []
  const normalized = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort()
  if (normalized.length > maxItems) {
    throw new ValidationConvergenceError(
      'VALIDATION_REPAIR_STATE_BOUNDS_EXCEEDED',
      `${label} exceeds its bounded item count`,
      { label, count: normalized.length, maxItems }
    )
  }
  if (normalized.some(value => Buffer.byteLength(value, 'utf8') > MAX_ITEM_BYTES)) {
    throw new ValidationConvergenceError(
      'VALIDATION_REPAIR_STATE_BOUNDS_EXCEEDED',
      `${label} contains an oversized item`,
      { label, maxItemBytes: MAX_ITEM_BYTES }
    )
  }
  return normalized
}

function normalizeSnapshotEntry(entry = {}) {
  const normalized = {
    path: String(entry.path || '').replace(/\\/g, '/').replace(/^\.\//, '')
  }
  if (entry.deleted === true) normalized.deleted = true
  if (entry.narrativeMarkdown === true) normalized.narrativeMarkdown = true
  if (entry.contentOmitted === true) normalized.contentOmitted = true
  if (DIGEST_RE.test(String(entry.digest || ''))) normalized.digest = String(entry.digest)
  return normalized
}

/** Builds the bounded source snapshot used to distinguish repair delta from older dirty work. */
function buildCandidateSnapshot(candidate = {}) {
  if (candidate.stable !== true || !String(candidate.candidateId || '')) {
    throw new ValidationConvergenceError(
      'VALIDATION_REPAIR_CANDIDATE_UNSTABLE',
      'repair convergence requires one stable candidate identity'
    )
  }
  const sourceEntries = Array.isArray(candidate.dirtyIdentities)
    ? candidate.dirtyIdentities
    : (Array.isArray(candidate.scopeIdentities) ? candidate.scopeIdentities : [])
  const normalizedEntries = sourceEntries.map(normalizeSnapshotEntry)
    .filter(entry => entry.path)
    .sort((left, right) => left.path.localeCompare(right.path))
  const normalizedPaths = normalizedEntries.map(entry => entry.path)
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    throw new ValidationConvergenceError(
      'VALIDATION_REPAIR_CANDIDATE_DUPLICATE_PATH',
      'repair convergence candidate contains duplicate normalized paths'
    )
  }
  const requestedOmission = candidate.scopeOmitted === true
  const fullCore = {
    schemaVersion: CANDIDATE_SNAPSHOT_SCHEMA,
    candidateId: String(candidate.candidateId),
    candidateHead: candidate.head || null,
    entries: normalizedEntries
  }
  const scopeOmitted = requestedOmission || normalizedEntries.length > MAX_SNAPSHOT_PATHS ||
    Buffer.byteLength(stableStringify(fullCore), 'utf8') > MAX_SNAPSHOT_BYTES
  const core = scopeOmitted
    ? {
        schemaVersion: CANDIDATE_SNAPSHOT_SCHEMA,
        candidateId: String(candidate.candidateId),
        candidateHead: candidate.head || null,
        entries: [],
        scopeOmitted: true,
        scopeCount: Number.isInteger(candidate.scopeCount) && candidate.scopeCount >= 0
          ? candidate.scopeCount
          : normalizedEntries.length,
        scopeDigest: DIGEST_RE.test(String(candidate.scopeDigest || ''))
          ? String(candidate.scopeDigest)
          : digest(normalizedEntries)
      }
    : fullCore
  return Object.freeze({ ...core, snapshotDigest: digest(core) })
}

function validateCandidateSnapshot(snapshot) {
  const errors = []
  if (snapshot?.schemaVersion !== CANDIDATE_SNAPSHOT_SCHEMA) errors.push('schemaVersion')
  if (!String(snapshot?.candidateId || '')) errors.push('candidateId')
  if (snapshot?.changedFiles !== undefined &&
      (!Array.isArray(snapshot.changedFiles) || snapshot.changedFiles.length > MAX_SNAPSHOT_PATHS)) errors.push('changedFiles')
  if (!Array.isArray(snapshot?.entries) || snapshot.entries.length > MAX_SNAPSHOT_PATHS) errors.push('entries')
  if (snapshot?.scopeOmitted === true &&
      (snapshot.entries?.length !== 0 || !Number.isInteger(snapshot.scopeCount) || snapshot.scopeCount < 0 ||
        !DIGEST_RE.test(String(snapshot.scopeDigest || '')))) errors.push('omittedScope')
  if (Array.isArray(snapshot?.entries)) {
    const paths = snapshot.entries.map(entry => String(entry?.path || ''))
    if (paths.some(path => !path) || new Set(paths).size !== paths.length) errors.push('entryPaths')
  }
  const core = snapshot && typeof snapshot === 'object' ? withoutField(snapshot, 'snapshotDigest') : {}
  if (Buffer.byteLength(stableStringify(core), 'utf8') > MAX_SNAPSHOT_BYTES) errors.push('snapshotBytes')
  if (!DIGEST_RE.test(String(snapshot?.snapshotDigest || '')) || digest(core) !== snapshot.snapshotDigest) errors.push('snapshotDigest')
  return { valid: errors.length === 0, errors }
}

function asCandidateSnapshot(value) {
  if (value?.schemaVersion === CANDIDATE_SNAPSHOT_SCHEMA) {
    const validation = validateCandidateSnapshot(value)
    if (!validation.valid) {
      throw new ValidationConvergenceError('VALIDATION_REPAIR_STATE_INVALID', 'candidate snapshot is invalid', validation)
    }
    return value
  }
  return buildCandidateSnapshot(value)
}

function repairDeltaBetween(baselineValue, currentValue) {
  const baseline = asCandidateSnapshot(baselineValue)
  const current = asCandidateSnapshot(currentValue)
  const before = new Map(baseline.entries.map(entry => [entry.path, stableStringify(entry)]))
  const after = new Map(current.entries.map(entry => [entry.path, stableStringify(entry)]))
  let files = [...new Set([...before.keys(), ...after.keys()])]
    .filter(file => before.get(file) !== after.get(file))
    .sort()
  let precision = 'content-identity'
  if ((baseline.scopeOmitted || current.scopeOmitted) && baseline.snapshotDigest !== current.snapshotDigest) {
    files = ['__devcodex__/bounded-scope-fallback']
    precision = 'bounded-scope-fallback'
  } else if (baseline.candidateId !== current.candidateId && files.length === 0) {
    const currentPaths = current.entries.map(entry => entry.path)
    files = currentPaths.length > 0 ? currentPaths : ['__devcodex__/unknown-candidate-drift']
    precision = currentPaths.length > 0 ? 'safe-current-scope-fallback' : 'unknown-candidate-drift'
  }
  const core = {
    schemaVersion: 'ValidationRepairDeltaV1',
    baselineSnapshotDigest: baseline.snapshotDigest,
    currentSnapshotDigest: current.snapshotDigest,
    files,
    precision
  }
  return Object.freeze({ ...core, deltaDigest: digest(core) })
}

function stateWithDigest(core) {
  if (Buffer.byteLength(stableStringify(core), 'utf8') > MAX_REPAIR_STATE_BYTES) {
    throw new ValidationConvergenceError(
      'VALIDATION_REPAIR_STATE_BOUNDS_EXCEEDED',
      'repair convergence state exceeds the bounded byte budget',
      { maxBytes: MAX_REPAIR_STATE_BYTES }
    )
  }
  return Object.freeze({ ...core, stateDigest: digest(core) })
}

function validateRepairConvergenceState(state) {
  if (!state) return { valid: true, errors: [] }
  const errors = []
  if (state.schemaVersion !== REPAIR_CONVERGENCE_SCHEMA) errors.push('schemaVersion')
  if (!REPAIR_PHASES.has(state.phase)) errors.push('phase')
  if (!Number.isInteger(state.revision) || state.revision < 1) errors.push('revision')
  if (!String(state.batchId || '').startsWith('repair-batch-')) errors.push('batchId')
  if (!validateCandidateSnapshot(state.baselineCandidate).valid) errors.push('baselineCandidate')
  if (state.phase === 'batch-open' && !validateCandidateSnapshot(state.observedCandidate).valid) errors.push('observedCandidate')
  if (state.phase !== 'batch-open' && state.observedCandidate !== null) errors.push('observedCandidate')
  if (!Array.isArray(state.issueIds) || state.issueIds.length > MAX_REPAIR_ISSUES) errors.push('issueIds')
  if (!Array.isArray(state.failedNodeIds) || state.failedNodeIds.length > MAX_FAILED_NODES) errors.push('failedNodeIds')
  if (!Array.isArray(state.repairDeltaFiles) || state.repairDeltaFiles.length > MAX_SNAPSHOT_PATHS) errors.push('repairDeltaFiles')
  if (state.phase === 'batch-open' && state.frozenCandidate !== null) errors.push('frozenCandidate')
  if (state.phase !== 'batch-open' && !validateCandidateSnapshot(state.frozenCandidate).valid) errors.push('frozenCandidate')
  if (['affected-qualified', 'full-qualified'].includes(state.phase) &&
      !DIGEST_RE.test(String(state.qualificationDigest || ''))) errors.push('qualificationDigest')
  const core = state && typeof state === 'object' ? withoutField(state, 'stateDigest') : {}
  if (Buffer.byteLength(stableStringify(core), 'utf8') > MAX_REPAIR_STATE_BYTES) errors.push('stateBytes')
  if (!DIGEST_RE.test(String(state.stateDigest || '')) || digest(core) !== state.stateDigest) errors.push('stateDigest')
  return { valid: errors.length === 0, errors }
}

/** Opens or extends one repair batch without granting any qualification execution. */
function openRepairBatch({ candidate, baselineCandidate = candidate, priorState = null, issueIds = [], failedNodeIds = [], nowMs = Date.now() }) {
  const priorValidation = validateRepairConvergenceState(priorState)
  if (!priorValidation.valid) {
    throw new ValidationConvergenceError('VALIDATION_REPAIR_STATE_INVALID', 'prior repair convergence state is invalid', priorValidation)
  }
  const extending = priorState?.phase === 'batch-open'
  const baseline = extending ? priorState.baselineCandidate : asCandidateSnapshot(baselineCandidate)
  const observed = asCandidateSnapshot(candidate)
  const delta = repairDeltaBetween(baseline, observed)
  const revision = Number(priorState?.revision || 0) + 1
  const openedAt = extending ? priorState.openedAt : new Date(nowMs).toISOString()
  const batchId = extending
    ? priorState.batchId
    : `repair-batch-${digest({ baseline: baseline.snapshotDigest, revision, openedAt }).slice(0, 40)}`
  return stateWithDigest({
    schemaVersion: REPAIR_CONVERGENCE_SCHEMA,
    phase: 'batch-open',
    batchId,
    revision,
    baselineCandidate: baseline,
    observedCandidate: observed,
    frozenCandidate: null,
    repairDeltaFiles: delta.files,
    repairDeltaDigest: delta.deltaDigest,
    deltaPrecision: delta.precision,
    issueIds: normalizedStrings([...(priorState?.issueIds || []), ...issueIds], MAX_REPAIR_ISSUES, 'repair issues'),
    failedNodeIds: normalizedStrings([...(priorState?.failedNodeIds || []), ...failedNodeIds], MAX_FAILED_NODES, 'failed nodes'),
    openedAt,
    frozenAt: null,
    qualifiedAt: null,
    qualificationDigest: null,
    updatedAt: new Date(nowMs).toISOString()
  })
}

/** Freezes the full known repair set; only this phase may enter one affected qualification. */
function freezeRepairBatch({ state, candidate, issueIds = [], nowMs = Date.now() }) {
  const validation = validateRepairConvergenceState(state)
  if (!validation.valid || state?.phase !== 'batch-open') {
    throw new ValidationConvergenceError(
      'VALIDATION_REPAIR_BATCH_NOT_OPEN',
      'only an open repair batch can be frozen',
      { errors: validation.errors, phase: state?.phase || null }
    )
  }
  const observed = asCandidateSnapshot(candidate)
  const delta = repairDeltaBetween(state.baselineCandidate, observed)
  return stateWithDigest({
    ...withoutField(state, 'stateDigest'),
    phase: 'batch-frozen',
    revision: state.revision + 1,
    observedCandidate: null,
    frozenCandidate: observed,
    repairDeltaFiles: delta.files,
    repairDeltaDigest: delta.deltaDigest,
    deltaPrecision: delta.precision,
    issueIds: normalizedStrings([...state.issueIds, ...issueIds], MAX_REPAIR_ISSUES, 'repair issues'),
    frozenAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString()
  })
}

function buildQualificationIdentity({ candidate, plan }) {
  const selectedNodeContracts = (plan?.selectedNodes || []).map(node => ({
    id: node.id,
    schemaVersion: node.schemaVersion,
    owner: node.owner,
    command: node.command,
    args: node.args || [],
    environment: node.environment || {},
    dependencies: node.dependencies || [],
    inputs: node.inputs || [],
    consumers: node.consumers || [],
    delegatedClosure: node.delegatedClosure || [],
    coversNodes: node.coversNodes || [],
    invariants: node.invariants || [],
    riskClass: node.riskClass,
    cachePolicy: node.cachePolicy,
    writeScopes: node.writeScopes || [],
    timeoutMs: node.timeoutMs,
    estimatedDurationMs: node.estimatedDurationMs || null,
    exitMap: node.exitMap || {},
    evidenceArtifacts: node.evidenceArtifacts || []
  })).sort((left, right) => left.id.localeCompare(right.id))
  const selectedNodeIds = normalizedStrings(
    selectedNodeContracts.map(node => node.id),
    MAX_FAILED_NODES,
    'selected validation nodes'
  )
  if (Buffer.byteLength(stableStringify(selectedNodeIds), 'utf8') > MAX_SELECTED_NODE_ID_BYTES) {
    throw new ValidationConvergenceError(
      'VALIDATION_QUALIFICATION_BOUNDS_EXCEEDED',
      'selected validation node identities exceed the cold-resume byte budget',
      { maxBytes: MAX_SELECTED_NODE_ID_BYTES }
    )
  }
  const manifestDigest = plan?.manifestIdentity?.digest || null
  const core = {
    schemaVersion: QUALIFICATION_IDENTITY_SCHEMA,
    candidateId: candidate?.candidateId || null,
    candidateHead: candidate?.head || null,
    manifestDigest,
    routeResolved: plan?.routeResolved || null,
    verificationLevel: plan?.verificationLevel || null,
    verificationPurpose: plan?.verificationPurpose || null,
    riskClass: plan?.riskClass || null,
    affectedBoundaries: [...(plan?.affectedBoundaries || [])].sort(),
    selectedNodeIds,
    selectedNodeContractDigest: digest(selectedNodeContracts),
    nodeRuntime: process.version,
    platform: `${process.platform}-${process.arch}`
  }
  return Object.freeze({ ...core, qualificationDigest: digest(core) })
}

function validateQualificationIdentity(identity) {
  const errors = []
  if (identity?.schemaVersion !== QUALIFICATION_IDENTITY_SCHEMA) errors.push('schemaVersion')
  if (!String(identity?.candidateId || '')) errors.push('candidateId')
  if (!DIGEST_RE.test(String(identity?.manifestDigest || ''))) errors.push('manifestDigest')
  if (!Array.isArray(identity?.selectedNodeIds) || identity.selectedNodeIds.length > MAX_FAILED_NODES ||
      new Set(identity.selectedNodeIds).size !== identity.selectedNodeIds.length ||
      identity.selectedNodeIds.some(value => !String(value || '').trim() ||
        Buffer.byteLength(String(value), 'utf8') > MAX_ITEM_BYTES) ||
      Buffer.byteLength(stableStringify(identity.selectedNodeIds || []), 'utf8') > MAX_SELECTED_NODE_ID_BYTES) {
    errors.push('selectedNodeIds')
  }
  if (!DIGEST_RE.test(String(identity?.selectedNodeContractDigest || ''))) errors.push('selectedNodeContractDigest')
  const core = identity && typeof identity === 'object' ? withoutField(identity, 'qualificationDigest') : {}
  if (!DIGEST_RE.test(String(identity?.qualificationDigest || '')) || digest(core) !== identity.qualificationDigest) {
    errors.push('qualificationDigest')
  }
  return { valid: errors.length === 0, errors }
}

function createSuccessfulQualification({ identity, candidate, receipt, ttlMs = DEFAULT_QUALIFICATION_TTL_MS, nowMs = Date.now() }) {
  const identityValidation = validateQualificationIdentity(identity)
  if (!identityValidation.valid) {
    throw new ValidationConvergenceError('VALIDATION_QUALIFICATION_IDENTITY_INVALID', 'successful qualification requires a valid identity')
  }
  if (receipt?.nativeExitCode !== 0 || receipt?.terminalStatus !== 'completed') {
    throw new ValidationConvergenceError('VALIDATION_QUALIFICATION_TERMINAL_INVALID', 'only a completed green receipt can be reused')
  }
  if (!DIGEST_RE.test(String(receipt?.terminalDigest || ''))) {
    throw new ValidationConvergenceError(
      'VALIDATION_QUALIFICATION_TERMINAL_INVALID',
      'successful qualification requires one content-addressed terminal receipt'
    )
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > DEFAULT_QUALIFICATION_TTL_MS) {
    throw new ValidationConvergenceError('VALIDATION_QUALIFICATION_TTL_INVALID', 'qualification TTL exceeds the supported bound')
  }
  const candidateSnapshot = asCandidateSnapshot(candidate)
  if (identity.candidateId !== candidateSnapshot.candidateId ||
      (identity.candidateHead || null) !== (candidateSnapshot.candidateHead || null)) {
    throw new ValidationConvergenceError('VALIDATION_QUALIFICATION_CANDIDATE_MISMATCH', 'qualification identity does not match its candidate snapshot')
  }
  const completedAt = receipt.completedAt || new Date(nowMs).toISOString()
  const completedAtMs = Date.parse(String(completedAt))
  if (!Number.isFinite(completedAtMs) || completedAtMs > nowMs + MAX_CLOCK_SKEW_MS) {
    throw new ValidationConvergenceError('VALIDATION_QUALIFICATION_TERMINAL_TIME_INVALID', 'qualification terminal time is invalid')
  }
  const core = {
    schemaVersion: SUCCESSFUL_QUALIFICATION_SCHEMA,
    qualificationIdentity: identity,
    qualificationDigest: identity.qualificationDigest,
    candidateSnapshot,
    terminalDigest: receipt.terminalDigest,
    receiptId: receipt.receiptId || null,
    completedAt,
    expiresAt: new Date(completedAtMs + ttlMs).toISOString()
  }
  if (Buffer.byteLength(stableStringify(core), 'utf8') > MAX_QUALIFICATION_BYTES) {
    throw new ValidationConvergenceError(
      'VALIDATION_QUALIFICATION_BOUNDS_EXCEEDED',
      'successful qualification exceeds the bounded byte budget',
      { maxBytes: MAX_QUALIFICATION_BYTES }
    )
  }
  return Object.freeze({ ...core, recordDigest: digest(core) })
}

function validateSuccessfulQualification(record, nowMs = Date.now()) {
  if (!record) return { valid: false, reusable: false, errors: ['missing'] }
  const errors = []
  if (record.schemaVersion !== SUCCESSFUL_QUALIFICATION_SCHEMA) errors.push('schemaVersion')
  if (!validateQualificationIdentity(record.qualificationIdentity).valid) errors.push('qualificationIdentity')
  if (!DIGEST_RE.test(String(record.qualificationDigest || '')) ||
      record.qualificationIdentity?.qualificationDigest !== record.qualificationDigest) errors.push('qualificationDigest')
  if (!validateCandidateSnapshot(record.candidateSnapshot).valid) errors.push('candidateSnapshot')
  if (record.qualificationIdentity?.candidateId !== record.candidateSnapshot?.candidateId ||
      (record.qualificationIdentity?.candidateHead || null) !== (record.candidateSnapshot?.candidateHead || null)) {
    errors.push('candidateBinding')
  }
  const core = withoutField(record, 'recordDigest')
  if (Buffer.byteLength(stableStringify(core), 'utf8') > MAX_QUALIFICATION_BYTES) errors.push('recordBytes')
  if (!DIGEST_RE.test(String(record.recordDigest || '')) || digest(core) !== record.recordDigest) errors.push('recordDigest')
  const expiresAtMs = Date.parse(record.expiresAt || '')
  const completedAtMs = Date.parse(record.completedAt || '')
  if (!DIGEST_RE.test(String(record.terminalDigest || ''))) errors.push('terminalDigest')
  if (!Number.isFinite(expiresAtMs)) errors.push('expiresAt')
  if (!Number.isFinite(completedAtMs) || (Number.isFinite(expiresAtMs) &&
      (expiresAtMs <= completedAtMs || expiresAtMs - completedAtMs > DEFAULT_QUALIFICATION_TTL_MS))) {
    errors.push('qualificationWindow')
  }
  if (Number.isFinite(completedAtMs) && completedAtMs > nowMs + MAX_CLOCK_SKEW_MS) errors.push('completedAtFuture')
  return { valid: errors.length === 0, reusable: errors.length === 0 && nowMs < expiresAtMs, expired: Number.isFinite(expiresAtMs) && nowMs >= expiresAtMs, errors }
}

function qualificationReuseDecision(record, identity, nowMs = Date.now()) {
  const validation = validateSuccessfulQualification(record, nowMs)
  if (!validation.valid) return { reusable: false, reasonCode: validation.errors.includes('missing') ? 'missing' : 'invalid', validation }
  if (!validation.reusable) return { reusable: false, reasonCode: 'expired', validation }
  if (record.qualificationDigest !== identity?.qualificationDigest) return { reusable: false, reasonCode: 'identity-mismatch', validation }
  return { reusable: true, reasonCode: 'already-qualified', validation }
}

function canCompleteRepairQualification(state, level) {
  if (state?.phase === 'batch-frozen') return level === 'V2'
  if (state?.phase === 'affected-qualified') return level === 'V2' || level === 'V3'
  if (state?.phase === 'full-qualified') return level === 'V3'
  return false
}

function sameCandidateSnapshot(left, right) {
  const leftValidation = validateCandidateSnapshot(left)
  const rightValidation = validateCandidateSnapshot(right)
  if (!leftValidation.valid || !rightValidation.valid) return false
  if (left.candidateId !== right.candidateId ||
      (left.candidateHead || null) !== (right.candidateHead || null)) return false
  return left.scopeOmitted === true || right.scopeOmitted === true ||
    left.snapshotDigest === right.snapshotDigest
}

function completeRepairBatch({ state, qualification, nowMs = Date.now() }) {
  if (!state) return null
  const validation = validateRepairConvergenceState(state)
  const completionPhase = ['batch-frozen', 'affected-qualified', 'full-qualified'].includes(state?.phase)
  if (!validation.valid || !completionPhase) {
    throw new ValidationConvergenceError(
      'VALIDATION_REPAIR_STATE_INVALID',
      'green completion requires a frozen or already-qualified repair candidate',
      validation
    )
  }
  const qualificationValidation = validateSuccessfulQualification(qualification, nowMs)
  if (!qualificationValidation.valid || !qualificationValidation.reusable ||
      !sameCandidateSnapshot(state.frozenCandidate, qualification.candidateSnapshot)) {
    throw new ValidationConvergenceError(
      'VALIDATION_QUALIFICATION_CANDIDATE_MISMATCH',
      'green qualification does not match the frozen repair candidate',
      qualificationValidation
    )
  }
  const level = qualification.qualificationIdentity.verificationLevel
  if (state.phase === 'batch-frozen' && level !== 'V2') {
    throw new ValidationConvergenceError(
      'VALIDATION_AFFECTED_QUALIFICATION_REQUIRED',
      'a frozen repair batch must pass affected V2 before full V3'
    )
  }
  if (state.phase === 'full-qualified' && level !== 'V3') {
    throw new ValidationConvergenceError(
      'VALIDATION_QUALIFICATION_LEVEL_REGRESSION',
      'a full-qualified candidate cannot be replaced by a lower-level qualification'
    )
  }
  if (!canCompleteRepairQualification(state, level)) {
    throw new ValidationConvergenceError(
      'VALIDATION_QUALIFICATION_TRANSITION_INVALID',
      `qualification level ${level || 'unknown'} cannot complete state ${state.phase}`
    )
  }
  return stateWithDigest({
    ...withoutField(state, 'stateDigest'),
    phase: level === 'V3' ? 'full-qualified' : 'affected-qualified',
    revision: state.revision + 1,
    observedCandidate: null,
    frozenCandidate: qualification.candidateSnapshot,
    qualifiedAt: new Date(nowMs).toISOString(),
    qualificationDigest: qualification.qualificationDigest,
    updatedAt: new Date(nowMs).toISOString()
  })
}

function reopenRepairBatchAfterFailure({ state = null, candidate, receipt = {}, baselineCandidate = null, issueIds = [], nowMs = Date.now() }) {
  const failedNodeIds = [
    ...(receipt.failedNodes || []),
    ...(receipt.failedNode ? [receipt.failedNode] : []),
    ...(receipt.abortedNodes || [])
  ]
  const continuingOpenBatch = state?.phase === 'batch-open'
  return openRepairBatch({
    candidate,
    baselineCandidate: continuingOpenBatch
      ? state.baselineCandidate
      : (baselineCandidate || candidate),
    priorState: continuingOpenBatch ? state : null,
    issueIds: [...(state?.issueIds || []), ...issueIds],
    failedNodeIds,
    nowMs
  })
}

function terminalOccurredAfterQualification(terminal, qualification) {
  const terminalMs = Date.parse(String(terminal?.completedAt || ''))
  const qualificationMs = Date.parse(String(qualification?.completedAt || ''))
  if (!Number.isFinite(terminalMs)) return false
  if (!Number.isFinite(qualificationMs)) return true
  return terminalMs > qualificationMs ||
    (terminalMs === qualificationMs && terminal?.terminalDigest !== qualification?.terminalDigest)
}

function normalizeConvergenceTerminal(terminal) {
  if (!terminal || typeof terminal !== 'object' || Array.isArray(terminal)) return null
  if (terminal.schemaVersion === CONVERGENCE_TERMINAL_SCHEMA) {
    const core = withoutField(terminal, 'projectionDigest')
    if (!DIGEST_RE.test(String(terminal.sourceTerminalDigest || '')) ||
        !DIGEST_RE.test(String(terminal.projectionDigest || '')) ||
        digest(core) !== terminal.projectionDigest) return null
    return { ...terminal, terminalDigest: terminal.sourceTerminalDigest }
  }
  return DIGEST_RE.test(String(terminal.terminalDigest || '')) ? terminal : null
}

/**
 * Recovers a durable repair batch after a process stopped between terminal
 * persistence and convergence persistence. The missing baseline identities
 * intentionally widen the one eventual affected run to the current dirty set.
 */
function recoverRepairBatchFromFailedTerminal({ candidate, terminal, qualification = null, nowMs = Date.now() }) {
  terminal = normalizeConvergenceTerminal(terminal)
  if (!terminal || terminal.terminalStatus === 'completed' || terminal.nativeExitCode === 0) return null
  if (!validationLevelRequiresConvergence(terminal.verificationLevel)) return null
  if (!terminalOccurredAfterQualification(terminal, qualification)) return null
  const terminalRef = String(terminal.receiptId || terminal.terminalDigest || 'unknown-terminal')
  const terminalCandidateId = String(terminal.candidateId || `terminal-${digest({ terminalRef }).slice(0, 40)}`)
  const baselineCandidate = buildCandidateSnapshot({
    stable: true,
    candidateId: terminalCandidateId,
    head: terminal.candidateHead || null,
    dirtyIdentities: [],
    scopeOmitted: true,
    scopeCount: Array.isArray(terminal.candidateChangedFiles) ? terminal.candidateChangedFiles.length : 0,
    scopeDigest: DIGEST_RE.test(String(terminal.dirtyScopeDigest || ''))
      ? terminal.dirtyScopeDigest
      : digest(terminal.candidateChangedFiles || [])
  })
  return openRepairBatch({
    candidate,
    baselineCandidate,
    issueIds: [`recovered-failed-terminal:${terminalRef}`],
    failedNodeIds: [
      ...(terminal.failedNodes || []),
      ...(terminal.failedNode ? [terminal.failedNode] : []),
      ...(terminal.abortedNodes || [])
    ],
    nowMs
  })
}

/** Rebuilds an exact, still-fresh green qualification from the durable terminal. */
function recoverQualificationFromSuccessfulTerminal({ candidate, plan, terminal, ttlMs = DEFAULT_QUALIFICATION_TTL_MS, nowMs = Date.now() }) {
  const mismatch = reasonCode => ({ recoverable: false, reasonCode, qualification: null })
  terminal = normalizeConvergenceTerminal(terminal)
  if (!terminal || terminal.terminalStatus !== 'completed' || terminal.nativeExitCode !== 0) return mismatch('terminal-not-green')
  if (!DIGEST_RE.test(String(terminal.terminalDigest || ''))) return mismatch('terminal-digest-missing')
  if (terminal.candidateId !== candidate?.candidateId) return mismatch('candidate-mismatch')
  if (terminal.planDigest !== plan?.planDigest) return mismatch('plan-mismatch')
  if (terminal.verificationLevel !== plan?.verificationLevel ||
      terminal.verificationPurpose !== plan?.verificationPurpose ||
      terminal.routeResolved !== plan?.routeResolved) return mismatch('contract-mismatch')
  if (terminal.selectedNodeCount !== (plan?.selectedNodes || []).length) return mismatch('node-count-mismatch')
  const completedAtMs = Date.parse(String(terminal.completedAt || ''))
  if (!Number.isFinite(completedAtMs) || completedAtMs > nowMs + MAX_CLOCK_SKEW_MS) return mismatch('terminal-time-invalid')
  const qualification = createSuccessfulQualification({
    identity: buildQualificationIdentity({ candidate, plan }),
    candidate,
    receipt: terminal,
    ttlMs,
    nowMs: completedAtMs
  })
  const validation = validateSuccessfulQualification(qualification, nowMs)
  return validation.reusable
    ? { recoverable: true, reasonCode: 'durable-terminal-recovered', qualification }
    : mismatch(validation.expired ? 'terminal-expired' : 'terminal-invalid')
}

function validationLevelRequiresConvergence(level) {
  return level === 'V2' || level === 'V3'
}

function assertFrozenCandidate(state, candidate) {
  const validation = validateRepairConvergenceState(state)
  if (!validation.valid) {
    throw new ValidationConvergenceError('VALIDATION_REPAIR_STATE_INVALID', 'repair convergence state is invalid', validation)
  }
  if (state.phase === 'batch-open') return
  const current = buildCandidateSnapshot(candidate)
  if (!sameCandidateSnapshot(state.frozenCandidate, current)) {
    throw new ValidationConvergenceError(
      'VALIDATION_REPAIR_BATCH_CANDIDATE_DRIFT',
      'the candidate changed after the repair batch was frozen',
      { expected: state.frozenCandidate?.snapshotDigest || null, observed: current.snapshotDigest }
    )
  }
}

module.exports = {
  CANDIDATE_SNAPSHOT_SCHEMA,
  CONVERGENCE_TERMINAL_SCHEMA,
  DEFAULT_QUALIFICATION_TTL_MS,
  MAX_FAILED_NODES,
  MAX_CLOCK_SKEW_MS,
  MAX_ITEM_BYTES,
  MAX_QUALIFICATION_BYTES,
  MAX_REPAIR_ISSUES,
  MAX_REPAIR_STATE_BYTES,
  MAX_SELECTED_NODE_ID_BYTES,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_PATHS,
  QUALIFICATION_IDENTITY_SCHEMA,
  REPAIR_BATCH_ACTIONS,
  REPAIR_CONVERGENCE_SCHEMA,
  REPAIR_PHASES,
  SUCCESSFUL_QUALIFICATION_SCHEMA,
  ValidationConvergenceError,
  assertFrozenCandidate,
  buildCandidateSnapshot,
  buildQualificationIdentity,
  canCompleteRepairQualification,
  completeRepairBatch,
  createSuccessfulQualification,
  freezeRepairBatch,
  openRepairBatch,
  normalizeConvergenceTerminal,
  qualificationReuseDecision,
  recoverQualificationFromSuccessfulTerminal,
  recoverRepairBatchFromFailedTerminal,
  repairDeltaBetween,
  reopenRepairBatchAfterFailure,
  sameCandidateSnapshot,
  validateCandidateSnapshot,
  validateQualificationIdentity,
  validateRepairConvergenceState,
  validateSuccessfulQualification,
  validationLevelRequiresConvergence
}
