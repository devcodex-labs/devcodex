---
name: rework-prevention-engineering
description: 返工预防工程 Owner — 当任务涉及返工率、一次通过率、反复返修、复审持续出现新问题、重复逃逸、whyMissed 复发、预防措施有效性或希望把问题发现前移时使用；要求区分返工与需求变化，建立可比较基线，并用后续任务的前瞻证据验证控制是否有效。
---

# Rework Prevention Engineering

## 职责

把“复审后继续修问题”升级为可定义、可前移、可度量、可回滚的返工预防工程。不得用增加复审轮数、隐藏 finding、延迟完成声明或把返工改名为计划迭代制造指标改善。

## ReworkPreventionGate

### WorkUnit 与事件分类

先冻结 `WorkUnit`：必须锚定已确认需求/问题、ExecutionContract batch、目标门禁和可比较任务类型。只有同时满足以下条件才记录 `ReworkEvent`：

- 问题属于原确认范围和当时可获得的项目事实；
- 对应工作已通过目标阶段或被宣称完成；
- 为解决问题需要重新分析、设计、修改、验证或交付。

事件分类必须为：`rework / scope-change / external-change / planned-iteration / same-phase-catch`。后四类不得计入返工率，但要保留分类依据，禁止用重命名规避真实返工。

### 双根因

每个 ReworkEvent 同时记录：

| 字段 | 要求 |
|---|---|
| `defectRootCause` | 缺陷、遗漏或错误判断本身为什么发生 |
| `controlFailure` | 哪个需求、方案、实现、测试、复审或发布控制应拦截却没有拦截 |
| `escapedFrom` / `detectedAt` | 应发现阶段与真实发现阶段 |
| `whyMissed` | 范围、消费者、证据、探针、时序、权威源或执行偏差 |
| `clusterId` | 已知模式簇；新模式可先标 candidate |

### 前移控制

选择能在更早阶段阻断且总成本最低的控制层：`prompt / contract / checklist / static probe / unit fixture / integration replay / hook / tool`。已有规则仍复发时，单纯再加说明文字不是有效 prevention；必须评估能否物化为可执行消费者或确定性探针。

方案审查存在多个相互独立的潜在 blocker 时，优先采用 `BlockerAggregationGate`：同阶段继续安全独立检查、冻结完整 `BlockerSnapshot`、统一修正并全阶段重跑。首个红项即停止会把同批问题推迟到下一轮，属于返工放大控制；仅 `invalid-premise / destructive-side-effect / evidence-contamination` 可 fail-fast。

## 度量合同

- `FirstPassYield = 无 ReworkEvent 即 accepted 的可比较 WorkUnit / 全部可比较完成 WorkUnit`
- `WorkUnitReworkRate = 至少一个 ReworkEvent 的 WorkUnit / 全部可比较完成 WorkUnit`
- `ReworkEventDensity = ReworkEvent / WorkUnit`
- `RepeatEscapeRate = 已知 cluster 复发事件 / 全部 ReworkEvent`
- `PreventionHitRate = 在目标阶段前被控制拦截的已知风险机会 / 全部已知风险机会`
- `LateDiscoveryCost`：记录 requirement→plan→implementation→ECR→release→post-release 发现阶段；工时、Token、文件数只作可选成本证据。

指标必须按任务类型、复杂度和严重度分层；样本不足时输出 `insufficient-sample`，不得跨不可比较任务排名。

## ReworkRiskProfile

普通低风险任务使用轻量卡：`riskCluster / targetPhase / preventionControl / evidence / result`。以下任一条件升级完整模式：P0/P1、安全、控制面、公共契约、发布、多批次、角色交接、同簇累计 ≥3 个 finding/返修/逃逸，或历史 WorkUnitReworkRate 高于当前项目阈值。

完整模式必须产出：`ReworkEventLedger`、`EscapePatternCluster`、`PreventionControlSet`、`EffectivenessScorecard` 和 rollback/sunset 条件。

## 与 active RepairPreventionAssessmentGate 的关系

所有 repair task 在 `accepted` 前先执行 active [`repair-prevention-assessment`](../repair-prevention-assessment/SKILL.md) 的 `RepairPreventionAssessmentGate`。机器结构以 active Owner 的 [`repair-prevention-assessment.schema.json`](../repair-prevention-assessment/repair-prevention-assessment.schema.json) 为准，确定性判定仍由 `scripts/lib/repair-prevention-assessment.js` 承担。本 gray Skill 只消费 assessment 结果来建立返工簇和前瞻效果试验；不得成为 active workflow 的 mandatory dependency。本目录的同名 schema 仅作既有包路径兼容镜像，必须与 canonical schema 字节一致。

本 Gate 同时给出两个互不替代的结论：

- `immediateClosureEvidence` 只证明当前问题已修复，可允许当前 repair 关闭；
- `prospectiveEvidencePlan` 只证明长期控制的试验/效果状态。当前事件重跑通过一律是 `retrospective-only`，不得把 provisional control 晋级为 active/effective。

### 决策与升级摘要

以下为 gray 效果工程消费 assessment 时需要的生命周期摘要；字段真相与阻断语义以 active Owner 为准。

| `preventionDecision` | 使用条件 | 生命周期 |
|---|---|---|
| `existing-control-restored` | 已有有效控制因执行/接线偏差未生效，本次恢复其消费者或执行链 | 保持既有 active；不得用当前重跑重新证明效果 |
| `new-control-provisional` | 新增或实质改变 prompt/contract/checklist/probe/test/hook/tool 控制 | `draft/gray`；达到前瞻样本门槛后才可申请 active |
| `no-new-control` | 已有控制已足够、一次性不可泛化、成本高于风险或不存在更早发现点 | 必须选择标准 reason 并给独立证据；不能用“已修复”作理由 |
| `emergency-active` | P0/安全/控制面高危问题需要先启用控制 | `active-expiring`；必须有明确授权、前瞻补证、回滚触发和 reviewAt |

低/普通风险首次 repair 可用 `mode=light`，但 schema 的双根因、回归 seed、负向 case、当前关闭证据和 rollback/sunset 仍不可缺。P0/P1、安全、控制面、公共契约、发布、多批次、角色交接、high/critical 或 repeat escape 必须 `mode=full`，追加 `whyMissed / authorizationEvidence / independentReReviewPlan`。

重复逃逸不得选择 `no-new-control` 或只恢复原说明文案；必须升级 `new-control-provisional`，紧急场景才允许 `emergency-active`。全模式下 regression seeds、negative cases、Owner、consumers 和 rollback/sunset 任何一项缺失，都不得把 repair collaboration contract 转为 `accepted`。

## ReworkEffectivenessLoop

1. 建立 baselineWindow 和可比较 WorkUnit 边界。
2. 分类事件并完成双根因。
3. 选择目标前移阶段和最小有效控制。
4. 将控制注册到明确 owner/consumer/probe。
5. 在后续可比较任务中收集 prospective evidence。
6. 同时记录命中、漏拦、误报、额外成本和晚发现阶段变化。
7. 达标则建议 gray→active；无改善、误报高或成本过大则调整、回滚或退役。

同一个事件的“修复后重跑通过”只能证明本事件关闭，不能证明 prevention 有效。普通候选至少需要 3 个可比较 WorkUnit 或 2 个独立任务/项目上下文的前瞻证据；P0 安全/控制面可先紧急启用，但必须补后验效果复证。

发布候选因普通 working diff 未覆盖 untracked 文件而逃逸时，将 `CandidateDiffCompletenessGate` 作为 gray prevention：`defectRootCause` 记录文件缺陷，`controlFailure` 记录候选证据范围错误，`escapedFrom` 与 `detectedAt` 分离；当前事件的 staged rerun 仅关闭本事件，后续可比较发布 WorkUnit 才能形成 prospective effectiveness evidence。

### Turn Liveness Prevention Trial

`long-task-silent-orphaned-turn` 簇以 `OrphanInProgressCount / MeanStaleDetectionTime / RecoverySuccessRate / FalseStallRate / DuplicateMutationRate / UserWaitWithoutFeedback` 为效果指标。控制层由 `ai-agent-system-architecture` 的 `TurnLivenessRecoveryGate`、Hook replay 和可选 gray sidecar 组成；当前停滞案例修复通过只关闭本 WorkUnit，不能证明防复发有效。

sidecar 晋级至少需要 5 个可比较长任务 WorkUnit，包含 2 个真实长工具和 2 个故障注入样例，并记录误报、额外状态 I/O 和恢复成本。误报超过项目预算、重复 mutation 非零或宿主边界不清时，回退为提示-only/one-shot，保留 checkpoint 和 terminal invariant。

## 生命周期与授权

新控制按 `draft → gray → active` 管理，复用 `skill-lifecycle-governance`；规范候选与自动化复用 `evolution-governance` 的 candidate-only 授权。返工率目标不得授权 AI 自动修改 active 规范、源码、数据或发布面。

## 与其他 Skill 的关系

- `review-checklist` / `audit-common`：提供 coverage 与 escape evidence。
- `quality-strategy` / `test-router`：选择风险驱动验证组合。
- `evolution-governance`：管理候选、gray 试点、升级、回滚和授权。
- `spec-absorption`：执行 ReworkReductionValueGate 与消费者证明。
- `brand-visual-quality`：提供品牌资产 WorkUnit、`VisualBlockerResetRecord`、复发和人工修正数据；当前资产修复通过只关闭该 WorkUnit，仍需后续可比较样本才能证明返工预防有效。
- `ai-agent-system-architecture` / `host-contract-verification`：提供 Turn Liveness 状态、能力边界和 direct replay；返工 Skill 只拥有前瞻效果评估，不复制运行时状态机。
- `report`：输出 baseline、事件分类、效果和剩余风险。
- `execution-contract` / `fix-default` / `fix-security`：所有 repair 的 accepted 前入口；只引用 active `repair-prevention-assessment` Owner 的 assessment result，本 gray Gate 不拥有完成判定。
- `review-checklist` / `test-router`：分别核对 assessment 完整性和 immediate/prospective 两条证据路线，不重定义生命周期阈值。

## 反模式

- 把用户新增需求、外部变化或同阶段主动发现计为返工。
- 用复审次数或最终零 finding 单独证明返工下降。
- 用当前事件修复后的通过结果冒充前瞻效果。
- 为降低指标而减少审查、隐藏 finding、延迟 accepted 或扩大 planned-iteration。
- 已有规则复发时继续堆 instructions 文案，却不补执行消费者或探针。
- 把 `no-new-control` 当作免填项，或用当前修复测试通过证明长期 prevention 已有效。
