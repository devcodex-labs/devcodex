---
applyTo: "**"
description: 示例租户对 dev 工作流的局部覆盖演示，说明如何追加租户级约束而非复制全量规则
priority: P3
version: 1.16.7
---
# example-tenant — dev 工作流局部覆盖示例

> 本文件演示如何局部覆盖 `10-dev.instructions.md` 的某一条规则，而不是复制整份默认规则。

## 示例：租户级补充约束

- 当任务命中本租户的内部发布流程时，CP2 方案确认中额外列出内部审批检查点。
- 其他未覆盖条目继续继承默认 `10-dev.instructions.md`。
