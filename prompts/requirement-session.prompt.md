---
agent: agent
description: 任务级会话记录模板，用于记录 requirements / bugs / optimizations 的 CP 确认状态与关键说明
applyTo: .devcodex/**/.memory/sessions.md
---
# 任务级会话记录模板

> **路径**: `.devcodex/<requirements|bugs|optimizations>/<中文描述>/.memory/sessions.md`
> **触发**: dev / fix 工作流进入任务目录后创建；每次 CP 确认后立即更新

---

```markdown
# [任务名称] 任务会话记录

> **日期**: YYYY-MM-DD
> **轮次**: R[N]
> **类型**: requirements / bugs / optimizations
> **状态**: 进行中 / 已完成

### CP 确认记录
| CP  | 状态 | 时间  |
|:---:|:----:|-------|
| CP1 | ✅   | 10:30 |
| CP2 | ⏳   | —     |
| CP3 | ⏹️   | —     |

## 本轮摘要

> 本次确认 / 修订的核心内容。

## 已确认事项

- ✅
- ✅

## 待确认事项

- ❓
- ❓

## 备注

> 用户反馈、阻断点、回退原因或下一步提示。
```

- `✅` 已确认 · `⏳` 等待确认 · `⏹️` 未开始
- hook 以 `| CP1 | ✅ |` 这类表格行为准，格式不符会被视为未确认
