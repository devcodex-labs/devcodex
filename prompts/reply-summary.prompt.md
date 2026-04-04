---
mode: agent
description: 回复摘要模板，用于 chat 工作流记录简短会话摘要
applyTo: projects/**/.ai-memory/**
---
# 回复摘要模板

> **路径**: `projects/<project>/.ai-memory/clients/<agent>/chat/YYYYMMDD.md`
> **触发**: chat 意图工作流结束后，由 `memory.skill.md` 写入（轻量记录）

---

```markdown
# Chat 记录 — YYYY-MM-DD

## HH:MM — [问题摘要]

**问题**：[用户问题一句话摘要]  
**回复要点**：[回答的关键信息，1~3条]  
**相关文件/资源**：[若有引用]

---

## HH:MM — [问题摘要]

...
```

## 写入规则

- chat 记录追加写入到当天文件（同一天多次 chat 追加段落）
- 不需要详细上下文（chat 豁免完整记忆）
- 保留 7 天（超过 7 天的 chat 记录自动清理）
- 不包含：代码实现细节、文件变更记录（这些在 memory-session 中）
