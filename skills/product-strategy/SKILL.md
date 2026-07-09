---
name: product-strategy
description: 产品策略专家 Owner — 当任务涉及需求价值、目标用户、范围取舍、优先级、路线图、成功指标、产品化文档或用户要求从产品专家角度审查时使用；要求把方案绑定用户问题、业务价值、阶段边界和可验证信号。
---

# Product Strategy Skill

## 定位

本 Skill 负责产品策略 Owner 视角。它不替代正式 PRD，而是在需求、方案、文档、功能拆分和复审中确保输出不只“能开发”，还回答“为什么做、给谁做、先做什么、怎样算成功、哪些先不做”。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 需求确认、功能范围、优先级、路线图、版本阶段、验收边界需要判断 | 必须 |
| 用户要求从产品、业务、用户价值或最终使用者角度审查 | 必须 |
| 技术方案会影响用户主路径、配置心智、文档站、README 或首次体验 | 必须 |
| 纯内部代码修复且不改变用户行为、范围或交付承诺 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `ProductStrategyOwnerGate` | 每个产品判断必须绑定目标用户、问题价值、范围边界和成功信号 | 需求源、用户消息、现有功能、竞品/同类证据或项目事实 |
| `TargetUserProblemGate` | 先定义目标用户和真实任务，再讨论功能形态 | targetUser、problemValue |
| `PriorityTradeoffGate` | 多个需求或方案冲突时必须说明优先级、放弃项和代价 | priorityTradeoff、scopeBoundary |
| `SuccessSignalGate` | 交付前定义可观察成功信号，避免只用“已实现”替代产品验收 | successSignals、acceptance |
| `PhaseClosureGate` | 多阶段需求必须写 entry / exit / carryOver / closeRule | phaseBoundary |

## 执行步骤

1. 识别目标用户、使用场景和用户当前痛点。
2. 将用户表达拆成主问题、次问题、非目标问题和隐含约束。
3. 对每个候选功能做价值、风险、实现成本和验证成本对比。
4. 给出本阶段范围边界：必须做、可延后、明确不做。
5. 定义成功信号和验收方式，至少覆盖用户任务、可用性、文档或数据证据。
6. 若进入技术方案或实施计划，确保每个需求维度都有 CP2、批次计划、验收和关闭规则。

## 输出字段

```markdown
## ProductStrategyOwnerGate

| 字段 | 内容 |
|------|------|
| targetUser | 目标用户 / 使用者 / 决策者 |
| problemValue | 要解决的问题和价值 |
| priorityTradeoff | 优先级、取舍、延期项和原因 |
| scopeBoundary | 本阶段纳入、排除、后续批次 |
| successSignals | 可观察成功信号和验收方式 |
| riskDecision | 产品风险、误解风险和缓解策略 |
| evidenceMatrix | 判断 -> 用户消息 / 项目事实 / 文档 / 数据 / 同类证据 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 把用户建议原样当需求，不判断是否泛化或是否与目标冲突 | 先做 `PriorityTradeoffGate`，给出采纳、降级或排除理由 |
| 技术方案只有模块和文件，没有用户成功信号 | 补 `successSignals` 和验收路径 |
| 多阶段需求只写“后续处理” | 写 entry / exit / carryOver / closeRule |
| 文档站或 README 只按开发者实现组织 | 先按最终用户任务和配置路径组织，再放维护者细节 |

## 与其他 Skill 的关系

- `expert-output-quality`：确保产品判断以专家口径表达，不停留在普通描述。
- `user-manual-authoring`：用户文档需从 targetUser 和 successSignals 推导章节。
- `review-checklist`：复审清单必须把 priority、phase closure 和 acceptance 物化为检查项。
- `dev-plan-review`：CP2 若缺产品范围或验收边界，应阻断进入实施。
