---
name: execution-contract
description: 执行契约规范 — 为长流程、多文件、Auto 或控制面任务生成/校验 ExecutionContract，约束范围、路径、产物、验证路线、偏离分级与恢复策略
---
# Execution Contract Skill

## 职责

在任务进入执行前，为需要强边界的工作生成或校验 ExecutionContract。它不是新的工作流子类型，而是 dev/fix/auto/release 等流程可调用的支撑型 Skill。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| Auto 执行模式 | 🔴 必须 |
| 控制面 / 规范源 / 模板 / validate / 部署副本变更 | 🔴 必须 |
| 预计修改 ≥10 文件或多批次执行 | 🔴 必须 |
| 涉及发布、tag、publish、registry 后验收 | 🔴 必须 |
| 普通单文件文档小修 | N/A |

## Contract 字段

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `scope` | ✅ | 本次任务目标、排除范围和禁止事项 |
| `allowedFirstBatch` | 条件 | dev/fix 执行前必填；本批允许立即修改的功能、文件、公开面和验证动作 |
| `blockedScope` | 条件 | dev/fix 执行前必填；明确排除的后续阶段能力、非目标文件、禁止扩散面和 No-Go |
| `allowedPaths` | ✅ | 允许修改的路径集合；Auto 不得仅依赖静态白名单 |
| `parallelLaunchCards` | 条件 | 多需求/子 Agent/worktree 执行前必填；引用 `requirement-parallel-orchestration` 的 `RequirementIndependenceDecisionV1`、`ParallelLaunchCardV1`、`SharedSurfaceLockMapV1` 和 `IntegrationMergeProtocolV1` |
| `requiredArtifacts` | ✅ | 必须产出的需求、方案、计划、进度、报告、测试、changelog 等 |
| `consumerScope` | 条件 | 控制面 / 模板-示例-校验链任务必填；列出 `sourceOfTruth`、`currentConsumers`、`historicalMirrors`、`validateProbes`、`deployCopies` |
| `backlogTruthReview` | 条件 | 当任务/批次直接来源于 `data/*.md` open/partial 项时必填；列出 `candidateIds`、`classification`、`evidence`、`scopeDelta` |
| `validationRoute` | ✅ | 引用 `test-router`、`audit-release`、`release-verification` 或当前 CP3 验证矩阵 |
| `regressionMatrix` | 条件 | 高风险控制面 / 多批次修复必填；列出“历史能力 → 受影响批次 → 必跑验证 → 失败回滚点” |
| `verificationEvidence` | 条件 | 宿主验证或控制面任务必填；记录 validate、targeted tests、fixture/direct replay、部署同步、VisibleEnvelope/UserFacingArtifactSet/LinkCapability、MCP fallback 等证据计划 |
| `ledgerWriteback` | 条件 | 当本轮会改变 VL/PF/PI/ISSUE/GAP 的状态时必填；列出 `targetLedgers`、`requiredFields`、`writebackEvidence`、`rescanResult` |
| `deviationPolicy` | ✅ | 绿色/黄色/红色偏离分级与处理方式 |
| `driftTriggers` | 条件 | `DevelopmentDriftGate` 触发器：范围扩张、包/API/配置/文档消费者变化、新依赖、验证路线改变、dirty 污染或用户新确认 |
| `deviationLog` | 条件 | 多批次或发生绿色/黄色偏离时，记录实际新增消费者、探针、同步副本与理由 |
| `rollbackPlan` | ✅ | 失败恢复路径、回滚锚点或重新确认条件 |
| `progressArtifact` | 条件 | 多批次、预计 ≥10 文件、跨轮次或用户要求持续跟踪时必须写 `05-实施进度.md` |
| `safetyInterruptionRecovery` | 条件 | 授权本地安全审查出现宿主安全提示/内容不可见时，引用 `AuthorizedLocalSecurityAuditPresentationGate` 的 SafetyInterruptionCard、last checkpoint 与 resume evidence |
| `publisherCredentialTopology` | 条件 | 首次发布或发布身份/仓库/package/registry/auth topology 变化时，引用 `PublisherCredentialTopologyGate`；只记录身份、scope/access/permission/ownership/成功证据，不含 secret value |
| `currentBatchScopeDiff` | 条件 | 多阶段/多批次 dev/fix 必填；比较 total phase scope、allowedFirstBatch、当前 batch、blockedScope 与本次 diff |
| `validationConsumerRebind` | 条件 | 新增 root script、CI job、validator、deploy copy 或 consumer 时必填；把 allowedPaths、TestRoute、rollback 与 consumerScope 重新绑定 |
| `derivedArtifactFreshness` | 条件 | 派生资产受 tracked/staged consumer、模板、索引或生成顺序影响时必填；绑定 Owner Gate、生成输入 identity、post-stage candidate check 与 post-commit replay |
| `turnLivenessContract` | 条件 | 长任务、工具完成后无续接、宿主停滞或跨轮次恢复时必填；引用 `ai-agent-system-architecture` 的状态/lease/ACK/terminal/checkpoint、CheckpointValidation 与 LocalTaskTrace 契约及能力边界 |
| `executionBudget` | 条件 | Auto、多批次、预计 ≥10 文件、C08 恢复、用户反馈「太慢/卡/文件太多」、或 resume 长任务时必填；见 `ExecutionBudgetGate` |
| `executionAttemptLedger` | 条件 | formal command、失败重试、取消/中断或 restart 时必填；作为既有 TurnLiveness state 的 `ExecutionAttemptLedgerV1` 子状态，不得新建平行状态机 |
| `longTaskAuthorization` | 条件 | 与 `executionBudget` 同触发；记录授权证据与 cycle 身份，见 `LongTaskAuthorizationGate` |
| `externalWaitAccounting` | 条件 | 存在 CP 等待、CI/鉴权/人工审批/外部系统等待时必填；见 `ExternalWaitAccountingGate` |

## ExecutionBudgetGate / ExternalWaitAccountingGate / LongTaskAuthorizationGate（PI-118 / PF-137）

长任务不得只依赖事后 `SessionTimingCard` 或 C08 轮次阈值。命中 Auto、多批次、预计 ≥10 文件、C08 恢复、用户反馈「太慢/卡/文件太多」、跨会话 resume 同一长任务时，必须冻结 **墙钟预算 + 外部等待会计 + 长任务授权**。

### ExecutionBudgetGate（墙钟预算 / 事中熔断）

| 字段 | 要求 |
|------|------|
| `cycleId` | 当前恢复周期唯一 ID；禁止与已关闭 cycle 复用 |
| `startedAt` | ISO 墙钟起点 |
| `maxWallClock` | 本 cycle 最大执行墙钟（不含 external wait） |
| `maxWorkUnits` | 本 cycle 最大 WorkUnit 数 |
| `maxDirtyDelta` | 允许新增的源码/配置 status 条目上限（或等价 diff 预算） |
| `maxMaterialFindings` | 新增实质性 finding 上限 |
| `maxFullRuns` / `maxBuildRuns` | full test / build 次数上限；默认只在里程碑 closure 执行 |
| `compactionBudget` | 允许的 compact/resume 次数 |
| `stopActions` | 预算触顶后允许的动作（handoff/report/memory only 等） |
| `resetPolicy` | 仅允许 `close-cycle-and-open-new`；禁止静默清零同一 cycle |

任一预算先到：立即停止新 source mutation，写 `StopSnapshot`（elapsed、completed、remaining、dirty delta、findings、validation runs、blocker、nextAction），并进入用户确认/新 cycle 路径。

### ExternalWaitAccountingGate（外部等待）

| 等待类型 | 计入 |
|----------|------|
| AI 读/写/验证/构建 | `executionMs`（消耗 wallClock 预算） |
| 等用户 CP/确认/授权 | `waitingUserMs`（**不**消耗执行预算） |
| 等 CI / registry 鉴权 / 人工审批 / 外部系统 | `waitingExternalMs`（**不**消耗执行预算） |

报告与 TimingCard 必须分列 `执行 / 等人 / 外部等待`；禁止把隔夜等人或 CI 排队算成「AI 执行了一整夜」。`maxWallClock` 只约束 `executionMs`。

### LongTaskAuthorizationGate（长任务授权）

| 规则 | 要求 |
|------|------|
| 进入长任务 | 必须有可审计 `authorizationEvidence`：用户明确继续、合法 Auto、或 CP 确认；不得伪造 |
| 预算未冻结 | 禁止无人值守 source mutation |
| 用户再次「继续」 | **不得**静默清零同一 `cycleId` 的已消耗预算 |
| 续跑 | 关闭旧 cycle → 新 `cycleId` + 新预算 + 更新 `allowedPaths` + 新授权证据 |
| 第二次 compact/resume 且旧 cycle 未关 | 强制 StopSnapshot 并要求新 cycle |

permission-core 等业务任务级 baseline 只能作样板，不得替代 DevCodex 通用 Contract 字段。

## OwnIntroducedRegressionSelfFixGate / SharedStateMutationGate（PI-119）

| 门禁 | 规则 |
|------|------|
| `OwnIntroducedRegressionSelfFixGate` | 本会话/本批次**自己改出**的 CI 红、targeted 失败或 validate 回归：完成根因分析后**必须主动修本地并复证**，不得停在「是否要修」确认；用户面只汇报证据与残余风险 |
| `SharedStateMutationGate` | `git commit` / `git push` / `tag` / `publish` / 远端共享态：**默认禁止**；仅当用户**当前消息**明确授权（如「提交并推送」「发布」）才可执行；「发版一次」≠ 后续补丁无限 push；一次审批不是空白支票 |
| 与 Auto 关系 | `@rocky` / Auto 可自动通过 CP，**不**豁免 SharedStateMutationGate；发布类自然语言（如「版本发布」）仅授权**本轮收口发布动作**，仍须 R6 清单与成功证据 |

## 偏离分级

| 级别 | 判定 | 处理 |
|------|------|------|
| 🟢 绿色 | 不改变目标、范围、接口、路径边界的局部实现微调 | 记录原因后继续 |
| 🟡 黄色 | 新增当前消费者、验证动作或部署副本，但不改变需求范围，且仍在 `yellowDeviationBoundary` 内 | 更新计划/进度/报告与 `deviationLog` 后继续 |
| 🔴 红色 | 新增依赖、改 Hook runtime 权限模型、改 CLI 语义、改发布动作、扩大需求边界、触达 `blockedScope` 或改变验证路线 | 停止执行，回 CP2 或 CP1 |

## CurrentBatchScopeDiffProbe / NewValidationConsumerRebindProbe

进入每个实施批次前必须反向比较 `phaseTotalScope / allowedFirstBatch / actualTargetSet / blockedScope / dirtyBoundary`。`allowedFirstBatch` 只允许当前批次，不得因总路线图已确认而一次放开后续模块。

当计划或实现新增 root package script、CI job、validator、fixture runner、部署副本或外部 consumer 时，执行 `ValidationConsumerRebindMatrix`，同步 `allowedPaths / consumerScope / TestRoute / regressionMatrix / rollbackAuthorization / deployCopies`。合同禁止修改某消费者但验收又依赖该消费者时必须在编码前阻断；回滚包含删除、清空或其他未授权动作时不得通过。

## Auto 消费规则

- Auto 仍是 Agent/Hook 执行模式，不是普通 Skill。
- `execution-contract` 只提供可复审契约，不豁免 S01~S07、C01、C10、C18。
- Auto 修改路径必须同时满足静态白名单和当前 Contract 的 `allowedPaths`。
- Contract 缺少 `allowedPaths`、`requiredArtifacts` 或 `validationRoute` 时，不得进入无人值守执行。

## Turn Liveness 条件契约

命中长任务或宿主停滞时，ExecutionContract 只引用 `ai-agent-system-architecture#TurnLivenessRecoveryGate`，并补充本任务的 `allowedRecoveryActions / forbiddenRecoveryActions / checkpointOwner / idempotencyEvidence / hostCapability / sidecarLifecycle / recoveryValidation`。默认允许状态观察、恢复卡和用户可见诊断；默认禁止自动重放 mutation、修改宿主私有 thread store、终止未知/用户进程或把 Hook-only 检测描述为无事件 watchdog。sidecar 若未积累前瞻证据必须保持 gray，并写 trial/rollback 条件。

`CheckpointValidationResultV1` 必须分别记录 response-time 与 post-execution 的 `status/evidence/deadline/errorCode`；缺失宿主终态证据不得写 pass。启用 `LocalTaskTraceV1` 时还必须冻结 `traceOwner / eventTypes / terminalSource / replayBoundary / retentionScope`：只允许当前 turn 的只读数据投影，禁止 payload 执行、operation replay、state mutation、host wakeup 与 process control。

### ExecutionAttemptLedgerGate

`ExecutionAttemptLedgerV1` 直接嵌入现有 TurnLiveness state，记录 `candidateId / phase / commandSignature / qualificationEvidence / attemptNo / failureSignature / sourceDelta / evidenceDelta / FirstPassYield / commandWallMs / externalWaitMs / waitingUserMs / modelReasoningMs / terminal`。有可用 qualification probe 时，formal run 前必须先有同 candidate/phase/command 的 pass；否则返回 `qualification-required`。

相同 candidate + phase + command + failureSignature 的连续两次 formal failure，且两次 `sourceDelta=0 / evidenceDelta=0` 时，第二次即生成 `StopSnapshotV1`，第三次正式运行前返回 `stop-before-third` 并停止新 mutation。相同 eventId 的相同语义重复交付幂等忽略，语义冲突必须报错。用户取消/中断必须写 `cancelled/aborted` terminal、释放 AI-owned lease，并记录 cancel finalizer 与 ServiceLifecycleCleanup；restart 只恢复原 ledger，不得把旧 inProgress 自动提升 completed。

## DualLayerRepairCollaborationContract

当 AI 根据问题锚点和预期行为判断任务目标是修复 Bug、缺陷、回归、安全问题、规范缺口、审查 finding 或其他已确认不正确行为时，必须建立双层修复协作契约。该触发与模型名称、是否切换模型/Agent、宿主 UI 或工作流标签无关；纯新增能力、纯分析/审计发现阶段或只讨论模型选择不触发。

### 公共字段与状态

| 字段 | 要求 |
|------|------|
| `repairClass` | `lightweight` / `full` |
| `contractState` | `draft / approved / executing / verification-pending / accepted / rejected / blocked` |
| `authorizationEvidence` | CP、合法 Auto、危险操作独立确认或其他可审计授权；Auto 使用 `mode=auto`，不得伪造人工确认 |
| `roleAssignments` | 显式记录决策/验收与执行/验证逻辑角色；允许同一主体，但高风险通过结论不能只有补丁产出者自证 |

允许状态转换为 `draft→approved/blocked`、`approved→executing/blocked`、`executing→verification-pending/blocked`、`verification-pending→accepted/rejected/blocked`、`rejected→executing/blocked`。禁止 `executing→accepted`；单个测试通过、代码写完或开始验证不能替代 accepted。

### lightweight

适用于低风险、预计不超过 2 文件，且无公共 API/Schema/config、控制面、发布、多批次或角色交接的 repair task。允许在问题确认、报告或记忆中内联，不强制完整任务目录。

| 层 | 必填字段 |
|----|----------|
| 决策/验收层 | `problemAnchor`、`expectedBehavior`、`acceptanceEvidence`、`decisionAcceptanceOwner` |
| 执行/验证层 | `allowedPaths`、`validationRoute`、`rollbackTrigger`、`executionVerificationOwner` |

### full

P0/P1、安全、控制面、公共 API/Schema/config、预计 ≥5 文件、多批次、角色交接、发布或其他高风险场景必须升级完整契约。

| 层 | 必填字段 |
|----|----------|
| 决策/验收层 | `auditSnapshot`、`approvedFindingIds`、`evidencePacket`、`roleAssignments`、`acceptanceMatrix`、`authorizationEvidence`、条件 `humanApproval` |
| 执行/验证层 | `allowedPaths`、`blockedScope`、`batchPlan`、`findingToPatchMap`、`regressionMatrix`、`handoffIntegrity`、`independentReReview`、`rollbackPlan` |

`findingToPatchMap` 必须形成 `problemAnchor/findingId → patchPaths → verificationEvidence → acceptanceStatus`；每个 finding 至少映射一个 patch 或 `no-code-change + evidence`，每个 patch 必须反向对应已批准问题。

`handoffIntegrity` 复用 ContextHandoffCard，并追加 `status / missingFields / checkedBy / checkedAt`。`independentReReview` 至少记录 `owner / independenceMode / evidence / result / runId`；`independenceMode` 可为 `isolated-session / different-agent / different-model / human / black-box-evidence`，不强制第二模型或第二 Agent。

### accepted 条件

- authorization、allowed paths、acceptance matrix 与 required evidence 均有效；full 合同还必须具备完整 finding map、handoff 与 independent re-review。
- active `repair-prevention-assessment#RepairPreventionAssessmentGate` 已返回有效 `RepairPreventionAssessmentV1`；当前修复证据与 prospective prevention evidence 分列，`no-new-control` 具有标准 reason/evidence，高风险或 repeat escape 使用 full。
- 补丁产出者可以参与验证，但不能成为高风险任务唯一通过证据源；角色独立或黑盒证据独立均可。
- 证据失败进入 rejected；触达 blockedScope、缺真相源或需要重开 CP 时进入 blocked。

## 输出格式

```markdown
## ExecutionContract

| 字段 | 内容 |
|------|------|
| scope | |
| allowedFirstBatch | |
| blockedScope | |
| allowedPaths | |
| requiredArtifacts | |
| consumerScope | |
| backlogTruthReview | |
| validationRoute | |
| ledgerWriteback | |
| verificationEvidence | |
| deviationPolicy | |
| driftTriggers | |
| deviationLog | |
| rollbackPlan | |
| progressArtifact | |
| safetyInterruptionRecovery | |
| publisherCredentialTopology | |
| turnLivenessContract | state/lease/ACK/terminal + checkpointValidation + LocalTaskTrace/replayBoundary |
| executionBudget | cycleId / maxWallClock / maxWorkUnits / maxDirtyDelta / maxFullRuns / stopActions / resetPolicy |
| executionAttemptLedger | qualification / attemptNo / failureSignature / source+evidence delta / timing split / terminal / StopSnapshot |
| externalWaitAccounting | executionMs vs waitingUserMs vs waitingExternalMs |
| longTaskAuthorization | authorizationEvidence / cycle lifecycle / continue=new-cycle |
| repairPreventionAssessment | RepairPreventionAssessmentV1 / immediateClosure / prospectiveStatus / rollbackOrSunset |
```

## 验证

- 执行前：CP2/CP3 或修复方案中存在 Contract 字段，并通过 `DevelopmentDriftGate` 核对 `allowedFirstBatch / blockedScope / driftTriggers / validationRoute / consumerSync / dirty boundary`。
- 长任务 / Auto / resume：存在 `executionBudget` + `longTaskAuthorization`；有等待面时存在 `externalWaitAccounting`；缺预算或未授权不得进入无人值守 mutation。
- repair task：轻量契约字段完整；高风险 full 契约的 finding map、handoff、独立复证和状态转换完整；RepairPreventionAssessmentV1 有效且没有用 current-event rerun 冒充 prospective effectiveness；只出现模型名称不得误触发。
- 执行中：每个 Batch 对照 `allowedPaths`、`requiredArtifacts`、`consumerScope`、`backlogTruthReview`、`regressionMatrix`、`ledgerWriteback` 与 `deviationLog`；消耗逼近预算时提前提示，触顶写 `StopSnapshot`。
- 执行后：ECR-2/ECR-3/ECR-7 引用 Contract、`verificationEvidence`、历史能力回归结果、backlog 真相复核结果与最终偏离记录；命中派生资产时引用 `PostStageDerivedArtifactFreshnessGate` 的 staged candidate receipt 和 post-commit replay，不能用生成时的 working-tree check 代替；命中 turn liveness 时同时引用双阶段 checkpoint 与 trace zero-write/replay 证据；长任务 ECR 必须引用 budget 消耗与等待分列。
