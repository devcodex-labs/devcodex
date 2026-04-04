# Changelog

All notable changes to DevCodex will be documented in this file.

## [0.0.1] - 2026-04-04

### Added

- **GitHub Copilot Agent Plugin** 架构：plugin.json + 完整目录结构
- **1 个统一 Agent**（`agents/devcodex.agent.md`）：自动识别意图，路由到 8 个工作流
- **34 个 Skills**：
  - 核心 Skills（7）：compliance / memory / report / cp-gate / intent / summary / plan
  - dev 子类型（8）：default / refactor / database / init / optimization / scenario-test / docs / plan-review
  - fix 子类型（3）：default / incident / security
  - audit 子类型（8）：common / dimensions / tech-design / requirements / project / report / document / execution-guide
  - 其他（8）：analyze-research / self-fix-auto / api-verification / document-sync / impact-review / routing / load-profile / token-check
- **11 个 Instructions**：00-safety（P2 全局）/ 01-common / 02-output-paths + 10～17 工作流规则
- **20 个 Prompt 模板**：v4 templates/ 全量迁移 + token-setup 新增
- **2 个 Hooks**：`pre-message.hook.md`（Token 验证 + 意图识别）/ `post-session.hook.md`（记忆写入 + 合规检查）
- **CLI 工具**：`init` / `status` / `update` 命令，`npx @vextjs/devcodex init` 一行安装
- **Token 授权系统**：Free / Trial / Pro / Enterprise 四层，7 天离线缓存
- **GitHub Packages 私有分发**：`@vextjs/devcodex`，通过 `.npmrc` + PAT 认证安装
- **文档站**（`website/`）：Rspress 文档站，含安装指南、架构说明、Skills 清单

### Notes

- v4（ai-dev-guidelines）继续并行维护，v5 为独立 Plugin
- MCP Server 动态数据层计划在 v5.1 实现（当前为占位配置）
