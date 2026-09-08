---
agent: agent
description: 任务级会话记录模板，用于记录 requirements / bugs / optimizations / scenario-tests 的稳定身份、CP 确认状态与关键说明
applyTo: .devcodex/**/.memory/sessions.md
artifactRequiredHeadings: CP 确认记录 | 本轮摘要 | 已确认事项 | 待确认事项 | 备注
---
# 任务级会话记录模板

> **路径**: `.devcodex/<requirements|bugs|optimizations|scenario-tests>/<中文描述>/.memory/sessions.md`
> **触发**: dev / fix 工作流授权创建任务目录时，同时创建 `task.json` 与 `sessions.md`；每次 CP 确认后立即更新 sessions

---

新建 `<task-root>/.memory/task.json` 使用 `TaskIdentityV2`，由 task-admission owner 生成并校验身份摘要；已有 `TaskIdentityV1` 只读兼容并按正式 adopt 路径升级。JSON 字段以 `mcp/task-admission-authority.cjs#createTaskIdentityV2` 的结构定义为准，不能从文档例子伪造摘要。以下为旧 V1 的阅读示例：

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

以下命名模板块由任务会话生成器读取；修改章节或表头会直接传入新生成的会话。`cpTable` 引用同文件 `pending-cp` 块，CP 状态只由确认 owner 后续更新。

<!-- BEGIN DEVCODEX TEMPLATE: task-session -->
```markdown
# {{displayName}} — 工作流状态

> **日期**: {{date}}
> **当前状态**: 🔄 active
> **TaskIdentity**: `{{taskId}}`
> **Admission**: `{{admissionId}}`
> **Route**: `{{routeKey}}`
> **Project**: `{{project}}`
> **类型**: {{taskKind}}

{{cpTable}}

## 本轮摘要

正式任务已准入；需求与方案确认由下方 CP 记录及绑定产物作为依据。

## 已确认事项

尚未确认 CP 阶段；本段不预先声明确认结果。

## 待确认事项

当前等待 CP1 的需求或问题定义；已有自动推进授权按正式确认流程消费。

## 备注

任务身份在准入时生成，后续续接保持同一 taskId；阶段状态由确认 owner 更新。
```
<!-- END DEVCODEX TEMPLATE: task-session -->

<!-- BEGIN DEVCODEX TEMPLATE: pending-cp -->
```markdown
### CP 确认记录

| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |
|:--:|:----:|--------------|---------|--------|---------------|-------------|
| CP1 | ⏳ | — | — | — | — | — |
| CP2 | ⏹️ | — | — | — | — | — |
| CP3 | ⏹️ | — | — | — | — | — |
```
<!-- END DEVCODEX TEMPLATE: pending-cp -->

- `✅` 已确认 · `⏳` 等待确认 · `⏹️` 未开始
- hook 以 `| CP1 | ✅ |` 这类表格行为准，格式不符会被视为未确认
- 恢复意图由模型理解后调用正式任务解析入口，不能用“继续”等词直接决定恢复；恢复前仍须复证本 sessions 与绑定产物 digest
