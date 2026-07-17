#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  buildPortfolio,
  buildBundleDecision,
  buildTriggerContract,
  canonicalizeTextForDigest,
  collectDependencies,
  detectCycles,
  listConsumerDocuments,
  serializePortfolio,
  validatePortfolio
} = require('./lib/skill-portfolio-utils')

const ROOT = path.resolve(__dirname, '..')
const first = buildPortfolio(ROOT)
const second = buildPortfolio(ROOT)

assert.strictEqual(serializePortfolio(first), serializePortfolio(second), 'portfolio generation must be byte-identical')
// V92 parity: consumers must come from git-tracked paths only when git is available.
const consumers = listConsumerDocuments(ROOT)
assert.ok(consumers.length > 50, 'expected a non-trivial tracked consumer set')
assert.ok(!consumers.some(item => item.path.startsWith('skills/')), 'skills/ must not be scanned as consumers')
assert.ok(!consumers.some(item => item.path.includes('.devcodex/')), '.devcodex must not be scanned as consumers')

// Untracked pollution must not change portfolio serialization (CI clean parity).
const fs = require('fs')
const pollution = path.join(ROOT, `_portfolio_pollution_${process.pid}.md`)
const beforePollution = serializePortfolio(first)
fs.writeFileSync(pollution, [
  '# pollution',
  'accessibility-i18n intent memory load-profile brand-visual-quality execution-contract',
  'This untracked file must not become a Skill consumer.'
].join('\n'), 'utf8')
try {
  const polluted = buildPortfolio(ROOT)
  assert.strictEqual(
    serializePortfolio(polluted),
    beforePollution,
    'untracked files must not change Skill portfolio (V92 clean-checkout parity)'
  )
} finally {
  fs.unlinkSync(pollution)
}
assert.strictEqual(canonicalizeTextForDigest('a\r\nb\rc\n'), 'a\nb\nc\n', 'portfolio digests must canonicalize CRLF/CR/LF')
assert.strictEqual(first.summary.skillCount, 78)
assert.strictEqual(first.schemaVersion, 2)
assert.strictEqual(first.summary.registeredSkillCount, 78)
assert.strictEqual(first.summary.activeSkillCount, 75)
assert.strictEqual(first.summary.graySkillCount, 3)
assert.strictEqual(first.skills.find(skill => skill.id === 'rework-prevention-engineering').lifecycleState, 'gray')
assert.strictEqual(first.skills.find(skill => skill.id === 'consumer-validation-engineering').lifecycleState, 'gray')
assert.strictEqual(first.skills.find(skill => skill.id === 'brand-visual-quality').lifecycleState, 'gray')
assert.ok(first.skills.find(skill => skill.id === 'incremental-project-analysis'))
assert.strictEqual(first.skills.find(skill => skill.id === 'incremental-project-analysis').lifecycleState, 'active')
assert.strictEqual(first.summary.orphanActiveCount, 0)
assert.strictEqual(first.summary.dependencyCycleCount, 0)
assert.strictEqual(first.summary.triggerQuality, 'structural-only')
assert.strictEqual(first.summary.dependencyEdgeCount, 3)
assert.strictEqual(first.summary.conflictReviewedCount, 78)
assert.strictEqual(first.summary.operationalEvidenceCompleteCount, 78)
assert.strictEqual(first.summary.triggerPrecisionMeasuredCount, 0)
assert.deepStrictEqual(first.dependencyGraph.edges, [
  { from: 'dev-testing', to: 'api-verification' },
  { from: 'dev-testing', to: 'dev-scenario-test' },
  { from: 'spec-governance', to: 'spec-absorption' }
])
for (const skill of first.skills.filter(item => item.lifecycleState === 'active')) {
  assert.strictEqual(skill.evidence.operationalReadiness.state, 'complete')
  for (const field of ['currentConsumer', 'positiveFixture', 'negativeFixture', 'rollbackToGray', 'lastEvidenceAt']) {
    assert.ok(skill.evidence.operationalReadiness[field], `${skill.id} missing ${field}`)
  }
  assert.strictEqual(skill.evidence.triggerPrecision.state, 'structural-only')
  assert.ok(skill.validationProfile.length > 0)
  assert.ok(['reviewed-none', 'declared'].includes(skill.conflictReview.status))
  assert.strictEqual(skill.skillIndex.id, skill.id)
  assert.strictEqual(skill.skillIndex.type, 'skill')
  assert.deepStrictEqual(skill.skillIndex.requires, skill.dependencies)
  assert.deepStrictEqual(skill.skillIndex.conflictsWith, skill.conflicts)
  assert.strictEqual(skill.skillIndex.evidenceState, 'source-backed')
  assert.strictEqual(skill.skillIndex.maxTokens, null)
  assert.deepStrictEqual(skill.skillIndex.domains, [], `${skill.id} must not infer a semantic domain from its id`)
}
assert.deepStrictEqual(validatePortfolio(first), [])
assert.deepStrictEqual(detectCycles(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]), [['a', 'b', 'a']])
assert.deepStrictEqual(
  collectDependencies('必须继续读取 `api-verification`。\n普通引用 `memory` Skill。', new Set(['api-verification', 'memory'])),
  ['api-verification']
)
assert.deepStrictEqual(buildTriggerContract('example', '当任务涉及 API contract 时使用').negative[0].input, '')

const invalid = JSON.parse(JSON.stringify(first))
invalid.skills[0].lifecycleState = 'auto-promoted'
assert.ok(validatePortfolio(invalid).some(error => error.includes('illegal lifecycle state')))
const missingFixture = JSON.parse(JSON.stringify(first))
delete missingFixture.skills.find(skill => skill.lifecycleState === 'active').evidence.operationalReadiness.positiveFixture
assert.ok(validatePortfolio(missingFixture).some(error => error.includes('missing positiveFixture')))
const missingConflictReview = JSON.parse(JSON.stringify(first))
delete missingConflictReview.skills[0].conflictReview
assert.ok(validatePortfolio(missingConflictReview).some(error => error.includes('missing conflict review')))
const falseMeasured = JSON.parse(JSON.stringify(first))
falseMeasured.skills[0].evidence.triggerPrecision.state = 'measured'
assert.ok(validatePortfolio(falseMeasured).some(error => error.includes('measured trigger precision lacks samples')))

const portfolioBeforeDecision = serializePortfolio(first)
const decision = buildBundleDecision(first, {
  candidateIds: ['skill-lifecycle-governance', 'missing-skill', 'intent'],
  maxSkills: 1
})
assert.deepStrictEqual(decision.selected.map(item => item.id), ['intent'])
assert.deepStrictEqual(decision.ignored.map(item => [item.id, item.reason]), [
  ['missing-skill', 'unknown'],
  ['skill-lifecycle-governance', 'budget']
])
assert.strictEqual(decision.budget.status, 'exhausted')
assert.strictEqual(serializePortfolio(first), portfolioBeforeDecision, 'bundle decisions must not mutate portfolio state')

const conflictDecision = buildBundleDecision(first, {
  candidateIds: ['brand-visual-quality', 'design-system-architecture'],
  includeGray: true
})
assert.deepStrictEqual(conflictDecision.selected.map(item => item.id), ['brand-visual-quality'])
assert.deepStrictEqual(conflictDecision.ignored.map(item => [item.id, item.reason]), [['design-system-architecture', 'conflict']])
assert.deepStrictEqual(conflictDecision.conflicts, [{ left: 'brand-visual-quality', right: 'design-system-architecture' }])

const invalidIndex = JSON.parse(JSON.stringify(first))
invalidIndex.skills[0].skillIndex.evidenceState = 'claimed-without-evidence'
assert.ok(validatePortfolio(invalidIndex).some(error => error.includes('invalid SkillIndexV2 evidenceState')))

console.log('✓ Skill portfolio determinism, coverage and negative fixtures passed')
