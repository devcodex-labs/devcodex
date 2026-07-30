---
name: ai-evaluation-engineering
description: AI 评测工程专家 Owner — 当任务涉及模型/Prompt 评测、模型选择、黄金集、评分量表、LLM-as-judge、Judge 校准、重复采样、方差、质量-成本-延迟权衡、提示词回归或模型升级回归时使用；要求把概率性结果转化为可复现、可比较且防污染的评测证据。
---

# AI Evaluation Engineering

## 职责

设计概率性 AI 系统的评测数据、指标、Judge、重复采样、方差和回归决策。AI Agent Skill 负责系统行为，quality-strategy 负责整体测试组合；本 Skill 负责模型/Prompt 质量证据。

## AiEvaluationEngineeringGate

| 字段 | 要求 |
|---|---|
| evaluationDatasetManifest | 来源、版本、许可/隐私、任务分层、难例、污染风险和 split |
| goldenCaseSet | 输入、期望属性/答案、允许变体、失败标签和维护 owner |
| metricRubric | deterministic/semantic/human 指标、权重、阈值和不可聚合项 |
| judgeCalibration | Judge 模型/Prompt/版本、盲测、与人工一致性、偏差和漂移 |
| samplingProtocol | temperature/seed、重复次数、置信区间、停止规则和失败重试 |
| varianceReport | 均值、分布、尾部失败、跨 run/provider 差异和不确定性 |
| costLatencyQualityFrontier | token/费用/延迟/成功率/质量的 Pareto 权衡 |
| regressionDecision | baseline/candidate、显著性、阻断阈值、例外和 rollback |

## 执行流程

1. 冻结 use case、风险等级、失败类型和评测决策用途。
2. 建立 train/dev/test 或等价隔离，检查 benchmark、Prompt 和检索语料污染。
3. 将确定性断言、语义评分、人工评审和业务 outcome 分层，禁止只用单一总分。
4. 校准 Judge：随机顺序、隐藏候选身份、人工样本对照、位置/长度/风格偏差。
5. 对概率性路径重复采样，报告方差和尾部失败，不用单次成功代表稳定。
6. 同时测质量、成本、延迟和工具/结构化输出正确性。
7. 用固定版本 manifest 对比 baseline/candidate，达到阈值才进入发布或模型切换。

## 输出字段

`evaluationDatasetManifest`、`goldenCaseSet`、`metricRubric`、`judgeCalibration`、`samplingProtocol`、`varianceReport`、`costLatencyQualityFrontier`、`regressionDecision`、`contaminationCheck`、`evidenceMatrix`。

## 反模式

- 用少量“看起来不错”的示例替代评测集。
- Judge 未校准、知道候选身份或与被评模型同一偏差源。
- 只跑一次、不报方差，却给出稳定性结论。
- 把模型名或主观偏好当质量证据。
- 只看质量分，不披露成本、延迟、结构化输出和工具失败。
- 在调 Prompt 时反复看 test set，造成隐性污染。
- 复制历史分数而不锁定 dataset/model/prompt/tool versions。

## 验证

至少覆盖确定性与概率性双轨、重复采样、Judge 与人工校准、position/verbosity bias、数据污染、provider fallback、工具调用/JSON 合法性、成本延迟预算、版本回归和 inconclusive 路径。
