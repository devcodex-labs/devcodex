# v1.0.0 概述（基线快照）

> **状态**：✅ 基线快照（历史版本）  
> **基础**：基于 v0.03 原型全面重构  
> **目标**：保留 `1.0.0` 的立项背景、需求基线和历史阶段记录，为后续 `1.x.y` 版本演进提供起点

> ⚠️ 本页保留的是 `1.0.0` 基线快照。自下一轮增量迭代起，新增需求、Bug 修复和发布准备应在同级新版本目录中继续，例如 `/versions/v1/1.0.1/`，而不是继续回写本目录。

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

在 `1.0.0` 基线阶段，重点工作曾是：

1. 冻结需求边界与术语
2. 收口永久规范与版本需求的职责
3. 明确哪些内容是 Draft，哪些内容可以进入实现

> 换句话说：`1.0.0` 当时首先是 **需求与规范文档基线**，而不是已进入后续 patch 迭代的实施站。

---

## v1.0.0 冻结策略

| 维度 | 冻结策略 |
|------|---------|
| 商业化 | v1.0.0 不做商业化收费，保持免费 |
| 规范与产物 | 全部以 Markdown 文档方式存储与维护 |
| 数据平台化 | 不在 v1.0.0 引入云端数据库 |

> 商业化与 MongoDB 平台化能力统一在 v2.0.0 推进。

