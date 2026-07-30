'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { resolveControlAsset } = require('./control-content-delivery')

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const SCHEMA_PATH = resolveControlAsset(
  PACKAGE_ROOT,
  'skills/spec-governance/capability-surface-decision.v1.schema.json'
)
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'))
const MCP_SURFACES = new Set(['prompt', 'resource', 'resource-template', 'tool', 'task-augmented-tool'])
const RESOURCE_SURFACES = new Set(['resource', 'resource-template'])
const MUTATING_OPERATIONS = new Set(['write', 'execute'])
const KIND_SURFACES = {
  'semantic-judgement': new Set(['rule-skill']),
  'content-delivery': new Set(['resource', 'resource-template']),
  'user-template': new Set(['prompt']),
  'deterministic-read': new Set(['resource', 'resource-template', 'tool']),
  'controlled-write': new Set(['tool', 'task-augmented-tool', 'cli']),
  'long-running-operation': new Set(['task-augmented-tool']),
  'host-event': new Set(['hook']),
  'low-frequency-operations': new Set(['cli'])
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
  return crypto.createHash('sha256').update(content).digest('hex')
}

function schemaDigest() {
  return sha256(fs.readFileSync(SCHEMA_PATH))
}

function issue(pathValue, code, message) {
  return { path: pathValue, code, message, severity: 'BLOCK' }
}

function typeMatches(value, type) {
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  return typeof value === type
}

function validateSchemaNode(value, node, pathValue, issues) {
  if (!node || typeof node !== 'object') return
  if (node.const !== undefined && stableStringify(value) !== stableStringify(node.const)) {
    issues.push(issue(pathValue, 'const-mismatch', `${pathValue} must equal ${JSON.stringify(node.const)}`))
    return
  }
  if (Array.isArray(node.enum) && !node.enum.some(item => stableStringify(item) === stableStringify(value))) {
    issues.push(issue(pathValue, 'enum-invalid', `${pathValue} is not an allowed value`))
    return
  }
  if (node.type && !typeMatches(value, node.type)) {
    issues.push(issue(pathValue, 'type-invalid', `${pathValue} must be ${node.type}`))
    return
  }

  for (const branch of node.allOf || []) {
    if (branch.if) {
      const conditionIssues = []
      validateSchemaNode(value, branch.if, pathValue, conditionIssues)
      if (!conditionIssues.length && branch.then) {
        validateSchemaNode(value, branch.then, pathValue, issues)
      }
    } else {
      validateSchemaNode(value, branch, pathValue, issues)
    }
  }

  if (typeof value === 'string') {
    if (Number.isInteger(node.minLength) && value.length < node.minLength) {
      issues.push(issue(pathValue, 'string-too-short', `${pathValue} is shorter than ${node.minLength}`))
    }
    if (node.pattern && !new RegExp(node.pattern).test(value)) {
      issues.push(issue(pathValue, 'pattern-mismatch', `${pathValue} does not match ${node.pattern}`))
    }
    if (node.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value)))) {
      issues.push(issue(pathValue, 'date-time-invalid', `${pathValue} must be an ISO date-time`))
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(node.minItems) && value.length < node.minItems) {
      issues.push(issue(pathValue, 'array-too-short', `${pathValue} needs at least ${node.minItems} item(s)`))
    }
    if (Number.isInteger(node.maxItems) && value.length > node.maxItems) {
      issues.push(issue(pathValue, 'array-too-long', `${pathValue} allows at most ${node.maxItems} item(s)`))
    }
    if (node.uniqueItems) {
      const identities = value.map(stableStringify)
      if (new Set(identities).size !== identities.length) {
        issues.push(issue(pathValue, 'array-duplicate', `${pathValue} contains duplicate items`))
      }
    }
    if (node.items) {
      value.forEach((item, index) => validateSchemaNode(item, node.items, `${pathValue}[${index}]`, issues))
    }
    if (node.contains) {
      const containsMatch = value.some((item, index) => {
        const itemIssues = []
        validateSchemaNode(item, node.contains, `${pathValue}[${index}]`, itemIssues)
        return itemIssues.length === 0
      })
      if (!containsMatch) {
        issues.push(issue(pathValue, 'array-contains-missing', `${pathValue} does not contain a required item`))
      }
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const field of node.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) {
        issues.push(issue(`${pathValue}.${field}`, 'required-field-missing', `${field} is required`))
      }
    }
    const known = new Set(Object.keys(node.properties || {}))
    if (node.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!known.has(field)) issues.push(issue(`${pathValue}.${field}`, 'unknown-field', `${field} is not allowed`))
      }
    }
    for (const [field, fieldSchema] of Object.entries(node.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        validateSchemaNode(value[field], fieldSchema, pathValue === '$' ? field : `${pathValue}.${field}`, issues)
      }
    }
  }
}

function validateSurfaceSemantics(decision, issues) {
  const allowed = KIND_SURFACES[decision.capabilityKind]
  if (allowed && !allowed.has(decision.preferredSurface)) {
    issues.push(issue(
      'preferredSurface',
      'capability-surface-mismatch',
      `${decision.capabilityKind} cannot use ${decision.preferredSurface}`
    ))
  }
  if (decision.semanticJudgement === 'open-ended' && decision.preferredSurface !== 'rule-skill') {
    issues.push(issue('preferredSurface', 'semantic-judgement-surface', 'open-ended judgement must remain rule-skill'))
  }
  if (decision.contentDelivery === 'unbounded' && MCP_SURFACES.has(decision.preferredSurface)) {
    issues.push(issue('contentDelivery', 'unbounded-mcp-payload', 'unbounded content cannot be exposed as an MCP payload'))
  }
  if (MCP_SURFACES.has(decision.preferredSurface) && !decision.mcpContract) {
    issues.push(issue('mcpContract', 'mcp-contract-required', 'MCP surfaces require mcpContract'))
  }
  if (RESOURCE_SURFACES.has(decision.preferredSurface) && !decision.resourceContract) {
    issues.push(issue('resourceContract', 'resource-contract-required', 'resource surfaces require payload and freshness bounds'))
  }

  const operations = new Set(decision.readWriteExecute || [])
  const isMutating = [...MUTATING_OPERATIONS].some(operation => operations.has(operation))
  if (isMutating && !decision.authority) {
    issues.push(issue('authority', 'authority-required', 'write or execute surfaces require authority'))
  }
  if (isMutating && decision.authority?.confirmationLevel === 'none') {
    issues.push(issue('authority.confirmationLevel', 'confirmation-required', 'mutating operations cannot use confirmationLevel=none'))
  }
  if (isMutating && ['rule-skill', 'prompt', 'resource', 'resource-template'].includes(decision.preferredSurface)) {
    issues.push(issue('readWriteExecute', 'mutating-surface-invalid', `${decision.preferredSurface} cannot own write or execute operations`))
  }

  if (decision.preferredSurface === 'task-augmented-tool') {
    if (!decision.taskContract) {
      issues.push(issue('taskContract', 'task-contract-required', 'task-augmented-tool requires taskContract'))
    } else {
      const taskCapabilities = new Set(decision.taskContract.negotiatedCapabilities || [])
      const mcpCapabilities = new Set(decision.mcpContract?.negotiatedCapabilities || [])
      if (!taskCapabilities.has('tasks') || !mcpCapabilities.has('tasks')) {
        issues.push(issue('taskContract.negotiatedCapabilities', 'tasks-not-negotiated', 'Tasks must be negotiated by task and MCP contracts'))
      }
      if (decision.taskContract.fallbackSurface === decision.preferredSurface) {
        issues.push(issue('taskContract.fallbackSurface', 'task-fallback-recursive', 'task fallback cannot select task-augmented-tool'))
      }
    }
  }

  if (decision.fallback?.surface === decision.preferredSurface) {
    issues.push(issue('fallback.surface', 'fallback-not-distinct', 'fallback surface must differ from preferredSurface'))
  }
}

function validateIdentityAndTruth(decision, options, issues) {
  const expectedSchemaDigest = options.schemaDigest || schemaDigest()
  if (decision.identity?.schemaDigest !== expectedSchemaDigest) {
    issues.push(issue('identity.schemaDigest', 'schema-digest-mismatch', 'identity.schemaDigest is stale'))
  }
  const bindingRequired = ['validated', 'frozen'].includes(decision.status)
  for (const field of ['sourceHead', 'evidenceDigest']) {
    if (bindingRequired && !options[field]) {
      issues.push(issue(
        `identity.${field}`,
        'identity-binding-required',
        `${field} binding is required for ${decision.status} decisions`
      ))
    } else if (options[field] && decision.identity?.[field] !== options[field]) {
      issues.push(issue(`identity.${field}`, `${field}-mismatch`, `identity.${field} is stale`))
    }
  }
  if (decision.decisionRef && decision.canonicalRecordPath) {
    const normalized = decision.canonicalRecordPath.replace(/\\/g, '/')
    const expectedSuffix = `/capability-surface-decisions/${decision.decisionRef}.json`
    if (!normalized.endsWith(expectedSuffix)) {
      issues.push(issue('canonicalRecordPath', 'canonical-path-mismatch', `canonicalRecordPath must end with ${expectedSuffix}`))
    }
  }
  if (decision.writer && decision.writer !== 'workflow-single-writer') {
    issues.push(issue('writer', 'writer-boundary-invalid', 'only workflow-single-writer may persist the canonical record'))
  }
  if (decision.truthBoundary?.copiedCentralFields?.length) {
    issues.push(issue('truthBoundary.copiedCentralFields', 'duplicate-truth-source', 'domain consumers cannot copy central decision fields'))
  }
}

function validateEvidenceAndHosts(decision, issues) {
  const hosts = (decision.hostMatrix || []).map(item => item.host)
  if (new Set(hosts).size !== hosts.length) {
    issues.push(issue('hostMatrix', 'duplicate-host', 'hostMatrix host values must be unique'))
  }
  if ((decision.hostMatrix || []).some(item => item.status === 'BLOCK')) {
    issues.push(issue('hostMatrix', 'blocking-host-evidence', 'hostMatrix contains BLOCK evidence'))
  }
  if ((decision.decisionEvidence || []).some(item => item.status === 'BLOCK')) {
    issues.push(issue('decisionEvidence', 'blocking-decision-evidence', 'decisionEvidence contains BLOCK evidence'))
  }
}

function validateCapabilitySurfaceDecision(decision, options = {}) {
  const issues = []
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return [issue('$', 'decision-required', 'decision must be an object')]
  }
  validateSchemaNode(decision, SCHEMA, '$', issues)
  validateSurfaceSemantics(decision, issues)
  validateIdentityAndTruth(decision, options, issues)
  validateEvidenceAndHosts(decision, issues)
  return issues
}

function evaluateCapabilitySurfaceDecisionFreshness(decision, options = {}) {
  const reasons = []
  if (decision?.status === 'stale') reasons.push('status-stale')
  if (decision?.identity?.schemaDigest !== (options.schemaDigest || schemaDigest())) reasons.push('schema-digest-mismatch')
  const bindingRequired = ['validated', 'frozen'].includes(decision?.status)
  for (const field of ['sourceHead', 'evidenceDigest']) {
    if (bindingRequired && !options[field]) reasons.push(`${field}-binding-missing`)
    else if (options[field] && decision?.identity?.[field] !== options[field]) reasons.push(`${field}-mismatch`)
  }
  return {
    fresh: reasons.length === 0,
    status: reasons.length ? 'stale' : 'fresh',
    reasons
  }
}

function buildCapabilitySurfaceDecisionReceipt(decision, options = {}) {
  const issues = validateCapabilitySurfaceDecision(decision, options)
  const freshness = evaluateCapabilitySurfaceDecisionFreshness(decision, options)
  let classification = 'invalid'
  if (decision?.status === 'blocked') classification = 'blocked'
  else if (!freshness.fresh || decision?.status === 'stale') classification = 'stale'
  else if (issues.length) classification = 'invalid'
  else if (decision?.status === 'validated' || decision?.status === 'frozen') classification = 'review-ready'
  else if (decision?.status === 'draft') classification = 'draft'

  return {
    schemaVersion: 'CapabilitySurfaceDecisionReceiptV1',
    gateGroup: 'capability-surface-decision',
    decisionRef: decision?.decisionRef || null,
    decisionDigest: decision ? sha256(stableStringify(decision)) : null,
    schemaDigest: schemaDigest(),
    classification,
    freshness,
    issues,
    openBlockers: issues.length,
    passed: classification === 'review-ready'
  }
}

function validateCapabilitySurfaceDecisionBatch(decisions, options = {}) {
  const rows = Array.isArray(decisions) ? decisions : []
  const receipts = rows.map(decision => {
    const evidenceDigest = options.evidenceDigests?.[decision?.decisionRef] || options.evidenceDigest
    return buildCapabilitySurfaceDecisionReceipt(decision, {
      ...options,
      evidenceDigest
    })
  })
  const issues = []
  for (const field of ['decisionRef', 'capabilityId', 'canonicalRecordPath']) {
    const values = rows.map(item => item?.[field]).filter(Boolean)
    const duplicates = [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
    for (const value of duplicates) {
      issues.push(issue(field, `duplicate-${field}`, `${field} must be unique: ${value}`))
    }
  }
  if (!rows.length) issues.push(issue('$', 'decisions-required', 'decision batch must be non-empty'))
  return {
    schemaVersion: 'CapabilitySurfaceDecisionBatchReceiptV1',
    gateGroup: 'capability-surface-decision',
    receipts,
    issues,
    openBlockers: issues.length + receipts.reduce((sum, receipt) => sum + receipt.openBlockers, 0),
    passed: rows.length > 0 && issues.length === 0 && receipts.every(receipt => receipt.passed)
  }
}

module.exports = {
  KIND_SURFACES,
  MCP_SURFACES,
  SCHEMA,
  SCHEMA_PATH,
  buildCapabilitySurfaceDecisionReceipt,
  evaluateCapabilitySurfaceDecisionFreshness,
  schemaDigest,
  sha256,
  stableStringify,
  validateCapabilitySurfaceDecision,
  validateCapabilitySurfaceDecisionBatch
}
