# Pending Issues（问题池）

> **文件路径**: `data/pending-issues.md`
> **用途**: 记录已确认、但**不阻断当前任务**的规范优化、流程补强、模板体验或工作区协作改进项，供后续按批次统一修复。
> **区别**:
> - `data/pending-fixes.md`：运行时 PF 缺口台账
> - `data/process-improvements.md`：已确认采纳的更优执行策略
> - `data/pending-issues.md`：尚未进入实施、但已明确需要后续处理的问题池

## 使用规则

1. 非阻断项默认写入本文件，不在当前主任务中途穿插修复。
2. 每条问题应至少包含：标题、发现时间、影响范围、建议动作、状态。
3. 问题进入正式需求或 bug 修复流程后，应补充关联目录或报告路径，并在关闭时注明收口批次。

---

## 当前状态

- 当前已有 2 条已登记的非阻断问题池条目。

## 登记表

| 编号 | 标题 | 发现时间 | 影响范围 | 建议动作 | 状态 |
|------|------|-----------|----------|----------|:----:|
| ISSUE-001 | 单源 instructions.md 仍混入 Claude 专属路径与工具语义 | 2026-05-26 | instructions.md、index.js init/update、Copilot 端 .github/copilot-instructions.md | 将单源正文改为平台中性表达，或在复制阶段按目标平台注入专属尾注/章节，并补跨端语义校验 | 🔄 |
| ISSUE-002 | audit-state 历史 paused 会话会保留过时 open findings 并继续进入 resume 候选集 | 2026-05-26 | .audit-state/*.json、skills/audit-session/SKILL.md、scripts/validate.js V15 | 为 audit-state 增加 superseded/过时检测与收口策略，并在 resume 选择和 V15 中排除或告警陈旧 paused 会话 | 🔄 |
