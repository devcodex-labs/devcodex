# 待修复清单（template）

> **文件定位**：模板。`devcodex init` / `devcodex init --claude` 复制为目标项目运行时 `data/pending-fixes.md`（Copilot: `.github/data/pending-fixes.md`；Claude Code: `.claude/data/pending-fixes.md`）。
> **使用**：PC4 三轴检测出 PF 标记后，AI 追加到此表；修复完成后标注 ✅。
> **维护者自身的 PF**：不在本包内分发；在仓库 `.devcodex/.maintainer-state/pending-fixes.md` 管理。

---

## 字段规范

| 字段 | 说明 |
|------|------|
| 编号 | `PF-NNN` |
| G 码 | `G1~G11`（见 `18-spec-radar`）|
| Axis | `A` / `B` / `C` / `A+B` 等多轴组合 |
| 简述 | 一句话描述规范缺陷 |
| 关联 VL | 若为 G5 重复违规，填对应 VL 编号 |
| 状态 | 🔄 / ✅ |

---

## 登记表

| 编号 | G码 | Axis | 简述 | 关联 VL | 状态 |
|------|:---:|:----:|------|:-------:|:----:|
| PF-000 | G1 | A | EXAMPLE — 删除本行 | — | 🔄 |
