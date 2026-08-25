---
name: dev-scenario-test
description: 场景测试子类型规范 — 端到端/集成测试 + artillery 负载测试
---
# Dev Scenario Test Skill

## 触发条件

用户要求编写/完善端到端测试、集成测试、场景测试、负载测试，或 TestRoute 判定需要 `LeakRiskStabilityPressureTest` 泄漏风险稳定性压测 / `MethodLevelLeakPressureProbe` 方法级泄漏压测。

若由 `test-router` 触发，本 Skill 只承接 TestRoute 中的场景/负载/E2E 路线；当 TestRoute 追加 `LeakRiskStabilityPressureTest` 或 `MethodLevelLeakPressureProbe` 时，本 Skill 同时承接泄漏稳定性路线。测试路线之外的接口双产物仍交由 `api-verification`，静态/单元/集成覆盖标准仍以 `dev-testing` 为准。

## 前置条件

| 项 | 要求 |
|----|------|
| api-verification（条件） | 仅场景存在对外 HTTP/API 边界时，要求 `.http + .cjs` 已验证；纯 UI、CLI、worker、消息消费或方法级生命周期场景写 `N/A + boundary evidence` |
| TestRoute 已确认（条件） | 由 `test-router` 触发时，先确认场景/负载/E2E 路线与范围 |
| 测试环境就绪 | 数据库/依赖服务可在测试环境访问 |
| ServiceLifecycleCleanup | 若 AI 启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server 或压测 target，必须记录 PID/job/端口并在验证完成后主动关闭 |

## 工具规范

**负载测试候选工具**：`artillery`。优先复用项目既有场景/负载脚本或已安装的本地依赖；缺失时可选择不修改项目/用户环境的轻量替代探针，或在用户确认后使用隔离临时工具。`npm i -g artillery` 及其他全局安装必须独立说明目标、影响、恢复方式并取得当前明确授权，TestRoute、Auto、Profile 或“工具缺失”本身均不授权全局环境 mutation。

```yaml
# artillery.yml 基础模板
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - flow:
      - get:
          url: "/api/target"
```

## 测试类型覆盖

| 类型 | 工具 | 产物路径 |
|------|------|---------|
| 项目端到端测试 | Playwright / Cypress | 项目测试目录，如 `tests/e2e/` |
| 项目集成测试 | Vitest / Jest | 项目测试目录，如 `tests/integration/` |
| 项目负载测试 | artillery | 项目测试目录，如 `tests/load/` |
| 泄漏风险稳定性压测 | artillery / k6 / autocannon / 项目既有压测工具 / 轻量采样脚本 | 项目测试目录，如 `tests/load/`、`tests/scenario/` 或关联任务目录 |
| 方法级泄漏压测 | Vitest/Jest 循环测试 / 项目压测工具 / 轻量采样脚本 | 项目测试目录，如 `tests/unit/`、`tests/scenario/`、`tests/load/` 或关联任务目录 |
| DevCodex 场景测试归档 | artillery / `.http` / `.cjs` | `.devcodex/scenario-tests/<场景>/` 或关联任务目录 |
| 归档级 API 场景验证 | `.http` + `.cjs` 双产物 | 任务目录根 `*-接口验证.http` + `*-接口验证.cjs` |

## 执行规则

- CP1：确认测试场景清单（覆盖关键业务路径）
- CP2：确认测试工具/框架 + 数据准备策略
- CP3：确认执行顺序 + 环境准备/回收方式 + 风险点
- 测试数据：使用 fixtures，禁止依赖生产数据
- 若 TestRoute 的 `leakRiskPressure` 为 `required`，必须执行泄漏风险稳定性压测：记录 heap/RSS、active handles、监听器、连接数、缓存规模或项目等价指标的基线、压力过程、冷却后回落、清理证据和失败阈值；若项目无法采集某项指标，写 `N/A + skipReason` 并选择可观测替代指标
- 若 TestRoute 的 `methodLevelLeakPressure` 为 `required`，必须围绕公开方法、生命周期入口或资源创建/释放路径设计重复调用/重复挂载卸载/重复 open-close 场景，记录基线、结束、冷却后的资源指标和清理断言；不能观测的指标写 `N/A + skipReason`
- 泄漏稳定性压测不要求所有项目安装新工具；优先复用项目已有压测/监控/测试脚本，必要时用最小轻量采样脚本补足证据
- 场景/负载/E2E 执行后必须完成 `ServiceLifecycleCleanup`：停止仅由 AI 本轮启动的服务，核验端口释放；用户要求保留时记录 PID/端口/关闭方式；不得杀用户既有进程
- 测试完成后输出场景测试报告到 `.devcodex/scenario-tests/<场景>/reports/<agent>/YYYYMMDD/`；项目自身覆盖率报告仍按项目测试框架约定输出
