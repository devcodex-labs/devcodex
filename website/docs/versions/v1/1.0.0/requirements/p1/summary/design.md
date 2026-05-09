# ③ 写入摘要 — 技术方案

> **需求来源**：[③ 写入摘要 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

写入摘要由 `skills/summary/SKILL.md` 与 `15-memory.instructions.md` 共同定义，在安全底线未触发致命终止时立即执行。

---

## 核心设计

按当前规则定义：
1. 确定日期 + 定位记忆日文件（`.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md`）
2. 确定会话编号（`## 会话 NN`，两位数递增）
3. 写入初始段落（时间 + 意图 + 状态 🔄）
4. 格式选择：chat/简单 → 紧凑 / dev/fix(≥3文件) → 完整

### 格式选择规则（来自 summary Skill）
| 场景 | 格式 |
|------|:----:|
| chat / 简单 analyze | 紧凑 |
| dev/fix（≤2 文件变更）| 紧凑 |
| dev/fix（≥3 文件变更）| 完整 |
| 多任务会话（≥3 任务）| 完整 |

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `skills/summary/SKILL.md` | 摘要写入逻辑（格式/字段/防护）|
| `instructions/15-memory.instructions.md` | 记忆触发规则与字段约束 |

---

## 风险与约束

- 禁止询问用户是否写入（C05/S05）
- 使用增量编辑追加，禁止覆盖已有内容（C06/S04）
- 禁止使用终端命令修改 .md 文件（C09）
