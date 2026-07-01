# 最新 data 吸纳守门补强

> **状态**：✅ 已实现  
> **优先级**：P1  
> **关联规则**：`WorkspaceDataAbsorptionScopeGate`、`FlowchartNodeExplanationGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`ReviewFindingIntakeGate`、`ReviewDimensionDeltaGate`、`UserPerspectiveDocsGate`、`PublicUserDocsMaintainerBoundaryGate`、`DocsConsumerSweep`、`ArtifactLinkSetDedupeGate`、`FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate`、`ExplicitCommitAuthorizationGate`、`CompatibilityAndContractAuthorityGate`、`UIConfirmedSourceConflictTraceGate`、`PublicDocsReleasedVersionGate`、`CollectionRelationIdNamingGate`、`UserFacingVerificationArtifactLanguageGate`、`ActiveRequirementFinalResponseGate`、`DatabaseRecordMigrationExportGate`、`FrontendBrowserVerificationBudgetGate`、`UserSelfVerificationOverrideGate`、`FindingProbeMatrixGate`、`MultiPhaseClosureGate`、`GuardPolicyBypassMatrixGate`、`SideEffectCompatibilityDocsGate`、`ExecutableExampleTruthProbeGate`、`VisualDeviationTypeGate`、`OneOffRequirementScriptPlacementGate`、`VerificationCommandSideEffectGate`、`DesignFramePurposeClassificationGate`、`RequirementPreConfirmGate`、`PackageAdapterPreConfirmEvidenceGate`、`MethodLevelLeakPressureProbe`、`V2FormalSolutionPackage`

## 背景

在跨项目 data 台账复核中发现，吸纳范围、遗漏专审、流程图说明、文档站体验验收、泄漏压测粒度和 v2 一期正式方案包仍需要从“建议”升级为可执行门禁。

本需求将这些剩余项纳入 `CrossProjectLearnedGuards`、TestRoute、dev/audit Skill、prompt、README/website 与验证探针，避免只在报告里出现一次性结论。

## 需求

| 守门项 | 触发场景 | 最小验收 |
|--------|----------|----------|
| `WorkspaceDataAbsorptionScopeGate` | 检查 data 目录、最新可吸纳问题、仍需吸纳清单、开始吸纳 | 扫描 `.devcodex/*/data/` 全命名空间，输出命中台账、候选编号、归属和跳过理由 |
| `FlowchartNodeExplanationGate` | 正式流程图、生命周期图、Nxx 节点图、维护者流程页 | 每个非终止节点有中文说明，覆盖触发、前置、动作、出口、异常/回退 |
| `DocsSiteVisualAcceptanceGate` | 官网、文档站、技术站或正式说明页的视觉/交互验收 | 覆盖主题集成、真实点击、异步动效、减弱动态、代码 token 对比度、终端 demo 范围、TOC inline code 和辅助导航层级 |
| `OmissionOnlyReviewGate` | 用户要求只审遗漏、上次没检查、只列仍需吸纳项 | 只输出此前未覆盖且仍有处理价值的遗漏项，已吸纳/关闭/无必要项只写排除理由 |
| `ReviewFindingIntakeGate` | 外部审查报告、AI review finding、audit issue 或代码评审发现进入修复/建议前 | 报告只是线索，逐条补本地证据并分流 must-fix、用户决策、文档/实现漂移、测试覆盖缺口、未复现或设计如此 |
| `ReviewDimensionDeltaGate` | R2+ 复审、audit 连续零发现、ECR 或遗漏专审 | 记录 PreviousDimensionSet、CurrentDimensionFocus、NewDimensionRationale、RepeatedDimensionReason，避免每轮机械重复同一组维度 |
| `UserPerspectiveDocsGate` | README、官网/文档站、接口说明、运行手册、需求/方案等人读文档 | 从使用者角度覆盖第一次成功、常见任务、字段/参数/状态/错误解释、排错恢复、限制和低心智负担 |
| `PublicUserDocsMaintainerBoundaryGate` | README、官网教程、快速上手、配置/扩展/框架接入等公开用户文档 | 用户主路径不得混入维护者验收、发布 checklist、内部同步清单、台账状态或实现者复审任务 |
| `DocsConsumerSweep` | 文档新增/调整命令、配置项、字段、状态、路径、能力承诺或阅读顺序 | 扫描 README、website、Profile、prompts、templates、examples、nav/sidebar、validate probes、部署副本和代码消费点 |
| `ArtifactLinkSetDedupeGate` | 最终回复、报告、记忆、SUMMARY 或宿主文件面板消费产物链接 | 按 canonical path 去重同一物理文件，区分同名不同目录、历史镜像和部署副本，避免双份产物展示 |
| `ActiveRequirementFinalResponseGate` | 同日或同工作区存在多个相邻需求、backlog、open 任务或未完成候选 | 最终回复和完成报告先声明当前 active requirement/task/bug id，完成状态、验证证据、dirty 边界和下一步只围绕当前范围 |
| `FigmaHighFidelityRestorationGate` / `ScopedVisualChangeGate` | Figma、截图、既有页面还原或局部视觉修复 | 冻结设计来源、allowedScope/frozenScope、元素分类、偏离理由和实际视觉验证证据 |
| `InstalledPluginVisualVerificationGate` / `ActualPreviewChainAndMockFallbackGate` / `FrontendRuntimeNetworkProbeGate` / `UIStateScopeRegressionGate` | 前端真实页面验证、插件链可用或多状态回归 | 优先使用已安装 Figma/Browser/Chrome 工具，确认真实 preview/API/路由，检查 console/network/resource/runtime，列出状态清单和 mock 排除证据 |
| `FigmaProductionAssetBudgetGate` / `RuntimeI18nArtifactVerificationGate` | 设计资产进入生产或多语言运行时变更 | 记录资产尺寸/体积/格式/public 路径，核对源 JSON、构建合并产物和页面 runtime key 残留 |
| `ExplicitCommitAuthorizationGate` | 需要执行本地 commit | 只有用户明确要求才提交，回滚点和语义批次清晰只能作为建议或确认理由 |
| `CompatibilityAndContractAuthorityGate` | 兼容修复、共享库/adapter/SDK 或上游契约判断 | 区分零代码消费者兼容、上游合同权威和官方 public API 证据，避免影子 allowlist |
| `UIConfirmedSourceConflictTraceGate` / `PublicDocsReleasedVersionGate` | UI/Figma 覆盖旧 PRD，或公开文档描述未发布能力 | 保留冲突表和采纳理由；公开文档区分 released / unreleased / preview |
| `CollectionRelationIdNamingGate` / `UserFacingVerificationArtifactLanguageGate` | 关系 id 命名或用户可读验证产物 | 关系字段按集合/实体语义命名；`.http`/集成说明默认使用用户当前语言 |
| `MethodLevelLeakPressureProbe` | 高风险资源泄漏修复、公开库/adapter/SDK、连接/监听/定时器/worker/cache 风险 | 评估公开方法级重复调用或生命周期压测，记录指标、阈值、冷却和清理证据 |
| `V2FormalSolutionPackage` | v2 一期正式规划、方案冻结或 ISSUE-027 尾项治理 | 形成 CP1/CP2 方案包，覆盖架构、数据模型、MCP API contract、instruction return、可见性、cache/signature/rollback、Codex-only 验证、Registry/Marketplace、私有维护站和 Mermaid 节点流程 |
| `DatabaseRecordMigrationExportGate` | 数据库配置、模板、模块注册、权限、字典等跨环境迁移 | 只读源库，导出完整记录链、JSON/Extended JSON、insert/upsert 脚本、执行顺序、引用完整性和 dry-run |
| `FrontendBrowserVerificationBudgetGate` / `UserSelfVerificationOverrideGate` | 前端验证成本分层或用户明确自验/禁止浏览器 | 浏览器验证分 required / optional / N/A；用户自验时停止 Browser/CDP/Playwright/截图，仅保留代码级证据 |
| `FindingProbeMatrixGate` / `GuardPolicyBypassMatrixGate` | 外部 finding 修复、guard/policy/permission/consistency 能力 | 逐项反证矩阵和绕过面矩阵，覆盖失败输入、修复前失败、修复后通过和负向探针 |
| `SideEffectCompatibilityDocsGate` / `ExecutableExampleTruthProbeGate` | 公开文档兼容旧路径或 DSL/配置/模板示例 | 带副作用旧路径不进公开主路径；示例进入公开文档前必须用当前实现跑最小探针 |
| `VisualDeviationTypeGate` / `DesignFramePurposeClassificationGate` | UI/Figma/截图修复或设计来源判定 | 先分类视觉偏差，读取设计参数，列目标帧/排除帧/用途分类和验收入口 |
| `OneOffRequirementScriptPlacementGate` / `VerificationCommandSideEffectGate` | 一次性需求脚本或验证命令执行 | 一次性脚本归属任务目录；验证命令前判定副作用，执行后扫描/隔离/清理生成物 |
| `RequirementPreConfirmGate` / `MultiPhaseClosureGate` | 推荐确认需求或分阶段需求关闭 | 确认行为可验证、范围冲突和 fail-safe；分阶段需求列 Phase 2+、门禁、确认点和最终关闭规则 |
| `PackageAdapterPreConfirmEvidenceGate` | package/adapter/SDK/CLI/plugin 方案确认前 | 核对 package/plugin/exports/bin/files/dist/registry/消费者入口证据，缺证据不得宣称可用 |

## 验证

- `node scripts/validate.js` 必须包含 V63~V68 探针；其中 V67 保留公开用户文档与最终回复 active 范围守门，V68 覆盖本批最新 data 吸纳守门。
- `node scripts/test-spec-governance.js` 必须覆盖上述规则在 instructions、skills、prompts、README、website 与 changelog 的同步，包含 `ReviewFindingIntakeGate`、`ReviewDimensionDeltaGate`、`UserPerspectiveDocsGate`、`PublicUserDocsMaintainerBoundaryGate`、`DocsConsumerSweep`、`ArtifactLinkSetDedupeGate`、`FrontendRuntimeNetworkProbeGate`、`ActiveRequirementFinalResponseGate` 与 V68 新增门禁。
- 文档站 sidebar 与需求索引必须出现本页入口。
