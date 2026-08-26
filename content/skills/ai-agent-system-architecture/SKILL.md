---
name: ai-agent-system-architecture
description: AI Agent 系统架构专家 Owner — 当任务涉及 Agent 路由、工具调用、上下文管理、记忆、状态机、权限、人机协作、可观测性、回放验证或模型辅助治理时使用；要求把 Agent 行为设计成可解释、可恢复、可审计。
---

# AI Agent System Architecture Skill

## 定位

本 Skill 负责 AI Agent 系统 Owner 视角。它把 Agent 当作状态机和工具执行系统，而不是只关注 prompt 文案。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| Agent 路由、意图识别、Skill 触发、工具调用、权限、记忆、handoff、summary、hook 状态 | 必须 |
| 任务涉及模型辅助治理、自动吸纳、自动复审、回放验证、可观测性或人机确认 | 必须 |
| 报告或方案需要解释 Agent 为什么选择某工作流或工具 | 必须 |
| 纯业务代码且不涉及 Agent 执行系统 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `AiAgentSystemArchitectureGate` | Agent 行为必须有路由、工具权限、上下文、状态机、观测和人机边界 | intentRouting、toolPermissionBoundary |
| `AgentRoutingGate` | 意图、Skill、模式和降级路径必须可解释 | intentRouting |
| `ToolPermissionBoundaryGate` | 工具权限、危险操作、确认和 fallback 必须明确 | toolPermissionBoundary |
| `ContextAcquisitionGate` | 每条消息必须先形成语义种子与唯一目标，再按计划读取最小充分上下文，并用 Post 成功回执证明完成 | IntentSeedV1、ContextReadPlanV2、ContextReadReceiptV2（V1 兼容） |
| `ContextMemoryStateGate` | 上下文恢复、记忆、handoff 和状态新鲜度必须设计 | contextMemoryModel |
| `ReplayObservabilityGate` | 行为验证不能只靠文字说明，需 replay、fixture 或日志证据 | observabilityReplay |
| `TurnLivenessRecoveryGate` | 长任务或工具输出后的 turn 必须用事件时间、AI-owned lease、continuation ACK、terminal invariant 与 checkpoint 区分运行、可疑、可恢复停滞和终态 | turnLivenessContract、TurnRecoveryCard、TurnLivenessEvidence |
| `LocalTaskTraceGate` | 当前 turn 的 typed trace 必须严格有序、拒绝重复/终态后追加，并只提供不执行 payload 的只读 replay | LocalTaskTraceV1、LocalTaskTraceReplayV1 |
| `RepairCollaborationRoleBoundaryGate` | repair task 必须把决策/验收与执行/验证角色、授权证据、状态与独立复证设计清楚；模型或 Agent 名称不构成风险分类 | roleAssignments、authorizationEvidence、independentReReview |
| `AgentCapabilityDomainCompletenessGate` | 声称完整/最终 Agent 架构或平台前先声明 completenessObject，并验证请求链、反馈链、横切面及适用产品/企业链 | agentCapabilityDomainMatrix |

### AgentCapabilityDomainCompletenessGate

| completenessObject | 必查覆盖 |
|---|---|
| kernel | ingress→cognition→context/knowledge→planning→execution/tools→response；observe→evaluate→evolve；governance/model/infrastructure |
| runtime | kernel + local/hosted composition、state、tool registry、security、observability、replay |
| developer-product | runtime + build→version→publish→deploy→invoke、SDK/CLI/API、local developer runtime、Agent Studio |
| hosted-platform | developer-product + run API、provider/connector/credential、deployment/fleet、tenant/workspace |
| enterprise-saas | hosted-platform + organization、entitlement、usage/metering/billing、admin/ops、audit/compliance |

每个适用能力域必须记录 `owner`、`publicPrivateBoundary`、`runtimeStatus`、`validationRoute`。较窄对象通过不能升级解释为较宽对象完整；报告使用“完整/最终/无需新增域”时，缺少 `completenessObject` 或任一适用域即判 incomplete。

### CapabilitySurfaceDecision 证据提供者

新增或改变 Agent 可调用能力面时，本 Skill 只向 `spec-governance#CapabilitySurfaceDecisionGate` 提供语义判断边界、model/application/user/host 控制方、read/write/execute 权限、状态机、authority、Task 协商、取消/超时/幂等和审计证据。它读取中央 `decisionRef`，不得自行决定或复制 `preferredSurface` 等 canonical 字段；MCP 能力、Tasks 或宿主行为没有 direct evidence 时保持 `UNVERIFIED`，不得由 Agent 名称或概念相似性推断支持。

### ContextAcquisitionGate

Agent 上下文获取采用以下状态链，任何一步都不得用后一步的推断倒填：

```text
IntentSeedV1 → unique project/activeRoot → ContextReadPlanV2（V1 兼容）→ attempted → PostToolUse observed → ContextReadReceiptV2（V1 兼容）→ project reality/final route
```

- `IntentSeedV1` 仅来自当前消息语义和已观察到的 continuity，不得先全文读取 Profile / memory 再“识别”意图；关键词不是 canonical intent。
- `ContextReadPlanV2` 必须显式区分 baseline、selected、excluded、unclassified 与 `fullReadReason`，并把稳定 `planContentId` 与 invocation `planId` 分离；`ContextReadPlanV1` 仅保留读取兼容。默认读取最小充分来源；Profile 规划阶段不得 hidden full read，记忆使用 bounded status/session/summary query。
- `ContextReadReceiptV2` 只接受 planId、planContentId、contextEpoch、activeRoot、source identity/query 和结果精确关联的 `PostToolUse` 成功证据。PreToolUse、计算 cache hit、旧全文工具返回或 fallback 文案都不能声明 complete；V1 receipt 不具备跨 epoch delivery reuse 资格。
- MCP 本地 stdio 正文观察先写入有界 `ContextSourceObservationLedgerV1`，lifecycle receipt 只作可重建投影；SkillRoute 仅在 epoch/plan/root/project 全同且 source metadata 新鲜时重放。旧快照覆盖不得丢失已交付证据，`stale/blocked`、source-digest 或 profile-drift 不得被 ledger 绕过。
- SkillRoute per-turn envelope 是临时执行 cache，不是正式任务存储。容量必须按语义活跃对象计数；空 orphan、无业务义务终态和同会话已被后继 context 取代的未提交 route 只能在 root/turn lock、identity 与 quarantine/readback 复证后有界退出。protected、live lock、identity mismatch、其他会话未完成 route 和业务回复义务必须保留并在 hard pressure 下失败关闭。正式任务数量仍由 TaskRecoveryStoreV5 的字节/headroom 合同治理，不得套用 per-turn 数量上限。
- 用户/项目明确要求、audit/migration、低置信或必要来源缺失可升级全量；目标、scope/action/risk、source digest 或 compact/resume 发生实质漂移时重新规划。不得每个动作都重复加载。
- 宿主缺少结构化工具时可走一次 path-observable / instruction fallback；证据不足保持 `partial/unverified`，后续安全、CP、治理和验证门禁不得因节流而降低。

### TurnLivenessRecoveryGate

当任务涉及长时间运行、工具完成后无续接、线程持续 `inProgress`、恢复或宿主停滞时，先冻结 `TurnLivenessContract`：

| 字段 | 要求 |
|---|---|
| `stateModel` | 至少区分 `idle / running / awaiting-continuation / suspect / stalled-recoverable / completed / error / interrupted` |
| `eventEvidence` | `turnKey / lastEventType / lastEventAt / lastToolOutputAt / continuationAckAt` |
| `lease` | 只有已放行的 AI-owned operation 才能建立 lease；用户进程或未知 PID 不能作为可清理 lease |
| `terminalInvariant` | tool output 不等于 turn 完成；显式 Stop/error/interruption 后必须清除 in-flight lease |
| `checkpoint` | `phase / artifactPaths / nextAction / resumeToken / idempotencyKey`，恢复前必须验证幂等边界 |
| `checkpointValidation` | response-time 与 post-execution 分开记录；缺 post evidence 只能 `unverified/incomplete-timeout`，实际 terminal evidence 才能 pass |
| `localTaskTrace` | `traceId/turnKey/status/sequence/openedAt/completedAt/events`；eventId 唯一、sequence 从 1 递增、terminal 唯一且最后 |
| `capabilityBoundary` | 分开记录 host-native watchdog、Hook event-time detection 与 read-only sidecar；Hook 无事件时不得宣称能自唤醒 |
| `validation` | direct replay + no-continuation / active-lease / restart-rehydrate / duplicate-recovery fault matrix |

默认 `awaiting-continuation` 可采用 120 秒 suspect / 300 秒 stalled advisory；慢模型推理和长工具必须由更长的 agent/operation lease 覆盖，不能机械套用 ACK 阈值。观察到 stale 只生成 `TurnRecoveryCard`；没有宿主授权与幂等复证时，禁止自动重放 mutation、kill/restart/interrupt/resume。

`LocalTaskTraceV1` 只保存当前 turn；历史 turn 由 TurnLiveness 摘要承接。重启时先校验 identity/sequence/duplicate/terminal，再生成 `LocalTaskTraceReplayV1` 数据投影；replay 的 `stateMutation/operationReplay/payloadExecution/processControl` 必须全部为 false。

## 执行步骤

1. 建立 Agent 行为图：用户输入、`IntentSeedV1`、目标、`ContextReadPlanV2`（V1 兼容）、Skill、工具、回执、确认、报告。
2. 明确工具权限边界：宿主拥有文件、删除和命令权限，DevCodex 只约束工作流有效性并提供风险 advisory；adapter missing/failed/invalid/outside-workspace 不得建立本地 shadow deny；能力面发生变化时向中央 decision 提供控制方、authority、状态与 Task 证据。
3. 定义上下文、记忆、handoff、summary 和恢复优先级。
4. 设计状态机和失败恢复：blocked、retry、fallback、handoff。
5. 用 direct replay、fixture replay、validate 或日志证据验证关键行为。

## 输出字段

```markdown
## AiAgentSystemArchitectureGate

| 字段 | 内容 |
|------|------|
| intentRouting | 意图、Skill、模式、降级路径 |
| toolPermissionBoundary | 工具权限、确认、危险操作和 fallback |
| contextMemoryModel | 上下文、记忆、handoff、summary、状态新鲜度 |
| contextAcquisition | seed、target、plan、selected/excluded、fullReadReason、fallback |
| contextReadReceipt | `ContextReadReceiptV2`（V1 兼容）的 Post 成功证据、内容身份、复用来源、缺失来源与完成状态 |
| stateMachineHandoff | 状态机、恢复、阻塞、交接 |
| observabilityReplay | replay、fixture、日志、validate 证据 |
| turnLivenessContract | 状态、事件、lease、ACK、终态、双阶段 checkpoint、LocalTaskTrace、能力边界与故障矩阵 |
| humanInLoopBoundary | 用户确认、auto、人工复核和最终责任边界 |
| capabilitySurfaceEvidence | `decisionRef`、控制方、read/write/execute、authority、状态/Task 与直接证据边界 |
| evidenceMatrix | 判断 -> hook / runtime / report / memory / replay / tests |
| agentCapabilityDomainMatrix | completenessObject -> domain -> owner / boundary / runtime / validation |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 把 Agent 能力写成 prompt 愿望 | 写路由、状态机、工具权限和验证 |
| 用 summary 覆盖文件真相源 | 遵循 Context Rehydration Contract |
| 先全文读取 Profile / memory 再判断意图 | 先形成 IntentSeedV1 与唯一目标，再执行有界计划和定向查询 |
| 把 PreToolUse、cache hit 或旧全文工具返回写成已完成 | 仅以精确关联的 PostToolUse 成功结果生成 ContextReadReceiptV2；delivery reuse 还须同 session/epoch/source identity |
| 自动模式绕过危险确认 | 保留 S01/S06 等不可豁免底线 |
| 行为变更无 replay | 补 direct/fixture replay 或等价 validate |
| 把 Hook 状态写入当成无事件 watchdog | 明确 event-time detection 边界，并用宿主能力或 gray read-only sidecar补充观察 |
| trace replay 执行 payload 或恢复写操作 | 只返回已校验的数据投影；写操作恢复必须另走授权和幂等复证 |

## 与其他 Skill 的关系

- `intent` / `routing`：意图和 Skill 路由是 Agent 系统入口。
- `memory` / `summary`：上下文恢复和状态新鲜度需要联动。
- `host-contract-verification`：宿主行为变化需验证事件和可见回复。
