---
name: audit-requirements
description: 需求文档审查维度 RQ-1~RQ-8 — 需求定义/功能描述/验收标准专属审查层
---
# Audit Requirements Skill

## 适用范围

审查目标为**需求文档**（功能需求/产品需求/验收标准文档）时，叠加本 Skill（在 G1~G5 之后）。

## 维度总览（RQ-1~RQ-8）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 需求质量 | RQ-1 需求完整性 · RQ-2 需求明确性 · RQ-3 需求可验证性 | 🔴 |
| B — 一致性与追溯 | RQ-4 需求一致性 · RQ-7 版本与变更追溯 | 🔴/💡 |
| C — 影响与约束 | RQ-5 影响分析完整性 · RQ-6 约束条件明确性 | 🟡 |
| D — 项目上下文 | RQ-8 项目上下文一致性 | 🟡 |

## 核心检查维度

**RQ-1 需求完整性 🔴**
- 必含章节：背景/问题描述、目标、功能需求、非功能需求、验收标准
- 条件必含：**业务流程**（涉及多服务 / 有决策分支 / 跨轮次开发时必含 §3；否则标 N/A 可豁免）
- 功能需求有唯一编号（如 F-01、A-01）
- 每个需求有优先级标注
- 有排除范围（明确不做什么）

**RQ-2 需求明确性 🔴**
- 需求描述无歧义，可直接转化为实现
- 非功能需求有量化指标（响应时间/并发数等）

**RQ-3 需求可验证性 🔴**
- 每个需求有可测试的验收标准
- 验收标准用具体可观察的行为描述
- 每个功能需求（F-XX）须有至少一条**负向场景**验收标准，覆盖：参数非法 / 权限不足 / 资源不存在 / 边界值溢出 中至少一种

**FrontendExperienceQualityGate 前端 UI / 交互需求（条件）**
- 需求涉及前端页面、组件、控制台、官网、文档站、可视化工具或游戏时，必须说明设计来源或既有风格依据
- UI 验收至少覆盖还原度、风格主题一致性、响应式/状态覆盖与视觉验证方式
- 交互验收至少覆盖核心用户流、交互反馈、输入方式/可访问性、错误预防/恢复与动效/转场边界
- 不涉及用户可见 UI / 交互时写 `N/A + skipReason`

**CrossProjectLearnedGuards 跨项目已吸纳需求（条件）**
- 涉及“已接入 / 已支持 / 已实现 / 未接入”等状态判断时，需求应要求 `CodeTruthRequirementGate` 核对代码真相源和消费者入口
- 涉及人工复核、视觉验收或手工冒烟时，需求应要求 `ManualReviewEvidenceRetention`
- 涉及多语言文档、正式文档、prompt/Agent/Hook/MCP 契约、验证范围、真实执行或 benchmark 归因时，需求应分别列出 `DocumentationTranslationParityGuard`、`FormalDocsDevCodexBoundary`、`LLMPromptContractTriage`、`VerificationScopeBudgetGate`、`LiveVerificationExecutionObligation`、`AdapterBenchmarkAttribution` 验收口径

## N/A 规则

- 纯概念验证无正式需求文档：整体标 N/A
- 无外部依赖：RQ-5 标 N/A
- 无项目 profile：RQ-8 标 N/A
- 未触发跨项目已吸纳守门时，`CrossProjectLearnedGuards` 标 `N/A + skipReason`
