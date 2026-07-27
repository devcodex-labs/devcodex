'use strict'

const {
  planAbsorptionCandidates,
  validateAbsorptionCandidateMatrix
} = require('./absorption-candidate-planner')

function classifyReleaseEfficiencySample(sample) {
  if (!sample.candidateFrozen || !sample.candidateIdentity || !sample.evidenceDependencyGraph) return 'unfrozen'
  if (sample.budgetMode === 'blocking' && (!sample.budgetAuthority || !sample.baselineComparable)) return 'invalid-budget'
  if (sample.mutationAfterFreeze && (!sample.generationAdvanced || !sample.dependentEvidenceStale)) return 'stale'
  if (sample.reuseRequested && (!sample.identityMatch || !sample.commandMatch || !sample.environmentMatch ||
      !sample.artifactMatch || !sample.fresh || !sample.dependencyCovered)) return 'invalid-reuse'
  const threshold = Number.isInteger(sample.resetThreshold) ? sample.resetThreshold : 3
  if (sample.overBudget || (sample.resetCount || 0) >= threshold) {
    return sample.incidentCreated ? 'accepted-with-incident' : 'incident-required'
  }
  return 'accepted'
}

function classifyIsolatedConsumerCwdSample(sample) {
  if (!sample.explicitConsumerManifest || !sample.consumerCwdBound ||
      !sample.sourceIdentityBefore || !sample.sourceIdentityAfter) return 'incomplete'
  if (sample.usedNpmInitPrefix || !sample.commandCwdMatchesConsumer) return 'unsafe'
  if (sample.sourceMutationObserved || sample.sourceIdentityBefore !== sample.sourceIdentityAfter) return 'contaminated'
  return 'accepted'
}

function classifyBatchScopeRebindSample(sample) {
  if (!sample.phaseTotalScope || !sample.allowedFirstBatch || !sample.actualTargetSet ||
      !sample.blockedScope || !sample.dirtyBoundary) return 'incomplete'
  if (!sample.currentBatchOnly || sample.blockedScopeTouched || !sample.rollbackAuthorized) return 'blocked'
  if (sample.validationConsumerAdded && (!sample.allowedPathsRebound || !sample.testRouteRebound ||
      !sample.consumerScopeRebound || !sample.regressionMatrixRebound || !sample.deployCopiesRebound)) return 'blocked'
  return 'pass'
}

function classifyBaseImpactAdmissionSample(sample) {
  const requiredFields = [
    'changeId', 'servedIntent', 'currentGap', 'absorptionDecision', 'baseClass',
    'affectedContracts', 'unaffectedIntents', 'consumers', 'fanout',
    'defaultPathDelta', 'fallbackBehavior', 'rollback', 'positiveProbe',
    'negativeProbe', 'disabledOrMisconfiguredProbe', 'complexityDelta',
    'replacementOrRetirementCredit', 'owner', 'reviewAt', 'deprecationAndDeletionCondition'
  ]
  if (!sample || requiredFields.some(field => sample[field] === undefined || sample[field] === null || sample[field] === '')) {
    return 'incomplete'
  }
  if (!['base-neutral', 'base-compatible', 'base-changing'].includes(sample.baseClass)) return 'invalid-base-class'
  if (!Array.isArray(sample.consumers) || sample.consumers.length === 0) return 'no-consumer'
  if (!Array.isArray(sample.unaffectedIntents) || sample.unaffectedIntents.length === 0) return 'unaffected-regression-missing'
  if (sample.defaultPathDelta && sample.defaultPathDelta.addsAlwaysOn === true && sample.baseClass !== 'base-changing') {
    return 'misclassified-base-change'
  }
  if (sample.baseClass === 'base-changing' && (!sample.standaloneConfirmation || !sample.migration ||
      !sample.positiveProbe || !sample.negativeProbe || !sample.disabledOrMisconfiguredProbe)) {
    return 'base-change-unconfirmed'
  }
  if (!sample.deprecationAndDeletionCondition || sample.deprecationAndDeletionCondition === 'none') {
    return 'lifecycle-incomplete'
  }
  return 'accepted'
}

function classifyContractMutationSample(sample) {
  if (!sample.applicable) return 'not-applicable'
  if (!sample.variantIsolationExecuted || !sample.completionDeletionExecuted ||
      !sample.schemaSemanticParity || !sample.docsRuntimeParity) return 'partial'
  if (sample.siblingFieldAccepted || sample.missingCompletionEvidenceAccepted) return 'escaped'
  return 'pass'
}

function classifyPhaseDeliverySample(sample) {
  const kinds = ['planning-only', 'design-ready', 'implementation', 'release']
  if (!kinds.includes(sample.phaseKind) || !sample.originalIntentTraced ||
      !sample.planningCoverageExplicit || !sample.sourceDeliveryExplicit ||
      !sample.entryExitAligned || !sample.confirmationAligned || !sample.closeRule) return 'inconsistent'
  if (sample.phaseKind === 'planning-only' && sample.sourceDeliveryClaimed) return 'inconsistent'
  return 'pass'
}

const scenarioFields = ['scenarioId', 'audienceGoal', 'topology', 'trigger', 'config', 'execute',
  'expectedState', 'failure', 'recovery', 'observe', 'executableEvidence', 'status']

function classifyScenarioCoverageSample(sample) {
  if (!Array.isArray(sample.scenarios)) return 'partial'
  const applicable = sample.scenarios.filter(item => item.inScope)
  if (!applicable.length) return 'not-applicable'
  for (const item of applicable) {
    if (scenarioFields.some(field => !item[field])) return 'partial'
    if (item.runtimeRequired && item.status === 'complete' && !item.runtimeExecuted) return 'false-complete'
  }
  return applicable.every(item => item.status === 'complete') ? 'complete' : 'partial'
}

function classifyDurableBatchSample(sample) {
  if (!sample.applicable) return 'not-applicable'
  const fields = ['sourceExhaustion', 'persistentCheckpoint', 'boundedPacing', 'atomicAggregation',
    'durableCompletion', 'coordinatorRecovery', 'workerRecovery', 'backpressure', 'replayEvidence']
  return fields.every(field => sample[field] === true) ? 'accepted' : 'partial'
}

function classifyStructuredAbsorptionPlanSample(sample) {
  const plan = planAbsorptionCandidates(sample)
  if (plan.validation.status !== 'valid') return 'invalid'
  if (plan.summary.blocked > 0 || plan.summary.openBlockers > 0) return 'blocked'
  if (plan.summary.ready === 0) return 'no-ready-candidate'
  return 'accepted'
}

function buildResidualAbsorptionControlChecks(ctx) {
  const { ROOT, fs, path, read, err, console } = ctx

  function expect(actual, expected, label) {
    if (actual !== expected) err(`[V96] ${label}: expected ${expected}, got ${actual}`)
  }

  function checkFile(file, needles) {
    const absolute = path.join(ROOT, file)
    if (!fs.existsSync(absolute)) {
      err(`[V96] missing required artifact: ${file}`)
      return
    }
    const content = read(absolute)
    for (const needle of needles) if (!content.includes(needle)) err(`[V96] ${file} missing "${needle}"`)
  }

  function checkV96() {
    expect(classifyReleaseEfficiencySample({ candidateFrozen: true, candidateIdentity: 'sha', evidenceDependencyGraph: true, budgetMode: 'blocking', budgetAuthority: false, baselineComparable: false }), 'invalid-budget', 'release invented budget negative')
    expect(classifyReleaseEfficiencySample({ candidateFrozen: true, candidateIdentity: 'sha', evidenceDependencyGraph: true, budgetMode: 'advisory', reuseRequested: true, identityMatch: true, commandMatch: true, environmentMatch: true, artifactMatch: true, fresh: true, dependencyCovered: true }), 'accepted', 'release reuse positive')
    expect(classifyReleaseEfficiencySample({ candidateFrozen: true, candidateIdentity: 'sha', evidenceDependencyGraph: true, budgetMode: 'advisory', mutationAfterFreeze: true, generationAdvanced: false, dependentEvidenceStale: false }), 'stale', 'release generation negative')
    const isolatedConsumer = { explicitConsumerManifest: true, consumerCwdBound: true, sourceIdentityBefore: 'tree', sourceIdentityAfter: 'tree', usedNpmInitPrefix: false, commandCwdMatchesConsumer: true, sourceMutationObserved: false }
    expect(classifyIsolatedConsumerCwdSample(isolatedConsumer), 'accepted', 'isolated consumer cwd positive')
    expect(classifyIsolatedConsumerCwdSample({ ...isolatedConsumer, usedNpmInitPrefix: true }), 'unsafe', 'npm init prefix negative')
    expect(classifyIsolatedConsumerCwdSample({ ...isolatedConsumer, sourceIdentityAfter: 'changed', sourceMutationObserved: true }), 'contaminated', 'consumer source mutation negative')

    const batch = { phaseTotalScope: true, allowedFirstBatch: true, actualTargetSet: true, blockedScope: true, dirtyBoundary: true, currentBatchOnly: true, blockedScopeTouched: false, rollbackAuthorized: true }
    expect(classifyBatchScopeRebindSample(batch), 'pass', 'batch positive')
    expect(classifyBatchScopeRebindSample({ ...batch, validationConsumerAdded: true, allowedPathsRebound: true, testRouteRebound: false }), 'blocked', 'consumer rebind negative')

    const baseAdmission = {
      changeId: 'PI-140',
      servedIntent: 'keep base stable',
      currentGap: 'no admission classifier',
      absorptionDecision: 'existing-skill-subgate',
      baseClass: 'base-compatible',
      affectedContracts: ['spec-absorption'],
      unaffectedIntents: ['ordinary-chat'],
      consumers: ['spec-absorption', 'test-router'],
      fanout: 2,
      defaultPathDelta: { addsAlwaysOn: false },
      fallbackBehavior: 'legacy path unchanged',
      rollback: 'remove subgate and probe',
      positiveProbe: 'base-compatible sample accepted',
      negativeProbe: 'base-changing without confirmation rejected',
      disabledOrMisconfiguredProbe: 'missing consumer rejected',
      complexityDelta: { runtime: 0, maintenance: 1 },
      replacementOrRetirementCredit: 'deprecate duplicate local gate',
      owner: 'spec-absorption',
      reviewAt: 'next release',
      deprecationAndDeletionCondition: 'sunset when stronger owner replaces it'
    }
    expect(classifyBaseImpactAdmissionSample(baseAdmission), 'accepted', 'base admission positive')
    expect(classifyBaseImpactAdmissionSample({ ...baseAdmission, consumers: [] }), 'no-consumer', 'base admission no consumer negative')
    expect(classifyBaseImpactAdmissionSample({ ...baseAdmission, unaffectedIntents: [] }), 'unaffected-regression-missing', 'base admission unaffected regression negative')
    expect(classifyBaseImpactAdmissionSample({ ...baseAdmission, defaultPathDelta: { addsAlwaysOn: true } }), 'misclassified-base-change', 'base admission always-on misclassification negative')
    expect(classifyBaseImpactAdmissionSample({ ...baseAdmission, baseClass: 'base-changing', standaloneConfirmation: false }), 'base-change-unconfirmed', 'base-changing confirmation negative')

    expect(classifyContractMutationSample({ applicable: true, variantIsolationExecuted: true, completionDeletionExecuted: true, schemaSemanticParity: true, docsRuntimeParity: true, siblingFieldAccepted: true, missingCompletionEvidenceAccepted: false }), 'escaped', 'variant injection negative')
    expect(classifyContractMutationSample({ applicable: true, variantIsolationExecuted: true, completionDeletionExecuted: true, schemaSemanticParity: true, docsRuntimeParity: true, siblingFieldAccepted: false, missingCompletionEvidenceAccepted: false }), 'pass', 'contract mutation positive')

    expect(classifyPhaseDeliverySample({ phaseKind: 'planning-only', originalIntentTraced: true, planningCoverageExplicit: true, sourceDeliveryExplicit: true, entryExitAligned: true, confirmationAligned: true, closeRule: true, sourceDeliveryClaimed: true }), 'inconsistent', 'phase planning delivery negative')
    expect(classifyPhaseDeliverySample({ phaseKind: 'implementation', originalIntentTraced: true, planningCoverageExplicit: true, sourceDeliveryExplicit: true, entryExitAligned: true, confirmationAligned: true, closeRule: true, sourceDeliveryClaimed: true }), 'pass', 'phase positive')

    const scenario = { inScope: true, scenarioId: 'S1', audienceGoal: 'ship', topology: 'worker', trigger: 'input', config: 'cfg', execute: 'run', expectedState: 'done', failure: 'crash', recovery: 'resume', observe: 'trace', executableEvidence: 'test', status: 'complete', runtimeRequired: true, runtimeExecuted: true }
    expect(classifyScenarioCoverageSample({ scenarios: [scenario] }), 'complete', 'scenario positive')
    expect(classifyScenarioCoverageSample({ scenarios: [{ ...scenario, runtimeExecuted: false }] }), 'false-complete', 'scenario runtime false complete')
    expect(classifyDurableBatchSample({ applicable: true, sourceExhaustion: true, persistentCheckpoint: true, boundedPacing: true, atomicAggregation: true, durableCompletion: true, coordinatorRecovery: true, workerRecovery: true, backpressure: true, replayEvidence: false }), 'partial', 'durable replay negative')
    expect(classifyDurableBatchSample({ applicable: true, sourceExhaustion: true, persistentCheckpoint: true, boundedPacing: true, atomicAggregation: true, durableCompletion: true, coordinatorRecovery: true, workerRecovery: true, backpressure: true, replayEvidence: true }), 'accepted', 'durable positive')

    const layerChecks = {
      commonInstruction: { state: 'not-applicable', skipReason: 'skill subgate only' },
      skill: { state: 'required', evidence: 'skills/spec-absorption/SKILL.md' },
      promptTemplate: { state: 'not-applicable', skipReason: 'no prompt change' },
      executionConsumer: { state: 'required', evidence: 'scripts/plan-absorption-candidates.js' },
      validationProbe: { state: 'required', evidence: 'test:residual-absorption-controls' },
      publicDocs: { state: 'required', evidence: 'README.md' },
      deployCopy: { state: 'required', evidence: 'devcodex global-adapters apply' }
    }
    const structuredMatrix = {
      schemaVersion: 'AbsorptionCandidateMatrixV1',
      phaseKind: 'planning',
      candidates: [{
        candidateId: 'PI-STRUCTURED-ABSORB',
        sourceNamespace: '.devcodex/devcodex/data/process-improvements.md',
        rawSummary: 'structured absorption candidate planning',
        backlogClass: 'pure-open',
        commonDecision: 'absorb',
        targetOwner: 'spec-absorption',
        targetLayer: 'existing-skill-subgate',
        layerChecks,
        validationRoute: ['npm run test:residual-absorption-controls'],
        consumerSync: ['README.md'],
        sourceExistence: {
          claimedCapability: 'SourceExistenceVerificationGate',
          searchAnchors: ['SourceExistenceVerificationGate'],
          sourceRoot: 'devcodex',
          existenceStatus: 'absent',
          hitEvidence: [],
          nearNeighborCoverage: 'none',
          ledgerDisposition: 'absorb-candidate',
          verifiedBy: 'validate-residual-absorption-controls'
        },
        probeNecessity: {
          probeClass: 'extend-existing',
          necessity: 'required',
          rationale: 'false-green high',
          probePlan: 'extend residual controls',
          existingProbeReuse: 'classifyStructuredAbsorptionPlanSample',
          alwaysOnImpact: 'test-only',
          complexityDelta: 'low',
          falsePositiveRisk: 'low'
        },
        enforcementLevel: 'hard-probe'
      }]
    }
    expect(classifyStructuredAbsorptionPlanSample(structuredMatrix), 'accepted', 'structured absorption positive')
    expect(classifyStructuredAbsorptionPlanSample({
      ...structuredMatrix,
      candidates: [{ ...structuredMatrix.candidates[0], targetOwner: '' }]
    }), 'blocked', 'structured absorption target owner negative')
    expect(validateAbsorptionCandidateMatrix({
      schemaVersion: 'AbsorptionCandidateMatrixV1',
      phaseKind: 'planning',
      candidates: []
    }).some(item => item.code === 'candidates-required'), true, 'structured absorption empty matrix negative')

    const required = [
      ['skills/release-verification/SKILL.md', ['CandidateFreezeGate', 'ReleaseCriticalPathBudgetGate', 'ValidationEvidenceReuseGate', 'ReleaseReworkIncidentGate', 'IsolatedConsumerCwdGate', 'npm init --prefix']],
      ['skills/audit-release/SKILL.md', ['CandidateFreezeGate', 'ValidationEvidenceReuseGate']],
      ['skills/execution-contract/SKILL.md', ['CurrentBatchScopeDiffProbe', 'NewValidationConsumerRebindProbe', 'ValidationConsumerRebindMatrix', 'ExecutionBudgetGate', 'ExternalWaitAccountingGate', 'LongTaskAuthorizationGate', 'StopSnapshot']],
      ['skills/api-contract-architecture/SKILL.md', ['ContractVariantIsolationMutationGate', 'CompletionEvidenceDeletionMatrix']],
      ['skills/quality-strategy/SKILL.md', ['ContractMutationCoverageGate', 'schema-semantic parity']],
      ['skills/audit-requirements/SKILL.md', ['PhaseDeliverySemanticGate', 'OriginalIntentReverseTraceProbe']],
      ['skills/review-checklist/SKILL.md', ['PhaseDeliverySemanticGate', 'ReleaseEfficiencyControlGate']],
      ['skills/user-manual-authoring/SKILL.md', ['ScenarioCoverageMatrixProbe', 'DurableBatchOrchestrationProbe']],
      ['skills/audit-user-manual/SKILL.md', ['ScenarioCoverageMatrixProbe', 'DurableBatchOrchestrationProbe']],
      ['skills/distributed-systems-architecture/SKILL.md', ['DurableBatchOrchestrationProbe', '持久化 cursor/checkpoint']],
      ['skills/spec-governance/gate-registry.json', ['release-efficiency', 'batch-scope-rebinding', 'contract-mutation-isolation', 'phase-delivery-semantics', 'scenario-durable-workflow']],
      ['skills/spec-absorption/SKILL.md', ['BaseImpactAssessmentV1', 'ComplexityDeltaBudgetV1', 'UnaffectedIntentRegression', 'replacementOrRetirementCredit', 'base-neutral', 'base-compatible', 'base-changing', 'AbsorptionCandidateMatrixV1', 'LayeredAbsorptionDecisionV1', 'plan-absorption-candidates', 'SourceExistenceVerificationGate', '可关账清单', 'ExecutableAbsorptionEffectivenessGate', 'ProbeNecessityDecisionGate', 'enforcementLevel']],
      ['skills/spec-absorption/absorption-candidate-matrix.v1.schema.json', ['AbsorptionCandidateMatrixV1', 'backlogClass', 'commonDecision', 'layerChecks', 'prevention', 'sourceExistence', 'existenceStatus', 'probeNecessity', 'alwaysOnImpact']],
      ['skills/spec-absorption/layered-absorption-decision.v1.schema.json', ['LayeredAbsorptionDecisionV1', 'classification', 'consumerSync', 'status']],
      ['scripts/lib/absorption-candidate-planner.js', ['planAbsorptionCandidates', 'validateAbsorptionCandidateMatrix', 'classifySourceExistenceVerificationSample', 'classifyExecutableAbsorptionSample', 'readonly', 'sideEffects']],
      ['scripts/plan-absorption-candidates.js', ['--self-test', '--input', 'read-only']],
      ['skills/spec-governance/SKILL.md', ['base-admission-governance', 'BaseImpactAssessmentV1', 'ComplexityDeltaBudgetV1']],
      ['skills/test-router/SKILL.md', ['baseAdmissionGovernance', 'BaseImpactAssessmentV1', 'V96']],
      ['skills/report/report-schema.json', ['ReleaseEfficiencyControl', 'ConsumerValidationEngineering']],
      ['skills/report/SKILL.md', ['WorkspaceSyncStatus', 'CompletionEvidenceGate', 'PostDeliverySelfCheck', 'ExecutionBudget']],
      ['skills/compliance/SKILL.md', ['T11', 'T12', 'T13', 'ExecutionBudget']],
      ['README.md', ['ReleaseEfficiencyControlGate', 'IsolatedConsumerCwdGate', 'ScenarioCoverageMatrixProbe', 'DesignFitnessGate', 'V96', 'ExecutionBudgetGate']],
      ['website/docs/guide/development.md', ['CurrentBatchScopeDiffProbe', 'ContractVariantIsolationMutationGate', 'PhaseDeliverySemanticGate', 'ScenarioCoverageMatrixProbe', 'DesignFitnessGate', 'V96']],
      ['website/docs/guide/release.md', ['CandidateFreezeGate', 'ReleaseCriticalPathBudgetGate', 'ValidationEvidenceReuseGate', 'IsolatedConsumerCwdGate']]
    ]
    for (const [file, needles] of required) checkFile(file, needles)

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    const changelogFiles = ['changelogs/unreleased.md', `changelogs/releases/v${pkg.version}.md`]
    const changelog = changelogFiles.filter(file => fs.existsSync(path.join(ROOT, file))).map(file => read(path.join(ROOT, file))).join('\n')
    for (const needle of ['CandidateFreezeGate', 'IsolatedConsumerCwdGate', 'DesignFitnessGate', 'BaseImpactAssessmentV1', 'V96']) {
      if (!changelog.includes(needle)) err(`[V96] current changelog corpus missing "${needle}"`)
    }
    console.log('[V96] residual absorption release/batch/contract/phase/scenario/base-admission controls checked')
  }

  return { checkV96 }
}

module.exports = {
  buildResidualAbsorptionControlChecks,
  classifyBaseImpactAdmissionSample,
  classifyBatchScopeRebindSample,
  classifyContractMutationSample,
  classifyDurableBatchSample,
  classifyIsolatedConsumerCwdSample,
  classifyPhaseDeliverySample,
  classifyReleaseEfficiencySample,
  classifyScenarioCoverageSample,
  classifyStructuredAbsorptionPlanSample
}
