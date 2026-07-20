# 开发规范

> AI 在执行 dev/fix 工作流时，除遵守 instructions 约束外，还须遵守本页项目级规范。

---

## 各组件使用规范

> 遇到新任务时，先判断用哪个组件，再动手创建文件。

| 场景 | 用哪个组件 | 理由 |
|------|-----------|------|
| 需要始终约束 AI 的规则 | Instructions | 每次会话自动注入，不需要手动触发 |
| 按需触发的工作流 | Skills（SKILL.md 完整内容）| AI 按需读取，包含完整工作流检查标准与执行步骤 |
| CP 节点的结构化输出 | Prompts | 有参数、有格式的单次任务 |
| 会话开始/结束的自动动作 | Hooks | 确定性执行，AI 无法跳过 |
| 定义 AI 的工具权限和运行模式 | Agents | 只有两个（确认模式/全自动模式）|

> ℹ️ **当前实现**：SKILL.md 包含完整的工作流内容（触发条件 + 检查标准 + 执行步骤）。v2.0.0 规划中可能演进为 Skills（薄壳路由）+ MCP 工作流分离架构。

---



| 文件 | 何时填写 | 填写内容 |
|------|---------|---------|
| `design.md` | CP2 方案确认后 | 技术方案、文件变更清单、风险与约束 |
| `plan.md` | CP3 实施计划确认后 | Phase 分阶段步骤表（步骤/文件/说明/状态）|
| `progress.md` | 每次会话后更新 | 各步骤状态更新 + 会话记录追加 |
| `decisions.md` | 有重大决策时 | D-NNN 格式，记录背景/决策/原因/影响 |

> ⛔ `design.md` 和 `plan.md` 在对应 CP 通过前**不填写实质内容**，只保留"待撰写/待制定"占位。

---

## 组件使用规范

> 核心原则：**用对组件**——不要把工作流内容放进 Instructions，也不要把全局约束放进 Skills。

| 场景 | 用哪个 | 禁止误用 |
|------|-------|---------|
| 定义 AI 身份和工具权限 | **Agents** | ❌ 不要写进 Instructions |
| 按需触发的工作流技能 | **Skills** | ❌ SKILL.md 包含完整内容（触发条件 + 执行步骤） |
| 始终有效的规范约束 | **Instructions** | ❌ 不要写进 SKILL.md |
| CP 节点结构化输出 | **Prompts** | ❌ 不要在 SKILL.md 内联模板 |
| 生命周期事件强制执行 | **Hooks** | ❌ 不要用 Instructions 模拟 Hooks |

### Skills 编写规范

```markdown
---
name: dev-default              # 必须与文件夹名完全一致
description: "Use when: ..."   # 必填，AI 靠这个发现 Skill
---

# dev-default Skill

## 触发条件
...

## 执行步骤
...

## 检查标准
...
```

- SKILL.md 包含完整的工作流内容：**触发条件** + **执行步骤** + **检查标准**
- 每个 Skill 目录只有一个 `SKILL.md`，扁平一级目录
- 支撑型 Skill（如 `execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync`）不能新增工作流分支；必须被 instructions、模板、报告、validate 与用户文档同时消费
- `analyze-default` 承接默认分析工作流的只读多轮、代码事实优先、analyze-lite CRS、PCV 和推荐结论；`instructions/13-analyze.instructions.md` 只保留入口与路由索引，避免分析默认路径继续堆在 instructions。

### 条件门禁索引（非百科）

> 本页只保留**用户面流程**与 **gateGroup → Owner Skill** 索引。完整 Gate 字段、探针与证据要求以源仓 `skills/spec-governance/gate-registry.json` 及对应 Owner Skill 为准；[合规检查框架](/specs/compliance-framework) 说明合规阶段关系。禁止在 guide 正文复制跨组 Gate 长清单。

| 场景 / 触发面 | gateGroup（代表） | Owner Skill |
|------|------|------|
| 规范吸纳 / 仍需吸纳 / data 扫描 | `absorption-layering` · `confirmed-completeness` | `spec-absorption` · `spec-governance` |
| 历史长清单迁移 / 防回流 | `historical-common-layering` | `spec-absorption` · `spec-governance` |
| 记忆 / Profile bootstrap / 有界上下文 | `memory-bootstrap` · `context-acquisition` · `profile-service` | `memory` · `load-profile` · `ai-agent-system-architecture` |
| 用户手册 / 文档站 / README | `user-manual` · `docs-ia-readability` · `docs-semantics-examples` | `user-manual-authoring` · `audit-user-manual` · `dev-docs` |
| 专家产物 / 领域专家语义 | `expert-output-quality` · `expert-owner-skills` | `expert-output-quality` + 对应专家 Owner |
| 基座准入 / 操作说明 / 代码事实 | `base-admission-governance` · `expert-output-quality` | `BaseImpactAssessmentV1` / `ComplexityDeltaBudgetV1` / `UnaffectedIntentRegression` 保护稳定基座；`OperationExplanationContractV1`、`CodeTruthEvidenceMatrixGate`、`SolutionFitAgainstRepoGate` 与唯一推荐门禁让用户操作、repo 事实和推荐结论可追溯；V84/V96 提供正负向探针 |
| 正式复审 / ECR / 逃逸补清单 | `review-checklist` · `review-escape` · `post-confirmation-review` | `review-checklist` · `cp-gate` · `dev-plan-review` |
| 编码偏移 / 多批次范围 | `development-drift` · `batch-scope-rebinding` | `execution-contract` · `dev-default` |
| 发布 / registry / 公开面 | `release-parity` · `public-surface` · `contract-release-authority` | `release-verification` · `audit-release` |
| 前端运行态 / UI 体验 | `frontend-runtime` · `interactive-semantics` | `audit-project` · `test-router` · 相关 Owner |
| 跨仓消费者 / Agent·性能完整性 | `consumer-validation` · `agent-capability-completeness` · `module-performance-maintenance` | 对应 Owner Skill |
| 品牌视觉 / 本地可观测 / 回合活性 | `brand-visual-quality` · `local-observability-contract` · `agent-turn-liveness` | 对应 Owner Skill |
| 修复完成 / 返工治理 | `repair-collaboration` · `repair-prevention-assessment` · `rework-prevention` | `execution-contract` · active `repair-prevention-assessment` · gray `rework-prevention-engineering` |
| 自我进化控制面 / Skill 生命周期 | `evolution-control-plane` · `skill-lifecycle` | `evolution-governance` · `skill-lifecycle-governance` |

**仍写在用户流程层的硬规则（非 Gate 百科）**：

- 发布前审查 `audit-release` 与 `release-verification` R0~R7 边界清晰；audit 只写审计产物，修复须独立 fix/self-fix 授权
- Profile 三档与 [Profile 使用指南](./profile.md)；Node.js 默认 `>=18`；依赖升级拆分业务源码平滑性 vs 依赖层；包边界检查串行；`OfficialDocsEvidence` / `ProfileImpactCheck` / `ServiceLifecycleCleanup` / Improvement Intake / 台账回写 / Backlog 真相复核
- 可配置并发：`extensions.devcodex.concurrency` 默认 `parallel prepare, serial commit`
- 验证卫生：真实 exitCode、消费者异常先查依赖树、收尾清理无关 dirty
- 文档阅读顺序与 website nav/sidebar 同批校验；v2.0.0 规划 MCP `devcodex_getWorkflow()` 替代文件读取



| 文件 | 何时填写 | 填写内容 |

1. **更新步骤状态**：在 `progress.md` 对应步骤行，将 `⬜` 改为 `🔄`（进行中）或 `✅`（完成）
2. **追加会话记录**：在 `progress.md` 会话记录表追加一行

   ```markdown
   | 2026-04-04 | 简述本次做了什么 | 完成了哪些步骤 |
   ```

3. **需求完成时额外执行**：
   - 更新 `index.md` 页眉状态为 `✅ 已完成`
   - 更新 `requirements/index.md` 总览表状态列
   - 在 `CHANGELOG.md` 追加完成记录

---

## 关键决策记录格式（decisions.md）

```markdown
## D-NNN：<决策标题>

**日期**：YYYY-MM-DD
**背景**：[为什么需要做这个决策]
**决策**：[决定了什么]
**原因**：[为什么这样决定]
**影响**：[对哪些文件/模块有影响]
```

- `NNN` 从 `001` 起递增
- 只追加，不修改已有记录
- 最新决策在最下方

---

## 执行上下文（当前规则）

`.devcodex/profile/config.json` 中的 `mode` 字段当前已经参与正式的 `ENV_MODE` 行为分叉，不再是 Draft 或预留能力。

当前规则：

- **`mode: "dev"`**：进入实质任务前输出 PC0~PC7 入口检查，PC4 执行完整规范雷达，并在收尾执行 FC / SC / RC / T 合规检查
- **`mode: "prod"`**：进入实质任务前仍输出 PC0~PC7 基础入口检查，PC4 标注 N/A；不执行后置合规检查，但 CP1 / CP2 / CP3 仍然强制
- **执行模式与 `ENV_MODE` 分离**：确认模式 / 全自动模式属于 Agent 入口语义；当前全自动正式入口包括显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `config.json` 的 `extensions.devcodex.autoAliases` 替换别名与明确自然语言 auto 授权，且只有在 hook-enforced 宿主 + 白名单路径上形成 runtime 级自动推进；配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；模糊提及、询问 auto 规则、未生效昵称或普通“继续”不算授权
- **并发策略与 `ENV_MODE` 分离**：`extensions.devcodex.concurrency.mode=auto` 默认允许只读准备、只读子 Agent 分析和隔离验证并行；`mode=serial` 退回全串行；核心单写者域不是项目可删除配置，`allowParallelMutations` 不是合法字段

> 当前正式规则源以 `instructions/01-common.instructions.md`、`instructions/17-compliance.instructions.md` 和 `skills/cp-gate/SKILL.md` 为准；本页负责解释这些规则如何落到日常开发流程中。

### 项目现实扩展

日常开发中，DevCodex 不应只按用户字面关键词决定工作流。当前源码规范流程为：

```text
语义意图初判（IntentSeedV1）→ 唯一项目/activeRoot → ContextReadPlanV2 → 定向读取 + ContextReadReceiptV2 → 项目现实扩展 → 最终工作流/子类型
```

项目现实扩展至少要检查目标项目、真实影响范围、关联文件族、产物落点和验证方式；若项目未明确，必须先澄清，不能为了扩展意图而无界扫描工作区。

### 意图驱动的上下文获取

当前源码的推荐生产路径是“每条消息先生成 seed、每个 contextEpoch 冻结一个计划”，不是“每个工具动作前重读 Profile”。该能力尚未构成新的 release 声明，公开可用性仍以 tag、registry 与 release notes 为准。

- `profile_context_plan` 只读取 README/index、effective non-local config，并对顶层 Profile 文件做 metadata inventory；`01~09-*` 与 `config.local.json` 正文必须进入 selected/excluded/unclassified 决策。
- selected Profile 用 `profile_load(files=[...])` 定向读取；记忆先用 `memory_status`，resume/continuity 再用 `memory_session_query` 或 `memory_summary_query` 获取单个有界片段。
- `ContextReadReceiptV2` 只接受 planId、planContentId、contextEpoch、activeRoot、source identity/query 精确相关的 PostToolUse 成功证据。PreToolUse、失败调用、cache hit、提示文案和 legacy no-args full 都不能声明 complete；V1 只保留 reader compatibility。
- 用户/项目明确要求、audit/migration、低置信、必要来源缺失或实质 scope/risk/digest 漂移可以升级/重算；预算只触发告警或升级，不能压掉安全、CP、治理或强制证据。
- MCP bridge 失败只允许一次同计划 bounded fallback；结果不可观察时保持 unverified，并继续执行后续安全与确认门禁。

### 大型项目的增量分析快照

首次完整或逐文件分析不必在后续任务中反复重读全库。当前源码提供单一 ProjectKnowledge V2 仓：

```text
status → plan → observe（零写入）→ bootstrap/accept（验证通过后写入）
```

- `observe` 从当前文件字节生成确定性的 heading、symbol、import、config/test 等结构声明；它明确不是“人工逐文件深读”。
- `bootstrap --task-root <任务目录>` 先在内存完成所有智能批次、range digest、binding 与 sample oracle 验证，最后才推进一次 accepted runtime pointer。
- 生产 CLI 会从当前 inventory 字节构建带 `builderVersion` 的 `ImpactGraphV1`，首期解析 JS/TS 静态相对依赖与 Markdown 本地链接，并记录 coverage、unresolved references 与 `unknownConsumerPaths`。后续 `plan` 只读取 changed、当前依赖/消费者影响闭包和新的 lens-gap；复用集按 contentId/path 稳定抽取 5%（最少 3、最多 20）重新观察。
- `ProjectKnowledgeBindingV1` 同时绑定 repo/root、inventory Merkle、分析配置、解析器、测试路线和 Profile；任一环境身份错配都回退 full-required，普通内容小改动则走 delta。
- 每条 `SemanticClaimV1` 都绑定 authority、精确 source range/range digest、lens、policy 和依赖。inventory/结构观察不得宣称职责、风险、建议、完整问题数或人工深读；这些判断只能由 `agent-semantic` 声明承接。
- V1 snapshot 仅返回只读迁移状态，不参与 V2 reuse/accept；快照损坏、抽样不一致、graph builder 不兼容或高风险分析走完整正确路径。正常 graph identity 变化会用当前图重算闭包而不是全文；动态依赖消费者自身变化才 full-required，其他变化保守重读全部 unknown consumers。

运行时位置为 `<active-root>/.runtime-state/project-knowledge/v2/<repoId>/snapshot.json`。它始终是可重建派生状态，项目文件、已确认需求和验证证据仍是真相源。

### 治理意图按评估结果分流

每条非空用户消息先登记一个中性 candidate，但这不代表一定要写治理台账。AI 必须先完成合理性评估、项目现实扩展和上下文归因，再形成结构化 `GovernanceIntakeDecision`；关键词或固定措辞只可辅助检索，不能决定是否触发、归类或跳过评估。

同一消息可同时形成多个 `record.*` 意图，必须分别对应 PI/PF/VL/GR/ISSUE 台账和证据。支持 Hook 的宿主只在成功 PostToolUse 精确写入当前 active-root 台账、且落盘文件存在相同 ID 时标记 verified；失败、错误 root、不可观察结果或只在回复里写编号都保持 unverified。instruction-fallback 宿主在报告和记忆保留同样字段与人工复证路线。`record.none` 不是默认兜底，也要说明 no-governance-impact、scope=none、规则状态和具体 skipEvidence。

### Intent Expansion Card

非 chat 工作流在 CP1 / 问题确认前需要形成 Intent Expansion Card，记录 `semantic`、`project`、`continuity`、`action`、`domain`、`artifact-impact`、`risk`、`host-capability`、`validation-route`、`confidence`、`alternatives`。这张卡用于把入口判断、CP 产物和压缩恢复后的复核锚在同一组事实上。

dev 模式默认向用户展示完整 Intent Expansion Card；prod、instruction-fallback 宿主或低风险轻任务才退化为 3~5 行摘要。

当项目现实扩展导致路由变化、命中控制面或宿主能力差异、风险不为 normal、`confidence` 非 high，或跨会话 resume 时，用户面还应输出 3~5 行意图扩展摘要。摘要只保留语义初判、扩展后路由、关键风险、验证路线和备选路径。

### Context Rehydration Contract

压缩恢复、resume、summary 恢复，或用户明确要求“按文件真相重建”时，必须按以下优先级重建上下文：

1. 当前用户消息
2. 已确认需求/bug 产物
3. 当前任务 `sessions.md`
4. 当日 `tasks/YYYYMMDD.md`
5. Agent `SUMMARY.md`
6. compaction / summary 摘要
7. AI 当前推断

摘要只能作导航提示，不能覆盖文件真相源；若文件态和当前推断冲突，必须重建 Intent Expansion Card。

这里的优先级是“冲突时谁更权威”，不是默认全文读取清单。恢复时先用 `memory_status` 定位 active/unresolved，再取单个 handoff/session 和必要 SUMMARY 行，最后按 source-of-truth 精确读取需求、报告、清单或源码。

### ContextHandoffCard

跨会话、跨 Agent、多批次、summary/compact 前或用户要求传递上下文时，交接方必须在报告或 daily tasks 写入 `ContextHandoffCard`，覆盖 `source-of-truth`、`confirmed-decisions`、`open-risks`、`next-action`、`blocked-reason`、`must-not-overwrite`、`validation-state` 与 `artifact-links`。恢复方仍按 Context Rehydration Contract 核对文件真相源，不能用 handoff 覆盖已确认产物、sessions、tasks 或 SUMMARY。

### SimpleTaskFastPath

非常明确、预计 ≤2 个源码/文档文件、无公共 API/Schema/依赖/配置/发布/控制面/台账来源/高风险、无需多轮跟踪的简单 dev/fix 任务，可免建需求/bug 目录、`00-需求概况.md`、`00-需求变更概况.md`、`00-问题概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、`01-问题确认.md` 或 `04-实施计划.md`。AI 必须在报告/记忆写明 `SimpleTaskFastPath: applied`、`N/A + skipReason`、验证证据和升级回退判断；执行中任一条件失效时，立即升级回完整 CP/产物链。

若用户是在调整/修改/补充既有需求或问题，且已有 `00-需求概况.md`、`00-需求变更概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、`00-问题概况.md`、`01-问题确认.md` 或其他需求/bug 真相源，则命中 `ExistingRequirementArtifactOverride`：SimpleTaskFastPath 只允许不新建完整产物，不能跳过文件回写；AI 必须先更新已有文件，再在回复中摘要说明。

### ArtifactDecisionMatrix

CP1 / CP2 / CP3 / ECR 会按任务规模列出关键产物的 `create` / `update` / `skip` / `N/A` 状态，覆盖入口类型、`00-需求概况.md`、`00-需求变更概况.md`、`00-问题概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、`01-问题确认.md`、`02-技术方案.md`、`04-实施计划.md`、`05-实施进度.md`、`06-关键决策.md`、目标文档、报告和记忆。判定优先级固定为：已有真相源回写 > 任务触发条件 > SimpleTaskFastPath > 子类型豁免。

这意味着技术方案、实施计划和实施进度不是“所有任务都机械创建”。一旦命中轻路径或 docs/init 等 CP3 豁免，AI 必须写清 `N/A + skipReason` 与升级回退条件；一旦已有需求/问题真相源，则必须先更新文件。

### ImplementationComplexityLevel

CP1 需求/问题确认必须记录开发程度等级：`简单够用`、`中等` 或 `企业级`（兼容旧字段 `ImplementationComplexityPreference`）。用户未要求复杂化、需求未说明或简单方案可满足已确认产品事实源和业务目标时，默认选择 `简单够用`，优先局部补丁、既有模式和最少维护成本；AI 可以展示更高级方案，但若判断需要升级到 `中等` / `企业级`，必须先列出 2~3 个方案、开发周期、难度、维护成本、非目标和取舍，等待用户确认后再进入 CP2/CP3。

### Hook closure 三态

Hook Stop / PreCompact 的可见回复验证区分 `verified-present`、`verified-missing`、`unverified`。无法解析最终 assistant 内容时，提示“无法验证最终用户可见回复”并给出 payload capture 指引；只有已解析且确实缺入口检查时，才提示 `entry check block 未输出`。Codex adapter 默认注册 `PreCompact`，并用 `manual|auto` matcher 覆盖手动与自动压缩触发。

### ECR 执行闭环复审

dev/fix 完成前必须执行 ECR 执行闭环复审。ECR 会交叉验证 CP1/CP2/CP3、报告、daily tasks、SUMMARY、diff/commit、测试/探针和 git dirty 边界，确认没有“报告已完成但证据不足”或“SUMMARY 已完成但 daily 仍未闭环”的状态错配。

当任务触发 ExecutionContract、TestRoute、ReleaseAudit、ReleaseVerification、ConceptSyncMap、HostContractVerification 或 `05-实施进度.md` 时，ECR 必须把这些产物纳入关键证据；未触发时报告中写明 N/A 依据。

控制面或模板-示例-校验链任务要先建立 Concept Sync Map：至少写清 `sourceOfTruth`、`currentConsumers`、`historicalMirrors`、`validateProbes`、`deployCopies`、`yellowDeviationBoundary`。其中当前消费者必须同批同步，历史镜像只有在明确标注历史性质时才允许保留旧口径。

`OfficialDocsEvidence` 与 `ProfileImpactCheck` 属于 dev/fix 的前置和收尾证据：前者防止依赖、框架、SDK 或平台 API 用法靠猜；后者防止项目事实已经变化但 Profile 仍停留在旧技术栈、旧目录或旧验证路线。

`ServiceLifecycleCleanup` 属于测试路线和 ECR 证据：AI 自己启动的 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，验证结束后必须主动关闭并核验端口释放；非本轮 AI 进程只报告线索，不擅自终止。

Hook / CLI / visible reply / sticky project / workspace guard 相关任务还要补 HostContractVerification 证据：至少说明 `hostSurface`、`eventScope`、`evidenceMode`、`visibleReplyEvidence`、`workspaceGuard` 与 `bootstrapScope`，避免把“文档已经写了”误当成宿主行为已验证。

### 敏感信息与连接配置

默认允许敏感信息、明文连接信息和硬编码出现在用户要求的代码、脚本、配置、文档、测试或报告中；只有用户 / 项目明确禁止时，AI 才脱敏、占位或改用 env、`secretRef`、secret manager、`config.local.json`。`.devcodex/**/profile/config.local.json` 只是用户 / 项目指定时使用的本地 overlay：可承载长期连接、本地明文连接信息、env / secretRef 引用和受控扩展位 `extensions.<namespace>`，不替代 `config.json`，也不能覆盖 `mode` / `agent` / `pluginVersion`。脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息默认可直写或沿用项目既有模式，只有用户或项目明确指定时才从这里取得；若项目使用本地连接别名、env / secretRef 或扩展位，需在 `01-项目信息.md` 或 Profile README 说明用途、字段语义和使用方式。

### 诊断与排错入口

- `devcodex doctor`：查看当前宿主、Hook、Profile、记忆与 adapter 状态，适合先判断“规则到底有没有加载”
- `devcodex status --json` / `devcodex doctor --json`：输出统一 `DevCodexCliEnvelopeV1`，适合 CI/脚本消费；非法参数为 `CLI_INVALID_OPTION` + exit 2，默认人读输出不变
- `devcodex probe [host workspace profile] --json`：运行同步、local-only、只读 typed probes；依赖失败会 skipped，不联网、不 watch、不写状态或 telemetry
- `devcodex trace show|replay --state <lifecycle-state.json> --json`：查看/校验当前 `LocalTaskTraceV1`；sequence/duplicate/terminal 失败返回稳定错误，replay 不执行 payload、不改 state、不唤醒或控制进程
- Intent 阶段转换使用 `IntentConsistencyDecisionV1` 核对 proposal/requirement/phase/confidence；短确认无绑定时必须澄清，不能靠历史或 route hint 补猜
- Skill portfolio schema v2 提供保守 `SkillIndexV2` 和只读 `BundleDecisionV1`；结构证据不得自动改变 active/gray lifecycle。portfolio 会绑定 tracked consumer inventory/projection；所有预期文件 stage 后运行 `npm run test:skill-portfolio:staged`，commit 后在 clean tree 重跑普通 `--check`，两次证据不能互相替代
- `devcodex help`：查看 CLI 子命令与参数，尤其是 `profile init`、`migrate-layout`、`init/update --claude/--codex`
- `node scripts/validate-all-profiles.js --workspace <workspace-root>`：校验 `.devcodex/workspace/profile` 与 `.devcodex/<project>/profile` 的三档必需文件和 workspace fallback；发布前可追加 `--strict-warnings`
- `DEVCODEX_HOOK_ENFORCEMENT`：默认 `safety-only`，仅危险命令硬拦；切到 `strict` 前应先确认宿主确实支持对应 Hook 事件；当前 Codex adapter 已内置 `PreCompact` compaction runtime 兜底
- `.mcp.json` 目前只由 Claude Code adapter 自动写入；Codex / Copilot 若宿主支持 MCP，需要手工配置，不能把 Claude 的 `.mcp.json` 当成三宿主通用入口
- Turn Liveness：工具返回后先进入 `awaiting-continuation`，120 秒无后续事件标记 `suspect`，300 秒标记 `stalled-recoverable`；活动工具/Agent 使用更长租约，避免把真实长任务误判为挂起
- 宿主能力边界：`PostToolUse` 不是 terminal，也不能证明宿主会继续派发事件；Hook 仅在下一次事件到达时生成一次性 `TurnRecoveryCard`，不得自行唤醒宿主、控制进程或重放未知副作用操作
- 双阶段 CheckpointValidation：response-time 记录当前可见事件；post-execution 缺 Stop terminal evidence 时保持 `unverified`，deadline 到期为 `incomplete-timeout`，不得把等待或 PreCompact 推断为完成
- LocalTaskTrace：当前 turn 记录严格递增 sequence、唯一 eventId 和唯一末尾 terminal；历史 turn 只保留 TurnLiveness 摘要，CLI replay 是只读数据投影
- gray sidecar：源码仓运行 `npm run check:turn-liveness -- --state <lifecycle-state.json> --json`；安装包运行 `node node_modules/@vextjs/devcodex/scripts/check-turn-liveness.js --state <lifecycle-state.json> --json`。它只做 one-shot 读取/分类，证据状态为 `sidecar-observed`，不 watch、不写状态、不唤醒、不重放、不控制进程

### 用户可见交付与 MCP fallback

文件交付采用 `ArtifactDeliveryManifestV1 → UserFacingArtifactSetV1 → DevCodexVisibleEnvelopeV1 → LinkCapabilityDecisionV1 renderer`。内部 manifest 对账全部 planned/observed/delivered 产物；用户面默认只显示最终报告、直接交付物和必要证据，session、daily、SUMMARY、task/checkpoint、raw receipt/manifest/ledger 继续写入和验证但不默认展示。每项使用语义名称、用途和用户动作，按决策、结果、证据、可选详情排序。

链接策略依据当前 surface 的可验证能力选择：已验证 clickable 时只显示一个语义 Markdown 链接；未知能力使用 portable 工作区相对链接；纯文本 surface 使用可复制短路径。只有用户明确要求、链接实际失败、工作区外、路径歧义或宿主无法定位时才追加绝对路径 fallback，并记录原因。`ArtifactLinkSet` 仅是兼容投影，仍由 `ArtifactLinkSetDedupeGate` 按 canonical path 去重；禁止 `file://` 与裸文件名交付。

若 Copilot / Codex 等非 Claude Code 宿主在 `profile_load`、`profile_get_mode` 等 MCP 工具上出现 `Cannot read properties of undefined (reading 'invoke')`，按宿主 MCP bridge 失败处理：不要反复重试同一 MCP 调用，立即降级读取 `.devcodex/**/profile/`、`SUMMARY.md` 与当日任务记忆，并在 HostContractRoute 中记录 `mcpFallback=used`。

### 推荐结论与确认交互

分析、审计或执行报告存在多个建议/路径时，必须给出推荐结论与推荐理由；没有后续动作时写明“推荐：无后续动作”。用户确认先抽象为 ConfirmationRequest，再按宿主能力使用按钮、权限提示、Hook 阻断或文本确认 fallback。

ConfirmationRequest 是语义层抽象，不要求 runtime 逐字输出同名对象；不同宿主只需输出与各自契约匹配的按钮、阻断或文本确认结果。

### QuestionEvidenceGate 与对比调研门禁

当用户问“是否应该 / 哪个更好 / 有没有更好建议 / 推荐什么”，且结论会影响时间、金钱、架构、产品/项目路线或长期维护成本时，先执行 `QuestionEvidenceGate`。命中推荐、选型、同类产品或同类项目判断时，再执行 `ComparativeResearchGate`，比较同类产品 / 项目 / 本仓库相似模块 / 已有设计并说明证据范围；技术路线、架构优化、性能优化、框架能力设计或高维护成本方案在 CP1 最终需求确认前执行 `TechnicalRouteComparativeGate`，把证据范围和采纳 / 不采纳理由写入需求。纯解释、低风险本地事实或用户明确要求快速答复时，写 `N/A + skipReason`，避免把普通问答默认升级成重调研。

### 执行期 CP3 回退

若 dev/fix 任务在执行过程中实际变更范围扩展到 CP3 门槛（≥5 文件、高风险、控制面联动），必须暂停执行、回补 CP3，并把新增验证与回滚路线写入实施计划后再继续。

### 相关文件联查

当前正式规则要求：当任务涉及控制面规则、模板、接口契约/验证产物、工作区真相源/部署副本或发布口径变更时，AI 不能只看单文件结果，必须联查相关文件；若同时命中多真相源同步或模板-示例-校验链，需进一步升级为交叉验证或 `CRS`。

进度产物不是小任务默认文书；但跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面任务、模板-示例-校验链或部署同步联动时，必须在执行前初始化 `05-实施进度.md` 并随批次更新。默认前提是已有 `04-实施计划.md`；docs/init 等 CP3 豁免任务可使用已确认文档大纲、任务切片或 ContextHandoffCard 作为等价计划锚点。

---

## 架构约束动态更新说明

> ⚠️ **v1.0.0 仍在开发中**，`02-架构约束.md` 是动态演进的，不代表最终态。

- AI 读取时以**文件当前内容**为准，不推断或补全未写入的约束
- 发现新的约束边界 → 立即追加到 `02-架构约束.md`
- 约束废弃时 → 注明"已废弃：原因"，不直接删除（保留变更历史）

---

## 规范文件编写规则

| 规则 | 说明 |
|------|------|
| 语言 | agents/skills/instructions/prompts 统一用**中文**编写 |
| Skill 目录 | 必须是扁平一级目录，`name` 字段与文件夹名完全一致（小写+连字符）|
| Instructions | `applyTo: "**"` 全局注入，单文件 ≤ 500 行；500 行上限属于 DevCodex 规范资产写作约束，不机械约束业务需求、技术方案、报告或正式项目文档 |
| 文件名 | Instructions: `NN-<kebab>.instructions.md`；报告: `NN--<简述>.md`（双横杠）|

## 治理门禁与 Owner 索引（同步锚点）

> 本节为 validate / 文档同步锚点索引；执行正文以 Skills 与 gate-registry.json 为准。

| 分类 | 锚点 |
|------|------|
| 治理与吸纳 | Backlog Intake 真相复核 · 台账状态回写闭环 · 文档阅读顺序同步 · ReviewCoverageDelta · PE-12 资源生命周期与泄漏风险 · LeakRiskStabilityPressureTest · GovernanceGateRegistry · readme-authoring · audit-readme · ExistingDomainContractAudit · DocumentationTranslationParityGuard · FrontendExperienceQualityGate · ReviewFindingIntakeGate · AcceptedSuggestionRootCauseGate · ClusterEscalationGate · RiskBasedValidationLadder · NativeCommandExitCodeGate · 真实 command/shell/cwd/exitCode · ExternalRuntimePluginLifecycleGate · ExternalRegistryLifecycleMatrixGate · ServiceSpecReadGate · FunctionSourceFingerprintMatrixGate · prompts/templates · ReviewEscapeRecordGate · whyMissed · rerunEvidence · PostConfirmationReviewScopeGate · DevelopmentDriftGate · ChinesePrimaryExpressionGate · HistoricalCommonNormLayeringGate · PromptLongGateListDriftProbe · LayeredAbsorptionGate · LayeredAbsorptionDecision · ProactiveBetterAlternativeGate · Skill-first 吸纳架构 · CommonNormGeneralizationGate · ConfirmedAbsorptionCompletenessGates · LatestAbsorptionExecutionPack · A1~A10 · V74 · V82 · V84 · V85 · V86 · V88 · V89 · V90 · V95 · V96 · profile-lite · profile-standard · profile-closed-loop · AllDevCodexProfileValidationGate · ProfileTierStandardGate · ProfileLifecycleClassificationGate · ProfileGenerationContractGate · FeatureInventorySchemaGate · ProfileTierMigrationSafetyGate · ExpertOutputQualityGate · ExpertOwnerSkillGate · MemoryCannotSatisfyBootstrapGate · findingToPatchMap · independentReReview · ProfileTruthReconciliationGate · AuthorizedLocalSecurityAuditPresentationGate · PublisherCredentialTopologyGate · AgentCapabilityDomainCompletenessGate · ConsumerValidationEngineeringGate · CurrentBatchScopeDiffProbe · ContractVariantIsolationMutationGate · PhaseDeliverySemanticGate · ScenarioCoverageMatrixProbe · DesignFitnessGate · BrandVisualQualityGate · UserDocsPrimarySurfaceGate · PublicUserDocsMaintainerBoundaryGate · ActiveRequirementFinalResponseGate · BenchmarkRegressionGuard · ExecutionBudgetGate · ExternalWaitAccountingGate · LongTaskAuthorizationGate · WorkspaceSyncStatus · CompletionEvidenceGate · PostDeliverySelfCheck · SessionTimingCard · product-strategy · developer-experience-architecture · ux-interaction-architecture · frontend-architecture · backend-domain-architecture · production-readiness-sre · api-contract-architecture · external-integration-architecture · platform-ecosystem-architecture · data-architecture · security-threat-modeling · quality-strategy · design-system-architecture · accessibility-i18n · growth-analytics · business-model-review · distributed-systems-architecture · performance-engineering · privacy-compliance-architecture · ai-evaluation-engineering · DurableBatchOrchestrationProbe |


> 文档同步锚点：历史通用规范分层迁移；存在 coverage 阈值；CoverageGateDecision；菜单导航；自动生成 outline/侧栏已覆盖导航。


<!-- auto-sync anchors -->
Profile Freshness Check · 不能只验证“包能安装” · 验证卫生与包边界 · 复审覆盖增量 · 有效零发现

RuntimeI18nArtifactVerificationGate · FrontendBrowserVerificationBudgetGate · UserDocsImmediateComprehensionGate · UserPathContractSweep · 不能只验证“包能安装” · 需求/问题定义阶段先做平台工程判断 · 验证卫生与包边界 · 复审覆盖增量 · 有效零发现 · 内存泄露 · 资源指标前后对比 · 首页首屏 · 分层吸纳架构 · V2FormalSolutionPackage

自动生成 outline/侧栏已覆盖导航 · AuditMutationBoundaryGate
