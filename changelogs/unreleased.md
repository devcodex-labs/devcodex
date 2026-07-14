# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/releases/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 当前未发布变更

### 2026-07-14 — Profile 生成契约与功能清单闭环

- 新增 `ProfileGenerationContractGate`：`mcp/profile-contract.js` 成为三档文件集合、语义检查和功能清单 schema 的共享契约；CLI、加载器、状态和 validator 统一消费，默认生成矩阵固定为 5 / 8 / 9。
- 新增 `devcodex profile plan` 与真实 `--dry-run` 零写入预览，展示目标根、已检测/请求/推荐/目标档位和逐文件动作；未知参数与非法档位友好失败。
- 新增 `ProfileTierMigrationSafetyGate`：默认继承已有档位，升级只补缺失文件并保留正文，未授权降档拒绝，`--allow-downgrade` 仅调整声明并保留高档文件，`--force` 先备份。
- 新增 `FeatureInventorySchemaGate` / `FeatureInventorySchemaV1` 十字段规范表；校验器拒绝空表、纯项目符号、占位行、伪来源、01/06 重复规范真相源及裸版本号发布状态冲突。
- 强化 V83：除消费者术语同步外，执行 Profile validator 与 CLI 行为负向探针，覆盖 dry-run 写入、隐式降档、冲突档位、非结构化/空清单和重复 canonical source 假阳性。
- 同步 `profile-bootstrap`、`load-profile`、`dev-init`、Profile Prompt、TestRoute、report、README、website Profile 使用指南、active Profile 与部署副本；全工作区校验由 `AllDevCodexProfileValidationGate` 收口。

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
