---
name: growth-analytics
description: 增长分析专家 Owner — 当任务涉及增长指标、埋点、漏斗、转化、留存、实验、产品数据决策、增长看板或数据驱动优化时使用；要求把事件、指标、隐私边界和决策闭环绑定到真实用户行为。
---

# Growth Analytics Skill

## 定位

本 Skill 负责增长分析 Owner 视角。它是 P3 条件触发能力，只在增长、转化、留存、实验和产品数据决策出现时启用。它不替代普通日志、性能监控、错误监控或审计日志。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户要求增长、转化、漏斗、留存、激活、复购、获客、运营指标或增长看板 | 必须 |
| 功能设计需要埋点、事件命名、指标口径、实验分流或数据驱动决策 | 必须 |
| 文档、产品方案或报告需要说明成功指标和行为数据验证 | 可选，命中产品增长语义时触发 |
| 普通日志、性能指标、错误监控、审计日志、SRE 可观测性 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `GrowthAnalyticsGate` | 增长问题、指标、事件、实验和决策闭环必须完整 | growthQuestion、decisionLoop |
| `MetricTaxonomyGate` | 北极星、输入指标、护栏指标、分群维度和反作弊口径必须定义 | metricTaxonomy |
| `EventInstrumentationGate` | 事件必须有命名、触发时机、属性、去重、采样和版本策略 | eventInstrumentation |
| `FunnelRetentionGate` | 漏斗、留存、 cohort 和流失原因不能只写概念 | funnelRetentionModel |
| `ExperimentDesignGate` | 实验必须有假设、分流、样本、停止条件、护栏和回滚 | experimentDesign |
| `PrivacyConsentGate` | 埋点和分析必须说明隐私、同意、最小化和保留边界 | privacyConsentBoundary |

## 执行步骤

1. 明确增长问题：目标用户、行为路径、业务目标和可观察结果。
2. 定义指标分类：北极星、输入指标、护栏指标、分群维度和口径来源。
3. 设计事件模型：事件名、触发时机、属性、去重、版本和采集失败处理。
4. 建立漏斗、留存或实验方案，写清假设、样本、停止条件和回滚。
5. 检查隐私、同意、数据最小化和数据保留策略。
6. 写出决策闭环：什么信号触发继续、停止、回滚或二次实验。

## 输出字段

```markdown
## GrowthAnalyticsGate

| 字段 | 内容 |
|------|------|
| growthQuestion | 增长问题、目标用户、行为路径、业务目标 |
| metricTaxonomy | 北极星、输入指标、护栏指标、分群、口径 |
| eventInstrumentation | 事件名、触发时机、属性、去重、采样、版本 |
| funnelRetentionModel | 漏斗、留存、cohort、转化和流失分析 |
| experimentDesign | 假设、分流、样本、停止条件、护栏、回滚 |
| privacyConsentBoundary | 隐私、同意、最小化、保留、用户可见说明 |
| decisionLoop | 数据如何驱动继续、停止、回滚或下一轮实验 |
| evidenceMatrix | 判断 -> 用户行为 / 事件 / 指标 / 查询 / 实验 / 文档 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 把所有日志都叫埋点 | 区分增长事件、SRE 日志、审计日志和调试日志 |
| 只写 DAU、转化率，没有口径和分群 | 补 `MetricTaxonomyGate` |
| 先加事件，后想用途 | 从 `growthQuestion` 和 `decisionLoop` 反推事件 |
| 实验没有停止条件或护栏指标 | 补 `ExperimentDesignGate` |
| 采集用户行为但不说明隐私和同意 | 补 `PrivacyConsentGate` |

## 与其他 Skill 的关系

- `product-strategy`：定义用户价值和成功信号；本 Skill 将其量化为增长指标和实验闭环。
- `data-architecture`：负责数据模型、质量和消费者；本 Skill 负责增长指标和行为事件语义。
- `production-readiness-sre`：负责运行可观测性；本 Skill 不替代 SRE 指标。
- `business-model-review`：商业化指标或收入实验需要与商业模型联动。

