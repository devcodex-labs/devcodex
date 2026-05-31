# DevCodex Agents

本目录保留两个 Agent 源文件，供 IDE 以 `@devcodex` / `@devcodex-auto` 方式调用。

> ✅ **v1.9.8 起恢复 Copilot 端默认分发**：`devcodex init` / `update` 会自动安装到 `.github/agents/`。  
> ⚠️ **Claude Code 端不分发**：Claude Code 平台不识别 Copilot agent frontmatter schema（`disable-model-invocation` / `tools` 枚举），且 Claude Code 主推 Skill 路径（通过 Skill 工具调用 `.claude/skills/<name>/SKILL.md`），不需要 agent 入口。

## Agent 对比

| Agent | 名称 | CP 门控 | 适用场景 |
|-------|------|:-------:|---------|
| `@devcodex` | 确认模式 | 🔴 CP1/CP2/CP3 逐项等待用户确认 | 开发/修复/审计的常规交互 |
| `@devcodex-auto` | 全自动模式 | ✅ CP 自动通过 | 批量任务、CI/CD 环境、信任度高的仓库维护 |

## 核心差异

**两种模式共享同一套规则集**（instructions/ + skills/ + prompts/ 完全一致），差异仅在 CP 门控行为：

| 维度 | @devcodex | @devcodex-auto |
|------|:---------:|:--------------:|
| S01~S07 安全底线 | 🔴 强制 | 🔴 强制（不可豁免）|
| C01（破坏性操作确认）| 🔴 强制 | 🔴 强制（不可豁免）|
| C10（危险命令）| 🔴 强制 | 🔴 强制（不可豁免）|
| C18（预检查不可跳过）| 🔴 dev模式强制 | 🔴 强制（不可豁免）|
| CP1 需求确认 | 等待用户 | 自动通过 |
| CP2 方案确认 | 等待用户 | 自动通过 |
| CP3 实施计划 | 等待用户 | 自动通过 |
| ExecutionContract | 条件触发 | 控制面 / 多批次 / 预计修改 ≥10 文件 / release 前置任务强制 |
| 可恢复失败 | 正常询问 | 重试 ≤ 2 次，超限切回确认模式 |

## 使用建议

- **默认**：保留 `devcodex init/update` 自动分发的 `.github/agents/`；日常可直接用 Copilot Chat，只有需要显式入口时再 `@devcodex` / `@devcodex-auto`
- **高频维护**：引入 `@devcodex-auto`，在确保仓库可回滚的前提下加速执行
- **严格审查**：引入 `@devcodex`，确保每个关键节点有人工确认
- **长流程任务**：无论确认模式还是 Auto，命中控制面、多批次、预计修改 ≥10 文件或正式发版时，都应把 ExecutionContract / TestRoute / ReleaseVerification 写入报告证据

## 与 Instructions 路径的关系

Agent 路径与默认 copilot-instructions 路径**两者规则完全一致**，由 IDE 决定实际生效方式（参见 `RULES.md §双入口加载机制`）。选择 Agent 路径不会改变 Instructions 的优先级与加载顺序。

## 与 `plugin.json` 的边界

- `agents/*.agent.md` 是 **Copilot 兼容的显式 Agent 入口**，解决的是“用户如何显式选择 `@devcodex` / `@devcodex-auto`”。
- `plugin.json` 是 **DevCodex 内部注册表**：用于描述 skills / instructions / prompts / agents 的分发与打包元数据，不是 Copilot、Claude Code 或 Codex 直接读取的 Agent 入口文件。
- 维护时若看到两处都提到 Agent，不应混为同一层：`.agent.md` 负责“入口体验”，`plugin.json` 负责“包内清单与元数据”。
