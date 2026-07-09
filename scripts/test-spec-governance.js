#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const failures = []
const SOURCE_PROJECT_NAME = ['devcodex', 'v1'].join('-')

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function mustInclude(file, needle) {
  if (!read(file).includes(needle)) failures.push(`${file} missing "${needle}"`)
}

function mustNotInclude(file, needle, reason) {
  if (read(file).includes(needle)) failures.push(`${file} must not include "${needle}" (${reason})`)
}

function collectChangelogContents() {
  const contents = [read('changelogs/unreleased.md')]
  const releasesDir = path.join(ROOT, 'changelogs', 'releases')
  if (fs.existsSync(releasesDir)) {
    for (const name of fs.readdirSync(releasesDir).filter(item => item.endsWith('.md'))) {
      contents.push(read(`changelogs/releases/${name}`))
    }
  }
  return contents
}

function mustIncludeInChangelogs(needle) {
  if (!collectChangelogContents().some(content => content.includes(needle))) {
    failures.push(`changelogs/unreleased.md or changelogs/releases/*.md missing "${needle}"`)
  }
}

const probes = [
  ['skills/spec-governance/SKILL.md', 'RecordRouter'],
  ['skills/spec-governance/SKILL.md', 'SCV-0'],
  ['skills/spec-governance/SKILL.md', 'record.violation'],
  ['skills/spec-governance/SKILL.md', 'record.ambiguous'],
  ['skills/spec-governance/SKILL.md', '你刚才漏了/错了/违反流程了'],
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
  ['instructions.md', '你刚才漏了/错了/违反流程了'],
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
  ['website/docs/specs/directory-structure.md', '01a-profile-loading.instructions.md'],
  ['website/docs/specs/directory-structure.md', '01b-record-router.instructions.md'],
  ['website/docs/specs/directory-structure.md', '01c-intent-expansion.instructions.md'],
  ['instructions/14-self-fix.instructions.md', 'T_RECORD / RecordRouter'],
  ['skills/intent/SKILL.md', 'record.spec-defect'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV52'],
  ['instructions/00-safety.instructions.md', 'S02 用户策略优先的敏感信息与硬编码模型'],
  ['instructions/00-safety.instructions.md', '默认允许'],
  ['instructions/01-common.instructions.md', 'S02 用户 / 项目敏感信息策略'],
  ['skills/dev-plan-review/SKILL.md', '敏感信息、明文连接信息或硬编码处理是否符合用户 / 项目显式策略'],
  ['scripts/lib/validate-governance-tail.js', 'stale S02 wording'],
  ['scripts/validate-profile.js', 'STALE_S02_PROFILE_PATTERNS'],
  ['scripts/test-validate-profile.js', 'staleS02ProfileText'],
  ['skills/load-profile/SKILL.md', '用户 / 项目指定时使用的本地 overlay'],
  ['skills/api-verification/SKILL.md', '@token = replace-with-token-if-required'],
  ['prompts/api-verification.prompt.md', '@language = zh-CN'],
  ['changelogs/README.md', 'changelogs/releases/vX.Y.Z.md'],
  ['CHANGELOG.md', './changelogs/releases/v1.11.5.md'],
  ['skills/audit-common/SKILL.md', 'Profile Freshness Check'],
  ['skills/audit-project/SKILL.md', 'PE-0 Profile Freshness'],
  ['scripts/lib/validate-governance-tail.js', 'checkV53'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV54'],
  ['scripts/lib/validate-governance-tail.js', 'collectChangelogSources'],
  ['scripts/lib/validate-governance-tail.js', 'changelogs/releases/v'],
  ['README.md', 'PreCompact'],
  ['website/docs/guide/development.md', 'PreCompact'],
  ['instructions.md', 'ServiceLifecycleCleanup'],
  ['instructions.md', 'C22'],
  ['instructions/01-common.instructions.md', 'AI 自启动服务清理'],
  ['skills/test-router/SKILL.md', 'cleanupEvidence'],
  ['skills/dev-testing/SKILL.md', '不得静默遗留后台进程'],
  ['prompts/implementation-plan.prompt.md', 'ServiceLifecycleCleanup'],
  ['scripts/lib/validate-governance-tail.js', 'checkV55'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV56'],
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
  ['scripts/lib/validate-governance-tail.js', 'collectChangelogSources'],
  ['scripts/lib/validate-governance-tail.js', 'checkV57'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV58'],
  ['skills/audit-project/SKILL.md', 'PE-12 资源生命周期与泄漏风险'],
  ['instructions/12-audit.instructions.md', 'PE-12 资源生命周期与泄漏风险'],
  ['prompts/report-audit.prompt.md', '项目工程(PE-1~PE-12)'],
  ['README.md', '项目工程泄漏审查'],
  ['website/docs/guide/development.md', 'PE-12 资源生命周期与泄漏风险'],
  ['scripts/lib/validate-governance-tail.js', 'checkV59'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV60'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV61'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV62'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV63'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV64'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV65'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV66'],
  ['scripts/validate.js', 'checkV66()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV67'],
  ['scripts/validate.js', 'checkV67()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV68'],
  ['scripts/validate.js', 'checkV68()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV69'],
  ['scripts/validate.js', 'checkV69()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV70'],
  ['scripts/validate.js', 'checkV70()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV71'],
  ['scripts/validate.js', 'checkV71()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV72'],
  ['scripts/validate.js', 'checkV72()'],
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
  ['website/docs/index.md', '68 个 Skills'],
  ['website/docs/intro/index.md', '68 个按需触发的工作流技能'],
  ['website/docs/specs/directory-structure.md', '扁平一级 Skill（68 个）'],
  ['website/docs/guide/development.md', 'ConfirmedAbsorptionCompletenessGates'],
  ['website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', 'V73'],
  ['website/docs/versions/v1/1.0.1/CHANGELOG.md', 'V73 探针'],
  ['scripts/lib/validate-governance-tail.js', 'checkV73'],
  ['scripts/validate.js', 'checkV73()']
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
  ['scripts/lib/validate-governance-tail.js', 'checkV74'],
  ['scripts/validate.js', 'checkV74()'],
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

const checkV75 = 'PromptLongGateListDriftProbe'
for (const [file, needle] of [
  ['scripts/lib/validate-governance-tail.js', 'checkV75'],
  ['scripts/lib/validate-governance-tail.js', checkV75],
  ['scripts/lib/validate-governance-tail.js', 'negativeSamples'],
  ['scripts/lib/validate-governance-tail.js', 'GovernanceGateRegistry/gateGroup'],
  ['scripts/validate.js', 'checkV75()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV76'],
  ['scripts/validate.js', 'checkV76()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV77'],
  ['scripts/lib/validate-governance-tail.js', checkV77],
  ['scripts/lib/validate-governance-tail.js', 'negativeSamples'],
  ['scripts/validate.js', 'checkV77()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV78'],
  ['scripts/lib/validate-governance-tail.js', checkV78],
  ['scripts/lib/validate-governance-tail.js', 'DevelopmentDriftGate'],
  ['scripts/lib/validate-governance-tail.js', 'VerificationPlanMaterializationProbe'],
  ['scripts/lib/validate-governance-tail.js', 'AcceptedSuggestionRootCauseGate'],
  ['scripts/lib/validate-governance-tail.js', 'ChinesePrimaryExpressionGate'],
  ['scripts/lib/validate-governance-tail.js', 'SidebarPageRoleMaterializationProbe'],
  ['scripts/lib/validate-governance-tail.js', 'SidebarGroupSemanticModelProbe'],
  ['scripts/validate.js', 'checkV78()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV79'],
  ['scripts/lib/validate-governance-tail.js', checkV79],
  ['scripts/lib/validate-governance-tail.js', 'ExternalRuntimePluginLifecycleGate'],
  ['scripts/lib/validate-governance-tail.js', 'FunctionSourceFingerprintMatrixGate'],
  ['scripts/lib/validate-governance-tail.js', 'RiskBasedValidationLadder'],
  ['scripts/validate.js', 'checkV79()'],
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
for (const [file, needle] of [
  ['scripts/lib/validate-governance-tail.js', 'checkV80'],
  ['scripts/lib/validate-governance-tail.js', checkV80],
  ['scripts/lib/validate-governance-tail.js', 'DocsNavigationReviewMatrix'],
  ['scripts/lib/validate-governance-tail.js', 'audit-user-manual'],
  ['scripts/validate.js', 'checkV80()'],
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
  ['website/docs/index.md', '68 个 Skills'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV81'],
  ['scripts/lib/validate-governance-tail.js', 'V81 spec absorption execution skill sync'],
  ['scripts/validate.js', 'checkV81()'],
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
  ['website/docs/index.md', '68 个 Skills'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV82'],
  ['scripts/lib/validate-governance-tail.js', 'V82 latest absorption execution pack sync'],
  ['scripts/validate.js', 'checkV82()'],
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

const checkV83 = 'ProfileTierStandardGate'
for (const [file, needle] of [
  ['scripts/lib/validate-governance-tail.js', 'checkV83'],
  ['scripts/lib/validate-governance-tail.js', checkV83],
  ['scripts/lib/validate-governance-tail.js', 'ProfileLifecycleClassificationGate'],
  ['scripts/lib/validate-governance-tail.js', 'AllDevCodexProfileValidationGate'],
  ['scripts/validate.js', 'checkV83()'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV84'],
  ['scripts/lib/validate-governance-tail.js', 'classifyExpertOutputSample'],
  ['scripts/lib/validate-governance-tail.js', checkV84],
  ['scripts/validate.js', 'V84 expert output quality skill sync'],
  ['scripts/validate.js', 'checkV84()'],
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
  ['website/docs/index.md', '68 个 Skills'],
  ['website/docs/intro/index.md', '68 个按需触发'],
  ['website/docs/specs/directory-structure.md', '扁平一级 Skill（68 个）'],
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
]
for (const [file, needle] of [
  ['scripts/lib/validate-governance-tail.js', 'checkV85'],
  ['scripts/lib/validate-governance-tail.js', 'classifyExpertOwnerSample'],
  ['scripts/lib/validate-governance-tail.js', checkV85],
  ['scripts/validate.js', 'V85 expert owner skill sync'],
  ['scripts/validate.js', 'checkV85()'],
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
  ['skills/report/SKILL.md', '17 个专家 Owner Skill'],
  ['prompts/technical-design.prompt.md', checkV85],
  ['prompts/implementation-plan.prompt.md', checkV85],
  ['prompts/report-dev.prompt.md', checkV85],
  ['prompts/report-fix.prompt.md', checkV85],
  ['prompts/report-audit.prompt.md', checkV85],
  ['prompts/report-scenario-test.prompt.md', checkV85],
  ['README.md', '专家 Owner Skill'],
  ['website/docs/index.md', '68 个 Skills'],
  ['website/docs/intro/index.md', '专家 Owner Skill'],
  ['website/docs/specs/directory-structure.md', '扁平一级 Skill（68 个）'],
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
  mustInclude('scripts/lib/validate-governance-tail.js', gate)
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
  ['scripts/lib/validate-governance-tail.js', 'checkV86'],
  ['scripts/lib/validate-governance-tail.js', 'classifyMemoryBootstrapSample'],
  ['scripts/lib/validate-governance-tail.js', checkV86],
  ['scripts/validate.js', 'V86 memory bootstrap truth source sync'],
  ['scripts/validate.js', 'checkV86()'],
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

const genericDistributedFiles = [
  'instructions.md',
  'instructions/00-safety.instructions.md',
  'instructions/12-audit.instructions.md',
  'skills/spec-governance/SKILL.md',
  'data/README.md',
  'data/templates/violations.md',
  'data/templates/pending-fixes.md',
  'data/templates/process-improvements.md',
  'data/templates/pending-issues.md',
  'data/templates/gap-registry.md'
]

for (const file of genericDistributedFiles) {
  mustNotInclude(file, SOURCE_PROJECT_NAME, 'generic distributed governance assets must not hard-code the source project name')
}

mustNotInclude(
  'prompts/product-requirement.prompt.md',
  '## §10 AI / 研发缺口检查',
  'product requirement template must remain product-only'
)

const plugin = JSON.parse(read('plugin.json'))
for (const [id, file] of [
  ['spec-absorption', 'skills/spec-absorption/SKILL.md'],
  ['spec-governance', 'skills/spec-governance/SKILL.md'],
  ['source-consumer-sync', 'skills/source-consumer-sync/SKILL.md'],
  ['host-contract-verification', 'skills/host-contract-verification/SKILL.md'],
  ['audit-release', 'skills/audit-release/SKILL.md'],
  ['analyze-default', 'skills/analyze-default/SKILL.md']
]) {
  if (!plugin.skills.some(skill => skill.id === id && skill.file === file)) {
    failures.push(`plugin.json missing ${id} skill entry`)
  }
}

for (const [id, file] of [
  ['common-profile-loading', 'instructions/01a-profile-loading.instructions.md'],
  ['common-record-router', 'instructions/01b-record-router.instructions.md'],
  ['common-intent-expansion', 'instructions/01c-intent-expansion.instructions.md']
]) {
  if (!plugin.instructions.some(instruction => instruction.id === id && instruction.file === file)) {
    failures.push(`plugin.json missing ${id} instruction entry`)
  }
}

if (failures.length) {
  console.error('Spec governance checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Spec governance checks passed')
