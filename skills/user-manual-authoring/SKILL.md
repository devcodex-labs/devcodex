---
name: user-manual-authoring
description: 最终用户使用文档写作规范 — 站点文档、README、quick start、接入手册与 docs-first 用户手册
---
# User Manual Authoring Skill

## 职责

当任务目标是站点文档、用户使用文档、最终用户手册、README、quick start、接入手册或公开能力页时，本 Skill 是优先写作入口。

本 Skill 负责把文档主受众、文档落点、用户最终路径、文档站信息架构、配置/排错、真实工作流和开发/维护内容边界收口清楚。技术方案、接口契约、实现计划和维护者 checklist 只能作为后续或后置材料，不能替代最终用户文档。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户要求“站点文档 / 文档站 / 用户使用文档 / 使用手册 / 最终用户文档” | 必须 |
| 用户要求 README、quick start、接入手册、官网使用说明或公开能力页 | 必须 |
| docs-first、先写文档再开发、后续按文档实现 | 必须 |
| 纯开发文档、架构说明、内部治理报告、维护者 release checklist | N/A，走 `dev-docs` / `audit-document` / `report` |

## 输入顺序

用户最终文档不得直接从未确认草稿生成最终承诺。推荐顺序：

1. 原始需求或材料保留为输入锚点。
2. `00-需求概况.md` 只作为整理草稿，不替代确认事实源。
3. 以 `01-需求确认.md` 或产品直接提供的 `01-产品需求.md` 作为文档事实源。
4. 判断 `documentationSurface=docs-site | README-minimum | N/A`。
5. 先产出最终用户使用文档。
6. 涉及前端、API 或外部调用方时，再生成契约文档。
7. 技术方案、实施方案、实施计划和 ECR 必须对照用户文档。

## 文档契约

| 字段 | 要求 |
|------|------|
| `primaryAudience` | 必须是用户 / 使用者；内部开发者只能是次级受众 |
| `documentLocation` | 写清是文档站、README、需求交付目录、官网页还是 maintainer-only |
| `userJourney` | 覆盖理解、安装/进入、第一次成功、常见任务、配置、失败处理和下一步 |
| `informationArchitecture` | 文档站要区分用户手册、reference、operations、compatibility、implementation、maintainer |
| `pageRoleMatrix` | 多页文档站列出页面 role、受众、sourceOfTruth、nav/sidebar 位置和用户主路径状态 |
| `sidebarSemanticModel` | 文档站列出每个 sidebar group 的用户任务模型、相邻页面职责、route/label 真相源和非归属说明 |
| `configurationModel` | 配置字段、默认值、选择建议、错误与排错必须简单易懂 |
| `realWorkflowExample` | 队列、任务、异步、导入导出、推送或批处理类文档必须给真实批量工作流 |
| `renderedFlowEvidence` | Mermaid / 流程图 / 文档站主题必须有真实渲染或运行态验证证据 |
| `semanticParityEvidence` | 行为语义、默认值、兼容路径、支持/不支持承诺必须有 `BehaviorSemanticDocsParityGate` / `NegativeTranslationParityProbe` 证据 |
| `exampleTruthEvidence` | option/config/method/callback 示例必须有 `DocsExampleTruthSurfaceGate` / `CallbackExampleScopeProbe` 证据 |
| `expertOutputQualityEvidence` | 示例、fixture、quick start 或接入手册必须有 `expert-output-quality` / `ExpertOutputQualityGate` 证据，区分生产推荐路径、框架原生能力、fixture/mock/demo 边界和反模式 |
| `developerInfoPlacement` | 开发契约、技术方案、数据模型、维护者 checklist 后置或单独标记 |
| `consumerMap` | 同步 README、website、Profile、examples、prompts、templates、validate 和部署副本 |

## 必执行门禁

> 共享 Gate 分组与 requiredEvidence 以 `../spec-governance/gate-registry.json` 为准（`user-manual` / `docs-ia-readability` / `docs-semantics-examples` / `docs-audience-render-sequence` / `scenario-durable-workflow` / `expert-output-quality`）。下表是本 Owner 的**差分清单**（触发 → 要证什么），不维护跨 Skill 百科。

| 触发 | 要证什么（摘要） |
|------|------------------|
| 任意用户手册 / README / 站点文档 | 冻结用户主受众与落点；主路径覆盖理解→第一次成功→任务→配置→失败恢复；公开面不混维护者 checklist |
| docs-first / 最终用户手册 | 文档先于技术方案成为用户路径合同；写目标版本可执行路径，不是 preview 状态说明 |
| 文档站 / 多页 README | page role / sidebar 任务模型 / IA 分区；中文主表达；主题与生成站点运行态（不仅 Markdown） |
| 队列 / 异步 / 批处理 quick start | 真实业务工作流；声称场景完整或持久化编排时追加 scenario / durable 证据（见 registry） |
| 行为承诺 / 示例 / 回调 | 语义与 public API/runtime 对齐；示例可追溯 type/schema/dispatcher；fixture 不得冒充生产推荐路径（`expert-output-quality`） |
| 能力 / 导航 / 路径变更 | 同步 README、website、Profile、examples、validate、部署副本与代码消费点 |

## 执行步骤

1. 判定文档目标：`docs-site`、`README-minimum`、`public page`、`requirement deliverable` 或 `N/A`。
2. 核对事实源：确认需求/产品需求、当前版本、发布状态和公开能力边界。
3. 写出用户主路径：这是什么、适合谁、第一次成功、常见任务、配置、排错、限制、下一步。
4. 拆分信息架构：用户手册与 API/CLI/config reference、operations、implementation、maintainer 分开。
5. 建立 `pageRoleMatrix` 与 `sidebarSemanticModel`：确认每页 role、sidebar group、相邻页面职责、route 真相源和非归属说明。
6. 对真实工作流补示例：避免只有单点 API 或单个硬编码 job。
7. 对示例 / fixture / quick start 执行 `expert-output-quality`：冻结 `roleBaseline`、`productionRecommendedPath`、`frameworkNativeCapability`、`fixtureBoundary`、`antiPatternContrast` 与 `evidenceMatrix`。
8. 建立 `consumerMap`，列出 README、website、Profile、examples、prompts、templates、validate、部署副本和代码消费点。
9. 完成后按风险调用 `audit-user-manual` 做用户侧文档聚合 review；落点为 README / 主入口文档时再叠加 `audit-readme`，通用结构与准确性由 `audit-document` 承接。

## 与其他 Skill 的关系

- `dev-docs`：识别文档任务后，站点文档、README、用户手册优先转入本 Skill；纯技术文档仍由 `dev-docs` 承载。
- `readme-authoring`：README 是本 Skill 的 README 专项分支，继续负责 README 章节顺序与用户旅程细化。
- `audit-user-manual`：负责用户侧文档、项目文档、菜单导航和文档 IA 的聚合审查，不替代写作入口。
- `audit-readme` / `audit-document`：负责 README 专项与通用文档维度，通常由 `audit-user-manual` 编排。
- `expert-output-quality`：负责专家型产物质量，避免文档把 fixture/mock/demo 或低阶重复写法包装成生产推荐路径。
- `test-router`：选择生成站点、链接、用户路径、Browser/截图或代码级替代验证。
- `document-sync`：按 `consumerMap` 检查当前消费者和部署副本。

## 禁止

- 禁止把用户要求的站点文档写成开发文档、技术方案、实现计划或维护报告。
- 禁止让开发契约、目标 API、Redis/缓存模型、数据模型或验收 checklist 成为用户主入口。
- 禁止把未确认的 `00-需求概况.md` 当成最终用户承诺。
- 禁止把最终用户手册写成整站全部内容容器。
- 禁止把当前不可用状态说明冒充目标版本最终用户手册。
- 禁止把 fixture、mock、demo、硬编码单例或重复 route/middleware/resource 声明写成用户主路径的生产推荐实践；必须标明验证用途和推荐替代。


## 同步锚点（validate / consumer）

FixtureBoundaryDisclosureGate · ScenarioCoverageMatrixProbe · DurableBatchOrchestrationProbe


## 额外同步锚点

ChinesePrimaryExpressionGate · SidebarPageRoleMaterializationProbe · SidebarGroupSemanticModelProbe


<!-- auto-sync anchors -->
UserFacingDeliveryChainGate · FinalUserManualFirstGate · UserPathContractSweep · UserManualProductizationGate · UserManualRenderedFlowAndRealWorkflowProbe · DocsPageRoleMatrixGate · DocsThemeRuntimeVisualProbeGate
