# Grok 宿主与 Codex 对齐说明

> 面向在 workspace 中使用 **Grok Build** 的使用者。说明 DevCodex 已对齐的能力、必须使用的入口，以及**不能**与 Codex 宣称完全一致的部分。

## 目录导航

- [结论](#结论)
- [能力对照](#能力对照)
- [推荐用法](#推荐用法)
- [诊断](#诊断)
- [平台上限](#平台上限)

## 结论

| 问题 | 答案 |
|------|------|
| Grok 是否「没适配」？ | 否。已具备 PreTool 硬拦契约、`path-observable` 上下文门禁、workspace 插件与 `devcodex grok` Full 入口。 |
| 是否与 Codex **完全一样**？ | **否。** Grok 被动 Hook **不能**把预检查块注入模型上下文；Stop **不能**硬拦未完成闭包。 |
| 日常怎么用？ | 子 Git 项目用 **`devcodex grok`**；用 `devcodex doctor` 看 `HostParity`。 |

## 能力对照

| 能力 | Codex | Grok（当前） | 说明 |
|------|:-----:|:------------:|------|
| 控制 kernel（`AGENTS.md`） | ✅ 原生 | ✅ Full：`devcodex grok --rules` | plain `grok` 在子项目仅为 Partial |
| UserPromptSubmit 注入 bootstrap / PC0 | ✅（additionalContext 类） | ❌ 平台：stdout 忽略 | 模型仍须输出 PC0~PC7（S07） |
| UserPromptSubmit 阻断 | ✅ | ❌ 平台非 blocking | — |
| PreToolUse 危险命令硬拦 | ✅ | ✅ `decision:deny` | 与 Grok 官方契约对齐 |
| 上下文未齐时 PreTool 门禁 | ✅ path-observable | ✅ path-observable | 与 Codex 同档 |
| Stop 闭包提醒进模型 | 部分 | ❌ 被动 | doctor/报告可复盘 |
| Stop 核验 PC0 | 有正文时可 verified | 常 unverified | 无 assistant payload 不得谎称 missing |
| Auto 白名单 runtime 硬保证 | hook-enforced 宿主 | **仅 PreTool 路径有限** | 见 [设计理念 · Auto](/intro/philosophy) |

## 推荐用法

```bash
# 工作区子项目：Full 证据入口（绑定共享 AGENTS.md）
npx @vextjs/devcodex grok
# 或本地 link 后
devcodex grok

# 诊断 HostParityScorecardV1
devcodex doctor
devcodex doctor --json   # payload.hostParity
devcodex status
```

辅助：

- MCP 工具 **`profile_compose_entry_check`**：生成可粘贴的 `### DevCodex · 入口检查` 块（**不替代**你在回复里真正输出）。
- 上下文未齐被 PreTool deny 时，reason 可能附带 S07 短模板（仍须出现在**用户可见**回复中）。

## 诊断

`devcodex doctor` 中 **Grok HostParity**：

| tier | 含义 |
|------|------|
| `full-capable` | kernel + lifecycle + deny 适配 + path-observable + 插件登记齐全；**仍须** `devcodex grok` 做 Full 会话 |
| `partial` | 缺检查项；按 doctor 列出的 checks 修复后重跑 |

若 workspace plugin source 与用户级登记都存在，但安装副本 digest 与 source 不一致，`doctor/status` 只把它列为 warning；这表示建议重新执行 `devcodex update --host grok` 刷新安装副本，但不应把当前可用的 workspace adapter 误报为“未安装”。

禁止把 `full-capable` 解读为「UserPromptSubmit 已注入 PC0」。

## 平台上限

下列能力依赖 Grok Build 平台演进，**不在** DevCodex 单独「做完」的范围内：

1. UserPromptSubmit 支持 `additionalContext`（或等价注入）
2. UserPromptSubmit 可选 block
3. Stop 携带 assistant 最终可见正文
4. Stop 可选 block 未完成闭包

跟踪清单见维护者需求：`requirements/20260720-grok-host-parity-codex/03-平台能力需求-xAI.md`（源码仓 / 工作区运行态路径）。

## 相关链接

- [快速开始](/intro/#快速开始)
- [设计理念](/intro/philosophy)
- [维护者指南](/guide/)
