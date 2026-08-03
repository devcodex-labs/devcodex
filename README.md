# DevCodex

[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

DevCodex 是面向 AI 编程宿主的工作流运行时和宿主适配包。它通过一个 npm 全局包，把上下文、记忆、80+ 内置 Skill、报告与验证闭环接入 Codex、Claude Code、GitHub Copilot、Gemini CLI 和 Grok，让不同宿主在同一个项目里按更一致的开发流程协作。

如果你经常遇到 AI 新会话忘记项目背景、长任务中途断线、不同宿主规则不一致、修复过程没有记录、验证结果说不清这些问题，DevCodex 的目标就是把“随口聊天式开发”变成有上下文、有流程、有记录、可继续的 AI 编程协作。

```bash
npm install -g devcodex
devcodex --version
```

安装或更新后，重新打开宿主的新会话即可开始使用。

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
- Codex、Claude Code、GitHub Copilot、Gemini CLI 和 Grok 各有自己的配置和能力，项目规则很容易分散。
- 只有 prompt 或零散 Skill 时，缺少从需求、实现、验证到报告的闭环。
- 项目自己的流程、检查清单和团队约定很难跨宿主复用。

DevCodex 把这些能力组合成一个本地工作流入口：先理解当前任务，再按需读取上下文和记忆，选择合适的 Skill 与工作流，最后把关键过程、验证和结果沉淀下来。

## DevCodex 解决什么问题？

| 问题 | DevCodex 怎么处理 | 用户得到什么 |
|------|-------------------|--------------|
| 每次都要重新解释项目背景 | 按任务意图读取必要的项目上下文、历史记忆和相关源码 | 少重复说明，AI 更快进入有效状态 |
| 长任务和新会话容易断 | 把任务过程写入报告和文件记忆 | 后续会话可以围绕真实记录继续 |
| 多个 AI 宿主规则不一致 | 一个 npm 包刷新五个宿主的用户级适配 | 切换宿主时保留同一套工作流习惯 |
| 只有 prompt，没有执行闭环 | 开发、修复、分析、审计等任务都有过程、边界和验证记录 | 更容易复盘，也更容易发现“假完成” |
| 项目私有流程难复用 | 支持在项目里添加工作区 Skill | 你的流程、检查清单和团队约定可被五宿主共享 |

## 核心特色

| 特色 | 说明 |
|------|------|
| 五宿主一个入口 | 支持 Codex、Claude Code、GitHub Copilot、Gemini CLI 和 Grok。不同宿主的 Hook、指令和插件能力不完全相同；DevCodex 会按宿主能力使用可用执行方式。 |
| 上下文按需进入会话 | 不把所有资料一股脑塞给 AI，而是根据当前任务选择必要的项目资料、记忆和源码线索。 |
| 文件记忆与长任务恢复 | 将关键过程写入当前项目的报告和记忆，减少“上一轮做到哪了”的断层。 |
| 80+ 内置 Skill | 覆盖开发、修复、审计、发布、文档、架构、质量、安全、SRE、平台生态、产品与体验等专业场景。 |
| 报告与验证闭环 | 任务结束时沉淀结果、验证命令和剩余风险，让交付不是只靠一句“完成了”。 |
| 用户语言一致 | 回复、报告标题和面向用户的产物内容默认跟随当前用户消息；稳定命令、配置键、协议字段和默认文件名保持英文，便于跨语言兼容。 |
| 工作区 Skill | 用户可以在项目下添加自己的 Skill，让项目流程跨五宿主复用。 |
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

- 同时使用 Codex、Claude Code、GitHub Copilot、Gemini CLI 或 Grok 的开发者。
- 经常让 AI 处理跨文件、跨轮次、需要验证的开发任务的人。
- 希望项目约定、检查清单、发布流程或团队规则能被 AI 稳定遵守的人。
- 想把自己的项目流程沉淀成可复用工作区 Skill 的用户。

## 5 分钟开始

### 系统要求

- Node.js `>=18`
- npm
- 至少一个受支持的 AI 编程宿主：Codex、Claude Code、GitHub Copilot、Gemini CLI 或 Grok

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

安装和初始化完成后，重新打开 Codex、Claude Code、GitHub Copilot、Gemini CLI 或 Grok 的新会话。

## 项目 Profile

普通单项目只需执行 `devcodex init`，无需再运行 Profile 命令。多项目 workspace 中，如果某个子项目需要独立于 workspace 基线的 Profile，可在 workspace 根目录按项目名初始化：

```bash
devcodex init --profile api
```

`api` 必须能唯一匹配 workspace 中已经存在的项目；如果重名，请使用完整相对名称，例如 `apps/api`。DevCodex 会根据该项目已有的包、测试、构建与公开接口选择合适的 Profile 档位，并且只生成缺失文件，不覆盖已经编辑过的内容。

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

## 更新

```bash
npm update -g devcodex
devcodex --version
```

更新完成后，重新打开宿主的新会话。

## 卸载

```bash
npm uninstall -g devcodex
```

## 运行态检查

需要排查空间占用或旧电脑遗留的运行态时，可以查看各类状态的负责人、文件数、体积和最后使用时间：

```bash
devcodex runtime status
devcodex runtime prune --dry-run
```

清理命令默认只预览。确认列表后使用 `devcodex runtime prune --apply`；它只清理达到保留期限的原子写入临时文件，不会自动删除锁文件、当前任务状态或无法识别的文件。

## 生效方式

安装或更新 DevCodex 后，npm 会在安装生命周期中刷新用户级宿主适配。已打开的宿主会话通常不会回读刚更新的配置，因此需要重新打开一个新会话。

DevCodex 内置 Skill 随安装包一起提供。普通使用者不需要手动配置内置 Skill；新会话开始后，DevCodex 会按请求意图自动选择需要的 Skill。

DevCodex 分两层生效：

| 层 | 位置 | 用途 |
|----|------|------|
| 用户级宿主适配 | 用户 HOME 下的 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 配置目录 | 让五个宿主知道 DevCodex 的入口、指令、Hook、MCP 或插件配置 |
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

这里的 Skill 属于 DevCodex 工作区层，不是某个宿主的原生 Skill。新会话开始后，DevCodex 会读取它，并可在 Codex、Claude Code、GitHub Copilot、Gemini CLI 和 Grok 中按意图触发。

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

如果希望五个宿主通过 DevCodex 使用同一套能力，写 DevCodex 工作区 Skill：

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
- DevCodex 安装不会把 `.codex/`、`.claude/`、`.gemini/`、`.grok/`、`.agents/` 或宿主项目指令文件写进业务 workspace；宿主适配写在用户 HOME，workspace 侧只保留 `.devcodex/` 运行态。
- 工作区 Skill 只影响创建它的项目或 workspace。

---

## 许可证

[AGPL-3.0](LICENSE)
