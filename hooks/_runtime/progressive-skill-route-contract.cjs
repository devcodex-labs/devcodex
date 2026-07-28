'use strict'

const crypto = require('crypto')

const SKILL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DIGEST_RE = /^[a-f0-9]{64}$/
const INSTRUCTION_SHAPED = [
  /ignore\s+(?:all\s+)?(?:(?:previous|prior)\s+(?:system\s+)?|system\s+)instructions?/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|system)/i,
  /忽略.{0,12}(?:上级|之前|系统|指令)/,
  /覆盖.{0,12}(?:上级|系统|指令)/,
  /<\s*\/?\s*(?:system|assistant|developer|tool)\b/i,
  /```(?:system|assistant|developer|tool)\b/i
]
const BIDI_CONTROL_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/
const DISALLOWED_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

function stableStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function sha256 (value) {
  const text = typeof value === 'string' ? value : stableStringify(value)
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function byteLength (value) {
  return Buffer.byteLength(typeof value === 'string' ? value : stableStringify(value), 'utf8')
}

function portable (filePath) {
  return String(filePath || '').replace(/\\/g, '/')
}

function normalizeText (value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').normalize('NFC').trim()
}

function sanitizeModelText (value, options = {}) {
  const text = normalizeText(value).replace(/\s+/g, ' ')
  const maxChars = Number.isInteger(options.maxChars) ? options.maxChars : 160
  if (text.length > maxChars) {
    return { ok: false, reasonCode: 'oversize', value: null }
  }
  if (DISALLOWED_CONTROL_RE.test(text) || BIDI_CONTROL_RE.test(text)) {
    return { ok: false, reasonCode: 'sanitize-fail', value: null }
  }
  if (INSTRUCTION_SHAPED.some(pattern => pattern.test(text))) {
    return { ok: false, reasonCode: 'instruction-shaped', value: null }
  }
  return { ok: true, reasonCode: null, value: text }
}

function parseFrontmatter (raw) {
  const text = String(raw || '')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: text }
  const frontmatter = {}
  let currentKey = null
  let buffer = []
  const flush = () => {
    if (!currentKey) return
    frontmatter[currentKey] = buffer.join('\n').trim()
    currentKey = null
    buffer = []
  }
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (pair) {
      flush()
      const rest = pair[2]
      if (!rest || rest === '|' || rest === '>') {
        currentKey = pair[1]
      } else {
        frontmatter[pair[1]] = rest.replace(/^['"]|['"]$/g, '').trim()
      }
      continue
    }
    if (currentKey) buffer.push(line.replace(/^\s{2}/, ''))
  }
  flush()
  return { frontmatter, body: match[2] || '' }
}

function validateStringArray (value, options = {}) {
  if (!Array.isArray(value)) return { ok: false, reasonCode: 'schema-invalid' }
  if (value.length < (options.min || 0) || value.length > (options.max || Infinity)) {
    return { ok: false, reasonCode: 'schema-invalid' }
  }
  const normalized = []
  for (const item of value) {
    const clean = sanitizeModelText(item, { maxChars: options.maxChars || 48 })
    if (!clean.ok || !clean.value) return { ok: false, reasonCode: clean.reasonCode || 'schema-invalid' }
    normalized.push(clean.value)
  }
  if (new Set(normalized).size !== normalized.length) return { ok: false, reasonCode: 'schema-invalid' }
  return { ok: true, value: normalized }
}

function validateSkillIntent (raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasonCode: 'malformed-intent' }
  }
  if (byteLength(raw) > (options.maxBytes || 16 * 1024)) {
    return { ok: false, reasonCode: 'oversize' }
  }
  const allowed = new Set(['schemaVersion', 'skillId', 'intents', 'examples', 'summary'])
  if (Object.keys(raw).some(key => !allowed.has(key))) {
    return { ok: false, reasonCode: 'schema-invalid' }
  }
  if (raw.schemaVersion !== 'SkillIntentV1' || !SKILL_ID_RE.test(String(raw.skillId || ''))) {
    return { ok: false, reasonCode: 'identity-mismatch' }
  }
  if (options.skillId && raw.skillId !== options.skillId) {
    return { ok: false, reasonCode: 'identity-mismatch' }
  }
  if (!Array.isArray(raw.intents) || raw.intents.length < 1 || raw.intents.length > 6) {
    return { ok: false, reasonCode: 'schema-invalid' }
  }
  const intents = []
  const ids = new Set()
  for (const item of raw.intents) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reasonCode: 'schema-invalid' }
    }
    if (Object.keys(item).some(key => !['id', 'label', 'include'].includes(key))) {
      return { ok: false, reasonCode: 'schema-invalid' }
    }
    const id = String(item.id || '')
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || ids.has(id)) {
      return { ok: false, reasonCode: 'schema-invalid' }
    }
    ids.add(id)
    const label = sanitizeModelText(item.label, { maxChars: 40 })
    const include = validateStringArray(item.include, { max: 8, maxChars: 16 })
    if (!label.ok || !label.value || !include.ok) {
      return { ok: false, reasonCode: label.reasonCode || include.reasonCode || 'schema-invalid' }
    }
    intents.push({ id, label: label.value, include: include.value })
  }
  const examples = raw.examples
  if (!examples || typeof examples !== 'object' || Array.isArray(examples) ||
      Object.keys(examples).some(key => !['positive', 'negative'].includes(key))) {
    return { ok: false, reasonCode: 'schema-invalid' }
  }
  const positive = validateStringArray(examples.positive, {
    min: options.allowLegacyEmptyExamples ? 0 : 2,
    max: 8,
    maxChars: 48
  })
  const negative = validateStringArray(examples.negative, {
    min: options.allowLegacyEmptyExamples ? 0 : 2,
    max: 8,
    maxChars: 48
  })
  const summary = sanitizeModelText(raw.summary, { maxChars: 160 })
  if (!positive.ok || !negative.ok || !summary.ok) {
    return {
      ok: false,
      reasonCode: positive.reasonCode || negative.reasonCode || summary.reasonCode || 'schema-invalid'
    }
  }
  const value = {
    schemaVersion: 'SkillIntentV1',
    skillId: raw.skillId,
    intents,
    examples: { positive: positive.value, negative: negative.value },
    summary: summary.value
  }
  if (byteLength(value) > 4 * 1024) return { ok: false, reasonCode: 'oversize' }
  return { ok: true, value, digest: sha256(value) }
}

function makeToolError (op, errorCode, nextStep, extra = {}) {
  const response = {
    schemaVersion: 'SkillRouteToolResultV1',
    ok: false,
    op,
    errorCode,
    stateChanged: extra.stateChanged === true,
    nextStep: String(nextStep || 'Retry with a fresh bound request.'),
    receipt: extra.receipt || null,
    bodyChunks: [],
    delivery: {
      channel: 'mcp-tool-result',
      serializedBytes: 0,
      limitBytes: extra.limitBytes || 16 * 1024,
      runtimeServed: false,
      modelObserved: 'unverified'
    }
  }
  response.delivery.serializedBytes = byteLength(response)
  return response
}

module.exports = {
  SKILL_ID_RE,
  DIGEST_RE,
  stableStringify,
  sha256,
  byteLength,
  portable,
  normalizeText,
  sanitizeModelText,
  parseFrontmatter,
  validateSkillIntent,
  makeToolError
}
