#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildRequirementParallelOrchestration,
  classifyRequirementIndependence,
  normalizePathFragment,
  pathsOverlap,
  validateParallelLaunchCard
} = require('./lib/requirement-parallel-orchestration')
const { createCanonicalAwareReader } = require('./lib/canonical-consumer-contracts')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'requirement-parallel-orchestration')
const readSource = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'))
}

function source(relativePath) {
  return readSource(path.join(ROOT, relativePath))
}

assert.strictEqual(normalizePathFragment('E:\\Worker\\devcodex\\skills\\a\\'), 'e:/worker/devcodex/skills/a')
assert.strictEqual(pathsOverlap('skills/a', 'skills/a/SKILL.md'), true)
assert.strictEqual(pathsOverlap('skills/a', 'skills/alpha/SKILL.md'), false)

const independent = fixture('independent-disjoint-requirements.json')
const independentReceipt = buildRequirementParallelOrchestration(independent.input)
assert.strictEqual(independentReceipt.classification, independent.expected.classification)
assert.strictEqual(independentReceipt.launchCards.length, independent.expected.launchCards)
assert(independentReceipt.launchCardValidations.every(validation => validation.valid))

const weak = fixture('weak-coupled-shared-portfolio.json')
const weakDecision = classifyRequirementIndependence(weak.input)
assert.strictEqual(weakDecision.classification, weak.expected.classification)
assert(weakDecision.locks.some(lock => lock.surface === weak.expected.lockSurface && lock.policy === 'weak-lock'))

const serial = fixture('serial-shared-source-mutation.json')
const serialDecision = classifyRequirementIndependence(serial.input)
assert.strictEqual(serialDecision.classification, serial.expected.classification)
assert(serialDecision.reasonCodes.includes(serial.expected.reasonCode))

const missingCard = fixture('launch-card-missing-fields.json')
const missingCardValidation = validateParallelLaunchCard(missingCard.card)
assert.strictEqual(missingCardValidation.classification, missingCard.expected.classification)
for (const field of missingCard.expected.missingFields) {
  assert(missingCardValidation.missingFields.includes(field), `missing expected field ${field}`)
}

const missingMerge = fixture('missing-merge-protocol.json')
const missingMergeValidation = validateParallelLaunchCard(missingMerge.card)
assert.strictEqual(missingMergeValidation.classification, missingMerge.expected.classification)

const policy = fixture('allow-parallel-mutations-policy-violation.json')
const policyDecision = classifyRequirementIndependence(policy.input)
assert.strictEqual(policyDecision.classification, policy.expected.classification)
assert.strictEqual(policyDecision.status, 'serial-required')

const sourceAnchors = [
  ['skills/requirement-parallel-orchestration/SKILL.md', [
    'RequirementIndependenceGate',
    'ParallelLaunchCardV1',
    'IntegrationMergeProtocolV1',
    'allowParallelMutations',
    'npm run test:requirement-parallel-orchestration'
  ]],
  ['skills/dev-default/SKILL.md', ['requirement-parallel-orchestration']],
  ['skills/fix-default/SKILL.md', ['requirement-parallel-orchestration']],
  ['skills/execution-contract/SKILL.md', ['ParallelLaunchCardV1']],
  ['skills/test-router/SKILL.md', ['requirementParallelOrchestration']],
  ['skills/memory/SKILL.md', ['ParallelLaunchCardV1']],
  ['skills/report/SKILL.md', ['RequirementIndependenceDecisionV1']]
]

for (const [relativePath, anchors] of sourceAnchors) {
  const content = source(relativePath)
  for (const anchor of anchors) {
    assert(content.includes(anchor), `${relativePath} missing ${anchor}`)
  }
}

const packageJson = JSON.parse(source('package.json'))
assert.strictEqual(
  packageJson.scripts['test:requirement-parallel-orchestration'],
  'node scripts/test-requirement-parallel-orchestration.js'
)
assert(packageJson.scripts['test:control-plane'].includes('npm run test:requirement-parallel-orchestration'))
assert(packageJson.files.includes('scripts/lib/requirement-parallel-orchestration.js'))
assert(packageJson.files.includes('scripts/test-requirement-parallel-orchestration.js'))
assert(packageJson.files.includes('scripts/fixtures/requirement-parallel-orchestration/'))

const plugin = JSON.parse(source('plugin.json'))
assert(plugin.skills.some(skill => skill.id === 'requirement-parallel-orchestration'))

const manifest = JSON.parse(source('scripts/validation-manifest.json'))
assert(manifest.criticalInputs.includes('scripts/lib/requirement-parallel-orchestration.js'))
assert(manifest.routes.fast.nodes.includes('requirement-parallel-orchestration'))
assert(manifest.routes.full.nodes.includes('requirement-parallel-orchestration'))
const manifestNode = manifest.nodes.find(node => node.id === 'requirement-parallel-orchestration')
assert(manifestNode, 'validation manifest missing requirement-parallel-orchestration node')
assert(manifestNode.inputs.includes('scripts/fixtures/requirement-parallel-orchestration/**'))

console.log('requirement parallel orchestration tests passed')
