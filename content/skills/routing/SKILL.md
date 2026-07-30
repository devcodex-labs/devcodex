---
name: routing
description: 定义意图识别结果到工作流的路由映射。本 Skill 为人类可读参考，实际路由由 `01-common.instructions.md` + `intent/SKILL.md` + 各工作流 instructions 共同定义。
---
# Routing Skill

## 职责

定义意图识别结果到工作流的路由映射。用户通常经 Agent 入口进入，但**实际路由判定**由 `01-common.instructions.md` §意图路由表 + `intent/SKILL.md` 三问法 + `load-profile/SKILL.md` 项目现实扩展共同完成。

> ⚠️ 本 Skill 为**人类可读参考（docs-only / FIX-23）**，可不作为执行时必读正文。工作流 mutation / CP / artifact 的机器可验证合同见同目录 `workflow-capabilities.json`；实际路由以 `01-common` + `intent` + 工作流 instructions 为准。Agent 文件只负责入口包装。

## 路由映射表

| 意图 | 工作流 | 说明 |
|------|--------|------|
| `dev` | 开发工作流 | CP1→CP2 严格按序；CP3 条件触发并按子类型记录 required/N/A（见 `workflow-capabilities.json` 与 `10-dev.instructions.md`） |
| `fix` | 修复工作流 | Bug 修复三步扫描（见 `11-fix.instructions.md`） |
| `analyze` | 分析工作流 | 多轮收敛分析，≥3 轮，连续 2 轮无新发现后收敛（见 `13-analyze.instructions.md`），只读 |
| `audit` | 审计工作流 | 多轮深度审查，≥3 轮（见 `12-audit.instructions.md`） |
| `self-fix` | 自修复工作流 | 机械修复可简化；规范语义/控制面变化转完整 dev 路径（见 `14-self-fix.instructions.md`） |
| `chat` | 问答工作流 | 纯问答，快速路径 |
| `resume` | 上下文恢复 | 恢复记忆后重路由到原始工作流 |
| `other` | 规划工作流 | 只读兜底规划；明确 source mutation 必须重路由到 dev/fix/self-fix（`plan/SKILL.md`） |

## 子类型路由表

> ⚠️ 本表仅供路由参考。执行时按 `01-common` §Skill 按需读取表 读取对应 Skill，禁止全量读取。
> 子类型标识汇总：`dev.default` / `dev.docs` / `dev.refactor` / `dev.database` / `dev.init` / `dev.optimization` / `dev.scenario-test` / `dev.plan-review` / `fix.default` / `fix.security` / `fix.incident` / `analyze.default` / `analyze.research`
> 支撑型 Skill 不作为工作流子类型；Profile 缺失、补建 Profile 或恢复 dev 模式时按需触发 `profile-bootstrap`。PC0~PC7、完成检查、确认、进度、最终结果、阻断或文件交付触发 `user-visible-output-contract`；用户文档/最终手册写作语义优先触发 `user-manual-authoring`；用户侧文档 review、项目文档审查、菜单导航或文档 IA 审查语义优先触发 `audit-user-manual`；正式复审/清单收敛语义优先触发 `review-checklist`；任何 repair task 在 accepted 前触发 active `repair-prevention-assessment#RepairPreventionAssessmentGate`，只有返工率、一次通过率、反复返修、重复逃逸或效果评估才额外进入 gray `rework-prevention-engineering#ReworkPreventionGate`；代码、文档、示例、fixture、技术方案或报告被要求具备技术专家 / 资深架构 / 领域专家质量，或用户指出“不专业 / 像初级 / 示例误导”时优先触发 `expert-output-quality`；产品策略、开发者体验、UX 交互、前端架构、后端领域架构、生产可用性、API 契约、外部集成、平台生态、AI Agent 系统、数据架构、安全威胁建模、质量策略、设计系统、无障碍/国际化、增长分析或商业模型语义分别按需叠加对应专家 Owner Skill；增长和商业为 P3 条件触发，未命中时写 `N/A + skipReason`；规范吸纳、最新可吸纳、data 吸纳清单或仍需吸纳语义优先触发 `spec-absorption`；自我进化/自动吸纳/自动优化规范或模型辅助治理语义优先触发 `evolution-governance`。

| 工作流 | 子类型 | Skill 文件 |
|--------|--------|-----------|
| dev | default | `skills/dev-default/SKILL.md` |
| dev | refactor | `skills/dev-refactor/SKILL.md` |
| dev | database | `skills/dev-database/SKILL.md` |
| dev | init | `skills/dev-init/SKILL.md` |
| dev | optimization | `skills/dev-optimization/SKILL.md` |
| dev | scenario-test | `skills/dev-scenario-test/SKILL.md` |
| dev | docs | `skills/dev-docs/SKILL.md` |
| dev | plan-review | `skills/audit-common/SKILL.md`（豁免 `dev-plan-review`，防递归） |
| fix | default | `skills/fix-default/SKILL.md` |
| fix | incident | （Instruction 已完整覆盖） |
| fix | security | `skills/fix-security/SKILL.md` |
| analyze | default | `skills/analyze-default/SKILL.md` |
| analyze | research | `skills/analyze-research/SKILL.md` |
| audit | 规范文件 | `skills/audit-dimensions/SKILL.md` |
| audit | 技术方案 | `skills/audit-tech-design/SKILL.md` |
| audit | 需求文档 | `skills/audit-requirements/SKILL.md` |
| audit | 项目工程 | `skills/audit-project/SKILL.md` |
| audit | 报告 | `skills/audit-report/SKILL.md` |
| audit | 通用文档 | `skills/audit-document/SKILL.md`（用户侧文档 / 文档站 / 项目文档 review 先叠加 `skills/audit-user-manual/SKILL.md`；README / 主入口文档再叠加 `skills/audit-readme/SKILL.md`） |
| audit | 发布前审查 | `skills/audit-release/SKILL.md`（release readiness / publish 或 tag 前风险审查，不替代 `release-verification`） |

## 支撑型能力触发参考

| 语义 | Skill | 说明 |
|------|-------|------|
| 开源/公开用户站点、最终用户使用文档、README、quick start、接入手册、docs-first、用户向 reference | `skills/user-manual-authoring/SKILL.md` | 用户站写作入口（`docsAudience=public-user`）；README 继续叠加 `readme-authoring`；先跑 DocsAudienceIntent |
| 维护者/贡献者开发站点、contributing、本地开发、发版 runbook、internals/ADR 站 | `skills/maintainer-docs-site-authoring/SKILL.md` | 维护者站写作入口（`docsAudience=maintainer-dev`）；与用户站不等价 |
| 模糊「写文档站/website」 | DocsAudienceIntent → ambiguous 阻断 | 唯一推荐消歧；禁止未锁定开写 |
| 用户侧文档 review、项目文档审查、文档设计、菜单导航、sidebar、信息架构 | `skills/audit-user-manual/SKILL.md` | 用户文档审查聚合入口；按顺序叠加 `user-manual-authoring`、`audit-document`、条件 `audit-readme`、`review-checklist` |
| 维护者站文档 review | `skills/audit-document/SKILL.md` | DA-M 维护者站维 + 通用 DA-1~DA-6 |
| 正式复审、ECR、发布前复审、多轮收敛、冻结清单、外部 finding 批次 | `skills/review-checklist/SKILL.md` | 复审清单创建、冻结、逐项证据、状态新鲜度与收敛关闭 |
| PC0~PC7、FC/SC/RC/T、确认、进度、最终结果、阻断、产物文件交付 | `skills/user-visible-output-contract/SKILL.md` | internal manifest→visible set→Envelope→capability renderer；默认隐藏 session/SUMMARY/raw ledger |
| 专家型代码/文档/示例/fixture/方案/报告质量、不专业纠正、生产推荐路径与反模式边界 | `skills/expert-output-quality/SKILL.md` | 执行 `ExpertOutputQualityGate`，区分生产推荐路径、框架原生能力、fixture/mock/demo 边界、反模式和证据矩阵 |
| 产品策略、用户价值、范围取舍、优先级、成功指标、多阶段关闭 | `skills/product-strategy/SKILL.md` | 执行 `ExpertOwnerSkillGate` / `ProductStrategyOwnerGate`，绑定 targetUser、problemValue、priorityTradeoff、scopeBoundary、successSignals、riskDecision、evidenceMatrix |
| 开发者体验、CLI/SDK/API/Hook/插件接入、quick start、示例、错误信息、迁移 | `skills/developer-experience-architecture/SKILL.md` | 执行 `DeveloperExperienceArchitectureGate`，验证 firstSuccessPath、integrationSteps、exampleTruth、errorExperience、migrationPath、docsEntryPoints |
| UX 交互、任务流、信息架构、状态反馈、空错恢复、用户心智和操作成本 | `skills/ux-interaction-architecture/SKILL.md` | 执行 `UxInteractionArchitectureGate`，检查 taskFlow、informationArchitecture、stateFeedback、emptyErrorRecovery、interactionCost、accessibilityTouchpoints |
| 前端架构、组件、状态、异步缓存、SSR/Nuxt、runtime config、i18n、SSE、空白页防护 | `skills/frontend-architecture/SKILL.md` | 执行 `FrontendArchitectureOwnerGate`、`FrontendAsyncCacheRenderGate`、`StaleWhileRevalidateGate` 和 `BlankPagePreventionGate` |
| 后端领域架构、API、权限、领域模型、事务、一致性、幂等、兼容演进 | `skills/backend-domain-architecture/SKILL.md` | 执行 `BackendDomainArchitectureGate`，绑定 domainLanguage、boundedContext、workflowInvariants、permissionModel、transactionConsistency、idempotencyCompatibility |
| 生产可用性 / SRE、可观测性、容量、泄漏风险、故障恢复、回滚、运行手册 | `skills/production-readiness-sre/SKILL.md` | 执行 `ProductionReadinessSreGate`，记录 observabilityPlan、capacityAssumption、failureModes、rollbackPlan、runbookEntry、releaseRisk、operationalEvidence |
| API 契约、public API、版本兼容、错误模型、分页过滤、幂等、SDK / 消费者影响 | `skills/api-contract-architecture/SKILL.md` | 执行 `ApiContractArchitectureGate`，绑定 consumerSurface、contractInventory、versionCompatibility、errorModel、idempotencyPagination、sdkDocsImpact、evidenceMatrix |
| 外部集成、第三方 API、Webhook、OAuth、回调、配额、重试、降级、供应商锁定 | `skills/external-integration-architecture/SKILL.md` | 执行 `ExternalIntegrationArchitectureGate`，绑定 providerBoundary、authCallbackModel、quotaRetryPolicy、webhookIdempotency、failureDegradation、lockInExitPlan |
| 平台生态、CLI、Hook、多宿主、插件、扩展点、能力发现、兼容矩阵、迁移 | `skills/platform-ecosystem-architecture/SKILL.md` | 执行 `PlatformEcosystemArchitectureGate`，绑定 hostSurfaceMatrix、extensionPointContract、capabilityDiscovery、compatibilityMatrix、migrationPath、releaseDistributionImpact |
| 最终 workflow intent 后选择 direct / plan_first / auto_authorized、解释精确宿主 variant 能力上限或核验跨轮 instruction authority | `skills/host-capability-routing/SKILL.md` | 消费 intent 结果并输出 portable `CapabilityIntentDecisionV1`；不改 workflow route、CP、Auto 或安全不变量；Phase 1 不调用 native/MCP/CLI/Hook |
| AI Agent 系统、路由、工具调用、上下文、记忆、权限、可观测性、人机协作 | `skills/ai-agent-system-architecture/SKILL.md` | 执行 `AiAgentSystemArchitectureGate`，绑定 intentRouting、toolPermissionBoundary、contextMemoryModel、stateMachineHandoff、observabilityReplay、humanInLoopBoundary |
| 数据架构、数据模型、迁移、索引、查询、生命周期、数据质量、分析消费者 | `skills/data-architecture/SKILL.md` | 执行 `DataArchitectureGate`，绑定 dataModel、schemaMigration、queryIndexPlan、lifecycleRetention、dataQuality、analyticsConsumer |
| 安全威胁建模、权限、认证、信任边界、密钥策略、审计、攻击面 | `skills/security-threat-modeling/SKILL.md` | 执行 `SecurityThreatModelingGate`，绑定 trustBoundary、threatScenario、permissionAbuseCase、secretPolicy、auditLogging、mitigationVerification |
| 质量策略、测试组合、验收矩阵、覆盖率、风险分层、回归范围、发布信心 | `skills/quality-strategy/SKILL.md` | 执行 `QualityStrategyGate`，绑定 riskModel、testPyramid、acceptanceMatrix、regressionScope、coverageGate、releaseConfidence |
| 设计系统、主题、Token、组件变体、Figma/代码同步、UI 一致性、无障碍/国际化 | `skills/design-system-architecture/SKILL.md` | 执行 `DesignSystemArchitectureGate`，绑定 designTokens、componentVariantModel、themeConsistency、accessibilityI18nBoundary、figmaCodeSync、adoptionGovernance |
| 无障碍、键盘、焦点、屏幕阅读器、ARIA、国际化、本地化、RTL、多语言文档 | `skills/accessibility-i18n/SKILL.md` | 执行 `AccessibilityI18nGate`，绑定 userNeedsMatrix、keyboardFocusModel、screenReaderSemantics、localeContentModel、rtlFormatting、runtimeVerification、fallbackRecovery |
| 增长分析、埋点、漏斗、转化、留存、实验、产品数据决策 | `skills/growth-analytics/SKILL.md` | P3 条件触发；执行 `GrowthAnalyticsGate`，绑定 growthQuestion、metricTaxonomy、eventInstrumentation、funnelRetentionModel、experimentDesign、privacyConsentBoundary、decisionLoop |
| 商业模型、商业化、定价、套餐、成本收益、付费路径、运营风险、长期可持续性 | `skills/business-model-review/SKILL.md` | P3 条件触发；执行 `BusinessModelReviewGate`，绑定 valueExchange、revenueCostModel、pricingPackaging、marketSegmentChannel、operationalRisk、sustainabilityTco、decisionBoundary |
| 全工作区/项目产物扫描、能力盘点、缺少哪些 Skill、大目录分批、扫描恢复 | `skills/skill-gap-analysis/SKILL.md` | 先执行 `ProjectArtifactScaleRoutingGate` 和 ScaleDecisionRecord，再做 corpus/gap/convergence |
| Skill 生命周期、组合冲突、依赖、误触发/漏触发、灰度、废弃与退役 | `skills/skill-lifecycle-governance/SKILL.md` | 执行 SkillPortfolioLifecycleGate，active 变化仍需 evolution-governance 授权 |
| 返工率、一次通过率、重复逃逸、whyMissed 复发、预防有效性 | `skills/rework-prevention-engineering/SKILL.md` | 执行 ReworkPreventionGate，区分需求变化并用后续可比较任务验证 prevention |
| 任何 repair task 的完成/accepted | `skills/repair-prevention-assessment/SKILL.md` | 执行 active RepairPreventionAssessmentGate；当前关闭与前瞻效果分列 |
| 分布式系统、消息队列、RPC、交付/顺序、幂等、重试、补偿、分区、背压 | `skills/distributed-systems-architecture/SKILL.md` | 执行 DistributedSystemsArchitectureGate，绑定 consistency/delivery/ordering/failure matrix |
| 性能工程、性能预算、benchmark、profiling、p95/p99、容量和性能回归 | `skills/performance-engineering/SKILL.md` | 执行 PerformanceEngineeringGate，先基线再归因与回归决策 |
| PII/个人信息、同意、保留删除、驻留、主体权利和隐私审计 | `skills/privacy-compliance-architecture/SKILL.md` | 执行 PrivacyComplianceArchitectureGate，绑定数据生命周期和权利流程 |
| 模型/Prompt 评测、黄金集、LLM Judge、校准、方差、成本延迟质量和模型回归 | `skills/ai-evaluation-engineering/SKILL.md` | 执行 AiEvaluationEngineeringGate，绑定 dataset/rubric/calibration/variance/regression |
| 规范吸纳、最新可吸纳、仍需吸纳、检查 `.devcodex/*/data` 吸纳清单、开始吸纳 | `skills/spec-absorption/SKILL.md` | 规范吸纳执行入口；证明通用规范价值、剔除项目独有规则、输出最终清单、分层落点、消费者证明、验证探针和台账回写 |
| 自我进化、自动吸纳、模型辅助规范优化、自动补 Skill / Prompt / Probe、自动治理候选 | `skills/evolution-governance/SKILL.md` | 自我进化控制面入口；执行 `EvolutionCapabilityControlPlaneGate`，冻结授权、模型配置、权限、配额、数据边界、审计、回滚和发布审批 |

## 特殊路由规则

### 违规质疑路由（优先于主路由表）

以下语义均路由到 `audit` → 规范文件审查（**不得路由到 `chat`**）：
- 用户指出 AI 违反了某条规范
- 用户质问为什么某步骤没有执行
- 用户要求检查当前会话是否合规
- 用户确认规范存在后要求补做

> 路由到 audit 后，**首先**重新执行合规检查（`compliance` Skill），再输出审查结论。

### resume 路径

```text
RESTORE → 先读今日 tasks/YYYYMMDD.md → 再读 Agent SUMMARY.md → 读取相关记忆（resume 时最近 14 天）→ 还原上下文 → 提取原始意图 → 重路由到原始工作流
```

### resume 约束

- chat 不产生中断 → resume 不接受 chat 类型原始意图
- resume 不改变原始意图类型
- resume 超过 14 天时：从 SUMMARY.md 查找最后 🔄 状态行，再提示用户提供具体日期或会话编号后精准恢复

### chat 快速路径

三问法全部指向分析 + 无文件变更 → 执行入口检查 PC0~PC7 → 跳过 CP 和报告 → 直接回复 → 仅写记忆 → 关闭

### 项目现实扩展后的路由修正

```text
语义初判 → 目标项目/Profile 加载 → 项目现实扩展 → 最终工作流/子类型
```

- 若用户说“审查某个项目”，语义初判可为 audit；项目现实扩展需结合项目类型决定审查维度和最小文件族。
- 若用户说“修一下规范”，语义初判可为 fix；若目标是 DevCodex 控制面规范缺陷，应修正为规范自修复或默认开发流程中的控制面治理任务。
- 若扩展结果显示目标项目不明确，必须先澄清，不得直接路由。

### 多意图处理

≥2 意图 → 按序逐一路由，每个独立走完整工作流周期 → 独立报告 → 再路由下一个

`ConcurrencyPolicy` 允许多意图前置只读识别或隔离分析并行，但不允许并行推进多个会写 CP 状态、报告、记忆、台账或 source mutation 的工作流。

### 工作流内部强制步骤

dev: `plan-review`（CP2 后、CP3 前强制）为工作流内部步骤，不参与子类型路由。
