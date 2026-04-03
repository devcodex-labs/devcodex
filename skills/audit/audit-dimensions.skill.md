---
id: audit-dimensions
name: Audit Dimensions
description: D1~D20 规范文件审查维度总览 — 规范库/specs 文件专属审查层
version: 1.0.0
tier: free
workflow: audit
source: specs/audit/dimensions.md
---

# Audit Dimensions Skill

## 适用范围

审查目标为**规范文件**（specs/*.md、instructions/*.md、RULES.md 等 AI 指导文档）时加载本 Skill。

## 维度总览（D1~D20）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 结构规范 | D1 文件结构 · D2 NODE_META/frontmatter 规范 · D3 流程图语法 | 🔴 |
| B — 内容质量 | D4 内容完整性 · D5 跨文件一致性 · D6 示例可执行性 | 🔴/🟡 |
| C — 可维护性 | D7 职责边界 · D8 版本标注 · D9 引用准确性 | 🟡 |
| D — AI 执行性 | D10 指令明确性 · D11 冲突检测 · D12 路由正确性 | 🔴 |
| E — 可扩展性 | D13 扩展点标注 · D14 租户覆盖支持 · D15 向后兼容 | 💡 |
| F — 维度体系 | D16 维度编号唯一 · D17 优先级标注 · D18 AI-first 设计 | 🔴/🟡 |
| G — 运维 | D19 废弃说明 · D20 变更历史 | 💡 |

## 执行优先级分批

| 批次 | 维度 | 说明 |
|------|------|------|
| 🔴 第一批 | D1·D2·D3·D4·D5·D7·D9·D10·D11·D12·D16·D17 | 强制，发现问题立即标记 |
| 🟡 第二批 | D6·D8·D18·D19·D20 | 建议，不阻塞 |
| 💡 第三批 | D13·D14·D15 | 改进，按 Token 预算执行 |

## 关键检查（D5 跨文件一致性）

新增子类型 spec 后必须核查三项（L1~L3）：
- L1：`routing.skill.md` 路由表包含该子类型
- L2：`02-output-paths.instructions.md` 注册该子类型目录
- L3：对应 report 模板的子类型字段包含该子类型
