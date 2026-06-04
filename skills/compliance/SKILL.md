---
name: compliance
description: 执行入口检查与 FC/SC/RC/T 合规校验。PC0~PC7 入口检查所有模式启用；仅 dev 模式执行全量合规校验，prod 模式不执行（规范已验证）。chat 豁免合规块。
---
## §0 模式判断（前置，优先执行）

读取由 [`load-profile`](../load-profile/SKILL.md) Skill 注入的 ENV_MODE（参见 [`01-common`](../../instructions/01-common.instructions.md) §ENV_MODE 行为总表）：

| ENV_MODE | 检查策略 |
|----------|---------|
| `prod`（默认）| 不执行合规检查（规范已验证，Instructions 直接指导 AI 行为） |
| `dev` | 全量执行 FC1~FC7 + SC1~SC15 + RC1~RC4 + T1~T9 |

> ⛔ **[S01~S06](../../instructions/00-safety.instructions.md) 安全底线不受 ENV_MODE 影响**，无论 dev/prod 均强制执行；**[S07](../../instructions/00-safety.instructions.md)** 在 instruction-fallback 模式下要求全模式入口检查（致命自修正）。
>
> ⚠️ **入口检查（PC0~PC7）所有模式启用**，收到用户消息后立即执行；dev 模式额外执行 PC4 完整规范雷达，非 dev 模式 PC4 标注 N/A，详见 [`17-compliance.instructions.md`](../../instructions/17-compliance.instructions.md) §入口检查。
>
> ℹ️ ENV_MODE 未注入（profile 未加载）时，默认按 `prod`（不执行合规检查）。

### 🔴 强制可见输出（仅 dev 模式合规块，chat 豁免）

每次回复末尾**必须**输出合规检查状态块：

```
---
🛡️ DEV 模式 | 合规检查
FC: FC1 [✅/❌] FC2 [✅/N/A] FC3 [✅/N/A] FC4 [✅/❌] FC5 [✅/N/A] FC6 [✅/❌] FC7 [✅/N/A]
SC: SC2 [✅/❌] SC4 [✅/❌] SC6 [✅/❌] ...（仅列适用项，逐项实际验证后填写）
整体：✅ 全通过 / ⚠️ <N> 项待修正

📂 本次会话产物：
- [filename (类型)](workspace相对路径/file.md)
---
```

> ⛔ dev 模式下不输出状态块视为未执行合规检查。
> ⚠️ **FC5 填写规则**：必须在回复末尾的 `📂 本次会话产物` 区块内列出 `ArtifactLinkSet`（详见 [`02-output-paths`](../../instructions/02-output-paths.instructions.md) §产物路径输出格式）；主链接必须是 Markdown 链接，当前宿主为 Codex Desktop/App、Copilot、未知宿主，或用户反馈无法点击时，必须追加 `绝对路径：` copy fallback；禁止只输出裸文件名。本轮无文件变更时填 N/A，有变更时不得填 ✅ 而不列出路径。
> ℹ️ prod 模式不执行合规检查，不输出状态块。
> ℹ️ chat 工作流豁免此输出。

### 全自动模式差异

> 显式 `@devcodex-auto` 或明确自然语言 auto 授权模式下：

仅在 `hook-enforced` 宿主 + 白名单路径下，FC/SC 失败时自动修正（不暂停等待用户），但 [S01~S06](../../instructions/00-safety.instructions.md) 仍阻断。

`instruction-fallback` 宿主（如 JetBrains / Cursor）仅保留 auto 规则语义，不承诺 runtime 级自动行为；支持 Hook 的宿主默认采用 `safety-only`，非白名单路径输出提醒并放行，`strict` 模式下才按白名单执行 runtime 硬拦截，因此其“自动”更多体现为路径受限的 hook 提醒/门禁策略。

## §1 输出验证（每条建议/方案/问题必须附）

| 验证项 | 说明 |
|--------|------|
| 合理性 | 为什么要这样做？依据是什么？ |
| 可实施性 | 能否落地执行？是否有前置条件？ |
| 收益 | 执行后带来什么改善？ |

附加标注（每条还须标注）：

| 属性 | 说明 |
|------|------|
| 验证状态 | `✅已验证`（实际读取了源文件确认）或 `⚠️待验证`（基于推测/上下文推断） |
| 影响范围 | 涉及哪些文件/模块（一句话描述） |

若报告或用户面输出包含多个可执行建议、多个后续路径、方案对比或决策点，必须额外给出 `推荐结论` / `推荐方案`，且推荐理由可追溯到五项验证；无后续动作时写明 `推荐：无后续动作`。

## §2 形式合规（FC）— 不通过立即修正后重检

| # | 检查项 |
|:-:|--------|
| FC1 | 记忆文件完整（必填字段齐全，状态 🔄/✅；📨 对话记录必须为四列表格格式：`轮次 \| 👤 用户消息 \| 🤖 AI执行 \| 状态`，三列或项目符号格式不通过） |
| FC2 | 报告文件已写入（chat 豁免） |
| FC3 | CP 按序执行（dev/fix；其他 N/A） |
| FC4 | 文件名/路径合规（`NN--` 双横杠开头） |
| FC5 | 产物路径已输出（回复末尾在 `📂 本次会话产物` 区块内列出 `ArtifactLinkSet`：Markdown 链接 + 必要 `绝对路径：` copy fallback，见 `02-output-paths.instructions.md` §产物路径输出格式）|
| FC6 | 新建 .md 行数检查（超 500 行须拆分 [C13](../../instructions/01-common.instructions.md)） |
| FC7 | 用户决策选项与报告决策点必带推荐 + 理由：所有 AskUserQuestion / 多选项呈现 / CP 选项 / 方案对比 / analyze-audit 报告决策点必须有且仅有 1 个推荐项，推荐项置首且说明推荐理由；无后续动作时写明 `推荐：无后续动作` |

## §3 实质合规（SC）— 🔴 阻塞性

| # | 检查项 | 适用范围 |
|:-:|--------|---------|
| SC1 | 报告验证列完整（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围五项） | 全工作流 |
| SC2 | 代码已诊断（无未处理 error） | dev/fix 🔴；其他 N/A |
| SC3 | 修复已全局扫描（三步扫描：同类全局+数据联动+grep零残留） | fix 🔴；dev(重构) 🔴 |
| SC4 | 关联文件已同步 | dev/fix/self-fix 🔴 |
| SC5 | 后续建议与推荐结论已输出（报告含 `## 后续建议` / `## 推荐结论` / `## 推荐方案` 或等效内容；无待跟进时显式标注“推荐：无后续动作”即通过） | 全工作流 |
| SC6 | Agent SUMMARY 已更新（`.memory/clients/<agent>/SUMMARY.md`） | 全工作流 🔴 |
| SC7 | 全局 SUMMARY 关键决策已追加（仅规范变更/架构决策/P0修复） | 有关键决策时 🔴 |
| SC8 | 上次待跟进已查阅（首次会话 N/A） | 全工作流 🔴 |
| SC9 | [C08](../../instructions/01-common.instructions.md) Token 防护状态（>10轮关注 / >13轮预警 / >15轮防护） | 全工作流 |
| SC10 | [C07](../../instructions/01-common.instructions.md) 串行 Agent 执行（禁止并行启动多 Agent） | 涉及 Agent 调用 🔴 |
| SC11 | [C14](../../instructions/01-common.instructions.md) 多任务拆分检查（≥5任务需建议拆分会话） | 任务≥5时 🔴 |
| SC12 | [C14](../../instructions/01-common.instructions.md) 多任务进度快照验证（每完成子任务有 T{N}进度 标记） | 任务≥2时 🔴 |
| SC13 | [C15](../../instructions/01-common.instructions.md) 架构质量自检（dev plan-review 三维评估；fix CP2 三维评估） | dev/fix 🔴 |
| SC14 | analyze/audit 工作流中，所有标注 ✅已验证 的运行时结论（测试通过率/性能数字/命令输出）均已在**本轮实际执行**对应命令；SUMMARY.md 或记忆文件中的历史数字不得直接用作 ✅已验证，必须降级为 ⚠️待验证 | analyze/audit 🔴 |
| SC15 | dev/fix 关键产物已完成 ECR 执行闭环复审：覆盖 CP1/CP2/CP3、实施进度（触发时）、ExecutionContract/TestRoute/ReleaseAudit/ReleaseVerification（触发时）、报告、daily tasks、SUMMARY、diff/commit、测试/扫描证据、dirty 边界；最后一次阻断性修正后至少再复审 1 轮且无新增阻断性问题 | dev/fix 🔴 |

## §4 恢复性检查（RC）— 非阻塞

> **豁免**：chat 豁免全部合规检查；analyze 豁免 RC 层（只读工作流，多轮收敛但每轮不写恢复性记忆）。

| # | 检查项 |
|:-:|--------|
| RC1 | 记忆文件是否足以让下一个 Agent 恢复上下文；跨会话/多批次/summary/compact/handoff 场景是否已有 `ContextHandoffCard` |
| RC2 | 已产出文件是否自洽完整 |
| RC3 | 🔄 标记任务是否提供了足够恢复线索 |
| RC4 | 关联需求的 `.memory/sessions.md` 是否已创建 |

## §5 报告二次验证（报告写入后执行）

### 🔴 阻塞性验证

| # | 检查项 |
|:-:|--------|
| V1 | 每条问题有文件来源（文件名+行号/章节） |
| V2 | 验证列+标注完整（回读报告文件确认） |
| V3 | ✅已验证 的问题确实读取了对应文件 |
| V4 | 纯推测性问题已标注 ⚠️待验证 |
| V5 | 每条 🔴 级问题通过反向质疑三问（不修复的具体后果/是否有意设计/风险可否接受） |

### V5 反向质疑三问

逐条对 🔴 级问题执行：
1. 不修复会导致什么**具体的**功能异常？→ 答不出 → 降级
2. 是否可能是**有意的设计选择**？→ 有可能 → 验证意图后再定级
3. 不修复的风险是否**可接受**？→ 可接受 → 降级为 🟡 或 💡

### 🟡 改进性验证

| # | 检查项 |
|:-:|--------|
| V6 | 🔴 级占总问题数超 1/3 时，触发"分级标准是否过严"自检 |

## §6 任务完成验证

| # | 检查项 |
|:-:|--------|
| T1 | ✅ 需求覆盖（用户所有需求点已处理） |
| T2 | ✅ 报告存在（chat 豁免） |
| T3 | ✅ 记忆完整（任务摘要+对话记录+关联报告） |
| T4 | ✅ CP 完整（dev/fix；其他 N/A） |
| T5 | ✅ 合规通过（FC+SC 全通过） |
| T6 | ✅ 约束遵守（C01~C22 + 关联文件已同步） |
| T7 | ✅ 工作流验证（dev/fix: 扫描/验证 + ECR 已执行；audit/analyze: PCV 与推荐结论已执行）|
| T8 | ✅ SUMMARY 已更新；若触发上下文交接，daily tasks 或报告已写 `ContextHandoffCard` |
| T9 | ✅ 产物路径已输出 |

## §7 自修复触发

| 触发条件 | 处理方式 |
|---------|---------|
| FC/SC 检查不通过 | 立即修正后重检（FC+SC 累计修正 ≥5 次仍未全通过 → 停止循环，输出剩余失败项摘要标 ⚠️，写入记忆后交由用户决策） |
| 连续 2 次同类偏差 | 升级分析（追加记忆 `⚠️连续违规` + 报告增加「规范偏差分析」章节）；**不自动进入 self-fix**（防递归） |
| 文件路径不符合 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md) | 立即停止创建，迁移到正确路径 |
| 规范文件修改后引用未同步 | 交叉验证后修正 |

