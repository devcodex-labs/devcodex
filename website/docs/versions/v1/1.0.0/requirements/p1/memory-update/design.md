# ⑪ 更新记忆 — 技术方案

> **需求来源**：[⑪ 更新记忆 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

更新记忆通过 `memory` Skill + `summary` Skill 配合实现三层记忆体系的持久化写入。

---

## 核心设计

按 `memory` Skill 和 `15-memory.instructions.md` 定义的写入时机：

| 时机 | 动作 |
|------|------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮交互 | 追加对话记录到 📨 字段 |
| 子任务完成 | 追加 `T{N}进度：✅` |
| 超 13 轮预警 | 写编码检查点（📦 字段）|
| 报告写入后 | 追加报告路径到 📄 |
| 任务结束 | 状态更新为 ✅ |

### 三层记忆体系
1. **Agent 日记**：`.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md`（每会话必写）
2. **Agent SUMMARY**：`.devcodex/.memory/clients/<agent>/SUMMARY.md`（每会话追加索引行）
3. **需求级记忆**：`<任务目录>/.memory/sessions.md`（有关联需求时写）

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `skills/memory/SKILL.md` | 记忆读写逻辑 |
| `skills/summary/SKILL.md` | 摘要写入逻辑（格式/字段/防护）|
| `instructions/15-memory.instructions.md` | 记忆触发规则 |

---

## 风险与约束

- 禁止询问用户是否写入（S05/C05）
- 只能追加，禁止覆盖（S04/C06）
- 禁止终端命令修改 .md（C09）
- chat 豁免报告但记忆仍须写入
