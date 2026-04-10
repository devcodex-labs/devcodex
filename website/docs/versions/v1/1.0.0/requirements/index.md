# 需求总览

> **规范**：本目录是 DevCodex v1.0.0 所有需求的唯一来源。  
> 每个需求下含完整开发文档（技术方案 / 实施计划 / 进度 / 关键决策）。

> **导航提示**：  
> - P0 核心骨架 / P1 功能需求 / P2 实现规范  
> - `implementation/` 记录"怎么做、做到哪"（[实施总览](./implementation/)）

## P0 核心需求（骨架已建立）

| 模块 | 需求 | 状态 |
|------|------|------|
| 项目根骨架 | [root](./p0/root) | ✅ 骨架已建立 |
| `.devcodex/profile` 项目信息 | [profile](./p0/profile) | ✅ 骨架已建立 |
| 执行流程骨架 | [execution-flow](./p0/execution-flow) | ✅ 已冻结 |
| `website/` 文档站骨架 | [website](./p0/website) | ✅ 骨架已建立 |

## P1 功能需求

> P1 涵盖主流程各阶段需求（①~⑪）及前置基础规范。

### 主流程阶段

| # | 需求 | 技术方案 | 进度 | 状态 |
|:-:|------|---------|------|------|
| ① | [预检查](./p1/precheck/) | [设计](./p1/precheck/design) | [进度](./p1/precheck/progress) | ✅ 已实现 |
| ② | [安全检查](./p1/safety-check/) | [设计](./p1/safety-check/design) | [进度](./p1/safety-check/progress) | ✅ 已实现 |
| ②' | [阻断并给出合规替代](./p1/block-op/) | [设计](./p1/block-op/design) | [进度](./p1/block-op/progress) | ✅ 已实现 |
| ③ | [写入摘要](./p1/summary/) | [设计](./p1/summary/design) | [进度](./p1/summary/progress) | ✅ 已实现 |
| ④ | [检索记忆](./p1/memory-retrieval/) | [设计](./p1/memory-retrieval/design) | [进度](./p1/memory-retrieval/progress) | ✅ 已实现 |
| ⑤ | [前置状态汇总](./p1/pre-state-summary/) | [设计](./p1/pre-state-summary/design) | [进度](./p1/pre-state-summary/progress) | ✅ 已实现 |
| ⑥ | [开发阶段合规检查](./p1/dev-compliance/) | [设计](./p1/dev-compliance/design) | [进度](./p1/dev-compliance/progress) | ✅ 已实现 |
| ⑦ | [路由到工作流](./p1/routing/) | [设计](./p1/routing/design) | [进度](./p1/routing/progress) | ✅ 已实现 |
| ⑧ | [工作流执行](./p1/workflow-execution/) | [设计](./p1/workflow-execution/design) | [进度](./p1/workflow-execution/progress) | ✅ 已实现 |
| ⑨ | [执行阶段合规检查](./p1/exec-compliance/) | [设计](./p1/exec-compliance/design) | [进度](./p1/exec-compliance/progress) | ✅ 已实现 |
| ⑩ | [输出报告](./p1/report-output/) | [设计](./p1/report-output/design) | [进度](./p1/report-output/progress) | ✅ 已实现 |
| ⑪ | [更新记忆](./p1/memory-update/) | [设计](./p1/memory-update/design) | [进度](./p1/memory-update/progress) | ✅ 已实现 |

### 前置基础规范

| 需求 | 技术方案 | 进度 | 状态 |
|------|---------|------|------|
| [Agent 双模式（确认 vs 全自动）](./p1/agent-modes/) | [设计](./p1/agent-modes/design) | [进度](./p1/agent-modes/progress) | ✅ 已实现 |
| [变更护栏（提交边界 / 官方文档 / Commit 摘要）](./p1/change-guardrails/) | [设计](./p1/change-guardrails/design) | [进度](./p1/change-guardrails/progress) | ✅ 已实现 |
| [存储规范（位置 / 产物 / gitignore）](./p1/storage-spec/) | [设计](./p1/storage-spec/design) | [进度](./p1/storage-spec/progress) | ✅ 已实现 |
| [记忆恢复与 Resume 工作流](./p1/memory-resume/) | [设计](./p1/memory-resume/design) | [进度](./p1/memory-resume/progress) | ✅ 已实现 |

## P2 实现规范

> P2 记录各模块的实现规范参考文档。

| 模块 | 需求 | 状态 |
|------|------|------|
| `agents/` Agent 路由 | [agents](./p2/agents) | ✅ 已实现 |
| `instructions/` 全局规范 | [instructions](./p2/instructions) | ✅ 已实现 |
| `skills/` 核心技能 | [skills-core](./p2/skills-core) | ✅ 已实现 |
| `skills/` 路由技能 | [skills-routing](./p2/skills-routing) | ✅ 已实现 |
| `skills/` dev 技能 | [skills-dev](./p2/skills-dev) | ✅ 已实现 |
| `skills/` fix 技能 | [skills-fix](./p2/skills-fix) | ✅ 已实现 |
| `skills/` audit 技能 | [skills-audit](./p2/skills-audit) | ✅ 已实现 |
| `skills/` analyze 技能 | [skills-analyze](./p2/skills-analyze) | ✅ 已实现 |
| `skills/` self-fix + cross + token | [skills-self-fix](./p2/skills-self-fix) | ✅ 已实现 |
| `prompts/` + `data/` | [prompts](./p2/prompts) | ✅ 已实现 |

## 开发规范

1. 每次开发前先读对应需求文件（`index.md`），再读技术方案（`design.md`）
2. 基于 v0.03 原型重构（v0.03 目录已删除，当前实现见 `skills/` 等源码目录）
3. Skills 必须遵循官方扁平结构，`name` 字段与文件夹名完全一致
4. 所有变更在 v1.0.0 源码目录进行
5. 完成后更新 [发布前检查清单](/versions/v1/1.0.0/release/checklist) 对应状态

---

## 历史需求页说明

`requirements/core/`、`requirements/cross-cutting/`、`requirements/features/` 属于历史整理产物，当前不作为主线规范来源。  
v1.0.0 主线以 `requirements/p0/`、`requirements/p1/`、`requirements/p2/` 为准。
