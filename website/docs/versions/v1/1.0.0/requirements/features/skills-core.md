# 需求：skills/core/

**状态**：⬜ 待开发  
**优先级**：P1
**参考**：原 v0.03 `skills/core/`（目录已删除，当前实现见 `skills/` 根目录）

> ⚠️ 历史快照说明：本页保留 `1.0.0` 阶段的核心 Skill 规划。当前版本所有 Skill 全量开放，无 Free/Pro tier 阻断；规范文件语言以项目 profile 为准，当前为中文。

## 目标

创建核心技能，供所有工作流使用。

> ⚠️ **官方结构要求**：每个 Skill 必须是 `skills/<name>/` 的**扁平一级目录**，`name` 字段必须与文件夹名完全一致（小写英文+连字符）。

## 文件列表

| Skill | 路径（官方扁平结构）| 当前状态 | 职责 |
|-------|---------------------|----------|------|
| `compliance` | `skills/compliance/SKILL.md` | 已实现，当前全量开放 | FC/SC/RC/T 合规检查 |
| `memory` | `skills/memory/SKILL.md` | 已实现，当前全量开放 | 会话记忆读写 |
| `report` | `skills/report/SKILL.md` | 已实现，当前全量开放 | 报告生成与写入 |
| `cp-gate` | `skills/cp-gate/SKILL.md` | 已实现，当前全量开放 | CP1/CP2/CP3 门控 |
| `intent` | `skills/intent/SKILL.md` | 已实现，当前全量开放 | 三问法意图识别 |
| `summary` | `skills/summary/SKILL.md` | 已实现，当前全量开放 | 会话摘要生成 |
| `plan` | `skills/plan/SKILL.md` | 已实现，当前全量开放 | 执行计划生成 |

## SKILL.md frontmatter 规范

```yaml
---
name: compliance          # 必须与文件夹名完全一致，小写英文+连字符
description: 'Use when running compliance checks. Validates SC/FC/RC layers for safety, execution quality, and completion readiness.'
---
```

## 核心规范

- 所有规范文件按当前 profile 使用**中文**编写
- `name` 必须与目录名完全一致（官方强制）
- 7 个 Skill 全部注册在 `plugin.json` skills 列表中

## 验收标准
- [ ] 7 个 Skill 全部创建
- [ ] compliance Skill 包含完整 SC/FC/RC 检查项
- [ ] memory Skill 包含完整字段规范和触发规则
- [ ] 均以英文编写
