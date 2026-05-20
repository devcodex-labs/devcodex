# DevCodex v1.9.2 — 使用入口

> GitHub Copilot Agent Plugin · publisher: Rocky · version: 1.9.2

## 默认 Copilot 支持

安装后 Copilot 自动加载 DevCodex 规则（通过 `copilot-instructions.md` + `instructions/`），无需选择 Agent。
`v1.9.0` 起，若宿主支持并启用 Hooks，DevCodex 还会通过 `.github/hooks/` 提供确定性的生命周期护栏；若宿主不支持 Hooks，则自动回退到 instruction-fallback。
`v1.1.0` 起，CLI 不再向目标项目默认分发 `.github/agents/`。如果项目中仍存在 `.github/agents/`，属于历史残留，需要手动清理。

## 双入口加载机制

DevCodex 同时支持两种加载路径，规则语义保持一致，由 IDE 决定实际生效方式：

- **默认路径**：`.github/copilot-instructions.md` + `.github/instructions/*` — 通过 Copilot `Use Instruction Files` 自动注入，无需选择 Agent
- **Agent 路径（可选）**：`@devcodex` / `@devcodex-auto` — 项目侧手动保留 `.github/agents/` 时可用，提供全自动模式（CP 自动通过）

无论哪条路径进入，所有 Instructions 均通过 `applyTo: "**"` 全局生效；在 VS Code 中，workspace hooks 作为额外的宿主硬门禁层工作，不替代规则语义层。

## 宿主模式

- **Hook-First**：VS Code Hooks 可用时，通过 `.github/hooks/` 承载 bootstrap、危险操作护栏和结束前兜底
- **Instruction-Fallback**：Hooks 不可用时，继续依赖 instructions / skills 承载软约束
- **当前首阶段实现**：Hook 运行时由 `init/update` 一并分发到 `.github/hooks/_runtime/`，不要求目标项目从 `node_modules/@vextjs/devcodex/...` 读取脚本

## 意图路由

| 意图 | 路由工作流 | 授权 |
|------|-----------|------|
| 开发新功能 / 重构 / 优化 / 初始化 / 文档 | dev（8 子类型） | Free（部分子类型需 Pro）|
| Bug 修复 / 报错 / 线上事故 / 安全漏洞 | fix（3 子类型） | Free（incident/security 需 Pro）|
| 多轮分析（≥3轮）/ 技术调研 / 可行性评估 | analyze | Free |
| 深度审查 / 全面体检 / 逐项检查 | audit（6 子类型） | Free（项目工程需 Pro）|
| 规范文件自修复 | self-fix | Pro |
| 恢复/继续上次中断任务 | resume | Pro |
| 不匹配上述意图 | plan（兜底） | Pro |
| 纯问答 / 解释 | chat（快速路径） | Free |

> *Tier 标签为规划中功能，当前全功能开放；未来接入服务端校验时生效，不影响当前使用。*

## 安全底线

`00-safety.instructions.md` 全局自动注入，包含 S01~S07 七条不可覆盖的安全规则：
- **S01** 破坏性操作需确认 · **S02** 禁止硬编码凭据 · **S03** 禁止编造规范
- **S04** 禁止整文件覆写 · **S05** 记忆+报告自动写入 · **S06** 禁止危险命令 · **S07** dev 模式预检查强制输出 PC0~PC4


## 相关链接

- [GitHub 仓库](https://github.com/vextjs/devcodex)
- [变更日志](CHANGELOG.md)

