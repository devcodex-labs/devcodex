# 需求总览

> **规范**：本目录是 DevCodex v1.0.0 所有需求的唯一来源。  
> 每个需求下含完整开发文档（技术方案 / 实施计划 / 进度 / 关键决策）。

## P0 核心需求（已完成）

| 模块 | 需求 | 状态 |
|------|------|------|
| 项目根骨架 | [root](./p0/root) | ✅ 已完成 |
| `.devcodex/profile` 项目信息 | [profile](./p0/profile) | ✅ 已完成 |
| `website/` 文档站骨架 | [website](./p0/website) | ✅ 已完成 |

## P1 基础需求（前置规范）

> P1 是所有功能需求得以实施的前置基础规范，必须优先定义与实施。

| 需求 | 技术方案 | 进度 | 状态 |
|------|---------|------|------|
| [Agent 双模式（确认 vs 全自动）](./p1/agent-modes/) | [设计](./p1/agent-modes/design) | [进度](./p1/agent-modes/progress) | ⬜ 待开发 |
| [存储规范（位置 / 产物 / gitignore）](./p1/storage-spec/) | [设计](./p1/storage-spec/design) | [进度](./p1/storage-spec/progress) | ⬜ 待开发 |
| [记忆恢复与 Resume 工作流](./p1/memory-resume/) | [设计](./p1/memory-resume/design) | [进度](./p1/memory-resume/progress) | ⬜ 待开发 |

## P2 功能需求

| 模块 | 需求 | 状态 |
|------|------|------|
| `agents/` Agent 路由 | [agents](./p2/agents) | ⬜ 待开发 |
| `instructions/` 全局规范 | [instructions](./p2/instructions) | ⬜ 待开发 |
| `skills/` 核心技能 | [skills-core](./p2/skills-core) | ⬜ 待开发 |
| `skills/` 路由技能 | [skills-routing](./p2/skills-routing) | ⬜ 待开发 |
| `skills/` dev 技能 | [skills-dev](./p2/skills-dev) | ⬜ 待开发 |
| `skills/` fix 技能 | [skills-fix](./p2/skills-fix) | ⬜ 待开发 |
| `skills/` audit 技能 | [skills-audit](./p2/skills-audit) | ⬜ 待开发 |
| `skills/` analyze 技能 | [skills-analyze](./p2/skills-analyze) | ⬜ 待开发 |
| `skills/` self-fix + cross + token | [skills-self-fix](./p2/skills-self-fix) | ⬜ 待开发 |
| `prompts/` + `hooks/` + `data/` | [prompts](./p2/prompts) | ⬜ 待开发 |

## 开发规范

1. 每次开发前先读对应需求文件（`index.md`），再读技术方案（`design.md`）
2. 参考 `v0.03/` 存档，按重构原则**英文重写**（规范文件统一英文）
3. Skills 必须遵循官方扁平结构，`name` 字段与文件夹名完全一致
4. v0.03 存档不再修改，所有变更在 v1.0.0 源码目录进行
5. 完成后更新 [发布前检查清单](/versions/v1.0.0/release/checklist) 对应状态

