# ⑧ 工作流执行 — 技术方案

> **需求来源**：[⑧ 工作流执行 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

工作流执行通过 `devcodex.agent.md` 各工作流章节实现，每种工作流有独立的执行链和子类型 Skill。

---

## 核心设计

### dev 工作流
- 子类型路由：8 子类型（default/refactor/database/init/optimization/scenario-test/docs/plan-review）
- CP 流程：CP1 → CP2 → plan-review → impact-review（条件）→ CP3 → 执行
- 执行后：api-verification / document-sync / report / memory

### fix 工作流
- 子类型路由：3 子类型（default/incident/security）
- CP 流程：CP1 → CP2 → 执行 → 三步扫描 → CP3（条件）
- 修复三步必做：同类全局扫描 / 数据联动扫描 / grep 零残留复核

### audit 工作流
- 只读，多轮收敛（连续 N 轮无新发现）
- 6 种目标类型对应不同 Skill

### analyze 工作流
- 只读，单轮分析，每条结论附三项验证

### self-fix / resume / chat / plan
- 分别有独立执行逻辑，详见 `devcodex.agent.md` 各节

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `agents/devcodex.agent.md` dev~plan 各节 | 各工作流执行逻辑 |
| `instructions/10-dev.instructions.md` | dev 工作流规则 |
| `instructions/11-fix.instructions.md` | fix 工作流规则 |
| `instructions/12-audit.instructions.md` | audit 工作流规则 |
| `instructions/13-analyze.instructions.md` | analyze 工作流规则 |
| `instructions/14-self-fix.instructions.md` | self-fix 工作流规则 |
| `skills/dev-default/SKILL.md` | dev 默认子类型 |
| `skills/fix-default/SKILL.md` | fix 默认子类型 |
| `skills/cp-gate/SKILL.md` | CP 确认机制 |

---

## 风险与约束

- dev/fix CP 必须按序执行（C02），不可跳过或合并
- 编码后必须运行 lint/typecheck/test（SC2）
- error 最多 2 次迭代，仍失败则停止标 ⚠️
- fix 三步扫描不可省略（SC3）
