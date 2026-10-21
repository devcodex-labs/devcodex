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
assert.strictEqual(cp2WithCp1.classifierVersion, 'CandidateReviewClassifierV2')
assert.match(cp2WithCp1.classifierRuleDigest, /^[a-f0-9]{64}$/)

const cp3Candidate = [
  '---',
  'phaseKind: CP3',
  'documentKind: implementation-plan-candidate',
  'productImplementationAuthorized: false',
  '---',
  '# CP3 implementation plan candidate',
  '## 任务分解',
  '- task',
  '## 分批执行策略',
  '- batch',
  '## 独立验证方式',
  '- targeted',
  '## 风险、回滚与回退条件',
  '- rollback',
  '## 里程碑与完成定义',
  '- done',
  '## 执行与授权边界',
  '- release frozen'
].join('\n')
const cp3Receipt = buildCandidateReviewBundleReceipt(cp3Candidate)
assert.strictEqual(cp3Receipt.phase, 'CP3')
assert.strictEqual(cp3Receipt.classification, 'review-ready')
assert.deepStrictEqual(cp3Receipt.missingFields, [])

// The real canonical plan template must produce the fields its CP3 consumer
// requires. This checks structural compatibility, not substantive acceptance.
const cp3Template = source('prompts/implementation-plan.prompt.md')
const materializedCp3Template = cp3Template.replace(/```markdown\r?\n/g, '').replace(/```/g, '')
  .replace('productImplementationAuthorized: [true/false]', 'productImplementationAuthorized: false')
const cp3TemplateReceipt = buildCandidateReviewBundleReceipt(materializedCp3Template, { phase: 'CP3' })
assert.deepStrictEqual(cp3TemplateReceipt.missingFields, [], 'canonical CP3 template/consumer field mismatch')
assert(cp3Template.includes('不为阶段同步改写已确认正文'))

// A producer must expose the same candidate interface its real consumer reads.
// Structural compatibility is separate from substantive evidence acceptance.
for (const [phase, templatePath] of [
  ['CP1', 'prompts/requirement.prompt.md'],
  ['CP2', 'prompts/technical-design.prompt.md']
]) {
  const materialized = source(templatePath).replace(/```markdown\r?\n/g, '').replace(/```/g, '')
  const receipt = buildCandidateReviewBundleReceipt(materialized, { phase })
  assert.deepStrictEqual(receipt.missingFields, [], `${phase} canonical producer/consumer interface mismatch`)
  assert(!receipt.validationIssues.some(issue => ['matrix-columns-invalid', 'matrix-row-missing'].includes(issue.code)),
    `${phase} canonical matrix shape mismatch`)
}


const ecrCandidate = [
  '# Candidate ECR execution closure review',
  '> closureState: passed',
  '## ReviewGradeCard',
  '| field | value |',
  '|---|---|',
  '| reviewClass | R3 |',
  '## ReviewExecutionPlanV1',
  '- bounded',
  '## evidenceLedger',
  '- passed',
  'openBlockers: 0',
  'dirty boundary: exact',
  'release/publish 未执行，版本发布冻结',
  '## 复审结论',
  '- findings=[]; blockers=[]; missingEvidence=[]'
].join('\n')
const ecrReceipt = buildCandidateReviewBundleReceipt(ecrCandidate)
assert.strictEqual(ecrReceipt.phase, 'ECR')
assert.strictEqual(ecrReceipt.classification, 'review-ready')
assert.strictEqual(ecrReceipt.openBlockers, 0)
const blockedEcr = buildCandidateReviewBundleReceipt(ecrCandidate.replace('openBlockers: 0', 'openBlockers: 3'))
assert.strictEqual(blockedEcr.classification, 'blocked')
assert.strictEqual(blockedEcr.openBlockers, 3)

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

// Explicit condition records supplement the original candidate interface. These
// are real parser/validator probes; they do not certify the referenced evidence.
const conditionMatrix = {
  schemaVersion: 'ConditionEvidenceMatrixV1', applicability: 'applicable', expectedConditionIds: ['C1'],
  rows: [{ conditionId: 'C1', sourceRef: 'requirement#C1', applicable: true, consumer: 'candidate-review-bundle',
    designEvidenceRefs: ['design#C1'], designStatus: 'covered', executionStatus: 'not-run',
    executionEvidenceRefs: [], verificationResponsibilities: ['D', 'A'], executionContext: null,
    limitation: 'implementation validation has not run' }]
}
const clone = value => JSON.parse(JSON.stringify(value))
const conditionObject = matrix => ({ ...clone(objectCandidate), conditionEvidence: matrix })
const conditionMarkdown = matrix => `${readyCp2}\n## ConditionEvidenceMatrixV1\n\`\`\`json\n${JSON.stringify(matrix)}\n\`\`\`\n`
for (const encode of [conditionObject, conditionMarkdown]) {
  assert.strictEqual(buildCandidateReviewBundleReceipt(encode(conditionMatrix)).classification, 'review-ready')
  const executed = clone(conditionMatrix)
  Object.assign(executed.rows[0], { designStatus: 'partial', executionStatus: 'passed',
    executionEvidenceRefs: ['actual-run#1'], executionContext: { candidate: 'sha1', environment: 'node/windows', version: 'candidate', runId: 'run1' }, limitation: 'local candidate only' })
  assert.strictEqual(buildCandidateReviewBundleReceipt(encode(executed)).classification, 'review-ready', 'execution passed must not force design covered')
  const inapplicable = clone(conditionMatrix)
  Object.assign(inapplicable.rows[0], { applicable: false, designStatus: 'not-applicable', executionStatus: 'not-applicable', skipReason: 'no applicable consumer' })
  assert(buildCandidateReviewBundleReceipt(encode(inapplicable)).passed)
  assert(buildCandidateReviewBundleReceipt(encode({ schemaVersion: 'ConditionEvidenceMatrixV1', applicability: 'not-applicable', skipReason: 'no compound conditions', expectedConditionIds: [], rows: [] })).passed)
  const shared = clone(conditionMatrix)
  shared.expectedConditionIds.push('C2')
  shared.rows.push({ ...clone(shared.rows[0]), conditionId: 'C2' })
  assert(buildCandidateReviewBundleReceipt(encode(shared)).passed, 'sharing evidence must preserve both rows')
  const negativeCases = [
    ['null declaration', () => null],
    ['unknown schema', x => { x.schemaVersion = 'ConditionEvidenceMatrixV2' }],
    ['unknown applicability', x => { x.applicability = 'yes' }],
    ['string IDs', x => { x.expectedConditionIds = 'C1' }],
    ['blank ID', x => { x.expectedConditionIds = [' '] }],
    ['duplicate ID', x => { x.expectedConditionIds.push('C1') }],
    ['empty denominator', x => { x.expectedConditionIds = []; x.rows = [] }],
    ['missing row', x => { x.rows = [] }],
    ['duplicate row', x => { x.rows.push(clone(x.rows[0])) }],
    ['orphan row', x => { x.rows[0].conditionId = 'C2' }],
    ['non-object row', x => { x.rows = [null] }],
    ['boolean string', x => { x.rows[0].applicable = 'false' }],
    ['boolean number', x => { x.rows[0].applicable = 0 }],
    ['source missing', x => { delete x.rows[0].sourceRef }],
    ['covered without consumer', x => { x.rows[0].consumer = '' }],
    ['covered without design refs', x => { x.rows[0].designEvidenceRefs = [] }],
    ['bad refs', x => { x.rows[0].executionEvidenceRefs = [42] }],
    ['bad design state', x => { x.rows[0].designStatus = 'complete' }],
    ['bad execution state', x => { x.rows[0].executionStatus = 'complete' }],
    ['false applicability states', x => { x.rows[0].applicable = false; x.rows[0].skipReason = 'unused' }],
    ['N/A no reason', x => { x.applicability = 'not-applicable'; x.expectedConditionIds = []; x.rows = [] }],
    ['N/A with rows', x => { x.applicability = 'not-applicable'; x.skipReason = 'none' }],
    ['applicable cannot use N/A', x => { x.rows[0].executionStatus = 'not-applicable' }],
    ['bad responsibility', x => { x.rows[0].verificationResponsibilities = ['E4'] }],
    ['missing responsibility list', x => { delete x.rows[0].verificationResponsibilities }],
    ['no limitation', x => { x.rows[0].limitation = '' }],
    ['fake passed', x => { x.rows[0].executionStatus = 'passed' }],
    ['passed refs without run', x => { x.rows[0].executionStatus = 'passed'; x.rows[0].executionEvidenceRefs = ['run'] }],
    ['passed missing evidence', x => { Object.assign(x.rows[0], executed.rows[0]); x.rows[0].executionEvidenceRefs = [] }],
    ['run missing version', x => { Object.assign(x.rows[0], clone(executed.rows[0])); delete x.rows[0].executionContext.version }]
  ]
  for (const [label, mutate] of negativeCases) {
    let matrix = clone(conditionMatrix)
    if (label === 'null declaration') matrix = mutate()
    else mutate(matrix)
    const receipt = buildCandidateReviewBundleReceipt(encode(matrix))
    assert(!receipt.passed, `${label} must reject (${typeof encode(matrix)})`)
    assert(receipt.validationIssues.some(x => x.code.startsWith('condition-evidence-')), label)
  }
}
assert(buildCandidateReviewBundleReceipt({ ...clone(objectCandidate), example: { conditionEvidence: null } }).passed, 'nested tutorial property is not a declaration')
const inherited = Object.assign(Object.create({ conditionEvidence: null }), clone(objectCandidate))
assert(buildCandidateReviewBundleReceipt(inherited).passed, 'inherited property is not a declaration')
const tutorial = `${readyCp2}\n## Tutorial\n\`\`\`markdown\n## ConditionEvidenceMatrixV1\n\`\`\`\n\`\`\`json\n{"schemaVersion":"bad"}\n\`\`\`\n`
assert(buildCandidateReviewBundleReceipt(tutorial).passed)
const explicit = conditionMarkdown(conditionMatrix)
for (const invalid of [
  `${explicit}\n${explicit.slice(readyCp2.length)}`,
  `${explicit}\n\`\`\`json\n{}\n\`\`\``,
  `${readyCp2}\n## ConditionEvidenceMatrixV1\n\`\`\`json\n{bad}\n\`\`\``,
  `${readyCp2}\n## ConditionEvidenceMatrixV1\n\`\`\`json\n{}`,
  `${readyCp2}\n## ConditionEvidenceMatrixV1\n(no json)`
]) assert(!buildCandidateReviewBundleReceipt(invalid).passed, 'explicit malformed/duplicate declaration must not fall back')
assert(buildCandidateReviewBundleReceipt(`${explicit}\n## Teaching\n\`\`\`json\n{}\n\`\`\``).passed, 'stop at next real H2')
assert(buildCandidateReviewBundleReceipt(explicit.replace(/```/g, '~~~~')).passed, 'tilde fence supported')
assert.strictEqual(buildCandidateReviewBundleReceipt({ conditionEvidence: null }).classification, 'not-candidate-review', 'ordinary reports do not become candidates')

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
