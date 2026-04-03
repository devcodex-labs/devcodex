---
mode: agent
description: 需求会话记录模板，用于记录需求讨论过程中的会话快照
applyTo: "projects/**/docs/requirements/**"
---

# 需求会话记录模板

> **路径**: `projects/<project>/docs/requirements/YYYYMMDD-<name>-session.md`
> **触发**: dev 工作流 CP1 确认前，记录需求讨论过程

---

```markdown
# [需求名称] 需求会话记录

> **日期**: YYYY-MM-DD
> **轮次**: R[N]
> **状态**: 讨论中 / CP1 已确认
```

## 会话摘要

> 本次需求讨论的核心要点。

## 已确认事项

- ✅ 
- ✅ 

## 待确认事项

- ❓ 
- ❓ 

## 用户反馈

> 用户在需求讨论中提出的关键意见和修改要求。

## 变更历史

| 轮次 | 日期 | 变更说明 |
|:----:|------|---------|
| R1 | YYYY-MM-DD | 初始讨论 |
