# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更。
> **当前**: v1.15.2 发布候选已归档到 `changelogs/releases/v1.15.2.md`；本文件保留历史锚点索引与候选镜像，供 validate 探针消费。

## 当前未发布实现候选（2026-07-21）

- 专家质量探针与实测标准收口：`MeasuredVerificationStandard` 写入 `compliance` SC14、`analyze-default` PCV-2a、`report`、`expert-output-quality`、`test-router`（`expertOutputQuality`）；V84 增加 raw-text 最小锚点区分力（防止 canonical reader 掩盖完全缺失），修正 profile skillCount 探针，不再要求所有薄消费者堆完整 Gate 长清单。
- 复审 R1 短修：`instructions/17-compliance.instructions.md` SC14 与 Skill 同源；`gate-registry` expert-output-quality 增加 `measuredVerification` / MVS legacyAnchors；V84 raw 强制对账 instructions+registry（防 VL-072 类逃逸）。
- PF-148 切片-1：validation-dag 增加 nested `delegatedClosure` 脚本路径存在性与 top-level leaf 命令一致性校验，并补负向 fixture。
- PF-148 切片-2：`buildNestedCommandGraph` + 委托 leaf 显式入选计划；`planLockAwareSchedule`（writeScopes 锁波次）；receipt `executionSchedule` / nested digests；duplicate-leaf command 证据复用；nodeId 缺失负向。
- PF-162 / GR-068：`memory_cp_confirm` 禁止将 CP 行写入普通会话索引表；写后校验无区外 CP 行；剥离历史孤儿 CP 行；新增 5 列索引无 CP 区块与污染表负向 fixture。
- PF-163：`lifecycle-visible-reply` 识别裸路径清单/绝对路径无操作；Stop 无 payload 时 missingItems 含 `semantic-artifact-items` + `visible-payload-unobserved`；补 hooks visibility 负向 fixture。
- PF-164：`ExternalReviewClaimVerificationGate` + `scripts/lib/external-review-claim-verification.js`；audit-report/report/report-audit 模板；gate-registry 分组；负向 claim-thin fixture；`npm run test:external-review-claim`。
- PF-165：Grok 完整工作流强制面 — `GrokTurnChecklist` + Intent→Skill bundle + `hostParity.repairSteps`/`failedChecks`；doctor 人类可执行修复闭环；`classifyGrokTurnOmissionSample` 负向；host-parity-grok / workspace Skill / UV / host-contract / Host Kernel passive-host 组；PreTool S07 assist 附 bundle 提示。
- PF-087（2026-07-21 入口完整性再开项）：`analyzeEntryCheckCompleteness` — 自由文本 PC0~PC7 分列必齐、禁止折叠合并、dev PC4 无 skipReason 不得伪 N/A；Stop 半截入口 → `verified-missing` + closure reminder；hooks-runtime 负向 fixture；UV FreeTextEntryCheckCompletenessGate。
- `devcodex status` / `devcodex doctor` 增加只读 `GovernanceStatusSummaryV1`：汇总 runtime-state、ledger 退役候选、Skill/gray lifecycle、执行优化证据、Gate registry、host truth、dirty boundary 与 fail-closed fast-path 决策；JSON 输出挂载到 `payload.governanceSummary`，human 输出只增加一行治理概览。
- 新增 `SimpleGovernanceFastPathDecisionV1`，将可见输出 compact 条件显式化；控制面、source mutation、共享状态、风险非 low、CP 未确认、证据缺失或非 compactable message kind 均 fail-closed 到 full。
- 新增 `scripts/lib/governance-status-summary.js` 与 `scripts/test-governance-status-summary.js`，并接入 `test:control-plane` / `test:optimization-controls`；不新增依赖、不改发布版本、不执行 tag/push/publish。
- 新增 `AlwaysOnGovernanceSummaryV1` 与 `scripts/lib/always-on-governance.js`：统一生成 `AlwaysOnSurfaceMatrixV1`、`AlwaysOnLayerMatrixV1`、`HostAdapterCompatibilityMatrixV1`、`AlwaysOnLoadReceiptV1` 和 `AlwaysOnShadowResultV1`；`status/doctor --json` 只读投影 `payload.governanceSummary.alwaysOn`。
- 新增 `npm run test:always-on-governance` 与 validation DAG 节点 `always-on-governance`：验证 Host Kernel + `instructions/*.md applyTo:"**"` 双 surface、L0 强不变量、宿主声明上限、load receipt fail-closed 和 Q1~Q8 40 样本 Shadow P0 零漏判。
- Always-On 本轮仍保持 `defaultBehaviorChanged=false`、`ao3Enabled=false`：AO-0/AO-1/AO-2/AO-4 基础闭环已落地，AO-3 默认轻注入需 Shadow green 后另行确认。

## 历史锚点索引（已随 v1.15.0 / v1.15.1 / v1.15.2 发布或归档）

WorkspaceDataAbsorptionScopeGate · DocsSiteVisualAcceptanceGate · OmissionOnlyReviewGate · MethodLevelLeakPressureProbe · V2FormalSolutionPackage · V63 · V65 · FigmaHighFidelityRestorationGate · CompatibilityAndContractAuthorityGate · PublicDocsReleasedVersionGate · V66 · ReviewDimensionDeltaGate · UserPerspectiveDocsGate · DocsConsumerSweep · ArtifactLinkSetDedupeGate · FrontendRuntimeNetworkProbeGate · PI-052 · PF-056 · PublicUserDocsMaintainerBoundaryGate · ActiveRequirementFinalResponseGate · V67 · PI-053 · PI-054 · PF-057 · PF-058 · ChecklistStateMaterializationGate · V94 · consumer-validation-engineering · CandidateFreezeGate · IsolatedConsumerCwdGate · DesignFitnessGate · V96 · BrandVisualQualityGate · ComponentTransparencyTopologyGate · ProfileReleaseTruthAuthorityMatrixGate · RuntimeStateTransitionProjectionGate · ISSUE-043 · Turn Liveness · V98 · LocalTaskTraceV1 · ExecutionBudgetGate · ExternalWaitAccountingGate · LongTaskAuthorizationGate · WorkspaceSyncStatus · CompletionEvidenceGate · OwnIntroducedRegressionSelfFixGate · SharedStateMutationGate · ValidationLifecycleTraceabilityGate · Intent Expansion Card · execution-contract · test-router · release-verification · host-contract-verification · source-consumer-sync · verified-present · sticky `activeProject` · 意图扩展摘要 · ProductRequirementTraceabilityGate · PackageNameAuthorityGate · V2MCPFirstPlanningGate · rework-prevention-engineering · V95 · 项目侧执行链性能 · ExecutionOptimizationFeatureDecisionV1 · V101 · BaseImpactAssessmentV1 · ComplexityDeltaBudgetV1 · UnaffectedIntentRegression · OperationExplanationContractV1 · CodeTruthEvidenceMatrixGate · SolutionFitAgainstRepoGate · V1.15.0 · V1.15.1 · V1.15.2

## v1.15.2 归档候选镜像

### DevCodex V1 基座准入与证据合同（2026-07-20）

- G4：`BaseImpactAssessmentV1` / `ComplexityDeltaBudgetV1` / `UnaffectedIntentRegression` 纳入既有 spec-absorption / test-router / V96，不新增平行 Registry 或常驻基座流程；新增 `replacementOrRetirementCredit`、回滚和退役/删除条件，防止后续规范、Skill、Prompt 或验证器继续侵入稳定基座。
- G5：`OperationExplanationContractV1`、`ResponseProvenanceClosureGate`、`CodeTruthEvidenceMatrixGate`、`SolutionFitAgainstRepoGate`、`UniqueRecommendationBeforeConfirmGate` 与 `NoPreferenceMenuAfterConvergenceGate` 纳入 expert-output / CP / report 消费者；V84 增加操作合同缺字段、代码事实缺证据和多推荐菜单负样本。

### DevCodex V1 全量审计 residual F 项闭环（ISSUE-045 / ISSUE-047 / ISSUE-051 / ISSUE-052 / ISSUE-053 / ISSUE-054 / ISSUE-057，2026-07-20）

- Profile 06 `validation-execution` 证据数字同步当前 validation manifest：64 nodes、fast 59、full 62，避免旧 `54/full 53` 继续误导审计结论。
- memory MCP 增加 `memory_session_allocate`、active-root/agent/date scoped lock、原子文件替换与 `MemoryTransactionReceiptV1`；memory Skill 增加 `MemoryTransactionWriterGate`，测试覆盖唯一会话分配、事务 receipt、锁冲突 fail-closed 与无半提交。
- HostParity 发布关键测试不再依赖仓库外 `.devcodex` 运行态文档，改用 tracked fixture；portable Grok SessionStart 对 `GROK_SESSION_ID` 做清洗和 base-boundary check，并增加 hostile replay 防路径越界。
- workspace deployment manifest 通过 `devcodex update` 重新同步，status/doctor 与 `test:profile-deploy` 的 managed manifest 权威重新一致；Agent SUMMARY 历史违规投影补齐至 runtime alerts=0。

### HostParity 残留验证收口（ISSUE-049 / ISSUE-050，2026-07-20）

- `CHANGELOG.md` 的“最新版本详细变更文档”链接回到当前 package 版本，并在 V4 增加确定性探针，防止发布摘要再次滞后。
- CLI 顶层命令补齐 `help` / `--help` / `--version` / `version` 语义；未知命令返回 `CLI_COMMAND_UNKNOWN` 与非零退出码，并通过 registry 与真实进程回归测试覆盖。
- 修复 `changelogs/unreleased.md` 到站点文档的相对链接，消除 V2 残留告警。

### S07 入口检查时序与产物写入门禁（VL-004 / PI-016，2026-07-20）

- 规范：`S07` 明确用户**首次可见** PC0~PC7 先于实质正文与产物 mutation（`reports/`、`.memory/`、台账）；禁止「最终文首补 PC」冒充先输出；`17-compliance` / `compliance` / `precheck-status` / `user-visible-output-contract` 同源对齐；kernel 投影已刷新。
- 运行时：产物路径 PreToolUse 默认 safety-only 提醒一次、`strict` deny；Stop 结算 `s07OrderStatus=ok|late|missing|unverified` 并在 late 时 closure reminder。
- 验证：`scripts/test-hooks-runtime.js` 覆盖 warn/deny/只读放行/late；工作区 `update --host all` 同步 `.codex`/`.claude`/`.github`/Gemini runtime 与 `AGENTS.md` / `instructions.full.md`。

### Grok HostParity（对齐 Codex 硬门禁，2026-07-20）

- Grok PreToolUse 输出适配官方契约：`permissionDecision` / `decision:block` → `{"decision":"deny","reason"}`；允许 → `{"decision":"allow"}`。
- 被动事件（UserPromptSubmit / Stop / PreCompact 等）剥离硬拦 decision，并标记 `passive-hook-no-context-injection`，禁止把 stdout 当成上下文注入证据。
- `hostCapabilityFor('grok')` 升为 `path-observable`（与 Codex 同档工具路径观察）；`eventSupportsHardBlock` 对 Grok 仅承认 PreToolUse。
- workspace plugin Skill 增加 Full（`devcodex grok --rules`）/ Partial（plain child）诚实分列；禁止宣称与 Codex hook-enforced 完全一致。
- 契约测试：`scripts/test-host-adapters.js` 覆盖 deny/allow、被动不 block、path-observable 与 hard-block 矩阵。
- **补齐**：`HostParityScorecardV1` 接入 `doctor`/`status`（含 `--json`）；Grok `SessionStart` 会话戳记；上下文 deny 附 S07 PC0 辅助模板；Stop 探针扩展字段与 `### DevCodex · 入口检查` 识别；MCP `profile_compose_entry_check`；`npm run test:host-parity`。
- **收口剩余可交付**：站内 [Grok 与 Codex 对齐](../website/docs/intro/host-parity-grok.md) + sidebar；哲学页 Auto 宿主诚实分列；阶段 3 平台需求单 `03-平台能力需求-xAI.md`；`test-host-parity-remaining` 跨宿主 hard-block 与文档存在性烟测。
- **Grok 危险命令未拦修复**：PreTool/PostTool 去掉非法 regex matcher `*`（Grok 按正则解析，`*` 无效导致 hook 可能不触发）；`pre_tool_use` 等 snake_case 事件名规范为 lifecycle `PreToolUse`；bridge 在 `decision:deny` 时 exit 2。
- **Grok bridge 二次加固**：`GROK_WORKSPACE_ROOT`/多 cwd 候选与 plugin-bound fallback；adapter 非 0 退出仍解析 deny JSON；bridge 本地危险命令兜底 deny；写入 `pretool-last.json` 诊断；Remove-Item 参数顺序兼容。
- **HostParity 残余收口**：入口检查 helper 的 PC4 改为 `dev / prod / unknown` 三态；Grok workspace bridge 对 passive event 输出 `{ continue: true }`、PreToolUse 保持 Grok native allow/deny，并修复 nested workspace owner 越界；`status/doctor` 将 Grok installed source+registration 与 installed digest drift 分层，digest drift 仅 warning；package `files` 补入 `scripts/lib/host-parity-scorecard.js` 并通过 pack/isolated consumer smoke。

### Grok workspace 插件与宿主作用域纠偏（2026-07-20）

- `workspace-namespace` 的项目根执行 `--host grok` 时，实际部署 owner 自动提升到工作区根：工作区只保留单一 `devcodex-workspace` 薄插件，子项目不生成 `AGENTS.md`、`.grok` 或其他宿主入口，也不创建第二套项目运行态。
- bridge 在读取 Profile / memory / full fallback 前先形成语义意图种子，再绑定父级 kernel、项目 active-root 与意图相关 Skills；缺失或歧义时 fail-closed。
- 独立项目仍保留本地 kernel + Skills + 完整 fallback；部署 manifest、碰撞检测、host inspection、source-root 精确例外与正负向 fixture 已同步。
- 修正 Grok lifecycle 事件误带 tool matcher 导致 `UserPromptSubmit` / `Stop` 被拒载的问题；workspace 模式改由工作区薄插件承载 Hook 与 MCP bridge，通过官方本地插件安装登记确保 Git 项目 cwd 可达，只维护 `plugins.enabled` 并迁出旧的同 owner path 注册，避免插件碰撞；安装过程恢复用户配置原始字节。
- 修复 Grok workspace plugin 双身份碰撞：`HostAdapterScopeV1` 将 canonical source 迁移到非自动发现的 `.grok/devcodex/plugins/devcodex-workspace`，只保留官方 user installation identity；旧 source/registration 采用 install-before-move 的可逆备份迁移，配置保真、工作区外 no-op、子项目零 generated host artifacts 与 legacy manifest 退休保持不变。
- 新增 `devcodex grok` full-evidence launcher：只在 workspace 子 Git 项目用官方 `--rules` 绑定共享 kernel，并明确把 plain child 的 Skill-discovery/partial 与 launcher direct evidence 分开；修正把 passive Hook stdout 误当上下文注入的错误口径。
- 拆分包开发与 Claude 安装态 MCP 契约：源码根 `.mcp.json` 改为指向实际存在的包内 `mcp/*`，CLI 仍为业务项目生成 `.claude/mcp/*`，避免 Grok 在源码仓发现通用 manifest 时启动不存在路径。
- 补齐 `uninstall --host grok` 生命周期：复用 `HostAdapterScopeV1`，官方卸载用户插件并只移除 DevCodex 受管配置，保留 workspace source、未知键/注释与重复卸载幂等性。
- 关闭诊断与 launcher 的作用域旁路：从子项目执行 `status/doctor` 也检查工作区 owner；`devcodex grok` 先消费官方 `--cwd`，拒绝 system-prompt override/重复 cwd，并在 root kernel 缺失、nested workspace 或 Windows 路径大小写变体下保持 fail-closed/同一身份。
- 修复无 Grok CLI 环境下 workspace plugin 安装降级路径：仍写入 canonical `plugins.enabled` registration 与 migration receipt，但 installation 保持 `unavailable`，避免 CI/Linux 无 CLI 时 status/doctor 与 host-installation 契约漂移。
- 补强 Grok CLI 探测降级：当 clean Linux/CI 环境返回 `status=null` 且无 stdout/stderr 时，按 CLI 不可用处理并保留 `unavailable` receipt；真实非零 CLI 输出仍 fail，避免 `GROK_PLUGIN_CLI_UNAVAILABLE: null` 逃逸。

### 内部完整交付与用户可见输出契约（2026-07-19）

- 新增 `user-visible-output-contract`、`ArtifactDeliveryManifestV1`、`UserFacingArtifactSetV1`、`DevCodexVisibleEnvelopeV1` 与确定性 rich/portable/plain renderer；内部产物完整对账，用户面只投影真正需要的交付文件。
- session、daily、SUMMARY、task/checkpoint、raw receipt/manifest/ledger 默认 internal-only，但仍写入、验证并参与 ECR；可见文件统一使用语义名称、用途、动作与稳定阅读顺序。
- 链接按当前 surface 的 capability evidence 选择，未知能力保持 portable/plain，Rich clickable 不重复绝对路径；legacy 格式最多 `unverified-legacy`。visible Hook、V51、client/host tests、README、website 与报告/合规消费者已同步。

### 所有修复的长期防复发评估（2026-07-19）

- 将所有 repair 的稳定完成门禁拆为 active `repair-prevention-assessment`（`RepairPreventionAssessmentGate` / `RepairPreventionAssessmentV1`）；gray `rework-prevention-engineering` 只保留返工指标与 prospective effectiveness，消除 active workflow 对默认不部署 gray Skill 的强依赖。
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
- ProjectKnowledge 生产 CLI 现从真实 inventory 构建并持久化 versioned `ImpactGraphV1`，覆盖 JS/TS 静态相对依赖与 Markdown 本地链接；普通图变化走当前闭包，builder 迁移、低覆盖或动态消费者自身变化才升级全文。
- 新增 `ExecutionOptimizationStateV2`、prospective trial、rollback/sunset 与 `safe-auto | full-only` kill switch；六类真实消费者在动作前统一形成 `ExecutionOptimizationFeatureDecisionV1`，feature 回滚或状态无效会立即走完整执行路径。
- 新增 `test:execution-chain-evolution`、`benchmark:execution-chain`、canonical validation 节点及 V101；当前变更已归档到 v1.15.2 发布候选，发布事实以 registry/tag/R7 验收为准。

### CE+CPCF · 控制面闭合证据与误放行治理（2026-07-18）

- **ClosureEvidenceGate / ControlPlaneContractFirstGate / ConfirmBindingGate / ReReviewRuntimeFirstGate / HomologousDeployFilterGate** 写入 cp-gate、dev-plan-review、audit-common；always-on 仅索引。
- **ConfirmBinding**：`memory_cp_confirm` 支持 artifactPath/version/sha256 并磁盘重算；Hook `readCpConfirmations` 校验 digest（legacy 无 sha 兼容）。
- **HomologousDeploy**：`skill-deploy-filter` 同源过滤 gray；作用于 CLI copy 与 `buildDeploymentDescriptors`。
- **V100** + `npm run test:closure-evidence`。
- 需求：`.devcodex/devcodex-v1/requirements/控制面闭合证据与误放行治理/`。
