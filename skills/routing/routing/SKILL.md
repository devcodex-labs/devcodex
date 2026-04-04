---
name: Routing
description: 工作流路由规范 — 意图到工作流的映射表 + v5 统一 Agent 路由说明
---
# Routing Skill

## 职责

定义意图识别结果到工作流的路由映射。v5 架构中所有意图均通过单一入口 `devcodex.agent.md` 分发，无需单独 Agent 文件。

> ⚠️ 本 Skill 为**人类可读参考**，实际路由由 `devcodex.agent.md` 的 frontmatter + 内置 intent-routing 逻辑完成，无需在执行中显式调用本文件。

## 路由映射表

| 意图 | 入口 Agent | 工作流 | 说明 |
|------|-----------|--------|------|
| `dev` | `devcodex.agent.md` | 开发工作流 | CP1→CP2→CP3，8 子类型 |
| `fix` | `devcodex.agent.md` | 修复工作流 | Bug 修复三步扫描 |
| `analyze` | `devcodex.agent.md` | 分析工作流 | 单轮分析，只读 |
| `audit` | `devcodex.agent.md` | 审计工作流 | 多轮深度审查 |
| `self-fix` | `devcodex.agent.md` | 自修复工作流 | 规范文件自修复 |
| `chat` | `devcodex.agent.md` | 问答工作流 | 纯问答，快速路径 |
| `resume` | `devcodex.agent.md` | 上下文恢复 | 恢复记忆后重路由到原始工作流 |
| `other` | `devcodex.agent.md` | 规划工作流 | 兜底路由，制定执行计划 |

## 子类型路由表

| 工作流 | 子类型 | Skill（skills/<category>/<name>/SKILL.md） |
|--------|--------|-------|
| dev | default | `skills/dev/dev-default/SKILL.md` |
| dev | refactor | `skills/dev/dev-refactor/SKILL.md` |
| dev | database | `skills/dev/dev-database/SKILL.md` |
| dev | init | `skills/dev/dev-init/SKILL.md` |
| dev | optimization | `skills/dev/dev-optimization/SKILL.md` |
| dev | scenario-test | `skills/dev/dev-scenario-test/SKILL.md` |
| dev | docs | `skills/dev/dev-docs/SKILL.md` |
| dev | plan-review | `skills/dev/dev-plan-review/SKILL.md` |
| fix | default | `skills/fix/fix-default/SKILL.md` |
| fix | incident | `skills/fix/fix-incident/SKILL.md` |
| fix | security | `skills/fix/fix-security/SKILL.md` |
| analyze | research | `skills/analyze/analyze-research/SKILL.md` |
| analyze | default | 单轮直接分析（无专属 SKILL，走通用流程） |
| audit | 规范文件 | `skills/audit/audit-dimensions/SKILL.md` |
| audit | 技术方案 | `skills/audit/audit-tech-design/SKILL.md` |
| audit | 需求文档 | `skills/audit/audit-requirements/SKILL.md` |
| audit | 项目工程 | `skills/audit/audit-project/SKILL.md` |
| audit | 报告 | `skills/audit/audit-report/SKILL.md` |
| audit | 通用文档 | `skills/audit/audit-document/SKILL.md` |

## chat 快速路径

```
chat 意图 → devcodex.agent.md → 直接回复 → 记忆更新（豁免报告/合规）
```

## resume 二次路由

```
resume 意图 → devcodex.agent.md → 读取记忆（最近 14 天）→ 恢复上下文 → 重路由到原始工作流
```
