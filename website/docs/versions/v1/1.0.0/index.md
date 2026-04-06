# v1.0.0 概述

> **状态**：📝 需求整理中  
> **基础**：基于 v0.03 原型全面重构  
> **目标**：完成需求冻结、规范收口与开发准备，再进入正式实现阶段

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
| 记忆恢复 | 恢复任务（resume）工作流不完整 | 完整的跨会话记忆恢复机制 |

---

## 需求导航

| 分类 | 链接 | 说明 |
|------|------|------|
| 需求总览 | [需求文档](/versions/v1/1.0.0/requirements/) | 所有需求优先级表 |
| P0 核心 | [p0/](/versions/v1/1.0.0/requirements/p0/root) | 根骨架、profile、执行流程、website |
| P1 基础 | [p1/](/versions/v1/1.0.0/requirements/p1/agent-modes/) | 双模式、存储、记忆恢复 |
| P2 功能 | [p2/](/versions/v1/1.0.0/requirements/p2/agents) | agents、instructions、skills |
| 发布清单 | [release/checklist](/versions/v1/1.0.0/release/checklist) | 发布前必须完成的所有工作项 |
| 开发验证 | [release/validation](/versions/v1/1.0.0/release/validation) | 结构验证 + 行为场景测试 |

---

## 当前阶段

当前 `1.0.0` 还处于**开发前整理阶段**，重点工作是：

1. 冻结需求边界与术语
2. 收口永久规范与版本需求的职责
3. 明确哪些内容是 Draft，哪些内容可以进入实现

> 换句话说：当前站点首先是 **需求与规范文档**，而不是“已开始编码后的实施站”。

---

## v1.0.0 冻结策略

| 维度 | 冻结策略 |
|------|---------|
| 商业化 | v1.0.0 不做商业化收费，保持免费 |
| 规范与产物 | 全部以 Markdown 文档方式存储与维护 |
| 数据平台化 | 不在 v1.0.0 引入云端数据库 |

> 商业化与 MongoDB 平台化能力统一在 v2.0.0 推进。

