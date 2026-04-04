---
mode: agent
description: Agent 会话摘要模板，用于生成跨会话 Agent 级别的工作摘要
applyTo: .devcodex/.memory/**
---
# Agent 摘要模板

> **路径**: `.devcodex/.memory/clients/<agent>/SUMMARY.md`
> **触发**: 累计 3 次以上 memory-session 后，由 `summary/SKILL.md` 生成/更新

---

```markdown
# <project> Agent 工作摘要

> **最后更新**: YYYY-MM-DD
> **累计会话**: X 次
> **Agent**: copilot
```

## 当前项目状态

> 项目当前处于什么阶段，核心模块的完成情况。

## 关键决策记录

> 跨会话积累的重要决策，避免重复讨论。

| 决策 | 详情 | 会话日期 |
|------|------|---------|
| | | YYYY-MM-DD |

## 待处理事项

> 跨会话积累的遗留问题，按优先级排序。

| 优先级 | 事项 | 来源会话 |
|:------:|------|---------|
| 🔴 | | |
| 🟡 | | |

## 已完成里程碑

| 里程碑 | 完成日期 |
|--------|---------|
| | YYYY-MM-DD |

## 注意事项

> 项目特有的注意点、踩坑记录，供新会话参考。
