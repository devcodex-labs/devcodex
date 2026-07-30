---
name: distributed-systems-architecture
description: 分布式系统架构专家 Owner — 当任务涉及消息队列、RPC、事件驱动、跨服务一致性、分布式锁/租约、交付语义、顺序、幂等、重试、补偿、分区、背压或故障注入时使用；要求把网络与重复执行视为常态并冻结可验证的不变量。
---

# Distributed Systems Architecture

## 职责

从系统级边界统一设计一致性、交付、顺序、幂等、重试、补偿、分区与背压。backend 负责领域流程，SRE 负责运行恢复，data 负责持久化；本 Skill 负责跨节点/跨服务语义。

## DistributedSystemsArchitectureGate

| 字段 | 要求 |
|---|---|
| consistencyModel | strong/eventual/causal/session 等选择、读写可见性和可接受陈旧窗口 |
| deliverySemantics | at-most-once / at-least-once / effectively-once，禁止无证据承诺 exactly-once |
| orderingPolicy | global/partition/key ordering、乱序窗口、重放规则 |
| idempotencyModel | key、scope、TTL、结果缓存、并发重复和副作用边界 |
| retryBudget | retryable 分类、backoff/jitter、总预算、deadline 与 retry storm 防护 |
| compensationPlan | transaction/outbox/saga/补偿动作、不可补偿边界和人工恢复 |
| partitionFailureMatrix | timeout、partial failure、lease loss、split brain、clock skew、dependency outage |
| backpressurePlan | producer/consumer 速率、队列上限、drop/reject/degrade、dead letter 与恢复 |
| durableBatchOrchestration | 数据源耗尽、持久 cursor/checkpoint、批次节奏、多 Worker 原子聚合、durable completion、Coordinator/callback 崩溃恢复 |

## 执行流程

1. 列出节点、服务、存储、broker 和外部系统的信任/失败边界。
2. 冻结业务不变量与可接受一致性，而不是先选中间件。
3. 为每条写路径定义 delivery/order/idempotency/retry/compensation。
4. 为 lease/lock/single-active 定义丢失资格后的 fail-safe，禁止继续副作用。
5. 建立正常、重复、乱序、延迟、丢失、分区、恢复与重放矩阵。
6. 将可观测字段绑定 request/event/idempotency/trace/attempt/partition。
7. 把验证映射到 unit/integration/failure-injection/load/recovery replay。

## DurableBatchOrchestrationProbe

队列、批处理、导入导出或 fan-out/fan-in 流程声称“完整 run”时，必须验证：

1. 数据源是否分页/流式推进至可证明耗尽，并持久化 cursor/checkpoint。
2. 批次节奏、并发和背压是否有界，重试后不会重复扩大副作用。
3. 多 Worker 的 accepted/completed/failed 计数与聚合状态是否原子、幂等且可重放。
4. BatchRun/Batch/Job/Coordinator/Completion Event（或等价领域对象）是否持久化，进程内 callback 不作为唯一完成事实源。
5. Coordinator、Worker、callback、broker/storage 崩溃后能从持久状态恢复并保持最终完成不变量。
6. executable evidence 覆盖 crash、duplicate、out-of-order、dependency outage、rolling drain 和恢复后聚合。

缺少任一适用项只能 `partial`；一次 `addBulk` 或内存循环只证明入队动作，不证明 durable batch orchestration。

## 输出字段

`consistencyModel`、`deliverySemantics`、`orderingPolicy`、`idempotencyModel`、`retryBudget`、`compensationPlan`、`partitionFailureMatrix`、`backpressurePlan`、`observabilityKeys`、`verificationRoute`、`evidenceMatrix`。

## 反模式

- 用“最终一致”代替陈旧窗口、冲突策略和收敛条件。
- 宣称 exactly-once，却只做消息去重或 broker ACK。
- 所有错误无限重试，未设 deadline、jitter 和 retry budget。
- 分布式锁过期/续租失败后仍继续写副作用。
- 只测试正常路径，不测重复、乱序、分区和恢复。
- 把 Redis、Kafka 或数据库选型当作系统语义本身。

## 验证

至少覆盖 duplicate、out-of-order、late/lost message、consumer crash、broker/storage outage、lease loss、retry storm、poison message、partial success、replay 与恢复后不变量。
