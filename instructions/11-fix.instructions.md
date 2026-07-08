---
applyTo: "**"
description: fix 工作流规则，覆盖子类型路由、CP 流程、修复三步扫描、执行期回退与 ECR
priority: P4
version: 1.11.30
---
# 修复工作流规则（11-fix）

> 子类型标识：`fix.default` / `fix.security` / `fix.incident`

> 本文件定义 fix 工作流的完整规则，含 3 个子类型和修复三步扫描。

## 子类型路由

| 意图 | 子类型 |
|------|--------|
| 线上事故/incident/P0/P1/生产故障 | incident |
| 安全漏洞/security/CVE/注入/XSS | security |
| 默认（常规 Bug/报错/异常）| default |

- 进入 fix 工作流前，确认子类型（default/incident/security）
- 三类均从读取代码风格开始

## C12 合理性评估（必须执行）

- 有更好建议先提出，确认后再执行
- 用户给出判断或引用已有设计 → AI 须独立验证合理性，不得直接顺从论证
- 若用户给出的修复路径经验证已是当前最优，可明确说明依据后直接采纳；禁止为了表现“独立”而机械反对

## 任务切换与提交护栏

- 在 fix 会话中，若用户中途提出的新请求与当前 bug/问题边界明显不一致，应先按 `01-common` 的“意图优先、关键词兜底”顺序判断是否已切入新需求。
- 仅当判断为新需求切换，且工作区仍有未提交变更时，提醒用户确认是否先提交当前修复，再切换到新主题，避免修复范围漂移。
- 用户明确要求提交当前修复时，commit subject 必须保持一句简洁描述，不得把问题背景、验证步骤或多段总结直接塞进标题行。
- `unreleased` / `commit` 主协议遵循 `01-common`：每完成一个**已验证的语义修复批次**默认更新 `changelogs/unreleased.md`；`ExplicitCommitAuthorizationGate` 要求本地 `commit` 只有用户明确要求时才执行，其他情况仅建议作为回滚锚点；`push` / `tag` / `publish` 仍须用户明确确认。

## CP 流程（C02 约束）

```text
CP1（问题确认）→ CP2（方案确认）→ [impact-review] → [CP3] → [execution-contract/test-router] → 执行 → 三步扫描 → ECR 执行闭环复审 → 完成
```

- **CP1**：先确认这是 Bug / 异常 / 已承诺行为与实际不一致，而不是纯新需求或需求变更；报告方输入优先落 `bugs/<问题>/00-问题概况.md`，AI / 研发据此输出 `01-问题确认.md` 或等价问题分析报告（根因 + 影响范围），并前置平台工程判断：消费者范围、共享契约边界、模块职责、维护成本和非目标；模块化只在真实复用者、演进边界或跨模块共享契约存在时成立，用户确认
- **CP2**：AI 输出修复方案，用户确认；若修复涉及依赖/框架/SDK/平台 API 或外部模块变更，必须附 `OfficialDocsEvidence`；涉及项目事实变化时必须附 `ProfileImpactCheck`
- **impact-review**：涉及跨模块架构依赖变更（PR-5②）时执行
- **CP3**：≥5 文件变更 或 含高风险操作时**必须**；其他可选
- **backlog 来源前置真相复核**：若本轮 bug、批次或修复范围直接来源于 `data/*.md` 的 open/partial 项，CP1 前必须先把候选项分类为 `pure-open` / `residual-tail` / `already-fixed` / `misclassified`；非 `pure-open` 项须先回写状态并修正范围口径，再进入修复。
- **执行期 CP3 回退**：若执行过程中实际修改范围扩展到 CP3 门槛（文件数从 <5 增至 ≥5，或新增高风险/控制面联动），必须暂停执行，补做 CP3 后再继续。
- **execution-contract/test-router**：≥5 文件、高风险、控制面或多批次修复时执行，明确允许路径、必需产物和验证路线
- **Intent Expansion 可见性**：dev 模式下，CP1 / 问题确认前默认向用户展示完整 Intent Expansion Card；这会覆盖旧的“意图扩展摘要”默认行为，但当命中控制面或宿主能力差异、跨会话 resume、prod、instruction-fallback 宿主或低风险轻任务时，仍允许退化为 3~5 行意图扩展摘要。
- **OfficialDocsEvidence**：依赖升级、框架/SDK/API 修复、平台行为变更或外部模块替换时，CP2 前必须读取官方使用文档/官方参考资料；缺失证据不得进入执行。
- **ProfileImpactCheck**：修复改变技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema 时，必须同步 Profile 或记录 `skipReason`。
- **连接配置来源按用户 / 项目策略**：凡修复涉及脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息，默认可直写或沿用项目既有模式；只有用户或项目明确指定 `config.local.json`、env、`secretRef` 或 secret manager 时，修复方案才按该入口读取并在缺失时提醒补齐。
- **AI 自启动服务清理**：若回归验证需要由 AI 启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，TestRoute/报告必须记录启动命令、cwd、PID/job、端口/URL；验证完成、失败或最终回复前必须停止仅由 AI 本轮启动的服务并核验端口释放。用户明确要求保留服务时，报告保留原因、PID/端口和关闭方式；不得杀用户既有进程。
- **LeakRiskStabilityPressureTest**：修复内存泄露、资源泄漏、稳定性、性能退化、连接/监听器/定时器/流/socket/worker/订阅/缓存增长等问题，或回归测试触及长运行和高并发路径时，TestRoute 必须纳入泄漏风险稳定性压测；未触发时写 `N/A + skipReason`。
- **CoverageGateDecision / ClusterEscalationGate**：项目存在 coverage 脚本、阈值、CI coverage 或发布覆盖率要求时，必须单独判定 coverage gate；同一风险簇连续出现 ≥3 个 finding、返修或复审遗漏时，先触发 `ClusterEscalationGate` / `RiskBasedValidationLadder`，再补测试或改代码。
- **ExternalRuntimePluginLifecycleGate / FunctionSourceFingerprintMatrixGate**：修复外部 runtime、plugin、registry、adapter、provider、injected runtime、owner mutation 或 function source/hash/toString/fingerprint 参与 key/checkpoint/去重路径时，TestRoute 必须覆盖生命周期矩阵、registry 矩阵和 fingerprint 误判矩阵。
- **BenchmarkRegressionGuard**：修复触及已有 benchmark 基线项目的 hot path（runtime / validator / parser / cache / adapter 等）时，即使本轮不是性能优化，也必须判定是否跑代表性 benchmark regression；超过阈值时阻断发布或进入用户确认的性能 / 正确性取舍。
- **FrontendExperienceQualityGate**：修复前端页面、组件、控制台、官网、文档站、可视化工具或游戏体验问题时，必须判定 `frontend-runtime` gateGroup；TestRoute 按风险选择 Browser/截图/E2E、console/network/resource/runtime、代码级替代证据或 `N/A + skipReason`。Figma/截图/既有页面、资源、本地化、状态回归和浏览器验证预算等子门禁由 `test-router` 与目标 UI/审查 Skill 承接。
- **CrossProjectLearnedGuards / GovernanceGateRegistry**：修复涉及已吸纳泛化经验、审查清单证据化、用户文档（`user-manual`）、前端运行态、发布/pack、Profile/service、public surface、兼容契约或自我进化控制面时，只在 fix 层记录 `gateGroup / ownerSkill / validationRoute / skipReason`，完整 Gate 正文以 `spec-governance` 的 `GovernanceGateRegistry`、目标 Skill、report 和 validate 探针为准。
- **ReviewFindingIntakeGate**：修复范围来自审查报告、AI review finding、audit issue 或代码评审发现时，CP1 前必须逐条分类为 `must-fix` / `user-decision-required` / `docs-implementation-drift` / `test-coverage-gap` / `already-fixed-or-not-reproduced` / `intentional-design-accepted`；命中 `user-decision-required`、兼容风险或文档/实现二选一时，修改源码前必须先取得用户确认。
- **SimpleTaskFastPath**：非常明确、预计 ≤2 文件、无公共 API/Schema/依赖/配置/发布/控制面/台账来源/高风险、无需多轮跟踪的简单修复，可用内联问题概况 / 问题确认 + 报告/记忆替代 bug 目录与完整 CP 产物；报告必须写 `SimpleTaskFastPath: applied`、`00-问题概况.md: N/A + skipReason`、`01-问题确认.md: N/A + skipReason`、验证证据和升级回退判断。执行中任一条件失效时，立即升级回完整 fix CP/产物链。
- **ExistingRequirementArtifactOverride**：当用户是在调整/修改/补充既有 `00-问题概况.md`、`01-问题确认.md`、bug CP 产物或需求文件时，SimpleTaskFastPath 只能跳过新建完整 bug 目录，不能跳过更新已有真相源；必须先增量编辑已有问题/需求产物，回复仅作为摘要。找不到目标产物时先按 Profile、bugs/requirements、sessions、tasks 与用户提及路径定位，仍无法确认才最小澄清。
- **ArtifactDecisionMatrix / ArtifactLifecycleState**：CP1/CP2/[CP3]/ECR 必须按修复规模列出关键产物 `create` / `update` / `skip` / `N/A` 状态，至少覆盖 `00-问题概况.md`、`01-问题确认.md`、修复方案、实施计划、实施进度、报告和记忆；判定优先级为已有真相源回写 > 修复触发条件 > SimpleTaskFastPath > fix CP3 可选/豁免。若后续三步扫描或 ECR 发现范围扩大，必须更新矩阵并回到对应 CP。

### 确认后前置轻量复审

- **适用节点**：CP1 → CP2、CP2 → 执行 / CP3、CP3 → 执行
- **复审对象**：刚被确认的问题分析 / 修复方案 / 实施计划
- **复审目标**：
  1. 当前产物是否自洽
  2. 是否遗漏会在下一阶段形成阻断的影响范围或验证缺口
  3. 是否存在与既有确认内容冲突的表述
- **交叉验证追加条件**：
  - 涉及控制面规则或流程边界
  - 涉及多文件联动 / 多真相源同步
  - 涉及模板、示例与自动校验链联动
- 满足任一追加条件时，**必须追加交叉验证**。
- **交叉验证最小覆盖**：
  1. 当前产物
  2. 上游已确认产物
  3. 相关真相源、联动规则或校验探针
- **处理规则**：
  - 无阻断问题：显式输出“前置复审结果：✅ 无阻断，可进入下一阶段”后再推进
  - 发现阻断问题：停止推进，先修正当前产物并告知用户，再回到对应 CP 重新确认
  - 连续 2 次前置复审仍发现新的阻断问题：提示升级为定向 `audit` 或扩大扫描范围

**高风险操作**：DDL 变更 / 共享配置文件、`package.json`、CI 或生产配置变更 / 文件删除 / 直接影响生产环境。env、`secretRef`、secret manager 或 `config.local.json` 仅在用户 / 项目明确指定时作为连接配置入口。

### CP 响应处理

同 `10-dev.instructions.md` CP 响应处理规则。

## 修复三步必做（执行后立即扫描，SC3 强制）

> ⛔ 这三步不可省略。

1. **同类全局扫描** — 同一模式错误是否存在于其他位置（如：修复函数名拼写 → grep 全项目同名函数）
2. **数据联动扫描** — 上下游数据流是否受影响（如：修复字段名 → grep 引用该字段的模型/路由/视图）
3. **grep 零残留复核** — 确认无残留引用（如：`grep -r "旧名称" --include="*.js"` 确认零结果）

> 若执行途中新增范围触达 CP3 门槛，必须先补做 CP3，再继续修复三步；“修复三步必做”不替代 CP3。

若本轮在真相复核后发现条目仅剩尾项或已修未回写，修复报告、实施进度和最终结论必须显式体现范围收紧结果，并在完成前执行台账状态回写闭环。

## 统一联查矩阵映射（fix）

- fix 默认按 **L2 标准联查** 起步
- `fix` 默认按 **L2 标准联查** 起步；“修复三步必做”即是 fix 的最小联查动作
- 命中以下场景时，必须升级为 **L3 强联查**：
  - 控制面规则或流程边界修复
  - 多真相源 / 多文件联动
  - 模板、示例与自动校验链联动
  - 工作区真相源 / 部署副本 / 分发链修复
- `impact-review`、`document-sync`、`api-verification` 继续作为联查子动作使用，不替代三步扫描本身

## 执行约束

- 编码后必须运行 lint/typecheck/test；error 最多 2 次迭代
- **TypeScript 项目类型校验强制**：当项目存在 `tsconfig.json`、`tsconfig.*.json`、`package.json` 的 `typecheck` 脚本，或明显为 TS/TSX 工程时，修复完成后必须补做 1 次类型校验
- **类型校验命令选择顺序**：
  1. 优先运行项目现有 `typecheck` 脚本
  2. 若无脚本但本地可直接调用 TypeScript 编译器，运行 `tsc --noEmit`
  3. 若为多配置/子项目结构，使用项目既有 `tsconfig` 入口执行无产物校验（如 `tsc --noEmit -p <tsconfig>`）
- **无污染要求**：类型校验不得通过创建临时 `tsconfig`、修改 `noEmit` 配置、写入构建产物或额外参数文件来“绕过”项目现状；验证应以当前仓库真实配置为准
- **TS 契约修复**：类型修复应按公开契约与消费面修正，不机械复制旧类型缺陷；跨模块业务契约、公开类型和配置类型优先集中到 types 契约层，本地私有 interface 可保留但需说明理由
- 2 次仍失败 → 停止，输出错误摘要标 ⚠️
- 涉及 HTTP 接口变更 → 生成双产物（.http + .cjs）
- 涉及源码/配置文件变更 → 检查文档同步（README 为必查；CHANGELOG 按发布状态区分：未明确发版默认更新 `changelogs/unreleased.md`，仅正式 release 更新根 `CHANGELOG.md` / `changelogs/releases/vX.Y.Z.md`；TASK-INDEX/STATUS 按项目存在或启用时同步）
- 涉及依赖/框架/SDK/平台 API 变更 → 验证 `OfficialDocsEvidence` 与修复实现一致；不得只以安装成功替代官方用法验证
- 依赖升级、兼容修复或批量适配类问题先记录问题清单与归因，再统一确认修复范围；用户明确授权即时修复或 auto 执行时可边发现边处理，但仍要回写问题清单和证据
- 消费者验证失败且症状指向依赖、插件、共享库或框架适配时，源码修改前必须先核对 `package.json`、lockfile、`node_modules` 与 `npm ls <关键依赖>`；若运行时依赖目录残留了错误版本，优先恢复依赖树，不在宿主框架里写临时兼容补丁
- 根因位于内部共享库、中间件、SDK 或 adapter 抽象层时，优先评估“修共享库 + 消费项目升级”；若只做单项目补丁，修复方案必须说明共享库不改的理由
- JavaScript / Node.js 修复中命中必要注释的导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明必须使用标准 JSDoc
- 前端 UI / 交互修复须沿用 `FrontendExperienceQualityGate`；不得只修功能断言而不验证视觉状态、交互反馈或关键用户流
- 跨项目已吸纳守门须沿用 `CrossProjectLearnedGuards`；不得用“已验证/已接入/人工看过/benchmark 更快”等结论替代真相源、执行证据或归因边界
- 审查报告、AI review finding 或代码评审修复须沿用 `FindingProbeMatrixGate`；guard/policy/permission 修复须沿用 `GuardPolicyBypassMatrixGate`；验证命令须先过 `VerificationCommandSideEffectGate`
- 长链路返修、风险簇修复或冻结 Review Checklist 后须沿用 `ReviewChecklistCompletenessGate` / `EvidenceExecutionGate`：每个清单项要绑定源码/类型/测试/文档/配置证据、命令输出或反向缺席扫描；不得只写“清单存在”或重复同一维度。
- runtime / adapter / SDK / CLI / module-format 修复须沿用 `BuiltArtifactFeatureSmokeGate` / `TscOutputImportProbe`：在 dist CJS、dist ESM、`.generated` / tsc 输出或项目等价构建产物上真实 import / 触发 feature path，覆盖默认启用、显式关闭和 injected runtime 等关键模式。
- 审查发现 intake 须沿用 `ReviewFindingIntakeGate`；不得把外部报告或 AI review finding 直接当 bug 修复依据，也不得在用户决策项未确认前修改公共契约或运行时代码
- 文档修复须沿用 `UserPerspectiveDocsGate`、`UserDocsImmediateComprehensionGate`、`UserDocsPrimarySurfaceGate` 与 `DocsConsumerSweep`；不得只修一处文字而不验证使用者路径、功能完整性、配置易懂性、即时理解、首页/quick start/nav 主面、字段解释、导航、示例和当前消费者同步；站点文档/README/接入手册不得把开发契约当用户主路径
- 公开用户文档修复须沿用 `PublicUserDocsMaintainerBoundaryGate`；不得把维护者验收、发布 checklist、内部同步清单或台账状态留在用户主路径
- 需求修订或复审修复须沿用 `RequirementVerdictStateSyncGate`；不得正文修完但顶部状态、推荐结论、修复清单、audit-state decision、sessions / SUMMARY 仍保留旧口径
- 产物路径修复须沿用 `ArtifactLinkSetDedupeGate`；不得把同一物理文件的多种链接形式当成多份主产物输出
- 最终回复修复须沿用 `ActiveRequirementFinalResponseGate`；不得把相邻需求或 backlog 的下一步写成当前 active 修复的默认结尾
- 涉及项目事实变化 → 执行 `ProfileImpactCheck` 并通过 `document-sync` 更新 Profile 或记录跳过理由
- 涉及验证、发布、pack、benchmark、codegen 或生成产物 → 完成前必须检查并清理与本轮无关的新增/残留文件；不得把无关 dirty 文件、并行验证残留或旧失败产物留给后续任务

## ECR 执行闭环复审（执行后正式阶段）

> 适用于 `fix` 工作流的关键产物稳定性确认。ECR（Execution Closure Review）是执行后正式完成阶段，把原“轻量复审收敛”具体化为可检查清单；它不是 audit 的 3 轮零发现重流程。

### 触发时机

- 执行完成并完成修复三步扫描后、宣告任务完成前，必须对修复结果与修复报告做 1 轮轻量复审
- 关键产物至少包括：
  - 修复方案
  - `04-实施计划.md`（若存在）
  - `05-实施进度.md`（若触发）
  - 修复报告
  - 最终修复结论

### 复审目标

1. 修复结果与修复方案是否一致
2. 修复报告是否存在“已完成/已验证”但证据不足的伪完成
3. 三步扫描结果与最终结论是否一致
4. 是否出现新的阻断性问题

### ECR 最小清单

| 项 | 检查对象 | 目的 |
|----|----------|------|
| ECR-1 | CP1/CP2/CP3、实施进度、报告、daily tasks、SUMMARY | 避免压缩后状态错配 |
| ECR-2 | 问题 ID / 根因链 → diff/commit 文件 | 避免确认问题漏修 |
| ECR-3 | CP3 步骤 → 测试/部署/验证证据 / AI 自启动服务清理证据 | 避免计划与执行漂移 |
| ECR-4 | 修复报告声明 → 测试/扫描/探针结果 / 服务清理 / `OfficialDocsEvidence` / `ProfileImpactCheck` | 避免过度宣称 |
| ECR-5 | memory daily → SUMMARY | 避免 SUMMARY 早标绿 |
| ECR-6 | git dirty 边界 | 避免混入用户另案变更 |
| ECR-7 | 控制面任务追加 validate / direct replay / host-contract probe；涉及规范源、Skill、Hook、CLI、MCP、模板、部署副本、路径规则或 validate 语义时必须执行 SCV（见 `skills/spec-governance/SKILL.md`） | 避免校验假绿与规范漂移 |

### 阻断性问题定义

以下任一成立，视为阻断性问题：

- 修复方案判断错误，导致当前修复方向不可信
- 实施结果与修复结论不一致
- 报告声称“已完成/已验证”，但与代码、测试或扫描结果不符
- 影响范围遗漏，导致修复结论不可信

### 回退规则

- 修复方案层问题 → 回 `CP2`
- 实施计划层问题（若本轮存在 `CP3`）→ 回 `CP3`
- 实现层或报告层问题 → 回执行阶段修正

### 收敛条件

- 最后一次阻断性修正后，至少再完成 **1 轮轻量复审**
- 该轮无新增阻断性问题，才可宣告完成

### 升级条件

- 若连续 2 轮轻量复审仍持续发现新的阻断性问题，必须提示用户：
  - 升级为定向 `audit`
  - 或扩大扫描范围后再继续

## 影响评估触发条件

- 在 CP2 方案分析阶段，若判断修复方案涉及跨模块架构依赖变更，则在 CP2 确认后执行 impact-review；不涉及时跳过
- 对外接口变更 → api-verification；不进 impact-review

## 代码风格

- fix 工作流进入前必须读取项目 `profile/03-代码风格.md`

## 子类型专属规则

### default（常规 Bug 修复）

**问题诊断三步（CP1 前必做）**：
1. S1 重现 — 根据 `00-问题概况.md` 或等价报告方输入确认问题可稳定重现，记录重现步骤、期望行为、实际行为和环境条件
2. S2 定位 — 代码层面定位根因（文件/函数/行号）
3. S3 影响评估 — 评估受影响范围

**执行阶段**：
1. 实现修复（最小化变更范围）
2. 编写/更新回归测试
3. 修复三步必做
4. api-verification（若涉及接口）
5. document-sync（若涉及文档）

**关键规则**：
- 修复必须附带回归测试，禁止无测试的 hotfix（emergency 除外）
- 修复范围不得超出问题边界（禁止顺手重构）
- CP1 问题确认必须给出 `ImplementationComplexityLevel`（兼容旧字段 `ImplementationComplexityPreference`），默认 `简单够用`：只修确认根因和影响范围；若 AI 判断需要升级到 `中等` / `企业级`，先列备选、开发周期、难度、维护成本和取舍并等待用户确认
- 修复默认采用最小实现，禁止无计划新增抽象、通用配置、预留扩展点或未确认防御分支
- 修复涉及字段/配置/接口文档/验证产物/数据脚本/跨环境写入/启动性能时，必须沿用 dev 的 `ExistingDomainContractAudit`、`ConfigOwnershipMatrix`、`ApiDocVerificationSync`、`DataMutationPlan`、`StartupPhaseTrace` 等通用工程吸纳守门；无关时写 `N/A + skipReason`
- 必要注释必须覆盖非显然根因、兼容约束、安全边界、状态转换或反直觉修复取舍；禁止逐行解释、重复代码含义或保留临时 TODO

### incident（事故响应）

**事故级别**：

| 级别 | 定义 | 响应时效 |
|------|------|---------|
| P0 | 服务完全不可用 / 数据丢失风险 | 立即响应，15 分钟内初步方案 |
| P1 | 核心功能降级 / 影响 >10% 用户 | 1 小时内响应 |
| P2 | 非核心功能异常 | 走 fix-default |

**简化 CP1/CP2（P0/P1 允许）**：
- CP1：一句话描述问题现象 + 临时止血方案，无需书面文档
- CP2：P0 口头确认即可；P1 保持标准 CP2
- 执行流程：止血 → 定位根因 → CP1 → 修复 → 验证 → 事后复盘
- 事后 24h 内输出事故复盘报告

### security（安全修复）

**安全专项扫描（S1~S4，标准三步之外额外执行）**：

| 扫描 | 内容 | 工具 |
|------|------|------|
| S1 漏洞验证 | 确认漏洞可重现 + CVSS 评分 | 手动/PoC |
| S2 依赖扫描 | 全量依赖树安全检查 | `npm audit` / `pnpm audit` |
| S3 代码扫描 | 修复文件及相关模块安全模式检查 | 静态分析 |
| S4 回归扫描 | 修复后重新运行 S1~S3 | 同上 |

**关键规则**：
- CP1 必须包含：漏洞描述 + CVSS 评分 + 影响版本范围
- CP2 必须包含：修复方案 + Breaking Change 评估 + 公告计划
- 安全修复 PR 描述中**禁止包含**漏洞细节
- 依赖升级必须检查 Peer Dependencies 兼容性
