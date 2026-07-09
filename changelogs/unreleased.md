# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/releases/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 当前未发布变更

- 2026-07-09：新增 `expert-output-quality` 专家型产物质量 Skill 与 `ExpertOutputQualityGate` / `ProductionRecommendedPathGate` / `FrameworkNativeCapabilityFirstGate` / `FixtureBoundaryDisclosureGate` / `AntiPatternContrastGate` / `ExpertEvidenceMatrixGate`，同步 dev-plan-review、dev-docs、audit-document/readme/user-manual/project/tech-design、test-router、report、Prompt、README/website/Profile 和 V84 探针，防止把 fixture/mock/demo、硬编码单例或每个 route 重复声明误写成生产推荐实践。
- 2026-07-09：修复 `validate-profile` 档位检测在 workspace fallback 与项目本地 Profile 混合时可能被 fallback `profile-lite` 误导的问题；项目本地显式 `Profile 档位` 现在优先，新增回归测试覆盖 standard 项缺少 04/05 时必须失败，支撑 `ProfileTierStandardGate` / `AllDevCodexProfileValidationGate` 的真实退出码验证。

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
- 宿主输出、Hook 或项目现实扩展相关条目，建议显式写出 `verified-present / verified-missing / unverified`、sticky `activeProject` 与用户可见 `意图扩展摘要` 是否发生变化。
- 执行闭环、确认机制或发布门禁相关条目，建议补充 `Intent Expansion Card`、`ConfirmationRequest`、`ECR` 与验证证据，方便正式发版时直接归档到版本 changelog。
