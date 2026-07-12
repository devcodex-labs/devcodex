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

## 输出字段

`workloadModel`、`performanceBudget`、`benchmarkProtocol`、`baselineEvidence`、`profilingEvidence`、`bottleneckAttribution`、`capacityModel`、`regressionThresholds`、`comparisonLimits`、`decision`、`evidenceMatrix`。

## 反模式

- 没有基线就声称提升、最快或无回归。
- 只报平均值，不报 p95/p99、错误率和资源饱和。
- 对比环境、版本、数据或缓存状态不同却给出百分比。
- benchmark 本身写文件、重建 dist 或污染后续 pack。
- 微基准变快就推断端到端用户路径变快。
- 通过降低正确性、持久性、审计或安全换性能而不披露。

## 验证

至少覆盖 warmup/measurement 分离、重复样本、噪声带、环境元数据、基线可比性、资源瓶颈、正确性守恒、容量拐点和回归阈值；不可比较时结论必须为 `inconclusive`。
