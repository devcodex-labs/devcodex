'use strict'

const { collectActiveProfileCorpusIfAvailable } = require('./validate-governance-review')

function runSpecGovernanceReviewSuite(ctx) {
  const {
    ROOT, fs, path, failures, SOURCE_PROJECT_NAME, skillCount, read, mustInclude,
    mustNotInclude, collectChangelogContents, mustIncludeInChangelogs
  } = ctx

  const checkV75 = 'PromptLongGateListDriftProbe'
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-review.js', 'checkV75'],
    ['scripts/lib/validate-governance-review.js', checkV75],
    ['scripts/lib/validate-governance-review.js', 'negativeSamples'],
    ['scripts/lib/validate-governance-review.js', 'GovernanceGateRegistry/gateGroup'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/spec-governance/SKILL.md', checkV75],
    ['skills/spec-governance/SKILL.md', 'SCV 负向样例'],
    ['skills/source-consumer-sync/SKILL.md', checkV75],
    ['README.md', checkV75],
    ['website/docs/guide/development.md', checkV75],
    ['changelogs/releases/v1.11.28.md', 'V75']
  ]) {
    mustInclude(file, needle)
  }

  const promptLongGateListDriftConsumerFiles = [
    'README.md',
    'website/docs/guide/development.md',
    'instructions/10-dev.instructions.md',
    'instructions/11-fix.instructions.md',
    'instructions/12-audit.instructions.md',
    'instructions/13-analyze.instructions.md',
    'prompts/technical-design.prompt.md',
    'prompts/implementation-plan.prompt.md',
    'prompts/report-dev.prompt.md',
    'prompts/report-fix.prompt.md',
    'prompts/report-audit.prompt.md',
    'prompts/report-scenario-test.prompt.md'
  ]

  const promptLongGateListDriftClusters = [
    ['CodeTruthRequirementGate', 'AdapterBenchmarkAttribution', 'ProductRequirementTraceabilityGate', 'WorkspaceDataAbsorptionScopeGate', 'DatabaseRecordMigrationExportGate', 'GeneratedSiteGate', 'ArtifactLinkSetDedupeGate', 'BenchmarkRegressionGuard', 'V2FormalSolutionPackage'],
    ['PublicSurfaceClosureGate', 'UserManualRenderedFlowAndRealWorkflowProbe', 'SampleIssueExpansionGate', 'RequirementDimensionBindingGate', 'SemanticLegacyRouteExposureGate', 'ReferenceCodeTruthSamplingGate', 'FrontendAsyncCacheRenderGate', 'StrongestProfileSourceGate', 'RouteNamespaceResponsibilityGate', 'DocsThemeRuntimeVisualProbeGate'],
    ['DatabaseRecordMigrationExportGate', 'FrontendBrowserVerificationBudgetGate', 'UserSelfVerificationOverrideGate', 'FindingProbeMatrixGate', 'MultiPhaseClosureGate', 'GuardPolicyBypassMatrixGate', 'SideEffectCompatibilityDocsGate', 'ExecutableExampleTruthProbeGate', 'VisualDeviationTypeGate', 'OneOffRequirementScriptPlacementGate', 'VerificationCommandSideEffectGate', 'DesignFramePurposeClassificationGate', 'RequirementPreConfirmGate', 'PackageAdapterPreConfirmEvidenceGate']
  ]

  function hasLongGateListDrift(line) {
    return promptLongGateListDriftClusters.some((cluster, index) => {
      const minHits = index === 2 ? 10 : 8
      return cluster.filter(needle => line.includes(needle)).length >= minHits
    })
  }

  for (const cluster of promptLongGateListDriftClusters) {
    if (!hasLongGateListDrift(cluster.join('、'))) {
      failures.push('PromptLongGateListDriftProbe negative sample did not trigger')
    }
  }
  const groupedRegistryLine = '按 GovernanceGateRegistry 分组记录 gateGroup / ownerSkill / validationRoute / skipReason，代表锚点包括 PublicSurfaceClosureGate、UserManualProductizationGate、ReviewAnchorMaterializationGate、FrontendAsyncCacheRenderGate、RemoteCIParityPushGate 与 DocsThemeRuntimeVisualProbeGate'
  if (hasLongGateListDrift(groupedRegistryLine)) {
    failures.push('PromptLongGateListDriftProbe false positive on grouped registry line')
  }
  for (const file of promptLongGateListDriftConsumerFiles) {
    read(file).split(/\r?\n/).forEach((line, index) => {
      if (hasLongGateListDrift(line)) failures.push(`${file}:${index + 1} contains historical long gate list drift`)
    })
  }

  const checkV76 = 'ReviewEscapeRecordGate'
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-review.js', 'checkV76'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/review-checklist/SKILL.md', checkV76],
    ['skills/review-checklist/SKILL.md', 'escapeRecords'],
    ['skills/review-checklist/SKILL.md', 'missingDimensionOrProbe'],
    ['skills/review-checklist/SKILL.md', 'ledgerRoute'],
    ['skills/spec-governance/SKILL.md', 'review-escape'],
    ['skills/spec-governance/SKILL.md', checkV76],
    ['skills/test-router/SKILL.md', checkV76],
    ['skills/report/SKILL.md', checkV76],
    ['prompts/technical-design.prompt.md', checkV76],
    ['prompts/implementation-plan.prompt.md', checkV76],
    ['prompts/report-dev.prompt.md', checkV76],
    ['prompts/report-fix.prompt.md', checkV76],
    ['prompts/report-audit.prompt.md', checkV76],
    ['prompts/report-scenario-test.prompt.md', checkV76],
    ['README.md', checkV76],
    ['website/docs/guide/development.md', checkV76],
    ['changelogs/releases/v1.11.28.md', 'V76']
  ]) {
    mustInclude(file, needle)
  }

  const checkV77 = 'NativeCommandExitCodeGate'
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-review.js', 'checkV77'],
    ['scripts/lib/validate-governance-review.js', checkV77],
    ['scripts/lib/validate-governance-review.js', 'negativeSamples'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/release-verification/SKILL.md', checkV77],
    ['skills/release-verification/SKILL.md', '$LASTEXITCODE'],
    ['skills/audit-release/SKILL.md', checkV77],
    ['skills/test-router/SKILL.md', 'nativeCommandExitCode'],
    ['skills/report/SKILL.md', checkV77],
    ['skills/spec-governance/SKILL.md', checkV77],
    ['skills/document-sync/SKILL.md', checkV77],
    ['prompts/technical-design.prompt.md', checkV77],
    ['prompts/implementation-plan.prompt.md', '真实 exitCode'],
    ['prompts/report-dev.prompt.md', checkV77],
    ['prompts/report-fix.prompt.md', checkV77],
    ['prompts/report-audit.prompt.md', checkV77],
    ['README.md', checkV77],
    ['website/docs/guide/development.md', checkV77],
    ['changelogs/releases/v1.11.28.md', 'V77']
  ]) {
    mustInclude(file, needle)
  }

  const checkV78 = 'PostConfirmationReviewScopeGate'
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-review.js', 'checkV78'],
    ['scripts/lib/validate-governance-review.js', checkV78],
    ['scripts/lib/validate-governance-review.js', 'DevelopmentDriftGate'],
    ['scripts/lib/validate-governance-review.js', 'VerificationPlanMaterializationProbe'],
    ['scripts/lib/validate-governance-review.js', 'AcceptedSuggestionRootCauseGate'],
    ['scripts/lib/validate-governance-review.js', 'ChinesePrimaryExpressionGate'],
    ['scripts/lib/validate-governance-review.js', 'SidebarPageRoleMaterializationProbe'],
    ['scripts/lib/validate-governance-review.js', 'SidebarGroupSemanticModelProbe'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions/01-common.instructions.md', checkV78],
    ['skills/cp-gate/SKILL.md', checkV78],
    ['skills/review-checklist/SKILL.md', checkV78],
    ['skills/dev-default/SKILL.md', 'DevelopmentDriftGate'],
    ['skills/execution-contract/SKILL.md', 'DevelopmentDriftGate'],
    ['skills/dev-plan-review/SKILL.md', 'VerificationPlanMaterializationProbe'],
    ['skills/dev-docs/SKILL.md', 'ChinesePrimaryExpressionGate'],
    ['skills/user-manual-authoring/SKILL.md', 'SidebarGroupSemanticModelProbe'],
    ['skills/document-sync/SKILL.md', 'SidebarPageRoleMaterializationProbe'],
    ['skills/spec-governance/SKILL.md', 'AcceptedSuggestionRootCauseGate'],
    ['skills/test-router/SKILL.md', 'docsIaReadability'],
    ['skills/report/SKILL.md', 'AcceptedSuggestionRootCauseGate'],
    ['prompts/technical-design.prompt.md', 'DevelopmentDriftGate'],
    ['prompts/implementation-plan.prompt.md', 'VerificationPlanMaterializationProbe'],
    ['prompts/report-dev.prompt.md', 'AcceptedSuggestionRootCauseGate'],
    ['prompts/report-fix.prompt.md', 'AcceptedSuggestionRootCauseGate'],
    ['prompts/report-audit.prompt.md', 'SidebarGroupSemanticModelProbe'],
    ['prompts/report-scenario-test.prompt.md', 'SidebarGroupSemanticModelProbe'],
    ['README.md', 'AcceptedSuggestionRootCauseGate'],
    ['website/docs/guide/development.md', 'DevelopmentDriftGate'],
    ['changelogs/releases/v1.11.28.md', 'V78']
  ]) {
    mustInclude(file, needle)
  }

  const checkV79 = 'CoverageGateDecision'
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-review.js', 'checkV79'],
    ['scripts/lib/validate-governance-review.js', checkV79],
    ['scripts/lib/validate-governance-review.js', 'ExternalRuntimePluginLifecycleGate'],
    ['scripts/lib/validate-governance-review.js', 'FunctionSourceFingerprintMatrixGate'],
    ['scripts/lib/validate-governance-review.js', 'RiskBasedValidationLadder'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/test-router/SKILL.md', 'coverageGateDecision'],
    ['skills/dev-testing/SKILL.md', '覆盖率门禁与风险分层验证'],
    ['skills/audit-project/SKILL.md', 'PE-6 测试覆盖与验证门禁'],
    ['skills/dev-plan-review/SKILL.md', 'PR-2 项目存在 coverage'],
    ['skills/report/SKILL.md', 'targeted/related/full gate'],
    ['instructions/10-dev.instructions.md', 'CoverageGateDecision / ExternalRuntimePluginLifecycleGate'],
    ['instructions/11-fix.instructions.md', 'CoverageGateDecision / ClusterEscalationGate'],
    ['instructions/12-audit.instructions.md', 'FunctionSourceFingerprintMatrixGate'],
    ['prompts/report-dev.prompt.md', 'ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate'],
    ['prompts/report-fix.prompt.md', 'FunctionSourceFingerprintMatrixGate / ClusterEscalationGate'],
    ['prompts/report-audit.prompt.md', 'CoverageGateDecision / RiskBasedValidationLadder'],
    ['README.md', 'coverage 与外部 runtime 生命周期验证'],
    ['website/docs/guide/development.md', '存在 coverage 阈值']
  ]) {
    mustInclude(file, needle)
  }

  const checkV80 = 'UserManualReviewScope'
  const missingProfileCorpus = collectActiveProfileCorpusIfAvailable(
    { existsSync: () => false }, path, '/clean-checkout/.devcodex', () => { throw new Error('missing Profile must not be read') }
  )
  if (missingProfileCorpus !== null) failures.push('checkV80 missing Profile corpus must degrade to null')
  const presentProfileCorpus = collectActiveProfileCorpusIfAvailable(
    { existsSync: () => true }, path, '/workspace/.devcodex', file => path.basename(file)
  )
  if (!presentProfileCorpus.includes('01-项目信息.md') || !presentProfileCorpus.includes('02-架构约束.md') || !presentProfileCorpus.includes('06-功能清单.md')) {
    failures.push('checkV80 present Profile corpus must include required and closed-loop feature sources')
  }
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-review.js', 'checkV80'],
    ['scripts/lib/validate-governance-review.js', checkV80],
    ['scripts/lib/validate-governance-review.js', 'DocsNavigationReviewMatrix'],
    ['scripts/lib/validate-governance-review.js', 'audit-user-manual'],
    ['scripts/lib/validate-governance-review.js', 'collectActiveProfileCorpusIfAvailable'],
    ['scripts/lib/validate-governance-control.js', 'activeProfileAvailable'],
    ['scripts/lib/validate-governance-control.js', 'active Profile unavailable'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['plugin.json', 'skills/audit-user-manual/SKILL.md'],
    ['skills/audit-user-manual/SKILL.md', 'UserManualReviewScope'],
    ['skills/audit-user-manual/SKILL.md', 'DocsNavigationReviewMatrix'],
    ['skills/audit-user-manual/SKILL.md', 'SidebarPageRoleMaterializationProbe'],
    ['skills/routing/SKILL.md', 'audit-user-manual'],
    ['skills/dev-docs/SKILL.md', 'audit-user-manual'],
    ['skills/audit-document/SKILL.md', 'audit-user-manual'],
    ['skills/audit-readme/SKILL.md', 'audit-user-manual'],
    ['skills/user-manual-authoring/SKILL.md', 'audit-user-manual'],
    ['skills/document-sync/SKILL.md', 'audit-user-manual'],
    ['skills/test-router/SKILL.md', 'userManualReview'],
    ['skills/report/SKILL.md', 'DocsNavigationReviewMatrix'],
    ['instructions.md', 'audit-user-manual'],
    ['instructions/01-common.instructions.md', 'audit-user-manual'],
    ['instructions/12-audit.instructions.md', 'audit-user-manual'],
    ['prompts/report-dev.prompt.md', 'DocsNavigationReviewMatrix'],
    ['prompts/report-fix.prompt.md', 'DocsNavigationReviewMatrix'],
    ['prompts/report-audit.prompt.md', 'audit-user-manual / UserManualReviewScope / DocsNavigationReviewMatrix'],
    ['README.md', '用户侧文档 review 聚合'],
    ['website/docs/index.md', `${skillCount} 个 Skills`],
    ['website/docs/intro/index.md', 'audit-user-manual'],
    ['website/docs/guide/development.md', 'audit-user-manual'],
    ['website/docs/specs/directory-structure.md', 'audit-user-manual']
  ]) {
    mustInclude(file, needle)
  }
  mustIncludeInChangelogs('V80')

  const checkV81 = 'spec-absorption'
  function classifyAbsorptionSample(sample) {
    const projectSpecific = /ServiceSpecReadGate|docs\/services\/<name>|单个业务项目|项目私有/.test(sample)
    const consumerProof = /DevCodex 当前消费者|targetOwner|跨工作流复用|宿主无关/.test(sample)
    if (projectSpecific && !consumerProof) return 'project-local'
    if (consumerProof) return 'absorb'
    return 'case-evidence-only'
  }
  for (const sample of [
    'ServiceSpecReadGate：服务开发进入编码前必须读取 docs/services/<name>/',
    '单个业务项目的 route/model/schema 命名规范'
  ]) {
    if (classifyAbsorptionSample(sample) === 'absorb') {
      failures.push(`spec-absorption negative sample was incorrectly classified as absorb: ${sample}`)
    }
  }
  if (classifyAbsorptionSample('跨工作流复用且已有 DevCodex 当前消费者和 targetOwner 的吸纳候选') !== 'absorb') {
    failures.push('spec-absorption positive sample did not classify as absorb')
  }
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-review.js', 'checkV81'],
    ['scripts/lib/validate-governance-review.js', 'spec-absorption execution skill sync checked'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/spec-absorption/SKILL.md', 'name: spec-absorption'],
    ['skills/spec-absorption/SKILL.md', 'CommonNormGeneralizationGate'],
    ['skills/spec-absorption/SKILL.md', 'AbsorptionCandidateConsumerProofGate'],
    ['skills/spec-absorption/SKILL.md', 'ServiceSpecReadGate'],
    ['skills/spec-absorption/SKILL.md', 'project-local'],
    ['skills/spec-absorption/SKILL.md', 'case-evidence-only'],
    ['plugin.json', 'skills/spec-absorption/SKILL.md'],
    ['skills/routing/SKILL.md', 'spec-absorption'],
    ['skills/spec-governance/SKILL.md', 'AbsorptionCandidateConsumerProofGate'],
    ['skills/test-router/SKILL.md', 'specAbsorption'],
    ['skills/report/SKILL.md', 'CommonNormGeneralizationGate'],
    ['skills/document-sync/SKILL.md', checkV81],
    ['skills/source-consumer-sync/SKILL.md', 'V81 规范吸纳执行同步面'],
    ['prompts/technical-design.prompt.md', 'projectSpecificResidue'],
    ['prompts/implementation-plan.prompt.md', 'DevCodex 当前消费者'],
    ['prompts/report-dev.prompt.md', checkV81],
    ['prompts/report-fix.prompt.md', 'AbsorptionCandidateConsumerProofGate'],
    ['prompts/report-audit.prompt.md', 'devcodexConsumerEvidence'],
    ['prompts/report-scenario-test.prompt.md', 'negativeExamples'],
    ['README.md', checkV81],
    ['README.md', 'ServiceSpecReadGate'],
    ['website/docs/index.md', `${skillCount} 个 Skills`],
    ['website/docs/intro/index.md', checkV81],
    ['website/docs/specs/directory-structure.md', checkV81],
    ['website/docs/guide/development.md', 'CommonNormGeneralizationGate'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V81']
  ]) {
    mustInclude(file, needle)
  }
  mustIncludeInChangelogs('V81')
  mustIncludeInChangelogs('CommonNormGeneralizationGate')

  const checkV82 = 'LatestAbsorptionExecutionPack'
  function classifyConfigNamespaceSample(sample) {
    const canonical = /canonical namespace|既有 namespace|extensions\.[a-z0-9_-]+|历史契约/.test(sample)
    const legacyRationale = /legacy alias|兼容窗口|迁移理由|例外理由/.test(sample)
    const topLevel = /top-level|顶层配置|顶层 config/.test(sample)
    if (topLevel && !legacyRationale) return 'missing-rationale'
    if (canonical || legacyRationale) return 'acceptable'
    return 'needs-review'
  }
  if (classifyConfigNamespaceSample('新增顶层 config.cache，未说明 namespace 或迁移依据') !== 'missing-rationale') {
    failures.push('ConfigCanonicalNamespaceGate negative sample was not rejected')
  }
  if (classifyConfigNamespaceSample('extensions.runtime.cache 使用 canonical namespace，并记录 legacy alias 兼容窗口') !== 'acceptable') {
    failures.push('ConfigCanonicalNamespaceGate positive sample was not accepted')
  }
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-review.js', 'checkV82'],
    ['scripts/lib/validate-governance-review.js', 'latest absorption execution pack sync checked'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/spec-absorption/SKILL.md', checkV82],
    ['skills/spec-absorption/SKILL.md', 'ConfigCanonicalNamespaceGate'],
    ['skills/spec-governance/SKILL.md', 'docs-semantics-examples'],
    ['skills/spec-governance/SKILL.md', 'derived-consumer-runtime'],
    ['skills/spec-governance/SKILL.md', 'feature-inventory-batch-evidence'],
    ['skills/dev-plan-review/SKILL.md', 'ProfileRuntimeContractSyncGate'],
    ['skills/test-router/SKILL.md', 'latestAbsorptionExecutionPack'],
    ['skills/dev-docs/SKILL.md', 'NegativeTranslationParityProbe'],
    ['skills/audit-document/SKILL.md', 'CallbackExampleScopeProbe'],
    ['skills/audit-readme/SKILL.md', 'DocsExampleTruthSurfaceGate'],
    ['skills/user-manual-authoring/SKILL.md', 'BehaviorSemanticDocsParityGate'],
    ['skills/audit-project/SKILL.md', 'DerivedMetricConsumerProbe'],
    ['skills/dev-testing/SKILL.md', 'DerivedConsumerFailureInjectionProbe'],
    ['skills/load-profile/SKILL.md', 'FeatureInventoryProfileGate'],
    ['skills/profile-bootstrap/SKILL.md', 'FeatureInventoryProfileGate'],
    ['skills/review-checklist/SKILL.md', 'BatchProgressCardGate'],
    ['skills/audit-requirements/SKILL.md', 'FeatureChecklistEvidenceMatrixGate'],
    ['skills/document-sync/SKILL.md', 'BatchEvidenceLedgerStateGate'],
    ['skills/report/SKILL.md', checkV82],
    ['prompts/technical-design.prompt.md', 'ConfigCanonicalNamespaceGate'],
    ['prompts/implementation-plan.prompt.md', 'V82'],
    ['prompts/implementation-progress.prompt.md', 'Progress Card'],
    ['prompts/report-dev.prompt.md', checkV82],
    ['prompts/report-fix.prompt.md', checkV82],
    ['prompts/report-audit.prompt.md', checkV82],
    ['prompts/report-scenario-test.prompt.md', checkV82],
    ['README.md', checkV82],
    ['website/docs/guide/development.md', checkV82],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V82']
  ]) {
    mustInclude(file, needle)
  }
  mustIncludeInChangelogs('V82')
  mustIncludeInChangelogs('LatestAbsorptionExecutionPack')
}

module.exports = { runSpecGovernanceReviewSuite }
