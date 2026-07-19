---
name: report
description: 生成并写入工作流执行报告。适用于 dev/fix/analyze/audit/self-fix（chat 豁免）。
---
跨工作流稳定字段、条件段和 workflow overlay 的机器可读唯一事实源为同目录 `report-schema.json`。本 Skill 负责生成流程和人读解释；Gate 结果只记录 `gateGroup / result / evidence / skipReason`，不得在报告模板复制完整 Gate 目录。

## 报告路径

### 需求级（优先）

任务关联到 `requirements/` · `bugs/` · `optimizations/` 目录时：
```text
<任务目录>/reports/<agent>/YYYYMMDD/NN--<简述>.md
```

### 项目级（兜底）

```text
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

| 工作流 | 默认子目录 |
|--------|:----------:|
| dev | `requirements/` |
| dev (optimization) | `optimizations/` |
| dev (scenario-test) | `scenario-tests/` |
| fix | `bugs/` |
| analyze | `analysis/` |
| audit | `audit/` |
| self-fix | `self-fix/` |

> 路径详细规范见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md)。
> 当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，本文中的任务目录与项目级 `reports/...` 均以当前 **`<active-root>`** 为根。

## 头部必填

```markdown
# [标题]

> **项目**: [项目名]
> **类型**: [类型]
> **子类型**: [子类型]（无子类型时省略此行）
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: [agent-id]
> **状态**: 进行中 / 已完成
```

## 命名规则

| 组件 | 规则 |
|------|------|
| `NN` | 当日序号，从 `01` 起递增（扫描同目录取 max+1）|
| `--` | **双横杠**（非单横杠），分隔序号与简述（[FC4](../compliance/SKILL.md) 检查） |
| `<简述>` | 2~5 个中文词或英文单词，连字符分隔 |

示例：`01--v4规范全面审查.md`、`02--intent修复后再审.md`

## 工作流 overlay 与条件段

跨工作流稳定字段、条件段和各 workflow overlay 的机器可读事实源为同目录 `report-schema.json`。生成报告时先写 `baseFields`，再按最终 workflow 合并一个 overlay；不得在本 Skill、Prompt 或模板中复制完整 Gate 目录。

| workflow | overlay 重点 |
|----------|--------------|
| `dev` / `fix` | 需求或问题追踪、实现/根因、TestRoute、文档同步；repair task 追加双层修复协作与零残留扫描 |
| `audit` / `analyze` | 覆盖声明、轮次、CRS、PCV、推断边界与未读集合 |
| `optimization` | baseline、candidate、归因和回归预算 |
| `scenario-test` | 场景矩阵、环境、服务生命周期清理和结果 |

报告触发治理 Gate 时，读取 `../spec-governance/gate-registry.json` 确认 `gateGroup` 与 Owner Skill，只记录 `gateGroup / result / evidence / skipReason`。Gate 的专属字段、完整证据和验证路线归目标 Owner Skill；报告通过链接引用，不复制成跨版本长表。

条件段按 `report-schema.json#conditionalSections` 生成：

- 跨会话、多批次、中断或残余风险未关闭时写 `ContextHandoffCard`。
- dev/fix 改变项目现实且命中 Profile 影响时写 `ProfileImpactCheck`。
- 只有正式 release workflow 才写 `ReleaseVerification`。
- 所有非空用户消息保留 `GovernanceIntakeDecision`；未命中台账写入时也要给出独立 `skipEvidence`。
- 命中 `agent-turn-liveness` 时写 `TurnLivenessRecovery`：只引用 Owner 的状态/lease/ACK/terminal/checkpoint、HostContractRoute、fault matrix 与 sidecar lifecycle 证据；必须区分 host-native、Hook-event 和 sidecar，不能把 PostToolUse 落盘冒充模型续接或终态。
- 命中增量项目分析时写 `ProjectKnowledge`：只记录 snapshot/plan/receipt identity、changed/affected/lens-gap/reused、5% oracle、batch accepted pointer 与 final/provisional 边界，禁止把快照正文复制到报告或 SUMMARY。
- 命中 formal retry/cancel/restart 时写 `ExecutionAttemptLedger`：分列 qualification、failureSignature、source/evidence delta、FirstPassYield、command/external/user/model timing、StopSnapshot 与 terminal/finalizer；不得把等待时间混成执行性能。

最终回复是独立交付 surface：在“本次会话产物”中列 active task 主要产物；supporting/runtime 产物按组给数量和完整 manifest 入口。可见回复证据使用 `verified-present / verified-missing / unverified`，不可观察时不得断言缺失。

## 输出规则

- 每次会话必须写入报告文件（**chat 豁免**，[C05/S05](../../instructions/00-safety.instructions.md)）
- 报告中每条建议/问题必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围）— 与 [`17-compliance`](../compliance/SKILL.md) §1 输出验证保持一致
- analyze / audit / self-fix / dev / fix 报告中，若出现多个可执行建议、多个后续路径、方案对比或用户决策点，必须新增 `## 推荐结论` 或 `## 推荐方案`：推荐项有且仅有 1 个，并说明“推荐理由”；无后续动作时写 `推荐：无后续动作` 与原因
- 若最终采纳的是用户原始方案，报告中也必须写明“经独立验证后采纳”及其证据来源，避免形成“顺从结论”的假象
- 报告中的治理落账编号必须与当前 active-root 台账和 Hook/人工复证一致；不能仅因正文出现 `PI/PF/VL/GR/ISSUE` 编号就写“已记录”。复合意图逐项列证据，`record.none` 列独立 challenge evidence。
- audit / analyze / self-fix 的汇总型报告默认采用“两层问题清单”：先列根因级问题，再展开逐文件完整落点；边界/非缺陷结论单独成节，不混入缺陷编号
- 报告写入后必须执行 [`compliance`](../compliance/SKILL.md) Skill §5 二次验证（V1~V6）
- `dev` / `fix` 报告在最终宣告完成前，必须显式体现“ECR 执行闭环复审”这一正式阶段，并与 CP1/CP2/CP3、关键产物、报告、daily tasks、SUMMARY、diff/commit、测试/扫描证据和 dirty 边界完成 1 轮复审对照；若发现阻断性问题，不得直接以“已完成”收尾
- 跨会话、跨 Agent、多批次、summary/compact 前、用户要求“传递上下文”或未完成任务的报告必须包含 `ContextHandoffCard`；已完成且无需交接时写 `ContextHandoffCard: N/A + skipReason`
- 主动建议或 C08 强制新会话时，最终回复与报告须含 `NewSessionContinuationCard`；内部字段保留 taskId/项目/CP/真相源/风险/验证，用户可复制的 `copyReadyPrompt` 固定为 `继续<displayName>任务`。CP pending 不得写成 confirmed，resolver 命中也不得替代文件复水化
- 长任务报告附录推荐 `SessionTimingCard`（startedAt/endedAt、阶段耗时、waiting-user / waiting-external 分列；命中预算时附 cycleId 与 budget 消耗）
- 长任务 / Auto / 多批次报告条件段：`ExecutionBudget`（maxWallClock 与触顶 StopSnapshot）、`ExternalWaitAccounting`、`LongTaskAuthorization`（PI-118 / PF-137）；未触发写 `N/A + skipReason`
- **WorkspaceSyncStatus（PI-109 / PF-129）**：凡改规范源 / Skill / 部署消费者 / Profile 部署面，最终回复与报告必须写 `workspaceRoot`、`updateCommand`、`hostsSynced`（如 `.github`/`.claude`/`.agents`/`.codex`/`AGENTS.md`）、`result`（synced / skipped+reason / blocked）、`evidence`；禁止只写「源码已改」却不说明工作区部署是否同步
- **CompletionEvidenceGate**：dev/fix/self-fix 宣告「已完成 / 已收口」前，报告必须同时具备：① ECR 矩阵或显式 N/A 理由；② 适用时的 WorkspaceSyncStatus；③ 测试/validate 关键证据或阻塞说明；④ dirty 边界说明；⑤ 存在派生资产时的 `PostStageDerivedArtifactFreshnessGate` staged candidate receipt 与 post-commit clean-tree replay。缺任一适用项不得写「已完成」
- **PostDeliverySelfCheck（条件）**：长任务结束、宣称完成、或用户质疑慢/漏/不专业时，最终回复前轻量自检：耗时分列是否诚实、完成证据是否齐全、是否越界宣称「完整/零遗漏」、可泛化改进是否已走 Improvement Intake。纯 chat / 中间进度可 N/A。**禁止**每条短回复强制全量打分写 PI
- **最终确认清单 / 可吸纳包 / 实施 backlog**（analyze 收敛交付）必须附 `FindingThemeCoverageMatrix`（ABS-17）：每行 `sourceId → mappedTo | residualId | EX | disposition`；禁止仅用主题合并清单宣称「完整/零遗漏」；用户确认主题包后若有 residual，状态标 `partial-confirmed` 并列出 residual pack
- `dev` / `fix` 报告的 ECR 必须核对本轮真实触发的条件产物、TestRoute、Owner 证据、进度/记忆/台账、部署同步和 dirty 边界；未触发项按 schema 写 `N/A + skipReason`
- 方案/复审阶段出现 blocker 时，报告必须引用完整 `BlockerSnapshot`；同阶段安全独立检查未执行时记录 `stopReason / skippedChecks / recoveryEntry`，不得只报告首个红项后声称该阶段已完整审查
- backlog intake、治理落账、规范吸纳、历史分层、用户建议采纳、跨会话恢复、Profile、发布、安全审查或专家 Owner 等条件语义，统一从 `report-schema.json` 与 `../spec-governance/gate-registry.json` 生成对应段；报告只记录 `gateGroup / result / evidence / skipReason` 并链接 Owner 产物
- 任何条件段都不得复制版本化 Gate/Owner 名录；新增能力先更新 registry/schema、Owner 与验证探针，再由报告消费者引用
- 报告涉及规范源、Skill、Hook、CLI、MCP、模板、部署副本、路径规则或 validate 语义变更时，仍需列出 SCV-0~SCV-7 证据；外部 finding intake 不得把报告结论当作已验证事实
- 控制面报告若出现新增探针、黄色偏离或部署同步，必须单独写出部署同步证据与其他证据来源，不能只在摘要里带过
- 报告末尾引用本次会话记忆路径
- 回复末尾必须输出产物文件路径（按 `ArtifactLinkSet` 输出主 Markdown 链接；当前宿主为 Codex Desktop/App、Copilot、未知宿主或用户反馈无法点击时，追加 `绝对路径：` copy fallback；输出前执行 `ArtifactLinkSetDedupeGate`，按规范化绝对路径去重同一物理文件，详见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md) §产物路径输出格式，[FC5](../compliance/SKILL.md)）

## 行数与拆分

- [C13](../../instructions/01-common.instructions.md) 只约束新建 DevCodex 规范资产 `.md`；报告不因 C13 强制压缩或拆分，超长报告按可读性、索引导航和项目规范决定是否拆分

## 写入工具选择（v1.9.4+）

新建报告预计 ≥ 200 行 → **Write 单次写入**（避免 Edit 多段写入被 session limit 截断；详见 [`16-report.instructions.md §写入工具选择`](../../instructions/16-report.instructions.md)）。已有报告小修订 → Edit。

## 跨会话报告

| 场景 | 处理 |
|------|------|
| 同一任务跨多会话 | 每次会话创建**独立报告文件**，不追加到前一份 |
| 修复后再审 | 独立文件，头部引用原始审查报告路径 |
| Token 中断恢复 | 新报告标注"恢复自会话 NN" |

> ⚠️ `dev` / `fix` 的“修复后再审/再次实施”并不自动等于收敛；仍须满足 ECR 执行闭环复审规则，确认最后一次阻断性修正后已有 1 轮无新增阻断问题的复审。

## 模板引用

| 报告类型 | 模板 |
|---------|------|
| 分析报告 | `prompts/report-analysis.prompt.md` |
| 审查报告 | `prompts/report-audit.prompt.md` |
| 规范自修复报告 | `prompts/report-audit.prompt.md`（结构相同，路径映射 `self-fix/`）|
| 开发报告 | `prompts/report-dev.prompt.md` |
| 开发报告（性能优化） | `prompts/report-optimization.prompt.md` |
| 开发报告（场景测试） | `prompts/report-scenario-test.prompt.md` |
| 修复报告 | `prompts/report-fix.prompt.md` |
