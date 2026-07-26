---
name: dev-plan-review
description: 技术方案验证（两阶段质量门禁）— PR-1 CP2 前自检 + PR-2～PR-7 详细验证，阻断不合格方案进入编码
---
# Dev Plan Review Skill

## 定位

本 Skill 分为**两阶段**执行，确保方案在用户确认前已通过基础检查：

```text
阶段一（CP2 前·AI 内部自检）：PR-1 需求完整性 → 🔴 不通过则修正后重检，不呈给用户
阶段二（CP2 后·详细验证）：PR-2~PR-7 → 🔴 阻断回 CP2 → 全通过 → [影响评估] → CP3
```

> 🔴 不可跳过。`docs` 子类型（豁免）和 `plan-review` 子类型（防递归）除外。
>
> **R9 / R12**：顺序「方案 → PR-1 → 确认 CP2 → PR-2~PR-7 → CP3 → 编码」。请求用户「确认 CP2」时磁盘须有 PR-1 通过证据（`03-方案复审*` 或 sessions `PR-1=✅`）；否则 Stop `processGaps+=pr1-skipped`。R10：控制面写路径 CP2 门见 `cp-gate` + lifecycle `checkCpGate`。

> ⚠️ 边界说明：本 Skill 只负责**编码前**的方案质量门禁，不覆盖执行后的关键产物复审；执行后的稳定性确认由 `10-dev.instructions.md` 中的“ECR 执行闭环复审”规则负责。

PR-1 与 PR-2~PR-7 各阶段开始前必须由 `review-checklist` Owner 形成 candidate-bound `ReviewExecutionPlanV1`；BlockerSnapshot、执行命令与零发现结论形成 `ReviewEvidenceReceiptV1`。方案或规则/Skill/Probe/影响图变化后旧 receipt 立即 stale，不得因文件少复用旧阶段结论。

CP2 候选进入阶段二前必须先通过 `RequiredCandidateEvidenceGate`：技术方案中存在 fresh `CandidateReviewBundleV1`，且 `phaseKind=CP2`、`TDMatrix`、`BlockerSnapshot`、`ClaimEvidenceMatrix` 均完整。机器负向样本由 `scripts/lib/candidate-review-bundle.js` 与 `npm run test:candidate-review-bundle` 覆盖；缺失、陈旧、软确认绕过或 open blocker 均回 CP2 修订。

## 豁免

- `dev-docs` 子类型：豁免（文档产物，不涉及代码实施）
- `dev-plan-review` 子类型：豁免（自身即为审查，防递归）
- `dev-scenario-test` 子类型：豁免（已有独立质量门控）

## 执行顺序与 Blocker 聚合规则

> 🔴 **BlockerAggregationGate**：检查仍按编号顺序执行，但同一阶段必须继续完成所有**安全独立检查**，一次形成完整 `BlockerSnapshot` 后再回退修正。禁止因为发现首个红项就隐藏后续可独立发现的问题。

每个 `BlockerSnapshot` 至少记录 `stage / blockerId / evidence / affectedSurface / remediation / skippedChecks / stopReason`。只有以下情形允许 fail-fast，并须保留未执行项和恢复入口：

- `invalid-premise`：输入、目标项目或权威事实源无效，继续检查只会产生无意义结论；
- `destructive-side-effect`：下一项检查会产生破坏性或未经授权的外部副作用；
- `evidence-contamination`：测试环境、候选产物或证据链已污染，后续结果不再可信。

发现 blocker 后先收集本阶段剩余安全独立项，冻结快照，再统一修正并重跑完整阶段。任何 blocker 未关闭时仍禁止跨越 CP2/CP3。

```text
PR-1 全量检查 → 聚合 BlockerSnapshot → 有 blocker 则统一修正并完整重检
    ↓ zero blocker
→ CP2 用户确认
    ↓
PR-2~PR-4 全量安全独立检查 → 聚合 BlockerSnapshot
    ↓ zero blocker
PR-5 影响标记（仅标记，不阻断）
    ↓
PR-6 架构质量（🟡 标注，不阻断）
    ↓
PR-7 测试与风险（🟡 标注，不阻断）
    ↓ 全通过
→ [impact-review] → CP3
```

## 阻断条件

以下任一 🔴 项未通过 → 记录到当前 `BlockerSnapshot`；完成本阶段其余安全独立检查后统一回退修正：

- PR-1 有需求点遗漏（阶段一：AI 内部修正后重检；阶段二不再重检 PR-1）
- PR-1 缺少 `§7.1 产品事实源→技术验证映射（需求验收映射）`，导致 CP1 需求方输入锚点 / 双方确认后的产品事实源 / 产品直接提供的 `01-产品需求.md` 无法追踪到设计点、验证路线或 CP3 任务
- PR-2 技术选型不兼容或存在"待定"步骤
- PR-2 非单文件小修、控制面、多模块、接口契约、数据/状态模型或模板-校验链任务缺少 `§2.0 目标架构与模块边界`、契约矩阵、数据/状态模型，且未写 `N/A + skipReason`
- PR-2 **ControlPlaneContractFirstGate**：Hook/MCP/CLI/descriptor/manifest/plugin 生命周期/CP 状态机/validate 语义/多宿主分发任务缺少 **Current→Target ContractMatrix**（字段、writer、reader、error/compat、迁移）或 `runtimeOwners`，且未写 `N/A + skipReason` → 🔴
- PR-2 **ClosureEvidenceGate**：方案或承接审查宣称 closed/可实施时，P0 项缺少双列 `designEvidence` + `runtimeOwners` + `negativeProbe`；仅 design 不得标 closed
- PR-2 非纯文案或单文件小修的方案缺少 `§2.7 最小实现与注释策略`、CP1 `ImplementationComplexityLevel` 继承、复杂度预算，或新增抽象缺少真实消费者 / 既有本地模式 / 边界隔离 / 已确认契约依据
- PR-2 在 CP1 为 `简单够用` 或用户未要求复杂化时自行升级为 `中等` / `企业级`，但缺少用户确认、多方案取舍和维护成本说明
- PR-2 三方 provider / connector / SDK 接入类方案未先区分业务功能接口与底层 provider adapter，缺少 provider metadata、内部 payload、上游 request 映射、标准化 result、错误 detail 字段级合同，或首个 provider 反向定义公共 contract
- PR-2 包 / 库 / adapter / CLI 方案缺少代码实现层 + 包工程层检查，且未写 `N/A + skipReason`
- PR-2 缺少物化验证计划：方案只有泛泛“测试策略”，没有可 grep 的验证计划、命令/矩阵路线、验收标准、退出条件或 TestRoute 输入；涉及性能、并发、发布、文档站、前端、缓存/异步数据时未逐项写 N/A 或证据路线
- PR-2 缺少 `CandidateReviewBundleV1`、`TDMatrix`、`BlockerSnapshot` 或 `ClaimEvidenceMatrix`，或 `scripts/lib/candidate-review-bundle.js` 可分类为 `review-incomplete` / `blocked` / `stale` / `confirm-blocked`
- PR-2 条件治理 Gate 命中但未按 `../spec-governance/gate-registry.json` 记录 `gateGroup / ownerSkill / validationRoute / skipReason`（或聚合 `N/A + skipReason`）。PR-2 只保留触发索引，执行正文与字段归 Owner Skill：

| gateGroup / 触发面 | ownerSkill（入口） | 阻断要点（摘要） |
|------|------|------|
| 覆盖率 / 外部 runtime·plugin·registry·fingerprint / 风险簇升级 | `test-router` · `quality-strategy` · 领域 Owner | 缺 CoverageGateDecision、生命周期/fingerprint 矩阵或风险分层路线 |
| `docs-ia-readability` · `user-manual` · `docs-semantics-examples` | `user-manual-authoring` · `dev-docs` · `document-sync` | 缺 page role / sidebar 任务模型、用户主路径或示例/语义真相 |
| `expert-output-quality` · `expert-owner-skills` | `expert-output-quality` + 对应专家 Owner | 缺生产推荐路径/fixture 边界，或缺 ownerSkill 触发证据 |
| `CodeTruthEvidenceMatrixGate` · `SolutionFitAgainstRepoGate` · **CodeTruthAtCpEntryGate（PF-139）** | `expert-output-quality` + repo 事实源 + `discipline-execution-probe` | 缺 repo path / symbol / currentBehavior / negativeProbe / reusePoint / consumer / rollback / statusQuoCost；控制面 CP 入口宣称可确认/定稿但无矩阵 → `classifyCodeTruthMatrixAtCpSample` fail |
| `agent-capability-completeness` · `consumer-validation` · `module-performance-maintenance` | 对应 Owner Skill | 假全量：缺 completeness 对象、跨仓分母或模块性能维护证据 |
| `brand-visual-quality` | `brand-visual-quality` | 缺母版谱系/主题几何/微尺寸单色/人工结论 |
| 跨项目/最新/确认吸纳（`absorption-layering` · `confirmed-completeness` 等） | `spec-absorption` · `spec-governance` | 缺 registry 分组判定或 layerChecks / consumerProof |
| `configuration-ergonomics` · 配置 canonical namespace · Profile runtime 同步 | `developer-experience-architecture` · `load-profile` | 缺最小配置、namespace/alias 或 ProfileImpactCheck 同步 |
| `contract-release-authority` | `api-contract-architecture` · `release-verification` | 缺 publishedState / 消费者证据 / 兼容决策 |
| `frontend-runtime`（含 UI 体验/Figma/preview/i18n） | `audit-project` · `test-router` · 前端相关 Owner | 缺体验判定或 Figma/preview/状态/资产证据 |
| 依赖 / 框架 / SDK / 平台 API | （本 Skill PR-2 直接查） | 缺 `OfficialDocsEvidence`；升级未拆业务源码平滑性 vs 依赖层落地 |

- PR-2 触发依赖/框架/SDK/平台 API 引入或升级，但缺少 `OfficialDocsEvidence`
- PR-2 依赖升级 / 兼容任务未拆分 `业务源码平滑性` 与 `依赖层落地条件`
- PR-3 违反安全底线（C01/C03）或项目架构约束
- PR-3 涉及项目事实变化但未执行 `ProfileImpactCheck`
- PR-4 有未加权限控制的敏感操作

## 检查清单

### PR-1 需求完整性

| 检查项 | 通过标准 |
|--------|----------|
| 方案是否覆盖了 CP1 双方确认的所有需求点？ | 无遗漏；未确认的需求方原始诉求不得进入实现范围 |
| CP1 需求方输入锚点 / 产品事实源是否已映射到设计点、验证路线和 CP3 任务？ | 已在 `§7.1 产品事实源→技术验证映射（需求验收映射）` 逐项列出；若产品直接提供完整需求，应锚定 `01-产品需求.md` 的产品原文、流程节点、前端交互、字段描述和 AI / 研发缺口检查；不适用项有 `N/A + skipReason` |
| 边界条件是否已识别（空值/超大输入/并发/断网等）？ | 已识别或已说明不在本次范围 |
| 错误处理路径是否已设计？ | 主要错误场景有处理方案 |

### PR-2 技术可行性

| 检查项 | 通过标准 |
|--------|----------|
| 技术选型是否与项目 profile 声明的技术栈一致？ | 一致；若不一致已在方案中说明原因 |
| 依赖的外部服务/库是否已存在于项目中或可安装？ | 确认可用 |
| 核心算法/接口设计是否具体可实施？ | 无模糊的"待定"步骤 |
| 对已有代码的改动，新逻辑是否位于正确的执行路径中（不被已有 return/throw/break 提前跳过）？ | 已逐步追踪插入位置，无提前跳过风险；若有风险已在方案中调整插入位置 |
| 方案是否引用了已存在的接口/模块/配置项？（F-25 引用存在性）| 所有引用的文件路径/接口/模块均已通过 view/grep 确认存在；若不存在，须在方案中注明为新建 |
| 非单文件小修、控制面、多模块或模板-校验链任务是否单独列出目标架构与模块边界？ | 已在 `§2.0 目标架构与模块边界` 说明目标职责、输入输出、依赖与不负责事项；不触发时有 `N/A + skipReason` |
| 对已有公共接口/Schema/返回结构/错误码的改动，是否给出“现状契约 → 目标契约”差异说明？ | 已明确差异与迁移边界；若无现状基线则说明为新增 |
| 涉及公共接口、函数签名、Schema、配置、CLI 参数、Hook payload、MCP tool/resource、事件或报告字段时，是否给出契约矩阵？ | 已覆盖调用方/消费者、输入、输出、错误/异常、兼容策略与验证方式 |
| 控制面任务是否执行 ControlPlaneContractFirstGate？ | Hook/MCP/CLI/descriptor/manifest/plugin/CP 状态/分发类 CP2 含 Current→Target **ContractMatrix** 与 `runtimeOwners`；不触发写 `N/A + skipReason` |
| 宣称 closed/可实施时是否满足 ClosureEvidenceGate？ | 每条 P0 有 designEvidence + runtimeOwners + negativeProbe；仅 design → partial，禁止可确认 CP3 |
| 涉及 Schema/Model/数据库/配置/缓存/运行态状态/台账/Profile/报告字段时，是否给出数据模型 / 状态模型？ | 已说明当前结构、目标结构、生命周期/状态转换、持久化/迁移影响、兼容策略与验证方式；不触发时有 `N/A + skipReason` |
| 技术执行流程是否区别于 CP1 业务流程，并能映射到 CP3？ | `§2.1` 以技术实现路径和节点职责为主，且含文件/依赖/CP3锚点 |
| 方案是否给出最小实现与注释策略？ | 已在 `§2.7` 继承 CP1 `ImplementationComplexityLevel`，写明复杂度预算、最小实现边界、必要注释触发点；小修豁免时有 `N/A + skipReason` |
| 复杂度是否默认简单够用且未擅自升级？ | 用户未要求复杂化或需求不详细时默认 `简单够用`；升级到 `中等` / `企业级` 已有用户确认、多方案取舍、维护成本和真实消费者 / 公共契约证据 |
| 新增抽象、工具层或防御分支是否有证据？ | 仅在真实消费者、既有本地模式、边界隔离或已确认契约需要时允许；无真实消费者或只是预留扩展则 🔴 阻断 |
| 必要注释是否覆盖关键意图？ | 非显然业务规则、状态转换、不变量、兼容约束、安全边界、外部契约映射、反直觉权衡已有短注释计划；JS/Node 必要注释计划使用标准 JSDoc；逐行解释或重复代码含义不计为有效注释 |
| 简单业务 service 是否职责收敛？ | 只做业务编排、外部能力调用和必要上游错误映射；不重复 route validate、model/schema、数据导入或框架已保证的校验/归一化 |
| provider / connector / SDK 接入是否先冻结业务接口与字段级合同？ | 面向前端或业务调用方时先冻结业务功能契约；provider/model/operation 作为内部实现或配置维度；已覆盖 provider metadata、内部 payload、上游 request 映射、标准化 result、错误 detail；首个 provider 不反向定义统一 contract |
| 包 / 库 / adapter / CLI 方案是否检查包工程层？ | 已覆盖 public API、public types、internal 工具、shared tests、benchmark、docs、scripts、dist/coverage、package metadata 与 changelog |
| 验证计划是否物化？ | 方案有独立验证计划章节：触发或 N/A、命令/等价证据、验收标准、退出条件、TestRoute 输入；不能只写“测试策略” |
| 条件治理 Gate 是否按 registry 触发？ | 读取 `../spec-governance/gate-registry.json`，命中时写 `gateGroup / ownerSkill / validationRoute / skipReason` 并链接 Owner 证据；**不得在 PR-2 复制完整 Gate 名录**。索引见上表阻断条件 |
| TypeScript 类型迁移是否按公开契约与消费面推进？ | 不机械复制旧类型缺陷；跨模块业务契约、公开类型与配置类型优先集中到 types 契约层，本地 interface 有保留理由 |
| 新增接口/函数/配置是否向后兼容现有调用方？（F-23 向后兼容）| 已确认；若有 Breaking Change 已在 §3 列出并提供迁移方案 |
| 方案是否单独列出兼容性策略（调用方/文档/版本/宿主兼容）？ | 已单独列出，不是散落在风险段 |
| 方案是否单独列出边界问题清单（轻计划、公共契约冻结、异常/跨轮次等）？ | 已单独列出，有明确判断口径 |
| 方案中的依赖包能否在当前环境正常安装？（F-26 依赖安装健康检查）| 在临时 project、隔离 userconfig/registry metadata probe 或其他无写入路线验证；禁止在当前工作区生成/修改 lockfile、node_modules 或 package metadata |
| 新增/升级依赖、框架、SDK、平台 API 或外部模块是否已读取官方使用文档？（C20 OfficialDocsEvidence） | 已记录官方文档来源、版本/日期、关键用法、限制条件、兼容性 / 弃用 / Breaking Change；无官方文档时已记录降级来源和风险；不触发时写 `N/A + skipReason` |
| 依赖升级分析是否拆分层次？ | 已拆分 `业务源码平滑性` 与 `依赖层落地条件`；用户要求纯依赖升级时有 `纯依赖层零附加动作` 结论 |
| 内部共享库根因是否评估共享修复？ | 已评估“修共享库 + 消费项目升级”；若做单项目补丁，已有理由、风险和后续动作 |
| 技术路线对比 / 领域契约 / 配置与 Profile / 文档 API / 数据迁移 / 吸纳决策 / 启动 trace | 按触发调用对应 Owner：对比证据范围；既有域契约审计；ConfigOwnership；configuration-ergonomics / profile-service；ApiDocVerificationSync；DataMutationPlan；AbsorptionDecision + FullV1ScopeGuard；StartupPhaseTrace。未触发写聚合 `N/A + skipReason` |

### PR-3 约束合规性

| 检查项 | 违反时处理 |
|--------|------------|
| 敏感信息、明文连接信息或硬编码处理是否符合用户 / 项目显式策略？（C03/S02） | 若 AI 未经要求自行加严、脱敏、占位或改成 env / `secretRef` / secret manager / `config.local.json`，则 🔴 阻断并要求恢复用户 / 项目策略；未指定限制时，真实秘密或硬编码出现在用户要求的任意产物中均不按违规处理 |
| 方案是否有不可逆操作，是否已规划确认步骤？（C01/S01） | 🔴 阻断，要求补充确认机制 |
| 方案是否违反项目 profile 架构约束（`02-架构约束.md`）？ | 🔴 阻断，要求与 profile 对齐 |
| 方案是否执行 `ProfileImpactCheck`？（C21） | 需同步 Profile 的变更已列出目标文件；无需同步时已有 `skipReason`；缺失则 🔴 阻断 |

### PR-4 性能与安全隐患

| 检查项 | 建议处理 |
|--------|----------|
| 是否有明显的 N+1 查询或循环 I/O？ | 🟡 标注，建议实施阶段修正 |
| 是否有未加权限控制的敏感操作？ | 🔴 阻断（C03 安全范围扩展） |
| 批量操作是否有分页/限流？ | 🟡 标注，说明潜在风险 |

### PR-5 影响评估前置标记

仅标记，不立即执行；标记结果触发对应后续处理：

| # | 检查项 | 触发路径 |
|:-:|--------|----------|
| ① | 方案涉及对外 HTTP API 变更？ | EXEC 完成后 → `api-verification` Skill |
| ② | 方案涉及跨模块架构依赖变更？ | 进入 `impact-review` Skill（CP3 前） |
| ③ | 方案涉及数据库 Schema 变更？ | 进入 `dev-database` Skill |

### PR-6 架构质量视角（C15）

以**架构师与平台工程师**双重视角评估三维质量：

| 维度 | 检查项 | 通过标准 |
|------|--------|----------|
| 可扩展性 | 是否在真实复用、边界隔离、既有模式或已确认契约需要时才引入抽象？新功能能否避免修改无关核心逻辑？ | 是；若需要直接实现或修改核心逻辑，已说明权衡理由 |
| 可维护性 | 命名是否语义自解释？职责是否单一？必要注释是否解释关键意图而非重复代码？ | 是；若多职责或无注释已说明原因 |
| 易上手性 | API 名称是否直觉描述目的？错误信息是否具体？ | 是 |

> 未达标时标注 `⚠️` + 原因 + 改善方向（不要求本次立即实施）。

### PR-7 测试策略与风险评估

> 🟡 标注级：未通过不阻断 CP3，但须标注 `⚠️` 并建议补充。

| 检查项 | 通过标准 |
|--------|----------|
| 技术方案 §7 测试策略是否明确覆盖目标和工具？ | 关键路径有对应测试类型 |
| 技术方案 §7.1 产品事实源→技术验证映射是否完整？ | CP1 需求方输入锚点 / 双方确认后的产品事实源 / 产品直接提供的 `01-产品需求.md` 逐项映射到设计点、TestRoute/测试类型、CP3任务锚点和技术通过标准 |
| 是否有针对性的负向测试场景（异常/边界/失败路径）？ | 至少覆盖主要错误场景 |
| TestRoute 是否体现验证范围预算与真实执行义务？ | 风险强度匹配；“已验证/可运行/已发布”等声明有实际命令或等价证据 |
| TestRoute 是否按 registry 绑定条件 Gate？ | 命中时从 `gate-registry.json` 解析 `gateGroup` → Owner → requiredEvidence（覆盖率、外部 runtime、V95 完整性、品牌视觉、前端体验等）；状态或 `N/A + skipReason` 齐全，不在此展开 Gate 目录 |
| 技术方案 §9 风险是否已识别关键风险？ | 至少列出 1 条技术风险 |
| 每条风险是否有对应缓解措施？ | 无"待定"缓解措施 |

## 验证结果输出格式

```markdown
## 技术方案验证结果

**阶段一（CP2 前自检）**：PR-1 ✅ 通过

**阶段二验证结论**：✅ 通过 → 进入 CP3 | 🔴 阻断 → 回 CP2 修订

| 检查组 | 结论 | 问题（若有） |
|--------|------|--------------|
| PR-1 需求完整性（已自检） | ✅ | |
| PR-2 技术可行性 | ✅/🔴/🟡 | |
| PR-3 约束合规性 | ✅/🔴/🟡 | |
| PR-4 性能安全 | ✅/🔴/🟡 | |
| PR-5 影响标记 | ① □ ② □ ③ □ | |
| PR-6 架构质量 | ✅/🟡 | |
| PR-7 测试与风险 | ✅/🟡 | |
```

**RequiredCandidateEvidenceGate**：CandidateReviewBundleV1=review-ready / review-incomplete / blocked / stale / confirm-blocked；证据：`TDMatrix`、`BlockerSnapshot`、`ClaimEvidenceMatrix`、`npm run test:candidate-review-bundle`（适用时）。


## 同步锚点（validate / consumer）

ExpertOutputQualityGate · fixture/mock/demo · evidenceMatrix · ExpertOwnerSkillGate · triggerReason · requiredFields · V85 · AgentCapabilityDomainCompletenessGate · ConsumerValidationEngineeringGate · BrandVisualQualityGate · TechnicalRouteComparativeGate · ExistingDomainContractAudit


## 额外同步锚点

RequirementDimensionBindingGate · OfficialApiEvidenceGate · EvolutionCapabilityControlPlaneGate · VerificationPlanMaterializationProbe · SidebarPageRoleMaterializationProbe · SidebarGroupSemanticModelProbe · PR-2 项目存在 coverage · 函数源码 fingerprint 风险是否覆盖 · ExternalRuntimePluginLifecycleGate · ExternalRegistryLifecycleMatrixGate · FunctionSourceFingerprintMatrixGate · ClusterEscalationGate · RiskBasedValidationLadder · ConfigCanonicalNamespaceGate · ProfileRuntimeContractSyncGate · LatestAbsorptionExecutionPack


<!-- auto-sync anchors -->
FrontendExperienceQualityGate · CrossProjectLearnedGuards · VerificationScopeBudgetGate · GovernanceGateRegistry · legacy anchors · V2FormalSolutionPackage · ReviewFindingIntakeGate · RequirementPreConfirmGate · PackageAdapterPreConfirmEvidenceGate · LatestAbsorptionGuards
