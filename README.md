# DevCodex

> AI 开发规范注入器 — GitHub Copilot Agent Plugin

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
├── agents/         ← Agent 定义（精简索引）
├── instructions/   ← Instructions 约束（含全部工作流规则）
├── skills/         ← 参考文件（4 个模板）
├── prompts/        ← Prompt 模板
├── data/           ← 运行时数据模板
└── RULES.md        ← 使用入口
```

## 使用

在 VS Code Copilot Chat 中输入 `@DevCodex` 即可开始。Agent 会自动识别意图并路由到对应工作流：

```
@DevCodex 帮我重构 user 模块的权限校验逻辑
→ 自动识别为 dev 工作流 → CP1 需求确认 → CP2 方案确认 → CP3 实施计划 → 执行

@DevCodex 这个接口返回 500 了
→ 自动识别为 fix 工作流 → 根因分析 → 修复方案 → 三步扫描验证

@DevCodex 深度审查一下这个项目的代码质量
→ 自动识别为 audit 工作流 → 多轮收敛审查 → 输出报告
```

全自动模式：`@DevCodex Auto`（CP 门控自动通过，安全底线仍强制执行）

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
#   agents         X files
#   skills         X files
#   instructions   X files
#   prompts        X files
#   data           X files
```

### 在 VS Code 中测试 Agent

1. 在目标项目执行 `devcodex init`（将文件复制到 `.github/`）
2. 重启 VS Code
3. 在 Copilot Chat 中输入 `@DevCodex` 测试响应

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
├── agents/        # Agent 定义（2 个：确认模式 + 全自动模式，精简索引文件）
├── instructions/  # 全局 Instructions（11 个，含全部工作流规则，按优先级编号）
├── skills/        # 参考文件（4 个，API验证/文档同步/影响评估/计划模板）
├── prompts/       # Prompt 模板（20 个）
├── data/          # 运行时数据模板（violations/pending-fixes/gap-registry）
├── index.js       # CLI 入口（零依赖）
└── plugin.json    # 插件元数据
```


## 文档

完整文档: [devcodex.dev](https://devcodex.dev)

## 许可证

AGPL-3.0-or-later © Rocky / [vextjs](https://github.com/vextjs)
