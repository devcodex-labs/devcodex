# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更。
> **当前**: v1.15.1 发布后本文件应清空增量节；历史锚点索引供 validate 探针消费。

## 历史锚点索引（已随 v1.15.0 / v1.15.1 发布）

WorkspaceDataAbsorptionScopeGate · DocsSiteVisualAcceptanceGate · OmissionOnlyReviewGate · MethodLevelLeakPressureProbe · V2FormalSolutionPackage · V63 · V65 · FigmaHighFidelityRestorationGate · CompatibilityAndContractAuthorityGate · PublicDocsReleasedVersionGate · V66 · ReviewDimensionDeltaGate · UserPerspectiveDocsGate · DocsConsumerSweep · ArtifactLinkSetDedupeGate · FrontendRuntimeNetworkProbeGate · PI-052 · PF-056 · PublicUserDocsMaintainerBoundaryGate · ActiveRequirementFinalResponseGate · V67 · PI-053 · PI-054 · PF-057 · PF-058 · ChecklistStateMaterializationGate · V94 · consumer-validation-engineering · CandidateFreezeGate · IsolatedConsumerCwdGate · DesignFitnessGate · V96 · BrandVisualQualityGate · ComponentTransparencyTopologyGate · ProfileReleaseTruthAuthorityMatrixGate · RuntimeStateTransitionProjectionGate · ISSUE-043 · Turn Liveness · V98 · LocalTaskTraceV1 · ExecutionBudgetGate · ExternalWaitAccountingGate · LongTaskAuthorizationGate · WorkspaceSyncStatus · CompletionEvidenceGate · OwnIntroducedRegressionSelfFixGate · SharedStateMutationGate · ValidationLifecycleTraceabilityGate · Intent Expansion Card · execution-contract · test-router · release-verification · host-contract-verification · source-consumer-sync · verified-present · sticky `activeProject` · 意图扩展摘要 · ProductRequirementTraceabilityGate · PackageNameAuthorityGate · V2MCPFirstPlanningGate · rework-prevention-engineering · V95 · V1.15.0 · V1.15.1

## 当前未发布变更

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
- **收口剩余可交付**：站内 [Grok 与 Codex 对齐](website/docs/intro/host-parity-grok.md) + sidebar；哲学页 Auto 宿主诚实分列；阶段 3 平台需求单 `03-平台能力需求-xAI.md`；`test-host-parity-remaining` 跨宿主 hard-block 与文档存在性烟测。
- **Grok 危险命令未拦修复**：PreTool/PostTool 去掉非法 regex matcher `*`（Grok 按正则解析，`*` 无效导致 hook 可能不触发）；`pre_tool_use` 等 snake_case 事件名规范为 lifecycle `PreToolUse`；bridge 在 `decision:deny` 时 exit 2。
- **Grok bridge 二次加固**：`GROK_WORKSPACE_ROOT`/多 cwd 候选与 plugin-bound fallback；adapter 非 0 退出仍解析 deny JSON；bridge 本地危险命令兜底 deny；写入 `pretool-last.json` 诊断；Remove-Item 参数顺序兼容。

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
- 新增 `test:execution-chain-evolution`、`benchmark:execution-chain`、canonical validation 节点及 V101；当前变更尚未发布，不改变 v1.15.1 registry 能力声明。

### CE+CPCF · 控制面闭合证据与误放行治理（2026-07-18）

- **ClosureEvidenceGate / ControlPlaneContractFirstGate / ConfirmBindingGate / ReReviewRuntimeFirstGate / HomologousDeployFilterGate** 写入 cp-gate、dev-plan-review、audit-common；always-on 仅索引。
- **ConfirmBinding**：`memory_cp_confirm` 支持 artifactPath/version/sha256 并磁盘重算；Hook `readCpConfirmations` 校验 digest（legacy 无 sha 兼容）。
- **HomologousDeploy**：`skill-deploy-filter` 同源过滤 gray；作用于 CLI copy 与 `buildDeploymentDescriptors`。
- **V100** + `npm run test:closure-evidence`。
- 需求：`.devcodex/devcodex-v1/requirements/控制面闭合证据与误放行治理/`。
