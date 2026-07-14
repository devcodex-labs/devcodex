'use strict'

const { buildGovernanceHelpers } = require('./validate-governance-helpers')

function buildGovernanceReviewChecks(ctx) {
  const {
    ROOT, ACTIVE_DEVCODEX_ROOT, RECENT_REQUIREMENT_ARTIFACT_DAYS,
    collectRecentBugArtifactIssues, collectRecentRequirementArtifactIssues,
    fs, path, execSync, read, err, mustInclude
  } = ctx
  const { collectChangelogSources, hasChangelogEvidence } = buildGovernanceHelpers(ctx)

  function checkV75() {
    const probeName = 'PromptLongGateListDriftProbe'
    const consumerFiles = [
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

    const driftClusters = [
      {
        label: 'cross-project learned guards long list',
        minHits: 8,
        needles: [
          'CodeTruthRequirementGate',
          'AdapterBenchmarkAttribution',
          'ProductRequirementTraceabilityGate',
          'WorkspaceDataAbsorptionScopeGate',
          'DatabaseRecordMigrationExportGate',
          'GeneratedSiteGate',
          'ArtifactLinkSetDedupeGate',
          'BenchmarkRegressionGuard',
          'V2FormalSolutionPackage'
        ]
      },
      {
        label: 'confirmed absorption full gate list',
        minHits: 8,
        needles: [
          'PublicSurfaceClosureGate',
          'UserManualRenderedFlowAndRealWorkflowProbe',
          'SampleIssueExpansionGate',
          'RequirementDimensionBindingGate',
          'SemanticLegacyRouteExposureGate',
          'ReferenceCodeTruthSamplingGate',
          'FrontendAsyncCacheRenderGate',
          'StrongestProfileSourceGate',
          'RouteNamespaceResponsibilityGate',
          'DocsThemeRuntimeVisualProbeGate'
        ]
      },
      {
        label: 'latest absorption full gate list',
        minHits: 10,
        needles: [
          'DatabaseRecordMigrationExportGate',
          'FrontendBrowserVerificationBudgetGate',
          'UserSelfVerificationOverrideGate',
          'FindingProbeMatrixGate',
          'MultiPhaseClosureGate',
          'GuardPolicyBypassMatrixGate',
          'SideEffectCompatibilityDocsGate',
          'ExecutableExampleTruthProbeGate',
          'VisualDeviationTypeGate',
          'OneOffRequirementScriptPlacementGate',
          'VerificationCommandSideEffectGate',
          'DesignFramePurposeClassificationGate',
          'RequirementPreConfirmGate',
          'PackageAdapterPreConfirmEvidenceGate'
        ]
      }
    ]

    function findDrift(line) {
      for (const cluster of driftClusters) {
        const hits = cluster.needles.filter(needle => line.includes(needle))
        if (hits.length >= cluster.minHits) return { cluster, hits }
      }
      return null
    }

    const negativeSamples = [
      driftClusters[0].needles.join('、'),
      driftClusters[1].needles.join('、'),
      driftClusters[2].needles.join('、')
    ]
    for (const sample of negativeSamples) {
      if (!findDrift(sample)) {
        err(`[V75] ${probeName} negative sample did not trigger drift detection`)
      }
    }
    const groupedSample = '按 GovernanceGateRegistry 分组记录 gateGroup / ownerSkill / validationRoute / skipReason，代表锚点包括 PublicSurfaceClosureGate、UserManualProductizationGate、ReviewAnchorMaterializationGate、FrontendAsyncCacheRenderGate、RemoteCIParityPushGate 与 DocsThemeRuntimeVisualProbeGate'
    if (findDrift(groupedSample)) {
      err(`[V75] ${probeName} incorrectly rejects grouped registry summary`)
    }

    for (const file of consumerFiles) {
      const lines = read(path.join(ROOT, file)).split(/\r?\n/)
      lines.forEach((line, index) => {
        const drift = findDrift(line)
        if (drift) {
          err(`[V75] ${probeName} detected ${drift.cluster.label} drift in ${file}:${index + 1} (${drift.hits.length} hits); use GovernanceGateRegistry/gateGroup instead`)
        }
      })
    }

    const probes = [
      { file: 'skills/spec-governance/SKILL.md', needles: [probeName, 'SCV 负向样例', 'GovernanceGateRegistry'] },
      { file: 'skills/source-consumer-sync/SKILL.md', needles: [probeName, 'V75', 'currentConsumers'] },
      { file: 'README.md', needles: [probeName, 'GovernanceGateRegistry'] },
      { file: 'website/docs/guide/development.md', needles: [probeName, 'GovernanceGateRegistry'] },
      { file: 'changelogs/releases/v1.11.28.md', needles: ['V75', probeName] },
      { file: 'scripts/lib/test-spec-governance-review.js', needles: ['checkV75', probeName] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]
    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V75] ${probeName} sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V75] prompt long gate list drift probe checked')
  }

  function checkV76() {
    const gate = 'ReviewEscapeRecordGate'
    const recordFields = [
      'escapedItem',
      'whyMissed',
      'missingDimensionOrProbe',
      'prevention',
      'checklistPatch',
      'rerunEvidence'
    ]
    const probes = [
      { file: 'skills/review-checklist/SKILL.md', needles: [gate, 'escapeRecords'].concat(recordFields).concat(['ledgerRoute']) },
      { file: 'skills/spec-governance/SKILL.md', needles: [gate, 'review-escape'].concat(recordFields) },
      { file: 'skills/test-router/SKILL.md', needles: [gate, 'whyMissed', 'prevention', 'rerunEvidence'] },
      { file: 'skills/report/SKILL.md', needles: [gate, 'whyMissed', 'prevention', 'checklistPatch', 'rerunEvidence'] },
      { file: 'prompts/technical-design.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/report-dev.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/report-fix.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/report-audit.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: [gate, 'escapedItem', 'rerunEvidence'] },
      { file: 'README.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'website/docs/guide/development.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'changelogs/releases/v1.11.28.md', needles: ['V76', gate, 'whyMissed'] },
      { file: 'scripts/lib/test-spec-governance-review.js', needles: ['checkV76', gate] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V76] review escape record drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V76] review escape record gate sync checked')
  }

  function checkV77() {
    const gate = 'NativeCommandExitCodeGate'

    function hasExitCodePropagation(script) {
      return [
        /\$LASTEXITCODE\b/,
        /\bprocess\.exit\s*\(/,
        /\bprocess\.exitCode\b/,
        /\bset\s+-e\b/,
        /\bpipefail\b/,
        /\|\|\s*exit\b/,
        /\bif\s*\[\s*\$[?]\s*-ne\s*0\s*\]/,
        /\bif\s*\(\s*\$LASTEXITCODE\s+-ne\s+0\s*\)/
      ].some(pattern => pattern.test(script))
    }

    function isFalseGreenNativeCommand(script) {
      return /\b(npm|git|node|curl)\b/.test(script) &&
        /\b(OK|success|passed)\b/i.test(script) &&
        !hasExitCodePropagation(script)
    }

    const negativeSamples = [
      'npm install ../pkg.tgz; Write-Host "OK"',
      'git push origin main; echo success'
    ]
    for (const sample of negativeSamples) {
      if (!isFalseGreenNativeCommand(sample)) {
        err(`[V77] ${gate} negative sample did not detect false-green native command: ${sample}`)
      }
    }

    const positiveSamples = [
      'npm install ../pkg.tgz; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Host "OK"',
      'set -euo pipefail; git push origin main; echo success'
    ]
    for (const sample of positiveSamples) {
      if (isFalseGreenNativeCommand(sample)) {
        err(`[V77] ${gate} incorrectly rejected exit-code guarded command: ${sample}`)
      }
    }

    const probes = [
      { file: 'skills/release-verification/SKILL.md', needles: [gate, 'command、shell、cwd、exitCode', '$LASTEXITCODE', 'auth/config 来源'] },
      { file: 'skills/audit-release/SKILL.md', needles: [gate, 'command/shell/cwd/exitCode'] },
      { file: 'skills/test-router/SKILL.md', needles: [gate, 'nativeCommandExitCode', 'command、shell、cwd、exitCode'] },
      { file: 'skills/report/SKILL.md', needles: [gate, 'command、shell、cwd、exitCode'] },
      { file: 'skills/spec-governance/SKILL.md', needles: [gate, '原生命令真实 exitCode'] },
      { file: 'skills/document-sync/SKILL.md', needles: [gate] },
      { file: 'prompts/technical-design.prompt.md', needles: [gate, '退出码证据设计'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: [gate, '真实 exitCode'] },
      { file: 'prompts/report-dev.prompt.md', needles: [gate, 'command/shell/cwd/exitCode'] },
      { file: 'prompts/report-fix.prompt.md', needles: [gate, 'command/shell/cwd/exitCode'] },
      { file: 'prompts/report-audit.prompt.md', needles: [gate, 'failed evidence exclusion'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: [gate] },
      { file: 'README.md', needles: [gate, '真实 command/shell/cwd/exitCode'] },
      { file: 'website/docs/guide/development.md', needles: [gate, '真实 command/shell/cwd/exitCode'] },
      { file: 'changelogs/releases/v1.11.28.md', needles: ['V77', gate, 'exitCode'] },
      { file: 'scripts/lib/test-spec-governance-review.js', needles: ['checkV77', gate] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V77] native command exit-code drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V77] native command exit-code gate sync checked')
  }

  function checkV78() {
    const gates = [
      'PostConfirmationReviewScopeGate',
      'DevelopmentDriftGate',
      'VerificationPlanMaterializationProbe',
      'AcceptedSuggestionRootCauseGate',
      'ChinesePrimaryExpressionGate',
      'SidebarPageRoleMaterializationProbe',
      'SidebarGroupSemanticModelProbe'
    ]

    const probes = [
      { file: 'instructions/01-common.instructions.md', needles: ['PostConfirmationReviewScopeGate', '轻量', '全面复审'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['PostConfirmationReviewScopeGate', 'PR-2~PR-7', 'review-checklist'] },
      { file: 'skills/review-checklist/SKILL.md', needles: ['PostConfirmationReviewScopeGate', '高风险', 'skipReason'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['DevelopmentDriftGate', 'allowedFirstBatch', 'blockedScope', 'driftTriggers'] },
      { file: 'skills/execution-contract/SKILL.md', needles: ['DevelopmentDriftGate', 'allowedFirstBatch', 'blockedScope', 'driftTriggers'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['VerificationPlanMaterializationProbe', 'SidebarPageRoleMaterializationProbe', 'SidebarGroupSemanticModelProbe'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['ChinesePrimaryExpressionGate', 'SidebarPageRoleMaterializationProbe', 'SidebarGroupSemanticModelProbe'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['ChinesePrimaryExpressionGate', 'SidebarPageRoleMaterializationProbe', 'SidebarGroupSemanticModelProbe', 'sidebarSemanticModel'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['ChinesePrimaryExpressionGate', 'SidebarPageRoleMaterializationProbe', 'SidebarGroupSemanticModelProbe'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['post-confirmation-review', 'development-drift', 'docs-ia-readability', 'AcceptedSuggestionRootCauseGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['postConfirmationReviewScope', 'developmentDrift', 'verificationPlanMaterialization', 'docsIaReadability'] },
      { file: 'skills/report/SKILL.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'DevelopmentDriftGate', 'VerificationPlanMaterializationProbe'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['DevelopmentDriftGate', 'VerificationPlanMaterializationProbe', 'SidebarPageRoleMaterializationProbe'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['PostConfirmationReviewScopeGate', 'DevelopmentDriftGate', 'ChinesePrimaryExpressionGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'VerificationPlanMaterializationProbe'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'VerificationPlanMaterializationProbe'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['AcceptedSuggestionRootCauseGate', 'DevelopmentDriftGate', 'SidebarGroupSemanticModelProbe'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['AcceptedSuggestionRootCauseGate', 'DevelopmentDriftGate', 'SidebarGroupSemanticModelProbe'] },
      { file: 'README.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'DevelopmentDriftGate', 'ChinesePrimaryExpressionGate'] },
      { file: 'website/docs/guide/development.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'DevelopmentDriftGate', 'ChinesePrimaryExpressionGate'] },
      { file: 'changelogs/releases/v1.11.28.md', needles: ['V78'].concat(gates) },
      { file: 'scripts/lib/test-spec-governance-review.js', needles: ['checkV78'].concat(gates) },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V78] review scope / drift / docs IA sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V78] review scope, development drift and docs IA gates checked')
  }

  function checkV79() {
    const gates = [
      'CoverageGateDecision',
      'ExternalRuntimePluginLifecycleGate',
      'ExternalRegistryLifecycleMatrixGate',
      'FunctionSourceFingerprintMatrixGate',
      'ClusterEscalationGate',
      'RiskBasedValidationLadder'
    ]

    const changelogFiles = ['changelogs/unreleased.md']
    const releasesDir = path.join(ROOT, 'changelogs', 'releases')
    if (fs.existsSync(releasesDir)) {
      for (const name of fs.readdirSync(releasesDir)) {
        if (/^v\d+\.\d+\.\d+\.md$/.test(name)) changelogFiles.push(`changelogs/releases/${name}`)
      }
    }
    const changelogCorpus = changelogFiles
      .map(file => read(path.join(ROOT, file)))
      .join('\n')

    const probes = [
      { file: 'skills/test-router/SKILL.md', needles: ['coverageGateDecision', 'externalRuntimePluginLifecycle', 'functionSourceFingerprint', 'riskBasedValidationLadder'].concat(gates) },
      { file: 'skills/dev-testing/SKILL.md', needles: ['覆盖率门禁与风险分层验证', '外部 runtime / plugin / registry 注入验证矩阵'].concat(gates) },
      { file: 'skills/audit-project/SKILL.md', needles: ['PE-6 测试覆盖与验证门禁'].concat(gates) },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['PR-2 项目存在 coverage', '函数源码 fingerprint 风险是否覆盖'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['CoverageGateDecision / ExternalRuntimePluginLifecycleGate', 'targeted/related/full gate'].concat(gates) },
      { file: 'instructions/10-dev.instructions.md', needles: ['CoverageGateDecision / ExternalRuntimePluginLifecycleGate', 'FunctionSourceFingerprintMatrixGate'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['CoverageGateDecision / ClusterEscalationGate', 'ExternalRuntimePluginLifecycleGate / FunctionSourceFingerprintMatrixGate'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['CoverageGateDecision', 'FunctionSourceFingerprintMatrixGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['CoverageGateDecision / RiskBasedValidationLadder', 'ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['CoverageGateDecision / RiskBasedValidationLadder', 'FunctionSourceFingerprintMatrixGate / ClusterEscalationGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['CoverageGateDecision / RiskBasedValidationLadder', 'ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate'] },
      { file: 'README.md', needles: ['coverage 与外部 runtime 生命周期验证'].concat(gates) },
      { file: 'website/docs/guide/development.md', needles: ['存在 coverage 阈值'].concat(gates) },
      { file: 'scripts/lib/test-spec-governance-review.js', needles: ['checkV79'].concat(gates) },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V79'].concat(gates) }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V79] coverage gate / external runtime lifecycle sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V79] coverage gate and external runtime lifecycle matrix checked')
  }

  function checkV80() {
    const gates = [
      'audit-user-manual',
      'UserManualReviewScope',
      'DocsNavigationReviewMatrix'
    ]
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const profileCorpus = [
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '01-项目信息.md')),
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '02-架构约束.md'))
    ].join('\n')

    const probes = [
      {
        file: 'skills/audit-user-manual/SKILL.md',
        needles: [
          'name: audit-user-manual',
          '项目文档',
          '菜单导航',
          'SidebarPageRoleMaterializationProbe',
          'DocsThemeRuntimeVisualProbeGate',
          'GeneratedSiteGate'
        ].concat(gates)
      },
      { file: 'plugin.json', needles: ['audit-user-manual', 'skills/audit-user-manual/SKILL.md'] },
      { file: 'skills/routing/SKILL.md', needles: ['audit-user-manual', '项目文档审查', '菜单导航'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['audit-user-manual', '项目文档', '菜单导航'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['audit-user-manual', '项目文档', '菜单导航'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['audit-user-manual', '项目文档设计', '菜单导航'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['audit-user-manual', '聚合审查'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['audit-user-manual', 'Profile', 'plugin.json', 'validate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['userManualReview', 'audit-user-manual', '项目文档审查'] },
      { file: 'skills/report/SKILL.md', needles: gates.concat(['pageRole/sidebar group', '生成站点或运行态验证证据']) },
      { file: 'instructions.md', needles: ['audit-user-manual', '项目文档 review'] },
      { file: 'instructions/01-common.instructions.md', needles: ['audit-user-manual', '项目文档 review'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['audit-user-manual', '项目文档 review', '菜单导航'] },
      { file: 'prompts/report-dev.prompt.md', needles: gates },
      { file: 'prompts/report-fix.prompt.md', needles: gates },
      { file: 'prompts/report-audit.prompt.md', needles: gates.concat(['文档设计', '菜单导航']) },
      { file: 'README.md', needles: ['76 个', 'audit-user-manual', '用户侧文档 review 聚合'] },
      { file: 'website/docs/index.md', needles: ['76 个 Skills', '用户侧文档 review 聚合'] },
      { file: 'website/docs/intro/index.md', needles: ['76 个按需触发', 'audit-user-manual'] },
      { file: 'website/docs/guide/development.md', needles: ['audit-user-manual', '菜单导航', 'sidebar'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['76 个', 'audit-user-manual', '用户侧文档 review'] },
      { file: 'active profile corpus', content: profileCorpus, needles: ['76', 'audit-user-manual'] },
      { file: 'scripts/lib/test-spec-governance-review.js', needles: ['checkV80'].concat(gates) },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V80'].concat(gates) }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V80] audit-user-manual aggregation sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V80] audit-user-manual aggregation skill sync checked')
  }

  function checkV81() {
    const skill = 'spec-absorption'
    const gates = [
      'CommonNormGeneralizationGate',
      'AbsorptionCandidateConsumerProofGate'
    ]

    function classifyAbsorptionSample(sample) {
      const projectSpecific = /ServiceSpecReadGate|docs\/services\/<name>|单个业务项目|项目私有/.test(sample)
      const consumerProof = /DevCodex 当前消费者|targetOwner|跨工作流复用|宿主无关/.test(sample)
      if (projectSpecific && !consumerProof) return 'project-local'
      if (consumerProof) return 'absorb'
      return 'case-evidence-only'
    }

    const negativeSamples = [
      'ServiceSpecReadGate：服务开发进入编码前必须读取 docs/services/<name>/',
      '单个业务项目的 route/model/schema 命名规范'
    ]
    for (const sample of negativeSamples) {
      if (classifyAbsorptionSample(sample) === 'absorb') {
        err(`[V81] ${skill} negative sample was incorrectly classified as absorb: ${sample}`)
      }
    }
    const positiveSample = '跨工作流复用且已有 DevCodex 当前消费者和 targetOwner 的吸纳候选'
    if (classifyAbsorptionSample(positiveSample) !== 'absorb') {
      err(`[V81] ${skill} positive sample did not classify as absorb`)
    }

    const profileCorpus = [
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '01-项目信息.md')),
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '02-架构约束.md'))
    ].join('\n')
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'skills/spec-absorption/SKILL.md', needles: ['name: spec-absorption', '.devcodex/*/data', 'ServiceSpecReadGate', 'project-local', 'case-evidence-only', 'targetOwner'].concat(gates) },
      { file: 'plugin.json', needles: ['spec-absorption', 'skills/spec-absorption/SKILL.md'] },
      { file: 'skills/routing/SKILL.md', needles: ['spec-absorption', '最新可吸纳', '仍需吸纳'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['spec-absorption', 'project-local', 'AbsorptionCandidateConsumerProofGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['specAbsorption', 'CommonNormGeneralizationGate', 'AbsorptionCandidateConsumerProofGate'] },
      { file: 'skills/report/SKILL.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'targetOwner'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'Concept Sync Map'] },
      { file: 'skills/source-consumer-sync/SKILL.md', needles: ['V81 规范吸纳执行同步面', 'spec-absorption', 'negativeSamples'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'projectSpecificResidue'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'DevCodex 当前消费者'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'targetOwner'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['spec-absorption', 'AbsorptionCandidateConsumerProofGate', 'targetOwner'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['spec-absorption', 'projectSpecificResidue', 'devcodexConsumerEvidence'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['spec-absorption', 'negativeExamples', 'validationRoute'] },
      { file: 'README.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'ServiceSpecReadGate', '76 个'] },
      { file: 'website/docs/index.md', needles: ['76 个 Skills', '规范吸纳执行'] },
      { file: 'website/docs/intro/index.md', needles: ['76 个按需触发的工作流技能', 'spec-absorption'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['扁平一级 Skill（76 个）', 'spec-absorption'] },
      { file: 'website/docs/guide/development.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'ServiceSpecReadGate'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['spec-absorption', 'V81'] },
      { file: 'active profile corpus', content: profileCorpus, needles: ['76', 'spec-absorption'] },
      { file: 'scripts/lib/test-spec-governance-review.js', needles: ['checkV81', 'spec-absorption', 'CommonNormGeneralizationGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'V81'] }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V81] spec absorption execution sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V81] spec-absorption execution skill sync checked')
  }

  function checkV82() {
    const gates = [
      'ConfigCanonicalNamespaceGate',
      'ProfileRuntimeContractSyncGate',
      'BehaviorSemanticDocsParityGate',
      'NegativeTranslationParityProbe',
      'DocsExampleTruthSurfaceGate',
      'CallbackExampleScopeProbe',
      'DerivedMetricConsumerProbe',
      'DerivedConsumerFailureInjectionProbe',
      'FeatureInventoryProfileGate',
      'FeatureChecklistEvidenceMatrixGate',
      'BatchEvidenceLedgerStateGate',
      'BatchProgressCardGate'
    ]

    function classifyConfigNamespaceSample(sample) {
      const canonical = /canonical namespace|既有 namespace|extensions\.[a-z0-9_-]+|历史契约/.test(sample)
      const legacyRationale = /legacy alias|兼容窗口|迁移理由|例外理由/.test(sample)
      const topLevel = /top-level|顶层配置|顶层 config/.test(sample)
      if (topLevel && !legacyRationale) return 'missing-rationale'
      if (canonical || legacyRationale) return 'acceptable'
      return 'needs-review'
    }

    if (classifyConfigNamespaceSample('新增顶层 config.cache，未说明 namespace 或迁移依据') !== 'missing-rationale') {
      err('[V82] ConfigCanonicalNamespaceGate negative sample was not rejected')
    }
    if (classifyConfigNamespaceSample('extensions.runtime.cache 使用 canonical namespace，并记录 legacy alias 兼容窗口') !== 'acceptable') {
      err('[V82] ConfigCanonicalNamespaceGate positive sample was not accepted')
    }

    const profileCorpus = [
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '01-项目信息.md')),
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '02-架构约束.md'))
    ].join('\n')
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'skills/spec-absorption/SKILL.md', needles: ['A1~A10 最新吸纳执行包', 'LatestAbsorptionExecutionPack'].concat(gates) },
      { file: 'skills/spec-governance/SKILL.md', needles: ['docs-semantics-examples', 'derived-consumer-runtime', 'feature-inventory-batch-evidence', 'A1~A10 最新吸纳执行包'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['ConfigCanonicalNamespaceGate', 'ProfileRuntimeContractSyncGate', 'LatestAbsorptionExecutionPack'] },
      { file: 'skills/test-router/SKILL.md', needles: ['latestAbsorptionExecutionPack'].concat(gates) },
      { file: 'skills/dev-docs/SKILL.md', needles: ['BehaviorSemanticDocsParityGate', 'NegativeTranslationParityProbe', 'DocsExampleTruthSurfaceGate', 'CallbackExampleScopeProbe'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['BehaviorSemanticDocsParityGate', 'NegativeTranslationParityProbe', 'DocsExampleTruthSurfaceGate', 'CallbackExampleScopeProbe'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['BehaviorSemanticDocsParityGate', 'NegativeTranslationParityProbe', 'DocsExampleTruthSurfaceGate', 'CallbackExampleScopeProbe'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['BehaviorSemanticDocsParityGate', 'NegativeTranslationParityProbe', 'DocsExampleTruthSurfaceGate', 'CallbackExampleScopeProbe'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['DerivedMetricConsumerProbe', 'DerivedConsumerFailureInjectionProbe'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['DerivedMetricConsumerProbe', 'DerivedConsumerFailureInjectionProbe'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['FeatureInventoryProfileGate', 'ProfileRuntimeContractSyncGate'] },
      { file: 'skills/profile-bootstrap/SKILL.md', needles: ['FeatureInventoryProfileGate'] },
      { file: 'skills/review-checklist/SKILL.md', needles: ['FeatureChecklistEvidenceMatrixGate', 'BatchEvidenceLedgerStateGate', 'BatchProgressCardGate', 'EvidenceLedger', 'Progress Card'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['FeatureChecklistEvidenceMatrixGate', 'BatchEvidenceLedgerStateGate', 'BatchProgressCardGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['A1~A10 最新吸纳执行包'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['LatestAbsorptionExecutionPack', 'DerivedMetricConsumerProbe', 'FeatureInventoryProfileGate', 'BatchEvidenceLedgerStateGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'ConfigCanonicalNamespaceGate', 'BatchProgressCardGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'V82', 'BatchEvidenceLedgerStateGate'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'EvidenceLedger', 'Progress Card'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'V82', 'DerivedMetricConsumerProbe'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'V82', 'FeatureInventoryProfileGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'V82', 'BatchEvidenceLedgerStateGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'DerivedConsumerFailureInjectionProbe', 'BatchProgressCardGate'] },
      { file: 'README.md', needles: ['LatestAbsorptionExecutionPack', 'A1~A10', 'V82'] },
      { file: 'website/docs/guide/development.md', needles: ['LatestAbsorptionExecutionPack', 'A1~A10', 'V82'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['A1~A10', 'LatestAbsorptionExecutionPack', 'V82'] },
      { file: 'active profile corpus', content: profileCorpus, needles: ['LatestAbsorptionExecutionPack', 'A1~A10', 'V82'] },
      { file: 'scripts/lib/test-spec-governance-review.js', needles: ['checkV82', 'LatestAbsorptionExecutionPack', 'ConfigCanonicalNamespaceGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['LatestAbsorptionExecutionPack', 'ConfigCanonicalNamespaceGate', 'V82'] }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V82] latest absorption execution pack sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V82] latest absorption execution pack sync checked')
  }

  // __FUNCTIONS__

  return { checkV75, checkV76, checkV77, checkV78, checkV79, checkV80, checkV81, checkV82 }
}

module.exports = { buildGovernanceReviewChecks }
