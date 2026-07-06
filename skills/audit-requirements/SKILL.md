---
name: audit-requirements
description: 需求文档审查维度 RQ-1~RQ-8 — 需求定义/功能描述/产品事实源与可派生验证边界专属审查层
---
# Audit Requirements Skill

## 适用范围

审查目标为**需求文档**（需求方输入、产品完整需求、需求变更、产品确认、功能需求、技术验收文档）时，叠加本 Skill（在 G1~G5 之后）。若目标是需求方输入型文档，只要求原始诉求清楚、来源可追溯和不确定点可识别；若目标是产品输入型需求，产品不需要填写验收标准；审查重点是双方确认后的产品事实源是否足以让研发 / AI 在技术方案、实施计划和测试方案中派生实现验收与验证清单。入口类型不得混写：纯新需求输入落 `00-需求概况.md`；有产品角色直接提供完整需求落 `01-产品需求.md`，产品模板正文只给产品填写完整 PRD，AI / 研发缺口 / 冲突检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不生成或重写产品需求；需求变更输入落 `00-需求变更概况.md` 并锚定原需求基线；AI 生成的产品确认落 `01-需求确认.md` / `01-需求变更确认.md`（历史 `01-需求概述.md` 仅作兼容）；Bug 问题应转 fix 的 `bugs/<问题>/00-问题概况.md` / `01-问题确认.md`，不按产品需求审查。

## 维度总览（RQ-1~RQ-8）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 需求质量 | RQ-1 需求完整性 · RQ-2 需求明确性 · RQ-3 需求可验证性 | 🔴 |
| B — 一致性与追溯 | RQ-4 需求一致性 · RQ-7 版本与变更追溯 | 🔴/💡 |
| C — 影响与约束 | RQ-5 影响分析完整性 · RQ-6 约束条件明确性 | 🟡 |
| D — 项目上下文 | RQ-8 项目上下文一致性 | 🟡 |

## 核心检查维度

**RQ-1 需求完整性 🔴**
- 必含章节：背景/问题描述、目标、功能需求或业务规则、非功能业务约束、范围/排除范围、示例/反例/异常或待确认问题
- 需求链路应先区分入口类型：无产品角色的纯新需求 `00-需求概况.md`（需求方轻量原始诉求）→ `01-需求确认.md`（AI 生成产品需求草稿，产品补充归一化）→ 需求方 + 产品双方确认 → 技术方案；有产品角色的产品完整需求 `01-产品需求.md`（产品直接提供完整 PRD，包含流程、交互、字段描述和规则）→ AI / 研发缺口 / 冲突检查（记录在 CP1 摘要、`02-技术方案.md` 或报告中，不写入产品模板正文）→ 技术方案；需求变更 `00-需求变更概况.md` → `01-需求变更确认.md` → 回写目标需求真相源 → 技术方案；Bug 问题转 fix，不进入产品需求模板
- 需求方输入型文档不要求 Mermaid、完整交互、字段全量规则或验收标准；但必须保留背景、痛点、期望结果、场景、样例、附件和不确定点
- `RequesterTemplatePlainLanguageGate`：面向用户、运营、老板、客户、内部使用方等非产品 / 非研发填写者的输入模板，字段必须用口语化问题表达，并解释“这项填什么、可以怎么写、可以不填的情况、不要写什么”；抽象术语如期望结果、当前处理方式、已知规则与限制、示例 / 反例必须转成“你希望系统帮你做到什么、现在你们怎么凑合处理、有哪些必须遵守的业务口径、给一个希望出现的例子、给一个不能接受的例子、有哪些截图表格链接或聊天记录”
- 产品输入型需求不要求产品填写验收标准；实现验收应由技术方案 / 实施计划 / 测试方案从双方确认后的产品事实源或产品直接提供的完整需求派生
- 条件必含：**业务流程**（除纯静态文案、纯说明补充一类无需行为流转的改动外，建议使用 Mermaid 主流程图 + 文字步骤图 + 节点解释；确无流程时标 N/A 并说明原因）
- 功能需求有唯一编号（如 F-01、A-01）
- 每个需求有优先级标注
- 有排除范围（明确不做什么）
- 页面 / 组件 / 可视化 / 用户可见交互类需求必须描述前端交互流程、状态覆盖、反馈方式、输入方式和设计来源
- 涉及字段时只要求字段描述、业务含义、来源、展示、编辑规则和备注，不要求数据库字段、接口 Schema 或内部 ID

**RQ-2 需求明确性 🔴**
- 需求描述无歧义，可直接转化为实现
- 非功能业务约束写清用户感知、业务边界或运营约束；技术量化指标可由技术方案补充

**RQ-3 需求可验证性 🔴**
- 每个需求有清楚的入口类型、需求方原始输入锚点（`00-需求概况.md` / `00-需求变更概况.md` / `01-产品需求.md` 或等价附件）、AI 提炼口径或产品原文锚点、产品事实源（`01-需求确认.md` / `01-产品需求.md` / `01-需求变更确认.md` 或兼容真相源）、期望业务结果或可观察用户反馈，可被技术方案派生为验证项
- 需求应包含足够的正例、反例、边界例、异常与回退口径；缺失项应进入待确认问题
- 技术验收 / 测试方案类文档才要求可执行验证用例、正向/负向场景和通过标准

**FrontendExperienceQualityGate 前端 UI / 交互需求（条件）**
- 需求涉及前端页面、组件、控制台、官网、文档站、可视化工具或游戏时，必须说明设计来源或既有风格依据
- UI 事实源至少覆盖还原度、风格主题一致性、响应式/状态覆盖与视觉验证依据
- 交互事实源至少覆盖核心用户流、交互反馈、输入方式/可访问性、错误预防/恢复与动效/转场边界
- 不涉及用户可见 UI / 交互时写 `N/A + skipReason`

**CrossProjectLearnedGuards 跨项目已吸纳需求（条件）**
- 涉及“已接入 / 已支持 / 已实现 / 未接入”等状态判断时，需求应要求 `CodeTruthRequirementGate` 核对代码真相源和消费者入口
- 需求来源于审查报告、AI review finding、audit issue 或代码评审发现时，应要求 `ReviewFindingIntakeGate`：报告只是线索、补本地证据、区分 must-fix / user-decision / docs drift / test gap / intentional design / not-reproduced
- 涉及人工复核、视觉验证或手工冒烟时，需求应要求 `ManualReviewEvidenceRetention`
- 涉及多语言文档、正式文档、prompt/Agent/Hook/MCP 契约、验证范围、真实执行或 benchmark 归因时，需求应分别列出 `DocumentationTranslationParityGuard`、`FormalDocsDevCodexBoundary`、`LLMPromptContractTriage`、`VerificationScopeBudgetGate`、`LiveVerificationExecutionObligation`、`AdapterBenchmarkAttribution` 的需求事实源或派生验证口径
- 涉及 PRD/Word/原型/截图/用户消息提炼需求时，需求应要求 `ProductRequirementTraceabilityGate`
- AI 根据需求方输入生成产品需求时，必须保留原始输入锚点、直接提取内容、合理推导内容、冲突/遗漏和双方确认状态；产品直接提供 `01-产品需求.md` 时，AI / 研发必须保留产品原文锚点，只做缺口 / 冲突检查和澄清，检查记录落在 CP1 摘要、`02-技术方案.md` 或报告中，不写入产品模板正文，不生成或重写产品需求
- 涉及本机执行配置、人工证据留存、相邻范围扩展、包名/发布名、性能第一、公开模块或 DevCodex v2 一期路线时，需求应分别列出 `LocalExecutionConfigProbe`、`ManualReviewEvidenceDataRetention`、`AdjacentScopeExpansionGuard`、`PackageNameAuthorityGate`、`PerformanceBenchmarkFirstGate`、`PublicModuleDifferentiationGate`、`V2MCPFirstPlanningGate` 的需求事实源或派生验证口径
- 涉及 data 吸纳、正式流程图、文档站视觉验证、遗漏专审、审查发现 intake、复审维度增量、使用者文档、用户文档即时理解、用户文档主面、文档消费者扫描、产物链接去重、方法级泄漏压测或 DevCodex v2 正式方案包时，需求应分别列出 `WorkspaceDataAbsorptionScopeGate`、`FlowchartNodeExplanationGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`ReviewFindingIntakeGate`、`ReviewDimensionDeltaGate`、`UserPerspectiveDocsGate`、`UserDocsImmediateComprehensionGate`、`UserDocsPrimarySurfaceGate`、`DocsConsumerSweep`、`ArtifactLinkSetDedupeGate`、`MethodLevelLeakPressureProbe`、`V2FormalSolutionPackage` 的需求事实源或派生验证口径
- 涉及 Figma/截图/既有页面还原、真实 preview、状态回归、生产设计资产或运行时本地化时，需求应分别列出 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate` 的需求事实源或派生验证口径
- docs/需求类 CP1 推荐确认前必须执行 `RequirementPreConfirmGate`：检查验收是否行为可验证、范围/非目标是否存在核心概念冲突，以及分布式、调度、缓存、队列或单活类需求是否定义 fail-safe 语义
- 需求修订、再次复审或宣布“可确认 / 暂不通过 / 已修订待复审”前必须执行 `RequirementVerdictStateSyncGate`：核对需求真相源顶部状态、推荐结论、修复清单状态、audit-state decision、requirement sessions / SUMMARY 口径一致
- 分阶段需求必须执行 `MultiPhaseClosureGate`：列出 Phase 2+ 路线、每阶段入口/退出门禁、验证证据、用户确认点、进度真相源和最终关闭规则
- Figma/截图/设计稿作为需求来源时必须执行 `DesignFramePurposeClassificationGate`，列目标帧、排除帧、用途分类和验收入口；邮件模板、banner、素材、示意页或旧稿不得默认为前端页面需求
- 涉及提交边界、兼容契约、UI 确认源覆盖旧 PRD、公开文档版本、集合关系 id 命名或用户可见验证产物语言时，需求应分别列出 `ExplicitCommitAuthorizationGate`、`CompatibilityAndContractAuthorityGate`、`UIConfirmedSourceConflictTraceGate`、`PublicDocsReleasedVersionGate`、`CollectionRelationIdNamingGate`、`UserFacingVerificationArtifactLanguageGate` 的需求事实源或派生验证口径

## N/A 规则

- 纯概念验证无正式需求文档：整体标 N/A
- 无外部依赖：RQ-5 标 N/A
- 无项目 profile：RQ-8 标 N/A
- 未触发跨项目已吸纳守门时，`CrossProjectLearnedGuards` 标 `N/A + skipReason`
