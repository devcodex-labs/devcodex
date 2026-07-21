---
name: user-visible-output-contract
description: 用户可见输出契约 Owner — 统一入口检查、完成检查、确认、进度、结果、阻断及内部产物到用户交付的确定性投影
---
# User Visible Output Contract Skill

## 职责

当任务需要输出 PC0~PC7、FC/SC/RC/T、CP/危险动作确认、长任务进度、最终结果、阻断原因或文件交付列表时，本 Skill 是用户可见语义与渲染的唯一 Owner。

本 Skill 只负责 `ArtifactDeliveryManifestV1 → UserFacingArtifactSetV1 → DevCodexVisibleEnvelopeV1 → renderer`。它不替代 `compliance` 的检查含义、`cp-gate` 的确认状态、`report`/`memory` 的写入职责、`host-contract-verification` 的宿主 direct replay，也不判断专业内容质量。

确定性实现位于 `hooks/_runtime/visible-output-contract.cjs`，结构约束位于 `visible-output-contract.schema.json`。

## 触发条件

| 场景 | 是否触发 |
|---|:---:|
| PC0~PC7 入口检查 | 必须；且须作为用户**首次可见**块先于实质正文与产物 mutation（S07 时序；文首补 PC ≠ 先输出） |
| FC/SC/RC/T 完成检查 | 必须 |
| CP1/CP2/CP3、危险操作或其他确认 | 必须 |
| 多批次进度、等待、阻断、恢复 | 必须 |
| 最终结果与文件交付 | 必须 |
| 仅内部状态写入且本轮无用户可见消息 | N/A + skipReason |

## 四层单向链路

1. `ArtifactDeliveryManifestV1`：记录本任务所有持久化 mutation、恢复证据和审计证据；planned、observed、internalDelivered 必须精确对账。
2. `UserFacingArtifactSetV1`：只能由 manifest 纯函数投影，禁止模型临场挑“主要产物”。
3. `DevCodexVisibleEnvelopeV1`：承载 message kind、稳定状态、checks、decision、visible set、capability 和 semantic digest。
4. renderer：按已验证能力生成 `rich-markdown / portable-markdown / plain-text`；不得改变语义集合、顺序、状态或动作。

禁止 renderer、Prompt、Hook parser 或最终回复反向补写 manifest 状态。

## ArtifactDeliveryManifestGate

每个 entry 必须包含：

`artifactId / canonicalPath / previousPath / lifecycleOperation / origin / ownership / artifactClass / deliveryRequirement / visibility / displayName / purposeKey / purposeText / userAction / readingOrder / contentDigest / evidenceRefs[]`。

- `lifecycleOperation=create|update|rename|move|delete|unchanged-evidence`；rename/move/delete 必须保留 previousPath，delete 使用 tombstone 语义。
- `visibility=decision-required|result|evidence|optional-detail|internal-only`。
- `deliveryRequirement=required|supporting|internal`；required 不得隐藏，internal 必须为 internal-only。
- `reconciliation` 必须满足 planned=observed=entries=internalDelivered；missing/unexpected/conflicting 任一非空即 BLOCK。
- 同一 artifactId 或 canonicalPath 重复、`file://`、非语义 displayName、缺 digest/evidence 均为非法。
- 根 manifest 的序列化容器不登记为自身 entry，避免 self-hash 无限递归；其 storage path 与文件 SHA256 必须由上级 ECR/validation receipt 记录。其他批次 manifest 或 raw manifest 作为普通输入时仍属于 `raw-manifest/internal-only`，不得借此例外漏记。

## UserFacingArtifactProjectionGate

默认用户面只包含：

- `decision-required`；
- `result`；
- `deliveryRequirement=required` 的 evidence。

session、daily、Agent/全局 SUMMARY、task state、checkpoint/runtime state、raw receipt、raw manifest、raw ledger 默认 `internal-only`，但仍必须写入、验证、进入 manifest 并参与 ECR。只有用户明确要求、resume/handoff、状态冲突、写入失败、治理调查、审计取证或文件本身就是审查对象时，才升级为可见。

投影 scope：

| scope | 行为 |
|---|---|
| `default` | 最小必要用户交付 |
| `all-deliverable` | 所有非 internal-only 项；用于用户要求完整交付清单 |
| `internal-audit` | 包含 internal-only；仅审计、治理调查或用户明确要求内部留痕时 |

每次投影必须满足 `listed + remaining = total`，并按 `decision-required → result → evidence → optional-detail`、readingOrder、artifactId 稳定排序。

## SemanticArtifactNameGate

- 用户面名称必须是“内容与用途”，不能只是路径、文件名、CP 编号、版本或状态。
- 每项必须同时给出 `displayName + purposeText + userAction`。
- 动作标题仅允许：`需要你确认的文件 / 本批交付文件 / 完成交付文件 / 阻断证据`。
- 禁止当前消费者输出“主要产物”或“本次会话全部产物”；历史版本文档不回填。

## LinkCapabilityDecisionGate

`LinkCapabilityDecisionV1` 必须基于当前 surface 的证据，而不是按客户端名称硬编码：

| mode | 使用条件 |
|---|---|
| `clickable` | 当前 surface 的点击能力已 direct/fixture 验证 |
| `portable` | Markdown 可用，但点击能力未验证或未知 |
| `plain` | 只保证纯文本可复制 |
| `failed` | 链接已失败或宿主无法定位目标 |

Rich clickable 只显示一个语义 Markdown 链接，不重复明文绝对路径。Portable/Plain 优先工作区相对或短路径。只有用户要求、链接失败、目标在工作区外、路径歧义或宿主无法定位时才显示绝对路径 fallback，并记录 fallbackReason。

`evidenceState=verified` 必须携带非空 `evidenceRefs`；surface 与 Envelope context 必须一致。mode、fallback、reason、target relation 或 decisionId 任一 sibling mutation 都必须 fail closed。`failed` renderer 必须给出可复制的绝对定位与 fallbackReason，不能再次输出已知失败的相对链接。

## VisibleEnvelopeGate

`messageKind` 固定为：

`entry-check / completion-check / confirmation / progress / final-result / error-block`。

状态固定为 `PASS / WARN / BLOCK / UNVERIFIED / N/A`，整体状态由 checks 严重度推导，禁止调用方覆盖；`PASS` 的 evidenceState 必须为 verified。`entry-check` 必须完整保留 PC0~PC7 及 ordinal 0~7。schema 无效、未知状态、缺必要 check、task/manifest/visible set/capability identity 不一致或 presentation 非法时，必须生成 `VISIBLE_ENVELOPE_INVALID` 的 BLOCK envelope，并强制 expanded portable 降级。

`semanticDigest` 对去展示后的 canonical semantic core 计算；presentation tier、图标、换行、点击形式和本地化 summary 不得改变 digest。

## CompactPresentationGate

只有 `entry-check` 和无待确认的 `progress` 可 compact，且必须同时满足：

- 同 project/task/contextEpoch/messageKind/semanticDigest；
- 全部 checks 为 PASS/N/A；
- 用户未要求详情。

compact 仍显示所有 check IDs、状态、整体状态、项目和“状态未变化”；不得省略计算、读取、意图判断或门禁。confirmation、error-block 永远 expanded。

## HostCapabilityHonestyGate

- 宿主未提供可解析 assistant payload 时，只能记录 `unverified`，不能断言 visible envelope 缺失。
- legacy “主要产物 + 绝对路径”文本最多识别为 `unverified-legacy`，不能升级 verified。
- direct replay 缺失时使用 portable/plain fallback，能力强度保持 unverified。
- Rich、portable、plain 的 check IDs、visible artifacts、顺序、状态、动作和 semanticDigest 必须一致。
- **Grok / passive-hook（PF-165）**：无 UserPromptSubmit 注入时仍必须输出完整 PC0~PC7；完成声明须满足 `GrokTurnChecklist`（见 `host-parity-scorecard` / `host-parity-grok.md`），不得把「无 inject」写成可省略入口或报告的理由；`full-capable` ≠ 已注入 PC0。

## 消费者同步

变更本 Skill 或 runtime 时至少联查：

- `instructions.md`、`instructions/01-common.instructions.md`、`instructions/02-output-paths.instructions.md`、`instructions/16-report.instructions.md`、`instructions/17-compliance.instructions.md`；
- `compliance`、`report`、`memory`、`document-sync`、`host-contract-verification`、`test-router`、`execution-contract`；
- precheck/compliance/progress/delivery/report prompts；
- lifecycle visible reply、host/client tests、validation manifest、package files；
- README、website、Profile、四宿主部署副本。

## 验收

- manifest 正反向 reconciliation、rename/move/delete/tombstone、重复/漏项/非法 visibility mutation 全通过。
- default/all-deliverable/internal-audit 的集合与计数守恒。
- internal-only 默认 visible=0，required hidden=0。
- 三 renderer parity，Rich clickable 绝对路径重复=0。
- 六 message kinds、PC0~PC7、compact↔expanded、unknown/invalid fail-closed 全通过。
- Hook parser 对新 envelope 为 verified-present，对 legacy 为 unverified，对未观察 payload 为 unverified。
