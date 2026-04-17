# DevCodex Agents

本目录保留两个 Agent 源文件，供 IDE 以 `@devcodex` / `@devcodex-auto` 方式调用。

&gt; ⚠️ **默认安装路径（`devcodex init` / `update`）不再分发 `.github/agents/`**（v1.1.0 起）。
&gt; 目标项目如需 Agent 入口，请手动拷贝本目录到 `.github/agents/`。

## Agent 对比

| Agent | 名称 | CP 门控 | 适用场景 |
|-------|------|:-------:|---------|
| `@devcodex` | 确认模式 | 🔴 CP1/CP2/CP3 逐项等待用户确认 | 开发/修复/审计的常规交互 |
| `@devcodex-auto` | 全自动模式 | ✅ CP 自动通过 | 批量任务、CI/CD 环境、信任度高的仓库维护 |

## 核心差异

**两种模式共享同一套规则集**（instructions/ + skills/ + prompts/ 完全一致），差异仅在 CP 门控行为：

| 维度 | @devcodex | @devcodex-auto |
|------|:---------:|:--------------:|
| S01~S06 安全底线 | 🔴 强制 | 🔴 强制（不可豁免）|
| C01（破坏性操作确认）| 🔴 强制 | 🔴 强制（不可豁免）|
| C10（危险命令）| 🔴 强制 | 🔴 强制（不可豁免）|
| CP1 需求确认 | 等待用户 | 自动通过 |
| CP2 方案确认 | 等待用户 | 自动通过 |
| CP3 实施计划 | 等待用户 | 自动通过 |
| 可恢复失败 | 正常询问 | 重试 ≤ 2 次，超限切回确认模式 |

## 使用建议

- **默认**：不引入 agents/，直接用 Copilot Chat（通过 instructions/ 自动注入规则）
- **高频维护**：引入 `@devcodex-auto`，在确保仓库可回滚的前提下加速执行
- **严格审查**：引入 `@devcodex`，确保每个关键节点有人工确认

## 与 Instructions 路径的关系

Agent 路径与默认 copilot-instructions 路径**两者规则完全一致**，由 IDE 决定实际生效方式（参见 `RULES.md §双入口加载机制`）。选择 Agent 路径不会改变 Instructions 的优先级与加载顺序。
