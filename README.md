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

安装或更新后，请完全退出旧会话，再从目标项目打开宿主的新会话。

### DevCodex 不是什么

- 它不是模型网关，不代理或托管模型调用。
- 它不是通用 Agent 框架，也不是多 Agent 编排器。
- 它不替代业务框架、GitHub CI、安全审计或人工评审。
- 它不保证六个宿主拥有完全相同的 Hook、MCP、插件、权限或生命周期事件。

“本地优先”表示工作流状态、Profile、报告、记忆和工作区 Skill 以本地文件保存；模型执行和数据处理仍遵循所选 AI Coding 宿主的规则。

## 目录

- [为什么需要 DevCodex？](#为什么需要-devcodex)
- [5 分钟开始](#5-分钟开始)
- [安装会改变什么](#安装会改变什么)
- [工作流、Skill 与宿主边界](#工作流skill-与宿主边界)
- [常见任务怎么说](#常见任务怎么说)
- [常见问题与排错](#常见问题与排错)
- [更新](#更新)
- [卸载](#卸载)
- [添加自己的 Skill](#添加自己的-skill)
- [边界](#边界)
- [许可证](#许可证)

完整用户文档：[DevCodex Docs](https://devcodex-labs.github.io/devcodex/)。

## 为什么需要 DevCodex？

真实工程任务往往跨文件、跨轮次、跨宿主：新会话缺少项目背景，长任务容易断层，项目规范难复用，验证也容易被一句“完成了”替代。

DevCodex 把意图识别、按需上下文、专业 Skill、确认边界、验证、报告和续接放进同一条流程，让 AI 在明确项目与证据范围内工作。

## DevCodex 解决什么问题？

| 问题 | 处理方式 | 收益 |
|---|---|---|
| 重复解释项目背景 | 按意图读取必要 Profile、记忆与源码 | 更快进入有效状态 |
| 长任务难续接 | 报告和文件记忆记录真实进度 | 新会话可恢复 |
| 多宿主规则分散 | 一个包刷新六宿主适配 | 保留一致工作流习惯 |
| 只有 prompt、没有闭环 | 需求、执行、验证与交付串联 | 减少“假完成” |
| 团队流程难复用 | 项目级工作区 Skill | 跨宿主共享约定 |

## 核心特色

| 特色 | 说明 |
|---|---|
| 六宿主适配 | 支持 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor（Beta），同时保留能力差异 |
| 按需上下文 | 只加载当前任务需要的项目资料和专业能力 |
| 文件记忆 | 记录任务进度、验证证据与剩余风险 |
| 80+ 内置 Skill | 覆盖开发、修复、审查、测试、发布、文档和平台治理 |
| 本地优先 | 普通使用不需要额外后台服务 |
| 原生资产共存 | 不接管宿主自己的 Skill、指令或个人配置 |

## 它如何工作？

```text
用户请求
  → 判断任务意图与项目边界
  → 读取必要上下文和记忆
  → 加载匹配的内置 Skill 或工作区 Skill
  → 执行开发 / 修复 / 分析 / 审计
  → 验证、报告并写入可续接状态
```

用户仍然用自然语言提出任务；底层强制能力取决于当前宿主可用的 Hook、MCP、插件和权限。

## 适合谁？

- 同时使用一个或多个受支持 AI Coding 宿主的开发者。
- 经常处理跨文件、跨轮次、需要验证的工程任务的人。
- 希望项目规则、发布流程和团队检查清单可复用的人。

## 5 分钟开始

### 系统要求

- Node.js `>=18.17.0`
- npm
- 至少一个受支持宿主

```bash
node -v
npm -v
npm install -g devcodex
devcodex --version
```

安装前请确认 registry 上的版本；如果 registry 上的版本不是文档对应版本，不要把本地源码版本当作已经发布。

进入项目或多项目 workspace 的真实根目录：

```bash
cd <你的项目根目录>
devcodex init
devcodex status
devcodex doctor
```

`devcodex init` 创建 `.devcodex/` 运行态；安装生命周期中刷新用户级宿主适配，但安装本身不修改业务源码。更新后必须重新打开宿主的新会话，已打开的会话不会中途换版本。

Grok 推荐使用 Grok Full 入口：

```bash
devcodex grok
```

普通 `grok` 是 Partial 兼容入口。Cursor 本地 IDE / CLI 为 Beta；Cursor Cloud Agent 保持 Partial / `UNVERIFIED`。

第一个任务可以直接写：

```text
分析当前项目最应该先改进的三个问题。只分析，不修改文件。
```

更多步骤见[快速开始](https://devcodex-labs.github.io/devcodex/guide/getting-started)。

## 安装会改变什么

| 位置 | 行为 |
|---|---|
| 用户 HOME | 安装或刷新 DevCodex 管理的六宿主适配器 |
| 项目 / workspace | 执行 `devcodex init` 后创建 `.devcodex/` |
| 项目源码 | 安装本身不自动修改 |
| 后台服务 | 普通使用不启动常驻网络服务 |
| 宿主原生资产 | 不扫描、复制、合并、覆盖或删除 |

## 项目 Profile

普通单项目只需 `devcodex init`。多项目 workspace 的子项目需要独立 Profile 时，从 workspace 根预览并初始化：

```bash
devcodex init --profile <项目相对路径> --dry-run
devcodex init --profile <项目相对路径>
```

目标必须真实且唯一；预览不写入，正式执行只补缺失基线，不覆盖已编辑内容。详见[配置](https://devcodex-labs.github.io/devcodex/reference/configuration)。

## 首次信任提示

首次打开新会话时，宿主可能要求允许 DevCodex 管理的 Hook、MCP、插件或本地命令。只允许 DevCodex-managed 项；若拒绝，依赖这些能力的流程不会完整。

第一次直接用自然语言即可：

```text
阅读这个仓库，修复当前失败的 GitHub CI，并运行相关测试。
```

### 自动推进：`@devcodex-auto`

正式入口是 `@devcodex-auto`；`@rocky` 是默认兼容快捷别名。自动推进只在明确范围内连续工作，不扩大删除、发布或越过项目范围的权限。

项目配置可以替换默认快捷别名：

```json
{
  "extensions": {
    "devcodex": {
      "autoAliases": ["@team-auto"]
    }
  }
}
```

`extensions.devcodex.autoAliases` 为非空数组时替换 `@rocky`；省略时保留默认值；空数组 `[]` 关闭默认快捷别名，但不会改名 `@devcodex-auto`。

## 工作流、Skill 与宿主边界

<!-- devcodex-public:workflows primary=dev,fix,analyze,audit,resume,chat advanced=self-fix,other -->
<!-- devcodex-public:skills total=86 active=83 gray=3 bucket=80+ -->
<!-- devcodex-public:hosts ids=copilot,claude,codex,gemini,grok,cursor variants=13 -->
<!-- devcodex-public:auto canonical=@devcodex-auto default=@rocky profile-replacement=true empty-array-disables=true -->

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

当前机器事实为 **86 个 Skill（83 active + 3 gray）**；公开摘要使用 **80+**。Workflow、Domain、Delivery & Governance 和 Workspace 四类 Skill 按任务与阶段渐进加载。

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

```text
为当前 API 增加幂等支持。先整理需求，确认后实施并运行相关测试。
```

```text
复现支付回调重复入账，定位根因，检查同类路径并修复。
```

```text
继续<任务名>任务
```

```text
@devcodex-auto 修复失败的 CI，验证通过后提交。
```

只有明确写出 `push、tag、GitHub Release 和 npm publish`，才把对应发布动作纳入任务范围。更多示例见[常见任务](https://devcodex-labs.github.io/devcodex/guide/common-tasks)。

## 常见问题与排错

### 安装最新版后，为什么没有需求概况、PC0~PC7 或 CP 流程？

在目标项目运行：

```bash
devcodex status
devcodex doctor --json
devcodex global-adapters apply
```

然后完全退出宿主并新建会话。`adapter=not-ready`、`contract=failed` 或 `host kernel not installed` 表示受管入口未就绪；`native=unverified` 只表示缺少原生回放证据，不等于 adapter 失败。

### Grok 能看到 Skill 或 MCP，但没有完整上下文怎么办？

使用 `devcodex grok`。普通 `grok` 是 Partial；catalog 或路由决定不等于正文已加载，`StageLoadReceiptV1` 才是阶段正文成功回执。Grok ParserError、Hook 双来源与恢复步骤见[宿主边界](https://devcodex-labs.github.io/devcodex/reference/hosts)。

### Cursor 已安装 DevCodex，但为什么没有流程或 SkillRoute？

检查 `devcodex doctor --json` 和 `agent --version`。受管 Hook 位于 `~/.cursor/hooks.json`；Cursor Cloud Agent 不加载用户级 Hook，不能继承本地 Beta 结论。命令碰撞与 IDE / CLI / Headless 差异见[宿主边界](https://devcodex-labs.github.io/devcodex/reference/hosts)。

### “帮我审批”时反复重新连接，是否必须开启完全访问？

不需要永久开启 Full access。`node runtime BLOCK` / `sandbox-exec-denied` 表示 Node launcher 被当前沙箱拒绝；`GLOBAL_HOST_TARGET_UNVERIFIED` 表示对应用户级宿主目录当前不可读。先按最小范围批准并重跑 `devcodex doctor`，不要把完全访问当作默认修复。

完整的 adapter、contract、native、sandbox、临时目录与运行态排查见[故障排查](https://devcodex-labs.github.io/devcodex/guide/troubleshooting)和[限制与边界](https://devcodex-labs.github.io/devcodex/reference/limits)。

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

## 运行态与临时产物检查

```bash
devcodex runtime status
devcodex runtime prune --dry-run
devcodex tmp status --json
devcodex tmp maintain --project=<project> --partition=runs
```

清理类命令默认只预览；实际操作必须显式 `--apply` 和完整 scope。`MemoryCursorV1`、`MemoryFileTransactionReceiptV1`、`WorkspaceTempManifestV2` 与 `NextActionEnvelopeV1` 等高级协议见[限制与边界](https://devcodex-labs.github.io/devcodex/reference/limits)。

## 生效方式

DevCodex 分为用户 HOME 下的宿主适配层与项目 / workspace 的 `.devcodex/` 运行态。内置 Skill 随 npm 包安装；工作区 Skill 由项目提供。

多项目 workspace 的典型结构和恢复路径见[配置](https://devcodex-labs.github.io/devcodex/reference/configuration)与[故障排查](https://devcodex-labs.github.io/devcodex/guide/troubleshooting)。

## 添加自己的 Skill

在项目或 workspace 根创建：

```text
<你的项目根目录>/
  .devcodex/
    workspace/
      skills/
        <id>/
          SKILL.md
          intent.json
```

稳定路径是 `<你的项目根目录>/.devcodex/workspace/skills/<id>/SKILL.md`。`SKILL.md` 写目标、步骤、输入输出和边界；`intent.json` 写可验证的触发语义。完整示例见[Skill 参考](https://devcodex-labs.github.io/devcodex/reference/skills)。

## 与宿主原生 Skill 共存

DevCodex 不扫描、复制、合并、覆盖或删除这些用户资产。Codex、Claude Code 等宿主自己的 Skill、项目指令和个人配置继续按宿主规则生效。

需要六宿主共享时使用 DevCodex 工作区 Skill；只服务单一宿主时继续使用该宿主原生机制。

## 边界

- DevCodex 不替代业务框架、GitHub CI、安全审计或人工评审。
- 宿主能力、权限与生命周期事件不同，不能互相继承验证结论。
- 安装不会把用户级宿主配置写进业务 workspace；项目侧只保存 `.devcodex/` 运行态。
- 工作区 Skill 只影响其所在项目或 workspace。
- 更多限制见[限制与边界](https://devcodex-labs.github.io/devcodex/reference/limits)。

---

## 许可证

[AGPL-3.0](LICENSE)
