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
const { createRuntimeStateStore } = require('./runtime-state-store.cjs')

const CONTEXT_SOURCE_LEDGER_SCHEMA = 'ContextSourceObservationLedgerV1'
const CONTEXT_SOURCE_LEDGER_SLOT_COUNT = 128
const CONTEXT_SOURCE_LEDGER_MAX_BYTES = 512 * 1024
const CONTEXT_SOURCE_LEDGER_MAX_OBSERVATIONS = 128
const CONTEXT_PLAN_AUTHORIZATION_MAX_AGE_MS = 24 * 60 * 60 * 1000

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

function contextSourceLedgerRelativePath(contextEpoch) {
  const digest = stableDigest(String(contextEpoch || '').trim())
  const slot = Number.parseInt(digest.slice(0, 8), 16) % CONTEXT_SOURCE_LEDGER_SLOT_COUNT
  return path.join(
    'context-source-observations',
    'v1',
    `slot-${String(slot).padStart(3, '0')}.json`
  )
}

function contextSourceLedgerStore(target, contextEpoch) {
  return createRuntimeStateStore({
    activeRoot: target.activeRoot,
    project: target.project,
    relativePath: contextSourceLedgerRelativePath(contextEpoch),
    maxBytes: CONTEXT_SOURCE_LEDGER_MAX_BYTES,
    lockWaitMs: 2000,
    maxWrites: 0
  })
}

function ledgerIdentity(binding, target) {
  return {
    contextEpoch: binding.contextEpoch,
    planId: binding.planId,
    planContentId: binding.planContentId,
    activeRoot: portableRoot(target.activeRoot),
    project: target.project
  }
}

function ledgerIdentityMatches(value, binding, target) {
  const identity = value?.identity
  return !!(
    identity &&
    identity.contextEpoch === binding.contextEpoch &&
    identity.planId === binding.planId &&
    identity.planContentId === binding.planContentId &&
    comparableRoot(identity.activeRoot) === comparableRoot(target.activeRoot) &&
    identity.project === target.project
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

function contextAuthorizationFailure(errorCode, reasonCode, message, details = {}) {
  return {
    status: 'blocked',
    errorCode,
    reasonCode,
    message,
    ...details
  }
}

function authorizeContextRead(input = {}, options = {}) {
  const activeRoot = portableRoot(input.activeRoot || input.target?.activeRoot)
  const project = String(input.project || input.target?.project || '').trim()
  const target = { activeRoot, project }
  if (!activeRoot || !project) {
    return contextAuthorizationFailure(
      'CONTEXT_ACTIVE_TARGET_MISMATCH',
      'target-incomplete',
      'Context read target must include one resolved activeRoot and project.'
    )
  }
  const binding = normalizeVerifiedBinding(input.contextBinding, target)
  if (!binding) {
    return contextAuthorizationFailure(
      input.contextBinding == null ? 'CONTEXT_BINDING_REQUIRED' : 'CONTEXT_BINDING_INVALID',
      input.contextBinding == null ? 'binding-required' : 'binding-invalid',
      input.contextBinding == null
        ? 'A current ContextReadBindingV1 is required before reading governed content.'
        : 'contextBinding is malformed or does not match the resolved target.'
    )
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const observed = readContextPlanObservation({
    activeRoot,
    project,
    contextEpoch: binding.contextEpoch,
    nowMs
  })
  if (observed.status !== 'fresh' || !observed.plan) {
    return contextAuthorizationFailure(
      'CONTEXT_BINDING_PLAN_NOT_FOUND',
      'plan-observation-unavailable',
      'No current durable ContextReadPlan observation matches this binding.',
      { observationStatus: observed.status, observationErrorCode: observed.errorCode || null }
    )
  }

  const observedAtMs = Date.parse(observed.observation?.observedAt)
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? Math.max(0, options.maxAgeMs)
    : CONTEXT_PLAN_AUTHORIZATION_MAX_AGE_MS
  if (!Number.isFinite(observedAtMs) || nowMs - observedAtMs > maxAgeMs) {
    return contextAuthorizationFailure(
      'CONTEXT_BINDING_PLAN_EXPIRED',
      'plan-observation-expired',
      'The durable ContextReadPlan observation is no longer current.',
      { observedAt: observed.observation?.observedAt || null, maxAgeMs }
    )
  }

  const expectedBinding = normalizeVerifiedBinding(
    observed.originalContextBinding || observed.plan.contextBinding,
    target
  )
  if (!expectedBinding || stableDigest(expectedBinding) !== stableDigest(binding)) {
    return contextAuthorizationFailure(
      'CONTEXT_BINDING_PLAN_MISMATCH',
      'plan-binding-mismatch',
      'contextBinding does not match the current durable ContextReadPlan identity.'
    )
  }
  if (!observed.plan.actionEnvelope?.allowedActionClasses?.includes('context-read')) {
    return contextAuthorizationFailure(
      'CONTEXT_ACTION_NOT_AUTHORIZED',
      'action-envelope-mismatch',
      'The durable ContextReadPlan does not authorize governed context reads.'
    )
  }

  const allowedSources = new Map(observed.plan.selectedSources.map(source => [source.sourceId, source]))
  const requestedSources = [...new Set((Array.isArray(input.requestedSources) ? input.requestedSources : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))]
  const unauthorized = requestedSources.filter(sourceId => !allowedSources.has(sourceId))
  if (unauthorized.length) {
    return contextAuthorizationFailure(
      'CONTEXT_SOURCE_NOT_AUTHORIZED',
      'source-not-selected',
      `The current ContextReadPlan does not authorize: ${unauthorized.join(', ')}.`,
      { unauthorizedSourceIds: unauthorized }
    )
  }

  const requestedSections = Array.isArray(input.requestedSections) ? input.requestedSections : []
  for (const request of requestedSections) {
    const sourceId = String(request?.sourceId || '').trim()
    const headings = [...new Set((Array.isArray(request?.headingQueries) ? request.headingQueries : [])
      .map(value => String(value || '').trim())
      .filter(Boolean))]
    if (!sourceId || !allowedSources.has(sourceId)) {
      return contextAuthorizationFailure(
        'CONTEXT_SECTION_NOT_AUTHORIZED',
        'section-source-not-selected',
        `The current ContextReadPlan does not authorize section reads for ${sourceId || 'an unknown source'}.`
      )
    }
    if (request?.requireRouteRecipe === true) {
      const file = sourceId.startsWith('profile:') ? sourceId.slice('profile:'.length) : ''
      const recipeEntry = observed.plan.profile?.routeLoadRecipe?.entries?.find(entry => entry.file === file)
      const allowedHeadings = new Set((recipeEntry?.headingQueries || []).map(value => String(value).trim()))
      const unauthorizedHeadings = headings.filter(heading => !allowedHeadings.has(heading))
      if (!recipeEntry || unauthorizedHeadings.length) {
        return contextAuthorizationFailure(
          'CONTEXT_SECTION_NOT_AUTHORIZED',
          'section-outside-route-recipe',
          `The current ContextReadPlan route recipe does not authorize the requested sections for ${file || sourceId}.`,
          { unauthorizedHeadingQueries: unauthorizedHeadings }
        )
      }
    }
  }

  const authorization = {
    schemaVersion: 'AuthorizedContextReadV1',
    binding: {
      ...binding,
      bindingStatus: 'verified',
      verificationMode: 'request-bound'
    },
    plan: observed.plan,
    target,
    requestedSourceIds: requestedSources.sort(),
    observationPath: observed.filePath,
    observedAt: observed.observation.observedAt,
    producerIdentity: observed.producerIdentity || null
  }
  return {
    status: 'authorized',
    ...authorization,
    authorizationDigest: stableDigest({
      schemaVersion: authorization.schemaVersion,
      binding: authorization.binding,
      target,
      requestedSourceIds: authorization.requestedSourceIds,
      observationPath: authorization.observationPath,
      observedAt: authorization.observedAt
    })
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

function selectedSourceRefsStillMatch(selected, fsImpl = fs) {
  if (selected?.kind === 'memory') return true
  const refs = Array.isArray(selected?.sourceRefs) ? selected.sourceRefs : []
  if (!refs.length) return false
  return refs.every(ref => {
    let stat = null
    try { stat = fsImpl.statSync(ref.path) } catch { }
    const actual = {
      path: portableRoot(ref.path),
      layer: String(ref.layer || ''),
      exists: !!stat?.isFile(),
      size: stat?.isFile() ? stat.size : null,
      mtimeMs: stat?.isFile() ? stat.mtimeMs : null
    }
    return stableDigest(actual) === ref.metadataDigest
  })
}

function normalizeSourceResult(raw, plan, binding, target, hostSessionId, fsImpl = fs) {
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
  const rawHostSessionId = String(raw.hostSessionId || '')
  const effectiveHostSessionId = String(rawHostSessionId || hostSessionId || '')
  const carrierAdopted = !rawHostSessionId && !!effectiveHostSessionId
  return {
    observationId: String((carrierAdopted ? '' : raw.observationId) || `mcp-${stableDigest({
      sourceId,
      resultDigest,
      contextEpoch: binding.contextEpoch,
      hostSessionId: effectiveHostSessionId
    }).slice(0, 20)}`),
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
    sourceRefsMatch: raw.sourceRefsMatch === true && selectedSourceRefsStillMatch(selected, fsImpl),
    schemaMatch: raw.schemaMatch !== false,
    targetMatch: raw.targetMatch !== false,
    resultDigest,
    contentIdentity: raw.contentIdentity || null,
    bodyObserved,
    hostSessionId: effectiveHostSessionId,
    bytes: boundedNumber(raw.bytes),
    chars: boundedNumber(raw.chars),
    hostDeliveredBytes: boundedNumber(raw.hostDeliveredBytes),
    cache: raw.cache === true
  }
}

function persistContextSourceLedger(target, binding, sourceResults, options = {}) {
  const store = contextSourceLedgerStore(target, binding.contextEpoch)
  const write = updateJsonLocked(store.filePath, current => {
    const reusable = current?.schemaVersion === CONTEXT_SOURCE_LEDGER_SCHEMA &&
      ledgerIdentityMatches(current, binding, target)
    const observations = reusable && Array.isArray(current.observations)
      ? current.observations.filter(item => item && typeof item === 'object' && !Array.isArray(item))
      : []
    const byId = new Map(observations.map(item => [String(item.observationId || ''), item]))
    for (const result of sourceResults) {
      const observationId = String(result.observationId || '')
      const prior = observationId ? byId.get(observationId) : null
      if (prior && stableDigest(prior) === stableDigest(result)) continue
      if (observationId) byId.set(observationId, result)
    }
    return {
      schemaVersion: CONTEXT_SOURCE_LEDGER_SCHEMA,
      identity: ledgerIdentity(binding, target),
      observations: [...byId.values()].slice(-CONTEXT_SOURCE_LEDGER_MAX_OBSERVATIONS),
      updatedAt: new Date(options.nowMs || Date.now()).toISOString()
    }
  }, options)
  return { ...write, filePath: store.filePath }
}

function readMcpContextSourceObservations(input = {}, options = {}) {
  const activeRoot = portableRoot(input.activeRoot)
  const project = String(input.project || '').trim()
  const target = { activeRoot, project }
  if (!activeRoot || !project) return { status: 'skipped', reasonCode: 'target-incomplete', sourceResults: [] }
  const binding = normalizeVerifiedBinding(input.contextBinding, target)
  if (!binding) return { status: 'skipped', reasonCode: 'binding-unverified', sourceResults: [] }
  const plan = input.plan
  const validation = validateContextReadPlan(plan)
  if (!validation.valid || plan.planId !== binding.planId || plan.planContentId !== binding.planContentId) {
    return { status: 'skipped', reasonCode: 'plan-binding-mismatch', sourceResults: [] }
  }
  const store = contextSourceLedgerStore(target, binding.contextEpoch)
  const read = store.read()
  if (read.status !== 'fresh') {
    return { status: read.status, reasonCode: read.errorCode || 'ledger-unavailable', sourceResults: [], filePath: store.filePath }
  }
  const ledger = read.value
  if (ledger?.schemaVersion !== CONTEXT_SOURCE_LEDGER_SCHEMA || !ledgerIdentityMatches(ledger, binding, target)) {
    return { status: 'stale', reasonCode: 'ledger-identity-mismatch', sourceResults: [], filePath: store.filePath }
  }
  const sourceResults = (Array.isArray(ledger.observations) ? ledger.observations : [])
    .map(item => normalizeSourceResult(item, plan, binding, target, input.hostSessionId, options.fs || fs))
    .filter(Boolean)
  return {
    status: 'fresh',
    sourceResults,
    filePath: store.filePath,
    observationCount: sourceResults.length
  }
}

function replayMcpContextSourceObservations(receipt, plan, input = {}, options = {}) {
  if (!receipt || receipt.status === 'blocked') {
    return { status: 'skipped', reasonCode: `receipt-${receipt?.status || 'missing'}`, receipt }
  }
  let baseReceipt = receipt
  if (receipt.status === 'stale') {
    const lastEscalation = Array.isArray(receipt.escalations)
      ? receipt.escalations[receipt.escalations.length - 1]
      : null
    const staleReason = String(lastEscalation?.reason || lastEscalation?.trigger || '')
    const recoverableReasons = new Set([
      'projection-drift',
      'writer-drift',
      'observation-orphaned',
      'observation-write-failed',
      'delivery-unobserved'
    ])
    if (!recoverableReasons.has(staleReason)) {
      return { status: 'skipped', reasonCode: `receipt-stale-${staleReason || 'unknown'}`, receipt }
    }
    baseReceipt = createContextReadReceipt(plan, {
      verificationMode: 'structured-plan',
      planObserved: true,
      hostSessionId: String(input.hostSessionId || '')
    })
  }
  const durable = readMcpContextSourceObservations({ ...input, plan }, options)
  if (durable.status !== 'fresh' || !durable.sourceResults.length) {
    return { ...durable, receipt }
  }
  let nextReceipt = baseReceipt
  for (const result of durable.sourceResults) {
    nextReceipt = recordContextReadOutcome(nextReceipt, plan, result, {
      hostSessionId: input.hostSessionId,
      nowMs: options.nowMs
    })
  }
  return {
    status: 'replayed',
    recoveredFrom: receipt.status === 'stale' ? 'recoverable-stale' : 'current-receipt',
    receipt: nextReceipt,
    sourceResults: durable.sourceResults,
    filePath: durable.filePath,
    observationCount: durable.observationCount
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
    .map(item => normalizeSourceResult(item, observed.plan, binding, target, input.hostSessionId, options.fs || fs))
    .filter(Boolean)
  if (!sourceResults.length) return { status: 'skipped', reasonCode: 'source-results-empty' }

  const ledgerWrite = persistContextSourceLedger(target, binding, sourceResults, options)

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
  const durable = ledgerWrite.status === 'persisted'
  return {
    status: durable ? 'persisted' : 'degraded',
    ...(durable ? {} : { errorCode: ledgerWrite.errorCode || 'CONTEXT_SOURCE_LEDGER_NOT_PERSISTED' }),
    statePath,
    ledgerPath: ledgerWrite.filePath,
    ledgerStatus: ledgerWrite.status,
    lifecycleStatus: 'persisted',
    satisfiedSourceIds: Array.isArray(receipt?.satisfiedSourceIds) ? receipt.satisfiedSourceIds : [],
    missingSourceIds: Array.isArray(receipt?.missingSourceIds) ? receipt.missingSourceIds : [],
    receiptStatus: receipt?.status || 'unknown'
  }
}

module.exports = {
  CONTEXT_SOURCE_LEDGER_SCHEMA,
  CONTEXT_PLAN_AUTHORIZATION_MAX_AGE_MS,
  authorizeContextRead,
  contextSourceLedgerRelativePath,
  lifecycleStatePath,
  readMcpContextSourceObservations,
  replayMcpContextSourceObservations,
  recordMcpContextSourceObservations
}
