---
agent: agent
description: 修复工作流报告模板，用于 fix 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/bugs/**
---
# 修复报告模板

> **路径**: 优先 `.devcodex/bugs/<问题>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/bugs/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: fix 工作流完成后，由 `report/SKILL.md` 驱动生成
> **共享基模**: `skills/report/report-schema.json` 的 baseFields + fix overlay；治理结果按 `gateGroup / result / evidence / skipReason` 记录
> **字段约束**: 每条问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证
---

```markdown
# [问题名称] 修复报告

> **项目**: <project>
> **类型**: fix
> **子类型**: default / incident / security
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **严重级别**: P0 / P1 / P2 / P3
> **状态**: 进行中 / 已完成
> **事件级别**: P0 / P1 / P2（incident 类型必填）
> **事件时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
> **响应时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
> **修复时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
> **Release 状态**: 未进入 / 待用户确认 / 已执行
> **日志落点**: `changelogs/unreleased.md` / `CHANGELOG.md + changelogs/releases/vX.Y.Z.md`
> **支撑产物**: ExecutionContract / RepairPreventionAssessment / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / CliDiagnosticContract / CheckpointValidation / LocalTaskTrace / TurnLivenessRecovery / 05-实施进度.md（按触发状态填写）
> **ContextHandoffCard**: 触发时填写；未触发写 N/A + skipReason
```

## §1 问题摘要

**现象**：  
**根因**：  
**影响范围**：

## §2 修复方案

**方案描述**：  
**变更文件**：

```text
修改：
  src/xxx.ts (修复内容)
```

## §3 CP 确认记录

| CP | 状态 | 用户响应 | 时间 |
|:--:|:----:|---------|------|
| CP1 | ✅ / N/A | 确认问题分析 | HH:MM |
| CP2 | ✅ / N/A | 确认修复方案 | HH:MM |
| CP3 | ✅ / N/A | 确认实施计划 | HH:MM |

## §4 修复三步扫描

| 扫描项 | 结果 | 证据 |
|--------|:----:|------|
| 同类全局扫描 | ✅ / ⚠️ | |
| 数据联动扫描 | ✅ / ⚠️ | |
| grep 零残留复核 | ✅ / ⚠️ | |

## §4.5 工作流 overlay 与治理证据（条件）

<!-- devcodex:include shared/report/shared-schema-note.md -->

<!-- devcodex:include shared/report/host-capability-routing-record.md -->

<!-- devcodex:include shared/report/gate-result-table.md -->

<!-- devcodex:include shared/report/context-handoff-condition.md -->

所有 fix 追加 `RepairPreventionAssessment` 条件段：引用 `RepairPreventionAssessmentV1`，分别记录 preventionDecision/mode、immediateClosureEvidence、prospectiveEvidencePlan/effectivenessStatus 和 rollbackOrSunset；`no-new-control` 记录 reason/evidence，禁止把本次回归通过写成长期 prevention effective。

ECR 的 review 状态必须来自唯一 `ReviewStateSnapshotV1`，并引用 planId、candidate/stage、fresh receipt digests、EvidenceSaturation 与 StageTiming；不得在报告手写另一套 open/blocker/stale 计数。

命中用户可见输出时追加 `VisibleOutputContract`：引用同一 `ArtifactDeliveryManifestV1.manifestDigest`、`UserFacingArtifactSetV1` 计数、`PostCompletionActionSetV1`、`DevCodexVisibleEnvelopeV2.semanticDigest`、持久化 `LinkCapabilityDecisionV1`、用户面 `HostLinkCapabilityDecisionV2` 的 hostSurface/presentationSurface/rendererId/evidenceState/openMode/fallbackReason 和 renderer parity。默认用户列表不包含 session/daily/SUMMARY/task/checkpoint/raw receipt/manifest/ledger，但这些内部产物仍须写入、验证和参与 ECR。

<!-- devcodex:include shared/report/mcp-fallback-recording.md -->

## §5 回归验证

| selector / gateGroup | 结果 | 修复前失败证据 | 修复后证据 / skipReason |
|----------------------|:----:|----------------|-------------------------|
| static / unit-integration | | | |
| api / runtime-e2e | | | |
| package-release / profile-deploy | | | |
| 实际触发的 Owner gateGroup | | | |

必须包含原始重现、同类扫描、数据联动和零残留证据；领域专属 Gate 通过 Owner 链接引用。


## §5.5 ECR 执行闭环复审

<!-- devcodex:include shared/report/review-grade-card-template.md -->

| ECR 项 | 检查对象 | 结果 | 证据 |
|--------|----------|:----:|------|
| ECR-1 | CP1/CP2/CP3、05-实施进度、报告、daily tasks、SUMMARY | ✅/⚠️ | |
| ECR-2 | 问题 ID / 根因链 → diff/commit 文件 | ✅/⚠️ | |
| ECR-3 | CP3 步骤 / ExecutionContract / TestRoute / ServiceLifecycleCleanup / ConceptSyncMap / HostContractVerification → 测试/部署/验证证据 | ✅/⚠️ | |
| ECR-4 | 修复报告声明 → 测试/扫描/探针结果/OfficialDocsEvidence/ProfileImpactCheck/ReleaseAudit/ReleaseVerification/VisibleOutputContract/部署同步证据；派生资产追加 post-stage candidate + post-commit replay | ✅/⚠️ | |
| ECR-5 | memory daily → SUMMARY | ✅/⚠️ | |
| ECR-6 | git dirty 边界 | ✅/⚠️ | |
| ECR-7 | 控制面任务 SCV / validate / direct replay / host-contract probe / 新增探针 / 黄色偏离 / backlog 真相复核 / 台账状态回写 | ✅/N/A | |

## §6 时间线（incident 类型必填，秒级精度供响应时效审计）

| 时间 | 事件 |
|------|------|
| YYYY-MM-DD HH:MM:SS | 事故发生 |
| YYYY-MM-DD HH:MM:SS | 发现/告警 |
| YYYY-MM-DD HH:MM:SS | 止血完成 |
| YYYY-MM-DD HH:MM:SS | 根因确认 |
| YYYY-MM-DD HH:MM:SS | 修复上线 |

> ⚠️ **incident 必须秒级**：P0 要求 15 分钟内初步方案，秒级时间是后续 SLA 审计依据；P1/P2 可降级为分钟级 `YYYY-MM-DD HH:MM`。

## §7 问题/建议验证

| 问题/建议 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 |
|-----------|--------|----------|------|----------|----------|
| | | | | ✅已验证 / ⚠️待验证 | |

## §7.5 推荐结论

**推荐**：[推荐方案 / 推荐：无后续动作]
**推荐理由**：[若有多个后续建议或处理路径，说明为何推荐该项；无后续动作时说明原因]

## §8 改进 Action Items（incident 必填）

| 改进点 | 优先级 | 负责人 | 截止时间 |
|--------|:------:|--------|---------|

## §9 后置处理

- [ ] document-sync、影响评估与 ProfileImpactCheck 已完成或有 skipReason
- [ ] ExecutionContract、RepairCollaboration、RepairPreventionAssessment、TestRoute 和实际触发的 registry gateGroup 已收口
- [ ] 复审逃逸如有发生，whyMissed、prevention、checklistPatch 与 rerunEvidence 已回写 Owner 产物
- [ ] 服务生命周期、进度、ContextHandoffCard 和台账状态已按触发条件同步
- [ ] release-status：未进入 / 待用户确认 / 已执行；CHANGELOG / unreleased 已按发布状态更新
