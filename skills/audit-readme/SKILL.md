---
name: audit-readme
description: README / 用户使用文档专项审查维度 RM-1~RM-6 — 聚焦用户路径、快速开始、示例真实度、配置排错与消费链一致性
---
# Audit Readme Skill

## 适用范围

当审查目标是 `README.md` 或承担主使用入口职责的用户使用文档时，在 `audit-document` 的通用文档维度之上，叠加本 Skill。

若目标是站点文档、最终用户使用文档、最终用户手册、接入手册、公开能力页、项目文档设计或菜单导航审查，先使用 `audit-user-manual` 聚合 `user-manual-authoring`、`audit-document`、本 Skill、`review-checklist`、`document-sync` 与 `test-router` 的证据；落点为 README 或项目主文档时，再叠加本 Skill 的 RM-1~RM-6。

## 维度总览（RM-1~RM-6）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 用户路径 | RM-1 用户路径完整性 · RM-2 快速开始可执行性 | 🔴 |
| B — 内容可信度 | RM-3 示例真实度 · RM-4 配置与排错可发现性 | 🔴/🟡 |
| C — 叙事与联动 | RM-5 开发信息后置性 · RM-6 消费链一致性 | 🟡/🔴 |

## 核心检查维度

**RM-1 用户路径完整性 🔴**
- 用户是否能快速知道“这是什么、适合谁、什么时候用”
- 文档是否给出从理解到第一次成功使用的完整路径
- 是否存在“只有能力说明，没有怎么开始”的断层
- 是否执行 `UserPerspectiveDocsGate`：从使用者真实任务出发组织，而不是按维护者内部实现、历史治理或仓库目录顺序堆叠
- 是否执行 `UserDocsPrimarySurfaceGate`：README、文档站或 quick start 的首页首屏、nav/sidebar 前两组、CTA、reference 入口是否先服务用户使用路径，而不是开发契约、目标 API、数据模型或实现验收
- 是否执行 `FinalUserManualFirstGate`：需求概况之后应先形成用户最终使用文档（文档站或至少 README），而不是先让开发文档、技术方案或实施计划占据主入口
- 是否执行 `DocsSiteInformationArchitectureGate` / `UserManualFlowAndFailureGate`：站点、README 或手册是否按真实用户任务、成功路径、失败恢复、限制和下一步组织，而不是把所有章节平铺给用户自己猜
- 是否执行 `UserManualProductizationGate`：README / quick start / 用户手册是否按最终使用者产品化组织受众、任务、配置、真实示例、排错、失败恢复和源码 / 示例可点击链路，内部字段和实现说明是否后置
- 多页文档站或 README 入口是否执行 `DocsPageRoleMatrixGate` / `CompleteUserManualSiteMatrixGate`，标明每页 role、audience、sourceOfTruth、nav/sidebar 位置和用户主路径状态

**RM-2 快速开始可执行性 🔴**
- 安装、启动、接入或运行步骤是否真实、完整、可执行
- 示例命令是否缺关键前置条件、环境变量、端口或依赖
- 最短成功路径是否足够短，避免把维护流程误当快速开始
- 用户第一次照着做时，是否能少跳转、少猜测、少补前置知识
- 快速开始含 Mermaid / 流程图 / 队列 / 异步 / 批处理示例时，是否执行 `UserManualRenderedFlowAndRealWorkflowProbe`，验证真实渲染并使用真实业务工作流

**RM-3 示例真实度 🟡**
- 示例是否代表真实常见用法，而不是理想化伪代码
- 示例命名、参数、返回值是否与当前实现一致
- 示例是否帮助用户完成“第一次成功”
- 性能表、语法/能力矩阵是否先给用户选择结论，再解释字段含义、支持形式、不支持形式和优先级示例
- 参数、配置、模式、状态、错误码和限制是否逐项解释到“普通使用者能看懂并知道怎么选”
- 队列、任务、异步或批处理类 README 是否执行 `QueueDocsRealWorkflowGate`：给出真实入队、执行、状态查询、失败重试、清理和常见失败恢复，而不是只展示单条硬编码样例

**RM-4 配置与排错可发现性 🟡**
- 用户最常遇到的配置点是否能被找到
- FAQ、报错、依赖缺失、权限、端口、登录态等排错信息是否易发现
- 是否存在“问题在文档里，但埋得太深”
- 是否执行 `UserDocsImmediateComprehensionGate`：配置字段、默认值、选择建议、错误与排错是否简单易懂，并能让首次读者立即判断当前能做什么、不能做什么、怎么第一次成功

**RM-5 开发信息后置性 🟡**
- 开发方式、贡献流程、协作规范是否没有抢占主叙事
- README 是否优先服务使用者，而不是维护者
- 是否执行 `PublicUserDocsMaintainerBoundaryGate`：发布 checklist、维护者验收、内部同步清单、台账状态或复审任务不得作为公开 README / 用户文档的主路径
- 是否执行 `SideEffectCompatibilityDocsGate`：README / 快速上手不得把带全局副作用、兼容 shim、弃用行为或高心智负担的旧路径放入用户主路径
- 是否执行 `ExecutableExampleTruthProbeGate`：README 中 DSL、配置、模板或扩展示例需有当前实现的最小执行证据；未来语法必须标注 preview / unreleased
- 若同时面向用户与贡献者，是否保持单一主叙事中心

**RM-6 消费链一致性 🔴**
- README 与 `package.json`、CLI、website、examples、Profile、changelog 是否一致
- 版本号、命令、路径、配置项、能力声明是否同步
- 是否出现“README 说能做，其他入口说法不同”的漂移
- README 中“已支持 / 已接入 / 已验证 / 可运行”类声明是否有 `CodeTruthRequirementGate` 与 `LiveVerificationExecutionObligation` 证据
- README 若存在翻译页或 website 双入口，是否执行 `DocumentationTranslationParityGuard` 并保持信息等价
- README 是否遵守 `FormalDocsDevCodexBoundary`，没有混入运行时报告、台账、内部待办或一次性复盘口吻
- README 是否执行 `DocsConsumerSweep`：新增命令、字段、配置、导航顺序或能力声明后，website、Profile、examples、templates、validate probes 和代码消费点是否同步
- README 或文档站首页、quick start、公共用户路径变化时，是否执行 `UserPathContractSweep`，确认 README / website / nav/sidebar / examples / templates / validate probes / 部署副本与代码消费点同步
- 文档站主题、导航、搜索、代码高亮、移动端、暗色/亮色变化时，是否执行 `DocsThemeRuntimeVisualProbeGate`，基于真实运行态验证视觉和交互

## 与 audit-document 的边界

| 维度层 | 负责内容 |
|--------|----------|
| `audit-document` | 通用结构、准确性、链接、术语、受众适配、关联一致性 |
| `audit-readme` | 用户路径、快速开始、示例真实度、开发信息后置、消费链一致性 |

规则：

- 通用文档问题优先记在 `DA-*`
- README 专项问题记在 `RM-*`
- 不重复用两套维度描述同一个 finding

## 输出建议

审查 README 时，建议至少回答以下问题：

1. 用户能不能在 1 次阅读里完成第一次成功？
2. 如果失败，文档有没有给出足够靠前的排错线索？
3. 开发/贡献内容是否已经后置？
4. README 与其他当前消费者是否一致？
5. 性能、语法或能力矩阵是否避免内部术语优先，且说明了支持 / 不支持 / 优先级？
6. 文档是否足够详细、心智负担足够低，首次读者能否看懂每个关键字段、命令、状态和失败恢复路径？
7. 用户文档主面是否被开发契约替代？首页、quick start、nav/sidebar 和 CTA 是否仍优先回答“怎么使用”？
8. 若存在文档站或生成站点，是否验证了实际生成产物、TOC/sidebar/nav 去重、真实用户路径和部署副本同步？

## N/A 规则

- 纯内部占位 README、明确只做跳转门户页：RM-2 / RM-3 可按实际场景标注 N/A，但必须明确真实用户文档入口。
- 非 README 的架构文档、治理说明、贡献指南：本 Skill 不触发。
- 站点文档、最终用户手册、接入手册、项目文档设计或菜单导航但非 README：优先审查 `audit-user-manual` + `audit-document`，本 Skill 只在其承担 README / 主入口职责时叠加。
