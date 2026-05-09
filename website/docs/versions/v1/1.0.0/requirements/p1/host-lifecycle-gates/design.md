# 宿主生命周期硬门禁（Hooks 优先）— 技术方案

> **需求来源**：[宿主生命周期硬门禁（Hooks 优先）— 需求概况](./index)
> **状态**：✅ 已收敛

---

## 方案概述

本方案的核心不是“再写更严格的 instructions”，而是把 DevCodex 中真正需要**确定性时机**的动作，从模型提示层提升到宿主生命周期层：

- **Hooks**：负责确定性触发和阻断。
- **Instructions / Skills**：继续负责规则语义、内容格式、流程判断。
- **MCP / Tools**：作为状态与能力增强层，不阻塞第一阶段。

最终形成三层协作：

1. **宿主硬门禁层**：保障预检查、危险操作拦截、结束前闭环。
2. **规则语义层**：保留现有 instructions / skills / prompts，承载 DevCodex 的规则系统。
3. **状态增强层**：MCP 或 Tool 输出的结构化上下文，用于后续增强，而非第一阶段前提。

同时，方案落地必须遵循两阶段路径：

1. **阶段 A：Workspace Hooks MVP**
	- 以当前 npm 包 + CLI 分发模型为基础
	- 将 Hook 资产安装到目标项目 `.github/hooks/*.json`
	- 用最小事件集合完成 bootstrap、危险操作护栏和闭环兜底
2. **阶段 B：Plugin-Native 演进**
	- 仅在后续需要接入官方 plugin runtime 时再评估
	- 不作为首阶段发布前置条件

---

## 现状分析

### 1. 当前实现面与问题证据

| 位置 | 现状 | 暴露问题 |
|------|------|---------|
| `README.md` | 对外主叙事仍是 Instructions-First 自动生效 | 用户会自然预期“有规范 = 必执行” |
| `instructions/17-compliance.instructions.md` | 预检查要求“第一批 tool call”“回复第一行输出” | 这是模型输出约束，不是宿主强制保证 |
| `plugin.json` | `_hooks_todo` 已改为“Workspace Hooks 已分发、plugin-native 后置”的内部过渡说明 | 不能再把该字段当作“Hooks 未落地”的证据；真正未完成的是 plugin-native 与跨宿主闭环 |
| `.mcp.json` | 全部 disabled 占位 | 不能依赖 MCP 解决当前硬门禁问题 |
| `website/docs/guide/development.md` | 文档已承认 Hooks 才是生命周期自动动作的正确载体 | 文档认知与主实现面未闭环 |
| `requirements/p1/{precheck,dev-compliance,exec-compliance}` | 当前均按“已实现”建模 | 缺少“宿主可否确定性执行”的维度 |

### 2. 根因定位

根因不是某一条 instruction 写得不够严，而是**职责放错层**：

- 预检查、危险操作拦截、完成前闭环，本质都是“**何时必须发生**”的问题。
- Instructions 只能描述“**应该怎么做**”，不能稳定保证“**一定何时发生**”。
- 因此当前 VS Code 场景里，一旦宿主先注入系统/开发者消息、要求先输出 commentary、或对 tool 调用顺序有自己的约束，规则文本就会失去硬约束力。

---

## 核心设计

### 1. 执行模式重构：Hook-First / Instruction-Fallback

定义统一执行模式枚举：

| 模式 | 触发条件 | 保证等级 |
|------|---------|---------|
| `hook-enforced` | 宿主支持 DevCodex 生命周期 Hooks | 关键门禁为硬保证 |
| `instruction-fallback` | 宿主不支持 Hooks 或 Hooks 未启用 | 仅保留软约束 |
| `disabled` | DevCodex 未初始化或资产不完整 | 不宣称规则已接管 |

#### 关键原则

- **先判断宿主能力，再决定门禁承载层**。
- **先保证可解释的降级，再追求全宿主等价**。
- **先落当前可分发的 Workspace Hooks，再评估官方 plugin-native 形态**。
- 文档、CLI、状态输出必须显式暴露当前模式，避免“看起来都一样”。

### 2. 首阶段分发与运行边界

首阶段不把“支持 Hooks”定义为“先完成官方 plugin 化”，而是直接绑定当前产品真实交付面：

| 维度 | 首阶段选择 | 原因 |
|------|-----------|------|
| Hook 形态 | Workspace Hooks (`.github/hooks/*.json`) | 与现有 CLI 安装路径一致，最小改动即可落地 |
| 脚本入口 | 由 CLI 分发到 `.github/hooks/_runtime/` 的受版本管理运行时脚本 | 保留“随版本分发、可审计”的特性，同时兼容 `node /path/to/devcodex/index.js init`、`npm link` 与标准安装路径 |
| 运行依赖 | 本地宿主 + 本机 Node + 工作区文件 | 不把服务器部署、MCP、集中治理作为首阶段前置 |
| plugin-native hooks | 后续评估 | 当前 `plugin.json` 并非官方运行时 manifest，强行前置会错配交付面 |

### 3. 生命周期事件映射

首阶段按“最小可用集”冻结以下事件优先级：

| 优先级 | 事件 | 首阶段责任 | 定位 |
|------|------|------------|------|
| P1 | `UserPromptSubmit` | 执行 bootstrap：项目识别、Profile 读取、Memory 读取、待续任务检测、产物落点判断 | 首阶段主入口 |
| P1 | `PreToolUse` | 执行危险操作确认、未 bootstrap 时禁止高风险 ToolUse、执行前断言 | 首阶段主护栏 |
| P1 | `PostToolUse` | 记录本轮变更面、关键验证状态与待闭环事实 | 首阶段主持续化来源 |
| P2 | `PreCompact` | 在长会话压缩前保留必要状态与恢复线索 | 首阶段建议纳入 |
| P3 | `Stop` | 校验报告、记忆、会话状态是否闭环 | 最终兜底，不承担主持续化 |
| P4 | `SessionStart`（可选增强） | 提前准备宿主态缓存，降低首轮 bootstrap 成本 | 增强项，不阻塞首阶段 |

#### `Stop` 的约束定位

- `Stop` 可以阻止未闭环会话结束，但不应承担首阶段的主状态写入。
- 报告、记忆、恢复线索等高频状态应尽量前移到 `PostToolUse` / `PreCompact`。
- `Stop` 只负责“最后一次发现缺口并兜底阻断”，避免把正常闭环全部堆到结束事件。

### 4. 预检查契约改写

当前“回复第一行输出预检查块”的约束需要重写为以下语义：

- **规则目标**：在进入实质任务前，用户必须能看到预检查状态。
- **Hook 模式**：优先由宿主或宿主驱动的第一段可见状态输出承载。
- **Fallback 模式**：继续沿用 instruction 输出，但只承诺“首个结构化状态块”，不再机械要求“回复第一行”。

#### 新契约

1. 预检查是**进入任务前的必经状态计算**，不是单纯文案模板。
2. 文案展示位置以“宿主可见且早于实质任务内容”为准。
3. 若宿主先要求 commentary 或其他系统输出，不视为违约；只要预检查状态仍在实质任务前可见即可。

### 5. 合规闭环改写

将以下检查从“模型自觉执行”改为“宿主结束前断言”：

| 环节 | 现状 | 目标 |
|------|------|------|
| 执行后合规 | 依赖 instructions / skills 在回复前自觉执行 | 由 `PostToolUse` / `Stop` 驱动最终断言 |
| 报告存在性 | 依赖模型收尾时记得写报告 | 结束前检查缺失即失败 |
| 记忆更新 | 依赖模型会话尾部追加 | 结束前检查缺失即失败 |
| 危险操作确认 | 依赖 instructions 中的提示语 | 工具调用前即阻断 |

### 6. 打包与分发设计

Hooks 一旦进入正式实现面，以下资产必须联动：

| 文件 | 设计变更 |
|------|---------|
| `hooks/` | 新增首阶段 Workspace Hooks 源配置与分发到 `.github/hooks/_runtime/` 的运行时脚本 |
| `package.json` | `files` 纳入 Hooks 资产与相关本地执行入口 |
| `index.js` | `init/update/status` 支持复制与识别 `.github/hooks/` |
| `plugin.json` | 首阶段仅保留内部元数据一致性；plugin-native hooks 后续再评估 |
| `README.md` / `RULES.md` | 明确安装后哪些能力依赖 Hooks |
| `scripts/validate.js` | 增加 Hooks 结构与分发校验 |

#### 分发面冻结

首阶段分发关系固定为：

| 仓库源面 | 目标项目落点 |
|---------|--------------|
| `hooks/` | `.github/hooks/` |
| `hooks/_runtime/` | `.github/hooks/_runtime/` |

这意味着“支持 Hooks”的第一阶段完成标准，是 `devcodex init/update` 能把 Hooks 安装到目标项目工作区，而不是仓库内部先做一份看起来完整但并未进入当前产品分发面的 plugin manifest。

### 7. 脚本归属与安全边界

为降低 Hook 引入后的自修改风险，首阶段采用以下边界：

1. `.github/hooks/*.json` 只负责声明事件与命令入口。
2. 真正执行逻辑由 CLI 分发到 `.github/hooks/_runtime/`，作为受版本管理的运行时资产存在。
3. 不把用户手写的工作区临时脚本作为默认入口，避免 Hook 逻辑在用户项目里漂移。
4. 不要求任何远程服务器参与首阶段闭环；远程治理能力后续按需追加。

### 8. 文档同步策略

新需求不是孤立功能，必须同步重写以下口径：

1. `requirements/p1/precheck/`：从“已实现的文本预检查”升级为“宿主驱动 + fallback 文本输出”。
2. `requirements/p1/dev-compliance/`：明确“路由前闸门”的硬/软边界。
3. `requirements/p1/exec-compliance/`：明确执行后闭环的宿主承担责任。
4. `README.md` / `RULES.md`：重写兼容性承诺，避免继续默认所有宿主等价。
5. 历史 `p2/prompts.md` 中“hooks 已迁移至 agents”之类表述，需标记为历史背景，不能继续被当作当前设计结论。

---

## 关键设计决策

| 决策 | 选择 | 原因 | 不选方案 |
|------|------|------|---------|
| 生命周期硬门禁放在哪一层 | Hooks | 这是时机与阻断问题，宿主层最稳定 | 继续只靠 instructions |
| 是否要求所有宿主一步到位等价 | 否，先区分 `hook-enforced` / `instruction-fallback` | 兼容现实差异，比虚假统一更重要 | 延续“全宿主自动等价”叙事 |
| 首阶段是否绑定 MCP | 否 | `.mcp.json` 仍未就绪，不能成为前提 | 等 MCP 全量落地后再解决 |
| 预检查是否继续要求“第一行” | 否，改为“实质任务前首个结构化状态块” | 适配宿主输出链路现实 | 保留机械首行约束 |
| 首阶段 Hooks 形态 | Workspace Hooks MVP | 与当前 CLI 分发面一致，最容易形成真实可用路径 | 先做 plugin-native hooks |
| `Stop` 在首阶段承担什么角色 | 最终兜底 | 官方结束事件适合补最后一道门，不适合承担全部主持续化 | 把全部闭环压到 `Stop` |
| 首阶段是否要求服务器部署 | 否，本地优先 | 宿主事件 + 本地脚本已足够解决当前根因 | 先上远程服务再解决门禁 |

---

## 风险与约束

- Hooks 引入后，CLI、打包和安装结构都会变化，若校验链不补齐，容易出现“资产分发了但宿主没加载”的新漂移。
- 若文档仍保留旧的 instructions-first 全能叙事，用户会继续误判能力边界。
- 若 fallback 模式没有显式提示，问题只会从“为什么没执行”变成“为什么偶尔执行”。
- 若 Hook 默认指向工作区内可编辑脚本，agent 或用户侧临时修改会破坏门禁一致性。

---

## 验证方案

1. **VS Code Hook 模式验证**：新会话、普通 dev 请求、危险 ToolUse、结束前缺少报告四类场景逐条验证。
2. **Fallback 模式验证**：在不支持 Hooks 的宿主中，确认会显式提示为 `instruction-fallback`，且不再承诺硬保证。
3. **CLI 分发验证**：`init --dry-run`、`status`、`npm pack --dry-run` 均能识别 `.github/hooks/` 相关资产。
4. **本地优先验证**：在未接入远程服务的环境中，完成 Hook MVP 的 bootstrap、危险操作护栏与闭环兜底。
5. **文档一致性验证**：README、RULES、requirements 与兼容性表述一致，不再出现“hooks 已迁移但无正式产物”的断裂。
6. **回归验证**：旧 instructions-first 使用方式不因 Hooks 引入而失效。
