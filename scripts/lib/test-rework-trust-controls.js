'use strict'

const {
  classifyArtifactDeliverySample,
  classifyCandidateDiffCompletenessSample,
  classifyConfigurationErgonomicsSample,
  classifyChecklistStateSample,
  classifyCoverageClaimSample,
  classifyInteractiveSemanticSample,
  classifyReleaseAuthoritySample,
  classifyReworkPromotionSample
} = require('./validate-rework-trust-controls')

function runReworkTrustControlSuite(ctx) {
  const { failures, mustInclude, mustIncludeInChangelogs } = ctx
  const expect = (actual, expected, label) => {
    if (actual !== expected) failures.push(`checkV94 ${label}: expected ${expected}, got ${actual}`)
  }

  expect(classifyCoverageClaimSample({ claim: '逐文件全读', mode: 'sampled', coverageLedger: false, unresolvedFiles: 2 }), 'invalid-claim', 'coverage negative')
  expect(classifyCoverageClaimSample({ claim: 'all-files', mode: 'full-read', coverageLedger: true, unresolvedFiles: 0 }), 'evidence-bounded', 'coverage positive')
  expect(classifyArtifactDeliverySample({ observed: false }), 'unverified', 'artifact unobserved')
  expect(classifyArtifactDeliverySample({ observed: true, hasSection: true, hasPrimaryArtifacts: false, hasAbsolutePaths: true }), 'verified-missing', 'artifact negative')
  expect(classifyArtifactDeliverySample({ observed: true, hasSection: true, hasPrimaryArtifacts: true, hasAbsolutePaths: true }), 'verified-present', 'artifact positive')
  expect(classifyReworkPromotionSample({ retrospectiveOnly: true }), 'retrospective-only', 'retrospective-only')
  expect(classifyReworkPromotionSample({ retrospectiveOnly: false, comparableWorkUnits: 2, independentContexts: 1, firstPassYieldImproved: true, metricGaming: false, rollbackReady: true }), 'hold-gray', 'insufficient evidence')
  expect(classifyReworkPromotionSample({ retrospectiveOnly: false, comparableWorkUnits: 3, independentContexts: 1, firstPassYieldImproved: true, metricGaming: false, rollbackReady: true }), 'eligible-for-active-review', 'prospective evidence')
  expect(classifyCandidateDiffCompletenessSample({ hasUntracked: true, stagedSnapshot: false, cachedDiffCheck: true, nameStatusReview: true, secretShapeScan: true, scopeMatch: true }), 'incomplete', 'candidate diff untracked')
  expect(classifyCandidateDiffCompletenessSample({ hasUntracked: true, stagedSnapshot: true, cachedDiffCheck: true, nameStatusReview: true, secretShapeScan: true, scopeMatch: true }), 'complete', 'candidate diff staged')
  expect(classifyReleaseAuthoritySample({ published: false, realConsumers: 0, authority: 'source' }), 'converge-before-compatibility', 'unreleased contract')
  expect(classifyReleaseAuthoritySample({ published: true, realConsumers: 1, authority: 'release' }), 'compatibility-review-required', 'released contract')
  expect(classifyConfigurationErgonomicsSample({ minimalTaskConfig: true, fieldNecessityMatrix: true, optionalOmissionWorks: false, complexityUsed: 2, complexityBudget: 3 }), 'invalid', 'optional omission')
  expect(classifyConfigurationErgonomicsSample({ minimalTaskConfig: true, fieldNecessityMatrix: true, optionalOmissionWorks: true, complexityUsed: 2, complexityBudget: 3 }), 'pass', 'minimal config')
  expect(classifyInteractiveSemanticSample({ role: true, accessibleName: true, focusable: true, enter: true, space: true, escape: false, focusRecovery: true }), 'invalid', 'escape negative')
  expect(classifyInteractiveSemanticSample({ role: true, accessibleName: true, focusable: true, enter: true, space: true, escape: true, focusRecovery: true }), 'pass', 'semantic positive')
  const checklistSnapshot = { currentRound: 'R1', zeroFindingStreak: 1, currentBatch: 'audit', remaining: ['R2'], blockers: [], openFindings: 0, closureState: 'running' }
  expect(classifyChecklistStateSample({ sections: Object.fromEntries(['header', 'items', 'round', 'ledger', 'progress', 'closure'].map(section => [section, { ...checklistSnapshot }])) }), 'materialized', 'checklist materialized')
  expect(classifyChecklistStateSample({ sections: { ...Object.fromEntries(['header', 'items', 'round', 'ledger', 'closure'].map(section => [section, { ...checklistSnapshot }])), progress: { ...checklistSnapshot, currentBatch: 'CP2' } } }), 'stale', 'checklist progress stale')

  for (const [file, needles] of [
    ['scripts/lib/validate-rework-trust-controls.js', ['checkV94', 'ReviewCoverageClaimIntegrityGate', 'ArtifactDeliveryCompletenessGate', 'classifyCandidateDiffCompletenessSample', 'classifyChecklistStateSample']],
    ['skills/review-checklist/SKILL.md', ['ChecklistStateMaterializationGate', 'ChecklistStateSnapshot', 'CandidateDiffCompletenessGate']],
    ['skills/release-verification/SKILL.md', ['CandidateDiffCompletenessGate', 'git diff --cached --check']],
    ['skills/rework-prevention-engineering/SKILL.md', ['ReworkEffectivenessLoop', 'FirstPassYield', 'CandidateDiffCompletenessGate']],
    ['skills/routing/SKILL.md', ['rework-prevention-engineering']],
    ['plugin.json', ['rework-prevention-engineering', '"lifecycleState": "gray"']]
  ]) for (const needle of needles) mustInclude(file, needle)
  mustIncludeInChangelogs('V94')
}

module.exports = { runReworkTrustControlSuite }
