---
agent: agent
description: 实施计划文档模板，用于 CP3 阶段创建标准实施计划
applyTo: .devcodex/**/requirements/**
---
# 实施计划模板

> **路径**: `.devcodex/**/requirements/<中文描述>/04-实施计划.md`
> **触发**: dev 工作流 CP3 阶段
> ⚠️ 本模板只承接任务拆分、实施顺序、前置依赖、验证方式与回滚策略，不重复需求背景或技术方案中的设计论证。
> ⚠️ 生成的 Markdown 实施计划文档必须在头部后补 `## 目录导航`。
> ⚠️ 控制面、Auto、多批次、预计修改 ≥10 文件、模板-示例-校验链或发布前置任务，计划中必须列出 ExecutionContract / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / 05-实施进度.md 的触发状态与证据。
> ⚠️ 若本轮任务或批次直接来源于 `data/*.md` 的 open/partial 项，计划中必须显式写出 Backlog Intake 真相复核和台账状态回写闭环：先分类 `pure-open / residual-tail / already-fixed / misclassified`，再说明本轮范围是否缩减以及回写证据如何产出。

## 计划模式

| 模式 | 适用场景 | 必填内容 |
|------|---------|---------|
| 轻计划摘要 | 小到中型任务、单阶段收口、无高风险接口或 Schema 破坏性变更 | 总览、任务分解、实施顺序、验证方式、回滚摘要 |
| 完整实施计划 | 高风险 / 多模块 / 接口或 Schema 变更 / 跨轮次实施 | 总览、任务分解、里程碑、风险点与回滚、验收清单 |

> ⚠️ `04-实施计划.md` 始终要创建，但不要求所有任务都套用同一重量级模板；小任务优先使用“轻计划摘要”，只有高风险或多阶段任务才展开为“完整实施计划”。

---

```markdown
# [功能名称] 实施计划

> **版本**: v0.0.1
> **日期**: YYYY-MM-DD
> **关联方案**: [技术方案路径]
> **计划模式**: 轻计划摘要 / 完整实施计划
> **状态**: 计划中 / 执行中 / 已完成
```

## 目录导航

```markdown
## 目录导航

- [§1 总览](#1-总览)
- [§2 任务分解](#2-任务分解)
- [§3 分批执行策略](#3-分批执行策略)
- [§4 关键实施约束](#4-关键实施约束)
- [§4.1 执行契约与支持技能](#41-执行契约与支持技能)
- [§5 独立验证方式](#5-独立验证方式)
- [§6 里程碑 / 实施顺序](#6-里程碑--实施顺序)
- [§7 风险点、回滚触发与回滚方案](#7-风险点回滚触发与回滚方案)
- [§8 验收清单](#8-验收清单)
```

## §1 总览

> 一句话描述本次实施范围，强调“这次要怎么落地”，而不是重新解释“为什么这样设计”。轻计划摘要只保留最小顺序与验证信息；完整实施计划再展开里程碑与风险细节。

**预计工作量**：[X] 小时 / 天  
**风险等级**：🔴 高 / 🟡 中 / 💡 低

## §2 任务分解

> 每个任务都应能回到需求项或验收项，且写清验证方式；不要把架构设计、接口论证再复制一遍。

| 编号 | 任务 | 前置依赖 | 关联需求 | 验证方式 | 完成标准 |
|------|------|---------|---------|---------|---------|
| T-01 | | — | | | |
| T-02 | | T-01 | | | |
| T-03 | | T-02 | | | |

## §3 分批执行策略（完整实施计划重点）

> 完整实施计划默认应写清分批策略；轻计划摘要可压缩为 1~3 条顺序说明，但不能缺失“先做什么、后做什么、为什么这样排”。

| 批次/阶段 | 包含任务 | 进入条件 | 完成条件 |
|-----------|---------|---------|---------|
| Batch 1 | | | |
| Batch 2 | | | |

## §4 关键实施约束

> 仅记录影响实施顺序、切换条件和执行边界的关键约束；不要把通用背景再复制一遍。

- 技术约束：
- 数据/兼容性约束：
- 不能顺手扩展的边界：
- 需要回 CP2 / CP1 的触发条件：

### §4.1 执行契约与支持技能

| 产物 | 是否触发 | 触发依据 | 计划落点 |
|------|:--------:|----------|----------|
| ExecutionContract | 是 / 否 | Auto / 控制面 / 多批次 / 预计修改 ≥10 文件 / release 前置任务 | scope / allowedPaths / requiredArtifacts / validationRoute / deviationPolicy / rollbackPlan |
| TestRoute | 是 / 否 | 跨模块 / API / Hook / CLI / 模板-示例-校验链 / 测试路线不明显 | changeType / routes / commands / skipReason / blockingLevel |
| ReleaseAudit | 是 / 否 | 发版前 review / publish 或 tag 前风险审查 / release readiness | RL-1~RL-10 / risks / recommendation |
| ReleaseVerification | 是 / 否 | 用户要求 tag / release / publish 或进入正式发版 | R0~R7 |
| ConceptSyncMap | 是 / 否 | 控制面 / 模板-示例-校验链 / README / website / Profile / validate / 部署副本联动 | sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies / yellowDeviationBoundary |
| HostContractVerification | 是 / 否 | Hook / CLI / visible reply / sticky project / workspace guard / bootstrap / ArtifactLinkSet / MCP fallback | hostSurface / eventScope / evidenceMode / visibleReplyEvidence / workspaceGuard / bootstrapScope / artifactLinkMatrix / mcpFallback |
| 05-实施进度.md | 是 / 否 | 跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面或模板-校验链任务 | CP 状态 / 批次状态 / 阻塞 / 验证证据 |
| Backlog Intake 真相复核 | 是 / 否 | 任务/批次直接来源于 `data/*.md` open/partial 项 | candidateIds / classification / evidence / scopeDelta |
| 台账状态回写闭环 | 是 / 否 | 本轮会关闭/部分关闭/改分类任何 VL/PF/PI/ISSUE/GAP | targetLedgers / requiredFields / writebackEvidence / rescanResult |

## §5 独立验证方式

> 完整实施计划默认需要独立验证方式。轻计划摘要也至少要说明“执行后如何独立确认这批变更真的成立”。

| 验证项 | 验证方式 | 通过标准 |
|--------|---------|---------|
| ExecutionContract | 对照 scope / allowedPaths / requiredArtifacts / validationRoute | 无范围偏移，偏移均按 deviationPolicy 处理 |
| TestRoute | 对照变更类型执行对应命令 | 路线覆盖完整，跳过项有依据 |
| ConceptSyncMap | 对照 sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies | 当前消费者与探针无漏改，历史镜像边界明确 |
| HostContractVerification | 对照 hostSurface / eventScope / evidenceMode / workspaceGuard / artifactLinkMatrix / mcpFallback | direct replay / fixture / targeted test 证据与声明一致；产物链接与 MCP fallback 不只停留在文案 |
| Backlog Intake 真相复核 | 对照 candidateIds / classification / evidence / scopeDelta | open 统计与本轮范围一致，非 `pure-open` 项已缩减或剔除 |
| 台账状态回写闭环 | 对照 targetLedgers / requiredFields / writebackEvidence / rescanResult | 状态、证据、计数与报告/进度/SUMMARY 一致 |
| 模板/规则一致性 | | |
| 样本映射 | | |
| 自动化校验 | | |

## §6 里程碑 / 实施顺序

> 完整实施计划使用里程碑表表达阶段性验收；轻计划摘要可改为“实施顺序”列表，但仍要说明任务先后与阶段完成点。

| 里程碑 | 包含任务 | 验收方式 |
|--------|---------|---------|
| M1 | T-01~T-02 | |
| M2 | T-03~Tn | |

## §7 风险点、回滚触发与回滚方案

> 轻计划摘要至少要写出回滚摘要；完整实施计划应写到可执行粒度：失败后撤回什么、恢复到什么状态、如何确认已恢复。

| 任务 | 风险 | 回滚方案 |
|------|------|---------|
| T-0X | | |

### §7.1 回滚触发条件

> 明确哪些情况出现时，应暂停后续批次、回退当前批或回到上游 CP 重新确认。

-

## §8 验收清单

- [ ] 所有任务完成
- [ ] 关键路径单测通过
- [ ] api-verification 通过（若涉及接口）
- [ ] impact-review 完成
- [ ] ExecutionContract 已建立并执行（若触发）
- [ ] TestRoute 已建立并覆盖（若触发）
- [ ] ReleaseAudit RL-1~RL-10 已完成（若触发布前审查）
- [ ] ReleaseVerification R0~R7 已完成（若进入正式发版）
- [ ] ConceptSyncMap 已建立并核对当前消费者/探针/部署副本（若触发）
- [ ] HostContractVerification 已建立并核对宿主证据/guard/visible reply/ArtifactLinkSet/MCP fallback（若触发）
- [ ] 05-实施进度.md 已按触发条件持续同步（若触发）
- [ ] Backlog Intake 真相复核已完成并收紧范围（若触发）
- [ ] 台账状态回写闭环已完成并复核 open 计数（若触发）
- [ ] document-sync 完成
- [ ] CHANGELOG / unreleased 已按发布状态更新
- [ ] §8 验收标准逐条核查通过（含负向场景）
- [ ] delivery-checklist 交付物完整性核查通过
