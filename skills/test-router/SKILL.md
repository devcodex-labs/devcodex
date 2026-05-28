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
| `artifacts` | 需求、方案、计划、报告、`.http`、`.cjs`、截图、benchmark 等 |

## 路由矩阵

| 变更类型 | 必选验证 | 条件验证 |
|----------|----------|----------|
| 文档/规范 | `node scripts/validate.js`、引用扫描 | website build、SCV |
| Skill / instructions / prompts | `node scripts/validate.js`、`npm test`、引用扫描 | `npm run test:all`、部署副本同步 |
| Hook / MCP / CLI | `npm test`、相关 targeted test、`npm run test:all` | host-contract replay、dry-run |
| 对外 HTTP API | `api-verification` 生成 `.http + .cjs` | 项目集成/E2E |
| 前端体验 | lint/typecheck/test | Browser/截图验证 |
| 发布 / package | `release-verification`、pack dry-run | pack install smoke |

## 输出格式

```markdown
## TestRoute

| 项 | 内容 |
|----|------|
| changeType | |
| requiredChecks | |
| conditionalChecks | |
| skippedChecks | |
| skipReason | |
| blockingLevel | |
```

## 跳过规则

- 跳过任何常规验证都必须写 `skipReason`、风险和替代验证。
- API 行为变化不得跳过 `api-verification`。
- 高风险控制面变更不得只运行单个局部检查；至少执行 validate + targeted tests + SCV。
- `npm run test:all` 失败时不得宣告完成，除非回 CP2 明确降级并有替代证据。

## 报告要求

dev/fix/optimization/scenario-test 报告应包含 TestRoute 或明确 `N/A`，ECR-3/ECR-4 应引用实际执行结果。
