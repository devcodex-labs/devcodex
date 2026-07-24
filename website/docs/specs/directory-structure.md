# 项目目录结构规范

> 本文档定义 DevCodex 的目录结构标准，以 GitHub Copilot / VS Code Copilot 官方自定义规范为基准，并补充 Claude Code、Codex、Gemini CLI 与 Grok Build 适配分发面。
> 本页同时明确哪些是**官方组件**，哪些是 **DevCodex 扩展约定**。

---

## 三层加载架构

DevCodex 的核心设计问题是：**主流程里有十几个节点规范，如何高效注入 AI 上下文，同时不撑爆上下文窗口？**

官方 VS Code Copilot 提供三种加载方式：

| 方式 | 触发机制 | 特点 |
|------|---------|------|
| `copilot-instructions.md` | 每次会话自动注入 | 始终在线，因此只承载受预算约束的精简内核 |
| `*.instructions.md` | `applyTo` 文件匹配 或 `description` 语义判断 | 按需加载，平台自动决策 |
| `skills/<name>/SKILL.md` | 用户触发或 Agent 判断调用 | 触发时加载，最省上下文 |

基于这三种方式，DevCodex 采用**三层分层架构**：

```
第一层：copilot-instructions.md / CLAUDE.md / GEMINI.md / AGENTS.md ← 精简内核或薄入口（始终可发现）
第二层：instructions/*.md       ← 主流程节点执行规范（语义按需加载）
第三层：skills/<name>/SKILL.md ← 工作流执行细节（触发时加载）
```

---

## 为什么这样分层

### 第一层用宿主入口 — 不能按需的最小内核

核心安全、优先级、路由、上下文获取、确认与闭环规则是整个执行体系的**前置条件**——AI 不先读精简内核，就不知道如何进入按需加载链。

这些最小规则必须在任务开始前可见，没有按需延后的空间，因此 npm 全局安装把精简入口和稳定 runtime 写入各宿主用户级配置根。Codex 原生读取用户级 `.codex/AGENTS.md`，Claude / Gemini 使用用户级薄入口，Grok 通过用户级 plugin 与 `devcodex grok --rules` 获得完整 kernel。launcher 从最终 cwd 发现 workspace `.devcodex`，但不依赖工作区宿主目录。Grok passive Hook stdout 被忽略，不能作为注入证据。完整 `instructions.md` 保存在用户级稳定 runtime，只在覆盖、新鲜度、宿主发现或低置信场景需要时回退读取。
kernel 由单一真相源确定性生成，并受 coverage、source digest、字节/行预算与负向语义探针约束；“始终可见”不再等于“每次加载完整规范”。

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
| 第一层 | **copilot-instructions.md / CLAUDE.md / GEMINI.md / AGENTS.md** | 始终可发现的宿主入口 | 生成的精简内核或指向共享内核的薄入口 |
| 第二层 | **Instructions** | 按需加载的规范约束（`description` 语义匹配）| 主流程节点执行规范（预检查/摘要/记忆/合规等）|
| 第三层 | **Skills** | 按需触发的工作流能力入口 | 扁平一级 Skill（84 个），覆盖 dev / fix / audit / analyze / self-fix / plan / resume / chat，含 `analyze-default` 默认分析与 `analyze-research` 技术调研，以及 `spec-absorption` 规范吸纳执行、`user-manual-authoring` 最终用户文档、`audit-user-manual` 用户侧文档 review 聚合、`expert-output-quality` 专家型产物质量、产品策略/DX/UX/前端/后端/SRE/API/数据/安全/质量/设计系统/无障碍国际化/增长/商业模型专家 Owner Skill、`review-checklist` 复审清单、`evolution-governance` 自我进化治理、`readme-authoring` / `audit-readme` README 专项能力、`audit-release` 发布前审查和 execution-contract / test-router / release-verification / host-contract-verification / source-consumer-sync / requirement-parallel-orchestration 等支撑能力 |
| 配套 | **Prompts** | 有参数的结构化输出模板 | CP 节点输出模板（CP1/CP2/CP3）|
| 包内资产 | **Agents** | Copilot 自定义 Agent 源 | GlobalOnlyHostConfigModeV1 首批不向工作区 `.github/agents` 分发 |

---

## 官方组件 vs DevCodex 扩展

| 类型 | 名称 | 归属 | 说明 |
|------|------|------|------|
| 官方组件 | Custom Instructions / Skills / Instructions / Prompts | 官方 | 平台可识别并自动加载或按需触发的资产格式 |
| DevCodex 扩展 | CP1 / CP2 / CP3 | 自定义 | DevCodex 的确认节点体系，不是官方内建能力 |
| DevCodex 扩展 | ConcurrencyPolicy | 自定义 | Profile `extensions.devcodex.concurrency` 描述只读/验证并发策略；核心单写者域不由项目配置删除 |
| DevCodex 扩展 | RequirementIndependenceGate | 自定义 | `requirement-parallel-orchestration` 在多需求/子会话/worktree 前输出独立性判定、共享面锁图、LaunchCard 与串行汇合协议 |
| DevCodex 扩展 | major/minor 版本文档结构 | 自定义 | 文档站采用 `versions/v1/<active-version>/` 承载当前迭代，`1.0.0` 仅保留历史基线 |

> 结论：**官方标准负责"可被平台发现与加载"**，DevCodex 在此之上定义执行流程与分层规范。

---

## 官方标准概览

DevCodex 当前把宿主 adapter 写入用户级配置根；workspace-namespace 仅拥有 `.devcodex`：

| 组件 | 路径 | 说明 |
|------|------|------|
| Copilot adapter | `<home>/.copilot/copilot-instructions.md` + `<home>/.copilot/devcodex/runtime/` | fixture-only；IDE workspace hooks 不在首批范围 |
| Claude Code adapter | `<home>/.claude/CLAUDE.md`、settings、MCP + stable runtime | contract-fixture |
| Codex adapter | `<home>/.codex/AGENTS.md`、hooks、config + `<home>/.agents/skills/` | isolated direct probe |
| Gemini adapter | `<home>/.gemini/GEMINI.md`、settings + stable runtime | contract-fixture |
| Grok adapter | `<home>/.grok/config.toml`、plugin + stable runtime | isolated direct probe；`devcodex grok` 为完整入口 |
| Workspace runtime | `<workspace>/.devcodex/` | Profile、记忆、报告、审计与项目运行态；不迁移到 npm prefix |

源码仓根受版本控制的 `.mcp.json` 是包开发/插件清单；安装态 MCP 配置位于宿主用户级配置，并指向用户级稳定 runtime。

---

## 目录结构骨架

> 当前骨架反映 GlobalOnlyHostConfigModeV1；宿主配置与 workspace runtime 分属不同 owner。

```text
<user-home>/
├── .copilot/                            ← Copilot 用户级 instruction + stable runtime
├── .claude/                             ← Claude 用户级 instruction/settings/runtime
├── .claude.json                         ← Claude 用户级 MCP managed segment
├── .codex/                              ← Codex 用户级 AGENTS/hooks/config/runtime
├── .gemini/                             ← Gemini 用户级 instruction/settings/runtime
├── .grok/                               ← Grok 用户级 plugin/config/runtime
└── .agents/skills/                      ← Codex 用户级共享 Skills

<workspace-root>/
├── .devcodex/
│   ├── <project>/                       ← 单项目 active-root
│   └── workspace/                       ← 全工作区 active-root
└── <project files>                      ← 默认没有五宿主目录
```

启用 `workspace-namespace` 后，workspace 根的 Profile 路径是 `.devcodex/workspace/profile/`；单项目 Profile 路径是 `.devcodex/<project>/profile/`。多项目 workspace 根缺少 workspace profile 时，Hook warning 必须指向 `.devcodex/workspace/profile/`，不能再提示 legacy `.devcodex/profile/`。

其中 `01-common.instructions.md` 现在作为 common-base / 锚点文件保留跨消费者最短规则，`01a-profile-loading.instructions.md`、`01b-record-router.instructions.md`、`01c-intent-expansion.instructions.md` 承载拆分后的 Profile / RecordRouter / Intent Expansion 细节。

---

## 各组件官方格式

### 1. copilot-instructions.md / CLAUDE.md / GEMINI.md / AGENTS.md

```markdown
# DevCodex Instructions

<!-- 受覆盖与预算约束的精简 kernel；或只指向共享 kernel 的宿主薄入口 -->
```

无 frontmatter，纯 Markdown。Copilot 与共享 `AGENTS.md` 加载生成 kernel；Claude / Gemini wrapper 只承担宿主指针与最小能力说明。宿主每次会话自动发现入口，但完整规范只在 fail-closed 回退时从 `.agents/devcodex/instructions.full.md` 读取。

---

### 2. Skills

```yaml
---
name: skill-name
description: 'What and when to use. Max 1024 chars.'
---
Markdown 内容
```

`spec-governance` 是规范治理专用 Skill，负责记录类意图识别、RecordRouter 台账分流、GovernanceGateRegistry 和 SCV（Spec Change Verification）规范变更验证；`spec-absorption` 负责规范吸纳执行，覆盖 `.devcodex/*/data` 候选扫描、通用规范价值证明、项目独有规则剔除、消费者证明、分层决策和验证探针。`user-manual-authoring` 负责站点文档、最终用户手册、README、quick start、接入手册和 docs-first 用户手册；`audit-user-manual` 负责用户侧文档 review、项目文档审查、菜单导航、sidebar、信息架构和文档设计聚合；`expert-output-quality` 负责代码、文档、示例、fixture、quick start、技术方案和报告的专家型产物质量，执行 `ExpertOutputQualityGate` 与 V84 同步探针；21 个专家 Owner Skill 分别为 `product-strategy`、`developer-experience-architecture`、`ux-interaction-architecture`、`frontend-architecture`、`backend-domain-architecture`、`production-readiness-sre`、`api-contract-architecture`、`external-integration-architecture`、`platform-ecosystem-architecture`、`ai-agent-system-architecture`、`data-architecture`、`security-threat-modeling`、`quality-strategy`、`design-system-architecture`、`accessibility-i18n`、`growth-analytics`、`business-model-review`、`distributed-systems-architecture`、`performance-engineering`、`privacy-compliance-architecture`、`ai-evaluation-engineering`，通过 `ExpertOwnerSkillGate` 与 V85 探针承接产品策略、开发者体验、UX、前端、后端领域、SRE、API 契约、外部集成、平台生态、AI Agent、数据、安全、质量、设计系统、无障碍/国际化、增长分析和商业模型专业判断；其中增长和商业为 P3 条件触发，不进入普通任务默认主路径；`review-checklist` 负责正式复审、ECR、发布前复审、多轮收敛和外部 finding 批次的清单创建与证据执行；`evolution-governance` 负责自我进化、自动吸纳、模型辅助规范优化、自动补 Skill / Prompt / Probe 和自动治理候选的控制面。`readme-authoring` 与 `audit-readme` 继续负责 README 分支的用户视角写作与专项审查。`audit-release` 负责发布前审查，判断 release readiness、发布说明质量、兼容/迁移风险、包元数据、文档/Profile/website 同步、回滚策略、registry/tag 风险与发布后验收；`release-verification` 继续负责 R0~R7 执行验证链。`execution-contract`、`test-router`、`release-verification`、`host-contract-verification`、`source-consumer-sync`、`requirement-parallel-orchestration` 是支撑型 Skill，用于长流程边界、验证路线、正式发布前检查、宿主契约证据、真相源-消费者同步和多需求并行编排，不新增工作流分支。

---

### 3. Instructions

```yaml
---
applyTo: "**"
---
Markdown 内容
```

DevCodex 当前采用“单一完整真相源 → 用户级宿主投影 → 路由后按需 Skill → 必要时完整回退”的组合。`GlobalHostTargetV1` 固定五宿主白名单目标，`GlobalOnlyHostConfigModeV1` 禁止 workspace host-copy；bare `init/update` 只维护 `.devcodex`。安装事务使用 managed merge、原子替换、回滚和 per-host receipt，用户自有配置保持不变。

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


> Skill 规模锚点：84 个 Skills；84 个按需触发。
