'use strict'

const crypto = require('crypto')

const ACTUAL_INSTRUCTION_ENVELOPE_SCHEMA = 'ActualInstructionEnvelopeV1'
const WORK_ITEM_SET_SCHEMA = 'WorkItemSetV1'
const DIGEST_RE = /^[a-f0-9]{64}$/
const MAX_INSTRUCTION_BYTES = 256 * 1024
const MAX_SEGMENTS_PER_KIND = 64
const MAX_WORK_ITEMS = 32
const MAX_SEGMENT_SOURCE_BYTES = 128
const MAX_TURN_ID_BYTES = 256
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

const SEGMENT_DESCRIPTOR_FIELDS = Object.freeze([
  'segmentId',
  'kind',
  'sourceField',
  'ordinal',
  'bytes',
  'digest',
  'instructionAuthority',
  'bodyIncluded'
])
const ENVELOPE_FIELDS = Object.freeze([
  'schemaVersion',
  'envelopeId',
  'hostVariant',
  'hostSessionDigest',
  'sessionBindingKind',
  'turnId',
  'sourceEventId',
  'actualInstructionBytes',
  'actualInstructionDigest',
  'segmentSetDigest',
  'instructionAuthority',
  'authorityScope',
  'attachments',
  'quotedDocuments',
  'ambientState',
  'evidenceSegments',
  'projectObservations',
  'contextEpoch',
  'provenanceLevel',
  'mutationAuthority',
  'releaseAuthority',
  'issuedAt',
  'expiresAt',
  'envelopeDigest'
])
const WORK_ITEM_FIELDS = Object.freeze([
  'ordinal',
  'instructionDigest',
  'taskKind',
  'routeCandidate',
  'dependencyEdges',
  'admissionStatus',
  'workItemId',
  'workItemDigest'
])
const WORK_ITEM_SET_FIELDS = Object.freeze([
  'schemaVersion',
  'envelopeId',
  'envelopeDigest',
  'schedulingPolicy',
  'items',
  'setDigest'
])

const SEGMENT_FIELDS = Object.freeze({
  attachments: ['attachments', 'attachment', 'files', 'fileAttachments', 'file_attachments', 'images'],
  quotedDocuments: ['quotedDocuments', 'quoted_documents', 'documents', 'documentContext', 'document_context'],
  ambientState: ['ambientState', 'ambient_state', 'browserContext', 'browser_context', 'uiContext', 'ui_context'],
  evidenceSegments: ['evidenceSegments', 'evidence_segments', 'screenshots', 'toolOutput', 'tool_output']
})

const EMBEDDED_NON_INSTRUCTION_BLOCKS = Object.freeze([
  {
    kind: 'ambientState',
    sourceField: 'prompt:<in-app-browser-context>',
    pattern: /<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/gi
  },
  {
    kind: 'attachments',
    sourceField: 'prompt:<image>',
    pattern: /<image\b[^>]*>[\s\S]*?<\/image>/gi
  },
  {
    kind: 'quotedDocuments',
    sourceField: 'prompt:<attached-document>',
    pattern: /<attached-document\b[^>]*>[\s\S]*?<\/attached-document>/gi
  }
])

function stableStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function digest (value) {
  const content = typeof value === 'string' || Buffer.isBuffer(value)
    ? value
    : stableStringify(value)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function byteLength (value) {
  return Buffer.byteLength(typeof value === 'string' ? value : stableStringify(value), 'utf8')
}

function boundedString (value, maxBytes) {
  const text = String(value || '').trim()
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let output = ''
  let used = 0
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

function clone (value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function firstNonEmpty (values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function normalizeIso (value, fallbackMs) {
  const parsed = Date.parse(String(value || ''))
  return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString()
}

function segmentSource (value) {
  if (typeof value === 'string') return value
  try { return stableStringify(value) } catch { return String(value || '') }
}

function segmentDescriptor (kind, value, sourceField, index) {
  const source = segmentSource(value)
  const sourceDigest = digest(source)
  return {
    segmentId: `segment-${sourceDigest.slice(0, 32)}`,
    kind,
    sourceField: boundedString(sourceField, MAX_SEGMENT_SOURCE_BYTES),
    ordinal: index,
    bytes: byteLength(source),
    digest: sourceDigest,
    instructionAuthority: false,
    bodyIncluded: false
  }
}

function valuesForField (value) {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function collectStructuredSegments (payload, kind) {
  const output = []
  for (const field of SEGMENT_FIELDS[kind] || []) {
    if (!Object.prototype.hasOwnProperty.call(payload || {}, field)) continue
    const values = valuesForField(payload[field])
    if (output.length + values.length > MAX_SEGMENTS_PER_KIND) {
      const error = new Error(`NON_INSTRUCTION_SEGMENT_LIMIT_EXCEEDED: ${kind}`)
      error.code = 'NON_INSTRUCTION_SEGMENT_LIMIT_EXCEEDED'
      throw error
    }
    for (const value of values) {
      output.push(segmentDescriptor(kind, value, field, output.length))
    }
  }
  return output
}

/**
 * Removes only host-owned embedded evidence blocks with explicit tags. It does
 * not guess from prose, headings or quoted user language.
 * @param {string} rawInstruction
 * @returns {{instruction: string, segments: Record<string, object[]>}}
 */
function separateEmbeddedEvidence (rawInstruction) {
  let instruction = String(rawInstruction || '')
  const segments = {
    attachments: [],
    quotedDocuments: [],
    ambientState: [],
    evidenceSegments: []
  }
  for (const rule of EMBEDDED_NON_INSTRUCTION_BLOCKS) {
    instruction = instruction.replace(rule.pattern, match => {
      const bucket = segments[rule.kind]
      if (bucket.length >= MAX_SEGMENTS_PER_KIND) {
        const error = new Error(`NON_INSTRUCTION_SEGMENT_LIMIT_EXCEEDED: ${rule.kind}`)
        error.code = 'NON_INSTRUCTION_SEGMENT_LIMIT_EXCEEDED'
        throw error
      }
      bucket.push(segmentDescriptor(rule.kind, match, rule.sourceField, bucket.length))
      return '\n'
    })
  }
  return { instruction: instruction.trim(), segments }
}

function rawInstructionFromPayload (payload) {
  return String(
    payload?.prompt ?? payload?.user_prompt ?? payload?.userPrompt ??
    payload?.message ?? payload?.text ?? ''
  )
}

function directSourceEventId (payload) {
  return firstNonEmpty([
    payload?.sourceEventId,
    payload?.source_event_id,
    payload?.eventId,
    payload?.event_id,
    payload?.messageId,
    payload?.message_id,
    payload?.requestId,
    payload?.request_id
  ])
}

function sourceTimestamp (payload, fallbackMs) {
  return normalizeIso(firstNonEmpty([
    payload?.issuedAt,
    payload?.issued_at,
    payload?.timestamp,
    payload?.createdAt,
    payload?.created_at
  ]), fallbackMs)
}

function normalizedProjectObservations (observations) {
  const values = valuesForField(observations)
  if (values.length > MAX_SEGMENTS_PER_KIND) {
    const error = new Error('NON_INSTRUCTION_SEGMENT_LIMIT_EXCEEDED: projectObservation')
    error.code = 'NON_INSTRUCTION_SEGMENT_LIMIT_EXCEEDED'
    throw error
  }
  return values
    .map((value, index) => segmentDescriptor('projectObservation', value, 'options.projectObservations', index))
}

function combineBoundedSegments (kind, ...collections) {
  const combined = collections.flat()
  if (combined.length > MAX_SEGMENTS_PER_KIND) {
    const error = new Error(`NON_INSTRUCTION_SEGMENT_LIMIT_EXCEEDED: ${kind}`)
    error.code = 'NON_INSTRUCTION_SEGMENT_LIMIT_EXCEEDED'
    throw error
  }
  return combined.map((segment, index) => ({ ...segment, ordinal: index }))
}

function envelopeReplayIdentity (value) {
  return {
    hostVariant: value.hostVariant,
    hostSessionDigest: value.hostSessionDigest,
    turnId: value.turnId,
    sourceEventId: value.sourceEventId,
    actualInstructionDigest: value.actualInstructionDigest,
    segmentSetDigest: value.segmentSetDigest,
    contextEpoch: value.contextEpoch,
    provenanceLevel: value.provenanceLevel
  }
}

/**
 * Builds a bounded, digest-only ingress envelope. Attachment, quoted-document,
 * screenshot and ambient bodies never enter the authoritative instruction.
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>} options
 * @returns {Record<string, unknown>}
 */
function buildActualInstructionEnvelope (payload = {}, options = {}) {
  const separated = separateEmbeddedEvidence(
    options.actualInstruction == null ? rawInstructionFromPayload(payload) : options.actualInstruction
  )
  const actualInstruction = separated.instruction
  const actualInstructionBytes = Buffer.byteLength(actualInstruction, 'utf8')
  if (actualInstructionBytes > (options.maxInstructionBytes || MAX_INSTRUCTION_BYTES)) {
    const error = new Error(`actual instruction exceeds ${options.maxInstructionBytes || MAX_INSTRUCTION_BYTES} bytes`)
    error.code = 'ACTUAL_INSTRUCTION_TOO_LARGE'
    throw error
  }

  const actualInstructionDigest = digest(actualInstruction)
  const hostVariant = boundedString(options.hostVariant || payload.hostVariant || payload.host || 'portable', 128) || 'portable'
  const hostSessionId = firstNonEmpty([
    options.hostSessionId,
    payload.session_id,
    payload.sessionId,
    payload.conversation_id,
    payload.conversationId
  ])
  const hostSessionDigest = digest(hostSessionId || `turn-only:${hostVariant}`)
  const turnId = boundedString(firstNonEmpty([
    options.turnId,
    payload.turn_id,
    payload.turnId,
    payload.tool_use_id,
    payload.toolUseId,
    hostSessionId ? `${hostSessionId}:turn` : ''
  ]) || `turn-${actualInstructionDigest.slice(0, 32)}`, MAX_TURN_ID_BYTES)
  const observedSourceEventId = directSourceEventId(payload)
  const trustedHostEvent = options.trustedHostEvent === true && !!observedSourceEventId
  const sourceEventId = observedSourceEventId
    ? `event-${digest(observedSourceEventId).slice(0, 40)}`
    : `portable-${digest({ hostVariant, hostSessionDigest, turnId, actualInstructionDigest }).slice(0, 40)}`
  const provenanceLevel = trustedHostEvent ? 'trusted-host-event' : 'caller-attested-portable'
  const contextEpoch = boundedString(options.contextEpoch, 256)

  const attachments = combineBoundedSegments(
    'attachments',
    collectStructuredSegments(payload, 'attachments'),
    separated.segments.attachments
  )
  const quotedDocuments = combineBoundedSegments(
    'quotedDocuments',
    collectStructuredSegments(payload, 'quotedDocuments'),
    separated.segments.quotedDocuments
  )
  const ambientState = combineBoundedSegments(
    'ambientState',
    collectStructuredSegments(payload, 'ambientState'),
    separated.segments.ambientState
  )
  const evidenceSegments = combineBoundedSegments(
    'evidenceSegments',
    collectStructuredSegments(payload, 'evidenceSegments'),
    separated.segments.evidenceSegments
  )
  const projectObservations = normalizedProjectObservations(options.projectObservations)
  const segmentSetDigest = digest({
    attachments,
    quotedDocuments,
    ambientState,
    evidenceSegments,
    projectObservations
  })

  const replayIdentity = {
    hostVariant,
    hostSessionDigest,
    turnId,
    sourceEventId,
    actualInstructionDigest,
    segmentSetDigest,
    contextEpoch,
    provenanceLevel
  }
  const priorEnvelope = options.priorEnvelope
  if (priorEnvelope && validateActualInstructionEnvelope(priorEnvelope).valid &&
      digest(envelopeReplayIdentity(priorEnvelope)) === digest(replayIdentity)) {
    return clone(priorEnvelope)
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const issuedAt = sourceTimestamp(payload, nowMs)
  const issuedAtMs = Date.parse(issuedAt)
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS
  const core = {
    schemaVersion: ACTUAL_INSTRUCTION_ENVELOPE_SCHEMA,
    envelopeId: `aie-${digest(replayIdentity).slice(0, 40)}`,
    hostVariant,
    hostSessionDigest,
    sessionBindingKind: hostSessionId ? 'host-session' : 'turn-only',
    turnId,
    sourceEventId,
    actualInstructionBytes,
    actualInstructionDigest,
    segmentSetDigest,
    instructionAuthority: actualInstructionBytes > 0,
    authorityScope: trustedHostEvent ? 'trusted-host-workflow-ingress' : 'portable-plan-only',
    attachments,
    quotedDocuments,
    ambientState,
    evidenceSegments,
    projectObservations,
    contextEpoch,
    provenanceLevel,
    mutationAuthority: false,
    releaseAuthority: false,
    issuedAt,
    expiresAt: new Date(issuedAtMs + ttlMs).toISOString()
  }
  return { ...core, envelopeDigest: digest(core) }
}

function validateSegmentDescriptor (segment, kind, index) {
  return !!segment && typeof segment === 'object' && !Array.isArray(segment) &&
    Object.keys(segment).every(key => SEGMENT_DESCRIPTOR_FIELDS.includes(key)) &&
    SEGMENT_DESCRIPTOR_FIELDS.every(key => Object.prototype.hasOwnProperty.call(segment, key)) &&
    segment.kind === kind && typeof segment.segmentId === 'string' &&
    segment.segmentId === `segment-${String(segment.digest || '').slice(0, 32)}` &&
    typeof segment.sourceField === 'string' && !!segment.sourceField &&
    Buffer.byteLength(segment.sourceField, 'utf8') <= MAX_SEGMENT_SOURCE_BYTES &&
    Number.isInteger(segment.ordinal) && segment.ordinal === index &&
    Number.isSafeInteger(segment.bytes) && segment.bytes >= 0 && DIGEST_RE.test(String(segment.digest || '')) &&
    segment.instructionAuthority === false && segment.bodyIncluded === false
}

/**
 * Validates the envelope without trusting its authority flags or digest.
 * @param {Record<string, unknown>} envelope
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateActualInstructionEnvelope (envelope) {
  const errors = []
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { valid: false, errors: ['envelope-object-required'] }
  }
  if (!Object.keys(envelope).every(key => ENVELOPE_FIELDS.includes(key)) ||
      !ENVELOPE_FIELDS.every(key => Object.prototype.hasOwnProperty.call(envelope, key))) {
    errors.push('envelope-fields')
  }
  if (envelope.schemaVersion !== ACTUAL_INSTRUCTION_ENVELOPE_SCHEMA) errors.push('schema-version')
  const expectedEnvelopeId = `aie-${digest(envelopeReplayIdentity(envelope)).slice(0, 40)}`
  if (!/^aie-[a-f0-9]{40}$/.test(String(envelope.envelopeId || '')) || envelope.envelopeId !== expectedEnvelopeId) {
    errors.push('envelope-id')
  }
  if (!envelope.hostVariant || typeof envelope.hostVariant !== 'string' ||
      Buffer.byteLength(envelope.hostVariant, 'utf8') > 128) errors.push('host-variant')
  if (!DIGEST_RE.test(String(envelope.hostSessionDigest || ''))) errors.push('host-session-digest')
  if (!['host-session', 'turn-only'].includes(envelope.sessionBindingKind)) errors.push('session-binding-kind')
  if (!envelope.turnId || typeof envelope.turnId !== 'string' ||
      Buffer.byteLength(envelope.turnId, 'utf8') > MAX_TURN_ID_BYTES) errors.push('turn-id')
  if (!/^(?:event|portable)-[a-f0-9]{40}$/.test(String(envelope.sourceEventId || ''))) errors.push('source-event-id')
  if (!Number.isInteger(envelope.actualInstructionBytes) || envelope.actualInstructionBytes < 0 ||
      envelope.actualInstructionBytes > MAX_INSTRUCTION_BYTES) errors.push('instruction-bytes')
  if (!DIGEST_RE.test(String(envelope.actualInstructionDigest || ''))) errors.push('instruction-digest')
  if (envelope.actualInstructionBytes === 0 && envelope.actualInstructionDigest !== digest('')) {
    errors.push('empty-instruction-digest')
  }
  if (!DIGEST_RE.test(String(envelope.segmentSetDigest || '')) || envelope.segmentSetDigest !== digest({
    attachments: envelope.attachments,
    quotedDocuments: envelope.quotedDocuments,
    ambientState: envelope.ambientState,
    evidenceSegments: envelope.evidenceSegments,
    projectObservations: envelope.projectObservations
  })) errors.push('segment-set-digest')
  if (envelope.instructionAuthority !== (envelope.actualInstructionBytes > 0)) errors.push('instruction-authority')
  if (!['trusted-host-workflow-ingress', 'portable-plan-only'].includes(envelope.authorityScope)) errors.push('authority-scope')
  if (!['trusted-host-event', 'caller-attested-portable'].includes(envelope.provenanceLevel)) errors.push('provenance-level')
  if ((envelope.provenanceLevel === 'trusted-host-event') !== (envelope.authorityScope === 'trusted-host-workflow-ingress')) {
    errors.push('provenance-authority-mismatch')
  }
  for (const kind of ['attachments', 'quotedDocuments', 'ambientState', 'evidenceSegments']) {
    const segments = envelope[kind]
    if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS_PER_KIND ||
        segments.some((segment, index) => !validateSegmentDescriptor(segment, kind, index))) errors.push(`segments:${kind}`)
  }
  if (!Array.isArray(envelope.projectObservations) || envelope.projectObservations.length > MAX_SEGMENTS_PER_KIND ||
      envelope.projectObservations.some((segment, index) => !validateSegmentDescriptor(segment, 'projectObservation', index))) {
    errors.push('project-observations')
  }
  if (typeof envelope.contextEpoch !== 'string' || !envelope.contextEpoch ||
      Buffer.byteLength(envelope.contextEpoch, 'utf8') > 256) errors.push('context-epoch')
  if (envelope.mutationAuthority !== false) errors.push('mutation-authority')
  if (envelope.releaseAuthority !== false) errors.push('release-authority')
  const issuedAtMs = Date.parse(String(envelope.issuedAt || ''))
  const expiresAtMs = Date.parse(String(envelope.expiresAt || ''))
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) errors.push('lifetime')
  const { envelopeDigest, ...core } = envelope
  if (!DIGEST_RE.test(String(envelopeDigest || '')) || envelopeDigest !== digest(core)) errors.push('envelope-digest')
  return { valid: errors.length === 0, errors }
}

function normalizeWorkItem (item, index, envelope) {
  const taskKind = boundedString(item?.taskKind || item?.kind || 'unclassified', 64) || 'unclassified'
  const routeCandidate = item?.routeCandidate == null
    ? null
    : boundedString(item.routeCandidate, 128)
  const dependencyEdges = Array.isArray(item?.dependencyEdges)
    ? [...new Set(item.dependencyEdges.map(value => Number(value)).filter(value => Number.isInteger(value) && value >= 0 && value < index))]
    : (index > 0 ? [index - 1] : [])
  const core = {
    ordinal: index,
    instructionDigest: envelope.actualInstructionDigest,
    taskKind,
    routeCandidate,
    dependencyEdges,
    admissionStatus: 'pending'
  }
  return {
    ...core,
    workItemId: `work-${digest({ envelopeDigest: envelope.envelopeDigest, ...core }).slice(0, 40)}`,
    workItemDigest: digest(core)
  }
}

function validateWorkItemInput (item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'work-item-object-required'
  const allowed = ['taskKind', 'kind', 'routeCandidate', 'dependencyEdges']
  const unknown = Object.keys(item).filter(key => !allowed.includes(key))
  if (unknown.length) return `work-item-fields:${unknown.join('|')}`
  if (item.taskKind !== undefined && item.kind !== undefined &&
      String(item.taskKind).trim() !== String(item.kind).trim()) return 'work-item-task-kind-conflict'
  const taskKind = String(item.taskKind || item.kind || 'unclassified').trim()
  if (!taskKind || Buffer.byteLength(taskKind, 'utf8') > 64) return 'work-item-task-kind'
  if (item.routeCandidate != null) {
    const routeCandidate = String(item.routeCandidate).trim()
    if (!routeCandidate || Buffer.byteLength(routeCandidate, 'utf8') > 128) return 'work-item-route-candidate'
  }
  if (item.dependencyEdges !== undefined) {
    if (!Array.isArray(item.dependencyEdges) ||
        item.dependencyEdges.some(edge => !Number.isInteger(edge) || edge < 0 || edge >= index) ||
        new Set(item.dependencyEdges).size !== item.dependencyEdges.length) return 'work-item-dependency'
  }
  return null
}

/**
 * Builds an explicitly serial work-item set. Natural-language splitting is not
 * guessed here; multiple items require structured candidates from a caller.
 * @param {Record<string, unknown>} envelope
 * @param {{workItems?: object[]}} options
 * @returns {Record<string, unknown>}
 */
function buildWorkItemSet (envelope, options = {}) {
  const validation = validateActualInstructionEnvelope(envelope)
  if (!validation.valid || envelope.instructionAuthority !== true) {
    const error = new Error(`INSTRUCTION_AUTHORITY_UNAVAILABLE: ${validation.errors.join(',')}`)
    error.code = 'INSTRUCTION_AUTHORITY_UNAVAILABLE'
    throw error
  }
  if (options.workItems !== undefined && !Array.isArray(options.workItems)) {
    const error = new Error('WORK_ITEM_SET_INVALID: workItems must be an array')
    error.code = 'WORK_ITEM_SET_INVALID'
    throw error
  }
  if (Array.isArray(options.workItems) && !options.workItems.length) {
    const error = new Error('WORK_ITEM_SET_INVALID: at least one work item is required')
    error.code = 'WORK_ITEM_SET_INVALID'
    throw error
  }
  if (Array.isArray(options.workItems) && options.workItems.length > MAX_WORK_ITEMS) {
    const error = new Error(`WORK_ITEM_LIMIT_EXCEEDED: ${options.workItems.length}/${MAX_WORK_ITEMS}`)
    error.code = 'WORK_ITEM_LIMIT_EXCEEDED'
    throw error
  }
  const supplied = Array.isArray(options.workItems) ? options.workItems : [{}]
  for (const [index, item] of supplied.entries()) {
    const errorCode = validateWorkItemInput(item, index)
    if (errorCode) {
      const error = new Error(`WORK_ITEM_SET_INVALID: ${errorCode}:${index}`)
      error.code = 'WORK_ITEM_SET_INVALID'
      throw error
    }
  }
  const items = supplied.map((item, index) => normalizeWorkItem(item, index, envelope))
  const core = {
    schemaVersion: WORK_ITEM_SET_SCHEMA,
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.envelopeDigest,
    schedulingPolicy: 'serial',
    items
  }
  return { ...core, setDigest: digest(core) }
}

function validateWorkItemSet (set, envelope = null) {
  const errors = []
  if (!set || typeof set !== 'object' || Array.isArray(set)) return { valid: false, errors: ['work-item-set-required'] }
  if (!Object.keys(set).every(key => WORK_ITEM_SET_FIELDS.includes(key)) ||
      !WORK_ITEM_SET_FIELDS.every(key => Object.prototype.hasOwnProperty.call(set, key))) errors.push('work-item-set-fields')
  if (set.schemaVersion !== WORK_ITEM_SET_SCHEMA) errors.push('schema-version')
  if (!/^aie-[a-f0-9]{40}$/.test(String(set.envelopeId || '')) || !DIGEST_RE.test(String(set.envelopeDigest || ''))) {
    errors.push('envelope-binding')
  }
  if (set.schedulingPolicy !== 'serial') errors.push('scheduling-policy')
  if (!Array.isArray(set.items) || !set.items.length || set.items.length > MAX_WORK_ITEMS) errors.push('items')
  for (const [index, item] of (set.items || []).entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !Object.keys(item).every(key => WORK_ITEM_FIELDS.includes(key)) ||
        !WORK_ITEM_FIELDS.every(key => Object.prototype.hasOwnProperty.call(item, key)) ||
        item.ordinal !== index || !/^work-[a-f0-9]{40}$/.test(String(item.workItemId || '')) ||
        !DIGEST_RE.test(String(item.workItemDigest || '')) || !DIGEST_RE.test(String(item.instructionDigest || '')) ||
        typeof item.taskKind !== 'string' || !item.taskKind || Buffer.byteLength(item.taskKind, 'utf8') > 64 ||
        (item.routeCandidate !== null && (typeof item.routeCandidate !== 'string' || !item.routeCandidate ||
          Buffer.byteLength(item.routeCandidate, 'utf8') > 128)) ||
        item.admissionStatus !== 'pending' || !Array.isArray(item.dependencyEdges) ||
        new Set(item.dependencyEdges).size !== item.dependencyEdges.length ||
        item.dependencyEdges.some(edge => !Number.isInteger(edge) || edge < 0 || edge >= index)) {
      errors.push(`item:${index}`)
      continue
    }
    const { workItemId, workItemDigest, ...core } = item
    if (workItemDigest !== digest(core) || workItemId !== `work-${digest({ envelopeDigest: set.envelopeDigest, ...core }).slice(0, 40)}`) {
      errors.push(`item-digest:${index}`)
    }
  }
  if ((set.items || []).some(item => item?.instructionDigest !== set.items?.[0]?.instructionDigest)) {
    errors.push('instruction-digest-mismatch')
  }
  if (envelope && (set.envelopeId !== envelope.envelopeId || set.envelopeDigest !== envelope.envelopeDigest ||
      set.items?.some(item => item.instructionDigest !== envelope.actualInstructionDigest))) errors.push('envelope-mismatch')
  const { setDigest, ...core } = set
  if (!DIGEST_RE.test(String(setDigest || '')) || setDigest !== digest(core)) errors.push('set-digest')
  return { valid: errors.length === 0, errors }
}

module.exports = {
  ACTUAL_INSTRUCTION_ENVELOPE_SCHEMA,
  DEFAULT_TTL_MS,
  MAX_INSTRUCTION_BYTES,
  MAX_WORK_ITEMS,
  WORK_ITEM_SET_SCHEMA,
  buildActualInstructionEnvelope,
  buildWorkItemSet,
  digest,
  separateEmbeddedEvidence,
  validateActualInstructionEnvelope,
  validateWorkItemSet
}
