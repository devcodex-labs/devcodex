---
agent: agent
description: 性能优化工作流报告模板，用于 dev.optimization 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/optimizations/**
---
# 性能优化报告模板

> **路径**: 优先 `.devcodex/optimizations/<目标>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/optimizations/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: dev.optimization 工作流完成后，由 `report/SKILL.md` 驱动生成
> **共享基模**: `skills/report/report-schema.json` 的 baseFields + optimization overlay；治理结果按 `gateGroup / result / evidence / skipReason` 记录
> **字段约束**: 每条优化建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证

---

```markdown
# [优化目标] 性能优化报告

> **项目**: <project>
> **类型**: dev
> **子类型**: optimization
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
> **关联需求**: [路径]
> **支撑产物**: ExecutionContract / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / TaskResolutionV1 / CliDiagnosticContract / CheckpointValidation / LocalTaskTrace / ProjectKnowledge / ExecutionAttemptLedger / TurnLivenessRecovery / 05-实施进度.md（按触发状态填写）
```

## §1 执行摘要

> 一段话描述本次性能优化的核心内容和结果。

## §2 基准数据（优化前）

| 指标 | 基准值 | 测试工具 | 测试条件 |
|------|:------:|---------|---------|
| 吞吐量 | X req/s | autocannon | — |
| 平均延迟 | X ms | — | — |
| P99 延迟 | X ms | — | — |

## §3 优化内容

| 编号 | 优化项 | 文件变更 | 说明 |
|------|-------|---------|------|
| O-01 | | | |

## §4 优化后数据

| 指标 | 优化前 | 优化后 | 提升幅度 |
|------|:------:|:------:|:-------:|
| 吞吐量 | X req/s | Y req/s | +Z% |
| 平均延迟 | X ms | Y ms | -Z% |
| P99 延迟 | X ms | Y ms | -Z% |

执行链优化追加 `ExecutionChainBenchmarkResultV1`：列出 environment identity、cold/warm、warmup/measurement、四个 direct-benefit 维度的 median/p95/sampleCount、correctness、instrumentation overhead、几何平均改善与 improvedDimensions。环境或样本不可比时结论必须为 `provisional`；token/TTFT 不可观测写 `N/A + reason`，禁止用 bytes/chars 代替。

同时给出六类消费者的 `ExecutionOptimizationFeatureDecisionV1` 负向证据：feature 置为 `rolled-back` 或 state 无效时，task index、Context cache、changed validation、Profile section、Skill bundle、ProjectKnowledge 必须逐一命中完整 fallback。ProjectKnowledge 命中时追加 V2 binding/Merkle、SemanticClaim range/authority、5% oracle、V1 read-only migration 与 accepted-only pointer 证据，并明确结构化 bootstrap 不等于人工逐文件深读。只有 status/doctor 显示回滚、真实消费者未切换时属于阻断性 correctness failure。

| feature | lifecycle | baseline/candidate | direct benefit | correctness | fallback regression | overhead/false positive | verdict |
|---------|-----------|--------------------|----------------|-------------|---------------------|-------------------------|---------|
| | off/shadow/trial/default/rolled-back/sunset | | | | | | effective/ineffective/harmful/insufficient-evidence |

## §5 接口行为一致性

> 优化不得改变对外接口行为，验证如下：

| 接口 | 优化前 | 优化后 | 一致？ |
|------|--------|--------|:------:|
| | | | ✅ |

## §6 测试验证

| 类型 | 结果 | 说明 |
|------|:----:|------|
| TestRoute 覆盖 | ✅ 通过 / N/A | — |
| HostContract 验证 | ✅ 通过 / N/A | — |
| api-verification | ✅ 通过 | 接口行为未变 |
| 负载测试 (autocannon) | ✅ 通过 | — |
| 单元测试 | ✅ 通过 | — |
| `test:execution-chain-evolution` / V101 | ✅ 通过 / N/A | prospective trial、full-only、rollback/sunset、invalid-state fail-closed 与六消费者 feature decision 闭包 |

## §6.2 工作流 overlay 与治理证据（条件）

<!-- devcodex:include shared/report/shared-schema-note.md -->

<!-- devcodex:include shared/report/host-capability-routing-record.md -->

<!-- devcodex:include shared/report/gate-result-table.md -->

<!-- devcodex:include shared/report/context-handoff-condition.md -->

<!-- devcodex:include shared/report/task-continuation-record.md -->

### §6.3 EvidenceFreshness（条件）

> 当优化报告中的推荐、收益、已验证、完成态或残留清单声明需要复用证据时填写；没有 strong claim 时写 `N/A + skipReason=no-strong-claims`。

<!-- devcodex:include shared/report/evidence-freshness-table.md -->

## §6.5 ECR 执行闭环复审

<!-- devcodex:include shared/report/review-grade-card-template.md -->

| ECR 项 | 检查对象 | 结果 | 证据 |
|--------|----------|:----:|------|
| ECR-1 | CP1/CP2/CP3、05-实施进度、报告、daily tasks、SUMMARY | ✅/⚠️ | |
| ECR-2 | 优化目标 → diff/commit 文件 | ✅/⚠️ | |
| ECR-3 | CP3 步骤 / ExecutionContract / TestRoute / ConceptSyncMap / HostContractVerification → 基准/测试/部署/验证证据 | ✅/⚠️ | |
| ECR-4 | 报告声明 → 性能数据/测试结果/ReleaseAudit/ReleaseVerification/部署同步证据 | ✅/⚠️ | |
| ECR-5 | memory daily → SUMMARY | ✅/⚠️ | |
| ECR-6 | git dirty 边界 | ✅/⚠️ | |
| ECR-7 | 控制面任务 SCV / validate / direct replay / host-contract probe / 新增探针 / 黄色偏离 | ✅/N/A | |

## §7 遗留问题

<!-- devcodex:include shared/report/issue-suggestion-validation-table.md -->