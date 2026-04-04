# v4 → v5 迁移指南

> 从 `ai-dev-guidelines v4` 迁移到 `DevCodex v5 Plugin`

## 概述

v4 是手动配置的规范目录，v5 是 GitHub Copilot Agent Plugin，安装即用。
**v4 不需要删除**，两者可并行运行。

## 主要变化

| 维度 | v4 | v5 |
|------|----|----|
| 分发方式 | 手动克隆目录 | VS Code Plugin 一键安装 |
| 激活方式 | 修改 VS Code settings，手动引用路径 | Plugin 平台自动注入 Instructions |
| 工作流触发 | 读取 RULES.md 后手动路由 | `@DevCodex` 统一 Agent 自动语义路由 |
| 记忆系统 | 手写到项目目录 | memory.skill 自动管理 |
| 多租户 | `tenants/<id>/specs/` 手动路径覆盖 | `instructions/tenants/<id>/` 自动优先级覆盖 |

## 内容映射

v4 的每个 specs 文件都已 1:1 映射到 v5：

| v4 文件 | v5 对应组件 |
|---------|------------|
| `specs/safety.md` | `instructions/00-safety.instructions.md`（自动注入，不可覆盖）|
| `specs/common.md` | `instructions/01-common.instructions.md` |
| `specs/dev/README.md` | `agents/devcodex.agent.md`（统一入口 agent）+ `instructions/10-dev.instructions.md` |
| `specs/dev/<sub>.md` | `skills/dev/dev-<sub>/SKILL.md` |
| `specs/audit/<dim>.md` | `skills/audit/audit-<dim>/SKILL.md` |
| `templates/*.md` | `prompts/*.prompt.md` |

完整映射规则见技术方案 §2.10。

## 多租户迁移

如果你有 `tenants/<id>/specs/*.md` 覆盖文件：

**手动方式**：
```
# 将每个 specs/*.md 转换为 instructions 格式
cp tenants/acme/specs/common.md instructions/tenants/acme/01-common.instructions.md
# 在文件头添加 frontmatter：
---
applyTo: "**"
priority: 3
tenant: acme
---
```

**自动方式**（v5.0 工具）：
```bash
node tools/v4-to-v5-migration.js --tenant acme --src path/to/v4
```

## 记忆文件位置

v4 的记忆文件写入项目 profile 目录。v5 的 `memory` Skill 默认写入：
```
.devcodex/.ai-memory/clients/<agent>/tasks/YYYYMMDD.md
```

## 常见问题

**Q: v4 的 RULES.md 预检步骤还需要手动执行吗？**  
A: 不需要。v5 的 Hooks（pre-message）自动完成时间获取和 Token 验证；00-safety.instructions.md 自动注入安全底线。

**Q: 自定义的 v4 specs 规范能直接用在 v5 吗？**  
A: 需要转换为 Instructions 格式（添加 YAML frontmatter），使用迁移工具可自动完成。

**Q: v5 的 Token 在哪里设置？**  
A: 在 VS Code 中运行 Prompt `/token-setup`，或手动设置环境变量 `DEVCODEX_TOKEN=<your-token>`。
