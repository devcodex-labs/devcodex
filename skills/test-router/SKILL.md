---
name: test-router
description: 测试路由规范 — 根据变更类型、影响范围与风险选择静态、单元、集成、API、E2E、场景/负载、pack 或发布验证，并记录跳过理由
---
# Test Router Skill

## 职责

`test-router` 只负责选择验证路线和记录跳过理由，不替代 `dev-testing`、`api-verification`、`dev-scenario-test` 或项目自身测试规范。

## 输入

| 字段 | 说明 |
|------|------|
| `changeType` | docs / spec / runtime / api / hook / cli / release / package / website |
| `impact` | 单文件 / 多文件 / 跨模块 / 控制面 / 用户可见 |
| `risk` | 低 / 中 / 高 |
| `hostSurface` | Copilot / Claude Code / Codex / instruction-fallback / N/A |
| `workspaceGuard` | 单项目 / 多项目 / sticky project / workspace profile / N/A |
| `artifacts` | 需求、方案、计划、报告、`.http`、`.cjs`、截图、benchmark 等 |
| `serviceLifecycle` | 是否需要由 AI 启动长运行服务；若是，记录 command/cwd/PID/job/port/url 与 cleanupEvidence |
| `leakRisk` | 是否涉及长运行服务、缓存/队列/连接池、监听器/定时器、流/socket/worker、订阅、组件生命周期、高并发路径或 PE-12 发现 |
| `frontendExperience` | 是否涉及前端页面、组件、控制台、官网、文档站、可视化工具、游戏或用户可见 UI / 交互 |
| `manualReview` | 是否存在人工复核、视觉检查、手工冒烟、外部页面观察或无法自动化的验证 |
| `scopeBudget` | 验证强度是否与风险、变更面、发布/控制面/资源生命周期/前端体验匹配 |
| `workspaceDataAbsorption` | 是否从 `.devcodex/*/data/` 扫描、吸纳或裁剪候选问题 |
| `specAbsorption` | 是否涉及规范吸纳执行、最新可吸纳清单、仍需吸纳清单、通用规范价值证明或项目独有规则剔除 |
| `externalConsumerValidation` | 是否涉及独立 consumer/verification repository、跨仓完整验证、source link 与 packed artifact、跨仓 CI 或多分母 100% 声明 |
| `agentCapabilityCompleteness` | 是否声称完整/最终 Agent 架构、平台或 enterprise 能力，需要 completenessObject 与能力域矩阵 |
| `docsAudienceRenderedSequence` | 是否需要验证用户文档 pageRole、首屏/导航顺序、quick start 距离或 manual TOC 与 generated outline |
| `modulePerformanceMaintenance` | 是否声称框架/SDK/CLI 的逐模块完整性能覆盖或长期维护，需要适用性、模块协议和持续触发 |
| `docsSiteVisualAcceptance` | 是否涉及文档站/官网/技术站视觉、导航、点击路径、动效或代码展示验收 |
| `methodLevelLeakPressure` | 是否涉及公开方法级资源泄漏修复、adapter/SDK/连接/监听/定时器/worker/cache 生命周期风险 |
| `v2FormalSolutionPackage` | 是否进入 DevCodex v2 一期正式 CP1/CP2 方案包冻结 |
| `highFidelityUi` | 是否涉及 Figma/截图/既有页面高保真还原、局部视觉改动或可用插件视觉验证链 |
| `actualPreviewChain` | 是否需要验证真实 preview URL / API target / 路由入口，或存在 mock fallback 风险 |
| `runtimeI18nArtifacts` | 是否涉及多语言源文件、构建合并产物或页面运行时 key 残留检查 |
| `compatibilityAuthority` | 是否涉及兼容修复、共享库/adapter/SDK、上游契约或官方 public API 依据 |
| `commitAuthorization` | 是否将执行本地 commit；若是，必须有用户明确授权证据 |
| `publicDocsVersionBoundary` | 是否涉及公开文档、迁移指南、版本页或 preview / unreleased 能力边界 |
| `reviewDimensionDelta` | 是否处于 R2+ 复审、audit 连续零发现、ECR 或遗漏专审，需要证明本轮维度焦点不是机械重复 |
| `userPerspectiveDocs` | 是否涉及 README、官网/文档站、接口说明、运行手册、需求/方案等面向使用者的人读文档 |
| `publicDocsMaintainerBoundary` | 是否涉及公开用户文档、教程、快速开始、配置/扩展/框架接入指南，需要排除维护者 checklist / 内部同步清单 |
| `docsConsumerSweep` | 文档是否新增/调整命令、配置项、字段、状态、路径、能力承诺、阅读顺序或用户路径，需要扫描当前消费者 |
| `artifactLinkDedupe` | 是否会输出最终回复、报告、记忆、SUMMARY 或宿主文件面板消费的 ArtifactLinkSet |
| `frontendRuntimeNetwork` | 是否涉及真实前端预览、文档站/官网视觉验收、API target、资源加载、runtime i18n 或 hydration/runtime error 风险 |
| `activeRequirementFinalResponse` | 是否存在多个相邻需求、backlog、open 任务或未完成候选，需要约束最终回复 active 范围 |
| `userFacingDeliveryChain` | 是否涉及用户最终使用文档、docs-first 开发、文档站 / README 主面、前端 / API / 外部契约或 ECR 需求 / 用户文档符合性 |
| `reviewChecklistEvidence` | 是否冻结 Review Checklist、长链路修复 / 复审、外部 finding 批次或风险簇，需要逐项证据化执行 |
| `builtArtifactFeatureSmoke` | 是否涉及 runtime / adapter / SDK / CLI / module-format / exports / bin / files / dist / tsc 输出，需要构建产物 feature-level smoke |
| `generatedSiteVerification` | 是否涉及文档站 / 官网生成产物、导航 / footer / sidebar / outline / 手写 TOC / 语言切换真实可见状态 |
| `userPathContractSweep` | 是否涉及公开能力页首次成功路径、安装版本、配置表、API 索引、sidebar 和 public types / runtime / examples 一致性 |
| `benchmarkRegression` | 是否涉及性能敏感项目、既有 benchmark 基线或 hot path 修改，需要 benchmark regression guard |
| `layeredAbsorption` | 是否涉及规范吸纳、data 台账治理、用户确认可泛化策略、新增门禁或新增 Skill，需要分层同步和探针覆盖 |
| `historicalCommonNormLayering` | 是否涉及历史通用规范、prompt/report 长清单、旧吸纳项或跨版本规范资产重新分层，需要逐文件矩阵和 V74 探针 |
| `proactiveBetterAlternative` | 是否涉及用户建议、方案确认、规范吸纳或复审冻结，需要主动比较更优路径并记录采纳依据 |
| `nativeCommandExitCode` | 是否涉及 release、pack、install smoke、CLI replay、curl/git/npm/node/PowerShell/Bash 原生命令或 wrapper 脚本，需要记录真实退出码 |
| `postConfirmationReviewScope` | 是否处于 CP 确认后进入下一阶段，需要判定轻量复审或全面复审 |
| `developmentDrift` | 是否进入编码前或实施中存在范围、验证路线、消费者同步或 dirty 边界偏移风险 |
| `verificationPlanMaterialization` | CP2 / 技术方案是否需要物化验证计划、验收标准和退出条件 |
| `docsIaReadability` | 是否涉及中文用户文档、pageRole、sidebar group、菜单命名或文档站 IA |
| `userManualReview` | 是否涉及用户侧文档 review、项目文档审查、最终用户手册、文档设计、菜单导航、sidebar 或信息架构聚合审查 |
| `expertOutputQuality` | 是否涉及代码、文档、示例、fixture、mock、demo、quick start、技术方案或报告的专家型质量，或用户指出“不专业 / 像初级 / 示例误导” |
| `expertOwnerSkills` | 是否命中产品策略、开发者体验、UX 交互、前端架构、后端领域架构、生产可用性 / SRE、API 契约、外部集成、平台生态、AI Agent 系统、数据架构、安全威胁建模、质量策略、设计系统、无障碍/国际化、增长分析或商业模型专家 Owner Skill |
| `coverageGateDecision` | 项目是否存在 coverage 脚本、阈值、CI coverage gate 或发布前覆盖率要求，需要区分测试断言通过与覆盖率门禁通过 |
| `externalRuntimePluginLifecycle` | 是否涉及外部 runtime、plugin、registry、adapter、provider 或 injected runtime 注册/替换/释放生命周期 |
| `functionSourceFingerprint` | 是否把 function source / hash / toString / fingerprint 用作 cache key、registry key、checkpoint、幂等或去重依据 |
| `riskClusterEscalation` | 同一风险簇、同类 parser/serializer/runtime/registry 缺陷或同一审查维度是否连续出现 ≥3 个新增 finding / 返修 |
| `riskBasedValidationLadder` | 是否处于同风险簇迭代修复，需要先做 targeted + related suite，再按发布/公共运行时风险升级 full gate |
| `latestAbsorptionExecutionPack` | 是否命中 A1~A10 最新吸纳执行包：配置 canonical namespace、Profile/runtime contract、行为语义/翻译、示例/callback、派生消费者、功能清单或多批次证据 |
| `configCanonicalNamespace` | 是否新增或调整配置 schema、provider 选项、runtime 开关、legacy alias、公开配置路径，需要 `ConfigCanonicalNamespaceGate` |
| `profileRuntimeContractSync` | 是否改变默认行为、runtime contract、transaction/cache/sync promise、用户可见配置语义或 Profile/文档/进度状态，需要 `ProfileRuntimeContractSyncGate` |
| `behaviorSemanticDocsParity` | 是否改变行为语义、CLI/Hook/public API 语义、同义词承诺、comparison/scenario/README/index/search 文档，需要 `BehaviorSemanticDocsParityGate` |
| `negativeTranslationParity` | 是否涉及否定/反义/支持与不支持类多语言表达，需要 `NegativeTranslationParityProbe` |
| `docsExampleTruthSurface` | 是否新增或调整 README/website/quick start/示例中的 option/config/method，需要 `DocsExampleTruthSurfaceGate` |
| `callbackExampleScope` | 是否存在 callback / hook / event / transaction / handler / ctx 示例，需要 `CallbackExampleScopeProbe` |
| `derivedConsumerRuntime` | 是否有 metrics/info/logs/events/warnings/admin bridge/public types 等派生消费者，需要 `DerivedMetricConsumerProbe` |
| `derivedConsumerFailureInjection` | 是否需要证明副通道失败不污染主结果，需要 `DerivedConsumerFailureInjectionProbe` |
| `featureInventoryProfile` | 是否涉及公开包、SDK、CLI、多模块、文档站或 public API 功能清单，需要 `FeatureInventoryProfileGate` |
| `profileTierValidation` | 是否涉及 Profile 三档标准、生成/迁移、功能清单 schema、必需文件或生命周期分类，需要 `ProfileGenerationContractGate` / `FeatureInventorySchemaGate` / `ProfileTierMigrationSafetyGate` / `ProfileTierStandardGate` / `ProfileLifecycleClassificationGate` |
| `allDevCodexProfileValidation` | 是否需要校验 `.devcodex` 下所有项目 Profile，执行 `AllDevCodexProfileValidationGate` |
| `memoryCannotSatisfyBootstrap` | 是否涉及宿主 Memories、模型长期偏好、resume / summary 恢复、Profile / memory bootstrap 或用户询问是否可用记忆替代文件读取 |
| `featureChecklistEvidenceMatrix` | 是否需要 capability group × evidence surface 矩阵，需要 `FeatureChecklistEvidenceMatrixGate` |
| `batchEvidenceLedgerState` | 是否为多批次、矩阵验证、长链路吸纳或复审，需要 `BatchEvidenceLedgerStateGate` |
| `batchProgressCard` | 是否需要最终进度卡同步总范围、已完成、当前批、下一步、剩余项和证据链接，需要 `BatchProgressCardGate` |
| `repairCollaboration` | 是否为 repair task；若是，记录 lightweight/full 风险分类、双层字段、状态转换和独立复证路线；模型名称不作为触发条件 |
| `coverageClaimIntegrity` | 是否声明全量/逐文件/抽样/已执行覆盖，需要 FileEvidenceLedger 或 sampledSet/unreadSet/inferenceBoundary |
| `artifactDeliveryCompleteness` | 最终可见回复是否需要完整 primary artifact set、支持产物 manifest 与三态宿主证据 |
| `reworkEffectiveness` | 是否声称降低返工或提升首次通过率，需要 baseline、prospective trials、成本和 rollback/sunset |
| `candidateDiffCompleteness` | 是否进入 commit/tag/publish 候选，需要 staged snapshot 覆盖 tracked/untracked、cached diff check、name-status、secret-shape 与 intended scope 对账 |
| `releaseAuthorityBeforeCompatibility` | 是否涉及兼容/迁移/alias/fallback，需要先证明 publishedState 和稳定消费者 |
| `configurationErgonomics` | 是否新增/调整公开配置，需要最小任务配置、字段必要性和省略探针 |
| `interactiveSemantics` | 是否存在用户可交互对象，需要运行态 role/name/focus/keyboard/focus recovery 证据 |

## 路由矩阵

| 变更类型 | 必选验证 | 条件验证 |
|----------|----------|----------|
| 文档/规范 | `node scripts/validate.js`、引用扫描 | website build、SCV |
| Skill / instructions / prompts | `node scripts/validate.js`、`npm test`、引用扫描 | `npm run test:all`、部署副本同步 |
| 依赖 / 框架 / SDK / 平台 API | `OfficialDocsEvidence`、安装/版本可用性检查、最小用法验证 | 兼容性回归、迁移 smoke、ProfileImpactCheck |
| Hook / MCP / CLI / ArtifactLinkSet | `npm test`、相关 targeted test、`npm run test:all` | `host-contract-verification`、direct replay、fixture replay、dry-run；产物点击需覆盖 `ArtifactLinkSet` 主链接 + copy fallback，MCP bridge 失败需覆盖 `mcpFallback` |
| 对外 HTTP API | `api-verification` 生成 `.http + .cjs` | 项目集成/E2E |
| 前端/API 文档合同 | ApiDocVerificationSync：检查接口文档、字段映射、错误码、状态枚举与 `.http` / `.cjs` 是否同步 | 不更新验证产物时写 `N/A + skipReason` |
| 文档翻译 / 正式文档边界 | DocumentationTranslationParityGuard、FormalDocsDevCodexBoundary：核对多语言/多入口等价，区分正式用户文档与运行时报告/台账 | website build、链接检查、索引/sidebar 顺序核对；历史镜像写明边界 |
| 用户侧文档 review / 项目文档审查 | `audit-user-manual`：聚合用户文档契约、通用文档审查、README 专项、复审清单、文档设计、菜单导航、sidebar、生成站点和消费者同步证据 | `GeneratedSiteGate`、`ManualTocDuplicationGate`、`DocsThemeRuntimeVisualProbeGate`、Browser/截图或人工证据；纯内容审查写 `N/A + skipReason` |
| 用户文档受众与渲染顺序 | `DocsAudienceRoleAndRenderedSequenceProbe`：pageRole、首屏前三信息块、前两组 sidebar、current quick start 距离、manual TOC/generated outline | fresh generated HTML + Browser/Playwright 或等价运行态证据；只看 Markdown/route/label 不通过 |
| 数据补齐 / 迁移 / 跨环境写入 | DataMutationPlan：显式清单或稳定业务键、dry-run、唯一匹配、缺失/重复清单 | 只读数据库真相源查询、最终消费者响应字段验证 |
| Prompt / Agent / Hook / MCP 契约 | LLMPromptContractTriage：区分人读说明、模型指令、结构化输出字段和宿主能力边界 | validate probe、targeted test、direct/fixture replay |
| Agent 架构完整性 | `AgentCapabilityDomainCompletenessGate`：先声明 kernel/runtime/developer-product/hosted-platform/enterprise-saas，再验证适用能力域 | completenessObject × domain × owner/boundary/runtime/validation matrix；V95 正负向 |
| 专家型产物质量 | `expert-output-quality`：执行 `ExpertOutputQualityGate`、`ProductionRecommendedPathGate`、`FrameworkNativeCapabilityFirstGate`、`FixtureBoundaryDisclosureGate`、`AntiPatternContrastGate`、`ExpertEvidenceMatrixGate` | 源码 / public types / official docs / runtime probe / fixture 边界说明 / 人工证据；无示例或用户可消费产物写 `N/A + skipReason` |
| 专家 Owner Skill | 21 个专家 Owner Skill：执行 `ExpertOwnerSkillGate` | 按 ownerSkill 选择需求事实源、文档/示例、UI 状态、前端缓存、领域模型、SRE、API 契约、外部集成、平台生态、Agent、数据、安全、质量、设计系统、无障碍/国际化、增长、商业、分布式系统、性能、隐私合规或 AI 评测证据；新增专家分别执行 `DistributedSystemsArchitectureGate`、`PerformanceEngineeringGate`、`PrivacyComplianceArchitectureGate`、`AiEvaluationEngineeringGate`；增长 / 商业为 P3 条件触发，未触发写 `N/A + skipReason`；V85/targeted probe 覆盖同步 |
| 前端体验 | FrontendExperienceQualityGate：判定设计来源、UI 还原度、风格主题一致性、响应式/状态覆盖、用户流、交互反馈、输入方式/可访问性、错误恢复、动效转场和视觉验证；同步执行 FrontendBrowserVerificationBudgetGate 与 UserSelfVerificationOverrideGate | lint/typecheck/test、Browser/截图、Playwright/E2E 或人工复核证据；低风险可 optional，用户明确自验时只做代码级验证并记录 VisualVerificationGate=user-self-verification；纯后端/CLI/文档写 `N/A + skipReason` |
| Figma / 高保真 UI 还原 | FigmaHighFidelityRestorationGate、ScopedVisualChangeGate、InstalledPluginVisualVerificationGate：冻结设计来源、allowedScope/frozenScope、元素分类和可用插件验证链 | Browser/Chrome/Figma 插件、截图对比、人工复核；无插件时写降级证据 |
| 视觉偏差 / 设计帧用途 | VisualDeviationTypeGate、DesignFramePurposeClassificationGate：修复前分类偏差类型，列目标帧/排除帧和验收入口 | Figma 参数、代码参数、修复参数、父级裁剪、相邻状态、截图或人工复核证据 |
| 真实预览 / mock fallback | ActualPreviewChainAndMockFallbackGate、FrontendRuntimeNetworkProbeGate、UIStateScopeRegressionGate：确认真实 preview URL、API target、路由入口、构建产物、console/network/failed requests、资源 404、hydration/runtime error 与受影响状态清单 | 不得用 mock、错误 target、临时服务、静态截图或构建成功冒充用户页面通过 |
| Figma 生产资产 / 运行时 i18n | FigmaProductionAssetBudgetGate、RuntimeI18nArtifactVerificationGate：记录资产尺寸/体积/格式/来源/public 路径，核对源 JSON、构建合并产物和页面残留 key | WebP/SVG 内嵌位图检查、runtime page check、fallback 说明 |
| 资源生命周期 / 泄漏稳定性风险 | LeakRiskStabilityPressureTest：判定是否需要场景/负载/稳定性压测，命中时记录 heap/RSS、active handles、监听器、连接数、缓存规模或项目等价指标的基线、压力过程、冷却后回落与清理证据 | 纯计算、静态文档、一次性脚本或无长生命周期资源变更可写 `N/A + skipReason` |
| 覆盖率门禁 | CoverageGateDecision：项目存在 coverage 脚本、阈值、CI coverage 或发布要求时，单独判定 coverage gate 状态，不得用单测断言通过替代覆盖率通过 | 记录命令、工具、阈值、基线、当前值、known-red / failed / passed / N/A 和是否阻断 push/release |
| 外部 runtime / plugin / registry 注入 | ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate：外部 runtime、plugin、registry、adapter、provider 或 injected runtime 变更必须覆盖 config 组合、生命周期转换、多实例共享、集合代数、批量部分成功和 owner mutation reset/replace/dispose/clear | 低风险内部纯函数写 `N/A + skipReason`；公共 runtime / adapter / registry 变更不得只跑 happy path |
| 函数源码 fingerprint / checkpoint | FunctionSourceFingerprintMatrixGate：function source、hash、toString 或 fingerprint 参与 cache key、registry key、checkpoint、幂等或去重时，必须覆盖稳定源码与闭包/默认参数/global shadow 等误判矩阵 | 记录 false-positive / false-negative 轴和代表性样本；未触发时写 `N/A + skipReason` |
| 同风险簇迭代修复 | ClusterEscalationGate / RiskBasedValidationLadder：同一风险簇连续 ≥3 个 finding、返修或复审遗漏时，暂停点状补丁，冻结风险模型、矩阵、替换策略和停止条件；迭代中先跑 targeted + related suite，发布/公共运行时再升级 full gate | 报告写明 clusterId、触发计数、升级理由、当前验证层级和 full gate 触发/跳过依据 |
| 本地服务验证 | ServiceLifecycleCleanup：记录启动命令、cwd、PID/job、端口/URL，并在验证完成、失败或最终回复前关闭仅由 AI 启动的服务 | 用户明确要求保留服务时，记录保留原因、PID/端口/URL 与关闭方式 |
| 人工复核 / 手工验证 | ManualReviewEvidenceRetention：记录复核人/时间/范围/输入/观察结果/截图或日志位置 | 不得只写“人工检查通过”；无法留截图时写等价证据 |
| 验证范围预算 / 真实执行 | VerificationScopeBudgetGate、LiveVerificationExecutionObligation：验证强度匹配风险，声明已验证前实际执行命令、页面、接口、pack/install、registry/tag 查询或等价验证 | 降级必须写阻塞原因、替代证据和残余风险 |
| 发布 / package | `audit-release`、`release-verification`、`npm run test:audit`、`CandidateDiffCompletenessGate`、package completeness gate、远端 CI 绿色（如存在）、pack dry-run、`NativeCommandExitCodeGate`；PackageBoundarySerialCheck：pack / boundary 检查必须在 build / benchmark / codegen 完成后单独串行执行 | 先物化 staged candidate 并执行 cached diff/name-status/secret-shape/intended scope 对账，再执行 pack install smoke、publish dry-run、无关残留文件清理复核 |
| scoped package / 双 registry | `ScopedRegistryResolutionGate`：冻结 package scope、全局 registry、scope registry、userconfig 与命令级 override；双通道结果相同先按路由污染调查 | scope override 参数单测 + 默认污染复现 + 显式目标查询/dry-run + 真实 exitCode；primary 身份未通过时禁止 tag/mirror |
| 独立消费者仓 / 跨仓完整验证 | `consumer-validation-engineering`：RepositoryBinding、SourceConsumerIdentity、ValidationDenominatorMatrix、packed install、CrossRepoCI、FreshnessDrift | link/workspace + tarball fresh install + source event→consumer run；任一适用分母 partial/stale 阻断完整/发布声明；V95 |
| 逐模块性能与长期维护 | `ModulePerformanceCoverageAndMaintenanceGate`：feature applicability、module workload/budget/baseline/candidate/capacity/resource/recovery、PR/main/schedule/RC/post-release | 性能清单完成与执行完成分报；skip/N/A/flake 纳入分母；V95 |
| Profile 真相对账 | `ProfileTruthReconciliationGate`：project analyze 用 targeted、audit 用 full/PFresh；构造 aligned、stale-profile、stale-code-or-doc、intentional-exception、unverifiable 与低风险 N/A 样例 | V88/targeted probe；stale Profile 不得覆盖代码事实，analyze/audit 不得直接修改 Profile |
| 授权本地安全审查呈现 | `AuthorizedLocalSecurityAuditPresentationGate`：authorization/defensive objective、visible evidence budget、isolated probe、SafetyInterruptionCard 与恢复路线 | V89 正负向；完整载荷公开、缺恢复卡、声称绕过/保证不触发均失败 |
| 发布凭据拓扑 | `PublisherCredentialTopologyGate`：首次发布/owner/package/registry/auth 变化核对 identity、scope/access/inheritance、permission、ownership、reference run | V90 + R0~R7；复制 workflow、读取 secret value 或缺 topology evidence 均失败 |
| 消费者验证 / 跨仓库验证 | ConsumerDependencyTreeProbe：先核对 `package.json`、lockfile、`node_modules` 与 `npm ls <关键依赖>`，排除依赖树漂移 | 源码补丁、共享库升级、消费者 lockfile 恢复 |
| Adapter / provider benchmark | AdapterBenchmarkAttribution：记录基线、环境、版本、负载、归因边界和不可比较因素 | 避免把框架、网络、缓存预热、依赖树或测试环境差异误归因给业务代码 |
| 产品需求整理 / 产品完整需求 / 需求迁移 / 需求变更 | ProductRequirementTraceabilityGate：先记录入口类型；无产品角色的纯新需求记录 `00-需求概况.md` / PRD / Word / 原型 / 截图 / 消息锚点、`01-需求确认.md` 的 AI 提取口径、产品补充口径、冲突/遗漏处理、双方确认状态和技术验证映射；有产品角色直接提供完整需求时记录 `01-产品需求.md`、产品原文锚点、AI / 研发缺口 / 冲突检查、澄清状态和技术验证映射，缺口检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不写入产品模板正文，也不生成或重写产品需求；需求变更记录 `00-需求变更概况.md`、原需求基线、变更前后差异、`01-需求变更确认.md`、目标需求真相源回写和技术验证映射；Bug 问题记录 `00-问题概况.md` / `01-问题确认.md` 并走 fix | 不得把 AI 摘要当唯一真相源；不得混写需求方输入、产品完整需求、需求变更和产品确认；不得把 Bug 当产品需求；需求方和产品不填写验收标准，验证映射由技术方案 / 测试方案派生 |
| CP 确认后复审 / 开发偏移 | `PostConfirmationReviewScopeGate`、`DevelopmentDriftGate`：按风险判定轻量或全面复审；全面复审使用 review-checklist 文件、PR-2~PR-7、状态新鲜度；进入编码前核对 allowedFirstBatch、blockedScope、driftTriggers、validationRoute、consumerSync 和 dirty boundary | 低风险降级必须写 `skipReason`；触达 blockedScope 或改变验证路线时回 CP2/CP3 |
| 修复协作契约 | `repair-collaboration`：lightweight 至少验证问题/预期/验收证据与允许路径/验证/回滚；full 追加 finding map、handoff、状态跳转和 independent re-review | 只出现模型/Agent 名称预期 `not-repair`；高风险缺完整字段或只有补丁作者自证必须失败 |
| 本机 / 跨环境执行配置 | LocalExecutionConfigProbe：核对项目指定配置入口、Profile `config.local.json` 模型或既有脚本约定；未指定时遵循 S02 | 不得为了安全感臆造 env/secret/config.local |
| Profile 生成迁移 / 三档 / 全工作区校验 | ProfileGenerationContractGate / FeatureInventorySchemaGate / ProfileTierMigrationSafetyGate / ProfileTierStandardGate / ProfileLifecycleClassificationGate / AllDevCodexProfileValidationGate：执行 CLI 行为回归、Profile validator 正负样本与 `node scripts/validate-all-profiles.js --workspace <workspace-root>`；必须覆盖 dry-run 零写入、升级保留、未授权降档拒绝、结构化清单和警告/错误分离 | 兼容历史项目时可允许 warning，但 release / 规范发布前需说明是否使用 `--strict-warnings` |
| 人工证据留存 / 真实联调 | ManualReviewEvidenceDataRetention：记录证据保存位置、可复核输入、样本范围、保留策略和不可保留原因 | 证据不能进入仓库时写明外部位置或不可保留理由 |
| 指定范围防扩散 | AdjacentScopeExpansionGuard：核对用户指定模块/目录/adapter/provider 与相邻范围修改理由 | 无共同契约、共享缺陷或验证必需时不得扩相邻范围 |
| 包名 / 发布名 / 安装说明 | PackageNameAuthorityGate：核对 `package.json`、`plugin.json`、registry/包管理器证据、bin/exports/scope | 禁止凭历史记忆或目录名判断包名 |
| 性能第一 / benchmark | PerformanceBenchmarkFirstGate：先冻结基线、环境、版本、指标、负载、比较对象和成功阈值 | 缺少基线不得宣称提升、最快或第一 |
| 公开模块 / SDK / CLI / 插件 | PublicModuleDifferentiationGate：区分 public API、内部 helper、示例代码、发布包文件、消费者入口和历史镜像 | 正式文档只承诺真实公开面 |
| DevCodex v2 一期路线 | V2MCPFirstPlanningGate：核对 Intent-Gated Hosted Spec MCP、Codex-only MVP、私有可追踪 docs 和无本地规则正文缓存边界 | MongoDB/控制台/多租户自定义工作流默认不进一期 |
| data 吸纳 / 最新问题扫描 | WorkspaceDataAbsorptionScopeGate：扫描 `.devcodex/*/data/` 全命名空间，列出命中台账、候选编号、归属和跳过理由；命中后读取 `spec-absorption` | 不得只扫当前源码项目、当前 active-root 或 sticky activeProject |
| 项目/目录分析审查扫描 | `artifactScaleRouting`：调用 `skill-gap-analysis` 的 ProjectArtifactScaleRoutingGate | broad scan 前记录六项规模指标、single-pass/batched/sampled+deep-read/blocked、exclusion、batch/checkpoint、invalid-run；V91 正负向 |
| 覆盖声明真实性 | `ReviewCoverageClaimIntegrityGate` | sampled-as-full、inventory-as-read、executed-as-manual 负向样例；FileEvidenceLedger 正向样例 |
| 返工预防与一次通过率 | `ReworkPreventionGate` | 事件分类、防指标作弊、已知簇前移拦截、prospective trial、无效控制回滚；V94 |
| 返工治理效果 | `ReworkReductionValueGate` + `ReworkEffectivenessLoop` | baseline 只证明历史；普通晋级需 3 个可比 WorkUnit 或 2 个独立上下文；记录误报/开销、insufficient-evidence 与 rollback/sunset |
| 发布权威与兼容 | `ReleaseAuthorityBeforeCompatibilityGate` | released 才评估兼容；unreleased 且无稳定消费者直接收敛；unknown 阻断；V94 正负样例 |
| 配置易用性 | `ConfigurationErgonomicsGate` | MinimalTaskConfig、FieldNecessityMatrix、ComplexityBudget、AdvancedCapabilityBoundary、OptionalFieldOmissionProbe；V94 |
| 交互语义 | `InteractiveSemanticProbe` | role、accessible name、focusability、Enter/Space/Escape、focus recovery；截图不得替代；V94 |
| Skill portfolio 治理 | SkillPortfolioLifecycleGate | dependency/conflict/trigger quality/lifecycle/retirement/authorization；V91 |
| 分布式/性能/隐私/AI 评测专家 Owner | 按语义调用四个新专家 Skill | 领域输出字段、反模式负向样例、V85/V91；未触发写 N/A + skipReason |
| 规范吸纳执行 | `spec-absorption`：执行 `CommonNormGeneralizationGate` 与 `AbsorptionCandidateConsumerProofGate` | 必须证明通用规范价值、DevCodex 当前消费者和 targetOwner；项目独有规则写 `project-local / case-evidence-only`，不得吸纳到通用规范 |
| 规范吸纳架构归属 | LayeredAbsorptionGate + SkillFirstAbsorptionGate / CapabilityToSkillPromotionGate：每条可泛化 PI/PF/GAP/ISSUE 先输出 LayeredAbsorptionDecision（兼容 SkillAbsorptionDecision） | 判定 `global-invariant` / `existing-skill-subgate` / `new-skill-required` / `docs-only`；逐层覆盖 `commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy`；成组能力不得只追加到通用 guard |
| A1~A10 最新吸纳执行包 | LatestAbsorptionExecutionPack：`ConfigCanonicalNamespaceGate`、`ProfileRuntimeContractSyncGate`、`BehaviorSemanticDocsParityGate`、`NegativeTranslationParityProbe`、`DocsExampleTruthSurfaceGate`、`CallbackExampleScopeProbe`、`DerivedMetricConsumerProbe`、`DerivedConsumerFailureInjectionProbe`、`FeatureInventoryProfileGate`、`FeatureChecklistEvidenceMatrixGate`、`BatchEvidenceLedgerStateGate`、`BatchProgressCardGate` | 按 `GovernanceGateRegistry` 分组写 ownerSkill、validationRoute、skipReason；至少覆盖 canonical namespace / ProfileImpactCheck、public types/runtime/generated search、失败注入、feature inventory、EvidenceLedger 和 Progress Card；未触发项写 `N/A + skipReason` |
| Profile / memory bootstrap | `MemoryCannotSatisfyBootstrapGate`：宿主 Memories、模型长期偏好、SUMMARY 或 ContextHandoffCard 只能作为导航提示 | 真实读取当前 active namespace 的 Profile、Agent SUMMARY、today/yesterday tasks、相关 reports / review checklist 和源码 / 文档真相源；无法读取写阻塞 / 降级，不得写 passed；V86/targeted probe |
| 历史通用规范分层迁移 | HistoricalCommonNormLayeringGate：迁移旧通用长清单、prompt/report 重复清单或历史吸纳项 | 先冻结逐文件审查矩阵；TestRoute 覆盖 targeted tests、`node scripts/validate.js`、publicDocs、deployCopy、ProfileImpactCheck；无法立即迁移的历史规则标 `legacy-index-retained` |
| 主动更优建议 | ProactiveBetterAlternativeGate：用户建议、方案确认、规范吸纳或复审冻结前主动比较更优路径 | 若有更低风险、更完整、更易维护或更易验证方案，先提出取舍再确认；采纳用户原方案时记录依据 |
| 完整吸纳补强 | ConfirmedAbsorptionCompletenessGates：用户确认未完整吸纳、半覆盖或缺探针时 | 按 Gate 分流验证：`PublicSurfaceClosureGate` 查 pack/README/public types/search；`UserManualRenderedFlowAndRealWorkflowProbe` 查 Mermaid 真实渲染和真实 workflow；`FrontendAsyncCacheRenderGate` / `StaleWhileRevalidateGate` 查旧缓存先渲染和异步刷新；`RemoteCIParityPushGate` 查远端 CI 同构门禁；`EvolutionCapabilityControlPlaneGate` 查候选态、授权、模型配置、配额、数据边界、审计、回滚和发布审批 |
| 需求维度与复审锚点 | SampleIssueExpansionGate / RequirementDimensionBindingGate / RequirementPriorityAndPhaseGate / ReviewAnchorMaterializationGate | 样例 issue 先扩展全维度图；每个需求维度绑定 CP2、批次、验收和阶段关闭；PR/TD 锚点物化为可 grep 章节、表格或清单 |
| 语义 legacy 与参考代码真相 | SemanticLegacyRouteExposureGate / ReferenceCodeTruthSamplingGate / RouteNamespaceResponsibilityGate | 检查 slug、href、title、sidebar、search、generated HTML 和 route namespace；行为断言抽样核代码、类型或运行时证据 |
| Profile / 服务规范覆盖 | StrongestProfileSourceGate / ServiceSpecificResidueSweep / ProfileReadChainGate / ServiceNormCoverageGate | 以最强 Profile 为基线，扫服务化残留；覆盖 profile 读取链、全部服务集合、docs 自维护链、导航、版本、构建、报告和记忆 |
| API / 框架能力证据 | OfficialApiEvidenceGate / FrameworkCapabilityAutoFirstGate / AsyncDbTruthSourceVerificationGate | 查官方 API / public contract / 源码证据；先评估框架或插件既有能力；数据库 / 异步 / 缓存验证区分真实数据源、旧缓存、异步刷新和失败回退 |
| 正式流程图 / 生命周期图 | FlowchartNodeExplanationGate：Mermaid/Nxx 流程图配套中文节点说明，覆盖触发、前置、动作、出口、异常 | 临时草图写 `N/A + skipReason` |
| 中文主表达 / 文档站 IA | `ChinesePrimaryExpressionGate`、`SidebarPageRoleMaterializationProbe`、`SidebarGroupSemanticModelProbe`：中文正文主干解释任务/配置/错误/流程；新增能力或菜单调整从 current sidebar/docs inventory/generated HTML 反查 pageRole、route、label、group 和相邻职责 | 不得只补单个菜单项、按 API 名猜 route，或把内部依赖当 IA 归属 |
| 文档站视觉 / 交互验收 | DocsSiteVisualAcceptanceGate：覆盖主题集成、真实点击、异步动效、减弱动态、代码 token 对比度、终端 demo 范围、TOC inline code、辅助导航层级 | 纯内容页可降级为链接/构建/人工证据 |
| 遗漏专审 / 只列仍需吸纳项 | OmissionOnlyReviewGate：只输出此前未覆盖且仍有价值项，保留已吸纳/排除理由和覆盖增量 | 不得把已吸纳、已关闭或没必要项重新列入最终清单 |
| 审查发现 intake | ReviewFindingIntakeGate：外部审查报告、AI review finding、audit issue 或代码评审发现进入修复/建议前，先补本地证据并分流 must-fix、用户决策、文档实现漂移、测试缺口、未复现或设计如此 | 不得把报告结论直接当验证证据；公共契约或兼容风险源码修改前先确认 |
| 审查 finding 反证矩阵 | FindingProbeMatrixGate：每条 must-fix finding 映射入口/消费者、最小失败输入、修复前失败形态、修复后通过条件、测试/脚本和发布面证据 | 至少一轮反向运行矩阵；parser/serializer/exporter 类追加对抗轴 |
| guard/policy 绕过矩阵 | GuardPolicyBypassMatrixGate：guard、policy、permission、consistency 或写路径限制修复建立 surface × specificity × action × op category × namespace 矩阵 | raw/native/legacy/management/admin/client、default+局部规则、warn/throw、reserved key 等负向探针 |
| 数据库记录迁移导出 | DatabaseRecordMigrationExportGate：配置/模板/注册/字典/权限等记录跨环境迁移导出完整记录链 | 只读源库、全字段 JSON/Extended JSON、insert/upsert 脚本、执行顺序、引用完整性、目标 dry-run |
| 兼容文档副作用 | SideEffectCompatibilityDocsGate：公开主路径不展示带全局副作用、弃用行为、兼容 shim 或高心智负担旧写法 | 旧路径迁移到 release/迁移/测试/maintainer-only 文档 |
| 可执行示例真相 | ExecutableExampleTruthProbeGate：DSL/parser/validator/exporter/配置/模板示例写入公开文档或 CP 前先跑当前实现最小探针 | 新语法标未发布或进入 CP2 兼容评估 |
| 一次性脚本归属 | OneOffRequirementScriptPlacementGate：新增脚本前判定生命周期 | 一次性需求脚本放任务目录 scripts/.tmp；长期复用/运维入口才进项目 scripts |
| 验证命令副作用 | VerificationCommandSideEffectGate：执行验证命令前读取 script 定义并分类 read-only / writes-artifacts / mutates-source | 类型校验优先 noEmit；写产物命令执行后扫描 git status/生成物并隔离或清理 |
| 需求确认前快门 | RequirementPreConfirmGate：推荐确认需求前检查行为可验证验收、范围/非目标冲突和高风险 fail-safe 语义 | 缺口先回写需求或列确认问题，不得直接建议确认 |
| 多阶段关闭 | MultiPhaseClosureGate：Phase 1/roadmap/分阶段需求列全后续阶段、门禁、确认点、进度真相源和最终关闭规则 | 不得把 Phase 1 完成当整体关闭 |
| package/adapter 确认前证据 | PackageAdapterPreConfirmEvidenceGate：package、adapter、SDK、CLI 或插件方案确认前核对 package/plugin/exports/bin/files/dist/registry/消费者入口 | 缺证据时不得宣称包消费者可用 |
| 用户文档驱动交付链 | UserFacingDeliveryChainGate：从原始需求、需求确认、用户最终使用文档、条件契约文档到技术方案、复杂项目实施方案、实施计划、进度和 ECR 需求 / 用户文档符合性审查建立链路 | FinalUserManualFirstGate、DocsSiteInformationArchitectureGate、UserManualFlowAndFailureGate、QueueDocsRealWorkflowGate |
| 审查清单证据化 | ReviewChecklistCompletenessGate、EvidenceExecutionGate、ReviewEscapeRecordGate：冻结清单后每项绑定代码 / 类型 / 测试 / 文档 / 配置证据、命令输出或反向缺席扫描；发现原清单遗漏时记录 whyMissed、prevention、checklistPatch 与 rerunEvidence | Fix-Then-Checklist、lexical token class / 语法类别反向枚举、复审逃逸记录 |
| 构建产物 feature smoke | BuiltArtifactFeatureSmokeGate、TscOutputImportProbe：dist CJS、dist ESM、`.generated` / tsc 输出或等价产物上真实 import / feature path | dependency load API shape、default/off/injected runtime、active handles |
| 文档站生成产物验证 | GeneratedSiteGate、ManualTocDuplicationGate：以当前构建产物或真实预览检查 header / top / mobile / footer / sidebar / outline / 正文 TOC 可见状态 | 区分 DOM hidden、visible duplicate、current violation、historical allowed |
| 公开用户路径契约 | UserPathContractSweep：公开能力页核对安装版本、quick start、构造函数示例、配置字段类型、相邻专题、API 索引和 sidebar | package.json、public types、runtime wiring、examples 作为证据 |
| 性能回归门禁 | BenchmarkRegressionGuard：已有 benchmark 基线或性能敏感 hot path 变更时执行代表性 benchmark 或写 N/A + skipReason | 超过阈值阻断发布或进入用户确认的性能 / 正确性取舍 |
| 方法级泄漏压测 | MethodLevelLeakPressureProbe：公开方法、adapter/SDK、连接池、监听器、定时器、worker/cache 风险命中时评估重复调用或生命周期压测 | 低风险纯函数写 `N/A + skipReason` |
| v2 一期正式方案包 | V2FormalSolutionPackage：冻结 CP1/CP2，覆盖架构、数据模型、MCP API contract、instruction return、可见性、cache/signature/rollback、Codex-only 验证、Registry/Marketplace、维护站和 Mermaid 节点 | 未完成前不得宣告 v2 一期收敛 |
| 提交授权 / 公开文档版本 | ExplicitCommitAuthorizationGate、PublicDocsReleasedVersionGate：实际 commit 必须有用户明确授权；公开文档不得把未发布能力写成已发布历史或迁移负担 | commit 证据、release/unreleased 边界、preview 标识 |
| 兼容契约 / 命名 / 产物语言 | CompatibilityAndContractAuthorityGate、CollectionRelationIdNamingGate、UserFacingVerificationArtifactLanguageGate：核对消费者零代码兼容、上游 public API、关系 id 命名和 `.http` / 测试说明语言 | 官方/源码/registry 证据、命名 convention、用户语言证据 |
| 复审维度增量 | ReviewDimensionDeltaGate：R2+ 复审、audit 连续零发现、ECR 或遗漏专审必须记录 PreviousDimensionSet、CurrentDimensionFocus、NewDimensionRationale、RepeatedDimensionReason | 不得每轮机械重复同一组维度；重复维度须有阻断项回归、高风险锚点、新证据或抽样理由 |
| 用户视角文档 | UserPerspectiveDocsGate：README、官网/文档站、接口说明、运行手册、需求/方案等人读文档从使用者角度验证详细度、字段解释、首次成功路径、心智负担和排错恢复 | 纯内部临时报告或维护者专用文档写 `N/A + skipReason` |
| 专家型输出质量 | ExpertOutputQualityGate：代码、文档、示例、fixture、quick start、技术方案和报告需要体现技术专家 / 资深架构 / 领域专家口径 | 区分生产推荐路径、框架原生能力、fixture/mock/demo 边界、反模式和证据矩阵 |
| 用户文档即时理解 | UserDocsImmediateComprehensionGate：README、官网/文档站、API/CLI/config 文档、快速开始和运行手册必须输出功能完整性、配置易懂性、首次读者即时理解三轴证据 | 不得只因章节完整或契约完整就判定用户文档可用 |
| 用户文档主面 | UserDocsPrimarySurfaceGate：用户使用文档、站点文档、文档站、README、quick start 或接入手册必须冻结 targetSurface/documentLocation/primaryAudience，并抽查首页、quick start、nav/sidebar 前两组、CTA、reference、配置、常见任务和排错 | 开发契约、目标 API、数据模型和维护者验收只能后置或标 maintainer/developer-only |
| 公开用户文档维护边界 | PublicUserDocsMaintainerBoundaryGate：公开用户文档不得把维护者验收、发布 checklist、内部同步清单、台账状态或实现者复审任务放进用户主路径 | 迁移到 CONTRIBUTING、release checklist、requirements/report 或 maintainer-only 文档 |
| 需求复审状态同步 | RequirementVerdictStateSyncGate：需求修订、再次复审或宣布“可确认/暂不通过”前同步顶部状态、推荐结论、修复清单、audit-state decision、sessions/SUMMARY | 正文已修但状态旧口径时先修状态同步集 |
| 文档消费者扫描 | DocsConsumerSweep：文档新增/调整命令、配置项、字段、状态、路径、能力承诺或阅读顺序时同步 README / website / Profile / prompts / templates / examples / nav/sidebar / validate probes / 部署副本与代码消费点 | 不得只改一处文档后宣称消费者已同步 |
| 产物链接去重 | ArtifactLinkSetDedupeGate：输出前按规范化绝对路径去重最终回复、报告、记忆、SUMMARY、相对链接、绝对链接和 copy fallback | 同名不同文件要路径消歧；历史镜像/部署副本需标识身份 |
| 最终回复 active 范围 | ActiveRequirementFinalResponseGate：同日或同工作区有相邻需求、backlog 或候选时，最终回复先声明当前 active requirement/task/bug id，完成状态和下一步仅围绕当前范围 | 未切换的相邻需求只能列入未执行/观察范围 |

## 输出格式

```markdown
## TestRoute

| 项 | 内容 |
|----|------|
| changeType | |
| requiredChecks | |
| conditionalChecks | |
| hostVerificationMode | |
| workspaceGuard | |
| evidenceSource | |
| regressionChecks | |
| serviceLifecycle | N/A / startedByAI / userProvided；cleanupEvidence 或 keepAliveReason |
| leakRiskPressure | N/A / required / optional；若 required，写触发依据、指标、场景、持续时间、冷却窗口与通过标准 |
| frontendExperience | N/A / required / optional；若 required，写触发依据、UI/UX门禁、截图/E2E/人工复核证据和跳过理由 |
| browserVerificationBudget | N/A / required / optional / user-self-verification；写 FrontendBrowserVerificationBudgetGate / UserSelfVerificationOverrideGate 触发依据、替代证据和残余风险 |
| highFidelityUi | N/A / required / optional；若 required，写设计来源、allowedScope/frozenScope、Figma/截图还原、插件验证链和偏离理由 |
| visualDeviationType | N/A / required / optional；若 required，写偏差类型、Figma effect/style 参数、代码参数、修复参数、父级裁剪和状态回归 |
| designFramePurpose | N/A / required / optional；若 required，写目标帧、排除帧、用途分类和验收入口 |
| actualPreviewChain | N/A / required / optional；若 required，写真实 URL、API target、路由入口、状态清单、mock fallback 排除证据 |
| runtimeI18nArtifacts | N/A / required / optional；若 required，写源 JSON、构建/合并产物、页面 runtime key 残留与降级证据 |
| manualReviewEvidence | N/A / required / optional；若 required，写复核人/时间/范围/输入/观察结果/截图或日志位置 |
| requirementTraceability | N/A / required / optional；若 required，写入口类型、`00-需求概况.md` / `01-产品需求.md` / `00-需求变更概况.md` / `00-问题概况.md` / 原始附件锚点、`01-需求确认.md` / `01-需求变更确认.md` / `01-问题确认.md` 的 AI 提取口径、产品补充口径、产品原文锚点、双方确认状态、冲突/遗漏处理、AI / 研发缺口检查记录位置和技术验证映射 |
| localExecutionConfig | N/A / required / optional；若 required，写配置来源、缺失处理、S02 策略和未引入 ad hoc env 的证据 |
| manualReviewDataRetention | N/A / required / optional；若 required，写证据保存位置、样本范围、可复核输入和不可保留理由 |
| adjacentScopeExpansion | N/A / required / optional；若 required，写指定范围、扩展理由、影响面和回退边界 |
| packageNameAuthority | N/A / required / optional；若 required，写 package/plugin/registry/bin/exports/scope 证据 |
| performanceBenchmarkFirst | N/A / required / optional；若 required，写基线、指标、负载、比较对象和成功阈值 |
| publicModuleDifferentiation | N/A / required / optional；若 required，写 public API、内部实现、示例、发布文件和消费者入口边界 |
| v2McpFirstPlanning | N/A / required / optional；若 required，写 v2 一期 MCP-first 范围和非一期排除项 |
| workspaceDataAbsorption | N/A / required / optional；若 required，写 `.devcodex/*/data` 命名空间、台账文件、候选编号、跳过理由和纳入范围 |
| specAbsorption | N/A / required / optional；若 required，写 `CommonNormGeneralizationGate`、`AbsorptionCandidateConsumerProofGate`、通用性证据、项目独有残留、targetOwner、layerChecks、验证路线和跳过理由 |
| docsSiteVisualAcceptance | N/A / required / optional；若 required，写主题、点击、动效、reduced-motion、代码 token、终端 demo、TOC 和辅助导航证据 |
| methodLevelLeakPressure | N/A / required / optional；若 required，写公开方法、重复调用/生命周期场景、资源指标、阈值、冷却和清理证据 |
| v2FormalSolutionPackage | N/A / required / optional；若 required，写 CP1/CP2 包位置、MCP API contract、验证矩阵、回滚和发布/维护站证据 |
| commitAuthorization | N/A / required / optional；若 required，写用户明确授权消息、语义批次和 commit 边界 |
| compatibilityAuthority | N/A / required / optional；若 required，写零代码消费者兼容、上游契约权威、官方 public API 证据和共享库优先判断 |
| uiConfirmedSourceConflictTrace | N/A / required / optional；若 required，写旧 PRD/文档、新 UI/Figma/截图来源、采纳理由和同步路线 |
| publicDocsVersionBoundary | N/A / required / optional；若 required，写 released / unreleased / preview 边界和公开文档落点 |
| reviewDimensionDelta | N/A / required / optional；若 required，写 PreviousDimensionSet / CurrentDimensionFocus / NewDimensionRationale / RepeatedDimensionReason |
| userPerspectiveDocs | N/A / required / optional；若 required，写使用者路径、详细度、字段/参数/状态/错误解释、心智负担和排错恢复 |
| publicDocsMaintainerBoundary | N/A / required / optional；若 required，写公开用户路径是否移除维护者 checklist、内部同步清单、台账状态和复审任务 |
| docsConsumerSweep | N/A / required / optional；若 required，写 README / website / Profile / prompts / templates / examples / nav/sidebar / validate probes / 部署副本 / 代码消费点扫描结果 |
| artifactLinkDedupe | N/A / required / optional；若 required，写 canonical path 去重、同名消歧、历史镜像/部署副本标识和最终 ArtifactLinkSet |
| frontendRuntimeNetwork | N/A / required / optional；若 required，写真实 URL、console/network、failed requests、资源 404、API target、hydration/runtime error、runtime i18n key 检查证据 |
| activeRequirementFinalResponse | N/A / required / optional；若 required，写当前 active requirement/task/bug id、未切换相邻需求和最终回复范围 |
| userFacingDeliveryChain | N/A / required / optional；若 required，写 documentationSurface、用户最终文档、条件契约文档、技术方案输入、实施方案/计划/进度和 ECR 对照 |
| reviewChecklistEvidence | N/A / required / optional；若 required，写清单编号、证据类型、ReviewedSet、exclusions、命令/行号/反向扫描 |
| builtArtifactFeatureSmoke | N/A / required / optional；若 required，写 dist CJS/ESM/.generated 或等价产物、feature path、dependency shape 与模式覆盖 |
| generatedSiteVerification | N/A / required / optional；若 required，写构建产物、导航/footer/sidebar/outline/TOC 可见状态和 DOM/CSS 区分 |
| userPathContractSweep | N/A / required / optional；若 required，写安装版本、配置契约、public types/runtime/examples/sidebar 证据 |
| benchmarkRegression | N/A / required / optional；若 required，写基线、当前结果、阈值、不可比较因素、是否阻断发布 |
| coverageGateDecision | N/A / passed / failed / known-red；写 coverage 命令、工具、阈值、基线、当前值、阻断或降级依据 |
| coverageClaimIntegrity | N/A / required / passed / failed；写 claim type、FileEvidenceLedger 或 sampledSet/unreadSet/inferenceBoundary |
| artifactDeliveryCompleteness | N/A / verified-present / verified-missing / unverified；写 primary artifacts、manifest、evidence source 与 missing items |
| reworkEffectiveness | N/A / effective / ineffective / harmful / insufficient-evidence；写 WorkUnit、baseline、prospective trials、成本和 rollback/sunset |
| releaseAuthorityBeforeCompatibility | N/A / released / unreleased / unknown；写 authority sources、consumer evidence 与 decision |
| configurationErgonomics | N/A / required / passed / failed；写最小配置、字段矩阵、复杂度预算、高级边界和省略探针 |
| interactiveSemantics | N/A / required / passed / failed；写 role/name/focusability/Enter-Space-Escape/focus recovery 与运行态证据 |
| externalRuntimePluginLifecycle | N/A / required / optional；若 required，写 config 组合、生命周期转换、多实例共享、集合代数、批量部分成功和 owner mutation 证据 |
| functionSourceFingerprint | N/A / required / optional；若 required，写 source/hash/toString/fingerprint 用途、false-positive/false-negative 样本和闭包/默认参数/global shadow 覆盖 |
| clusterEscalation | N/A / required / optional；若 required，写 clusterId、触发计数、冻结矩阵、替换策略、停止条件和 rerunEvidence |
| riskBasedValidationLadder | N/A / targeted / related-suite / full-gate；写当前层级、升级触发、未跑 full gate 的 skipReason 或发布前 full gate 证据 |
| latestAbsorptionExecutionPack | N/A / required / optional；若 required，写 A1~A10 命中项、ownerSkill、validationRoute、skipReason、V82/targeted test 证据 |
| configCanonicalNamespace | N/A / required / optional；若 required，写 canonical namespace、legacy alias、顶层配置例外、迁移/兼容窗口和文档主路径 |
| profileRuntimeContractSync | N/A / required / optional；若 required，写 ProfileImpactCheck、runtime contract、默认行为、README/website/Profile/进度同步证据 |
| behaviorSemanticDocsParity | N/A / required / optional；若 required，写同义/反义承诺矩阵、README/website/API/comparison/scenario/index/search 反查和代码真相源 |
| docsExampleTruthSurface | N/A / required / optional；若 required，写 option/config/method 示例对应 public types、runtime wiring、最小执行探针或 skipReason |
| derivedConsumerRuntime | N/A / required / optional；若 required，写 metrics/info/logs/events/warnings/admin bridge/public types 消费者和失败注入隔离证据 |
| featureInventoryProfile | N/A / required / optional；若 required，写 feature inventory、capability group、Profile/README/website/public API/复审清单同步 |
| memoryCannotSatisfyBootstrap | N/A / required / optional；若 required，写 `MemoryCannotSatisfyBootstrapGate`、navigation-hint 来源、已读取文件真相源、冲突处理、V86/targeted probe 证据 |
| batchEvidenceLedgerState | N/A / required / optional；若 required，写 EvidenceLedger baseline、actualSources、commands、status、finding/skipReason、Progress Card |
| repairCollaboration | N/A / lightweight / full；写 authorizationEvidence、双层字段、contractState、负向样例；full 写 findingToPatchMap / handoffIntegrity / independentReReview |
| postConfirmationReviewScope | N/A / light / full；写触发依据、review-checklist 路径或 skipReason、PR-2~PR-7 证据 |
| developmentDrift | N/A / required；写 allowedFirstBatch、blockedScope、driftTriggers、validationRoute、consumerSync、dirty boundary |
| verificationPlanMaterialization | N/A / required；写验证计划章节、命令/矩阵、验收标准和退出条件 |
| docsIaReadability | N/A / required；写 ChinesePrimaryExpressionGate、SidebarPageRoleMaterializationProbe、SidebarGroupSemanticModelProbe 证据 |
| expertOutputQuality | N/A / required / optional；若 required，写 `roleBaseline`、`productionRecommendedPath`、`frameworkNativeCapability`、`fixtureBoundary`、`antiPatternContrast`、`evidenceMatrix` 与 V84/targeted probe 证据 |
| expertOwnerSkills | N/A / required / optional；若 required，写 `ownerSkill`、`triggerReason`、`requiredFields`、`validationRoute`、`skipReason`、`V85/targeted probe`，覆盖 ProductStrategyOwnerGate / DeveloperExperienceArchitectureGate / UxInteractionArchitectureGate / FrontendArchitectureOwnerGate / BackendDomainArchitectureGate / ProductionReadinessSreGate / ApiContractArchitectureGate / ExternalIntegrationArchitectureGate / PlatformEcosystemArchitectureGate / AiAgentSystemArchitectureGate / DataArchitectureGate / SecurityThreatModelingGate / QualityStrategyGate / DesignSystemArchitectureGate / AccessibilityI18nGate / GrowthAnalyticsGate / BusinessModelReviewGate |
| artifactScaleRouting | N/A / required；写 project/root、六项规模指标、decision、exclusion、batch/checkpoint、invalid-run、V91 |
| historicalCommonNormLayering | N/A / required / optional；若 required，写逐文件审查矩阵、legacy-index-retained、V74、targeted test、public docs 与 deploy copy 证据 |
| databaseRecordMigrationExport | N/A / required / optional；若 required，写记录链、JSON/Extended JSON、insert/upsert、引用完整性和 dry-run |
| findingProbeMatrix | N/A / required / optional；若 required，写 finding 矩阵、失败输入、修复前失败、修复后通过和发布面证据 |
| guardPolicyBypassMatrix | N/A / required / optional；若 required，写 surface/specificity/action/op/namespace 矩阵和负向探针 |
| sideEffectCompatibilityDocs | N/A / required / optional；若 required，写公开主路径、旧路径归档位置和副作用说明 |
| executableExampleTruthProbe | N/A / required / optional；若 required，写最小 parser/compiler/validator 探针和结果 |
| oneOffRequirementScriptPlacement | N/A / required / optional；若 required，写脚本生命周期、落点和长期脚本确认依据 |
| verificationCommandSideEffect | N/A / required / optional；若 required，写 script 定义、read-only/writes-artifacts/mutates-source 分类、生成物扫描和清理证据 |
| requirementPreConfirm | N/A / required / optional；若 required，写行为可验证、范围冲突和 fail-safe 检查 |
| multiPhaseClosure | N/A / required / optional；若 required，写 Phase 2+ 路线、门禁、确认点、进度真相源和最终关闭规则 |
| packageAdapterPreConfirmEvidence | N/A / required / optional；若 required，写 package/plugin/exports/bin/files/dist/registry/消费者入口证据 |
| nativeCommandExitCode | N/A / required / optional；若 required，写 command、shell、cwd、exitCode、auth/config 来源、失败证据排除和 wrapper 传播规则 |
| collectionRelationIdNaming | N/A / required / optional；若 required，写集合/实体命名依据、项目 convention 和消费者影响 |
| userFacingVerificationArtifactLanguage | N/A / required / optional；若 required，写用户当前语言、项目例外和 `.http` / 测试说明语言 |
| verificationScopeBudget | N/A / aligned / under-scoped / over-scoped；写风险匹配依据和降级/减负理由 |
| skippedChecks | |
| skipReason | |
| blockingLevel | |
```

## 跳过规则

- 跳过任何常规验证都必须写 `skipReason`、风险和替代验证。
- API 行为变化不得跳过 `api-verification`。
- 前端/API 文档合同变更不得只更新 Markdown；必须执行 ApiDocVerificationSync，决定是否同步 `.http` / `.cjs` 或记录跳过理由。
- 多语言文档、翻译页、README/website 同步页或正式文档入口变更必须执行 DocumentationTranslationParityGuard 与 FormalDocsDevCodexBoundary；不得把运行时报告、台账口吻或内部待办泄漏到正式文档。
- Prompt、Agent 指令、Hook 输出、MCP 工具描述或 LLM 契约变更必须执行 LLMPromptContractTriage；不得只改文案而漏掉结构化字段、示例、宿主能力边界或 validate/targeted test。
- 代码、文档、示例、fixture、mock、demo、quick start、技术方案或报告面向用户 / 维护者长期消费，或用户指出“不专业 / 像初级 / 示例误导”时，必须执行 `ExpertOutputQualityGate`；不得把测试夹具、硬编码单例、每个 route 重复声明或仅证明底层能力存在的 fixture 当作生产推荐路径，未触发时写 `N/A + skipReason`。
- 数据补齐、迁移或跨环境写入不得直接依赖源环境 `_id` 写目标环境；必须执行 DataMutationPlan，使用目标环境稳定业务键或显式清单唯一匹配，并在 dry-run 证据中列出 `source_id` / `target_id` / 缺失或重复记录。
- 高风险控制面变更不得只运行单个局部检查；至少执行 validate + targeted tests + SCV。
- 验证路线必须执行 VerificationScopeBudgetGate：高风险、控制面、发布、资源生命周期或前端体验不能只跑轻量检查；低风险纯文档、纯计算或无状态改动也不得为了形式引入重压测、E2E 或外部依赖。
- 声明“已验证 / 可运行 / 可点击 / 已发布 / 已安装”前必须执行 LiveVerificationExecutionObligation；未实际执行时只能写阻塞、降级证据和残余风险。
- 项目存在 coverage 脚本、阈值、CI coverage 或发布覆盖率要求时必须执行 CoverageGateDecision；测试断言通过、相关 suite 通过或 `npm test` 部分通过不能自动等价为 coverage gate 通过。
- 外部 runtime、plugin、registry、adapter、provider、injected runtime 或 owner mutation 路径变更必须执行 ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate；至少覆盖 config 组合、生命周期转换、多实例共享、集合代数、批量部分成功和 reset/replace/dispose/clear 证据。
- function source、hash、toString 或 fingerprint 参与 cache key、registry key、checkpoint、幂等或去重时必须执行 FunctionSourceFingerprintMatrixGate；不得只用同一个函数对象或硬编码单例证明稳定性。
- 同一风险簇连续 ≥3 个 finding、返修或复审遗漏时必须执行 ClusterEscalationGate：先分析点状修复为何漏掉风险模型，再冻结矩阵、替换策略和停止条件。
- 声称降低返工率、提升首次通过率或减少复审逃逸时必须执行 `ReworkReductionValueGate` 与 `ReworkEffectivenessLoop`；历史问题、规则文本或本轮实现完成不能替代前瞻效果证据。
- 兼容、迁移、alias/fallback 或历史行为保留必须先执行 `ReleaseAuthorityBeforeCompatibilityGate`；未发布且无稳定消费者时不得为了“兼容”增加无证据分支。
- 新增或调整公开配置必须执行 `ConfigurationErgonomicsGate`；可选字段未做省略探针时不得宣称最小配置可用。
- 链接、按钮、菜单、对话框、可展开控件或自定义交互必须执行 `InteractiveSemanticProbe`；截图、构建成功或 DOM 存在不得替代键盘与焦点证据。
- 迭代修复可执行 RiskBasedValidationLadder：每个微补丁先跑 targeted + related suite；push/release、公共 runtime、构建/测试基础设施、相关 suite 不稳定或用户明确要求时升级 full gate。
- 人工复核、视觉检查、手工冒烟或无法自动化验证必须执行 ManualReviewEvidenceRetention，保留范围、输入、观察结果、截图/日志或等价证据。
- 从需求方原始输入、产品直接提供的完整需求、需求变更、PRD、Word、原型、截图、会议纪要、Bug 报告或用户消息提炼需求/问题时必须执行 ProductRequirementTraceabilityGate，先判定入口类型，保留 `00-需求概况.md` / `01-产品需求.md` / `00-需求变更概况.md` / `00-问题概况.md` / 原始附件来源锚点、`01-需求确认.md` / `01-需求变更确认.md` / `01-问题确认.md` 的 AI 提取口径、产品补充口径、产品原文锚点、双方确认状态和技术验证映射；有产品角色直接交完整需求时，AI / 研发只做缺口 / 冲突检查和澄清，缺口检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不写入产品模板正文，不生成或重写产品需求；不得只提交 AI 整理稿，不得把纯新需求、产品完整需求、需求变更、Bug 问题和产品确认混写，也不得要求需求方或产品额外填写验收标准、测试用例、数据库字段或接口 Schema。
- 本机脚本、联调、数据库/SSH/HTTP 连接或跨环境执行依赖配置时必须执行 LocalExecutionConfigProbe；未指定配置模型时遵循 S02，不得主动新增 env/secret/config.local。
- 人工复核涉及真实数据、外部系统、发布包或联调结果时必须执行 ManualReviewEvidenceDataRetention，写明证据保存位置、样本范围和不可保留原因。
- 用户指定模块、目录、adapter、provider 或文档页时必须执行 AdjacentScopeExpansionGuard；扩相邻范围前要写共同契约、共享缺陷或验证必需性。
- 涉及 npm/GitHub Packages、插件、bin、exports、scope、安装说明或发布名时必须执行 PackageNameAuthorityGate，并以 package/plugin/registry 证据为准。
- 涉及宿主 Memories、模型长期偏好、resume / summary 恢复、Profile / memory bootstrap 或用户询问是否可以靠记忆少读文件时，必须执行 `MemoryCannotSatisfyBootstrapGate`：Memories 只能作为 `navigation-hint`，Profile、daily tasks、SUMMARY、reports、review checklist、源码和文档真相源仍需实际读取；未读取不得写 `loaded/passed/verified`。
- 涉及“最快 / 第一 / 优于 / 性能提升 / 压测 / benchmark”时必须执行 PerformanceBenchmarkFirstGate；没有基线不能声明提升或第一。
- 面向公开模块、SDK、CLI、插件、文档站能力或对外 API 时必须执行 PublicModuleDifferentiationGate，区分公开承诺与内部实现。
- DevCodex v2 一期规划必须执行 V2MCPFirstPlanningGate；无正式 CP1/CP2 方案包时，MongoDB、控制台、多租户自定义工作流和本地规则正文缓存不作为默认范围。
- 扫描 data 目录、吸纳最新问题或裁剪仍需吸纳清单时必须执行 WorkspaceDataAbsorptionScopeGate，覆盖 `.devcodex/*/data/` 全命名空间，并触发 `spec-absorption`。
- 正式流程图、生命周期图、Nxx 节点图或维护者流程页必须执行 FlowchartNodeExplanationGate，图中非终止节点需要中文节点说明。
- 官网、文档站、技术站或正式说明页涉及视觉/交互验收时必须执行 DocsSiteVisualAcceptanceGate，不能只跑构建后宣称“观感通过”。
- 用户要求遗漏专审或只列仍需吸纳项时必须执行 OmissionOnlyReviewGate，最终清单排除已吸纳、已关闭、重复和明确无必要项。
- 审查报告、AI review finding、audit issue 或代码评审发现进入修复范围、建议清单或测试路线前必须执行 ReviewFindingIntakeGate；未补本地证据或未完成分类时不得直接路由为 runtime bug 修复。
- 高风险资源泄漏修复、公开库/adapter/SDK 或连接/监听/定时器/worker/cache 风险命中时必须评估 MethodLevelLeakPressureProbe；低风险任务写 `N/A + skipReason`。
- DevCodex v2 一期进入正式规划、冻结方案或 ISSUE-027 尾项治理时必须执行 V2FormalSolutionPackage，未形成正式 CP1/CP2 包不得宣告范围收敛。
- 新增/升级依赖、框架、SDK、平台 API 或外部模块时，不得只验证“能安装”；必须引用 `OfficialDocsEvidence` 并至少验证一次项目内采用的关键用法。
- 写测试用例或规划回归验证时必须先做 `LeakRiskStabilityPressureTest` 判定；若变更涉及长运行进程、高并发/高频路径、缓存/队列/连接池、文件/流/socket、事件监听器、定时器、worker、订阅、前端组件生命周期，或来自 `PE-12 资源生命周期与泄漏风险` / 性能稳定性问题，不得只写单元测试，必须把场景/负载/稳定性验证纳入 TestRoute，或写明 `N/A + skipReason`。
- 涉及前端页面、组件、控制台、官网、文档站、可视化工具、游戏或用户可见 UI / 交互时必须执行 `FrontendExperienceQualityGate` 判定；命中视觉或交互风险时不得只跑构建/单测，必须纳入 Browser/截图、Playwright/E2E 或项目等价视觉/交互验证，无法运行时记录阻塞与降级证据。
- 前端浏览器验证必须先执行 `FrontendBrowserVerificationBudgetGate`；用户明确“我自己验证 / 不要浏览器 / 不要截图 / 不要模拟交互”时执行 `UserSelfVerificationOverrideGate`，不得再主动启动 Browser/CDP/Playwright/截图，除非用户重新要求恢复。
- 涉及 Figma/截图/既有页面还原、局部视觉修复、资源优化或 UI 回归时必须执行 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate` 与 `UIStateScopeRegressionGate`；不得用 mock 页面、错误 target、静态截图或非授权视觉改动替代真实验收。
- UI/Figma/截图修复前必须执行 `VisualDeviationTypeGate` 与 `DesignFramePurposeClassificationGate`；不得未分类偏差就重写布局，也不得把邮件模板、banner、素材、示意页或旧稿当作前端页面验收目标。
- 涉及设计资产进入生产或多语言运行时验证时必须执行 `FigmaProductionAssetBudgetGate` 与 `RuntimeI18nArtifactVerificationGate`；不得只复制大图或只 grep 源 JSON 后宣称通过。
- 实际执行本地 `git commit` 前必须执行 `ExplicitCommitAuthorizationGate`；没有用户明确授权时只能建议 commit，不能自动提交。
- 兼容修复、共享库/adapter/SDK 或上游契约判断必须执行 `CompatibilityAndContractAuthorityGate`；不得用影子 allowlist、历史报告或内部 helper 替代官方/public API 证据。
- UI 确认源覆盖旧 PRD、公开文档描述未发布能力、集合关系 id 命名或用户可见验证产物语言变化时，分别执行 `UIConfirmedSourceConflictTraceGate`、`PublicDocsReleasedVersionGate`、`CollectionRelationIdNamingGate` 与 `UserFacingVerificationArtifactLanguageGate`。
- R2+ 复审、audit 连续零发现、ECR 或遗漏专审必须执行 `ReviewDimensionDeltaGate`；不得把同一组维度和同一批文件重复检查后直接计入有效零发现。
- README、官网/文档站、接口说明、运行手册、需求/方案等面向使用者的人读文档必须执行 `UserPerspectiveDocsGate`；README、站点文档、文档站、quick start、接入手册或配置文档还必须执行 `UserDocsImmediateComprehensionGate` 与 `UserDocsPrimarySurfaceGate`，验证功能完整性、配置易懂性、即时理解路径和用户主面；文档新增/调整命令、配置项、字段、状态、路径、能力承诺或阅读顺序时必须执行 `DocsConsumerSweep`。
- 公开用户文档、快速上手、教程、配置/扩展/框架接入指南必须执行 `PublicUserDocsMaintainerBoundaryGate`；最终回复或完成报告存在多个相邻任务时必须执行 `ActiveRequirementFinalResponseGate`。
- 需求修订、再次复审或从修复清单回写真相源时必须执行 `RequirementVerdictStateSyncGate`，将状态元信息和 sessions / SUMMARY 作为验证对象。
- 数据库配置、模板、模块注册、权限、字典或推送配置等跨环境迁移必须执行 `DatabaseRecordMigrationExportGate`；不得只交单条记录或截图说明。
- 外部审查、AI review finding、audit issue 或代码评审的 must-fix 项必须执行 `FindingProbeMatrixGate`；guard/policy/permission/consistency 类修复必须执行 `GuardPolicyBypassMatrixGate`。
- 公开文档中的旧兼容路径必须执行 `SideEffectCompatibilityDocsGate`；DSL/parser/validator/exporter/配置/模板示例必须执行 `ExecutableExampleTruthProbeGate`。
- 新增脚本前必须执行 `OneOffRequirementScriptPlacementGate`；验证命令执行前必须执行 `VerificationCommandSideEffectGate`。
- docs/需求类 CP1 推荐确认前必须执行 `RequirementPreConfirmGate`；分阶段需求必须执行 `MultiPhaseClosureGate`；package/adapter/SDK/CLI 方案确认前必须执行 `PackageAdapterPreConfirmEvidenceGate`。
- 输出 ArtifactLinkSet 前必须执行 `ArtifactLinkSetDedupeGate`，按 canonical path 去重同一物理文件的相对链接、绝对链接和 copy fallback，避免宿主文件面板展示成双份产物。
- 规范吸纳、data 台账治理、用户确认“值得吸纳”的策略或新增门禁时必须先读取 `spec-absorption`，执行 `CommonNormGeneralizationGate` 和 `AbsorptionCandidateConsumerProofGate`，再执行 `LayeredAbsorptionGate` 和 `SkillFirstAbsorptionGate`；若判定 `new-skill-required`，TestRoute 至少覆盖新 Skill frontmatter、plugin 注册、路由说明、promptTemplate、executionConsumer、validationProbe、publicDocs 和 deployCopy；若采纳用户原方案，必须记录 `ProactiveBetterAlternativeGate` 的独立验证依据。
- 历史通用规范、prompt/report 长清单、旧吸纳项或跨版本规范资产重新分层时必须执行 `HistoricalCommonNormLayeringGate`；进入实施前先创建逐文件审查矩阵，验证路线至少包含 targeted tests、`node scripts/validate.js`、public docs、deploy copy 和 ProfileImpactCheck。
- 用户文档站、README、docs-first 最终手册、前端/API 对接契约或公开能力交付必须优先触发 `user-manual-authoring` 并执行 `UserFacingDeliveryChainGate`；最终用户手册、文档站 IA、流程/失败处理和队列/任务类真实批量工作流分别执行 `FinalUserManualFirstGate`、`DocsSiteInformationArchitectureGate`、`UserManualFlowAndFailureGate`、`QueueDocsRealWorkflowGate`。
- 用户要求用户侧文档 review、项目文档审查、菜单导航、sidebar、文档设计或信息架构审查时必须触发 `audit-user-manual`；TestRoute 写明是否需要生成站点、链接/TOC/sidebar 检查、Browser/截图、人工复核或 N/A。
- 长链路 fix/audit、外部 finding 批次或冻结 Review Checklist 后必须触发 `review-checklist`，执行 `ReviewChecklistCompletenessGate`、`EvidenceExecutionGate` 与 `ReviewEscapeRecordGate`；每项没有可复现证据时不得宣告通过，发现遗漏时不得跳过 `whyMissed / prevention / rerunEvidence`。
- runtime/adapter/SDK/CLI/module-format/exports/bin/files/dist/tsc 输出变化必须执行 `BuiltArtifactFeatureSmokeGate` 与 `TscOutputImportProbe`；不得只用源码测试或 root export smoke 替代构建产物 feature path。
- 文档站/官网导航、footer、sidebar、outline、手写 TOC、语言切换或公开能力页首次成功路径变化必须执行 `GeneratedSiteGate`、`ManualTocDuplicationGate` 与 `UserPathContractSweep`，以当前构建产物或真实预览为准。
- 性能敏感项目或已有 benchmark 基线的 hot path 修改必须执行 `BenchmarkRegressionGuard` 判定；跳过代表性 benchmark 需写 `N/A + skipReason`、风险和替代证据。
- 消费者验证出现与当前改动无关的依赖、插件、共享库或框架适配失败时，不得直接改源码；必须先执行 ConsumerDependencyTreeProbe，确认 package.json / lockfile / node_modules / `npm ls <关键依赖>` 一致后再进入源码修复。
- adapter、provider、connector、SDK 或性能 benchmark 变更必须执行 AdapterBenchmarkAttribution，报告基线、环境、版本、负载、归因边界和不可比较因素。
- 项目事实变化时必须执行 `ProfileImpactCheck`；若跳过 Profile 更新，报告需要写 `skipReason`。
- 按 `ConcurrencyPolicy`，只读准备和隔离验证可并行；release / pack / package boundary / benchmark / codegen 任务不得并行运行会写入 `dist` 的命令与包边界检查；必须记录 PackageBoundarySerialCheck，并在最终报告说明无关 dirty 文件和验证残留已清理。
- 发布、pack、install smoke、CLI replay、curl/git/npm/node 或 PowerShell/Bash wrapper 验证必须执行 `NativeCommandExitCodeGate`：PowerShell 需检查 `$LASTEXITCODE` 或等价 wrapper，Bash 需避免管道/子命令吞失败；报告 command、shell、cwd、exitCode 和 auth/config 来源。只打印成功文案但未传播非零退出码的验证无效。
- DevCodex 源仓维护脚本可把 `scripts/lib/checked-command.js` 作为 NativeCommandExitCodeGate 的默认可执行适配器；TestRoute 仍须列出 nonzero、ENOENT、失败短路、literal positional glob 和合法 glob option 的负向/正向 fixture，不得只验证 happy path。
- `PublisherCredentialTopologyGate` 与命令退出码是两个独立证据面：前者证明 publisher/auth/secret scope/package ownership 拓扑，后者证明真实命令执行；任一缺失都不能替代另一项。
- scoped package 的双 registry 验证必须追加 `ScopedRegistryResolutionGate`：仅有 `--registry` 不足以覆盖 `.npmrc` 的 `@scope:registry`；TestRoute 必须保留 scope override、配置来源和两通道独立解析证据。
- 多轮复审的 clean/closed 验证必须执行 `ChecklistStateMaterializationGate`：构造“主表已更新但 Progress Card 陈旧”的负向样例和六区块一致的正向样例；没有重开当前清单并核对 snapshot 时不得增加 streak。
- 高风险控制面 / 多批次修复必须写出 `regressionChecks`：逐项列出历史能力、必跑验证、对应批次和失败回滚点。
- 宿主契约、visible reply、sticky project 或 workspace guard 变更，不得只写“`npm test` 已过”；必须写明 direct replay / fixture replay / validate probe 的证据来源。
- 任何验证路线若由 AI 启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，完成前必须执行 `ServiceLifecycleCleanup`：只停止本轮 AI 启动的进程，核验 PID/job 或端口释放，并在 TestRoute/报告记录证据；不得杀用户既有进程。
- `npm run test:all` 失败时不得宣告完成，除非回 CP2 明确降级并有替代证据。
- 有远端 CI 的项目进入 tag / release / publish 前，不得只写本地测试通过；必须记录目标 commit 对应远端 CI run 的状态，无法查询时写 `N/A + skipReason` 或阻断正式动作。

## 报告要求

dev/fix/optimization/scenario-test 报告应包含 TestRoute 或明确 `N/A`，ECR-3/ECR-4 应引用实际执行结果。若命中宿主验证，还应同时引用 `host-contract-verification` 的 HostContractRoute 结果。
