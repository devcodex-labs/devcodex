---
agent: agent
description: 实施计划文档模板，用于 CP3 阶段创建标准实施计划
applyTo: .devcodex/**/requirements/**
---
# 实施计划模板

> **路径**: `.devcodex/**/requirements/<中文描述>/04-实施计划.md`
> **触发**: dev 工作流 CP3 阶段，且 ArtifactDecisionMatrix 判定 `04-实施计划.md` 为 `create` / `update`
> ⚠️ 本模板只承接任务拆分、实施顺序、前置依赖、验证方式与回滚策略，不重复需求背景或技术方案中的设计论证。
> ⚠️ 生成的 Markdown 实施计划文档必须在头部后补 `## 目录导航`。
> ⚠️ SimpleTaskFastPath、docs/init/plan-review 子类型豁免或其他合法 CP3 豁免场景，可将 `04-实施计划.md` 标为 `N/A + skipReason`；不得用本模板“补文书”覆盖已确认的轻路径或子类型豁免。
> ⚠️ 控制面、Auto、多批次、预计修改 ≥10 文件、模板-示例-校验链或发布前置任务，计划中必须列出 ExecutionContract / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / 05-实施进度.md 的触发状态与证据。
> ⚠️ 项目/目录扫描计划必须先写 `ProjectArtifactScaleRoutingGate`、ScaleDecisionRecord、exclusion、batch/checkpoint、invalid-run 与 V91；不得把“全量 inventory”默认等同“逐字读取所有文件”。
> ⚠️ 若本轮任务或批次直接来源于 `data/*.md` 的 open/partial 项，计划中必须显式写出 Backlog Intake 真相复核和台账状态回写闭环：先分类 `pure-open / residual-tail / already-fixed / misclassified`，再说明本轮范围是否缩减以及回写证据如何产出。
> ⚠️ 若 CP1 真相源是产品直接提供的 `01-产品需求.md`，实施计划只能承接产品原文、流程节点、前端交互、字段描述和 AI / 研发缺口检查结果；不得把计划写成新的产品需求稿。
> ⚠️ 发布、pack、benchmark、codegen 或包边界任务必须写明串行验证顺序：构建/生成完成后再单独执行 package boundary check，不得与会写入 `dist` 的命令并行。
> ⚠️ 文档、UI、专家质量、发布、数据、安全、性能、外部消费者、复审或治理等条件能力统一从 `skills/spec-governance/gate-registry.json` 选择 `gateGroup` 与 Owner Skill；计划只记录实际触发项、Owner 产物、验证路线和 skipReason，不维护版本化 Gate/Owner 名录。命中 `brand-visual-quality` 时把母版谱系、主题几何、微尺寸/单色、视觉证据和 blocker reset 分配到同一可验收批次。

## 计划模式

| 模式 | 适用场景 | 必填内容 |
|------|---------|---------|
| 轻计划摘要 | 小到中型任务、单阶段收口、无高风险接口或 Schema 破坏性变更 | 总览、任务分解、实施顺序、验证方式、回滚摘要 |
| 完整实施计划 | 高风险 / 多模块 / 接口或 Schema 变更 / 跨轮次实施 | 总览、任务分解、里程碑、风险点与回滚、技术验证清单 |

> ⚠️ `04-实施计划.md` 只在 CP3 触发且 ArtifactDecisionMatrix 判定需要 `create` / `update` 时创建；小任务优先使用“轻计划摘要”，只有高风险或多阶段任务才展开为“完整实施计划”。若状态为 `skip` / `N/A`，必须在报告或记忆写明 `reason` 与 `upgradeTrigger`。

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
- [§4.2 最小实现与注释守门](#42-最小实现与注释守门)
- [§5 独立验证方式](#5-独立验证方式)
- [§6 里程碑 / 实施顺序](#6-里程碑--实施顺序)
- [§7 风险点、回滚触发与回滚方案](#7-风险点回滚触发与回滚方案)
- [§8 技术验证清单](#8-技术验证清单)
```

## §1 总览

> 一句话描述本次实施范围，强调“这次要怎么落地”，而不是重新解释“为什么这样设计”。轻计划摘要只保留最小顺序与验证信息；完整实施计划再展开里程碑与风险细节。

**预计工作量**：[X] 小时 / 天  
**风险等级**：🔴 高 / 🟡 中 / 💡 低

## §2 任务分解

> 每个任务都应能回到 CP1 需求项、产品直接提供的 `01-产品需求.md` 原文锚点、流程节点或 CP2 派生技术验证项，且写清验证方式；不要把架构设计、接口论证再复制一遍。

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

> 只列本任务实际触发的支撑产物。治理能力从 `skills/spec-governance/gate-registry.json` 选择 `gateGroup` 与 Owner Skill；TestRoute 的结构以 `skills/test-router/test-route-schema.json` 为准，不复制完整 Gate 或字段清单。

| 产物 / gateGroup | 状态 | 触发事实 | Owner / 真相源 | 计划落点 | 验证路线 / skipReason |
|------------------|------|----------|------------------|----------|------------------------|
| ExecutionContract / RepairCollaborationContract | | | execution-contract | | |
| TestRoute | | | test-router schema | | |
| ConceptSyncMap / ProfileImpactCheck | | | source-consumer-sync / load-profile | | |
| 其他适用 gateGroup | | | registry ownerSkill | | |

`local-observability-contract` 命中时，计划必须包含 CLI human/json/error/exit、typed local probe dependency/error/zero-write、公开文档与 package boundary 的任务和验证映射。

`agent-turn-liveness` 命中时，把状态机/Hook adapter、双阶段 CheckpointValidation、LocalTaskTrace/只读 replay、Owner/consumer sync、gray sidecar 严格拆批；前一批 direct replay 与 fault matrix 未通过前不得开放后一批。sidecar 和 trace replay 默认只读，不得在计划中预授权 payload 执行、operation replay、自动 mutation 或进程控制。

跨会话、多批次、服务启动、发布、依赖升级或台账回写等条件产物，在命中时作为“其他适用 gateGroup/产物”逐项加入；未命中只保留一条聚合 `N/A + skipReason`。


### §4.2 最小实现与注释守门

> 实施计划必须继承 CP1/CP2 的 `ImplementationComplexityLevel`，把“做小”和“必要注释”落到任务级，避免执行阶段把 5 行修复扩展成无计划的企业级结构。默认 `简单够用` 时，只排满足已确认产品事实源和技术验证项的局部最小任务；若要升级到 `中等` / `企业级`，必须已有用户确认，并写明开发周期、难度、维护成本和取舍。

#### 复杂度预算

| 项 | 本轮计划 | 不得顺手扩展的边界 | 偏移处理 |
|----|---------|-------------------|----------|
| 变更文件 / 函数 / 类 | | | |
| 新增分支 / 状态 | | | |
| 新增抽象 / 工具层 | | 禁止无计划新增抽象；仅已确认消费者、既有本地模式、边界隔离或契约需要可新增 | 回 CP2 / CP3 |
| 防御性处理 | | 只覆盖已确认输入、兼容、安全或错误契约；service 不重复 route/model/schema 已保证职责 | 回 CP2 / CP3 |
| 必要注释 | | 非显然业务规则、状态转换、不变量、兼容约束、安全边界、外部契约映射、反直觉权衡必须写短注释；JS/Node 必要注释使用标准 JSDoc | 执行前补齐 |

- “不能顺手扩展的边界”必须点名禁止新增的抽象、配置、分支或预留能力。
- 执行中发现确需超出复杂度预算、引入新抽象或新增注释依赖的复杂逻辑，先暂停并更新 CP2/CP3；不得在实现里自行扩写。
- 注释只解释关键意图和约束，禁止逐行解释、重复代码含义或保留临时 TODO。
- JavaScript / Node.js 任务中，导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明如命中必要注释触发点，计划必须写明 JSDoc 落点。
- provider / connector / 三方 SDK 任务必须在任务分解中包含字段级合同落地项；包 / 库 / adapter / CLI 任务必须包含包工程层检查项。

## §5 独立验证方式

> 完整计划必须给出可独立复现的验证。先从 TestRoute schema 选择 selector，再把 registry Owner 的专属证据链接进来；不得复制 Gate 总表。

| selector / gateGroup | 验证命令或目标 | 独立证据 | 通过标准 | 失败/跳过处理 |
|----------------------|----------------|----------|----------|---------------|
| static | | | | |
| unit-integration | | | | |
| api / runtime-e2e | | | | |
| package-release / profile-deploy | | | | |
| 适用 Owner gateGroup | | | | |

高风险、控制面、公共契约、跨宿主分发或正式发布至少需要两类独立证据。AI 启动的服务还要记录生命周期清理；不存在的路线按 schema 写完整 skipped 记录。


## §6 里程碑 / 实施顺序

> 完整实施计划使用里程碑表表达阶段性验证；轻计划摘要可改为“实施顺序”列表，但仍要说明任务先后与阶段完成点。

| 里程碑 | 包含任务 | 验证方式 |
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

## §8 技术验证清单

- [ ] 实施任务、影响评估与文档同步均已完成
- [ ] `test-route-schema.json` 选择的 routes 已执行，命令、exitCode、证据和 skipped 记录完整
- [ ] 所有适用 `gateGroup` 已由 registry Owner 产出证据；未触发项有聚合 `N/A + skipReason`
- [ ] ExecutionContract、RepairCollaboration、ConceptSyncMap、ProfileImpactCheck、ServiceLifecycleCleanup、Backlog/台账回写等条件产物已按触发事实处理
- [ ] 控制面/高风险任务已执行 targeted + related + full validation 或明确降级
- [ ] CHANGELOG 只按 unreleased/release 状态和项目三轨规则更新
- [ ] delivery-checklist 已核对 active task 主要产物、支持 manifest 与最终可见交付面
