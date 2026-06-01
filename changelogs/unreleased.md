# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/releases/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 记录提示

- 控制面 / 长流程 / 多批次变更写入本文件时，优先标明 `execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync` 等支撑型能力是否同步更新。
- 宿主输出、Hook 或项目现实扩展相关条目，建议显式写出 `verified-present / verified-missing / unverified`、sticky `activeProject` 与用户可见 `意图扩展摘要` 是否发生变化。
- 执行闭环、确认机制或发布门禁相关条目，建议补充 `Intent Expansion Card`、`ConfirmationRequest`、`ECR` 与验证证据，方便正式发版时直接归档到版本 changelog。

## 2026-06-01

- 收口 Batch D 安全与发布长尾：补齐 S02 受控私有例外模型、API `.http` 标准变量、`changelogs/releases/` 已发布日志结构与 `Profile Freshness Check` 审查维度，并新增 `V53` / `test-spec-governance` 探针守门。
- 收口 Batch C Codex compaction runtime 兜底：`codex/hooks.json` 新增 `PreCompact`（`manual|auto` matcher）部署模板，CLI/pack/validate/spec probes 补齐 Codex PreCompact adapter 守门，并同步 README 与 website 宿主契约说明。
- 收口 Batch B 客户端兼容首轮：新增 `ArtifactLinkSet` 产物链接矩阵、Copilot/Codex MCP bridge fallback 规则与 `mcpFallback` 证据字段，补充 `test-client-contracts`、`V51` 和 `profile_load` no-args MCP 回放，防止产物裸文件名不可点击或 `invoke undefined` 阻断恢复链。
- 收口 Batch A 发布前审查能力：新增 `audit-release` Skill 与 RL-1~RL-10 维度，接入 audit 路由、报告/计划/进度模板、README、release guide、website、plugin/profile 资产计数与 `V50`/`test-spec-governance` 探针，明确其与 `release-verification` R0~R7 的职责边界。
- 收口 Batch 0 backlog governance：新增“台账状态回写闭环”和“Backlog Intake 真相复核门”，同步 `instructions.md`、`RecordRouter` / `cp-gate` / `execution-contract` / `report`、实施计划/进度/报告模板、README、website、`V49` 与 `test-spec-governance`，并完成 `PF-014 / PF-015` 关闭与 `PI-014 / PI-015` 纳规回写。

## 2026-05-31

- 收口发布门禁与 package completeness：`package.json` 新增 `prepublishOnly -> npm run test:all:with-audit`，新增 `scripts/test-release-metadata.js`，`release-verification` / `test-router` / release guide / README / `V42` 同步，关闭 `PF-010`，并将 `PF-012` 收口为“阻断级 gate 已完成、完整 release pre-review 留待后续”。
- 收口 active-root `data` bootstrap 首轮：`ensureRuntimeDirs` 自动补齐运行时 `data/*.md` 模板，`scripts/test-cli-behavior.js` 新增 default init 与 `init --codex + workspace-namespace` 回放，`data/README.md` 同步 active-root 与部署副本边界，推动 `PF-011` 进入部分完成。
