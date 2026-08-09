'use strict'

const {
  DIGEST_RE,
  byteLength,
  sha256
} = require('./progressive-skill-route-contract.cjs')

const BODY_CHARGE_LEDGER_SCHEMA = 'SkillRouteBodyChargeLedgerV1'
const BUDGET_PROJECTION_SCHEMA = 'SkillRouteBudgetProjectionV1'

function fail (code, details = {}) {
  const error = new Error(code)
  error.code = code
  error.details = details
  throw error
}

function nonNegativeInteger (value, code, field) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    fail(code, { field, value })
  }
  return number
}

function requiredIdentityText (value, code, field) {
  const text = String(value || '')
  if (!text || text.includes('|')) fail(code, { field })
  return text
}

function normalizeIdentityItem (item, contextEpoch, code = 'BODY_CHARGE_IDENTITY_INVALID') {
  const skillId = requiredIdentityText(item?.skillId, code, 'skillId')
  const effectiveLayer = requiredIdentityText(item?.effectiveLayer, code, 'effectiveLayer')
  const bodyDigest = String(item?.bodyDigest || '')
  if (!DIGEST_RE.test(bodyDigest)) fail(code, { field: 'bodyDigest', skillId })
  const epoch = requiredIdentityText(
    item?.contextEpoch == null ? contextEpoch : item.contextEpoch,
    code,
    'contextEpoch'
  )
  const bytes = nonNegativeInteger(
    item?.bytes == null ? item?.bodyBytes : item.bytes,
    code,
    'bytes'
  )
  if (typeof item?.content === 'string') {
    if (byteLength(item.content) !== bytes || sha256(item.content) !== bodyDigest) {
      fail(code, { field: 'content', skillId })
    }
  }
  const key = `${skillId}|${effectiveLayer}|${bodyDigest}|${epoch}`
  if (item?.key != null && String(item.key) !== key) {
    fail(code, { field: 'key', skillId })
  }
  return { key, skillId, effectiveLayer, bodyDigest, contextEpoch: epoch, bytes }
}

function compareIdentityItems (left, right) {
  return left.key.localeCompare(right.key)
}

function addKnownIdentity (knownByKey, item, code) {
  const existing = knownByKey.get(item.key)
  if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
    fail(code, { key: item.key })
  }
  if (!existing) knownByKey.set(item.key, item)
}

function assertBudget (state) {
  const consumedBodyBytes = nonNegativeInteger(
    state?.budget?.bodyBytesConsumed,
    'BODY_CHARGE_BUDGET_INVALID',
    'bodyBytesConsumed'
  )
  const bodyLimitBytes = nonNegativeInteger(
    state?.budget?.bodyLimitBytes,
    'BODY_CHARGE_BUDGET_INVALID',
    'bodyLimitBytes'
  )
  if (bodyLimitBytes === 0) {
    fail('BODY_CHARGE_BUDGET_INVALID', { field: 'bodyLimitBytes' })
  }
  return { consumedBodyBytes, bodyLimitBytes }
}

function validateCanonicalLedger (state) {
  const ledger = state?.bodyChargeLedger
  if (!ledger || ledger.schemaVersion !== BODY_CHARGE_LEDGER_SCHEMA ||
      !Array.isArray(ledger.items)) {
    fail('BODY_CHARGE_LEDGER_INVALID', { reason: 'schema' })
  }
  const knownByKey = new Map()
  for (const raw of ledger.items) {
    const item = normalizeIdentityItem(raw, state.contextEpoch, 'BODY_CHARGE_LEDGER_INVALID')
    if (item.contextEpoch !== state.contextEpoch) {
      fail('BODY_CHARGE_LEDGER_INVALID', {
        reason: 'context-epoch-mismatch',
        expectedContextEpoch: state.contextEpoch,
        actualContextEpoch: item.contextEpoch,
        key: item.key
      })
    }
    if (knownByKey.has(item.key)) {
      fail('BODY_CHARGE_LEDGER_INVALID', { reason: 'duplicate-key', key: item.key })
    }
    knownByKey.set(item.key, item)
  }
  const items = [...knownByKey.values()].sort(compareIdentityItems)
  const unattributedBodyBytes = nonNegativeInteger(
    ledger.unattributedBodyBytes,
    'BODY_CHARGE_LEDGER_INVALID',
    'unattributedBodyBytes'
  )
  const { consumedBodyBytes } = assertBudget(state)
  const knownBodyBytes = items.reduce((sum, item) => sum + item.bytes, 0)
  if (knownBodyBytes + unattributedBodyBytes !== consumedBodyBytes) {
    fail('BODY_CHARGE_LEDGER_INVALID', {
      reason: 'consumption-mismatch',
      knownBodyBytes,
      unattributedBodyBytes,
      consumedBodyBytes
    })
  }
  return {
    schemaVersion: BODY_CHARGE_LEDGER_SCHEMA,
    items,
    unattributedBodyBytes
  }
}

function currentPlanIdentityMap (state) {
  const result = new Map()
  for (const raw of state?.plan?.baseResolution?.selected || []) {
    const item = normalizeIdentityItem(raw, state.contextEpoch, 'BODY_CHARGE_PLAN_INVALID')
    addKnownIdentity(result, item, 'BODY_CHARGE_PLAN_INVALID')
  }
  return result
}

function recoverProgressIdentities (state, knownByKey) {
  const planByKey = currentPlanIdentityMap(state)
  for (const stageId of Object.keys(state?.stageProgress || {}).sort()) {
    const progress = state.stageProgress[stageId]
    if (!Array.isArray(progress?.loadedKeys)) continue
    for (const rawKey of progress.loadedKeys) {
      const key = String(rawKey || '')
      const item = planByKey.get(key)
      if (item) addKnownIdentity(knownByKey, item, 'BODY_CHARGE_LEGACY_PROGRESS_CONFLICT')
    }
  }
}

function recoverCachedIdentities (envelope, knownByKey) {
  const cache = envelope?.responseCache || {}
  for (const cacheKey of Object.keys(cache).sort()) {
    const response = cache[cacheKey]?.response
    if (response?.ok !== true || response.op !== 'load_stage' ||
        response.receipt?.schemaVersion !== 'StageLoadReceiptV1') continue
    if (!Array.isArray(response.receipt.loadedKeys) ||
        !Array.isArray(response.bodyChunks)) {
      fail('BODY_CHARGE_LEGACY_CACHE_INVALID', { cacheKey, reason: 'shape' })
    }
    if (response.receipt.contextEpoch !== envelope.state.contextEpoch) {
      fail('BODY_CHARGE_LEGACY_CACHE_INVALID', {
        cacheKey,
        reason: 'context-epoch-mismatch',
        expectedContextEpoch: envelope.state.contextEpoch,
        actualContextEpoch: response.receipt.contextEpoch
      })
    }
    const loadedKeys = new Set(response.receipt.loadedKeys.map(value => String(value)))
    for (const raw of response.bodyChunks) {
      const item = normalizeIdentityItem(
        raw,
        response.receipt.contextEpoch,
        'BODY_CHARGE_LEGACY_CACHE_INVALID'
      )
      if (!loadedKeys.has(item.key)) {
        fail('BODY_CHARGE_LEGACY_CACHE_INVALID', {
          cacheKey,
          reason: 'receipt-key-missing',
          key: item.key
        })
      }
      addKnownIdentity(knownByKey, item, 'BODY_CHARGE_LEGACY_CACHE_CONFLICT')
    }
  }
}

function recoverLegacyLedger (envelope) {
  const state = envelope?.state
  const { consumedBodyBytes } = assertBudget(state)
  const knownByKey = new Map()
  recoverProgressIdentities(state, knownByKey)
  recoverCachedIdentities(envelope, knownByKey)
  const items = [...knownByKey.values()].sort(compareIdentityItems)
  const knownBodyBytes = items.reduce((sum, item) => sum + item.bytes, 0)
  if (knownBodyBytes > consumedBodyBytes) {
    fail('BODY_CHARGE_LEGACY_CONSUMPTION_CONFLICT', {
      knownBodyBytes,
      consumedBodyBytes
    })
  }
  return {
    ledger: {
      schemaVersion: BODY_CHARGE_LEDGER_SCHEMA,
      items,
      unattributedBodyBytes: consumedBodyBytes - knownBodyBytes
    },
    migration: {
      schemaVersion: 'SkillRouteBodyChargeMigrationV1',
      status: 'legacy-normalized',
      recoveredIdentityCount: items.length,
      recoveredBodyBytes: knownBodyBytes,
      unattributedBodyBytes: consumedBodyBytes - knownBodyBytes,
      identityDigest: sha256(items.map(item => item.key))
    }
  }
}

function normalizeBodyChargeLedger (envelope) {
  const state = envelope?.state
  assertBudget(state)
  if (state.bodyChargeLedger == null) return recoverLegacyLedger(envelope)
  const ledger = validateCanonicalLedger(state)
  return {
    ledger,
    migration: {
      schemaVersion: 'SkillRouteBodyChargeMigrationV1',
      status: 'canonical',
      recoveredIdentityCount: ledger.items.length,
      recoveredBodyBytes: ledger.items.reduce((sum, item) => sum + item.bytes, 0),
      unattributedBodyBytes: ledger.unattributedBodyBytes,
      identityDigest: sha256(ledger.items.map(item => item.key))
    }
  }
}

function normalizeCandidates (items, contextEpoch, code = 'BODY_CHARGE_CANDIDATE_INVALID') {
  const byKey = new Map()
  for (const raw of items || []) {
    const item = normalizeIdentityItem(raw, contextEpoch, code)
    addKnownIdentity(byKey, item, code)
  }
  return [...byKey.values()].sort(compareIdentityItems)
}

function projectBodyBudget (envelope, items, options = {}) {
  const state = envelope?.state
  const { consumedBodyBytes, bodyLimitBytes } = assertBudget(state)
  const normalization = normalizeBodyChargeLedger(envelope)
  const chargedByKey = new Map(normalization.ledger.items.map(item => [item.key, item]))
  const candidates = normalizeCandidates(items, state.contextEpoch)
  for (const item of candidates) {
    const charged = chargedByKey.get(item.key)
    if (charged && charged.bytes !== item.bytes) {
      fail('BODY_CHARGE_IDENTITY_CONFLICT', {
        key: item.key,
        chargedBytes: charged.bytes,
        candidateBytes: item.bytes
      })
    }
  }
  const newItems = candidates.filter(item => !chargedByKey.has(item.key))
  const reusedItems = candidates.filter(item => chargedByKey.has(item.key))
  const incrementalBodyBytes = newItems.reduce((sum, item) => sum + item.bytes, 0)
  const projectedBodyBytes = consumedBodyBytes + incrementalBodyBytes
  const projection = {
    schemaVersion: BUDGET_PROJECTION_SCHEMA,
    scope: String(options.scope || 'candidate'),
    consumedBodyBytes,
    bodyLimitBytes,
    remainingBodyBytes: Math.max(0, bodyLimitBytes - consumedBodyBytes),
    incrementalBodyBytes,
    projectedBodyBytes,
    deficitBodyBytes: Math.max(0, projectedBodyBytes - bodyLimitBytes),
    executable: projectedBodyBytes <= bodyLimitBytes,
    candidateIdentityCount: candidates.length,
    candidateIdentityDigest: sha256(candidates.map(item => item.key)),
    newIdentityCount: newItems.length,
    newIdentityDigest: sha256(newItems.map(item => item.key)),
    reusedIdentityCount: reusedItems.length,
    reusedIdentityDigest: sha256(reusedItems.map(item => item.key)),
    chargedIdentityCount: normalization.ledger.items.length,
    chargedIdentityDigest: sha256(normalization.ledger.items.map(item => item.key)),
    unattributedBodyBytes: normalization.ledger.unattributedBodyBytes,
    stageIds: [...new Set(options.stageIds || [])].map(String).sort()
  }
  return {
    projection,
    ledger: normalization.ledger,
    migration: normalization.migration,
    candidates,
    newItems,
    reusedItems
  }
}

function planScenarios (plan) {
  const scenarios = [{
    scenarioId: 'base',
    stageIds: (plan?.stages || []).map(stage => stage.stageId),
    items: plan?.baseResolution?.selected || []
  }]
  for (const scenario of plan?.coexistenceScenarios || []) {
    scenarios.push({
      scenarioId: String(scenario.scenarioId || 'coexistence'),
      stageIds: [...new Set((scenario.resolution?.selected || []).map(item => item.loadStage))],
      items: scenario.resolution?.selected || []
    })
  }
  return scenarios
}

function projectPlanReservation (envelope, plan) {
  if (!plan?.baseResolution || !Array.isArray(plan.baseResolution.selected)) {
    fail('BODY_CHARGE_PLAN_INVALID', { reason: 'base-resolution' })
  }
  const projections = planScenarios(plan).map(scenario => ({
    scenarioId: scenario.scenarioId,
    result: projectBodyBudget(envelope, scenario.items, {
      scope: `plan-reservation:${scenario.scenarioId}`,
      stageIds: scenario.stageIds
    })
  }))
  projections.sort((left, right) =>
    right.result.projection.projectedBodyBytes - left.result.projection.projectedBodyBytes ||
    left.scenarioId.localeCompare(right.scenarioId)
  )
  const worst = projections[0]
  return {
    ...worst.result,
    projection: {
      ...worst.result.projection,
      scope: 'plan-reservation',
      scenarioCount: projections.length,
      worstCaseScenarioId: worst.scenarioId,
      scenarioDigest: sha256(projections
        .map(item => ({
          scenarioId: item.scenarioId,
          incrementalBodyBytes: item.result.projection.incrementalBodyBytes,
          projectedBodyBytes: item.result.projection.projectedBodyBytes,
          executable: item.result.projection.executable
        }))
        .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)))
    }
  }
}

function planItemsForStages (plan, stageIds) {
  const wanted = new Set(stageIds || [])
  return (plan?.baseResolution?.selected || []).filter(item => wanted.has(item.loadStage))
}

function projectPendingStages (envelope, pendingStageIds) {
  const state = envelope?.state
  return projectBodyBudget(
    envelope,
    planItemsForStages(state?.plan, pendingStageIds),
    { scope: 'pending-mandatory-stages', stageIds: pendingStageIds }
  )
}

function applyBodyCharges (envelope, items, options = {}) {
  const result = projectBodyBudget(envelope, items, options)
  if (!result.projection.executable) {
    fail(options.errorCode || 'BUDGET_BLOCKED', {
      budgetProjection: result.projection
    })
  }
  const nextItems = [...result.ledger.items, ...result.newItems].sort(compareIdentityItems)
  const ledger = {
    schemaVersion: BODY_CHARGE_LEDGER_SCHEMA,
    items: nextItems,
    unattributedBodyBytes: result.ledger.unattributedBodyBytes
  }
  const budget = {
    ...envelope.state.budget,
    bodyBytesConsumed: result.projection.projectedBodyBytes
  }
  const knownBodyBytes = nextItems.reduce((sum, item) => sum + item.bytes, 0)
  if (knownBodyBytes + ledger.unattributedBodyBytes !== budget.bodyBytesConsumed) {
    fail('BODY_CHARGE_LEDGER_INVALID', { reason: 'post-charge-consumption-mismatch' })
  }
  return {
    ...result,
    ledger,
    budget
  }
}

module.exports = {
  BODY_CHARGE_LEDGER_SCHEMA,
  BUDGET_PROJECTION_SCHEMA,
  normalizeIdentityItem,
  normalizeBodyChargeLedger,
  projectBodyBudget,
  projectPlanReservation,
  planItemsForStages,
  projectPendingStages,
  applyBodyCharges
}
