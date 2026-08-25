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
| ServiceLifecycleCleanup | 若 AI 启动压测 target、dev server、本地 API/mock、数据库代理或 SSH 隧道，必须记录 PID/job/端口并在验证完成后主动关闭 |
| AdapterBenchmarkAttribution | adapter、provider、connector、SDK 或性能 benchmark 必须记录基线、环境、版本、负载、归因边界和不可比较因素 |

## 工具规范

**默认候选工具**：`autocannon`。解析顺序固定为项目既有压测脚本 → 项目已安装的本地依赖 → 经用户确认的隔离临时工具；缺失时先报告替代方案。`npm i -g autocannon` 或任何全局安装会修改用户环境，必须单独说明目标、影响、恢复方式并取得当前明确授权，不能由 optimization 路由、Auto、Profile 或工具缺失隐式授权。

```bash
# 基线测量
npx --no-install autocannon -c 100 -d 30 -j http://localhost:3000/api/target > baseline.json

# 优化后对比
npx --no-install autocannon -c 100 -d 30 -j http://localhost:3000/api/target > optimized.json
npx --no-install autocannon-compare baseline.json optimized.json
```

## CP 流程

- **CP1**：确认优化目标（指标 + 目标值）+ 当前基线数据
- **CP2**：确认优化方案（无 Breaking Changes，或 BC 已评估） → `dev-plan-review`（PR-1 已自检，PR-2~PR-7 详细验证）→ CP3
- **CP3**：确认任务拆分、执行顺序、依赖、验证方式、ServiceLifecycleCleanup 与回滚策略；`05-实施进度.md` 对小任务不是默认产物，但跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面或模板-校验链任务必须启用

## 产出物

- 基准测试报告（优化前后对比）
- `reports/optimizations/` 开发报告（含性能指标对比表）

## 关键规则

- 🔴 禁止无基线数据的"盲优化"
- 优化不改变外部接口行为（否则走 dev-default 流程）
- 启动性能优化或 dev 日志治理必须执行 `StartupPhaseTrace`：先把启动日志按阶段归类，并与 Profile / startup summary 使用同一套阶段命名，再决定减噪、lazy loading 或 background warmup；不得只隐藏扁平日志后宣告优化完成
- adapter、provider、connector、SDK 或框架适配 benchmark 必须执行 `AdapterBenchmarkAttribution`；不得把网络、缓存预热、依赖树、框架版本、测试环境或压测工具差异误归因给业务代码
