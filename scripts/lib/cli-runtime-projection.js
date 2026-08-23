'use strict'

const MAX_VISIBLE_CATEGORIES = 12
const MAX_VISIBLE_COLLECTION_ITEMS = 24
const MAX_VISIBLE_STATUS_GENERATIONS = 12
const MAX_VISIBLE_TASKS = 8

function boundedCollection (value, limit = MAX_VISIBLE_COLLECTION_ITEMS) {
  const items = Array.isArray(value) ? value : []
  return {
    count: items.length,
    items: items.slice(0, limit),
    truncated: items.length > limit
  }
}

function projectCategories (value) {
  const categories = (Array.isArray(value) ? value : []).slice().sort((left, right) =>
    Number(right.bytes || 0) - Number(left.bytes || 0) ||
    String(left.category || '').localeCompare(String(right.category || ''))
  )
  return {
    categoryCount: categories.length,
    categories: categories.slice(0, MAX_VISIBLE_CATEGORIES),
    categoriesTruncated: categories.length > MAX_VISIBLE_CATEGORIES
  }
}

function projectPartition (partition) {
  const categories = projectCategories(partition.categories)
  const candidates = boundedCollection(partition.candidates)
  const blocked = boundedCollection(partition.blocked)
  return {
    ...partition,
    ...categories,
    candidateCount: candidates.count,
    candidates: candidates.items,
    candidatesTruncated: candidates.truncated,
    blockedCount: blocked.count,
    blocked: blocked.items,
    blockedTruncated: blocked.truncated
  }
}

function projectLegacyInventory (legacy) {
  const source = legacy && typeof legacy === 'object' ? legacy : {}
  return {
    ...source,
    ...projectCategories(source.categories)
  }
}

function projectTaskRecoveryStore (store) {
  const source = store && typeof store === 'object' ? store : {}
  const tasks = boundedCollection(source.tasks, MAX_VISIBLE_TASKS)
  const topTasks = boundedCollection(source.topTasks, MAX_VISIBLE_TASKS)
  return {
    ...source,
    taskCount: tasks.count,
    taskSampleCount: tasks.items.length,
    tasks: tasks.items,
    tasksTruncated: tasks.truncated,
    topTaskCount: topTasks.count,
    topTaskSampleCount: topTasks.items.length,
    topTasks: topTasks.items,
    topTasksTruncated: topTasks.truncated,
    visibleTaskLimit: MAX_VISIBLE_TASKS
  }
}

function projectTaskRecoveryRuntime (taskRecovery) {
  const source = taskRecovery && typeof taskRecovery === 'object' ? taskRecovery : {}
  const nextSteps = boundedCollection(source.nextSteps, MAX_VISIBLE_TASKS)
  return {
    ...source,
    v5: projectTaskRecoveryStore(source.v5),
    legacy: projectLegacyInventory(source.legacy),
    nextStepCount: nextSteps.count,
    nextSteps: nextSteps.items,
    nextStepsTruncated: nextSteps.truncated
  }
}

function projectTaskRecoveryDoctor (doctor) {
  const source = doctor && typeof doctor === 'object' ? doctor : {}
  const checks = boundedCollection(source.checks)
  const nextSteps = boundedCollection(source.nextSteps, MAX_VISIBLE_TASKS)
  return {
    ...source,
    checkCount: checks.count,
    checks: checks.items,
    checksTruncated: checks.truncated,
    store: projectTaskRecoveryStore(source.store),
    nextStepCount: nextSteps.count,
    nextSteps: nextSteps.items,
    nextStepsTruncated: nextSteps.truncated,
    visibleCheckLimit: MAX_VISIBLE_COLLECTION_ITEMS,
    visibleNextStepLimit: MAX_VISIBLE_TASKS
  }
}

function projectTaskRecoveryMaintenance (maintenance) {
  const source = maintenance && typeof maintenance === 'object' ? maintenance : {}
  const actions = boundedCollection(source.actions)
  const failures = boundedCollection(source.failures)
  return {
    ...source,
    actionCount: actions.count,
    actions: actions.items,
    actionsTruncated: actions.truncated,
    failureCount: failures.count,
    failures: failures.items,
    failuresTruncated: failures.truncated,
    before: source.before ? projectTaskRecoveryStore(source.before) : source.before,
    after: source.after ? projectTaskRecoveryStore(source.after) : source.after,
    visibleActionLimit: MAX_VISIBLE_COLLECTION_ITEMS
  }
}

function projectRuntimeGeneration (generation, { includeDigests = false } = {}) {
  const projected = {
    runtimeRoot: generation.runtimeRoot,
    generationId: generation.generationId,
    classification: generation.classification,
    eligible: generation.eligible,
    reasonCode: generation.reasonCode,
    files: generation.files,
    directories: generation.directories,
    bytes: generation.bytes,
    graceUntil: generation.graceUntil || null,
    leases: generation.leases
      ? {
          complete: generation.leases.complete,
          live: generation.leases.live.length,
          dead: generation.leases.dead.length,
          unknown: generation.leases.unknown.length,
          transient: generation.leases.transient.length,
          claims: generation.leases.claims?.length || 0
        }
      : null
  }
  if (includeDigests) {
    projected.manifestDigest = generation.manifestDigest || null
    projected.treeDigest = generation.treeDigest || null
    projected.leaseEvidenceDigest = generation.leaseEvidenceDigest || null
  }
  return projected
}

function projectRuntimeGenerationRetentionStatus (status) {
  const classificationOrder = new Map([
    ['current', 0],
    ['orphan-gc-candidate', 1],
    ['blocked-unknown', 2],
    ['retained-live', 3],
    ['retained-grace', 4]
  ])
  const roots = Array.isArray(status?.roots) ? status.roots : []
  const flattened = roots.flatMap((root, rootIndex) =>
    (Array.isArray(root.generations) ? root.generations : []).map(generation => ({
      rootIndex,
      generation
    }))
  ).sort((left, right) =>
    (classificationOrder.get(left.generation.classification) ?? 99) -
      (classificationOrder.get(right.generation.classification) ?? 99) ||
    String(roots[left.rootIndex].runtimeBaseRoot || '').localeCompare(
      String(roots[right.rootIndex].runtimeBaseRoot || '')
    ) ||
    String(left.generation.runtimeRoot || '').localeCompare(String(right.generation.runtimeRoot || ''))
  )
  const selectedByRoot = new Map()
  for (const item of flattened.slice(0, MAX_VISIBLE_STATUS_GENERATIONS)) {
    const selected = selectedByRoot.get(item.rootIndex) || []
    selected.push(item.generation)
    selectedByRoot.set(item.rootIndex, selected)
  }
  return {
    schemaVersion: status.schemaVersion,
    observedAt: status.observedAt,
    roots: roots.map((root, rootIndex) => {
      const generations = Array.isArray(root.generations) ? root.generations : []
      const selected = selectedByRoot.get(rootIndex) || []
      const receipts = boundedCollection(root.receipts, MAX_VISIBLE_CATEGORIES)
      const currentRefs = boundedCollection(root.currentRefs, MAX_VISIBLE_STATUS_GENERATIONS)
      return {
        runtimeBaseRoot: root.runtimeBaseRoot,
        hosts: root.hosts,
        stateFile: root.stateFile,
        stateStatus: root.stateStatus,
        stateDigest: root.stateDigest,
        receiptCount: receipts.count,
        receipts: receipts.items.map(receipt => {
          const { currentRefs: receiptCurrentRefs, ...projected } = receipt
          return {
            ...projected,
            currentRefCount: Array.isArray(receiptCurrentRefs) ? receiptCurrentRefs.length : 0
          }
        }),
        receiptsTruncated: receipts.truncated,
        currentRefCount: currentRefs.count,
        currentRefs: currentRefs.items,
        currentRefsTruncated: currentRefs.truncated,
        inventoryComplete: root.inventoryComplete,
        inventoryErrorCode: root.inventoryErrorCode,
        generationCount: generations.length,
        generationSampleCount: selected.length,
        generationsTruncated: selected.length < generations.length,
        generations: selected.map(generation => projectRuntimeGeneration(generation))
      }
    }),
    counts: status.counts,
    totals: status.totals,
    generationSampleCount: Math.min(flattened.length, MAX_VISIBLE_STATUS_GENERATIONS),
    generationsTruncated: flattened.length > MAX_VISIBLE_STATUS_GENERATIONS,
    visibleGenerationLimitTotal: MAX_VISIBLE_STATUS_GENERATIONS
  }
}

function projectRuntimeStateStatus (status) {
  return {
    ...status,
    partitions: (status.partitions || []).map(projectPartition),
    taskRecovery: projectTaskRecoveryRuntime(status.taskRecovery),
    runtimeGenerations: projectRuntimeGenerationRetentionStatus(status.runtimeGenerations),
    projectionLimits: {
      categoriesPerInventory: MAX_VISIBLE_CATEGORIES,
      collectionItems: MAX_VISIBLE_COLLECTION_ITEMS,
      runtimeGenerationsTotal: MAX_VISIBLE_STATUS_GENERATIONS,
      tasks: MAX_VISIBLE_TASKS
    }
  }
}

module.exports = {
  MAX_VISIBLE_CATEGORIES,
  MAX_VISIBLE_COLLECTION_ITEMS,
  MAX_VISIBLE_STATUS_GENERATIONS,
  MAX_VISIBLE_TASKS,
  boundedCollection,
  projectCategories,
  projectLegacyInventory,
  projectPartition,
  projectRuntimeGeneration,
  projectRuntimeGenerationRetentionStatus,
  projectRuntimeStateStatus,
  projectTaskRecoveryDoctor,
  projectTaskRecoveryMaintenance,
  projectTaskRecoveryRuntime,
  projectTaskRecoveryStore
}
