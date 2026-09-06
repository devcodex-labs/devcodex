'use strict'

const crypto = require('crypto')

const LANGUAGE_CONTEXT_SCHEMA = 'LanguageContextV3'
const LEGACY_LANGUAGE_CONTEXT_SCHEMAS = new Set(['LanguageContextV1', 'LanguageContextV2'])
const LANGUAGE_PREFERENCE_SCHEMA = 'LanguagePreferenceV1'
const LANGUAGE_TURN_CLASSES = new Set(['neutral', 'code', 'quoted', 'explicit-switch', 'substantive'])
const LANGUAGE_CONFIDENCE = new Set(['high', 'medium', 'low'])
const FULL_LOCALES = new Set(['zh-CN', 'en-US'])
const PARTIAL_LOCALES = new Set(['ja', 'ko', 'ru', 'ar'])

const LANGUAGE_RULES = [
  ['ja', /[\u3040-\u30ff]/u],
  ['ko', /[\uac00-\ud7af]/u],
  ['zh-CN', /[\u3400-\u9fff]/u],
  ['ru', /[\u0400-\u04ff]/u],
  ['ar', /[\u0600-\u06ff]/u]
]

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

function maskQuotedLanguageExamples(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, match => ' '.repeat(match.length))
    .replace(/`[^`\r\n]*`/g, match => ' '.repeat(match.length))
    .replace(/[“\"][^”\"\r\n]*[”\"]/g, match => ' '.repeat(match.length))
    .replace(/[‘'][^’'\r\n]*[’']/g, match => ' '.repeat(match.length))
}

function directiveIsNegatedOrDiscussed(value, index) {
  const before = value.slice(0, index)
  const clause = before.split(/[，,。；;！？!?\r\n]/u).pop().trim().toLowerCase()
  if (/(?:不要|不再|不是|并非|别|勿|禁止|无需|无须).{0,8}$/u.test(clause)) return true
  if (/(?:do\s+not|don't|dont|not|never|stop).{0,18}$/i.test(clause)) return true
  if (/(?:为什么|为何|怎么|怎会|是否|检查|分析|解释|排查|验证|谁让你).{0,10}$/u.test(clause)) return true
  if (/(?:why|how|whether|check|verify|analy[sz]e|explain|diagnose).{0,24}$/i.test(clause)) return true
  return false
}

function explicitLanguage(text) {
  const value = maskQuotedLanguageExamples(text)
  const definitions = [
    ['zh-CN', /(?:用|使用|改用|切换(?:为|到)?|回复|回答|输出)\s*(?:中文|汉语)|(?:respond|reply|write|output)(?:\s+to\s+me)?\s+in\s+(?:chinese|zh(?:-cn)?)/giu],
    ['en-US', /(?:用|使用|改用|切换(?:为|到)?|回复|回答|输出)\s*(?:英文|英语)|(?:respond|reply|write|output)(?:\s+to\s+me)?\s+in\s+(?:english|en(?:-us)?)/giu],
    ['ja', /(?:用|使用|改用|切换(?:为|到)?|回复|回答|输出)\s*(?:日文|日语)|(?:respond|reply|write|output)(?:\s+to\s+me)?\s+in\s+(?:japanese|ja)/giu],
    ['ko', /(?:用|使用|改用|切换(?:为|到)?|回复|回答|输出)\s*(?:韩文|韩语)|(?:respond|reply|write|output)(?:\s+to\s+me)?\s+in\s+(?:korean|ko)/giu],
    ['ru', /(?:用|使用|改用|切换(?:为|到)?|回复|回答|输出)\s*(?:俄文|俄语)|(?:respond|reply|write|output)(?:\s+to\s+me)?\s+in\s+(?:russian|ru)/giu],
    ['ar', /(?:用|使用|改用|切换(?:为|到)?|回复|回答|输出)\s*(?:阿拉伯文|阿拉伯语)|(?:respond|reply|write|output)(?:\s+to\s+me)?\s+in\s+(?:arabic|ar)/giu]
  ]
  const candidates = []
  for (const [locale, pattern] of definitions) {
    for (const match of value.matchAll(pattern)) {
      if (!directiveIsNegatedOrDiscussed(value, match.index)) candidates.push({ locale, index: match.index })
    }
  }
  candidates.sort((left, right) => left.index - right.index)
  return candidates.at(-1)?.locale || ''
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

function persistentLanguageOverride(text) {
  const value = String(text || '')
  return /(?:本任务|这个任务|当前任务|后续|以后|接下来|始终|一直).{0,20}(?:用|使用|回复|回答|输出)|(?:from\s+now\s+on|for\s+this\s+task|throughout\s+this\s+task|always).{0,30}(?:respond|reply|write|output)/i.test(value)
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

function classifyLanguageTurn(text) {
  const value = String(text || '').trim()
  if (!value) return 'neutral'
  const withoutMention = value.replace(/^@[\w.-]+\s*/u, '').trim()
  if (/^(?:yes|no|y|n|ok|okay|confirm(?:ed)?|continue|proceed|accept(?:ed)?|确认|继续|是|否|好|好的|可以|同意|采纳)(?:\s+(?:cp\d+|v?\d+(?:\.\d+){1,3}(?:-[\w.-]+)?|[\w.-]+))?[`'"“”]*[.!。！]?$/iu.test(withoutMention)) {
    return 'neutral'
  }
  if (/^(?:确认|继续|采纳)\s+(?:cp\d+|v?\d+(?:\.\d+){1,3}(?:-[\w.-]+)?|[\w.-]+)$/iu.test(withoutMention)) {
    return 'neutral'
  }
  if (/^(?:`{3}[\s\S]*`{3}|`[^`]+`|[A-Za-z]:[\\/][^\r\n]+|\/{1,2}[^\r\n]+|v?\d+(?:\.\d+){1,3}(?:-[\w.-]+)?|[A-Fa-f0-9]{7,64})$/u.test(value)) {
    return 'code'
  }
  const lines = value.split(/\r?\n/).filter(Boolean)
  if (lines.length > 0 && lines.every(line => /^\s*>/.test(line) || /^\s*["“][\s\S]*["”]\s*$/.test(line))) {
    return 'quoted'
  }
  if (explicitLanguage(value)) return 'explicit-switch'
  return 'substantive'
}

function languageFromText(text) {
  const value = String(text || '')
  for (const [language, pattern] of LANGUAGE_RULES) {
    if (pattern.test(value)) return language
  }
  if (/[A-Za-z]/.test(value)) return 'en-US'
  return ''
}

/** Resolve one task-bound locale decision. Neutral/code/quoted turns never replace the durable carrier. */
function resolveLanguageContext(input = {}) {
  const prompt = String(input.prompt || '')
  const currentTurnClass = classifyLanguageTurn(prompt)
  const explicit = currentTurnClass === 'explicit-switch'
    ? explicitLanguage(input.explicitLanguage || prompt)
    : ''
  const preference = resolveLanguagePreference({
    workspacePreference: input.workspacePreference,
    projectPreference: input.projectPreference,
    projectBound: input.projectBound === true
  })
  const taskContext = input.taskContext || input.taskLanguageContext
  const conversationContext = input.conversationContext || input.carrier
  const taskPrimary = primaryFromContext(taskContext)
  const conversationPrimary = primaryFromContext(conversationContext)
  const priorDurable = taskPrimary || conversationPrimary
  const persistentOverride = Boolean(explicit && persistentLanguageOverride(prompt))

  let responseLanguage = ''
  let source = ''
  let confidence = 'low'
  let durablePrimaryLocale = priorDurable
  let durableProvisional = false
  let durableSource = String(
    taskContext?.durableSource || taskContext?.source ||
    conversationContext?.durableSource || conversationContext?.source || ''
  )
  let durableConfidence = LANGUAGE_CONFIDENCE.has(taskContext?.durableConfidence)
    ? taskContext.durableConfidence
    : (LANGUAGE_CONFIDENCE.has(conversationContext?.durableConfidence)
        ? conversationContext.durableConfidence
        : (priorDurable ? 'high' : 'low'))
  let durableUpdatedAt = String(
    taskContext?.durableUpdatedAt || taskContext?.updatedAt ||
    conversationContext?.durableUpdatedAt || conversationContext?.updatedAt || ''
  )

  if (explicit) {
    responseLanguage = explicit
    source = 'explicit-current-turn'
    confidence = 'high'
    if (persistentOverride) {
      durablePrimaryLocale = explicit
      durableProvisional = false
      durableSource = 'explicit-task-persistent'
      durableConfidence = 'high'
    }
  } else if (preference.effectiveMode === 'fixed' && preference.fixedLocale) {
    responseLanguage = preference.fixedLocale
    source = preference.source
    confidence = 'high'
    durablePrimaryLocale = preference.fixedLocale
    durableProvisional = false
    durableSource = preference.source
    durableConfidence = 'high'
  } else if (taskPrimary) {
    responseLanguage = taskPrimary
    source = 'task-primary-language'
    confidence = 'high'
  } else if (conversationPrimary) {
    responseLanguage = conversationPrimary
    source = 'conversation-primary-language'
    confidence = 'high'
  } else if (currentTurnClass === 'substantive') {
    responseLanguage = languageFromText(prompt)
    if (responseLanguage) {
      durablePrimaryLocale = responseLanguage
      durableProvisional = false
      durableSource = 'first-substantive-user-message'
      durableConfidence = 'high'
      source = durableSource
      confidence = 'high'
    }
  }

  const hostLocale = normalizeLanguageTag(input.locale)
  if (!responseLanguage && hostLocale) {
    responseLanguage = hostLocale
    source = 'host-or-terminal-locale'
    confidence = 'low'
  }
  if (!responseLanguage) {
    responseLanguage = 'en-US'
    source = 'und-en-fallback'
    confidence = 'low'
  }
  if (!durablePrimaryLocale && !['explicit-current-turn', 'host-or-terminal-locale', 'und-en-fallback'].includes(source)) {
    durablePrimaryLocale = responseLanguage
    durableProvisional = false
    durableSource = source
    durableConfidence = confidence
  }
  if (!durablePrimaryLocale) {
    durablePrimaryLocale = responseLanguage
    durableSource = `provisional:${source}`
    durableConfidence = 'low'
    durableProvisional = true
  }

  const durableChanged = !durableProvisional && (durablePrimaryLocale !== priorDurable ||
    (durableSource && durableSource !== String(taskContext?.durableSource || conversationContext?.durableSource || ''))
  )
  if (durableChanged || !durableUpdatedAt) durableUpdatedAt = new Date().toISOString()
  const durableSourceDigest = digest({
    durablePrimaryLocale,
    durableProvisional,
    durableSource,
    durableConfidence,
    preferenceDigest: preference.preferenceDigest
  })
  return {
    schemaVersion: LANGUAGE_CONTEXT_SCHEMA,
    durablePrimaryLocale,
    durableProvisional,
    durableSource: durableSource || source,
    durableConfidence,
    durableSourceDigest,
    durableUpdatedAt,
    primaryLanguage: responseLanguage,
    responseLanguage,
    artifactLanguage: responseLanguage,
    currentTurnClass,
    source,
    confidence,
    updatedPrimary: durableChanged,
    turnOverride: explicit || null,
    persistentOverride,
    preferenceDigest: preference.preferenceDigest,
    preferenceSource: preference.source,
    localeCapability: localeCapability(responseLanguage),
    diagnostics: preference.diagnostics
  }
}

function formatLanguageContextInstruction(context) {
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
