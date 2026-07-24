# DevCodex 使用介绍

> 本站是 DevCodex 官方文档入口，面向需要在 Copilot / Claude Code / Codex 中统一 AI 开发工作流，并按需接入 Gemini CLI / Grok Build 的使用者和集成开发者。需求、实现和发布材料保留在“维护者指南”与“版本”分区，不占用第一次成功路径。

---

## DevCodex 是什么

DevCodex 是通过 npm 包和 CLI 分发的 AI 开发规范注入器。默认 `init` / `update` 部署五宿主：Copilot、Claude Code、Codex、Gemini CLI 与 Grok Build（Grok 含用户级 plugin 同步）；也可用 `--host <id>` 只安装或刷新单宿主。所有宿主从同一真相源生成精简入口，按意图读取 Skills，证据不足时回退完整规范。

站点同时保留稳定规范和版本化维护资料；历史版本目录中的旧需求页只代表当时基线，不等同于当前实现。当前安装、命令和宿主支持以仓库 [README](https://github.com/vextjs/devcodex#安装) 与当前发布版本为准。

---

## 快速开始

> 版本语义：npm package 当前发布版本是 **v1.15.3**；站内 **1.0.1** 是活动需求文档版本。当前版本仅发布到 GitHub Packages，安装需要 `read:packages` 认证；Gemini / Grok 通用宿主选择器随 v1.15.3 发布。

1. 确认 Node.js >=18；按 [安装说明](https://github.com/vextjs/devcodex#5-分钟快速开始) 配置 `@vextjs:registry=https://npm.pkg.github.com` 与当前 shell 的 `NODE_AUTH_TOKEN`。
2. 安装并从目标项目初始化五宿主规范，然后执行 status：

```bash
npm install @vextjs/devcodex
npx @vextjs/devcodex init
npx @vextjs/devcodex status
```

只部署单一宿主 adapter 时使用：

```bash
npx @vextjs/devcodex init --claude
npx @vextjs/devcodex init --codex
```

执行完成后，普通仓库会在项目根出现对应宿主文件；workspace-namespace 会把这些受管文件统一写到工作区根，子项目不生成 `.github/.claude/.codex/.gemini/.grok` 或入口文件。新开 AI 会话并发送开发、修复或审查任务，即可验证入口检查、工作流路由、报告与记忆是否生效。安装出现 401/403 时检查 scope registry、`read:packages` 与当前 shell 的 `NODE_AUTH_TOKEN`。完整命令、更新方式和排错步骤见 [README](https://github.com/vextjs/devcodex)。

每次 `init/update` 都会在 active runtime root 更新 managed deployment manifest，并预览新增、更新、陈旧和未受管文件。陈旧文件只报告、不自动删除；未受管文件不会被 DevCodex 接管；同一规范化物理 destination 只能有一个 current owner。workspace-namespace 下宿主资产统一由工作区拥有：Grok 使用工作区薄插件与官方用户级本地插件登记，子项目默认不生成任何宿主目录或入口文件；安装登记保持用户配置原始字节。工作区根可直接运行 `grok`，子 Git 项目的完整 kernel 路线使用 `devcodex grok`，plain child 仅为 best-effort Skill discovery。Grok 与 Codex 的能力对照、诊断命令与平台上限见 **[Grok 宿主与 Codex 对齐说明](/intro/host-parity-grok)**。

---

## 核心设计目标

| 目标 | 解法 |
|------|------|
| AI 行为可预期 | 通过 CP 与工作流骨架把 AI 行为先定义清楚 |
| 跨会话上下文保持 | 通过 `.devcodex/.memory/` 写入 Agent 日记、需求记忆与项目总记忆 |
| 工作流行为可审计 | 通过报告、audit-state 与合规检查形成可追溯闭环 |
| 规范随代码版本化 | 用版本文档管理规范演进与实现边界 |
| 跨项目复用 | 普通仓库安装到项目根；workspace-namespace 安装到共享 owner 根，并用 `update` 同步受管规范 |
| 多宿主一致入口 | 默认五宿主（Copilot / Claude Code / Codex / Gemini / Grok）；可用 `--host` 缩到单宿主；共用同一规范源与精简投影，Hook 能力按宿主/事件降级，并按官方输出契约区分顶层 block、`continue:false` 与工具级 deny |
| 上下文成本可控 | always-on 入口使用有 coverage 与预算约束的精简 kernel；Claude / Gemini 仅保留薄 wrapper，具体流程按意图加载 Skills，完整规范作为 fail-closed fallback |
| 长任务停滞可诊断 | `TurnLivenessRecoveryGate` 区分运行、等待续接、可疑、可恢复停滞与终态，记录工具租约、continuation ACK 和 checkpoint；Hook 只在事件到达时观察，不承诺自行唤醒宿主或自动重放写操作 |
| 文件真相源优先 | `MemoryCannotSatisfyBootstrapGate` 要求宿主 Memories、模型长期偏好或交接卡只作为 `navigation-hint`，新线程 / resume / summary 恢复仍读取 Profile、tasks、reports 和源码 / 文档真相源 |
| Profile 真相对账 | 项目级 analyze/audit 用 `ProfileTruthMatrix` 对照 Profile 声明与当前代码、配置、运行和发布事实；过期 Profile 不覆盖现实，只读工作流不直接改 Profile |
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

## 组件构成

| 组件 | 说明 |
|------|------|
| Agent | `devcodex.agent.md`（确认模式）+ `devcodex-auto.agent.md`（全自动模式）|
| Host kernel / Instructions | 宿主自动发现精简 kernel；节点 Instructions 与 Skills 按平台能力和意图加载，完整规范保留非 always-on fallback |
| Skills | 当前源码维护 83 个按需触发的工作流技能（80 active + 3 gray）；active `host-capability-routing` 以薄 Rule + Skill + 版本化 catalog/contracts 将原始用户意图映射到五宿主 8 个 surface variant，直接证据不足时保持 portable fallback，当前不新增 MCP Tool；另有 `requirement-parallel-orchestration`、active `repair-prevention-assessment`，gray `rework-prevention-engineering`、`consumer-validation-engineering`、`brand-visual-quality`，以及 `user-visible-output-contract`、`host-instruction-projection`、`analyze-default`、`skill-gap-analysis`、`skill-lifecycle-governance`、`spec-absorption`、`user-manual-authoring`、`audit-user-manual`、`expert-output-quality`、`review-checklist`、`evolution-governance`、`readme-authoring`、`audit-readme`、`audit-release`、`execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync`；专家能力保持 21 个专家 Owner Skill |
| Prompts | CP 节点输出模板 |
| Hooks | `UserPromptSubmit` / `PreToolUse` / `Stop` 等生命周期钩子 |
| Codex adapter | `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json` |
| Gemini / Grok adapter | v1.15.3 通过 `--host gemini|grok|all` 显式部署；Grok workspace 模式使用非自动发现 source `.grok/devcodex/plugins/devcodex-workspace` 与单一官方用户级本地插件登记，child project 零 generated host artifacts；root 为 Native，plain child 为 Partial，`devcodex grok --rules` 为 Full；显式 `project-portable` 才生成项目 adapter，能力按 direct / fixture / instruction-backed 证据分级 |

---

## 合规检查说明

> ⚠️ DevCodex 合规检查采用四层框架（FC / SC / RC / T），用于 AI 自身执行质量与收尾闭环检查，不是对用户业务代码的生产合规校验。

它检查的是 AI 自身的执行质量：记忆文件是否写入、fix 三步扫描是否执行、dev 后是否运行了 lint/typecheck 等。

详细定义见：[合规检查框架](/specs/compliance-framework)。

---

## 延伸阅读

- [设计理念](/intro/philosophy) — 为什么这样构建，而不是另一种方式
- [商业化规划](/intro/pricing) — v1 免费策略与 v2 商业化方向


> Skill 规模锚点：83 个 Skills；扁平一级 Skill（83 个）。
