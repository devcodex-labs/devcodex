---
name: dev-docs
description: 文档开发子类型规范 — 技术文档/API文档/README 编写规范
---
# Dev Docs Skill

## 触发条件

用户要求编写/更新**技术类**文档：API/契约说明、架构文档、开发指南、迁移**实现**说明、通用技术 Markdown 等。

> ⛔ **入口分流（DocsAudienceIntent，强制）**  
> 写文档任务须先判定 `docsAudience` + `docsSurface`（`scripts/lib/docs-audience-intent.js` / registry `docs-audience-intent`）：  
> - `public-user`（用户使用站 / README / 用户手册 / 用户向 changelog·operations·reference）→ **必须 handoff** `user-manual-authoring`（+ 条件 `readme-authoring`），**不得**以本 Skill 为主写作入口。  
> - `maintainer-dev`（维护者开发站 / contributing / 发版 runbook / ADR 站）→ **必须 handoff** `maintainer-docs-site-authoring`。  
> - `ambiguous` / `multi-audience` → **阻断**；ambiguous 须唯一推荐消歧；multi 须拆任务。  
> - 仅当受众已是技术读者且 surface 为契约/架构/通用技术文时，本 Skill 才作为主入口（light-api / frontend-api / general-doc）。

## 豁免项

- 豁免 `plan-review`（**业务文档内容**任务不需要实施计划审查）
- 豁免 `impact-review`（文档变更不涉及代码影响评估）
- 豁免 CP3（**仅** `dev.docs` 子类型写业务项目文档时）；必须记录 `CP3: N/A（docs 子类型豁免）`  
- ⚠️ **控制面 / Skill / 规范包变更**（如本仓库改 skills）走 `dev.default`，**不享受**本豁免  
- CP2 简化为**文档大纲确认**（业务文档内容任务；控制面任务仍完整技术方案）

## 目标文档分流

当任务属于“契约驱动型文档”且已锁定为技术契约（非用户站 narrative）时，优先先冻结目标文档，再让后续实现或联动产物围绕它落地。  
用户侧 **reference** 可由 `user-manual-authoring` **编排** 本 Skill 的 light-api，但 Owner 仍是用户站。

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

## README / 用户站 / 维护者站 handoff（强制）

| 目标 | handoff |
|------|---------|
| 用户站、用户手册、README、quick start、接入手册、公开能力页 | **`user-manual-authoring`**（+ 条件 `readme-authoring`） |
| 维护者开发站、CONTRIBUTING 站区、发版 runbook 主叙事 | **`maintainer-docs-site-authoring`** |
| light-api / frontend-api / 架构 general-doc（技术读者） | 本 Skill 主入口 |

README / 最终用户使用文档专项仍由 `user-manual-authoring` + `readme-authoring` 承接（默认受众=使用者；开发/贡献后置），README 专项写作分支完成后由 `audit-readme` / `audit-user-manual` 复审。

## 文档质量标准

> **共享门禁**：`user-manual` / `docs-ia-readability` / `docs-semantics-examples` / `expert-output-quality` 等完整 Gate 字段与探针以 `../spec-governance/gate-registry.json` 与 Owner Skill（优先 `user-manual-authoring`、`audit-user-manual`、`expert-output-quality`）为准；本 Skill 只保留 **dev-docs 差分**（契约文档、结构/示例基线、技术文档同步）。

| 维度 | 要求 |
|------|------|
| 结构完整 | 必含：目的/使用者/快速开始/详细说明/示例 |
| 示例可执行 | 代码示例经过验证，可直接运行 |
| 版本同步 | 文档中的 API/配置项与代码实现一致 |
| 链接有效 | 内部/外部链接均可访问 |
| 导航可读 | 长篇独立 Markdown 默认包含 `## 目录导航`；自动 outline/侧栏已覆盖、短跳转页或等价导航时可 `N/A + skipReason`，并做重复导航检查 |
| 契约/公开面（差分） | 契约驱动型或公开模块文档：区分公开 API vs 内部实现；未发布能力只写 unreleased/草案/preview |
| 用户手册类 | 站点文档 / README / 用户使用文档 → 转入 `user-manual-authoring`（+ 条件 `readme-authoring`），不在此复制用户主路径 Gate 百科 |
| 专家产物 / 语义·示例真相 | 命中时调用 `expert-output-quality` 与 registry `docs-semantics-examples`；记录 `gateGroup / ownerSkill / skipReason` |
| 操作说明合同 | 面向用户或维护者的步骤、命令、按钮、工具调用或最终回复必须补 `OperationExplanationContractV1`：`operationId/userGoal/preconditions/input/stateEffect/resultShape/resultSource/failureSemantics/nextAction/evidence` |
| 消费链 | 命令/配置/字段/路径/阅读顺序变更时同步 README / website / Profile / examples / nav / validate / 部署副本 |

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

## 文档同步守门（dev-docs 差分）

> 用户手册 / 文档站 / 示例语义 / 专家产物等共享门禁见 `gate-registry.json` 与 `user-manual-authoring` / `audit-user-manual` / `expert-output-quality`；此处不重复完整清单。

- 写“已支持 / 已接入 / 未接入 / 已实现”前先核对代码、命令输出或当前消费者。
- 正式文档不得混入运行时台账、审查报告或内部待办口吻；人工复核须留范围与证据。
- 公开主路径只展示当前推荐写法；带全局副作用/兼容 shim 的旧路径不得冒充主路径。
- DSL/parser/配置语法示例公开前须有最小执行探针，或标未发布。
- docs/需求类任务推荐确认前检查行为可验证与范围冲突；结论变更须同步真相源状态与 sessions/SUMMARY。
- 消费者同步失败或故意不同序必须写明原因；用户侧审查走 `audit-user-manual` 聚合入口。

## 产出物

- 文档文件（按项目目录结构放置）
- 契约驱动型文档优先使用 `prompts/light-api-doc.prompt.md` 统一骨架
- 站点文档 / 用户使用文档 / 最终用户手册优先使用 `user-manual-authoring`
- README / 主用户使用文档 / 最终用户使用文档中的 README 专项写作分支使用 `user-manual-authoring` + `readme-authoring` + `prompts/project-readme.prompt.md`；完成后由 `audit-readme` / `audit-user-manual` 承接用户侧复审
- 用户侧文档 review / 项目文档审查 / 菜单导航审查优先使用 `audit-user-manual`
- 非契约驱动型 Markdown 文档优先使用 `prompts/general-doc.prompt.md`
- 若更新 README/CHANGELOG：执行 `document-sync` 确认同步状态


## 同步锚点（validate / consumer）

ExpertOutputQualityGate · ProductionRecommendedPathGate · fixture/mock/demo/legacy · DocumentationTranslationParityGuard


## 额外同步锚点

ChinesePrimaryExpressionGate · SidebarPageRoleMaterializationProbe · SidebarGroupSemanticModelProbe · BehaviorSemanticDocsParityGate · NegativeTranslationParityProbe · DocsExampleTruthSurfaceGate · CallbackExampleScopeProbe


<!-- auto-sync anchors -->
FormalDocsDevCodexBoundary · CodeTruthRequirementGate · PackageNameAuthorityGate · PublicModuleDifferentiationGate · ProductRequirementTraceabilityGate · FlowchartNodeExplanationGate · DocsSiteVisualAcceptanceGate · PublicDocsReleasedVersionGate · UIConfirmedSourceConflictTraceGate · UserPerspectiveDocsGate · DocsConsumerSweep · 心智负担 · 维护者验收
SideEffectCompatibilityDocsGate · ExecutableExampleTruthProbeGate · RequirementPreConfirmGate · RequirementVerdictStateSyncGate · UserDocsImmediateComprehensionGate · UserDocsPrimarySurfaceGate · public docs site · requirement deliverable · UserFacingDeliveryChainGate · FinalUserManualFirstGate · GeneratedSiteGate · ManualTocDuplicationGate · UserPathContractSweep · UserManualProductizationGate · UserManualRenderedFlowAndRealWorkflowProbe · CompleteUserManualSiteMatrixGate · DocsThemeRuntimeVisualProbeGate · PublicUserDocsMaintainerBoundaryGate

自动生成 outline/侧栏已覆盖导航
