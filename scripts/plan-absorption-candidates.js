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
