---
name: audit-execution-guide
description: 审查执行指南 — 维度优先级分批、定向审查子集、联动检查清单
---
# Audit Execution Guide Skill

## 职责

本 Skill 定义 audit 工作流的执行策略，补充 `audit-common/SKILL.md` 的收敛规则，提供：定向触发子集、新增子类型联动检查、数值引用联动协议。

## 维度优先级分批

| 批次 | 维度 | 说明 |
|------|------|------|
| 🔴 第一批 | D1·D2·D3·D4·D5·D7·D9·D10·D11·D12·D16·D17·D21·D22·D23·D24·D25 | 强制，立即标记 |
| 🟡 第二批 | D6·D8·D18·D19·D20 | 建议，不阻塞 |
| 💡 第三批 | D13·D14·D15 | 改进，Token 允许时执行 |

## 事件驱动定向审查

| 触发场景 | 推荐专属维度 |
|---------|------------|
| 修改了 RULES.md | D2·D3·D5·D9·D17 |
| 修改了 01-common.instructions.md | D2·D5·D6·D7·D10 |
| 修改了 workflow README | D3·D5·D8·D9 |
| 审查 README / 用户使用文档 | DA-1·DA-2·DA-5·DA-6 + `audit-readme`（RM-1~RM-6） |
| 审查发布前准备 / release pre-review | RL-1·RL-2·RL-3·RL-4·RL-5·RL-6·RL-9 + `audit-release`（RL-1~RL-10） |
| 新增 spec 文件 | D1·D5·D9·D15·D17·D18 |
| 新增子类型 spec | D5(#6)·D9·D15 — 联动 L1/L2/L3 |
| 新增维度/约束编号 | D5·D15·D18 + 数值引用联动 |
| 修改了 ENV_MODE/模式行为定义 | D5·D22 — 跨文件语义传播核查 |
| 修改了规则定义文件（字段/术语/路径等） | D5 · **CRS 全库关键词扫描**（见 `audit-common §关联文件发现`）|
| 正式复审 / ECR / 多轮收敛 / 冻结清单 / 外部 finding 批次 | `review-checklist` + ReviewChecklistPrecreationGate / EvidenceExecutionGate / ChecklistStateFreshnessGate |
| R2+ 发现新问题（持续审查中） | **自我审视四轴分析**（见 `audit-common §自我审视机制`）· D5 三层覆盖补查 · `ReviewDimensionDeltaGate` 维度焦点补强 |

## 新增子类型联动检查（L1~L3）⚠️

每次新增子类型 Skill 后**必须核查**：

| # | 检查项 | 对应文件 |
|:-:|--------|---------|
| L1 | `routing/SKILL.md` 路由表包含该子类型行 | `skills/routing/SKILL.md` |
| L2 | `02-output-paths.instructions.md` 注册该子类型目录 | `instructions/02-output-paths.instructions.md` |
| L3 | 对应 workflow report 模板的子类型字段包含该子类型 | `prompts/report-*.prompt.md` |

> ⚠️ 历史教训：session13 新建 scenario-test.md 后三处未同步，session07 才发现。

## 数值引用联动

新增维度编号（D/C/TD/PE/RQ/RA/DA）后，同步更新：
- 对应维度总览表（维度列表文件）
- 执行指南优先级分批表（本文件）
- 交叉引用的 spec 文件中的编号引用

## 体量分批策略

> 配合 [`audit-common/SKILL.md`](../audit-common/SKILL.md) §G0 体量评估 使用。当 G0 判定需要分批时，按以下策略执行。

### 分批原则

- **优先级驱动**：按维度优先级分批（🔴 第一批 → 🟡 第二批 → 💡 第三批）
- **单批次上限**：每批覆盖 ≤ 3 个主维度
- **audit-project**（代码质量）维度建议独立成批（文件量大、分析深度高）

### 分批执行模板

```
批次 1（🔴 核心维度A）：D1·D2·D3·D4·D5 → 输出发现 → 即发即修（有发现则立即 self-fix）→ 写入记忆
批次 2（🔴 核心维度B）：D7·D9·D10·D11·D12 → 输出发现 → 即发即修 → 更新记忆
批次 3（🔴 格式/语义/跨客户端）：D16·D17·D21·D22·D23·D24·D25 → 输出发现 → 即发即修 → 更新记忆
批次 4（🟡 建议维度）：D6·D8·D18·D19·D20 → 输出发现 → 即发即修 → 更新记忆
批次 5（💡 改进维度）：D13·D14·D15 → 输出发现 → 即发即修 → 更新记忆
ReviewCoverageDelta：R2+ 先列 ReviewedSet / UnreviewedRelatedSet / NewlyReadThisRound / RepeatReadReason / NoNewSurfaceReason，优先补读此前未审查但相关的代码、配置、测试、文档、部署副本和消费者链
ReviewDimensionDeltaGate：R2+ 同步列 PreviousDimensionSet / CurrentDimensionFocus / NewDimensionRationale / RepeatedDimensionReason，避免每轮机械重复同一组维度；重复维度只允许阻断项回归、高风险锚点、新证据或抽样
重启轮次：所有批次完成、本轮无新发现，且 ReviewCoverageDelta + ReviewDimensionDeltaGate 合格 → 有效零发现计数 +1 → 连续 3 轮有效零发现则进入 CRS 门禁（仍须满足连续 3 轮零发现）
CRS 收敛门禁：连续 3 轮有效零发现后执行全库关键词扫描（见 audit-common §关联文件发现）
PCV：CRS ✅ 后执行 PCV（见 audit-common §收敛后汇总验证）→ 最终报告
```

> ℹ️ 批次1~3 均为 🔴 强制维度（与 §维度优先级分批 第一批 D1~D25 一致）；批次3 专门集中格式与语义类 🔴 维度（D16/D17/D21/D22/D23/D24/D25）。

> ℹ️ **即发即修的含义**：每批次发现问题后，在开始下一批次前先完成 self-fix 修复；下一批次审查的是修复后的最新状态，而非原始状态。修复后执行 `git add` 暂存，**不自动 commit**（见 `audit-common §提交协议`）。

### 跨批记忆格式

每批完成后在记忆文件追加批次摘要：

```markdown
📦 批次进度：
- 批次 N/M：[维度列表] — ✅ 完成
- 发现：🔴 X 个 / 🟡 Y 个 / 💡 Z 个
- 下批计划：[维度列表]
```
