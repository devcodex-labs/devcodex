# DevCodex

DevCodex 是一个零依赖的 GitHub Copilot Agent Plugin CLI 工具，通过 hooks + instructions/skills/prompts
四层执行面向 Copilot 注入结构化的开发工作流规范。

## 项目结构

- `index.js` — CLI 入口（init/update/status），零依赖
- `hooks/` — Workspace Hooks 配置与运行时（宿主硬门禁）
- `instructions/` — 12 个全局 Instructions（工作流规则，通过 applyTo 自动注入）
- `skills/` — 35 个 Skill（详细检查标准，按需读取）
- `prompts/` — 24 个 Prompt 模板
- `agents/` — 2 个 Agent 定义（确认模式 + 全自动模式）
- `data/` — 运行时数据模板

## 安全底线

本项目所有 Instructions 包含 S01~S07 七条不可覆盖的安全规则，详见 `00-safety.instructions.md`。

## 产物输出

所有 AI 生成的产物（记忆/报告/需求文档）输出到 `.devcodex/` 目录，与源码隔离。

## 构建与测试

- 零依赖，无需 npm install
- 测试：`node index.js status` / `node index.js init --dry-run`
- 版本一致性：`npm run test:version`（检查 package.json ↔ plugin.json 版本一致）

