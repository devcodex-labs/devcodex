---
name: skill-lifecycle-governance
description: Skill 生命周期治理 Owner — 当任务涉及 Skill 组合、重叠冲突、依赖关系、误触发/漏触发、active/gray/deprecated/retired 状态、合并拆分、废弃退役、质量指标或自我进化后的 Skill portfolio 健康度时使用。
---

# Skill Lifecycle Governance

## 职责

维护 Skill portfolio 的可发现性、组合质量、状态演进与退役证据。授权、候选生成和 active 发布仍由 `evolution-governance` 负责；本 Skill 不允许绕过人工采纳或发布审批。

## SkillPortfolioLifecycleGate

每个 Skill 在 `SkillPortfolioIndex` 中记录：`name / owner / triggers / ownedArtifacts / consumers / dependencies / conflicts / validationProfile / lifecycleState / version / lastEvidenceAt`。

合法状态：`draft → gray → active → deprecated → retired`，另允许 `gray→draft`、`active→gray` 和任意非 retired 状态进入 `blocked`。禁止 `draft→active`、`active→retired` 或 retired 静默恢复。

DevCodex 源仓的机器可读实例是 `skills/portfolio.json`（schema v2）：由 `scripts/generate-skill-portfolio.js` 从 `skills/*/SKILL.md`、`plugin.json` 与 `skills/portfolio-evidence.json` 确定性生成，`--check` 只比较、不改生命周期。严格 `dependencies` 只承载显式依赖声明；普通 Markdown 关系进入 `referenceGraph`，避免把互相说明误报成依赖环。

### SkillIndexV2 与 BundleDecisionV1

每个 portfolio entry 必须包含保守的 `skillIndex` 投影：`id/type/workflow/phase/domains/triggers/requires/conflictsWith/priority/visibility/maxTokens/fixtures/evolvableUnitRef/probeSuiteRefs/exitCondition/evidenceState`。没有直接事实时使用空数组、`maxTokens=null` 或 `evidenceState=unverified`，禁止凭结构证据编造 workflow/phase/token budget。

`buildBundleDecision` 只读消费 candidate IDs、当前 lifecycle、显式冲突和可选 `maxSkills`，输出 `selected/ignored/conflicts/budget/exitCondition`。ignored reason 固定为 `unknown/inactive/conflict/budget`；该决策不得写 portfolio、修改 `plugin.json` 或自动把 gray/draft 晋级 active。

### 激活条件

- 有明确自然语言触发和独立 Owner。
- 至少一个 current consumer、正向 fixture、负向 fixture 和回滚计划。
- 依赖图无循环，冲突/优先级决策可解释。
- 已通过 `evolution-governance` 授权与 LayeredAbsorptionDecision。
- 声称降低返工或补齐复审逃逸时，已执行 `ReworkReductionValueGate`；新 Skill 先进入 gray，只有 `ReworkEffectivenessLoop` 的前瞻证据达到样本门槛后才可申请 active。

### 退役条件

- deprecated 已给迁移窗口、替代 Skill 和消费者清单。
- 当前消费者为 0，部署副本、routing、plugin、Prompt 和文档引用已清扫。
- 保留 `RetirementEvidence`，不得删除历史审计证据。

## 核心门禁

| Gate | 要求 |
|---|---|
| NoOrphanActiveSkill | active Skill 必须有 owner、consumer、fixture、source path 和 hash/version |
| NoUnboundedSkillGrowth | 长期未命中、误触发高、重复 Owner 或无消费者项进入 merge/deprecate review |
| SkillDependencyGraphGate | 依赖方向、循环、互斥、组合顺序和预算可验证 |
| TriggerQualityGate | 记录 precision、falsePositiveRate、falseNegativeRate、manualCorrectionRate |
| SkillConflictDecisionGate | 冲突时记录 selected/ignored、priority、budget、理由和 fallback |
| SkillDeprecationMigrationGate | 替代项、迁移消费者、观察窗、rollback、retire 条件完整 |
| ReworkEffectivenessPromotionGate | 返工治理 Skill 的 baseline、prospective trials、效果、误报/开销和 rollback/sunset 完整；只有历史案例或文本 grep 时保持 gray / insufficient-evidence |

## 执行流程

1. 建立或刷新 `SkillPortfolioIndex` 与 `SkillDependencyGraph`。
2. 按触发样本统计命中、误触发、漏触发和人工纠偏。
3. 将问题分类为 `keep / tune-trigger / split / merge / gray / deprecate / retire / blocked`。
4. 形成 `LifecycleChangeSet`，列 affectedUnits、consumer delta、dependency delta、risk、validation、rollout、rollback。
5. 由 `evolution-governance` 校验授权；active/release 前执行 full validation 和人工审批。
6. 返工治理 Skill 追加前瞻试运行；普通晋级至少覆盖 3 个可比 WorkUnit 或 2 个独立上下文，P0/P1 紧急启用也必须补后验观察窗。
7. 更新 `TriggerQualityScorecard`、`ConflictDecision`、`DeprecationPlan` 或 `RetirementEvidence`。

## 健康指标

至少跟踪：`skillTriggerPrecision`、`falsePositiveRate`、`falseNegativeRate`、`ruleReuseCount`、`orphanUnitCount`、`deprecatedAge`、`rollbackRate`、`instructionBudgetP95`、`manualCorrectionRate`、`repeatedIssueRate`；返工治理 Skill 追加 FirstPassYield、WorkUnitReworkRate、RepeatEscapeRate、PreventionHitRate 和 lateDiscoveryCost。

指标只用于发现候选，不得单独触发 active mutation；低样本量必须标记 `insufficient-evidence`。

## 输出字段

`portfolioIndex`、`dependencyGraph`、`lifecycleChangeSet`、`triggerQualityScorecard`、`conflictDecision`、`deprecationPlan`、`retirementEvidence`、`authorizationEvidence`、`validationRoute`、`rollbackPlan`。

## 反模式

- 以 Skill 数量增长作为自我进化成功指标。
- 有相似 Skill 就直接合并，不核对触发、产物和消费者。
- active Skill 无 owner/fixture/consumer，或 deprecated 永不退役。
- 用模型建议、单次命中、历史问题数量或文本 grep 直接改变 lifecycle state。
- 删除 retired Skill 的审计、迁移和回滚证据。

## 验证

至少覆盖：完整 active、orphan active、循环依赖、draft 直跳 active、active 直退役、误触发超阈值、deprecated 无迁移、gray rollback、retired 引用残留和低样本指标不得自动决策。

源仓最小命令：`node scripts/generate-skill-portfolio.js --check` + `node scripts/test-skill-portfolio.js`。静态消费者和注册事实可以证明集合/引用完整，但 precision、false positive/negative 与人工纠偏率没有真实样本时必须保持 `insufficient-evidence`；SkillIndex `source-backed` 也不能替代触发 precision 的真实测量。
