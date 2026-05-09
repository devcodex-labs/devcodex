# 宿主生命周期硬门禁（Hooks 优先）— 需求概况

> **优先级**：P1 · **状态**：🟡 实施中

---

## 需求背景

当前 `devcodex-v1.8.0` 的主实现面仍是 **Instructions-First**：

1. `README.md`、`RULES.md`、`index.js` 都把 `.github/copilot-instructions.md` + `.github/instructions/` 作为默认生效路径，对外承诺“安装后自动生效”。
2. `instructions/17-compliance.instructions.md` 将预检查定义为“第一批 tool call 必须读取 Profile + 记忆”“回复第一行必须输出预检查块”，这类要求本质上依赖模型完全服从上下文，而不是宿主生命周期强制执行。
3. `plugin.json` 虽仍保留 `_hooks_todo` 字段，但其语义已改为“Workspace Hooks 已分发、plugin-native 仍后置”；`.mcp.json` 仍是全 disabled 占位，说明当前仓库已落地 Workspace Hooks MVP，但尚未完成 plugin-native / MCP 层闭环。
4. 仓库文档本身已承认“生命周期自动动作应由 Hooks 承担”，但活跃需求体系中的 `① 预检查`、`⑥ 开发阶段合规检查`、`⑨ 执行阶段合规检查` 仍主要建模为 Agent / Instructions 逻辑，尚未覆盖 VS Code 宿主层的确定性差异。

这会带来两个直接问题：

- **VS Code 与 JetBrains / 不同宿主之间行为不稳定**：规则是否严格执行，取决于宿主如何加载 instructions、如何排序系统/开发者消息、是否允许会话前置输出。
- **规范语义与宿主现实冲突**：像“回复第一行必须输出预检查块”这类规则，在部分宿主或平台约束下天然不可保证，导致用户感知为“明明有规范但没执行”。

同时，当前仓库的真实交付面是 **npm 包 + CLI 向目标项目复制 `.github/` 资产**，而不是官方 marketplace plugin 运行时。因此本需求的首阶段实现，必须优先落在当前可控分发面上，而不是把“官方 plugin hooks”当作前置条件。

因此，需要新增一条独立 P1 需求，把“预检查 / 合规检查 / 记忆 / 报告 / 安全底线”的**硬门禁语义**从 instructions 的软约束，迁移到宿主生命周期可强制执行的层级；同时为不支持 Hooks 的宿主保留可见、可降级的 fallback 路径。

---

## 需求定义

### NR-1：新增宿主生命周期硬门禁层

- DevCodex 必须新增一层“宿主生命周期硬门禁”能力，优先承载以下动作：
  - 会话开始时的 Profile / Memory 读取
  - 用户消息提交前后的预检查与执行准备
  - 工具调用前的危险操作拦截
  - 会话结束前的报告 / 记忆闭环检查
- 该能力优先服务 VS Code Copilot 的 Hooks / 生命周期事件；若其他宿主具备等价能力，也可复用同一抽象。
- **首阶段实现面**必须基于当前 CLI 分发路径，将 Hook 资产安装到目标项目 `.github/hooks/*.json`；官方 plugin-native hooks 形态作为后续演进方向，不得阻塞首阶段发布。

### NR-2：预检查从“首行文本约束”改为“宿主兼容的可见状态契约”

- 预检查的目标不是强制模型输出某一行文字，而是保证**在进入实质任务前**，用户能看到结构化的预检查状态。
- 当宿主支持 Hooks 时，预检查可由宿主注入或宿主驱动；当宿主不支持时，才退回 instruction 侧的文本输出约束。
- 现有“第一批 tool call”“回复第一行输出”这类字面强约束，需要改写为宿主可执行的语义约束。

### NR-3：建立 Hook-First、Instruction-Fallback 的双模式

- DevCodex 必须显式区分两种执行模式：
  - `hook-enforced`：宿主支持生命周期 Hooks，关键门禁由 Hooks 强制执行。
  - `instruction-fallback`：宿主不支持 Hooks，继续使用现有 instructions / agents 语义，但明确降级为“软保证”。
- 不允许继续对外笼统宣称“所有宿主都等价自动生效”。

### NR-4：硬门禁覆盖四类核心环节

以下能力在支持 Hooks 的宿主中必须具备确定性执行路径：

1. **预检查**：Profile / Memory / 待续任务 / 产物落点 / 宿主模式识别。
2. **执行前护栏**：危险命令确认、未 bootstrap 前禁止进入高风险 ToolUse。
3. **执行后合规**：任务执行完成后自动检查必要产物和关键验证是否存在。
4. **完成前闭环**：记忆、报告、会话状态在会话结束前必须完成，否则阻止完成或给出显式失败。

其中，首阶段事件优先级按以下顺序冻结：

1. `UserPromptSubmit`：负责 bootstrap 与预检查状态计算。
2. `PreToolUse`：负责危险操作与未 bootstrap 的工具护栏。
3. `PostToolUse`：负责增量状态记录与事实收集。
4. `PreCompact`：负责长会话压缩前的关键状态保留。
5. `Stop`：仅作为最终兜底，不作为首阶段主持久化机制。

### NR-5：CLI 与分发面必须支持 Hooks 资产

- `package.json` 的 `files` 白名单、`index.js` 的 `init/update/status`、安装后的 `.github/` 目录结构，都必须能分发并识别 Hooks 相关资产。
- Hooks 应作为正式产物的一部分，而不是继续停留在 `_hooks_todo` 或历史文档描述中。
- 首阶段分发目标为 **Workspace Hooks**：仓库源目录中的 Hooks 资产必须能被 CLI 分发到目标项目 `.github/hooks/`，并被 `status` / 安装校验识别。

### NR-6：首阶段不以服务器部署为前置条件

- 首阶段 Hook 路线必须支持**纯本地闭环**：只依赖宿主事件、本地 CLI 资产、本机 Node 运行时和工作区文件读写即可完成核心门禁。
- 远程记忆、远程审计、集中策略、统一鉴权等服务端能力属于后续增强，不得成为首阶段上线前提。
- Hook 脚本入口应优先调用包内受版本管理的本地脚本，而不是依赖工作区中可被随意改写的临时脚本。

### NR-7：兼容性文档必须区分“软约束”和“硬保证”

- README、RULES、网站文档中的 IDE / 宿主兼容说明，必须明确区分：
  - 哪些能力只是 instructions 层的软约束
  - 哪些能力在支持 Hooks 的宿主中才具备确定性保证
- “WebStorm 正常、VS Code 偶发失效”这类差异，必须能从产品文档里被解释，而不是依赖口头补充。

---

## 约束条件

- 不推翻当前 instructions-first 资产；旧路径必须继续可用，直到 hooks 路径成熟。
- 不把 Hooks 方案与 MCP 全量落地绑定；MCP 可作为后续增强，不应阻塞第一阶段。
- 不把官方 plugin-native hooks、远程服务或集中治理平台当作首阶段前置；首阶段必须能以本地 Workspace Hooks 独立成立。
- 不允许把 unsupported host 直接视为错误；应降级到 `instruction-fallback` 并明确提示保证等级下降。
- 不得在 Hook 配置或脚本中硬编码密钥、Token 或环境专有路径。

---

## 非需求（明确排除）

| 排除项 | 理由 |
|------|------|
| 一次性重写全部工作流规则 | 本需求聚焦“硬门禁承载层”，不是全面重构所有规则文案 |
| 把所有状态都迁移到 MCP | 现阶段 `.mcp.json` 仍未就绪，不应成为首阶段前提 |
| 要求所有 IDE 都必须支持 Hooks 后才能发布 | 产品必须保留 fallback 路径 |
| 以宿主 Hook 直接替代需求/方案/审查文档 | Hooks 负责执行时机，Instructions/文档仍负责规则语义 |

---

## 验收标准

| # | 标准 | 验证方式 |
|---|------|---------|
| AC-1 | 在支持 Hooks 的 VS Code 宿主中，新会话进入 dev 模式时，预检查会在实质任务前被确定性执行 | 实机会话验证 |
| AC-2 | 当用户在 bootstrap 前触发高风险 ToolUse 时，宿主门禁能阻止继续执行或要求确认 | Hook 触发回放 |
| AC-3 | 当任务结束前缺少报告或记忆时，支持 Hooks 的宿主会阻止完成或显式提示失败原因 | `Stop` 兜底验证 |
| AC-4 | 当宿主不支持 Hooks 时，DevCodex 会进入 `instruction-fallback`，并向用户明确当前仅为软保证模式 | 跨宿主验证 |
| AC-5 | README / RULES / 网站兼容文档能明确解释“硬保证 vs 软约束”的差异 | 文档审查 |
| AC-6 | `init/update/status` 能识别并分发 `.github/hooks/` 相关资产，不再仅靠 `_hooks_todo` 占位 | CLI 验证 |
| AC-7 | 在未接入任何远程服务的本地环境中，Hooks MVP 仍可完成核心预检查、危险操作护栏与闭环兜底 | 本地离线验证 |

---

## 影响范围

### 预期变更模块

| 模块 | 变更方向 |
|------|---------|
| `hooks/`（新增） | 首阶段 Workspace Hooks 源配置与本地脚本入口 |
| `index.js` | `init/update/status` 分发与状态识别 |
| `package.json` | `files` 白名单纳入 Hooks 资产 |
| `plugin.json` | 后续再评估是否升级为官方 plugin-native 能力描述；首阶段不作为主运行时入口 |
| `instructions/17-compliance.instructions.md` | 将“首行 / 首批 tool call”改为宿主兼容语义 |
| `README.md` / `RULES.md` | 明确 Hook-First / Fallback 模式和兼容性说明 |
| `website/docs/versions/v1/1.0.0/requirements/p1/{precheck,dev-compliance,exec-compliance}` | 与新需求建立交叉引用，澄清软硬边界 |

### 潜在影响点

- VS Code 路径会从“依赖模型服从”转为“宿主 + 规则协作”，实现成本上升，但稳定性显著提升。
- 对不支持 Hooks 的宿主，用户会看到更明确的能力边界说明，减少错误预期。
- 需要新增一轮 CLI / 文档 / 兼容矩阵验证，避免“已分发但未加载”的新型漂移。

---

## 开发文档

| 文档 | 状态 |
|------|------|
| 技术方案（`design.md`） | ✅ 已收敛 |
| 实施计划（`plan.md`） | ✅ 已收敛 |
| 实施进度（`progress.md`） | ✅ 已初始化 |
| 关键决策（`decisions.md`） | ✅ 已收敛 |

---

## 版本变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0.0 | 2026-05-09 | 初始需求建档，定义宿主生命周期硬门禁、Hook-First/Fallback 双模式与文档同步范围 |
| v1.1.0 | 2026-05-09 | 冻结首阶段路线为 Workspace Hooks MVP，补充本地优先/无服务器前置、事件优先级与 `Stop` 兜底定位 |
| v1.2.0 | 2026-05-09 | 同步首阶段实现状态：Workspace Hooks 已进入 CLI 分发与 npm 校验，需求文档切换为实施中，并补齐旧需求交叉引用 |
