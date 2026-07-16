---
name: api-contract-architecture
description: API 契约架构专家 Owner — 当任务涉及 public API、HTTP/SDK/CLI 契约、版本兼容、错误模型、分页过滤、幂等、Schema、类型、迁移或消费者影响时使用；要求先冻结消费者契约，再设计实现与验证。
---

# API Contract Architecture Skill

## 定位

本 Skill 负责 API 契约 Owner 视角。它确保方案先回答“谁消费、契约是什么、如何兼容、如何验证”，再进入实现细节。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 新增或调整 HTTP API、SDK API、CLI 参数、Hook payload、MCP tool/resource、事件、配置 Schema 或 public types | 必须 |
| 涉及版本兼容、迁移、错误码、分页、过滤、幂等、鉴权响应或消费者文档 | 必须 |
| 修复会影响调用方行为或示例用法 | 必须 |
| 纯内部实现且不改变任何公开输入/输出/错误/类型 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `ApiContractArchitectureGate` | 公开契约必须有消费者、输入、输出、错误、兼容和验证矩阵 | consumerSurface、contractInventory |
| `ConsumerSurfaceGate` | 先列真实消费者，避免首个实现反向定义公共契约 | README、types、examples、route、SDK |
| `ErrorModelGate` | 错误结构、错误码、detail 和恢复路径必须稳定 | errorModel、docs |
| `CliJsonContractGate` | 机器可读 CLI 必须冻结 envelope 字段、成功/失败互斥、错误码、nextStep 与 native exit code | DevCodexCliEnvelopeV1、spawn fixtures |
| `VersionCompatibilityGate` | 兼容、弃用、迁移和 breaking change 必须明确 | versionCompatibility |
| `ReleaseAuthorityBeforeCompatibilityGate` | 先证明契约是否已发布并形成稳定消费者，再决定兼容、迁移或直接收敛 | publishedState、consumerEvidence、authoritySources、decision |
| `ConfigurationErgonomicsGate` | 公开配置 Schema 必须证明最小任务、字段必要性、复杂度预算和可选字段省略行为 | MinimalTaskConfig、FieldNecessityMatrix、OptionalFieldOmissionProbe |
| `ContractVariantIsolationMutationGate` | discriminated union/tool/event/state 合同必须拒绝 sibling variant 字段，并验证完成态必需证据不能被删除或反转 | ContractVariantIsolationMatrix、CompletionEvidenceDeletionMatrix |
| `IdempotencyPaginationGate` | 写操作、分页、过滤、排序和重试场景必须定义语义 | idempotencyPagination |

## 执行步骤

1. 列出所有消费者：前端、SDK、CLI、Hook、文档示例、测试、外部系统。
2. 冻结现状契约：字段、类型、错误、版本、默认值、边界条件。
3. 执行 `ReleaseAuthorityBeforeCompatibilityGate`：核对 tag/registry/release note/public docs/实际消费者；已发布才进入兼容评估，未发布且无稳定消费者默认直接收敛，未发布但存在产品取舍则交用户决策，事实不明时不得编造兼容义务。
4. 定义目标契约与兼容策略：新增、保留、弃用、迁移、拒绝。
5. 为错误模型、分页过滤、幂等和重试写稳定语义；CLI JSON 合同还要冻结 success/failure 字段互斥和 exit=0/1/2 映射。
6. 若合同存在 discriminator 或条件完成态，执行 cross-variant 字段注入与完成证据删除/反转 mutation；Schema、semantic validator、docs field set 与 runtime 必须给出同一结论。
7. 把契约映射到文档、示例、`.http` / `.cjs`、types、runtime probe。

## 输出字段

```markdown
## ApiContractArchitectureGate

| 字段 | 内容 |
|------|------|
| consumerSurface | 消费者列表和调用入口 |
| contractInventory | 当前/目标输入、输出、错误、类型、配置 |
| versionCompatibility | 兼容、弃用、迁移、breaking change |
| releaseAuthority | publishedState、consumerEvidence、authoritySources 与兼容决策 |
| errorModel | 错误码、detail、恢复路径 |
| cliJsonContract | envelope、字段互斥、错误码、nextStep、exit map 与默认人读兼容 |
| idempotencyPagination | 幂等、分页、过滤、排序、重试语义 |
| sdkDocsImpact | SDK、README、examples、public types、文档影响 |
| evidenceMatrix | 判断 -> 代码 / 类型 / 文档 / 测试 / 运行时证据 |
| contractMutationMatrix | variant isolation、completion evidence deletion/reversal、schema/semantic/docs/runtime 结论 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 先写实现，再让消费者适配输出 | 先冻结 contractInventory 和 consumerSurface |
| 只写 happy path，没有错误模型 | 补 errorModel 和失败恢复 |
| 首个 provider 字段反向定义公共 API | 区分业务契约与 provider payload |
| 用单个示例证明兼容 | 抽样 public types、README、tests 和 runtime |
| 未发布候选也默认背负历史兼容层 | 先做 ReleaseAuthorityBeforeCompatibilityGate；无稳定消费者时直接收敛 canonical contract |
| JSON 错误只写 message 或以 exit 0 返回 | 冻结稳定 errorCode/nextStep，并用原生退出码区分合同错误与检查失败 |

## 与其他 Skill 的关系

- `developer-experience-architecture`：API 示例、错误信息和迁移路径共同影响 DX。
- `backend-domain-architecture`：领域不变量和权限策略必须映射到 API 契约。
- `test-router`：API 变更触发 `.http` / `.cjs`、types、runtime 或 docs sync 验证。
