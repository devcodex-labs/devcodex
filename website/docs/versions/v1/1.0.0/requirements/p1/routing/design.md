# ⑦ 路由到工作流 — 技术方案

> **需求来源**：[⑦ 路由到工作流 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

路由由 `01-common.instructions.md` §意图路由表定义主映射，`intent/SKILL.md` 负责前置识别 + 三问法，`routing/SKILL.md` 仅保留人类可读参考，授权门控再由 `token-check` Skill 执行。

---

## 核心设计

按当前主规则定义的路由映射：

| 意图 | 工作流 | 授权 |
|------|--------|------|
| `dev` | 开发工作流（8 子类型）| Free（部分需 Pro）|
| `fix` | 修复工作流（3 子类型）| Free（部分需 Pro）|
| `analyze` | 分析工作流（多轮收敛）| Free |
| `audit` | 审计工作流（多轮收敛）| Free |
| `self-fix` | 规范自修复工作流 | Pro |
| `resume` | 上下文恢复工作流 | Pro |
| `other` | 规划工作流（兜底）| Pro |
| `chat` | 问答（快速路径）| Free |

### 特殊路由规则
- **违规质疑路由**（优先于上表）— 用户质疑规范违反 → 强制路由到 audit
- **授权门控** — 路由确定后调用 `token-check` Skill 验证层级

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `instructions/01-common.instructions.md` §意图路由表 | 路由主逻辑 + 授权声明 |
| `skills/routing/SKILL.md` | 路由映射参考（人类可读，不再作为权威执行面） |
| `skills/intent/SKILL.md` | 意图识别结果输入 |
| `skills/token-check/SKILL.md` | 路由后的授权门控 |

---

## 风险与约束

- 意图识别基于语义目的，不依赖关键词匹配
- 多意图时必须串行处理（C07）
- resume 路径读记忆后必须重新走完整路由
