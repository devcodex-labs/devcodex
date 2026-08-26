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
const {
  resolveTaskRecoveryMetaDir,
  updateTaskRecoveryState,
  writeStableProjection
} = require('./task-recovery-store-v5.cjs')
const { compactLifecycleStateV5 } = require('./lifecycle-state-projection-v5.cjs')

const CONTEXT_SOURCE_LEDGER_SCHEMA = 'ContextSourceObservationLedgerV4'
const PREVIOUS_CONTEXT_SOURCE_LEDGER_SCHEMA = 'ContextSourceObservationLedgerV3'
const LEGACY_CONTEXT_SOURCE_LEDGER_SCHEMA = 'ContextSourceObservationLedgerV1'
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
  return path.join(resolveTaskRecoveryMetaDir({
    activeRoot,
    project,
    workspaceNamespace
  }), 'lifecycle-state.json')
}

function contextSourceLedgerRelativePath(contextEpoch) {
  const digest = stableDigest(String(contextEpoch || '').trim())
  const slot = Number.parseInt(digest.slice(0, 8), 16) % CONTEXT_SOURCE_LEDGER_SLOT_COUNT
  return path.join(
    'context-source-observations',
    'v4',
    `slot-${String(slot).padStart(3, '0')}.json`
  )
}

function previousContextSourceLedgerRelativePath(contextEpoch) {
  const digest = stableDigest(String(contextEpoch || '').trim())
  return path.join(
    'context-source-observations',
    'v3',
    digest.slice(0, 2),
    `${digest}.json`
  )
}

function legacyContextSourceLedgerRelativePath(contextEpoch) {
  const digest = stableDigest(String(contextEpoch || '').trim())
  const slot = Number.parseInt(digest.slice(0, 8), 16) % CONTEXT_SOURCE_LEDGER_SLOT_COUNT
  return path.join(
    'context-source-observations',
    'v1',
    `slot-${String(slot).padStart(3, '0')}.json`
  )
}

function contextSourceLedgerStore(target, contextEpoch, options = {}) {
  const lockWaitMs = Number.isFinite(options.lockWaitMs)
    ? Math.max(0, Number(options.lockWaitMs))
    : 2000
  const primary = createRuntimeStateStore({
    activeRoot: target.activeRoot,
    project: target.project,
    relativePath: contextSourceLedgerRelativePath(contextEpoch),
    maxBytes: CONTEXT_SOURCE_LEDGER_MAX_BYTES,
    lockWaitMs,
    maxWrites: 1,
    fs: options.fs || fs
  })
  const legacy = createRuntimeStateStore({
    activeRoot: target.activeRoot,
    project: target.project,
    relativePath: previousContextSourceLedgerRelativePath(contextEpoch),
    maxBytes: CONTEXT_SOURCE_LEDGER_MAX_BYTES,
    lockWaitMs,
    maxWrites: 0,
    fs: options.fs || fs
  })
  const legacyV1 = createRuntimeStateStore({
    activeRoot: target.activeRoot,
    project: target.project,
    relativePath: legacyContextSourceLedgerRelativePath(contextEpoch),
    maxBytes: CONTEXT_SOURCE_LEDGER_MAX_BYTES,
    lockWaitMs,
    maxWrites: 0,
    fs: options.fs || fs
  })
  function read(readOptions = {}) {
    const current = primary.read(readOptions)
    if (current.status !== 'missing') return current
    const previous = legacy.read(readOptions)
    if (previous.status !== 'missing') {
      return { ...previous, stateSource: 'legacy-v3-read-only', canonicalFilePath: primary.filePath }
    }
    const old = legacyV1.read(readOptions)
    return old.status === 'missing'
      ? current
      : { ...old, stateSource: 'legacy-v1-read-only', canonicalFilePath: primary.filePath }
  }
  return Object.freeze({
    filePath: primary.filePath,
    legacyFilePath: legacy.filePath,
    read,
    update: primary.update
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

function readJson(file, fsImpl = fs) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
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
  const store = contextSourceLedgerStore(target, binding.contextEpoch, options)
  const write = store.update(current => {
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

function contextSourceLedgerErrorCode(write) {
  const code = String(write?.errorCode || '').trim()
  return code.startsWith('DERIVED_STATE_')
    ? code.replace(/^DERIVED_STATE_/, 'CONTEXT_SOURCE_OBSERVATION_')
    : (code || 'CONTEXT_SOURCE_LEDGER_NOT_PERSISTED')
}

function sourceObservationQuality(result) {
  return [
    result?.successful,
    result?.observable,
    result?.transportSuccess,
    result?.sourceRefsMatch,
    result?.schemaMatch,
    result?.targetMatch,
    result?.bodyObserved
  ].reduce((score, value) => (score << 1) + (value === true ? 1 : 0), 0)
}

/**
 * Fold at most one deterministic durable observation per selected source.
 * Arrival order and duplicate tool events therefore cannot change the V5
 * receipt or its downstream rebind/load-stage identity.
 */
function selectDurableSourceResultsForFold(plan, sourceResults) {
  const bySource = new Map()
  for (const result of Array.isArray(sourceResults) ? sourceResults : []) {
    const sourceId = String(result?.sourceId || '')
    if (!sourceId) continue
    const prior = bySource.get(sourceId)
    const candidateRank = [
      String(sourceObservationQuality(result)).padStart(3, '0'),
      String(result.resultDigest || ''),
      String(result.observationId || '')
    ].join(':')
    const priorRank = prior
      ? [
          String(sourceObservationQuality(prior)).padStart(3, '0'),
          String(prior.resultDigest || ''),
          String(prior.observationId || '')
        ].join(':')
      : ''
    if (!prior || candidateRank > priorRank) bySource.set(sourceId, result)
  }
  const sourceOrder = new Map((plan?.selectedSources || []).map((source, index) => [source.sourceId, index]))
  return [...bySource.values()].sort((left, right) => {
    const order = (sourceOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) -
      (sourceOrder.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER)
    return order || String(left.sourceId).localeCompare(String(right.sourceId))
  })
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
  const store = contextSourceLedgerStore(target, binding.contextEpoch, options)
  const read = store.read()
  if (read.status !== 'fresh') {
    return { status: read.status, reasonCode: read.errorCode || 'ledger-unavailable', sourceResults: [], filePath: store.filePath }
  }
  const ledger = read.value
  const acceptedSchema = read.stateSource === 'legacy-v1-read-only'
    ? LEGACY_CONTEXT_SOURCE_LEDGER_SCHEMA
    : (read.stateSource === 'legacy-v3-read-only'
        ? PREVIOUS_CONTEXT_SOURCE_LEDGER_SCHEMA
        : CONTEXT_SOURCE_LEDGER_SCHEMA)
  if (ledger?.schemaVersion !== acceptedSchema || !ledgerIdentityMatches(ledger, binding, target)) {
    return { status: 'stale', reasonCode: 'ledger-identity-mismatch', sourceResults: [], filePath: store.filePath }
  }
  const sourceResults = (Array.isArray(ledger.observations) ? ledger.observations : [])
    .map(item => normalizeSourceResult(item, plan, binding, target, input.hostSessionId, options.fs || fs))
    .filter(Boolean)
  return {
    status: 'fresh',
    sourceResults,
    filePath: read.filePath || store.filePath,
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
  if (ledgerWrite.status !== 'persisted') {
    return {
      status: 'degraded',
      errorCode: contextSourceLedgerErrorCode(ledgerWrite),
      ledgerPath: ledgerWrite.filePath,
      ledgerStatus: ledgerWrite.status,
      lifecycleStatus: 'not-advanced'
    }
  }

  const workspaceNamespace = target.workspaceNamespace || looksLikeWorkspaceNamespaceActiveRoot(target.activeRoot, target.project)
  const recoveryMetaDir = resolveTaskRecoveryMetaDir({ ...target, workspaceNamespace })
  const statePath = path.join(recoveryMetaDir, 'lifecycle-state.json')
  const metaDir = workspaceNamespace
    ? resolveTaskRecoveryMetaDir({ ...target, workspaceNamespace: true, scope: 'workspace' })
    : recoveryMetaDir
  const sessionKey = String(input.hostSessionId || '')
  const recoveryIdentity = {
    activeRoot: target.activeRoot,
    project: target.project
  }
  let foldFailure = null
  let foldReceipt = null
  const write = updateTaskRecoveryState({
    metaDir: recoveryMetaDir,
    sessionKey,
    expectedIdentity: recoveryIdentity,
    identity: recoveryIdentity,
    readFallback: () => readJson(statePath, options.fs || fs) || {}
  }, lifecycle => {
    // Read the complete ledger while holding the V5 store CAS lock. An older
    // writer that arrives after a newer ledger writer therefore folds the same
    // freshest durable set instead of overwriting V5 with its call-local slice.
    const durable = readMcpContextSourceObservations({
      activeRoot: target.activeRoot,
      project: target.project,
      contextBinding: binding,
      plan: observed.plan,
      hostSessionId: input.hostSessionId
    }, options)
    if (durable.status !== 'fresh' || !durable.sourceResults.length) {
      foldFailure = {
        status: durable.status,
        reasonCode: durable.reasonCode || 'durable-ledger-not-fresh'
      }
      return lifecycle
    }
    const foldResults = selectDurableSourceResultsForFold(observed.plan, durable.sourceResults)
    const acquisition = installObservedPlan(lifecycle, observed.plan, binding, target, input.hostSessionId)
    for (const result of foldResults) {
      acquisition.receipt = recordContextReadOutcome(acquisition.receipt, observed.plan, result, {
        hostSessionId: acquisition.hostSessionId,
        nowMs: options.nowMs
      })
    }
    lifecycle.contextAcquisition = acquisition
    const foldSemantic = {
      schemaVersion: 'ContextObservationFoldReceiptV1',
      identity: ledgerIdentity(binding, target),
      sourceResultDigests: foldResults.map(result => ({
        sourceId: result.sourceId,
        resultDigest: result.resultDigest,
        observationId: result.observationId
      })),
      receiptStatus: acquisition.receipt?.status || 'unknown',
      satisfiedSourceIds: Array.isArray(acquisition.receipt?.satisfiedSourceIds)
        ? [...acquisition.receipt.satisfiedSourceIds].sort()
        : [],
      missingSourceIds: Array.isArray(acquisition.receipt?.missingSourceIds)
        ? [...acquisition.receipt.missingSourceIds].sort()
        : []
    }
    foldReceipt = {
      ...foldSemantic,
      foldDigest: stableDigest(foldSemantic)
    }
    lifecycle.contextObservationFold = foldReceipt
    lifecycle.updatedAt = new Date(options.nowMs || Date.now()).toISOString()
    return lifecycle
  }, {
    ...options,
    reason: 'context-source-observation',
    force: true,
    touchSessionMapping: true
  })
  if (foldFailure) {
    return {
      status: 'degraded',
      errorCode: 'CONTEXT_SOURCE_OBSERVATION_FOLD_NOT_FRESH',
      ledgerPath: ledgerWrite.filePath,
      ledgerStatus: ledgerWrite.status,
      lifecycleStatus: 'not-advanced',
      foldFailure
    }
  }
  if (!['committed', 'ephemeral-stub', 'skipped'].includes(write.status)) return write

  const projectionWarnings = []
  const projectedState = write.state || compactLifecycleStateV5(readJson(statePath, options.fs || fs) || {}).state
  for (const projection of [
    { role: 'active', file: statePath },
    ...(path.resolve(metaDir) === path.resolve(path.dirname(statePath))
      ? []
      : [{ role: 'meta', file: path.join(metaDir, 'lifecycle-state.json') }])
  ]) {
    const projectionState = projection.role === 'meta'
      ? { ...projectedState, taskRecoveryBinding: null }
      : projectedState
    const projectionWrite = writeStableProjection(projection.file, projectionState, { fs: options.fs || fs })
    if (projectionWrite.status !== 'persisted') {
      projectionWarnings.push({ ...projection, message: projectionWrite.message, errorCode: projectionWrite.errorCode })
    }
  }

  const refreshed = projectedState
  const receipt = refreshed.contextAcquisition?.receipt || null
  return {
    status: 'persisted',
    statePath,
    ledgerPath: ledgerWrite.filePath,
    ledgerStatus: ledgerWrite.status,
    lifecycleStatus: projectionWarnings.length ? 'committed-with-projection-warnings' : 'committed',
    projectionWarnings,
    foldReceipt,
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
  recordMcpContextSourceObservations,
  selectDurableSourceResultsForFold
}
