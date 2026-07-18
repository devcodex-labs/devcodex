---
name: intent
description: 识别用户意图类型（dev/fix/analyze/audit/self-fix/chat/resume/other），采用前置识别 + 三问法。Free 层可用。
---
## 前置识别（优先于三问）

| 检查 | 条件 | 意图 |
|------|------|------|
| 是否按任务名恢复？ | 完整消息符合 `继续<任务名>任务` 或 `继续 <任务名>` | 先调用 `memory_task_resolve`；仅 `resolved-active` 进入 `resume`，其余状态按最小消歧/完成说明/stale CP 处理 |
| 是否恢复中断？ | 用户说"继续"/"恢复"，**且**今日/昨日任务文件（daily file）中存在状态为 🔄 的会话（SUMMARY 索引表的状态列不作为判断依据，见 `15-memory` §新会话 🔄 检测）| `resume` → 直接路由，跳过三问 |
| 是否纯问答？ | 仅提问/求解释，无文件变更或任务执行意图 | `chat` → 直接路由，跳过三问 |

### chat 子类标签（仅用于回答策略，不新增工作流）

当消息已命中 `chat` 时，进一步区分以下两类常见说明意图：

| 标签 | 条件 | 默认处理 |
|------|------|---------|
| 规范说明类 | 用户追问规则来源、判断依据、为什么这样设计 | 先正面解释规则层依据，不默认贴完整原文/路径/编号清单 |
| 规范改进类 | 用户追问规范如何提升、还能怎么优化、下一步改进什么 | 先正面讨论改进方向；若用户要落地变更，再转 dev 立项 |

> ⚠️ 上述两个标签只是 `chat` 下的回答策略辅助标签，不是新的顶层工作流。
> ⚠️ 面向用户的默认输出场景下，仍应优先用自然语言解释；仅在回答确有必要时才最小化展开内部细节。
> ℹ️ 项目内 `dev` 模式下的规范优化、规则提升与实现讨论，不因这两个标签增加额外限制。

> 两项均为否 → 进入三问判断。

### TaskContinuationIntentGate

任务名续接只把名称当定位键，不把名称、Hook 命中或派生索引当作状态真相。匹配顺序固定为 stable taskId → active displayName exact → active alias exact → completed/rejected exact；相似名称只返回最多 5 个建议，禁止 fuzzy 自动命中。`resolved-active` 后仍须按 `task.json → sessions.md → 当前绑定产物/checkpoint` 定向复水化并复证 CP digest；`ambiguous / not-found / completed / rejected / stale-confirmation / scale-blocked` 不得进入任务执行。

## 三问判断法

> ⛔ 意图识别基于用户消息的**语义目的**，不依赖关键词匹配。

| 问题 | 指向变更 | 指向分析 |
|------|---------|---------|
| Q1：最终目的是产生变更（代码/配置/规范文件），还是获得结论/报告？ | 变更 | 结论 |
| Q2：分析是手段（为了执行变更）还是目的（为了得出结论）？ | 手段 | 目的 |
| Q3：是否需要修改/创建/删除任何文件（含源码与规范文件）？ | 是 | 否 |

**三问结论**：
- 任一指向变更 → 检查是否满足 self-fix 条件 → 满足则 `self-fix`；否则 `dev` 或 `fix`
- 三问全指向分析 → 区分 `analyze` vs `audit`

## 意图类型路由

| 意图 | 说明 |
|------|------|
| `dev` | 新功能开发、重构、优化、迁移 |
| `fix` | Bug 修复、报错处理 |
| `analyze` | 多轮收敛分析，≥3 轮，输出结论（analyze）|
| `audit` | 多轮深度审查，≥3 轮，直至收敛 |
| `self-fix` | 规范文件自修复 |
| `chat` | 问答、解释（无文件变更）|
| `resume` | 恢复上次中断的任务 |
| `other` | 不匹配上述任何意图 → plan 工作流 |

## 项目现实扩展衔接

意图识别分两层输出：

1. **语义初判**：仅基于用户消息和当前对话，判断用户最终目的。
2. **项目现实扩展后最终路由**：在目标项目已确定、Profile 已加载后，结合项目技术栈、目录结构、当前需求/bug 产物、测试与发布约束，确认是否需要修正工作流或子类型。

约束：

- 项目未确定前，不得为了“扩展意图”发起超出当前明确文件范围的工作区扫描。
- 若项目现实扩展推翻语义初判，应在 PC1 中写清“语义初判 → 最终路由”的变化。
- 若扩展发现这是多项目或跨服务任务，应先标注边界与入口项目，再决定是否需要加载关联服务 profile。

### Intent Expansion Card

非 chat 工作流在 CP1 / 问题确认前输出或写入可审查的 Intent Expansion Card，避免压缩恢复后只剩模糊摘要。

- dev 模式默认向用户展示完整 Card；prod、instruction-fallback 宿主或低风险轻任务可退化为 3~5 行摘要。
- 压缩恢复、resume 或用户明确要求“按文件真相重建”时，必须先按文件真相源重建 Card，再决定最终路由。

| 字段 | 说明 |
|------|------|
| `semantic` | 用户字面语义初判 |
| `project` | 目标项目与 active-root |
| `continuity` | 是否延续现有 requirement/bug/session |
| `action` | 最终工作流与子类型 |
| `domain` | 受影响模块/领域 |
| `artifact-impact` | source/config/docs/memory/report/deployment 等影响面 |
| `risk` | destructive/security/high-risk/normal |
| `host-capability` | 是否涉及宿主能力差异及降级边界 |
| `validation-route` | test/lint/typecheck/validate/direct replay/官方文档 |
| `confidence` | high/medium/low |
| `alternatives` | 被排除路线及原因 |

## IntentConsistencyGuard-lite

当用户消息准备触发确认、继续或阶段转换时，先由语义路由得到 `semanticAction/confidence`，再使用 `IntentConsistencyInputV1 → IntentConsistencyDecisionV1` 核对显式状态证据；不得让本 Guard 用关键词替代语义识别。机器可执行真相源为 `scripts/lib/intent-consistency.js`。

证据优先级固定为：`user-current > confirmed-requirement-or-proposal > phase > route-hint > history`。`confirm/continue` 必须同时绑定当前 `proposalRef` 与 `requirementRef`；“确认 / 继续 / yes / ok”等短确认只有在引用唯一且 phase/requirement 匹配时才能返回 `matched`。

| 场景 | status | errorCode | 处理 |
|---|---|---|---|
| refs/phase/confidence 一致 | `matched` | `null` | 允许进入已确认转换 |
| proposal 或 requirement 状态缺失 | `clarify` | `INTENT_STATE_MISSING` | 恢复当前引用后重新确认 |
| requirement 不匹配 | `blocked` | `INTENT_REQUIREMENT_MISMATCH` | 重载 active requirement |
| phase 不匹配 | `blocked` | `INTENT_PHASE_MISMATCH` | 返回预期阶段或刷新阶段证据 |
| confidence 低于执行阈值 | `clarify` | `INTENT_LOW_CONFIDENCE` | 澄清语义，不猜测转换 |

`routeHints/historyRefs` 可作为 `ignored` 解释证据，但不得覆盖当前用户消息或已确认产物。该合同只返回 decision，不自行写 CP state、需求文件或 Hook 状态。

## analyze vs audit 区分

| 维度 | analyze | audit |
|------|---------|-------|
| 过程类型 | 多轮收敛分析（≥3 轮，连续 2 轮无新发现后收敛）| 多轮深度审查，直至收敛 |
| 结束条件 | 最少 3 轮，连续 2 轮无新发现；轮末输出收敛状态 | 连续 3 轮有效零发现（仍须满足连续 3 轮零发现，并核验 `ReviewCoverageDelta`；不区分定向/全面，见 `12-audit §多轮收敛规则`）|
| 典型表述 | "分析/看看/评估/对比/解读" | "深度审查/全面体检/逐项检查/走查" |

**边界词处理**："检查"/"review"/"评审" 倾向 audit，但以**覆盖范围和收敛期望**为准。

## dev vs fix 区分

| 维度 | dev | fix |
|------|-----|-----|
| 动机 | 主动改进（新增/重构/优化/迁移） | 被动修正（Bug/报错/回归）|
| 判断标准 | 系统当前行为正确，但需要扩展或改进 | 系统当前行为不正确，需要恢复 |

> 仍然模糊时，优先按 fix 路由（fix 流程含根因分析 CP1，分析后若实际需要新功能可重路由到 dev）

## self-fix 识别标准

| 条件 | 说明 |
|------|------|
| 修改对象 | DevCodex 插件目录下的规范文件（`instructions/` · `skills/` · `prompts/` · `agents/` · `RULES.md`）|
| 修改动机 | 修复规范内部不一致、错误、缺失（非功能迭代、非新增）|

**特殊场景——治理记录评估**（T_RECORD 分支）：
- 每条非空用户消息都先登记中性 candidate；是否进入 T_RECORD 必须在合理性评估、项目现实扩展和上下文归因后按语义决定。固定措辞或关键词只能帮助检索，不能触发、分类或免除评估。
- 决策归一为：`record.violation`、`record.spec-defect`、`record.process-improvement`、`record.pending-issue`、`record.audit-gap`、`record.none`、`record.ambiguous`；同一消息允许多个实质意图并存。
- 写入目标由 `skills/spec-governance/SKILL.md` 的 RecordRouter 决定：VL/PF/PI（优化清单）/ISSUE/GAP 或不写台账；复合意图必须逐项 all-of 验证。
- 每次评估输出完整 `GovernanceIntakeDecision`；`record.none` 执行 `RecordNoneChallengeGate`，`record.ambiguous` 保持未终结并先澄清。

## 多任务检测（强制）

用户消息含 ≥2 个独立任务时：
1. 列出识别到的各任务
2. 建议拆分为顺序执行
3. 用户不同意 → 按用户指定顺序
4. 用户未明确反对 → **立即开始第一个任务**（无需额外等待确认）

`ConcurrencyPolicy` 只放开前置只读识别、文件搜索和隔离分析的并发；多个独立任务的正式工作流、CP 状态、报告、记忆和台账写入仍按顺序推进，不能并行提交共享状态。

> ℹ️ C14：任务数≥5 时，建议用户拆分会话执行

## 多任务摘要隔离（强制）

若记忆中同时存在 ≥2 个不同项目/任务的活跃 CP 状态，收到新消息时：
① 根据消息内容显式判断属于哪个任务
② 对该任务独立重新执行三问判断
③ **禁止**将任务 A 的工作流类型或 CP 状态继承应用到任务 B
