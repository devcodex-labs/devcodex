'use strict'

/**
 * SummaryTypeCanonGate — Agent SUMMARY「类型」列与 session allocate intent 的 canonical 校验。
 * 仅允许顶层工作流意图；多意图用 `+` 连接，禁止 `/` 与任意自由标签。
 */

const CANONICAL_SUMMARY_TYPES = Object.freeze([
  'dev',
  'fix',
  'analyze',
  'audit',
  'self-fix',
  'chat',
  'resume',
  'other'
])

const CANONICAL_SET = new Set(CANONICAL_SUMMARY_TYPES)

/** allocate 允许的额外占位（会话头未定意图时） */
const ALLOCATE_EXTRA = new Set(['unspecified'])

function parseTypeTokens(rawInput, { allowUnspecified = false } = {}) {
  const raw = String(rawInput === undefined || rawInput === null ? '' : rawInput).trim()
  if (!raw) {
    return {
      ok: false,
      errorCode: 'SUMMARY_TYPE_EMPTY',
      message: 'type/intent is required',
      tokens: [],
      normalized: ''
    }
  }
  if (allowUnspecified && raw.toLowerCase() === 'unspecified') {
    return {
      ok: true,
      errorCode: null,
      message: null,
      tokens: ['unspecified'],
      normalized: 'unspecified'
    }
  }
  if (raw.includes('/')) {
    return {
      ok: false,
      errorCode: 'SUMMARY_TYPE_SLASH',
      message: 'use + to join intents, not / (e.g. fix+dev, not fix/dev)',
      tokens: [],
      normalized: ''
    }
  }
  if (/\s/.test(raw)) {
    return {
      ok: false,
      errorCode: 'SUMMARY_TYPE_WHITESPACE',
      message: 'type/intent must not contain whitespace',
      tokens: [],
      normalized: ''
    }
  }
  const tokens = raw.split('+').map(part => part.trim().toLowerCase()).filter(Boolean)
  if (!tokens.length) {
    return {
      ok: false,
      errorCode: 'SUMMARY_TYPE_EMPTY',
      message: 'type/intent is required',
      tokens: [],
      normalized: ''
    }
  }
  const allowed = allowUnspecified
    ? new Set([...CANONICAL_SET, ...ALLOCATE_EXTRA])
    : CANONICAL_SET
  const invalid = tokens.filter(token => !allowed.has(token))
  if (invalid.length) {
    return {
      ok: false,
      errorCode: 'SUMMARY_TYPE_NON_CANONICAL',
      message: `non-canonical intent token(s): ${invalid.join(', ')}; allowed: ${[...CANONICAL_SUMMARY_TYPES].join('|')}${allowUnspecified ? '|unspecified' : ''} joined by +`,
      tokens,
      invalid,
      normalized: ''
    }
  }
  return {
    ok: true,
    errorCode: null,
    message: null,
    tokens,
    normalized: tokens.join('+')
  }
}

/**
 * @param {string} type SUMMARY 类型列
 * @returns {{ ok: true, normalized: string, tokens: string[] } | { ok: false, errorCode: string, message: string }}
 */
function validateSummaryType(type) {
  return parseTypeTokens(type, { allowUnspecified: false })
}

/**
 * @param {string} [intent] memory_session_allocate.intent
 */
function validateAllocateIntent(intent) {
  const raw = String(intent === undefined || intent === null ? 'unspecified' : intent).trim() || 'unspecified'
  return parseTypeTokens(raw, { allowUnspecified: true })
}

/**
 * @param {string} type
 * @returns {string} normalized type
 * @throws {Error} with .code = SUMMARY_TYPE_*
 */
function assertSummaryType(type) {
  const result = validateSummaryType(type)
  if (!result.ok) {
    const err = new Error(`Invalid SUMMARY type: ${result.message}`)
    err.code = result.errorCode
    throw err
  }
  return result.normalized
}

/**
 * @param {string} [intent]
 * @returns {string}
 */
function assertAllocateIntent(intent) {
  const result = validateAllocateIntent(intent)
  if (!result.ok) {
    const err = new Error(`Invalid allocate intent: ${result.message}`)
    err.code = result.errorCode
    throw err
  }
  return result.normalized
}

module.exports = {
  CANONICAL_SUMMARY_TYPES,
  validateSummaryType,
  validateAllocateIntent,
  assertSummaryType,
  assertAllocateIntent
}
