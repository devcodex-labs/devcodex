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
> ⚠️ 若本轮任务或批次直接来源于 `data/*.md` 的 open/partial 项，计划中必须显式写出 Backlog Intake 真相复核和台账状态回写闭环：先分类 `pure-open / residual-tail / already-fixed / misclassified`，再说明本轮范围是否缩减以及回写证据如何产出。
> ⚠️ 若 CP1 真相源是产品直接提供的 `01-产品需求.md`，实施计划只能承接产品原文、流程节点、前端交互、字段描述和 AI / 研发缺口检查结果；不得把计划写成新的产品需求稿。
> ⚠️ 发布、pack、benchmark、codegen 或包边界任务必须写明串行验证顺序：构建/生成完成后再单独执行 package boundary check，不得与会写入 `dist` 的命令并行。
> ⚠️ 文档阅读顺序、站点入口、使用者路径、命令、字段、配置、状态或能力承诺变更必须写明 `UserPerspectiveDocsGate`、`UserDocsImmediateComprehensionGate`、`UserDocsPrimarySurfaceGate`、`PublicUserDocsMaintainerBoundaryGate` 与 `DocsConsumerSweep`：正文顺序、导航/sidebar 顺序与索引顺序、targetSurface / documentLocation / primaryAudience、首页首屏 / quick start / nav 前两组 / CTA / reference 是否服务用户使用、公开用户路径是否排除维护者 checklist、示例、模板、Profile、validate probes、部署副本和代码消费点的校验方式；若故意不同序，计划中说明信息架构理由。
> ⚠️ 文档型、站点型或前后端协作需求必须写明 `UserFacingDeliveryChainGate`：原始需求 → 整理后的需求概况 → 用户最终使用文档（文档站或至少 README）→ 前端/API 契约（若触发）→ 技术方案 → 复杂项目实施方案 → 实施计划 → 实施进度 → 对照需求和用户文档的审查报告；若某环节跳过，必须写 `skipReason`。
> ⚠️ 复审、构建产物、文档站或性能相关计划必须写明 `ReviewChecklistCompletenessGate`、`EvidenceExecutionGate`、`ReviewEscapeRecordGate`、`PostConfirmationReviewScopeGate`、`DevelopmentDriftGate`、`VerificationPlanMaterializationProbe`、`BuiltArtifactFeatureSmokeGate`、`TscOutputImportProbe`、`GeneratedSiteGate`、`ManualTocDuplicationGate`、`UserPathContractSweep`、`BenchmarkRegressionGuard` 的触发状态；未触发必须写 `N/A + skipReason`。

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

| 产物 | 是否触发 | 触发依据 | 计划落点 |
|------|:--------:|----------|----------|
| ExecutionContract | 是 / 否 | Auto / 控制面 / 多批次 / 预计修改 ≥10 文件 / release 前置任务 | scope / allowedPaths / requiredArtifacts / validationRoute / deviationPolicy / rollbackPlan |
| TestRoute | 是 / 否 | 跨模块 / API / Hook / CLI / 模板-示例-校验链 / 测试路线不明显 | changeType / routes / commands / skipReason / blockingLevel |
| LeakRiskStabilityPressureTest | 是 / 否 | 写测试用例或回归验证命中长运行、并发、缓存/连接/监听器/定时器/流/socket/worker/订阅/组件生命周期或 PE-12 风险 | leakRiskPressure / baseline / pressureScenario / cooldown / resourceMetrics / passThreshold / skipReason |
| FrontendExperienceQualityGate | 是 / 否 | 前端页面、组件、控制台、官网、文档站、可视化工具、游戏或用户可见 UI / 交互 | FrontendDesignSourceGate / UIFidelityGate / StyleThemeConsistencyGate / ResponsiveStateCoverageGate / VisualVerificationGate / InteractionFlowGate / InteractionFeedbackGate / InputModalityAccessibilityGate / ErrorPreventionRecoveryGate / MotionTransitionUsabilityGate / FigmaHighFidelityRestorationGate / ScopedVisualChangeGate / InstalledPluginVisualVerificationGate / ActualPreviewChainAndMockFallbackGate / FrontendRuntimeNetworkProbeGate / UIStateScopeRegressionGate / FigmaProductionAssetBudgetGate / RuntimeI18nArtifactVerificationGate |
| ServiceLifecycleCleanup | 是 / 否 | AI 需要启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target | command / cwd / PID-job / port-url / cleanupEvidence / keepAliveReason |
| ReleaseAudit | 是 / 否 | 发版前 review / publish 或 tag 前风险审查 / release readiness | RL-1~RL-10 / risks / recommendation |
| ReleaseVerification | 是 / 否 | 用户要求 tag / release / publish 或进入正式发版 | R0~R7；如存在远端 CI，补 R3c 目标 commit CI 绿色证据；pack/publish/install smoke 记录 NativeCommandExitCodeGate 的 command/shell/cwd/exitCode |
| ConceptSyncMap | 是 / 否 | 控制面 / 模板-示例-校验链 / README / website / Profile / validate / 部署副本联动 | sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies / yellowDeviationBoundary |
| HostContractVerification | 是 / 否 | Hook / CLI / visible reply / sticky project / workspace guard / bootstrap / ArtifactLinkSet / MCP fallback | hostSurface / eventScope / evidenceMode / visibleReplyEvidence / workspaceGuard / bootstrapScope / artifactLinkMatrix / mcpFallback |
| ArtifactDecisionMatrix | 是 / 否 | CP1/CP2/CP3/ECR 的关键产物创建、更新、跳过或 N/A 判定 | artifact / state(create-update-skip-N/A) / reason / trigger / upgradeTrigger / targetArtifact |
| OfficialDocsEvidence | 是 / 否 | 新增/升级依赖、框架、SDK、平台 API、外部模块或外部平台能力判断 | 官方文档来源 / 版本日期 / 关键用法 / 限制 / 兼容性 / skipReason |
| DependencyUpgradeCheck | 是 / 否 | 依赖升级、框架升级、SDK 替换或平台 API 兼容性任务 | 业务源码平滑性 / 依赖层落地条件 / 纯依赖层零附加动作（条件） |
| ConsumerDependencyTreeProbe | 是 / 否 | 消费者验证失败且症状指向依赖、插件、共享库或框架适配 | package.json / lockfile / node_modules / npm ls <关键依赖> / 是否允许源码补丁 |
| PackageBoundarySerialCheck | 是 / 否 | release / pack / package boundary / benchmark / codegen 任务 | build 完成点 / 单独 pack 命令 / dist 写入竞争排除 / dirty 残留清理 |
| InternalSharedLibraryReview | 是 / 否 | 根因位于内部共享库、中间件、SDK 或 adapter 抽象层 | 修共享库 + 消费项目升级 / 单项目补丁理由 / 风险 |
| ProfileImpactCheck | 是 / 否 | 技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema 变化 | targetProfileFiles / updateOrSkip / skipReason / evidence |
| ConfigLocalConnectionSource | 是 / 否 | 脚本、测试、数据库 / SSH / MongoDB / 数据操作需要连接信息 | configLocalPath / requiredFields / missingFieldAction / noAdHocEnvEvidence / noEnvUnlessUserSpecified |
| 05-实施进度.md | 是 / 否 | 跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面或模板-校验链任务 | CP 状态 / 批次状态 / 阻塞 / 验证证据 |
| SimpleTaskFastPath | 是 / 否 | 非常明确、预计 ≤2 文件、无公共契约/配置/发布/控制面/台账来源/高风险、无需多轮跟踪 | inline CP summary / N/A + skipReason / upgradeTrigger |
| ExistingRequirementArtifactOverride | 是 / 否 | 调整/修改/补充既有需求或问题，且已有需求/bug 真相源 | targetArtifact / fileUpdatedBeforeReply / inlineSummaryOnly / cannotLocateAction |
| ContextHandoffCard | 是 / 否 | 跨会话、跨 Agent、多批次、summary/compact 前或用户要求传递上下文 | source-of-truth / confirmed-decisions / open-risks / next-action / must-not-overwrite / validation-state / artifact-links |
| Backlog Intake 真相复核 | 是 / 否 | 任务/批次直接来源于 `data/*.md` open/partial 项 | candidateIds / classification / evidence / scopeDelta |
| 台账状态回写闭环 | 是 / 否 | 本轮会关闭/部分关闭/改分类任何 VL/PF/PI/ISSUE/GAP | targetLedgers / requiredFields / writebackEvidence / rescanResult |
| ImplementationComplexityLevel | 简单够用 / 中等 / 企业级 | CP1/CP2 已确认的开发程度等级；未说明时默认简单够用，兼容旧字段 `ImplementationComplexityPreference` | inheritedPreference / optionTradeoff / upgradeConfirmation / noOverengineeringBoundary |
| CrossProjectLearnedGuards | 是 / 否 | 命中跨项目已吸纳守门、历史通用规范分层或新增可泛化策略 | 按 `GovernanceGateRegistry` 填写 `gateGroup / ownerSkill / validationRoute / skipReason`；代表性 anchors：CodeTruthRequirementGate / ManualReviewEvidenceRetention / ReviewFindingIntakeGate / UserDocsPrimarySurfaceGate / ActiveRequirementFinalResponseGate / MethodLevelLeakPressureProbe / V2FormalSolutionPackage |

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

> 完整实施计划默认需要独立验证方式。轻计划摘要也至少要说明“执行后如何独立确认这批变更真的成立”。

| 验证项 | 验证方式 | 通过标准 |
|--------|---------|---------|
| ExecutionContract | 对照 scope / allowedPaths / requiredArtifacts / validationRoute | 无范围偏移，偏移均按 deviationPolicy 处理 |
| TestRoute | 对照变更类型执行对应命令 | 路线覆盖完整，跳过项有依据 |
| LeakRiskStabilityPressureTest | 对照 TestRoute 的 leakRiskPressure 判定 | 命中资源生命周期风险时有基线、压力过程、冷却后回落、资源指标前后对比和清理证据；未触发有 `N/A + skipReason` |
| FrontendExperienceQualityGate | 对照 TestRoute 的 frontendExperience 判定 | 命中前端 UI / 交互体验时有设计来源、视觉/状态、用户流、反馈、输入方式、错误恢复、动效转场和 Browser/截图/E2E/人工复核证据；未触发有 `N/A + skipReason` |
| spec-absorption / CommonNormGeneralizationGate / AbsorptionCandidateConsumerProofGate | 对照规范吸纳执行 Skill | 候选矩阵已列 sourceNamespace、generalizationEvidence、projectSpecificResidue、negativeExamples、commonTrigger、targetConsumer、devcodexConsumerEvidence、targetOwner、validationRoute、decision；项目独有项未进入通用规范 |
| LayeredAbsorptionGate / SkillFirstAbsorptionGate / CapabilityToSkillPromotionGate | 对照规范吸纳分层归属判定 | LayeredAbsorptionDecision 已列出 candidateId、classification、targetSkill、triggerTerms、ownedArtifacts、layerChecks、validationRoute、consumerSync；兼容 SkillAbsorptionDecision；layerChecks 覆盖 commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy；成组能力若未新增 Skill 有明确理由 |
| HistoricalCommonNormLayeringGate | 对照历史通用规范、prompt/report 长清单或旧吸纳项分层迁移 | 已创建逐文件审查矩阵；每个文件或历史镜像标出 currentRole、matchedRules、targetLayer、targetOwner、action、semanticStrength、validation、skipReason；Prompt/Report 只保留字段和目标 Skill 引用，不复制完整长清单 |
| ProactiveBetterAlternativeGate | 对照用户建议 / 方案确认 / 规范吸纳前的主动更优路径比较 | 若存在更低风险、更完整、更易维护或更易验证方案已先提出取舍；采纳用户原方案时有独立验证依据 |
| ConfirmedAbsorptionCompletenessGates | 对照未完整吸纳 / 半覆盖 / 用户确认仍需吸纳清单 | 按 `public-surface / user-manual / review-checklist / frontend-runtime / profile-service / release-parity / evolution-control-plane` 分组写目标 Skill、Prompt、执行消费者、探针、公开文档和部署副本同步；代表性 anchors：PublicSurfaceClosureGate / UserManualProductizationGate / ReviewAnchorMaterializationGate / FrontendAsyncCacheRenderGate / RemoteCIParityPushGate / NativeCommandExitCodeGate / DocsThemeRuntimeVisualProbeGate |
| LatestAbsorptionExecutionPack A1~A10 | 对照最新可吸纳确认实施包 | 按 `docs-semantics-examples / derived-consumer-runtime / feature-inventory-batch-evidence / profile-service / absorption-layering` 分组写 ownerSkill、validationRoute、skipReason；覆盖 ConfigCanonicalNamespaceGate、ProfileRuntimeContractSyncGate、BehaviorSemanticDocsParityGate、DocsExampleTruthSurfaceGate、DerivedMetricConsumerProbe、FeatureInventoryProfileGate、BatchEvidenceLedgerStateGate、BatchProgressCardGate 与 V82 |
| UserPerspectiveDocsGate / UserDocsImmediateComprehensionGate / UserDocsPrimarySurfaceGate / PublicUserDocsMaintainerBoundaryGate / DocsConsumerSweep | 对照文档使用者路径、即时理解、用户主面、维护者边界和消费者扫描 | 面向使用者文档有第一次成功、常见任务、字段/参数/状态/错误解释、排错恢复和低心智负担证据；用户文档有功能完整性、配置易懂性、即时理解三轴和 targetSurface/documentLocation/primaryAudience；首页/quick start/nav/sidebar/CTA/reference 主路径不被开发契约替代；公开用户路径不混入维护者 checklist、内部同步清单或台账状态；命令/字段/导航/能力承诺同步 README/website/Profile/templates/examples/validate/代码消费点 |
| user-manual-authoring / UserFacingDeliveryChainGate / FinalUserManualFirstGate | 对照需求概况、用户最终使用文档、前端/API 契约、技术方案和实施计划顺序 | 用户文档先于技术方案落位；文档站或 README 判定清楚；涉及前端/API 时契约明确；技术方案和实施计划可回溯到需求与用户文档 |
| review-checklist / ReviewChecklistCompletenessGate / EvidenceExecutionGate / ReviewEscapeRecordGate | 对照冻结 checklist、逐项执行证据、复审维度增量和 escape record | 复审维度不机械重复；不能只按审查报告文本验证；每项结论有实际命令、代码落点、页面或产物证据；发现遗漏时写 whyMissed、prevention、checklistPatch、rerunEvidence；最终状态新鲜 |
| PostConfirmationReviewScopeGate / DevelopmentDriftGate | 对照 CP 确认后复审强度和执行前偏移边界 | 高风险任务使用全面复审；低风险写 skipReason；执行前写 allowedFirstBatch、blockedScope、driftTriggers、validationRoute、consumerSync、dirty boundary |
| VerificationPlanMaterializationProbe / ChinesePrimaryExpressionGate / SidebarPageRoleMaterializationProbe / SidebarGroupSemanticModelProbe | 对照 CP2 验证计划、中文主表达和文档站 IA | 验证计划有命令/矩阵/退出条件；中文文档用中文主干表达；新增能力或菜单调整有 pageRole/sidebar group 矩阵 |
| BuiltArtifactFeatureSmokeGate / TscOutputImportProbe | 对照构建产物、运行时导出和 TypeScript 输出 | 源码测试之外有 dist/package feature smoke；TS 输出可被真实导入；失败阈值和 skipReason 清楚 |
| GeneratedSiteGate / ManualTocDuplicationGate / UserPathContractSweep | 对照文档站生成产物、TOC/sidebar/nav、公开用户路径消费者 | 已验证生成站点页面、链接、资产和主要用户路径；目录无重复/断链/漂移；README/website/nav/examples/templates/validate/部署副本同步 |
| BenchmarkRegressionGuard | 对照性能基线、对照组、阈值和运行证据 | 优化或性能声明有可复跑基准和回归判定；未触发有 `N/A + skipReason` |
| ArtifactLinkSetDedupeGate | 对照最终 ArtifactLinkSet、报告、记忆、SUMMARY | 同一物理文件已按 canonical path 去重；同名不同文件已路径消歧；历史镜像/部署副本身份清楚 |
| ReviewDimensionDeltaGate | 对照 R2+ 复审或 ECR 维度焦点 | PreviousDimensionSet / CurrentDimensionFocus / NewDimensionRationale / RepeatedDimensionReason 完整，未机械重复同一组维度 |
| FrontendRuntimeNetworkProbeGate | 对照真实预览运行态 | 真实 URL、console/network、failed requests、资源 404、API target、hydration/runtime error 与 runtime i18n key 证据完整 |
| ActiveRequirementFinalResponseGate | 对照最终回复范围 | 当前 active requirement/task/bug id 明确；相邻需求或 backlog 被标记为未切换/未执行，不作为默认下一步 |
| LatestAbsorptionGuards | 对照最新 data 吸纳守门 | 按 `GovernanceGateRegistry` 分组填写触发状态、证据和 `N/A + skipReason`；代表性 anchors：DatabaseRecordMigrationExportGate / FrontendBrowserVerificationBudgetGate / FindingProbeMatrixGate / VerificationCommandSideEffectGate / RequirementPreConfirmGate / PackageAdapterPreConfirmEvidenceGate / RequirementVerdictStateSyncGate / UserDocsPrimarySurfaceGate |
| ServiceLifecycleCleanup | 对照 AI 自启动服务记录和清理证据 | 仅 AI 本轮启动的服务已关闭并核验端口释放；保留运行有用户要求、PID/端口和关闭方式 |
| ConceptSyncMap | 对照 sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies | 当前消费者与探针无漏改，历史镜像边界明确 |
| HostContractVerification | 对照 hostSurface / eventScope / evidenceMode / workspaceGuard / artifactLinkMatrix / mcpFallback | direct replay / fixture / targeted test 证据与声明一致；产物链接与 MCP fallback 不只停留在文案 |
| OfficialDocsEvidence | 对照官方文档来源 / 关键用法 / 限制 / 兼容性 | 方案采用的 API / 配置与官方文档一致；N/A 有 skipReason |
| DependencyUpgradeCheck | 对照业务源码平滑性 / 依赖层落地条件 | 不把工程前提误报成业务源码阻断；纯依赖升级结论有证据 |
| ConsumerDependencyTreeProbe | 对照 package.json / lockfile / node_modules / npm ls <关键依赖> | 先排除依赖树漂移，再决定是否修改源码 |
| PackageBoundarySerialCheck | 对照 build/benchmark/codegen 与 pack 执行顺序 | package boundary 检查未与 `dist` 写入命令并行，报告采用稳定包清单 |
| InternalSharedLibraryReview | 对照共享库根因与消费项目影响 | 已评估修共享库 + 升级消费项目，单项目补丁有理由 |
| ProfileImpactCheck | 对照 targetProfileFiles / updateOrSkip / skipReason | Profile 已同步或跳过理由成立；ECR 与 document-sync 有证据 |
| Backlog Intake 真相复核 | 对照 candidateIds / classification / evidence / scopeDelta | open 统计与本轮范围一致，非 `pure-open` 项已缩减或剔除 |
| 台账状态回写闭环 | 对照 targetLedgers / requiredFields / writebackEvidence / rescanResult | 状态、证据、计数与报告/进度/SUMMARY 一致 |
| CrossProjectLearnedGuards | 对照 `GovernanceGateRegistry` gateGroup、ownerSkill、validationRoute 和代表性 legacy anchors | 已触发的跨项目吸纳守门均有证据；未触发项有 `N/A + skipReason` |
| 模板/规则一致性 | | |
| 样本映射 | | |
| 自动化校验 | | |

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

- [ ] 所有任务完成
- [ ] 关键路径单测通过
- [ ] api-verification 通过（若涉及接口）
- [ ] impact-review 完成
- [ ] ExecutionContract 已建立并执行（若触发）
- [ ] TestRoute 已建立并覆盖（若触发）
- [ ] LeakRiskStabilityPressureTest 已完成或记录 `N/A + skipReason`（写测试/回归验证时按项目资源生命周期风险判定）
- [ ] FrontendExperienceQualityGate 已完成或记录 `N/A + skipReason`（前端 UI / 交互任务需覆盖设计来源、还原度、主题、响应式状态、用户流、反馈、输入方式、错误恢复、动效和视觉验证；Figma/截图还原追加 FigmaHighFidelityRestorationGate / ScopedVisualChangeGate / ActualPreviewChainAndMockFallbackGate / FrontendRuntimeNetworkProbeGate / RuntimeI18nArtifactVerificationGate）
- [ ] spec-absorption / CommonNormGeneralizationGate / AbsorptionCandidateConsumerProofGate 已完成或记录 `N/A + skipReason`（规范吸纳、data 台账治理、最新可吸纳、仍需吸纳或用户确认可泛化建议时，必须证明通用规范价值、剔除项目独有残留并绑定 DevCodex 当前消费者）
- [ ] LayeredAbsorptionGate / SkillFirstAbsorptionGate 已完成或记录 `N/A + skipReason`（规范吸纳、data 台账治理、用户确认可泛化建议或新增门禁时，必须输出 LayeredAbsorptionDecision，含 commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy）
- [ ] HistoricalCommonNormLayeringGate 已完成或记录 `N/A + skipReason`（历史通用规范、prompt/report 长清单或旧吸纳项迁移时，必须先冻结逐文件审查矩阵，再分批同步 Skill / Prompt / 执行消费者 / validate / public docs / deploy copy）
- [ ] LatestAbsorptionExecutionPack A1~A10 已完成或记录 `N/A + skipReason`（命中最新吸纳执行包时，按 ownerSkill 和 V82 同步配置/Profile/文档语义/示例/派生消费者/功能清单/批次证据）
- [ ] ProactiveBetterAlternativeGate 已完成或记录 `N/A + skipReason`（用户建议、方案确认、规范吸纳或复审冻结前，必须主动比较更优路径；采纳用户原方案时记录依据）
- [ ] CrossProjectLearnedGuards 已完成或记录 `N/A + skipReason`（按 `GovernanceGateRegistry` 写 `gateGroup / ownerSkill / validationRoute`，必要时列代表性 anchors）
- [ ] LatestAbsorptionGuards 已完成或记录 `N/A + skipReason`（按 `GovernanceGateRegistry` 分组写触发状态和证据）
- [ ] ServiceLifecycleCleanup 已完成（若 AI 自启动服务；保留运行需记录用户要求、PID/端口和关闭方式）
- [ ] ReleaseAudit RL-1~RL-10 已完成（若触发布前审查）
- [ ] ReleaseVerification R0~R7 已完成（若进入正式发版；如存在远端 CI，R3c 已记录目标 commit CI 绿色证据或 `N/A + skipReason`；pack/publish/install smoke 已记录真实 exitCode）
- [ ] ConceptSyncMap 已建立并核对当前消费者/探针/部署副本（若触发）
- [ ] HostContractVerification 已建立并核对宿主证据/guard/visible reply/ArtifactLinkSet/MCP fallback（若触发）
- [ ] OfficialDocsEvidence 已建立并核对官方用法证据（若触发）
- [ ] ConsumerDependencyTreeProbe 已完成（若消费者验证失败指向依赖树或共享库漂移）
- [ ] PackageBoundarySerialCheck 已完成（若触发 release / pack / benchmark / codegen）
- [ ] ProfileImpactCheck 已完成并同步 Profile 或记录跳过理由（若触发）
- [ ] 05-实施进度.md 已按触发条件持续同步（若触发）
- [ ] Backlog Intake 真相复核已完成并收紧范围（若触发）
- [ ] 台账状态回写闭环已完成并复核 open 计数（若触发）
- [ ] document-sync 完成
- [ ] CHANGELOG / unreleased 已按发布状态更新
- [ ] §8 技术验证清单逐条核查通过（含负向 / 异常场景）
- [ ] delivery-checklist 交付物完整性核查通过
