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
| `requiredArtifacts` | ✅ | 必须产出的需求、方案、计划、进度、报告、测试、changelog 等 |
| `consumerScope` | 条件 | 控制面 / 模板-示例-校验链任务必填；列出 `sourceOfTruth`、`currentConsumers`、`historicalMirrors`、`validateProbes`、`deployCopies` |
| `backlogTruthReview` | 条件 | 当任务/批次直接来源于 `data/*.md` open/partial 项时必填；列出 `candidateIds`、`classification`、`evidence`、`scopeDelta` |
| `validationRoute` | ✅ | 引用 `test-router`、`audit-release`、`release-verification` 或当前 CP3 验证矩阵 |
| `regressionMatrix` | 条件 | 高风险控制面 / 多批次修复必填；列出“历史能力 → 受影响批次 → 必跑验证 → 失败回滚点” |
| `verificationEvidence` | 条件 | 宿主验证或控制面任务必填；记录 validate、targeted tests、fixture replay、direct replay、部署同步、ArtifactLinkSet、MCP fallback 等证据计划 |
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
| `turnLivenessContract` | 条件 | 长任务、工具完成后无续接、宿主停滞或跨轮次恢复时必填；引用 `ai-agent-system-architecture` 的状态/lease/ACK/terminal/checkpoint、CheckpointValidation 与 LocalTaskTrace 契约及能力边界 |

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
```

## 验证

- 执行前：CP2/CP3 或修复方案中存在 Contract 字段，并通过 `DevelopmentDriftGate` 核对 `allowedFirstBatch / blockedScope / driftTriggers / validationRoute / consumerSync / dirty boundary`。
- repair task：轻量契约字段完整；高风险 full 契约的 finding map、handoff、独立复证和状态转换完整；只出现模型名称不得误触发。
- 执行中：每个 Batch 对照 `allowedPaths`、`requiredArtifacts`、`consumerScope`、`backlogTruthReview`、`regressionMatrix`、`ledgerWriteback` 与 `deviationLog`。
- 执行后：ECR-2/ECR-3/ECR-7 引用 Contract、`verificationEvidence`、历史能力回归结果、backlog 真相复核结果与最终偏离记录；命中 turn liveness 时同时引用双阶段 checkpoint 与 trace zero-write/replay 证据。
