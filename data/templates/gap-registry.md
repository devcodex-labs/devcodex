# 维度盲区 / 检测盲点登记（template）

> **文件定位**：模板。`devcodex init` / `devcodex init --claude` 复制为目标项目运行时 `data/gap-registry.md`（Copilot: `.github/data/gap-registry.md`；Claude Code: `.claude/data/gap-registry.md`）。
> **使用**：审查中遇到无对应维度的问题，或 R2+ 自我审视发现 M1~M4 盲点时登记。
> **维护者记录**：`.devcodex/.maintainer-state/gap-registry.md`。

---

## 格式规范

| 字段 | 说明 |
|------|------|
| 编号 | `GR-NNN` |
| 日期 | `YYYY-MM-DD` |
| 类型 | `维度盲区` / `检测盲点` |
| 规范化意图 | `record.audit-gap` |
| 盲区来源 | audit / validate / Hook / ECR / 用户反馈 |
| 盲点类型 | M1/M2/M3/M4（检测盲点）或 N/A（维度盲区） |
| 未发现原因 | 为什么原检查没有发现 |
| 简述 | 一句话 |
| 建议维度 | 拟新增维度名或 N/A |
| 建议探针 | 建议新增的 grep/validate/test 探针 |

---

## 登记表

| 编号 | 日期 | 类型 | 规范化意图 | 盲区来源 | 盲点类型 | 未发现原因 | 简述 | 建议维度 | 建议探针 |
|------|------|------|--------------|----------|:--------:|------------|------|----------|----------|
| GR-000 | YYYY-MM-DD | 维度盲区 | record.audit-gap | audit | N/A | 示例原因 | EXAMPLE — 删除本行 | — | 示例探针 |
