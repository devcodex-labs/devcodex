#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  buildPortfolio,
  buildTriggerContract,
  canonicalizeTextForDigest,
  collectDependencies,
  detectCycles,
  serializePortfolio,
  validatePortfolio
} = require('./lib/skill-portfolio-utils')

const ROOT = path.resolve(__dirname, '..')
const first = buildPortfolio(ROOT)
const second = buildPortfolio(ROOT)

assert.strictEqual(serializePortfolio(first), serializePortfolio(second), 'portfolio generation must be byte-identical')
assert.strictEqual(canonicalizeTextForDigest('a\r\nb\rc\n'), 'a\nb\nc\n', 'portfolio digests must canonicalize CRLF/CR/LF')
assert.strictEqual(first.summary.skillCount, 76)
assert.strictEqual(first.summary.registeredSkillCount, 76)
assert.strictEqual(first.summary.activeSkillCount, 74)
assert.strictEqual(first.summary.graySkillCount, 2)
assert.strictEqual(first.skills.find(skill => skill.id === 'rework-prevention-engineering').lifecycleState, 'gray')
assert.strictEqual(first.skills.find(skill => skill.id === 'consumer-validation-engineering').lifecycleState, 'gray')
assert.strictEqual(first.summary.orphanActiveCount, 0)
assert.strictEqual(first.summary.dependencyCycleCount, 0)
assert.strictEqual(first.summary.triggerQuality, 'structural-only')
assert.strictEqual(first.summary.dependencyEdgeCount, 3)
assert.strictEqual(first.summary.conflictReviewedCount, 76)
assert.strictEqual(first.summary.operationalEvidenceCompleteCount, 76)
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

console.log('✓ Skill portfolio determinism, coverage and negative fixtures passed')
