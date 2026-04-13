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

## Pending Fix #PF-001
- 文件：`instructions/10-dev.instructions.md` §C12 合理性评估
- 问题：C12 当前只覆盖两种触发场景（"有更好方案"和"用户引用已有设计"），缺少第三种场景：**需求项所依赖的上层能力在项目中尚未实现**。实际案例：dev 工作流 CP1 阶段将"为 devOverlay 增加 skipPaths"列入需求（R5），但 vext 当前是纯 API 框架、无前端渲染能力，overlay 的扩展前提根本不存在。AI 未能在 CP1 前主动识别并标记，需用户提示后才修正。
- 建议修复：在 C12 条目中补充第三条检查——"架构边界检查：逐项确认每条需求是否依赖项目当前已实现的能力；若某项需求的前提能力（上游功能/平台特性）尚未存在，须在 CP1 前主动标注为'预留候选'并建议移出本期范围，等待用户确认后再决定取舍"
- 发现时间：2026-04-12
- 状态：已关闭（2026-04-13，已补写至 `10-dev.instructions.md` §C12）

## Pending Fix #PF-002
- 文件：`instructions/10-dev.instructions.md` §plan-review PR-2 技术可行性
- 问题：PR-2 只检查"无模糊待定步骤"，缺少对已有代码改动的执行路径追踪要求。实际案例：技术方案将日志逻辑设计在 devOverlay 判断之后，但 devOverlay 块有提前 return（error-handler.ts:107），导致设计的日志在 browser 访问场景下永远不被执行。该问题在 plan-review 阶段应被 PR-2 拦截，但因规则表述不足而漏过，直到 audit 才发现。
- 建议修复：在 PR-2 检查项中补充——"对已有代码的改动方案，必须逐行追踪新代码在原始执行路径中的实际插入位置，验证新逻辑不会被已有的提前 return/throw/break 跳过"
- 发现时间：2026-04-13
- 状态：已关闭（2026-04-13，已补写至 `10-dev.instructions.md` §PR-2 + `skills/dev-plan-review/SKILL.md` §PR-2）

