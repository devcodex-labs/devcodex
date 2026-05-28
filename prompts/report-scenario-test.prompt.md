---
agent: agent
description: 场景测试工作流报告模板，用于 dev.scenario-test 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/scenario-tests/**
---
# 场景测试报告模板

> **路径**: 优先 `.devcodex/scenario-tests/<场景>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/scenario-tests/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: dev.scenario-test 工作流完成后，由 `report/SKILL.md` 驱动生成
> **字段约束**: 每条问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证

---

```markdown
# [测试场景名称] 场景测试报告

> **项目**: <project>
> **类型**: dev
> **子类型**: scenario-test
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
> **关联需求**: [路径]
> **支撑产物**: ExecutionContract / TestRoute / ReleaseVerification / 05-实施进度.md（按触发状态填写）
```

## §1 执行摘要

> 一段话描述本次场景测试的目标和结论。

## §2 测试场景

| 编号 | 场景 | 前置条件 | 预期结果 |
|------|------|---------|---------|
| S-01 | | | |

## §3 负载测试配置

| 参数 | 值 | 说明 |
|------|:--:|------|
| 工具 | artillery | 默认负载测试工具 |
| 目标并发 | X | — |
| 持续时间 | X s | — |
| Ramp-up | X s | — |

## §4 测试结果

| 指标 | 结果 | 通过？ |
|------|:----:|:------:|
| 吞吐量 | X req/s | ✅/❌ |
| 平均延迟 | X ms | ✅/❌ |
| P99 延迟 | X ms | ✅/❌ |
| 错误率 | X% | ✅/❌ |

## §5 场景验证结果

| 场景 | 实际结果 | 符合预期？ |
|------|---------|:---------:|
| S-01 | | ✅/❌ |

## §6 测试数据说明

> 使用 fixtures 数据还是模拟数据，说明数据来源。

## §6.2 支撑产物状态

| 产物 | 触发状态 | 结果 | 证据 |
|------|----------|:----:|------|
| ExecutionContract | ✅/N/A | ✅/⚠️ | |
| TestRoute | ✅/N/A | ✅/⚠️ | |
| ReleaseVerification | ✅/N/A | ✅/⚠️ | |
| 05-实施进度.md | ✅/N/A | ✅/⚠️ | |

## §6.5 ECR 执行闭环复审

| ECR 项 | 检查对象 | 结果 | 证据 |
|--------|----------|:----:|------|
| ECR-1 | CP1/CP2/CP3、05-实施进度、报告、daily tasks、SUMMARY | ✅/⚠️ | |
| ECR-2 | 场景目标 → 测试文件/验证产物 | ✅/⚠️ | |
| ECR-3 | CP3 步骤 / ExecutionContract / TestRoute → 测试/负载/验证证据 | ✅/⚠️ | |
| ECR-4 | 报告声明 → 测试结果/数据来源/ReleaseVerification | ✅/⚠️ | |
| ECR-5 | memory daily → SUMMARY | ✅/⚠️ | |
| ECR-6 | git dirty 边界 | ✅/⚠️ | |
| ECR-7 | 控制面任务 SCV / validate / direct replay / host-contract probe | ✅/N/A | |

## §7 遗留问题

| 问题/建议 | 优先级 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 | 后续处理 |
|-----------|:------:|--------|----------|------|----------|----------|----------|
| | | | | | ✅已验证 / ⚠️待验证 | | |
