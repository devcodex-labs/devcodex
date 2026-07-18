---
name: performance-engineering
description: 性能工程专家 Owner — 当任务涉及性能优化、性能预算、benchmark、profiling、p95/p99、吞吐、延迟、资源效率、容量规划、压测或性能回归时使用；要求先建立可比较基线，再定位瓶颈、评估容量并形成统计可信的回归结论。
---

# Performance Engineering

## 职责

把“更快”转化为可复现的 workload、预算、基准、profiling、瓶颈归因、容量与回归合同。dev-optimization 负责开发流程，SRE 负责生产运行；本 Skill 负责性能证据的专业可信度。

## PerformanceEngineeringGate

| 字段 | 要求 |
|---|---|
| workloadModel | 用户路径、数据规模、并发、读写比、缓存状态、突发与稳态 |
| performanceBudget | latency percentile、throughput、resource、error/saturation 阈值 |
| benchmarkProtocol | 环境、版本、warmup、sample、duration、重复次数、噪声控制 |
| profilingEvidence | CPU/heap/I/O/lock/network/GC 等证据和采样边界 |
| bottleneckAttribution | 症状→资源→调用路径→因果实验，区分相关与因果 |
| capacityModel | 单实例能力、扩展曲线、饱和点、headroom、成本 |
| regressionThresholds | 绝对/相对阈值、置信区间、噪声带和阻断条件 |

## 执行流程

1. 冻结当前基线、目标用户路径和不可牺牲的正确性/稳定性。
2. 建立代表 workload；区分 cold/warm cache、steady/burst 和 local/CI/prod-like。
3. 先测基线，再 profiling；禁止先改代码后寻找支持结论的数据。
4. 一次改变一个主要变量，保留版本、硬件、配置、数据和命令。
5. 同时看 latency distribution、throughput、errors、CPU/memory/I/O/GC 和尾延迟。
6. 输出 capacity/headroom 与成本权衡；优化不能靠隐藏限流或丢请求。
7. 用同协议重跑对照，达到阈值才判 accepted。

## ModulePerformanceCoverageAndMaintenanceGate

当框架、SDK、CLI、runtime 或公共包声称“完整性能覆盖”时，单一 benchmark、全局 DIM 或一个 release gate 不足以通过。必须先为每个功能判定 performance applicability，再为每个适用模块建立：

| 维度 | 必填证据 |
|---|---|
| moduleProtocol | workload、budget、immutable baseline、candidate comparison |
| capacityResource | capacity/headroom、CPU/memory/I/O/GC、饱和点和成本 |
| stabilityRecovery | leak/pressure（适用时）、故障/冷却/恢复、正确性守恒 |
| maintenanceTriggers | PR、main、scheduled、RC、post-release 的触发与升级关系 |
| evidenceGovernance | retention、freshness、drift、owner、skip/N/A/flake 处理 |
| coverageState | total/applicable/executed/accepted/failed/skipped/stale，清单完成与执行完成分开 |

全部适用模块 accepted 前只能报告 `partial`；不可变基线变更必须有授权和迁移证据，不能通过减少适用模块、删除 flake 或重写基线制造通过率。

## ExecutionChainBenchmarkGate

DevCodex 自身的任务续接、上下文/Profile/Skill 读取、验证 DAG 与增量分析优化统一输出 `ExecutionChainBenchmarkResultV1`。四个 direct-benefit 维度为 validation wall time、delivered bytes、analysis recompute work、resume setup cost；baseline/candidate 必须使用同一环境 identity、单位和样本策略，等权计算几何平均，禁止把不同量纲直接相加。

只有 correctness 指标全为 0、综合改善至少 25%、至少 3/4 维度改善 20%、任一维度回归不超过 5%、instrumentation overhead 不超过 3% 时，结果才可 `accepted`。样本不足、环境不一致或宿主 token/TTFT 不可观测时保持 `provisional` / `N/A`；不得用 bytes 冒充 token。任何默认晋级还必须有 prospective trial（至少 3 个可比 WorkUnit 或 2 个独立上下文），历史样例只能证明基线。

性能 accepted 还必须证明 lifecycle 能控制真实执行路径：将每个受控 feature 置为 `rolled-back` 后，task index、Context cache、changed validation、Profile section、Skill bundle 与 ProjectKnowledge 都必须通过 `ExecutionOptimizationFeatureDecisionV1` 回到完整路径；只有 status/doctor 投影变化、消费者仍走加速时属于 correctness failure，收益数据作废。

基准 evaluator 使用 `npm run benchmark:execution-chain -- --input <ExecutionChainBenchmarkInputV1.json>`；只有显式 `--output` 才可写结果。benchmark、website build 与 package smoke 串行执行，避免派生产物污染可比性。

## 输出字段

`workloadModel`、`performanceBudget`、`benchmarkProtocol`、`baselineEvidence`、`profilingEvidence`、`bottleneckAttribution`、`capacityModel`、`regressionThresholds`、`comparisonLimits`、`modulePerformanceCoverage`、`maintenanceTriggers`、`executionChainBenchmark`、`decision`、`evidenceMatrix`。

## 反模式

- 没有基线就声称提升、最快或无回归。
- 只报平均值，不报 p95/p99、错误率和资源饱和。
- 对比环境、版本、数据或缓存状态不同却给出百分比。
- benchmark 本身写文件、重建 dist 或污染后续 pack。
- 微基准变快就推断端到端用户路径变快。
- 通过降低正确性、持久性、审计或安全换性能而不披露。

## 验证

至少覆盖 warmup/measurement 分离、重复样本、噪声带、环境元数据、基线可比性、资源瓶颈、正确性守恒、容量拐点和回归阈值；不可比较时结论必须为 `inconclusive`。
