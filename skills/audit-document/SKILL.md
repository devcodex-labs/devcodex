---
name: audit-document
description: 通用文档审查维度 DA-1~DA-6 — README/架构文档/开发指南专属审查层
---
# Audit Document Skill

## 适用范围

审查目标为**通用文档**（README、架构文档、开发指南，不属于规范/技术方案/需求/报告）时，叠加本 Skill（在 G1~G5 之后）。

README / 用户使用文档场景在本 Skill 基础上，还应叠加 `audit-readme`。

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

**UserPerspectiveDocsGate / DocsConsumerSweep（条件）**
- README、官网/文档站、接口说明、运行手册、开发指南或其他面向使用者的文档，必须从使用者角度审查：是否先说明“这是什么、适合谁、如何第一次成功、常见任务、参数/字段/状态/错误、失败恢复、限制和下一步”
- 文档是否足够详细，术语是否首次解释，字段/配置/命令/状态是否逐项说明，示例是否真实，读者是否能用低心智负担完成目标
- 文档新增或调整命令、配置项、字段、状态、路径、能力承诺、阅读顺序时，是否同步当前消费者：README / website / Profile / prompts / templates / examples / nav/sidebar / validate probes / 部署副本 / 代码消费点
- 纯内部临时报告、运行时台账或只面向维护者的文档可标 `N/A + skipReason`，但不得把正式用户文档降级为内部笔记口吻

**DocumentationTranslationParityGuard / FormalDocsDevCodexBoundary（条件）**
- 多语言文档、翻译页、README/website 双入口变更必须核对信息等价、版本号、链接、示例、术语和导航/索引顺序
- 正式用户文档、官网、README 或规范页不得混入运行时报告、台账、临时分析、内部待办或一次性复盘口吻
- 若文档被声明“已验证 / 可运行 / 可点击”，审查需核对 `LiveVerificationExecutionObligation` 的实际命令、页面、链接或等价证据

**FlowchartNodeExplanationGate / DocsSiteVisualAcceptanceGate（条件）**
- 正式流程图、生命周期图、Nxx 节点图或维护者流程页必须配套中文节点说明，覆盖触发、前置条件、处理动作、成功/失败出口和异常/回退
- 官网、文档站、技术站或正式说明页涉及视觉/交互验收时，需核对主题集成、真实点击、异步动效绑定、`prefers-reduced-motion`、代码 token 对比度、终端 demo 范围、TOC inline code 和辅助导航层级
- 纯文本内容、历史镜像或临时草图可标 `N/A + skipReason`

## README 叠加规则

当目标是 README 或主用户使用文档时：

1. 先执行 `DA-1~DA-6`
2. 再叠加 `audit-readme` 的 `RM-1~RM-6`
3. 通用结构/准确性问题留在 `DA-*`
4. 用户路径、快速开始、示例真实度、开发信息后置与消费链一致性问题留在 `RM-*`

## N/A 规则

- 纯图表/示意图文件无受众概念：DA-5 标 N/A
- 无关联代码：DA-6 标 N/A
- 非多语言、非正式用户文档且无验证声明：上述文档边界守门可标 `N/A + skipReason`
- 非正式流程图、纯文本内容页或无视觉交互变更：上述流程图/文档站验收守门可标 `N/A + skipReason`
- 非使用者文档且无字段/命令/导航/消费者变更：`UserPerspectiveDocsGate` / `DocsConsumerSweep` 可标 `N/A + skipReason`
- 非公开用户文档、README、教程、快速开始、配置/扩展/框架接入指南：`PublicUserDocsMaintainerBoundaryGate` 可标 `N/A + skipReason`
