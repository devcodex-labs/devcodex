'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { buildRuntimeStateIndex, resolveDefaultActiveRoot } = require('./runtime-state-index.js')
const { inspectExecutionOptimization } = require('./execution-optimization.js')
const { buildSimpleGovernanceFastPathDecision } = require('../../hooks/_runtime/visible-output-contract.cjs')

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return { __readError: String(error && error.message ? error.message : error) }
  }
}

function countBy(items, selector) {
  const counts = {}
  for (const item of items || []) {
    const key = selector(item) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.keys(counts).sort().map(key => [key, counts[key]]))
}

function statusFromCounts({ warningCount = 0, errorCount = 0 } = {}) {
  if (errorCount > 0) return 'warn'
  if (warningCount > 0) return 'warn'
  return 'pass'
}

function inspectDirtyBoundary(packageRoot) {
  const result = spawnSync('git', ['-C', packageRoot, 'status', '--short', '--branch'], {
    cwd: packageRoot,
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) {
    return {
      schemaVersion: 'DirtyBoundaryV1',
      gitAvailable: false,
      status: 'unknown',
      branchLine: null,
      changedCount: 0,
      untrackedCount: 0,
      message: String(result.stderr || result.error?.message || 'git status unavailable').trim()
    }
  }
  const lines = String(result.stdout || '').split(/\r?\n/).filter(Boolean)
  const branchLine = lines.find(line => line.startsWith('##')) || null
  const changed = lines.filter(line => !line.startsWith('##'))
  return {
    schemaVersion: 'DirtyBoundaryV1',
    gitAvailable: true,
    status: changed.length ? 'dirty' : 'clean',
    branchLine,
    changedCount: changed.length,
    untrackedCount: changed.filter(line => line.startsWith('??')).length,
    changedFiles: changed.slice(0, 20).map(line => line.slice(3).trim()).sort(),
    truncated: changed.length > 20
  }
}

function summarizeRuntimeState(activeRoot, warnings) {
  try {
    const index = buildRuntimeStateIndex(activeRoot)
    const summary = index.summary || {}
    return {
      schemaVersion: 'RuntimeStateSummaryV1',
      status: statusFromCounts({ warningCount: Number(summary.conflictCount || 0) + Number(summary.alertCount || 0) }),
      activeRoot: index.activeRoot,
      sourceFileCount: summary.sourceFileCount || 0,
      recordCount: summary.recordCount || 0,
      conflictCount: summary.conflictCount || 0,
      historicalTransitionCount: summary.historicalTransitionCount || 0,
      consumerDriftCount: summary.consumerDriftCount || 0,
      alertCount: summary.alertCount || 0,
      index
    }
  } catch (error) {
    warnings.push(`runtime-state-unavailable: ${String(error && error.message ? error.message : error)}`)
    return {
      schemaVersion: 'RuntimeStateSummaryV1',
      status: 'warn',
      activeRoot,
      sourceFileCount: 0,
      recordCount: 0,
      conflictCount: 0,
      historicalTransitionCount: 0,
      consumerDriftCount: 0,
      alertCount: 0,
      index: null
    }
  }
}

function summarizeLedgerRetirement(runtimeState) {
  const records = runtimeState.index?.records || []
  const candidates = records
    .filter(record => ['closed', 'deferred'].includes(record.normalizedStatus))
    .filter(record => !record.conflict && !(record.consumerDrifts || []).length)
    .map(record => ({
      recordId: record.recordId,
      normalizedStatus: record.normalizedStatus,
      selectedAnchor: record.selectedAnchor,
      reason: 'closed-or-deferred-without-current-conflict-or-consumer-drift'
    }))
    .sort((a, b) => a.recordId.localeCompare(b.recordId, undefined, { numeric: true }))
  return {
    schemaVersion: 'LedgerRetirementCandidateV1',
    readOnly: true,
    statusCounts: countBy(records, record => record.normalizedStatus),
    recordCount: records.length,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 20),
    truncated: candidates.length > 20,
    mutationAllowed: false,
    nextStep: candidates.length
      ? 'review candidates manually before any bulk ledger archive or cleanup'
      : 'no ledger retirement candidates detected'
  }
}

function summarizeSkills(packageRoot, warnings) {
  const portfolioPath = path.join(packageRoot, 'skills', 'portfolio.json')
  const pluginPath = path.join(packageRoot, 'plugin.json')
  const portfolio = readJsonSafe(portfolioPath)
  const plugin = readJsonSafe(pluginPath)
  if (portfolio?.__readError) warnings.push(`skill-portfolio-read-error: ${portfolio.__readError}`)
  if (plugin?.__readError) warnings.push(`plugin-read-error: ${plugin.__readError}`)
  const pluginSkills = Array.isArray(plugin?.skills) ? plugin.skills : []
  const portfolioSkills = Array.isArray(portfolio?.skills) ? portfolio.skills : null
  const source = portfolioSkills ? 'skills/portfolio.json' : 'plugin.json'
  const skills = portfolioSkills || pluginSkills
  const lifecycleCounts = countBy(skills, skill => skill.lifecycleState || 'active')
  const summary = portfolio?.summary || {}
  const graySkills = skills
    .filter(skill => (skill.lifecycleState || 'active') === 'gray')
    .map(skill => skill.id)
    .filter(Boolean)
    .sort()
  return {
    schemaVersion: 'SkillSelectionTraceV1',
    readOnly: true,
    source,
    portfolioAvailable: Boolean(portfolioSkills),
    skillCount: summary.skillCount ?? skills.length,
    registeredSkillCount: summary.registeredSkillCount ?? pluginSkills.length,
    activeSkillCount: summary.activeSkillCount ?? Number(lifecycleCounts.active || 0),
    graySkillCount: summary.graySkillCount ?? Number(lifecycleCounts.gray || 0),
    lifecycleCounts,
    graySkills,
    orphanActiveCount: summary.orphanActiveCount ?? null,
    dependencyCycleCount: summary.dependencyCycleCount ?? null,
    operationalEvidenceCompleteCount: summary.operationalEvidenceCompleteCount ?? null,
    triggerPrecisionMeasuredCount: summary.triggerPrecisionMeasuredCount ?? null,
    triggerQuality: summary.triggerQuality || (portfolioSkills ? 'structural-only' : 'unverified-runtime-snapshot'),
    evidenceStatus: summary.triggerQuality === 'structural-only' || !summary.triggerPrecisionMeasuredCount
      ? 'insufficient-trigger-samples'
      : 'measured',
    generatedFrom: portfolio?.generatedFrom
      ? {
          portfolioInputDigest: portfolio.generatedFrom.portfolioInputDigest,
          consumerInventoryFileCount: portfolio.generatedFrom.consumerInventoryFileCount
        }
      : null
  }
}

function summarizeExecutionOptimization(cwd, activeRoot, executionOptimization, warnings) {
  let inspection = executionOptimization
  if (!inspection) {
    try {
      inspection = inspectExecutionOptimization(cwd, { activeRoot })
    } catch (error) {
      warnings.push(`execution-optimization-unavailable: ${String(error && error.message ? error.message : error)}`)
      inspection = null
    }
  }
  const features = (inspection?.features || []).map(feature => {
    const reasons = Array.isArray(feature.decision?.reasons) ? feature.decision.reasons : []
    return {
      featureId: feature.featureId,
      lifecycleState: feature.lifecycleState,
      evidenceCount: Array.isArray(feature.evidence) ? feature.evidence.length : 0,
      lastVerdict: feature.lastVerdict || null,
      route: feature.decision?.route || null,
      optimizationAllowed: Boolean(feature.decision?.optimizationAllowed),
      promotionReady: feature.decision?.promotionAllowed === true &&
        feature.lifecycleState === 'trial' &&
        reasons.length === 0,
      reasons
    }
  }).sort((a, b) => a.featureId.localeCompare(b.featureId))
  return {
    schemaVersion: 'ExecutionOptimizationEvidenceV1',
    readOnly: true,
    activeRoot: inspection?.activeRoot || activeRoot,
    mode: inspection?.config?.effective || 'full-only',
    configStatus: inspection?.config?.status || 'unknown',
    stateStatus: inspection?.stateStatus || 'unknown',
    stateIdentity: inspection?.stateIdentity || null,
    featureCount: features.length,
    acceleratedCount: features.filter(feature => feature.optimizationAllowed).length,
    promotionReadyCount: features.filter(feature => feature.promotionReady).length,
    insufficientEvidenceCount: features.filter(feature => feature.evidenceCount === 0).length,
    noEvidencePromotionBlocked: features.every(feature => !(feature.evidenceCount === 0 && feature.promotionReady)),
    features,
    writes: []
  }
}

function summarizeGateLifecycle(packageRoot, warnings) {
  const file = path.join(packageRoot, 'skills', 'spec-governance', 'gate-registry.json')
  const registry = readJsonSafe(file)
  if (registry?.__readError) warnings.push(`gate-registry-read-error: ${registry.__readError}`)
  const groups = Array.isArray(registry?.groups) ? registry.groups : []
  const ownerSkills = Array.from(new Set(groups.flatMap(group => group.ownerSkills || []))).sort()
  const validationRoutes = Array.from(new Set(groups.flatMap(group => group.validationRoute || []))).sort()
  return {
    schemaVersion: 'GateLifecycleMetadataV1',
    readOnly: true,
    source: 'skills/spec-governance/gate-registry.json',
    registryAvailable: Array.isArray(registry?.groups),
    groupCount: groups.length,
    ownerSkillCount: ownerSkills.length,
    validationRouteCount: validationRoutes.length,
    lifecycleCounts: { active: groups.length },
    lifecycleMutationAllowed: false,
    retirementCandidateCount: 0,
    grayOwnerGroupCount: groups.filter(group =>
      (group.ownerSkills || []).some(owner => [
        'brand-visual-quality',
        'rework-prevention-engineering',
        'consumer-validation-engineering'
      ].includes(owner))
    ).length,
    groups: groups.map(group => ({
      id: group.id,
      ownerSkills: (group.ownerSkills || []).slice().sort(),
      validationRoute: (group.validationRoute || []).slice().sort(),
      lifecycleState: 'active'
    }))
  }
}

function hostTruthFrom(hostParity) {
  if (!hostParity) {
    return {
      schemaVersion: 'HostTruthSummaryV1',
      grokTier: 'unknown',
      grokHardReady: false,
      enforcementCeiling: 'unverified'
    }
  }
  return {
    schemaVersion: 'HostTruthSummaryV1',
    grokTier: hostParity.tier || 'unknown',
    grokHardReady: Boolean(hostParity.hardReady),
    enforcementCeiling: hostParity.enforcementCeiling || 'host-evidence-bound',
    cannotClaim: Array.isArray(hostParity.cannotClaim) ? hostParity.cannotClaim.slice(0, 5) : []
  }
}

function buildGovernanceStatusSummary(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || path.resolve(__dirname, '../..'))
  const cwd = path.resolve(options.cwd || process.cwd())
  const activeRoot = path.resolve(options.activeRoot || resolveDefaultActiveRoot(cwd))
  const warnings = []
  const runtimeState = summarizeRuntimeState(activeRoot, warnings)
  const ledgers = summarizeLedgerRetirement(runtimeState)
  const skills = summarizeSkills(packageRoot, warnings)
  const executionOptimization = summarizeExecutionOptimization(cwd, activeRoot, options.executionOptimization, warnings)
  const gateLifecycle = summarizeGateLifecycle(packageRoot, warnings)
  const dirtyBoundary = inspectDirtyBoundary(packageRoot)
  const fastPathPolicy = buildSimpleGovernanceFastPathDecision({
    taskKind: 'diagnostic-summary',
    riskClass: 'unknown',
    controlPlane: true,
    sourceMutation: false,
    sharedStateMutation: false,
    requiresFullFallback: false,
    evidenceRefs: ['governance-status-summary']
  })
  const status = statusFromCounts({
    warningCount: warnings.length +
      (runtimeState.status === 'warn' ? 1 : 0) +
      (dirtyBoundary.status === 'dirty' ? 1 : 0),
    errorCount: 0
  })
  return {
    schemaVersion: 'GovernanceStatusSummaryV1',
    status,
    readOnly: true,
    cwd,
    packageRoot,
    activeRoot,
    sourceRepository: Boolean(options.sourceRepository),
    runtimeState: {
      schemaVersion: runtimeState.schemaVersion,
      status: runtimeState.status,
      activeRoot: runtimeState.activeRoot,
      sourceFileCount: runtimeState.sourceFileCount,
      recordCount: runtimeState.recordCount,
      conflictCount: runtimeState.conflictCount,
      historicalTransitionCount: runtimeState.historicalTransitionCount,
      consumerDriftCount: runtimeState.consumerDriftCount,
      alertCount: runtimeState.alertCount
    },
    ledgers,
    skills,
    executionOptimization,
    gateLifecycle,
    hostTruth: hostTruthFrom(options.hostParity),
    dirtyBoundary,
    fastPathPolicy,
    warnings,
    validation: {
      valid: true,
      errors: []
    }
  }
}

module.exports = {
  buildGovernanceStatusSummary,
  buildSimpleGovernanceFastPathDecision,
  inspectDirtyBoundary
}
