---
agent: agent
description: 实施进度报告模板，用于记录多阶段实施的当前进度
applyTo: .devcodex/**/{requirements,bugs}/**; .devcodex/**/fix/**
---
# 实施进度模板

> **路径**: dev 使用 `.devcodex/**/requirements/<中文描述>/05-实施进度.md`；fix 使用当前 bug/fix 任务目录下的 `05-实施进度.md`
> **触发**: 实施阶段中间检查点
> ⚠️ 条件触发：任务跨多轮/多阶段、存在明确阻塞、用户要求持续跟踪、多批次执行、预计修改 ≥10 文件、控制面任务、模板-示例-校验链或部署同步联动时启用；默认前提是已存在 `04-实施计划.md`，docs/init/plan-review 等 CP3 豁免场景可使用已确认文档大纲、任务切片或 ContextHandoffCard 作为等价计划锚点。
> ⚠️ 进度文档必须引用 ArtifactDecisionMatrix 的当前状态，说明 `05-实施进度.md` 本身为何是 `create` / `update`，以及其他关键产物的 `skip` / `N/A` 是否仍成立。
> ⚠️ 生成的 Markdown 实施进度文档必须在头部后补 `## 目录导航`。
> ⚠️ 若本轮任务或批次来源于 `data/*.md` open/partial 项，进度中必须持续记录 Backlog Intake 真相复核分类结果，以及台账状态回写闭环是否已完成。

---

```markdown
# [功能名称] 实施进度

> **日期**: YYYY-MM-DD HH:MM
> **关联计划**: [实施计划路径 / 等价任务切片 / ContextHandoffCard 路径]
> **当前轮次**: R[N]
> **当前 CP**: CP1 / CP2 / CP3 / 执行中 / ECR
> **当前批次**: Batch N / N
```

## 目录导航

```markdown
## 目录导航

- [进度总览](#进度总览)
- [批次执行进度](#批次执行进度)
- [支撑产物状态](#支撑产物状态)
- [当前轮次工作](#当前轮次工作)
- [阻塞与恢复](#阻塞与恢复)
- [下一步](#下一步)
- [变更记录](#变更记录)
```

## DeliveryHonestyMatrix（强制 · 防过报）

> 进度只能写 **有证据 / 未做 / partial**；禁止「全 ✅ / 5/6 / 只差验收」而无验证表。  
> 强完成宣称须带阶段报告路径（`reports/...`）。机器 gap：`progress-overclaim` · `stage-report-missing`。

| 字段 | 值 |
|------|-----|
| stageReportPath | 有路径 / 无 / N/A+skipReason |
| progressHonest | 是（每行有证据）/ 否 |
| checklistVisible | 03-复审清单 或 review-checklists 路径 |
| validationEvidence | 命令 + exitCode |
| ecrStatus | pending / done + ECR 报告路径（测试绿≠ECR） |

## 进度总览

> 只记录执行推进情况，不重复需求背景、技术方案正文或实施计划的完整任务定义。

| 任务 | 状态 | 是否阻断主线 | 完成时间 | 备注 |
|------|:----:|:------------:|---------|------|
| T-01 | ✅ 完成 | 否 | | |
| T-02 | 🔄 进行中 | 否 / 是 | | |
| T-03 | ⏳ 待开始 | 否 | | |

**完成率**: X / N 任务（X%）

## 批次执行进度

| 批次 | 范围 | 状态 | 验证/证据 | 下一步 |
|------|------|:----:|-----------|--------|
| Batch 1 | | ✅/🔄/⏳ | | |
| Batch 2 | | ✅/🔄/⏳ | | |

## 支撑产物状态

| 产物 | 触发依据 | 当前状态 | 证据 |
|------|----------|:--------:|------|
| ExecutionContract | Auto / 控制面 / 多批次 / 预计修改 ≥10 文件 / release 前置任务 | ✅/🔄/N/A | |
| RepairCollaborationContract | repair task；lightweight/full 由风险决定，模型名称不触发 | ✅/🔄/N/A | contractState / authorizationEvidence / acceptance evidence；full 的 finding map / handoff / independent re-review |
| RepairPreventionAssessment | 所有 repair accepted 前必经；light/full 由风险与 repeat escape 决定 | ✅/🔄/N/A | decision / immediateClosure / prospectiveStatus / rollbackOrSunset；current rerun 不得晋级 prevention |
| ReviewExecution | 正式复审/ECR/确认后高风险复审 | ✅/🔄/N/A | planId / candidateDigest / reviewClass / fresh receipt digests / saturation / snapshotDigest / StageTimingV1 |
| TestRoute | 跨模块 / API / Hook / CLI / 模板-示例-校验链 / 测试路线不明显 | ✅/🔄/N/A | |
| LeakRiskStabilityPressureTest | 写测试/回归验证命中长运行、并发、资源生命周期或 PE-12 风险 | ✅/🔄/N/A | baseline / pressureScenario / cooldown / resourceMetrics / skipReason |
| ReleaseAudit | 发版前 review / publish 或 tag 前风险审查 | ✅/🔄/N/A | RL-1~RL-10 / risks / recommendation |
| ReleaseVerification | tag / release / publish / 发布前验证 | ✅/🔄/N/A | |
| ConceptSyncMap | 控制面 / 模板-示例-校验链 / README / website / Profile / validate / 部署副本联动 | ✅/🔄/N/A | sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies / yellowDeviationBoundary |
| VisibleOutputContract | entry/completion/confirmation/progress/final/error 或文件交付 | PASS/🔄/N/A | manifestId / reconciliation / visibleSetId / listed+remaining=total / requiredHidden / semanticDigest / rendererTier |
| HostContractVerification | Hook / CLI / visible envelope / sticky project / workspace guard / bootstrap / LinkCapability / MCP fallback / local observability | ✅/🔄/N/A | hostSurface / eventScope / evidenceMode / visibleReplyEvidence / workspaceGuard / bootstrapScope / capabilityEvidence / rendererParity / mcpFallback / localProbe / checkpointValidation / localTaskTrace |
| CliDiagnosticContract | machine-readable CLI / typed local probe / stable error or exit | ✅/🔄/N/A | envelope / humanCompatibility / errorCode / nextStep / nativeExitMap / localOnly / zeroWrite |
| CheckpointValidation | response-time / post-execution evidence | ✅/🔄/N/A | mode / status / evidenceState / deadlineAt / errorCode |
| LocalTaskTrace | current-turn trace / read-only replay | ✅/🔄/N/A | traceId / sequence / terminal / restart / replayBoundary / sourceHash |
| ProjectKnowledge | 增量项目分析 / 逐文件分批 / V2 snapshot reuse | ✅/🔄/N/A | snapshot/plan/receipt/binding identity / inventory Merkle / changed / affected / lens-gap / reused / 5% oracle / SemanticClaim authority+range / V1 read-only migration / accepted pointer / claim boundary |
| ExecutionAttemptLedger | formal run / 重复失败 / cancel / restart | ✅/🔄/N/A | qualification / attemptNo / failureSignature / source+evidence delta / FirstPassYield / timing split / terminal / StopSnapshot |
| ExecutionOptimizationStateV2 | 执行链索引/cache/changed/section/bundle/snapshot 优化 | ✅/🔄/N/A | feature lifecycle / `ExecutionOptimizationFeatureDecisionV1` 六消费者实接 / prospective trial / correctness / benefit / fallback regression / overhead / false positive / `full-only` rollback / V101 |
| OfficialDocsEvidence | 依赖 / 框架 / SDK / 平台 API / 外部模块引入或升级 | ✅/🔄/N/A | 官方文档来源 / 关键用法 / 限制 / 兼容性 / skipReason |
| ProfileImpactCheck | 项目技术栈 / 目录 / 脚本 / 配置 / 发布状态变化 | ✅/🔄/N/A | targetProfileFiles / updateOrSkip / skipReason / evidence |
| ConsumerDependencyTreeProbe | 消费者验证失败且症状指向依赖、插件、共享库或框架适配 | ✅/🔄/N/A | package.json / lockfile / node_modules / npm ls <关键依赖> / sourcePatchDecision |
| PackageBoundarySerialCheck | release / pack / package boundary / benchmark / codegen | ✅/🔄/N/A | build 完成点 / 单独 pack 命令 / dist 写入竞争排除 / dirty 残留清理 |
| Backlog Intake 真相复核 | `data/*.md` open/partial 项来源的需求/批次 | ✅/🔄/N/A | candidateIds / classification / scopeDelta |
| 台账状态回写闭环 | 本轮改变了 VL/PF/PI/ISSUE/GAP 状态 | ✅/🔄/N/A | targetLedgers / writebackEvidence / rescanResult |
| LatestAbsorptionExecutionPack A1~A10 | 最新可吸纳确认实施、文档语义/示例/派生消费者/Profile feature/批次证据补强 | ✅/🔄/N/A | ownerSkill / validationRoute / V82 / EvidenceLedger / Progress Card / skipReason |
| document-sync | 代码/规范/模板/部署副本联动 | ✅/🔄/N/A | |

## 当前轮次工作

> 本轮完成了什么、推进到了哪里：

**本轮验证结果**：
-
- backlog 来源任务需补充：本轮真相复核结果 / 状态回写结果 / open 计数变化。

## 阻塞与恢复

| 问题/阻塞 | 是否阻断主线 | 责任方 | 预计解除时间 | 当前处理方式 | 下次检查点 |
|------------|:------------:|--------|---------------|-------------|------------|
| | 否 / 是 | | | | |

## 下一步

> 下一轮次计划完成的任务：

## 变更记录

> 仅记录执行中发生的范围调整、顺序调整或阻塞变化；若未发生变化，可写 N/A。

| 变更 | 原因 | 影响 |
|------|------|------|
