'use strict'

const defaultFs = require('fs')
const defaultPath = require('path')
const {
  createEvolutionTargetDecision,
  validateSerializedEvolutionTargetDecision
} = require('./evolution-target-decision')

const RECEIPT_SCHEMA = 'WorkspaceProvisioningReceiptV1'
const EVOLUTION_ROLES = Object.freeze(['candidates', 'decisions', 'evidence'])
const RECEIPT_STATUSES = new Set(['fresh', 'existing', 'planned', 'failed'])
const EVOLUTION_DECISION_ID_RE = /^evolution-target-[a-f0-9]{64}$/

function text(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isContained (pathImpl, root, target) {
  const relative = pathImpl.relative(pathImpl.resolve(root), pathImpl.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !pathImpl.isAbsolute(relative))
}

function isContainedChild (pathImpl, root, target) {
  const relative = pathImpl.relative(pathImpl.resolve(root), pathImpl.resolve(target))
  return Boolean(relative) && !relative.startsWith('..') && !pathImpl.isAbsolute(relative)
}

function samePath (pathImpl, left, right) {
  const leftResolved = pathImpl.resolve(left)
  const rightResolved = pathImpl.resolve(right)
  return pathImpl.sep === '\\'
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved
}

function assertPlainDirectoryChain (fsImpl, pathImpl, target) {
  let current = pathImpl.resolve(target)
  while (true) {
    if (fsImpl.existsSync(current)) {
      const stat = fsImpl.lstatSync(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        const error = new Error(`existing path component is not a plain directory: ${current}`)
        error.code = 'WORKSPACE_PROVISIONING_PATH_UNSAFE'
        throw error
      }
    }
    const parent = pathImpl.dirname(current)
    if (parent === current) return
    current = parent
  }
}

function createDefaultProvisioningDecision (workspaceRuntimeRoot, pathImpl = defaultPath) {
  const candidatesRoot = pathImpl.join(workspaceRuntimeRoot, 'evolution', 'candidates')
  return createEvolutionTargetDecision({
    candidateId: 'workspace-evolution-layout',
    activeRoot: pathImpl.resolve(workspaceRuntimeRoot),
    providerMode: 'host-assisted-local',
    target: 'workspace-local',
    targetEvidenceRefs: ['devcodex-workspace-provisioning-default'],
    candidatePath: pathImpl.join(candidatesRoot, 'workspace-evolution-layout.candidate.json'),
    candidateResolverEligible: false,
    decision: 'pending',
    activePromotionAuthorized: false
  })
}

function validateProvisioningDecision (decision, workspaceRuntimeRoot, pathImpl = defaultPath) {
  const candidatesRoot = pathImpl.join(workspaceRuntimeRoot, 'evolution', 'candidates')
  const errors = []
  const serialized = validateSerializedEvolutionTargetDecision(decision)
  if (!serialized.valid) errors.push(...serialized.errors.map(error => `decision-${error}`))
  if (typeof decision?.activeRoot !== 'string' || !decision.activeRoot.trim() ||
    !samePath(pathImpl, decision.activeRoot, workspaceRuntimeRoot)) {
    errors.push('activeRoot-workspace-runtime-mismatch')
  }
  if (decision?.providerMode !== 'host-assisted-local') errors.push('providerMode-must-be-host-assisted-local')
  if (decision?.target !== 'workspace-local') errors.push('target-must-be-workspace-local')
  if (decision?.candidateResolverEligible !== false) errors.push('candidate-resolver-must-be-disabled')
  if (typeof decision?.candidatePath !== 'string' || !decision.candidatePath.trim() ||
    !isContainedChild(pathImpl, candidatesRoot, decision.candidatePath)) {
    errors.push('candidate-path-outside-workspace-evolution')
  }
  if (decision?.decision !== 'pending' || decision?.activePromotionAuthorized !== false || decision?.activeDestination !== null) {
    errors.push('provisioning-decision-must-remain-candidate-only')
  }
  return { valid: errors.length === 0, errors }
}

function summarize (entries) {
  const summary = { fresh: 0, existing: 0, planned: 0, failed: 0 }
  for (const entry of entries) summary[entry.status]++
  return summary
}

function failedReceipt (workspaceRuntimeRoot, dryRun, decision, entries, code, message, pathImpl = defaultPath) {
  const completeEntries = EVOLUTION_ROLES.map(role => entries.find(entry => entry.role === role) || ({
    role,
    path: pathImpl.join(workspaceRuntimeRoot, 'evolution', role),
    status: 'failed',
    inspectionState: 'not-inspected',
    existedBefore: null,
    errorCode: code
  }))
  return {
    schemaVersion: RECEIPT_SCHEMA,
    status: 'failed',
    dryRun,
    workspaceRuntimeRoot,
    targetDecisionId: decision?.decisionId || null,
    paths: completeEntries,
    summary: summarize(completeEntries),
    failure: { code, message, partialWritesPreserved: true }
  }
}

function validateWorkspaceProvisioningReceipt(receipt, pathImpl = defaultPath) {
  const errors = []
  if (!hasExactKeys(receipt, [
    'schemaVersion', 'status', 'dryRun', 'workspaceRuntimeRoot', 'targetDecisionId',
    'paths', 'summary', 'failure'
  ])) errors.push('receipt-fields-invalid')
  if (receipt?.schemaVersion !== RECEIPT_SCHEMA) errors.push('receipt-schema-invalid')
  if (!RECEIPT_STATUSES.has(receipt?.status)) errors.push('receipt-status-invalid')
  if (typeof receipt?.dryRun !== 'boolean') errors.push('receipt-dryRun-invalid')
  const unresolvedRootFailure = receipt?.status === 'failed' &&
    receipt?.failure?.code === 'WORKSPACE_PROVISIONING_ROOT_INVALID'
  if (!text(receipt?.workspaceRuntimeRoot) ||
      (!pathImpl.isAbsolute(receipt.workspaceRuntimeRoot) && !unresolvedRootFailure)) {
    errors.push('receipt-workspaceRuntimeRoot-invalid')
  }
  if (!(receipt?.targetDecisionId === null || EVOLUTION_DECISION_ID_RE.test(String(receipt.targetDecisionId)))) {
    errors.push('receipt-targetDecisionId-invalid')
  }
  if (receipt?.status !== 'failed' && !EVOLUTION_DECISION_ID_RE.test(String(receipt?.targetDecisionId || ''))) {
    errors.push('receipt-success-targetDecisionId-required')
  }
  const entries = Array.isArray(receipt?.paths) ? receipt.paths : []
  if (entries.length !== EVOLUTION_ROLES.length) errors.push('receipt-path-count-invalid')
  const roles = new Set()
  for (const entry of entries) {
    if (!hasExactKeys(entry, ['role', 'path', 'status', 'inspectionState', 'existedBefore', 'errorCode'])) {
      errors.push('receipt-path-fields-invalid')
    }
    if (!EVOLUTION_ROLES.includes(entry?.role) || roles.has(entry?.role)) errors.push('receipt-path-role-invalid-or-duplicate')
    roles.add(entry?.role)
    if (!RECEIPT_STATUSES.has(entry?.status)) errors.push(`receipt-path-${entry?.role || 'unknown'}-status-invalid`)
    if (!['observed', 'not-inspected'].includes(entry?.inspectionState)) errors.push(`receipt-path-${entry?.role || 'unknown'}-inspection-invalid`)
    if (entry?.inspectionState === 'not-inspected' && entry?.existedBefore !== null) {
      errors.push(`receipt-path-${entry?.role || 'unknown'}-uninspected-existence-must-be-null`)
    }
    if (entry?.inspectionState === 'observed' && typeof entry?.existedBefore !== 'boolean') {
      errors.push(`receipt-path-${entry?.role || 'unknown'}-observed-existence-required`)
    }
    if (text(receipt?.workspaceRuntimeRoot) && EVOLUTION_ROLES.includes(entry?.role)) {
      const expectedPath = pathImpl.join(receipt.workspaceRuntimeRoot, 'evolution', entry.role)
      if (!text(entry?.path) || (!pathImpl.isAbsolute(entry.path) && !unresolvedRootFailure) ||
          !samePath(pathImpl, entry.path, expectedPath)) {
        errors.push(`receipt-path-${entry.role}-target-mismatch`)
      }
    }
    if (entry?.status === 'existing' && entry?.existedBefore !== true) errors.push(`receipt-path-${entry?.role}-existing-mismatch`)
    if (['fresh', 'planned'].includes(entry?.status) && entry?.existedBefore !== false) errors.push(`receipt-path-${entry?.role}-new-mismatch`)
    if (entry?.status === 'planned' && receipt?.dryRun !== true) errors.push(`receipt-path-${entry?.role}-planned-requires-dry-run`)
    if (entry?.status === 'fresh' && receipt?.dryRun === true) errors.push(`receipt-path-${entry?.role}-fresh-forbidden-in-dry-run`)
    if (entry?.status === 'failed' ? !text(entry?.errorCode) : entry?.errorCode !== null) {
      errors.push(`receipt-path-${entry?.role}-errorCode-mismatch`)
    }
  }
  const computedSummary = { fresh: 0, existing: 0, planned: 0, failed: 0 }
  for (const entry of entries) {
    if (Object.prototype.hasOwnProperty.call(computedSummary, entry?.status)) computedSummary[entry.status] += 1
  }
  if (!hasExactKeys(receipt?.summary, ['fresh', 'existing', 'planned', 'failed']) ||
      JSON.stringify(receipt.summary) !== JSON.stringify(computedSummary)) {
    errors.push('receipt-summary-mismatch')
  }
  const expectedStatus = computedSummary.failed > 0
    ? 'failed'
    : (computedSummary.planned > 0 ? 'planned' : (computedSummary.fresh > 0 ? 'fresh' : 'existing'))
  if (receipt?.status !== expectedStatus) errors.push('receipt-derived-status-mismatch')
  if (receipt?.status === 'failed') {
    if (!hasExactKeys(receipt?.failure, ['code', 'message', 'partialWritesPreserved']) ||
        !text(receipt?.failure?.code) || !text(receipt?.failure?.message) ||
        receipt?.failure?.partialWritesPreserved !== true) errors.push('receipt-failure-invalid')
    if (text(receipt?.failure?.code) && entries.some(entry =>
      entry?.status === 'failed' && entry.errorCode !== receipt.failure.code)) {
      errors.push('receipt-failure-path-code-mismatch')
    }
  } else if (receipt?.failure !== null) {
    errors.push('receipt-unexpected-failure')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function provisioningError (code, message, receipt) {
  const error = new Error(message)
  error.code = code
  error.receipt = receipt
  return error
}

function provisionWorkspaceEvolutionLayout (options = {}) {
  const fsImpl = options.fsImpl || defaultFs
  const pathImpl = options.pathImpl || defaultPath
  const rawWorkspaceRuntimeRoot = String(options.workspaceRuntimeRoot || '')
  if (!rawWorkspaceRuntimeRoot.trim() || !pathImpl.isAbsolute(rawWorkspaceRuntimeRoot)) {
    const workspaceRuntimeRoot = rawWorkspaceRuntimeRoot.trim() || '<unresolved-workspace-runtime-root>'
    const code = 'WORKSPACE_PROVISIONING_ROOT_INVALID'
    const message = `${code}: workspaceRuntimeRoot must be an explicit absolute path`
    const receipt = failedReceipt(workspaceRuntimeRoot, options.dryRun === true, options.targetDecision, [], code, message, pathImpl)
    throw provisioningError(code, message, receipt)
  }
  const workspaceRuntimeRoot = pathImpl.resolve(rawWorkspaceRuntimeRoot)
  const dryRun = options.dryRun === true
  const decision = options.targetDecision
  const decisionValidation = validateProvisioningDecision(decision, workspaceRuntimeRoot, pathImpl)
  if (!decisionValidation.valid) {
    const code = decision ? 'WORKSPACE_PROVISIONING_DECISION_INVALID' : 'WORKSPACE_PROVISIONING_DECISION_REQUIRED'
    const message = `${code}: ${decisionValidation.errors.join(', ')}`
    const receipt = failedReceipt(workspaceRuntimeRoot, dryRun, decision, [], code, message, pathImpl)
    throw provisioningError(code, message, receipt)
  }

  try {
    assertPlainDirectoryChain(fsImpl, pathImpl, pathImpl.join(workspaceRuntimeRoot, 'evolution'))
  } catch (error) {
    const code = error.code || 'WORKSPACE_PROVISIONING_PATH_INSPECTION_FAILED'
    const receipt = failedReceipt(workspaceRuntimeRoot, dryRun, decision, [], code, error.message, pathImpl)
    throw provisioningError(code, error.message, receipt)
  }

  const entries = []
  for (const role of EVOLUTION_ROLES) {
    const target = pathImpl.join(workspaceRuntimeRoot, 'evolution', role)
    const existedBefore = fsImpl.existsSync(target)
    if (existedBefore) {
      try {
        const stat = fsImpl.lstatSync(target)
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw provisioningError('WORKSPACE_PROVISIONING_PATH_UNSAFE', `existing path is not a plain directory: ${target}`)
        }
        entries.push({ role, path: target, status: 'existing', inspectionState: 'observed', existedBefore: true, errorCode: null })
        continue
      } catch (error) {
        const code = error.code || 'WORKSPACE_PROVISIONING_PATH_INSPECTION_FAILED'
        entries.push({ role, path: target, status: 'failed', inspectionState: 'observed', existedBefore: true, errorCode: code })
        const receipt = failedReceipt(workspaceRuntimeRoot, dryRun, decision, entries, code, error.message, pathImpl)
        throw provisioningError(code, error.message, receipt)
      }
    }
    if (dryRun) {
      entries.push({ role, path: target, status: 'planned', inspectionState: 'observed', existedBefore: false, errorCode: null })
      continue
    }
    try {
      fsImpl.mkdirSync(target, { recursive: true })
      assertPlainDirectoryChain(fsImpl, pathImpl, target)
      entries.push({ role, path: target, status: 'fresh', inspectionState: 'observed', existedBefore: false, errorCode: null })
    } catch (error) {
      const code = error.code === 'WORKSPACE_PROVISIONING_PATH_UNSAFE'
        ? error.code
        : 'WORKSPACE_PROVISIONING_MKDIR_FAILED'
      entries.push({ role, path: target, status: 'failed', inspectionState: 'observed', existedBefore: false, errorCode: code })
      const receipt = failedReceipt(workspaceRuntimeRoot, dryRun, decision, entries, code, error.message, pathImpl)
      throw provisioningError(code, `failed to create ${target}: ${error.message}`, receipt)
    }
  }

  const summary = summarize(entries)
  const status = summary.planned > 0 ? 'planned' : (summary.fresh > 0 ? 'fresh' : 'existing')
  return {
    schemaVersion: RECEIPT_SCHEMA,
    status,
    dryRun,
    workspaceRuntimeRoot,
    targetDecisionId: decision.decisionId,
    paths: entries,
    summary,
    failure: null
  }
}

module.exports = {
  EVOLUTION_DECISION_ID_RE,
  EVOLUTION_ROLES,
  RECEIPT_SCHEMA,
  createDefaultProvisioningDecision,
  isContained,
  provisionWorkspaceEvolutionLayout,
  validateProvisioningDecision,
  validateWorkspaceProvisioningReceipt
}
