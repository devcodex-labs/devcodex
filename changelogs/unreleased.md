# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/releases/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-06-11

- 吸纳剩余 `data/*.md` 泛化清单，新增 `ProductRequirementTraceabilityGate`、`LocalExecutionConfigProbe`、`ManualReviewEvidenceDataRetention`、`AdjacentScopeExpansionGuard`、`PackageNameAuthorityGate`、`PerformanceBenchmarkFirstGate`、`PublicModuleDifferentiationGate` 与 `V2MCPFirstPlanningGate`，并同步 `instructions`、Skills、CP/报告模板、TestRoute、README、website 与活动版本需求页。
- 修正 DevCodex v2 文档默认路线为 Intent-Gated Hosted Spec MCP / Codex-only MVP，明确 MongoDB、控制台、多租户自定义工作流和本地规则正文缓存不是一期默认范围。
- 补齐 `profile-bootstrap` 按需触发路由，修正 `18-spec-radar` stale anchor 与 audit `6`/`7` 目标类型漂移，并新增 V62 验证探针覆盖上述同步链路。

## 记录提示

- 控制面 / 长流程 / 多批次变更写入本文件时，优先标明 `execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync` 等支撑型能力是否同步更新。
- 宿主输出、Hook 或项目现实扩展相关条目，建议显式写出 `verified-present / verified-missing / unverified`、sticky `activeProject` 与用户可见 `意图扩展摘要` 是否发生变化。
- 执行闭环、确认机制或发布门禁相关条目，建议补充 `Intent Expansion Card`、`ConfirmationRequest`、`ECR` 与验证证据，方便正式发版时直接归档到版本 changelog。
