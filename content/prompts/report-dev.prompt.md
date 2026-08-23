---
agent: agent
description: 开发工作流报告模板，用于 dev 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/requirements/**
---
# 开发报告模板

> **路径**: 优先 `.devcodex/**/requirements/<需求>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/**/reports/requirements/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: dev 工作流完成后，由 `report/SKILL.md` 驱动生成
> ⚠️ **测试绿 ≠ ECR**：`npm test` / 探针 exit 0 不能代替 **N6 ECR 执行闭环复审**。强完成/关需求话术须含 ECR 段 + DoD 对账表，否则 Stop gap `ecr-missing`。
> ⚠️ **PF-175 路径列**：报告/完成回复中的产物表须 `语义名称 | 用途 | 路径 | 操作`；禁止「文件|内容」无路径。Grok 状态条 **N failed** = 工具 outcome 计数（可含已自愈的错路径），≠ 任务失败。
> **共享基模**: `skills/report/report-schema.json` 的 baseFields + dev overlay；治理结果按 `gateGroup / result / evidence / skipReason` 记录
> **字段约束**: 每条遗留问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证
---

```markdown
# [功能名称] 开发报告

> **项目**: <project>
> **类型**: dev
> **子类型**: default / refactor / database / init / optimization / scenario-test / docs / plan-review
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
> **关联需求**: [路径]
> **关联方案**: [路径]
> **Release 状态**: 未进入 / 待用户确认 / 已执行
> **日志落点**: `changelogs/unreleased.md` / `CHANGELOG.md + changelogs/releases/vX.Y.Z.md`
> **支撑产物**: ExecutionContract / RepairPreventionAssessment（含 repair 切片时）/ TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / CapabilitySurfaceDecision / HostContractVerification / TaskResolutionV1 / ContextAcquisition / CliDiagnosticContract / CheckpointValidation / LocalTaskTrace / TurnLivenessRecovery / 05-实施进度.md（按触发状态填写）
> **ContextHandoffCard**: 触发时填写；未触发写 N/A + skipReason
```

## §1 执行摘要

> 一段话描述本次开发的核心内容和结果。

## §2 完成内容

| 任务 | 文件变更 | 说明 |
|------|---------|------|
| T-01 | | |

## §3 文件变更清单

```text
新增：
  src/xxx.ts

修改：
  src/yyy.ts (变更说明)

删除：
  (无)
```

## §4 接口变更

> 无接口变更时填"无"。

| 接口 | 变更类型 | 说明 |
|------|---------|------|

## §5 Breaking Changes

> 无 BC 时填"无"。

## §5.5 工作流 overlay 与治理证据（条件）

<!-- devcodex:include shared/report/shared-schema-note.md -->

<!-- devcodex:include shared/report/host-capability-routing-record.md -->

<!-- devcodex:include shared/report/gate-result-table.md -->

<!-- devcodex:include shared/report/context-handoff-condition.md -->

<!-- devcodex:include shared/report/task-continuation-record.md -->

命中品牌资产生产时追加 `BrandVisualQuality` 条件段：只记录五类产物链接、自动检查、人工结论、blocker reset 与剩余风险，不把文件存在或单张截图写成通过。

命中 `context-acquisition` 时追加 `ContextAcquisition` 条件段，至少记录 planId/planContentId/contextEpoch/activeRoot、selected/excluded/missing sources、`ContextReadBindingV1.bindingStatus`、`ContextReadReceiptV2.status`、content identity/reuseFrom/失效因子、fullReadReason/fallback、实际 bytes/chars/latency（tokens 不可观测则 N/A）、`ContextReadReceiptV1` reader compatibility 与 V99 结果。PreToolUse、调用文案、cache hit 或 legacy no-args full 不能作为成功证据。

dev 中含 repair 切片时追加 `RepairPreventionAssessment`：只引用 Owner 的 V1 assessment，分列 immediate closure 与 prospective evidence；纯新增能力写 `N/A + skipReason`。

命中用户操作说明或重要方案推荐时追加 `OperationExplanationContractV1` 与 `CodeTruthEvidenceMatrixGate`：记录 operationId/userGoal/resultShape/resultSource/failureSemantics/nextAction/evidence，以及 repo path/symbol/currentBehavior/negativeProbe/gap；收敛后只保留一个推荐方案或一个明确组合推荐。

正式复审/ECR 追加 `ReviewExecution`：只投影同一个 `ReviewStateSnapshotV1.snapshotDigest`，列 planId/candidate/stage/class、fresh receipt digests、saturation、nextAction 与 StageTiming；禁止在报告重新计算状态。

ECR/确认后复审追加 **ReviewGradeCard**：`c19Label`（轻量/标准/全面/发布安全）· `reviewClass`（默认 R2）· `riskClass`/`riskFlags` · `contentPack` · `result`；R1 降级须 `skipReason`；禁止「永远轻量」无理由收口。

命中用户可见输出时追加 `VisibleOutputContract`：引用同一 `ArtifactDeliveryManifestV1.manifestDigest`、`UserFacingArtifactSetV1` 计数、`PostCompletionActionSetV1`、`DevCodexVisibleEnvelopeV2.semanticDigest`、`LinkCapabilityDecisionV1` 和 renderer parity；V1 只读兼容不得作为新产物。session/daily/SUMMARY/task/checkpoint/raw receipt/manifest/ledger 默认 internal-only，但仍参与 ECR。宿主 capability 未 direct 验证时写 portable/plain/unverified，不得按宿主名推断。

命中 `evidence-freshness` 时追加 `EvidenceFreshness`：记录 `ClaimEvidenceIndexV1.indexDigest`、`StaleEvidenceLintDecisionV1.status/mode`、downgrade/rerun 计数、summary-only 边界、artifact anchor / final validation summary binding 与 `npm run test:evidence-freshness` exitCode。报告只写摘要，不复制内部 receipt 全文。

命中能力面新增/变更时追加 `CapabilitySurfaceDecision`：只引用中央 `decisionRef / status / identity / preferredSurface / validationRoute`、Owner 证据和 consumer sync 结果，不复制判定矩阵；缺失、stale、blocked 或 identity 不匹配时结论必须为 `BLOCK/UNVERIFIED`。

<!-- devcodex:include shared/report/mcp-fallback-recording.md -->

## §6 测试验证

| selector / gateGroup | 结果 | 命令与 exitCode | 证据 / skipReason |
|----------------------|:----:|-----------------|---------------------|
| static / unit-integration | | | |
| api / runtime-e2e | | | |
| package-release / profile-deploy | | | |
| 实际触发的 Owner gateGroup | | | |

TestRoute 选中的路线必须全部出现；覆盖率、视觉、文档、构建产物、资源生命周期等专属结果通过 Owner 证据链接引用，不在本模板逐 Gate 展开。

### §6.5 EvidenceFreshness（条件）

<!-- devcodex:include shared/report/evidence-freshness-table.md -->


## §7 后置处理

- [ ] impact-review、document-sync 与 ProfileImpactCheck 已完成或有 skipReason
- [ ] 条件产物和适用 gateGroup 已按共享 schema 收口
- [ ] AI 自启动服务已清理或按用户要求记录保留方式
- [ ] active task 的进度、记忆、报告、台账和最终交付面一致
- [ ] release-status：未进入 / 待用户确认 / 已执行


## §7.5 ECR 执行闭环复审

<!-- devcodex:include shared/report/review-grade-card-template.md -->

| ECR 项 | 检查对象 | 结果 | 证据 |
|--------|----------|:----:|------|
| ECR-1 | CP1/CP2/CP3、05-实施进度、报告、daily tasks、SUMMARY | ✅/⚠️ | |
| ECR-2 | 需求条款 / 问题 ID → diff/commit 文件 | ✅/⚠️ | |
| ECR-3 | CP3 步骤 / ExecutionContract / TestRoute / ServiceLifecycleCleanup / ConceptSyncMap / HostContractVerification / ContextAcquisition → 测试/部署/验证证据 | ✅/⚠️ | |
| ECR-4 | 报告声明 → 测试/探针/官方文档/OfficialDocsEvidence/ProfileImpactCheck/ReleaseAudit/ReleaseVerification/VisibleOutputContract/部署同步证据；派生资产追加 post-stage candidate + post-commit replay | ✅/⚠️ | |
| ECR-5 | memory daily → SUMMARY | ✅/⚠️ | |
| ECR-6 | git dirty 边界 | ✅/⚠️ | |
| ECR-7 | 控制面任务 SCV / validate / direct replay / host-contract probe / 新增探针 / 黄色偏离 / backlog 真相复核 / 台账状态回写 | ✅/N/A | |

## §8 遗留问题

<!-- devcodex:include shared/report/issue-suggestion-validation-table.md -->
