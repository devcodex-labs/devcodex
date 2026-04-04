# 快速开始

## 前置条件

- VS Code（已安装 GitHub Copilot 扩展）
- Node.js 18+
- GitHub 账号（用于 GitHub Packages 认证）

> 🎁 **注册即享 7 天全功能试用**：使用 GitHub 账号登录 [devcodex.dev](https://devcodex.dev)，自动激活 Trial 层（Pro 全部工作流），无需信用卡。7 天后自动降级为 Free 层（基础 dev/fix/audit/analyze + chat 永久保留）。
>
> 🚧 **当前内测阶段**：付费订阅通道尚未开放，试用期结束如需继续使用 Pro 功能，请联系 support@devcodex.dev 申请延长内测资格。

## 安装

### 第一步：配置 GitHub Packages 认证

DevCodex 托管在 GitHub Packages 私有注册表，需一次性配置认证。

**1. 创建 Personal Access Token（PAT）**

前往 GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)**，勾选 `read:packages` 权限。

**2. 在项目根目录创建 `.npmrc`**

```bash
@vextjs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

> ⚠️ 将 `.npmrc` 加入 `.gitignore`，避免 Token 泄露。

### 第二步：安装并初始化

```bash
npm install --save-dev @vextjs/devcodex
npx @vextjs/devcodex init
```

`init` 命令将 Agent、Skills、Instructions、Prompts、Hooks 复制到 `.github/` 目录。

### 第三步：重启 VS Code

重启完成后，在 Copilot Chat 中输入 `@DevCodex` 即可使用。

## 第一次使用

```
# 开发新功能（自动路由到 dev 工作流）
@DevCodex 我需要开发一个用户权限模块

# 修复 Bug（自动路由到 fix 工作流）
@DevCodex 用户登录后 session 未正确持久化，需要修复

# 深度审计（自动路由到 audit 工作流）
@DevCodex 审查这份 API 设计方案

# 代码分析（Free 层，无需 Pro Token）
@DevCodex 分析这段代码的时间复杂度
```

DevCodex 通过语义理解自动识别意图，无需手动指定工作流。

## 查看状态

```bash
# 查看已安装文件状态
npx @vextjs/devcodex status

# 升级到最新版本
npx @vextjs/devcodex update
```

## 下一步

- [完整安装配置指南](/guide/installation) — GitHub Packages 认证详情、CI/CD 配置
- [v4 → v5 迁移](/guide/migration) — 从旧版本升级的步骤
- [介绍](/guide/introduction) — 工作流清单与授权层级说明
