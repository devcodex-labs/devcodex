---
name: audit-tech-design
description: 技术方案审查维度 TD-1~TD-13 — 架构/技术选型/实施方案专属审查层
---
# Audit Tech Design Skill

## 适用范围

审查目标为**技术方案**（架构设计、技术选型、实施方案文档）时，叠加本 Skill（在 G1~G5 之后）。

## 维度总览（TD-1~TD-13）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 方案质量 | TD-1 架构合理性 · TD-2 边界与异常设计 · TD-3 安全性设计 | 🔴 |
| B — 影响评估 | TD-4 Breaking Changes 完整性 · TD-5 下游兼容性 · TD-6 版本合规性 | 🔴/🟡 |
| C — 可实施性 | TD-7 实施可行性 · TD-8 测试策略完整性 | 🟡 |
| D — 文档质量 | TD-9 文档结构完整性 · TD-10 方案与实施一致性 | 🟡 |
| E — 规范一致性 | TD-11 与项目 profile 一致性 · TD-12 API/接口设计质量 | 🟡 |
| F — 图表 | TD-13 流程图与图表质量 | 🟡 |

## 核心检查维度

**TD-1 架构合理性 🔴**
- `§0` 现状分析存在且描述了当前系统状态和问题定位
- `§1.2` 关键架构决策表存在且每条有选择理由和"为何不选备选"说明
- 核心模块职责单一（≤3 个核心功能）
- 新增生产依赖有选型说明
- 依赖升级 / SDK 替换 / 平台 API 兼容方案已拆分 `业务源码平滑性` 与 `依赖层落地条件`
- provider / connector / SDK 接入方案已冻结 provider metadata、内部 payload、上游 request 映射、标准化 result、错误 detail，且首个 provider 未反向定义公共契约
- 命中代码、文档、示例、fixture、quick start、技术方案或报告会被用户 / 维护者长期消费，或用户指出“不专业 / 像初级 / 示例误导”时，检查 `ExpertOutputQualityGate`：方案必须给出生产推荐路径、框架原生能力、fixture/mock/demo 边界、反模式对照和证据矩阵

**TD-2 边界与异常设计 🔴**
- 模块、接口、配置、状态和数据边界必须写清输入、输出、错误、兼容边界和不负责事项；涉及多模块或公共契约时要有 `Current -> Target` 差异。
- 异常设计覆盖已确认输入边界、历史兼容、安全要求、幂等、降级和错误契约；不得为未确认未来场景扩展过宽防御分支。
- 失败反例：只列文件清单，不说明调用方和错误边界；异常处理只有“try/catch”或“兜底处理”。
- 必要证据：契约矩阵、边界问题清单、异常场景表、negativeProbe 或 `N/A + skipReason`。
- 验证路线：交叉检查 §2.0~§2.5、CP1 事实源和 TestRoute；有公共契约缺边界矩阵则阻断。

**TD-3 安全性设计 🔴**
- 命中认证、授权、敏感数据、签名、输入校验、文件/命令执行、网络调用或多租户边界时，必须写明安全主体、权限条件、失败行为和审计/回滚口径。
- 敏感信息与硬编码只按用户 / 项目显式策略执行；未被要求时，不得把真实 secret 或硬编码本身当作阻断，也不得擅自改成 env / secretRef。
- 失败反例：新增管理接口无权限边界；以“安全最佳实践”为由改写用户明确要求的明文配置。
- 必要证据：安全面列表、策略来源、负向用例、`S02/C03` 处置或 `N/A + skipReason`。
- 验证路线：读取 CP1、Profile、项目策略与方案变更面；触发安全面但无策略/验证则阻断。

**TD-4 Breaking Changes 🔴**
- BC 清单完整（无遗漏的接口/行为变更）
- 每条 BC 有迁移指南或升级路径

**TD-5 下游兼容性 🔴/🟡**
- 涉及公开 API、CLI、Hook、MCP、package、文档站、Profile、模板、示例或部署副本时，必须列出直接消费者、间接消费者、兼容策略和同步路径。
- 失败反例：只写“无影响”但 package `files`、host projection 或 README 需要同步；只验证源码不验证分发面。
- 必要证据：consumer map、source-consumer-sync 计划、package/host/docs 验证命令或 `N/A + skipReason`。
- 验证路线：对照变更文件和 Profile 消费者；公共契约或分发面变更缺同步计划则阻断。

**TD-6 版本合规性 🟡/🔴**
- 方案影响版本、changelog、package metadata、发布状态、Profile 新鲜度或迁移路线时，必须说明是否更新、为什么跳过和验证方式。
- 失败反例：新增 npm script 或分发文件但未更新 package 白名单/changelog/Profile；发布语义变化但版本文档未同步。
- 必要证据：version/changelog/Profile/package metadata 决策表，或 `N/A + skipReason`。
- 验证路线：运行版本/包/发布相关校验；发布或分发面缺证据时阻断，纯内部未发布改动可标 N/A。

**TD-7 实施可行性 🟡**
- 方案必须能映射到 CP3 批次、允许路径、执行顺序、依赖、回滚和验证路线；复杂任务需 ExecutionContract。
- 失败反例：方案只有“修改相关文件并测试”，没有批次、依赖、回滚或偏移触发；控制面任务无单写者和消费者同步。
- 必要证据：ImplementationMap、DevelopmentDriftGate、ExecutionContract、rollback plan 或 `N/A + skipReason`。
- 验证路线：检查 §2.6、§8、CP3 计划可直接派生任务；无法派生 CP3 则阻断进入实施。

**TD-8 测试策略 🟡**
- 覆盖率目标明确
- 有针对性的负向测试场景
- 包 / 库 / adapter / CLI 方案同时覆盖代码实现层与包工程层验证（public API / public types / shared tests / benchmark / docs / scripts / package metadata）
- 包 / adapter / SDK / CLI / 插件方案在推荐确认前已执行 `PackageAdapterPreConfirmEvidenceGate`：核对 package.json、plugin.json、exports/bin/files、dist/pack 边界、registry 或安装入口、adapter 消费者和官方/上游公开契约；缺证据时不能宣称包消费者可用
- 方案含 PR / TD / CP2 审查锚点时必须执行 `ReviewAnchorMaterializationGate`：把审查锚点物化成可 grep 的章节、表格或清单，不能只在叙述中语义覆盖
- 方案含需求维度、优先级、批次或阶段计划时必须执行 `RequirementDimensionBindingGate` / `RequirementPriorityAndPhaseGate`：每个维度绑定 CP2、批次计划、验收和阶段关闭规则

**TD-9 文档结构完整性 🟡**
- 技术方案必须包含目录导航、现状、方案概述、核心设计、测试策略、实施约束、风险与缓解；条件章节未触发时写 `N/A + skipReason`。
- 失败反例：章节存在但内容是占位符；内部 Gate 名录复制到正文却没有 owner、证据和验证路线。
- 必要证据：章节结构、条件章节判定、ArtifactDecisionMatrix。
- 验证路线：结构扫描 + 人工抽查关键章节；缺关键章节或占位符未清理则不通过。

**TD-10 方案与实施一致性 🟡**
- 方案中的文件、模块、契约、测试命令和 CP3 批次必须互相一致；执行中偏移触发 DevelopmentDriftGate。
- 失败反例：CP3 改了方案未列文件；测试计划和 package scripts 名称不一致；报告宣称完成但方案风险未关闭。
- 必要证据：CP2→CP3 implementation map、progress/evidence ledger、deviation log 或 `N/A + skipReason`。
- 验证路线：对照 CP2、CP3、进度、diff、测试记录；重大偏移回 CP2。

**TD-11 与项目 Profile 一致性 🟡**
- 技术栈、目录边界、脚本、测试/发布路线、分发面、配置、长期连接和 Profile overlay 变化必须执行 `ProfileImpactCheck`。
- 失败反例：新增脚本/能力/host projection 但 Profile 仍写旧数量或旧路线；需求假设与 Profile 冲突却未处置。
- 必要证据：ProfileImpactCheck 表、目标 Profile 文件、更新或 `skipReason`。
- 验证路线：读取 active Profile 与方案事实对照；触发 C21 但无记录则阻断。

**TD-12 API/接口设计质量 🟡**
- 简单 service 只承担业务编排、外部能力调用和必要上游错误映射，不重复 route validate、model/schema、数据导入或框架已承担的校验、归一化和配置兜底
- JavaScript / Node.js 方案中命中必要注释的导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明使用标准 JSDoc
- API / SDK / 平台能力方案必须执行 `OfficialApiEvidenceGate`，以官方 API 文档、公开契约或源码证据为准；框架、SDK 或插件已有能力需执行 `FrameworkCapabilityAutoFirstGate`，优先复用成熟能力而不是手写平行能力
- 示例、fixture、mock、demo 或 quick start 方案必须明确它们只是验证 / 教学边界，不得把硬编码单例、每个 route 重复声明或仅证明底层能力存在的夹具作为生产推荐路径

**TD-13 流程图与图表质量 🟡**
- 涉及多模块消息传递、异步回调、状态机、条件分支或用户/系统流程时，方案应提供文字流程和 Mermaid/表格图之一；确无流程图需求时写 `N/A + skipReason`。
- 图表必须与正文模块、状态和契约一致，节点名称能追溯到 §2 的模块/边界。
- 失败反例：图表只做装饰、与文件/模块不一致，或把业务旅程当技术执行路径。
- 必要证据：流程图/时序图/状态图或 N/A 理由。
- 验证路线：图表节点与 §2 模块、契约矩阵、测试映射交叉检查。

**TechnicalDesignCandidateEvidenceGate / TDMatrix（CP2 候选）**
- CP2 候选在确认前必须形成 `CandidateReviewBundleV1`，包含 `phaseKind=CP2`、`TDMatrix`、`BlockerSnapshot`、`ClaimEvidenceMatrix`；缺任一项不得写“可确认 CP2 / 可进入 CP3”。
- `TDMatrix` 必须覆盖 TD-1~TD-13，每行包含 `dimension / priority / status / evidence / blockerId / skipReason / negativeProbe`；N/A 只允许在本 Skill 的 N/A 规则内出现。
- `BlockerSnapshot` 至少包含 `stage / blockerId / evidence / affectedSurface / remediation / skippedChecks / stopReason / openBlockers`。发现阻断后仍需完成同阶段安全独立检查，形成完整快照后再修订。
- `ClaimEvidenceMatrix` 将每个方案主张映射到 repo path、当前行为、目标变更、运行时 owner、验证命令或 `UNVERIFIED`；仅有设计段落不得宣称 closed/可实施。
- 负向：只有 TD-1/TD-8/TD-12 少数维度；缺 BlockerSnapshot；缺 ClaimEvidenceMatrix 却请求确认；发现首个 blocker 后隐藏后续独立检查 → 阻断 CP2。

## N/A 规则

- 无 BC 时：TD-4/TD-6 标 N/A
- 非 API 项目：TD-12 标 N/A
- 无流程图：TD-13 标 N/A
- 无代码/文档/示例/fixture/quick start/技术方案/报告产物，且用户未指出“不专业 / 像初级 / 示例误导”时，`ExpertOutputQualityGate` 标 N/A
