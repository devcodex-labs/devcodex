# 维护者指南

> 本分区面向 DevCodex 项目维护者与参与维护的 AI Agent，定义需求、开发和发布操作规范。首次使用 DevCodex 请从 [使用介绍](/intro/) 与 [快速开始](/intro/#快速开始) 进入；维护者流程不是用户安装的前置条件。

---

## 文档站结构

```
使用介绍    → 产品定位、快速开始、设计理念
维护者指南  → 本章节（AI + 人共同遵守的项目维护规范）
规范与流程  → 稳定目录结构与执行流程 reference
版本        → 历史需求、开发进度和变更日志
```

---

## 目录规范速查

| 用途 | 路径 | 说明 |
|------|------|------|
| 需求文档 | `website/docs/versions/v1/<active-version>/requirements/` | 当前活跃版本的唯一需求来源；当前为 `1.0.1` |
| 版本分层 | `website/docs/versions/v1/<active-version>/` | `1.0.0` 为基线快照，后续 patch 使用同级活动版本目录 |
| P0 核心需求 | `requirements/p0/<名称>.md` | 单文件 |
| P1 基础需求 | `requirements/p1/<名称>/`（5 文件）| 含开发文档 |
| P2 功能需求 | `requirements/p2/<名称>.md` | 单文件 |
| 规范文件 | `.github/`（agents/skills/instructions/prompts/hooks/data）| 中文编写 |
| 产物文件 | `.devcodex/`（记忆/报告/data）| 分类提交 |
| 维护者指南 | `website/docs/guide/` | 本章节；不作为用户首次安装路径 |

---

## 导航

- [需求管理](./requirements) — 新建需求、优先级判断、文件模板
- [开发规范](./development) — 开发文档维护、进度更新、执行上下文草案
- [版本与发布](./release) — 版本规则、CHANGELOG 写入规范
