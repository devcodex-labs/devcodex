---
agent: agent
description: 输出会话头部信息（时间、意图、项目、记忆路径），每次会话开始时使用
applyTo: "**"
---
# 会话状态预检

输出当前会话的头部信息，格式如下：

## 全模式入口检查（推荐格式）

```markdown
---
🔍 入口检查（[DEV/PROD] 模式）
- PC0 上下文：项目 [项目名/未识别] · 输出语言 [中/英] · ContextReadPlan [✅已形成/⚠️降级] · 必要来源回执 [✅verified/⚠️partial/❌missing]
- PC1 意图：语义初判 [用户意图] → 项目现实扩展后 [工作流名称/子类型]
- PC2 会话状态：第 N 轮（>10 关注 / >13 预警 / >15 防护） · 待跟进事项 ✅ 无 / ⚠️ [简述]
- PC3 执行准备：项目现实扩展 [已完成/待澄清] · 未完成任务 ✅ 无 / ⚠️ 存在 🔄 会话：[简述] → 建议先 resume · 产物落点 [已确定/无需产物/待确定]
- PC4 规范雷达：[Axis A ✅/⚠️] [Axis B ✅/⚠️] [Axis C ✅/⚠️]
  → ✅ 三轴正常，无规范问题
  → ⚠️ PF 标记（G1）：[简述规范缺陷] · 延迟追加 pending-fixes.md
  → ⚠️ PF 标记（G4, G7）：[简述] · 延迟追加（多轴并列时，用逗号分隔 G 码，跨轴分行）
  → VL 标记：[简述执行偏差] · 延迟追加 violations.md
  → ⚠️ 疑似 PF：[简述疑点] · 待用户确认后追加
  → N/A（非 dev 模式：dev 扩展诊断未启用）
- PC5 部署体状态（v1.11.0+）：cwd 父链 `.github/`、`.claude/`、`AGENTS.md`、`.agents/`、`.codex/` ✅ 存在 / N/A 无父级 · 与源仓库同步 ✅ / ⚠️ [N 文件滞后] / N/A
- PC6 工作区一致性（v1.9.4+）：git 未提交变更 ✅ 无 / ⚠️ [N 文件 dirty] · 当前任务目录 [requirements/<X>/ / bugs/<Y>/ / 无关联]
- PC7 新会话首步 resume 强制检测（v1.9.4+，仅首条用户消息触发）：✅ `memory_status` + 有界 session/SUMMARY query 回执一致 / ⚠️ 数据不一致或证据不足需处理 / N/A（非首条）
```

## chat / prod 模式

- chat：仍必须输出入口检查块；仅豁免 FC/SC/RC/T 合规状态块和报告写入
- prod：输出 PC0~PC7 基础入口检查；PC4 标注 N/A（dev 扩展诊断未启用）

## 填写规则

- 项目：通过 `load-profile/SKILL.md` 确定，无法识别时写“未识别”
- 输出语言：根据用户消息主要语言判断
- 意图：先通过 `intent/SKILL.md` 做语义初判，再结合已加载 Profile、项目目录、当前需求上下文执行项目现实扩展；扩展后如需修正路由，应在 PC1 明示修正结果
- 非 chat 工作流：在 CP1 / 问题确认前形成 Intent Expansion Card（semantic、project、continuity、action、domain、artifact-impact、risk、host-capability、validation-route、confidence、alternatives），用于 PC1/PC3 与压缩恢复复核；dev 模式默认向用户展示完整 Card
- 意图扩展摘要：若扩展后路由变化、命中控制面/宿主差异、风险不为 normal、confidence 非 high 或跨会话 resume，且当前不是 dev 模式完整 Card 展示场景时，入口检查后、CP1/问题确认前追加 3~5 行用户可见摘要；只写语义初判、扩展后路由、关键风险、验证路线、备选路径
- Context Rehydration Contract：压缩恢复、summary 恢复或用户要求按文件真相重建时，按“当前用户消息 → 已确认产物 → sessions → tasks → SUMMARY → 摘要 → AI 推断”的优先级重建上下文
- ContextHandoffCard：跨会话、跨 Agent、多批次、summary/compact 前或用户要求“传递上下文”时，由交接方输出 source-of-truth / confirmed-decisions / open-risks / next-action / must-not-overwrite / validation-state / artifact-links；恢复方仍按 Context Rehydration Contract 核对文件真相源
- 待跟进事项：来自记忆中的 `⚠️ 待跟进`
- 产物落点：仅输出状态（已确定 / 无需产物 / 待确定），不要直接输出内部 filePath
- PC0：与 `instructions.md` / `17-compliance.instructions.md` **同源**：写 ContextReadPlan + 必要来源回执，**禁止**再用「Profile ✅ 已加载」单字段冒充上下文完整
- PC5~PC7：与 `instructions/17-compliance.instructions.md` 保持一致；无法执行时必须标注 N/A 或 ⚠️ 原因，禁止省略
- 若主动建议或因 C08 要求新会话：同回复附 `NewSessionContinuationCard`（可复制启动文本）；长任务在记忆/报告记 `SessionTimingCard`（开始/结束/阶段，等人与执行分列）
