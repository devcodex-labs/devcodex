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
| Grok 是否「没适配」？ | 否。已具备 PreTool 硬拦契约、`path-observable` 上下文门禁、**条件 Stop 硬续**（有 `lastAssistantMessage` 时可 `decision:block`）、用户级插件与 `devcodex grok` Full 入口。 |
| 是否与 Codex **完全一样**？ | **否。** Grok 被动 Hook **不能**把预检查块注入模型上下文（UPS 无 inject）。Stop **可以条件硬拦**未完成闭包，但不能宣称与 Codex 全行为等价。 |
| 日常怎么用？ | 子 Git 项目用 **`devcodex grok`**；用 `devcodex doctor` 看 `HostParity`。 |

## 能力对照

| 能力 | Codex | Grok（当前） | 说明 |
|------|:-----:|:------------:|------|
| 控制 kernel（`AGENTS.md`） | ✅ 原生 | ✅ Full：`devcodex grok --rules` | plain `grok` 在子项目仅为 Partial |
| UserPromptSubmit 注入 bootstrap / PC0 | ✅（additionalContext 类） | ❌ 平台：stdout 忽略 | 模型仍须输出 PC0~PC7（S07） |
| UserPromptSubmit 阻断 | ✅ | ❌ 平台非 blocking | — |
| PreToolUse 危险命令硬拦 | ✅ | ✅ `decision:deny` | 与 Grok 官方契约对齐 |
| 上下文未齐时 PreTool 门禁 | ✅ path-observable | ✅ path-observable | 与 Codex 同档 |
| Stop 闭包硬续 | ✅（strict/条件） | ✅ **条件** `decision:block` + reason | 有 `lastAssistantMessage` 且完成门失败时硬续；无正文 → unverified；softCap/平台上限后 fail-open |
| Stop 核验 PC0 / 完成检查 | 有正文时可 verified | 有 `lastAssistantMessage` 时可 verified | 须识别官方 camelCase 字段；无 payload 不得谎称 missing |
| Auto 白名单 runtime 硬保证 | hook-enforced 宿主 | **仅 PreTool 路径有限** | 见 [设计理念 · Auto](/intro/philosophy) |

## 推荐用法

```bash
# Full 证据入口（绑定用户级 controlling kernel）
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

Grok **不会**每轮注入 bootstrap。模型必须按下列可扫清单自执行（用户级 controlling kernel 与 Skill 摘要）：

| # | 项 | 要求 |
|---|----|------|
| 1 | entry-pc0-pc7 | 首条用户可见输出完整 PC0~PC7；`/compact` `/resume` 后同样视为首条 |
| 2 | intent-route | IntentSeed → 最终路由；不得把 analyze/audit 误判为 chat |
| 3 | skill-bundle | 加载 Intent→Skill **强制包**（见下表）后再做实质工作；**最小充分**，禁止首轮通读全部 audit 子 Skill 百科 |
| 4 | context-plan | ContextReadPlanV2 + 回执；无 `fullReadReason` 禁止无界全量读 |
| 5 | scan-hygiene | **C16 WorkspaceRootScanBan**：禁止 monorepo/workspace 根 `Get-ChildItem -Recurse`；项目路径直达；排除 `node_modules`/`dist` |
| 6 | ttfv-first-delivery | **C16 TimeToFirstValueGate**：同一用户可见回复交付范围卡 **或** 首批 finding/结论 **或** 明确阻断（非 chat） |
| 7 | work-and-gates | 按工作流执行 CP/ECR 等门禁；**不得**以「无 Hook 注入」为由省略 |
| 8 | report-memory | 非 chat：写报告 + 记忆（命中治理时写台账）；chat 豁免 |
| 9 | honest-ceiling | 不得宣称 UPS inject / **无条件** Stop 硬拦 / Grok===Codex bootstrap；Stop 硬续是**条件**的（有正文 + 未触 softCap） |

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

机器真相源：`scripts/lib/host-parity-scorecard.js` → `GROK_TURN_EXECUTION_CHECKLIST` / `GROK_INTENT_SKILL_BUNDLES`；负向探针 `classifyGrokTurnOmissionSample`、`classifyWorkspaceRootScanSample`、`classifyTtfvOmissionSample`。Hook 对 workspace 根 + Recurse inventory 可 `neverApprove` 硬拦（`lifecycle-dangerous-command` · PI-20260724-01）。

## 诊断

`devcodex doctor` 中 **Grok HostParity**：

| tier | 含义 |
|------|------|
| `full-capable` | kernel + lifecycle + deny 适配 + path-observable + 插件登记齐全；**仍须** `devcodex grok` 做 Full 会话 |
| `partial` | 缺检查项；doctor **打印可执行 repairSteps**（命令 + 说明），JSON 见 `hostParity.repairSteps` / `failedChecks` |
| `source-candidate-comparison` | 当前命令运行于 DevCodex 源码仓，只比较源码候选与已安装 receipt；不能声明已安装健康，`checks/failedChecks/repairSteps` 被抑制 |

### partial → 可修复闭环

以下步骤只适用于已安装包作用域。源码仓诊断会返回 `installedHealthClaim=false`，候选差异只保留在 `hostParity.withheldChecks/withheldFailedChecks/withheldRepairSteps`；应先打包并全局安装候选，再从源码仓外运行诊断。

1. 读 `devcodex doctor` 人类输出的 **Repair steps**，或 `doctor --json` → `payload.hostParity.repairSteps`。
2. 按每条 `command` 执行；源码候选优先 `devcodex global-adapters apply`，或 `npm install -g .` / `npm install -g ./devcodex-1.15.3.tgz`；发布后缺失时使用 `npm install -g devcodex`、升级时使用 `npm update -g devcodex`。
3. 再跑 `devcodex doctor`，直到 `tier=full-capable`（或 checks 全绿）。
4. 日常会话仍用 **`devcodex grok`**，并遵守 **GrokTurnChecklist**（full-capable ≠ 已注入 PC0）。

receipt、plugin 文件和稳定 runtime 只证明 `configured`。`status` 执行 Grok adapter 与 source 静态合同并单独给出 `adapterReady`；`doctor` 再要求 `grok plugin list --json` 只有一个 canonical identity、`grok inspect --json` 发现一个启用的用户插件及其 Skill/Hook/MCP、已安装 Hook 通过只读合同探针，并完成 MCP `initialize`。JSON 使用 `configured/adapterReady/contractStatus/nativeStatus/operationalState/ready/issues` 分层表达；只有原生深探针通过才是 operational ready，查询成功但健康失败仍为 `ok=true`、exit 0。工作区 `.grok` 只作为 legacy 诊断，不参与 ready 判定。

安装刷新会对受管的 canonical、legacy 和恢复来源先保留快照，再通过 Grok 官方 uninstall/install 收敛；未知同名 source 在 mutation 前阻断。source Hook/MCP 始终从用户级 `$GROK_HOME/devcodex/runtime` 解析，并从当前 cwd 发现 workspace `.devcodex`，不读取工作区 `AGENTS.md/.agents/.claude/.grok`。

Grok 默认还会兼容加载 `~/.claude/settings.json`。当其中的 DevCodex Claude hooks 被 Grok 以 camelCase payload 和 snake_case 事件调用时，Claude adapter 会安全 no-op，避免与 Grok 专用 plugin 重复执行 lifecycle；不会全局禁用用户自己的其他 Claude 兼容 hooks。

禁止把 `full-capable` 解读为「UserPromptSubmit 已注入 PC0」。

## 未对齐机器台账（U-\*）

Grok 相对 Codex 的**仍未对齐**残差以机器台账为准（与产品需求 U-A1～U-C3 对齐）：

| 项 | 路径 |
|----|------|
| 权威 JSON | 源码仓 `scripts/fixtures/host-parity/unaligned-ledger.v1.json` |
| Schema | `scripts/fixtures/host-parity/unaligned-ledger.schema.json` |
| 加载/关闭校验 | `scripts/lib/parity-unaligned-ledger.js` |
| cannotClaim floor | `MIN_CANNOT_CLAIM` in `scripts/lib/host-parity-scorecard.js` |
| 升档缩减门禁 | `scripts/lib/parity-upgrade-decision.js`（无决策禁止缩 cannotClaim） |
| 回归 | `npm run test:host-parity`（含 `test-host-parity-ledger.js`） |

> 关闭台账项必须带 `evidenceRefs`；缩减 inject/Stop 相关 `cannotClaim` 需要 `platform-docs` 或 `direct-host-replay` 级 `ParityUpgradeDecision`。

**validate.js**：默认**不**内嵌 host-parity 套件；质量链以 `test:optimization-controls`（已含 `test:host-parity`）与发布前 `npm run test:host-parity` 为准。

## 平台上限

下列能力依赖 Grok Build 平台演进，或仍属 DevCodex 条件/残余边界：

1. UserPromptSubmit 支持 `additionalContext`（或等价注入）— **仍不能宣称**（U-A1）
2. UserPromptSubmit 可选 block — **仍不能宣称**（U-A2）
3. Stop **无** `lastAssistantMessage` 时的 verified PC0 / 完成检查 — **unverified，不 hard-block**（U-A3）
4. Stop **条件** hard-block 未完成闭包 — **DevCodex 已启用**（有正文 + 完成门）；无正文 / softCap fail-open 仍属 cannotClaim 残余（U-A4 partial）

跟踪清单见维护者需求与 `scripts/fixtures/host-parity/unaligned-ledger.v1.json`。对应台账 ID：**U-A1～U-A4**。

## 相关链接

- [快速开始](/intro/#快速开始)
- [设计理念](/intro/philosophy)
- [维护者指南](/guide/)
