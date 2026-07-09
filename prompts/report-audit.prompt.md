---
agent: agent
description: 审查工作流报告模板，用于 audit 工作流完成后输出标准审查报告
applyTo: ".devcodex/**/reports/audit/**, .devcodex/**/reports/self-fix/**"
---
# 审查报告模板

> **路径**: 优先 `<任务目录>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/audit/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: audit 工作流完成后，由 `report/SKILL.md` 驱动生成
> **字段约束**: 每条问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证（本模板 §3 问题清单已含五列示例表头）

---

```markdown
# [审查对象名称] 审查报告

> **项目**: <project>
> **类型**: audit
> **子类型**: [规范文件 / 技术方案 / 需求文档 / 项目工程 / 报告 / 通用文档 / 发布前审查]
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
> **审查目标类型**: 规范文件(D1~D25) / 技术方案(TD-1~TD-13) / 需求文档(RQ-1~RQ-8) / 项目工程(PE-1~PE-12) / 报告(RA-1~RA-6) / 通用文档(DA-1~DA-6) / 发布前审查(RL-1~RL-10)
> **审查范围**: 全面体检 / 定向深度 / 修复验证
> **收敛**: 连续 3 轮有效零发现（仍须满足连续 3 轮零发现；所有子类型统一，不区分定向/全面）
> **ReviewCoverageDelta**: ✅已核验 / ⚠️缺失 / N/A（说明）
> **ReviewDimensionDeltaGate**: ✅已核验 / ⚠️缺失 / N/A（说明）
> **PCV状态**: ✅已完成 / 🔄进行中
> **控制面证据**: Concept Sync Map / HostContractVerification / SCV / 新增探针 / 黄色偏离 / 部署同步（按适用填写）
```

## §1 审查轮次摘要

| 轮次 | 新发现问题 | 本轮解决 | 遗留 |
|:----:|:---------:|:--------:|:----:|
| R1 | X | 0 | X |
| R2 | Y | Z | W |

## §2 执行维度清单

**公共维度（G1~G5）**：✅ 全部执行  
**专属维度**：[已执行的维度编号列表]  
**N/A 维度**：[标注 N/A 的维度及原因]

## §2.1 ReviewCoverageDelta（复审覆盖增量）

> R2 及以后轮次必须填写；若为单轮审查或不适用，写 `N/A + skipReason`。R2+ 同步执行 `ReviewDimensionDeltaGate`，避免每轮机械重复同一组维度。

| 轮次 | ReviewedSet | UnreviewedRelatedSet | NewlyReadThisRound | RepeatReadReason | NoNewSurfaceReason | PreviousDimensionSet | CurrentDimensionFocus | NewDimensionRationale | RepeatedDimensionReason | 是否计入有效零发现 |
|:----:|-------------|----------------------|--------------------|------------------|--------------------|----------------------|-----------------------|-----------------------|-------------------------|:------------------:|
| R1 | 初始 CRS 范围 | | | N/A | N/A | N/A | 初始维度集合 | N/A | N/A | N/A |
| R2 | | | | | | | | | | ✅/❌ |

## §2.5 控制面同步证据（条件）

> 审查对象涉及规范源、Skill、Hook、CLI、模板、validate、README/website/Profile 或部署副本时填写；其他场景标 `N/A`。

| 项 | 内容 |
|----|------|
| Concept Sync Map | sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies / yellowDeviationBoundary |
| HostContractVerification | hostSurface / eventScope / evidenceMode / visibleReplyEvidence / workspaceGuard / bootstrapScope |
| 新增探针 | |
| 黄色偏离 | |
| 部署同步证据 | |
| CoverageGateDecision / RiskBasedValidationLadder | coverage 命令、工具、阈值、基线、当前值、passed/failed/known-red/N/A、targeted/related/full gate 层级和 skipReason |
| ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate / FunctionSourceFingerprintMatrixGate / ClusterEscalationGate | runtime/plugin/registry 生命周期矩阵、fingerprint false-positive/false-negative 样本、clusterId、whyMissed、冻结矩阵、停止条件、rerunEvidence |
| FrontendExperienceQualityGate | 设计来源 / UI 还原度 / 风格主题 / 响应式状态 / 视觉验证 / 用户流 / 交互反馈 / 输入方式 / 错误恢复 / 动效转场 / FigmaHighFidelityRestorationGate / ActualPreviewChainAndMockFallbackGate / RuntimeI18nArtifactVerificationGate |
| CrossProjectLearnedGuards | GovernanceGateRegistry gateGroup / ownerSkill / validationRoute / evidence / skipReason；anchors: CodeTruthRequirementGate / ManualReviewEvidenceRetention / ReviewFindingIntakeGate / UserDocsPrimarySurfaceGate / ActiveRequirementFinalResponseGate / V2FormalSolutionPackage |
| OmissionOnlyReviewGate | 已覆盖集合 / 新增覆盖 / 遗漏候选 / 排除理由 / 收敛状态 |
| ReviewFindingIntakeGate | finding 来源 / 本地证据 / must-fix-user-decision-docs-drift-test-gap-intentional-design-not-reproduced 分类 / 用户确认点 |
| ReviewDimensionDeltaGate | PreviousDimensionSet / CurrentDimensionFocus / NewDimensionRationale / RepeatedDimensionReason |
| UserPerspectiveDocsGate / UserDocsImmediateComprehensionGate / UserDocsPrimarySurfaceGate / PublicUserDocsMaintainerBoundaryGate / DocsConsumerSweep | 使用者视角 / 功能完整性 / 配置易懂 / 即时理解 / targetSurface / documentLocation / 首页首屏 / quick start / nav 主面 / 维护者 checklist 边界 / 字段与示例解释 / 当前消费者与导航同步 |
| UserFacingDeliveryChainGate / FinalUserManualFirstGate / DocsSiteInformationArchitectureGate / UserManualFlowAndFailureGate / QueueDocsRealWorkflowGate | 用户最终使用文档 / 文档站或 README 判定 / 前端或 API 契约 / 真实用户流 / 失败恢复 / 队列真实工作流 |
| audit-user-manual / UserManualReviewScope / DocsNavigationReviewMatrix | 用户侧文档 review、项目文档审查、文档设计、菜单导航、sidebar、信息架构、生成站点和文档站运行态验证 |
| ReviewChecklistCompletenessGate / EvidenceExecutionGate / ReviewEscapeRecordGate | 冻结 checklist / 逐项实际验证 / 重复维度规避 / 不按审查报告文本直接验收；若发现遗漏，写 whyMissed / prevention / checklistPatch / rerunEvidence |
| BuiltArtifactFeatureSmokeGate / TscOutputImportProbe / BenchmarkRegressionGuard | 构建产物导入执行 / TS 输出导入 / 性能基线对照阈值 |
| GeneratedSiteGate / ManualTocDuplicationGate / UserPathContractSweep | 生成站点产物 / TOC-sidebar-nav 去重 / 公开用户路径消费者同步 |
| ArtifactLinkSetDedupeGate / FrontendRuntimeNetworkProbeGate | 规范化路径去重 / 主产物消歧 / console-network-resource-runtime 证据 |
| ActiveRequirementFinalResponseGate | active requirement/task/bug id / 相邻需求未切换 / 最终回复范围 |
| spec-absorption / CommonNormGeneralizationGate / AbsorptionCandidateConsumerProofGate | 候选矩阵 / sourceNamespace / generalizationEvidence / projectSpecificResidue / negativeExamples / targetConsumer / devcodexConsumerEvidence / targetOwner / validationRoute / decision |
| LayeredAbsorptionGate / SkillFirstAbsorptionGate / CapabilityToSkillPromotionGate | LayeredAbsorptionDecision / candidateId / classification / targetSkill / ownedArtifacts / layerChecks / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy / validationRoute / consumerSync |
| HistoricalCommonNormLayeringGate | 逐文件审查矩阵 / targetLayer / targetOwner / semanticStrength / validation / legacy-index-retained / V74 / deployCopy |
| LatestAbsorptionExecutionPack A1~A10 | gateGroup / ownerSkill / validationRoute / V82 / ConfigCanonicalNamespaceGate / ProfileRuntimeContractSyncGate / BehaviorSemanticDocsParityGate / DocsExampleTruthSurfaceGate / DerivedMetricConsumerProbe / FeatureInventoryProfileGate / BatchEvidenceLedgerStateGate / BatchProgressCardGate |
| ProactiveBetterAlternativeGate | 用户方案 / 备选路径 / 推荐理由 / 取舍影响 / 采纳依据 |
| AcceptedSuggestionRootCauseGate | 采纳的用户纠正 / whyMissed / 采纳依据 / VL-PI-PF-GAP 编号 / prevention |
| PostConfirmationReviewScopeGate / DevelopmentDriftGate | CP 确认后轻量或全面复审判定 / review-checklist 路径或 skipReason / allowedFirstBatch / blockedScope / driftTriggers / validationRoute |
| VerificationPlanMaterializationProbe / docsIaReadability | 验证计划物化 / 验收标准 / 退出条件 / ChinesePrimaryExpressionGate / SidebarPageRoleMaterializationProbe / SidebarGroupSemanticModelProbe |
| ConfirmedAbsorptionCompletenessGates | gateGroup / ownerSkill / layerChecks / validationRoute；gateGroup anchors: public-surface / user-manual / review-checklist / frontend-runtime / profile-service / release-parity / evolution-control-plane；anchors: PublicSurfaceClosureGate / UserManualProductizationGate / ReviewAnchorMaterializationGate / FrontendAsyncCacheRenderGate / RemoteCIParityPushGate / NativeCommandExitCodeGate / DocsThemeRuntimeVisualProbeGate |
| NativeCommandExitCodeGate | release / pack / publish / install smoke / CLI replay 的 command / shell / cwd / exitCode / auth-config source / failed evidence exclusion |
| LatestAbsorptionGuards | GovernanceGateRegistry gateGroup / evidence / N/A；anchors: DatabaseRecordMigrationExportGate / FrontendBrowserVerificationBudgetGate / FindingProbeMatrixGate / VerificationCommandSideEffectGate / RequirementPreConfirmGate / BenchmarkRegressionGuard |

## §3 问题清单

| # | 级别 | 维度 | 位置 | 问题描述 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 | 发现轮次 | 状态 |
|:-:|:----:|------|------|---------|--------|---------|------|:--------:|---------|:-------:|------|
| 1 | 🔴 | G2 | §3.2 | | | | | ✅ 已验证 | | R1 | 已修复 |
| 2 | 🟡 | TD-4 | §4 | | | | | ⚠️ 待验证 | | R1 | 待处理 |

### §3.5 推荐结论

> 多个修复路径、多个后续动作或是否升级/暂停等决策存在时必须填写；无后续动作时写“推荐：无后续动作”。

**推荐**：[推荐方案 / 推荐：无后续动作]
**推荐理由**：[关联合理性、可实施性、收益、验证状态、影响范围]

## §4 通过项汇总

> 明确通过的关键维度（无问题或已确认符合标准）：

## §5 收敛声明

**收敛条件**：
- [ ] CRS ✅（关联文件扫描完成，无新发现文件）
- [ ] 所有 🔴 级问题已解决
- [ ] 所有 🟡 级问题已处理或标注 N/A
- [ ] 达到收敛条件：连续 3 轮有效零发现（仍须满足连续 3 轮零发现；所有审查类型统一，不区分定向/全面，见 `12-audit §多轮收敛规则`）
- [ ] `ReviewCoverageDelta` 已核验：最近 3 次有效零发现均有新增覆盖，或有证据化 `NoNewSurfaceReason`，未用机械重复同一批已读内容凑数
- [ ] `ReviewDimensionDeltaGate` 已核验：最近 3 次有效零发现均有新增/轮换/补强的维度焦点，或有证据化 `RepeatedDimensionReason`，未用机械重复同一组维度凑数

**最终结论**：✅ 已收敛 / ⚠️ 未收敛（需继续审查）
