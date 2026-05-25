---
agent: agent
description: Agent 会话摘要模板，用于生成跨会话 Agent 级别的工作摘要
applyTo: .devcodex/.memory/**
---
# Agent 摘要模板

> **路径**: `.devcodex/.memory/clients/<agent>/SUMMARY.md`
> **触发**: 每次会话结束前追加一行索引（SC6 检查）

---

## 核心格式（必须，首次创建时用此表头，之后只追加行）

```markdown
# Agent SUMMARY — [agent-id]

> 项目：[项目名]

| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |
|------|:----:|------|------|---------|---------|:----:|
| YYYY-MM-DD HH:MM | NN | dev/fix/... | [50~100字摘要，含关键数字/结果] | [NN--简述.md](workspace相对路径/NN--简述.md) | [YYYYMMDD.md §NN](workspace相对路径/YYYYMMDD.md) | ✅/🔄 |
```

### 字段规则

- **类型**：工作流意图，多任务用 `+` 连接（如 `fix+audit`）
- **摘要**：一行 50~100 字，包含做了什么 + 关键数字/结果
- **多任务会话**：一行覆盖全部任务，不拆多行
- **排序**：按时间正序追加（最新在最后）
- **状态字段（v1.9.4+ 延迟写入）**：会话进行中先写 `🔄`；任务完整结束、合规检查全通过、V8 部署同步通过后才改 `✅`。防止 session limit 截断时 SUMMARY 已 ✅ 但 tasks 段落不完整造成数据不一致（参见 [`15-memory §新会话首步强制`](../instructions/15-memory.instructions.md)）。

## SUMMARY 纯索引约束

> 🔴 SUMMARY 是**纯索引文件**，仅包含表头 + 会话索引行，禁止添加其他内容段落。

| ❌ 禁止放入 SUMMARY | ✅ 应写入位置 |
|-------------------|----|
| 项目状态/进度段落（如"当前状态 🔄"） | daily file `🎯 任务摘要` / `⚠️ 待跟进` |
| 关键决策/技术选型 | daily file `💡 关键决策` / 全局 SUMMARY |
| 待处理事项 | daily file `⚠️ 待跟进` |
| 注意事项/踩坑记录 | 项目 profile（`profile/` 目录） |
| 过程改进 | `data/process-improvements.md`（运行时台账；源仓仅保留模板与维护者记录） |

> 原因：SUMMARY 中的自由文本状态段落（如"Phase 12~14 🔄 进行中"）会被 AI 误判为未完成任务标记，干扰 resume 时的任务路由。🔄 状态仅出现在索引表的「状态」列。
