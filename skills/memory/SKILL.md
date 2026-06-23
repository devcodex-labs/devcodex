---
name: memory
description: 管理会话记忆的读取与写入。三层记忆体系：Agent 日记 / 需求记忆 / 项目总记忆。
---
## 文件路径

```
<active-root>/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

`<active-root>` 取值：
- 旧布局：`<项目根>/.devcodex`
- 集中布局单项目：`<工作区根>/.devcodex/<project>`
- 集中布局全工作区：`<工作区根>/.devcodex/workspace`

### MCP memory scope（workspace-namespace）

当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，MCP memory 工具从工作区根调用不得静默回退到 workspace 记忆。调用方必须二选一：
- 传入 `project`，写入 `<工作区根>/.devcodex/<project>/.memory/...`
- 显式传入 `scope: "workspace"`，写入 `<工作区根>/.devcodex/workspace/.memory/...`

若 cwd 位于工作区根且未传 `project` / `scope`，必须返回 `workspace-namespace memory scope is ambiguous` 错误，禁止误读/误写 workspace 级 SUMMARY 或 tasks。

- `<agent>` 确定规则（优先级从高到低）：
  1. **当前实际宿主（优先）**：以当前会话/工具链可验证的宿主事实为准，产物必须写入对应宿主目录，例如当前在 Codex 中执行时写 `.memory/clients/codex/`，不得被历史 profile 覆盖。
  2. **Profile agent 兜底**：仅当当前实际宿主无法可靠判断时，才读取 `.devcodex/profile/config.json` 的 `"agent"` 字段作为 fallback hint；它不能覆盖当前会话事实。
  3. **无法判断**：写入 `unknown-agent`，并在报告或记忆中记录宿主无法识别的原因。

  枚举值固定，全部小写连字符分隔：
     - Copilot in VS Code：`copilot` 或 `vscode-copilot`
     - Claude Code（CLI/桌面端）：`claude-code` ⚠️ 禁止使用裸 `claude`（与 Claude API/Claude.ai 区分）
     - Codex：`codex`（通过 `AGENTS.md` / `.agents/skills/` / `.codex/hooks.json` 适配）
     - Cursor IDE：`cursor`
     - JetBrains Copilot：`jetbrains-copilot`
     - 无法确定：`unknown-agent`
  4. **写入约定**：`devcodex profile init` 生成 `config.json` 时可以写入当时探测到的 `agent` 作为兜底提示；`devcodex init` / `devcodex init --claude` / `devcodex init --codex` 只负责分发规则与运行时文件，不直接生成 profile config。
  5. **冲突处理**：若 profile agent 与当前实际宿主不同，Agent 日记、SUMMARY、报告路径均按当前实际宿主写入，并在 PC0/doctor/报告中提示差异。
- ⛔ **禁止使用 shell 命令（bash find、PowerShell glob）查找记忆文件**（shell glob 会跳过隐藏目录）
- 必须使用宿主文件工具（Copilot: list_dir；Claude Code: Read/Glob；Codex: 当前可用的文件读取/搜索工具）逐层进入：`clients/` → `<agent>/` → 读取日期文件

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

`ConcurrencyPolicy`：记忆读取可作为只读通道并发执行；记忆写入、SUMMARY 更新、ContextHandoffCard 和会话状态提交必须按 `memory` 单写者锁串行完成。

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
- 写入报告路径、ContextHandoffCard 或 artifact-links 前执行 `ArtifactLinkSetDedupeGate`：同一物理文件按规范化绝对路径只保留一个主引用；记忆/SUMMARY 可作为索引证据，但不得把同一文件的相对链接、绝对链接和 copy fallback 记录成多份主产物。

## 新会话 🔄 检测

新会话开始时检查今日/昨日任务文件（`tasks/YYYYMMDD.md`，**不检查 SUMMARY**）中是否有状态 🔄 的未完成任务：
- 有 🔄 → 输出提示：`⚠️ 上次存在未完成任务：[简述]，建议先 resume`
- 用户说"继续"/"恢复" + 存在 🔄 → 判定为 `resume`

## 会话字段

### 必填

| 字段 | 说明 |
|------|------|
| 🎯 任务摘要 | 本次任务的核心目标和意图 |
| 状态 | 🔄 进行中 / ✅ 已完成（**v1.9.4+ 必填且单独成行**，作为 PC7 新会话首步检测的唯一权威标记）|
| 📨 对话记录 | 四列表格：`轮次 | 👤 用户消息 | 🤖 AI执行 | 状态` |
| 📋 任务清单（多任务会话 ≥2 时必填，v1.9.4+）| 顶部小节列出本次会话所有独立任务及进度，格式：`T1 [任务摘要] ✅/🔄/❌` 每行一项 — 解决 M2 多任务进度散布表格中难以快速追踪问题 |

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
<active-root>/.memory/clients/<agent>/SUMMARY.md
```
- 每次会话结束前（[SC6](../compliance/SKILL.md) 检查）追加一行索引
- 模板：`prompts/agent-summary.prompt.md`
- 🔴 **状态字段延迟写入（v1.9.4+）**：会话进行中先写 `🔄`；任务完整结束、合规检查全通过、V8 部署同步通过后才改 `✅`。防止 session limit 截断时 SUMMARY 已 ✅ 但 tasks 段落不完整造成数据不一致（参见 [`15-memory §新会话首步强制`](../../instructions/15-memory.instructions.md)）。

**文件格式**（首次创建时用此表头，之后只追加行）：

```markdown
# Agent SUMMARY — [agent-id]

> 项目：[项目名]

| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |
|------|:----:|------|------|---------|---------|:----:|
| YYYY-MM-DD HH:MM | NN | dev/fix/... | [50~100字摘要，含关键数字/结果] | [NN--简述.md](workspace相对路径/NN--简述.md) | [YYYYMMDD.md §NN](workspace相对路径/YYYYMMDD.md) | ✅/🔄 |
```

**字段规则**：
- 类型：工作流意图，多任务用 `+` 连接（如 `fix+audit`）
- 摘要：一行 50~100 字，包含做了什么 + 关键数字/结果
- 多任务会话：一行覆盖全部任务，不拆多行
- 排序：按时间正序追加（最新在最后）
- 关联报告与关联记忆按 `ArtifactLinkSetDedupeGate` 只写当前主报告 / 主记忆索引；同一物理文件在报告、记忆和最终回复重复出现时，用同一 canonical path 归并。

> 🔴 **SUMMARY 纯索引约束**：SUMMARY 仅包含表头 + 会话索引行，**禁止添加任何自由文本段落**（如"当前状态""关键决策""待处理事项"等非索引内容）。🔄 状态标记仅出现在索引表的「状态」列，不得出现在表外文本中。已有旧格式 SUMMARY 应在下次写入时迁移（移除非索引段落，内容转入 daily file 或 profile）。

### ContextHandoffCard

跨会话、跨 Agent、多批次、summary/compact 前、用户要求“传递上下文”或即将中断时，daily tasks 或报告必须写入 `ContextHandoffCard`，字段至少包含：`source-of-truth`、`confirmed-decisions`、`open-risks`、`next-action`、`blocked-reason`、`must-not-overwrite`、`validation-state`、`artifact-links`。`ContextHandoffCard` 是交接卡，恢复方仍须按 `Context Rehydration Contract` 重新核对文件真相源；禁止把交接卡写成 SUMMARY 自由文本段落。

### 全局 SUMMARY（项目共用）
```
<active-root>/.memory/SUMMARY.md
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
<active-root>/requirements/<描述>/.memory/sessions.md   # dev 需求
<active-root>/bugs/<描述>/.memory/sessions.md           # fix Bug
<active-root>/optimizations/<描述>/.memory/sessions.md  # dev 优化
```

`<描述>` 与 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md) 中的任务目录名一致。

## 模板引用

| 产出物 | 模板 |
|--------|------|
| 记忆日文件 | `prompts/memory-session.prompt.md` |
| Agent SUMMARY | `prompts/agent-summary.prompt.md` |
| 需求级记忆 | `prompts/requirement-session.prompt.md` |
