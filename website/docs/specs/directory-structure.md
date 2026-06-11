# 项目目录结构规范

> 本文档定义 DevCodex 的目录结构标准，以 GitHub Copilot / VS Code Copilot 官方自定义规范为基准，并补充 Claude Code 与 Codex 适配分发面。  
> 本页同时明确哪些是**官方组件**，哪些是 **DevCodex 扩展约定**。

---

## 三层加载架构

DevCodex 的核心设计问题是：**主流程里有十几个节点规范，如何高效注入 AI 上下文，同时不撑爆上下文窗口？**

官方 VS Code Copilot 提供三种加载方式：

| 方式 | 触发机制 | 特点 |
|------|---------|------|
| `copilot-instructions.md` | 每次会话全量自动注入 | 始终在线，上下文成本固定 |
| `*.instructions.md` | `applyTo` 文件匹配 或 `description` 语义判断 | 按需加载，平台自动决策 |
| `skills/<name>/SKILL.md` | 用户触发或 Agent 判断调用 | 触发时加载，最省上下文 |

基于这三种方式，DevCodex 采用**三层分层架构**：

```
第一层：copilot-instructions.md / CLAUDE.md / AGENTS.md ← 核心规则 + 安全底线 + 通用规范（始终全量注入）
第二层：instructions/*.md       ← 主流程节点执行规范（语义按需加载）
第三层：skills/<name>/SKILL.md ← 工作流执行细节（触发时加载）
```

---

## 为什么这样分层

### 第一层用 copilot-instructions.md / CLAUDE.md / AGENTS.md — 不能按需的内容

核心规则、安全底线、通用规范是整个执行体系的**前置条件**——AI 不读这三样，就不知道主流程是什么、安全底线在哪里、规范优先级怎么合并。

这三样必须在任何任务开始前就加载完毕，没有"按需"的可能性，所以放进始终注入的 `copilot-instructions.md`、`CLAUDE.md` 或 `AGENTS.md`。  
同时把内容控制在最小必要集合，避免 always-on 入口过重。

### 第二层用 `*.instructions.md` — 节点规范按语义匹配

主流程里的中间节点（摘要、记忆、合规检查等）本质上是执行约束规范，适合 `*.instructions.md`。  
VS Code Copilot 会根据 `description` 语义判断当前任务是否需要加载，不需要每次全量注入。  
即使某节点规范未被加载，`copilot-instructions.md` 里的主流程骨架也能兜底，不会完全失控。

### 第三层用 Skills — 工作流执行细节只在触发时加载

dev / fix / audit 等工作流的执行细节，只有在用户或 Agent 实际触发对应工作流时才需要。  
官方 Skills 机制正好适配这个场景——触发时加载，不触发不占用上下文。

---

## 各组件职责说明

| 层级 | 组件 | 官方定位 | DevCodex 中的用途 |
|------|------|---------|-----------------|
| 第一层 | **copilot-instructions.md / CLAUDE.md / AGENTS.md** | 始终注入的全局指令 | 核心规则 + 安全底线 + 通用规范 |
| 第二层 | **Instructions** | 按需加载的规范约束（`description` 语义匹配）| 主流程节点执行规范（预检查/摘要/记忆/合规等）|
| 第三层 | **Skills** | 按需触发的工作流能力入口 | dev / fix / audit / analyze / self-fix / plan / resume / chat，以及 `readme-authoring` / `audit-readme` README 专项能力、`audit-release` 发布前审查和 execution-contract / test-router / release-verification / host-contract-verification / source-consumer-sync 等支撑能力 |
| 配套 | **Prompts** | 有参数的结构化输出模板 | CP 节点输出模板（CP1/CP2/CP3）|
| 分发资产 | **Agents** | Copilot 自定义 Agent 入口 | `@devcodex` / `@devcodex-auto`；Auto 别名全局默认 `@rocky`，Profile `extensions.devcodex.autoAliases` 可替换默认别名；Copilot 端默认分发，Claude Code / Codex 端不分发 |

---

## 官方组件 vs DevCodex 扩展

| 类型 | 名称 | 归属 | 说明 |
|------|------|------|------|
| 官方组件 | Custom Instructions / Skills / Instructions / Prompts | 官方 | 平台可识别并自动加载或按需触发的资产格式 |
| DevCodex 扩展 | CP1 / CP2 / CP3 | 自定义 | DevCodex 的确认节点体系，不是官方内建能力 |
| DevCodex 扩展 | ConcurrencyPolicy | 自定义 | Profile `extensions.devcodex.concurrency` 描述只读/验证并发策略；核心单写者域不由项目配置删除 |
| DevCodex 扩展 | major/minor 版本文档结构 | 自定义 | 文档站采用 `versions/v1/<active-version>/` 承载当前迭代，`1.0.0` 仅保留历史基线 |

> 结论：**官方标准负责"可被平台发现与加载"**，DevCodex 在此之上定义执行流程与分层规范。

---

## 官方标准概览

DevCodex 当前默认安装面向目标项目分发以下目录和文件：

| 组件 | 路径 | 说明 |
|------|------|------|
| Agents | `.github/agents/*.agent.md` | Copilot 端默认分发；Claude Code 端不分发 |
| Skills | `.github/skills/<name>/SKILL.md` | 扁平一级目录，`name` 与文件夹名一致 |
| Instructions | `.github/instructions/*.instructions.md` | 按需规范，`description` 语义匹配或 `applyTo` 文件匹配 |
| Prompts | `.github/prompts/*.prompt.md` | CP 节点模板 |
| Hooks | `.github/hooks/*` | 宿主生命周期 Hook 配置与运行时 |
| Data | `.github/data/*` | 运行时模板（如 `violations.md`、`pending-fixes.md`、`gap-registry.md`） |
| 全局始终注入 | `.github/copilot-instructions.md` | 每次会话自动全量加载 |
| Claude Code adapter | `CLAUDE.md` + `.claude/{instructions,skills,prompts,hooks/_runtime,mcp,data}` + `.mcp.json` | Claude Code 项目规则、hooks 与 MCP |
| Codex adapter | `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json` + `.codex/hooks/_runtime/` | Codex 工作区规则、Skill 与 Hook 入口 |

> 说明：`v1.9.8` 起，`devcodex init/update` 已恢复 Copilot 端 `.github/agents/` 默认分发；`devcodex init --claude` 与 `devcodex init --codex` 仍不分发 agents。

---

## 目录结构骨架

> 当前骨架反映 v1.11.2+ 的本地文件版分发面；具体数量以 README 与项目 profile 的资产清单为准。

```text
<project-root>/
│
├── .github/
│   ├── copilot-instructions.md          ← 第一层：核心规则 + 安全底线 + 通用规范
│   ├── agents/                          ← Copilot Agent 入口（devcodex / devcodex-auto）
│   │
│   ├── instructions/                    ← 第二层：全局约束 + 工作流主规则
│   │   ├── 00-safety.instructions.md
│   │   ├── 01-common.instructions.md
│   │   ├── 01a-profile-loading.instructions.md
│   │   ├── 01b-record-router.instructions.md
│   │   ├── 01c-intent-expansion.instructions.md
│   │   ├── 02-output-paths.instructions.md
│   │   ├── 10-dev.instructions.md       ← dev 工作流
│   │   ├── 11-fix.instructions.md       ← fix 工作流
│   │   ├── 12-audit.instructions.md     ← audit 工作流
│   │   ├── 13-analyze.instructions.md   ← analyze 工作流
│   │   ├── 14-self-fix.instructions.md  ← self-fix 工作流
│   │   ├── 15-memory.instructions.md
│   │   ├── 16-report.instructions.md
│   │   ├── 17-compliance.instructions.md
│   │   └── 18-spec-radar.instructions.md
│   │
│   ├── skills/                          ← 第三层：扁平一级 Skill（44 个）
│   │   ├── dev-default/SKILL.md
│   │   ├── fix-default/SKILL.md
│   │   ├── audit-common/SKILL.md
│   │   └── ...
│   │
│   ├── prompts/                         ← CP 确认节点输出模板
│   │   ├── requirement.prompt.md
│   │   ├── technical-design.prompt.md
│   │   ├── implementation-plan.prompt.md
│   │   └── ...
│   │
│   ├── hooks/                           ← Workspace Hooks 配置与运行时
│   ├── data/                            ← 运行时数据模板
│   └── RULES.md                         ← 使用入口
│
├── CLAUDE.md                             ← Claude Code 第一层入口（由 instructions.md 生成）
├── .claude/                              ← Claude Code instructions/skills/prompts/hooks/mcp/data
├── AGENTS.md                             ← Codex 第一层入口（由 instructions.md 生成）
├── .agents/skills/                       ← Codex Skill 目录
├── .codex/
│   ├── hooks.json                        ← Codex Hook 入口配置
│   └── hooks/_runtime/lifecycle.cjs      ← 统一生命周期运行时
│
├── .devcodex/                           ← workspace-namespace 运行态（不提交 Git）
│   ├── <project>/                           单项目 active-root：profile / requirements / reports / .memory / .audit-state
│   └── workspace/                           全工作区 active-root：profile / reports / .memory / .audit-state
│
└── website/                             ← 文档站
```

启用 `workspace-namespace` 后，workspace 根的 Profile 路径是 `.devcodex/workspace/profile/`；单项目 Profile 路径是 `.devcodex/<project>/profile/`。多项目 workspace 根缺少 workspace profile 时，Hook warning 必须指向 `.devcodex/workspace/profile/`，不能再提示 legacy `.devcodex/profile/`。

其中 `01-common.instructions.md` 现在作为 common-base / 锚点文件保留跨消费者最短规则，`01a-profile-loading.instructions.md`、`01b-record-router.instructions.md`、`01c-intent-expansion.instructions.md` 承载拆分后的 Profile / RecordRouter / Intent Expansion 细节。

---

## 各组件官方格式

### 1. copilot-instructions.md / CLAUDE.md / AGENTS.md

```markdown
# DevCodex Instructions

<!-- 核心规则、安全底线、通用规范内容 -->
```

无 frontmatter，纯 Markdown，按宿主放入 `.github/copilot-instructions.md`、项目根 `CLAUDE.md` 或工作区根 `AGENTS.md`，每次会话自动全量注入。

---

### 2. Skills

```yaml
---
name: skill-name
description: 'What and when to use. Max 1024 chars.'
---
Markdown 内容
```

`spec-governance` 是规范治理专用 Skill，负责记录类意图识别、RecordRouter 台账分流，以及 SCV（Spec Change Verification）规范变更验证。`readme-authoring` 与 `audit-readme` 负责 README / 用户使用文档的用户视角写作与专项审查。`audit-release` 负责发布前审查，判断 release readiness、发布说明质量、兼容/迁移风险、包元数据、文档/Profile/website 同步、回滚策略、registry/tag 风险与发布后验收；`release-verification` 继续负责 R0~R7 执行验证链。`execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync` 是支撑型 Skill，用于长流程边界、验证路线、正式发布前检查、宿主契约证据与真相源-消费者同步，不新增工作流分支。

---

### 3. Instructions

```yaml
---
applyTo: "**"
---
Markdown 内容
```

DevCodex 当前采用单源入口 + 路由后按需读取 Skill 的组合：Copilot 使用 `copilot-instructions.md`，Claude Code 使用 `CLAUDE.md`，Codex 使用 `AGENTS.md`；三者都由 `instructions.md` 生成，不维护独立 `codex/AGENTS.md`。

---

### 4. Prompts

```yaml
---
description: "<推荐>"
name: "Prompt Name"
---
Markdown 内容
```

---

### 6. Hooks

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "type": "command", "command": "./scripts/hook.sh", "timeout": 15 }]
  }
}
```

**官方事件**：`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PreCompact` / `PostCompact` / `SubagentStart` / `SubagentStop` / `Stop`

DevCodex 当前默认注册 `PreCompact`，用于在手动或自动压缩前执行 S07 / 记忆 / 报告等闭环检查；`PostCompact` 是官方事件，但当前未作为 DevCodex 默认模板事件注册。

---

## 为什么不列详细文件清单

1. 文件数量会随 patch 迭代变化，应以 README 和 profile 资产清单为当前事实源
2. v1 与 v2 实现策略不同（v2 存在 MCP / MongoDB 平台化演进）
3. 本页只冻结分发面和目录职责，具体文件列表由源码目录实际内容决定

> 结论：本页冻结**三层架构原则、分发面与目录职责**；数量类信息需要与 README/profile 同步维护。
