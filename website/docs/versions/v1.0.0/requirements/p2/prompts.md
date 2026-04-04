# 需求：prompts/ + hooks/ + data/ + auth/ + commercial/

**状态**：⬜ 待开发  
**优先级**：P3  
**参考**：`v0.03/`

## prompts/

CP 流程交互模板，均以**英文**编写：

| 文件 | 使用场景 |
|------|---------|
| `requirement.prompt.md` | dev CP1 需求确认 |
| `technical-design.prompt.md` | dev CP2 方案确认 |
| `implementation-plan.prompt.md` | dev CP3 实施计划 |
| `problem-analysis.prompt.md` | fix CP1 问题分析 |
| `report-analysis.prompt.md` | analyze 报告模板 |
| `reply-summary.prompt.md` | 多任务进度快照格式 |

## hooks/

| 文件 | 触发时机 |
|------|---------|
| `pre-message.hook.md` | 每条消息前 |
| `post-session.hook.md` | 会话结束后 |

## data/

运行时数据文件（不发布到 npm）：

| 文件 | 内容 |
|------|------|
| `violations.md` | 违规记录（VL-NNN 格式）|
| `pending-fixes.md` | Pending 级自修复待办 |
| `gap-registry.md` | audit 维度盲区登记 |

## auth/

Token 验证相关，对接 `auth.devcodex.dev`，详细需求待 v1.1.0 规划。

## commercial/

商业化相关文件，详细需求待规划。
