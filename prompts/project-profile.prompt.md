---
agent: agent
description: 项目 Profile README 模板，用于初始化项目 Profile 索引文件
applyTo: .devcodex/**/profile/**
---
# 项目 Profile README 模板

> **路径**: `.devcodex/**/profile/README.md`
> **触发**: `dev-init/SKILL.md` 或用户要求创建 Profile 时
> **门禁**: `ProfileGenerationContractGate` / `FeatureInventorySchemaGate` / `ProfileTierMigrationSafetyGate`

---

```markdown
# <project> 项目 Profile

> **创建时间**: YYYY-MM-DD
> **最后更新**: YYYY-MM-DD
> **维护者**: [维护者]

## 项目概述

> 一段话描述项目的核心功能和定位。

## Profile 档位

- 当前档位：`profile-lite | profile-standard | profile-closed-loop`
- 生命周期：稳定基线 / 活文档 / 条件或本地文档
- 生成前先运行：`devcodex profile plan --tier <tier>`

## Profile 文件索引

| 文件 | 内容 | 状态 |
|------|------|:----:|
| `01-项目信息.md` | 技术栈、仓库地址、团队 | ✅ |
| `02-架构约束.md` | 目录结构、模块边界、依赖规则 | ✅ |
| `03-代码风格.md` | 缩进、命名、注释规范 | ✅ |
| `config.json` | 共享运行模式、agent 兜底标识、可提交的安全配置 | ✅ / 按需 |
| `config.local.json` | 用户 / 项目指定时使用的本地 overlay：长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>` | ⏳ 可选 |
| `04-测试规范.md` | 测试框架、覆盖率要求 | ✅ / ⏳ 待创建 |
| `05-发布规范.md` | 版本号规则、发布流程 | ✅ / ⏳ 待创建 |
| `06-功能清单.md` | `FeatureInventorySchemaV1` 规范功能清单 | ✅ / ⏳ standard 默认生成 |
| `07-用户文档与契约规范.md` | 用户文档与 API/CLI/Hook 契约维护 | ✅ / ⏳ closed-loop 必需 |

## 功能清单契约

`06-功能清单.md` 是默认唯一规范真相源，表头固定为：`能力 ID | 能力组 | 公开面 | 配置入口 | 主要消费者 | 文档入口 | 验证路线 | 事实来源 | 维护责任 | 发布状态`。扫描无法证明的字段写 `unverified` / 待人工确认；本 README 和 `01-项目信息.md` 只链接清单，不复制完整表。

## 快速参考

**技术栈**：（来自 `01-项目信息.md`）  
**包管理器**：npm / pnpm / yarn  
**主要框架**：  
**测试框架**：  
**CI/CD**：

## 注意事项

> 项目特有的注意点，新接手时必读。

## 本地配置说明（可选）

- 若项目需要长期连接别名、本机专属配置或本地明文连接信息，可额外维护 `config.local.json`
- 脚本、测试、数据库 / SSH / MongoDB / 数据操作的连接信息默认可按用户提供内容直写或沿用项目既有模式；只有用户或项目明确指定 `config.local.json` 时，才从该文件取得，缺失时提示用户补齐
- `config.local.json` 只作为用户 / 项目指定的本地 overlay，不覆盖 `config.json` 中的 `mode` / `agent`
- 项目级扩展只能写在 `extensions.<namespace>` 下，并在 `01-项目信息.md` 或本 README 说明用途、字段语义和使用方式
- `config.local.json` 可保存 host、port、database、schema、username、内部 URL、连接别名、password、token、apiKey、privateKey、clientSecret、signingKey、connectionPassword、connectionString 等本地字段；只有用户、项目既有配置或目标平台明确要求时，才写入或沿用 `*Env` / `secretRef` 字段
```
