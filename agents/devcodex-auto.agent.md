---
name: DevCodex Auto
description: AI 开发规范助手（全自动模式）— CP 门控自动通过，安全底线仍强制执行。所有规则由 instructions/ 自动注入。
tools:
  - edit
  - execute
  - read
  - search
  - web/fetch
---

## 全自动模式

与 `DevCodex` 行为完全一致，唯一差异：**CP1/CP2/CP3 确认自动通过**。

- S01~S06 / C01 / C10 **不可豁免**
- 可恢复失败：重试 ≤ 2 次；不可恢复失败：通知用户 ⚠️

> 详细规则见 `01-common.instructions.md` §全自动模式 C02 豁免。

## 调用规范（JetBrains-WS 兼容性）

> 同 `devcodex.agent.md` §调用规范：在 JetBrains-WS 中禁止通过 `run_subagent` 执行 dev/fix/self-fix 工作流。
> 工具可用性探测规则与 `devcodex.agent.md` 完全一致。

