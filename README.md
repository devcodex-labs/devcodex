# DevCodex

> AI 开发规范注入器 — GitHub Copilot Agent Plugin（Instructions-First）

[![npm](https://img.shields.io/badge/npm-%40vextjs%2Fdevcodex-blue)](https://github.com/vextjs/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

## DevCodex 是什么？

DevCodex 通过 GitHub Copilot Agent Plugin API 向 Copilot 注入结构化的开发工作流规范。  
它强制执行一致的 dev → fix → audit → analyze 循环，内置合规检查、记忆系统和自动报告。

## 功能特性

- **8 种工作流**: `dev` / `fix` / `audit` / `analyze` / `self-fix` / `resume` / `plan` / `chat`
- **2 种模式**: 确认模式（@DevCodex）/ 全自动模式（@DevCodex Auto）
- **合规管线**: FC（形式合规）→ SC（实质合规）→ RC（恢复性检查）→ T（任务完成验证）
- **持久记忆**: 每 Agent、每日的会话记录，结构化字段
- **自动报告**: 每次会话自动写入报告，从不询问 — 直接执行
- **安全底线**: S01~S06 六条不可覆盖的安全规则
- **执行护栏**: 新需求切换时优先按意图判断边界；涉及外部平台/API/兼容性判断时优先看官方文档；提交时压缩 commit subject

## 安装

### 1. 配置 GitHub Packages 认证

```bash
# 创建 .npmrc（需要有 read:packages 权限的 GitHub PAT）
echo "@vextjs:registry=https://npm.pkg.github.com" >> .npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> .npmrc
```

### 2. 安装并初始化

```bash
npm install @vextjs/devcodex
npx devcodex init
```

`init` 会将规范文件复制到项目的 `.github/` 目录：

```
.github/
├── copilot-instructions.md  ← 默认 Copilot always-on 总则（新增）
├── instructions/   ← Instructions 约束（11 个，含全部工作流规则）
├── skills/         ← Skill 详细检查标准（32 个，按需读取）
├── prompts/        ← Prompt 模板（20 个）
├── data/           ← 运行时数据模板
└── RULES.md        ← 使用入口
```

> ⚠️ 请确保 IDE 的 "Use Instruction Files" 设置已开启（默认开启）。
>
> ℹ️ `v1.1.0` 起，`devcodex init/update` **不再默认分发** `.github/agents/`。如果目标项目里仍看到 `.github/agents/`，那是历史残留，需要手动清理。

## 使用

安装后 Copilot 自动加载 DevCodex 规则（通过 `copilot-instructions.md` + `instructions/`），无需选择 Agent。直接在 Copilot Chat 中对话即可：

```
帮我重构 user 模块的权限校验逻辑
→ 自动识别为 dev 工作流 → CP1 需求确认 → CP2 方案确认 → CP3 实施计划 → 执行

这个接口返回 500 了
→ 自动识别为 fix 工作流 → 根因分析 → 修复方案 → 三步扫描验证

深度审查一下这个项目的代码质量
→ 自动识别为 audit 工作流 → 多轮收敛审查 → 输出报告
```

标准安装路径下，无需也不依赖 `@DevCodex`。如你的项目中仍保留历史 `.github/agents/`，那属于 legacy custom agents，而非当前默认安装集合。

## 默认执行原则

- **意图优先**：当用户看起来切到新需求时，先基于上下文判断意图；只有意图不清晰时才用关键词辅助，而不是反过来。
- **边界先确认**：若已判断为新需求切换，且当前工作区还有未提交变更，会先提醒是否应先提交当前变更。
- **官方资料优先**：涉及平台能力、框架 API、版本兼容性或工具语义判断时，优先读取官方文档，再降级到其他资料。
- **提交标题收短**：用户要求提交时，DevCodex 会优先生成一句简洁的 commit subject，而不是把整段会话摘要塞进标题。


## CLI 命令

| 命令 | 说明 |
|------|------|
| `devcodex init` | 初始化：复制规范文件到 `.github/` |
| `devcodex update` | 更新：同步最新规范到 `.github/` |
| `devcodex status` | 状态：检查已安装的组件 |
| `devcodex init --dry-run` | 预览模式：仅显示将复制的文件 |

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/vextjs/devcodex.git
cd devcodex
```

### 在目标项目中测试 CLI

```bash
# 方式一：直接用 node 运行（推荐，无需 link）
cd /path/to/your-project
node /path/to/devcodex/index.js init --force

# 方式二：npm link
cd /path/to/devcodex
npm link
cd /path/to/your-project
devcodex init --force
```

### 验证安装

```bash
# 检查初始化后的文件结构
node /path/to/devcodex/index.js status

# 预期输出：
#   skills         X files
#   instructions   X files
#   prompts        X files
#   data           X files
#   RULES.md       installed
#   copilot-instr  installed
#   legacy-agents  not installed   # 若有历史残留会显示 N files (legacy)
```

### 在 IDE 中验证规则自动生效

1. 在目标项目执行 `devcodex init`（将文件复制到 `.github/`）
2. 重启 IDE
3. 直接在 Copilot Chat 中输入普通需求，确认无需 `@DevCodex` 也会按规则工作

### 文档站本地预览

```bash
cd website
npm install
npm run dev
# 浏览器打开 http://localhost:3000/devcodex/
```

## 架构概览

```
devcodex/
├── copilot-instructions.md  # 默认 Copilot always-on 总则
├── agents/        # Agent 源文件（源码仓保留，不再默认分发到目标项目）
├── instructions/  # 全局 Instructions（11 个，含工作流规则摘要，自动注入）
├── skills/        # Skill 详细检查标准（32 个，按 01-common §按需读取表 路由读取）
├── prompts/       # Prompt 模板（20 个）
├── data/          # 运行时数据模板（violations/pending-fixes/gap-registry）
├── index.js       # CLI 入口（零依赖）
└── plugin.json    # 插件元数据
```

## IDE 兼容性

| 功能 | VS Code | JetBrains | Visual Studio | Xcode | Eclipse |
|------|:-------:|:---------:|:------------:|:-----:|:-------:|
| `copilot-instructions.md` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `instructions/*.instructions.md` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `agents/*.agent.md` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `skills/*/SKILL.md` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `prompts/*.prompt.md` | ✅ | ✅ | ✅ | ❌ | ❌ |

> JetBrains 的 path-specific instructions / agents / skills 已实测确认可用（WebStorm 2026）。


## 文档

完整文档: [devcodex.dev](https://devcodex.dev)

## 许可证

AGPL-3.0-or-later © Rocky / [vextjs](https://github.com/vextjs)
