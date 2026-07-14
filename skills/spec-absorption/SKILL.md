---
name: spec-absorption
description: 规范吸纳执行 Skill — 用于检查 data 最新可吸纳项、证明通用规范价值、剔除项目独有规则、输出吸纳清单、分层决策、同步消费者和验证探针；当用户说“吸纳规范 / 最新可吸纳 / 仍需吸纳 / 检查 data 是否有规范 / 开始吸纳”时使用。
---
# Spec Absorption Skill

## 定位

本 Skill 承接“规范吸纳”的执行面。`spec-governance` 负责 RecordRouter、台账分流、`GovernanceGateRegistry` 和 SCV；本 Skill 负责把 PI / PF / GAP / ISSUE / 用户确认项变成可审查、可验证、可同步的吸纳方案。

执行原则：

- 先证明是通用规范价值，再决定是否吸纳；不得把业务项目独有规则包装成 DevCodex 通用规范。
- 先证明 DevCodex 当前消费者存在，再进入规范源修改；不得只因为某个项目出现过一次就改通用规范。
- 先分层归属，再写实现；不得把成组能力默认追加到通用 instructions、`CrossProjectLearnedGuards` 或 prompts 长清单。
- 先输出最终待确认清单；用户确认后再实施、验证、回写台账和同步部署副本。

## 触发语义

| 用户语义 | 必做 |
|----------|------|
| “检查 data 是否有可以吸纳的” | 扫描 `.devcodex/*/data/` 全命名空间，输出候选、通用性判断、跳过理由 |
| “列出仍需吸纳清单” | 执行遗漏过滤，排除已吸纳、已关闭、重复和项目独有项，只列最终仍需吸纳 |
| “开始吸纳 / 确认执行” | 执行分层决策、消费者同步、验证探针、台账回写、报告和记忆 |
| “这个也要记录 / 以后要这样” | 先交给 `spec-governance` 做 RecordRouter，再由本 Skill 判断是否进入吸纳 |
| “之前都吸纳到通用规范了，重新分层” | 叠加 `HistoricalCommonNormLayeringGate`，先建逐文件矩阵 |

## 执行流程

1. **输入归集**：读取用户消息、相关报告、运行态台账、最新记忆和源码现状。
2. **规模路由与全命名空间扫描**：先调用 `skill-gap-analysis` 的 `ProjectArtifactScaleRoutingGate` 形成 `ScaleDecisionRecord`，再执行 `WorkspaceDataAbsorptionScopeGate` 覆盖 `.devcodex/*/data/`；大语料必须分批/checkpoint，错误 glob、超时和派生产物污染结果标 invalid/discarded。
3. **Backlog Intake 真相复核**：把候选分类为 `pure-open / residual-tail / already-fixed / misclassified`，非 `pure-open` 不得原样进入吸纳范围。
4. **通用性证明**：对每项执行 `CommonNormGeneralizationGate`。
5. **消费者证明**：对通过通用性证明的项执行 `AbsorptionCandidateConsumerProofGate`。
6. **返工价值复核**：候选声称降低返工、补复审遗漏或提升首次通过率时，执行 `ReworkReductionValueGate`；文本出现次数不能替代可执行 owner 和效果证据。
7. **分层归属**：执行 `LayeredAbsorptionGate`，判定 `global-invariant / existing-skill-subgate / new-skill-required / docs-only / case-evidence-only / project-local / already-covered`。
8. **确认清单**：仅输出仍需吸纳项，列出目标 Skill、层级、验证路线和跳过理由，等待用户确认。
9. **实施同步**：确认后同步 commonInstruction、Skill、promptTemplate、executionConsumer、validationProbe、publicDocs、deployCopy。
10. **验证回写**：执行 targeted test、`node scripts/validate.js`、必要的 `npm test` / website / release 验证；回写 PI / PF / GAP / VL / ISSUE 状态。
11. **报告记忆**：报告必须引用候选矩阵、LayeredAbsorptionDecision、验证证据、台账状态和部署副本同步。

## CommonNormGeneralizationGate

每个候选吸纳前必须先填写：

| 字段 | 说明 |
|------|------|
| `candidateId` | PI / PF / GAP / ISSUE / 用户确认项编号或消息锚点 |
| `sourceNamespace` | 来源命名空间，例如 `.devcodex/<project>/data` |
| `candidateScope` | 原始问题影响范围：单项目 / 多项目 / DevCodex 控制面 / 宿主通用 |
| `generalizationEvidence` | 可泛化证据：至少包含跨工作流复用、宿主无关性、DevCodex 当前消费者或同类问题重复证据之一 |
| `projectSpecificResidue` | 项目私有路径、服务名、业务名词、数据库/接口/路由局部前提、私有组织流程 |
| `negativeExamples` | 明确不吸纳的反例，防止下次误收 |
| `commonTrigger` | 抽象后的通用触发语义 |
| `targetConsumer` | DevCodex 中真实会执行该规范的 Skill / prompt / validate / report / docs |
| `decision` | `absorb / case-evidence-only / project-local / docs-only / already-covered / reject` |

判定规则：

- 只有 `generalizationEvidence` 成立且 `targetConsumer` 存在，才可进入 `absorb`。
- 存在项目私有残留时，必须先抽象成宿主/流程/消费者无关表达；抽象失败则判 `project-local`。
- 只是某个项目的目录、服务、接口、业务角色或部署习惯，不得吸纳为 DevCodex 通用规范。
- 已有同等或更强规范、Skill、prompt 和探针覆盖时，判 `already-covered`，只回写台账，不重复新增。

### 负向样例

| 负向样例 | 处理 |
|----------|------|
| `ServiceSpecReadGate`、`docs/services/<name>/` 服务开发读取链 | 项目或框架私有，不吸纳为 DevCodex 通用规范；可作为“先证明通用价值”的反例 |
| 单个业务项目的 service / route / model / schema 命名 | `project-local`，除非证明 DevCodex 多项目 Profile/服务规范消费者需要 |
| 单个库的 `cacheControl`、adapter 配置或返回值习惯 | `case-evidence-only` 或并入对应库本地规范 |
| 某个项目私有数据目录、导航层级、脚本名 | 不直接进入通用层；只能抽象为“消费者同步 / 产物边界 / 验证链”类规则 |

## AbsorptionCandidateConsumerProofGate

通过通用性证明后，还必须证明 DevCodex 当前消费面：

| 字段 | 说明 |
|------|------|
| `devcodexConsumerEvidence` | 当前仓库中会读取或执行该规则的文件和段落 |
| `targetOwner` | 目标 owner：existing Skill、new Skill、instruction、prompt、script、README、website、Profile、部署副本 |
| `layerChecks` | `commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy` |
| `validationRoute` | targeted test、validate 编号、SCV、npm test、website build、manual evidence |
| `skipReason` | 任一层 N/A 的理由 |

消费者证明失败时，不得实施为 active 规范；最多进入 PF / ISSUE，或作为 case evidence 保留。

## ReworkReductionValueGate

涉及“减少返工、避免复审再发现、提升一次通过率”的吸纳候选必须填写：

| 字段 | 说明 |
|------|------|
| `reworkCluster` | 可重复问题簇及 WorkUnit 边界，不得只写单个案例 |
| `currentDetectionPhase` / `targetDetectionPhase` | 当前发现阶段与希望前移到的阶段 |
| `frequencySeverityLateCost` | 频率、严重度、晚发现成本和可预防性证据 |
| `executableOwnerLayer` | 能真正执行该预防动作的 Skill / prompt / runtime / probe / checklist owner |
| `successMetric` | FirstPassYield、WorkUnitReworkRate、RepeatEscapeRate、PreventionHitRate 或等价指标 |
| `trialWindow` | 前瞻验证的可比 WorkUnit / 独立上下文、观察周期和退出条件 |
| `overheadAndFalsePositiveCost` | 新规则的执行成本、误报、重复检查和认知负担 |
| `rollbackOrSunset` | 无效、有害、长期未命中或被更强 owner 替代时的处置 |

判定规则：已有规则反复出现但只有文档表述、没有执行消费者、负向探针或前瞻验证，属于 `text-only recurrence`，不得判定已吸纳有效。候选可以先进入 gray，但 ordinary active / 宣告 closed 前必须由 `ReworkEffectivenessLoop` 给出前瞻证据；不足时保持 `insufficient-evidence`。

## 分层决策

`LayeredAbsorptionDecision` 必须包含 `candidateId / classification / targetSkill / triggerTerms / ownedArtifacts / layerChecks / validationRoute / consumerSync`。本 Skill 在 Skill 层还要写 `SkillAbsorptionDecision` 兼容字段。

| classification | 使用条件 | 处理 |
|----------------|----------|------|
| `global-invariant` | 安全底线、入口加载、全模式硬约束、优先级 | 通用 instructions 保留正文，目标 Skill 引用 |
| `existing-skill-subgate` | 有明确既有 Skill owner | 并入 Skill 子门禁，同步消费者和探针 |
| `new-skill-required` | 具备独立触发、产物、状态、模板或 3 条以上子规则 | 同批创建 Skill 或写 PF / ISSUE |
| `docs-only` | 只影响说明、历史镜像或用户文档 | 同步公开文档，不做执行门禁 |
| `case-evidence-only` | 只能作为案例证据支持已有 Gate | 写报告/台账，不进入规范正文 |
| `project-local` | 只适合来源项目 | 回写来源项目台账或 Profile，不吸纳到 DevCodex 通用 |
| `already-covered` | 现有规范同等或更强覆盖 | 回写状态和证据，不重复实现 |

## 本批条件通用规范

下列规则只有在通过 `CommonNormGeneralizationGate` 与 `AbsorptionCandidateConsumerProofGate` 后才吸纳。若来源仍含项目私有残留，先抽象再实施。

| Gate | 通用触发 | 默认承接 |
|------|----------|----------|
| `ConfigCanonicalNamespaceGate` | 新增或迁移配置 schema、provider 选项、runtime 开关、legacy alias 或文档公开配置路径 | `dev-plan-review`、`test-router`、`technical-design.prompt`、validate |
| `ProfileRuntimeContractSyncGate` | Profile、runtime、部署副本或宿主适配契约变化 | `load-profile`、`document-sync`、`source-consumer-sync`、validate |
| `BehaviorSemanticDocsParityGate` | 文档语义承诺与运行时行为、CLI、Hook 或 public API 可能漂移 | `audit-document`、`audit-readme`、`report`、validate |
| `NegativeTranslationParityProbe` | 多语言、双语文档或术语翻译涉及否定词、反义词、禁用/启用、支持/不支持语义 | `dev-docs`、`audit-document`、`audit-readme`、validate |
| `DocsExampleTruthSurfaceGate` | README/website/示例/quick start 展示可执行路径或配置样例 | `user-manual-authoring`、`audit-readme`、`test-router`、validate |
| `CallbackExampleScopeProbe` | 示例包含 callback / hook / event / transaction / handler / ctx 等运行时回调 | `dev-docs`、`audit-readme`、`user-manual-authoring`、validate |
| `ExpertOutputQualityGate` / `ProductionRecommendedPathGate` / `FrameworkNativeCapabilityFirstGate` | 代码、文档、示例、fixture、技术方案或报告被用户指出“不专业 / 像初级 / 示例误导”，或需要区分生产推荐路径、框架原生能力和反模式 | `expert-output-quality`、`dev-plan-review`、`dev-docs`、`audit-*`、`test-router`、`report`、validate |
| `ExpertOwnerSkillGate` | 可泛化策略需要产品、体验、架构、运行、安全质量、增长商业、分布式系统、性能、隐私合规或 AI 评测专业 Owner 承接 | 21 个专家 Owner Skill；新增 `distributed-systems-architecture`、`performance-engineering`、`privacy-compliance-architecture`、`ai-evaluation-engineering`，分别承接 `DistributedSystemsArchitectureGate`、`PerformanceEngineeringGate`、`PrivacyComplianceArchitectureGate`、`AiEvaluationEngineeringGate`；增长 / 商业为 P3 条件触发；同步 `dev-plan-review`、`test-router`、`report`、validate |
| `MemoryCannotSatisfyBootstrapGate` | 宿主 Memories、模型长期偏好、resume / summary 恢复、compact 后继续、跨项目切换或用户询问是否可用记忆替代文件读取 | `load-profile`、`memory`、`test-router`、`report`、`spec-governance`、README / website / Profile、validate V86 |
| `DerivedConsumerIsolationGate` | 生成物、部署副本、历史镜像或派生产物可能被误当真相源 | `source-consumer-sync`、`document-sync`、`release-verification` |

V85 兼容锚点：21 个 Owner 的既有集合必须继续包含 `product-strategy`、`developer-experience-architecture`、`ux-interaction-architecture`、`frontend-architecture`、`backend-domain-architecture`、`production-readiness-sre`、`api-contract-architecture`、`external-integration-architecture`、`platform-ecosystem-architecture`、`ai-agent-system-architecture`、`data-architecture`、`security-threat-modeling`、`quality-strategy`、`design-system-architecture`、`accessibility-i18n`、`growth-analytics`、`business-model-review`；新增四个专业 Owner 是增量承接，不替换既有 Owner。
| `DerivedMetricConsumerProbe` / `DerivedConsumerFailureInjectionProbe` | 默认行为、控制流、能力触发或副通道输出可能影响统计、日志、事件、warning、admin bridge、public types 或主结果隔离 | `audit-project`、`dev-testing`、`test-router`、`report` |
| `FeatureInventoryProfileGate` / `FeatureChecklistEvidenceMatrixGate` | 功能清单、Profile、需求维度、复审清单或验收矩阵需互相闭环 | `review-checklist`、`audit-requirements`、`report` |
| `BatchEvidenceLedgerStateGate` / `BatchProgressCardGate` | 多批次、矩阵验证、长链路吸纳、复审或发布前检查需要冻结证据台账和进度卡 | `review-checklist`、`implementation-progress.prompt`、`report`、memory |
| `DependencyAuditScopeClassificationGate` | 依赖、包工程、coverage/audit/CI 门禁或发布前依赖风险需分类 | `test-router`、`audit-release`、`release-verification` |
| `ReworkReductionValueGate` / `ReworkEffectivenessLoop` | 规范、Skill、Prompt 或 Probe 候选声称降低返工、减少复审逃逸或提升首次通过率 | `rework-prevention-engineering`、`evolution-governance`、`skill-lifecycle-governance`、`test-router`、`report` |

### A1~A10 最新吸纳执行包（LatestAbsorptionExecutionPack）

当扫描报告或用户确认清单把 A1~A10 作为同批吸纳范围时，必须按以下分层同步，不得停留在本表：

- `A1 ConfigCanonicalNamespaceGate`：配置路径优先使用既有 namespace / canonical contract；顶层配置或 legacy alias 只能带兼容说明、迁移理由和验证探针。
- `A2 ProfileRuntimeContractSyncGate`：默认行为、runtime contract、transaction/cache/sync promise 或用户可见配置语义变化时，同步 Profile、README/website、进度和 `ProfileImpactCheck`。
- `A3/A4 BehaviorSemanticDocsParityGate` + `NegativeTranslationParityProbe`：行为语义变化后建立同义/反义/否定词承诺矩阵，覆盖中英文、历史 API、comparison、scenario、README、index 与 generated search。
- `A5/A6 DocsExampleTruthSurfaceGate` + `CallbackExampleScopeProbe`：示例中的 option/config/method/callback 必须能在 public types、runtime dispatcher 或最小执行探针中找到证据。
- `A7 DerivedMetricConsumerProbe` + `DerivedConsumerFailureInjectionProbe`：派生消费者和副通道失败必须验证，不得让统计、日志、events、warnings、admin bridge 或 public types 污染主结果。
- `A8 FeatureInventoryProfileGate` + `FeatureChecklistEvidenceMatrixGate`：公开包、SDK、CLI、多模块、文档站或 public API 需要稳定功能清单，并把 capability group 绑定到证据面。
- `A9/A10 BatchEvidenceLedgerStateGate` + `BatchProgressCardGate`：多批次验证冻结 EvidenceLedger，报告和最终回复区分 baseline-confirmed、executed-passed、partial、failed、not-started，并输出总范围、已完成、当前批、下一步、剩余项、阻塞和证据链接。

## 输出产物

### 候选矩阵

```markdown
| candidateId | sourceNamespace | rawSummary | backlogClass | commonDecision | targetOwner | layerChecks | validationRoute | skipReason |
|-------------|-----------------|------------|---------------|----------------|-------------|-------------|-----------------|------------|
```

### 最终确认清单

只列 `commonDecision=absorb` 且尚未完整吸纳的项：

```markdown
| ID | 待吸纳规范 | 通用价值证据 | 目标层级 | 目标 owner | 验证路线 |
|----|------------|--------------|----------|------------|----------|
```

### 实施报告字段

报告至少包含：

- `WorkspaceDataAbsorptionScopeGate` 扫描范围。
- `ProjectArtifactScaleRoutingGate` 的项目/root、六项规模指标、决策、排除策略、batch/checkpoint 与 invalid-run 证据。
- `Backlog Intake` 分类与范围缩减。
- `CommonNormGeneralizationGate` 与 `AbsorptionCandidateConsumerProofGate` 证据。
- `LayeredAbsorptionDecision` 与 `SkillAbsorptionDecision`。
- `ReworkReductionValueGate` 的问题簇、阶段前移、owner、成功指标、试运行、成本和 rollback/sunset；未触发写 `N/A + skipReason`。
- `ConceptSyncMap` 或同步消费者清单。
- targeted test / `node scripts/validate.js` / `npm test` 结果。
- 台账状态回写与 active-root 归属。

## 验证路线

规范吸纳实施完成后至少执行：

1. `node scripts/test-spec-governance.js`
2. `node scripts/validate.js`
3. 高风险控制面或 Skill/部署副本变化时执行项目 `npm test`
4. 若改 README / website / changelog / Profile，执行引用扫描和 V19 资产计数校验
5. 若改部署副本，执行 `devcodex update` 或项目规定的同步命令，并再次运行 validate

验证失败时先修复，再更新复审清单状态；不得只在报告中写“后续处理”。
