# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-05-28

- 新增 `execution-contract`、`test-router`、`release-verification` 三个支撑型 Skill，并同步注册到 `plugin.json`。
- 补强 dev/fix、报告模板、实施计划、实施进度与交付清单对执行契约、测试路由、发布验证和多批次进度的强制消费。
- 更新 README、website 与 Agent 文档，将 Skill 数量同步为 39，并说明 Auto/控制面/多批次/发布任务的闭环约束。
