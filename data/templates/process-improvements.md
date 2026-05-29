# 过程改进记录 / 优化清单（template）

> **文件定位**：模板。`devcodex init` / `devcodex init --claude` 复制为目标项目运行时 `data/process-improvements.md`（Copilot: `.github/data/process-improvements.md`；Claude Code: `.claude/data/process-improvements.md`）。
> **使用**：C17 / Improvement Intake 命中时追加 PI 条目；所有模式命中后都需回执 `已记录 PI-xxx` 或 `已记录 PI-xxx / PF-xxx`。
> **维护者记录**：不在本包内分发；启用 `workspace-namespace` 时写入对应 active-root，例如 `<工作区根>/.devcodex/<project>/data/process-improvements.md`。
> **归属提醒**：若建议针对 DevCodex 规范自身、Hook、Skill、模板、validate 或宿主适配链路，则应写入承载这些规范资产的 active-root，而不是当前业务项目台账。

---

## 字段规范

| 字段 | 说明 |
|------|------|
| 编号 | `PI-NNN` |
| 日期 | `YYYY-MM-DD` |
| 触发来源 | 用户建议 / AI 复盘 / audit 建议 / 主动 intake |
| 触发场景 | 用户建议的执行策略或主动 Intake 命中的规范改进点 |
| 规范化意图 | `record.process-improvement` |
| 策略来源 | 用户建议 / AI 复盘 / audit 建议 |
| 可泛化理由 | 为什么不是一次性偏好 |
| 关联缺口 | 无 / `PF-NNN`（若同时暴露规范缺口） |
| 采纳证据 | 已确认依据或验证结果 |
| 是否纳规 | ✅ 已纳入规范 / 🔄 待评估 |

---

## 登记表

| 编号 | 日期 | 触发来源 | 触发场景 | 规范化意图 | 策略来源 | 可泛化理由 | 关联缺口 | 采纳证据 | 是否纳规 |
|------|------|---------|---------|--------------|----------|------------|----------|----------|:--------:|
| PI-000 | YYYY-MM-DD | EXAMPLE — 删除本行 | EXAMPLE — 删除本行 | record.process-improvement | 用户建议 | 示例理由 | 无 | 示例证据 | 🔄 |
