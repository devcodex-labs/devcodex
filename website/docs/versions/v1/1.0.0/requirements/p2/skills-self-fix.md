# 需求：skills/self-fix/ + skills/cross/ + skills/token/

**状态**：⬜ 待开发  
**优先级**：P2  
**参考**：原 v0.03 `skills/`（目录已删除，当前实现见 `skills/` 根目录）

## self-fix

> ⚠️ **官方结构要求**：扁平一级目录，`name` 与文件夹名一致。

| Skill | 路径（官方扁平结构）| 职责 |
|-------|---------------------|------|
| `self-fix-auto` | `skills/self-fix-auto/SKILL.md` | A1~A5 白名单自动修复 |

## cross（跨工作流）

| Skill | 路径（官方扁平结构）| 触发条件 |
|-------|---------------------|---------|
| `api-verification` | `skills/api-verification/SKILL.md` | HTTP 接口变更后 |
| `document-sync` | `skills/document-sync/SKILL.md` | 源码/配置变更后 |
| `impact-review` | `skills/impact-review/SKILL.md` | 跨模块架构依赖变更（PR-5②）|

## token

| Skill | 路径（官方扁平结构）| 职责 |
|-------|---------------------|------|
| `token-check` | `skills/token-check/SKILL.md` | 验证 Free/Pro 层级 |
