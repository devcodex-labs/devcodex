---
applyTo: "**"
priority: 3
workflowAgent: audit
version: "1.0.0"
source: "v4:specs/audit/README.md + specs/audit/*.md"
---

# 审计工作流规则（12-audit）

> 本 Instructions 与 `agents/audit.agent.md` 关联，在 audit 工作流激活时由平台自动注入。

## 核心约束

### 只读约束（绝对）
- **audit 是只读工作流**：执行中禁止修改任何文件
- 发现问题只输出清单和变更建议
- 需要修复时由用户启动 `@self-fix` 或 `@fix`

### 审查目标类型识别
- 基于用户意图智能识别（规则见 `audit-common` Skill §1~§2）
- 不依赖关键词，以用户意图的覆盖范围和收敛期望为准

### 专属维度规范加载优先级
```
租户定制（P3）> Plugin 默认（P5）> 01-common 兜底（P5）
```

### 多轮收敛规则
- 收敛条件：所有维度执行 ≥1 遍，且连续 N 轮无新发现
- N 值：定向审查 = 2 轮，全面体检 = 3 轮（见 `audit-common` Skill）
- 未收敛时自动进入下一轮，不询问用户

### 维度盲区处理
- 遇到无对应维度的问题 → 标注 `[维度盲区]`
- 发现盲区后写入 `data/gap-registry.md`（无盲区跳过）

### 报告规则
- 含 🔴 问题时，建议用户启动 `@self-fix` 工作流
- 每条问题必须附三列验证（合理性 + 可实施性 + 收益）
- 报告头部必须包含：审查目标类型 / 审查范围 / 收敛状态
