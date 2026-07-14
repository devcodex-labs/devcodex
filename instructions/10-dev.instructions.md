---
applyTo: "**"
description: dev 工作流规则，覆盖子类型路由、CP 流程、计划复审、执行期回退与 ECR
priority: P4
version: 1.14.0
---
# 开发工作流规则（10-dev）

> 本文件定义 dev 工作流的完整规则，含 8 个子类型和 CP 门控。

> 子类型标识：`dev.default` / `dev.docs` / `dev.refactor` / `dev.database` / `dev.init` / `dev.optimization` / `dev.scenario-test` / `dev.plan-review`

## 子类型路由

| 意图 | 子类型 |
|------|--------|
| 重构/refactor/结构变更 | refactor |
| 数据库/db/migration/Schema | database |
| 初始化/init/新项目 | init |
| 性能/optimize/优化指标 | optimization |
| 测试/scenario-test/压测 | scenario-test |
| 文档/docs/README/注释 | docs |
| 方案评审/plan-review/review | plan-review |
| 默认（新功能/需求）| default |

- optimization/scenario-test 前置条件：`api-verification` 已通过，否则阻断并提示

## C12 合理性评估（必须执行）

- 执行 `ProactiveBetterAlternativeGate`：有更低风险、更完整、更易维护或更符合项目现实的方案 → 提出取舍并等待确认后再执行
- 明显不合理 → 先指出问题再等用户澄清
- 用户给出判断或引用已有设计 → AI 须独立验证合理性，不得直接顺从论证
- 若用户给出的目录结构、实施顺序或方案本身经验证已是当前最优，可明确说明依据后直接采纳；禁止为了表现“独立思考”而机械反对
- 架构边界检查：逐项确认每条需求是否依赖项目当前已实现的能力；若某项需求的前提能力（上游功能/平台特性）尚未存在，须在 CP1 前主动标注为"预留候选"并建议移出本期范围，等待用户确认后再决定取舍
- 不得在 C12 前直接开始编码

## 任务切换与提交护栏

- 在 dev 会话中，若用户请求与当前已推进的需求明显不一致，应先按 `01-common` 的“意图优先、关键词兜底”顺序判断是否属于新需求切换。
- 仅当判断为新需求切换，且工作区存在未提交变更时，才提醒用户是否先提交当前变更；不得把同一需求的连续迭代误判为必须中断。
- 用户明确要求提交时，commit subject 必须是一句简洁描述，只保留本次主变更，不得把整段会话摘要直接作为提交标题。
- `unreleased` / `commit` 主协议遵循 `01-common`：每完成一个**已验证的语义变更批次**默认更新 `changelogs/unreleased.md`；`ExplicitCommitAuthorizationGate` 要求本地 `commit` 只有用户明确要求时才执行，其他情况仅建议作为回滚锚点；`push` / `tag` / `publish` 仍须用户明确确认。

## CP 门控（C02 约束，严格按序）

```text
CP1（需求确认）→ PR-1 内部自检 → CP2（方案确认）→ plan-review（PR-2~PR-7）→ [impact-review] → CP3（实施计划）→ [execution-contract/test-router] → 执行 → ECR 执行闭环复审 → 完成
```

### CP 定义

| CP | 名称 | 必须？ | 目的 |
|:--:|------|:------:|------|
| CP1 | 需求确认 | 🔴 必须 | 确认 AI 理解与用户一致 |
| CP2 | 方案确认 | 🔴 必须 | 确认技术方案可行后再编码 |
| CP3 | 实施计划确认 | 条件触发 | 确认任务拆分、顺序、依赖、验证和回滚后再开始逐文件执行；docs/init/plan-review 按子类型规则豁免并记录 N/A |

### CP 关注点边界

- **CP1**：先判定入口类型，区分纯新需求、产品完整需求、需求变更和 Bug 问题；纯新需求先保留 `00-需求概况.md`，再由 AI 生成产品需求草稿，产品补充归一化后完成需求方 + 产品双方确认；若公司已有产品角色且产品直接提供完整需求，使用 `01-产品需求.md` 作为产品事实源，产品模板正文只承载产品完整 PRD，AI / 研发只做缺口检查并记录在 CP1 摘要、`02-技术方案.md` 或报告中，不生成或重写产品需求；需求变更先保留 `00-需求变更概况.md`，再生成 `01-需求变更确认.md` 并回写目标需求真相源；Bug 问题转入 fix 工作流，不用产品需求模板承接。CP1 重点确认需求目标、用户交互、业务流程、业务结果与范围边界，并前置平台工程判断：消费者范围、共享契约边界、模块职责、维护成本和非目标；不提前展开实现时序、内部节点设计或接口细节，也不得把“通用性/模块化”扩写成无真实消费者的空心抽象。
- **CP2**：重点确认实现流程、节点职责、公共契约、兼容性策略、边界问题与测试策略；已有公共接口、Schema、返回结构或错误码变更时，必须给出“现状契约 → 目标契约”差异说明；新增/升级依赖、框架、SDK、平台 API 或外部模块时必须附 `OfficialDocsEvidence`；涉及项目事实变化时必须附 `ProfileImpactCheck`。
- **CP3**：只确认实施顺序、里程碑、验证方式、风险与回滚；不得重复需求正文、方案论证或兼容性主说明。

### CP 执行规则

1. **严格按序**：CP1 → CP2 → CP3，不得跳过中间步骤
2. **禁止合并**：不得将 CP1+CP2 合并为一次输出
3. **每个 CP 独立确认**：输出后必须等待用户明确响应
4. **CP3 内容边界**：CP3 只确认实施计划，不重复技术方案中的架构决策、接口论证和兼容性主说明；必须显式覆盖任务拆分、顺序、依赖、验证方式与回滚策略
5. **产物文件前置创建**：默认 CP1 必须先做入口类型分类；纯新需求 → `00-需求概况.md` + `01-需求确认.md` + `<需求>/.memory/sessions.md`；产品完整需求 → `01-产品需求.md` + `<需求>/.memory/sessions.md`，产品模板正文只给产品填写完整 PRD，AI / 研发缺口检查记录在 CP1 摘要、`02-技术方案.md` 或报告中；需求变更 → `00-需求变更概况.md` + `01-需求变更确认.md` + 回写目标 `01-需求确认.md` / `01-产品需求.md` / 正式需求文件 / website requirement；Bug 问题 → 切换 fix 工作流，使用 `bugs/<问题>/00-问题概况.md` 和问题确认产物。历史 `01-需求概述.md` 仅作兼容；CP2 → `02-技术方案.md`（有架构/接口/设计决策时，否则跳过）；CP3 → `04-实施计划.md`。若命中 `SimpleTaskFastPath`，可用回复内联 CP1 摘要 + 报告/记忆替代需求目录，并将未触发的 00/01/04 产物记为 `N/A + skipReason`；但命中 ExistingRequirementArtifactOverride 时必须先更新已有需求真相源。
6. **ArtifactDecisionMatrix / ArtifactLifecycleState**：CP1/CP2/CP3/ECR 必须按任务规模列出关键产物 `create` / `update` / `skip` / `N/A` 状态，至少覆盖入口类型、`00-需求概况.md`、`00-需求变更概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、`02-技术方案.md`、`04-实施计划.md`、`05-实施进度.md`、`06-关键决策.md`、目标文档、报告、记忆；每项写明 `reason`、`trigger`、`upgradeTrigger`、`targetArtifact`。判定优先级：已有真相源回写 > 任务触发条件 > SimpleTaskFastPath > 子类型豁免。
7. **进度文档触发**：`05-实施进度.md` 不是小任务默认必产物；但当任务跨 2 轮以上会话、存在明确阻塞、用户要求持续跟踪、CP3 计划拆分为多批次、预计修改 ≥10 文件或命中控制面/模板/validate/部署副本联动时，必须在执行前创建并在每批完成后更新。默认前提是已存在 `04-实施计划.md`；docs/init 等 CP3 豁免场景可使用已确认文档大纲、任务切片或 ContextHandoffCard 作为等价计划锚点。
8. **无 Hooks 宿主软门禁**（v1.9.6+）：当运行宿主为 `jetbrains-copilot`、`cursor` 或其他 `instruction-fallback` 客户端时，`lifecycle.cjs` CP gate 不可执行。AI 必须在每个 CP 输出末尾显式追加 `⏸ 等待用户确认（CP{N}）— 收到"好/继续/ok"前不得进入下一阶段或写源码`，并在用户未明确回复前禁止 source mutation 工具调用。
9. **CP3 豁免记录**：docs/init/plan-review 子类型被规则明确豁免 CP3 时，须在需求级记忆或报告中记录 `CP3: N/A（<子类型> 子类型豁免）`，供 hook/fallback 区分合法豁免与漏确认。
10. **确认后前置轻量复审**（C19）：每次用户明确确认 CP1 / CP2 / CP3 后、进入下一阶段前，必须先对当前已确认产物做 1 轮轻量前置复审并显式输出结果；控制面 / 多文件联动 / 真相源同步 / 模板-示例-校验链场景必须追加交叉验证；发现阻断性问题则先修正当前产物、告知用户并重新确认，无阻断问题方可推进。
11. **Intent Expansion 可见性**：dev 模式下，CP1 / 需求确认前默认向用户展示完整 Intent Expansion Card；这会覆盖旧的“意图扩展摘要”默认行为，但当命中控制面或宿主能力差异、跨会话 resume、prod、instruction-fallback 宿主或低风险轻任务时，仍允许退化为 3~5 行意图扩展摘要。
12. **执行期 CP3 回退**：若 N5 执行过程中实际变更范围扩展到 CP3 门槛（如文件数从 <5 增至 ≥5、临时引入高风险操作、命中控制面/模板/validate/部署副本联动），必须暂停执行，回到 N4 / CP3 补做实施计划确认后再继续。
13. **backlog 来源前置真相复核**：若本轮需求、批次或范围直接来源于 `data/*.md` 的 open/partial 项，CP1 前必须先把候选项分类为 `pure-open` / `residual-tail` / `already-fixed` / `misclassified`；非 `pure-open` 项须先回写状态并修正范围口径，禁止直接按旧 open 计数开做。
14. **OfficialDocsEvidence**：新增/升级依赖、框架、SDK、平台 API 或外部模块时，CP2 前必须读取官方使用文档/官方参考资料；CP2 记录文档来源、版本/日期、关键用法、限制和兼容性，缺失证据不得进入 PR-2 通过态。
15. **ProfileImpactCheck**：项目技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema 变化时，CP2/CP3 必须判定并同步 Profile；不需要同步时写明 `skipReason`。
16. **连接配置来源按用户 / 项目策略**：凡 CP2/CP3 涉及脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息，默认可直写或沿用项目既有模式；只有用户或项目明确指定 `config.local.json`、env、`secretRef` 或 secret manager 时，方案才按该入口读取并在缺失时提醒补齐。
17. **AI 自启动服务清理**：若开发验证需要由 AI 启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，CP3/TestRoute 必须记录启动命令、cwd、PID/job、端口/URL；验证完成、失败或最终回复前必须停止仅由 AI 本轮启动的服务并核验端口释放。用户明确要求保留服务时，报告保留原因、PID/端口和关闭方式；不得杀用户既有进程。
18. **LeakRiskStabilityPressureTest**：写测试用例或规划回归验证时，CP2/CP3/TestRoute 必须按项目情况判定是否需要泄漏风险稳定性压测；涉及长运行服务、高并发路径、缓存/队列/连接池、监听器/定时器、连接/文件/流/socket/worker、订阅、前端组件生命周期或 `PE-12` 发现时，必须纳入场景/负载/稳定性验证；未触发时写 `N/A + skipReason`。
   - **CoverageGateDecision / ExternalRuntimePluginLifecycleGate**：项目存在 coverage 脚本、阈值、CI coverage 或发布覆盖率要求时，CP2/CP3/TestRoute 必须单独判定 coverage gate；外部 runtime、plugin、registry、adapter、provider、injected runtime、owner mutation 或 function source/hash/toString/fingerprint 参与 key/checkpoint/去重时，TestRoute 必须触发 `ExternalRegistryLifecycleMatrixGate`、`FunctionSourceFingerprintMatrixGate`，同风险簇连续返修时触发 `ClusterEscalationGate` 与 `RiskBasedValidationLadder`。
19. **FrontendExperienceQualityGate**：前端页面、组件、控制台、官网、文档站、可视化工具或游戏任务，CP1/CP2/TestRoute 必须判定 UI / 交互体验门禁；命中时覆盖设计来源、还原度、风格主题、响应式状态、视觉验证、用户流、交互反馈、输入方式/可访问性、错误恢复和动效转场；Figma/截图/既有页面还原追加 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate`、`VisualDeviationTypeGate` 与 `DesignFramePurposeClassificationGate`；浏览器验证先执行 `FrontendBrowserVerificationBudgetGate`，用户明确自验或禁止浏览器/截图时执行 `UserSelfVerificationOverrideGate`；纯后端、纯 CLI、纯文档或无界面任务写 `N/A + skipReason`。
20. **UserPerspectiveDocsGate / UserDocsImmediateComprehensionGate / UserDocsPrimarySurfaceGate / PublicUserDocsMaintainerBoundaryGate / DocsConsumerSweep**：文档开发、README、官网/文档站、接口说明、运行手册、需求/方案或用户可读验证产物必须从使用者角度组织，覆盖第一次成功、常见任务、字段/参数/状态/错误解释、失败恢复、限制与下一步；README、站点文档、文档站、quick start 或接入手册必须先冻结 `targetSurface`、`documentLocation` 与 `primaryAudience=用户/使用者`，抽查首页首屏、quick start、nav/sidebar 前两组、CTA、reference 入口、配置、常见任务和排错，确认主路径不是开发契约/目标设计/维护者验收；用户文档审查需输出功能完整性、配置易懂性和即时理解三轴结论；公开用户文档不得混入维护者验收、发布 checklist、内部同步清单或台账状态；文档新增/调整命令、配置项、字段、状态、路径、能力承诺或阅读顺序时，同步扫描当前消费者和代码消费点。
21. **RequirementPreConfirmGate / RequirementVerdictStateSyncGate / MultiPhaseClosureGate**：docs/需求类任务推荐确认 `01-需求确认.md` / `01-产品需求.md` 前，必须检查验收是否行为可验证、范围/非目标是否存在核心语义冲突、分布式或调度类高风险路径是否具备 fail-safe 语义；需求修订、再次复审或宣布“可确认 / 暂不通过”前，必须同步需求真相源顶部状态、推荐结论、修复清单、audit-state decision、sessions / SUMMARY 口径；分阶段需求还须列出 Phase 2+ 到最终关闭的入口/退出门禁、验证证据、用户确认点和实施进度真相源。
22. **新增吸纳守门补充**：数据库记录跨环境迁移执行 `DatabaseRecordMigrationExportGate`；guard/policy/permission 修复执行 `GuardPolicyBypassMatrixGate`；审查 must-fix 执行 `FindingProbeMatrixGate`；带副作用旧路径文档执行 `SideEffectCompatibilityDocsGate`；公开语法/配置示例执行 `ExecutableExampleTruthProbeGate`；一次性需求脚本执行 `OneOffRequirementScriptPlacementGate`；验证命令执行前执行 `VerificationCommandSideEffectGate`；package/adapter/SDK/CLI 方案确认前执行 `PackageAdapterPreConfirmEvidenceGate`；未触发项写 `N/A + skipReason`。
23. **ConfirmedAbsorptionCompletenessGates / HistoricalCommonNormLayeringGate**：用户确认“未完整吸纳 / 半覆盖 / 仍需吸纳”或要求迁移历史通用规范时，dev 流程只做触发、范围和证据消费，不承载完整长清单正文；必须先读取 `spec-absorption`，输出 `CommonNormGeneralizationGate`、`AbsorptionCandidateConsumerProofGate`、`LayeredAbsorptionDecision` 和逐文件审查矩阵，补齐目标 Skill、Prompt、执行消费者、探针、公开文档和部署副本。至少关注 `PublicSurfaceClosureGate`、`UserManualProductizationGate`、`FrontendAsyncCacheRenderGate`、`StaleWhileRevalidateGate`、`RemoteCIParityPushGate`、`EvolutionCapabilityControlPlaneGate` 与 `DocsThemeRuntimeVisualProbeGate` 的归属；`EvolutionCapabilityControlPlaneGate` 必须进入 `evolution-governance`，发布相关项进入 `release-verification` / `audit-release`。

### SimpleTaskFastPath（简单任务轻路径）

当 dev 任务同时满足以下条件时，可直接执行最小实现，不创建需求目录、`00-需求概况.md`、`00-需求变更概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md` 或 `04-实施计划.md`：

- 用户目标明确，业务结果或产品事实源可在一句话内表达。
- 预计修改 ≤2 个源码/文档文件，且不涉及公共 API、公开类型、Schema、依赖、配置、发布、控制面、模板/validate/部署副本或跨服务边界。
- 本轮不是从 `data/*.md` open/partial 台账派生，不需要 Backlog Intake 批次治理。
- 不含 S01/S06 高风险操作，不需要多轮跟踪、压测、长运行服务或正式需求归档。

轻路径约束：

- 仍必须执行 PC0~PC7、Profile/记忆/报告、安全底线、必要测试和 ECR；CP1/CP2 以回复内联摘要或报告字段承载，报告写明 `SimpleTaskFastPath: applied`、`skipReason` 与验证证据。
- **ExistingRequirementArtifactOverride**：若用户是在调整/修改/补充/变更既有需求，或当前任务已存在 `00-需求变更概况.md`、`01-需求变更确认.md`、`00-需求概况.md`、`01-需求确认.md`、`01-产品需求.md`、历史 `01-需求概述.md`、Profile 声明的正式需求文件、website requirement 或其他已确认需求真相源，轻路径只允许不新建完整目录，不允许跳过已有文件回写；必须先增量编辑该文件并在回复中说明更新位置。找不到目标文件时，先按 Profile、当前需求目录、sessions、tasks 和用户提及路径定位；仍无法定位才最小澄清，禁止只输出新需求口径。
- 一旦执行中新增第 3 个文件、命中公共契约/配置/控制面/台账来源/高风险，立即升级回完整 CP/产物链，补建对应需求产物后再继续。

### 目标文档前置（条件触发）

当需求属于“契约驱动型需求”时，CP1 确认后、CP2 技术方案前，必须先冻结目标文档，再让后续方案与实施围绕该文档落地。

**契约驱动型需求触发条件**（满足任一即可）：

1. 最终交付成功与否主要由对外 API / 页面交互 / 组件契约决定
2. 文档本身就是前端、外部调用方或协作方的实现锚点
3. 若不先冻结文档，后续实现容易产生明显契约漂移

**目标文档类型**：

| 类型 | 适用场景 | 推荐产物 |
|------|---------|---------|
| 轻量 API 文档 | 普通接口说明、调用方文档 | `light-api` 模式文档 |
| 前端接口文档 | 前端联调、页面/模块接口说明 | `frontend-api` 模式文档 |

**执行规则**：

1. 仅对契约驱动型需求启用，不得推广到所有 dev 任务
2. 目标文档属于 CP2 输入的一部分，不替代 `02-技术方案.md`
3. CP2 技术方案必须显式说明如何以目标文档为最终契约锚点，并至少写清：目标文档路径、文档模式（`light-api` / `frontend-api`）与本方案引用的契约范围
4. CP3 与执行阶段的任务拆分、验证方式、回滚路径必须能追溯到目标文档

### UserFacingDeliveryChainGate（用户文档驱动交付链）

当 dev 任务来自纯新需求、需求变更、docs-first SDK/CLI/adapter、用户文档站、公开能力页或用户明确“先写最终使用文档再开发”时，CP1 / CP2 / TestRoute 必须判定 `UserFacingDeliveryChainGate`：

1. `00-需求概况.md` 或整理后的需求概况只作为待确认草稿，不能替代 `01-需求确认.md` / `01-产品需求.md`。
2. 确认事实源后先判定 `documentationSurface=docs-site | README-minimum | N/A`；有用户可见使用面时，优先生成用户最终使用文档，注意不是开发文档。
3. 涉及前端、API、SDK、外部调用方或跨团队联调时，再生成前后端 / API / 外部调用契约文档。
4. `02-技术方案.md` 必须显式引用已确认需求、用户最终使用文档和条件契约文档；复杂项目可补 `03-实施方案.md` 承载阶段策略、迁移、批次、风险和回滚，`04-实施计划.md` 只承载可执行任务。
5. ECR 必须输出需求对照、用户使用文档符合性审查，必要时追加契约符合性；低风险内部任务写 `N/A + skipReason`。

### Markdown 文档可读性要求

当 dev 工作流产出或更新以下 Markdown 文档时，必须补 `## 目录导航`：

1. `00-需求概况.md` / `00-需求变更概况.md` / `01-需求确认.md` / `01-产品需求.md` / `01-需求变更确认.md`（按入口类型触发；历史目录可用 `01-需求概述.md`）
2. `02-技术方案.md`
3. `04-实施计划.md`
4. `05-实施进度.md`（若存在）
5. `README.md`
6. `light-api` / `frontend-api` / `general-doc` 等阅读型文档

不适用对象：

1. `.http`
2. `.cjs`
3. 其他执行型验证脚本

### 统一联查矩阵（dev 最小动作）

- `dev` 默认按 **L1 最小联查** 执行：当前文件 + 直接引用/直接真相源
- 高联动场景默认升为 L2 标准联查
- 命中以下任一高联动场景时，默认升为 **L2 标准联查**：
  - 控制面规则变更（`instructions / skills / prompts / hooks / validate.js`）
  - 模板变更
  - 接口契约 / 验证产物变更
  - 工作区真相源 / 部署副本 / 分发链变更
  - 发布 / 版本 / changelog / profile 口径变更
- 若同时涉及多真相源同步、模板-示例-校验链或部署副本，必须升级为 **L3 强联查**，并按 C19 追加交叉验证
- `document-sync`、`impact-review`、`api-verification` 继续作为联查子动作使用，不替代统一联查矩阵
- `execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync` 作为支撑型 Skill：分别提供执行契约、验证路线、发布验证链、宿主契约证据与真相源-消费者同步边界，不替代 CP、dev/fix 主流程或安全底线；发版前风险审查使用 `audit-release`，不替代 `release-verification`

### 代码实现复杂度与注释守门

- CP1 需求必须给出 `ImplementationComplexityLevel`（兼容旧字段 `ImplementationComplexityPreference`）：`简单够用`（默认，需求不详细或简单方案可满足已确认产品事实源和业务目标）、`中等`（已有明确复用 / 演进边界，但不做企业级预设）、`企业级`（仅用户明确选择，或已有公共契约、多消费者、高风险长期演进且经确认）。用户未提出复杂化、需求未说明或简单方案可满足已确认产品事实源和业务目标时，默认选择 `简单够用`。
- 若 AI 认为需要从 `简单够用` 升级到 `中等` / `企业级`，必须在 CP1 或 CP2 列出 2~3 个方案、开发周期、难度、维护成本、非目标与取舍，等待用户确认后再升级；不得为了“完美”“企业级”“通用性”自行加复杂度。
- CP2 技术方案必须继承 CP1 的 `ImplementationComplexityLevel` 并给出 `§2.7 最小实现与注释策略`；非纯文案或单文件小修时，至少写明复杂度预算、抽象准入、防御分支边界和必要注释触发点。
- 实施默认采用满足双方确认后的产品事实源和派生技术验证项的最小实现，优先局部补丁和既有本地模式；禁止为“企业级”“可扩展”预设新增无真实消费者的 service / factory / adapter / manager、策略注册表、通用配置或预留扩展点。
- 新增抽象只在真实消费者、既有本地模式、边界隔离或已确认契约需要时允许；防御性分支只覆盖已确认输入、兼容、安全或错误契约。
- 必要注释必须覆盖非显然业务规则、状态转换、不变量、兼容约束、安全边界、外部契约映射和反直觉权衡，注释解释“为什么”和“守住什么约束”。
- JavaScript / Node.js 代码中命中必要注释的导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明必须使用标准 JSDoc；普通行注释只允许用于局部短说明，不能替代 JSDoc 契约。
- 禁止逐行解释、重复变量/函数名含义、保留临时 TODO 或把调试说明当业务注释；可自解释代码且不命中必要注释触发点时，可记录 `注释策略: N/A + skipReason`。
- 执行中若发现需要超出复杂度预算、新增未计划抽象或加入未计划防御分支，必须暂停 source mutation，回到 CP2 / CP3 更新方案后再继续。

### 通用工程吸纳守门

- **Node 基线**：Node.js 项目的 `engines.node`、CI matrix、Profile 与 README 运行时说明默认不得低于 `>=18`；需要支持更低版本时，CP2 必须列出业务理由、风险和独立验证证据。
- **包工程层**：包 / 库 / adapter / CLI 方案除代码实现层外，还必须检查 public API、public types、internal 工具、shared tests、benchmark、docs、scripts、dist/coverage 边界、package metadata 与 `changelogs/unreleased.md`。
- **包边界验证串行化**：按 `ConcurrencyPolicy`，只读准备和隔离验证可并行，但 `npm pack --dry-run`、package boundary check、files/exports/bin 检查不得与任何会删除、重建或写入 `dist` 的 build / benchmark / codegen 命令并行；必须在构建稳定后单独执行并以单独结果作为报告证据。
- **BuiltArtifactFeatureSmokeGate / TscOutputImportProbe**：runtime、adapter、SDK、CLI、module-format、exports/bin/files、`createRequire`、`import.meta` 或 conditional loading 变化后，必须在 dist CJS、dist ESM、`.generated` / tsc 输出或项目等价构建产物上跑真实 import / feature path；不能只凭源码测试、root export 或 pack 文件列表证明消费者可用。
- **BenchmarkRegressionGuard**：性能敏感项目或已有 benchmark 基线的 runtime / validator / parser / cache / adapter 热路径变更，必须判定是否执行代表性 benchmark regression；超过阈值时阻断发布或进入用户确认的性能 / 正确性取舍。
- **消费者依赖树优先探针**：跨仓库或外部消费者验证失败且症状指向依赖、插件、共享库或框架适配时，源码修改前必须先核对 `package.json`、lockfile、`node_modules` 与 `npm ls <关键依赖>`；确认依赖树一致后才进入源码补丁。
- **接入状态口径拆分**：需求、报告和复盘描述“已接入 / 未接入”状态时，必须区分底座能力、当前消费者和高级能力尾项；基础底座已消费但 Redis / MultiLevel / Distributed 等高级能力未接入时，不得写成整体未接入。
- **TypeScript 契约迁移**：TS 重构或迁移按公开契约与消费面逐步完善类型，不机械复制旧版本缺陷；跨模块业务契约、公开类型与配置类型优先集中到 types 契约层，本地私有 interface 可保留但须说明理由。
- **Provider / connector**：三方 provider、connector、SDK 接入类 CP2 必须先区分业务功能接口与底层 provider adapter；面向前端或业务调用方时优先冻结业务功能契约，provider/model/operation 作为内部实现或配置维度。随后冻结字段级合同：provider metadata、内部 payload、上游 request 映射、标准化 result、错误 detail；首个 provider 只能验证统一 operation contract，不能反向定义公共命名和层次。
- **TechnicalRouteComparativeGate**：技术路线、架构优化、性能优化、框架能力设计或高维护成本方案在 CP1 最终需求确认前，若存在同类产品 / 项目 / 框架 / 本仓库相似模块可比，必须执行 `ComparativeResearchGate`，记录证据范围（`repo-local` / `same-type-project` / `official/current-docs`）与采纳/不采纳理由；不触发时写 `N/A + skipReason`。
- **ExistingDomainContractAudit**：新增字段、配置、多语言 / 本地化容器、状态枚举、返回结构或平行数据结构前，CP2 必须检索既有模型、类型、validator、service、controller、脚本、历史数据样本和消费者接口；优先复用既有领域真相源，新增平行字段 / 容器 / 回退读取必须说明原因、迁移边界并经用户确认。
- **ConfigOwnershipMatrix**：新增或修改业务策略常量、provider 选项、阈值、开关或运行参数时，CP2 必须逐项标明落点属于 `DB feature config` / `provider runtime` / `服务运行配置` / `代码契约`；可由运营或业务调整的策略不得默认硬编码为发布改代码，除非用户明确接受。
- **DataMutationPlan**：数据补齐、迁移或跨环境写入脚本必须从已确认的显式清单、需求目录数据源或稳定业务键派生范围；宽泛查询只能用于背景排查，不能保留为写入口。跨环境写入时，source `_id` 只作审计字段，目标环境必须用稳定业务键或显式清单重新唯一匹配，dry-run 输出 `source_id`、`target_id`、缺失/重复清单；不能唯一匹配时阻断写库。
- **ApiDocVerificationSync**：前端接口文档、轻量 API 文档、字段映射、错误码或状态枚举新增/调整时，必须同步检查归档级 `.http` / `.cjs` 是否需要更新；若不更新，CP2/报告写明 `N/A + skipReason`。异步、队列或数据库落库型接口验证不得只断言 HTTP 状态码，还应按 TestRoute 查询持久化真相源并验证最终消费者响应字段。
- **FrontendExperienceQualityGate**：前端页面、组件、控制台、官网、文档站、可视化工具或游戏任务必须做条件判定；命中后按 UI 视觉组 `FrontendDesignSourceGate` / `UIFidelityGate` / `StyleThemeConsistencyGate` / `ResponsiveStateCoverageGate` / `VisualVerificationGate` 与 UX 交互组 `InteractionFlowGate` / `InteractionFeedbackGate` / `InputModalityAccessibilityGate` / `ErrorPreventionRecoveryGate` / `MotionTransitionUsabilityGate` 规划设计、实现和验证；涉及 Figma/截图/既有页面还原时追加 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate` 与 `RuntimeI18nArtifactVerificationGate`；不触发时写 `N/A + skipReason`，不得引入未确认的新 UI 库、设计系统或视觉 diff 平台。
- **CrossProjectLearnedGuards / GovernanceGateRegistry**：dev 流程只负责识别触发，先消费 `spec-absorption` 的通用性证明、项目独有残留剔除和消费者证明，再执行 `LayeredAbsorptionGate`、记录 `LayeredAbsorptionDecision`，并兼容 `SkillFirstAbsorptionGate` / `CapabilityToSkillPromotionGate` / `SkillAbsorptionDecision`；若判定为 `new-skill-required`，必须同批创建 Skill 或登记 PF/ISSUE。完整 Gate 正文由 `spec-governance` 的 `GovernanceGateRegistry`、目标 Skill、`test-router`、report 与 validate 探针承接，不再在 instructions 追加长清单。`layerChecks` 必须覆盖 `commonInstruction`、`skill`、`promptTemplate`、`executionConsumer`、`validationProbe`、`publicDocs`、`deployCopy`。典型 gateGroup 包括 `absorption-layering`、`historical-common-layering`、`confirmed-completeness`、`review-checklist`、`user-manual`、`frontend-runtime`、`release-parity`、`profile-service`、`public-surface`、`evolution-control-plane`、`rework-prevention`、`contract-release-authority`、`configuration-ergonomics`、`interactive-semantics`、`agent-capability-completeness`、`docs-audience-render-sequence`、`consumer-validation` 与 `module-performance-maintenance`。
- **ReviewFindingIntakeGate**：开发需求若直接来自外部审查报告、AI review finding、audit issue 或代码评审发现，CP1/CP2 前必须先完成审查发现 intake 分流：报告只是线索、是否设计如此、是否需用户决策、文档/实现漂移归因、是否仅测试覆盖缺口；未完成分流不得直接把 finding 写成必须修代码。
- **ProductRequirementTraceabilityGate**：从需求方原始输入、产品需求文档、Word、原型、截图、会议纪要或用户补充消息提炼需求时，CP1 必须列出来源锚点、AI 结构化提取口径、产品补充口径、冲突/缺失处理、双方确认状态与技术验证映射；不得仅输出 AI 摘要。
- **Legacy guard anchors**：`LocalExecutionConfigProbe`、`ManualReviewEvidenceDataRetention`、`AdjacentScopeExpansionGuard`、`PackageNameAuthorityGate`、`PerformanceBenchmarkFirstGate`、`PublicModuleDifferentiationGate`、`V2MCPFirstPlanningGate`、`WorkspaceDataAbsorptionScopeGate`、`FlowchartNodeExplanationGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`MethodLevelLeakPressureProbe` 与 `V2FormalSolutionPackage` 作为历史 grep 锚点保留；执行细节以 `GovernanceGateRegistry` 的 ownerSkill 和 TestRoute 为准。
- **Service 职责边界**：简单业务 service 默认只做业务编排、外部能力调用和必要上游错误映射；不得重复 route validate、model/schema、数据导入或框架已承担的校验、归一化、配置兜底和二次治理。
- **README 使用者表达**：README / 使用文档涉及性能表、语法/能力矩阵或模式优先级时，先给用户选择结论，再解释字段；同时写清支持形式、不支持形式和优先级示例，避免内部术语抢占主叙事。
- **AbsorptionDecision / ProactiveBetterAlternativeGate**：调研、审查、复审或方案讨论中被判断“值得吸纳”的建议，必须进入当前确认清单、设计占位或显式 backlog；若存在比用户原始方案更低风险、更完整、更易维护或更易验证的路径，必须先提出取舍再确认；若不纳入当前范围，必须明确拒收或延后原因，禁止只写“二期 / 以后再说”而无台账或设计占位。
- **FullV1ScopeGuard**：用户表达“第一版 / v1 / 完整首版”且存在真实消费项目、发布契约或主要功能验收时，不得自动降级为 MVP；只有用户明确接受 MVP / 分期时，才可把主功能延后，并在非目标 / 后续清单中写明。
- **StartupPhaseTrace**：启动性能优化或 dev 日志治理必须先把启动日志按阶段归类，并与 Profile / startup summary 使用同一套阶段命名，再决定减噪、lazy loading 或 background warmup；禁止只隐藏扁平日志后宣称完成优化。

### 跨服务需求处理（CP1 前确认）

当需求涉及多个服务时，须在 CP1 输出前完成以下判断：

**入口服务界定规则**（按优先级）：

| 优先级 | 条件 | 结果 |
|:------:|------|------|
| 1 | 接收原始用户请求的服务 | 该服务为入口服务 |
| 2 | 拥有本次需求核心业务对象的服务 | 该服务为入口服务 |
| 3 | 无法判断 | AI 在 CP1 列出候选服务，等用户指定 |

**产物落点**：`01-需求确认.md` 或产品直接提供的 `01-产品需求.md` 存入**入口服务**的 `.devcodex/requirements/<需求名>/`，头部填写 `影响服务` 字段；历史目录可继续使用 `01-需求概述.md` 作为兼容真相源。

**services/ 创建时机**：CP2 确认后（技术方案明确各服务边界后）才创建 `services/<服务名>/实施方案.md`，每个文件头部必须包含反向引用链接。

**禁止**：各服务各自建独立 `requirements/<需求名>/` 目录（碎片化，AI 无法整合全局视野）。

### CP 响应处理

| 用户响应 | 处理方式 |
|---------|---------|
| ✅ 确认 | 进入下一阶段 |
| ✏️ 修正 | 应用修正后重新输出当前 CP，等待再次确认 |
| ❌ 拒绝 | 回退到当前 CP 重新分析 |
| ？追问 | 回答后重新输出当前 CP，等待确认 |
| 🔀 模糊 | **不得推进**，必须明确询问再等待显式响应 |

### 确认后前置轻量复审

- **适用节点**：CP1 → CP2、CP2 → plan-review / CP3、CP3 → 执行
- **复审对象**：刚被确认的需求理解 / 技术方案 / 实施计划
- **复审目标**：
  1. 当前产物内部是否自洽
  2. 与上游已确认内容是否冲突
  3. 是否遗漏会在下一阶段形成阻断的问题
- **交叉验证追加条件**：
  - 涉及控制面规则或流程边界
  - 涉及多文件联动 / 多真相源同步
  - 涉及模板、示例与自动校验链联动
- **交叉验证最小覆盖**：
  1. 当前产物
  2. 上游已确认产物
  3. 相关真相源、联动规则或校验探针
- **处理规则**：
  - 无阻断问题：显式输出“前置复审结果：✅ 无阻断，可进入下一阶段”后再推进
  - 发现阻断问题：停止推进，先修正当前产物并告知用户，再回到对应 CP 重新确认
  - 连续 2 次前置复审仍发现新的阻断问题：提示升级为定向 `audit` 或扩大扫描范围

### 全自动模式（@devcodex-auto / @rocky / Profile autoAliases）

- CP1/CP2/CP3 确认**自动通过**
- 正式入口包括显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `extensions.devcodex.autoAliases` 替换别名与明确自然语言 auto 授权；配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；未生效昵称或普通“继续”不算授权
- 支持 Hook 的宿主仅对白名单路径自动推进；`instruction-fallback` 宿主只同步规则语义
- S01~S07 / C01 / C10 / C18 **不可豁免**
- 可恢复失败：重试 ≤ 2 次；不可恢复失败：通知用户 ⚠️

## plan-review 质量门禁（两阶段强制）

> 非 docs/plan-review/scenario-test 子类型必须执行。PR-1 在 CP2 前做 AI 内部自检；PR-2~PR-7 在 CP2→CP3 之间执行。🔴 阻断时短路停止（不继续后续 PR），回 CP2 重确认。

### PR-1 需求完整性 🔴
- 方案覆盖 CP1 确认的所有需求点
- 边界条件已识别（空值/超大输入/并发/断网）
- 错误处理路径已设计

### PR-2 技术可行性 🔴
- 技术选型与项目 profile 技术栈一致
- 依赖可安装，无模糊"待定"步骤
- 触发依赖/框架/SDK/平台 API 引入或升级时，已读取官方使用文档并形成 `OfficialDocsEvidence`
- 对已有代码的改动方案，必须逐行追踪新代码在原始执行路径中的实际插入位置，验证新逻辑不会被已有的提前 return/throw/break 跳过
- 对已有公共接口、Schema、返回结构或错误码的变更，必须给出“现状契约 → 目标契约”差异说明
- CP2 方案必须显式给出兼容性策略与边界问题清单，不能只散落在风险说明中

### PR-3 约束合规性 🔴
- 敏感信息、明文连接信息和硬编码处理符合用户 / 项目显式策略（S02）；未指定限制时不得因“安全最佳实践”阻断或改写为 env、`secretRef`、secret manager、`config.local.json` 或占位符
- 不可逆操作有确认步骤（S01）
- 不违反项目 profile 架构约束
- 已执行 `ProfileImpactCheck`：需同步 Profile 的变更已列出同步目标；无需同步时已有 `skipReason`

### PR-4 性能与安全隐患
- N+1 查询/循环 I/O → 🟡 标注
- 未加权限的敏感操作 → 🔴 阻断

### PR-5 影响评估前置标记
| # | 检查项 | 触发路径 |
|:-:|--------|----------|
| ① | 对外 HTTP API 变更 | EXEC 后 → api-verification |
| ② | 跨模块架构依赖变更 | → impact-review（CP3 前） |
| ③ | 数据库 Schema 变更 | → database 子类型流程 |

### PR-6 架构质量视角（C15）
三维评估：可扩展性 / 可维护性 / 易上手性。未达标须说明原因并记录改善方向。

### PR-7 测试策略与风险评估 🟡
- §7 测试策略覆盖目标明确，关键路径有对应测试类型
- §9 风险至少识别 1 条技术风险，每条有缓解措施
- 未通过不阻断，标注 `⚠️` 并建议补充
- 多测试路径或控制面变更应在 CP3 前或执行前调用 `test-router` 明确必跑/可跳过验证与跳过理由

## 变更管理

> 适用于 dev 工作流在 CP 通过后或执行阶段发现需求/方案偏差时的处理规则。

### 变更分级（F-07）

| 级别 | 描述 | 处理方式 |
|:----:|------|---------|
| 🟢 微调 | 仅实现细节变化，不影响已确认的接口/行为/范围 | 继续执行，记录偏离原因 |
| 🟡 扩展 | 在已确认范围内追加新功能点或调整非核心接口 | 回 CP2 补充确认后继续 |
| 🔴 重大 | 影响已确认的核心接口/数据模型/范围边界 | 必须回 CP1 重新确认，不得继续当前实施 |

### CP 通过后变更处理（F-08）

- CP 通过后若需改变已确认内容，按上表分级判断是否需要回退 CP
- 🟡/🔴 变更须更新对应产物文件（`02-技术方案.md`/`04-实施计划.md`）再继续
- 禁止静默执行与已确认方案不符的实现

### 执行中变更处理（F-10）

- 执行阶段发现技术方案有误或需调整时，立即暂停当前任务，按变更分级走对应流程
- 不得"先改代码、事后补文档"——产物文件须在代码落地前更新

### 版本历史管理（F-11）

- 每次方案迭代（含 CP 回退后修订）须在 `02-技术方案.md` 头部版本号递增并注明变更摘要
- 格式：`v0.0.N — YYYY-MM-DD — [变更摘要]`

## 影响评估触发条件（IMPACT_REVIEW）

- **仅**由 PR-5②"跨模块架构依赖变更"触发
- PR-5① 对外接口变更 → EXEC 后走 api-verification（不进 impact-review）
- PR-5③ 数据库 Schema 变更 → 走 database 子类型（不进 impact-review）

## 执行约束

- 逐文件执行，编码后必须运行 lint/typecheck/test
- **TypeScript 项目类型校验强制**：当项目存在 `tsconfig.json`、`tsconfig.*.json`、`package.json` 的 `typecheck` 脚本，或明显为 TS/TSX 工程时，执行阶段必须补做 1 次类型校验
- **类型校验命令选择顺序**：
  1. 优先运行项目现有 `typecheck` 脚本
  2. 若无脚本但本地可直接调用 TypeScript 编译器，运行 `tsc --noEmit`
  3. 若为多配置/子项目结构，使用项目既有 `tsconfig` 入口执行无产物校验（如 `tsc --noEmit -p <tsconfig>`）
- **无污染要求**：类型校验不得通过创建临时 `tsconfig`、修改 `noEmit` 配置、写入构建产物或额外参数文件来“绕过”项目现状；验证应以当前仓库真实配置为准
- error 最多 2 次迭代；2 次仍失败 → 停止，输出错误摘要标 ⚠️
- 涉及 HTTP 接口变更 → 生成双产物（.http + .cjs）
- 涉及源码/配置文件变更 → 检查文档同步（README 为必查；CHANGELOG 按发布状态区分：未明确发版默认更新 `changelogs/unreleased.md`，仅正式 release 更新根 `CHANGELOG.md` / `changelogs/releases/vX.Y.Z.md`；TASK-INDEX/STATUS 按项目存在或启用时同步）
- 涉及验证、发布、pack、benchmark、codegen 或生成产物 → 完成前必须检查并清理与本轮无关的新增/残留文件；release / verification close-out 不得把无关 dirty 文件、并行验证残留或旧失败产物留给后续任务。
- 涉及文档阅读顺序、审查顺序、实施顺序或“先看什么”入口 → `document-sync` / ConceptSyncMap 必须把 README、索引页、website sidebar/nav 和目录页列为当前消费者，同批校验呈现顺序；若信息架构故意不同，必须说明差异原因。
- 涉及依赖/框架/SDK/平台 API 变更 → 验证 `OfficialDocsEvidence` 与实际实现一致；不得只以安装成功替代官方用法验证
- 涉及项目事实变化 → 执行 `ProfileImpactCheck` 并通过 `document-sync` 更新 Profile 或记录跳过理由
- Auto、控制面、多批次、预计 ≥10 文件或发布类任务 → 执行前必须有 ExecutionContract；执行中按 `allowedPaths`、`requiredArtifacts`、`validationRoute` 对照推进
- dev 中若 AI 判断目标包含修复规范缺口、审查 finding、回归或其他已确认不正确行为，必须触发 `repair-collaboration`：低风险至少内联轻量双层契约，高风险使用完整契约与独立复证；纯新增能力不触发，模型/Agent 名称不得作为触发条件。详细字段与状态机只引用 `execution-contract`
- 未明确发版时不得执行真实 `tag` / `push` / `publish`；用户明确要求 release 时先走 `audit-release` 与 `release-verification`

## ECR 执行闭环复审（执行后强制）

> 适用于 `dev` 工作流的关键产物稳定性确认。ECR（Execution Closure Review）是执行后正式完成阶段，把原“轻量复审收敛”具体化为可检查清单；它不是 audit 的 3 轮零发现重流程。

### 触发时机

- 执行完成后、宣告任务完成前，必须对关键产物与最终实现结果做 1 轮轻量复审
- 关键产物至少包括：
  - `02-技术方案.md`（若存在）
  - `04-实施计划.md`（若存在）
  - `05-实施进度.md`（若触发）
  - 开发报告
  - 最终实现结论

### 复审目标

1. 关键产物与最终实现是否一致
2. 报告/结论是否存在“已完成/已验证”但证据不足的伪完成
3. 是否出现新的阻断性问题

### ECR 最小清单

| 项 | 检查对象 | 目的 |
|----|----------|------|
| ECR-1 | CP1/CP2/CP3、实施进度、报告、daily tasks、SUMMARY | 避免压缩后状态错配 |
| ECR-2 | 需求条款 / 问题 ID → diff/commit 文件 | 避免确认范围漏实现 |
| ECR-3 | CP3 步骤 → 测试/部署/验证证据 / AI 自启动服务清理证据 | 避免计划与执行漂移 |
| ECR-4 | 报告声明 → 测试/探针/服务清理/官方文档 / `OfficialDocsEvidence` / `ProfileImpactCheck` | 避免过度宣称 |
| ECR-5 | memory daily → SUMMARY | 避免 SUMMARY 早标绿 |
| ECR-6 | git dirty 边界 | 避免混入用户另案变更 |
| ECR-7 | 控制面任务追加 validate / direct replay / host-contract probe；涉及规范源、Skill、Hook、CLI、MCP、模板、部署副本、路径规则或 validate 语义时必须执行 SCV（见 `skills/spec-governance/SKILL.md`） | 避免校验假绿与规范漂移 |

### 阻断性问题定义

以下任一成立，视为阻断性问题：

- 方案与实现主链不一致，可能导致错误实施或错误交付结论
- 关键兼容性、回滚、验证路径缺失
- 报告声称“已完成/已验证”，但与代码、测试或实际结果不符
- 影响范围遗漏，导致完成结论不可信

### 回退规则

- 方案层问题 → 回 `CP2`
- 计划层问题 → 回 `CP3`
- 实现层或报告层问题 → 回执行阶段修正

### 收敛条件

- 最后一次阻断性修正后，至少再完成 **1 轮轻量复审**
- 该轮无新增阻断性问题，才可宣告完成

### 升级条件

- 若连续 2 轮轻量复审仍持续发现新的阻断性问题，必须提示用户：
  - 升级为定向 `audit`
  - 或扩大扫描范围后再继续

## 代码风格

- dev 工作流进入前必须读取项目 `profile/03-代码风格.md`
- 项目 profile 优先于默认值

## 子类型专属规则

### default（新功能开发）
- 六阶段执行：N1 需求确认 → N2 技术方案（含 PR-1 自检）→ N3 方案验证 → N4 实施计划 → N5 执行 → N6 ECR 执行闭环复审
- `N4` 只负责把已确认方案转成任务拆分、顺序、依赖、验证与回滚；`05-实施进度.md` 对小任务不是默认文书，但多批次、预计 ≥10 文件、跨轮次、阻塞、控制面联动或用户要求持续跟踪时必须启用
- `N5` 若执行中新增范围触达 CP3 门槛，必须先回退到 `N4` 补做计划确认，再继续执行
- `N6` 是执行后的正式阶段，内部至少包含：方案一致性验证、关键产物对照、ECR-1~ECR-7、阻断性问题复审与完成判定
- 无特殊豁免，完整走 CP1→CP2→CP3

### refactor（重构）
- 前置检查：被重构模块必须有测试覆盖，无测试时**禁止继续**，优先补测试
- 基线快照：记录当前接口签名、导出列表、公开 API
- 最小增量重构，每步可独立回滚
- 禁止在重构中混入功能变更（行为不变原则）
- 重构 vs 优化边界：重构 ≡ 结构/可读性变更；优化 ≡ 性能/资源改善

### database（数据库）
- Migration 安全策略：
  - 新增列：DEFAULT 或 NULLABLE，禁止 NOT NULL 无默认值
  - 删除列：先废弃（rename），至少一版本后再删除
  - 修改列类型：评估存量数据兼容性，准备回滚脚本
  - 新建索引：CONCURRENTLY（PG）或 ALGORITHM=INPLACE（MySQL）
- CP2 必须包含：Schema ER 图 / 变更前后对比表 / 回滚方案
- 🔴 禁止在 Migration 中写业务逻辑
- 🔴 大表（>100万行）变更必须评估锁时间

### init（项目初始化）
- 跳过 CP3 和 plan-review
- init 完成后**必须**创建 `.devcodex/profile/`（README + 01~03）
- 生成的 .gitignore 必须包含 `.devcodex/.memory/`

### optimization（性能优化）
- 前置条件：api-verification 已通过 + 有基准数据 + 测试环境隔离
- 默认工具：autocannon
- 🔴 禁止无基线数据的"盲优化"
- 优化不改变外部接口行为

### scenario-test（场景测试）
- 前置条件：若场景测试目标包含 HTTP 接口，则需 api-verification 已通过；若仅测试内部逻辑或数据层，则需被测模块具备可执行的测试数据/基线 + 测试环境就绪
- 负载测试默认工具：artillery
- 泄漏风险稳定性压测按 `LeakRiskStabilityPressureTest` 条件触发，优先复用项目已有压测/监控/测试脚本；证据至少包含基线、压力过程、冷却后回落、资源指标前后对比和清理结果
- 测试数据使用 fixtures，禁止依赖生产数据

### docs（文档开发）
- 豁免 plan-review / impact-review / CP3
- CP2 简化为**文档大纲确认**
- 当文档任务属于契约驱动型需求时，可先冻结目标文档，再做简化版 CP2 文档大纲确认
- 文档质量标准：结构完整 / 示例可执行 / 版本同步 / 链接有效

### plan-review（方案评审）
- 豁免 plan-review（防递归）
- 本身即为审查工作流
