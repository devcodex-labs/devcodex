'use strict'

const crypto = require('crypto')

const LANGUAGE_CONTEXT_SCHEMA = 'LanguageContextV3'
const LEGACY_LANGUAGE_CONTEXT_SCHEMAS = new Set(['LanguageContextV1', 'LanguageContextV2'])
const LANGUAGE_PREFERENCE_SCHEMA = 'LanguagePreferenceV1'
const LANGUAGE_TURN_CLASSES = new Set(['neutral', 'code', 'quoted', 'explicit-switch', 'substantive'])
const LANGUAGE_CONFIDENCE = new Set(['high', 'medium', 'low'])
const FULL_LOCALES = new Set(['zh-CN', 'en-US'])
const PARTIAL_LOCALES = new Set(['ja', 'ko', 'ru', 'ar'])


function normalizeLanguageTag(value) {
  const raw = String(value || '').trim().replace(/_/g, '-')
  if (!raw || /^(?:c|posix)(?:\.|-|$)/i.test(raw)) return ''
  if (/^zh(?:-|$)/i.test(raw)) return 'zh-CN'
  if (/^en(?:-|$)/i.test(raw)) return 'en-US'
  if (/^ja(?:-|$)/i.test(raw)) return 'ja'
  if (/^ko(?:-|$)/i.test(raw)) return 'ko'
  if (/^ru(?:-|$)/i.test(raw)) return 'ru'
  if (/^ar(?:-|$)/i.test(raw)) return 'ar'
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(raw) ? raw : ''
}


function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function localeCapability(locale) {
  const normalized = normalizeLanguageTag(locale)
  if (FULL_LOCALES.has(normalized)) return 'full'
  if (PARTIAL_LOCALES.has(normalized)) return 'partial'
  return normalized ? 'unsupported' : 'invalid'
}

function normalizePreference(raw, layer) {
  const fallbackMode = layer === 'project' ? 'inherit' : 'auto'
  if (raw === undefined || raw === null) {
    return {
      schemaVersion: LANGUAGE_PREFERENCE_SCHEMA,
      layer,
      status: 'defaulted',
      mode: fallbackMode,
      locale: null,
      errors: []
    }
  }
  if (typeof raw === 'string') {
    const locale = normalizeLanguageTag(raw)
    return {
      schemaVersion: LANGUAGE_PREFERENCE_SCHEMA,
      layer,
      status: locale ? 'legacy-normalized' : 'invalid',
      mode: locale ? 'fixed' : 'auto',
      locale: locale || null,
      errors: locale ? [] : [`${layer}-language-preference-locale-invalid`]
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      schemaVersion: LANGUAGE_PREFERENCE_SCHEMA,
      layer,
      status: 'invalid',
      mode: 'auto',
      locale: null,
      errors: [`${layer}-language-preference-object-required`]
    }
  }
  const errors = []
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== LANGUAGE_PREFERENCE_SCHEMA) {
    errors.push(`${layer}-language-preference-schema-invalid`)
  }
  const mode = String(raw.mode || fallbackMode).trim().toLowerCase()
  const allowed = layer === 'project' ? new Set(['inherit', 'auto', 'fixed']) : new Set(['auto', 'fixed'])
  if (!allowed.has(mode)) errors.push(`${layer}-language-preference-mode-invalid`)
  const locale = raw.locale === null || raw.locale === undefined || raw.locale === ''
    ? null
    : normalizeLanguageTag(raw.locale)
  if (raw.locale !== null && raw.locale !== undefined && raw.locale !== '' && !locale) {
    errors.push(`${layer}-language-preference-locale-invalid`)
  }
  if (mode === 'fixed' && !locale) errors.push(`${layer}-language-preference-fixed-locale-required`)
  if (mode !== 'fixed' && locale) errors.push(`${layer}-language-preference-locale-only-with-fixed`)
  return {
    schemaVersion: LANGUAGE_PREFERENCE_SCHEMA,
    layer,
    status: errors.length ? 'invalid' : 'configured',
    mode: errors.length ? 'auto' : mode,
    locale: errors.length ? null : locale,
    errors
  }
}

function resolveLanguagePreference(input = {}) {
  const workspace = normalizePreference(input.workspacePreference, 'workspace')
  const project = normalizePreference(input.projectPreference, 'project')
  const diagnostics = [...workspace.errors, ...project.errors]
  let mode = 'auto'
  let locale = null
  let source = 'workspace-default-auto'

  if (input.projectBound === true) {
    if (project.status === 'invalid') {
      source = 'project-invalid-adaptive'
    } else if (project.mode === 'fixed') {
      mode = 'fixed'
      locale = project.locale
      source = 'project-fixed'
    } else if (project.mode === 'auto') {
      source = 'project-auto'
    } else if (workspace.status === 'invalid') {
      source = 'workspace-invalid-adaptive'
    } else if (workspace.mode === 'fixed') {
      mode = 'fixed'
      locale = workspace.locale
      source = 'workspace-fixed-inherited'
    } else {
      source = 'workspace-auto-inherited'
    }
  } else if (workspace.status === 'invalid') {
    source = 'workspace-invalid-adaptive'
  } else if (workspace.mode === 'fixed') {
    mode = 'fixed'
    locale = workspace.locale
    source = 'workspace-fixed'
  }

  const decision = {
    schemaVersion: 'LanguagePreferenceDecisionV1',
    workspace,
    project: input.projectBound === true ? project : null,
    effectiveMode: mode,
    fixedLocale: locale,
    source,
    diagnostics
  }
  return { ...decision, preferenceDigest: digest(decision) }
}


function primaryFromContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  if (value.schemaVersion === LANGUAGE_CONTEXT_SCHEMA) {
    if (value.durableProvisional === true) return ''
    return normalizeLanguageTag(value.durablePrimaryLocale || value.primaryLanguage || value.responseLanguage)
  }
  if (LEGACY_LANGUAGE_CONTEXT_SCHEMAS.has(value.schemaVersion) || value.language) {
    return normalizeLanguageTag(value.primaryLanguage || value.responseLanguage || value.language)
  }
  return ''
}

function compactLanguageContext(value) {
  const durableProvisional = value?.schemaVersion === LANGUAGE_CONTEXT_SCHEMA && value?.durableProvisional === true
  const primaryLanguage = primaryFromContext(value) || (durableProvisional
    ? normalizeLanguageTag(value?.primaryLanguage || value?.responseLanguage || value?.durablePrimaryLocale)
    : '')
  if (!primaryLanguage) return null
  const responseLanguage = normalizeLanguageTag(value?.responseLanguage) || primaryLanguage
  const artifactLanguage = normalizeLanguageTag(value?.artifactLanguage) || primaryLanguage
  const currentTurnClass = LANGUAGE_TURN_CLASSES.has(value?.currentTurnClass)
    ? value.currentTurnClass
    : 'neutral'
  const confidence = LANGUAGE_CONFIDENCE.has(value?.confidence) ? value.confidence : 'low'
  const source = String(value?.source || 'durable-language-carrier').trim().slice(0, 96) || 'durable-language-carrier'
  return {
    schemaVersion: LANGUAGE_CONTEXT_SCHEMA,
    durablePrimaryLocale: normalizeLanguageTag(value?.durablePrimaryLocale) || primaryLanguage,
    durableProvisional,
    durableSource: String(value?.durableSource || value?.source || 'legacy-language-carrier').trim().slice(0, 96),
    durableConfidence: LANGUAGE_CONFIDENCE.has(value?.durableConfidence) ? value.durableConfidence : confidence,
    durableSourceDigest: String(value?.durableSourceDigest || digest({ primaryLanguage, source })).slice(0, 64),
    durableUpdatedAt: String(value?.durableUpdatedAt || value?.updatedAt || ''),
    primaryLanguage,
    responseLanguage,
    artifactLanguage,
    currentTurnClass,
    source,
    confidence,
    updatedPrimary: value?.updatedPrimary === true,
    preferenceDigest: String(value?.preferenceDigest || '').slice(0, 64),
    preferenceSource: String(value?.preferenceSource || 'legacy-or-absent').slice(0, 96),
    localeCapability: localeCapability(responseLanguage),
    diagnostics: Array.isArray(value?.diagnostics) ? value.diagnostics.map(String).slice(0, 8) : []
  }
}

function languageContextIntegrityErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['language-context-required']
  const errors = []
  if (value.schemaVersion !== LANGUAGE_CONTEXT_SCHEMA) errors.push('language-context-schema-invalid')
  if (!normalizeLanguageTag(value.durablePrimaryLocale)) errors.push('language-context-durable-primary-invalid')
  if (!normalizeLanguageTag(value.primaryLanguage)) errors.push('language-context-primary-invalid')
  if (!normalizeLanguageTag(value.responseLanguage)) errors.push('language-context-response-invalid')
  if (!normalizeLanguageTag(value.artifactLanguage)) errors.push('language-context-artifact-invalid')
  if (!LANGUAGE_TURN_CLASSES.has(value.currentTurnClass)) errors.push('language-context-turn-class-invalid')
  if (!LANGUAGE_CONFIDENCE.has(value.confidence)) errors.push('language-context-confidence-invalid')
  if (!String(value.source || '').trim()) errors.push('language-context-source-required')
  if (!['full', 'partial', 'unsupported'].includes(value.localeCapability)) errors.push('language-context-capability-invalid')
  return errors
}

/** Classify an interpreted decision, never arbitrary words or scripts. */
function classifyLanguageTurn(decision) {
  if (!decision || typeof decision !== 'object') return 'neutral'
  return decision.kind === 'explicit' ? 'explicit-switch'
    : decision.kind === 'infer' ? 'substantive' : 'neutral'
}

/**
 * Project a model-owned language decision. The caller validates its current
 * instruction/epoch binding. An absent decision preserves the carrier as a hint.
 */
function resolveLanguageContext(input = {}) {
  const choice = input.languageDecision || null
  if (choice && (!['retain', 'infer', 'explicit'].includes(choice.kind) ||
      !['turn', 'task'].includes(choice.scope) || !normalizeLanguageTag(choice.replyLocale) ||
      (choice.artifactLocale !== undefined && !normalizeLanguageTag(choice.artifactLocale)))) {
    const error = new Error('Invalid structured language decision')
    error.code = 'LANGUAGE_DECISION_INVALID'
    throw error
  }
  const preference = resolveLanguagePreference({
    workspacePreference: input.workspacePreference,
    projectPreference: input.projectPreference,
    projectBound: input.projectBound === true
  })
  const prior = input.taskContext || input.taskLanguageContext || input.conversationContext || input.carrier
  const priorPrimary = primaryFromContext(prior)
  const fixed = preference.effectiveMode === 'fixed' ? preference.fixedLocale : ''
  const explicit = choice?.kind === 'explicit'
  const selected = choice && choice.kind !== 'retain' ? normalizeLanguageTag(choice.replyLocale) : ''
  const responseLanguage = (explicit && selected) || fixed || selected || priorPrimary ||
    normalizeLanguageTag(input.locale) || 'en-US'
  const source = choice ? `model-language-${choice.scope}-${choice.kind}`
    : (fixed ? preference.source : 'model-language-decision-pending')
  const persistChoice = choice && choice.scope === 'task' && choice.kind !== 'retain'
  const durablePrimaryLocale = persistChoice ? responseLanguage : (fixed || priorPrimary || responseLanguage)
  const durableProvisional = !persistChoice && !fixed && !priorPrimary
  const durableSource = persistChoice ? source : (fixed ? preference.source : prior?.durableSource ||
    prior?.source || 'provisional:model-language-decision-pending')
  const durableConfidence = durableProvisional ? 'low' : (persistChoice || fixed ? 'high' : prior?.durableConfidence || 'medium')
  const updatedPrimary = !durableProvisional && (durablePrimaryLocale !== priorPrimary || durableSource !== prior?.durableSource)
  const artifactLanguage = choice ? normalizeLanguageTag(choice.artifactLocale) || responseLanguage : responseLanguage
  return {
    schemaVersion: LANGUAGE_CONTEXT_SCHEMA,
    durablePrimaryLocale, durableProvisional, durableSource, durableConfidence,
    durableSourceDigest: digest({ durablePrimaryLocale, durableProvisional, durableSource,
      durableConfidence, preferenceDigest: preference.preferenceDigest }),
    durableUpdatedAt: updatedPrimary ? new Date().toISOString() : String(prior?.durableUpdatedAt || ''),
    primaryLanguage: responseLanguage, responseLanguage, artifactLanguage,
    currentTurnClass: classifyLanguageTurn(choice), source,
    confidence: choice || fixed ? 'high' : 'low',
    updatedPrimary,
    turnOverride: explicit ? responseLanguage : null,
    persistentOverride: Boolean(explicit && choice.scope === 'task'),
    preferenceDigest: preference.preferenceDigest,
    preferenceSource: preference.source,
    localeCapability: localeCapability(responseLanguage),
    diagnostics: preference.diagnostics
  }
}

function formatLanguageContextInstruction(context) {
  if (!context || context.source === 'model-language-decision-pending') {
    return [
      '### DevCodex · LanguageContextV3',
      context?.durableProvisional === false && normalizeLanguageTag(context?.durablePrimaryLocale)
        ? `Retained task reply language: ${context.durablePrimaryLocale}. Continue using the established task preference unless the current user intent changes it.`
        : '',
      'Language is pending model interpretation. Determine reply and artifact languages from the actual user request and established conversation intent, including structured question answers.',
      'Transport fields, quoted examples, code, tool output and confirmation wrappers are not language-change instructions. Do not switch languages because they contain English or another script.',
      'Commit languageDecision through profile_context_plan.semanticDecision. Any retained or terminal locale is a hint, never an instruction overriding the user.'
    ].filter(Boolean).join('\n')
  }
  const language = String(context?.responseLanguage || context?.primaryLanguage || context?.language || 'en-US')
  const artifactLanguage = String(context?.artifactLanguage || language)
  const source = String(context?.source || 'und-en-fallback')
  return [
    '### DevCodex · LanguageContextV3',
    `Human-facing reply language: ${language}; human-facing artifact title/body/semantic filename language: ${artifactLanguage} (source=${source}, currentTurnClass=${context?.currentTurnClass || 'neutral'}, capability=${context?.localeCapability || 'unsupported'}).`,
    `Durable task locale: ${context?.durablePrimaryLocale || language}; preference source: ${context?.preferenceSource || 'legacy-or-absent'}. LanguageContextV2 readers may consume the compatibility fields primaryLanguage/responseLanguage/artifactLanguage.`,
    'Keep protocol keys, CLI parameters, schema/gate/skill IDs, and fixed canonical filenames unchanged. A yes/no confirmation, CP/version code, path, code block, or quoted text never changes the task primary language.',
    'Render PC0-PC10, confirmations, progress, failures, final results, and report headings through the locale-aware human renderer. Do not expose a raw protocol/receipt table as the primary user response.',
    'Do not claim user-language observation when source=und-en-fallback.'
  ].join('\n')
}

function formatLanguagePreferenceDiagnostic(context) {
  const diagnostics = Array.isArray(context?.diagnostics) ? context.diagnostics.filter(Boolean) : []
  if (!diagnostics.length) return ''
  const zh = String(context?.responseLanguage || '').toLowerCase().startsWith('zh')
  return zh
    ? `语言偏好配置无效，已仅对该配置层降级为自动判断，任务继续执行：${diagnostics.join('、')}`
    : `The language preference is invalid. Only that configuration layer fell back to adaptive detection and the task continues: ${diagnostics.join(', ')}`
}

module.exports = {
  LANGUAGE_CONTEXT_SCHEMA,
  classifyLanguageTurn,
  compactLanguageContext,
  formatLanguageContextInstruction,
  formatLanguagePreferenceDiagnostic,
  languageContextIntegrityErrors,
  localeCapability,
  normalizeLanguageTag,
  resolveLanguagePreference,
  resolveLanguageContext
}
