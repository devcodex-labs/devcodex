---
name: audit-document
description: 通用文档审查维度 DA-1~DA-6 — README/架构文档/开发指南专属审查层
---
# Audit Document Skill

## 适用范围

审查目标为**通用文档**（README、架构文档、开发指南，不属于规范/技术方案/需求/报告）时，叠加本 Skill（在 G1~G5 之后）。

用户侧文档、最终用户手册、站点文档、项目文档、菜单导航或文档 IA review 场景应优先使用 `audit-user-manual` 作为聚合入口；本 Skill 仍负责其中的通用文档审查维度。README / 主入口文档场景在本 Skill 基础上，还应叠加 `audit-readme`。

## 维度总览（DA-1~DA-6）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 内容质量 | DA-1 结构完整性 · DA-2 内容准确性 | 🔴 |
| B — 引用与术语 | DA-3 引用有效性 · DA-4 术语一致性 | 🔴/🟡 |
| C — 受众与关联 | DA-5 受众适配 · DA-6 关联一致性 | 💡/🔴 |

## 核心检查维度

**DA-1 结构完整性 🔴**
- 有目录/大纲且与实际章节一致（无多余/遗漏）
- 章节间有逻辑连贯性（无突兀断层）
- 无未完成章节（标题存在但内容为空/"TBD"）
- 标题层级合理（H1 唯一，逐级递进，无跳级）

**DA-2 内容准确性 🔴**
- 版本号/路径/技术栈与实际项目状态一致
- 代码示例可执行（语法正确，命令可运行）
- API/配置说明与代码实现匹配

**DA-3 引用有效性 🔴**
- 内部链接（相对路径）目标文件存在
- 外部链接可访问（不 404）
- 代码引用的文件/函数/类型存在

**DA-4 术语一致性 🟡**
- 同一概念在文档内用统一术语（不混用别名）
- 术语与项目 profile 定义一致

**条件用户文档 / 文档站门禁（差分入口）**

> 共享 Gate 分组与完整探针以 `../spec-governance/gate-registry.json` 与 Owner Skill `user-manual-authoring` / `audit-user-manual` / `expert-output-quality` 为准；本 Skill 在 DA-1~DA-6 之外只保留审查触发摘要，不复制用户手册 Gate 百科。

- 面向使用者的文档：从“这是什么 / 适合谁 / 第一次成功 / 常见任务 / 失败恢复 / 下一步”审查；术语首次解释；示例真实；正式用户文档不得降为内部笔记口吻
- 用户手册 / 站点文档 / README：优先经 `audit-user-manual` 聚合；核对主受众、落点、IA、真实工作流与消费者同步；未发布能力不得用开发文档冒充用户手册
- 多语言 / 正式边界：信息等价与导航顺序；正式面不混台账/复盘；“已验证/可点击”须有实际命令或页面证据
- 流程图 / 生成站点 / 示例语义 / 专家产物：运行态或生成产物证据，而非仅 Markdown；示例可追溯 public type/runtime；fixture 不得描述成生产推荐路径；不适用写 `N/A + skipReason`

## README 叠加规则

当目标是 README 或主用户使用文档时：

1. 先执行 `DA-1~DA-6`
2. 若用户要求用户侧文档 review、项目文档、菜单导航或信息架构审查，先通过 `audit-user-manual` 聚合证据
3. 再叠加 `audit-readme` 的 `RM-1~RM-6`
4. 通用结构/准确性问题留在 `DA-*`
5. 用户路径、快速开始、示例真实度、开发信息后置与消费链一致性问题留在 `RM-*`

## N/A 规则

- 纯图表/示意图文件无受众概念：DA-5 标 N/A
- 无关联代码：DA-6 标 N/A
- 未触发用户手册 / 文档站 / 多语言 / 生成站点 / 示例语义 / 专家产物时：对应条件门禁聚合写 `N/A + skipReason`（完整 Gate 名见 registry / Owner Skill）
- 公开主路径若展示旧兼容路径或 DSL/parser 示例：分别检查副作用兼容边界与最小执行探针（Owner：`user-manual-authoring` / `dev-docs`）


## 同步锚点（validate / consumer）

ExpertOutputQualityGate · fixture/mock/demo


## 额外同步锚点

UserManualProductizationGate · UserManualRenderedFlowAndRealWorkflowProbe · DocsThemeRuntimeVisualProbeGate · BehaviorSemanticDocsParityGate · NegativeTranslationParityProbe · DocsExampleTruthSurfaceGate · CallbackExampleScopeProbe


<!-- auto-sync anchors -->
DocumentationTranslationParityGuard · FormalDocsDevCodexBoundary · LiveVerificationExecutionObligation · FlowchartNodeExplanationGate · DocsSiteVisualAcceptanceGate · UserPerspectiveDocsGate · DocsConsumerSweep · 浣庡績鏅鸿礋鎷?
  [V67] public user docs / active final response drift in skills/dev-docs/SKILL.md: missing  · SideEffectCompatibilityDocsGate · ExecutableExampleTruthProbeGate · UserDocsImmediateComprehensionGate · UserDocsPrimarySurfaceGate · 鏈彂甯?runtime · FinalUserManualFirstGate · DocsSiteInformationArchitectureGate · UserManualFlowAndFailureGate · GeneratedSiteGate · ManualTocDuplicationGate · UserPathContractSweep

低心智负担 · PublicUserDocsMaintainerBoundaryGate · 未发布 runtime
