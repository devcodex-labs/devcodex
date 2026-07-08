---
agent: agent
description: 修复工作流报告模板，用于 fix 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/bugs/**
---
# 修复报告模板

> **路径**: 优先 `.devcodex/bugs/<问题>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/bugs/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: fix 工作流完成后，由 `report/SKILL.md` 驱动生成
> **字段约束**: 每条问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证

---

```markdown
# [问题名称] 修复报告

> **项目**: <project>
> **类型**: fix
> **子类型**: default / incident / security
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **严重级别**: P0 / P1 / P2 / P3
> **状态**: 进行中 / 已完成
> **事件级别**: P0 / P1 / P2（incident 类型必填）
> **事件时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
> **响应时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
> **修复时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
> **Release 状态**: 未进入 / 待用户确认 / 已执行
> **日志落点**: `changelogs/unreleased.md` / `CHANGELOG.md + changelogs/releases/vX.Y.Z.md`
> **支撑产物**: ExecutionContract / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / 05-实施进度.md（按触发状态填写）
> **ContextHandoffCard**: 触发时填写；未触发写 N/A + skipReason
```

## §1 问题摘要

**现象**：  
**根因**：  
**影响范围**：

## §2 修复方案

**方案描述**：  
**变更文件**：

```
修改：
  src/xxx.ts (修复内容)
```

## §3 CP 确认记录

| CP | 状态 | 用户响应 | 时间 |
|:--:|:----:|---------|------|
| CP1 | ✅ / N/A | 确认问题分析 | HH:MM |
| CP2 | ✅ / N/A | 确认修复方案 | HH:MM |
| CP3 | ✅ / N/A | 确认实施计划 | HH:MM |

## §4 修复三步扫描

| 扫描项 | 结果 | 证据 |
|--------|:----:|------|
| 同类全局扫描 | ✅ / ⚠️ | |
| 数据联动扫描 | ✅ / ⚠️ | |
| grep 零残留复核 | ✅ / ⚠️ | |

## §4.5 支撑产物状态

| 产物 | 触发状态 | 结果 | 证据 |
|------|----------|:----:|------|
| ExecutionContract | ✅/N/A | ✅/⚠️ | |
| TestRoute | ✅/N/A | ✅/⚠️ | |
| LeakRiskStabilityPressureTest | ✅/N/A | ✅/⚠️ | leakRiskPressure 判定、基线、压力场景、冷却窗口、资源指标前后对比、skipReason |
| CoverageGateDecision / RiskBasedValidationLadder | ✅/N/A | ✅/⚠️ | coverage 命令、工具、阈值、基线、当前值、passed/failed/known-red/N/A、targeted/related/full gate 层级和 skipReason |
| ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate / FunctionSourceFingerprintMatrixGate / ClusterEscalationGate | ✅/N/A | ✅/⚠️ | runtime/plugin/registry 生命周期矩阵、fingerprint false-positive/false-negative 样本、clusterId、whyMissed、冻结矩阵、停止条件、rerunEvidence |
| FrontendExperienceQualityGate | ✅/N/A | ✅/⚠️ | 设计来源、UI 还原度、风格主题、响应式状态、视觉验证、用户流、交互反馈、输入方式/可访问性、错误恢复、动效转场、FigmaHighFidelityRestorationGate、ActualPreviewChainAndMockFallbackGate、FrontendRuntimeNetworkProbeGate、RuntimeI18nArtifactVerificationGate、skipReason |
| spec-absorption / CommonNormGeneralizationGate / AbsorptionCandidateConsumerProofGate | ✅/N/A | ✅/⚠️ | 候选矩阵 / sourceNamespace / generalizationEvidence / projectSpecificResidue / negativeExamples / targetConsumer / devcodexConsumerEvidence / targetOwner / validationRoute / decision |
| LayeredAbsorptionGate / SkillFirstAbsorptionGate | ✅/N/A | ✅/⚠️ | LayeredAbsorptionDecision：candidateId / classification / targetSkill / triggerTerms / ownedArtifacts / layerChecks(commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy) / validationRoute / consumerSync；兼容 SkillAbsorptionDecision |
| HistoricalCommonNormLayeringGate | ✅/N/A | ✅/⚠️ | 逐文件审查矩阵、currentRole/matchedRules/targetLayer/targetOwner/action/semanticStrength/validation/skipReason、legacy-index-retained 项、V74 探针和部署副本同步 |
| ProactiveBetterAlternativeGate | ✅/N/A | ✅/⚠️ | 用户方案 / 备选路径 / 推荐理由 / 取舍影响 / 采纳依据 |
| AcceptedSuggestionRootCauseGate | ✅/N/A | ✅/⚠️ | whyMissed / 采纳依据 / VL-PI-PF-GAP 编号 / prevention |
| PostConfirmationReviewScopeGate / DevelopmentDriftGate | ✅/N/A | ✅/⚠️ | light/full 判定、review-checklist 路径或 skipReason、allowedFirstBatch、blockedScope、driftTriggers、validationRoute |
| VerificationPlanMaterializationProbe / docsIaReadability | ✅/N/A | ✅/⚠️ | 验证计划、验收/退出条件、ChinesePrimaryExpressionGate、SidebarPageRoleMaterializationProbe、SidebarGroupSemanticModelProbe |
| ConfirmedAbsorptionCompletenessGates | ✅/N/A | ✅/⚠️ | gateGroup / ownerSkill / layerChecks / validationRoute；anchors: PublicSurfaceClosureGate / UserManualProductizationGate / ReviewAnchorMaterializationGate / FrontendAsyncCacheRenderGate / RemoteCIParityPushGate / NativeCommandExitCodeGate / DocsThemeRuntimeVisualProbeGate |
| CrossProjectLearnedGuards | ✅/N/A | ✅/⚠️ | GovernanceGateRegistry gateGroup / ownerSkill / validationRoute / skipReason；anchors: CodeTruthRequirementGate / ManualReviewEvidenceRetention / ReviewFindingIntakeGate / UserDocsPrimarySurfaceGate / ActiveRequirementFinalResponseGate / V2FormalSolutionPackage |
| LatestAbsorptionGuards | ✅/N/A | ✅/⚠️ | GovernanceGateRegistry gateGroup / evidence / N/A；anchors: DatabaseRecordMigrationExportGate / FrontendBrowserVerificationBudgetGate / FindingProbeMatrixGate / VerificationCommandSideEffectGate / RequirementPreConfirmGate / BenchmarkRegressionGuard |
| ServiceLifecycleCleanup | ✅/N/A | ✅/⚠️ | AI 自启动服务的 command/cwd/PID/job/port/url、关闭验证或 keepAliveReason |
| ReleaseAudit | ✅/N/A | ✅/⚠️ | |
| ReleaseVerification | ✅/N/A | ✅/⚠️ | R0~R7、NativeCommandExitCodeGate command/shell/cwd/exitCode |
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

## §5 回归验证

| 测试用例 | 结果 |
|---------|:----:|
| TestRoute 覆盖 | ✅ 通过 / N/A |
| 泄漏风险稳定性压测 | ✅ 通过 / N/A |
| Coverage / runtime lifecycle / fingerprint 验证 | ✅ 通过 / N/A |
| 前端 UI / 交互体验验证 | ✅ 通过 / N/A |
| 文档使用者视角、即时理解、主面与消费者扫描 | ✅ 通过 / N/A |
| 用户最终文档、生成站点与公开用户路径 | ✅ 通过 / N/A（audit-user-manual / UserManualReviewScope / DocsNavigationReviewMatrix / GeneratedSiteGate） |
| 复审清单证据化、构建产物与性能回归 | ✅ 通过 / N/A |
| 产物链接去重 | ✅ 通过 / N/A |
| 复审维度增量 | ✅ 通过 / N/A |
| 验证范围预算与真实执行 | ✅ 通过 / N/A |
| AI 自启动服务清理 | ✅ 已关闭 / N/A / 保留运行 |
| HostContract 验证 | ✅ 通过 / N/A |
| 静态/类型检查 | ✅ 通过 / N/A |
| 原始重现步骤 | ✅ 已修复 |
| 关联功能回归 | ✅ 正常 |
| api-verification | ✅ 通过 / N/A |

## §5.5 ECR 执行闭环复审

| ECR 项 | 检查对象 | 结果 | 证据 |
|--------|----------|:----:|------|
| ECR-1 | CP1/CP2/CP3、05-实施进度、报告、daily tasks、SUMMARY | ✅/⚠️ | |
| ECR-2 | 问题 ID / 根因链 → diff/commit 文件 | ✅/⚠️ | |
| ECR-3 | CP3 步骤 / ExecutionContract / TestRoute / ServiceLifecycleCleanup / ConceptSyncMap / HostContractVerification → 测试/部署/验证证据 | ✅/⚠️ | |
| ECR-4 | 修复报告声明 → 测试/扫描/探针结果/OfficialDocsEvidence/ProfileImpactCheck/ReleaseAudit/ReleaseVerification/部署同步证据 | ✅/⚠️ | |
| ECR-5 | memory daily → SUMMARY | ✅/⚠️ | |
| ECR-6 | git dirty 边界 | ✅/⚠️ | |
| ECR-7 | 控制面任务 SCV / validate / direct replay / host-contract probe / 新增探针 / 黄色偏离 / backlog 真相复核 / 台账状态回写 | ✅/N/A | |

## §6 时间线（incident 类型必填，秒级精度供响应时效审计）

| 时间 | 事件 |
|------|------|
| YYYY-MM-DD HH:MM:SS | 事故发生 |
| YYYY-MM-DD HH:MM:SS | 发现/告警 |
| YYYY-MM-DD HH:MM:SS | 止血完成 |
| YYYY-MM-DD HH:MM:SS | 根因确认 |
| YYYY-MM-DD HH:MM:SS | 修复上线 |

> ⚠️ **incident 必须秒级**：P0 要求 15 分钟内初步方案，秒级时间是后续 SLA 审计依据；P1/P2 可降级为分钟级 `YYYY-MM-DD HH:MM`。

## §7 问题/建议验证

| 问题/建议 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 |
|-----------|--------|----------|------|----------|----------|
| | | | | ✅已验证 / ⚠️待验证 | |

## §7.5 推荐结论

**推荐**：[推荐方案 / 推荐：无后续动作]
**推荐理由**：[若有多个后续建议或处理路径，说明为何推荐该项；无后续动作时说明原因]

## §8 改进 Action Items（incident 必填）

| 改进点 | 优先级 | 负责人 | 截止时间 |
|--------|:------:|--------|---------|

## §9 后置处理

- [ ] document-sync：✅ 完成
- [ ] ExecutionContract：✅ 完成 / N/A
- [ ] TestRoute：✅ 完成 / N/A
- [ ] FrontendExperienceQualityGate：✅ 完成 / N/A + skipReason
- [ ] CrossProjectLearnedGuards：✅ 完成 / N/A + skipReason
- [ ] ReviewFindingIntakeGate：✅ 完成 / N/A + skipReason
- [ ] ReviewEscapeRecordGate：✅ 完成 / N/A + skipReason（若复审发现遗漏，已记录 whyMissed / prevention / checklistPatch / rerunEvidence）
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
- [ ] CHANGELOG / unreleased 已按发布状态更新
