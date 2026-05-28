# Pending Issues（template）

> **文件定位**：模板。`devcodex init` / `devcodex init --claude` 复制为目标项目运行时 `data/pending-issues.md`（Copilot: `.github/data/pending-issues.md`；Claude Code: `.claude/data/pending-issues.md`）。
> **使用**：记录已确认、但**不阻断当前任务**的治理改进项，按批次进入后续需求或 bug 修复流程。
> **维护者记录**：不在本包内分发；启用 `workspace-namespace` 时写入对应 active-root，例如 `<工作区根>/.devcodex/<project>/data/pending-issues.md`。

---

## 字段规范

| 字段 | 说明 |
|------|------|
| 编号 | `ISSUE-NNN` |
| 标题 | 一句话概括问题 |
| 发现时间 | `YYYY-MM-DD` |
| 影响范围 | 受影响的规范/模板/客户端/流程 |
| 规范化意图 | `record.pending-issue` |
| 治理类型 | 规范治理 / 路径治理 / 模板治理 / 验证治理 |
| 排期建议 | 推荐批次或优先级 |
| 关联 PF/VL/GAP | 关联编号，无则 `—` |
| 建议动作 | 后续修复方向或收口方式 |
| 状态 | 🔄 / ✅ |

---

## 登记表

| 编号 | 标题 | 发现时间 | 影响范围 | 规范化意图 | 治理类型 | 排期建议 | 关联 PF/VL/GAP | 建议动作 | 状态 |
|------|------|-----------|----------|--------------|----------|----------|----------------|----------|:----:|
| ISSUE-000 | EXAMPLE — 删除本行 | YYYY-MM-DD | 示例范围 | record.pending-issue | 规范治理 | 示例批次 | — | 示例动作 | 🔄 |
