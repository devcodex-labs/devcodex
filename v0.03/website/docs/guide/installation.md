# 安装配置

## GitHub Packages 认证

DevCodex 以私有包形式托管在 `@vextjs` 组织的 GitHub Packages，安装前需配置认证。

### 创建 Personal Access Token

1. 前往 [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
2. 点击 **Generate new token (classic)**
3. 设置 Note（如 `devcodex-install`），选择合适的过期时间
4. 勾选权限：
   - `read:packages` — 安装包（必须）
   - `write:packages` — 发布包（仅维护者需要）
5. 点击 **Generate token**，复制 Token（仅显示一次）

### 配置 .npmrc

**项目级配置**（推荐，只影响当前项目）：

```bash
# 项目根目录 .npmrc
@vextjs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

将 `.npmrc` 加入 `.gitignore`：

```bash
echo ".npmrc" >> .gitignore
```

**全局配置**（影响所有项目）：

```bash
# 添加到 ~/.npmrc
echo "@vextjs:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> ~/.npmrc
```

### CI/CD 配置

在 CI/CD 环境中使用环境变量避免硬编码 Token：

```yaml
# .github/workflows/ci.yml 示例
- name: Configure npm
  run: |
    echo "@vextjs:registry=https://npm.pkg.github.com" >> .npmrc
    echo "//npm.pkg.github.com/:_authToken=${{ secrets.GITHUB_TOKEN }}" >> .npmrc
```

> 在同一组织的仓库中，`GITHUB_TOKEN` 自动拥有 `read:packages` 权限，无需额外 PAT。

## 安装

```bash
# 安装为开发依赖
npm install --save-dev @vextjs/devcodex

# 初始化（复制文件到 .github/ 目录）
npx @vextjs/devcodex init

# 查看安装状态
npx @vextjs/devcodex status

# 升级到最新版本
npx @vextjs/devcodex update
```

## 初始化后的文件结构

```
.github/
├── agents/
│   └── devcodex.agent.md       # 统一入口 Agent
├── skills/
│   ├── core/                   # 核心 Skills（intent, routing, memory 等）
│   ├── dev/                    # dev 工作流 Skills
│   ├── fix/                    # fix 工作流 Skills
│   ├── audit/                  # audit 工作流 Skills
│   ├── analyze/                # analyze 工作流 Skills
│   └── cross/                  # 跨工作流公共 Skills
├── instructions/               # 11 个 Instructions 文件
├── prompts/                    # 20 个 Prompt 模板
└── hooks/
    ├── pre-message.hook.md     # 请求前钩子
    └── post-session.hook.md    # 会话后钩子
```

## 升级

```bash
# 查看当前版本
npx @vextjs/devcodex status

# 升级（覆盖 .github/ 中的已有文件）
npx @vextjs/devcodex update
```

> ⚠️ `update` 会覆盖 `.github/` 中 DevCodex 管理的文件。如果你有自定义修改，请提前备份。

## 卸载

```bash
npm uninstall @vextjs/devcodex
# 手动删除 .github/ 中的 DevCodex 相关文件
```
