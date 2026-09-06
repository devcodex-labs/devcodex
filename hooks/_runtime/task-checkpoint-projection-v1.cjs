'use strict'

const {
  checkpointEpochProjectionDigest,
  digestValue,
  sealTaskCheckpointEpochSet,
  stableStringify,
  validateTaskCheckpointEpochSet
} = require('./task-checkpoint-epoch-v1.cjs')

const CHECKPOINT_EPOCH_OPERATION_SCHEMA = 'CheckpointEpochOperationV1'
const CHECKPOINT_EPOCH_RECEIPT_SCHEMA = 'CheckpointEpochReceiptV1'
const MEMORY_CP_PROJECTION_RECEIPT_SCHEMA = 'MemoryCpProjectionReceiptV2'
const CURRENT_EPOCH_MARKER_RE = /<!--\s*devcodex:current-epoch\s+(E[0-9]{4,}-[a-f0-9]{12})\s+projectionDigest=([a-f0-9]{64})\s*-->/iu
const OPERATION_STATUSES = Object.freeze([
  'prepared',
  'machine-committed',
  'projection-committed',
  'complete',
  'abandoned'
])
const PHASES = Object.freeze(['CP1', 'CP2', 'CP3'])

class TaskCheckpointProjectionV1Error extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'TaskCheckpointProjectionV1Error'
    this.code = code
    this.details = details
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function requireString(value, field, maximum = 512) {
  const normalized = String(value || '').trim()
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_FIELD_INVALID', `${field} is required and bounded`, { field })
  }
  return normalized
}

function requireDigest(value, field, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null
  const normalized = String(value || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_DIGEST_INVALID', `${field} must be a SHA-256 digest`, { field })
  }
  return normalized
}

function iso(value, field) {
  const parsed = Date.parse(String(value || ''))
  if (!Number.isFinite(parsed)) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_TIME_INVALID', `${field} must be ISO-8601`, { field })
  }
  return new Date(parsed).toISOString()
}

function checkpointOperationSemantic(input = {}) {
  const phase = String(input.phase || '').toUpperCase()
  if (!PHASES.includes(phase)) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_PHASE_INVALID', 'phase must be CP1, CP2 or CP3')
  }
  const status = String(input.status || 'prepared')
  if (!OPERATION_STATUSES.includes(status)) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_OPERATION_STATUS_INVALID', 'operation status is invalid')
  }
  const semantic = {
    schemaVersion: CHECKPOINT_EPOCH_OPERATION_SCHEMA,
    requestDigest: requireDigest(input.requestDigest, 'requestDigest'),
    taskId: requireString(input.taskId, 'taskId', 128).toLowerCase(),
    phase,
    stageKey: input.stageKey ? requireString(input.stageKey, 'stageKey', 64) : null,
    epochId: input.epochId ? requireString(input.epochId, 'epochId', 64) : null,
    bindingDigest: requireDigest(input.bindingDigest, 'bindingDigest'),
    expectedStateSequence: Number(input.expectedStateSequence),
    expectedWriterGeneration: Number(input.expectedWriterGeneration),
    expectedOwnerLeaseDigest: requireDigest(input.expectedOwnerLeaseDigest, 'expectedOwnerLeaseDigest'),
    desiredProjectionDigest: requireDigest(input.desiredProjectionDigest, 'desiredProjectionDigest', true),
    observedProjectionDigest: requireDigest(input.observedProjectionDigest, 'observedProjectionDigest', true),
    status,
    preparedAt: iso(input.preparedAt, 'preparedAt'),
    machineCommittedAt: input.machineCommittedAt ? iso(input.machineCommittedAt, 'machineCommittedAt') : null,
    projectionCommittedAt: input.projectionCommittedAt ? iso(input.projectionCommittedAt, 'projectionCommittedAt') : null,
    completedAt: input.completedAt ? iso(input.completedAt, 'completedAt') : null,
    abandonedAt: input.abandonedAt ? iso(input.abandonedAt, 'abandonedAt') : null,
    mutationAuthority: false
  }
  if (![semantic.expectedStateSequence, semantic.expectedWriterGeneration]
    .every(item => Number.isSafeInteger(item) && item >= 0)) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_FENCE_INVALID', 'operation fence must use non-negative safe integers')
  }
  const rank = OPERATION_STATUSES.indexOf(status)
  if (rank >= OPERATION_STATUSES.indexOf('machine-committed') && status !== 'abandoned' && !semantic.machineCommittedAt) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_OPERATION_TIME_INVALID', 'machine commit time is required')
  }
  if (rank >= OPERATION_STATUSES.indexOf('projection-committed') && status !== 'abandoned' &&
      (!semantic.projectionCommittedAt || !semantic.observedProjectionDigest)) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_OPERATION_TIME_INVALID', 'projection commit evidence is required')
  }
  if (status === 'complete' && !semantic.completedAt) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_OPERATION_TIME_INVALID', 'completion time is required')
  }
  if (status === 'abandoned' && !semantic.abandonedAt) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_OPERATION_TIME_INVALID', 'abandon time is required')
  }
  return semantic
}

function sealCheckpointEpochOperation(input = {}) {
  const semantic = checkpointOperationSemantic(input)
  const requestBoundId = digestValue({
    taskId: semantic.taskId,
    phase: semantic.phase,
    stageKey: semantic.stageKey,
    bindingDigest: semantic.bindingDigest,
    requestDigest: semantic.requestDigest
  })
  return Object.freeze({
    ...semantic,
    operationId: `checkpoint-${requestBoundId.slice(0, 40)}`,
    operationDigest: digestValue(semantic)
  })
}

function validateCheckpointEpochOperation(value) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== CHECKPOINT_EPOCH_OPERATION_SCHEMA) {
    return { valid: false, errors: ['operation-schema'] }
  }
  try {
    const sealed = sealCheckpointEpochOperation(value)
    const comparable = clone(value)
    delete comparable.operationId
    delete comparable.operationDigest
    const sealedComparable = clone(sealed)
    delete sealedComparable.operationId
    delete sealedComparable.operationDigest
    if (stableStringify(comparable) !== stableStringify(sealedComparable)) errors.push('operation-noncanonical')
    if (value.operationId !== sealed.operationId) errors.push('operation-id')
    if (value.operationDigest !== sealed.operationDigest) errors.push('operation-digest')
  } catch (error) {
    errors.push(error.code || 'operation-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function createCheckpointEpochOperation(input = {}, options = {}) {
  const preparedAt = input.preparedAt || new Date(options.nowMs ?? Date.now()).toISOString()
  const requestDigest = input.requestDigest || digestValue({
    schemaVersion: 'CheckpointEpochOperationRequestV1',
    taskId: String(input.taskId || '').toLowerCase(),
    phase: String(input.phase || '').toUpperCase(),
    stageKey: input.stageKey || null,
    bindingDigest: input.bindingDigest,
    confirmationMode: input.confirmationMode || 'explicit'
  })
  return sealCheckpointEpochOperation({
    ...input,
    requestDigest,
    status: 'prepared',
    desiredProjectionDigest: null,
    observedProjectionDigest: null,
    preparedAt,
    machineCommittedAt: null,
    projectionCommittedAt: null,
    completedAt: null,
    abandonedAt: null
  })
}

function advanceCheckpointEpochOperation(value, nextStatus, input = {}, options = {}) {
  const operation = sealCheckpointEpochOperation(value)
  const status = String(nextStatus || '')
  const allowed = {
    prepared: new Set(['machine-committed', 'abandoned']),
    'machine-committed': new Set(['projection-committed']),
    'projection-committed': new Set(['complete']),
    complete: new Set(['complete']),
    abandoned: new Set(['abandoned'])
  }
  if (status === operation.status) return operation
  if (!allowed[operation.status]?.has(status)) {
    throw new TaskCheckpointProjectionV1Error(
      'CHECKPOINT_PROJECTION_OPERATION_TRANSITION_INVALID',
      `cannot transition checkpoint operation from ${operation.status} to ${status}`
    )
  }
  const at = new Date(options.nowMs ?? Date.now()).toISOString()
  return sealCheckpointEpochOperation({
    ...operation,
    status,
    epochId: input.epochId || operation.epochId,
    desiredProjectionDigest: input.desiredProjectionDigest || operation.desiredProjectionDigest,
    observedProjectionDigest: input.observedProjectionDigest || operation.observedProjectionDigest,
    machineCommittedAt: status === 'machine-committed' ? at : operation.machineCommittedAt,
    projectionCommittedAt: status === 'projection-committed' ? at : operation.projectionCommittedAt,
    completedAt: status === 'complete' ? at : operation.completedAt,
    abandonedAt: status === 'abandoned' ? at : operation.abandonedAt
  })
}

function escapeCell(value, fallback = '—') {
  const normalized = String(value || '').replace(/[|\r\n]+/gu, ' ').trim()
  return normalized || fallback
}

function escapeMarkdownLabel(value) {
  return escapeCell(value).replace(/([\\\[\]])/gu, '\\$1')
}

function artifactLink(binding) {
  if (!binding) return '—'
  const relative = String(binding.artifactPath || '').replace(/\\/gu, '/')
  const href = `../${relative}`
  return `[${escapeMarkdownLabel(relative)}](${/[ ()]/u.test(href) ? `<${href}>` : href})`
}

function projectionSourceMessages(existing, additions = {}) {
  const messages = new Map(Object.entries(additions || {}).map(([digest, message]) => [String(digest).toLowerCase(), String(message || '')]))
  const rowRe = /^\|\s*CP[123]\s*\|\s*[^|]+\|\s*[^|]*\|\s*[^|]*\|\s*`?([a-f0-9]{64})`?\s*\|\s*([^|]*)\|/gimu
  let match
  while ((match = rowRe.exec(String(existing || ''))) !== null) {
    const digest = match[1].toLowerCase()
    if (!messages.has(digest)) messages.set(digest, match[2].trim())
  }
  return messages
}

function phaseRow(phase, epoch, sourceMessages) {
  const slot = epoch?.phases?.[phase]
  const binding = slot?.currentBinding || null
  const status = slot?.state === 'confirmed'
    ? '✅'
    : (slot?.state === 'invalidated' ? '⚠️ stale' : (phase === 'CP1' ? '⏳' : '⏹️'))
  const sourceMessage = binding
    ? (sourceMessages.get(binding.artifactSha256) || `confirmation:${binding.confirmationSourceDigest.slice(0, 12)}`)
    : null
  return `| ${phase} | ${status} | ${artifactLink(binding)} | ${escapeCell(binding?.artifactVersion)} | ${binding ? `\`${binding.artifactSha256.toUpperCase()}\`` : '—'} | ${escapeCell(sourceMessage)} | ${escapeCell(binding?.confirmedAt)} |`
}

function renderCurrentTable(epoch, desiredDigest, sourceMessages) {
  return [
    '### CP 确认记录',
    `<!-- devcodex:current-epoch ${epoch.epochId} projectionDigest=${desiredDigest} -->`,
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|',
    ...PHASES.map(phase => phaseRow(phase, epoch, sourceMessages)),
    ''
  ].join('\n')
}

function auditPhaseSummary(epoch, phase) {
  const slot = epoch?.phases?.[phase]
  if (!slot || slot.state !== 'confirmed' || !slot.currentBinding) return slot?.state || 'unstarted'
  return `confirmed:${slot.currentBinding.artifactSha256.slice(0, 12)}`
}

function renderAuditTable(epochSet) {
  const historical = epochSet.epochs.filter(item => item.status === 'superseded')
  const refs = epochSet.archiveRefs || []
  const lines = [
    '### CP 历史代际（只读审计）',
    '',
    '| epoch | stage | status | CP1 | CP2 | CP3 | authorization |',
    '|-------|-------|--------|-----|-----|-----|---------------|'
  ]
  for (const epoch of historical) {
    lines.push(`| ${epoch.epochId} | ${escapeCell(epoch.stageKey)} | ${epoch.status}${epoch.terminalStatus ? `/${epoch.terminalStatus}` : ''} | ${auditPhaseSummary(epoch, 'CP1')} | ${auditPhaseSummary(epoch, 'CP2')} | ${auditPhaseSummary(epoch, 'CP3')} | historical-only |`)
  }
  for (const ref of refs) {
    lines.push(`| ${ref.epochId} | ${escapeCell(ref.stageKey)} | ${ref.status}${ref.terminalStatus ? `/${ref.terminalStatus}` : ''} | archived | archived | archived | historical-only |`)
  }
  if (!historical.length && !refs.length) lines.push('| — | — | none | — | — | — | historical-only |')
  lines.push('')
  return lines.join('\n')
}

function headingIndex(lines, matcher) {
  return lines.findIndex(line => matcher.test(String(line || '').trim()))
}

function sectionRange(lines, matcher) {
  const start = headingIndex(lines, matcher)
  if (start < 0) return { found: false, start: lines.length, end: lines.length }
  let end = start + 1
  while (end < lines.length && !/^#{1,6}\s+/u.test(lines[end])) end += 1
  return { found: true, start, end }
}

function replaceSection(text, matcher, rendered) {
  const lines = String(text || '').replace(/\r\n/gu, '\n').split('\n')
  const range = sectionRange(lines, matcher)
  if (range.found) {
    return [...lines.slice(0, range.start), ...rendered.split('\n'), ...lines.slice(range.end)].join('\n')
  }
  return `${String(text || '').trimEnd()}${text ? '\n\n' : ''}${rendered}`
}

function ensureMemorySections(text) {
  let output = text
  const required = [
    ['## 本轮摘要', '- 当前 checkpoint 状态由机器权威投影。'],
    ['## 已确认事项', '- 以 current epoch 的 digest-bound CP 记录为准。'],
    ['## 待确认事项', '- 无则保持本项。'],
    ['## 备注', '- 历史代际仅供审计，不能授权当前写入。']
  ]
  for (const [heading, placeholder] of required) {
    const pattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mu')
    if (!pattern.test(output)) output = `${output.trimEnd()}\n\n${heading}\n\n${placeholder}`
  }
  return output
}

function renderTaskCheckpointProjection(existing, value, options = {}) {
  const validation = validateTaskCheckpointEpochSet(value)
  if (!validation.valid) {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_EPOCH_SET_INVALID', 'cannot render an invalid epoch set', { errors: validation.errors })
  }
  const epochSet = sealTaskCheckpointEpochSet(value)
  const current = epochSet.epochs.find(item => item.epochId === epochSet.currentEpochId)
  if (!current || current.status !== 'current') {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_CURRENT_EPOCH_REQUIRED', 'projection requires one current epoch')
  }
  const desiredDigest = checkpointEpochProjectionDigest(epochSet)
  const sourceMessages = projectionSourceMessages(existing, options.sourceMessagesByArtifactDigest)
  let output = replaceSection(existing, /^#{1,6}\s+.*CP\s*确认记录\s*$/iu, renderCurrentTable(current, desiredDigest, sourceMessages))
  output = replaceSection(output, /^#{1,6}\s+CP\s*历史代际（只读审计）\s*$/iu, renderAuditTable(epochSet))
  if (!/^#\s+/mu.test(output)) output = `# ${escapeCell(options.requirement || '任务')} 任务会话记录\n\n${output}`
  output = ensureMemorySections(output)
  const newline = String(existing || '').includes('\r\n') ? '\r\n' : '\n'
  return {
    content: `${output.replace(/\r\n/gu, '\n').trimEnd()}\n`.replace(/\n/gu, newline),
    currentEpochId: current.epochId,
    desiredDigest,
    marker: `devcodex:current-epoch ${current.epochId} projectionDigest=${desiredDigest}`
  }
}

function parseCurrentEpochMarker(text) {
  const match = CURRENT_EPOCH_MARKER_RE.exec(String(text || ''))
  return match
    ? { found: true, epochId: match[1], projectionDigest: match[2].toLowerCase() }
    : { found: false, epochId: null, projectionDigest: null }
}

function finalizeTaskCheckpointProjection(value, observedDigest) {
  const epochSet = sealTaskCheckpointEpochSet(value)
  const desiredDigest = checkpointEpochProjectionDigest(epochSet)
  return sealTaskCheckpointEpochSet({
    ...epochSet,
    projection: {
      ...epochSet.projection,
      desiredDigest,
      observedDigest: requireDigest(observedDigest, 'observedDigest'),
      status: 'current'
    }
  })
}

function createCheckpointEpochReceipt(input = {}) {
  const operation = sealCheckpointEpochOperation(input.operation)
  if (operation.status !== 'complete') {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_OPERATION_INCOMPLETE', 'receipt requires one complete operation')
  }
  const epochSet = sealTaskCheckpointEpochSet(input.epochSet)
  const epoch = epochSet.epochs.find(item => item.epochId === operation.epochId)
  if (!epoch || operation.desiredProjectionDigest !== epochSet.projection.desiredDigest ||
      operation.observedProjectionDigest !== epochSet.projection.observedDigest || epochSet.projection.status !== 'current') {
    throw new TaskCheckpointProjectionV1Error('CHECKPOINT_PROJECTION_RECEIPT_BINDING_INVALID', 'operation and epoch projection are not the same finalized state')
  }
  const semantic = {
    schemaVersion: CHECKPOINT_EPOCH_RECEIPT_SCHEMA,
    operationId: operation.operationId,
    requestDigest: operation.requestDigest,
    taskId: operation.taskId,
    epochId: epoch.epochId,
    phase: operation.phase,
    bindingDigest: operation.bindingDigest,
    // Bind the receipt to the checkpoint/projection semantics rather than the
    // enclosing TaskRecovery CAS sequence. Owner renewals and unrelated state
    // commits must not change the idempotent receipt for the same operation.
    setDigest: checkpointEpochProjectionDigest(epochSet),
    projection: {
      schemaVersion: MEMORY_CP_PROJECTION_RECEIPT_SCHEMA,
      desiredDigest: epochSet.projection.desiredDigest,
      observedDigest: epochSet.projection.observedDigest,
      projectionSequence: epochSet.projection.sequence,
      status: epochSet.projection.status,
      readbackVerified: true
    },
    completedAt: operation.completedAt,
    mutationAuthority: false
  }
  return Object.freeze({ ...semantic, receiptDigest: digestValue(semantic) })
}

module.exports = {
  CHECKPOINT_EPOCH_OPERATION_SCHEMA,
  CHECKPOINT_EPOCH_RECEIPT_SCHEMA,
  CURRENT_EPOCH_MARKER_RE,
  MEMORY_CP_PROJECTION_RECEIPT_SCHEMA,
  TaskCheckpointProjectionV1Error,
  advanceCheckpointEpochOperation,
  createCheckpointEpochOperation,
  createCheckpointEpochReceipt,
  finalizeTaskCheckpointProjection,
  parseCurrentEpochMarker,
  renderTaskCheckpointProjection,
  sealCheckpointEpochOperation,
  validateCheckpointEpochOperation
}
