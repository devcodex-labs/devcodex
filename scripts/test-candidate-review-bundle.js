#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildCandidateReviewBundleReceipt,
  classifyCandidateReviewBundle,
  missingCandidateReviewFields
} = require('./lib/candidate-review-bundle')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'candidate-review-bundle')

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8')
}

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

assert.strictEqual(classifyCandidateReviewBundle('ordinary chat'), 'not-candidate-review')

assert.strictEqual(classifyCandidateReviewBundle(fixture('cp1-ready.md')), 'review-ready')
assert.strictEqual(classifyCandidateReviewBundle(fixture('cp2-ready.md')), 'review-ready')
assert.strictEqual(classifyCandidateReviewBundle(fixture('priority-p0-ready.md')), 'review-ready')
assert.strictEqual(classifyCandidateReviewBundle(fixture('missing-td-matrix.md')), 'review-incomplete')
assert.strictEqual(classifyCandidateReviewBundle(fixture('missing-domain-reality.md')), 'review-incomplete')
assert.strictEqual(classifyCandidateReviewBundle(fixture('missing-phase-kind.md'), { phase: 'CP1' }), 'review-incomplete')
assert.strictEqual(classifyCandidateReviewBundle(fixture('stale-receipt.md')), 'stale')
assert.strictEqual(classifyCandidateReviewBundle(fixture('open-blocker.md')), 'blocked')
assert.strictEqual(classifyCandidateReviewBundle(fixture('soft-confirm-bypass.md')), 'confirm-blocked')

const missingTd = buildCandidateReviewBundleReceipt(fixture('missing-td-matrix.md'))
assert.deepStrictEqual(missingTd.missingFields, ['TDMatrix'])
assert.deepStrictEqual(missingTd.missingWithoutSkipReason, ['TDMatrix'])
assert.strictEqual(missingTd.passed, false)

const objectReceipt = buildCandidateReviewBundleReceipt({
  phaseKind: 'CP2',
  CandidateReviewBundleV1: true,
  TDMatrix: [{ id: 'TD-1', status: 'passed' }],
  BlockerSnapshot: { openBlockers: 0 },
  ClaimEvidenceMatrix: [{ claim: 'all public contracts verified' }]
})
assert.strictEqual(objectReceipt.classification, 'review-ready')
assert.strictEqual(objectReceipt.passed, true)

const missing = missingCandidateReviewFields({
  phaseKind: 'CP1',
  CandidateReviewBundleV1: true,
  RQMatrix: [],
  ClaimEvidenceMatrix: [],
  EscapeAbsorptionQueue: []
})
assert.deepStrictEqual(missing.map(item => item.field), ['DomainRealityMatrix'])

const sourceAnchors = [
  ['prompts/requirement.prompt.md', ['CandidateReviewBundleV1', 'RQMatrix', 'DomainRealityMatrix', 'ClaimEvidenceMatrix', 'EscapeAbsorptionQueue']],
  ['prompts/technical-design.prompt.md', ['CandidateReviewBundleV1', 'TDMatrix', 'BlockerSnapshot', 'ClaimEvidenceMatrix']],
  ['skills/audit-requirements/SKILL.md', ['DistributionRequirementRealityGate', 'DomainRealityMatrix', 'EscapeAbsorptionQueue']],
  ['skills/audit-tech-design/SKILL.md', ['TechnicalDesignCandidateEvidenceGate', 'TDMatrix', 'TD-1~TD-13']],
  ['skills/cp-gate/SKILL.md', ['RequiredCandidateEvidenceGate', 'review-incomplete', 'confirm-blocked']],
  ['skills/dev-plan-review/SKILL.md', ['RequiredCandidateEvidenceGate', 'npm run test:candidate-review-bundle']],
  ['skills/review-checklist/SKILL.md', ['RequiredCandidateEvidenceGate', 'EscapeAbsorptionQueue']],
  ['skills/report/SKILL.md', ['RequiredCandidateEvidenceGate', 'EscapeAbsorptionQueue']]
]

for (const [relativePath, anchors] of sourceAnchors) {
  const content = source(relativePath)
  for (const anchor of anchors) {
    assert(content.includes(anchor), `${relativePath} missing ${anchor}`)
  }
}

const packageJson = JSON.parse(source('package.json'))
assert.strictEqual(packageJson.scripts['test:candidate-review-bundle'], 'node scripts/test-candidate-review-bundle.js')
assert(packageJson.scripts['test:control-plane'].includes('npm run test:candidate-review-bundle'))
assert(packageJson.files.includes('scripts/lib/candidate-review-bundle.js'))
assert(packageJson.files.includes('scripts/fixtures/candidate-review-bundle/'))

const manifest = JSON.parse(source('scripts/validation-manifest.json'))
assert(manifest.routes.fast.nodes.includes('candidate-review-bundle'))
assert(manifest.routes.full.nodes.includes('candidate-review-bundle'))
const manifestNode = manifest.nodes.find(node => node.id === 'candidate-review-bundle')
assert(manifestNode, 'validation manifest missing candidate-review-bundle node')
assert(manifestNode.inputs.includes('scripts/lib/candidate-review-bundle.js'))

console.log('candidate review bundle tests passed')
