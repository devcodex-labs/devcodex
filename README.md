# DevCodex

> **AI 辅助开发规范助手** — GitHub Copilot Agent Plugin v1.0

[![npm](https://img.shields.io/npm/v/devcodex)](https://www.npmjs.com/package/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

DevCodex 将 [ai-dev-guidelines v4](https://github.com/vextjs/ai-dev-guidelines) 的完整规范体系打包为标准 GitHub Copilot Agent Plugin，在 VS Code 中一键安装即用，提供：

- **8 个工作流 Agents**（dev / fix / audit / analyze / self-fix / chat / resume / plan）
- **34 个 Skills**（含核心技能、各工作流子类型技能、跨工作流公共技能）
- **11 个 Instructions**（全局安全底线 + 通用约束 + 8 个工作流规则）
- **20 个 Prompt 模板**（需求/技术方案/实施计划/报告等）

## 安装

在 VS Code 命令面板（`Ctrl+Shift+P`）执行：

```
GitHub Copilot: Install Plugin
```

搜索 **DevCodex** 安装。安装后在 Copilot Chat 中使用 `@dev`、`@audit` 等触发工作流。

## 快速开始

```
# 开发新功能
@dev 我需要开发一个用户登录模块

# 修复线上事故
@fix 生产环境出现 OOM，需要紧急修复

# 审计技术方案
@audit 请审查这份技术方案文档

# 分析代码（Free）
@analyze 分析这段代码的性能问题
```

详细说明见 [MIGRATION.md](MIGRATION.md)。

## 授权层级

| 层级 | 价格 | 包含 |
|------|------|------|
| **Free** | 免费 | @analyze + @chat，20次/天 |
| **Pro** | 订阅制 | 全部 8 Agents + 34 Skills，无限制 |
| **Enterprise** | 联系我们 | Pro + 多租户 Instructions 定制 |

获取 Token：[devcodex.dev](https://devcodex.dev)

## 架构

```
Plugin（静态知识层）     MCP Server（动态数据层，v5.1）
├── instructions/         ├── memory-server
├── agents/               ├── violations-server
├── skills/               └── auth-server
└── prompts/
```

v5.0 Plugin 本地运行，离线可用（Free 层永久可用，Pro 层 7 天离线缓存）。

## v4 升级

已使用 v4 (`ai-dev-guidelines`) 的用户请参阅 [MIGRATION.md](MIGRATION.md)。

## 贡献 & 支持

- Issues：[github.com/vextjs/devcodex/issues](https://github.com/vextjs/devcodex/issues)
- 安全漏洞：见 [SECURITY.md](SECURITY.md)
- 商业授权：见 [LICENSE.md](commercial/LICENSE.md)

## License

[AGPL-3.0](LICENSE) — 开源免费使用；商业闭源部署请购买商业授权。
