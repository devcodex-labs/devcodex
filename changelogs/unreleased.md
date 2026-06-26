# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/releases/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 当前未发布变更

_暂无未发布变更。_

## 记录提示

- 控制面 / 长流程 / 多批次变更写入本文件时，优先标明 `execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync` 等支撑型能力是否同步更新。
- 剩余 `data` 吸纳守门类变更需显式标明 `ProductRequirementTraceabilityGate`、`PackageNameAuthorityGate`、`V2MCPFirstPlanningGate` 等关键门禁，避免正式发版前遗漏 V62 覆盖链路。
- 最新 `data` 吸纳守门补强需显式标明 `WorkspaceDataAbsorptionScopeGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`MethodLevelLeakPressureProbe` 与 `V2FormalSolutionPackage`，避免正式发版前遗漏 V63 覆盖链路。
- 最新高保真 UI / 提交授权 / 兼容契约吸纳守门需显式标明 `FigmaHighFidelityRestorationGate`、`ActualPreviewChainAndMockFallbackGate`、`ExplicitCommitAuthorizationGate`、`CompatibilityAndContractAuthorityGate` 与 `PublicDocsReleasedVersionGate`，避免正式发版前遗漏 V65 覆盖链路。
- 最新复审与文档体验吸纳守门需显式标明 `ReviewDimensionDeltaGate`、`UserPerspectiveDocsGate`、`DocsConsumerSweep`、`ArtifactLinkSetDedupeGate` 与 `FrontendRuntimeNetworkProbeGate`，避免正式发版前遗漏 V66 覆盖链路；已归档发布项保留历史关联 `PI-052 / PF-056`。
- 最新公开用户文档与最终汇报吸纳守门需显式标明 `PublicUserDocsMaintainerBoundaryGate` 与 `ActiveRequirementFinalResponseGate`，避免正式发版前遗漏 V67 覆盖链路；已归档发布项保留历史关联 `PI-053 / PI-054 / PF-057 / PF-058`。
- 宿主输出、Hook 或项目现实扩展相关条目，建议显式写出 `verified-present / verified-missing / unverified`、sticky `activeProject` 与用户可见 `意图扩展摘要` 是否发生变化。
- 执行闭环、确认机制或发布门禁相关条目，建议补充 `Intent Expansion Card`、`ConfirmationRequest`、`ECR` 与验证证据，方便正式发版时直接归档到版本 changelog。
