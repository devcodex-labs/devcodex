# 工作流总览

DevCodex 用工作流划定过程边界：会不会改文件、要不要确认、怎样算完成。

主工作流：

- [`dev`](/workflows/dev) — 开发、重构或文档实施，改文件前要确认
- [`fix`](/workflows/fix) — 复现、定位并修复，改文件前要确认
- [`analyze`](/workflows/analyze) — 只读分析
- [`audit`](/workflows/audit) — 基于证据审查，默认不改文件
- [`resume`](/workflows/resume) — 从文件状态续接，权限继承原任务
- [`chat`](/workflows/chat) — 不走项目执行链的交流

## 高级说明

`self-fix` 只用于修复 DevCodex 自身治理、规则或流程，不是业务项目的默认入口。  
`other` 是无法安全归类时的规划兜底，不会因此获得改文件权限。

`plan` 是阶段或能力，不是第九个工作流。

旧地址 [参考：工作流](/reference/workflows) 仍可用，作为本页的短索引。
