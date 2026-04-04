---
name: routing
description: 'Use when mapping intent recognition results to workflow dispatch. Reference for intent-to-workflow routing table in DevCodex.'
---
# Routing Skill

## 职责

定义意图识别结果到工作流的路由映射。v5 架构中所有意图均通过单一入口 `devcodex.agent.md` 分发。

> ⚠️ 本 Skill 为**人类可读参考**，实际路由由 `devcodex.agent.md` 的 frontmatter + 内置 intent-routing 逻辑完成，无需在执行中显式调用本文件。

## 路由映射表

| 意图 | 工作流 | 说明 |
|------|--------|------|
| `dev` | 开发工作流 | CP1→CP2→CP3，8 子类型 |
| `fix` | 修复工作流 | Bug 修复三步扫描 |
| `analyze` | 分析工作流 | 单轮分析，只读 |
| `audit` | 审计工作流 | 多轮深度审查 |
| `self-fix` | 自修复工作流 | 规范文件自修复 |
| `chat` | 问答工作流 | 纯问答，快速路径 |
| `resume` | 上下文恢复 | 恢复记忆后重路由到原始工作流 |
| `other` | 规划工作流 | 兜底路由，制定执行计划 |

## 子类型路由表

| 工作流 | 子类型 | Skill |
|--------|--------|-------|
| dev | default | `skills/dev-default/SKILL.md` |
| dev | refactor | `skills/dev-refactor/SKILL.md` |
| dev | database | `skills/dev-database/SKILL.md` |
| dev | init | `skills/dev-init/SKILL.md` |
| dev | optimization | `skills/dev-optimization/SKILL.md` |
| dev | scenario-test | `skills/dev-scenario-test/SKILL.md` |
| dev | docs | `skills/dev-docs/SKILL.md` |
| dev | plan-review | `skills/dev-plan-review/SKILL.md` |
| fix | default | `skills/fix-default/SKILL.md` |
| fix | incident | `skills/fix-incident/SKILL.md` |
| fix | security | `skills/fix-security/SKILL.md` |
| analyze | research | `skills/analyze-research/SKILL.md` |
| audit | 规范文件 | `skills/audit-dimensions/SKILL.md` |
| audit | 技术方案 | `skills/audit-tech-design/SKILL.md` |
| audit | 需求文档 | `skills/audit-requirements/SKILL.md` |
| audit | 项目工程 | `skills/audit-project/SKILL.md` |
| audit | 报告 | `skills/audit-report/SKILL.md` |
| audit | 通用文档 | `skills/audit-document/SKILL.md` |
