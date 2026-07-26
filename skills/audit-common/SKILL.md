---
name: audit-common
description: 审查公共维度 G0~G5 + Profile Freshness Check — 所有 audit 子类型必先执行的基础维度层
---
# Audit Common Skill

## 职责

所有 audit 工作流**必须先执行** G0 体量评估 + Profile Freshness Check + G1~G5 公共维度，再叠加子类型专属维度（TD/RQ/PE/RA/DA/RL）。

## G0 体量评估（前置，G1 之前执行）

G0 必须先调用 `skill-gap-analysis` 的 `ProjectArtifactScaleRoutingGate`：识别唯一项目/root，使用 bounded inventory 统计文件数、可解析字节、最大文件、目录集中度、派生产物比例和消费者扩散面，形成 `ScaleDecisionRecord` 后才允许 CRS 或内容审查。用户提示目录很大时不得降为 single-pass；项目/root 不明确时必须 blocked。

审查开始前统计待审查文件/目录总数，决定执行策略：

| 文件总数 | 策略 | 说明 |
|:--------:|------|------|
| 1~30 | 默认 single-pass 候选 | 仍需同时满足字节、最大文件、派生比例和 fan-out 预算 |
| 31~60 | 默认 batched | 输出 batch budget/checkpoint 后执行 |
| > 60 | 强制 batched 或 sampled+deep-read | 全量 inventory，不等于逐字全读 |

> 分批策略详见 [`audit-execution-guide/SKILL.md`](../audit-execution-guide/SKILL.md) §体量分批策略。

## ReReviewRuntimeFirstGate / ClosureEvidenceGate

当用户要求「再审 / 已调整 / 复审修订稿」或审查宣称 finding **closed / 可确认下一 CP / 可实施 / scheme-pass** 时：

1. **ReReviewRuntimeFirstGate**：先绑定当前正文 hash；先问「按实施计划开工，Hook/MCP/descriptor 会不会假绿？」并抽样 runtime/writer/reader；**禁止**只对照方案段落是否出现旧 finding 文案后关闭。
2. **ClosureEvidenceGate**：每条 P0/阻断关闭须双列 `designEvidence` + `runtimeOwners(writer|reader|schema|probe)` + `negativeProbe`；仅 design → 最高 `partial`，禁止写可进 CP3。
3. 外部/前序审查报告（含其他 Agent）一律 `AuditReportIsSignalNotEvidence`，须回源码/当前正文复证。
4. 探针锚点：V100。

## ReviewCoverageClaimIntegrityGate

审查报告、清单和最终回复必须区分 `inventory-covered / machine-scanned / manually-read / sampled-deep-read / executed-verified`。目录枚举、grep 命中、抽样深读和运行探针不得相互冒充。

- 声明“逐文件 / 逐服务 / 全量深读”时必须提供 `FileEvidenceLedger`，逐项记录 path、coverageLevel、evidence、status 和 unread reason。
- sampled 路线必须记录 `sampleMethod / sampledSet / unreadSet / inferenceBoundary`，不得把样本结论无条件外推到未读集合。
- executed-verified 只证明对应命令或路径，不自动证明人工阅读或全部消费者覆盖。
- 无法取得逐文件证据时必须降级声明，禁止用更强措辞包装较弱证据。
- `coverageClaims` 必须记录 claim type、evidence mode、FileEvidenceLedger 或 sampled/unread/inference boundary，供 review checklist、TestRoute、report 与 V94 复证。

## Profile Freshness Check（PFresh）

> 🔴 audit 不得默认 Profile 永远可信；在使用 Profile 做 G3 外部一致性之前，必须先反向核对 Profile 是否仍匹配当前项目事实。
> audit 统一使用 `load-profile` 的 `ProfileTruthReconciliationGate` full 模式；PFresh-1~PFresh-6 是 full 模式的强制检查集合，不得被 targeted 或 N/A 路径削弱。

| 编号 | 检查项 | 说明 |
|------|--------|------|
| PFresh-1 | 版本与包身份 | 对照 `package.json`、`plugin.json`、根 `CHANGELOG.md` 与 `changelogs/`，检查 Profile 当前版本、阶段摘要、发布状态是否过期 |
| PFresh-2 | 资产数量与目录事实 | 对照 `instructions/`、`skills/`、`prompts/`、`scripts/`、`data/templates/`、主要源码目录，检查 Profile 资产数量和目录边界是否漂移 |
| PFresh-3 | 脚本与验证路线 | 对照 `package.json scripts`、CI/发布脚本和当前 TestRoute，检查 Profile 中的测试、构建、发布命令是否仍真实可用 |
| PFresh-4 | 宿主与部署能力 | 对照 `.github/`、`.claude/`、`.codex/`、`AGENTS.md`、MCP/Hook 配置，检查 Profile 的宿主能力说明是否滞后 |
| PFresh-5 | 当前任务现实 | 对照 active-root 下当前 `requirements/`、`bugs/`、报告、SUMMARY 与 open ledger，检查 Profile 是否漏记新增边界、风险或治理能力 |
| PFresh-6 | 发布关键 Profile 字段 | 对自动发包、npm package、CLI/plugin 或 release-heavy 项目，检查 Profile 是否覆盖 CI workflow/job 矩阵、tag/publish 触发链、失败恢复路径、外部消费者验证矩阵、dist 产物边界、registry/tag 验收与常见故障诊断 |

full 模式还必须执行 repo-shape 反查：当仓库已具备 SDK/CLI、文档站、public API、CI、发布、多模块或规范控制面特征时，核对 Profile 自报档位与 `04~07` 活文档是否完整。审查报告必须输出 `profileTrustState` 和 `ProfileTruthMatrix(profileClaim / actualSources / status / conclusionAuthority / correctionRoute)`。

若任一 PFresh 项无法验证，`profileTrustState=partially-unverifiable` 且审查结论必须标注 `⚠️ Profile freshness 待验证`；若确认过期，`profileTrustState=drift-detected`，先记录审查 finding / 治理台账并以当前事实矫正本轮结论，再继续后续 G1~G5。audit 不得直接修改 Profile，也不得基于过期 Profile 宣告收敛。

## 公共维度（G1~G5）

| 维度 | 内容 | 优先级 |
|------|------|:------:|
| G1 文件完整性 | 必需章节/字段齐全，无空白占位 | 🔴 |
| G2 内部一致性 | 文档内部无矛盾（定义 vs 使用，目录 vs 正文） | 🔴 |
| G3 外部一致性 | 与引用文件/规范/代码实现不矛盾 | 🔴 |
| G4 格式规范性 | 标题层级正确，代码块有语言标记，表格对齐 | 🟡 |
| G5 链接有效性 | 内部/外部链接可访问，锚点存在 | 🟡 |

## 统一联查矩阵映射（audit = L3）

- `audit` 天生对应统一联查矩阵的 **L3 强联查**
- `CRS / G3 / PCV` 继续作为 audit 的主路径，不降级、不被其他轻量联查规则替代
- 其他工作流升级为 L3 时，应向 audit 的“关联文件全覆盖 + 收敛门禁”靠拢，而不是反过来弱化 audit
- 正式复审、ECR、发布前复审、多轮收敛、外部 finding 批次或用户要求“复审直至收敛”时，必须触发 `review-checklist`，先创建或复用复审清单文件，冻结范围和维度，再逐项执行证据核验，并通过 `ChecklistStateFreshnessGate` 确认清单状态、最新证据和收敛结论一致。

## 关联文件发现（CRS — 收敛前必须执行）

> 🔴 **CRS 是收敛的前置门禁**：宣告收敛前，必须完成关联文件发现扫描，确认审查范围已覆盖所有引用相同概念的文件。

### 执行时机

| 时机 | 说明 |
|------|------|
| **R1 范围确认前** | 建立初始文件集合时 |
| **宣告收敛前** | 作为收敛门禁的最后一步 |

### CRS 执行步骤

1. **提取关键词**：从本次修改（或被审查）的文件中提取核心概念词（规则名、文件路径、配置项名等）
2. **全库 grep**：在以下范围内 grep 这些关键词：
   - `instructions/`（Instruction 层）
   - `skills/`（Skill 层）
   - `prompts/`（Prompt 模板）
   - `agents/`（Agent 定义）
- `data/`（数据文件：gap-registry.md / pending-fixes.md / pending-issues.md 等）
   - 根目录 `*.md`（RULES.md / README.md / CHANGELOG.md）
3. **【v1.11.0+ 父链部署体扫描】**（关联 GAP-019）：
   - **检测条件**：当 cwd 是 plugin 源仓库（含 `package.json` 且 `name` 含 `devcodex`），且 cwd 父链上存在 `.github/`、`.claude/`、`AGENTS.md`、`.agents/` 或 `.codex/` 部署体
   - **触发动作**：
     a. 将工作区根的 `.claude/{instructions,skills,prompts,agents,hooks}/`、`.github/{instructions,skills,prompts,agents,hooks}/`、`AGENTS.md`、`.agents/`、`.codex/` 也纳入 grep 范围
     b. 对每个命中文件做 G3 外部一致性检查（与源仓库对应文件是否一致）
     c. 若发现部署体 / 用户级 adapter 与源仓库不一致 → 标注 `⚠️ 部署滞后`（源码仓优先 `devcodex global-adapters apply`，或 `npm install -g .` / pack+tarball；已发布用 `npm update -g devcodex`；**不要**用 bare `devcodex update` 或 `update --claude/--codex` 冒充刷全局；并运行 `node scripts/validate.js` V8 / `devcodex doctor`）
   - **目的**：避免源仓库与工作区根部署体并存时 CRS 仅扫源仓库导致误判（GAP-019 案例：F-03/F-04 因未扫父级 `e:\Worker\.claude/` 而误判为"hooks 不生效"）
   - **跳过条件**：当 cwd 即工作区根（无父链部署体）→ 跳过本步骤
  - **⚠️ V8 与 CRS 职责不可互替（PI-006，v1.9.5+）**：`scripts/validate.js` 的 V8 checkPairs 已覆盖 instructions/skills/hooks/CLAUDE.md/prompts/agents 等关键部署面，但仍只是 CI 快速门禁；CRS 手动 grep 仍是收敛前全量同步的必要补充——V8 ✅ ≠ 全量部署同步
4. **发现关联文件**：将 grep 命中且不在当前审查范围内的文件列入扩展范围
5. **补充 G3 审查**：对每个新发现文件执行 G3 外部一致性检查
6. **确认覆盖完整**：所有命中文件均已审查后，CRS ✅

> ℹ️ CRS 发现的文件只需做 G3（外部一致性），不需要完整重跑全部维度。

### CRS 示例

```text
修改了：02-output-paths §02-技术方案.md（改为条件触发）
grep "02-技术方案" instructions/ skills/
→ 命中：10-dev.instructions.md L56、cp-gate/SKILL.md L52
→ 这两个文件不在审查范围 → 加入范围 → 执行 G3 → 发现冲突 → 🔴 问题
```

## 审查发现交接循环（阻断暂停 / 非阻断入池）

> 🔴 **触发条件**：任何 audit finding 都进入交接循环，与审查对象类型无关。audit 只允许写审计报告、audit-state、记忆和 RecordRouter 台账；禁止修改或暂存被审查源码、规范、配置、测试、文档和部署副本。
>
> 🔴 **核心原则**：先分流，再交接，最后由用户决定是否启动独立修复：
> - **阻断项**：会直接影响当前控制面正确性、造成假绿、导致规则执行失真或形成明显错误指引 → 保持 open/pending，停止受影响范围的通过结论并提出显式确认请求
> - **非阻断项**：属于流程优化、模板体验、治理补强、可择期处理的问题 → 写入适当台账/问题池，状态 recorded/transferred
> - **修复动作**：仅在用户显式授权后由独立 fix/self-fix 工作流执行；audit 不自动切换、不 source mutation、不 `git add`

上述边界统一称为 `AuditMutationBoundaryGate`；每轮 finding 分流和最终报告必须记录 `auditWritableArtifacts`、`sourceMutationAuthorized=false`、`repairWorkflow` 与 `repairAuthorizationEvidence`。

### 交接循环流程

```text
开始审查
  ↓
R1：CRS + 输出发现的问题清单（只读）
  ↓
有问题？
  ├── 是 → 自我审视（实证→三列验证→对话感知→阻断/非阻断分流→盲点分析，见 §自我审视机制）
  │         ├── 阻断项 → open/pending + ConfirmationRequest → 等待用户决定是否启动独立 fix/self-fix
  │         └── 非阻断项 → 记录/转交到适当台账 → 继续可完成的审查范围
  │
  │   用户授权并完成独立修复 → audit 读取新证据 → 重启新一轮（**收敛计数归零**）
  │
  └── 否（零发现）→ 收敛计数 +1
        ├── 计数 < 3 → 继续下一轮 audit
        └── 计数 ≥ 3 → CRS 收敛门禁 → PCV → 最终报告
```

### 关键规则

| 规则 | 说明 |
|------|------|
| 🔴 **先分流再处理** | 本轮发现问题后，先完成自我审视与阻断/非阻断判定 |
| 🔴 **阻断项暂停** | 本轮阻断项保持 open/pending，停止受影响范围的通过结论并请求显式用户授权 |
| 🟡 **非阻断项入池** | 非阻断项写入适当台账/问题池，不在 audit 内穿插修复 |
| 🔴 **授权后独立修复** | 用户确认后新建/切换 fix 或 self-fix，执行其 CP/ExecutionContract；audit 不继承修复权限 |
| 🔴 **外部修复后重启** | 独立修复完成后，audit 基于新证据重新启动完整轮次（不是在旧轮次中写 fixed）|
| 🔴 **收敛计数规则** | 只有"有效零发现"的轮次才累加计数；发现问题的轮次不计入（修复后归零）|
| 🔴 **至少 3 轮有效零发现** | 收敛条件：连续 **3 轮** 均零发现，且每轮满足 `ReviewCoverageDelta` 与 `ReviewDimensionDeltaGate`（所有 audit 子类型统一标准）|
| 🔴 **CRS 门禁不变** | 声明收敛前仍须完成 CRS 全库关键词扫描 |
| ⚠️ **audit 只读不变** | audit 只维护审计产物/状态/台账；被审查源的 mutation、stage、commit 全部属于独立修复工作流 |
| 🔴 **禁止继承授权** | 用户授权 audit 不等于授权 fix/self-fix；已有 audit 上下文、模型切换或阻断严重度都不能替代显式修复确认 |
| 🔴 **判断独立性** | 用户若先给出分类/方案/目录结构，审查仍须独立比对证据；若用户判断已最优，可明确写“已验证成立”，不得为了显得客观而机械唱反调 |

### 交接循环状态追踪输出格式

每轮结束时输出当前状态（**dev 模式下在每条回复末尾必须输出，不得因元循环工作流类型而跳过**）：

```text
---
🔄 审查发现交接状态
- 当前轮次：R{N}（本大轮审查第 N 次 audit）
- 本轮发现：🔴 X 个 / 🟡 Y 个 / 💡 Z 个
- ReviewCoverageDelta：
  - ReviewedSet：本轮已复核范围
  - UnreviewedRelatedSet：由 CRS / 调用链 / 消费链 / 配置 / 测试 / 文档 / 部署副本推导出的未读相关候选
  - NewlyReadThisRound：本轮新增阅读的未审查相关面
  - RepeatReadReason：重复阅读已审查锚点的理由（高风险锚点 / 修复回归 / 抽样 / 新证据）
  - NoNewSurfaceReason：无新增阅读面时的证据化理由
- ReviewDimensionDeltaGate：
  - PreviousDimensionSet：上一轮或已完成轮次实际覆盖维度
  - CurrentDimensionFocus：本轮新增、轮换、补强或回归维度
  - NewDimensionRationale：本轮维度焦点的证据化理由
  - RepeatedDimensionReason：重复维度的理由（阻断项回归 / 高风险锚点 / 新证据 / 抽样）
- 自我审视：[M1/M2/M3/M4 盲点类型，或"N/A（零发现）"]
- 修复交接状态：[等待用户授权 / 已转独立 fix/self-fix / 已获外部修复证据 / 零发现无需交接]
- 有效零发现计数：{n}/3（达到 3 次则收敛）

🛡️ DEV 模式 | 合规检查
FC: FC1 [✅/❌] FC2 [✅/N/A] FC3 N/A FC4 [✅/❌] FC5 [✅/❌] FC6 [✅/❌] FC7 [✅/N/A]
SC: SC4 [✅/❌] SC6 [✅/❌] ...（仅列适用项，逐项实际验证后填写）
整体：✅ 全通过 / ⚠️ <N> 项待修正

📂 本次会话产物：
- [filename (类型)](workspace相对路径/skills/xxx/SKILL.md)
- [filename (类型)](workspace相对路径/file.md)
---
```

> ℹ️ 合规检查块是 dev 模式下的强制输出，审查发现交接循环不例外。FC2（报告文件）在 PCV 完成后输出最终报告时满足；中间轮次标注 N/A（进行中，未到输出节点）。
> ⚠️ **FC5 填写规则**：审计产物先进入 `ArtifactDeliveryManifestV1`，再由 `UserFacingArtifactSetV1` 投影“完成交付文件/阻断证据”。用户可见项必须有语义名称、用途和动作；session/SUMMARY/raw ledger 默认 internal-only。链接按当前 surface 的 capability evidence 选择，Rich clickable 不重复绝对路径；未观察 assistant payload 时只能 unverified。

## 审查收敛规则

| 轮次 | 规则 |
|------|------|
| R1 | **先执行初始 CRS**（见 §关联文件发现）确定关联文件范围，再输出维度清单供用户确认（可增删维度）|
| Rn | 每轮 audit 必须先输出 `ReviewCoverageDelta` 与 `ReviewDimensionDeltaGate`：优先阅读此前未审查但相关联的代码、配置、测试、文档、部署副本与消费者链，并说明本轮新增、轮换、补强或回归的维度焦点；已审查锚点和已跑维度只做高风险回归、外部修复回归、抽样或新证据复核；发现问题则触发自我审视 + 交接，不在 audit 内修复 |
| 收敛条件 | **CRS ✅** + **连续 3 轮有效零发现**（默认）+ 所有 🔴 已解决 + 🟡 已处理或标注 N/A |

- 🔴 **CRS 是收敛门禁**：必须先完成 CRS（§关联文件发现），扩展范围内的文件 G3 全通过，才允许进入收敛倒计时
- 🔴 **连续 3 轮有效零发现**为默认：无论之前已运行多少轮，必须连续 3 轮均无新发现，且每轮覆盖增量和维度增量都合格，方可声明收敛
- CRS 发现新文件时，零发现计数**重置为 0**
- 禁止提前收敛：CRS 未完成、未达到所需零发现轮次，或 `ReviewCoverageDelta` / `ReviewDimensionDeltaGate` 不合格时不得输出"已收敛"结论

### 窄范围 audit 收敛降档（SK-FIX-15b / medium）

当且仅当用户明确 **窄范围 / 单文件 / 单模块 audit**，且 ScaleDecision 为 `single-pass`、无控制面跨宿主扩散时，可将「连续有效零发现」从 **3 轮降为 2 轮**，但必须：

1. 报告写明 `convergenceMode=narrow-2` 与范围边界；
2. 仍满足 CRS ✅ 与 `ReviewCoverageDelta` / `ReviewDimensionDeltaGate`；
3. 一旦发现控制面、多消费者或范围扩大，立即恢复默认 **3 轮**。

### ReviewCoverageDelta（复审覆盖增量）

R2 及以后轮次必须维护复审覆盖增量，防止连续零发现退化为重复阅读同一批已通过内容。

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `ReviewedSet` | ✅ | 截至本轮已经实际阅读并纳入判断的文件、章节、代码路径或运行产物 |
| `UnreviewedRelatedSet` | ✅ | 由 CRS、调用链、消费链、配置、测试、文档、部署副本、报告和记忆索引推导出的未读相关候选 |
| `NewlyReadThisRound` | ✅ | 本轮新增阅读的此前未审查但相关的真实文件 / 代码 / 文档 / 产物 |
| `RepeatReadReason` | 条件 | 重复阅读已审查内容时必须说明原因，仅允许高风险锚点、修复回归、抽样或出现新证据 |
| `NoNewSurfaceReason` | 条件 | 若本轮没有新增阅读面，必须说明已通过 CRS/反向推导/消费者链确认无新增相关面 |

计数规则：

- `NewlyReadThisRound` 非空，且本轮无新增问题 → 可计入 1 次有效零发现。
- `NewlyReadThisRound` 为空，但 `NoNewSurfaceReason` 有证据支撑，且本轮无新增问题 → 可计入 1 次有效零发现。
- `NewlyReadThisRound` 为空且缺少 `NoNewSurfaceReason` → 本轮即使零发现，也不得增加收敛计数。
- 重复阅读已审查范围不能替代覆盖增量；只能作为高风险回归、修复点回归、抽样或新证据复核的补充。
- PCV 必须核验最近 3 次有效零发现的 `ReviewCoverageDelta`，确认不是用同一轮或同一批文件的机械重复凑数。

### ReviewDimensionDeltaGate（复审维度增量）

R2 及以后轮次必须维护维度增量，防止复审每次机械重复同一组维度。

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `PreviousDimensionSet` | ✅ | 上一轮或已完成轮次实际覆盖的维度集合 |
| `CurrentDimensionFocus` | ✅ | 本轮新增、轮换、补强或回归的维度焦点 |
| `NewDimensionRationale` | ✅ | 本轮维度选择依据：新增文件类型、消费者链变化、上轮盲区、风险面变化等 |
| `RepeatedDimensionReason` | 条件 | 复用上一轮维度时必须说明原因，仅允许阻断项回归、高风险锚点、新证据复核或抽样 |

计数规则：

- `CurrentDimensionFocus` 与上一轮不同，且本轮无新增问题 → 可与覆盖增量一起计入有效零发现。
- 维度完全重复但有有效 `RepeatedDimensionReason`，且本轮无新增问题 → 可计入有效零发现。
- 维度完全重复且缺少有效理由 → 本轮即使零发现，也不得增加收敛计数。
- 维度增量不要求每轮增加维度数量；它要求本轮说明“为什么这个审查视角仍然必要”。

### OmissionOnlyReviewGate（遗漏专审）

当用户要求只审查遗漏、只列未吸纳清单或排除已吸纳/没必要项时，R1 起必须切换为 omission-only：

- `ReviewedSet` 需区分“此前已覆盖 / 本轮新增覆盖 / 已吸纳或排除”。
- `UnreviewedRelatedSet` 优先纳入此前未扫的 data 台账、消费者链、部署副本、报告和记忆索引。
- 最终发现只保留此前未覆盖且仍有处理价值的遗漏项；重复项、已关闭项和无必要项只写排除理由。
- 来源为 data 吸纳时，同步执行 `WorkspaceDataAbsorptionScopeGate`，覆盖 `.devcodex/*/data/` 全命名空间。
- 同步执行 `ReviewDimensionDeltaGate`，优先补此前未覆盖的维度；若仍复用同一维度，必须给出高风险回归、新证据或抽样理由。

### ReviewFindingIntakeGate（审查发现 intake 分流）

当审查对象或输入材料包含外部审查报告、AI review finding、audit issue 或代码评审发现时，R1 起必须执行审查发现 intake 分流：

- `AuditReportIsSignalNotEvidence`：报告只是线索；每条 finding 必须有本地代码、文档、测试或运行复现证据，无法复现标 `not-reproduced` / `needs-evidence`。
- `IntentionalDesignClassification`：判断是否为 intentional design、兼容设计、性能取舍或产品策略，并记录依据、消费者影响和文档/测试承托。
- `UserDecisionBeforeMutation`：公共契约、兼容风险、设计取舍或文档/实现二选一，必须输出用户确认点，不得直接推进源码修改。
- `DocsImplementationDriftAttribution`：文档与实现不一致时，先判断文档是否合理、是否代表产品目标或历史承诺，再归因到代码、文档、示例或测试。
- `TestCoverageGapOnly`：仅测试浅、回归缺失或证据不足时，审查结论优先指向补测试/复现/验证证据，不直接要求 runtime mutation。

## 自我审视机制（Meta-Audit）

> 🔴 **触发条件**：R2 及以后轮次发现新问题时，必须在输出问题清单前先执行自我审视，分析上一轮为何漏掉该问题。

### 四轴盲点分析（每轮新发现后逐轴检查）

| 轴 | 盲点类型 | 判断条件 | 后续动作 |
|:--:|---------|---------|---------|
| M1 | **范围盲点** | 发现的文件在上一轮 CRS 扫描关键词中未命中 | 补充关键词重跑 CRS；经 `spec-governance` RecordRouter 记录 `record.audit-gap`，更新 gap-registry |
| M2 | **缺席盲点** | 问题是字段/条目"缺失"而非"错误值"，grep 无法检测 | 下一轮切换为反向推导（V4 缺席检查逻辑）；更新 gap-registry |
| M3 | **层次盲点** | 只检查了 Skill/prompt 层，未验证 Instruction 层（最高权威）| 下一轮补查所有三层；更新 gap-registry |
| M4 | **分离盲点** | 路径/名称发生变更，引用/applyTo 未跟随更新 | 下一轮 grep 新旧名称交叉确认；经 RecordRouter 更新 gap-registry |

### 执行流程

```text
R2+ 发现新问题
  ↓
步骤一：实证定位（必须）
  - 读取对应文件/代码，确认问题确实存在（不得依赖记忆、推断或会话上下文中的注入内容——上下文可能是旧版）
  - ⚠️ 修复前必须从磁盘重新读取目标文件；会话开始时注入的 Instructions 内容可能早于本次修改，以磁盘文件为准
  - 记录：文件路径 + 行号/章节 + 问题原文
  ↓
步骤二：三列验证（必须）
  - 合理性：为什么这是问题？依据是哪条规范？
  - 可实施性：修复是否有明确方案？前置条件满足？
  - 收益：修复后带来什么改善？
  ↓
步骤三：对话输出感知（必须）
  - 在对话中输出上述验证结果，让用户可见
  - ⚠️ 禁止跳过此步骤直接修复
  ↓
步骤四：决定交接状态
  - 所有文件类型先判定是否阻断当前审查结论
    - 阻断项 → 保持 open/pending，停止受影响结论并提出显式用户确认
    - 非阻断项 → 写入适当台账/问题池，标记 recorded/transferred
  - 用户显式授权后才可启动独立 fix/self-fix；独立工作流必须自行执行 CP/ExecutionContract
  - audit 内禁止 source mutation、`git add`、commit 或把修复建议直接标为 fixed
  ↓
步骤五：M1~M4 盲点分析
  - 对每个新问题逐轴过一遍 M1~M4，确定盲点类型（可多轴）
  - 先归一为 `record.audit-gap`，输出规范化意图、置信度、依据和目标台账，再追加到 data/gap-registry.md（格式：GAP-NNN，含盲点轴编号）
  ↓
下一轮带着已知盲点类型定向补查
```

> 🔴 **禁止"未分流即修"**：步骤一（实证定位）、步骤三（对话感知）和步骤四（阻断/非阻断分流）不可跳过。未经实证的问题不得执行修复；未在对话输出的验证结果，用户无法感知和纠错。

### 自我审视输出格式

```text
---
🔍 自我审视（R{N}）
- 新发现 N 个问题
- 【实证定位】[文件路径:行号] — 问题原文
- 【三列验证】
  - 合理性：[依据规范/条目]
  - 可实施性：[修复方案简述，前置条件]
  - 收益：[改善效果]
- 【盲点分析】M{X} [盲点类型]：[上一轮漏掉的原因] → 已记录 GAP-NNN
- 【交接决定】阻断项等待用户授权 / 非阻断项入池 / 已转独立 fix/self-fix（原因：[影响范围/歧义说明]）
- 下一轮定向补查：[文件/层次/关键词]
---
```

> ℹ️ 自我审视输出在问题清单之后立即输出；任何文件类型的修复都必须等待显式用户授权并进入独立 fix/self-fix，audit 不继承写入权限。

## 收敛后汇总验证（PCV）

> 🔴 强制步骤：收敛后必须执行 PCV，方可输出最终报告。

| 步骤 | 动作 |
|------|------|
| PCV-1 汇总去重 | 汇总所有轮次发现的问题，按 🔴→🟡→💡 排序，去除重复条目 |
| PCV-2 实证核查 | 对每条问题**重新读取**对应文件/代码位置（不得仅凭记忆），确认问题确实存在且描述准确。**若结论依赖运行时数据**（测试通过率、性能数字、API 响应等），**优先本轮实际执行**对应命令取得当前结果；无法执行时标注 ⚠️待验证（须注明来源为历史记录）；禁止将记忆文件历史数据直接标注为 ✅已验证 |
| PCV-3 三列验证 | 为每条已确认问题补充：合理性（依据）+ 可实施性（前置条件）+ 收益（改善效果）|
| PCV-4 分级标注 | ✅已验证（有实证）/ ⚠️待验证（推断，需用户确认）/ ❌排除（证据不支持，从报告中移除）|
| PCV-5 最终清单 | 输出过滤后的最终问题清单；❌排除 项须说明排除原因 |
| PCV-6 回归复扫（v1.9.5+）| 对 audit-state `findings[].status=fixed` 的所有项执行 `regressionProbes[].scanCmd` 复扫，对比 `expectedMatches`；任一回归 → 切回 `status=open`，`zeroFindingStreak` 归零，重启新轮 |
| PCV-7 收敛门禁 | 上述 6 步全过 + `crsPassed && pcvPassed && zeroFindingStreak>=3` 后方可宣告收敛 |

## DF 数据文件轻量检查（审查 DevCodex plugin 时执行）

> ⚠️ **触发条件**：仅当审查目标为 **DevCodex plugin 文件**（`instructions/` · `skills/` · `prompts/` · `agents/` · `RULES.md`）时，在 CRS 步骤中顺带对 `data/` 文件执行 DF 检查。
>
> ℹ️ **不适用 D1~D25**：`data/*.md` 是运营数据文件（violations/pending-fixes/gap-registry/process-improvements），不是规范定义文件，使用轻量 DF 3项检查（不走全维度审查）。

### DF 检查项

| 编号 | 检查项 | 优先级 | 说明 |
|:----:|--------|:------:|------|
| DF-1 | **标头唯一性** | 🔴 | 每条 `## GAP-NNN` / `## PF-NNN` / `## VL-NNN` / `## PI-NNN` 编号不重复（重复编号导致引用歧义）|
| DF-2 | **状态字段完整** | 🟡 | 未关闭条目必须有状态字段（如 `- 状态：` 行或表格「状态」列）；已关闭条目至少有关闭说明 |
| DF-3 | **路径引用有效** | 🟡 | 条目中引用的文件路径在 plugin 目录内实际存在（仅检查明确的相对路径）|

### 修复方式

- DF 检查发现问题 → **Pending 级**：记录 PF，不自动修复（运营数据人工决定关闭/合并策略）
- 不触发 self-fix 元循环（data/ 不在 plugin scope 内）

## Token 预算管理

- 单次审查 Token 不足时，启用**分会话模式**
- 分会话模式：每轮只审查指定维度批次，结果通过 [`memory/SKILL.md`](../memory/SKILL.md) 写入 `.devcodex/.memory/`
- 下次会话通过 `memory/SKILL.md` 恢复进度

## Git 边界（audit 不暂存、不提交）

> 🔴 audit 不执行 `git add`、commit、push，也不管理修复变更的暂存区。用户授权后的独立 fix/self-fix 按自身 ExecutionContract 和提交授权管理 Git。

### 流程

```text
audit finding → 记录/交接 → 用户显式授权独立 fix/self-fix
                              ↓
                    修复工作流自行管理 diff/Git
                              ↓
                    audit 只读取新证据并复审
```

即使用户在 audit 中要求提交，也必须先重新识别为 fix/self-fix/release 类显式动作并执行对应授权门禁；不能把 audit 的只读权限静默升级为 Git 写权限。

## 输出规范

审查报告：`reports/audit/` 目录，含问题清单表格（级别/维度/位置/描述/PCV验证状态/状态）。

> PCV验证状态列取值：✅已验证 / ⚠️待验证 / ❌排除（排除项需注明原因）
