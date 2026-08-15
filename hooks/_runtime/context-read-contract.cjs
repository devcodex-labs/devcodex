'use strict'

const crypto = require('crypto')
const {
  CONTENT_IDENTITY_SCHEMA,
  buildContentIdentity,
  buildJsonContentIdentity,
  stableStringify,
  validateContentIdentity
} = require('./content-identity.cjs')

const CONTEXT_READ_CONTRACT = Object.freeze({
  schemas: Object.freeze({
    intentSeed: 'IntentSeedV1',
    plan: 'ContextReadPlanV2',
    planV1: 'ContextReadPlanV1',
    receipt: 'ContextReadReceiptV2',
    receiptV1: 'ContextReadReceiptV1',
    error: 'ContextReadErrorV1',
    state: 'ContextReadStateV2',
    stateV1: 'ContextReadStateV1',
    identityInputs: 'ContextPlanIdentityInputsV1',
    executionOptimizationBinding: 'ExecutionOptimizationPlanBindingV1',
    reuseDecision: 'ContextReuseDecisionV1',
    stageTiming: 'StageTimingV1'
  }),
  errors: Object.freeze([
    'CONTEXT_INTENT_REQUIRED',
    'CONTEXT_INTENT_INVALID',
    'CONTEXT_CHANGE_TYPES_REQUIRED',
    'CONTEXT_BASELINE_STALE',
    'CONTEXT_PROFILE_CATALOG_DRIFT',
    'CONTEXT_PLAN_INVALID',
    'CONTEXT_FULL_REASON_REQUIRED',
    'CONTEXT_ACTIVE_TARGET_MISMATCH',
    'CONTEXT_BINDING_REQUIRED',
    'CONTEXT_BINDING_INVALID',
    'CONTEXT_BINDING_MISMATCH',
    'CONTEXT_BINDING_PLAN_NOT_FOUND',
    'CONTEXT_BINDING_PLAN_EXPIRED',
    'CONTEXT_BINDING_PLAN_MISMATCH',
    'CONTEXT_ACTION_NOT_AUTHORIZED',
    'CONTEXT_SOURCE_NOT_AUTHORIZED',
    'CONTEXT_SECTION_NOT_AUTHORIZED',
    'SOURCE_TOO_LARGE',
    'SOURCE_NOT_REGULAR_FILE',
    'SOURCE_INVALID_UTF8',
    'MEMORY_QUERY_INVALID',
    'MEMORY_SCOPE_AMBIGUOUS'
  ]),
  intents: Object.freeze(['dev', 'fix', 'analyze', 'audit', 'self-fix', 'chat', 'resume', 'other']),
  changeTypes: Object.freeze([
    'project-info', 'architecture', 'code-style', 'source-code', 'testing', 'release',
    'feature-state', 'docs', 'public-contract', 'config', 'security', 'destructive'
  ]),
  risks: Object.freeze(['normal', 'high', 'critical']),
  actionClasses: Object.freeze([
    'context-read', 'analysis-read', 'test-execution', 'docs-mutation',
    'source-mutation', 'workflow-closeout', 'release', 'dangerous'
  ]),
  verificationModes: Object.freeze(['structured-plan', 'path-observable', 'instruction-only']),
  receiptStatuses: Object.freeze([
    'unplanned', 'baseline-ready', 'planned', 'attempted', 'relevant-complete',
    'escalated-full', 'completed', 'unverified', 'stale', 'blocked'
  ]),
  escalationTriggers: Object.freeze([
    'low-confidence', 'cross-service', 'public-contract', 'release', 'security',
    'destructive', 'missing-reference', 'profile-catalog-drift', 'profile-drift',
    'scope-drift', 'source-digest', 'config-digest', 'tool-schema-drift',
    'route-consumer-drift', 'host-session-drift', 'compact', 'explicit-full'
  ])
})

const INTENTS = new Set(CONTEXT_READ_CONTRACT.intents)
const CHANGE_TYPES = new Set(CONTEXT_READ_CONTRACT.changeTypes)
const RISKS = new Set(CONTEXT_READ_CONTRACT.risks)
const ACTION_CLASSES = new Set(CONTEXT_READ_CONTRACT.actionClasses)
const VERIFICATION_MODES = new Set(CONTEXT_READ_CONTRACT.verificationModes)
const RECEIPT_STATUSES = new Set(CONTEXT_READ_CONTRACT.receiptStatuses)
const PLAN_V1_FIELDS = new Set([
  'schemaVersion', 'planId', 'identity', 'baselineContext', 'actionEnvelope', 'changeTypes',
  'selectedSources', 'mandatorySourceIds', 'excludedSources', 'catalogCoverage',
  'existenceSources', 'freshness', 'budget', 'escalationTriggers', 'triggeredEscalations',
  'exitCondition', 'profile', 'memory', 'fullRead', 'fullReadReason', 'planningTelemetry'
])
const PLAN_FIELDS = new Set([
  ...PLAN_V1_FIELDS,
  'planContentId', 'contextBinding', 'identityInputs', 'executionOptimization', 'reusePolicy', 'stageTiming', 'cacheDecision'
])
const SEED_FIELDS = new Set([
  'schemaVersion', 'contextEpoch', 'semantic', 'intent', 'targetHint', 'continuationHint',
  'riskHint', 'confidence', 'createdAt'
])
const RECEIPT_V1_FIELDS = new Set([
  'schemaVersion', 'receiptId', 'contextEpoch', 'planId', 'identity', 'verificationMode',
  'status', 'observations', 'satisfiedSourceIds', 'missingSourceIds', 'fullRead',
  'fullReadReason', 'escalations', 'completedAt', 'consumedAt', 'replanCount', 'lastError'
])
const RECEIPT_FIELDS = new Set([
  ...RECEIPT_V1_FIELDS,
  'planContentId', 'sourceIdentities', 'delivery', 'reuseFrom'
])
const SUCCESS_OUTCOMES = new Set(['baseline-ready', 'observed-success'])
const RISK_RANK = Object.freeze({ normal: 0, high: 1, critical: 2 })
const REASON_CODES = new Set([
  'baseline-readme', 'baseline-config', 'memory-status', 'memory-session',
  'explicit-selector', 'intent-change-type', 'full-read', 'excluded-local-policy',
  'excluded-no-match', 'excluded-metadata-only'
])
const CONTEXT_IDENTITY_VERSIONS = Object.freeze({
  contextPlan: 'ContextReadPlanV2',
  contextReceipt: 'ContextReadReceiptV2',
  contentIdentity: CONTENT_IDENTITY_SCHEMA,
  plannerTool: 'profile-context-plan@2',
  route: 'context-acquisition@2',
  consumers: 'profile-memory-hook@2'
})
const CONTEXT_RUNTIME_CONTRACT_VERSION = 2
const PROFILE_ROUTE_LOAD_RECIPE_SCHEMA = 'ProfileRouteLoadRecipeV2'
const PROFILE_ROUTE_LOAD_RECIPE_STRATEGY = 'bounded-section-selectors'
const PROFILE_ROUTE_LOAD_RECIPE_MAX_BYTES = 32 * 1024
const PROFILE_ROUTE_LOAD_RECIPE_FIELDS = new Set([
  'schemaVersion',
  'strategy',
  'maxFiles',
  'maxBytes',
  'minimumHeadroomBytes',
  'entries',
  'recipeDigest'
])
const PROFILE_ROUTE_LOAD_RECIPE_ENTRY_FIELDS = new Set([
  'file',
  'headingQueries',
  'requiredQueries',
  'includePreamble',
  'includeDescendants',
  'maxBytes'
])

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value === undefined ? null : value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return value
  if (seen.has(value)) throw new TypeError('Cannot digest a circular value')
  seen.add(value)
  const normalized = Array.isArray(value)
    ? value.map(item => canonicalize(item, seen))
    : Object.keys(value).sort().reduce((output, key) => {
        if (value[key] !== undefined) output[key] = canonicalize(value[key], seen)
        return output
      }, {})
  seen.delete(value)
  return normalized
}

function stableDigest(value) {
  const serialized = JSON.stringify(canonicalize(value))
  return crypto.createHash('sha256').update(serialized).digest('hex')
}

function deepClone(value) {
  return canonicalize(value)
}

function finiteOrNull(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function nowIso(options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  return new Date(nowMs).toISOString()
}

function validIso(value) {
  return typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))
}

function uniqueSorted(value, allowed = null) {
  const result = [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(item => item && (!allowed || allowed.has(item))))]
  return result.sort()
}

function safeProfileFile(value) {
  const file = String(value || '').trim()
  return !!file && file !== '.' && file !== '..' && !/[\\/]/.test(file) && !file.includes('\0')
}

function normalizeProfileRouteLoadRecipe(raw, selectedFiles) {
  if (raw === undefined || raw === null) return { valid: true, value: null, errors: [] }
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, value: null, errors: ['profile route recipe must be an object or null'] }
  }
  const unknown = Object.keys(raw).filter(field => !PROFILE_ROUTE_LOAD_RECIPE_FIELDS.has(field))
  if (unknown.length) errors.push(`unsupported profile route recipe fields: ${unknown.join(', ')}`)
  if (raw.schemaVersion !== PROFILE_ROUTE_LOAD_RECIPE_SCHEMA) errors.push('invalid profile route recipe schema')
  if (raw.strategy !== PROFILE_ROUTE_LOAD_RECIPE_STRATEGY) errors.push('invalid profile route recipe strategy')
  if (!Number.isInteger(raw.maxFiles) || raw.maxFiles < 1 || raw.maxFiles > 32) errors.push('invalid profile route recipe maxFiles')
  if (!Number.isInteger(raw.maxBytes) || raw.maxBytes < 1024 || raw.maxBytes > PROFILE_ROUTE_LOAD_RECIPE_MAX_BYTES) {
    errors.push('invalid profile route recipe maxBytes')
  }
  if (!Number.isInteger(raw.minimumHeadroomBytes) || raw.minimumHeadroomBytes < 1024 ||
      raw.minimumHeadroomBytes >= raw.maxBytes) {
    errors.push('invalid profile route recipe minimumHeadroomBytes')
  }
  const entries = Array.isArray(raw.entries) ? raw.entries : []
  const expectedFiles = Array.isArray(selectedFiles) ? [...selectedFiles].sort() : []
  if (!entries.length || entries.length > raw.maxFiles) errors.push('invalid profile route recipe entries')
  const entryFiles = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push('profile route recipe entry must be an object')
      continue
    }
    const entryUnknown = Object.keys(entry).filter(field => !PROFILE_ROUTE_LOAD_RECIPE_ENTRY_FIELDS.has(field))
    if (entryUnknown.length) errors.push(`unsupported profile route recipe entry fields: ${entryUnknown.join(', ')}`)
    const file = String(entry.file || '').trim()
    entryFiles.push(file)
    if (!safeProfileFile(file)) errors.push(`unsafe profile route recipe file: ${file || '<empty>'}`)
    const headingQueries = uniqueSorted(entry.headingQueries)
    const requiredQueries = uniqueSorted(entry.requiredQueries)
    if (!headingQueries.length || stableDigest(headingQueries) !== stableDigest(entry.headingQueries)) {
      errors.push(`invalid profile route recipe headingQueries: ${file || '<empty>'}`)
    }
    if (!requiredQueries.length || stableDigest(requiredQueries) !== stableDigest(entry.requiredQueries) ||
        requiredQueries.some(query => !headingQueries.includes(query))) {
      errors.push(`invalid profile route recipe requiredQueries: ${file || '<empty>'}`)
    }
    if (entry.includePreamble !== false || entry.includeDescendants !== true) {
      errors.push(`invalid profile route recipe section flags: ${file || '<empty>'}`)
    }
    if (!Number.isInteger(entry.maxBytes) || entry.maxBytes < 1024 || entry.maxBytes > raw.maxBytes) {
      errors.push(`invalid profile route recipe entry maxBytes: ${file || '<empty>'}`)
    }
  }
  if (new Set(entryFiles).size !== entryFiles.length) errors.push('duplicate profile route recipe file')
  if (stableDigest(entryFiles.sort()) !== stableDigest(expectedFiles)) errors.push('profile route recipe files mismatch selected profile files')
  const { recipeDigest, ...material } = raw
  if (!/^[a-f0-9]{64}$/i.test(String(recipeDigest || '')) || recipeDigest !== stableDigest(material)) {
    errors.push('profile route recipe digest mismatch')
  }
  return errors.length
    ? { valid: false, value: null, errors }
    : { valid: true, value: deepClone(raw), errors: [] }
}

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/')
}

function compareText(left, right) {
  const a = String(left)
  const b = String(right)
  return a < b ? -1 : (a > b ? 1 : 0)
}

function buildContextReadError(errorCode, message, nextStep) {
  const code = CONTEXT_READ_CONTRACT.errors.includes(errorCode)
    ? errorCode
    : 'CONTEXT_PLAN_INVALID'
  return {
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.error,
    errorCode: code,
    message: String(message || code),
    nextStep: String(nextStep || 'Correct the context acquisition input and retry once.')
  }
}

function measureContextPayload(value, options = {}) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  return {
    bytes: Buffer.byteLength(serialized || '', 'utf8'),
    chars: (serialized || '').length,
    latencyMs: finiteOrNull(options.latencyMs),
    tokens: finiteOrNull(options.tokens)
  }
}

function normalizeIdentityVersions(raw = {}) {
  const versions = {}
  for (const [key, fallback] of Object.entries(CONTEXT_IDENTITY_VERSIONS)) {
    versions[key] = String(raw?.[key] || fallback).trim()
  }
  return versions
}

function normalizeCacheDecision(raw = {}, planContentId = '') {
  const statuses = new Set(['hit', 'miss', 'bypassed', 'error', 'disabled'])
  const status = statuses.has(raw.status) ? raw.status : 'bypassed'
  return {
    schemaVersion: 'ContextComputationCacheDecisionV1',
    status,
    cacheKey: String(raw.cacheKey || planContentId || ''),
    scope: normalizePath(raw.scope || ''),
    reasonCode: String(raw.reasonCode || (status === 'bypassed' ? 'no-cache-adapter' : status)),
    reusedArtifacts: uniqueSorted(raw.reusedArtifacts),
    bodyDeliverySkipped: false,
    bytes: finiteOrNull(raw.bytes),
    maxBytes: finiteOrNull(raw.maxBytes)
  }
}

function normalizeStageTiming(raw = {}, defaults = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.stageTiming,
    plannerInputBytes: finiteOrNull(value.plannerInputBytes ?? defaults.plannerInputBytes),
    plannerResponseBytes: finiteOrNull(value.plannerResponseBytes ?? defaults.plannerResponseBytes),
    selectedSourceBytes: finiteOrNull(value.selectedSourceBytes ?? defaults.selectedSourceBytes),
    returnedBodyBytes: finiteOrNull(value.returnedBodyBytes ?? defaults.returnedBodyBytes),
    hostDeliveredBytes: finiteOrNull(value.hostDeliveredBytes ?? defaults.hostDeliveredBytes),
    latencyMs: finiteOrNull(value.latencyMs ?? defaults.latencyMs),
    cacheLookupMs: finiteOrNull(value.cacheLookupMs ?? defaults.cacheLookupMs),
    sourceReadMs: finiteOrNull(value.sourceReadMs ?? defaults.sourceReadMs),
    parseMs: finiteOrNull(value.parseMs ?? defaults.parseMs),
    serializeMs: finiteOrNull(value.serializeMs ?? defaults.serializeMs),
    tokens: finiteOrNull(value.tokens ?? defaults.tokens),
    ttftMs: finiteOrNull(value.ttftMs ?? defaults.ttftMs)
  }
}

function buildReusePolicy() {
  return {
    schemaVersion: 'ContextReusePolicyV1',
    computationReuse: {
      crossProcess: true,
      bodyDeliverySkipped: false,
      requiredMatches: ['planContentId', 'activeRoot', 'project', 'tool', 'schema', 'route', 'consumers']
    },
    deliveryReuse: {
      crossProcess: false,
      sameHostSession: true,
      sameContextEpoch: true,
      bodyObservationRequired: true,
      sourceIdentityRequired: true
    },
    metadataBudgetBytes: 32 * 1024 * 1024,
    capacityAction: 'bypass-write'
  }
}

function sumSelectedSourceBytes(sources) {
  const seen = new Set()
  let bytes = 0
  for (const source of Array.isArray(sources) ? sources : []) {
    for (const ref of Array.isArray(source?.sourceRefs) ? source.sourceRefs : []) {
      const key = `${normalizePath(ref.path)}#${ref.layer}`
      if (seen.has(key) || !ref.exists || !Number.isFinite(ref.size)) continue
      seen.add(key)
      bytes += ref.size
    }
  }
  return bytes
}

function planSourceIdentity(source) {
  return buildJsonContentIdentity({
    sourceKey: `context-plan/source/${source.sourceId}`,
    value: (source.sourceRefs || []).map(ref => ({
      path: normalizePath(ref.path),
      layer: ref.layer,
      exists: ref.exists,
      size: ref.size,
      mtimeMs: ref.mtimeMs,
      metadataDigest: ref.metadataDigest
    })),
    contractVersion: 'profile-source-metadata@1'
  }).identity
}

function buildExecutionOptimizationPlanBinding(effectiveConfig = {}, options = {}) {
  const requestedValue = effectiveConfig?.extensions?.devcodex?.executionOptimization?.mode
  const requested = requestedValue === undefined || requestedValue === null || requestedValue === ''
    ? null
    : String(requestedValue).trim()
  const configured = requested === 'safe-auto' || requested === 'full-only'
  const mode = requested === null ? 'safe-auto' : (configured ? requested : 'full-only')
  const status = requested === null ? 'defaulted' : (configured ? 'configured' : 'fail-closed')
  const project = String(options.project || '').trim() || 'unknown-project'
  const configIdentity = buildJsonContentIdentity({
    sourceKey: `profile://${project}/config.json#effective`,
    value: effectiveConfig && typeof effectiveConfig === 'object' && !Array.isArray(effectiveConfig) ? effectiveConfig : {},
    contractVersion: 'profile-config@1'
  }).identity
  const binding = {
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.executionOptimizationBinding,
    requested,
    mode,
    status,
    errorCode: status === 'fail-closed' ? 'EXECUTION_OPTIMIZATION_MODE_INVALID' : null,
    configIdentity
  }
  return { ...binding, bindingDigest: stableDigest(binding) }
}

function validateExecutionOptimizationPlanBinding(raw, options = {}) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('execution optimization binding must be an object')
    return { valid: false, errors }
  }
  const allowed = new Set(['schemaVersion', 'requested', 'mode', 'status', 'errorCode', 'configIdentity', 'bindingDigest'])
  const unknown = Object.keys(raw).filter(key => !allowed.has(key))
  if (unknown.length) errors.push(`unsupported execution optimization binding fields: ${unknown.join(', ')}`)
  if (raw.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.executionOptimizationBinding) errors.push('invalid execution optimization binding discriminator')
  if (!['safe-auto', 'full-only'].includes(raw.mode)) errors.push('invalid execution optimization mode')
  if (!['defaulted', 'configured', 'fail-closed'].includes(raw.status)) errors.push('invalid execution optimization status')
  if (raw.requested !== null && typeof raw.requested !== 'string') errors.push('execution optimization requested must be string or null')
  if (raw.status === 'defaulted' && (raw.requested !== null || raw.mode !== 'safe-auto' || raw.errorCode !== null)) {
    errors.push('defaulted execution optimization binding is non-canonical')
  }
  if (raw.status === 'configured' && (!['safe-auto', 'full-only'].includes(raw.requested) || raw.mode !== raw.requested || raw.errorCode !== null)) {
    errors.push('configured execution optimization binding is non-canonical')
  }
  if (raw.status === 'fail-closed' && (['safe-auto', 'full-only'].includes(raw.requested) || raw.mode !== 'full-only' || raw.errorCode !== 'EXECUTION_OPTIMIZATION_MODE_INVALID')) {
    errors.push('fail-closed execution optimization binding is non-canonical')
  }
  const identityValidation = validateContentIdentity(raw.configIdentity)
  if (!identityValidation.valid) errors.push(`invalid execution optimization configIdentity: ${identityValidation.errors.join(', ')}`)
  const digestInput = {
    schemaVersion: raw.schemaVersion,
    requested: raw.requested,
    mode: raw.mode,
    status: raw.status,
    errorCode: raw.errorCode,
    configIdentity: raw.configIdentity
  }
  if (raw.bindingDigest !== stableDigest(digestInput)) errors.push('execution optimization binding digest mismatch')
  if (options.effectiveConfig !== undefined) {
    const expected = buildExecutionOptimizationPlanBinding(options.effectiveConfig, { project: options.project })
    if (stableDigest(expected) !== stableDigest(raw)) errors.push('execution optimization binding does not match effective config')
  }
  return errors.length ? { valid: false, errors } : { valid: true, errors: [], value: raw }
}

function buildPlanIdentityInputs(plan) {
  const baseline = plan.baselineContext
  const inventoryProjection = [...(baseline.catalog || []), ...(baseline.inventory || [])]
    .map(item => ({
      file: profileFileFrom(item),
      requiredToExist: item.requiredToExist === true || item.required === true,
      sourceRefs: (item.sourceRefs || []).map(ref => ({
        path: normalizePath(ref.path),
        layer: String(ref.layer || ''),
        exists: ref.exists === true,
        size: finiteOrNull(ref.size),
        mtimeMs: finiteOrNull(ref.mtimeMs)
      }))
    }))
    .sort((left, right) => compareText(left.file, right.file))
  const readmeIdentity = buildContentIdentity({
    sourceKey: `profile://${plan.identity.project}/README.md`,
    content: baseline.readme.content,
    contractVersion: 'profile-readme@1'
  })
  const configIdentity = buildJsonContentIdentity({
    sourceKey: `profile://${plan.identity.project}/config.json#effective`,
    value: baseline.effectiveConfig,
    contractVersion: 'profile-config@1'
  }).identity
  const candidateIdentity = buildJsonContentIdentity({
    sourceKey: `profile://${plan.identity.project}/catalog-inventory`,
    value: inventoryProjection,
    contractVersion: 'profile-catalog-inventory@1'
  }).identity
  return {
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.identityInputs,
    target: {
      activeRoot: normalizePath(plan.identity.activeRoot),
      project: plan.identity.project,
      host: plan.identity.host,
      layout: baseline.layout,
      mode: baseline.mode,
      profileTier: baseline.profileTier
    },
    intent: {
      finalIntent: plan.identity.finalIntent,
      riskHint: plan.identity.intentSeed.riskHint,
      confidenceClass: plan.identity.intentSeed.confidence < 0.6 ? 'low' : 'normal',
      actionEnvelope: deepClone(plan.actionEnvelope),
      changeTypes: [...plan.changeTypes]
    },
    baseline: { readmeIdentity, configIdentity, candidateIdentity },
    executionOptimization: deepClone(plan.executionOptimization),
    selectedSources: plan.selectedSources.map(source => ({
      sourceId: source.sourceId,
      kind: source.kind,
      selector: source.selector,
      mandatory: source.mandatory,
      authority: source.authority,
      sourceLayer: source.sourceLayer,
      reasonCode: source.reasonCode,
      metadataIdentity: planSourceIdentity(source)
    })),
    excludedSources: plan.excludedSources.map(source => ({
      sourceId: source.sourceId,
      selector: source.selector,
      reasonCode: source.reasonCode
    })),
    queries: [...plan.memory.requiredQueries],
    resolution: {
      selectedIds: [...plan.catalogCoverage.selectedIds],
      excludedIds: [...plan.catalogCoverage.excludedIds],
      unclassifiedIds: [...plan.catalogCoverage.unclassifiedIds],
      triggeredEscalations: [...plan.triggeredEscalations],
      exitCondition: plan.exitCondition,
      fullRead: plan.fullRead,
      configLocalRequested: plan.profile.configLocalRequested,
      profileRouteLoadRecipe: deepClone(plan.profile.routeLoadRecipe || null)
    },
    versions: normalizeIdentityVersions()
  }
}

function buildContextReadBinding(plan) {
  return {
    schemaVersion: 'ContextReadBindingV1',
    contextEpoch: plan.identity.contextEpoch,
    planId: plan.planId,
    planContentId: plan.planContentId,
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project
  }
}

function refreshPlannerResponseBytes(plan) {
  let observed = 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    plan.stageTiming.plannerResponseBytes = observed
    const next = Buffer.byteLength(JSON.stringify(plan, null, 2), 'utf8')
    if (next === observed) break
    observed = next
  }
  plan.stageTiming.plannerResponseBytes = Buffer.byteLength(JSON.stringify(plan, null, 2), 'utf8')
  return plan
}

function normalizeIntentSeed(raw = {}, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return buildContextReadError('CONTEXT_INTENT_REQUIRED', 'Intent seed must be an object.', 'Provide a canonical intent.')
  }
  const unknown = Object.keys(raw).filter(key => !SEED_FIELDS.has(key))
  if (unknown.length) {
    return buildContextReadError(
      'CONTEXT_PLAN_INVALID',
      `IntentSeedV1 contains unsupported fields: ${unknown.join(', ')}.`,
      'Remove sibling contract fields before planning.'
    )
  }
  if (raw.schemaVersion && raw.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.intentSeed) {
    return buildContextReadError('CONTEXT_PLAN_INVALID', 'Intent seed discriminator is invalid.', 'Use IntentSeedV1.')
  }
  const semantic = String(raw.semantic || raw.intent || '').trim()
  if (!semantic) {
    return buildContextReadError('CONTEXT_INTENT_REQUIRED', 'Canonical intent is required.', 'Provide one supported top-level intent.')
  }
  if (!INTENTS.has(semantic) || (raw.semantic && raw.intent && raw.semantic !== raw.intent)) {
    return buildContextReadError('CONTEXT_INTENT_INVALID', `Unsupported canonical intent: ${semantic}.`, 'Use a documented canonical intent.')
  }
  const riskHint = String(raw.riskHint || 'normal')
  if (!RISKS.has(riskHint)) {
    return buildContextReadError('CONTEXT_PLAN_INVALID', `Invalid riskHint: ${riskHint}.`, 'Use normal, high, or critical.')
  }
  const confidence = raw.confidence === undefined ? 1 : Number(raw.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return buildContextReadError('CONTEXT_PLAN_INVALID', 'confidence must be between 0 and 1.', 'Provide a bounded confidence value.')
  }
  const createdAt = validIso(raw.createdAt) ? new Date(Date.parse(raw.createdAt)).toISOString() : nowIso(options)
  const targetHint = typeof raw.targetHint === 'string' && raw.targetHint.trim() ? raw.targetHint.trim() : null
  const contextEpoch = String(raw.contextEpoch || options.contextEpoch || '').trim() ||
    `ctx-${stableDigest({ semantic, targetHint, createdAt }).slice(0, 20)}`
  return {
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.intentSeed,
    contextEpoch,
    semantic,
    targetHint,
    continuationHint: raw.continuationHint === true,
    riskHint,
    confidence,
    createdAt
  }
}

function normalizeSourceRef(raw = {}) {
  const normalized = {
    path: normalizePath(raw.path),
    layer: String(raw.layer || '').trim(),
    exists: raw.exists === true,
    size: finiteOrNull(raw.size),
    mtimeMs: finiteOrNull(raw.mtimeMs)
  }
  if (!normalized.path || !normalized.layer) return { error: 'source ref requires path and layer' }
  const expectedDigest = stableDigest(normalized)
  if (raw.metadataDigest && raw.metadataDigest !== expectedDigest) return { error: `metadataDigest mismatch for ${normalized.path}` }
  return { value: { ...normalized, metadataDigest: expectedDigest } }
}

function normalizeSourceRefs(value) {
  const refs = []
  for (const raw of Array.isArray(value) ? value : []) {
    const result = normalizeSourceRef(raw)
    if (result.error) return result
    refs.push(result.value)
  }
  refs.sort((left, right) => compareText(`${left.layer}:${left.path}`, `${right.layer}:${right.path}`))
  return { value: refs }
}

function normalizeBaselineContext(raw = {}, identity = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'baselineContext must be an object' }
  const readmeRaw = typeof raw.readme === 'string' ? { content: raw.readme } : (raw.readme || {})
  const readmeRefs = normalizeSourceRefs(readmeRaw.sourceRefs || raw.readmeSourceRefs)
  const configRefs = normalizeSourceRefs(raw.configSourceRefs)
  if (readmeRefs.error || configRefs.error) return { error: readmeRefs.error || configRefs.error }
  if (typeof readmeRaw.content !== 'string' || !readmeRaw.content.length) return { error: 'baseline README content is required' }
  if (!readmeRefs.value.length) return { error: 'baseline README sourceRefs are required' }
  if (!readmeRefs.value.some(ref => ref.exists)) return { error: 'baseline README must have an existing authoritative source ref' }
  if (!raw.effectiveConfig || typeof raw.effectiveConfig !== 'object' || Array.isArray(raw.effectiveConfig)) {
    return { error: 'effectiveConfig must be an object' }
  }
  if (!configRefs.value.length) return { error: 'effective config sourceRefs are required' }
  const catalog = Array.isArray(raw.catalog) ? deepClone(raw.catalog) : []
  const inventory = Array.isArray(raw.inventory) ? deepClone(raw.inventory) : []
  catalog.sort((left, right) => compareText(profileFileFrom(left), profileFileFrom(right)))
  inventory.sort((left, right) => compareText(profileFileFrom(left), profileFileFrom(right)))
  if (new Set(catalog.map(profileFileFrom)).size !== catalog.length) return { error: 'catalog contains duplicate Profile candidates' }
  if (new Set(inventory.map(profileFileFrom)).size !== inventory.length) return { error: 'inventory contains duplicate Profile candidates' }
  const value = {
    layout: String(raw.layout || 'legacy'),
    project: String(raw.project || identity.project || ''),
    mode: String(raw.mode || 'prod'),
    agent: String(raw.agent || 'generic'),
    profileTier: String(raw.profileTier || 'minimal'),
    effectiveConfig: deepClone(raw.effectiveConfig),
    readme: { content: readmeRaw.content, sourceRefs: readmeRefs.value },
    configSourceRefs: configRefs.value,
    catalog,
    inventory
  }
  if (!value.project) return { error: 'baseline project is required' }
  value.baselineDigest = stableDigest(value)
  if (raw.baselineDigest && raw.baselineDigest !== value.baselineDigest) return { error: 'baselineDigest mismatch' }
  return { value }
}

function profileFileFrom(raw = {}) {
  return String(raw.file || raw.name || raw.selector || '').trim()
}

function profileSourceId(file) {
  return `profile:${file}`
}

function collectProfileCandidates(baseline, explicitCandidates = []) {
  const byFile = new Map()
  const merge = (raw, origin) => {
    const file = profileFileFrom(raw)
    if (!safeProfileFile(file)) return
    const prior = byFile.get(file) || { file, sourceId: profileSourceId(file) }
    const merged = { ...prior, ...deepClone(raw), file, sourceId: profileSourceId(file) }
    if (origin === 'catalog') merged.cataloged = true
    if (origin === 'inventory') merged.inventoried = true
    if (raw.required === true || raw.requiredToExist === true) merged.requiredToExist = true
    byFile.set(file, merged)
  }
  baseline.catalog.forEach(item => merge(item, 'catalog'))
  baseline.inventory.forEach(item => merge(item, 'inventory'))
  ;(Array.isArray(explicitCandidates) ? explicitCandidates : []).forEach(item => merge(item, 'explicit'))

  const candidates = []
  for (const raw of byFile.values()) {
    const candidateRefs = raw.sourceRefs || (raw.path ? [raw] : [])
    const normalizedRefs = normalizeSourceRefs(candidateRefs)
    if (normalizedRefs.error) return { error: normalizedRefs.error }
    const refs = normalizedRefs.value.length
      ? normalizedRefs.value
      : [normalizeSourceRef({
          path: `profile://${raw.file}`,
          layer: String(raw.sourceLayer || 'profile-metadata'),
          exists: raw.exists === true,
          size: raw.size,
          mtimeMs: raw.mtimeMs
        }).value]
    candidates.push({
      sourceId: String(raw.sourceId || profileSourceId(raw.file)),
      kind: raw.file === 'config.local.json' ? 'profile-local' : 'profile',
      selector: raw.file,
      mandatory: false,
      authority: String(raw.authority || (raw.cataloged ? 'profile-catalog' : 'profile-inventory')),
      reason: String(raw.reason || 'Profile candidate discovered from bounded baseline metadata.'),
      sourceLayer: String(raw.sourceLayer || [...new Set(refs.map(ref => ref.layer))].join('+') || 'profile'),
      sourceRefs: refs,
      cataloged: raw.cataloged === true,
      inventoried: raw.inventoried === true,
      requiredToExist: raw.requiredToExist === true,
      standard: raw.standard === true || /^\d{2}-.+\.md$/i.test(raw.file),
      exists: refs.some(ref => ref.exists)
    })
  }
  candidates.sort((left, right) => compareText(left.selector, right.selector))
  return { value: candidates }
}

function sourceDescriptor(input) {
  return {
    sourceId: input.sourceId,
    kind: input.kind,
    selector: input.selector,
    mandatory: input.mandatory === true,
    authority: input.authority,
    reason: input.reason,
    reasonCode: REASON_CODES.has(input.reasonCode) ? input.reasonCode : 'intent-change-type',
    sourceLayer: input.sourceLayer,
    sourceRefs: deepClone(input.sourceRefs)
  }
}

function baselineSources(baseline) {
  return [
    sourceDescriptor({
      sourceId: profileSourceId('README.md'),
      kind: 'profile-baseline',
      selector: 'README.md',
      mandatory: true,
      authority: 'lossless-plan-baseline',
      reason: 'The Profile index must be delivered losslessly in the plan result.',
      reasonCode: 'baseline-readme',
      sourceLayer: [...new Set(baseline.readme.sourceRefs.map(ref => ref.layer))].join('+'),
      sourceRefs: baseline.readme.sourceRefs
    }),
    sourceDescriptor({
      sourceId: profileSourceId('config.json'),
      kind: 'profile-baseline',
      selector: 'config.json',
      mandatory: true,
      authority: 'effective-non-local-config',
      reason: 'Effective non-local Profile configuration is part of the lossless baseline.',
      reasonCode: 'baseline-config',
      sourceLayer: [...new Set(baseline.configSourceRefs.map(ref => ref.layer))].join('+'),
      sourceRefs: baseline.configSourceRefs
    })
  ]
}

function memorySource(toolName, project, options = {}) {
  const ref = normalizeSourceRef({
    path: `memory://${project}/${toolName}`,
    layer: 'memory-query',
    exists: true,
    size: null,
    mtimeMs: null
  }).value
  return sourceDescriptor({
    sourceId: `memory:${toolName}`,
    kind: 'memory',
    selector: toolName,
    mandatory: options.mandatory !== false,
    authority: 'bounded-memory-query',
    reason: toolName === 'memory_status'
      ? 'Compact task continuity metadata is required for every planned acquisition.'
      : 'Resume requires an exact bounded session or handoff projection.',
    reasonCode: toolName === 'memory_status' ? 'memory-status' : 'memory-session',
    sourceLayer: 'memory-query',
    sourceRefs: [ref]
  })
}

function selectProfilePrefixes(intent, changeTypes) {
  const prefixes = new Set()
  const add = (...values) => values.forEach(value => prefixes.add(value))
  for (const changeType of changeTypes) {
    if (changeType === 'project-info') add('01-')
    if (changeType === 'architecture' || changeType === 'source-code') add('02-')
    if (changeType === 'code-style') add('03-')
    if (changeType === 'testing') add('04-')
    if (changeType === 'feature-state') add('06-')
    if (changeType === 'config') add('01-', '02-')
    if (changeType === 'docs') add('01-', '02-', '03-', '07-')
    if (changeType === 'public-contract') add('01-', '02-', '03-', '04-', '06-', '07-')
    if (changeType === 'release') add('01-', '04-', '05-', '06-', '07-')
  }
  if (['dev', 'fix', 'self-fix', 'other'].includes(intent) &&
      changeTypes.some(item => ['project-info', 'architecture', 'code-style', 'source-code', 'config'].includes(item))) {
    add('01-', '02-', '03-')
  }
  if (changeTypes.includes('release') && changeTypes.some(item => ['architecture', 'code-style', 'source-code'].includes(item))) {
    add('02-', '03-')
  }
  return prefixes
}

function deriveActionEnvelope(intent, changeTypes, riskHint) {
  const allowed = new Set(['context-read', 'analysis-read'])
  if (intent !== 'chat') {
    allowed.add('test-execution')
    allowed.add('workflow-closeout')
  }
  const mutationIntent = ['dev', 'fix', 'self-fix', 'other'].includes(intent)
  const docsMutation = mutationIntent && changeTypes.some(item => ['docs', 'public-contract'].includes(item))
  const sourceMutation = mutationIntent &&
    changeTypes.some(item => !['docs'].includes(item))
  if (docsMutation) allowed.add('docs-mutation')
  if (sourceMutation) allowed.add('source-mutation')
  if (changeTypes.includes('release')) allowed.add('release')
  if (changeTypes.includes('destructive')) allowed.add('dangerous')
  return {
    allowedActionClasses: [...allowed].sort(),
    mutationExpected: allowed.has('docs-mutation') || allowed.has('source-mutation') || allowed.has('workflow-closeout') || allowed.has('release') || allowed.has('dangerous'),
    riskCeiling: riskHint
  }
}

function buildContextReadPlan(input = {}, options = {}) {
  const seed = normalizeIntentSeed(input.intentSeed || input.seed || input, options)
  if (seed.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return seed
  const identityInput = input.identity && typeof input.identity === 'object' ? input.identity : {}
  const activeRoot = normalizePath(identityInput.activeRoot || input.activeRoot)
  const project = String(identityInput.project || input.project || seed.targetHint || '').trim()
  const host = String(identityInput.host || input.host || 'standalone').trim()
  const finalIntent = String(identityInput.finalIntent || input.finalIntent || seed.semantic).trim()
  if (!activeRoot || !project || !INTENTS.has(finalIntent)) {
    return buildContextReadError('CONTEXT_ACTIVE_TARGET_MISMATCH', 'A unique activeRoot, project, and finalIntent are required.', 'Resolve the active target before planning.')
  }
  const changeTypes = uniqueSorted(input.changeTypes, CHANGE_TYPES)
  const suppliedChangeTypes = Array.isArray(input.changeTypes) ? input.changeTypes.map(String) : []
  if (changeTypes.length !== new Set(suppliedChangeTypes).size || suppliedChangeTypes.some(item => !CHANGE_TYPES.has(item))) {
    return buildContextReadError('CONTEXT_PLAN_INVALID', 'changeTypes contains an unsupported or duplicate value.', 'Use stable ContextReadPlanV2 change types.')
  }
  const lowConfidence = seed.confidence < 0.6
  if (!changeTypes.length && !['chat', 'resume'].includes(finalIntent) && !input.explicitFull && !lowConfidence) {
    return buildContextReadError('CONTEXT_CHANGE_TYPES_REQUIRED', 'High-confidence non-chat work requires changeTypes or explicitFull.', 'Provide precise changeTypes or an explicit full-read reason.')
  }
  if (input.explicitFull === true && !String(input.fullReadReason || '').trim()) {
    return buildContextReadError('CONTEXT_FULL_REASON_REQUIRED', 'Explicit full Profile reads require a reason.', 'Provide fullReadReason.')
  }

  const baselineResult = normalizeBaselineContext(input.baselineContext, { project })
  if (baselineResult.error) {
    const stale = /Digest mismatch/i.test(baselineResult.error)
    return buildContextReadError(
      stale ? 'CONTEXT_BASELINE_STALE' : 'CONTEXT_PLAN_INVALID',
      baselineResult.error,
      'Rebuild and deliver the complete Profile baseline.'
    )
  }
  const baseline = baselineResult.value
  if (baseline.project !== project) {
    return buildContextReadError('CONTEXT_ACTIVE_TARGET_MISMATCH', 'Baseline project does not match the active target.', 'Resolve the active project before planning.')
  }
  const candidatesResult = collectProfileCandidates(baseline, input.candidates || input.sources)
  if (candidatesResult.error) {
    return buildContextReadError('CONTEXT_PLAN_INVALID', candidatesResult.error, 'Correct Profile source metadata.')
  }
  const candidates = candidatesResult.value
  const selectors = Array.isArray(input.profileSelectors) ? input.profileSelectors : []
  if (selectors.length && input.baselineDigest !== baseline.baselineDigest) {
    return buildContextReadError('CONTEXT_BASELINE_STALE', 'profileSelectors were based on a stale or missing baselineDigest.', 'Refresh the baseline and retry the conditional plan once.')
  }
  const selectorByFile = new Map()
  for (const selector of selectors) {
    const file = profileFileFrom(selector)
    if (!safeProfileFile(file) || !String(selector.reason || '').trim() || !String(selector.authority || '').trim()) {
      return buildContextReadError('CONTEXT_PLAN_INVALID', 'Each profileSelector needs a safe file, reason, and authority.', 'Correct the conditional selector.')
    }
    if (!candidates.some(candidate => candidate.selector === file)) {
      return buildContextReadError('CONTEXT_PLAN_INVALID', `Unknown profileSelector: ${file}.`, 'Select only a catalog or inventory candidate.')
    }
    if (file === 'config.local.json' && input.configLocalRequested !== true) {
      return buildContextReadError('CONTEXT_PLAN_INVALID', 'config.local.json requires explicit user or project policy.', 'Set configLocalRequested only when that policy exists.')
    }
    selectorByFile.set(file, selector)
  }

  const triggerSet = new Set(uniqueSorted(input.escalationTriggers, new Set(CONTEXT_READ_CONTRACT.escalationTriggers)))
  if (input.explicitFull === true || finalIntent === 'audit') triggerSet.add('explicit-full')
  if (lowConfidence) triggerSet.add('low-confidence')
  if (input.crossService === true) triggerSet.add('cross-service')
  if (changeTypes.includes('public-contract')) triggerSet.add('public-contract')
  for (const trigger of ['release', 'security', 'destructive']) {
    if (changeTypes.includes(trigger)) triggerSet.add(trigger)
  }
  const fullRead = input.explicitFull === true || finalIntent === 'audit' || lowConfidence || input.crossService === true ||
    changeTypes.some(item => ['release', 'security', 'destructive'].includes(item))
  const automaticFullReason = input.explicitFull === true
    ? String(input.fullReadReason).trim()
    : finalIntent === 'audit'
      ? 'audit-intent'
      : lowConfidence
        ? 'low-confidence'
        : input.crossService === true
          ? 'cross-service'
          : changeTypes.find(item => ['release', 'security', 'destructive'].includes(item)) || null

  const selectedFiles = new Set()
  const prefixes = selectProfilePrefixes(finalIntent, changeTypes)
  for (const candidate of candidates) {
    if (candidate.selector === 'README.md' || candidate.selector === 'config.json') continue
    if (candidate.selector === 'config.local.json') {
      if (input.configLocalRequested === true && (fullRead || selectorByFile.has(candidate.selector) || changeTypes.includes('config'))) {
        selectedFiles.add(candidate.selector)
      }
      continue
    }
    if (selectorByFile.has(candidate.selector)) selectedFiles.add(candidate.selector)
    if (candidate.cataloged && fullRead && candidate.standard) selectedFiles.add(candidate.selector)
    if (candidate.cataloged && [...prefixes].some(prefix => candidate.selector.startsWith(prefix))) selectedFiles.add(candidate.selector)
  }

  const baselineSelected = baselineSources(baseline)
  const selectedSources = [...baselineSelected]
  for (const candidate of candidates) {
    if (!selectedFiles.has(candidate.selector)) continue
    const selector = selectorByFile.get(candidate.selector)
    selectedSources.push(sourceDescriptor({
      ...candidate,
      mandatory: true,
      authority: selector ? String(selector.authority).trim() : candidate.authority,
      reason: selector ? String(selector.reason).trim() : `Required by ${finalIntent}/${changeTypes.join('+') || 'full-read'} context.`,
      reasonCode: selector ? 'explicit-selector' : (fullRead ? 'full-read' : 'intent-change-type')
    }))
  }
  selectedSources.push(memorySource('memory_status', project))
  if (finalIntent === 'resume') {
    selectedSources.push(memorySource('memory_session_query', project))
    selectedSources.push(memorySource('memory_summary_query', project, { mandatory: false }))
  }
  selectedSources.sort((left, right) => compareText(left.sourceId, right.sourceId))

  const selectedIds = new Set(selectedSources.map(source => source.sourceId))
  const unclassifiedIds = []
  const excludedSources = []
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.sourceId)) continue
    const uncataloguedMarkdown = candidate.selector.toLowerCase().endsWith('.md') && !candidate.cataloged
    if (uncataloguedMarkdown) {
      unclassifiedIds.push(candidate.sourceId)
      continue
    }
    let skipReason = `The ${finalIntent}/${changeTypes.join('+') || 'baseline-only'} plan does not require ${candidate.selector} content.`
    let reasonCode = 'excluded-no-match'
    if (candidate.selector === 'config.local.json') {
      skipReason = 'No explicit user or project policy requested config.local.json content.'
      reasonCode = 'excluded-local-policy'
    } else if (candidate.standard) {
      skipReason = `No matching changeType or profileSelector requires ${candidate.selector}.`
    } else if (!candidate.selector.toLowerCase().endsWith('.md')) {
      skipReason = `${candidate.selector} is metadata-only for this context plan.`
      reasonCode = 'excluded-metadata-only'
    }
    excludedSources.push({ sourceId: candidate.sourceId, selector: candidate.selector, skipReason, reasonCode })
  }
  if (unclassifiedIds.length) triggerSet.add('profile-catalog-drift')

  const existenceSources = candidates
    .filter(candidate => candidate.requiredToExist)
    .map(candidate => ({
      sourceId: candidate.sourceId,
      selector: candidate.selector,
      required: true,
      exists: candidate.exists,
      metadataDigests: candidate.sourceRefs.map(ref => ref.metadataDigest)
    }))
    .sort((left, right) => compareText(left.sourceId, right.sourceId))
  const missingRequired = existenceSources.filter(source => !source.exists)
  if (missingRequired.length) triggerSet.add('missing-reference')

  const candidateIds = candidates.map(candidate => candidate.sourceId).sort()
  const coverageSelected = candidateIds.filter(sourceId => selectedIds.has(sourceId))
  const coverageExcluded = excludedSources.map(source => source.sourceId).sort()
  const blocked = missingRequired.length > 0 || unclassifiedIds.length > 0
  const planningMeasure = measureContextPayload({ seed, activeRoot, project, changeTypes, baselineDigest: baseline.baselineDigest }, {
    latencyMs: input.planningTelemetry?.latencyMs,
    tokens: input.planningTelemetry?.inputTokens
  })
  const invocationNonce = String(input.invocationNonce || options.invocationNonce || crypto.randomUUID()).trim()
  if (!invocationNonce) {
    return buildContextReadError('CONTEXT_PLAN_INVALID', 'ContextReadPlanV2 requires an invocation nonce.', 'Create a fresh invocation identity and retry.')
  }
  const normalizedRouteRecipe = normalizeProfileRouteLoadRecipe(
    input.profileRouteLoadRecipe,
    [...selectedFiles].sort()
  )
  if (!normalizedRouteRecipe.valid) {
    return buildContextReadError(
      'CONTEXT_PLAN_INVALID',
      `profileRouteLoadRecipe is invalid: ${normalizedRouteRecipe.errors.join(', ')}.`,
      'Regenerate the bounded route recipe from the resolved Profile target.'
    )
  }
  const plan = {
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.plan,
    planId: '',
    planContentId: '',
    identity: {
      contextEpoch: seed.contextEpoch,
      activeRoot,
      project,
      host,
      intentSeed: seed,
      finalIntent,
      invocationNonce
    },
    contextBinding: null,
    exitCondition: blocked ? 'blocked' : (fullRead ? 'escalated-full' : 'relevant-complete'),
    profile: {
      selectedFiles: [...selectedFiles].sort(),
      configLocalRequested: input.configLocalRequested === true,
      routeLoadRecipe: normalizedRouteRecipe.value
    },
    memory: {
      requiredQueries: selectedSources
        .filter(source => source.kind === 'memory' && source.mandatory)
        .map(source => source.selector)
        .sort()
    },
    fullRead,
    fullReadReason: fullRead ? automaticFullReason : null,
    baselineContext: baseline,
    actionEnvelope: deriveActionEnvelope(finalIntent, changeTypes, seed.riskHint),
    changeTypes,
    selectedSources,
    mandatorySourceIds: selectedSources.filter(source => source.mandatory).map(source => source.sourceId).sort(),
    excludedSources: excludedSources.sort((left, right) => compareText(left.sourceId, right.sourceId)),
    catalogCoverage: {
      selectedIds: coverageSelected,
      excludedIds: coverageExcluded,
      unclassifiedIds: unclassifiedIds.sort()
    },
    existenceSources,
    freshness: {
      strategy: 'content-identity+metadata',
      reuse: true,
      invalidators: [
        'active-root', 'config-digest', 'consumer-version', 'context-epoch', 'host-session',
        'intent-action-risk', 'profile-metadata', 'route-version', 'schema-version',
        'source-digest', 'tool-version'
      ]
    },
    budget: {
      bytes: finiteOrNull(input.budget?.bytes),
      chars: finiteOrNull(input.budget?.chars),
      tokens: finiteOrNull(input.budget?.tokens),
      latencyMs: finiteOrNull(input.budget?.latencyMs),
      // FIX-06: default advisory; allow force when budget.force === true (ABS-06)
      advisory: input.budget?.force === true ? false : true,
      force: input.budget?.force === true
    },
    escalationTriggers: uniqueSorted(CONTEXT_READ_CONTRACT.escalationTriggers),
    triggeredEscalations: [...triggerSet].sort(),
    planningTelemetry: {
      bytes: planningMeasure.bytes,
      chars: planningMeasure.chars,
      latencyMs: planningMeasure.latencyMs,
      inputTokens: planningMeasure.tokens
    },
    executionOptimization: buildExecutionOptimizationPlanBinding(baseline.effectiveConfig, { project }),
    identityInputs: null,
    reusePolicy: buildReusePolicy(),
    stageTiming: normalizeStageTiming(input.stageTiming || input.planningTelemetry, {
      plannerInputBytes: planningMeasure.bytes,
      selectedSourceBytes: sumSelectedSourceBytes(selectedSources),
      returnedBodyBytes: Buffer.byteLength(baseline.readme.content, 'utf8') +
        Buffer.byteLength(stableStringify(baseline.effectiveConfig), 'utf8'),
      latencyMs: planningMeasure.latencyMs,
      tokens: planningMeasure.tokens
    }),
    cacheDecision: normalizeCacheDecision(input.cacheDecision)
  }
  plan.identityInputs = buildPlanIdentityInputs(plan)
  plan.planContentId = `plan-content-${stableDigest(plan.identityInputs)}`
  plan.cacheDecision = normalizeCacheDecision(input.cacheDecision, plan.planContentId)
  plan.planId = `plan-${stableDigest({
    planContentId: plan.planContentId,
    contextEpoch: seed.contextEpoch,
    invocationNonce
  }).slice(0, 24)}`
  plan.contextBinding = buildContextReadBinding(plan)
  refreshPlannerResponseBytes(plan)
  const validation = validateContextReadPlan(plan)
  return validation.valid ? plan : validation.error
}

function validateContextReadPlan(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) errors.push('plan must be an object')
  if (errors.length) return { valid: false, errors, error: buildContextReadError('CONTEXT_PLAN_INVALID', errors[0]) }
  const isV2 = raw.schemaVersion === CONTEXT_READ_CONTRACT.schemas.plan
  const isV1 = raw.schemaVersion === CONTEXT_READ_CONTRACT.schemas.planV1
  if (!isV1 && !isV2) errors.push('invalid plan discriminator')
  const allowedFields = isV1 ? PLAN_V1_FIELDS : PLAN_FIELDS
  const unknown = Object.keys(raw).filter(key => !allowedFields.has(key))
  if (unknown.length) errors.push(`unsupported plan fields: ${unknown.join(', ')}`)
  for (const foreign of ['observations', 'completedAt', 'consumedAt', 'satisfiedSourceIds', 'missingSourceIds']) {
    if (Object.prototype.hasOwnProperty.call(raw, foreign)) errors.push(`receipt-only field present: ${foreign}`)
  }
  const identity = raw.identity && typeof raw.identity === 'object' ? raw.identity : {}
  const seed = normalizeIntentSeed(identity.intentSeed || {})
  if (seed.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error || stableDigest(seed) !== stableDigest(identity.intentSeed)) {
    errors.push('identity.intentSeed is invalid or non-canonical')
  }
  if (!identity.contextEpoch || identity.contextEpoch !== identity.intentSeed?.contextEpoch) errors.push('identity epoch mismatch')
  if (isV2 && !String(identity.invocationNonce || '').trim()) errors.push('identity invocation nonce is required')
  if (!normalizePath(identity.activeRoot) || !String(identity.project || '').trim() ||
      !String(identity.host || '').trim() || !INTENTS.has(identity.finalIntent)) {
    errors.push('identity target is incomplete')
  }
  const baselineResult = normalizeBaselineContext(raw.baselineContext, { project: identity.project })
  if (baselineResult.error) errors.push(`invalid baselineContext: ${baselineResult.error}`)
  else if (stableDigest(baselineResult.value) !== stableDigest(raw.baselineContext)) errors.push('baselineContext is non-canonical')
  if (raw.baselineContext?.project !== identity.project) errors.push('baseline project does not match plan identity')

  const changeTypes = uniqueSorted(raw.changeTypes, CHANGE_TYPES)
  if (!Array.isArray(raw.changeTypes) || stableDigest(changeTypes) !== stableDigest(raw.changeTypes)) errors.push('changeTypes must be sorted, unique, and valid')
  if (identity.intentSeed?.confidence >= 0.6 && !['chat', 'resume'].includes(identity.finalIntent) && !changeTypes.length && raw.fullRead !== true) {
    errors.push('high-confidence non-chat plan lacks changeTypes')
  }
  const envelope = raw.actionEnvelope && typeof raw.actionEnvelope === 'object' ? raw.actionEnvelope : {}
  const allowedActions = uniqueSorted(envelope.allowedActionClasses, ACTION_CLASSES)
  if (!allowedActions.length || stableDigest(allowedActions) !== stableDigest(envelope.allowedActionClasses)) errors.push('invalid actionEnvelope actions')
  if (typeof envelope.mutationExpected !== 'boolean' || !RISKS.has(envelope.riskCeiling)) errors.push('invalid actionEnvelope metadata')
  const expectedEnvelope = deriveActionEnvelope(identity.finalIntent, changeTypes, identity.intentSeed?.riskHint)
  if (stableDigest(expectedEnvelope) !== stableDigest(envelope)) errors.push('actionEnvelope is not derived from intent scope')

  const selected = Array.isArray(raw.selectedSources) ? raw.selectedSources : []
  if (!selected.length) errors.push('selectedSources must be non-empty')
  const selectedIdSet = new Set()
  for (const source of selected) {
    if (!source || typeof source !== 'object') {
      errors.push('selected source must be an object')
      continue
    }
    if (!source.sourceId || selectedIdSet.has(source.sourceId)) errors.push(`duplicate or missing selected sourceId: ${source.sourceId || '<empty>'}`)
    selectedIdSet.add(source.sourceId)
    if (!source.kind || !source.selector || typeof source.mandatory !== 'boolean' || !source.authority || !source.reason || !source.sourceLayer) {
      errors.push(`selected source fields incomplete: ${source.sourceId || '<empty>'}`)
    }
    if (isV2 && !REASON_CODES.has(source.reasonCode)) errors.push(`selected source reasonCode invalid: ${source.sourceId || '<empty>'}`)
    const refs = normalizeSourceRefs(source.sourceRefs)
    if (refs.error || !refs.value?.length || stableDigest(refs.value) !== stableDigest(source.sourceRefs)) {
      errors.push(`selected source refs invalid: ${source.sourceId || '<empty>'}`)
    }
    if (source.kind.startsWith('profile') && !safeProfileFile(source.selector)) errors.push(`unsafe Profile selector: ${source.selector}`)
  }
  const derivedMandatory = selected.filter(source => source?.mandatory === true).map(source => source.sourceId).sort()
  if (!derivedMandatory.length || stableDigest(derivedMandatory) !== stableDigest(raw.mandatorySourceIds)) {
    errors.push('mandatorySourceIds is not derived from selectedSources')
  }
  for (const requiredBaseline of [profileSourceId('README.md'), profileSourceId('config.json')]) {
    const source = selected.find(item => item.sourceId === requiredBaseline)
    if (!source || source.kind !== 'profile-baseline' || source.mandatory !== true) errors.push(`missing lossless baseline source: ${requiredBaseline}`)
  }

  const excluded = Array.isArray(raw.excludedSources) ? raw.excludedSources : []
  const excludedIds = []
  for (const source of excluded) {
    const reason = String(source?.skipReason || '').trim()
    if (!source?.sourceId || !source.selector || !reason || /^(not needed|暂不需要)$/i.test(reason)) errors.push('excluded source requires an independent skipReason')
    if (isV2 && !REASON_CODES.has(source?.reasonCode)) errors.push(`excluded source reasonCode invalid: ${source?.sourceId || '<empty>'}`)
    excludedIds.push(source?.sourceId)
  }
  if (new Set(excludedIds).size !== excludedIds.length) errors.push('duplicate excluded sourceId')
  const coverage = raw.catalogCoverage && typeof raw.catalogCoverage === 'object' ? raw.catalogCoverage : {}
  const coverageSelected = uniqueSorted(coverage.selectedIds)
  const coverageExcluded = uniqueSorted(coverage.excludedIds)
  const coverageUnclassified = uniqueSorted(coverage.unclassifiedIds)
  if ([...coverageSelected, ...coverageExcluded, ...coverageUnclassified].length !==
      new Set([...coverageSelected, ...coverageExcluded, ...coverageUnclassified]).size) {
    errors.push('catalog coverage classes overlap')
  }
  if (coverageSelected.some(id => !selectedIdSet.has(id))) errors.push('catalog selectedIds is not selected')
  if (stableDigest(coverageExcluded) !== stableDigest(uniqueSorted(excludedIds))) errors.push('catalog excludedIds mismatch')
  const universe = []
  for (const entry of [...(raw.baselineContext?.catalog || []), ...(raw.baselineContext?.inventory || [])]) {
    const file = profileFileFrom(entry)
    if (!safeProfileFile(file)) errors.push(`unsafe baseline candidate: ${file || '<empty>'}`)
    else universe.push(profileSourceId(file))
  }
  const coverageUnion = uniqueSorted([...coverageSelected, ...coverageExcluded, ...coverageUnclassified])
  if (stableDigest(coverageUnion) !== stableDigest(uniqueSorted(universe))) errors.push('catalog coverage does not partition the baseline candidate universe')
  if (coverageUnclassified.length && raw.exitCondition !== 'blocked') errors.push('unclassified Profile candidates require a blocked plan')

  if (!['relevant-complete', 'escalated-full', 'blocked'].includes(raw.exitCondition)) errors.push('invalid exitCondition')
  if (raw.fullRead === true && !String(raw.fullReadReason || '').trim()) errors.push('fullReadReason is required')
  if (raw.fullRead !== true && raw.fullReadReason !== null) errors.push('targeted plan must not carry fullReadReason')
  if (raw.fullRead === true && raw.exitCondition === 'relevant-complete') errors.push('full plan must use escalated-full or blocked exit')
  if (raw.fullRead !== true && raw.exitCondition === 'escalated-full') errors.push('targeted plan cannot use escalated-full exit')
  const selectedProfileFiles = selected
    .filter(source => ['profile', 'profile-local'].includes(source.kind))
    .map(source => source.selector)
    .sort()
  const routeRecipe = normalizeProfileRouteLoadRecipe(raw.profile?.routeLoadRecipe, selectedProfileFiles)
  if (!routeRecipe.valid) errors.push(`profile routeLoadRecipe is invalid: ${routeRecipe.errors.join(', ')}`)
  if (raw.profile?.routeLoadRecipe !== undefined &&
      stableDigest(routeRecipe.value) !== stableDigest(raw.profile.routeLoadRecipe)) {
    errors.push('profile routeLoadRecipe is non-canonical')
  }
  if (stableDigest(selectedProfileFiles) !== stableDigest(raw.profile?.selectedFiles)) errors.push('profile.selectedFiles mismatch')
  if (typeof raw.profile?.configLocalRequested !== 'boolean') errors.push('profile configLocalRequested is required')
  if (selectedProfileFiles.includes('config.local.json') && raw.profile?.configLocalRequested !== true) errors.push('config.local.json selected without policy')
  const memoryQueries = selected
    .filter(source => source.kind === 'memory' && source.mandatory)
    .map(source => source.selector)
    .sort()
  if (stableDigest(memoryQueries) !== stableDigest(raw.memory?.requiredQueries)) errors.push('memory.requiredQueries mismatch')
  if (isV1) {
    if (raw.freshness?.strategy !== 'size+mtimeMs+metadataDigest' || raw.freshness?.reuse !== false) errors.push('invalid V1 freshness contract')
  } else if (raw.freshness?.strategy !== 'content-identity+metadata' || raw.freshness?.reuse !== true) {
    errors.push('invalid V2 freshness contract')
  }
  if (!raw.budget) errors.push('budget is required')
  else if (raw.budget.force === true) {
    if (raw.budget.advisory !== false) errors.push('budget.force requires advisory=false')
  } else if (raw.budget.advisory !== true) {
    errors.push('budget must be advisory unless force=true')
  }
  if (!raw.planningTelemetry || !Number.isFinite(raw.planningTelemetry.bytes) || !Number.isFinite(raw.planningTelemetry.chars)) {
    errors.push('planningTelemetry bytes/chars are required')
  }
  const escalationTriggers = uniqueSorted(raw.escalationTriggers, new Set(CONTEXT_READ_CONTRACT.escalationTriggers))
  const triggeredEscalations = uniqueSorted(raw.triggeredEscalations, new Set(CONTEXT_READ_CONTRACT.escalationTriggers))
  if (stableDigest(escalationTriggers) !== stableDigest(raw.escalationTriggers) ||
      stableDigest(triggeredEscalations) !== stableDigest(raw.triggeredEscalations)) {
    errors.push('escalation trigger arrays must be sorted, unique, and valid')
  }
  if (isV2) {
    const optimizationValidation = validateExecutionOptimizationPlanBinding(raw.executionOptimization, {
      effectiveConfig: raw.baselineContext?.effectiveConfig,
      project: identity.project
    })
    if (!optimizationValidation.valid) {
      errors.push(`executionOptimization is invalid: ${optimizationValidation.errors.join(', ')}`)
    }
    try {
      const expectedInputs = buildPlanIdentityInputs(raw)
      if (stableDigest(expectedInputs) !== stableDigest(raw.identityInputs)) errors.push('identityInputs is not derived from plan content')
      const expectedContentId = `plan-content-${stableDigest(expectedInputs)}`
      if (raw.planContentId !== expectedContentId) errors.push('planContentId digest mismatch')
      const expectedPlanId = `plan-${stableDigest({
        planContentId: expectedContentId,
        contextEpoch: identity.contextEpoch,
        invocationNonce: identity.invocationNonce
      }).slice(0, 24)}`
      if (raw.planId !== expectedPlanId) errors.push('planId invocation digest mismatch')
      if (stableDigest(raw.contextBinding) !== stableDigest(buildContextReadBinding(raw))) {
        errors.push('contextBinding is not derived from plan identity')
      }
    } catch (error) {
      errors.push(`identityInputs validation failed: ${error.message}`)
    }
    if (stableDigest(raw.reusePolicy) !== stableDigest(buildReusePolicy())) errors.push('reusePolicy contract mismatch')
    const stageTiming = normalizeStageTiming(raw.stageTiming)
    if (stableDigest(stageTiming) !== stableDigest(raw.stageTiming) || stageTiming.plannerResponseBytes === null) {
      errors.push('StageTimingV1 is missing or non-canonical')
    }
    const cacheDecision = normalizeCacheDecision(raw.cacheDecision, raw.planContentId)
    if (stableDigest(cacheDecision) !== stableDigest(raw.cacheDecision) || cacheDecision.bodyDeliverySkipped !== false) {
      errors.push('computation cache decision is missing or conflates body delivery')
    }
    if (cacheDecision.status === 'hit' && (!cacheDecision.scope || !cacheDecision.reusedArtifacts.length)) {
      errors.push('cache hit requires a scope and reused computation artifact')
    }
    if (cacheDecision.status !== 'hit' && cacheDecision.reusedArtifacts.length) {
      errors.push('non-hit cache decision cannot claim reused artifacts')
    }
  } else {
    const expectedPlanId = `plan-${stableDigest({ ...raw, planId: undefined, planningTelemetry: undefined }).slice(0, 24)}`
    if (raw.planId !== expectedPlanId) errors.push('planId digest mismatch')
  }
  return errors.length
    ? { valid: false, errors, error: buildContextReadError('CONTEXT_PLAN_INVALID', errors.join('; '), 'Rebuild the plan from authoritative baseline inputs.') }
    : { valid: true, errors: [], value: raw }
}

function legacyN1ActionEnvelope (plan) {
  const current = deriveActionEnvelope(
    plan.identity.finalIntent,
    uniqueSorted(plan.changeTypes, CHANGE_TYPES),
    plan.identity.intentSeed?.riskHint
  )
  const allowedActionClasses = current.allowedActionClasses
    .filter(item => item !== 'workflow-closeout')
  return {
    allowedActionClasses,
    mutationExpected: allowedActionClasses.some(item => [
      'docs-mutation',
      'source-mutation',
      'release',
      'dangerous'
    ].includes(item)),
    riskCeiling: current.riskCeiling
  }
}

function rebuildContextPlanIdentity (plan) {
  plan.identityInputs = buildPlanIdentityInputs(plan)
  plan.planContentId = `plan-content-${stableDigest(plan.identityInputs)}`
  plan.planId = `plan-${stableDigest({
    planContentId: plan.planContentId,
    contextEpoch: plan.identity.contextEpoch,
    invocationNonce: plan.identity.invocationNonce
  }).slice(0, 24)}`
  plan.contextBinding = buildContextReadBinding(plan)
  plan.cacheDecision = normalizeCacheDecision(plan.cacheDecision, plan.planContentId)
  refreshPlannerResponseBytes(plan)
  return plan
}

/**
 * Accept the current contract exactly, or migrate the single registered N-1
 * ContextReadPlan signature. This is intentionally not a general repair path.
 */
function normalizeCompatibleContextReadPlan (raw, options = {}) {
  const producerIdentity = options.producerIdentity || null
  let identityValidation = null
  if (producerIdentity) {
    try {
      identityValidation = require('./runtime-generation-identity.cjs')
        .validateRuntimeProcessIdentity(producerIdentity)
    } catch {
      identityValidation = { valid: false, reasonCode: 'process-identity-validator-unavailable' }
    }
    const producerVersion = producerIdentity.runtimeContractVersion
    const supportedVersion = producerVersion === CONTEXT_RUNTIME_CONTRACT_VERSION ||
      producerVersion === CONTEXT_RUNTIME_CONTRACT_VERSION - 1
    if (!identityValidation.valid || !supportedVersion) {
      return {
        valid: false,
        plan: null,
        status: 'refresh-required',
        receipt: null,
        error: buildContextReadError(
          'CONTEXT_PLAN_INVALID',
          `Runtime producer identity is outside the supported N-1 window: ${identityValidation.reasonCode || producerVersion}.`,
          'Start a new host session so Hook and MCP use the same installed runtime generation.'
        )
      }
    }
  }
  const exact = validateContextReadPlan(raw)
  if (exact.valid) {
    return {
      valid: true,
      plan: raw,
      status: 'exact',
      receipt: {
        schemaVersion: 'RuntimeCompatibilityReceiptV1',
        status: 'exact',
        producerRuntimeContractVersion: options.producerIdentity?.runtimeContractVersion ?? null,
        consumerRuntimeContractVersion: CONTEXT_RUNTIME_CONTRACT_VERSION,
        originalPlanDigest: stableDigest(raw),
        normalizedPlanDigest: stableDigest(raw),
        legacyProducerAssumed: false
      },
      error: null
    }
  }
  if (producerIdentity) {
    if (producerIdentity.runtimeContractVersion !== CONTEXT_RUNTIME_CONTRACT_VERSION - 1) {
      return {
        valid: false,
        plan: null,
        status: 'refresh-required',
        receipt: null,
        error: buildContextReadError(
          'CONTEXT_PLAN_INVALID',
          `Runtime producer identity is outside the supported N-1 window: ${identityValidation.reasonCode || producerIdentity.runtimeContractVersion}.`,
          'Start a new host session so Hook and MCP use the same installed runtime generation.'
        )
      }
    }
  }
  let legacyEnvelope = null
  try {
    legacyEnvelope = raw && typeof raw === 'object' && raw.identity?.intentSeed
      ? legacyN1ActionEnvelope(raw)
      : null
  } catch {}
  const onlyRegisteredEnvelopeDifference = exact.errors.length === 1 &&
    exact.errors[0] === 'actionEnvelope is not derived from intent scope' &&
    stableDigest(raw.actionEnvelope) === stableDigest(legacyEnvelope)
  if (!onlyRegisteredEnvelopeDifference) {
    return {
      valid: false,
      plan: null,
      status: 'refresh-required',
      receipt: null,
      error: exact.error
    }
  }
  const migrated = deepClone(raw)
  migrated.actionEnvelope = deriveActionEnvelope(
    migrated.identity.finalIntent,
    migrated.changeTypes,
    migrated.identity.intentSeed?.riskHint
  )
  rebuildContextPlanIdentity(migrated)
  const migratedValidation = validateContextReadPlan(migrated)
  if (!migratedValidation.valid) {
    return {
      valid: false,
      plan: null,
      status: 'refresh-required',
      receipt: null,
      error: migratedValidation.error
    }
  }
  const status = producerIdentity ? 'migrated-n-1' : 'legacy-n-1'
  return {
    valid: true,
    plan: migrated,
    status,
    receipt: {
      schemaVersion: 'RuntimeCompatibilityReceiptV1',
      status,
      producerRuntimeContractVersion: producerIdentity?.runtimeContractVersion ?? 1,
      consumerRuntimeContractVersion: CONTEXT_RUNTIME_CONTRACT_VERSION,
      originalPlanDigest: stableDigest(raw),
      normalizedPlanDigest: stableDigest(migrated),
      legacyProducerAssumed: !producerIdentity,
      migratedFields: ['actionEnvelope', 'identityInputs', 'planContentId', 'planId', 'contextBinding', 'cacheDecision', 'stageTiming']
    },
    error: null
  }
}

function outcomePayload(raw, path = 'root', depth = 0) {
  if (depth > 8 || raw === null || raw === undefined) return { payload: null, variant: path, observable: false }
  if (typeof raw === 'string') return { payload: raw, variant: path, observable: true }
  if (Array.isArray(raw)) {
    const texts = raw.filter(item => item && typeof item.text === 'string').map(item => item.text)
    return texts.length
      ? { payload: texts.join('\n'), variant: `${path}.content`, observable: true }
      : { payload: raw, variant: path, observable: raw.length > 0 }
  }
  if (typeof raw !== 'object') return { payload: raw, variant: path, observable: true }
  const localFailed = raw.success === false || raw.ok === false || raw.is_error === true || raw.isError === true || !!raw.error
  const localError = localFailed
    ? String(raw.errorCode || raw.error?.message || raw.error || 'tool outcome failed')
    : null
  if ([CONTEXT_READ_CONTRACT.schemas.plan, CONTEXT_READ_CONTRACT.schemas.planV1].includes(raw.schemaVersion) ||
      /^Memory.+V1$/.test(String(raw.schemaVersion || ''))) {
    return { payload: raw, variant: path, observable: true, failed: localFailed, error: localError }
  }
  for (const key of ['tool_response', 'toolResponse', 'tool_result', 'toolResult', 'result', 'output', 'structuredContent']) {
    if (raw[key] !== undefined && raw[key] !== null) {
      const nested = outcomePayload(raw[key], `${path}.${key}`, depth + 1)
      return { ...nested, failed: localFailed || nested.failed === true, error: localError || nested.error || null }
    }
  }
  if (Array.isArray(raw.content)) {
    const nested = outcomePayload(raw.content, `${path}.content`, depth + 1)
    return { ...nested, failed: localFailed || nested.failed === true, error: localError || nested.error || null }
  }
  if (typeof raw.text === 'string') return { payload: raw.text, variant: `${path}.text`, observable: true, failed: localFailed, error: localError }
  if (depth > 0) return { payload: raw, variant: path, observable: true, failed: localFailed, error: localError }
  return { payload: null, variant: path, observable: false, failed: localFailed, error: localError }
}

function normalizeContextToolOutcome(raw = {}) {
  const extracted = outcomePayload(raw)
  const source = raw && typeof raw === 'object' ? raw : {}
  const semantic = parseExactJson(extracted.payload) ||
    (extracted.payload && typeof extracted.payload === 'object' && !Array.isArray(extracted.payload)
      ? extracted.payload
      : {})
  const failed = source.success === false || source.ok === false ||
    source.is_error === true || source.isError === true || !!source.error ||
    semantic.ok === false || semantic.success === false ||
    semantic.is_error === true || semantic.isError === true || !!semantic.error ||
    extracted.failed === true
  let serialized = ''
  if (extracted.observable) {
    try {
      serialized = typeof extracted.payload === 'string' ? extracted.payload : JSON.stringify(extracted.payload)
    } catch {
      serialized = ''
    }
  }
  const telemetry = measureContextPayload(serialized, {
    latencyMs: source.latencyMs ?? source.telemetry?.latencyMs,
    tokens: source.tokens ?? source.telemetry?.tokens
  })
  return {
    success: !failed,
    transportSuccess: !failed && extracted.observable,
    observable: extracted.observable,
    variant: extracted.variant,
    payload: extracted.payload,
    text: typeof extracted.payload === 'string' ? extracted.payload : serialized,
    resultDigest: extracted.observable ? stableDigest(extracted.payload) : null,
    ok: typeof semantic.ok === 'boolean'
      ? semantic.ok
      : (typeof source.ok === 'boolean' ? source.ok : null),
    errorCode: String(semantic.errorCode || source.errorCode || '') || null,
    stateChanged: typeof semantic.stateChanged === 'boolean'
      ? semantic.stateChanged
      : (typeof source.stateChanged === 'boolean' ? source.stateChanged : null),
    error: failed
      ? String(
          semantic.errorCode || source.errorCode || semantic.error?.message || semantic.error ||
          source.error?.message || source.error || extracted.error || 'tool outcome failed'
        )
      : null,
    telemetry
  }
}

function parseExactJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  let text = value.trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) text = fenced[1].trim()
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractRuntimeProducerIdentity (raw, depth = 0, seen = new WeakSet()) {
  if (!raw || typeof raw !== 'object' || depth > 8 || seen.has(raw)) return null
  seen.add(raw)
  const direct = raw._meta?.devcodexRuntimeProcessIdentity ||
    raw.meta?.devcodexRuntimeProcessIdentity ||
    raw.devcodexRuntimeProcessIdentity
  if (direct && typeof direct === 'object') return direct
  for (const key of ['tool_response', 'toolResponse', 'tool_result', 'toolResult', 'result', 'output', 'structuredContent']) {
    const found = extractRuntimeProducerIdentity(raw[key], depth + 1, seen)
    if (found) return found
  }
  return null
}

function extractContextPlanBody(raw) {
  const outcome = normalizeContextToolOutcome(raw)
  if (!outcome.transportSuccess) {
    return {
      plan: null,
      outcome,
      error: buildContextReadError('CONTEXT_PLAN_INVALID', 'Tool result does not contain an observable successful plan body.', 'Use an observable structured plan result.')
    }
  }
  const plan = parseExactJson(outcome.payload)
  const producerIdentity = extractRuntimeProducerIdentity(raw)
  const compatibility = normalizeCompatibleContextReadPlan(plan, { producerIdentity })
  return compatibility.valid
    ? {
        plan: compatibility.plan,
        originalPlan: plan,
        originalContextBinding: plan?.contextBinding || null,
        producerIdentity,
        compatibilityReceipt: compatibility.receipt,
        outcome,
        error: null
      }
    : {
        plan: null,
        originalPlan: plan,
        originalContextBinding: plan?.contextBinding || null,
        producerIdentity,
        compatibilityReceipt: null,
        outcome,
        error: compatibility.error
      }
}

function extractContextSourceEvidence(plan, rawOutcome, options = {}) {
  const planValidation = validateContextReadPlan(plan)
  const outcome = normalizeContextToolOutcome(rawOutcome)
  if (!planValidation.valid) return { outcome, evidence: [], error: planValidation.error }
  if (!outcome.transportSuccess) {
    return { outcome, evidence: [], error: buildContextReadError('CONTEXT_PLAN_INVALID', 'Source outcome is not observable and successful.', 'Record an unverified outcome without satisfying sources.') }
  }
  let sourceResults = Array.isArray(options.sourceResults) ? options.sourceResults : null
  if (!sourceResults && outcome.payload && typeof outcome.payload === 'object') {
    sourceResults = Array.isArray(outcome.payload.sourceResults)
      ? outcome.payload.sourceResults
      : (Array.isArray(outcome.payload.evidence) ? outcome.payload.evidence : null)
  }
  if (!sourceResults && options.sourceId) sourceResults = [{ sourceId: options.sourceId, ...options }]
  if (options.toolName === 'profile_context_plan') {
    const extracted = extractContextPlanBody(rawOutcome)
    if (extracted.plan && extracted.plan.planId === plan.planId) {
      sourceResults = plan.selectedSources
        .filter(source => source.kind === 'profile-baseline')
        .map(source => ({
          sourceId: source.sourceId,
          outcome: 'baseline-ready',
          successful: true,
          sourceLayer: source.sourceLayer,
          sourceRefsMatch: true,
          schemaMatch: true,
          targetMatch: true
        }))
    } else {
      return { outcome, evidence: [], error: extracted.error || buildContextReadError('CONTEXT_PLAN_INVALID', 'Observed plan identity mismatch.') }
    }
  }
  const evidence = []
  for (const raw of sourceResults || []) {
    const selected = plan.selectedSources.find(source => source.sourceId === raw.sourceId)
    if (!selected) continue
    const isMemory = selected.kind === 'memory'
    evidence.push({
      observationId: String(raw.observationId || options.observationId || ''),
      toolCallId: String(raw.toolCallId || options.toolCallId || ''),
      sourceId: selected.sourceId,
      sourceKind: selected.kind,
      contextEpoch: String(raw.contextEpoch || options.contextEpoch || ''),
      planId: String(raw.planId || options.planId || ''),
      activeRoot: normalizePath(raw.activeRoot || options.activeRoot || ''),
      sourceLayer: String(raw.sourceLayer || options.sourceLayer || ''),
      outcome: String(raw.outcome || (raw.successful === false ? 'failed' : 'observed-success')),
      successful: raw.successful !== false,
      observable: raw.observable !== false && outcome.observable,
      transportSuccess: raw.transportSuccess !== false && outcome.transportSuccess,
      sourceRefsMatch: raw.sourceRefsMatch === true,
      schemaMatch: isMemory ? raw.schemaMatch === true : raw.schemaMatch !== false,
      targetMatch: isMemory ? raw.targetMatch === true : raw.targetMatch !== false,
      resultDigest: outcome.resultDigest,
      contentIdentity: raw.contentIdentity || null,
      bodyObserved: raw.bodyObserved === true,
      hostSessionId: String(raw.hostSessionId || options.hostSessionId || ''),
      bytes: finiteOrNull(raw.bytes ?? outcome.telemetry.bytes),
      chars: finiteOrNull(raw.chars ?? outcome.telemetry.chars),
      hostDeliveredBytes: finiteOrNull(raw.hostDeliveredBytes),
      latencyMs: finiteOrNull(raw.latencyMs ?? outcome.telemetry.latencyMs),
      tokens: finiteOrNull(raw.tokens ?? outcome.telemetry.tokens),
      cache: raw.cache === true
    })
  }
  return { outcome, evidence, error: null }
}

function observationSuccessful(observation) {
  return !!observation && observation.correlationValid !== false && observation.successful === true &&
    observation.observable === true && observation.transportSuccess === true && observation.activeRootMatch === true &&
    observation.sourceRefsMatch === true && observation.schemaMatch !== false && observation.targetMatch !== false &&
    SUCCESS_OUTCOMES.has(observation.outcome)
}

function evidenceProjection(observations, mandatorySourceIds, requireContentIdentity = false) {
  const satisfied = []
  const missing = []
  for (const sourceId of mandatorySourceIds) {
    const terminal = observations.filter(item => item.sourceId === sourceId && item.outcome !== 'attempted' && item.correlationValid !== false)
    const latest = terminal[terminal.length - 1]
    const identityReady = !requireContentIdentity || (
      latest?.bodyObserved === true && validateContentIdentity(latest?.contentIdentity).valid
    )
    if (observationSuccessful(latest) && identityReady) satisfied.push(sourceId)
    else missing.push(sourceId)
  }
  return { satisfiedSourceIds: satisfied.sort(), missingSourceIds: missing.sort() }
}

function normalizeObservation(raw = {}) {
  return {
    observationId: String(raw.observationId || ''),
    toolCallId: String(raw.toolCallId || ''),
    sourceId: raw.sourceId ? String(raw.sourceId) : null,
    sourceKind: raw.sourceKind ? String(raw.sourceKind) : null,
    actionClass: raw.actionClass ? String(raw.actionClass) : null,
    attemptedAt: validIso(raw.attemptedAt) ? new Date(Date.parse(raw.attemptedAt)).toISOString() : null,
    observedAt: validIso(raw.observedAt) ? new Date(Date.parse(raw.observedAt)).toISOString() : null,
    outcome: String(raw.outcome || 'unobservable'),
    successful: raw.successful === true,
    observable: raw.observable === true,
    transportSuccess: raw.transportSuccess === true,
    activeRootMatch: raw.activeRootMatch === true,
    sourceLayer: raw.sourceLayer ? String(raw.sourceLayer) : null,
    sourceRefsMatch: raw.sourceRefsMatch === true,
    schemaMatch: raw.schemaMatch !== false,
    targetMatch: raw.targetMatch !== false,
    correlationValid: raw.correlationValid !== false,
    resultDigest: raw.resultDigest ? String(raw.resultDigest) : null,
    contentIdentity: validateContentIdentity(raw.contentIdentity).valid ? deepClone(raw.contentIdentity) : null,
    bodyObserved: raw.bodyObserved === true,
    hostSessionId: String(raw.hostSessionId || ''),
    bytes: finiteOrNull(raw.bytes),
    chars: finiteOrNull(raw.chars),
    hostDeliveredBytes: finiteOrNull(raw.hostDeliveredBytes),
    latencyMs: finiteOrNull(raw.latencyMs),
    tokens: finiteOrNull(raw.tokens),
    cache: raw.cache === true
  }
}

function collectReceiptSourceIdentities(observations) {
  const latest = new Map()
  for (const observation of observations || []) {
    if (!observation.sourceId || observation.outcome === 'attempted') continue
    if (!observationSuccessful(observation) || !observation.bodyObserved ||
        !validateContentIdentity(observation.contentIdentity).valid) {
      latest.delete(observation.sourceId)
    } else {
      latest.set(observation.sourceId, {
        sourceId: observation.sourceId,
        contentIdentity: deepClone(observation.contentIdentity)
      })
    }
  }
  return [...latest.values()].sort((left, right) => compareText(left.sourceId, right.sourceId))
}

function sameSourceIdentities(left, right) {
  const normalize = value => (Array.isArray(value) ? value : [])
    .filter(item => item && item.sourceId && validateContentIdentity(item.contentIdentity).valid)
    .map(item => ({ sourceId: String(item.sourceId), contentIdentity: item.contentIdentity }))
    .sort((a, b) => compareText(a.sourceId, b.sourceId))
  return stableDigest(normalize(left)) === stableDigest(normalize(right))
}

function normalizeDeliveryState(raw = {}, hostSessionId = '') {
  const session = String(raw.hostSessionId || hostSessionId || '')
  return {
    schemaVersion: 'ContextDeliveryStateV1',
    hostSessionId: session,
    bodyObserved: raw.bodyObserved === true,
    reused: raw.reused === true,
    eligible: raw.eligible === true,
    reasonCode: String(raw.reasonCode || 'body-read-required')
  }
}

function evaluateContextReuse(input = {}) {
  const plan = input.plan
  const priorPlan = input.priorPlan
  const rawPriorReceipt = input.priorReceipt
  const planValidation = validateContextReadPlan(plan)
  const priorValidation = validateContextReadPlan(priorPlan)
  const hostSessionId = String(input.hostSessionId || '')
  const decision = {
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.reuseDecision,
    planId: plan?.planId || '',
    planContentId: plan?.planContentId || '',
    computation: { reuse: false, reasonCode: 'no-compatible-prior-plan' },
    delivery: { reuse: false, reasonCode: 'body-read-required' },
    reuseFrom: null
  }
  if (!planValidation.valid || plan?.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.plan) {
    decision.computation.reasonCode = 'current-plan-invalid'
    decision.delivery.reasonCode = 'current-plan-invalid'
    return decision
  }
  if (input.executionOptimizationMode === 'full-only' || plan.cacheDecision?.reasonCode === 'execution-optimization-full-only') {
    decision.computation.reasonCode = 'execution-optimization-full-only'
    decision.delivery.reasonCode = 'execution-optimization-full-only'
    return decision
  }
  if (!priorValidation.valid || priorPlan?.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.plan) {
    decision.computation.reasonCode = priorPlan?.schemaVersion === CONTEXT_READ_CONTRACT.schemas.planV1
      ? 'legacy-plan-no-content-identity'
      : 'no-compatible-prior-plan'
    decision.delivery.reasonCode = 'legacy-or-missing-prior-plan'
    return decision
  }
  const targetMatches = normalizePath(plan.identity.activeRoot) === normalizePath(priorPlan.identity.activeRoot) &&
    plan.identity.project === priorPlan.identity.project
  if (!targetMatches) {
    decision.computation.reasonCode = 'target-mismatch'
    decision.delivery.reasonCode = 'target-mismatch'
    return decision
  }
  if (plan.planContentId !== priorPlan.planContentId) {
    decision.computation.reasonCode = 'plan-content-mismatch'
    decision.delivery.reasonCode = 'plan-content-mismatch'
    return decision
  }
  decision.computation = { reuse: true, reasonCode: 'content-identity-match' }
  decision.reuseFrom = { planId: priorPlan.planId, planContentId: priorPlan.planContentId }

  if (!rawPriorReceipt || rawPriorReceipt.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.receipt) {
    decision.delivery.reasonCode = 'legacy-or-missing-receipt'
    return decision
  }
  const priorReceipt = normalizeReceipt(rawPriorReceipt, priorPlan)
  if (priorReceipt.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.receipt ||
      priorReceipt.receiptId !== rawPriorReceipt.receiptId) {
    decision.delivery.reasonCode = 'prior-receipt-invalid'
    return decision
  }
  if (priorReceipt.planId !== priorPlan.planId || priorReceipt.planContentId !== priorPlan.planContentId) {
    decision.delivery.reasonCode = 'prior-receipt-plan-mismatch'
    return decision
  }
  if (!hostSessionId || priorReceipt.delivery?.hostSessionId !== hostSessionId) {
    decision.delivery.reasonCode = 'host-session-mismatch'
    return decision
  }
  if (plan.identity.contextEpoch !== priorPlan.identity.contextEpoch || priorReceipt.contextEpoch !== plan.identity.contextEpoch) {
    decision.delivery.reasonCode = 'context-epoch-mismatch'
    return decision
  }
  if (priorReceipt.verificationMode !== 'structured-plan' || !['relevant-complete', 'completed'].includes(priorReceipt.status)) {
    decision.delivery.reasonCode = 'prior-receipt-incomplete'
    return decision
  }
  const priorSourceIdentities = Array.isArray(priorReceipt.sourceIdentities) ? priorReceipt.sourceIdentities : []
  const currentSourceIdentities = Array.isArray(input.sourceIdentities) ? input.sourceIdentities : []
  if (priorSourceIdentities.length !== plan.mandatorySourceIds.length ||
      currentSourceIdentities.length !== plan.mandatorySourceIds.length ||
      !sameSourceIdentities(priorSourceIdentities, currentSourceIdentities)) {
    decision.delivery.reasonCode = 'source-identity-mismatch'
    return decision
  }
  const allBodiesObserved = plan.mandatorySourceIds.every(sourceId => priorReceipt.observations
    .some(observation => observation.sourceId === sourceId && observationSuccessful(observation) &&
      observation.bodyObserved === true && observation.hostSessionId === hostSessionId &&
      validateContentIdentity(observation.contentIdentity).valid))
  if (!allBodiesObserved) {
    decision.delivery.reasonCode = 'body-observation-unproven'
    return decision
  }
  decision.delivery = { reuse: true, reasonCode: 'same-session-epoch-content-observed' }
  decision.reuseFrom = {
    ...decision.reuseFrom,
    receiptId: priorReceipt.receiptId,
    sourceIdentities: deepClone(priorSourceIdentities)
  }
  return decision
}

function buildReceiptId(receipt) {
  return `receipt-${stableDigest({
    contextEpoch: receipt.contextEpoch,
    planId: receipt.planId,
    planContentId: receipt.planContentId || null,
    verificationMode: receipt.verificationMode,
    status: receipt.status,
    sourceIdentities: receipt.sourceIdentities || [],
    results: (receipt.observations || []).filter(item => item.outcome !== 'attempted').map(item => ({
      sourceId: item.sourceId,
      outcome: item.outcome,
      resultDigest: item.resultDigest,
      bodyObserved: item.bodyObserved,
      hostSessionId: item.hostSessionId
    })),
    delivery: receipt.delivery || null,
    reuseFrom: receipt.reuseFrom || null
  }).slice(0, 24)}`
}

function refreshReceiptId(receipt) {
  return receipt?.schemaVersion === CONTEXT_READ_CONTRACT.schemas.receipt
    ? { ...receipt, receiptId: buildReceiptId(receipt) }
    : receipt
}

function baselineContentIdentity(plan, sourceId) {
  if (sourceId === profileSourceId('README.md')) {
    return buildContentIdentity({
      sourceKey: `profile://${plan.identity.project}/README.md#delivered`,
      content: plan.baselineContext.readme.content,
      contractVersion: 'profile-readme@1'
    })
  }
  return buildJsonContentIdentity({
    sourceKey: `profile://${plan.identity.project}/config.json#delivered`,
    value: plan.baselineContext.effectiveConfig,
    contractVersion: 'profile-config@1'
  }).identity
}

function baseReceipt(plan, verificationMode, options = {}) {
  const isV2 = plan.schemaVersion === CONTEXT_READ_CONTRACT.schemas.plan
  const hostSessionId = String(options.hostSessionId || '')
  const planObserved = verificationMode === 'structured-plan' && options.planObserved === true
  const observations = planObserved
    ? plan.selectedSources.filter(source => source.kind === 'profile-baseline').map(source => {
        const contentIdentity = isV2 ? baselineContentIdentity(plan, source.sourceId) : null
        return normalizeObservation({
        observationId: `baseline-${source.sourceId}`,
        toolCallId: String(options.toolCallId || ''),
        sourceId: source.sourceId,
        sourceKind: source.kind,
        attemptedAt: nowIso(options),
        observedAt: nowIso(options),
        outcome: 'baseline-ready',
        successful: true,
        observable: true,
        transportSuccess: true,
        activeRootMatch: true,
        sourceLayer: source.sourceLayer,
        sourceRefsMatch: true,
        schemaMatch: true,
        targetMatch: true,
        correlationValid: true,
        resultDigest: contentIdentity?.digest || stableDigest(plan.baselineContext),
        contentIdentity,
        bodyObserved: isV2 && planObserved,
        hostSessionId,
        bytes: contentIdentity?.bytes ?? measureContextPayload(plan.baselineContext).bytes,
        chars: isV2
          ? (source.sourceId === profileSourceId('README.md')
              ? plan.baselineContext.readme.content.length
              : stableStringify(plan.baselineContext.effectiveConfig).length)
          : measureContextPayload(plan.baselineContext).chars,
        hostDeliveredBytes: contentIdentity?.bytes ?? null
        })
      })
    : []
  const projection = evidenceProjection(observations, plan.mandatorySourceIds, isV2)
  const receipt = {
    schemaVersion: isV2 ? CONTEXT_READ_CONTRACT.schemas.receipt : CONTEXT_READ_CONTRACT.schemas.receiptV1,
    receiptId: '',
    contextEpoch: plan.identity.contextEpoch,
    planId: plan.planId,
    identity: {
      activeRoot: plan.identity.activeRoot,
      project: plan.identity.project,
      host: plan.identity.host,
      ...(isV2 ? { hostSessionId } : {})
    },
    verificationMode,
    status: planObserved ? (plan.fullRead ? 'escalated-full' : 'baseline-ready') : 'unverified',
    observations,
    ...projection,
    fullRead: plan.fullRead,
    fullReadReason: plan.fullReadReason,
    escalations: plan.triggeredEscalations.map(trigger => ({ trigger, reason: trigger, observedAt: nowIso(options), action: 'planned' })),
    completedAt: null,
    consumedAt: null,
    replanCount: 0,
    lastError: null
  }
  if (isV2) {
    receipt.planContentId = plan.planContentId
    receipt.sourceIdentities = collectReceiptSourceIdentities(observations)
    receipt.delivery = normalizeDeliveryState({
      hostSessionId,
      bodyObserved: receipt.sourceIdentities.length === plan.mandatorySourceIds.length,
      eligible: false,
      reused: false,
      reasonCode: hostSessionId ? 'body-read-required' : 'host-session-unobservable'
    })
    receipt.reuseFrom = null
    receipt.receiptId = buildReceiptId(receipt)
  } else {
    receipt.receiptId = `receipt-${stableDigest({ planId: plan.planId, verificationMode }).slice(0, 24)}`
  }
  return receipt
}

function createContextReadReceipt(plan, options = {}) {
  const validation = validateContextReadPlan(plan)
  if (!validation.valid) return validation.error
  let verificationMode = String(options.verificationMode || 'instruction-only')
  if (!VERIFICATION_MODES.has(verificationMode)) verificationMode = 'instruction-only'
  if (verificationMode === 'structured-plan' && options.planObserved !== true) verificationMode = 'instruction-only'
  const receipt = baseReceipt(plan, verificationMode, options)
  if (plan.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.plan || !options.priorPlan || !options.priorReceipt) {
    return receipt
  }
  const decision = evaluateContextReuse({
    plan,
    priorPlan: options.priorPlan,
    priorReceipt: options.priorReceipt,
    hostSessionId: options.hostSessionId,
    sourceIdentities: options.sourceIdentities
  })
  if (options.reuseDecision && stableDigest(options.reuseDecision) !== stableDigest(decision)) return receipt
  if (decision?.delivery?.reuse !== true) return receipt
  const reusedObservations = []
  for (const sourceId of plan.mandatorySourceIds) {
    const candidates = options.priorReceipt.observations.filter(item =>
      item.sourceId === sourceId && observationSuccessful(item) && item.bodyObserved === true
    )
    const prior = candidates[candidates.length - 1]
    if (!prior) return receipt
    reusedObservations.push(normalizeObservation({
      ...prior,
      observationId: `reuse-${stableDigest({ sourceId, planId: plan.planId, receiptId: options.priorReceipt.receiptId }).slice(0, 20)}`,
      toolCallId: String(options.toolCallId || ''),
      attemptedAt: nowIso(options),
      observedAt: nowIso(options),
      hostSessionId: String(options.hostSessionId || ''),
      cache: true
    }))
  }
  return normalizeReceipt({
    ...receipt,
    observations: reusedObservations,
    status: 'relevant-complete',
    delivery: normalizeDeliveryState({
      hostSessionId: options.hostSessionId,
      bodyObserved: true,
      eligible: true,
      reused: true,
      reasonCode: decision.delivery.reasonCode
    }),
    reuseFrom: decision.reuseFrom,
    completedAt: nowIso(options)
  }, plan, options)
}

function normalizeReceipt(raw, plan, options = {}) {
  const planValidation = validateContextReadPlan(plan)
  if (!planValidation.valid) return planValidation.error
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createContextReadReceipt(plan, options)
  const isV2 = plan.schemaVersion === CONTEXT_READ_CONTRACT.schemas.plan
  const allowedFields = isV2 ? RECEIPT_FIELDS : RECEIPT_V1_FIELDS
  const expectedSchema = isV2 ? CONTEXT_READ_CONTRACT.schemas.receipt : CONTEXT_READ_CONTRACT.schemas.receiptV1
  const foreign = Object.keys(raw).filter(key => !allowedFields.has(key))
  if (foreign.length) return buildContextReadError('CONTEXT_PLAN_INVALID', `${expectedSchema} contains unsupported fields: ${foreign.join(', ')}.`)
  if (raw.schemaVersion !== expectedSchema || raw.planId !== plan.planId || raw.contextEpoch !== plan.identity.contextEpoch ||
      (isV2 && raw.planContentId !== plan.planContentId)) {
    return buildContextReadError('CONTEXT_PLAN_INVALID', 'Receipt discriminator or plan identity mismatch.')
  }
  const verificationMode = VERIFICATION_MODES.has(raw.verificationMode) ? raw.verificationMode : 'instruction-only'
  const observations = (Array.isArray(raw.observations) ? raw.observations : []).map(normalizeObservation).slice(-100)
  const projection = evidenceProjection(observations, plan.mandatorySourceIds, isV2)
  const staleOrBlocked = ['stale', 'blocked'].includes(raw.status)
  const allSatisfied = projection.missingSourceIds.length === 0
  let status = RECEIPT_STATUSES.has(raw.status) ? raw.status : 'unverified'
  let completedAt = validIso(raw.completedAt) ? new Date(Date.parse(raw.completedAt)).toISOString() : null
  let consumedAt = validIso(raw.consumedAt) ? new Date(Date.parse(raw.consumedAt)).toISOString() : null
  if (!staleOrBlocked && verificationMode !== 'structured-plan') {
    status = 'unverified'
    completedAt = null
    consumedAt = null
  } else if (!staleOrBlocked && allSatisfied) {
    status = consumedAt ? 'completed' : 'relevant-complete'
    completedAt = completedAt || nowIso(options)
  } else if (!staleOrBlocked && ['relevant-complete', 'completed'].includes(status)) {
    status = plan.fullRead ? 'escalated-full' : (observations.length ? 'attempted' : 'planned')
    completedAt = null
    consumedAt = null
  }
  const effectiveProjection = staleOrBlocked
    ? { satisfiedSourceIds: [], missingSourceIds: [...plan.mandatorySourceIds] }
    : projection
  const normalized = {
    schemaVersion: expectedSchema,
    receiptId: '',
    contextEpoch: plan.identity.contextEpoch,
    planId: plan.planId,
    identity: {
      activeRoot: plan.identity.activeRoot,
      project: plan.identity.project,
      host: plan.identity.host,
      ...(isV2 ? { hostSessionId: String(raw.identity?.hostSessionId || options.hostSessionId || '') } : {})
    },
    verificationMode,
    status,
    observations,
    ...effectiveProjection,
    fullRead: plan.fullRead,
    fullReadReason: plan.fullReadReason,
    escalations: Array.isArray(raw.escalations) ? deepClone(raw.escalations).slice(-20) : [],
    completedAt,
    consumedAt,
    replanCount: Math.max(0, Number.parseInt(raw.replanCount, 10) || 0),
    lastError: raw.lastError && typeof raw.lastError === 'object' ? deepClone(raw.lastError) : null
  }
  if (isV2) {
    normalized.planContentId = plan.planContentId
    normalized.sourceIdentities = collectReceiptSourceIdentities(observations)
    const hostSessionId = normalized.identity.hostSessionId
    const bodyObserved = normalized.sourceIdentities.length === plan.mandatorySourceIds.length
    const reused = raw.delivery?.reused === true && raw.reuseFrom && typeof raw.reuseFrom === 'object'
    normalized.delivery = normalizeDeliveryState({
      hostSessionId,
      bodyObserved,
      reused,
      eligible: !staleOrBlocked && bodyObserved && !!hostSessionId,
      reasonCode: reused
        ? String(raw.delivery.reasonCode || 'same-session-epoch-content-observed')
        : (staleOrBlocked
            ? `receipt-${status}`
            : (bodyObserved && hostSessionId
                ? 'current-session-content-observed'
                : (hostSessionId ? 'body-read-required' : 'host-session-unobservable')))
    })
    normalized.reuseFrom = reused ? deepClone(raw.reuseFrom) : null
    normalized.receiptId = buildReceiptId(normalized)
  } else {
    normalized.receiptId = String(raw.receiptId || `receipt-${stableDigest({ planId: plan.planId, verificationMode }).slice(0, 24)}`)
  }
  return normalized
}

function markContextReadReceiptStale(receipt, plan, reason = 'scope-drift', options = {}) {
  const normalized = normalizeReceipt(receipt, plan, options)
  if (normalized.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return normalized
  if (normalized.status === 'stale') return normalized
  const observedAt = nowIso(options)
  return refreshReceiptId({
    ...normalized,
    status: 'stale',
    satisfiedSourceIds: [],
    missingSourceIds: [...plan.mandatorySourceIds],
    escalations: [...normalized.escalations, {
      trigger: CONTEXT_READ_CONTRACT.escalationTriggers.includes(reason) ? reason : 'scope-drift',
      reason: String(reason || 'scope-drift'),
      observedAt,
      action: 'replan-required'
    }].slice(-20),
    completedAt: null,
    consumedAt: null,
    replanCount: normalized.replanCount + 1,
    lastError: buildContextReadError('CONTEXT_PLAN_INVALID', `Context receipt is stale: ${reason}.`, 'Replan once before the broader action.')
  })
}

function recordContextReadAttempt(receipt, plan, attempt = {}, options = {}) {
  const normalized = normalizeReceipt(receipt, plan, options)
  if (normalized.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return normalized
  if (['stale', 'blocked'].includes(normalized.status)) return normalized
  const actionClass = String(attempt.actionClass || '').trim()
  const activeRoot = normalizePath(attempt.activeRoot || plan.identity.activeRoot)
  const riskHint = String(attempt.riskHint || plan.identity.intentSeed.riskHint)
  const requestedSourceIds = uniqueSorted(attempt.sourceIds)
  const incompatible = !ACTION_CLASSES.has(actionClass) ||
    !plan.actionEnvelope.allowedActionClasses.includes(actionClass) ||
    activeRoot !== plan.identity.activeRoot ||
    !RISKS.has(riskHint) || RISK_RANK[riskHint] > RISK_RANK[plan.actionEnvelope.riskCeiling] ||
    requestedSourceIds.some(sourceId => !plan.selectedSources.some(source => source.sourceId === sourceId))
  if (incompatible) return markContextReadReceiptStale(normalized, plan, 'scope-drift', options)
  const attemptedAt = nowIso(options)
  const targets = requestedSourceIds.length ? requestedSourceIds : [null]
  const observations = [...normalized.observations]
  for (const sourceId of targets) {
    const selected = plan.selectedSources.find(source => source.sourceId === sourceId)
    const observation = normalizeObservation({
      observationId: `attempt-${stableDigest({
        toolCallId: attempt.toolCallId,
        sourceId,
        actionClass,
        contextEpoch: plan.identity.contextEpoch
      }).slice(0, 20)}`,
      toolCallId: attempt.toolCallId,
      sourceId,
      sourceKind: selected?.kind,
      actionClass,
      attemptedAt,
      outcome: 'attempted',
      activeRootMatch: activeRoot === plan.identity.activeRoot,
      sourceLayer: selected?.sourceLayer,
      correlationValid: true
    })
    if (!observations.some(item => item.observationId === observation.observationId)) observations.push(observation)
  }
  return refreshReceiptId({
    ...normalized,
    status: plan.fullRead ? 'escalated-full' : 'attempted',
    observations: observations.slice(-100),
    completedAt: null,
    consumedAt: null
  })
}

function observationSemanticDigest(observation) {
  return stableDigest({
    toolCallId: observation.toolCallId,
    sourceId: observation.sourceId,
    sourceKind: observation.sourceKind,
    outcome: observation.outcome,
    successful: observation.successful,
    observable: observation.observable,
    transportSuccess: observation.transportSuccess,
    activeRootMatch: observation.activeRootMatch,
    sourceLayer: observation.sourceLayer,
    sourceRefsMatch: observation.sourceRefsMatch,
    schemaMatch: observation.schemaMatch,
    targetMatch: observation.targetMatch,
    correlationValid: observation.correlationValid,
    resultDigest: observation.resultDigest,
    contentIdentity: observation.contentIdentity,
    bodyObserved: observation.bodyObserved,
    hostSessionId: observation.hostSessionId
  })
}

function recordContextReadOutcome(receipt, plan, evidence = {}, options = {}) {
  const normalized = normalizeReceipt(receipt, plan, options)
  if (normalized.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return normalized
  if (['stale', 'blocked'].includes(normalized.status)) return normalized
  const selected = plan.selectedSources.find(source => source.sourceId === evidence.sourceId)
  if (!selected) return normalized
  const epochMatch = String(evidence.contextEpoch || '') === plan.identity.contextEpoch
  const planMatch = String(evidence.planId || '') === plan.planId
  const activeRootMatch = normalizePath(evidence.activeRoot) === plan.identity.activeRoot
  const layerMatch = evidence.sourceLayer === selected.sourceLayer || selected.sourceRefs.some(ref => ref.layer === evidence.sourceLayer)
  const correlationValid = epochMatch && planMatch
  let outcome = String(evidence.outcome || 'unobservable')
  let successful = evidence.successful === true
  if (!activeRootMatch) {
    outcome = 'wrong-root'
    successful = false
  } else if (!correlationValid) {
    outcome = 'invalid'
    successful = false
  } else if (evidence.observable !== true) {
    outcome = 'unobservable'
    successful = false
  } else if (evidence.transportSuccess !== true || !layerMatch || evidence.sourceRefsMatch !== true ||
      (selected.kind === 'memory' && (evidence.schemaMatch !== true || evidence.targetMatch !== true))) {
    outcome = evidence.transportSuccess === false ? 'failed' : 'invalid'
    successful = false
  }
  const observedAt = nowIso(options)
  const observation = normalizeObservation({
    ...evidence,
    observationId: evidence.observationId || `result-${stableDigest({
      toolCallId: evidence.toolCallId,
      sourceId: evidence.sourceId,
      resultDigest: evidence.resultDigest,
      contextEpoch: plan.identity.contextEpoch,
      planId: plan.planId
    }).slice(0, 20)}`,
    sourceKind: selected.kind,
    observedAt,
    outcome,
    successful,
    activeRootMatch,
    sourceLayer: evidence.sourceLayer,
    correlationValid,
    schemaMatch: selected.kind === 'memory' ? evidence.schemaMatch === true : evidence.schemaMatch !== false,
    targetMatch: selected.kind === 'memory' ? evidence.targetMatch === true : evidence.targetMatch !== false
  })
  const duplicate = normalized.observations.find(item => item.observationId && item.observationId === observation.observationId)
  if (duplicate && observationSemanticDigest(duplicate) !== observationSemanticDigest(observation)) {
    const conflict = normalizeObservation({
      ...observation,
      observationId: `${observation.observationId}-conflict`,
      outcome: 'invalid',
      successful: false,
      sourceRefsMatch: false,
      resultDigest: stableDigest([duplicate.resultDigest, observation.resultDigest])
    })
    const conflicted = normalizeReceipt({
      ...normalized,
      status: 'unverified',
      observations: [...normalized.observations, conflict].slice(-100),
      completedAt: null,
      consumedAt: null,
      lastError: buildContextReadError('CONTEXT_PLAN_INVALID', 'Conflicting duplicate PostToolUse evidence is ambiguous.', 'Keep the receipt unverified and replan once if the action still requires context.')
    }, plan, options)
    return refreshReceiptId({ ...conflicted, status: 'unverified', completedAt: null, consumedAt: null })
  }
  const next = duplicate ? normalized : { ...normalized, observations: [...normalized.observations, observation].slice(-100) }
  return completeContextReadReceipt(next, plan, options)
}

function completeContextReadReceipt(receipt, plan, options = {}) {
  const normalized = normalizeReceipt(receipt, plan, options)
  if (normalized.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return normalized
  if (['stale', 'blocked'].includes(normalized.status)) return normalized
  if (normalized.verificationMode !== 'structured-plan') {
    return refreshReceiptId({ ...normalized, status: 'unverified', completedAt: null, consumedAt: null })
  }
  if (normalized.missingSourceIds.length) {
    return refreshReceiptId({
      ...normalized,
      status: plan.fullRead ? 'escalated-full' : (normalized.observations.length ? 'attempted' : 'planned'),
      completedAt: null,
      consumedAt: null
    })
  }
  const completedAt = normalized.completedAt || nowIso(options)
  if (options.consume === true) {
    return refreshReceiptId({ ...normalized, status: 'completed', completedAt, consumedAt: nowIso(options) })
  }
  return refreshReceiptId({ ...normalized, status: 'relevant-complete', completedAt, consumedAt: null })
}

function deriveLegacyBootstrapProjection(receipt, legacy = {}) {
  if (!receipt || ![CONTEXT_READ_CONTRACT.schemas.receipt, CONTEXT_READ_CONTRACT.schemas.receiptV1].includes(receipt.schemaVersion)) {
    return {
      profileRead: legacy.profileRead === true,
      summaryRead: legacy.summaryRead === true,
      tasksRead: legacy.tasksRead === true,
      bootstrapComplete: false
    }
  }
  const successful = receipt.observations.filter(observationSuccessful)
  const verifiedComplete = ['relevant-complete', 'completed'].includes(receipt.status) && receipt.verificationMode === 'structured-plan'
  return {
    profileRead: verifiedComplete && successful.some(item => item.sourceKind?.startsWith('profile')),
    summaryRead: verifiedComplete && successful.some(item => ['memory:memory_status', 'memory:memory_summary_query'].includes(item.sourceId)),
    tasksRead: verifiedComplete && successful.some(item => ['memory:memory_status', 'memory:memory_session_query'].includes(item.sourceId)),
    bootstrapComplete: verifiedComplete
  }
}

function normalizeContextReadState(raw = {}, options = {}) {
  const source = raw.contextAcquisition && typeof raw.contextAcquisition === 'object' ? raw.contextAcquisition : raw
  const planCandidate = source.plan || source.currentPlan || null
  const planValidation = normalizeCompatibleContextReadPlan(planCandidate, {
    producerIdentity: source.producerRuntimeIdentity || null
  })
  const plan = planValidation.valid ? deepClone(planValidation.plan) : null
  let receipt = null
  if (plan && source.receipt) {
    const normalized = normalizeReceipt(source.receipt, plan, options)
    if ([CONTEXT_READ_CONTRACT.schemas.receipt, CONTEXT_READ_CONTRACT.schemas.receiptV1].includes(normalized.schemaVersion)) receipt = normalized
  }
  const legacySource = raw.bootstrap && typeof raw.bootstrap === 'object' ? raw.bootstrap : raw
  return {
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.state,
    contextEpoch: plan?.identity.contextEpoch || String(source.contextEpoch || ''),
    plan,
    receipt,
    planCallCount: Math.max(0, Number.parseInt(source.planCallCount, 10) || 0),
    replanCount: receipt?.replanCount || Math.max(0, Number.parseInt(source.replanCount, 10) || 0),
    fallbackAttempts: Math.min(1, Math.max(0, Number.parseInt(source.fallbackAttempts, 10) || 0)),
    legacyObserved: {
      profileRead: legacySource.profileRead === true,
      summaryRead: legacySource.summaryRead === true,
      tasksRead: legacySource.tasksRead === true,
      bootstrapComplete: legacySource.bootstrapComplete === true
    },
    bootstrap: deriveLegacyBootstrapProjection(receipt, legacySource)
  }
}

module.exports = {
  CONTEXT_READ_CONTRACT,
  buildContextReadError,
  buildContextReadPlan,
  completeContextReadReceipt,
  createContextReadReceipt,
  deriveLegacyBootstrapProjection,
  evaluateContextReuse,
  extractContextPlanBody,
  extractContextSourceEvidence,
  markContextReadReceiptStale,
  measureContextPayload,
  normalizeContextReadState,
  normalizeContextToolOutcome,
  normalizeIntentSeed,
  normalizeCompatibleContextReadPlan,
  recordContextReadAttempt,
  recordContextReadOutcome,
  stableDigest,
  validateContextReadPlan
}
