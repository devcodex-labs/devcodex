---
name: audit-tech-design
description: 技术方案审查维度 TD-1~TD-13 — 架构/技术选型/实施方案专属审查层
---
# Audit Tech Design Skill

## 适用范围

审查目标为**技术方案**（架构设计、技术选型、实施方案文档）时，叠加本 Skill（在 G1~G5 之后）。

## 维度总览（TD-1~TD-13）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 方案质量 | TD-1 架构合理性 · TD-2 边界与异常设计 · TD-3 安全性设计 | 🔴 |
| B — 影响评估 | TD-4 Breaking Changes 完整性 · TD-5 下游兼容性 · TD-6 版本合规性 | 🔴/🟡 |
| C — 可实施性 | TD-7 实施可行性 · TD-8 测试策略完整性 | 🟡 |
| D — 文档质量 | TD-9 文档结构完整性 · TD-10 方案与实施一致性 | 🟡 |
| E — 规范一致性 | TD-11 与项目 profile 一致性 · TD-12 API/接口设计质量 | 🟡 |
| F — 图表 | TD-13 流程图与图表质量 | 🟡 |

## 核心检查维度

**TD-1 架构合理性 🔴**
- `§0` 现状分析存在且描述了当前系统状态和问题定位
- `§1.2` 关键架构决策表存在且每条有选择理由和"为何不选备选"说明
- 核心模块职责单一（≤3 个核心功能）
- 新增生产依赖有选型说明
- 依赖升级 / SDK 替换 / 平台 API 兼容方案已拆分 `业务源码平滑性` 与 `依赖层落地条件`
- provider / connector / SDK 接入方案已冻结 provider metadata、内部 payload、上游 request 映射、标准化 result、错误 detail，且首个 provider 未反向定义公共契约

**TD-4 Breaking Changes 🔴**
- BC 清单完整（无遗漏的接口/行为变更）
- 每条 BC 有迁移指南或升级路径

**TD-8 测试策略 🟡**
- 覆盖率目标明确
- 有针对性的负向测试场景
- 包 / 库 / adapter / CLI 方案同时覆盖代码实现层与包工程层验证（public API / public types / shared tests / benchmark / docs / scripts / package metadata）
- 包 / adapter / SDK / CLI / 插件方案在推荐确认前已执行 `PackageAdapterPreConfirmEvidenceGate`：核对 package.json、plugin.json、exports/bin/files、dist/pack 边界、registry 或安装入口、adapter 消费者和官方/上游公开契约；缺证据时不能宣称包消费者可用
- 方案含 PR / TD / CP2 审查锚点时必须执行 `ReviewAnchorMaterializationGate`：把审查锚点物化成可 grep 的章节、表格或清单，不能只在叙述中语义覆盖
- 方案含需求维度、优先级、批次或阶段计划时必须执行 `RequirementDimensionBindingGate` / `RequirementPriorityAndPhaseGate`：每个维度绑定 CP2、批次计划、验收和阶段关闭规则

**TD-12 API/接口设计质量 🟡**
- 简单 service 只承担业务编排、外部能力调用和必要上游错误映射，不重复 route validate、model/schema、数据导入或框架已承担的校验、归一化和配置兜底
- JavaScript / Node.js 方案中命中必要注释的导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明使用标准 JSDoc
- API / SDK / 平台能力方案必须执行 `OfficialApiEvidenceGate`，以官方 API 文档、公开契约或源码证据为准；框架、SDK 或插件已有能力需执行 `FrameworkCapabilityAutoFirstGate`，优先复用成熟能力而不是手写平行能力

## N/A 规则

- 无 BC 时：TD-4/TD-6 标 N/A
- 非 API 项目：TD-12 标 N/A
- 无流程图：TD-13 标 N/A
