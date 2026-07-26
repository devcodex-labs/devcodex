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

## 报告索引导航

需要按任务、日期或类别发现历史报告时，优先使用
`scripts/lib/report-index.js#queryReportIndex` 的 metadata/pointer 结果，禁止先把整个
report corpus 正文装入上下文。该索引不改变报告 Markdown 真相源，也不新增
CLI/MCP surface。

- discovery 只允许 `<active-root>/reports/**` 与
  `<active-root>/{requirements,bugs,optimizations,scenario-tests}/<task>/reports/**`。
- 默认只返回 `primary-report`；`evidence`、`artifact`、`generated-copy` 与
  `unknown` 只有显式筛选时才返回，unknown 必须保留 warning。
- `fresh` 索引可用于 metadata 导航；pointer 损坏、陈旧或出现未登记文件时，
  只做内存中的 path/stat reconcile 并标记 `fallback`，不得隐式写索引。
- 多页宽查询使用返回的 `snapshotCursor` / `snapshotCursorEncoded` 绑定 immutable
  manifest，下一页同时传 `nextPointer.offset`；旧 offset-only 查询继续兼容。
- 正文只能在选定具体 pointer 后通过 `hydrateReportEntry` 或
  `hydrateReportEntries` 有界读取；截断正文只能声明 `metadata-reconciled`，不得
  声明全文内容已验证。metadata-only 场景可用 `projection: "compact"` 返回瘦身
  字段。
- 只有显式维护/benchmark 路径可调用 `rebuildReportIndex`；查询、resume、ECR
  和普通报告写入必须保持 zero-write。

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
- 新增或改变 Rule/Skill、Prompt、MCP Resource/Resource Template/Tool、Task 增强 Tool、CLI 或 Hook 时写 `CapabilitySurfaceDecision`：只引用中央 `decisionRef / status / identity / preferredSurface / validationRoute` 和 Owner 证据，不复制判定矩阵；缺失或陈旧时报告必须降级为 `BLOCK/UNVERIFIED`。
- 命中 `host-capability-routing` 时，在既有治理证据或 handoff 中追加 compact `HostCapabilityRoutingRef`：`instructionRefId / decisionId / catalogVersion+digest / selectedPortableDecision / nativeEligibility.status / fallback.reasonCode`。不得复制原始消息或 catalog row；portable `plan_first` 不得写成 native Plan 已进入，宿主 approval/permission/YOLO mode 不得写成 CP/Auto。
- 所有非空用户消息保留 `GovernanceIntakeDecision`；未命中台账写入时也要给出独立 `skipEvidence`。
- 命中 `requirementParallelOrchestration` 时写并行编排摘要：`RequirementIndependenceDecisionV1` 分类、`SharedSurfaceLockMapV1` 锁、`ParallelLaunchCardV1` 有效性、汇合协议、单写者和未关闭风险；报告不得把子会话完成冒充最终完成。
- 命中 `agent-turn-liveness` 时写 `TurnLivenessRecovery`：只引用 Owner 的状态/lease/ACK/terminal/checkpoint、HostContractRoute、fault matrix 与 sidecar lifecycle 证据；必须区分 host-native、Hook-event 和 sidecar，不能把 PostToolUse 落盘冒充模型续接或终态。
- 命中增量项目分析时写 `ProjectKnowledge`：只记录 V2 snapshot/plan/receipt/binding identity、inventory Merkle、changed/affected/lens-gap/reused、5% oracle、claim authority/range 验证、V1 read-only migration 状态、batch accepted pointer 与 final/provisional 边界，禁止把快照或声明正文复制到报告或 SUMMARY；结构化 bootstrap 不得表述为人工逐文件深读。
- 命中 formal retry/cancel/restart 时写 `ExecutionAttemptLedger`：分列 qualification、failureSignature、source/evidence delta、FirstPassYield、command/external/user/model timing、StopSnapshot 与 terminal/finalizer；不得把等待时间混成执行性能。
- 任何 repair task 写 `RepairPreventionAssessment`：引用 Owner 的 assessment identity/decision/mode，分列 `immediateClosureEvidence` 与 `prospectiveEvidencePlan`，并记录 rollback/sunset；不得用本次测试通过宣称长期 prevention effective。
- 正式复审/ECR 写 `ReviewExecution`：引用 `ReviewExecutionPlanV1`、fresh receipt digests、EvidenceSaturation、唯一 `ReviewStateSnapshotV1.snapshotDigest` 与 `StageTimingV1`；报告不得重新推导 review counts 或把 failed/inconclusive receipt 写成可复用。

最终回复是独立交付 surface：报告必须先登记到 `ArtifactDeliveryManifestV1`，再由 `UserFacingArtifactSetV1` 投影。默认用户面显示最终报告、直接交付物和 required evidence；session/daily/SUMMARY/task/checkpoint/raw receipt/manifest/ledger 默认 internal-only，但仍写入并参与 ECR。可见回复证据使用 `verified-present / verified-missing / unverified`，legacy 文本最多 `unverified-legacy`，不可观察时不得断言缺失。

## 输出规则

- 每次会话必须写入报告文件（**chat 豁免**，[C05/S05](../../instructions/00-safety.instructions.md)）
- 报告中每条建议/问题必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围）— 与 [`17-compliance`](../compliance/SKILL.md) §1 输出验证保持一致
- **MeasuredVerificationStandard（V84 / SC14）**：报告中凡将 validate、targeted test、`npm run test:core` / `npm test`、性能数字或命令输出标为 `✅已验证`，必须写生产入口命令与 exitCode；自写隔离 harness 或未复用 `validate.js` 的 `createCanonicalAwareReader` 时只能标 `非权威实验` / `⚠️待验证(生产路径)`，不得写成「V# 失败/通过」或「今日 core 红/绿」。用户可见摘要须分列权威路径与实验路径，完成态最终回复还必须投影 `FinalValidationSummaryV1` 或等价短矩阵。
- **EvidenceFreshness**：报告、分析、审查、推荐结论、CP 可确认声明、外部 finding 采纳和完成态强声明命中 `evidence-freshness` gateGroup 时，必须记录 `ClaimEvidenceIndexV1`、`EvidenceFreshnessReceiptV1` 或 `StaleEvidenceLintDecisionV1` 摘要。memory/SUMMARY/历史报告/外部审查文字只能作为 `summary-only` / navigation hint；缺 fresh evidence 的强主张必须降级为 `WARN/UNVERIFIED` 或在 enforce 场景阻断。机器实现：`scripts/lib/evidence-freshness-receipt.js`；生产入口：`npm run test:evidence-freshness`。
- **ExternalReviewClaimVerificationGate（PF-164）**：对外部/他 Agent 审阅的复核报告必须含 `inputClaims`、`ClaimVerificationMatrix`、项目证据、验证状态、disposition、`unverifiedBoundaries` 与可点击详细报告链接；只写总评或建议视为不合格。Owner 细节见 `audit-report`；机器分类见 `scripts/lib/external-review-claim-verification.js`。
- **RequiredCandidateEvidenceGate**：dev/fix 报告若覆盖 CP1/CP2 候选或确认前复审，必须记录 CandidateReviewBundleV1 分类、缺失字段、阻断快照和相关命令（如 `npm run test:candidate-review-bundle`）。外部审查发现只通过 `EscapeAbsorptionQueue` / ClaimVerificationMatrix / 本地证据进入结论，禁止直接吸纳。
- **OptimizationEvidenceFamily（PF-168/169/170）**：
  - 优化需求/方案问题表：须证据等级 A/B/C + 可复现命令；未验证不得写「完整必须优化清单」（`classifyOptimizationBacklogEvidenceSample`）
  - 非 chat 方案审阅/深度分析：须落 `reports/**` 并给可点击链接；禁止仅对话长文宣称分析完成（`classifyAnalysisArtifactDeliverySample`）
  - 残留可优化清单：须证据等级 + 预期收益/影响风险/前置条件（`classifyResidualOptimizationListSample`）
  - 机器实现：`scripts/lib/optimization-backlog-evidence.js`
- 命中专家产物、用户操作说明、重要方案或推荐结论时，报告必须引用 `ExpertOutputQualityGate`、`OperationExplanationContractV1`、`CodeTruthEvidenceMatrixGate`、`SolutionFitAgainstRepoGate` 与唯一推荐证据；不得只写“已优化表述”或用文档自洽替代 repo 事实。
- analyze / audit / self-fix / dev / fix 报告中，若出现多个可执行建议、多个后续路径、方案对比或用户决策点，必须新增 `## 推荐结论` 或 `## 推荐方案`：推荐项有且仅有 1 个，并说明“推荐理由”；无后续动作时写 `推荐：无后续动作` 与原因
- **UniqueNextStepRecommendationGate（PF-172 / SC5）**：完成态 / 收口的 `## 后续建议` 与用户可见「下一步」必须是 **唯一主动作**。禁止写成「做 A 或做 B」或同级双 bullet 让用户再选；非推荐路径只能写在「不推荐」小节并说明劣于推荐的理由。机器负向：`scripts/lib/discipline-execution-probe.js` 的 `classifyNextStepOrForkSample`（`or-fork` = fail）
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
- **CompletionEvidenceGate**：dev/fix/self-fix 宣告「已完成 / 已收口」前，报告必须同时具备：① ECR 矩阵或显式 N/A 理由；② 适用时的 WorkspaceSyncStatus；③ 测试/validate 关键证据或阻塞说明；④ dirty 边界说明；⑤ 存在派生资产时的 `PostStageDerivedArtifactFreshnessGate` staged candidate receipt 与 post-commit clean-tree replay。最终回复必须以 `FinalValidationSummaryV1` 短矩阵列出命令/exitCode、runId 或关键计数、workspace sync、dirty boundary、release action boundary；缺任一适用项不得写「已完成」
- **PostDeliverySelfCheck（条件）**：长任务结束、宣称完成、或用户质疑慢/漏/不专业时，最终回复前轻量自检：耗时分列是否诚实、完成证据是否齐全、是否越界宣称「完整/零遗漏」、可泛化改进是否已走 Improvement Intake。纯 chat / 中间进度可 N/A。**禁止**每条短回复强制全量打分写 PI
- **最终确认清单 / 可吸纳包 / 实施 backlog**（analyze 收敛交付）必须附 `FindingThemeCoverageMatrix`（ABS-17）：每行 `sourceId → mappedTo | residualId | EX | disposition`；禁止仅用主题合并清单宣称「完整/零遗漏」；用户确认主题包后若有 residual，状态标 `partial-confirmed` 并列出 residual pack。命中规范吸纳时必须同时附 **`SourceExistenceVerificationGate` 证据**、**ProbeNecessity / enforcementLevel**（回答「不按流程谁会红」）与并列 **可关账清单**；禁止只按台账 `open/pending absorption` 输出 absorb；禁止 checklist-only 假吸纳
- `dev` / `fix` 报告的 ECR 必须核对本轮真实触发的条件产物、TestRoute、Owner 证据、进度/记忆/台账、部署同步和 dirty 边界；未触发项按 schema 写 `N/A + skipReason`
- 方案/复审阶段出现 blocker 时，报告必须引用完整 `BlockerSnapshot`；同阶段安全独立检查未执行时记录 `stopReason / skippedChecks / recoveryEntry`，不得只报告首个红项后声称该阶段已完整审查
- 报告宣称“不再依赖其他模型审查 / 审查质量已内化”时，必须列出需求候选、技术方案候选、CP gate、复审清单、脚本探针和宿主投影的同步证据；仅改 Prompt 或仅跑外部报告复核不够。
- backlog intake、治理落账、规范吸纳、历史分层、用户建议采纳、跨会话恢复、Profile、发布、安全审查或专家 Owner 等条件语义，统一从 `report-schema.json` 与 `../spec-governance/gate-registry.json` 生成对应段；报告只记录 `gateGroup / result / evidence / skipReason` 并链接 Owner 产物
- 命中 `evidence-freshness` 时追加 `EvidenceFreshness` 条件段：记录 `mode`、`status`、strong claim count、`downgradeRequired`、`rerunRequired`、summary-only 边界、artifact anchor / final validation summary binding 与生产入口命令 exitCode；不复制 receipt 全文
- 任何条件段都不得复制版本化 Gate/Owner 名录；新增能力先更新 registry/schema、Owner 与验证探针，再由报告消费者引用
- 报告涉及规范源、Skill、Hook、CLI、MCP、模板、部署副本、路径规则或 validate 语义变更时，仍需列出 SCV-0~SCV-7 证据；外部 finding intake 不得把报告结论当作已验证事实
- 控制面报告若出现新增探针、黄色偏离或部署同步，必须单独写出部署同步证据与其他证据来源，不能只在摘要里带过
- 报告末尾引用本次会话记忆路径
- 回复末尾由 `user-visible-output-contract` 输出“完成交付文件”：每项使用语义 displayName、purposeText、userAction，并强制 **路径列**（默认 workspace-relative portable，见 PF-175 路径列规则），按 decision→result→evidence→optional 顺序。`ArtifactLinkSet` 只作兼容投影；Rich clickable 不在路径列外重复 `绝对路径：` 行，只有用户要求、链接失败、工作区外、歧义或无法定位时路径列/fallback 用绝对路径（详见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md)）
- **Dialogue-Primary Closeout（对话内可读收口）**：完成态 / analyze·audit 收敛的**阅读主入口是最终回复**，不是打开报告源码。最终回复须含叙事最小包（结果一句话 + ≥1 实质要点）+（完成态）`FinalValidationSummary` + 唯一步 + 交付清单；报告仍强制落盘（chat 豁免）。禁止仅链接/`详见报告`/纯矩阵收口；analyze 有报告链接但无可读结论 → `link-only-thin`（`classifyAnalysisArtifactDeliverySample`）。userAction 默认「深读时打开归档报告」，禁止默认「请用 Typora/浏览器预览」。机检：`classifyDialogueNarrativeSample` / `hasReadableNarrativeSnippet`

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
