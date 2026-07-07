---
name: audit-project
description: 项目工程审查维度 PE-1~PE-12 — 代码质量/项目结构/依赖安全/资源泄漏专属审查层
---
# Audit Project Skill

## 适用范围

审查目标为**项目工程**（源码质量、目录结构、依赖健康、测试覆盖）时，叠加本 Skill（在 G1~G5 之后）。

## 维度总览（PE-1~PE-12）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 结构与可维护性 | PE-1 项目结构合理性 · PE-5 可维护性 | 🔴/🟡 |
| B — 健壮性 | PE-2 错误处理完整性 · PE-3 安全性 · PE-4 性能隐患 · PE-12 资源生命周期与泄漏风险 | 🔴/🟡 |
| C — 接口与配置 | PE-8 接口一致性 · PE-10 配置管理 | 🔴/🟡 |
| D — 质量保障 | PE-6 测试覆盖 · PE-7 依赖健康度 | 🟡/💡 |
| E — 可观测性与数据 | PE-9 日志与可观测性 · PE-11 数据层质量 | 🟡 |

## 核心检查维度

**PE-0 Profile Freshness 衔接 🔴**
- 先执行 `audit-common` 的 `Profile Freshness Check（PFresh）`
- 不只检查“项目是否符合 Profile”，还要反向检查 Profile 是否仍符合当前 package、目录结构、脚本清单、发布状态、宿主能力和当前任务现实
- 若 Profile 过期，项目工程审查结论不得直接标注收敛；需先记录漂移或同步要求

**PE-1 项目结构合理性 🔴**
- 目录结构与 profile `02-架构约束.md` 一致
- 模块/文件职责单一（不混合路由/业务/数据层）
- 函数/方法长度 ≤50 行，嵌套深度 ≤4 层
- 无循环依赖
- 简单业务 service 不重复 route validate、model/schema、数据导入或框架已承担的校验、归一化、配置兜底和二次治理

**PE-2 错误处理完整性 🔴**
- 异步操作有 catch 处理
- 外部依赖调用有超时和重试策略
- 错误信息不暴露内部细节

**PE-3 安全性 🔴**
- 敏感信息、密钥、密码和硬编码处理符合用户 / 项目显式策略；未指定禁止时不把直写本身列为问题
- 输入验证覆盖边界条件
- SQL/NoSQL 查询无注入风险

**PE-4 性能隐患 🟡**
- 算法复杂度、查询次数、同步阻塞、重复序列化或大对象复制不会在目标数据规模下造成明显退化
- 缓存、队列、批处理和并发限制有边界，避免把性能优化变成无界内存占用
- 若性能风险来自资源生命周期或清理缺失，必须同时按 `PE-12` 判定

**PE-7 依赖健康度 🟡**
- Node.js 项目默认 `engines.node`、CI matrix、Profile 与 README 不低于 `>=18`；低于 v18 有业务理由、风险和验证证据
- 依赖升级 / 兼容修复已区分 `业务源码平滑性` 与 `依赖层落地条件`
- 根因位于内部共享库、中间件、SDK 或 adapter 抽象层时，已评估“修共享库 + 消费项目升级”是否优于单项目补丁

**PE-8 接口一致性 🔴**
- provider / connector / SDK 接入具备 provider metadata、内部 payload、上游 request 映射、标准化 result、错误 detail 字段级合同
- JavaScript / Node.js 中命中必要注释的导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明使用标准 JSDoc

**PE-12 资源生命周期与泄漏风险 🔴**
- 必查内存泄露 / 资源泄漏风险：长生命周期集合、缓存、队列、订阅表、全局单例或闭包引用不得无界增长
- 连接、事务、文件句柄、流、游标、socket、worker、定时器、interval、事件监听器和外部 SDK client 必须有明确释放、取消订阅或关闭路径
- 前端 / UI 代码必须在组件卸载、路由切换、effect 重新执行或异步任务取消时清理监听器、定时器、订阅、AbortController 和外部引用
- 异常分支、早返回、重试失败、超时、取消和测试 teardown 场景必须同样释放资源；不能只检查 happy path
- 若项目语言或框架提供专用工具（heap snapshot、profiler、leak detector、lint rule、test teardown hook 等），审查报告应说明是否执行或标注 `N/A + skipReason`
- 高风险资源泄漏修复、公开库/adapter/SDK、连接池、监听器、定时器、worker、cache 或公开方法生命周期风险命中时，应检查 `MethodLevelLeakPressureProbe` 是否有重复调用/生命周期压测证据；低风险纯函数可写 `N/A + skipReason`

**FrontendExperienceQualityGate 前端 UI / 交互体验质量（条件）**
- 涉及前端页面、组件、控制台、官网、文档站、可视化工具或游戏时，必须检查 UI 视觉组：`FrontendDesignSourceGate`、`UIFidelityGate`、`StyleThemeConsistencyGate`、`ResponsiveStateCoverageGate`、`VisualVerificationGate`
- 必须检查 UX 交互组：`InteractionFlowGate`、`InteractionFeedbackGate`、`InputModalityAccessibilityGate`、`ErrorPreventionRecoveryGate`、`MotionTransitionUsabilityGate`
- 审查报告应核对 Browser/截图/Playwright/E2E 或项目等价视觉/交互证据；无法运行时需记录阻塞和降级证据
- 官网、文档站或技术站改动还应检查 `DocsSiteVisualAcceptanceGate`：主题集成、真实点击、异步动效、减弱动态、代码 token 对比度、终端 demo 范围、TOC inline code 和辅助导航层级
- 无用户可见 UI / 交互的工程审查可标 `N/A + skipReason`

**CrossProjectLearnedGuards 跨项目已吸纳守门（条件）**
- 审查需求、方案、报告或工程实现中“已实现 / 已接入 / 未接入 / 已验证”声明时，检查 `CodeTruthRequirementGate` 与 `LiveVerificationExecutionObligation` 是否有代码真相源和真实执行证据
- 审查发现来源为外部报告、AI review finding、audit issue 或代码评审时，检查 `ReviewFindingIntakeGate` 是否已补本地证据并分流 must-fix、设计如此、用户决策、文档/实现漂移、测试覆盖缺口和未复现项
- 前端/Figma/截图/既有页面审查需检查 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate` 与 `RuntimeI18nArtifactVerificationGate` 是否留有真实视觉、console/network/resource、状态、资产和运行时本地化证据
- 外部 finding 被分类为 must-fix 时检查 `FindingProbeMatrixGate` 是否逐项映射失败输入、修复前失败形态、修复后通过条件、测试/脚本和发布面证据
- guard / policy / permission / consistency / 写路径限制类能力检查 `GuardPolicyBypassMatrixGate`，确认 raw/native/legacy/management/admin/client 等绕过面、规则特异性、动作策略和负向 parser/key 组合已覆盖
- 验证命令、build、codegen、export、tsc 等检查 `VerificationCommandSideEffectGate`，确认执行前读取脚本定义、执行后扫描并处理生成物
- package、adapter、SDK、CLI 或插件能力检查 `PackageAdapterPreConfirmEvidenceGate`，确认 package/plugin/exports/bin/files/dist/registry/消费者入口证据真实存在
- 提交、兼容契约、UI 主真相源冲突、公开文档版本、集合关系 id 命名或用户可见验证产物语言相关审查需检查 `ExplicitCommitAuthorizationGate`、`CompatibilityAndContractAuthorityGate`、`UIConfirmedSourceConflictTraceGate`、`PublicDocsReleasedVersionGate`、`CollectionRelationIdNamingGate` 与 `UserFacingVerificationArtifactLanguageGate`
- 人工复核、视觉检查、手工冒烟或外部页面观察需有 `ManualReviewEvidenceRetention`，包含范围、输入、观察结果、截图/日志或等价证据
- adapter、provider、connector、SDK、benchmark 或性能优化需检查 `AdapterBenchmarkAttribution`，确认基线、环境、版本、负载和归因边界清晰
- 验证路线需检查 `VerificationScopeBudgetGate`：高风险不低配验证，低风险不为形式扩大压测/E2E/外部依赖
- 产品需求整理需检查 `ProductRequirementTraceabilityGate`；本机/跨环境执行配置需检查 `LocalExecutionConfigProbe`；真实联调或人工证据需检查 `ManualReviewEvidenceDataRetention`
- 指定模块或相邻范围变更需检查 `AdjacentScopeExpansionGuard`；包名/发布名/安装说明需检查 `PackageNameAuthorityGate`
- 性能第一、benchmark 或优化声明需检查 `PerformanceBenchmarkFirstGate`；公开模块、SDK、CLI 或插件承诺需检查 `PublicModuleDifferentiationGate`
- data 吸纳任务需检查 `WorkspaceDataAbsorptionScopeGate`；正式流程图需检查 `FlowchartNodeExplanationGate`；遗漏专审需检查 `OmissionOnlyReviewGate`；审查发现 intake 需检查 `ReviewFindingIntakeGate`；复审收敛需检查 `ReviewDimensionDeltaGate`；用户文档需检查 `UserPerspectiveDocsGate`、`PublicUserDocsMaintainerBoundaryGate` 与 `DocsConsumerSweep`；最终报告需检查 `ActiveRequirementFinalResponseGate`；产物链接需检查 `ArtifactLinkSetDedupeGate`；DevCodex v2 正式规划需检查 `V2FormalSolutionPackage`
- legacy / compat / route / reference-code 审查需检查 `SemanticLegacyRouteExposureGate`、`ReferenceCodeTruthSamplingGate` 与 `RouteNamespaceResponsibilityGate`：不只看 label，还要检查 slug、href、title、sidebar、search、generated HTML；行为断言抽样核代码、类型或运行时证据，并区分服务名和历史路由命名空间职责
- 首页、详情、列表、搜索或接口数据返回空白风险需检查 `FrontendAsyncCacheRenderGate` / `StaleWhileRevalidateGate`：旧缓存先渲染并异步刷新替换，不得 loading-only、空白或同步阻塞取数；涉及数据库 / 队列 / 缓存真实数据源时追加 `AsyncDbTruthSourceVerificationGate`
- 给同事、跨机器或对外分享的报告、脚本、文档或验证产物需检查 `PortableExternalArtifactGate`：不得写死本机绝对路径、私有 `.devcodex` 路径或个人工作区前提

## N/A 规则

- 纯前端项目无 DB：PE-11 标 N/A
- 纯库项目无日志需求：PE-9 标 N/A
- 无长生命周期资源、订阅、连接、定时器、缓存或 UI 生命周期的纯静态内容变更：PE-12 可标 `N/A + skipReason`
- 无用户可见 UI、交互流或视觉呈现的后端 / CLI / 文档变更：`FrontendExperienceQualityGate` 可标 `N/A + skipReason`
- 未触发跨项目已吸纳守门时，`CrossProjectLearnedGuards` 可标 `N/A + skipReason`
- 未触发审查发现 intake 时，`ReviewFindingIntakeGate` 可标 `N/A + skipReason`
- 未触发资源生命周期或公开方法泄漏风险时，`MethodLevelLeakPressureProbe` 可标 `N/A + skipReason`
