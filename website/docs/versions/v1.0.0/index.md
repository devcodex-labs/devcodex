# v1.0.0 概述

> **状态**：🔄 开发中  
> **基础**：基于 v0.03 原型全面重构  
> **目标**：规范文件统一英文，符合 GitHub Copilot 官方目录标准，构建完整工作流体系

---

## 重构背景

v0.03 是 DevCodex 的原型验证版本，验证了工作流体系（dev/fix/audit/analyze）的可行性。但存在以下问题需要在 v1.0.0 中修复：

| 问题 | v0.03 现状 | v1.0.0 目标 |
|------|-----------|------------|
| Skills 目录结构 | 两级嵌套（`core/compliance/`）| 官方扁平一级（`compliance/`）|
| SKILL.md name 字段 | 中文描述，与文件夹名不一致 | 与文件夹名完全一致 |
| 规范文件语言 | 中文 | 统一英文（AI 跨语言识别更稳定）|
| Hooks 事件名 | 旧格式（`userPromptSubmitted`）| 官方新格式（`UserPromptSubmit`）|
| Agent 模式 | 仅确认模式 | 新增 `@devcodex-auto` 全自动模式 |
| 记忆恢复 | resume 工作流不完整 | 完整的跨会话记忆恢复机制 |

---

## 需求导航

| 分类 | 链接 | 说明 |
|------|------|------|
| 需求总览 | [需求文档](/versions/v1.0.0/requirements/) | 所有需求优先级表 |
| P0 核心 | [core/](/versions/v1.0.0/requirements/core/root) | 根骨架、profile、website |
| P1 基础 | [cross-cutting/](/versions/v1.0.0/requirements/cross-cutting/agent-modes) | 双模式、存储、记忆恢复 |
| P2 功能 | [features/](/versions/v1.0.0/requirements/features/agents) | agents、instructions、skills |
| 发布清单 | [release/checklist](/versions/v1.0.0/release/checklist) | 发布前必须完成的所有工作项 |
| 开发验证 | [release/validation](/versions/v1.0.0/release/validation) | 结构验证 + 行为场景测试 |

