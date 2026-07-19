'use strict'

function runSpecGovernanceExpertSuite(ctx) {
  const {
    ROOT, fs, path, failures, SOURCE_PROJECT_NAME, skillCount, read, mustInclude,
    mustNotInclude, collectChangelogContents, mustIncludeInChangelogs
  } = ctx

  const checkV83 = 'ProfileTierStandardGate'
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-expert.js', 'checkV83'],
    ['scripts/lib/validate-governance-expert.js', 'classifyProfileGenerationSample'],
    ['scripts/lib/validate-governance-expert.js', 'collectActiveProfileCorpus'],
    ['scripts/lib/validate-governance-expert.js', 'appendActiveProfileProbe'],
    ['scripts/lib/validate-governance-expert.js', 'active Profile corpus unavailable'],
    ['scripts/lib/validate-governance-expert.js', checkV83],
    ['scripts/lib/validate-governance-expert.js', 'ProfileLifecycleClassificationGate'],
    ['scripts/lib/validate-governance-expert.js', 'AllDevCodexProfileValidationGate'],
    ['scripts/lib/validate-governance-expert.js', 'ProfileGenerationContractGate'],
    ['scripts/lib/validate-governance-expert.js', 'FeatureInventorySchemaGate'],
    ['scripts/lib/validate-governance-expert.js', 'ProfileTierMigrationSafetyGate'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['scripts/validate-profile.js', '--profile-dir'],
    ['scripts/validate-profile.js', '--workspace-profile'],
    ['scripts/validate-profile.js', 'profile-lite'],
    ['scripts/validate-profile.js', 'profile-standard'],
    ['scripts/validate-profile.js', 'profile-closed-loop'],
    ['scripts/validate-all-profiles.js', '--workspace'],
    ['scripts/validate-all-profiles.js', '--strict-warnings'],
    ['scripts/test-validate-profile.js', 'runValidateAll'],
    ['package.json', 'test:profile-all'],
    ['skills/load-profile/SKILL.md', checkV83],
    ['skills/load-profile/SKILL.md', 'profile-closed-loop'],
    ['skills/profile-bootstrap/SKILL.md', 'profile-standard'],
    ['skills/test-router/SKILL.md', 'profileTierValidation'],
    ['skills/report/SKILL.md', 'AllDevCodexProfileValidation'],
    ['README.md', 'AllDevCodexProfileValidationGate'],
    ['website/docs/guide/development.md', 'profile-closed-loop']
  ]) {
    mustInclude(file, needle)
  }
  mustIncludeInChangelogs('V83')
  mustIncludeInChangelogs('ProfileTierStandardGate')

  const checkV84 = 'ExpertOutputQualityGate'
  function classifyExpertOutputSample(sample) {
    const fixtureOnly = /fixture|mock|demo|硬编码单例|每个 route 都重复|重复声明/.test(sample)
    const production = /生产推荐路径|框架原生能力|项目既有能力|推荐写法|public API|official docs/.test(sample)
    const boundary = /fixtureBoundary|mock.*边界|demo.*边界|反模式|evidenceMatrix|AntiPattern/.test(sample)
    if (fixtureOnly && !production && !boundary) return 'misleading-fixture'
    if (production && boundary) return 'expert-quality'
    return 'needs-review'
  }

  if (classifyExpertOutputSample('permission-core-auth fixture 通过在每个 route 都重复 middlewares 和 auth 资源配置证明底层能力可用。') !== 'misleading-fixture') {
    failures.push('checkV84 negative fixture sample must be misleading-fixture')
  }
  if (classifyExpertOutputSample('生产推荐路径应优先使用框架原生能力和项目既有 helper；fixtureBoundary 只说明 mock/demo 验证边界，antiPattern/evidenceMatrix 标出每个 route 重复声明不是推荐写法。') !== 'expert-quality') {
    failures.push('checkV84 positive expert sample must be expert-quality')
  }

  for (const [file, needle] of [
    ['scripts/lib/validate-governance-expert.js', 'checkV84'],
    ['scripts/lib/validate-governance-expert.js', 'classifyExpertOutputSample'],
    ['scripts/lib/validate-governance-expert.js', checkV84],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/expert-output-quality/SKILL.md', 'name: expert-output-quality'],
    ['skills/expert-output-quality/SKILL.md', checkV84],
    ['skills/expert-output-quality/SKILL.md', 'ProductionRecommendedPathGate'],
    ['skills/expert-output-quality/SKILL.md', 'FrameworkNativeCapabilityFirstGate'],
    ['skills/expert-output-quality/SKILL.md', 'FixtureBoundaryDisclosureGate'],
    ['skills/expert-output-quality/SKILL.md', 'AntiPatternContrastGate'],
    ['skills/expert-output-quality/SKILL.md', 'ExpertEvidenceMatrixGate'],
    ['plugin.json', 'expert-output-quality'],
    ['skills/routing/SKILL.md', 'expert-output-quality'],
    ['skills/spec-governance/SKILL.md', 'expert-output-quality'],
    ['skills/spec-absorption/SKILL.md', checkV84],
    ['skills/dev-plan-review/SKILL.md', checkV84],
    ['skills/dev-docs/SKILL.md', checkV84],
    ['skills/user-manual-authoring/SKILL.md', 'expertOutputQualityEvidence'],
    ['skills/audit-document/SKILL.md', checkV84],
    ['skills/audit-readme/SKILL.md', checkV84],
    ['skills/audit-user-manual/SKILL.md', '专家型产物质量'],
    ['skills/audit-project/SKILL.md', checkV84],
    ['skills/audit-tech-design/SKILL.md', checkV84],
    ['skills/test-router/SKILL.md', 'expertOutputQuality'],
    ['skills/report/SKILL.md', checkV84],
    ['prompts/technical-design.prompt.md', checkV84],
    ['prompts/implementation-plan.prompt.md', checkV84],
    ['prompts/report-dev.prompt.md', checkV84],
    ['prompts/report-fix.prompt.md', checkV84],
    ['prompts/report-audit.prompt.md', checkV84],
    ['prompts/report-scenario-test.prompt.md', checkV84],
    ['README.md', 'expert-output-quality'],
    ['website/docs/index.md', `${skillCount} 个 Skills`],
    ['website/docs/intro/index.md', `${skillCount} 个按需触发`],
    ['website/docs/specs/directory-structure.md', `扁平一级 Skill（${skillCount} 个）`],
    ['website/docs/guide/development.md', checkV84],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V84']
  ]) {
    mustInclude(file, needle)
  }
  mustIncludeInChangelogs('V84')
  mustIncludeInChangelogs('expert-output-quality')
  mustIncludeInChangelogs('ExpertOutputQualityGate')

  const checkV85 = 'ExpertOwnerSkillGate'
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

  for (const [sample, expected] of [
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
  ]) {
    const actual = classifyExpertOwnerSample(sample)
    if (actual !== expected) failures.push(`checkV85 expected ${expected} but got ${actual}: ${sample}`)
  }

  const expertOwnerSkills = [
    'product-strategy',
    'developer-experience-architecture',
    'ux-interaction-architecture',
    'frontend-architecture',
    'backend-domain-architecture',
    'production-readiness-sre',
    'api-contract-architecture',
    'external-integration-architecture',
    'platform-ecosystem-architecture',
    'ai-agent-system-architecture',
    'data-architecture',
    'security-threat-modeling',
    'quality-strategy',
    'design-system-architecture',
    'accessibility-i18n',
    'growth-analytics',
    'business-model-review'
    ,'distributed-systems-architecture'
    ,'performance-engineering'
    ,'privacy-compliance-architecture'
    ,'ai-evaluation-engineering'
  ]
  const expertOwnerGates = [
    'ProductStrategyOwnerGate',
    'DeveloperExperienceArchitectureGate',
    'UxInteractionArchitectureGate',
    'FrontendArchitectureOwnerGate',
    'BackendDomainArchitectureGate',
    'ProductionReadinessSreGate',
    'ApiContractArchitectureGate',
    'ExternalIntegrationArchitectureGate',
    'PlatformEcosystemArchitectureGate',
    'AiAgentSystemArchitectureGate',
    'DataArchitectureGate',
    'SecurityThreatModelingGate',
    'QualityStrategyGate',
    'DesignSystemArchitectureGate',
    'AccessibilityI18nGate',
    'GrowthAnalyticsGate',
    'BusinessModelReviewGate'
    ,'DistributedSystemsArchitectureGate'
    ,'PerformanceEngineeringGate'
    ,'PrivacyComplianceArchitectureGate'
    ,'AiEvaluationEngineeringGate'
  ]
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-expert.js', 'checkV85'],
    ['scripts/lib/validate-governance-expert.js', 'classifyExpertOwnerSample'],
    ['scripts/lib/validate-governance-expert.js', checkV85],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['plugin.json', 'skills/product-strategy/SKILL.md'],
    ['plugin.json', 'skills/developer-experience-architecture/SKILL.md'],
    ['plugin.json', 'skills/ux-interaction-architecture/SKILL.md'],
    ['plugin.json', 'skills/frontend-architecture/SKILL.md'],
    ['plugin.json', 'skills/backend-domain-architecture/SKILL.md'],
    ['plugin.json', 'skills/production-readiness-sre/SKILL.md'],
    ['plugin.json', 'skills/api-contract-architecture/SKILL.md'],
    ['plugin.json', 'skills/external-integration-architecture/SKILL.md'],
    ['plugin.json', 'skills/platform-ecosystem-architecture/SKILL.md'],
    ['plugin.json', 'skills/ai-agent-system-architecture/SKILL.md'],
    ['plugin.json', 'skills/data-architecture/SKILL.md'],
    ['plugin.json', 'skills/security-threat-modeling/SKILL.md'],
    ['plugin.json', 'skills/quality-strategy/SKILL.md'],
    ['plugin.json', 'skills/design-system-architecture/SKILL.md'],
    ['plugin.json', 'skills/accessibility-i18n/SKILL.md'],
    ['plugin.json', 'skills/growth-analytics/SKILL.md'],
    ['plugin.json', 'skills/business-model-review/SKILL.md'],
    ['skills/routing/SKILL.md', checkV85],
    ['skills/spec-governance/SKILL.md', 'expert-owner-skills'],
    ['skills/spec-absorption/SKILL.md', checkV85],
    ['skills/dev-plan-review/SKILL.md', checkV85],
    ['skills/test-router/SKILL.md', 'expertOwnerSkills'],
    ['skills/report/SKILL.md', '21 个专家 Owner Skill'],
    ['prompts/technical-design.prompt.md', checkV85],
    ['prompts/implementation-plan.prompt.md', checkV85],
    ['prompts/report-dev.prompt.md', checkV85],
    ['prompts/report-fix.prompt.md', checkV85],
    ['prompts/report-audit.prompt.md', checkV85],
    ['prompts/report-scenario-test.prompt.md', checkV85],
    ['README.md', '专家 Owner Skill'],
    ['website/docs/index.md', `${skillCount} 个 Skills`],
    ['website/docs/intro/index.md', '专家 Owner Skill'],
    ['website/docs/specs/directory-structure.md', `扁平一级 Skill（${skillCount} 个）`],
    ['website/docs/guide/development.md', checkV85],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V85']
  ]) {
    mustInclude(file, needle)
  }
  for (const skill of expertOwnerSkills) {
    mustInclude(`skills/${skill}/SKILL.md`, `name: ${skill}`)
    mustInclude('README.md', skill)
    mustInclude('website/docs/versions/v1/1.0.1/CHANGELOG.md', skill)
  }
  for (const gate of expertOwnerGates) {
    mustInclude('scripts/lib/validate-governance-expert.js', gate)
    mustInclude('skills/test-router/SKILL.md', gate)
    mustInclude('skills/report/SKILL.md', gate)
  }
  mustIncludeInChangelogs('V85')
  mustIncludeInChangelogs('ExpertOwnerSkillGate')

  const checkV86 = 'MemoryCannotSatisfyBootstrapGate'
  function classifyMemoryBootstrapSample(sample) {
    const memoryHint = /Memories|use_memories|内置记忆|宿主记忆|模型记忆|长期偏好/.test(sample)
    const replacesTruth = /跳过|替代|无需读取|不用读取|满足 bootstrap|作为验证证据|已通过证据/.test(sample)
    const fileTruth = /Profile|SUMMARY|tasks|reports|review checklist|源码|文档真相源|文件真相源/.test(sample)
    const navigationOnly = /navigation-hint|导航提示|只作为/.test(sample)
    if (memoryHint && replacesTruth) return 'invalid-memory-substitute'
    if (memoryHint && navigationOnly && fileTruth) return 'file-truth-required'
    return 'needs-review'
  }

  if (classifyMemoryBootstrapSample('开启 Codex Memories 后可跳过 Profile、tasks、reports 读取，并把模型记忆作为验证证据。') !== 'invalid-memory-substitute') {
    failures.push('checkV86 negative memory sample must be invalid-memory-substitute')
  }
  if (classifyMemoryBootstrapSample('Codex Memories 只作为 navigation-hint，仍读取 Profile、SUMMARY、today tasks、reports、review checklist 和源码 / 文档真相源。') !== 'file-truth-required') {
    failures.push('checkV86 positive memory sample must be file-truth-required')
  }

  for (const [file, needle] of [
    ['scripts/lib/validate-governance-expert.js', 'checkV86'],
    ['scripts/lib/validate-governance-expert.js', 'classifyMemoryBootstrapSample'],
    ['scripts/lib/validate-governance-expert.js', checkV86],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/load-profile/SKILL.md', checkV86],
    ['skills/memory/SKILL.md', checkV86],
    ['skills/test-router/SKILL.md', 'memoryCannotSatisfyBootstrap'],
    ['skills/report/SKILL.md', checkV86],
    ['skills/spec-governance/SKILL.md', 'memory-bootstrap'],
    ['skills/spec-absorption/SKILL.md', checkV86],
    ['README.md', checkV86],
    ['website/docs/index.md', checkV86],
    ['website/docs/intro/index.md', checkV86],
    ['website/docs/guide/development.md', checkV86],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V86']
  ]) {
    mustInclude(file, needle)
  }
  mustIncludeInChangelogs('V86')
  mustIncludeInChangelogs('MemoryCannotSatisfyBootstrapGate')

  for (const file of [
    'instructions/12-audit.instructions.md',
    'skills/audit-common/SKILL.md',
    'skills/audit-execution-guide/SKILL.md',
    'skills/audit-session/SKILL.md'
  ]) {
    mustInclude(file, 'AuditMutationBoundaryGate')
  }
  for (const file of [
    'instructions/12-audit.instructions.md',
    'skills/audit-common/SKILL.md',
    'skills/audit-execution-guide/SKILL.md'
  ]) {
    mustInclude(file, '显式用户授权')
    mustNotInclude(file, '即发即修', 'audit must hand findings to an independently authorized repair workflow')
    mustNotInclude(file, '自动 self-fix', 'audit must not auto-escalate read-only permission')
    mustNotInclude(file, '直接执行修复，无需用户确认', 'repair requires explicit user authorization')
  }
  mustInclude('README.md', 'AuditMutationBoundaryGate')
  mustInclude('website/docs/guide/development.md', 'AuditMutationBoundaryGate')

  const activeRuleFiles = [
    'README.md',
    'instructions.md',
    'instructions/00-safety.instructions.md',
    'instructions/12-audit.instructions.md',
    'instructions/18-spec-radar.instructions.md',
    'skills/cp-gate/SKILL.md',
    'skills/spec-governance/SKILL.md',
    'data/templates/violations.md',
    'data/templates/pending-fixes.md',
    'data/templates/process-improvements.md',
    'data/templates/pending-issues.md',
    'data/templates/gap-registry.md'
  ]

  for (const file of activeRuleFiles) {
    mustNotInclude(file, '.devcodex/.maintainer-state', 'current governance ledgers must use active-root')
  }

  const checkV87 = 'DualLayerRepairCollaborationContract'
  function classifyRepairContractSample(sample) {
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

  for (const [sample, expected] of [
    ['低风险 Bug problemAnchor expectedBehavior acceptanceEvidence decisionAcceptanceOwner allowedPaths validationRoute rollbackTrigger executionVerificationOwner', 'light-contract-ready'],
    ['低风险 Bug 只有问题描述', 'invalid-light-contract'],
    ['P0 控制面修复 auditSnapshot approvedFindingIds evidencePacket roleAssignments acceptanceMatrix authorizationEvidence allowedPaths blockedScope batchPlan findingToPatchMap regressionMatrix handoffIntegrity independentReReview rollbackPlan', 'full-contract-ready'],
    ['P1 安全问题 allowedPaths validationRoute', 'invalid-full-contract'],
    ['讨论 Sol Ultra 跨模型协作，没有修复目标', 'not-repair']
  ]) {
    const actual = classifyRepairContractSample(sample)
    if (actual !== expected) failures.push(`checkV87 expected ${expected} but got ${actual}: ${sample}`)
  }

  for (const [file, needle] of [
    ['scripts/lib/validate-governance-expert.js', 'checkV87'],
    ['scripts/lib/validate-governance-expert.js', 'classifyRepairContractSample'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/execution-contract/SKILL.md', checkV87],
    ['skills/spec-governance/SKILL.md', 'repair-collaboration'],
    ['skills/test-router/SKILL.md', 'repairCollaboration'],
    ['skills/report/SKILL.md', 'RepairCollaborationContract'],
    ['README.md', '模型无关双层修复协作契约'],
    ['website/docs/guide/development.md', 'repair-collaboration'],
    ['website/docs/intro/index.md', '双层修复协作契约'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V87']
  ]) {
    mustInclude(file, needle)
  }
  mustIncludeInChangelogs('V87')
  mustIncludeInChangelogs('DualLayerRepairCollaborationContract')

  const checkV88 = 'ProfileTruthReconciliationGate'
  function classifyProfileTruthSample(sample) {
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
  for (const [sample, expected] of [
    ['项目级 analyze ProfileTruthReconciliationGate targeted profileTrustState profileClaim actualSources status=stale-profile conclusionAuthority=code correctionRoute=fix', 'targeted-ready'],
    ['audit full PFresh profileTrustState profileClaim actualSources status=aligned conclusionAuthority=actualSources correctionRoute=none', 'full-ready'],
    ['项目级 analyze profileTrustState profileClaim actualSources status=stale-profile conclusionAuthority=profile correctionRoute=none', 'invalid-authority'],
    ['audit full profileTrustState profileClaim actualSources status conclusionAuthority correctionRoute 直接修改Profile', 'invalid-readonly'],
    ['低风险单文件 N/A skipReason=与项目事实无关', 'n-a-ready']
  ]) {
    const actual = classifyProfileTruthSample(sample)
    if (actual !== expected) failures.push(`checkV88 expected ${expected} but got ${actual}: ${sample}`)
  }

  const checkV89 = 'AuthorizedLocalSecurityAuditPresentationGate'
  function classifySecurityPresentationSample(sample) {
    const triggered = /授权本地安全审查|安全提示|内容不可见|AuthorizedLocalSecurityAuditPresentationGate/.test(sample)
    if (!triggered) return 'not-triggered'
    if (/绕过平台|规避安全控制|保证不触发/.test(sample)) return 'invalid-bypass'
    if (/用户可见完整载荷|公开完整利用载荷/.test(sample)) return 'invalid-visible-budget'
    const base = ['authorizationContext', 'defensiveObjective', 'visibleEvidenceBudget', 'isolatedProbeBoundary']
    if (!base.every(field => sample.includes(field))) return 'invalid-base'
    if (/安全提示|内容不可见/.test(sample)) {
      const card = ['SafetyInterruptionCard', 'exactMessage', 'surfaceModel', 'dateTimeTimezone', 'redactedTaskSummary', 'lastAcceptedCheckpoint', 'recoveryRoute']
      if (!card.every(field => sample.includes(field))) return 'invalid-interruption-card'
    }
    return 'presentation-ready'
  }
  for (const [sample, expected] of [
    ['授权本地安全审查 安全提示 authorizationContext defensiveObjective visibleEvidenceBudget isolatedProbeBoundary SafetyInterruptionCard exactMessage surfaceModel dateTimeTimezone redactedTaskSummary lastAcceptedCheckpoint recoveryRoute', 'presentation-ready'],
    ['授权本地安全审查 authorizationContext defensiveObjective visibleEvidenceBudget isolatedProbeBoundary 绕过平台', 'invalid-bypass'],
    ['授权本地安全审查 authorizationContext defensiveObjective visibleEvidenceBudget isolatedProbeBoundary 用户可见完整载荷', 'invalid-visible-budget'],
    ['安全提示 authorizationContext defensiveObjective visibleEvidenceBudget isolatedProbeBoundary', 'invalid-interruption-card']
  ]) {
    const actual = classifySecurityPresentationSample(sample)
    if (actual !== expected) failures.push(`checkV89 expected ${expected} but got ${actual}: ${sample}`)
  }

  const checkV90 = 'PublisherCredentialTopologyGate'
  function classifyPublisherTopologySample(sample) {
    if (/普通 patch/.test(sample) && /unchanged/.test(sample) && /evidence/.test(sample)) return 'unchanged-ready'
    const triggered = /首次发布|owner迁移|package变化|registry变化|auth topology|PublisherCredentialTopologyGate/.test(sample)
    if (!triggered) return 'not-triggered'
    if (/secretValue=|token=ghp_|_authToken=明文/.test(sample)) return 'invalid-secret-value'
    if (/只复制workflow|workflow相同即可/.test(sample)) return 'invalid-workflow-only'
    const fields = ['publisherIdentity', 'repositoryIdentity', 'packageIdentity', 'authMode', 'secretTopology', 'workflowPermissions', 'referenceEvidence', 'topologyParity']
    return fields.every(field => sample.includes(field)) ? 'topology-ready' : 'invalid-topology'
  }
  for (const [sample, expected] of [
    ['首次发布 PublisherCredentialTopologyGate publisherIdentity repositoryIdentity packageIdentity authMode secretTopology workflowPermissions referenceEvidence topologyParity', 'topology-ready'],
    ['首次发布 只复制workflow', 'invalid-workflow-only'],
    ['首次发布 PublisherCredentialTopologyGate publisherIdentity repositoryIdentity packageIdentity authMode secretTopology workflowPermissions referenceEvidence topologyParity token=ghp_example', 'invalid-secret-value'],
    ['普通 patch topology unchanged evidence=prior-release', 'unchanged-ready']
  ]) {
    const actual = classifyPublisherTopologySample(sample)
    if (actual !== expected) failures.push(`checkV90 expected ${expected} but got ${actual}: ${sample}`)
  }

  for (const [file, needle] of [
    ['scripts/lib/validate-governance-expert.js', 'checkV88'],
    ['scripts/lib/validate-governance-expert.js', 'checkV89'],
    ['scripts/lib/validate-governance-expert.js', 'checkV90'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/load-profile/SKILL.md', checkV88],
    ['skills/security-threat-modeling/SKILL.md', checkV89],
    ['skills/release-verification/SKILL.md', checkV90],
    ['README.md', 'V88'],
    ['README.md', 'V89'],
    ['README.md', 'V90'],
    ['website/docs/guide/development.md', checkV88],
    ['website/docs/guide/development.md', checkV89],
    ['website/docs/guide/development.md', checkV90]
  ]) mustInclude(file, needle)
  mustIncludeInChangelogs('V88')
  mustIncludeInChangelogs('V89')
  mustIncludeInChangelogs('V90')
  mustIncludeInChangelogs(checkV88)
  mustIncludeInChangelogs(checkV89)
  mustIncludeInChangelogs(checkV90)
}

module.exports = { runSpecGovernanceExpertSuite }
