# GitHub Packages 部署

## 自动发布

DevCodex 使用 GitHub Actions 自动发布到 GitHub Packages。

### 触发条件

以下任一操作触发发布：
1. **创建 GitHub Release**（推荐）
2. **推送 `v*.*.*` 格式的 Tag**

```bash
# 方式一：推送 Tag
git tag v0.0.1
git push origin v0.0.1

# 方式二：在 GitHub 网页创建 Release
# Repository → Releases → Create a new release → 填写 Tag → Publish
```

### 发布工作流

配置文件：`.github/workflows/publish.yml`

```yaml
name: Publish to GitHub Packages
on:
  release:
    types: [created]
  push:
    tags:
      - 'v*.*.*'
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://npm.pkg.github.com'
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`GITHUB_TOKEN` 是内置 secret，**无需手动配置**。

## 版本管理

发布前更新 `package.json` 中的版本号：

```bash
# Patch（Bug 修复）
npm version patch   # 1.0.1 → 1.0.2

# Minor（新功能，向后兼容）
npm version minor   # 1.0.x → 1.1.0

# Major（破坏性变更）
npm version major   # 1.x.x → 2.0.0
```

> 版本更新后记得同步更新 `CHANGELOG.md`（MAJOR/MINOR 需创建 `changelogs/vX.Y.Z.md`）。

## 发布范围

`package.json` 中配置 `files` 字段控制发布内容：

```json
{
  "files": [
    "plugin.json",
    ".mcp.json",
    "agents/",
    "skills/",
    "instructions/",
    "prompts/",
    "hooks/",
    "auth/",
    "commercial/",
    "tools/v5-full-audit.js",
    "tools/README.md",
    "RULES.md",
    "MIGRATION.md",
    "README.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "LICENSE",
    "assets/icon-512.png",
    "assets/banner.png",
    "assets/screenshot-agents.png",
    "assets/screenshot-skills.png"
  ]
}
```

`website/`、`test/`、`data/` 等目录不发布到 npm 包中。
