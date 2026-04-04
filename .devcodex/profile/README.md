# DevCodex 项目 Profile

> **创建时间**: 2026-04-04
> **最后更新**: 2026-04-04
> **维护者**: Rocky <rocky@vextjs.com>

## 项目概述

DevCodex 是一个 GitHub Copilot Agent Plugin，通过 `npx devcodex init` 将结构化开发规范（工作流/Skill/Instructions）安装到任意项目，让 AI 助手按标准化流程辅助开发、修复、审计和分析。

## Profile 文件索引

| 文件 | 内容 | 状态 |
|------|------|:----:|
| `01-项目信息.md` | 技术栈、仓库地址、版本策略 | ✅ |
| `02-架构约束.md` | 目录结构、模块边界、CLI 流程 | ✅ |
| `03-代码风格.md` | JS 规范、Markdown 格式、禁止事项 | ✅ |

## 快速参考

**技术栈**：Node.js 18+，纯 JS，无编译步骤  
**包管理器**：npm  
**分发方式**：npm package（`@vextjs/devcodex`）  
**核心能力**：CLI（`devcodex init/update/status`）+ Agent `.md` 文件集合  
**测试方式**：`npm link` 本地验证  
**CI/CD**：GitHub Actions（待配置）

## 注意事项

> - DevCodex 本身是"元工具"：安装的规范文件（.md）就是产品，JS 代码只是安装器
> - 修改规范文件后必须运行 `devcodex update` 同步到工作区 `.github/`
> - `.devcodex/.memory/` 已加入 `.gitignore`，不提交
> - `tools/migrate-*.js` 内部迁移脚本不发布（`.npmignore` 排除）
