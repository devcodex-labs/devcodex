# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 记录提示

- 控制面 / 长流程 / 多批次变更写入本文件时，优先标明 `execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync` 等支撑型能力是否同步更新。
- 宿主输出、Hook 或项目现实扩展相关条目，建议显式写出 `verified-present / verified-missing / unverified`、sticky `activeProject` 与用户可见 `意图扩展摘要` 是否发生变化。
- 执行闭环、确认机制或发布门禁相关条目，建议补充 `Intent Expansion Card`、`ConfirmationRequest`、`ECR` 与验证证据，方便正式发版时直接归档到版本 changelog。

## 2026-05-31

- 收口发布门禁与 package completeness：`package.json` 新增 `prepublishOnly -> npm run test:all:with-audit`，新增 `scripts/test-release-metadata.js`，`release-verification` / `test-router` / release guide / README / `V42` 同步，关闭 `PF-010`，并将 `PF-012` 收口为“阻断级 gate 已完成、完整 release pre-review 留待后续”。
- 收口 active-root `data` bootstrap 首轮：`ensureRuntimeDirs` 自动补齐运行时 `data/*.md` 模板，`scripts/test-cli-behavior.js` 新增 default init 与 `init --codex + workspace-namespace` 回放，`data/README.md` 同步 active-root 与部署副本边界，推动 `PF-011` 进入部分完成。
