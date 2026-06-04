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
  ['instructions/10-dev.instructions.md', '执行期 CP3 回退'],
  ['instructions/10-dev.instructions.md', 'SimpleTaskFastPath（简单任务轻路径）'],
  ['instructions/10-dev.instructions.md', 'backlog 来源前置真相复核'],
  ['instructions/11-fix.instructions.md', '执行期 CP3 回退'],
  ['instructions/11-fix.instructions.md', 'SimpleTaskFastPath'],
  ['instructions/11-fix.instructions.md', 'backlog 来源前置真相复核'],
  ['instructions/15-memory.instructions.md', 'Context Rehydration Contract（记忆侧）'],
  ['instructions/15-memory.instructions.md', 'ContextHandoffCard（记忆侧）'],
  ['instructions/16-report.instructions.md', 'ContextHandoffCard'],
  ['skills/cp-gate/SKILL.md', 'SimpleTaskFastPath'],
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
  ['skills/report/SKILL.md', 'ReleaseAudit'],
  ['prompts/report-audit.prompt.md', '发布前审查(RL-1~RL-10)'],
  ['README.md', 'audit-release'],
  ['README.md', '明确自然语言 auto'],
  ['website/docs/guide/release.md', 'RL-1~RL-10'],
  ['website/docs/guide/release.md', '远端 CI'],
  ['prompts/implementation-plan.prompt.md', 'Backlog Intake 真相复核'],
  ['prompts/implementation-plan.prompt.md', 'SimpleTaskFastPath'],
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
  ['scripts/lib/validate-governance-tail.js', 'checkV57']
]

for (const [file, needle] of probes) mustInclude(file, needle)
mustIncludeInChangelogs('ReviewCoverageDelta')
mustIncludeInChangelogs('复审覆盖增量')

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

const plugin = JSON.parse(read('plugin.json'))
for (const [id, file] of [
  ['spec-governance', 'skills/spec-governance/SKILL.md'],
  ['source-consumer-sync', 'skills/source-consumer-sync/SKILL.md'],
  ['host-contract-verification', 'skills/host-contract-verification/SKILL.md'],
  ['audit-release', 'skills/audit-release/SKILL.md']
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
