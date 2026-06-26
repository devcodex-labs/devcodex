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
| 数据补齐 / 迁移 / 跨环境写入 | DataMutationPlan：显式清单或稳定业务键、dry-run、唯一匹配、缺失/重复清单 | 只读数据库真相源查询、最终消费者响应字段验证 |
| Prompt / Agent / Hook / MCP 契约 | LLMPromptContractTriage：区分人读说明、模型指令、结构化输出字段和宿主能力边界 | validate probe、targeted test、direct/fixture replay |
| 前端体验 | FrontendExperienceQualityGate：判定设计来源、UI 还原度、风格主题一致性、响应式/状态覆盖、用户流、交互反馈、输入方式/可访问性、错误恢复、动效转场和视觉验证 | lint/typecheck/test、Browser/截图、Playwright/E2E 或人工复核证据；纯后端/CLI/文档写 `N/A + skipReason` |
| Figma / 高保真 UI 还原 | FigmaHighFidelityRestorationGate、ScopedVisualChangeGate、InstalledPluginVisualVerificationGate：冻结设计来源、allowedScope/frozenScope、元素分类和可用插件验证链 | Browser/Chrome/Figma 插件、截图对比、人工复核；无插件时写降级证据 |
| 真实预览 / mock fallback | ActualPreviewChainAndMockFallbackGate、FrontendRuntimeNetworkProbeGate、UIStateScopeRegressionGate：确认真实 preview URL、API target、路由入口、构建产物、console/network/failed requests、资源 404、hydration/runtime error 与受影响状态清单 | 不得用 mock、错误 target、临时服务、静态截图或构建成功冒充用户页面通过 |
| Figma 生产资产 / 运行时 i18n | FigmaProductionAssetBudgetGate、RuntimeI18nArtifactVerificationGate：记录资产尺寸/体积/格式/来源/public 路径，核对源 JSON、构建合并产物和页面残留 key | WebP/SVG 内嵌位图检查、runtime page check、fallback 说明 |
| 资源生命周期 / 泄漏稳定性风险 | LeakRiskStabilityPressureTest：判定是否需要场景/负载/稳定性压测，命中时记录 heap/RSS、active handles、监听器、连接数、缓存规模或项目等价指标的基线、压力过程、冷却后回落与清理证据 | 纯计算、静态文档、一次性脚本或无长生命周期资源变更可写 `N/A + skipReason` |
| 本地服务验证 | ServiceLifecycleCleanup：记录启动命令、cwd、PID/job、端口/URL，并在验证完成、失败或最终回复前关闭仅由 AI 启动的服务 | 用户明确要求保留服务时，记录保留原因、PID/端口/URL 与关闭方式 |
| 人工复核 / 手工验证 | ManualReviewEvidenceRetention：记录复核人/时间/范围/输入/观察结果/截图或日志位置 | 不得只写“人工检查通过”；无法留截图时写等价证据 |
| 验证范围预算 / 真实执行 | VerificationScopeBudgetGate、LiveVerificationExecutionObligation：验证强度匹配风险，声明已验证前实际执行命令、页面、接口、pack/install、registry/tag 查询或等价验证 | 降级必须写阻塞原因、替代证据和残余风险 |
| 发布 / package | `audit-release`、`release-verification`、`npm run test:audit`、package completeness gate、远端 CI 绿色（如存在）、pack dry-run；PackageBoundarySerialCheck：pack / boundary 检查必须在 build / benchmark / codegen 完成后单独串行执行 | pack install smoke、publish dry-run、无关残留文件清理复核 |
| 消费者验证 / 跨仓库验证 | ConsumerDependencyTreeProbe：先核对 `package.json`、lockfile、`node_modules` 与 `npm ls <关键依赖>`，排除依赖树漂移 | 源码补丁、共享库升级、消费者 lockfile 恢复 |
| Adapter / provider benchmark | AdapterBenchmarkAttribution：记录基线、环境、版本、负载、归因边界和不可比较因素 | 避免把框架、网络、缓存预热、依赖树或测试环境差异误归因给业务代码 |
| 产品需求整理 / 产品完整需求 / 需求迁移 / 需求变更 | ProductRequirementTraceabilityGate：先记录入口类型；无产品角色的纯新需求记录 `00-需求概况.md` / PRD / Word / 原型 / 截图 / 消息锚点、`01-需求确认.md` 的 AI 提取口径、产品补充口径、冲突/遗漏处理、双方确认状态和技术验证映射；有产品角色直接提供完整需求时记录 `01-产品需求.md`、产品原文锚点、AI / 研发缺口 / 冲突检查、澄清状态和技术验证映射，缺口检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不写入产品模板正文，也不生成或重写产品需求；需求变更记录 `00-需求变更概况.md`、原需求基线、变更前后差异、`01-需求变更确认.md`、目标需求真相源回写和技术验证映射；Bug 问题记录 `00-问题概况.md` / `01-问题确认.md` 并走 fix | 不得把 AI 摘要当唯一真相源；不得混写需求方输入、产品完整需求、需求变更和产品确认；不得把 Bug 当产品需求；需求方和产品不填写验收标准，验证映射由技术方案 / 测试方案派生 |
| 本机 / 跨环境执行配置 | LocalExecutionConfigProbe：核对项目指定配置入口、Profile `config.local.json` 模型或既有脚本约定；未指定时遵循 S02 | 不得为了安全感臆造 env/secret/config.local |
| 人工证据留存 / 真实联调 | ManualReviewEvidenceDataRetention：记录证据保存位置、可复核输入、样本范围、保留策略和不可保留原因 | 证据不能进入仓库时写明外部位置或不可保留理由 |
| 指定范围防扩散 | AdjacentScopeExpansionGuard：核对用户指定模块/目录/adapter/provider 与相邻范围修改理由 | 无共同契约、共享缺陷或验证必需时不得扩相邻范围 |
| 包名 / 发布名 / 安装说明 | PackageNameAuthorityGate：核对 `package.json`、`plugin.json`、registry/包管理器证据、bin/exports/scope | 禁止凭历史记忆或目录名判断包名 |
| 性能第一 / benchmark | PerformanceBenchmarkFirstGate：先冻结基线、环境、版本、指标、负载、比较对象和成功阈值 | 缺少基线不得宣称提升、最快或第一 |
| 公开模块 / SDK / CLI / 插件 | PublicModuleDifferentiationGate：区分 public API、内部 helper、示例代码、发布包文件、消费者入口和历史镜像 | 正式文档只承诺真实公开面 |
| DevCodex v2 一期路线 | V2MCPFirstPlanningGate：核对 Intent-Gated Hosted Spec MCP、Codex-only MVP、私有可追踪 docs 和无本地规则正文缓存边界 | MongoDB/控制台/多租户自定义工作流默认不进一期 |
| data 吸纳 / 最新问题扫描 | WorkspaceDataAbsorptionScopeGate：扫描 `.devcodex/*/data/` 全命名空间，列出命中台账、候选编号、归属和跳过理由 | 不得只扫当前源码项目、当前 active-root 或 sticky activeProject |
| 正式流程图 / 生命周期图 | FlowchartNodeExplanationGate：Mermaid/Nxx 流程图配套中文节点说明，覆盖触发、前置、动作、出口、异常 | 临时草图写 `N/A + skipReason` |
| 文档站视觉 / 交互验收 | DocsSiteVisualAcceptanceGate：覆盖主题集成、真实点击、异步动效、减弱动态、代码 token 对比度、终端 demo 范围、TOC inline code、辅助导航层级 | 纯内容页可降级为链接/构建/人工证据 |
| 遗漏专审 / 只列仍需吸纳项 | OmissionOnlyReviewGate：只输出此前未覆盖且仍有价值项，保留已吸纳/排除理由和覆盖增量 | 不得把已吸纳、已关闭或没必要项重新列入最终清单 |
| 审查发现 intake | ReviewFindingIntakeGate：外部审查报告、AI review finding、audit issue 或代码评审发现进入修复/建议前，先补本地证据并分流 must-fix、用户决策、文档实现漂移、测试缺口、未复现或设计如此 | 不得把报告结论直接当验证证据；公共契约或兼容风险源码修改前先确认 |
| 方法级泄漏压测 | MethodLevelLeakPressureProbe：公开方法、adapter/SDK、连接池、监听器、定时器、worker/cache 风险命中时评估重复调用或生命周期压测 | 低风险纯函数写 `N/A + skipReason` |
| v2 一期正式方案包 | V2FormalSolutionPackage：冻结 CP1/CP2，覆盖架构、数据模型、MCP API contract、instruction return、可见性、cache/signature/rollback、Codex-only 验证、Registry/Marketplace、维护站和 Mermaid 节点 | 未完成前不得宣告 v2 一期收敛 |
| 提交授权 / 公开文档版本 | ExplicitCommitAuthorizationGate、PublicDocsReleasedVersionGate：实际 commit 必须有用户明确授权；公开文档不得把未发布能力写成已发布历史或迁移负担 | commit 证据、release/unreleased 边界、preview 标识 |
| 兼容契约 / 命名 / 产物语言 | CompatibilityAndContractAuthorityGate、CollectionRelationIdNamingGate、UserFacingVerificationArtifactLanguageGate：核对消费者零代码兼容、上游 public API、关系 id 命名和 `.http` / 测试说明语言 | 官方/源码/registry 证据、命名 convention、用户语言证据 |
| 复审维度增量 | ReviewDimensionDeltaGate：R2+ 复审、audit 连续零发现、ECR 或遗漏专审必须记录 PreviousDimensionSet、CurrentDimensionFocus、NewDimensionRationale、RepeatedDimensionReason | 不得每轮机械重复同一组维度；重复维度须有阻断项回归、高风险锚点、新证据或抽样理由 |
| 用户视角文档 | UserPerspectiveDocsGate：README、官网/文档站、接口说明、运行手册、需求/方案等人读文档从使用者角度验证详细度、字段解释、首次成功路径、心智负担和排错恢复 | 纯内部临时报告或维护者专用文档写 `N/A + skipReason` |
| 公开用户文档维护边界 | PublicUserDocsMaintainerBoundaryGate：公开用户文档不得把维护者验收、发布 checklist、内部同步清单、台账状态或实现者复审任务放进用户主路径 | 迁移到 CONTRIBUTING、release checklist、requirements/report 或 maintainer-only 文档 |
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
| highFidelityUi | N/A / required / optional；若 required，写设计来源、allowedScope/frozenScope、Figma/截图还原、插件验证链和偏离理由 |
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
- 数据补齐、迁移或跨环境写入不得直接依赖源环境 `_id` 写目标环境；必须执行 DataMutationPlan，使用目标环境稳定业务键或显式清单唯一匹配，并在 dry-run 证据中列出 `source_id` / `target_id` / 缺失或重复记录。
- 高风险控制面变更不得只运行单个局部检查；至少执行 validate + targeted tests + SCV。
- 验证路线必须执行 VerificationScopeBudgetGate：高风险、控制面、发布、资源生命周期或前端体验不能只跑轻量检查；低风险纯文档、纯计算或无状态改动也不得为了形式引入重压测、E2E 或外部依赖。
- 声明“已验证 / 可运行 / 可点击 / 已发布 / 已安装”前必须执行 LiveVerificationExecutionObligation；未实际执行时只能写阻塞、降级证据和残余风险。
- 人工复核、视觉检查、手工冒烟或无法自动化验证必须执行 ManualReviewEvidenceRetention，保留范围、输入、观察结果、截图/日志或等价证据。
- 从需求方原始输入、产品直接提供的完整需求、需求变更、PRD、Word、原型、截图、会议纪要、Bug 报告或用户消息提炼需求/问题时必须执行 ProductRequirementTraceabilityGate，先判定入口类型，保留 `00-需求概况.md` / `01-产品需求.md` / `00-需求变更概况.md` / `00-问题概况.md` / 原始附件来源锚点、`01-需求确认.md` / `01-需求变更确认.md` / `01-问题确认.md` 的 AI 提取口径、产品补充口径、产品原文锚点、双方确认状态和技术验证映射；有产品角色直接交完整需求时，AI / 研发只做缺口 / 冲突检查和澄清，缺口检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不写入产品模板正文，不生成或重写产品需求；不得只提交 AI 整理稿，不得把纯新需求、产品完整需求、需求变更、Bug 问题和产品确认混写，也不得要求需求方或产品额外填写验收标准、测试用例、数据库字段或接口 Schema。
- 本机脚本、联调、数据库/SSH/HTTP 连接或跨环境执行依赖配置时必须执行 LocalExecutionConfigProbe；未指定配置模型时遵循 S02，不得主动新增 env/secret/config.local。
- 人工复核涉及真实数据、外部系统、发布包或联调结果时必须执行 ManualReviewEvidenceDataRetention，写明证据保存位置、样本范围和不可保留原因。
- 用户指定模块、目录、adapter、provider 或文档页时必须执行 AdjacentScopeExpansionGuard；扩相邻范围前要写共同契约、共享缺陷或验证必需性。
- 涉及 npm/GitHub Packages、插件、bin、exports、scope、安装说明或发布名时必须执行 PackageNameAuthorityGate，并以 package/plugin/registry 证据为准。
- 涉及“最快 / 第一 / 优于 / 性能提升 / 压测 / benchmark”时必须执行 PerformanceBenchmarkFirstGate；没有基线不能声明提升或第一。
- 面向公开模块、SDK、CLI、插件、文档站能力或对外 API 时必须执行 PublicModuleDifferentiationGate，区分公开承诺与内部实现。
- DevCodex v2 一期规划必须执行 V2MCPFirstPlanningGate；无正式 CP1/CP2 方案包时，MongoDB、控制台、多租户自定义工作流和本地规则正文缓存不作为默认范围。
- 扫描 data 目录、吸纳最新问题或裁剪仍需吸纳清单时必须执行 WorkspaceDataAbsorptionScopeGate，覆盖 `.devcodex/*/data/` 全命名空间。
- 正式流程图、生命周期图、Nxx 节点图或维护者流程页必须执行 FlowchartNodeExplanationGate，图中非终止节点需要中文节点说明。
- 官网、文档站、技术站或正式说明页涉及视觉/交互验收时必须执行 DocsSiteVisualAcceptanceGate，不能只跑构建后宣称“观感通过”。
- 用户要求遗漏专审或只列仍需吸纳项时必须执行 OmissionOnlyReviewGate，最终清单排除已吸纳、已关闭、重复和明确无必要项。
- 审查报告、AI review finding、audit issue 或代码评审发现进入修复范围、建议清单或测试路线前必须执行 ReviewFindingIntakeGate；未补本地证据或未完成分类时不得直接路由为 runtime bug 修复。
- 高风险资源泄漏修复、公开库/adapter/SDK 或连接/监听/定时器/worker/cache 风险命中时必须评估 MethodLevelLeakPressureProbe；低风险任务写 `N/A + skipReason`。
- DevCodex v2 一期进入正式规划、冻结方案或 ISSUE-027 尾项治理时必须执行 V2FormalSolutionPackage，未形成正式 CP1/CP2 包不得宣告范围收敛。
- 新增/升级依赖、框架、SDK、平台 API 或外部模块时，不得只验证“能安装”；必须引用 `OfficialDocsEvidence` 并至少验证一次项目内采用的关键用法。
- 写测试用例或规划回归验证时必须先做 `LeakRiskStabilityPressureTest` 判定；若变更涉及长运行进程、高并发/高频路径、缓存/队列/连接池、文件/流/socket、事件监听器、定时器、worker、订阅、前端组件生命周期，或来自 `PE-12 资源生命周期与泄漏风险` / 性能稳定性问题，不得只写单元测试，必须把场景/负载/稳定性验证纳入 TestRoute，或写明 `N/A + skipReason`。
- 涉及前端页面、组件、控制台、官网、文档站、可视化工具、游戏或用户可见 UI / 交互时必须执行 `FrontendExperienceQualityGate` 判定；命中视觉或交互风险时不得只跑构建/单测，必须纳入 Browser/截图、Playwright/E2E 或项目等价视觉/交互验证，无法运行时记录阻塞与降级证据。
- 涉及 Figma/截图/既有页面还原、局部视觉修复、资源优化或 UI 回归时必须执行 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate` 与 `UIStateScopeRegressionGate`；不得用 mock 页面、错误 target、静态截图或非授权视觉改动替代真实验收。
- 涉及设计资产进入生产或多语言运行时验证时必须执行 `FigmaProductionAssetBudgetGate` 与 `RuntimeI18nArtifactVerificationGate`；不得只复制大图或只 grep 源 JSON 后宣称通过。
- 实际执行本地 `git commit` 前必须执行 `ExplicitCommitAuthorizationGate`；没有用户明确授权时只能建议 commit，不能自动提交。
- 兼容修复、共享库/adapter/SDK 或上游契约判断必须执行 `CompatibilityAndContractAuthorityGate`；不得用影子 allowlist、历史报告或内部 helper 替代官方/public API 证据。
- UI 确认源覆盖旧 PRD、公开文档描述未发布能力、集合关系 id 命名或用户可见验证产物语言变化时，分别执行 `UIConfirmedSourceConflictTraceGate`、`PublicDocsReleasedVersionGate`、`CollectionRelationIdNamingGate` 与 `UserFacingVerificationArtifactLanguageGate`。
- R2+ 复审、audit 连续零发现、ECR 或遗漏专审必须执行 `ReviewDimensionDeltaGate`；不得把同一组维度和同一批文件重复检查后直接计入有效零发现。
- README、官网/文档站、接口说明、运行手册、需求/方案等面向使用者的人读文档必须执行 `UserPerspectiveDocsGate`；文档新增/调整命令、配置项、字段、状态、路径、能力承诺或阅读顺序时必须执行 `DocsConsumerSweep`。
- 公开用户文档、快速上手、教程、配置/扩展/框架接入指南必须执行 `PublicUserDocsMaintainerBoundaryGate`；最终回复或完成报告存在多个相邻任务时必须执行 `ActiveRequirementFinalResponseGate`。
- 输出 ArtifactLinkSet 前必须执行 `ArtifactLinkSetDedupeGate`，按 canonical path 去重同一物理文件的相对链接、绝对链接和 copy fallback，避免宿主文件面板展示成双份产物。
- 消费者验证出现与当前改动无关的依赖、插件、共享库或框架适配失败时，不得直接改源码；必须先执行 ConsumerDependencyTreeProbe，确认 package.json / lockfile / node_modules / `npm ls <关键依赖>` 一致后再进入源码修复。
- adapter、provider、connector、SDK 或性能 benchmark 变更必须执行 AdapterBenchmarkAttribution，报告基线、环境、版本、负载、归因边界和不可比较因素。
- 项目事实变化时必须执行 `ProfileImpactCheck`；若跳过 Profile 更新，报告需要写 `skipReason`。
- 按 `ConcurrencyPolicy`，只读准备和隔离验证可并行；release / pack / package boundary / benchmark / codegen 任务不得并行运行会写入 `dist` 的命令与包边界检查；必须记录 PackageBoundarySerialCheck，并在最终报告说明无关 dirty 文件和验证残留已清理。
- 高风险控制面 / 多批次修复必须写出 `regressionChecks`：逐项列出历史能力、必跑验证、对应批次和失败回滚点。
- 宿主契约、visible reply、sticky project 或 workspace guard 变更，不得只写“`npm test` 已过”；必须写明 direct replay / fixture replay / validate probe 的证据来源。
- 任何验证路线若由 AI 启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，完成前必须执行 `ServiceLifecycleCleanup`：只停止本轮 AI 启动的进程，核验 PID/job 或端口释放，并在 TestRoute/报告记录证据；不得杀用户既有进程。
- `npm run test:all` 失败时不得宣告完成，除非回 CP2 明确降级并有替代证据。
- 有远端 CI 的项目进入 tag / release / publish 前，不得只写本地测试通过；必须记录目标 commit 对应远端 CI run 的状态，无法查询时写 `N/A + skipReason` 或阻断正式动作。

## 报告要求

dev/fix/optimization/scenario-test 报告应包含 TestRoute 或明确 `N/A`，ECR-3/ECR-4 应引用实际执行结果。若命中宿主验证，还应同时引用 `host-contract-verification` 的 HostContractRoute 结果。
