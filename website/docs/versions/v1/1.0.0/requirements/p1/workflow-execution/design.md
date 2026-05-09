# ⑧ 工作流执行 — 技术方案

> **需求来源**：[⑧ 工作流执行 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

工作流执行以 `instructions/10-dev.instructions.md` ~ `14-self-fix.instructions.md` 作为主规则面，子类型 Skill 提供细化标准；Agent 文件只保留入口包装，不再承载各工作流完整执行章节。

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
- 只读，多轮收敛（连续 3 轮零发现）
- 6 种目标类型对应不同 Skill
- 用户面问题清单与建议也必须附三列验证（合理性 / 可实施性 / 收益）

### analyze 工作流
- 只读，至少 3 轮分析，连续 2 轮无新发现后收敛；每条结论附三项验证，且三项验证必须在用户面结论中可见

### self-fix / resume / chat / plan
- 分别由对应 instruction / skill 组合定义，Agent 文件仅作为入口包装

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `instructions/10-dev.instructions.md` | dev 工作流规则 |
| `instructions/11-fix.instructions.md` | fix 工作流规则 |
| `instructions/12-audit.instructions.md` | audit 工作流规则 |
| `instructions/13-analyze.instructions.md` | analyze 工作流规则 |
| `instructions/14-self-fix.instructions.md` | self-fix 工作流规则 |
| `skills/dev-default/SKILL.md` | dev 默认子类型 |
| `skills/fix-default/SKILL.md` | fix 默认子类型 |
| `skills/cp-gate/SKILL.md` | CP 确认机制 |
| `skills/routing/SKILL.md` | 子类型 / 特殊路由参考 |

---

## 风险与约束

- dev/fix CP 必须按序执行（C02），不可跳过或合并
- 编码后必须运行 lint/typecheck/test（SC2）
- error 最多 2 次迭代，仍失败则停止标 ⚠️
- fix 三步扫描不可省略（SC3）
