'use strict'

const { buildGovernanceHelpers } = require('./validate-governance-helpers')

function buildGovernanceQualityChecks(ctx) {
  const {
    ROOT, ACTIVE_DEVCODEX_ROOT, RECENT_REQUIREMENT_ARTIFACT_DAYS,
    collectRecentBugArtifactIssues, collectRecentRequirementArtifactIssues,
    fs, path, execSync, read, err, mustInclude
  } = ctx
  const { collectChangelogSources, hasChangelogEvidence } = buildGovernanceHelpers(ctx)

  function checkV55() {
    const probes = [
      { file: 'instructions.md', needles: ['C22', 'ServiceLifecycleCleanup', 'AI 自启动服务清理', '不得杀用户既有进程'] },
      { file: 'instructions/01-common.instructions.md', needles: ['C22', 'AI 自启动服务清理', 'ServiceLifecycleCleanup'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['AI 自启动服务清理', '端口释放'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['AI 自启动服务清理', '端口释放'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ServiceLifecycleCleanup', 'cleanupEvidence', '不得杀用户既有进程'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['ServiceLifecycleCleanup', '不得静默遗留后台进程'] },
      { file: 'skills/dev-scenario-test/SKILL.md', needles: ['ServiceLifecycleCleanup', '不得杀用户既有进程'] },
      { file: 'skills/dev-optimization/SKILL.md', needles: ['ServiceLifecycleCleanup', '压测 target'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['serviceLifecycle', 'cleanupEvidence'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ServiceLifecycleCleanup', 'keepAliveReason'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ServiceLifecycleCleanup', 'AI 自启动服务清理'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ServiceLifecycleCleanup', 'AI 自启动服务清理'] },
      { file: 'README.md', needles: ['AI 自启动服务清理', '不会为了释放端口杀掉用户已有进程'] },
      { file: 'website/docs/guide/development.md', needles: ['ServiceLifecycleCleanup', '非本轮 AI 进程只报告线索'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['ServiceLifecycleCleanup', 'checkV55'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V55] service lifecycle cleanup drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ServiceLifecycleCleanup', 'C22']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V55] service lifecycle cleanup changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    for (const file of [
      'instructions.md',
      'instructions/01-common.instructions.md'
    ]) {
      const content = read(path.join(ROOT, file))
      if (content.includes('C01~C21')) {
        err(`[V55] constraint range drift in ${file}: legacy "C01~C21" remains after C22`)
      }
    }

    console.log('[V55] service lifecycle cleanup sync checked')
  }

  function checkV56() {
    const probes = [
      { file: 'instructions.md', needles: ['CP1 需求/问题定义必须前置平台工程判断', '发布包边界检查必须在构建', '消费者验证出现与当前改动无关', '底座能力、当前消费者和高级能力尾项'] },
      { file: 'instructions/01-common.instructions.md', needles: ['消费者范围、共享契约边界', '文档阅读顺序 / 导航顺序变更'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['前置平台工程判断', '包边界验证串行化', '消费者依赖树优先探针', '接入状态口径拆分', '无关 dirty 文件'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['前置平台工程判断', 'npm ls <关键依赖>', '无关 dirty 文件'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['验证卫生与串行边界（F-30）', 'PackageBoundarySerialCheck'] },
      { file: 'skills/test-router/SKILL.md', needles: ['PackageBoundarySerialCheck', 'ConsumerDependencyTreeProbe', 'dist` 的命令与包边界检查'] },
      { file: 'skills/release-verification/SKILL.md', needles: ['发布型 Profile', '单独串行执行', '无关 dirty 文件'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['PFresh-6', '发布关键 Profile 字段'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['website sidebar/nav', '正文顺序 → 导航/sidebar 顺序'] },
      { file: 'prompts/requirement.prompt.md', needles: ['写需求和定义问题时必须前置平台工程师视角', '底座能力、当前消费者和高级能力尾项'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['CP2 必须承接 CP1 的平台工程判断', 'package boundary / pack / benchmark / codegen', '包边界验证'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ConsumerDependencyTreeProbe', 'PackageBoundarySerialCheck', '正文顺序、导航/sidebar 顺序与索引顺序'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['ConsumerDependencyTreeProbe', 'PackageBoundarySerialCheck'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ConsumerDependencyTreeProbe', 'PackageBoundarySerialCheck'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ConsumerDependencyTreeProbe', 'PackageBoundarySerialCheck'] },
      { file: 'README.md', needles: ['需求/问题定义前置平台工程判断', '验证卫生与包边界', '文档阅读顺序同步'] },
      { file: 'website/docs/guide/development.md', needles: ['需求/问题定义阶段先做平台工程判断', '验证卫生与包边界', '文档阅读顺序同步'] },
      { file: 'website/docs/guide/release.md', needles: ['package boundary check 必须在 build / benchmark / codegen 完成后单独串行执行', '发布型 Profile'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV56', 'PackageBoundarySerialCheck', 'ConsumerDependencyTreeProbe'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V56] platform framing / validation hygiene drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['PackageBoundarySerialCheck', 'ConsumerDependencyTreeProbe', '平台工程']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V56] platform framing / validation hygiene changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V56] platform framing / validation hygiene sync checked')
  }

  function checkV57() {
    const probes = [
      { file: 'instructions.md', needles: ['ReviewCoverageDelta', 'ReviewedSet', '连续 **3** 轮有效零发现'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['ReviewCoverageDelta', 'UnreviewedRelatedSet', 'NoNewSurfaceReason', '有效零发现'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ReviewCoverageDelta', 'ReviewedSet', 'NewlyReadThisRound', 'RepeatReadReason', 'NoNewSurfaceReason'] },
      { file: 'skills/audit-execution-guide/SKILL.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'skills/intent/SKILL.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ReviewCoverageDelta', 'ReviewedSet', 'UnreviewedRelatedSet', 'NewlyReadThisRound', 'RepeatReadReason', 'NoNewSurfaceReason'] },
      { file: 'instructions/16-report.instructions.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'skills/report/SKILL.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'README.md', needles: ['ReviewCoverageDelta', '复审覆盖增量', '有效零发现'] },
      { file: 'website/docs/guide/development.md', needles: ['ReviewCoverageDelta', '复审覆盖增量', '有效零发现'] },
      { file: 'website/docs/specs/flowcharts.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'website/docs/specs/workflow-execution-flow.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV57', 'ReviewCoverageDelta'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V57] review coverage delta drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ReviewCoverageDelta', '复审覆盖增量']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V57] review coverage delta changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    const stalePhrase = '每轮 audit 聚焦全量范围（不跳过已通过项'
    for (const file of [
      'instructions/12-audit.instructions.md',
      'skills/audit-common/SKILL.md',
      'prompts/report-audit.prompt.md',
      'README.md'
    ]) {
      if (String(read(path.join(ROOT, file))).includes(stalePhrase)) {
        err(`[V57] review coverage delta stale wording in ${file}: "${stalePhrase}"`)
      }
    }

    console.log('[V57] audit review coverage delta sync checked')
  }

  function checkV58() {
    const probes = [
      { file: 'instructions.md', needles: ['ConcurrencyPolicy', 'extensions.devcodex.concurrency', 'allowParallelMutations'] },
      { file: 'instructions/01-common.instructions.md', needles: ['ConcurrencyPolicy', 'additionalSingleWriterScopes', 'allowParallelMutations'] },
      { file: 'instructions/01a-profile-loading.instructions.md', needles: ['extensions.devcodex.concurrency', 'mode=auto', 'mode=serial'] },
      { file: 'instructions/17-compliance.instructions.md', needles: ['并发策略合规', 'ConcurrencyPolicy', 'package boundary'] },
      { file: 'skills/compliance/SKILL.md', needles: ['并发策略合规', 'ConcurrencyPolicy', 'package boundary'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['extensions.devcodex.concurrency', 'additionalSingleWriterScopes'] },
      { file: 'skills/intent/SKILL.md', needles: ['ConcurrencyPolicy', '前置只读识别'] },
      { file: 'skills/routing/SKILL.md', needles: ['ConcurrencyPolicy', '只读识别'] },
      { file: 'skills/audit-session/SKILL.md', needles: ['audit-session', '单写者锁'] },
      { file: 'skills/memory/SKILL.md', needles: ['ConcurrencyPolicy', 'memory` 单写者锁'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['验证卫生与并发边界', 'ConcurrencyPolicy'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ConcurrencyPolicy', 'PackageBoundarySerialCheck'] },
      { file: 'skills/release-verification/SKILL.md', needles: ['ConcurrencyPolicy', '单独执行的 pack 结果'] },
      { file: 'scripts/validate-profile.js', needles: ['validateConcurrencyPolicy', 'CORE_SINGLE_WRITER_SCOPES', 'additionalSingleWriterScopes'] },
      { file: 'scripts/test-validate-profile.js', needles: ['validConcurrencyRoot', 'invalidConcurrencyRoot', 'allowParallelMutations'] },
      { file: 'README.md', needles: ['extensions.devcodex.concurrency', 'parallel prepare, serial commit'] },
      { file: 'website/docs/guide/development.md', needles: ['extensions.devcodex.concurrency', '并发策略与 `ENV_MODE` 分离'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['ConcurrencyPolicy', 'extensions.devcodex.concurrency'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['可配置并发执行策略', 'concurrency-policy'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/concurrency-policy/index.md', needles: ['ConcurrencyPolicy', 'allowParallelMutations'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/concurrency-policy/design.md', needles: ['核心单写者域', 'runtime 调度器'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV58', 'ConcurrencyPolicy'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V58] concurrency policy sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ConcurrencyPolicy', 'extensions.devcodex.concurrency', 'allowParallelMutations']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V58] concurrency policy changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V58] concurrency policy sync checked')
  }

  function checkV59() {
    const probes = [
      { file: 'instructions.md', needles: ['PE-1~PE-12', '资源生命周期与泄漏风险审查'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['PE-1~PE-12', 'PE-12 资源生命周期与泄漏风险', '内存泄露'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['PE-1~PE-12', 'PE-12 资源生命周期与泄漏风险', '内存泄露', '监听器', 'N/A + skipReason'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['项目工程(PE-1~PE-12)'] },
      { file: 'README.md', needles: ['项目工程泄漏审查', 'PE-12 资源生命周期与泄漏风险', '缓存无界增长'] },
      { file: 'website/docs/guide/development.md', needles: ['PE-12 资源生命周期与泄漏风险', '内存泄露', 'N/A + skipReason'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV59', '资源生命周期与泄漏风险'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V59] project audit leak-risk drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['PE-12', '资源生命周期与泄漏风险']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V59] project audit leak-risk changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V59] project audit resource lifecycle leak-risk sync checked')
  }

  function checkV60() {
    const probes = [
      { file: 'instructions.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测', 'PE-12 资源生命周期与泄漏风险'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['LeakRiskStabilityPressureTest', '写测试用例', '场景/负载/稳定性验证'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测'] },
      { file: 'skills/test-router/SKILL.md', needles: ['LeakRiskStabilityPressureTest', 'leakRiskPressure', 'heap/RSS'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测', 'N/A + skipReason'] },
      { file: 'skills/dev-scenario-test/SKILL.md', needles: ['LeakRiskStabilityPressureTest', '冷却后回落', '轻量采样脚本'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['leakRiskPressure', '泄漏风险稳定性压测'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['LeakRiskStabilityPressureTest', 'resourceMetrics'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测结果'] },
      { file: 'README.md', needles: ['泄漏风险稳定性压测', 'LeakRiskStabilityPressureTest', '低风险任务写 `N/A + skipReason`'] },
      { file: 'website/docs/guide/development.md', needles: ['LeakRiskStabilityPressureTest', '资源指标前后对比', 'N/A + skipReason'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['leak-risk-stability-pressure', '泄漏风险稳定性压测'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/leak-risk-stability-pressure/index.md', needles: ['LeakRiskStabilityPressureTest', 'leakRiskPressure', 'ServiceLifecycleCleanup'] },
      { file: 'website/rspress.config.ts', needles: ['leak-risk-stability-pressure', '泄漏风险稳定性压测'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV60', 'LeakRiskStabilityPressureTest'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V60] leak-risk stability pressure test sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V60] leak-risk stability pressure test changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V60] leak-risk stability pressure test sync checked')
  }

  function checkV61() {
    const probes = [
      { file: 'instructions.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'CodeTruthRequirementGate', 'ManualReviewEvidenceRetention', 'VerificationScopeBudgetGate'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards / GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['CrossProjectLearnedGuards / GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['FrontendExperienceQualityGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['前端体验质量门禁', 'CodeTruthRequirementGate', 'ManualReviewEvidenceRetention'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'VerificationScopeBudgetGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['frontendExperience', 'manualReviewEvidence', 'verificationScopeBudget', 'DocumentationTranslationParityGuard'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['VerificationScopeBudgetGate', 'LiveVerificationExecutionObligation', 'ManualReviewEvidenceRetention'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['DocumentationTranslationParityGuard', 'FormalDocsDevCodexBoundary', 'CodeTruthRequirementGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'FormalDocsDevCodexBoundary'] },
      { file: 'skills/dev-optimization/SKILL.md', needles: ['AdapterBenchmarkAttribution', '归因边界'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'AdapterBenchmarkAttribution'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'LiveVerificationExecutionObligation'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['DocumentationTranslationParityGuard', 'FormalDocsDevCodexBoundary', 'LiveVerificationExecutionObligation'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['CodeTruthRequirementGate', 'DocumentationTranslationParityGuard', 'FormalDocsDevCodexBoundary'] },
      { file: 'prompts/requirement.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'AdapterBenchmarkAttribution'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['frontendExperience', 'manualReviewEvidence', 'verificationScopeBudget', 'AdapterBenchmarkAttribution'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'VerificationScopeBudgetGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'ManualReviewEvidenceRetention'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'GovernanceGateRegistry'] },
      { file: 'README.md', needles: ['FrontendExperienceQualityGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'website/docs/guide/development.md', needles: ['FrontendExperienceQualityGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['frontend-experience-quality', '前端体验质量门禁'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/frontend-experience-quality/index.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'ManualReviewEvidenceRetention'] },
      { file: 'website/rspress.config.ts', needles: ['frontend-experience-quality', '前端体验质量门禁'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV61', 'FrontendExperienceQualityGate', 'CrossProjectLearnedGuards'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V61] frontend experience / learned guards sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'CodeTruthRequirementGate', 'AdapterBenchmarkAttribution']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V61] frontend experience / learned guards changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V61] frontend experience / learned guards sync checked')
  }

  function checkV62() {
    const probes = [
      { file: 'instructions.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'PerformanceBenchmarkFirstGate', 'PublicModuleDifferentiationGate', 'V2MCPFirstPlanningGate'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['LocalExecutionConfigProbe', 'ManualReviewEvidenceDataRetention', 'AdjacentScopeExpansionGuard', 'PerformanceBenchmarkFirstGate'] },
      { file: 'prompts/requirement.prompt.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'PublicModuleDifferentiationGate', 'V2MCPFirstPlanningGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['LocalExecutionConfigProbe', 'ManualReviewEvidenceDataRetention', 'AdjacentScopeExpansionGuard', 'V2MCPFirstPlanningGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'anchors'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'anchors'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'anchors'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'anchors'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'skills/test-router/SKILL.md', needles: ['LocalExecutionConfigProbe', 'ManualReviewEvidenceDataRetention', 'packageNameAuthority', 'performanceBenchmarkFirst'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['ProductRequirementTraceabilityGate', 'LocalExecutionConfigProbe', 'PerformanceBenchmarkFirstGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['PackageNameAuthorityGate', 'PublicModuleDifferentiationGate', 'ProductRequirementTraceabilityGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'PublicModuleDifferentiationGate'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['LocalExecutionConfigProbe', 'ManualReviewEvidenceDataRetention', 'V2MCPFirstPlanningGate'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'instructions/18-spec-radar.instructions.md', needles: ['01a-profile-loading', '§确定目标项目'] },
      { file: 'instructions/01-common.instructions.md', needles: ['profile-bootstrap', 'Profile 缺失'] },
      { file: 'instructions/01a-profile-loading.instructions.md', needles: ['profile-bootstrap', 'devcodex profile init'] },
      { file: 'RULES.md', needles: ['audit（7 目标类型）'] },
      { file: 'website/docs/specs/routing-flow.md', needles: ['audit（7 目标类型）'] },
      { file: 'website/docs/versions/v2/2.0.0/index.md', needles: ['Intent-Gated Hosted Spec MCP', '不安装 `.github`', '不本地持久化缓存规则正文', 'Codex-only'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['data-absorption-guard-extensions', '剩余 data 吸纳守门扩展'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/data-absorption-guard-extensions/index.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'V2MCPFirstPlanningGate'] },
      { file: 'website/rspress.config.ts', needles: ['data-absorption-guard-extensions'] },
      { file: 'changelogs/unreleased.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'V2MCPFirstPlanningGate'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV62', 'ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V62] data absorption guard extension drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const forbidden = [
      { file: 'RULES.md', needles: ['audit（6 子类型）', 'audit（6 目标类型）'] },
      { file: 'website/docs/specs/routing-flow.md', needles: ['audit（6 子类型）', 'audit（6 目标类型）'] },
      { file: 'instructions/18-spec-radar.instructions.md', needles: ['01-common 优先级 3 硬约束'] }
    ]

    for (const probe of forbidden) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (content.includes(needle)) {
          err(`[V62] stale governance wording remains in ${probe.file}: "${needle}"`)
        }
      }
    }

    for (const needle of ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'V2MCPFirstPlanningGate']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V62] data absorption guard extension changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V62] data absorption guard extensions sync checked')
  }

  function checkV63() {
    const probes = [
      { file: 'instructions.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'FlowchartNodeExplanationGate', 'DocsSiteVisualAcceptanceGate', 'OmissionOnlyReviewGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['OmissionOnlyReviewGate', 'WorkspaceDataAbsorptionScopeGate', 'ReviewCoverageDelta'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['WorkspaceDataAbsorptionScopeGate', '.devcodex/*/data/'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'skills/test-router/SKILL.md', needles: ['workspaceDataAbsorption', 'docsSiteVisualAcceptance', 'methodLevelLeakPressure', 'v2FormalSolutionPackage'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['MethodLevelLeakPressureProbe', '公开方法', '生命周期'] },
      { file: 'skills/dev-scenario-test/SKILL.md', needles: ['MethodLevelLeakPressureProbe', 'methodLevelLeakPressure'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['FlowchartNodeExplanationGate', 'DocsSiteVisualAcceptanceGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'site-v2-leak'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['OmissionOnlyReviewGate', 'WorkspaceDataAbsorptionScopeGate'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['DocsSiteVisualAcceptanceGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['FlowchartNodeExplanationGate', 'DocsSiteVisualAcceptanceGate'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'prompts/requirement.prompt.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'V2FormalSolutionPackage'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['FlowchartNodeExplanationGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/specs/flowcharts.md', needles: ['FlowchartNodeExplanationGate', '中文说明'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['latest-data-absorption-guards', '最新 data 吸纳守门补强'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'V63 探针'] },
      { file: 'website/docs/versions/v2/2.0.0/index.md', needles: ['一期正式方案包', 'formal-solution-package'] },
      { file: 'website/docs/versions/v2/2.0.0/formal-solution-package.md', needles: ['V2FormalSolutionPackage', 'MCP API Contract', '节点说明'] },
      { file: 'website/rspress.config.ts', needles: ['latest-data-absorption-guards', 'formal-solution-package'] },
      { file: 'changelogs/unreleased.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV63', 'WorkspaceDataAbsorptionScopeGate', 'V2FormalSolutionPackage'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V63] latest data absorption guard drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'OmissionOnlyReviewGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V63] latest data absorption guard changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V63] latest data absorption guard sync checked')
  }

  function checkV64() {
    const probes = [
      { file: 'instructions.md', needles: ['ReviewFindingIntakeGate', 'DesignIntentAndDocsConsistencyGate', 'AuditReportIsSignalNotEvidence', 'IntentionalDesignClassification', 'UserDecisionBeforeMutation', 'DocsImplementationDriftAttribution', 'TestCoverageGapOnly'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['ReviewFindingIntakeGate', '审查发现 intake'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['ReviewFindingIntakeGate', 'user-decision-required', 'docs-implementation-drift', 'test-coverage-gap', 'intentional-design-accepted'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['ReviewFindingIntakeGate', 'AuditReportIsSignalNotEvidence', 'UserDecisionBeforeMutation', 'DocsImplementationDriftAttribution', 'TestCoverageGapOnly'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['ReviewFindingIntakeGate', 'DesignIntentAndDocsConsistencyGate', 'already-fixed-or-not-reproduced'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ReviewFindingIntakeGate', 'AuditReportIsSignalNotEvidence', 'IntentionalDesignClassification', 'TestCoverageGapOnly'] },
      { file: 'skills/analyze-research/SKILL.md', needles: ['ReviewFindingIntakeGate', 'must-fix', '未复现项'] },
      { file: 'skills/fix-default/SKILL.md', needles: ['ReviewFindingIntakeGate', '公共契约风险'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ReviewFindingIntakeGate', '审查发现 intake', 'runtime bug 修复'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['ReviewFindingIntakeGate', '文档/实现漂移'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['ReviewFindingIntakeGate', 'docs drift'] },
      { file: 'skills/audit-report/SKILL.md', needles: ['ReviewFindingIntakeGate', 'must-fix runtime bug'] },
      { file: 'skills/report/SKILL.md', needles: ['ReviewFindingIntakeGate', 'finding 来源'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'prompts/requirement.prompt.md', needles: ['ReviewFindingIntakeGate', 'intentional design'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['ReviewFindingIntakeGate', '文档实现漂移'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ReviewFindingIntakeGate', 'finding 来源'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'README.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'website/docs/guide/development.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['ReviewFindingIntakeGate', '报告只是线索'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['ReviewFindingIntakeGate', 'V64 探针'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['ReviewFindingIntakeGate', 'AuditReportIsSignalNotEvidence'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V64] review finding intake gate drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ReviewFindingIntakeGate', 'DesignIntentAndDocsConsistencyGate', 'PF-054', 'PI-051']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V64] review finding intake gate changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V64] review finding intake gate sync checked')
  }

  function checkV65() {
    const probes = [
      { file: 'instructions.md', needles: ['FigmaHighFidelityRestorationGate', 'ScopedVisualChangeGate', 'InstalledPluginVisualVerificationGate', 'ActualPreviewChainAndMockFallbackGate', 'UIStateScopeRegressionGate', 'FigmaProductionAssetBudgetGate', 'RuntimeI18nArtifactVerificationGate', 'ExplicitCommitAuthorizationGate', 'CompatibilityAndContractAuthorityGate', 'UIConfirmedSourceConflictTraceGate', 'PublicDocsReleasedVersionGate', 'CollectionRelationIdNamingGate', 'UserFacingVerificationArtifactLanguageGate'] },
      { file: 'instructions/01b-record-router.instructions.md', needles: ['ExplicitCommitAuthorizationGate', '只有用户当前会话明确要求'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['FigmaHighFidelityRestorationGate', 'ActualPreviewChainAndMockFallbackGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/test-router/SKILL.md', needles: ['highFidelityUi', 'actualPreviewChain', 'runtimeI18nArtifacts', 'commitAuthorization', 'compatibilityAuthority', 'publicDocsVersionBoundary'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['FigmaHighFidelityRestorationGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['CollectionRelationIdNamingGate', 'UserFacingVerificationArtifactLanguageGate'] },
      { file: 'skills/api-verification/SKILL.md', needles: ['UserFacingVerificationArtifactLanguageGate', '用户当前语言'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['PublicDocsReleasedVersionGate', 'UIConfirmedSourceConflictTraceGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['frontend-runtime', 'GovernanceGateRegistry'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['FigmaProductionAssetBudgetGate', 'ExplicitCommitAuthorizationGate'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['ActualPreviewChainAndMockFallbackGate', 'PublicDocsReleasedVersionGate'] },
      { file: 'skills/report/SKILL.md', needles: ['FigmaHighFidelityRestorationGate', 'CompatibilityAndContractAuthorityGate', 'CollectionRelationIdNamingGate'] },
      { file: 'prompts/requirement.prompt.md', needles: ['FigmaHighFidelityRestorationGate', 'ExplicitCommitAuthorizationGate', 'UserFacingVerificationArtifactLanguageGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['actualPreviewChain', 'RuntimeI18nArtifactVerificationGate', 'CompatibilityAndContractAuthorityGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['FigmaHighFidelityRestorationGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['FigmaHighFidelityRestorationGate', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['RuntimeI18nArtifactVerificationGate', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ActualPreviewChainAndMockFallbackGate', 'GovernanceGateRegistry'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'frontend-runtime'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'frontend-runtime'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['FigmaHighFidelityRestorationGate', 'ExplicitCommitAuthorizationGate', 'CompatibilityAndContractAuthorityGate'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V65 探针', 'PublicDocsReleasedVersionGate'] },
      { file: 'changelogs/unreleased.md', needles: ['V65', 'FigmaHighFidelityRestorationGate', 'CompatibilityAndContractAuthorityGate', 'PublicDocsReleasedVersionGate'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV65', 'FigmaHighFidelityRestorationGate', 'CompatibilityAndContractAuthorityGate'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V65] high-fidelity UI / commit authorization / compatibility gate drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['FigmaHighFidelityRestorationGate', 'ExplicitCommitAuthorizationGate', 'CompatibilityAndContractAuthorityGate', 'PublicDocsReleasedVersionGate', 'UserFacingVerificationArtifactLanguageGate']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V65] high-fidelity UI / commit authorization / compatibility changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V65] high-fidelity UI / commit authorization / compatibility sync checked')
  }

  function checkV66() {
    const probes = [
      { file: 'instructions.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'instructions/02-output-paths.instructions.md', needles: ['ArtifactLinkSetDedupeGate', '规范化绝对路径去重', '同一物理文件'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['ReviewDimensionDeltaGate', 'PreviousDimensionSet', 'CurrentDimensionFocus', 'RepeatedDimensionReason'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ReviewDimensionDeltaGate', 'PreviousDimensionSet', 'CurrentDimensionFocus', 'RepeatedDimensionReason'] },
      { file: 'skills/audit-execution-guide/SKILL.md', needles: ['ReviewDimensionDeltaGate', '维度焦点'] },
      { file: 'skills/test-router/SKILL.md', needles: ['reviewDimensionDelta', 'userPerspectiveDocs', 'docsConsumerSweep', 'artifactLinkDedupe', 'frontendRuntimeNetwork'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', '心智负担'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', '代码消费位置'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', '低心智负担'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', '普通使用者能看懂'] },
      { file: 'skills/report/SKILL.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'skills/memory/SKILL.md', needles: ['ArtifactLinkSetDedupeGate', 'canonical path'] },
      { file: 'prompts/requirement.prompt.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['reviewDimensionDelta', 'userPerspectiveDocs', 'docsConsumerSweep', 'artifactLinkDedupe', 'frontendRuntimeNetwork'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'ReviewDimensionDeltaGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['FrontendRuntimeNetworkProbeGate', 'GovernanceGateRegistry'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V66 探针', 'ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate'] },
      { file: 'changelogs/unreleased.md', needles: ['V66', 'ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate', 'PI-052', 'PF-056'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV66', 'ReviewDimensionDeltaGate', 'ArtifactLinkSetDedupeGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V66] review dimension / user docs / artifact dedupe / runtime network drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate', 'PI-052', 'PF-056']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V66] review dimension / user docs changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V66] review dimension / user docs / artifact dedupe / runtime network sync checked')
  }

  function checkV67() {
    const probes = [
      { file: 'instructions.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', '维护者验收', 'active requirement'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/test-router/SKILL.md', needles: ['publicDocsMaintainerBoundary', 'activeRequirementFinalResponse', 'PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', '维护者验收'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', '发布 checklist'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'skills/report/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'active requirement/task/bug id'] },
      { file: 'prompts/requirement.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'ActiveRequirementFinalResponseGate'] },
      { file: 'README.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'website/docs/guide/development.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'V67'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'V67 探针'] },
      { file: 'changelogs/unreleased.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'V67', 'PI-053', 'PI-054', 'PF-057', 'PF-058'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV67', 'PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V67] public user docs / active final response drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'PI-053', 'PI-054', 'PF-057', 'PF-058']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V67] public user docs / active final response changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V67] public user docs / active final response sync checked')
  }

  function checkV68() {
    const gates = [
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

    const probes = [
      { file: 'instructions.md', needles: gates },
      { file: 'instructions/02-output-paths.instructions.md', needles: ['OneOffRequirementScriptPlacementGate'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['RequirementPreConfirmGate', 'PackageAdapterPreConfirmEvidenceGate', 'VerificationCommandSideEffectGate'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['FindingProbeMatrixGate', 'GuardPolicyBypassMatrixGate', 'VerificationCommandSideEffectGate'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/test-router/SKILL.md', needles: gates.concat(['browserVerificationBudget', 'findingProbeMatrix', 'verificationCommandSideEffect']) },
      { file: 'skills/dev-default/SKILL.md', needles: ['DatabaseRecordMigrationExportGate', 'FrontendBrowserVerificationBudgetGate', 'RequirementPreConfirmGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'skills/fix-default/SKILL.md', needles: ['FindingProbeMatrixGate', 'GuardPolicyBypassMatrixGate', 'VerificationCommandSideEffectGate'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['FrontendBrowserVerificationBudgetGate', 'UserSelfVerificationOverrideGate', 'VerificationCommandSideEffectGate'] },
      { file: 'skills/dev-database/SKILL.md', needles: ['DatabaseRecordMigrationExportGate', 'OneOffRequirementScriptPlacementGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['SideEffectCompatibilityDocsGate', 'ExecutableExampleTruthProbeGate', 'RequirementPreConfirmGate'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['RequirementPreConfirmGate', 'PackageAdapterPreConfirmEvidenceGate', 'LatestAbsorptionGuards'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['RequirementPreConfirmGate', 'MultiPhaseClosureGate', 'DesignFramePurposeClassificationGate'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['FindingProbeMatrixGate', 'GuardPolicyBypassMatrixGate', 'VerificationCommandSideEffectGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['SideEffectCompatibilityDocsGate', 'ExecutableExampleTruthProbeGate'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['SideEffectCompatibilityDocsGate', 'ExecutableExampleTruthProbeGate'] },
      { file: 'skills/audit-tech-design/SKILL.md', needles: ['PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['DatabaseRecordMigrationExportGate', 'data-security-automation', 'release-package-contract'] },
      { file: 'skills/report/SKILL.md', needles: ['LatestAbsorptionGuards', 'DatabaseRecordMigrationExportGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'prompts/requirement.prompt.md', needles: ['RequirementPreConfirmGate', 'MultiPhaseClosureGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['LatestAbsorptionGuards', 'VisualDeviationTypeGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['LatestAbsorptionGuards', 'VerificationCommandSideEffectGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['LatestAbsorptionGuards', 'DatabaseRecordMigrationExportGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['LatestAbsorptionGuards', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['LatestAbsorptionGuards', 'RequirementPreConfirmGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['LatestAbsorptionGuards', 'FrontendBrowserVerificationBudgetGate'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['V68', 'DatabaseRecordMigrationExportGate', 'RequirementPreConfirmGate'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V68 探针', 'DatabaseRecordMigrationExportGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'changelogs/releases/v1.11.25.md', needles: ['V68', 'PI-071', 'PF-076', 'DatabaseRecordMigrationExportGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV68', 'DatabaseRecordMigrationExportGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V68] latest data absorption guards drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V68', 'PI-071', 'PF-076'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V68] latest data absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V68] latest data absorption guards sync checked')
  }

  function checkV69() {
    const gates = [
      'RequirementVerdictStateSyncGate',
      'UserDocsImmediateComprehensionGate',
      'UserDocsPrimarySurfaceGate'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(['targetSurface', 'documentLocation', 'primaryAudience=用户/使用者']) },
      { file: 'instructions/10-dev.instructions.md', needles: gates.concat(['首页首屏', '修复清单', 'SUMMARY']) },
      { file: 'instructions/11-fix.instructions.md', needles: gates.concat(['站点文档/README/接入手册不得把开发契约当用户主路径']) },
      { file: 'instructions/12-audit.instructions.md', needles: ['UserDocsImmediateComprehensionGate', 'UserDocsPrimarySurfaceGate', '首页首屏'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/dev-docs/SKILL.md', needles: gates.concat(['public docs site', 'requirement deliverable']) },
      { file: 'skills/readme-authoring/SKILL.md', needles: ['UserDocsPrimarySurfaceGate', 'UserDocsImmediateComprehensionGate', 'targetSurface'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['UserDocsImmediateComprehensionGate', 'UserDocsPrimarySurfaceGate', '未发布 runtime'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['UserDocsPrimarySurfaceGate', 'UserDocsImmediateComprehensionGate', '开发契约'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['RequirementVerdictStateSyncGate', 'UserDocsImmediateComprehensionGate', 'UserDocsPrimarySurfaceGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: gates.concat(['sessions / SUMMARY']) },
      { file: 'skills/test-router/SKILL.md', needles: gates.concat(['用户文档主面', '需求复审状态同步']) },
      { file: 'skills/report/SKILL.md', needles: gates.concat(['LatestAbsorptionGuards']) },
      { file: 'skills/memory/SKILL.md', needles: ['RequirementVerdictStateSyncGate', 'sessions', 'SUMMARY'] },
      { file: 'prompts/requirement.prompt.md', needles: gates },
      { file: 'prompts/technical-design.prompt.md', needles: gates.concat(['首页首屏']) },
      { file: 'prompts/implementation-plan.prompt.md', needles: gates.concat(['targetSurface']) },
      { file: 'prompts/report-dev.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate', '站点文档 / README / quick start'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate', '首页首屏'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V69']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: gates.concat(['V69 探针']) },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV69', 'UserDocsPrimarySurfaceGate', 'RequirementVerdictStateSyncGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V69] user docs primary surface / verdict-state sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V69', 'PI-072', 'PI-073', 'PI-074', 'PF-077', 'PF-078', 'PF-079', 'GR-015', 'GR-016'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V69] user docs primary surface changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V69] user docs primary surface / verdict-state sync checked')
  }

  function checkV70() {
    const gates = [
      'UserFacingDeliveryChainGate',
      'FinalUserManualFirstGate',
      'DocsSiteInformationArchitectureGate',
      'UserManualFlowAndFailureGate',
      'QueueDocsRealWorkflowGate',
      'ReviewChecklistCompletenessGate',
      'EvidenceExecutionGate',
      'BuiltArtifactFeatureSmokeGate',
      'TscOutputImportProbe',
      'GeneratedSiteGate',
      'ManualTocDuplicationGate',
      'UserPathContractSweep',
      'BenchmarkRegressionGuard'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(['用户最终使用文档', 'TypeScript', 'benchmark regression']) },
      { file: 'instructions/10-dev.instructions.md', needles: ['UserFacingDeliveryChainGate', 'BuiltArtifactFeatureSmokeGate', 'BenchmarkRegressionGuard'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['ReviewChecklistCompletenessGate', 'EvidenceExecutionGate', 'BuiltArtifactFeatureSmokeGate', 'TscOutputImportProbe', 'BenchmarkRegressionGuard'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['ReviewChecklistCompletenessGate', 'EvidenceExecutionGate', 'GeneratedSiteGate', 'ManualTocDuplicationGate', 'UserPathContractSweep'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/test-router/SKILL.md', needles: gates.concat(['userFacingDeliveryChain', 'reviewChecklistEvidence', 'builtArtifactFeatureSmoke', 'generatedSiteVerification', 'userPathContractSweep', 'benchmarkRegression']) },
      { file: 'skills/dev-docs/SKILL.md', needles: ['UserFacingDeliveryChainGate', 'FinalUserManualFirstGate', 'GeneratedSiteGate', 'ManualTocDuplicationGate', 'UserPathContractSweep'] },
      { file: 'skills/readme-authoring/SKILL.md', needles: ['UserFacingDeliveryChainGate', 'FinalUserManualFirstGate', 'UserPathContractSweep', 'QueueDocsRealWorkflowGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['FinalUserManualFirstGate', 'DocsSiteInformationArchitectureGate', 'UserManualFlowAndFailureGate', 'GeneratedSiteGate', 'ManualTocDuplicationGate', 'UserPathContractSweep'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['FinalUserManualFirstGate', 'DocsSiteInformationArchitectureGate', 'UserManualFlowAndFailureGate', 'QueueDocsRealWorkflowGate', 'UserPathContractSweep'] },
      { file: 'skills/document-sync/SKILL.md', needles: gates.concat(['不能只按审查报告文本验收']) },
      { file: 'skills/report/SKILL.md', needles: gates.concat(['LatestAbsorptionGuards']) },
      { file: 'prompts/technical-design.prompt.md', needles: ['userFacingDeliveryChain', 'reviewChecklistEvidence', 'builtArtifactFeatureSmoke', 'generatedSiteVerification', 'userPathContractSweep', 'benchmarkRegression'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'GeneratedSiteGate', 'BenchmarkRegressionGuard'] },
      { file: 'prompts/requirement.prompt.md', needles: ['UserFacingDeliveryChainGate', 'ReviewChecklistCompletenessGate', 'GeneratedSiteGate', 'BenchmarkRegressionGuard'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['UserFacingDeliveryChainGate', 'BuiltArtifactFeatureSmokeGate', 'BenchmarkRegressionGuard'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'BenchmarkRegressionGuard'] },
      { file: 'prompts/report-audit.prompt.md', needles: gates },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'BenchmarkRegressionGuard'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'BenchmarkRegressionGuard', '部署副本'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'BenchmarkRegressionGuard', '部署副本'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V70']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: gates.concat(['V70 探针']) },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV70', 'UserFacingDeliveryChainGate', 'BenchmarkRegressionGuard'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V70] user-facing delivery / evidence execution drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const ids = [
      'V70',
      'PI-075',
      'PI-076',
      'PI-077',
      'PI-078',
      'PF-080',
      'PF-081',
      'PF-082',
      'PF-083',
      'GR-017',
      'GR-018',
      'GAP-030',
      'GAP-031',
      'GAP-032',
      'GAP-033',
      'GAP-034',
      'GAP-035',
      'GAP-036',
      'PI-019',
      'PF-002'
    ]
    for (const needle of gates.concat(ids)) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V70] latest data absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V70] user-facing delivery / evidence execution guards sync checked')
  }

  function checkV71() {
    const gates = [
      'SkillFirstAbsorptionGate',
      'CapabilityToSkillPromotionGate',
      'SkillAbsorptionDecision'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(['new-skill-required', 'existing-skill-subgate', 'global-invariant']) },
      { file: 'instructions/10-dev.instructions.md', needles: gates.concat(['new-skill-required']) },
      { file: 'skills/spec-governance/SKILL.md', needles: gates.concat(['global-invariant', 'existing-skill-subgate', 'new-skill-required', 'docs-only']) },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['name: user-manual-authoring', 'UserFacingDeliveryChainGate', 'FinalUserManualFirstGate', 'UserPathContractSweep'] },
      { file: 'skills/review-checklist/SKILL.md', needles: ['name: review-checklist', 'ReviewChecklistPrecreationGate', 'EvidenceExecutionGate', 'ChecklistStateFreshnessGate'] },
      { file: 'plugin.json', needles: ['user-manual-authoring', 'skills/user-manual-authoring/SKILL.md', 'review-checklist', 'skills/review-checklist/SKILL.md'] },
      { file: 'skills/dev-default/SKILL.md', needles: gates.concat(['AbsorptionDecision']) },
      { file: 'skills/dev-docs/SKILL.md', needles: ['user-manual-authoring', '最终用户使用文档'] },
      { file: 'skills/readme-authoring/SKILL.md', needles: ['user-manual-authoring', 'README 专项分支'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['user-manual-authoring', '最终用户使用文档'] },
      { file: 'skills/routing/SKILL.md', needles: ['user-manual-authoring', 'review-checklist'] },
      { file: 'skills/test-router/SKILL.md', needles: ['SkillFirstAbsorptionGate', 'SkillAbsorptionDecision', 'user-manual-authoring', 'review-checklist'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['SkillFirstAbsorptionGate', 'user-manual-authoring', 'review-checklist'] },
      { file: 'skills/report/SKILL.md', needles: gates },
      { file: 'skills/audit-common/SKILL.md', needles: ['review-checklist', 'ChecklistStateFreshnessGate'] },
      { file: 'skills/audit-execution-guide/SKILL.md', needles: ['review-checklist', 'ReviewChecklistPrecreationGate'] },
      { file: 'skills/audit-release/SKILL.md', needles: ['review-checklist', 'RL-1~RL-10'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['SkillAbsorptionDecision', 'user-manual-authoring', 'review-checklist'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: gates.concat(['user-manual-authoring', 'review-checklist']) },
      { file: 'prompts/report-dev.prompt.md', needles: ['SkillFirstAbsorptionGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['SkillFirstAbsorptionGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['SkillFirstAbsorptionGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['SkillFirstAbsorptionGate'] },
      { file: 'README.md', needles: ['Skill-first 吸纳架构', 'user-manual-authoring', 'review-checklist'] },
      { file: 'website/docs/guide/development.md', needles: ['Skill-first 吸纳架构', 'user-manual-authoring', 'review-checklist'] },
      { file: 'website/docs/index.md', needles: ['77 个 Skills'] },
      { file: 'website/docs/intro/index.md', needles: ['77 个按需触发的工作流技能', 'user-manual-authoring', 'review-checklist'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['扁平一级 Skill（77 个）', 'user-manual-authoring', 'review-checklist'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V71', 'user-manual-authoring', 'review-checklist']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V71 探针', 'SkillFirstAbsorptionGate', 'user-manual-authoring', 'review-checklist'] },
      { file: 'changelogs/releases/v1.11.27.md', needles: gates.concat(['V71', 'PI-079', 'PI-080', 'PI-081', 'PF-084', 'PF-085', 'PF-086', 'user-manual-authoring', 'review-checklist']) },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV71', 'SkillFirstAbsorptionGate', 'user-manual-authoring', 'review-checklist'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V71] skill-first absorption architecture drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V71', 'PI-079', 'PI-080', 'PI-081', 'PF-084', 'PF-085', 'PF-086', 'user-manual-authoring', 'review-checklist'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V71] skill-first absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V71] skill-first absorption architecture sync checked')
  }

  function checkV72() {
    const gates = [
      'LayeredAbsorptionGate',
      'LayeredAbsorptionDecision',
      'ProactiveBetterAlternativeGate'
    ]
    const layerTerms = [
      'commonInstruction',
      'skill',
      'promptTemplate',
      'executionConsumer',
      'validationProbe',
      'publicDocs',
      'deployCopy'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(layerTerms).concat(['SkillAbsorptionDecision']) },
      { file: 'instructions/10-dev.instructions.md', needles: gates.concat(layerTerms).concat(['SkillFirstAbsorptionGate']) },
      { file: 'skills/spec-governance/SKILL.md', needles: gates.concat(layerTerms).concat(['skipReason']) },
      { file: 'skills/dev-default/SKILL.md', needles: gates.concat(layerTerms).concat(['SkillAbsorptionDecision']) },
      { file: 'skills/test-router/SKILL.md', needles: gates.concat(['layeredAbsorption', 'proactiveBetterAlternative', 'publicDocs', 'deployCopy']) },
      { file: 'skills/report/SKILL.md', needles: gates.concat(layerTerms).concat(['SkillAbsorptionDecision']) },
      { file: 'skills/document-sync/SKILL.md', needles: gates.concat(['prompts/templates', 'targeted tests', '部署副本']) },
      { file: 'prompts/technical-design.prompt.md', needles: gates.concat(layerTerms).concat(['SkillAbsorptionDecision']) },
      { file: 'prompts/implementation-plan.prompt.md', needles: gates.concat(layerTerms) },
      { file: 'prompts/report-dev.prompt.md', needles: gates.concat(['LayeredAbsorptionDecision']) },
      { file: 'prompts/report-fix.prompt.md', needles: gates.concat(['LayeredAbsorptionDecision']) },
      { file: 'prompts/report-audit.prompt.md', needles: gates.concat(['LayeredAbsorptionDecision']) },
      { file: 'prompts/report-scenario-test.prompt.md', needles: gates.concat(['LayeredAbsorptionDecision']) },
      { file: 'README.md', needles: gates.concat(['分层吸纳架构']) },
      { file: 'website/docs/guide/development.md', needles: gates.concat(['分层吸纳架构', 'prompts/templates']) },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V72', 'layerChecks']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: gates.concat(['V72 探针']) },
      { file: 'changelogs/releases/v1.11.27.md', needles: gates.concat(['V72', 'PI-082', 'PI-083', 'PF-087', 'PF-088']) },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV72', 'LayeredAbsorptionGate', 'ProactiveBetterAlternativeGate'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V72] layered absorption architecture drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V72', 'PI-082', 'PI-083', 'PF-087', 'PF-088'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V72] layered absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V72] layered absorption and proactive alternative sync checked')
  }

  function checkV73() {
    const gates = [
      'ConfirmedAbsorptionCompletenessGates',
      'PublicSurfaceClosureGate',
      'UserManualProductizationGate',
      'UserManualRenderedFlowAndRealWorkflowProbe',
      'SampleIssueExpansionGate',
      'RequirementDimensionBindingGate',
      'RequirementPriorityAndPhaseGate',
      'ReviewAnchorMaterializationGate',
      'SemanticLegacyRouteExposureGate',
      'ReferenceCodeTruthSamplingGate',
      'FrontendAsyncCacheRenderGate',
      'StaleWhileRevalidateGate',
      'PortableExternalArtifactGate',
      'StrongestProfileSourceGate',
      'ServiceSpecificResidueSweep',
      'ProfileReadChainGate',
      'ServiceNormCoverageGate',
      'RouteNamespaceResponsibilityGate',
      'RemoteCIParityPushGate',
      'OfficialApiEvidenceGate',
      'AsyncDbTruthSourceVerificationGate',
      'DocsPageRoleMatrixGate',
      'CompleteUserManualSiteMatrixGate',
      'EvolutionCapabilityControlPlaneGate',
      'FrameworkCapabilityAutoFirstGate',
      'DocsThemeRuntimeVisualProbeGate'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(['evolution-governance']) },
      { file: 'skills/spec-governance/SKILL.md', needles: gates.concat(['evolution-governance']) },
      { file: 'skills/evolution-governance/SKILL.md', needles: ['name: evolution-governance', 'EvolutionCapabilityControlPlaneGate', 'candidate-only', 'modelProviderConfig', 'releaseApproval'] },
      { file: 'plugin.json', needles: ['evolution-governance', 'skills/evolution-governance/SKILL.md'] },
      { file: 'skills/routing/SKILL.md', needles: ['evolution-governance', 'EvolutionCapabilityControlPlaneGate'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'EvolutionCapabilityControlPlaneGate', 'FrontendAsyncCacheRenderGate', 'RemoteCIParityPushGate'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['UserManualProductizationGate', 'UserManualRenderedFlowAndRealWorkflowProbe', 'DocsPageRoleMatrixGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/review-checklist/SKILL.md', needles: ['SampleIssueExpansionGate', 'ReviewAnchorMaterializationGate', 'RequirementDimensionBindingGate'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['SampleIssueExpansionGate', 'RequirementDimensionBindingGate', 'RequirementPriorityAndPhaseGate'] },
      { file: 'skills/audit-tech-design/SKILL.md', needles: ['ReviewAnchorMaterializationGate', 'OfficialApiEvidenceGate', 'FrameworkCapabilityAutoFirstGate'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['SemanticLegacyRouteExposureGate', 'ReferenceCodeTruthSamplingGate', 'FrontendAsyncCacheRenderGate', 'PortableExternalArtifactGate'] },
      { file: 'skills/audit-release/SKILL.md', needles: ['PublicSurfaceClosureGate', 'RemoteCIParityPushGate'] },
      { file: 'skills/release-verification/SKILL.md', needles: ['PublicSurfaceClosureGate', 'RemoteCIParityPushGate'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['ProfileReadChainGate', 'ServiceNormCoverageGate', 'StrongestProfileSourceGate'] },
      { file: 'skills/profile-bootstrap/SKILL.md', needles: ['ProfileReadChainGate', 'ServiceNormCoverageGate', 'ServiceSpecificResidueSweep'] },
      { file: 'skills/api-verification/SKILL.md', needles: ['OfficialApiEvidenceGate', 'AsyncDbTruthSourceVerificationGate', 'StaleWhileRevalidateGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['UserManualProductizationGate', 'UserManualRenderedFlowAndRealWorkflowProbe', 'CompleteUserManualSiteMatrixGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['UserManualProductizationGate', 'UserManualRenderedFlowAndRealWorkflowProbe', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['UserManualProductizationGate', 'DocsPageRoleMatrixGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['RequirementDimensionBindingGate', 'OfficialApiEvidenceGate', 'EvolutionCapabilityControlPlaneGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'FrontendAsyncCacheRenderGate', 'RemoteCIParityPushGate', 'EvolutionCapabilityControlPlaneGate'] },
      { file: 'skills/report/SKILL.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'public-surface', 'user-manual', 'review-checklist', 'frontend-runtime', 'profile-service', 'evolution-control-plane', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'public-surface', 'user-manual', 'review-checklist', 'frontend-runtime', 'profile-service', 'evolution-control-plane', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'public-surface', 'user-manual', 'review-checklist', 'frontend-runtime', 'profile-service', 'evolution-control-plane', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'public-surface', 'user-manual', 'review-checklist', 'frontend-runtime', 'profile-service', 'evolution-control-plane', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'FrontendAsyncCacheRenderGate', 'RemoteCIParityPushGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'GovernanceGateRegistry', 'evolution-control-plane'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'GovernanceGateRegistry', 'frontend-runtime'] },
      { file: 'README.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'evolution-governance', '77 个'] },
      { file: 'website/docs/index.md', needles: ['77 个 Skills'] },
      { file: 'website/docs/intro/index.md', needles: ['77 个按需触发的工作流技能', 'evolution-governance'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['扁平一级 Skill（77 个）', 'evolution-governance'] },
      { file: 'website/docs/guide/development.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'evolution-governance'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V73', 'evolution-governance']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V73 探针', 'ConfirmedAbsorptionCompletenessGates', 'evolution-governance'] },
      { file: 'changelogs/releases/v1.11.27.md', needles: gates.concat(['V73', 'evolution-governance']) },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV73', 'ConfirmedAbsorptionCompletenessGates', 'evolution-governance'] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V73] confirmed absorption completeness drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V73', 'evolution-governance'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V73] confirmed absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V73] confirmed absorption completeness and evolution governance sync checked')
  }

  function checkV74() {
    const gate = 'HistoricalCommonNormLayeringGate'
    const coreTerms = [gate, '逐文件审查矩阵', 'legacy-index-retained']

    const probes = [
      { file: 'instructions.md', needles: coreTerms.concat(['targetLayer']) },
      { file: 'instructions/10-dev.instructions.md', needles: [gate, 'LayeredAbsorptionDecision', '逐文件审查矩阵'] },
      { file: 'skills/spec-governance/SKILL.md', needles: coreTerms.concat(['currentRole', 'matchedRules', 'targetOwner', 'semanticStrength']) },
      { file: 'skills/test-router/SKILL.md', needles: [gate, 'historicalCommonNormLayering', 'V74', 'ProfileImpactCheck'] },
      { file: 'skills/report/SKILL.md', needles: coreTerms.concat(['V74', 'deploy copy']) },
      { file: 'skills/document-sync/SKILL.md', needles: coreTerms.concat(['active version requirements']) },
      { file: 'skills/source-consumer-sync/SKILL.md', needles: [gate, 'V74 历史通用规范分层同步面', 'historicalMirrors', 'checkV74'] },
      { file: 'prompts/technical-design.prompt.md', needles: [gate, '逐文件审查矩阵', 'Prompt 只写字段和引用'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: [gate, '逐文件审查矩阵', 'Prompt/Report 只保留字段'] },
      { file: 'prompts/report-dev.prompt.md', needles: [gate, 'legacy-index-retained', 'V74'] },
      { file: 'prompts/report-fix.prompt.md', needles: [gate, 'legacy-index-retained', 'V74'] },
      { file: 'prompts/report-audit.prompt.md', needles: [gate, 'legacy-index-retained', 'V74'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: [gate, 'legacy-index-retained', 'V74'] },
      { file: 'README.md', needles: [gate, '历史通用规范分层迁移', 'V74'] },
      { file: 'website/docs/guide/development.md', needles: [gate, '历史通用规范分层迁移', 'V74'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: [gate, 'V74', '逐文件审查矩阵'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V74 探针', gate] },
      { file: 'changelogs/releases/v1.11.27.md', needles: [gate, 'V74', '历史通用规范分层迁移'] },
      { file: 'scripts/lib/test-spec-governance-base.js', needles: ['checkV74', gate] },
      { file: 'scripts/validate.js', needles: ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V74] historical common norm layering drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of [gate, 'V74', '历史通用规范分层迁移']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V74] historical common norm layering changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V74] historical common norm layering sync checked')
  }

  // __FUNCTIONS__

  return {
    checkV55, checkV56, checkV57, checkV58, checkV59, checkV60, checkV61, checkV62,
    checkV63, checkV64, checkV65, checkV66, checkV67, checkV68, checkV69, checkV70,
    checkV71, checkV72, checkV73, checkV74
  }
}

module.exports = { buildGovernanceQualityChecks }
