'use strict'

function classifyAgentCompletenessSample(sample) {
  const scopes = ['kernel', 'runtime', 'developer-product', 'hosted-platform', 'enterprise-saas']
  if (!scopes.includes(sample.completenessObject)) return 'incomplete'
  if (!sample.requestChain || !sample.feedbackChain || !sample.crossCutting || !sample.domainMatrixComplete) return 'incomplete'
  const rank = scopes.indexOf(sample.completenessObject)
  if (rank >= 2 && !sample.buildPublishDeployInvoke) return 'incomplete'
  if (rank >= 3 && (!sample.providerCredential || !sample.deploymentFleet || !sample.tenantWorkspace)) return 'incomplete'
  if (rank >= 4 && (!sample.entitlementUsageBilling || !sample.adminOps)) return 'incomplete'
  return 'complete-for-declared-object'
}

function classifyDocsAudienceSequenceSample(sample) {
  if (!sample.generatedEvidence) return 'unverified'
  const complete = sample.pageRolesComplete && sample.firstScreenCurrentUser && sample.firstTwoSidebarCurrentUser &&
    sample.quickStartDistance <= sample.quickStartBudget && sample.manualTocOutlineDuplicates === 0
  return complete ? 'pass' : 'fail'
}

function classifyConsumerValidationSample(sample) {
  if (!sample.repositoryBinding || !sample.identityFresh || !sample.artifactFresh || !sample.dependencyResolution ||
      !sample.packedArtifact || !sample.crossRepositoryCI) return 'partial'
  if (sample.driftDetected) return 'stale'
  const denominators = Array.isArray(sample.denominators) ? sample.denominators.filter(item => item.applicable) : []
  if (!denominators.length || denominators.some(item => item.state !== 'accepted')) return 'partial'
  if (sample.designFitnessApplicable && classifyDesignFitnessSample(sample.designFitness) !== 'accepted') return 'partial'
  return 'accepted'
}

function classifyDesignFitnessSample(sample) {
  if (!sample || !Array.isArray(sample.features)) return 'partial'
  const applicable = sample.features.filter(item => item.applicable)
  if (!applicable.length) return 'not-applicable'
  const required = ['userTask', 'recommendedPath', 'defaults', 'configurationLayering', 'frameworkConvention',
    'publicSurface', 'lifecycle', 'composition', 'compatibilityAuthority', 'maintenanceCost', 'evidence']
  return applicable.every(item => required.every(field => item[field] === true) && item.decision === 'accepted')
    ? 'accepted' : 'partial'
}

function classifyValidationFindingRepairSample(sample) {
  if (!sample || !sample.findingBound || !sample.authorizedRepair || !sample.oldEvidenceStale ||
      !sample.newIdentityFrozen || !sample.failedProbeRerun || !sample.peerBoundaryRerun ||
      !sample.impactRegressionRerun || !sample.beforeAfterFresh) return 'incomplete'
  if (sample.fullConsumerRequired && !sample.fullConsumerRerun) return 'incomplete'
  return 'closed'
}

function classifyModulePerformanceSample(sample) {
  if (!Array.isArray(sample.features) || !sample.features.length || !sample.maintenanceTriggers || !sample.evidenceGovernance) return 'partial'
  const applicable = sample.features.filter(item => item.applicable)
  if (!applicable.length) return 'not-applicable'
  const required = ['workload', 'budget', 'immutableBaseline', 'candidateComparison', 'capacity', 'resource', 'recovery']
  return applicable.every(item => required.every(field => item[field] === true) && item.state === 'accepted') ? 'accepted' : 'partial'
}

function buildConsumerEvolutionControlChecks(ctx) {
  const { ROOT, fs, path, read, err, console } = ctx

  function expect(actual, expected, label) {
    if (actual !== expected) err(`[V95] ${label}: expected ${expected}, got ${actual}`)
  }

  function checkFile(file, needles) {
    const absolute = path.join(ROOT, file)
    if (!fs.existsSync(absolute)) {
      err(`[V95] missing required artifact: ${file}`)
      return
    }
    const content = read(absolute)
    for (const needle of needles) if (!content.includes(needle)) err(`[V95] ${file} missing "${needle}"`)
  }

  function checkCurrentChangeRecord(version, needles) {
    const files = ['changelogs/unreleased.md', `changelogs/releases/v${version}.md`]
    const combined = files.filter(file => fs.existsSync(path.join(ROOT, file)))
      .map(file => read(path.join(ROOT, file))).join('\n')
    for (const needle of needles) if (!combined.includes(needle)) err(`[V95] current changelog corpus missing "${needle}"`)
  }

  function checkV95() {
    expect(classifyAgentCompletenessSample({ completenessObject: 'kernel', requestChain: true, feedbackChain: true, crossCutting: true, domainMatrixComplete: true }), 'complete-for-declared-object', 'kernel positive')
    expect(classifyAgentCompletenessSample({ completenessObject: 'enterprise-saas', requestChain: true, feedbackChain: true, crossCutting: true, domainMatrixComplete: true }), 'incomplete', 'enterprise product-chain negative')
    expect(classifyDocsAudienceSequenceSample({ generatedEvidence: false }), 'unverified', 'docs runtime unobserved')
    expect(classifyDocsAudienceSequenceSample({ generatedEvidence: true, pageRolesComplete: true, firstScreenCurrentUser: true, firstTwoSidebarCurrentUser: true, quickStartDistance: 1, quickStartBudget: 2, manualTocOutlineDuplicates: 0 }), 'pass', 'docs rendered positive')
    expect(classifyConsumerValidationSample({ repositoryBinding: true, identityFresh: true, artifactFresh: true, dependencyResolution: true, packedArtifact: false, crossRepositoryCI: true, denominators: [] }), 'partial', 'realpath-only negative')
    expect(classifyConsumerValidationSample({ repositoryBinding: true, identityFresh: true, artifactFresh: true, dependencyResolution: true, packedArtifact: true, crossRepositoryCI: true, denominators: ['feature', 'scenario', 'adapter', 'impact', 'performance', 'release'].map(id => ({ id, applicable: true, state: 'accepted' })) }), 'accepted', 'consumer positive')
    expect(classifyDesignFitnessSample({ features: [{ applicable: true, userTask: true, recommendedPath: true, defaults: true, configurationLayering: true, frameworkConvention: true, publicSurface: true, lifecycle: true, composition: true, compatibilityAuthority: true, maintenanceCost: false, evidence: true, decision: 'accepted' }] }), 'partial', 'design fitness maintenance negative')
    expect(classifyDesignFitnessSample({ features: [{ applicable: true, userTask: true, recommendedPath: true, defaults: true, configurationLayering: true, frameworkConvention: true, publicSurface: true, lifecycle: true, composition: true, compatibilityAuthority: true, maintenanceCost: true, evidence: true, decision: 'accepted' }] }), 'accepted', 'design fitness positive')
    expect(classifyValidationFindingRepairSample({ findingBound: true, authorizedRepair: true, oldEvidenceStale: false, newIdentityFrozen: true, failedProbeRerun: true, peerBoundaryRerun: true, impactRegressionRerun: true, beforeAfterFresh: true }), 'incomplete', 'repair loop stale negative')
    expect(classifyValidationFindingRepairSample({ findingBound: true, authorizedRepair: true, oldEvidenceStale: true, newIdentityFrozen: true, failedProbeRerun: true, peerBoundaryRerun: true, impactRegressionRerun: true, beforeAfterFresh: true }), 'closed', 'repair loop positive')
    expect(classifyModulePerformanceSample({ features: [{ applicable: true, workload: true, budget: true, immutableBaseline: true, candidateComparison: true, capacity: false, resource: true, recovery: true, state: 'accepted' }], maintenanceTriggers: true, evidenceGovernance: true }), 'partial', 'single benchmark negative')
    expect(classifyModulePerformanceSample({ features: [{ applicable: true, workload: true, budget: true, immutableBaseline: true, candidateComparison: true, capacity: true, resource: true, recovery: true, state: 'accepted' }], maintenanceTriggers: true, evidenceGovernance: true }), 'accepted', 'module performance positive')

    const required = [
      ['skills/consumer-validation-engineering/SKILL.md', ['ConsumerValidationEngineeringGate', 'ValidationDenominatorMatrix', 'CrossRepoCI', 'DesignFitnessGate', 'ValidationFindingRepairLoop', 'gray']],
      ['skills/consumer-validation-engineering/agents/openai.yaml', ['$consumer-validation-engineering', 'Cross-repository consumer validation']],
      ['skills/ai-agent-system-architecture/SKILL.md', ['AgentCapabilityDomainCompletenessGate', 'enterprise-saas']],
      ['skills/audit-user-manual/SKILL.md', ['DocsAudienceRoleAndRenderedSequenceProbe', 'quick start']],
      ['skills/performance-engineering/SKILL.md', ['ModulePerformanceCoverageAndMaintenanceGate', 'maintenanceTriggers']],
      ['skills/source-consumer-sync/SKILL.md', ['V95', 'consumer-validation-engineering']],
      ['skills/quality-strategy/SKILL.md', ['ExternalConsumerValidationConfidenceGate', 'consumerValidationConfidence']],
      ['skills/test-router/SKILL.md', ['externalConsumerValidation', 'agentCapabilityCompleteness', 'modulePerformanceMaintenance']],
      ['skills/release-verification/SKILL.md', ['ConsumerValidationEngineeringGate', 'cross-repo']],
      ['skills/review-checklist/SKILL.md', ['ConsumerDesignFitnessRepairGate', 'ValidationFindingRepairLoop']],
      ['skills/report/report-schema.json', ['ConsumerValidationEngineering', 'design fitness']],
      ['skills/report/SKILL.md', ['AgentCapabilityDomainCompletenessGate', 'ConsumerValidationEngineeringGate']],
      ['skills/spec-governance/SKILL.md', ['agent-capability-completeness', 'docs-audience-render-sequence', 'consumer-validation', 'module-performance-maintenance']],
      ['skills/dev-plan-review/SKILL.md', ['AgentCapabilityDomainCompletenessGate', 'ConsumerValidationEngineeringGate', 'V95']],
      ['prompts/technical-design.prompt.md', ['agent-capability-completeness', 'consumer-validation', 'V95']],
      ['prompts/implementation-plan.prompt.md', ['V95 completeness groups', 'consumer-validation']],
      ['prompts/report-dev.prompt.md', ['Agent/Docs/Consumer/ModulePerformance completeness', 'V95']],
      ['prompts/report-fix.prompt.md', ['Agent/Docs/Consumer/ModulePerformance completeness', 'V95']],
      ['prompts/report-audit.prompt.md', ['Agent/Docs/Consumer/ModulePerformance completeness', 'V95']],
      ['README.md', ['consumer-validation-engineering', 'V95']],
      ['website/docs/guide/development.md', ['ConsumerValidationEngineeringGate', 'V95']]
    ]
    for (const [file, needles] of required) checkFile(file, needles)

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    checkCurrentChangeRecord(pkg.version, ['consumer-validation-engineering', 'V95'])
    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    const registration = plugin.skills.find(item => item.id === 'consumer-validation-engineering')
    if (!registration || registration.file !== 'skills/consumer-validation-engineering/SKILL.md') err('[V95] consumer validation skill registration missing')
    if (registration?.lifecycleState !== 'gray') err('[V95] consumer validation skill must remain gray')

    const portfolio = JSON.parse(read(path.join(ROOT, 'skills/portfolio.json')))
    if (portfolio.summary.skillCount !== 77 || portfolio.summary.activeSkillCount !== 74 || portfolio.summary.graySkillCount !== 3) {
      err('[V95] portfolio must be 77 skills = 74 active + 3 gray')
    }
    console.log('[V95] agent/docs/consumer/module-performance completeness controls checked')
  }

  return { checkV95 }
}

module.exports = {
  buildConsumerEvolutionControlChecks,
  classifyAgentCompletenessSample,
  classifyConsumerValidationSample,
  classifyDesignFitnessSample,
  classifyDocsAudienceSequenceSample,
  classifyModulePerformanceSample,
  classifyValidationFindingRepairSample
}
