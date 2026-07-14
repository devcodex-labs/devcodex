---
name: test-router
description: 测试路由规范 — 根据变更类型、影响范围与风险选择静态、单元、集成、API、E2E、场景/负载、pack 或发布验证，并记录跳过理由
---
# Test Router Skill

TestRoute 的稳定输入、route selector、固定输出与 skip 合同以同目录 `test-route-schema.json` 为唯一结构化事实源；领域专用证据保留在对应 Owner Skill，不再全部提升为 TestRoute 顶层字段。

## 职责

`test-router` 只负责选择验证路线和记录跳过理由，不替代 `dev-testing`、`api-verification`、`dev-scenario-test` 或项目自身测试规范。

## 输入

机器可读输入、selector、输出与跳过字段以同目录 `test-route-schema.json` 为唯一事实源。稳定输入只有：

`workflow / changeTypes / risk / publicSurface / runtimeBoundary / profileConstraints / candidateState / requestedClaims`

领域专属证据不得复制进 TestRoute 输入清单；先从 `../spec-governance/gate-registry.json` 解析适用 `gateGroup`，再由目标 Owner Skill 提供证据字段和阈值。

## 路由选择

| selector | 触发边界 | 最小证据 |
|----------|----------|----------|
| `static` | 源码或契约变化 | command、exitCode |
| `unit-integration` | 行为或跨模块变化 | suite、result、coverageDecision |
| `api` | HTTP 或 public API 边界 | endpointMatrix、双 API 产物、result |
| `runtime-e2e` | 用户路径或运行时状态变化 | target、stateMatrix、result |
| `package-release` | package candidate 或 release 声明 | candidateDiff、pack、install、registry |
| `profile-deploy` | Profile、宿主或分发面变化 | profileValidation、deploymentParity |

先按变化事实选择所有适用 selector，再按风险升级验证层级。不得仅因“已有单测”跳过跨边界、真实 runtime、package candidate、Profile 或部署副本验证；不适用的 selector 必须形成结构化跳过记录。

## TestRoute 输出

输出固定为 `selectedRoutes / commands / evidence / skipped / residualRisk / coverageClaim`。推荐使用以下最小结构：

```yaml
workflow: fix
changeTypes: [control-plane, documentation]
risk: high
selectedRoutes:
  - selector: static
    commands: [npm run test:control-plane]
    evidence: [{ command: npm run test:control-plane, exitCode: 0 }]
  - selector: profile-deploy
    commands: [node scripts/validate-all-profiles.js]
    evidence: [{ profileValidation: passed, deploymentParity: passed }]
skipped:
  - route: runtime-e2e
    reason: no runtime user path changed
    authority: source diff and execution contract
    residualRisk: none identified
    upgradeCondition: runtime boundary enters scope
coverageClaim: executed-selected-routes
```

## 跳过规则

每条跳过记录必须包含 `route / reason / authority / residualRisk / upgradeCondition`。缺少任一字段、用“暂不需要”作理由、或目标声明需要该路线却没有可替代证据时，TestRoute 不得标记完整。

高风险、公共契约、控制面、发布候选和跨宿主分发变更至少要求两类独立证据；若无法执行，结果必须降级为 partial/blocked，并把升级条件带入报告与 `ContextHandoffCard`。

## 报告要求

dev/fix/optimization/scenario-test 报告应包含 TestRoute 或明确 `N/A`，ECR-3/ECR-4 应引用实际执行结果。若命中宿主验证，还应同时引用 `host-contract-verification` 的 HostContractRoute 结果。
