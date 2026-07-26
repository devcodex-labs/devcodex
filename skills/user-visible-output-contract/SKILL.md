---
name: user-visible-output-contract
description: 用户可见输出契约 Owner — 统一入口检查、完成检查、确认、进度、结果、阻断及内部产物到用户交付的确定性投影
---
# User Visible Output Contract Skill

## 职责

当任务需要输出 PC0~PC7、FC/SC/RC/T、CP/危险动作确认、长任务进度、最终结果、阻断原因或文件交付列表时，本 Skill 是用户可见语义与渲染的唯一 Owner。

本 Skill 只负责 `ArtifactDeliveryManifestV1 → ArtifactAnchorProjectionV1 / UserFacingArtifactSetV1 → DevCodexVisibleEnvelopeV1 → renderer`。它不替代 `compliance` 的检查含义、`cp-gate` 的确认状态、`report`/`memory` 的写入职责、`host-contract-verification` 的宿主 direct replay，也不判断专业内容质量。

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

## 单向链路

1. `ArtifactDeliveryManifestV1`：记录本任务所有持久化 mutation、恢复证据和审计证据；planned、observed、internalDelivered 必须精确对账。
2. `ArtifactAnchorProjectionV1`：可选上下文锚点投影，只携带 canonical path、contentDigest、projectionDigest、truthSourceKind、stalePolicy 与 evidenceRefs，不复制正文。
3. `UserFacingArtifactSetV1`：只能由 manifest 纯函数投影，禁止模型临场挑“主要产物”。
4. `DevCodexVisibleEnvelopeV1`：承载 message kind、稳定状态、checks、decision、visible set、capability 和 semantic digest。
5. renderer：按已验证能力生成 `rich-markdown / portable-markdown / plain-text`；不得改变语义集合、顺序、状态或动作。

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

## ArtifactAnchorProjectionGate

当任务需要后续上下文续接、短投影或跨报告锚点时，必须从已验证的 `ArtifactDeliveryManifestV1` 纯函数生成 `ArtifactAnchorProjectionV1`，禁止手写锚点列表。

- `ArtifactAnchorV1` 必须包含 `artifactId / artifactKind / truthSourceKind / canonicalPath / contentDigest / projectionDigest / generatedAt / owner / status / stalePolicy / evidenceRefs[] / summaryLine / classification / anchorDigest`。
- `truthSourceKind=json-canonical|markdown-canonical|projection|external`，由 `classifyArtifactTruthSource` 按 artifactKind 决定；调用方显式覆盖时也必须落入枚举。
- JSON canonical 产物优先用于机器校验；Markdown canonical 产物可生成短 MD 投影，但短投影只能作为 `projectionDigest` 与 `summaryLine`，不能替代 canonical contentDigest。
- manifest 未对账、缺 contentDigest、非绝对 canonicalPath、`file://`、非法 status 或证据列表无效时，anchor projection 必须 invalid/BLOCK。

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

## ArtifactPathColumnGate（PF-175 / PI-155）

用户面交付表、CP 确认清单与 Envelope renderer **必须**为每项提供可定位路径，且与语义名分离：

| 规则 | 要求 |
|------|------|
| 默认列 | 自由文本表：`语义名称 \| 用途 \| 路径 \| 操作`（操作可并入用途列，但**路径列不可省**） |
| list 行 | 至少含 `displayName` + `purposeText` + `路径：…` + `操作：…` |
| 路径默认值 | **workspace-relative portable**（`path.relative(workspaceRoot)` 风格，正斜杠） |
| 绝对路径 | 仅当：用户明确要求、链接失败、`targetRelation=outside-workspace`、路径歧义、或 `absolutePathFallback` |
| Rich 并存 | Rich clickable 允许 **语义链接 href=绝对路径（便于打开）** + **路径列=portable**；**禁止**再追加冗余 `绝对路径：…` 行（除非 fallback 激活） |
| 禁止 | legacy「主要产物 / 核心文件 / 路径列表」+ 裸绝对路径且无语义名/用途/操作 |

机器分类（`classifyArtifactPathColumnSample`）：`present` / `missing-path-column` / `legacy-bare-path` / `not-claimed`。生产消费者：`lifecycle-visible-reply.analyzeArtifactDelivery` 必须调用该分类器；`missing-path-column` / `legacy-bare-path` 不得 `verified-present`。
Owner：本 Skill + `hooks/_runtime/visible-output-contract.cjs` + `lifecycle-visible-reply.cjs`；**禁止**平行新 Gate 命名体系。

与 LinkCapabilityDecision 的关系：路径列是**定位字段**，链接 mode 是**打开能力**；二者同向，不得用「Rich 不重复绝对路径」删掉 portable 路径列。

## LinkCapabilityDecisionGate

`LinkCapabilityDecisionV1` 必须基于当前 surface 的证据，而不是按客户端名称硬编码：

| mode | 使用条件 |
|---|---|
| `clickable` | 当前 surface 的点击能力已 direct/fixture 验证 |
| `portable` | Markdown 可用，但点击能力未验证或未知 |
| `plain` | 只保证纯文本可复制 |
| `failed` | 链接已失败或宿主无法定位目标 |

Rich clickable 只显示一个语义 Markdown 链接作为名称主表示，**不得**在路径列之外再重复明文绝对路径行。Portable/Plain 优先工作区相对或短路径。路径列规则见 `ArtifactPathColumnGate`。只有用户要求、链接失败、目标在工作区外、路径歧义或宿主无法定位时才强制路径列/ fallback 使用绝对路径，并记录 fallbackReason。

`evidenceState=verified` 必须携带非空 `evidenceRefs`；surface 与 Envelope context 必须一致。mode、fallback、reason、target relation 或 decisionId 任一 sibling mutation 都必须 fail closed。`failed` renderer 必须给出可复制的绝对定位与 fallbackReason，不能再次输出已知失败的相对链接。

## VisibleEnvelopeGate

`messageKind` 固定为：

`entry-check / completion-check / confirmation / progress / final-result / error-block`。

状态固定为 `PASS / WARN / BLOCK / UNVERIFIED / N/A`，整体状态由 checks 严重度推导，禁止调用方覆盖；`PASS` 的 evidenceState 必须为 verified。`entry-check` 必须完整保留 PC0~PC7 及 ordinal 0~7。schema 无效、未知状态、缺必要 check、task/manifest/visible set/capability identity 不一致或 presentation 非法时，必须生成 `VISIBLE_ENVELOPE_INVALID` 的 BLOCK envelope，并强制 expanded portable 降级。

`semanticDigest` 对去展示后的 canonical semantic core 计算；presentation tier、图标、换行、点击形式和本地化 summary 不得改变 digest。

## Dialogue-Primary Closeout（对话内可读收口 / DPC）

完成态 `final-result` / 完成宣称，以及 analyze / audit **收敛交付**时，**阅读主入口是最终回复**（对话内已渲染 Markdown），报告文件是归档/深读/审计面，不是默认阅读路径。

### 叙事最小包（强制，从宽）

| 块 | 要求 |
|----|------|
| 结果一句话 | 做成了什么 / 结论是什么 |
| 关键要点 | ≥1 条实质内容（单句含原因亦可）；禁止为凑条灌水 |
| 与 FVS | 解耦：有验证矩阵不能代替结论叙事 |
| 与交付清单 | 路径列仍要（PF-175）；**不得**用「打开 md 预览」作默认 userAction |

机器分类：`analyzeDialogueNarrativeSample` / `classifyDialogueNarrativeSample` / `hasReadableNarrativeSnippet`。

| classification | 含义 |
|----------------|------|
| `not-claimed` | 非完成/收敛语境 |
| `present` | 有可读叙事 |
| `narrative-missing` | 宣称完成/收敛但只有链接/详见报告/纯矩阵 |
| `waived` | 用户显式 override（只要路径/不要摘要等） |

负向：仅报告链接、仅「详见报告」、仅验证矩阵字段。  
正向：结果句 + 要点；analyze 须同时满足报告落盘（见 PF-169 / `link-only-thin`）。  
**B1** classifier + Skill/单测；**B2** `lifecycle-visible-reply` 在 Stop/PreCompact **有正文时**写入 `dialogueNarrativeStatus` / `analysisDeliveryStatus`，dev+reportTouched 时进入 closure reminder；无正文仍 `unverified`（Grok 诚实上限）。

默认 userAction 写「深读时打开归档报告」；**禁止**「请用 Typora/浏览器打开预览」作为默认动作。

## FinalValidationSummaryGate（PF-186 / PI-164）

dev / fix / self-fix 的 `completion-check` 或 dev 模式合规块宣告完成时，最终用户可见回复必须投影 `FinalValidationSummaryV1` 或等价短矩阵。报告可保留长日志，但最终回复不能只写“全绿 / 已通过 / 详见报告”。完成态还须满足上方 **Dialogue-Primary** 叙事最小包（与本 Gate 同时适用，不可互相抵消）。

最小字段：

| 字段 | 要求 |
|---|---|
| `commands` | 至少一条权威验证命令或明确 `skipped + reason`；执行过的命令必须列 `exitCode` |
| `runId/keyCount` | `runId`、V 范围、关键计数或检查项数量至少一类 |
| `postCommitReplay` | 出现 commit / 提交声明时必须列 post-commit replay；未提交时可写 `N/A + reason` |
| `workspaceSyncStatus` | 写明 synced / skipped / blocked 及理由 |
| `dirtyBoundary` | 写明 source-root / active-root dirty 边界，不得只写“干净”无范围 |
| `releaseActionBoundary` | 明确 push / tag / release / publish 是否执行；未执行也必须写 |
| `reportRefs` | 指向报告/清单等 required evidence，路径列仍受 `ArtifactPathColumnGate` 约束 |

机器分类：`analyzeFinalValidationSummarySample` / `classifyFinalValidationSummarySample`。负向包括：有 `completion-check` marker 但无命令、命令无 `exitCode`、只有“全绿/通过”、只链接报告、缺 workspace sync、缺 dirty boundary、缺 release boundary、提交任务缺 post-commit replay。

## EvidenceFreshness Interop

当最终回复、完成检查或交付文件列表支撑“已验证 / 已完成 / 已推送 / 推荐采纳”等 strong claim 时，`ArtifactAnchorV1`、`ArtifactAnchorProjectionV1` 与 `FinalValidationSummaryV1` 的 digest 可作为 `EvidenceFreshnessReceiptV1.evidenceRefs` 和 `dependsOn` 输入。用户面不展示内部 receipt 全文，只展示 `StaleEvidenceLintDecisionV1.status/reuseDecision` 的短摘要；缺 fresh evidence 时必须降级为 `WARN/UNVERIFIED`，不能只靠报告链接或 SUMMARY 宣称通过。

## FreeTextEntryCheckCompletenessGate（PF-087 · 自由文本入口完整性）

当用户可见回复以 **Markdown/自由文本** 输出入口检查（未走 Envelope API）时，Stop/`lifecycle-visible-reply` 不得仅因出现「入口检查 / PC0 上下文」字样判 `verified-present`：

| 规则 | 说明 |
|------|------|
| 分列必齐 | 须能识别 **PC0…PC7 各自独立** 行/单元格；缺任一 → incomplete |
| 禁止折叠 | `PC2–PC7` / `PC2-7` / `PC2~PC7` 等合并范围 → `pc-folded-range`，precheck=`verified-missing` |
| PC0 上下文 | PC0 行须含上下文/计划/项目等实质内容，不得空壳 |
| PC4 | **dev** 下 `N/A` 必须带 skipReason/跳过理由；不得无理由伪 N/A |
| Owner | 本 Skill + `hooks/_runtime/lifecycle-visible-reply.cjs`（`analyzeEntryCheckCompleteness`）；**禁止**平行新 Gate 命名体系 |

机器分类：`complete` / `incomplete` / `not-claimed`。负向 fixture：折叠行、缺 PC、dev PC4 无 skipReason。

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
- README、website、Profile、五宿主部署副本。

## 验收

- manifest 正反向 reconciliation、rename/move/delete/tombstone、重复/漏项/非法 visibility mutation 全通过。
- default/all-deliverable/internal-audit 的集合与计数守恒。
- internal-only 默认 visible=0，required hidden=0。
- 三 renderer parity：语义集合/顺序/状态/动作/digest 一致；Rich 无冗余 `绝对路径：` 行（无 fallback 时）；**三档均含 `路径：` portable 列**（PF-175）。
- 六 message kinds、PC0~PC7、compact↔expanded、unknown/invalid fail-closed 全通过。
- completion-check 正负向：`FinalValidationSummaryV1` 或等价短矩阵必须包含命令/exitCode、runId 或关键计数、workspace sync、dirty boundary、release action boundary；commit 声明必须包含 post-commit replay。
- evidence-freshness 互操作：artifact anchor / projection digest、final validation summary digest、summary-only 降级和缺命令证据负例由 `npm run test:evidence-freshness` 覆盖，并与 `npm run test:visible-output` 一起验证。
- Hook parser 对新 envelope 为 verified-present，对 legacy 为 unverified，对未观察 payload 为 unverified。
- `classifyArtifactPathColumnSample` 负向：缺路径列 / legacy 裸路径；正向：含 `路径：` 或表头路径列。
