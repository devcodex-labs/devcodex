#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildCandidateReviewBundleReceipt,
  classifyCandidateReviewBundle,
  missingCandidateReviewFields,
  validateCandidateReviewBundle
} = require('./lib/candidate-review-bundle')
const { createCanonicalAwareReader } = require('./lib/canonical-consumer-contracts')
const { planValidation } = require('./lib/validation-dag')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'candidate-review-bundle')
const readSource = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8')
}

function source(relativePath) {
  return readSource(path.join(ROOT, relativePath))
}

assert.strictEqual(classifyCandidateReviewBundle('ordinary chat'), 'not-candidate-review')

assert.strictEqual(classifyCandidateReviewBundle(fixture('cp1-ready.md')), 'review-ready')
assert.strictEqual(classifyCandidateReviewBundle(fixture('cp2-ready.md')), 'review-ready')
assert.strictEqual(classifyCandidateReviewBundle(fixture('cp2-with-cp1-binding.md')), 'review-ready')
assert.strictEqual(classifyCandidateReviewBundle(fixture('priority-p0-ready.md')), 'review-ready')
assert.strictEqual(classifyCandidateReviewBundle(fixture('missing-td-matrix.md')), 'review-incomplete')
assert.strictEqual(classifyCandidateReviewBundle(fixture('missing-domain-reality.md')), 'review-incomplete')
assert.strictEqual(classifyCandidateReviewBundle(fixture('missing-phase-kind.md'), { phase: 'CP1' }), 'review-incomplete')
assert.strictEqual(classifyCandidateReviewBundle(fixture('stale-receipt.md')), 'stale')
assert.strictEqual(classifyCandidateReviewBundle(fixture('open-blocker.md')), 'blocked')
assert.strictEqual(classifyCandidateReviewBundle(fixture('soft-confirm-bypass.md')), 'confirm-blocked')
assert.strictEqual(classifyCandidateReviewBundle(fixture('phase-conflict.md')), 'review-incomplete')

const cp2WithCp1 = buildCandidateReviewBundleReceipt(fixture('cp2-with-cp1-binding.md'))
assert.strictEqual(cp2WithCp1.phase, 'CP2')
assert.strictEqual(cp2WithCp1.classification, 'review-ready')
assert.deepStrictEqual(cp2WithCp1.phaseConflicts, [])

const phaseConflict = buildCandidateReviewBundleReceipt(fixture('phase-conflict.md'))
assert(phaseConflict.validationIssues.some(issue => issue.code === 'phase-conflict'))

const missingTd = buildCandidateReviewBundleReceipt(fixture('missing-td-matrix.md'))
assert.deepStrictEqual(missingTd.missingFields, ['TDMatrix'])
assert.deepStrictEqual(missingTd.missingWithoutSkipReason, ['TDMatrix'])
assert.strictEqual(missingTd.passed, false)

const objectTdRows = Array.from({ length: 13 }, (_, index) => ({
  dimension: `TD-${index + 1}`,
  priority: index === 6 ? 'P1' : 'P0',
  status: 'PASS',
  evidence: `evidence-${index + 1}`,
  blockerId: 'N/A',
  skipReason: 'N/A',
  negativeProbe: `negative-${index + 1}`
}))
const objectCandidate = {
  phaseKind: 'CP2',
  schemaVersion: 'CandidateReviewBundleV1',
  TDMatrix: objectTdRows,
  BlockerSnapshot: {
    stage: 'CP2',
    blockerId: 'N/A',
    evidence: 'full review',
    affectedSurface: 'design',
    remediation: 'N/A',
    skippedChecks: 'none',
    stopReason: 'none',
    openBlockers: 0
  },
  ClaimEvidenceMatrix: [{
    claim: 'all public contracts verified',
    repoPath: 'scripts/lib/example.js',
    currentBehavior: 'current',
    targetChange: 'target',
    runtimeOwner: 'owner',
    validation: 'node test.js',
    status: 'PASS'
  }]
}
const objectReceipt = buildCandidateReviewBundleReceipt(objectCandidate)
assert.strictEqual(objectReceipt.classification, 'review-ready')
assert.strictEqual(objectReceipt.passed, true)
assert.deepStrictEqual(objectReceipt.validationIssues, [])

const missing = missingCandidateReviewFields({
  phaseKind: 'CP1',
  CandidateReviewBundleV1: true,
  RQMatrix: [],
  ClaimEvidenceMatrix: [],
  EscapeAbsorptionQueue: []
})
assert.deepStrictEqual(missing.map(item => item.field), ['DomainRealityMatrix'])

const emptyObjectReceipt = buildCandidateReviewBundleReceipt({
  phaseKind: 'CP2',
  schemaVersion: 'CandidateReviewBundleV1',
  TDMatrix: [],
  BlockerSnapshot: {},
  ClaimEvidenceMatrix: []
})
assert.strictEqual(emptyObjectReceipt.classification, 'review-incomplete')
assert(emptyObjectReceipt.validationIssues.filter(issue => issue.code === 'matrix-empty').length >= 3)

const fakeZeroCandidate = JSON.parse(JSON.stringify(objectCandidate))
fakeZeroCandidate.BlockerSnapshot.openBlockers = 'zero'
const fakeZeroReceipt = buildCandidateReviewBundleReceipt(fakeZeroCandidate)
assert.strictEqual(fakeZeroReceipt.classification, 'review-incomplete')
assert(fakeZeroReceipt.validationIssues.some(issue => issue.code === 'open-blockers-invalid'))

const negativeBlockerCandidate = JSON.parse(JSON.stringify(objectCandidate))
negativeBlockerCandidate.BlockerSnapshot.openBlockers = -1
const negativeBlockerReceipt = buildCandidateReviewBundleReceipt(negativeBlockerCandidate)
assert.strictEqual(negativeBlockerReceipt.classification, 'review-incomplete')
assert(negativeBlockerReceipt.validationIssues.some(issue => issue.code === 'open-blockers-invalid'))

const readyCp2 = fixture('cp2-ready.md')
const fakeZeroMarkdown = readyCp2.replace(
  '| CP2 | N/A | full review | design | N/A | none | none | 0 |',
  '| CP2 | N/A | full review | design | N/A | none | none | zero |'
)
const fakeZeroMarkdownReceipt = buildCandidateReviewBundleReceipt(fakeZeroMarkdown)
assert.strictEqual(fakeZeroMarkdownReceipt.classification, 'review-incomplete')
assert(fakeZeroMarkdownReceipt.validationIssues.some(issue => issue.code === 'open-blockers-invalid'))

const staleObjectCandidate = JSON.parse(JSON.stringify(objectCandidate))
staleObjectCandidate.receiptFreshness = 'stale'
assert.strictEqual(classifyCandidateReviewBundle(staleObjectCandidate), 'stale')

const missingColumnCandidate = JSON.parse(JSON.stringify(objectCandidate))
for (const row of missingColumnCandidate.TDMatrix) delete row.negativeProbe
const missingColumnReceipt = buildCandidateReviewBundleReceipt(missingColumnCandidate)
assert.strictEqual(missingColumnReceipt.classification, 'review-incomplete')
assert(missingColumnReceipt.validationIssues.some(issue => issue.code === 'matrix-columns-invalid' && issue.field === 'TDMatrix'))

const missingRowReceipt = buildCandidateReviewBundleReceipt(
  readyCp2.replace(/^\| TD-13 \|.*\r?\n/m, '')
)
assert.strictEqual(missingRowReceipt.classification, 'review-incomplete')
assert(missingRowReceipt.validationIssues.some(issue => issue.code === 'matrix-row-missing' && issue.row === 'TD-13'))

const missingBlockerCandidate = JSON.parse(JSON.stringify(objectCandidate))
delete missingBlockerCandidate.BlockerSnapshot.stopReason
const missingBlockerKeyReceipt = buildCandidateReviewBundleReceipt(missingBlockerCandidate)
assert.strictEqual(missingBlockerKeyReceipt.classification, 'review-incomplete')
assert(missingBlockerKeyReceipt.validationIssues.some(issue => issue.code === 'matrix-columns-invalid' && issue.field === 'BlockerSnapshot'))

const missingClaimCandidate = JSON.parse(JSON.stringify(objectCandidate))
delete missingClaimCandidate.ClaimEvidenceMatrix[0].runtimeOwner
const missingClaimColumnReceipt = buildCandidateReviewBundleReceipt(missingClaimCandidate)
assert.strictEqual(missingClaimColumnReceipt.classification, 'review-incomplete')
assert(missingClaimColumnReceipt.validationIssues.some(issue => issue.code === 'matrix-columns-invalid' && issue.field === 'ClaimEvidenceMatrix'))

const directValidation = validateCandidateReviewBundle(objectCandidate, { phase: 'CP2' })
assert.strictEqual(directValidation.phase, 'CP2')

const sourceAnchors = [
  ['prompts/requirement.prompt.md', ['CandidateReviewBundleV1', 'RQMatrix', 'DomainRealityMatrix', 'ClaimEvidenceMatrix', 'EscapeAbsorptionQueue']],
  ['prompts/technical-design.prompt.md', ['CandidateReviewBundleV1', 'TDMatrix', 'BlockerSnapshot', 'ClaimEvidenceMatrix']],
  ['skills/audit-requirements/SKILL.md', ['DistributionRequirementRealityGate', 'DomainRealityMatrix', 'EscapeAbsorptionQueue']],
  ['skills/audit-tech-design/SKILL.md', ['TechnicalDesignCandidateEvidenceGate', 'TDMatrix', 'priority / status / evidence / blockerId / skipReason / negativeProbe']],
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
assert.strictEqual(manifest.routes.fast.dynamic, true)
assert(manifest.routes.full.nodes.includes('candidate-review-bundle'))
const manifestNode = manifest.nodes.find(node => node.id === 'candidate-review-bundle')
assert(manifestNode, 'validation manifest missing candidate-review-bundle node')
assert(manifestNode.inputs.includes('scripts/lib/candidate-review-bundle.js'))
const fastPlan = planValidation({
  manifest,
  route: 'fast',
  changedFiles: ['scripts/lib/candidate-review-bundle.js'],
  changedSource: 'candidate-review-fixture',
  candidateStable: true,
  candidateId: 'candidate-review-fast-fixture'
})
assert(fastPlan.selectedNodes.some(node => node.id === 'candidate-review-bundle'))
assert.notStrictEqual(fastPlan.verificationLevel, 'V3')

console.log('candidate review bundle tests passed')
