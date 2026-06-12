# v1.0.1 需求变更日志

> 记录 `v1.0.1` 需求文档范围变化。代码与规范文件的实现变更仍以仓库根目录 `CHANGELOG.md` 为准。

---

| 日期 | 变更内容 | 影响范围 | 原因 |
|------|---------|---------|------|
| 2026-06-12 | 新增最新 data 吸纳守门补强 | `WorkspaceDataAbsorptionScopeGate`、`FlowchartNodeExplanationGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`MethodLevelLeakPressureProbe`、`V2FormalSolutionPackage`、V63 探针 | 将全工作区 data 扫描、遗漏专审、文档站视觉验收、方法级泄漏压测和 v2 正式方案包从待吸纳项升级为可执行门禁 |
| 2026-06-12 | 新增“最新 data 吸纳守门补强”P1 需求入口 | `requirements/p1/latest-data-absorption-guards/` | 为最新仍需吸纳清单建立活动版本详情页，并同步站点导航 |
| 2026-06-11 | 新增剩余 data 吸纳守门扩展 | `ProductRequirementTraceabilityGate`、`LocalExecutionConfigProbe`、`ManualReviewEvidenceDataRetention`、`AdjacentScopeExpansionGuard`、`PackageNameAuthorityGate`、`PerformanceBenchmarkFirstGate`、`PublicModuleDifferentiationGate`、`V2MCPFirstPlanningGate`、V62 探针 | 将已验证值得吸纳的剩余 `data/*.md` 清单转为可执行条件门禁，并修正 v2 MCP-first 路线、profile-bootstrap 路由和 audit 7 目标类型漂移 |
| 2026-06-11 | 新增“剩余 data 吸纳守门扩展”P1 需求入口 | `requirements/p1/data-absorption-guard-extensions/` | 为产品需求可追溯、本机配置、人工证据留存、相邻范围、包名、性能基线、公开模块和 v2 一期路线建立活动版本详情页 |
| 2026-06-11 | 新增前端体验质量门禁与跨项目已吸纳守门 | `FrontendExperienceQualityGate`、`CrossProjectLearnedGuards`、test-router、dev/audit/report 模板、README/website、V61 探针 | 前端需求需要同步覆盖 UI 还原度、风格主题和 UX 交互；data 目录中已验证可泛化的规范需进入可执行门禁 |
| 2026-06-11 | 新增“前端体验质量门禁”P1 需求入口 | `requirements/p1/frontend-experience-quality/` | 为 UI/UX 体验门禁、人工复核证据、验证范围预算和跨项目吸纳清单建立活动版本详情页 |
| 2026-06-11 | 新增测试路线 `LeakRiskStabilityPressureTest` | `test-router`、`dev-testing`、`dev-scenario-test`、测试/报告模板、README/website、V60 探针 | 写测试用例或回归验证时按项目资源生命周期风险判定是否纳入泄漏风险稳定性压测，避免漏测运行时增长问题或把所有测试机械升级为压测 |
| 2026-06-11 | 新增“泄漏风险稳定性压测”P1 需求入口 | `requirements/p1/leak-risk-stability-pressure/` | 为 `LeakRiskStabilityPressureTest` 建立活动版本详情页，补齐 requirements index 与站点 sidebar |
| 2026-06-10 | 新增“全局默认 Auto 别名”P1 需求入口 | `requirements/p1/global-auto-alias/` | 将 `@rocky` 从项目配置示例升级为全局默认 Auto 精确别名，`autoAliases` 改为替换默认别名 |
| 2026-06-10 | 新增项目工程审查 `PE-12 资源生命周期与泄漏风险` | `audit-project`、`12-audit`、审查报告模板、README/website、V59 探针 | 代码审查需明确覆盖内存泄露、资源泄漏、监听器/定时器/连接/流未释放、缓存无界增长和组件卸载清理缺失 |
| 2026-06-10 | 新增“可配置并发执行策略”P1 需求与设计入口 | `requirements/p1/concurrency-policy/` | 将 C07 从绝对串行口径升级为 `ConcurrencyPolicy`：只读/验证可并行，写入状态域保持单写者 |
| 2026-05-10 | 建立并收口“模板边界与开发流程收口”P1 需求详情 | `requirements/p1/template-flow-alignment/` | 明确正式需求入口、执行模板职责、CP1/CP2/CP3 关注点与 `03/04/05` 产物边界 |
| 2026-05-09 | 建立 `v1.0.1` 版本目录、版本概述页、需求总览页和站点导航入口 | `versions/v1/1.0.1/` | 将 `1.0.0` 与后续活动版本职责拆开，为新增需求、Bug 修复和发布准备提供正式落点 |
| 2026-05-09 | 更新 `versions/` 与 `v1/` 系列页的当前版本指向 | `versions/index.md`、`versions/v1/index.md` | 避免站点仍把 `1.0.0` 误展示为当前活动版本 |
