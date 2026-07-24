# DevCodex v1.15.3 — 使用入口

> AI workflow injector for Copilot / Claude Code / Codex · publisher: Rocky · version: 1.15.3

## 正式主支持客户端

- **Copilot**：从用户级 Copilot instructions 加载；IDE workspace hooks 不在 GlobalOnlyHostConfigModeV1 首批范围。
- **Claude Code**：从用户级 `CLAUDE.md`、settings、MCP 与稳定 runtime 加载。
- **Codex**：从用户级 `.codex/AGENTS.md`、hooks、config 与用户级 `.agents/skills/` 加载。
- **Gemini / Grok**：分别使用用户级 settings/runtime 与用户级 plugin/config/runtime；Grok 完整入口为 `devcodex grok`。

## 五宿主加载机制

DevCodex 同时支持五宿主的用户级加载路径，规则语义保持一致，由宿主决定实际生效方式：

- **Copilot / Claude / Gemini**：用户级 instruction/settings 投影，能力按 fixture ceiling 声明。
- **Codex**：用户级 `.codex/AGENTS.md` + hooks/config，并从用户级 `.agents/skills/*` 按需读取 Skill。
- **Grok**：用户级 plugin/config/runtime；`devcodex grok` 用用户级 controlling kernel 启动。

无论哪条路径进入，所有 Instructions 均通过同一 `instructions.md` / instructions 目录派生。工作区只保留 `.devcodex`，不会因安装生成五宿主目录；已有目录也不会被自动删除。

## 宿主模式

- **Hook-First**：VS Code / Claude Code / Codex Hooks 可用时，通过对应宿主 hooks 承载 bootstrap、危险操作护栏和结束前兜底
- **Instruction-Fallback**：Hooks 不可用时，继续依赖 instructions / skills 承载软约束
- **当前实现**：npm 全局安装/升级通过 `postinstall` 更新用户级稳定 runtime；bare `init/update` 只管理 workspace `.devcodex`
- **全局唯一写入口**：`devcodex init --claude`、`devcodex init --codex` 及其他宿主 selector/alias 均返回 `CLI_HOST_CONFIG_GLOBAL_ONLY`；宿主 adapter 通过 `npm install -g devcodex` 或 `npm update -g devcodex` 管理

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
| 深度审查 / 全面体检 / 逐项检查 | audit（7 目标类型） | 当前全量开放 |
| 规范文件自修复 | self-fix | 当前全量开放 |
| 恢复/继续上次中断任务 | resume | 当前全量开放 |
| 不匹配上述意图 | plan（兜底） | 当前全量开放 |
| 纯问答 / 解释 | chat（快速路径） | 当前全量开放 |

> *Tier 标签目前仅保留为未来规划信息。当前版本 `token-check` 只是授权占位，不对任何工作流或子类型做 tier 阻断。*

## 安全底线

`00-safety.instructions.md` 全局自动注入，包含 S01~S07 七条不可覆盖的安全规则：
- **S01** 破坏性操作需确认 · **S02** 默认允许敏感信息与硬编码，按用户 / 项目显式策略处理 · **S03** 禁止编造规范
- **S04** 禁止整文件覆写 · **S05** 记忆+报告自动写入 · **S06** 禁止危险命令 · **S07** 全模式入口检查强制输出 PC0~PC7（dev 模式追加 PC4 完整诊断）


## 相关链接

- [GitHub 仓库](https://github.com/vextjs/devcodex)
- [变更日志](CHANGELOG.md)

