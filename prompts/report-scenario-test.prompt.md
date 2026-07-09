---
agent: agent
description: 场景测试工作流报告模板，用于 dev.scenario-test 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/scenario-tests/**
---
# 场景测试报告模板

> **路径**: 优先 `.devcodex/scenario-tests/<场景>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/scenario-tests/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: dev.scenario-test 工作流完成后，由 `report/SKILL.md` 驱动生成
> **字段约束**: 每条问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证

---

```markdown
# [测试场景名称] 场景测试报告

> **项目**: <project>
> **类型**: dev
> **子类型**: scenario-test
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
> **关联需求**: [路径]
> **支撑产物**: ExecutionContract / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / 05-实施进度.md（按触发状态填写）
```

## §1 执行摘要

> 一段话描述本次场景测试的目标和结论。

## §2 测试场景

| 编号 | 场景 | 前置条件 | 预期结果 |
|------|------|---------|---------|
| S-01 | | | |

## §3 负载测试配置

| 参数 | 值 | 说明 |
|------|:--:|------|
| 工具 | artillery | 默认负载测试工具 |
| 目标并发 | X | — |
| 持续时间 | X s | — |
| Ramp-up | X s | — |

## §4 测试结果

| 指标 | 结果 | 通过？ |
|------|:----:|:------:|
| 吞吐量 | X req/s | ✅/❌ |
| 平均延迟 | X ms | ✅/❌ |
| P99 延迟 | X ms | ✅/❌ |
| 错误率 | X% | ✅/❌ |

## §4.1 泄漏风险稳定性压测结果（条件）

> TestRoute 的 `leakRiskPressure` 为 `required` 时填写；未触发时写 `N/A + skipReason`。

| 指标 | 基线 | 压力后 | 冷却后 | 通过？ |
|------|------|--------|--------|:------:|
| heap/RSS 或项目等价内存指标 | | | | ✅/❌ |
| active handles / 监听器 / 定时器 | | | | ✅/❌ |
| 连接数 / 流 / socket / worker / 订阅 | | | | ✅/❌ |
| 缓存规模 / 队列积压 | | | | ✅/❌ |

## §5 场景验证结果

| 场景 | 实际结果 | 符合预期？ |
|------|---------|:---------:|
| S-01 | | ✅/❌ |

## §6 测试数据说明

> 使用 fixtures 数据还是模拟数据，说明数据来源。

## §6.1 测试验证

| 类型 | 结果 | 说明 |
|------|:----:|------|
| TestRoute 覆盖 | ✅ 通过 / N/A | — |
| LeakRiskStabilityPressureTest | ✅ 通过 / N/A | baseline / pressureScenario / cooldown / resourceMetrics / skipReason |
| MethodLevelLeakPressureProbe | ✅ 通过 / N/A | publicMethod / lifecycleScenario / iterations / resourceMetrics / cleanupEvidence / skipReason |
| methodLevelLeakPressure | required / optional / N/A | publicMethod / lifecycleScenario / iterations / resourceMetrics / cleanupEvidence / skipReason |
| 专家型产物质量 | ✅ 通过 / N/A | ExpertOutputQualityGate / fixtureBoundary / antiPatternContrast / evidenceMatrix |
| HostContract 验证 | ✅ 通过 / N/A | — |
| 负载测试 (artillery) | ✅ 通过 | — |
| 场景回放 | ✅ 通过 | direct replay / fixture replay / N/A |

## §6.2 支撑产物状态

| 产物 | 触发状态 | 结果 | 证据 |
|------|----------|:----:|------|
| ExecutionContract | ✅/N/A | ✅/⚠️ | |
| TestRoute | ✅/N/A | ✅/⚠️ | |
| LeakRiskStabilityPressureTest | ✅/N/A | ✅/⚠️ | leakRiskPressure / baseline / cooldown / resourceMetrics / skipReason |
| FrontendExperienceQualityGate | ✅/N/A | ✅/⚠️ | frontendExperience / FigmaHighFidelityRestorationGate / ActualPreviewChainAndMockFallbackGate / RuntimeI18nArtifactVerificationGate / Browser / 截图 / E2E / 人工复核 / skipReason |
| FrontendRuntimeNetworkProbeGate | ✅/N/A | ✅/⚠️ | console / network / failed requests / resource 404 / API target / runtime error / i18n key / skipReason |
| spec-absorption / CommonNormGeneralizationGate / AbsorptionCandidateConsumerProofGate | ✅/N/A | ✅/⚠️ | 候选矩阵 / sourceNamespace / generalizationEvidence / projectSpecificResidue / negativeExamples / targetConsumer / devcodexConsumerEvidence / targetOwner / validationRoute / decision |
| LayeredAbsorptionGate / SkillFirstAbsorptionGate | ✅/N/A | ✅/⚠️ | LayeredAbsorptionDecision / new-skill-required / existing-skill-subgate / layerChecks / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy / validationRoute / consumerSync |
| HistoricalCommonNormLayeringGate | ✅/N/A | ✅/⚠️ | 逐文件审查矩阵 / currentRole / targetLayer / targetOwner / legacy-index-retained / V74 / targeted tests / deployCopy |
| LatestAbsorptionExecutionPack A1~A10 | ✅/N/A | ✅/⚠️ | gateGroup / ownerSkill / validationRoute / V82 / DerivedMetricConsumerProbe / DerivedConsumerFailureInjectionProbe / BatchEvidenceLedgerStateGate / BatchProgressCardGate |
| ReviewEscapeRecordGate | ✅/N/A | ✅/⚠️ | escapedItem / whyMissed / missingDimensionOrProbe / prevention / checklistPatch / rerunEvidence |
| ProactiveBetterAlternativeGate | ✅/N/A | ✅/⚠️ | 用户方案 / 备选路径 / 推荐理由 / 取舍影响 / 采纳依据 |
| AcceptedSuggestionRootCauseGate | ✅/N/A | ✅/⚠️ | 采纳的用户纠正 / whyMissed / 采纳依据 / VL-PI-PF-GAP 编号 / prevention |
| PostConfirmationReviewScopeGate / DevelopmentDriftGate | ✅/N/A | ✅/⚠️ | 轻量或全面复审判定 / review-checklist 路径或 skipReason / allowedFirstBatch / blockedScope / driftTriggers / validationRoute |
| VerificationPlanMaterializationProbe / docsIaReadability | ✅/N/A | ✅/⚠️ | 验证计划物化 / 验收标准 / 退出条件 / ChinesePrimaryExpressionGate / SidebarPageRoleMaterializationProbe / SidebarGroupSemanticModelProbe |
| ConfirmedAbsorptionCompletenessGates | ✅/N/A | ✅/⚠️ | gateGroup / ownerSkill / layerChecks / validationRoute；gateGroup anchors: public-surface / user-manual / review-checklist / frontend-runtime / profile-service / release-parity / evolution-control-plane；anchors: PublicSurfaceClosureGate / UserManualProductizationGate / ReviewAnchorMaterializationGate / FrontendAsyncCacheRenderGate / RemoteCIParityPushGate / NativeCommandExitCodeGate / DocsThemeRuntimeVisualProbeGate |
| ExpertOutputQualityGate | ✅/N/A | ✅/⚠️ | roleBaseline / productionRecommendedPath / frameworkNativeCapability / fixtureBoundary / antiPatternContrast / evidenceMatrix / V84 |
| CrossProjectLearnedGuards | ✅/N/A | ✅/⚠️ | GovernanceGateRegistry gateGroup / ownerSkill / validationRoute / skipReason；anchors: ManualReviewEvidenceRetention / ReviewFindingIntakeGate / UserDocsPrimarySurfaceGate / ActiveRequirementFinalResponseGate / V2FormalSolutionPackage |
| LatestAbsorptionGuards | ✅/N/A | ✅/⚠️ | GovernanceGateRegistry gateGroup / evidence / N/A；anchors: DatabaseRecordMigrationExportGate / FrontendBrowserVerificationBudgetGate / FindingProbeMatrixGate / VerificationCommandSideEffectGate / RequirementPreConfirmGate / BenchmarkRegressionGuard |
| ReleaseAudit | ✅/N/A | ✅/⚠️ | |
| ReleaseVerification | ✅/N/A | ✅/⚠️ | |
| ConceptSyncMap | ✅/N/A | ✅/⚠️ | sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies / yellowDeviationBoundary |
| HostContractVerification | ✅/N/A | ✅/⚠️ | hostSurface / eventScope / evidenceMode / visibleReplyEvidence / workspaceGuard / bootstrapScope |
| 05-实施进度.md | ✅/N/A | ✅/⚠️ | |

## §6.5 ECR 执行闭环复审

| ECR 项 | 检查对象 | 结果 | 证据 |
|--------|----------|:----:|------|
| ECR-1 | CP1/CP2/CP3、05-实施进度、报告、daily tasks、SUMMARY | ✅/⚠️ | |
| ECR-2 | 场景目标 → 测试文件/验证产物 | ✅/⚠️ | |
| ECR-3 | CP3 步骤 / ExecutionContract / TestRoute / ConceptSyncMap / HostContractVerification → 测试/负载/部署/验证证据 | ✅/⚠️ | |
| ECR-4 | 报告声明 → 测试结果/数据来源/ReleaseAudit/ReleaseVerification/部署同步证据 | ✅/⚠️ | |
| ECR-5 | memory daily → SUMMARY | ✅/⚠️ | |
| ECR-6 | git dirty 边界 | ✅/⚠️ | |
| ECR-7 | 控制面任务 SCV / validate / direct replay / host-contract probe / 新增探针 / 黄色偏离 | ✅/N/A | |

## §7 遗留问题

| 问题/建议 | 优先级 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 | 后续处理 |
|-----------|:------:|--------|----------|------|----------|----------|----------|
| | | | | | ✅已验证 / ⚠️待验证 | | |
