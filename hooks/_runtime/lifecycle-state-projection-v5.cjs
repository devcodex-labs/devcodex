'use strict'

const crypto = require('crypto')
const { projectArtifactMutationReconciliationReceipt } = require('./artifact-mutation-reconciliation.cjs')
const { projectArtifactTemplateBinding } = require('./artifact-template-contract.cjs')
const { compactLanguageContext } = require('./language-context.cjs')
const { compactTaskCheckpointEpochSet } = require('./task-checkpoint-epoch-v1.cjs')

const TASK_STATE_TARGET_BYTES = 64 * 1024
const TASK_STATE_SLOT_MAX_BYTES = 256 * 1024
const HOT_TASK_MAX_BYTES = 512 * 1024
const COLD_STUB_MAX_BYTES = 16 * 1024
const IN_FLIGHT_MAX_BYTES = 4 * 1024
const TRACE_MAX_EVENTS = 128
const TRACE_MAX_BYTES = 128 * 1024
const ARTIFACT_REF_MAX_COUNT = 32
const ARTIFACT_REF_MAX_BYTES = 16 * 1024
const DELIVERY_RECEIPT_MAX_COUNT = 64
const DELIVERY_RECEIPT_MAX_BYTES = 32 * 1024
const ADMISSION_TRANSACTION_MAX_BYTES = 12 * 1024
const VALIDATION_AUTHORITY_RECORD_MAX_BYTES = 4 * 1024
const VALIDATION_ROOT_BUDGET_PROJECTION_MAX_BYTES = 16 * 1024
const VALIDATION_REPAIR_CONVERGENCE_MAX_BYTES = 100 * 1024
const VALIDATION_QUALIFICATION_MAX_BYTES = 68 * 1024
const VALIDATION_CONVERGENCE_TERMINAL_MAX_BYTES = 24 * 1024
const TASK_SCOPED_AUTO_RECORD_MAX_BYTES = 4 * 1024
const AUTO_CHECKPOINT_HISTORY_MAX_COUNT = 12
const AUTO_CHECKPOINT_HISTORY_MAX_BYTES = 64 * 1024
const GOVERNANCE_LEDGER_OBSERVATION_MAX_COUNT = 32
const GOVERNANCE_LEDGER_OBSERVATION_MAX_BYTES = 32 * 1024
const GOVERNANCE_LEDGER_ID_RE = /^(?:PI|PF|VL|GR|ISSUE)-\d{3,}$/

class LifecycleStateProjectionV5Error extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'LifecycleStateProjectionV5Error'
    this.code = code
    this.details = details
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => {
      const serialized = stableStringify(item)
      return serialized === undefined ? 'null' : serialized
    }).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const fields = []
    for (const key of Object.keys(value).sort()) {
      const serialized = stableStringify(value[key])
      if (serialized !== undefined) fields.push(`${JSON.stringify(key)}:${serialized}`)
    }
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

function digestValue(value) {
  const serialized = stableStringify(value)
  if (serialized === undefined) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_STATE_DIGEST_INPUT_INVALID',
      'cannot digest an undefined root value'
    )
  }
  return crypto.createHash('sha256').update(serialized).digest('hex')
}

function jsonBytes(value) {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8')
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value, maxBytes = 4096) {
  const text = String(value || '')
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const prefix = Buffer.from(text, 'utf8').subarray(0, Math.max(0, maxBytes - 160)).toString('utf8')
  return `${prefix}\n[bounded sha256=${crypto.createHash('sha256').update(text).digest('hex')} bytes=${Buffer.byteLength(text, 'utf8')}]`
}

function isAllowedArtifactRef(value) {
  const text = String(value || '').trim()
  if (!text || Buffer.byteLength(text, 'utf8') > 2048 || /^data:/i.test(text)) return false
  if (/^[a-z]:[\\/]/i.test(text) || /^\\\\/.test(text)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    return /^(?:https?|artifact|memory|profile|skill):/i.test(text)
  }
  return /^(?:[a-z]:[\\/]|\\\\|\/|\.{0,2}[\\/]|[^\r\n]+[\\/][^\r\n]+)$/i.test(text)
}

function compactArtifactRefs(values, options = {}) {
  const maxCount = Number.isInteger(options.maxCount) ? options.maxCount : ARTIFACT_REF_MAX_COUNT
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : ARTIFACT_REF_MAX_BYTES
  const refs = []
  const seen = new Set()
  let bytes = 2
  for (const value of Array.isArray(values) ? values : []) {
    const ref = String(value || '').trim()
    const key = ref.replace(/\\/g, '/').toLowerCase()
    if (!isAllowedArtifactRef(ref) || seen.has(key)) continue
    const nextBytes = Buffer.byteLength(JSON.stringify(ref), 'utf8') + (refs.length ? 1 : 0)
    if (refs.length >= maxCount || bytes + nextBytes > maxBytes) break
    refs.push(ref)
    seen.add(key)
    bytes += nextBytes
  }
  return refs
}

function compactTracePayload(payload) {
  const source = isPlainObject(payload) ? payload : {}
  return {
    ...(source.toolCallId ? { toolCallId: boundedString(source.toolCallId, 256) } : {}),
    ...(source.toolName ? { toolName: boundedString(source.toolName, 256) } : {}),
    ...(source.reason ? { reason: boundedString(source.reason, 1024) } : {}),
    artifactPaths: compactArtifactRefs(source.artifactPaths, { maxCount: 16, maxBytes: 8 * 1024 })
  }
}

function compactLocalTaskTrace(raw) {
  if (!isPlainObject(raw)) return raw || null
  const allEvents = Array.isArray(raw.events) ? raw.events : []
  const droppedBefore = Math.max(0, Number(raw.droppedEvents) || 0)
  let selected = allEvents.slice(-TRACE_MAX_EVENTS).map(event => ({
    eventId: boundedString(event?.eventId, 256),
    sequence: Number(event?.sequence) || 0,
    observedAt: String(event?.observedAt || ''),
    type: boundedString(event?.type, 256),
    result: boundedString(event?.result, 256),
    payload: compactTracePayload(event?.payload)
  }))
  let newlyDropped = Math.max(0, allEvents.length - selected.length)
  let dropped = droppedBefore + newlyDropped
  while (selected.length && jsonBytes(selected) > TRACE_MAX_BYTES - 2048) {
    selected.shift()
    newlyDropped += 1
    dropped += 1
  }
  const sequenceBase = selected.length ? Math.max(0, (Number(selected[0].sequence) || 1) - 1) : Math.max(0, Number(raw.sequence) || 0)
  const prefixDigest = newlyDropped > 0
    ? digestValue({ prefixDigest: raw.prefixDigest || null, events: allEvents.slice(0, newlyDropped) })
    : (raw.prefixDigest || null)
  return {
    schemaVersion: raw.schemaVersion,
    traceId: boundedString(raw.traceId, 256),
    turnKey: boundedString(raw.turnKey, 256),
    status: raw.status,
    sequence: Math.max(Number(raw.sequence) || 0, sequenceBase + selected.length),
    sequenceBase,
    droppedEvents: dropped,
    prefixDigest,
    openedAt: raw.openedAt || null,
    completedAt: raw.completedAt || null,
    events: selected
  }
}

function compactCheckpoint(raw) {
  const checkpoint = isPlainObject(raw) ? raw : {}
  return {
    phase: boundedString(checkpoint.phase, 256),
    artifactPaths: compactArtifactRefs(checkpoint.artifactPaths),
    nextAction: boundedString(checkpoint.nextAction, 2048),
    resumeToken: boundedString(checkpoint.resumeToken, 512),
    idempotencyKey: boundedString(checkpoint.idempotencyKey, 512)
  }
}

function compactRecoveryCard(raw) {
  if (!isPlainObject(raw)) return null
  const compact = {
    schemaVersion: raw.schemaVersion,
    noticeKey: boundedString(raw.noticeKey, 256),
    observedAt: raw.observedAt || null,
    turnKey: boundedString(raw.turnKey, 256),
    priorState: boundedString(raw.priorState, 128),
    reason: boundedString(raw.reason, 1024),
    ageMs: Number.isFinite(raw.ageMs) ? raw.ageMs : 0,
    lastEventType: boundedString(raw.lastEventType, 128),
    lastEventAt: raw.lastEventAt || null,
    lastToolOutputAt: raw.lastToolOutputAt || null,
    checkpoint: compactCheckpoint(raw.checkpoint),
    capabilityBoundary: boundedString(raw.capabilityBoundary, 256),
    recommendedAction: boundedString(raw.recommendedAction, 2048)
  }
  compact.sourceDigest = digestValue(raw)
  compact.sourceBytes = jsonBytes(raw)
  return compact
}

function compactExecutionAttemptLedger(raw) {
  if (!isPlainObject(raw)) return raw || null
  const entries = (Array.isArray(raw.entries) ? raw.entries : []).slice(-100).map(entry => ({
    ...entry,
    commandSignature: boundedString(entry?.commandSignature, 1024),
    failureSignature: boundedString(entry?.failureSignature, 1024),
    qualificationEvidence: compactArtifactRefs(entry?.qualificationEvidence, { maxCount: 16, maxBytes: 8 * 1024 })
  }))
  return { ...raw, entries }
}

function compactMutationDecision(raw) {
  if (!isPlainObject(raw)) return null
  return {
    schemaVersion: raw.schemaVersion,
    projectionKind: 'digest-only',
    project: boundedString(raw.project, 256),
    taskRecoveryKey: raw.taskRecoveryKey || null,
    contextEpoch: raw.contextEpoch || null,
    intent: boundedString(raw.intent, 128),
    stage: boundedString(raw.stage, 128),
    operation: boundedString(raw.operation, 32),
    slotId: boundedString(raw.slotId, 128),
    slotIds: Array.isArray(raw.slotIds) ? raw.slotIds.slice(0, 16).map(item => boundedString(item, 128)) : [],
    targetCount: Number.isInteger(raw.targetCount) ? raw.targetCount : 0,
    observability: boundedString(raw.observability, 32),
    targetSetDigest: boundedString(raw.targetSetDigest, 64),
    footprintDigest: boundedString(raw.footprintDigest, 64),
    adapterDigest: boundedString(raw.adapterDigest, 64),
    plannedSetDigest: boundedString(raw.plannedSetDigest, 64),
    mergedRegistryDigest: boundedString(raw.mergedRegistryDigest, 64),
    baseRegistryDigest: boundedString(raw.baseRegistryDigest, 64),
    overlayDigest: raw.overlayDigest ? boundedString(raw.overlayDigest, 64) : null,
    activeRootIdentity: isPlainObject(raw.activeRootIdentity)
      ? {
          canonicalPath: boundedString(raw.activeRootIdentity.canonicalPath, 1024),
          digest: boundedString(raw.activeRootIdentity.digest, 64)
        }
      : null,
    projectRootIdentity: isPlainObject(raw.projectRootIdentity)
      ? {
          canonicalPath: boundedString(raw.projectRootIdentity.canonicalPath, 1024),
          digest: boundedString(raw.projectRootIdentity.digest, 64)
        }
      : null,
    authoritySourceRef: boundedString(raw.authoritySourceRef, 512),
    templateBindings: Array.isArray(raw.templateBindings)
      ? raw.templateBindings.slice(0, 24).map(item => item?.schemaVersion === 'ArtifactTemplateBindingProjectionV1'
          ? clone(item)
          : projectArtifactTemplateBinding(item))
      : [],
    decisionStatus: raw.decisionStatus,
    expiresAt: raw.expiresAt || null,
    singleUse: raw.singleUse === true,
    status: raw.status,
    decisionDigest: boundedString(raw.decisionDigest, 64)
  }
}

function compactMutationLease(raw) {
  if (!isPlainObject(raw)) return null
  return {
    schemaVersion: raw.schemaVersion,
    operationId: boundedString(raw.operationId, 512),
    project: boundedString(raw.project, 256),
    taskId: boundedString(raw.taskId, 128),
    ownerKind: boundedString(raw.ownerKind, 64),
    ownerGeneration: Number.isInteger(raw.ownerGeneration) ? raw.ownerGeneration : null,
    ownerLeaseDigest: boundedString(raw.ownerLeaseDigest, 64),
    contextEpoch: boundedString(raw.contextEpoch, 256),
    routeRevision: boundedString(raw.routeRevision, 128),
    adapterDigest: boundedString(raw.adapterDigest, 64),
    mergedRegistryDigest: boundedString(raw.mergedRegistryDigest, 64),
    slotDecisionDigest: boundedString(raw.slotDecisionDigest, 64),
    plannedSetDigest: boundedString(raw.plannedSetDigest, 64),
    nonce: boundedString(raw.nonce, 64),
    issuedAt: raw.issuedAt || null,
    expiresAt: raw.expiresAt || null,
    singleUse: raw.singleUse === true,
    status: raw.status,
    leaseDigest: boundedString(raw.leaseDigest, 64)
  }
}

function compactMutationFootprint(raw) {
  if (!isPlainObject(raw)) return null
  const paths = values => Array.isArray(values)
    ? values.slice(0, 24).map(item => boundedString(item, 1024))
    : []
  return {
    schemaVersion: raw.schemaVersion,
    sourceSchemaVersion: raw.sourceSchemaVersion || null,
    footprintDigest: boundedString(raw.footprintDigest, 64),
    adapterId: boundedString(raw.adapterId, 128),
    adapterDigest: boundedString(raw.adapterDigest, 64),
    operationClass: boundedString(raw.operationClass, 64),
    operation: boundedString(raw.operation, 32),
    plannedCreates: paths(raw.plannedCreates),
    plannedModifies: paths(raw.plannedModifies),
    plannedDeletes: paths(raw.plannedDeletes),
    plannedMoves: Array.isArray(raw.plannedMoves)
      ? raw.plannedMoves.slice(0, 24).map(item => ({
          source: boundedString(item?.source, 1024),
          target: boundedString(item?.target, 1024)
        }))
      : [],
    sourceTargets: paths(raw.sourceTargets),
    targetTargets: paths(raw.targetTargets),
    normalizedTargets: paths(raw.normalizedTargets),
    plannedSetDigest: boundedString(raw.plannedSetDigest, 64),
    observationPlan: isPlainObject(raw.observationPlan) ? clone(raw.observationPlan) : null,
    coverage: raw.coverage || null,
    projectionDigest: boundedString(raw.projectionDigest, 64)
  }
}

function compactMutationPreObservation(raw) {
  if (!isPlainObject(raw)) return null
  return {
    schemaVersion: raw.schemaVersion,
    operationId: boundedString(raw.operationId, 512),
    footprintDigest: boundedString(raw.footprintDigest, 64),
    plannedSetDigest: boundedString(raw.plannedSetDigest, 64),
    entries: Array.isArray(raw.entries)
      ? raw.entries.slice(0, 24).map(entry => ({
          path: boundedString(entry?.path, 1024),
          exists: entry?.exists === true,
          kind: boundedString(entry?.kind, 32),
          digest: entry?.digest ? boundedString(entry.digest, 64) : null,
          bytes: Number.isFinite(entry?.bytes) ? entry.bytes : 0,
          complete: entry?.complete === true,
          ...(entry?.errorCode ? { errorCode: boundedString(entry.errorCode, 128) } : {})
        }))
      : [],
    observationCoverage: raw.observationCoverage || null,
    errorCodes: Array.isArray(raw.errorCodes) ? raw.errorCodes.slice(0, 24).map(item => boundedString(item, 256)) : [],
    snapshotDigest: boundedString(raw.snapshotDigest, 64),
    observedAt: raw.observedAt || null,
    receiptDigest: boundedString(raw.receiptDigest, 64)
  }
}

function compactInFlightOperation(raw) {
  if (!isPlainObject(raw)) return raw || null
  const value = clone(raw)
  // v1.19.1+: DevCodex no longer owns operation permissions. Never carry
  // legacy approval state into hot/cold/ephemeral recovery projections.
  delete value.dangerousApprovals
  delete value.dangerousApprovalRecovery
  if (value.mutating !== true && jsonBytes(value) <= IN_FLIGHT_MAX_BYTES) return value
  return {
    operationId: boundedString(value.operationId, 512),
    toolName: boundedString(value.toolName, 256),
    startedAt: value.startedAt || null,
    leaseExpiresAt: value.leaseExpiresAt || null,
    ownedByAgent: value.ownedByAgent === true,
    mutating: value.mutating === true,
    targetPaths: Array.isArray(value.targetPaths) ? value.targetPaths.slice(0, 4).map(item => boundedString(item, 512)) : [],
    artifactDecision: compactMutationDecision(value.artifactDecision),
    mutationLease: compactMutationLease(value.mutationLease),
    mutationFootprint: compactMutationFootprint(value.mutationFootprint),
    mutationPreObservation: compactMutationPreObservation(value.mutationPreObservation),
    operationRecord: isPlainObject(value.operationRecord) ? clone(value.operationRecord) : null,
    sourceDigest: digestValue(value)
  }
}

function compactTaskRecoveryBinding(raw) {
  if (!isPlainObject(raw)) return raw || null
  return {
    schemaVersion: 'TaskRecoveryBindingV1',
    taskId: boundedString(raw.taskId, 64),
    displayName: boundedString(raw.displayName, 512),
    project: boundedString(raw.project, 256),
    kind: boundedString(raw.kind, 64),
    taskRoot: boundedString(raw.taskRoot, 2048),
    status: boundedString(raw.status, 64),
    identityRevision: Number(raw.identityRevision) || 1,
    boundAt: raw.boundAt || null
  }
}

function compactTaskScopedAutoRecord(raw, field) {
  if (raw == null) return null
  if (!isPlainObject(raw)) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_TASK_SCOPED_AUTO_RECORD_INVALID',
      `${field} must be one bounded object`,
      { field }
    )
  }
  const value = clone(raw)
  const bytes = jsonBytes(value)
  if (bytes > TASK_SCOPED_AUTO_RECORD_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_TASK_SCOPED_AUTO_RECORD_EXCEEDED',
      `${field} exceeds ${TASK_SCOPED_AUTO_RECORD_MAX_BYTES} bytes`,
      { field, bytes, maxBytes: TASK_SCOPED_AUTO_RECORD_MAX_BYTES }
    )
  }
  return value
}

function compactAutoCheckpointHistory(raw) {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > AUTO_CHECKPOINT_HISTORY_MAX_COUNT) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_AUTO_CHECKPOINT_HISTORY_INVALID',
      `autoCheckpointDecisions must contain at most ${AUTO_CHECKPOINT_HISTORY_MAX_COUNT} records`
    )
  }
  const value = raw.map((item, index) => compactTaskScopedAutoRecord(
    item,
    `autoCheckpointDecisions[${index}]`
  ))
  const bytes = jsonBytes(value)
  if (bytes > AUTO_CHECKPOINT_HISTORY_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_AUTO_CHECKPOINT_HISTORY_EXCEEDED',
      `autoCheckpointDecisions exceeds ${AUTO_CHECKPOINT_HISTORY_MAX_BYTES} bytes`,
      { bytes, maxBytes: AUTO_CHECKPOINT_HISTORY_MAX_BYTES }
    )
  }
  return value
}

function compactGovernanceEvidenceIds(raw) {
  const values = []
  const seen = new Set()
  for (const item of Array.isArray(raw) ? raw : []) {
    const value = String(item || '').trim().toUpperCase()
    if (!GOVERNANCE_LEDGER_ID_RE.test(value) || seen.has(value)) continue
    values.push(value)
    seen.add(value)
  }
  return values
}

function governanceObservationHasRichSnapshot(raw) {
  return isPlainObject(raw) && (
    Object.prototype.hasOwnProperty.call(raw, 'fileIds') ||
    Object.prototype.hasOwnProperty.call(raw, 'ledgerIntegrity')
  )
}

/**
 * Keep only the observation fields consumed after a lifecycle-state reload.
 * Full ledger ID and integrity snapshots remain producer-local because the
 * verifier rereads the canonical ledger before accepting write evidence.
 */
function compactGovernanceLedgerObservation(raw) {
  if (!isPlainObject(raw)) return null
  const fileIds = Array.isArray(raw.fileIds) ? raw.fileIds : []
  const integrity = isPlainObject(raw.ledgerIntegrity) ? raw.ledgerIntegrity : null
  const priorIntegritySummary = isPlainObject(raw.ledgerIntegritySummary) ? raw.ledgerIntegritySummary : null
  const priorFileIdsDigest = /^[a-f0-9]{64}$/.test(String(raw.fileIdsDigest || ''))
    ? String(raw.fileIdsDigest)
    : null
  const fileIdCount = fileIds.length
    ? fileIds.length
    : Math.max(0, Number.isInteger(raw.fileIdCount) ? raw.fileIdCount : 0)
  return {
    id: boundedString(raw.id, 256),
    observedAt: boundedString(raw.observedAt, 128),
    eventName: boundedString(raw.eventName, 128),
    toolName: boundedString(raw.toolName, 128),
    ledger: boundedString(raw.ledger, 256),
    ledgerPath: boundedString(raw.ledgerPath, 2048),
    activeRootMatch: raw.activeRootMatch === true,
    outcomeObservable: raw.outcomeObservable === true,
    successful: raw.successful === true,
    inputIds: compactGovernanceEvidenceIds(raw.inputIds),
    evidenceIds: compactGovernanceEvidenceIds(raw.evidenceIds),
    fileIdCount,
    fileIdsDigest: fileIds.length ? digestValue(fileIds) : priorFileIdsDigest,
    ledgerIntegritySummary: integrity ? {
      valid: integrity.valid === true,
      issueCount: Array.isArray(integrity.issues) ? integrity.issues.length : 0,
      issues: (Array.isArray(integrity.issues) ? integrity.issues : [])
        .slice(0, 8)
        .map(issue => boundedString(issue, 256)),
      digest: digestValue(integrity)
    } : priorIntegritySummary ? {
      valid: priorIntegritySummary.valid === true,
      issueCount: Math.max(0, Number.isInteger(priorIntegritySummary.issueCount) ? priorIntegritySummary.issueCount : 0),
      issues: (Array.isArray(priorIntegritySummary.issues) ? priorIntegritySummary.issues : [])
        .slice(0, 8)
        .map(issue => boundedString(issue, 256)),
      digest: /^[a-f0-9]{64}$/.test(String(priorIntegritySummary.digest || ''))
        ? String(priorIntegritySummary.digest)
        : null
    } : null
  }
}

function compactGovernanceIntake(raw) {
  if (!isPlainObject(raw)) return raw || null
  const value = clone(raw)
  value.promptPreview = boundedString(value.promptPreview, 2048)
  value.candidates = Array.isArray(value.candidates) ? value.candidates.slice(-32) : []
  const sourceObservations = Array.isArray(raw.ledgerObservations) ? raw.ledgerObservations : []
  const priorProjection = isPlainObject(raw.ledgerObservationProjection)
    ? raw.ledgerObservationProjection
    : null
  const appendedRichObservations = priorProjection
    ? sourceObservations.filter(governanceObservationHasRichSnapshot)
    : []
  const sourceCount = priorProjection
    ? Math.max(
        sourceObservations.length,
        (Number(priorProjection.sourceCount) || 0) + appendedRichObservations.length
      )
    : sourceObservations.length
  const priorSourceDigest = /^[a-f0-9]{64}$/.test(String(priorProjection?.sourceDigest || ''))
    ? String(priorProjection.sourceDigest)
    : null
  const sourceDigest = appendedRichObservations.length
    ? digestValue({ previousSourceDigest: priorSourceDigest, appended: appendedRichObservations })
    : (priorSourceDigest || (sourceObservations.length ? digestValue(sourceObservations) : null))
  let observations = sourceObservations
    .slice(-GOVERNANCE_LEDGER_OBSERVATION_MAX_COUNT)
    .map(compactGovernanceLedgerObservation)
    .filter(Boolean)
  while (observations.length > 1 && jsonBytes(observations) > GOVERNANCE_LEDGER_OBSERVATION_MAX_BYTES) {
    observations.shift()
  }
  const observationBytes = jsonBytes(observations)
  if (observationBytes > GOVERNANCE_LEDGER_OBSERVATION_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_GOVERNANCE_OBSERVATION_EVIDENCE_EXCEEDED',
      `latest governance ledger observation exceeds ${GOVERNANCE_LEDGER_OBSERVATION_MAX_BYTES} bytes`,
      { bytes: observationBytes, maxBytes: GOVERNANCE_LEDGER_OBSERVATION_MAX_BYTES }
    )
  }
  value.ledgerObservations = observations
  value.ledgerObservationProjection = {
    schemaVersion: 'GovernanceLedgerObservationProjectionV1',
    sourceCount,
    retainedCount: observations.length,
    droppedCount: Math.max(0, sourceCount - observations.length),
    sourceDigest,
    maxCount: GOVERNANCE_LEDGER_OBSERVATION_MAX_COUNT,
    maxBytes: GOVERNANCE_LEDGER_OBSERVATION_MAX_BYTES,
    bytes: observationBytes
  }
  return value
}

function compactTurnLiveness(raw) {
  if (!isPlainObject(raw)) return raw || null
  const value = clone(raw)
  value.checkpoint = compactCheckpoint(raw.checkpoint)
  value.lastRecoveryCard = compactRecoveryCard(raw.lastRecoveryCard)
  value.taskTrace = compactLocalTaskTrace(raw.taskTrace)
  value.executionAttemptLedger = compactExecutionAttemptLedger(raw.executionAttemptLedger)
  value.previousExecutionAttemptLedger = compactExecutionAttemptLedger(raw.previousExecutionAttemptLedger)
  value.inFlightOperation = compactInFlightOperation(value.inFlightOperation)
  return value
}

function compactColdMutationCloseout(raw) {
  if (!isPlainObject(raw) || !['needs-reconcile', 'reconciled'].includes(raw.result)) return null
  if (raw.result === 'needs-reconcile') return clone(raw)
  let reconciliation = null
  if (isPlainObject(raw.reconciliation)) {
    reconciliation = raw.reconciliation.schemaVersion === 'ArtifactMutationReconciliationProjectionV1'
      ? clone(raw.reconciliation)
      : projectArtifactMutationReconciliationReceipt(raw.reconciliation)
  }
  return {
    schemaVersion: raw.schemaVersion,
    operationId: boundedString(raw.operationId, 256),
    toolName: boundedString(raw.toolName, 128),
    completedAt: raw.completedAt || null,
    result: 'reconciled',
    reconciledAt: raw.reconciledAt || reconciliation?.reconciledAt || null,
    reconciliation,
    observation: isPlainObject(raw.observation) ? {
      plannedSetDigest: boundedString(raw.observation.plannedSetDigest, 64),
      receiptDigest: boundedString(raw.observation.receiptDigest, 64)
    } : null,
    artifactCloseout: isPlainObject(raw.artifactCloseout) ? {
      closeoutDigest: boundedString(raw.artifactCloseout.closeoutDigest, 64)
    } : null
  }
}

function compactDeliveryReceipts(receipts) {
  let selected = (Array.isArray(receipts) ? receipts : [])
    .filter(isPlainObject)
    .slice(-DELIVERY_RECEIPT_MAX_COUNT)
    .map(receipt => ({ ...receipt }))
  while (selected.length && jsonBytes(selected) > DELIVERY_RECEIPT_MAX_BYTES) selected.shift()
  return selected
}

function compactAdmissionTransaction(raw) {
  if (!isPlainObject(raw)) return raw || null
  const value = clone(raw)
  const bytes = jsonBytes(value)
  if (bytes > ADMISSION_TRANSACTION_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_ADMISSION_TRANSACTION_EXCEEDED',
      `task admission journal exceeds ${ADMISSION_TRANSACTION_MAX_BYTES} bytes`,
      { bytes, maxBytes: ADMISSION_TRANSACTION_MAX_BYTES }
    )
  }
  return value
}

function compactFencedWriteOwner(raw) {
  if (!isPlainObject(raw)) return raw || null
  const value = clone(raw)
  value.handoffRef = isPlainObject(value.handoffRef) ? clone(value.handoffRef) : null
  value.takeoverRef = isPlainObject(value.takeoverRef) ? clone(value.takeoverRef) : null
  if (jsonBytes(value) > 16 * 1024) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_FENCED_OWNER_EXCEEDED',
      'fenced task write owner exceeds 16 KiB'
    )
  }
  return value
}

function compactWorkflowTaskTerminalReceipt(raw) {
  if (!isPlainObject(raw)) return raw || null
  const value = clone(raw)
  value.evidence = Array.isArray(value.evidence)
    ? value.evidence.slice(0, 8).map(item => isPlainObject(item) ? clone(item) : null).filter(Boolean)
    : []
  if (jsonBytes(value) > 32 * 1024) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_TASK_TERMINAL_RECEIPT_EXCEEDED',
      'workflow task terminal receipt exceeds 32 KiB'
    )
  }
  return value
}

function compactContextPlan(plan) {
  if (!isPlainObject(plan)) return plan || null
  return {
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    planContentId: plan.planContentId,
    contextBinding: plan.contextBinding,
    identity: plan.identity,
    actionEnvelope: plan.actionEnvelope,
    changeTypes: plan.changeTypes,
    selectedSources: Array.isArray(plan.selectedSources) ? plan.selectedSources.map(source => ({
      sourceId: source.sourceId,
      kind: source.kind,
      selector: source.selector,
      required: source.required,
      sourceRefs: Array.isArray(source.sourceRefs) ? source.sourceRefs.map(ref => ({
        path: ref.path,
        digest: ref.digest,
        bytes: ref.bytes
      })) : []
    })) : [],
    mandatorySourceIds: plan.mandatorySourceIds,
    profile: plan.profile ? {
      selectedFiles: plan.profile.selectedFiles,
      routeLoadRecipe: plan.profile.routeLoadRecipe
    } : null,
    memory: plan.memory,
    skillRoute: plan.skillRoute,
    planDigest: plan.planDigest,
    planningTelemetry: plan.planningTelemetry,
    stageTiming: plan.stageTiming,
    cacheDecision: plan.cacheDecision,
    compactedFromDigest: digestValue(plan)
  }
}

function compactContextAcquisition(raw, aggressive = false) {
  if (!isPlainObject(raw)) return raw || null
  const value = clone(raw)
  value.inFlight = Array.isArray(value.inFlight) ? value.inFlight.slice(-16) : []
  value.postHistory = Array.isArray(value.postHistory) ? value.postHistory.slice(-16) : []
  value.planAttemptKeys = Array.isArray(value.planAttemptKeys) ? value.planAttemptKeys.slice(-10) : []
  value.failedPlanKeys = Array.isArray(value.failedPlanKeys) ? value.failedPlanKeys.slice(-10) : []
  if (aggressive || jsonBytes(value.plan) > 96 * 1024) value.plan = compactContextPlan(value.plan)
  return value
}

function compactValidationExecution(raw) {
  if (!isPlainObject(raw)) return raw || null
  const allowedFields = [
    'schemaVersion',
    'pendingBudgetCard',
    'rootBudgetConfirmation',
    'rootBudgetProjection',
    'continuationAuthorization',
    'currentLease',
    'runnerState',
    'terminalReceipt',
    'convergenceTerminalReceipt',
    'repairConvergence',
    'lastSuccessfulQualification',
    'revocationEpoch',
    'updatedAt'
  ]
  const value = {}
  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue
    const item = clone(raw[field])
    if (['pendingBudgetCard', 'rootBudgetConfirmation', 'continuationAuthorization'].includes(field) &&
        item !== null && jsonBytes(item) > VALIDATION_AUTHORITY_RECORD_MAX_BYTES) {
      throw new LifecycleStateProjectionV5Error(
        'LIFECYCLE_VALIDATION_AUTHORITY_RECORD_EXCEEDED',
        `${field} exceeds ${VALIDATION_AUTHORITY_RECORD_MAX_BYTES} bytes`,
        { field, bytes: jsonBytes(item), maxBytes: VALIDATION_AUTHORITY_RECORD_MAX_BYTES }
      )
    }
    if (field === 'rootBudgetProjection' && item !== null &&
        jsonBytes(item) > VALIDATION_ROOT_BUDGET_PROJECTION_MAX_BYTES) {
      throw new LifecycleStateProjectionV5Error(
        'LIFECYCLE_VALIDATION_ROOT_BUDGET_PROJECTION_EXCEEDED',
        `${field} exceeds ${VALIDATION_ROOT_BUDGET_PROJECTION_MAX_BYTES} bytes`,
        { field, bytes: jsonBytes(item), maxBytes: VALIDATION_ROOT_BUDGET_PROJECTION_MAX_BYTES }
      )
    }
    const convergenceLimit = field === 'repairConvergence'
      ? VALIDATION_REPAIR_CONVERGENCE_MAX_BYTES
      : (field === 'lastSuccessfulQualification'
          ? VALIDATION_QUALIFICATION_MAX_BYTES
          : (field === 'convergenceTerminalReceipt' ? VALIDATION_CONVERGENCE_TERMINAL_MAX_BYTES : null))
    if (convergenceLimit && item !== null && jsonBytes(item) > convergenceLimit) {
      throw new LifecycleStateProjectionV5Error(
        'LIFECYCLE_VALIDATION_CONVERGENCE_RECORD_EXCEEDED',
        `${field} exceeds ${convergenceLimit} bytes`,
        { field, bytes: jsonBytes(item), maxBytes: convergenceLimit }
      )
    }
    value[field] = item
  }
  return value
}

function digestFieldMatches(raw, field) {
  if (!isPlainObject(raw) || !/^[a-f0-9]{64}$/.test(String(raw[field] || ''))) return false
  const core = clone(raw)
  delete core[field]
  return digestValue(core) === raw[field]
}

function compactValidationCandidateSnapshotForCold(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion !== 'ValidationCandidateSnapshotV1' ||
      !String(raw.candidateId || '') || !digestFieldMatches(raw, 'snapshotDigest')) return clone(raw)
  const core = {
    schemaVersion: raw.schemaVersion,
    candidateId: raw.candidateId,
    candidateHead: raw.candidateHead || null,
    entries: [],
    scopeOmitted: true,
    scopeCount: Number.isInteger(raw.scopeCount) && raw.scopeCount >= 0
      ? raw.scopeCount
      : (Array.isArray(raw.entries) ? raw.entries.length : 0),
    scopeDigest: /^[a-f0-9]{64}$/.test(String(raw.scopeDigest || ''))
      ? raw.scopeDigest
      : digestValue(Array.isArray(raw.entries) ? raw.entries : [])
  }
  return { ...core, snapshotDigest: digestValue(core) }
}

function compactSuccessfulQualificationForCold(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion !== 'ValidationSuccessfulQualificationV1' ||
      !digestFieldMatches(raw, 'recordDigest')) return clone(raw)
  const core = clone(raw)
  delete core.recordDigest
  core.candidateSnapshot = compactValidationCandidateSnapshotForCold(core.candidateSnapshot)
  return { ...core, recordDigest: digestValue(core) }
}

function validQualificationIntegrityForCold(raw) {
  return isPlainObject(raw) && raw.schemaVersion === 'ValidationSuccessfulQualificationV1' &&
    digestFieldMatches(raw, 'recordDigest') &&
    isPlainObject(raw.qualificationIdentity) &&
    digestFieldMatches(raw.qualificationIdentity, 'qualificationDigest') &&
    raw.qualificationDigest === raw.qualificationIdentity.qualificationDigest &&
    isPlainObject(raw.candidateSnapshot) &&
    digestFieldMatches(raw.candidateSnapshot, 'snapshotDigest') &&
    raw.qualificationIdentity.candidateId === raw.candidateSnapshot.candidateId &&
    (raw.qualificationIdentity.candidateHead || null) === (raw.candidateSnapshot.candidateHead || null)
}

function qualifiedConvergenceMatchesQualificationForCold(convergence, qualification) {
  return isPlainObject(convergence) && digestFieldMatches(convergence, 'stateDigest') &&
    ['affected-qualified', 'full-qualified'].includes(convergence.phase) &&
    validQualificationIntegrityForCold(qualification) &&
    convergence.qualificationDigest === qualification.qualificationDigest &&
    isPlainObject(convergence.frozenCandidate) &&
    digestFieldMatches(convergence.frozenCandidate, 'snapshotDigest') &&
    convergence.frozenCandidate.candidateId === qualification.candidateSnapshot.candidateId &&
    (convergence.frozenCandidate.candidateHead || null) ===
      (qualification.candidateSnapshot.candidateHead || null) &&
    (convergence.frozenCandidate.scopeOmitted === true ||
      qualification.candidateSnapshot.scopeOmitted === true ||
      convergence.frozenCandidate.snapshotDigest === qualification.candidateSnapshot.snapshotDigest)
}

function compactValidationConvergenceTerminal(raw) {
  if (!isPlainObject(raw)) return null
  if (raw.schemaVersion === 'ValidationConvergenceTerminalV1' &&
      digestFieldMatches(raw, 'projectionDigest')) return clone(raw)
  const sourceTerminalDigest = String(raw.sourceTerminalDigest || raw.terminalDigest || '')
  if (!/^[a-f0-9]{64}$/.test(sourceTerminalDigest)) return null
  const boundedIds = values => {
    const result = []
    const seen = new Set()
    let bytes = 0
    for (const rawValue of Array.isArray(values) ? values : []) {
      const value = boundedString(String(rawValue || '').trim(), 256)
      if (!value || seen.has(value)) continue
      const nextBytes = Buffer.byteLength(value, 'utf8') + 4
      if (result.length >= 256 || bytes + nextBytes > 8 * 1024) break
      seen.add(value)
      result.push(value)
      bytes += nextBytes
    }
    return result
  }
  const core = {
    schemaVersion: 'ValidationConvergenceTerminalV1',
    sourceTerminalDigest,
    receiptId: raw.receiptId ? boundedString(raw.receiptId, 512) : null,
    candidateId: raw.candidateId ? boundedString(raw.candidateId, 512) : null,
    candidateHead: raw.candidateHead || raw.candidateIdentity?.head
      ? boundedString(raw.candidateHead || raw.candidateIdentity?.head, 128)
      : null,
    dirtyScopeDigest: /^[a-f0-9]{64}$/.test(String(raw.dirtyScopeDigest || raw.runIdentity?.dirtyScopeDigest || ''))
      ? (raw.dirtyScopeDigest || raw.runIdentity?.dirtyScopeDigest)
      : null,
    planDigest: /^[a-f0-9]{64}$/.test(String(raw.planDigest || raw.testRouteDigest || ''))
      ? (raw.planDigest || raw.testRouteDigest)
      : null,
    verificationLevel: raw.verificationLevel ? boundedString(raw.verificationLevel, 32) : null,
    verificationPurpose: raw.verificationPurpose ? boundedString(raw.verificationPurpose, 64) : null,
    routeResolved: raw.routeResolved ? boundedString(raw.routeResolved, 64) : null,
    selectedNodeCount: Number.isInteger(raw.selectedNodeCount) ? raw.selectedNodeCount : null,
    terminalStatus: raw.terminalStatus || (raw.nativeExitCode === 0 ? 'completed' : 'failed'),
    nativeExitCode: Number.isInteger(raw.nativeExitCode) ? raw.nativeExitCode : null,
    failedNode: raw.failedNode ? boundedString(raw.failedNode, 256) : null,
    failedNodes: boundedIds(raw.failedNodes),
    abortedNodes: boundedIds(raw.abortedNodes),
    completedAt: raw.completedAt ? boundedString(raw.completedAt, 128) : null
  }
  return { ...core, projectionDigest: digestValue(core) }
}

function compactOpenRepairConvergenceForCold(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion !== 'RepairConvergenceStateV1' ||
      !digestFieldMatches(raw, 'stateDigest')) return clone(raw)
  const baselineCandidate = compactValidationCandidateSnapshotForCold(raw.baselineCandidate)
  const observedSource = raw.phase === 'batch-open' ? raw.observedCandidate : raw.frozenCandidate
  const observedCandidate = compactValidationCandidateSnapshotForCold(observedSource)
  if (!isPlainObject(baselineCandidate) || !isPlainObject(observedCandidate)) return clone(raw)
  const files = ['__devcodex__/cold-resume-conservative']
  const precision = 'cold-resume-conservative'
  const deltaCore = {
    schemaVersion: 'ValidationRepairDeltaV1',
    baselineSnapshotDigest: baselineCandidate.snapshotDigest,
    currentSnapshotDigest: observedCandidate.snapshotDigest,
    files,
    precision
  }
  const core = {
    ...clone(raw),
    phase: 'batch-open',
    revision: Number.isInteger(raw.revision) ? raw.revision + 1 : raw.revision,
    baselineCandidate,
    observedCandidate,
    frozenCandidate: null,
    repairDeltaFiles: files,
    repairDeltaDigest: digestValue(deltaCore),
    deltaPrecision: precision,
    frozenAt: null,
    qualifiedAt: null,
    qualificationDigest: null
  }
  delete core.stateDigest
  return { ...core, stateDigest: digestValue(core) }
}

function compactQualifiedRepairConvergenceForCold(raw, qualification) {
  if (!qualifiedConvergenceMatchesQualificationForCold(raw, qualification)) return null
  const selectedNodeIds = Array.isArray(qualification.qualificationIdentity?.selectedNodeIds)
    ? qualification.qualificationIdentity.selectedNodeIds.slice()
    : []
  if (selectedNodeIds.length === 0) return null
  const baselineCandidate = compactValidationCandidateSnapshotForCold(raw.baselineCandidate)
  const frozenCandidate = compactValidationCandidateSnapshotForCold(raw.frozenCandidate)
  const files = []
  const precision = 'qualification-node-frontier'
  const deltaCore = {
    schemaVersion: 'ValidationRepairDeltaV1',
    baselineSnapshotDigest: baselineCandidate.snapshotDigest,
    currentSnapshotDigest: frozenCandidate.snapshotDigest,
    files,
    precision
  }
  const core = {
    ...clone(raw),
    revision: Number.isInteger(raw.revision) ? raw.revision + 1 : raw.revision,
    baselineCandidate,
    observedCandidate: null,
    frozenCandidate,
    repairDeltaFiles: files,
    repairDeltaDigest: digestValue(deltaCore),
    deltaPrecision: precision,
    issueIds: [],
    failedNodeIds: selectedNodeIds,
    qualificationDigest: qualification.qualificationDigest
  }
  delete core.stateDigest
  return { ...core, stateDigest: digestValue(core) }
}

function compactColdValidationExecution(raw) {
  if (!isPlainObject(raw)) return null
  const compacted = compactValidationExecution(raw)
  const qualificationIntegrity = validQualificationIntegrityForCold(compacted.lastSuccessfulQualification)
  const qualification = compacted.lastSuccessfulQualification
    ? compactSuccessfulQualificationForCold(compacted.lastSuccessfulQualification)
    : null
  const qualifiedConvergence = qualifiedConvergenceMatchesQualificationForCold(
    compacted.repairConvergence,
    compacted.lastSuccessfulQualification
  )
  const repairConvergence = qualifiedConvergence && qualificationIntegrity
    ? compactQualifiedRepairConvergenceForCold(compacted.repairConvergence, qualification)
    : (compacted.repairConvergence
        ? compactOpenRepairConvergenceForCold(compacted.repairConvergence)
        : null)
  const convergenceTerminalReceipt = compacted.convergenceTerminalReceipt
    ? compactValidationConvergenceTerminal(compacted.convergenceTerminalReceipt)
    : compactValidationConvergenceTerminal(compacted.terminalReceipt)
  const value = {
    schemaVersion: compacted.schemaVersion || 'ValidationExecutionTaskStateV1',
    ...(repairConvergence ? { repairConvergence } : {}),
    ...(qualification ? { lastSuccessfulQualification: qualification } : {}),
    ...(convergenceTerminalReceipt ? { convergenceTerminalReceipt } : {}),
    ...(compacted.updatedAt ? { updatedAt: compacted.updatedAt } : {})
  }
  return value.repairConvergence || value.lastSuccessfulQualification || value.convergenceTerminalReceipt
    ? value
    : null
}

function compactLifecycleStateV5(raw, options = {}) {
  if (!isPlainObject(raw)) {
    throw new LifecycleStateProjectionV5Error('LIFECYCLE_STATE_INVALID', 'lifecycle state must be an object')
  }
  const value = clone(raw)
  // TaskRecoveryCommitFenceV1 is a runtime CAS carrier. The authoritative
  // sequence/generation live on the envelope and must not be copied into the
  // durable lifecycle payload or influence its semantic digest.
  delete value.taskRecoveryCommitFence
  value.turnLiveness = compactTurnLiveness(value.turnLiveness)
  value.contextAcquisition = compactContextAcquisition(value.contextAcquisition)
  value.contextDeliveryReceipts = compactDeliveryReceipts(value.contextDeliveryReceipts)
  value.governanceIntake = compactGovernanceIntake(value.governanceIntake)
  value.taskRecoveryBinding = compactTaskRecoveryBinding(value.taskRecoveryBinding)
  if (Object.prototype.hasOwnProperty.call(value, 'taskScopedAutoContinuationGrant')) {
    value.taskScopedAutoContinuationGrant = compactTaskScopedAutoRecord(
      value.taskScopedAutoContinuationGrant,
      'taskScopedAutoContinuationGrant'
    )
  }
  if (Object.prototype.hasOwnProperty.call(value, 'autoCheckpointDecision')) {
    value.autoCheckpointDecision = compactTaskScopedAutoRecord(
      value.autoCheckpointDecision,
      'autoCheckpointDecision'
    )
  }
  if (Object.prototype.hasOwnProperty.call(value, 'autoCheckpointDecisions')) {
    value.autoCheckpointDecisions = compactAutoCheckpointHistory(value.autoCheckpointDecisions)
  }
  if (isPlainObject(value.admissionTransaction)) {
    value.admissionTransaction = compactAdmissionTransaction(value.admissionTransaction)
  }
  if (isPlainObject(value.fencedWriteOwner)) {
    value.fencedWriteOwner = compactFencedWriteOwner(value.fencedWriteOwner)
  }
  if (isPlainObject(value.workflowTaskTerminalReceipt)) {
    value.workflowTaskTerminalReceipt = compactWorkflowTaskTerminalReceipt(value.workflowTaskTerminalReceipt)
  }
  if (isPlainObject(value.validationExecution)) {
    value.validationExecution = compactValidationExecution(value.validationExecution)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'taskCheckpointEpochSet')) {
    value.taskCheckpointEpochSet = compactTaskCheckpointEpochSet(value.taskCheckpointEpochSet)
  }
  if (isPlainObject(value.validationControlIngress) &&
      jsonBytes(value.validationControlIngress) > VALIDATION_AUTHORITY_RECORD_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_VALIDATION_CONTROL_INGRESS_EXCEEDED',
      `validationControlIngress exceeds ${VALIDATION_AUTHORITY_RECORD_MAX_BYTES} bytes`
    )
  }
  if (isPlainObject(value.validationControlIngressIntent) &&
      jsonBytes(value.validationControlIngressIntent) > VALIDATION_AUTHORITY_RECORD_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_VALIDATION_CONTROL_INTENT_EXCEEDED',
      `validationControlIngressIntent exceeds ${VALIDATION_AUTHORITY_RECORD_MAX_BYTES} bytes`
    )
  }
  let bytes = jsonBytes(value)
  if (bytes > TASK_STATE_SLOT_MAX_BYTES) {
    value.contextAcquisition = compactContextAcquisition(value.contextAcquisition, true)
    bytes = jsonBytes(value)
  }
  if (bytes > TASK_STATE_SLOT_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_STATE_PAYLOAD_EXCEEDED',
      `compact lifecycle state exceeds ${TASK_STATE_SLOT_MAX_BYTES} bytes`,
      { bytes, maxBytes: TASK_STATE_SLOT_MAX_BYTES }
    )
  }
  return {
    state: value,
    bytes,
    targetBytes: TASK_STATE_TARGET_BYTES,
    compacted: bytes < jsonBytes(raw),
    sourceBytes: jsonBytes(raw),
    payloadDigest: digestValue(value)
  }
}

function semanticLifecycleProjection(compactState) {
  const source = isPlainObject(compactState) ? compactState : {}
  const volatileKeys = new Set([
    'updatedAt', 'startedAt', 'promptCount', 'toolUseCount', 'lastEvent', 'lastReason',
    'lastBootstrapWarningKey', 'lastClosureReminderKey', 'lastMultiProjectWarningKey',
    'productMutationCountThisTurn', 's07ProductWarnEmitted'
  ])
  const value = {}
  for (const [key, raw] of Object.entries(source)) {
    if (volatileKeys.has(key) || ['contextAcquisition', 'turnLiveness', 'taskRecoveryBinding', 'taskRecoveryCommitFence', 'governanceIntake', 'contextDeliveryReceipts'].includes(key)) continue
    value[key] = clone(raw)
  }
  if (isPlainObject(source.contextAcquisition)) {
    value.contextAcquisition = compactContextAcquisition(source.contextAcquisition)
    for (const key of [
      'stageTiming', 'postHistory', 'inFlight', 'planAttemptKeys', 'failedPlanKeys',
      'planCallCount', 'replanCount', 'conditionalReplanCount', 'fallbackAttempts',
      'lastWarningKey', 'lastReuseDecision'
    ]) delete value.contextAcquisition[key]
  }
  if (isPlainObject(source.turnLiveness)) {
    const turn = source.turnLiveness
    const inFlightOperation = compactInFlightOperation(turn.inFlightOperation)
    const mutating = inFlightOperation?.mutating === true
    const terminal = ['completed', 'error', 'interrupted'].includes(String(turn.state || ''))
    const preCompact = /^pre-compact/.test(String(turn.checkpoint?.phase || ''))
    value.turnLiveness = {
      state: mutating || terminal || preCompact ? turn.state : 'active-turn',
      turnKey: turn.turnKey,
      inFlightOperation: mutating ? inFlightOperation : null,
      checkpoint: mutating || terminal || /^terminal:|^pre-compact/.test(String(turn.checkpoint?.phase || ''))
        ? compactCheckpoint(turn.checkpoint)
        : { phase: '' },
      checkpointValidation: mutating ? clone(turn.checkpointValidation) : null,
      previousTurn: terminal || turn.previousTurn ? clone(turn.previousTurn) : null,
      lastMutationCloseout: clone(turn.lastMutationCloseout),
      executionAttemptLedger: mutating || terminal ? compactExecutionAttemptLedger(turn.executionAttemptLedger) : null,
      previousExecutionAttemptLedger: terminal ? compactExecutionAttemptLedger(turn.previousExecutionAttemptLedger) : null
    }
  }
  if (isPlainObject(source.taskRecoveryBinding)) value.taskRecoveryBinding = compactTaskRecoveryBinding(source.taskRecoveryBinding)
  if (isPlainObject(source.governanceIntake)) value.governanceIntake = compactGovernanceIntake(source.governanceIntake)
  value.contextDeliveryReceipts = compactDeliveryReceipts(source.contextDeliveryReceipts)
  return value
}

function buildColdResumeStub(compactState) {
  const state = isPlainObject(compactState) ? compactState : {}
  const context = isPlainObject(state.contextAcquisition) ? state.contextAcquisition : {}
  const turn = isPlainObject(state.turnLiveness) ? state.turnLiveness : {}
  const envelope = isPlainObject(state.actualInstructionEnvelope) ? state.actualInstructionEnvelope : null
  const workItemSet = isPlainObject(state.workItemSet) ? state.workItemSet : null
  const stub = {
    version: state.version,
    mode: state.mode,
    phase: state.phase,
    activeProject: state.activeProject,
    activeScope: state.activeScope,
    activeProjectSource: state.activeProjectSource,
    stickyProject: state.stickyProject,
    stickyAuto: state.stickyAuto,
    taskRecoveryBinding: state.taskRecoveryBinding || null,
    // A cold record remains a safe resume source only when it retains the
    // current epoch and one supported rollback anchor. Older hot epochs become
    // bounded audit refs; they never regain mutation authority from the stub.
    taskCheckpointEpochSet: state.taskCheckpointEpochSet
      ? compactTaskCheckpointEpochSet(state.taskCheckpointEpochSet, { cold: true })
      : null,
    taskScopedAutoContinuationGrant: compactTaskScopedAutoRecord(
      state.taskScopedAutoContinuationGrant,
      'taskScopedAutoContinuationGrant'
    ),
    autoCheckpointDecision: compactTaskScopedAutoRecord(
      state.autoCheckpointDecision,
      'autoCheckpointDecision'
    ),
    autoCheckpointDecisions: compactAutoCheckpointHistory(state.autoCheckpointDecisions),
    admissionTransaction: isPlainObject(state.admissionTransaction)
      ? compactAdmissionTransaction(state.admissionTransaction)
      : null,
    taskCanonicalRevision: isPlainObject(state.taskCanonicalRevision)
      ? clone(state.taskCanonicalRevision)
      : null,
    fencedWriteOwner: isPlainObject(state.fencedWriteOwner)
      ? compactFencedWriteOwner(state.fencedWriteOwner)
      : null,
    workflowTaskTerminalReceipt: isPlainObject(state.workflowTaskTerminalReceipt)
      ? compactWorkflowTaskTerminalReceipt(state.workflowTaskTerminalReceipt)
      : null,
    validationControlIngressIntent: null,
    validationControlIngress: null,
    validationExecution: compactColdValidationExecution(state.validationExecution),
    actualInstructionEnvelope: null,
    workItemSet: null,
    workflowRouteDecision: isPlainObject(state.workflowRouteDecision)
      ? clone(state.workflowRouteDecision)
      : null,
    workflowResumeTargetDecision: isPlainObject(state.workflowResumeTargetDecision)
      ? clone(state.workflowResumeTargetDecision)
      : null,
    workflowRoutePlanBinding: isPlainObject(state.workflowRoutePlanBinding)
      ? clone(state.workflowRoutePlanBinding)
      : null,
    workflowRoutePending: isPlainObject(state.workflowRoutePending)
      ? clone(state.workflowRoutePending)
      : null,
    workflowIngressError: isPlainObject(state.workflowIngressError)
      ? clone(state.workflowIngressError)
      : null,
    // Task language is minimum continuity state. Coldification may rebuild
    // route/catalog projections, but must never fall back to a host locale.
    languageContext: compactLanguageContext(state.languageContext),
    workflowIngressResume: envelope || workItemSet
      ? {
          schemaVersion: 'WorkflowIngressResumeRefV1',
          envelopeId: envelope?.envelopeId || null,
          envelopeDigest: envelope?.envelopeDigest || null,
          actualInstructionDigest: envelope?.actualInstructionDigest || null,
          workItemSetDigest: workItemSet?.setDigest || null,
          workItemIds: Array.isArray(workItemSet?.items)
            ? workItemSet.items.slice(0, 32).map(item => item.workItemId)
            : [],
          routeDecisionDigest: state.workflowRouteDecision?.decisionDigest || null,
          routeRevision: state.workflowRouteDecision?.routeRevision || null,
          planBindingDigest: state.workflowRoutePlanBinding?.bindingDigest || null,
          resumeTargetDecisionDigest: state.workflowResumeTargetDecision?.decisionDigest || null
        }
      : null,
    cp3Runtime: state.cp3Runtime || {},
    workflowCompletionLifecycle: state.workflowCompletionLifecycle || null,
    contextAcquisition: {
      schemaVersion: context.schemaVersion,
      contextEpoch: '',
      activeRoot: context.activeRoot,
      project: context.project,
      targetResolved: context.targetResolved,
      hostCapability: context.hostCapability,
      hostSessionId: '',
      verificationMode: 'cold-resume-rehydrate',
      handoff: context.plan ? {
        contextEpoch: context.contextEpoch,
        planId: context.plan.planId || '',
        planContentId: context.plan.planContentId || '',
        status: context.receipt?.status || 'stale',
        activeRoot: context.activeRoot,
        project: context.project
      } : null
    },
    turnLiveness: {
      schemaVersion: turn.schemaVersion || 1,
      state: 'idle',
      turnKey: '',
      checkpoint: compactCheckpoint(turn.checkpoint),
      previousTurn: turn.previousTurn || null,
      lastRecoveryCard: compactRecoveryCard(turn.lastRecoveryCard),
      lastMutationCloseout: compactColdMutationCloseout(turn.lastMutationCloseout)
    },
    recoveryKind: 'cold-resume-stub'
  }
  const bytes = jsonBytes(stub)
  if (bytes > COLD_STUB_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_COLD_STUB_PAYLOAD_EXCEEDED',
      `cold resume stub exceeds ${COLD_STUB_MAX_BYTES} bytes`,
      { bytes, maxBytes: COLD_STUB_MAX_BYTES }
    )
  }
  return { state: stub, bytes, payloadDigest: digestValue(stub) }
}

module.exports = {
  ADMISSION_TRANSACTION_MAX_BYTES,
  ARTIFACT_REF_MAX_BYTES,
  ARTIFACT_REF_MAX_COUNT,
  COLD_STUB_MAX_BYTES,
  DELIVERY_RECEIPT_MAX_BYTES,
  DELIVERY_RECEIPT_MAX_COUNT,
  HOT_TASK_MAX_BYTES,
  IN_FLIGHT_MAX_BYTES,
  LifecycleStateProjectionV5Error,
  TASK_STATE_SLOT_MAX_BYTES,
  TASK_STATE_TARGET_BYTES,
  TASK_SCOPED_AUTO_RECORD_MAX_BYTES,
  TRACE_MAX_BYTES,
  TRACE_MAX_EVENTS,
  VALIDATION_AUTHORITY_RECORD_MAX_BYTES,
  VALIDATION_CONVERGENCE_TERMINAL_MAX_BYTES,
  VALIDATION_QUALIFICATION_MAX_BYTES,
  VALIDATION_REPAIR_CONVERGENCE_MAX_BYTES,
  VALIDATION_ROOT_BUDGET_PROJECTION_MAX_BYTES,
  boundedString,
  buildColdResumeStub,
  compactArtifactRefs,
  compactDeliveryReceipts,
  compactColdValidationExecution,
  compactQualifiedRepairConvergenceForCold,
  compactValidationConvergenceTerminal,
  compactLifecycleStateV5,
  compactLocalTaskTrace,
  compactValidationExecution,
  digestValue,
  jsonBytes,
  semanticLifecycleProjection,
  stableStringify
}
