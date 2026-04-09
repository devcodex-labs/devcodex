# 维度盲区登记表

> **文件路径**: `data/gap-registry.md`  
> **写入时机**: [`12-audit.instructions.md`](../instructions/12-audit.instructions.md) audit 审查中遇到无对应维度的问题时标注 `[维度盲区]` 并追加  
> **关联 Skill**: [`audit-common`](../skills/audit-common/SKILL.md) · [`audit-dimensions`](../skills/audit-dimensions/SKILL.md)  
> **无盲区时**: 跳过，不创建空文件

## 格式规范

每条盲区使用以下格式追加：

```markdown
## Gap #GAP-NNN
- 发现日期：YYYY-MM-DD
- 审查目标：<文件/模块名>
- 盲区描述：<描述>
- 建议维度：<建议新增的维度名>
- 状态：已登记 / 已纳入维度
```

---

## 盲区记录

<!-- 以下由 audit 工作流自动追加 -->

