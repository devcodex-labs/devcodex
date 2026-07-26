# DevCodex v1.15.3 — 使用入口

> AI workflow injector for Copilot / Claude Code / Codex / Gemini / Grok · publisher: Rocky · version: 1.15.3

## 正式主支持客户端

- **Copilot CLI**：从用户级 instructions、Hooks、MCP、Skills 与稳定 runtime 加载；Copilot IDE workspace hooks 不在 GlobalOnlyWorkspaceCleanModeV1 首批范围。
- **Claude Code**：从用户级 `CLAUDE.md`、settings、MCP 与稳定 runtime 加载。
- **Codex**：从用户级 `.codex/AGENTS.md`、hooks、config 与用户级 `.agents/skills/` 加载；完整回退规范位于用户级 `.agents/devcodex/instructions.full.md`。
- **Gemini / Grok**：分别使用用户级 settings/runtime 与用户级 plugin/config/runtime；Grok 完整入口为 `devcodex grok`。

## 五宿主加载机制

DevCodex 同时支持五宿主的用户级加载路径，规则语义保持一致，由宿主决定实际生效方式：

- **Copilot CLI**：用户级 instructions/hooks/MCP/Skills/runtime，adapter 合同按 fixture 验证，原生 CLI 就绪由 `doctor` 深探针判定。
- **Claude / Gemini**：用户级 instruction/settings 投影，能力按 fixture ceiling 声明。
- **Codex**：用户级 `.codex/AGENTS.md` + hooks/config，并从用户级 `.agents/skills/*` 按需读取 Skill；不读取工作区 `.agents`。
- **Grok**：用户级 plugin/config/runtime；`devcodex grok` 用用户级 controlling kernel 启动。

无论哪条路径进入，所有 Instructions 均通过同一 `instructions.md` / instructions 目录派生。工作区只保留 `.devcodex`，不会因安装生成五宿主目录；已有目录也不会被自动删除。

## 宿主模式

- **Hook-First**：VS Code / Claude Code / Codex Hooks 可用时，通过对应宿主 hooks 承载 bootstrap、危险操作护栏和结束前兜底
- **Instruction-Fallback**：Hooks 不可用时，继续依赖 instructions / skills 承载软约束
- **当前实现**：npm 全局安装/升级通过 `postinstall` 更新用户级稳定 runtime、共享 full fallback 与 active Skills；共享 `.agents` 由单一事务 Owner 写入。bare `init/update` 只管理 workspace `.devcodex`，fresh workspace 会建立 `workspace-namespace` marker
- **全局唯一写入口**：`devcodex init --claude`、`devcodex init --codex` 及其他宿主 selector/alias 均返回 `CLI_HOST_CONFIG_GLOBAL_ONLY`。用户级宿主 adapter：源码仓优先 `devcodex global-adapters apply`（或 `npm install -g .` / pack+tarball）；已发布环境 `npm install -g` / `npm update -g`（postinstall）
- **就绪分层**：receipt 与文件存在只表示 `configured`；`status` 验证 adapter/静态合同，`doctor` 再验证可用原生 CLI、Grok canonical 唯一 identity、inspect 发现面、已安装 Hook 合同与 MCP initialize。任一合同或原生探针失败时不得标记 `ready`。
- **受管回执**：receipt 只绑定 DevCodex 管理的 instruction、hook、MCP 与 config segment；用户自有主题或其他宿主设置不构成 adapter 漂移，受管字段变化仍必须 fail closed 并由全局安装刷新。
- **诊断作用域**：源码仓中的 `status/doctor` 只能形成 `source-candidate-vs-installed-receipts` 候选比较，必须声明 `installedHealthClaim=false`，并抑制已安装包的 `checks/failedChecks/repairSteps`；真实全局健康结论只能由打包并安装后的候选在源码仓外形成。
- **Grok 收敛**：只允许官方 CLI 修改 plugin registry；已知受管 identity 可回滚收敛，未知同名来源必须在 mutation 前阻断。

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

