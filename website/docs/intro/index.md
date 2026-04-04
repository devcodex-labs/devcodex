# 项目介绍

> ⚠️ **本站为 DevCodex 内部开发文档**，面向核心开发团队。商业化产品介绍和用户文档将单独建站。

---

## DevCodex 是什么

DevCodex 是一个通过 `devcodex init` 安装到项目 `.github/` 目录的 GitHub Copilot Agent Plugin，为 VS Code Copilot Agent 提供一套完整的、结构化的 AI 开发规范体系。

安装后，`@devcodex` Agent 按照内置的工作流规范执行开发、修复、审查等任务——不再是随机的 AI 输出，而是可预期、可审计的工程流程。

---

## 核心设计目标

| 目标 | 解法 |
|------|------|
| AI 行为可预期 | CP 确认机制（CP1→CP2→CP3），每步输出经过人工确认后再推进 |
| 跨会话上下文保持 | 记忆系统自动持久化每次会话，AI 知道上次做了什么 |
| 工作流行为可审计 | 每次执行自动写报告 + 记忆文件，行为完全可追溯 |
| 规范随代码版本化 | `.github/` 目录纳入 Git，团队共享同一套 AI 行为约束 |
| 跨项目零配置复用 | `devcodex init` 在任意项目安装，无需重新配置 |
| 平台升级免维护 | 严格遵循官方目录规范，平台升级无需修改 DevCodex |
| 灵活的执行模式 | `@devcodex` 确认模式保质量，`@devcodex-auto` 全自动提效率 |
| AI 对自身行为自检 | 合规检查（FC/SC/RC）在工作流执行后强制验证 AI 执行质量 |
| 分层功能授权 | Free/Pro/Enterprise 功能分层，按需启用高级工作流 |

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

详细流程见 [执行流程图](/specs/flowcharts)。

---

## Agent 入口

DevCodex 提供两个 Agent，选择权交给用户：

| Agent | 模式 | 适用场景 |
|-------|------|---------|
| `@devcodex` | 确认模式（默认）| 正式开发、架构变更、需要逐步确认 |
| `@devcodex-auto` | 全自动模式（Pro）| 熟悉流程后的快速迭代、批量操作 |

> `@devcodex-auto` 跳过所有 CP 节点确认，但安全底线（S01~S06）始终强制执行。

---

## 组件构成

| 组件 | 说明 |
|------|------|
| Agent | `devcodex.agent.md`（确认模式）+ `devcodex-auto.agent.md`（全自动模式）|
| Instructions | 全局规范，`applyTo: **` 强制注入每次会话 |
| Skills | 按需触发的工作流技能，覆盖完整开发生命周期 |
| Prompts | CP 节点输出模板 |
| Hooks | `UserPromptSubmit` / `Stop` 生命周期钩子 |

---

## 合规检查说明

> ⚠️ DevCodex 合规检查（FC/SC/RC）是 **AI 工作流执行阶段的自检机制**，不是对用户业务代码的生产合规校验。

它检查的是 AI 自身的执行质量：记忆文件是否写入、fix 三步扫描是否执行、dev 后是否运行了 lint/typecheck 等。

---

## 延伸阅读

- [设计理念](/intro/philosophy) — 为什么这样构建，而不是另一种方式
- [套餐与定价](/intro/pricing) — 商业化规划参考（正式销售站点待建）

