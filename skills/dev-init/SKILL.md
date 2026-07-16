---
name: dev-init
description: 项目初始化子类型规范 — 新项目/模块脚手架 + Profile 自动生成
---
# Dev Init Skill

## 触发条件

用户要求初始化新项目、新模块、新仓库，典型场景：从零搭建项目脚手架、初始化 monorepo 子包、创建新服务模板。

## 执行流程

| 步骤 | 动作 |
|------|------|
| 1 | 收集项目信息：名称/技术栈/包管理器/团队规范 |
| 2 | CP1：确认技术栈选型和目录结构 |
| 3 | CP2：确认依赖清单和配置文件方案 |
| 4 | 生成脚手架：目录结构 + 配置文件 + 基础文件 |
| 5 | 自动生成 Profile：由 workspace layout 解析的 `<active-profile-dir>` |
| 6 | 初始化 Git + CHANGELOG + README（README 默认通过 `readme-authoring` 生成） |

## Profile 自动生成

init 完成后必须执行 `ProfileGenerationContractGate`，先运行 `devcodex profile plan`，再按确认档位运行 `devcodex profile init --tier <tier>`：

| 档位 | 默认生成 |
|------|----------|
| `profile-lite` | README、01~03、`config.json` |
| `profile-standard` | lite + 04、05、`06-功能清单.md` |
| `profile-closed-loop` | standard + `07-用户文档与契约规范.md` |

公开包、CLI、SDK、多模块、文档站或 public API 项目应根据证据选择 standard/closed-loop。新生成的 `06-功能清单.md` 使用 `FeatureInventorySchemaV2`，分离生命周期与证据状态/日期/引用，并兼容读取 V1；事实不明确时保留 `unverified`，不得编造。已有 Profile 升级只补缺失文件；降档必须显式 `--allow-downgrade` 并保留高档文件，执行 `ProfileTierMigrationSafetyGate`。

## 关键规则

- 跳过 CP3（init 无需实施计划阶段）；同时豁免 `dev-plan-review`（CP3 已跳过，质量门禁不适用）；必须记录 `CP3: N/A（init 子类型豁免）`，供 hook/fallback 区分合法豁免与漏确认
- 生成的 .gitignore 必须覆盖当前 layout 对应的 `<active-root>/.memory/`；legacy 单项目模式才使用 `.devcodex/.memory/`
- 依赖选型遵循项目 profile 中的技术栈约束（若已有 profile）
- 初始化 README 时默认先写给真实使用者；开发/贡献信息后置，后续专项复审走 `audit-readme`
- Node.js 项目默认生成 `engines.node >=18`，并同步 README、Profile 与 CI matrix；低于 v18 必须在 CP2 写明业务理由、风险和验证证据
- 包 / 库 / adapter / CLI 初始化必须同时生成或确认代码实现层与包工程层入口：public API、public types、internal 工具、shared tests、benchmark（如适用）、docs、scripts、dist/coverage 边界、package metadata 与 `changelogs/unreleased.md`
