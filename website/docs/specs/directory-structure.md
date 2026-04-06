# 项目目录结构规范

> 本文档定义 DevCodex 的目录结构标准，以 GitHub Copilot / VS Code Copilot 官方自定义规范为基准。  
> 本页同时明确哪些是**官方组件**，哪些是 **DevCodex 扩展约定**。

---

## 各组件职责说明

| 组件 | 官方定位 | DevCodex 中的用途 |
|------|---------|-----------------|
| **Agents** | 定义 AI 的角色、工具权限、运行模式和行为边界 | `@devcodex`（确认模式）/ `@devcodex-auto`（全自动模式）两个入口 Agent |
| **Skills** | 按需触发的工作流能力入口，用户可 `/skill-name` 或 AI 自动调用 | **薄壳入口层**：SKILL.md 极简，触发后指向 `workflows/` 读取详细流程 |
| **Instructions** | 全局注入的规范约束，`applyTo` 控制生效范围，每次会话自动加载 | 工作流规则（dev/fix/audit...）+ 安全底线（S01~S06）+ 合规规则（FC/SC）|
| **Prompts** | 单次有参数的任务模板，`/prompt-name` 触发，结构化输出 | CP 节点输出模板（CP1需求确认、CP2方案确认、CP3实施计划等）|
| **Hooks** | 生命周期钩子，在特定事件执行 shell 命令（确定性，不可被 AI 绕过）| `UserPromptSubmit` 注入上下文 / `Stop` 触发后置操作 |
| **Workflows** | ⚠️ DevCodex 自定义目录（非官方组件）| 存储各 Skill 的详细工作流内容，Skills 薄壳读取此目录执行 |

> **核心区别**：Instructions 是"始终有效的约束"，Skills 是"按需触发的入口"，Workflows 是"实际工作流内容"，Prompts 是"结构化输出模板"，Hooks 是"确定性的生命周期动作"。

---

## 官方组件 vs DevCodex 扩展

| 类型 | 名称 | 归属 | 说明 |
|------|------|------|------|
| 官方组件 | Agents / Skills / Instructions / Prompts / Hooks | 官方 | 平台可识别的目录与文件格式 |
| DevCodex 扩展 | `workflows/` | 自定义 | 给薄壳 Skill 提供详细流程内容 |
| DevCodex 扩展 | CP1 / CP2 / CP3 | 自定义 | DevCodex 的确认节点体系，不是官方内建能力 |
| DevCodex 扩展 | major/minor 版本文档结构 | 自定义 | 文档站采用 `versions/v1/1.0.0/` 以容纳同一大版本的多次迭代 |

> 结论：**官方标准负责“可被平台发现”**，DevCodex 扩展负责“如何组织复杂流程内容”。

---

## 官方标准概览

VS Code Copilot 识别以下目录和文件类型（均位于 `.github/` 下）：

| 组件 | 路径 | 说明 |
|------|------|------|
| Agent | `.github/agents/*.agent.md` | 两个入口（确认模式 + 全自动模式）|
| Skills | `.github/skills/<name>/SKILL.md` | 扁平一级目录，`name` 与文件夹名一致 |
| Instructions | `.github/instructions/*.instructions.md` | 全局规范，`applyTo` 控制生效范围 |
| Prompts | `.github/prompts/*.prompt.md` | CP 节点模板 |
| Hooks | `.github/hooks/*.json` | 生命周期钩子 |
| 全局指令（官方参考） | `.github/copilot-instructions.md` 或根目录 `AGENTS.md` | 当前阶段仅作为官方能力参考，不视为已启用 |

---

## 组件职责速查

| 组件 | 核心职责 | DevCodex 中的角色 | 触发方式 |
|------|---------|-----------------|---------|
| **Agents** | 定义 AI 身份、工具权限、行为边界 | `@devcodex`（确认模式）/ `@devcodex-auto`（全自动）| 用户在 Chat 选择 Agent |
| **Skills** | 按需触发的工作流**入口**（薄壳）| 路由层：接收意图 → 指向 `workflows/` 详细流程 | `/skill-name` 或 AI 自动发现 |
| **workflows/** | 工作流**详细内容**（非官方组件，自定义目录）| 每个 Skill 对应的完整执行流程文件集合 | 由 SKILL.md 引用读取 |
| **Instructions** | 始终有效的全局规范约束 | 工作流规则（dev/fix/audit）+ 安全底线 + 合规规则 | 每次会话自动注入 |
| **Prompts** | 有参数的结构化输出模板 | CP 节点模板（需求确认/方案确认/实施计划）| `/prompt-name` 或 AI 调用 |
| **Hooks** | 生命周期事件的 shell 钩子（确定性执行）| `UserPromptSubmit` 注入上下文 / `Stop` 触发后置操作 | 平台事件自动触发 |

> **关键区别**：Instructions 是"约束"（始终有效），Skills 是"能力入口"（按需触发），workflows/ 是"执行内容"（由 Skills 读取）。

---

## 各组件官方格式

### 1. Agents

```yaml
---
description: "<必填，供子 Agent 发现用，富含关键词>"
name: "Agent Name"           # 可选，默认取文件名
tools: [read, edit, search, execute, web]  # 可选
model: "Claude Sonnet 4"     # 可选
argument-hint: "Task..."     # 可选
user-invocable: true         # 可选，是否显示在 Agent 选择器（默认 true）
---
Markdown 内容
```

---

### 2. Skills

**目录结构**：
```
.github/skills/<skill-name>/     ← 必须是扁平一级目录，不能嵌套
├── SKILL.md                     ← 必填，name 字段必须与文件夹名完全一致
├── scripts/                     ← 可执行脚本
├── references/                  ← 参考文档（按需加载）
└── assets/                      ← 模板、样板文件
```

**SKILL.md frontmatter**：
```yaml
---
name: skill-name              # 必填：1-64字符，小写字母数字+连字符，必须与文件夹名一致
description: 'What and when to use. Max 1024 chars.'  # 必填
argument-hint: '可选提示'      # 可选
user-invocable: true          # 可选，是否显示为斜杠命令（默认 true）
disable-model-invocation: false  # 可选，禁止模型自动触发（默认 false）
---
```

---

### 3. Instructions

```yaml
---
description: "<强烈推荐，供按需发现用>"  # on-demand 模式必填
name: "Instruction Name"               # 可选
applyTo: "**/*.ts"                     # 可选，匹配文件时自动附加
---
Markdown 内容
```

**发现模式**：
| 模式 | 触发条件 | 用途 |
|------|---------|------|
| 按需（`description`）| Agent 判断任务相关性 | 任务型：迁移、重构、API |
| 显式（`applyTo`）| 上下文中有匹配文件 | 文件型：语言规范、框架规则 |
| 手动 | 用户手动添加上下文 | 临时附加 |

---

### 4. Prompts

```yaml
---
description: "<推荐，提升可发现性>"  # 可选
name: "Prompt Name"                  # 可选
argument-hint: "Task..."             # 可选
agent: "agent"                       # 可选：ask / agent / plan / 自定义 agent
model: "GPT-5 (copilot)"             # 可选
tools: [search, web]                 # 可选
---
Markdown 内容
```

---

### 5. Hooks

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "./scripts/hook.sh",
        "timeout": 15
      }
    ]
  }
}
```

**官方事件名**（区分大小写）：
| 事件 | 触发时机 |
|------|---------|
| `SessionStart` | 新会话第一条消息 |
| `UserPromptSubmit` | 用户提交消息 |
| `PreToolUse` | 工具调用前 |
| `PostToolUse` | 工具调用成功后 |
| `PreCompact` | 上下文压缩前 |
| `SubagentStart` / `SubagentStop` | 子 Agent 启停 |
| `Stop` | 会话结束 |

---

### 6. 全局工作区指令（官方参考，当前未启用）

| 文件 | 位置 | 说明 |
|------|------|------|
| `copilot-instructions.md` | `.github/` | 官方推荐，跨编辑器兼容（规划参考） |
| `AGENTS.md` | 根目录或子目录 | 开放标准，支持 monorepo 层级覆盖（规划参考） |

> 当前文档站处于流程与规范定义阶段，以上内容用于对齐官方能力边界，**不表示当前仓库已落地启用**。  
> 进入实现阶段后，再按“只选一种，不要同时使用”的规则落地。


### 7. 当前阶段推荐骨架（精简版）

> 当前仍在流程定义阶段，目录结构只保留**最小骨架**。  
> 具体会有哪些 skills/workflows 文件，留到进入开发阶段再冻结。

```text
e:\MySelf\devcodex\
├── agents/
├── instructions/
├── skills/
│   └── <skill-name>/SKILL.md
├── workflows/            （DevCodex 扩展，v2 计划迁移到 MCP）
│   └── <workflow-name>/index.md
├── prompts/
├── hooks/
├── data/
├── .devcodex/
│   └── profile/
├── website/
├── package.json
├── README.md
└── CHANGELOG.md
```

### 8. 为什么这里不列详细目录

1. 现在还没进入开发实施阶段，详细文件清单会被误读为“已经落地”
2. 当前目标是先冻结流程与规范边界，不是冻结实现文件数量
3. v1.0.0 和 v2.0.0 的实现策略不同（v2 存在 MCP / MongoDB 平台化演进）

> 结论：本页仅冻结**结构原则**，不冻结“几十个具体目录和文件名”。

