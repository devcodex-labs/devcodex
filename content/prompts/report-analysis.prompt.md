---
agent: agent
description: 分析工作流报告模板，用于 analyze 工作流完成后输出调研/分析报告
applyTo: .devcodex/**/reports/analysis/**
---
# 分析报告模板

> **路径**: 优先 `<任务目录>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/analysis/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: analyze 工作流完成后，由 `report/SKILL.md` 驱动生成
> **共享基模**: `skills/report/report-schema.json` 的 baseFields + analyze overlay；治理结果按 `gateGroup / result / evidence / skipReason` 记录
> **字段约束**: 每条建议/结论必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证

---

```markdown
# [分析主题] 分析报告

> **项目**: <project>
> **类型**: analyze
> **子类型**: analyze.default / analyze.research
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
```

## §1 核心问题

> 一句话描述本次分析要回答的核心问题。

## §2 调研范围

- 深度：快速概览 / 深度分析
- 技术栈约束：（来自项目 profile）
- QuestionEvidenceGate：triggered / N/A；若 triggered，写明 `ComparativeResearchGate` 证据范围（repo-local / same-type-project / official-current-docs）或 `N/A + skipReason`
- 排除范围：

## §3 分析结论

### §3.0 用户可见收口（对话内主读）

> 最终回复（非仅本报告文件）须让用户**不打开报告源码**也能读懂：结果一句话 + ≥1 要点 + 本报告链接。  
> 禁止仅链接 /「详见报告」；`classifyAnalysisArtifactDeliverySample` 对无叙事的链接判 `link-only-thin`。

### §3.1 推荐结论

> 多建议、多路径或技术选型时必须填写；无后续动作时写“推荐：无后续动作”并说明原因。
> 命中 `QuestionEvidenceGate` 时，推荐理由必须引用 `ComparativeResearchGate` 的同类产品 / 项目 / 模块对比证据；不触发时写 `N/A + skipReason`。

**推荐**：[推荐方案 / 推荐：无后续动作]
**推荐理由**：[关联合理性、可实施性、收益、验证状态、影响范围]
**ComparativeResearchGate**：[applied: 证据范围 / N/A + skipReason]

### §3.2 技术选型

```text
推荐：[方案名]
理由：[2~3句话，聚焦关键差异]
注意事项：[风险/限制]
```

### §3.3 可行性评估 / 根因调查

```text
结论：[可行/有条件可行/不可行 | 根因链路]
前置条件：
风险点：
建议：
```

## §4 支撑证据

| 结论 | 证据 | 来源 |
|------|------|------|

> 命中完整/最终 Agent 架构、用户文档受众与渲染顺序、独立消费者仓/跨仓 100%、逐模块性能维护时，分别追加 V95 的 completenessObject/domain matrix、pageRole/generated sequence、repository identity/denominators/CI/freshness、module applicability/protocol/maintenance 证据；未触发写 `N/A + skipReason`。

> 命中 `host-capability-routing` 时，在本节记录 compact `instructionRefId / decisionId / catalogVersion+digest / selectedPortableDecision / nativeEligibility.status / fallback.reasonCode`；禁止复制完整原文或 catalog row，portable `plan_first` 不得写成 native Plan 已进入。

### §4.1 ProfileTruthReconciliationGate

> 项目级 analyze 必填；低风险文件级分析可写 `N/A + skipReason`。analyze 只能矫正结论，不能直接修改 Profile。

| mode | profileTrustState | profileClaim | actualSources | status | conclusionAuthority | correctionRoute |
|------|-------------------|--------------|---------------|--------|---------------------|-----------------|
| targeted / N/A | | | | aligned / stale-profile / stale-code-or-doc / intentional-exception / unverifiable | | |

### §4.2 GovernanceIntakeDecision

> 对本次非空用户消息完成合理性评估后必填；关键词不得作为触发或分类依据。复合意图逐项列出 ledger/evidence；`record.none` 提供独立 challenge evidence；Hook 不可观察时写 `unverified + manualVerificationRoute`。

| candidateId | assessmentVerdict | generalizationScope | existingRuleState | recordIntents | targetLedgers | writeRequirement | writeEvidence | verificationState | skipEvidence |
|-------------|-------------------|---------------------|-------------------|---------------|---------------|------------------|---------------|-------------------|--------------|
| | | | | | | | | | |

### §4.3 收敛证据（CRS / PCV）

> analyze 必须至少执行 3 轮；只有连续 2 轮零新增有效 finding 才可收敛。每轮先写 `CRS`，最终结论前执行 `PCV`，不得用重复同一维度制造零发现。

| round | dimensionDelta | evidenceSources | newFindings | openFindings | CRS | correction |
|------:|----------------|-----------------|------------:|-------------:|-----|------------|
| R1 | | | | | valid / invalid | |
| R2 | | | | | valid / invalid | |
| R3 | | | | | valid / invalid | |

| PCV 字段 | 结果 |
|----------|------|
| `minimumRounds` | >= 3 / failed |
| `consecutiveZeroFindingRounds` | >= 2 / failed |
| `claimEvidenceMatch` | passed / failed |
| `profileTruthReconciled` | passed / N/A + skipReason |
| `finalVerdict` | converged / not-converged |

### §4.4 EvidenceFreshness（条件）

> 当最终结论、推荐方案、覆盖声明或“已验证”强主张需要复用证据时填写；没有 strong claim 时写 `N/A + skipReason=no-strong-claims`。

| mode | status | indexDigest | strongClaims | downgradeRequired | rerunRequired | summaryOnlyBoundary | evidence |
|------|--------|-------------|--------------|-------------------|---------------|---------------------|----------|
| shadow / warn / enforce | PASS / WARN / BLOCK / UNVERIFIED / N/A | | | | | | `npm run test:evidence-freshness` exitCode |

## §5 对比矩阵（技术选型 / ComparativeResearchGate 触发时）

| 维度 | 方案A | 方案B | 方案C |
|------|:-----:|:-----:|:-----:|
| 功能适配 | | | |
| 性能 | | | |
| 生态成熟度 | | | |
| 安全性 | | | |
| 许可证 | | | |

## §6 后续建议

> 若结论需要代码变更，建议切换到的工作流：dev / fix
> 多条建议同时存在时，必须在 §3.1 明确唯一推荐项。

| 建议/结论 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 |
|-----------|--------|----------|------|----------|----------|
| | | | | ✅已验证 / ⚠️待验证 | |

## §7 约束声明

> ⛔ 本分析为只读工作流，未修改任何项目文件。
