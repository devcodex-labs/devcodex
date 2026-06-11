---
name: dev-testing
description: 测试规范 — 单元测试/集成测试/API测试/E2E测试四类覆盖标准与触发条件
---
# Dev Testing Skill

## 触发条件（按需读取，不预读）

以下任一场景触发本 Skill：
- `dev.default`：新增模块/功能时（判断是否需要补测试）
- `fix.default`：修复 Bug 后，验证回归测试覆盖
- `dev.refactor`：重构前置检查（确认已有测试覆盖，无则禁止继续）
- `test-router` 判定本轮需要静态/单元/集成/API/E2E 任一测试路线时
- 用户明确要求"写测试"/"补测试"/"测试覆盖"

## 与 test-router 的关系

- `test-router` 负责在 CP2/CP3 与执行前判定“本轮需要哪些验证路线”，并输出 TestRoute。
- 本 Skill 负责定义各类测试的覆盖标准、阻断规则和失败处理，不替代 `api-verification` / `dev-scenario-test` 的专项产物。
- 当 TestRoute 包含对外 HTTP API 归档验证时，必须继续读取 `api-verification`；当 TestRoute 包含场景/负载测试时，必须继续读取 `dev-scenario-test`。
- 写测试用例时必须同步执行 `LeakRiskStabilityPressureTest` 条件判定：命中资源生命周期或稳定性风险时，继续读取 `dev-scenario-test` 并把泄漏风险稳定性压测纳入 TestRoute；未命中时记录 `N/A + skipReason`，不得把所有低风险单元测试机械升级为压测。
- 前端页面、组件、控制台、官网、文档站、可视化工具或游戏测试必须同步执行 `FrontendExperienceQualityGate` 条件判定；命中时测试路线覆盖 UI 视觉和 UX 交互证据，未命中时记录 `N/A + skipReason`。
- 测试路线必须同步执行 `VerificationScopeBudgetGate` 与 `LiveVerificationExecutionObligation`：验证强度匹配风险和变更面，声明“已验证/可运行/可点击/已安装/已发布”前必须真实执行对应命令、页面、接口、pack/install、registry/tag 查询或项目等价验证。
- 人工复核、视觉检查、手工冒烟、外部页面观察或无法自动化验证必须执行 `ManualReviewEvidenceRetention`，记录复核人/时间/范围/输入/观察结果/截图或日志位置。
- 测试来源于产品需求整理、真实联调、本机/跨环境配置、包名/发布名、性能第一或公开模块承诺时，必须同步判定 `ProductRequirementTraceabilityGate`、`LocalExecutionConfigProbe`、`ManualReviewEvidenceDataRetention`、`PackageNameAuthorityGate`、`PerformanceBenchmarkFirstGate` 与 `PublicModuleDifferentiationGate`；未命中时记录 `N/A + skipReason`。

## ServiceLifecycleCleanup

- 若测试或 E2E 验证需要 AI 启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，启动时必须记录 command、cwd、PID/job、端口/URL 和启动时间。
- 测试完成、失败、重试放弃或最终回复前，必须停止仅由 AI 本轮启动的服务，并核验端口或 PID/job 已释放。
- 不得为释放端口杀掉用户既有进程；若端口被非本轮 AI 进程占用，只能报告 PID/端口/命令线线索并请用户确认。
- 用户明确要求保留服务供试用时，报告保留原因、PID/端口/URL 和关闭命令；默认不得静默遗留后台进程。

## 泄漏风险稳定性压测（条件）

`LeakRiskStabilityPressureTest` 是写测试用例或规划回归验证时的条件判定，不是所有测试任务的默认强制压测。

| 判定项 | 触发条件 | 验证要求 |
|--------|----------|----------|
| 长运行服务 | dev server、worker、daemon、queue consumer、scheduler、WebSocket/SSE 等 | 在持续或并发场景下记录 heap/RSS 或项目等价内存指标，冷却后不得持续增长 |
| 资源生命周期 | 数据库/HTTP 连接、文件句柄、流、socket、连接池、事务、临时文件 | 记录连接/句柄/流数量前后对比，确认关闭或回收 |
| 监听与定时器 | EventEmitter、DOM listener、interval/timeout、订阅、watcher | 验证重复创建/销毁后监听器、定时器、订阅数量可回落 |
| 缓存与队列 | cache/map/set、LRU、队列 backlog、批处理缓冲 | 验证容量上限、淘汰策略或积压回落，不出现无界增长 |
| 前端生命周期 | React/Vue/Svelte 组件 mount/unmount、路由切换、长列表/可视化 | 验证卸载清理、订阅释放和重复切换后资源回落 |

**执行规则**：
1. 命中上述任一项，TestRoute 的 `leakRiskPressure` 标为 `required`，并选择项目既有压测/场景工具；没有专用工具时可用轻量脚本采样内存、句柄、监听器或连接数。
2. 最小证据包含：基线指标、压力/重复生命周期场景、持续时间或迭代次数、冷却窗口、前后对比、清理证据和失败阈值。
3. 纯计算函数、静态文档、一次性脚本、无状态转换且无长生命周期资源的变更可标 `N/A + skipReason`。
4. 若验证需要 AI 启动服务或压测 target，必须同时执行 `ServiceLifecycleCleanup`。

## 前端 UI / 交互体验验证（条件）

`FrontendExperienceQualityGate` 是前端体验相关任务的条件判定，不是所有测试任务的默认视觉审查。

| 判定项 | 触发条件 | 验证要求 |
|--------|----------|----------|
| UI 视觉 | 页面、组件、主题、设计稿还原、响应式或状态变化 | 覆盖 `FrontendDesignSourceGate`、`UIFidelityGate`、`StyleThemeConsistencyGate`、`ResponsiveStateCoverageGate`、`VisualVerificationGate` |
| UX 交互 | 用户流、导航、表单、异步操作、错误恢复、动效或输入方式变化 | 覆盖 `InteractionFlowGate`、`InteractionFeedbackGate`、`InputModalityAccessibilityGate`、`ErrorPreventionRecoveryGate`、`MotionTransitionUsabilityGate` |

**执行规则**：
1. 命中前端体验风险时，TestRoute 的 `frontendExperience` 标为 `required`。
2. 最小证据包含：设计来源或既有风格依据、关键状态清单、桌面/移动或目标断点、核心用户流、反馈/错误恢复检查，以及 Browser/截图/Playwright/E2E/人工复核之一。
3. 纯后端、纯 CLI、纯文档或无界面变更可标 `N/A + skipReason`。
4. 若验证需要 AI 启动 dev server、文档站或浏览器自动化 target，必须同时执行 `ServiceLifecycleCleanup`。

## 四类测试规范

### 静态/类型检查（Static / Type Check）

| 项 | 规范 |
|----|------|
| 工具 | 项目现有 `lint` / `typecheck` 脚本；无脚本时 TypeScript 项目优先 `tsc --noEmit` |
| 触发要求 | `dev.default` / `fix.default` / `dev.refactor` / `dev.optimization` 涉及 TS/TSX 代码、类型定义、接口契约、导出签名时 |
| 校验目标 | 新增或修改的类型、接口、泛型、导出签名无类型错误 |
| 多配置项目 | 使用项目既有 `tsconfig` 入口执行无产物校验，如 `tsc --noEmit -p <tsconfig>` |
| 禁止事项 | 禁止为通过校验临时创建 `tsconfig`、修改 `noEmit`、写出 `.d.ts`/构建产物，或添加只用于本次验证的参数文件污染仓库 |

> TypeScript 契约迁移或类型修复应按公开契约与消费面验证，不机械复制旧类型缺陷；跨模块业务契约、公开类型与配置类型优先集中到 types 契约层。

**执行规则**：
1. 有 `typecheck` 脚本时，优先执行项目原生命令
2. 无脚本但检测到 TS 工程时，必须至少执行 1 次 `tsc --noEmit`
3. 类型校验失败视为阻断，不得跳过后直接宣告修复/开发完成

### 单元测试（Unit Test）

| 项 | 规范 |
|----|------|
| 工具 | Vitest（推荐）/ Jest |
| 产物路径 | `tests/unit/` 或与源文件同级 `*.test.ts` |
| 覆盖目标 | 核心业务逻辑 ≥ 80%；工具函数 100% |
| 触发要求 | 新增公开函数/类时**必须**同步写单元测试 |
| 禁止事项 | 禁止 mock 被测单元的直接依赖（应用真实逻辑） |

**最小覆盖清单（每个新公开函数必须包含）**：
1. 正常路径（happy path）
2. 边界值（空值、零、最大值）
3. 错误路径（异常/reject 场景）

### 集成测试（Integration Test）

| 项 | 规范 |
|----|------|
| 工具 | Vitest / Jest + supertest |
| 产物路径 | `tests/integration/` |
| 覆盖目标 | 每条关键业务路径至少 1 个集成测试 |
| 触发要求 | 新增跨模块调用链时 |
| 数据策略 | 使用 fixtures 或 in-memory DB，禁止依赖生产数据 |

> 若集成测试必须连接外部数据库、MongoDB、SSH 隧道或数据服务，连接信息默认可按用户提供内容直写或沿用项目既有模式。只有用户或项目明确指定 `config.local.json`、env、`secretRef` 或 secret manager 时，才从对应入口读取；缺失时提醒用户补齐该入口。

### API 测试（API Test）

| 项 | 规范 |
|----|------|
| 工具 | `.http` 脚本 + `.cjs` 自动化脚本（`api-verification` Skill）|
| 产物路径 | 任务目录根 `*-接口验证.http` + `*-接口验证.cjs`；项目自身 API 测试可另存 `tests/api/` |
| 覆盖目标 | 每条对外 HTTP 接口必须有对应的 `.http` 验证脚本 |
| 触发要求 | PR-5① 对外 HTTP API 变更时**强制** → 走 `api-verification` Skill |
| 验证项 | 正常响应码 · 字段结构 · 错误码（400/401/404/500）|

> ⚠️ API 测试产物（`.http`/`.cjs`）是 `api-verification` Skill 的专属输出，本 Skill 不重复定义；本 Skill 仅规定覆盖目标与触发条件。

### E2E 测试（End-to-End Test）

| 项 | 规范 |
|----|------|
| 工具 | Playwright（推荐）/ Cypress |
| 产物路径 | `tests/e2e/` |
| 覆盖目标 | 核心用户流程（登录/核心业务主流程）必须有 E2E 覆盖 |
| 触发要求 | 用户可见交互或关键业务流程新增/变更时 |
| 数据策略 | 专属测试账号/测试环境，禁止使用生产数据 |

## 测试失败处理规范

| 场景 | 处理方式 |
|------|---------|
| 静态/类型检查失败 | 🔴 阻断交付/收尾，必须修复后才能宣告任务完成 |
| 单元/集成测试失败 | 🔴 阻断交付/收尾，必须修复后才能宣告任务完成 |
| API 测试失败 | 🔴 阻断，回 CP2 修订接口方案 |
| E2E 测试失败 | 🟡 标注，评估是测试脚本问题还是功能问题，分别处理 |
| 超过 2 次迭代仍失败 | 停止，输出错误摘要 ⚠️，等待用户决策 |

## 重构前置测试检查（dev.refactor 强制）

```
[检查已有测试覆盖] → 有测试 → 继续重构
                   → 无测试 → ⛔ 禁止继续，优先补单元测试再重构
```

**基线快照（重构前记录）**：
- 接口签名（函数名/参数/返回类型）
- 导出列表
- 现有测试通过率（作为重构后回归基准）

**重构后验证**：
- 所有原有测试必须全部通过（行为不变原则）
- 新增代码覆盖补充到 ≥ 基线水平

## 覆盖率报告

- 测试完成后输出覆盖率报告到任务目录报告区：`<任务目录>/reports/<agent>/YYYYMMDD/NN--测试覆盖率报告.md`
- 无任务上下文时才回退到项目级：`reports/requirements/<agent>/YYYYMMDD/NN--测试覆盖率报告.md`
- 内容包含各类型实际覆盖率 vs 目标对比，并引用本次测试命令与结果
