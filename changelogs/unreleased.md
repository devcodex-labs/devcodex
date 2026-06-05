# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/releases/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-06-05

- 修复产物生命周期口径：新增 `ArtifactDecisionMatrix / ArtifactLifecycleState`，统一 `01-需求概述.md`、`02-技术方案.md`、`04-实施计划.md`、`05-实施进度.md`、目标文档、报告和记忆的 `create / update / skip / N/A` 判定，优先级为“已有真相源回写 > 任务触发条件 > SimpleTaskFastPath > 子类型豁免”。
- 修正模板漂移：`technical-design.prompt.md` 仅在 `02-技术方案.md` 被判定需要创建/更新时使用；`implementation-plan.prompt.md` 不再要求 `04-实施计划.md` 始终创建；`implementation-progress.prompt.md` 支持 docs/init 等 CP3 豁免场景使用等价任务切片或 `ContextHandoffCard` 作为进度锚点。
- 补充验证守门：`V41` 与 `test-spec-governance` 增加 `ArtifactDecisionMatrix` 正向探针和旧口径负向探针，防止“始终创建实施计划 / 技术方案禁止跳过”类表述回流。

## 记录提示

- 控制面 / 长流程 / 多批次变更写入本文件时，优先标明 `execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync` 等支撑型能力是否同步更新。
- 宿主输出、Hook 或项目现实扩展相关条目，建议显式写出 `verified-present / verified-missing / unverified`、sticky `activeProject` 与用户可见 `意图扩展摘要` 是否发生变化。
- 执行闭环、确认机制或发布门禁相关条目，建议补充 `Intent Expansion Card`、`ConfirmationRequest`、`ECR` 与验证证据，方便正式发版时直接归档到版本 changelog。
