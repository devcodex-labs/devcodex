---
name: memory
description: 管理会话记忆的读取与写入。三层记忆体系：Agent 日记 / 需求记忆 / 项目总记忆。
---
## 文件路径

```
<项目根>/.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

- `<agent>` 确定规则（优先级从高到低）：
  1. **Profile 显式配置**（优先）：读取 `.devcodex/profile/config.json` 的 `"agent"` 字段
  2. **AI 自行推断**（兜底）：**枚举值固定**，全小写连字符分隔：
     - Copilot in VS Code：`copilot` 或 `vscode-copilot`
     - Claude Code（CLI/桌面端）：`claude-code` ⚠️ 禁止使用裸 `claude`（与 Claude API/Claude.ai 区分）
     - ChatGPT/Codex：`codex`（当前未官方适配，仅占位）
     - Cursor IDE：`cursor`
     - 跨编辑器：`zed-copilot`
     - 无法确定：`unknown-agent`
  3. **写入约定**：`devcodex init --claude` 必须写入 `"agent": "claude-code"`；`devcodex init` (Copilot) 应写入 `"agent": "copilot"`
- ⛔ **禁止使用 shell 命令（bash find、PowerShell glob）查找记忆文件**（shell glob 会跳过隐藏目录）
- 必须使用 IDE 工具（Copilot: list_dir；Claude Code: Read/Glob）逐层进入：`clients/` → `<agent>/` → 读取日期文件

## 读取策略

> 🔴 **读取顺序按意图分叉（正常会话 vs resume）**：
> - **正常会话**：SUMMARY 优先 → 再读今日/昨日任务文件（索引驱动）
> - **resume 意图**：今日任务文件优先 → 再读 SUMMARY 获取宏观上下文（时间驱动）
>
> 原因：SUMMARY 是轻量索引（一行/会话），适合快速定位；但同一天内多个会话的最新意图只存在于任务文件末尾段落，SUMMARY 先读会导致错认旧任务。

| 场景 | 读取范围 | 执行顺序 |
|------|---------|---------|
| **正常会话 · 首步** | Agent SUMMARY.md（快速定位最近状态）| 第一读 |
| 正常会话 | 今日文件 + 昨日文件（路径已知，可并发读取）| 第二读 |
| 今日文件不存在 | 仅读昨日文件 | — |
| 文件存在但解析失败 | 重命名为 `YYYYMMDD.bak.md`，创建新文件，不阻断 | — |
| **intent = resume · 首步** | 今日 `tasks/YYYYMMDD.md`（定位最后一个会话段落，确认真实意图）| **第一读** |
| intent = resume · 次步 | Agent SUMMARY.md（宏观上下文补充）| 第二读 |
| intent = resume · 当前项目无 🔄 | 告知用户最近任务均已完成（引用最后会话摘要），询问是否切换项目或开始新任务；**禁止静默回退旧任务** | — |
| resume 超 14 天 | ① 从 SUMMARY.md 查找最后 🔄 状态行 → ② 提示用户提供具体日期/会话编号 → ③ 精准读取对应日期文件 | — |
| 用户明确要求历史回溯 | 同 resume | — |

> ⛔ 禁止默认读取超过昨日以前的文件
> ⛔ **禁止静默回退**：resume 意图检测到当前项目无 🔄 任务时，禁止静默选取历史旧任务继续；必须明确告知用户当前状态并询问意图。
> ⚠️ **跨项目 resume**：记忆文件是项目级独立管理的。当用户在不同项目间切换后说"继续"，AI 只能读取当前项目的记忆；若当前项目无 🔄，须主动询问是否需要恢复其他项目的工作，而非猜测。

## 写入规则

| 时机 | 动作 |
|------|------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮交互 | 追加对话记录到 📨 字段 |
| 子任务完成（多任务） | 追加 `T{N}进度：✅` |
| 超 13 轮预警（[C08](../../instructions/01-common.instructions.md)） | 写编码检查点到当前段落 |
| 报告写入后 | 追加报告路径到 📄 关联报告 |
| 完成回复前 | 确保 📨 对话记录已追加本轮 |
| 任务结束 | 状态更新为 ✅ |

**约束**：
- 🔴 **禁止询问用户"是否需要写入记忆"**（[C05/S05](../../instructions/00-safety.instructions.md) 自动写入）
- 追加段落时使用增量编辑，禁止覆盖已有内容（[C06/S04](../../instructions/00-safety.instructions.md)）
- 禁止使用 `Set-Content` 等命令修改 .md 文件（[C09](../../instructions/01-common.instructions.md)）

## 新会话 🔄 检测

新会话开始时检查今日/昨日任务文件（`tasks/YYYYMMDD.md`，**不检查 SUMMARY**）中是否有状态 🔄 的未完成任务：
- 有 🔄 → 输出提示：`⚠️ 上次存在未完成任务：[简述]，建议先 resume`
- 用户说"继续"/"恢复" + 存在 🔄 → 判定为 `resume`

## 会话段落字段

### 必填

| 字段 | 说明 |
|------|------|
| 🎯 任务摘要 | 本次任务的核心目标和意图 |
| 📨 对话记录 | 四列表格：`轮次 | 👤 用户消息 | 🤖 AI执行 | 状态` |

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
- 每次会话结束前（[SC6](../compliance/SKILL.md) 检查）追加一行索引
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

> 🔴 **SUMMARY 纯索引约束**：SUMMARY 仅包含表头 + 会话索引行，**禁止添加任何自由文本段落**（如"当前状态""关键决策""待处理事项"等非索引内容）。🔄 状态标记仅出现在索引表的「状态」列，不得出现在表外文本中。已有旧格式 SUMMARY 应在下次写入时迁移（移除非索引段落，内容转入 daily file 或 profile）。

### 全局 SUMMARY（项目共用）
```
<项目根>/.devcodex/.memory/SUMMARY.md
```
- 仅记录关键决策（规范变更/架构决策/P0修复）
- [SC7](../compliance/SKILL.md) 检查时追加，纯 chat/无重要决策时 N/A

## 三层记忆职责

| 层级 | 文件 | 写入频率 |
|------|------|---------|
| Agent 日记 | `.memory/clients/<agent>/tasks/YYYYMMDD.md` | 每会话必写 |
| 需求记忆 | `<需求>/.memory/sessions.md` | 路由确定后追加 |
| 项目总记忆 | `.memory/SUMMARY.md` | 有关键决策时 |

### 需求级记忆路径构建

```
<项目根>/.devcodex/requirements/<描述>/.memory/sessions.md   # dev 需求
<项目根>/.devcodex/bugs/<描述>/.memory/sessions.md           # fix Bug
<项目根>/.devcodex/optimizations/<描述>/.memory/sessions.md  # dev 优化
```

`<描述>` 与 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md) 中的任务目录名一致。

## 模板引用

| 产出物 | 模板 |
|--------|------|
| 记忆日文件 | `prompts/memory-session.prompt.md` |
| Agent SUMMARY | `prompts/agent-summary.prompt.md` |
| 需求级记忆 | `prompts/requirement-session.prompt.md` |

