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
| 端到端测试 | Playwright / Cypress | `tests/e2e/` |
| 集成测试 | Vitest / Jest | `tests/integration/` |
| 负载测试 | artillery | `tests/load/` |
| API 场景测试 | `.http` 脚本 | `tests/api/` |

## 执行规则

- CP1：确认测试场景清单（覆盖关键业务路径）
- CP2：确认测试工具/框架 + 数据准备策略
- CP3：确认执行顺序 + 环境准备/回收方式 + 风险点
- 测试数据：使用 fixtures，禁止依赖生产数据
- 测试完成后输出覆盖率报告到 `reports/requirements/`
