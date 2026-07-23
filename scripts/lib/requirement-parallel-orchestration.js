'use strict'

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

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)))
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

module.exports = {
  CORE_SHARED_SURFACES,
  REQUIRED_LAUNCH_CARD_FIELDS,
  REQUIRED_MERGE_PROTOCOL_FIELDS,
  asArray,
  buildActiveWorkInventory,
  buildIntegrationMergeProtocol,
  buildParallelLaunchCard,
  buildRequirementParallelOrchestration,
  buildSharedSurfaceLockMap,
  classifyRequirementIndependence,
  detectPolicyViolation,
  inferSurfaceFromPath,
  normalizePathFragment,
  pathsOverlap,
  validateIntegrationMergeProtocol,
  validateParallelLaunchCard
}
