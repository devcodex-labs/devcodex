---
agent: agent
description: 开发工作流报告模板，用于 dev 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/requirements/**
---
# 开发报告模板

> **路径**: 优先 `.devcodex/**/requirements/<需求>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/**/reports/requirements/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: dev 工作流完成后，由 `report/SKILL.md` 驱动生成
> **字段约束**: 每条遗留问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证

---

```markdown
# [功能名称] 开发报告

> **项目**: <project>
> **类型**: dev
> **子类型**: default / refactor / database / init / optimization / scenario-test / docs / plan-review
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
> **关联需求**: [路径]
> **关联方案**: [路径]
> **Release 状态**: 未进入 / 待用户确认 / 已执行
> **日志落点**: `changelogs/unreleased.md` / `CHANGELOG.md + changelogs/releases/vX.Y.Z.md`
> **支撑产物**: ExecutionContract / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / 05-实施进度.md（按触发状态填写）
> **ContextHandoffCard**: 触发时填写；未触发写 N/A + skipReason
```

## §1 执行摘要

> 一段话描述本次开发的核心内容和结果。

## §2 完成内容

| 任务 | 文件变更 | 说明 |
|------|---------|------|
| T-01 | | |

## §3 文件变更清单

```
新增：
  src/xxx.ts

修改：
  src/yyy.ts (变更说明)

删除：
  (无)
```

## §4 接口变更

> 无接口变更时填"无"。

| 接口 | 变更类型 | 说明 |
|------|---------|------|

## §5 Breaking Changes

> 无 BC 时填"无"。

## §5.5 支撑产物状态

| 产物 | 触发状态 | 结果 | 证据 |
|------|----------|:----:|------|
| ExecutionContract | ✅/N/A | ✅/⚠️ | |
| TestRoute | ✅/N/A | ✅/⚠️ | |
| LeakRiskStabilityPressureTest | ✅/N/A | ✅/⚠️ | leakRiskPressure 判定、基线、压力场景、冷却窗口、资源指标前后对比、skipReason |
| FrontendExperienceQualityGate | ✅/N/A | ✅/⚠️ | 设计来源、UI 还原度、风格主题、响应式状态、视觉验证、用户流、交互反馈、输入方式/可访问性、错误恢复、动效转场、FigmaHighFidelityRestorationGate、ActualPreviewChainAndMockFallbackGate、RuntimeI18nArtifactVerificationGate、skipReason |
| CrossProjectLearnedGuards | ✅/N/A | ✅/⚠️ | CodeTruthRequirementGate / ManualReviewEvidenceRetention / DocumentationTranslationParityGuard / FormalDocsDevCodexBoundary / LLMPromptContractTriage / VerificationScopeBudgetGate / LiveVerificationExecutionObligation / ExplicitCommitAuthorizationGate / CompatibilityAndContractAuthorityGate / UIConfirmedSourceConflictTraceGate / PublicDocsReleasedVersionGate / CollectionRelationIdNamingGate / UserFacingVerificationArtifactLanguageGate / AdapterBenchmarkAttribution / ProductRequirementTraceabilityGate / LocalExecutionConfigProbe / ManualReviewEvidenceDataRetention / AdjacentScopeExpansionGuard / PackageNameAuthorityGate / PerformanceBenchmarkFirstGate / PublicModuleDifferentiationGate / V2MCPFirstPlanningGate / WorkspaceDataAbsorptionScopeGate / FlowchartNodeExplanationGate / DocsSiteVisualAcceptanceGate / OmissionOnlyReviewGate / ReviewFindingIntakeGate / UserDocsImmediateComprehensionGate / UserDocsPrimarySurfaceGate / RequirementVerdictStateSyncGate / PublicUserDocsMaintainerBoundaryGate / ActiveRequirementFinalResponseGate / MethodLevelLeakPressureProbe / UserFacingDeliveryChainGate / FinalUserManualFirstGate / DocsSiteInformationArchitectureGate / UserManualFlowAndFailureGate / QueueDocsRealWorkflowGate / ReviewChecklistCompletenessGate / EvidenceExecutionGate / BuiltArtifactFeatureSmokeGate / TscOutputImportProbe / GeneratedSiteGate / ManualTocDuplicationGate / UserPathContractSweep / BenchmarkRegressionGuard / V2FormalSolutionPackage |
| LatestAbsorptionGuards | ✅/N/A | ✅/⚠️ | DatabaseRecordMigrationExportGate / FrontendBrowserVerificationBudgetGate / UserSelfVerificationOverrideGate / FindingProbeMatrixGate / MultiPhaseClosureGate / GuardPolicyBypassMatrixGate / SideEffectCompatibilityDocsGate / ExecutableExampleTruthProbeGate / VisualDeviationTypeGate / OneOffRequirementScriptPlacementGate / VerificationCommandSideEffectGate / DesignFramePurposeClassificationGate / RequirementPreConfirmGate / PackageAdapterPreConfirmEvidenceGate / RequirementVerdictStateSyncGate / UserDocsImmediateComprehensionGate / UserDocsPrimarySurfaceGate / UserFacingDeliveryChainGate / ReviewChecklistCompletenessGate / EvidenceExecutionGate / BuiltArtifactFeatureSmokeGate / TscOutputImportProbe / GeneratedSiteGate / ManualTocDuplicationGate / UserPathContractSweep / BenchmarkRegressionGuard |
| ServiceLifecycleCleanup | ✅/N/A | ✅/⚠️ | AI 自启动服务的 command/cwd/PID/job/port/url、关闭验证或 keepAliveReason |
| ReleaseAudit | ✅/N/A | ✅/⚠️ | |
| ReleaseVerification | ✅/N/A | ✅/⚠️ | |
| ConceptSyncMap | ✅/N/A | ✅/⚠️ | sourceOfTruth / currentConsumers / historicalMirrors / validateProbes / deployCopies / yellowDeviationBoundary |
| HostContractVerification | ✅/N/A | ✅/⚠️ | hostSurface / eventScope / evidenceMode / visibleReplyEvidence / workspaceGuard / bootstrapScope / artifactLinkMatrix / mcpFallback |
| OfficialDocsEvidence | ✅/N/A | ✅/⚠️ | 官方文档来源 / 版本日期 / 关键用法 / 限制 / 兼容性 / skipReason |
| ProfileImpactCheck | ✅/N/A | ✅/⚠️ | targetProfileFiles / updateOrSkip / skipReason / evidence |
| ConsumerDependencyTreeProbe | ✅/N/A | ✅/⚠️ | package.json / lockfile / node_modules / npm ls <关键依赖> / sourcePatchDecision |
| PackageBoundarySerialCheck | ✅/N/A | ✅/⚠️ | build 完成点 / 单独 pack 命令 / dist 写入竞争排除 / dirty 残留清理 |
| 05-实施进度.md | ✅/N/A | ✅/⚠️ | |
| ContextHandoffCard | ✅/N/A | ✅/⚠️ | source-of-truth / confirmed-decisions / open-risks / next-action / must-not-overwrite / validation-state / artifact-links |
| Backlog Intake 真相复核 | ✅/N/A | ✅/⚠️ | candidateIds / classification / evidence / scopeDelta |
| 台账状态回写闭环 | ✅/N/A | ✅/⚠️ | targetLedgers / requiredFields / writebackEvidence / rescanResult |
| Hook closure 三态证据 | ✅/N/A | ✅/⚠️ | verified-present / verified-missing / unverified；控制面或 Hook 任务必填 |

## §6 测试验证

| 类型 | 结果 | 覆盖率 |
|------|:----:|:------:|
| TestRoute 覆盖 | ✅ 通过 / N/A | — |
| 泄漏风险稳定性压测 | ✅ 通过 / N/A | baseline/cooldown/resourceMetrics |
| 前端 UI / 交互体验验证 | ✅ 通过 / N/A | Browser/截图/E2E/人工复核 / FrontendRuntimeNetworkProbeGate |
| 文档使用者视角、即时理解、主面与消费者扫描 | ✅ 通过 / N/A | UserPerspectiveDocsGate / UserDocsImmediateComprehensionGate / UserDocsPrimarySurfaceGate / DocsConsumerSweep |
| 用户最终文档、生成站点与公开用户路径 | ✅ 通过 / N/A | UserFacingDeliveryChainGate / FinalUserManualFirstGate / GeneratedSiteGate / ManualTocDuplicationGate / UserPathContractSweep |
| 复审清单证据化、构建产物与性能回归 | ✅ 通过 / N/A | ReviewChecklistCompletenessGate / EvidenceExecutionGate / BuiltArtifactFeatureSmokeGate / TscOutputImportProbe / BenchmarkRegressionGuard |
| 公开用户文档维护边界 | ✅ 通过 / N/A | PublicUserDocsMaintainerBoundaryGate |
| 产物链接去重 | ✅ 通过 / N/A | ArtifactLinkSetDedupeGate canonical path |
| 复审维度增量 | ✅ 通过 / N/A | ReviewDimensionDeltaGate |
| 最终回复 active 范围 | ✅ 通过 / N/A | ActiveRequirementFinalResponseGate |
| 验证范围预算与真实执行 | ✅ 通过 / N/A | VerificationScopeBudgetGate / LiveVerificationExecutionObligation |
| AI 自启动服务清理 | ✅ 已关闭 / N/A / 保留运行 | PID/端口/cleanupEvidence/keepAliveReason |
| HostContract 验证 | ✅ 通过 / N/A | — |
| 静态/类型检查 | ✅ 通过 / N/A | — |
| 单元测试 | ✅ 通过 | X% |
| api-verification | ✅ 通过 / N/A | — |

## §7 后置处理

- [ ] api-verification：✅ 通过 / N/A
- [ ] impact-review：✅ 完成 / N/A
- [ ] document-sync：✅ 完成
- [ ] ExecutionContract：✅ 完成 / N/A
- [ ] TestRoute：✅ 完成 / N/A
- [ ] LeakRiskStabilityPressureTest：✅ 完成 / N/A + skipReason
- [ ] FrontendExperienceQualityGate：✅ 完成 / N/A + skipReason
- [ ] CrossProjectLearnedGuards：✅ 完成 / N/A + skipReason
- [ ] ReviewFindingIntakeGate：✅ 完成 / N/A + skipReason
- [ ] ReviewDimensionDeltaGate / UserPerspectiveDocsGate / UserDocsImmediateComprehensionGate / UserDocsPrimarySurfaceGate / PublicUserDocsMaintainerBoundaryGate / DocsConsumerSweep / RequirementVerdictStateSyncGate / ArtifactLinkSetDedupeGate / FrontendRuntimeNetworkProbeGate / ActiveRequirementFinalResponseGate：✅ 完成 / N/A + skipReason
- [ ] WorkspaceDataAbsorptionScopeGate / DocsSiteVisualAcceptanceGate / MethodLevelLeakPressureProbe / V2FormalSolutionPackage：✅ 完成 / N/A + skipReason
- [ ] ServiceLifecycleCleanup：✅ 完成 / N/A（若保留运行，已记录用户要求、PID/端口和关闭方式）
- [ ] ReleaseAudit：✅ 完成 / N/A
- [ ] ReleaseVerification：✅ 完成 / N/A
- [ ] ConceptSyncMap：✅ 完成 / N/A
- [ ] HostContractVerification：✅ 完成 / N/A
- [ ] 05-实施进度.md：✅ 已同步 / N/A
- [ ] ContextHandoffCard：✅ 已写入 / N/A + skipReason
- [ ] release-status：未进入 / 待用户确认 / 已执行

## §7.5 ECR 执行闭环复审

| ECR 项 | 检查对象 | 结果 | 证据 |
|--------|----------|:----:|------|
| ECR-1 | CP1/CP2/CP3、05-实施进度、报告、daily tasks、SUMMARY | ✅/⚠️ | |
| ECR-2 | 需求条款 / 问题 ID → diff/commit 文件 | ✅/⚠️ | |
| ECR-3 | CP3 步骤 / ExecutionContract / TestRoute / ServiceLifecycleCleanup / ConceptSyncMap / HostContractVerification → 测试/部署/验证证据 | ✅/⚠️ | |
| ECR-4 | 报告声明 → 测试/探针/官方文档/OfficialDocsEvidence/ProfileImpactCheck/ReleaseAudit/ReleaseVerification/部署同步证据 | ✅/⚠️ | |
| ECR-5 | memory daily → SUMMARY | ✅/⚠️ | |
| ECR-6 | git dirty 边界 | ✅/⚠️ | |
| ECR-7 | 控制面任务 SCV / validate / direct replay / host-contract probe / 新增探针 / 黄色偏离 / backlog 真相复核 / 台账状态回写 | ✅/N/A | |

## §8 遗留问题

| 问题/建议 | 优先级 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 | 后续处理 |
|-----------|:------:|--------|----------|------|----------|----------|----------|
| | | | | | ✅已验证 / ⚠️待验证 | | |
