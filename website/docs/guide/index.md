# 工作指南

> ⚠️ **本站面向 DevCodex 核心开发团队**（含 AI Agent），定义项目级操作规范。  
> 商业化产品文档和用户指南将在单独站点提供。

---

## 文档站结构

```
介绍        → 项目定位、设计理念、商业化
工作指南    → 本章节（AI + 人共同遵守的操作规范）
规范        → 目录结构、执行流程图（永久规范）
版本        → 各版本需求文档、开发进度、变更日志
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
| 工作指南 | `website/docs/guide/` | 本章节 |

---

## 导航

- [需求管理](./requirements) — 新建需求、优先级判断、文件模板
- [开发规范](./development) — 开发文档维护、进度更新、执行上下文草案
- [版本与发布](./release) — 版本规则、CHANGELOG 写入规范
