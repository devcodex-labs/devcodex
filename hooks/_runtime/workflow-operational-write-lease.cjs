'use strict'

const fs = require('fs')
const crypto = require('crypto')
const path = require('path')

const { stableDigest } = require('./context-read-contract.cjs')
const {
  inspectTarget,
  readLayeredArtifactSlotRegistry
} = require('./artifact-slot-decision.cjs')

const WORKFLOW_OPERATIONAL_WRITE_LEASE_SCHEMA = 'WorkflowOperationalWriteLeaseV1'
const DEFAULT_LEASE_MS = 5 * 60 * 1000
const MAX_TARGETS = 4
const DIGEST_RE = /^[a-f0-9]{64}$/
const ALLOWED_OPERATIONS = new Set(['create', 'append', 'update'])
const ALLOWED_SLOT_OPERATIONS = Object.freeze({
  'task-report': new Set(['create']),
  'task-memory': new Set(['create', 'append']),
  'task-evidence': new Set(['create']),
  'project-report': new Set(['create']),
  'project-memory-physical': new Set(['create', 'append']),
  'project-governance-ledger': new Set(['append']),
  'runtime-operational-state': new Set(['create', 'update'])
})

class WorkflowOperationalWriteLeaseError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'WorkflowOperationalWriteLeaseError'
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

function normalizeRelativeTarget(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/')
  if (!raw || raw.length > 512 || path.isAbsolute(raw) || /^[a-z]:/i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_TARGET_INVALID',
      'operational targets must be bounded active-root-relative paths'
    )
  }
  const parts = raw.split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..')) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_TARGET_INVALID',
      'operational targets cannot contain empty, dot or parent segments'
    )
  }
  return parts.join('/')
}

function normalizeRelativeTargets(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_TARGETS) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_TARGET_COUNT_INVALID',
      `operational target count must be between 1 and ${MAX_TARGETS}`
    )
  }
  const normalized = values.map(normalizeRelativeTarget)
  const unique = [...new Set(normalized.map(value => process.platform === 'win32' ? value.toLowerCase() : value))]
  if (unique.length !== normalized.length) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_TARGET_DUPLICATE',
      'operational targets must be unique'
    )
  }
  return normalized.sort((left, right) => left.localeCompare(right, 'en'))
}

function operationalTargetSetDigest(relativeTargets) {
  return stableDigest(normalizeRelativeTargets(relativeTargets))
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
    routeDecisionDigest: String(route.decisionDigest || ''),
    routeRevision: String(route.routeRevision || ''),
    taskId: String(state.taskRecoveryBinding?.taskId || '').trim().toLowerCase(),
    taskRoot: String(state.taskRecoveryBinding?.taskRoot || '')
  }
}

function assertStateBindingComplete(binding) {
  const missing = []
  for (const field of [
    'project', 'projectTargetLeaseDigest', 'projectRootIdentityDigest', 'sessionDigest', 'turnKey',
    'contextEpoch', 'instructionEnvelopeDigest', 'routeDecisionDigest', 'routeRevision'
  ]) if (!binding[field]) missing.push(field)
  for (const field of [
    'projectTargetLeaseDigest', 'projectRootIdentityDigest', 'sessionDigest',
    'instructionEnvelopeDigest', 'routeDecisionDigest', 'routeRevision'
  ]) if (binding[field] && !DIGEST_RE.test(binding[field])) missing.push(`${field}:digest`)
  if (missing.length) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_BINDING_INCOMPLETE',
      `operational lease requires exact project/session/turn/context/route authority: ${missing.join(', ')}`,
      { missing }
    )
  }
}

function classifyOperationalTargets(input = {}, options = {}) {
  const fsImpl = options.fs || fs
  const activeRoot = path.resolve(String(input.activeRoot || ''))
  const projectRoot = path.resolve(String(input.projectRoot || process.cwd()))
  const relativeTargets = normalizeRelativeTargets(input.relativeTargets)
  const operation = String(input.operation || '')
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_OPERATION_INVALID',
      'operational writes only support create, append or update'
    )
  }
  const registry = readLayeredArtifactSlotRegistry({
    activeRoot,
    project: input.project,
    fs: fsImpl
  })
  const taskBinding = input.taskBinding || {}
  const inspected = relativeTargets.map(relativePath => {
    const absolutePath = path.resolve(activeRoot, ...relativePath.split('/'))
    if (!isInside(activeRoot, absolutePath)) {
      throw new WorkflowOperationalWriteLeaseError(
        'WORKFLOW_OPERATIONAL_TARGET_ESCAPE',
        `operational target escapes the active root: ${relativePath}`
      )
    }
    const target = inspectTarget(absolutePath, { activeRoot, projectRoot }, registry, {
      cwd: projectRoot,
      fs: fsImpl
    })
    const slot = target.classified?.slot
    const allowedOperations = slot ? ALLOWED_SLOT_OPERATIONS[slot.slotId] : null
    if (!slot || !allowedOperations?.has(operation)) {
      throw new WorkflowOperationalWriteLeaseError(
        'WORKFLOW_OPERATIONAL_SLOT_FORBIDDEN',
        `operational lease cannot authorize ${relativePath} (${slot?.slotId || target.classified?.matchType || target.status})`,
        { relativePath, slotId: slot?.slotId || null, matchType: target.classified?.matchType || null }
      )
    }
    if (slot.slotId === 'runtime-operational-state' && !relativePath.startsWith('.audit-state/')) {
      throw new WorkflowOperationalWriteLeaseError(
        'WORKFLOW_OPERATIONAL_RUNTIME_PATH_FORBIDDEN',
        'workflow operational authority cannot write lifecycle hooks, locks, projections or runtime state'
      )
    }
    if (slot.scope === 'task') {
      const expectedTaskRoot = path.resolve(activeRoot, target.classified.taskKind, target.classified.taskName)
      if (!taskBinding.taskId || !taskBinding.taskRoot || comparable(taskBinding.taskRoot) !== comparable(expectedTaskRoot)) {
        throw new WorkflowOperationalWriteLeaseError(
          'WORKFLOW_OPERATIONAL_TASK_BINDING_REQUIRED',
          `task-scoped operational target is not the exact session-bound task: ${relativePath}`
        )
      }
    }
    let exists = false
    try { exists = fsImpl.existsSync(absolutePath) } catch { }
    if (options.checkExistence !== false && operation === 'create' && exists) {
      throw new WorkflowOperationalWriteLeaseError(
        'WORKFLOW_OPERATIONAL_CREATE_TARGET_EXISTS',
        `create-only operational target already exists: ${relativePath}`
      )
    }
    if (options.checkExistence !== false && operation !== 'create' && !exists) {
      throw new WorkflowOperationalWriteLeaseError(
        'WORKFLOW_OPERATIONAL_EXISTING_TARGET_REQUIRED',
        `${operation} requires an existing operational target: ${relativePath}`
      )
    }
    return {
      relativePath,
      absolutePath,
      slotId: slot.slotId,
      artifactClass: slot.artifactClass,
      authorityRole: slot.owner,
      mutability: slot.mutability
    }
  })
  const slotIds = [...new Set(inspected.map(item => item.slotId))]
  const authorityRoles = [...new Set(inspected.map(item => item.authorityRole))]
  if (slotIds.length !== 1 || authorityRoles.length !== 1) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_PATH_CLASS_MIXED',
      'one operational lease must bind one exact slot class and owner role',
      { slotIds, authorityRoles }
    )
  }
  return {
    relativeTargets,
    inspected,
    slotId: slotIds[0],
    authorityRole: authorityRoles[0],
    mergedRegistryDigest: registry.mergedRegistryDigest
  }
}

function createWorkflowOperationalWriteLease(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const state = input.state || {}
  const binding = stateBinding(state)
  assertStateBindingComplete(binding)
  if (String(input.project || binding.project) !== binding.project) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_PROJECT_MISMATCH',
      'requested project does not match the current server-owned project binding'
    )
  }
  const classification = classifyOperationalTargets({
    activeRoot: input.activeRoot,
    projectRoot: input.projectRoot,
    project: binding.project,
    relativeTargets: input.relativeTargets,
    operation: input.operation,
    taskBinding: {
      taskId: binding.taskId,
      taskRoot: binding.taskRoot
    }
  }, options)
  const requestedTaskId = String(input.taskId || '').trim().toLowerCase()
  if (requestedTaskId && requestedTaskId !== binding.taskId) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_TASK_MISMATCH',
      'requested taskId does not match the current session-bound task candidate'
    )
  }
  const activeRootIdentityDigest = stableDigest(comparable(input.activeRoot))
  const issuedAt = new Date(nowMs).toISOString()
  const projectLeaseExpiry = Number(state.stickyProject?.expiresAtMs) || Date.parse(String(state.stickyProject?.expiresAt || ''))
  const ttlMs = Number.isFinite(options.ttlMs)
    ? Math.max(1000, Math.min(options.ttlMs, DEFAULT_LEASE_MS))
    : DEFAULT_LEASE_MS
  const expiresAtMs = Number.isFinite(projectLeaseExpiry)
    ? Math.min(nowMs + ttlMs, projectLeaseExpiry)
    : nowMs + ttlMs
  if (expiresAtMs <= nowMs) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_PROJECT_LEASE_EXPIRED',
      'the current ProjectTargetLeaseV2 expires before an operational lease can be issued'
    )
  }
  const targetSetDigest = stableDigest(classification.relativeTargets)
  const leaseId = options.leaseIdFactory
    ? String(options.leaseIdFactory())
    : `operational-${crypto.randomBytes(20).toString('hex')}`
  if (!/^operational-[a-f0-9]{40}$/.test(leaseId)) {
    throw new WorkflowOperationalWriteLeaseError(
      'WORKFLOW_OPERATIONAL_LEASE_ID_INVALID',
      'operational lease id factory returned an invalid identifier'
    )
  }
  const semantic = {
    schemaVersion: WORKFLOW_OPERATIONAL_WRITE_LEASE_SCHEMA,
    leaseId,
    project: binding.project,
    activeRootIdentityDigest,
    projectRootIdentityDigest: binding.projectRootIdentityDigest,
    projectTargetLeaseDigest: binding.projectTargetLeaseDigest,
    sessionDigest: binding.sessionDigest,
    turnKey: binding.turnKey,
    contextEpoch: binding.contextEpoch,
    instructionEnvelopeDigest: binding.instructionEnvelopeDigest,
    routeDecisionDigest: binding.routeDecisionDigest,
    routeRevision: binding.routeRevision,
    taskId: requestedTaskId || binding.taskId || null,
    operation: String(input.operation),
    relativeTargets: classification.relativeTargets,
    targetSetDigest,
    slotId: classification.slotId,
    authorityRole: classification.authorityRole,
    mergedRegistryDigest: classification.mergedRegistryDigest,
    issuedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    singleUse: true,
    status: 'active',
    mutationAuthority: true,
    productMutationAuthority: false,
    formalArtifactAuthority: false,
    releaseAuthority: false
  }
  return Object.freeze({ ...semantic, leaseDigest: stableDigest(semantic) })
}

function footprintRelativeTargets(footprint, activeRoot) {
  const targets = Array.isArray(footprint?.normalizedTargets)
    ? footprint.normalizedTargets
    : []
  return normalizeRelativeTargets(targets.map(target => {
    const absolute = path.resolve(String(target || ''))
    if (!isInside(activeRoot, absolute)) {
      throw new WorkflowOperationalWriteLeaseError(
        'WORKFLOW_OPERATIONAL_TARGET_ESCAPE',
        'observed mutation target is outside the active root'
      )
    }
    return path.relative(activeRoot, absolute).replace(/\\/g, '/')
  }))
}

function payloadProvesAppend(payload, absoluteTargets, options = {}) {
  if (absoluteTargets.length !== 1) return false
  const fsImpl = options.fs || fs
  const toolName = String(payload?.tool_name || payload?.toolName || payload?.name || '').toLowerCase()
  const input = payload?.tool_input || payload?.toolInput || payload?.arguments || payload?.args || {}
  const target = absoluteTargets[0]
  let existing
  try {
    const stats = fsImpl.statSync(target)
    if (!stats.isFile() || stats.size > 8 * 1024 * 1024) return false
    existing = fsImpl.readFileSync(target, 'utf8')
  } catch {
    return false
  }
  if (/(?:^|__)(?:write|create_file|write_file)$/i.test(toolName) || /(?:^|_)(?:write|createfile|writefile)$/i.test(toolName)) {
    const content = input.content
    return typeof content === 'string' && content.length > existing.length && content.startsWith(existing)
  }
  if (/(?:^|__)(?:edit|replace)$/i.test(toolName) || /(?:^|_)(?:edit|replace)$/i.test(toolName)) {
    const oldText = input.old_string ?? input.oldString
    const newText = input.new_string ?? input.newString
    return typeof oldText === 'string' && oldText.length > 0 && typeof newText === 'string' &&
      input.replace_all !== true && input.replaceAll !== true && existing.endsWith(oldText) &&
      newText.length > oldText.length && newText.startsWith(oldText)
  }
  return false
}

function validateWorkflowOperationalWriteLease(value, input = {}, options = {}) {
  const errors = []
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (value?.schemaVersion !== WORKFLOW_OPERATIONAL_WRITE_LEASE_SCHEMA) errors.push('workflow-operational-lease-schema-invalid')
  if (!/^operational-[a-f0-9]{40}$/.test(String(value?.leaseId || ''))) errors.push('workflow-operational-lease-id-invalid')
  if (!ALLOWED_OPERATIONS.has(String(value?.operation || ''))) errors.push('workflow-operational-operation-invalid')
  if (!Array.isArray(value?.relativeTargets) || value.relativeTargets.length < 1 || value.relativeTargets.length > MAX_TARGETS) {
    errors.push('workflow-operational-targets-invalid')
  }
  for (const field of [
    'activeRootIdentityDigest', 'projectRootIdentityDigest', 'projectTargetLeaseDigest', 'sessionDigest',
    'instructionEnvelopeDigest', 'routeDecisionDigest', 'routeRevision', 'targetSetDigest',
    'mergedRegistryDigest'
  ]) if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`workflow-operational-${field}-invalid`)
  if (!value?.project || !value?.turnKey || !value?.contextEpoch || !value?.slotId || !value?.authorityRole) {
    errors.push('workflow-operational-identity-incomplete')
  }
  if (value?.singleUse !== true || value?.status !== 'active' || value?.mutationAuthority !== true ||
      value?.productMutationAuthority !== false || value?.formalArtifactAuthority !== false || value?.releaseAuthority !== false) {
    errors.push('workflow-operational-authority-invalid')
  }
  if (!Number.isFinite(Date.parse(String(value?.issuedAt || ''))) ||
      !Number.isFinite(Date.parse(String(value?.expiresAt || ''))) || Date.parse(value.expiresAt) <= nowMs) {
    errors.push('workflow-operational-lease-expired')
  }
  const { leaseDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(leaseDigest || '')) || stableDigest(semantic) !== leaseDigest) {
    errors.push('workflow-operational-lease-digest-invalid')
  }
  let binding
  try {
    binding = stateBinding(input.state || {})
    assertStateBindingComplete(binding)
  } catch (error) {
    errors.push(error.code || 'workflow-operational-current-binding-invalid')
    binding = {}
  }
  const activeRoot = path.resolve(String(input.activeRoot || ''))
  const expected = {
    project: binding.project,
    activeRootIdentityDigest: stableDigest(comparable(activeRoot)),
    projectRootIdentityDigest: binding.projectRootIdentityDigest,
    projectTargetLeaseDigest: binding.projectTargetLeaseDigest,
    sessionDigest: binding.sessionDigest,
    turnKey: binding.turnKey,
    contextEpoch: binding.contextEpoch,
    instructionEnvelopeDigest: binding.instructionEnvelopeDigest,
    routeDecisionDigest: binding.routeDecisionDigest,
    routeRevision: binding.routeRevision,
    taskId: binding.taskId || null
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if ((value?.[field] ?? null) !== (expectedValue ?? null)) errors.push(`workflow-operational-binding-mismatch:${field}`)
  }
  let relativeTargets = input.relativeTargets
  try {
    if (!relativeTargets && input.footprint) relativeTargets = footprintRelativeTargets(input.footprint, activeRoot)
    if (relativeTargets) {
      const normalized = normalizeRelativeTargets(relativeTargets)
      if (stableDigest(normalized) !== value?.targetSetDigest ||
          stableDigest(normalizeRelativeTargets(value?.relativeTargets || [])) !== value?.targetSetDigest) {
        errors.push('workflow-operational-target-set-mismatch')
      }
    }
  } catch (error) {
    errors.push(error.code || 'workflow-operational-target-set-invalid')
  }
  if (input.operation && value?.operation !== input.operation) errors.push('workflow-operational-operation-mismatch')
  let classification = null
  try {
    classification = classifyOperationalTargets({
      activeRoot,
      projectRoot: input.projectRoot,
      project: binding.project,
      relativeTargets: value?.relativeTargets,
      operation: value?.operation,
      taskBinding: { taskId: binding.taskId, taskRoot: binding.taskRoot }
    }, { ...options, checkExistence: options.phase !== 'post' })
    if (classification.slotId !== value?.slotId || classification.authorityRole !== value?.authorityRole ||
        classification.mergedRegistryDigest !== value?.mergedRegistryDigest) {
      errors.push('workflow-operational-slot-binding-mismatch')
    }
  } catch (error) {
    errors.push(error.code || 'workflow-operational-slot-invalid')
  }
  if (input.footprint && options.phase !== 'post') {
    const actualOperation = String(input.footprint.operation || '')
    const expectedActual = value?.operation === 'create' ? ['create-or-update'] : ['update', 'create-or-update']
    if (!expectedActual.includes(actualOperation)) errors.push('workflow-operational-footprint-operation-mismatch')
    if (value?.operation === 'append' && !payloadProvesAppend(
      input.payload,
      classification?.inspected?.map(item => item.absolutePath) || [],
      options
    )) errors.push('workflow-operational-append-proof-required')
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    lease: value || null,
    authorityRole: value?.authorityRole || null,
    appendOnlyAuthorized: value?.operation === 'append',
    classification
  }
}

module.exports = {
  MAX_WORKFLOW_OPERATIONAL_TARGETS: MAX_TARGETS,
  WORKFLOW_OPERATIONAL_WRITE_LEASE_SCHEMA,
  WorkflowOperationalWriteLeaseError,
  classifyOperationalTargets,
  createWorkflowOperationalWriteLease,
  normalizeRelativeTarget,
  normalizeRelativeTargets,
  operationalTargetSetDigest,
  validateWorkflowOperationalWriteLease
}
