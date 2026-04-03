---
id: memory
name: 记忆读写 Skill
description: 管理会话记忆的读取（N03）和写入（N02）。三层记忆体系：Agent 日记 / 需求记忆 / 项目总记忆。
version: "1.0.0"
tier: pro
workflow: core
inputs:
  - name: action
    type: enum
    values: [read, write, append]
    required: true
  - name: project
    type: string
    description: 项目名称（path 组件）
    required: true
  - name: agent
    type: string
    description: AI 客户端标识（如 copilot/cursor/vscode-copilot）
    required: true
  - name: intent
    type: string
    description: 意图类型（read 时用于确定读取范围）
    default: normal
outputs:
  - name: sessions
    type: array
    description: 读取时返回的会话段落列表
source: "v4:specs/memory.md + specs/summary.md"
---

## 文件路径

```
<工作区>/projects/<project>/.ai-memory/clients/<agent>/tasks/YYYYMMDD.md
```

- `<agent>` 命名：产品标识优先，全小写，连字符分隔（`copilot` / `cursor` / `vscode-copilot`）
- 无法确定时使用 `unknown-agent`（后续迁移到正确目录）
- ⛔ **禁止使用 glob/find 扫描 `.ai-memory/` 目录**（隐藏目录会被跳过）
- 必须使用目录列出工具逐层进入：`clients/` → `<agent>/` → 读取日期文件

## 读取策略

| 场景 | 读取范围 |
|------|---------|
| 正常会话 | 今日文件 + 昨日文件（并发读取，路径已知无依赖） |
| 今日文件不存在 | 仅读昨日文件 |
| intent = resume | tasks/ 目录最近 **14 天**文件 |
| 用户明确要求历史回溯 | 同 resume |

> ⛔ 禁止默认读取超过昨日以前的文件

## 写入规则

| 时机 | 动作 |
|------|------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮交互 | 追加对话记录 |
| 子任务完成（多任务） | 追加 `T{N}进度：✅` |
| 超 13 轮预警（C08） | 写编码检查点到当前段落 |
| 报告写入后（N12） | 追加报告路径到 📄 关联报告 |
| 任务结束 | 状态更新为 ✅ |

**约束**：
- 🔴 **禁止询问用户"是否需要写入记忆"**（C05/S05 自动写入）
- 追加段落时使用增量编辑，禁止覆盖已有内容（C06/S04）
- 禁止使用 `Set-Content` 等命令修改 .md 文件（C09）

## 会话段落字段

### 必填

| 字段 | 说明 |
|------|------|
| 🎯 任务摘要 | 本次任务的核心目标和意图 |
| 📨 对话记录 | 三列表格：轮次 \| 方向 \| 摘要 |

### 按需（有内容时写入）

| 字段 | 说明 |
|------|------|
| 📄 关联报告 | 报告文件路径表格（含链接） |
| 💡 关键决策 | 本次会话中产生的重要决策 |
| ⚠️ 待跟进 | 未完成事项或下次需要继续的内容 |
| 📦 编码检查点 | 编码任务且变更 ≥3 文件时 |

## 格式选择

| 场景 | 格式 |
|------|:----:|
| chat / 简单 analyze | 紧凑 |
| audit（多轮） | 紧凑 |
| dev/fix（≤2 文件变更） | 紧凑 |
| dev/fix（≥3 文件变更）| 完整 |
| 多任务会话（≥3 任务） | 完整 |

> 可从紧凑升级为完整（追加缺失字段），无需重写已有内容。

## SUMMARY 文件

### Agent SUMMARY（每 Agent 独立）
```
<工作区>/projects/<project>/.ai-memory/clients/<agent>/SUMMARY.md
```
- 每次会话结束前（SC6 检查）追加一行索引
- 模板：`prompts/agent-summary.prompt.md`

### 全局 SUMMARY（项目共用）
```
<工作区>/projects/<project>/.ai-memory/SUMMARY.md
```
- 仅记录关键决策（规范变更/架构决策/P0修复）
- SC7 检查时追加，纯 chat/无重要决策时 N/A

## 三层记忆职责

| 层级 | 文件 | 写入频率 |
|------|------|---------|
| Agent 日记 | `.ai-memory/clients/<agent>/tasks/YYYYMMDD.md` | 每会话必写 |
| 需求记忆 | `<需求>/.ai-memory/sessions.md` | 路由确定后追加 |
| 项目总记忆 | `.ai-memory/SUMMARY.md` | 有关键决策时 |

## 模板引用

| 产出物 | 模板 |
|--------|------|
| 记忆日文件 | `prompts/memory-session.prompt.md` |
| Agent SUMMARY | `prompts/agent-summary.prompt.md` |
| 需求级记忆 | `prompts/requirement-session.prompt.md` |
