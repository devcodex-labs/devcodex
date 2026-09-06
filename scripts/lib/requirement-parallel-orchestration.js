'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const REQUIRED_LAUNCH_CARD_FIELDS = [
  'requirementId',
  'displayName',
  'activeRoot',
  'allowedPaths',
  'forbiddenSharedSurfaces',
  'sessionPrompt',
  'isolationMode',
  'mergeProtocol',
  'validationRoute',
  'stopCondition'
]

const REQUIRED_MERGE_PROTOCOL_FIELDS = [
  'mergeOrder',
  'conflictChecks',
  'validationRoute',
  'reportMemoryOwner',
  'failureAction'
]

const CORE_SHARED_SURFACES = [
  'active-root',
  'cp-state',
  'memory',
  'report',
  'ledger',
  'audit-session',
  'source-mutation',
  'package-boundary',
  'validation-manifest',
  'skill-portfolio',
  'host-deploy'
]

const WEAK_LOCK_SURFACES = new Set([
  'memory',
  'report',
  'ledger',
  'package-boundary',
  'validation-manifest',
  'skill-portfolio',
  'host-deploy'
])

const SERIAL_SURFACES = new Set([
  'cp-state',
  'audit-session'
])

const HOST_COLLABORATION_OPERATIONS = Object.freeze([
  'spawn',
  'wait',
  'interrupt'
])

const HOST_COLLABORATION_MODES = Object.freeze([
  'read-only',
  'isolated-validation',
  'isolated-worktree-patch'
])

const MAX_HOST_FANOUT = 4
const DEFAULT_HOST_FANOUT = 3
const MAX_HOST_DEPTH = 1
const MIN_PARALLEL_SERIAL_MS = 120000
const MIN_PARALLEL_SAVINGS_MS = 60000
const MAX_COORDINATION_RATIO = 0.25
const MAX_CAPABILITY_LEASE_MS = 14 * 24 * 60 * 60 * 1000
const MIN_WORK_LEASE_MS = 30 * 1000
const MAX_WORK_LEASE_MS = 30 * 60 * 1000
const SHA256_RE = /^[a-f0-9]{64}$/

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function digestRecord(value, digestField) {
  const copy = { ...value }
  delete copy[digestField]
  return sha256(stableStringify(copy))
}

function isoTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function normalizeSurface(value) {
  if (!value) return null
  return String(value).trim().replace(/_/g, '-').toLowerCase()
}

function normalizePathFragment(value) {
  if (!value) return null
  return String(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:/, match => match.toLowerCase())
    .replace(/\/+/g, '/')
    .replace(/\/\*\*$/, '')
    .replace(/\/\*$/, '')
    .replace(/\/$/, '')
    .replace(/^\.\//, '')
    .toLowerCase()
}

function pathsOverlap(left, right) {
  const a = normalizePathFragment(left)
  const b = normalizePathFragment(right)
  if (!a || !b) return false
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

function inferSurfaceFromPath(filePath) {
  const normalized = normalizePathFragment(filePath) || ''
  if (!normalized) return 'unknown'
  if (normalized.includes('/.memory/') || normalized.startsWith('.memory/')) return 'memory'
  if (normalized.includes('/reports/') || normalized.startsWith('reports/')) return 'report'
  if (normalized.includes('/data/') || normalized.startsWith('data/')) return 'ledger'
  if (normalized.endsWith('scripts/validation-manifest.json') || normalized === 'scripts/validation-manifest.json') {
    return 'validation-manifest'
  }
  if (normalized.endsWith('skills/portfolio.json') || normalized.endsWith('skills/portfolio-evidence.json')) {
    return 'skill-portfolio'
  }
  if (normalized.endsWith('package.json') || normalized.endsWith('plugin.json') || normalized.includes('package-lock.json')) {
    return 'package-boundary'
  }
  if (normalized.includes('/hooks/') || normalized.startsWith('hooks/')) return 'source-mutation'
  if (normalized.includes('/instructions/') || normalized.startsWith('instructions/')) return 'source-mutation'
  if (normalized.includes('/skills/') || normalized.startsWith('skills/')) return 'source-mutation'
  if (normalized.includes('/scripts/') || normalized.startsWith('scripts/')) return 'source-mutation'
  if (normalized.includes('/requirements/') || normalized.startsWith('requirements/')) return 'requirement-artifact'
  return 'source-mutation'
}

function normalizeExpectedWrite(write) {
  if (typeof write === 'string') {
    return {
      path: write,
      normalizedPath: normalizePathFragment(write),
      surface: inferSurfaceFromPath(write),
      writeKind: 'write'
    }
  }

  const filePath = write?.path || write?.file || write?.glob || write?.target
  const surface = normalizeSurface(write?.surface) || inferSurfaceFromPath(filePath)
  return {
    path: filePath || null,
    normalizedPath: normalizePathFragment(filePath),
    surface,
    writeKind: write?.writeKind || write?.kind || 'write',
    owner: write?.owner || null
  }
}

function normalizeCpState(cpState) {
  if (!cpState) return { state: 'unknown' }
  if (typeof cpState === 'string') return { state: cpState }
  return cpState
}

function normalizeWorkItem(item, index, activeRoot) {
  const expectedWrites = asArray(item?.expectedWrites).map(normalizeExpectedWrite)
  const pathsFromWrites = expectedWrites.map(write => write.path).filter(Boolean)
  const allowedPaths = unique(asArray(item?.allowedPaths || item?.paths).concat(pathsFromWrites))
  const requestedAllowedRealpaths = asArray(item?.allowedRealpaths).map(value => String(value || ''))
  const sharedSurfaces = unique(
    asArray(item?.sharedSurfaces).map(normalizeSurface)
      .concat(expectedWrites.map(write => write.surface))
      .filter(surface => CORE_SHARED_SURFACES.includes(surface))
  )

  const id = item?.id || item?.requirementId || item?.taskId || `work-${index + 1}`
  return {
    id,
    displayName: item?.displayName || item?.name || id,
    kind: item?.kind || 'requirement',
    activeRoot: item?.activeRoot || activeRoot || null,
    cpState: normalizeCpState(item?.cpState),
    allowedPaths,
    normalizedAllowedPaths: allowedPaths.map(normalizePathFragment).filter(Boolean),
    expectedWrites,
    sharedSurfaces,
    isolationMode: item?.isolationMode || 'same-active-root-disjoint-paths',
    requestedMode: item?.requestedMode || item?.executionMode || null,
    allowedRealpaths: unique(requestedAllowedRealpaths
      .filter(value => value && path.isAbsolute(value))
      .map(value => path.resolve(value))),
    invalidAllowedRealpathCount: requestedAllowedRealpaths
      .filter(value => !value || !path.isAbsolute(value)).length,
    sessionPrompt: item?.sessionPrompt || null,
    validationRoute: asArray(item?.validationRoute || item?.validationRoutes),
    stopCondition: item?.stopCondition || null,
    sourceRefs: asArray(item?.sourceRefs)
  }
}

function buildActiveWorkInventory(input = {}) {
  const activeRoot = input.activeRoot || input.root || input.projectRoot || null
  const workItems = asArray(input.workItems || input.tasks || input.requirements)
    .map((item, index) => normalizeWorkItem(item, index, activeRoot))

  return {
    schemaVersion: 'ActiveWorkInventoryV1',
    activeRoot,
    workItems,
    sourceRefs: asArray(input.sourceRefs),
    freshness: input.freshness || 'unknown'
  }
}

function addLock(locks, lock) {
  const key = [
    lock.surface,
    lock.policy,
    unique(lock.items || []).sort().join(','),
    unique(lock.paths || []).sort().join(',')
  ].join('|')
  if (locks.some(existing => existing.key === key)) return
  locks.push({ key, ...lock })
}

function lockPolicyForSurface(surface) {
  if (SERIAL_SURFACES.has(surface)) return 'serial'
  if (WEAK_LOCK_SURFACES.has(surface)) return 'weak-lock'
  return null
}

function buildSharedSurfaceLockMap(inventoryOrInput) {
  const inventory = inventoryOrInput?.schemaVersion === 'ActiveWorkInventoryV1'
    ? inventoryOrInput
    : buildActiveWorkInventory(inventoryOrInput)
  const locks = []
  const surfaceItems = new Map()

  for (const item of inventory.workItems) {
    for (const surface of item.sharedSurfaces) {
      if (!surfaceItems.has(surface)) surfaceItems.set(surface, new Set())
      surfaceItems.get(surface).add(item.id)
    }
  }

  for (const [surface, itemsSet] of surfaceItems.entries()) {
    const items = Array.from(itemsSet)
    const policy = lockPolicyForSurface(surface)
    if (items.length > 1 && policy) {
      addLock(locks, {
        surface,
        policy,
        items,
        reasonCode: policy === 'serial' ? 'shared-serial-surface' : 'shared-single-writer-surface'
      })
    }
  }

  for (let i = 0; i < inventory.workItems.length; i += 1) {
    for (let j = i + 1; j < inventory.workItems.length; j += 1) {
      const left = inventory.workItems[i]
      const right = inventory.workItems[j]
      for (const leftWrite of left.expectedWrites) {
        for (const rightWrite of right.expectedWrites) {
          if (!leftWrite.normalizedPath || !rightWrite.normalizedPath) continue
          if (!pathsOverlap(leftWrite.normalizedPath, rightWrite.normalizedPath)) continue
          const surface = normalizeSurface(leftWrite.surface || rightWrite.surface) || 'source-mutation'
          const weak = WEAK_LOCK_SURFACES.has(leftWrite.surface) || WEAK_LOCK_SURFACES.has(rightWrite.surface)
          addLock(locks, {
            surface,
            policy: weak ? 'weak-lock' : 'serial',
            items: [left.id, right.id],
            paths: [leftWrite.path, rightWrite.path],
            reasonCode: weak ? 'overlapping-shared-control-surface' : 'overlapping-write-path'
          })
        }
      }
    }
  }

  return {
    schemaVersion: 'SharedSurfaceLockMapV1',
    activeRoot: inventory.activeRoot,
    locks: locks.map(({ key, ...lock }) => lock)
  }
}

function detectPolicyViolation(value, path = []) {
  if (!value || typeof value !== 'object') return null
  for (const [key, entry] of Object.entries(value)) {
    const keyPath = path.concat(key)
    if (/^allowParallelMutations$/i.test(key) && entry) {
      return {
        reasonCode: 'policy-violation',
        message: '`allowParallelMutations` is not supported.',
        path: keyPath.join('.')
      }
    }
    if (/^mode$/i.test(key) && String(entry).toLowerCase() === 'parallel' && path.some(part => /concurrency/i.test(part))) {
      return {
        reasonCode: 'policy-violation',
        message: '`mode=parallel` is not supported for source mutation.',
        path: keyPath.join('.')
      }
    }
    const nested = detectPolicyViolation(entry, keyPath)
    if (nested) return nested
  }
  return null
}

function buildDecision(status, inventory, lockMap, overrides = {}) {
  const reasonCodes = unique(overrides.reasonCodes || [])
  const workItemIds = inventory.workItems.map(item => item.id)
  return {
    schemaVersion: 'RequirementIndependenceDecisionV1',
    status,
    classification: overrides.classification || status,
    activeRoot: inventory.activeRoot,
    workItemIds,
    reasonCodes,
    locks: lockMap.locks,
    recommendedExecution: overrides.recommendedExecution || recommendedExecutionFor(status),
    evidence: {
      workItemCount: inventory.workItems.length,
      lockCount: lockMap.locks.length,
      sourceRefs: inventory.sourceRefs,
      freshness: inventory.freshness
    }
  }
}

function recommendedExecutionFor(status) {
  if (status === 'independent') return 'parallel-launch-card-allowed'
  if (status === 'weakly-coupled-lock') return 'parallel-prep-with-single-writer-checkpoints'
  return 'serial-execution-required'
}

function classifyRequirementIndependence(input = {}) {
  const inventory = input.schemaVersion === 'ActiveWorkInventoryV1' ? input : buildActiveWorkInventory(input)
  const lockMap = buildSharedSurfaceLockMap(inventory)
  const policyViolation = detectPolicyViolation(input)

  if (policyViolation) {
    return buildDecision('serial-required', inventory, lockMap, {
      classification: 'policy-violation',
      reasonCodes: [policyViolation.reasonCode],
      recommendedExecution: 'remove-policy-violation-and-run-serial'
    })
  }

  const reasonCodes = []
  if (!inventory.activeRoot) reasonCodes.push('missing-active-root')
  if (inventory.workItems.length < 2) reasonCodes.push('insufficient-work-items')
  for (const item of inventory.workItems) {
    if (!item.allowedPaths.length) reasonCodes.push(`insufficient-write-scope:${item.id}`)
  }
  if (reasonCodes.length) {
    return buildDecision('serial-required', inventory, lockMap, { reasonCodes })
  }

  const serialLocks = lockMap.locks.filter(lock => lock.policy === 'serial')
  if (serialLocks.length) {
    return buildDecision('serial-required', inventory, lockMap, {
      reasonCodes: serialLocks.map(lock => lock.reasonCode)
    })
  }

  const weakLocks = lockMap.locks.filter(lock => lock.policy === 'weak-lock')
  if (weakLocks.length) {
    return buildDecision('weakly-coupled-lock', inventory, lockMap, {
      reasonCodes: weakLocks.map(lock => lock.reasonCode)
    })
  }

  return buildDecision('independent', inventory, lockMap, {
    reasonCodes: ['disjoint-allowed-paths']
  })
}

function buildIntegrationMergeProtocol(decisionOrInput, options = {}) {
  const decision = decisionOrInput?.schemaVersion === 'RequirementIndependenceDecisionV1'
    ? decisionOrInput
    : classifyRequirementIndependence(decisionOrInput)
  const validationRoute = asArray(options.validationRoute).length
    ? asArray(options.validationRoute)
    : ['npm run test:changed']

  return {
    schemaVersion: 'IntegrationMergeProtocolV1',
    mergeOrder: options.mergeOrder || decision.workItemIds,
    conflictChecks: options.conflictChecks || [
      'git diff --name-only',
      'SharedSurfaceLockMapV1 recheck',
      'package/manifest/portfolio dirty boundary check'
    ],
    validationRoute,
    reportMemoryOwner: options.reportMemoryOwner || 'main-session-single-writer',
    failureAction: options.failureAction || 'stop-and-reclassify-serial-required'
  }
}

function buildParallelLaunchCard(workItem, decision, options = {}) {
  const mergeProtocol = options.mergeProtocol || buildIntegrationMergeProtocol(decision, {
    validationRoute: workItem.validationRoute.length ? workItem.validationRoute : ['npm run test:changed']
  })
  const allowedPaths = workItem.allowedPaths
  const stopCondition = workItem.stopCondition ||
    'Stop if any forbidden shared surface, stale CP state, unexpected dirty path, conflict, or failed validation appears.'

  return {
    schemaVersion: 'ParallelLaunchCardV1',
    requirementId: workItem.id,
    displayName: workItem.displayName,
    activeRoot: workItem.activeRoot,
    allowedPaths,
    forbiddenSharedSurfaces: options.forbiddenSharedSurfaces || CORE_SHARED_SURFACES,
    sessionPrompt: workItem.sessionPrompt ||
      `Work on ${workItem.displayName} only within allowedPaths. ${stopCondition}`,
    isolationMode: workItem.isolationMode,
    mergeProtocol,
    validationRoute: workItem.validationRoute.length ? workItem.validationRoute : mergeProtocol.validationRoute,
    stopCondition
  }
}

function validateIntegrationMergeProtocol(protocol) {
  const missingFields = REQUIRED_MERGE_PROTOCOL_FIELDS.filter(field => {
    const value = protocol?.[field]
    return Array.isArray(value) ? value.length === 0 : !value
  })
  return {
    schemaVersion: 'IntegrationMergeProtocolValidationV1',
    valid: missingFields.length === 0,
    classification: missingFields.length ? 'integration-protocol-missing' : 'integration-protocol-valid',
    missingFields
  }
}

function validateParallelLaunchCard(card) {
  const missingFields = REQUIRED_LAUNCH_CARD_FIELDS.filter(field => {
    const value = card?.[field]
    return Array.isArray(value) ? value.length === 0 : !value
  })
  const mergeValidation = validateIntegrationMergeProtocol(card?.mergeProtocol)
  const classification = !card?.mergeProtocol
    ? 'integration-protocol-missing'
    : missingFields.length || !mergeValidation.valid
      ? 'launch-card-invalid'
      : 'launch-card-valid'

  return {
    schemaVersion: 'ParallelLaunchCardValidationV1',
    valid: classification === 'launch-card-valid',
    classification,
    missingFields,
    mergeProtocol: mergeValidation
  }
}

function buildRequirementParallelOrchestration(input = {}, options = {}) {
  const inventory = buildActiveWorkInventory(input)
  const lockMap = buildSharedSurfaceLockMap(inventory)
  const decision = classifyRequirementIndependence(input)
  const launchCards = decision.status === 'independent'
    ? inventory.workItems.map(item => buildParallelLaunchCard(item, decision, options))
    : []
  const launchCardValidations = launchCards.map(validateParallelLaunchCard)
  const mergeProtocol = buildIntegrationMergeProtocol(decision, options)

  return {
    schemaVersion: 'RequirementParallelOrchestrationReceiptV1',
    inventory,
    lockMap,
    decision,
    launchCards,
    launchCardValidations,
    mergeProtocol,
    classification: decision.classification,
    passed: decision.status === 'independent'
      ? launchCardValidations.every(validation => validation.valid)
      : decision.status === 'weakly-coupled-lock'
  }
}

function hostCapabilityDigest(evidence) {
  return digestRecord(evidence, 'capabilityDigest')
}

/**
 * Validate current-host collaboration evidence without treating documentation or
 * generated configuration as proof that model-owned tools are callable.
 */
function validateHostNativeCollaborationCapability(evidence, options = {}) {
  const issues = []
  const now = Date.parse(isoTime(options.now ?? Date.now()) || '')
  const observedAt = Date.parse(String(evidence?.observedAt || ''))
  const expiresAt = Date.parse(String(evidence?.expiresAt || ''))
  const operations = evidence?.operations && typeof evidence.operations === 'object'
    ? evidence.operations
    : {}
  const supportedModes = asArray(evidence?.supportedModes)

  if (evidence?.schemaVersion !== 'HostNativeCollaborationCapabilityV1') issues.push('schema-invalid')
  if (evidence?.status !== 'PASS') issues.push('capability-not-pass')
  if (evidence?.observationMode !== 'direct-host-tool-inventory') issues.push('direct-observation-required')
  if (!String(evidence?.hostId || '').trim() || !String(evidence?.hostVariant || '').trim()) issues.push('host-identity-missing')
  if (!String(evidence?.evidenceRef || '').trim()) issues.push('evidence-ref-missing')
  for (const operation of HOST_COLLABORATION_OPERATIONS) {
    if (!String(operations[operation] || '').trim()) issues.push(`operation-missing:${operation}`)
  }
  if (!HOST_COLLABORATION_MODES.every(mode => supportedModes.includes(mode) || mode === 'isolated-worktree-patch')) {
    issues.push('baseline-modes-missing')
  }
  if (!Number.isInteger(evidence?.maxFanout) || evidence.maxFanout < 1) issues.push('fanout-invalid')
  if (!Number.isInteger(evidence?.maxDepth) || evidence.maxDepth < 1) issues.push('depth-invalid')
  if (!Number.isFinite(now) || !Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || expiresAt <= observedAt) {
    issues.push('capability-time-invalid')
  } else {
    if (observedAt > now + 5 * 60 * 1000) issues.push('capability-from-future')
    if (expiresAt <= now) issues.push('capability-expired')
    if (expiresAt - observedAt > MAX_CAPABILITY_LEASE_MS) issues.push('capability-lease-too-long')
  }
  if (!SHA256_RE.test(String(evidence?.capabilityDigest || '')) ||
      evidence.capabilityDigest !== hostCapabilityDigest(evidence || {})) {
    issues.push('capability-digest-invalid')
  }

  return {
    schemaVersion: 'HostNativeCollaborationCapabilityValidationV1',
    status: issues.length ? 'UNVERIFIED' : 'PASS',
    directEligible: issues.length === 0,
    issues: unique(issues),
    capabilityDigest: evidence?.capabilityDigest || null
  }
}

function pathWithinRoot(candidate, root) {
  if (!candidate || !root) return false
  const resolvedCandidate = path.resolve(candidate)
  const resolvedRoot = path.resolve(root)
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolvePhysicalCandidate(candidate, fsImpl = fs) {
  if (!candidate || !path.isAbsolute(String(candidate))) return null
  const resolved = path.resolve(String(candidate))
  const suffix = []
  let cursor = resolved
  try {
    while (!fsImpl.existsSync(cursor)) {
      const parent = path.dirname(cursor)
      if (parent === cursor) return null
      suffix.unshift(path.basename(cursor))
      cursor = parent
    }
    const physicalBase = fsImpl.realpathSync(cursor)
    return path.resolve(physicalBase, ...suffix)
  } catch {
    return null
  }
}

function rootsOverlap(left, right) {
  return pathWithinRoot(left, right) || pathWithinRoot(right, left)
}

function workItemMode(item) {
  if (HOST_COLLABORATION_MODES.includes(item.requestedMode)) return item.requestedMode
  if (item.isolationMode === 'separate-worktree') return 'isolated-worktree-patch'
  if (item.isolationMode === 'isolated-validation' || /validation|test|probe/i.test(String(item.kind || ''))) {
    return 'isolated-validation'
  }
  if (item.expectedWrites.length === 0) return 'read-only'
  return 'isolated-worktree-patch'
}

function allowedRealpathsFor(item, activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  if (item.allowedRealpaths.length) {
    return item.allowedRealpaths.map(candidate => resolvePhysicalCandidate(candidate, fsImpl)).filter(Boolean)
  }
  if (!activeRoot) return []
  const roots = []
  for (const allowedPath of item.allowedPaths) {
    const value = String(allowedPath || '')
    if (!value || /[*?\[\]]/.test(value)) continue
    const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(activeRoot, value)
    const physical = resolvePhysicalCandidate(resolved, fsImpl)
    if (physical && pathWithinRoot(physical, resolvePhysicalCandidate(activeRoot, fsImpl))) roots.push(physical)
  }
  return unique(roots)
}

function allowedPathFragmentsFor(item) {
  return unique(item.allowedPaths.map(value => String(value || '').replace(/\\/g, '/'))
    .filter(value => value && !path.isAbsolute(value) && !/[*?\[\]]/.test(value))
    .filter(value => {
      const normalized = path.posix.normalize(value)
      return normalized !== '..' && !normalized.startsWith('../')
    }))
}

function childForbiddenSurfaces(item, mode) {
  return unique(item.expectedWrites
    .map(write => normalizeSurface(write.surface))
    .filter(surface => {
      if (!CORE_SHARED_SURFACES.includes(surface)) return false
      return !(surface === 'source-mutation' && mode === 'isolated-worktree-patch' && item.isolationMode === 'separate-worktree')
    }))
}

function normalizeEconomicEvidence(input = {}) {
  const source = input.economicEvidence || input.economics || {}
  return {
    estimatedSerialMs: Number(source.estimatedSerialMs || 0),
    estimatedSavingsMs: Number(source.estimatedSavingsMs || 0),
    coordinationCostRatio: Number(source.coordinationCostRatio ?? 1),
    source: source.source || 'unverified'
  }
}

function planDigest(plan) {
  return digestRecord(plan, 'planDigest')
}

/**
 * Build the immutable root-owned dispatch plan. Any missing or stale evidence
 * produces the same ordered work graph as an explicit serial fallback.
 */
function buildHostSubagentDispatchPlan(input = {}, options = {}) {
  const orchestration = buildRequirementParallelOrchestration(input, options)
  const capability = options.hostCapabilityEvidence || input.hostCapabilityEvidence || null
  const capabilityValidation = validateHostNativeCollaborationCapability(capability, { now: options.now })
  const economics = normalizeEconomicEvidence(input)
  const taskId = input.taskId || input.task?.taskId || null
  const viewDigest = input.viewDigest || input.task?.viewDigest || null
  const sourceHead = input.sourceHead || input.source?.sourceHead || null
  const dirtyDigest = input.dirtyDigest || input.source?.dirtyDigest || null
  const reasonCodes = []
  const workItemIdCounts = new Map()
  for (const item of orchestration.inventory.workItems) {
    workItemIdCounts.set(item.id, (workItemIdCounts.get(item.id) || 0) + 1)
  }

  if (orchestration.decision.status !== 'independent') {
    reasonCodes.push(`work-graph-${orchestration.decision.status}`)
  }
  if (!taskId || !viewDigest || !sourceHead || !SHA256_RE.test(String(dirtyDigest || ''))) {
    reasonCodes.push('dispatch-identity-incomplete')
  }
  for (const [workItemId, count] of workItemIdCounts) {
    if (count > 1) reasonCodes.push(`duplicate-work-item-id:${workItemId}`)
  }
  if (!capabilityValidation.directEligible) {
    reasonCodes.push(...capabilityValidation.issues.map(issue => `host-capability:${issue}`))
  }
  if (economics.estimatedSerialMs < MIN_PARALLEL_SERIAL_MS) reasonCodes.push('serial-estimate-below-threshold')
  if (economics.estimatedSavingsMs < MIN_PARALLEL_SAVINGS_MS) reasonCodes.push('estimated-savings-below-threshold')
  if (!Number.isFinite(economics.coordinationCostRatio) || economics.coordinationCostRatio > MAX_COORDINATION_RATIO) {
    reasonCodes.push('coordination-cost-above-threshold')
  }

  const dispatchItems = orchestration.inventory.workItems.map(item => {
    const mode = workItemMode(item)
    const allowedRealpaths = allowedRealpathsFor(item, orchestration.inventory.activeRoot, options)
    const allowedPathFragments = allowedPathFragmentsFor(item)
    const forbiddenWrites = childForbiddenSurfaces(item, mode)
    if (!capability?.supportedModes?.includes(mode)) reasonCodes.push(`host-mode-unsupported:${item.id}:${mode}`)
    if (item.invalidAllowedRealpathCount > 0) {
      reasonCodes.push(`allowed-realpaths-not-absolute:${item.id}`)
    }
    if (mode === 'isolated-worktree-patch') {
      if (!allowedPathFragments.length || allowedPathFragments.length !== item.allowedPaths.length) {
        reasonCodes.push(`allowed-relative-paths-invalid:${item.id}`)
      }
    } else {
      if (!allowedRealpaths.length || allowedRealpaths.length !== item.allowedPaths.length ||
          allowedRealpaths.some(candidate => !pathWithinRoot(candidate, orchestration.inventory.activeRoot))) {
        reasonCodes.push(`allowed-realpaths-invalid:${item.id}`)
      }
    }
    if (mode === 'isolated-worktree-patch' && item.isolationMode !== 'separate-worktree') {
      reasonCodes.push(`worktree-isolation-required:${item.id}`)
    }
    if (forbiddenWrites.length) reasonCodes.push(`forbidden-shared-write:${item.id}`)
    return {
      workItemId: item.id,
      displayName: item.displayName,
      mode,
      isolationMode: item.isolationMode,
      allowedPathFragments,
      allowedRealpaths,
      forbiddenSharedSurfaces: CORE_SHARED_SURFACES,
      sessionPrompt: item.sessionPrompt ||
        `Work on ${item.displayName} only. Return evidence to the root agent; do not write formal shared state.`,
      validationRoute: item.validationRoute.length ? item.validationRoute : orchestration.mergeProtocol.validationRoute,
      stopCondition: item.stopCondition ||
        'Stop on stale lease, cancel fence change, unexpected realpath, shared-state write, dirty drift, conflict, or failed validation.'
    }
  })

  const requestedFanout = Number.isInteger(input.budget?.fanout) ? input.budget.fanout : DEFAULT_HOST_FANOUT
  const hostFanout = Number.isInteger(capability?.maxFanout) ? capability.maxFanout : 1
  const fanout = Math.max(1, Math.min(requestedFanout, hostFanout, MAX_HOST_FANOUT, dispatchItems.length || 1))
  const requestedDepth = Number.isInteger(input.budget?.depth) ? input.budget.depth : MAX_HOST_DEPTH
  const depth = Math.min(requestedDepth, Number(capability?.maxDepth || 0), MAX_HOST_DEPTH)
  if (depth !== MAX_HOST_DEPTH) reasonCodes.push('host-depth-unavailable')
  if (fanout < 2) reasonCodes.push('parallel-fanout-unavailable')

  const createdAt = isoTime(options.now ?? Date.now())
  const uniqueReasons = unique(reasonCodes)
  const status = uniqueReasons.length ? 'serial-fallback' : 'parallel-eligible'
  const plan = {
    schemaVersion: 'HostSubagentDispatchPlanV1',
    status,
    task: { taskId, viewDigest, activeRoot: orchestration.inventory.activeRoot },
    source: { sourceHead, dirtyDigest },
    workItems: dispatchItems,
    independence: orchestration.decision,
    sharedSurfaceLockMap: orchestration.lockMap,
    mergeProtocol: orchestration.mergeProtocol,
    hostCapability: {
      hostId: capability?.hostId || null,
      hostVariant: capability?.hostVariant || null,
      capabilityDigest: capability?.capabilityDigest || null,
      operationBindings: capability?.operations || {},
      validation: capabilityValidation
    },
    budget: { fanout, depth, maxFanout: MAX_HOST_FANOUT, maxDepth: MAX_HOST_DEPTH },
    economics,
    serialFallback: {
      required: status !== 'parallel-eligible',
      owner: 'root-agent-single-writer',
      preservesWorkGraph: true,
      workItemIds: orchestration.mergeProtocol.mergeOrder,
      reasonCodes: uniqueReasons
    },
    createdAt
  }
  plan.planDigest = planDigest(plan)
  return plan
}

function agentWorkLeaseDigest(lease) {
  return digestRecord(lease, 'leaseDigest')
}

function buildAgentWorkLeases(plan, options = {}) {
  if (plan?.schemaVersion !== 'HostSubagentDispatchPlanV1' || plan.planDigest !== planDigest(plan)) return []
  if (plan.status !== 'parallel-eligible') return []
  const issuedAtMs = Date.parse(isoTime(options.now ?? Date.now()) || '')
  const ttlMs = Number(options.ttlMs ?? 5 * 60 * 1000)
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(ttlMs) || ttlMs < MIN_WORK_LEASE_MS || ttlMs > MAX_WORK_LEASE_MS) {
    return []
  }
  const issuedAt = new Date(issuedAtMs).toISOString()
  const expiresAt = new Date(issuedAtMs + ttlMs).toISOString()
  const cancelFence = sha256(stableStringify({ planDigest: plan.planDigest, issuedAt, nonce: options.cancelNonce || 'initial' }))
  const fsImpl = options.fs || fs
  const physicalActiveRoot = resolvePhysicalCandidate(plan.task.activeRoot, fsImpl)
  if (!physicalActiveRoot) return []
  const physicalIsolationRoots = new Map()
  for (const item of plan.workItems.filter(entry => entry.mode === 'isolated-worktree-patch')) {
    const rawIsolationRoot = options.isolationRootsByWorkItem?.[item.workItemId] || null
    const physicalIsolationRoot = resolvePhysicalCandidate(rawIsolationRoot, fsImpl)
    if (!physicalIsolationRoot || rootsOverlap(physicalIsolationRoot, physicalActiveRoot)) return []
    if ([...physicalIsolationRoots.values()].some(existing => rootsOverlap(existing, physicalIsolationRoot))) return []
    physicalIsolationRoots.set(item.workItemId, physicalIsolationRoot)
  }
  const leases = []
  for (const item of plan.workItems) {
    let isolationRoot = null
    let allowedRealpaths = [...item.allowedRealpaths]
    if (item.mode === 'isolated-worktree-patch') {
      isolationRoot = physicalIsolationRoots.get(item.workItemId) || null
      if (!isolationRoot) return []
      allowedRealpaths = item.allowedPathFragments.map(fragment => path.resolve(isolationRoot, fragment))
      if (!allowedRealpaths.length || allowedRealpaths.some(candidate => !pathWithinRoot(candidate, isolationRoot))) return []
    }
    if (!allowedRealpaths.length) return []
    const lease = {
      schemaVersion: 'AgentWorkLeaseV1',
      planDigest: plan.planDigest,
      workItemId: item.workItemId,
      attempt: Number.isInteger(options.attempt) ? options.attempt : 1,
      mode: item.mode,
      baseHead: plan.source.sourceHead,
      dirtyDigest: plan.source.dirtyDigest,
      activeRoot: plan.task.activeRoot,
      isolationRoot,
      allowedRealpaths,
      forbiddenSharedSurfaces: [...item.forbiddenSharedSurfaces],
      issuedAt,
      expiresAt,
      cancelFence
    }
    lease.leaseDigest = agentWorkLeaseDigest(lease)
    leases.push(lease)
  }
  return leases
}

function buildHostSubagentCancelFence(plan, leases, options = {}) {
  const cancelledAt = isoTime(options.now ?? Date.now())
  const previousFence = leases?.[0]?.cancelFence || null
  const receipt = {
    schemaVersion: 'HostSubagentCancelFenceV1',
    planDigest: plan?.planDigest || null,
    previousFence,
    cancelFence: sha256(stableStringify({
      planDigest: plan?.planDigest || null,
      previousFence,
      cancelledAt,
      reason: options.reason || 'root-fallback'
    })),
    cancelledAt,
    reason: options.reason || 'root-fallback',
    targetWorkItemIds: asArray(options.targetWorkItemIds).length
      ? unique(asArray(options.targetWorkItemIds))
      : asArray(leases).map(lease => lease.workItemId),
    acknowledgedWorkItemIds: unique(asArray(options.acknowledgedWorkItemIds)),
    fallbackStarted: options.fallbackStarted !== false
  }
  receipt.fenceDigest = digestRecord(receipt, 'fenceDigest')
  return receipt
}

function childAgentEvidenceDigest(evidence) {
  return digestRecord(evidence, 'evidenceDigest')
}

function changedRealpathAllowed(candidate, allowedRoots, fsImpl = fs) {
  if (!path.isAbsolute(String(candidate || ''))) return false
  const physicalCandidate = resolvePhysicalCandidate(candidate, fsImpl)
  if (!physicalCandidate) return false
  return allowedRoots.some(root => {
    const physicalRoot = resolvePhysicalCandidate(root, fsImpl)
    return physicalRoot && pathWithinRoot(physicalCandidate, physicalRoot)
  })
}

/** Validate one child result; invalid, cancelled, expired and late results are never applied. */
function validateChildAgentEvidence(plan, lease, evidence, options = {}) {
  const issues = []
  const completedAt = Date.parse(String(evidence?.completedAt || ''))
  const issuedAt = Date.parse(String(lease?.issuedAt || ''))
  const expiresAt = Date.parse(String(lease?.expiresAt || ''))
  const rawChangedRealpaths = asArray(evidence?.actualChangedRealpaths).map(value => String(value || ''))
  const changedRealpaths = unique(rawChangedRealpaths
    .filter(value => value && path.isAbsolute(value))
    .map(value => path.resolve(value)))
  const validationReceipts = asArray(evidence?.validationReceipts)
  const currentCancelFence = options.currentCancelFence || lease?.cancelFence || null
  const fsImpl = options.fs || fs

  if (evidence?.schemaVersion !== 'ChildAgentEvidenceV1') issues.push('schema-invalid')
  if (plan?.schemaVersion !== 'HostSubagentDispatchPlanV1' || plan.planDigest !== planDigest(plan)) issues.push('plan-invalid')
  if (lease?.schemaVersion !== 'AgentWorkLeaseV1' || lease.leaseDigest !== agentWorkLeaseDigest(lease || {})) issues.push('lease-invalid')
  if (evidence?.planDigest !== plan?.planDigest || evidence?.leaseDigest !== lease?.leaseDigest) issues.push('plan-lease-mismatch')
  if (evidence?.workItemId !== lease?.workItemId || evidence?.attempt !== lease?.attempt) issues.push('work-attempt-mismatch')
  if (!String(evidence?.hostChildId || '').trim()) issues.push('host-child-identity-missing')
  if (evidence?.status !== 'completed') issues.push(`child-terminal:${evidence?.status || 'missing'}`)
  if (!Number.isFinite(completedAt) || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      completedAt < issuedAt || completedAt > expiresAt) issues.push('lease-expired-or-time-invalid')
  if (currentCancelFence !== lease?.cancelFence) issues.push('cancel-fence-changed')
  if (options.rootFallbackStarted === true) issues.push('root-serial-fallback-already-started')
  if (evidence?.baseHead !== lease?.baseHead || evidence?.dirtyDigest !== lease?.dirtyDigest) issues.push('source-identity-drift')
  if (asArray(evidence?.forbiddenSharedSurfacesTouched).length) issues.push('forbidden-shared-surface-touched')
  if (rawChangedRealpaths.some(value => !value || !path.isAbsolute(value))) {
    issues.push('changed-realpath-not-absolute')
  }
  if (changedRealpaths.some(candidate => !changedRealpathAllowed(candidate, lease?.allowedRealpaths || [], fsImpl))) {
    issues.push('changed-realpath-outside-lease')
  }
  if (lease?.mode !== 'isolated-worktree-patch' && changedRealpaths.length) issues.push('read-only-mode-mutated')
  if (lease?.mode === 'isolated-worktree-patch' && changedRealpaths.length && !SHA256_RE.test(String(evidence?.patchDigest || ''))) {
    issues.push('patch-digest-missing')
  }
  if (!validationReceipts.length || validationReceipts.some(receipt =>
    receipt?.status !== 'PASS' || !String(receipt?.id || '').trim() || !SHA256_RE.test(String(receipt?.evidenceDigest || ''))
  )) {
    issues.push('validation-evidence-incomplete')
  }
  if (evidence?.cleanup?.complete !== true || evidence?.cleanup?.ownedResidueCount !== 0) {
    issues.push('owned-resource-cleanup-incomplete')
  }
  if (!SHA256_RE.test(String(evidence?.evidenceDigest || '')) ||
      evidence.evidenceDigest !== childAgentEvidenceDigest(evidence || {})) {
    issues.push('child-evidence-digest-invalid')
  }

  const quarantineReasons = unique(issues)
  return {
    schemaVersion: 'ChildAgentEvidenceValidationV1',
    workItemId: lease?.workItemId || evidence?.workItemId || null,
    classification: quarantineReasons.length ? 'quarantined' : 'accepted-for-root-review',
    accepted: quarantineReasons.length === 0,
    quarantineReasons,
    serialFallbackRequired: quarantineReasons.length > 0,
    childCompletionIsTaskCompletion: false
  }
}

function rootIntegrationDigest(receipt) {
  return digestRecord(receipt, 'receiptDigest')
}

function buildRootAgentIntegrationReceipt(plan, leases, evidenceRows, options = {}) {
  const leaseRows = asArray(leases)
  const childRows = asArray(evidenceRows)
  const leaseByWorkItem = new Map(leaseRows.map(lease => [lease.workItemId, lease]))
  const evidenceByWorkItem = new Map(childRows.map(evidence => [evidence.workItemId, evidence]))
  const mergeOrder = asArray(plan?.mergeProtocol?.mergeOrder)
  const plannedWorkItemIds = new Set(mergeOrder)
  const leaseCounts = new Map()
  const evidenceCounts = new Map()
  const hostChildCounts = new Map()
  for (const lease of leaseRows) {
    leaseCounts.set(lease?.workItemId, (leaseCounts.get(lease?.workItemId) || 0) + 1)
  }
  for (const evidence of childRows) {
    evidenceCounts.set(evidence?.workItemId, (evidenceCounts.get(evidence?.workItemId) || 0) + 1)
    const hostChildId = String(evidence?.hostChildId || '').trim()
    if (hostChildId) hostChildCounts.set(hostChildId, (hostChildCounts.get(hostChildId) || 0) + 1)
  }
  const unexpectedLeaseWorkItemIds = unique(leaseRows
    .map(lease => lease?.workItemId || null)
    .filter(workItemId => !plannedWorkItemIds.has(workItemId)))
  const unexpectedEvidenceWorkItemIds = unique(childRows
    .map(evidence => evidence?.workItemId || null)
    .filter(workItemId => !plannedWorkItemIds.has(workItemId)))
  const validations = []
  const acceptedEvidenceWorkItemIds = []
  const rootPatchApplyOrder = []
  const serialTakeoverWorkItemIds = []

  if (plan?.status !== 'parallel-eligible') {
    serialTakeoverWorkItemIds.push(...asArray(plan?.serialFallback?.workItemIds))
  } else {
    for (const workItemId of unexpectedLeaseWorkItemIds) {
      validations.push({
        schemaVersion: 'ChildAgentEvidenceValidationV1',
        workItemId,
        classification: 'quarantined',
        accepted: false,
        quarantineReasons: ['agent-work-lease-unplanned'],
        serialFallbackRequired: true,
        childCompletionIsTaskCompletion: false
      })
    }
    for (const workItemId of unexpectedEvidenceWorkItemIds) {
      validations.push({
        schemaVersion: 'ChildAgentEvidenceValidationV1',
        workItemId,
        classification: 'quarantined',
        accepted: false,
        quarantineReasons: ['child-result-unplanned'],
        serialFallbackRequired: true,
        childCompletionIsTaskCompletion: false
      })
    }
    if (unexpectedLeaseWorkItemIds.length || unexpectedEvidenceWorkItemIds.length) {
      serialTakeoverWorkItemIds.push(...mergeOrder)
    }
    for (const workItemId of mergeOrder) {
      const lease = leaseByWorkItem.get(workItemId)
      const evidence = evidenceByWorkItem.get(workItemId)
      const cardinalityReasons = []
      if ((leaseCounts.get(workItemId) || 0) > 1) cardinalityReasons.push('agent-work-lease-duplicate')
      if ((evidenceCounts.get(workItemId) || 0) > 1) cardinalityReasons.push('child-result-duplicate')
      if (evidence && hostChildCounts.get(String(evidence.hostChildId || '').trim()) > 1) {
        cardinalityReasons.push('host-child-identity-duplicate')
      }
      if (!lease || !evidence || cardinalityReasons.length) {
        validations.push({
          schemaVersion: 'ChildAgentEvidenceValidationV1',
          workItemId,
          classification: 'quarantined',
          accepted: false,
          quarantineReasons: cardinalityReasons.length
            ? unique(cardinalityReasons)
            : ['child-result-missing'],
          serialFallbackRequired: true,
          childCompletionIsTaskCompletion: false
        })
        serialTakeoverWorkItemIds.push(workItemId)
        continue
      }
      const validation = validateChildAgentEvidence(plan, lease, evidence, options)
      validations.push(validation)
      if (validation.accepted) {
        acceptedEvidenceWorkItemIds.push(workItemId)
        if (lease.mode === 'isolated-worktree-patch' && asArray(evidence.actualChangedRealpaths).length) {
          rootPatchApplyOrder.push(workItemId)
        }
      } else {
        serialTakeoverWorkItemIds.push(workItemId)
      }
    }
  }

  const receipt = {
    schemaVersion: 'RootAgentIntegrationReceiptV1',
    status: serialTakeoverWorkItemIds.length ? 'serial-fallback-required' : 'root-integration-required',
    planDigest: plan?.planDigest || null,
    mergeOrder,
    acceptedEvidenceWorkItemIds,
    rootPatchApplyOrder,
    serialTakeoverWorkItemIds: unique(serialTakeoverWorkItemIds),
    unexpectedLeaseWorkItemIds,
    unexpectedEvidenceWorkItemIds,
    validations,
    formalWriteOwner: 'root-agent-single-writer',
    rootRetestRequired: acceptedEvidenceWorkItemIds.length > 0,
    taskCompletion: false,
    completedAt: isoTime(options.now ?? Date.now())
  }
  receipt.receiptDigest = rootIntegrationDigest(receipt)
  return receipt
}

module.exports = {
  CORE_SHARED_SURFACES,
  DEFAULT_HOST_FANOUT,
  HOST_COLLABORATION_MODES,
  HOST_COLLABORATION_OPERATIONS,
  MAX_HOST_DEPTH,
  MAX_HOST_FANOUT,
  REQUIRED_LAUNCH_CARD_FIELDS,
  REQUIRED_MERGE_PROTOCOL_FIELDS,
  asArray,
  agentWorkLeaseDigest,
  buildAgentWorkLeases,
  buildActiveWorkInventory,
  buildHostSubagentCancelFence,
  buildHostSubagentDispatchPlan,
  buildIntegrationMergeProtocol,
  buildParallelLaunchCard,
  buildRequirementParallelOrchestration,
  buildRootAgentIntegrationReceipt,
  buildSharedSurfaceLockMap,
  childAgentEvidenceDigest,
  classifyRequirementIndependence,
  detectPolicyViolation,
  hostCapabilityDigest,
  inferSurfaceFromPath,
  normalizePathFragment,
  pathsOverlap,
  resolvePhysicalCandidate,
  rootsOverlap,
  validateChildAgentEvidence,
  validateHostNativeCollaborationCapability,
  validateIntegrationMergeProtocol,
  validateParallelLaunchCard
}
