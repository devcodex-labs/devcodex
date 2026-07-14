---
name: spec-governance
description: 规范治理生命周期 — 意图驱动记录、RecordRouter 分流、SCV 规范变更验证；规范吸纳执行细节由 spec-absorption 承接
---
# Spec Governance Skill

## 定位

本 Skill 是规范治理生命周期的集中规则源，负责把“记录规范问题”和“规范变更验证”收口为统一链路；规范吸纳的候选扫描、通用性证明、消费者证明和实施执行由 `spec-absorption` 承接：

```text
发现 -> Intent Detection -> Ambiguity Guard -> RecordRouter -> Ledger Write -> Upgrade Check -> Verification
```

原则：

- AI 负责语义判断、上下文归因、多意图拆分和模糊表达澄清。
- 规则负责安全底线、CP 状态、台账格式、路径落点和 SCV 阶段要求。
- 工具负责文件存在、测试结果、部署同步、active-root 泄漏和 validate 探针。

## 记录意图识别

`PostAssessmentGovernanceIntakeGate`：每条非空用户消息都先登记一个**中性的待评估候选**，但候选不等于治理命中。AI 必须在完成合理性评估、项目现实扩展和上下文归因后，才判断是否存在治理记录意图；关键词、固定短语或正则只能帮助定位证据，不能作为候选分类、写台账或跳过评估的权威依据。普通问答也必须形成 `record.none` 的受控评估结果，而不是靠“未命中关键词”静默绕过。

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

每次候选评估必须输出结构化 `GovernanceIntakeDecision`：`候选锚点`、`评估结论`、`泛化范围`、`现有规范状态`、`规范化意图`、`置信度`、`依据`、`目标台账`、`写入要求`、`写入证据`、`skipEvidence`。未适用字段必须显式写 `N/A + reason`，不能省略后让 Hook 猜测。

### ContextualCandidateSet

- 候选集合按消息锚点持久化，至少保存 `id/sourceDigest/phase/verificationState`；新一轮消息不得覆盖上一轮未终结候选。
- 主阶段必须保留 `detected → assessed → generalized → routed → write-observed → acknowledged` 的有序历史；`record.none` 可在 challenge 通过后由 routed 进入 acknowledged，`uncertain/record.ambiguous` 必须停在 assessed，缺写入证据的实质意图必须停在 routed。禁止省略中间语义/证据阶段直接终结。
- 每个实质 intent state 必须保存 `targetLedger/claimedIds/observationIds/status`；复合候选逐项验证，不能只在 candidate 顶层保留一个总状态。
- 同一未终结消息重复送达时按 digest 去重并增加 `seenCount`；已终结消息再次出现时允许创建新候选，避免历史结论覆盖新上下文。
- Hook 只向 AI 暴露候选 ID、阶段、次数和最小消息锚点，不回显完整 prompt；多个未终结候选并存时，决策必须引用精确候选 ID。
- 旧版单候选状态必须迁移为 v2 candidate set；reset、项目目标切换和压缩恢复都不得丢失未终结候选。

### CompoundRecordRouterGate

同一候选可同时命中多个 `record.*` 意图，例如“更优策略 + 规范缺口 + 原有探针漏检”可形成 `record.process-improvement + record.spec-defect + record.audit-gap`。复合意图必须逐项给出目标台账、写入要求、证据 ID 与验证状态；全部必需意图都完成后候选才可终结。禁止只记录第一个命中项、用一个台账 ID 代替其余意图，或把 `record.none` / `record.ambiguous` 与实质写入意图混合。

### LedgerWriteEvidenceGate

- `写入要求=required` 时，只有成功的 `PostToolUse` 对**当前 active-root 的精确目标台账路径**形成观察，且本次工具输入和工具完成后的真实文件都包含相同、前缀正确的 ledger ID，才算 `verified`。PreToolUse、失败结果、只在回复中声称编号、只写错误项目/root、只在 patch 内容提到路径、目标文件不存在或宿主未暴露结果，都保持 `unverified`。
- `写入要求=already-recorded` 只适用于当前候选复用已存在记录的情况；必须在当前 active-root 的正确台账文件中重新读取并找到精确 ID，不能引用历史报告、错误 root 或仅凭记忆通过。
- 意图—台账—前缀固定映射：violation→`violations.md/VL-`、spec-defect→`pending-fixes.md/PF-`、process-improvement→`process-improvements.md/PI-`、pending-issue→`pending-issues.md/ISSUE-`、audit-gap→`gap-registry.md/GR-`。复合意图对每一项执行 all-of；任何一项未验证，候选都不能进入 `acknowledged`。
- Hook 只观察和验证写入证据，不自动创建台账条目；无法观察时明确保留 `unverified`，由 instruction-fallback 的报告/会话产物记录人工复证证据。

### RecordNoneChallengeGate

`record.none` 是需要证明的终结决策，不是默认兜底。它必须独占规范化意图，并同时提供 `评估结论=no-governance-impact`、合法泛化范围、`现有规范状态=exists-complete|not-applicable`、置信度、独立的具体依据、`写入要求=none` 与具体 `skipEvidence`；不得携带台账路径或 ID。范围为 `project-local|none` 时必须证明局部性/不可泛化；范围更广时只能由 `exists-complete` 及精确既有规则证据关闭。缺字段、可泛化改进仍未被完整规则覆盖、规范状态为 missing/partial/conflicting、与写入意图混合、依据和 skipEvidence 空泛或相互复制时，候选保持 `pending-none-challenge`。`record.ambiguous` 或 `评估结论=uncertain` 始终停在 assessed、保持未终结并先澄清。

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

> 执行归属：本节只定义治理层门禁与输出字段。候选来自 `.devcodex/*/data`、“最新可吸纳 / 仍需吸纳 / 开始吸纳”时，必须读取 `spec-absorption`，先执行 `CommonNormGeneralizationGate` 与 `AbsorptionCandidateConsumerProofGate`，证明通用价值和 DevCodex 当前消费者；项目独有规则只能作为 `project-local` 或 `case-evidence-only`，不得进入通用规范。

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
| `repair-collaboration` | `execution-contract` | AI 判断任务目标是修复 Bug/缺陷/回归/安全问题/规范缺口/审查 finding/已确认不正确行为；模型名称与是否切换 Agent 不作为触发条件 | lightweight/full 风险分类、authorizationEvidence、双层字段；full 追加 findingToPatchMap、handoffIntegrity、independentReReview 与 accepted 证据 |
| `absorption-layering` | `spec-absorption` + `spec-governance` | 可泛化 PI / PF / GAP / ISSUE、用户确认值得吸纳、新增 Gate | `CommonNormGeneralizationGate`、`AbsorptionCandidateConsumerProofGate`、`LayeredAbsorptionDecision`、`layerChecks`、consumer sync |
| `historical-common-layering` | `spec-absorption` + `spec-governance` | 历史通用规范、prompt/report 长清单或旧吸纳项重新分层 | 逐文件审查矩阵、`legacy-index-retained`、`PromptLongGateListDriftProbe`、V74/V75 探针 |
| `confirmed-completeness` | `spec-absorption` + 目标 Skill | 未完整吸纳、半覆盖、缺 Gate / Skill / Prompt / Probe / deployCopy | gateGroup 分流表、通用性证明、消费者证明、目标 Skill 证据、验证探针 |
| `review-checklist` | `review-checklist` | 正式复审、ECR、发布前复审、多轮收敛、外部 finding 批次 | 复审清单文件、状态、证据、Run ID、收敛结论；`ChecklistStateMaterializationGate` 六区块一致快照 |
| `review-escape` | `review-checklist` + `spec-governance` | 二次复审或实施中发现原清单遗漏、新问题逃逸 | `ReviewEscapeRecordGate`、`escapedItem / whyMissed / missingDimensionOrProbe / prevention / checklistPatch / rerunEvidence`、台账分流 |
| `post-confirmation-review` | `cp-gate` + `review-checklist` + `dev-plan-review` | CP1/CP2/CP3 确认后进入下一阶段 | `PostConfirmationReviewScopeGate` 风险分级、轻量/全面复审判定、冻结清单或 skipReason、PR-2~PR-7 证据 |
| `development-drift` | `execution-contract` + `dev-default` | 进入编码前、实施中范围扩张或验证路线变化 | `DevelopmentDriftGate`、allowedFirstBatch、blockedScope、driftTriggers、validationRoute、dirty boundary |
| `user-manual` | `user-manual-authoring` | 站点文档、README、quick start、接入手册、最终用户手册 | 用户任务路径、配置、示例、排错、真实工作流、渲染验证 |
| `docs-ia-readability` | `user-manual-authoring` + `dev-docs` + `document-sync` | 中文用户文档、sidebar IA、新增公开能力或菜单纠偏 | `ChinesePrimaryExpressionGate`、`SidebarPageRoleMaterializationProbe`、`SidebarGroupSemanticModelProbe`、pageRole/sidebar group 矩阵 |
| `frontend-runtime` | `audit-project` + `test-router` | 首页、详情、列表、搜索、前端接口数据、缓存刷新或运行态页面 | 旧缓存先渲染、异步刷新、失败回退、网络/状态验证 |
| `release-parity` | `audit-release` + `release-verification` | push/tag/release/publish 前验证；首次发布或 publisher/repository/package/registry/auth topology 变化；scoped package 双 registry | 与远端 CI 同构门禁、pack、coverage/audit/examples/website 矩阵、原生命令真实 exitCode；`PublisherCredentialTopologyGate` 的身份/scope/access/permission/ownership/reference run 证据且不含 secret value；`ScopedRegistryResolutionGate` 的 scope/global/userconfig/override/独立通道解析证据 |
| `profile-service` | `load-profile` + `profile-bootstrap` + `memory` | Profile 链路、服务集合、公共规范抽取、服务残留、项目级 analyze/audit 真相对账、宿主 Memories / 模型回忆可能替代文件真相源 | 读取链、最强 Profile、服务残留清扫；`ProfileTruthReconciliationGate` 的 mode/profileTrustState/ProfileTruthMatrix/结论矫正；`MemoryCannotSatisfyBootstrapGate` 的 navigation-hint 与文件读取证据 |
| `security-audit-presentation` | `security-threat-modeling` | 用户自有/明确授权的本地安全审查，或宿主额外安全检查导致内容不可见/流程中断 | `AuthorizedLocalSecurityAuditPresentationGate`、authorizationContext、defensiveObjective、visibleEvidenceBudget、isolatedProbeBoundary、SafetyInterruptionCard、恢复/反馈路线与禁止绕过声明 |
| `memory-bootstrap` | `load-profile` + `memory` + `report` | 新线程、resume、summary 恢复、compact 后继续、跨项目切换或用户询问是否启用 / 依赖宿主 Memories | `MemoryCannotSatisfyBootstrapGate`、当前 active namespace Profile / SUMMARY / tasks / reports / review checklist / 源码或文档读取证据、V86/targeted probe |
| `artifact-scale-skill-gap` | `skill-gap-analysis` | 项目/工作区产物扫描、能力盘点、缺 Skill、全量审查、目录很大、扫描超时或需分批恢复 | `ProjectArtifactScaleRoutingGate`、WorkspaceCorpusManifest、ScaleDecisionRecord、ExclusionPolicy、BatchEvidenceLedger、ExistingSkillCoverageMatrix、ConvergenceRecord、V91 |
| `skill-lifecycle` | `skill-lifecycle-governance` + `evolution-governance` | Skill 组合冲突、依赖、误触发/漏触发、gray/deprecated/retired、合并拆分或 portfolio 健康度 | SkillPortfolioIndex、DependencyGraph、LifecycleChangeSet、TriggerQualityScorecard、RetirementEvidence、授权与回滚、V91 |
| `public-surface` | `release-verification` + `audit-release` | package、README、website、public types、examples、搜索索引变化 | npm pack 历史公开内容、隐藏链接、public API、search/sidebar 反查 |
| `evolution-control-plane` | `evolution-governance` | 自我进化、自动吸纳、模型辅助规范优化或自动发版候选 | 候选态、授权、模型配置、权限/配额、审计、回滚和审批 |
| `agent-capability-completeness` | `ai-agent-system-architecture` | 声称完整/最终 Agent 架构、平台或 enterprise 产品能力 | completenessObject、请求/反馈/横切/产品企业链、domain owner/boundary/runtime/validation、V95 |
| `docs-audience-render-sequence` | `audit-user-manual` | 用户文档 pageRole、首屏/导航优先级、quick start 距离、TOC/outline 运行态顺序 | `DocsAudienceRoleAndRenderedSequenceProbe`、fresh generated/Browser evidence、V95 |
| `consumer-validation` | `consumer-validation-engineering` | 独立 consumer/verification repo、跨仓完整验证、packed artifact、多分母 100%、跨仓 CI/漂移 | repository binding、identity/artifact/lock/pack、denominator states、CI run、freshness、gray lifecycle、V95 |
| `module-performance-maintenance` | `performance-engineering` | 框架/SDK/CLI 逐模块完整性能覆盖或长期维护 | applicability、module protocol、capacity/resource/recovery、PR/main/schedule/RC/post-release、retention/drift/skip/N/A/flake、V95 |
| `rework-prevention` | `rework-prevention-engineering` + `evolution-governance` + `spec-absorption` | 降低返工率、提升首次通过率、复审反复发现新问题、审查逃逸或自我进化效果评估 | WorkUnit 分类、双重根因、ReworkRiskProfile、`ReworkReductionValueGate`、`ReworkEffectivenessLoop`、基线与前瞻试运行、成本、rollback/sunset、V94 |
| `contract-release-authority` | `api-contract-architecture` + `audit-release` + `release-verification` | 兼容、迁移、alias/fallback、历史行为保留或发布边界判断 | `ReleaseAuthorityBeforeCompatibilityGate`、publishedState、consumerEvidence、authoritySources、decision、V94 |
| `configuration-ergonomics` | `developer-experience-architecture` + `api-contract-architecture` | 新增/调整公开配置、嵌套字段、默认值、首次成功路径或高级能力边界 | `ConfigurationErgonomicsGate`、MinimalTaskConfig、FieldNecessityMatrix、ComplexityBudget、AdvancedCapabilityBoundary、OptionalFieldOmissionProbe、V94 |
| `interactive-semantics` | `accessibility-i18n` + `audit-user-manual` + `test-router` | 链接、按钮、菜单、对话框、可展开控件、自定义交互或文档站运行态验收 | `InteractiveSemanticProbe`、role、accessible name、focusability、Enter/Space/Escape、focus recovery、V94 |
| `expert-output-quality` | `expert-output-quality` + `dev-plan-review` + `dev-docs` + `audit-*` | 代码、文档、示例、fixture、quick start、技术方案或报告需要体现技术专家 / 资深架构 / 领域专家质量，或用户指出“不专业 / 像初级 / 示例误导” | `ExpertOutputQualityGate`、`ProductionRecommendedPathGate`、`FrameworkNativeCapabilityFirstGate`、`FixtureBoundaryDisclosureGate`、`AntiPatternContrastGate`、`ExpertEvidenceMatrixGate` |
| `expert-owner-skills` | 21 个专家 Owner Skill：原 17 个 Owner 加 `distributed-systems-architecture`、`performance-engineering`、`privacy-compliance-architecture`、`ai-evaluation-engineering` | 需求、方案、代码、文档或报告命中产品策略、开发者体验、UX、前后端、SRE、API/外部集成、平台/Agent、数据安全质量、设计与无障碍、增长商业、分布式系统、性能、隐私合规或 AI 评测专业语义；增长 / 商业为 P3 条件触发 | `ExpertOwnerSkillGate` 及各 Owner Gate；新增 `DistributedSystemsArchitectureGate`、`PerformanceEngineeringGate`、`PrivacyComplianceArchitectureGate`、`AiEvaluationEngineeringGate`；记录 ownerSkill、triggerReason、requiredFields、validationRoute、skipReason、V85/targeted probe |
| `docs-semantics-examples` | `dev-docs` + `audit-document` + `audit-readme` + `user-manual-authoring` | 行为语义、翻译、示例、quick start、callback / hook / event 文档与代码真相源可能漂移 | `BehaviorSemanticDocsParityGate`、`NegativeTranslationParityProbe`、`DocsExampleTruthSurfaceGate`、`CallbackExampleScopeProbe`、public types / runtime / generated search 证据 |
| `derived-consumer-runtime` | `audit-project` + `dev-testing` + `test-router` | 默认行为、控制流、能力触发或副通道输出影响派生消费者 | `DerivedMetricConsumerProbe`、`DerivedConsumerFailureInjectionProbe`、metrics/info/logs/events/warnings/admin bridge/public types 和失败注入隔离证据 |

V85 兼容锚点：原 17 个 Owner 为 `product-strategy`、`developer-experience-architecture`、`ux-interaction-architecture`、`frontend-architecture`、`backend-domain-architecture`、`production-readiness-sre`、`api-contract-architecture`、`external-integration-architecture`、`platform-ecosystem-architecture`、`ai-agent-system-architecture`、`data-architecture`、`security-threat-modeling`、`quality-strategy`、`design-system-architecture`、`accessibility-i18n`、`growth-analytics`、`business-model-review`；对应 Gate 为 `ProductStrategyOwnerGate`、`DeveloperExperienceArchitectureGate`、`UxInteractionArchitectureGate`、`FrontendArchitectureOwnerGate`、`BackendDomainArchitectureGate`、`ProductionReadinessSreGate`、`ApiContractArchitectureGate`、`ExternalIntegrationArchitectureGate`、`PlatformEcosystemArchitectureGate`、`AiAgentSystemArchitectureGate`、`DataArchitectureGate`、`SecurityThreatModelingGate`、`QualityStrategyGate`、`DesignSystemArchitectureGate`、`AccessibilityI18nGate`、`GrowthAnalyticsGate`、`BusinessModelReviewGate`。新增 Owner 只能扩展该集合，不得削弱既有触发语义。
| `feature-inventory-batch-evidence` | `profile-bootstrap` + `load-profile` + `review-checklist` + `report` | 公开功能清单、Profile inventory、需求维度、批次验证或 EvidenceLedger 需要一致 | `FeatureInventoryProfileGate`、`FeatureChecklistEvidenceMatrixGate`、`BatchEvidenceLedgerStateGate`、`BatchProgressCardGate`、feature × evidence matrix 与 Progress Card |

新增 Gate 时必须先登记或复用 gateGroup，再同步 owner Skill、prompt/report 字段、TestRoute、validate 探针、README/website/changelog 和部署副本。无法归入现有 gateGroup 时，优先判断是否应新增独立 Skill，而不是把正文追加到通用长清单。

A1~A10 最新吸纳执行包默认复用上述 `docs-semantics-examples`、`derived-consumer-runtime`、`feature-inventory-batch-evidence`、`profile-service` 与 `absorption-layering` 分组；报告只写分组、ownerSkill、validationRoute 和代表锚点，不复制完整长清单。

### ProactiveBetterAlternativeGate

处理用户建议、确认、规范吸纳、CP2 方案或复审清单冻结前，必须主动比较用户方案与至少一种项目现实可行的替代路径。若存在更低风险、更完整、更易维护或更易验证的路径，应先提出建议、收益、代价和影响范围，再进入确认或实施；不得只因用户提出方向就顺从式记录。若用户方案已是当前最优，记录依据，例如真相源证据、消费者范围、验证成本、迁移风险或用户明确约束。

`AcceptedSuggestionRootCauseGate`：当用户提出更优方案、纠正命名 / IA / 验证路线 / 范围边界，且 AI 采纳该方案时，最终回复和报告必须说明为什么前序检查没发现、采纳依据、写入或关闭的 VL / PI / PF / GAP 编号，以及下次防复发动作。若只是一次性偏好或业务局部调整，写 `record.none + skipReason`；若暴露规范缺口，按 RecordRouter 写台账并进入 LayeredAbsorptionGate。

## ConfirmedAbsorptionCompletenessGates

当用户确认“未完整吸纳 / 还要一起吸纳 / 刚才这些都要补上”或复审发现只有概念覆盖、缺独立 Gate、缺 Skill、缺 Prompt、缺探针或缺部署副本时，必须把该批规则作为 `ConfirmedAbsorptionCompletenessGates` 处理。执行路线：

1. 先读取 `spec-absorption`，复核候选是否仍有价值，并通过 `CommonNormGeneralizationGate` 剔除已完整吸纳、不适合泛化或属于项目独有的项。
2. 为每项输出 `LayeredAbsorptionDecision`，标明 `global-invariant / existing-skill-subgate / new-skill-required / docs-only`。
3. 对每项执行 `AbsorptionCandidateConsumerProofGate`，证明 DevCodex 当前消费者和目标 owner。
4. 对每个 `layerChecks` 逐层同步：`commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy`。
5. 若某项已经在正文中出现，但没有 Gate 名、触发条件、报告字段或 validate 探针，不得判定为完整吸纳。

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
