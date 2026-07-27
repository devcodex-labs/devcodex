# DevCodex 使用介绍

> 本站是 DevCodex 官方文档入口，面向需要在 Copilot / Claude Code / Codex / Gemini / Grok 五宿主中统一 AI 开发工作流的使用者和集成开发者。需求、实现和发布材料保留在“维护者指南”与“版本”分区，不占用第一次成功路径。

---

## DevCodex 是什么

DevCodex 是通过 npm 包和 CLI 分发的 AI 开发规范注入器。npm 全局安装/升级负责配置 Copilot、Claude Code、Codex、Gemini CLI 与 Grok Build 的用户级 adapter；工作区 bare `init/update` 只管理 `.devcodex`。所有宿主从同一真相源生成精简入口，按意图读取 Skills，证据不足时回退完整规范。

站点同时保留稳定规范和版本化维护资料；历史版本目录中的旧需求页只代表当时基线，不等同于当前实现。当前安装、命令和宿主支持以仓库 [README](https://github.com/devcodex-labs/devcodex#安装) 与当前发布版本为准。

---

## 快速开始

> 版本语义：npm package 当前发布版本是 **v1.15.3**；站内 **1.0.1** 是活动需求文档版本。当前版本仅发布到 GitHub Packages，安装需要 `read:packages` 认证；Gemini / Grok 通用宿主选择器随 v1.15.3 发布。

1. 确认 Node.js >=18。
2. 当前未发版候选使用本地 tarball 安装，然后从目标项目初始化 `.devcodex`：

```bash
npm pack
npm install -g ./devcodex-devcodex-1.15.3.tgz
devcodex init
devcodex status
```

源码维护者日常刷新用户级 adapter：`devcodex global-adapters apply`（可选 `--dry-run`；或次选 `npm install -g .` / pack+tarball）。发布后的正式命令为 `npm install -g @devcodex/devcodex`；升级使用 `npm update -g @devcodex/devcodex`。`npm install devcodex` 仅加入项目依赖，不配置宿主，并输出必须使用 `-g` 的指引。

执行完成后，宿主 adapter 位于用户级配置根，工作区仅有 `.devcodex`。安装不会新建 `.github/.claude/.codex/.gemini/.grok`，bare `devcodex init/update` 也不会创建或修改 `.gitignore`；已有旧目录只作为 legacy 诊断输入，不会自动删除。`devcodex grok` 使用用户级 plugin/runtime，并从 cwd 发现 workspace `.devcodex`。完整命令和排错步骤见 [README](https://github.com/devcodex-labs/devcodex)。

---

## 核心设计目标

| 目标 | 解法 |
|------|------|
| AI 行为可预期 | 通过 CP 与工作流骨架把 AI 行为先定义清楚 |
| 跨会话上下文保持 | 通过 `.devcodex/.memory/` 写入 Agent 日记、需求记忆与项目总记忆 |
| 工作流行为可审计 | 通过报告、audit-state 与合规检查形成可追溯闭环 |
| 规范随代码版本化 | 用版本文档管理规范演进与实现边界 |
| 跨项目复用 | 宿主 adapter 安装到用户级配置根；每个 workspace 只维护自己的 `.devcodex` |
| 多宿主一致入口 | npm 全局安装统一配置五宿主；公共 CLI 不提供 workspace `--host` 写入旁路 |
| 上下文成本可控 | always-on 入口使用有 coverage 与预算约束的精简 kernel；Claude / Gemini 仅保留薄 wrapper，具体流程按意图加载 Skills，完整规范作为 fail-closed fallback |
| 长任务停滞可诊断 | `TurnLivenessRecoveryGate` 区分运行、等待续接、可疑、可恢复停滞与终态，记录工具租约、continuation ACK 和 checkpoint；Hook 只在事件到达时观察，不承诺自行唤醒宿主或自动重放写操作 |
| 文件真相源优先 | `MemoryCannotSatisfyBootstrapGate` 要求宿主 Memories、模型长期偏好或交接卡只作为 `navigation-hint`，新线程 / resume / summary 恢复仍读取 Profile、tasks、reports 和源码 / 文档真相源 |
| Profile 真相对账 | 项目级 analyze/audit 用 `ProfileTruthMatrix` 对照 Profile 声明与当前代码、配置、运行和发布事实；过期 Profile 不覆盖现实，只读工作流不直接改 Profile |
| Hook 能力按宿主/事件降级 | 安装成功只证明用户级 adapter 可发现；默认注册 `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PreCompact` / `Stop`，具体注入、阻断和回传仍受宿主事件契约与证据上限约束 |
| 双层修复协作契约 | 所有 repair task 至少形成轻量决策/验收层与执行/验证层；高风险升级完整契约和独立复证。模型名称、是否切换模型或 Agent 都不是触发条件 |
| 授权本地安全审查 | 可见回复保留防御结论和最小必要证据，隔离本地探针保存复现；内容不可见时用 `SafetyInterruptionCard` 恢复，不尝试绕过平台控制 |
| 发布凭据拓扑 | 首次发布或身份拓扑变化时核对 publisher、repository、package、auth/secret scope、permission 与成功运行；不读取或输出 secret value |
| 平台升级免维护 | 提前对齐官方目录规范，降低后续实现风险 |
| 灵活的执行模式 | 提供确认模式与 Auto v1.1；Auto 通过显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `extensions.devcodex.autoAliases` 替换别名或明确自然语言 auto 授权进入，仅对白名单路径提供自动推进保证，控制面/多批次任务仍受 ExecutionContract 约束 |
| AI 对自身行为自检 | 把合规检查作为核心设计原则保留下来 |
| 分层功能授权 | 商业化能力暂时仅做规划，不视为已实现功能 |

---


## 工作方式

```
用户消息
    ↓
意图识别（dev/fix/analyze/audit/chat...）
    ↓
工作流路由 → CP 确认流程 → 执行
    ↓
合规检查（AI 工作流执行自检）
    ↓
写入报告 + 记忆
```

主流程见 [执行流程图](/specs/flowcharts)，版本化执行要求见 [P0：执行流程骨架](/versions/v1/1.0.0/requirements/p0/execution-flow)。

---

## Agent 入口

DevCodex 提供两个 Agent 入口：

| Agent | 模式 | 适用场景 |
|-------|------|---------|
| `@devcodex` | 确认模式（默认）| 正式开发、架构变更、需要逐步确认 |
| `@devcodex-auto` / `@rocky` / Profile alias | Auto v1.1 | 熟悉流程后的治理文件、文档、`.devcodex/` 产物等白名单路径快速迭代 |

> Auto v1.1 的正式入口包括显式 `@devcodex-auto`、全局默认 `@rocky`、项目 Profile `config.json` 的 `extensions.devcodex.autoAliases` 替换别名与明确自然语言 auto 授权（如“进入 auto 模式执行”）。配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；它只在 hook-enforced 宿主里对白名单路径形成 runtime 级自动推进保证；模糊提及、询问 auto 规则、未生效昵称或普通“继续”不算授权；非白名单源码路径默认回确认模式；默认 safety-only 流程提醒放行，危险命令硬拦且必须在用户明确确认 approval id 后才可一次性重试，安全底线始终强制执行。

---

## npm 安装与宿主适配

| 命令 | 语义 |
|------|------|
| `devcodex global-adapters apply` | 源码日常：从包根刷新用户级五宿主 adapter（`--dry-run` / `--json`）；不 pack、不 publish |
| `npm install -g .` | 本地旁路：全局安装当前目录并走 postinstall |
| `npm pack` + `npm install -g ./devcodex-devcodex-*.tgz` | 预发冒烟 tarball |
| `npm install -g @devcodex/devcodex` | 已发布：安装全局 CLI，并通过包 `postinstall` 自动刷新全局宿主 adapter |
| `npm update -g @devcodex/devcodex` | 已发布：升级全局包，并通过包 `postinstall` 自动刷新全局宿主 adapter |
| `npm install devcodex` | 仅安装当前项目依赖；不配置宿主，并输出必须使用 `-g` 的指引 |
| `devcodex update` | 只刷新当前 workspace `.devcodex`，不升级全局包、不写宿主配置 |
| `devcodex init` | 只初始化当前 workspace `.devcodex`（含 fresh workspace-namespace marker），不写宿主配置 |
| `devcodex status` / `doctor` | 安装与宿主诊断；可加 `--completion` / `--json` |
| `devcodex grok` | Full-evidence Grok 入口（用户级 kernel） |

`.devcodex` 仍保持 workspace-namespace，不迁移到 npm global prefix。安装期自动适配默认 fail-soft；`DEVCODEX_SKIP_POSTINSTALL=1` 可显式跳过，CI、源码仓安装与传递依赖默认 no-op。当前阶段只验证本地 CLI / package lifecycle 语义，不验证 npm 包名 owner、registry、dist-tag 或版本唯一性。

---

## 组件构成

| 组件 | 说明 |
|------|------|
| Agent | `devcodex.agent.md`（确认模式）+ `devcodex-auto.agent.md`（全自动模式）|
| Host kernel / Instructions | 宿主自动发现精简 kernel；节点 Instructions 与 Skills 按平台能力和意图加载，完整规范保留非 always-on fallback |
| Skills | 当前源码维护 84 个按需触发的工作流技能（81 active + 3 gray）；active `host-capability-routing` 以薄 Rule + Skill + 版本化 catalog/contracts 将原始用户意图映射到五宿主 8 个 surface variant，直接证据不足时保持 portable fallback，当前不新增 MCP Tool；另有 `requirement-parallel-orchestration`、active `repair-prevention-assessment`，gray `rework-prevention-engineering`、`consumer-validation-engineering`、`brand-visual-quality`，以及 `user-visible-output-contract`、`host-instruction-projection`、`analyze-default`、`skill-gap-analysis`、`skill-lifecycle-governance`、`spec-absorption`、`user-manual-authoring`、`audit-user-manual`、`expert-output-quality`、`review-checklist`、`evolution-governance`、`readme-authoring`、`audit-readme`、`audit-release`、`execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync`；专家能力保持 21 个专家 Owner Skill |
| Prompts | CP 节点输出模板（`prompts/*.prompt.md`，当前 30 个） |
| Hooks | 默认注册 `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PreCompact` / `Stop`（能力按宿主/事件降级） |
| MCP | 本地 stdio：`devcodex-memory`（10 Tools）+ `devcodex-profile`（5 Tools + Prompt `devcodex-init`）；无 Resource/Tasks |
| CLI | 见下节与 [维护者指南 · CLI 速查](/guide/development#cli-速查)；含 `global-adapters` / `profile` / `skill` / `task` / `trace` / `grok` 等 |
| Codex adapter | 用户级 `.codex/AGENTS.md`、hooks/config/runtime 与用户级 `.agents/skills/` |
| Gemini / Grok adapter | 用户级 Gemini settings/runtime 与 Grok plugin/config/runtime；`devcodex grok` 使用全局 kernel，能力按 direct / fixture 证据分级 |

---

## 合规检查说明

> ⚠️ DevCodex 合规检查采用 **入口 PC0~PC7** + **四层闭环（FC / SC / RC / T）**，用于 AI 自身执行质量与收尾检查，不是对用户业务代码的生产合规校验。另有安全底线 S01~S07 与规范变更 SCV。

它检查的是 AI 自身的执行质量：记忆文件是否写入、fix 三步扫描是否执行、dev 后是否运行了 lint/typecheck 等。

详细定义见：[合规检查框架](/specs/compliance-framework)。

### 工作流 intent（与代码矩阵一致）

机器真相源：`skills/routing/workflow-capabilities.json`（`npm run test:workflow-capabilities`）。

| intent id | 说明 |
|-----------|------|
| `dev` / `fix` / `self-fix` | 可变工作流，需 CP |
| `analyze` / `audit` | 只读 |
| `chat` | 问答快路径 |
| `resume` | 继承原工作流阶段 |
| `other` | 规划兜底；**plan Skill 走此路由**，不是名为 `plan` 的 workflow id |

### 能力证据分层（声明 / 探针 / 真机）

维护者文档与站点能力表统一使用三列证据上限，**禁止**把「声明」或「包内探针」写成「五宿主真机已测」：

| 能力面 | 声明（代码/矩阵） | 探针（可重复命令） | 真机 |
|--------|-------------------|--------------------|------|
| 8 workflows（含 `other`，无 workflow id=`plan`） | `workflow-capabilities.json` | `npm run test:workflow-capabilities` | 不要求 |
| Skills 84 | `plugin.json` + 磁盘 SKILL.md | `npm run test:docs-surface-inventory` | 不要求 |
| MCP 15 tools | `mcp/*-server.js` | `test:mcp-servers` / `test:mcp-runtime-closure` | 不要求 |
| Hooks 五事件 | `hooks/devcodex.lifecycle.json` | `test:hooks-runtime` / 宿主契约 | 按宿主事件降级 |
| Prompts 30 / Instructions 15 | `prompts/` · `instructions/` | `test:docs-surface-inventory` | 不要求 |
| npm scripts ≥113 / scripts/lib ≥102 | `package.json` · `scripts/lib` | `test:docs-surface-inventory`（基线 `docs-surface-baseline-20260727.json`） | 不要求 |
| validation nodes ≥83 / gate groups 51 | `validation-manifest` · gate-registry | 同上 | 不要求 |
| 流程强制 Mutation/路径 | `process-enforcement` + HostEnforcementMatrix | `test:process-enforcement-e2e` · `test:stop-gate` | L4 非默认 DoD |
| 交付诚实 / ECR 门禁 | process-enforcement + stop-gate | `test:delivery-honesty` · `test:ecr-closure` | 不要求 |
| 五宿主 adapter | host-parity / doctor 分层 | `test:host-parity` · `devcodex doctor` | doctor 可选；**native 就绪 ≠ 五宿主全绿** |
| 公开文本 | `public-text-surfaces.json` | `test:public-text-integrity` | 不要求 |

**宿主诚实（L0 摘要）**：

| 宿主 | PreTool 无 CP2 | Stop | UPS inject | 文档口径 |
|------|----------------|------|------------|----------|
| copilot | CLI hard-deny；**IDE fallback** | 事件支持时 | N/A | **CLI 与 IDE 分列** |
| claude | hard-deny | stop-block | 可 inject | hook-enforced 上限 |
| codex | hard-deny | stop-block | 可 context | 安装≠全事件硬拦 |
| gemini | 能则 hard | 能则 stop | **N/A** | 禁止假 inject |
| grok | PreTool deny | **条件** Stop | **N/A** | 禁止 UPS 假绿 |

Grok：**无 UPS inject**；Stop 为条件硬拦。Copilot：**CLI 与 IDE 能力不等价**（IDE 常为 instruction-fallback）。`devcodex doctor` 的 adapter match 与 native ready **分层**，不得把「adapter 5/5」写成「五宿主 CLI 全就绪」。

---

## 延伸阅读

- [设计理念](/intro/philosophy) — 为什么这样构建，而不是另一种方式
- [商业化规划](/intro/pricing) — v1 免费策略与 v2 商业化方向


> Skill 规模锚点：84 个 Skills；扁平一级 Skill（84 个）。
