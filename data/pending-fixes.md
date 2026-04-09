# Pending Fixes

> **文件路径**: `data/pending-fixes.md`  
> **写入时机**: [`14-self-fix.instructions.md`](../instructions/14-self-fix.instructions.md) 中 Pending 级（超出 A1~A5 白名单范围）问题写入  
> **处理时机**: 由用户选择时机，通过 self-fix 工作流批量处理  
> **关联规范**: [`14-self-fix.instructions.md`](../instructions/14-self-fix.instructions.md)

## 格式规范

每条修复项使用以下格式追加（禁止修改已有未关闭条目）：

```markdown
## Pending Fix #PF-NNN
- 文件：<路径>
- 问题：<描述>
- 建议修复：<方案>
- 发现时间：YYYY-MM-DD
- 状态：待处理 / 处理中 / 已关闭
```

### 状态流转

`待处理` → `处理中` → `已关闭`

关闭三条件（全部满足才可标 `已关闭`）：
1. 问题处置完成
2. 防复发措施写入对应规范
3. 后续流程验证生效（或用户明确确认）

---

## 待处理项

<!-- 以下由 self-fix 工作流自动追加，禁止手动修改未关闭条目 -->

