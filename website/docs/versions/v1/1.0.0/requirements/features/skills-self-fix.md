# 需求：skills/self-fix/ + skills/cross/ + skills/token/

**状态**：⬜ 待开发  
**优先级**：P2  
**参考**：原 v0.03 `skills/`（目录已删除，当前实现见 `skills/` 根目录）

> ⚠️ 历史快照说明：本页保留 `1.0.0` 阶段的规划拆分。当前实现中不存在独立 `self-fix` / `self-fix-auto` Skill；自修复能力由 `instructions/14-self-fix.instructions.md` 承载，并由 `skills/spec-governance/SKILL.md` 提供记录分流与 SCV 治理支撑。当前 Token/Tier 门控未启用，所有功能全量开放。

## self-fix

> ⚠️ **官方结构要求**：扁平一级目录，`name` 与文件夹名一致。

| Skill | 路径（官方扁平结构）| 职责 |
|-------|---------------------|------|
| `self-fix` | `instructions/14-self-fix.instructions.md` + `skills/spec-governance/SKILL.md` | 规范自修复流程、RecordRouter 分流与 SCV 验证 |

## cross（跨工作流）

| Skill | 路径（官方扁平结构）| 触发条件 |
|-------|---------------------|---------|
| `api-verification` | `skills/api-verification/SKILL.md` | HTTP 接口变更后 |
| `document-sync` | `skills/document-sync/SKILL.md` | 源码/配置变更后 |
| `impact-review` | `skills/impact-review/SKILL.md` | 跨模块架构依赖变更（PR-5②）|

## token

| Skill | 路径（官方扁平结构）| 职责 |
|-------|---------------------|------|
| `token-check` | `skills/token-check/SKILL.md` | 授权占位；当前所有功能全量开放，无 tier 限制 |
