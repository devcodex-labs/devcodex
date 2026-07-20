# 需求总览

> **定位**：本目录是 DevCodex `v1.0.1` 的活动需求入口，承接 `1.0.0` 之后的新增需求、Bug 修复和发布准备。  
> **约束**：`1.0.0` 继续只做历史基线，不再回写。

## 当前已建立内容

| 模块 | 状态 | 说明 |
|------|------|------|
| 版本入口与导航 | ✅ 已建立 | `versions/`、`v1/` 和 sidebar 已接入 `1.0.1` |
| 具体需求条目 | ✅ 持续补充 | 当前目录内已有 2 项 P0（上下文按需加载、项目侧执行链优化）与 7 组 P1 详情页；其他已实现能力按仓库根 `CHANGELOG.md` 与 `changelogs/releases/` 追溯 |

## 当前需求索引

| 优先级 | 主题 | 状态 | 说明 |
|--------|------|------|------|
| P0 | [意图驱动的上下文按需加载](./p0/intent-driven-context-loading) | 🟢 已实现并随 v1.15.2 发布 | 已发布基线采用 V1；v1.15.2 升级为 `IntentSeedV1 → ContextReadPlanV2 → targeted load → ContextReadReceiptV2`，并保持 V1 读取兼容与 hidden-read 探针 |
| P0 | [项目侧执行链性能、任务名续接与增量分析](./p0/project-execution-chain-performance) | 🟢 B0～B6 已实现并随 v1.15.2 发布 | 用户新会话只发 `继续<任务名>任务`；任务名续接、ContextRead V2、validation DAG、Profile/Skill 渐进加载、ProjectKnowledge、feature-level 回滚与 V101 已闭合，最终验证证据由任务报告/ECR 持有 |
| P1 | [模板边界与开发流程收口](./p1/template-flow-alignment/index) | ✅ 已收口 | 正式需求入口、执行模板职责、CP1/CP2/CP3 关注点与 `03/04/05` 产物边界已同步 |
| P1 | [可配置并发执行策略](./p1/concurrency-policy/index) | ✅ 已实现 | `extensions.devcodex.concurrency`、`ConcurrencyPolicy`、只读/验证并发与不可变单写者锁 |
| P1 | [全局默认 Auto 别名](./p1/global-auto-alias/index) | ✅ 已实现 | `@rocky` 全局默认；`extensions.devcodex.autoAliases` 替换默认别名，空数组关闭默认 |
| P1 | [泄漏风险稳定性压测](./p1/leak-risk-stability-pressure/index) | ✅ 已实现 | `LeakRiskStabilityPressureTest`、`leakRiskPressure`、按资源生命周期风险条件触发场景/负载/稳定性压测 |
| P1 | [前端体验质量门禁](./p1/frontend-experience-quality/index) | ✅ 已实现 | `FrontendExperienceQualityGate`、UI/UX 体验门禁、跨项目已吸纳守门、Browser/截图/E2E/人工复核证据 |
| P1 | [剩余 data 吸纳守门扩展](./p1/data-absorption-guard-extensions/index) | ✅ 已实现 | `ProductRequirementTraceabilityGate`、`PackageNameAuthorityGate`、`PerformanceBenchmarkFirstGate`、`PublicModuleDifferentiationGate`、`V2MCPFirstPlanningGate` 与 V62 探针 |
| P1 | [最新 data 吸纳守门补强](./p1/latest-data-absorption-guards/index) | ✅ 已实现 | `WorkspaceDataAbsorptionScopeGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`MethodLevelLeakPressureProbe`、`V2FormalSolutionPackage` 与 V63 探针 |

## 版本内开发规则

1. 新增需求优先创建在 `v1/1.0.1/requirements/` 下。
2. Bug 修复或发布准备，也应先在当前活动版本目录内留痕，而不是回写 `1.0.0`。
3. 发版前先同步版本文档，再同步 `package.json`、`plugin.json` 和对应 CHANGELOG。

## 参考

- [v1.0.1 版本概述](/versions/v1/1.0.1/)
- [v1.0.1 需求变更日志](/versions/v1/1.0.1/CHANGELOG)
- [v1.0.0 基线快照](/versions/v1/1.0.0/)
