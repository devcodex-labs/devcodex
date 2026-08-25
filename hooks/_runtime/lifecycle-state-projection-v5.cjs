'use strict'

const crypto = require('crypto')

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

function compactGovernanceIntake(raw) {
  if (!isPlainObject(raw)) return raw || null
  const value = clone(raw)
  value.promptPreview = boundedString(value.promptPreview, 2048)
  value.candidates = Array.isArray(value.candidates) ? value.candidates.slice(-32) : []
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
    value[field] = item
  }
  return value
}

function compactLifecycleStateV5(raw, options = {}) {
  if (!isPlainObject(raw)) {
    throw new LifecycleStateProjectionV5Error('LIFECYCLE_STATE_INVALID', 'lifecycle state must be an object')
  }
  const value = clone(raw)
  value.turnLiveness = compactTurnLiveness(value.turnLiveness)
  value.contextAcquisition = compactContextAcquisition(value.contextAcquisition)
  value.contextDeliveryReceipts = compactDeliveryReceipts(value.contextDeliveryReceipts)
  value.governanceIntake = compactGovernanceIntake(value.governanceIntake)
  value.taskRecoveryBinding = compactTaskRecoveryBinding(value.taskRecoveryBinding)
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
  if (isPlainObject(value.validationControlIngress) &&
      jsonBytes(value.validationControlIngress) > VALIDATION_AUTHORITY_RECORD_MAX_BYTES) {
    throw new LifecycleStateProjectionV5Error(
      'LIFECYCLE_VALIDATION_CONTROL_INGRESS_EXCEEDED',
      `validationControlIngress exceeds ${VALIDATION_AUTHORITY_RECORD_MAX_BYTES} bytes`
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
    if (volatileKeys.has(key) || ['contextAcquisition', 'turnLiveness', 'taskRecoveryBinding', 'governanceIntake', 'contextDeliveryReceipts'].includes(key)) continue
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
    admissionTransaction: isPlainObject(state.admissionTransaction)
      ? compactAdmissionTransaction(state.admissionTransaction)
      : null,
    fencedWriteOwner: isPlainObject(state.fencedWriteOwner)
      ? compactFencedWriteOwner(state.fencedWriteOwner)
      : null,
    workflowTaskTerminalReceipt: isPlainObject(state.workflowTaskTerminalReceipt)
      ? compactWorkflowTaskTerminalReceipt(state.workflowTaskTerminalReceipt)
      : null,
    validationControlIngress: null,
    validationExecution: null,
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
      lastRecoveryCard: compactRecoveryCard(turn.lastRecoveryCard)
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
  TRACE_MAX_BYTES,
  TRACE_MAX_EVENTS,
  VALIDATION_AUTHORITY_RECORD_MAX_BYTES,
  VALIDATION_ROOT_BUDGET_PROJECTION_MAX_BYTES,
  boundedString,
  buildColdResumeStub,
  compactArtifactRefs,
  compactDeliveryReceipts,
  compactLifecycleStateV5,
  compactLocalTaskTrace,
  compactValidationExecution,
  digestValue,
  jsonBytes,
  semanticLifecycleProjection,
  stableStringify
}
