# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-05-28

- 修复审查收敛后的文档/Profile 口径漂移：active-root Profile 改为全模式 PC0~PC7 入口检查口径，历史归档页不再维护固定 Skill 数量，并将旧 prod 预检查规则标注为历史阶段规则。

## 2026-05-27

- 增强规范治理生命周期：新增 `spec-governance` Skill、RecordRouter 意图驱动记录分流、SCV 规范变更验证链，并补充 validate 防回归校验。
- 修复 workspace-namespace 运行态落点：CLI/Profile/Hook 状态目录与 Codex adapter 备份统一解析到 active-root，新增项目内 `.devcodex/.tmp` 与工作区根临时/备份产物漂移检查，自动 `.gitignore` 覆盖 `.devcodex/*/.tmp/`，并迁移现有临时产物到集中命名空间。
- 修复治理链小修批次：统一 MCP SUMMARY 新建模板、清理已发布 unreleased 残留、同步 Profile scripts 资产清单，并增强 validate 对 release/profile/audit-state 漂移的防回归检查。
