# 泄漏风险稳定性压测

> **状态**：✅ 已实现  
> **优先级**：P1  
> **日期**：2026-06-11

## 背景

项目工程审查已经通过 `PE-12 资源生命周期与泄漏风险` 覆盖内存泄露、资源泄漏、监听器/定时器/连接/流未释放、缓存无界增长和组件卸载清理缺失。但只在代码审查阶段检查，仍可能遗漏运行时增长问题；反过来，如果把所有测试任务都升级为压测，又会让低风险单元测试承担不必要成本。

因此测试路线需要增加条件判定：写测试用例或规划回归验证时，先判断项目是否存在资源生命周期或稳定性风险；命中风险才进入泄漏风险稳定性压测。

## 需求

1. 新增 `LeakRiskStabilityPressureTest` 作为 TestRoute 条件路线。
2. 写测试用例或回归验证时，必须按项目现实判定是否触发。
3. 命中长运行服务、高并发路径、缓存/队列/连接池、监听器/定时器、连接/文件/流/socket/worker、订阅、前端组件生命周期或 `PE-12` 风险时，TestRoute 的 `leakRiskPressure` 标为 `required`。
4. 命中后由 `dev-scenario-test` 或项目既有压测/场景工具承接，不要求所有项目安装新工具。
5. 纯计算函数、静态文档、一次性脚本或无长生命周期资源变更可写 `N/A + skipReason`。

## 证据要求

| 证据 | 要求 |
|------|------|
| 基线 | 记录 heap/RSS、active handles、监听器、连接数、缓存规模或项目等价指标 |
| 压力场景 | 记录并发、持续时间、重复生命周期或队列/缓存增长场景 |
| 冷却窗口 | 压力结束后等待资源回收，记录冷却后指标 |
| 前后对比 | 说明是否持续增长、是否回落、是否触发阈值 |
| 清理证据 | 若 AI 启动服务或压测 target，必须执行 `ServiceLifecycleCleanup` |

## 验收

| # | 验收标准 |
|---|----------|
| AC-01 | `test-router` 输出包含 `leakRiskPressure` 字段 |
| AC-02 | `dev-testing` 明确写测试时必须做条件判定 |
| AC-03 | `dev-scenario-test` 承接泄漏风险稳定性压测证据 |
| AC-04 | CP2/CP3/report 模板有填写位 |
| AC-05 | README、website、changelog 与 active Profile 已同步 |
| AC-06 | V60 探针覆盖 source、consumer、website 需求入口与 changelog |

## 验证

- `node scripts/test-spec-governance.js`
- `node scripts/validate.js`
- `npm test`
- `node .\devcodex\index.js update`
- `git diff --check`
