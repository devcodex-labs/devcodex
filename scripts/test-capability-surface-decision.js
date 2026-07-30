#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  SCHEMA,
  buildCapabilitySurfaceDecisionReceipt,
  evaluateCapabilitySurfaceDecisionFreshness,
  schemaDigest,
  validateCapabilitySurfaceDecisionBatch
} = require('./lib/capability-surface-decision')
const { resolveControlAsset } = require('./lib/control-content-delivery')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'capability-surface-decision')
const SOURCE_HEAD = '269ac9fadbd3593d42f4481a2436d5b16b45a08a'

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(resolveControlAsset(ROOT, relativePath), 'utf8'))
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const ruleSkill = fixture('valid-rule-skill.json')
const controlledTool = fixture('valid-controlled-tool.json')
const invalidCases = fixture('invalid-cases.json')
const binding = {
  sourceHead: SOURCE_HEAD,
  evidenceDigests: {
    [ruleSkill.decisionRef]: ruleSkill.identity.evidenceDigest,
    [controlledTool.decisionRef]: controlledTool.identity.evidenceDigest
  }
}

assert.strictEqual(SCHEMA.title, 'CapabilitySurfaceDecisionV1')
assert.strictEqual(SCHEMA.properties.decisionOwner.const, 'spec-governance')
assert(SCHEMA.required.includes('identity'))
assert(SCHEMA.required.includes('truthBoundary'))
assert.strictEqual(ruleSkill.identity.schemaDigest, schemaDigest())
assert.strictEqual(controlledTool.identity.schemaDigest, schemaDigest())

const ruleReceipt = buildCapabilitySurfaceDecisionReceipt(ruleSkill, {
  ...binding,
  evidenceDigest: ruleSkill.identity.evidenceDigest
})
assert.strictEqual(ruleReceipt.classification, 'review-ready')
assert.strictEqual(ruleReceipt.passed, true)
assert.deepStrictEqual(ruleReceipt.issues, [])

const toolReceipt = buildCapabilitySurfaceDecisionReceipt(controlledTool, {
  ...binding,
  evidenceDigest: controlledTool.identity.evidenceDigest
})
assert.strictEqual(toolReceipt.classification, 'review-ready')
assert.strictEqual(toolReceipt.passed, true)
assert.deepStrictEqual(toolReceipt.issues, [])

const unboundReceipt = buildCapabilitySurfaceDecisionReceipt(ruleSkill)
assert.strictEqual(unboundReceipt.passed, false)
assert(
  unboundReceipt.issues.filter(item => item.code === 'identity-binding-required').length >= 2
)

const evidenceMismatchReceipt = buildCapabilitySurfaceDecisionReceipt(ruleSkill, {
  sourceHead: SOURCE_HEAD,
  evidenceDigest: '0'.repeat(64)
})
assert.strictEqual(evidenceMismatchReceipt.passed, false)
assert(
  evidenceMismatchReceipt.issues.some(item => item.code === 'evidenceDigest-mismatch')
)

const missingAuthority = clone(controlledTool)
delete missingAuthority.authority
const missingAuthorityReceipt = buildCapabilitySurfaceDecisionReceipt(missingAuthority, {
  sourceHead: SOURCE_HEAD,
  evidenceDigest: missingAuthority.identity.evidenceDigest
})
assert.strictEqual(missingAuthorityReceipt.passed, false)
assert(
  missingAuthorityReceipt.issues.some(item =>
    item.code === 'required-field-missing' && item.path === '$.authority'
  ),
  'schema allOf/if/then must enforce authority for write or execute decisions'
)

function mutate(baseName, mutation) {
  const decision = clone(baseName === 'controlled-tool' ? controlledTool : ruleSkill)
  switch (mutation) {
    case 'remove-authority':
      delete decision.authority
      break
    case 'task-without-negotiation':
      decision.capabilityKind = 'long-running-operation'
      decision.preferredSurface = 'task-augmented-tool'
      decision.readWriteExecute = ['execute']
      decision.mcpContract.negotiatedCapabilities = ['tools']
      decision.taskContract = {
        negotiatedCapabilities: ['tools'],
        cancellation: 'application cancellation',
        ttl: 'PT5M',
        polling: 'bounded status polling',
        fallbackSurface: 'tool'
      }
      break
    case 'copy-central-field':
      decision.truthBoundary.copiedCentralFields = ['preferredSurface']
      break
    case 'stale-schema-digest':
      decision.identity.schemaDigest = '0'.repeat(64)
      break
    case 'remove-invalidation-trigger':
      decision.invalidationTriggers = decision.invalidationTriggers.slice(0, 6)
      break
    case 'semantic-as-tool':
      decision.capabilityKind = 'semantic-judgement'
      decision.semanticJudgement = 'open-ended'
      break
    case 'unbounded-resource':
      decision.capabilityKind = 'content-delivery'
      decision.preferredSurface = 'resource'
      decision.contentDelivery = 'unbounded'
      decision.readWriteExecute = ['read']
      delete decision.authority
      decision.resourceContract = {
        payloadBound: '64 KiB',
        freshness: 'source digest',
        uriTemplate: 'devcodex://fixture/{id}'
      }
      break
    default:
      throw new Error(`unknown mutation: ${mutation}`)
  }
  return decision
}

for (const invalidCase of invalidCases) {
  const decision = mutate(invalidCase.base, invalidCase.mutation)
  const receipt = buildCapabilitySurfaceDecisionReceipt(decision, {
    ...binding,
    evidenceDigest: decision.identity.evidenceDigest
  })
  assert.strictEqual(receipt.passed, false, `${invalidCase.name} must fail`)
  assert(
    receipt.issues.some(item => item.code === invalidCase.expectedCode),
    `${invalidCase.name} missing ${invalidCase.expectedCode}: ${JSON.stringify(receipt.issues)}`
  )
}

const staleBySource = evaluateCapabilitySurfaceDecisionFreshness(ruleSkill, {
  sourceHead: '1111111111111111111111111111111111111111',
  evidenceDigest: ruleSkill.identity.evidenceDigest
})
assert.strictEqual(staleBySource.fresh, false)
assert(staleBySource.reasons.includes('sourceHead-mismatch'))

const validBatch = validateCapabilitySurfaceDecisionBatch([ruleSkill, controlledTool], binding)
assert.strictEqual(validBatch.passed, true)
assert.strictEqual(validBatch.openBlockers, 0)

const duplicate = clone(controlledTool)
duplicate.capabilityId = ruleSkill.capabilityId
duplicate.decisionRef = ruleSkill.decisionRef
duplicate.canonicalRecordPath = ruleSkill.canonicalRecordPath
const duplicateBatch = validateCapabilitySurfaceDecisionBatch([ruleSkill, duplicate], binding)
assert.strictEqual(duplicateBatch.passed, false)
assert(duplicateBatch.issues.some(item => item.code === 'duplicate-decisionRef'))
assert(duplicateBatch.issues.some(item => item.code === 'duplicate-capabilityId'))
assert(duplicateBatch.issues.some(item => item.code === 'duplicate-canonicalRecordPath'))

const incompleteBinding = {
  sourceHead: SOURCE_HEAD,
  evidenceDigests: {
    [ruleSkill.decisionRef]: ruleSkill.identity.evidenceDigest
  }
}
const incompleteBindingBatch = validateCapabilitySurfaceDecisionBatch(
  [ruleSkill, controlledTool],
  incompleteBinding
)
assert.strictEqual(incompleteBindingBatch.passed, false)
assert(
  incompleteBindingBatch.receipts
    .find(item => item.decisionRef === controlledTool.decisionRef)
    .issues
    .some(item => item.code === 'identity-binding-required')
)

const registry = readJson('skills/spec-governance/gate-registry.json')
const group = registry.groups.find(item => item.id === 'capability-surface-decision')
assert(group, 'gate registry missing capability-surface-decision')
assert.deepStrictEqual(group.ownerSkills, [
  'spec-governance',
  'platform-ecosystem-architecture',
  'ai-agent-system-architecture',
  'skill-lifecycle-governance'
])
assert(group.validationRoute.includes('test-capability-surface-decision'))

const skill = fs.readFileSync(path.join(ROOT, 'content', 'skills', 'spec-governance', 'SKILL.md'), 'utf8')
for (const anchor of [
  'CapabilitySurfaceDecisionGate',
  'capability-surface-decision.v1.schema.json',
  'workflow-single-writer',
  'task-augmented-tool',
  'schemaDigest/sourceHead/checkedAt/evidenceDigest'
]) {
  assert(skill.includes(anchor), `spec-governance missing ${anchor}`)
}

console.log('capability surface decision tests passed')
