'use strict'

const { assessRepairPrevention } = require('./repair-prevention-assessment')

function repairAssessmentFixture(overrides = {}) {
  return {
    schemaVersion: 'RepairPreventionAssessmentV1',
    repairId: 'repair-v94',
    taskId: 'task-v94',
    problemCluster: 'v94-fixture',
    riskClass: 'normal',
    riskTags: [],
    mode: 'light',
    repeatEscape: false,
    defectRootCause: 'fixture defect',
    controlFailure: 'fixture control gap',
    escapedFrom: ['implementation'],
    detectedAt: 'verification',
    preventionDecision: 'no-new-control',
    noNewControlReason: 'existing-effective-control',
    noNewControlEvidence: ['existing probe failed as designed'],
    regressionSeeds: ['fixture seed'],
    negativeCases: ['fixture negative'],
    controlOwner: 'repair-prevention-assessment',
    consumers: ['fix-default'],
    immediateClosureEvidence: ['current regression passed'],
    prospectiveEvidencePlan: {
      status: 'not-required',
      currentEventOnly: true,
      comparableWorkUnits: 0,
      independentContexts: 0,
      metricGaming: false,
      rollbackReady: true,
      authority: 'existing control authority'
    },
    rollbackOrSunset: {
      rollbackTriggers: ['control behavior changes'],
      sunsetCriteria: ['consumer is removed'],
      reviewAt: 'next contract review'
    },
    ...overrides
  }
}

function classifyRepairPreventionAssessmentSample(sample) {
  const result = assessRepairPrevention(sample)
  return result.valid ? `${result.lifecycleState}:${result.effectivenessStatus}` : `invalid:${result.errors[0]}`
}

function classifyCoverageClaimSample(sample) {
  const fullClaim = ['full', '逐文件全读', 'all-files'].includes(sample.claim)
  if (fullClaim && (sample.mode !== 'full-read' || !sample.coverageLedger || sample.unresolvedFiles > 0)) return 'invalid-claim'
  return 'evidence-bounded'
}

function classifyArtifactDeliverySample(sample) {
  if (!sample.observed) return 'unverified'
  if (sample.legacyFormat && !sample.hasEnvelopeMarker) return 'unverified-legacy'
  const complete = sample.hasEnvelopeMarker === true &&
    sample.hasAllowedSection === true &&
    sample.hasSemanticItems === true &&
    sample.requiredHidden === 0 &&
    sample.listed + sample.remaining === sample.total &&
    sample.capabilityEvidence === true
  return complete ? 'verified-present' : 'verified-missing'
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
  const logicalExists = file => typeof read.exists === 'function' ? read.exists(file) : fs.existsSync(file)

  function checkFile(file, needles) {
    const absolute = path.join(ROOT, file)
    if (!logicalExists(absolute)) {
      err(`[V94] missing required artifact: ${file}`)
      return
    }
    const content = read(absolute)
    for (const needle of needles) if (!content.includes(needle)) err(`[V94] ${file} missing "${needle}"`)
  }

  function checkCurrentChangeRecord(version, needles) {
    const files = ['changelogs/unreleased.md', `changelogs/releases/v${version}.md`]
    const combined = files.filter(file => logicalExists(path.join(ROOT, file)))
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
    expect(classifyArtifactDeliverySample({ observed: true, hasEnvelopeMarker: true, hasAllowedSection: true, hasSemanticItems: false, requiredHidden: 0, listed: 0, remaining: 1, total: 1, capabilityEvidence: true }), 'verified-missing', 'artifact missing')
    expect(classifyArtifactDeliverySample({ observed: true, hasEnvelopeMarker: true, hasAllowedSection: true, hasSemanticItems: true, requiredHidden: 0, listed: 1, remaining: 0, total: 1, capabilityEvidence: true }), 'verified-present', 'artifact complete')
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
    expect(classifyRepairPreventionAssessmentSample(repairAssessmentFixture()), 'none:not-applicable', 'repair prevention no-new positive')
    expect(classifyRepairPreventionAssessmentSample(repairAssessmentFixture({ repeatEscape: true })), 'invalid:full-mode-required', 'repair prevention repeat negative')
    expect(classifyRepairPreventionAssessmentSample(repairAssessmentFixture({
      preventionDecision: 'existing-control-restored',
      prospectiveEvidencePlan: { status: 'sufficient', currentEventOnly: true, comparableWorkUnits: 3, independentContexts: 0, metricGaming: false, rollbackReady: true, authority: 'current rerun' }
    })), 'invalid:prospective-sufficient-evidence-invalid', 'repair prevention retrospective promotion negative')

    const required = [
      ['skills/repair-prevention-assessment/SKILL.md', ['RepairPreventionAssessmentGate', 'RepairPreventionAssessmentV1', 'immediateClosureEvidence', 'prospectiveEvidencePlan', 'active workflow', 'gray Skill']],
      ['skills/repair-prevention-assessment/repair-prevention-assessment.schema.json', ['RepairPreventionAssessmentV1', 'immediateClosureEvidence', 'prospectiveEvidencePlan', 'rollbackOrSunset']],
      ['skills/rework-prevention-engineering/SKILL.md', ['active RepairPreventionAssessmentGate', 'ReworkRiskProfile', 'ReworkEffectivenessLoop', 'FirstPassYield', 'CandidateDiffCompletenessGate', 'gray']],
      ['skills/rework-prevention-engineering/repair-prevention-assessment.schema.json', ['RepairPreventionAssessmentV1', 'immediateClosureEvidence', 'prospectiveEvidencePlan', 'rollbackOrSunset']],
      ['scripts/lib/repair-prevention-assessment.js', ['assessRepairPrevention', 'prospective-sufficient-evidence-invalid', 'emergency-active']],
      ['scripts/test-repair-prevention-assessment.js', ['first/repeat/no-new/emergency/rollback/sunset']],
      ['skills/release-verification/SKILL.md', ['CandidateDiffCompletenessGate', 'git diff --cached --check', 'intended scope']],
      ['skills/audit-release/SKILL.md', ['CandidateDiffCompletenessGate']],
      ['skills/audit-common/SKILL.md', ['ReviewCoverageClaimIntegrityGate', 'coverageClaims']],
      ['skills/user-visible-output-contract/SKILL.md', ['ArtifactDeliveryManifestGate', 'UserFacingArtifactProjectionGate', 'PostCompletionActionSetV1', 'EntryCheckModelV3', 'DevCodexVisibleEnvelopeV3', 'LinkCapabilityDecisionV1', 'HostLinkCapabilityDecisionV2', 'ArtifactDeliveryAttemptV1', 'presentationSurface', 'readback']],
      ['skills/host-contract-verification/SKILL.md', ['VisibleOutputHostEvidenceGate', 'HostPermissionAuthorityInvariant', 'ArtifactDeliveryAttemptV1', 'presentationSurface', 'readback', 'verified-missing', 'unverified']],
      ['skills/evolution-governance/SKILL.md', ['ReworkEffectivenessLoop', 'retrospective-only']],
      ['skills/spec-absorption/SKILL.md', ['ReworkReductionValueGate', 'rollbackOrSunset']],
      ['skills/api-contract-architecture/SKILL.md', ['ReleaseAuthorityBeforeCompatibilityGate', 'publishedState']],
      ['skills/developer-experience-architecture/SKILL.md', ['ConfigurationErgonomicsGate', 'OptionalFieldOmissionProbe']],
      ['skills/accessibility-i18n/SKILL.md', ['InteractiveSemanticProbe', 'focusRecovery']],
      ['skills/spec-governance/SKILL.md', ['rework-prevention', 'contract-release-authority', 'configuration-ergonomics', 'interactive-semantics']],
      ['skills/fix-default/SKILL.md', ['RepairPreventionAssessmentGate', 'RepairPreventionAssessmentV1']],
      ['skills/fix-security/SKILL.md', ['RepairPreventionAssessmentGate', 'emergency-active']],
      ['skills/execution-contract/SKILL.md', ['RepairPreventionAssessmentGate', 'repairPreventionAssessment']],
      ['skills/test-router/SKILL.md', ['repairPreventionAssessment', 'coverageClaimIntegrity', 'artifactDeliveryCompleteness', 'reworkEffectiveness', 'candidateDiffCompleteness', 'interactiveSemantics']],
      ['skills/report/SKILL.md', ['RepairPreventionAssessment', 'ArtifactDeliveryManifestV1', 'UserFacingArtifactSetV1', 'CandidateDiffCompletenessGate', 'ReleaseAuthorityBeforeCompatibilityGate']],
      ['skills/review-checklist/SKILL.md', ['RepairPreventionAssessmentReviewGate', 'ChecklistStateMaterializationGate', 'ChecklistStateSnapshot', 'CandidateDiffCompletenessGate']],
      ['skills/spec-governance/gate-registry.json', ['repair-prevention-assessment', 'RepairPreventionAssessmentV1']],
      ['prompts/technical-design.prompt.md', ['RepairPreventionAssessmentGate', 'RepairPreventionAssessmentV1']],
      ['prompts/implementation-plan.prompt.md', ['RepairPreventionAssessment']],
      ['prompts/report-fix.prompt.md', ['RepairPreventionAssessmentV1', 'prospectiveEvidencePlan']],
      ['prompts/report-dev.prompt.md', ['RepairPreventionAssessment']],
      ['prompts/report-audit.prompt.md', ['RepairPreventionAssessmentReviewGate']],
      ['instructions/11-fix.instructions.md', ['RepairPreventionAssessmentGate', 'current repair closure']],
      ['instructions.md', ['repair-prevention-assessment', 'RepairPreventionAssessmentV1']],
      ['prompts/report-audit.prompt.md', ['ChecklistStateMaterializationGate', 'ChecklistStateSnapshot']],
      ['hooks/_runtime/lifecycle-visible-reply.cjs', ['artifactStatus', 'verified-present', 'verified-missing', 'unverified']],
      ['scripts/lib/test-rework-trust-controls.js', ['classifyCoverageClaimSample', 'checkV94', 'retrospective-only']]
    ]
    for (const [file, needles] of required) checkFile(file, needles)

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    checkCurrentChangeRecord(pkg.version, ['RepairPreventionAssessmentGate', 'repair-prevention-assessment', 'ChecklistStateMaterializationGate', 'V94'])
    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    const assessmentRegistration = plugin.skills.find(item => item.id === 'repair-prevention-assessment')
    if (!assessmentRegistration || assessmentRegistration.file !== 'skills/repair-prevention-assessment/SKILL.md') {
      err('[V94] active repair-prevention-assessment registration missing')
    }
    if (assessmentRegistration?.lifecycleState && assessmentRegistration.lifecycleState !== 'active') {
      err('[V94] repair-prevention-assessment must be active/default-deployed')
    }
    const reworkRegistration = plugin.skills.find(item => item.id === 'rework-prevention-engineering')
    if (!reworkRegistration || reworkRegistration.file !== 'skills/rework-prevention-engineering/SKILL.md') err('[V94] rework skill registration missing')
    if (reworkRegistration?.lifecycleState !== 'gray') err('[V94] rework effectiveness skill must remain gray')
    const canonicalSchema = String(read(path.join(ROOT, 'skills/repair-prevention-assessment/repair-prevention-assessment.schema.json')))
    const compatibilitySchema = String(read(path.join(ROOT, 'skills/rework-prevention-engineering/repair-prevention-assessment.schema.json')))
    if (canonicalSchema !== compatibilitySchema) err('[V94] repair prevention compatibility schema drifted from active canonical owner')
    for (const relative of [
      'skills/fix-default/SKILL.md',
      'skills/fix-security/SKILL.md',
      'skills/execution-contract/SKILL.md',
      'instructions/11-fix.instructions.md',
      'prompts/technical-design.prompt.md',
      'prompts/implementation-plan.prompt.md'
    ]) {
      if (String(read(path.join(ROOT, relative))).includes('rework-prevention-engineering#RepairPreventionAssessmentGate')) {
        err(`[V94] active repair consumer depends on unavailable gray assessment owner: ${relative}`)
      }
    }
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
  classifyRepairPreventionAssessmentSample,
  classifyReleaseAuthoritySample,
  classifyReworkPromotionSample
}
