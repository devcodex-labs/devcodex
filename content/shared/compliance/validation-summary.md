### FinalValidationSummaryV1

> **UserVisibleNoisePolicyV1**：未宣称「工作完成」时，用户面**默认不贴**本块。宣称完成且全绿 → **短证**；失败/缺口/用户要详情 → **全量**。完整 FC/SC/T 仍进报告，不默认刷对话。

**短证（默认 · 全绿完成）**

```markdown
### FinalValidationSummaryV1
**白话：** 一句结论（是否通过、是否改码/提交）。
**证据：** `command` exitCode 0 · 关键计数 a/b
WorkspaceSyncStatus: N/A 未触发 · dirty boundary: git status clean-tree · Release actions: push/tag/publish 未执行
```

**全量（失败展开 / 用户要详情 / 控制面高风险完成）**

| 字段 | 填写 |
|------|------|
| 白话 | 1～3 句；禁止只写「全绿 / 已通过 / 详见报告」 |
| 权威命令 + exitCode | `command` exitCode N（可多行） |
| 关键计数 | 如 `3/3 checks passed` 或 runId / V 范围 |
| WorkspaceSyncStatus | synced / skipped / blocked / **N/A 未触发** + 理由 |
| dirty boundary | 须含范围词，如 `git status clean-tree` |
| Release actions | push/tag/release/publish **已执行或未执行** |
| post-commit replay | 声明 commit 时必填；否则 `N/A + reason` |

> 禁止：无宣称完成仍贴长合规表；命令墙无白话；分析失败证据冒充修复成功。