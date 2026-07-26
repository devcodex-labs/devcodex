# DevCodex

> AI 开发规范注入器 — 默认五宿主：Copilot / Claude Code / Codex / Gemini / Grok（Hook-First / Instruction-Fallback）

[![npm](https://img.shields.io/badge/npm-%40vextjs%2Fdevcodex-blue)](https://github.com/vextjs/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

## DevCodex 是什么？

DevCodex 通过 npm 全局安装把 Copilot、Claude Code、Codex、Gemini CLI 与 Grok Build 的 adapter 写入各宿主的**用户级配置位置**；工作区只保留 `.devcodex` 运行态。五宿主共享同一精简内核、按需 Skills 与完整回退真相源。
在支持 Hooks 的宿主中，它优先用 `hooks/_runtime/lifecycle.cjs` 提供确定性的生命周期护栏；在不支持 Hooks 的宿主中，则回退到 instructions 语义层继续工作。

## 目录导航

- [DevCodex 是什么？](#devcodex-是什么)
- [功能特性](#功能特性)
- [5 分钟快速开始](#5-分钟快速开始)
- [安装](#安装)
- [使用](#使用)
- [正式需求与执行模板边界](#正式需求与执行模板边界)
- [意图驱动的五宿主能力选择（Unreleased）](#意图驱动的五宿主能力选择unreleased)
- [默认执行原则](#默认执行原则)
- [CLI 命令](#cli-命令)
- [`.devcodex` 工作区集中布局（v1.10.0+）](#devcodex-工作区集中布局v1100)
- [Profile 计划、生成与升级](#profile-计划生成与升级)
- [意图驱动的上下文读取（v1.15.3）](#意图驱动的上下文读取v1152)
- [项目侧执行链性能与稳定回滚（v1.15.3）](#项目侧执行链性能与稳定回滚v1152)
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
- **宿主生命周期护栏**: Copilot CLI、Claude Code、OpenAI Codex、Gemini CLI 与 Grok 在各自已支持的 Hook 事件上提供用户级 runtime adapter；Copilot IDE、JetBrains、Cursor 等未接入等价用户级 Hook 的 surface 仍降级为 instruction-fallback。默认 `safety-only` 仅对危险命令硬拦，流程项提醒放行，`strict` 模式才升级可阻断事件
- **Codex hook guardrail**: Hook 能力按宿主/事件降级；Codex 的阻断行为取决于当前事件是否支持 `decision`、`continue:false` 或 `permissionDecision`，不能把 adapter 已安装等同为所有事件均可硬拦
- **长任务 Turn Liveness**: `TurnLivenessRecoveryGate` 记录 `running / awaiting-continuation / suspect / stalled-recoverable / terminal` 状态、工具租约、continuation ACK、双阶段 checkpoint 与当前 turn 的 `LocalTaskTraceV1`；Hook 只能在事件到达时判断历史停滞，trace replay 只返回数据，不能自行唤醒宿主、执行 payload、重放写操作或把 `PostToolUse` 当成任务完成
- **全过程完成证据（未发布 Shadow）**: `WorkflowCompletionCandidateV1 → Plan/Receipt/Snapshot → Commit → Projection` 将 CP、执行、验证、复审、同步、报告和记忆绑定到同一 candidate；任务输入由 lifecycle 的受管原子写入口生成，`task verify` 只消费通过 schema、候选绑定和回读校验的输入。report-only、marker-only、仅选择测试路线或仅有复审文档都不能标记完成。五宿主共享同一 reducer，direct/portable/fallback 只改变证据上限，不改变完成语义
- **证据新鲜度与主张复用门禁（Unreleased Shadow）**: `ClaimEvidenceIndexV1` 抽取“已验证 / 推荐 / 可确认 / 完整”等强主张，`EvidenceFreshnessReceiptV1` 绑定 source/context/dependsOn/lease，`StaleEvidenceLintDecisionV1` 输出 fresh、rerun-required、downgrade-only 或 unverifiable；memory/SUMMARY/历史报告/外部审查文字只能作 navigation hint，不能单独支撑强结论。新增 `npm run test:evidence-freshness` 覆盖 summary-only、dependency drift、lease、ArtifactAnchor 与 FinalValidationSummary 绑定。
- **全模式入口检查**: 所有模式在实质任务前显示 PC0~PC7；dev 模式额外执行 PC4 规范雷达与完整合规链
- **项目现实扩展**: 先做语义意图初判，再结合目标项目 Profile、目录与当前任务上下文修正最终路由、产物落点和验证方式
- **意图驱动五宿主能力选择（Unreleased）**: `HostCapabilityRoutingGate` 将同一用户意图映射到 Copilot / Claude Code / Codex / Gemini / Grok 的 8 个 surface variant；薄 Rule 只保留强不变量，`host-capability-routing` Skill 负责语义判断，版本化 catalog/contracts 负责可测试事实。证据缺失、过期或 variant 未知时 fail closed 到 portable fallback；当前 canonical catalog 的 native eligible 为 0，Phase 1 不新增 MCP primitive
- **任务名续接与增量执行链（v1.15.3）**: 新会话只需发送 `继续<任务名>任务`；系统通过稳定 task identity 有界定位，再复证 sessions/CP/产物。Context、validation DAG、Profile/Skill 与 ProjectKnowledge 可按内容身份增量执行，并由 `full-only` kill switch 保留完整正确路径
- **可配置并发策略**: Profile `config.json` 可配置 `extensions.devcodex.concurrency`；默认 `auto` 表示只读准备和隔离验证可并行、共享状态写入保持单写者，保守项目可设为 `serial`
- **多需求并行编排（Unreleased）**: `requirement-parallel-orchestration` 用 `RequirementIndependenceDecisionV1`、`SharedSurfaceLockMapV1`、`ParallelLaunchCardV1` 与 `IntegrationMergeProtocolV1` 判断多需求、子 Agent、子会话或 worktree 是否可并行；缺证据、共享源码写入或 `allowParallelMutations` 均回到串行
- **文件真相源优先的有界启动链**: `MemoryCannotSatisfyBootstrapGate` 要求宿主 Memories、模型长期偏好、SUMMARY 或交接卡只能作为 `navigation-hint`；新线程、resume、summary 恢复或跨项目切换仍须通过 Profile plan、memory status/query 与 handoff 指向的精确 reports/review checklist/source 复证。V86 防止用内置记忆替代文件真相，V99 防止把复证误写成默认全文读取或失败调用假完成。
- **支撑型 Skill**: `execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync` / `requirement-parallel-orchestration` 为控制面、多批次、测试路线、宿主契约验证、真相源-消费者同步与多需求并行编排提供可审计支撑，不新增工作流分支
- **Always-On 质量守恒治理（Unreleased）**: `AlwaysOnSurfaceMatrixV1` 同时统计 Host Kernel 与 `instructions/*.md applyTo:"**"` 面，`HostAdapterCompatibilityMatrixV1` 按 Copilot/Claude/Codex/Gemini/Grok root/plain/launcher 限定能力上限，Q1~Q8 Shadow 40 样本要求 P0 零漏判；当前只读诊断与探针已落地，AO-3 默认轻注入仍未启用
- **模型无关双层修复协作契约**: AI 判断任务目标为 repair task 时至少建立 `lightweight` 决策/验收层 + 执行/验证层契约；P0/P1、安全、控制面、公共契约、多批次、角色交接或发布风险升级 `full`，用 `findingToPatchMap`、`handoffIntegrity` 与 `independentReReview` 防止范围漂移和补丁作者唯一自证。模型名称或是否切换 Agent 不是触发条件
- **修复完成与返工效果分层**: active `repair-prevention-assessment` 是所有 repair 的默认完成门禁，强制分离当前关闭证据与长期前瞻计划；gray `rework-prevention-engineering` 仅在返工率、重复逃逸簇或效果验证时使用，以 WorkUnit/ReworkEvent、FirstPassYield 和 prospective trial 判断是否值得晋级。active 工作流不依赖默认不部署的 gray Skill。`CandidateDiffCompletenessGate` 在 commit/tag/publish 前用 staged candidate snapshot 覆盖 tracked/untracked，并执行 cached diff、name-status、secret-shape 与 intended scope 对账；普通 working diff 不能替代。派生资产另由 `PostStageDerivedArtifactFreshnessGate` 在完整 stage 后读取 Git index，并在 commit 后 clean tree 复放，防止“先生成、后新增消费者”逃逸。`ReviewCoverageClaimIntegrityGate`、`ArtifactDeliveryManifestGate`、`VisibleOutputHostEvidenceGate`、`ReleaseAuthorityBeforeCompatibilityGate`、`ConfigurationErgonomicsGate` 与 `InteractiveSemanticProbe` 分别约束审查真实性、内部交付对账、用户可见证据、兼容判断、配置易用性和交互语义
- **跨仓消费者验证**: `consumer-validation-engineering` 以 RepositoryBinding、SourceConsumerIdentity、ValidationDenominatorMatrix、packed artifact、跨仓 CI 与 freshness drift 约束 SDK/CLI/框架/公共包的独立消费者仓；`DesignFitnessGate` 额外判断主路径、默认值、配置层级、框架约定和维护成本，`ValidationFindingRepairLoop` 在 source mutation 后使旧 identity/证据 stale 并按影响矩阵重跑。realpath、行为全绿或单一 100% 分母不能冒充完整验证。该 Skill 保持 `gray`，由 V95 正负探针守门
- **品牌视觉资产质量（gray 试用）**: `brand-visual-quality` 用母版谱系、主题几何 parity、微尺寸光学校正、单色母版、`VisualEvidencePack` 与 blocker reset 管理 logo/icon 等品牌资产生产；文件存在、构建成功或单张截图不能替代同画布证据与人工结论。当前只完成结构化 V97/前向试用证据，仍需真实 WorkUnit 才能晋级 active
- **发布前审查与关键路径治理**: `audit-release` 负责 release readiness、说明、兼容、包与发布风险；`release-verification` 执行 R0~R7，并以 `ReleaseEfficiencyControlGate` 的 `CandidateFreezeGate`、`ReleaseCriticalPathBudgetGate`、`ValidationEvidenceReuseGate` 管理候选 generation、预算和证据失效。pack/install smoke 额外执行 `IsolatedConsumerCwdGate`：显式 consumer manifest、真实 consumer cwd、source identity 前后对账；禁止用 `npm init --prefix` 冒充 cwd 隔离。无可比较基线时预算只能 advisory，不能削弱 version/pack/registry/R7
- **长任务墙钟预算与授权**: `execution-contract` 的 `ExecutionBudgetGate`、`ExternalWaitAccountingGate`、`LongTaskAuthorizationGate` 要求 Auto/多批次/长 resume 冻结 `maxWallClock` 与 cycle 预算，等人/外部等待不计入执行预算，用户「继续」必须新 cycle；`report`/`compliance` 同步 `WorkspaceSyncStatus`、`CompletionEvidenceGate` 与条件 `PostDeliverySelfCheck`
- **审计与修复授权分离**: `AuditMutationBoundaryGate` 规定 audit 只写报告、audit-state、记忆和运行态台账；任何源码/规范/配置/测试/文档/部署副本修复都需用户显式授权后进入独立 fix/self-fix，audit 不自动改源、`git add` 或继承修复权限
- **分析与用户文档能力**: `analyze-default` / `analyze-research` 承接分析与调研；`user-manual-authoring`、`audit-user-manual`、`readme-authoring` 和 `audit-readme` 收口站点文档 / README / quick start 的用户路径、信息架构、配置排错和真实工作流。声称场景完整时必须执行 `ScenarioCoverageMatrixProbe`；队列/批处理还要执行 `DurableBatchOrchestrationProbe`，页面或关键词存在、一次 `addBulk`、进程内 callback 都不能替代持久 run、故障恢复与 executable evidence
- **专家型产物质量能力**: `expert-output-quality` 负责代码、文档、示例、fixture、quick start、技术方案和报告的专家型输出质量；`ExpertOutputQualityGate` 要求先给生产推荐路径、框架原生能力和项目既有能力，再说明 fixture/mock/demo 边界、反模式和证据矩阵。V84 探针会阻止把测试夹具、硬编码单例或每个 route 重复声明包装成生产推荐实践。
- **强主张证据新鲜度能力**: `evidence-freshness` gateGroup 与 `scripts/lib/evidence-freshness-receipt.js` 负责报告、分析、审查、复审清单和用户可见完成检查中的强主张证据复用；`ArtifactAnchorV1`、`ArtifactAnchorProjectionV1` 与 `FinalValidationSummaryV1` 可作为证据依赖，SUMMARY、历史报告和外部审查原文只能作 navigation hint。
- **操作、代码事实与唯一推荐**: 面向用户或维护者的操作说明使用 `OperationExplanationContractV1`；重要方案/报告使用 `CodeTruthEvidenceMatrixGate` 和 `SolutionFitAgainstRepoGate` 绑定 repo path、symbol、currentBehavior、negativeProbe、gap、reusePoint、consumer、rollback 与 statusQuoCost；收敛后由 `UniqueRecommendationBeforeConfirmGate` / `NoPreferenceMenuAfterConvergenceGate` 保证只有一个推荐方案或明确组合。
- **专家 Owner Skill 能力**: 21 个专家 Owner Skill 分别承接产品策略、开发者体验、UX 交互、前端架构、后端领域架构、生产可用性 / SRE、API 契约、外部集成、平台生态、AI Agent 系统、数据架构、安全威胁建模、质量策略、设计系统、无障碍/国际化、增长分析和商业模型；`growth-analytics` 与 `business-model-review` 为 P3 条件触发，未命中时写 `N/A + skipReason`；`ExpertOwnerSkillGate` 要求报告 ownerSkill、triggerReason、requiredFields、validationRoute、skipReason 和 V85/targeted probe 证据，避免“专家视角”只停留在泛泛口号。
- **复审清单能力**: `review-checklist` 负责正式复审、ECR、发布前复审、多轮收敛和外部 finding 批次的清单创建、范围冻结、逐项证据执行、遗漏逃逸分析、状态新鲜度和收敛关闭；`PostConfirmationReviewScopeGate` 要求 CP 确认后输出 **ReviewGradeCard**，按 C19↔R 映射选择强度（**轻量=R1** 须 skipReason、**标准=R2** 默认、**全面=R3** 冻结清单、**发布安全=R4**）；ECR 默认 R2，禁止「永远轻量」；`ReviewEscapeRecordGate` 要求发现遗漏时先在清单写入 `whyMissed / prevention / checklistPatch / rerunEvidence`，再补清单和重跑验证；`ChecklistStateMaterializationGate` 在 clean/closed 前核对 header、items、round、ledger、progress、closure 六区块一致快照
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
- **规范吸纳执行能力**: `spec-absorption` 负责最新可吸纳、仍需吸纳和 `.devcodex/*/data` 候选扫描，先执行 `CommonNormGeneralizationGate` 与 `AbsorptionCandidateConsumerProofGate`，证明通用规范价值、剔除项目独有残留、绑定 DevCodex 当前消费者和 targetOwner，再用 `AbsorptionCandidateMatrixV1` + read-only `plan-absorption-candidates` 生成 `LayeredAbsorptionDecisionV1` 后进入分层实现与验证；`ServiceSpecReadGate` 等项目私有规则只作负向样例，不吸纳为通用规范
- **最新吸纳执行包 A1~A10**: 最新可吸纳清单确认实施时，`LatestAbsorptionExecutionPack` 按 `GovernanceGateRegistry` 分组同步配置 canonical namespace、Profile/runtime contract、行为语义与负向翻译、示例与 callback 真相面、派生消费者与失败注入、FeatureInventoryProfileGate / FeatureChecklistEvidenceMatrixGate、BatchEvidenceLedgerStateGate / BatchProgressCardGate，并用 V82 探针核对 Skill、Prompt、TestRoute、report、README/website/changelog、Profile、部署副本和来源台账回写
- **分层吸纳架构（兼容 Skill-first 吸纳架构）**: 规范吸纳、data 台账治理、用户确认可泛化建议或新增门禁时，先执行 `LayeredAbsorptionGate`，并兼容 `SkillFirstAbsorptionGate` / `CapabilityToSkillPromotionGate`；输出 `LayeredAbsorptionDecision` / `LayeredAbsorptionDecisionV1`（含 `SkillAbsorptionDecision`），逐层覆盖通用指令、Skill、prompts/templates、执行消费者、validate/test 探针、README/website/changelog 和部署副本，缺 targetOwner、consumerProof 或 validationRoute 时保持 blocked。采纳用户建议前同步执行 `ProactiveBetterAlternativeGate`，有更优方案必须先提出取舍；采纳用户纠正时执行 `AcceptedSuggestionRootCauseGate`，报告 whyMissed、采纳依据、台账编号和防复发动作
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
- **证据新鲜度**: 报告、分析、审查、推荐、CP 可确认和完成态强声明会记录 `EvidenceFreshness` 条件段；旧报告、SUMMARY 或外部审查输入只能导航，缺 fresh evidence 时降级为 WARN/UNVERIFIED 或在高风险 enforce 场景阻断。
- **对比调研门禁**: 用户问“是否应该 / 哪个更好 / 有没有更好建议 / 推荐什么”且结论会影响时间、金钱、架构、产品/项目路线或长期维护成本时，先执行 `QuestionEvidenceGate`；技术路线、架构优化、性能优化、框架能力设计或高维护成本方案在 CP1 最终需求确认前执行 `TechnicalRouteComparativeGate`；必要时比较同类产品 / 项目 / 本仓库相似模块，普通低风险问答可标 `ComparativeResearchGate: N/A + skipReason`
- **确认交互降级**: 用户确认先抽象为 ConfirmationRequest，再按宿主能力选择按钮、权限提示、Hook 阻断或文本确认 fallback，不把按钮 UI 承诺为全宿主能力
- **执行护栏**: 新需求切换时优先按意图判断边界；涉及外部平台/API/兼容性判断时优先看官方文档；提交时压缩 commit subject

## 5 分钟快速开始

先区分两个版本概念：npm package 的当前发布版本是 **v1.15.3**；文档站的 **1.0.1** 是活动需求文档版本，不是可安装包版本。

| 通道 | 当前状态 | 用途 |
|---|---|---|
| GitHub Packages | ✅ v1.15.3 | 当前唯一发布通道；安装需要 GitHub Packages `read:packages` 认证 |

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

3. 本地验证当前 global-only 候选：

```bash
npm pack
npm install -g ./vextjs-devcodex-1.15.3.tgz
```

发布后的正式入口为 `npm install -g devcodex`；本阶段只验证本地 tarball 和 CLI 行为，不验证 npm 包名 owner、registry、dist-tag 或版本唯一性。

4. 在目标工作区初始化 `.devcodex` 并验证：

```bash
devcodex init
devcodex status
```

成功时，五个宿主 adapter、共享 full fallback 与 active Skills 均位于用户级配置根；共享 `.agents` 由一个安装事务 Owner 写入，避免五宿主重复拥有同一路径。工作区不会新建 `.github/.claude/.codex/.gemini/.grok/.agents`，也不会新建根级 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md` 或 `.mcp.json`。已有工作区宿主文件只作为 legacy 诊断输入，DevCodex 不会自动删除。

安装 receipt 与目标文件存在只证明 `configured`，不等于宿主已可执行。`devcodex status` 运行有界 adapter 契约探针与 Grok 静态合同检查；`devcodex doctor` 进一步检查宿主原生版本、Grok registry/native list 唯一性、`grok inspect --json` 发现面、已安装 Hook 的只读合同探针和 MCP `initialize`。JSON 中每个宿主分别返回 `configured`、`contractStatus`、`nativeStatus`、`operationalState`、`ready` 与 `issues`。查询本身成功时仍为 `ok=true`、exit 0，健康失败通过 `payload.overall=failed` 和宿主状态表达，避免把诊断结果误当成 CLI 调用错误。

## 安装

以下是当前 v1.15.3 的完整安装说明。当前版本仅发布到 GitHub Packages，安装需要读取认证。

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

> v1.15.3 未发布到 npmjs；缺少上述 registry 或读取认证时，安装不会自动回退到其他通道。

### 2. 安装并初始化

```bash
npm pack
npm install -g ./vextjs-devcodex-1.15.3.tgz # 本地候选：安装 CLI 并自动配置五宿主用户级 adapter
devcodex init                              # 只初始化当前 workspace 的 .devcodex
devcodex status
```

发布后的命令语义：

```bash
npm install -g devcodex # 安装全局 CLI，并由 postinstall 配置五宿主用户级 adapter
npm update -g devcodex  # 升级全局包，并由 postinstall 刷新五宿主用户级 adapter
npm install devcodex    # 仅加入当前项目依赖；不配置宿主，并提示必须使用 -g
```

GlobalOnlyHostConfigModeV1 与 GlobalOnlyWorkspaceCleanModeV1 将宿主配置、共享 full fallback、active Skills 与工作区运行态分离；bare `devcodex init/update` 也不会创建或修改工作区 `.gitignore`：

```
<user-home>/
├── .copilot/       ← Copilot CLI 用户级 instructions/hooks/MCP/Skills/runtime
├── .claude/        ← Claude 用户级 instructions/settings/runtime
├── .codex/         ← Codex 用户级 AGENTS/hooks/config/runtime
├── .gemini/        ← Gemini 用户级 instructions/settings/runtime
├── .grok/          ← Grok 用户级 plugin/config/runtime
└── .agents/
    ├── devcodex/instructions.full.md ← 用户级完整回退规范
    └── skills/                       ← 共享用户级 Skills

<workspace>/
└── .devcodex/      ← workspace-namespace 的 Profile、记忆、报告与运行态
```

bare `devcodex init/update` 只管理 `.devcodex`。若当前路径没有可复用的祖先 workspace marker，且不存在旧版项目运行态，首次执行会原子创建 `.devcodex/layout.json` 并采用 `workspace-namespace`；若祖先已存在有效 marker，则沿用祖先 owner；本地 marker 非法时返回 `WORKSPACE_LAYOUT_INVALID`，旧 `.devcodex/profile`、`.memory` 等运行态存在时返回 `WORKSPACE_LAYOUT_MIGRATION_REQUIRED`，不会静默切换目录，需先执行 `devcodex migrate-layout plan/apply`。`devcodex init --claude`、`devcodex init --codex`、`--host`、`--gemini`、`--grok`、裸 `devcodex uninstall` 以及 `uninstall --host grok` 首批均返回结构化错误 `CLI_HOST_CONFIG_GLOBAL_ONLY`。安装与更新错误会指向 npm 全局命令；卸载错误会明确首批不支持自动删除用户级配置。现有工作区宿主文件不会被自动迁移、覆盖或删除；删除前仍需用户明确确认。

Grok 全局刷新会先识别所有同名 plugin identity：受管 canonical、已知 legacy 与受管恢复来源会经官方 `grok plugin uninstall/install` 收敛为一个 canonical identity；任意未知同名来源会在写入前阻断。收敛前保留配置、registry 证据及 source/installed 字节快照，不直接改写 Grok registry，也不自动删除旧工作区 source。

Grok 默认兼容加载 `~/.claude/settings.json`。其中由 DevCodex 管理的 Claude hooks 若收到 Grok 的 camelCase payload 与 snake_case 事件，会安全跳过重复 lifecycle；Grok 专用 plugin 保持唯一 owner，用户自己的其他 Claude 兼容 hooks 不会被整体禁用。

Claude 默认把用户级 MCP managed segment 写入 `~/.claude.json`；若显式设置 `CLAUDE_CONFIG_DIR`，则跟随 Claude 的配置隔离语义写入 `<CLAUDE_CONFIG_DIR>/.claude.json`，不会把 instructions/hooks 与 MCP 拆到两个配置身份。

## 使用

全局安装后，Copilot、Claude Code、Codex、Gemini CLI 与 Grok 从各自用户级配置根加载 DevCodex；工作区只提供 `.devcodex` 上下文和运行态。无需在每个项目复制宿主目录，直接在目标工作区开始对话即可：

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

标准安装路径下，无需也不依赖 `@DevCodex`。Hook、Skill、MCP 与 controlling kernel 由 npm 全局安装写入用户级稳定 runtime；bare `init/update` 只管理 workspace `.devcodex`。

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

## 意图驱动的五宿主能力选择（Unreleased）

Phase 1 采用“薄 Rule + `host-capability-routing` Skill + 三份 V1 契约/本地 catalog”，不新增 MCP Tool。它解决的是开放式语义判断：先保留原始指令身份与既有 CP/Auto authority，再按 5 个逻辑宿主、8 个 surface variant 选择可证明的能力杠杆；证据不足时继续执行 portable path，而不是猜测 native 语法。

| 维度 | 实际收益 | 对应代价 / 边界 |
|---|---|---|
| 跨宿主一致性 | 同一意图使用统一字段、reason code 与 fallback，不再由各 Prompt 临时猜测宿主语法 | 必须长期维护 variant-aware catalog；宿主升级、协议或证据租约变化都会使旧条目 stale |
| 可验证性 | `CapabilityIntentDecisionV1`、`HostLeverCatalogV1`、`OriginalInstructionRefV1` 可做 schema、重复键、未知 variant、MCP absent 与过期证据负向测试 | 多出 1 个 active Skill、3 个 schema、catalog、helper、fixtures，以及 package/validation/Profile/文档消费者同步成本 |
| 安全与诚实边界 | native 只有在直接宿主 replay、完整生命周期、权限和用户 authority 同时满足时才 eligible；否则 portable-first | 当前 canonical native eligible=`0`，因此短期收益主要是减少错误声明和路由漂移，不是提高 native 自动化率 |
| 原指令连续性 | 保存 instruction ref、digest、scope 与 authority ref，避免摘要或派生 Prompt 覆盖用户原意 | 默认不复制完整原文；排查问题时需要回到被引用的 CP/task artifact，调试链更严格 |
| 运行时复杂度 | 不新增 server、协议协商、部署进程或网络依赖；MCP 缺失不影响主流程 | Skill 仍依赖模型完成开放式语义判断，不提供确定性远程执行、事务或跨进程共享状态 |

只有出现至少两个独立 runtime consumer，并且输入输出已确定、操作只读幂等、receipt/freshness/权限/取消/回滚与无损本地 fallback 都能冻结时，才重新评估 MCP Tool；若需求只是读取有界 catalog，优先评估 Resource / Resource Template。MCP Tool 的额外代价包括 server owner、协议/版本兼容、宿主协商、权限与审计、部署升级、失败恢复和 direct replay，因此不能只因“可以封装成 Tool”就升级。

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

### npm 安装与自动适配（本地开发语义）

| 命令 | 语义 |
|------|------|
| `devcodex global-adapters apply` | **源码维护者日常（R1a）**：从当前包根刷新用户级五宿主 adapter；支持 `--dry-run` / `--json`；不 pack、不 publish |
| `npm install -g .` | **本地旁路（R1b）**：全局安装当前目录并走 postinstall 刷新 adapter |
| `npm pack` + `npm install -g ./vextjs-devcodex-*.tgz` | **预发冒烟（R2）**：接近真实 tarball 安装面 |
| `npm install -g devcodex` | **已发布（R3）**：安装全局 CLI；`postinstall` 自动刷新全局宿主 adapter |
| `npm update -g devcodex` | **已发布（R3）**：升级全局包并 `postinstall` 刷新 adapter |
| `npm install devcodex` | 仅安装到当前项目依赖；`postinstall` 不写宿主配置并提示必须使用 `-g` |
| `devcodex update` | **workspace only（R4）**：只刷新当前 `.devcodex` 运行态，不写用户级宿主配置 |

`.devcodex` 仍采用 workspace-namespace；不会迁移到 npm global prefix。安装期自动适配默认 fail-soft，可用 `DEVCODEX_SKIP_POSTINSTALL=1` 显式跳过，CI、源码仓安装和传递依赖安装默认 no-op。当前阶段只验证本地 CLI / package lifecycle 语义，不验证 npm 包名 owner、registry、dist-tag 或版本唯一性；这些属于发布前验证。首批不新增 `devcodex global init`、`devcodex init --global` 或 `devcodex sync --global`，也不纳入 Enhanced RulePack、`rules.bin`、公开仓同步、反重包保护或 runtime start/stop/restart。

在 DevCodex 源码仓内运行 `status` / `doctor` 时，CLI 只比较“当前源码候选”与用户级已安装 receipt，不把候选差异解释为已安装包故障。JSON 会返回 `payload.globalHostComparison.scope=source-candidate-vs-installed-receipts`、`installedHealthClaim=false` 和 `hostParity.tier=source-candidate-comparison`；此时 `hostParity.checks`、`failedChecks` 与 `repairSteps` 为空，原始候选差异仅保留在 `withheld*` 证据字段。源码仓刷新用户级 adapter 优先 `devcodex global-adapters apply`；要验证「已安装包」健康度，也可 pack/tarball 全局安装后在源码仓外跑 `status` / `doctor`。

| 命令 | 说明 |
|------|------|
| `devcodex init` | 初始化当前 workspace 的 `.devcodex`；fresh workspace 自动建立 `workspace-namespace` marker，不创建五宿主目录 |
| `devcodex update` | 刷新当前 workspace 的 `.devcodex`；缺少 owner 时建立 namespace marker，不创建五宿主目录 |
| `devcodex global-adapters apply` | 从包根 apply 用户级全局 adapter（源码日常路径） |
| `devcodex init/update --host <id>` 及 legacy aliases | 拒绝并返回 `CLI_HOST_CONFIG_GLOBAL_ONLY`；请用 `global-adapters apply` 或 npm `-g` 路径 |
| `devcodex uninstall --host grok` | 首批禁用；不会自动删除用户级或工作区既有配置 |
| `devcodex uninstall` | 首批禁用；与带宿主形式返回同一 GlobalOnly 结构化错误 |
| `devcodex grok [Grok 参数]` | 使用用户级 Grok plugin/runtime 与全局 controlling kernel；从 cwd 发现 workspace `.devcodex` |
| `devcodex migrate-layout plan` | 生成 `.devcodex` 工作区集中布局迁移清单 |
| `devcodex migrate-layout apply --manifest <path>` | 按 manifest 执行集中布局切换 |
| `devcodex migrate-layout rollback --manifest <path>` | 回滚集中布局迁移 |
| `devcodex status [--json]` | 浅层状态：有界执行五宿主 adapter 契约探针，并检查 Copilot 投影与 Grok 静态合同；返回分层 readiness 和只读 `governanceSummary` |
| `devcodex doctor [--json]` | 深层诊断：在 status 基础上检查可用宿主原生版本、Grok canonical 唯一 identity、inspect 发现面、已安装 Hook 合同和 MCP initialize；返回同源分层 readiness |
| `devcodex probe [id ...] [--json]` | 运行同步、local-only、只读 typed probes；默认包含 host/workspace/profile |
| `devcodex trace show\|replay [--state <file>] [--json]` | 查看或校验重放当前 turn trace 的只读数据投影；不执行 payload 或 mutation |
| `devcodex task resolve <任务名> [--project <name>] [--json]` | 有界定位可恢复任务；只返回 identity/session/CP metadata，不执行历史 payload |
| `devcodex task verify [--task <id\|name\|current>] [--project <name>] [--full] [--json]` | 重新汇总 owner receipts 并输出唯一 completion projection；仅 committed complete/warning 返回 exit 0，未完成/风险为 1，selector/contract 错误为 2 |
| `devcodex task risk accept\|revoke --task <id\|name> ... [--json]` | 对当前 candidate 的可豁免 requirement 追加或撤销显式风险回执；non-waivable、过期或 scope 错误零写入 |
| `devcodex status\|doctor --completion [--task <id\|name>] [--project <name>] [--json]` | 只读查看 completion phase、first blocker 与建议动作；不触发 reconcile 或状态写入 |
| `devcodex trace show --completion [--task <id\|name>] [--project <name>] [--json]` | 只读查看 completion identity/lineage，不执行历史 payload |
| `devcodex skill plan <id...> [--mandatory <id...>] [--json]` | 生成 dependency-closed `BundleDecisionV2`，并内含 `BudgetDecisionV1.enforcementStatus/optimizedHit`；宿主不支持或 `full-only` 时回退完整 Skill 读取 |
| `devcodex help` | 查看 CLI 子命令与选项帮助 |
| `devcodex init --dry-run` | 预览 workspace `.devcodex` 初始化，不预览宿主复制 |

## `.devcodex` 工作区集中布局（v1.10.0+）

当工作区根存在 `<workspace>/.devcodex/layout.json` 且 `mode = workspace-namespace` 时，DevCodex 会从“项目根各自持有 `.devcodex`”切换到集中命名空间模型：

- 单项目任务：写入 `<workspace>/.devcodex/<project>/...`
- 全工作区任务：写入 `<workspace>/.devcodex/workspace/...`
- `config.json`：`workspace/profile` 作为 base，`<project>/profile` 作为 overlay
- `config.local.json`：与 `config.json` 采用相同的 `workspace/profile + <project>/profile` overlay 模型，可作为用户 / 项目指定的本地 overlay，承载长期连接、本地明文连接信息、env / secretRef 引用和 `extensions.<namespace>`；不覆盖 `mode` / `agent`；脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息默认可直写或沿用项目既有模式，只有用户或项目明确指定时才从这里取得
- Profile 文档：项目命名空间文件优先，缺失回退到 `workspace/profile`
- CLI / Hook 运行态目录：统一写 active-root；单项目为 `<workspace>/.devcodex/<project>/.memory|.audit-state`，全工作区为 `<workspace>/.devcodex/workspace/.memory|.audit-state`
- 宿主配置 owner：固定为各宿主的用户级配置根；共享 full fallback 与 Skills 固定在用户级 `.agents`；workspace-namespace 只决定 `.devcodex` active-root。任何子项目执行 bare `init/update` 都不会生成 `.github/.claude/.codex/.gemini/.grok/.agents`、`AGENTS.md`、`CLAUDE.md`、`GEMINI.md` 或 `.mcp.json`。
- 多项目 workspace 根缺少 workspace profile 时，Hook 提示真实路径 `.devcodex/workspace/profile/`；同一宿主会话已识别唯一项目后，后续“继续/确认”会在短 TTL 内沿用该项目和项目 `mode`，新会话、TTL 过期或显式 workspace 请求会重新判断。

配套 CLI：

```bash
devcodex migrate-layout plan
devcodex migrate-layout apply --manifest <manifest-path>
devcodex migrate-layout rollback --manifest <manifest-path>
```

> 真相源说明：bare `devcodex init/update` 会先查找当前路径及祖先的有效 `layout.json`。找到时复用其 workspace owner；fresh workspace 未找到时创建 `mode=workspace-namespace` 的 `.devcodex/layout.json`，随后 runtime / MCP / Profile 按 `.devcodex/workspace` 和 `.devcodex/<project>` 解析。`--dry-run` 只预览该 marker 和目标路径，不写文件；非法 marker fail closed。若无 marker 但已存在旧版 `.devcodex/profile`、`.memory`、`.audit-state`、`requirements`、`bugs`、`reports` 或 `data` 等运行态，则同样 fail closed，并要求先走显式 `migrate-layout`，避免旧状态被新 namespace 隐藏。启用后不得再向 `<project>/.devcodex/.tmp` 等旧项目内运行态目录写入产物。

## Profile 计划、生成与升级

> 发布状态：以下 `profile plan`、统一分档生成和安全迁移行为已随 **v1.15.3** 发布；安装当前包即可使用。

先预览，再写入：

```bash
devcodex profile plan
devcodex profile plan --tier profile-standard
devcodex profile init --tier profile-standard
devcodex status
```

自动化脚本可使用 `devcodex status --json` / `devcodex doctor --json`。两者只输出一个 `DevCodexCliEnvelopeV1` JSON 文档；非法参数返回稳定 `CLI_INVALID_OPTION` 和退出码 2，默认人读输出保持兼容。`payload.governanceSummary` 以 `GovernanceStatusSummaryV1` 只读汇总 runtime-state、Skill 生命周期/灰度状态、执行优化证据、Always-On surface/layer/host/shadow 状态、Gate registry、host truth、dirty boundary 和 fail-closed fast-path 决策，不创建或改写运行态文件。源码仓中的 JSON 诊断属于 `source-candidate-vs-installed-receipts` 比较面，明确返回 `installedHealthClaim=false`，不得用来声明已安装全局包健康或生成面向已安装包的修复动作。

本地维护者还可运行 `devcodex probe --json` 获取 host/workspace/profile 的 typed 只读结果，或用 `devcodex trace show|replay --state <lifecycle-state.json> --json` 检查 `LocalTaskTraceV1`。probe 不联网、不监听、不写状态；trace replay 不执行事件 payload，输出会携带源文件 SHA-256 便于 zero-write 对账。

- 首次创建默认目标是 `profile-lite`，命令会另外显示基于 package、脚本和目录证据得出的推荐档位；只有显式 `--tier` 才升级。
- 已有 Profile 默认继承当前档位；升级只补缺失文件并保留原正文。显式降档必须追加 `--allow-downgrade`，高档文件仍会保留。
- `profile plan` 等价于安全预览，和 `profile init --dry-run` 一样不会创建目录、文件或备份；`--force` 会在覆盖前备份。
- 三档默认生成矩阵为 **5 / 8 / 9**：lite 生成 README、01~03、config；standard 再生成 04/05/06；closed-loop 再生成 07。规范清单采用 `FeatureInventorySchemaV2` 十四字段表并兼容读取 V1；扫描无法证明的事实保持 `unverified`，不会因文档存在伪装成 implemented/validated/released。
- Skill portfolio 使用 schema v2：每项保留确定性 `SkillIndexV2` 投影；`BundleDecisionV1` 只读输出 selected/ignored/conflict/budget/exit，不修改 `plugin.json` lifecycle。portfolio 还绑定 tracked consumer inventory/projection digest；维护者在最终文件进入 index 后运行 `npm run test:skill-portfolio:staged`，提交后再于 clean tree 运行普通 `--check`。

完整命令、三档文件矩阵、迁移和排错见 [Profile 使用指南](./website/docs/guide/profile.md)。

## 意图驱动的上下文读取（v1.15.3）

> 发布状态：以下能力已纳入 v1.15.3 发布候选并通过 targeted/Hook/V99 验证；使用者仍应以目标 tag、package registry 和 release notes 为准。

在当前源码能力启用且宿主支持 DevCodex MCP 时，推荐使用以下生产主链，避免每条消息都把整套 Profile 与完整记忆注入上下文：

1. 从当前消息形成语义意图并确定唯一 project/active-root。
2. 调用 `profile_context_plan`：只返回 README/index、effective non-local config 与顶层文件 metadata，`01~09-*` 和 `config.local.json` 不在规划阶段预读正文；`ContextReadPlanV2` 同时携带身份绑定的 `ExecutionOptimizationPlanBindingV1`。
3. 用 `profile_load(files=[...], executionOptimization=<plan binding>)` 读取计划选中的 Profile 文件；记忆先调用 `memory_status`，仅在需要连续性时再调用 `memory_session_query` / `memory_summary_query`。load/skill 消费者不得为判断开关隐式重读 `config.json`。
4. 只有与 plan/epoch/target/source 精确关联且由 PostToolUse 观察成功的结果，才能形成 `ContextReadReceiptV2`（兼容 V1）；失败、不可观察或 fallback 结果保持 partial/unverified。
5. 用户/项目明确要求、audit/migration、低置信或必要来源缺失时可升级全量并记录原因；普通工具动作复用当前计划，只有目标、scope/action/risk、digest 或 compact/resume 漂移才重算。

旧的 no-args `profile_load`、`memory_session_read` 和 `memory_summary_read` 仍保留兼容性，但不再是推荐默认路径，也不能单独证明相关上下文已经完整加载。`config.local.json` 仍只有在用户或项目明确指定时才读取。

## 运行态派生索引（未发布）

当前源码为持续增长的 memory、运行态台账投影和报告目录增加
`DomainDerivedIndexV1`：Markdown/文件仍是唯一真相源，内容寻址 partition、immutable
manifest 和原子 `current.json` pointer 只负责加速。索引位于
`<active-root>/.runtime-state/derived-indexes/v1/`；损坏、陈旧、锁竞争或出现未登记
报告时自动回退现有 parser/path-stat 路径，查询本身不写文件。

- 现有 `memory_status`、`memory_summary_query`、`memory_session_query` 名称、输入、
  排序与字段不变，只增加 `indexReceipt/coverage`；受管 memory writer 成功后刷新
  current/month/day byte-range 分区。
- `status/doctor` 优先读取 compact runtime-state current projection；显式
  `check-runtime-state --write-index` 继续保留 legacy
  `.runtime-state/runtime-state-index.json`，并同时提交新分区。
- 报告工作流默认只查询 allowlisted roots 下的 `primary-report` metadata；evidence、
  artifact、generated copy 和 unknown 默认排除。宽分页通过 immutable `snapshotCursor`
  固定 manifest，下一页不重复全目录扫描；正文只在选定 pointer 后通过
  `hydrateReportEntry` / `hydrateReportEntries` 有界读取，metadata 导航可用
  `projection: "compact"` 减少交付体积。
- `npm run benchmark:runtime-indexes -- --root <active-root>` 使用 3 个独立进程、
  每项 5 次预热和 30 次测量。当前真实快照 W1/W3/W4 总读取量分别减少
  91.45% / 90.76% / 98.98%，W2 精确 session 减少 76.32%，公共投影零差异；
  token telemetry 不可见，因此这些结果只声明 bytes/latency 收益，不冒充 token
  实测。
- `npm run benchmark:report-index-wide -- --root <active-root>` 额外覆盖 W5A~W5D：
  全目录分页、60 天窗口、全文 hydration 与 compact projection；W2 这类微型精确
  查询的延迟继续作为观测项输出，不作为宽查询阻断验收。

## 项目侧执行链性能与稳定回滚（v1.15.3）

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

benchmark 输入/输出分别为 `ExecutionChainBenchmarkInputV1` / `ExecutionChainBenchmarkResultV1`。只有同环境、样本满足、correctness 全为 0、综合改善至少 25% 且回归/开销预算通过时才能标 accepted；否则如实保持 `provisional` 或 rejected。本节能力随 v1.15.3 发布，仍按 `full-only` kill switch 保留完整正确路径。

## Always-On 质量守恒诊断（Unreleased）

当前源码已将 always-on 优化拆为可验证诊断层，不直接改变默认注入行为：

- `scripts/lib/always-on-governance.js` 生成只读 `AlwaysOnSurfaceMatrixV1`、`AlwaysOnLayerMatrixV1`、`HostAdapterCompatibilityMatrixV1`、`AlwaysOnLoadReceiptV1` 与 `AlwaysOnShadowResultV1`。
- `npm run test:always-on-governance` 验证 source/workspace surface、`applyTo:"**"` budget、L0 强不变量覆盖、宿主声明上限、load receipt fail-closed 与 Q1~Q8 40 样本 Shadow。
- `devcodex status --json` / `doctor --json` 的 `payload.governanceSummary.alwaysOn` 只读显示 AO-0~AO-2 状态；`defaultBehaviorChanged=false`、`ao3Enabled=false` 是当前兼容边界。
- `scripts/validation-manifest.json` 已新增 `always-on-governance` 节点；fast/full/profile-deploy/package-release route 会把 Always-On 质量守恒纳入控制面回归。

AO-3 默认轻注入必须在 Shadow green 后单独确认，并继续受 `full-only` 和宿主能力证据上限约束。

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
#   user-global host adapters  configured/adapter/native 分层显示
#   workspace .devcodex        present
#   legacy host artifacts      none; expected
```

### 在 IDE 中验证规则自动生效

1. 用本地 tarball执行 npm 全局安装，再从目标项目执行 `devcodex init`
2. 重启 IDE
3. 运行 `devcodex doctor`，确认五宿主用户级 receipt 与 workspace `.devcodex` 分别就绪
4. Codex / Grok：使用隔离 HOME direct probe 验证用户级配置；不得用工作区目录存在冒充成功
5. Claude / Gemini / Copilot：执行 contract fixture；当前证据上限不得写成 direct verified
6. 确认目标工作区没有因安装新建 `.github/.claude/.codex/.gemini/.grok/.agents`、`AGENTS.md`、`CLAUDE.md`、`GEMINI.md` 或 `.mcp.json`

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
├── skills/        # Skill 详细检查标准（84 个，按 01-common §按需读取表 路由读取）
├── prompts/       # Prompt 模板（30 个）
├── hooks/         # 包内 Hook 配置与稳定 runtime 源；npm 全局生命周期投影到各宿主用户级目录
├── codex/         # Codex adapter 源模板（分发到 `.codex/hooks.json`，不是工作区部署副本 `.codex/`）
├── data/          # 运行时数据模板（分发到目标项目的空骨架）
│   ├── README.md
│   └── templates/ # 空模板：violations / pending-fixes / pending-issues / process-improvements / gap-registry
├── index.js       # CLI 入口（零依赖）
└── plugin.json    # 插件元数据
```

其中 `instructions.md` 汇总 Instructions 约束（15 个，含全部工作流规则）；宿主始终可见入口只投影受预算约束的精简 kernel。
Skill 详细检查标准（84 个，按需读取；具体路由仍以 `01-common` 的按需读取表为准）。

规范治理由 `spec-governance` 与 `spec-absorption` 分工：`spec-governance` 负责 `PostAssessmentGovernanceIntakeGate`、RecordRouter、真实落账验证、SCV 和 `GovernanceGateRegistry`；`spec-absorption` 负责最新可吸纳、仍需吸纳和 `.devcodex/*/data` 候选扫描、通用性证明、`AbsorptionCandidateMatrixV1` 结构化规划与分层实现。所有模式下每条非空用户消息都会先登记中性 candidate，再由 AI 在合理性评估、项目现实扩展和上下文归因后按语义形成 `GovernanceIntakeDecision`；关键词不具有触发或分类权威。复合意图逐项写入 `violations / pending-fixes / process-improvements（优化清单，PI） / pending-issues / gap-registry`，只有成功 PostToolUse 对当前 active-root 的精确台账写入及落盘 ID 复证后才算 verified；`record.none` 也必须提供完整 challenge evidence。

控制面与长流程当前有六类支撑型 Skill：`execution-contract` 约束 scope / allowedPaths / requiredArtifacts / consumerScope / validationRoute / deviationLog，`test-router` 统一选择验证路线，`release-verification` 在正式 tag / publish 前执行 R0~R7 发布验证链，`host-contract-verification` 负责 direct replay / fixture replay / bootstrap / workspace guard 证据，`source-consumer-sync` 负责 Concept Sync Map 与当前消费者同步边界，`requirement-parallel-orchestration` 负责多需求并行前的独立性判定、锁图、LaunchCard 与汇合协议。

发布前审查由 `audit-release` 承担：它是 audit 专项维度，审查 release readiness、发布说明质量、兼容/迁移风险、package/plugin 元数据、文档/Profile/website 同步、回滚策略、registry/tag 风险与发布后验收；它不替代 `release-verification`，也不执行真实 `tag` / `push` / `publish`。

README / 用户使用文档当前补充四类专项 Skill：`user-manual-authoring` 负责站点文档、最终用户手册、README、quick start、接入手册和 docs-first 用户手册的用户路径与信息架构；`readme-authoring` 负责把 README 默认主视角收口为用户 / 使用者优先；`audit-user-manual` 提供用户侧文档 review 聚合，覆盖项目文档、文档设计、菜单导航、sidebar、信息架构和生成站点；`audit-readme` 提供 README 专项能力，审查 README / 主入口文档的用户路径、快速开始、示例真实度、开发信息后置与消费链一致性。正式用户文档还执行 `UserPerspectiveDocsGate`、`UserDocsImmediateComprehensionGate`、`UserDocsPrimarySurfaceGate`、`FinalUserManualFirstGate`、`DocsSiteInformationArchitectureGate`、`UserManualFlowAndFailureGate`、`QueueDocsRealWorkflowGate`、`PublicUserDocsMaintainerBoundaryGate`、`DocsConsumerSweep` 和 `UserPathContractSweep`：检查文档是否足够详细、首次读者是否看得懂、功能覆盖是否完整、配置是否简单易懂、需求概况后是否先形成用户最终使用文档，首页首屏 / quick start / nav/sidebar / CTA / reference 是否优先服务用户使用，队列/异步场景是否覆盖真实工作流，公开用户路径是否排除了维护者 checklist / 内部同步清单 / 台账状态，以及 README / website / Profile / examples / templates / validate / 部署副本 / 代码消费点是否同步。

代码、文档、示例、fixture、quick start、技术方案和报告的专家型输出由 `expert-output-quality` 承接。`ExpertOutputQualityGate` 要求报告或文档不能只解释“fixture 能跑通”，还要给出生产推荐路径、框架原生能力、项目既有 helper、fixture/mock/demo 边界、反模式对照和证据矩阵；`OperationExplanationContractV1`、`CodeTruthEvidenceMatrixGate`、`SolutionFitAgainstRepoGate` 与唯一推荐门禁补齐操作来源、代码事实和收敛推荐；V84 负责同步 Skill、Prompt、执行消费者、README/website/Profile/changelog 和部署副本。

产品策略、开发者体验、UX 交互、前端架构、后端领域架构、生产可用性 / SRE、API 契约、外部集成、平台生态、AI Agent 系统、数据架构、安全威胁建模、质量策略、设计系统、无障碍/国际化、增长分析和商业模型由 21 个专家 Owner Skill 承接：`product-strategy`、`developer-experience-architecture`、`ux-interaction-architecture`、`frontend-architecture`、`backend-domain-architecture`、`production-readiness-sre`、`api-contract-architecture`、`external-integration-architecture`、`platform-ecosystem-architecture`、`ai-agent-system-architecture`、`data-architecture`、`security-threat-modeling`、`quality-strategy`、`design-system-architecture`、`accessibility-i18n`、`growth-analytics`、`business-model-review`、`distributed-systems-architecture`、`performance-engineering`、`privacy-compliance-architecture`、`ai-evaluation-engineering`。`growth-analytics` 与 `business-model-review` 为 P3 条件触发，不污染普通开发主路径；`ExpertOwnerSkillGate` 要求在技术方案、实施计划、TestRoute 和报告中记录 ownerSkill、triggerReason、requiredFields、validationRoute、skipReason 与 V85/targeted probe 证据，避免把专业判断只写成笼统的“从专家角度考虑”。

正式复审、ECR、发布前复审、多轮收敛和外部 finding 批次由 `review-checklist` 管理清单文件、冻结范围、逐项证据、遗漏逃逸分析、状态新鲜度和关闭结论；CP 确认后由 `PostConfirmationReviewScopeGate` 输出 ReviewGradeCard，并按 **轻量=R1 / 标准=R2 / 全面=R3 / 发布安全=R4** 定级（默认 R2；高风险升 R3+清单）。报告中的 `ReviewChecklistCompletenessGate` / `EvidenceExecutionGate` / `ReviewEscapeRecordGate` 必须引用该清单或说明 N/A。复审发现新遗漏时，先写 escape record 的 `escapedItem / whyMissed / prevention / checklistPatch / rerunEvidence`，再补清单、重跑验证并判断是否写 VL/PF/GAP。控制面/分级类**设计建议**须先做 source-root ExistingCapabilityInventory（`ControlPlaneAdviceInventoryGate`），不得仅凭对话理想矩阵定论。

自我进化、自动吸纳、模型辅助规范优化、自动补 Skill / Prompt / Probe 和自动治理候选由 `evolution-governance` 管理控制面；任何模型生成的规则或发版建议必须先作为候选记录 `EvolutionRun`，再由人工确认、`LayeredAbsorptionGate`、验证探针、部署副本同步和 release-verification 决定是否进入 active 规范。

&gt; ℹ️ 维护者状态文件（本仓库开发过程中累积的 violations/pending-fixes 记录）按 active-root 保存，例如 workspace-namespace 下的 `.devcodex/<project>/data/`，**不分发**给用户。

## 客户端支持矩阵（Client Support Matrix）

| AI 客户端 | 注入路径 | Bootstrap / Hook 护栏 | CP 门控 | 记忆/MCP | 等级 |
|---|---|:---:|:---:|:---:|:---:|
| **GitHub Copilot CLI** | 用户级 instructions、Hooks、MCP、Skills 与稳定 runtime | ⚠️ contract-fixture；原生 CLI 需 `doctor` 实测 | ⚠️ PreToolUse / Stop + 文本确认 | ✅ 用户级 MCP 配置 | 🟡 Fixture |
| **Claude Code (CLI/桌面端)** | 用户级 `CLAUDE.md`、settings、MCP 与稳定 runtime | ⚠️ contract-fixture；本机 direct probe 依环境而定 | ✅ Hook + 文本确认契约 | ✅ MCP 契约 | 🟡 Fixture |
| **Gemini CLI** | 用户级 `GEMINI.md`、settings 与稳定 runtime | ⚠️ contract-fixture；本机无 direct replay | ⚠️ Hook + fallback 契约 | ⚠️ 按宿主配置 | 🟡 Fixture |
| **Grok Build** | 用户级 plugin/config/runtime；`devcodex grok` 绑定全局 kernel | ✅ isolated direct probe；passive stdout 仍不计注入证据 | ⚠️ 仅 PreToolUse 可阻断 | ✅ 全局 MCP 契约 | 🟢 Direct probe |
| **Cursor IDE** | 需手工配置 `.cursor/rules` 或 root `AGENTS.md`（instruction-fallback；DevCodex **不**自动分发 Cursor 规则；HOST best-effort only） | ⚠️ 无 DevCodex 本地 Hook 硬拦承诺 | ⚠️ 仅文本 | ❌ | 🟡 Best-effort |
| **OpenAI Codex app/CLI** | 用户级 `.codex/AGENTS.md`、hooks、config 与 `.agents/skills/` | ⚠️ isolated direct probe；阻断输出按事件契约分级 | ⚠️ Hook + 文本确认 | ✅ 用户级 MCP managed block | 🟢 Direct probe |
| **ChatGPT 普通对话** | 不读取本地工作区 `AGENTS.md` / `.agents/` / `.codex/`；可手工粘贴规则 | ❌ | ⚠️ 文本 | ❌ | 🔴 Unsupported |

> **安装命令**：`npm install -g devcodex` 安装 CLI 并配置五宿主用户级 adapter；`npm update -g devcodex` 升级并刷新。当前候选用本地 tarball验证，不代表 npm registry 已发布。
>
> **Grok 全局插件**：plugin source、配置和稳定 runtime 均位于用户级 Grok 根；`devcodex grok` 从当前 cwd 发现 workspace `.devcodex`，不依赖工作区 `.grok` 或 `AGENTS.md`。`doctor/status` 读取全局 receipt；工作区旧插件只报告为 legacy。
>
> **能力差异**：🟢 Full = 已验证 Hook 事件 + MCP + 自动同步；🟡 Beta/Best-effort = 尚未达到 Full，具体能力以矩阵各列为准；🔴 Unsupported = 不在当前本地 adapter 发布范围。默认 `safety-only` 下，bootstrap / CP / auto 白名单等流程问题为提醒并继续，仅危险命令硬拦；设置 `DEVCODEX_HOOK_ENFORCEMENT=strict` 后，支持硬拦的事件才会停止流程。
>
> **MCP 边界**：Copilot CLI、Claude、Codex 与 Grok 的 MCP 配置指向各自用户级稳定 runtime；server 再从宿主 cwd 发现 workspace `.devcodex`。源码仓受版本控制的 `.mcp.json` 仅是包开发清单。Copilot IDE 与 Copilot CLI 是不同 surface，不能用 CLI 配置反推 IDE Hook/MCP 已生效。

### 当前 MCP 清单与新增能力判断

当前实现只有两个 stdio server：

| server | 已实现能力 |
|---|---|
| `devcodex-memory` | 10 个 Tools：任务解析、状态/会话/SUMMARY 查询与读写、会话分配、CP 摘要绑定确认 |
| `devcodex-profile` | 5 个 Tools：context plan、Profile load、Skill plan、mode、入口检查；另有 1 个 Prompt：`devcodex-init` |

两者当前握手协议为 `2024-11-05`，没有实现 MCP Resource、Resource Template 或 Tasks。新增 Rule/Skill、MCP Prompt/Resource/Tool、Task 增强 Tool、CLI 或 Hook 前，统一由 `spec-governance` 生成中央 `CapabilitySurfaceDecisionV1`；领域 Skill 只提供证据并引用 `decisionRef`。语义判断默认留在 Rule/Skill，确定且可调用的操作才考虑 Tool，有界可寻址内容才考虑 Resource，低频维护仍优先 CLI，宿主生命周期仍由 Hook 承担。完整矩阵与验证路线见 [MCP 能力边界与载体决策](./website/docs/specs/mcp-capability-boundary.md)。

### 用户可见交付与链接兼容

DevCodex 先用 `ArtifactDeliveryManifestV1` 对账所有内部产物；需要续接上下文时，可由同一 manifest 纯投影 `ArtifactAnchorProjectionV1`，只保存 canonical path、`contentDigest`、`projectionDigest`、`truthSourceKind` 与证据引用。用户面则由 `UserFacingArtifactSetV1` 确定性投影真正需要的文件，并通过 `DevCodexVisibleEnvelopeV1` 统一入口检查、确认、进度、完成结果与阻断信息。默认只显示最终报告、实际交付物和影响结论可信度的必要证据；session、daily、SUMMARY、task/checkpoint、raw receipt/manifest/ledger 仍会写入和验证，但不占用用户交付列表。

dev / fix / self-fix 宣告完成时，`completion-check` 还会投影 `FinalValidationSummaryV1` 短矩阵：列出权威命令与 `exitCode`、`runId` 或关键计数、`WorkspaceSyncStatus`、dirty boundary、push/tag/release/publish 边界；如果声明了 commit，还必须列 post-commit replay。长日志仍放在报告里，最终回复不能只写“全绿 / 已通过 / 详见报告”。

当最终回复或报告复用既有证据来支撑“已验证 / 推荐 / 可确认 / 已完成”时，还会投影 `EvidenceFreshness` 摘要：fresh 证据可复用；source/context/dependsOn/lease、artifact anchor、final validation summary 任一关键身份变化则要求重跑或降级；summary-only 证据不再单独支撑强结论。

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
| `profile/config.json → extensions.devcodex.workflowCompletion.mode` | `shadow` | 仅允许 `off / shadow / enforce / rolled-back`；当前未发布实现固定为 shadow，任务输入不能自行升级；真实 30 天/20 样本且 dev/fix 各 5 之前不得 enforce |

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
   - **Codex**：重新执行 `npm install -g devcodex`（首次/修复）或 `npm update -g devcodex`（升级），再重启 Codex。用户其它 `mcp_servers` 会保留
   - **Copilot CLI**：同一全局安装/升级会维护 `~/.copilot/mcp-config.json` 的 DevCodex managed servers，并保留用户其它 servers；重启 Copilot CLI 后用 `devcodex doctor` 核对原生 CLI 状态
   - **Copilot IDE**：不继承 Copilot CLI 的用户级 Hooks/MCP 就绪结论，仍按目标 IDE 自身能力验证
   - Claude 使用用户级 MCP 配置，不要求工作区 `.mcp.json`
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
- 无法允许 npm 全局安装向宿主的用户级配置根写入 managed segment 的环境

**前置条件**：
- Node.js ≥ 18（CLI 零依赖，仅使用标准库）
- 若维护或构建 `website/` 文档站，需要 Node.js `^20.19.0 || >=22.12.0`（Rspress 2 依赖要求）
- 已启用目标宿主的用户级规则/配置加载能力
- Copilot 路径：已安装支持的 GitHub Copilot IDE（VS Code / JetBrains 全量支持；Visual Studio / Xcode / Eclipse 部分支持，详见 §IDE 兼容性）
- Claude Code 路径：允许用户级 settings、hooks 与 MCP managed segment
- Codex 路径：允许用户级 `.codex/AGENTS.md`、hooks、config 与共享 `.agents/skills/`

## Tier 说明

DevCodex 的 `plugin.json` 声明 `tier: "free"`，所有 Skill 均标注 `tier: "free"`。这些 tier 字段是**面向未来的 prompt-level 声明**（供 `token-check` Skill 在 Agent 侧做软门控），**CLI 不做任何授权校验**：

- CLI 本身不做额外 license/tier 授权校验；当前 v1.15.3 通过 GitHub Packages 分发，registry 读取认证仍按平台规则执行
- 未来接入服务端 token 校验时，tier 字段才会生效
- 当前阶段 tier 仅作为规划信息，不影响功能使用

## Agent 入口

仓库内保留两个 Agent 文件（`agents/devcodex.agent.md`、`agents/devcodex-auto.agent.md`）作为包源码资产；GlobalOnlyWorkspaceCleanModeV1 首批不向工作区 `.github/agents/`、`.agents/` 或根级宿主入口分发。标准使用路径是：

- **推荐**：通过 `copilot-instructions.md` + `instructions/` 自动注入，直接在 Copilot Chat 对话即可
- **可选**：宿主自身支持用户级自定义 Agent 时按宿主能力启用；工作区不自动生成 Agent 文件
- **Codex**：通过用户级 `.codex/AGENTS.md` 自动注入总则，通过用户级 `.agents/skills/` 按需读取技能

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

当任务涉及多个需求、子 Agent、子会话或 worktree 时，先用 `requirement-parallel-orchestration` 生成 `RequirementIndependenceDecisionV1`。只有 `independent` 且 `ParallelLaunchCardV1` 校验通过时才允许隔离执行；`weakly-coupled-lock` 和 `serial-required` 继续由主会话单写者串行汇合。

## 许可证

AGPL-3.0-or-later © Rocky / [vextjs](https://github.com/vextjs)
