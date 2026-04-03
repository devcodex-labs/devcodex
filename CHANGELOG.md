# Changelog

All notable changes to DevCodex will be documented in this file.

## [1.0.0] — 2026-04-03

### Added

- **Plugin 架构**：完整的 GitHub Copilot Agent Plugin 骨架（plugin.json + 目录结构）
- **8 个工作流 Agents**：dev / fix / audit / analyze / self-fix / chat / resume / plan
- **34 个 Skills**：
  - 核心 Skills（7）：compliance / memory / report / cp-gate / intent / summary / plan
  - dev 子类型（8）：default / refactor / database / init / optimization / scenario-test / docs / plan-review
  - fix 子类型（3）：default / incident / security
  - audit 目标类型（8）：common / dimensions / tech-design / requirements / project / report / document / execution-guide
  - 其他（8）：analyze-research / self-fix-auto / api-verification / document-sync / impact-review / routing / load-profile / token-check
- **11 个 Instructions**：00-safety（P2 全局）/ 01-common / 02-output-paths + 10~17 工作流规则
- **20 个 Prompt 模板**：v4 templates/ 全量迁移 + token-setup 新增
- **2 个 Hooks**：UserPromptSubmit（Token验证）/ Stop（记忆写入）
- **Token 授权系统**：Free / Pro / Enterprise 三层，7天离线缓存
- **v4→v5 迁移工具**：`tools/v4-to-v5-migration.js`

### Notes

- v4（ai-dev-guidelines）继续并行维护，v5 为独立 Plugin
- MCP Server 动态数据层计划在 v5.1 实现（当前为占位配置）

## [0.0.1] — 2026-04-03

- npm 占位包发布（devcodex），保留包名
