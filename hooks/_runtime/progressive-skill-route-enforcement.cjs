'use strict'

const fs = require('fs')
const path = require('path')

const POLICY_SCHEMA = 'ProgressiveSkillRouteEnforcementPolicyV1'
const FEATURE = 'progressive-skill-route'
const POLICY_PATH = path.join(__dirname, 'progressive-skill-route-enforcement.v1.json')
const DECISION_FIELDS = Object.freeze([
  'bootstrap', 'observe', 'hardEnforcement', 'reasonCode', 'capabilityClaim'
])
const OVERRIDE_EVENTS = new Set(['PreToolUse', 'Stop'])
const REQUIRED_OVERRIDE_KEYS = new Set(['codex|PreToolUse', 'codex|Stop'])

function hasExactKeys (value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function normalizeHostFamily (hostVariant) {
  const value = String(hostVariant || '').trim().toLowerCase()
  if (!value) return 'unknown'
  if (value === 'codex' || value.startsWith('codex-') || value.startsWith('codex/')) return 'codex'
  if (value === 'claude' || value.startsWith('claude-') || value.startsWith('claude/')) return 'claude'
  if (value === 'grok' || value.startsWith('grok-') || value.startsWith('grok/')) return 'grok'
  if (value === 'gemini' || value.startsWith('gemini-') || value.startsWith('gemini/')) return 'gemini'
  if (value === 'cursor' || value.startsWith('cursor-') || value.startsWith('cursor/')) return 'cursor'
  return value.split('/')[0]
}

function validateBooleanFields (value, label) {
  if (!hasExactKeys(value, DECISION_FIELDS)) throw new Error(`${label} fields are invalid`)
  for (const field of ['bootstrap', 'observe', 'hardEnforcement']) {
    if (typeof value?.[field] !== 'boolean') throw new Error(`${label}.${field} must be boolean`)
  }
  if (!String(value?.reasonCode || '').trim()) throw new Error(`${label}.reasonCode is required`)
  if (!String(value?.capabilityClaim || '').trim()) throw new Error(`${label}.capabilityClaim is required`)
}

function validatePolicy (value) {
  if (!value || value.schemaVersion !== POLICY_SCHEMA || value.feature !== FEATURE) {
    throw new Error('Progressive Skill route enforcement policy identity is invalid')
  }
  if (!hasExactKeys(value, ['schemaVersion', 'feature', 'defaults', 'overrides'])) {
    throw new Error('Progressive Skill route enforcement policy fields are invalid')
  }
  validateBooleanFields(value.defaults, 'defaults')
  if (value.defaults.bootstrap !== true || value.defaults.observe !== true || value.defaults.hardEnforcement !== true ||
      value.defaults.capabilityClaim !== 'policy-only') {
    throw new Error('defaults must preserve bootstrap/observe/hard enforcement with policy-only capability')
  }
  if (!Array.isArray(value.overrides)) throw new Error('overrides must be an array')
  const keys = new Set()
  for (const [index, item] of value.overrides.entries()) {
    if (!String(item?.hostFamily || '').trim() || !String(item?.eventName || '').trim()) {
      throw new Error(`overrides[${index}] hostFamily and eventName are required`)
    }
    if (!hasExactKeys(item, ['hostFamily', 'eventName', ...DECISION_FIELDS])) {
      throw new Error(`overrides[${index}] fields are invalid`)
    }
    validateBooleanFields(Object.fromEntries(DECISION_FIELDS.map(field => [field, item[field]])), `overrides[${index}]`)
    if (!OVERRIDE_EVENTS.has(item.eventName)) throw new Error(`overrides[${index}].eventName is invalid`)
    const hostFamily = normalizeHostFamily(item.hostFamily)
    const key = `${hostFamily}|${item.eventName}`
    if (keys.has(key)) throw new Error(`duplicate enforcement override: ${key}`)
    if (hostFamily !== 'codex' || item.bootstrap !== true || item.observe !== true || item.hardEnforcement !== false ||
        item.capabilityClaim !== 'policy-only-no-host-pass-claim') {
      throw new Error(`overrides[${index}] may only disable Codex hard enforcement while preserving bootstrap/observe and claim ceiling`)
    }
    keys.add(key)
  }
  if (keys.size !== REQUIRED_OVERRIDE_KEYS.size || [...REQUIRED_OVERRIDE_KEYS].some(key => !keys.has(key))) {
    throw new Error('overrides must contain exactly Codex PreToolUse and Stop')
  }
  return value
}

function loadPolicy (options = {}) {
  const fsImpl = options.fs || fs
  const policyPath = options.policyPath || POLICY_PATH
  const value = JSON.parse(fsImpl.readFileSync(policyPath, 'utf8'))
  return validatePolicy(value)
}

function resolveProgressiveSkillRouteEnforcement (input = {}, options = {}) {
  const hostFamily = normalizeHostFamily(input.hostVariant || input.hostFamily)
  const eventName = String(input.eventName || '').trim()
  let policy
  try {
    policy = options.policy || loadPolicy(options)
    validatePolicy(policy)
  } catch {
    const codexAdvisory = hostFamily === 'codex' && OVERRIDE_EVENTS.has(eventName)
    return {
      schemaVersion: 'ProgressiveSkillRouteEnforcementDecisionV1',
      feature: FEATURE,
      hostFamily,
      hostVariant: String(input.hostVariant || ''),
      eventName,
      bootstrap: true,
      observe: true,
      hardEnforcement: !codexAdvisory,
      reasonCode: codexAdvisory
        ? 'codex-progressive-policy-unavailable-advisory'
        : 'progressive-skill-route-policy-unavailable-hard-default',
      capabilityClaim: codexAdvisory
        ? 'policy-only-no-host-pass-claim'
        : 'policy-only',
      source: 'fail-safe-policy-unavailable'
    }
  }
  const override = policy.overrides.find(item =>
    normalizeHostFamily(item.hostFamily) === hostFamily && item.eventName === eventName
  )
  const decision = override || policy.defaults
  return {
    schemaVersion: 'ProgressiveSkillRouteEnforcementDecisionV1',
    feature: FEATURE,
    hostFamily,
    hostVariant: String(input.hostVariant || ''),
    eventName,
    bootstrap: decision.bootstrap,
    observe: decision.observe,
    hardEnforcement: decision.hardEnforcement,
    reasonCode: decision.reasonCode,
    capabilityClaim: decision.capabilityClaim,
    source: override ? 'host-event-override' : 'default'
  }
}

module.exports = {
  FEATURE,
  POLICY_PATH,
  POLICY_SCHEMA,
  loadPolicy,
  normalizeHostFamily,
  resolveProgressiveSkillRouteEnforcement,
  validatePolicy
}
