# 需求：skills/audit/

> ⚠️ 历史快照说明：本页保留 `1.0.0` 阶段的 audit Skill 需求。当时文档中的 Free/Pro 层级是历史规划；当前版本 `token-check` 仅为授权占位，所有 audit 子能力全量开放。

**状态**：⬜ 待开发  
**优先级**：P2  
**参考**：原 v0.03 `skills/audit/`（目录已删除，当前实现见 `skills/audit-*/`）

## 文件列表

> ⚠️ **官方结构要求**：扁平一级目录，`name` 与文件夹名一致。

| Skill | 路径（官方扁平结构）| `1.0.0` 阶段规划层级 |
|-------|---------------------|----------------------|
| `audit-common` | `skills/audit-common/SKILL.md` | Free |
| `audit-dimensions` | `skills/audit-dimensions/SKILL.md` | Free |
| `audit-tech-design` | `skills/audit-tech-design/SKILL.md` | Free |
| `audit-requirements` | `skills/audit-requirements/SKILL.md` | Free |
| `audit-project` | `skills/audit-project/SKILL.md` | Pro |
| `audit-report` | `skills/audit-report/SKILL.md` | Free |
| `audit-document` | `skills/audit-document/SKILL.md` | Free |
| `audit-execution-guide` | `skills/audit-execution-guide/SKILL.md` | Free |

## 核心需求

- 多轮收敛规则定义在 `audit-common`
- `1.0.0` 阶段目标：含 🔴 问题且三列验证全通过 → 自动触发 self-fix；当前仅 DevCodex plugin 文件审查触发元循环 self-fix，其他目标记录问题并等待后续修复
