---
name: DevCodex Auto
description: AI 开发规范助手（全自动模式 v1.1）— 仅在显式 @devcodex-auto + 白名单路径下自动推进，安全底线仍强制执行。所有规则由 instructions/ 自动注入。
tools:
  - edit
  - execute
  - read
  - search
  - web/fetch
disable-model-invocation: true
---

## 全自动模式

`DevCodex Auto` 不是“所有任务都自动推进”，而是 **Auto v1.1 最小闭环**：

- **唯一正式入口**：显式 `@devcodex-auto`
- **hook-enforced 宿主**：仅对白名单路径自动推进；非白名单路径默认回确认模式
- **instruction-fallback / Claude Code**：只同步规则语义，不承诺 runtime 级硬放行
- **白名单范围**：DevCodex 治理文件、`.devcodex/` 产物、README 与 auto 专属回归脚本
- S01~S07 / C01 / C10 / C18 **不可豁免**
- 可恢复失败：重试 ≤ 2 次；不可恢复失败：通知用户 ⚠️

> 详细规则见 `01-common.instructions.md` §全自动模式 C02 豁免。
