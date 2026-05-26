# 违规登记表（template）

> **文件定位**：模板。`devcodex init` / `devcodex init --claude` 会将本文件复制到目标项目运行时 `data/violations.md`（Copilot: `.github/data/violations.md`；Claude Code: `.claude/data/violations.md`）。
> **使用**：在**用户项目内**，由 AI 按 `17-compliance` 规则追加 VL-001 起的违规记录。
> **维护者自身的违规记录**：不在本包内分发；维护者在仓库 `.devcodex/.maintainer-state/violations.md` 管理。

---

## 字段规范

| 字段 | 说明 | 必填 |
|------|------|:----:|
| 编号 | `VL-NNN`（三位数，从 001 起）| 是 |
| 日期 | ISO 日期 `YYYY-MM-DD` | 是 |
| 规范 | 违反的规范编号（如 `S03` / `C11` / `FC4`）| 是 |
| 现象 | 一句话描述违规现象 | 是 |
| 根因 | 规范缺陷 / AI 判断失误 / 用户显式越权 | 是 |
| 处置 | 🔄 处理中 / ✅ 已关闭 | 是 |

---

## 登记表

| 编号 | 日期 | 规范 | 现象 | 根因 | 处置 |
|------|------|------|------|------|:----:|
| VL-000 | YYYY-MM-DD | 示例 | EXAMPLE — 删除本行 | EXAMPLE | 🔄 |
