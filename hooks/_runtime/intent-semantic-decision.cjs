'use strict'

const { validateActualInstructionEnvelope } = require('./actual-instruction-envelope.cjs')
const { normalizeLanguageTag } = require('./language-context.cjs')
const { stableStringify } = require('./content-identity.cjs')
const SCHEMA_VERSION = 'IntentSemanticDecisionV1'
const AXES = {
  ceremonyTier: ['simple', 'standard'],
  designDepth: ['minimal', 'standard'],
  assuranceLevel: ['targeted', 'affected', 'full']
}
const FACTS = [
  'targetKnown', 'publicContract', 'schemaChange', 'sharedState', 'migration',
  'recovery', 'securitySensitive', 'packageBoundary', 'releaseRequested',
  'externalSideEffect', 'fullAuditRequested', 'crossModule', 'multipleConsumers',
  'scopeExpanded', 'unknownScope'
]
const SEMANTIC_DECISION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'sourceRef'],
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    sourceRef: {
      type: 'object', additionalProperties: false, required: ['envelopeId', 'envelopeDigest', 'contextEpoch'],
      properties: {
        envelopeId: { type: 'string', minLength: 1, maxLength: 128 },
        envelopeDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        contextEpoch: { type: 'string', minLength: 1, maxLength: 128 }
      }
    },
    workflowPreference: {
      type: 'object', additionalProperties: false,
      properties: Object.fromEntries(Object.entries(AXES).map(([key, values]) => [key, { type: 'string', enum: values }]))
    },
    workflowFacts: {
      type: 'object', additionalProperties: false,
      properties: {
        ...Object.fromEntries(FACTS.map(key => [key, { type: 'boolean' }])),
        changedFileCount: { type: 'integer', minimum: 0 },
        consumerCount: { type: 'integer', minimum: 0 }
      }
    },
    executionDecision: { type: 'string', enum: ['enable-auto', 'disable-auto', 'retain-current', 'confirm'] },
    validationDecision: {
      type: 'object', additionalProperties: false, required: ['action'],
      properties: {
        action: { type: 'string', enum: ['none', 'revoke', 'confirm-current-budget'] },
        requestedBudgetDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        declaredChangedPathCount: { type: 'integer', minimum: 1, maximum: 512 }
      }
    },
    languageDecision: {
      type: 'object', additionalProperties: false, required: ['replyLocale', 'scope', 'kind'],
      properties: {
        replyLocale: { type: 'string', minLength: 2, maxLength: 48, description: 'Language tag selected from user intent; short tags such as en and zh are accepted and normalized by the renderer.' },
        artifactLocale: { type: 'string', minLength: 2, maxLength: 48, description: 'Artifact language tag; omit to use replyLocale.' },
        scope: { type: 'string', enum: ['turn', 'task'] },
        kind: { type: 'string', enum: ['retain', 'infer', 'explicit'] }
      }
    }
  }
}

/** Validate only this bounded public contract; this function never interprets prose. */
function checkShape(value, schema, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(label + ': object required')
    return
  }
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
      errors.push(label + ': unknown field ' + key)
      continue
    }
    const rule = schema.properties[key]
    const field = value[key]
    if (rule.type === 'object') checkShape(field, rule, label + '.' + key, errors)
    else if (rule.const !== undefined && field !== rule.const) errors.push(label + '.' + key + ': invalid version')
    else if (rule.enum && !rule.enum.includes(field)) errors.push(label + '.' + key + ': invalid enum')
    else if (rule.type === 'string' && (typeof field !== 'string' || field !== field.trim() ||
      field.length < (rule.minLength || 0) || field.length > (rule.maxLength ?? 256) ||
      (rule.pattern && !new RegExp(rule.pattern).test(field)))) errors.push(label + '.' + key + ': invalid string')
    else if (rule.type === 'boolean' && typeof field !== 'boolean') errors.push(label + '.' + key + ': boolean required')
    else if (rule.type === 'integer' && (!Number.isSafeInteger(field) || field < (rule.minimum ?? 0) ||
      field > (rule.maximum ?? Number.MAX_SAFE_INTEGER))) errors.push(label + '.' + key + ': bounded integer required')
  }
  for (const key of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(label + ': missing ' + key)
  }
}

/**
 * Validate shape, then optionally bind to a separately observed host envelope.
 * Absence means no new semantic decision, never implicit authorization.
 */
function validateIntentSemanticDecision(value, expected = {}) {
  if (value === undefined) return { valid: true, errors: [], value: undefined }
  const errors = []
  checkShape(value, SEMANTIC_DECISION_SCHEMA, 'semanticDecision', errors)
  const ref = value?.sourceRef
  if (value?.validationDecision?.action !== 'confirm-current-budget' &&
      (value?.validationDecision?.requestedBudgetDigest !== undefined || value?.validationDecision?.declaredChangedPathCount !== undefined)) {
    errors.push('validation confirmation fields require confirm-current-budget')
  }
  if (expected.contextEpoch && ref?.contextEpoch !== expected.contextEpoch) errors.push('semantic source epoch mismatch')
  if (value?.languageDecision) {
    for (const key of ['replyLocale', 'artifactLocale']) {
      const locale = value.languageDecision[key]
      if (locale === undefined) continue
      try {
        if (typeof locale !== 'string' || Intl.getCanonicalLocales(locale).length !== 1 || !normalizeLanguageTag(locale)) {
          errors.push('languageDecision.' + key + ': valid language tag required')
        }
      } catch {
        errors.push('languageDecision.' + key + ': valid language tag required')
      }
    }
  }
  if (expected.requireSource || expected.envelope) {
    const envelope = expected.envelope
    if (!validateActualInstructionEnvelope(envelope).valid || envelope.instructionAuthority !== true ||
        envelope.provenanceLevel !== 'trusted-host-event' || Date.parse(envelope.expiresAt) <= (expected.nowMs ?? Date.now()) ||
        ref?.envelopeId !== envelope.envelopeId || ref?.envelopeDigest !== envelope.envelopeDigest ||
        ref?.contextEpoch !== envelope.contextEpoch ||
        (expected.hostSessionDigest && envelope.hostSessionDigest !== expected.hostSessionDigest)) {
      errors.push('semantic decision does not match the current trusted host source')
    }
  }
  return { valid: errors.length === 0, errors, value: errors.length ? null : JSON.parse(stableStringify(value)) }
}

module.exports = { SCHEMA_VERSION, SEMANTIC_DECISION_SCHEMA, validateIntentSemanticDecision }
