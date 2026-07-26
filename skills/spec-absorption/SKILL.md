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

## BaseImpactAssessmentV1 / ComplexityDeltaBudgetV1

新增或晋级规范、Skill、Prompt、流程、验证器或部署消费者时，必须把基座影响作为吸纳决策的子记录，而不是另建平行“基座治理”入口。最小字段：

`changeId / servedIntent / currentGap / absorptionDecision / baseClass(base-neutral|base-compatible|base-changing) / affectedContracts / unaffectedIntents / consumers / fanout / defaultPathDelta / fallbackBehavior / migration / rollback / positiveProbe / negativeProbe / disabledOrMisconfiguredProbe / complexityDelta / replacementOrRetirementCredit / owner / reviewAt / deprecationAndDeletionCondition`。

判定规则：

- `base-neutral`：不改变常驻路径、默认 Context、强制阶段、用户确认数、公共契约或未命中任务；仍需至少一个真实消费者和 `UnaffectedIntentRegression`。
- `base-compatible`：改变局部消费者或验证路线，但默认行为、fallback 与未受影响意图保持兼容；必须有正向、负向和 disabled/misconfigured 探针。
- `base-changing`：改变事实基座、always-on 路径、公共契约或默认强制行为；必须单独确认、写迁移/回滚和全面复审，不能由普通 auto 授权夹带通过。
- 缺真实消费者、缺回滚、缺退役/删除条件、缺 `ComplexityDeltaBudgetV1` 或没有 `replacementOrRetirementCredit` 抵消维护成本时，不得进入 active。

`UnaffectedIntentRegression` 至少覆盖一个普通 chat / 普通 dev / 低风险 fix 或其他未命中意图样本，证明新增能力不会让无关任务增加默认读取、默认确认、默认产物或默认验证成本。

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

当候选会新增或改变 Rule/Skill、Prompt、MCP Resource/Resource Template/Tool、Task 增强 Tool、CLI 或 Hook 能力面时，`LayeredAbsorptionDecision` 只负责判定吸纳层级，不得顺带决定能力面。实施前必须消费由 `spec-governance` 的 `CapabilitySurfaceDecisionGate` 生成且通过新鲜度校验的 `decisionRef`；只有 `spec-governance` 可写 canonical decision，目标 Skill 仅保存本域触发、Owner、消费者和 `decisionRef` 等本地元数据。缺少 decision、identity 失效或状态为 `stale/blocked` 时停止能力资产创建并回到中央判定。

| classification | 使用条件 | 处理 |
|----------------|----------|------|
| `global-invariant` | 安全底线、入口加载、全模式硬约束、优先级 | 通用 instructions 保留正文，目标 Skill 引用 |
| `existing-skill-subgate` | 有明确既有 Skill owner | 并入 Skill 子门禁，同步消费者和探针 |
| `new-skill-required` | 具备独立触发、产物、状态、模板或 3 条以上子规则 | 同批创建 Skill 或写 PF / ISSUE |
| `docs-only` | 只影响说明、历史镜像或用户文档 | 同步公开文档，不做执行门禁 |
| `case-evidence-only` | 只能作为案例证据支持已有 Gate | 写报告/台账，不进入规范正文 |
| `project-local` | 只适合来源项目 | 回写来源项目台账或 Profile，不吸纳到 DevCodex 通用 |
| `already-covered` | 现有规范同等或更强覆盖 | 回写状态和证据，不重复实现 |

## 条件通用规范的 registry 消费

候选通过 `CommonNormGeneralizationGate` 与 `AbsorptionCandidateConsumerProofGate` 后，不在本 Skill 维护版本批次或 Gate 总表。执行方必须读取 `../spec-governance/gate-registry.json`，按候选所属 `gateGroup` 获取触发条件、Owner Skill、证据要求、消费者与兼容锚点；来源仍含项目私有残留时先抽象再实施。

| 候选域 | registry 分组 | 主要承接面 |
|--------|---------------|------------|
| 配置、Profile、宿主与路由 | `profile-service`、`absorption-layering` | Profile/runtime 真相、部署副本与分层决策 |
| 行为语义、文档与示例 | `docs-semantics-examples`、`docs-audience-render` | Owner Skill、用户文档消费者与真实性探针 |
| 派生消费者、失败隔离与副通道 | `derived-consumer-runtime`、`frontend-runtime` | 运行时隔离、故障注入与 TestRoute |
| 功能清单、批次证据与返工闭环 | `feature-inventory-batch-evidence`、`rework-governance` | EvidenceLedger、进度卡与有效性验证 |

历史 A1~A10 名称只作为 registry 的 `legacyAnchors` 兼容检索入口，不再复制执行正文。新增或调整 Gate 必须先更新结构化 registry 与目标 Owner，再同步 Prompt、执行消费者、验证探针、公开文档和部署副本；若任一层不适用，记录 `skipReason`。

## 输出产物

### AbsorptionCandidateMatrixV1

当扫描结果准备进入确认清单或实施批次时，必须先形成 `AbsorptionCandidateMatrixV1`，字段以 `absorption-candidate-matrix.v1.schema.json` 为准。矩阵至少包含：

| 字段 | 说明 |
|------|------|
| `candidateId` | PI / PF / GAP / ISSUE / 用户确认项编号 |
| `sourceNamespace` | 来源 active-root 或 workspace data namespace |
| `backlogClass` | `pure-open / residual-tail / already-fixed / misclassified` |
| `commonDecision` | `absorb / case-evidence-only / project-local / docs-only / already-covered / reject / defer` |
| `targetOwner` | 真实执行 owner，吸纳项缺失 owner 时阻断 |
| `layerChecks` | `commonInstruction / skill / promptTemplate / executionConsumer / validationProbe / publicDocs / deployCopy` |
| `validationRoute` | 生产验证入口，不得只写“人工复审” |
| `prevention` | 涉及防复发时记录根因、控制失效、负向样本与 rollback/sunset |

维护者可用只读 planner 生成分层计划：

```bash
node scripts/plan-absorption-candidates.js --input <matrix.json>
node scripts/plan-absorption-candidates.js --self-test
```

该 planner 只读取输入并向 stdout 输出 `AbsorptionCandidatePlanV1`；禁止写台账、修改 data、自动关闭 PI/PF 或隐式更新规范源。缺 `targetOwner`、非 `pure-open` 却试图吸纳、任一必需 layer blocked 或矩阵 schema 无效时，计划必须停在 blocked/invalid。

### LayeredAbsorptionDecisionV1

每个进入实施的候选必须产出 `LayeredAbsorptionDecisionV1`，字段以 `layered-absorption-decision.v1.schema.json` 为准。该决策用于把自由文本 finding 固定到目标层级和消费者，而不是用报告段落替代执行证据。

| status | 进入条件 | 后续 |
|--------|----------|------|
| `ready` | `backlogClass=pure-open`、`commonDecision=absorb`、owner/layer/test/docs/deploy 证据齐全 | 进入实施 |
| `blocked` | owner 缺失、layer blocked、验证路线缺失或 schema 无效 | 修正矩阵或回 CP |
| `skipped` | `project-local / already-covered / docs-only / case-evidence-only / reject / defer` | 回写 skipReason，不改通用规范 |

防复发闭环只允许声明当前关闭证据；长期有效性必须进入 `repair-prevention-assessment` 的 prospective plan。禁止把本轮 planner self-test 通过写成长期 prevention 已有效。

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

规范吸纳实施完成后至少执行（**MeasuredVerificationStandard**：宣称通过须记录生产入口命令与 exitCode；隔离 harness 不得冒充 V# 成败）：

1. `node scripts/test-spec-governance.js`
2. `node scripts/validate.js` 或 `npm run test:core`（含 V84 `ExpertOutputQualityGate` / expert-output-quality 同步时）
3. 高风险控制面或 Skill/部署副本变化时执行项目 `npm test`
4. 若改 README / website / changelog / Profile，执行引用扫描和 V19 资产计数校验
5. 若改用户级全局部署副本，执行 `devcodex global-adapters apply`（源码）或 `npm install -g .` / pack+tarball / `npm update -g`（按安装来源）；workspace 运行态才用 bare `devcodex update`。然后再次运行 validate
6. 命中示例/文档/fixture 专家质量时叠加 `expert-output-quality` Owner 与 gate-registry `expert-output-quality`

验证失败时先修复，再更新复审清单状态；不得只在报告中写“后续处理”。
