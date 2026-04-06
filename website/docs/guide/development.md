# 开发规范

> AI 在执行 dev/fix 工作流时，除遵守 instructions 约束外，还须遵守本页项目级规范。

---

## 各组件使用规范

> 遇到新任务时，先判断用哪个组件，再动手创建文件。

| 场景 | 用哪个组件 | 理由 |
|------|-----------|------|
| 需要始终约束 AI 的规则 | Instructions | 每次会话自动注入，不需要手动触发 |
| 按需触发的工作流 | Skills（薄壳）+ Workflows（详情）| Skills 提供入口，Workflows 存放内容 |
| CP 节点的结构化输出 | Prompts | 有参数、有格式的单次任务 |
| 会话开始/结束的自动动作 | Hooks | 确定性执行，AI 无法跳过 |
| 定义 AI 的工具权限和运行模式 | Agents | 只有两个（确认模式/全自动模式）|

> ⛔ **禁止把工作流详细内容写进 SKILL.md**。SKILL.md 只写入口路由，详细内容放 `workflows/<name>/`。

---



| 文件 | 何时填写 | 填写内容 |
|------|---------|---------|
| `design.md` | CP2 方案确认后 | 技术方案、文件变更清单、风险与约束 |
| `plan.md` | CP3 实施计划确认后 | Phase 分阶段步骤表（步骤/文件/说明/状态）|
| `progress.md` | 每次会话后更新 | 各步骤状态更新 + 会话记录追加 |
| `decisions.md` | 有重大决策时 | D-NNN 格式，记录背景/决策/原因/影响 |

> ⛔ `design.md` 和 `plan.md` 在对应 CP 通过前**不填写实质内容**，只保留"待撰写/待制定"占位。

---

## 组件使用规范

> 核心原则：**用对组件**——不要把工作流内容放进 Instructions，也不要把全局约束放进 Skills。

| 场景 | 用哪个 | 禁止误用 |
|------|-------|---------|
| 定义 AI 身份和工具权限 | **Agents** | ❌ 不要写进 Instructions |
| 工作流触发入口（按需）| **Skills** | ❌ SKILL.md 只写路由，不写详细流程 |
| 工作流详细执行步骤 | **workflows/** | ❌ 不要塞进 SKILL.md |
| 始终有效的规范约束 | **Instructions** | ❌ 不要写进 SKILL.md |
| CP 节点结构化输出 | **Prompts** | ❌ 不要在 SKILL.md 内联模板 |
| 生命周期事件强制执行 | **Hooks** | ❌ 不要用 Instructions 模拟 Hooks |

### Skills 编写规范

```markdown
---
name: dev-default              # 必须与文件夹名完全一致
description: "Use when: ..."   # 必填，AI 靠这个发现 Skill
---

Read `.github/workflows/dev-default/index.md` and follow the workflow.

<!-- v2.0.0: Replace with → MCP devcodex_getWorkflow({ intent: "dev-default" }) -->
```

- SKILL.md 只做两件事：**描述触发条件** + **指向 workflows/**
- 工作流详细内容全部写在 `workflows/<skill-name>/` 目录下
- 每个工作流目录包含：`index.md`（主流程）+ 各节点文件

### workflows/ 目录规范

```
workflows/<skill-name>/
├── index.md     ← 必须有，主流程总览（CP 顺序、约束、节点引用）
├── cp1.md       ← 需求确认节点（按需创建）
├── cp2.md       ← 方案确认节点
├── cp3.md       ← 实施计划节点
└── execute.md   ← 执行阶段约束
```

- `index.md` 必须包含完整节点引用，AI 从这里开始读取
- 节点文件按需创建，简单工作流可只有 `index.md`



### AI 必须完成以下操作：

1. **更新步骤状态**：在 `progress.md` 对应步骤行，将 `⬜` 改为 `🔄`（进行中）或 `✅`（完成）
2. **追加会话记录**：在 `progress.md` 会话记录表追加一行

   ```markdown
   | 2026-04-04 | 简述本次做了什么 | 完成了哪些步骤 |
   ```

3. **需求完成时额外执行**：
   - 更新 `index.md` 页眉状态为 `✅ 已完成`
   - 更新 `requirements/index.md` 总览表状态列
   - 在 `CHANGELOG.md` 追加完成记录

---

## 关键决策记录格式（decisions.md）

```markdown
## D-NNN：<决策标题>

**日期**：YYYY-MM-DD
**背景**：[为什么需要做这个决策]
**决策**：[决定了什么]
**原因**：[为什么这样决定]
**影响**：[对哪些文件/模块有影响]
```

- `NNN` 从 `001` 起递增
- 只追加，不修改已有记录
- 最新决策在最下方

---

## 执行上下文（Draft）

`.devcodex/profile/config.json` 中的 `mode` 字段目前**仅保留为预留能力**，但 `dev / prod` 的行为矩阵尚未冻结，不应视为正式规范。

当前约定：

- **已冻结**：确认模式 / 全自动模式属于 Agent 入口设计，见 [P1：Agent 双模式](/versions/v1/1.0.0/requirements/p1/agent-modes/)
- **未冻结**：`dev` / `prod` 对日志、预检查输出、合规展示的差异
- **文档策略**：在行为未确定前，只保留 Draft 说明，不写成永久规范

> ⚠️ 等执行上下文真正定稿后，再决定它归入 P0 执行流程还是独立 P1 需求。

---

## 架构约束动态更新说明

> ⚠️ **v1.0.0 仍在开发中**，`02-架构约束.md` 是动态演进的，不代表最终态。

- AI 读取时以**文件当前内容**为准，不推断或补全未写入的约束
- 发现新的约束边界 → 立即追加到 `02-架构约束.md`
- 约束废弃时 → 注明"已废弃：原因"，不直接删除（保留变更历史）

---

## 规范文件编写规则

| 规则 | 说明 |
|------|------|
| 语言 | agents/skills/instructions/prompts 统一用**英文**编写 |
| Skill 目录 | 必须是扁平一级目录，`name` 字段与文件夹名完全一致（小写+连字符）|
| Instructions | `applyTo: "**"` 全局注入，单文件 ≤ 500 行 |
| 文件名 | Instructions: `NN-<kebab>.instructions.md`；报告: `NN--<简述>.md`（双横杠）|
