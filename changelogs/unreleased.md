# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-05-27

- 修复治理链小修批次：统一 MCP SUMMARY 新建模板、清理已发布 unreleased 残留、同步 Profile scripts 资产清单，并增强 validate 对 release/profile/audit-state 漂移的防回归检查。
