# DevCodex

> AI 开发规范注入器 — 从 Copilot / Claude Code 双主支持升级为 Copilot / Claude Code / Codex 三宿主支持（Hook-First / Instruction-Fallback）

[![npm](https://img.shields.io/badge/npm-%40vextjs%2Fdevcodex-blue)](https://github.com/vextjs/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

## DevCodex 是什么？

DevCodex 通过 `.github/`（Copilot）、`CLAUDE.md + .claude/ + .mcp.json`（Claude Code）以及 `AGENTS.md + .agents/ + .codex/`（Codex）向受支持的 AI 编码客户端注入结构化的开发工作流规范。
在支持 Hooks 的宿主中，它优先用 `hooks/_runtime/lifecycle.cjs` 提供确定性的生命周期护栏；在不支持 Hooks 的宿主中，则回退到 instructions 语义层继续工作。

## 目录导航

- [DevCodex 是什么？](#devcodex-是什么)
- [功能特性](#功能特性)
- [安装](#安装)
- [使用](#使用)
- [正式需求与执行模板边界](#正式需求与执行模板边界)
- [默认执行原则](#默认执行原则)
- [CLI 命令](#cli-命令)
- [`.devcodex` 工作区集中布局（v1.10.0+）](#devcodex-工作区集中布局v1100)
- [本地开发](#本地开发)
- [架构概览](#架构概览)
- [客户端支持矩阵（Client Support Matrix）](#客户端支持矩阵client-support-matrix)
- [IDE 兼容性](#ide-兼容性)
- [文档](#文档)
- [边界声明](#边界声明)
- [Tier 说明](#tier-说明)
- [Agent 入口](#agent-入口)
- [许可证](#许可证)

## 功能特性

- **8 种工作流**: `dev` / `fix` / `audit` / `analyze` / `self-fix` / `resume` / `plan` / `chat`
- **2 种模式**: 确认模式（@DevCodex）/ 全自动模式（@DevCodex Auto，Auto v1.1 对显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `extensions.devcodex.autoAliases` 替换别名或明确自然语言 auto 授权 + 白名单路径提供硬保证）
- **合规管线**: FC（形式合规）→ SC（实质合规）→ RC（恢复性检查）→ T（任务完成验证）
- **持久记忆**: 每 Agent、每日的会话记录，结构化字段
- **自动报告**: 每次会话自动写入报告，从不询问 — 直接执行
- **安全底线**: S01~S07 七条不可覆盖的安全规则
- **宿主生命周期护栏**: Claude Code 与 OpenAI Codex 在已支持的 Hook 事件上提供 runtime 护栏；Copilot / JetBrains / Cursor 等无等价本地 Hook 时降级为 instruction-fallback；默认 `safety-only` 仅对危险命令硬拦，流程项提醒放行，`strict` 模式才升级可阻断事件
- **全模式入口检查**: 所有模式在实质任务前显示 PC0~PC7；dev 模式额外执行 PC4 规范雷达与完整合规链
- **项目现实扩展**: 先做语义意图初判，再结合目标项目 Profile、目录与当前任务上下文修正最终路由、产物落点和验证方式
- **可配置并发策略**: Profile `config.json` 可配置 `extensions.devcodex.concurrency`；默认 `auto` 表示只读准备和隔离验证可并行、共享状态写入保持单写者，保守项目可设为 `serial`
- **支撑型 Skill**: `execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync` 为控制面、多批次、测试路线、宿主契约验证与真相源-消费者同步提供可审计支撑，不新增工作流分支
- **发布前审查能力**: `audit-release` 负责 release readiness、发布说明质量、兼容/迁移风险、package/plugin 元数据、文档/Profile/website 同步、回滚策略、registry/tag 风险与发布后验收 review；`release-verification` 仍负责 R0~R7 执行验证链
- **README 专项能力**: `readme-authoring` 负责 README 用户/使用者优先写作，`audit-readme` 负责 README / 用户使用文档专项 review；`UserPerspectiveDocsGate` 要求文档按使用者第一次成功、常见任务、字段/参数/状态/错误解释、排错恢复和低心智负担组织，`PublicUserDocsMaintainerBoundaryGate` 要求公开用户文档不混入维护者 checklist、内部同步清单或台账状态，`DocsConsumerSweep` 负责同步 README、website、Profile、示例、模板、导航和代码消费点
- **Profile 新鲜度审查**: audit 会先执行 `Profile Freshness Check`，反向核对 Profile 是否仍匹配当前包版本、目录资产、脚本、发布状态、宿主能力和任务现实
- **项目工程泄漏审查**: 项目工程 / 代码质量审查执行 `PE-12 资源生命周期与泄漏风险`，必须检查内存泄露、资源泄漏、监听器/定时器/连接/流未释放、缓存无界增长和组件卸载清理缺失
- **泄漏风险稳定性压测**: 写测试用例或回归验证时先执行 `LeakRiskStabilityPressureTest` 条件判定；命中长运行、高并发、缓存/连接/监听器/定时器/流/socket/worker/订阅/组件生命周期或 `PE-12` 风险时，TestRoute 纳入场景/负载/稳定性压测并记录基线、冷却后回落和资源指标前后对比；低风险任务写 `N/A + skipReason`
- **前端体验质量门禁**: 前端页面、组件、控制台、官网、文档站、可视化工具或游戏任务执行 `FrontendExperienceQualityGate` 条件判定，覆盖设计来源、UI 还原度、风格主题、响应式状态、视觉验证、用户流、交互反馈、输入方式/可访问性、错误恢复和动效转场；Figma/截图/既有页面还原追加 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`FrontendRuntimeNetworkProbeGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate` 与 `RuntimeI18nArtifactVerificationGate`；命中时 TestRoute 纳入 Browser/截图、Playwright/E2E、console/network/resource/runtime 或人工复核证据
- **复审覆盖增量与维度增量**: audit / review / ECR 的连续零发现必须附 `ReviewCoverageDelta`（覆盖面增量）与 `ReviewDimensionDeltaGate`（维度焦点增量），优先阅读此前未审查但相关联的代码、配置、测试、文档、部署副本和消费者链，并避免每轮机械重复同一组维度；无新增覆盖、无新增维度焦点且无证据化理由时，不计入有效零发现
- **规范治理 Intake**: 所有模式下每条用户消息在合理性评估后都会额外检查是否命中可泛化改进；命中时主动写入 `data/process-improvements.md`（优化清单，PI），必要时联动 `data/pending-fixes.md`（PF），并显式回执 `PI/PF`
- **Backlog 真相复核与状态回写**: 从 `data/*.md` open/partial 项组织新需求或新批次前，先按 `pure-open / residual-tail / already-fixed / misclassified` 分类；实施后再执行台账状态回写闭环，避免“源码已修但 backlog 仍旧 open”
- **官方文档证据前置**: 新增或升级依赖、框架、SDK、平台 API、外部模块前，CP2 会要求 `OfficialDocsEvidence`，记录官方文档来源、关键用法、限制与兼容性，避免凭经验猜 API
- **通用工程守门**: Node.js 项目默认不低于 `>=18`；需求/问题定义前置平台工程判断，并记录 `ImplementationComplexityLevel`，开发程度分为 `简单够用 / 中等 / 企业级`，用户未要求复杂化或需求不详细时默认 `简单够用`；依赖/兼容任务拆分业务源码平滑性与依赖层落地条件；包/库/adapter/CLI 同查代码层与包工程层；JS/Node 必要注释使用标准 JSDoc；简单 service 不重复 route/model/schema 已承担的校验
- **跨项目经验吸纳守门**: 字段/本地化/状态新增前执行 `ExistingDomainContractAudit`，业务策略常量执行 `ConfigOwnershipMatrix`，接口文档合同执行 `ApiDocVerificationSync`，数据迁移执行 `DataMutationPlan`，值得吸纳建议执行 `AbsorptionDecision`，完整首版执行 `FullV1ScopeGuard`，启动优化执行 `StartupPhaseTrace`；新增吸纳 `CodeTruthRequirementGate`、`ManualReviewEvidenceRetention`、`DocumentationTranslationParityGuard`、`FormalDocsDevCodexBoundary`、`LLMPromptContractTriage`、`VerificationScopeBudgetGate`、`LiveVerificationExecutionObligation`、`ExplicitCommitAuthorizationGate`、`CompatibilityAndContractAuthorityGate`、`UIConfirmedSourceConflictTraceGate`、`PublicDocsReleasedVersionGate`、`CollectionRelationIdNamingGate`、`UserFacingVerificationArtifactLanguageGate`、`AdapterBenchmarkAttribution`、`ProductRequirementTraceabilityGate`、`LocalExecutionConfigProbe`、`ManualReviewEvidenceDataRetention`、`AdjacentScopeExpansionGuard`、`PackageNameAuthorityGate`、`PerformanceBenchmarkFirstGate`、`PublicModuleDifferentiationGate`、`V2MCPFirstPlanningGate`、`WorkspaceDataAbsorptionScopeGate`、`FlowchartNodeExplanationGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`ReviewFindingIntakeGate`、`ReviewDimensionDeltaGate`、`UserPerspectiveDocsGate`、`PublicUserDocsMaintainerBoundaryGate`、`DocsConsumerSweep`、`ArtifactLinkSetDedupeGate`、`FrontendRuntimeNetworkProbeGate`、`ActiveRequirementFinalResponseGate`、`MethodLevelLeakPressureProbe` 与 `V2FormalSolutionPackage`
- **验证卫生与包边界**: release / pack / benchmark / codegen 任务中，package boundary check 必须在构建完成后单独串行执行；消费者验证异常先查 package.json、lockfile、node_modules 与 `npm ls <关键依赖>`，收尾前清理无关 dirty 文件和验证残留
- **ProfileImpactCheck**: dev/fix 改动项目技术栈、目录、脚本、测试/发布路线、分发面、配置或长期连接时，会主动判定是否需要更新 Profile；无需更新时也要写明跳过理由
- **敏感信息与硬编码策略**: 默认允许敏感信息、明文连接信息和硬编码出现在用户要求的代码、脚本、配置、文档、测试或报告中；只有用户 / 项目明确禁止时才脱敏、占位或改用 env、`secretRef`、secret manager、`config.local.json`
- **AI 自启动服务清理**: AI 为验证启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target 后，验证完成、失败或最终回复前会主动关闭仅由 AI 本轮启动的服务并核验端口释放；用户要求保留时会记录 PID/端口和关闭方式
- **变更日志分层**: 未发布实现变更写 `changelogs/unreleased.md`，已发布详情统一归档到 `changelogs/releases/vX.Y.Z.md`，目录说明见 `changelogs/README.md`
- **执行闭环复审**: dev/fix 完成前执行 ECR 执行闭环复审，交叉验证 CP 产物、报告、daily memory、SUMMARY、diff/commit、测试/探针与 dirty 边界
- **推荐结论**: analyze/audit/report 多建议或多路径场景必须给出推荐结论与推荐理由；无后续动作时明确写“推荐：无后续动作”
- **对比调研门禁**: 用户问“是否应该 / 哪个更好 / 有没有更好建议 / 推荐什么”且结论会影响时间、金钱、架构、产品/项目路线或长期维护成本时，先执行 `QuestionEvidenceGate`；技术路线、架构优化、性能优化、框架能力设计或高维护成本方案在 CP1 最终需求确认前执行 `TechnicalRouteComparativeGate`；必要时比较同类产品 / 项目 / 本仓库相似模块，普通低风险问答可标 `ComparativeResearchGate: N/A + skipReason`
- **确认交互降级**: 用户确认先抽象为 ConfirmationRequest，再按宿主能力选择按钮、权限提示、Hook 阻断或文本确认 fallback，不把按钮 UI 承诺为全宿主能力
- **执行护栏**: 新需求切换时优先按意图判断边界；涉及外部平台/API/兼容性判断时优先看官方文档；提交时压缩 commit subject

## 安装

### 1. 配置 GitHub Packages 认证

```bash
# 创建 .npmrc（推荐使用环境变量注入 GitHub PAT，避免把 token 写入仓库或本地文件）
echo "@vextjs:registry=https://npm.pkg.github.com" >> .npmrc
echo "//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}" >> .npmrc
```

```bash
# 当前 shell 注入 PAT（需具备 read:packages；发布时还需 write:packages）
export NODE_AUTH_TOKEN=YOUR_GITHUB_PAT
```

这里的环境变量仅用于 GitHub Packages 认证流程，不代表项目里的普通配置默认都应 env 化；未明确要求 env 时，AI 不得主动把明文或硬编码改成 env、`secretRef`、secret manager 或 `config.local.json`。

> 当前安装包通过 **GitHub Packages** 分发；在执行 `npm install @vextjs/devcodex` 之前，必须先完成上述 registry 与 `NODE_AUTH_TOKEN` 认证配置。

### 2. 安装并初始化

```bash
npm install @vextjs/devcodex
npx @vextjs/devcodex init          # 默认三宿主部署：Copilot + Claude Code adapter + Codex adapter
npx @vextjs/devcodex init --claude # 仅 Claude Code adapter
npx @vextjs/devcodex init --codex  # 仅 Codex adapter
```

默认 `init` 会先将 Copilot 规范文件复制到项目的 `.github/` 目录，再链式部署 Claude Code adapter（`CLAUDE.md + .claude/ + .mcp.json`）与 Codex adapter（`AGENTS.md + .agents/ + .codex/`）：

```
.github/
├── copilot-instructions.md  ← 默认 Copilot always-on 总则（新增）
├── instructions/   ← Instructions 约束（15 个，含全部工作流规则）
├── agents/         ← Copilot 自定义 Agent（v1.9.8 起恢复默认分发）
├── skills/         ← Skill 详细检查标准（44 个，按需读取，含 README 专项能力、spec-governance 与 5 个支撑型 Skill）
├── prompts/        ← Prompt 模板（26 个）
├── hooks/          ← 宿主生命周期 Hook 配置与运行时
│   ├── devcodex.lifecycle.json
│   └── _runtime/
├── data/           ← 运行时数据模板
└── RULES.md        ← 使用入口
```

Codex adapter 会同步以下工作区根产物：

```
AGENTS.md                 ← 与 instructions.md / copilot-instructions.md / CLAUDE.md 同源
.agents/
└── skills/               ← Skill 详细检查标准（与源仓库 skills/ 同步）
.codex/
├── hooks.json            ← Codex Hook 入口配置
└── hooks/_runtime/       ← 统一 lifecycle.cjs 运行时及 helper 模块
```

`init --claude` 是 Claude Code-only 路径：只写入 `CLAUDE.md`、`.claude/{instructions,skills,prompts,hooks/_runtime,mcp,data}` 与 `.mcp.json`，并同步开启项目级 hooks / MCP / permissions 配置。

`init --codex` 是 Codex-only 路径：只写入 `AGENTS.md`、`.agents/skills/` 与 `.codex/{hooks.json,hooks/_runtime}`。若工作区根已有非空 `AGENTS.md` 或 `.codex/hooks.json` 且内容不同，CLI 会先把备份写入 active-root 的 `.tmp/backups/`，再覆盖为 DevCodex 受管副本。

> ⚠️ 请确保 IDE 的 "Use Instruction Files" 设置已开启（默认开启）。
>
> ℹ️ Copilot 路径当前以 instruction-fallback 作为公开能力口径；若目标 IDE 支持 Workspace Hooks 且未被管理员禁用，DevCodex 会加载 `.github/hooks/*.json` 作为额外生命周期护栏，但不把它计入 Full 等级承诺。不支持 Hooks 的宿主自动回退到 instruction-fallback。
>
> ℹ️ `v1.9.8` 起，`devcodex init/update` 已恢复 Copilot 端 `.github/agents/` 默认分发；Claude Code 端仍通过 Skills 路由，不分发 agents。

## 使用

标准安装后，Copilot 会通过 `copilot-instructions.md` + `.github/` 自动加载；Claude Code 会通过 `CLAUDE.md` + `.claude/` + `.mcp.json` 自动生效；Codex 会通过工作区根 `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json` 生效。正式支持链都无需额外选择 Agent，直接对话即可：

```
帮我重构 user 模块的权限校验逻辑
→ 自动识别为 dev 工作流 → CP1 需求确认 → CP2 方案确认 → CP3 实施计划 → 执行 → ECR 执行闭环复审 → 完成

这个接口返回 500 了
→ 自动识别为 fix 工作流 → 根因分析 → 修复方案 → 执行 → 三步扫描 → ECR 执行闭环复审 → 完成

深度审查一下这个项目的代码质量
→ 自动识别为 audit 工作流 → 多轮收敛审查 → 输出报告
```

标准安装路径下，无需也不依赖 `@DevCodex`；`.github/agents/` 作为 Copilot 端可选显式入口随默认安装分发。`v1.9.0` 起，Hook 运行时也随 `init/update` / `init --claude` 分发到目标项目，不再要求从 `node_modules/@vextjs/devcodex/...` 读取 Hook 脚本。

## 正式需求与执行模板边界

当前仓库的正式需求信源是 `website/docs/versions/v1/<active-version>/requirements/`，版本内的 `index/design/plan/progress/decisions` 都以这里为准。

`prompts/*.prompt.md` 不是当前项目的正式需求入口，而是 CP1 / CP2 / CP3 的默认执行模板：它们负责约束 AI 如何生成需求概述、技术方案、实施计划与实施进度。若项目已经定义自定义 requirement 规范，则项目规范优先，prompt 只提供通用骨架。

默认职责边界如下：

- CP1：确认需求目标、用户交互、业务流程、验收结果与范围边界
- CP2：确认实现流程、节点职责、公共契约、兼容性策略、边界问题与测试策略
- CP3：确认实施顺序、里程碑、验证方式、风险与回滚
- 执行后正式阶段：ECR 执行闭环复审（确认实现、关键产物、报告、记忆、SUMMARY、diff/commit、测试与完成结论一致）

当需求属于契约驱动型场景（例如对外 API、前端联调接口、页面/组件契约）时，可在 CP2 前先冻结目标文档，再让技术方案与实施围绕该文档落地。

文档能力边界如下：

- 轻量 API 文档：给调用方看的阅读型接口说明
- 前端接口文档：给前端联调使用的接口说明，额外包含页面/模块/前置条件与字段映射
- `api-verification`：给开发与回归使用的归档级接口验证双产物（`.http + .cjs`）

## 默认执行原则

- **意图优先**：当用户看起来切到新需求时，先基于上下文判断意图；只有意图不清晰时才用关键词辅助，而不是反过来。
- **入口检查全模式显示**：无论 `prod` 还是 `dev`，都会先展示 PC0~PC7；`prod` 只显示基础状态，`dev` 追加规范雷达、合规检查和完成验证。
- **项目现实扩展再路由**：识别用户意图后，会先加载目标项目 Profile，并用项目技术栈、目录结构、当前需求上下文修正最终工作流，避免只按字面关键词执行。
- **Intent Expansion Card**：非 chat 工作流会在 CP1 / 问题确认前形成可审查卡片，记录项目、连续性、模块领域、风险、宿主能力、验证路线、置信度和备选路线。
- **Intent Expansion 可见性**：dev 模式默认会直接展示完整 Card；prod、instruction-fallback 宿主或低风险轻任务才退化为 3~5 行摘要。
- **意图扩展摘要**：当扩展后路由变化、命中控制面/宿主差异、风险较高或跨会话恢复时，会在用户面输出 3~5 行摘要，便于确认“为什么这样路由”。
- **Context Rehydration Contract**：压缩恢复、resume 或用户要求按文件真相重建时，会按“当前用户消息 → 已确认产物 → sessions → tasks → SUMMARY → 摘要 → AI 推断”的优先级恢复上下文，摘要不能覆盖文件真相源。
- **ContextHandoffCard**：跨会话、跨 Agent、多批次、summary/compact 前或用户要求传递上下文时，会把 source-of-truth、confirmed decisions、open risks、next action、must-not-overwrite、validation state 与 ArtifactLinkSet 写入报告或 daily tasks；恢复时仍按 Context Rehydration Contract 重新核对文件真相源。
- **SimpleTaskFastPath**：非常明确、预计 ≤2 文件、无公共契约/配置/发布/控制面/台账来源/高风险、无需多轮跟踪的简单 dev/fix 任务，可免建 `01-需求概述.md` / `04-实施计划.md`，改用内联 CP 摘要 + 报告/记忆 `N/A + skipReason`；范围扩大时立即升级回完整产物链。若已有需求/bug 真相源，命中 `ExistingRequirementArtifactOverride`，调整内容必须先回写文件，回复只做摘要。
- **ArtifactDecisionMatrix**：CP1/CP2/CP3/ECR 会按任务规模列出关键产物的 `create` / `update` / `skip` / `N/A` 状态，覆盖需求、技术方案、实施计划、实施进度、目标文档、报告和记忆；判定优先级为已有真相源回写 > 任务触发条件 > SimpleTaskFastPath > 子类型豁免，避免模板“必填”口径压过轻路径或条件触发。
- **Hook closure 三态**：Stop/PreCompact 可见回复验证区分 `verified-present`、`verified-missing`、`unverified`；无法解析最终 assistant 内容时只提示无法验证，并给出 payload capture 指引，不再断言“未输出”。
- **长流程执行契约**：Auto、控制面、多批次、预计修改 ≥10 文件或发布前置任务会触发 ExecutionContract；测试路线不明显时触发 TestRoute；正式发版前触发 ReleaseAudit 与 ReleaseVerification；控制面消费链联动时建立 Concept Sync Map；宿主契约变化时触发 `host-contract-verification`。
- **执行期 CP3 回退**：若执行过程中实际修改范围扩展到 CP3 门槛（≥5 文件、高风险、控制面联动），必须暂停执行并先补做 CP3，再继续改动。
- **边界先确认**：若已判断为新需求切换，且当前工作区还有未提交变更，会先提醒是否应先提交当前变更。
- **报告推荐项**：当报告中存在多个可执行建议或后续路径时，会明确给出推荐结论和推荐理由；没有建议时也会写明“推荐：无后续动作”。
- **确认交互适配**：ConfirmationRequest 是确认语义的统一抽象，不要求 runtime 逐字输出同名对象；Claude Code SDK / VS Code 扩展可用按钮，Hook 宿主可用阻断原因，Cursor / JetBrains 等 fallback 宿主使用文本确认。
- **高联动默认联查**：当任务涉及控制面规则、模板、接口契约/验证产物、工作区真相源/部署副本或发布口径变更时，会默认联查相关文件；若同时命中多真相源同步或模板-示例-校验链，会升级为交叉验证或 `CRS`。
- **Backlog Intake 真相复核**：若本轮需求、bug 或批次直接来源于 `data/*.md` 的 open/partial 项，会先核对源码、最新报告、测试和台账，把候选项分为 `pure-open / residual-tail / already-fixed / misclassified`，再决定是否继续纳入本轮。
- **台账状态回写闭环**：当实施或复审改变了 VL / PF / PI / ISSUE / GAP 的真实状态时，会在完成前回写状态、验证证据、验证时间与关闭/部分完成说明，并再核对 open 计数、进度、报告和 SUMMARY 是否一致。
- **官方资料优先**：涉及平台能力、框架 API、版本兼容性或工具语义判断时，优先读取官方文档，再降级到其他资料；新增/升级依赖、框架、SDK、平台 API 或外部模块时必须形成 `OfficialDocsEvidence`。
- **ProfileImpactCheck**：项目事实变化后，DevCodex 会检查是否需要同步 Profile 的技术栈、目录边界、脚本/测试/发布路线、配置说明或当前阶段；若不更新，需要在报告中写明 `skipReason`。
- **ServiceLifecycleCleanup**：若验证需要 AI 自己启动本地服务，会记录启动命令、cwd、PID/job、端口/URL，并在验证完成、失败或最终回复前关闭仅由 AI 本轮启动的服务；不会为了释放端口杀掉用户已有进程。
- **文档阅读顺序同步**：正文、README 或维护者文档一旦定义“先看什么 / 审查顺序 / 实施顺序”，website sidebar/nav、索引页和目录页要作为当前消费者同批校验；若信息架构故意不同，必须说明差异。
- **提交标题收短**：用户要求提交时，DevCodex 会优先生成一句简洁的 commit subject，而不是把整段会话摘要塞进标题。


## CLI 命令

| 命令 | 说明 |
|------|------|
| `devcodex init` | 初始化：同步 Copilot `.github/`，并链式部署 Claude Code 与 Codex adapter |
| `devcodex init --claude` | 初始化：仅同步 Claude Code adapter 到 `CLAUDE.md`、`.claude/` 与 `.mcp.json` |
| `devcodex init --codex` | 初始化：仅同步 Codex adapter 到 `AGENTS.md`、`.agents/` 与 `.codex/` |
| `devcodex update` | 更新：覆盖同步 Copilot `.github/`，并链式覆盖 Claude Code 与 Codex adapter |
| `devcodex update --claude` | 更新：仅覆盖同步 Claude Code adapter |
| `devcodex update --codex` | 更新：仅覆盖同步 Codex adapter |
| `devcodex migrate-layout plan` | 生成 `.devcodex` 工作区集中布局迁移清单 |
| `devcodex migrate-layout apply --manifest <path>` | 按 manifest 执行集中布局切换 |
| `devcodex migrate-layout rollback --manifest <path>` | 回滚集中布局迁移 |
| `devcodex status` | 状态：检查已安装的组件 |
| `devcodex doctor` | 诊断当前宿主、Agent、Hook、Profile 与记忆状态 |
| `devcodex help` | 查看 CLI 子命令与选项帮助 |
| `devcodex init --dry-run` | 预览模式：仅显示将复制的文件 |

## `.devcodex` 工作区集中布局（v1.10.0+）

当工作区根存在 `<workspace>/.devcodex/layout.json` 且 `mode = workspace-namespace` 时，DevCodex 会从“项目根各自持有 `.devcodex`”切换到集中命名空间模型：

- 单项目任务：写入 `<workspace>/.devcodex/<project>/...`
- 全工作区任务：写入 `<workspace>/.devcodex/workspace/...`
- `config.json`：`workspace/profile` 作为 base，`<project>/profile` 作为 overlay
- `config.local.json`：与 `config.json` 采用相同的 `workspace/profile + <project>/profile` overlay 模型，可作为用户 / 项目指定的本地 overlay，承载长期连接、本地明文连接信息、env / secretRef 引用和 `extensions.<namespace>`；不覆盖 `mode` / `agent`；脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息默认可直写或沿用项目既有模式，只有用户或项目明确指定时才从这里取得
- Profile 文档：项目命名空间文件优先，缺失回退到 `workspace/profile`
- CLI / Hook 运行态目录：统一写 active-root；单项目为 `<workspace>/.devcodex/<project>/.memory|.audit-state`，全工作区为 `<workspace>/.devcodex/workspace/.memory|.audit-state`
- 多项目 workspace 根缺少 workspace profile 时，Hook 提示真实路径 `.devcodex/workspace/profile/`；同一宿主会话已识别唯一项目后，后续“继续/确认”会在短 TTL 内沿用该项目和项目 `mode`，新会话、TTL 过期或显式 workspace 请求会重新判断。

配套 CLI：

```bash
devcodex migrate-layout plan
devcodex migrate-layout apply --manifest <manifest-path>
devcodex migrate-layout rollback --manifest <manifest-path>
```

> 真相源说明：只有在 `layout.json` 已创建后，runtime / MCP / profile init 才会按 `.devcodex/workspace` 和 `.devcodex/<project>` 解析；未启用时继续兼容旧的 `<project>/.devcodex/`。启用后不得再向 `<project>/.devcodex/.tmp` 等旧项目内运行态目录写入产物。

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/vextjs/devcodex.git
cd devcodex
```

### 在目标项目中测试 CLI

```bash
# 方式一：直接用 node 运行（推荐，无需 link）
cd /path/to/your-project
node /path/to/devcodex/index.js init --force

# 方式二：npm link
cd /path/to/devcodex
npm link
cd /path/to/your-project
devcodex init --force
```

### 验证安装

```bash
# 检查初始化后的文件结构
node /path/to/devcodex/index.js status

# 预期输出：
#   skills         X files
#   instructions   X files
#   prompts        X files
#   hooks          X files
#   data           X files
#   RULES.md       installed
#   copilot-instr  installed
#   legacy-agents  not installed   # 若有历史残留会显示 N files (legacy)
```

### 在 IDE 中验证规则自动生效

1. 在目标项目执行 `devcodex init`（默认同步 `.github/`，并链式部署 `CLAUDE.md + .claude/ + .mcp.json` 以及 `AGENTS.md + .agents/ + .codex/`）
2. 重启 IDE
3. Copilot：直接在 Copilot Chat 中输入普通需求，确认无需 `@DevCodex` 也会按规则工作
4. Claude Code-only：仅需单独部署 Claude Code adapter 时执行 `devcodex init --claude`，随后新开会话并确认 `CLAUDE.md`、`.claude/settings.json`、`.mcp.json` 已生效
5. Codex-only：仅需单独部署 Codex adapter 时执行 `devcodex init --codex`，随后新开会话并确认 `AGENTS.md`、`.agents/skills/`、`.codex/hooks.json` 已生效
6. 若在 VS Code 中启用了 Hooks，可在输出面板检查 `GitHub Copilot Chat Hooks`，确认 `.github/hooks/devcodex.lifecycle.json` 已被加载

### 文档站本地预览

> 维护者提示：CLI 安装/运行仍只要求 Node.js >=18；文档站基于 Rspress 2，当前本地构建需 Node.js `^20.19.0 || >=22.12.0`。

```bash
cd website
npm install
npm run dev
# 浏览器打开 http://localhost:3000/devcodex/
```

## 架构概览

```
devcodex/
├── instructions.md # 单源规范文件；安装时按平台生成 copilot-instructions.md / CLAUDE.md / AGENTS.md
├── agents/        # Agent 源文件；Copilot 端默认分发，Claude Code 端不分发
├── instructions/  # 全局 Instructions（15 个，含工作流规则摘要，自动注入）
├── skills/        # Skill 详细检查标准（44 个，按 01-common §按需读取表 路由读取）
├── prompts/       # Prompt 模板（26 个）
├── hooks/         # Workspace Hooks 配置与分发到 `.github/hooks/_runtime/` 的运行时及 helper 模块
├── codex/         # Codex adapter 源模板（分发到 `.codex/hooks.json`，不是工作区部署副本 `.codex/`）
├── data/          # 运行时数据模板（分发到目标项目的空骨架）
│   ├── README.md
│   └── templates/ # 空模板：violations / pending-fixes / pending-issues / process-improvements / gap-registry
├── index.js       # CLI 入口（零依赖）
└── plugin.json    # 插件元数据
```

规范治理新增 `spec-governance` Skill：记录类动作先做意图识别，再由 RecordRouter 分流到 `violations / pending-fixes / process-improvements（优化清单，PI） / pending-issues / gap-registry`；所有模式下每条用户消息还会执行主动 Improvement Intake，把已验证更优且可泛化的策略记录到优化清单，并在暴露规范缺口时同步联动 PF。规范/控制面/路径/模板/部署/校验链变更后必须执行 SCV（Spec Change Verification），避免修复一处后引入漂移。

控制面与长流程当前有五类支撑型 Skill：`execution-contract` 约束 scope / allowedPaths / requiredArtifacts / consumerScope / validationRoute / deviationLog，`test-router` 统一选择验证路线，`release-verification` 在正式 tag / publish 前执行 R0~R7 发布验证链，`host-contract-verification` 负责 direct replay / fixture replay / bootstrap / workspace guard 证据，`source-consumer-sync` 负责 Concept Sync Map 与当前消费者同步边界。

发布前审查由 `audit-release` 承担：它是 audit 专项维度，审查 release readiness、发布说明质量、兼容/迁移风险、package/plugin 元数据、文档/Profile/website 同步、回滚策略、registry/tag 风险与发布后验收；它不替代 `release-verification`，也不执行真实 `tag` / `push` / `publish`。

README / 用户使用文档当前补充两类专项 Skill：`readme-authoring` 负责把 README 默认主视角收口为用户 / 使用者优先，`audit-readme` 负责专项审查用户路径、快速开始、示例真实度、开发信息后置与消费链一致性。正式用户文档还执行 `UserPerspectiveDocsGate`、`PublicUserDocsMaintainerBoundaryGate` 和 `DocsConsumerSweep`：检查文档是否足够详细、首次读者是否看得懂、心智负担是否简单，公开用户路径是否排除了维护者 checklist / 内部同步清单 / 台账状态，以及 README / website / Profile / examples / templates / validate / 代码消费点是否同步。

&gt; ℹ️ 维护者状态文件（本仓库开发过程中累积的 violations/pending-fixes 记录）按 active-root 保存，例如 workspace-namespace 下的 `.devcodex/<project>/data/`，**不分发**给用户。

## 客户端支持矩阵（Client Support Matrix）

| AI 客户端 | 注入路径 | Bootstrap / Hook 护栏 | CP 门控 | 记忆/MCP | 等级 |
|---|---|:---:|:---:|:---:|:---:|
| **GitHub Copilot (VS Code)** | `.github/instructions/*.md` + `copilot-instructions.md` + `.github/agents/` | ⚠️ instruction-fallback；Workspace Hooks 需按目标版本另行实测 | ⚠️ 文本/本地 fallback | ❌ 未内置 MCP | 🟡 Beta |
| **GitHub Copilot (JetBrains)** | `.github/instructions/*.md` + `copilot-instructions.md`（instruction-fallback） | ⚠️ 官方自定义指令路径，无本地 Hook 硬拦承诺 | ⚠️ 仅文本 | ❌ 未内置 MCP | 🟡 Beta |
| **Claude Code (CLI/桌面端)** | `CLAUDE.md` + `.claude/{instructions,skills,prompts,hooks/_runtime,mcp}/` + `settings.json` hooks + `.mcp.json` | ✅ Hook 事件支持硬拦；默认 `safety-only` 下流程项提醒放行 | ✅ Hook + 文本确认 | ✅ MCP | 🟢 Full |
| **Cursor IDE** | 需手工配置 `.cursor/rules` 或 root `AGENTS.md`（instruction-fallback；DevCodex 不自动分发 Cursor 规则） | ⚠️ 无 DevCodex 本地 Hook 硬拦承诺 | ⚠️ 仅文本 | ❌ | 🟡 Best-effort |
| **OpenAI Codex app/CLI** | `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json`（含 `PreCompact` compaction guardrail） | ⚠️ Codex hook guardrail；阻断输出按事件契约分为顶层 `decision`、`continue:false` 与工具级 `permissionDecision` | ⚠️ Hook + 文本确认 | ⚠️ 可手工配置 MCP；DevCodex 未自动写入 | 🟡 Beta |
| **ChatGPT 普通对话** | 不读取本地工作区 `AGENTS.md` / `.agents/` / `.codex/`；可手工粘贴规则 | ❌ | ⚠️ 文本 | ❌ | 🔴 Unsupported |

> **安装命令**：默认三宿主部署 → `npx @vextjs/devcodex init`；仅 Claude Code adapter → `npx @vextjs/devcodex init --claude`（v1.9.0+）；仅 Codex adapter → `npx @vextjs/devcodex init --codex`。
>
> **能力差异**：🟢 Full = 已验证 Hook 事件 + MCP + 自动同步；🟡 Beta/Best-effort = 尚未达到 Full，具体能力以矩阵各列为准；🔴 Unsupported = 不在当前本地 adapter 发布范围。默认 `safety-only` 下，bootstrap / CP / auto 白名单等流程问题为提醒并继续，仅危险命令硬拦；设置 `DEVCODEX_HOOK_ENFORCEMENT=strict` 后，支持硬拦的事件才会停止流程。
>
> **MCP 边界**：`.mcp.json` 是 Claude Code adapter 的自动写入文件；DevCodex 当前不会为 Copilot 或 Codex 自动写入 MCP manifest。若 Copilot / Codex 宿主后续支持本地 MCP，请按宿主能力手工配置，再用 `devcodex doctor` 或宿主自带诊断命令核对状态。

### 产物文件链接兼容

DevCodex 在回复末尾输出文件产物时使用 `ArtifactLinkSet`，避免“在一个客户端可点击、换到另一个客户端失效”：

| 宿主 | 主链接策略 | 保底策略 |
|------|------------|----------|
| Copilot / JetBrains / Visual Studio | 工作区相对 Markdown 链接 | 强制同时给 `绝对路径：...` 供复制打开 |
| Claude Code | 工作区相对 Markdown 链接 | 跨工具交付时复制绝对路径 |
| Codex Desktop/App | 绝对路径 Markdown 链接优先 | 同时给 `绝对路径：...` |
| Codex CLI / 未识别宿主 | 工作区相对 Markdown 链接 | 强制给 `绝对路径：...` |

如果你看到“本次会话产物”下面只有文件名、没有 Markdown 链接或绝对路径，那属于输出不完整，应要求 AI 补齐 `ArtifactLinkSet`。

## 运行时配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `DEVCODEX_HOOK_ENFORCEMENT` | `safety-only` | `safety-only` 只对危险命令硬拦，流程类问题提醒放行；`strict` 会对宿主支持硬拦的事件启用更严格的 runtime 阻断 |

> 建议：默认先保持 `safety-only`；只有在团队已验证宿主 Hook 事件覆盖度后，再切到 `strict`。

### Hook 拦截动作语义

DevCodex Hook runtime 不再把所有拦截都等同为“停止”。拦截会写入 `interceptions.jsonl`，并按动作区分后续行为：

| 动作 | 含义 | 后续行为 |
|------|------|----------|
| `forbid` | 禁止危险或不可恢复操作 | 支持 Hook 硬拦的宿主直接拒绝；可审批危险命令会先返回 pending `devcodex-approve:<id>`，只有用户在后续提示中明确确认该 id 后，同一命令/目录 10 分钟内才可消费一次；`DROP TABLE`、无 `WHERE` 的 `DELETE FROM`、根目录 `rm -rf` 等不可审批 |
| `require_completion` | 必须补完某项才能进入下一步 | `strict` + 支持硬拦事件时停止；默认 `safety-only` 下提醒并继续，AI 必须补完缺项 |
| `warn_continue` | 风险提示但允许继续 | 继续执行并记录原因，适合 bootstrap/CP/auto 等流程提醒 |
| `log_only` | 仅审计记录 | 不打断流程，用于已确认危险命令、状态变更等可追溯事件 |

> 宿主输出契约：Claude Code 与 Codex 的非工具事件不复用工具级 `hookSpecificOutput.permissionDecision`。Codex `Stop/UserPromptSubmit` 使用顶层 `decision:"block"`，`PreCompact` 使用 `continue:false`；Codex adapter 默认以 `manual|auto` matcher 注册 `PreCompact`，工具调用拦截才使用 `permissionDecision`。

## 常见问题与排错

1. **Hook 没生效 / 规则看起来没加载**
   - 先运行 `devcodex doctor`
   - 再核对当前宿主是否真的支持本地 Hook 硬拦，以及目标项目是否已重新打开会话
2. **Profile 没加载或 workspace-namespace 路径不对**
   - 先运行 `devcodex doctor`
   - 再用 `devcodex help` 查看 `profile init` 和 `migrate-layout` 子命令，核对 `.devcodex/workspace/profile/` 与项目命名空间路径
3. **Codex / Copilot 想用 MCP**
   - 先确认宿主本身是否支持本地 MCP
   - DevCodex 当前只会自动写 Claude Code 的 `.mcp.json`；Codex / Copilot 需要手工配置
4. **Copilot 里 `profile_load` 报 `invoke` undefined**
   - 这通常表示宿主 MCP bridge 没有完成工具调用，而不是 DevCodex profile 文件一定损坏
   - 不要反复重试同一个 MCP 调用；先降级为读取 `.devcodex/**/profile/`、`SUMMARY.md` 与当日任务记忆
   - 同时运行 `devcodex doctor` 或宿主自带 MCP 诊断，确认 MCP server 是否真的连接
5. **产物文件无法点击**
   - 先看回复末尾是否有 `ArtifactLinkSet`：Markdown 链接 + 必要 `绝对路径：...`
   - Copilot / JetBrains / 终端里必须同时有绝对路径 fallback；若缺失，要求 AI 补齐
   - Codex Desktop/App 中更推荐绝对路径 Markdown target；如果只给了相对链接，可以要求 AI 补绝对路径
6. **CP 卡住或只看到提醒不拦截**
   - 先确认当前是否处于 `safety-only`
   - 如需更严格的流程门禁，再评估是否启用 `DEVCODEX_HOOK_ENFORCEMENT=strict`
7. **不知道该跑哪个诊断命令**
   - `devcodex doctor` 看宿主 / Hook / Profile / 记忆状态
   - `devcodex help` 看 CLI 子命令与参数说明

## IDE 兼容性

> v1.9.6+ 与上方"客户端支持矩阵"语义对齐：✅=自动加载且经实测；⚠️=加载但能力降级或未实测；❌=不支持。Hooks 列仅代表宿主是否具备可接入 Hook 事件，不代表所有 DevCodex 规则都能硬拦。

| 功能 | VS Code | JetBrains | Visual Studio | Xcode | Eclipse |
|------|:-------:|:---------:|:------------:|:-----:|:-------:|
| `copilot-instructions.md` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `instructions/*.instructions.md` | ✅ | ⚠️ 实测中 | ✅ | ❌ | ❌ |
| `hooks/*.json` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `agents/*.agent.md` | ✅ | ⚠️ legacy | ❌ | ❌ | ❌ |
| `skills/*/SKILL.md` | ✅ | ⚠️ 实测中 | ❌ | ❌ | ❌ |
| `prompts/*.prompt.md` | ✅ | ✅ | ✅ | ❌ | ❌ |

> JetBrains 的 path-specific instructions / agents / skills 已实测确认可用（WebStorm 2026）；Workspace Hooks 当前按 VS Code Hooks Preview 能力建模。


## 文档

完整文档: [devcodex.dev](https://devcodex.dev)

## 边界声明

**DevCodex 适合用于**：
- 团队/个人需要在多项目之间统一 AI 开发工作流
- 希望 Copilot、Claude Code 或 Codex 在 dev / fix / audit 场景下遵守一致的 CP 门控、合规检查与报告产出
- 需要持久化会话记忆、规范自修复机制（PC4）的协作流程

**DevCodex 不适合用于**：
- 单次、一次性、无需规范约束的快速原型场景
- 当前不在正式支持矩阵中的客户端/宿主（见 §客户端支持矩阵）
- 对 `.github/` / `.claude/` / `.agents/` / `.codex/` / `AGENTS.md` 有其他强约束、无法接受 DevCodex 写入的项目

**前置条件**：
- Node.js ≥ 18（CLI 零依赖，仅使用标准库）
- 若维护或构建 `website/` 文档站，需要 Node.js `^20.19.0 || >=22.12.0`（Rspress 2 依赖要求）
- 已启用目标宿主的规则加载能力（Copilot `Use Instruction Files` / Claude Code 标准项目规则加载 / Codex 工作区 `AGENTS.md` 加载）
- Copilot 路径：已安装支持的 GitHub Copilot IDE（VS Code / JetBrains 全量支持；Visual Studio / Xcode / Eclipse 部分支持，详见 §IDE 兼容性）
- Claude Code 路径：允许项目级 hooks 与 MCP（`init --claude` 会写入默认配置）
- Codex 路径：允许工作区根 `AGENTS.md`、`.agents/skills/` 与 `.codex/hooks.json` 作为受管部署副本

## Tier 说明

DevCodex 的 `plugin.json` 声明 `tier: "free"`，所有 Skill 均标注 `tier: "free"`。这些 tier 字段是**面向未来的 prompt-level 声明**（供 `token-check` Skill 在 Agent 侧做软门控），**CLI 不做任何授权校验**：

- CLI 本身不做额外 license/tier 授权校验；但当前安装包通过 GitHub Packages 分发，读取包仍需要有效的 registry/认证配置
- 未来接入服务端 token 校验时，tier 字段才会生效
- 当前阶段 tier 仅作为规划信息，不影响功能使用

## Agent 入口

仓库内保留两个 Agent 文件（`agents/devcodex.agent.md`、`agents/devcodex-auto.agent.md`）供 IDE 直接调用；`v1.9.8` 起 Copilot 端默认安装会同步到 `.github/agents/`，Claude Code 与 Codex 端仍不分发 agents。标准使用路径是：

- **推荐**：通过 `copilot-instructions.md` + `instructions/` 自动注入，直接在 Copilot Chat 对话即可
- **可选**：通过 `.github/agents/` 使用 `@devcodex` / `@devcodex-auto` 自定义 Agent 入口
- **Codex**：通过 `AGENTS.md` 自动注入总则，通过 `.agents/skills/` 按需读取技能；不单独维护 `codex/AGENTS.md`

Auto v1.1 当前只在支持 Hook 的宿主里，对显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `config.json` 中 `extensions.devcodex.autoAliases` 配置的替换别名，或明确自然语言 auto 授权（如“进入 auto 模式执行”）下的白名单路径提供 runtime 级硬保证；配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；模糊提及、询问 auto 规则、未生效昵称或普通“继续”不算授权。JetBrains 等 `instruction-fallback` 宿主仅同步规则语义，不承诺完全等价的自动放行。Auto 任务若命中控制面、多批次或预计修改 ≥10 文件，仍须先形成 ExecutionContract 并持续更新实施进度。

`config.json` 还可配置 `extensions.devcodex.concurrency`：

```json
{
  "extensions": {
    "devcodex": {
      "concurrency": {
        "mode": "auto",
        "readOnly": { "enabled": true, "maxParallel": 4, "allowAgents": true },
        "validation": { "enabled": true, "maxParallel": 2 },
        "locks": { "additionalSingleWriterScopes": [] }
      }
    }
  }
}
```

默认 `auto` 采用 `parallel prepare, serial commit`：文件搜索、Profile/记忆读取、只读分析和互不写同一输出的验证可并行；同一 active-root 的 CP 状态、记忆、报告、台账、audit session、source mutation、package boundary 和危险操作必须串行或单写者。保守项目可设 `mode: "serial"`；首期不支持 `parallel` 或 `allowParallelMutations`。

## 许可证

AGPL-3.0-or-later © Rocky / [vextjs](https://github.com/vextjs)
