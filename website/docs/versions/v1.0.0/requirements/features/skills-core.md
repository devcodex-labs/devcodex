# 需求：skills/core/

**状态**：⬜ 待开发  
**优先级**：P1  
**参考**：`v0.03/skills/core/`

## 目标

创建核心技能，供所有工作流使用。

> ⚠️ **官方结构要求**：每个 Skill 必须是 `skills/<name>/` 的**扁平一级目录**，`name` 字段必须与文件夹名完全一致（小写英文+连字符）。

## 文件列表

| Skill | 路径（官方扁平结构）| 层级 | 职责 |
|-------|---------------------|------|------|
| `compliance` | `skills/compliance/SKILL.md` | Pro | FC/SC/RC/T 四级合规检查 |
| `memory` | `skills/memory/SKILL.md` | Pro | 会话记忆读写 |
| `report` | `skills/report/SKILL.md` | Pro | 报告生成与写入 |
| `cp-gate` | `skills/cp-gate/SKILL.md` | Pro | CP1/CP2/CP3 门控 |
| `intent` | `skills/intent/SKILL.md` | Free | 三问法意图识别 |
| `summary` | `skills/summary/SKILL.md` | Pro | 会话摘要生成 |
| `plan` | `skills/plan/SKILL.md` | Pro | 执行计划生成 |

## SKILL.md frontmatter 规范

```yaml
---
name: compliance          # 必须与文件夹名完全一致，小写英文+连字符
description: 'Use when running compliance checks after workflow execution. Validates FC/SC/RC/T layers.'
---
```

## 核心规范

- 所有文件用**英文**编写
- `name` 必须与目录名完全一致（官方强制）
- 7 个 Skill 全部注册在 `plugin.json` skills 列表中

## 验收标准
- [ ] 7 个 Skill 全部创建
- [ ] compliance Skill 包含完整 FC/SC/RC/T 检查项
- [ ] memory Skill 包含完整字段规范和触发规则
- [ ] 均以英文编写
