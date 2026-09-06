---
name: requirement-parallel-orchestration
description: 多需求与宿主原生子 Agent 编排 Skill — 先判断工作项独立性，再以新鲜宿主能力、租约、隔离证据和根 Agent 单写者完成受控派发或自动串行回退。
---
# Requirement Parallel Orchestration Skill

## 职责

本 Skill 负责在进入源码实现、修复执行、长流程 Auto 或子会话派发前，判断多个需求/任务是否可以并行推进。它补齐的是执行前编排判定层，不替代 `intent`、`cp-gate`、`execution-contract`、`test-router`、`report` 或 `memory`。

默认原则：缺少证据时返回 `serial-required`；只有写入面、CP 状态、共享状态和汇合协议都可验证时，才允许输出 `ParallelLaunchCardV1`。LaunchCard 仍只是计划，不能证明宿主已经派发子 Agent；只有 `HostSubagentDispatchPlanV1.status=parallel-eligible`、有效 `AgentWorkLeaseV1` 和实际宿主工具结果同时存在时才可派发。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户要求多个需求/任务“并行推进”“同时做”“开多个子任务/子 Agent” | 必须 |
| 当前会话准备同时推进 ≥2 个 requirement / bug / optimization / scenario-test | 必须 |
| Auto、长流程或控制面任务计划拆分为多个可执行 work item | 必须 |
| 只读搜索、Profile/记忆读取或互不写输出的验证并行 | N/A，按 `ConcurrencyPolicy` 执行 |
| 单一需求的普通串行实现 | N/A + skipReason |

## 输入契约

### ActiveWorkInventoryV1

| 字段 | 要求 |
|------|------|
| `activeRoot` | 当前绑定 active-root；不得跨项目混入 |
| `workItems[]` | 每个 requirement / bug / optimization / scenario-test / current task |
| `workItems[].id` | 稳定任务标识 |
| `workItems[].cpState` | CP1/CP2/CP3 confirmed/pending/stale |
| `workItems[].allowedPaths` | 当前 work item 被允许触碰的路径 |
| `workItems[].expectedWrites` | 预期写入路径、surface、writeKind、owner |
| `sourceRefs[]` | sessions、memory_status、SUMMARY、CP artifact、用户消息或报告锚点 |
| `freshness` | current / summary-only / stale / unknown |

信息不足时不得猜测独立，返回 `serial-required + insufficient-*`。

## 判定门禁

### RequirementIndependenceGate

| status | 判定条件 | 输出 |
|--------|----------|------|
| `independent` | `allowedPaths` 不重叠，未共享控制面写入，CP/记忆/report/ledger 单写者不竞争，且汇合协议完整 | `ParallelLaunchCardV1[]` |
| `weakly-coupled-lock` | 主路径独立，但共享 `skill-portfolio`、`validation-manifest`、`package-boundary`、`memory`、`report`、`ledger` 或 `host-deploy` 等单写者面 | lock map、singleWriter、checkpoint、serial merge order |
| `serial-required` | 共享同一源码文件、同一 CP/task state、同一 audit session，或无法证明写入面独立 | blocker reason、recommended order、needed evidence |

### SharedSurfaceLockMapV1

核心共享面：

- `active-root`
- `cp-state`
- `memory`
- `report`
- `ledger`
- `audit-session`
- `source-mutation`
- `package-boundary`
- `validation-manifest`
- `skill-portfolio`
- `host-deploy`

`source-mutation` 只有在路径不重叠且存在完整 merge protocol 时才可能进入 `independent`。其他共享控制面默认进入 `weakly-coupled-lock`，由主会话或指定 single writer 串行写入。

## ParallelLaunchCardV1

只有 `independent` 判定可以输出 LaunchCard。必填字段：

| 字段 | 要求 |
|------|------|
| `requirementId` | 对应 work item id |
| `displayName` | 用户可识别名称 |
| `activeRoot` | 绑定根 |
| `allowedPaths` | 非空路径数组 |
| `forbiddenSharedSurfaces` | 核心共享面数组 |
| `sessionPrompt` | 子会话可复制 prompt，必须包含 stop 条件 |
| `isolationMode` | `same-active-root-disjoint-paths` / `separate-worktree` / `separate-project-root` |
| `mergeProtocol` | `IntegrationMergeProtocolV1` |
| `validationRoute` | 至少一条验证命令或 selector |
| `stopCondition` | 触碰禁止面、dirty 外溢、验证失败或 CP stale 时停止 |

缺字段返回 `launch-card-invalid`；缺 merge protocol 返回 `integration-protocol-missing`。

## IntegrationMergeProtocolV1

| 字段 | 要求 |
|------|------|
| `mergeOrder` | 串行汇合顺序；不能“谁先完成谁合并” |
| `conflictChecks` | `git diff --name-only`、共享 manifest/portfolio/package/docs/Profile 检查 |
| `validationRoute` | changed/control-plane/profile-deploy/requirement artifacts 等 |
| `reportMemoryOwner` | 最终 report/memory 单写者 |
| `failureAction` | 冲突、缺验证或 dirty 混合归属时回 serial/CP |

## 宿主原生执行合同

### HostNativeCollaborationCapabilityV1

宿主能力必须由当前根 Agent 可观察的工具清单或直接调用结果生成，且至少绑定 `spawn`、`wait`、`interrupt` 的实际工具名、host/variant、支持模式、fanout/depth、`observedAt/expiresAt`、证据引用和 `capabilityDigest`。官方文档、AGENTS/Skill 文本、生成配置、其他宿主回执或工具名称猜测都不能作为 direct evidence。

能力缺失、过期、摘要不符或不支持所需隔离模式时，输出完整 serial fallback；不得询问用户重新确认，也不得因为“没有多 Agent”停止主任务。

### HostSubagentDispatchPlanV1

根 Agent 在派发前生成一份 immutable plan，至少绑定：

- 当前 `taskId/viewDigest/activeRoot`、`sourceHead/dirtyDigest`；
- work items、`RequirementIndependenceDecisionV1`、`SharedSurfaceLockMapV1` 与固定 merge order；
- 当前宿主 capability identity 与实际 operation bindings；
- fanout≤4、depth=1、time/cost gate；
- `serialFallback` 的同一 work graph、根单写者和 reason codes；
- `planDigest`。

只有预计串行耗时至少 120 秒、预计节省至少 60 秒、协调成本不超过总量 25%，且所有工作项和宿主证据满足条件时，plan 才能是 `parallel-eligible`。默认 fanout=3，实际值取 work item 数、宿主上限与 4 的最小值。

### AgentWorkLeaseV1

每个 child 必须有独立 lease，绑定 `planDigest/workItemId/attempt/mode/baseHead/dirtyDigest/activeRoot/isolationRoot/allowedRealpaths/forbiddenSharedSurfaces/issuedAt/expiresAt/cancelFence/leaseDigest`。`isolated-worktree-patch` 的 plan 只冻结相对 allowed paths；宿主创建独立 worktree 后，根 Agent 必须用其真实 `isolationRoot` 重新计算 lease 的绝对 allowed realpaths。缺 isolation root、与 root checkout 相同或路径逃逸时不签发 lease并自动串行。允许的模式只有：

| mode | 允许范围 |
|---|---|
| `read-only` | 只读分析，不得产生源码或正式产物写入 |
| `isolated-validation` | 只写该 operationId 独占的 `.tmp`，返回验证证据并精确清理 |
| `isolated-worktree-patch` | 仅宿主明确支持 separate worktree 时，在隔离 worktree 的 allowed realpaths 内形成 patch；不得直接写 root checkout |

lease 过期、attempt/plan/source/dirty 不符、cancel fence 改变或 root 已进入串行回退后，结果一律视为 late/quarantined；禁止恢复旧 lease。

### ChildAgentEvidenceV1 与 RootAgentIntegrationReceiptV1

child 返回的只是候选证据，至少绑定 host child identity、plan/lease/attempt、base/dirty、实际 changed realpaths、patch digest（如有）、validation receipts、完成时间和 owned resource cleanup。根 Agent 必须验证：

1. work item id 必须唯一；调用方与 child 提供的 realpath 必须原生为绝对路径，且全部落在 lease 允许根内，没有触碰禁止共享面；
2. read-only/isolated-validation 没有源码写入；worktree patch 有摘要和独立验证；
3. lease 未过期、cancel fence 未变化、root 尚未接管串行；
4. child 启动的 temp/worktree/service 已清理，无 owned residue；
5. 结果按冻结 merge order 串行复证、应用和 root retest。

任一项不成立时输出 `ChildAgentEvidenceValidationV1.classification=quarantined`，把该 work item 放入 `RootAgentIntegrationReceiptV1.serialTakeoverWorkItemIds`。`childCompletionIsTaskCompletion=false` 与 `RootAgentIntegrationReceiptV1.taskCompletion=false` 是强制不变量；最终 CP、memory、report、ledger、audit、package、manifest、portfolio、Profile 和 ECR 仍由根 Agent 写入。

### 取消、超时与清理

根 Agent 仅对本 plan 的 child 使用宿主 interrupt，并形成 `HostSubagentCancelFenceV1`。bounded wait 超时或派发失败后先改变 cancel fence，再将未接受 work items 交给根 Agent 串行；随后到达的旧结果不得应用。只清理本 plan 创建的 child、operation temp、worktree 和服务，禁止终止用户既有进程或删除其他任务产物。

## 执行步骤

1. 绑定唯一 active-root 和源码根；确认不是跨项目混读。
2. 有界读取 active work：任务目录、CP 状态、近期 memory/report 摘要、预期写入面。
3. 构建 `ActiveWorkInventoryV1`，记录 `sourceRefs` 和 `freshness`。
4. 执行 `SharedSurfaceLockMapV1` 和 `RequirementIndependenceGate`。
5. 对 `independent` 输出 `ParallelLaunchCardV1`；对 `weakly-coupled-lock` 输出锁、single writer 和检查点；对 `serial-required` 输出 blocker 与推荐顺序。
6. 读取当前宿主 collaboration tool inventory，形成并校验 `HostNativeCollaborationCapabilityV1`；不能直接观察则自动串行。
7. 生成 `HostSubagentDispatchPlanV1`；未达到 capability/isolation/time/cost gate 时按其中 `serialFallback` 执行同一 work graph。
8. 对 parallel-eligible 项生成 `AgentWorkLeaseV1`，由根 Agent 调用宿主 spawn/wait/interrupt；Hook、MCP、脚本和 child 不得代替根 Agent 调用这些模型工具。
9. 汇合时验证 `ChildAgentEvidenceV1`，形成 `RootAgentIntegrationReceiptV1`，再由根 Agent串行应用、重测、写 report/memory 并执行 ECR。

## 探针

| Probe | 场景 | 期望 |
|-------|------|------|
| PRB-01 | 两个需求只写各自 requirement 子目录 | `independent` + LaunchCard valid |
| PRB-02 | 需求目录独立但共享 portfolio/manifest | `weakly-coupled-lock` |
| PRB-03 | 两个任务修改同一 source file | `serial-required` |
| PRB-04 | LaunchCard 缺 required fields | `launch-card-invalid` |
| PRB-05 | 缺 merge protocol | `integration-protocol-missing` |
| PRB-06 | 出现 `allowParallelMutations` 或默认并行源码写入开关 | `policy-violation` |
| PRB-07 | capability absent/stale/docs-only 或缺 operation | plan=`serial-fallback`，work graph 保留 |
| PRB-08 | 低于 120s/60s/25% 收益门 | plan=`serial-fallback` |
| PRB-09 | source mutation 无 separate worktree | 串行，不退化为共享 checkout |
| PRB-10 | lease expiry、timeout、cancel 或 late result | `quarantined` + root serial takeover |
| PRB-11 | changed realpath、dirty、patch/test identity 漂移 | `quarantined`，不应用 |
| PRB-12 | child 全部完成 | 仍需 root merge/retest/ECR，不得直接完成任务 |

生产入口：`npm run test:requirement-parallel-orchestration`。

## 与其他 Skill 的关系

- `dev-default` / `fix-default`：实现前出现多任务、并行、子 Agent 或 worktree 信号时触发本 Skill。
- `execution-contract`：把 LaunchCard、dispatch plan、work lease、allowed paths、blocked scope、merge protocol 和 single-writer 约束纳入合同。
- `test-router`：以 `requirementParallelOrchestration` 领域绑定选择 `static + unit-integration`；控制面实现叠加 `profile-deploy`。
- `report` / `memory`：记录判定摘要和 LaunchCard 锚点；最终 report/memory 仍由主会话单写者写入。
- `source-consumer-sync`：消费者、validation manifest、portfolio、Profile、README/website 和部署副本同步由 Concept Sync Map 约束。

## 禁止

- 禁止把只读准备并行扩展为同 active-root 并行 source mutation。
- 禁止新增 `allowParallelMutations`、`mode=parallel` 或绕过 C07 单写者的配置。
- 禁止没有 `allowedPaths`、`forbiddenSharedSurfaces`、`mergeProtocol` 或 `validationRoute` 就启动子会话。
- 禁止子会话直接写共享 CP、memory、report、ledger、audit session、portfolio、validation manifest 或部署副本。
- 禁止把子会话完成等同于需求完成；必须串行汇合、验证和 ECR。
- 禁止把官方文档、Skill/AGENTS 文本、工具名猜测或其他宿主证据写成 current-host direct collaboration PASS。
- 禁止 capability/dispatch/timeout 失败后请求用户重复确认；必须自动执行 plan 中相同 work graph 的串行回退。
- 禁止 child 递归 spawn；首版 depth 固定为 1，fanout 不得超过 4。
