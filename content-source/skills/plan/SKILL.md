---
name: plan
description: 制定结构化执行计划。当用户请求不匹配任何已有工作流（other 路由）时，由 devcodex.agent.md 的 plan 兜底路由触发。
---
## 触发场景

| 来源 | 说明 |
|------|------|
| [`intent`](../intent/SKILL.md) Skill 结果为 `other` | 不匹配 dev/fix/analyze/audit/self-fix/chat/resume 任何意图 |
| 典型场景 | 不产生 source mutation 的项目协调、执行顺序规划、选项整理或跨项目只读协调 |

## 执行流程

```text
① 分析用户请求 → 理解目标和约束
② 工作流重评估 → 若请求实质上属于 dev/fix/analyze/audit/self-fix，必须重路由；不能由 other 吞并
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

- **禁止 source mutation** — `workflow-capabilities.json` 将 other 定义为只读规划；明确文档撰写、环境配置或其他文件变更必须路由到 dev/docs、dev/default、fix 或 self-fix
- **无 CP 强制要求** — other 路由不强制 CP1→CP2→CP3，但多步复杂任务时建议分步确认
- **不跳过记忆与报告边界** — C05 要求任务记忆和报告自动写入；合规入口/收尾按 `compliance` Skill 执行
- **[C12](../../instructions/01-common.instructions.md) 合理性评估** — 有更好方案先提出并等待确认，明显不合理时先指出问题
