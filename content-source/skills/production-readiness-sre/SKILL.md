---
name: production-readiness-sre
description: 生产可用性 / SRE 专家 Owner — 当任务涉及发布风险、运行稳定性、可观测性、容量、资源生命周期、内存泄漏、回滚、故障恢复、运行手册、长连接、队列、缓存或生产验收时使用；要求把实现映射到可运行、可监控、可恢复、可回滚。
---

# Production Readiness SRE Skill

## 定位

本 Skill 负责生产可用性与 SRE Owner 视角。它把“代码能跑”提升为“生产可运行、可观察、可扩展、可恢复、可回滚”，尤其关注长运行服务、资源生命周期、泄漏风险、容量边界和发布失败后的恢复。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 服务、CLI、Hook、长连接、队列、缓存、数据库、文件句柄、定时任务或后台进程变化 | 必须 |
| 发布、回滚、生产验收、稳定性、压测、内存泄漏、资源清理或故障恢复 | 必须 |
| 用户要求“全面验证”“发版前检查”“生产可用”“压测/泄漏风险” | 必须 |
| 一次性本地文档修改且无运行面 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `ProductionReadinessSreGate` | 变更必须说明可观测性、容量假设、故障模式、回滚和运行证据 | logs、metrics、tests、runbook、release evidence |
| `ObservabilityPlanGate` | 关键路径有日志、指标、trace 或可诊断输出 | observabilityPlan |
| `CapacityAssumptionGate` | 容量、并发、数据量、超时、重试和限流假设明确 | capacityAssumption |
| `LeakRiskStabilityGate` | 长生命周期资源必须检查释放、泄漏风险和必要压测路线 | resource lifecycle、pressure test |
| `FailureModeRecoveryGate` | 超时、下游失败、部分失败、重试风暴和数据不一致有恢复策略 | failureModes |
| `RollbackRunbookGate` | 发布前明确回滚条件、回滚步骤、验证和负责人/触发器 | rollbackPlan、runbookEntry |

## 执行步骤

1. 判断运行面：进程、端口、连接、队列、缓存、文件、定时任务、Hook 或发布包。
2. 建立可观测性：日志字段、错误码、指标、trace、命令输出或报告证据。
3. 写容量假设：数据规模、并发、超时、重试、批量大小、内存和 CPU 预算。
4. 检查资源生命周期：创建、复用、关闭、异常路径释放和泄漏探针。
5. 枚举故障模式：网络、权限、磁盘、配置、依赖、并发、重复执行和部分失败。
6. 定义回滚和运行手册：发布前检查、失败判断、回滚命令、验证方式和后续观察。

## 输出字段

```markdown
## ProductionReadinessSreGate

| 字段 | 内容 |
|------|------|
| observabilityPlan | 日志、指标、trace、错误码、报告或命令输出 |
| capacityAssumption | 并发、数据量、超时、重试、限流、资源预算 |
| failureModes | 下游失败、超时、部分失败、重复执行、数据不一致等 |
| rollbackPlan | 回滚条件、步骤、验证和影响范围 |
| runbookEntry | 运行手册、排障入口、监控和恢复动作 |
| releaseRisk | 发布风险、兼容风险、依赖风险和缓解 |
| operationalEvidence | 测试、压测、日志、构建、pack、install smoke 或人工证据 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 只跑单元测试就宣称可发版 | 补 release-verification、pack/install smoke、回滚和发布后验收 |
| 长连接或 watcher 无清理路径 | 记录生命周期并测试 close / cleanup / timeout |
| 压测只看吞吐，不看内存或句柄增长 | 增加 leak-risk stability 指标和采样窗口 |
| 本地启动服务后不记录 PID/端口或不清理 | 遵守 ServiceLifecycleCleanup，收尾核验端口释放 |

## 与其他 Skill 的关系

- `release-verification` / `audit-release`：发布执行和发布审查分别承接 R0~R7 与 release readiness。
- `test-router`：将 SRE 风险映射为单元、集成、负载、稳定性、pack、install smoke 或 manual evidence。
- `audit-project`：资源生命周期、内存泄漏和工程稳定性审查叠加本 Skill。
- `expert-output-quality`：报告必须用生产可用性证据支撑，不只写“测试通过”。
