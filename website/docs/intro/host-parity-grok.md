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
devcodex doctor --json   # payload.hostParity（含 failedChecks / repairSteps）
devcodex status
```

辅助：

- MCP 工具 **`profile_compose_entry_check`**：生成可粘贴的 `### DevCodex · 入口检查` 块（**不替代**你在回复里真正输出）。
- 上下文未齐被 PreTool deny 时，reason 可能附带 S07 短模板 + **GrokTurnChecklist / Skill bundle** 提示（仍须出现在**用户可见**回复中）。

## GrokTurnChecklist（无 inject 时的强制面 · PF-165）

Grok **不会**每轮注入 bootstrap。模型必须按下列可扫清单自执行（Host Kernel `AGENTS.md` 与 workspace Skill 同步摘要）：

| # | 项 | 要求 |
|---|----|------|
| 1 | entry-pc0-pc7 | 首条用户可见输出完整 PC0~PC7；`/compact` `/resume` 后同样视为首条 |
| 2 | intent-route | IntentSeed → 最终路由；不得把 analyze/audit 误判为 chat |
| 3 | skill-bundle | 加载 Intent→Skill **强制包**（见下表）后再做实质工作 |
| 4 | context-plan | ContextReadPlanV2 + 回执；无 `fullReadReason` 禁止无界全量读 |
| 5 | work-and-gates | 按工作流执行 CP/ECR 等门禁；**不得**以「无 Hook 注入」为由省略 |
| 6 | report-memory | 非 chat：写报告 + 记忆（命中治理时写台账）；chat 豁免 |
| 7 | honest-ceiling | 不得宣称 inject / Stop 硬拦 / Grok===Codex bootstrap |

### Intent → Skill 强制包（非 chat）

| Intent | 强制读取 Skill |
|--------|----------------|
| analyze | intent · compliance · user-visible-output-contract · analyze-default · report · memory |
| audit | intent · compliance · user-visible-output-contract · audit-common · report · memory |
| dev | intent · compliance · user-visible-output-contract · dev-default · cp-gate · report · memory |
| fix / self-fix | intent · compliance · user-visible-output-contract · fix-default · cp-gate · report · memory |
| other | intent · compliance · user-visible-output-contract · plan · report · memory |
| resume | intent · compliance · memory · user-visible-output-contract（再继承原工作流包） |
| chat | 无强制包（可选 intent） |

机器真相源：`scripts/lib/host-parity-scorecard.js` → `GROK_TURN_EXECUTION_CHECKLIST` / `GROK_INTENT_SKILL_BUNDLES`；负向探针 `classifyGrokTurnOmissionSample`。

## 诊断

`devcodex doctor` 中 **Grok HostParity**：

| tier | 含义 |
|------|------|
| `full-capable` | kernel + lifecycle + deny 适配 + path-observable + 插件登记齐全；**仍须** `devcodex grok` 做 Full 会话 |
| `partial` | 缺检查项；doctor **打印可执行 repairSteps**（命令 + 说明），JSON 见 `hostParity.repairSteps` / `failedChecks` |

### partial → 可修复闭环

1. 读 `devcodex doctor` 人类输出的 **Repair steps**，或 `doctor --json` → `payload.hostParity.repairSteps`。
2. 按每条 `command` 执行（常见：`devcodex update --host grok`、补 Codex lifecycle 源契约）。
3. 再跑 `devcodex doctor`，直到 `tier=full-capable`（或 checks 全绿）。
4. 日常会话仍用 **`devcodex grok`**，并遵守 **GrokTurnChecklist**（full-capable ≠ 已注入 PC0）。

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
