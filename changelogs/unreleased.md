# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更。
> **当前**: v1.15.1 发布后本文件应清空增量节；历史锚点索引供 validate 探针消费。

## 历史锚点索引（已随 v1.15.0 / v1.15.1 发布）

WorkspaceDataAbsorptionScopeGate · DocsSiteVisualAcceptanceGate · OmissionOnlyReviewGate · MethodLevelLeakPressureProbe · V2FormalSolutionPackage · V63 · V65 · FigmaHighFidelityRestorationGate · CompatibilityAndContractAuthorityGate · PublicDocsReleasedVersionGate · V66 · ReviewDimensionDeltaGate · UserPerspectiveDocsGate · DocsConsumerSweep · ArtifactLinkSetDedupeGate · FrontendRuntimeNetworkProbeGate · PI-052 · PF-056 · PublicUserDocsMaintainerBoundaryGate · ActiveRequirementFinalResponseGate · V67 · PI-053 · PI-054 · PF-057 · PF-058 · ChecklistStateMaterializationGate · V94 · consumer-validation-engineering · CandidateFreezeGate · IsolatedConsumerCwdGate · DesignFitnessGate · V96 · BrandVisualQualityGate · ComponentTransparencyTopologyGate · ProfileReleaseTruthAuthorityMatrixGate · RuntimeStateTransitionProjectionGate · ISSUE-043 · Turn Liveness · V98 · LocalTaskTraceV1 · ExecutionBudgetGate · ExternalWaitAccountingGate · LongTaskAuthorizationGate · WorkspaceSyncStatus · CompletionEvidenceGate · OwnIntroducedRegressionSelfFixGate · SharedStateMutationGate · ValidationLifecycleTraceabilityGate · Intent Expansion Card · execution-contract · test-router · release-verification · host-contract-verification · source-consumer-sync · verified-present · sticky `activeProject` · 意图扩展摘要 · ProductRequirementTraceabilityGate · PackageNameAuthorityGate · V2MCPFirstPlanningGate · rework-prevention-engineering · V95 · V1.15.0 · V1.15.1

## 当前未发布变更

### Grok workspace 子项目意图驱动桥接（2026-07-19）

- `workspace-namespace` 的项目根执行 `--host grok` 时自动部署轻量 `AGENTS.md`、单一 `devcodex-workspace` resolver Skill 与 Grok hooks；不复制父级 `.agents`，也不创建第二套项目运行态。
- bridge 在读取 Profile / memory / full fallback 前先形成语义意图种子，再绑定父级 kernel、项目 active-root 与意图相关 Skills；缺失或歧义时 fail-closed。
- 独立项目仍保留本地 kernel + Skills + 完整 fallback；部署 manifest、碰撞检测、host inspection、source-root 精确例外与正负向 fixture 已同步。
- 修正 Grok lifecycle 事件误带 tool matcher 导致 `UserPromptSubmit` / `Stop` 被拒载的问题；workspace bridge 通过可保留用户 TOML 的 managed MCP blocks 覆盖低优先级 `.mcp.json`，memory/profile direct doctor 均完成握手。

### 内部完整交付与用户可见输出契约（2026-07-19）

- 新增 `user-visible-output-contract`、`ArtifactDeliveryManifestV1`、`UserFacingArtifactSetV1`、`DevCodexVisibleEnvelopeV1` 与确定性 rich/portable/plain renderer；内部产物完整对账，用户面只投影真正需要的交付文件。
- session、daily、SUMMARY、task/checkpoint、raw receipt/manifest/ledger 默认 internal-only，但仍写入、验证并参与 ECR；可见文件统一使用语义名称、用途、动作与稳定阅读顺序。
- 链接按当前 surface 的 capability evidence 选择，未知能力保持 portable/plain，Rich clickable 不重复绝对路径；legacy 格式最多 `unverified-legacy`。visible Hook、V51、client/host tests、README、website 与报告/合规消费者已同步。

### 所有修复的长期防复发评估（2026-07-19）

- `rework-prevention-engineering` 新增 `RepairPreventionAssessmentGate` / `RepairPreventionAssessmentV1`，所有 repair 在 accepted 前必须区分当前问题关闭与长期 prevention 效果。
- 支持 `existing-control-restored / new-control-provisional / no-new-control / emergency-active`，高风险或 repeat escape 强制 full；当前事件重跑不得晋级 prevention，控制必须具备 prospective evidence 与 rollback/sunset。
- fix/security/execution/review/TestRoute/report/Prompt/registry 消费者与 V94、独立正负向验证节点已同步；未新增重复 Prevention Skill。

### 复审证据与状态单一投影（2026-07-19）

- 新增 `ReviewExecutionPlanV1`、`ReviewEvidenceReceiptV1`、`ReviewStateSnapshotV1`、`EvidenceSaturationResultV1` 与 `StageTimingV1` 确定性运行时。
- R0~R4 由 stage+risk+public/control-plane 选择；文件少不能降低高风险。candidate/scope/dimension/claim/lens/rule/skill/probe/dependency/consumer/environment 任一变化都会使 receipt stale。
- checklist/report/memory/progress/final 只投影同一 snapshotDigest；5% 稳定内容 oracle mismatch、必需证据缺失或 dirty boundary 漂移均回退 full-required。

### 提交候选派生资产新鲜度（2026-07-19）

- Skill portfolio 增加 worktree/index 双视图、consumer inventory/projection/input digest 与 `--check-staged` 维护者入口，直接校验 Git index 中将被提交的 blob。
- 新增“先生成、后 stage consumer”隔离负向夹具，并让 changed-scope validation 的 portfolio 节点覆盖实际 tracked text consumer 扩散面。
- `PostStageDerivedArtifactFreshnessGate` 同步到 Skill Owner、执行/复审/报告消费者和公开指南；完成证据要求 post-stage candidate 与 post-commit clean-tree 两阶段复证。

### 项目侧执行链性能、任务名续接与稳定演进（2026-07-19）

- 新增稳定 task identity 与 `继续<任务名>任务` 的 Hook/MCP/CLI 有界恢复链；索引损坏、同名歧义、完成态或 CP 漂移均 fail-closed。
- ContextRead V2 内容身份与 computation/body-delivery 分离；Profile section、Skill `BundleDecisionV2`、changed-scope validation DAG、`ProjectKnowledgeSnapshotV2` 和长任务 `ExecutionAttemptLedgerV1` 均保留完整 fallback。
- ProjectKnowledge 升级为单仓 V2：Merkle inventory、repo/root/config/parser/test/Profile binding、`FileKnowledgeRecordV2`、range-bound `SemanticClaimV1`、确定性 observe/bootstrap、5% oracle 与 accepted-only pointer；V1 仅只读兼容并强制 full-required migration。
- 新增 `ExecutionOptimizationStateV2`、prospective trial、rollback/sunset 与 `safe-auto | full-only` kill switch；六类真实消费者在动作前统一形成 `ExecutionOptimizationFeatureDecisionV1`，feature 回滚或状态无效会立即走完整执行路径。
- 新增 `test:execution-chain-evolution`、`benchmark:execution-chain`、canonical validation 节点及 V101；当前变更尚未发布，不改变 v1.15.1 registry 能力声明。

### CE+CPCF · 控制面闭合证据与误放行治理（2026-07-18）

- **ClosureEvidenceGate / ControlPlaneContractFirstGate / ConfirmBindingGate / ReReviewRuntimeFirstGate / HomologousDeployFilterGate** 写入 cp-gate、dev-plan-review、audit-common；always-on 仅索引。
- **ConfirmBinding**：`memory_cp_confirm` 支持 artifactPath/version/sha256 并磁盘重算；Hook `readCpConfirmations` 校验 digest（legacy 无 sha 兼容）。
- **HomologousDeploy**：`skill-deploy-filter` 同源过滤 gray；作用于 CLI copy 与 `buildDeploymentDescriptors`。
- **V100** + `npm run test:closure-evidence`。
- 需求：`.devcodex/devcodex-v1/requirements/控制面闭合证据与误放行治理/`。
