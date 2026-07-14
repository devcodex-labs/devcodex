---
name: document-sync
description: 文档同步规范 — 代码变更后同步必查与条件文档
---
# Document Sync Skill

## 职责

在 dev/fix 工作流执行完成后，确保以下核心文档与代码变更保持同步：

| 文档 | 同步级别 | 同步内容 |
|------|:--------:|---------|
| `changelogs/unreleased.md` | 🔴 必查 | 用户未明确要求发版时的未发布实现变更记录 |
| `changelogs/README.md` | 🟡 条件 | changelog 目录结构或发布归档路径变化时同步说明 |
| `CHANGELOG.md` | 🟡 条件 | 仅正式发版时更新已发布版本索引 |
| `README.md` | 🔴 必查 | 安装/使用/API 说明与代码一致 |
| `05-实施进度.md` | 🟡 条件 | 多批次、预计 ≥10 文件、跨轮次、阻塞或用户要求持续跟踪的任务必须更新当前批次状态 |
| `.env.example` | 🟡 条件 | 用户 / 项目明确选择共享环境变量方案，或已有共享环境变量发生新增/修改/删除时同步更新示例文件；未指定 env 时不得主动把明文或硬编码改成 `.env.example`、`.env.local`、`.env.test.local`、`*Env`、secretRef 或 secret manager |
| `.devcodex/profile/README.md` / `01-项目信息.md` / `02-架构约束.md` / `03-代码风格.md` | 🟡 条件 | 命中 `ProfileImpactCheck` 时同步；包括技术栈、框架/SDK、依赖管理、目录/模块边界、脚本/测试/发布路线、分发面、配置项、长期连接、`config.local.json` schema 或当前阶段变化 |
| `RULES.md` | 🟡 条件 | 当入口路由、工作流说明、当前可用状态或使用方式变更时同步 |
| `website/docs/guide/*.md` | 🟡 条件 | 当面向使用者的流程指南、开发说明、发布说明变更时同步 |
| `website/docs/specs/*.md` | 🟡 条件 | 当永久规范页中的当前行为、流程图、规则说明变更时同步 |
| website sidebar/nav / README 索引 / 目录页 | 🟡 条件 | 当正文定义阅读顺序、审查顺序、实施顺序或“先看什么”时，同批校验导航、sidebar 与索引页是否按同一顺序呈现 |
| `DocsConsumerSweep` | 🟡 条件 | 文档新增/调整命令、配置项、字段、状态、路径、能力承诺、阅读顺序或用户路径时，扫描 README / website / Profile / prompts / templates / examples / nav/sidebar / validate probes / 部署副本与代码消费位置 |
| `website/docs/versions/v1/<active-version>/requirements/**` | 🟡 条件 | 当正式需求入口、模板职责边界或活动版本 requirement 口径变更时同步 |
| `TASK-INDEX.md` | 🟡 条件 | 项目存在任务索引时更新任务状态 |
| `STATUS.md` | 🟡 条件 | 项目存在状态看板时同步当前版本状态/功能完成度 |

## 触发时机

所有 dev/fix 工作流在执行阶段完成后**自动触发**文档同步检查。

## 执行流程

| 步骤 | 动作 |
|------|------|
| 1 | 读取本次变更内容（diff 或变更摘要），必要时先建立 Concept Sync Map |
| 2 | 区分当前消费者与历史镜像，确认本轮必须同步的当前文档与可保留的历史归档 |
| 3 | 逐一检查必查文档，并确认条件文档是否存在/启用 |
| 4 | 更新需要同步的文档 |
| 5 | 确认文档与代码一致（版本号/API/配置项） |

### 文档即产品仓库的附加检查

当仓库自身以 profile、规则页和文档站作为正式产品入口时，除通用必查项外，还应补查：

- profile 真相源：`.devcodex/profile/01-项目信息.md` / `02-架构约束.md`
- 入口说明：`RULES.md`
- 使用者指南：`website/docs/guide/*.md`
- 永久规范页：`website/docs/specs/*.md`
- 当前活跃版本 requirement：`website/docs/versions/v1/<active-version>/requirements/**`

### 当前消费者 vs 历史镜像

- 当前消费者：仍以“当前行为”口吻描述现状，或会被 validate / 部署副本 / 模板继续消费；本轮必须同步。
- 历史镜像：只保留基线、归档或历史阶段事实；只有明确标注历史性质时，才允许暂不改动。
- 控制面任务建议先调用 `source-consumer-sync`，把 Concept Sync Map 写清后再执行文档同步。

## 同步规则

**未明确发版时（默认）**：

```markdown
## YYYY-MM-DD
- **[主题]** 未发布变更摘要
```

- 每完成一个**已验证的语义变更批次**，默认更新 `changelogs/unreleased.md`
- 在完成上述记录后，默认建议执行**本地 `commit`** 作为回滚锚点，但不默认 `push`
- `commit` 不按“问题个数”切分，遵循 `01-common` 的语义批次提交边界

**正式发版时**：

1. 先将 `changelogs/unreleased.md` 中待发布条目归档到 `changelogs/releases/vX.Y.Z.md`
2. 再更新根 `CHANGELOG.md`

**CHANGELOG.md 格式**：
```markdown
## [版本号] - YYYY-MM-DD
### Added / Changed / Fixed / Breaking Changes
- 变更描述
```

**README.md 检查点**：
- 版本号标注
- 安装步骤（依赖版本）
- API 示例代码（与实现匹配）
- 配置项说明（完整且准确）
- 目标用户 / 使用者是否明确
- 快速开始与常见用法是否仍能形成最短成功路径
- 开发 / 贡献信息是否仍后置，没有抢占主叙事

**DevCodex 类仓库检查点**：
- 分发面说明是否仍与当前 `agents / instructions.md / hooks` 事实一致
- `token-check` 是否仍被描述为授权占位，而非当前 tier 门控
- `ENV_MODE` 是否仍按当前 `dev / prod` 规则说明，而不是 Draft
- 正式需求入口是否仍指向 `website/docs/versions/v1/<active-version>/requirements/`
- 支撑型 Skill（`execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync`）以及发布前审查 Skill（`audit-release`）的注册、触发说明、报告模板、validate 探针和用户文档是否一致
- `readme-authoring` / `audit-readme` 的注册、README prompt、README / Profile / website 当前消费者、validate 与 targeted tests 是否一致
- `UserPerspectiveDocsGate` 是否同步到 README、官网/文档站、接口说明、运行手册、dev-docs、audit-document、audit-readme 和报告模板；正式用户文档是否从使用者角度说明第一次成功、常见任务、字段/参数/状态/错误、失败恢复、限制和下一步，避免只按维护者内部实现顺序堆叠
- `UserDocsImmediateComprehensionGate` 与 `UserDocsPrimarySurfaceGate` 是否同步到 README、官网/文档站、quick start、nav/sidebar、索引页、配置/参考入口、dev-docs、audit-document、audit-readme 和报告模板；站点文档是否先冻结 `targetSurface` / `documentLocation` / `primaryAudience=用户/使用者`，首页首屏、前两组导航、CTA、reference、配置、常见任务和排错是否服务用户使用路径，开发契约是否后置
- `UserFacingDeliveryChainGate` / `FinalUserManualFirstGate` / `DocsSiteInformationArchitectureGate` / `UserManualFlowAndFailureGate` / `QueueDocsRealWorkflowGate` 是否同步到 dev-docs、readme-authoring、audit-document、audit-readme、TestRoute、报告模板、README/website 和 validate；需求概况后应优先产出用户最终使用文档，涉及前端/API 时再产出前后端契约，技术方案、实施计划和进度应对照需求与用户文档生成
- `user-manual-authoring` 是否作为站点文档、最终用户使用文档、README、quick start、接入手册和 docs-first 用户手册的优先写作入口同步到 dev-docs、readme-authoring、audit-user-manual、audit-readme、routing、TestRoute、报告模板、README/website、Profile、plugin.json 和 validate；`audit-user-manual` 是否作为用户侧文档 review、项目文档审查、文档设计、菜单导航、sidebar 和信息架构审查的聚合入口同步到同一消费者链
- `PublicUserDocsMaintainerBoundaryGate` 是否同步到 README、官网/文档站、配置/扩展/框架接入指南、CONTRIBUTING、release checklist 或 maintainer-only 文档；公开用户路径不得夹带维护者验收、发布 checklist、内部同步清单、台账状态或实现者复审任务
- `RequirementVerdictStateSyncGate` 是否在需求修订、再次复审、宣布“可确认 / 暂不通过”或回写真相源时同步 `01-需求确认.md` 顶部状态、推荐结论、修复清单、audit-state decision、sessions / SUMMARY，避免正文与状态口径漂移
- `DocsConsumerSweep` 是否执行：正文、导航/sidebar、README/索引、examples、templates、Profile、validate probes、部署副本和代码消费位置是否一致；信息架构故意不同序时报告是否解释差异
- `ChinesePrimaryExpressionGate` 是否执行：中文 README、中文站点文档、中文用户手册或双语中文入口是否以中文主干表达任务、配置、错误和流程；英文标识符、路径、命令和 API 名是否只作为精确补充
- `SidebarPageRoleMaterializationProbe` / `SidebarGroupSemanticModelProbe` 是否执行：新增公开能力、菜单缺项、sidebar 分组或 route 表变化时，是否从当前配置 / docs inventory / generated HTML 反查 page role、route、label、sidebar group、相邻页面职责和整组任务模型
- `ReviewChecklistCompletenessGate` / `EvidenceExecutionGate` 是否同步到 audit、TestRoute、报告模板和 validate；复审不得重复同一维度凑轮次，冻结 checklist 必须有逐项证据，不能只按审查报告文本验收，关键结论要做实际验证
- `review-checklist` 是否作为正式复审、ECR、发布前复审、多轮收敛、外部 finding 批次和冻结清单的独立 Skill 入口同步到 audit-common、audit-execution-guide、audit-release、TestRoute、报告模板、README/website、Profile、plugin.json 和 validate
- `BuiltArtifactFeatureSmokeGate` / `TscOutputImportProbe` 是否同步到 TestRoute、dev/fix/analyze、报告模板和 validate；涉及构建产物、模块格式、adapter 或运行时导出时，必须验证产物真实导入/执行和 TypeScript 输出可导入性，而不是只跑源码测试
- `GeneratedSiteGate` / `ManualTocDuplicationGate` / `UserPathContractSweep` 是否同步到 dev-docs、readme-authoring、audit-document、audit-readme、TestRoute、README/website 和 validate；文档站必须基于生成产物验证导航、TOC、资产、链接和主要用户路径
- `BenchmarkRegressionGuard` 是否同步到 TestRoute、dev/fix/analyze、报告模板和 validate；涉及性能基准、缓存、队列、连接池、高频路径或优化声明时，必须有基线、对照、阈值和回归判定
- 前端 UI / 交互体验规范是否同步到 `FrontendExperienceQualityGate`、`frontend-runtime` gateGroup、TestRoute、报告模板、README/website 与 validate；代表性 anchors 包括 `FigmaHighFidelityRestorationGate`、`ActualPreviewChainAndMockFallbackGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate`、`FrontendBrowserVerificationBudgetGate` 与 `UserSelfVerificationOverrideGate`；视觉或交互证据不得只停留在口头说明
- `CrossProjectLearnedGuards` 跨项目已吸纳守门是否同步到当前消费者：按 `GovernanceGateRegistry` 检查 `truth-evidence / docs-boundary / finding-review / frontend-runtime / user-manual-delivery / release-package-contract / requirement-profile-service / data-security-automation / site-v2-leak` 等 gateGroup；报告或模板只记录 `gateGroup / ownerSkill / validationRoute / skipReason`，legacy anchors 如 `CodeTruthRequirementGate`、`ManualReviewEvidenceRetention`、`ReviewFindingIntakeGate`、`UserDocsPrimarySurfaceGate`、`RequirementVerdictStateSyncGate`、`ActiveRequirementFinalResponseGate`、`MethodLevelLeakPressureProbe`、`V2FormalSolutionPackage`、`DatabaseRecordMigrationExportGate`、`FindingProbeMatrixGate`、`UserFacingDeliveryChainGate`、`ReviewChecklistCompletenessGate`、`BuiltArtifactFeatureSmokeGate`、`GeneratedSiteGate`、`UserPathContractSweep` 与 `BenchmarkRegressionGuard` 只作为 grep 锚点保留
- `spec-absorption` 是否同步到规范吸纳消费者：`CommonNormGeneralizationGate`、`AbsorptionCandidateConsumerProofGate`、候选矩阵、项目独有规则负向样例、targetOwner、TestRoute、report、prompts、README/website/changelog、Profile、validate/test 与部署副本必须形成同一 Concept Sync Map；不得只在 `spec-governance` 或通用 instructions 中保留概念描述。
- `LayeredAbsorptionGate`、`SkillFirstAbsorptionGate` / `CapabilityToSkillPromotionGate` 是否同步到 spec-governance、dev-default、TestRoute、报告模板、README/website/changelog、validate、targeted tests、prompts/templates、执行消费者和部署副本；新增可泛化规范不得只进入 `CrossProjectLearnedGuards` 或 `LatestAbsorptionGuards`，必须有 `LayeredAbsorptionDecision`（兼容 `SkillAbsorptionDecision`）和逐层 `layerChecks`
- `ProfileTruthReconciliationGate`、`AuthorizedLocalSecurityAuditPresentationGate`、`PublisherCredentialTopologyGate` 是否分别保持 `load-profile`、`security-threat-modeling`、`release-verification` 唯一 owner，并同步 analyze/audit/release 消费者、report prompts、V88~V90、README/website、Profile、changelog 与部署副本；不得把详细正文复制回 instructions/prompt，也不得在文档或报告中出现 secret value 或绕过平台控制的承诺
- `ScopedRegistryResolutionGate` 是否保持 `release-verification` 唯一 owner，并同步 `audit-release`、TestRoute、report、release prompts、V92、README/website、发布 Profile、release note 与部署副本；scoped package 的双 registry 文档和命令必须同时写明 scope override 或隔离 userconfig，禁止只记录全局 `--registry`
- `ChecklistStateMaterializationGate` 是否保持 `review-checklist` 唯一 owner，并同步 TestRoute、report、spec-governance、review prompts、V94、README/website、release note 与部署副本；六区块 snapshot 任一 stale 时，文档和报告都不得保留 clean/closed 声明
- A1~A10 最新吸纳执行包是否同步到当前消费者：`ConfigCanonicalNamespaceGate`、`ProfileRuntimeContractSyncGate`、`BehaviorSemanticDocsParityGate`、`NegativeTranslationParityProbe`、`DocsExampleTruthSurfaceGate`、`CallbackExampleScopeProbe`、`DerivedMetricConsumerProbe`、`DerivedConsumerFailureInjectionProbe`、`FeatureInventoryProfileGate`、`FeatureChecklistEvidenceMatrixGate`、`BatchEvidenceLedgerStateGate` 与 `BatchProgressCardGate` 必须形成 Concept Sync Map，覆盖 Skills、Prompt、TestRoute、report、README/website/changelog、Profile、validate/test、部署副本和来源台账回写。
- `HistoricalCommonNormLayeringGate` 是否同步到 spec-governance、TestRoute、report、technical-design / implementation-plan / report prompts、README、website guide、active version requirements、changelog、Profile 与部署副本；历史通用规范、prompt/report 长清单或旧吸纳项迁移前必须有逐文件审查矩阵，无法立即下沉的历史规则标 `legacy-index-retained`，不得继续把新 Gate 长正文追加回通用 instructions
- `ProactiveBetterAlternativeGate` 是否同步到 C12、dev-default、spec-governance、TestRoute、报告模板、技术方案 / 实施计划 prompt、README/website/changelog 和 validate；用户给出建议或确认方案时，文档和报告必须保留主动比较更优路径的证据
- `ConfirmedAbsorptionCompletenessGates` 是否同步到通用规范、目标 Skill、Prompt、TestRoute、report、document-sync、validate、README/website/changelog 和部署副本；必须按 `public-surface / user-manual / review-checklist / frontend-runtime / profile-service / release-parity / evolution-control-plane` 分组核对，代表性 anchors 包括 `PublicSurfaceClosureGate`、`UserManualProductizationGate`、`ReviewAnchorMaterializationGate`、`SemanticLegacyRouteExposureGate`、`ReferenceCodeTruthSamplingGate`、`FrontendAsyncCacheRenderGate`、`StaleWhileRevalidateGate`、`RemoteCIParityPushGate`、`NativeCommandExitCodeGate`、`OfficialApiEvidenceGate`、`EvolutionCapabilityControlPlaneGate`、`FrameworkCapabilityAutoFirstGate` 与 `DocsThemeRuntimeVisualProbeGate`；不能因概念已有描述就跳过 Gate 名、触发条件、报告字段或探针
- `WorkspaceDataAbsorptionScopeGate` 是否同步到 spec-governance、dev-default、TestRoute、报告模板、README/website 和 validate；data 吸纳任务不得只校验当前项目台账。
- V95 新增吸纳能力是否按 owner 与消费者闭环同步：`AgentCapabilityDomainCompletenessGate` 由 `ai-agent-system-architecture` 承接，`DocsAudienceRoleAndRenderedSequenceProbe` 由 `audit-user-manual` 承接，`consumer-validation-engineering` 承接跨仓消费者置信度，`ModulePerformanceCoverageAndMaintenanceGate` 由 `performance-engineering` 承接；同时核对 Prompt、TestRoute、report、release-verification、quality-strategy、README/website/changelog、Profile、plugin/portfolio、validate/test 与部署副本，不得只在 owner Skill 内出现。
- 涉及外部消费者或跨仓验证时，文档同步记录必须区分本仓事实与外部仓证据，并绑定 `repository / ref / commitSha / artifact / digest / runId`；缺少当前、可复验的外部证据时只能降级发布置信度，不能把“未观测到失败”写成兼容性已通过。
- `FlowchartNodeExplanationGate` 与 `DocsSiteVisualAcceptanceGate` 是否同步到 dev-docs、audit-document、website specs/sidebar、需求页和 visual/manual evidence；正式流程图不能只有 Mermaid 图。
- 多语言、翻译页或正式用户文档变更是否执行 `DocumentationTranslationParityGuard` 与 `FormalDocsDevCodexBoundary`，避免 README/website/Profile/changelog 之间语义漂移或把运行时台账口吻混进正式文档
- 控制面任务是否已建立 Concept Sync Map，并把当前消费者、历史镜像、validate 探针、部署副本与黄色偏离边界说明清楚
- 文档正文若定义阅读顺序、审查顺序、实施顺序或“先看什么”，Concept Sync Map 必须列出“正文顺序 → 导航/sidebar 顺序 → README/索引顺序”；若信息架构故意不同，报告必须解释差异而不是让用户猜
- 宿主契约相关变更是否补了 HostContractRoute 证据，而不是只改文档叙述
- 多批次任务的 `05-实施进度.md` 是否随批次完成更新

### ProfileImpactCheck

dev/fix 执行完成后必须显式判定 `ProfileImpactCheck`：

| 触发项 | 同步目标 | 证据 |
|--------|----------|------|
| 技术栈、框架、SDK、依赖管理器变化 | `01-项目信息.md` 技术栈 / 依赖 / 验证路线 | diff + report |
| 目录结构、模块边界、分发面、宿主能力变化 | `02-架构约束.md` 目录 / 模块职责 / 分发边界 | diff + ConceptSyncMap |
| 代码风格、脚本、测试、构建、发布命令变化 | `03-代码风格.md` 或 `01-项目信息.md` | package/script diff + TestRoute |
| 共享配置、环境变量、长期连接、`config.local.json` schema 或 `extensions.<namespace>` 变化 | Profile README / `01-项目信息.md` / config 说明 | config diff + S02 用户 / 项目策略检查 |
| 当前阶段、活跃版本、任务现实、发布状态变化 | `01-项目信息.md` 当前开发重点 | release / task report |

- 若无需同步，报告必须写 `ProfileImpactCheck: N/A` 与 `skipReason`，例如“仅修正文案 typo，不影响技术栈/目录/配置/验证路线”。
- Profile Freshness Check 是 audit 的事后审查；不能替代 dev/fix 中的 `ProfileImpactCheck` 主动判定。

## 豁免

- `dev-docs` 子类型（文档本身就是产物，不触发文档同步）
- `analyze` / `audit` 工作流（只读，不触发）
- `chat` 意图（豁免所有后置处理）
