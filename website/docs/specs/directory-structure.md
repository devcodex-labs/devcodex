# 项目目录结构规范

> 本文档定义 DevCodex 的目录结构标准，以 GitHub Copilot / VS Code Copilot 官方自定义规范为基准。  
> 本页同时明确哪些是**官方组件**，哪些是 **DevCodex 扩展约定**。

---

## 三层加载架构

DevCodex 的核心设计问题是：**主流程里有十几个节点规范，如何高效注入 AI 上下文，同时不撑爆上下文窗口？**

官方 VS Code Copilot 提供三种加载方式：

| 方式 | 触发机制 | 特点 |
|------|---------|------|
| `AGENTS.md` / `copilot-instructions.md` | 每次会话全量自动注入 | 始终在线，上下文成本固定 |
| `*.instructions.md` | `applyTo` 文件匹配 或 `description` 语义判断 | 按需加载，平台自动决策 |
| `skills/<name>/SKILL.md` | 用户触发或 Agent 判断调用 | 触发时加载，最省上下文 |

基于这三种方式，DevCodex 采用**三层分层架构**：

```
第一层：AGENTS.md              ← 核心规则 + 安全底线 + 通用规范（始终全量注入）
第二层：instructions/*.md      ← 主流程节点执行规范（语义按需加载）
第三层：skills/<name>/SKILL.md ← 工作流执行细节（触发时加载）
```

---

## 为什么这样分层

### 第一层用 AGENTS.md — 不能按需的内容

核心规则、安全底线、通用规范是整个执行体系的**前置条件**——AI 不读这三样，就不知道主流程是什么、安全底线在哪里、规范优先级怎么合并。

这三样必须在任何任务开始前就加载完毕，没有"按需"的可能性，所以放进始终注入的 `AGENTS.md`。  
同时把内容控制在最小必要集合，避免 `AGENTS.md` 过重。

### 第二层用 `*.instructions.md` — 节点规范按语义匹配

主流程里的中间节点（摘要、记忆、合规检查等）本质上是执行约束规范，适合 `*.instructions.md`。  
VS Code Copilot 会根据 `description` 语义判断当前任务是否需要加载，不需要每次全量注入。  
即使某节点规范未被加载，`AGENTS.md` 里的主流程骨架也能兜底，不会完全失控。

### 第三层用 Skills — 工作流执行细节只在触发时加载

dev / fix / audit 等工作流的执行细节，只有在用户或 Agent 实际触发对应工作流时才需要。  
官方 Skills 机制正好适配这个场景——触发时加载，不触发不占用上下文。

---

## 各组件职责说明

| 层级 | 组件 | 官方定位 | DevCodex 中的用途 |
|------|------|---------|-----------------|
| 第一层 | **AGENTS.md** | 始终注入的全局指令 | 核心规则 + 安全底线 + 通用规范 |
| 第二层 | **Instructions** | 按需加载的规范约束（`description` 语义匹配）| 主流程节点执行规范（预检查/摘要/记忆/合规等）|
| 第三层 | **Skills** | 按需触发的工作流能力入口 | dev / fix / audit / analyze / self-fix / plan / resume / chat |
| 配套 | **Agents** | 定义 AI 角色、工具权限、行为边界 | `@devcodex`（确认模式）/ `@devcodex-auto`（全自动模式）|
| 配套 | **Prompts** | 有参数的结构化输出模板 | CP 节点输出模板（CP1/CP2/CP3）|
| 配套 | **Hooks** | 生命周期钩子，执行 shell 命令（确定性）| `UserPromptSubmit` 注入上下文 / `Stop` 触发后置操作 |

---

## 官方组件 vs DevCodex 扩展

| 类型 | 名称 | 归属 | 说明 |
|------|------|------|------|
| 官方组件 | Agents / Skills / Instructions / Prompts / Hooks / AGENTS.md | 官方 | 平台可识别的目录与文件格式 |
| DevCodex 扩展 | CP1 / CP2 / CP3 | 自定义 | DevCodex 的确认节点体系，不是官方内建能力 |
| DevCodex 扩展 | major/minor 版本文档结构 | 自定义 | 文档站采用 `versions/v1/1.0.0/` 以容纳同一大版本的多次迭代 |

> 结论：**官方标准负责"可被平台发现与加载"**，DevCodex 在此之上定义执行流程与分层规范。

---

## 官方标准概览

VS Code Copilot 识别以下目录和文件类型（均位于 `.github/` 下）：

| 组件 | 路径 | 说明 |
|------|------|------|
| Agent | `.github/agents/*.agent.md` | 两个入口（确认模式 + 全自动模式）|
| Skills | `.github/skills/<name>/SKILL.md` | 扁平一级目录，`name` 与文件夹名一致 |
| Instructions | `.github/instructions/*.instructions.md` | 按需规范，`description` 语义匹配或 `applyTo` 文件匹配 |
| Prompts | `.github/prompts/*.prompt.md` | CP 节点模板 |
| Hooks | `.github/hooks/*.json` | 生命周期钩子 |
| 全局始终注入 | `AGENTS.md`（根目录）或 `.github/copilot-instructions.md` | 每次会话自动全量加载 |

---

## 目录结构骨架

> 当前仍在流程定义阶段，以下骨架只冻结**结构原则**，不冻结具体文件数量。

```text
<project-root>/
│
├── AGENTS.md                            ← 第一层：核心规则 + 安全底线 + 通用规范
│
├── agents/
│   ├── devcodex.agent.md                ← @devcodex（确认模式）
│   └── devcodex-auto.agent.md           ← @devcodex-auto（全自动模式）
│
├── instructions/                        ← 第二层：主流程节点执行规范（按需加载）
│   ├── precheck.instructions.md             ① 预检查（意图/profile/落点）
│   ├── summary.instructions.md              ③ 写入摘要
│   ├── memory.instructions.md               ④⑪ 检索/更新记忆
│   ├── pre-state-summary.instructions.md    ⑤ 前置状态汇总
│   ├── dev-compliance.instructions.md       ⑥ 开发阶段合规检查
│   ├── exec-compliance.instructions.md      ⑨ 执行阶段合规检查
│   ├── report.instructions.md               ⑩ 输出报告
│   └── completion-compliance.instructions.md ⑫ 完成前合规检查
│
├── skills/                              ← 第三层：工作流入口（触发时加载）
│   ├── dev/SKILL.md
│   ├── fix/SKILL.md
│   ├── audit/SKILL.md
│   ├── analyze/SKILL.md
│   ├── self-fix/SKILL.md
│   ├── plan/SKILL.md
│   ├── resume/SKILL.md
│   └── chat/SKILL.md
│
├── prompts/                             ← CP 确认节点输出模板
│   ├── cp1-requirements.prompt.md
│   ├── cp2-design.prompt.md
│   └── cp3-implementation.prompt.md
│
├── hooks/                               ← 生命周期钩子
│
├── .devcodex/                           ← 运行时数据（不提交 Git）
│   ├── profile/                             项目 profile 上下文
│   ├── .memory/                             ④⑪ 记忆读写
│   └── reports/                             ⑩ 输出报告存放
│
└── website/                             ← 文档站
```

---

## 各组件官方格式

### 1. AGENTS.md

```markdown
# DevCodex Agent Instructions

<!-- 核心规则、安全底线、通用规范内容 -->
```

无 frontmatter，纯 Markdown，放项目根目录，每次会话自动全量注入。

---

### 2. Agents

```yaml
---
description: "<必填，供子 Agent 发现用，富含关键词>"
name: "Agent Name"
tools: [read, edit, search, execute, web]
model: "Claude Sonnet 4"
---
Markdown 内容
```

---

### 3. Skills

**目录结构**：
```
skills/<skill-name>/
├── SKILL.md        ← 必填，name 字段必须与文件夹名完全一致
├── references/     ← 详细流程内容（按需加载）
├── scripts/
└── assets/
```

**SKILL.md frontmatter**：
```yaml
---
name: skill-name
description: 'What and when to use. Max 1024 chars.'
---
```

---

### 4. Instructions

```yaml
---
description: "当执行 XX 阶段时加载此规范"   ← 语义匹配触发
---
Markdown 内容
```

**加载方式**：
| 方式 | 触发条件 |
|------|---------|
| `description` 语义匹配 | Agent 判断当前任务与描述相关时自动加载 |
| `applyTo` 文件匹配 | 上下文中有匹配文件时自动附加 |
| 手动 | 用户手动添加到上下文 |

---

### 5. Prompts

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

**官方事件**：`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PreCompact` / `SubagentStart` / `SubagentStop` / `Stop`

---

## 为什么不列详细文件清单

1. 当前处于流程与规范定义阶段，详细文件清单会被误读为"已落地"
2. v1.0.0 和 v2.0.0 实现策略不同（v2 存在 MCP / MongoDB 平台化演进）
3. 骨架原则冻结后，具体文件随实现阶段按需补充

> 结论：本页冻结**三层架构原则与骨架结构**，不冻结具体文件数量。
