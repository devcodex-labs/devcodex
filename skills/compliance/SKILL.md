---
name: compliance
description: 执行入口检查与 FC/SC/RC/T 合规校验。PC0~PC7 入口检查所有模式启用；仅 dev 模式执行全量合规校验，prod 模式不执行（规范已验证）。chat 豁免合规块。
---
## §0 模式判断（前置，优先执行）

读取由 [`load-profile`](../load-profile/SKILL.md) Skill 注入的 ENV_MODE（参见 [`01-common`](../../instructions/01-common.instructions.md) §ENV_MODE 行为总表）：

| ENV_MODE | 检查策略 |
|----------|---------|
| `prod`（默认）| 不执行合规检查（规范已验证，Instructions 直接指导 AI 行为） |
| `dev` | 全量执行 FC1~FC7 + SC1~SC16 + RC1~RC4 + T1~T13 |

> ⛔ **[S01~S06](../../instructions/00-safety.instructions.md) 安全底线不受 ENV_MODE 影响**，无论 dev/prod 均强制执行；**[S07](../../instructions/00-safety.instructions.md)** 在 instruction-fallback 模式下要求全模式入口检查（致命自修正）。
>
> ⚠️ **入口检查（PC0~PC7）所有模式启用**，收到用户消息后立即执行；dev 模式额外执行 PC4 完整规范雷达，非 dev 模式 PC4 标注 N/A，详见 [`17-compliance.instructions.md`](../../instructions/17-compliance.instructions.md) §入口检查。
>
> 🔴 **S07 时序**：用户**首次可见** PC0~PC7 先于实质正文与产物 mutation（报告/记忆/台账）；**禁止**最终文首补 PC 冒充已先输出。Hook 可报告 `s07OrderStatus`（ok/late/missing/unverified）。
>
> 🔴 **PC0 单源语义（ABS-07）**：用户可见 PC0 必须写 `ContextReadPlan` + 必要来源回执；`instructions.md`、`17-compliance`、`precheck-status.prompt` **同源**。禁止「Profile ✅ 已加载」单字段冒充上下文完整；PC7 使用 `memory_status` + 有界 query 回执一致表述。
>
> ℹ️ ENV_MODE 未注入（profile 未加载）时，默认按 `prod`（不执行合规检查）。

## §0.1 SpecRadarSubgate（PC4 规范雷达承接）

`SpecRadarSubgate` 是 PC4 的执行承接层：`instructions/18-spec-radar.instructions.md` 只负责入口提示和用户可见摘要，具体 Gate 分组、触发判断、ownerSkill、验证路线和 N/A 理由必须引用 `spec-governance` 的 `GovernanceGateRegistry`。

dev 模式 PC4 至少输出：

| 字段 | 要求 |
|------|------|
| `mode` | `dev` / `prod` / `unknown`；非 dev 时 PC4 可写 `N/A + skipReason` |
| `triggeredGateGroups` | 命中的 gateGroup 列表，例如 `absorption-layering`、`review-checklist`、`frontend-runtime`、`release-parity` |
| `ownerSkills` | 每个 gateGroup 的 owner Skill；不得把执行细节继续堆回 PC4 文案 |
| `requiredArtifacts` | 本轮需要的清单、报告、证据、探针或部署同步 |
| `validationRoute` | targeted test、validate 编号、SCV、人工证据或 `N/A + skipReason` |

当 PC4 命中新规范吸纳、历史长清单迁移、复审遗漏、用户文档、发布或前端运行态相关 gateGroup 时，后续报告必须引用对应 owner Skill 的证据，而不是只写“已检查规范雷达”。

### 🔴 强制可见输出（仅 dev 模式合规块，chat 豁免）

每次回复末尾**必须**输出合规检查状态块：

```text
### DevCodex · 完成检查
`PASS/WARN/BLOCK/UNVERIFIED` · `[project]`

- FC1 [状态] 记忆写入
- FC2 [状态] 报告写入
- FC3 [状态] CP 顺序
- FC4 [状态] 文件名/路径
- FC5 [状态] internal manifest 与 visible set 对账
- FC6 [状态] 规范资产行数
- FC7 [状态] 决策推荐
- SCx/RCx/Tx [状态] 仅列适用项

#### 验证摘要
| 类型 | 命令 | exitCode | runId/计数 |
|------|------|----------|------------|
| 权威/实验/skipped | `command or N/A` | `0/N/A` | `runId 或关键计数` |
WorkspaceSyncStatus：synced/skipped/blocked + reason；dirty boundary：scope + state；Release actions：push/tag/release/publish 执行边界；post-commit replay：commit 任务必填，否则 N/A + reason。

#### 完成交付文件
- [语义名称](capability-selected-target) — 用途；操作：用户动作
已列 N / 总计 M；默认隐藏 R

DevCodexVisibleEnvelopeV1 · completion-check · [状态] · [semanticDigest]
```

> ⛔ dev 模式下不输出状态块视为未执行合规检查。
> ⛔ `completion-check` 只有“全绿/已通过/详见报告”但缺 `FinalValidationSummaryV1` 短矩阵时，视为 `DevModeCompletionCheckDetailGate` 未通过。
> ⚠️ **FC5 填写规则**：触发 `user-visible-output-contract`。`ArtifactDeliveryManifestV1` 必须 planned=observed=internalDelivered，`UserFacingArtifactSetV1` 必须 required hidden=0 且 `listed+remaining=total`；session/daily/SUMMARY/task/checkpoint/raw ledger 默认 internal-only 但仍参与 ECR。链接按 `LinkCapabilityDecisionV1` 输出；Rich clickable 不重复绝对路径。Hook 未观察 payload 时只能 `unverified`，legacy 格式最多 `unverified-legacy`。
> ℹ️ prod 模式不执行合规检查，不输出状态块。
> ℹ️ chat 工作流豁免此输出。

### GovernanceIntakeClosureGate（全模式语义项）

本项不受 dev/prod 后置合规块开关影响：每条非空用户消息都必须有中性 candidate，并在合理性评估后形成 `GovernanceIntakeDecision`。收尾前检查 candidate ID、评估结论、泛化范围、现有规范状态、复合意图、目标台账、写入要求与证据；required 写入必须满足 `LedgerWriteEvidenceGate`，`record.none` 必须满足 `RecordNoneChallengeGate`，`record.ambiguous` 保持未终结。Hook 证据不可观察时只能标 `unverified`，不能把回复中的自报编号当作落账成功；instruction-fallback 必须在报告/记忆保留相同字段与人工复证路线。

### TimeToFirstValueGate + WorkspaceRootScanBan（C16 / PI-20260724-01 · 全模式防复发）

> 🔴 与 ENV_MODE 无关：非 chat 任务不得用「准备过重」制造假卡住。Owner 细节见 `skill-gap-analysis`；机器探针见 `classifyTtfvOmissionSample` / `classifyWorkspaceRootScanSample`（`host-parity-scorecard.js`）。

| 门禁 | 通过条件 | 失败处置 |
|------|----------|----------|
| **TTFV** | PC0~PC7 + 最小 ContextReadPlan 之后，**同一用户可见回复**含：范围卡 **或** 首批 finding/结论 **或** 明确阻断+恢复 | 本轮不得宣称「已启动审查/分析完成准备」；下一 tool 轮必须先交付 |
| **WorkspaceRootScanBan** | 未绑定唯一项目前不递归 workspace 根；项目可知时用直达路径；inventory 排除 `node_modules`/`dist` | 撤销/不采用该扫描结论；改用有界命令；Hook 可对根路径+Recurse `neverApprove` |
| **Skill 最小充分** | 只加载当前意图强制 bundle + 本批所需 Skill，禁止首轮通读全部 audit 子 Skill 百科 | 记 WARN；不作为「已审查」证据 |

chat / 纯确认短答：TTFV 可 `N/A + skipReason=chat-or-ack`。

### 全自动模式差异

> 显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `extensions.devcodex.autoAliases` 替换别名或明确自然语言 auto 授权模式下：

仅在 `hook-enforced` 宿主 + 白名单路径下，FC/SC 失败时自动修正（不暂停等待用户），但 [S01~S06](../../instructions/00-safety.instructions.md) 仍阻断。

`instruction-fallback` 宿主（如 JetBrains / Cursor）仅保留 auto 规则语义，不承诺 runtime 级自动行为；支持 Hook 的宿主默认采用 `safety-only`，非白名单路径输出提醒并放行，`strict` 模式下才按白名单执行 runtime 硬拦截，因此其“自动”更多体现为路径受限的 hook 提醒/门禁策略。

## §1 输出验证（每条建议/方案/问题必须附）

| 验证项 | 说明 |
|--------|------|
| 合理性 | 为什么要这样做？依据是什么？ |
| 可实施性 | 能否落地执行？是否有前置条件？ |
| 收益 | 执行后带来什么改善？ |

附加标注（每条还须标注）：

| 属性 | 说明 |
|------|------|
| 验证状态 | `✅已验证`（实际读取了源文件确认；**运行时/探针/测试结论还须满足下方 MeasuredVerificationStandard**）或 `⚠️待验证`（基于推测/上下文推断/非权威实验） |
| 影响范围 | 涉及哪些文件/模块（一句话描述） |

### MeasuredVerificationStandard（SC14 承接 · 全工作流运行时结论）

凡报告或用户面将测试、探针、validate、性能数字、命令输出标为 `✅已验证`：

| 规则 | 要求 |
|------|------|
| 权威入口 | 必须执行**生产入口命令**，例如 `node scripts/test-spec-governance.js`、`npm run test:core` / `node scripts/validate.js`、需要 full 时用 `npm test`；并记录命令与 exitCode |
| 非权威实验 | 自写隔离 harness、裸 `fs.read` + `includes`、未复用 `validate.js` 同款 `createCanonicalAwareReader`/ROOT/上下文 的脚本 → 只能标 `非权威实验` 或 `⚠️待验证(生产路径)`，**不得**写成 V# 失败/通过或「今日验收不通过/通过」 |
| 等价条件 | 隔离脚本若宣称与某 V# / suite 等价，必须复用生产 `read` 路径与上下文，并在报告写 parity 证据 |
| 历史数字 | SUMMARY / 记忆 / 旧报告中的数字不得直接冒充本轮 `✅已验证` |

若报告或用户面输出包含多个可执行建议、多个后续路径、方案对比或决策点，必须额外给出 `推荐结论` / `推荐方案`，且推荐理由可追溯到五项验证；无后续动作时写明 `推荐：无后续动作`。

### UniqueNextStepRecommendationGate（FC7 / SC5 完成态扩展 · PF-172）

凡用户可见 **完成态 / 收口 / 台账批次结束** 的「下一步 / 后续建议 / 推荐结论」：

| 规则 | 要求 |
|------|------|
| 唯一主动作 | 有且仅有 **1** 条可执行主动作（一句可验收）；禁止把 ≥2 条可执行路径写成同级推荐 |
| 禁止「或」并列 | **禁止**用「或 / 或者」在推荐主面上连接两条可执行路径（如「对齐 VL 表或挑 PF 链路」）；机器分类见 `classifyNextStepOrForkSample` → `or-fork` 即失败 |
| 备选降级 | 非推荐路径只能放在「不推荐 / 明确劣于推荐」小节，并写清为何不选；不得与推荐同级 |
| 无动作 | 无后续时写 `推荐：无后续动作`，不得硬凑二选一 |
| 与 CP 前门禁关系 | CP 确认前的 A/B/C 仍由 `UniqueRecommendationBeforeConfirmGate` / `NoPreferenceMenuAfterConvergenceGate` 覆盖；本门禁补 **free-text 完成态** 缺口（VL-077 / PI-151） |

### ControlPlaneDisciplineProbeBundle（PF-138/139/140 · 2026-07-21 吸纳）

| 分类器 | 失败码 | 覆盖 |
|--------|--------|------|
| `classifyPreferenceMenuAfterConvergenceSample` | `preference-menu` | 收敛后希望哪种 / A/B/C |
| `classifyCpArtifactBeforeConfirmSample` | `missing-cp-artifact` | 确认 CP 无产物路径 |
| `classifyCodeTruthMatrixAtCpSample` | `missing-code-truth-matrix` | 控制面定稿无 CodeTruth 矩阵 |
| `classifyControlPlaneDigestSample` | `missing-digest` | 控制面确认无 sha/digest |
| `classifyAuthorSelfReviewBoundarySample` | `author-self-review-as-independent` | 作者自审冒充独立审查 |
| `classifyNextStepOrForkSample` | `or-fork` | 完成态「或」双主动作 |

生产入口：`npm run test:discipline-execution`。Owner：`cp-gate` + `compliance` + `dev-plan-review` + `expert-output-quality`。

## §2 形式合规（FC）— 不通过立即修正后重检

| # | 检查项 |
|:-:|--------|
| FC1 | 记忆文件完整（必填字段齐全，状态 🔄/✅；📨 对话记录必须为四列表格格式：`轮次 \| 👤 用户消息 \| 🤖 AI执行 \| 状态`，三列或项目符号格式不通过） |
| FC2 | 报告文件已写入（chat 豁免） |
| FC3 | CP 按序执行（dev/fix；其他 N/A） |
| FC4 | 文件名/路径合规（`NN--` 双横杠开头） |
| FC5 | `ArtifactDeliveryManifestV1` 完整对账；`UserFacingArtifactSetV1` required hidden=0、计数守恒；semantic name/action/order 与 capability renderer 有效 |
| FC6 | 新增 DevCodex 规范资产 `.md` 行数检查（instructions / skills / prompts / templates / 规范源等超 500 行须按 [C13](../../instructions/01-common.instructions.md) 拆分；业务项目需求、技术方案、报告和正式项目文档不因 C13 强制拆分） |
| FC7 | 用户决策选项与报告决策点必带推荐 + 理由：所有 AskUserQuestion / 多选项呈现 / CP 选项 / 方案对比 / analyze-audit 报告决策点必须有且仅有 1 个推荐项，推荐项置首且说明推荐理由；**完成态「下一步/后续建议」适用 UniqueNextStepRecommendationGate**（禁止「或」并列双主动作）；无后续动作时写明 `推荐：无后续动作` |

## §3 实质合规（SC）— 🔴 阻塞性

| # | 检查项 | 适用范围 |
|:-:|--------|---------|
| SC1 | 报告验证列完整（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围五项） | 全工作流 |
| SC2 | 代码已诊断（无未处理 error） | dev/fix 🔴；其他 N/A |
| SC3 | 修复已全局扫描（三步扫描：同类全局+数据联动+grep零残留） | fix 🔴；dev(重构) 🔴 |
| SC4 | 关联文件已同步 | dev/fix/self-fix 🔴 |
| SC5 | 后续建议与推荐结论已输出（报告含 `## 后续建议` / `## 推荐结论` / `## 推荐方案` 或等效内容；**有且仅有 1 条主动作**；禁止完成态用「或/或者」并列 ≥2 条可执行路径；备选须标「不推荐」+ 理由；无待跟进时显式标注“推荐：无后续动作”即通过；探针 `classifyNextStepOrForkSample`） | 全工作流 |
| SC6 | Agent SUMMARY 已更新（`.memory/clients/<agent>/SUMMARY.md`） | 全工作流 🔴 |
| SC7 | 全局 SUMMARY 关键决策已追加（仅规范变更/架构决策/P0修复） | 有关键决策时 🔴 |
| SC8 | 上次待跟进已查阅（首次会话 N/A） | 全工作流 🔴 |
| SC9 | [C08](../../instructions/01-common.instructions.md) Token 防护状态（>10轮关注 / >13轮预警 / >15轮防护） | 全工作流 |
| SC10 | [C07](../../instructions/01-common.instructions.md) 并发策略合规：只读/隔离验证并发需符合 `ConcurrencyPolicy`，写共享状态、同一 audit session 或 package boundary 竞争写视为阻断 | 涉及 Agent 调用或并发任务 🔴 |
| SC11 | [C14](../../instructions/01-common.instructions.md) 多任务拆分检查（≥5任务需建议拆分会话） | 任务≥5时 🔴 |
| SC12 | [C14](../../instructions/01-common.instructions.md) 多任务进度快照验证（每完成子任务有 T{N}进度 标记） | 任务≥2时 🔴 |
| SC13 | [C15](../../instructions/01-common.instructions.md) 架构质量自检（dev plan-review 三维评估；fix CP2 三维评估） | dev/fix 🔴 |
| SC14 | analyze/audit（及任何宣称探针/测试结果的工作流）中，所有标注 ✅已验证 的运行时结论须满足 **MeasuredVerificationStandard**：本轮执行**生产入口命令**并记录 exitCode；隔离 harness / 非生产 reader 不得写成 V# 成败；SUMMARY/记忆历史数字必须降级为 ⚠️待验证 | analyze/audit 🔴；dev/fix 宣称测试/validate 时同标 |
| SC14a | 强主张证据新鲜度：报告、分析、审查、推荐、CP 可确认或完成态声明命中 `evidence-freshness` 时，须有 `StaleEvidenceLintDecisionV1`；summary-only 不得单独支撑 ✅已验证 / 推荐 / 可确认 | analyze/audit/dev/fix/self-fix 🔴 |
| SC15 | dev/fix 关键产物已完成 ECR 执行闭环复审：覆盖 CP1/CP2/CP3、实施进度（触发时）、ExecutionContract/TestRoute/ReleaseAudit/ReleaseVerification（触发时）、报告、daily tasks、SUMMARY、diff/commit、测试/扫描证据、dirty 边界；最后一次阻断性修正后至少再复审 1 轮且无新增阻断性问题 | dev/fix 🔴 |
| SC16 | [C16](../../instructions/01-common.instructions.md) TTFV + WorkspaceRootScanBan：非 chat 首轮实质回复具备范围卡/首批结论/阻断之一；无 workspace 根无界 Recurse inventory（绝对根路径、`dir /s`、cwd=workspace 根时的相对 `-Recurse`/`-Depth`）；探针 `classifyTtfvOmissionSample` / `classifyWorkspaceRootScanSample` | 非 chat 🔴；chat N/A |

## §4 恢复性检查（RC）— 非阻塞

> **豁免**：chat 豁免全部合规检查；analyze 豁免 RC 层（只读工作流，多轮收敛但每轮不写恢复性记忆）。

| # | 检查项 |
|:-:|--------|
| RC1 | 记忆文件是否足以让下一个 Agent 恢复上下文；跨会话/多批次/summary/compact/handoff 场景是否已有 `ContextHandoffCard` |
| RC2 | 已产出文件是否自洽完整 |
| RC3 | 🔄 标记任务是否提供了足够恢复线索 |
| RC4 | 关联需求的 `.memory/sessions.md` 是否已创建 |

## §5 报告二次验证（报告写入后执行）

### 🔴 阻塞性验证

| # | 检查项 |
|:-:|--------|
| V1 | 每条问题有文件来源（文件名+行号/章节） |
| V2 | 验证列+标注完整（回读报告文件确认） |
| V3 | ✅已验证 的问题确实读取了对应文件 |
| V4 | 纯推测性问题已标注 ⚠️待验证 |
| V5 | 每条 🔴 级问题通过反向质疑三问（不修复的具体后果/是否有意设计/风险可否接受） |

### V5 反向质疑三问

逐条对 🔴 级问题执行：
1. 不修复会导致什么**具体的**功能异常？→ 答不出 → 降级
2. 是否可能是**有意的设计选择**？→ 有可能 → 验证意图后再定级
3. 不修复的风险是否**可接受**？→ 可接受 → 降级为 🟡 或 💡

### 🟡 改进性验证

| # | 检查项 |
|:-:|--------|
| V6 | 🔴 级占总问题数超 1/3 时，触发"分级标准是否过严"自检 |

## §6 任务完成验证

| alias | canonical ID | 检查项 |
|:---:|---|---|
| T1 | `requirements.coverage` | ✅ 需求覆盖（用户所有需求点已处理） |
| T2 | `delivery.report` | ✅ 报告存在（chat 豁免） |
| T3 | `delivery.memory` | ✅ 记忆完整（任务摘要+对话记录+关联报告） |
| T4 | `confirmation.cp` | ✅ CP 完整（dev/fix；其他 N/A） |
| T5 | `governance.compliance` | ✅ 合规通过（FC+SC 全通过） |
| T6 | `constraints.and-sync` | ✅ 约束遵守（C01~C22 + 关联文件已同步 + GovernanceIntakeClosureGate 已终结或明确 unverified/ambiguous） |
| T7 | `workflow.verification` | ✅ 工作流验证（dev/fix: 扫描/验证 + ECR 已执行；audit/analyze: PCV 与推荐结论已执行）|
| T8 | `continuity.summary` | ✅ SUMMARY 已更新；若触发上下文交接，daily tasks 或报告已写 `ContextHandoffCard`；若主动建议新会话，同回复已交付 `NewSessionContinuationCard` |
| T9 | `delivery.manifest` | ✅ internal manifest 与用户可见交付均完成；默认隐藏内部记录仍已写入、验证并纳入 ECR |
| T10 | `long-task.timing-and-coverage` | ✅ 条件：长任务是否记录 `SessionTimingCard`（或 N/A+skipReason）；确认类清单是否含 CoverageMatrix 或 residual 声明（ABS-17/18） |
| T11 | `long-task.budget-and-authorization` | ✅ 条件：长任务/Auto/多批次是否具备 `ExecutionBudget` + `LongTaskAuthorization`（或 N/A+skipReason）；有等待面时是否分列 external wait（PI-118/PF-137） |
| T12 | `deployment.and-completion-evidence` | ✅ 条件：触及部署消费者时是否输出 `WorkspaceSyncStatus`；dev/fix/self-fix 宣称完成时是否通过 `CompletionEvidenceGate`（ECR + 同步/验证/dirty 证据） |
| T13 | `post-delivery.self-check` | ✅ 条件：长任务收口 / 宣称完成 / 用户质疑慢漏时是否执行 `PostDeliverySelfCheck`（或 N/A+skipReason）；不得用自评刷 PI |

机器消费者必须使用 canonical ID；T1~T13 只用于现有文档、人工清单与兼容投影，不得作为新状态键。

## §7 自修复触发

| 触发条件 | 处理方式 |
|---------|---------|
| FC/SC 检查不通过 | 立即修正后重检（FC+SC 累计修正 ≥5 次仍未全通过 → 停止循环，输出剩余失败项摘要标 ⚠️，写入记忆后交由用户决策） |
| 连续 2 次同类偏差 | 升级分析（追加记忆 `⚠️连续违规` + 报告增加「规范偏差分析」章节）；**不自动进入 self-fix**（防递归） |
| 文件路径不符合 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md) | 立即停止创建，迁移到正确路径 |
| 规范文件修改后引用未同步 | 交叉验证后修正 |

