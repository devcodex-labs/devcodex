---
agent: agent
description: 任务级会话记录模板，用于记录 requirements / bugs / optimizations / scenario-tests 的稳定身份、CP 确认状态与关键说明
applyTo: .devcodex/**/.memory/sessions.md
---
# 任务级会话记录模板

> **路径**: `.devcodex/<requirements|bugs|optimizations|scenario-tests>/<中文描述>/.memory/sessions.md`
> **触发**: dev / fix 工作流授权创建任务目录时，同时创建 `task.json` 与 `sessions.md`；每次 CP 确认后立即更新 sessions

---

`<task-root>/.memory/task.json` 使用 `TaskIdentityV1`，只保存稳定身份，不复制 project/kind/status/CP：

```json
{
  "schemaVersion": "TaskIdentityV1",
  "taskId": "<一次生成且改名不变的 UUID>",
  "displayName": "<当前用户可见任务名>",
  "aliases": ["<旧 displayName>"],
  "createdAt": "<ISO time>",
  "identityRevision": 1
}
```

legacy 任务可先只读唯一解析；查询不得主动创建 identity。改名时保留 taskId，把旧名称加入去重 aliases，并递增 identityRevision。

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
- `继续<任务名>任务` 只通过 identity 定位；恢复前仍须复证本 sessions 与绑定产物 digest
