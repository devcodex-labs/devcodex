---
agent: agent
description: 输出会话头部信息（时间、意图、项目、记忆路径），每次会话开始时使用
applyTo: "**"
---
# 会话状态预检

输出当前会话的头部信息，格式如下：

## 全模式入口检查（推荐格式）

```markdown
### DevCodex · 入口检查
`[PASS/WARN/BLOCK/UNVERIFIED]` · `[项目名/未识别]`

- PC0 [状态] ContextReadPlan 与必要来源回执
- PC1 [状态] 语义初判 → 项目现实扩展后的最终路由
- PC2 [状态] 会话/Token 防护/待跟进
- PC3 [状态] 唯一项目、任务连续性与产物落点
- PC4 [状态] dev 规范雷达 group/owner/validation；非 dev 为 N/A
- PC5 [状态] 当前宿主部署、同步与实际加载证据
- PC6 [状态] git dirty、active task 与工作区一致性
- PC7 [状态] 新会话/resume 的 bounded continuation 检测

下一步：[必要动作]

`DevCodexVisibleEnvelopeV1 · entry-check · [状态] · [semanticDigest]`
```

## chat / prod 模式

- chat：仍必须输出入口检查块；仅豁免 FC/SC/RC/T 合规状态块和报告写入
- prod：输出 PC0~PC7 基础入口检查；PC4 标注 N/A（dev 扩展诊断未启用）

## 填写规则

- **时序（S07）**：本入口检查块必须作为**用户首次可见**内容先于实质正文；**禁止**先写报告/记忆/台账等产物 mutation，再在最终回复文首补 PC（文首补丁 ≠ 合规）
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
- PC5 部署面必须显式覆盖 `.github/`、`.claude/`、根 `AGENTS.md`、`.agents/` 与 `.codex/`；只检查某一宿主副本不得写“全部同步”
- PC7 新会话首步 resume 强制检测：新任务、compact/summary 恢复或 `继续<任务名>任务` 首次响应必须重建 bounded continuation，并核对文件真相源后再继续
- 先用 `user-visible-output-contract` 形成完整 Envelope，再渲染为 rich/portable/plain；状态词固定为 PASS/WARN/BLOCK/UNVERIFIED/N/A
- 新会话、resume/compact、target/intent/risk/CP/dirty/receipt 变化或存在 WARN/BLOCK/UNVERIFIED 时必须 expanded；同 epoch + semanticDigest 不变且全 PASS/N/A 才可 compact，compact 仍保留 PC0~PC7
- 若主动建议或因 C08 要求新会话：同回复附内部完整 `NewSessionContinuationCard`，用户可复制入口固定为 `继续<displayName>任务`；长任务在记忆/报告记 `SessionTimingCard`（开始/结束/阶段，等人与执行分列）
