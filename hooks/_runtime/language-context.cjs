'use strict'

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
  if (/^en(?:-|$)/i.test(raw)) return 'en'
  if (/^ja(?:-|$)/i.test(raw)) return 'ja'
  if (/^ko(?:-|$)/i.test(raw)) return 'ko'
  if (/^ru(?:-|$)/i.test(raw)) return 'ru'
  if (/^ar(?:-|$)/i.test(raw)) return 'ar'
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(raw) ? raw : ''
}

function explicitLanguage(text) {
  const value = String(text || '')
  if (/(?:用|使用|回复|回答|输出|请用)\s*(?:中文|汉语)|(?:respond|reply|write|output)\s+in\s+(?:chinese|zh)/i.test(value)) return 'zh-CN'
  if (/(?:用|使用|回复|回答|输出|请用)\s*(?:英文|英语)|(?:respond|reply|write|output)\s+in\s+(?:english|en)/i.test(value)) return 'en'
  if (/(?:用|使用|回复|回答|输出|请用)\s*(?:日文|日语)|(?:respond|reply|write|output)\s+in\s+(?:japanese|ja)/i.test(value)) return 'ja'
  if (/(?:用|使用|回复|回答|输出|请用)\s*(?:韩文|韩语)|(?:respond|reply|write|output)\s+in\s+(?:korean|ko)/i.test(value)) return 'ko'
  if (/(?:用|使用|回复|回答|输出|请用)\s*(?:俄文|俄语)|(?:respond|reply|write|output)\s+in\s+(?:russian|ru)/i.test(value)) return 'ru'
  if (/(?:用|使用|回复|回答|输出|请用)\s*(?:阿拉伯文|阿拉伯语)|(?:respond|reply|write|output)\s+in\s+(?:arabic|ar)/i.test(value)) return 'ar'
  return ''
}

function primaryFromContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  if (value.schemaVersion === 'LanguageContextV2') {
    return normalizeLanguageTag(value.primaryLanguage || value.responseLanguage)
  }
  if (value.schemaVersion === 'LanguageContextV1' || value.language) {
    return normalizeLanguageTag(value.language)
  }
  return ''
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
  if (/[A-Za-z]/.test(value)) return 'en'
  return ''
}

/** Resolve a task-bound language. Neutral confirmations, paths, versions and quoted/code text never switch it. */
function resolveLanguageContext(input = {}) {
  const prompt = String(input.prompt || '')
  const currentTurnClass = classifyLanguageTurn(prompt)
  const explicit = currentTurnClass === 'explicit-switch'
    ? explicitLanguage(input.explicitLanguage || prompt)
    : ''
  const taskPrimary = primaryFromContext(input.taskContext || input.taskLanguageContext)
  const conversationPrimary = primaryFromContext(input.conversationContext || input.carrier)
  let primaryLanguage = ''
  let source = ''
  let confidence = 'low'
  let updatedPrimary = false

  if (explicit) {
    primaryLanguage = explicit
    source = 'explicit-current-turn'
    confidence = 'high'
    updatedPrimary = explicit !== (taskPrimary || conversationPrimary)
  } else if (taskPrimary) {
    primaryLanguage = taskPrimary
    source = 'task-primary-language'
    confidence = 'high'
  } else if (conversationPrimary) {
    primaryLanguage = conversationPrimary
    source = 'conversation-primary-language'
    confidence = 'high'
  } else if (currentTurnClass === 'substantive') {
    primaryLanguage = languageFromText(prompt)
    if (primaryLanguage) {
      source = 'first-substantive-user-message'
      confidence = 'high'
      updatedPrimary = true
    }
  }
  const workspace = normalizeLanguageTag(input.workspacePreference)
  if (!primaryLanguage && workspace) {
    primaryLanguage = workspace
    source = 'workspace-preference'
    confidence = 'medium'
  }
  const locale = normalizeLanguageTag(input.locale)
  if (!primaryLanguage && locale) {
    primaryLanguage = locale
    source = 'host-or-terminal-locale'
    confidence = 'low'
  }
  if (!primaryLanguage) {
    primaryLanguage = 'en'
    source = 'und-en-fallback'
    confidence = 'low'
  }
  return {
    schemaVersion: 'LanguageContextV2',
    primaryLanguage,
    responseLanguage: primaryLanguage,
    artifactLanguage: primaryLanguage,
    currentTurnClass,
    source,
    confidence,
    updatedPrimary
  }
}

function formatLanguageContextInstruction(context) {
  const language = String(context?.responseLanguage || context?.primaryLanguage || context?.language || 'en')
  const artifactLanguage = String(context?.artifactLanguage || language)
  const source = String(context?.source || 'und-en-fallback')
  return [
    '### DevCodex · LanguageContextV2',
    `Human-facing reply language: ${language}; human-facing artifact title/body/semantic filename language: ${artifactLanguage} (source=${source}, currentTurnClass=${context?.currentTurnClass || 'neutral'}).`,
    'Keep protocol keys, CLI parameters, schema/gate/skill IDs, and fixed canonical filenames unchanged. A yes/no confirmation, CP/version code, path, code block, or quoted text never changes the task primary language.',
    'Do not claim user-language observation when source=und-en-fallback.'
  ].join('\n')
}

module.exports = { classifyLanguageTurn, formatLanguageContextInstruction, normalizeLanguageTag, resolveLanguageContext }
