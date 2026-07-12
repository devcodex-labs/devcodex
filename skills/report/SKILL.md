---
name: report
description: 生成并写入工作流执行报告。适用于 dev/fix/analyze/audit/self-fix（chat 豁免）。
---
## 报告路径

### 需求级（优先）

任务关联到 `requirements/` · `bugs/` · `optimizations/` 目录时：
```
<任务目录>/reports/<agent>/YYYYMMDD/NN--<简述>.md
```

### 项目级（兜底）

```
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

| 工作流 | 默认子目录 |
|--------|:----------:|
| dev | `requirements/` |
| dev (optimization) | `optimizations/` |
| dev (scenario-test) | `scenario-tests/` |
| fix | `bugs/` |
| analyze | `analysis/` |
| audit | `audit/` |
| self-fix | `self-fix/` |

> 路径详细规范见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md)。
> 当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，本文中的任务目录与项目级 `reports/...` 均以当前 **`<active-root>`** 为根。

## 头部必填

```markdown
# [标题]

> **项目**: [项目名]
> **类型**: [类型]
> **子类型**: [子类型]（无子类型时省略此行）
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: [agent-id]
> **状态**: 进行中 / 已完成
```

## 命名规则

| 组件 | 规则 |
|------|------|
| `NN` | 当日序号，从 `01` 起递增（扫描同目录取 max+1）|
| `--` | **双横杠**（非单横杠），分隔序号与简述（[FC4](../compliance/SKILL.md) 检查） |
| `<简述>` | 2~5 个中文词或英文单词，连字符分隔 |

示例：`01--v4规范全面审查.md`、`02--intent修复后再审.md`

## 工作流专属字段

### audit 报告额外头部

```markdown
> **审查目标类型**: [规范文件 / 技术方案 / 需求文档 / 项目工程 / 报告 / 通用文档 / 发布前审查]
> **审查范围**: [全面体检 / 定向深度 / 修复验证]
> **收敛**: 连续 3 轮有效零发现（仍须满足连续 3 轮零发现；所有子类型统一，不区分定向/全面）
> **ReviewCoverageDelta**: ✅已核验 / ⚠️缺失 / N/A（说明）
> **PCV状态**: ✅已完成 / 🔄进行中
```

### fix 报告须包含

- CP 确认记录表（CP1→CP2→CP3 状态，格式见 [`cp-gate`](../cp-gate/SKILL.md)）
- 三步扫描结果（同类全局扫描 / 数据联动扫描 / grep 零残留复核）

### dev/fix 支撑产物字段

当以下支撑 Skill 被触发时，报告必须列出对应产物、判定结果与证据；未触发时可标 `N/A` 并说明原因。

| 支撑产物 | 触发场景 | 报告要求 |
|----------|----------|----------|
| ExecutionContract | Auto / 控制面 / 多批次 / 预计修改 ≥10 文件 / release 前置任务 | 列出 scope、allowedPaths、requiredArtifacts、validationRoute、deviationPolicy、rollbackPlan |
| RepairCollaborationContract | AI 判断任务目标为 repair task | 列出 lightweight/full、contractState、authorizationEvidence 与双层证据；full 追加 findingToPatchMap、handoffIntegrity、independentReReview、acceptanceMatrix；模型名称不作为触发证据 |
| TestRoute | 跨模块、接口、Hook/CLI、模板-示例-校验链、测试路径不明显的任务 | 列出 changeType、routes、commands、skipReason、blockingLevel |
| CoverageGateDecision / ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate / FunctionSourceFingerprintMatrixGate / ClusterEscalationGate / RiskBasedValidationLadder | coverage 门禁、外部 runtime/plugin/registry/adapter/provider 生命周期、function source fingerprint、同风险簇返修或风险分层验证被触发 | 列出 coverage 命令/工具/阈值/基线/当前值/状态；runtime/plugin/registry 矩阵；fingerprint false-positive/false-negative 样本；clusterId、触发计数、whyMissed、冻结矩阵、停止条件和 targeted/related/full gate 层级；未触发写 `N/A + skipReason` |
| ReleaseVerification | 用户明确要求正式发版、tag、publish 或已进入发布前验证 | 列出 R0~R7 的验证结果与证据；如存在远端 CI，补 R3c 目标 commit CI 绿色证据或 `N/A + skipReason`；pack/publish/install smoke 证据必须包含 `NativeCommandExitCodeGate` 的 command、shell、cwd、exitCode 与 auth/config 来源 |
| ReleaseAudit | 用户要求发版前 review、publish/tag 前风险审查或 audit.发布前审查 | 列出 RL-1~RL-10 审查结果、风险、证据与推荐结论 |
| ConceptSyncMap | 控制面、模板-示例-校验链、README/website/Profile/validate/部署副本联动任务 | 列出 sourceOfTruth、currentConsumers、historicalMirrors、validateProbes、deployCopies、yellowDeviationBoundary |
| HostContractVerification | Hook/CLI/宿主契约、visible reply、sticky project、workspace guard、bootstrap 相关任务 | 列出 hostSurface、eventScope、evidenceMode、visibleReplyEvidence、workspaceGuard、bootstrapScope |
| 05-实施进度.md | 跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面或模板-校验链任务 | 报告引用进度路径，并核对 CP/批次/阻塞/验证状态 |
| OfficialDocsEvidence | 新增/升级依赖、框架、SDK、平台 API、外部模块或外部平台能力判断 | 列出官方文档来源、版本/日期、关键用法、限制、兼容性 / 弃用 / Breaking Change 判断；N/A 时写 `skipReason` |
| ProfileImpactCheck | dev/fix 改变项目技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema | 列出是否更新 Profile、目标文件、diff/证据；N/A 时写 `skipReason` |
| ProfileTruthReconciliationGate | 项目级 analyze / 任意 audit | 列出 mode、profileTrustState 与 `ProfileTruthMatrix(profileClaim / actualSources / status / conclusionAuthority / correctionRoute)`；只读工作流只能矫正结论，不能直接修改 Profile |
| AuthorizedLocalSecurityAuditPresentationGate | 用户自有/明确授权的本地安全审查，或宿主安全提示导致内容不可见 | 列出 authorizationContext、defensiveObjective、visibleEvidenceBudget、isolatedProbeBoundary；提示发生时追加 SafetyInterruptionCard 与恢复/反馈路线，禁止绕过表述 |
| PublisherCredentialTopologyGate | 首次发布或 publisher/repository/package/registry/auth topology 变化；普通 patch 记录 unchanged evidence | 列出 publisher/repository/package identity、authMode、secret scope/access/inheritance、workflowPermissions、reference run、topologyParity；不得包含 secret value |
| ProfileTierValidation / AllDevCodexProfileValidation | 涉及 Profile 三档标准、Profile 必需文件、workspace-namespace、规范维护项目或用户要求校验 `.devcodex` 所有项目 | 列出 `ProfileTierStandardGate`、`ProfileLifecycleClassificationGate`、`AllDevCodexProfileValidationGate` 的判定、执行命令、检查项目数、错误数、警告数、是否启用 `--strict-warnings`、active Profile 更新证据和残余风险 |
| MemoryCannotSatisfyBootstrapGate | 涉及宿主 Memories、模型长期偏好、resume / summary 恢复、Profile / memory bootstrap、Context Rehydration 或用户询问是否可用记忆替代文件读取 | 列出 Memories / 模型回忆的 `navigation-hint` 边界、真实读取的 Profile / SUMMARY / tasks / reports / review checklist / 源码或文档证据、冲突处理、V86/targeted probe；无法读取时写阻塞 / 降级，不得写通过 |
| Backlog Intake 真相复核 | 任务或批次直接来源于 `data/*.md` open/partial 项 | 列出 `candidateIds`、`classification`、`evidence`、`scopeDelta` |
| 台账状态回写闭环 | 本轮会关闭/部分关闭/改分类任何 VL/PF/PI/ISSUE/GAP | 列出 `targetLedgers`、`requiredFields`、`writebackEvidence`、`rescanResult` |
| spec-absorption / CommonNormGeneralizationGate / AbsorptionCandidateConsumerProofGate | 规范吸纳、最新可吸纳、仍需吸纳、检查 `.devcodex/*/data` 吸纳清单、项目独有规则剔除 | 列出候选矩阵、`sourceNamespace`、`generalizationEvidence`、`projectSpecificResidue`、`negativeExamples`、`commonTrigger`、`targetConsumer`、`devcodexConsumerEvidence`、`targetOwner`、`layerChecks`、`validationRoute`、`decision` 与 `skipReason` |
| ProjectArtifactScaleRoutingGate | 项目/目录分析、审查、扫描、能力盘点、大目录或全工作区任务 | 列出 project/root、六项规模指标、ScaleDecisionRecord、exclusionPolicy、batch/checkpoint、invalid-run、V91；未形成前不得声称完成 broad scan |
| SkillPortfolioLifecycleGate | Skill 组合、依赖、误触发/漏触发、gray/deprecated/retired、合并退役 | 列 portfolio/dependency/lifecycle/trigger score/conflict/deprecation/retirement/authorization 与 V91 |
| LayeredAbsorptionGate / SkillFirstAbsorptionGate / CapabilityToSkillPromotionGate | 规范吸纳、data 台账治理、用户确认可泛化策略、新增门禁或新增 Skill | 列出 `LayeredAbsorptionDecision`（兼容 `SkillAbsorptionDecision`）：`candidateId`、`classification`、`targetSkill`、`triggerTerms`、`ownedArtifacts`、`layerChecks`、`validationRoute`、`consumerSync`；`layerChecks` 必须覆盖 `commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy`；若 `new-skill-required`，说明新 Skill 或未创建原因 |
| HistoricalCommonNormLayeringGate | 历史通用规范、prompt/report 长清单、旧吸纳项或跨版本规范资产重新分层 | 列出逐文件审查矩阵、`currentRole / matchedRules / targetLayer / targetOwner / action / semanticStrength / validation / skipReason`、`legacy-index-retained` 项、V74 / targeted test / validate / public docs / deploy copy 证据 |
| ProactiveBetterAlternativeGate | 用户建议、需求/方案确认、规范吸纳、复审清单冻结或报告推荐结论 | 列出用户方案、备选路径、推荐理由、取舍影响；若采纳用户原方案，写明经独立验证后采纳的证据 |
| AcceptedSuggestionRootCauseGate | 用户提出更优方案或纠正命名 / IA / 验证路线 / 范围边界且本轮采纳 | 列出 whyMissed、采纳依据、关联 VL/PI/PF/GAP 编号、prevention、record.none skipReason（如适用） |
| PostConfirmationReviewScopeGate / DevelopmentDriftGate | CP 确认后进入下一阶段、进入编码前或实施中范围偏移风险 | 列出轻量/全面复审判定、review-checklist 路径或 skipReason、allowedFirstBatch、blockedScope、driftTriggers、validationRoute、dirty boundary |
| ConfirmedAbsorptionCompletenessGates | 用户确认未完整吸纳、半覆盖、缺独立 Gate、缺 Skill、缺 Prompt、缺探针或缺部署副本 | 按 `public-surface / user-manual / review-checklist / frontend-runtime / profile-service / release-parity / evolution-control-plane` 列出本批 Gate 分层归属与证据；legacy anchors 包括 `PublicSurfaceClosureGate`、`UserManualProductizationGate`、`ReviewAnchorMaterializationGate`、`SemanticLegacyRouteExposureGate`、`ReferenceCodeTruthSamplingGate`、`FrontendAsyncCacheRenderGate`、`StaleWhileRevalidateGate`、`RemoteCIParityPushGate`、`NativeCommandExitCodeGate`、`OfficialApiEvidenceGate`、`EvolutionCapabilityControlPlaneGate`、`FrameworkCapabilityAutoFirstGate`、`DocsThemeRuntimeVisualProbeGate` |
| LatestAbsorptionExecutionPack A1~A10 | 最新可吸纳清单确认实施、文档语义/示例/派生消费者/Profile feature/批次证据补强 | 按 `GovernanceGateRegistry` 分组列出 `ConfigCanonicalNamespaceGate`、`ProfileRuntimeContractSyncGate`、`BehaviorSemanticDocsParityGate`、`NegativeTranslationParityProbe`、`DocsExampleTruthSurfaceGate`、`CallbackExampleScopeProbe`、`DerivedMetricConsumerProbe`、`DerivedConsumerFailureInjectionProbe`、`FeatureInventoryProfileGate`、`FeatureChecklistEvidenceMatrixGate`、`BatchEvidenceLedgerStateGate`、`BatchProgressCardGate` 的 ownerSkill、validationRoute、V82/targeted test、publicDocs、Profile、deployCopy 和 skipReason |
| ExpertOutputQualityGate | 代码、文档、示例、fixture、mock、demo、quick start、技术方案或报告需要专家型输出质量，或用户指出“不专业 / 像初级 / 示例误导” | 列出 `roleBaseline`、`productionRecommendedPath`、`frameworkNativeCapability`、`fixtureBoundary`、`antiPatternContrast`、`evidenceMatrix`、V84/targeted probe、publicDocs / Profile / deployCopy 同步证据；未触发写 `N/A + skipReason` |
| ExpertOwnerSkillGate / 21 个专家 Owner Skill | 产品、体验、架构、运行、安全质量、增长商业、分布式系统、性能、隐私合规或 AI 评测任一专业语义被触发 | 列出 `ownerSkill`、`triggerReason`、`requiredFields`、`validationRoute`、`skipReason`、V85/targeted probe、publicDocs / Profile / deployCopy 同步证据；新增 Owner 必须显式覆盖 `DistributedSystemsArchitectureGate` / `PerformanceEngineeringGate` / `PrivacyComplianceArchitectureGate` / `AiEvaluationEngineeringGate`；增长 / 商业未触发时写 `N/A + skipReason` |
| ReviewFindingIntakeGate | 输入来自外部审查报告、AI review finding、audit issue 或代码评审发现 | 列出 finding 来源、本地证据、`must-fix / user-decision-required / docs-implementation-drift / test-coverage-gap / already-fixed-or-not-reproduced / intentional-design-accepted` 分类、用户确认点与最终处理 |

V85 报告兼容锚点：既有 Owner Gate `ProductStrategyOwnerGate`、`DeveloperExperienceArchitectureGate`、`UxInteractionArchitectureGate`、`FrontendArchitectureOwnerGate`、`BackendDomainArchitectureGate`、`ProductionReadinessSreGate`、`ApiContractArchitectureGate`、`ExternalIntegrationArchitectureGate`、`PlatformEcosystemArchitectureGate`、`AiAgentSystemArchitectureGate`、`DataArchitectureGate`、`SecurityThreatModelingGate`、`QualityStrategyGate`、`DesignSystemArchitectureGate`、`AccessibilityI18nGate`、`GrowthAnalyticsGate`、`BusinessModelReviewGate` 继续保留；新增四个 Gate 只做集合扩展。
| FigmaHighFidelityRestorationGate / ScopedVisualChangeGate | Figma、截图、既有页面、高保真 UI 或局部视觉修复 | 列出设计来源、allowedScope/frozenScope、还原检查项、偏离理由和视觉证据 |
| ActualPreviewChainAndMockFallbackGate / UIStateScopeRegressionGate | 前端真实页面验证、mock fallback 风险或状态回归 | 列出真实 URL、API target、路由入口、受影响状态、主 CTA 可见性与 mock 排除证据 |
| FigmaProductionAssetBudgetGate / RuntimeI18nArtifactVerificationGate | 生产设计资产或多语言运行时验证 | 列出资产尺寸/体积/格式/public 路径、源 JSON、构建合并产物、页面 runtime key 残留 |
| ExplicitCommitAuthorizationGate / CompatibilityAndContractAuthorityGate | 执行 commit、兼容修复、共享库/adapter/SDK 或上游契约判断 | 列出用户明确授权、消费者零代码兼容、上游合同权威、官方 public API 证据和共享库优先判断 |
| UIConfirmedSourceConflictTraceGate / PublicDocsReleasedVersionGate | UI 主真相源覆盖旧 PRD，或公开文档描述版本能力 | 列出冲突表、采纳理由、同步路线、released/unreleased/preview 边界 |
| CollectionRelationIdNamingGate / UserFacingVerificationArtifactLanguageGate | 数据库/ORM 关系字段命名或用户可读验证产物 | 列出集合/实体命名依据、项目 convention、用户当前语言和例外理由 |
| ReviewDimensionDeltaGate / UserPerspectiveDocsGate / UserDocsImmediateComprehensionGate / UserDocsPrimarySurfaceGate / DocsConsumerSweep | R2+ 复审、文档开发/审查、用户文档主面、文档消费者同步 | 列出维度增量字段、使用者路径、功能完整性、配置易懂性、即时理解、targetSurface/documentLocation、首页/quick start/nav 主面、字段解释、心智负担、消费者扫描与 skipReason |
| ArtifactLinkSetDedupeGate / FrontendRuntimeNetworkProbeGate | 产物路径输出、前端真实预览/文档站视觉验收 | 列出 canonical path 去重、同名消歧、历史镜像/部署副本标识、console/network/resource/runtime 证据 |
| PublicUserDocsMaintainerBoundaryGate / ActiveRequirementFinalResponseGate | 公开用户文档维护边界、最终回复 active 范围 | 列出用户主路径是否移除维护者 checklist / 内部同步清单，以及当前 active requirement/task/bug id、未切换相邻需求和未执行项 |
| UserFacingDeliveryChainGate / FinalUserManualFirstGate / DocsSiteInformationArchitectureGate / UserManualFlowAndFailureGate / QueueDocsRealWorkflowGate | 文档开发、README/站点、前后端契约、需求驱动交付链 | 列出最终用户文档位置、站点/README 判定、前端/API 契约、技术方案对照依据、真实用户流、失败恢复和队列/异步真实工作流证据 |
| audit-user-manual / UserManualReviewScope / DocsNavigationReviewMatrix | 用户侧文档 review、项目文档审查、菜单导航、sidebar、信息架构、文档设计 | 列出触发的用户文档审查聚合入口、targetSurface、primaryAudience、sourceOfTruth、reviewMode、pageRole/sidebar group 矩阵、route/label 真相源、生成站点或运行态验证证据、N/A skipReason |
| ReviewChecklistCompletenessGate / EvidenceExecutionGate / ReviewEscapeRecordGate | 复审、审查报告 intake、冻结清单、收敛验证，或复审发现原清单遗漏 | 列出冻结 checklist、每项执行证据、实际验证命令/脚本/页面/代码落点、重复维度规避、未执行项 skipReason；若发现遗漏，引用 escape record 的 `whyMissed / prevention / checklistPatch / rerunEvidence` |
| VerificationPlanMaterializationProbe / SidebarPageRoleMaterializationProbe / SidebarGroupSemanticModelProbe / ChinesePrimaryExpressionGate | CP2 验证计划、文档站 IA、中文用户文档 | 列出独立验证计划章节、验收/退出条件、pageRole/sidebar group 矩阵、route/label 真相源、中文主表达抽查和 skipReason |
| BuiltArtifactFeatureSmokeGate / TscOutputImportProbe | 构建产物、模块格式、adapter、运行时导出、TypeScript 输出 | 列出源码测试之外的构建产物导入/执行、feature smoke、TypeScript 输出导入探针与失败阈值 |
| GeneratedSiteGate / ManualTocDuplicationGate / UserPathContractSweep | 文档站、静态站、README/website/nav/sidebar 用户路径变更 | 列出生成产物路径、预览/截图/链接验证、TOC/sidebar/nav 去重、主要用户路径和消费者同步证据 |
| BenchmarkRegressionGuard | 性能优化、压测、缓存/队列/连接池、高频路径、性能声明 | 列出基线、对照、阈值、运行命令、样本或持续时间、回归判定和跳过理由 |
| DerivedMetricConsumerProbe / DerivedConsumerFailureInjectionProbe | 默认行为、控制流、能力触发、派生指标、日志、事件、warning、admin bridge 或 public types 变化 | 列出派生消费者、失败注入场景、主结果隔离、warn / ignore / propagate 策略、测试命令和残余风险 |
| FeatureInventoryProfileGate / FeatureChecklistEvidenceMatrixGate / BatchEvidenceLedgerStateGate / BatchProgressCardGate | 公开功能清单、Profile inventory、需求维度、复审清单或多批次矩阵验证 | 列出 feature inventory 来源、capability group × evidence surface、EvidenceLedger baseline/actualSources/commands/status/finding/skipReason、Progress Card 总范围/已完成/当前批/下一步/剩余/阻塞/证据链接 |
| LatestAbsorptionGuards | 最新吸纳守门集合 | 按 `GovernanceGateRegistry` 分组列出 `gateGroup / ownerSkill / validationRoute / evidence / N/A + skipReason`；legacy anchors 包括 `DatabaseRecordMigrationExportGate`、`FrontendBrowserVerificationBudgetGate`、`UserSelfVerificationOverrideGate`、`FindingProbeMatrixGate`、`MultiPhaseClosureGate`、`GuardPolicyBypassMatrixGate`、`VerificationCommandSideEffectGate`、`DesignFramePurposeClassificationGate`、`RequirementPreConfirmGate`、`PackageAdapterPreConfirmEvidenceGate`、`RequirementVerdictStateSyncGate`、`UserDocsPrimarySurfaceGate`、`UserFacingDeliveryChainGate`、`ReviewChecklistCompletenessGate`、`BuiltArtifactFeatureSmokeGate`、`GeneratedSiteGate`、`UserPathContractSweep`、`BenchmarkRegressionGuard` |

## 输出规则

- 每次会话必须写入报告文件（**chat 豁免**，[C05/S05](../../instructions/00-safety.instructions.md)）
- 报告中每条建议/问题必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围）— 与 [`17-compliance`](../compliance/SKILL.md) §1 输出验证保持一致
- analyze / audit / self-fix / dev / fix 报告中，若出现多个可执行建议、多个后续路径、方案对比或用户决策点，必须新增 `## 推荐结论` 或 `## 推荐方案`：推荐项有且仅有 1 个，并说明“推荐理由”；无后续动作时写 `推荐：无后续动作` 与原因
- 若最终采纳的是用户原始方案，报告中也必须写明“经独立验证后采纳”及其证据来源，避免形成“顺从结论”的假象
- audit / analyze / self-fix 的汇总型报告默认采用“两层问题清单”：先列根因级问题，再展开逐文件完整落点；边界/非缺陷结论单独成节，不混入缺陷编号
- 报告写入后必须执行 [`compliance`](../compliance/SKILL.md) Skill §5 二次验证（V1~V6）
- `dev` / `fix` 报告在最终宣告完成前，必须显式体现“ECR 执行闭环复审”这一正式阶段，并与 CP1/CP2/CP3、关键产物、报告、daily tasks、SUMMARY、diff/commit、测试/扫描证据和 dirty 边界完成 1 轮复审对照；若发现阻断性问题，不得直接以“已完成”收尾
- 跨会话、跨 Agent、多批次、summary/compact 前、用户要求“传递上下文”或未完成任务的报告必须包含 `ContextHandoffCard`；已完成且无需交接时写 `ContextHandoffCard: N/A + skipReason`
- `dev` / `fix` 报告的 ECR 必须把触发的 ExecutionContract / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / OfficialDocsEvidence / ProfileImpactCheck / 05-实施进度.md 纳入关键产物核对；未触发时写明 N/A 判定依据
- 若本轮来源于 backlog open/partial 项，报告必须额外写出 Backlog Intake 真相复核结果；若本轮改变了台账真实状态，报告必须额外写出台账状态回写闭环证据
- 若本轮涉及规范吸纳、data 台账治理、用户确认可泛化建议、最新可吸纳清单或新增门禁，报告必须额外写出 `spec-absorption` 执行证据：`CommonNormGeneralizationGate`、`AbsorptionCandidateConsumerProofGate`、候选矩阵、通用性证据、项目独有残留剔除、DevCodex 当前消费者和 targetOwner；随后写出 `LayeredAbsorptionGate`、`SkillFirstAbsorptionGate` 与 `LayeredAbsorptionDecision`（兼容 `SkillAbsorptionDecision`）。成组能力若未新增 Skill，必须说明为何仅并入既有 Skill 或仅作 docs-only，并列出 prompt/template、执行消费者、探针、公开文档和部署副本同步证据。
- 若本轮涉及历史通用规范、prompt/report 长清单、旧吸纳项或跨版本规范资产重新分层，报告必须额外写出 `HistoricalCommonNormLayeringGate`：逐文件审查矩阵、无法立即下沉的 `legacy-index-retained` 项、V74 探针、targeted tests、README/website/Profile/changelog 和部署副本同步证据。
- 若本轮采纳用户建议或用户确认方案，报告必须额外写出 `ProactiveBetterAlternativeGate`：是否存在更优替代、推荐取舍、最终采纳依据；不得只写“按用户确认执行”。
- 若本轮采纳用户更优建议或用户纠正后修改方案，报告必须额外写出 `AcceptedSuggestionRootCauseGate`：为什么前序检查没发现、采纳依据、关联台账编号和下次预防动作。
- 若本轮经历 CP 确认或进入编码执行，报告必须额外写出 `PostConfirmationReviewScopeGate` / `DevelopmentDriftGate`：轻量/全面复审判定、冻结清单或 skipReason、allowedFirstBatch、blockedScope、driftTriggers、validationRoute 和 dirty boundary。
- 若本轮来自用户确认的“仍需吸纳 / 未完整吸纳 / 半覆盖”清单，报告必须额外写出 `ConfirmedAbsorptionCompletenessGates`：每项是否完整落到 commonInstruction、skill、promptTemplate、executionConsumer、validationProbe、publicDocs、deployCopy；缺任一层必须写 `skipReason`、风险和后续 PF/ISSUE。
- 若本轮来自 A1~A10 最新吸纳执行包，报告必须额外写出 `LatestAbsorptionExecutionPack`：按 `docs-semantics-examples / derived-consumer-runtime / feature-inventory-batch-evidence / profile-service / absorption-layering` 分组列 ownerSkill、target files、V82/targeted test、ProfileImpactCheck、publicDocs、deployCopy、来源台账回写和未触发项 skipReason。
- 若本轮涉及宿主 Memories、模型长期偏好、resume / summary 恢复、Profile / memory bootstrap 或用户试图用“模型记得”替代文件读取，报告必须额外写出 `MemoryCannotSatisfyBootstrapGate`：Memories 只能作为 `navigation-hint`，并列出实际读取的 Profile、SUMMARY、tasks、reports、review checklist、源码 / 文档真相源和 V86/targeted probe 证据；未读取时只能写阻塞 / 降级。
- analyze/audit 报告使用 Profile 形成项目事实、范围、测试/发布或能力结论时，必须输出 `ProfileTruthReconciliationGate`；`stale-profile` 时以已验证现实矫正结论，并把 Profile 源修改交给独立 dev/fix/self-fix。
- 授权本地安全审查报告不得复制非必要可执行载荷；出现宿主安全提示时必须引用 SafetyInterruptionCard 与最近有效检查点，不得声称可通过改写绕过平台检查。
- 发布报告命中 `PublisherCredentialTopologyGate` 时必须把 topology evidence 与 NativeCommandExitCodeGate 分开记录；命令成功不能证明 secret scope/access/identity 等价，报告中不得出现 secret value。
- 若本轮涉及代码、文档、示例、fixture、mock、demo、quick start、技术方案或报告的专家型质量，或用户指出“不专业 / 像初级 / 示例误导”，报告必须额外写出 `ExpertOutputQualityGate`：说明生产推荐路径、框架原生能力、fixture/mock/demo 边界、反模式对照、证据矩阵和 V84/targeted probe 结果；不得只写“已优化表述”。
- 若本轮命中产品策略、开发者体验、UX 交互、前端架构、后端领域架构、生产可用性 / SRE、API 契约、外部集成、平台生态、AI Agent 系统、数据架构、安全威胁建模、质量策略、设计系统、无障碍/国际化、增长分析或商业模型专业语义，报告必须额外写出 `ExpertOwnerSkillGate`：说明触发的 ownerSkill、triggerReason、requiredFields、validationRoute、skipReason 和 V85/targeted probe 结果；增长 / 商业为 P3 条件触发，未触发时写 `N/A + skipReason`；不得只写“已用专家视角审查”。
- 报告涉及记录规范问题时，必须列出规范化意图、置信度、依据、目标台账；涉及规范源、Skill、Hook、CLI、MCP、模板、部署副本、路径规则或 validate 语义变更时，必须列出 SCV-0~SCV-7 证据
- 报告涉及审查报告、AI review finding、audit issue 或代码评审发现 intake 时，必须列出 `ReviewFindingIntakeGate` 证据；不得只写“按报告修复”或把报告结论当已验证事实
- 报告涉及新增跨项目已吸纳守门时，必须按 `GovernanceGateRegistry` 输出 `gateGroup / ownerSkill / validationRoute / evidence / N/A + skipReason`，不要复制完整长清单；代表性 legacy anchors 包括 `FigmaHighFidelityRestorationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate`、`CompatibilityAndContractAuthorityGate`、`PublicDocsReleasedVersionGate`、`ReviewDimensionDeltaGate`、`UserPerspectiveDocsGate`、`UserDocsPrimarySurfaceGate`、`RequirementVerdictStateSyncGate`、`ArtifactLinkSetDedupeGate`、`ActiveRequirementFinalResponseGate`、`DatabaseRecordMigrationExportGate`、`FrontendBrowserVerificationBudgetGate`、`FindingProbeMatrixGate`、`VerificationCommandSideEffectGate`、`RequirementPreConfirmGate`、`PackageAdapterPreConfirmEvidenceGate`、`UserFacingDeliveryChainGate`、`ReviewChecklistCompletenessGate`、`BuiltArtifactFeatureSmokeGate`、`GeneratedSiteGate`、`UserPathContractSweep` 与 `BenchmarkRegressionGuard`
- 控制面报告若出现新增探针、黄色偏离或部署同步，必须单独写出部署同步证据与其他证据来源，不能只在摘要里带过
- 报告末尾引用本次会话记忆路径
- 回复末尾必须输出产物文件路径（按 `ArtifactLinkSet` 输出主 Markdown 链接；当前宿主为 Codex Desktop/App、Copilot、未知宿主或用户反馈无法点击时，追加 `绝对路径：` copy fallback；输出前执行 `ArtifactLinkSetDedupeGate`，按规范化绝对路径去重同一物理文件，详见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md) §产物路径输出格式，[FC5](../compliance/SKILL.md)）

## 行数与拆分

- [C13](../../instructions/01-common.instructions.md) 只约束新建 DevCodex 规范资产 `.md`；报告不因 C13 强制压缩或拆分，超长报告按可读性、索引导航和项目规范决定是否拆分

## 写入工具选择（v1.9.4+）

新建报告预计 ≥ 200 行 → **Write 单次写入**（避免 Edit 多段写入被 session limit 截断；详见 [`16-report.instructions.md §写入工具选择`](../../instructions/16-report.instructions.md)）。已有报告小修订 → Edit。

## 跨会话报告

| 场景 | 处理 |
|------|------|
| 同一任务跨多会话 | 每次会话创建**独立报告文件**，不追加到前一份 |
| 修复后再审 | 独立文件，头部引用原始审查报告路径 |
| Token 中断恢复 | 新报告标注"恢复自会话 NN" |

> ⚠️ `dev` / `fix` 的“修复后再审/再次实施”并不自动等于收敛；仍须满足 ECR 执行闭环复审规则，确认最后一次阻断性修正后已有 1 轮无新增阻断问题的复审。

## 模板引用

| 报告类型 | 模板 |
|---------|------|
| 分析报告 | `prompts/report-analysis.prompt.md` |
| 审查报告 | `prompts/report-audit.prompt.md` |
| 规范自修复报告 | `prompts/report-audit.prompt.md`（结构相同，路径映射 `self-fix/`）|
| 开发报告 | `prompts/report-dev.prompt.md` |
| 开发报告（性能优化） | `prompts/report-optimization.prompt.md` |
| 开发报告（场景测试） | `prompts/report-scenario-test.prompt.md` |
| 修复报告 | `prompts/report-fix.prompt.md` |
