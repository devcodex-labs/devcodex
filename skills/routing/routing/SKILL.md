---
name: Routing
description: 工作流路由规范 — 意图到 Agent 的映射表 + 路由执行规则
---
# Routing Skill

## 职责

定义意图识别结果到 Agent 的路由映射，作为 v5 中 `resume.agent.md` 和 `chat.agent.md` 的路由参考。

> ⚠️ 本 Skill 为**人类可读参考**，实际路由由 Agent 文件的 frontmatter 和平台机制完成，无需在执行中调用本文件。

## 路由映射表

| 意图 | 目标 Agent | 说明 |
|------|-----------|------|
| `dev` | `dev.agent.md` | 开发工作流，CP1→CP2→CP3 |
| `fix` | `fix.agent.md` | Bug 修复三步扫描 |
| `analyze` | `analyze.agent.md` | 单轮分析，只读 |
| `audit` | `audit.agent.md` | 多轮深度审查 |
| `self-fix` | `self-fix.agent.md` | 规范文件自修复 |
| `chat` | `chat.agent.md` | 纯问答，快速路径 |
| `resume` | `resume.agent.md` | 上下文恢复，重路由 |
| `other` | `plan.agent.md` | 兜底路由，执行计划 |

## 子类型路由表

| 工作流 | 子类型 | Skill |
|--------|--------|-------|
| dev | default | `dev-default.skill.md` |
| dev | refactor | `dev-refactor.skill.md` |
| dev | database | `dev-database.skill.md` |
| dev | init | `dev-init.skill.md` |
| dev | optimization | `dev-optimization.skill.md` |
| dev | scenario-test | `dev-scenario-test.skill.md` |
| dev | docs | `dev-docs.skill.md` |
| dev | plan-review | `dev-plan-review.skill.md` |
| fix | default | `fix-default.skill.md` |
| fix | incident | `fix-incident.skill.md` |
| fix | security | `fix-security.skill.md` |
| analyze | research | `analyze-research.skill.md` |
| audit | 规范文件 | `audit-dimensions.skill.md` |
| audit | 技术方案 | `audit-tech-design.skill.md` |
| audit | 需求文档 | `audit-requirements.skill.md` |
| audit | 项目工程 | `audit-project.skill.md` |
| audit | 报告 | `audit-report.skill.md` |
| audit | 通用文档 | `audit-document.skill.md` |

## chat 快速路径

```
chat 意图 → chat.agent.md → 直接回复 → 记忆更新（豁免报告/合规）
```

## resume 二次路由

```
resume 意图 → resume.agent.md → 恢复上下文 → 重路由到原始工作流
```
