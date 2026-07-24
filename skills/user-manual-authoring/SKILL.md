---
name: user-manual-authoring
description: 开源/公开用户站点与最终用户手册写作 Owner — guide/README/reference/migration/changelog/operations；与维护者开发站不等价；经 DocsAudienceIntent 路由。
---
# User Manual Authoring Skill

## 职责

当任务目标是**开源/公开用户使用**站点文档、最终用户手册、README、quick start、接入手册、API/CLI **reference（用户侧契约面）** 或公开能力页时，本 Skill 是优先写作入口。

主受众必须是**使用者**（含「使用库的开发者」），**不是**本仓库维护者。成功标准：理解 → 安装/接入 → **第一次成功** → 任务 → 配置 → 失败恢复。

技术方案、接口契约深页、实现计划和维护者 checklist 只能后置或拆任务；维护者开发站走 `maintainer-docs-site-authoring`。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| `docsAudience=public-user`（DocsAudienceIntentGate） | 必须 |
| 用户要求“用户使用文档 / 使用手册 / 最终用户文档 / 开源用户站” | 必须 |
| 用户要求 README、quick start、接入手册、官网使用说明或公开能力页 | 必须 |
| docs-first、先写文档再开发、后续按文档实现 | 必须 |
| API/CLI/Config **reference**（使用者查表） | 必须（可编排 `dev-docs` light-api） |
| 维护者开发站 / contributing / 发版 runbook / ADR 主叙事 | N/A → `maintainer-docs-site-authoring` |
| 仅「写文档站/website」且 ambiguous | N/A → **阻断消歧**，禁止开写 |
| 纯架构说明且受众为维护者 | N/A → `dev-docs` / `maintainer-docs-site-authoring` |

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
| `docsSurface` | `guide` \| `readme` \| `reference` \| `migration` \| `changelog` \| `operations`（由 DocsAudienceIntent 锁定） |
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

- `dev-docs`：识别文档任务后，**用户站/README/用户手册必须 handoff 本 Skill**；reference 可编排 light-api；纯维护者技术文或架构走 `dev-docs` / `maintainer-docs-site-authoring`。
- `maintainer-docs-site-authoring`：维护者开发站 Owner；受众正交。
- `readme-authoring`：README 是本 Skill 的 README 专项分支，继续负责 README 章节顺序与用户旅程细化。
- `audit-user-manual`：负责用户侧文档、项目文档、菜单导航和文档 IA 的聚合审查，不替代写作入口。
- `audit-readme` / `audit-document`：负责 README 专项与通用文档维度，通常由 `audit-user-manual` 编排。
- `expert-output-quality`：负责专家型产物质量，避免文档把 fixture/mock/demo 或低阶重复写法包装成生产推荐路径。
- `test-router`：选择生成站点、链接、用户路径、Browser/截图或代码级替代验证。
- `document-sync`：按 `consumerMap`（含 `audience=public-user`）检查当前消费者和部署副本。
- `DocsAudienceIntentGate`：`scripts/lib/docs-audience-intent.js` + `npm run test:docs-audience`。

## 完成前漂移自检

- 锁定 `docsAudience=public-user` 后，正文不得以 release checklist / monorepo 内部 / ADR 列表 / 内部台账为**首屏主叙事**。  
- 机器分类：`classifyDocsAudienceDriftSample('public-user', body)`（`scripts/lib/docs-audience-intent.js`）不得返回 `drift-maintainer-on-user`。  
- 无安装/第一次成功路径不得宣称用户站完成。

## 禁止

- 禁止把用户要求的站点文档写成开发文档、技术方案、实现计划或维护报告。
- 禁止让开发契约、目标 API、Redis/缓存模型、数据模型或验收 checklist 成为用户主入口。
- 禁止把未确认的 `00-需求概况.md` 当成最终用户承诺。
- 禁止把最终用户手册写成整站全部内容容器。
- 禁止把当前不可用状态说明冒充目标版本最终用户手册。
- 禁止把 fixture、mock、demo、硬编码单例或重复 route/middleware/resource 声明写成用户主路径的生产推荐实践；必须标明验证用途和推荐替代。
- 禁止在单任务内同时写维护者站并宣称双受众完成；多受众须拆任务。


## 同步锚点（validate / consumer）

FixtureBoundaryDisclosureGate · ScenarioCoverageMatrixProbe · DurableBatchOrchestrationProbe


## 额外同步锚点

ChinesePrimaryExpressionGate · SidebarPageRoleMaterializationProbe · SidebarGroupSemanticModelProbe


<!-- auto-sync anchors -->
UserFacingDeliveryChainGate · FinalUserManualFirstGate · UserPathContractSweep · UserManualProductizationGate · UserManualRenderedFlowAndRealWorkflowProbe · DocsPageRoleMatrixGate · DocsThemeRuntimeVisualProbeGate
