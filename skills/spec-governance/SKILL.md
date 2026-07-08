---
name: spec-governance
description: 规范治理生命周期 — 意图驱动记录、RecordRouter 分流、SCV 规范变更验证
---
# Spec Governance Skill

## 定位

本 Skill 是规范治理生命周期的集中规则源，负责把“记录规范问题”和“规范变更验证”收口为统一链路：

```text
发现 -> Intent Detection -> Ambiguity Guard -> RecordRouter -> Ledger Write -> Upgrade Check -> Verification
```

原则：

- AI 负责语义判断、上下文归因、多意图拆分和模糊表达澄清。
- 规则负责安全底线、CP 状态、台账格式、路径落点和 SCV 阶段要求。
- 工具负责文件存在、测试结果、部署同步、active-root 泄漏和 validate 探针。

## 记录意图识别

任何“记录一下”“这个不合理”“这个规范要优化”“以后应该这样做”“你刚才漏了/错了/违反流程了”类输入，都必须先识别规范化意图，不得按关键词直接写台账。

| 规范化意图 | 触发含义 | 默认目标 |
|------------|----------|----------|
| `record.violation` | 已有明确规则，但 AI 未执行或执行错 | `data/violations.md` |
| `record.spec-defect` | 规范缺失、冲突、过窄、外部假设失效或拦截滞后 | `data/pending-fixes.md` |
| `record.process-improvement` | 用户提出更优执行策略，AI 验证后可泛化 | `data/process-improvements.md`（优化清单，PI） |
| `record.pending-issue` | 已确认但不阻断当前任务，适合后续批次治理 | `data/pending-issues.md` |
| `record.audit-gap` | 审计/validate/Hook 未发现本该发现的问题 | `data/gap-registry.md` |
| `record.none` | 普通解释、需求整理、报告整理，不是治理记录 | 不写台账 |
| `record.ambiguous` | 指代不清或可能误写台账 | 先澄清 |

## 置信度规则

| 置信度 | 条件 | 处理 |
|--------|------|------|
| 高 | 用户表达明确，且上下文证据支持唯一分类 | 直接分流并说明依据 |
| 中 | 主意图明确，但存在副意图或升级可能 | 先处理主意图，列出副意图 |
| 低 | “记录这个”等指代不清，或目标台账不唯一 | 不写台账，先澄清 |

每次记录分流必须输出：`规范化意图`、`置信度`、`依据`、`目标台账`。

## Improvement Intake（优化清单）

在所有模式下，除了处理“记录一下”这类显式记录请求，每条用户消息在完成合理性评估后，还必须执行一次主动 Improvement Intake：

- 若用户建议经验证**更优且可泛化**，即使没有说“记录一下”，也应主动写 PI。
- 若用户建议同时暴露了**规范未定义、过窄或不完整**，应同步写 PF。
- 若只是这次执行没有遵守已存在规则，应写 VL，而不是误写 PI/PF。
- 若只是业务项目的一次性偏好、局部临时安排或不可泛化做法，应判为 `record.none`。

### Intake 分流矩阵

| 场景 | 目标 |
|------|------|
| 更优策略，可泛化 | `PI` |
| 规范缺口 / 规范不完整 | `PF` |
| 更优策略 + 规范缺口同时成立 | `PI + PF` |
| 已有规则未执行 | `VL` |
| 一次性偏好 / 不可泛化 / 普通讨论 | `none` |

所有模式下，主动 Intake 完成后必须显式回执：`已记录 PI-xxx`、`已记录 PF-xxx` 或 `已记录 PI-xxx / PF-xxx`。

宿主 runtime 若标记 `governanceIntakeCandidate`，只能作为“可能需要 RecordRouter”的收尾提醒；AI 仍必须输出规范化意图、置信度、依据和目标台账，或明确 `record.none + skipReason`。禁止仅凭关键词由 Hook 自动写台账。

## LayeredAbsorptionGate（分层吸纳归属判定）

`LayeredAbsorptionGate` 是 Improvement Intake 之后、规范源实施之前的强制架构门禁。`SkillFirstAbsorptionGate` / `CapabilityToSkillPromotionGate` 保留为 Skill 层兼容子门禁。任何可泛化 PI / PF / GAP / ISSUE 或用户确认值得吸纳的策略，都不能默认追加到 `CrossProjectLearnedGuards`、`LatestAbsorptionGuards` 或通用 instructions 长列表，也不能只做“通用规范 / Skill”二选一；必须先判断归属并列出所有消费层。

### 归属分类

| 分类 | 含义 | 处理 |
|------|------|------|
| `global-invariant` | 安全底线、入口加载、优先级、路由或全模式硬约束 | 写入 instructions / safety / common，Skill 只引用 |
| `existing-skill-subgate` | 属于既有 Skill 的子门禁或执行步骤 | 并入目标 Skill，并同步 TestRoute / report / validate |
| `new-skill-required` | 已形成独立能力入口 | 新建或规划独立 Skill，通用规范只保留触发和路由 |
| `docs-only` | 仅是说明、历史镜像或用户文档补充 | 写 README / website / changelog，不作为执行门禁 |

### 新 Skill 判定条件

满足任一条件应优先判为 `new-skill-required`：

1. 需要 3 条以上相关子门禁或一组稳定执行步骤。
2. 需要独立产物、状态文件、模板、清单或证据矩阵。
3. 跨 dev / fix / audit / release / report 多个工作流复用。
4. 用户会用自然语言直接点名该能力，例如“用户使用文档”“复审清单”“发布前审查”。
5. 只放在通用规范会导致触发条件模糊、提示词膨胀、职责边界不清或验证只能检查文本存在。

### LayeredAbsorptionDecision 输出

每次吸纳实施前，CP2 / 技术方案 / 报告至少记录：

| 字段 | 说明 |
|------|------|
| `candidateId` | PI / PF / GAP / ISSUE / 用户确认项 |
| `classification` | `global-invariant` / `existing-skill-subgate` / `new-skill-required` / `docs-only` |
| `targetSkill` | 既有 Skill 或新 Skill 名；N/A 时说明原因 |
| `triggerTerms` | 用户自然语言触发词或工作流触发场景 |
| `ownedArtifacts` | 该 Skill 负责的文档、清单、模板、状态或验证产物 |
| `layerChecks` | 分层同步检查，至少覆盖 `commonInstruction`、`skill`、`promptTemplate`、`executionConsumer`、`validationProbe`、`publicDocs`、`deployCopy` |
| `validationRoute` | validate 编号、targeted test、SCV 或人工证据 |
| `consumerSync` | instructions、skills、prompts、README、website、Profile、部署副本同步范围 |

`SkillAbsorptionDecision` 是 `LayeredAbsorptionDecision` 的 Skill 层兼容字段，不能替代完整分层决策。若判定为 `new-skill-required`，不得只把规则追加到通用守门清单后宣告吸纳完成；必须在同批创建 Skill，或把未创建原因写入 PF / ISSUE，并在后续批次优先处理。任何层级判定为 N/A 都必须写 `skipReason`。

## HistoricalCommonNormLayeringGate（历史通用规范分层迁移）

当用户要求“之前吸纳的规范重新分层”“全面逐个文件审查”“不要都堆在通用规范里”，或复审发现通用 instructions / prompt / report 模板持续承载大段执行正文时，必须执行 `HistoricalCommonNormLayeringGate`。

### 逐文件审查矩阵

迁移前先创建并冻结逐文件审查矩阵，至少包含：

| 字段 | 说明 |
|------|------|
| `file` | 当前文件或历史镜像范围 |
| `currentRole` | 当前角色：source、consumer、prompt-template、validate-probe、public-doc、deploy-copy、historical-mirror |
| `matchedRules` | 命中的 Gate / 规则族 / 用户确认项 |
| `targetLayer` | `commonInstruction`、`skill`、`promptTemplate`、`executionConsumer`、`validationProbe`、`publicDocs`、`deployCopy`、`historicalMirror` |
| `targetOwner` | 目标 Skill、prompt、脚本、文档或部署副本 |
| `action` | `retain-index`、`move-detail-to-skill`、`add-probe`、`sync-docs`、`historical-skip`、`legacy-index-retained` |
| `semanticStrength` | `same-or-stronger`、`weaker-needs-confirmation` |
| `validation` | targeted test、validate 编号、SCV、构建、部署同步或人工证据 |
| `skipReason` | 历史镜像、无当前消费者、N/A 原因 |

### 迁移规则

- 通用 instructions 只保留安全底线、全局不变量、触发索引、跨 Skill 路由和历史兼容锚点；不得继续成为新 Gate 正文的默认容器。
- 具体执行步骤、证据字段、测试路线、发布门禁、用户文档写作、复审清单、Profile 同步和自我进化控制面必须进入对应 Skill、Prompt/Report 模板、执行消费者和 validate 探针。
- 已在通用层存在但尚未找到同等强度承接方的历史规则，不得直接删除；标记为 `legacy-index-retained`，保留 Gate 名 grep 锚点，并把补迁移项写入矩阵 / PF / ISSUE。
- Prompt 和 report 只能承载字段与输出结构，不复制完整 Gate 长清单；需要全量执行的内容由目标 Skill 读取。
- 历史 release / version / requirement 镜像默认按 `historicalMirror` 处理，不回写当前架构口径；当前 README、website guide、active version、changelog、Profile 和部署副本必须同步。
- 新增或补强该迁移能力时必须更新 V74 或后续 validate 探针，检查 `HistoricalCommonNormLayeringGate`、逐文件矩阵、目标 Skill、Prompt/Report、public docs 与 deploy copy。

### PromptLongGateListDriftProbe

`PromptLongGateListDriftProbe` 是历史长清单迁移后的防回流探针。当前 README、website guide、拆分 instructions、technical-design / implementation-plan / report prompts 等消费者只能写 `GovernanceGateRegistry`、`gateGroup`、ownerSkill、validationRoute、skipReason 和少量代表锚点；不得重新复制 `CrossProjectLearnedGuards`、`LatestAbsorptionGuards` 或 `ConfirmedAbsorptionCompletenessGates` 的完整 Gate 长清单。

探针必须包含 SCV 负向样例：用旧版跨项目长清单、完整吸纳长清单和最新吸纳长清单构造样例，确认检测逻辑会失败；同时用分组 registry 摘要构造正向样例，确认不会误伤。若复审发现 prompt、report、README 或 website 又出现跨组大清单，应先记录逃逸原因，再补 `GovernanceGateRegistry` / gateGroup 引用和目标 Skill 承接方。

### 分层检查面

| 层级 | 必查内容 |
|------|----------|
| `commonInstruction` | S/C/公共治理、拆分 instructions、CrossProject 索引是否需要同步 |
| `skill` | 既有 Skill 子门禁、新 Skill、Skill frontmatter、plugin 注册和路由是否需要同步 |
| `promptTemplate` | 技术方案、实施计划、报告、需求/审查等 prompt/template 是否需要同步 |
| `executionConsumer` | TestRoute、report、document-sync、release/audit/dev/fix 执行消费者是否需要同步 |
| `validationProbe` | validate、targeted test、SCV、负向用例或人工证据是否需要同步 |
| `publicDocs` | README、website、changelog、用户可见版本文档是否需要同步 |
| `deployCopy` | `.github`、`.claude`、`AGENTS.md`、`.agents`、`.codex` 或 Profile 部署副本是否需要同步 |

## GovernanceGateRegistry（治理 Gate 分组注册表）

`GovernanceGateRegistry` 是 PC4、技术方案、实施计划、报告模板和 validate 探针共同引用的 Gate 分组索引。通用 instructions 或 prompts 不应复制完整 Gate 长清单；它们只记录 `gateGroup / ownerSkill / trigger / requiredEvidence / validationRoute / skipReason`。

| gateGroup | ownerSkill | 触发语义 | 最小证据 |
|-----------|------------|----------|----------|
| `absorption-layering` | `spec-governance` | 可泛化 PI / PF / GAP / ISSUE、用户确认值得吸纳、新增 Gate | `LayeredAbsorptionDecision`、`layerChecks`、consumer sync |
| `historical-common-layering` | `spec-governance` | 历史通用规范、prompt/report 长清单或旧吸纳项重新分层 | 逐文件审查矩阵、`legacy-index-retained`、`PromptLongGateListDriftProbe`、V74/V75 探针 |
| `confirmed-completeness` | `spec-governance` + 目标 Skill | 未完整吸纳、半覆盖、缺 Gate / Skill / Prompt / Probe / deployCopy | gateGroup 分流表、目标 Skill 证据、验证探针 |
| `review-checklist` | `review-checklist` | 正式复审、ECR、发布前复审、多轮收敛、外部 finding 批次 | 复审清单文件、状态、证据、Run ID、收敛结论 |
| `review-escape` | `review-checklist` + `spec-governance` | 二次复审或实施中发现原清单遗漏、新问题逃逸 | `ReviewEscapeRecordGate`、`escapedItem / whyMissed / missingDimensionOrProbe / prevention / checklistPatch / rerunEvidence`、台账分流 |
| `post-confirmation-review` | `cp-gate` + `review-checklist` + `dev-plan-review` | CP1/CP2/CP3 确认后进入下一阶段 | `PostConfirmationReviewScopeGate` 风险分级、轻量/全面复审判定、冻结清单或 skipReason、PR-2~PR-7 证据 |
| `development-drift` | `execution-contract` + `dev-default` | 进入编码前、实施中范围扩张或验证路线变化 | `DevelopmentDriftGate`、allowedFirstBatch、blockedScope、driftTriggers、validationRoute、dirty boundary |
| `user-manual` | `user-manual-authoring` | 站点文档、README、quick start、接入手册、最终用户手册 | 用户任务路径、配置、示例、排错、真实工作流、渲染验证 |
| `docs-ia-readability` | `user-manual-authoring` + `dev-docs` + `document-sync` | 中文用户文档、sidebar IA、新增公开能力或菜单纠偏 | `ChinesePrimaryExpressionGate`、`SidebarPageRoleMaterializationProbe`、`SidebarGroupSemanticModelProbe`、pageRole/sidebar group 矩阵 |
| `frontend-runtime` | `audit-project` + `test-router` | 首页、详情、列表、搜索、前端接口数据、缓存刷新或运行态页面 | 旧缓存先渲染、异步刷新、失败回退、网络/状态验证 |
| `release-parity` | `audit-release` + `release-verification` | push/tag/release/publish 前验证 | 与远端 CI 同构门禁、pack、coverage/audit/examples/website 矩阵、原生命令真实 exitCode |
| `profile-service` | `load-profile` + `profile-bootstrap` | Profile 链路、服务集合、公共规范抽取或服务残留 | 读取链、最强 Profile、服务残留清扫、覆盖矩阵 |
| `public-surface` | `release-verification` + `audit-release` | package、README、website、public types、examples、搜索索引变化 | npm pack 历史公开内容、隐藏链接、public API、search/sidebar 反查 |
| `evolution-control-plane` | `evolution-governance` | 自我进化、自动吸纳、模型辅助规范优化或自动发版候选 | 候选态、授权、模型配置、权限/配额、审计、回滚和审批 |

新增 Gate 时必须先登记或复用 gateGroup，再同步 owner Skill、prompt/report 字段、TestRoute、validate 探针、README/website/changelog 和部署副本。无法归入现有 gateGroup 时，优先判断是否应新增独立 Skill，而不是把正文追加到通用长清单。

### ProactiveBetterAlternativeGate

处理用户建议、确认、规范吸纳、CP2 方案或复审清单冻结前，必须主动比较用户方案与至少一种项目现实可行的替代路径。若存在更低风险、更完整、更易维护或更易验证的路径，应先提出建议、收益、代价和影响范围，再进入确认或实施；不得只因用户提出方向就顺从式记录。若用户方案已是当前最优，记录依据，例如真相源证据、消费者范围、验证成本、迁移风险或用户明确约束。

`AcceptedSuggestionRootCauseGate`：当用户提出更优方案、纠正命名 / IA / 验证路线 / 范围边界，且 AI 采纳该方案时，最终回复和报告必须说明为什么前序检查没发现、采纳依据、写入或关闭的 VL / PI / PF / GAP 编号，以及下次防复发动作。若只是一次性偏好或业务局部调整，写 `record.none + skipReason`；若暴露规范缺口，按 RecordRouter 写台账并进入 LayeredAbsorptionGate。

## ConfirmedAbsorptionCompletenessGates

当用户确认“未完整吸纳 / 还要一起吸纳 / 刚才这些都要补上”或复审发现只有概念覆盖、缺独立 Gate、缺 Skill、缺 Prompt、缺探针或缺部署副本时，必须把该批规则作为 `ConfirmedAbsorptionCompletenessGates` 处理。执行路线：

1. 复核候选是否仍有价值，剔除已完整吸纳或不适合泛化的项。
2. 为每项输出 `LayeredAbsorptionDecision`，标明 `global-invariant / existing-skill-subgate / new-skill-required / docs-only`。
3. 对每个 `layerChecks` 逐层同步：`commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy`。
4. 若某项已经在正文中出现，但没有 Gate 名、触发条件、报告字段或 validate 探针，不得判定为完整吸纳。

本批确认吸纳项至少覆盖：

| 归属 | Gate |
|------|------|
| public surface / release | `PublicSurfaceClosureGate`、`RemoteCIParityPushGate`、`NativeCommandExitCodeGate`、`PortableExternalArtifactGate` |
| user docs | `UserManualProductizationGate`、`UserManualRenderedFlowAndRealWorkflowProbe`、`DocsPageRoleMatrixGate`、`CompleteUserManualSiteMatrixGate`、`DocsThemeRuntimeVisualProbeGate` |
| review / requirements / anchors | `SampleIssueExpansionGate`、`RequirementDimensionBindingGate`、`RequirementPriorityAndPhaseGate`、`ReviewAnchorMaterializationGate` |
| truth sampling / legacy / route | `SemanticLegacyRouteExposureGate`、`ReferenceCodeTruthSamplingGate`、`RouteNamespaceResponsibilityGate` |
| frontend / data | `FrontendAsyncCacheRenderGate`、`StaleWhileRevalidateGate`、`AsyncDbTruthSourceVerificationGate` |
| profile / service norms | `StrongestProfileSourceGate`、`ServiceSpecificResidueSweep`、`ProfileReadChainGate`、`ServiceNormCoverageGate` |
| API / framework / evolution | `OfficialApiEvidenceGate`、`FrameworkCapabilityAutoFirstGate`、`EvolutionCapabilityControlPlaneGate` |

`EvolutionCapabilityControlPlaneGate` 必须转入 `evolution-governance`；不得只作为 `spec-governance` 子段落处理。其他项按目标领域进入 `user-manual-authoring`、`review-checklist`、`audit-*`、`test-router`、`release-verification`、`load-profile`、`dev-plan-review` 或 `document-sync`。

## Backlog Intake 真相复核

当新的需求、bug、批次计划或尾项治理**直接来源于 `data/*.md` 的 open/partial 条目**时，不能把这些编号直接视为本轮真实 open。进入 CP1 / 问题确认或批次实施前，必须先做 Backlog Intake 真相复核：

| 分类 | 含义 | 处理 |
|------|------|------|
| `pure-open` | 主体尚未实施，仍是当前真实 open | 直接纳入本轮 |
| `residual-tail` | 主体已修，只剩尾项/补强/探针/文书 | 缩减为尾项治理 |
| `already-fixed` | 代码/产物已修，仅状态没回写 | 先回写台账并从本轮范围剔除 |
| `misclassified` | 台账分类、描述、归属或计数错误 | 先修正台账与统计口径，再决定是否继续纳入 |

最小复核动作：

1. 对照源码、运行时台账、最新报告/进度、测试结果和记忆索引。
2. 为每个候选编号给出上述分类之一。
3. 非 `pure-open` 项必须先回写台账，再修正 CP1/CP2/CP3 的范围、统计与实施计划。
4. 用户面至少说明：候选编号、分类结果、是否缩减本轮范围。

## 台账落点与关闭证据

- `data/*.md` 是运行时逻辑台账路径，实际写入必须先解析 active-root。
- 旧布局写 `<项目根>/.devcodex/data/`；workspace-namespace 单项目写 `<工作区根>/.devcodex/<project>/data/`；全工作区写 `<工作区根>/.devcodex/workspace/data/`。
- `WorkspaceDataAbsorptionScopeGate`：当用户要求“检查 data 目录、最新可吸纳问题、仍需吸纳清单、开始吸纳”时，候选扫描范围必须是工作区 `.devcodex/*/data/` 全部命名空间；不能只扫描源码项目、当前 sticky activeProject 或某一个 runtime active-root。输出至少包含命名空间、台账文件、候选编号、归属判断、跳过原因与最终纳入范围。
- DevCodex 规范自身、Hook、Skill、模板、validate 或宿主适配链路问题归属当前 DevCodex 源仓或规范维护项目的 active-root；在 `workspace-namespace` 下应解析为承载 DevCodex 源码或规范资产的项目命名空间，不得因当时正在处理业务项目而写入业务项目台账。
- `data/process-improvements.md` 在本 Skill 中也可称“优化清单（PI）”；当建议针对 DevCodex 规范自身时，PI/PF 的 active-root 归属同样遵循上条，不得写入业务项目台账。
- VL/PF 关闭前必须具备修复方案、修复时间、验证状态、验证时间、验证证据与关闭时间；仅“已登记”不得视为“已验证关闭”。
- VL/PF 关闭链的时间顺序必须满足 `登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间`；不得写入未来时间或让关闭/验证早于登记。若只能确定日期而非分钟，先保留 `—` 并在证据中说明来源，禁止倒填一个看似精确但破坏时间线的值。
- 若实施、复审或范围收紧改变了 VL/PF/PI/ISSUE/GAP 的真实状态，必须执行**台账状态回写闭环**：回写状态、验证证据、验证时间、关闭时间或部分完成说明，并在批次完成前做 1 轮 target ledger rescan，确认 open 计数、进度、报告和 SUMMARY 已同步。

## RecordRouter

RecordRouter 只在记录意图识别后执行。

| 输入 | 判定 | 目标 |
|------|------|------|
| AI 明确违反已有规范 | 有规则但未执行 | VL |
| 用户指出 AI 漏做流程、错用规范、误判完成或误写台账 | 已有规则未执行时记 VL；规则缺失/不清时升级 PF/GAP | VL / PF / GAP |
| 规范本身缺失、冲突、滞后 | 规则需要修复 | PF |
| 用户提出更优策略并被采纳 | 过程策略优化 | PI |
| 已确认但不阻断当前任务 | 可排期治理 | ISSUE |
| 检查体系存在盲区 | 检测能力缺口 | GAP |

升级规则：

1. 重复 VL 不得只追加违规，应判断是否升级 PF 或 GAP。
2. PF 经用户确认且可排期时，可转 ISSUE。
3. PI 只有在策略可泛化且不破坏现有规则时才写入。
4. GAP 必须包含“为什么原检查没有发现”和“建议探针”。
5. 实施完成复审、ECR 或审计复审发现新问题时，必须执行 `ReviewEscapeRecordGate`：在复审清单中记录 `escapedItem`、`previousChecklistGap`、`whyMissed`、`missingDimensionOrProbe`、`prevention`、`checklistPatch`、`rerunEvidence`，再判断是否升级 VL/PF/GAP。

## SCV 规范变更验证

当修改规范源、Skill、Hook、CLI、MCP、模板、部署副本、website specs、路径规则或 validate 语义时，必须执行 SCV。

### Concept Sync Map

控制面或模板-示例-校验链任务在进入 SCV-2 前，必须先建立 Concept Sync Map；推荐直接调用 `source-consumer-sync`：

| 字段 | 说明 |
|------|------|
| `sourceOfTruth` | 当前事实源 |
| `currentConsumers` | 本轮必须同步的当前消费者 |
| `historicalMirrors` | 仅作历史归档的镜像 |
| `validateProbes` | `validate` 编号、targeted tests、replay 或其他探针 |
| `deployCopies` | `.github/`、`.claude/`、`AGENTS.md`、`.agents/`、`.codex/` 等部署副本 |
| `yellowDeviationBoundary` | 允许按黄色偏离一并纳入的当前消费者/探针 |

| 阶段 | 目标 | 最小动作 |
|------|------|----------|
| SCV-0 | 变更分类 | 判断文字、语义、控制面、宿主适配、路径存储、文档镜像 |
| SCV-1 | Concept Sync Map | 列出 `sourceOfTruth`、`currentConsumers`、`historicalMirrors`、`validateProbes`、`deployCopies`、`yellowDeviationBoundary` |
| SCV-2 | CRS 双向联查 | 正向 grep 关键词，反向推导应同步但缺失的当前消费者和探针 |
| SCV-3 | 可执行验证 | 运行 `node scripts\validate.js` 与相关 targeted tests |
| SCV-4 | 行为回放 | 回放 Hook/MCP/CLI 场景，验证宿主契约、visible reply 证据与路径行为 |
| SCV-5 | 部署副本同步 | 执行并验证部署副本同步或明确 N/A |
| SCV-6 | 产物边界扫描 | 检查 workspace root、legacy `.devcodex`、错误 `.tmp`、报告/记忆落点 |
| SCV-7 | 完成判定 | 报告、memory、SUMMARY、dirty 边界、推荐结论一致 |

完成规则：

- SCV 结果必须写入报告，不能只写“已验证”。
- 黄色偏离必须写明为什么仍在 `yellowDeviationBoundary` 内，且不能把当前消费者伪装成历史镜像。
- SCV 失败时不得宣告任务完成。
- 控制面任务的 ECR-7 必须引用 SCV 证据。

## AI 与确定性边界

| 交给 AI | 交给规则/工具 |
|---------|---------------|
| 自然语言意图、上下文指代、多意图拆分 | 删除/危险命令/用户与项目敏感信息策略 |
| 判断违规 vs 规范缺口 | active-root、workspace-namespace 路径 |
| 判断建议是否可泛化 | CP 状态、台账编号、模板字段 |
| 判断是否需要澄清 | 测试、lint、validate 实际结果 |
| 判断重复违规是否应升级 | 部署副本 hash、文件存在性、SCV 完成状态 |

禁止：

- 禁止仅凭关键词把“记录一下”写成 VL。
- 禁止低置信度下静默写台账。
- 禁止用 AI 主观判断替代测试和 validate 结果。
- 禁止用户指定错误台账时盲从，必须做合理性复核。
