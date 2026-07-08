---
name: dev-docs
description: 文档开发子类型规范 — 技术文档/API文档/README 编写规范
---
# Dev Docs Skill

## 触发条件

用户要求编写/更新文档：README、站点文档、用户使用文档、API 文档、架构文档、开发指南、CHANGELOG、迁移指南等。

## 豁免项

- 豁免 `plan-review`（文档任务不需要实施计划审查）
- 豁免 `impact-review`（文档变更不涉及代码影响评估）
- 豁免 CP3（无需实施计划）；必须记录 `CP3: N/A（docs 子类型豁免）`，供 hook/fallback 区分合法豁免与漏确认
- CP2 简化为**文档大纲确认**（不需要完整技术方案）

## 目标文档分流

当任务属于“契约驱动型文档”时，优先先冻结目标文档，再让后续实现或联动产物围绕它落地。

### 何时视为契约驱动型文档

满足任一条件即可：

1. 文档本身定义了对外 API 契约
2. 文档面向前端联调、页面调用或外部调用方
3. 若不先冻结文档，后续实现容易产生接口或交互漂移

### 三种目标文档模式

| 模式 | 适用场景 | 产物形态 |
|------|---------|---------|
| `light-api` | 普通接口说明、调用方说明、轻量联调文档 | Markdown 轻量 API 文档 |
| `frontend-api` | 前端联调、页面/模块接口说明、字段映射说明 | Markdown 前端接口文档 |
| `general-doc` | 架构文档、开发指南、迁移指南、治理说明、运行手册 | Markdown 通用文档 |

## README 专项写作分支

当目标文档是站点文档、用户使用文档、最终用户使用文档、最终用户手册、README、quick start、接入手册或公开能力页时，优先调用 `user-manual-authoring`，先冻结用户主路径、文档落点和信息架构，再决定是否进入 README 专项分支。

当目标文档是 `README.md` 或承担主使用入口职责的 README / 项目主文档时，在 `user-manual-authoring` 基础上继续调用 `readme-authoring`：

- 默认第一受众是**用户 / 使用者**
- 快速开始、常见用法、配置与排错必须早于开发/贡献内容
- 章节骨架优先使用 `prompts/project-readme.prompt.md`
- 完成后若需要专项复审，叠加 `audit-readme`

## 文档质量标准

| 维度 | 要求 |
|------|------|
| 结构完整 | 必含：目的/使用者/快速开始/详细说明/示例 |
| 示例可执行 | 代码示例经过验证，可直接运行 |
| 版本同步 | 文档中的 API/配置项与代码实现一致 |
| 链接有效 | 内部/外部链接均可访问 |
| 导航可读 | 所有 Markdown 文档必须包含 `## 目录导航` |
| 翻译等价 | 多语言文档、翻译页或中英文双入口变更时执行 `DocumentationTranslationParityGuard`，核对信息等价、版本号、链接、示例、术语和当前消费者顺序 |
| 正式边界 | README、官网、正式规范页或用户文档执行 `FormalDocsDevCodexBoundary`，不得混入运行时报告、台账口吻、一次性分析或内部待办 |
| 公开承诺 | 面向公开模块、SDK、CLI、插件、包安装说明或文档站能力时执行 `PackageNameAuthorityGate` 与 `PublicModuleDifferentiationGate`，以 package/plugin/registry 证据区分公开 API、内部实现、示例和历史镜像 |
| 发布版本边界 | 面向 README、官网、迁移指南或版本页时执行 `PublicDocsReleasedVersionGate`，未发布能力只能写在 unreleased、草案、需求页或明确 preview 区域 |
| UI 真相源冲突 | 当 Figma/截图/线上页面覆盖旧 PRD 或历史文档时执行 `UIConfirmedSourceConflictTraceGate`，保留冲突表、采纳理由和同步路线 |
| 验证产物语言 | `.http`、集成测试说明、手工验证步骤等用户可读验证产物执行 `UserFacingVerificationArtifactLanguageGate`，默认使用用户当前语言 |
| 需求来源 | 从 PRD、Word、原型、截图或用户消息整理文档需求时执行 `ProductRequirementTraceabilityGate`，保留来源锚点、提取口径和验收映射 |
| 使用者视角 | 正式用户文档、README、官网/文档站、接口说明、运行手册执行 `UserPerspectiveDocsGate`，先回答这是什么、适合谁、如何第一次成功、常见任务、参数/字段/状态/错误、失败恢复、限制和下一步；要求足够详细、术语首次解释、示例真实、心智负担低 |
| 中文主表达 | 中文用户、中文文档、双语中文入口或维护者要求中文可读时执行 `ChinesePrimaryExpressionGate`：正文句子必须用中文主干表达，英文代码标识符、API、文件名、参数名只作为反引号或括号补充；表格字段优先中文名 + 英文标识；流程图节点用中文命名；代码块、路径、命令和 public API 名保持原文 |
| 即时理解 | README、官网/文档站、API/CLI/config 文档、快速开始和运行手册执行 `UserDocsImmediateComprehensionGate`，输出功能完整性、配置易懂性和首次读者即时理解三轴结论 |
| 用户主面 | 用户使用文档、站点文档、文档站、README、quick start 或接入手册执行 `UserDocsPrimarySurfaceGate`，先冻结 `targetSurface`、`documentLocation` 和 `primaryAudience=用户/使用者`，确认首页首屏、quick start、nav/sidebar 前两组、CTA、reference、配置、常见任务和排错不是开发契约主叙事 |
| 用户文档交付链 | docs-first、最终用户手册、站点文档、README 或公开能力页执行 `user-manual-authoring` + `UserFacingDeliveryChainGate` / `FinalUserManualFirstGate`：先基于 `01-需求确认.md` / `01-产品需求.md` 冻结目标用户路径，再决定文档站或 README-minimum、条件契约文档、技术方案输入和 ECR 用户文档符合性 |
| 用户文档产品化 | 用户文档、站点文档、README、quick start、接入手册和最终用户手册执行 `UserManualProductizationGate`：按最终使用者任务组织受众、配置、示例、排错、失败恢复和源码 / 示例可点击链路，内部字段和实现说明不得占主路径 |
| 渲染流程与真实工作流 | Mermaid / 流程图 / quick start / 队列 / 异步文档执行 `UserManualRenderedFlowAndRealWorkflowProbe`：验证真实渲染，示例使用真实业务工作流，禁止硬编码单例冒充主路径 |
| 页面角色矩阵 | 文档站或多页 README 执行 `DocsPageRoleMatrixGate` / `CompleteUserManualSiteMatrixGate`：每页标明 role、audience、sourceOfTruth、nav/sidebar 位置和是否用户主路径，完整手册站点覆盖入门、配置、任务、reference、排错、限制和下一步 |
| Sidebar 任务模型 | 新增或重塑用户主路径能力、菜单缺项、菜单命名、sidebar 分组或 route 表时执行 `SidebarPageRoleMaterializationProbe` / `SidebarGroupSemanticModelProbe`：从当前站点配置、docs inventory 或生成站点反查 route / label / role / group；复核整组任务模型、相邻页面职责和内部依赖是否误作 IA 归属 |
| 文档主题运行态 | 文档站主题、导航、搜索、代码高亮、移动端、暗色/亮色变化执行 `DocsThemeRuntimeVisualProbeGate`：验证真实运行态视觉和交互，不只看 Markdown 源码 |
| 文档站信息架构 | 文档站或最终用户手册执行 `DocsSiteInformationArchitectureGate` 与 `UserManualFlowAndFailureGate`，区分用户手册、reference、operations、compatibility、implementation、maintainer 面，并覆盖整体流程、角色、第一次成功、失败分流、排查命令和恢复/降级 |
| 真实工作流示例 | 队列、任务、异步处理、推送、导入导出或批处理文档执行 `QueueDocsRealWorkflowGate`：quick start 必须提供真实批量工作流，覆盖数据来源、筛选、批量 enqueue、payload schema、handler 业务动作、配置字段、失败/重试/幂等和观测 |
| 消费链扫描 | 文档新增/调整命令、配置项、字段、状态、路径、能力承诺或阅读顺序时执行 `DocsConsumerSweep`，同步 README / website / Profile / prompts / templates / examples / nav/sidebar / validate probes / 部署副本与代码消费位置 |

## API 文档规范

### 轻量 API 文档（`light-api`）

每个公开 API 至少包含：

- 接口用途
- 服务归属
- 模块 / 资源域
- `base path`
- 方法 / 路径
- 参数 / 请求体
- 返回结构
- 错误码（如适用）
- 最小示例

### 前端接口文档（`frontend-api`）

在轻量 API 文档基础上，额外补充：

- 页面 / 模块 / 组件入口
- 调用触发场景
- 登录态 / 鉴权 / 前置依赖
- 页面字段与接口字段的映射关系（如适用）

### 与 `api-verification` 的边界

- `dev-docs` 负责阅读型目标文档
- `api-verification` 负责归档级、可执行的接口验证双产物
- 当用户只要求接口说明或前端联调文档时，不强制生成 `.http + .cjs`
- 当需求明确进入接口验收、回归验证或正式归档时，再联动 `api-verification`

## 通用文档规范（`general-doc`）

当任务不属于契约驱动型接口文档，而是以下类型时，优先使用通用文档模板：

- 架构文档
- 开发指南
- 迁移指南
- 治理说明
- 运行手册

## 文档同步守门

- `CodeTruthRequirementGate`：写“已支持 / 已接入 / 未接入 / 已实现”前先核对代码真相源、命令输出或当前消费者。
- `DocumentationTranslationParityGuard`：同步多语言、翻译页、README 与 website 入口时，必须核对语义等价和导航/索引顺序。
- `FormalDocsDevCodexBoundary`：正式用户文档只呈现稳定使用信息；运行时台账、审查报告、临时分析和内部治理噪声保留在 `.devcodex/**`。
- `ManualReviewEvidenceRetention`：人工文档复核或链接/视觉抽查要留范围、输入和证据；不得只写“已人工检查”。
- `FlowchartNodeExplanationGate`：正式流程图、生命周期图、Nxx 节点图或维护者流程页必须给每个非终止节点配中文解释，说明触发、前置、动作、出口和异常/回退。
- `ChinesePrimaryExpressionGate`：中文文档不得把英文术语和内部标识串成正文主干；英文只承担精确标识，中文负责解释“是什么、做什么、何时用、失败怎么办”。
- `DocsSiteVisualAcceptanceGate`：官网/文档站/技术站视觉或交互调整必须验收主题集成、真实点击、异步动效、减弱动态、代码 token 对比度、终端 demo 范围、TOC inline code 和辅助导航层级；纯内容页写 `N/A + skipReason`。
- `GeneratedSiteGate` / `ManualTocDuplicationGate`：文档站、官网或技术站涉及导航、footer、sidebar、outline、语言切换或手写 TOC 时，必须以当前构建产物或真实预览为准，区分 DOM 中存在但 CSS 隐藏与真实可见重复 / 丢失；手写 `## 目录` / `## Table of Contents` / `## 目录导航` 需要与自动 outline 做重复检查。
- `UserPerspectiveDocsGate`：面向使用者的文档不得只按内部实现、维护者分工或历史治理顺序堆叠；要让首次读者能低心智成本完成“理解 → 安装/进入 → 第一次成功 → 常见任务 → 排错”的路径。
- `UserDocsImmediateComprehensionGate`：用户文档不得只因章节齐全或契约齐全就判定可用；必须检查功能覆盖矩阵、配置字段/默认值/选择建议/错误与排错是否易懂，以及读者是否能在主入口立即知道能做什么、不能做什么、怎么第一次成功和下一步去哪。
- `UserDocsPrimarySurfaceGate`：站点文档、文档站、README、quick start、接入手册或用户使用文档必须先分类目标面和落点（public docs site / project README/docs / requirement deliverable / maintainer-only），并冻结主受众为用户/使用者；开发契约、目标 API、数据模型、Redis/缓存模型、实现验收和维护者 checklist 只能后置或单独标为 developer/maintainer contract，不得替代用户手册。
- `PublicUserDocsMaintainerBoundaryGate`：公开用户文档不得把维护者验收、发布 checklist、内部同步清单、台账状态或实现者复审任务作为用户需要阅读的步骤；此类内容应迁移到 CONTRIBUTING、release checklist、requirements/report 或 maintainer-only 文档。
- `SideEffectCompatibilityDocsGate`：README、快速上手、框架接入、Model/ORM/adapter 文档只展示当前推荐写法；带全局副作用、兼容 shim、弃用行为或高心智负担的旧路径不得进入公开主路径兼容说明。
- `ExecutableExampleTruthProbeGate`：DSL、parser、validator、exporter、配置表达式、模板语法或扩展系统示例进入公开文档、CP 或 companion example 前，必须用当前实现跑最小执行探针；新语法须标未发布或进入 CP2 兼容评估。
- `RequirementPreConfirmGate`：docs/需求类任务推荐确认 `01-需求确认.md` / `01-产品需求.md` 前，必须检查行为可验证、范围/非目标冲突和高风险 fail-safe 语义；缺口先修正文档或列确认问题。
- `RequirementVerdictStateSyncGate`：docs/需求类任务在修订、再次复审、宣布“可确认 / 暂不通过 / 已修订待复审”前，必须同步真相源顶部状态、推荐结论章节、修复清单、audit-state decision、sessions / SUMMARY 口径。
- `DocsConsumerSweep`：文档即产品入口时，正文、导航、索引、示例、模板、Profile、validate 和部署副本都是当前消费者；同步失败或刻意不同序必须写明原因。
- `UserPathContractSweep`：公开能力页、SDK/CLI/API 快速开始或专题页必须核对安装版本、构造函数示例、配置字段类型、相邻专题链接、API 索引和 sidebar 章节，证据来自 `package.json`、public types、runtime wiring、示例源码和当前文档；旧内容必须分类为 current violation / historical allowed / compat fixture allowed / unrelated。
- `SidebarPageRoleMaterializationProbe` / `SidebarGroupSemanticModelProbe`：新增能力页或修菜单时，必须先生成 pageRole/sidebar group 矩阵；只补一个缺项、按 API 名称猜 route、或把内部实现依赖当作一级菜单归属，均不得通过。

## 产出物

- 文档文件（按项目目录结构放置）
- 契约驱动型文档优先使用 `prompts/light-api-doc.prompt.md` 统一骨架
- 站点文档 / 用户使用文档 / 最终用户手册优先使用 `user-manual-authoring`
- README / 主用户使用文档中的 README 专项分支使用 `user-manual-authoring` + `readme-authoring` + `prompts/project-readme.prompt.md`
- 非契约驱动型 Markdown 文档优先使用 `prompts/general-doc.prompt.md`
- 若更新 README/CHANGELOG：执行 `document-sync` 确认同步状态
