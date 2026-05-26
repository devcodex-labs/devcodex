---
agent: agent
description: 项目 README 模板，用于生成适配库/服务/应用/工具项目的通用 README
applyTo: README.md
---
# 项目 README 模板

> **触发**: `dev-init/SKILL.md` 初始化项目 / `dev-docs/SKILL.md` 更新文档
> **要求**: 生成的 Markdown README 必须包含 `## 目录导航`
> **先判断项目类型**: `library` / `service` / `application` / `tool`

---

```markdown
# <project-name>

> **项目类型**: library / service / application / tool
> **状态**: active / beta / experimental
> **一句话描述**: [这个项目解决什么问题]

## 目录导航

- [项目简介](#项目简介)
- [能力概览](#能力概览)
- [快速开始](#快速开始)
- [开发方式](#开发方式)
- [配置](#配置)
- [文档与接口](#文档与接口)
- [常见问题](#常见问题)
- [贡献与协作](#贡献与协作)
- [许可证](#许可证)

## 项目简介

> 用 2~5 句话说明项目定位、目标用户、运行场景和当前边界。

## 能力概览

- 能力 1
- 能力 2
- 能力 3

## 快速开始

### library / SDK

\`\`\`bash
npm install <package>
\`\`\`

\`\`\`ts
import { xxx } from '<package>'

const result = xxx()
\`\`\`

### service / backend

\`\`\`bash
npm install
npm run dev
\`\`\`

> 写清启动入口、环境变量要求、默认端口和必要依赖。

### application / tool

\`\`\`bash
npm install
npm run dev
\`\`\`

> 写清如何启动界面、CLI 或本地工作流。

## 开发方式

| 项 | 内容 |
|----|------|
| Node / 包管理器 | |
| 启动命令 | |
| 测试命令 | |
| 类型检查 / lint | |

## 配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|:------:|------|
| | | | |

## 文档与接口

- 架构文档：
- 开发指南：
- 接口文档：
- 发布 / 变更日志：

## 常见问题

### Q1.

-

## 贡献与协作

- 代码规范：
- 提交约定：
- 协作说明：

## 许可证

> 私有项目可标 `Internal / Proprietary`；开源项目再填写具体许可证。
```

## 编写要求

1. 先判断项目类型，再决定“快速开始”的主体写法
2. 私有服务项目默认不要写 npm badge、MIT、开源安装指令作为主叙事
3. README 必须有 `## 目录导航`
4. 只保留与当前项目类型相关的示例块，其他类型可删除或标 `N/A`
