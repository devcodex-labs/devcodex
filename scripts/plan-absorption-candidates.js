#!/usr/bin/env node
'use strict'

const fs = require('fs')
const assert = require('assert')
const {
  LAYER_KEYS,
  planAbsorptionCandidates,
  validateAbsorptionCandidateMatrix
} = require('./lib/absorption-candidate-planner')

function usage() {
  return [
    'Usage:',
    '  node scripts/plan-absorption-candidates.js --input <matrix.json>',
    '  node scripts/plan-absorption-candidates.js --self-test',
    '',
    'The command is read-only: it prints an AbsorptionCandidatePlanV1 JSON document to stdout.'
  ].join('\n')
}

function layerChecks(overrides = {}) {
  return Object.fromEntries(LAYER_KEYS.map(key => [
    key,
    overrides[key] || { state: key === 'promptTemplate' ? 'not-applicable' : 'required', skipReason: key === 'promptTemplate' ? 'no prompt change needed' : undefined }
  ]))
}

function sourceExistence(overrides = {}) {
  return {
    claimedCapability: 'SourceExistenceVerificationGate',
    searchAnchors: ['SourceExistenceVerificationGate', 'plan-absorption-candidates'],
    sourceRoot: 'devcodex-v1',
    existenceStatus: 'absent',
    hitEvidence: [],
    nearNeighborCoverage: 'none',
    ledgerDisposition: 'absorb-candidate',
    verifiedBy: 'self-test grep anchors in source-root',
    ...overrides
  }
}

function probeNecessity(overrides = {}) {
  return {
    probeClass: 'extend-existing',
    necessity: 'required',
    rationale: 'false-green high; machine-sampleable; reuse host-parity classifiers',
    probePlan: 'extend classifyTtfvOmissionSample with progress-query negative fixture',
    existingProbeReuse: 'classifyTtfvOmissionSample',
    alwaysOnImpact: 'test-only',
    complexityDelta: 'low: extend existing classifier',
    falsePositiveRisk: 'low if chat intent excluded',
    ...overrides
  }
}

function sampleMatrix(overrides = {}) {
  return {
    schemaVersion: 'AbsorptionCandidateMatrixV1',
    phaseKind: 'planning',
    sourceRoot: '.devcodex/devcodex-v1/data',
    generatedBy: 'self-test',
    candidates: [
      {
        candidateId: 'PI-STRUCTURED-ABSORB',
        sourceNamespace: '.devcodex/devcodex-v1/data/process-improvements.md',
        rawSummary: 'candidate needs structured absorption and prevention evidence',
        backlogClass: 'pure-open',
        commonDecision: 'absorb',
        targetOwner: 'spec-absorption',
        targetLayer: 'existing-skill-subgate',
        triggerTerms: ['规范吸纳', '仍需吸纳'],
        ownedArtifacts: ['skills/spec-absorption/SKILL.md'],
        layerChecks: layerChecks(),
        validationRoute: ['npm run test:residual-absorption-controls'],
        consumerSync: ['README.md', 'website/docs/guide/development.md'],
        sourceExistence: sourceExistence(),
        probeNecessity: probeNecessity(),
        enforcementLevel: 'hard-probe',
        prevention: {
          rootCause: 'free-form absorption decisions were hard to verify',
          controlFailure: 'review checklist did not require schema-backed layer decisions',
          negativeCases: ['candidate without targetOwner must be blocked'],
          rollbackOrSunset: 'remove planner if stronger runtime owner replaces it'
        }
      },
      {
        candidateId: 'PROJECT-LOCAL-SERVICE',
        sourceNamespace: '.devcodex/example-project/data/process-improvements.md',
        rawSummary: 'service-specific directory rule',
        backlogClass: 'pure-open',
        commonDecision: 'project-local',
        targetOwner: 'source-project-profile',
        layerChecks: layerChecks(),
        validationRoute: ['record.none'],
        consumerSync: [],
        skipReason: 'project-specific service convention'
      }
    ],
    ...overrides
  }
}

function runSelfTest() {
  const { classifySourceExistenceVerificationSample } = require('./lib/absorption-candidate-planner')
  const matrix = sampleMatrix()
  const before = JSON.stringify(matrix)
  const plan = planAbsorptionCandidates(matrix)
  assert.strictEqual(JSON.stringify(matrix), before, 'planner must not mutate input')
  assert.strictEqual(plan.validation.status, 'valid')
  assert.strictEqual(plan.summary.ready, 1)
  assert.strictEqual(plan.summary.skipped, 1)
  assert.strictEqual(plan.summary.openBlockers, 0)
  const blocked = planAbsorptionCandidates(sampleMatrix({
    candidates: [{ ...matrix.candidates[0], targetOwner: '', skipReason: '' }]
  }))
  assert.strictEqual(blocked.summary.blocked, 1)
  assert(blocked.decisions[0].blockers.includes('target-owner-missing'))
  const missingExistence = validateAbsorptionCandidateMatrix(sampleMatrix({
    candidates: [{ ...matrix.candidates[0], sourceExistence: undefined }]
  }))
  assert(missingExistence.some(item => item.code === 'source-existence-required'))
  const coveredAbsorb = validateAbsorptionCandidateMatrix(sampleMatrix({
    candidates: [{
      ...matrix.candidates[0],
      sourceExistence: sourceExistence({
        existenceStatus: 'present',
        hitEvidence: ['skills/spec-absorption/SKILL.md'],
        ledgerDisposition: 'close-ledger'
      })
    }]
  }))
  assert(coveredAbsorb.some(item => item.code === 'existence-already-covered'))
  assert.strictEqual(
    classifySourceExistenceVerificationSample('状态：open pending absorption 可吸纳 pure-open'),
    'ledger-status-only'
  )
  assert.strictEqual(
    classifySourceExistenceVerificationSample({
      existenceStatus: 'absent',
      searchAnchors: ['TaskPhaseProjectionGate'],
      sourceRoot: 'devcodex-v1'
    }),
    'absorb-ok'
  )
  const { classifyExecutableAbsorptionSample } = require('./lib/absorption-candidate-planner')
  assert.strictEqual(
    classifyExecutableAbsorptionSample('只改 Skill 正文 text-only 无消费者 absorbed'),
    'text-only-fake'
  )
  assert.strictEqual(
    classifyExecutableAbsorptionSample('enforcementLevel=hard-probe probeClass=machine-sample'),
    'ok-probe'
  )
  const weak = validateAbsorptionCandidateMatrix(sampleMatrix({
    candidates: [{ ...matrix.candidates[0], enforcementLevel: 'checklist-only' }]
  }))
  assert(weak.some(item => item.code === 'weak-enforcement'))
  const noProbe = validateAbsorptionCandidateMatrix(sampleMatrix({
    candidates: [{ ...matrix.candidates[0], probeNecessity: undefined }]
  }))
  assert(noProbe.some(item => item.code === 'probe-necessity-required'))
  const invalid = validateAbsorptionCandidateMatrix({ schemaVersion: 'AbsorptionCandidateMatrixV1', phaseKind: 'planning', candidates: [] })
  assert(invalid.some(item => item.code === 'candidates-required'))
  console.log('absorption candidate planner self-test passed')
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage())
    return
  }
  if (argv.includes('--self-test')) {
    runSelfTest()
    return
  }
  const inputIndex = argv.indexOf('--input')
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    console.error(usage())
    process.exitCode = 2
    return
  }
  const inputPath = argv[inputIndex + 1]
  const matrix = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const plan = planAbsorptionCandidates(matrix)
  console.log(JSON.stringify(plan, null, 2))
  if (plan.validation.status !== 'valid' || plan.summary.blocked > 0) process.exitCode = 1
}

if (require.main === module) main(process.argv.slice(2))

module.exports = { layerChecks, sampleMatrix, runSelfTest }
