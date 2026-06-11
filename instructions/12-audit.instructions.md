---
applyTo: "**"
description: audit 工作流规则，覆盖审查目标路由、收敛门禁、元循环与只读边界
priority: P4
version: 1.11.19
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
| Rn | 每轮先输出 `ReviewCoverageDelta`，优先阅读此前未审查但相关联的代码、配置、测试、文档、部署副本和消费者链；重复审查已读范围只能作为高风险锚点、修复点回归、抽样或新证据复核；**plugin 文件发现问题先做阻断/非阻断分流：阻断项触发自我审视 + self-fix 修复并重启新轮，非阻断项写入 `data/pending-issues.md` 后继续**（见 `audit-common §审查元循环`）；**非 plugin 文件发现问题则记录 PF/VL，继续下一轮** |
| 收敛前门禁 | **CRS ✅**（见下方说明）|
| 收敛条件 | **连续 3 轮有效零发现**（仍须满足连续 3 轮零发现；所有子类型统一，不区分定向/全面），同时所有 🔴 已解决 + 🟡 已处理或标注 N/A |

- 未收敛时自动进入下一轮，**不询问用户**
- 🔴 **CRS 收敛门禁**：宣告收敛前，必须在 `instructions/` 和 `skills/` 全库 grep 本次审查涉及的核心关键词，确认所有引用相同概念的文件均已纳入审查范围并完成 G3 检查；CRS 发现未审查文件时，**零发现计数重置为 0**
- 🔴 **连续 3 轮有效零发现**：必须是**修复后重启的新轮次**均零发现，且每轮 `ReviewCoverageDelta` 合格；不得用同一轮、同一批文件或无新增覆盖证据的重复检查凑数
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

## 收敛后汇总验证（PCV）

> 🔴 强制步骤：所有轮次收敛后，必须执行 PCV，方可输出最终报告。

| 步骤 | 动作 |
|------|------|
| PCV-1 汇总去重 | 汇总所有轮次发现的问题，按严重级别排序（🔴→🟡→💡），去除轮次间重复条目 |
| PCV-2 实证核查 | 对每条问题，**重新读取**对应文件/代码位置（不得仅凭记忆），确认问题确实存在且描述准确。**若结论依赖运行时数据**（测试通过率、性能数字、API 响应等），**优先本轮实际执行**对应命令取得当前结果；无法执行时标注 ⚠️待验证（须注明来源为历史记录）；禁止将记忆文件历史数据直接标注为 ✅已验证 |
| PCV-2a 覆盖增量核查 | 核验最近 3 次有效零发现的 `ReviewCoverageDelta`：确认 `ReviewedSet / UnreviewedRelatedSet / NewlyReadThisRound / RepeatReadReason / NoNewSurfaceReason` 完整，且不是机械重复同一批已读内容 |
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
- 涉及前端页面、组件、控制台、官网、文档站、可视化工具或游戏的需求，还必须按 `FrontendExperienceQualityGate` 检查 UI / 交互体验验收是否覆盖设计来源、还原度、风格主题、响应式状态、视觉验证、用户流、交互反馈、输入方式/可访问性、错误恢复和动效转场；不涉及时写 `N/A + skipReason`
- 涉及接入状态、人工复核、翻译/正式文档边界、prompt/Hook/MCP 契约、验证范围、真实执行、benchmark 归因、产品需求来源、本机执行配置、人工证据留存、相邻范围扩展、包名/发布名、性能第一、公开模块或 DevCodex v2 一期路线的需求，还必须按 `CrossProjectLearnedGuards` 检查 `CodeTruthRequirementGate`、`ManualReviewEvidenceRetention`、`DocumentationTranslationParityGuard`、`FormalDocsDevCodexBoundary`、`LLMPromptContractTriage`、`VerificationScopeBudgetGate`、`LiveVerificationExecutionObligation`、`AdapterBenchmarkAttribution`、`ProductRequirementTraceabilityGate`、`LocalExecutionConfigProbe`、`ManualReviewEvidenceDataRetention`、`AdjacentScopeExpansionGuard`、`PackageNameAuthorityGate`、`PerformanceBenchmarkFirstGate`、`PublicModuleDifferentiationGate`、`V2MCPFirstPlanningGate` 是否有验收口径；不涉及时写 `N/A + skipReason`

### 项目工程审查（PE-1~PE-12）
- A — 结构 🔴/🟡：PE-1 项目结构合理性 · PE-5 可维护性
- B — 健壮性 🔴/🟡：PE-2 错误处理 · PE-3 安全性 · PE-4 性能隐患 · PE-12 资源生命周期与泄漏风险（内存泄露、资源泄漏、监听器/定时器/连接/流未释放、缓存无界增长）
- C — 接口 🔴/🟡：PE-8 接口一致性 · PE-10 配置管理
- D — 质量 🟡/💡：PE-6 测试覆盖 · PE-7 依赖健康度
- E — 可观测 🟡：PE-9 日志 · PE-11 数据层质量
- 前端项目或包含用户可见 UI 的项目工程审查需叠加 `FrontendExperienceQualityGate`：检查视觉一致性、交互反馈、焦点/输入方式、错误恢复、动效转场和 Browser/截图/E2E 证据；不涉及前端体验时写 `N/A + skipReason`
- 项目工程、通用文档、README 或控制面审查遇到“已接入/已验证”、人工复核、翻译同步、正式文档边界、LLM 契约、验证范围预算、adapter/provider benchmark、产品需求来源、本机执行配置、证据留存、相邻范围扩展、包名/发布名、性能第一、公开模块或 DevCodex v2 一期路线时需叠加 `CrossProjectLearnedGuards`，并在不涉及的维度写 `N/A + skipReason`

### 报告审查（RA-1~RA-6）
- A — 内容 🔴：RA-1 完整性 · RA-2 事实准确性
- B — 格式 🟡/🔴：RA-3 格式规范 · RA-4 结论可追溯
- C — 行动 🟡/🔴：RA-5 行动项可执行 · RA-6 关联一致性

### 通用文档审查（DA-1~DA-6）
- A — 内容 🔴：DA-1 结构完整性 · DA-2 内容准确性
- B — 引用 🔴/🟡：DA-3 引用有效性 · DA-4 术语一致性
- C — 受众 💡/🔴：DA-5 受众适配 · DA-6 关联一致性

> README / 用户使用文档不单独开新的审查目标，仍归入“通用文档”；但执行时必须在 `audit-document` 基础上额外叠加 `audit-readme`，补做 `RM-1~RM-6` 用户路径、快速开始、排错与消费链一致性检查。

### 发布前审查（RL-1~RL-10）
- A — 发布身份 🔴：RL-1 版本身份 · RL-2 发布说明质量
- B — 风险边界 🔴：RL-3 兼容与迁移风险 · RL-9 凭据与 registry 安全
- C — 包与消费链 🔴：RL-4 元数据完整性 · RL-5 包边界与安装面 · RL-6 消费链同步
- D — 验证与恢复 🟡：RL-7 验证准备度 · RL-8 回滚与恢复 · RL-10 发布后验收

> 发布前审查加载 `audit-common` + `audit-release`，定位为“是否适合发布”的风险审查；`release-verification` 仍负责 R0~R7 执行验证链。不得用 `npm test`、pack 或 publish dry-run 通过来替代 RL 维度审查。
