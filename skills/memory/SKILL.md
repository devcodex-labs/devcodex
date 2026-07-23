---
name: memory
description: 管理会话记忆的读取与写入。三层记忆体系：Agent 日记 / 需求记忆 / 项目总记忆。
---
## 文件路径

```text
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
     - Grok Build / Grok CLI（xAI）：`grok`（`DEVCODEX_AGENT=grok` 或 `GROK_AGENT` 等；禁止长期误绑 `codex`）
     - 无法确定：`unknown-agent`（运行时不得默认 `claude-code`）
  4. **写入约定**：`devcodex profile init` 生成 `config.json` 时可以写入当时探测到的 `agent` 作为兜底提示；`devcodex init` / `devcodex init --claude` / `devcodex init --codex` 只负责分发规则与运行时文件，不直接生成 profile config。
  5. **冲突处理**：若 profile agent 与当前实际宿主不同，Agent 日记、SUMMARY、报告路径均按当前实际宿主写入，并在 PC0/doctor/报告中提示差异。
- ⛔ **禁止使用 shell 命令（bash find、PowerShell glob）查找记忆文件**（shell glob 会跳过隐藏目录）
- 必须使用宿主文件工具（Copilot: list_dir；Claude Code: Read/Glob；Codex: 当前可用的文件读取/搜索工具）逐层进入：`clients/` → `<agent>/` → 读取日期文件

## 读取策略

### MemoryContextQueryGate

记忆读取必须绑定当前 `ContextReadPlanV2`（兼容 `ContextReadPlanV1`），先取带 `ContentIdentityV1` 的结构化状态，再按 continuity 精确查询；“必须复证文件真相”不得实现成固定全文读取。

`memory_status`、`memory_summary_query` 与 `memory_session_query` 可在 source
metadata 和 pointer/manifest 校验通过时使用
`<active-root>/.runtime-state/derived-indexes/v1/memory/**` 的
status/current/month/day byte-range 分区。该索引不是记忆真相源：

- 受管 memory writer 只有在 canonical 文件提交成功后才刷新索引，pointer 最后写并回读。
- source metadata 漂移、schema/digest 损坏、锁竞争或索引缺失时必须回退既有
  parser；允许返回 additive `indexReceipt/coverage`，不得改变旧字段、排序或错误。
- query 与 fallback 均保持 zero-write；不得为了修复索引在读取阶段创建或改写 memory 文件。
- byte-range 或截断结果只能证明已返回范围，不能声明完整 daily/SUMMARY 正文已验证。

| 场景 | 读取范围 | 执行顺序 |
|------|---------|---------|
| **命名续接 · 首步** | 完整消息为 `继续<任务名>任务` / `继续 <任务名>` 时调用 `memory_task_resolve(name, project?)`；只取 identity/session/CP metadata 与结构化结果 | 先于通用 resume 查询 |
| 命名续接 · 唯一 active | 定向读取该任务 `.memory/task.json`、`.memory/sessions.md`、当前绑定 artifact/checkpoint；执行 SemanticContinuationDiff | resolver 只定位，不替代复水化 |
| **正常会话 · 首步** | `memory_status(limit <= 5)`，只返回今日/昨日 metadata、有限 SUMMARY 行、active 状态与冲突 | 第一读 |
| 正常会话 · 连续性相关 | `memory_summary_query(status: active/unresolved, limit <= 5)` | status 证明需要时再读 |
| **intent = resume · 首步** | `memory_status(limit <= 5)` | 第一读 |
| intent = resume · 精确恢复 | `memory_session_query(date/sessionId/status, limit: 1, handoffOnly: true/false, maxChars: 有界)`；已知存在卡片时只取 handoff，否则取单个 bounded session，再定向读取需求 sessions、报告或 checklist | 第二读 |
| resume · 宏观补充 | `memory_summary_query(status: unresolved, limit <= 5)` | 精确 session 不足时 |
| 文件不存在 / 旧格式 / 解析失败 | bounded empty + warnings；保持 partial/unverified，读取零写入 | 禁止自动 rename / create |
| intent = resume · 当前项目无 🔄 | 告知用户最近任务均已完成（引用最后会话摘要），询问是否切换项目或开始新任务；**禁止静默回退旧任务** | — |
| resume 超 14 天 | `memory_summary_query(status: unresolved, since/limit)` 定位 → 提示日期/会话编号 → `memory_session_query` 精确读取 | — |
| 用户明确要求历史回溯 | 同 resume | — |

`ConcurrencyPolicy`：记忆读取可作为只读通道并发执行；记忆写入、SUMMARY 更新、ContextHandoffCard 和会话状态提交必须按 `memory` 单写者锁串行完成。

`requirement-parallel-orchestration`：并行子会话只能把 `RequirementIndependenceDecisionV1`、`ParallelLaunchCardV1` 或局部验证证据交回主会话；需求级 sessions、Agent daily、SUMMARY 和 ContextHandoffCard 仍由主会话按 `memory` 单写者锁串行写入。

### MemoryTransactionWriterGate

当可用 MCP memory writer 时，Agent 不得再用“读取 daily 尾号 → 自行计算会话编号 → 直接编辑 daily/SUMMARY 多文件”的方式作为首选写入路径。

- 新会话编号必须优先通过 `memory_session_allocate(project, date, title, intent, sourceMessage)` 原子分配；该工具会在 active-root / agent / date 作用域内持有 writer lock，并写入 reserved daily 段，返回 `MemorySessionAllocationReceiptV1`。
- `memory_session_write` 与 `memory_summary_append` 必须返回 `MemoryTransactionReceiptV1`，包含 activeRoot、agent、file、beforeDigest、afterDigest、transactionId 与完成时间；报告/记忆可引用 receipt，而不是只写“已追加”。
- 遇到 `MEMORY_TRANSACTION_LOCKED` 时，当前写入方必须重读 `memory_status` / `memory_summary_query` 后重试或降级为阻塞说明，禁止忽略锁继续手工写同一文件。
- MCP 不可用时可使用宿主增量编辑 fallback，但必须在报告或记忆中标记 `memoryWriter=fallback`，并在写前后核对 daily 与 SUMMARY digest。

### MemoryCannotSatisfyBootstrapGate

宿主或产品内置的 Memories、模型长期偏好、对话摘要、ContextHandoffCard 或 SUMMARY 都不能替代当前文件真相源读取：

- Memories 只能提示“可能要看哪里”，不得替代 bounded Profile plan、`memory_status` / `memory_session_query` / `memory_summary_query`、需求级 sessions、报告、review checklist、源码或文档的实际读取结果。
- 新线程、resume、summary 恢复、compact 后继续或跨项目切换时，必须重建 context epoch 与计划并重新查询必要来源；不能因为模型“记得上次任务”就跳过复证，也不能因此默认全文读取。
- SUMMARY 是索引，ContextHandoffCard 是交接卡；二者都不能覆盖 daily tasks、已确认需求/问题产物、报告和当前源码真相。
- 报告或最终回复若引用 Memories 辅助判断，必须标记为 `navigation-hint`，并列出完成真实读取的文件证据；无法读取时写阻塞 / 降级，不写通过。

> ⛔ 禁止默认读取完整 SUMMARY、完整 daily tasks 或昨日以前正文；精确 resume 查询与用户明确要求除外。
> ⚠️ 旧 `memory_session_read` / `memory_summary_read` 仅作兼容；no-args 全文读取不是生产默认路径，也不能单独把 `ContextReadReceiptV2`（或兼容的 `ContextReadReceiptV1`）推进到 `relevant-complete/completed`。记忆 projection 的 telemetry 不进入内容身份，cache hit 也不等于当前模型已观察正文。
> ⛔ **禁止静默回退**：resume 意图检测到当前项目无 🔄 任务时，禁止静默选取历史旧任务继续；必须明确告知用户当前状态并询问意图。
> ⚠️ **跨项目 resume**：无任务名的普通“继续/恢复”仍只使用当前项目的有界记忆，当前项目无 🔄 时须询问；完整 `继续<任务名>任务` 可通过 workspace 派生索引做有界 exact 定位，但同名、规模超限或非 active 状态必须停止消歧，不能猜测。

## 写入规则

| 时机 | 动作 |
|------|------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮交互 | 追加对话记录到 📨 字段 |
| 子任务完成（多任务） | 追加 `T{N}进度：✅` |
| 正式复审状态变化 | 只投影 `ReviewStateSnapshotV1` 的 snapshotDigest/nextAction/counts；不得在 memory 独立重算 open/blocker/stale/unreviewed |
| 超 13 轮预警（[C08](../../instructions/01-common.instructions.md)） | 写编码检查点到当前段落 |
| 报告写入后 | 追加报告路径到 📄 关联报告 |
| 完成回复前 | 确保 📨 对话记录已追加本轮 |
| 任务结束 | 状态更新为 ✅ |

**约束**：
- 🔴 **禁止询问用户"是否需要写入记忆"**（[C05/S05](../../instructions/00-safety.instructions.md) 自动写入）
- 追加段落时优先使用 `memory_session_allocate` + `memory_session_write` 事务写入；MCP 不可用时才使用增量编辑 fallback，禁止覆盖已有内容（[C06/S04](../../instructions/00-safety.instructions.md)）
- 禁止使用 `Set-Content` 等命令修改 .md 文件（[C09](../../instructions/01-common.instructions.md)）
- 写入报告路径、ContextHandoffCard 或 artifact-links 前执行 `ArtifactLinkSetDedupeGate`：同一物理文件按 canonical path 只保留一个主引用。session、daily、SUMMARY、task state 和 checkpoint 必须进入 `ArtifactDeliveryManifestV1`，但默认 `internal-only`；只有 resume/handoff、状态冲突、写入失败、审计取证或用户明确要求时进入 `UserFacingArtifactSetV1`。
- 需求修订、再次复审、宣布“可确认 / 暂不通过 / 已修订待复审”或从修复清单回写真相源时，记忆写入必须配合 `RequirementVerdictStateSyncGate`：daily tasks、需求级 sessions 和 SUMMARY 的状态口径不得与需求真相源顶部状态、推荐结论、修复清单或 audit-state decision 冲突。

## 新会话 🔄 检测

新会话开始时调用 `memory_status` 检查今日/昨日 metadata、有限 SUMMARY 行和状态冲突；发现 active / unresolved 候选后，才用 `memory_session_query(limit: 1)` 取得对应片段：
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
| 🧾 Governance Intake | candidate IDs、assessmentVerdict、generalizationScope、existingRuleState、复合 record intents、target ledgers、write requirement/evidence、verification state；只存最小锚点，不复制完整 prompt |
| 🔎 ReviewState | planId、snapshotDigest、stage、reviewClass、open/blocker/stale/unreviewed、saturation、nextAction；正文以 review checklist/runtime 为准 |

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
```text
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
- 关联报告与关联记忆按 `ArtifactLinkSetDedupeGate` 只写当前主报告 / 主记忆索引；同一物理文件用 canonical path 归并。内部索引不因用户面默认隐藏而停止写入或从 ECR 排除。

> 🔴 **SUMMARY 纯索引约束**：SUMMARY 仅包含表头 + 会话索引行，**禁止添加任何自由文本段落**（如"当前状态""关键决策""待处理事项"等非索引内容）。🔄 状态标记仅出现在索引表的「状态」列，不得出现在表外文本中。已有旧格式 SUMMARY 应在下次写入时迁移（移除非索引段落，内容转入 daily file 或 profile）。

### ContextHandoffCard

跨会话、跨 Agent、多批次、summary/compact 前、用户要求“传递上下文”或即将中断时，daily tasks 或报告必须写入 `ContextHandoffCard`，字段至少包含：`source-of-truth`、`confirmed-decisions`、`open-risks`、`next-action`、`blocked-reason`、`must-not-overwrite`、`validation-state`、`artifact-links`。`ContextHandoffCard` 是交接卡，恢复方仍须按 `Context Rehydration Contract` 重新核对文件真相源；禁止把交接卡写成 SUMMARY 自由文本段落。

### NewSessionContinuationCard（ABS-11 / PI-114）

凡 AI **主动建议**或因 C08 / 规模门禁**要求切换新会话**，必须在**同一最终回复**交付用户可复制的 `NewSessionContinuationCard`，字段至少：`targetProject`、稳定 `taskId`（已有时）、`task`、`phaseAndConfirmationState`（CP pending 不得写成已确认）、`sourceOfTruth`、`confirmedDecisions`、`mustNotOverwrite`、`validationState`、`nextAction`、`copyReadyPrompt`。面向用户的 `copyReadyPrompt` 固定收敛为 `继续<displayName>任务`；长 Card 留在内部/报告作降级证据。接收方仍须用 resolver 定位并重建 ContextReadPlan，禁止默认全读 Profile/SUMMARY。

### SessionTimingCard（ABS-18 / PI-117）

长任务（non-chat 的 analyze/audit/dev/fix、多批次、用户抱怨慢、完整深度等）须在会话段或报告附录记录：

| 字段 | 说明 |
|------|------|
| `startedAt` / `endedAt` 或 `lastActiveAt` | ISO 墙钟 |
| `wallClock` | 总时长（含等待） |
| `executionMs` / `waitingUserMs` / `waitingExternalMs` | **ExternalWaitAccountingGate**：执行 / 等人 / 外部等待分列 |
| `phases[]` | 至少覆盖：context-acquire / plan-or-cp / execute-or-read / validate / report-memory / **waiting-user** /（条件）waiting-external |
| `slowTags` | 可选 1～3 个有证据标签（large-corpus / waiting-user / full-profile-load…） |
| `cycleId` / `budget` | 条件：命中 `ExecutionBudgetGate` 时记录 cycle 与 maxWallClock 等预算快照 |
| `authorizationEvidence` | 条件：命中 `LongTaskAuthorizationGate` 时记录续跑/Auto 授权 |

**等人确认与外部等待必须单独计时**，不得并入「AI 执行慢」，也不得消耗 `maxWallClock` 执行预算。纯 chat 秒回可 `N/A + skipReason`。用户面可给一行：`耗时 XhYm（执行 … · 等人 … · 外部 …）`。

### ExecutionBudget 记忆锚点（PI-118 / PF-137）

命中长任务预算时，daily tasks 须能定位当前 `cycleId`、预算上限、已消耗执行墙钟、StopSnapshot 路径（若已触发）与「继续=新 cycle」状态。禁止在记忆里把用户「继续」写成同一 cycle 预算清零。

### ProjectKnowledgeSnapshot 边界

`incremental-project-analysis` 的知识快照/digest **不得**写入 SUMMARY 正文（SUMMARY 纯索引）；快照落独立产物路径，daily tasks 只链路径。

### 全局 SUMMARY（项目共用）
```text
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

```text
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
