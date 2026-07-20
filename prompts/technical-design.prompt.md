---
agent: agent
description: 技术方案文档模板，用于 CP2 阶段创建标准技术方案
applyTo: .devcodex/**/requirements/**
---
# 技术方案模板

> **路径**: `.devcodex/**/requirements/<中文描述>/02-技术方案.md`（唯一信源：`02-output-paths.instructions.md`）
> **触发**: dev 工作流 CP2 阶段，且 ArtifactDecisionMatrix 判定 `02-技术方案.md` 为 `create` / `update`

## 编写指南

> ⚠️ 本模板只在 `02-技术方案.md` 被 ArtifactDecisionMatrix 判定为需要创建或更新时使用；若 CP2 无架构、接口、公共契约、设计决策、依赖/API 或项目事实变化，可在矩阵中将 `02-技术方案.md` 标为 `N/A + skipReason`，不得为凑模板强行生成完整技术方案。
> ⚠️ 技术方案各章节存在编写依赖关系，应按以下推荐顺序编写；一旦进入本模板，标为 🔴 的章节不得跳过，条件章节无触发时写 `N/A + skipReason`。
> ⚠️ 本模板优先回答：现状是什么、目标设计是什么、实现流程怎么走、关键节点谁负责、契约与边界如何处理、风险与测试如何覆盖。
> ⚠️ CP2 技术方案必须把**目标架构/模块边界、数据/状态模型、契约矩阵、技术执行流程、产品事实源→技术验证映射（需求验收映射）**作为一等或条件章节表达，禁止只散落在说明文字、文件清单或测试备注中。这里的实现验收由技术方案从 CP1 双方确认后的产品需求派生，不要求需求方或产品在 CP1 填写验收标准；若产品已直接提供 `01-产品需求.md`，技术方案直接承接该产品完整需求，不再要求 AI 生成 `01-需求确认.md`。
> ⚠️ 生成的 Markdown 技术方案文档必须在头部后补 `## 目录导航`。若需求属于契约驱动型，方案中必须显式引用目标文档路径、文档模式与本方案引用的契约范围。
> ⚠️ 控制面、Auto、多批次、预计修改 ≥10 文件、模板-示例-校验链或发布前置任务，方案中必须说明是否触发 `execution-contract`、`test-router`、`audit-release`、`release-verification`、`source-consumer-sync`、`host-contract-verification`、`user-visible-output-contract` 与 `05-实施进度.md`。
> ⚠️ 项目/目录分析、审查或扫描必须在 broad scan 前填写 `ProjectArtifactScaleRoutingGate` / `ScaleDecisionRecord`：项目/root、六项规模指标、single-pass/batched/sampled+deep-read/blocked、排除策略、batch/checkpoint、invalid-run 与 V91。
> ⚠️ 若本方案触发或豁免任何关键产物，必须在 §1 或 §8 写出 ArtifactDecisionMatrix：`artifact`、`state(create/update/skip/N/A)`、`reason`、`trigger`、`upgradeTrigger`、`targetArtifact`。
> ⚠️ 若本方案承接了用户可见“意图扩展摘要”，必须在 §0 或 §1 说明语义初判、项目现实扩展后路由、关键风险、验证路线与备选路径如何落到方案中。
> ⚠️ 新增/升级依赖、框架、SDK、平台 API 或外部模块时，§4 必须填写 `OfficialDocsEvidence`：官方文档来源、版本/日期、关键用法、限制、兼容性与降级来源。
> ⚠️ dev/fix 项目事实变化时，必须填写 `ProfileImpactCheck`：是否更新 Profile、目标文件与 `skipReason`。
> ⚠️ 条件治理能力统一从 `skills/spec-governance/gate-registry.json` 选择 `gateGroup` 与 Owner Skill；技术方案只写触发事实、owner、产物链接、验证路线和 skipReason，不复制 Owner 正文。品牌母版、主题/尺寸变体或单色资产生产命中 `brand-visual-quality` 时，必须链接五类视觉产物和人工验收路线。
> ⚠️ provider / connector / 三方 SDK 接入类方案必须先冻结业务功能接口，再说明底层 provider adapter / model / operation / 配置如何实现该功能；不得把内部 provider 能力直接反向暴露成业务接口。随后冻结字段级合同和统一 operation contract；包 / 库 / adapter / CLI 方案必须同时检查代码实现层与包工程层。
> ⚠️ CP2 必须承接 CP1 的平台工程判断和 `ImplementationComplexityLevel`（兼容旧字段 `ImplementationComplexityPreference`）：消费者范围、共享契约边界、模块职责、可维护性成本、非目标和最小实现预算要互相一致；没有真实复用者或演进边界时，不得新增 factory / manager / adapter / registry 等预设抽象。
> ⚠️ 重要技术结论必须通过 `CodeTruthEvidenceMatrixGate` 绑定 repo path、symbol/contract、currentBehavior、negativeProbe 和 gap；方案推荐还必须通过 `SolutionFitAgainstRepoGate` 说明 reusePoint、consumer、rollback 与 statusQuoCost。
> ⚠️ §7 必须物化验证计划、命令/矩阵路线、验收标准和退出条件；进入编码前，§2.6 写清允许首批、阻断范围、偏移触发、验证路线和消费者同步。
> ⚠️ 当 AI 判断目标包含修复 Bug/缺陷/回归/安全问题/规范缺口/审查 finding 时，技术方案必须引用 `repair-collaboration`：低风险填写 lightweight 双层字段，高风险填写 full + findingToPatchMap + handoffIntegrity + independentReReview；模型名称不是触发条件。
> ⚠️ 同一 repair 方案必须引用 active `repair-prevention-assessment#RepairPreventionAssessmentGate`，冻结 `RepairPreventionAssessmentV1` 的 mode/decision、双根因、regression/negative seeds、immediate closure 与 prospective plan、Owner/consumers 和 rollback/sunset；`no-new-control` 必须有标准 reason/evidence，当前修复重跑不能晋级 prevention。
> ⚠️ 机器可读 CLI、本地 probe 或 trace show/replay 命中 `local-observability-contract`：冻结 human/json 兼容、envelope、errorCode/nextStep、native exit map、local-only/zero-write 与 package/docs 消费者；不得把构建期 V# probe registry 当成本地运行时 probe。
> ⚠️ 长任务、工具完成后无续接、orphaned `inProgress` 或宿主恢复命中 `agent-turn-liveness`：技术方案必须引用 `TurnLivenessRecoveryGate`，物化状态/lease/ACK/terminal、response-time/post-execution `CheckpointValidationResultV1`、只读 `LocalTaskTraceV1`、host-native/Hook-event/sidecar 能力边界与 no-continuation/active-lease/restart/duplicate/timeout fault matrix；禁止把 Hook 落盘写成无事件自唤醒，禁止 trace replay 执行 payload 或重放 mutation。
> ⚠️ 意图、Profile/Memory bootstrap、MCP read 或 Hook receipt 变化命中 `context-acquisition`：技术方案必须记录 `ContextReadPlanV2` 的 planContentId/目标/baseline/selected/excluded、升级与 replan 条件，以及 `ContextReadReceiptV2` 的 Post success、fallback、失效和 V99 路线；`ContextReadPlanV1`/`ContextReadReceiptV1` 只保留 reader compatibility，不得把 required-to-exist 写成每轮全文读取。
> ⚠️ 入口/完成检查、确认、进度、最终结果、阻断或文件交付变化命中 `user-visible-output-contract`：技术方案必须冻结 internal manifest→visible set→Envelope→capability renderer 单链，说明 internal-only、计数守恒、semantic digest、六 message kinds、宿主证据上限与 legacy/fail-closed 路线。
> ⚠️ package boundary / pack / benchmark / codegen 验证必须写清串行顺序；任何会删除、重建或写入 `dist` 的命令不得和包边界检查并行。
> ⚠️ 前端、文档、发布、数据、安全、性能、外部消费者、专家输出、规范吸纳或历史分层等跨域语义，均按 registry 触发对应 Owner；本模板不得维护版本化 Owner/Gate 名录。未触发的分组写聚合 `N/A + skipReason`。

| 顺序 | 章节 | 必选 | 依赖 | 说明 |
|:----:|------|:----:|------|------|
| 1 | §0 现状分析 | 🔴 | — | 先理解现状，再设计方案 |
| 2 | §1 方案概述 | 🔴 | §0 | 基于现状确定目标和架构决策 |
| 3 | §2 核心设计 | 🔴 | §1 | 架构决策确定后补齐目标架构、模块边界、数据/状态模型、契约矩阵与技术执行流程 |
| 4 | §3 Breaking Changes | 条件 | §2 | 有对外兼容性破坏或迁移动作时必填 |
| 5 | §5 安全性设计 | 条件 | §2 | 有安全关切时必填 |
| 6 | §6 性能考量 | 条件 | §2 | 有性能关切时必填 |
| 7 | §4 依赖变更 | 条件 | §2 | 有新增/升级依赖时必填 |
| 8 | §7 测试策略 | 🔴 | §2 | 核心设计确定后规划验证方法 |
| 9 | §8 实施约束 | 条件 | §2 | 有前置依赖或实施顺序约束时必填 |
| 10 | §9 风险与缓解 | 🔴 | 全部 | 综合以上内容评估风险 |
| 条件 | §1.5 ProfileImpactCheck | 条件 | §1/§2 | 技术栈、目录、脚本、配置、分发面或当前阶段变化时必填 |

---

```markdown
# [方案名称] 技术方案

> **版本**: v0.0.1
> **日期**: YYYY-MM-DD
> **状态**: 草稿 / 审查中 / 已确认
> **关联需求**: [需求文档路径]
```

## 目录导航

```markdown
## 目录导航

- [§0 现状分析](#0-现状分析)
- [§1 方案概述](#1-方案概述)
- [§2 核心设计](#2-核心设计)
  - [§2.0 目标架构与模块边界](#20-目标架构与模块边界)
  - [§2.1 技术执行流程与节点职责](#21-技术执行流程与节点职责)
  - [§2.2 契约设计（现状 → 目标）](#22-契约设计现状--目标)
  - [§2.3 兼容性策略与边界问题](#23-兼容性策略与边界问题)
  - [§2.4 数据流与执行路径图](#24-数据流与执行路径图)
  - [§2.5 异常处理](#25-异常处理)
  - [§2.6 实施映射与范围边界](#26-实施映射与范围边界)
  - [§2.7 最小实现与注释策略](#27-最小实现与注释策略)
  - [§2.8 Context Acquisition（条件）](#28-context-acquisition条件)
- [§3 Breaking Changes](#3-breaking-changes)
- [§4 依赖变更](#4-依赖变更)
- [§5 安全性设计](#5-安全性设计)
- [§6 性能考量](#6-性能考量)
- [§7 测试策略](#7-测试策略)
  - [§7.1 产品事实源→技术验证映射（需求验收映射）](#71-产品事实源技术验证映射需求验收映射)
- [§8 实施约束](#8-实施约束)
- [§9 风险与缓解](#9-风险与缓解)
```

## §0 现状分析 🔴

### §0.1 当前架构/代码现状

> 描述与本方案相关的当前系统状态（模块结构、数据流、已有实现）。

### §0.2 问题定位

> 明确当前存在的问题或缺口，说明为什么需要本方案。

## §1 方案概述 🔴

### §1.1 目标

> 一段话说明本方案解决的问题。

### §1.2 关键架构决策

| 决策 | 选择 | 原因 | 备选方案 | 为何不选备选 |
|------|------|------|---------|------------|
| | | | | |

> 🔴 每条关键决策必须填写"为何不选备选"列，说明排除理由。无备选时填"无适用备选"。

### §1.3 关联目标文档（条件）

> 当需求属于契约驱动型（如 `light-api` / `frontend-api` 先行冻结）时必填；其他场景整节标 `N/A`。

| 字段 | 内容 |
|------|------|
| 目标文档路径 | |
| 文档模式 | `light-api` / `frontend-api` |
| 契约锚点范围 | |
| 本方案如何引用 | |

### §1.4 Concept Sync Map（条件）

> 控制面、模板-示例-校验链、README/website/Profile/validate/部署副本联动任务必填；其他场景标 `N/A`。

| 字段 | 内容 |
|------|------|
| sourceOfTruth | |
| currentConsumers | |
| historicalMirrors | |
| validateProbes | |
| deployCopies | |
| yellowDeviationBoundary | |

### §1.5 ProfileImpactCheck（条件）

> dev/fix 修改项目事实时必填；无影响时写 `N/A + skipReason`，不得省略。

| 触发项 | 是否影响 Profile | 同步目标文件 | 处理 | 证据 / skipReason |
|--------|:----------------:|--------------|------|-------------------|
| 技术栈 / 框架 / SDK / 依赖管理 | 是 / 否 | `01-项目信息.md` | 更新 / N/A | |
| 目录结构 / 模块边界 / 分发面 | 是 / 否 | `02-架构约束.md` | 更新 / N/A | |
| 脚本 / 测试 / 构建 / 发布命令 | 是 / 否 | `01-项目信息.md` / `03-代码风格.md` | 更新 / N/A | |
| 配置 / 环境变量 / 长期连接 / `config.json` extensions / `config.local.json` schema | 是 / 否 | Profile README / `01-项目信息.md` / `config.json` | 更新 / N/A | |
| 脚本 / 测试 / 数据库 / SSH / MongoDB / 数据操作连接来源 | 是 / 否 | 用户 / 项目指定入口 | 直写 / 沿用现有模式 / 读取指定入口 / N/A | 未指定限制时默认允许明文和硬编码；不得主动发明 `.env`、`*Env`、secretRef、secret manager 或 `config.local.json` |
| 当前阶段 / 活跃版本 / 发布状态 | 是 / 否 | `01-项目信息.md` | 更新 / N/A | |

## §2 核心设计 🔴

### §2.0 目标架构与模块边界

> 先说明目标设计下的模块关系、职责边界、输入输出和不负责事项，再进入具体流程。对单文件小修可标 `N/A + skipReason`；涉及多模块、控制面、接口契约、数据模型或分发面的任务不得省略。

| 模块/边界 | 目标职责 | 输入 | 输出 | 依赖 | 不负责事项 |
|-----------|----------|------|------|------|------------|
| | | | | | |

> 如本轮会新增或重划模块边界，须说明旧边界如何迁移到目标边界；若保持既有架构不变，需写明“沿用现有边界”的依据。

### §2.1 技术执行流程与节点职责

> 先描述技术实现主流程，再说明关键节点职责。这里关注“系统如何实现/调用/流转”，不要重复 CP1 的用户旅程或业务结果。推荐格式：`节点/模块 | 文件 | 变更职责 | 输入/输出 | 依赖 | CP3锚点`。有“文件”和“CP3锚点”列便于实施计划直接映射。

| 节点/模块 | 文件 | 变更职责 | 输入/输出 | 依赖 | CP3锚点 |
|----------|------|---------|-----------|------|---------|

> 如执行路径存在明显先后顺序、跨模块协作、异步回调或关键分支，建议补充流程图或时序图，主视角应围绕“流程如何被实现”而不是“文件清单罗列”。

### §2.2 契约设计（现状 → 目标）

> 先描述当前契约，再描述目标契约；对已有公共接口、Schema、返回结构、错误码或异步事件，必须体现“现状 → 目标”的差异。
> 推荐按子节组织：① 契约矩阵 ② 数据/状态模型 ③ 类型/数据结构变更 ④ 入口行为变更表（参数/返回/错误）⑤ 异步事件或回调变更 ⑥ 调用示例（有对外契约变更时必填）。

#### 契约矩阵

> 涉及公共接口、函数签名、Schema、配置、CLI 参数、Hook payload、MCP tool/resource、事件或报告字段时必填；纯内部实现且无契约变化时写 `N/A + skipReason`。

| 契约/入口 | 调用方/消费者 | 当前输入 | 目标输入 | 当前输出 | 目标输出 | 错误/异常 | 兼容策略 | 验证方式 |
|-----------|---------------|----------|----------|----------|----------|-----------|----------|----------|
| | | | | | | | | |

#### 数据模型 / 状态模型（条件）

> 涉及 Schema、Model、数据库、配置、缓存、运行态状态、台账状态、Profile 或报告字段时必填；无数据/状态影响时写 `N/A + skipReason`。

| 对象 | 当前结构/状态 | 目标结构/状态 | 生命周期/状态转换 | 持久化/迁移影响 | 兼容策略 | 验证方式 |
|------|---------------|---------------|-------------------|-----------------|----------|----------|
| | | | | | | |

#### ExistingDomainContractAudit / ConfigOwnershipMatrix / ApiDocVerificationSync / DataMutationPlan（条件）

> 新增字段、配置、多语言 / 本地化容器、状态枚举、返回结构、业务策略常量、接口文档合同或数据写入脚本时必填；不触发时写 `N/A + skipReason`。

| 守门项 | 当前真相源 / 调查范围 | 目标落点 / 匹配键 | 用户确认 / 跳过理由 | 验证方式 |
|--------|----------------------|-------------------|----------------------|----------|
| ExistingDomainContractAudit | 模型 / 类型 / validator / service / controller / 脚本 / 历史数据样本 / 消费者接口 | 复用既有字段/容器或新增平行结构的理由 | | |
| ConfigOwnershipMatrix | `DB feature config` / `provider runtime` / `服务运行配置` / `代码契约` | 每个常量、阈值、开关或 provider 选项的归属 | | |
| ApiDocVerificationSync | 前端接口文档 / 轻量 API 文档 / 字段映射 / 错误码 / 状态枚举 / `.http` / `.cjs` | 同步更新验证产物，或写明不更新的 `N/A + skipReason` | | |
| DataMutationPlan | 显式清单 / 需求目录数据源 / 稳定业务键 | dry-run 输出 `source_id`、`target_id`、缺失/重复清单；不能唯一匹配则阻断写库 | | |

#### 类型 / 字段 / 行为差异

| 项 | 当前 | 目标 | 影响范围 | 兼容 / 迁移 |
|----|------|------|----------|-------------|
| | | | | |

#### Provider / Connector 字段级合同（条件）

> 三方 provider、connector、SDK 接入类方案必填；非此类任务写 `N/A + skipReason`。首个 provider 只能验证统一 operation contract，不能反向定义公共命名和层次。

| 合同层 | 字段 / 类型 | 来源 | 约束 | 消费方 | 验证方式 |
|--------|-------------|------|------|--------|----------|
| provider metadata | | | | | |
| 内部 payload | | | | | |
| 上游 request 映射 | | | | | |
| 标准化 result | | | | | |
| 错误 detail | | | | | |

### §2.3 兼容性策略与边界问题

> 明确兼容调用方、历史数据、旧配置、旧行为、版本边界与异常边界如何处理。不要把这些内容只留在备注或风险章节。

#### 兼容性策略

| 兼容面 | 当前行为 | 目标行为 | 处理策略 |
|--------|---------|---------|---------|

#### 边界问题清单

| 场景 | 风险/问题 | 处理方式 |
|------|----------|---------|

### §2.4 数据流与执行路径图

> 数据流描述或时序图。**时序图触发规则（满足任一条件即须绘制）**：①涉及 ≥2 个服务/模块间的消息传递；②有异步操作或回调；③有循环/条件分支导致执行路径不唯一。  
> **推荐格式**：`文字摘要（描述步骤序列）` + `Mermaid sequenceDiagram（展示服务边界与消息方向）`，两者结合比单独任一方式更清晰。  
> **§2.2 分支判断补充**：控制器内有复杂 if-else 分支（≥3 路径）时，推荐在 §2.2 对应表格下方补充 `Mermaid flowchart TD` 决策图，粒度到"判断条件 → 执行路径"即可，无需包含实现细节。

### §2.5 异常处理

> 推荐格式：`场景 | 处理策略` 二列表；每行描述一类异常的触发条件和应对动作（包含幂等、降级、不阻断等策略）。

| 场景 | 处理策略 |
|------|---------|
| | |

### §2.6 实施映射与范围边界

> 明确本轮到底改什么、不改什么，并给 CP3 提供可直接拆任务的锚点。

#### 本轮纳入范围

-

#### 本轮排除范围

-

#### DevelopmentDriftGate（执行前偏移检查）

| 字段 | 内容 |
|------|------|
| allowedFirstBatch | |
| blockedScope / noGoItems | |
| driftTriggers | |
| validationRoute | |
| consumerSync | |
| dirtyBoundary | |

#### 变更面清单

| 变更面 | 文件/目录 | 变更类型 | 说明 |
|--------|-----------|---------|------|
| | | | |

#### 偏移触发器

> 满足以下任一情况，说明实施阶段需要回到 CP2 或 CP1 重新确认：

-

#### 治理 registry 与分层吸纳决策（条件）

> 只有命中治理、吸纳、跨消费者或控制面语义时填写。先读取 `skills/spec-governance/gate-registry.json`，按 `gateGroup` 选择 Owner Skill；本模板不得复制 Gate 目录或 Owner 专属字段。

| gateGroup / candidateId | 触发事实 | ownerSkill | classification | ownedArtifacts | validationRoute | consumerSync | skipReason |
|-------------------------|----------|------------|----------------|----------------|-----------------|--------------|------------|
| | | | global-invariant / existing-skill-subgate / new-skill-required / docs-only / N/A | | | | |

规范吸纳时追加 `LayeredAbsorptionDecision`，其字段以 `spec-absorption` 为准；历史规则重分层追加逐文件矩阵链接。用户已给出方向时，记录更优替代路径比较和最终采纳依据。未触发项只写一条 `N/A + skipReason`，不得逐 Gate 占位。

#### StartupPhaseTrace（条件）

| StartupPhaseTrace | 阶段命名 / Profile 或 startup summary 同步 / 减噪、lazy loading 或 background warmup 决策 |
|-------------------|------------------------------------------------------------------------------------------|


### §2.7 最小实现与注释策略

> 必须继承 CP1 的 `ImplementationComplexityLevel`。默认采用 `简单够用`：能满足已确认产品事实源和派生技术验证项的最小实现，优先局部补丁和既有模式；复杂度预算超限、新增抽象或新增防御分支必须有证据，否则回 CP2/CP1 收窄范围。

| CP1 档位 | CP2 落地要求 |
|----------|--------------|
| `简单够用` | 只保留满足已确认产品事实源和技术验证项的局部最小实现；不新增 service / factory / adapter / manager、策略注册表、通用配置或预留扩展点 |
| `中等` | 写明真实复用者、演进边界或跨模块共享契约，以及为什么直接实现不足 |
| `企业级` | 写明用户确认依据、多方案取舍、开发周期 / 难度 / 长期维护成本、迁移/回滚和验证路线 |

#### 复杂度预算

| 项 | 本轮预算 / 上限 | 依据 | 超限处理 |
|----|----------------|------|----------|
| 变更文件 / 函数 / 类 | | | |
| 新增分支 / 状态 | | | |
| 新增抽象（service / factory / adapter / manager 等） | | 仅在已有真实消费者、既有本地模式、边界隔离或已确认契约需要时允许 | 回 CP2 说明替代方案 |
| 防御性处理 | | 仅覆盖已确认输入边界、兼容边界、安全边界或错误契约；service 不重复 route/model/schema 已保证的校验 | 未确认场景不得扩展 |
| 必要注释 | | 非显然业务规则、状态转换、不变量、兼容约束、安全边界、外部契约映射、反直觉权衡必须注释；JS/Node 必要注释使用标准 JSDoc | 缺失则实施前补齐 |

#### 抽象与防御分支准入

- 禁止为了“企业级”“可扩展”预设而新建无真实消费者的抽象层。
- 禁止无计划新增抽象、通用配置、策略注册表、预留扩展点或过宽异常捕获。
- 若必须引入抽象，须写明现有直接实现为什么不足，以及哪个调用方、边界或契约会立即消费它。
- 防御性分支只服务已确认的输入范围、历史兼容、安全要求或错误契约；未确认的未来场景列入风险或后续建议，不进入本轮实现。
- 简单业务 service 默认只做业务编排、外部能力调用和必要上游错误映射，不重复 route validate、model/schema、数据导入或框架已承担的校验、归一化、配置兜底和二次治理。

#### 注释策略

- 必要注释用于解释“为什么这样做”和“这里守住什么约束”，不得只复述代码做了什么。
- 以下场景必须有短注释：非显然业务规则、状态转换、不变量、兼容约束、安全边界、外部契约字段映射、反直觉但必要的取舍。
- JavaScript / Node.js 中命中必要注释的导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明必须使用标准 JSDoc；普通行注释不能替代 JSDoc 契约。
- 禁止逐行解释、重复函数名/变量名含义、保留临时 TODO、把调试说明当业务注释。
- 如果代码已经能清晰表达意图，且不涉及上述场景，可写 `注释策略: N/A + skipReason`。

### §2.8 Context Acquisition（条件）

> 仅在 intent/Profile/memory/bootstrap/Hook read 语义变化时填写；其他任务写 `N/A + skipReason`。字段真相源为 `context-acquisition` registry group 与对应 Owner Skills，本节只记录本方案选择，不复制完整 Gate。

| 字段 | 方案选择 |
|------|----------|
| intentSeed / unique target | |
| baseline / selected / excluded | |
| fullReadReason / replan triggers | |
| Post receipt / fallback / missing sources | |
| validation | `ProfilePlanNoHiddenFullReadProbe` / V99 / host direct replay / oracle parity |

## §3 Breaking Changes（条件）

| BC | 影响范围 | 迁移方案 |
|----|---------|---------|
| | | |

> 有对外兼容性破坏、迁移动作或调用方需要显式适配时必填；无此类影响时整节标 `N/A` 或填 `无`。

## §4 依赖变更（条件）

> 有新增/升级/移除依赖、框架、SDK、平台 API 或外部模块时必填，无依赖变更时整节标 N/A。
> 新增/升级项必须先读取官方使用文档或官方参考资料；若官方文档不可用，按官方源码 / 官方仓库说明、项目内已确认文档、社区资料降级，并说明风险。
> 依赖升级方案必须拆分 `业务源码平滑性` 与 `依赖层落地条件`；用户关心“只升级依赖即可”时，追加 `纯依赖层零附加动作` 判定。
> 消费者验证失败且症状指向依赖、插件、共享库或框架适配时，源码修改前先核对 `package.json`、lockfile、`node_modules` 与 `npm ls <关键依赖>`；确认依赖树一致后才进入源码补丁。

| 依赖 / 框架 / SDK / API | 类型 | 版本 | OfficialDocsEvidence（官方文档来源 / 版本日期） | 关键用法 / 限制 / 兼容性 | 选型理由 |
|------|------|------|-------------------------------------------|--------------------------|---------|

| 评估层 | 结论 | 证据 | 后续动作 |
|--------|------|------|----------|
| 业务源码平滑性 | | | |
| 依赖层落地条件 | | | |
| 纯依赖层零附加动作（条件） | | | |

## §5 安全性设计（条件）

> 有安全关切（输入验证、权限控制、加密、敏感数据）时必填，无安全关切时整节标 N/A。

## §6 性能考量（条件）

> 有性能关切（高频路径、大数据量、并发）时必填，无性能关切时整节标 N/A。

## §7 测试策略 🔴

> 包含：静态/类型检查（按项目技术栈选择；TypeScript 项目优先项目既有 `typecheck`，否则用 `tsc --noEmit` 一类无产物校验）、单元测试（核心计算/校验函数）、集成/联调（对外接口 happy path + edge case）、回归（现有功能未被破坏）。
> 若测试路线不明显，或涉及跨模块、接口、Hook/CLI、模板-示例-校验链联动，应先输出 TestRoute，再按 TestRoute 选择 `dev-testing` / `api-verification` / `dev-scenario-test` 等专项验证。

### §7.0 TestRoute（条件）

> TestRoute 的机器可读输入、selectors、输出和跳过字段以 `skills/test-router/test-route-schema.json` 为唯一事实源。本节只记录本方案选择结果，不复制 schema。

| selector | 选择理由 | 命令/目标 | 证据 | 跳过记录 |
|----------|----------|-----------|------|----------|
| static / unit-integration / api / runtime-e2e / package-release / profile-deploy | | | | |

必须输出 `selectedRoutes / commands / evidence / skipped / residualRisk / coverageClaim`；每条跳过记录包含 `route / reason / authority / residualRisk / upgradeCondition`。领域专属证据由 registry 指向的 Owner Skill提供。


### §7.1 产品事实源→技术验证映射（需求验收映射）

> 将 CP1 中**需求方原始输入锚点**、AI 提炼口径、双方确认后的产品需求原文，或产品直接提供的 `01-产品需求.md` 中的流程节点、字段描述、样例、反例、异常边界和待确认问题映射到方案设计、验证路线和 CP3 任务。本节是技术方案派生实现验收的入口，不是需求方或产品填写验收标准；每个关键产品事实源都必须有映射，确实不适用时写 `N/A + skipReason`，不得静默遗漏。

| 需求方输入锚点 / CP1产品事实源 / 产品完整需求锚点 | 确认状态 | 对应设计点 | TestRoute/测试类型 | CP3任务锚点 | 技术通过标准 |
|----------------------------------|--------------|------------|--------------------|-------------|--------------|
| | | | | | |

## §8 实施约束（条件）

> 仅描述影响实施顺序的**技术约束**（前置依赖、数据兼容、接口先后）。  
> 常见约束类型：① 先改 schema 再改 controller（运行时 schema 不匹配）② 先改接口定义再改实现（TS 编译）③ 先补 i18n 语言包再落新错误码（避免裸 key 返回客户端）④ 写操作幂等性前置（Redis 锁/唯一索引）。  
> 控制面 / Auto / 多批次 / 预计修改 ≥10 文件 / release 前置任务应补充 ExecutionContract：scope、allowedPaths、requiredArtifacts、consumerScope、validationRoute、verificationEvidence、deviationPolicy、deviationLog、rollbackPlan；控制面或宿主契约任务还应补充 Concept Sync Map 与 HostContractRoute。正式发版前还须补充 ReleaseAudit RL-1~RL-10、ReleaseVerification R0~R7 与 NativeCommandExitCodeGate 退出码证据设计。
> 包 / 库 / adapter / CLI 方案还必须检查 public API、public types、internal 工具、shared tests、benchmark、docs、scripts、dist/coverage、package metadata 与 changelog 入口。
> 文档正文若定义阅读顺序、审查顺序、实施顺序或“先看什么”，必须把 README、索引页、website sidebar/nav 与目录页纳入 Concept Sync Map 当前消费者，同批校验呈现顺序。
> 无技术约束时整节标 N/A。具体任务拆分和里程碑在 CP3 实施计划中完成，本节不重复。

## §9 风险与缓解 🔴

> ℹ️ **综合评级**：概率（H/M/L）× 影响（H/M/L）→ HH/HM 为 🔴，MM/HL 为 🟡，其余 💡。

| 风险 | 概率 | 影响 | 缓解措施 | 综合 |
|------|:----:|:----:|---------|:----:|
