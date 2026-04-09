# 需求：skills/audit/

**状态**：⬜ 待开发  
**优先级**：P2  
**参考**：原 v0.03 `skills/audit/`（目录已删除，当前实现见 `skills/audit-*/`）

## 文件列表

> ⚠️ **官方结构要求**：扁平一级目录，`name` 与文件夹名一致。

| Skill | 路径（官方扁平结构）| 层级 |
|-------|---------------------|------|
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
- 含 🔴 问题且三列验证全通过 → 自动触发 self-fix
