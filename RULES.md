# DevCodex v1.10.0 — 使用入口

> AI workflow injector for Copilot / Claude Code · publisher: Rocky · version: 1.10.0

## 正式主支持客户端

- **Copilot**：通过 `copilot-instructions.md` + `instructions/` 自动加载，无需选择 Agent；若宿主支持并启用 Hooks，还会通过 `.github/hooks/` 提供确定性的生命周期护栏。
- **Claude Code**：通过 `CLAUDE.md` + `.claude/{instructions,skills,prompts,hooks/_runtime,mcp}/` + `.mcp.json` 自动生效；MCP、hooks 与 permissions 由 `devcodex init --claude` 一并写入。
- Copilot 端默认分发 `.github/agents/` 作为可选显式入口；Claude Code 端仍通过 Skills 路由，不分发 agents。

## 双入口加载机制

DevCodex 同时支持两种加载路径，规则语义保持一致，由 IDE 决定实际生效方式：

- **默认路径**：Copilot 走 `.github/copilot-instructions.md` + `.github/instructions/*`；Claude Code 走 `CLAUDE.md` + `.claude/instructions/*`
- **Agent 路径（可选）**：`@devcodex` / `@devcodex-auto` — Copilot 端 `.github/agents/` 默认分发后可用，提供全自动模式（CP 自动通过）

无论哪条路径进入，所有 Instructions 均通过 `applyTo: "**"` 全局生效；在 VS Code 中，workspace hooks 作为额外的宿主硬门禁层工作，不替代规则语义层。

## 宿主模式

- **Hook-First**：VS Code Hooks 可用时，通过 `.github/hooks/` 承载 bootstrap、危险操作护栏和结束前兜底
- **Instruction-Fallback**：Hooks 不可用时，继续依赖 instructions / skills 承载软约束
- **当前首阶段实现**：Hook 运行时由 `init/update` 一并分发到 `.github/hooks/_runtime/`，不要求目标项目从 `node_modules/@vextjs/devcodex/...` 读取脚本

## 正式需求与执行模板边界

- **正式需求信源**：当前项目内的正式需求写在 `website/docs/versions/v1/<active-version>/requirements/`。
- **执行模板职责**：`prompts/*.prompt.md` 负责约束 CP1 / CP2 / CP3 产物结构，是默认执行模板，不替代当前项目的正式 requirement 入口。
- **项目规则优先**：如果项目已经定义自定义 requirement 规范，则项目规范优先，prompt 只提供通用骨架。
- **阶段边界**：CP1 看需求目标、用户交互与业务结果；CP2 看实现流程、公共契约、兼容性与边界问题；CP3 看实施顺序、验证、风险与回滚。

## 意图路由

| 意图 | 路由工作流 | 当前状态 |
|------|-----------|----------|
| 开发新功能 / 重构 / 优化 / 初始化 / 文档 | dev（8 子类型） | 当前全量开放 |
| Bug 修复 / 报错 / 线上事故 / 安全漏洞 | fix（3 子类型） | 当前全量开放 |
| 多轮分析（≥3轮）/ 技术调研 / 可行性评估 | analyze | 当前全量开放 |
| 深度审查 / 全面体检 / 逐项检查 | audit（6 子类型） | 当前全量开放 |
| 规范文件自修复 | self-fix | 当前全量开放 |
| 恢复/继续上次中断任务 | resume | 当前全量开放 |
| 不匹配上述意图 | plan（兜底） | 当前全量开放 |
| 纯问答 / 解释 | chat（快速路径） | 当前全量开放 |

> *Tier 标签目前仅保留为未来规划信息。当前版本 `token-check` 只是授权占位，不对任何工作流或子类型做 tier 阻断。*

## 安全底线

`00-safety.instructions.md` 全局自动注入，包含 S01~S07 七条不可覆盖的安全规则：
- **S01** 破坏性操作需确认 · **S02** 禁止硬编码凭据 · **S03** 禁止编造规范
- **S04** 禁止整文件覆写 · **S05** 记忆+报告自动写入 · **S06** 禁止危险命令 · **S07** dev 模式预检查强制输出 PC0~PC7


## 相关链接

- [GitHub 仓库](https://github.com/vextjs/devcodex)
- [变更日志](CHANGELOG.md)

