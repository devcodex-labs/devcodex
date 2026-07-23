#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { execFileSync } = require('child_process')
const os = require('os')
const path = require('path')
const {
  buildPortfolio,
  buildBundleDecision,
  buildBundleDecisionV2,
  buildTriggerContract,
  canonicalizeTextForDigest,
  collectDependencies,
  detectCycles,
  gitIndexSnapshot,
  listConsumerDocuments,
  readRepositoryText,
  serializePortfolio,
  validateStagedCandidateSnapshot,
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

// PostStageDerivedArtifactFreshnessGate: an input tracked after generation must stale the index candidate.
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

const stagedFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-portfolio-staged-'))
try {
  git(stagedFixtureRoot, ['init', '--quiet'])
  git(stagedFixtureRoot, ['config', 'user.email', 'test@example.com'])
  git(stagedFixtureRoot, ['config', 'user.name', 'DevCodex Test'])
  git(stagedFixtureRoot, ['config', 'core.autocrlf', 'false'])
  writeJson(path.join(stagedFixtureRoot, 'package.json'), { name: 'portfolio-fixture', version: '1.0.0' })
  writeJson(path.join(stagedFixtureRoot, 'plugin.json'), {
    skills: [{ id: 'intent', file: 'skills/intent/SKILL.md', lifecycleState: 'active' }]
  })
  writeJson(path.join(stagedFixtureRoot, 'skills', 'portfolio-evidence.json'), {
    schemaVersion: 2,
    ownerSkill: 'skill-lifecycle-governance',
    evidenceDate: '2026-07-19',
    defaults: {
      positiveFixture: 'scripts/test-intent.js#positive',
      negativeFixture: 'scripts/test-intent.js#negative',
      rollbackToGray: 'rollback fixture',
      conflictReviewEvidence: 'scripts/test-intent.js#conflict-review',
      validationProfile: ['scripts/test-intent.js'],
      stateRationale: 'fixture source and consumer are present',
      promotionCriteria: 'fixture only',
      skillIndex: {
        type: 'skill', workflow: [], phase: [], priority: 100, visibility: 'agent', maxTokens: null,
        exitCondition: 'work-unit-complete'
      }
    },
    skills: {}
  })
  fs.mkdirSync(path.join(stagedFixtureRoot, 'skills', 'intent'), { recursive: true })
  fs.writeFileSync(path.join(stagedFixtureRoot, 'skills', 'intent', 'SKILL.md'), [
    '---',
    'name: intent',
    'description: Use for intent routing.',
    '---',
    '# Intent fixture'
  ].join('\n') + '\n', 'utf8')
  fs.mkdirSync(path.join(stagedFixtureRoot, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(stagedFixtureRoot, 'scripts', 'test-intent.js'), '// intent fixture\n', 'utf8')
  git(stagedFixtureRoot, ['add', '.'])
  const baselinePortfolio = serializePortfolio(buildPortfolio(stagedFixtureRoot, { repositoryView: 'index' }))
  fs.writeFileSync(path.join(stagedFixtureRoot, 'skills', 'portfolio.json'), baselinePortfolio, 'utf8')
  git(stagedFixtureRoot, ['add', 'skills/portfolio.json'])
  git(stagedFixtureRoot, ['commit', '--quiet', '-m', 'baseline'])
  assert.deepStrictEqual(
    validateStagedCandidateSnapshot(gitIndexSnapshot(stagedFixtureRoot)),
    ['no staged candidate paths; stage the intended change set before checking derived artifacts'],
    'staged freshness check must not pass before a candidate is materialized'
  )

  fs.mkdirSync(path.join(stagedFixtureRoot, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(stagedFixtureRoot, 'docs', 'new-consumer.md'), '# New intent consumer\n', 'utf8')
  assert.strictEqual(
    serializePortfolio(buildPortfolio(stagedFixtureRoot)),
    baselinePortfolio,
    'untracked consumer must not affect the worktree portfolio view'
  )
  git(stagedFixtureRoot, ['add', 'docs/new-consumer.md'])
  const stagedCandidate = buildPortfolio(stagedFixtureRoot, { repositoryView: 'index' })
  assert.notStrictEqual(
    serializePortfolio(stagedCandidate),
    readRepositoryText(stagedFixtureRoot, 'skills/portfolio.json', 'index'),
    'consumer staged after generation must stale the staged portfolio candidate'
  )
  assert.strictEqual(stagedCandidate.generatedFrom.consumerInventoryFileCount, 4)
  for (const field of ['consumerInventoryDigest', 'consumerProjectionDigest', 'portfolioInputDigest']) {
    assert.match(stagedCandidate.generatedFrom[field], /^[a-f0-9]{64}$/, `${field} must be a SHA-256 identity`)
  }
  const stagedSnapshot = gitIndexSnapshot(stagedFixtureRoot)
  assert.strictEqual(stagedSnapshot.available, true)
  assert.strictEqual(stagedSnapshot.stagedPathCount, 1)
  assert.match(stagedSnapshot.indexTreeIdentity, /^[a-f0-9]{64}$/)
  assert.deepStrictEqual(validateStagedCandidateSnapshot(stagedSnapshot), [])

  fs.writeFileSync(path.join(stagedFixtureRoot, 'skills', 'portfolio.json'), serializePortfolio(stagedCandidate), 'utf8')
  git(stagedFixtureRoot, ['add', 'skills/portfolio.json'])
  assert.strictEqual(
    readRepositoryText(stagedFixtureRoot, 'skills/portfolio.json', 'index'),
    serializePortfolio(buildPortfolio(stagedFixtureRoot, { repositoryView: 'index' })),
    'regenerated and staged portfolio must match the exact index candidate'
  )

  git(stagedFixtureRoot, ['commit', '--quiet', '-m', 'add consumer'])
  git(stagedFixtureRoot, ['mv', 'docs/new-consumer.md', 'docs/renamed-consumer.md'])
  const renamedCandidate = buildPortfolio(stagedFixtureRoot, { repositoryView: 'index' })
  assert.notStrictEqual(
    serializePortfolio(renamedCandidate),
    readRepositoryText(stagedFixtureRoot, 'skills/portfolio.json', 'index'),
    'staged consumer rename must stale the old consumer projection'
  )
  fs.writeFileSync(path.join(stagedFixtureRoot, 'skills', 'portfolio.json'), serializePortfolio(renamedCandidate), 'utf8')
  git(stagedFixtureRoot, ['add', 'skills/portfolio.json'])
  assert.strictEqual(
    readRepositoryText(stagedFixtureRoot, 'skills/portfolio.json', 'index'),
    serializePortfolio(buildPortfolio(stagedFixtureRoot, { repositoryView: 'index' })),
    'regenerated portfolio must bind the renamed staged path'
  )

  git(stagedFixtureRoot, ['commit', '--quiet', '-m', 'rename consumer'])
  git(stagedFixtureRoot, ['rm', '--quiet', 'docs/renamed-consumer.md'])
  const deletedCandidate = buildPortfolio(stagedFixtureRoot, { repositoryView: 'index' })
  assert.notStrictEqual(
    serializePortfolio(deletedCandidate),
    readRepositoryText(stagedFixtureRoot, 'skills/portfolio.json', 'index'),
    'staged consumer deletion must stale the old inventory and projection'
  )
  fs.writeFileSync(path.join(stagedFixtureRoot, 'skills', 'portfolio.json'), serializePortfolio(deletedCandidate), 'utf8')
  git(stagedFixtureRoot, ['add', 'skills/portfolio.json'])
  assert.strictEqual(
    readRepositoryText(stagedFixtureRoot, 'skills/portfolio.json', 'index'),
    serializePortfolio(buildPortfolio(stagedFixtureRoot, { repositoryView: 'index' })),
    'regenerated portfolio must bind the staged deletion'
  )

  git(stagedFixtureRoot, ['commit', '--quiet', '-m', 'delete consumer'])
  fs.mkdirSync(path.join(stagedFixtureRoot, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(stagedFixtureRoot, 'docs', 'amended-consumer.md'), '# Amended intent consumer\n', 'utf8')
  git(stagedFixtureRoot, ['add', 'docs/amended-consumer.md'])
  const amendedCandidate = buildPortfolio(stagedFixtureRoot, { repositoryView: 'index' })
  assert.notStrictEqual(
    serializePortfolio(amendedCandidate),
    readRepositoryText(stagedFixtureRoot, 'skills/portfolio.json', 'index'),
    'a newly staged consumer in an amended candidate must stale the prior commit artifact'
  )
  fs.writeFileSync(path.join(stagedFixtureRoot, 'skills', 'portfolio.json'), serializePortfolio(amendedCandidate), 'utf8')
  git(stagedFixtureRoot, ['add', 'skills/portfolio.json'])
  assert.deepStrictEqual(validateStagedCandidateSnapshot(gitIndexSnapshot(stagedFixtureRoot)), [])
  git(stagedFixtureRoot, ['commit', '--quiet', '--amend', '--no-edit'])
  assert.strictEqual(git(stagedFixtureRoot, ['status', '--porcelain']), '', 'amended target tree must be clean')
  assert.strictEqual(
    fs.readFileSync(path.join(stagedFixtureRoot, 'skills', 'portfolio.json'), 'utf8'),
    serializePortfolio(buildPortfolio(stagedFixtureRoot)),
    'post-amend clean worktree replay must remain current'
  )

  const targetSha = git(stagedFixtureRoot, ['rev-parse', 'HEAD'])
  const targetParent = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-portfolio-target-'))
  const targetRoot = path.join(targetParent, 'checkout')
  try {
    git(targetParent, ['clone', '--quiet', stagedFixtureRoot, targetRoot])
    git(targetRoot, ['checkout', '--quiet', targetSha])
    assert.strictEqual(git(targetRoot, ['status', '--porcelain']), '', 'target-SHA checkout must be clean')
    assert.strictEqual(
      readRepositoryText(targetRoot, 'skills/portfolio.json', 'index'),
      serializePortfolio(buildPortfolio(targetRoot, { repositoryView: 'index' })),
      'detached target-SHA index replay must reproduce the committed portfolio blobs'
    )
  } finally {
    fs.rmSync(targetParent, { recursive: true, force: true })
  }
} finally {
  fs.rmSync(stagedFixtureRoot, { recursive: true, force: true })
}

const nonGitFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-portfolio-nongit-'))
try {
  fs.mkdirSync(path.join(nonGitFixtureRoot, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(nonGitFixtureRoot, 'docs', 'consumer.md'), '# intent consumer\n', 'utf8')
  assert.deepStrictEqual(
    listConsumerDocuments(nonGitFixtureRoot).map(item => item.path),
    ['docs/consumer.md'],
    'non-Git worktree fallback must remain bounded to text consumers'
  )
  assert.throws(
    () => listConsumerDocuments(nonGitFixtureRoot, { repositoryView: 'index' }),
    /Git index is unavailable/,
    'staged checks must not fall back to filesystem consumers outside Git'
  )
  assert.strictEqual(gitIndexSnapshot(nonGitFixtureRoot).available, false)
  assert.deepStrictEqual(
    validateStagedCandidateSnapshot(gitIndexSnapshot(nonGitFixtureRoot)),
    ['Git index is unavailable', 'no staged candidate paths; stage the intended change set before checking derived artifacts', 'invalid Git index identity']
  )
  assert.throws(
    () => readRepositoryText(nonGitFixtureRoot, 'docs/consumer.md', 'invalid-view'),
    /unsupported portfolio repository view/
  )
} finally {
  fs.rmSync(nonGitFixtureRoot, { recursive: true, force: true })
}
assert.strictEqual(canonicalizeTextForDigest('a\r\nb\rc\n'), 'a\nb\nc\n', 'portfolio digests must canonicalize CRLF/CR/LF')
assert.strictEqual(first.summary.skillCount, 82)
assert.strictEqual(first.schemaVersion, 2)
assert.strictEqual(first.summary.registeredSkillCount, 82)
assert.strictEqual(first.summary.activeSkillCount, 79)
assert.strictEqual(first.summary.graySkillCount, 3)
assert.strictEqual(first.skills.find(skill => skill.id === 'rework-prevention-engineering').lifecycleState, 'gray')
assert.strictEqual(first.skills.find(skill => skill.id === 'repair-prevention-assessment').lifecycleState, 'active')
assert.strictEqual(first.skills.find(skill => skill.id === 'consumer-validation-engineering').lifecycleState, 'gray')
assert.strictEqual(first.skills.find(skill => skill.id === 'brand-visual-quality').lifecycleState, 'gray')
assert.ok(first.skills.find(skill => skill.id === 'incremental-project-analysis'))
assert.strictEqual(first.skills.find(skill => skill.id === 'incremental-project-analysis').lifecycleState, 'active')
assert.strictEqual(first.skills.find(skill => skill.id === 'user-visible-output-contract').lifecycleState, 'active')
assert.strictEqual(first.skills.find(skill => skill.id === 'host-instruction-projection').lifecycleState, 'active')
assert.strictEqual(first.summary.orphanActiveCount, 0)
assert.strictEqual(first.summary.dependencyCycleCount, 0)
assert.strictEqual(first.summary.triggerQuality, 'structural-only')
assert.strictEqual(first.summary.dependencyEdgeCount, 3)
assert.strictEqual(first.summary.conflictReviewedCount, 82)
assert.strictEqual(first.summary.operationalEvidenceCompleteCount, 82)
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
  assert.strictEqual(skill.sourceBytes, Buffer.byteLength(canonicalizeTextForDigest(fs.readFileSync(path.join(ROOT, skill.source), 'utf8')), 'utf8'))
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
const missingSourceBytes = JSON.parse(JSON.stringify(first))
delete missingSourceBytes.skills[0].sourceBytes
assert.ok(validatePortfolio(missingSourceBytes).some(error => error.includes('missing sourceBytes')))
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

const v2Decision = buildBundleDecisionV2(first, {
  candidateIds: ['dev-testing'],
  maxSkills: 10,
  maxBytes: 1024 * 1024
})
assert.strictEqual(v2Decision.schemaVersion, 'BundleDecisionV2')
assert.strictEqual(v2Decision.completion, 'complete')
assert.deepStrictEqual(new Set(v2Decision.selected.map(item => item.id)),
  new Set(['api-verification', 'dev-scenario-test', 'dev-testing']))
assert(v2Decision.selected.findIndex(item => item.id === 'api-verification') < v2Decision.selected.findIndex(item => item.id === 'dev-testing'))
assert(v2Decision.selected.findIndex(item => item.id === 'dev-scenario-test') < v2Decision.selected.findIndex(item => item.id === 'dev-testing'))
assert.strictEqual(v2Decision.budget.selected.bytes,
  v2Decision.selected.reduce((sum, item) => sum + item.sourceBytes, 0))
assert.strictEqual(v2Decision.budget.tokens.status, 'N/A')
assert.deepStrictEqual(v2Decision.writes, [])

const overBudgetMandatory = buildBundleDecisionV2(first, {
  candidateIds: ['dev-testing'],
  maxSkills: 1,
  maxBytes: 1024 * 1024
})
assert.strictEqual(overBudgetMandatory.completion, 'over-budget-mandatory')
assert.strictEqual(overBudgetMandatory.selected.length, 3)
assert(overBudgetMandatory.stages.length >= 3)
assert.strictEqual(overBudgetMandatory.exitCondition, 'read-stages-in-order')

const inactiveGray = buildBundleDecisionV2(first, { candidateIds: ['brand-visual-quality'] })
assert.strictEqual(inactiveGray.completion, 'blocked')
assert(inactiveGray.blockers.some(item => item.code === 'inactive'))
const explicitGray = buildBundleDecisionV2(first, {
  candidateIds: ['brand-visual-quality'],
  includeGray: true
})
assert.strictEqual(explicitGray.completion, 'complete')

const mandatoryConflict = buildBundleDecisionV2(first, {
  candidateIds: ['brand-visual-quality', 'design-system-architecture'],
  includeGray: true
})
assert.strictEqual(mandatoryConflict.completion, 'blocked')
assert(mandatoryConflict.blockers.some(item => item.code === 'mandatory-conflict'))
const optionalConflict = buildBundleDecisionV2(first, {
  candidateIds: ['brand-visual-quality', 'design-system-architecture'],
  mandatoryIds: ['design-system-architecture'],
  includeGray: true
})
assert.strictEqual(optionalConflict.completion, 'complete')
assert.deepStrictEqual(optionalConflict.selected.map(item => item.id), ['design-system-architecture'])
assert(optionalConflict.ignored.some(item => item.id === 'brand-visual-quality' && item.reason === 'conflict'))

const orphanDependencyPortfolio = JSON.parse(JSON.stringify(first))
const optionalRoot = orphanDependencyPortfolio.skills.find(item => item.id === 'brand-visual-quality')
optionalRoot.dependencies = ['intent']
optionalRoot.skillIndex.requires = ['intent']
const orphanDependency = buildBundleDecisionV2(orphanDependencyPortfolio, {
  candidateIds: ['brand-visual-quality', 'design-system-architecture'],
  mandatoryIds: ['design-system-architecture'],
  includeGray: true
})
assert.deepStrictEqual(orphanDependency.selected.map(item => item.id), ['design-system-architecture'])
assert(orphanDependency.ignored.some(item => item.id === 'intent' && item.reason === 'orphaned-dependency'))

const missingSourceMetadataPortfolio = JSON.parse(JSON.stringify(first))
delete missingSourceMetadataPortfolio.skills.find(item => item.id === 'intent').hash
const missingSourceMetadata = buildBundleDecisionV2(missingSourceMetadataPortfolio, { candidateIds: ['intent'] })
assert.strictEqual(missingSourceMetadata.completion, 'blocked')
assert(missingSourceMetadata.blockers.some(item => item.code === 'source-metadata-missing'))

const unknownMandatory = buildBundleDecisionV2(first, { candidateIds: ['missing-skill'] })
assert.strictEqual(unknownMandatory.completion, 'blocked')
assert(unknownMandatory.blockers.some(item => item.code === 'unknown'))
const hostFallback = buildBundleDecisionV2(first, {
  candidateIds: ['intent'],
  hostCapability: 'unsupported',
  maxTokens: 1
})
assert.strictEqual(hostFallback.completion, 'fallback-full')
assert.strictEqual(hostFallback.fallback.route, 'full-skill-read')
assert.strictEqual(hostFallback.budget.tokens.status, 'N/A')
assert.strictEqual(hostFallback.selected[0].sourceBytes, first.skills.find(item => item.id === 'intent').sourceBytes)

const optionalTokenCountMissing = buildBundleDecisionV2(first, {
  candidateIds: ['intent', 'load-profile'],
  mandatoryIds: ['intent'],
  hostTokenCounter: true,
  maxTokens: 1000,
  tokenCounts: { intent: 100 }
})
assert.strictEqual(optionalTokenCountMissing.completion, 'complete')
assert.deepStrictEqual(optionalTokenCountMissing.selected.map(item => item.id), ['intent'])
assert(optionalTokenCountMissing.ignored.some(item => item.id === 'load-profile' && item.reason === 'token-count-missing'))
assert.strictEqual(optionalTokenCountMissing.blockers.length, 0)

const mandatoryTokenCountMissing = buildBundleDecisionV2(first, {
  candidateIds: ['intent'],
  hostTokenCounter: true,
  maxTokens: 1000
})
assert.strictEqual(mandatoryTokenCountMissing.completion, 'blocked')
assert(mandatoryTokenCountMissing.blockers.some(item => item.id === 'intent' && item.code === 'token-count-missing'))
assert.strictEqual(serializePortfolio(first), portfolioBeforeDecision, 'BundleDecisionV2 must remain read-only')

const invalidIndex = JSON.parse(JSON.stringify(first))
invalidIndex.skills[0].skillIndex.evidenceState = 'claimed-without-evidence'
assert.ok(validatePortfolio(invalidIndex).some(error => error.includes('invalid SkillIndexV2 evidenceState')))

console.log('✓ Skill portfolio determinism, coverage and negative fixtures passed')
