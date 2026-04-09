# 需求：skills/routing/

**状态**：⬜ 待开发  
**优先级**：P2  
**参考**：原 v0.03 `skills/routing/`（目录已删除，当前实现见 `skills/routing/`）

## 目标

创建路由技能，供工作流入口读取项目配置。

> ⚠️ **官方结构要求**：扁平一级目录，`name` 与文件夹名一致。

## 文件列表

| Skill | 路径（官方扁平结构）| 职责 |
|-------|---------------------|------|
| `load-profile` | `skills/load-profile/SKILL.md` | 读取 `.devcodex/profile/` 项目规范，注入 ENV_MODE |
| `routing` | `skills/routing/SKILL.md` | 意图路由辅助 |

## 验收标准
- [ ] `load-profile` Skill 创建完成
- [ ] 能正确读取 `config.json` 中的 `mode` 字段
