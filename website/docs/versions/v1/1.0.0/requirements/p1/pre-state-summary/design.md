# ⑤ 前置状态汇总 — 技术方案

> **需求来源**：[⑤ 前置状态汇总 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

前置状态汇总由 `17-compliance.instructions.md` 的 PC0~PC4 状态块承载，聚合预检查、Profile、记忆与产物落点信息，输出统一状态视图。

---

## 核心设计

按当前规则定义，汇总以下检查项：

| 检查项 | 来源 |
|--------|------|
| 规则基线 | ① 预检查 |
| 意图 + 子类型 | ① `intent` Skill |
| profile 状态 | ① `load-profile` Skill |
| 记忆状态 | ④ `memory` Skill |
| 产物落点 | ① `02-output-paths.instructions.md` |

本节点不产生新判断，仅做信息聚合与标注。

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `instructions/17-compliance.instructions.md` | PC0~PC4 状态块与预检查输出 |
| `instructions/15-memory.instructions.md` | 会话状态与未完成任务读取规则 |

---

## 风险与约束

- 仅聚合，不产生新的判断或决策
- 待补齐项必须在此阶段明确标注
