---
name: dev-default
description: 默认开发子类型规范 — 通用功能开发六阶段流程（CP1→PR-1自检→CP2→plan-review→CP3→执行→ECR执行闭环复审）
---
# Dev Default Skill

## 触发条件

dev 工作流未匹配其他子类型时的默认路径，适用于：新功能开发、接口实现、业务逻辑变更。

## 六阶段执行

| 阶段 | 动作 | CP 关卡 |
|------|------|---------|
| N1 需求确认 | 先判定入口类型：纯新需求且无产品角色时独立保留 `00-需求概况.md` / 原始附件，生成并确认 `01-需求确认.md`；有产品角色并由产品直接提供完整需求时，以 `01-产品需求.md` 为 CP1 真相源，产品模板正文只给产品填写完整 PRD，AI / 研发缺口 / 冲突检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不生成或重写产品需求；需求变更独立保留 `00-需求变更概况.md`，生成 `01-需求变更确认.md` 并回写目标需求真相源；Bug 转 fix | [CP1](../cp-gate/SKILL.md) 确认 |
| N2 技术方案 | 架构设计、接口定义、数据流 → **PR-1 内部自检**（需求完整性），不通过则修正后重检；契约驱动型需求须显式引用目标文档路径/模式/契约范围 | 自检通过后 → [CP2](../cp-gate/SKILL.md) 确认 |
| N3 方案验证 | 调用 `dev-plan-review` Skill（PR-2~PR-7）；PR-5② 触发则继续 `impact-review` | 🔴 阻断时回 CP2 |
| N4 实施计划 | 任务拆分、顺序、依赖、验证与回滚 | [CP3](../cp-gate/SKILL.md) 确认 |
| N5 执行 | ExecutionContract/TestRoute 对照 → 编码实现 → 接口变更时 `api-verification` → `document-sync` | — |
| N6 ECR 执行闭环复审 | 对照 §2 核心设计、关键产物、报告、记忆、SUMMARY、diff/commit 与验证证据做执行后正式复审 | 发现阻断问题须回退修正 |

### N5 执行阶段补充规则

**读取前置（F-18）**：修改已有文件前须先 view 当前内容，确认最新状态；同会话内已读且无并行修改的文件可跳过重复 view。

**执行中变更处理（F-10）**：执行阶段发现方案调整需求时，立即暂停，按 `10-dev.instructions.md §变更管理` 变更分级走对应流程，产物文件须在代码落地前更新。

**执行期 CP3 回退（F-26）**：若 N5 执行过程中实际修改范围扩展到 CP3 门槛（文件数从 <5 增至 ≥5、临时引入高风险操作，或命中控制面/模板/validate/部署副本联动），必须暂停 source mutation，回到 N4 / CP3 补做实施计划确认后再继续。

**回归扫描（F-19）**：修改已有文件时，完成后须对该文件涉及的调用路径执行最小范围 grep 确认无残留引用问题；纯新增文件不触发。

**统一联查矩阵（F-25）**：命中控制面规则、模板、接口契约/验证产物、工作区真相源/部署副本、发布口径等高联动场景时，默认升为 L2 标准联查；若同时涉及多真相源同步或模板-示例-校验链，升级为 L3 强联查并追加交叉验证。

**最小实现守门（F-27）**：执行阶段必须按 CP1/CP2/CP3 的 `ImplementationComplexityLevel`（兼容旧字段 `ImplementationComplexityPreference`）与复杂度预算落地；用户未要求复杂化或需求不详细时默认 `简单够用`，只做满足已确认产品事实源和技术验证项的局部最小实现；`中等` / `企业级` 只能由用户确认后升级；禁止无计划新增抽象、通用配置、预留扩展点或未确认防御分支。若确需超出预算，先暂停并回 CP2/CP3。

**开发偏移守门（F-28A / `DevelopmentDriftGate`）**：进入编码前必须对照 CP1/CP2/CP3、ExecutionContract、TestRoute、消费者同步和当前 dirty 边界做一次偏移检查。至少列出 `allowedFirstBatch`、`blockedScope`、`noGoItems`、`driftTriggers`、`validationRoute` 和 `consumerSync`；若实施中触达排除范围、扩大 package/API/配置/文档消费者、引入新依赖、改变验证路线或污染工作区，先暂停并回 CP2/CP3 重新确认，不能把后续阶段能力直接并入当前批次。

**必要注释守门（F-28）**：非显然业务规则、状态转换、不变量、兼容约束、安全边界、外部契约映射或反直觉权衡必须保留短注释；JavaScript / Node.js 中命中必要注释的导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明必须使用标准 JSDoc；禁止逐行解释、重复代码含义、临时 TODO 或调试注释。

**通用工程吸纳守门（F-29）**：CP1 起前置平台工程判断，先确认消费者范围、共享契约边界、模块职责、维护成本与非目标；provider / connector / SDK 接入须落字段级合同；包 / 库 / adapter / CLI 须检查代码实现层与包工程层；依赖升级须拆分业务源码平滑性与依赖层落地条件；内部共享库根因优先评估“修共享库 + 消费项目升级”；简单业务 service 不重复 route/model/schema 已承担的校验与归一化。新增字段/配置/本地化容器/状态枚举须做 `ExistingDomainContractAudit`；业务策略常量须做 `ConfigOwnershipMatrix`；接口文档变更须做 `ApiDocVerificationSync`；数据补齐/迁移脚本须做 `DataMutationPlan`；值得吸纳建议须做 `AbsorptionDecision`、`ProactiveBetterAlternativeGate` 并追加 `LayeredAbsorptionGate`、`SkillFirstAbsorptionGate` / `CapabilityToSkillPromotionGate`，输出 `LayeredAbsorptionDecision`（兼容 `SkillAbsorptionDecision`），判断归属为 `global-invariant`、`existing-skill-subgate`、`new-skill-required` 或 `docs-only`，并逐层覆盖 `commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy`；完整首版须做 `FullV1ScopeGuard`；启动优化须做 `StartupPhaseTrace`；跨项目已吸纳守门只在本 Skill 判定触发和记录 `gateGroup / ownerSkill / validationRoute / skipReason`，执行正文引用 `spec-governance` 的 `GovernanceGateRegistry`，legacy anchors 包括 `CodeTruthRequirementGate`、`ManualReviewEvidenceRetention`、`ReviewFindingIntakeGate`、`UserPerspectiveDocsGate`、`ArtifactLinkSetDedupeGate`、`FrontendRuntimeNetworkProbeGate`、`ActiveRequirementFinalResponseGate`、`MethodLevelLeakPressureProbe` 与 `V2FormalSolutionPackage`。

**验证卫生与串行边界（F-30） / 验证卫生与并发边界**：按 `ConcurrencyPolicy` 执行：只读准备和隔离验证可在不共享输出目录时并行；release / pack / benchmark / codegen / package boundary 检查不得与会删除、重建或写入 `dist` 的命令并行；消费者验证异常时先核对 package.json / lockfile / node_modules / `npm ls <关键依赖>`；完成前检查并清理本轮或旧验证遗留的无关 dirty 文件。

**技术路线对比门禁（F-31）**：技术路线、架构优化、性能优化、框架能力设计或高维护成本方案，在 CP1 最终需求确认前执行 `TechnicalRouteComparativeGate`；若存在同类产品 / 项目 / 框架 / 本仓库相似模块可比，必须记录 `ComparativeResearchGate` 证据范围和采纳/不采纳理由；不触发时写 `N/A + skipReason`。

**需求方输入到产品需求链路（F-31A）**：需求来自业务、运营、客户、老板、内部使用方、PRD、Word、原型、截图、会议纪要或用户补充消息时，CP1 必须先判定入口类型。无产品角色 / 研发兼产品时，纯新需求将需求方原始输入独立保留为 `00-需求概况.md` 或等价附件，且 `00-需求概况.md` 必须使用口语化问题收集“你希望系统帮你做到什么、现在你们怎么凑合处理、有哪些必须遵守的业务口径、给一个希望出现的例子、给一个不能接受的例子和相关材料”；需求方允许填写“没有 / 不知道 / 暂无 / 需要产品帮忙整理”。AI 再生成 `01-需求确认.md` 产品需求草稿，产品补充归一化后由需求方 + 产品双方确认。有产品角色并由产品直接提供完整需求时，使用独立 `01-产品需求.md` / `product-requirement.prompt.md`，产品模板正文只给产品填写完整 PRD，产品完整写清业务目标、流程图、文字步骤、节点解释、页面交互、字段描述、业务规则、示例 / 反例与不确定点；AI / 研发不生成或重写产品需求，缺口 / 冲突检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，确认后直接进入技术方案。需求变更使用 `00-需求变更概况.md` + `01-需求变更确认.md`，必须锚定原需求基线、变更前后差异、影响范围、不变内容和目标真相源，并在确认后回写目标需求文件；Bug / 异常 / 已承诺行为与实际不一致转 fix 的 `00-问题概况.md` / `01-问题确认.md`，不得混入产品需求确认模板。技术方案只能承接双方确认后的产品需求、产品直接提供的完整需求或问题确认，不得直接把原始诉求当实现口径，也不得把需求方输入模板、产品完整需求模板和 AI 生成的产品确认模板混写。

**前端体验质量门禁（F-32）**：前端页面、组件、控制台、官网、文档站、可视化工具或游戏任务必须执行 `FrontendExperienceQualityGate` 条件判定；命中时把设计来源、UI 还原度、风格主题、响应式状态、用户流、交互反馈、输入方式/可访问性、错误恢复、动效转场和视觉验证纳入 CP2/CP3/TestRoute/ECR；Figma/截图/既有页面还原、局部视觉改动、真实 preview、状态回归、生产资产或运行时 i18n 追加 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate` 与 `RuntimeI18nArtifactVerificationGate`；未触发时写 `N/A + skipReason`。
**最新吸纳守门（F-33）**：涉及前端浏览器验证成本、用户自验、视觉偏差、设计帧用途、数据库记录迁移、外部 finding 反证矩阵、多阶段关闭、guard/policy 绕过、带副作用兼容文档、可执行示例、一次性脚本归属、验证命令副作用、需求确认前缺口或 package/adapter 确认前证据时，按 `GovernanceGateRegistry` 的 `frontend-runtime`、`finding-review`、`data-security-automation`、`release-package-contract` 与 `requirement-profile-service` 分组判定；legacy anchors 包括 `FrontendBrowserVerificationBudgetGate`、`UserSelfVerificationOverrideGate`、`VisualDeviationTypeGate`、`DesignFramePurposeClassificationGate`、`DatabaseRecordMigrationExportGate`、`FindingProbeMatrixGate`、`MultiPhaseClosureGate`、`GuardPolicyBypassMatrixGate`、`VerificationCommandSideEffectGate`、`RequirementPreConfirmGate` 与 `PackageAdapterPreConfirmEvidenceGate`；未触发时写 `N/A + skipReason`。

**数据吸纳扩展守门（F-33）**：来源于 `data/*.md`、用户纠偏或同类项目的剩余吸纳项，只有通过价值复核且能落入 CP/TestRoute/审查/validate 的，才进入规范源；进入规范源前必须先用 `LayeredAbsorptionGate` 和 `SkillFirstAbsorptionGate` 判定是否应进入通用指令、既有 Skill、新独立 Skill、prompt/template、执行消费者、验证探针、公开文档与部署副本，不能默认继续追加到通用 guard 列表。用户确认“未完整吸纳 / 半覆盖 / 仍需吸纳”的清单时执行 `ConfirmedAbsorptionCompletenessGates`，逐项按 `public-surface`、`user-manual`、`review-checklist`、`frontend-runtime`、`profile-service`、`release-parity`、`evolution-control-plane` 分流；代表性 anchors 包括 `PublicSurfaceClosureGate`、`UserManualProductizationGate`、`ReviewAnchorMaterializationGate`、`SemanticLegacyRouteExposureGate`、`ReferenceCodeTruthSamplingGate`、`FrontendAsyncCacheRenderGate`、`StaleWhileRevalidateGate`、`RemoteCIParityPushGate`、`OfficialApiEvidenceGate`、`EvolutionCapabilityControlPlaneGate` 与 `DocsThemeRuntimeVisualProbeGate`。

**全工作区 data 吸纳范围（F-34）**：从 `data/*.md` 扫描最新问题、生成仍需吸纳清单或执行吸纳修复时，必须执行 `WorkspaceDataAbsorptionScopeGate`，扫描 `.devcodex/*/data/` 下所有项目命名空间和 workspace 台账；只扫描当前项目、源码目录或 sticky activeProject 视为范围缺失。

**错误处理验证（F-21）**：实施完成后须验证边界/异常路径（如空值/权限拒绝/超时）均有处理，不得只验证正常路径。

**调试清理（F-20）**：执行完成后须检查并清除 console.log / 临时注释 / TODO 标注（业务 TODO 转为 issue 跟踪）。

### N6 偏离分级处理（F-04）

| 偏离类型 | 说明 | 处理方式 |
|---------|------|---------|
| 🟢 实现细节偏离 | 算法/结构调整，不影响接口/行为 | 记录偏离原因，继续 |
| 🟡 接口形式偏离 | 参数名/路径调整，行为不变 | 更新 api-verification，说明原因 |
| 🔴 行为/范围偏离 | 与已确认需求或技术方案功能差异 | 必须回 CP2/CP1 处理（见变更管理规则）|

**长会话重锚定（F-24）**：会话超过 10 轮后，N6 开始前须重新 view `01-需求确认.md` / `01-产品需求.md`（历史目录可用 `01-需求概述.md`）和 `02-技术方案.md`，确保复审基于最新文档而非记忆。

### N6 ECR 最小清单

执行完成后、最终报告完成前必须执行 ECR（Execution Closure Review）：

| 项 | 检查对象 | 目的 |
|----|----------|------|
| ECR-1 | CP1/CP2/CP3、报告、daily tasks、SUMMARY | 避免压缩后状态错配 |
| ECR-2 | 需求条款 / 问题 ID → diff/commit 文件 | 避免确认范围漏实现 |
| ECR-3 | CP3 步骤 → 测试/部署/验证证据 | 避免计划与执行漂移 |
| ECR-4 | 报告声明 → 测试/探针/官方文档 | 避免过度宣称 |
| ECR-5 | memory daily → SUMMARY | 避免 SUMMARY 早标绿 |
| ECR-6 | git dirty 边界 | 避免混入用户另案变更 |
| ECR-7 | 控制面任务追加 validate / direct replay / host-contract probe；涉及规范源、Skill、Hook、CLI、MCP、模板、部署副本、路径规则或 validate 语义时必须执行 SCV（`spec-governance`）；release/pack 任务追加 PackageBoundarySerialCheck 与无关残留清理证据 | 避免校验假绿、规范漂移与验证残留 |

## 关键规则

- 三个 CP 必须按序获得用户确认，禁止合并跳过（[C02](../../instructions/01-common.instructions.md)）
- PR-1 在 CP2 前做 AI 内部自检，PR-2~PR-7 在 CP2→CP3 之间做详细验证（`dev-plan-review` 两阶段流程）
- 执行阶段结束后触发：`api-verification`（若涉及接口）→ `document-sync` → **ECR 执行闭环复审**（N6，内部包含方案一致性验证和 ECR-1~ECR-7）
- Auto、控制面、多批次、预计 ≥10 文件或发布类任务，执行前必须调用 `execution-contract`；测试路线复杂或跨模块时调用 `test-router`
- 高联动场景不得只做单文件修改；至少要同步直接真相源与同层联动文件
- `impact-review` 仅由 PR-5②（跨模块架构依赖变更）触发，position：plan-review 之后、CP3 之前
- N4 只确认实施计划，不重复技术方案中的架构决策、接口论证和兼容性主说明；`05-实施进度.md` 对小任务不是默认文书，但多批次、预计 ≥10 文件、跨轮次、阻塞、控制面联动或用户要求持续跟踪时必须启用
- 高风险控制面 / 多批次任务的 ExecutionContract 与 TestRoute 必须显式列出历史能力回归矩阵，至少写清“历史能力 → 受影响批次 → 必跑验证 → 失败回滚点”
- Node.js 项目默认运行时、CI、Profile 与 README 不低于 `>=18`；低于 v18 必须有业务理由、风险和验证证据
- 关键 Markdown 产物（需求 / 方案 / 实施计划 / 实施进度 / 阅读型文档 / README）必须包含 `## 目录导航`；`.http / .cjs` 不适用
- 输出报告：`reports/requirements/` 目录，遵循 [`report`](../report/SKILL.md) Skill 命名规则
- 测试覆盖：实现完成后确认关键路径单测

## 豁免项

无特殊豁免，完整走 CP1→CP2→CP3 流程。
