---
agent: agent
description: 输出会话头部信息（时间、意图、项目、记忆路径），每次会话开始时使用
applyTo: "**"
---
# 会话状态预检

输出当前会话的头部信息，格式如下：

## 全模式入口检查（推荐格式 · UserVisibleReplyLayoutV1 · 六宿主同源）

```markdown
### DevCodex · 入口检查
`[PASS/WARN/BLOCK/UNVERIFIED]` · `[项目名/未识别]`

| 项 | 内容（人话；禁止进度缩写） |
|----|----------------------------|
| PC0 | 版本：已安装 package version · 活动 runtime generation · 当前配置 runtime generation · 是否需要重启 · 可选源码候选 `{packageVersion, shortHead, dirty}` · alignment |
| PC1 | 意图：语义初判 → 项目现实扩展后的最终路由/工作流 |
| PC2 | 会话：轮次/Token · 待跟进 |
| PC3 | 执行准备：唯一项目 · 连续性 · 产物落点（禁止「写报告 02」式施工日志） |
| PC4 | 规范雷达：dev 完整；非 dev=`N/A` + skipReason |
| PC5 | 宿主：名称 + Full/Partial · 部署/同步证据（legacy 诊断可覆盖 `.github/`、`.claude/`、根 `AGENTS.md`、`.agents/`、`.codex/`；GlobalOnly 以 doctor/receipt 为准） |
| PC6 | 工作区：git dirty 范围 · 任务目录 |
| PC7 | 续接：新会话/resume 有界检测 |
| PC8 | 流程与方案：初判/二次判断的 ceremonyTier、designDepth 及差异原因 |
| PC9 | 验证计划：assuranceLevel · targeted/affected/full 数量 · CI/package/install/release · 预计时长 |
| PC10 | 后续动作：下一阶段 · 是否自动继续 · 用户当前动作 · 如何修正判断 |

下一步：[仅当存在已核实的主动作时输出一句人话；否则省略]
```

机器字段（`PostCompletionActionSetV1`、`semanticDigest`、Envelope marker、内部检查 ID）保留在结构化/audit 投影中；默认人类响应不输出。只有显式请求审计视图时才附机器 marker。

## chat / prod 模式

- chat：仍必须输出入口检查块；仅豁免 FC/SC/RC/T 合规状态块和报告写入
- prod：输出 PC0~PC10 基础入口检查；PC4 标注 N/A（dev 扩展诊断未启用）

## 填写规则

- **时序（S07）**：本入口检查块必须作为**用户首次可见**内容先于实质正文；**禁止**先写报告/记忆/台账等产物 mutation，再在最终回复文首补 PC（文首补丁 ≠ 合规）
- 项目：通过 `load-profile/SKILL.md` 确定，无法识别时写“未识别”
- 输出语言：先将当前任务/会话携带的 `LanguageContextV2` 显式传入入口 composer 和可见输出 renderer，再使用其中的任务主语言渲染固定标题、表头、操作词与回退说明；yes/no、确认码、路径、版本、代码和引用文本不得切换任务主语言。载体缺失或目标语言暂无目录时必须显式说明回退原因，禁止静默改成英文
- 意图：先通过 `intent/SKILL.md` 做语义初判，再结合已加载 Profile、项目目录、当前需求上下文执行项目现实扩展；**项目现实扩展后**如需修正路由，应在 PC1 明示修正结果
- 非 chat 工作流：在 CP1 / 问题确认前形成 Intent Expansion Card（semantic、project、continuity、action、domain、artifact-impact、risk、host-capability、validation-route、confidence、alternatives），用于 PC1/PC3 与压缩恢复复核；dev 模式默认向用户展示完整 Card
- 意图扩展摘要：若**项目现实扩展后**路由变化、命中控制面/宿主差异、风险不为 normal、confidence 非 high 或跨会话 resume，且当前不是 dev 模式完整 Card 展示场景时，入口检查后、CP1/问题确认前追加 3~5 行用户可见摘要；只写语义初判、扩展后路由、关键风险、验证路线、备选路径
- Context Rehydration Contract：压缩恢复、summary 恢复或用户要求按文件真相重建时，按“当前用户消息 → 已确认产物 → sessions → tasks → SUMMARY → 摘要 → AI 推断”的优先级重建上下文
- ContextHandoffCard：跨会话、跨 Agent、多批次、summary/compact 前或用户要求“传递上下文”时，由交接方输出 source-of-truth / confirmed-decisions / open-risks / next-action / must-not-overwrite / validation-state / artifact-links；恢复方仍按 Context Rehydration Contract 核对文件真相源
- 待跟进事项：来自记忆中的 `⚠️ 待跟进`
- 产物落点：仅输出状态（已确定 / 无需产物 / 待确定），不要直接输出内部 filePath
- PC0：必须区分已安装包、当前进程加载的 active runtime generation、宿主回执中的 configured runtime generation 与可选源码候选；active/configured 不一致时写 `runtime-mismatch` 并用人话明确“需要重启”及原因。只有可证明同一构建身份时才写 `aligned`，仅版本相同写 `version-only`，源码 dirty/版本领先写 `source-ahead`，证据不足写 `unverified`
- PC 表必须**分列 PC0~PC10**（表格或列表）；禁止折叠区间；单元格写人话，禁止施工进度缩写
- PC5~PC7：与 `instructions/17-compliance.instructions.md` 保持一致；无法执行时必须标注 N/A 或 ⚠️ 原因，禁止省略
- PC5 部署面：GlobalOnly 优先 doctor/receipt；legacy 父链诊断须能覆盖 `.github/`、`.claude/`、根 `AGENTS.md`、`.agents/` 与 `.codex/`（只检查某一宿主副本不得写「全部同步」）；须写当前宿主 Full/Partial 诚实上限
- PC7 新会话首步 resume 强制检测：新任务、compact/summary 恢复或 `继续<任务名>任务` 首次响应必须重建 bounded continuation，并核对文件真相源后再继续
- PC8 使用唯一 `WorkflowPlanDecisionV1`：优先级固定为“用户当前任务明确意图 > `workflowRouting` 配置 > 智能识别 > 回退”；流程仪式、方案深度和验证等级三个轴独立，不得互相推导。首次根据 prompt/config 初判，完成有界项目读取后二次判断；只有真实范围扩张才进行第三次判断
- PC9 必须写清本轮定向/受影响/全量验证数量以及 CI、package、install、release 是否进入计划；不得把“发布后安装验证”默认加入普通修复
- PC10 必须说明接下来会走哪些阶段、是否自动继续、用户现在是否需要动作以及一句可直接覆盖错误判断的修正提示
- 六宿主（Copilot / Claude Code / Codex / Gemini / Grok / Cursor）共用本模板；Grok 无 inject、Cursor Cloud 无用户级 Hook 时仍由模型输出本块
- 先用 `user-visible-output-contract` 形成完整 `EntryCheckModelV3` 和 `DevCodexVisibleEnvelopeV3`，再用同一 `LanguageContextV2` 分别渲染 rich/portable/plain；默认 `audience=human`，以人类可读结论为主并隐藏机器 marker/内部 ID，`audience=audit` 才输出完整机器证据。两种投影必须共享同一语义摘要；`DevCodexVisibleEnvelopeV1/V2` 仅兼容读取，状态词固定为 PASS/WARN/BLOCK/UNVERIFIED/N/A
- 新会话、resume/compact、target/intent/risk/CP/dirty/receipt 变化或存在 WARN/BLOCK/UNVERIFIED 时必须 expanded；同 epoch + semanticDigest 不变且全 PASS/N/A 才可 compact，compact 仍保留 PC0~PC10；`showPlan=false` 也不得省略 PC8~PC10
- 若主动建议或因 C08 要求新会话：同回复附内部完整 `NewSessionContinuationCard`，用户可复制入口固定为 `继续<displayName>任务`；长任务在记忆/报告记 `SessionTimingCard`（开始/结束/阶段，等人与执行分列）
