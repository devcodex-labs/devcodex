# 开发规范

> AI 在执行 dev/fix 工作流时，除遵守 instructions 约束外，还须遵守本页项目级规范。

---

## 各组件使用规范

> 遇到新任务时，先判断用哪个组件，再动手创建文件。

| 场景 | 用哪个组件 | 理由 |
|------|-----------|------|
| 需要始终约束 AI 的规则 | Instructions | 每次会话自动注入，不需要手动触发 |
| 按需触发的工作流 | Skills（SKILL.md 完整内容）| AI 按需读取，包含完整工作流检查标准与执行步骤 |
| CP 节点的结构化输出 | Prompts | 有参数、有格式的单次任务 |
| 会话开始/结束的自动动作 | Hooks | 确定性执行，AI 无法跳过 |
| 定义 AI 的工具权限和运行模式 | Agents | 只有两个（确认模式/全自动模式）|

> ℹ️ **当前实现**：SKILL.md 包含完整的工作流内容（触发条件 + 检查标准 + 执行步骤）。v2.0.0 规划中可能演进为 Skills（薄壳路由）+ MCP 工作流分离架构。

---



| 文件 | 何时填写 | 填写内容 |
|------|---------|---------|
| `design.md` | CP2 方案确认后 | 技术方案、文件变更清单、风险与约束 |
| `plan.md` | CP3 实施计划确认后 | Phase 分阶段步骤表（步骤/文件/说明/状态）|
| `progress.md` | 每次会话后更新 | 各步骤状态更新 + 会话记录追加 |
| `decisions.md` | 有重大决策时 | D-NNN 格式，记录背景/决策/原因/影响 |

> ⛔ `design.md` 和 `plan.md` 在对应 CP 通过前**不填写实质内容**，只保留"待撰写/待制定"占位。

---

## 组件使用规范

> 核心原则：**用对组件**——不要把工作流内容放进 Instructions，也不要把全局约束放进 Skills。

| 场景 | 用哪个 | 禁止误用 |
|------|-------|---------|
| 定义 AI 身份和工具权限 | **Agents** | ❌ 不要写进 Instructions |
| 按需触发的工作流技能 | **Skills** | ❌ SKILL.md 包含完整内容（触发条件 + 执行步骤） |
| 始终有效的规范约束 | **Instructions** | ❌ 不要写进 SKILL.md |
| CP 节点结构化输出 | **Prompts** | ❌ 不要在 SKILL.md 内联模板 |
| 生命周期事件强制执行 | **Hooks** | ❌ 不要用 Instructions 模拟 Hooks |

### Skills 编写规范

```markdown
---
name: dev-default              # 必须与文件夹名完全一致
description: "Use when: ..."   # 必填，AI 靠这个发现 Skill
---

# dev-default Skill

## 触发条件
...

## 执行步骤
...

## 检查标准
...
```

- SKILL.md 包含完整的工作流内容：**触发条件** + **执行步骤** + **检查标准**
- 每个 Skill 目录只有一个 `SKILL.md`，扁平一级目录
- 支撑型 Skill（如 `execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync`）不能新增工作流分支；必须被 instructions、模板、报告、validate 与用户文档同时消费
- `analyze-default` 承接默认分析工作流的只读多轮、代码事实优先、analyze-lite CRS、PCV 和推荐结论；`instructions/13-analyze.instructions.md` 只保留入口与路由索引，避免分析默认路径继续堆在 instructions。
- **规范吸纳执行入口**：最新可吸纳、仍需吸纳、开始吸纳或扫描 `.devcodex/*/data` 时先触发 `spec-absorption`，执行 `CommonNormGeneralizationGate` 与 `AbsorptionCandidateConsumerProofGate`，证明通用规范价值、剔除项目独有残留、绑定 DevCodex 当前消费者和 targetOwner；`ServiceSpecReadGate` 这类项目私有规则只作为负向样例或 case evidence，不进入通用规范。
- **最新吸纳执行包 A1~A10**：确认实施最新可吸纳清单时，按 `LatestAbsorptionExecutionPack` 和 `GovernanceGateRegistry` 分组同步 `ConfigCanonicalNamespaceGate`、`ProfileRuntimeContractSyncGate`、`BehaviorSemanticDocsParityGate`、`NegativeTranslationParityProbe`、`DocsExampleTruthSurfaceGate`、`CallbackExampleScopeProbe`、`DerivedMetricConsumerProbe`、`DerivedConsumerFailureInjectionProbe`、`FeatureInventoryProfileGate`、`FeatureChecklistEvidenceMatrixGate`、`BatchEvidenceLedgerStateGate` 与 `BatchProgressCardGate`；V82 探针负责核对 Skill、Prompt、TestRoute、report、README/website/changelog、Profile、部署副本和来源台账回写。
- **记忆启动链真相源**：`MemoryCannotSatisfyBootstrapGate` 要求宿主 Memories、模型长期偏好、SUMMARY 或 ContextHandoffCard 只能作为 `navigation-hint`；新线程、resume、summary 恢复、compact 后继续或跨项目切换时仍必须读取当前 active namespace 的 Profile、tasks、reports、review checklist 和源码 / 文档真相源，V86 探针负责核对 `load-profile`、`memory`、TestRoute、report、README/website/Profile、changelog 与部署副本。
- **分层吸纳架构（兼容 Skill-first 吸纳架构）**：用户建议、data 台账、复审发现或新守门项准备吸纳时，先执行 `spec-absorption`，再执行 `LayeredAbsorptionGate`，并兼容 `SkillFirstAbsorptionGate` / `CapabilityToSkillPromotionGate`，输出 `LayeredAbsorptionDecision`（含 `SkillAbsorptionDecision`）。分类只能是 `global-invariant`、`existing-skill-subgate`、`new-skill-required` 或 `docs-only`；若具备独立触发词、产物、状态、模板、检查矩阵或跨工作流复用价值，应沉淀为新 Skill 或现有 Skill 子门禁，并同步 prompts/templates、执行消费者、验证探针、公开文档和部署副本，不能只继续塞进通用守门长列表。采纳用户建议前还要执行 `ProactiveBetterAlternativeGate`，有更优方案必须先提出取舍；采纳用户纠正时执行 `AcceptedSuggestionRootCauseGate`，记录 whyMissed、采纳依据、台账编号和防复发动作。
- **历史通用规范分层迁移**：整理旧吸纳项、通用 instructions 长清单、prompt/report 重复清单或跨版本规范资产时，执行 `HistoricalCommonNormLayeringGate`。实施前先冻结逐文件审查矩阵，标注 `targetLayer`、`targetOwner`、`semanticStrength`、`validation` 与 `skipReason`；当前消费者同步到 Skill、Prompt、TestRoute、report、document-sync、V74/V75 validate 探针、README/website/changelog、Profile 和部署副本。`PromptLongGateListDriftProbe` 用 SCV 负向样例防止旧 Gate 长清单回流，当前 README、website 和 prompts 只写 `GovernanceGateRegistry` 分组与代表锚点；旧规则尚未找到同等强度承接方时只保留为 `legacy-index-retained`，不把新 Gate 正文继续追加回通用层。
- **完整吸纳补强门禁**：用户确认“未完整吸纳 / 半覆盖 / 仍需吸纳”时执行 `ConfirmedAbsorptionCompletenessGates`，按 `LayeredAbsorptionGate` 补齐 commonInstruction、skill、promptTemplate、executionConsumer、validationProbe、publicDocs 与 deployCopy；具体 Gate 由 `GovernanceGateRegistry` 分流到 `public-surface / user-manual / review-checklist / frontend-runtime / profile-service / release-parity / evolution-control-plane`，代表锚点包括 `PublicSurfaceClosureGate`、`UserManualProductizationGate`、`ReviewAnchorMaterializationGate`、`FrontendAsyncCacheRenderGate`、`RemoteCIParityPushGate`、`NativeCommandExitCodeGate` 与 `DocsThemeRuntimeVisualProbeGate`；自我进化控制面进入 `evolution-governance`。
- **V95 完整性门禁**：完整/最终 Agent 架构、用户文档受众与渲染顺序、独立消费者仓/跨仓 100%、逐模块性能维护分别由 `AgentCapabilityDomainCompletenessGate`、`DocsAudienceRoleAndRenderedSequenceProbe`、`ConsumerValidationEngineeringGate`、`ModulePerformanceCoverageAndMaintenanceGate` 承接。`consumer-validation-engineering` 冻结两仓 identity、artifact/lock/pack、适用分母、跨仓 CI 与 freshness；realpath、结构存在或单 benchmark 不能替代完整证据。
- **消费者设计适配与修复闭环**：跨仓行为测试通过后仍执行 `DesignFitnessGate`，逐功能核对用户主路径、默认值、配置层级、框架约定、公共面、生命周期、组合、兼容权威和维护成本。finding 进入获授权的 `ValidationFindingRepairLoop`；source mutation 会使旧 identity 与受影响证据 stale，并以新 identity 重跑失败探针、同类边界、影响回归和必要全量消费者验证。
- **V96 剩余吸纳控制**：多批次用 `CurrentBatchScopeDiffProbe` / `NewValidationConsumerRebindProbe`；discriminated contract 用 `ContractVariantIsolationMutationGate`；多阶段需求用 `PhaseDeliverySemanticGate` 区分规划与源码交付；完整用户手册场景用 `ScenarioCoverageMatrixProbe`，队列/批处理追加 `DurableBatchOrchestrationProbe`。每项都有正负 fixture，名称出现不等于执行通过。
- **V97 品牌视觉质量与运行态真相补强**：品牌母版、主题/尺寸变体、微尺寸或单色资产生产触发 gray `brand-visual-quality`，需要五类产物、自动检查、人工结论和 blocker reset；runtime-state 同时区分历史迁移、当前同权威冲突与低权威 consumer drift，Profile current release claim 以 package/plugin authority 对账。新 Skill 尚未发版，结构探针通过不代表已满足 active 晋级证据。
- 发布前审查使用 `audit-release` 专项维度，负责 release readiness 风险审查；它与 `release-verification` 的 R0~R7 执行验证链必须保持边界清晰
- 站点文档、最终用户使用文档、README、quick start、接入手册或公开能力页默认先触发 `user-manual-authoring`，其中 README 分支再叠加 `readme-authoring`；审查用户侧文档、项目文档、文档设计、菜单导航、sidebar 或信息架构时先触发 `audit-user-manual` 聚合入口，再按目标叠加 `audit-readme` / `audit-document`；正式用户文档同步执行 `UserPerspectiveDocsGate`、`UserDocsImmediateComprehensionGate`、`UserDocsPrimarySurfaceGate`、`FinalUserManualFirstGate`、`DocsSiteInformationArchitectureGate`、`UserManualFlowAndFailureGate`、`QueueDocsRealWorkflowGate`、`PublicUserDocsMaintainerBoundaryGate`、`DocsConsumerSweep` 与 `UserPathContractSweep`，检查第一次成功、常见任务、字段/参数/状态/错误解释、排错恢复、低心智负担、功能完整性、配置易懂性、首次读者即时理解，需求概况后是否先产出用户最终使用文档，站点文档 / README / quick start 的首页首屏、nav/sidebar、CTA 和 reference 是否优先服务用户使用而不是开发契约，队列/异步场景是否覆盖真实工作流，公开用户路径不混入维护者 checklist / 内部同步清单 / 台账状态，以及 README / website / Profile / examples / templates / validate / 部署副本 / 代码消费点同步
- 代码、文档、示例、fixture、quick start、技术方案和报告需要体现资深技术专家 / 架构师 / 领域专家口径时触发 `expert-output-quality`。`ExpertOutputQualityGate` 要求先给生产推荐路径、框架原生能力和项目既有能力，再说明 fixture/mock/demo 边界、反模式对照和证据矩阵；不得把测试夹具、硬编码单例或每个 route 重复声明包装成推荐实践。V84 探针负责核对 Skill、Prompt、TestRoute、report、README/website/changelog、Profile 和部署副本。
- 需求、方案、代码、文档或报告命中产品策略、开发者体验、UX 交互、前端架构、后端领域架构、生产可用性 / SRE、API 契约、外部集成、平台生态、AI Agent 系统、数据架构、安全威胁建模、质量策略、设计系统、无障碍/国际化、增长分析或商业模型时触发对应专家 Owner Skill：`product-strategy`、`developer-experience-architecture`、`ux-interaction-architecture`、`frontend-architecture`、`backend-domain-architecture`、`production-readiness-sre`、`api-contract-architecture`、`external-integration-architecture`、`platform-ecosystem-architecture`、`ai-agent-system-architecture`、`data-architecture`、`security-threat-modeling`、`quality-strategy`、`design-system-architecture`、`accessibility-i18n`、`growth-analytics`、`business-model-review`；分布式系统、性能工程、隐私合规、AI 评测分别触发 `distributed-systems-architecture`、`performance-engineering`、`privacy-compliance-architecture`、`ai-evaluation-engineering`。`growth-analytics` 与 `business-model-review` 为 P3 条件触发，未命中时写 `N/A + skipReason`；`ExpertOwnerSkillGate` 要求写明 ownerSkill、triggerReason、requiredFields、validationRoute、skipReason 和 V85/targeted probe 证据。
- 正式复审、ECR、release pre-review、多轮收敛或 finding 批次必须触发 `review-checklist`：先创建或复用复审清单，冻结范围、维度和证据路线，逐项更新状态；CP 确认后由 `PostConfirmationReviewScopeGate` 判定轻量或全面复审；不得只按审查报告文字验收，也不得在没有新增维度或新增覆盖证据时机械刷零发现。`ReviewEscapeRecordGate` 要求发现原清单遗漏时先追加 escape record，记录 `escapedItem / whyMissed / missingDimensionOrProbe / prevention / checklistPatch / rerunEvidence`，再补清单、重跑验证并判断是否写 VL/PF/GAP；`ChecklistStateMaterializationGate` 要求 clean/closed 前重开清单并物化 header、items、round、ledger、progress、closure 六区块一致快照。
- 编码前和实施中执行 `DevelopmentDriftGate`，核对 `allowedFirstBatch / blockedScope / driftTriggers / validationRoute`；CP2 和技术方案执行 `VerificationPlanMaterializationProbe`，把验证计划、验收标准和退出条件写成可 grep 证据；中文用户文档和文档站 IA 执行 `ChinesePrimaryExpressionGate`、`SidebarPageRoleMaterializationProbe` 与 `SidebarGroupSemanticModelProbe`。
- `ProfileTruthReconciliationGate` 由 `load-profile` 统一承接：项目级 analyze 使用 targeted 模式，audit 使用 full/Profile Freshness Check（PFresh）模式并反查 repo shape 与 Profile 档位/生命周期文件；`ProfileTruthMatrix` 记录 profileClaim、actualSources、status、conclusionAuthority 与 correctionRoute。只读工作流只矫正结论，不直接修改 Profile；V88 负责正负向同步验证。
- 授权本地安全审查执行 `AuthorizedLocalSecurityAuditPresentationGate`：显式记录授权与防御目标，用户可见层只呈现最小必要证据，完整复现留在隔离本地探针；内容不可见或额外安全检查发生时保存 `SafetyInterruptionCard` 并从审查状态恢复，不通过改写绕过平台控制。V89 负责同步探针。
- 首次发布或 publisher/repository/package/registry/auth topology 变化时执行 `PublisherCredentialTopologyGate`：核对 identity、secret scope/access/inheritance、workflow permission、package ownership 与最近成功 run；workflow 相同不等于凭据等价，验证中不得读取或输出 secret value。普通 patch 可记录 unchanged evidence；V90 与 ReleaseVerification R0~R7 共同守门。
- scoped package 发布到多个 registry 时执行 `ScopedRegistryResolutionGate`：同时核对 global registry、`@scope:registry`、userconfig 与命令级 override，并用独立目标查询证明两条通道未被同一 scope 路由污染；V92 与 targeted fixture 负责防回归。
- audit 执行 `AuditMutationBoundaryGate`：只写审计报告、audit-state、记忆和运行态台账；finding 先记录/交接，源码、规范、配置、测试、文档或部署副本的修复必须经用户显式授权后进入独立 fix/self-fix，audit 不自动写源、`git add` 或继承修复权限
- repair task 执行 `repair-collaboration`：所有修复至少有 lightweight 决策/验收层与执行/验证层；P0/P1、安全、控制面、公共契约、≥5 文件、多批次、角色交接或发布风险使用 full，并用 `findingToPatchMap`、`handoffIntegrity`、`independentReReview` 和 acceptance matrix 关闭。触发依据是修复语义与风险，不是模型名称或是否切换 Agent
- 重复复审、返工率或一次通过率治理触发 `rework-prevention-engineering`：以 WorkUnit/ReworkEvent 区分 defect、requirement gap、implementation error、verification gap 与 environment noise，执行双重根因、ReworkRiskProfile、前瞻 trial 和 `ReworkEffectivenessLoop`；没有至少 3 个可比较 WorkUnit 或 2 个独立上下文的前瞻证据时保持 gray，不得用历史复盘或指标美化直接宣称有效。审查覆盖声明、最终产物交付、未发布兼容判断、最小配置和可交互对象分别绑定 `ReviewCoverageClaimIntegrityGate`、`ArtifactDeliveryCompletenessGate`、`ReleaseAuthorityBeforeCompatibilityGate`、`ConfigurationErgonomicsGate` 与 `InteractiveSemanticProbe`，由 V94 复证
- Profile 按 `profile-lite` / `profile-standard` / `profile-closed-loop` 三档维护：[Profile 使用指南](./profile.md)提供 `profile plan` → init → status 用户路径；`ProfileGenerationContractGate` 统一生成/加载/状态/校验契约，`FeatureInventorySchemaGate` 要求 `FeatureInventorySchemaV1` 结构化清单，`ProfileTierMigrationSafetyGate` 验证 dry-run 零写入、升级保留和降档授权；`ProfileTierStandardGate` 检查必需文件，`ProfileLifecycleClassificationGate` 区分稳定基线、活文档和条件 / 本地文档，`AllDevCodexProfileValidationGate` 在规范维护、workspace-namespace、SDK/CLI、文档站、public API 或用户要求全 `.devcodex` 校验时执行 `node scripts/validate-all-profiles.js --workspace <workspace-root>`；V83 同时运行 CLI 与 validator 负向探针，历史兼容 warning 和阻断 error 必须分开记录
- 项目工程 / 代码质量审查必须执行 `PE-12 资源生命周期与泄漏风险`：检查内存泄露、资源泄漏、监听器/定时器/连接/流未释放、缓存无界增长、组件卸载清理缺失，并在不适用时写明 `N/A + skipReason`
- 写测试用例或回归验证时必须执行 `LeakRiskStabilityPressureTest` 条件判定：命中长运行服务、高并发路径、缓存/队列/连接池、监听器/定时器、连接/文件/流/socket/worker、订阅、前端组件生命周期或 `PE-12` 风险时，TestRoute 纳入泄漏风险稳定性压测；证据至少包含基线、压力场景、冷却后回落、资源指标前后对比和清理结果。低风险纯单元测试、静态文档或无长生命周期资源变更可写 `N/A + skipReason`
- 存在 coverage 阈值、CI coverage 或发布覆盖率要求时执行 `CoverageGateDecision`，不能用单元断言通过替代覆盖率门禁通过；外部 runtime/plugin/registry/adapter/provider、injected runtime、owner mutation 或 function source fingerprint 风险执行 `ExternalRuntimePluginLifecycleGate`、`ExternalRegistryLifecycleMatrixGate`、`FunctionSourceFingerprintMatrixGate`、`ClusterEscalationGate` 与 `RiskBasedValidationLadder`，覆盖生命周期矩阵、registry 矩阵、fingerprint 误判矩阵和同风险簇分层验证
- 前端页面、组件、控制台、官网、文档站、可视化工具或游戏任务必须执行 `FrontendExperienceQualityGate` 条件判定：覆盖设计来源、UI 还原度、风格主题一致性、响应式和状态覆盖、视觉验证、用户流、交互反馈、输入方式/可访问性、错误恢复、动效转场；Figma/截图/既有页面还原追加 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate`、`VisualDeviationTypeGate` 与 `DesignFramePurposeClassificationGate`；浏览器验证先执行 `FrontendBrowserVerificationBudgetGate`，用户明确自验或禁止浏览器/截图时执行 `UserSelfVerificationOverrideGate`；命中时 TestRoute 需要 Browser/截图、Playwright/E2E、console/network/resource/runtime、代码级替代验证或人工复核证据，纯后端/CLI/文档写 `N/A + skipReason`
- audit / review / ECR 的复审覆盖增量必须维护 `ReviewCoverageDelta` 与 `ReviewDimensionDeltaGate`：每轮列出 `ReviewedSet`、`UnreviewedRelatedSet`、`NewlyReadThisRound`、`RepeatReadReason`、`NoNewSurfaceReason`、`PreviousDimensionSet`、`CurrentDimensionFocus`、`NewDimensionRationale` 与 `RepeatedDimensionReason`，优先阅读此前未审查但相关联的代码、配置、测试、文档、部署副本和消费者链，并避免每轮机械重复同一组维度；无新增覆盖、无新增维度焦点且无证据化理由时，不计入有效零发现
- 所有模式下若用户建议经验证更优且可泛化，或暴露规范未定义/不完整，应主动触发 Improvement Intake：写入 `data/process-improvements.md`（优化清单，PI），必要时联动 `data/pending-fixes.md`，并显式回执 `PI/PF`
- 若新的需求、bug 或批次直接来源于 `data/*.md` 的 open/partial 项，进入 CP1 / 问题确认前必须先做 Backlog Intake 真相复核：把候选项分成 `pure-open / residual-tail / already-fixed / misclassified`，避免把“已修但未回写”的条目继续按纯 open 统计
- 当实施或复审改变了 VL / PF / PI / ISSUE / GAP 的真实状态时，必须执行台账状态回写闭环：回写状态、验证证据、验证时间和关闭/部分完成说明，并复核 open 计数是否与进度、报告、SUMMARY 一致
- 新增/升级依赖、框架、SDK、平台 API 或外部模块时，CP2 必须包含 `OfficialDocsEvidence`：官方文档来源、版本/日期、关键用法、限制、兼容性和降级来源；不能只验证“包能安装”
- dev/fix 改动项目技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema 时，必须执行 `ProfileImpactCheck`，同步 Profile 或在报告中写明 `skipReason`
- 若 AI 为验证启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，必须执行 `ServiceLifecycleCleanup`：记录命令/cwd/PID/job/端口/URL，验证完成、失败或最终回复前关闭仅由 AI 本轮启动的服务并核验端口释放；用户要求保留时记录 PID/端口和关闭方式
- 通用工程守门：Node.js 项目默认 `engines.node` / CI / Profile / README 不低于 `>=18`；需求/问题定义阶段先做平台工程判断，确认消费者范围、共享契约边界、模块职责、维护成本和非目标；JS/Node 必要注释使用标准 JSDoc；依赖升级或兼容修复必须拆分 `业务源码平滑性` 与 `依赖层落地条件`；包/库/adapter/CLI 同时检查代码实现层和包工程层；简单 service 不重复 route/model/schema 已承担的校验、归一化和配置兜底；新增跨项目经验吸纳项进入 `CrossProjectLearnedGuards` 前必须先通过 `LayeredAbsorptionGate` / `SkillFirstAbsorptionGate`，确认不属于新 Skill 或既有 Skill 子门禁，并同步 prompts/templates、执行消费者、探针、公开文档和部署副本；跨项目经验按 `GovernanceGateRegistry` 填写 `gateGroup / ownerSkill / validationRoute / skipReason`，代表锚点包括 `CodeTruthRequirementGate`、`ManualReviewEvidenceRetention`、`ReviewFindingIntakeGate`、`UserDocsPrimarySurfaceGate`、`ActiveRequirementFinalResponseGate`、`MethodLevelLeakPressureProbe`、`BenchmarkRegressionGuard` 与 `V2FormalSolutionPackage`
- 可配置并发策略：Profile `config.json` 可配置 `extensions.devcodex.concurrency`；默认 `mode=auto` 采用 `parallel prepare, serial commit`，只读准备和隔离验证可按上限并行，同一 active-root 的 CP 状态、记忆、报告、台账、audit session、source mutation、package boundary 和危险操作保持单写者；保守项目可设 `mode=serial`
- 验证卫生与包边界：release / pack / benchmark / codegen 任务中，package boundary check 必须在构建完成后单独串行执行；pack/publish/install smoke、CLI replay 和 curl/git/npm/node/PowerShell/Bash wrapper 必须记录真实 command/shell/cwd/exitCode，不能用成功文案替代原生命令退出码；消费者验证异常先查 package.json、lockfile、node_modules 与 `npm ls <关键依赖>`，最终收尾前清理无关 dirty 文件和验证残留
- 文档阅读顺序同步：正文、README 或维护者文档定义“先看什么 / 审查顺序 / 实施顺序”时，website sidebar/nav、索引页和目录页必须作为当前消费者同批校验；信息架构故意不同序时要说明差异
- v2.0.0 规划：MCP `devcodex_getWorkflow()` 替代文件读取



| 文件 | 何时填写 | 填写内容 |

1. **更新步骤状态**：在 `progress.md` 对应步骤行，将 `⬜` 改为 `🔄`（进行中）或 `✅`（完成）
2. **追加会话记录**：在 `progress.md` 会话记录表追加一行

   ```markdown
   | 2026-04-04 | 简述本次做了什么 | 完成了哪些步骤 |
   ```

3. **需求完成时额外执行**：
   - 更新 `index.md` 页眉状态为 `✅ 已完成`
   - 更新 `requirements/index.md` 总览表状态列
   - 在 `CHANGELOG.md` 追加完成记录

---

## 关键决策记录格式（decisions.md）

```markdown
## D-NNN：<决策标题>

**日期**：YYYY-MM-DD
**背景**：[为什么需要做这个决策]
**决策**：[决定了什么]
**原因**：[为什么这样决定]
**影响**：[对哪些文件/模块有影响]
```

- `NNN` 从 `001` 起递增
- 只追加，不修改已有记录
- 最新决策在最下方

---

## 执行上下文（当前规则）

`.devcodex/profile/config.json` 中的 `mode` 字段当前已经参与正式的 `ENV_MODE` 行为分叉，不再是 Draft 或预留能力。

当前规则：

- **`mode: "dev"`**：进入实质任务前输出 PC0~PC7 入口检查，PC4 执行完整规范雷达，并在收尾执行 FC / SC / RC / T 合规检查
- **`mode: "prod"`**：进入实质任务前仍输出 PC0~PC7 基础入口检查，PC4 标注 N/A；不执行后置合规检查，但 CP1 / CP2 / CP3 仍然强制
- **执行模式与 `ENV_MODE` 分离**：确认模式 / 全自动模式属于 Agent 入口语义；当前全自动正式入口包括显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `config.json` 的 `extensions.devcodex.autoAliases` 替换别名与明确自然语言 auto 授权，且只有在 hook-enforced 宿主 + 白名单路径上形成 runtime 级自动推进；配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；模糊提及、询问 auto 规则、未生效昵称或普通“继续”不算授权
- **并发策略与 `ENV_MODE` 分离**：`extensions.devcodex.concurrency.mode=auto` 默认允许只读准备、只读子 Agent 分析和隔离验证并行；`mode=serial` 退回全串行；核心单写者域不是项目可删除配置，`allowParallelMutations` 不是合法字段

> 当前正式规则源以 `instructions/01-common.instructions.md`、`instructions/17-compliance.instructions.md` 和 `skills/cp-gate/SKILL.md` 为准；本页负责解释这些规则如何落到日常开发流程中。

### 项目现实扩展

日常开发中，DevCodex 不应只按用户字面关键词决定工作流。当前正式流程为：

```text
语义意图初判 → 目标项目/Profile 加载 → 项目现实扩展 → 最终工作流/子类型
```

项目现实扩展至少要检查目标项目、真实影响范围、关联文件族、产物落点和验证方式；若项目未明确，必须先澄清，不能为了扩展意图而无界扫描工作区。

### 治理意图按评估结果分流

每条非空用户消息先登记一个中性 candidate，但这不代表一定要写治理台账。AI 必须先完成合理性评估、项目现实扩展和上下文归因，再形成结构化 `GovernanceIntakeDecision`；关键词或固定措辞只可辅助检索，不能决定是否触发、归类或跳过评估。

同一消息可同时形成多个 `record.*` 意图，必须分别对应 PI/PF/VL/GR/ISSUE 台账和证据。支持 Hook 的宿主只在成功 PostToolUse 精确写入当前 active-root 台账、且落盘文件存在相同 ID 时标记 verified；失败、错误 root、不可观察结果或只在回复里写编号都保持 unverified。instruction-fallback 宿主在报告和记忆保留同样字段与人工复证路线。`record.none` 不是默认兜底，也要说明 no-governance-impact、scope=none、规则状态和具体 skipEvidence。

### Intent Expansion Card

非 chat 工作流在 CP1 / 问题确认前需要形成 Intent Expansion Card，记录 `semantic`、`project`、`continuity`、`action`、`domain`、`artifact-impact`、`risk`、`host-capability`、`validation-route`、`confidence`、`alternatives`。这张卡用于把入口判断、CP 产物和压缩恢复后的复核锚在同一组事实上。

dev 模式默认向用户展示完整 Intent Expansion Card；prod、instruction-fallback 宿主或低风险轻任务才退化为 3~5 行摘要。

当项目现实扩展导致路由变化、命中控制面或宿主能力差异、风险不为 normal、`confidence` 非 high，或跨会话 resume 时，用户面还应输出 3~5 行意图扩展摘要。摘要只保留语义初判、扩展后路由、关键风险、验证路线和备选路径。

### Context Rehydration Contract

压缩恢复、resume、summary 恢复，或用户明确要求“按文件真相重建”时，必须按以下优先级重建上下文：

1. 当前用户消息
2. 已确认需求/bug 产物
3. 当前任务 `sessions.md`
4. 当日 `tasks/YYYYMMDD.md`
5. Agent `SUMMARY.md`
6. compaction / summary 摘要
7. AI 当前推断

摘要只能作导航提示，不能覆盖文件真相源；若文件态和当前推断冲突，必须重建 Intent Expansion Card。

### ContextHandoffCard

跨会话、跨 Agent、多批次、summary/compact 前或用户要求传递上下文时，交接方必须在报告或 daily tasks 写入 `ContextHandoffCard`，覆盖 `source-of-truth`、`confirmed-decisions`、`open-risks`、`next-action`、`blocked-reason`、`must-not-overwrite`、`validation-state` 与 `artifact-links`。恢复方仍按 Context Rehydration Contract 核对文件真相源，不能用 handoff 覆盖已确认产物、sessions、tasks 或 SUMMARY。

### SimpleTaskFastPath

非常明确、预计 ≤2 个源码/文档文件、无公共 API/Schema/依赖/配置/发布/控制面/台账来源/高风险、无需多轮跟踪的简单 dev/fix 任务，可免建需求/bug 目录、`00-需求概况.md`、`00-需求变更概况.md`、`00-问题概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、`01-问题确认.md` 或 `04-实施计划.md`。AI 必须在报告/记忆写明 `SimpleTaskFastPath: applied`、`N/A + skipReason`、验证证据和升级回退判断；执行中任一条件失效时，立即升级回完整 CP/产物链。

若用户是在调整/修改/补充既有需求或问题，且已有 `00-需求概况.md`、`00-需求变更概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、`00-问题概况.md`、`01-问题确认.md` 或其他需求/bug 真相源，则命中 `ExistingRequirementArtifactOverride`：SimpleTaskFastPath 只允许不新建完整产物，不能跳过文件回写；AI 必须先更新已有文件，再在回复中摘要说明。

### ArtifactDecisionMatrix

CP1 / CP2 / CP3 / ECR 会按任务规模列出关键产物的 `create` / `update` / `skip` / `N/A` 状态，覆盖入口类型、`00-需求概况.md`、`00-需求变更概况.md`、`00-问题概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、`01-问题确认.md`、`02-技术方案.md`、`04-实施计划.md`、`05-实施进度.md`、`06-关键决策.md`、目标文档、报告和记忆。判定优先级固定为：已有真相源回写 > 任务触发条件 > SimpleTaskFastPath > 子类型豁免。

这意味着技术方案、实施计划和实施进度不是“所有任务都机械创建”。一旦命中轻路径或 docs/init 等 CP3 豁免，AI 必须写清 `N/A + skipReason` 与升级回退条件；一旦已有需求/问题真相源，则必须先更新文件。

### ImplementationComplexityLevel

CP1 需求/问题确认必须记录开发程度等级：`简单够用`、`中等` 或 `企业级`（兼容旧字段 `ImplementationComplexityPreference`）。用户未要求复杂化、需求未说明或简单方案可满足已确认产品事实源和业务目标时，默认选择 `简单够用`，优先局部补丁、既有模式和最少维护成本；AI 可以展示更高级方案，但若判断需要升级到 `中等` / `企业级`，必须先列出 2~3 个方案、开发周期、难度、维护成本、非目标和取舍，等待用户确认后再进入 CP2/CP3。

### Hook closure 三态

Hook Stop / PreCompact 的可见回复验证区分 `verified-present`、`verified-missing`、`unverified`。无法解析最终 assistant 内容时，提示“无法验证最终用户可见回复”并给出 payload capture 指引；只有已解析且确实缺入口检查时，才提示 `entry check block 未输出`。Codex adapter 默认注册 `PreCompact`，并用 `manual|auto` matcher 覆盖手动与自动压缩触发。

### ECR 执行闭环复审

dev/fix 完成前必须执行 ECR 执行闭环复审。ECR 会交叉验证 CP1/CP2/CP3、报告、daily tasks、SUMMARY、diff/commit、测试/探针和 git dirty 边界，确认没有“报告已完成但证据不足”或“SUMMARY 已完成但 daily 仍未闭环”的状态错配。

当任务触发 ExecutionContract、TestRoute、ReleaseAudit、ReleaseVerification、ConceptSyncMap、HostContractVerification 或 `05-实施进度.md` 时，ECR 必须把这些产物纳入关键证据；未触发时报告中写明 N/A 依据。

控制面或模板-示例-校验链任务要先建立 Concept Sync Map：至少写清 `sourceOfTruth`、`currentConsumers`、`historicalMirrors`、`validateProbes`、`deployCopies`、`yellowDeviationBoundary`。其中当前消费者必须同批同步，历史镜像只有在明确标注历史性质时才允许保留旧口径。

`OfficialDocsEvidence` 与 `ProfileImpactCheck` 属于 dev/fix 的前置和收尾证据：前者防止依赖、框架、SDK 或平台 API 用法靠猜；后者防止项目事实已经变化但 Profile 仍停留在旧技术栈、旧目录或旧验证路线。

`ServiceLifecycleCleanup` 属于测试路线和 ECR 证据：AI 自己启动的 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，验证结束后必须主动关闭并核验端口释放；非本轮 AI 进程只报告线索，不擅自终止。

Hook / CLI / visible reply / sticky project / workspace guard 相关任务还要补 HostContractVerification 证据：至少说明 `hostSurface`、`eventScope`、`evidenceMode`、`visibleReplyEvidence`、`workspaceGuard` 与 `bootstrapScope`，避免把“文档已经写了”误当成宿主行为已验证。

### 敏感信息与连接配置

默认允许敏感信息、明文连接信息和硬编码出现在用户要求的代码、脚本、配置、文档、测试或报告中；只有用户 / 项目明确禁止时，AI 才脱敏、占位或改用 env、`secretRef`、secret manager、`config.local.json`。`.devcodex/**/profile/config.local.json` 只是用户 / 项目指定时使用的本地 overlay：可承载长期连接、本地明文连接信息、env / secretRef 引用和受控扩展位 `extensions.<namespace>`，不替代 `config.json`，也不能覆盖 `mode` / `agent` / `pluginVersion`。脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息默认可直写或沿用项目既有模式，只有用户或项目明确指定时才从这里取得；若项目使用本地连接别名、env / secretRef 或扩展位，需在 `01-项目信息.md` 或 Profile README 说明用途、字段语义和使用方式。

### 诊断与排错入口

- `devcodex doctor`：查看当前宿主、Hook、Profile、记忆与 adapter 状态，适合先判断“规则到底有没有加载”
- `devcodex help`：查看 CLI 子命令与参数，尤其是 `profile init`、`migrate-layout`、`init/update --claude/--codex`
- `node scripts/validate-all-profiles.js --workspace <workspace-root>`：校验 `.devcodex/workspace/profile` 与 `.devcodex/<project>/profile` 的三档必需文件和 workspace fallback；发布前可追加 `--strict-warnings`
- `DEVCODEX_HOOK_ENFORCEMENT`：默认 `safety-only`，仅危险命令硬拦；切到 `strict` 前应先确认宿主确实支持对应 Hook 事件；当前 Codex adapter 已内置 `PreCompact` compaction runtime 兜底
- `.mcp.json` 目前只由 Claude Code adapter 自动写入；Codex / Copilot 若宿主支持 MCP，需要手工配置，不能把 Claude 的 `.mcp.json` 当成三宿主通用入口
- Turn Liveness：工具返回后先进入 `awaiting-continuation`，120 秒无后续事件标记 `suspect`，300 秒标记 `stalled-recoverable`；活动工具/Agent 使用更长租约，避免把真实长任务误判为挂起
- 宿主能力边界：`PostToolUse` 不是 terminal，也不能证明宿主会继续派发事件；Hook 仅在下一次事件到达时生成一次性 `TurnRecoveryCard`，不得自行唤醒宿主、控制进程或重放未知副作用操作
- gray sidecar：源码仓运行 `npm run check:turn-liveness -- --state <lifecycle-state.json> --json`；安装包运行 `node node_modules/@vextjs/devcodex/scripts/check-turn-liveness.js --state <lifecycle-state.json> --json`。它只做 one-shot 读取/分类，证据状态为 `sidecar-observed`，不 watch、不写状态、不唤醒、不重放、不控制进程

### 产物链接与 MCP fallback

用户面产物路径必须按 `ArtifactLinkSet` 输出：主 Markdown 链接 + 必要 `绝对路径：` copy fallback。Copilot / JetBrains / Visual Studio 默认使用工作区相对 Markdown 链接，并强制追加绝对路径 fallback；Codex Desktop/App 可使用绝对路径 Markdown target；未知宿主或用户已反馈“无法点击”时同样必须追加绝对路径。输出前执行 `ArtifactLinkSetDedupeGate`：按 canonical path 去重同一物理文件的相对链接、绝对链接、报告/记忆/SUMMARY 引用和 fallback，避免宿主面板看起来生成了双份产物。

若 Copilot / Codex 等非 Claude Code 宿主在 `profile_load`、`profile_get_mode` 等 MCP 工具上出现 `Cannot read properties of undefined (reading 'invoke')`，按宿主 MCP bridge 失败处理：不要反复重试同一 MCP 调用，立即降级读取 `.devcodex/**/profile/`、`SUMMARY.md` 与当日任务记忆，并在 HostContractRoute 中记录 `mcpFallback=used`。

### 推荐结论与确认交互

分析、审计或执行报告存在多个建议/路径时，必须给出推荐结论与推荐理由；没有后续动作时写明“推荐：无后续动作”。用户确认先抽象为 ConfirmationRequest，再按宿主能力使用按钮、权限提示、Hook 阻断或文本确认 fallback。

ConfirmationRequest 是语义层抽象，不要求 runtime 逐字输出同名对象；不同宿主只需输出与各自契约匹配的按钮、阻断或文本确认结果。

### QuestionEvidenceGate 与对比调研门禁

当用户问“是否应该 / 哪个更好 / 有没有更好建议 / 推荐什么”，且结论会影响时间、金钱、架构、产品/项目路线或长期维护成本时，先执行 `QuestionEvidenceGate`。命中推荐、选型、同类产品或同类项目判断时，再执行 `ComparativeResearchGate`，比较同类产品 / 项目 / 本仓库相似模块 / 已有设计并说明证据范围；技术路线、架构优化、性能优化、框架能力设计或高维护成本方案在 CP1 最终需求确认前执行 `TechnicalRouteComparativeGate`，把证据范围和采纳 / 不采纳理由写入需求。纯解释、低风险本地事实或用户明确要求快速答复时，写 `N/A + skipReason`，避免把普通问答默认升级成重调研。

### 执行期 CP3 回退

若 dev/fix 任务在执行过程中实际变更范围扩展到 CP3 门槛（≥5 文件、高风险、控制面联动），必须暂停执行、回补 CP3，并把新增验证与回滚路线写入实施计划后再继续。

### 相关文件联查

当前正式规则要求：当任务涉及控制面规则、模板、接口契约/验证产物、工作区真相源/部署副本或发布口径变更时，AI 不能只看单文件结果，必须联查相关文件；若同时命中多真相源同步或模板-示例-校验链，需进一步升级为交叉验证或 `CRS`。

进度产物不是小任务默认文书；但跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面任务、模板-示例-校验链或部署同步联动时，必须在执行前初始化 `05-实施进度.md` 并随批次更新。默认前提是已有 `04-实施计划.md`；docs/init 等 CP3 豁免任务可使用已确认文档大纲、任务切片或 ContextHandoffCard 作为等价计划锚点。

---

## 架构约束动态更新说明

> ⚠️ **v1.0.0 仍在开发中**，`02-架构约束.md` 是动态演进的，不代表最终态。

- AI 读取时以**文件当前内容**为准，不推断或补全未写入的约束
- 发现新的约束边界 → 立即追加到 `02-架构约束.md`
- 约束废弃时 → 注明"已废弃：原因"，不直接删除（保留变更历史）

---

## 规范文件编写规则

| 规则 | 说明 |
|------|------|
| 语言 | agents/skills/instructions/prompts 统一用**中文**编写 |
| Skill 目录 | 必须是扁平一级目录，`name` 字段与文件夹名完全一致（小写+连字符）|
| Instructions | `applyTo: "**"` 全局注入，单文件 ≤ 500 行；500 行上限属于 DevCodex 规范资产写作约束，不机械约束业务需求、技术方案、报告或正式项目文档 |
| 文件名 | Instructions: `NN-<kebab>.instructions.md`；报告: `NN--<简述>.md`（双横杠）|
