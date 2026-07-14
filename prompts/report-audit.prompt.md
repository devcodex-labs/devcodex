---
agent: agent
description: 审查工作流报告模板，用于 audit 工作流完成后输出标准审查报告
applyTo: ".devcodex/**/reports/audit/**, .devcodex/**/reports/self-fix/**"
---
# 审查报告模板

> **路径**: 优先 `<任务目录>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/audit/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: audit 工作流完成后，由 `report/SKILL.md` 驱动生成
> **共享基模**: `skills/report/report-schema.json` 的 baseFields + audit overlay；治理结果按 `gateGroup / result / evidence / skipReason` 记录
> **字段约束**: 每条问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证（本模板 §3 问题清单已含五列示例表头）
---

```markdown
# [审查对象名称] 审查报告

> **项目**: <project>
> **类型**: audit
> **子类型**: [规范文件 / 技术方案 / 需求文档 / 项目工程 / 报告 / 通用文档 / 发布前审查]
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
> **审查目标类型**: 规范文件(D1~D25) / 技术方案(TD-1~TD-13) / 需求文档(RQ-1~RQ-8) / 项目工程(PE-1~PE-12) / 报告(RA-1~RA-6) / 通用文档(DA-1~DA-6) / 发布前审查(RL-1~RL-10)
> **审查范围**: 全面体检 / 定向深度 / 修复验证
> **收敛**: 连续 3 轮有效零发现（仍须满足连续 3 轮零发现；所有子类型统一，不区分定向/全面）
> **ReviewCoverageDelta**: ✅已核验 / ⚠️缺失 / N/A（说明）
> **ReviewDimensionDeltaGate**: ✅已核验 / ⚠️缺失 / N/A（说明）
> **PCV状态**: ✅已完成 / 🔄进行中
> **控制面证据**: Concept Sync Map / HostContractVerification / SCV / 新增探针 / 黄色偏离 / 部署同步（按适用填写）
```

## §1 审查轮次摘要

| 轮次 | 新发现问题 | 本轮解决 | 遗留 |
|:----:|:---------:|:--------:|:----:|
| R1 | X | 0 | X |
| R2 | Y | Z | W |

## §2 执行维度清单

**公共维度（G1~G5）**：✅ 全部执行  
**专属维度**：[已执行的维度编号列表]  
**N/A 维度**：[标注 N/A 的维度及原因]

## §2.1 ReviewCoverageDelta（复审覆盖增量）

> R2 及以后轮次必须填写；若为单轮审查或不适用，写 `N/A + skipReason`。R2+ 同步执行 `ReviewDimensionDeltaGate`，避免每轮机械重复同一组维度。

| 轮次 | ReviewedSet | UnreviewedRelatedSet | NewlyReadThisRound | RepeatReadReason | NoNewSurfaceReason | PreviousDimensionSet | CurrentDimensionFocus | NewDimensionRationale | RepeatedDimensionReason | 是否计入有效零发现 |
|:----:|-------------|----------------------|--------------------|------------------|--------------------|----------------------|-----------------------|-----------------------|-------------------------|:------------------:|
| R1 | 初始 CRS 范围 | | | N/A | N/A | N/A | 初始维度集合 | N/A | N/A | N/A |
| R2 | | | | | | | | | | ✅/❌ |

## §2.5 工作流 overlay 与治理证据（条件）

> 共享基模读取 `skills/report/report-schema.json`，治理分组读取 `skills/spec-governance/gate-registry.json`。本模板只记录实际触发结果，不复制 Gate 目录或 Owner 专属字段。

| gateGroup / 条件产物 | result | ownerSkill / schemaRef | evidence | skipReason |
|----------------------|--------|------------------------|----------|------------|
| | passed / failed / partial / N/A | | | |

跨会话、多批次、中断或残余风险未关闭时追加 `ContextHandoffCard`；Profile、release、service lifecycle 等条件段按 schema 与 Owner Skill 生成。

## §3 问题清单

| # | 级别 | 维度 | 位置 | 问题描述 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 | 发现轮次 | 状态 |
|:-:|:----:|------|------|---------|--------|---------|------|:--------:|---------|:-------:|------|
| 1 | 🔴 | G2 | §3.2 | | | | | ✅ 已验证 | | R1 | 已修复 |
| 2 | 🟡 | TD-4 | §4 | | | | | ⚠️ 待验证 | | R1 | 待处理 |

### §3.5 推荐结论

> 多个修复路径、多个后续动作或是否升级/暂停等决策存在时必须填写；无后续动作时写“推荐：无后续动作”。

**推荐**：[推荐方案 / 推荐：无后续动作]
**推荐理由**：[关联合理性、可实施性、收益、验证状态、影响范围]

## §4 通过项汇总

> 明确通过的关键维度（无问题或已确认符合标准）：

## §5 收敛声明

**收敛条件**：
- [ ] CRS ✅（关联文件扫描完成，无新发现文件）
- [ ] 所有 🔴 级问题已解决
- [ ] 所有 🟡 级问题已处理或标注 N/A
- [ ] 达到收敛条件：连续 3 轮有效零发现（仍须满足连续 3 轮零发现；所有审查类型统一，不区分定向/全面，见 `12-audit §多轮收敛规则`）
- [ ] `ReviewCoverageDelta` 已核验：最近 3 次有效零发现均有新增覆盖，或有证据化 `NoNewSurfaceReason`，未用机械重复同一批已读内容凑数
- [ ] `ReviewDimensionDeltaGate` 已核验：最近 3 次有效零发现均有新增/轮换/补强的维度焦点，或有证据化 `RepeatedDimensionReason`，未用机械重复同一组维度凑数

**最终结论**：✅ 已收敛 / ⚠️ 未收敛（需继续审查）
