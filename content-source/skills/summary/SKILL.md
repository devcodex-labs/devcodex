---
name: summary
description: 写入会话摘要到记忆日文件。区别于 memory Skill（会话记录读写）。任务结束前与 memory Skill 配合完成记忆持久化。
---
## 写入流程

<!-- devcodex:include shared/memory/active-root-layout.md -->

| 步骤 | 动作 |
|:----:|------|
| 1 | 确定日期（`YYYYMMDD`） |
| 2 | 定位文件：`<active-root>/.memory/clients/<agent>/tasks/YYYYMMDD.md` |
| 3 | 判断文件状态（不存在→创建；已存在→追加）|
| 4 | 确定会话编号（`## 会话 01` 起递增，两位数，按文件内容确定）|
| 5 | 写入初始段落（时间 + 意图 + 状态 🔄 + 摘要占位）|
| 6 | 后续更新（持续追加对话记录/报告路径/决策）|

## 格式选择

| 场景 | 格式 |
|------|:----:|
| chat / 简单 analyze | 紧凑 |
| audit（多轮） | 紧凑 |
| dev/fix（≤2 文件变更） | 紧凑 |
| dev/fix（≥3 文件变更） | 完整 |
| 多任务会话（≥3 任务） | 完整 |

> 首次写入可用紧凑格式，复杂度超出后升级（追加缺失字段，不重写已有内容）

## 会话字段

### 必填

| 字段 | 说明 |
|------|------|
| 🎯 任务摘要 | 本次任务的核心目标和意图 |
| 状态 | 🔄 进行中 / ✅ 已完成（单独成行，供 resume 检测使用） |
| 📨 对话记录 | 四列表格：`轮次 | 👤 用户消息 | 🤖 AI执行 | 状态`（[FC1](../compliance/SKILL.md) 检查） |

### 按需（有内容时写入）

| 字段 | 说明 |
|------|------|
| 📄 关联报告 | 报告文件路径表格（含链接） |
| 💡 关键决策 | 本次会话中产生的重要决策 |
| ⚠️ 待跟进 | 未完成事项或下次需要继续的内容 |
| 📦 编码检查点 | 编码任务且变更 ≥3 文件时 |
| 🧭 HostCapabilityRoutingRef | 命中时只记录 `instructionRefId / decisionId / authority / digestStrength / portableDecision / nativeStatus / fallbackReason`，不复制原文或 catalog |

## Token 防护写入

> 配合 [`01-common.instructions.md`](../../instructions/01-common.instructions.md) C08 约束。

| C08 阶段 | 动作 |
|---------|------|
| 🟡 关注区（>10 轮） | 在摘要中记录当前轮次 |
| 🟡 预警（>13 轮） | 写入编码检查点（📦 字段）|
| 🔴 防护（>15 轮） | 立即写入完整记忆（所有字段填充到最新状态）|
| 🔴 硬性暂停（≥15 轮 + ≥5 文件）| 必须先完成记忆持久化再继续 |

## 约束

- 🔴 **禁止询问用户"是否需要写入记忆"**（[C05/S05](../../instructions/00-safety.instructions.md) 强制自动写入）
- 使用增量编辑追加，禁止覆盖已有内容（[C06/S04](../../instructions/00-safety.instructions.md)）
- 禁止使用 PowerShell `Set-Content` 等终端命令修改 .md 文件（[C09](../../instructions/01-common.instructions.md)）
- `HostCapabilityRoutingRef` 只进入 daily/需求级记忆；Agent `SUMMARY.md` 仍是纯索引。compat/none 或 readback 未验证的 instruction authority 不得被摘要升级为跨轮 mutation 授权。

## 模板引用

| 产出物 | 模板 |
|--------|------|
| 会话段落（紧凑/完整） | `prompts/memory-session.prompt.md` |
