'use strict'

function classifyCoverageClaimSample(sample) {
  const fullClaim = ['full', '逐文件全读', 'all-files'].includes(sample.claim)
  if (fullClaim && (sample.mode !== 'full-read' || !sample.coverageLedger || sample.unresolvedFiles > 0)) return 'invalid-claim'
  return 'evidence-bounded'
}

function classifyArtifactDeliverySample(sample) {
  if (!sample.observed) return 'unverified'
  return sample.hasSection && sample.hasPrimaryArtifacts && sample.hasAbsolutePaths
    ? 'verified-present'
    : 'verified-missing'
}

function classifyReworkPromotionSample(sample) {
  if (sample.retrospectiveOnly) return 'retrospective-only'
  const enoughEvidence = sample.comparableWorkUnits >= 3 || sample.independentContexts >= 2
  if (enoughEvidence && sample.firstPassYieldImproved && !sample.metricGaming && sample.rollbackReady) return 'eligible-for-active-review'
  return 'hold-gray'
}

function classifyCandidateDiffCompletenessSample(sample) {
  if (!sample) return 'incomplete'
  if (sample.hasUntracked && !sample.stagedSnapshot) return 'incomplete'
  return sample.stagedSnapshot && sample.cachedDiffCheck && sample.nameStatusReview && sample.secretShapeScan && sample.scopeMatch
    ? 'complete'
    : 'incomplete'
}

function classifyReleaseAuthoritySample(sample) {
  if (!sample.published && sample.realConsumers === 0 && sample.authority === 'source') return 'converge-before-compatibility'
  return 'compatibility-review-required'
}

function classifyConfigurationErgonomicsSample(sample) {
  if (!sample.minimalTaskConfig || !sample.fieldNecessityMatrix || !sample.optionalOmissionWorks) return 'invalid'
  return sample.complexityUsed <= sample.complexityBudget ? 'pass' : 'invalid'
}

function classifyInteractiveSemanticSample(sample) {
  return ['role', 'accessibleName', 'focusable', 'enter', 'space', 'escape', 'focusRecovery']
    .every(field => sample[field] === true) ? 'pass' : 'invalid'
}

function classifyChecklistStateSample(sample) {
  const required = ['header', 'items', 'round', 'ledger', 'progress', 'closure']
  if (!sample || !sample.sections || required.some(section => !sample.sections[section])) return 'stale'
  const fields = ['currentRound', 'zeroFindingStreak', 'currentBatch', 'remaining', 'blockers', 'openFindings', 'closureState']
  const baseline = sample.sections.header
  return required.every(section => fields.every(field => JSON.stringify(sample.sections[section][field]) === JSON.stringify(baseline[field])))
    ? 'materialized'
    : 'stale'
}

function buildReworkTrustControlChecks(ctx) {
  const { ROOT, fs, path, read, err, console } = ctx

  function checkFile(file, needles) {
    const absolute = path.join(ROOT, file)
    if (!fs.existsSync(absolute)) {
      err(`[V94] missing required artifact: ${file}`)
      return
    }
    const content = read(absolute)
    for (const needle of needles) if (!content.includes(needle)) err(`[V94] ${file} missing "${needle}"`)
  }

  function checkCurrentChangeRecord(version, needles) {
    const files = ['changelogs/unreleased.md', `changelogs/releases/v${version}.md`]
    const combined = files.filter(file => fs.existsSync(path.join(ROOT, file)))
      .map(file => read(path.join(ROOT, file))).join('\n')
    for (const needle of needles) if (!combined.includes(needle)) err(`[V94] current changelog corpus missing "${needle}"`)
  }

  function expect(actual, expected, label) {
    if (actual !== expected) err(`[V94] ${label}: expected ${expected}, got ${actual}`)
  }

  function checkV94() {
    expect(classifyCoverageClaimSample({ claim: 'full', mode: 'sampled', coverageLedger: false, unresolvedFiles: 4 }), 'invalid-claim', 'coverage negative')
    expect(classifyCoverageClaimSample({ claim: 'full', mode: 'full-read', coverageLedger: true, unresolvedFiles: 0 }), 'evidence-bounded', 'coverage positive')
    expect(classifyArtifactDeliverySample({ observed: false }), 'unverified', 'artifact unobserved')
    expect(classifyArtifactDeliverySample({ observed: true, hasSection: true, hasPrimaryArtifacts: false, hasAbsolutePaths: true }), 'verified-missing', 'artifact missing')
    expect(classifyArtifactDeliverySample({ observed: true, hasSection: true, hasPrimaryArtifacts: true, hasAbsolutePaths: true }), 'verified-present', 'artifact complete')
    expect(classifyReworkPromotionSample({ retrospectiveOnly: true }), 'retrospective-only', 'rework retrospective negative')
    expect(classifyReworkPromotionSample({ retrospectiveOnly: false, comparableWorkUnits: 3, independentContexts: 1, firstPassYieldImproved: true, metricGaming: false, rollbackReady: true }), 'eligible-for-active-review', 'rework promotion positive')
    expect(classifyCandidateDiffCompletenessSample({ hasUntracked: true, stagedSnapshot: false, cachedDiffCheck: true, nameStatusReview: true, secretShapeScan: true, scopeMatch: true }), 'incomplete', 'candidate diff untracked negative')
    expect(classifyCandidateDiffCompletenessSample({ hasUntracked: true, stagedSnapshot: true, cachedDiffCheck: true, nameStatusReview: true, secretShapeScan: true, scopeMatch: true }), 'complete', 'candidate diff staged positive')
    expect(classifyReleaseAuthoritySample({ published: false, realConsumers: 0, authority: 'source' }), 'converge-before-compatibility', 'release authority negative')
    expect(classifyReleaseAuthoritySample({ published: true, realConsumers: 2, authority: 'release' }), 'compatibility-review-required', 'release authority positive')
    expect(classifyConfigurationErgonomicsSample({ minimalTaskConfig: true, fieldNecessityMatrix: true, optionalOmissionWorks: true, complexityUsed: 3, complexityBudget: 4 }), 'pass', 'config positive')
    expect(classifyConfigurationErgonomicsSample({ minimalTaskConfig: true, fieldNecessityMatrix: true, optionalOmissionWorks: false, complexityUsed: 3, complexityBudget: 4 }), 'invalid', 'config omission negative')
    expect(classifyInteractiveSemanticSample({ role: true, accessibleName: true, focusable: true, enter: true, space: true, escape: true, focusRecovery: true }), 'pass', 'interactive positive')
    expect(classifyInteractiveSemanticSample({ role: true, accessibleName: true, focusable: true, enter: true, space: true, escape: false, focusRecovery: false }), 'invalid', 'interactive negative')
    const checklistSnapshot = { currentRound: 'R2', zeroFindingStreak: 2, currentBatch: 'release-audit', remaining: ['R3'], blockers: [], openFindings: 0, closureState: 'running' }
    expect(classifyChecklistStateSample({ sections: Object.fromEntries(['header', 'items', 'round', 'ledger', 'progress', 'closure'].map(section => [section, { ...checklistSnapshot }])) }), 'materialized', 'checklist snapshot positive')
    expect(classifyChecklistStateSample({ sections: { ...Object.fromEntries(['header', 'items', 'round', 'ledger', 'closure'].map(section => [section, { ...checklistSnapshot }])), progress: { ...checklistSnapshot, currentBatch: 'CP2', remaining: ['B1~B4'] } } }), 'stale', 'checklist progress stale negative')

    const required = [
      ['skills/rework-prevention-engineering/SKILL.md', ['ReworkRiskProfile', 'ReworkEffectivenessLoop', 'FirstPassYield', 'CandidateDiffCompletenessGate', 'gray']],
      ['skills/release-verification/SKILL.md', ['CandidateDiffCompletenessGate', 'git diff --cached --check', 'intended scope']],
      ['skills/audit-release/SKILL.md', ['CandidateDiffCompletenessGate']],
      ['skills/audit-common/SKILL.md', ['ReviewCoverageClaimIntegrityGate', 'coverageClaims']],
      ['skills/host-contract-verification/SKILL.md', ['ArtifactDeliveryCompletenessGate', 'verified-missing', 'unverified']],
      ['skills/evolution-governance/SKILL.md', ['ReworkEffectivenessLoop', 'retrospective-only']],
      ['skills/spec-absorption/SKILL.md', ['ReworkReductionValueGate', 'rollbackOrSunset']],
      ['skills/api-contract-architecture/SKILL.md', ['ReleaseAuthorityBeforeCompatibilityGate', 'publishedState']],
      ['skills/developer-experience-architecture/SKILL.md', ['ConfigurationErgonomicsGate', 'OptionalFieldOmissionProbe']],
      ['skills/accessibility-i18n/SKILL.md', ['InteractiveSemanticProbe', 'focusRecovery']],
      ['skills/spec-governance/SKILL.md', ['rework-prevention', 'contract-release-authority', 'configuration-ergonomics', 'interactive-semantics']],
      ['skills/test-router/SKILL.md', ['coverageClaimIntegrity', 'artifactDeliveryCompleteness', 'reworkEffectiveness', 'candidateDiffCompleteness', 'interactiveSemantics']],
      ['skills/report/SKILL.md', ['ArtifactDeliveryCompletenessGate', 'ReworkPreventionGate', 'CandidateDiffCompletenessGate', 'ReleaseAuthorityBeforeCompatibilityGate']],
      ['skills/review-checklist/SKILL.md', ['ChecklistStateMaterializationGate', 'ChecklistStateSnapshot', 'CandidateDiffCompletenessGate']],
      ['prompts/report-audit.prompt.md', ['ChecklistStateMaterializationGate', 'ChecklistStateSnapshot']],
      ['hooks/_runtime/lifecycle-visible-reply.cjs', ['artifactStatus', 'verified-present', 'verified-missing', 'unverified']],
      ['scripts/lib/test-rework-trust-controls.js', ['classifyCoverageClaimSample', 'checkV94', 'retrospective-only']]
    ]
    for (const [file, needles] of required) checkFile(file, needles)

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    checkCurrentChangeRecord(pkg.version, ['rework-prevention-engineering', 'ChecklistStateMaterializationGate', 'V94'])
    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    const registration = plugin.skills.find(item => item.id === 'rework-prevention-engineering')
    if (!registration || registration.file !== 'skills/rework-prevention-engineering/SKILL.md') err('[V94] rework skill registration missing')
    if (registration?.lifecycleState !== 'gray') err('[V94] new rework skill must remain gray')
    console.log('[V94] rework prevention, coverage/artifact trust and owner subgates checked')
  }

  return { checkV94 }
}

module.exports = {
  buildReworkTrustControlChecks,
  classifyArtifactDeliverySample,
  classifyCandidateDiffCompletenessSample,
  classifyConfigurationErgonomicsSample,
  classifyCoverageClaimSample,
  classifyChecklistStateSample,
  classifyInteractiveSemanticSample,
  classifyReleaseAuthoritySample,
  classifyReworkPromotionSample
}
