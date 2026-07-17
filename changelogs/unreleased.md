# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/releases/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 当前未发布变更

### 2026-07-17

- 实现 `ContextAcquisitionGate` 的意图驱动上下文获取：新增 `profile_context_plan`、`memory_status`、`memory_session_query`、`memory_summary_query` 与共享 `IntentSeedV1 / ContextReadPlanV1 / ContextReadReceiptV1`，Profile 规划阶段只读 baseline/metadata，任务正文和记忆改为 targeted bounded query；Hook 仅以精确关联的 PostToolUse 成功结果推进回执，Pre、失败、wrong-root、unobservable 与 legacy no-args full 均不能假完成。新增 full oracle、hidden-read 负例和 `V99`，保留旧 Profile/memory 工具兼容；当前仅为源码未发布增量，不改变 v1.14.0 release authority，也未执行 tag/publish。

### 2026-07-15

- 修复 `ProfileLifecycleClassificationGate` 的可执行语义：共享 contract 改为稳定基线/活文档/条件或本地文档三类独立 inspection，validator 输出逐类缺项，新增无关“本地/required/conditional”、三类单缺失、中英文完整声明与 workspace fallback/overlay 负向/正向夹具；同步修正 monSQLize closed-loop Profile 和原 F-012 尾项，不改变 Profile 档位或 CLI 契约。
- 实施 ISSUE-043 的 Turn Liveness P0/P1/P2：新增状态机、工具 lease、continuation ACK、checkpoint、`TurnRecoveryCard` 与跨重启重放，接入 `ai-agent-system-architecture` / `host-contract-verification` / `execution-contract` / `rework-prevention-engineering` / TestRoute / report / prompts / Profile，并以 V98、runtime replay、gray sidecar zero-write 与 package fixture 守门；Hook 仅具备事件到达时的历史停滞识别能力，sidecar 保持 one-shot gray，禁止自动唤醒、状态写入、进程控制和未知副作用重放。
- 新增 gray `brand-visual-quality` 与 `BrandVisualQualityGate`，覆盖 MasterLineage、ThemeGeometryParity、MicroOpticalVariant、MonoMaster、VisualEvidencePack、VisualBlockerReset；以 V97 正负 fixture 和独立前向试用守门，未形成真实 WorkUnit 前不晋级 active。
- `RuntimeStateTransitionProjectionGate` 将 append-only 历史迁移、当前权威投影、低权威 consumer drift 和真正 `CONFLICTING_CURRENT_STATE` 分离，保留 schema v1/read-only 兼容并降低 strict conflict 噪声。
- `ProfileReleaseTruthAuthorityMatrixGate` 以 package/plugin 为 DevCodex release authority，对账 project 01/05/07 与 workspace current claim；历史 release/versioned docs 不被批量误判。
- Skill portfolio 更新为当前源码 77（74 active + 3 gray），同步 gate registry、CP/TestRoute/report/prompts、README/website/Profile、V92/V95/V97 与 package closure；版本仍为 1.14.0，本批不 tag、不 publish。
- 吸纳 v2 规划的 A/B 本地薄切片：`status/doctor --json` 统一诊断 envelope、IntentConsistencyGuard-lite、Skill Portfolio schema v2/BundleDecisionV1、FeatureInventorySchemaV2 状态与证据投影，以及 typed local probe、双阶段 CheckpointValidation、`LocalTaskTraceV1` 与只读 `probe/trace` CLI；保留 CLI 人读、Profile V1 兼容、77/74/3 lifecycle 和 Hook 无事件不自唤醒边界，版本仍为 1.14.0。

## 记录提示

- 控制面 / 长流程 / 多批次变更写入本文件时，优先标明 `execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync` 等支撑型能力是否同步更新。
- 剩余 `data` 吸纳守门类变更需显式标明 `ProductRequirementTraceabilityGate`、`PackageNameAuthorityGate`、`V2MCPFirstPlanningGate` 等关键门禁，避免正式发版前遗漏 V62 覆盖链路。
- 最新 `data` 吸纳守门补强需显式标明 `WorkspaceDataAbsorptionScopeGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`MethodLevelLeakPressureProbe` 与 `V2FormalSolutionPackage`，避免正式发版前遗漏 V63 覆盖链路。
- 最新高保真 UI / 提交授权 / 兼容契约吸纳守门需显式标明 `FigmaHighFidelityRestorationGate`、`ActualPreviewChainAndMockFallbackGate`、`ExplicitCommitAuthorizationGate`、`CompatibilityAndContractAuthorityGate` 与 `PublicDocsReleasedVersionGate`，避免正式发版前遗漏 V65 覆盖链路。
- 最新复审与文档体验吸纳守门需显式标明 `ReviewDimensionDeltaGate`、`UserPerspectiveDocsGate`、`DocsConsumerSweep`、`ArtifactLinkSetDedupeGate` 与 `FrontendRuntimeNetworkProbeGate`，避免正式发版前遗漏 V66 覆盖链路；已归档发布项保留历史关联 `PI-052 / PF-056`。
- 最新公开用户文档与最终汇报吸纳守门需显式标明 `PublicUserDocsMaintainerBoundaryGate` 与 `ActiveRequirementFinalResponseGate`，避免正式发版前遗漏 V67 覆盖链路；已归档发布项保留历史关联 `PI-053 / PI-054 / PF-057 / PF-058`。
- 最新用户文档主面与需求状态同步守门需显式标明 `RequirementVerdictStateSyncGate`、`UserDocsImmediateComprehensionGate` 与 `UserDocsPrimarySurfaceGate`，避免正式发版前遗漏 V69 覆盖链路。
- 最新用户文档驱动交付链、复审证据化、生成站点与性能回归守门需显式标明 `UserFacingDeliveryChainGate`、`ReviewChecklistCompletenessGate`、`EvidenceExecutionGate`、`BuiltArtifactFeatureSmokeGate`、`TscOutputImportProbe`、`GeneratedSiteGate`、`UserPathContractSweep` 与 `BenchmarkRegressionGuard`，避免正式发版前遗漏 V70 覆盖链路。
- 分层吸纳架构变更需显式标明 `LayeredAbsorptionGate`、`LayeredAbsorptionDecision`、`ProactiveBetterAlternativeGate`、`SkillFirstAbsorptionGate`、`CapabilityToSkillPromotionGate`、`SkillAbsorptionDecision`、`user-manual-authoring` 与 `review-checklist`，避免正式发版前遗漏 V72 覆盖链路。
- 完整吸纳补强变更需显式标明 `ConfirmedAbsorptionCompletenessGates`、`evolution-governance`、`EvolutionCapabilityControlPlaneGate`、`PublicSurfaceClosureGate`、`RemoteCIParityPushGate`、`FrontendAsyncCacheRenderGate`、`StaleWhileRevalidateGate` 与 `DocsThemeRuntimeVisualProbeGate`，避免正式发版前遗漏 V73 覆盖链路。
- 历史通用规范分层迁移需显式标明 `HistoricalCommonNormLayeringGate`、逐文件审查矩阵、`legacy-index-retained`、V74/V75 探针、`PromptLongGateListDriftProbe` 和部署副本同步，避免旧通用长清单继续回流。
- 复审遗漏闭环需显式标明 `ReviewEscapeRecordGate`、escape record、`whyMissed`、`prevention`、`checklistPatch`、`rerunEvidence` 和 V76 探针，避免二次复审只修问题但不沉淀防复发机制。
- 发布 / pack / install smoke 验证需显式标明 `NativeCommandExitCodeGate`、真实 `exitCode`、PowerShell `$LASTEXITCODE` 或等价 wrapper、auth/config 来源和 V77 探针，避免命令失败后仍输出成功文案。
- 确认后复审、开发偏移、验证计划、用户建议采纳和文档 IA 相关变更需显式标明 `PostConfirmationReviewScopeGate`、`DevelopmentDriftGate`、`VerificationPlanMaterializationProbe`、`AcceptedSuggestionRootCauseGate`、`ChinesePrimaryExpressionGate`、`SidebarPageRoleMaterializationProbe`、`SidebarGroupSemanticModelProbe` 和 V78 探针。
- coverage 与外部 runtime 生命周期类变更需显式标明 `CoverageGateDecision`、`ExternalRuntimePluginLifecycleGate`、`ExternalRegistryLifecycleMatrixGate`、`FunctionSourceFingerprintMatrixGate`、`ClusterEscalationGate`、`RiskBasedValidationLadder` 和 V79 探针，避免测试断言通过、happy path 或单例函数对象被误当成完整验证。
- 用户侧文档 review 聚合入口变更需显式标明 `audit-user-manual`、`UserManualReviewScope`、`DocsNavigationReviewMatrix`、`SidebarPageRoleMaterializationProbe`、`GeneratedSiteGate`、`DocsThemeRuntimeVisualProbeGate` 和 V80 探针，避免只补写作 Skill 而遗漏项目文档、菜单导航、生成站点和报告证据。
- 规范吸纳执行入口变更需显式标明 `spec-absorption`、`CommonNormGeneralizationGate`、`AbsorptionCandidateConsumerProofGate`、`project-local`、`case-evidence-only`、`targetOwner` 和 V81 探针，避免把项目独有规则误吸纳为通用规范。
- A1~A10 最新吸纳执行包需显式标明 `LatestAbsorptionExecutionPack`、`ConfigCanonicalNamespaceGate`、`ProfileRuntimeContractSyncGate`、`BehaviorSemanticDocsParityGate`、`NegativeTranslationParityProbe`、`DocsExampleTruthSurfaceGate`、`CallbackExampleScopeProbe`、`DerivedMetricConsumerProbe`、`DerivedConsumerFailureInjectionProbe`、`FeatureInventoryProfileGate`、`FeatureChecklistEvidenceMatrixGate`、`BatchEvidenceLedgerStateGate`、`BatchProgressCardGate` 和 V82 探针，避免名称只停留在扫描报告或候选表。
- Profile 三档与全项目校验变更需显式标明 `ProfileTierStandardGate`、`ProfileLifecycleClassificationGate`、`AllDevCodexProfileValidationGate`、`profile-lite`、`profile-standard`、`profile-closed-loop`、`validate-all-profiles` 和 V83 探针，避免只更新单项目 Profile 而遗漏 `.devcodex` 下其他项目。
- 专家型产物质量变更需显式标明 `expert-output-quality`、`ExpertOutputQualityGate`、`ProductionRecommendedPathGate`、`FrameworkNativeCapabilityFirstGate`、`FixtureBoundaryDisclosureGate`、`AntiPatternContrastGate`、`ExpertEvidenceMatrixGate` 和 V84 探针，避免只优化文案但继续把测试夹具或低阶重复写法误导成生产推荐路径。
- 专家 Owner Skill 变更需显式标明 `ExpertOwnerSkillGate`、`product-strategy`、`developer-experience-architecture`、`ux-interaction-architecture`、`frontend-architecture`、`backend-domain-architecture`、`production-readiness-sre`、`api-contract-architecture`、`external-integration-architecture`、`platform-ecosystem-architecture`、`ai-agent-system-architecture`、`data-architecture`、`security-threat-modeling`、`quality-strategy`、`design-system-architecture`、`accessibility-i18n`、`growth-analytics`、`business-model-review`、`distributed-systems-architecture`、`performance-engineering`、`privacy-compliance-architecture`、`ai-evaluation-engineering` 和 V85 探针，避免只写“专家视角”但没有 ownerSkill、字段、消费者和验证证据；增长 / 商业需保留 P3 条件触发与 `N/A + skipReason`。
- 项目/目录分析、审查和扫描必须先执行 `ProjectArtifactScaleRoutingGate`：识别项目与 root，采集文件数、可解析字节、最大文件、目录集中度、派生产物比和消费者扇出，再选择 single-pass / batched / sampled+deep-read / blocked；`skill-gap-analysis`、`skill-lifecycle-governance` 与 V91 防止大目录无界扫描和 Skill 组合无治理增长。
- 记忆启动链真相源变更需显式标明 `MemoryCannotSatisfyBootstrapGate`、`navigation-hint`、`load-profile`、`memory`、test-router、report、README/website/Profile、V86 探针和来源台账回写，避免内置 Memories 被误当 bootstrap / CP / 报告 / 验证证据。
- 修复协作契约变更需显式标明 `DualLayerRepairCollaborationContract`、`repair-collaboration`、lightweight/full、`authorizationEvidence`、`findingToPatchMap`、`handoffIntegrity`、`independentReReview` 和 V87 探针；模型名称不得成为触发条件。
- Profile 真相、安全审查呈现与发布凭据拓扑变更需显式标明 `ProfileTruthReconciliationGate` / V88、`AuthorizedLocalSecurityAuditPresentationGate` / V89、`PublisherCredentialTopologyGate` / V90；报告/文档不得让过期 Profile 覆盖代码事实、不得承诺绕过平台安全控制、不得包含 secret value。
- 宿主输出、Hook 或项目现实扩展相关条目，建议显式写出 `verified-present / verified-missing / unverified`、sticky `activeProject` 与用户可见 `意图扩展摘要` 是否发生变化。
- 执行闭环、确认机制或发布门禁相关条目，建议补充 `Intent Expansion Card`、`ConfirmationRequest`、`ECR` 与验证证据，方便正式发版时直接归档到版本 changelog。
