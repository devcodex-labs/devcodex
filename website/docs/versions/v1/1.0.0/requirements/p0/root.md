# 需求：项目根骨架

**状态**：✅ 已完成  
**优先级**：P0

## 目标

建立 v1.0.0 重构的根目录基准文件。

## 已完成产物

| 文件 | 说明 |
|------|------|
| `package.json` | 包名 `devcodex`，版本 `1.0.0`，AGPL-3.0 |
| `index.js` | CLI 入口（init / update / status），零依赖 |
| `.mcp.json` | MCP Server 占位（全部 disabled，v1.1.0 启用）|
| `.npmrc` | GitHub Packages 注册表配置 |
| `.npmignore` | npm 发布排除规则 |
| `README.md` | 英文主 README |
| `CHANGELOG.md` | 版本历史 |

## 约束

- `index.js` 零依赖，只做文件复制
- 版本从 `1.0.0` 起
