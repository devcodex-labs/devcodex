# 剩余 data 吸纳守门扩展

> **优先级**：P1
> **状态**：已实现
> **日期**：2026-06-11
> **范围**：`CrossProjectLearnedGuards`、需求/方案/实施/报告模板、TestRoute、审查 Skill、README/website、V62 探针

## 目录导航

- [背景](#背景)
- [目标](#目标)
- [守门项](#守门项)
- [验收标准](#验收标准)

## 背景

此前复核 `data/*.md` 剩余 open/partial 项时，发现部分用户纠偏和跨项目经验已经多次证明可泛化，但尚未全部落入可执行门禁。若只保留在台账或报告中，后续 CP、TestRoute、审查和 validate 无法稳定触发。

## 目标

将已验证值得吸纳的剩余清单转化为条件触发的工程守门，而不是无条件增加流程重量。每个守门项都必须能在 CP1/CP2/TestRoute/报告或审查中写出证据；未触发时写 `N/A + skipReason`。

## 守门项

| 守门项 | 触发场景 | 核心证据 |
|--------|----------|----------|
| `ProductRequirementTraceabilityGate` | 从 PRD、Word、原型、截图、会议纪要或用户补充消息整理需求 | 来源锚点、提取口径、冲突/遗漏处理、验收映射 |
| `LocalExecutionConfigProbe` | 本机脚本、联调、数据库/SSH/HTTP 连接或跨环境执行依赖配置 | 项目配置入口、Profile `config.local.json` 或既有脚本约定、S02 策略 |
| `ManualReviewEvidenceDataRetention` | 人工复核涉及真实数据、页面、外部系统、发布包或联调结果 | 证据保存位置、样本范围、可复核输入、保留或不可保留原因 |
| `AdjacentScopeExpansionGuard` | 用户指定模块、目录、adapter、provider 或文档页 | 指定范围、相邻扩展理由、影响面、回退边界 |
| `PackageNameAuthorityGate` | npm/GitHub Packages、插件、bin、exports、scope、安装说明或发布名 | `package.json`、`plugin.json`、registry/包管理器证据 |
| `PerformanceBenchmarkFirstGate` | 用户要求最快、第一、优于、性能提升、压测或 benchmark | 基线、环境、指标、负载、比较对象、成功阈值 |
| `PublicModuleDifferentiationGate` | 公开模块、SDK、CLI、插件、文档站能力或对外 API | public API、内部实现、示例、发布包文件、消费者入口 |
| `V2MCPFirstPlanningGate` | DevCodex v2 一期规划 | Intent-Gated Hosted Spec MCP、Codex-only MVP、私有可追踪 docs、无本地规则正文缓存、非一期范围 |

## 验收标准

- `instructions.md` 与 `instructions/10-dev.instructions.md` 均定义新守门项。
- CP1/CP2/CP3/报告模板能承接新守门项证据。
- `test-router` 与相关审查 Skill 能按项目现实判定触发或写 `N/A + skipReason`。
- README、开发指南、活动版本需求索引和 sidebar 同步。
- `V62` 探针覆盖新守门项、v2 MCP-first 路线、profile-bootstrap 路由和 audit 7 目标类型漂移。
