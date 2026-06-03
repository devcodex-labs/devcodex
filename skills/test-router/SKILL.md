---
name: test-router
description: 测试路由规范 — 根据变更类型、影响范围与风险选择静态、单元、集成、API、E2E、场景/负载、pack 或发布验证，并记录跳过理由
---
# Test Router Skill

## 职责

`test-router` 只负责选择验证路线和记录跳过理由，不替代 `dev-testing`、`api-verification`、`dev-scenario-test` 或项目自身测试规范。

## 输入

| 字段 | 说明 |
|------|------|
| `changeType` | docs / spec / runtime / api / hook / cli / release / package / website |
| `impact` | 单文件 / 多文件 / 跨模块 / 控制面 / 用户可见 |
| `risk` | 低 / 中 / 高 |
| `hostSurface` | Copilot / Claude Code / Codex / instruction-fallback / N/A |
| `workspaceGuard` | 单项目 / 多项目 / sticky project / workspace profile / N/A |
| `artifacts` | 需求、方案、计划、报告、`.http`、`.cjs`、截图、benchmark 等 |
| `serviceLifecycle` | 是否需要由 AI 启动长运行服务；若是，记录 command/cwd/PID/job/port/url 与 cleanupEvidence |

## 路由矩阵

| 变更类型 | 必选验证 | 条件验证 |
|----------|----------|----------|
| 文档/规范 | `node scripts/validate.js`、引用扫描 | website build、SCV |
| Skill / instructions / prompts | `node scripts/validate.js`、`npm test`、引用扫描 | `npm run test:all`、部署副本同步 |
| 依赖 / 框架 / SDK / 平台 API | `OfficialDocsEvidence`、安装/版本可用性检查、最小用法验证 | 兼容性回归、迁移 smoke、ProfileImpactCheck |
| Hook / MCP / CLI / ArtifactLinkSet | `npm test`、相关 targeted test、`npm run test:all` | `host-contract-verification`、direct replay、fixture replay、dry-run；产物点击需覆盖 `ArtifactLinkSet` 主链接 + copy fallback，MCP bridge 失败需覆盖 `mcpFallback` |
| 对外 HTTP API | `api-verification` 生成 `.http + .cjs` | 项目集成/E2E |
| 前端体验 | lint/typecheck/test | Browser/截图验证 |
| 本地服务验证 | ServiceLifecycleCleanup：记录启动命令、cwd、PID/job、端口/URL，并在验证完成、失败或最终回复前关闭仅由 AI 启动的服务 | 用户明确要求保留服务时，记录保留原因、PID/端口/URL 与关闭方式 |
| 发布 / package | `audit-release`、`release-verification`、`npm run test:audit`、package completeness gate、远端 CI 绿色（如存在）、pack dry-run | pack install smoke、publish dry-run |

## 输出格式

```markdown
## TestRoute

| 项 | 内容 |
|----|------|
| changeType | |
| requiredChecks | |
| conditionalChecks | |
| hostVerificationMode | |
| workspaceGuard | |
| evidenceSource | |
| regressionChecks | |
| serviceLifecycle | N/A / startedByAI / userProvided；cleanupEvidence 或 keepAliveReason |
| skippedChecks | |
| skipReason | |
| blockingLevel | |
```

## 跳过规则

- 跳过任何常规验证都必须写 `skipReason`、风险和替代验证。
- API 行为变化不得跳过 `api-verification`。
- 高风险控制面变更不得只运行单个局部检查；至少执行 validate + targeted tests + SCV。
- 新增/升级依赖、框架、SDK、平台 API 或外部模块时，不得只验证“能安装”；必须引用 `OfficialDocsEvidence` 并至少验证一次项目内采用的关键用法。
- 项目事实变化时必须执行 `ProfileImpactCheck`；若跳过 Profile 更新，报告需要写 `skipReason`。
- 高风险控制面 / 多批次修复必须写出 `regressionChecks`：逐项列出历史能力、必跑验证、对应批次和失败回滚点。
- 宿主契约、visible reply、sticky project 或 workspace guard 变更，不得只写“`npm test` 已过”；必须写明 direct replay / fixture replay / validate probe 的证据来源。
- 任何验证路线若由 AI 启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，完成前必须执行 `ServiceLifecycleCleanup`：只停止本轮 AI 启动的进程，核验 PID/job 或端口释放，并在 TestRoute/报告记录证据；不得杀用户既有进程。
- `npm run test:all` 失败时不得宣告完成，除非回 CP2 明确降级并有替代证据。
- 有远端 CI 的项目进入 tag / release / publish 前，不得只写本地测试通过；必须记录目标 commit 对应远端 CI run 的状态，无法查询时写 `N/A + skipReason` 或阻断正式动作。

## 报告要求

dev/fix/optimization/scenario-test 报告应包含 TestRoute 或明确 `N/A`，ECR-3/ECR-4 应引用实际执行结果。若命中宿主验证，还应同时引用 `host-contract-verification` 的 HostContractRoute 结果。
