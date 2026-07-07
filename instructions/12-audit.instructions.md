---
applyTo: "**"
description: audit 工作流规则，覆盖审查目标路由、收敛门禁、元循环与只读边界
priority: P4
version: 1.11.27
---
# 审计工作流规则（12-audit）

> 本文件定义 audit 工作流的完整规则，含 7 个审查目标类型和收敛规则。

> ⚠️ **PC4 关系说明**：`18-spec-radar` 的 PC4 结果作为 audit R1 的初始输入，帮助 AI 提前锁定规范盲区；进入 audit 轮次后，同一问题不得再以 PF 重复登记一次，避免 PC4 与 audit 双重记录。

## 核心约束

### 跨会话状态持久化（v1.9.2+）

- 所有 audit 启动时必须读取/创建 `<audit-root>/.audit-state/<session-id>.json`（详见 `skills/audit-session/SKILL.md`）
- 每轮收敛后 / Token 防护触发 / 用户中断时必须更新状态
- `<audit-root>` 取值与 active-root 一致：旧布局为 `<项目根>/.devcodex`，集中布局单项目为 `<工作区根>/.devcodex/<project>`，全工作区为 `<工作区根>/.devcodex/workspace`
- resume 意图须优先扫描 `<audit-root>/.audit-state/*.json`：若存在 state ∈ {paused, active, resumed} 的最新会话，提示恢复
- 收敛门禁强制校验：`crsPassed && pcvPassed && zeroFindingStreak >= 3`

### 只读约束（绝对）
- **audit 是只读工作流**：执行中禁止修改任何文件
- 发现问题只输出清单和变更建议
- **需要修复时**：DevCodex plugin 文件（`instructions/` · `skills/` · `prompts/` · `agents/` · `RULES.md`）→ 先做阻断/非阻断分流：阻断项进入元循环自动 self-fix，非阻断项写入 `data/pending-issues.md`（见 §审查元循环）；其他文件/代码 → 记录 PF/VL，由用户决定时机启动 fix 或 self-fix
- 用户已给出结论、分类或目录方案时，audit 仍须按证据独立验证；若核验后用户判断成立，可直接写明“已验证成立”，不得为了显得客观而反向挑错

> **设计原则：记录在使用，修复在维护** — 正常开发工作流（dev/fix/analyze）中 PC4 发现规范缺口，先经 `spec-governance` 的记录意图识别与 RecordRouter 分流，再写入运行时 Pending 台账（如 `data/pending-fixes.md`），不触发任何修复；源仓内该台账由 `data/templates/` 提供模板，维护者实录按 active-root 写入（workspace-namespace 单项目如 `.devcodex/<project>/data/`）。只有 audit 明确针对 DevCodex plugin 文件本身时，才进入立即修复的元循环。

### 审查目标类型

| 意图 | 目标类型 |
|------|---------|
| 规范文件/specs 审查 | 规范文件 |
| 技术方案/架构设计 | 技术方案 |
| 需求文档/PRD | 需求文档 |
| 项目工程/代码质量 | 项目工程 |
| 报告文件 | 报告 |
| 一般文档 | 通用文档（README / 用户使用文档额外叠加 `audit-readme`） |
| 发布前审查 / release pre-review / publish 或 tag 前风险 review | 发布前审查（加载 `audit-release`） |

- 基于用户意图智能识别，不依赖关键词

## 公共维度（G1~G5，所有审查必先执行）

| 维度 | 内容 | 优先级 |
|------|------|:------:|
| G1 文件完整性 | 必需章节/字段齐全，无空白占位 | 🔴 |
| G2 内部一致性 | 文档内部无矛盾 | 🔴 |
| G3 外部一致性 | 与引用文件/规范/代码实现不矛盾 | 🔴 |
| G4 格式规范性 | 标题层级正确，代码块有语言标记 | 🟡 |
| G5 链接有效性 | 内部/外部链接可访问 | 🟡 |

## 审查元循环（阻断即修 / 非阻断入池）

> 🔴 **触发前置条件**：元循环只在审查 **DevCodex plugin 文件**（`instructions/` · `skills/` · `prompts/` · `agents/` · `RULES.md`）时启动。审查其他类型文件时，发现问题 → 记录 PF/VL → 继续下一轮，**不触发 self-fix**。
>
> 🔴 audit 是只读工作流，但**元循环不是**：每发现一批 DevCodex plugin 问题后，先做阻断/非阻断分流；阻断项立即自我审视 + self-fix 修复，并在修复后重新启动新一轮 audit；非阻断项写入 `data/pending-issues.md`，继续当前 audit。禁止把阻断项拖到所有轮次结束后再批量修复。

> 🔴 **累计文件上限**：单次 audit 会话内，元循环累计通过 self-fix 修改的 DevCodex plugin 文件总数不得超过 10 个。达到上限后必须输出 `⛔ AUDIT-LOOP-LIMIT`，建议用户拆分为新会话继续，禁止在当前 audit 会话内继续扩大修改面。

```text
【非 plugin 文件审查】
发现问题 → Intent Detection → RecordRouter → 记录 PF/VL/ISSUE/GAP → 继续下一轮（不触发 self-fix）

【DevCodex plugin 文件审查】
发现问题 → 阻断/非阻断分流
         → 阻断项：自我审视五步（实证→验证→感知→修复→盲点，见 `audit-common §自我审视机制`）
         →        self-fix 修复 → 重启新一轮 audit → 再次发现？→ 再次分流...
         → 非阻断项：写入 `data/pending-issues.md` → 继续当前/下一轮 audit
         → 连续 3 轮有效零发现 → CRS 门禁 → PCV → 收敛
```

## 多轮收敛规则

| 轮次 | 规则 |
|------|------|
| R1 | **先执行初始 CRS**（见 `audit-common §关联文件发现`）确定关联文件范围，再输出维度清单供用户确认（可增删维度）|
| Rn | 每轮先输出 `ReviewCoverageDelta` 与 `ReviewDimensionDeltaGate`，优先阅读此前未审查但相关联的代码、配置、测试、文档、部署副本和消费者链，并调整本轮维度焦点；重复审查已读范围或同一维度组合只能作为高风险锚点、修复点回归、抽样或新证据复核；**plugin 文件发现问题先做阻断/非阻断分流：阻断项触发自我审视 + self-fix 修复并重启新轮，非阻断项写入 `data/pending-issues.md` 后继续**（见 `audit-common §审查元循环`）；**非 plugin 文件发现问题则记录 PF/VL，继续下一轮** |
| 收敛前门禁 | **CRS ✅**（见下方说明）|
| 收敛条件 | **连续 3 轮有效零发现**（仍须满足连续 3 轮零发现；所有子类型统一，不区分定向/全面），同时所有 🔴 已解决 + 🟡 已处理或标注 N/A |

- 未收敛时自动进入下一轮，**不询问用户**
- 🔴 **CRS 收敛门禁**：宣告收敛前，必须在 `instructions/` 和 `skills/` 全库 grep 本次审查涉及的核心关键词，确认所有引用相同概念的文件均已纳入审查范围并完成 G3 检查；CRS 发现未审查文件时，**零发现计数重置为 0**
- 🔴 **连续 3 轮有效零发现**：必须是**修复后重启的新轮次**均零发现，且每轮 `ReviewCoverageDelta` 与 `ReviewDimensionDeltaGate` 合格；不得用同一轮、同一批文件、同一组维度或无新增覆盖证据的重复检查凑数
- 🔴 **零发现精确定义**：当轮全维度检查完成后，无任何新增 PF/VL 记录，且无待修复的 plugin 文件问题；PCV 阶段被标记为 `❌排除` 的条目不重置零发现计数，self-fix 执行失败则该轮不得计入零发现，且必须在修复后重启新轮重新计算
- 禁止提前收敛：CRS 未完成、未达到 3 轮零发现，或最近 3 次零发现缺少有效 `ReviewCoverageDelta` 时不得输出"已收敛"结论

### ReviewCoverageDelta（复审覆盖增量）

R2 及以后轮次必须把复审从“机械重复已读范围”改为“覆盖面递增 + 风险回归抽样”。每轮至少输出并在报告中保留以下字段：

| 字段 | 说明 |
|------|------|
| `ReviewedSet` | 已经阅读并纳入判断的文件、章节、代码路径或运行产物 |
| `UnreviewedRelatedSet` | 由 CRS、调用链、消费链、配置、测试、文档、部署副本、报告和记忆索引推导出的未读相关候选 |
| `NewlyReadThisRound` | 本轮新增阅读的此前未审查但相关的真实文件 / 代码 / 文档 / 产物 |
| `RepeatReadReason` | 重复阅读已审查内容的理由，仅允许高风险锚点、修复回归、抽样或出现新证据 |
| `NoNewSurfaceReason` | 本轮无新增阅读面时，说明为什么已无新的相关面可读 |

- `NewlyReadThisRound` 非空且本轮无新增问题，或 `NoNewSurfaceReason` 有证据支撑且本轮无新增问题，才可计为一次有效零发现。
- `NewlyReadThisRound` 为空且缺少 `NoNewSurfaceReason` 时，本轮零发现不得增加收敛计数。
- `UnreviewedRelatedSet` 非空时，下一轮必须优先读取其中高相关项；不得连续重复读取同一批已通过文件来替代覆盖增量。

### ReviewDimensionDeltaGate（复审维度增量）

R2 及以后轮次必须把复审从“同一维度反复跑一遍”改为“覆盖面递增 + 维度焦点递进 + 风险回归抽样”。每轮至少输出并在报告中保留以下字段：

| 字段 | 说明 |
|------|------|
| `PreviousDimensionSet` | 上一轮或已完成轮次实际覆盖的维度集合，而不是模板默认维度全集 |
| `CurrentDimensionFocus` | 本轮重点审查的新增、轮换、补强或回归维度 |
| `NewDimensionRationale` | 为什么本轮选择这些新维度或新组合，例如新增文件类型、消费者链变化、上轮盲区、风险面变化 |
| `RepeatedDimensionReason` | 复用上一轮维度时的证据化理由，仅允许阻断项回归、高风险锚点、新证据复核或抽样 |

- 连续轮次不得无理由重复同一组维度、同一批文件和同一验证问题来凑“复审完成”。
- 若 `CurrentDimensionFocus` 与 `PreviousDimensionSet` 完全相同，且缺少有效 `RepeatedDimensionReason`，本轮即使零发现也不得计入有效零发现。
- `ReviewDimensionDeltaGate` 不要求每轮覆盖更多维度数量；它要求本轮说明“为什么这些维度仍然是本轮最有价值的审查视角”。

### ReviewChecklistCompletenessGate / EvidenceExecutionGate（审查清单证据化）

长链路修复、风险簇复审、外部 finding 批次、发布前审查或用户要求“按清单逐项复审”时，冻结 Review Checklist 后不得只检查“清单是否存在”：

- 每个清单项必须绑定代码 / 类型 / 测试 / 文档 / 配置证据，至少包含行号、命令输出、测试结果或反向缺席扫描之一。
- `ReviewedSet` 与 `explicit exclusions` 必须随清单项记录；CRS 命中但不纳入的文件要写 exclusion reason。
- 语法、parser、serializer、module-format 等风险不得只列已修 case；应按 lexical token class、语法类别或入口类型反向枚举。
- 若清单项没有可复现证据，本轮不能宣告该项审查通过，只能标 `needs-evidence`。

### OmissionOnlyReviewGate（遗漏专审）

用户明确要求“只审查遗漏 / 上次没检查的 / 不要列已吸纳或没必要项”时，audit/analyze/review 必须切换为 omission-only 范围：

- 先列明用户限定范围、指定轮次、此前已覆盖集合、已吸纳/排除集合和本轮新增覆盖集合。
- 最终清单只保留“此前未覆盖且仍有吸纳或修复价值”的遗漏项；已吸纳、已关闭、重复项或明确无必要项只能写入排除理由，不进入最终待吸纳清单。
- 复审仍须满足 `ReviewCoverageDelta`，并在 `NewlyReadThisRound` 中优先覆盖此前未读的 data 台账、消费者链、部署副本、报告和记忆索引。
- 复审还须满足 `ReviewDimensionDeltaGate`，优先补上此前未覆盖的维度或解释为什么同一维度仍是高风险回归点。
- 若遗漏审查来源是“data 目录吸纳”，必须同时执行 `WorkspaceDataAbsorptionScopeGate`，扫描 `.devcodex/*/data/` 全部命名空间。

### GeneratedSiteGate / ManualTocDuplicationGate / UserPathContractSweep

文档站、官网、公开能力页或 README 专项审查涉及导航、footer、sidebar、语言切换、outline、正文目录、安装命令、quick start、配置契约或首次成功路径时，必须补生成产物和用户路径审查：

- `GeneratedSiteGate`：以当前构建产物或当前可运行预览为准，检查 header、top menu、mobile menu、footer language block、sidebar、outline 和 CSS 可见状态；报告区分“DOM 存在但 CSS 隐藏”和“真实可见重复 / 丢失”。
- `ManualTocDuplicationGate`：扫描 Markdown 手写 `## 目录` / `## Table of Contents` / `## 目录导航`，并与生成页右侧或移动端 outline 比较，防止正文 TOC 与自动 outline 可见重复。
- `UserPathContractSweep`：公开能力页必须核对安装版本、构造函数示例、配置字段类型、相邻专题链接、API 索引和 sidebar 章节，证据来源为 `package.json`、public types、runtime wiring、示例源码和当前文档。

### ReviewFindingIntakeGate（审查发现 intake 分流）

外部审查报告、AI review finding、audit issue 或代码评审发现进入结论、修复建议或 fix/dev 范围前，必须先执行 `ReviewFindingIntakeGate`：

- `AuditReportIsSignalNotEvidence`：报告只是线索，不是证据；每条 finding 需补本地代码、文档、测试或运行复现证据，无法复现时标 `not-reproduced` 或 `needs-evidence`。
- `IntentionalDesignClassification`：先判断是否为 intentional design、兼容设计、性能取舍或产品策略；若成立，记录设计依据、消费者影响和文档/测试承托。
- `UserDecisionBeforeMutation`：命中 `user-decision-required`、公共契约变化、兼容风险、设计取舍或文档/实现二选一时，提出用户确认点，不得直接给出“已修代码”结论。
- `DocsImplementationDriftAttribution`：文档与实现不一致时，需判断文档是否合理、是否代表产品目标或历史承诺，再决定修代码、修文档、修示例或补测试。
- `TestCoverageGapOnly`：若 finding 本质是测试断言浅、回归缺失或证据不足，结论应优先指向补测试、复现脚本或验证证据，不直接要求 runtime mutation。

## 收敛后汇总验证（PCV）

> 🔴 强制步骤：所有轮次收敛后，必须执行 PCV，方可输出最终报告。

| 步骤 | 动作 |
|------|------|
| PCV-1 汇总去重 | 汇总所有轮次发现的问题，按严重级别排序（🔴→🟡→💡），去除轮次间重复条目 |
| PCV-2 实证核查 | 对每条问题，**重新读取**对应文件/代码位置（不得仅凭记忆），确认问题确实存在且描述准确。**若结论依赖运行时数据**（测试通过率、性能数字、API 响应等），**优先本轮实际执行**对应命令取得当前结果；无法执行时标注 ⚠️待验证（须注明来源为历史记录）；禁止将记忆文件历史数据直接标注为 ✅已验证 |
| PCV-2a 覆盖增量核查 | 核验最近 3 次有效零发现的 `ReviewCoverageDelta`：确认 `ReviewedSet / UnreviewedRelatedSet / NewlyReadThisRound / RepeatReadReason / NoNewSurfaceReason` 完整，且不是机械重复同一批已读内容 |
| PCV-2b 维度增量核查 | 核验最近 3 次有效零发现的 `ReviewDimensionDeltaGate`：确认 `PreviousDimensionSet / CurrentDimensionFocus / NewDimensionRationale / RepeatedDimensionReason` 完整，且不是机械重复同一组维度 |
| PCV-3 三列验证 | 为每条已确认问题补充：合理性（依据是什么）+ 可实施性（能否落地、前置条件）+ 收益（改善效果）|
| PCV-4 分级标注 | 根据核查结果标注：✅已验证 / ⚠️待验证 / ❌排除 |
| PCV-5 最终清单 | 输出过滤后的最终问题清单；❌排除 项须说明排除原因（如：已修复/有意设计/描述位置错误）|

**验证标注规则**：
- **✅已验证**：已读取对应文件/代码，问题确实存在，位置准确；若为运行时数据（测试结果/性能数字），须本轮已实际执行对应命令
- **⚠️待验证**：从规范/逻辑推断，未能直接定位具体文件位置；或为未本轮执行验证的历史执行数据；保留但需用户确认
- **❌排除**：读取实际代码后发现问题不成立，从最终报告中移除

> ℹ️ PCV 与合规检查 V3~V5 相辅相成：PCV 是工作流内置的**主动验证**环节；V3~V5 是合规层的**事后校验**。两者均须通过。

## 维度盲区处理

- 遇到无对应维度的问题 → 先归一为 `record.audit-gap`，标注 `[维度盲区]`，写入 `data/gap-registry.md`（`建议维度` 填写拟新增维度名）
- R2+ 自我审视发现的**检测盲点**（M1~M4）→ 先归一为 `record.audit-gap`，同样写入 `data/gap-registry.md`（`盲点类型` 填写 M1/M2/M3/M4，`建议维度` 填 N/A）
- 两类写入共用同一文件，格式见 `data/gap-registry.md §格式规范`

## 报告规则

- 三列验证（合理性 + 可实施性 + 收益）通过 **PCV-3** 统一完成，报告直接使用 PCV 输出结果，**不在每轮重复完整三列验证**（每轮可简记发现，PCV 阶段统一验证）
- 用户面输出的问题清单与建议也必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围；与 [`17-compliance.instructions.md`](./17-compliance.instructions.md) §1 输出验证一致），不得仅在报告文件中满足
- 报告头部必须包含：审查目标类型 / 审查范围 / 收敛状态 / PCV状态
- 含 🔴 问题时：三列验证**全部通过** → 按审查目标类型路由修复（规范文件 → **self-fix**；项目工程/其他 → **fix**）；存在 ⚠️ 待验证项 → 建议用户确认

## 专属维度规则

### 规范文件审查（D1~D25）

**A — 结构规范 🔴**：D1 文件结构 · D2 frontmatter 规范 · D3 路由语法正确性
**B — 内容质量 🔴/🟡**：D4 内容完整性 · D5 跨文件一致性 · D6 示例可执行性
**C — 可维护性 🔴/🟡**：D7 职责边界 · D8 版本标注 · D9 引用准确性
**D — AI 执行性 🔴**：D10 指令明确性 · D11 冲突检测 · D12 路由正确性
**E — 可扩展性 💡**：D13 扩展点 · D14 租户覆盖 · D15 向后兼容
**F — 维度体系 🔴/🟡**：D16 编号唯一 · D17 优先级标注 · D18 AI-first 设计
**G — 运维 🟡/🔴**：D19 废弃说明 · D20 变更历史 · D21 Markdown 渲染格式
**H — 语义正确性 🔴**：D22 产品语义正确性（模式/角色/开关的行为分配是否符合名称语义）
**I — 跨客户端适配 🔴**（v1.9.2+）：D23 Claude Code 适配层 · D24 客户端支持矩阵 · D25 记忆/报告 agent 字段

**执行优先级分批**：
- 🔴 第一批：D1·D2·D3·D4·D5·D7·D9·D10·D11·D12·D16·D17·D21·D22·D23·D24·D25
- 🟡 第二批：D6·D8·D18·D19·D20
- 💡 第三批：D13·D14·D15

**D5 跨文件一致性关键检查（L1~L3）**：新增子类型后必须核查路由表 + 产物路径 + 报告模板三处同步

### 技术方案审查（TD-1~TD-13）
- A — 方案质量 🔴：TD-1 架构合理性 · TD-2 边界与异常设计 · TD-3 安全性设计
- B — 影响评估 🔴/🟡：TD-4 Breaking Changes · TD-5 下游兼容性 · TD-6 版本合规
- C — 可实施性 🟡：TD-7 实施可行性 · TD-8 测试策略
- D — 文档质量 🟡：TD-9 文档结构 · TD-10 方案与实施一致性
- E — 规范一致性 🟡：TD-11 profile 一致性 · TD-12 API/接口设计
- F — 图表 🟡：TD-13 流程图质量

### 需求文档审查（RQ-1~RQ-8）
- A — 需求质量 🔴：RQ-1 完整性 · RQ-2 明确性 · RQ-3 可验证性
- B — 一致性 🔴/💡：RQ-4 需求一致性 · RQ-7 版本追溯
- C — 影响 🟡：RQ-5 影响分析 · RQ-6 约束条件
- D — 上下文 🟡：RQ-8 项目上下文一致性
- 涉及前端页面、组件、控制台、官网、文档站、可视化工具或游戏的需求，还必须按 `FrontendExperienceQualityGate` 检查 UI / 交互体验验收是否覆盖设计来源、还原度、风格主题、响应式状态、视觉验证、用户流、交互反馈、输入方式/可访问性、错误恢复和动效转场；Figma/截图/既有页面还原还需检查 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate`、`VisualDeviationTypeGate`、`DesignFramePurposeClassificationGate`、`FrontendBrowserVerificationBudgetGate` 与 `UserSelfVerificationOverrideGate`；不涉及时写 `N/A + skipReason`
- 涉及接入状态、人工复核、翻译/正式文档边界、prompt/Hook/MCP 契约（`LLMPromptContractTriage`）、验证范围、真实执行、benchmark 归因、产品需求来源、本机执行配置、人工证据留存、相邻范围扩展、包名/发布名、性能第一、公开模块、提交边界（`ExplicitCommitAuthorizationGate`）、兼容契约、UI 真相源冲突（`UIConfirmedSourceConflictTraceGate`）、公开文档版本边界（`PublicDocsReleasedVersionGate`）、集合关系命名、验证产物语言、数据库记录迁移、guard/policy 绕过、审查 finding 反证矩阵、兼容文档副作用、可执行示例、一次性脚本归属、验证命令副作用（`VerificationCommandSideEffectGate`）、package/adapter 确认前证据（`PackageAdapterPreConfirmEvidenceGate`）、需求确认前缺口、多阶段关闭或 DevCodex v2 一期路线的需求，还必须按 `CrossProjectLearnedGuards` 检查对应验收口径；不涉及时写 `N/A + skipReason`
- 需求来源为审查报告、AI review finding 或 audit issue 时，还必须按 `ReviewFindingIntakeGate` 检查 evidence replay、intentional design、user decision、docs drift 与 test gap 分流是否完整。

### 项目工程审查（PE-1~PE-12）
- A — 结构 🔴/🟡：PE-1 项目结构合理性 · PE-5 可维护性
- B — 健壮性 🔴/🟡：PE-2 错误处理 · PE-3 安全性 · PE-4 性能隐患 · PE-12 资源生命周期与泄漏风险（内存泄露、资源泄漏、监听器/定时器/连接/流未释放、缓存无界增长）
- C — 接口 🔴/🟡：PE-8 接口一致性 · PE-10 配置管理
- D — 质量 🟡/💡：PE-6 测试覆盖 · PE-7 依赖健康度
- E — 可观测 🟡：PE-9 日志 · PE-11 数据层质量
- 前端项目或包含用户可见 UI 的项目工程审查需叠加 `FrontendExperienceQualityGate`：检查视觉一致性、交互反馈、焦点/输入方式、错误恢复、动效转场、Browser/截图/E2E 证据、浏览器验证预算、用户自验 override、视觉偏差类型和设计帧用途分类；不涉及前端体验时写 `N/A + skipReason`
- 项目工程、通用文档、README 或控制面审查遇到“已接入/已验证”、人工复核、翻译同步、正式文档边界、LLM 契约（`LLMPromptContractTriage`）、验证范围预算、adapter/provider benchmark、产品需求来源、本机执行配置、证据留存、相邻范围扩展、包名/发布名、性能第一、公开模块、提交授权（`ExplicitCommitAuthorizationGate`）、兼容契约、UI 真相源冲突（`UIConfirmedSourceConflictTraceGate`）、公开文档版本边界（`PublicDocsReleasedVersionGate`）、集合关系命名、验证产物语言、公开用户文档混入维护者 checklist、最终回复范围漂移、数据库记录迁移、guard/policy 绕过、finding 反证矩阵、文档副作用、示例可执行、一次性脚本、验证命令副作用（`VerificationCommandSideEffectGate`）、package/adapter 确认前证据（`PackageAdapterPreConfirmEvidenceGate`）或 DevCodex v2 一期路线时需叠加 `CrossProjectLearnedGuards`，并在不涉及的维度写 `N/A + skipReason`
- 审查规范吸纳完整性时，若发现只有概念覆盖、缺 Gate 名、缺 Skill、缺 Prompt、缺执行消费者、缺探针或缺部署副本，必须判定为 `ConfirmedAbsorptionCompletenessGates` 未收敛；按需检查 `PublicSurfaceClosureGate`、`UserManualProductizationGate`、`UserManualRenderedFlowAndRealWorkflowProbe`、`SampleIssueExpansionGate`、`RequirementDimensionBindingGate`、`RequirementPriorityAndPhaseGate`、`ReviewAnchorMaterializationGate`、`SemanticLegacyRouteExposureGate`、`ReferenceCodeTruthSamplingGate`、`FrontendAsyncCacheRenderGate`、`StaleWhileRevalidateGate`、`PortableExternalArtifactGate`、`StrongestProfileSourceGate`、`ServiceSpecificResidueSweep`、`ProfileReadChainGate`、`ServiceNormCoverageGate`、`RouteNamespaceResponsibilityGate`、`RemoteCIParityPushGate`、`OfficialApiEvidenceGate`、`AsyncDbTruthSourceVerificationGate`、`DocsPageRoleMatrixGate`、`CompleteUserManualSiteMatrixGate`、`EvolutionCapabilityControlPlaneGate`、`FrameworkCapabilityAutoFirstGate` 与 `DocsThemeRuntimeVisualProbeGate`
- 审查报告、AI review finding 或 audit issue 本身作为输入时需叠加 `ReviewFindingIntakeGate`，避免把报告结论直接当证据或把设计/文档/测试缺口误归类为 must-fix runtime bug。

### 报告审查（RA-1~RA-6）
- A — 内容 🔴：RA-1 完整性 · RA-2 事实准确性
- B — 格式 🟡/🔴：RA-3 格式规范 · RA-4 结论可追溯
- C — 行动 🟡/🔴：RA-5 行动项可执行 · RA-6 关联一致性

### 通用文档审查（DA-1~DA-6）
- A — 内容 🔴：DA-1 结构完整性 · DA-2 内容准确性
- B — 引用 🔴/🟡：DA-3 引用有效性 · DA-4 术语一致性
- C — 受众 💡/🔴：DA-5 受众适配 · DA-6 关联一致性

> README / 用户使用文档不单独开新的审查目标，仍归入“通用文档”；但执行时必须在 `audit-document` 基础上额外叠加 `audit-readme`，补做 `RM-1~RM-6` 用户路径、快速开始、排错与消费链一致性检查，并额外执行 `UserDocsImmediateComprehensionGate` 与 `UserDocsPrimarySurfaceGate`：抽查首页首屏、quick start、nav/sidebar 前两组、CTA、reference 入口、配置、常见任务和排错，确认主面服务用户使用而不是开发契约。

### 发布前审查（RL-1~RL-10）
- A — 发布身份 🔴：RL-1 版本身份 · RL-2 发布说明质量
- B — 风险边界 🔴：RL-3 兼容与迁移风险 · RL-9 凭据与 registry 安全
- C — 包与消费链 🔴：RL-4 元数据完整性 · RL-5 包边界与安装面 · RL-6 消费链同步
- D — 验证与恢复 🟡：RL-7 验证准备度 · RL-8 回滚与恢复 · RL-10 发布后验收

> 发布前审查加载 `audit-common` + `audit-release`，定位为“是否适合发布”的风险审查；`release-verification` 仍负责 R0~R7 执行验证链。不得用 `npm test`、pack 或 publish dry-run 通过来替代 RL 维度审查。
