### FinalValidationSummaryV1

**白话优先（给人看）**：用 1～3 句说明本轮验证结论、是否改了代码、是否提交/发版。禁止只写「全绿 / 已通过 / 详见报告」。

**证据（给门禁/复现）**：至少一条权威命令 + `exitCode`（或 `skipped + reason`）；再写关键计数、同步、脏边界、发布边界。

| 字段 | 填写 |
|------|------|
| 权威命令 + exitCode | `command` exitCode N（可多行） |
| 关键计数 | 如 `3/3 checks passed` 或 runId / V 范围 |
| WorkspaceSyncStatus | synced / skipped / blocked / **N/A 未触发** + 理由 |
| dirty boundary | 须含范围词，如 `git status clean-tree`；工作树干净 / 仅 active-root 等 |
| Release actions | push/tag/release/publish **已执行或未执行**（未执行也必须写） |
| post-commit replay | 声明 commit 时必填；否则 `N/A + reason` |

> 禁止：命令墙无白话；分析阶段 exitCode 1 冒充「修复已成功」；用报告链接代替矩阵。