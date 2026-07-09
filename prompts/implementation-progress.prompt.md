---
agent: agent
description: 实施进度报告模板，用于记录多阶段实施的当前进度
applyTo: .devcodex/**/requirements/**
---
# 实施进度模板

> **路径**: `.devcodex/**/requirements/<中文描述>/05-实施进度.md`
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
| TestRoute | 跨模块 / API / Hook / CLI / 模板-示例-校验链 / 测试路线不明显 | ✅/🔄/N/A | |
| LeakRiskStabilityPressureTest | 写测试/回归验证命中长运行、并发、资源生命周期或 PE-12 风险 | ✅/🔄/N/A | baseline / pressureScenario / cooldown / resourceMetrics / skipReason |
| ReleaseAudit | 发版前 review / publish 或 tag 前风险审查 | ✅/🔄/N/A | RL-1~RL-10 / risks / recommendation |
| ReleaseVerification | tag / release / publish / 发布前验证 | ✅/🔄/N/A | |
| ConceptSyncMap | 控制面 / 模板-示例-校验链 / README / website / Profile / validate / 部署副本联动 | ✅/🔄/N/A | sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies / yellowDeviationBoundary |
| HostContractVerification | Hook / CLI / visible reply / sticky project / workspace guard / bootstrap / ArtifactLinkSet / MCP fallback | ✅/🔄/N/A | hostSurface / eventScope / evidenceMode / visibleReplyEvidence / workspaceGuard / bootstrapScope / artifactLinkMatrix / mcpFallback |
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
