'use strict'

const crypto = require('crypto')

const TASK_CHECKPOINT_EPOCH_SET_SCHEMA = 'TaskCheckpointEpochSetV1'
const TASK_CHECKPOINT_EPOCH_SCHEMA = 'TaskCheckpointEpochV1'
const CHECKPOINT_PHASE_SLOT_SCHEMA = 'CheckpointPhaseSlotV1'
const CHECKPOINT_PHASE_BINDING_SCHEMA = 'CheckpointPhaseBindingV1'
const CHECKPOINT_EPOCH_BOOTSTRAP_AUTHORITY_SCHEMA = 'CheckpointEpochBootstrapAuthorityV1'
const CHECKPOINT_EPOCH_ARCHIVE_REF_SCHEMA = 'CheckpointEpochArchiveRefV1'
const CHECKPOINT_EPOCH_WRITE_PROTOCOL = 'dual-read-single-write-v1'
const CHECKPOINT_EPOCH_CAPABILITY = 1
const CHECKPOINT_EPOCH_HOT_MAX = 8
const CHECKPOINT_EPOCH_TOTAL_REF_MAX = 16
const CHECKPOINT_PHASE_HISTORY_MAX = 8
const CHECKPOINT_CP1_SUPPLEMENT_MAX = 8
const CHECKPOINT_BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000

const HEX_64_RE = /^[a-f0-9]{64}$/
const EPOCH_ID_RE = /^E([0-9]{4,})-([a-f0-9]{12})$/
const PHASES = Object.freeze(['CP1', 'CP2', 'CP3'])
const PHASE_STATES = new Set(['unstarted', 'confirmed', 'invalidated'])
const EPOCH_STATUSES = new Set(['preparing', 'current', 'superseded', 'abandoned'])
const TERMINAL_STATUSES = new Set([null, 'completed', 'rejected', 'cancelled', 'failed'])
const MIGRATION_STATUSES = new Set(['not-required', 'prepared', 'committed', 'verified', 'rolled-back'])
const PROJECTION_STATUSES = new Set(['current', 'pending', 'stale', 'repairing'])
const CONFIRMATION_MODES = new Set(['explicit', 'task-scoped-auto', 'bootstrap-import'])
const AUTHORITY_STATUSES = new Set(['prepared', 'consumed', 'revoked', 'expired'])

class TaskCheckpointEpochV1Error extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'TaskCheckpointEpochV1Error'
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
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_DIGEST_INPUT_INVALID', 'cannot digest an undefined root value')
  }
  return crypto.createHash('sha256').update(serialized).digest('hex')
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && value.length >= 20 && value.length <= 40 && Number.isFinite(Date.parse(value))
}

function normalizeIsoTimestamp(value, field) {
  if (!isIsoTimestamp(value)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TIME_INVALID', `${field} must be an ISO-8601 timestamp`, { field })
  }
  return new Date(value).toISOString()
}

function normalizeTaskId(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > 128) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TASK_ID_INVALID', 'taskId must be non-empty and at most 128 bytes')
  }
  return normalized
}

function normalizeStageKey(value) {
  let normalized = String(value || '').normalize('NFKC').trim().toLowerCase()
    .replace(/[\s_\\/]+/gu, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!normalized) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_STAGE_KEY_INVALID', 'stageKey cannot normalize to an empty value')
  }
  if (Buffer.byteLength(normalized, 'utf8') > 64) {
    const suffix = digestValue(normalized).slice(0, 12)
    while (Buffer.byteLength(normalized, 'utf8') > 48) normalized = normalized.slice(0, -1)
    normalized = `${normalized.replace(/-+$/g, '')}-${suffix}`
  }
  return normalized
}

function normalizeArtifactPath(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) {
    throw new TaskCheckpointEpochV1Error(
      'CHECKPOINT_EPOCH_ARTIFACT_PATH_INVALID',
      'artifactPath must be a task-relative path without parent traversal'
    )
  }
  if (Buffer.byteLength(normalized, 'utf8') > 2048) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_ARTIFACT_PATH_EXCEEDED', 'artifactPath exceeds 2048 bytes')
  }
  return normalized
}

function requireString(value, field, maxBytes = 512) {
  const normalized = String(value || '').trim()
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_FIELD_INVALID', `${field} must be non-empty and at most ${maxBytes} bytes`, { field })
  }
  return normalized
}

function requireDigest(value, field, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null
  const normalized = String(value || '').trim().toLowerCase()
  if (!HEX_64_RE.test(normalized)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_DIGEST_INVALID', `${field} must be a lowercase SHA-256 digest`, { field })
  }
  return normalized
}

function semanticWithout(value, fields) {
  const semantic = clone(value || {})
  for (const field of fields) delete semantic[field]
  return semantic
}

function sameCanonical(value, sealed, digestFields) {
  return stableStringify(semanticWithout(value, digestFields)) === stableStringify(semanticWithout(sealed, digestFields))
}

function sealCheckpointPhaseBinding(input = {}) {
  const phase = String(input.phase || '').toUpperCase()
  if (!PHASES.includes(phase)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_INVALID', 'phase must be CP1, CP2 or CP3')
  }
  const role = input.role === 'supplement' ? 'supplement' : 'primary'
  if (phase !== 'CP1' && role !== 'primary') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_ROLE_INVALID', 'only CP1 may contain supplement bindings')
  }
  const confirmationMode = String(input.confirmationMode || '')
  if (!CONFIRMATION_MODES.has(confirmationMode)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_CONFIRMATION_MODE_INVALID', 'confirmationMode is invalid')
  }
  const semantic = {
    schemaVersion: CHECKPOINT_PHASE_BINDING_SCHEMA,
    phase,
    role,
    artifactPath: normalizeArtifactPath(input.artifactPath),
    artifactSha256: requireDigest(input.artifactSha256, 'artifactSha256'),
    artifactVersion: requireString(input.artifactVersion, 'artifactVersion', 128),
    templateQualificationDigest: requireDigest(input.templateQualificationDigest, 'templateQualificationDigest'),
    confirmationSourceDigest: requireDigest(input.confirmationSourceDigest, 'confirmationSourceDigest'),
    confirmedAt: normalizeIsoTimestamp(requireString(input.confirmedAt, 'confirmedAt', 40), 'confirmedAt'),
    confirmationMode
  }
  return Object.freeze({ ...semantic, bindingDigest: digestValue(semantic) })
}

function validateCheckpointPhaseBinding(value, expectedPhase = '') {
  const errors = []
  if (!isObject(value) || value.schemaVersion !== CHECKPOINT_PHASE_BINDING_SCHEMA) {
    return { valid: false, errors: ['binding-schema'] }
  }
  try {
    const sealed = sealCheckpointPhaseBinding(value)
    if (expectedPhase && sealed.phase !== expectedPhase) errors.push('binding-phase')
    if (!sameCanonical(value, sealed, ['bindingDigest'])) errors.push('binding-noncanonical')
    if (sealed.bindingDigest !== value.bindingDigest) errors.push('binding-digest')
  } catch (error) {
    errors.push(error.code || 'binding-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function sealCheckpointPhaseSlot(input = {}) {
  const phase = String(input.phase || '').toUpperCase()
  if (!PHASES.includes(phase)) throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_INVALID', 'phase must be CP1, CP2 or CP3')
  const state = String(input.state || 'unstarted')
  if (!PHASE_STATES.has(state)) throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_STATE_INVALID', 'phase state is invalid')
  const currentBinding = input.currentBinding ? sealCheckpointPhaseBinding({ ...input.currentBinding, phase, role: 'primary' }) : null
  const history = Array.isArray(input.history)
    ? input.history.map(item => sealCheckpointPhaseBinding({ ...item, phase }))
    : []
  const supplements = Array.isArray(input.supplements)
    ? input.supplements.map(item => sealCheckpointPhaseBinding({ ...item, phase: 'CP1', role: 'supplement' }))
    : []
  if (history.length > CHECKPOINT_PHASE_HISTORY_MAX) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_HISTORY_EXCEEDED', `phase history exceeds ${CHECKPOINT_PHASE_HISTORY_MAX}`)
  }
  if (phase !== 'CP1' && supplements.length) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_SUPPLEMENT_INVALID', 'only CP1 may contain supplements')
  }
  if (supplements.length > CHECKPOINT_CP1_SUPPLEMENT_MAX) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_SUPPLEMENT_EXCEEDED', `CP1 supplements exceed ${CHECKPOINT_CP1_SUPPLEMENT_MAX}`)
  }
  const bindingDigests = [currentBinding, ...history, ...supplements].filter(Boolean).map(item => item.bindingDigest)
  if (new Set(bindingDigests).size !== bindingDigests.length) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_BINDING_DUPLICATE', 'phase bindings must be unique')
  }
  if (phase === 'CP1' && currentBinding && supplements.some(item => item.artifactPath === currentBinding.artifactPath)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_SUPPLEMENT_DUPLICATE', 'CP1 supplements cannot reuse the primary artifact path')
  }
  if (state === 'confirmed' && !currentBinding) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_BINDING_REQUIRED', 'confirmed phase requires currentBinding')
  }
  if (state !== 'confirmed' && currentBinding) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_BINDING_UNEXPECTED', 'only confirmed phase may have currentBinding')
  }
  const slotSequence = Number(input.slotSequence || 0)
  if (!Number.isSafeInteger(slotSequence) || slotSequence < 0) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_SEQUENCE_INVALID', 'slotSequence must be a non-negative safe integer')
  }
  const semantic = {
    schemaVersion: CHECKPOINT_PHASE_SLOT_SCHEMA,
    phase,
    state,
    currentBinding,
    supplements,
    history,
    slotSequence
  }
  return Object.freeze({ ...semantic, slotDigest: digestValue(semantic) })
}

function emptyCheckpointPhaseSlot(phase) {
  return sealCheckpointPhaseSlot({ phase, state: 'unstarted', slotSequence: 0 })
}

function validateCheckpointPhaseSlot(value, expectedPhase = '') {
  const errors = []
  if (!isObject(value) || value.schemaVersion !== CHECKPOINT_PHASE_SLOT_SCHEMA) {
    return { valid: false, errors: ['slot-schema'] }
  }
  try {
    const sealed = sealCheckpointPhaseSlot(value)
    if (expectedPhase && sealed.phase !== expectedPhase) errors.push('slot-phase')
    if (!sameCanonical(value, sealed, ['slotDigest'])) errors.push('slot-noncanonical')
    if (sealed.slotDigest !== value.slotDigest) errors.push('slot-digest')
  } catch (error) {
    errors.push(error.code || 'slot-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function checkpointEpochId(input = {}) {
  const taskId = normalizeTaskId(input.taskId)
  const ordinal = Number(input.ordinal)
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_ORDINAL_INVALID', 'ordinal must be a positive safe integer')
  }
  const stageKey = normalizeStageKey(input.stageKey)
  const parentEpochId = input.parentEpochId ? requireString(input.parentEpochId, 'parentEpochId', 64) : null
  if (parentEpochId && !EPOCH_ID_RE.test(parentEpochId)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_PARENT_ID_INVALID', 'parentEpochId is invalid')
  }
  const primaryCp1Digest = requireDigest(input.primaryCp1Digest, 'primaryCp1Digest')
  const suffix = digestValue({ taskId, ordinal, parentEpochId, stageKey, primaryCp1Digest }).slice(0, 12)
  return `E${String(ordinal).padStart(4, '0')}-${suffix}`
}

function sealTaskCheckpointEpoch(input = {}) {
  const task = {
    taskId: normalizeTaskId(input.task?.taskId || input.taskId),
    taskKind: requireString(input.task?.taskKind || input.taskKind, 'taskKind', 64),
    project: requireString(input.task?.project || input.project, 'project', 128),
    activeRootDigest: requireDigest(input.task?.activeRootDigest || input.activeRootDigest, 'activeRootDigest'),
    admissionId: requireString(input.task?.admissionId || input.admissionId, 'admissionId', 256)
  }
  const ordinal = Number(input.ordinal)
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_ORDINAL_INVALID', 'ordinal must be a positive safe integer')
  }
  const stageKey = normalizeStageKey(input.stageKey)
  const parentEpochId = input.parentEpochId ? requireString(input.parentEpochId, 'parentEpochId', 64) : null
  if (parentEpochId && !EPOCH_ID_RE.test(parentEpochId)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_PARENT_ID_INVALID', 'parentEpochId is invalid')
  }
  const phases = {
    CP1: sealCheckpointPhaseSlot(input.phases?.CP1 || emptyCheckpointPhaseSlot('CP1')),
    CP2: sealCheckpointPhaseSlot(input.phases?.CP2 || emptyCheckpointPhaseSlot('CP2')),
    CP3: sealCheckpointPhaseSlot(input.phases?.CP3 || emptyCheckpointPhaseSlot('CP3'))
  }
  if (phases.CP1.state !== 'confirmed' || !phases.CP1.currentBinding) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CP1_REQUIRED', 'every epoch requires one confirmed primary CP1 binding')
  }
  const expectedId = checkpointEpochId({
    taskId: task.taskId,
    ordinal,
    parentEpochId,
    stageKey,
    primaryCp1Digest: phases.CP1.currentBinding.artifactSha256
  })
  if (input.epochId && input.epochId !== expectedId) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_ID_MISMATCH', 'epochId does not match its immutable identity fields')
  }
  const status = String(input.status || 'preparing')
  const terminalStatus = input.terminalStatus === undefined ? null : input.terminalStatus
  if (!EPOCH_STATUSES.has(status)) throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_STATUS_INVALID', 'epoch status is invalid')
  if (!TERMINAL_STATUSES.has(terminalStatus)) throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TERMINAL_STATUS_INVALID', 'terminalStatus is invalid')
  const owner = {
    ownerGeneration: Number(input.owner?.ownerGeneration ?? input.ownerGeneration ?? 0),
    leaseRevision: Number(input.owner?.leaseRevision ?? input.leaseRevision ?? 0),
    leaseDigest: requireDigest(input.owner?.leaseDigest ?? input.leaseDigest, 'leaseDigest')
  }
  if (![owner.ownerGeneration, owner.leaseRevision].every(item => Number.isSafeInteger(item) && item >= 0)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_OWNER_INVALID', 'owner generation and lease revision must be non-negative safe integers')
  }
  const runtime = {
    stateSchemaVersion: requireString(input.runtime?.stateSchemaVersion, 'stateSchemaVersion', 64),
    packageVersion: requireString(input.runtime?.packageVersion, 'packageVersion', 64),
    mcpProtocolVersion: requireString(input.runtime?.mcpProtocolVersion, 'mcpProtocolVersion', 64),
    sourceHead: requireString(input.runtime?.sourceHead, 'sourceHead', 128),
    epochCapability: Number(input.runtime?.epochCapability)
  }
  if (runtime.epochCapability !== CHECKPOINT_EPOCH_CAPABILITY) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CAPABILITY_INVALID', 'epochCapability must equal 1')
  }
  const createdAt = requireString(input.createdAt, 'createdAt', 40)
  if (!isIsoTimestamp(createdAt)) throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CREATED_AT_INVALID', 'createdAt must be ISO-8601')
  const nullableTime = field => {
    const value = input[field] || null
    if (value && !isIsoTimestamp(value)) throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TIME_INVALID', `${field} must be ISO-8601`, { field })
    return value
  }
  const semantic = {
    schemaVersion: TASK_CHECKPOINT_EPOCH_SCHEMA,
    epochId: expectedId,
    ordinal,
    parentEpochId,
    stageKey,
    status,
    terminalStatus,
    task,
    lineage: {
      canonicalRevision: Number(input.lineage?.canonicalRevision ?? 0),
      canonicalHeadDigest: requireDigest(input.lineage?.canonicalHeadDigest, 'canonicalHeadDigest'),
      canonicalParentRevision: input.lineage?.canonicalParentRevision === null || input.lineage?.canonicalParentRevision === undefined
        ? null
        : Number(input.lineage.canonicalParentRevision),
      scopeDigest: requireDigest(input.lineage?.scopeDigest, 'scopeDigest')
    },
    owner,
    context: {
      contextEpoch: input.context?.contextEpoch ? requireString(input.context.contextEpoch, 'contextEpoch', 256) : null,
      planContentId: input.context?.planContentId ? requireString(input.context.planContentId, 'planContentId', 256) : null,
      autoGrantDigest: requireDigest(input.context?.autoGrantDigest, 'autoGrantDigest', true),
      autoDecisionDigest: requireDigest(input.context?.autoDecisionDigest, 'autoDecisionDigest', true),
      validationAuthorityDigest: requireDigest(input.context?.validationAuthorityDigest, 'validationAuthorityDigest', true)
    },
    phases,
    runtime,
    createdAt,
    activatedAt: nullableTime('activatedAt'),
    supersededAt: nullableTime('supersededAt'),
    terminalAt: nullableTime('terminalAt'),
    trigger: requireString(input.trigger || 'checkpoint-epoch', 'trigger', 128)
  }
  const lineageNumbers = [semantic.lineage.canonicalRevision]
  if (semantic.lineage.canonicalParentRevision !== null) lineageNumbers.push(semantic.lineage.canonicalParentRevision)
  if (!lineageNumbers.every(item => Number.isSafeInteger(item) && item >= 0)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_LINEAGE_INVALID', 'canonical revisions must be non-negative safe integers')
  }
  if (phases.CP3.state === 'confirmed' && phases.CP2.state !== 'confirmed') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CP_PREDECESSOR_MISSING', 'confirmed CP3 requires confirmed CP2')
  }
  if (status === 'current' && !semantic.activatedAt) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_ACTIVATED_AT_REQUIRED', 'current epoch requires activatedAt')
  }
  if (status === 'superseded' && !semantic.supersededAt) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_SUPERSEDED_AT_REQUIRED', 'superseded epoch requires supersededAt')
  }
  if (terminalStatus && !semantic.terminalAt) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TERMINAL_AT_REQUIRED', 'terminal epoch requires terminalAt')
  }
  return Object.freeze({ ...semantic, epochDigest: digestValue(semantic) })
}

function validateTaskCheckpointEpoch(value) {
  const errors = []
  if (!isObject(value) || value.schemaVersion !== TASK_CHECKPOINT_EPOCH_SCHEMA) return { valid: false, errors: ['epoch-schema'] }
  try {
    const sealed = sealTaskCheckpointEpoch(value)
    if (!sameCanonical(value, sealed, ['epochDigest'])) errors.push('epoch-noncanonical')
    if (sealed.epochDigest !== value.epochDigest) errors.push('epoch-digest')
  } catch (error) {
    errors.push(error.code || 'epoch-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function sealCheckpointEpochArchiveRef(input = {}) {
  const ordinal = Number(input.ordinal)
  const match = EPOCH_ID_RE.exec(String(input.epochId || ''))
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || !match || Number(match[1]) !== ordinal) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_ARCHIVE_IDENTITY_INVALID', 'archive ref requires a valid epochId and ordinal')
  }
  const semantic = {
    schemaVersion: CHECKPOINT_EPOCH_ARCHIVE_REF_SCHEMA,
    epochId: input.epochId,
    ordinal,
    stageKey: normalizeStageKey(input.stageKey),
    status: String(input.status || ''),
    terminalStatus: input.terminalStatus === undefined ? null : input.terminalStatus,
    epochDigest: requireDigest(input.epochDigest, 'epochDigest'),
    storage: String(input.storage || 'task-recovery-archive'),
    archivePath: input.archivePath ? normalizeArtifactPath(input.archivePath) : null
  }
  if (!EPOCH_STATUSES.has(semantic.status) || !TERMINAL_STATUSES.has(semantic.terminalStatus)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_ARCHIVE_STATUS_INVALID', 'archive ref status is invalid')
  }
  return Object.freeze({ ...semantic, refDigest: digestValue(semantic) })
}

function sealTaskCheckpointEpochSet(input = {}) {
  const taskId = normalizeTaskId(input.taskId)
  const epochs = Array.isArray(input.epochs) ? input.epochs.map(sealTaskCheckpointEpoch) : []
  const archiveRefs = Array.isArray(input.archiveRefs) ? input.archiveRefs.map(sealCheckpointEpochArchiveRef) : []
  if (epochs.length > CHECKPOINT_EPOCH_HOT_MAX) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_HOT_LIMIT_EXCEEDED', `hot epoch count exceeds ${CHECKPOINT_EPOCH_HOT_MAX}`)
  }
  if (epochs.length + archiveRefs.length > CHECKPOINT_EPOCH_TOTAL_REF_MAX) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TOTAL_REF_LIMIT_EXCEEDED', `epoch/ref count exceeds ${CHECKPOINT_EPOCH_TOTAL_REF_MAX}`)
  }
  const epochIds = [...epochs.map(item => item.epochId), ...archiveRefs.map(item => item.epochId)]
  const ordinals = [...epochs.map(item => item.ordinal), ...archiveRefs.map(item => item.ordinal)]
  if (new Set(epochIds).size !== epochIds.length || new Set(ordinals).size !== ordinals.length) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_IDENTITY_DUPLICATE', 'epoch ids and ordinals must be unique')
  }
  if (epochs.some(item => item.task.taskId !== taskId)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TASK_MISMATCH', 'every epoch must belong to the set taskId')
  }
  const current = epochs.filter(item => item.status === 'current')
  if (current.length > 1) throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_MULTIPLE_CURRENT', 'at most one epoch may be current')
  if (epochs.filter(item => item.status === 'preparing').length > 1) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_MULTIPLE_PREPARING', 'at most one epoch may be preparing')
  }
  const currentEpochId = input.currentEpochId || null
  if ((current.length === 1 && current[0].epochId !== currentEpochId) || (current.length === 0 && currentEpochId !== null)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CURRENT_POINTER_INVALID', 'currentEpochId must match the only current epoch')
  }
  const identityById = new Map([
    ...epochs.map(item => [item.epochId, item]),
    ...archiveRefs.map(item => [item.epochId, item])
  ])
  for (const item of epochs) {
    if (!item.parentEpochId) continue
    const parent = identityById.get(item.parentEpochId)
    if (!parent || parent.ordinal >= item.ordinal) {
      throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_PARENT_INVALID', 'epoch parent must be retained and have a lower ordinal')
    }
  }
  const maxOrdinal = Math.max(0, ...ordinals)
  const nextOrdinal = Number(input.nextOrdinal)
  if (!Number.isSafeInteger(nextOrdinal) || nextOrdinal <= maxOrdinal) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_NEXT_ORDINAL_INVALID', 'nextOrdinal must be greater than every retained ordinal')
  }
  const stateSequence = Number(input.stateSequence)
  const writerGeneration = Number(input.writerGeneration)
  if (![stateSequence, writerGeneration].every(item => Number.isSafeInteger(item) && item >= 0)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_FENCE_INVALID', 'stateSequence and writerGeneration must be non-negative safe integers')
  }
  const migration = {
    migrationId: requireDigest(input.migration?.migrationId, 'migrationId'),
    from: requireString(input.migration?.from, 'migration.from', 64),
    status: String(input.migration?.status || ''),
    bootstrapAuthorityDigest: requireDigest(input.migration?.bootstrapAuthorityDigest, 'bootstrapAuthorityDigest', true),
    legacyProjectionDigest: requireDigest(input.migration?.legacyProjectionDigest, 'legacyProjectionDigest', true)
  }
  if (!MIGRATION_STATUSES.has(migration.status)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_MIGRATION_STATUS_INVALID', 'migration status is invalid')
  }
  const projection = {
    desiredDigest: requireDigest(input.projection?.desiredDigest, 'projection.desiredDigest'),
    observedDigest: requireDigest(input.projection?.observedDigest, 'projection.observedDigest', true),
    status: String(input.projection?.status || ''),
    sequence: Number(input.projection?.sequence)
  }
  if (!PROJECTION_STATUSES.has(projection.status) || !Number.isSafeInteger(projection.sequence) || projection.sequence < 0) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_PROJECTION_INVALID', 'projection status/sequence is invalid')
  }
  const semantic = {
    schemaVersion: TASK_CHECKPOINT_EPOCH_SET_SCHEMA,
    taskId,
    currentEpochId,
    nextOrdinal,
    writeProtocol: CHECKPOINT_EPOCH_WRITE_PROTOCOL,
    stateSequence,
    writerGeneration,
    migration,
    projection,
    epochs: epochs.sort((left, right) => left.ordinal - right.ordinal),
    archiveRefs: archiveRefs.sort((left, right) => left.ordinal - right.ordinal)
  }
  return Object.freeze({ ...semantic, setDigest: digestValue(semantic) })
}

function validateTaskCheckpointEpochSet(value, expected = {}) {
  const errors = []
  if (!isObject(value) || value.schemaVersion !== TASK_CHECKPOINT_EPOCH_SET_SCHEMA) return { valid: false, errors: ['set-schema'] }
  try {
    const sealed = sealTaskCheckpointEpochSet(value)
    if (!sameCanonical(value, sealed, ['setDigest'])) errors.push('set-noncanonical')
    if (sealed.setDigest !== value.setDigest) errors.push('set-digest')
    if (expected.taskId && sealed.taskId !== normalizeTaskId(expected.taskId)) errors.push('set-task-id')
    if (expected.stateSequence !== undefined && sealed.stateSequence !== expected.stateSequence) errors.push('set-state-sequence')
    if (expected.writerGeneration !== undefined && sealed.writerGeneration !== expected.writerGeneration) errors.push('set-writer-generation')
    const writeEpochs = sealed.epochs.filter(item => ['preparing', 'current'].includes(item.status))
    if (expected.writerGeneration !== undefined && writeEpochs.some(item => item.owner.ownerGeneration !== expected.writerGeneration)) {
      errors.push('write-epoch-owner-generation')
    }
  } catch (error) {
    errors.push(error.code || 'set-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function bindTaskCheckpointEpochSetFence(value, fence = {}) {
  const validation = validateTaskCheckpointEpochSet(value)
  if (!validation.valid) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_SET_INVALID', 'cannot bind an invalid epoch set', { errors: validation.errors })
  }
  const sealed = sealTaskCheckpointEpochSet(value)
  const authority = isObject(fence.authority) ? fence.authority : null
  const epochs = authority
    ? sealed.epochs.map(epoch => ['current', 'preparing'].includes(epoch.status)
        ? synchronizeTaskCheckpointEpochAuthority(epoch, authority)
        : epoch)
    : sealed.epochs
  const projectionDesiredDigest = checkpointEpochProjectionDigest({
    ...sealed,
    epochs
  })
  const projectionChanged = projectionDesiredDigest !== sealed.projection.desiredDigest
  return sealTaskCheckpointEpochSet({
    ...sealed,
    stateSequence: Number(fence.stateSequence),
    writerGeneration: Number(fence.writerGeneration),
    epochs,
    projection: {
      ...sealed.projection,
      desiredDigest: projectionDesiredDigest,
      status: projectionChanged ? 'pending' : sealed.projection.status
    }
  })
}

/**
 * Only current/preparing epochs follow the live V5 authority. Historical
 * epochs are immutable audit records and must never be rewritten by a later
 * owner, admission generation, canonical revision, or ContextRead turn.
 */
function synchronizeTaskCheckpointEpochAuthority(value, authority = {}) {
  const epoch = sealTaskCheckpointEpoch(value)
  const owner = isObject(authority.owner) ? authority.owner : {}
  const lineage = isObject(authority.lineage) ? authority.lineage : {}
  const context = isObject(authority.context) ? authority.context : {}
  const has = (object, field) => Object.prototype.hasOwnProperty.call(object, field)
  return sealTaskCheckpointEpoch({
    ...epoch,
    task: {
      ...epoch.task,
      taskKind: authority.taskKind || epoch.task.taskKind,
      project: authority.project || epoch.task.project,
      activeRootDigest: authority.activeRootDigest || epoch.task.activeRootDigest,
      admissionId: authority.admissionId || epoch.task.admissionId
    },
    owner: {
      ownerGeneration: Number.isSafeInteger(owner.ownerGeneration)
        ? owner.ownerGeneration
        : epoch.owner.ownerGeneration,
      leaseRevision: Number.isSafeInteger(owner.leaseRevision)
        ? owner.leaseRevision
        : epoch.owner.leaseRevision,
      leaseDigest: owner.leaseDigest || epoch.owner.leaseDigest
    },
    lineage: {
      canonicalRevision: Number.isSafeInteger(lineage.canonicalRevision)
        ? lineage.canonicalRevision
        : epoch.lineage.canonicalRevision,
      canonicalHeadDigest: lineage.canonicalHeadDigest || epoch.lineage.canonicalHeadDigest,
      canonicalParentRevision: has(lineage, 'canonicalParentRevision')
        ? lineage.canonicalParentRevision
        : epoch.lineage.canonicalParentRevision,
      scopeDigest: lineage.scopeDigest || epoch.lineage.scopeDigest
    },
    context: {
      contextEpoch: has(context, 'contextEpoch') ? context.contextEpoch : epoch.context.contextEpoch,
      planContentId: has(context, 'planContentId') ? context.planContentId : epoch.context.planContentId,
      autoGrantDigest: has(context, 'autoGrantDigest') ? context.autoGrantDigest : epoch.context.autoGrantDigest,
      autoDecisionDigest: has(context, 'autoDecisionDigest') ? context.autoDecisionDigest : epoch.context.autoDecisionDigest,
      validationAuthorityDigest: has(context, 'validationAuthorityDigest')
        ? context.validationAuthorityDigest
        : epoch.context.validationAuthorityDigest
    },
    terminalStatus: has(authority, 'terminalStatus') ? authority.terminalStatus : epoch.terminalStatus,
    terminalAt: has(authority, 'terminalAt') ? authority.terminalAt : epoch.terminalAt
  })
}

function checkpointEpochProjectionIdentity(value = {}) {
  const epochs = Array.isArray(value.epochs) ? value.epochs : []
  const current = epochs.find(item => item.epochId === value.currentEpochId) || null
  const phaseIdentity = epoch => Object.fromEntries(PHASES.map(phase => {
    const slot = epoch?.phases?.[phase]
    return [phase, {
      state: slot?.state || 'unstarted',
      currentBindingDigest: slot?.currentBinding?.bindingDigest || null,
      supplementDigests: Array.isArray(slot?.supplements)
        ? slot.supplements.map(item => item.bindingDigest)
        : [],
      slotSequence: Number(slot?.slotSequence || 0)
    }]
  }))
  return {
    schemaVersion: 'CheckpointEpochProjectionIdentityV1',
    taskId: value.taskId || null,
    current: current
      ? {
          epochId: current.epochId,
          ordinal: current.ordinal,
          stageKey: current.stageKey,
          status: current.status,
          terminalStatus: current.terminalStatus,
          phases: phaseIdentity(current)
        }
      : null,
    history: epochs
      .filter(item => item.status === 'superseded')
      .map(item => ({
        epochId: item.epochId,
        ordinal: item.ordinal,
        stageKey: item.stageKey,
        status: item.status,
        terminalStatus: item.terminalStatus,
        phases: phaseIdentity(item)
      })),
    archiveRefs: (Array.isArray(value.archiveRefs) ? value.archiveRefs : []).map(item => ({
      epochId: item.epochId,
      ordinal: item.ordinal,
      stageKey: item.stageKey,
      status: item.status,
      terminalStatus: item.terminalStatus,
      epochDigest: item.epochDigest
    }))
  }
}

function checkpointEpochProjectionDigest(value = {}) {
  return digestValue(checkpointEpochProjectionIdentity(value))
}

function boundedPhaseHistory(slot, currentBinding = null) {
  const history = [...(Array.isArray(slot?.history) ? slot.history : [])]
  if (currentBinding) history.push(currentBinding)
  return history.slice(-CHECKPOINT_PHASE_HISTORY_MAX)
}

function invalidateCheckpointPhaseSlot(value) {
  const slot = sealCheckpointPhaseSlot(value)
  if (slot.state === 'unstarted' && !slot.currentBinding) return slot
  return sealCheckpointPhaseSlot({
    ...slot,
    state: 'unstarted',
    currentBinding: null,
    supplements: [],
    history: boundedPhaseHistory(slot, slot.currentBinding),
    slotSequence: slot.slotSequence + 1
  })
}

function confirmCheckpointPhaseSlot(value, binding) {
  const slot = sealCheckpointPhaseSlot(value)
  const candidate = sealCheckpointPhaseBinding({ ...binding, phase: slot.phase, role: 'primary' })
  if (slot.state === 'confirmed' && slot.currentBinding?.bindingDigest === candidate.bindingDigest) {
    return { status: 'unchanged', slot }
  }
  return {
    status: 'confirmed',
    slot: sealCheckpointPhaseSlot({
      ...slot,
      state: 'confirmed',
      currentBinding: candidate,
      history: boundedPhaseHistory(slot, slot.currentBinding),
      slotSequence: slot.slotSequence + 1
    })
  }
}

/**
 * Confirm CP2/CP3 inside the current epoch. A different CP1 is a successor
 * request and is deliberately rejected here so callers cannot clear a live
 * stage in place. Revising CP2 invalidates CP3 in the same sealed transition.
 */
function confirmTaskCheckpointPhase(input = {}) {
  const epochSet = sealTaskCheckpointEpochSet(input.epochSet)
  const phase = String(input.phase || '').toUpperCase()
  if (!PHASES.includes(phase)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_PHASE_INVALID', 'phase must be CP1, CP2 or CP3')
  }
  const current = epochSet.epochs.find(item => item.epochId === epochSet.currentEpochId)
  if (!current || current.status !== 'current') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CURRENT_REQUIRED', 'phase confirmation requires one current epoch')
  }
  if (input.expectedEpochId && input.expectedEpochId !== current.epochId) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_PHASE_LINEAGE_MISMATCH', 'phase confirmation targets another epoch')
  }
  if (current.terminalStatus) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TERMINAL', 'a terminal epoch cannot accept another checkpoint')
  }
  if (phase === 'CP3' && current.phases.CP2.state !== 'confirmed') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CP_PREDECESSOR_MISSING', 'confirmed CP3 requires confirmed CP2')
  }
  const confirmed = confirmCheckpointPhaseSlot(current.phases[phase], input.binding)
  if (phase === 'CP1' && confirmed.status !== 'unchanged') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_SUCCESSOR_REQUIRED', 'a different CP1 must create a successor epoch')
  }
  if (confirmed.status === 'unchanged') return { status: 'unchanged', epochSet, epoch: current }
  const phases = { ...current.phases, [phase]: confirmed.slot }
  if (phase === 'CP2') phases.CP3 = invalidateCheckpointPhaseSlot(current.phases.CP3)
  const updated = sealTaskCheckpointEpoch({ ...current, phases })
  const epochs = epochSet.epochs.map(item => item.epochId === updated.epochId ? updated : item)
  const desiredDigest = checkpointEpochProjectionDigest({ ...epochSet, epochs })
  const next = sealTaskCheckpointEpochSet({
    ...epochSet,
    epochs,
    projection: {
      ...epochSet.projection,
      desiredDigest,
      status: 'pending',
      sequence: epochSet.projection.sequence + 1
    }
  })
  return { status: 'confirmed', epochSet: next, epoch: updated }
}

function prepareTaskCheckpointEpochSuccessor(input = {}, options = {}) {
  const epochSet = sealTaskCheckpointEpochSet(input.epochSet)
  const current = epochSet.epochs.find(item => item.epochId === epochSet.currentEpochId)
  if (!current || current.status !== 'current') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CURRENT_REQUIRED', 'successor preparation requires one current epoch')
  }
  const binding = sealCheckpointPhaseBinding({ ...input.cp1Binding, phase: 'CP1', role: 'primary' })
  const ordinal = epochSet.nextOrdinal
  const stageKey = normalizeStageKey(input.stageKey)
  const expectedId = checkpointEpochId({
    taskId: epochSet.taskId,
    ordinal,
    parentEpochId: current.epochId,
    stageKey,
    primaryCp1Digest: binding.artifactSha256
  })
  const existingPreparing = epochSet.epochs.find(item => item.status === 'preparing')
  if (existingPreparing) {
    if (existingPreparing.epochId === expectedId &&
        existingPreparing.phases.CP1.currentBinding?.bindingDigest === binding.bindingDigest) {
      return { status: 'unchanged', epochSet, epoch: existingPreparing }
    }
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_PREPARING_CONFLICT', 'another successor epoch is already preparing')
  }
  const authority = isObject(input.authority) ? input.authority : {}
  const createdAt = normalizeIsoTimestamp(input.createdAt || new Date(options.nowMs ?? Date.now()).toISOString(), 'createdAt')
  const successor = sealTaskCheckpointEpoch({
    epochId: expectedId,
    ordinal,
    parentEpochId: current.epochId,
    stageKey,
    status: 'preparing',
    terminalStatus: null,
    task: {
      ...current.task,
      admissionId: authority.admissionId || current.task.admissionId
    },
    lineage: authority.lineage || current.lineage,
    owner: authority.owner || current.owner,
    context: authority.context || current.context,
    phases: {
      CP1: sealCheckpointPhaseSlot({
        phase: 'CP1',
        state: 'confirmed',
        currentBinding: binding,
        supplements: Array.isArray(input.cp1Supplements) ? input.cp1Supplements : [],
        history: [],
        slotSequence: 1
      }),
      CP2: emptyCheckpointPhaseSlot('CP2'),
      CP3: emptyCheckpointPhaseSlot('CP3')
    },
    runtime: input.runtime || current.runtime,
    createdAt,
    activatedAt: null,
    supersededAt: null,
    terminalAt: null,
    trigger: String(input.trigger || 'checkpoint-successor')
  })
  return {
    status: 'prepared',
    epoch: successor,
    epochSet: sealTaskCheckpointEpochSet({
      ...epochSet,
      nextOrdinal: ordinal + 1,
      epochs: [...epochSet.epochs, successor]
    })
  }
}

function activateTaskCheckpointEpochSuccessor(input = {}, options = {}) {
  const epochSet = sealTaskCheckpointEpochSet(input.epochSet)
  const target = epochSet.epochs.find(item => item.status === 'preparing' &&
    (!input.epochId || item.epochId === input.epochId))
  if (!target) {
    const replay = input.epochId && epochSet.currentEpochId === input.epochId
      ? epochSet.epochs.find(item => item.epochId === input.epochId)
      : null
    if (replay) return { status: 'unchanged', epochSet, epoch: replay }
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_PREPARING_TARGET_MISSING', 'prepared successor epoch is missing')
  }
  const activatedAt = normalizeIsoTimestamp(input.activatedAt || new Date(options.nowMs ?? Date.now()).toISOString(), 'activatedAt')
  const epochs = epochSet.epochs.map(item => {
    if (item.epochId === target.epochId) {
      return sealTaskCheckpointEpoch({ ...item, status: 'current', activatedAt })
    }
    if (item.status === 'current') {
      return sealTaskCheckpointEpoch({ ...item, status: 'superseded', supersededAt: activatedAt })
    }
    return item
  })
  const desiredDigest = checkpointEpochProjectionDigest({ ...epochSet, currentEpochId: target.epochId, epochs })
  const next = sealTaskCheckpointEpochSet({
    ...epochSet,
    currentEpochId: target.epochId,
    epochs,
    projection: {
      ...epochSet.projection,
      desiredDigest,
      status: 'pending',
      sequence: epochSet.projection.sequence + 1
    }
  })
  return { status: 'activated', epochSet: next, epoch: next.epochs.find(item => item.epochId === target.epochId) }
}

function closeCurrentTaskCheckpointEpoch(input = {}, options = {}) {
  const epochSet = sealTaskCheckpointEpochSet(input.epochSet)
  const terminalStatus = String(input.terminalStatus || '')
  if (!TERMINAL_STATUSES.has(terminalStatus) || terminalStatus === null) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TERMINAL_STATUS_INVALID', 'terminalStatus is invalid')
  }
  const current = epochSet.epochs.find(item => item.epochId === epochSet.currentEpochId)
  if (!current || current.status !== 'current') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_CURRENT_REQUIRED', 'terminal closeout requires one current epoch')
  }
  if (current.terminalStatus === terminalStatus) return { status: 'unchanged', epochSet, epoch: current }
  if (current.terminalStatus) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_TERMINAL_CONFLICT', 'current epoch already has another terminal status')
  }
  const terminalAt = normalizeIsoTimestamp(input.terminalAt || new Date(options.nowMs ?? Date.now()).toISOString(), 'terminalAt')
  const updated = sealTaskCheckpointEpoch({ ...current, terminalStatus, terminalAt })
  const epochs = epochSet.epochs.map(item => item.epochId === updated.epochId ? updated : item)
  const desiredDigest = checkpointEpochProjectionDigest({ ...epochSet, epochs })
  const next = sealTaskCheckpointEpochSet({
    ...epochSet,
    epochs,
    projection: {
      ...epochSet.projection,
      desiredDigest,
      status: 'pending',
      sequence: epochSet.projection.sequence + 1
    }
  })
  return { status: 'closed', epochSet: next, epoch: updated }
}

function compactTaskCheckpointEpochSet(value, options = {}) {
  const validation = validateTaskCheckpointEpochSet(value)
  if (!validation.valid) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_SET_INVALID', 'cannot compact an invalid epoch set', { errors: validation.errors })
  }
  const sealed = sealTaskCheckpointEpochSet(value)
  if (options.cold !== true || sealed.epochs.length <= 2) return sealed
  const current = sealed.epochs.find(item => item.epochId === sealed.currentEpochId) || null
  const complete = sealed.epochs
    .filter(item => item.status === 'superseded' && PHASES.every(phase => item.phases[phase].state === 'confirmed'))
    .sort((left, right) => right.ordinal - left.ordinal)[0] || null
  const rollback = complete || sealed.epochs
    .filter(item => item.status === 'superseded')
    .sort((left, right) => right.ordinal - left.ordinal)[0] || null
  const retainedIds = new Set([current?.epochId, rollback?.epochId].filter(Boolean))
  const retained = sealed.epochs.filter(item => retainedIds.has(item.epochId))
  const refsById = new Map(sealed.archiveRefs.map(item => [item.epochId, item]))
  for (const epoch of sealed.epochs) {
    if (retainedIds.has(epoch.epochId)) continue
    refsById.set(epoch.epochId, sealCheckpointEpochArchiveRef({
      epochId: epoch.epochId,
      ordinal: epoch.ordinal,
      stageKey: epoch.stageKey,
      status: epoch.status,
      terminalStatus: epoch.terminalStatus,
      epochDigest: epoch.epochDigest,
      storage: 'task-recovery-cold-summary',
      archivePath: null
    }))
  }
  return sealTaskCheckpointEpochSet({ ...sealed, epochs: retained, archiveRefs: [...refsById.values()] })
}

function normalizeBootstrapEvidence(item = {}) {
  const role = item.role === 'supplement' ? 'supplement' : 'primary'
  return {
    phase: 'CP1',
    role,
    artifactPath: normalizeArtifactPath(item.artifactPath),
    artifactSha256: requireDigest(item.artifactSha256, 'artifactSha256'),
    artifactVersion: requireString(item.artifactVersion, 'artifactVersion', 128),
    templateQualificationDigest: requireDigest(item.templateQualificationDigest, 'templateQualificationDigest'),
    confirmationSourceDigest: requireDigest(item.confirmationSourceDigest, 'confirmationSourceDigest'),
    confirmedAt: requireString(item.confirmedAt, 'confirmedAt', 40),
    confirmationMode: CONFIRMATION_MODES.has(item.confirmationMode) ? item.confirmationMode : 'bootstrap-import'
  }
}

function authorityImmutableProjection(authority) {
  return {
    schemaVersion: authority.schemaVersion,
    operation: authority.operation,
    task: authority.task,
    target: authority.target,
    evidence: authority.evidence,
    runtime: authority.runtime,
    fence: authority.fence,
    createdBy: authority.createdBy,
    createdAt: authority.createdAt,
    expiresAt: authority.expiresAt,
    maxUses: authority.maxUses
  }
}

function sealCheckpointEpochBootstrapAuthority(input = {}, options = {}) {
  const createdAt = normalizeIsoTimestamp(input.createdAt || new Date(options.nowMs ?? Date.now()).toISOString(), 'createdAt')
  const expiresAt = normalizeIsoTimestamp(input.expiresAt || new Date(Date.parse(createdAt) + CHECKPOINT_BOOTSTRAP_TTL_MS).toISOString(), 'expiresAt')
  if (!isIsoTimestamp(createdAt) || !isIsoTimestamp(expiresAt) || Date.parse(expiresAt) - Date.parse(createdAt) !== CHECKPOINT_BOOTSTRAP_TTL_MS) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_TTL_INVALID', 'bootstrap authority must have an exact 24-hour TTL')
  }
  const evidence = (Array.isArray(input.evidence) ? input.evidence : []).map(normalizeBootstrapEvidence)
    .sort((left, right) => (left.role === right.role ? left.artifactPath.localeCompare(right.artifactPath) : (left.role === 'primary' ? -1 : 1)))
  if (evidence.filter(item => item.role === 'primary').length !== 1 || evidence.filter(item => item.role === 'supplement').length > CHECKPOINT_CP1_SUPPLEMENT_MAX) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_EVIDENCE_INVALID', 'bootstrap requires exactly one primary CP1 and at most eight supplements')
  }
  if (new Set(evidence.map(item => item.artifactPath)).size !== evidence.length) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_EVIDENCE_DUPLICATE', 'bootstrap evidence paths must be unique')
  }
  const expectedOrdinal = Number(input.target?.expectedOrdinal)
  const fence = {
    expectedStateSequence: Number(input.fence?.expectedStateSequence),
    expectedWriterGeneration: Number(input.fence?.expectedWriterGeneration),
    expectedOwnerGeneration: Number(input.fence?.expectedOwnerGeneration)
  }
  if (!Number.isSafeInteger(expectedOrdinal) || expectedOrdinal < 1 || !Object.values(fence).every(item => Number.isSafeInteger(item) && item >= 0)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_FENCE_INVALID', 'bootstrap ordinal and fence values must be safe non-negative integers')
  }
  const semantic = {
    schemaVersion: CHECKPOINT_EPOCH_BOOTSTRAP_AUTHORITY_SCHEMA,
    operation: 'bootstrap-current-epoch',
    task: {
      taskId: normalizeTaskId(input.task?.taskId),
      taskKind: requireString(input.task?.taskKind, 'taskKind', 64),
      project: requireString(input.task?.project, 'project', 128),
      activeRootDigest: requireDigest(input.task?.activeRootDigest, 'activeRootDigest')
    },
    target: {
      stageKey: normalizeStageKey(input.target?.stageKey),
      expectedOrdinal,
      parentEpochId: input.target?.parentEpochId ? requireString(input.target.parentEpochId, 'parentEpochId', 64) : null
    },
    evidence,
    runtime: {
      sourceHead: requireString(input.runtime?.sourceHead, 'sourceHead', 128),
      stateSchemaVersion: requireString(input.runtime?.stateSchemaVersion, 'stateSchemaVersion', 64),
      packageVersion: requireString(input.runtime?.packageVersion, 'packageVersion', 64),
      mcpProtocolVersion: requireString(input.runtime?.mcpProtocolVersion, 'mcpProtocolVersion', 64),
      epochCapability: Number(input.runtime?.epochCapability)
    },
    fence,
    createdBy: requireString(input.createdBy || 'workflow-single-writer', 'createdBy', 128),
    createdAt,
    expiresAt,
    maxUses: 1,
    status: String(input.status || 'prepared'),
    useCount: Number(input.useCount || 0),
    consumedAt: input.consumedAt ? normalizeIsoTimestamp(input.consumedAt, 'consumedAt') : null
  }
  if (semantic.runtime.epochCapability !== CHECKPOINT_EPOCH_CAPABILITY || !AUTHORITY_STATUSES.has(semantic.status)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_RUNTIME_INVALID', 'bootstrap runtime capability or status is invalid')
  }
  if (semantic.runtime.stateSchemaVersion !== 'TaskRecoveryStateV5' || semantic.createdBy !== 'workflow-single-writer') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_OWNER_INVALID', 'bootstrap authority must be created by the V5 workflow single writer')
  }
  if (!Number.isSafeInteger(semantic.useCount) || semantic.useCount < 0 || semantic.useCount > 1) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_USE_INVALID', 'bootstrap useCount must be 0 or 1')
  }
  if (semantic.status === 'consumed' && (semantic.useCount !== 1 || !isIsoTimestamp(semantic.consumedAt))) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_CONSUMED_INVALID', 'consumed authority requires useCount=1 and consumedAt')
  }
  if (semantic.status !== 'consumed' && (semantic.useCount !== 0 || semantic.consumedAt !== null)) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_USE_INVALID', 'unconsumed authority cannot carry use state')
  }
  semantic.authorityId = digestValue(authorityImmutableProjection(semantic))
  return Object.freeze({ ...semantic, authorityDigest: digestValue(semantic) })
}

function validateCheckpointEpochBootstrapAuthority(value, expected = {}, options = {}) {
  const errors = []
  if (!isObject(value) || value.schemaVersion !== CHECKPOINT_EPOCH_BOOTSTRAP_AUTHORITY_SCHEMA) {
    return { valid: false, errors: ['authority-schema'] }
  }
  try {
    const sealed = sealCheckpointEpochBootstrapAuthority(value)
    if (!sameCanonical(value, sealed, ['authorityDigest', 'authorityId'])) errors.push('authority-noncanonical')
    if (sealed.authorityId !== value.authorityId) errors.push('authority-id')
    if (sealed.authorityDigest !== value.authorityDigest) errors.push('authority-digest')
    if (expected.taskId && sealed.task.taskId !== normalizeTaskId(expected.taskId)) errors.push('authority-task-id')
    // V5 compares project namespaces without case. Keep the sealed original
    // spelling and digest as provenance; normalize only this comparison key.
    if (expected.project && sealed.task.project.toLowerCase() !== String(expected.project).toLowerCase()) errors.push('authority-project')
    if (expected.activeRootDigest && sealed.task.activeRootDigest !== expected.activeRootDigest) errors.push('authority-active-root')
    if (expected.stateSequence !== undefined && sealed.fence.expectedStateSequence !== expected.stateSequence) errors.push('authority-state-sequence')
    if (expected.writerGeneration !== undefined && sealed.fence.expectedWriterGeneration !== expected.writerGeneration) errors.push('authority-writer-generation')
    const nowMs = options.nowMs ?? Date.now()
    if (sealed.status === 'prepared' && nowMs >= Date.parse(sealed.expiresAt) && options.allowExpired !== true) errors.push('authority-expired')
  } catch (error) {
    errors.push(error.code || 'authority-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function phaseSlotFromBootstrapEvidence(evidence) {
  const primary = evidence.find(item => item.role === 'primary')
  const supplements = evidence.filter(item => item.role === 'supplement')
  return sealCheckpointPhaseSlot({
    phase: 'CP1',
    state: 'confirmed',
    currentBinding: sealCheckpointPhaseBinding(primary),
    supplements: supplements.map(sealCheckpointPhaseBinding),
    history: [],
    slotSequence: 1
  })
}

function prepareTaskCheckpointEpochBootstrap(input = {}, options = {}) {
  const authority = sealCheckpointEpochBootstrapAuthority(input.authority)
  const authorityValidation = validateCheckpointEpochBootstrapAuthority(authority, {
    taskId: input.taskId || authority.task.taskId,
    project: input.project || authority.task.project,
    activeRootDigest: input.activeRootDigest || authority.task.activeRootDigest,
    stateSequence: input.stateSequence ?? authority.fence.expectedStateSequence,
    writerGeneration: input.writerGeneration ?? authority.fence.expectedWriterGeneration
  }, options)
  if (!authorityValidation.valid) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_AUTHORITY_INVALID', 'bootstrap authority validation failed', { errors: authorityValidation.errors })
  }
  if (authority.status !== 'prepared') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_NOT_PREPARED', 'only a prepared authority may create a preparing epoch')
  }
  if (input.existingSet) {
    const existing = sealTaskCheckpointEpochSet(input.existingSet)
    if (existing.migration.bootstrapAuthorityDigest === authority.authorityDigest) {
      return { status: 'unchanged', epochSet: existing, authority }
    }
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_ALREADY_EXISTS', 'an epoch set already exists with different bootstrap evidence')
  }
  const historicalEpochs = (Array.isArray(input.historicalEpochs) ? input.historicalEpochs : []).map(sealTaskCheckpointEpoch)
  if (historicalEpochs.some(item => item.status !== 'superseded')) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_HISTORY_INVALID', 'bootstrap historical epochs must already be superseded')
  }
  const expectedOrdinal = authority.target.expectedOrdinal
  const maxHistoricalOrdinal = Math.max(0, ...historicalEpochs.map(item => item.ordinal))
  if (expectedOrdinal <= maxHistoricalOrdinal || (authority.target.parentEpochId && !historicalEpochs.some(item => item.epochId === authority.target.parentEpochId))) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_PARENT_INVALID', 'target ordinal/parent does not follow retained history')
  }
  const targetBinding = input.targetBinding || {}
  const targetEpoch = sealTaskCheckpointEpoch({
    ordinal: expectedOrdinal,
    parentEpochId: authority.target.parentEpochId,
    stageKey: authority.target.stageKey,
    status: 'preparing',
    terminalStatus: null,
    task: {
      ...authority.task,
      admissionId: requireString(targetBinding.admissionId, 'admissionId', 256)
    },
    lineage: targetBinding.lineage,
    owner: {
      ...targetBinding.owner,
      ownerGeneration: authority.fence.expectedOwnerGeneration
    },
    context: targetBinding.context || {},
    phases: {
      CP1: phaseSlotFromBootstrapEvidence(authority.evidence),
      CP2: emptyCheckpointPhaseSlot('CP2'),
      CP3: emptyCheckpointPhaseSlot('CP3')
    },
    runtime: authority.runtime,
    createdAt: authority.createdAt,
    activatedAt: null,
    supersededAt: null,
    terminalAt: null,
    trigger: 'bootstrap-current-epoch'
  })
  const legacyProjectionDigest = input.legacyProjectionDigest
    ? requireDigest(input.legacyProjectionDigest, 'legacyProjectionDigest')
    : null
  const migrationId = digestValue({ authorityId: authority.authorityId, historicalEpochIds: historicalEpochs.map(item => item.epochId), targetEpochId: targetEpoch.epochId })
  const epochSet = sealTaskCheckpointEpochSet({
    taskId: authority.task.taskId,
    currentEpochId: null,
    nextOrdinal: expectedOrdinal + 1,
    stateSequence: authority.fence.expectedStateSequence,
    writerGeneration: authority.fence.expectedWriterGeneration,
    migration: {
      migrationId,
      from: 'legacy-flat-cp-v1',
      status: 'prepared',
      bootstrapAuthorityDigest: authority.authorityDigest,
      legacyProjectionDigest
    },
    projection: {
      desiredDigest: digestValue({ taskId: authority.task.taskId, targetEpochId: targetEpoch.epochId, status: 'preparing' }),
      observedDigest: legacyProjectionDigest,
      status: 'pending',
      sequence: 0
    },
    epochs: [...historicalEpochs, targetEpoch],
    archiveRefs: input.archiveRefs || []
  })
  return { status: 'prepared', epochSet, authority }
}

function activateTaskCheckpointEpochBootstrap(input = {}, options = {}) {
  const epochSet = sealTaskCheckpointEpochSet(input.epochSet)
  const authority = sealCheckpointEpochBootstrapAuthority(input.authority)
  const authorityValidation = validateCheckpointEpochBootstrapAuthority(authority, {
    taskId: epochSet.taskId
  }, { ...options, allowExpired: authority.status === 'consumed' })
  if (!authorityValidation.valid) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_AUTHORITY_INVALID', 'authority is not valid for activation', { errors: authorityValidation.errors })
  }
  const preparedAuthority = authority.status === 'prepared'
    ? authority
    : sealCheckpointEpochBootstrapAuthority({ ...authority, status: 'prepared', useCount: 0, consumedAt: null })
  if (epochSet.migration.bootstrapAuthorityDigest !== preparedAuthority.authorityDigest) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_MIGRATION_MISMATCH', 'epoch set is not bound to this bootstrap authority')
  }
  if (authority.status === 'consumed') {
    const current = epochSet.epochs.find(item => item.epochId === epochSet.currentEpochId)
    if (current && current.stageKey === authority.target.stageKey && epochSet.migration.status === 'verified') {
      return { status: 'unchanged', epochSet, authority }
    }
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_REPLAY_MISMATCH', 'consumed authority does not match the current verified epoch')
  }
  if (authority.status !== 'prepared') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_AUTHORITY_INVALID', 'authority is not valid for activation', { errors: authorityValidation.errors })
  }
  if (epochSet.stateSequence < authority.fence.expectedStateSequence ||
      epochSet.stateSequence > authority.fence.expectedStateSequence + 1 ||
      epochSet.writerGeneration !== authority.fence.expectedWriterGeneration) {
    throw new TaskCheckpointEpochV1Error(
      'CHECKPOINT_EPOCH_BOOTSTRAP_CAS_MISMATCH',
      'bootstrap activation is not the immediate fenced successor of its authority'
    )
  }
  if (epochSet.migration.status !== 'prepared' || epochSet.migration.bootstrapAuthorityDigest !== authority.authorityDigest) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_MIGRATION_MISMATCH', 'prepared migration is not bound to this authority')
  }
  if (input.observedEvidence) {
    const observed = input.observedEvidence.map(normalizeBootstrapEvidence)
      .sort((left, right) => (left.role === right.role ? left.artifactPath.localeCompare(right.artifactPath) : (left.role === 'primary' ? -1 : 1)))
    if (digestValue(observed) !== digestValue(authority.evidence)) {
      throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_EVIDENCE_DRIFT', 'artifact evidence changed after bootstrap prepare')
    }
  }
  const now = new Date(options.nowMs ?? Date.now()).toISOString()
  const target = epochSet.epochs.find(item => item.status === 'preparing' && item.ordinal === authority.target.expectedOrdinal)
  if (!target) throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_TARGET_MISSING', 'prepared target epoch is missing')
  const expectedCp1 = phaseSlotFromBootstrapEvidence(authority.evidence)
  if (target.phases.CP1.slotDigest !== expectedCp1.slotDigest) {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_BOOTSTRAP_TARGET_DRIFT', 'prepared target CP1 bindings no longer match the authority')
  }
  const epochs = epochSet.epochs.map(item => {
    if (item.epochId === target.epochId) return sealTaskCheckpointEpoch({ ...item, status: 'current', activatedAt: now })
    if (item.status === 'current') return sealTaskCheckpointEpoch({ ...item, status: 'superseded', supersededAt: now })
    return item
  })
  const consumedAuthority = sealCheckpointEpochBootstrapAuthority({
    ...authority,
    status: 'consumed',
    useCount: 1,
    consumedAt: now
  })
  const activatedSet = sealTaskCheckpointEpochSet({
    ...epochSet,
    currentEpochId: target.epochId,
    migration: {
      ...epochSet.migration,
      status: 'verified',
      bootstrapAuthorityDigest: authority.authorityDigest
    },
    projection: {
      ...epochSet.projection,
      desiredDigest: digestValue({ taskId: epochSet.taskId, currentEpochId: target.epochId, epochDigest: epochs.find(item => item.epochId === target.epochId).epochDigest }),
      status: 'pending'
    },
    epochs
  })
  return { status: 'activated', epochSet: activatedSet, authority: consumedAuthority }
}

function abandonPreparingCheckpointEpoch(input = {}, options = {}) {
  const epochSet = sealTaskCheckpointEpochSet(input.epochSet)
  const epochId = requireString(input.epochId, 'epochId', 64)
  const target = epochSet.epochs.find(item => item.epochId === epochId)
  if (!target || target.status !== 'preparing') {
    throw new TaskCheckpointEpochV1Error('CHECKPOINT_EPOCH_PREPARING_TARGET_INVALID', 'only a preparing epoch may be abandoned')
  }
  const abandonedAt = new Date(options.nowMs ?? Date.now()).toISOString()
  const epochs = epochSet.epochs.map(item => item.epochId === epochId
    ? sealTaskCheckpointEpoch({ ...item, status: 'abandoned', supersededAt: null, trigger: `${item.trigger}:abandoned@${abandonedAt}` })
    : item)
  return sealTaskCheckpointEpochSet({ ...epochSet, epochs })
}

module.exports = {
  CHECKPOINT_BOOTSTRAP_TTL_MS,
  CHECKPOINT_CP1_SUPPLEMENT_MAX,
  CHECKPOINT_EPOCH_ARCHIVE_REF_SCHEMA,
  CHECKPOINT_EPOCH_BOOTSTRAP_AUTHORITY_SCHEMA,
  CHECKPOINT_EPOCH_CAPABILITY,
  CHECKPOINT_EPOCH_HOT_MAX,
  CHECKPOINT_EPOCH_TOTAL_REF_MAX,
  CHECKPOINT_EPOCH_WRITE_PROTOCOL,
  CHECKPOINT_PHASE_BINDING_SCHEMA,
  CHECKPOINT_PHASE_HISTORY_MAX,
  CHECKPOINT_PHASE_SLOT_SCHEMA,
  TASK_CHECKPOINT_EPOCH_SCHEMA,
  TASK_CHECKPOINT_EPOCH_SET_SCHEMA,
  TaskCheckpointEpochV1Error,
  abandonPreparingCheckpointEpoch,
  activateTaskCheckpointEpochBootstrap,
  activateTaskCheckpointEpochSuccessor,
  bindTaskCheckpointEpochSetFence,
  checkpointEpochId,
  checkpointEpochProjectionDigest,
  checkpointEpochProjectionIdentity,
  closeCurrentTaskCheckpointEpoch,
  confirmCheckpointPhaseSlot,
  confirmTaskCheckpointPhase,
  compactTaskCheckpointEpochSet,
  digestValue,
  emptyCheckpointPhaseSlot,
  invalidateCheckpointPhaseSlot,
  normalizeStageKey,
  prepareTaskCheckpointEpochSuccessor,
  prepareTaskCheckpointEpochBootstrap,
  sealCheckpointEpochArchiveRef,
  sealCheckpointEpochBootstrapAuthority,
  sealCheckpointPhaseBinding,
  sealCheckpointPhaseSlot,
  sealTaskCheckpointEpoch,
  sealTaskCheckpointEpochSet,
  stableStringify,
  synchronizeTaskCheckpointEpochAuthority,
  validateCheckpointEpochBootstrapAuthority,
  validateCheckpointPhaseBinding,
  validateCheckpointPhaseSlot,
  validateTaskCheckpointEpoch,
  validateTaskCheckpointEpochSet
}
