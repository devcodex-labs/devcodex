'use strict'

const crypto = require('crypto')

const CEREMONY_TIERS = new Set(['simple', 'standard'])
const DESIGN_DEPTHS = new Set(['minimal', 'standard'])
const ASSURANCE_LEVELS = new Set(['targeted', 'affected', 'full'])
const ROUTING_MODES = new Set(['adaptive', 'simple', 'standard'])
const PHASES = new Set(['precheck', 'post-context', 'scope-expansion'])

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function normalizeWorkflowRoutingConfig(value = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const requestedMode = String(raw.mode || '').trim().toLowerCase()
  const mode = ROUTING_MODES.has(requestedMode) ? requestedMode : 'adaptive'
  return {
    mode,
    showPlan: raw.showPlan !== false,
    source: requestedMode ? (ROUTING_MODES.has(requestedMode) ? 'profile-config' : 'invalid-config-fallback') : 'default'
  }
}

function explicitAxis(value, allowed) {
  const normalized = String(value || '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : null
}

function parseExplicitWorkflowPreference(input = {}) {
  const text = String(input.prompt || input.text || '')
  const structured = input.userIntent && typeof input.userIntent === 'object' && !Array.isArray(input.userIntent)
    ? input.userIntent
    : {}
  let ceremonyTier = null
  let designDepth = null
  let assuranceLevel = null

  if (!ceremonyTier && /(?:默认|采用|走|使用|按)?\s*(?:简单|轻量|精简|快速)流程|simple\s+(?:flow|ceremony)/i.test(text)) ceremonyTier = 'simple'
  if (!ceremonyTier && /(?:默认|采用|走|使用|按)?\s*(?:标准|完整|复杂)流程|standard\s+(?:flow|ceremony)/i.test(text)) ceremonyTier = 'standard'
  if (!designDepth && /(?:最小|最简|够用)\s*(?:技术)?方案|minimal\s+(?:technical\s+)?design/i.test(text)) designDepth = 'minimal'
  if (!designDepth && /标准\s*(?:技术)?方案|standard\s+(?:technical\s+)?design/i.test(text)) designDepth = 'standard'
  if (!assuranceLevel && /(?:只|仅)?\s*(?:定向|针对性|相关)验证|targeted\s+(?:test|validation)/i.test(text)) assuranceLevel = 'targeted'
  if (!assuranceLevel && /(?:受影响|影响范围)验证|affected\s+(?:test|validation)/i.test(text)) assuranceLevel = 'affected'
  if (!assuranceLevel && /(?:全量|完整|全面)验证|full\s+(?:test|validation|audit)/i.test(text)) assuranceLevel = 'full'

  ceremonyTier ||= explicitAxis(structured.ceremonyTier, CEREMONY_TIERS)
  designDepth ||= explicitAxis(structured.designDepth, DESIGN_DEPTHS)
  assuranceLevel ||= explicitAxis(structured.assuranceLevel, ASSURANCE_LEVELS)

  return {
    ceremonyTier,
    designDepth,
    assuranceLevel,
    evidence: text.trim() ? ['current-user-message'] : []
  }
}

function legacyDesignDepth(input = {}) {
  const value = String(input.implementationComplexityLevel || input.ImplementationComplexityLevel || '').trim().toLowerCase()
  if (!value) return null
  if (/简单|最小|minimal|simple/.test(value)) return 'minimal'
  if (/中等|标准|复杂|企业|standard|complex|enterprise/.test(value)) return 'standard'
  return null
}

function normalizeFacts(value = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const integer = (field, fallback) => Number.isInteger(raw[field]) && raw[field] >= 0 ? raw[field] : fallback
  return {
    targetKnown: raw.targetKnown === true,
    changedFileCount: integer('changedFileCount', null),
    consumerCount: integer('consumerCount', null),
    publicContract: raw.publicContract === true,
    schemaChange: raw.schemaChange === true,
    sharedState: raw.sharedState === true,
    migration: raw.migration === true,
    recovery: raw.recovery === true,
    securitySensitive: raw.securitySensitive === true,
    packageBoundary: raw.packageBoundary === true,
    releaseRequested: raw.releaseRequested === true,
    externalSideEffect: raw.externalSideEffect === true,
    fullAuditRequested: raw.fullAuditRequested === true,
    crossModule: raw.crossModule === true,
    multipleConsumers: raw.multipleConsumers === true || integer('consumerCount', 0) > 1,
    scopeExpanded: raw.scopeExpanded === true,
    unknownScope: raw.unknownScope === true || raw.targetKnown !== true
  }
}

function adaptiveCeremony(facts) {
  const complex = facts.unknownScope || facts.crossModule || facts.multipleConsumers || facts.publicContract ||
    facts.schemaChange || facts.sharedState || facts.migration || facts.recovery || facts.securitySensitive ||
    facts.packageBoundary || facts.releaseRequested || facts.externalSideEffect ||
    (facts.changedFileCount !== null && facts.changedFileCount > 2)
  return complex ? 'standard' : 'simple'
}

function adaptiveDesign(facts) {
  const standard = facts.unknownScope || facts.crossModule || facts.multipleConsumers || facts.publicContract ||
    facts.schemaChange || facts.sharedState || facts.migration || facts.recovery || facts.securitySensitive ||
    facts.packageBoundary
  return standard ? 'standard' : 'minimal'
}

function adaptiveAssurance(facts) {
  if (facts.fullAuditRequested || facts.releaseRequested) return 'full'
  const affected = facts.unknownScope || facts.crossModule || facts.multipleConsumers || facts.publicContract ||
    facts.schemaChange || facts.sharedState || facts.migration || facts.recovery || facts.securitySensitive ||
    facts.packageBoundary || facts.externalSideEffect
  return affected ? 'affected' : 'targeted'
}

function mandatoryObligations(facts) {
  const obligations = []
  if (facts.publicContract || facts.schemaChange) obligations.push('contract-schema-consumer-sync')
  if (facts.sharedState || facts.recovery) obligations.push('state-continuity-negative-probe')
  if (facts.migration) obligations.push('migration-read-compatibility')
  if (facts.securitySensitive) obligations.push('security-boundary-review')
  if (facts.packageBoundary) obligations.push('package-boundary-check')
  if (facts.releaseRequested) obligations.push('release-safety-gate')
  if (facts.externalSideEffect) obligations.push('external-side-effect-authorization')
  return obligations.sort()
}

function chooseAxis({ explicit, configured, adaptive, fallback, configuredSource = 'profile-config' }) {
  if (explicit) return { value: explicit, source: 'user-explicit', reason: '用户在当前任务中明确指定' }
  if (configured) return { value: configured, source: configuredSource, reason: '项目配置提供默认流程偏好' }
  if (adaptive) return { value: adaptive, source: 'adaptive-classifier', reason: '依据当前已知范围与消费者事实判断' }
  return { value: fallback, source: 'fallback', reason: '证据不足时采用可预测回退值' }
}

function plannedStages(axes, obligations) {
  const stages = ['entry-check', 'intent-and-context']
  if (axes.ceremonyTier.value === 'standard') stages.push('requirements', 'technical-design', 'implementation-plan')
  else stages.push('scoped-implementation')
  stages.push(`validation:${axes.assuranceLevel.value}`)
  if (obligations.includes('release-safety-gate')) stages.push('release-safety')
  stages.push('report-memory-ecr')
  return stages
}

function buildWorkflowPlanDecision(input = {}) {
  const phase = PHASES.has(input.phase) ? input.phase : 'precheck'
  const config = normalizeWorkflowRoutingConfig(input.config)
  const explicit = parseExplicitWorkflowPreference(input)
  const facts = normalizeFacts(input.facts)
  const legacyDepth = explicit.designDepth ? null : legacyDesignDepth(input)
  const configuredCeremony = config.mode === 'simple' || config.mode === 'standard' ? config.mode : null
  const axes = {
    ceremonyTier: chooseAxis({
      explicit: explicit.ceremonyTier,
      configured: configuredCeremony,
      adaptive: adaptiveCeremony(facts),
      fallback: 'standard'
    }),
    designDepth: chooseAxis({
      explicit: explicit.designDepth,
      configured: legacyDepth,
      configuredSource: 'legacy-design-read-compatibility',
      adaptive: adaptiveDesign(facts),
      fallback: 'standard'
    }),
    assuranceLevel: chooseAxis({
      explicit: explicit.assuranceLevel,
      configured: null,
      adaptive: adaptiveAssurance(facts),
      fallback: 'affected'
    })
  }
  const obligations = mandatoryObligations(facts)
  const previous = input.previousDecision?.schemaVersion === 'WorkflowPlanDecisionV1'
    ? input.previousDecision
    : null
  const changedAxes = previous
    ? Object.keys(axes).filter(key => previous.axes?.[key]?.value !== axes[key].value)
    : []
  const changedFromPrecheck = Boolean(previous && changedAxes.length)
  const changeReason = changedFromPrecheck
    ? (facts.scopeExpanded ? 'bounded-context-scope-expanded' : 'bounded-context-evidence-changed')
    : null
  const core = {
    schemaVersion: 'WorkflowPlanDecisionV1',
    phase,
    showPlan: config.showPlan,
    priorityOrder: ['user-explicit', 'profile-config', 'adaptive-classifier', 'fallback'],
    userIntent: explicit,
    config,
    facts,
    axes,
    mandatoryObligations: obligations,
    plannedStages: plannedStages(axes, obligations),
    change: { changedFromPrecheck, changedAxes, reason: changeReason }
  }
  return {
    ...core,
    decisionId: `workflow-plan-${digest(core)}`,
    validation: { valid: true, errors: [] }
  }
}

function formatWorkflowPlanInstruction(decision) {
  if (!decision || decision.schemaVersion !== 'WorkflowPlanDecisionV1') return ''
  const axes = decision.axes || {}
  return [
    '### DevCodex · WorkflowPlanDecisionV1',
    `流程=${axes.ceremonyTier?.value || 'standard'}；方案=${axes.designDepth?.value || 'standard'}；验证=${axes.assuranceLevel?.value || 'affected'}；阶段=${decision.phase}`,
    `优先级：用户明确意图 > 项目配置 > 智能识别 > 回退；强制义务独立执行：${decision.mandatoryObligations?.join(', ') || 'none'}`,
    `后续流程：${decision.plannedStages?.join(' → ') || 'unverified'}`,
    decision.change?.changedFromPrecheck ? `二次判断变更：${decision.change.changedAxes.join(', ')}（${decision.change.reason}）` : '二次判断：未发现需要改变流程轴的新证据'
  ].join('\n')
}

module.exports = {
  ASSURANCE_LEVELS,
  CEREMONY_TIERS,
  DESIGN_DEPTHS,
  ROUTING_MODES,
  buildWorkflowPlanDecision,
  formatWorkflowPlanInstruction,
  normalizeWorkflowRoutingConfig,
  parseExplicitWorkflowPreference
}
