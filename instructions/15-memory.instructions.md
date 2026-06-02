---
applyTo: "**"
description: 记忆规则，覆盖 tasks、SUMMARY、需求记忆的读取顺序、写入时机与格式约束
priority: P5
version: 1.11.8
---
# 记忆写入规则（15-memory）

> 本文件定义记忆的读取、写入和 SUMMARY 管理的完整规则。

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

`<agent>` 确定规则（优先级从高到低）：
1. **当前实际宿主（优先）**：以当前会话/工具链可验证的宿主事实为准，产物必须写入对应宿主目录。例如当前在 Codex 中执行时写 `.memory/clients/codex/`，不得被历史 profile 覆盖。
2. **Profile agent 兜底**：仅当当前实际宿主无法可靠判断时，才读取 `.devcodex/profile/config.json` 的 `"agent"` 字段作为 fallback hint；它不能覆盖当前会话事实。
3. **无法判断**：写入 `unknown-agent`，并在报告或记忆中记录宿主无法识别的原因。

枚举值固定，全小写连字符分隔：
   - Copilot in VS Code：`copilot` 或 `vscode-copilot`
   - Claude Code（CLI/桌面端）：`claude-code` ⚠️ 禁止使用裸 `claude`（与 Claude API/Claude.ai 区分）
   - Codex：`codex`（通过 `AGENTS.md` / `.agents/skills/` / `.codex/hooks.json` 适配）
   - Cursor IDE：`cursor`
   - JetBrains Copilot：`jetbrains-copilot`
   - 无法确定：`unknown-agent`
4. **写入约定**：`devcodex profile init` 生成 `config.json` 时可以写入当时探测到的 `agent` 作为兜底提示；`devcodex init` / `devcodex init --claude` / `devcodex init --codex` 只负责分发规则与运行时文件，不直接生成 profile config
5. **冲突处理**：若 profile agent 与当前实际宿主不同，Agent 日记、SUMMARY、报告路径均按当前实际宿主写入，并在 PC0/doctor/报告中提示差异。
- ⛔ **禁止使用 shell 命令（bash find、PowerShell glob）查找记忆文件**（shell glob 会跳过以 `.` 开头的隐藏目录）
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
| 正常会话 | 今日文件 + 昨日文件 | 第二读 |
| 今日文件不存在 | 仅读昨日文件 | — |
| 文件存在但解析失败 | 重命名为 `.bak.md`，创建新文件 | — |
| **intent = resume · 首步** | 今日 `tasks/YYYYMMDD.md`（定位最后一个会话段落，确认真实意图）| **第一读** |
| intent = resume · 次步 | Agent SUMMARY.md（宏观上下文补充）| 第二读 |
| intent = resume · 当前项目无 🔄 | 告知用户最近任务均已完成（引用最后会话摘要），询问是否切换项目或开始新任务；**禁止静默回退旧任务** | — |
| resume 超 14 天 | ① 从 SUMMARY.md 查找最后 🔄 状态行 → ② 提示用户提供具体日期或会话编号 → ③ 精准读取对应日期文件 | — |

> ⛔ 禁止默认读取超过昨日以前的文件（resume 和用户明确要求除外）
> ⛔ **禁止静默回退**：resume 意图检测到当前项目无 🔄 任务时，禁止静默选取历史旧任务继续执行；必须明确告知用户当前状态并询问意图。
> ⚠️ **跨项目 resume**：记忆文件是项目级独立管理的。当用户在不同项目间切换后说"继续"，AI 只能读取当前项目的记忆；若当前项目无 🔄，须主动询问是否需要恢复其他项目的工作，而非猜测。

## Context Rehydration Contract（记忆侧）

压缩恢复、summary 恢复、resume 或用户明确要求“按文件真相重建”时，记忆侧上下文必须按以下优先级参与重建：

1. 当前用户消息
2. 已确认需求/bug 产物
3. 当前任务 `sessions.md`
4. 当日 `tasks/YYYYMMDD.md`
5. Agent `SUMMARY.md`
6. compaction / summary 摘要
7. AI 当前推断

约束：

- `SUMMARY.md` 是索引，不是事实源；不得用 SUMMARY 覆盖当日 tasks 或需求级 sessions。
- 若 tasks / sessions / 已确认产物与摘要冲突，必须以文件真相源为准，并重建 Intent Expansion Card。
- 新会话首步的 tasks + SUMMARY 一致性检查（PC7）是 Context Rehydration Contract 的最低执行面，不得省略。

## 触发规则

| 时机 | 必须动作 |
|------|---------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮用户消息 | 追加对话记录到 📨 字段 |
| 子任务完成（多任务会话）| 追加 `T{N}进度：✅` |
| 超 13 轮预警（C08）| 写入编码检查点（📦 字段）|
| 报告写入后 | 追加报告路径到 📄 关联报告 |
| 完成回复前 | 确保 📨 对话记录已追加本轮 |
| 任务结束 | 更新状态为 ✅ |

## 新会话 🔄 检测

新会话开始时检查今日/昨日任务文件（`tasks/YYYYMMDD.md`，**不检查 SUMMARY**）中是否有状态 🔄 的未完成任务：
- 有 🔄 → 输出提示：`⚠️ 上次存在未完成任务：[简述]，建议先 resume`
- 用户说"继续"/"恢复" + 存在 🔄 → 判定为 `resume`

## 新会话首步强制（v1.9.4+，hook 强制 + AI 兜底）

> 🔴 **不可跳过**：本步骤直接对应 PC7（详见 [`17-compliance.instructions.md`](./17-compliance.instructions.md) §PC7）和 18-spec-radar §G10 limit 截断恢复触发场景，防止 session limit 截断后 AI 不走 resume 路径而错误新建工作流。

收到首条用户消息时（无论用户措辞），AI 必须：

1. **Read** 今日 `tasks/YYYYMMDD.md`（不存在则昨日）
2. **检测最末** `## 会话 NN` 的状态字段：
   | 状态 | 路由 |
   |------|------|
   | 显式 `状态: ✅` | 正常走意图识别 |
   | 显式 `状态: 🔄` | 触发 resume 提示，建议用户确认是否继续上次任务 |
   | 状态字段缺失 / `## 会话 NN` 标题后段落内容不完整 | 触发 ⚠️ "可能 limit 截断"报警，提示用户确认 |
3. **对比 SUMMARY 与 tasks 一致性**：
   - SUMMARY 最末行状态 ✅ + tasks 对应段落实际未完成（缺 `状态: ✅` 或段落明显残缺）→ 🔴 数据不一致报警
4. **仅本步通过后才进入** cp-gate / 工作流路由判定

> ⚠️ **触发判定不依赖用户措辞**："继续任务"/"接着做"/"开始干"/"我来了" 等含糊或明确措辞均不影响 — 本步骤是 hook 强制 + AI 自检兜底。

> ⛔ **禁止**：直接按用户首条消息路由到 dev/fix/analyze 而不先读 tasks 文件。违反即触发 G10 VL 标记。

## 会话字段

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
| chat / 简单 analyze / audit（多轮）| 紧凑 |
| dev/fix（≤2 文件变更） | 紧凑 |
| dev/fix（≥3 文件变更）/ 多任务（≥3）| 完整 |

> 首次写入可用紧凑格式，复杂度超出后升级（追加缺失字段，不重写已有内容）

## Token 防护写入（C08）

| 阶段 | 动作 |
|------|------|
| 🟡 关注区（>10 轮） | 在摘要中记录当前轮次 |
| 🟡 预警（>13 轮） | 写入编码检查点（📦 字段）|
| 🔴 防护（>15 轮） | 立即写入完整记忆 |
| 🔴 硬性暂停（≥15 轮 + ≥5 文件）| 先完成记忆持久化再继续 |

## SUMMARY 文件

### Agent SUMMARY（每 Agent 独立）
```
<active-root>/.memory/clients/<agent>/SUMMARY.md
```
- 每次会话结束前追加一行索引（SC6 检查）
- 格式：`| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |`
- 多任务会话：一行覆盖全部任务，不拆多行
- 🔴 **纯索引约束**：SUMMARY 仅含表头 + 会话索引行，禁止添加自由文本段落（如"当前状态""关键决策"等非索引内容）；🔄 状态标记仅出现在索引表「状态」列；已有旧格式 SUMMARY 应在下次写入时迁移

### 全局 SUMMARY（项目共用）
```
<active-root>/.memory/SUMMARY.md
```
- 仅记录关键决策（规范变更/架构决策/P0修复）

## 三层记忆职责

| 层级 | 文件 | 写入频率 |
|------|------|---------|
| Agent 日记 | `.memory/clients/<agent>/tasks/YYYYMMDD.md` | 每会话必写 |
| 任务记忆 | `<任务>/.memory/sessions.md`（requirements / bugs） | 路由确定后追加 |
| 项目总记忆 | `.memory/SUMMARY.md` | 有关键决策时 |

## 强制约束

- ⛔ **禁止询问用户"是否需要写入记忆"**（C05/S05 强制自动写入）
- ⛔ **禁止覆盖已有内容**（C06/S04 只能追加，使用增量编辑）
- ⛔ **禁止使用终端命令修改 .md 文件**（C09）

## chat 豁免说明

- chat 工作流豁免**报告**，但**记忆仍须写入**
- chat 场景的 📨 对话记录仍使用四列表格；可在 `🤖 AI执行` 列写成 `chat：[一句话描述]`，不得降级为表格外单行
