# 需求：skills/fix/

**状态**：⬜ 待开发  
**优先级**：P2  
**参考**：原 v0.03 `skills/fix/`（目录已删除，当前实现见 `skills/fix-*/`）

## 文件列表

> ⚠️ **官方结构要求**：扁平一级目录，`name` 与文件夹名一致。

| Skill | 路径（官方扁平结构）| 层级 |
|-------|---------------------|------|
| `fix-default` | `skills/fix-default/SKILL.md` | Free |
| `fix-incident` | `skills/fix-incident/SKILL.md` | Pro |
| `fix-security` | `skills/fix-security/SKILL.md` | Pro |

## 核心需求

- 所有 fix 子类型必须包含修复三步：同类扫描 → 数据联动 → 零残留复核
