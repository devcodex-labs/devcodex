---
applyTo: "**"
description: 意图识别、Intent Expansion Card、上下文重建与可见回复证据的通用规范
priority: P5
version: 1.11.28
---
# 意图扩展与上下文重建

> 本文件是 `01-common` 的分拆视图，承载意图识别、Intent Expansion Card、用户可见摘要、Context Rehydration Contract、ContextHandoffCard 与 Stop 可见回复证据三态。

## 术语约定

| 术语 | 含义 |
|------|------|
| **工作流** | 路由级完整执行路径（dev/fix/analyze/audit/self-fix/resume/plan/chat）|
| **流程** | 步骤级执行序列（某个功能的具体操作步骤）|
| **约束** | C01~C22 编号的强制/执行规则 |
| **规则** | 更宽泛的执行规定（含约束、建议、说明等）|

## 意图识别（三问法）

### 前置识别（优先于三问）

| 检查 | 条件 | 意图 |
|------|------|------|
| 恢复中断？ | 用户说"继续"/"恢复"，且今日/昨日任务文件中存在状态为 🔄 的会话 | `resume` → 跳过三问 |
| 纯问答？ | 仅提问/求解释，无文件变更意图 | `chat` → 跳过三问 |

### 三问判断

| 问题 | 指向变更 | 指向分析 |
|------|---------|---------|
| Q1：最终目的是变更还是结论？ | 变更 | 结论 |
| Q2：分析是手段还是目的？ | 手段 | 目的 |
| Q3：是否需要修改/创建/删除文件？ | 是 | 否 |

- 任一指向变更 → `dev` 或 `fix`（或 `self-fix`）
- 三问全指向分析 → `analyze` vs `audit`

### 意图路由表

| 意图 | 工作流 |
|------|--------|
| `dev` | 开发（8 子类型）|
| `fix` | 修复（3 子类型）|
| `analyze` | 分析（多轮收敛，≥3 轮）|
| `audit` | 审计（多轮收敛，≥3 轮）|
| `self-fix` | 规范自修复 |
| `resume` | 恢复中断任务 |
| `other` | 规划（兜底）|
| `chat` | 问答（快速路径）|

## Intent Expansion Card

非 chat 工作流在 CP1 / 问题确认前必须形成可审查的 Intent Expansion Card，作为 PC1/PC3、CP1 产物、压缩恢复与错路由复盘的共同锚点。

| 字段 | 说明 |
|------|------|
| `semantic` | 用户字面语义初判 |
| `project` | 目标项目与 active-root |
| `continuity` | 是否延续现有 requirement/bug/session |
| `action` | 最终工作流与子类型 |
| `domain` | 受影响模块/领域 |
| `artifact-impact` | 影响源码、配置、规范、报告、记忆、部署体等哪类产物 |
| `risk` | destructive / security / high-risk / normal |
| `host-capability` | 是否涉及宿主能力差异及降级边界 |
| `validation-route` | lint/test/typecheck/validate/direct replay/官方文档等验证路线 |
| `confidence` | high / medium / low，并说明不确定点 |
| `alternatives` | 被排除路线及原因 |

## 用户可见意图扩展摘要

- dev 模式默认应向用户展示完整 Intent Expansion Card。
- prod、instruction-fallback 宿主或低风险轻任务可退化为 3~5 行用户可见意图扩展摘要。
- 摘要只写：语义初判、项目现实扩展后路由、关键风险、验证路线、备选路径；禁止输出调试 JSON 或完整内部状态。
- 无论用户面是否退化，CP1 / 问题确认产物中都必须保留完整 Intent Expansion Card。

## Context Rehydration Contract

压缩恢复、resume、summary 恢复，或用户明确要求“按文件真相重建”时，必须按以下优先级重建上下文：

1. 当前用户消息
2. 已确认需求/bug 产物
3. 当前任务 `sessions.md`
4. 当日 `tasks/YYYYMMDD.md`
5. Agent `SUMMARY.md`
6. compaction / summary 摘要
7. AI 当前推断

约束：

- 摘要只能作导航提示，不能覆盖文件真相源。
- 若文件态与当前推断冲突，必须以文件态为准并重建 Intent Expansion Card。
- 若执行中新增范围触达 CP3 条件（≥5 文件、高风险、控制面联动），必须暂停执行并回到对应 CP3。

## ContextHandoffCard（上下文传递/交接）

`ContextHandoffCard` 是交接方在跨会话、跨 Agent、多批次、summary/compact 前、用户明确要求“传递上下文”或即将中断时产出的最小交接卡；`Context Rehydration Contract` 是恢复方消费该交接卡后重新核对文件真相源的规则。二者关系是“handoff 产出，rehydration 消费”，禁止用 handoff 覆盖已确认产物、sessions、tasks 或 SUMMARY。

| 字段 | 说明 |
|------|------|
| `source-of-truth` | 本轮事实源文件、台账、报告、需求/bug 产物 |
| `confirmed-decisions` | 已确认决策、CP 状态、auto 授权或用户选择 |
| `open-risks` | 剩余风险、待验证假设、黄色偏离边界 |
| `next-action` | 下一步建议动作、验证命令或恢复入口 |
| `blocked-reason` | 若阻塞，写明阻塞条件与需要的外部输入 |
| `must-not-overwrite` | 不得覆盖的用户变更、dirty 边界、不可删除项 |
| `validation-state` | 已执行验证、失败验证、待验证项与证据路径 |
| `artifact-links` | 报告、记忆、关键产物的 ArtifactLinkSet 或 copy fallback |

触发后必须写入报告或 daily tasks；若任务仍未完成，SUMMARY 只能保留索引状态，不得把 ContextHandoffCard 写成自由文本段落。

## Stop 可见回复证据三态

Hook closure 对入口检查块的判断必须区分三态：

| 状态 | 含义 | 行为 |
|------|------|------|
| `verified-present` | 已解析最终 assistant 可见回复，且包含 PC0~PC7 | 不提醒入口块 |
| `verified-missing` | 已解析最终 assistant 可见回复，但缺 PC0~PC7 | 提醒或 strict 阻断 `entry check block 未输出` |
| `unverified` | Stop/PreCompact 未提供可解析 assistant 内容 | 提醒“无法验证最终用户可见回复”，附 payload capture 指引；不得断言“未输出” |
