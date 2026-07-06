---
name: readme-authoring
description: README 写作规范 — 为 README / 用户使用文档收口用户视角、章节顺序、示例策略与 consumer map
---
# Readme Authoring Skill

## 职责

当任务目标是 `README.md` 或项目主用户使用文档时，本 Skill 负责把“写什么、先写给谁看、哪些内容必须后置”收口为一套稳定规则。

它不新增 workflow 子类型，仍由 `dev-docs` / `dev-init` 触发。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 新建或改写 `README.md` | 🔴 必须 |
| 初始化项目时生成 README | 🔴 必须 |
| 面向真实使用者的主使用文档 | 🔴 必须 |
| CONTRIBUTING / 架构文档 / 纯开发指南 | N/A |

## 默认受众模型

README 的默认第一受众必须是**用户 / 使用者**，而不是维护者。

这里的“用户 / 使用者”指真实依赖这份文档完成理解、安装、启动、接入、使用或排错的人；可以是外部用户，也可以是内部同事。

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `primaryAudience` | `用户 / 使用者` | README 主叙事默认面向真实读者 |
| `secondaryAudience` | `开发者 / 贡献者 / 维护者` | 仅作为后置补充受众 |
| `developerInfoPlacement` | `后置` | 开发、贡献、维护内容不得抢占主叙事 |

## README 写作契约

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `primaryAudience` | ✅ | 默认 `用户 / 使用者` |
| `secondaryAudience` | 条件 | 可选 `开发者 / 贡献者 / 维护者` |
| `projectType` | ✅ | `library` / `service` / `application` / `tool` |
| `userJourney` | ✅ | `理解 -> 安装/接入 -> 启动/运行 -> 使用 -> 配置 -> 排错` |
| `targetSurface` | ✅ | `public-docs-site` / `project-readme-docs` / `requirement-deliverable` / `maintainer-only`，不得未确认就把需求交付文档挂入项目 README/docs |
| `primarySurfaceCheck` | ✅ | 首页首屏、quick start、nav/sidebar 前两组、CTA、reference、配置、常见任务和排错是否服务用户使用路径 |
| `immediateComprehension` | ✅ | 功能完整性、配置易懂性、首次读者即时理解三轴结论 |
| `deliveryChain` | 条件 | docs-first / 最终用户手册场景填写 `UserFacingDeliveryChainGate`：确认需求事实源、用户最终文档、条件契约文档、技术方案输入和 ECR 用户文档符合性 |
| `siteInformationArchitecture` | 条件 | 文档站填写 `DocsSiteInformationArchitectureGate`：用户手册、reference、operations、compatibility、implementation、maintainer 面各归其位 |
| `flowAndFailurePath` | 条件 | 最终用户手册填写 `UserManualFlowAndFailureGate`：整体流程、关键角色、第一次成功、失败分流、排查命令、恢复/降级 |
| `realWorkflowExample` | 条件 | 队列 / 任务 / 异步 / 批处理类 quick start 填写 `QueueDocsRealWorkflowGate`，不能用单个硬编码 job 代替主路径 |
| `developerInfoPlacement` | ✅ | 必须晚于快速开始、常见用法、配置与排错 |
| `consumerMap` | ✅ | README 与 `package.json` / CLI / website / examples / changelog / Profile 的关联事实 |

## 章节顺序规则

推荐主顺序：

1. 这是什么
2. 适合谁、何时使用
3. 如何快速开始
4. 常见用法 / 最短可成功路径
5. 配置 / 运行要求
6. 常见问题与排错
7. 进一步文档
8. 开发 / 贡献 / 维护说明

docs-first 最终用户手册的顺序必须服务目标版本最终可执行路径；未实现、preview 或内部开发状态只能放在发布状态、限制说明或维护者区域，不能成为首屏、quick start 或 reference 主叙事。

禁止把以下内容前置为主叙事：

- 维护者内部流程
- 贡献约定
- 大段架构设计
- 与使用者无关的目录说明

## 项目类型差异

| 项目类型 | 用户最关心的信息 | 写作重点 |
|---------|------------------|---------|
| `library` | 怎么安装、怎么 import、最小示例 | 依赖、最短调用、返回值示例 |
| `service` | 怎么启动、端口/依赖、调用入口 | 启动命令、环境要求、运行方式 |
| `application` | 怎么进入界面、登录/前置条件、核心操作 | 快速体验路径、主要页面或操作 |
| `tool` | 怎么执行命令、输入输出、常见任务 | CLI/脚本入口、常见命令、输出示例 |

## 性能 / 语法 / 能力矩阵写法

- README 面向使用者时，性能表、语法说明、能力矩阵或路由/匹配模式说明必须先给“如何选择”的结论，再解释字段和内部术语。
- 语法、路由、匹配、配置能力类章节默认同时包含：支持的形式、明确不支持的形式、优先级或冲突示例。
- 性能数据不得只给 benchmark 术语；应说明每一列对用户选择的含义，并标明测试条件或 N/A 理由。

## 执行步骤

1. 判断 `projectType`。
2. 确认真实 `primaryAudience` 是否为外部用户、内部使用者或协作方。
3. 执行 `UserDocsPrimarySurfaceGate`：冻结 `targetSurface`、`documentLocation`、首页/quick start/nav 主面和开发/维护内容后置策略。
4. 执行 `UserDocsImmediateComprehensionGate`：写出功能覆盖、配置易懂、首次读者即时理解的三轴检查。
5. docs-first / 最终用户手册场景执行 `UserFacingDeliveryChainGate` 与 `FinalUserManualFirstGate`，确认 README / 文档站内容来自已确认需求或产品需求，而不是未确认的整理草稿。
6. 文档站执行 `DocsSiteInformationArchitectureGate`；最终用户手册执行 `UserManualFlowAndFailureGate`；队列/任务/异步/批处理类 quick start 执行 `QueueDocsRealWorkflowGate`。
7. 按 `userJourney` 组织章节，不要从开发命令开始。
8. 只保留与当前项目类型相关的快速开始与示例块。
9. 建立 `consumerMap`，核对 README 与 `package.json`、CLI、website、examples、changelog、Profile 是否一致；公开能力页追加 `UserPathContractSweep`。
10. 交付后若任务要求 review，再调用 `audit-readme`。

## 与其他 Skill 的关系

- `dev-docs`：判断当前文档是否需要进入 README 专项分支。
- `dev-init`：初始化项目时默认用本 Skill 生成 README。
- `document-sync`：代码/规范变更后检查 README 当前消费者与 `consumerMap`。
- `audit-readme`：实施完成后对 README / 用户使用文档做专项 review。

## 禁止

- 禁止把 README 默认写成“维护者操作手册”。
- 禁止让开发/贡献章节出现在快速开始之前。
- 禁止只写架构或目录而不给真实使用路径。
- 禁止把“站点文档 / 用户使用文档”写成开发契约、目标 API、数据模型或实现验收主叙事；这些内容只能后置或标为 developer/maintainer-only。
- 禁止把 docs-first 最终用户手册写成当前 preview / 当前不可用说明，也禁止把最终用户手册当成整站全部内容容器。
- 禁止队列、任务、异步处理、推送、导入导出或批处理类 quick start 只写单个硬编码 job；单 job 只能作为 API micro example，不能替代真实批量工作流。
- 禁止用内部分类名、benchmark 术语或 provider/adapter 实现名抢占用户主叙事；应先写用户场景与选择建议，再引出 API / 模式名称。
