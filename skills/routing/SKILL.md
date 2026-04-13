---
name: routing
description: 定义意图识别结果到工作流的路由映射。本 Skill 为人类可读参考，实际路由逻辑内联在 Agent 文件中。
---
# Routing Skill

## 职责

定义意图识别结果到工作流的路由映射。所有意图均通过单一入口 [`devcodex.agent.md`](../../agents/devcodex.agent.md) 分发。

> ⚠️ 本 Skill 为**人类可读参考**，实际路由由 Agent 的 frontmatter + 内置 intent-routing 逻辑完成，无需在执行中显式调用本文件。

## 路由映射表

| 意图 | 工作流 | 说明 |
|------|--------|------|
| `dev` | 开发工作流 | CP1→CP2→CP3，8 子类型（见 `10-dev.instructions.md`） |
| `fix` | 修复工作流 | Bug 修复三步扫描（见 `11-fix.instructions.md`） |
| `analyze` | 分析工作流 | 多轮收敛分析，≥3 轮，连续 2 轮无新发现后收敛（见 `13-analyze.instructions.md`），只读 |
| `audit` | 审计工作流 | 多轮深度审查，≥3 轮（见 `12-audit.instructions.md`） |
| `self-fix` | 自修复工作流 | 规范文件自修复（见 `14-self-fix.instructions.md`） |
| `chat` | 问答工作流 | 纯问答，快速路径 |
| `resume` | 上下文恢复 | 恢复记忆后重路由到原始工作流 |
| `other` | 规划工作流 | 兜底路由，制定执行计划（`plan/SKILL.md`） |

## 子类型路由表

> ⚠️ 本表仅供路由参考。执行时按 `01-common` §Skill 按需读取表 读取对应 Skill，禁止全量读取。

| 工作流 | 子类型 | Skill 文件 |
|--------|--------|-----------|
| dev | default | `skills/dev-default/SKILL.md` |
| dev | refactor | `skills/dev-refactor/SKILL.md` |
| dev | database | `skills/dev-database/SKILL.md` |
| dev | init | `skills/dev-init/SKILL.md` |
| dev | optimization | `skills/dev-optimization/SKILL.md` |
| dev | scenario-test | `skills/dev-scenario-test/SKILL.md` |
| dev | docs | `skills/dev-docs/SKILL.md` |
| dev | plan-review | `skills/dev-plan-review/SKILL.md`（工作流内部步骤） |
| fix | default | `skills/fix-default/SKILL.md` |
| fix | incident | （Instruction 已完整覆盖） |
| fix | security | `skills/fix-security/SKILL.md` |
| analyze | research | `skills/analyze-research/SKILL.md` |
| audit | 规范文件 | `skills/audit-dimensions/SKILL.md` |
| audit | 技术方案 | `skills/audit-tech-design/SKILL.md` |
| audit | 需求文档 | `skills/audit-requirements/SKILL.md` |
| audit | 项目工程 | `skills/audit-project/SKILL.md` |
| audit | 报告 | `skills/audit-report/SKILL.md` |
| audit | 通用文档 | `skills/audit-document/SKILL.md` |

## 授权门控

路由确定后验证当前授权层级（`token-check` Skill）：

- Free 层访问 Pro 功能 → 提示升级并列出可用替代
- 功能层级标注见各子类型路由表中的 ⚠️ Pro 标记

## 特殊路由规则

### 违规质疑路由（优先于主路由表）

以下语义均路由到 `audit` → 规范文件审查（**不得路由到 `chat`**）：
- 用户指出 AI 违反了某条规范
- 用户质问为什么某步骤没有执行
- 用户要求检查当前会话是否合规
- 用户确认规范存在后要求补做

> 路由到 audit 后，**首先**重新执行合规检查（`compliance` Skill），再输出审查结论。

### resume 路径

```
RESTORE → 读取记忆（最近 14 天）→ 还原上下文 → 提取原始意图 → 重路由到原始工作流
```

### resume 约束

- chat 不产生中断 → resume 不接受 chat 类型原始意图
- resume 不改变原始意图类型

### chat 快速路径

三问法全部指向分析 + 无文件变更 → 跳过 CP 和报告 → 直接回复 → 仅写记忆 → 关闭

### 多意图处理

≥2 意图 → 按序逐一路由，每个独立走完整工作流周期 → 独立报告 → 再路由下一个

### 工作流内部强制步骤

dev: `plan-review`（CP2 后、CP3 前强制）为工作流内部步骤，不参与子类型路由。

