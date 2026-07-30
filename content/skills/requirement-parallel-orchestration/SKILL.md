---
name: requirement-parallel-orchestration
description: 多需求并行编排 Skill — 当任务涉及多个需求/问题/优化并行推进、子会话、子 Agent、worktree 或多 active work 执行前判定时，生成 RequirementIndependenceGate、SharedSurfaceLockMap 与 ParallelLaunchCard。
---
# Requirement Parallel Orchestration Skill

## 职责

本 Skill 负责在进入源码实现、修复执行、长流程 Auto 或子会话派发前，判断多个需求/任务是否可以并行推进。它补齐的是执行前编排判定层，不替代 `intent`、`cp-gate`、`execution-contract`、`test-router`、`report` 或 `memory`。

默认原则：缺少证据时返回 `serial-required`；只有写入面、CP 状态、共享状态和汇合协议都可验证时，才允许输出 `ParallelLaunchCardV1`。

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

## 执行步骤

1. 绑定唯一 active-root 和源码根；确认不是跨项目混读。
2. 有界读取 active work：任务目录、CP 状态、近期 memory/report 摘要、预期写入面。
3. 构建 `ActiveWorkInventoryV1`，记录 `sourceRefs` 和 `freshness`。
4. 执行 `SharedSurfaceLockMapV1` 和 `RequirementIndependenceGate`。
5. 对 `independent` 输出 `ParallelLaunchCardV1`；对 `weakly-coupled-lock` 输出锁、single writer 和检查点；对 `serial-required` 输出 blocker 与推荐顺序。
6. 汇合时执行 `IntegrationMergeProtocolV1`、TestRoute、report/memory 单写者写入和 ECR。

## 探针

| Probe | 场景 | 期望 |
|-------|------|------|
| PRB-01 | 两个需求只写各自 requirement 子目录 | `independent` + LaunchCard valid |
| PRB-02 | 需求目录独立但共享 portfolio/manifest | `weakly-coupled-lock` |
| PRB-03 | 两个任务修改同一 source file | `serial-required` |
| PRB-04 | LaunchCard 缺 required fields | `launch-card-invalid` |
| PRB-05 | 缺 merge protocol | `integration-protocol-missing` |
| PRB-06 | 出现 `allowParallelMutations` 或默认并行源码写入开关 | `policy-violation` |

生产入口：`npm run test:requirement-parallel-orchestration`。

## 与其他 Skill 的关系

- `dev-default` / `fix-default`：实现前出现多任务、并行、子 Agent 或 worktree 信号时触发本 Skill。
- `execution-contract`：把 LaunchCard、allowed paths、blocked scope、merge protocol 和 single-writer 约束纳入合同。
- `test-router`：以 `requirementParallelOrchestration` 领域绑定选择 `static + unit-integration`；控制面实现叠加 `profile-deploy`。
- `report` / `memory`：记录判定摘要和 LaunchCard 锚点；最终 report/memory 仍由主会话单写者写入。
- `source-consumer-sync`：消费者、validation manifest、portfolio、Profile、README/website 和部署副本同步由 Concept Sync Map 约束。

## 禁止

- 禁止把只读准备并行扩展为同 active-root 并行 source mutation。
- 禁止新增 `allowParallelMutations`、`mode=parallel` 或绕过 C07 单写者的配置。
- 禁止没有 `allowedPaths`、`forbiddenSharedSurfaces`、`mergeProtocol` 或 `validationRoute` 就启动子会话。
- 禁止子会话直接写共享 CP、memory、report、ledger、audit session、portfolio、validation manifest 或部署副本。
- 禁止把子会话完成等同于需求完成；必须串行汇合、验证和 ECR。
