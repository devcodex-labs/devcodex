'use strict'

const crypto = require('crypto')
const path = require('path')
const { HOST_IDS } = require('./host-surface-descriptors')

const SKILL_ROOT = path.resolve(__dirname, '..', '..', 'skills', 'host-capability-routing')
const SCHEMAS = Object.freeze({
  capabilityIntentDecision: require(path.join(SKILL_ROOT, 'capability-intent-decision.v1.schema.json')),
  hostLeverCatalog: require(path.join(SKILL_ROOT, 'host-lever-catalog.v1.schema.json')),
  originalInstructionRef: require(path.join(SKILL_ROOT, 'original-instruction-ref.v1.schema.json'))
})
const REQUIRED_INVALIDATION_TRIGGERS = Object.freeze([
  'schema',
  'source',
  'host',
  'protocol',
  'evidence',
  'consumer',
  'runtime-owner'
])
const REQUIRED_SECURITY_INVARIANTS = Object.freeze([
  'S01',
  'S02',
  'S03',
  'S04',
  'S05',
  'S06',
  'S07'
])
const LEASE_DURATION_MS = Object.freeze({
  P14D: 14 * 24 * 60 * 60 * 1000,
  P30D: 30 * 24 * 60 * 60 * 1000
})

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
  return crypto.createHash('sha256').update(content).digest('hex')
}

function normalizeInstructionText(value) {
  return String(value || '').replace(/\r\n?/g, '\n')
}

function issue(pathValue, code, message) {
  return { path: pathValue, code, message, severity: 'BLOCK' }
}

function typeMatches(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected]
  return types.some(type => {
    if (type === 'null') return value === null
    if (type === 'array') return Array.isArray(value)
    if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
    if (type === 'integer') return Number.isInteger(value)
    return typeof value === type
  })
}

function validateSchemaNode(value, node, pathValue, issues) {
  if (!node || typeof node !== 'object') return
  if (node.const !== undefined && stableStringify(value) !== stableStringify(node.const)) {
    issues.push(issue(pathValue, 'const-mismatch', `${pathValue} must equal ${JSON.stringify(node.const)}`))
    return
  }
  if (Array.isArray(node.enum) && !node.enum.some(item => stableStringify(item) === stableStringify(value))) {
    issues.push(issue(pathValue, 'enum-invalid', `${pathValue} is not an allowed value`))
    return
  }
  if (node.type && !typeMatches(value, node.type)) {
    const expected = Array.isArray(node.type) ? node.type.join('|') : node.type
    issues.push(issue(pathValue, 'type-invalid', `${pathValue} must be ${expected}`))
    return
  }

  if (typeof value === 'string') {
    const length = Array.from(value).length
    if (Number.isInteger(node.minLength) && length < node.minLength) {
      issues.push(issue(pathValue, 'string-too-short', `${pathValue} is shorter than ${node.minLength}`))
    }
    if (Number.isInteger(node.maxLength) && length > node.maxLength) {
      issues.push(issue(pathValue, 'string-too-long', `${pathValue} is longer than ${node.maxLength}`))
    }
    if (node.pattern && !new RegExp(node.pattern).test(value)) {
      issues.push(issue(pathValue, 'pattern-mismatch', `${pathValue} does not match ${node.pattern}`))
    }
    if (node.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value)))) {
      issues.push(issue(pathValue, 'date-time-invalid', `${pathValue} must be an ISO date-time`))
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(node.minItems) && value.length < node.minItems) {
      issues.push(issue(pathValue, 'array-too-short', `${pathValue} needs at least ${node.minItems} item(s)`))
    }
    if (Number.isInteger(node.maxItems) && value.length > node.maxItems) {
      issues.push(issue(pathValue, 'array-too-long', `${pathValue} allows at most ${node.maxItems} item(s)`))
    }
    if (node.uniqueItems) {
      const identities = value.map(stableStringify)
      if (new Set(identities).size !== identities.length) {
        issues.push(issue(pathValue, 'array-duplicate', `${pathValue} contains duplicate items`))
      }
    }
    if (node.items) {
      value.forEach((item, index) => validateSchemaNode(item, node.items, `${pathValue}[${index}]`, issues))
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const field of node.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) {
        issues.push(issue(`${pathValue}.${field}`, 'required-field-missing', `${field} is required`))
      }
    }
    const known = new Set(Object.keys(node.properties || {}))
    if (node.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!known.has(field)) issues.push(issue(`${pathValue}.${field}`, 'unknown-field', `${field} is not allowed`))
      }
    }
    for (const [field, fieldSchema] of Object.entries(node.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        validateSchemaNode(value[field], fieldSchema, `${pathValue}.${field}`, issues)
      }
    }
  }
}

function validateAgainstSchema(value, schema) {
  const issues = []
  validateSchemaNode(value, schema, '$', issues)
  return issues
}

function dedupeIssues(issues) {
  const seen = new Set()
  return issues.filter(item => {
    const key = `${item.path}|${item.code}|${item.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameMembers(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false
  const left = [...actual].sort()
  const right = [...expected].sort()
  return left.every((value, index) => value === right[index])
}

function logicalHostIdForVariant(variant) {
  return HOST_IDS.find(hostId => variant === hostId || variant.startsWith(`${hostId}-`)) || null
}

function catalogEntryKey(entry) {
  return [
    entry?.hostId,
    entry?.hostSurfaceOrVariant,
    entry?.capabilityFamilyId,
    entry?.leverVersion
  ].join('|')
}

function validateEvidenceLease(entry, pathValue, catalog, issues) {
  const lease = entry?.evidence?.evidenceLease
  if (!lease) return
  const expectedDuration = {
    'repo-local': 'source-bound',
    'official-docs': 'P30D',
    'direct-host-replay': 'P14D',
    unverified: 'P0D'
  }[lease.kind]
  if (expectedDuration && lease.duration !== expectedDuration) {
    issues.push(issue(
      `${pathValue}.evidence.evidenceLease.duration`,
      'evidence-lease-kind-mismatch',
      `${lease.kind} evidence must use ${expectedDuration}`
    ))
  }
  if (lease.kind === 'repo-local') {
    if (lease.sourceHead !== catalog?.sourceMatrixRef?.sourceHead) {
      issues.push(issue(
        `${pathValue}.evidence.evidenceLease.sourceHead`,
        'repo-evidence-source-mismatch',
        'repo-local evidence must bind the catalog sourceHead'
      ))
    }
  } else if (lease.sourceHead !== null) {
    issues.push(issue(
      `${pathValue}.evidence.evidenceLease.sourceHead`,
      'non-repo-source-head-present',
      'non-repo evidence must not claim a repository sourceHead'
    ))
  }
  if (entry?.evidence?.evidenceStatus === 'UNVERIFIED' && lease.kind !== 'unverified') {
    issues.push(issue(
      `${pathValue}.evidence.evidenceLease.kind`,
      'unverified-lease-invalid',
      'UNVERIFIED evidence must use an unverified/P0D lease'
    ))
  }
}

function validateHostLeverCatalog(catalog, options = {}) {
  const issues = validateAgainstSchema(catalog, SCHEMAS.hostLeverCatalog)
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return issues

  const entries = Array.isArray(catalog.entries) ? catalog.entries : []
  const keys = entries.map(catalogEntryKey)
  const duplicateKeys = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))]
  for (const key of duplicateKeys) {
    issues.push(issue('$.entries', 'CATALOG_DUPLICATE_KEY', `catalog key must be unique: ${key}`))
  }

  const variants = entries.map(entry => entry.hostSurfaceOrVariant).filter(Boolean)
  const duplicateVariants = [...new Set(variants.filter((variant, index) => variants.indexOf(variant) !== index))]
  for (const variant of duplicateVariants) {
    issues.push(issue('$.entries', 'CATALOG_DUPLICATE_VARIANT', `variant must appear once in Phase 1: ${variant}`))
  }

  entries.forEach((entry, index) => {
    const pathValue = `$.entries[${index}]`
    const logicalHostId = logicalHostIdForVariant(entry?.hostSurfaceOrVariant)
    if (!logicalHostId || !HOST_IDS.includes(entry?.hostId)) {
      issues.push(issue(`${pathValue}.hostId`, 'HOST_VARIANT_UNKNOWN', 'entry is not backed by the canonical logical host set'))
    } else if (entry.hostId !== logicalHostId) {
      issues.push(issue(
        `${pathValue}.hostId`,
        'HOST_VARIANT_OWNER_MISMATCH',
        `${entry.hostSurfaceOrVariant} belongs to ${logicalHostId}`
      ))
    }
    if (entry?.capabilityFamilyId !== 'planning') {
      issues.push(issue(
        `${pathValue}.capabilityFamilyId`,
        'CAPABILITY_FAMILY_OUT_OF_SCOPE',
        'Phase 1 catalog only contains the planning family'
      ))
    }
    if (entry?.eligibility?.status === 'phase2-candidate' && ['none', 'launcher'].includes(entry?.leverType)) {
      issues.push(issue(
        `${pathValue}.leverType`,
        'PHASE2_CANDIDATE_LEVER_INVALID',
        'phase2-candidate requires a native host lever'
      ))
    }
    if (!sameMembers(entry?.freshness?.invalidationTriggers, REQUIRED_INVALIDATION_TRIGGERS)) {
      issues.push(issue(
        `${pathValue}.freshness.invalidationTriggers`,
        'INVALIDATION_TRIGGER_SET_MISMATCH',
        'entry invalidation triggers must match the frozen trigger set'
      ))
    }
    validateEvidenceLease(entry, pathValue, catalog, issues)
  })

  if (!sameMembers(catalog.invalidationTriggers, REQUIRED_INVALIDATION_TRIGGERS)) {
    issues.push(issue(
      '$.invalidationTriggers',
      'INVALIDATION_TRIGGER_SET_MISMATCH',
      'catalog invalidation triggers must match the frozen trigger set'
    ))
  }
  if (catalog?.sourceMatrixRef?.path !== 'scripts/lib/always-on-governance.js#buildHostAdapterCompatibilityMatrix') {
    issues.push(issue(
      '$.sourceMatrixRef.path',
      'MATRIX_SOURCE_PATH_MISMATCH',
      'catalog must reference the canonical compatibility matrix builder'
    ))
  }
  if (options.sourceHead && catalog?.sourceMatrixRef?.sourceHead !== options.sourceHead) {
    issues.push(issue(
      '$.sourceMatrixRef.sourceHead',
      'CATALOG_SOURCE_STALE',
      'catalog sourceHead does not match the expected matrix source'
    ))
  }

  const matrix = options.matrix
  if (matrix) {
    if (matrix.schemaVersion !== 'HostAdapterCompatibilityMatrixV1' || matrix.validation?.valid !== true) {
      issues.push(issue('$.sourceMatrixRef', 'MATRIX_INVALID', 'compatibility matrix must be valid HostAdapterCompatibilityMatrixV1'))
    }
    if (catalog?.sourceMatrixRef?.matrixId !== matrix.matrixId) {
      issues.push(issue('$.sourceMatrixRef.matrixId', 'CATALOG_SOURCE_STALE', 'catalog matrixId is stale'))
    }
    const matrixHosts = Array.isArray(matrix.hosts) ? matrix.hosts : []
    const expectedVariants = matrixHosts.filter(host => host.scope !== 'unsupported').map(host => host.hostId)
    const expectedUnsupported = matrixHosts.filter(host => host.scope === 'unsupported').map(host => host.hostId)
    const actualUnsupported = (catalog.unsupportedSurfaces || []).map(item => item.hostSurfaceOrVariant)
    for (const variant of expectedVariants.filter(variant => !variants.includes(variant))) {
      issues.push(issue('$.entries', 'CATALOG_VARIANT_MISSING', `catalog is missing ${variant}`))
    }
    for (const variant of variants.filter(variant => !expectedVariants.includes(variant))) {
      issues.push(issue('$.entries', 'CATALOG_VARIANT_EXTRA', `catalog contains out-of-scope ${variant}`))
    }
    for (const variant of expectedUnsupported.filter(variant => !actualUnsupported.includes(variant))) {
      issues.push(issue('$.unsupportedSurfaces', 'UNSUPPORTED_SURFACE_MISSING', `unsupported surface is missing ${variant}`))
    }
    for (const variant of actualUnsupported.filter(variant => !expectedUnsupported.includes(variant))) {
      issues.push(issue('$.unsupportedSurfaces', 'UNSUPPORTED_SURFACE_EXTRA', `unsupported surface is not matrix-backed: ${variant}`))
    }
  }

  return dedupeIssues(issues)
}

function buildHostLeverCatalogReceipt(catalog, options = {}) {
  const issues = validateHostLeverCatalog(catalog, options)
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : []
  const unsupported = Array.isArray(catalog?.unsupportedSurfaces) ? catalog.unsupportedSurfaces : []
  return {
    schemaVersion: 'HostLeverCatalogValidationReceiptV1',
    catalogVersion: catalog?.catalogVersion || null,
    catalogDigest: catalog ? `sha256:${sha256(stableStringify(catalog))}` : null,
    coverage: {
      inScopeVariantCount: entries.length,
      uniqueVariantCount: new Set(entries.map(entry => entry.hostSurfaceOrVariant)).size,
      logicalHostCount: new Set(entries.map(entry => entry.hostId)).size,
      unsupportedCount: unsupported.length
    },
    issues,
    openBlockers: issues.length,
    passed: issues.length === 0
  }
}

function evaluateCatalogEntryFreshness(entry, options = {}) {
  const evidence = entry?.evidence
  const lease = evidence?.evidenceLease
  const reasons = []
  if (!evidence || !lease) return { status: 'stale', fresh: false, reasons: ['evidence-missing'] }
  if (evidence.evidenceStatus === 'UNVERIFIED' || lease.kind === 'unverified' || lease.duration === 'P0D') {
    return { status: 'unverified', fresh: false, reasons: ['evidence-unverified'] }
  }
  if (lease.duration === 'source-bound') {
    const expectedSourceHead = options.sourceHead
    if (!expectedSourceHead || lease.sourceHead !== expectedSourceHead) reasons.push('source-head-mismatch')
  } else {
    const durationMs = LEASE_DURATION_MS[lease.duration]
    const checkedAt = Date.parse(evidence.evidenceCheckedAt)
    const now = options.now === undefined ? Date.now() : Number(new Date(options.now))
    if (!durationMs || Number.isNaN(checkedAt) || Number.isNaN(now)) reasons.push('lease-invalid')
    else if (checkedAt > now + 5 * 60 * 1000) reasons.push('evidence-from-future')
    else if (now - checkedAt > durationMs) reasons.push('evidence-expired')
  }
  return {
    status: reasons.length ? 'stale' : 'fresh',
    fresh: reasons.length === 0,
    reasons
  }
}

function evaluateNativeEligibility(entry, options = {}) {
  const freshness = evaluateCatalogEntryFreshness(entry, options)
  const lifecycleValues = Object.values(entry?.lifecycle || {})
  const lifecycleState = lifecycleValues.length === 4 && lifecycleValues.every(step => step?.observable === true)
    ? 'complete'
    : 'incomplete'
  const permissionDelta = entry?.permission?.permissionDelta
  const permissionState = ['none', 'bounded'].includes(permissionDelta)
    ? 'safe'
    : permissionDelta === 'elevated'
      ? 'unsafe'
      : 'unknown'
  let reasonCode = 'NOT_REQUIRED'
  let status = 'eligible'

  if (!entry || ['none', 'launcher'].includes(entry.leverType) || entry?.eligibility?.status === 'portable-only') {
    status = 'ineligible'
    reasonCode = 'NATIVE_NOT_PHASE1'
  } else if (entry?.eligibility?.status === 'unverified' || freshness.status === 'unverified' || entry?.evidence?.evidenceStatus !== 'PASS') {
    status = 'unverified'
    reasonCode = 'NATIVE_EVIDENCE_UNVERIFIED'
  } else if (!freshness.fresh) {
    status = 'ineligible'
    reasonCode = 'NATIVE_EVIDENCE_STALE'
  } else if (entry?.eligibility?.status === 'blocked') {
    status = 'ineligible'
    reasonCode = 'NATIVE_PERMISSION_UNSAFE'
  } else if (options.allowNativeInvocation !== true) {
    status = 'ineligible'
    reasonCode = 'NATIVE_NOT_PHASE1'
  } else if (entry?.evidence?.evidenceLease?.kind !== 'direct-host-replay') {
    status = 'unverified'
    reasonCode = 'NATIVE_EVIDENCE_UNVERIFIED'
  } else if (lifecycleState !== 'complete') {
    status = 'ineligible'
    reasonCode = 'NATIVE_LIFECYCLE_INCOMPLETE'
  } else if (permissionState !== 'safe') {
    status = 'ineligible'
    reasonCode = 'NATIVE_PERMISSION_UNSAFE'
  } else if (entry?.eligibility?.requiresExplicitUserAuthority && options.explicitUserAuthority !== true) {
    status = 'ineligible'
    reasonCode = 'NATIVE_AUTHORITY_MISSING'
  }

  return {
    status,
    reasonCode,
    evidenceState: freshness.status,
    permissionState,
    lifecycleState,
    eligible: status === 'eligible',
    freshness
  }
}

function fallbackReceipt(reasonCode, options = {}) {
  return {
    schemaVersion: 'HostCapabilityRoutingReceiptV1',
    query: {
      hostId: options.hostId || null,
      hostSurfaceOrVariant: options.hostSurfaceOrVariant || null,
      capabilityFamilyId: options.capabilityFamilyId || 'planning',
      leverVersion: options.leverVersion || null
    },
    classification: reasonCode === 'HOST_UNSUPPORTED' ? 'unsupported' : 'portable',
    entryKey: null,
    catalogVersion: options.catalog?.catalogVersion || null,
    catalogFileDigest: options.catalog ? `sha256:${sha256(stableStringify(options.catalog))}` : null,
    nativeEligibility: {
      status: reasonCode === 'HOST_UNSUPPORTED' ? 'unsupported' : 'not-evaluated',
      reasonCode,
      evidenceState: reasonCode === 'HOST_UNSUPPORTED' ? 'unsupported' : 'missing',
      permissionState: 'not-evaluated',
      lifecycleState: 'not-evaluated',
      eligible: false
    },
    fallback: {
      applied: true,
      reasonCode,
      target: 'portable',
      retryable: false
    },
    mcpRequired: false,
    safe: true,
    issues: options.issues || [],
    validationOwner: 'host-capability-routing'
  }
}

function resolveHostCapabilityLever(options = {}) {
  const {
    catalog,
    matrix,
    hostId,
    hostSurfaceOrVariant,
    capabilityFamilyId = 'planning',
    leverVersion
  } = options
  if (!catalog || !matrix) return fallbackReceipt('CATALOG_UNAVAILABLE', options)

  const catalogReceipt = buildHostLeverCatalogReceipt(catalog, {
    matrix,
    sourceHead: options.sourceHead
  })
  if (!catalogReceipt.passed) {
    const codes = new Set(catalogReceipt.issues.map(item => item.code))
    const reasonCode = codes.has('CATALOG_DUPLICATE_KEY')
      ? 'CATALOG_DUPLICATE_KEY'
      : codes.has('CATALOG_SOURCE_STALE')
        ? 'CATALOG_SOURCE_STALE'
        : 'CATALOG_UNAVAILABLE'
    return fallbackReceipt(reasonCode, { ...options, issues: catalogReceipt.issues })
  }

  const unsupported = (catalog.unsupportedSurfaces || []).find(item =>
    item.hostSurfaceOrVariant === hostSurfaceOrVariant
  )
  if (unsupported) return fallbackReceipt('HOST_UNSUPPORTED', options)

  const matches = (catalog.entries || []).filter(entry =>
    entry.hostId === hostId &&
    entry.hostSurfaceOrVariant === hostSurfaceOrVariant &&
    entry.capabilityFamilyId === capabilityFamilyId &&
    (!leverVersion || entry.leverVersion === leverVersion)
  )
  if (matches.length !== 1) {
    const reasonCode = matches.length > 1 ? 'CATALOG_DUPLICATE_KEY' : 'HOST_VARIANT_UNKNOWN'
    return fallbackReceipt(reasonCode, options)
  }

  const entry = matches[0]
  const nativeEligibility = evaluateNativeEligibility(entry, {
    now: options.now,
    sourceHead: options.sourceHead || catalog.sourceMatrixRef.sourceHead,
    explicitUserAuthority: options.explicitUserAuthority,
    allowNativeInvocation: options.allowNativeInvocation
  })
  const reasonCode = nativeEligibility.reasonCode
  return {
    schemaVersion: 'HostCapabilityRoutingReceiptV1',
    query: {
      hostId,
      hostSurfaceOrVariant,
      capabilityFamilyId,
      leverVersion: entry.leverVersion
    },
    classification: nativeEligibility.eligible ? 'native-eligible' : 'portable',
    entryKey: catalogEntryKey(entry),
    catalogVersion: catalog.catalogVersion,
    catalogFileDigest: `sha256:${sha256(stableStringify(catalog))}`,
    nativeEligibility,
    fallback: {
      applied: !nativeEligibility.eligible,
      reasonCode: nativeEligibility.eligible ? 'NOT_REQUIRED' : reasonCode,
      target: 'portable',
      retryable: false
    },
    mcpRequired: false,
    safe: true,
    issues: [],
    validationOwner: 'host-capability-routing'
  }
}

function capabilityDecisionCore(decision) {
  const core = {}
  for (const [key, value] of Object.entries(decision || {})) {
    if (!['decisionId', 'reason'].includes(key)) core[key] = value
  }
  return core
}

function computeCapabilityDecisionId(decision) {
  return `sha256:${sha256(stableStringify(capabilityDecisionCore(decision)))}`
}

function validateCapabilityIntentDecision(decision, options = {}) {
  const issues = validateAgainstSchema(decision, SCHEMAS.capabilityIntentDecision)
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return issues
  if (['direct', 'auto_authorized'].includes(decision.selectedPortableDecision) && decision.confidence !== 'high') {
    issues.push(issue(
      '$.confidence',
      'INTENT_CONFIDENCE_LOW',
      `${decision.selectedPortableDecision} requires high confidence`
    ))
  }
  if (decision.selectedPortableDecision === 'auto_authorized' && !decision.autoAuthorityRef) {
    issues.push(issue('$.autoAuthorityRef', 'AUTO_AUTHORITY_MISSING', 'auto_authorized requires an existing authority reference'))
  }
  if (decision.selectedPortableDecision !== 'auto_authorized' && decision.autoAuthorityRef !== null) {
    issues.push(issue('$.autoAuthorityRef', 'AUTO_AUTHORITY_UNEXPECTED', 'only auto_authorized may carry autoAuthorityRef'))
  }
  const invariants = new Set(decision.appliedInvariantIds || [])
  for (const invariant of REQUIRED_SECURITY_INVARIANTS) {
    if (!invariants.has(invariant)) {
      issues.push(issue(
        '$.appliedInvariantIds',
        'MANDATORY_INVARIANT_MISSING',
        `${invariant} must remain applied`
      ))
    }
  }
  if (['dev', 'fix', 'self-fix'].includes(decision.workflowIntent)) {
    for (const cp of ['CP1', 'CP2']) {
      if (!invariants.has(cp)) {
        issues.push(issue('$.appliedInvariantIds', 'MANDATORY_CP_MISSING', `${cp} must remain applied`))
      }
    }
  }
  if (decision.nativeEligibility?.status === 'eligible' && !decision.nativeEligibility.leverRef) {
    issues.push(issue('$.nativeEligibility.leverRef', 'NATIVE_LEVER_REF_MISSING', 'eligible native decision requires leverRef'))
  }
  if (decision.nativeEligibility?.status !== 'eligible' && decision.fallback?.applied !== true) {
    issues.push(issue('$.fallback.applied', 'PORTABLE_FALLBACK_REQUIRED', 'non-eligible native state must apply portable fallback'))
  }
  if (decision.fallback?.applied === false && decision.fallback?.reasonCode !== 'NOT_REQUIRED') {
    issues.push(issue('$.fallback.reasonCode', 'FALLBACK_REASON_INCONSISTENT', 'non-applied fallback must use NOT_REQUIRED'))
  }
  if (options.verifyDecisionId !== false && decision.decisionId !== computeCapabilityDecisionId(decision)) {
    issues.push(issue('$.decisionId', 'DECISION_DIGEST_MISMATCH', 'decisionId does not match the decision core'))
  }
  return dedupeIssues(issues)
}

function validateTaggedDigest(tagged, pathValue, options = {}) {
  const issues = []
  if (!tagged) return issues
  const allowed = options.projection
    ? {
        sha256: { strength: 'strong', pattern: /^[a-f0-9]{64}$/ },
        unavailable: { strength: 'none', value: null }
      }
    : {
        sha256: { strength: 'strong', pattern: /^[a-f0-9]{64}$/ },
        'fnv1a32-compat': { strength: 'compat', pattern: /^[a-f0-9]{8}$/ },
        unavailable: { strength: 'none', value: null }
      }
  const contract = allowed[tagged.algorithm]
  if (!contract) return issues
  if (tagged.strength !== contract.strength) {
    issues.push(issue(`${pathValue}.strength`, 'DIGEST_STRENGTH_MISMATCH', `${tagged.algorithm} requires ${contract.strength}`))
  }
  if (Object.prototype.hasOwnProperty.call(contract, 'value')) {
    if (tagged.value !== contract.value) {
      issues.push(issue(`${pathValue}.value`, 'DIGEST_VALUE_MISMATCH', `${tagged.algorithm} requires a null value`))
    }
  } else if (typeof tagged.value !== 'string' || !contract.pattern.test(tagged.value)) {
    issues.push(issue(`${pathValue}.value`, 'DIGEST_VALUE_INVALID', `${tagged.algorithm} digest has an invalid value`))
  }
  return issues
}

function computeProjectionDigest(controlledSummary) {
  return sha256(normalizeInstructionText(controlledSummary))
}

function validateOriginalInstructionRef(instructionRef, options = {}) {
  const issues = validateAgainstSchema(instructionRef, SCHEMAS.originalInstructionRef)
  if (!instructionRef || typeof instructionRef !== 'object' || Array.isArray(instructionRef)) return issues
  issues.push(...validateTaggedDigest(instructionRef.sourceDigest, '$.sourceDigest'))
  issues.push(...validateTaggedDigest(instructionRef.projectionDigest, '$.projectionDigest', { projection: true }))

  const strength = instructionRef.sourceDigest?.strength
  const authority = instructionRef.authority
  if (['digest-bound-cp-artifact', 'managed-task-source'].includes(authority) && strength !== 'strong') {
    issues.push(issue('$.sourceDigest.strength', 'INSTRUCTION_AUTHORITY_TOO_WEAK', `${authority} requires a strong digest`))
  }
  if (authority === 'governance-intake-anchor' && strength !== 'compat') {
    issues.push(issue('$.sourceDigest.strength', 'INSTRUCTION_AUTHORITY_MISMATCH', 'governance intake anchor must remain compat'))
  }
  if (authority === 'unavailable' && strength !== 'none') {
    issues.push(issue('$.sourceDigest.strength', 'INSTRUCTION_AUTHORITY_MISMATCH', 'unavailable authority requires none strength'))
  }
  if (strength === 'strong' && !instructionRef.sourceRef) {
    issues.push(issue('$.sourceRef', 'INSTRUCTION_SOURCE_MISSING', 'strong authority requires a reread locator'))
  }
  if (instructionRef.freshness?.status === 'fresh' && instructionRef.freshness?.readbackVerified !== true) {
    issues.push(issue('$.freshness.readbackVerified', 'INSTRUCTION_READBACK_REQUIRED', 'fresh authority requires verified readback'))
  }
  if (instructionRef.projectionDigest?.algorithm === 'sha256') {
    const expected = computeProjectionDigest(instructionRef.controlledSummary)
    if (instructionRef.projectionDigest.value !== expected) {
      issues.push(issue('$.projectionDigest.value', 'PROJECTION_DIGEST_MISMATCH', 'projectionDigest does not match controlledSummary'))
    }
  }
  if (options.expectedSourceDigest && instructionRef.sourceDigest?.value !== options.expectedSourceDigest) {
    issues.push(issue('$.sourceDigest.value', 'INSTRUCTION_DIGEST_MISMATCH', 'source digest does not match reread evidence'))
  }
  const weakCrossTurn = options.forCrossTurnMutation === true && (
    ['compat', 'none'].includes(strength) ||
    ['conversation-visible', 'unavailable'].includes(authority) ||
    instructionRef.freshness?.readbackVerified !== true
  )
  if (weakCrossTurn) {
    issues.push(issue(
      '$.authority',
      'INSTRUCTION_AUTHORITY_TOO_WEAK',
      'cross-turn mutation requires a reread strong host/CP/task authority'
    ))
  }
  const sourceUnavailable = strength === 'none' || authority === 'unavailable'
  const sourceNotFresh = ['stale', 'unverified'].includes(instructionRef.freshness?.status)
  if ((sourceUnavailable || sourceNotFresh) && instructionRef.fallback?.stopMutation !== true) {
    issues.push(issue('$.fallback.stopMutation', 'INSTRUCTION_STOP_REQUIRED', 'missing or stale instruction source must stop mutation'))
  }
  if (sourceUnavailable && instructionRef.fallback?.requestRestatement !== true) {
    issues.push(issue('$.fallback.requestRestatement', 'INSTRUCTION_RESTATEMENT_REQUIRED', 'unavailable source requires restatement'))
  }
  return dedupeIssues(issues)
}

module.exports = {
  REQUIRED_INVALIDATION_TRIGGERS,
  REQUIRED_SECURITY_INVARIANTS,
  SCHEMAS,
  buildHostLeverCatalogReceipt,
  capabilityDecisionCore,
  catalogEntryKey,
  computeCapabilityDecisionId,
  computeProjectionDigest,
  evaluateCatalogEntryFreshness,
  evaluateNativeEligibility,
  logicalHostIdForVariant,
  normalizeInstructionText,
  resolveHostCapabilityLever,
  sha256,
  stableStringify,
  validateCapabilityIntentDecision,
  validateHostLeverCatalog,
  validateOriginalInstructionRef
}
