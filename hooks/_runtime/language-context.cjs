'use strict'

const LANGUAGE_RULES = [
  ['ja', /[\u3040-\u30ff]/u],
  ['ko', /[\uac00-\ud7af]/u],
  ['zh-CN', /[\u3400-\u9fff]/u],
  ['ru', /[\u0400-\u04ff]/u],
  ['ar', /[\u0600-\u06ff]/u]
]

function explicitLanguage(text) {
  const value = String(text || '')
  if (/(?:用|使用|回复|回答|输出|请用)\s*(?:中文|汉语)|(?:respond|reply|write|output)\s+in\s+(?:chinese|zh)/i.test(value)) return 'zh-CN'
  if (/(?:用|使用|回复|回答|输出|请用)\s*(?:英文|英语)|(?:respond|reply|write|output)\s+in\s+(?:english|en)/i.test(value)) return 'en'
  if (/(?:respond|reply|write|output)\s+in\s+japanese/i.test(value)) return 'ja'
  if (/(?:respond|reply|write|output)\s+in\s+korean/i.test(value)) return 'ko'
  return ''
}

function languageFromText(text) {
  const value = String(text || '')
  for (const [language, pattern] of LANGUAGE_RULES) {
    if (pattern.test(value)) return language
  }
  if (/[A-Za-z]/.test(value)) return 'en'
  return ''
}

/** Resolve a turn-bound language without inventing prompt evidence for non-prompt callers. */
function resolveLanguageContext(input = {}) {
  const explicit = explicitLanguage(input.explicitLanguage || input.prompt)
  if (explicit) return { schemaVersion: 'LanguageContextV1', language: explicit, source: 'explicit-current-turn', confidence: 'high' }
  const fromPrompt = languageFromText(input.prompt)
  if (fromPrompt) return { schemaVersion: 'LanguageContextV1', language: fromPrompt, source: 'current-user-message', confidence: 'high' }
  const carrier = String(input.carrier?.language || '').trim()
  if (carrier) return { schemaVersion: 'LanguageContextV1', language: carrier, source: 'turn-bound-carrier', confidence: 'medium' }
  const workspace = String(input.workspacePreference || '').trim()
  if (workspace) return { schemaVersion: 'LanguageContextV1', language: workspace, source: 'workspace-preference', confidence: 'medium' }
  const locale = String(input.locale || '').trim()
  if (locale) return { schemaVersion: 'LanguageContextV1', language: locale, source: 'host-or-terminal-locale', confidence: 'low' }
  return { schemaVersion: 'LanguageContextV1', language: 'en', source: 'und-en-fallback', confidence: 'low' }
}

function formatLanguageContextInstruction(context) {
  const language = String(context?.language || 'en')
  const source = String(context?.source || 'und-en-fallback')
  return [
    '### DevCodex · LanguageContextV1',
    `Human-facing reply, title, and natural-language artifact body language: ${language} (source=${source}).`,
    'Keep protocol keys, CLI parameters, schema/gate/skill IDs, and default canonical filenames in English. Do not claim user-language observation when source=und-en-fallback.'
  ].join('\n')
}

module.exports = { formatLanguageContextInstruction, resolveLanguageContext }
