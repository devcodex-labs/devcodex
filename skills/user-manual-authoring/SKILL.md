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
| `developerInfoPlacement` | 开发契约、技术方案、数据模型、维护者 checklist 后置或单独标记 |
| `consumerMap` | 同步 README、website、Profile、examples、prompts、templates、validate 和部署副本 |

## 必执行门禁

- `UserDocsPrimarySurfaceGate`：冻结 `targetSurface`、`documentLocation` 与 `primaryAudience=用户/使用者`。
- `UserDocsImmediateComprehensionGate`：输出功能完整性、配置易懂性、首次读者即时理解三轴结论。
- `UserManualProductizationGate`：最终用户文档按使用者产品化组织，主路径必须覆盖受众、任务、配置、真实示例、排错、失败恢复和源码 / 示例可点击链路；内部字段、实现说明和维护者验收不得占主路径。
- `UserManualRenderedFlowAndRealWorkflowProbe`：文档包含 Mermaid / 流程图时必须验证真实渲染；quick start、队列、任务、异步、导入导出或批处理示例必须是真实业务工作流，不能用硬编码单例冒充主路径。
- `DocsPageRoleMatrixGate` / `CompleteUserManualSiteMatrixGate`：文档站或多页 README 需要为每个页面标明 role、audience、sourceOfTruth、nav/sidebar 位置和是否用户主路径；完整用户手册站点覆盖入门、配置、常见任务、reference、排错、限制与下一步。
- `SidebarPageRoleMaterializationProbe` / `SidebarGroupSemanticModelProbe`：新增公开能力、修菜单缺项、调整 sidebar 分组或命名时，先从当前站点配置 / docs inventory / generated HTML 反查 route、label、page role 和整组任务模型；内部实现依赖不得自动成为 IA 归属。
- `ChinesePrimaryExpressionGate`：中文站点文档和中文用户手册用中文主干解释任务、配置、错误和流程；英文标识符只作为精确补充。
- `DocsThemeRuntimeVisualProbeGate`：文档站主题、导航、搜索、代码高亮、移动端、暗色/亮色或交互体验变化时，验证真实运行态视觉和交互，不只检查 Markdown 源码。
- `UserFacingDeliveryChainGate`：文档先于技术方案成为用户路径合同，ECR 对照需求和用户文档审查。
- `FinalUserManualFirstGate`：docs-first 或最终用户手册场景写目标版本最终可执行路径，而不是当前 preview 状态说明。
- `DocsSiteInformationArchitectureGate`：文档站按受众、任务和信息类型分区，不把所有内容塞进用户手册。
- `UserManualFlowAndFailureGate`：用户手册覆盖整体流程、关键角色、第一次成功、失败分流、排查命令和恢复/降级。
- `QueueDocsRealWorkflowGate`：队列、任务和异步类 quick start 必须说明数据来源、批量入队、payload、handler 业务动作、失败/重试/幂等和观测。
- `PublicUserDocsMaintainerBoundaryGate`：公开用户文档不得混入维护者验收、内部同步清单、台账状态或发布 checklist。
- `DocsConsumerSweep` / `UserPathContractSweep`：文档新增能力、命令、配置、导航或用户路径时，同步当前消费者。

## 执行步骤

1. 判定文档目标：`docs-site`、`README-minimum`、`public page`、`requirement deliverable` 或 `N/A`。
2. 核对事实源：确认需求/产品需求、当前版本、发布状态和公开能力边界。
3. 写出用户主路径：这是什么、适合谁、第一次成功、常见任务、配置、排错、限制、下一步。
4. 拆分信息架构：用户手册与 API/CLI/config reference、operations、implementation、maintainer 分开。
5. 建立 `pageRoleMatrix` 与 `sidebarSemanticModel`：确认每页 role、sidebar group、相邻页面职责、route 真相源和非归属说明。
6. 对真实工作流补示例：避免只有单点 API 或单个硬编码 job。
7. 建立 `consumerMap`，列出 README、website、Profile、examples、prompts、templates、validate、部署副本和代码消费点。
8. 完成后按风险调用 `audit-readme` / `audit-document` 做用户视角复审。

## 与其他 Skill 的关系

- `dev-docs`：识别文档任务后，站点文档、README、用户手册优先转入本 Skill；纯技术文档仍由 `dev-docs` 承载。
- `readme-authoring`：README 是本 Skill 的 README 专项分支，继续负责 README 章节顺序与用户旅程细化。
- `audit-readme` / `audit-document`：负责实施后的审查，不替代写作入口。
- `test-router`：选择生成站点、链接、用户路径、Browser/截图或代码级替代验证。
- `document-sync`：按 `consumerMap` 检查当前消费者和部署副本。

## 禁止

- 禁止把用户要求的站点文档写成开发文档、技术方案、实现计划或维护报告。
- 禁止让开发契约、目标 API、Redis/缓存模型、数据模型或验收 checklist 成为用户主入口。
- 禁止把未确认的 `00-需求概况.md` 当成最终用户承诺。
- 禁止把最终用户手册写成整站全部内容容器。
- 禁止把当前不可用状态说明冒充目标版本最终用户手册。
