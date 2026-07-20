# 设计理念

> DevCodex 的设计原则——为什么这样构建，而不是另一种方式。

---

## 核心哲学：AI 需要约束才能可靠

未经约束的 AI 是不稳定的——相同的问题，不同会话可能得到完全不同的结果。DevCodex 的核心思想是：**给 AI 加上工程约束，让它的行为像一个可预期的系统，而不是一个随机的黑盒。**

这套约束通过三个机制实现：

| 机制 | 作用 |
|------|------|
| CP 确认节点 | 每个阶段的输出必须经过人工确认，AI 不能自行推进 |
| 合规检查 | 分层验证 AI 是否遵守安全、流程和收尾闭环约束 |
| 记忆系统 | 跨会话持久化上下文，让 AI 知道"之前做了什么" |

---

## CP 确认哲学：人在循环（Human-in-the-Loop）

软件开发中，AI 最容易出错的不是执行，而是**理解**——理解需求、理解方案、理解影响。

CP 流程（CP1 需求确认 → CP2 方案确认 → CP3 实施确认）的设计原则是：

- **AI 提议，人确认**：AI 输出理解和方案，人判断是否正确
- **每个阶段独立**：需求理解不代表方案正确，方案正确不代表实施计划合理
- **不可跳过**：单次跳过会导致后续所有阶段建立在错误假设上，代价远高于多等一轮确认

Auto v1.1（`@devcodex-auto`、全局默认 `@rocky`、Profile `extensions.devcodex.autoAliases` 替换别名，或明确自然语言 auto 授权）并不是"去掉约束"。它只在 **hook-enforced 或具备等价 PreTool 硬门禁** 的宿主里，对治理文件、文档、`.devcodex/` 产物、README 与 auto 专属回归脚本等白名单路径自动推进；配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；模糊提及、询问 auto 规则、未生效昵称或普通“继续”不算授权；非白名单源码路径默认回确认模式，安全底线始终有效。

**宿主诚实分列（Auto）**：

| 宿主 | Auto runtime 保证 |
|------|-------------------|
| Claude Code（hooks 齐全） | 可宣称 hook-enforced 白名单自动推进 |
| Codex（hooks 齐全） | 事件依赖的 hook guardrail；PreTool 等可硬拦 |
| Grok Build | **仅 PreToolUse 可硬拦**；无 UserPromptSubmit 注入/Stop 硬拦。Auto 语义保留，但 **不得** 宣称与 Claude 同级 hook-enforced 全自动；Full 会话用 `devcodex grok`。详见 [Grok 与 Codex 对齐](/intro/host-parity-grok) |
| JetBrains / 纯 instruction-fallback | 只同步规则语义，无 runtime 硬自动 |

---

## 合规检查：AI 对自身行为的自检

合规检查（SC/FC/RC）是 DevCodex 对 AI 自身行为的强制验证，不是对用户代码的生产合规检查。

它检查的问题包括：
- AI 是否执行了三步扫描（fix 工作流）？
- AI 新建的 DevCodex 规范资产 `.md` 是否超过 500 行限制？业务需求、技术方案、报告和正式项目文档是否按可读性与项目规范拆分？
- AI 是否在 dev 后运行了 lint/typecheck？
- 报告、记忆、审计是否已经完成闭环？

在主流程层面，合规检查更适合拆成两层：

- **执行阶段合规检查**：检查 workflow 执行过程是否完整、是否遵守阶段规则
- **完成前合规检查**：检查报告、记忆、审计与完成状态是否真正闭环

合规检查本质是一套**工作流执行质量保证 + 会话收尾闭环确认**机制，保证每次 AI 的工作过程完整、可追溯、可结束。

---

## 记忆系统：跨会话上下文

AI 会话是无状态的，每次新会话上下文清空。DevCodex 通过写入 `.devcodex/.memory/` 文件持久化每次会话的关键信息，使得：

- 新会话可以感知"上次做了什么、做到哪里"
- `恢复任务（resume）` 工作流可以从中断点继续执行
- 违规记录、待修复问题有持久化审计轨迹

记忆文件是本地的、私有的，不提交到 Git。v2.0.0 计划迁移到云端存储以支持多设备同步。

---

## 双 Agent 模式：选择权交给用户

DevCodex 提供两个 Agent 入口，而非通过指令切换：

| Agent | 适用场景 |
|-------|---------|
| `@devcodex` | 正式开发、架构变更、需要逐步确认 |
| `@devcodex-auto` / `@rocky` / Profile alias / 明确自然语言 auto 授权 | 熟悉流程后的白名单路径快速迭代；非白名单源码路径回确认模式 |

这个设计的理由是：**选择执行模式是一个会话级决策，不是消息级决策**。在开始工作前选择 Agent，比在每条消息里加前缀更自然。

---

## Skills 系统：按需加载，宿主入口只保留精简内核

宿主每次会话只自动发现受覆盖与预算约束的精简 kernel（Claude / Gemini 使用薄 wrapper 指向共享 kernel）；Skills 按任务意图触发。完整 `instructions.md` 保存在非 always-on fallback 路径，仅在覆盖、绑定、新鲜度或低置信场景需要时读取。

这个分层的好处：
- **Host kernel** 承载安全底线、优先级、路由与 fail-closed 入口，必须始终生效
- **Skills** 承载具体工作流逻辑，按任务类型加载，不浪费上下文窗口
- **Full fallback** 保留完整规范强度，在裁剪证据不足时恢复，不用“少读”换质量

---

## 官方标准对齐原则

DevCodex 严格遵循 GitHub Copilot 官方目录规范（`.github/skills/<name>/SKILL.md` 扁平结构、`name` 字段一致性等），而不是自行设计格式。

原因很简单：**平台更新时不需要改 DevCodex，只需跟随官方格式即可**。偏离官方标准意味着每次平台升级都要额外维护兼容层。

---

## 与 ai-dev-guidelines v4 的关系

DevCodex 的开发过程使用 `ai-dev-guidelines/version/v4/RULES.md` 作为 AI 协作工具的**执行规范参考**，但两者之间存在根本性的层级差异：

| 维度 | ai-dev-guidelines v4 | DevCodex |
|------|----------------------|----------|
| 定位 | AI 开发工具的通用执行规范 | 面向软件开发全周期的完整 Agent 体系 |
| 作用 | 辅助开发 DevCodex 时的行为约束参考 | DevCodex 自身的产品规范与流程定义 |
| 关系 | **工具**，DevCodex 开发期间使用它 | **产品**，DevCodex 是完全重构的独立体系 |

**DevCodex 是对 v4 体系的完全重构，而不是 v4 的扩展或子集。**

具体体现在：

- DevCodex 增加了 v4 中没有的节点（如"前置状态汇总"、"开发阶段合规检查"），这是主动设计决策，不是与 v4 的"不一致"
- DevCodex 的合规框架（SC/FC/RC 三层）与 v4 的合规机制是独立设计，语义不同
- DevCodex 的版本需求文档、记忆系统、CP 确认流程等均为独立规范体系

分析 DevCodex 的合理性时，**以 DevCodex 自身的 `flowcharts.md` 和 `specs/` 为权威**，v4 RULES.md 仅用于了解 AI 工具执行背景，不作为 DevCodex 规范的评判标准。
