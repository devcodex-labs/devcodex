---
applyTo: "**"
description: 记忆规则，覆盖 tasks、SUMMARY、需求记忆的读取顺序、写入时机与格式约束
priority: P5
version: 1.19.4
---
# 记忆写入规则（15-memory）

> 本文件定义记忆的读取、写入和 SUMMARY 管理的完整规则。

## 文件路径

```text
<active-root>/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

<!-- devcodex:include shared/memory/active-root-layout.md -->

### MCP memory scope（workspace-namespace）

<!-- devcodex:include shared/memory/workspace-selection.md -->

<!-- devcodex:include shared/memory/ambiguous-workspace-error.md -->

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
   - Grok Build / Grok CLI（xAI）：`grok`（可通过 `DEVCODEX_AGENT=grok` 或 `GROK_AGENT` 等宿主信号识别；禁止长期误绑 `codex`）
   - 无法确定：`unknown-agent`（MCP 运行时不得在无法识别时默认 `claude-code`）
4. **写入约定**：`devcodex profile init` 生成 `config.json` 时可以写入当时探测到的 `agent` 作为兜底提示；`devcodex init` / `devcodex init --claude` / `devcodex init --codex` 只负责分发规则与运行时文件，不直接生成 profile config
5. **冲突处理**：若 profile agent 与当前实际宿主不同，Agent 日记、SUMMARY、报告路径均按当前实际宿主写入，并在 PC0/doctor/报告中提示差异。
- ⛔ **禁止使用 shell 命令（bash find、PowerShell glob）查找记忆文件**（shell glob 会跳过以 `.` 开头的隐藏目录）
- 必须使用宿主文件工具（Copilot: list_dir；Claude Code: Read/Glob；Codex: 当前可用的文件读取/搜索工具）逐层进入：`clients/` → `<agent>/` → 读取日期文件

## 读取策略

### MemoryContextQueryGate

记忆读取必须进入当前 `ContextReadPlanV2`（兼容 `ContextReadPlanV1`），并通过 `MemoryContextQueryGate` 执行有界查询；“文件是真相源”不等于“先读完整文件”。

现有 memory MCP query 可在 source metadata 和 pointer/manifest 校验通过时读取
`<active-root>/.runtime-state/derived-indexes/v1/memory/**` 的派生分区。canonical
daily/SUMMARY 仍是唯一真相源：受管 writer 在文件提交后刷新索引；索引缺失、
陈旧、损坏或锁竞争时回退既有 parser；query/fallback 均零写入。允许 additive
`indexReceipt/coverage`，不得改变旧字段、排序和错误语义；byte-range 或截断结果
不得升级为完整正文已验证。

### MemoryCursorGate

- `memory_session_query` / `memory_summary_query` 首次可省略 cursor；有安全下一页时返回 `MemoryPaginationV1.nextCursor`，调用方必须把 opaque `MemoryCursorV1` 原样传回同一个 tool。
- cursor 绑定 target/activeRoot、`ContextReadBindingV1`、query digest、canonical source identity 与 offset。任一字段或 source identity 漂移必须稳定返回 cursor mismatch，禁止静默退回第一页；source coverage 为 partial 时不得签发无法安全续读的 next cursor。
- 分页成功只能证明已返回页和明确 coverage；只有完整消费同一绑定下的全部页，才可把对应范围标为 complete。

| 场景 | 读取范围 | 执行顺序 |
|------|---------|---------|
| **命名续接 · 首步** | 完整消息为 `继续<任务名>任务` / `继续 <任务名>` 时调用 `memory_task_resolve(name, project?)`；只返回有界 identity/session/CP metadata | 先于通用 resume 查询 |
| 命名续接 · 唯一 active | 定向读取该任务 `task.json`、`sessions.md`、当前绑定 artifact/checkpoint | resolver 只定位，不替代复水化 |
| **正常会话 · 首步** | `memory_status(limit <= 5)`：今日/昨日 metadata、有限 SUMMARY 行、active 状态与冲突；不返回整文件正文 | 第一读 |
| 正常会话 · 连续性相关 | `memory_summary_query(status: active/unresolved, limit <= 5)` | status 证明需要时再读 |
| **intent = resume · 首步** | `memory_status(limit <= 5)` | 第一读 |
| intent = resume · 精确恢复 | `memory_session_query(date/sessionId/status, limit: 1, handoffOnly: true/false, maxChars: 有界)`；已知存在卡片时只取 handoff，否则取单个 bounded session，再定向读取 requirements/bugs sessions、报告或 review checklist | 第二读 |
| resume · 宏观补充 | `memory_summary_query(status: unresolved, limit <= 5)` | 仅精确 session 仍不足时 |
| 文件不存在 / 旧格式 / 解析失败 | 返回 bounded empty + warnings，证据保持 partial/unverified；读取动作零写入 | 禁止在读取阶段重命名或创建文件 |
| intent = resume · 当前项目无 🔄 | 告知用户最近任务均已完成（引用最后会话摘要），询问是否切换项目或开始新任务；**禁止静默回退旧任务** | — |
| resume 超 14 天 | `memory_summary_query(status: unresolved, since/limit)` 定位候选 → 提示日期或会话编号 → `memory_session_query` 精确读取 | — |

> ⛔ 禁止默认读取完整 SUMMARY、完整 daily tasks 或昨日以前正文（精确 resume 查询和用户明确要求除外）。
> ⛔ **禁止静默回退**：resume 意图检测到当前项目无 🔄 任务时，禁止静默选取历史旧任务继续执行；必须明确告知用户当前状态并询问意图。
> ⚠️ **跨项目 resume**：无任务名的普通“继续/恢复”仍只读取当前项目的 `WorkspaceSessionRouteIndexV1` hint 与有界记忆；完整 `继续<任务名>任务` 可通过 workspace 派生索引有界 exact 定位。ambiguous、scale-blocked、completed/rejected 或 stale-confirmation 必须停止并给出最小下一步，禁止猜测、自动重开或恢复 mutation authority。

### TaskIdentity / TaskResolution 真相边界

新正式任务只能由 `memory_task_admit_v2` 基于不可变 `AdmissionIngressSnapshotV1`，在 `TaskAdmissionTransactionV1` 内同步 create-if-absent `<task-root>/.memory/task.json`（`TaskIdentityV2`：稳定 UUID `taskId`、`displayName`、去重 `aliases`、project、首次准入 root provenance、task kind/entry variant、相对任务路径与 digest），回读 canonical overview/问题概况和 CP pending，并在同一 MCP 调用内取得 fenced owner、finalize admission。CP 未确认时 owner 仍无 mutation authority；兼容分步调用只可消费短时、单用途、精确绑定的 `AdmissionContinuationLeaseV1`。`projectRootIdentityDigest` 是首次准入 provenance，不是永久磁盘位置 authority；实时项目 authority 只来自当前 `ProjectTargetLeaseV2`。工作区迁移后，只有完整 schema/core/`identityDigest` 验证通过且 `taskId + project + taskRootRelative` 相同、任务目录受当前 active-root containment 约束时才可重绑定；旧根 TaskRecovery 热态失效，当前根重新水合 hot state、admission 与 owner，禁止沿用旧 lease / BudgetCard / mutation authority，也不自动删除旧槽。status/CP 继续只由 sessions 与绑定 artifact digest 决定。legacy `TaskIdentityV1` 仅可读唯一解析；查询不得主动物化 identity，手工目录/mtime/模型摘要不得作为准入。派生 index 损坏、锁竞争或写预算达限时走 bounded rebuild/bypass，不得覆盖 canonical task/session。
结构化记忆投影必须携带可验证的 `ContentIdentityV1`；telemetry、wall clock 和调用身份不进入内容 digest。旧 `memory_session_read` / `memory_summary_read` 保持兼容，但 no-args 全文结果不是生产默认路径，也不能单独把 `ContextReadReceiptV2`（或兼容的 `ContextReadReceiptV1`）推进到 `relevant-complete/completed`。

### TaskRouteAdmissionRecoveryGate

- `ActualInstructionEnvelopeV1/WorkflowRouteDecisionV2`、`WorkspaceSessionRouteIndexV1` 与 `ProjectTargetLeaseV2` 只建立 instruction/route/project identity；它们本身不授 mutation/release。`memory_task_admit_v2` 默认原子取得 `FencedTaskWriteOwnerLeaseV2` 并 finalize admission；CP confirmation 后若 owner 的 CP observation 尚未刷新，调用 `memory_task_write_owner renew` 复证当前 exact CP。只有 finalized admission + exact CP + active owner 才形成正式 mutation authority。
- `SimpleTaskFastPathLeaseV1` 只能由 `memory_task_fast_path_lease` 签发，最多 2 个同一边界 exact 低风险路径、最多 2 次 create-or-update；正式产物、公共契约、控制面、安全、依赖、发布、跨模块或第 3 个路径必须在写入前升级正式准入。低风险叙述型 Markdown 可走 `dev.docs` 轻路径，配置/API/schema/security/release 文档不得借此绕过。
- 每次实际 mutation 使用一次性 `TaskOwnedMutationLeaseV2` 并在 V5 prewrite 后执行；Post actual effects 为 partial/unknown/越界、required effect 未发生或 tool failure 时写 `needs-reconcile`，禁止把退出码 0 当完成。
- `memory_task_terminal_v1` 必须回读 ECR/report/memory/completion 四类独立证据，成功后立即 terminal-unbind route/owner；Stop/PreCompact 只 checkpoint。显式 reopen 必须产生新 admission generation 与 owner nonce。

### MemoryFileTransactionGate

- `memory_session_allocate`、`memory_session_write`、`memory_summary_append` 与 CP 状态写入共用 `MemoryFileTransactionV1` owner；成功提交必须返回 `MemoryFileTransactionReceiptV1`，包含 before/after digest、final CAS、flush/directory durability、readback、bytesRead/bytesWritten/writeAmplificationRatio 与 metadata receipt。
- 这四类 Memory writer 是 server-owned 单一事务 Owner：Hook 继续校验实际指令、project/session route 与 PC0～PC10 产物时序，但不得再把逻辑 URI 纳入通用 artifact mutation prewrite/closeout/reconcile。`memory_workflow_operational_write_lease` 等 authority-control Tool 只签发或恢复后继工作流权威，不得自消费 artifact mutation authority。六宿主的 direct、下划线/连字符 MCP qualifier、slash 与双下划线名称必须归一到同一 server-owned leaf；第三方同名 Tool 不得豁免。
- 已存在 canonical 文件的纯 EOF 增长走 append fast path；创建走 atomic temp+rename，中段更新保留 rewrite。四类 writer 按 canonical physical active-root + target path 共用唯一锁键，并在最终写入窗口比较 source identity。CAS 冲突时返回 `MemoryTransactionConflictReceiptV2`；仅同一 `reconcileIdentity` 的纯操作可基于当前文件重算并有界重试一次，语义前置条件漂移或第二次冲突必须零覆盖失败。文件系统无法证明外部 writer 身份时必须标记 `UNVERIFIED`，不得猜测具体写入方。
- POSIX rewrite 保留 mode/uid/gid，新文件 mode=0600；Windows DACL 未执行真实 before/after probe 时必须明确 `WARN/UNVERIFIED`，不得用 POSIX mode 模拟 PASS。事务只清理由自己创建的临时文件。

### TaskRecoveryStoreV5

| 边界 | 行为 |
|------|------|
| 正式任务数量 | 无计数硬上限；不得按 owner/session 数裁剪需求或 Bug |
| hot A/B | task-keyed 稳定双槽；语义无变化返回 `semantic-noop`，普通 Hook/工具状态变化不新建 UUID generation 文件；容量判定、usage ledger 预充与任务槽实际落盘必须使用同一份紧凑 JSON 字节序列，禁止用格式化开销制造伪超限 |
| cold stub | 仅在 canonical truth 与安全 checkpoint 可重建时保存有界 resume stub；不删除 task docs、identity 或用户产物 |
| terminal | durable closeout 后立即解绑 live route/owner；grace 只读，安全到期只退休 V5 runtime cache |
| soft 256 MiB | terminal retirement → inactive hot coldify → 可重建 runtime stub 回收 |
| hard 512 MiB | bounded safe reclaim 后仍超限则拒绝新 admission/普通 mutation；read/recovery/terminal/abort/reconcile 继续 |
| 8 MiB closeout reserve | 仅 terminal/abort/reconcile；耗尽明确失败，不旁路普通 mutation |
| legacy | 只读保留；maintenance 不自动删除或迁移 |

V5 只保存 admission、fenced owner、mutation preflight/closeout、validation terminal 等有界恢复投影，不复制正文或大 stdout。容量字节预算不是任务数量上限，也不能授权删除正式任务产物。

### ArtifactLinkProjectionGate

- 新增本地 Markdown 关联前，先调用 `memory_artifact_link_project(operation: "project", documentPath, artifacts, linkCapability)`；`documentPath` 与每个 `targetPath` 都必须相对 active-root，目标必须是 canonical containment 校验通过的现存普通文件。投影固定返回 `ArtifactLinkProjectionSetV1`，按 canonical path 去重，从 `documentPath` 所在目录生成 `/` 分隔的相对 href；含空格的 href 使用 Markdown angle destination，禁止 `file://`、绝对路径 fallback 和越界/reparse traversal。
- `memory_session_write.artifacts[]`、`memory_summary_append.reportArtifact/memoryArtifact` 与 digest-bound `memory_cp_confirm` 由 writer 使用同一投影 owner：daily 自动生成“关联产物”块，SUMMARY 自动生成第 5/6 列，CP `artifactPath` 单元格生成相对链接；receipt 必须同时返回投影与 `validate-existing` 写后回读。`memory_cp_confirm` 缺少当前 `artifactPath + artifactSha256` 时必须返回 `MEMORY_CP_CONFIRMATION_UNBOUND`、零写入且不得生成伪 `✅`。legacy raw content/row 保持兼容，但其中新增的本地 Markdown 链接若不是从当前目标文档解析、目标不存在或越界，必须零写入失败。
- 手工/宿主 fallback 写入时，落盘前使用 `operation: "project"`，落盘后对同一 `{documentPath, artifacts, linkCapability}` 使用 `operation: "validate-existing"`；缺任一阶段不得声称链接交付完成。历史 active-root 文档只允许先做有界预览与问题清单，未经单独确认禁止批量回写旧链接。

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
- 新会话首步的 `memory_status` 与必要的有界 session/SUMMARY query 一致性检查（PC7）是 Context Rehydration Contract 的最低执行面，不得省略。
- compact / summary 恢复必须按 contextEpoch 重建计划，先查询精确 `ContextHandoffCard`，再按其 source-of-truth 定向复证；不能把压缩摘要或全文件重读当作捷径。同一 host session 的普通轮次变化只有在 `ContextSnapshotV1` 完全稳定时才可重新绑定 observation lease；compact/stale、跨 session 或 source drift 不得复用 handoff。

## ContextHandoffCard（记忆侧）

当任务跨会话、跨 Agent、多批次，或在 summary/compact 前、用户明确要求“传递上下文”、即将中断时，必须在 daily tasks 或报告中写入 `ContextHandoffCard`，用于把当前事实交给后续执行者：

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `source-of-truth` | ✅ | 当前可信文件、台账、报告、需求/bug 产物 |
| `confirmed-decisions` | ✅ | 已确认决策、CP/auto 状态 |
| `open-risks` | ✅ | 剩余风险、黄色偏离、未验证假设 |
| `next-action` | ✅ | 下一步动作、验证命令或恢复入口 |
| `blocked-reason` | 条件 | 阻塞时写明原因与所需输入 |
| `must-not-overwrite` | ✅ | 不得覆盖的用户变更、dirty 边界、不可删除项 |
| `validation-state` | ✅ | 已验证/失败/待验证证据 |
| `artifact-links` | ✅ | 报告、记忆、关键产物的 canonical identity；session/SUMMARY 默认 internal-only，用户面由 UserFacingArtifactSetV1 按需投影 |

`ContextHandoffCard` 只负责交接，不替代 Context Rehydration Contract；恢复方仍须按文件真相源优先级重新核对。

### HostCapabilityRoutingRef

命中 `host-capability-routing` 时，daily tasks、需求级 sessions、summary source 与 `ContextHandoffCard` 必须引用同一个 compact identity：`instructionRefId / decisionId / authority / digestStrength / selectedPortableDecision / nativeEligibility.status / fallback.reasonCode`。只保存 `OriginalInstructionRefV1.controlledSummary` 的 bounded projection，不复制完整用户原文、附件正文或 catalog row。

confirm、compact、resume、host/session/task 变化后必须重新核验 instruction authority；`compat/none`、仅 conversation-visible、readback 未验证或 digest mismatch 均不能单独授权跨轮 mutation。应优先回绑 digest-bound CP/task artifact；无法回绑时停止 mutation，并请求重述或重新确认。Agent `SUMMARY.md` 仍只保存索引，不写这些字段的自由文本副本。

## 触发规则

| 时机 | 必须动作 |
|------|---------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮用户消息 | 追加对话记录到 📨 字段 |
| 子任务完成（多任务会话）| 追加 `T{N}进度：✅` |
| 超 13 轮预警（C08）| 写入编码检查点（📦 字段）|
| 报告写入后 | 追加报告路径到 📄 关联报告 |
| 跨会话 / compact / handoff | 写入 `ContextHandoffCard` 到 daily tasks 或报告 |
| Host capability decision | 追加 compact `HostCapabilityRoutingRef`；禁止复制原文/catalog |
| 正式任务准入/owner 变化 | 追加 compact `TaskRouteRecoveryRef`，只记录 digest/ID/status；禁止复制 Envelope、journal 或 V5 正文 |
| 完成回复前 | 确保 📨 对话记录已追加本轮 |
| 正式任务结束 | `memory_task_terminal_v1` 四证据 closeout 与 route/owner unbind 成功后更新状态为 ✅；失败保持 🔄/needs-reconcile |

## 新会话 🔄 检测

新会话开始时用 `memory_status` 检查今日/昨日 metadata、有限 SUMMARY 行与状态冲突；仅发现 active / unresolved 候选时再用 `memory_session_query` 取对应片段：
- 有 🔄 → 输出提示：`⚠️ 上次存在未完成任务：[简述]，建议先 resume`
- 用户说"继续"/"恢复" + 存在 🔄 → 判定为 `resume`

## 新会话首步强制（v1.9.4+，hook 强制 + AI 兜底）

> 🔴 **不可跳过**：本步骤直接对应 PC7（详见 [`17-compliance.instructions.md`](./17-compliance.instructions.md) §PC7）和 18-spec-radar §G10 limit 截断恢复触发场景，防止 session limit 截断后 AI 不走 resume 路径而错误新建工作流。

收到首条用户消息时（无论用户措辞），AI 必须：

1. 调用 `memory_status(limit <= 5)`，记录目标 project/scope/actual agent 与 Post 成功回执。
2. 对 active / unresolved 候选调用 `memory_session_query(limit: 1)`，检测对应 `## 会话 NN` 状态：
   | 状态 | 路由 |
   |------|------|
   | 显式 `状态: ✅` | 正常走意图识别 |
   | 显式 `状态: 🔄` | 触发 resume 提示，建议用户确认是否继续上次任务 |
   | 状态字段缺失 / `## 会话 NN` 标题后段落内容不完整 | 触发 ⚠️ "可能 limit 截断"报警，提示用户确认 |
3. 使用 status 返回的有限 SUMMARY 投影或 `memory_summary_query(limit <= 5)` 对比一致性：
   - SUMMARY 最末行状态 ✅ + tasks 对应段落实际未完成（缺 `状态: ✅` 或段落明显残缺）→ 🔴 数据不一致报警
4. **仅本步通过后才进入** cp-gate / 工作流路由判定

> ⚠️ **触发判定不依赖用户措辞**："继续任务"/"接着做"/"开始干"/"我来了" 等含糊或明确措辞均不影响 — 本步骤是 hook 强制 + AI 自检兜底。

> ⛔ **禁止**：直接按首条消息路由而不执行有界状态检查；也禁止用该门禁为默认读取完整 tasks / SUMMARY 辩护。违反即触发 G10 VL 标记。

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
```text
<active-root>/.memory/clients/<agent>/SUMMARY.md
```
- 每次会话结束前追加一行索引（SC6 检查）
- 格式：`| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |`
- **SummaryTypeCanonGate**：`类型` 仅允许 `dev|fix|analyze|audit|self-fix|chat|resume|other`，多意图用 `+`；禁止 `/` 与自由标签；MCP `memory_summary_append` 硬拒写（见 `scripts/lib/summary-type-canon.js`）
- 多任务会话：一行覆盖全部任务，不拆多行
- 🔴 **纯索引约束**：SUMMARY 仅含表头 + 会话索引行，禁止添加自由文本段落（如"当前状态""关键决策"等非索引内容）；🔄 状态标记仅出现在索引表「状态」列；已有旧格式 SUMMARY 应在下次写入时迁移

### 全局 SUMMARY（项目共用）
```text
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
