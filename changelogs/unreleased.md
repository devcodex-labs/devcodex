# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更。
> **当前**: v1.15.1 发布后本文件应清空增量节；历史锚点索引供 validate 探针消费。

## 历史锚点索引（已随 v1.15.0 / v1.15.1 发布）

WorkspaceDataAbsorptionScopeGate · DocsSiteVisualAcceptanceGate · OmissionOnlyReviewGate · MethodLevelLeakPressureProbe · V2FormalSolutionPackage · V63 · V65 · FigmaHighFidelityRestorationGate · CompatibilityAndContractAuthorityGate · PublicDocsReleasedVersionGate · V66 · ReviewDimensionDeltaGate · UserPerspectiveDocsGate · DocsConsumerSweep · ArtifactLinkSetDedupeGate · FrontendRuntimeNetworkProbeGate · PI-052 · PF-056 · PublicUserDocsMaintainerBoundaryGate · ActiveRequirementFinalResponseGate · V67 · PI-053 · PI-054 · PF-057 · PF-058 · ChecklistStateMaterializationGate · V94 · consumer-validation-engineering · CandidateFreezeGate · IsolatedConsumerCwdGate · DesignFitnessGate · V96 · BrandVisualQualityGate · ComponentTransparencyTopologyGate · ProfileReleaseTruthAuthorityMatrixGate · RuntimeStateTransitionProjectionGate · ISSUE-043 · Turn Liveness · V98 · LocalTaskTraceV1 · ExecutionBudgetGate · ExternalWaitAccountingGate · LongTaskAuthorizationGate · WorkspaceSyncStatus · CompletionEvidenceGate · OwnIntroducedRegressionSelfFixGate · SharedStateMutationGate · ValidationLifecycleTraceabilityGate · Intent Expansion Card · execution-contract · test-router · release-verification · host-contract-verification · source-consumer-sync · verified-present · sticky `activeProject` · 意图扩展摘要 · ProductRequirementTraceabilityGate · PackageNameAuthorityGate · V2MCPFirstPlanningGate · rework-prevention-engineering · V95 · V1.15.0 · V1.15.1

## 当前未发布变更

### 项目侧执行链性能、任务名续接与稳定演进（2026-07-19）

- 新增稳定 task identity 与 `继续<任务名>任务` 的 Hook/MCP/CLI 有界恢复链；索引损坏、同名歧义、完成态或 CP 漂移均 fail-closed。
- ContextRead V2 内容身份与 computation/body-delivery 分离；Profile section、Skill `BundleDecisionV2`、changed-scope validation DAG、`ProjectKnowledgeSnapshotV1` 和长任务 `ExecutionAttemptLedgerV1` 均保留完整 fallback。
- 新增 `ExecutionOptimizationStateV2`、prospective trial、rollback/sunset 与 `safe-auto | full-only` kill switch；六类真实消费者在动作前统一形成 `ExecutionOptimizationFeatureDecisionV1`，feature 回滚或状态无效会立即走完整执行路径。
- 新增 `test:execution-chain-evolution`、`benchmark:execution-chain`、canonical validation 节点及 V101；当前变更尚未发布，不改变 v1.15.1 registry 能力声明。

### CE+CPCF · 控制面闭合证据与误放行治理（2026-07-18）

- **ClosureEvidenceGate / ControlPlaneContractFirstGate / ConfirmBindingGate / ReReviewRuntimeFirstGate / HomologousDeployFilterGate** 写入 cp-gate、dev-plan-review、audit-common；always-on 仅索引。
- **ConfirmBinding**：`memory_cp_confirm` 支持 artifactPath/version/sha256 并磁盘重算；Hook `readCpConfirmations` 校验 digest（legacy 无 sha 兼容）。
- **HomologousDeploy**：`skill-deploy-filter` 同源过滤 gray；作用于 CLI copy 与 `buildDeploymentDescriptors`。
- **V100** + `npm run test:closure-evidence`。
- 需求：`.devcodex/devcodex-v1/requirements/控制面闭合证据与误放行治理/`。
