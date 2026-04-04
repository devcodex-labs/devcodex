---
name: Post Session Hook
description: 会话后置钩子 — 写入记忆文件 + 生成报告（替代 v4 的 N02/N12 节点）
applyTo: **
---
# Post Session Hook

## 触发时机

工作流执行完成后（平台 `after_session` 事件），替代 v4 的 N02（写摘要）和 N12（写报告）节点。

## 执行步骤

| 步骤 | 动作 | 豁免条件 |
|------|------|---------|
| M1 写记忆 | 写入 `memory-session.prompt.md` 格式记忆文件 | chat 意图使用 `reply-summary.prompt.md` |
| M2 更新摘要 | 向 `.ai-memory/clients/<agent>/SUMMARY.md` 追加一行索引（`memory.skill.md` §SUMMARY） | — |
| M3 写报告 | 输出对应工作流报告文件 | chat/resume 意图豁免 |
| M4 合规检查 | 执行 `compliance.skill.md` FC→SC→RC 三层验证 | chat/analyze 豁免 RC |

## 记忆写入规则

**路径**：`projects/<project>/.ai-memory/clients/<agent>/tasks/YYYYMMDD.md`

| 意图 | 模板 | 保留策略 |
|------|------|---------|
| dev/fix/audit/analyze | `memory-session.prompt.md` | 14 天 |
| self-fix | `memory-session.prompt.md` | 14 天 |
| chat | `reply-summary.prompt.md` | 7 天 |
| resume | 更新原始会话记忆 | 同原始 |

## 报告写入规则

**路径（需求级，优先）**：`<任务目录>/reports/<agent>/YYYYMMDD/NN--<name>.md`

**路径（项目级，兜底）**：`reports/<子目录>/<agent>/YYYYMMDD/NN--<name>.md`

| 工作流 | 报告模板 |
|--------|---------|
| dev | `report-dev.prompt.md` |
| fix | `report-fix.prompt.md` |
| analyze | `report-analysis.prompt.md` |
| audit | `report-audit.prompt.md` |
| self-fix | `report-fix.prompt.md`（头部标注 `**子类型**: 规范自修复`） |
| chat | 豁免（不写报告） |

## 合规验证（`compliance.skill.md`）

- **FC**（形式合规）：记忆/报告/CP 顺序/路径/行数六项格式检查（FC1~FC6）
- **SC**（实质合规）🔴 阻塞：验证列完整/代码诊断/全局扫描/文档同步/SUMMARY更新等（SC1~SC13）
- **RC**（恢复性检查）非阻塞：记忆上下文充分/产物自洽/恢复线索充足（RC1~RC4）

## 失败处理

| 失败步骤 | 处理 |
|---------|------|
| M1 记忆写入失败 | 记录错误，不阻断，告知用户 |
| M3 报告写入失败 | 在对话中输出报告内容（降级为对话内报告） |
| M4 合规检查发现问题 | 记录违规到 `data/violations.md`，告知用户 |
