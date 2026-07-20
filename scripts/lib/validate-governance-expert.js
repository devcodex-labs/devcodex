'use strict'

const { buildGovernanceHelpers } = require('./validate-governance-helpers')

function buildGovernanceExpertChecks(ctx) {
  const {
    ROOT, ACTIVE_DEVCODEX_ROOT, RECENT_REQUIREMENT_ARTIFACT_DAYS,
    collectRecentBugArtifactIssues, collectRecentRequirementArtifactIssues,
    fs, path, execSync, read, err, mustInclude,
    isValidationDelegated = () => false
  } = ctx
  const { collectChangelogSources, hasChangelogEvidence } = buildGovernanceHelpers(ctx)
  const skillCount = JSON.parse(read(path.join(ROOT, 'plugin.json'))).skills.length

  function collectActiveProfileCorpus(names) {
    const files = names.map(name => path.join(ACTIVE_DEVCODEX_ROOT, 'profile', name))
    if (!files.every(file => fs.existsSync(file))) return null
    return files.map(file => read(file)).join('\n')
  }

  function appendActiveProfileProbe(probes, profileCorpus, needles, probeId) {
    if (profileCorpus !== null) probes.push({ file: 'active profile corpus', content: profileCorpus, needles })
    else console.log(`[${probeId}] active Profile corpus unavailable — repository consumers remain authoritative`)
  }

  function checkV83() {
    const gates = [
      'ProfileTierStandardGate',
      'ProfileLifecycleClassificationGate',
      'AllDevCodexProfileValidationGate',
      'ProfileGenerationContractGate',
      'FeatureInventorySchemaGate',
      'ProfileTierMigrationSafetyGate'
    ]

    function classifyProfileGenerationSample(sample) {
      const text = String(sample || '')
      if (/dry-run=true/.test(text) && /writes=[1-9]/.test(text)) return 'invalid-dry-run'
      if (/downgrade=true/.test(text) && !/allow-downgrade=true/.test(text)) return 'invalid-downgrade'
      if (/inventory=bullets/.test(text)) return 'invalid-inventory'
      if (/canonical=01\+06/.test(text)) return 'invalid-duplicate-canonical'
      if (gates.every(gate => text.includes(gate)) && /dry-run=true writes=0/.test(text) && /FeatureInventorySchemaV2/.test(text)) return 'contract-ready'
      return 'needs-review'
    }

    const validSample = `${gates.join(' ')} dry-run=true writes=0 FeatureInventorySchemaV2 canonical=06`
    if (classifyProfileGenerationSample(validSample) !== 'contract-ready') err('[V83] valid Profile generation contract sample must pass')
    if (classifyProfileGenerationSample('dry-run=true writes=2') !== 'invalid-dry-run') err('[V83] dry-run write sample must fail')
    if (classifyProfileGenerationSample('downgrade=true allow-downgrade=false') !== 'invalid-downgrade') err('[V83] implicit downgrade sample must fail')
    if (classifyProfileGenerationSample('inventory=bullets') !== 'invalid-inventory') err('[V83] bullet-only inventory sample must fail')
    if (classifyProfileGenerationSample('canonical=01+06') !== 'invalid-duplicate-canonical') err('[V83] duplicate canonical inventory sample must fail')

    const profileCorpus = collectActiveProfileCorpus([
      'README.md',
      '01-项目信息.md',
      '06-功能清单.md',
      '07-用户文档与契约规范.md'
    ])
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'scripts/validate-profile.js', needles: ['--profile-dir', '--workspace-profile', 'profile-lite', 'profile-standard', 'profile-closed-loop', 'profile tier missing', 'workspace fallback', 'conditional-required'].concat(gates) },
      { file: 'scripts/validate-all-profiles.js', needles: ['--workspace', '.devcodex', '--profile-dir', '--strict-warnings', 'checked=', 'warnings='] },
      { file: 'scripts/test-validate-profile.js', needles: ['profile-standard', 'profile-closed-loop', 'FeatureInventorySchemaV1', 'FeatureInventorySchemaV2', 'compatibleV1Root', 'invalid lifecycleState', 'standardLegacyRoot', 'standardBulletsRoot', 'emptyInventoryRoot', 'placeholderOnlyRoot', 'fakeSourceRoot', 'externalLegacyRoot', 'releaseStateConflictRoot', "releaseState: 'v1.0.0'", 'runValidateAll', 'checked=2'] },
      { file: 'scripts/test-cli-behavior.js', needles: ['--dry-run', '--allow-downgrade', 'files', 'semantic', 'forceOutput', 'safe downgrade retains higher-tier files', 'invalid existing Profile tier', 'default generation matrix must remain 5/8/9'] },
      { file: 'scripts/lib/test-spec-governance-expert.js', needles: ['checkV83', 'classifyProfileGenerationSample'].concat(gates) },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] },
      { file: 'package.json', needles: ['test:profile-all', 'node scripts/validate-all-profiles.js', 'scripts/validate-all-profiles.js'] },
      { file: 'mcp/profile-contract.js', needles: ['PROFILE_GENERATION_CONTRACT', 'FeatureInventorySchemaV1', 'FeatureInventorySchemaV2', 'projectFeatureInventoryState', 'compareProfileTiers', 'updateProfileTierDeclaration', 'inspectFeatureInventoryDocument'] },
      { file: 'scripts/lib/profile-bootstrap-utils.js', needles: ['recommendProfileTier', 'FeatureInventorySchemaV2', 'sourceEvidence', 'lifecycleState', 'evidenceRefs'] },
      { file: 'scripts/lib/cli-maintenance-commands.js', needles: ['profile plan', '--dry-run', '--allow-downgrade', 'refusing profile downgrade', 'recommended tier'] },
      { file: 'instructions/01a-profile-loading.instructions.md', needles: ['ProfileGenerationContractGate', 'FeatureInventorySchemaV2', '兼容读取', '06-功能清单.md'] },
      { file: 'skills/dev-init/SKILL.md', needles: ['ProfileGenerationContractGate', 'profile plan', '--allow-downgrade'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['profile-lite', 'profile-standard', 'profile-closed-loop', 'conditional-required'].concat(gates) },
      { file: 'skills/profile-bootstrap/SKILL.md', needles: ['profile plan', 'profile-lite', 'profile-standard', 'profile-closed-loop', 'FeatureInventorySchemaV2', '兼容读取 V1', 'FeatureInventoryProfileGate'].concat(gates) },
      { file: 'prompts/project-profile.prompt.md', needles: ['ProfileGenerationContractGate', 'FeatureInventorySchemaV2', '事实来源', '发布状态', '生命周期状态', '证据引用'] },
      { file: 'skills/test-router/SKILL.md', needles: ['profileTierValidation', 'allDevCodexProfileValidation'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['ProfileTierValidation', 'AllDevCodexProfileValidation'].concat(gates) },
      { file: 'README.md', needles: ['profile plan', 'profile-lite', 'profile-standard', 'profile-closed-loop', 'FeatureInventorySchemaV2', '兼容读取 V1', '5 / 8 / 9', 'AllDevCodexProfileValidationGate'].concat(gates) },
      { file: 'website/docs/guide/profile.md', needles: ['profile plan', '--dry-run', '--allow-downgrade', 'FeatureInventorySchemaV2', '兼容读取 V1', '5 / 8 / 9', 'defaultGeneratedFiles', 'requiredFiles'].concat(gates) },
      { file: 'website/docs/guide/development.md', needles: ['profile-lite', 'profile-standard', 'profile-closed-loop', 'AllDevCodexProfileValidationGate'].concat(gates) },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V83'].concat(gates) }
    ]
    appendActiveProfileProbe(probes, profileCorpus, ['profile-closed-loop', '06-功能清单', '07-用户文档与契约规范', 'FeatureInventorySchemaV2', '证据状态', '稳定基线', '活文档'].concat(gates), 'V83')

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V83] profile tier / all workspace profile validation sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    if (isValidationDelegated('profile-governance')) {
      console.log('[V83] profile-governance executable suite delegated to validation DAG; static contract probes retained')
    } else {
      try {
        execSync('node scripts/test-validate-profile.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
      } catch (e) {
        const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
        err(`[V83] test-validate-profile failed${detail ? `: ${detail}` : ''}`)
      }
    }

    if (isValidationDelegated('cli-behavior')) {
      console.log('[V83] cli-behavior executable suite delegated to validation DAG; static contract probes retained')
    } else {
      try {
        execSync('node scripts/test-cli-behavior.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
      } catch (e) {
        const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
        err(`[V83] test-cli-behavior failed${detail ? `: ${detail}` : ''}`)
      }
    }

    console.log('[V83] Profile generation contract, migration safety and workspace validation sync checked')
  }

  function checkV84() {
    const gates = [
      'ExpertOutputQualityGate',
      'ProductionRecommendedPathGate',
      'FrameworkNativeCapabilityFirstGate',
      'FixtureBoundaryDisclosureGate',
      'AntiPatternContrastGate',
      'ExpertEvidenceMatrixGate',
      'OperationExplanationContractV1',
      'ResponseProvenanceClosureGate',
      'CodeTruthEvidenceMatrixGate',
      'SolutionFitAgainstRepoGate',
      'UniqueRecommendationBeforeConfirmGate',
      'NoPreferenceMenuAfterConvergenceGate'
    ]

    const profileCorpus = collectActiveProfileCorpus([
      '01-项目信息.md',
      '02-架构约束.md',
      '06-功能清单.md'
    ])
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const negative = 'permission-core-auth fixture 通过在每个 route 都重复 middlewares 和 auth 资源配置证明底层能力可用。'
    const positive = '生产推荐路径应优先使用框架原生能力和项目既有 helper；fixtureBoundary 只说明 mock/demo 验证边界，antiPattern/evidenceMatrix 标出每个 route 重复声明不是推荐写法。'
    if (classifyExpertOutputSample(negative) !== 'misleading-fixture') {
      err('[V84] negative fixture sample must be classified as misleading-fixture')
    }
    if (classifyExpertOutputSample(positive) !== 'expert-quality') {
      err('[V84] positive expert sample must be classified as expert-quality')
    }
    if (classifyOperationExplanationSample('operationId userGoal preconditions input stateEffect resultShape resultSource failureSemantics nextAction evidence') !== 'operation-ready') {
      err('[V84] complete operation explanation sample must pass')
    }
    if (classifyOperationExplanationSample('operationId userGoal input resultShape nextAction') !== 'operation-incomplete') {
      err('[V84] incomplete operation explanation sample must fail')
    }
    if (classifyCodeTruthRecommendationSample('CodeTruthEvidenceMatrixGate repoPath symbol currentBehavior evidence negativeProbe gap SolutionFitAgainstRepoGate reusePoint consumer rollback statusQuoCost UniqueRecommendationBeforeConfirmGate recommended=1 alternatives=2 NoPreferenceMenuAfterConvergenceGate auto=true') !== 'recommendation-ready') {
      err('[V84] code truth and unique recommendation positive sample must pass')
    }
    if (classifyCodeTruthRecommendationSample('CodeTruthEvidenceMatrixGate repoPath currentBehavior evidence UniqueRecommendationBeforeConfirmGate recommended=2') !== 'multiple-recommendations') {
      err('[V84] multiple recommendation sample must fail')
    }
    if (classifyCodeTruthRecommendationSample('CodeTruthEvidenceMatrixGate repoPath currentBehavior evidence UniqueRecommendationBeforeConfirmGate recommended=1') !== 'missing-code-truth-fields') {
      err('[V84] missing code truth fields sample must fail')
    }

    const probes = [
      { file: 'skills/expert-output-quality/SKILL.md', needles: ['name: expert-output-quality', 'description:', 'roleBaseline', 'productionRecommendedPath', 'frameworkNativeCapability', 'fixtureBoundary', 'antiPatternContrast', 'evidenceMatrix'].concat(gates) },
      { file: 'plugin.json', needles: ['expert-output-quality', 'skills/expert-output-quality/SKILL.md'] },
      { file: 'skills/routing/SKILL.md', needles: ['expert-output-quality', '不专业', '像初级', '示例误导'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['expert-output-quality'].concat(gates) },
      { file: 'skills/spec-absorption/SKILL.md', needles: ['ExpertOutputQualityGate', 'ProductionRecommendedPathGate', 'FrameworkNativeCapabilityFirstGate'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['CodeTruthEvidenceMatrixGate', 'UniqueRecommendationBeforeConfirmGate'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['ExpertOutputQualityGate', 'fixture/mock/demo', 'evidenceMatrix', 'SolutionFitAgainstRepoGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['ExpertOutputQualityGate', 'ProductionRecommendedPathGate', 'fixture/mock/demo/legacy', 'OperationExplanationContractV1'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['expertOutputQualityEvidence', 'expert-output-quality', 'FixtureBoundaryDisclosureGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['ExpertOutputQualityGate', 'fixture/mock/demo'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['ExpertOutputQualityGate', '生产推荐路径'] },
      { file: 'skills/audit-user-manual/SKILL.md', needles: ['expert-output-quality', '专家型产物质量'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['ExpertOutputQualityGate', '不专业', '像初级'] },
      { file: 'skills/audit-tech-design/SKILL.md', needles: ['ExpertOutputQualityGate', '生产推荐路径'] },
      { file: 'skills/test-router/SKILL.md', needles: ['expertOutputQuality', 'V84'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['ExpertOutputQualityGate', 'V84', '不得只写“已优化表述”', 'OperationExplanationContractV1', 'CodeTruthEvidenceMatrixGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['ExpertOutputQualityGate', 'fixture/mock/demo 边界', 'CodeTruthEvidenceMatrixGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ExpertOutputQualityGate', 'V84/targeted probe', 'SolutionFitAgainstRepoGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ExpertOutputQualityGate', 'V84', 'OperationExplanationContractV1'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ExpertOutputQualityGate', 'V84'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ExpertOutputQualityGate', 'V84'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ExpertOutputQualityGate', 'V84'] },
      { file: 'README.md', needles: [`${skillCount} 个`, 'expert-output-quality', 'V84', 'ExpertOutputQualityGate'] },
      { file: 'website/docs/index.md', needles: [`${skillCount} 个 Skills`, 'expert-output-quality'] },
      { file: 'website/docs/intro/index.md', needles: [`${skillCount} 个按需触发`, 'expert-output-quality'] },
      { file: 'website/docs/specs/directory-structure.md', needles: [`扁平一级 Skill（${skillCount} 个）`, 'expert-output-quality'] },
      { file: 'website/docs/guide/development.md', needles: ['expert-output-quality', 'ExpertOutputQualityGate', 'V84'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V84', 'expert-output-quality', 'ExpertOutputQualityGate'] },
      { file: 'scripts/lib/test-spec-governance-expert.js', needles: ['checkV84', 'classifyExpertOutputSample', 'ExpertOutputQualityGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V84', 'expert-output-quality', 'ExpertOutputQualityGate'] }
    ]
    appendActiveProfileProbe(probes, profileCorpus, ['78', 'expert-output-quality', 'ExpertOutputQualityGate'], 'V84')

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V84] expert output quality skill sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V84] expert output quality skill sync checked')
  }

  function checkV85() {
    const skillMap = [
      ['product-strategy', 'ProductStrategyOwnerGate', ['targetUser', 'problemValue', 'priorityTradeoff', 'scopeBoundary', 'successSignals', 'riskDecision', 'evidenceMatrix']],
      ['developer-experience-architecture', 'DeveloperExperienceArchitectureGate', ['developerPersona', 'firstSuccessPath', 'integrationSteps', 'exampleTruth', 'errorExperience', 'migrationPath', 'docsEntryPoints']],
      ['ux-interaction-architecture', 'UxInteractionArchitectureGate', ['taskFlow', 'informationArchitecture', 'stateFeedback', 'emptyErrorRecovery', 'interactionCost', 'accessibilityTouchpoints']],
      ['frontend-architecture', 'FrontendArchitectureOwnerGate', ['renderingStrategy', 'stateModel', 'asyncCachePolicy', 'runtimeConfig', 'i18nSseHandling', 'blankPagePrevention', 'verificationRoute']],
      ['backend-domain-architecture', 'BackendDomainArchitectureGate', ['domainLanguage', 'boundedContext', 'workflowInvariants', 'permissionModel', 'transactionConsistency', 'idempotencyCompatibility']],
      ['production-readiness-sre', 'ProductionReadinessSreGate', ['observabilityPlan', 'capacityAssumption', 'failureModes', 'rollbackPlan', 'runbookEntry', 'releaseRisk', 'operationalEvidence']],
      ['api-contract-architecture', 'ApiContractArchitectureGate', ['consumerSurface', 'contractInventory', 'versionCompatibility', 'errorModel', 'idempotencyPagination', 'sdkDocsImpact', 'evidenceMatrix']],
      ['external-integration-architecture', 'ExternalIntegrationArchitectureGate', ['providerBoundary', 'authCallbackModel', 'quotaRetryPolicy', 'webhookIdempotency', 'failureDegradation', 'lockInExitPlan', 'evidenceMatrix']],
      ['platform-ecosystem-architecture', 'PlatformEcosystemArchitectureGate', ['hostSurfaceMatrix', 'extensionPointContract', 'capabilityDiscovery', 'compatibilityMatrix', 'migrationPath', 'releaseDistributionImpact', 'evidenceMatrix']],
      ['ai-agent-system-architecture', 'AiAgentSystemArchitectureGate', ['intentRouting', 'toolPermissionBoundary', 'contextMemoryModel', 'stateMachineHandoff', 'observabilityReplay', 'humanInLoopBoundary', 'evidenceMatrix']],
      ['data-architecture', 'DataArchitectureGate', ['dataModel', 'schemaMigration', 'queryIndexPlan', 'lifecycleRetention', 'dataQuality', 'analyticsConsumer', 'evidenceMatrix']],
      ['security-threat-modeling', 'SecurityThreatModelingGate', ['trustBoundary', 'threatScenario', 'permissionAbuseCase', 'secretPolicy', 'auditLogging', 'mitigationVerification', 'evidenceMatrix']],
      ['quality-strategy', 'QualityStrategyGate', ['riskModel', 'testPyramid', 'acceptanceMatrix', 'regressionScope', 'coverageGate', 'releaseConfidence', 'evidenceMatrix']],
      ['design-system-architecture', 'DesignSystemArchitectureGate', ['designTokens', 'componentVariantModel', 'themeConsistency', 'accessibilityI18nBoundary', 'figmaCodeSync', 'adoptionGovernance', 'evidenceMatrix']],
      ['accessibility-i18n', 'AccessibilityI18nGate', ['userNeedsMatrix', 'keyboardFocusModel', 'screenReaderSemantics', 'localeContentModel', 'rtlFormatting', 'runtimeVerification', 'fallbackRecovery', 'evidenceMatrix']],
      ['growth-analytics', 'GrowthAnalyticsGate', ['growthQuestion', 'metricTaxonomy', 'eventInstrumentation', 'funnelRetentionModel', 'experimentDesign', 'privacyConsentBoundary', 'decisionLoop', 'evidenceMatrix']],
      ['business-model-review', 'BusinessModelReviewGate', ['valueExchange', 'revenueCostModel', 'pricingPackaging', 'marketSegmentChannel', 'operationalRisk', 'sustainabilityTco', 'decisionBoundary', 'evidenceMatrix']]
      ,['distributed-systems-architecture', 'DistributedSystemsArchitectureGate', ['consistencyModel', 'deliverySemantics', 'orderingPolicy', 'idempotencyModel', 'retryBudget', 'compensationPlan', 'partitionFailureMatrix', 'backpressurePlan']]
      ,['performance-engineering', 'PerformanceEngineeringGate', ['workloadModel', 'performanceBudget', 'benchmarkProtocol', 'profilingEvidence', 'bottleneckAttribution', 'capacityModel', 'regressionThresholds']]
      ,['privacy-compliance-architecture', 'PrivacyComplianceArchitectureGate', ['dataClassificationMap', 'purposeConsentMatrix', 'retentionDeletionPolicy', 'residencyBoundary', 'dataSubjectRightsFlow', 'privacyAuditEvidence']]
      ,['ai-evaluation-engineering', 'AiEvaluationEngineeringGate', ['evaluationDatasetManifest', 'goldenCaseSet', 'metricRubric', 'judgeCalibration', 'varianceReport', 'costLatencyQualityFrontier', 'regressionDecision']]
    ]
    const skillNames = skillMap.map(([name]) => name)
    const gates = skillMap.map(([, gate]) => gate)

    const sampleExpectations = [
      ['需要定义目标用户、用户价值、优先级取舍和成功指标', 'product-strategy'],
      ['CLI quick start 应覆盖第一次成功、错误信息和迁移路径', 'developer-experience-architecture'],
      ['详情返回后要保留任务流、状态反馈、空态和错误恢复', 'ux-interaction-architecture'],
      ['首页和详情必须旧数据先显示、异步缓存刷新和 stale-while-revalidate', 'frontend-architecture'],
      ['权限模型、领域语言、事务一致性和幂等兼容需要后端领域架构', 'backend-domain-architecture'],
      ['发布前需要可观测性、容量假设、泄漏风险、回滚和运行手册', 'production-readiness-sre'],
      ['public API 契约要冻结错误模型、分页过滤、SDK 文档和 consumerSurface', 'api-contract-architecture'],
      ['第三方 OAuth Webhook 接入要定义配额、重试、供应商锁定和 providerBoundary', 'external-integration-architecture'],
      ['CLI Hook 多宿主插件扩展点要维护兼容矩阵和 hostSurfaceMatrix', 'platform-ecosystem-architecture'],
      ['Agent 路由、工具调用权限、上下文记忆和人机协作边界需要专门建模', 'ai-agent-system-architecture'],
      ['数据模型、迁移、索引、生命周期、数据质量和 analyticsConsumer 需要数据架构', 'data-architecture'],
      ['威胁建模要覆盖信任边界、越权、密钥策略、审计和 mitigation 验证', 'security-threat-modeling'],
      ['质量策略要绑定测试金字塔、验收矩阵、覆盖率、回归范围和发布信心', 'quality-strategy'],
      ['设计系统要定义 Token、组件变体、主题、Figma 同步和设计治理', 'design-system-architecture'],
      ['文档站和表单要覆盖无障碍、键盘焦点、屏幕阅读器、国际化和 RTL 验证', 'accessibility-i18n'],
      ['增长漏斗需要定义埋点、留存、实验、转化指标和 metricTaxonomy', 'growth-analytics'],
      ['商业模式审查要覆盖定价、套餐、付费路径、成本收益和 sustainabilityTco', 'business-model-review']
      ,['消息队列要冻结交付语义、消息顺序、分区故障和 partitionFailureMatrix', 'distributed-systems-architecture']
      ,['性能预算必须有可信基准、profiling、瓶颈归因和 regressionThresholds', 'performance-engineering']
      ,['个人信息要定义数据驻留、保留删除、主体权利和 dataSubjectRightsFlow', 'privacy-compliance-architecture']
      ,['模型评测需要黄金集、Judge 校准、方差报告和 judgeCalibration', 'ai-evaluation-engineering']
    ]
    for (const [sample, expected] of sampleExpectations) {
      const actual = classifyExpertOwnerSample(sample)
      if (actual !== expected) {
        err(`[V85] expert owner classifier expected ${expected} but got ${actual}: ${sample}`)
      }
    }

    const profileCorpus = collectActiveProfileCorpus([
      '01-项目信息.md',
      '02-架构约束.md',
      '06-功能清单.md'
    ])
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'plugin.json', needles: skillNames.map(name => `skills/${name}/SKILL.md`) },
      { file: 'skills/routing/SKILL.md', needles: skillNames.concat(['ExpertOwnerSkillGate', '产品策略', '开发者体验', 'UX 交互', '前端架构', '后端领域架构', '生产可用性']) },
      { file: 'skills/spec-governance/SKILL.md', needles: ['expert-owner-skills', 'ExpertOwnerSkillGate'].concat(skillNames).concat(gates) },
      { file: 'skills/spec-absorption/SKILL.md', needles: ['ExpertOwnerSkillGate'].concat(skillNames) },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['ExpertOwnerSkillGate', 'ownerSkill', 'triggerReason', 'requiredFields', 'V85'] },
      { file: 'skills/test-router/SKILL.md', needles: ['expertOwnerSkills', 'ExpertOwnerSkillGate', 'V85'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['ExpertOwnerSkillGate', '21 个专家 Owner Skill', 'V85'].concat(gates) },
      { file: 'prompts/technical-design.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85/targeted probe'].concat(skillNames) },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85-targeted probe'].concat(skillNames) },
      { file: 'prompts/report-dev.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'prompts/report-fix.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'prompts/report-audit.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(gates) },
      { file: 'README.md', needles: [`${skillCount} 个`, '21 个专家 Owner Skill', 'ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'website/docs/index.md', needles: [`${skillCount} 个 Skills`, '专家 Owner Skill'] },
      { file: 'website/docs/intro/index.md', needles: [`${skillCount} 个按需触发`, '专家 Owner Skill'] },
      { file: 'website/docs/specs/directory-structure.md', needles: [`扁平一级 Skill（${skillCount} 个）`, 'ExpertOwnerSkillGate'].concat(skillNames) },
      { file: 'website/docs/guide/development.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V85', 'ExpertOwnerSkillGate'].concat(skillNames) },
      { file: 'scripts/lib/test-spec-governance-expert.js', needles: ['checkV85', 'classifyExpertOwnerSample', 'ExpertOwnerSkillGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V85', 'ExpertOwnerSkillGate'].concat(skillNames) }
    ]
    appendActiveProfileProbe(probes, profileCorpus, ['78', '21 个专家 Owner Skill', 'ExpertOwnerSkillGate', 'V85'].concat(skillNames), 'V85')

    for (const [name, gate, fields] of skillMap) {
      probes.push({
        file: `skills/${name}/SKILL.md`,
        needles: [`name: ${name}`, 'description:', gate, '输出字段', '反模式'].concat(fields)
      })
    }

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V85] expert owner skill sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V85] expert owner skill sync checked')
  }

  function checkV86() {
    const gate = 'MemoryCannotSatisfyBootstrapGate'
    const negative = '开启 Codex Memories 后可跳过 Profile、tasks、reports 读取，并把模型记忆作为验证证据。'
    const positive = 'Codex Memories 只作为 navigation-hint，仍读取 Profile、SUMMARY、today tasks、reports、review checklist 和源码 / 文档真相源。'
    if (classifyMemoryBootstrapSample(negative) !== 'invalid-memory-substitute') {
      err('[V86] negative memory bootstrap sample must be invalid-memory-substitute')
    }
    if (classifyMemoryBootstrapSample(positive) !== 'file-truth-required') {
      err('[V86] positive memory bootstrap sample must be file-truth-required')
    }

    const profileCorpus = collectActiveProfileCorpus([
      '01-项目信息.md',
      '06-功能清单.md',
      '07-用户文档与契约规范.md'
    ])
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'skills/load-profile/SKILL.md', needles: [gate, 'Memories', 'Profile', 'Agent SUMMARY', 'report / review checklist', '不能把 Memories'] },
      { file: 'skills/memory/SKILL.md', needles: [gate, 'navigation-hint', 'Profile', 'daily tasks', 'review checklist'] },
      { file: 'skills/test-router/SKILL.md', needles: ['memoryCannotSatisfyBootstrap', gate, 'V86/targeted probe'] },
      { file: 'skills/report/SKILL.md', needles: [gate, 'navigation-hint', 'V86/targeted probe'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['memory-bootstrap', gate, 'navigation-hint'] },
      { file: 'skills/spec-absorption/SKILL.md', needles: [gate, 'validate V86'] },
      { file: 'README.md', needles: [gate, 'V86', 'navigation-hint'] },
      { file: 'website/docs/index.md', needles: [gate, 'navigation-hint'] },
      { file: 'website/docs/intro/index.md', needles: [gate, 'navigation-hint'] },
      { file: 'website/docs/guide/development.md', needles: [gate, 'V86'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: [gate, 'V86'] },
      { file: 'scripts/lib/test-spec-governance-expert.js', needles: ['checkV86', 'classifyMemoryBootstrapSample', gate] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: [gate, 'V86'] }
    ]
    appendActiveProfileProbe(probes, profileCorpus, [gate, 'V86'], 'V86')

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V86] memory bootstrap truth source sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V86] memory bootstrap truth source sync checked')
  }

  function checkV87() {
    const classifyRepairContractSample = sample => {
      if (/没有修复目标|仅讨论模型|只讨论模型/.test(sample)) return 'not-repair'
      const repairIntent = /repair task|修复|Bug|缺陷|回归|安全问题|规范缺口|审查 finding|不正确行为/i.test(sample)
      if (!repairIntent) return 'not-repair'

      const fullRisk = /P0|P1|安全问题|控制面|公共 API|Schema|config|≥5|多批次|角色交接|发布|high-risk/i.test(sample)
      const lightFields = ['problemAnchor', 'expectedBehavior', 'acceptanceEvidence', 'decisionAcceptanceOwner', 'allowedPaths', 'validationRoute', 'rollbackTrigger', 'executionVerificationOwner']
      const fullFields = ['auditSnapshot', 'approvedFindingIds', 'evidencePacket', 'roleAssignments', 'acceptanceMatrix', 'authorizationEvidence', 'allowedPaths', 'blockedScope', 'batchPlan', 'findingToPatchMap', 'regressionMatrix', 'handoffIntegrity', 'independentReReview', 'rollbackPlan']
      const hasAll = fields => fields.every(field => sample.includes(field))

      if (fullRisk) return hasAll(fullFields) ? 'full-contract-ready' : 'invalid-full-contract'
      return hasAll(lightFields) ? 'light-contract-ready' : 'invalid-light-contract'
    }

    const light = '低风险 Bug problemAnchor expectedBehavior acceptanceEvidence decisionAcceptanceOwner allowedPaths validationRoute rollbackTrigger executionVerificationOwner'
    const full = 'P0 控制面修复 auditSnapshot approvedFindingIds evidencePacket roleAssignments acceptanceMatrix authorizationEvidence allowedPaths blockedScope batchPlan findingToPatchMap regressionMatrix handoffIntegrity independentReReview rollbackPlan'
    if (classifyRepairContractSample(light) !== 'light-contract-ready') err('[V87] complete lightweight repair contract sample must pass')
    if (classifyRepairContractSample('低风险 Bug 只有问题描述') !== 'invalid-light-contract') err('[V87] incomplete lightweight repair contract sample must fail')
    if (classifyRepairContractSample(full) !== 'full-contract-ready') err('[V87] complete full repair contract sample must pass')
    if (classifyRepairContractSample('P1 安全问题 allowedPaths validationRoute') !== 'invalid-full-contract') err('[V87] incomplete full repair contract sample must fail')
    if (classifyRepairContractSample('讨论 Sol Ultra 跨模型协作，没有修复目标') !== 'not-repair') err('[V87] model-only sample must not trigger repair contract')

    const probes = [
      { file: 'skills/execution-contract/SKILL.md', needles: ['DualLayerRepairCollaborationContract', 'lightweight', 'findingToPatchMap', 'handoffIntegrity', 'independentReReview', '禁止 `executing→accepted`'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['repair-collaboration', 'execution-contract', '模型名称'] },
      { file: 'skills/test-router/SKILL.md', needles: ['repairCollaboration', 'not-repair', 'independent re-review'] },
      { file: 'skills/report/SKILL.md', needles: ['RepairCollaborationContract', 'authorizationEvidence', '模型名称'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['repair-collaboration', 'repairCollaboration', 'findingToPatchMap'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['RepairCollaborationContract', 'independentReReview'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['RepairCollaborationContract', 'contractState'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['RepairCollaborationContract', 'authorizationEvidence'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['RepairCollaborationContract', '模型名称'] },
      { file: 'README.md', needles: ['模型无关双层修复协作契约', 'lightweight', 'independentReReview'] },
      { file: 'website/docs/guide/development.md', needles: ['repair-collaboration', 'findingToPatchMap', 'independentReReview'] },
      { file: 'website/docs/intro/index.md', needles: ['双层修复协作契约', '模型名称'] },
      { file: 'scripts/lib/test-spec-governance-expert.js', needles: ['checkV87', 'classifyRepairContractSample', 'not-repair'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) err(`[V87] repair collaboration contract sync in ${probe.file}: missing "${needle}"`)
      }
    }

    console.log('[V87] repair collaboration contract sync checked')
  }

  function checkV88() {
    const classifyProfileTruthSample = sample => {
      if (/低风险单文件/.test(sample) && /N\/A/.test(sample) && /skipReason/.test(sample)) return 'n-a-ready'
      const isAudit = /\baudit\b|审查/.test(sample)
      const triggered = isAudit || /项目级 analyze|ProfileTruthReconciliationGate/.test(sample)
      if (!triggered) return 'not-triggered'
      const fields = ['profileTrustState', 'profileClaim', 'actualSources', 'status', 'conclusionAuthority', 'correctionRoute']
      if (!fields.every(field => sample.includes(field))) return 'invalid-matrix'
      if (/stale-profile/.test(sample) && /conclusionAuthority=profile|Profile覆盖代码|以Profile为准/.test(sample)) return 'invalid-authority'
      if (/直接修改Profile|sourceMutation=true/.test(sample)) return 'invalid-readonly'
      if (isAudit && !/full/.test(sample)) return 'invalid-audit-mode'
      return isAudit ? 'full-ready' : 'targeted-ready'
    }

    const targeted = '项目级 analyze ProfileTruthReconciliationGate targeted profileTrustState=drift-detected profileClaim actualSources status=stale-profile conclusionAuthority=code-config-runtime correctionRoute=separate-dev-fix'
    const full = 'audit 审查 full PFresh-1~PFresh-6 profileTrustState=aligned profileClaim actualSources status=aligned conclusionAuthority=actualSources correctionRoute=none'
    if (classifyProfileTruthSample(targeted) !== 'targeted-ready') err('[V88] targeted profile truth sample must pass')
    if (classifyProfileTruthSample(full) !== 'full-ready') err('[V88] full audit profile truth sample must pass')
    if (classifyProfileTruthSample('项目级 analyze profileTrustState profileClaim actualSources status=stale-profile conclusionAuthority=profile correctionRoute=none') !== 'invalid-authority') err('[V88] stale Profile must not override code truth')
    if (classifyProfileTruthSample('audit full profileTrustState profileClaim actualSources status conclusionAuthority correctionRoute 直接修改Profile') !== 'invalid-readonly') err('[V88] audit must not mutate Profile')
    if (classifyProfileTruthSample('低风险单文件 N/A skipReason=与项目事实无关') !== 'n-a-ready') err('[V88] low-risk file-local N/A must pass')

    const probes = [
      { file: 'skills/load-profile/SKILL.md', needles: ['ProfileTruthReconciliationGate', 'profileTrustState', 'ProfileTruthMatrix', 'stale-profile', '不得直接修改 Profile'] },
      { file: 'skills/analyze-default/SKILL.md', needles: ['ProfileTruthReconciliationGate', 'targeted', 'profileTruth'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ProfileTruthReconciliationGate', 'full', 'PFresh-1~PFresh-6', 'ProfileTruthMatrix'] },
      { file: 'skills/report/SKILL.md', needles: ['ProfileTruthReconciliationGate', 'conclusionAuthority', '独立 dev/fix/self-fix'] },
      { file: 'prompts/report-analysis.prompt.md', needles: ['ProfileTruthReconciliationGate', 'profileTrustState', 'correctionRoute'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ProfileTruthReconciliationGate', 'audit 不修改 Profile'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['ProfileTruthReconciliationGate', 'targeted', '独立 dev/fix/self-fix'] },
      { file: 'skills/test-router/SKILL.md', needles: ['Profile 真相对账', 'V88/targeted probe'] },
      { file: 'skills/source-consumer-sync/SKILL.md', needles: ['V88~V90', 'ProfileTruthReconciliationGate'] },
      { file: 'README.md', needles: ['ProfileTruthReconciliationGate', 'V88'] },
      { file: 'website/docs/guide/development.md', needles: ['ProfileTruthReconciliationGate', 'V88'] },
      { file: 'website/docs/intro/index.md', needles: ['Profile 真相对账', 'ProfileTruthMatrix'] },
      { file: 'scripts/lib/test-spec-governance-expert.js', needles: ['checkV88', 'classifyProfileTruthSample'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]
    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) if (!content.includes(needle)) err(`[V88] profile truth sync in ${probe.file}: missing "${needle}"`)
    }
    console.log('[V88] profile truth reconciliation sync checked')
  }

  function checkV89() {
    const classifySecurityPresentationSample = sample => {
      const triggered = /授权本地安全审查|安全提示|内容不可见|AuthorizedLocalSecurityAuditPresentationGate/.test(sample)
      if (!triggered) return 'not-triggered'
      if (/绕过平台|规避安全控制|保证不触发/.test(sample)) return 'invalid-bypass'
      if (/用户可见完整载荷|公开完整利用载荷/.test(sample)) return 'invalid-visible-budget'
      const base = ['authorizationContext', 'defensiveObjective', 'visibleEvidenceBudget', 'isolatedProbeBoundary']
      if (!base.every(field => sample.includes(field))) return 'invalid-base'
      if (/安全提示|内容不可见/.test(sample)) {
        const interruption = ['SafetyInterruptionCard', 'exactMessage', 'surfaceModel', 'dateTimeTimezone', 'redactedTaskSummary', 'lastAcceptedCheckpoint', 'recoveryRoute']
        if (!interruption.every(field => sample.includes(field))) return 'invalid-interruption-card'
      }
      return 'presentation-ready'
    }

    const ready = '授权本地安全审查 安全提示 authorizationContext defensiveObjective visibleEvidenceBudget isolatedProbeBoundary SafetyInterruptionCard exactMessage surfaceModel dateTimeTimezone redactedTaskSummary lastAcceptedCheckpoint recoveryRoute'
    if (classifySecurityPresentationSample(ready) !== 'presentation-ready') err('[V89] complete authorized local security audit sample must pass')
    if (classifySecurityPresentationSample('授权本地安全审查 authorizationContext defensiveObjective visibleEvidenceBudget isolatedProbeBoundary 绕过平台') !== 'invalid-bypass') err('[V89] bypass claim must fail')
    if (classifySecurityPresentationSample('授权本地安全审查 authorizationContext defensiveObjective visibleEvidenceBudget isolatedProbeBoundary 用户可见完整载荷') !== 'invalid-visible-budget') err('[V89] complete visible payload must fail')
    if (classifySecurityPresentationSample('安全提示 authorizationContext defensiveObjective visibleEvidenceBudget isolatedProbeBoundary') !== 'invalid-interruption-card') err('[V89] missing interruption card must fail')

    const probes = [
      { file: 'skills/security-threat-modeling/SKILL.md', needles: ['AuthorizedLocalSecurityAuditPresentationGate', 'authorizationContext', 'SafetyInterruptionCard', '不得保证以后不会触发检查'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['AuthorizedLocalSecurityAuditPresentationGate', '禁止把“优化表达”写成绕过'] },
      { file: 'skills/audit-execution-guide/SKILL.md', needles: ['SafetyInterruptionCard', '禁止绕过表述'] },
      { file: 'skills/execution-contract/SKILL.md', needles: ['safetyInterruptionRecovery', 'AuthorizedLocalSecurityAuditPresentationGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['授权本地安全审查呈现', 'V89'] },
      { file: 'skills/report/SKILL.md', needles: ['AuthorizedLocalSecurityAuditPresentationGate', 'SafetyInterruptionCard', '不得声称'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['AuthorizedLocalSecurityAuditPresentationGate', 'SafetyInterruptionCard', '禁止绕过表述'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['security-audit-presentation', 'AuthorizedLocalSecurityAuditPresentationGate'] },
      { file: 'README.md', needles: ['AuthorizedLocalSecurityAuditPresentationGate', 'V89'] },
      { file: 'website/docs/guide/development.md', needles: ['AuthorizedLocalSecurityAuditPresentationGate', 'V89'] },
      { file: 'website/docs/intro/index.md', needles: ['授权本地安全审查', 'SafetyInterruptionCard'] },
      { file: 'scripts/lib/test-spec-governance-expert.js', needles: ['checkV89', 'classifySecurityPresentationSample'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]
    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) if (!content.includes(needle)) err(`[V89] security presentation sync in ${probe.file}: missing "${needle}"`)
    }
    console.log('[V89] authorized local security audit presentation sync checked')
  }

  function checkV90() {
    const classifyPublisherTopologySample = sample => {
      if (/普通 patch/.test(sample) && /unchanged/.test(sample) && /evidence/.test(sample)) return 'unchanged-ready'
      const triggered = /首次发布|owner迁移|package变化|registry变化|auth topology|PublisherCredentialTopologyGate/.test(sample)
      if (!triggered) return 'not-triggered'
      if (/secretValue=|token=ghp_|_authToken=明文/.test(sample)) return 'invalid-secret-value'
      if (/只复制workflow|workflow相同即可/.test(sample)) return 'invalid-workflow-only'
      const fields = ['publisherIdentity', 'repositoryIdentity', 'packageIdentity', 'authMode', 'secretTopology', 'workflowPermissions', 'referenceEvidence', 'topologyParity']
      return fields.every(field => sample.includes(field)) ? 'topology-ready' : 'invalid-topology'
    }

    const ready = '首次发布 PublisherCredentialTopologyGate publisherIdentity repositoryIdentity packageIdentity authMode secretTopology workflowPermissions referenceEvidence topologyParity'
    if (classifyPublisherTopologySample(ready) !== 'topology-ready') err('[V90] complete publisher topology sample must pass')
    if (classifyPublisherTopologySample('首次发布 只复制workflow') !== 'invalid-workflow-only') err('[V90] workflow-only evidence must fail')
    if (classifyPublisherTopologySample(`${ready} token=ghp_example`) !== 'invalid-secret-value') err('[V90] secret value evidence must fail')
    if (classifyPublisherTopologySample('普通 patch topology unchanged evidence=prior-release') !== 'unchanged-ready') err('[V90] unchanged patch evidence must pass')

    const probes = [
      { file: 'skills/release-verification/SKILL.md', needles: ['PublisherCredentialTopologyGate', 'publisherIdentity', 'secretTopology', '禁止读取或复制 value'] },
      { file: 'skills/audit-release/SKILL.md', needles: ['PublisherCredentialTopologyGate', 'package ownership', '不读取 secret value'] },
      { file: 'skills/execution-contract/SKILL.md', needles: ['publisherCredentialTopology', 'PublisherCredentialTopologyGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['发布凭据拓扑', 'V90 + R0~R7'] },
      { file: 'skills/report/SKILL.md', needles: ['PublisherCredentialTopologyGate', '不得包含 secret value'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['PublisherCredentialTopologyGate', '不含 secret value'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['PublisherCredentialTopologyGate', '不含 secret value'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['PublisherCredentialTopologyGate', '不含 secret value'] },
      { file: 'README.md', needles: ['PublisherCredentialTopologyGate', 'V90'] },
      { file: 'website/docs/guide/development.md', needles: ['PublisherCredentialTopologyGate', 'V90'] },
      { file: 'website/docs/intro/index.md', needles: ['发布凭据拓扑', 'secret value'] },
      { file: 'scripts/lib/test-spec-governance-expert.js', needles: ['checkV90', 'classifyPublisherTopologySample'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]
    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) if (!content.includes(needle)) err(`[V90] publisher topology sync in ${probe.file}: missing "${needle}"`)
    }
    console.log('[V90] publisher credential topology sync checked')
  }

  function checkV91() {
    const samples = [
      ['project=dev root=repo files=20 bytes=1MiB largest=10KiB fanout=4', 'single-pass'],
      ['project=dev root=repo user-large files=40 bytes=1MiB checkpoint=memory/b1', 'batched'],
      ['project=dev root=repo files=600 bytes=8MiB derived=10%', 'sampled+deep-read'],
      ['project=unknown root=unknown unresolved', 'blocked'],
      ['project=dev root=repo files=80 bytes=3MiB fanout=20', 'invalid'],
      ['project=dev root=repo invalid-glob derived-pollution', 'invalid']
    ]
    for (const [sample, expected] of samples) {
      const actual = classifyArtifactScaleSample(sample)
      if (actual !== expected) err(`[V91] scale classifier expected ${expected} but got ${actual}: ${sample}`)
    }
    const skillNames = ['skill-gap-analysis', 'skill-lifecycle-governance', 'distributed-systems-architecture', 'performance-engineering', 'privacy-compliance-architecture', 'ai-evaluation-engineering']
    const probes = [
      { file: 'plugin.json', needles: skillNames.map(name => `skills/${name}/SKILL.md`) },
      { file: 'skills/routing/SKILL.md', needles: skillNames },
      { file: 'skills/skill-gap-analysis/SKILL.md', needles: ['ProjectArtifactScaleRoutingGate', 'ScaleDecisionRecord', 'single-pass', 'batched', 'sampled+deep-read', 'blocked'] },
      { file: 'skills/skill-lifecycle-governance/SKILL.md', needles: ['SkillPortfolioLifecycleGate', 'NoOrphanActiveSkill', 'TriggerQualityScorecard'] },
      { file: 'skills/distributed-systems-architecture/SKILL.md', needles: ['DistributedSystemsArchitectureGate', 'consistencyModel', 'partitionFailureMatrix'] },
      { file: 'skills/performance-engineering/SKILL.md', needles: ['PerformanceEngineeringGate', 'benchmarkProtocol', 'regressionThresholds'] },
      { file: 'skills/privacy-compliance-architecture/SKILL.md', needles: ['PrivacyComplianceArchitectureGate', 'retentionDeletionPolicy', 'dataSubjectRightsFlow'] },
      { file: 'skills/ai-evaluation-engineering/SKILL.md', needles: ['AiEvaluationEngineeringGate', 'judgeCalibration', 'varianceReport'] },
      { file: 'instructions/01-common.instructions.md', needles: ['ProjectArtifactScaleRoutingGate', 'sampled+deep-read'] },
      { file: 'skills/analyze-default/SKILL.md', needles: ['ProjectArtifactScaleRoutingGate', 'ScaleDecisionRecord'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ProjectArtifactScaleRoutingGate', 'ScaleDecisionRecord'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['artifact-scale-skill-gap', 'skill-lifecycle'] },
      { file: 'skills/spec-absorption/SKILL.md', needles: ['ProjectArtifactScaleRoutingGate', 'invalid/discarded'] },
      { file: 'skills/test-router/SKILL.md', needles: ['artifactScaleRouting', 'V91'] },
      { file: 'skills/report/SKILL.md', needles: ['ProjectArtifactScaleRoutingGate', 'V91'] },
      { file: 'README.md', needles: [`${skillCount} 个`, 'ProjectArtifactScaleRoutingGate', 'skill-gap-analysis'] },
      { file: 'website/docs/intro/index.md', needles: [`${skillCount} 个按需触发`, 'skill-gap-analysis'] }
    ]
    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) if (!content.includes(needle)) err(`[V91] skill gap/lifecycle sync in ${probe.file}: missing "${needle}"`)
    }
    console.log('[V91] skill gap, scale routing and specialist skills sync checked')
  }

  function classifyExpertOutputSample(sample) {
    const fixtureOnly = /fixture|mock|demo|硬编码单例|每个 route 都重复|重复声明/.test(sample)
    const production = /生产推荐路径|框架原生能力|项目既有能力|推荐写法|public API|official docs/.test(sample)
    const boundary = /fixtureBoundary|mock.*边界|demo.*边界|反模式|evidenceMatrix|AntiPattern/.test(sample)
    if (fixtureOnly && !production && !boundary) return 'misleading-fixture'
    if (production && boundary) return 'expert-quality'
    return 'needs-review'
  }

  function classifyOperationExplanationSample(sample) {
    const fields = ['operationId', 'userGoal', 'preconditions', 'input', 'stateEffect', 'resultShape', 'resultSource', 'failureSemantics', 'nextAction', 'evidence']
    return fields.every(field => String(sample || '').includes(field)) ? 'operation-ready' : 'operation-incomplete'
  }

  function classifyCodeTruthRecommendationSample(sample) {
    const text = String(sample || '')
    if (/recommended=([2-9]|\d{2,})/.test(text)) return 'multiple-recommendations'
    const fields = ['repoPath', 'symbol', 'currentBehavior', 'evidence', 'negativeProbe', 'gap', 'reusePoint', 'consumer', 'rollback', 'statusQuoCost']
    if (!fields.every(field => text.includes(field))) return 'missing-code-truth-fields'
    if (!/recommended=1/.test(text)) return 'missing-unique-recommendation'
    return 'recommendation-ready'
  }

  function classifyExpertOwnerSample(sample) {
    if (/交付语义|消息顺序|分区故障|背压|partitionFailureMatrix/.test(sample)) return 'distributed-systems-architecture'
    if (/性能预算|可信基准|profiling|瓶颈归因|regressionThresholds/.test(sample)) return 'performance-engineering'
    if (/数据驻留|主体权利|保留删除|purposeConsentMatrix|dataSubjectRightsFlow/.test(sample)) return 'privacy-compliance-architecture'
    if (/模型评测|黄金集|Judge 校准|方差报告|judgeCalibration/.test(sample)) return 'ai-evaluation-engineering'
    if (/目标用户|用户价值|优先级|成功指标|scopeBoundary/.test(sample)) return 'product-strategy'
    if (/第一次成功|quick start|接入体验|错误信息|迁移路径|developerPersona/.test(sample)) return 'developer-experience-architecture'
    if (/任务流|信息架构|状态反馈|空态|错误恢复|interactionCost/.test(sample)) return 'ux-interaction-architecture'
    if (/异步缓存|旧数据|stale-while-revalidate|SSR|runtime config|空白页/.test(sample)) return 'frontend-architecture'
    if (/领域语言|边界上下文|权限模型|事务|一致性|幂等/.test(sample)) return 'backend-domain-architecture'
    if (/可观测性|容量|泄漏风险|回滚|运行手册|SRE/.test(sample)) return 'production-readiness-sre'
    if (/API 契约|public API|错误模型|分页|SDK|consumerSurface/.test(sample)) return 'api-contract-architecture'
    if (/Webhook|OAuth|第三方|配额|重试|供应商锁定|providerBoundary/.test(sample)) return 'external-integration-architecture'
    if (/CLI|Hook|多宿主|插件|扩展点|兼容矩阵|hostSurfaceMatrix/.test(sample)) return 'platform-ecosystem-architecture'
    if (/Agent 路由|工具调用|上下文|记忆|人机协作|toolPermissionBoundary|observabilityReplay/.test(sample)) return 'ai-agent-system-architecture'
    if (/数据模型|迁移|索引|生命周期|数据质量|analyticsConsumer/.test(sample)) return 'data-architecture'
    if (/威胁建模|信任边界|越权|密钥策略|审计|trustBoundary/.test(sample)) return 'security-threat-modeling'
    if (/测试金字塔|验收矩阵|覆盖率|回归范围|发布信心|riskModel/.test(sample)) return 'quality-strategy'
    if (/设计系统|Token|组件变体|主题|Figma|designTokens|componentVariantModel/.test(sample)) return 'design-system-architecture'
    if (/无障碍|键盘|焦点|屏幕阅读器|ARIA|国际化|本地化|RTL|locale|userNeedsMatrix|runtimeVerification/.test(sample)) return 'accessibility-i18n'
    if (/增长|埋点|漏斗|留存|实验|转化|growthQuestion|metricTaxonomy|eventInstrumentation/.test(sample)) return 'growth-analytics'
    if (/商业模式|定价|套餐|付费|成本收益|收入模型|运营风险|valueExchange|pricingPackaging|sustainabilityTco/.test(sample)) return 'business-model-review'
    return 'needs-review'
  }

  function classifyMemoryBootstrapSample(sample) {
    const memoryHint = /Memories|use_memories|内置记忆|宿主记忆|模型记忆|长期偏好/.test(sample)
    const replacesTruth = /跳过|替代|无需读取|不用读取|满足 bootstrap|作为验证证据|已通过证据/.test(sample)
    const fileTruth = /Profile|SUMMARY|tasks|reports|review checklist|源码|文档真相源|文件真相源/.test(sample)
    const navigationOnly = /navigation-hint|导航提示|只作为/.test(sample)
    if (memoryHint && replacesTruth) return 'invalid-memory-substitute'
    if (memoryHint && navigationOnly && fileTruth) return 'file-truth-required'
    return 'needs-review'
  }

  function classifyArtifactScaleSample(sample) {
    if (/project=(null|unknown)|root=(null|unknown)|unresolved/.test(sample)) return 'blocked'
    if (/invalid-glob|derived-pollution|timeout-no-checkpoint/.test(sample)) return 'invalid'
    if (/files=([5-9]\d\d|\d{4,})|bytes=(2[1-9]|[3-9]\d)MiB|derived=([3-9]\d|100)%/.test(sample)) return 'sampled+deep-read'
    if (/user-large|fanout=([1-9]\d|\d{3,})|files=([5-9]\d|[1-4]\d\d)/.test(sample)) return /checkpoint=/.test(sample) ? 'batched' : 'invalid'
    if (/files=([0-4]?\d|50)\b/.test(sample) && /bytes=([01](\.\d+)?|2)MiB/.test(sample)) return 'single-pass'
    return 'needs-review'
  }

  // __FUNCTIONS__

  return { checkV83, checkV84, checkV85, checkV86, checkV87, checkV88, checkV89, checkV90, checkV91 }
}

module.exports = { buildGovernanceExpertChecks }
