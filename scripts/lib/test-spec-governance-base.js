'use strict'

function runSpecGovernanceBaseSuite(ctx) {
  const {
    ROOT, fs, path, failures, SOURCE_PROJECT_NAME, read, mustInclude,
    mustNotInclude, collectChangelogContents, mustIncludeInChangelogs
  } = ctx

  const probes = [
    ['skills/spec-governance/SKILL.md', 'RecordRouter'],
    ['skills/spec-governance/SKILL.md', 'SCV-0'],
    ['skills/spec-governance/SKILL.md', 'record.violation'],
    ['skills/spec-governance/SKILL.md', 'record.ambiguous'],
    ['skills/spec-governance/SKILL.md', 'PostAssessmentGovernanceIntakeGate'],
    ['skills/spec-governance/SKILL.md', 'ContextualCandidateSet'],
    ['skills/spec-governance/SKILL.md', 'CompoundRecordRouterGate'],
    ['skills/spec-governance/SKILL.md', 'LedgerWriteEvidenceGate'],
    ['skills/spec-governance/SKILL.md', 'RecordNoneChallengeGate'],
    ['skills/spec-governance/SKILL.md', 'VL/PF 关闭前必须具备修复方案'],
    ['skills/spec-governance/SKILL.md', '当前 DevCodex 源仓或规范维护项目的 active-root'],
    ['skills/spec-governance/SKILL.md', 'Concept Sync Map'],
    ['skills/spec-governance/SKILL.md', 'currentConsumers'],
    ['skills/spec-governance/SKILL.md', 'yellowDeviationBoundary'],
    ['skills/spec-governance/SKILL.md', 'GovernanceGateRegistry'],
    ['skills/spec-governance/SKILL.md', 'review-escape'],
    ['skills/spec-governance/SKILL.md', 'Improvement Intake（优化清单）'],
    ['skills/spec-governance/SKILL.md', '在所有模式下'],
    ['skills/spec-governance/SKILL.md', 'PI + PF'],
    ['skills/spec-governance/SKILL.md', '已记录 PI-xxx'],
    ['skills/spec-governance/SKILL.md', 'Backlog Intake 真相复核'],
    ['skills/spec-governance/SKILL.md', 'pure-open'],
    ['skills/spec-governance/SKILL.md', '台账状态回写闭环'],
    ['skills/source-consumer-sync/SKILL.md', 'ConceptSyncMap'],
    ['skills/source-consumer-sync/SKILL.md', 'historicalMirrors'],
    ['skills/source-consumer-sync/SKILL.md', 'deployCopies'],
    ['skills/host-contract-verification/SKILL.md', 'HostContractRoute'],
    ['skills/host-contract-verification/SKILL.md', 'visibleReplyEvidence'],
    ['skills/host-contract-verification/SKILL.md', 'workspaceGuard'],
    ['skills/host-contract-verification/SKILL.md', 'artifactLinkMatrix'],
    ['skills/host-contract-verification/SKILL.md', 'mcpFallback'],
    ['instructions.md', '规范治理生命周期（RecordRouter + SCV）'],
    ['instructions.md', 'Context Rehydration Contract'],
    ['instructions.md', 'ContextHandoffCard'],
    ['instructions.md', 'SimpleTaskFastPath'],
    ['instructions.md', 'ExistingRequirementArtifactOverride'],
    ['instructions.md', 'ArtifactDecisionMatrix'],
    ['instructions.md', 'ArtifactLifecycleState'],
    ['instructions.md', 'dev 模式默认应向用户展示完整 Intent Expansion Card'],
    ['instructions.md', 'Improvement Intake（优化清单）'],
    ['instructions.md', '在所有模式下，每条用户消息在完成合理性评估后'],
    ['instructions.md', 'PostAssessmentGovernanceIntakeGate'],
    ['instructions.md', 'LedgerWriteEvidenceGate'],
    ['instructions.md', 'RecordNoneChallengeGate'],
    ['instructions.md', 'VL/PF 关闭前必须具备修复方案'],
    ['instructions.md', 'Backlog Intake 真相复核'],
    ['instructions.md', 'already-fixed'],
    ['instructions.md', '台账状态回写闭环'],
    ['instructions.md', '登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间'],
    ['instructions.md', 'ArtifactLinkSet'],
    ['instructions.md', 'mcpFallback=used'],
    ['instructions/01-common.instructions.md', '单源聚合文件'],
    ['instructions/01-common.instructions.md', 'Context Rehydration Contract'],
    ['instructions/01-common.instructions.md', '01a-profile-loading.instructions.md'],
    ['instructions/01-common.instructions.md', '01b-record-router.instructions.md'],
    ['instructions/01-common.instructions.md', '01c-intent-expansion.instructions.md'],
    ['instructions/01a-profile-loading.instructions.md', '项目现实扩展（Project Reality Expansion）'],
    ['instructions/01a-profile-loading.instructions.md', '.devcodex/workspace/profile/'],
    ['instructions/01b-record-router.instructions.md', 'Improvement Intake（优化清单）'],
    ['instructions/01b-record-router.instructions.md', '已记录 PI-xxx'],
    ['instructions/01b-record-router.instructions.md', 'Backlog Intake 真相复核'],
    ['instructions/01b-record-router.instructions.md', 'misclassified'],
    ['instructions/01b-record-router.instructions.md', '台账状态回写闭环'],
    ['instructions/01b-record-router.instructions.md', '登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间'],
    ['instructions/01c-intent-expansion.instructions.md', 'Intent Expansion Card'],
    ['instructions/01c-intent-expansion.instructions.md', 'Context Rehydration Contract'],
    ['instructions/01c-intent-expansion.instructions.md', 'ContextHandoffCard（上下文传递/交接）'],
    ['instructions/02-output-paths.instructions.md', 'SimpleTaskFastPath'],
    ['instructions/02-output-paths.instructions.md', 'ExistingRequirementArtifactOverride'],
    ['instructions/02-output-paths.instructions.md', 'ArtifactDecisionMatrix'],
    ['instructions/10-dev.instructions.md', '执行期 CP3 回退'],
    ['instructions/10-dev.instructions.md', 'SimpleTaskFastPath（简单任务轻路径）'],
    ['instructions/10-dev.instructions.md', 'ExistingRequirementArtifactOverride'],
    ['instructions/10-dev.instructions.md', 'ArtifactDecisionMatrix'],
    ['instructions/10-dev.instructions.md', 'backlog 来源前置真相复核'],
    ['instructions/11-fix.instructions.md', '执行期 CP3 回退'],
    ['instructions/11-fix.instructions.md', 'SimpleTaskFastPath'],
    ['instructions/11-fix.instructions.md', 'ExistingRequirementArtifactOverride'],
    ['instructions/11-fix.instructions.md', 'ArtifactDecisionMatrix'],
    ['instructions/11-fix.instructions.md', 'backlog 来源前置真相复核'],
    ['instructions/15-memory.instructions.md', 'Context Rehydration Contract（记忆侧）'],
    ['instructions/15-memory.instructions.md', 'ContextHandoffCard（记忆侧）'],
    ['instructions/16-report.instructions.md', 'ContextHandoffCard'],
    ['skills/cp-gate/SKILL.md', 'SimpleTaskFastPath'],
    ['skills/cp-gate/SKILL.md', 'ExistingRequirementArtifactOverride'],
    ['skills/cp-gate/SKILL.md', 'ArtifactDecisionMatrix'],
    ['skills/memory/SKILL.md', 'ContextHandoffCard'],
    ['skills/report/SKILL.md', 'ContextHandoffCard'],
    ['skills/dev-default/SKILL.md', '执行期 CP3 回退（F-26）'],
    ['skills/fix-default/SKILL.md', '执行期 CP3 回退'],
    ['skills/execution-contract/SKILL.md', 'regressionMatrix'],
    ['skills/execution-contract/SKILL.md', 'backlogTruthReview'],
    ['skills/execution-contract/SKILL.md', 'ledgerWriteback'],
    ['skills/test-router/SKILL.md', 'regressionChecks'],
    ['instructions/tenants/README.md', 'example-tenant'],
    ['instructions/tenants/example-tenant/README.md', '示例租户'],
    ['instructions/tenants/example-tenant/10-dev.instructions.md', '局部覆盖示例'],
    ['assets/hooks/README.md', 'Hooks 运行时相关的源码/模板占位目录'],
    ['codex/README.md', '源模板目录'],
    ['README.md', '不是工作区部署副本 `.codex/`'],
    ['prompts/precheck-status.prompt.md', 'Context Rehydration Contract'],
    ['instructions/18-spec-radar.instructions.md', 'Intent Detection → RecordRouter'],
    ['instructions/18-spec-radar.instructions.md', 'RecordRouter / Improvement Intake'],
    ['instructions/18-spec-radar.instructions.md', 'PostAssessmentGovernanceIntakeGate'],
    ['website/docs/specs/directory-structure.md', '01a-profile-loading.instructions.md'],
    ['website/docs/specs/directory-structure.md', '01b-record-router.instructions.md'],
    ['website/docs/specs/directory-structure.md', '01c-intent-expansion.instructions.md'],
    ['instructions/14-self-fix.instructions.md', 'T_RECORD / RecordRouter'],
    ['skills/intent/SKILL.md', 'record.spec-defect'],
    ['skills/intent/SKILL.md', 'GovernanceIntakeDecision'],
    ['skills/analyze-default/SKILL.md', 'A5a 治理评估'],
    ['skills/compliance/SKILL.md', 'GovernanceIntakeClosureGate'],
    ['skills/report/SKILL.md', 'GovernanceIntakeDecision'],
    ['skills/memory/SKILL.md', 'Governance Intake'],
    ['prompts/report-analysis.prompt.md', 'GovernanceIntakeDecision'],
    ['skills/cp-gate/SKILL.md', 'backlog 来源前置真相复核'],
    ['data/templates/violations.md', 'record.violation'],
    ['data/templates/violations.md', '验证证据'],
    ['data/templates/violations.md', '关闭时间'],
    ['data/templates/violations.md', '登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间'],
    ['data/templates/pending-fixes.md', 'record.spec-defect'],
    ['data/templates/pending-fixes.md', 'SCV要求'],
    ['data/templates/pending-fixes.md', '验证证据'],
    ['data/templates/pending-fixes.md', '登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间'],
    ['data/templates/process-improvements.md', 'record.process-improvement'],
    ['data/templates/process-improvements.md', '优化清单'],
    ['data/templates/process-improvements.md', '关联缺口'],
    ['data/templates/pending-issues.md', 'record.pending-issue'],
    ['data/templates/gap-registry.md', 'record.audit-gap'],
    ['data/README.md', '优化清单（PI）'],
    ['data/README.md', '旧 `.devcodex/.maintainer-state/` 只作为历史迁移口径'],
    ['skills/report/SKILL.md', 'SCV-0~SCV-7'],
    ['skills/report/SKILL.md', 'ConceptSyncMap'],
    ['skills/report/SKILL.md', 'HostContractVerification'],
    ['skills/report/SKILL.md', 'Backlog Intake 真相复核'],
    ['skills/report/SKILL.md', '台账状态回写闭环'],
    ['skills/audit-release/SKILL.md', 'RL-1 版本身份'],
    ['skills/audit-release/SKILL.md', 'RL-4 元数据完整性'],
    ['skills/audit-release/SKILL.md', '远端 CI 绿色'],
    ['skills/audit-release/SKILL.md', 'RL-10 发布后验收'],
    ['skills/release-verification/SKILL.md', 'R3c'],
    ['skills/release-verification/SKILL.md', '远端 CI'],
    ['instructions/01-common.instructions.md', 'audit.发布前审查'],
    ['instructions/12-audit.instructions.md', '发布前审查（RL-1~RL-10）'],
    ['skills/routing/SKILL.md', 'skills/audit-release/SKILL.md'],
    ['skills/routing/SKILL.md', 'skills/analyze-default/SKILL.md'],
    ['skills/analyze-default/SKILL.md', 'analyze.default'],
    ['skills/analyze-default/SKILL.md', 'PCV-1'],
    ['skills/analyze-default/SKILL.md', 'AnalyzeLiteCRSGate'],
    ['skills/analyze-default/SKILL.md', 'GovernanceGateRegistryRef'],
    ['skills/compliance/SKILL.md', 'SpecRadarSubgate'],
    ['skills/compliance/SKILL.md', 'GovernanceGateRegistry'],
    ['skills/report/SKILL.md', 'ReleaseAudit'],
    ['prompts/report-audit.prompt.md', '发布前审查(RL-1~RL-10)'],
    ['README.md', 'audit-release'],
    ['README.md', '明确自然语言 auto'],
    ['website/docs/guide/release.md', 'RL-1~RL-10'],
    ['website/docs/guide/release.md', '远端 CI'],
    ['prompts/implementation-plan.prompt.md', 'Backlog Intake 真相复核'],
    ['prompts/implementation-plan.prompt.md', 'SimpleTaskFastPath'],
    ['prompts/implementation-plan.prompt.md', 'ExistingRequirementArtifactOverride'],
    ['prompts/implementation-plan.prompt.md', 'ArtifactDecisionMatrix'],
    ['prompts/implementation-plan.prompt.md', 'ContextHandoffCard'],
    ['prompts/implementation-plan.prompt.md', '台账状态回写闭环'],
    ['prompts/implementation-progress.prompt.md', 'Backlog Intake 真相复核'],
    ['prompts/implementation-progress.prompt.md', '台账状态回写闭环'],
    ['prompts/report-dev.prompt.md', 'Backlog Intake 真相复核'],
    ['prompts/report-dev.prompt.md', '台账状态回写闭环'],
    ['prompts/report-fix.prompt.md', 'Backlog Intake 真相复核'],
    ['prompts/report-fix.prompt.md', '台账状态回写闭环'],
    ['README.md', 'Backlog 真相复核与状态回写'],
    ['README.md', '产物文件链接兼容'],
    ['website/docs/guide/development.md', 'Backlog Intake 真相复核'],
    ['website/docs/guide/development.md', 'ArtifactLinkSet'],
    ['scripts/test-client-contracts.js', 'Client contract checks passed'],
    ['codex/hooks.json', 'PreCompact'],
    ['codex/hooks.json', 'manual|auto'],
    ['scripts/test-cli-behavior.js', 'PreCompact'],
    ['scripts/lib/validate-governance-intake.js', 'checkV52'],
    ['instructions/00-safety.instructions.md', 'S02 用户策略优先的敏感信息与硬编码模型'],
    ['instructions/00-safety.instructions.md', '默认允许'],
    ['instructions/01-common.instructions.md', 'S02 用户 / 项目敏感信息策略'],
    ['skills/dev-plan-review/SKILL.md', '敏感信息、明文连接信息或硬编码处理是否符合用户 / 项目显式策略'],
    ['scripts/lib/validate-governance-intake.js', 'stale S02 wording'],
    ['scripts/validate-profile.js', 'STALE_S02_PROFILE_PATTERNS'],
    ['scripts/test-validate-profile.js', 'staleS02ProfileText'],
    ['skills/load-profile/SKILL.md', '用户 / 项目指定时使用的本地 overlay'],
    ['skills/api-verification/SKILL.md', '@token = replace-with-token-if-required'],
    ['prompts/api-verification.prompt.md', '@language = zh-CN'],
    ['changelogs/README.md', 'changelogs/releases/vX.Y.Z.md'],
    ['CHANGELOG.md', './changelogs/releases/v1.11.5.md'],
    ['skills/audit-common/SKILL.md', 'Profile Freshness Check'],
    ['skills/audit-project/SKILL.md', 'PE-0 Profile Freshness'],
    ['scripts/lib/validate-governance-intake.js', 'checkV53'],
    ['instructions.md', 'OfficialDocsEvidence'],
    ['instructions.md', 'ProfileImpactCheck'],
    ['instructions/01b-record-router.instructions.md', 'OfficialDocsEvidence'],
    ['instructions/01b-record-router.instructions.md', 'ProfileImpactCheck'],
    ['instructions/10-dev.instructions.md', 'OfficialDocsEvidence'],
    ['instructions/10-dev.instructions.md', 'ProfileImpactCheck'],
    ['instructions/11-fix.instructions.md', 'OfficialDocsEvidence'],
    ['instructions/11-fix.instructions.md', 'ProfileImpactCheck'],
    ['skills/dev-plan-review/SKILL.md', 'OfficialDocsEvidence'],
    ['skills/dev-plan-review/SKILL.md', 'ProfileImpactCheck'],
    ['skills/document-sync/SKILL.md', 'ProfileImpactCheck'],
    ['skills/test-router/SKILL.md', 'OfficialDocsEvidence'],
    ['skills/report/SKILL.md', 'ProfileImpactCheck'],
    ['prompts/technical-design.prompt.md', 'OfficialDocsEvidence'],
    ['prompts/technical-design.prompt.md', '§1.5 ProfileImpactCheck'],
    ['prompts/implementation-plan.prompt.md', 'OfficialDocsEvidence'],
    ['prompts/implementation-progress.prompt.md', 'ProfileImpactCheck'],
    ['prompts/report-dev.prompt.md', 'OfficialDocsEvidence'],
    ['prompts/report-fix.prompt.md', 'ProfileImpactCheck'],
    ['README.md', '官方文档证据前置'],
    ['website/docs/guide/development.md', 'OfficialDocsEvidence'],
    ['scripts/lib/validate-governance-intake.js', 'checkV54'],
    ['scripts/lib/validate-governance-helpers.js', 'collectChangelogSources'],
    ['scripts/lib/validate-governance-intake.js', 'changelogs/releases/v'],
    ['README.md', 'PreCompact'],
    ['website/docs/guide/development.md', 'PreCompact'],
    ['instructions.md', 'ServiceLifecycleCleanup'],
    ['instructions.md', 'C22'],
    ['instructions/01-common.instructions.md', 'AI 自启动服务清理'],
    ['skills/test-router/SKILL.md', 'cleanupEvidence'],
    ['skills/dev-testing/SKILL.md', '不得静默遗留后台进程'],
    ['prompts/implementation-plan.prompt.md', 'ServiceLifecycleCleanup'],
    ['scripts/lib/validate-governance-quality.js', 'checkV55'],
    ['README.md', 'AI 自启动服务清理'],
    ['website/docs/guide/development.md', 'ServiceLifecycleCleanup'],
    ['instructions.md', 'CP1 需求/问题定义必须前置平台工程判断'],
    ['instructions/10-dev.instructions.md', '包边界验证串行化'],
    ['instructions/10-dev.instructions.md', '消费者依赖树优先探针'],
    ['skills/test-router/SKILL.md', 'PackageBoundarySerialCheck'],
    ['skills/test-router/SKILL.md', 'ConsumerDependencyTreeProbe'],
    ['skills/release-verification/SKILL.md', '发布型 Profile'],
    ['skills/audit-common/SKILL.md', 'PFresh-6'],
    ['skills/document-sync/SKILL.md', '正文顺序 → 导航/sidebar 顺序'],
    ['prompts/requirement.prompt.md', '写需求和定义问题时必须前置平台工程师视角'],
    ['prompts/requirement.prompt.md', 'ImplementationComplexityLevel'],
    ['prompts/requirement.prompt.md', '简单够用'],
    ['prompts/requirement.prompt.md', '中等` / `企业级`'],
    ['prompts/requirement.prompt.md', 'ExistingRequirementArtifactOverride'],
    ['prompts/requirement.prompt.md', 'ArtifactDecisionMatrix'],
    ['prompts/requirement-overview.prompt.md', '需求概况模板'],
    ['prompts/requirement-overview.prompt.md', '纯新需求'],
    ['prompts/requirement-overview.prompt.md', '用户 / 运营 / 老板 / 客户 / 内部使用方'],
    ['prompts/requirement-overview.prompt.md', '不得把 Bug 修复或需求变更塞进本文件'],
    ['prompts/requirement-overview.prompt.md', '不填写验收标准'],
    ['prompts/requirement-overview.prompt.md', '不填写数据库字段、接口 Schema'],
    ['prompts/requirement-overview.prompt.md', '不得把本文件缺失的信息静默补成产品事实源'],
    ['prompts/requirement-overview.prompt.md', '没有 / 不知道 / 暂无 / 需要产品帮忙整理'],
    ['prompts/requirement-overview.prompt.md', '你希望系统帮你做到什么'],
    ['prompts/requirement-overview.prompt.md', '现在你们怎么凑合处理'],
    ['prompts/requirement-overview.prompt.md', '有哪些必须遵守的业务口径'],
    ['prompts/requirement-overview.prompt.md', '给一个你希望出现的例子'],
    ['prompts/requirement-overview.prompt.md', '给一个你不能接受的例子'],
    ['prompts/product-requirement.prompt.md', '产品完整需求模板'],
    ['prompts/product-requirement.prompt.md', '01-产品需求.md'],
    ['prompts/product-requirement.prompt.md', '产品直接提供完整需求'],
    ['prompts/product-requirement.prompt.md', 'AI / 研发只做缺口 / 冲突检查和澄清'],
    ['prompts/product-requirement.prompt.md', '缺口检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不放入产品填写模板正文'],
    ['prompts/product-requirement.prompt.md', '不生成或重写产品需求'],
    ['prompts/product-requirement.prompt.md', '产品不填写验收标准'],
    ['prompts/product-requirement.prompt.md', '数据库字段、接口 Schema'],
    ['prompts/product-requirement.prompt.md', 'Mermaid 主流程图'],
    ['prompts/product-requirement.prompt.md', '前端交互'],
    ['prompts/product-requirement.prompt.md', '字段描述（非数据库字段）'],
    ['instructions.md', '产品模板正文只给产品填写完整 PRD'],
    ['instructions/02-output-paths.instructions.md', '产品模板正文只给产品填写完整 PRD'],
    ['instructions/10-dev.instructions.md', '产品模板正文只承载产品完整 PRD'],
    ['skills/dev-default/SKILL.md', '产品模板正文只给产品填写完整 PRD'],
    ['skills/audit-requirements/SKILL.md', '不写入产品模板正文'],
    ['skills/test-router/SKILL.md', '不写入产品模板正文'],
    ['prompts/cp-checklist.prompt.md', '产品模板正文只给产品填写完整 PRD'],
    ['website/docs/guide/requirements.md', 'AI / 研发缺口检查表'],
    ['website/docs/guide/development.md', '01-产品需求.md'],
    ['hooks/_runtime/lifecycle.cjs', '01-产品需求.md'],
    ['scripts/instruction-fallback-check.js', '01-产品需求.md'],
    ['scripts/lib/requirement-artifact-check.js', '01-产品需求.md'],
    ['prompts/requirement-change-overview.prompt.md', '需求变更概况模板'],
    ['prompts/requirement-change-overview.prompt.md', '原需求基线'],
    ['prompts/requirement-change-overview.prompt.md', '变更前后差异'],
    ['prompts/requirement-change-overview.prompt.md', '不得把需求变更当成纯新需求'],
    ['prompts/bug-overview.prompt.md', 'Bug 问题概况模板'],
    ['prompts/bug-overview.prompt.md', '重现步骤'],
    ['prompts/bug-overview.prompt.md', '期望行为'],
    ['prompts/bug-overview.prompt.md', '实际行为'],
    ['prompts/bug-overview.prompt.md', '不得把 Bug 当成产品需求'],
    ['prompts/requirement.prompt.md', '需求确认模板'],
    ['prompts/requirement.prompt.md', '00-需求概况.md'],
    ['prompts/requirement.prompt.md', '00-需求变更概况.md'],
    ['prompts/requirement.prompt.md', '00-问题概况.md'],
    ['prompts/requirement.prompt.md', '01-需求确认.md'],
    ['prompts/requirement.prompt.md', '01-需求变更确认.md'],
    ['prompts/requirement.prompt.md', '需求概况来源锚点'],
    ['prompts/requirement.prompt.md', 'AI / 产品整理与双方确认'],
    ['prompts/requirement.prompt.md', '需求方 + 产品双方确认'],
    ['prompts/requirement.prompt.md', '产品需求是业务事实源'],
    ['prompts/requirement.prompt.md', '产品不填写验收标准'],
    ['prompts/requirement.prompt.md', 'Mermaid 主流程图 + 文字步骤图 + 节点解释'],
    ['prompts/requirement.prompt.md', '字段描述（非数据库字段）'],
    ['prompts/cp-checklist.prompt.md', '产品需求事实源足以派生技术验收'],
    ['prompts/cp-checklist.prompt.md', '需求方原始输入已独立保留'],
    ['prompts/cp-checklist.prompt.md', '产品需求确认稿或需求变更确认稿已由产品补充'],
    ['prompts/technical-design.prompt.md', '§7.1 产品事实源→技术验证映射'],
    ['prompts/implementation-plan.prompt.md', '§8 技术验证清单'],
    ['prompts/behavior-checklist.prompt.md', '不是产品填写项'],
    ['skills/audit-requirements/SKILL.md', '产品输入型需求不要求产品填写验收标准'],
    ['skills/test-router/SKILL.md', '技术验证映射'],
    ['prompts/technical-design.prompt.md', 'ArtifactDecisionMatrix'],
    ['prompts/implementation-plan.prompt.md', 'PackageBoundarySerialCheck'],
    ['prompts/report-dev.prompt.md', 'ConsumerDependencyTreeProbe'],
    ['scripts/lib/validate-governance-quality.js', 'checkV56'],
    ['README.md', '验证卫生与包边界'],
    ['website/docs/guide/development.md', '文档阅读顺序同步'],
    ['instructions.md', 'ReviewCoverageDelta'],
    ['instructions/12-audit.instructions.md', 'ReviewedSet'],
    ['instructions/13-analyze.instructions.md', 'ReviewCoverageDelta'],
    ['skills/audit-common/SKILL.md', 'NoNewSurfaceReason'],
    ['skills/audit-execution-guide/SKILL.md', '有效零发现'],
    ['skills/intent/SKILL.md', 'ReviewCoverageDelta'],
    ['prompts/report-audit.prompt.md', 'ReviewCoverageDelta'],
    ['instructions/16-report.instructions.md', 'ReviewCoverageDelta'],
    ['skills/report/SKILL.md', 'ReviewCoverageDelta'],
    ['README.md', '复审覆盖增量'],
    ['website/docs/guide/development.md', 'ReviewCoverageDelta'],
    ['website/docs/specs/flowcharts.md', '有效零发现'],
    ['website/docs/specs/workflow-execution-flow.md', 'ReviewCoverageDelta'],
    ['scripts/lib/validate-governance-helpers.js', 'collectChangelogSources'],
    ['scripts/lib/validate-governance-quality.js', 'checkV57'],
    ['instructions.md', 'ConcurrencyPolicy'],
    ['instructions/01-common.instructions.md', 'extensions.devcodex.concurrency'],
    ['instructions/17-compliance.instructions.md', '并发策略合规'],
    ['skills/compliance/SKILL.md', '并发策略合规'],
    ['skills/load-profile/SKILL.md', 'extensions.devcodex.concurrency'],
    ['skills/audit-session/SKILL.md', '单写者锁'],
    ['skills/memory/SKILL.md', 'memory` 单写者锁'],
    ['scripts/validate-profile.js', 'validateConcurrencyPolicy'],
    ['scripts/test-validate-profile.js', 'validConcurrencyRoot'],
    ['README.md', 'parallel prepare, serial commit'],
    ['website/docs/guide/development.md', '并发策略与 `ENV_MODE` 分离'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/concurrency-policy/index.md', 'allowParallelMutations'],
    ['scripts/lib/validate-governance-quality.js', 'checkV58'],
    ['skills/audit-project/SKILL.md', 'PE-12 资源生命周期与泄漏风险'],
    ['instructions/12-audit.instructions.md', 'PE-12 资源生命周期与泄漏风险'],
    ['prompts/report-audit.prompt.md', '项目工程(PE-1~PE-12)'],
    ['README.md', '项目工程泄漏审查'],
    ['website/docs/guide/development.md', 'PE-12 资源生命周期与泄漏风险'],
    ['scripts/lib/validate-governance-quality.js', 'checkV59'],
    ['instructions.md', 'LeakRiskStabilityPressureTest'],
    ['instructions/10-dev.instructions.md', 'LeakRiskStabilityPressureTest'],
    ['instructions/11-fix.instructions.md', '泄漏风险稳定性压测'],
    ['skills/test-router/SKILL.md', 'leakRiskPressure'],
    ['skills/dev-testing/SKILL.md', 'LeakRiskStabilityPressureTest'],
    ['skills/dev-scenario-test/SKILL.md', '冷却后回落'],
    ['prompts/implementation-plan.prompt.md', 'LeakRiskStabilityPressureTest'],
    ['prompts/report-scenario-test.prompt.md', '泄漏风险稳定性压测结果'],
    ['README.md', '泄漏风险稳定性压测'],
    ['website/docs/guide/development.md', 'LeakRiskStabilityPressureTest'],
    ['website/docs/versions/v1/1.0.1/requirements/index.md', 'leak-risk-stability-pressure'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/leak-risk-stability-pressure/index.md', 'LeakRiskStabilityPressureTest'],
    ['website/rspress.config.ts', '泄漏风险稳定性压测'],
    ['scripts/lib/validate-governance-quality.js', 'checkV60'],
    ['instructions.md', 'FrontendExperienceQualityGate'],
    ['instructions.md', 'CrossProjectLearnedGuards'],
    ['instructions/10-dev.instructions.md', 'GovernanceGateRegistry'],
    ['instructions/11-fix.instructions.md', 'GovernanceGateRegistry'],
    ['instructions/12-audit.instructions.md', 'GovernanceGateRegistry'],
    ['skills/test-router/SKILL.md', 'frontendExperience'],
    ['skills/test-router/SKILL.md', 'verificationScopeBudget'],
    ['skills/dev-testing/SKILL.md', 'LiveVerificationExecutionObligation'],
    ['skills/dev-docs/SKILL.md', 'DocumentationTranslationParityGuard'],
    ['skills/audit-project/SKILL.md', 'CrossProjectLearnedGuards'],
    ['skills/audit-requirements/SKILL.md', 'CodeTruthRequirementGate'],
    ['prompts/requirement.prompt.md', 'FrontendExperienceQualityGate'],
    ['prompts/technical-design.prompt.md', 'manualReviewEvidence'],
    ['prompts/implementation-plan.prompt.md', 'CrossProjectLearnedGuards'],
    ['prompts/report-dev.prompt.md', 'FrontendExperienceQualityGate'],
    ['prompts/report-audit.prompt.md', 'CrossProjectLearnedGuards'],
    ['README.md', 'FrontendExperienceQualityGate'],
    ['website/docs/guide/development.md', 'GovernanceGateRegistry'],
    ['website/docs/versions/v1/1.0.1/requirements/index.md', 'frontend-experience-quality'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/frontend-experience-quality/index.md', 'CrossProjectLearnedGuards'],
    ['website/rspress.config.ts', '前端体验质量门禁'],
    ['scripts/lib/validate-governance-quality.js', 'checkV61'],
    ['instructions.md', 'ProductRequirementTraceabilityGate'],
    ['instructions/10-dev.instructions.md', 'LocalExecutionConfigProbe'],
    ['skills/test-router/SKILL.md', 'packageNameAuthority'],
    ['skills/dev-plan-review/SKILL.md', 'GovernanceGateRegistry'],
    ['prompts/requirement.prompt.md', 'PublicModuleDifferentiationGate'],
    ['prompts/technical-design.prompt.md', 'ManualReviewEvidenceDataRetention'],
    ['prompts/implementation-plan.prompt.md', 'GovernanceGateRegistry'],
    ['prompts/report-dev.prompt.md', 'GovernanceGateRegistry'],
    ['README.md', 'GovernanceGateRegistry'],
    ['website/docs/guide/development.md', 'GovernanceGateRegistry'],
    ['instructions/18-spec-radar.instructions.md', '01a-profile-loading'],
    ['instructions/01-common.instructions.md', 'profile-bootstrap'],
    ['RULES.md', 'audit（7 目标类型）'],
    ['website/docs/specs/routing-flow.md', 'audit（7 目标类型）'],
    ['website/docs/versions/v2/2.0.0/index.md', 'Intent-Gated Hosted Spec MCP'],
    ['website/docs/versions/v1/1.0.1/requirements/index.md', 'data-absorption-guard-extensions'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/data-absorption-guard-extensions/index.md', 'ProductRequirementTraceabilityGate'],
    ['website/rspress.config.ts', 'data-absorption-guard-extensions'],
    ['scripts/lib/validate-governance-quality.js', 'checkV62'],
    ['instructions.md', 'WorkspaceDataAbsorptionScopeGate'],
    ['instructions.md', 'DocsSiteVisualAcceptanceGate'],
    ['instructions.md', 'MethodLevelLeakPressureProbe'],
    ['instructions/10-dev.instructions.md', 'V2FormalSolutionPackage'],
    ['instructions/12-audit.instructions.md', 'OmissionOnlyReviewGate'],
    ['skills/spec-governance/SKILL.md', '.devcodex/*/data/'],
    ['skills/test-router/SKILL.md', 'workspaceDataAbsorption'],
    ['skills/test-router/SKILL.md', 'methodLevelLeakPressure'],
    ['skills/dev-testing/SKILL.md', 'MethodLevelLeakPressureProbe'],
    ['skills/dev-docs/SKILL.md', 'FlowchartNodeExplanationGate'],
    ['skills/audit-common/SKILL.md', 'OmissionOnlyReviewGate'],
    ['skills/audit-document/SKILL.md', 'DocsSiteVisualAcceptanceGate'],
    ['prompts/requirement.prompt.md', 'WorkspaceDataAbsorptionScopeGate'],
    ['prompts/technical-design.prompt.md', 'V2FormalSolutionPackage'],
    ['prompts/implementation-plan.prompt.md', 'MethodLevelLeakPressureProbe'],
    ['prompts/report-dev.prompt.md', 'DocsSiteVisualAcceptanceGate'],
    ['prompts/report-audit.prompt.md', 'OmissionOnlyReviewGate'],
    ['prompts/report-scenario-test.prompt.md', 'MethodLevelLeakPressureProbe'],
    ['README.md', 'GovernanceGateRegistry'],
    ['website/docs/guide/development.md', 'V2FormalSolutionPackage'],
    ['website/docs/specs/flowcharts.md', 'FlowchartNodeExplanationGate'],
    ['website/docs/versions/v1/1.0.1/requirements/index.md', 'latest-data-absorption-guards'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'WorkspaceDataAbsorptionScopeGate'],
    ['website/docs/versions/v2/2.0.0/formal-solution-package.md', 'MCP API Contract'],
    ['website/rspress.config.ts', 'formal-solution-package'],
    ['scripts/lib/validate-governance-quality.js', 'checkV63'],
    ['instructions.md', 'ReviewFindingIntakeGate'],
    ['instructions.md', 'AuditReportIsSignalNotEvidence'],
    ['instructions.md', 'DocsImplementationDriftAttribution'],
    ['instructions/10-dev.instructions.md', 'ReviewFindingIntakeGate'],
    ['instructions/11-fix.instructions.md', 'ReviewFindingIntakeGate'],
    ['instructions/12-audit.instructions.md', 'ReviewFindingIntakeGate'],
    ['instructions/13-analyze.instructions.md', 'ReviewFindingIntakeGate'],
    ['skills/audit-common/SKILL.md', 'ReviewFindingIntakeGate'],
    ['skills/analyze-research/SKILL.md', 'ReviewFindingIntakeGate'],
    ['skills/fix-default/SKILL.md', 'ReviewFindingIntakeGate'],
    ['skills/test-router/SKILL.md', 'ReviewFindingIntakeGate'],
    ['skills/audit-project/SKILL.md', 'ReviewFindingIntakeGate'],
    ['skills/audit-requirements/SKILL.md', 'ReviewFindingIntakeGate'],
    ['skills/audit-report/SKILL.md', 'ReviewFindingIntakeGate'],
    ['skills/report/SKILL.md', 'ReviewFindingIntakeGate'],
    ['prompts/requirement.prompt.md', 'ReviewFindingIntakeGate'],
    ['prompts/technical-design.prompt.md', 'ReviewFindingIntakeGate'],
    ['prompts/implementation-plan.prompt.md', 'ReviewFindingIntakeGate'],
    ['prompts/report-dev.prompt.md', 'ReviewFindingIntakeGate'],
    ['prompts/report-fix.prompt.md', 'ReviewFindingIntakeGate'],
    ['prompts/report-audit.prompt.md', 'ReviewFindingIntakeGate'],
    ['README.md', 'ReviewFindingIntakeGate'],
    ['website/docs/guide/development.md', 'ReviewFindingIntakeGate'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'ReviewFindingIntakeGate'],
    ['scripts/lib/validate-governance-quality.js', 'checkV64'],
    ['instructions.md', 'FigmaHighFidelityRestorationGate'],
    ['instructions.md', 'ExplicitCommitAuthorizationGate'],
    ['instructions.md', 'CompatibilityAndContractAuthorityGate'],
    ['instructions/01b-record-router.instructions.md', 'ExplicitCommitAuthorizationGate'],
    ['instructions/10-dev.instructions.md', 'RuntimeI18nArtifactVerificationGate'],
    ['instructions/11-fix.instructions.md', 'GovernanceGateRegistry'],
    ['instructions/12-audit.instructions.md', 'GovernanceGateRegistry'],
    ['instructions/13-analyze.instructions.md', 'GovernanceGateRegistryRef'],
    ['skills/test-router/SKILL.md', 'highFidelityUi'],
    ['skills/test-router/SKILL.md', 'compatibilityAuthority'],
    ['skills/api-verification/SKILL.md', 'UserFacingVerificationArtifactLanguageGate'],
    ['skills/dev-default/SKILL.md', 'FigmaProductionAssetBudgetGate'],
    ['skills/dev-plan-review/SKILL.md', 'GovernanceGateRegistry'],
    ['skills/dev-testing/SKILL.md', 'CollectionRelationIdNamingGate'],
    ['skills/dev-docs/SKILL.md', 'PublicDocsReleasedVersionGate'],
    ['skills/audit-project/SKILL.md', 'ActualPreviewChainAndMockFallbackGate'],
    ['skills/audit-requirements/SKILL.md', 'UIConfirmedSourceConflictTraceGate'],
    ['skills/document-sync/SKILL.md', 'frontend-runtime'],
    ['skills/report/SKILL.md', 'CompatibilityAndContractAuthorityGate'],
    ['prompts/requirement.prompt.md', 'FigmaHighFidelityRestorationGate'],
    ['prompts/technical-design.prompt.md', 'actualPreviewChain'],
    ['prompts/implementation-plan.prompt.md', 'GovernanceGateRegistry'],
    ['prompts/report-dev.prompt.md', 'GovernanceGateRegistry'],
    ['prompts/report-fix.prompt.md', 'GovernanceGateRegistry'],
    ['prompts/report-audit.prompt.md', 'GovernanceGateRegistry'],
    ['prompts/report-scenario-test.prompt.md', 'ActualPreviewChainAndMockFallbackGate'],
    ['README.md', 'GovernanceGateRegistry'],
    ['website/docs/guide/development.md', 'RuntimeI18nArtifactVerificationGate'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'ExplicitCommitAuthorizationGate'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V65 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV65'],
    ['instructions.md', 'ReviewDimensionDeltaGate'],
    ['instructions.md', 'UserPerspectiveDocsGate'],
    ['instructions.md', 'DocsConsumerSweep'],
    ['instructions.md', 'ArtifactLinkSetDedupeGate'],
    ['instructions.md', 'FrontendRuntimeNetworkProbeGate'],
    ['instructions/02-output-paths.instructions.md', 'ArtifactLinkSetDedupeGate'],
    ['instructions/12-audit.instructions.md', 'PreviousDimensionSet'],
    ['skills/audit-common/SKILL.md', 'ReviewDimensionDeltaGate'],
    ['skills/test-router/SKILL.md', 'reviewDimensionDelta'],
    ['skills/test-router/SKILL.md', 'artifactLinkDedupe'],
    ['skills/dev-docs/SKILL.md', 'UserPerspectiveDocsGate'],
    ['skills/document-sync/SKILL.md', 'DocsConsumerSweep'],
    ['skills/audit-document/SKILL.md', '低心智负担'],
    ['skills/audit-readme/SKILL.md', '普通使用者能看懂'],
    ['skills/report/SKILL.md', 'ArtifactLinkSetDedupeGate'],
    ['skills/memory/SKILL.md', 'ArtifactLinkSetDedupeGate'],
    ['prompts/requirement.prompt.md', 'FrontendRuntimeNetworkProbeGate'],
    ['prompts/technical-design.prompt.md', 'userPerspectiveDocs'],
    ['prompts/implementation-plan.prompt.md', 'DocsConsumerSweep'],
    ['prompts/report-audit.prompt.md', 'ReviewDimensionDeltaGate'],
    ['README.md', 'UserPerspectiveDocsGate'],
    ['website/docs/guide/development.md', 'ArtifactLinkSetDedupeGate'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'FrontendRuntimeNetworkProbeGate'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V66 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV66'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions.md', 'PublicUserDocsMaintainerBoundaryGate'],
    ['instructions.md', 'ActiveRequirementFinalResponseGate'],
    ['skills/test-router/SKILL.md', 'PublicUserDocsMaintainerBoundaryGate'],
    ['skills/test-router/SKILL.md', 'ActiveRequirementFinalResponseGate'],
    ['skills/dev-docs/SKILL.md', 'PublicUserDocsMaintainerBoundaryGate'],
    ['skills/document-sync/SKILL.md', 'ActiveRequirementFinalResponseGate'],
    ['skills/report/SKILL.md', 'active requirement/task/bug id'],
    ['prompts/requirement.prompt.md', 'PublicUserDocsMaintainerBoundaryGate'],
    ['prompts/technical-design.prompt.md', 'ActiveRequirementFinalResponseGate'],
    ['prompts/implementation-plan.prompt.md', 'PublicUserDocsMaintainerBoundaryGate'],
    ['prompts/report-dev.prompt.md', 'ActiveRequirementFinalResponseGate'],
    ['prompts/report-fix.prompt.md', 'PublicUserDocsMaintainerBoundaryGate'],
    ['prompts/report-audit.prompt.md', 'ActiveRequirementFinalResponseGate'],
    ['README.md', 'PublicUserDocsMaintainerBoundaryGate'],
    ['website/docs/guide/development.md', 'ActiveRequirementFinalResponseGate'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V67'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V67 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV67'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions.md', 'DatabaseRecordMigrationExportGate'],
    ['instructions.md', 'PackageAdapterPreConfirmEvidenceGate'],
    ['instructions/10-dev.instructions.md', 'RequirementPreConfirmGate'],
    ['instructions/11-fix.instructions.md', 'FindingProbeMatrixGate'],
    ['instructions/12-audit.instructions.md', 'GovernanceGateRegistry'],
    ['instructions/13-analyze.instructions.md', 'GovernanceGateRegistryRef'],
    ['instructions/02-output-paths.instructions.md', 'OneOffRequirementScriptPlacementGate'],
    ['skills/test-router/SKILL.md', 'browserVerificationBudget'],
    ['skills/test-router/SKILL.md', 'findingProbeMatrix'],
    ['skills/dev-database/SKILL.md', 'DatabaseRecordMigrationExportGate'],
    ['skills/dev-docs/SKILL.md', 'ExecutableExampleTruthProbeGate'],
    ['skills/dev-plan-review/SKILL.md', 'PackageAdapterPreConfirmEvidenceGate'],
    ['skills/audit-requirements/SKILL.md', 'RequirementPreConfirmGate'],
    ['skills/audit-project/SKILL.md', 'GuardPolicyBypassMatrixGate'],
    ['skills/report/SKILL.md', 'LatestAbsorptionGuards'],
    ['prompts/technical-design.prompt.md', 'VisualDeviationTypeGate'],
    ['prompts/implementation-plan.prompt.md', 'LatestAbsorptionGuards'],
    ['prompts/report-dev.prompt.md', 'GovernanceGateRegistry'],
    ['README.md', 'GovernanceGateRegistry'],
    ['website/docs/guide/development.md', 'FrontendBrowserVerificationBudgetGate'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V68'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V68 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV68'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions.md', 'UserDocsImmediateComprehensionGate'],
    ['instructions.md', 'UserDocsPrimarySurfaceGate'],
    ['instructions.md', 'RequirementVerdictStateSyncGate'],
    ['instructions/10-dev.instructions.md', 'UserDocsPrimarySurfaceGate'],
    ['instructions/11-fix.instructions.md', 'RequirementVerdictStateSyncGate'],
    ['instructions/12-audit.instructions.md', 'UserDocsImmediateComprehensionGate'],
    ['instructions/13-analyze.instructions.md', 'GovernanceGateRegistryRef'],
    ['skills/dev-docs/SKILL.md', 'UserDocsPrimarySurfaceGate'],
    ['skills/readme-authoring/SKILL.md', 'UserDocsImmediateComprehensionGate'],
    ['skills/audit-document/SKILL.md', 'UserDocsPrimarySurfaceGate'],
    ['skills/audit-readme/SKILL.md', 'UserDocsImmediateComprehensionGate'],
    ['skills/audit-requirements/SKILL.md', 'RequirementVerdictStateSyncGate'],
    ['skills/document-sync/SKILL.md', 'RequirementVerdictStateSyncGate'],
    ['skills/test-router/SKILL.md', '用户文档主面'],
    ['skills/report/SKILL.md', 'UserDocsPrimarySurfaceGate'],
    ['skills/memory/SKILL.md', 'RequirementVerdictStateSyncGate'],
    ['prompts/requirement.prompt.md', 'RequirementVerdictStateSyncGate'],
    ['prompts/technical-design.prompt.md', 'UserDocsPrimarySurfaceGate'],
    ['prompts/implementation-plan.prompt.md', 'UserDocsImmediateComprehensionGate'],
    ['prompts/report-dev.prompt.md', 'UserDocsPrimarySurfaceGate'],
    ['prompts/report-fix.prompt.md', 'RequirementVerdictStateSyncGate'],
    ['prompts/report-audit.prompt.md', 'UserDocsImmediateComprehensionGate'],
    ['prompts/report-scenario-test.prompt.md', 'UserDocsPrimarySurfaceGate'],
    ['README.md', 'UserDocsPrimarySurfaceGate'],
    ['website/docs/guide/development.md', 'UserDocsImmediateComprehensionGate'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V69'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V69 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV69'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions.md', 'UserFacingDeliveryChainGate'],
    ['instructions.md', 'ReviewChecklistCompletenessGate'],
    ['instructions.md', 'BuiltArtifactFeatureSmokeGate'],
    ['instructions.md', 'GeneratedSiteGate'],
    ['instructions.md', 'BenchmarkRegressionGuard'],
    ['instructions/10-dev.instructions.md', 'UserFacingDeliveryChainGate'],
    ['instructions/11-fix.instructions.md', 'TscOutputImportProbe'],
    ['instructions/12-audit.instructions.md', 'GeneratedSiteGate'],
    ['instructions/13-analyze.instructions.md', 'GovernanceGateRegistryRef'],
    ['skills/test-router/SKILL.md', 'userFacingDeliveryChain'],
    ['skills/test-router/SKILL.md', 'builtArtifactFeatureSmoke'],
    ['skills/dev-docs/SKILL.md', 'GeneratedSiteGate'],
    ['skills/readme-authoring/SKILL.md', 'QueueDocsRealWorkflowGate'],
    ['skills/audit-document/SKILL.md', 'ManualTocDuplicationGate'],
    ['skills/audit-readme/SKILL.md', 'UserPathContractSweep'],
    ['skills/document-sync/SKILL.md', 'ReviewChecklistCompletenessGate'],
    ['skills/report/SKILL.md', 'BenchmarkRegressionGuard'],
    ['prompts/technical-design.prompt.md', 'benchmarkRegression'],
    ['prompts/implementation-plan.prompt.md', 'EvidenceExecutionGate'],
    ['prompts/requirement.prompt.md', 'GeneratedSiteGate'],
    ['prompts/report-dev.prompt.md', 'BuiltArtifactFeatureSmokeGate'],
    ['prompts/report-fix.prompt.md', 'GovernanceGateRegistry'],
    ['prompts/report-audit.prompt.md', 'EvidenceExecutionGate'],
    ['prompts/report-scenario-test.prompt.md', 'BenchmarkRegressionGuard'],
    ['README.md', 'GovernanceGateRegistry'],
    ['website/docs/guide/development.md', 'UserPathContractSweep'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V70'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V70 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV70'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions.md', 'SkillFirstAbsorptionGate'],
    ['instructions.md', 'SkillAbsorptionDecision'],
    ['instructions/10-dev.instructions.md', 'SkillFirstAbsorptionGate'],
    ['skills/spec-governance/SKILL.md', 'SkillAbsorptionDecision'],
    ['skills/spec-governance/SKILL.md', 'new-skill-required'],
    ['skills/user-manual-authoring/SKILL.md', 'FinalUserManualFirstGate'],
    ['skills/user-manual-authoring/SKILL.md', 'UserPathContractSweep'],
    ['skills/review-checklist/SKILL.md', 'ReviewChecklistPrecreationGate'],
    ['skills/review-checklist/SKILL.md', 'ChecklistStateFreshnessGate'],
    ['plugin.json', 'user-manual-authoring'],
    ['plugin.json', 'review-checklist'],
    ['plugin.json', 'analyze-default'],
    ['skills/dev-default/SKILL.md', 'SkillFirstAbsorptionGate'],
    ['skills/dev-docs/SKILL.md', 'user-manual-authoring'],
    ['skills/readme-authoring/SKILL.md', 'user-manual-authoring'],
    ['skills/audit-readme/SKILL.md', 'user-manual-authoring'],
    ['skills/routing/SKILL.md', 'review-checklist'],
    ['skills/test-router/SKILL.md', 'SkillAbsorptionDecision'],
    ['skills/document-sync/SKILL.md', 'review-checklist'],
    ['skills/report/SKILL.md', 'SkillFirstAbsorptionGate'],
    ['skills/audit-common/SKILL.md', 'review-checklist'],
    ['skills/audit-execution-guide/SKILL.md', 'ReviewChecklistPrecreationGate'],
    ['skills/audit-release/SKILL.md', 'review-checklist'],
    ['prompts/technical-design.prompt.md', 'SkillAbsorptionDecision'],
    ['prompts/implementation-plan.prompt.md', 'SkillFirstAbsorptionGate'],
    ['prompts/report-dev.prompt.md', 'SkillFirstAbsorptionGate'],
    ['prompts/report-fix.prompt.md', 'SkillFirstAbsorptionGate'],
    ['prompts/report-audit.prompt.md', 'SkillFirstAbsorptionGate'],
    ['prompts/report-scenario-test.prompt.md', 'SkillFirstAbsorptionGate'],
    ['README.md', 'Skill-first 吸纳架构'],
    ['website/docs/guide/development.md', 'Skill-first 吸纳架构'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V71'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V71 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV71'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions.md', 'LayeredAbsorptionGate'],
    ['instructions.md', 'LayeredAbsorptionDecision'],
    ['instructions.md', 'ProactiveBetterAlternativeGate'],
    ['instructions.md', 'commonInstruction'],
    ['instructions/10-dev.instructions.md', 'LayeredAbsorptionDecision'],
    ['skills/spec-governance/SKILL.md', 'LayeredAbsorptionGate'],
    ['skills/spec-governance/SKILL.md', 'promptTemplate'],
    ['skills/spec-governance/SKILL.md', 'deployCopy'],
    ['skills/dev-default/SKILL.md', 'ProactiveBetterAlternativeGate'],
    ['skills/test-router/SKILL.md', 'layeredAbsorption'],
    ['skills/report/SKILL.md', 'LayeredAbsorptionDecision'],
    ['skills/document-sync/SKILL.md', 'ProactiveBetterAlternativeGate'],
    ['prompts/technical-design.prompt.md', 'LayeredAbsorptionDecision'],
    ['prompts/implementation-plan.prompt.md', 'ProactiveBetterAlternativeGate'],
    ['prompts/report-dev.prompt.md', 'LayeredAbsorptionDecision'],
    ['prompts/report-fix.prompt.md', 'LayeredAbsorptionDecision'],
    ['prompts/report-audit.prompt.md', 'LayeredAbsorptionDecision'],
    ['prompts/report-scenario-test.prompt.md', 'LayeredAbsorptionDecision'],
    ['README.md', '分层吸纳架构'],
    ['website/docs/guide/development.md', 'LayeredAbsorptionGate'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V72'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V72 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV72'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['instructions.md', 'PublicSurfaceClosureGate'],
    ['instructions.md', 'EvolutionCapabilityControlPlaneGate'],
    ['skills/spec-governance/SKILL.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['skills/evolution-governance/SKILL.md', 'name: evolution-governance'],
    ['skills/evolution-governance/SKILL.md', 'EvolutionCapabilityControlPlaneGate'],
    ['plugin.json', 'evolution-governance'],
    ['skills/routing/SKILL.md', 'evolution-governance'],
    ['skills/dev-default/SKILL.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['skills/user-manual-authoring/SKILL.md', 'UserManualProductizationGate'],
    ['skills/review-checklist/SKILL.md', 'SampleIssueExpansionGate'],
    ['skills/audit-requirements/SKILL.md', 'RequirementDimensionBindingGate'],
    ['skills/audit-tech-design/SKILL.md', 'OfficialApiEvidenceGate'],
    ['skills/audit-project/SKILL.md', 'FrontendAsyncCacheRenderGate'],
    ['skills/audit-release/SKILL.md', 'RemoteCIParityPushGate'],
    ['skills/release-verification/SKILL.md', 'PublicSurfaceClosureGate'],
    ['skills/load-profile/SKILL.md', 'ProfileReadChainGate'],
    ['skills/api-verification/SKILL.md', 'AsyncDbTruthSourceVerificationGate'],
    ['skills/dev-docs/SKILL.md', 'DocsThemeRuntimeVisualProbeGate'],
    ['skills/test-router/SKILL.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['skills/report/SKILL.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['skills/document-sync/SKILL.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['prompts/technical-design.prompt.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['prompts/implementation-plan.prompt.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['prompts/report-dev.prompt.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['prompts/report-fix.prompt.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['prompts/report-audit.prompt.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['prompts/report-scenario-test.prompt.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['README.md', 'evolution-governance'],
    ['website/docs/index.md', '77 个 Skills'],
    ['website/docs/intro/index.md', '77 个按需触发的工作流技能'],
    ['website/docs/specs/directory-structure.md', '扁平一级 Skill（77 个）'],
    ['website/docs/guide/development.md', 'ConfirmedAbsorptionCompletenessGates'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V73'],
    ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V73 探针'],
    ['scripts/lib/validate-governance-quality.js', 'checkV73'],
    ['scripts/validate.js', 'runProbeRegistry']
  ]

  for (const [file, needle] of probes) mustInclude(file, needle)
  mustIncludeInChangelogs('ReviewCoverageDelta')
  mustIncludeInChangelogs('复审覆盖增量')
  mustIncludeInChangelogs('PE-12')
  mustIncludeInChangelogs('资源生命周期与泄漏风险')
  mustIncludeInChangelogs('LeakRiskStabilityPressureTest')
  mustIncludeInChangelogs('泄漏风险稳定性压测')
  mustIncludeInChangelogs('FrontendExperienceQualityGate')
  mustIncludeInChangelogs('CrossProjectLearnedGuards')
  mustIncludeInChangelogs('CodeTruthRequirementGate')
  mustIncludeInChangelogs('AdapterBenchmarkAttribution')
  mustIncludeInChangelogs('ProductRequirementTraceabilityGate')
  mustIncludeInChangelogs('PackageNameAuthorityGate')
  mustIncludeInChangelogs('V2MCPFirstPlanningGate')
  mustIncludeInChangelogs('WorkspaceDataAbsorptionScopeGate')
  mustIncludeInChangelogs('DocsSiteVisualAcceptanceGate')
  mustIncludeInChangelogs('OmissionOnlyReviewGate')
  mustIncludeInChangelogs('ReviewFindingIntakeGate')
  mustIncludeInChangelogs('PF-054')
  mustIncludeInChangelogs('PI-051')
  mustIncludeInChangelogs('MethodLevelLeakPressureProbe')
  mustIncludeInChangelogs('V2FormalSolutionPackage')
  mustIncludeInChangelogs('FigmaHighFidelityRestorationGate')
  mustIncludeInChangelogs('ExplicitCommitAuthorizationGate')
  mustIncludeInChangelogs('CompatibilityAndContractAuthorityGate')
  mustIncludeInChangelogs('PublicDocsReleasedVersionGate')
  mustIncludeInChangelogs('UserFacingVerificationArtifactLanguageGate')
  mustIncludeInChangelogs('ReviewDimensionDeltaGate')
  mustIncludeInChangelogs('UserPerspectiveDocsGate')
  mustIncludeInChangelogs('DocsConsumerSweep')
  mustIncludeInChangelogs('ArtifactLinkSetDedupeGate')
  mustIncludeInChangelogs('FrontendRuntimeNetworkProbeGate')
  mustIncludeInChangelogs('PI-052')
  mustIncludeInChangelogs('PF-056')
  mustIncludeInChangelogs('PublicUserDocsMaintainerBoundaryGate')
  mustIncludeInChangelogs('ActiveRequirementFinalResponseGate')
  mustIncludeInChangelogs('PI-053')
  mustIncludeInChangelogs('PI-054')
  mustIncludeInChangelogs('PF-057')
  mustIncludeInChangelogs('PF-058')
  mustIncludeInChangelogs('DatabaseRecordMigrationExportGate')
  mustIncludeInChangelogs('FrontendBrowserVerificationBudgetGate')
  mustIncludeInChangelogs('UserSelfVerificationOverrideGate')
  mustIncludeInChangelogs('FindingProbeMatrixGate')
  mustIncludeInChangelogs('MultiPhaseClosureGate')
  mustIncludeInChangelogs('GuardPolicyBypassMatrixGate')
  mustIncludeInChangelogs('SideEffectCompatibilityDocsGate')
  mustIncludeInChangelogs('ExecutableExampleTruthProbeGate')
  mustIncludeInChangelogs('VisualDeviationTypeGate')
  mustIncludeInChangelogs('OneOffRequirementScriptPlacementGate')
  mustIncludeInChangelogs('VerificationCommandSideEffectGate')
  mustIncludeInChangelogs('DesignFramePurposeClassificationGate')
  mustIncludeInChangelogs('RequirementPreConfirmGate')
  mustIncludeInChangelogs('PackageAdapterPreConfirmEvidenceGate')
  mustIncludeInChangelogs('PI-071')
  mustIncludeInChangelogs('PF-076')
  mustIncludeInChangelogs('RequirementVerdictStateSyncGate')
  mustIncludeInChangelogs('UserDocsImmediateComprehensionGate')
  mustIncludeInChangelogs('UserDocsPrimarySurfaceGate')
  mustIncludeInChangelogs('V69')
  mustIncludeInChangelogs('PI-072')
  mustIncludeInChangelogs('PI-073')
  mustIncludeInChangelogs('PI-074')
  mustIncludeInChangelogs('PF-077')
  mustIncludeInChangelogs('PF-078')
  mustIncludeInChangelogs('PF-079')
  mustIncludeInChangelogs('GR-015')
  mustIncludeInChangelogs('GR-016')
  mustIncludeInChangelogs('UserFacingDeliveryChainGate')
  mustIncludeInChangelogs('FinalUserManualFirstGate')
  mustIncludeInChangelogs('DocsSiteInformationArchitectureGate')
  mustIncludeInChangelogs('UserManualFlowAndFailureGate')
  mustIncludeInChangelogs('QueueDocsRealWorkflowGate')
  mustIncludeInChangelogs('ReviewChecklistCompletenessGate')
  mustIncludeInChangelogs('EvidenceExecutionGate')
  mustIncludeInChangelogs('BuiltArtifactFeatureSmokeGate')
  mustIncludeInChangelogs('TscOutputImportProbe')
  mustIncludeInChangelogs('GeneratedSiteGate')
  mustIncludeInChangelogs('ManualTocDuplicationGate')
  mustIncludeInChangelogs('UserPathContractSweep')
  mustIncludeInChangelogs('BenchmarkRegressionGuard')
  mustIncludeInChangelogs('V70')
  mustIncludeInChangelogs('PI-075')
  mustIncludeInChangelogs('PI-076')
  mustIncludeInChangelogs('PI-077')
  mustIncludeInChangelogs('PI-078')
  mustIncludeInChangelogs('PF-080')
  mustIncludeInChangelogs('PF-081')
  mustIncludeInChangelogs('PF-082')
  mustIncludeInChangelogs('PF-083')
  mustIncludeInChangelogs('GR-017')
  mustIncludeInChangelogs('GR-018')
  mustIncludeInChangelogs('GAP-030')
  mustIncludeInChangelogs('GAP-031')
  mustIncludeInChangelogs('GAP-032')
  mustIncludeInChangelogs('GAP-033')
  mustIncludeInChangelogs('GAP-034')
  mustIncludeInChangelogs('GAP-035')
  mustIncludeInChangelogs('GAP-036')
  mustIncludeInChangelogs('PI-019')
  mustIncludeInChangelogs('PF-002')
  mustIncludeInChangelogs('SkillFirstAbsorptionGate')
  mustIncludeInChangelogs('CapabilityToSkillPromotionGate')
  mustIncludeInChangelogs('SkillAbsorptionDecision')
  mustIncludeInChangelogs('user-manual-authoring')
  mustIncludeInChangelogs('review-checklist')
  mustIncludeInChangelogs('V71')
  mustIncludeInChangelogs('PI-079')
  mustIncludeInChangelogs('PI-080')
  mustIncludeInChangelogs('PI-081')
  mustIncludeInChangelogs('PF-084')
  mustIncludeInChangelogs('PF-085')
  mustIncludeInChangelogs('PF-086')
  mustIncludeInChangelogs('LayeredAbsorptionGate')
  mustIncludeInChangelogs('LayeredAbsorptionDecision')
  mustIncludeInChangelogs('ProactiveBetterAlternativeGate')
  mustIncludeInChangelogs('V72')
  mustIncludeInChangelogs('PI-082')
  mustIncludeInChangelogs('PI-083')
  mustIncludeInChangelogs('PF-087')
  mustIncludeInChangelogs('PF-088')
  mustIncludeInChangelogs('ConfirmedAbsorptionCompletenessGates')
  mustIncludeInChangelogs('PublicSurfaceClosureGate')
  mustIncludeInChangelogs('UserManualProductizationGate')
  mustIncludeInChangelogs('UserManualRenderedFlowAndRealWorkflowProbe')
  mustIncludeInChangelogs('SampleIssueExpansionGate')
  mustIncludeInChangelogs('RequirementDimensionBindingGate')
  mustIncludeInChangelogs('RequirementPriorityAndPhaseGate')
  mustIncludeInChangelogs('ReviewAnchorMaterializationGate')
  mustIncludeInChangelogs('SemanticLegacyRouteExposureGate')
  mustIncludeInChangelogs('ReferenceCodeTruthSamplingGate')
  mustIncludeInChangelogs('FrontendAsyncCacheRenderGate')
  mustIncludeInChangelogs('StaleWhileRevalidateGate')
  mustIncludeInChangelogs('PortableExternalArtifactGate')
  mustIncludeInChangelogs('StrongestProfileSourceGate')
  mustIncludeInChangelogs('ServiceSpecificResidueSweep')
  mustIncludeInChangelogs('ProfileReadChainGate')
  mustIncludeInChangelogs('ServiceNormCoverageGate')
  mustIncludeInChangelogs('RouteNamespaceResponsibilityGate')
  mustIncludeInChangelogs('RemoteCIParityPushGate')
  mustIncludeInChangelogs('OfficialApiEvidenceGate')
  mustIncludeInChangelogs('AsyncDbTruthSourceVerificationGate')
  mustIncludeInChangelogs('DocsPageRoleMatrixGate')
  mustIncludeInChangelogs('CompleteUserManualSiteMatrixGate')
  mustIncludeInChangelogs('EvolutionCapabilityControlPlaneGate')
  mustIncludeInChangelogs('FrameworkCapabilityAutoFirstGate')
  mustIncludeInChangelogs('DocsThemeRuntimeVisualProbeGate')
  mustIncludeInChangelogs('evolution-governance')
  mustIncludeInChangelogs('V73')
  mustIncludeInChangelogs('HistoricalCommonNormLayeringGate')
  mustIncludeInChangelogs('历史通用规范分层迁移')
  mustIncludeInChangelogs('V74')
  mustIncludeInChangelogs('PromptLongGateListDriftProbe')
  mustIncludeInChangelogs('V75')
  mustIncludeInChangelogs('ReviewEscapeRecordGate')
  mustIncludeInChangelogs('V76')
  mustIncludeInChangelogs('NativeCommandExitCodeGate')
  mustIncludeInChangelogs('V77')
  mustIncludeInChangelogs('PostConfirmationReviewScopeGate')
  mustIncludeInChangelogs('DevelopmentDriftGate')
  mustIncludeInChangelogs('VerificationPlanMaterializationProbe')
  mustIncludeInChangelogs('AcceptedSuggestionRootCauseGate')
  mustIncludeInChangelogs('ChinesePrimaryExpressionGate')
  mustIncludeInChangelogs('V78')
  mustIncludeInChangelogs('CoverageGateDecision')
  mustIncludeInChangelogs('ExternalRuntimePluginLifecycleGate')
  mustIncludeInChangelogs('ExternalRegistryLifecycleMatrixGate')
  mustIncludeInChangelogs('FunctionSourceFingerprintMatrixGate')
  mustIncludeInChangelogs('ClusterEscalationGate')
  mustIncludeInChangelogs('RiskBasedValidationLadder')
  mustIncludeInChangelogs('V79')

  for (const [file, needle] of [
    ['scripts/lib/validate-governance-quality.js', 'checkV74'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['instructions.md', 'HistoricalCommonNormLayeringGate'],
    ['instructions.md', 'legacy-index-retained'],
    ['instructions/10-dev.instructions.md', 'HistoricalCommonNormLayeringGate'],
    ['skills/spec-governance/SKILL.md', 'HistoricalCommonNormLayeringGate'],
    ['skills/spec-governance/SKILL.md', '逐文件审查矩阵'],
    ['skills/test-router/SKILL.md', 'historicalCommonNormLayering'],
    ['skills/report/SKILL.md', 'HistoricalCommonNormLayeringGate'],
    ['skills/document-sync/SKILL.md', 'HistoricalCommonNormLayeringGate'],
    ['skills/source-consumer-sync/SKILL.md', 'V74 历史通用规范分层同步面'],
    ['prompts/technical-design.prompt.md', 'HistoricalCommonNormLayeringGate'],
    ['prompts/implementation-plan.prompt.md', 'HistoricalCommonNormLayeringGate'],
    ['prompts/report-dev.prompt.md', 'HistoricalCommonNormLayeringGate'],
    ['prompts/report-fix.prompt.md', 'HistoricalCommonNormLayeringGate'],
    ['prompts/report-audit.prompt.md', 'HistoricalCommonNormLayeringGate'],
    ['prompts/report-scenario-test.prompt.md', 'HistoricalCommonNormLayeringGate'],
    ['README.md', '历史通用规范分层迁移'],
    ['website/docs/guide/development.md', '历史通用规范分层迁移'],
    ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V74']
  ]) {
    mustInclude(file, needle)
  }
}

module.exports = { runSpecGovernanceBaseSuite }
