---
name: business-model-review
description: 商业模型审查专家 Owner — 当任务涉及商业化、定价、套餐、成本收益、收入模型、运营负担、市场渠道、付费路径、商业风险或长期可持续性时使用；要求把技术方案和产品范围绑定到价值交换、成本结构和可持续运营。
---

# Business Model Review Skill

## 定位

本 Skill 负责商业模型审查 Owner 视角。它是 P3 条件触发能力，只在商业化、定价、运营、成本收益、付费路径或长期可持续性出现时启用。它不替代财务预测、法律税务建议或普通研发工作量估算。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户要求商业模式、定价、套餐、付费、成本收益、ROI、运营、市场或可持续性判断 | 必须 |
| 功能会影响付费路径、套餐权益、用量计费、服务成本、人工运营或渠道策略 | 必须 |
| 技术方案需要解释长期维护成本、商业风险或资源消耗与价值是否匹配 | 可选，命中商业语义时触发 |
| 单纯开发工作量估算、内部技术债、普通性能成本 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `BusinessModelReviewGate` | 商业判断必须绑定价值交换、成本结构、定价和运营风险 | valueExchange、revenueCostModel |
| `ValueExchangeGate` | 谁付费、为什么付费、替代方案和价值感知必须清楚 | valueExchange |
| `RevenueCostGate` | 收入来源、成本驱动、毛利风险、用量成本和人工成本必须列出 | revenueCostModel |
| `PricingPackagingGate` | 定价、套餐、权益、限制、升级路径和公平性必须成体系 | pricingPackaging |
| `MarketChannelGate` | 目标市场、用户分层、渠道、采购/决策链路必须说明 | marketSegmentChannel |
| `OperationalSustainabilityGate` | 支持、交付、合规、SLA、TCO 和长期维护不能缺位 | operationalRisk、sustainabilityTco |

## 执行步骤

1. 识别商业问题：付费对象、使用者、决策者、价值交换和替代方案。
2. 建立收入与成本模型：收入来源、成本驱动、用量曲线、人工运营和维护负担。
3. 审查定价与套餐：权益、限制、升级路径、试用、退款、边界和公平性。
4. 审查市场与渠道：目标细分、采购链路、渠道约束和运营依赖。
5. 审查长期可持续性：TCO、SLA、支持、合规、毛利风险和退出策略。
6. 输出决策边界：本阶段采用、延后、拒绝或需要用户/业务确认的事项。

## 输出字段

```markdown
## BusinessModelReviewGate

| 字段 | 内容 |
|------|------|
| valueExchange | 付费对象、使用者、决策者、价值、替代方案 |
| revenueCostModel | 收入来源、成本驱动、用量成本、人工成本、毛利风险 |
| pricingPackaging | 定价、套餐、权益、限制、升级、试用、退款 |
| marketSegmentChannel | 用户分层、市场、渠道、采购链路、运营依赖 |
| operationalRisk | 支持、交付、合规、SLA、客户成功、人工流程 |
| sustainabilityTco | 长期维护、资源消耗、TCO、退出策略 |
| decisionBoundary | 本阶段采纳、延后、拒绝、需用户确认 |
| evidenceMatrix | 判断 -> 用户目标 / 数据 / 成本 / 市场 / 文档 / 运营证据 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 只说“商业价值高”，没有价值交换和付费对象 | 补 `ValueExchangeGate` |
| 只看开发成本，不看运行成本和人工运营 | 补 `RevenueCostGate` 与 `OperationalSustainabilityGate` |
| 套餐边界靠临时 if/else 堆出来 | 补 `PricingPackagingGate` 和权益模型 |
| 把商业判断伪装成确定财务预测 | 标明假设、证据不足和需业务确认事项 |
| 商业化引入复杂度却没有退出策略 | 补 `sustainabilityTco` 与 `decisionBoundary` |

## 与其他 Skill 的关系

- `product-strategy`：负责用户价值和范围取舍；本 Skill 负责商业闭环和可持续性。
- `growth-analytics`：商业化实验、转化和收入指标需要增长分析证据。
- `api-contract-architecture`：套餐、计费或权益如果影响 API，必须冻结公共契约。
- `production-readiness-sre`：SLA、容量和运行成本需要 SRE 证据。

