# website/（维护者文档站 · 不进公开仓）

本目录是 **DevCodex 维护者文档站**（Rspress 源码），**不进入公开 Git 默认跟踪**，也 **不打进 npm 包**。

## 策略

| 通道 | 是否包含 website |
|------|------------------|
| 公开 Git 仓库 | **否**（见根目录 `.gitignore`） |
| `npm pack` / `npm install -g devcodex` | **否**（`package.json` `files` 未列入） |
| 维护者本机 | **是**（本地保留完整 `website/` 以便 `cd website && npm run dev`） |

## 用户文档

公开用户请阅读仓库根目录 **[README.md](../README.md)**。

## 维护者

若你已有本目录完整历史拷贝，可在本机继续构建文档站。若从公开仓全新克隆，默认 **没有** `website/docs` 全量内容；门禁会将 website 视为 optional。
