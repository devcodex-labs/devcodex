---
mode: agent
description: 记忆会话文档模板，用于写入每次会话的结构化记忆
applyTo: .devcodex/.memory/**
---
# 记忆会话模板

> **路径**: `.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md`
> **触发**: 会话结束时，由 `memory/SKILL.md` 写入

---

```markdown
# 会话记忆 — YYYY-MM-DD

> **项目**: <project>
> **Agent**: copilot
> **意图**: dev / fix / analyze / audit / self-fix / chat
> **状态**: 完成 / 中断（位置: [描述]）
```

## 任务摘要

> 本次会话完成的核心工作（2~5句话）。

## 关键决策

> 本次会话做出的重要决策（技术选型/方案变更/范围确认）。

| 决策 | 原因 | 时间 |
|------|------|------|

## 变更文件

```
新增: src/xxx.ts
修改: src/yyy.ts
删除: (无)
```

## 遗留问题

> 未完成的任务或待处理的问题，供下次会话恢复用。

| 问题 | 优先级 | 建议处理方式 |
|------|:------:|------------|

## 上下文恢复指引

> resume 工作流读取此节，快速恢复状态。

**当前进度**：  
**下一步**：  
**注意事项**：
