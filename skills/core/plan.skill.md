---
id: plan
name: 执行计划 Skill
description: 制定结构化执行计划（N06 节点）。当用户请求不匹配任何已有工作流（other 路由）时，由 plan.agent.md 调用。
version: "1.0.0"
tier: pro
workflow: core
inputs:
  - name: request
    type: string
    description: 用户请求（完整描述）
    required: true
  - name: workflow_hint
    type: string
    description: "可能的工作流重路由建议（如 dev/fix）"
outputs:
  - name: plan
    type: object
    description: "结构化计划：steps[] / risks[] / outputs[]"
  - name: suggestWorkflow
    type: string
    description: 建议切换到的工作流（可选，仅当请求实质上匹配已有工作流时输出）
source: "v4:specs/plan.md（N06 节点）"
---

## 触发场景

| 来源 | 说明 |
|------|------|
| `intent` Skill 结果为 `other` | 不匹配 dev/fix/analyze/audit/self-fix/chat/resume 任何意图 |
| 典型场景 | 文档撰写 · 环境配置 · 项目管理操作 · 跨项目协调 · 规范讨论（非 audit/chat）|

## 执行流程

```
① 分析用户请求 → 理解目标和约束
② 工作流重评估 → 若请求实质上属于 dev/fix/analyze/audit/self-fix，提示用户建议切换（🔴 不强制，用户可拒绝）
③ 制定执行计划 → 输出给用户确认
④ 按计划逐步执行
```

## 执行计划输出格式

```markdown
📋 执行计划

**目标**：[一句话描述]

| # | 步骤 | 产出 | 风险 |
|:-:|------|------|------|
| 1 | [步骤描述] | [预期产出] | [风险/无] |
| 2 | ... | ... | ... |

---
❓ 确认后开始执行。
```

## 约束

- **涉及文件修改** — 遵守 C01（需先输出计划等待确认）
- **无 CP 强制要求** — other 路由不强制 CP1→CP2→CP3，但多步复杂任务时建议分步确认
- **不跳过合规检查** — 执行完成后仍需经过 `compliance` Skill（C05）
- **C12 合理性评估** — 有更好方案先提出并等待确认，明显不合理时先指出问题
