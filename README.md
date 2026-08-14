# DevCodex

[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

DevCodex 是面向 AI 编程宿主的工作流运行时和宿主适配包。它通过一个 npm 全局包，把上下文、记忆、80+ 内置 Skill、报告与验证闭环接入 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor（Beta），让不同宿主在同一个项目里按更一致的开发流程协作。

如果你经常遇到 AI 新会话忘记项目背景、长任务中途断线、不同宿主规则不一致、修复过程没有记录、验证结果说不清这些问题，DevCodex 的目标就是把“随口聊天式开发”变成有上下文、有流程、有记录、可继续的 AI 编程协作。

```bash
npm install -g devcodex
devcodex --version
```

安装或更新后，先在目标项目或工作区完成下方初始化与状态检查，再完全退出并重新打开宿主的新会话。

DevCodex 不替代业务框架、GitHub CI、安全审计或人工评审。它也不接管 Codex、Claude Code 等宿主原有的个人 Skill、项目指令或配置文件。

## 目录

- [为什么需要 DevCodex？](#为什么需要-devcodex)
- [DevCodex 解决什么问题？](#devcodex-解决什么问题)
- [核心特色](#核心特色)
- [它如何工作？](#它如何工作)
- [适合谁？](#适合谁)
- [5 分钟开始](#5-分钟开始)
- [项目 Profile](#项目-profile)
- [首次信任提示](#首次信任提示)
- [常见任务怎么说](#常见任务怎么说)
- [常见问题与排错](#常见问题与排错)
- [更新](#更新)
- [卸载](#卸载)
- [运行态检查](#运行态检查)
- [生效方式](#生效方式)
- [添加自己的 Skill](#添加自己的-skill)
- [与宿主原生 Skill 共存](#与宿主原生-skill-共存)
- [用户可见交付与链接兼容](#用户可见交付与链接兼容)
- [边界](#边界)
- [许可证](#许可证)

## 为什么需要 DevCodex？

AI 编程真正难的通常不是让模型写一段代码，而是让它在真实项目里稳定完成一个任务：

- 新会话不知道项目结构、约定、历史决策和当前进度。
- 长任务容易断在一半，下一轮很难准确接上。
- Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor 各有自己的配置和能力，项目规则很容易分散。
- 只有 prompt 或零散 Skill 时，缺少从需求、实现、验证到报告的闭环。
- 项目自己的流程、检查清单和团队约定很难跨宿主复用。

DevCodex 把这些能力组合成一个本地工作流入口：先理解当前任务，再按需读取上下文和记忆，选择合适的 Skill 与工作流，最后把关键过程、验证和结果沉淀下来。

## DevCodex 解决什么问题？

| 问题 | DevCodex 怎么处理 | 用户得到什么 |
|------|-------------------|--------------|
| 每次都要重新解释项目背景 | 按任务意图读取必要的项目上下文、历史记忆和相关源码 | 少重复说明，AI 更快进入有效状态 |
| 长任务和新会话容易断 | 把任务过程写入报告和文件记忆 | 后续会话可以围绕真实记录继续 |
| 多个 AI 宿主规则不一致 | 一个 npm 包刷新六个宿主的用户级适配 | 切换宿主时保留同一套工作流习惯 |
| 只有 prompt，没有执行闭环 | 开发、修复、分析、审计等任务都有过程、边界和验证记录 | 更容易复盘，也更容易发现“假完成” |
| 项目私有流程难复用 | 支持在项目里添加工作区 Skill | 你的流程、检查清单和团队约定可被六宿主共享 |

## 核心特色

| 特色 | 说明 |
|------|------|
| 六宿主一个入口 | 支持 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor（Beta）。不同宿主的 Hook、指令和插件能力不完全相同；DevCodex 会按宿主能力使用可用执行方式。 |
| 上下文按需进入会话 | 不把所有资料一股脑塞给 AI，而是根据当前任务选择必要的项目资料、记忆和源码线索。 |
| 文件记忆与长任务恢复 | 将关键过程写入当前项目的报告和记忆，减少“上一轮做到哪了”的断层。 |
| 长会话稳定性 | 当前任务提示保持有界，历史运行态不会随对话轮次无限注入；同一会话中的项目绑定会持续保留。 |
| 80+ 内置 Skill | 覆盖开发、修复、审计、发布、文档、架构、质量、安全、SRE、平台生态、产品与体验等专业场景。 |
| 报告与验证闭环 | 任务结束时沉淀结果、验证命令和剩余风险，让交付不是只靠一句“完成了”。 |
| 用户语言一致 | 回复、报告标题和面向用户的产物内容默认跟随当前用户消息；稳定命令、配置键、协议字段和默认文件名保持英文，便于跨语言兼容。 |
| 工作区 Skill | 用户可以在项目下添加自己的 Skill，让项目流程跨六宿主复用。 |
| 本地优先 | 安装包刷新本地用户级宿主适配；普通使用不需要启动额外后台服务。 |
| 原生资产共存 | DevCodex 不扫描、复制、合并、覆盖或删除这些用户资产。宿主自己的 Skill、项目指令和个人配置继续按原宿主规则生效。 |

## 它如何工作？

你仍然在熟悉的宿主里用自然语言发起请求。DevCodex 在新会话中按用户请求的意图进入开发、修复、分析、审计等流程，并按需加载内置 Skill 或工作区 Skill。

```text
用户请求
  → 判断任务意图
  → 读取必要上下文和记忆
  → 加载匹配的内置 Skill 或工作区 Skill
  → 执行开发 / 修复 / 分析 / 审计等流程
  → 输出结果、验证和报告
  → 写入记忆，方便后续会话继续
```

这里描述的是用户能感知的流程；不同宿主底层能力不同，DevCodex 会按当前宿主可用能力执行或回退。

## 适合谁？

- 同时使用 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 或 Cursor 的开发者。
- 经常让 AI 处理跨文件、跨轮次、需要验证的开发任务的人。
- 希望项目约定、检查清单、发布流程或团队规则能被 AI 稳定遵守的人。
- 想把自己的项目流程沉淀成可复用工作区 Skill 的用户。

## 5 分钟开始

### 系统要求

- Node.js `>=18.17.0`
- npm
- 至少一个受支持的 AI 编程宿主：Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 或 Cursor

### 安装 Node.js

先确认本机是否已有 Node.js 和 npm：

```bash
node -v
npm -v
```

如果命令不存在，安装 Node.js LTS：

- Windows / macOS：从 [Node.js 官方下载页](https://nodejs.org/en/download)安装 LTS 版本。
- macOS / Linux：也可以使用 nvm、fnm、asdf 等版本管理器安装 LTS 版本。

安装后重新打开终端，再确认：

```bash
node -v
npm -v
```

如果 Node.js 版本低于 18，请先升级 Node.js。

### 安装 DevCodex

npm 模块名称是 `devcodex`，不带组织 scope。

安装前建议确认 npm registry 上的版本与本文档对应；如果 registry 上的版本不是当前文档对应版本，不要把下面命令当作当前版本安装。

```bash
npm install -g devcodex
devcodex --version
```

然后进入你要使用的项目或工作区根目录，初始化 DevCodex 运行态：

```bash
cd <你的项目或工作区根目录>
devcodex init
```

如果你使用的是 `D:\Worker` 这类多项目 workspace，建议在 workspace 根目录执行一次 `devcodex init`，而不是分别在子项目里猜目录。DevCodex 会创建 `.devcodex/layout.json`、`.devcodex/workspace/` 和一份不会覆盖已有内容的 workspace Profile 基线；后续子项目的报告、记忆会按项目名稳定落到 `.devcodex/<project>/`，项目 Profile 缺失时回退到 workspace 层。

安装和初始化完成后，重新打开 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 或 Cursor 的新会话。

Grok 用户建议从目标项目目录通过 DevCodex 启动：

```bash
cd <你的项目或 workspace 根目录>
devcodex grok
```

`devcodex grok` 是 Grok Full 入口：它会加载用户级控制内核、项目绑定、MCP 与渐进式 SkillRoute。直接运行普通 `grok` 是 Partial 兼容入口；它仍可使用用户级规则、MCP 和可用 Hook，但 UserPromptSubmit 属于被动提示面，不能据此宣称与 Full 启动注入完全等价。

Cursor 当前是第六宿主 Beta。全局安装会写入用户级 `~/.cursor/hooks.json` 和 DevCodex Cursor Plugin；本地 IDE、交互 CLI 与 Headless CLI 共享 Hook、Plugin、MCP 和渐进式 SkillRoute。Cursor Cloud Agent 不加载用户级 Hook，因此只标记为 Partial / `UNVERIFIED`，不会继承本地 readiness 结论。能力依据见 [Cursor Hooks](https://cursor.com/docs/hooks)、[Cursor Plugins](https://cursor.com/docs/plugins) 与 [Cursor Headless CLI](https://cursor.com/docs/cli/headless)。

Cursor 与 Grok 同机安装时，`devcodex grok` 只在它启动的 Grok 子进程中关闭 Grok 对 Cursor Hooks 的兼容导入，避免 Grok 二次解析 `~/.cursor/hooks.json`；Cursor 官方 Hook 配置不会被改写，用户直接运行普通 `grok` 时的兼容偏好也不会被永久修改。

## 项目 Profile

普通单项目只需执行 `devcodex init`，无需再运行 Profile 命令。多项目 workspace 中，如果某个子项目需要独立于 workspace 基线的 Profile，可在 workspace 根目录按项目名初始化：

```bash
devcodex init --profile api
```

`api` 必须能唯一匹配 workspace 中已经存在的项目目录；`.devcodex` 尚不存在并不影响首次执行。如果多个项目使用相同末段名称，请改用从 workspace 根目录开始的相对名称，例如 `apps/api`。DevCodex 只从真实项目目录解析目标，不会把旧运行记录或构建产物误认成项目；目标不存在或不唯一时会直接报错，并且不会创建 `.devcodex`。

需要先确认目标和计划路径时，可加 `--dry-run`：

```bash
devcodex init --profile api --dry-run
```

这个预览不会创建目录、Profile、备份或运行态文件。确认后去掉 `--dry-run` 即可；正式执行会根据项目已有的包、测试、构建与公开接口选择合适的 Profile 档位，并且只生成缺失文件，不覆盖已经编辑过的内容。

`devcodex update` 只刷新运行态，不会自动创建、升级或降级 Profile。需要手动预览或指定档位时，才使用高级命令 `devcodex profile plan` / `devcodex profile init`。

## 首次信任提示

第一次在宿主里打开新会话时，宿主可能会提示是否信任或允许 DevCodex 管理的 Hooks、MCP、插件或本地命令。请允许 DevCodex-managed 项，然后重新打开一个新会话。

不同宿主的提示形式不完全一样：

| 宿主 | 可能看到的提示 | 建议 |
|------|----------------|------|
| Codex | Hooks、commands、MCP server、trust / allow | 允许 DevCodex-managed 配置 |
| Claude Code | settings、hooks、MCP 或本地命令确认 | 允许 DevCodex-managed 配置 |
| GitHub Copilot | MCP、工具或命令确认 | 允许 DevCodex-managed 配置 |
| Gemini CLI | settings、hooks 或命令确认 | 允许 DevCodex-managed 配置 |
| Grok | plugin、workspace 或本地命令确认 | 允许 DevCodex-managed 配置 |
| Cursor Beta | hooks、plugin、MCP 或本地命令确认 | 只允许 DevCodex-managed 项；Cloud Agent 仍按 Partial / `UNVERIFIED` 处理 |

如果拒绝这些提示，DevCodex 仍可能通过普通指令语义生效，但依赖 Hook、MCP 或插件的能力不会完整。DevCodex 只要求信任它自己管理的配置，不要求接管宿主原生 Skill、个人配置或业务项目指令。

### 第一次怎么用

在新的宿主会话里，直接用自然语言发起任务即可，例如：

```text
分析当前项目，告诉我最应该先改进的三个问题。
```

```text
阅读这个仓库，帮我修复当前失败的 GitHub CI。
```

DevCodex 会按任务意图选择流程和 Skill。普通使用者不需要手动配置内置 Skill。

如果当前宿主是 Grok，请在项目目录用 `devcodex grok` 打开该会话；不要把普通 `grok` 的 Partial 行为误判为内置 Skill 未安装。

如果当前宿主是 Cursor，请使用安装或更新后重新打开的本地 IDE / CLI 会话；不要把 Cursor Cloud Agent 的 Partial 行为当作本地 Beta 适配器故障。

### 自动推进：`@rocky`

如果你希望 DevCodex 在明确任务范围内自动继续执行，可以在请求里带上 `@rocky`：

```text
@rocky 阅读当前项目，修复失败的 CI，完成后提交。
```

`@rocky` 是全局默认 `@rocky` 自动推进别名。进入自动推进后，DevCodex 会在当前会话里尽量连续完成需求、实现、验证、报告等步骤；如果你想退出，直接说“退出 auto”或“exit auto mode”即可。

自动推进不等于无限授权：删除文件、不可逆操作、越过项目范围、需要外部确认的发布动作等仍会遵守 DevCodex 的安全边界。当前只有 Hook 支持且白名单路径提供 runtime 级硬保证；在只依赖指令回退的宿主中，DevCodex 会尽量按语义继续推进，但不承诺完全等价的自动放行。

如果你想改成自己的别名，在项目根目录创建或修改：

```text
<你的项目根目录>/.devcodex/workspace/profile/config.json
```

示例：

```json
{
  "extensions": {
    "devcodex": {
      "autoAliases": ["@team-auto"]
    }
  }
}
```

`extensions.devcodex.autoAliases` 用于替换全局默认别名；省略该字段表示继续使用默认 `@rocky`，设置为空数组 `[]` 表示关闭默认自动推进别名。

## 常见任务怎么说

你不需要记住工作流名称、Skill 名或内部阶段。直接说明任务目标即可；为了减少来回确认，推荐把请求写成：

```text
是否自动推进 + 目标或问题 + 范围与约束 + 验证要求 + 是否提交、推送或发布
```

### 只分析，不修改

```text
分析当前项目的主要问题，按优先级给出建议。只分析，不修改文件。
```

### 整理新需求，确认后再实施

```text
分析当前项目，整理“用户登录限流”需求，列出目标、范围、用户流程、验收标准和影响，先给我确认，不要修改源码。
```

确认需求后可以继续说：

```text
确认，按刚才的需求实施，完成后运行相关测试并提交。
```

### 诊断 Bug，但暂不修复

```text
检查支付回调偶发重复入账的问题，复现并定位根因，给出影响范围和修复方案。只诊断，不修改文件。
```

### 自动修复并验证

```text
@rocky 修复当前失败的 GitHub CI，检查是否还有同类问题，运行完整验证，完成后提交。
```

### 深度审查

```text
从用户体验、架构、兼容性、测试和发布风险审查当前实现，只报告有证据的问题，不修改文件。
```

### 在新会话继续任务

```text
继续<任务名>任务
```

例如：

```text
继续用户登录限流任务
```

### 明确要求发布

提交、push、tag、GitHub Release 和 npm publish 都属于独立动作。需要发布时请直接写明：

```text
@rocky 完成修复和全部验证后提交并推送 main，发布新的 patch 版本到 npm 和 GitHub Release，再用线上包重新安装验证。
```

几个实用技巧：

- 只想要结论时写清楚“只分析，不修改文件”。
- 指定项目、目录或文件范围，避免在多项目 workspace 中产生歧义。
- 写明必须运行的测试，或要求 DevCodex 根据影响范围选择验证。
- “完成”不自动等于 commit、push 或发布；这些动作需要在当前请求中明确写出。
- `@rocky` 只负责在已授权范围内自动推进，不会扩大删除、越界访问或发布权限。

## 常见问题与排错

### 安装最新版后，为什么没有需求概况、PC0~PC7 或 CP 流程？

这通常不是版本缺少流程，而是以下某一层尚未就绪：npm 包、用户级宿主适配器、当前 workspace 运行态，或者宿主新会话加载。

先进入真正要使用 DevCodex 的项目或 workspace 根目录，再检查状态：

```bash
cd <你的项目或 workspace 根目录>
devcodex status
```

按输出处理：

| `devcodex status` 输出 | 含义与处理 |
|------------------------|------------|
| Codex 显示 `adapter=not-ready` 或 `contract=failed` | 用户级 Codex 适配器未通过合同检查。完全退出 Codex Desktop 或 CLI 会话，然后执行下方的适配器刷新命令。 |
| `.devcodex not initialized` 或 Profile `missing` | 只表示当前终端所在目录没有 workspace 运行态。先确认目录正确；只有该目录确实是目标项目或 workspace 根时才执行 `devcodex init`。 |
| Codex 为 `adapter=ready; contract=passed`，且 `.devcodex present`、Profile `complete` | 安装与 workspace 已就绪。完全退出并重新打开宿主，在同一项目目录新建任务；不要继续使用修复前已经打开的旧任务。 |
| `native=unverified` | 只表示对应宿主的原生 CLI 探针未验证。若你使用的是 Codex Desktop，且 adapter/contract 已通过，这不是工作流阻断。 |
| workspace 显示 `host kernel not installed` | 当前版本的宿主入口安装在用户 HOME，不要求项目目录再保存一套宿主文件；只要上方用户级 adapter/contract 已通过，这不是故障。 |

修复用户级适配器：

```bash
devcodex global-adapters apply
devcodex status
```

初始化正确的项目或 workspace：

```bash
devcodex init
devcodex status
```

`devcodex status` 只检查当前目录。若你在用户 HOME 中运行它，看到 `.devcodex not initialized` 或 Profile `missing`，并不能说明另一个项目目录未初始化；除非 HOME 本身就是目标 workspace，否则不要在那里执行 `devcodex init`。

`devcodex update` 只刷新 workspace 运行态，不能替代 `devcodex global-adapters apply` 修复用户级适配器。Codex 会在每次新任务开始时构建一次指令链，因此适配器修复后必须新建任务，已打开的任务不会中途重新加载。参见 [OpenAI Codex 的 AGENTS.md 官方说明](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。

如果刷新后仍然失败，再运行：

```bash
devcodex doctor --json
```

Windows 使用 Scoop、NVM 或多套 Node.js 时，还应确认 `devcodex` 与 npm 全局目录属于同一套 Node.js：

```powershell
Get-Command devcodex
npm root -g
```

### Cursor 已安装 DevCodex，但为什么没有流程或 SkillRoute？

先在目标项目目录运行：

```bash
devcodex status
devcodex doctor --json
```

Cursor 行应至少显示 `adapter=ready; contract=passed`。`native=unverified` 是 Beta 的证据边界：它不等于适配器失败，也不能据此宣称本地 IDE、CLI 或 Headless 已完成真实模型回放。发布候选已使用官方 Cursor CLI 在隔离 HOME 中通过 `mcp list` / `mcp list-tools` 启动 memory/profile 两个 stdio server；这证明 Plugin、`${workspaceFolder}` 与 MCP 工具协商链可用，但没有登录的 CLI 仍不能替代 Hook/Skill 的端到端模型回放。若 adapter 或 contract 未通过，执行 `devcodex global-adapters apply`，完全退出 Cursor 后重新打开目标项目。

如果 Cursor 显示 `Submission blocked by hook`、`progressive-skill-route` 持续阻断、反复探索 `CallMcpTool` / `workspace.exe`，或 Hook 报 `returned no output`，请升级到 `devcodex >= 1.17.3`，执行 `devcodex global-adapters apply`，完全退出所有 Cursor 窗口后重新打开项目并新建对话。该故障来自旧版 Windows Hook 传输、恢复消息或多 generation 活动入口，不是“完全访问权限”未开启；不要为此开启完全访问，也不要把用户级 `.cursor` 复制到业务仓库。

DevCodex 的 Cursor 入口安装在用户 HOME：Hooks 位于 `~/.cursor/hooks.json`，动态 Plugin 位于 `~/.cursor/devcodex/plugins/devcodex-workspace`。业务项目里不应出现 `.cursor`、复制的 Hook 或第二套 Plugin；项目侧仍只保存 `.devcodex/` 运行态。

Cursor 本地 IDE、交互 CLI、Headless CLI 与 Cloud Agent 必须分开判断。Cloud Agent 不加载用户级 Hook，所以状态固定为 Partial / `UNVERIFIED`；不要通过放宽权限、复制 `.cursor` 到仓库或开启完全访问来伪造本地等价性。若本地流程未出现，请优先检查用户级 adapter/contract、`agent --version` 和新会话加载，而不是修改业务仓库。

Windows 上还可能存在同名命令碰撞：Cursor CLI 与其他工具都可能提供 `agent`。`doctor` 会先按 PATH/PATHEXT 查找 Cursor 官方安装同时提供的 `cursor-agent`（包括 `.cmd` / `.bat` 启动器），再回退到主命令 `agent`；这可避免 Node 跳过官方 `.cmd` 而误命中后面的 Grok `agent.exe`。如果 `cursor-agent --version` 可用、但 `agent --version` 输出 `grok ...`，DevCodex 可以识别 Cursor CLI，但你直接输入 `agent` 时仍会启动 Grok；请使用 `cursor-agent` 或调整 PATH 顺序。若两者都缺失或只识别到 Grok，`doctor` 会返回对应的 unavailable / `HOST_NATIVE_IDENTITY_MISMATCH`，不能把“某个 agent 命令能执行”当成 Cursor native 已就绪。

### Grok 能看到 Skill 或 MCP，但为什么没有加载 Skill 正文？

先确认入口。Grok Full 入口是：

```bash
cd <你的项目或 workspace 根目录>
devcodex grok
```

普通 `grok` 是 Partial 兼容入口。新版本会在 PreToolUse 阶段阻止“路由尚未决策就执行无关工具”，但普通入口的被动 UserPromptSubmit 仍不等价于 `devcodex grok` 的完整 `--rules` 启动内核。

正文加载的权威成功回执是 `StageLoadReceiptV1`，项目中没有 `SkillLoadSuccessV1`。只看到 catalog 或 `SkillRouteCommitReceiptV1`，表示候选目录或路由决策已完成，不表示 entry/execution/closeout 正文已经全部加载。

按下面顺序恢复：

```bash
devcodex status
devcodex doctor --json
devcodex global-adapters apply
devcodex grok
```

在目标项目目录中新建 Grok 会话后再验证。若 `status` 显示 `Grok parity full-capable — use: devcodex grok`，这正是在提示应走 Full 入口；它不是权限不足，也不要求永久开启完全访问。

### “帮我审批”时反复重新连接，是否必须开启完全访问？

不需要永久开启 Full access。“帮我审批”仍受 workspace 沙箱约束；它只决定符合条件的越界动作如何审批，不会自动扩大文件系统或可执行文件范围。先运行：

```powershell
Get-Command node
node --version
devcodex doctor
devcodex doctor --json
```

重点看两类诊断：

| 诊断 | 含义与恢复 |
|------|------------|
| `node runtime BLOCK (... reason=sandbox-exec-denied)` | ambient Node launcher 在 DevCodex JavaScript 启动前被沙箱拒绝，Hook 此时无法自我恢复。对该 launcher 做一次明确审批，或改用路径稳定、可受信任的系统 Node，然后重跑 `devcodex doctor`。Volta、NVM、FNM、asdf 等 shim 更新物理路径后可能需要重新批准。 |
| 某个宿主为 `unverified`，JSON 含 `GLOBAL_HOST_TARGET_UNVERIFIED` / `sandbox-read-denied` | 只表示该用户级宿主目录在当前沙箱中不可读；其他宿主仍会继续检查。批准读取该目录后重试即可，不代表必须给整个 Codex 完全访问权限。 |

如果界面只显示 Skill Route `blocked` 或一个待执行 `nextCall`，它表达的是工作流仍有待办，不足以证明是权限问题；`BUDGET_BLOCKED` 则表示当前路由预算耗尽且没有可执行恢复动作，同样不是权限证据。`REBIND_SEMANTIC_DRIFT` 表示刷新后的任务语义已经改变，旧路由会立即退役且不再重试；下一条真实用户消息会建立新路由。新版本会把可见恢复信息压缩为当前精确动作或 typed 状态，完整 `NextActionEnvelopeV1` 只保留在结构化机器字段中；不会自动重放修改性操作。

若更新后仍看到整段原始 envelope 或旧的重复提醒，通常是旧任务仍绑定启动时运行态。执行：

```bash
npm update -g devcodex
devcodex global-adapters apply
devcodex doctor
```

然后完全关闭旧任务并新建任务。完全访问可以作为短时诊断对照，但不是默认修复方案。

### 为什么 `.devcodex` 或工作区里会出现很多 `tmp` / `.tmp-*` 目录？

这通常来自旧版安装备份、测试/审计脚本自行拼接路径，或任务把一次性脚本放进了需求目录。集中工作区的新写入只允许进入：

```text
<workspace>/.tmp/devcodex/
```

这里的 `<workspace>` 是当前打开工作区的物理根；无集中布局的单项目把项目根视为 workspace。从工作区根、项目子目录或 `.devcodex` active-root 调用时必须得到同一个根。旧 `.devcodex/workspace/.tmp/` 与 `<project>/.devcodex/.tmp/` 只作为遗留只读输入报告，不能继续写入。先执行：

```bash
devcodex tmp status
devcodex tmp prune --dry-run
```

只有带 `WorkspaceTempManifestV1`、owner/type 可识别、TTL 已到期、没有活动 lease，且备份事务已完成的对象才会成为候选。确认后再执行 `devcodex tmp prune --apply`。一次状态检查的 canonical 文件/目录与 legacy 目录观察共用 10,000 项相关对象上限；四个 artifact 分区根不能被 manifest 整体认领，unknown owner、共享/损坏 lease、未知分区、lock、reparse point、路径逃逸、不完整备份和扫描截断都会保持 blocked。DevCodex 只拥有 `.tmp/devcodex/`：`.tmp/` 容器、`.tmp/<other-producer>/`、工作区根的 `tmp/.tmp-*` 以及 `.tmp.drive*` 外部传输 spool 都不进入 DevCodex ownership、blocked 列表或 `--apply` 删除集合；它们必须由各自生产者盘点并取得独立删除授权。

### 为什么全局安装包里没有源码仓的全部 `test:*` / 发布脚本？

npm 安装包是面向使用者的运行时，不是维护者源码仓镜像。源码中的测试、benchmark、生成器和发布编排脚本只在仓库中使用；最终安装包只公开安装生命周期、`npm run validate` 与 `global-adapters` apply/remove 脚本。保留下来的每个入口都会从最终 tarball 的 `package.json` 重新建立运行依赖闭包，并通过真实 `pack → 隔离安装 → validate → self-pack` 门禁。

如果你要开发或发布 DevCodex，请克隆源码仓并在源码根运行维护脚本；不要把全局安装目录当成开发 checkout。若安装包中的 `npm run validate` 或 `npm pack` 报 `MODULE_NOT_FOUND`，这是发布包完整性故障，应升级到修复版本并提交完整输出，不需要通过开启完全访问权限来绕过。

## 更新

```bash
npm update -g devcodex
devcodex --version
```

更新完成后，重新打开宿主的新会话。更新不会强制中断已经打开的会话，也不会让它在任务中途切换版本；让当前会话自然结束，新会话会使用更新后的 DevCodex。

## 卸载

先预览 DevCodex 在六个宿主和共享运行时中的受管内容：

```bash
devcodex uninstall --dry-run
```

确认预览中没有所有权冲突后，显式清理受管 Hook、MCP、指令块、Plugin 和运行时，再卸载 npm 包：

```bash
devcodex uninstall --apply
npm uninstall -g devcodex
```

`devcodex uninstall` 是 `devcodex global-adapters remove` 的简写；不带 `--apply` 时也只预览。清理命令会跨 Copilot、Claude、Codex、Gemini、Grok、Cursor 做一次完整预检，只有收据与当前内容共同证明属于 DevCodex 的对象才进入同一原子事务。用户自己的配置、指令和 Hook 会保留；受管文件被修改、出现未知文件、路径越界、符号链接或收据损坏时，所有宿主均保持不变并返回阻断原因。Grok 官方卸载为回滚生成的短期工作区备份只在六宿主事务成功后按 manifest 与摘要精确清除，失败时保留并报告；命令只逐级回收已经为空的受管子目录，绝不会递归删除 `.copilot`、`.claude`、`.codex`、`.gemini`、`.grok`、`.cursor` 或 `.agents` 宿主根目录。

如果当前安装版本还没有 `devcodex uninstall --dry-run`，先执行 `npm update -g devcodex` 安装带清理能力的版本，再按上述顺序卸载。不要先执行 npm 卸载：npm 只移除包和命令 shim，无法在包已消失后安全识别宿主内哪些内容由 DevCodex 管理。清理成功后重复执行会返回 `already-absent`。

## 运行态与临时产物检查

需要排查空间占用或旧电脑遗留的运行态时，可以查看各类状态的负责人、文件数、体积和最后使用时间：

```bash
devcodex runtime status
devcodex runtime prune --dry-run
```

清理命令默认只预览。确认列表后使用 `devcodex runtime prune --apply`；它只清理达到保留期限的原子写入临时文件，不会自动删除锁文件、当前任务状态或无法识别的文件。

工作区临时产物使用独立命令，不与 `.runtime-state` 混删：

```bash
devcodex tmp status --json
devcodex tmp prune --dry-run
devcodex tmp prune --apply
```

`tmp prune` 无参数时等价于 `--dry-run`。所有布局的 canonical root 都是 `<workspace>/.tmp/devcodex/`，按 `runs/cache/backups/leases/quarantine/manifests` 分区；安装器和宿主配置备份会先验证 canonical/partition 非 reparse，再写入 `backups/<project>/` 并登记保留期限。对象删除时会同步回收其唯一且已过期的 lease；共享 lease 保持 blocked。旧 `.devcodex/**/.tmp` 和没有 manifest 的历史内容只报告，不会被自动迁移或删除。

## 生效方式

安装或更新 DevCodex 后，npm 会在安装生命周期中刷新用户级宿主适配。已打开的宿主会话会继续使用它启动时已经加载的版本，不会被更新过程强制终止；更新后的配置由新会话读取，因此完成安装或更新后请重新打开一个新会话。

DevCodex 内置 Skill 随安装包一起提供。普通使用者不需要手动配置内置 Skill；新会话开始后，DevCodex 会按请求意图自动选择需要的 Skill。

DevCodex 分两层生效：

| 层 | 位置 | 用途 |
|----|------|------|
| 用户级宿主适配 | 用户 HOME 下的 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok、Cursor 配置目录 | 让六个宿主知道 DevCodex 的入口、指令、Hook、MCP 或插件配置 |
| 工作区运行态 | 当前项目或 workspace 根目录下的 `.devcodex/` | 保存当前项目的 Profile、报告、记忆、任务状态和工作区 Skill |

单项目时，运行态通常在：

```text
<项目根目录>/.devcodex/
```

多项目 workspace 推荐在 workspace 根目录执行 `devcodex init`。初始化后，运行态通常是：

```text
<workspace根目录>/.devcodex/
  layout.json
  workspace/
    profile/    # init 自动创建：workspace 级 Profile 基线
    .runtime-state/ # DevCodex 管理的派生状态；不要手动编辑
    skills/     # 按需创建：workspace Skill
  <project>/
    profile/    # 按需创建：项目 overlay
    reports/
    .memory/
```

这样你在 `<workspace根目录>/<project>` 中开启会话时，DevCodex 有一个清晰、可验证的目录基线，不会把报告、记忆或 Profile 写到不稳定的 legacy 位置。

## 添加自己的 Skill

如果你希望为某个项目增加自己的流程、检查清单或团队约定，可以创建 DevCodex 工作区 Skill。

这里的 Skill 属于 DevCodex 工作区层，不是某个宿主的原生 Skill。新会话开始后，DevCodex 会读取它，并可在 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor 中按意图触发；Grok 请优先使用 `devcodex grok` Full 入口，Cursor Cloud Agent 仍受 Partial / `UNVERIFIED` 边界限制。

单项目时，可以放在项目根目录：

```text
<你的项目根目录>/
  .devcodex/
    workspace/
      skills/
        <id>/
          SKILL.md
          intent.json
```

多项目 workspace 时，请放在 workspace 根目录：

```text
<workspace根目录>/
  .devcodex/
    workspace/
      skills/
        <id>/
          SKILL.md
          intent.json
```

例如：

```text
my-app/
  .devcodex/
    workspace/
      skills/
        release-check/
          SKILL.md
          intent.json
```

`SKILL.md`：

```md
---
name: release-check
description: >
  当用户准备发布版本、检查 changelog、tag、npm publish 或 GitHub release 时使用。
---
# release-check

## 步骤
1. 检查版本号、变更记录和发布分支。
2. 运行项目约定的测试与打包命令。
3. 输出发布前风险和下一步。
```

`intent.json`：

```json
{
  "schemaVersion": "SkillIntentV1",
  "skillId": "release-check",
  "intents": [
    {
      "id": "release",
      "label": "发布检查",
      "include": ["发布", "release", "tag", "npm"]
    }
  ],
  "examples": {
    "positive": ["帮我发版前检查", "准备 npm publish"],
    "negative": ["修复登录 bug", "解释这个函数"]
  },
  "summary": "发布前检查版本、changelog、tag、测试、打包和发布风险。"
}
```

新建或修改后，重新打开会话，或在后续请求中自然触发相关意图。

## 与宿主原生 Skill 共存

Codex、Claude Code 等宿主自己的项目指令、个人 Skill 和配置文件继续按宿主原有规则生效。

DevCodex 不扫描、复制、合并、覆盖或删除这些用户资产。即使名称相同，宿主原生 Skill 也不视为 DevCodex 所有。

如果希望六个宿主通过 DevCodex 使用同一套能力，写 DevCodex 工作区 Skill：

```text
<你的项目根目录>/.devcodex/workspace/skills/<id>/SKILL.md
```

多项目 workspace 时，把上面的 `<你的项目根目录>` 换成 workspace 根目录。

如果只希望某个宿主单独使用，继续使用该宿主自己的 Skill 或指令机制。

## 用户可见交付与链接兼容

DevCodex 会尽量按当前宿主支持的方式输出报告、记忆和产物链接：宿主支持点击时给出可点击链接，不支持时给出可复制路径。

如果你在宿主日志或调试输出中看到 `profile_load`、`invoke` 等字样，通常表示 DevCodex 正在通过本地工具读取项目 Profile 或调用本地能力；普通使用者不需要手动执行这些内部动作。

## 边界

- DevCodex 不替代业务框架、GitHub CI、安全审计或人工评审。
- 不同宿主的 Hook、指令和插件能力不同；同一工作流在不同宿主中的强制能力可能不同。
- DevCodex 不接管宿主原生 Skill、个人配置或项目指令文件。
- DevCodex 安装不会把 `.codex/`、`.claude/`、`.gemini/`、`.grok/`、`.cursor/`、`.agents/` 或宿主项目指令文件写进业务 workspace；宿主适配写在用户 HOME，workspace 侧只保留 `.devcodex/` 运行态。
- 工作区 Skill 只影响创建它的项目或 workspace。

---

## 许可证

[AGPL-3.0](LICENSE)
