# 项目介绍

> ⚠️ **本站为 DevCodex 内部开发文档**，面向核心开发团队。商业化产品介绍和用户文档将单独建站。

---

## DevCodex 是什么

DevCodex 当前处于**本地文件版持续迭代阶段**。  
这个站点的作用，是持续同步 DevCodex 作为 Copilot / Claude Code 双主支持并升级到 Codex 三宿主支持的规范注入器目标形态、当前实现边界、目录结构、执行骨架、版本边界和后续路线。

因此，你现在看到的内容同时包含**需求、规范、设计决策与当前实现说明**；历史版本目录中的旧需求页只代表当时基线，不等同于当前实现。

---

## 核心设计目标

| 目标 | 解法 |
|------|------|
| AI 行为可预期 | 通过 CP 与工作流骨架把 AI 行为先定义清楚 |
| 跨会话上下文保持 | 通过 `.devcodex/.memory/` 写入 Agent 日记、需求记忆与项目总记忆 |
| 工作流行为可审计 | 通过报告、audit-state 与合规检查形成可追溯闭环 |
| 规范随代码版本化 | 用版本文档管理规范演进与实现边界 |
| 跨项目零配置复用 | 目标是后续通过 `devcodex init` 安装到任意项目 |
| 多宿主一致入口 | Copilot、Claude Code 与 Codex 共用同一规范源，分别落到 `.github/`、`CLAUDE.md + .claude/`、`AGENTS.md + .agents/ + .codex/`；Hook 能力按宿主/事件降级，并按官方输出契约区分顶层 block、`continue:false` 与工具级 deny |
| 平台升级免维护 | 提前对齐官方目录规范，降低后续实现风险 |
| 灵活的执行模式 | 提供确认模式与 Auto v1.1；Auto 通过显式 `@devcodex-auto` 或明确自然语言 auto 授权进入，仅对白名单路径提供自动推进保证，控制面/多批次任务仍受 ExecutionContract 约束 |
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
| `@devcodex-auto` | Auto v1.1 | 熟悉流程后的治理文件、文档、`.devcodex/` 产物等白名单路径快速迭代 |

> Auto v1.1 的正式入口包括显式 `@devcodex-auto` 与明确自然语言 auto 授权（如“进入 auto 模式执行”）。它只在 hook-enforced 宿主里对白名单路径形成 runtime 级自动推进保证；模糊提及、询问 auto 规则或普通“继续”不算授权；非白名单源码路径默认回确认模式；默认 safety-only 流程提醒放行，危险命令硬拦且必须在用户明确确认 approval id 后才可一次性重试，安全底线始终强制执行。

---

## 组件构成

| 组件 | 说明 |
|------|------|
| Agent | `devcodex.agent.md`（确认模式）+ `devcodex-auto.agent.md`（全自动模式）|
| Instructions | 全局规范与工作流主规则，按 `applyTo` 全局注入 |
| Skills | 44 个按需触发的工作流技能，覆盖完整开发生命周期、规范治理、`readme-authoring` / `audit-readme` README 专项能力、`audit-release` 发布前审查，以及 `execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync` 支撑能力 |
| Prompts | CP 节点输出模板 |
| Hooks | `UserPromptSubmit` / `PreToolUse` / `Stop` 等生命周期钩子 |
| Codex adapter | `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json` |

---

## 合规检查说明

> ⚠️ DevCodex 合规检查采用四层框架（FC / SC / RC / T），用于 AI 自身执行质量与收尾闭环检查，不是对用户业务代码的生产合规校验。

它检查的是 AI 自身的执行质量：记忆文件是否写入、fix 三步扫描是否执行、dev 后是否运行了 lint/typecheck 等。

详细定义见：[合规检查框架](/specs/compliance-framework)。

---

## 延伸阅读

- [设计理念](/intro/philosophy) — 为什么这样构建，而不是另一种方式
- [商业化规划](/intro/pricing) — v1 免费策略与 v2 商业化方向
