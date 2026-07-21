# DevCodex

> AI 开发规范注入器 — 从 Copilot / Claude Code 双主支持升级为 Copilot / Claude Code / Codex 三宿主支持（Hook-First / Instruction-Fallback）

[![npm](https://img.shields.io/badge/npm-%40vextjs%2Fdevcodex-blue)](https://github.com/vextjs/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

## DevCodex 是什么？

DevCodex 默认通过 `.github/`（Copilot）、`CLAUDE.md + .claude/ + .mcp.json`（Claude Code）以及 `AGENTS.md + .agents/ + .codex/`（Codex）注入结构化工作流；v1.15.2 还提供显式 Gemini / Grok adapter，五宿主共享同一精简内核、按需 Skills 与完整回退真相源。
在支持 Hooks 的宿主中，它优先用 `hooks/_runtime/lifecycle.cjs` 提供确定性的生命周期护栏；在不支持 Hooks 的宿主中，则回退到 instructions 语义层继续工作。

## 目录导航

- [DevCodex 是什么？](#devcodex-是什么)
- [功能特性](#功能特性)
- [5 分钟快速开始](#5-分钟快速开始)
- [安装](#安装)
- [使用](#使用)
- [正式需求与执行模板边界](#正式需求与执行模板边界)
- [默认执行原则](#默认执行原则)
- [CLI 命令](#cli-命令)
- [`.devcodex` 工作区集中布局（v1.10.0+）](#devcodex-工作区集中布局v1100)
- [Profile 计划、生成与升级](#profile-计划生成与升级)
- [意图驱动的上下文读取（v1.15.2）](#意图驱动的上下文读取v1152)
- [项目侧执行链性能与稳定回滚（v1.15.2）](#项目侧执行链性能与稳定回滚v1152)
- [本地开发](#本地开发)
- [架构概览](#架构概览)
- [客户端支持矩阵（Client Support Matrix）](#客户端支持矩阵client-support-matrix)
- [IDE 兼容性](#ide-兼容性)
- [文档](#文档)
- [边界声明](#边界声明)
- [Tier 说明](#tier-说明)
- [Agent 入口](#agent-入口)
- [许可证](#许可证)

## 功能特性

- **8 种工作流**: `dev` / `fix` / `audit` / `analyze` / `self-fix` / `resume` / `plan` / `chat`
- **2 种模式**: 确认模式（@DevCodex）/ 全自动模式（@DevCodex Auto，Auto v1.1 对显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `extensions.devcodex.autoAliases` 替换别名或明确自然语言 auto 授权 + 白名单路径提供硬保证）
- **合规管线**: FC（形式合规）→ SC（实质合规）→ RC（恢复性检查）→ T（任务完成验证）
- **持久记忆**: 每 Agent、每日的会话记录，结构化字段
- **自动报告**: 每次会话自动写入报告，从不询问 — 直接执行
- **安全底线**: S01~S07 七条不可覆盖的安全规则
- **宿主生命周期护栏**: Claude Code 与 OpenAI Codex 在已支持的 Hook 事件上提供 runtime 护栏；Copilot / JetBrains / Cursor 等无等价本地 Hook 时降级为 instruction-fallback；默认 `safety-only` 仅对危险命令硬拦，流程项提醒放行，`strict` 模式才升级可阻断事件
- **长任务 Turn Liveness**: `TurnLivenessRecoveryGate` 记录 `running / awaiting-continuation / suspect / stalled-recoverable / terminal` 状态、工具租约、continuation ACK、双阶段 checkpoint 与当前 turn 的 `LocalTaskTraceV1`；Hook 只能在事件到达时判断历史停滞，trace replay 只返回数据，不能自行唤醒宿主、执行 payload、重放写操作或把 `PostToolUse` 当成任务完成
- **全模式入口检查**: 所有模式在实质任务前显示 PC0~PC7；dev 模式额外执行 PC4 规范雷达与完整合规链
- **项目现实扩展**: 先做语义意图初判，再结合目标项目 Profile、目录与当前任务上下文修正最终路由、产物落点和验证方式
- **任务名续接与增量执行链（v1.15.2）**: 新会话只需发送 `继续<任务名>任务`；系统通过稳定 task identity 有界定位，再复证 sessions/CP/产物。Context、validation DAG、Profile/Skill 与 ProjectKnowledge 可按内容身份增量执行，并由 `full-only` kill switch 保留完整正确路径
- **可配置并发策略**: Profile `config.json` 可配置 `extensions.devcodex.concurrency`；默认 `auto` 表示只读准备和隔离验证可并行、共享状态写入保持单写者，保守项目可设为 `serial`
- **文件真相源优先的有界启动链**: `MemoryCannotSatisfyBootstrapGate` 要求宿主 Memories、模型长期偏好、SUMMARY 或交接卡只能作为 `navigation-hint`；新线程、resume、summary 恢复或跨项目切换仍须通过 Profile plan、memory status/query 与 handoff 指向的精确 reports/review checklist/source 复证。V86 防止用内置记忆替代文件真相，V99 防止把复证误写成默认全文读取或失败调用假完成。
- **支撑型 Skill**: `execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync` 为控制面、多批次、测试路线、宿主契约验证与真相源-消费者同步提供可审计支撑，不新增工作流分支
- **模型无关双层修复协作契约**: AI 判断任务目标为 repair task 时至少建立 `lightweight` 决策/验收层 + 执行/验证层契约；P0/P1、安全、控制面、公共契约、多批次、角色交接或发布风险升级 `full`，用 `findingToPatchMap`、`handoffIntegrity` 与 `independentReReview` 防止范围漂移和补丁作者唯一自证。模型名称或是否切换 Agent 不是触发条件
- **修复完成与返工效果分层**: active `repair-prevention-assessment` 是所有 repair 的默认完成门禁，强制分离当前关闭证据与长期前瞻计划；gray `rework-prevention-engineering` 仅在返工率、重复逃逸簇或效果验证时使用，以 WorkUnit/ReworkEvent、FirstPassYield 和 prospective trial 判断是否值得晋级。active 工作流不依赖默认不部署的 gray Skill。`CandidateDiffCompletenessGate` 在 commit/tag/publish 前用 staged candidate snapshot 覆盖 tracked/untracked，并执行 cached diff、name-status、secret-shape 与 intended scope 对账；普通 working diff 不能替代。派生资产另由 `PostStageDerivedArtifactFreshnessGate` 在完整 stage 后读取 Git index，并在 commit 后 clean tree 复放，防止“先生成、后新增消费者”逃逸。`ReviewCoverageClaimIntegrityGate`、`ArtifactDeliveryManifestGate`、`VisibleOutputHostEvidenceGate`、`ReleaseAuthorityBeforeCompatibilityGate`、`ConfigurationErgonomicsGate` 与 `InteractiveSemanticProbe` 分别约束审查真实性、内部交付对账、用户可见证据、兼容判断、配置易用性和交互语义
- **跨仓消费者验证**: `consumer-validation-engineering` 以 RepositoryBinding、SourceConsumerIdentity、ValidationDenominatorMatrix、packed artifact、跨仓 CI 与 freshness drift 约束 SDK/CLI/框架/公共包的独立消费者仓；`DesignFitnessGate` 额外判断主路径、默认值、配置层级、框架约定和维护成本，`ValidationFindingRepairLoop` 在 source mutation 后使旧 identity/证据 stale 并按影响矩阵重跑。realpath、行为全绿或单一 100% 分母不能冒充完整验证。该 Skill 保持 `gray`，由 V95 正负探针守门
- **品牌视觉资产质量（gray 试用）**: `brand-visual-quality` 用母版谱系、主题几何 parity、微尺寸光学校正、单色母版、`VisualEvidencePack` 与 blocker reset 管理 logo/icon 等品牌资产生产；文件存在、构建成功或单张截图不能替代同画布证据与人工结论。当前只完成结构化 V97/前向试用证据，仍需真实 WorkUnit 才能晋级 active
- **发布前审查与关键路径治理**: `audit-release` 负责 release readiness、说明、兼容、包与发布风险；`release-verification` 执行 R0~R7，并以 `ReleaseEfficiencyControlGate` 的 `CandidateFreezeGate`、`ReleaseCriticalPathBudgetGate`、`ValidationEvidenceReuseGate` 管理候选 generation、预算和证据失效。pack/install smoke 额外执行 `IsolatedConsumerCwdGate`：显式 consumer manifest、真实 consumer cwd、source identity 前后对账；禁止用 `npm init --prefix` 冒充 cwd 隔离。无可比较基线时预算只能 advisory，不能削弱 version/pack/registry/R7
- **长任务墙钟预算与授权**: `execution-contract` 的 `ExecutionBudgetGate`、`ExternalWaitAccountingGate`、`LongTaskAuthorizationGate` 要求 Auto/多批次/长 resume 冻结 `maxWallClock` 与 cycle 预算，等人/外部等待不计入执行预算，用户「继续」必须新 cycle；`report`/`compliance` 同步 `WorkspaceSyncStatus`、`CompletionEvidenceGate` 与条件 `PostDeliverySelfCheck`
- **审计与修复授权分离**: `AuditMutationBoundaryGate` 规定 audit 只写报告、audit-state、记忆和运行态台账；任何源码/规范/配置/测试/文档/部署副本修复都需用户显式授权后进入独立 fix/self-fix，audit 不自动改源、`git add` 或继承修复权限
- **分析与用户文档能力**: `analyze-default` / `analyze-research` 承接分析与调研；`user-manual-authoring`、`audit-user-manual`、`readme-authoring` 和 `audit-readme` 收口站点文档 / README / quick start 的用户路径、信息架构、配置排错和真实工作流。声称场景完整时必须执行 `ScenarioCoverageMatrixProbe`；队列/批处理还要执行 `DurableBatchOrchestrationProbe`，页面或关键词存在、一次 `addBulk`、进程内 callback 都不能替代持久 run、故障恢复与 executable evidence
- **专家型产物质量能力**: `expert-output-quality` 负责代码、文档、示例、fixture、quick start、技术方案和报告的专家型输出质量；`ExpertOutputQualityGate` 要求先给生产推荐路径、框架原生能力和项目既有能力，再说明 fixture/mock/demo 边界、反模式和证据矩阵。V84 探针会阻止把测试夹具、硬编码单例或每个 route 重复声明包装成生产推荐实践。
- **操作、代码事实与唯一推荐**: 面向用户或维护者的操作说明使用 `OperationExplanationContractV1`；重要方案/报告使用 `CodeTruthEvidenceMatrixGate` 和 `SolutionFitAgainstRepoGate` 绑定 repo path、symbol、currentBehavior、negativeProbe、gap、reusePoint、consumer、rollback 与 statusQuoCost；收敛后由 `UniqueRecommendationBeforeConfirmGate` / `NoPreferenceMenuAfterConvergenceGate` 保证只有一个推荐方案或明确组合。
- **专家 Owner Skill 能力**: 21 个专家 Owner Skill 分别承接产品策略、开发者体验、UX 交互、前端架构、后端领域架构、生产可用性 / SRE、API 契约、外部集成、平台生态、AI Agent 系统、数据架构、安全威胁建模、质量策略、设计系统、无障碍/国际化、增长分析和商业模型；`growth-analytics` 与 `business-model-review` 为 P3 条件触发，未命中时写 `N/A + skipReason`；`ExpertOwnerSkillGate` 要求报告 ownerSkill、triggerReason、requiredFields、validationRoute、skipReason 和 V85/targeted probe 证据，避免“专家视角”只停留在泛泛口号。
- **复审清单能力**: `review-checklist` 负责正式复审、ECR、发布前复审、多轮收敛和外部 finding 批次的清单创建、范围冻结、逐项证据执行、遗漏逃逸分析、状态新鲜度和收敛关闭；`PostConfirmationReviewScopeGate` 要求 CP 确认后按风险选择轻量或全面复审；`ReviewEscapeRecordGate` 要求发现遗漏时先在清单写入 `whyMissed / prevention / checklistPatch / rerunEvidence`，再补清单和重跑验证；`ChecklistStateMaterializationGate` 在 clean/closed 前核对 header、items、round、ledger、progress、closure 六区块一致快照
- **范围、契约与阶段语义守门**: `DevelopmentDriftGate`、`CurrentBatchScopeDiffProbe` 与 `NewValidationConsumerRebindProbe` 约束当前批次及新增 CI/validator/deploy 消费者；`ContractVariantIsolationMutationGate` 以 sibling-field injection 和 completion-evidence deletion 防止合同假绿；`PhaseDeliverySemanticGate` 区分 planning coverage 与 source delivery；文档 IA 仍由 `ChinesePrimaryExpressionGate`、页面角色与 sidebar 语义探针约束。上述剩余吸纳控制由 V96 正负探针守门
- **基座准入与复杂度预算**: 新增或晋级规范、Skill、Prompt、流程、验证器或部署消费者先走 `BaseImpactAssessmentV1`、`ComplexityDeltaBudgetV1` 与 `UnaffectedIntentRegression`；必须证明真实消费者、defaultPathDelta、fallback/rollback、`replacementOrRetirementCredit` 和退役/删除条件，避免后续能力继续侵入稳定基座或让普通任务默认变重。V96 覆盖 base-neutral / base-compatible / base-changing 负样本。
- **Skill 缺口与生命周期能力**: `skill-gap-analysis` 负责 `ProjectArtifactScaleRoutingGate`，`skill-lifecycle-governance` 负责 portfolio 生命周期；`distributed-systems-architecture`、`performance-engineering`、`privacy-compliance-architecture`、`ai-evaluation-engineering` 为新增专业 Owner，V85/V91 守门。
- **自我进化治理能力**: `evolution-governance` 负责自我进化、自动吸纳、模型辅助规范优化、自动补 Skill / Prompt / Probe 和自动治理候选的控制面，执行 `EvolutionCapabilityControlPlaneGate`，冻结授权、模型配置、租户 / 权限、配额、数据边界、审计、回滚和发布审批；模型输出只能进入候选态，不能直接写 active 规范或发版
- **Profile 新鲜度审查**: audit 会先执行 `Profile Freshness Check`，反向核对 Profile 是否仍匹配当前包版本、目录资产、脚本、发布状态、宿主能力和任务现实
- **Profile 真相对账**: `ProfileTruthReconciliationGate` 由 `load-profile` 统一承接；项目级 analyze 使用 targeted 模式，audit 使用 full/PFresh 模式并反查 repo shape 与 Profile 档位/生命周期文件。`ProfileTruthMatrix` 记录声明、实际来源、漂移分类、结论权威和修订路线；只读工作流只矫正结论，不直接修改 Profile。V88 提供正负向同步探针。
- **授权本地安全审查呈现**: `AuthorizedLocalSecurityAuditPresentationGate` 由 `security-threat-modeling` 承接，分离用户可见最小证据和隔离本地探针；内容不可见或额外安全检查发生时保存 `SafetyInterruptionCard` 并从文件真相/审查状态恢复，不把表达调整描述成绕过平台控制。V89 验证授权、证据预算与恢复链。
- **发布凭据拓扑**: `PublisherCredentialTopologyGate` 由 `release-verification` 承接；首次发布或 publisher/repository/package/registry/auth topology 变化时核对发布身份、secret scope/access/inheritance、workflow permission、package ownership 和最近成功 run。只验证拓扑，不读取或输出 secret value；普通 patch 可记录 unchanged evidence。V90 与 R0~R7 共同守门。
- **scoped registry 目标解析**: `ScopedRegistryResolutionGate` 由 `release-verification` 承接；scoped package 双仓发布必须同时冻结 global registry、`@scope:registry`、userconfig 与命令级 override，用隔离配置或显式 scope override 证明两通道独立解析。V92 与 targeted fixture 防止相同 scope 路由制造双仓假阳性。
- **Profile 生成与三档闭环校验**: `ProfileGenerationContractGate` 统一 `profile-lite` / `profile-standard` / `profile-closed-loop` 的生成、加载、状态和校验契约；`FeatureInventorySchemaGate` 要求新生成的规范功能清单使用 `FeatureInventorySchemaV2` 并兼容读取 V1，分离生命周期、证据状态、日期与引用；`ProfileTierMigrationSafetyGate` 保证 plan/dry-run 零写入、升级保留正文、降档显式授权；`ProfileTierStandardGate`、`ProfileLifecycleClassificationGate` 与 `AllDevCodexProfileValidationGate` 继续负责档位、生命周期和全工作区校验
- **项目工程泄漏审查**: 项目工程 / 代码质量审查执行 `PE-12 资源生命周期与泄漏风险`，必须检查内存泄露、资源泄漏、监听器/定时器/连接/流未释放、缓存无界增长和组件卸载清理缺失
- **泄漏风险稳定性压测**: 写测试用例或回归验证时先执行 `LeakRiskStabilityPressureTest` 条件判定；命中长运行、高并发、缓存/连接/监听器/定时器/流/socket/worker/订阅/组件生命周期或 `PE-12` 风险时，TestRoute 纳入场景/负载/稳定性压测并记录基线、冷却后回落和资源指标前后对比；低风险任务写 `N/A + skipReason`
- **coverage 与外部 runtime 生命周期验证**: 项目存在 coverage 阈值、CI coverage 或发布覆盖率要求时执行 `CoverageGateDecision`，区分断言通过与覆盖率门禁通过；外部 runtime/plugin/registry/adapter/provider、injected runtime、owner mutation 或 function source fingerprint 风险执行 `ExternalRuntimePluginLifecycleGate`、`ExternalRegistryLifecycleMatrixGate`、`FunctionSourceFingerprintMatrixGate`、`ClusterEscalationGate` 与 `RiskBasedValidationLadder`
- **前端体验质量门禁**: 前端页面、组件、控制台、官网、文档站、可视化工具或游戏任务执行 `FrontendExperienceQualityGate` 条件判定，覆盖设计来源、UI 还原度、风格主题、响应式状态、视觉验证、用户流、交互反馈、输入方式/可访问性、错误恢复和动效转场；Figma/截图/既有页面还原追加 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate`、`VisualDeviationTypeGate` 与 `DesignFramePurposeClassificationGate`；浏览器验证先执行 `FrontendBrowserVerificationBudgetGate`，用户明确自验或禁止浏览器/截图时执行 `UserSelfVerificationOverrideGate`；命中时 TestRoute 纳入 Browser/截图、Playwright/E2E、console/network/resource/runtime、代码级替代验证或人工复核证据
- **复审覆盖增量与维度增量**: audit / review / ECR 的连续零发现必须附 `ReviewCoverageDelta`（覆盖面增量）与 `ReviewDimensionDeltaGate`（维度焦点增量），优先阅读此前未审查但相关联的代码、配置、测试、文档、部署副本和消费者链，并避免每轮机械重复同一组维度；无新增覆盖、无新增维度焦点且无证据化理由时，不计入有效零发现
- **规范治理 Intake**: 所有模式下每条用户消息在合理性评估后都会额外检查是否命中可泛化改进；命中时主动写入 `data/process-improvements.md`（优化清单，PI），必要时联动 `data/pending-fixes.md`（PF），并显式回执 `PI/PF`
- **规范吸纳执行能力**: `spec-absorption` 负责最新可吸纳、仍需吸纳和 `.devcodex/*/data` 候选扫描，先执行 `CommonNormGeneralizationGate` 与 `AbsorptionCandidateConsumerProofGate`，证明通用规范价值、剔除项目独有残留、绑定 DevCodex 当前消费者和 targetOwner，再进入分层实现与验证；`ServiceSpecReadGate` 等项目私有规则只作负向样例，不吸纳为通用规范
- **最新吸纳执行包 A1~A10**: 最新可吸纳清单确认实施时，`LatestAbsorptionExecutionPack` 按 `GovernanceGateRegistry` 分组同步配置 canonical namespace、Profile/runtime contract、行为语义与负向翻译、示例与 callback 真相面、派生消费者与失败注入、FeatureInventoryProfileGate / FeatureChecklistEvidenceMatrixGate、BatchEvidenceLedgerStateGate / BatchProgressCardGate，并用 V82 探针核对 Skill、Prompt、TestRoute、report、README/website/changelog、Profile、部署副本和来源台账回写
- **分层吸纳架构（兼容 Skill-first 吸纳架构）**: 规范吸纳、data 台账治理、用户确认可泛化建议或新增门禁时，先执行 `LayeredAbsorptionGate`，并兼容 `SkillFirstAbsorptionGate` / `CapabilityToSkillPromotionGate`；输出 `LayeredAbsorptionDecision`（含 `SkillAbsorptionDecision`），逐层覆盖通用指令、Skill、prompts/templates、执行消费者、validate/test 探针、README/website/changelog 和部署副本。采纳用户建议前同步执行 `ProactiveBetterAlternativeGate`，有更优方案必须先提出取舍；采纳用户纠正时执行 `AcceptedSuggestionRootCauseGate`，报告 whyMissed、采纳依据、台账编号和防复发动作
- **历史通用规范分层迁移**: 迁移此前已堆入通用 instructions、prompt、report 模板或 README 的规范时执行 `HistoricalCommonNormLayeringGate`，先冻结逐文件审查矩阵，再按 `targetLayer / targetOwner / semanticStrength / validation / skipReason` 下沉到 Skill、Prompt、执行消费者、V74/V75 validate 探针、公开文档和部署副本；`PromptLongGateListDriftProbe` 会用 SCV 负向样例防止旧 Gate 长清单回流，当前 README、website 和 prompts 只写 `GovernanceGateRegistry` 分组与代表锚点；无法立即下沉的旧规则只保留为 `legacy-index-retained`，不再作为新增长清单容器
- **完整吸纳补强门禁**: 用户确认“未完整吸纳 / 半覆盖 / 仍需吸纳”时执行 `ConfirmedAbsorptionCompletenessGates`，按 `public-surface / user-manual / review-checklist / frontend-runtime / profile-service / release-parity / evolution-control-plane` 分组补齐 Skill、Prompt、执行消费者、探针、公开文档和部署副本；代表锚点包括 `PublicSurfaceClosureGate`、`UserManualProductizationGate`、`ReviewAnchorMaterializationGate`、`FrontendAsyncCacheRenderGate`、`RemoteCIParityPushGate`、`NativeCommandExitCodeGate` 与 `DocsThemeRuntimeVisualProbeGate`
- **Backlog 真相复核与状态回写**: 从 `data/*.md` open/partial 项组织新需求或新批次前，先按 `pure-open / residual-tail / already-fixed / misclassified` 分类；实施后再执行台账状态回写闭环，避免“源码已修但 backlog 仍旧 open”
- **官方文档证据前置**: 新增或升级依赖、框架、SDK、平台 API、外部模块前，CP2 会要求 `OfficialDocsEvidence`，记录官方文档来源、关键用法、限制与兼容性，避免凭经验猜 API
- **通用工程守门**: Node.js 项目默认不低于 `>=18`；需求/问题定义前置平台工程判断，并记录 `ImplementationComplexityLevel`，开发程度分为 `简单够用 / 中等 / 企业级`，用户未要求复杂化或需求不详细时默认 `简单够用`；依赖/兼容任务拆分业务源码平滑性与依赖层落地条件；包/库/adapter/CLI 同查代码层与包工程层；JS/Node 必要注释使用标准 JSDoc；简单 service 不重复 route/model/schema 已承担的校验
- **跨项目经验吸纳守门**: 字段/本地化/状态新增前执行 `ExistingDomainContractAudit`，业务策略常量执行 `ConfigOwnershipMatrix`，接口文档合同执行 `ApiDocVerificationSync`，数据迁移执行 `DataMutationPlan`，值得吸纳建议执行 `AbsorptionDecision`，完整首版执行 `FullV1ScopeGuard`，启动优化执行 `StartupPhaseTrace`；新增吸纳项先走 `LayeredAbsorptionGate` / `SkillFirstAbsorptionGate`，再按 `GovernanceGateRegistry` 分组记录 `gateGroup / ownerSkill / validationRoute / skipReason`；代表锚点包括 `CodeTruthRequirementGate`、`ManualReviewEvidenceRetention`、`ReviewFindingIntakeGate`、`UserDocsPrimarySurfaceGate`、`ActiveRequirementFinalResponseGate`、`MethodLevelLeakPressureProbe`、`BenchmarkRegressionGuard` 与 `V2FormalSolutionPackage`
- **验证卫生与包边界**: release / pack / benchmark / codegen 任务中，package boundary check 必须在构建完成后单独串行执行；公开打包脚本执行 `PackagedScriptDependencyClosureGate`，递归核对本地 helper、spawn 目标脚本和运行时依赖进入 tarball；pack/publish/install smoke、CLI replay 和 curl/git/npm/node/PowerShell/Bash wrapper 必须记录真实 command/shell/cwd/exitCode，不能用成功文案替代原生命令退出码；消费者验证异常先查 package.json、lockfile、node_modules 与 `npm ls <关键依赖>`，收尾前清理无关 dirty 文件和验证残留
- **ProfileImpactCheck**: dev/fix 改动项目技术栈、目录、脚本、测试/发布路线、分发面、配置或长期连接时，会主动判定是否需要更新 Profile；无需更新时也要写明跳过理由
- **敏感信息与硬编码策略**: 默认允许敏感信息、明文连接信息和硬编码出现在用户要求的代码、脚本、配置、文档、测试或报告中；只有用户 / 项目明确禁止时才脱敏、占位或改用 env、`secretRef`、secret manager、`config.local.json`
- **AI 自启动服务清理**: AI 为验证启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target 后，验证完成、失败或最终回复前会主动关闭仅由 AI 本轮启动的服务并核验端口释放；用户要求保留时会记录 PID/端口和关闭方式
- **变更日志分层**: 未发布实现变更写 `changelogs/unreleased.md`，已发布详情统一归档到 `changelogs/releases/vX.Y.Z.md`，目录说明见 `changelogs/README.md`
- **执行闭环复审**: dev/fix 完成前执行 ECR 执行闭环复审，交叉验证 CP 产物、报告、daily memory、SUMMARY、diff/commit、测试/探针与 dirty 边界
- **推荐结论**: analyze/audit/report 多建议或多路径场景必须给出推荐结论与推荐理由；无后续动作时明确写“推荐：无后续动作”
- **对比调研门禁**: 用户问“是否应该 / 哪个更好 / 有没有更好建议 / 推荐什么”且结论会影响时间、金钱、架构、产品/项目路线或长期维护成本时，先执行 `QuestionEvidenceGate`；技术路线、架构优化、性能优化、框架能力设计或高维护成本方案在 CP1 最终需求确认前执行 `TechnicalRouteComparativeGate`；必要时比较同类产品 / 项目 / 本仓库相似模块，普通低风险问答可标 `ComparativeResearchGate: N/A + skipReason`
- **确认交互降级**: 用户确认先抽象为 ConfirmationRequest，再按宿主能力选择按钮、权限提示、Hook 阻断或文本确认 fallback，不把按钮 UI 承诺为全宿主能力
- **执行护栏**: 新需求切换时优先按意图判断边界；涉及外部平台/API/兼容性判断时优先看官方文档；提交时压缩 commit subject

## 5 分钟快速开始

先区分两个版本概念：npm package 的当前发布版本是 **v1.15.2**；文档站的 **1.0.1** 是活动需求文档版本，不是可安装包版本。

| 通道 | 当前状态 | 用途 |
|---|---|---|
| GitHub Packages | ✅ v1.15.2 | 当前唯一发布通道；安装需要 GitHub Packages `read:packages` 认证 |

1. 确认 CLI 运行时（文档站维护另需 Node `^20.19.0 || >=22.12.0`）：

```bash
node --version # CLI 需要 Node.js >=18
```

2. 配置 GitHub Packages registry 与认证：

```ini
@vextjs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

当前 shell 的 `NODE_AUTH_TOKEN` 需使用具备 `read:packages` 的 GitHub PAT。

3. 安装当前 v1.15.2：

```bash
npm install @vextjs/devcodex
```

4. 在目标项目（或已启用 workspace-namespace 的任一子项目）初始化并验证：

```bash
npx @vextjs/devcodex init
npx @vextjs/devcodex status
```

成功时，普通仓库会在项目根看到三套当前宿主面；workspace-namespace 则统一出现在工作区根，子项目保持零 generated host artifacts。安装返回 401/403 时，检查 `.npmrc` 的 scope registry、PAT 的 `read:packages` 权限和当前 shell 的 `NODE_AUTH_TOKEN`。

## 安装

以下是当前 v1.15.2 的完整安装说明。当前版本仅发布到 GitHub Packages，安装需要读取认证。

### 1. 配置 GitHub Packages

```bash
# 创建 .npmrc（推荐使用环境变量注入 GitHub PAT，避免把 token 写入仓库或本地文件）
echo "@vextjs:registry=https://npm.pkg.github.com" >> .npmrc
echo "//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}" >> .npmrc
```

```bash
# 当前 shell 注入 PAT（需具备 read:packages；发布时还需 write:packages）
export NODE_AUTH_TOKEN=YOUR_GITHUB_PAT
```

这里的环境变量仅用于 GitHub Packages 认证流程，不代表项目里的普通配置默认都应 env 化；未明确要求 env 时，AI 不得主动把明文或硬编码改成 env、`secretRef`、secret manager 或 `config.local.json`。

> v1.15.2 未发布到 npmjs；缺少上述 registry 或读取认证时，安装不会自动回退到其他通道。

### 2. 安装并初始化

```bash
npm install @vextjs/devcodex@1.15.2
npx @vextjs/devcodex init          # 默认三宿主部署：Copilot + Claude Code adapter + Codex adapter
npx @vextjs/devcodex init --claude # 仅 Claude Code adapter
npx @vextjs/devcodex init --codex  # 仅 Codex adapter
```

v1.15.2 包含通用宿主选择器；本地源码验证时也可直接使用：

```bash
node index.js init --host gemini
node index.js init --host grok
node index.js init --host all       # 显式部署 Copilot / Claude / Codex / Gemini / Grok
```

默认 `init` 会先解析宿主资产 owner：普通仓库使用项目根，workspace-namespace 使用工作区根。随后在该 owner 下部署 Copilot `.github/`、Claude Code adapter（`CLAUDE.md + .claude/ + .mcp.json`）与 Codex adapter（`AGENTS.md + .agents/ + .codex/`）：

```
.github/
├── copilot-instructions.md  ← 默认 Copilot always-on 总则（新增）
├── instructions/   ← Instructions 约束（15 个，含全部工作流规则）
├── agents/         ← Copilot 自定义 Agent（v1.9.8 起恢复默认分发）
├── skills/         ← v1.15.2 Skill 详细检查标准（81 个，按需读取，含 active `repair-prevention-assessment`、默认分析、用户文档、用户侧文档 review 聚合、专家型产物质量、21 个专家 Owner Skill、复审清单、自我进化治理、README 专项能力、spec-governance、spec-absorption 与支撑型 Skill）；其中 78 active，`rework-prevention-engineering`、`consumer-validation-engineering`、`brand-visual-quality` 3 个 gray；用户可见输出、宿主指令投影与修复评估拆分能力已纳入当前包
├── prompts/        ← Prompt 模板（30 个）
├── hooks/          ← 宿主生命周期 Hook 配置与运行时
│   ├── devcodex.lifecycle.json
│   └── _runtime/
├── data/           ← 运行时数据模板
└── RULES.md        ← 使用入口
```

Codex adapter 会同步以下工作区根产物：

```
AGENTS.md                 ← 由 instructions.md 确定性生成的共享精简内核
.agents/
├── devcodex/instructions.full.md ← 非 always-on 的完整规范回退
└── skills/               ← Skill 详细检查标准（与源仓库 skills/ 同步）
.codex/
├── hooks.json            ← Codex Hook 入口配置
└── hooks/_runtime/       ← 统一 lifecycle.cjs 运行时及 helper 模块
```

`init --claude` 是 Claude Code-only 路径：只向解析后的宿主 owner 写入 `CLAUDE.md`、`.claude/{instructions,skills,prompts,hooks/_runtime,mcp,data}` 与 `.mcp.json`，并同步 hooks / MCP / permissions 配置。

`init --codex` 是 Codex-only 路径：只向解析后的宿主 owner 写入 `AGENTS.md`、`.agents/skills/` 与 `.codex/{hooks.json,hooks/_runtime}`。若 owner 根已有非空 `AGENTS.md` 或 `.codex/hooks.json` 且内容不同，CLI 会先把备份写入 active-root 的 `.tmp/backups/`，再覆盖为 DevCodex 受管副本。

`init/update` 还会在当前 active runtime root 写入 `managed/deployment-manifest.json`。命令先预览 `add/update/unchanged/stale/unowned`：`stale` 只报警，不会自动删除；`unowned` 表示目标受管子树中从未进入 manifest 的文件（例如用户自有 `.codex/config.toml`），不会被接管。workspace-namespace 下 manifest 写入 `.devcodex/<project-or-workspace>/managed/`，不会另建平行运行态根。

workspace-namespace 的共享真相与宿主 adapter 都由工作区拥有。Grok 使用工作区非自动发现 source `.grok/devcodex/plugins/devcodex-workspace`：CLI 只通过 Grok 官方本地插件命令登记这个 source，root 与子 Git 项目因此都只看到一个 user-installed plugin identity；root kernel 仍由工作区 `AGENTS.md` 原生加载。旧 `.grok/plugins/devcodex-workspace` 会在新安装验证成功后可逆移动到 active-root backup，用户级 `~/.grok/config.toml` 只精确维护受管 `plugins.enabled`，并移除新旧 owner 的受管 `plugins.paths` 值。从子项目执行 `update --host grok` 时 owner/manifest 仍是工作区根，子项目不会生成 `AGENTS.md`、`.grok/`、`.codex/`、`.claude/` 或 `.gemini/`。由于 Grok passive Hook stdout 不进入提示上下文，子 Git 项目的完整 kernel 保证通过 `devcodex grok` 调用官方 `--rules` 提供；plain child 只承诺插件发现与 best-effort resolver Skill。项目本地 adapter 仅用于显式 `--project-portable` 模式。

> ⚠️ 请确保 IDE 的 "Use Instruction Files" 设置已开启（默认开启）。
>
> ℹ️ Copilot 路径当前以 instruction-fallback 作为公开能力口径；若目标 IDE 支持 Workspace Hooks 且未被管理员禁用，DevCodex 会加载 `.github/hooks/*.json` 作为额外生命周期护栏，但不把它计入 Full 等级承诺。不支持 Hooks 的宿主自动回退到 instruction-fallback。
>
> ℹ️ `v1.9.8` 起，`devcodex init/update` 已恢复 Copilot 端 `.github/agents/` 默认分发；Claude Code 端仍通过 Skills 路由，不分发 agents。

## 使用

标准安装后，Copilot 会通过 `copilot-instructions.md` + `.github/` 自动加载；Claude Code 会通过 `CLAUDE.md` + `.claude/` + `.mcp.json` 自动生效；Codex 会通过工作区根 `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json` 生效。正式支持链都无需额外选择 Agent，直接对话即可：

```
帮我重构 user 模块的权限校验逻辑
→ 自动识别为 dev 工作流 → CP1 需求确认 → CP2 方案确认 → CP3 实施计划 → 执行 → ECR 执行闭环复审 → 完成

这个接口返回 500 了
→ 自动识别为 fix 工作流 → 根因分析 → 修复方案 → 执行 → 三步扫描 → ECR 执行闭环复审 → 完成

深度审查一下这个项目的代码质量
→ 自动识别为 audit 工作流 → 多轮收敛审查 → 输出报告

继续P0项目侧执行链性能优化任务
→ 有界定位同名任务 → 复证 sessions/CP/当前产物 → 从最后 accepted 批次继续
```

标准安装路径下，无需也不依赖 `@DevCodex`；`.github/agents/` 作为 Copilot 端可选显式入口随默认安装分发。`v1.9.0` 起，Hook 运行时也随 `init/update` / `init --claude` 分发到目标项目，不再要求从 `node_modules/@vextjs/devcodex/...` 读取 Hook 脚本。

## 正式需求与执行模板边界

当前仓库的正式需求信源是 `website/docs/versions/v1/<active-version>/requirements/`，版本内的 `index/design/plan/progress/decisions` 都以这里为准。

`prompts/*.prompt.md` 不是当前项目的正式需求入口，而是 CP1 / CP2 / CP3 的默认执行模板：它们负责约束 AI 如何先区分无产品角色的纯新需求、有产品角色直接提供的完整产品需求、需求变更和 Bug 问题，再生成需求概况、产品需求、需求变更概况、问题概况、需求确认、技术方案、实施计划、实施进度与关键决策。若项目已经定义自定义 requirement 规范，则项目规范优先，prompt 只提供通用骨架。

默认职责边界如下：

- CP1：先判定入口类型；无产品角色 / 研发兼产品时，纯新需求把用户/运营/老板/客户/内部使用方的原始诉求独立保留为 `00-需求概况.md`，再由 AI 生成 `01-需求确认.md` 草稿并由产品补充归一化；有产品角色直接提供完整需求时，使用 `01-产品需求.md` / `product-requirement.prompt.md`，该模板正文只给产品填写完整 PRD，AI / 研发缺口 / 冲突检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不生成或重写产品需求；需求变更使用 `00-需求变更概况.md` / `01-需求变更确认.md` 并回写目标需求真相源；Bug 问题使用 `bugs/<问题>/00-问题概况.md` / `01-问题确认.md` 并进入 fix 工作流
- 需求方模板可读性：`00-需求概况.md` 面向非产品 / 非研发需求方，必须使用口语化问题收集“希望系统做到什么、现在怎么凑合处理、必须遵守的业务口径、希望出现 / 不能接受的例子和材料”；允许填写“没有 / 不知道 / 暂无 / 需要产品帮忙整理”，不得用抽象字段名替代解释
- CP2：确认实现流程、节点职责、公共契约、兼容性策略、边界问题与测试策略
- CP3：确认实施顺序、里程碑、验证方式、风险与回滚
- 执行后正式阶段：ECR 执行闭环复审（确认实现、关键产物、报告、记忆、SUMMARY、diff/commit、测试与完成结论一致）

当需求属于契约驱动型场景（例如对外 API、前端联调接口、页面/组件契约）时，可在 CP2 前先冻结目标文档，再让技术方案与实施围绕该文档落地。

文档能力边界如下：

- 轻量 API 文档：给调用方看的阅读型接口说明
- 前端接口文档：给前端联调使用的接口说明，额外包含页面/模块/前置条件与字段映射
- `api-verification`：给开发与回归使用的归档级接口验证双产物（`.http + .cjs`）

## 默认执行原则

- **意图优先**：当用户看起来切到新需求时，先基于上下文判断意图；只有意图不清晰时才用关键词辅助，而不是反过来。
- **入口检查全模式显示**：无论 `prod` 还是 `dev`，都会先展示 PC0~PC7；`prod` 只显示基础状态，`dev` 追加规范雷达、合规检查和完成验证。
- **项目现实扩展再路由**：识别用户意图后，会先加载目标项目 Profile，并用项目技术栈、目录结构、当前需求上下文修正最终工作流，避免只按字面关键词执行。
- **Intent Expansion Card**：非 chat 工作流会在 CP1 / 问题确认前形成可审查卡片，记录项目、连续性、模块领域、风险、宿主能力、验证路线、置信度和备选路线。
- **Intent Expansion 可见性**：dev 模式默认会直接展示完整 Card；prod、instruction-fallback 宿主或低风险轻任务才退化为 3~5 行摘要。
- **意图扩展摘要**：当扩展后路由变化、命中控制面/宿主差异、风险较高或跨会话恢复时，会在用户面输出 3~5 行摘要，便于确认“为什么这样路由”。
- **Context Rehydration Contract**：压缩恢复、resume 或用户要求按文件真相重建时，会按“当前用户消息 → 已确认产物 → sessions → tasks → SUMMARY → 摘要 → AI 推断”的优先级恢复上下文，摘要不能覆盖文件真相源。
- **ContextHandoffCard**：跨会话、跨 Agent、多批次、summary/compact 前或用户要求传递上下文时，会把 source-of-truth、confirmed decisions、open risks、next action、must-not-overwrite、validation state 与 canonical artifact identities 写入报告或 daily tasks；恢复时仍按 Context Rehydration Contract 重新核对文件真相源。这些恢复证据进入 internal manifest，默认不占用最终用户交付列表。
- **SimpleTaskFastPath**：非常明确、预计 ≤2 文件、无公共契约/配置/发布/控制面/台账来源/高风险、无需多轮跟踪的简单 dev/fix 任务，可免建 `00-需求概况.md` / `00-需求变更概况.md` / `00-问题概况.md` / `01-需求确认.md` / `01-产品需求.md` / `01-需求变更确认.md` / `01-问题确认.md` / `04-实施计划.md`，改用内联 CP 摘要 + 报告/记忆 `N/A + skipReason`；范围扩大时立即升级回完整产物链。若已有需求/bug 真相源，命中 `ExistingRequirementArtifactOverride`，调整内容必须先回写文件，回复只做摘要。
- **ArtifactDecisionMatrix**：CP1/CP2/CP3/ECR 会按任务规模列出关键产物的 `create` / `update` / `skip` / `N/A` 状态，覆盖入口类型、需求概况、产品完整需求、需求变更概况、问题概况、需求确认、需求变更确认、问题确认、技术方案、实施计划、实施进度、关键决策、目标文档、报告和记忆；判定优先级为已有真相源回写 > 任务触发条件 > SimpleTaskFastPath > 子类型豁免，避免模板“必填”口径压过轻路径或条件触发。
### 产物文件链接兼容

- 用户可见产物先形成内部完整 manifest，再投影最小必要文件集；session、daily、SUMMARY、task state、raw receipt/manifest/ledger 默认不显示，但继续写入和参与 ECR。
- 链接由 `LinkCapabilityDecisionV1` 按当前 surface 证据选择 clickable/portable/plain/failed；可点击语义链接不重复绝对路径，只有用户要求、链接失败、工作区外、歧义或无法定位时才显示 fallback。
- **Hook closure 三态**：Stop/PreCompact 可见回复验证区分 `verified-present`、`verified-missing`、`unverified`；无法解析最终 assistant 内容时只提示无法验证，并给出 payload capture 指引，不再断言“未输出”。
- **长流程执行契约**：Auto、控制面、多批次、预计修改 ≥10 文件或发布前置任务会触发 ExecutionContract；测试路线不明显时触发 TestRoute；正式发版前触发 ReleaseAudit 与 ReleaseVerification；控制面消费链联动时建立 Concept Sync Map；宿主契约变化时触发 `host-contract-verification`。
- **修复协作分级**：`repair-collaboration` 由修复语义和风险触发，不由 Sol/Ultra 等模型名触发；低风险可内联 lightweight，高风险必须 full，并禁止从 executing 直接跳到 accepted。
- **执行期 CP3 回退**：若执行过程中实际修改范围扩展到 CP3 门槛（≥5 文件、高风险、控制面联动），必须暂停执行并先补做 CP3，再继续改动。
- **边界先确认**：若已判断为新需求切换，且当前工作区还有未提交变更，会先提醒是否应先提交当前变更。
- **报告推荐项**：当报告中存在多个可执行建议或后续路径时，会明确给出推荐结论和推荐理由；没有建议时也会写明“推荐：无后续动作”。
- **确认交互适配**：ConfirmationRequest 是确认语义的统一抽象，不要求 runtime 逐字输出同名对象；Claude Code SDK / VS Code 扩展可用按钮，Hook 宿主可用阻断原因，Cursor / JetBrains 等 fallback 宿主使用文本确认。
- **高联动默认联查**：当任务涉及控制面规则、模板、接口契约/验证产物、工作区真相源/部署副本或发布口径变更时，会默认联查相关文件；若同时命中多真相源同步或模板-示例-校验链，会升级为交叉验证或 `CRS`。
- **Backlog Intake 真相复核**：若本轮需求、bug 或批次直接来源于 `data/*.md` 的 open/partial 项，会先核对源码、最新报告、测试和台账，把候选项分为 `pure-open / residual-tail / already-fixed / misclassified`，再决定是否继续纳入本轮。
- **台账状态回写闭环**：当实施或复审改变了 VL / PF / PI / ISSUE / GAP 的真实状态时，会在完成前回写状态、验证证据、验证时间与关闭/部分完成说明，并再核对 open 计数、进度、报告和 SUMMARY 是否一致。
- **官方资料优先**：涉及平台能力、框架 API、版本兼容性或工具语义判断时，优先读取官方文档，再降级到其他资料；新增/升级依赖、框架、SDK、平台 API 或外部模块时必须形成 `OfficialDocsEvidence`。
- **ProfileImpactCheck**：项目事实变化后，DevCodex 会检查是否需要同步 Profile 的技术栈、目录边界、脚本/测试/发布路线、配置说明或当前阶段；若不更新，需要在报告中写明 `skipReason`。
- **ServiceLifecycleCleanup**：若验证需要 AI 自己启动本地服务，会记录启动命令、cwd、PID/job、端口/URL，并在验证完成、失败或最终回复前关闭仅由 AI 本轮启动的服务；不会为了释放端口杀掉用户已有进程。
- **文档阅读顺序同步**：正文、README 或维护者文档一旦定义“先看什么 / 审查顺序 / 实施顺序”，website sidebar/nav、索引页和目录页要作为当前消费者同批校验；若信息架构故意不同，必须说明差异。
- **提交标题收短**：用户要求提交时，DevCodex 会优先生成一句简洁的 commit subject，而不是把整段会话摘要塞进标题。


## CLI 命令

| 命令 | 说明 |
|------|------|
| `devcodex init` | 初始化：同步 Copilot `.github/`，并链式部署 Claude Code 与 Codex adapter |
| `devcodex init --claude` | 初始化：仅同步 Claude Code adapter 到 `CLAUDE.md`、`.claude/` 与 `.mcp.json` |
| `devcodex init --codex` | 初始化：仅同步 Codex adapter 到 `AGENTS.md`、`.agents/` 与 `.codex/` |
| `devcodex update` | 更新：覆盖同步 Copilot `.github/`，并链式覆盖 Claude Code 与 Codex adapter |
| `devcodex update --claude` | 更新：仅覆盖同步 Claude Code adapter |
| `devcodex update --codex` | 更新：仅覆盖同步 Codex adapter |
| `devcodex update --host <copilot\|claude\|codex\|gemini\|grok\|all>` | 按同一作用域解析器更新指定宿主 |
| `devcodex uninstall --host grok [--dry-run]` | 解除 Grok 官方用户级插件安装及 DevCodex 自有 enabled/path 项；保留工作区插件 source 与用户其他配置 |
| `devcodex grok [Grok 参数]` | 按最终 `--cwd` 解析 workspace；root 校验原生 kernel，子 Git 项目用官方 `--rules` 绑定共享 kernel |
| `devcodex migrate-layout plan` | 生成 `.devcodex` 工作区集中布局迁移清单 |
| `devcodex migrate-layout apply --manifest <path>` | 按 manifest 执行集中布局切换 |
| `devcodex migrate-layout rollback --manifest <path>` | 回滚集中布局迁移 |
| `devcodex status [--json]` | 状态：检查已安装组件；JSON 模式返回 `StatusDiagnosticV1`，含只读 `governanceSummary` |
| `devcodex doctor [--json]` | 诊断当前宿主、Agent、Hook、Profile 与记忆状态；JSON 模式返回 `DoctorDiagnosticV1`，含同源只读 `governanceSummary` |
| `devcodex probe [id ...] [--json]` | 运行同步、local-only、只读 typed probes；默认包含 host/workspace/profile |
| `devcodex trace show\|replay [--state <file>] [--json]` | 查看或校验重放当前 turn trace 的只读数据投影；不执行 payload 或 mutation |
| `devcodex task resolve <任务名> [--project <name>] [--json]` | 有界定位可恢复任务；只返回 identity/session/CP metadata，不执行历史 payload |
| `devcodex skill plan <id...> [--mandatory <id...>] [--json]` | 生成 dependency-closed `BundleDecisionV2`；宿主不支持或 `full-only` 时回退完整 Skill 读取 |
| `devcodex help` | 查看 CLI 子命令与选项帮助 |
| `devcodex init --dry-run` | 预览模式：仅显示将复制的文件 |

## `.devcodex` 工作区集中布局（v1.10.0+）

当工作区根存在 `<workspace>/.devcodex/layout.json` 且 `mode = workspace-namespace` 时，DevCodex 会从“项目根各自持有 `.devcodex`”切换到集中命名空间模型：

- 单项目任务：写入 `<workspace>/.devcodex/<project>/...`
- 全工作区任务：写入 `<workspace>/.devcodex/workspace/...`
- `config.json`：`workspace/profile` 作为 base，`<project>/profile` 作为 overlay
- `config.local.json`：与 `config.json` 采用相同的 `workspace/profile + <project>/profile` overlay 模型，可作为用户 / 项目指定的本地 overlay，承载长期连接、本地明文连接信息、env / secretRef 引用和 `extensions.<namespace>`；不覆盖 `mode` / `agent`；脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息默认可直写或沿用项目既有模式，只有用户或项目明确指定时才从这里取得
- Profile 文档：项目命名空间文件优先，缺失回退到 `workspace/profile`
- CLI / Hook 运行态目录：统一写 active-root；单项目为 `<workspace>/.devcodex/<project>/.memory|.audit-state`，全工作区为 `<workspace>/.devcodex/workspace/.memory|.audit-state`
- 宿主部署 owner：从任一子项目执行默认、单宿主或 `--host all` 的 `init/update`，均先解析到工作区根；子项目不生成 `.github/.claude/.codex/.gemini/.grok` 或入口文件。只有显式 Grok `--project-portable` 允许项目级 adapter。
- 多项目 workspace 根缺少 workspace profile 时，Hook 提示真实路径 `.devcodex/workspace/profile/`；同一宿主会话已识别唯一项目后，后续“继续/确认”会在短 TTL 内沿用该项目和项目 `mode`，新会话、TTL 过期或显式 workspace 请求会重新判断。

配套 CLI：

```bash
devcodex migrate-layout plan
devcodex migrate-layout apply --manifest <manifest-path>
devcodex migrate-layout rollback --manifest <manifest-path>
```

> 真相源说明：只有在 `layout.json` 已创建后，runtime / MCP / profile init 才会按 `.devcodex/workspace` 和 `.devcodex/<project>` 解析；未启用时继续兼容旧的 `<project>/.devcodex/`。启用后不得再向 `<project>/.devcodex/.tmp` 等旧项目内运行态目录写入产物。

## Profile 计划、生成与升级

> 发布状态：以下 `profile plan`、统一分档生成和安全迁移行为已随 **v1.15.2** 发布；安装当前包即可使用。

先预览，再写入：

```bash
devcodex profile plan
devcodex profile plan --tier profile-standard
devcodex profile init --tier profile-standard
devcodex status
```

自动化脚本可使用 `devcodex status --json` / `devcodex doctor --json`。两者只输出一个 `DevCodexCliEnvelopeV1` JSON 文档；非法参数返回稳定 `CLI_INVALID_OPTION` 和退出码 2，默认人读输出保持兼容。`payload.governanceSummary` 以 `GovernanceStatusSummaryV1` 只读汇总 runtime-state、Skill 生命周期/灰度状态、执行优化证据、Gate registry、host truth、dirty boundary 和 fail-closed fast-path 决策，不创建或改写运行态文件。

本地维护者还可运行 `devcodex probe --json` 获取 host/workspace/profile 的 typed 只读结果，或用 `devcodex trace show|replay --state <lifecycle-state.json> --json` 检查 `LocalTaskTraceV1`。probe 不联网、不监听、不写状态；trace replay 不执行事件 payload，输出会携带源文件 SHA-256 便于 zero-write 对账。

- 首次创建默认目标是 `profile-lite`，命令会另外显示基于 package、脚本和目录证据得出的推荐档位；只有显式 `--tier` 才升级。
- 已有 Profile 默认继承当前档位；升级只补缺失文件并保留原正文。显式降档必须追加 `--allow-downgrade`，高档文件仍会保留。
- `profile plan` 等价于安全预览，和 `profile init --dry-run` 一样不会创建目录、文件或备份；`--force` 会在覆盖前备份。
- 三档默认生成矩阵为 **5 / 8 / 9**：lite 生成 README、01~03、config；standard 再生成 04/05/06；closed-loop 再生成 07。规范清单采用 `FeatureInventorySchemaV2` 十四字段表并兼容读取 V1；扫描无法证明的事实保持 `unverified`，不会因文档存在伪装成 implemented/validated/released。
- Skill portfolio 使用 schema v2：每项保留确定性 `SkillIndexV2` 投影；`BundleDecisionV1` 只读输出 selected/ignored/conflict/budget/exit，不修改 `plugin.json` lifecycle。portfolio 还绑定 tracked consumer inventory/projection digest；维护者在最终文件进入 index 后运行 `npm run test:skill-portfolio:staged`，提交后再于 clean tree 运行普通 `--check`。

完整命令、三档文件矩阵、迁移和排错见 [Profile 使用指南](./website/docs/guide/profile.md)。

## 意图驱动的上下文读取（v1.15.2）

> 发布状态：以下能力已纳入 v1.15.2 发布候选并通过 targeted/Hook/V99 验证；使用者仍应以目标 tag、package registry 和 release notes 为准。

在当前源码能力启用且宿主支持 DevCodex MCP 时，推荐使用以下生产主链，避免每条消息都把整套 Profile 与完整记忆注入上下文：

1. 从当前消息形成语义意图并确定唯一 project/active-root。
2. 调用 `profile_context_plan`：只返回 README/index、effective non-local config 与顶层文件 metadata，`01~09-*` 和 `config.local.json` 不在规划阶段预读正文；`ContextReadPlanV2` 同时携带身份绑定的 `ExecutionOptimizationPlanBindingV1`。
3. 用 `profile_load(files=[...], executionOptimization=<plan binding>)` 读取计划选中的 Profile 文件；记忆先调用 `memory_status`，仅在需要连续性时再调用 `memory_session_query` / `memory_summary_query`。load/skill 消费者不得为判断开关隐式重读 `config.json`。
4. 只有与 plan/epoch/target/source 精确关联且由 PostToolUse 观察成功的结果，才能形成 `ContextReadReceiptV2`（兼容 V1）；失败、不可观察或 fallback 结果保持 partial/unverified。
5. 用户/项目明确要求、audit/migration、低置信或必要来源缺失时可升级全量并记录原因；普通工具动作复用当前计划，只有目标、scope/action/risk、digest 或 compact/resume 漂移才重算。

旧的 no-args `profile_load`、`memory_session_read` 和 `memory_summary_read` 仍保留兼容性，但不再是推荐默认路径，也不能单独证明相关上下文已经完整加载。`config.local.json` 仍只有在用户或项目明确指定时才读取。

## 项目侧执行链性能与稳定回滚（v1.15.2）

当前源码把 task index、Context computation reuse、changed-scope validation、Profile section、Skill bundle 与 ProjectKnowledge snapshot 统一纳入 `ExecutionOptimizationStateV2`。派生索引/cache/snapshot 只负责加速，损坏、过期或关闭时不会成为第二真相源。

大型项目首次逐文件分析可用 `node scripts/project-analysis-state.js observe` 生成零写入结构观察，或用 `bootstrap --task-root <任务目录>` 在全部批次身份与验证通过后建立 `ProjectKnowledgeSnapshotV2`。生产路径会从当前 inventory 字节解析 JS/TS 静态相对依赖与 Markdown 本地链接，持久化带 builder 版本、覆盖率、未解析引用和 unknown consumer 的真实 `ImpactGraphV1`。后续 `plan` 只选择 changed、当前图的 impact closure 与 lens-gap；未变文件按稳定 5% oracle 复证。旧 graph builder 首次迁移走 full-required，正常图拓扑变化只重算新闭包；动态依赖消费者自身变化才强制全文，其他变化会保守重读全部 unknown consumers。V2 以 inventory Merkle 和 repo/root/config/parser/test/Profile binding 防止错库复用，并用 `SemanticClaimV1` 把声明绑定到精确 source range 与 authority。自动 bootstrap 只代表 `content-structured` 基线，不代表人工逐文件深读；V1 snapshot 仅可读取迁移状态，不能继续复用或原地写回。

可选配置只有一个，省略时即为 `safe-auto`：

```json
{
  "extensions": {
    "devcodex": {
      "executionOptimization": {
        "mode": "full-only"
      }
    }
  }
}
```

`full-only` 是 kill switch：关闭 changed-scope、正文 delivery reuse、Profile section、Skill bundle 和 snapshot reuse，但保留 bounded task resolver、完整 Context/Profile/Skill 读取、full validation 与 full-project-analysis。六类消费者会在实际动作前形成 `ExecutionOptimizationFeatureDecisionV1`：`off / shadow / rolled-back / sunset` 立即切回对应完整路径；状态损坏、未知 schema 或身份无效同样 fail-closed，状态缺失则保持 trial 兼容行为。该判断读取 active-root 的派生状态，不额外偷读 Profile 正文或 `config.json`。`devcodex status --json` / `doctor --json` 只读显示当前模式、状态和每个 feature 的 route，并在 `governanceSummary.executionOptimization` 中区分 trial acceleration 与 promotion-ready，缺少证据不会被写成可晋升默认；命令本身不创建运行态文件。

维护者验证命令：

```bash
npm run test:execution-chain-evolution
npm run test:changed
npm run test:full
npm run benchmark:execution-chain -- --input ./benchmark-input.json
```

benchmark 输入/输出分别为 `ExecutionChainBenchmarkInputV1` / `ExecutionChainBenchmarkResultV1`。只有同环境、样本满足、correctness 全为 0、综合改善至少 25% 且回归/开销预算通过时才能标 accepted；否则如实保持 `provisional` 或 rejected。本节能力随 v1.15.2 发布，仍按 `full-only` kill switch 保留完整正确路径。

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/vextjs/devcodex.git
cd devcodex
```

### 从目标项目测试 CLI

```bash
# 方式一：直接用 node 运行（推荐，无需 link）
cd /path/to/your-project
node /path/to/devcodex/index.js init --force

# 方式二：npm link
cd /path/to/devcodex
npm link
cd /path/to/your-project
devcodex init --force
```

### 验证安装

```bash
# 检查初始化后的文件结构
node /path/to/devcodex/index.js status

# 预期输出：
#   skills         X files
#   instructions   X files
#   prompts        X files
#   hooks          X files
#   data           X files
#   RULES.md       installed
#   copilot-instr  installed
#   legacy-agents  not installed   # 若有历史残留会显示 N files (legacy)
```

### 在 IDE 中验证规则自动生效

1. 从目标项目执行 `devcodex init`；普通仓库写项目根，workspace-namespace 子项目自动写工作区 owner 根
2. 重启 IDE
3. Copilot：直接在 Copilot Chat 中输入普通需求，确认无需 `@DevCodex` 也会按规则工作
4. Claude Code-only：仅需单独部署 Claude Code adapter 时执行 `devcodex init --claude`，随后新开会话并确认 `CLAUDE.md`、`.claude/settings.json`、`.mcp.json` 已生效
5. Codex-only：仅需单独部署 Codex adapter 时执行 `devcodex init --codex`，随后新开会话并确认 `AGENTS.md`、`.agents/skills/`、`.codex/hooks.json` 已生效
6. 若在 VS Code 中启用了 Hooks，可在输出面板检查 `GitHub Copilot Chat Hooks`，确认 `.github/hooks/devcodex.lifecycle.json` 已被加载

### 文档站本地预览

> 维护者提示：CLI 安装/运行仍只要求 Node.js >=18；文档站基于 Rspress 2，当前本地构建需 Node.js `^20.19.0 || >=22.12.0`。

```bash
cd website
npm install
npm run dev
# 浏览器打开 http://localhost:3000/devcodex/
```

## 架构概览

```
devcodex/
├── instructions.md # 单源完整规范；确定性生成精简 host kernel、薄 wrapper 与非 always-on full fallback
├── agents/        # Agent 源文件；Copilot 端默认分发，Claude Code 端不分发
├── instructions/  # 全局 Instructions（15 个，含工作流规则摘要，自动注入）
├── skills/        # Skill 详细检查标准（81 个，按 01-common §按需读取表 路由读取）
├── prompts/       # Prompt 模板（30 个）
├── hooks/         # Workspace Hooks 配置与分发到 `.github/hooks/_runtime/` 的运行时及 helper 模块
├── codex/         # Codex adapter 源模板（分发到 `.codex/hooks.json`，不是工作区部署副本 `.codex/`）
├── data/          # 运行时数据模板（分发到目标项目的空骨架）
│   ├── README.md
│   └── templates/ # 空模板：violations / pending-fixes / pending-issues / process-improvements / gap-registry
├── index.js       # CLI 入口（零依赖）
└── plugin.json    # 插件元数据
```

规范治理由 `spec-governance` 与 `spec-absorption` 分工：`spec-governance` 负责 `PostAssessmentGovernanceIntakeGate`、RecordRouter、真实落账验证、SCV 和 `GovernanceGateRegistry`；`spec-absorption` 负责最新可吸纳、仍需吸纳和 `.devcodex/*/data` 候选扫描、通用性证明与分层实现。所有模式下每条非空用户消息都会先登记中性 candidate，再由 AI 在合理性评估、项目现实扩展和上下文归因后按语义形成 `GovernanceIntakeDecision`；关键词不具有触发或分类权威。复合意图逐项写入 `violations / pending-fixes / process-improvements（优化清单，PI） / pending-issues / gap-registry`，只有成功 PostToolUse 对当前 active-root 的精确台账写入及落盘 ID 复证后才算 verified；`record.none` 也必须提供完整 challenge evidence。

控制面与长流程当前有五类支撑型 Skill：`execution-contract` 约束 scope / allowedPaths / requiredArtifacts / consumerScope / validationRoute / deviationLog，`test-router` 统一选择验证路线，`release-verification` 在正式 tag / publish 前执行 R0~R7 发布验证链，`host-contract-verification` 负责 direct replay / fixture replay / bootstrap / workspace guard 证据，`source-consumer-sync` 负责 Concept Sync Map 与当前消费者同步边界。

发布前审查由 `audit-release` 承担：它是 audit 专项维度，审查 release readiness、发布说明质量、兼容/迁移风险、package/plugin 元数据、文档/Profile/website 同步、回滚策略、registry/tag 风险与发布后验收；它不替代 `release-verification`，也不执行真实 `tag` / `push` / `publish`。

README / 用户使用文档当前补充四类专项 Skill：`user-manual-authoring` 负责站点文档、最终用户手册、README、quick start、接入手册和 docs-first 用户手册的用户路径与信息架构；`readme-authoring` 负责把 README 默认主视角收口为用户 / 使用者优先；`audit-user-manual` 负责用户侧文档、项目文档、文档设计、菜单导航、sidebar、信息架构和生成站点的专项 review 聚合；`audit-readme` 负责 README / 主入口文档的用户路径、快速开始、示例真实度、开发信息后置与消费链一致性审查。正式用户文档还执行 `UserPerspectiveDocsGate`、`UserDocsImmediateComprehensionGate`、`UserDocsPrimarySurfaceGate`、`FinalUserManualFirstGate`、`DocsSiteInformationArchitectureGate`、`UserManualFlowAndFailureGate`、`QueueDocsRealWorkflowGate`、`PublicUserDocsMaintainerBoundaryGate`、`DocsConsumerSweep` 和 `UserPathContractSweep`：检查文档是否足够详细、首次读者是否看得懂、功能覆盖是否完整、配置是否简单易懂、需求概况后是否先形成用户最终使用文档，首页首屏 / quick start / nav/sidebar / CTA / reference 是否优先服务用户使用，队列/异步场景是否覆盖真实工作流，公开用户路径是否排除了维护者 checklist / 内部同步清单 / 台账状态，以及 README / website / Profile / examples / templates / validate / 部署副本 / 代码消费点是否同步。

代码、文档、示例、fixture、quick start、技术方案和报告的专家型输出由 `expert-output-quality` 承接。`ExpertOutputQualityGate` 要求报告或文档不能只解释“fixture 能跑通”，还要给出生产推荐路径、框架原生能力、项目既有 helper、fixture/mock/demo 边界、反模式对照和证据矩阵；`OperationExplanationContractV1`、`CodeTruthEvidenceMatrixGate`、`SolutionFitAgainstRepoGate` 与唯一推荐门禁补齐操作来源、代码事实和收敛推荐；V84 负责同步 Skill、Prompt、执行消费者、README/website/Profile/changelog 和部署副本。

产品策略、开发者体验、UX 交互、前端架构、后端领域架构、生产可用性 / SRE、API 契约、外部集成、平台生态、AI Agent 系统、数据架构、安全威胁建模、质量策略、设计系统、无障碍/国际化、增长分析和商业模型由 21 个专家 Owner Skill 承接：`product-strategy`、`developer-experience-architecture`、`ux-interaction-architecture`、`frontend-architecture`、`backend-domain-architecture`、`production-readiness-sre`、`api-contract-architecture`、`external-integration-architecture`、`platform-ecosystem-architecture`、`ai-agent-system-architecture`、`data-architecture`、`security-threat-modeling`、`quality-strategy`、`design-system-architecture`、`accessibility-i18n`、`growth-analytics`、`business-model-review`、`distributed-systems-architecture`、`performance-engineering`、`privacy-compliance-architecture`、`ai-evaluation-engineering`。`growth-analytics` 与 `business-model-review` 为 P3 条件触发，不污染普通开发主路径；`ExpertOwnerSkillGate` 要求在技术方案、实施计划、TestRoute 和报告中记录 ownerSkill、triggerReason、requiredFields、validationRoute、skipReason 与 V85/targeted probe 证据，避免把专业判断只写成笼统的“从专家角度考虑”。

正式复审、ECR、发布前复审、多轮收敛和外部 finding 批次由 `review-checklist` 管理清单文件、冻结范围、逐项证据、遗漏逃逸分析、状态新鲜度和关闭结论；CP 确认后由 `PostConfirmationReviewScopeGate` 判定轻量或全面复审。报告中的 `ReviewChecklistCompletenessGate` / `EvidenceExecutionGate` / `ReviewEscapeRecordGate` 必须引用该清单或说明 N/A。复审发现新遗漏时，先写 escape record 的 `escapedItem / whyMissed / prevention / checklistPatch / rerunEvidence`，再补清单、重跑验证并判断是否写 VL/PF/GAP。

自我进化、自动吸纳、模型辅助规范优化、自动补 Skill / Prompt / Probe 和自动治理候选由 `evolution-governance` 管理控制面；任何模型生成的规则或发版建议必须先作为候选记录 `EvolutionRun`，再由人工确认、`LayeredAbsorptionGate`、验证探针、部署副本同步和 release-verification 决定是否进入 active 规范。

&gt; ℹ️ 维护者状态文件（本仓库开发过程中累积的 violations/pending-fixes 记录）按 active-root 保存，例如 workspace-namespace 下的 `.devcodex/<project>/data/`，**不分发**给用户。

## 客户端支持矩阵（Client Support Matrix）

| AI 客户端 | 注入路径 | Bootstrap / Hook 护栏 | CP 门控 | 记忆/MCP | 等级 |
|---|---|:---:|:---:|:---:|:---:|
| **GitHub Copilot (VS Code)** | `.github/instructions/*.md` + `copilot-instructions.md` + `.github/agents/` | ⚠️ instruction-fallback；Workspace Hooks 需按目标版本另行实测 | ⚠️ 文本/本地 fallback | ❌ 未内置 MCP | 🟡 Beta |
| **GitHub Copilot (JetBrains)** | `.github/instructions/*.md` + `copilot-instructions.md`（instruction-fallback） | ⚠️ 官方自定义指令路径，无本地 Hook 硬拦承诺 | ⚠️ 仅文本 | ❌ 未内置 MCP | 🟡 Beta |
| **Claude Code (CLI/桌面端)** | `CLAUDE.md` + `.claude/{instructions,skills,prompts,hooks/_runtime,mcp}/` + `settings.json` hooks + `.mcp.json` | ✅ Hook 事件支持硬拦；默认 `safety-only` 下流程项提醒放行 | ✅ Hook + 文本确认 | ✅ MCP | 🟢 Full |
| **Gemini CLI** | `GEMINI.md` 薄入口 + `AGENTS.md` kernel + `.agents/skills/` + `.gemini/settings.json` | ⚠️ Before/After adapter 已实现；本机无 CLI direct replay | ⚠️ Hook + portable fallback | ⚠️ 按宿主配置 | 🟡 Beta / UNVERIFIED |
| **Grok Build** | 独立显式 portable：项目 `AGENTS.md + .agents + .grok/hooks`；workspace-namespace：工作区非自动发现 source `.grok/devcodex/plugins/devcodex-workspace` + 单一官方用户级本地插件登记，子项目零 generated host artifacts | ✅ root native kernel + single user plugin；child plain plugin partial；`devcodex grok` launcher full | ⚠️ 仅 PreToolUse 可阻断；passive stdout ignored | ✅ root/child 双 MCP doctor direct | 🟢 Root Native / 🟡 Child Plain Partial / 🟢 Launcher Full |
| **Cursor IDE** | 需手工配置 `.cursor/rules` 或 root `AGENTS.md`（instruction-fallback；DevCodex **不**自动分发 Cursor 规则；HOST best-effort only） | ⚠️ 无 DevCodex 本地 Hook 硬拦承诺 | ⚠️ 仅文本 | ❌ | 🟡 Best-effort |
| **OpenAI Codex app/CLI** | `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json`（含 `PreCompact` compaction guardrail） | ⚠️ Codex hook guardrail；阻断输出按事件契约分为顶层 `decision`、`continue:false` 与工具级 `permissionDecision` | ⚠️ Hook + 文本确认 | ⚠️ 可手工配置 MCP；DevCodex 未自动写入 | 🟡 Beta |
| **ChatGPT 普通对话** | 不读取本地工作区 `AGENTS.md` / `.agents/` / `.codex/`；可手工粘贴规则 | ❌ | ⚠️ 文本 | ❌ | 🔴 Unsupported |

> **安装命令**：v1.15.2 默认三宿主部署 → `npx @vextjs/devcodex init`；仅 Claude Code adapter → `npx @vextjs/devcodex init --claude`；仅 Codex adapter → `npx @vextjs/devcodex init --codex`。需要显式增加 Gemini / Grok 时使用 `npx @vextjs/devcodex init --host <gemini|grok|all>` 或本地源码 `node index.js init --host <gemini|grok|all>`，默认面仍保持三宿主兼容行为。
>
> **Grok workspace 插件**：在 `workspace-namespace` 的工作区或任一子项目执行 `update --host grok`，CLI 都把 kernel、Skills、薄插件和 managed manifest 写到同一工作区 owner。薄插件 source 位于 `.grok/devcodex/plugins/devcodex-workspace`，不会被 project auto-discovery 再发现，只由 Grok 官方本地插件登记形成一个 user identity。旧 `.grok/plugins/devcodex-workspace` 登记会先通过官方 CLI 迁移，新安装 digest 验证后旧 source 才可逆移动到 `.tmp/backups`；失败走旧 source/registration/config 回滚。用户 Grok 配置只维护 DevCodex enabled 项和新旧受管 path 清理，其他设置、注释和插件保持不变，重复执行幂等。`uninstall --host grok` 只解除当前官方登记与受管配置，保留 canonical workspace source。工作区根可直接运行 `grok`；子 Git 项目要获得完整 kernel 保证时运行 `devcodex grok [原 Grok 参数]`。launcher 先消费官方 `--cwd` 决定真实 owner，校验 root kernel，且只在子 Git 边界追加官方 `--rules`；用户额外 rules 会合并，system prompt override 与重复 cwd 会因破坏保证而拒绝。root native、plain child 与 launcher 证据严格分开。
> `doctor/status` 诊断将 workspace plugin 的 source+registration 可用性与 installed digest 新鲜度分开：digest drift 只作为 warning 和刷新建议，不再把已登记且可用的 adapter 误报为未安装。
>
> **能力差异**：🟢 Full = 已验证 Hook 事件 + MCP + 自动同步；🟡 Beta/Best-effort = 尚未达到 Full，具体能力以矩阵各列为准；🔴 Unsupported = 不在当前本地 adapter 发布范围。默认 `safety-only` 下，bootstrap / CP / auto 白名单等流程问题为提醒并继续，仅危险命令硬拦；设置 `DEVCODEX_HOOK_ENFORCEMENT=strict` 后，支持硬拦的事件才会停止流程。
>
> **MCP 边界**：安装到业务项目根的 `.mcp.json` 由 Claude Code adapter 自动写入，并引用该项目的 `.claude/mcp/*`。DevCodex 源码仓自身受版本控制的 `.mcp.json` 则是包开发/插件清单，只引用包内 `mcp/*`；两者是独立契约，禁止拿源码清单覆盖安装态清单。DevCodex 当前不会为 Copilot 或 Codex 自动写入 MCP manifest；其他宿主只按其已验证的原生发现链使用。

### 用户可见交付与链接兼容

DevCodex 先用 `ArtifactDeliveryManifestV1` 对账所有内部产物，再由 `UserFacingArtifactSetV1` 确定性投影用户真正需要的文件，并通过 `DevCodexVisibleEnvelopeV1` 统一入口检查、确认、进度、完成结果与阻断信息。默认只显示最终报告、实际交付物和影响结论可信度的必要证据；session、daily、SUMMARY、task/checkpoint、raw receipt/manifest/ledger 仍会写入和验证，但不占用用户交付列表。

链接形式由当前回复 surface 的可验证能力决定，而不是只按客户端名称猜测：

| 能力档 | 用户面表示 | 降级规则 |
|--------|------------|----------|
| `clickable` | 单个语义 Markdown 链接 | 已验证可点击时不重复明文绝对路径 |
| `portable` | 工作区相对 Markdown 链接 | 点击能力未知时的默认档，保持可迁移 |
| `plain` | 语义名称 + 可复制相对/短路径 | 适用于只保证纯文本的终端或日志 |
| `failed` | 语义名称 + 可复制定位 | 链接已失败或宿主无法定位时给出绝对路径 fallback 与原因 |

每个可见文件都包含“语义名称 + 用途 + 用户动作”，并按决策、结果、证据、可选详情排序。只有用户明确要求、链接实际失败、文件位于工作区外、路径有歧义或宿主无法定位时才追加绝对路径；禁止 `file://` 和只输出裸文件名。`ArtifactLinkSet` 仅保留为兼容投影名，不再是交付真相源。

## 运行时配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `DEVCODEX_HOOK_ENFORCEMENT` | `safety-only` | `safety-only` 只对危险命令硬拦，流程类问题提醒放行；`strict` 会对宿主支持硬拦的事件启用更严格的 runtime 阻断 |

> 建议：默认先保持 `safety-only`；只有在团队已验证宿主 Hook 事件覆盖度后，再切到 `strict`。

### Hook 拦截动作语义

DevCodex Hook runtime 不再把所有拦截都等同为“停止”。拦截会写入 `interceptions.jsonl`，并按动作区分后续行为：

| 动作 | 含义 | 后续行为 |
|------|------|----------|
| `forbid` | 禁止危险或不可恢复操作 | 支持 Hook 硬拦的宿主直接拒绝；可审批危险命令会先返回 pending `devcodex-approve:<id>`，只有用户在后续提示中明确确认该 id 后，同一命令/目录 10 分钟内才可消费一次；`DROP TABLE`、无 `WHERE` 的 `DELETE FROM`、根目录 `rm -rf` 等不可审批 |
| `require_completion` | 必须补完某项才能进入下一步 | `strict` + 支持硬拦事件时停止；默认 `safety-only` 下提醒并继续，AI 必须补完缺项 |
| `warn_continue` | 风险提示但允许继续 | 继续执行并记录原因，适合 bootstrap/CP/auto 等流程提醒 |
| `log_only` | 仅审计记录 | 不打断流程，用于已确认危险命令、状态变更等可追溯事件 |

> 宿主输出契约：Claude Code 与 Codex 的非工具事件不复用工具级 `hookSpecificOutput.permissionDecision`。Codex `Stop/UserPromptSubmit` 使用顶层 `decision:"block"`，`PreCompact` 使用 `continue:false`；Codex adapter 默认以 `manual|auto` matcher 注册 `PreCompact`，工具调用拦截才使用 `permissionDecision`。

## 常见问题与排错

1. **Hook 没生效 / 规则看起来没加载**
   - 先运行 `devcodex doctor`
   - 再核对当前宿主是否真的支持本地 Hook 硬拦，以及目标项目是否已重新打开会话
2. **Context plan 没建立或 workspace-namespace 路径不对**
   - 先运行 `devcodex doctor`
   - 再用 `devcodex help` 查看 `profile init` 和 `migrate-layout` 子命令，核对 `.devcodex/workspace/profile/` 与项目命名空间路径
   - 维护 DevCodex 源仓或 workspace-namespace 时，运行 `node scripts/validate-all-profiles.js --workspace <workspace-root>` 校验所有 Profile；发布前需要严格处理 warning 时追加 `--strict-warnings`
3. **Codex / Copilot 想用 MCP**
   - 先确认宿主本身是否支持本地 MCP
   - DevCodex 当前只会自动写 Claude Code 的 `.mcp.json`；Codex / Copilot 需要手工配置
4. **Copilot 里 `profile_load` 报 `invoke` undefined**
   - 这通常表示宿主 MCP bridge 没有完成工具调用，而不是 DevCodex profile 文件一定损坏
   - 不要反复重试同一个 MCP 调用；按同一计划只做一次有界 fallback：确认唯一项目，读取 README/config baseline，再读取 selected Profile 与单个 memory session/SUMMARY 投影；不要改成整目录或整文件默认读取
   - fallback 无法提供可观察的成功结果时保持 `unverified`，不要把工具调用意图或提示文案当成 `ContextReadReceiptV2` 完成证据；V1 receipt 只作兼容读取
   - 同时运行 `devcodex doctor` 或宿主自带 MCP 诊断，确认 MCP server 是否真的连接
5. **产物文件无法点击或交付列表看不懂**
   - 先确认文件项是否包含语义名称、用途和“操作”说明，而不是只有文件名或 CP 编号
   - 点击能力未知时允许使用工作区相对 Markdown 链接；不要仅因客户端名称要求重复绝对路径
   - 链接实际失败、文件在工作区外、路径有歧义或宿主无法定位时，要求输出带原因的绝对路径 fallback
   - 需要内部留痕时可明确要求 `internal-audit` 完整清单；日常结果默认隐藏 session、SUMMARY 与 raw ledger
6. **CP 卡住或只看到提醒不拦截**
   - 先确认当前是否处于 `safety-only`
   - 如需更严格的流程门禁，再评估是否启用 `DEVCODEX_HOOK_ENFORCEMENT=strict`
7. **不知道该跑哪个诊断命令**
   - `devcodex doctor` 看宿主 / Hook / Profile / 记忆状态
   - `devcodex help` 看 CLI 子命令与参数说明
8. **长任务在工具输出后看起来一直挂着**
   - `PostToolUse` 只表示工具返回，Turn Liveness 会先进入 `awaiting-continuation`；120 秒后记为 `suspect`，300 秒后记为 `stalled-recoverable`
   - 有后续 Hook 事件时，runtime 会基于 checkpoint 生成一次性 `TurnRecoveryCard`；宿主没有继续派发事件时，Hook 本身无法主动唤醒任务
   - `CheckpointValidationResultV1` 分开记录 response-time 与 post-execution；PostToolUse/PreCompact 或缺失证据不能让 post-execution 通过，只有实际 Stop terminal evidence 才能完成
   - `devcodex trace show|replay --state <lifecycle-state.json> --json` 可检查当前 turn 的 sequence/duplicate/terminal；replay 只读且不会执行 payload
   - 工具或 Agent 仍持有有效长租约时不会按 120/300 秒误判；任何恢复都不得自动重放未知副作用的写操作
   - gray sidecar 可执行 `npm run check:turn-liveness -- --state <lifecycle-state.json> --json`；安装包消费者可直接运行 `node node_modules/@vextjs/devcodex/scripts/check-turn-liveness.js --state <lifecycle-state.json> --json`
   - sidecar 只做一次读取和分类，不 watch、不写状态、不唤醒宿主、不重放操作、不控制进程；输出 `sidecar-observed` 不能冒充 `host-native-verified`

## IDE 兼容性

> v1.9.6+ 与上方"客户端支持矩阵"语义对齐：✅=自动加载且经实测；⚠️=加载但能力降级或未实测；❌=不支持。Hooks 列仅代表宿主是否具备可接入 Hook 事件，不代表所有 DevCodex 规则都能硬拦。

| 功能 | VS Code | JetBrains | Visual Studio | Xcode | Eclipse |
|------|:-------:|:---------:|:------------:|:-----:|:-------:|
| `copilot-instructions.md` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `instructions/*.instructions.md` | ✅ | ⚠️ 实测中 | ✅ | ❌ | ❌ |
| `hooks/*.json` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `agents/*.agent.md` | ✅ | ⚠️ legacy | ❌ | ❌ | ❌ |
| `skills/*/SKILL.md` | ✅ | ⚠️ 实测中 | ❌ | ❌ | ❌ |
| `prompts/*.prompt.md` | ✅ | ✅ | ✅ | ❌ | ❌ |

> JetBrains 的 path-specific instructions / agents / skills 已实测确认可用（WebStorm 2026）；Workspace Hooks 当前按 VS Code Hooks Preview 能力建模。


## 文档

完整文档: [devcodex.dev](https://devcodex.dev)

## 边界声明

**DevCodex 适合用于**：
- 团队/个人需要在多项目之间统一 AI 开发工作流
- 希望 Copilot、Claude Code 或 Codex 在 dev / fix / audit 场景下遵守一致的 CP 门控、合规检查与报告产出
- 需要持久化会话记忆、规范自修复机制（PC4）的协作流程

**DevCodex 不适合用于**：
- 单次、一次性、无需规范约束的快速原型场景
- 当前不在正式支持矩阵中的客户端/宿主（见 §客户端支持矩阵）
- 对 `.github/` / `.claude/` / `.agents/` / `.codex/` / `AGENTS.md` 有其他强约束、无法接受 DevCodex 写入的项目

**前置条件**：
- Node.js ≥ 18（CLI 零依赖，仅使用标准库）
- 若维护或构建 `website/` 文档站，需要 Node.js `^20.19.0 || >=22.12.0`（Rspress 2 依赖要求）
- 已启用目标宿主的规则加载能力（Copilot `Use Instruction Files` / Claude Code 标准项目规则加载 / Codex 工作区 `AGENTS.md` 加载）
- Copilot 路径：已安装支持的 GitHub Copilot IDE（VS Code / JetBrains 全量支持；Visual Studio / Xcode / Eclipse 部分支持，详见 §IDE 兼容性）
- Claude Code 路径：允许项目级 hooks 与 MCP（`init --claude` 会写入默认配置）
- Codex 路径：允许工作区根 `AGENTS.md`、`.agents/skills/` 与 `.codex/hooks.json` 作为受管部署副本

## Tier 说明

DevCodex 的 `plugin.json` 声明 `tier: "free"`，所有 Skill 均标注 `tier: "free"`。这些 tier 字段是**面向未来的 prompt-level 声明**（供 `token-check` Skill 在 Agent 侧做软门控），**CLI 不做任何授权校验**：

- CLI 本身不做额外 license/tier 授权校验；当前 v1.15.2 通过 GitHub Packages 分发，registry 读取认证仍按平台规则执行
- 未来接入服务端 token 校验时，tier 字段才会生效
- 当前阶段 tier 仅作为规划信息，不影响功能使用

## Agent 入口

仓库内保留两个 Agent 文件（`agents/devcodex.agent.md`、`agents/devcodex-auto.agent.md`）供 IDE 直接调用；`v1.9.8` 起 Copilot 端默认安装会同步到 `.github/agents/`，Claude Code 与 Codex 端仍不分发 agents。标准使用路径是：

- **推荐**：通过 `copilot-instructions.md` + `instructions/` 自动注入，直接在 Copilot Chat 对话即可
- **可选**：通过 `.github/agents/` 使用 `@devcodex` / `@devcodex-auto` 自定义 Agent 入口
- **Codex**：通过 `AGENTS.md` 自动注入总则，通过 `.agents/skills/` 按需读取技能；不单独维护 `codex/AGENTS.md`

Auto v1.1 当前只在支持 Hook 的宿主里，对显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `config.json` 中 `extensions.devcodex.autoAliases` 配置的替换别名，或明确自然语言 auto 授权（如“进入 auto 模式执行”）下的白名单路径提供 runtime 级硬保证；配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；模糊提及、询问 auto 规则、未生效昵称或普通“继续”不算授权。JetBrains 等 `instruction-fallback` 宿主仅同步规则语义，不承诺完全等价的自动放行。Auto 任务若命中控制面、多批次或预计修改 ≥10 文件，仍须先形成 ExecutionContract 并持续更新实施进度。

`config.json` 还可配置 `extensions.devcodex.concurrency`：

```json
{
  "extensions": {
    "devcodex": {
      "concurrency": {
        "mode": "auto",
        "readOnly": { "enabled": true, "maxParallel": 4, "allowAgents": true },
        "validation": { "enabled": true, "maxParallel": 2 },
        "locks": { "additionalSingleWriterScopes": [] }
      }
    }
  }
}
```

默认 `auto` 采用 `parallel prepare, serial commit`：文件搜索、Profile/记忆读取、只读分析和互不写同一输出的验证可并行；同一 active-root 的 CP 状态、记忆、报告、台账、audit session、source mutation、package boundary 和危险操作必须串行或单写者。保守项目可设 `mode: "serial"`；首期不支持 `parallel` 或 `allowParallelMutations`。

## 许可证

AGPL-3.0-or-later © Rocky / [vextjs](https://github.com/vextjs)
