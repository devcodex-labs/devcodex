---
name: dev-scenario-test
description: 场景测试子类型规范 — 端到端/集成测试 + artillery 负载测试
---
# Dev Scenario Test Skill

## 触发条件

用户要求编写/完善端到端测试、集成测试、场景测试、负载测试。

## 前置条件

| 项 | 要求 |
|----|------|
| api-verification 已通过 | 场景测试基于已验证的接口规范（`.http` 产物存在） |
| 测试环境就绪 | 数据库/依赖服务可在测试环境访问 |

## 工具规范

**负载测试默认工具**：`artillery`（全局安装：`npm i -g artillery`）

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
| DevCodex 场景测试归档 | artillery / `.http` / `.cjs` | `.devcodex/scenario-tests/<场景>/` 或关联任务目录 |
| 归档级 API 场景验证 | `.http` + `.cjs` 双产物 | 任务目录根 `*-接口验证.http` + `*-接口验证.cjs` |

## 执行规则

- CP1：确认测试场景清单（覆盖关键业务路径）
- CP2：确认测试工具/框架 + 数据准备策略
- CP3：确认执行顺序 + 环境准备/回收方式 + 风险点
- 测试数据：使用 fixtures，禁止依赖生产数据
- 测试完成后输出场景测试报告到 `.devcodex/scenario-tests/<场景>/reports/<agent>/YYYYMMDD/`；项目自身覆盖率报告仍按项目测试框架约定输出
