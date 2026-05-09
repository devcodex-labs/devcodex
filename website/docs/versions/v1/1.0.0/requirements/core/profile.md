# 需求：项目信息（.devcodex/profile）

**状态**：✅ 已完成  
**优先级**：P0

## 目标

建立项目的规范参照文件，供 AI 在开发过程中读取。

## 已完成产物

| 文件 | 说明 |
|------|------|
| `.devcodex/profile/config.json` | 运行模式（`dev` / `prod`）|
| `.devcodex/profile/01-项目信息.md` | 基本信息、需求管理规范、技术栈、版本策略、开发循环 |
| `.devcodex/profile/02-架构约束.md` | 目录结构、模块职责、编号规则 |
| `.devcodex/profile/03-代码风格.md` | JS 规范、Markdown 规范、禁止事项 |

## 核心规范（已写入 profile）

- `1.0.0` 基线需求保留在 `website/docs/versions/v1/1.0.0/requirements/`；后续新增需求、Bug 修复和发布准备必须在同级新版本目录中继续（如 `1.0.1`）
- 规范文件（agents/skills/instructions）统一用**中文**编写
- `devcodex update` 从源码仓同步变更到目标工作区的 `.github/`
