#### 验证摘要
| 类型 | 命令 | exitCode | runId/计数 |
|------|------|----------|------------|
| 权威/实验/skipped | `command or N/A` | `0/N/A` | `runId 或关键计数` |
WorkspaceSyncStatus：synced/skipped/blocked + reason；dirty boundary：scope + state；Release actions：push/tag/release/publish 执行边界；post-commit replay：commit 任务必填，否则 N/A + reason。