'use strict'

const fs = require('fs')
const path = require('path')
const {
  createContextReadReceipt,
  recordContextReadOutcome,
  stableDigest,
  validateContextReadPlan
} = require('./context-read-contract.cjs')
const { readContextPlanObservation } = require('./context-plan-observation.cjs')

const CONTEXT_BINDING_FIELDS = new Set([
  'schemaVersion',
  'contextEpoch',
  'planId',
  'planContentId',
  'activeRoot',
  'project',
  'bindingStatus',
  'verificationMode'
])

function portableRoot(value) {
  const text = String(value || '').trim()
  return text ? path.resolve(text).replace(/\\/g, '/') : ''
}

function comparableRoot(value) {
  const resolved = path.resolve(String(value || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function lifecycleStatePath({ activeRoot, project, workspaceNamespace }) {
  return path.join(
    activeRoot,
    '.memory',
    'hooks',
    workspaceNamespace ? String(project || '__workspace__') : '__workspace__',
    'lifecycle-state.json'
  )
}

function looksLikeWorkspaceNamespaceActiveRoot(activeRoot, project) {
  const resolved = path.resolve(String(activeRoot || ''))
  const projectName = String(project || '').trim()
  return !!(
    projectName &&
    path.basename(resolved) === projectName &&
    path.basename(path.dirname(resolved)) === '.devcodex'
  )
}

function waitSync(milliseconds) {
  if (milliseconds <= 0) return
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

function acquireLock(lockPath, { fsImpl = fs, waitMs = 2000, now = () => Date.now() } = {}) {
  const startedAt = now()
  while (true) {
    try {
      fsImpl.mkdirSync(path.dirname(lockPath), { recursive: true })
      const descriptor = fsImpl.openSync(lockPath, 'wx')
      fsImpl.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date(now()).toISOString() })}\n`, 'utf8')
      return { descriptor, waitedMs: Math.max(0, now() - startedAt) }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const elapsed = now() - startedAt
      if (elapsed >= waitMs) return null
      waitSync(Math.min(25, waitMs - elapsed))
    }
  }
}

function readJson(file, fsImpl = fs) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function updateJsonLocked(file, updater, options = {}) {
  const fsImpl = options.fs || fs
  const lockPath = `${file}.lock`
  let lock
  try {
    lock = acquireLock(lockPath, {
      fsImpl,
      waitMs: Number.isInteger(options.lockWaitMs) ? options.lockWaitMs : 2000,
      now: options.now || (() => Date.now())
    })
  } catch (error) {
    return { status: 'error', errorCode: 'CONTEXT_SOURCE_OBSERVATION_LOCK_FAILED', message: error.message }
  }
  if (!lock) {
    return { status: 'bypassed', errorCode: 'CONTEXT_SOURCE_OBSERVATION_LOCK_TIMEOUT' }
  }

  const tempPath = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`
  try {
    const current = readJson(file, fsImpl)
    const next = updater(current)
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return { status: 'invalid', errorCode: 'CONTEXT_SOURCE_OBSERVATION_INVALID_STATE' }
    }
    fsImpl.mkdirSync(path.dirname(file), { recursive: true })
    const serialized = `${JSON.stringify(next, null, 2)}\n`
    fsImpl.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' })
    fsImpl.renameSync(tempPath, file)
    return { status: 'persisted', bytes: Buffer.byteLength(serialized), waitedMs: lock.waitedMs }
  } catch (error) {
    try { fsImpl.unlinkSync(tempPath) } catch { }
    return { status: 'error', errorCode: 'CONTEXT_SOURCE_OBSERVATION_WRITE_FAILED', message: error.message }
  } finally {
    try { fsImpl.closeSync(lock.descriptor) } catch { }
    try { fsImpl.unlinkSync(lockPath) } catch { }
  }
}

function normalizeVerifiedBinding(binding, target) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return null
  if (Object.keys(binding).some(field => !CONTEXT_BINDING_FIELDS.has(field))) return null
  if (binding.schemaVersion !== 'ContextReadBindingV1') return null
  if (binding.bindingStatus && binding.bindingStatus !== 'verified') return null
  if (binding.verificationMode && binding.verificationMode !== 'request-bound') return null
  const required = ['contextEpoch', 'planId', 'planContentId', 'activeRoot']
  if (required.some(field => typeof binding[field] !== 'string' || !binding[field].trim())) return null
  if (typeof binding.project !== 'string') return null
  if (comparableRoot(binding.activeRoot) !== comparableRoot(target.activeRoot)) return null
  if (binding.project.trim() !== String(target.project || '').trim()) return null
  return {
    schemaVersion: 'ContextReadBindingV1',
    contextEpoch: binding.contextEpoch.trim(),
    planId: binding.planId.trim(),
    planContentId: binding.planContentId.trim(),
    activeRoot: binding.activeRoot.trim(),
    project: binding.project.trim()
  }
}

function lifecycleMatchesBinding(acquisition, binding, plan, target) {
  const receipt = acquisition?.receipt
  return !!(
    acquisition &&
    receipt &&
    acquisition.contextEpoch === binding.contextEpoch &&
    plan?.identity?.contextEpoch === binding.contextEpoch &&
    plan?.planId === binding.planId &&
    plan?.planContentId === binding.planContentId &&
    receipt.contextEpoch === binding.contextEpoch &&
    receipt.planId === binding.planId &&
    receipt.planContentId === binding.planContentId &&
    comparableRoot(acquisition.activeRoot) === comparableRoot(target.activeRoot) &&
    String(acquisition.project || '') === String(target.project || '')
  )
}

function installObservedPlan(lifecycle, plan, binding, target, hostSessionId) {
  const acquisition = lifecycle.contextAcquisition && typeof lifecycle.contextAcquisition === 'object'
    ? lifecycle.contextAcquisition
    : {}
  const currentPlan = lifecycleMatchesBinding(acquisition, binding, acquisition.plan, target)
    ? acquisition.plan
    : plan
  let receipt = lifecycleMatchesBinding(acquisition, binding, currentPlan, target)
    ? acquisition.receipt
    : null
  const effectiveHostSessionId = String(hostSessionId || acquisition.hostSessionId || '')
  const reusableReceipt = !!(
    receipt &&
    receipt.verificationMode === 'structured-plan' &&
    !['stale', 'blocked'].includes(receipt.status)
  )
  if (!reusableReceipt) {
    receipt = createContextReadReceipt(plan, {
      verificationMode: 'structured-plan',
      planObserved: true,
      hostSessionId: effectiveHostSessionId
    })
  }
  acquisition.schemaVersion = 'ContextReadStateV2'
  acquisition.contextEpoch = binding.contextEpoch
  acquisition.activeRoot = portableRoot(target.activeRoot)
  acquisition.project = target.project
  acquisition.hostSessionId = effectiveHostSessionId
  acquisition.plan = plan
  acquisition.receipt = receipt
  acquisition.targetResolved = true
  acquisition.fallbackActive = false
  acquisition.lastError = null
  acquisition.verificationMode = 'structured-plan'
  lifecycle.contextAcquisition = acquisition
  return acquisition
}

function boundedNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function normalizeSourceResult(raw, plan, binding, target, hostSessionId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const sourceId = String(raw.sourceId || '').trim()
  const selected = plan.selectedSources.find(source => source.sourceId === sourceId)
  if (!selected) return null
  const bodyObserved = raw.bodyObserved === true
  const successful = raw.successful !== false && bodyObserved
  const resultDigest = String(raw.resultDigest || stableDigest({
    sourceId,
    contextEpoch: binding.contextEpoch,
    planId: binding.planId,
    contentIdentity: raw.contentIdentity || null,
    bytes: raw.bytes ?? null,
    chars: raw.chars ?? null
  }))
  return {
    observationId: String(raw.observationId || `mcp-${stableDigest({ sourceId, resultDigest, contextEpoch: binding.contextEpoch }).slice(0, 20)}`),
    toolCallId: String(raw.toolCallId || 'mcp-direct'),
    sourceId,
    contextEpoch: binding.contextEpoch,
    planId: plan.planId,
    activeRoot: target.activeRoot,
    sourceLayer: String(raw.sourceLayer || selected.sourceLayer || ''),
    outcome: successful ? 'observed-success' : String(raw.outcome || 'invalid'),
    successful,
    observable: raw.observable !== false,
    transportSuccess: raw.transportSuccess !== false,
    sourceRefsMatch: raw.sourceRefsMatch === true,
    schemaMatch: raw.schemaMatch !== false,
    targetMatch: raw.targetMatch !== false,
    resultDigest,
    contentIdentity: raw.contentIdentity || null,
    bodyObserved,
    hostSessionId: String(raw.hostSessionId || hostSessionId || ''),
    bytes: boundedNumber(raw.bytes),
    chars: boundedNumber(raw.chars),
    hostDeliveredBytes: boundedNumber(raw.hostDeliveredBytes),
    cache: raw.cache === true
  }
}

function recordMcpContextSourceObservations(input = {}, options = {}) {
  const activeRoot = portableRoot(input.activeRoot)
  const project = String(input.project || '').trim()
  const target = {
    activeRoot,
    project,
    workspaceNamespace: input.workspaceNamespace === true ||
      looksLikeWorkspaceNamespaceActiveRoot(activeRoot, project)
  }
  if (!target.activeRoot || !target.project) return { status: 'skipped', reasonCode: 'target-incomplete' }
  const binding = normalizeVerifiedBinding(input.contextBinding, target)
  if (!binding) return { status: 'skipped', reasonCode: 'binding-unverified' }

  const observed = readContextPlanObservation({
    activeRoot: target.activeRoot,
    project: target.project,
    contextEpoch: binding.contextEpoch,
    nowMs: options.nowMs
  })
  if (observed.status !== 'fresh' || !observed.plan) {
    return { status: 'skipped', reasonCode: 'plan-observation-missing', observationStatus: observed.status }
  }
  if (observed.plan.planId !== binding.planId || observed.plan.planContentId !== binding.planContentId) {
    return { status: 'skipped', reasonCode: 'plan-observation-mismatch' }
  }
  const validation = validateContextReadPlan(observed.plan)
  if (!validation.valid) {
    return { status: 'skipped', reasonCode: 'plan-observation-invalid', errors: validation.errors }
  }
  const sourceResults = (Array.isArray(input.sourceResults) ? input.sourceResults : [])
    .map(item => normalizeSourceResult(item, observed.plan, binding, target, input.hostSessionId))
    .filter(Boolean)
  if (!sourceResults.length) return { status: 'skipped', reasonCode: 'source-results-empty' }

  const statePath = lifecycleStatePath(target)
  const write = updateJsonLocked(statePath, lifecycle => {
    const acquisition = installObservedPlan(lifecycle, observed.plan, binding, target, input.hostSessionId)
    for (const result of sourceResults) {
      acquisition.receipt = recordContextReadOutcome(acquisition.receipt, observed.plan, result, {
        hostSessionId: acquisition.hostSessionId,
        nowMs: options.nowMs
      })
    }
    lifecycle.contextAcquisition = acquisition
    lifecycle.updatedAt = new Date(options.nowMs || Date.now()).toISOString()
    return lifecycle
  }, options)
  if (write.status !== 'persisted') return write

  const refreshed = readJson(statePath, options.fs || fs)
  const receipt = refreshed.contextAcquisition?.receipt || null
  return {
    status: 'persisted',
    statePath,
    satisfiedSourceIds: Array.isArray(receipt?.satisfiedSourceIds) ? receipt.satisfiedSourceIds : [],
    missingSourceIds: Array.isArray(receipt?.missingSourceIds) ? receipt.missingSourceIds : [],
    receiptStatus: receipt?.status || 'unknown'
  }
}

module.exports = {
  lifecycleStatePath,
  recordMcpContextSourceObservations
}
