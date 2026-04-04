# DevCodex

> **AI 辅助开发规范助手** — GitHub Copilot Agent Plugin v0.0.1  
> 🔒 私有包，通过 **GitHub Packages** 分发（`@vextjs/devcodex`）

[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-%40vextjs%2Fdevcodex-blue?logo=github)](https://github.com/vextjs/devcodex/pkgs/npm/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

DevCodex 将 [ai-dev-guidelines v4](https://github.com/vextjs/ai-dev-guidelines) 的完整规范体系打包为标准 GitHub Copilot Agent Plugin，在 VS Code 中安装即用，提供：

- **1 个统一 Agent**（DevCodex — 自动识别意图并路由到对应工作流）
- **34 个 Skills**（含核心技能、各工作流子类型技能、跨工作流公共技能）
- **11 个 Instructions**（全局安全底线 + 通用约束 + 工作流规则）
- **20 个 Prompt 模板**（需求/技术方案/实施计划/报告等）

## 安装

### 前置：配置 GitHub Packages 认证

DevCodex 托管在 GitHub Packages 私有仓库，安装前需完成一次性认证配置。

**步骤一：创建 Personal Access Token（PAT）**

1. 前往 GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)**
2. 点击 **Generate new token (classic)**
3. 勾选 `read:packages` 权限
4. 记录生成的 Token（形如 `ghp_xxxxxxxxxxxxxxxxxxxxxxxx`）

**步骤二：在项目中配置 `.npmrc`**

在你的项目根目录（或全局 `~/.npmrc`）中添加：

```bash
# .npmrc
@vextjs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

> 🔒 **安全提示**：将 `.npmrc` 加入 `.gitignore`，避免将 Token 提交到代码仓库。  
> 对于 CI/CD 环境，使用环境变量：`//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`

### 安装插件

```bash
# 安装到项目（推荐方式）
npm install --save-dev @vextjs/devcodex

# 初始化：将 DevCodex 文件复制到项目的 .github/ 目录
npx @vextjs/devcodex init

# 查看安装状态
npx @vextjs/devcodex status

# 升级到最新版本
npx @vextjs/devcodex update
```

`init` 命令会将 `agents/`、`skills/`、`instructions/`、`prompts/`、`hooks/` 文件复制到 `.github/` 目录，**重启 VS Code 后即可通过 GitHub Copilot 使用**。

## 快速开始

```
# 开发新功能（自动路由到 dev 工作流）
@DevCodex 我需要开发一个用户登录模块

# 修复 Bug（自动路由到 fix 工作流）
@DevCodex 登录接口返回 500，需要修复

# 深度审计（自动路由到 audit 工作流）
@DevCodex 请对这份技术方案进行全面审查

# 代码分析（Free 层可用）
@DevCodex 分析这段代码的性能问题

# 恢复上次中断的任务
@DevCodex 继续上次的开发任务
```

> DevCodex 通过**语义理解**自动识别意图，无需手动指定工作流。

详细说明见 [MIGRATION.md](MIGRATION.md)。

## 授权层级

| 层级 | 价格 | 包含功能 |
|------|------|---------|
| **Free** | 免费 | 基础 dev/fix/audit/analyze + chat，20次/天 |
| **Trial（试用）** | 7天免费 | Pro 全部功能，到期降级 Free |
| **Pro** | 订阅制 | 全部工作流 + 34 Skills，无限制 |
| **Enterprise** | 联系我们 | Pro + 多租户 Instructions 定制 |

获取 Token：[devcodex.dev/pricing](https://devcodex.dev/pricing)

## 本地开发与测试

### 测试环境搭建

```bash
# 克隆仓库
git clone https://github.com/vextjs/devcodex.git
cd devcodex

# 安装依赖（仅 gen-assets 工具需要）
npm install

# 配置本地测试 Token（绕过授权验证，仅用于开发调试）
export DEVCODEX_DEV=true        # 跳过 Token 验证
export DEVCODEX_TOKEN=pro_test  # 模拟 Pro 层授权（可选）
```

### 本地安装测试（在目标项目中验证）

```bash
# 方式一：npm link（推荐）
cd /path/to/devcodex
npm link

cd /path/to/your-project
npm link @vextjs/devcodex
npx @vextjs/devcodex init

# 方式二：直接从本地路径安装
npm install /path/to/devcodex
npx @vextjs/devcodex init

# 方式三：打包后安装（模拟真实发布）
cd /path/to/devcodex
npm pack
# 生成 vextjs-devcodex-0.0.1.tgz
cd /path/to/your-project
npm install /path/to/devcodex/vextjs-devcodex-0.0.1.tgz
```

### 验证安装

```bash
# 检查初始化后的文件结构
npx @vextjs/devcodex status

# 预期输出：
# ✅ agents/devcodex.agent.md
# ✅ skills/ (34 files)
# ✅ instructions/ (11 files)
# ✅ prompts/ (20 files)
# ✅ hooks/ (2 files)
```

在 VS Code 中重启后，可在 Copilot Chat 中输入 `@DevCodex` 测试响应。

## 架构

```
Plugin（静态知识层）         MCP Server（动态数据层，v5.1 规划中）
├── agents/                   ├── memory-server（会话记忆）
│   └── devcodex.agent.md     ├── violations-server（违规追踪）
├── instructions/ (11)        └── auth-server（Token 验证）
├── skills/ (34)
└── prompts/ (20)
```

v5.0 Plugin 本地运行，离线可用（Free 层永久可用，Pro 层 7 天离线缓存）。

## 关于文档网站

v4（`ai-dev-guidelines`）包含 `website/` 目录，使用 [Rspress](https://rspress.dev) 构建规范文档站点。

DevCodex v5 的文档网站（[devcodex.dev](https://devcodex.dev)）维护在**独立仓库**中，与本插件仓库分离，以保持：
- 插件包大小最小化（网站文件不随 npm 包发布）
- 独立的部署与发布周期
- 敏感的商业定价/条款不混入开源核心

本仓库中的文档：
- `README.md` — 安装与使用指南（本文件）
- `RULES.md` — 插件内置用户手册（Plugin 加载后展示）
- `MIGRATION.md` — v4 → v5 迁移指南
- `commercial/` — 定价、条款、隐私政策

## 自动发布

推送 `v*.*.*` tag 或创建 Release 时，GitHub Actions 自动发布到 GitHub Packages：

```bash
# 发布新版本
git tag v0.0.1
git push origin v0.0.1
```

配置详见 `.github/workflows/publish.yml`。

## v4 升级

已使用 v4 (`ai-dev-guidelines`) 的用户请参阅 [MIGRATION.md](MIGRATION.md)。

## 贡献 & 支持

- Issues：[github.com/vextjs/devcodex/issues](https://github.com/vextjs/devcodex/issues)
- 安全漏洞：见 [SECURITY.md](SECURITY.md)
- 商业授权：见 [commercial/LICENSE.md](commercial/LICENSE.md)

## License

[AGPL-3.0](LICENSE) — 开源免费使用；商业闭源部署请购买商业授权。
