# 需求：skills/fix/

**状态**：⬜ 待开发  
**优先级**：P2  
**参考**：`v0.03/skills/fix/`

> ⚠️ 历史快照说明：本页保留 `1.0.0` 阶段的规划拆分。当前实现只有 `fix-default` 与 `fix-security` 两个独立 Skill；incident 子类型由 `11-fix.instructions.md` 完整覆盖，不再有独立 `fix-incident` Skill。当前版本无 Free/Pro tier 阻断。

## 文件列表

> ⚠️ **官方结构要求**：扁平一级目录，`name` 与文件夹名一致。

| Skill | 路径（官方扁平结构）| 当前状态 |
|-------|---------------------|----------|
| `fix-default` | `skills/fix-default/SKILL.md` | 已实现，当前全量开放 |
| `fix-security` | `skills/fix-security/SKILL.md` | 已实现，当前全量开放 |
| `incident` | `11-fix.instructions.md` | 由 Instruction 覆盖，无独立 Skill |

## 核心需求

- 所有 fix 子类型必须包含修复三步：同类扫描 → 数据联动 → 零残留复核
