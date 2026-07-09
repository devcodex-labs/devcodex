---
name: routing
description: 定义意图识别结果到工作流的路由映射。本 Skill 为人类可读参考，实际路由由 `01-common.instructions.md` + `intent/SKILL.md` + 各工作流 instructions 共同定义。
---
# Routing Skill

## 职责

定义意图识别结果到工作流的路由映射。用户通常经 Agent 入口进入，但**实际路由判定**由 `01-common.instructions.md` §意图路由表 + `intent/SKILL.md` 三问法 + `load-profile/SKILL.md` 项目现实扩展共同完成。

> ⚠️ 本 Skill 为**人类可读参考**。Agent 文件只负责入口包装，不再承载完整路由表或工作流主逻辑；执行中无需显式调用本文件。

## 路由映射表

| 意图 | 工作流 | 说明 |
|------|--------|------|
| `dev` | 开发工作流 | CP1→CP2→CP3，8 子类型（见 `10-dev.instructions.md`） |
| `fix` | 修复工作流 | Bug 修复三步扫描（见 `11-fix.instructions.md`） |
| `analyze` | 分析工作流 | 多轮收敛分析，≥3 轮，连续 2 轮无新发现后收敛（见 `13-analyze.instructions.md`），只读 |
| `audit` | 审计工作流 | 多轮深度审查，≥3 轮（见 `12-audit.instructions.md`） |
| `self-fix` | 自修复工作流 | 规范文件自修复（见 `14-self-fix.instructions.md`） |
| `chat` | 问答工作流 | 纯问答，快速路径 |
| `resume` | 上下文恢复 | 恢复记忆后重路由到原始工作流 |
| `other` | 规划工作流 | 兜底路由，制定执行计划（`plan/SKILL.md`） |

## 子类型路由表

> ⚠️ 本表仅供路由参考。执行时按 `01-common` §Skill 按需读取表 读取对应 Skill，禁止全量读取。
> 子类型标识汇总：`dev.default` / `dev.docs` / `dev.refactor` / `dev.database` / `dev.init` / `dev.optimization` / `dev.scenario-test` / `dev.plan-review` / `fix.default` / `fix.security` / `fix.incident` / `analyze.default` / `analyze.research`
> 支撑型 Skill 不作为工作流子类型；Profile 缺失、补建 Profile 或恢复 dev 模式时按需触发 `profile-bootstrap`。用户文档/最终手册写作语义优先触发 `user-manual-authoring`；用户侧文档 review、项目文档审查、菜单导航或文档 IA 审查语义优先触发 `audit-user-manual`；正式复审/清单收敛语义优先触发 `review-checklist`；代码、文档、示例、fixture、技术方案或报告被要求具备技术专家 / 资深架构 / 领域专家质量，或用户指出“不专业 / 像初级 / 示例误导”时优先触发 `expert-output-quality`；规范吸纳、最新可吸纳、data 吸纳清单或仍需吸纳语义优先触发 `spec-absorption`；自我进化/自动吸纳/自动优化规范或模型辅助治理语义优先触发 `evolution-governance`。

| 工作流 | 子类型 | Skill 文件 |
|--------|--------|-----------|
| dev | default | `skills/dev-default/SKILL.md` |
| dev | refactor | `skills/dev-refactor/SKILL.md` |
| dev | database | `skills/dev-database/SKILL.md` |
| dev | init | `skills/dev-init/SKILL.md` |
| dev | optimization | `skills/dev-optimization/SKILL.md` |
| dev | scenario-test | `skills/dev-scenario-test/SKILL.md` |
| dev | docs | `skills/dev-docs/SKILL.md` |
| dev | plan-review | `skills/audit-common/SKILL.md`（豁免 `dev-plan-review`，防递归） |
| fix | default | `skills/fix-default/SKILL.md` |
| fix | incident | （Instruction 已完整覆盖） |
| fix | security | `skills/fix-security/SKILL.md` |
| analyze | default | `skills/analyze-default/SKILL.md` |
| analyze | research | `skills/analyze-research/SKILL.md` |
| audit | 规范文件 | `skills/audit-dimensions/SKILL.md` |
| audit | 技术方案 | `skills/audit-tech-design/SKILL.md` |
| audit | 需求文档 | `skills/audit-requirements/SKILL.md` |
| audit | 项目工程 | `skills/audit-project/SKILL.md` |
| audit | 报告 | `skills/audit-report/SKILL.md` |
| audit | 通用文档 | `skills/audit-document/SKILL.md`（用户侧文档 / 文档站 / 项目文档 review 先叠加 `skills/audit-user-manual/SKILL.md`；README / 主入口文档再叠加 `skills/audit-readme/SKILL.md`） |
| audit | 发布前审查 | `skills/audit-release/SKILL.md`（release readiness / publish 或 tag 前风险审查，不替代 `release-verification`） |

## 支撑型能力触发参考

| 语义 | Skill | 说明 |
|------|-------|------|
| 站点文档、最终用户使用文档、README、quick start、接入手册、docs-first 用户手册 | `skills/user-manual-authoring/SKILL.md` | 用户文档写作入口；README 继续叠加 `readme-authoring` |
| 用户侧文档 review、项目文档审查、文档设计、菜单导航、sidebar、信息架构 | `skills/audit-user-manual/SKILL.md` | 用户文档审查聚合入口；按顺序叠加 `user-manual-authoring`、`audit-document`、条件 `audit-readme`、`review-checklist` |
| 正式复审、ECR、发布前复审、多轮收敛、冻结清单、外部 finding 批次 | `skills/review-checklist/SKILL.md` | 复审清单创建、冻结、逐项证据、状态新鲜度与收敛关闭 |
| 专家型代码/文档/示例/fixture/方案/报告质量、不专业纠正、生产推荐路径与反模式边界 | `skills/expert-output-quality/SKILL.md` | 执行 `ExpertOutputQualityGate`，区分生产推荐路径、框架原生能力、fixture/mock/demo 边界、反模式和证据矩阵 |
| 规范吸纳、最新可吸纳、仍需吸纳、检查 `.devcodex/*/data` 吸纳清单、开始吸纳 | `skills/spec-absorption/SKILL.md` | 规范吸纳执行入口；证明通用规范价值、剔除项目独有规则、输出最终清单、分层落点、消费者证明、验证探针和台账回写 |
| 自我进化、自动吸纳、模型辅助规范优化、自动补 Skill / Prompt / Probe、自动治理候选 | `skills/evolution-governance/SKILL.md` | 自我进化控制面入口；执行 `EvolutionCapabilityControlPlaneGate`，冻结授权、模型配置、权限、配额、数据边界、审计、回滚和发布审批 |

## 特殊路由规则

### 违规质疑路由（优先于主路由表）

以下语义均路由到 `audit` → 规范文件审查（**不得路由到 `chat`**）：
- 用户指出 AI 违反了某条规范
- 用户质问为什么某步骤没有执行
- 用户要求检查当前会话是否合规
- 用户确认规范存在后要求补做

> 路由到 audit 后，**首先**重新执行合规检查（`compliance` Skill），再输出审查结论。

### resume 路径

```
RESTORE → 先读今日 tasks/YYYYMMDD.md → 再读 Agent SUMMARY.md → 读取相关记忆（resume 时最近 14 天）→ 还原上下文 → 提取原始意图 → 重路由到原始工作流
```

### resume 约束

- chat 不产生中断 → resume 不接受 chat 类型原始意图
- resume 不改变原始意图类型
- resume 超过 14 天时：从 SUMMARY.md 查找最后 🔄 状态行，再提示用户提供具体日期或会话编号后精准恢复

### chat 快速路径

三问法全部指向分析 + 无文件变更 → 执行入口检查 PC0~PC7 → 跳过 CP 和报告 → 直接回复 → 仅写记忆 → 关闭

### 项目现实扩展后的路由修正

```
语义初判 → 目标项目/Profile 加载 → 项目现实扩展 → 最终工作流/子类型
```

- 若用户说“审查某个项目”，语义初判可为 audit；项目现实扩展需结合项目类型决定审查维度和最小文件族。
- 若用户说“修一下规范”，语义初判可为 fix；若目标是 DevCodex 控制面规范缺陷，应修正为规范自修复或默认开发流程中的控制面治理任务。
- 若扩展结果显示目标项目不明确，必须先澄清，不得直接路由。

### 多意图处理

≥2 意图 → 按序逐一路由，每个独立走完整工作流周期 → 独立报告 → 再路由下一个

`ConcurrencyPolicy` 允许多意图前置只读识别或隔离分析并行，但不允许并行推进多个会写 CP 状态、报告、记忆、台账或 source mutation 的工作流。

### 工作流内部强制步骤

dev: `plan-review`（CP2 后、CP3 前强制）为工作流内部步骤，不参与子类型路由。
