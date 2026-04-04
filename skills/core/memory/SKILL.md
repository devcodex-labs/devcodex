---
name: 记忆读写 Skill
description: 管理会话记忆的读取与写入。三层记忆体系：Agent 日记 / 需求记忆 / 项目总记忆。
---
## 文件路径

```
<项目根>/.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

- `<agent>` 命名：产品标识优先，全小写，连字符分隔（`copilot` / `cursor` / `vscode-copilot`）
- 无法确定时使用 `unknown-agent`（后续迁移到正确目录）
- ⛔ **禁止使用 glob/find 扫描 `.memory/` 目录**（隐藏目录会被跳过）
- 必须使用目录列出工具逐层进入：`clients/` → `<agent>/` → 读取日期文件

## 读取策略

| 场景 | 读取范围 |
|------|---------|
| 正常会话 | 今日文件 + 昨日文件（并发读取，路径已知无依赖） |
| 今日文件不存在 | 仅读昨日文件 |
| 文件存在但解析失败 | 重命名为 `YYYYMMDD.bak.md`，创建新文件，不阻断 |
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
| 报告写入后 | 追加报告路径到 📄 关联报告 |
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
| 📨 对话记录 | 四列表格：`轮次 \| 👤 用户消息 \| 🤖 AI执行 \| 状态` |

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
<项目根>/.devcodex/.memory/clients/<agent>/SUMMARY.md
```
- 每次会话结束前（SC6 检查）追加一行索引
- 模板：`prompts/agent-summary.prompt.md`

**文件格式**（首次创建时用此表头，之后只追加行）：

```markdown
# Agent SUMMARY — [agent-id]

> 项目：[项目名]

| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |
|------|:----:|------|------|---------|---------|:----:|
| YYYY-MM-DD | NN | dev/fix/... | [50~100字摘要，含关键数字/结果] | [NN--简述.md](file:///路径) | [YYYYMMDD.md §NN](file:///路径) | ✅/🔄 |
```

**字段规则**：
- 类型：工作流意图，多任务用 `+` 连接（如 `fix+audit`）
- 摘要：一行 50~100 字，包含做了什么 + 关键数字/结果
- 多任务会话：一行覆盖全部任务，不拆多行
- 排序：按时间正序追加（最新在最后）

### 全局 SUMMARY（项目共用）
```
<项目根>/.devcodex/.memory/SUMMARY.md
```
- 仅记录关键决策（规范变更/架构决策/P0修复）
- SC7 检查时追加，纯 chat/无重要决策时 N/A

## 三层记忆职责

| 层级 | 文件 | 写入频率 |
|------|------|---------|
| Agent 日记 | `.memory/clients/<agent>/tasks/YYYYMMDD.md` | 每会话必写 |
| 需求记忆 | `<需求>/.memory/sessions.md` | 路由确定后追加 |
| 项目总记忆 | `.memory/SUMMARY.md` | 有关键决策时 |

### 需求级记忆路径构建

```
<项目根>/.devcodex/requirements/<中文描述>/.memory/sessions.md   # dev 需求
<项目根>/.devcodex/bugs/<中文描述>/.memory/sessions.md           # fix Bug
<项目根>/.devcodex/optimizations/<中文描述>/.memory/sessions.md  # dev 优化
```

`<中文描述>` 与 `02-output-paths.instructions.md` 中的任务目录名一致。

## 模板引用

| 产出物 | 模板 |
|--------|------|
| 记忆日文件 | `prompts/memory-session.prompt.md` |
| Agent SUMMARY | `prompts/agent-summary.prompt.md` |
| 需求级记忆 | `prompts/requirement-session.prompt.md` |
