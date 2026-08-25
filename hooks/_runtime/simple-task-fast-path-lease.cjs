'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { stableDigest } = require('./context-read-contract.cjs')
const {
  inspectTarget,
  readLayeredArtifactSlotRegistry
} = require('./artifact-slot-decision.cjs')

const SIMPLE_TASK_FAST_PATH_LEASE_SCHEMA = 'SimpleTaskFastPathLeaseV1'
const SIMPLE_TASK_FAST_PATH_USAGE_SCHEMA = 'SimpleTaskFastPathUsageV1'
const DEFAULT_LEASE_MS = 10 * 60 * 1000
const MAX_TARGETS = 2
const MAX_USES = 2
const DIGEST_RE = /^[a-f0-9]{64}$/
const ALLOWED_TOP_INTENTS = new Set(['dev', 'fix', 'self-fix'])
const ALLOWED_CHANGE_CLASSES = new Set(['narrative-markdown', 'local-implementation'])
const RISK_FIELDS = Object.freeze([
  'crossModule',
  'sharedContract',
  'publicApiOrSchema',
  'securitySensitive',
  'dependencyChange',
  'releaseImpact'
])
const RISKY_PATH_SEGMENT = /(?:^|\/)(?:api|reference|configuration|config|schema|security|auth|crypto|permission|policy|contract|protocol|release|migration)(?:[./_-]|\/|$)/i

class SimpleTaskFastPathLeaseError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'SimpleTaskFastPathLeaseError'
    this.code = code
    this.details = details
  }
}

function comparable(value) {
  const normalized = path.normalize(path.resolve(String(value || '')))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function normalizeProjectRelativeTarget(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/')
  if (!raw || raw.length > 512 || path.isAbsolute(raw) || /^[a-z]:/i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_TARGET_INVALID',
      'simple-task targets must be bounded project-root-relative paths'
    )
  }
  const parts = raw.split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..')) {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_TARGET_INVALID',
      'simple-task targets cannot contain empty, dot or parent segments'
    )
  }
  return parts.join('/')
}

function normalizeProjectRelativeTargets(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_TARGETS) {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_TARGET_COUNT_INVALID',
      `simple-task target count must be between 1 and ${MAX_TARGETS}`
    )
  }
  const normalized = values.map(normalizeProjectRelativeTarget)
  const unique = new Set(normalized.map(value => process.platform === 'win32' ? value.toLowerCase() : value))
  if (unique.size !== normalized.length) {
    throw new SimpleTaskFastPathLeaseError('SIMPLE_TASK_TARGET_DUPLICATE', 'simple-task targets must be unique')
  }
  return normalized.sort((left, right) => left.localeCompare(right, 'en'))
}

function normalizeRiskAssessment(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!raw || !ALLOWED_CHANGE_CLASSES.has(String(raw.changeClass || ''))) {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_RISK_ASSESSMENT_REQUIRED',
      'simple-task authority requires one explicit bounded change class and all risk flags'
    )
  }
  const assessment = { changeClass: String(raw.changeClass) }
  for (const field of RISK_FIELDS) {
    if (typeof raw[field] !== 'boolean') {
      throw new SimpleTaskFastPathLeaseError(
        'SIMPLE_TASK_RISK_ASSESSMENT_REQUIRED',
        `simple-task risk assessment is missing boolean ${field}`
      )
    }
    assessment[field] = raw[field]
  }
  const raised = RISK_FIELDS.filter(field => assessment[field] === true)
  if (raised.length) {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_RISK_UPGRADE_REQUIRED',
      `simple-task risk requires formal admission: ${raised.join(', ')}`,
      { raised }
    )
  }
  return assessment
}

function stateBinding(state = {}) {
  const sticky = state.stickyProject || {}
  const envelope = state.actualInstructionEnvelope || {}
  const route = state.workflowRouteDecision || {}
  const turn = state.turnLiveness || {}
  return {
    project: String(state.activeProject || ''),
    projectTargetLeaseDigest: String(sticky.leaseDigest || ''),
    projectRootIdentityDigest: String(sticky.rootIdentityDigest || ''),
    sessionDigest: String(sticky.authorityDigest || ''),
    turnKey: String(turn.turnKey || ''),
    contextEpoch: String(envelope.contextEpoch || state.contextAcquisition?.contextEpoch || ''),
    instructionEnvelopeDigest: String(envelope.envelopeDigest || ''),
    actualInstructionDigest: String(envelope.actualInstructionDigest || ''),
    routeDecisionDigest: String(route.decisionDigest || ''),
    routeRevision: String(route.routeRevision || ''),
    routeKey: String(route.routeKey || ''),
    topIntent: String(route.topIntent || ''),
    subtype: String(route.subtype || '')
  }
}

function assertStateBindingComplete(binding) {
  const missing = []
  for (const field of [
    'project', 'projectTargetLeaseDigest', 'projectRootIdentityDigest', 'sessionDigest', 'turnKey',
    'contextEpoch', 'instructionEnvelopeDigest', 'actualInstructionDigest', 'routeDecisionDigest',
    'routeRevision', 'routeKey', 'topIntent'
  ]) if (!binding[field]) missing.push(field)
  for (const field of [
    'projectTargetLeaseDigest', 'projectRootIdentityDigest', 'sessionDigest',
    'instructionEnvelopeDigest', 'actualInstructionDigest', 'routeDecisionDigest', 'routeRevision'
  ]) if (binding[field] && !DIGEST_RE.test(binding[field])) missing.push(`${field}:digest`)
  if (missing.length || !ALLOWED_TOP_INTENTS.has(binding.topIntent)) {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_BINDING_INCOMPLETE',
      `simple-task authority requires exact dev/fix project, session, instruction, context and route binding: ${missing.join(', ') || binding.topIntent}`,
      { missing, topIntent: binding.topIntent }
    )
  }
}

function moduleBoundaryFor(relativePath, changeClass) {
  const parts = relativePath.split('/')
  if (changeClass === 'narrative-markdown') {
    if (parts.length === 1 && /^README[^/]*\.md$/i.test(parts[0])) return 'docs:root-readme'
    return `docs:${parts.slice(0, Math.min(2, parts.length - 1)).join('/') || parts[0]}`
  }
  const root = String(parts[0] || '').toLowerCase()
  const nested = parts.length > 2 ? String(parts[1] || '').toLowerCase() : ''
  return `implementation:${root}${nested ? `/${nested}` : ''}`
}

function classifySimpleTaskTargets(input = {}, options = {}) {
  const fsImpl = options.fs || fs
  const activeRoot = path.resolve(String(input.activeRoot || ''))
  const projectRoot = path.resolve(String(input.projectRoot || ''))
  const relativeTargets = normalizeProjectRelativeTargets(input.relativeTargets)
  const operation = String(input.operation || '')
  if (operation !== 'create-or-update') {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_OPERATION_FORBIDDEN',
      'simple-task authority only supports bounded create-or-update mutations; delete, move and indirect operations require formal admission'
    )
  }
  const assessment = normalizeRiskAssessment(input.riskAssessment)
  const registry = readLayeredArtifactSlotRegistry({ activeRoot, project: input.project, fs: fsImpl })
  const inspected = relativeTargets.map(relativePath => {
    const absolutePath = path.resolve(projectRoot, ...relativePath.split('/'))
    if (!isInside(projectRoot, absolutePath)) {
      throw new SimpleTaskFastPathLeaseError('SIMPLE_TASK_TARGET_ESCAPE', `simple-task target escapes project root: ${relativePath}`)
    }
    const target = inspectTarget(absolutePath, { activeRoot, projectRoot }, registry, {
      cwd: projectRoot,
      fs: fsImpl
    })
    const slot = target.classified?.slot
    if (!slot || slot.scope !== 'project' || slot.owner !== 'task-owner' ||
        !['project-public-docs', 'project-source'].includes(slot.slotId)) {
      throw new SimpleTaskFastPathLeaseError(
        'SIMPLE_TASK_SLOT_FORBIDDEN',
        `simple-task target requires formal or dedicated authority: ${relativePath} (${slot?.slotId || target.classified?.matchType || target.status})`,
        { relativePath, slotId: slot?.slotId || null }
      )
    }
    if (slot.slotId === 'project-public-docs') {
      if (assessment.changeClass !== 'narrative-markdown' || !/\.md$/i.test(relativePath) ||
          /^CHANGELOG/i.test(relativePath) || RISKY_PATH_SEGMENT.test(relativePath)) {
        throw new SimpleTaskFastPathLeaseError(
          'SIMPLE_TASK_PUBLIC_CONTRACT_FORBIDDEN',
          `public API/config/schema/security/release documentation requires formal admission: ${relativePath}`
        )
      }
    } else {
      if (assessment.changeClass !== 'local-implementation' || !/^(?:src|lib)\//i.test(relativePath) ||
          /\.d\.ts$/i.test(relativePath) || RISKY_PATH_SEGMENT.test(relativePath)) {
        throw new SimpleTaskFastPathLeaseError(
          'SIMPLE_TASK_CONTROL_OR_SHARED_CONTRACT_FORBIDDEN',
          `control-plane, public-contract or non-local source requires formal admission: ${relativePath}`
        )
      }
    }
    return {
      relativePath,
      absolutePath,
      slotId: slot.slotId,
      artifactClass: slot.artifactClass,
      moduleBoundary: moduleBoundaryFor(relativePath, assessment.changeClass)
    }
  })
  const moduleBoundaries = [...new Set(inspected.map(item => item.moduleBoundary))]
  const slotIds = [...new Set(inspected.map(item => item.slotId))]
  if (moduleBoundaries.length !== 1 || slotIds.length !== 1) {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_CROSS_MODULE_FORBIDDEN',
      'one simple-task lease cannot cross module or artifact-class boundaries',
      { moduleBoundaries, slotIds }
    )
  }
  if (slotIds[0] === 'project-public-docs' && input.routeSubtype !== 'docs' && input.routeKey !== 'dev.docs') {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_DOCS_ROUTE_REQUIRED',
      'narrative Markdown fast path requires the current dev.docs route'
    )
  }
  return {
    relativeTargets,
    inspected,
    slotId: slotIds[0],
    moduleBoundary: moduleBoundaries[0],
    riskAssessment: assessment,
    riskEvidenceDigest: stableDigest(assessment),
    mergedRegistryDigest: registry.mergedRegistryDigest
  }
}

function createSimpleTaskFastPathUsage(lease) {
  const semantic = {
    schemaVersion: SIMPLE_TASK_FAST_PATH_USAGE_SCHEMA,
    leaseDigest: String(lease?.leaseDigest || ''),
    targetSetDigest: String(lease?.targetSetDigest || ''),
    maxUses: Number(lease?.maxUses || 0),
    useCount: 0,
    operationIds: [],
    observedTargetSetDigests: [],
    status: 'active',
    updatedAt: String(lease?.issuedAt || '')
  }
  return Object.freeze({ ...semantic, usageDigest: stableDigest(semantic) })
}

function validateSimpleTaskFastPathUsage(value, lease, options = {}) {
  const errors = []
  if (value?.schemaVersion !== SIMPLE_TASK_FAST_PATH_USAGE_SCHEMA) errors.push('simple-task-usage-schema-invalid')
  if (value?.leaseDigest !== lease?.leaseDigest || value?.targetSetDigest !== lease?.targetSetDigest) {
    errors.push('simple-task-usage-lease-mismatch')
  }
  if (value?.maxUses !== lease?.maxUses || !Number.isInteger(value?.useCount) || value.useCount < 0 || value.useCount > value.maxUses) {
    errors.push('simple-task-usage-count-invalid')
  }
  if (!Array.isArray(value?.operationIds) || !Array.isArray(value?.observedTargetSetDigests) ||
      value.operationIds.length !== value.useCount || value.observedTargetSetDigests.length !== value.useCount ||
      new Set(value.operationIds).size !== value.operationIds.length) errors.push('simple-task-usage-history-invalid')
  if (!['active', 'consumed', 'needs-reconcile', 'revoked'].includes(value?.status)) errors.push('simple-task-usage-status-invalid')
  const { usageDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(usageDigest || '')) || stableDigest(semantic) !== usageDigest) {
    errors.push('simple-task-usage-digest-invalid')
  }
  if (options.requireActive !== false && (value?.status !== 'active' || value?.useCount >= value?.maxUses)) {
    errors.push('simple-task-usage-exhausted')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function createSimpleTaskFastPathLease(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const state = input.state || {}
  const binding = stateBinding(state)
  assertStateBindingComplete(binding)
  if (String(input.project || binding.project) !== binding.project) {
    throw new SimpleTaskFastPathLeaseError('SIMPLE_TASK_PROJECT_MISMATCH', 'requested project does not match current server-owned binding')
  }
  const classification = classifySimpleTaskTargets({
    activeRoot: input.activeRoot,
    projectRoot: input.projectRoot,
    project: binding.project,
    relativeTargets: input.relativeTargets,
    operation: input.operation,
    riskAssessment: input.riskAssessment,
    routeSubtype: binding.subtype,
    routeKey: binding.routeKey
  }, options)
  const prior = state.simpleTaskFastPathLease
  if (prior?.status === 'active' && Date.parse(String(prior.expiresAt || '')) > nowMs) {
    const priorValidation = validateSimpleTaskFastPathLease(prior, {
      state,
      activeRoot: input.activeRoot,
      projectRoot: input.projectRoot,
      relativeTargets: classification.relativeTargets,
      operation: input.operation,
      riskAssessment: classification.riskAssessment,
      skipUsage: true
    }, options)
    if (priorValidation.valid) return prior
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_ACTIVE_LEASE_CONFLICT',
      'an active simple-task lease cannot be replaced or widened before closeout',
      { errors: priorValidation.errors }
    )
  }
  const projectLeaseExpiry = Number(state.stickyProject?.expiresAtMs) || Date.parse(String(state.stickyProject?.expiresAt || ''))
  const ttlMs = Number.isFinite(options.ttlMs)
    ? Math.max(1000, Math.min(options.ttlMs, DEFAULT_LEASE_MS))
    : DEFAULT_LEASE_MS
  const expiresAtMs = Number.isFinite(projectLeaseExpiry)
    ? Math.min(nowMs + ttlMs, projectLeaseExpiry)
    : nowMs + ttlMs
  if (expiresAtMs <= nowMs) {
    throw new SimpleTaskFastPathLeaseError('SIMPLE_TASK_PROJECT_LEASE_EXPIRED', 'ProjectTargetLeaseV2 expires before a simple-task lease can be issued')
  }
  const leaseId = options.leaseIdFactory
    ? String(options.leaseIdFactory())
    : `simple-${crypto.randomBytes(20).toString('hex')}`
  if (!/^simple-[a-f0-9]{40}$/.test(leaseId)) {
    throw new SimpleTaskFastPathLeaseError('SIMPLE_TASK_LEASE_ID_INVALID', 'simple-task lease id is invalid')
  }
  const issuedAt = new Date(nowMs).toISOString()
  const semantic = {
    schemaVersion: SIMPLE_TASK_FAST_PATH_LEASE_SCHEMA,
    leaseId,
    project: binding.project,
    projectRootIdentityDigest: binding.projectRootIdentityDigest,
    projectTargetLeaseDigest: binding.projectTargetLeaseDigest,
    sessionDigest: binding.sessionDigest,
    turnKey: binding.turnKey,
    contextEpoch: binding.contextEpoch,
    instructionEnvelopeDigest: binding.instructionEnvelopeDigest,
    actualInstructionDigest: binding.actualInstructionDigest,
    routeDecisionDigest: binding.routeDecisionDigest,
    routeRevision: binding.routeRevision,
    routeKey: binding.routeKey,
    operation: String(input.operation),
    relativeTargets: classification.relativeTargets,
    targetSetDigest: stableDigest(classification.relativeTargets),
    slotId: classification.slotId,
    moduleBoundary: classification.moduleBoundary,
    riskAssessment: classification.riskAssessment,
    riskEvidenceDigest: classification.riskEvidenceDigest,
    mergedRegistryDigest: classification.mergedRegistryDigest,
    maxTargets: MAX_TARGETS,
    maxUses: MAX_USES,
    issuedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    status: 'active',
    mutationAuthority: true,
    productMutationAuthority: true,
    formalArtifactAuthority: false,
    controlPlaneAuthority: false,
    releaseAuthority: false
  }
  return Object.freeze({ ...semantic, leaseDigest: stableDigest(semantic) })
}

function footprintRelativeTargets(footprint, projectRoot) {
  const targets = Array.isArray(footprint?.normalizedTargets) ? footprint.normalizedTargets : []
  return normalizeProjectRelativeTargets(targets.map(target => {
    const absolute = path.resolve(String(target || ''))
    if (!isInside(projectRoot, absolute)) {
      throw new SimpleTaskFastPathLeaseError('SIMPLE_TASK_TARGET_ESCAPE', 'observed mutation target is outside project root')
    }
    return path.relative(projectRoot, absolute).replace(/\\/g, '/')
  }))
}

function validateSimpleTaskFastPathLease(value, input = {}, options = {}) {
  const errors = []
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (value?.schemaVersion !== SIMPLE_TASK_FAST_PATH_LEASE_SCHEMA) errors.push('simple-task-lease-schema-invalid')
  if (!/^simple-[a-f0-9]{40}$/.test(String(value?.leaseId || ''))) errors.push('simple-task-lease-id-invalid')
  for (const field of [
    'projectRootIdentityDigest', 'projectTargetLeaseDigest', 'sessionDigest', 'instructionEnvelopeDigest',
    'actualInstructionDigest', 'routeDecisionDigest', 'routeRevision', 'targetSetDigest',
    'riskEvidenceDigest', 'mergedRegistryDigest'
  ]) if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`simple-task-${field}-invalid`)
  if (!value?.project || !value?.turnKey || !value?.contextEpoch || !value?.routeKey || !value?.slotId || !value?.moduleBoundary) {
    errors.push('simple-task-identity-incomplete')
  }
  if (value?.operation !== 'create-or-update' || value?.maxTargets !== MAX_TARGETS || value?.maxUses !== MAX_USES ||
      value?.status !== 'active' || value?.mutationAuthority !== true || value?.productMutationAuthority !== true ||
      value?.formalArtifactAuthority !== false || value?.controlPlaneAuthority !== false || value?.releaseAuthority !== false) {
    errors.push('simple-task-authority-invalid')
  }
  if (!Number.isFinite(Date.parse(String(value?.issuedAt || ''))) ||
      !Number.isFinite(Date.parse(String(value?.expiresAt || ''))) || Date.parse(value.expiresAt) <= nowMs) {
    errors.push('simple-task-lease-expired')
  }
  const { leaseDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(leaseDigest || '')) || stableDigest(semantic) !== leaseDigest) errors.push('simple-task-lease-digest-invalid')
  let binding
  try {
    binding = stateBinding(input.state || {})
    assertStateBindingComplete(binding)
  } catch (error) {
    errors.push(error.code || 'simple-task-current-binding-invalid')
    binding = {}
  }
  const expected = {
    project: binding.project,
    projectRootIdentityDigest: binding.projectRootIdentityDigest,
    projectTargetLeaseDigest: binding.projectTargetLeaseDigest,
    sessionDigest: binding.sessionDigest,
    turnKey: binding.turnKey,
    contextEpoch: binding.contextEpoch,
    instructionEnvelopeDigest: binding.instructionEnvelopeDigest,
    actualInstructionDigest: binding.actualInstructionDigest,
    routeDecisionDigest: binding.routeDecisionDigest,
    routeRevision: binding.routeRevision,
    routeKey: binding.routeKey
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if ((value?.[field] ?? null) !== (expectedValue ?? null)) errors.push(`simple-task-binding-mismatch:${field}`)
  }
  const projectRoot = path.resolve(String(input.projectRoot || ''))
  let requestedTargets = input.relativeTargets
  try {
    if (!requestedTargets && input.footprint) requestedTargets = footprintRelativeTargets(input.footprint, projectRoot)
    if (requestedTargets) {
      const normalized = normalizeProjectRelativeTargets(requestedTargets)
      const allowed = new Set(normalizeProjectRelativeTargets(value?.relativeTargets || []).map(item => comparable(path.join(projectRoot, item))))
      if (normalized.some(item => !allowed.has(comparable(path.join(projectRoot, item))))) errors.push('simple-task-target-set-mismatch')
    }
  } catch (error) {
    errors.push(error.code || 'simple-task-target-set-invalid')
  }
  if (input.operation && value?.operation !== input.operation) errors.push('simple-task-operation-mismatch')
  if (input.footprint && (input.footprint.coverage !== 'complete' || input.footprint.operation !== 'create-or-update')) {
    errors.push('simple-task-footprint-invalid')
  }
  try {
    const classification = classifySimpleTaskTargets({
      activeRoot: input.activeRoot,
      projectRoot,
      project: binding.project,
      relativeTargets: value?.relativeTargets,
      operation: value?.operation,
      riskAssessment: value?.riskAssessment,
      routeSubtype: binding.subtype,
      routeKey: binding.routeKey
    }, options)
    if (classification.slotId !== value?.slotId || classification.moduleBoundary !== value?.moduleBoundary ||
        classification.riskEvidenceDigest !== value?.riskEvidenceDigest ||
        classification.mergedRegistryDigest !== value?.mergedRegistryDigest) errors.push('simple-task-classification-drift')
  } catch (error) {
    errors.push(error.code || 'simple-task-classification-invalid')
  }
  if (input.riskAssessment) {
    try {
      if (stableDigest(normalizeRiskAssessment(input.riskAssessment)) !== value?.riskEvidenceDigest) {
        errors.push('simple-task-risk-assessment-mismatch')
      }
    } catch (error) {
      errors.push(error.code || 'simple-task-risk-assessment-invalid')
    }
  }
  if (input.skipUsage !== true) {
    const usageValidation = validateSimpleTaskFastPathUsage(input.usage, value)
    if (!usageValidation.valid) errors.push(...usageValidation.errors)
    if (input.operationId && input.usage?.operationIds?.includes(input.operationId)) errors.push('simple-task-operation-replay')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], lease: value || null }
}

function consumeSimpleTaskFastPathUsage(usage, input = {}) {
  const validation = validateSimpleTaskFastPathUsage(usage, input.lease)
  if (!validation.valid) {
    throw new SimpleTaskFastPathLeaseError(
      'SIMPLE_TASK_USAGE_INVALID',
      `simple-task usage cannot be consumed: ${validation.errors.join(', ')}`,
      { errors: validation.errors }
    )
  }
  const operationId = String(input.operationId || '')
  const targetSetDigest = String(input.observedTargetSetDigest || '')
  if (!operationId || !DIGEST_RE.test(targetSetDigest) || usage.operationIds.includes(operationId)) {
    throw new SimpleTaskFastPathLeaseError('SIMPLE_TASK_USAGE_CLOSEOUT_INVALID', 'simple-task closeout requires one new operation and exact target-set digest')
  }
  const useCount = usage.useCount + 1
  const status = input.needsReconcile === true
    ? 'needs-reconcile'
    : (useCount >= usage.maxUses ? 'consumed' : 'active')
  const semantic = {
    schemaVersion: SIMPLE_TASK_FAST_PATH_USAGE_SCHEMA,
    leaseDigest: usage.leaseDigest,
    targetSetDigest: usage.targetSetDigest,
    maxUses: usage.maxUses,
    useCount,
    operationIds: [...usage.operationIds, operationId],
    observedTargetSetDigests: [...usage.observedTargetSetDigests, targetSetDigest],
    status,
    updatedAt: String(input.completedAt || new Date().toISOString())
  }
  return Object.freeze({ ...semantic, usageDigest: stableDigest(semantic) })
}

module.exports = {
  MAX_SIMPLE_TASK_TARGETS: MAX_TARGETS,
  MAX_SIMPLE_TASK_USES: MAX_USES,
  SIMPLE_TASK_FAST_PATH_LEASE_SCHEMA,
  SIMPLE_TASK_FAST_PATH_USAGE_SCHEMA,
  SimpleTaskFastPathLeaseError,
  classifySimpleTaskTargets,
  consumeSimpleTaskFastPathUsage,
  createSimpleTaskFastPathLease,
  createSimpleTaskFastPathUsage,
  normalizeProjectRelativeTarget,
  normalizeProjectRelativeTargets,
  normalizeRiskAssessment,
  validateSimpleTaskFastPathLease,
  validateSimpleTaskFastPathUsage
}
