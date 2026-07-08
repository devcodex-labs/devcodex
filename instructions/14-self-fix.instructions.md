---
applyTo: "**"
description: self-fix 工作流规则，覆盖规范资产修复边界、自动级/Pending 级分流与文件数量限制
priority: P4
version: 1.11.30
---
# 规范自修复规则（14-self-fix）

> 本文件定义 self-fix 工作流的完整规则，含自动级/Pending级/拒绝级修复分级。

## 修复范围边界（严格）

| 工具 | 修复对象 |
|------|---------|
| self-fix（本工作流）| DevCodex 插件目录下的规范文件（`instructions/` · `skills/` · `prompts/` · `agents/` · `RULES.md`）|
| dev | 源码/配置文件变更 |
| fix | 源码 Bug 修复 |

> 功能性迭代（新增节点、重写架构）→ 路由到 dev 工作流

## 修复文件数量限制
- 单次最多修复 **5 个文件**
- 超出 → 建议拆分为多个会话

## 修复分级

### 自动级（直接修复，白名单 A1~A5）

| 编号 | 类型 | 示例 |
|------|------|------|
| A1 | 数值同步 | 文件数量、编号总数不一致 |
| A2 | 格式修正 | 表格对齐、代码块缺少语言标记 |
| A3 | 缺失字段 | frontmatter 缺少必填字段 |
| A4 | 断链修正 | 内部相对路径链接 404 |
| A5 | 编号修正 | 维度/约束编号排列错误 |

### Pending 级（暂存等待）
- 规范表述/流程/体系变更；新增检查项；修改约束等级
- 当问题**不阻断当前任务**时，记录到问题池 `data/pending-issues.md`，不在当前会话穿插修复
- `data/pending-fixes.md` 继续承载 PC4 / PF 类运行时缺口记录；`data/pending-issues.md` 承载已确认但可批次处理的治理改进项
- Pending 清单消化：
  1. 当 AI 进入 dev 工作流且判断当前任务涉及规范执行路径时，在 CP1 前提示当前问题池积压数量
  2. 当 audit 工作流完成收敛并输出最终报告时，附上当前问题池摘要或数量，提醒用户择期批量处理

### 拒绝级
- 涉及规范语义变更 → 拒绝自动修复，提示用户通过 dev 处理
- 涉及用户确认“未完整吸纳 / 半覆盖 / 仍需吸纳”的规范体系变更时，必须转入 dev / spec-governance 路径，执行 `LayeredAbsorptionGate`、`ConfirmedAbsorptionCompletenessGates` 与必要的 `evolution-governance`，不能按 A1~A5 自动修复处理

## 自动级修复后验证（V1~V7，全通过才算完成）

| 编号 | 验证项 |
|------|--------|
| V1 | 修复前后内容对比（diff 可读） |
| V2 | 被修复文件语法正确（Markdown 结构完整） |
| V3 | 内部链接有效（修复的链接目标存在） |
| V4 | 跨文件引用一致（双向）：① **存在性检查** — grep 本次修改涉及的核心关键词在 `instructions/` 和 `skills/` 全库，确认所有命中文件的相关描述与本次修改一致；不一致者须同步修复。② **缺席检查**（新增字段/术语/机制时必做）— 反向推导"哪些文件按角色应该包含此内容"并逐一确认：Instruction 层（最高权威）/ Skill 层 / prompt 模板层同一概念三层均须覆盖；修改了 Skill 层须确认 Instruction 层是否同步；新增机制须确认所有引用该机制的执行路径文件是否同步。未包含即为遗漏，须同步修复。 |
| V5 | frontmatter 完整（必填字段无缺失） |
| V6 | 编号唯一性（修复后无重复编号） |
| V7 | **规则触发条件写作检查**（新增/修改约束时必做）：规范中所有触发条件的主语必须是 **AI 的内部判断**（如 `当 AI 自检发现...` / `当结论依赖...`），禁止以用户措辞/意图作为触发主语（如 `当用户要求...` / `适用场景：用户说...`）。以用户意图为触发主语会产生关键词依赖，用户换个表达即可绕过规则。 |

## 记录规范问题（T_RECORD / RecordRouter 分支）
- 典型表述："记录这次违规"/"登记一下刚才的问题"/"这个规范要优化"/"以后应该这样做"
- 禁止按关键词直接写 VL；必须先按 `skills/spec-governance/SKILL.md` 识别 `record.violation` / `record.spec-defect` / `record.process-improvement` / `record.pending-issue` / `record.audit-gap` / `record.ambiguous`
- `record.violation` 写入 `data/violations.md`（VL-NNN），`record.spec-defect` 写入 `data/pending-fixes.md`（PF-NNN），`record.process-improvement` 写入 `data/process-improvements.md`（PI-NNN，优化清单），`record.pending-issue` 写入 `data/pending-issues.md`（ISSUE-NNN），`record.audit-gap` 写入 `data/gap-registry.md`（GR-NNN）
- 每次分流必须输出规范化意图、置信度、依据和目标台账；低置信度 `record.ambiguous` 先澄清，不写台账

## 违规登记状态规则
- 临时处置 → 状态 `🔄 处理中`
- 三项同时满足才可标 `✅ 已关闭`：
  1. 问题处置完成
  2. 防复发措施写入对应规范
  3. 后续流程验证生效

## 不进入 self-fix 的场景（防递归）
- 合规检查失败 → 在当前工作流内联修正后重检（**不进 self-fix**）
- 连续 2 次同类偏差 → 升级分析处理（**不进 self-fix**）
