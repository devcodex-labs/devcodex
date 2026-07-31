# DevCodex

[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

DevCodex 是面向 AI 编程宿主的工作流运行时和宿主适配包。它通过 npm 安装到用户环境，将同一套任务路由、Skill 加载、Hook / 指令适配、报告和记忆写入机制接入 Codex、Claude Code、GitHub Copilot、Gemini CLI 和 Grok。

安装完成后，DevCodex 在新会话中按用户请求的意图进入开发、修复、分析、审计等流程，并按需加载内置 Skill 或工作区 Skill。不同宿主的 Hook、指令和插件能力不完全相同；DevCodex 会按宿主能力使用可用的执行方式，并在能力不足时退回指令约束。

DevCodex 不替代业务框架、GitHub CI、安全审计或人工评审。它也不接管 Codex、Claude Code 等宿主原有的个人 Skill、项目指令或配置文件。

## DevCodex 是什么？

DevCodex 给五个宿主提供同一套开发工作流入口：

- Codex
- Claude Code
- GitHub Copilot
- Gemini CLI
- Grok

它主要处理四件事：

1. 按用户请求识别任务意图，例如开发、修复、分析、审计。
2. 按需加载 DevCodex 内置 Skill 或当前项目的工作区 Skill。
3. 在宿主支持时使用 Hook；宿主能力不足时使用指令约束作为回退。
4. 将关键过程写入当前项目的报告和记忆。

## 系统要求

- Node.js `>=18`
- npm
- 至少一个受支持的 AI 编程宿主：Codex、Claude Code、GitHub Copilot、Gemini CLI 或 Grok

## 安装 Node.js

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

## 安装

安装前请确认 npm registry 上的版本与本文档对应；如果 registry 上的版本不是当前文档对应版本，不要把下面命令当作当前版本安装。

```bash
npm install -g devcodex
devcodex --version
```

安装完成后，重新打开 Codex、Claude Code、GitHub Copilot、Gemini CLI 或 Grok 的新会话。

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

## 生效方式

安装或更新 DevCodex 后，npm 会在安装生命周期中刷新用户级宿主适配。已打开的宿主会话通常不会回读刚更新的配置，因此需要重新打开一个新会话。

DevCodex 内置 Skill 随安装包一起提供。普通使用者不需要手动配置内置 Skill；新会话开始后，DevCodex 会按请求意图自动选择需要的 Skill。

## 添加自己的 Skill

如果你希望为某个项目增加自己的流程、检查清单或团队约定，在这个项目根目录下创建工作区 Skill。

这里的“项目根目录”就是你用 Codex、Claude Code、GitHub Copilot、Gemini CLI 或 Grok 打开的业务项目目录。

```text
<你的项目根目录>/
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

如果只希望某个宿主单独使用，继续使用该宿主自己的 Skill 或指令机制。

## 边界

- DevCodex 不替代业务框架、GitHub CI、安全审计或人工评审。
- 不同宿主的 Hook、指令和插件能力不同；同一工作流在不同宿主中的强制能力可能不同。
- DevCodex 不接管宿主原生 Skill、个人配置或项目指令文件。
- 工作区 Skill 只影响创建它的项目目录。

---

## 许可证

[AGPL-3.0](LICENSE)
