---
applyTo: "**"
description: dev 模式合规检查规则，覆盖 FC/SC/RC/T、入口检查与完成验证
priority: P4
version: 1.17.6
---
# 合规检查规则（17-compliance）

> 本文件定义合规检查的完整规则，含 FC/SC/RC/T 四层检查。

## 模式判断（前置）

读取 ENV_MODE（参见 `01-common.instructions.md` §ENV_MODE 行为总表）：

<!-- devcodex:include shared/compliance/env-mode-table.md -->

> ⛔ S01~S06 安全底线不受 ENV_MODE 影响，无论 dev/prod 均强制；S07（全模式入口检查强制）在 instruction-fallback 模式触发（见 `00-safety.instructions.md` §S07）。dev 模式额外启用 PC4 完整规范雷达与 FC/SC/RC/T 合规检查。
> ℹ️ ENV_MODE 未注入时，默认按 `prod`（不执行合规检查）。

## 入口检查（所有模式，进入实质任务前执行）

> 🔴 **入口无例外原则**：**每一条用户消息到达 = 无条件触发完整预检查状态计算**，与消息长短、复杂度、工作流类型无关。预检查是进入实质任务前的必经门禁，不是"视任务需要选择性执行"的步骤。
>
> **入口流程操作性定义（按宿主模式分叉）**：
> 1. `hook-enforced`：当宿主支持并加载 DevCodex Hooks 时，由宿主事件优先完成 bootstrap（Profile / Memory / 待续任务 / 执行准备），并在进入实质任务前向用户暴露预检查状态。
> 2. `instruction-fallback`：当宿主不支持 Hooks 或 Hooks 未启用时，AI 必须在进入实质任务前完成 Profile + 记忆读取，并输出入口检查块 PC0~PC7。
> 3. 两种模式都必须满足同一条结果契约：**预检查状态必须早于实质任务内容对用户可见**。

> 🔴 **所有模式下无任何豁免**：无论 ENV_MODE、工作流类型（含 chat）、上下文来源（含会话摘要/checkpoint），入口检查必须执行。dev 模式输出完整 PC4 规范雷达；非 dev 模式输出 PC0~PC7 基础状态，并将 PC4 标注为 N/A（dev 扩展诊断未启用）。

> 🔴 **跨会话恢复硬约束**：当上下文来自会话摘要（summary/checkpoint）时，**不免除预检查**。摘要内容不构成 Profile 已加载的证明，也不构成记忆已读取的证明。每条新用户消息到达后，必须重新执行完整 PC0~PC7；若宿主 Hooks 已完成 bootstrap，可复用宿主结果并补齐可见状态；若处于 fallback 模式，则必须在进入任务前重新读取 Profile + 记忆，不得直接进入任务执行。

```markdown
### DevCodex · 入口检查
`[PASS/WARN/BLOCK/UNVERIFIED]` · `[项目名/未识别]` · `[DEV/PROD]`

| 项 | 内容（人话；禁止进度缩写 · 六宿主同源） |
|----|----------------------------------------|
| PC0 | 上下文：项目 · 语言 · ContextReadPlan [已形成/降级] · 必要来源回执 [verified/partial/missing] |
| PC1 | 意图：语义初判 → 扩展后工作流（有修正须写明） |
| PC2 | 会话：第 N 轮 · Token 防护 · 待跟进 ✅无 / ⚠️简述 |
| PC3 | 执行准备：唯一项目 · 未完成任务 · 产物落点（禁止「写报告 02」式施工日志） |
| PC4 | 规范雷达：dev 见 18-spec-radar；非 dev=`N/A` + skipReason |
| PC5 | 宿主：名称 + Full/Partial · 用户级 adapter/receipt 或 legacy 父链诊断 |
| PC6 | 工作区：git dirty 范围 · 任务目录 requirements/… 或 bugs/… |
| PC7 | 续接：首条须 memory_status + 有界 query；非首条可 N/A |

下一步：[一句人话]
```

> ⚠️ PC0 检查失败时（ContextReadPlan 未形成或必要来源回执 missing）不得跳过 — 必须立即形成计划并取得可验证回执后才能继续；ENV_MODE 由 Profile 的 `config.json` 决定（未加载时默认 prod）。**禁止**仅用「Profile ✅ 已加载」替代 ContextReadPlan + 回执语义。
>
> 🔴 **项目未识别处理**（v1.9.8+ / FIX-39）：与 S07「实质内容前须 PC0~PC7」协调为：
> 1. **先输出不完整入口块**：至少 PC0 写 `项目 [未识别]`，PC1~PC7 可写 `⏸ 待项目明确`（满足可见入口块，不宣称完整）。
> 2. **暂停工作流与扫描**：不得启动 dev/fix/analyze/audit 实质变更或无界工作区扫描。
> 3. 用户明确项目后，再输出**完整** PC0~PC7 并继续。
> 豁免词（同步 `lifecycle.cjs` `isMultiProjectWorkspace`）：`workspace` / `monorepo` / `全工作区` / `all projects` / `所有项目`。
>
> ⚠️ `hook-enforced` 模式下，入口检查状态可以由宿主事件驱动后显示为**首个结构化状态块**；`instruction-fallback` 模式下，入口检查块仍应尽量位于回复开头，但不再机械要求“第一批 tool call”“第一行输出”。
>
> ⚠️ **S07 自修正触发**（见 [`00-safety.instructions.md`](./00-safety.instructions.md) §S07）：AI 自检发现已开始生成实质内容但尚未输出入口检查块时，立即触发 S07 — 在当前位置补输出 PC0~PC7，重新评估意图与项目现实扩展后继续，**不等待用户重新发送消息，不终止当前请求**。
>
> 🔴 **S07 时序（VL-004 / PI-016）**：用户**首次可见** PC0~PC7 必须先于实质正文与产物 mutation（`reports/`、`.memory/`、台账 `data/*` 写入）。**「最终回复文首补 PC」≠ 已先输出入口检查**。只读准备 tool 可在首次可见入口检查之后执行。Hook 可对产物路径 safety-only 提醒或 strict 拦截，并在 Stop 记录 `s07OrderStatus=late|missing|ok|unverified`；tool-loop 宿主不保证 UI 先于任意 tool。

### PC4 规范雷达（dev 模式专属）

> ⚠️ PC4 完整规范与**唯一输出格式定义**在 18-spec-radar.instructions.md。本文件上方预检查示例块仅为说明用途，不重复定义。

### PC5 部署体状态（v1.11.0+，全模式基础项）

> 检测条件（GlobalOnly）：
> - **用户级全局 adapter**：`devcodex doctor` / receipt 与源码候选比对（configured / adapterReady / STALE）
> - **legacy 父链表面**（可选诊断）：cwd 是 plugin 源仓库且父链上仍存在 `.github/`、`.claude/`、`AGENTS.md`、`.agents/` 或 `.codex/` 时，可扫描但不作为普通 workspace 安装目标
>
> 触发动作：
> - 用户级 adapter 相对源码候选落后 / STALE → ⚠️ 标记；源码仓优先运行 **`devcodex global-adapters apply`**（或次选 `npm install -g .` / `npm pack` + tarball）；已发布环境用 `npm update -g devcodex`
> - bare `devcodex update` **只刷新 workspace `.devcodex`**，不能替代全局 adapter 刷新；`update --claude/--codex/--host` 仍 fail closed（`CLI_HOST_CONFIG_GLOBAL_ONLY`）
> - 同步 → ✅
> - 无用户级 receipt 且无 legacy 父链表面 → N/A 或按 doctor 缺失项提示
>
> 与 `scripts/validate.js` §V8 / doctor global-host 检查同源；PC5 是运行时即时检测，V8 是 CI 静态校验。

### PC6 工作区一致性（v1.9.4+，全模式基础项）

> 检测条件：项目根有 `.git/` 目录。
>
> 触发动作：
> - 检测 `git status` 是否有未提交变更
> - 检测当前对话是否在某个 `.devcodex/requirements/<X>/` 或 `.devcodex/bugs/<Y>/` 任务上下文（通过 sessions.md CP 状态推断）
> - 输出 N 文件 dirty + 当前任务目录指针，供用户提早察觉工作区漂移

### PC7 新会话首步 resume 强制检测（v1.9.4+，每次会话仅首条用户消息触发）

> 检测条件：本次为会话首条用户消息（不是后续轮次）。
>
> 触发动作（hook 强制 + AI 兜底，AI 不可跳过）：
> 1. 先按 workspace layout 解析 `<active-root>`，再读取 `<active-root>/.memory/clients/<agent>/tasks/YYYYMMDD.md`（今日）+ 昨日（如今日不存在）
> 2. 检测最末 `## 会话 NN` 的状态字段：
>    - 显式 `状态: ✅` → 上一会话完成，正常推进
>    - 显式 `状态: 🔄` 或状态字段缺失 → ⚠️ 触发 resume 提示
> 3. 比对 SUMMARY 最末行 vs tasks 最末段落状态一致性：
>    - SUMMARY ✅ + tasks 🔄/缺失 → 🔴 报警："数据不一致，可能上次 limit 截断；建议 resume"
> 4. 仅本步通过后才进入 cp-gate / 工作流路由

> ⚠️ **关键防漂移机制**：PC7 直接对应 G10 limit 截断恢复触发；防止本会话 #9 截断后未 resume 类问题复发（关联 GAP-019 → 但 GAP 仅覆盖 CRS 扫描；PC7 覆盖 resume 入口）。

## 触发时机

- **所有模式**：进入实质任务前必须输出入口检查 PC0~PC7；chat 也不豁免入口检查。

- **dev 模式**：所有工作流节点执行完毕后、回复发送前必须执行合规检查
- **prod 模式**：不执行合规检查（Instructions 直接指导 AI 行为，无需事后验证）
- 检查不通过时修正后重检（FC+SC 累计修正 ≥5 次仍未全通过 → 停止循环，输出剩余失败项摘要标 ⚠️）
- **chat 豁免** — 不执行合规检查（FC/SC/RC/T）；⚠️ PC0~PC7 入口检查对 chat 仍强制，见 §入口检查

### GovernanceIntakeClosureGate（全模式，不依赖 FC/SC 开关）

每条非空消息都先登记中性 candidate，完成合理性评估后按语义形成 `GovernanceIntakeDecision`。回复/任务收尾前检查 candidate ID、评估结论、泛化范围、现有规范状态、复合 record intents、目标台账、写入要求与证据；required 写入必须通过当前 active-root 的成功 PostToolUse/落盘 ID 复证，`record.none` 必须通过 challenge，`record.ambiguous` 保持未终结。关键词不得作为触发或分类权威；instruction-fallback 无 Hook 证据时在报告/记忆标 `unverified` 与人工复证路线。

## 执行顺序

```text
[Hook/Fallback 入口检查 PC0~PC7] → dev 模式继续 FC（形式合规）→ SC（实质合规）→ RC（恢复性检查）→ 报告二次验证（V1~V6）→ 任务完成验证（T1~T13）
```

> ⚠️ **chat 快速路径**：chat 意图在所有模式下仅执行入口检查（PC0~PC7），跳过 FC/SC/RC/T（§触发时机 §合规检查状态块 chat 豁免）。`hook-enforced` 模式下可由宿主先完成 bootstrap；`instruction-fallback` 模式下仍需在实质回答前输出入口检查状态。

> PC4 标记的 PF/VL 追加动作在此阶段开始前（即 FC 执行前）自动执行。

## 输出验证（每条建议/方案/问题必须附）

> ⚠️ 该要求同时适用于**用户面输出**与**报告正文**，不得仅在报告文件中满足。

| 验证项 | 说明 |
|--------|------|
| 合理性 | 为什么要这样做？依据是什么？ |
| 可实施性 | 能否落地执行？前置条件？ |
| 收益 | 执行后带来什么改善？ |
| 验证状态 | `✅已验证` 或 `⚠️待验证` |
| 影响范围 | 涉及哪些文件/模块 |

多建议、多路径、技术选型、后续动作选择等场景必须额外给出 `推荐结论` 或 `推荐方案`；推荐理由必须可追溯到上述五项验证。没有可推荐动作时，写明 `推荐：无后续动作` 与原因。

## FC 形式合规（不通过立即修正后重检）

| # | 检查项 |
|:-:|--------|
| FC1 | 记忆文件完整（必填字段齐全，📨 四列表格格式） |
| FC2 | 报告文件已写入（chat 豁免） |
| FC3 | CP 按序执行（dev/fix；其他 N/A） |
| FC4 | 文件名/路径合规（`NN--` 双横杠开头；本轮无报告产物时标 N/A） |
| FC5 | `ArtifactDeliveryManifestV1` 完整对账；`UserFacingArtifactSetV1` required hidden=0、计数守恒；semantic name/action/order 与 `LinkCapabilityDecisionV1` capability renderer 有效 |
| FC6 | 新增 DevCodex 规范资产 `.md` 行数检查（instructions / skills / prompts / templates / 规范源等超 500 行须按 C13 拆分；业务项目需求、技术方案、报告和正式项目文档不因 C13 强制拆分） |
| FC7 | 用户决策选项与报告决策点必带推荐 + 理由：所有 AskUserQuestion / 多选项呈现 / CP 范围选择 / 方案对比 / analyze-audit 报告决策点必须有且仅有 1 个 🟢 推荐项（首位置 + 标签含"(推荐)"或表格标 ⭐），并附一句话推荐理由；**完成态「下一步/后续建议」适用 UniqueNextStepRecommendationGate**（禁止用「或/或者」并列 ≥2 条可执行路径；探针 `classifyNextStepOrForkSample`）；没有可推荐动作时必须显式写 `推荐：无后续动作` 与原因 |

> ℹ️ **层次说明**：FC 关注“写入与输出格式是否完整落盘”，T 层关注“任务目标是否最终达成”。看似相近的检查项（如 FC1 vs T3、FC2 vs T2）属于不同验证层，前者防止漏写，后者确认闭环完成。

## SC 实质合规（🔴 阻塞性）

| # | 检查项 | 适用范围 |
|:-:|--------|---------|
| SC1 | 报告验证列完整（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围五项） | 全工作流 |
| SC2 | 代码已诊断（无未处理 error） | dev/fix 🔴 |
| SC3 | 修复已全局扫描（同类错误模式全局+数据联动+grep零残留） | fix 🔴 |
| SC4 | 关联文件已同步（workspace 运行态可用 bare `devcodex update`；用户级全局 adapter 用 `devcodex global-adapters apply` 或 npm `-g` 路径）| dev/fix/self-fix 🔴 |
| SC5 | 后续建议与推荐结论已输出；报告含多个建议/路径时必须有 `推荐结论` / `推荐方案` 且 **唯一主动作**；禁止完成态 free-text「A 或 B」同级推荐；无待跟进时显式标注“推荐：无后续动作” | 全工作流 |
| SC6 | Agent SUMMARY 已更新（写入动作已发生） | 全工作流 🔴 |
| SC7 | 全局 SUMMARY 关键决策已追加 | 有关键决策时 🔴 |
| SC8 | 上次待跟进已查阅 | 全工作流 🔴 |
| SC9 | C08 Token 防护状态 | 全工作流 |
| SC10 | C07 并发策略合规：只读/隔离验证并发需符合 `ConcurrencyPolicy`，写共享状态、同一 audit session 或 package boundary 竞争写视为阻断 | 涉及 Agent 调用或并发任务 🔴 |
| SC11 | C14 多任务拆分检查 | 任务≥5时 🔴 |
| SC12 | C14 多任务进度快照验证 | 任务≥2时 🔴 |
| SC13 | C15 架构质量自检 | dev/fix 🔴 |
| SC14 | analyze/audit（及任何宣称探针/测试结果的工作流）中，所有标注 ✅已验证 的运行时结论须满足 **MeasuredVerificationStandard**：本轮执行**生产入口命令**（如 `node scripts/test-spec-governance.js`、`npm run test:core` / `node scripts/validate.js`、需要时 `npm test`）并记录 exitCode；隔离 harness / 未复用 `createCanonicalAwareReader` 的脚本不得写成 V# 成败；SUMMARY/记忆历史数字必须降级为 ⚠️待验证。完整字段见 `skills/compliance/SKILL.md` | analyze/audit 🔴；dev/fix 宣称测试/validate 时同标 |
| SC15 | dev/fix 关键产物已完成 ECR 执行闭环复审：覆盖 CP1/CP2/CP3、实施进度（触发时）、ExecutionContract/TestRoute/ReleaseAudit/ReleaseVerification（触发时）、报告、daily tasks、SUMMARY、diff/commit、测试/探针、dirty 边界；控制面/规范/路径/模板/部署副本/validate 语义变更必须追加 SCV-0~SCV-7 证据；最后一次阻断性修正后至少再复审 1 轮且无新增阻断性问题；未满足前不得宣告完成 | dev/fix 🔴 |
| SC16 | C16 TTFV + WorkspaceRootScanBan：非 chat 首轮实质回复具备范围卡/首批结论/阻断之一；无 monorepo/workspace 根无界 Recurse inventory（含绝对根路径、`dir /s`、cwd=workspace 根时的相对 `-Recurse`/`-Depth`）；探针 `classifyTtfvOmissionSample` / `classifyWorkspaceRootScanSample`；完整字段见 `skills/compliance/SKILL.md` | 非 chat 🔴；chat N/A |

## RC 恢复性检查（非阻塞）

> chat 豁免全部；analyze 豁免 RC 层。

| # | 检查项 |
|:-:|--------|
| RC1 | 记忆文件是否足以让下一个 Agent 恢复上下文；跨会话/多批次/summary/compact/handoff 场景是否已有 `ContextHandoffCard` |
| RC2 | 已产出文件是否自洽完整 |
| RC3 | 🔄 标记任务是否提供了足够恢复线索 |
| RC4 | 关联任务的 `.memory/sessions.md` 是否已创建 |

## 报告二次验证（V1~V6）

### 🔴 阻塞性验证

| # | 检查项 |
|:-:|--------|
| V1 | 每条问题有文件来源（文件名+行号/章节） |
| V2 | 验证列+标注完整 |
| V3 | ✅已验证 的问题确实读取了对应文件；若证据为运行时数据（测试结果/性能数字/命令输出），须确认**本轮已实际执行**对应命令——记忆文件（SUMMARY.md/日记文件）中的历史数字不构成 ✅已验证 |
| V4 | 纯推测性问题已标注 ⚠️待验证；从记忆文件引用的历史执行数据未本轮重新验证时，同样须标注 ⚠️待验证 |
| V5 | 每条 🔴 级问题通过反向质疑三问 |

### V5 反向质疑三问
1. 不修复会导致什么**具体的**功能异常？→ 答不出 → 降级
2. 是否可能是**有意的设计选择**？→ 有可能 → 验证意图后再定级
3. 不修复的风险是否**可接受**？→ 可接受 → 降级为 🟡 或 💡

### 🟡 改进性验证

- **V6**：🔴 级占总问题数超 1/3 时，触发“分级标准是否过严”自检。

## 任务完成验证（T1~T13）

| alias | canonical ID | 检查项 |
|:---:|---|---|
| T1 | `requirements.coverage` | ✅ 需求覆盖 |
| T2 | `delivery.report` | ✅ 报告存在（chat 豁免） |
| T3 | `delivery.memory` | ✅ 记忆完整 |
| T4 | `confirmation.cp` | ✅ CP 完整（dev/fix；其他 N/A） |
| T5 | `governance.compliance` | ✅ 合规通过 |
| T6 | `constraints.and-sync` | ✅ 约束遵守（C01~C22 + GovernanceIntakeClosureGate 已终结或明确 unverified/ambiguous） |
| T7 | `workflow.verification` | ✅ 工作流验证（dev/fix: 适用门禁已执行，且“执行 → 扫描/验证 → ECR → 完成”正式阶段已走完；其中 fix 的三步扫描与 ECR 已完成；audit/analyze: PCV 与推荐结论已执行）|
| T8 | `continuity.summary` | ✅ SUMMARY 已更新；若触发上下文交接，daily tasks 或报告已写 `ContextHandoffCard` |
| T9 | `delivery.manifest` | ✅ internal manifest 与用户可见交付均完成；默认隐藏内部记录仍已写入、验证并纳入 ECR |
| T10 | `long-task.timing-and-coverage` | ✅ 条件：长任务 `SessionTimingCard`；确认类清单 CoverageMatrix/residual 声明 |
| T11 | `long-task.budget-and-authorization` | ✅ 条件：ExecutionBudget、LongTaskAuthorization 与 external wait 分列 |
| T12 | `deployment.and-completion-evidence` | ✅ 条件：WorkspaceSyncStatus 与 CompletionEvidenceGate |
| T13 | `post-delivery.self-check` | ✅ 条件：长任务收口/完成声明前执行 PostDeliverySelfCheck |

> ℹ️ **T 层补充**：机器契约使用 canonical ID，T1~T13 仅为兼容 alias。T2/T3/T8 验证的是最终完成态，和 FC/SC 的“写入动作是否发生”不同；只有两层都通过，才表示既没有漏写，也没有在收尾阶段失配。

## 合规检查状态块输出（仅 dev 模式，chat 豁免）

> ⚠️ chat 豁免的是**合规检查状态块**（FC/SC/RC/T），不豁免**入口检查块**（PC0~PC7）。chat 在所有模式下仍需在实质回答前输出入口检查结果，但回复末尾无需输出合规状态块。

**dev 模式完成态**（UserVisibleNoisePolicyV1 · 六宿主同源）：

| 时机 | 用户面 |
|------|--------|
| 进行中 / 未宣称完成 | **只保留入口检查 + 正文**；FC/SC/T/FVS/产物表默认不贴 |
| 宣称完成且全绿 | **短 FVS**（白话 + 命令 exitCode + 边界）；不默认 FC 全表 |
| 宣称完成有缺口 / 用户要详情 | 展开完成检查失败项 + 全量 FVS + 相关产物 |

<!-- devcodex:include shared/compliance/validation-summary.md -->

完整 FC/SC/RC/T 矩阵仍须在 **报告/记忆** 中可追溯；用户面不默认复读。

> ⚠️ **FC5**：internal manifest 与 visible set 对账仍强制（进报告）；用户面交付表仅在有用户可见产物或缺口时投影。
> ⚠️ **DevModeCompletionCheckDetailGate**：宣称完成却只有「全绿/详见报告」不合格；短 FVS 须含命令+exitCode+边界字段。
> ⚠️ chat 豁免完成块；入口检查不豁免。

## 自修复触发（不进入 self-fix 工作流）

| 触发条件 | 处理方式 |
|---------|---------|
| FC/SC 不通过 | 立即修正后重检（内联，不切工作流）|
| 连续 2 次同类偏差 | 升级分析：追加记忆 `⚠️连续违规` + 报告增加偏差分析章节 |
| 文件路径不符合规范 | 立即停止创建，迁移到正确路径 |
