'use strict'

const crypto = require('crypto')
const path = require('path')
const {
  createTaskRecoveryKey,
  readTaskRecoveryState
} = require('./task-recovery-store-v5.cjs')
const {
  compactDeliveryReceipts,
  digestValue
} = require('./lifecycle-state-projection-v5.cjs')

const CONTEXT_DELIVERY_DESCRIPTOR_SCHEMA = 'ContextDeliveryDescriptorV2'
const CONTEXT_DELIVERY_RECEIPT_SCHEMA = 'ContextDeliveryReceiptV2'
const CONTEXT_DELIVERY_DECISION_SCHEMA = 'ContextDeliveryDecisionV2'

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function bounded(value, maxBytes) {
  const text = String(value || '').trim()
  return text && Buffer.byteLength(text, 'utf8') <= maxBytes ? text : ''
}

function canonicalRootForDigest(value) {
  let resolved = path.resolve(String(value || '')).replace(/\\/g, '/')
  if (process.platform === 'win32') resolved = resolved.toLowerCase()
  return resolved.replace(/\/$/, '')
}

function descriptorDigest(value) {
  return digestValue({
    schemaVersion: value.schemaVersion,
    taskId: value.taskId,
    project: value.project,
    activeRootDigest: value.activeRootDigest,
    conversationDigest: value.conversationDigest,
    contextEpoch: value.contextEpoch,
    sourceKey: value.sourceKey,
    sourceDigest: value.sourceDigest,
    bodyCarrier: value.bodyCarrier,
    bodyDigest: value.bodyDigest,
    deliveryLeaseId: value.deliveryLeaseId,
    bodyBytes: value.bodyBytes
  })
}

function validateDescriptor(value) {
  if (!value || value.schemaVersion !== CONTEXT_DELIVERY_DESCRIPTOR_SCHEMA) return false
  if (![value.taskId, value.project, value.activeRootDigest, value.conversationDigest,
    value.contextEpoch, value.sourceKey, value.sourceDigest, value.bodyCarrier,
    value.bodyDigest, value.deliveryLeaseId,
    value.descriptorDigest].every(item => typeof item === 'string' && item.trim())) return false
  if (!['profile-load-text-v1', 'skill-route-body-chunks-v1'].includes(value.bodyCarrier)) return false
  if (!/^[a-f0-9]{64}$/i.test(value.bodyDigest)) return false
  if (!Number.isInteger(value.bodyBytes) || value.bodyBytes < 0) return false
  return value.descriptorDigest === descriptorDigest(value)
}

function fullDecision(reasonCode, details = {}) {
  return {
    schemaVersion: CONTEXT_DELIVERY_DECISION_SCHEMA,
    bodyDeliverySkipped: false,
    status: 'full-delivery',
    reasonCode,
    descriptor: null,
    ...details
  }
}

function tokenEquivalentEstimate(bytes) {
  const boundedBytes = Math.max(0, Math.trunc(Number(bytes) || 0))
  return {
    status: 'UNVERIFIED',
    method: 'utf8-bytes-divided-by-5-to-3',
    minTokens: Math.ceil(boundedBytes / 5),
    maxTokens: Math.ceil(boundedBytes / 3),
    actualHostTokens: null
  }
}

function getContextDeliveryDecision(input = {}, options = {}) {
  const activeRoot = bounded(input.activeRoot, 2048)
  const project = bounded(input.project, 256)
  const conversationId = bounded(input.conversationId, 1024)
  const contextEpoch = bounded(input.contextEpoch, 256)
  const sourceKey = bounded(input.sourceKey, 1024)
  const sourceDigest = /^[a-f0-9]{64}$/i.test(String(input.sourceDigest || ''))
    ? String(input.sourceDigest).toLowerCase()
    : (input.sourceIdentity === undefined ? '' : digestValue(input.sourceIdentity))
  const bodyCarrier = bounded(input.bodyCarrier, 128)
  const bodyDigest = /^[a-f0-9]{64}$/i.test(String(input.bodyDigest || ''))
    ? String(input.bodyDigest).toLowerCase()
    : (input.bodyIdentity === undefined ? '' : digestValue(input.bodyIdentity))
  const metaDir = bounded(input.metaDir, 4096)
  if (!activeRoot || !project || !conversationId || !contextEpoch || !sourceKey || !sourceDigest ||
      !['profile-load-text-v1', 'skill-route-body-chunks-v1'].includes(bodyCarrier) || !bodyDigest || !metaDir) {
    return fullDecision('delivery-identity-incomplete')
  }
  const recovered = readTaskRecoveryState({
    metaDir: path.resolve(metaDir),
    sessionKey: conversationId,
    expectedIdentity: { activeRoot, project }
  }, options)
  if (recovered.status !== 'fresh' || !recovered.identity?.taskId || !recovered.identity?.recoveryKey) {
    return fullDecision(
      recovered.status === 'identity-mismatch' ? 'delivery-task-identity-mismatch' : 'delivery-formal-task-unbound',
      { recoveryStatus: recovered.status }
    )
  }
  const conversationDigest = sha256(conversationId)
  const activeRootDigest = sha256(canonicalRootForDigest(activeRoot))
  const deliveryLeaseId = digestValue({
    taskId: recovered.identity.taskId,
    recoveryKey: recovered.identity.recoveryKey,
    project,
    activeRootDigest,
    conversationDigest,
    contextEpoch,
    sourceKey,
    sourceDigest,
    bodyCarrier,
    bodyDigest,
    bodyBytes: Math.max(0, Math.trunc(Number(input.bodyBytes) || 0))
  })
  const descriptor = {
    schemaVersion: CONTEXT_DELIVERY_DESCRIPTOR_SCHEMA,
    taskId: recovered.identity.taskId,
    project,
    activeRootDigest,
    conversationDigest,
    contextEpoch,
    sourceKey,
    sourceDigest,
    bodyCarrier,
    bodyDigest,
    deliveryLeaseId,
    bodyBytes: Math.max(0, Math.trunc(Number(input.bodyBytes) || 0)),
    issuedAt: new Date(options.nowMs || Date.now()).toISOString()
  }
  descriptor.descriptorDigest = descriptorDigest(descriptor)
  const receipts = Array.isArray(recovered.state?.contextDeliveryReceipts)
    ? recovered.state.contextDeliveryReceipts
    : []
  const observed = receipts.find(receipt =>
    receipt?.schemaVersion === CONTEXT_DELIVERY_RECEIPT_SCHEMA &&
    receipt.deliveryLeaseId === deliveryLeaseId &&
    receipt.taskId === descriptor.taskId &&
    receipt.project === project &&
    receipt.activeRootDigest === activeRootDigest &&
    receipt.conversationDigest === conversationDigest &&
    receipt.contextEpoch === contextEpoch &&
    receipt.sourceKey === sourceKey &&
    receipt.sourceDigest === sourceDigest &&
    receipt.bodyCarrier === bodyCarrier &&
    receipt.bodyDigest === bodyDigest &&
    receipt.bodyBytes === descriptor.bodyBytes &&
    Number.isFinite(Date.parse(String(receipt.observedAt || '')))
  )
  const bodyBytes = descriptor.bodyBytes
  return {
    schemaVersion: CONTEXT_DELIVERY_DECISION_SCHEMA,
    bodyDeliverySkipped: !!observed,
    status: observed ? 'reuse-observed-body' : 'full-delivery',
    reasonCode: observed ? 'delivery-receipt-observed' : 'delivery-receipt-missing',
    descriptor,
    recoveryStatus: recovered.status,
    observedAt: observed?.observedAt || null,
    deliveredBodyBytes: observed ? 0 : bodyBytes,
    deduplicatedBodyBytes: observed ? bodyBytes : 0,
    tokenEquivalentEstimate: tokenEquivalentEstimate(observed ? bodyBytes : 0)
  }
}

function findDescriptor(value, depth = 0, seen = new WeakSet()) {
  if (depth > 10 || value === null || value === undefined) return null
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text.startsWith('{') || Buffer.byteLength(text, 'utf8') > 1024 * 1024) return null
    try { return findDescriptor(JSON.parse(text), depth + 1, seen) } catch { return null }
  }
  if (typeof value !== 'object') return null
  if (seen.has(value)) return null
  seen.add(value)
  const candidates = [
    value.devcodexContextDelivery,
    value._meta?.devcodexContextDelivery,
    value.delivery?.contextDelivery
  ]
  for (const candidate of candidates) {
    if (validateDescriptor(candidate)) return candidate
  }
  for (const key of ['tool_response', 'toolResponse', 'tool_result', 'toolResult', 'result', 'output', 'content', 'structuredContent']) {
    const nested = value[key]
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const descriptor = findDescriptor(item?.text ?? item, depth + 1, seen)
        if (descriptor) return descriptor
      }
    } else {
      const descriptor = findDescriptor(nested, depth + 1, seen)
      if (descriptor) return descriptor
    }
  }
  return null
}

function verifyDeliveredBody(payload, descriptor) {
  const pending = [{ value: payload, depth: 0 }]
  const seen = new WeakSet()
  let visited = 0
  while (pending.length && visited < 4096) {
    const { value, depth } = pending.pop()
    visited += 1
    if (depth > 12 || value === null || value === undefined) continue
    if (typeof value === 'string') {
      if (descriptor.bodyCarrier === 'profile-load-text-v1') {
        const match = value.match(/^<!-- profile_load_budget [^\r\n]* -->\r?\n\r?\n/)
        if (match) {
          const body = value.slice(match[0].length)
          if (digestValue(body) === descriptor.bodyDigest &&
              Buffer.byteLength(body, 'utf8') === descriptor.bodyBytes) {
            return { valid: true, carrier: descriptor.bodyCarrier }
          }
        }
      }
      const text = value.trim()
      if (text.startsWith('{') && Buffer.byteLength(text, 'utf8') <= 1024 * 1024) {
        try { pending.push({ value: JSON.parse(text), depth: depth + 1 }) } catch { }
      }
      continue
    }
    if (typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (descriptor.bodyCarrier === 'skill-route-body-chunks-v1' && Array.isArray(value.bodyChunks)) {
      const bytes = value.bodyChunks.reduce((sum, chunk) => sum + Math.max(0, Number(chunk?.bytes) || 0), 0)
      if (value.bodyChunks.length && digestValue(value.bodyChunks) === descriptor.bodyDigest &&
          bytes === descriptor.bodyBytes) {
        return { valid: true, carrier: descriptor.bodyCarrier }
      }
    }
    for (const nested of Object.values(value)) pending.push({ value: nested, depth: depth + 1 })
  }
  return {
    valid: false,
    errorCode: visited >= 4096
      ? 'CONTEXT_DELIVERY_EVIDENCE_BUDGET_EXCEEDED'
      : 'CONTEXT_DELIVERY_BODY_EVIDENCE_MISSING'
  }
}

function observeContextDeliveryFromPayload(state, payload, options = {}) {
  const descriptor = findDescriptor(payload)
  if (!descriptor) return { status: 'ignored', reasonCode: 'delivery-descriptor-missing' }
  const binding = state?.taskRecoveryBinding
  const sessionKey = String(
    state?.contextAcquisition?.hostSessionId ||
    payload?.session_id || payload?.sessionId || payload?.conversation_id || payload?.conversationId || ''
  ).trim()
  const activeRoot = String(state?.contextAcquisition?.activeRoot || '').trim()
  const activeRootDigest = activeRoot
    ? sha256(canonicalRootForDigest(activeRoot))
    : ''
  if (!binding?.taskId || binding.taskId !== descriptor.taskId ||
      String(binding.project || '') !== descriptor.project ||
      String(state?.contextAcquisition?.contextEpoch || '') !== descriptor.contextEpoch ||
      !activeRootDigest || activeRootDigest !== descriptor.activeRootDigest ||
      !sessionKey || sha256(sessionKey) !== descriptor.conversationDigest) {
    return { status: 'rejected', reasonCode: 'delivery-observation-identity-mismatch' }
  }
  let recoveryKey
  try {
    recoveryKey = createTaskRecoveryKey({ activeRoot, project: descriptor.project, taskId: descriptor.taskId })
  } catch {
    return { status: 'rejected', reasonCode: 'delivery-observation-identity-invalid' }
  }
  const expectedLeaseId = digestValue({
    taskId: descriptor.taskId,
    recoveryKey,
    project: descriptor.project,
    activeRootDigest: descriptor.activeRootDigest,
    conversationDigest: descriptor.conversationDigest,
    contextEpoch: descriptor.contextEpoch,
    sourceKey: descriptor.sourceKey,
    sourceDigest: descriptor.sourceDigest,
    bodyCarrier: descriptor.bodyCarrier,
    bodyDigest: descriptor.bodyDigest,
    bodyBytes: descriptor.bodyBytes
  })
  if (descriptor.deliveryLeaseId !== expectedLeaseId) {
    return { status: 'rejected', reasonCode: 'delivery-observation-lease-mismatch' }
  }
  const bodyEvidence = verifyDeliveredBody(payload, descriptor)
  if (!bodyEvidence.valid) {
    return {
      status: 'rejected',
      reasonCode: 'delivery-observation-body-unverified',
      errorCode: bodyEvidence.errorCode
    }
  }
  const receipt = {
    schemaVersion: CONTEXT_DELIVERY_RECEIPT_SCHEMA,
    deliveryLeaseId: descriptor.deliveryLeaseId,
    taskId: descriptor.taskId,
    project: descriptor.project,
    conversationDigest: descriptor.conversationDigest,
    contextEpoch: descriptor.contextEpoch,
    sourceKey: descriptor.sourceKey,
    sourceDigest: descriptor.sourceDigest,
    activeRootDigest: descriptor.activeRootDigest,
    bodyCarrier: descriptor.bodyCarrier,
    bodyDigest: descriptor.bodyDigest,
    bodyBytes: descriptor.bodyBytes,
    observedAt: new Date(options.nowMs || Date.now()).toISOString()
  }
  const prior = Array.isArray(state.contextDeliveryReceipts) ? state.contextDeliveryReceipts : []
  state.contextDeliveryReceipts = compactDeliveryReceipts([
    ...prior.filter(item => item?.deliveryLeaseId !== receipt.deliveryLeaseId),
    receipt
  ])
  return { status: 'observed', receipt }
}

module.exports = {
  CONTEXT_DELIVERY_DECISION_SCHEMA,
  CONTEXT_DELIVERY_DESCRIPTOR_SCHEMA,
  CONTEXT_DELIVERY_RECEIPT_SCHEMA,
  descriptorDigest,
  getContextDeliveryDecision,
  observeContextDeliveryFromPayload,
  tokenEquivalentEstimate,
  validateDescriptor
}
