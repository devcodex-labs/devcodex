# 开发规范

> AI 在执行 dev/fix 工作流时，除遵守 instructions 约束外，还须遵守本页项目级规范。

---

## 各组件使用规范

> 遇到新任务时，先判断用哪个组件，再动手创建文件。

| 场景 | 用哪个组件 | 理由 |
|------|-----------|------|
| 需要始终约束 AI 的规则 | Instructions | 每次会话自动注入，不需要手动触发 |
| 按需触发的工作流 | Skills（SKILL.md 完整内容）| AI 按需读取，包含完整工作流检查标准与执行步骤 |
| CP 节点的结构化输出 | Prompts | 有参数、有格式的单次任务 |
| 会话开始/结束的自动动作 | Hooks | 确定性执行，AI 无法跳过 |
| 定义 AI 的工具权限和运行模式 | Agents | 只有两个（确认模式/全自动模式）|

> ℹ️ **当前实现**：SKILL.md 包含完整的工作流内容（触发条件 + 检查标准 + 执行步骤）。v2.0.0 规划中可能演进为 Skills（薄壳路由）+ MCP 工作流分离架构。

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
| 按需触发的工作流技能 | **Skills** | ❌ SKILL.md 包含完整内容（触发条件 + 执行步骤） |
| 始终有效的规范约束 | **Instructions** | ❌ 不要写进 SKILL.md |
| CP 节点结构化输出 | **Prompts** | ❌ 不要在 SKILL.md 内联模板 |
| 生命周期事件强制执行 | **Hooks** | ❌ 不要用 Instructions 模拟 Hooks |

### Skills 编写规范

```markdown
---
name: dev-default              # 必须与文件夹名完全一致
description: "Use when: ..."   # 必填，AI 靠这个发现 Skill
---

# dev-default Skill

## 触发条件
...

## 执行步骤
...

## 检查标准
...
```

- SKILL.md 包含完整的工作流内容：**触发条件** + **执行步骤** + **检查标准**
- 每个 Skill 目录只有一个 `SKILL.md`，扁平一级目录
- v2.0.0 规划：MCP `devcodex_getWorkflow()` 替代文件读取



| 文件 | 何时填写 | 填写内容 |

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

## 执行上下文（当前规则）

`.devcodex/profile/config.json` 中的 `mode` 字段当前已经参与正式的 `ENV_MODE` 行为分叉，不再是 Draft 或预留能力。

当前规则：

- **`mode: "dev"`**：进入实质任务前输出 PC0~PC7 入口检查，PC4 执行完整规范雷达，并在收尾执行 FC / SC / RC / T 合规检查
- **`mode: "prod"`**：进入实质任务前仍输出 PC0~PC7 基础入口检查，PC4 标注 N/A；不执行后置合规检查，但 CP1 / CP2 / CP3 仍然强制
- **执行模式与 `ENV_MODE` 分离**：确认模式 / 全自动模式属于 Agent 入口语义；当前全自动正式入口仍只认显式 `@devcodex-auto`，且只有在 hook-enforced 宿主 + 白名单路径上形成 runtime 级自动推进

> 当前正式规则源以 `instructions/01-common.instructions.md`、`instructions/17-compliance.instructions.md` 和 `skills/cp-gate/SKILL.md` 为准；本页负责解释这些规则如何落到日常开发流程中。

### 项目现实扩展

日常开发中，DevCodex 不应只按用户字面关键词决定工作流。当前正式流程为：

```text
语义意图初判 → 目标项目/Profile 加载 → 项目现实扩展 → 最终工作流/子类型
```

项目现实扩展至少要检查目标项目、真实影响范围、关联文件族、产物落点和验证方式；若项目未明确，必须先澄清，不能为了扩展意图而无界扫描工作区。

### Intent Expansion Card

非 chat 工作流在 CP1 / 问题确认前需要形成 Intent Expansion Card，记录 `semantic`、`project`、`continuity`、`action`、`domain`、`artifact-impact`、`risk`、`host-capability`、`validation-route`、`confidence`、`alternatives`。这张卡用于把入口判断、CP 产物和压缩恢复后的复核锚在同一组事实上。

### ECR 执行闭环复审

dev/fix 完成前必须执行 ECR 执行闭环复审。ECR 会交叉验证 CP1/CP2/CP3、报告、daily tasks、SUMMARY、diff/commit、测试/探针和 git dirty 边界，确认没有“报告已完成但证据不足”或“SUMMARY 已完成但 daily 仍未闭环”的状态错配。

### 推荐结论与确认交互

分析、审计或执行报告存在多个建议/路径时，必须给出推荐结论与推荐理由；没有后续动作时写明“推荐：无后续动作”。用户确认先抽象为 ConfirmationRequest，再按宿主能力使用按钮、权限提示、Hook 阻断或文本确认 fallback。

### 相关文件联查

当前正式规则要求：当任务涉及控制面规则、模板、接口契约/验证产物、工作区真相源/部署副本或发布口径变更时，AI 不能只看单文件结果，必须联查相关文件；若同时命中多真相源同步或模板-示例-校验链，需进一步升级为交叉验证或 `CRS`。

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
| 语言 | agents/skills/instructions/prompts 统一用**中文**编写 |
| Skill 目录 | 必须是扁平一级目录，`name` 字段与文件夹名完全一致（小写+连字符）|
| Instructions | `applyTo: "**"` 全局注入，单文件 ≤ 500 行 |
| 文件名 | Instructions: `NN-<kebab>.instructions.md`；报告: `NN--<简述>.md`（双横杠）|
