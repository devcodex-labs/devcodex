---
name: host-capability-routing
description: 宿主能力路由 Owner — 当已识别工作流意图后，需要在五个逻辑宿主、八个受支持 variant 上选择 direct / plan_first / auto_authorized，核验原始指令 authority，或判断 native lever 是否具备新鲜且安全的直接证据时使用。
---
# Host Capability Routing Skill

## 定位

本 Skill 是“工作流意图 → 宿主能力决策”的语义编排 Owner。它消费 `intent` / `routing` 已完成的工作流意图，输出 `CapabilityIntentDecisionV1`；它不重新分类工作流、不拥有 CP 状态机、不执行宿主命令，也不创建 Auto 授权。

能力面由中央决策 `CSD-host-capability-routing` 冻结为 `rule-skill`。本目录只保存领域契约、variant-aware catalog 和执行规则，不复制中央 CSD 的选择字段。

Phase 1 的唯一可执行路径是 portable-first：

- `direct`：不额外进入宿主 native Plan；仍完整执行适用的安全不变量、CP、验证、报告和记忆。
- `plan_first`：先形成 DevCodex 计划/CP 产物；不等于已经进入宿主 native Plan。
- `auto_authorized`：只消费现有、可回读、仍有效的 Auto 授权证据；宿主 YOLO、permission mode 或“快一点”均不构成授权。

Native lever、MCP Tool/Resource、CLI 和 Hook 接线属于 Phase 2。Phase 1 可以读取 catalog 并解释上限，但不得声称已调用 native lever。

## 触发边界

在以下条件同时成立时使用：

1. `intent` / `routing` 已给出最终 `workflowIntent`；
2. 任务需要判断 `direct / plan_first / auto_authorized`，或需要解释当前宿主 variant 的能力上限；
3. 当前消息、CP artifact 或 managed task source 可以形成 `OriginalInstructionRefV1`。

以下情况不触发或立即退化：

- 普通闲聊且不进入 DevCodex 工作流；
- 工作流意图尚未确定：先回 `intent`；
- 原始指令 authority 缺失或跨轮仅剩 compat/none：停止自动 mutation，请求重述或重新确认；
- catalog 缺失、重复、过期、variant 未知或 matrix identity 不一致：使用 portable fallback，不猜 native；
- Cursor、chatgpt-plain：标记 unsupported，使用手工全文/普通提示词路径。

## Owner 与非职责

| 能力 | Owner | 本 Skill 行为 |
|---|---|---|
| 工作流意图 | `intent` / `routing` | 只消费，不覆盖 |
| 安全不变量 | `instructions.md` | 写入 `appliedInvariantIds`，不得降级 |
| CP1→CP2→条件 CP3 | `cp-gate` | 保留并引用，不新增状态机 |
| Auto authority | 当前 Auto 规则与确认回执 | 只验证证据，不创建授权 |
| 宿主事实 | `HostLeverCatalogV1` + `HostAdapterCompatibilityMatrixV1` | 精确查询、校验 freshness 和 fallback |
| 原始指令 identity | 现有 host event / Governance Intake / CP / task source | 只形成 compact ref，不保存完整原文 |
| 完成态 | workflow completion / ECR | 不以本决策替代完成门禁 |
| native invocation | Phase 2 runtime owner | Phase 1 禁止执行 |

## 输入

最小输入：

- `instructionRef: OriginalInstructionRefV1`
- `workflowIntent: dev | fix | analyze | audit | self-fix | other`
- 当前逻辑宿主和精确 `hostSurfaceOrVariant`
- scope、风险、歧义和是否已有有效 Auto authority 的语义判断
- `HostLeverCatalogV1` 及其对应 matrix identity

宿主 variant 必须来自当前 `HostAdapterCompatibilityMatrixV1`。不得新建平行 `HOST_IDS` 或把 Grok root、plain child、launcher 合并成一个能力声明。

## 输出

输出一份 `CapabilityIntentDecisionV1`：

- 只引用 `instructionRefId`，不内嵌用户原文；
- portable decision 固定为 `direct / plan_first / auto_authorized`；
- `appliedInvariantIds` 列出本轮实际适用的不变量；
- `nativeEligibility` 只记录精确 catalog key 和证据状态；
- native 不可用时 `fallback.applied=true`、`target=portable`、`retryable=false`；
- receipt 只保存 catalog identity，不复制完整 catalog row。

`decisionId` 是除展示字段 `reason` 和自身 `decisionId` 外的 decision core 的稳定 SHA-256。

## 决策顺序

1. **InstructionAuthorityGate**：校验 `OriginalInstructionRefV1`。confirm、compact、resume 或宿主/session 变化后，优先回绑 digest-bound CP/task artifact。
2. **WorkflowIntentOwnerGate**：确认工作流意图来自 `intent` / `routing`；本 Skill 不重算。
3. **PortableDecisionGate**：
   - scope 清晰、低复杂度且无需额外计划时可选 `direct`；
   - scope 有歧义、复杂、跨模块、高风险或需要 CP3 时选 `plan_first`；
   - 只有 `autoAuthorityRef` 可回读且仍有效时才选 `auto_authorized`。
4. **InvariantProjectionGate**：至少保留 `S05`；dev/fix/self-fix 还必须保留 `CP1`、`CP2`，需要 CP3 时追加 `CP3`。任何 portable 决策都不能绕过 S01～S07。
5. **ExactVariantCatalogGate**：按 `hostId + hostSurfaceOrVariant + capabilityFamilyId + leverVersion` 唯一查询；0 行或多行均 fail closed。
6. **NativeEligibilityGate**：证据、lease、permission、enter/approve/cancel/exit、显式 authority 和 Phase 2 runtime enablement 必须全部通过；否则 portable fallback。
7. **ReceiptGate**：写入 bounded receipt；不得把 catalog row、原消息正文或宿主 UI 状态复制成第二事实源。

## PortableDecisionGate

| 条件 | 结果 | 必要证据 |
|---|---|---|
| scope 明确、风险低、无需额外计划 | `direct` | `confidence=high`；适用 CP/安全锚点仍在 |
| scope 歧义、复杂、多模块、高风险、控制面或 CP3 | `plan_first` | reasonCode 可复算；禁止 native 猜测 |
| 用户提供有效 Auto alias/自然语言授权 | `auto_authorized` | 非空 `autoAuthorityRef`；证据仍在当前 authority scope |
| confidence 低或信息不足 | `plan_first` 或请求澄清 | `INTENT_CONFIDENCE_LOW` |

`direct` 不是“跳过 CP”，`plan_first` 不是“宿主 Plan 已进入”，`auto_authorized` 也不是“无需安全确认”。

## OriginalInstructionRefGate

Authority 强度从高到低：

1. `digest-bound-cp-artifact` 或 `managed-task-source`；
2. 可回读 `host-event` 的 `sha256/strong`；
3. `governance-intake-anchor` 的 `fnv1a32-compat/compat`；
4. 当前轮 `conversation-visible`；
5. `unavailable`。

规则：

- 不持久化完整用户原文；`controlledSummary` 只是 ≤512 Unicode 字符的 projection。
- `projectionDigest` 只证明受控摘要，不证明原始消息。
- `compat/none` 不能单独授权跨轮 mutation。
- source missing/mismatch/unverified 且没有强 CP/task authority 时，`stopMutation=true`，请求重述或重新确认。
- 附件只保存宿主 locator 或内容 digest。

## Catalog 与 native truth ceiling

`host-lever-catalog.v1.json` 的主分母固定为当前 matrix 的 8 个 in-scope variant；Cursor 和 chatgpt-plain 在 `unsupportedSurfaces` 单列。

Evidence lease：

| kind | lease | native eligibility |
|---|---|---|
| `repo-local` | `source-bound` | source/matrix identity 变化即 stale |
| `official-docs` | `P30D` | 只能证明文档声明，不能替代 direct replay |
| `direct-host-replay` | `P14D` | 还需 permission/lifecycle/authority 全通过 |
| `unverified` | `P0D` | 永不满足 |

Phase 1 即使 evidence 为 fresh，也必须因 runtime 未接线而返回 `NATIVE_NOT_PHASE1`。宿主 UI、生成的 wrapper、plan 文件存在或 permission mode 均不等于 native 已应用。

## FailureMatrix

| reasonCode | 行为 |
|---|---|
| `INTENT_CONFIDENCE_LOW` | `plan_first` 或澄清；不调用 native |
| `HOST_VARIANT_UNKNOWN` | portable fallback |
| `CATALOG_DUPLICATE_KEY` / `CATALOG_UNAVAILABLE` | 相关 family fail closed；维持当前工作流 |
| `CATALOG_SOURCE_STALE` | 禁用 catalog native 判断并重新生成证据 |
| `NATIVE_EVIDENCE_STALE` / `NATIVE_EVIDENCE_UNVERIFIED` | native disabled |
| `NATIVE_LIFECYCLE_INCOMPLETE` | native disabled |
| `NATIVE_PERMISSION_UNSAFE` | native disabled |
| `NATIVE_AUTHORITY_MISSING` | 请求显式 authority；不自动调用 |
| `NATIVE_NOT_PHASE1` | 正常 portable 路径 |
| `AUTO_AUTHORITY_MISSING` | 不允许 `auto_authorized` |
| `INSTRUCTION_SOURCE_MISSING` | 停止自动 mutation，请求重述 |
| `INSTRUCTION_DIGEST_MISMATCH` | 停止并重新确认 |
| `INSTRUCTION_AUTHORITY_TOO_WEAK` | 回绑强 CP/task authority |
| `HOST_UNSUPPORTED` | manual/plain fallback |
| `MCP_NOT_REQUIRED` | Phase 1 继续；不把 MCP 缺失当故障 |

## MCP 边界

Phase 1 不读取或修改 MCP server inventory；MCP 不可用时 portable decision 必须无损。

只有以下条件全部成立，才可在新 CSD 和新 CP 中评估 Tool/Resource：

1. 至少两个独立 runtime consumer 需要同一有界查询；
2. 输入已由 Skill 归一化，不接收原始自然语言；
3. 查询确定、只读、幂等且有 bounded receipt；
4. 本地 catalog 仍是无损 fallback；
5. runtime owner、协议、host matrix、迁移和回滚已冻结。

有界内容读取优先评估 Resource/Resource Template；只有参数化计算才评估 Tool。

## 验证

权威入口：

```bash
npm run test:host-capability-routing
npm run test:capability-surface-decision
node scripts/validate.js
```

最小负向覆盖：

- schema unknown field；
- duplicate catalog key；
- matrix/source identity stale；
- 8/8 variant 和 2 unsupported coverage；
- evidence expiry / `P0D`；
- lifecycle incomplete；
- permission unsafe；
- explicit authority missing；
- instruction strong/compat/none 与跨轮 mutation；
- MCP absent；
- unsupported surface；
- native false claim=0。

## 消费者同步

当前消费者只保存 compact ref：

- `intent` / `routing`：触发本 Skill，仍拥有 workflow intent；
- `cp-gate`：核验 instruction authority，CP 状态机不变；
- `memory` / `summary` / `report` / `execution-contract`：只引用 `instructionRefId` 与 projection，不复制原文；
- prompts：使用相同 compact ref 字段；
- package/portfolio/host projections：分发本 Skill、schemas、catalog；
- README/website/Profile：说明 portable-first、native ceiling 和 MCP Phase 2 门槛。

Skill 缺失、未注册或 catalog 无效时，所有消费者必须回到既有 DevCodex 工作流，不得猜测 native。

## 演进与退役

- 新增 variant、改变 portable decision enum、改变 Auto semantics、保存完整原文、接线 MCP/CLI/Hook/native lever，必须退回 CP2，并由 `spec-governance` 生成新鲜 CSD。
- catalog writer 固定为 `host-capability-routing/catalog-maintainer`；运行消费者只读。
- 若未来宿主提供统一、可验证且可回滚的 native contract，本 Skill 仍保留 portable fallback。
- 若能力长期无真实消费者或被更强统一 owner 替代，应先撤消费者与 package entry，再按 S01 单独确认删除。
