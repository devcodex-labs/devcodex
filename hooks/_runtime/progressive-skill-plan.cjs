'use strict'

const {
  sha256
} = require('./progressive-skill-route-contract.cjs')

const STAGE_BODY_BUDGET_BYTES = 96 * 1024
const TURN_BODY_BUDGET_BYTES = 256 * 1024
const BODY_PAGE_LIMIT_BYTES = 48 * 1024
const BODY_PAGE_ENVELOPE_RESERVE_BYTES = 4 * 1024

function stageRank (stageId) {
  if (stageId === 'entry') return 0
  if (String(stageId).startsWith('execution:')) return 1
  if (stageId === 'closeout') return 2
  return 3
}

function earlierStage (left, right) {
  if (stageRank(left) !== stageRank(right)) {
    return stageRank(left) < stageRank(right) ? left : right
  }
  return String(left).localeCompare(String(right)) <= 0 ? left : right
}

function mergeRootList (groups) {
  const byId = new Map()
  for (const group of groups) {
    for (const root of group.roots || []) {
      const sources = root.sources?.length
        ? root.sources
        : [root.source || group.source].filter(Boolean)
      const current = byId.get(root.skillId)
      if (!current) {
        byId.set(root.skillId, {
          skillId: root.skillId,
          budgetClass: root.budgetClass || 'hard',
          loadStage: root.loadStage || 'entry',
          sources: [...sources]
        })
        continue
      }
      appendUnique(current.sources, sources)
      if (root.budgetClass === 'hard') current.budgetClass = 'hard'
      current.loadStage = earlierStage(current.loadStage, root.loadStage || 'entry')
    }
  }
  return [...byId.values()].sort((left, right) => left.skillId.localeCompare(right.skillId))
}

function appendUnique (target, values) {
  for (const value of values || []) {
    if (value && !target.includes(value)) target.push(value)
  }
}

function resolveRootSet (index, roots, options = {}) {
  const entries = new Map(index.entries.map(entry => [entry.skillId, entry]))
  const rootById = new Map(roots.map(root => [root.skillId, { ...root }]))
  const kernelSatisfiedIds = new Set(
    options.kernelSatisfiedIds ||
    index.entries.filter(entry => entry.reserved).map(entry => entry.skillId)
  )
  const deferredSkillStages = new Map(
    Object.entries(options.deferredSkillStages || {})
  )
  const workspaceAlwaysOnDisabledIds = new Set(
    options.workspaceAlwaysOnDisabledIds || []
  )
  const selected = new Map()
  const kernelSatisfied = new Map()
  const deferredDependencies = new Map()
  const blocked = []
  const visiting = new Set()
  const visited = new Set()

  function visit (skillId, inheritedStage, sourceRoot, sourceLabels = []) {
    const effectiveStage = rootById.get(skillId)?.loadStage || inheritedStage
    if (visiting.has(skillId)) {
      blocked.push({ code: 'DEPENDENCY_CYCLE', skillId, sourceRoot })
      return
    }
    if (workspaceAlwaysOnDisabledIds.has(skillId) &&
        sourceLabels.includes('workspace-always-on')) {
      blocked.push({
        code: 'WORKSPACE_ALWAYS_ON_DISABLED',
        skillId,
        sourceRoot
      })
      return
    }
    const entry = entries.get(skillId)
    if (!entry || entry.lifecycle !== 'green') {
      blocked.push({
        code: entry ? 'INACTIVE_ROOT' : 'MISSING_ROOT',
        skillId,
        sourceRoot
      })
      return
    }
    if (kernelSatisfiedIds.has(skillId)) {
      const current = kernelSatisfied.get(skillId)
      if (current) appendUnique(current.sources, sourceLabels)
      if (!current) {
        kernelSatisfied.set(skillId, {
          skillId,
          effectiveLayer: entry.effectiveLayer,
          bodyDigest: entry.bodyDigest,
          sourceIdentity: entry.sourceIdentity,
          satisfiedBy: 'static-host-kernel',
          sources: [...sourceLabels]
        })
      }
      return
    }
    if (!rootById.has(skillId) && deferredSkillStages.has(skillId)) {
      const current = deferredDependencies.get(skillId)
      if (current) appendUnique(current.sources, sourceLabels)
      if (!current) {
        deferredDependencies.set(skillId, {
          skillId,
          loadStage: deferredSkillStages.get(skillId),
          sourceIdentity: entry.sourceIdentity,
          sources: [...sourceLabels]
        })
      }
      return
    }
    const current = selected.get(skillId)
    if (current) {
      current.loadStage = earlierStage(current.loadStage, effectiveStage)
      appendUnique(current.sources, sourceLabels)
      return
    }
    if (visited.has(skillId)) return
    visiting.add(skillId)
    for (const dependency of entry.requires || []) {
      visit(dependency, effectiveStage, sourceRoot, sourceLabels)
    }
    visiting.delete(skillId)
    visited.add(skillId)
    selected.set(skillId, {
      skillId,
      effectiveLayer: entry.effectiveLayer,
      resolvedPath: entry.resolvedPath,
      bodyDigest: entry.bodyDigest,
      bodyBytes: entry.bodyBytes,
      bodyChunkBytes: entry.bodyChunkBytes,
      priority: entry.priority,
      requires: entry.requires,
      conflicts: entry.conflicts,
      mustReplyCore: entry.mustReplyCore || '',
      loadStage: effectiveStage,
      root: rootById.has(skillId),
      budgetClass: rootById.get(skillId)?.budgetClass || 'hard',
      sources: [...sourceLabels]
    })
  }

  for (const root of roots) {
    visit(
      root.skillId,
      root.loadStage,
      root.skillId,
      root.sources?.length ? root.sources : [root.skillId]
    )
  }

  const selectedList = [...selected.values()]
  const selectedIds = new Set(selectedList.map(item => item.skillId))
  const conflictPairs = new Set()
  for (const item of selectedList) {
    for (const otherId of item.conflicts || []) {
      if (!selectedIds.has(otherId)) continue
      const pair = [item.skillId, otherId].sort().join('|')
      if (conflictPairs.has(pair)) continue
      conflictPairs.add(pair)
      const other = selected.get(otherId)
      blocked.push({
        code: 'MANDATORY_CONFLICT',
        skillIds: pair.split('|'),
        priorities: [item.priority, other?.priority]
      })
    }
  }

  const satisfiedIds = new Set([
    ...selectedIds,
    ...kernelSatisfied.keys()
  ])
  const missingRoots = roots.filter(root => !satisfiedIds.has(root.skillId))
  for (const root of missingRoots) {
    blocked.push({ code: 'IR-1', skillId: root.skillId, sourceRoot: root.skillId })
  }
  const bodyBytes = selectedList.reduce((sum, item) => sum + Number(item.bodyBytes || 0), 0)
  const oversizedBody = selectedList.find(item =>
    Number(item.bodyChunkBytes || item.bodyBytes || 0) +
      BODY_PAGE_ENVELOPE_RESERVE_BYTES > BODY_PAGE_LIMIT_BYTES
  )
  if (oversizedBody) {
    blocked.push({
      code: 'SINGLE_SKILL_BODY_BUDGET',
      skillId: oversizedBody.skillId,
      estimatedSerializedBytes:
        Number(oversizedBody.bodyChunkBytes || oversizedBody.bodyBytes || 0) +
        BODY_PAGE_ENVELOPE_RESERVE_BYTES,
      limitBytes: BODY_PAGE_LIMIT_BYTES
    })
  }
  const stageLimitBytes = options.stageBodyBudgetBytes || STAGE_BODY_BUDGET_BYTES
  const turnLimitBytes = options.turnBodyBudgetBytes || TURN_BODY_BUDGET_BYTES
  const stageBytes = {}
  for (const item of selectedList) {
    stageBytes[item.loadStage] = Number(stageBytes[item.loadStage] || 0) +
      Number(item.bodyBytes || 0)
  }
  for (const [stageId, bytes] of Object.entries(stageBytes)) {
    if (bytes > stageLimitBytes) {
      blocked.push({
        code: 'STAGE_BUDGET_BLOCKED',
        stageId,
        bodyBytes: bytes,
        limitBytes: stageLimitBytes
      })
    }
  }
  if (bodyBytes > turnLimitBytes) {
    blocked.push({
      code: 'BUDGET_BLOCKED',
      bodyBytes,
      limitBytes: turnLimitBytes
    })
  }

  const loadOrder = selectedList
    .sort((left, right) =>
      stageRank(left.loadStage) - stageRank(right.loadStage) ||
      left.priority - right.priority ||
      left.skillId.localeCompare(right.skillId)
    )
    .map(item => item.skillId)
  return {
    status: blocked.length ? 'blocked' : 'complete',
    selected: loadOrder.map(skillId => selected.get(skillId)),
    skipped: [],
    blocked,
    loadOrder,
    bodyBytes,
    stageBytes,
    kernelSatisfied: [...kernelSatisfied.values()]
      .sort((left, right) => left.skillId.localeCompare(right.skillId)),
    deferredDependencies: [...deferredDependencies.values()]
      .sort((left, right) => left.skillId.localeCompare(right.skillId))
  }
}

function buildStages (resolution) {
  const stageMap = new Map()
  for (const item of resolution.selected || []) {
    if (!stageMap.has(item.loadStage)) stageMap.set(item.loadStage, [])
    stageMap.get(item.loadStage).push(item)
  }
  const orderedIds = [...stageMap.keys()].sort((left, right) =>
    stageRank(left) - stageRank(right) || left.localeCompare(right)
  )
  const executionIds = orderedIds.filter(stageId => stageRank(stageId) === 1)
  const hasEntry = orderedIds.includes('entry')
  return orderedIds.map((stageId, ordinal) => {
    let dependsOn = []
    if (stageRank(stageId) === 1 && hasEntry) dependsOn = ['entry']
    if (stageId === 'closeout') {
      dependsOn = executionIds.length
        ? executionIds
        : (hasEntry ? ['entry'] : [])
    }
    return {
      stageId,
      ordinal,
      status: 'pending',
      skillIds: stageMap.get(stageId).map(item => item.skillId),
      bodyBytes: stageMap.get(stageId).reduce((sum, item) => sum + item.bodyBytes, 0),
      dependsOn
    }
  })
}

function conditionCombinations (conditions, maxCombinations = 64) {
  const ungrouped = conditions.filter(item => !item.mutualExclusionGroup)
  const grouped = new Map()
  for (const condition of conditions.filter(item => item.mutualExclusionGroup)) {
    if (!grouped.has(condition.mutualExclusionGroup)) {
      grouped.set(condition.mutualExclusionGroup, [])
    }
    grouped.get(condition.mutualExclusionGroup).push(condition)
  }
  let combinations = [ungrouped]
  for (const alternatives of grouped.values()) {
    combinations = combinations.flatMap(current =>
      alternatives.map(condition => [...current, condition])
    )
    if (combinations.length > maxCombinations) {
      const error = new Error('CONDITIONAL_COMBINATION_LIMIT')
      error.code = 'CONDITIONAL_COMBINATION_LIMIT'
      throw error
    }
  }
  return combinations.length ? combinations : [[]]
}

function buildProgressiveSkillPlan (input) {
  const workflow = input.workflowResolution
  const deferredSkillStages = {}
  for (const condition of workflow.availableConditionRules || []) {
    for (const root of condition.roots || []) {
      deferredSkillStages[root.skillId] = `execution:${condition.conditionId}`
    }
  }
  const resolutionOptions = {
    ...input,
    deferredSkillStages
  }
  const rootGroups = [
    {
      source: 'workflow',
      roots: workflow.committedRoots.map(root => ({
        ...root,
        source: root.sources?.join('+') || 'workflow'
      }))
    },
    {
      source: 'workspace-always-on',
      roots: (input.workspaceAlwaysOn || []).map(skillId => ({
        skillId,
        budgetClass: 'hard',
        loadStage: 'entry',
        source: 'workspace-always-on'
      }))
    }
  ]
  if (input.explicitSkillId) {
    rootGroups.push({
      source: 'explicit',
      roots: [{
        skillId: input.explicitSkillId,
        budgetClass: 'hard',
        loadStage: 'entry',
        source: 'explicit'
      }]
    })
  }
  if (input.freeSkillId) {
    rootGroups.push({
      source: 'free-route',
      roots: [{
        skillId: input.freeSkillId,
        budgetClass: 'hard',
        loadStage: 'entry',
        source: 'free-route'
      }]
    })
  }
  const conditionById = new Map(
    workflow.availableConditionRules.map(item => [item.conditionId, item])
  )
  const activatedConditionIds = [...new Set([
    ...(input.activatedConditionIds || []),
    ...(input.lateConditionId ? [input.lateConditionId] : [])
  ])].sort()
  const activatedConditions = activatedConditionIds.map(conditionId => {
    const condition = conditionById.get(conditionId)
    if (!condition) {
      const error = new Error('CONDITIONAL_NOT_REGISTERED')
      error.code = 'CONDITIONAL_NOT_REGISTERED'
      throw error
    }
    return condition
  })
  const activatedGroups = new Map()
  for (const condition of activatedConditions) {
    if (!condition.mutualExclusionGroup) continue
    const prior = activatedGroups.get(condition.mutualExclusionGroup)
    if (prior) {
      const error = new Error('CONDITIONAL_MUTUAL_EXCLUSION')
      error.code = 'CONDITIONAL_MUTUAL_EXCLUSION'
      error.conditionIds = [prior, condition.conditionId]
      throw error
    }
    activatedGroups.set(condition.mutualExclusionGroup, condition.conditionId)
  }
  for (const condition of activatedConditions) {
    rootGroups.push({
      source: `conditional:${condition.conditionId}`,
      roots: condition.roots.map(root => ({
        ...root,
        source: `conditional:${condition.conditionId}`
      }))
    })
  }
  const committedRoots = mergeRootList(rootGroups)
  const baseResolution = resolveRootSet(input.index, committedRoots, resolutionOptions)
  const availableConditions = workflow.availableConditionRules.filter(condition =>
    !activatedConditionIds.includes(condition.conditionId)
  )
  const conditionalScenarios = availableConditions.map(condition => {
    const roots = mergeRootList([
      { source: 'base', roots: committedRoots },
      {
        source: `conditional:${condition.conditionId}`,
        roots: condition.roots.map(root => ({
          ...root,
          source: `conditional:${condition.conditionId}`
        }))
      }
    ])
    const resolution = resolveRootSet(input.index, roots, resolutionOptions)
    const optional = condition.roots.every(root => root.budgetClass === 'optional')
    return {
      conditionId: condition.conditionId,
      activationAuthority: condition.activationAuthority,
      mutualExclusionGroup: condition.mutualExclusionGroup || null,
      status: resolution.status === 'complete' ? 'ready' : (optional ? 'unavailable' : 'blocked'),
      resolution,
      stageId: `execution:${condition.conditionId}`
    }
  })
  const hardAvailableConditions = availableConditions.filter(condition =>
    condition.roots.some(root => root.budgetClass === 'hard')
  )
  const coexistenceScenarios = conditionCombinations(hardAvailableConditions)
    .map((conditions, index) => {
      const roots = mergeRootList([
        { source: 'base', roots: committedRoots },
        ...conditions.map(condition => ({
          source: `conditional:${condition.conditionId}`,
          roots: condition.roots.map(root => ({
            ...root,
            source: `conditional:${condition.conditionId}`
          }))
        }))
      ])
      const resolution = resolveRootSet(input.index, roots, resolutionOptions)
      return {
        scenarioId: `coexistence-${index}`,
        conditionIds: conditions.map(item => item.conditionId).sort(),
        status: resolution.status,
        resolution
      }
    })
  const hardScenarioBlocked = coexistenceScenarios.some(scenario =>
    scenario.status === 'blocked'
  )
  const status = baseResolution.status === 'complete' && !hardScenarioBlocked
    ? 'complete'
    : 'blocked'
  const stages = buildStages(baseResolution)
  const bundleDecisionDigest = sha256({
    committedRoots,
    baseResolution,
    conditionalScenarios
  })
  const semantic = {
    schemaVersion: 'ProgressiveSkillPlanV1',
    project: input.project,
    turnBinding: input.turnBinding,
    contextEpoch: input.contextEpoch,
    generation: input.generation || 0,
    catalogDigest: input.catalogDigest,
    decisionDigest: input.decisionDigest,
    contextBindingDigest: input.contextBindingDigest,
    registryDigest: workflow.registryDigest,
    bundleDecisionDigest,
    committedRoots,
    baseResolution,
    availableConditionRules: availableConditions,
    conditionalScenarios,
    coexistenceScenarios,
    activatedConditionIds,
    stages,
    budget: {
      bodyBytes: baseResolution.bodyBytes,
      stageLimitBytes: input.stageBodyBudgetBytes || STAGE_BODY_BUDGET_BYTES,
      turnLimitBytes: input.turnBodyBudgetBytes || TURN_BODY_BUDGET_BYTES,
      maximumStageBytes: Math.max(
        0,
        ...Object.values(baseResolution.stageBytes || {}),
        ...conditionalScenarios.flatMap(item => Object.values(item.resolution.stageBytes || {})),
        ...coexistenceScenarios.flatMap(item => Object.values(item.resolution.stageBytes || {}))
      ),
      worstCaseBytes: Math.max(
        baseResolution.bodyBytes,
        ...conditionalScenarios.map(item => item.resolution.bodyBytes),
        ...coexistenceScenarios.map(item => item.resolution.bodyBytes)
      )
    },
    status
  }
  const planSemanticDigest = sha256(semantic)
  return {
    ...semantic,
    planSemanticDigest,
    planDigest: sha256({
      planSemanticDigest,
      contextEpoch: input.contextEpoch,
      generation: input.generation || 0
    })
  }
}

module.exports = {
  STAGE_BODY_BUDGET_BYTES,
  TURN_BODY_BUDGET_BYTES,
  BODY_PAGE_LIMIT_BYTES,
  BODY_PAGE_ENVELOPE_RESERVE_BYTES,
  buildProgressiveSkillPlan,
  resolveRootSet,
  buildStages,
  conditionCombinations,
  mergeRootList,
  stageRank
}
