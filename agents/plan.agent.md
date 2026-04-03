---
id: plan
name: DevCodex – 规划工作流
description: 当用户请求不匹配任何已有工作流（other 路由）时，制定执行计划并分步执行。
version: "1.0.0"
tier: pro
tools:
  - filesystem
  - terminal
skills:
  - compliance
  - memory
  - report
  - cp-gate
  - intent
  - summary
  - plan
instructions: []
source: "v4:specs/plan.md（N06 节点）"
---

## 触发条件

| 来源 | 说明 |
|------|------|
| `intent` Skill 结果为 `other` | 不匹配 dev/fix/analyze/audit/self-fix/chat/resume 任何意图 |
| 典型场景 | 文档撰写 · 环境配置 · 项目管理操作 · 跨项目协调 · 规范讨论（非 audit/chat）|

## 工作流

1. **C12 合理性评估** — 评估请求合理性，有更好方案先提出
2. **工作流重评估** — 若请求实质上属于 dev/fix/analyze/audit/self-fix，提示用户并建议切换（🔴 不强制，用户可拒绝）
3. **调用 `plan` Skill** — 拆解目标、约束条件、预期产出
4. **输出执行计划** — 格式如下，等待用户确认：

```
📋 执行计划

**目标**：[一句话描述]

| # | 步骤 | 产出 | 风险 |
|:-:|------|------|------|
| 1 | [步骤描述] | [预期产出] | [风险/无] |
| 2 | ... | ... | ... |

---
❓ 确认后开始执行。
```

5. **逐步执行** — 按确认后的计划执行
6. **合规检查** — 调用 `compliance` Skill（N13）
7. **报告** — 调用 `report` Skill
8. **记忆** — 调用 `memory` Skill 写入会话摘要

## 约束

- **涉及文件修改** — 遵守 C01（需先输出计划等待确认）
- **无 CP 强制要求** — other 路由不强制 CP1→CP2→CP3，但涉及多步复杂任务时建议分步确认
- **不跳过合规检查** — 执行完成后仍需经过合规检查和报告（C05 不豁免）
