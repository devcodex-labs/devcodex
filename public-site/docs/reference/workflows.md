# 工作流

DevCodex 从自然语言目标判断工作流。canonical 集合固定为 8 个；`plan` 是阶段或能力，不是第九个工作流。

主工作流各有独立说明页，从这里进入：[工作流总览](/workflows/)。

## 主工作流

| 工作流 | 是否可修改文件 | 用途 |
|--------|----------------|------|
| [`dev`](/workflows/dev) | 是，经过确认边界 | 开发、重构或文档实施 |
| [`fix`](/workflows/fix) | 是，经过问题与修复确认 | 复现、定位并修复缺陷 |
| [`analyze`](/workflows/analyze) | 否 | 返回分析、比较或建议 |
| [`audit`](/workflows/audit) | 否，除非另行进入修复 | 基于证据审查代码、项目或文档 |
| [`resume`](/workflows/resume) | 取决于被恢复任务 | 从文件状态继续既有任务 |
| [`chat`](/workflows/chat) | 否 | 不需要项目执行链的交流 |

## 高级工作流

| 工作流 | 用途 |
|--------|------|
| `self-fix` | 修复 DevCodex 自身治理、规则或流程缺陷 |
| `other` | 请求无法安全归类时的规划兜底 |

`self-fix` 与 `other` 只在 [工作流总览](/workflows/) 作高级说明，没有独立用户页。

工作流决定过程边界；专业知识由 [Skill](/reference/skills) 渐进提供。一个工作流可以组合多个 Skill，但不会因为加载某个 Skill 就擅自改变用户目标。
