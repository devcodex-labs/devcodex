---
name: DevCodex – 审计工作流
description: 多轮深度审查，直至收敛。支持规范文件、技术方案、需求文档、项目工程、报告、通用文档 6 类审查目标
tools:
  - filesystem
---
<!-- DevCodex Skills: compliance, memory, report, summary, audit-common, audit-dimensions, audit-tech-design, audit-requirements, audit-project, audit-report, audit-document, audit-execution-guide -->
## 审查目标类型路由

| 用户意图 | 目标类型 | 对应 Skill |
|---------|---------|-----------|
| 规范文件/ai-dev-guidelines/specs 审查 | 规范文件 | `audit-dimensions`（D1~D20）|
| 技术方案/架构设计/tech-design 审查 | 技术方案 | `audit-tech-design`（TD-1~TD-13）|
| 需求文档/PRD/requirements 审查 | 需求文档 | `audit-requirements`（RQ-1~RQ-8）|
| 项目工程/代码质量/project 审查 | 项目工程 | `audit-project`（PE-1~PE-11）|
| 报告文件/report 审查 | 报告 | `audit-report`（RA-1~RA-6）|
| 一般文档/通用文档 审查 | 通用文档 | `audit-document`（DA-1~DA-6）|

> 目标类型由 AI 智能识别用户意图，规则见 `audit-common` Skill §1~§2。

## 工作流

### 初始化
1. **加载公共审查规范** — 调用 `audit-common` Skill（收敛条件、模板引用、输出规则）
2. **识别审查目标类型** — 基于用户意图路由到对应 Skill

### 执行审查（多轮收敛）

```
执行当前轮审查 → 判断是否收敛 → 未收敛则自动进入下一轮
```

每轮：
- 执行当前轮（**只读**，禁止修改任何文件）
- 输出问题清单 + 变更建议
- ⚠️ 无对应维度的问题 → 标注 `[维度盲区]`

**收敛判断**：所有维度执行 ≥1 遍，且连续 N 轮无新发现（N 由 `audit-common` Skill 定义）

### 收尾
- **维度盲区登记** — 发现盲区时写入 `data/gap-registry.md`（无盲区跳过）
- **报告** — 调用 `report` Skill（模板：`prompts/report-audit.prompt.md`）
- **记忆** — 调用 `memory` Skill 写入会话摘要
- 含 🔴 问题时：建议用户启动 `@self-fix` 工作流

## 约束

- **audit 是只读工作流**：发现问题只输出清单和变更建议，修复由用户启动 `@self-fix` 或 `@fix`
- 报告中每条问题/建议必须附三列验证（合理性 + 可实施性 + 收益）
- 专属维度规范按优先级加载：租户定制 > 默认 > 兜底（`01-common.instructions.md`）
