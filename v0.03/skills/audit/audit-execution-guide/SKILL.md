---
name: Audit Execution Guide
description: 审查执行指南 — 维度优先级分批、定向审查子集、联动检查清单
---
# Audit Execution Guide Skill

## 职责

本 Skill 定义 audit 工作流的执行策略，补充 `audit-common/SKILL.md` 的收敛规则，提供：定向触发子集、新增子类型联动检查、数值引用联动协议。

## 维度优先级分批

| 批次 | 维度 | 说明 |
|------|------|------|
| 🔴 第一批 | D1·D2·D3·D4·D5·D7·D9·D10·D11·D12·D16·D17 | 强制，立即标记 |
| 🟡 第二批 | D6·D8·D18·D19·D20 | 建议，不阻塞 |
| 💡 第三批 | D13·D14·D15 | 改进，Token 允许时执行 |

## 事件驱动定向审查

| 触发场景 | 推荐专属维度 |
|---------|------------|
| 修改了 RULES.md | D2·D3·D5·D9·D17 |
| 修改了 01-common.instructions.md | D2·D5·D6·D7·D10 |
| 修改了 workflow README | D3·D5·D8·D9 |
| 新增 spec 文件 | D1·D5·D9·D15·D17·D18 |
| 新增子类型 spec | D5(#6)·D9·D15 — 联动 L1/L2/L3 |
| 新增维度/约束编号 | D5·D15·D18 + 数值引用联动 |

## 新增子类型联动检查（L1~L3）⚠️

每次新增子类型 Skill 后**必须核查**：

| # | 检查项 | 对应文件 |
|:-:|--------|---------|
| L1 | `routing/SKILL.md` 路由表包含该子类型行 | `skills/routing/routing/SKILL.md` |
| L2 | `02-output-paths.instructions.md` 注册该子类型目录 | `instructions/02-output-paths.instructions.md` |
| L3 | 对应 workflow report 模板的子类型字段包含该子类型 | `prompts/report-*.prompt.md` |

> ⚠️ 历史教训：session13 新建 scenario-test.md 后三处未同步，session07 才发现。

## 数值引用联动

新增维度编号（D/C/TD/PE/RQ/RA/DA）后，同步更新：
- 对应维度总览表（维度列表文件）
- 执行指南优先级分批表（本文件）
- 交叉引用的 spec 文件中的编号引用
