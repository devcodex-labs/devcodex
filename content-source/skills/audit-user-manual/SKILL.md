---
name: audit-user-manual
description: 用户侧文档专项审查聚合入口 — 用于审查最终用户文档、站点文档、文档站、README、quick start、接入手册、项目文档、菜单导航、sidebar、信息架构、文档设计、用户路径、配置排错、真实工作流、生成站点和维护者内容边界；当用户要求 review/审查/复审/检查用户侧文档或项目文档可用性时使用。
---
# Audit User Manual Skill

## 职责

本 Skill 是用户侧文档 review 的薄封装入口。它不重新定义已有 Gate 正文，而是把 `user-manual-authoring`、`expert-output-quality`、`audit-document`、`audit-readme`、`review-checklist`、`document-sync` 和 `test-router` 的文档审查能力按固定顺序聚合，降低“项目文档 / 文档设计 / 菜单导航”审查时的触发心智。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户要求审查、review、复审、检查最终用户文档、站点文档、文档站、README、quick start、接入手册 | 必须 |
| 用户特别提到项目文档、文档设计、信息架构、菜单、导航、sidebar、目录、页面角色、用户路径 | 必须 |
| docs-first 交付后要求确认用户文档是否能看懂、能否第一次成功、是否够详细 | 必须 |
| 纯内部技术方案、架构设计、代码审查、发布报告 | N/A，走对应 audit Skill |

## 读取顺序

1. 先读 `user-manual-authoring`，确认目标文档契约、受众、文档落点和用户主路径。
2. 若文档包含代码、示例、fixture、mock、demo、quick start、技术方案或报告解读，读取 `expert-output-quality`，执行专家型产物质量门禁。
3. 再读 `audit-document`，执行通用文档结构、准确性、链接、术语、受众和关联一致性审查。
4. 若目标是 README 或主入口文档，叠加 `audit-readme` 的 RM-1~RM-6。
5. 若用户要求正式复审、收敛、外部 finding 或多轮检查，创建或复用 `review-checklist`。
6. 涉及导航、sidebar、生成站点、文档站主题或消费者同步时，按 `test-router` 与 `document-sync` 选择验证路线。

## 审查输出矩阵

| 维度 | 必查证据 |
|------|----------|
| 文档定位 | `targetSurface`、`documentLocation`、`primaryAudience`、发布/preview 边界 |
| 用户路径 | 这是什么、适合谁、第一次成功、常见任务、配置、失败恢复、限制和下一步 |
| 文档设计 | 首页首屏、章节顺序、信息层级、reference / operations / maintainer 分区 |
| 菜单导航 | `SidebarPageRoleMaterializationProbe` / `SidebarGroupSemanticModelProbe`、`pageRoleMatrix`、`sidebarSemanticModel`、route / label 真相源、相邻页面职责、前两组导航是否服务用户主路径 |
| 受众与渲染顺序 | `DocsAudienceRoleAndRenderedSequenceProbe`：pageRole 分布、首屏前三信息块、前两组 sidebar、current quick start 距离、manual TOC 与 generated outline 重复数 |
| 内容可懂 | 功能完整性、配置易懂性、术语首次解释、字段/参数/状态/错误解释、示例真实度 |
| 认知高度 / 任务语言 | guide/readme 是否 Task→Concept；是否函数清单当快速开始；`classifyUserDocsCognitiveAltitudeSample`；唯一推荐路径是否存在；错误是否含恢复 |
| 专家型产物质量 | `ExpertOutputQualityGate`、`ProductionRecommendedPathGate`、`FrameworkNativeCapabilityFirstGate`、`FixtureBoundaryDisclosureGate`、`AntiPatternContrastGate`、`ExpertEvidenceMatrixGate`，区分生产推荐路径、fixture/mock/demo 边界和反模式 |
| 真实工作流 | quick start、队列/异步/批处理、导入导出、失败重试、幂等和观测是否是业务主路径；完整声明必须有 `ScenarioCoverageMatrixProbe`，持久化批处理追加 `DurableBatchOrchestrationProbe` |
| 生成与运行态 | `GeneratedSiteGate`；命中文档站主题、搜索、代码高亮、移动端、暗色/亮色或交互变化时执行 `DocsThemeRuntimeVisualProbeGate` |
| 交互语义 | 命中链接、按钮、菜单、对话框、可展开控件或自定义交互时执行 `InteractiveSemanticProbe`：role、accessible name、focusability、Enter/Space/Escape、focus recovery；截图不能替代 |
| 维护者边界 | release checklist、内部同步清单、台账状态、实现验收是否后置或移出公开用户主路径 |
| 消费者同步 | README、website、Profile、examples、templates、nav/sidebar、validate probes、部署副本和代码消费点 |

## 执行步骤

1. 冻结审查对象：列出文件、页面、路由、sidebar group、README / docs-site / requirement deliverable 落点。
2. 输出 `UserManualReviewScope`：`targetSurface`、`primaryAudience`、`sourceOfTruth`、`publishedBoundary`、`reviewMode=light|full`。
3. 建立 `DocsNavigationReviewMatrix`：每页 role、audience、route、label、sidebar group、sourceOfTruth、是否用户主路径、相邻页面职责。
4. 对示例、fixture、mock、demo、quick start 或报告解读执行 `ExpertOutputQualityGate`；无此类内容时写 `N/A + skipReason`。
5. 按 `audit-document` + 条件 `audit-readme` 做问题分级；同一问题只记录一次，不重复贴多个维度名。
6. 对菜单、sidebar、站点生成、主题视觉或真实用户路径声明，选择源码反查、生成产物、Browser/截图或人工证据；有交互对象时叠加 `InteractiveSemanticProbe`，不得用截图证明键盘/辅助技术语义；未触发写 `N/A + skipReason`。
7. 命中站点文档时执行 `DocsAudienceRoleAndRenderedSequenceProbe`：从源码路由/导航生成 pageRole matrix，并从 fresh generated HTML 或 Browser/Playwright 读取渲染后的首屏、outline 与 CTA 顺序；仅证明 route/label/构建存在不得判用户主面通过。
8. 输出建议时按“用户立即能否看懂并完成第一次成功”排序，技术实现和维护者改动放在次级。
9. 声称场景完整时核对每个 in-scope 场景的触发、状态、失败、恢复、观测和 executable evidence；队列/批处理不能用一次 API 调用替代 durable run。
10. 报告必须引用触发的 Skill、关键 Gate、执行证据、未验证项和剩余风险。

### DocsAudienceRoleAndRenderedSequenceProbe

通过条件同时满足：所有公开页面有 `current-user / target-user / reference / planning / maintainer` 角色；首页首屏前三信息块和 sidebar 前两组优先服务 current-user；current quick start 在约定导航距离内；正文手写 TOC 与 generated outline 无重复；证据来自 fresh 生成产物或运行态页面。任一项未观测只能标 `unverified`，不能用 Markdown 章节存在推断通过。

## 与其他 Skill 的关系

- `user-manual-authoring`：写作入口和文档契约事实源；本 Skill 负责审查聚合。
- `expert-output-quality`：代码、文档、示例、fixture 和报告解读的专家型质量门禁，防止测试夹具或低阶写法误导用户主路径。
- `audit-document`：通用文档审查维度，必须叠加。
- `audit-readme`：README 或主入口文档时叠加。
- `review-checklist`：正式复审、收敛、多轮或 finding 批次时管理清单。
- `document-sync`：检查 README / website / Profile / examples / templates / nav/sidebar / validate / 部署副本同步。
- `test-router`：决定生成站点、链接、Browser/截图、人工复核或 N/A 路线。

## 禁止

- 禁止只看 Markdown 源码就宣告菜单、导航、生成站点或主题交互通过；命中运行态风险时必须有生成产物、预览、截图、Browser 或等价证据。
- 禁止把开发契约、数据模型、实现验收、release checklist 或台账状态当作用户文档主路径。
- 禁止把 fixture、mock、demo、硬编码单例或每个 route 重复声明当作用户主路径的生产推荐实践。
- 禁止用“章节很多”代替“用户能第一次成功”；必须检查用户任务、配置、失败恢复和下一步。
- 禁止把「导出函数/类型清单式 quick start」判为用户文档通过；认知高度失败等同主路径失败。
- 禁止复制 `user-manual-authoring` / `audit-document` / `audit-readme` 的完整长清单；本 Skill 只做聚合入口和输出矩阵。
