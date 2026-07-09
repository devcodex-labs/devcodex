---
name: quality-strategy
description: 质量策略专家 Owner — 当任务涉及测试策略、验收矩阵、覆盖率、风险分层、回归范围、发布信心、质量度量、测试金字塔或用户要求 QA/质量专家视角时使用；要求用风险驱动选择验证组合。
---

# Quality Strategy Skill

## 定位

本 Skill 负责质量策略 Owner 视角。它避免“所有都跑”或“只跑单测”的机械路线，用风险、消费者和发布面决定验证组合。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 测试策略、验收矩阵、覆盖率、风险分层、回归计划、发布前质量判断 | 必须 |
| 方案影响 public API、runtime、CLI、Hook、文档站、数据、外部集成或安全边界 | 必须 |
| 用户要求写测试、压测、复审、发布前检查或质量报告 | 必须 |
| 低风险纯文案且已有验证路线 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `QualityStrategyGate` | 风险模型、测试组合、验收矩阵、回归范围、覆盖率和发布信心必须明确 | riskModel、acceptanceMatrix |
| `RiskBasedTestPyramidGate` | 测试类型按风险选择，不用单一测试替代全链 | testPyramid |
| `AcceptanceMatrixGate` | 需求、契约、用户文档和技术验证必须可追踪 | acceptanceMatrix |
| `RegressionScopeGate` | 回归范围、相关 suite 和 full gate 升级条件必须清楚 | regressionScope |
| `CoverageReleaseConfidenceGate` | coverage、known-red、发布信心和残余风险必须单独判断 | coverageGate、releaseConfidence |

## 执行步骤

1. 建立风险模型：变更面、消费者、失败代价、可回滚性。
2. 选择测试组合：静态、单元、集成、API、E2E、场景、负载、pack、发布验证。
3. 建立验收矩阵：需求/契约/文档/代码/验证证据。
4. 设定回归范围和升级条件：targeted、related、full gate。
5. 输出 coverage、known-red、发布信心和残余风险。

## 输出字段

```markdown
## QualityStrategyGate

| 字段 | 内容 |
|------|------|
| riskModel | 变更风险、消费者、失败代价 |
| testPyramid | 测试组合和层级 |
| acceptanceMatrix | 需求/契约/文档/代码/验证映射 |
| regressionScope | targeted/related/full gate 范围 |
| coverageGate | coverage 脚本、阈值、状态、skipReason |
| releaseConfidence | 发布信心、残余风险、阻断条件 |
| evidenceMatrix | 判断 -> 命令 / 测试 / 覆盖率 / 构建 / pack / CI |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 用“单测通过”替代覆盖率或发布信心 | 单独执行 CoverageGateDecision |
| 高风险 runtime 只跑 targeted | 按 RiskBasedValidationLadder 升级 |
| 低风险文案跑重 E2E | 用 VerificationScopeBudgetGate 降级 |
| 验收标准散落在报告里 | 建 acceptanceMatrix |

## 与其他 Skill 的关系

- `test-router`：质量策略为 TestRoute 提供风险和验证组合。
- `release-verification`：发布前质量信心进入 R0~R7。
- `review-checklist`：复审清单要绑定 acceptanceMatrix 和证据。
