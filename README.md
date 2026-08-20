# DevCodex — 意图驱动的 AI Coding 工作流运行时

[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

> **让 AI 编程从一次性聊天，变成可验证、可续接的工程流程。**

DevCodex 是面向 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor 的意图驱动 AI Coding 工作流运行时。它先识别任务目的、目标项目和风险，再按需加载项目 Profile、上下文、记忆和专业 Skill，并把确认、执行、验证、报告与任务续接组织成一套共享工作流模型。

本地优先、文件支撑的控制层与六宿主适配包，把项目上下文、专业 Skill、确认、验证和报告闭环带入多个 AI Coding 宿主。作为工作流运行时和宿主适配包，它协调工程流程，不托管模型。

- 按任务意图选择工作流、上下文与专业 Skill
- 把需求、确认、实现、验证、报告和续接形成可追踪闭环
- 在六个 AI Coding 宿主间保持一致流程，同时诚实保留能力差异

```bash
npm install -g devcodex
cd <你的项目根目录>
devcodex init
devcodex status
```

安装命令只会获取 npm registry 上的版本；不要把本地候选、未推送提交或 `main` 上的最新源码误认为已经发布。安装或更新后，请完全退出旧会话，再从目标项目打开宿主的新会话。

### DevCodex 不是什么

- 它不是模型网关，不代理或托管模型调用。
- 它不是通用 Agent 框架，也不是多 Agent 编排器。
- 它不替代业务框架、GitHub CI、安全审计或人工评审。
- 它不保证六个宿主拥有完全相同的 Hook、MCP、插件、权限或生命周期事件。

“本地优先”表示工作流状态、Profile、报告、记忆和工作区 Skill 以本地文件保存；模型执行和数据处理仍遵循所选 AI Coding 宿主的规则。

README 只保留安装、定位和必要边界；完整教程与持续更新的参考以 [DevCodex Docs](https://devcodex-labs.github.io/devcodex/) 为准：

- [5 分钟开始](https://devcodex-labs.github.io/devcodex/guide/getting-started)
- [四个任务教程](https://devcodex-labs.github.io/devcodex/tutorials/ambiguous-request)
- [CLI 命令](https://devcodex-labs.github.io/devcodex/reference/cli)
- [故障排查](https://devcodex-labs.github.io/devcodex/guide/troubleshooting)
- [信任、安全与数据](https://devcodex-labs.github.io/devcodex/guide/trust-security-data)

## 为什么需要 DevCodex？

真实工程任务往往跨文件、跨轮次、跨宿主：新会话缺少项目背景，长任务容易断层，项目规范难复用，验证也容易被一句“完成了”替代。

DevCodex 把意图识别、按需上下文、专业 Skill、确认边界、验证、报告和续接放进同一条流程，让 AI 在明确项目与证据范围内工作。

<!-- devcodex-public:capability-scenarios:start -->
## 安装后，你能解决什么？

安装后获得按任务渐进加载的预置专业 Skill 组合，而不是从零手写每一套流程。下面四类结果由现有 active Skill 约束；它们是代表性路径，不是一次全量加载。

### 1. 需求说得不完整，不知道该先分析、立项还是直接修改。

- **得到什么**：先明确目标、边界、验收和下一步，再进入合适的工作流。
- **代表专业流程**：意图识别、需求与验收、风险驱动验证（intent、dev-default、quality-strategy）
- **诚实边界**：具体路径由任务意图与风险决定；并非每次都加载全部 Skill。

### 2. 只知道报错，却不知道根因、同类路径和回归范围。

- **得到什么**：获得复现、根因、同类检查和定向验证，而不止是一段解释。
- **代表专业流程**：复现与根因、回归范围、用户路径验证（fix-default、test-router、frontend-architecture）
- **诚实边界**：代表 Skill 只在适用阶段加载；不承诺全量修复能力常驻。

### 3. 需求跨前端、业务和接口，宿主的通用提示难以划清责任边界。

- **得到什么**：在适用时获得架构、接口和实现边界的专业路径。
- **代表专业流程**：前端体验、业务领域、API 契约（frontend-architecture、backend-domain-architecture、api-contract-architecture）
- **诚实边界**：是否进入各专业路径取决于真实任务，不把目录展示当作已加载事实。

### 4. 交付前需要测试、排错、交接，下一会话却容易丢失上下文。

- **得到什么**：让风险、验证、报告和续接状态都留下可查证据。
- **代表专业流程**：质量策略、交付准备、文档同步（quality-strategy、production-readiness-sre、document-sync）
- **诚实边界**：不替代人工发布授权、宿主权限或既有 CI。
<!-- devcodex-public:capability-scenarios:end -->

## 什么时候直接使用宿主，什么时候用 DevCodex？

| 场景 | 更合适的选择 | 原因 |
|---|---|---|
| 一次性问答、短小编辑、只依赖某个宿主特有工具 | 直接使用宿主 | 宿主原生能力最快；不需要额外的任务状态或验证链。 |
| 跨文件修改、需要先澄清范围或验收 | DevCodex | 把意图、项目上下文、专业流程和确认边界放到同一条可追踪路径。 |
| 修复问题且担心同类回归 | DevCodex | 把复现、根因、同类检查和定向验证连成闭环，而不是只生成一个解释。 |
| 换宿主、换会话、多人接力或需要留下证据 | DevCodex | 项目级记忆、报告和任务状态让后续会话可以基于文件继续。 |

两者不是替代关系：宿主提供模型、编辑器和原生工具；DevCodex 在适用的工程任务上增加按需专业 Skill、项目边界、验证与续接。它不接管宿主自己的 Skill、指令或个人配置。

## 它如何工作？

用户请求 → 意图与项目边界 → 有界 Profile/记忆/源码 → 当前阶段 Skill → 只读结论或确认后写入 → 验证、报告与续接。逐步说明见[架构](https://devcodex-labs.github.io/devcodex/concepts/architecture)。

## 5 分钟开始

```bash
npm install -g devcodex
cd <你的项目根目录>
devcodex init
devcodex status
```

需要 Node.js `>=18.17.0` 和 npm。`devcodex init` 创建 `.devcodex/` 运行态；安装生命周期中刷新用户级宿主适配，但安装本身不修改业务源码。安装或更新后必须重新打开宿主的新会话。第一个任务：

```text
分析当前项目最应该先改进的三个问题。只分析，不修改文件。
```

入口、预期结果和失败恢复见[5 分钟开始](https://devcodex-labs.github.io/devcodex/guide/getting-started)。

## 安装会改变什么

| 位置 | 行为 |
|---|---|
| 用户 HOME | 安装或刷新 DevCodex 管理的六宿主适配器 |
| 项目 / workspace | 执行 `devcodex init` 后创建 `.devcodex/` |
| 项目源码 | 安装本身不自动修改 |
| 后台服务 | 普通使用不启动常驻网络服务 |
| 宿主原生资产 | 不扫描、复制、合并、覆盖或删除 |

正式 auto 入口是 `@devcodex-auto`，`@rocky` 是默认快捷别名。`extensions.devcodex.autoAliases` 的非空数组会替换默认别名，空数组 `[]` 会关闭默认别名；auto 不扩大删除或发布权限。多项目与 Profile 设置见[配置](https://devcodex-labs.github.io/devcodex/reference/configuration)。

## 工作流、Skill 与宿主边界

<!-- devcodex-public:workflows primary=dev,fix,analyze,audit,resume,chat advanced=self-fix,other -->
<!-- devcodex-public:skills total=86 active=83 gray=3 bucket=80+ categories=workflow-routing:20,domain-architecture:21,quality-delivery:28,runtime-governance:17 -->
<!-- devcodex-public:hosts ids=copilot,claude,codex,gemini,grok,cursor variants=13 -->
<!-- devcodex-public:auto canonical=@devcodex-auto default=@rocky profile-replacement=true empty-array-disables=true -->
<!-- devcodex-public:capabilities ids=turn-ambiguous-request-into-action,fix-with-regression-confidence,evolve-cross-domain-change,deliver-with-evidence-and-handoff -->

六个主工作流面向日常任务，两个高级工作流只用于治理或兜底：

| 层级 | 工作流 | 用途 |
|---|---|---|
| 主 | `dev` | 开发或重构 |
| 主 | `fix` | 复现、定位并修复 |
| 主 | `analyze` | 只读分析 |
| 主 | `audit` | 证据化审查 |
| 主 | `resume` | 从文件状态续接 |
| 主 | `chat` | 普通交流 |
| 高级 | `self-fix` | 修复 DevCodex 自身流程 |
| 高级 | `other` | 无法安全归类时规划 |

`plan` 是阶段或能力，不是第九个 canonical workflow。

当前机器事实为 **86 个 Skill（83 active + 3 gray）**；公开摘要使用 **80+**。四类 bundled Skill 按任务与阶段渐进加载：

<!-- devcodex-public:skill-categories:start -->
| Bundled 分类 | 数量 | 代表 active Skill |
|---|---:|---|
| [Workflow & Routing](https://devcodex-labs.github.io/devcodex/reference/skills?category=workflow-routing) | 20 | `intent`、`dev-default`、`fix-default`、`audit-common` |
| [Domain & Architecture](https://devcodex-labs.github.io/devcodex/reference/skills?category=domain-architecture) | 21 | `product-strategy`、`frontend-architecture`、`backend-domain-architecture`、`data-architecture` |
| [Quality & Delivery](https://devcodex-labs.github.io/devcodex/reference/skills?category=quality-delivery) | 28 | `quality-strategy`、`dev-testing`、`review-checklist`、`release-verification` |
| [Runtime & Governance](https://devcodex-labs.github.io/devcodex/reference/skills?category=runtime-governance) | 17 | `host-capability-routing`、`memory`、`skill-lifecycle-governance`、`spec-governance` |

Workspace Skill 是项目级扩展（`extensionSource=workspace`），不进入 bundled assignments，也不进入 86/83/3 分母。
<!-- devcodex-public:skill-categories:end -->

| 宿主 | 推荐入口 | 公开状态 |
|---|---|---|
| GitHub Copilot | Copilot CLI；VS Code / JetBrains 使用 instruction fallback | 入口能力不同，按精确宿主证据执行 |
| Claude Code | Claude Code | Full（以当前 direct evidence 为上限） |
| Codex | Codex App / CLI | Beta（Hook / MCP 取决于宿主配置） |
| Gemini CLI | Gemini CLI | Beta / UNVERIFIED（需要 direct replay 才能升级） |
| Grok | `devcodex grok` | Full launcher；普通 grok 为 Partial |
| Cursor | 本地 IDE / CLI | 本地 Beta；Cloud Partial / UNVERIFIED |

Rules / `AGENTS.md` 提供约束，Skills 提供专业流程，MCP 提供结构化工具与数据访问；三者由 DevCodex 协调，不构成简单替代关系。详见[工作流](https://devcodex-labs.github.io/devcodex/reference/workflows)、[Skill](https://devcodex-labs.github.io/devcodex/reference/skills)和[宿主边界](https://devcodex-labs.github.io/devcodex/reference/hosts)。

## 常见任务怎么说

请求最好同时说明目标、范围、约束、验证和是否提交：

```text
分析当前架构风险，给出证据和优先级。只分析，不修改文件。
```

功能、修复、审查、auto 和续接示例见[常见任务](https://devcodex-labs.github.io/devcodex/guide/common-tasks)与[四个教程](https://devcodex-labs.github.io/devcodex/tutorials/ambiguous-request)。只有明确写出 `push、tag、GitHub Release 和 npm publish`，才把对应发布动作纳入范围。

## 常见问题与排错

```bash
devcodex status
devcodex doctor --json
```

先区分 workspace、configured、contract 与 native evidence。按 typed issue 修复；`UNVERIFIED` 不等于失败。完整决策树见[故障排查](https://devcodex-labs.github.io/devcodex/guide/troubleshooting)和[状态与错误码](https://devcodex-labs.github.io/devcodex/reference/diagnostics)。

## 更新

```bash
npm update -g devcodex
devcodex --version
devcodex global-adapters apply
```

更新后重新打开宿主的新会话。

## 卸载

先预览，再显式清理 DevCodex 管理的六宿主资产，最后卸载 npm 包：

```bash
devcodex uninstall --dry-run
devcodex uninstall --apply
npm uninstall -g devcodex
```

用户自己的配置、指令和 Hook 会保留；若受管资产被修改或所有权无法验证，清理会失败关闭。不要先卸载 npm 包，否则安全清理命令会先消失。

## 边界

- DevCodex 不替代业务框架、GitHub CI、安全审计或人工评审。
- 宿主能力、权限与生命周期事件不同，不能互相继承验证结论。
- 安装不会把用户级宿主配置写进业务 workspace；项目侧只保存 `.devcodex/` 运行态。
- 工作区 Skill 只影响其所在项目或 workspace。
- 模型执行和数据处理仍遵循所选 AI Coding 宿主的规则。
- 更多限制见[限制与边界](https://devcodex-labs.github.io/devcodex/reference/limits)和[信任、安全与数据](https://devcodex-labs.github.io/devcodex/guide/trust-security-data)。

---

## 许可证

[AGPL-3.0](LICENSE)
