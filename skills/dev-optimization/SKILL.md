---
name: dev-optimization
description: 性能优化子类型规范 — 基准测试前置 + autocannon 压测集成
---
# Dev Optimization Skill

## 触发条件

用户要求性能优化、吞吐量提升、响应时间降低、内存/CPU 优化。

## 前置条件（必须满足）

| 项 | 要求 |
|----|------|
| api-verification 已通过 | 优化前接口测试基线已建立（`.http` + `.cjs` 产物存在） |
| 基准数据 | 优化前已有性能指标（QPS/P99/内存）作为对比基线 |
| 测试环境 | 压测在隔离环境执行，不影响生产 |

## 工具规范

**默认工具**：`autocannon`（全局安装：`npm i -g autocannon`）

```bash
# 基线测量
autocannon -c 100 -d 30 -j http://localhost:3000/api/target > baseline.json

# 优化后对比
autocannon -c 100 -d 30 -j http://localhost:3000/api/target > optimized.json
npx autocannon-compare baseline.json optimized.json
```

## CP 流程

- **CP1**：确认优化目标（指标 + 目标值）+ 当前基线数据
- **CP2**：确认优化方案（无 Breaking Changes，或 BC 已评估） → `dev-plan-review`（PR-1 已自检，PR-2~PR-7 详细验证）→ CP3
- **CP3**：确认实施步骤 + 回滚策略

## 产出物

- 基准测试报告（优化前后对比）
- `reports/optimizations/` 开发报告（含性能指标对比表）

## 关键规则

- 🔴 禁止无基线数据的"盲优化"
- 优化不改变外部接口行为（否则走 dev-default 流程）
