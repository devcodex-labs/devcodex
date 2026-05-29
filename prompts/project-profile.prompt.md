---
agent: agent
description: 项目 Profile README 模板，用于初始化项目 Profile 索引文件
applyTo: .devcodex/**/profile/**
---
# 项目 Profile README 模板

> **路径**: `.devcodex/**/profile/README.md`
> **触发**: `dev-init/SKILL.md` 或用户要求创建 Profile 时

---

```markdown
# <project> 项目 Profile

> **创建时间**: YYYY-MM-DD
> **最后更新**: YYYY-MM-DD
> **维护者**: [维护者]

## 项目概述

> 一段话描述项目的核心功能和定位。

## Profile 文件索引

| 文件 | 内容 | 状态 |
|------|------|:----:|
| `01-项目信息.md` | 技术栈、仓库地址、团队 | ✅ |
| `02-架构约束.md` | 目录结构、模块边界、依赖规则 | ✅ |
| `03-代码风格.md` | 缩进、命名、注释规范 | ✅ |
| `config.json` | 共享运行模式、agent 兜底标识、可提交的安全配置 | ✅ / 按需 |
| `config.local.json` | 本地私有 overlay：长期连接、env 引用、`extensions.<namespace>`（不提交） | ⏳ 可选 |
| `04-测试规范.md` | 测试框架、覆盖率要求 | ✅ / ⏳ 待创建 |
| `05-发布规范.md` | 版本号规则、发布流程 | ✅ / ⏳ 待创建 |

## 快速参考

**技术栈**：（来自 `01-项目信息.md`）  
**包管理器**：npm / pnpm / yarn  
**主要框架**：  
**测试框架**：  
**CI/CD**：

## 注意事项

> 项目特有的注意点，新接手时必读。

## 本地配置说明（可选）

- 若项目需要长期连接别名、本机专属配置或 env 引用，请额外维护 `config.local.json`
- `config.local.json` 只用于本地私有 overlay，不覆盖 `config.json` 中的 `mode` / `agent`
- 项目级扩展只能写在 `extensions.<namespace>` 下，并在 `01-项目信息.md` 或本 README 说明用途、字段语义和使用方式
```
