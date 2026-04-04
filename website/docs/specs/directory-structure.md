# 项目目录结构规范

> 本文档定义 DevCodex 的目录结构标准，以 VS Code Copilot 官方规范为基准。
> 官方文档：https://code.visualstudio.com/docs/copilot/customization/

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
| 全局指令 | `.github/copilot-instructions.md` 或根目录 `AGENTS.md` | — |

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

### 6. 全局工作区指令

| 文件 | 位置 | 说明 |
|------|------|------|
| `copilot-instructions.md` | `.github/` | 推荐，跨编辑器兼容 |
| `AGENTS.md` | 根目录或子目录 | 开放标准，支持 monorepo 层级覆盖 |

> **只选一种，不要同时使用。**


```
e:\MySelf\devcodex\          ← npm 包根目录
├── agents/                  ← Agents 源文件（install 后复制到 .github/agents/）
│   └── devcodex.agent.md
├── instructions/            ← Instructions 源文件
│   ├── 00-safety.instructions.md
│   ├── 01-common.instructions.md
│   ├── 02-output-paths.instructions.md
│   ├── 10-dev.instructions.md
│   ├── 11-fix.instructions.md
│   ├── 12-audit.instructions.md
│   ├── 13-analyze.instructions.md
│   ├── 14-self-fix.instructions.md
│   ├── 15-memory.instructions.md
│   ├── 16-report.instructions.md
│   └── 17-compliance.instructions.md
├── skills/                  ← Skills 源文件（扁平结构，官方标准）
│   ├── compliance/
│   │   └── SKILL.md         ← name: compliance
│   ├── memory/
│   │   └── SKILL.md         ← name: memory
│   ├── report/
│   │   └── SKILL.md         ← name: report
│   ├── intent/
│   │   └── SKILL.md
│   ├── cp-gate/
│   │   └── SKILL.md
│   ├── summary/
│   │   └── SKILL.md
│   ├── plan/
│   │   └── SKILL.md
│   ├── token-check/
│   │   └── SKILL.md
│   ├── load-profile/
│   │   └── SKILL.md
│   ├── routing/
│   │   └── SKILL.md
│   ├── dev-default/
│   │   └── SKILL.md
│   ├── dev-refactor/
│   │   └── SKILL.md
│   ├── dev-database/
│   │   └── SKILL.md
│   ├── dev-init/
│   │   └── SKILL.md
│   ├── dev-optimization/
│   │   └── SKILL.md
│   ├── dev-scenario-test/
│   │   └── SKILL.md
│   ├── dev-docs/
│   │   └── SKILL.md
│   ├── dev-plan-review/
│   │   └── SKILL.md
│   ├── fix-default/
│   │   └── SKILL.md
│   ├── fix-incident/
│   │   └── SKILL.md
│   ├── fix-security/
│   │   └── SKILL.md
│   ├── audit-common/
│   │   └── SKILL.md
│   ├── audit-dimensions/
│   │   └── SKILL.md
│   ├── audit-tech-design/
│   │   └── SKILL.md
│   ├── audit-requirements/
│   │   └── SKILL.md
│   ├── audit-project/
│   │   └── SKILL.md
│   ├── audit-report/
│   │   └── SKILL.md
│   ├── audit-document/
│   │   └── SKILL.md
│   ├── audit-execution-guide/
│   │   └── SKILL.md
│   ├── analyze-research/
│   │   └── SKILL.md
│   ├── self-fix-auto/
│   │   └── SKILL.md
│   ├── api-verification/
│   │   └── SKILL.md
│   ├── document-sync/
│   │   └── SKILL.md
│   └── impact-review/
│       └── SKILL.md
├── prompts/                 ← Prompts 源文件
│   └── *.prompt.md
├── hooks/                   ← Hooks 源文件
│   └── devcodex-hooks.json
├── data/                    ← 运行时数据模板（violations.md/pending-fixes.md 等）
├── .devcodex/               ← DevCodex 自身配置（devcodex init 时生成）
│   └── profile/
├── website/                 ← 文档站（Rspress）
├── index.js                 ← CLI 入口（devcodex init/update/status）
├── package.json
├── CHANGELOG.md
└── README.md
```

