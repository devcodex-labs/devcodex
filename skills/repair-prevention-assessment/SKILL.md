---
name: repair-prevention-assessment
description: 修复防复发完成门禁 Owner — 任何 fix、self-fix 或 dev 中的 repair 切片在 accepted 前使用；形成可机器验证的 RepairPreventionAssessmentV1，分离当前关闭证据与长期前瞻有效性，避免 active 工作流依赖未部署的 gray 能力。
---

# Repair Prevention Assessment

## 职责

本 Skill 是所有 repair task 的稳定、默认部署完成门禁，唯一拥有 `RepairPreventionAssessmentGate` 与 `RepairPreventionAssessmentV1`。它判断当前问题能否关闭，并要求为长期控制给出诚实的前瞻计划；不负责计算返工率、验证控制长期有效或自动晋级候选，这些试验性职责归 gray `rework-prevention-engineering`。

机器结构以 [`repair-prevention-assessment.schema.json`](repair-prevention-assessment.schema.json) 为准，确定性判定以 `scripts/lib/repair-prevention-assessment.js` 为准。其他 Skill、Prompt、报告与清单只能引用本 Owner，不复制字段定义。

## RepairPreventionAssessmentGate

任何 repair——包括 fix、dev 中的修复切片、self-fix、审查 finding 修复与发布阻断修复——在 `accepted` 前必须形成有效 `RepairPreventionAssessmentV1`。当前修复重跑只允许进入 `immediateClosureEvidence`，不得写成长期 prevention 已有效。

### 双根因与证据

| 字段 | 要求 |
|---|---|
| `defectRootCause` | 缺陷、遗漏或错误判断本身为什么发生 |
| `controlFailure` | 哪个需求、方案、实现、测试、复审或发布控制应拦截却未拦截 |
| `escapedFrom / detectedAt` | 应发现阶段与真实发现阶段 |
| `regressionSeeds / negativeCases` | 当前回归输入与能证明控制边界的负例 |
| `controlOwner / consumers` | 控制真相源、执行消费者与验证消费者 |
| `immediateClosureEvidence` | 当前 repair 的 fresh 关闭证据 |
| `prospectiveEvidencePlan` | 后续可比较 WorkUnit、独立上下文、指标防作弊与回滚准备 |
| `rollbackOrSunset` | 误报、成本或无效时的回退与退役条件 |

### 风险模式

- 低/普通风险首次 repair 可使用 `mode=light`，但双根因、回归 seed、负例、当前关闭证据与 rollback/sunset 仍不可缺。
- P0/P1、安全、控制面、公共契约、发布、多批次、角色交接、`high/critical` 或 repeat escape 必须 `mode=full`，追加 `whyMissed / authorizationEvidence / independentReReviewPlan`。
- repeat escape 不得选择 `no-new-control` 或只恢复说明文案；必须使用 `new-control-provisional`，紧急高风险才允许 `emergency-active`。

### preventionDecision

| 决策 | 使用条件 | 生命周期结论 |
|---|---|---|
| `existing-control-restored` | 已有 active 控制因接线或执行偏差未生效 | 保持既有控制；本次重跑不重新证明效果 |
| `new-control-provisional` | 新增或实质修改 prompt/contract/checklist/probe/test/hook/tool | 新控制保持 gray/provisional，等待前瞻证据 |
| `no-new-control` | 已有控制足够、一次性不可泛化、成本高于风险或无更早发现点 | 必须使用标准 reason 与独立 evidence |
| `emergency-active` | P0、安全或高风险控制面必须先阻断 | `active-expiring`；必须有明确授权、补证与回退 |

`prospectiveEvidencePlan.status=sufficient` 只有在不少于 3 个可比 WorkUnit 或 2 个独立上下文、`metricGaming=false` 且 `rollbackReady=true` 时有效。当前事件唯一重跑必须保持 `retrospective-only`。

## 与 gray 返工工程的边界

- 本 Skill 始终处理“当前 repair 能否 accepted”，属于 active correctness gate。
- 只有用户或任务涉及返工率、一次通过率、重复逃逸簇、whyMissed 复发、PreventionHitRate 或长期效果判定时，才额外选择 gray `rework-prevention-engineering`。
- active workflow 不得把 gray Skill 作为 mandatory dependency。gray 不可用时，本 Skill 仍须完整执行，不允许跳过 assessment。

## 验证与失败语义

最小验证：`node scripts/test-repair-prevention-assessment.js`，并由 V94、review checklist、report 与默认安装 replay 复证。以下任一情况阻断 accepted：

- assessment 缺失、schema/identity 无效或风险模式不足；
- immediate closure 与 prospective evidence 混写；
- repeat escape 继续使用旧说明文字或无理由 `no-new-control`；
- active consumer 强依赖默认不部署的 gray Skill；
- mandatory Skill 未进入默认部署面；
- rollback/sunset 或独立复审计划缺失。

## 反模式

- 用“测试通过”同时证明当前修复与长期有效。
- 为降低返工指标而隐藏 finding、缩小 WorkUnit 或把返工改名为计划迭代。
- 把所有低风险 repair 扩大为完整事故报告。
- 为避免生命周期拆分而无证据晋级 gray Skill。
