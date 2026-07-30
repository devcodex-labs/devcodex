---
agent: agent
description: 记忆会话文档模板，用于写入每次会话的结构化记忆
applyTo: .devcodex/**/.memory/**
---
# 记忆会话模板

> **路径**: `.devcodex/**/.memory/clients/<agent>/tasks/YYYYMMDD.md`
> **触发**: 收到首条用户消息时创建/追加状态 🔄 的会话段落；任务结束时更新为 ✅

---

## 格式定义

每天一个文件，文件内以 `## 会话 NN` 分段。每个会话段落包含：

### 必填字段

```markdown
## 会话 NN

- **时间**：YYYY-MM-DD
- **意图**：dev / fix / analyze / audit / self-fix / chat
- **状态**：🔄 / ✅

### 🎯 任务摘要

本次会话完成的核心工作（2~5句话）。

### 📨 对话记录

| 轮次 | 👤 用户消息 | 🤖 AI执行 | 状态 |
|:----:|-----------|----------|:----:|
| 1 | [用户消息摘要] | [AI 执行的关键动作] | ✅ |
```

### 按需字段（有内容时写入）

```markdown
### 📄 关联报告

| 报告 | 路径 |
|------|------|
| [报告名称] | `E:\路径\NN--简述.md` |

### 💡 关键决策

- [决策内容及原因]

### 🧭 HostCapabilityRoutingRef（命中时）

| instructionRefId | decisionId | authority / digestStrength | portableDecision | nativeStatus | fallbackReason |
|------------------|------------|----------------------------|------------------|--------------|----------------|
| | | | | | |

> 只记录 compact identity 和 bounded projection；禁止复制完整用户原文、附件正文或 catalog row。compat/none、conversation-visible 或 readback 未验证 authority 不得被摘要升级为跨轮 mutation 授权。

### ⚠️ 待跟进

| # | 事项 | 优先级 | 状态 |
|---|------|:------:|:----:|
| 1 | [待跟进事项] | 🔴 高 | ⬜ |

### 📦 编码检查点

| 文件 | 变更类型 |
|------|---------|
| `path/to/file` | 新建/修改/删除 |

### 🧾 InternalDeliveryState（发生文件交付时）

| manifestId | session artifactId / visibility | planned=observed=internalDelivered | visible set / semanticDigest |
|------------|---------------------------------|------------------------------------|------------------------------|
| | `internal-only` | verified / failed | |

> session/daily/SUMMARY/task/checkpoint/raw receipt/manifest/ledger 仍进入内部 `ArtifactDeliveryManifestV1` 和 ECR，但默认不进入最终用户文件列表；只有恢复冲突、审计取证、写入失败或用户明确要求时才提升可见性。

### 🔎 ReviewState（正式复审/ECR 触发时）

| planId | snapshotDigest | stage/class | open/blocker/stale/unreviewed | saturation / nextAction |
|--------|----------------|-------------|--------------------------------|-------------------------|
| | | | | |

> 只投影 `ReviewStateSnapshotV1`，禁止在记忆中独立重算状态。

### 🔁 ContextHandoffCard

> 跨会话、跨 Agent、多批次、summary/compact 前或任务即将中断时必填；不触发写 `N/A + skipReason`。

| 字段 | 内容 |
|------|------|
| `source-of-truth` | [当前权威文件/状态源] |
| `confirmed-decisions` | [已确认决策] |
| `open-risks` | [未关闭风险] |
| `next-action` | [唯一下一动作] |
| `blocked-reason` | [阻塞原因或 N/A] |
| `must-not-overwrite` | [不得覆盖的用户变更/真相源] |
| `validation-state` | [已执行、未执行、失败的证据] |
| `artifact-links` | [需求/计划/进度/报告/清单路径] |

### ▶ NewSessionContinuationCard（触发时）

| 字段 | 内容 |
|------|------|
| `targetProject` | [项目命名空间] |
| `taskId` | [已有稳定 UUID；legacy 写 N/A] |
| `displayName` | [任务当前名称] |
| `phaseAndConfirmationState` | [CP 与执行阶段] |
| `sourceOfTruth` | [task.json / sessions / 当前产物] |
| `nextAction` | [唯一下一动作] |
| `copyReadyPrompt` | `继续<displayName>任务` |
```

## 格式选择

| 场景 | 格式 |
|------|:----:|
| chat / 简单 analyze / audit（多轮）| 紧凑（仅 🎯 + 📨） |
| dev/fix（≤2 文件变更）| 紧凑 |
| dev/fix（≥3 文件变更）/ 多任务（≥3）| 完整（全部字段）|

## 写入规则

- 收到首条用户消息时先写入或追加会话段落，禁止只在会话结束时补写
- 首次写入可用紧凑格式，复杂度超出后升级（追加缺失字段，不重写已有内容）
- 📨 四列表格为必填格式，禁止省略
- 状态符号：`🔄` 进行中 · `✅` 已完成
