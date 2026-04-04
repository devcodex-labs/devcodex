# 架构总览

DevCodex v5 采用 **Plugin-first 离线架构**，v5.0 完全基于文件系统，无需外部服务。

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code + GitHub Copilot              │
└──────────────────────────┬──────────────────────────────┘
                           │ @DevCodex
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Plugin Layer（静态知识层）                   │
│                                                         │
│  .github/agents/devcodex.agent.md（统一入口）            │
│       │                                                 │
│       ├── hooks/pre-message.hook.md                     │
│       │     └── intent Skill → 工作流路由               │
│       │                                                 │
│       ├── skills/（34 个 Skills）                        │
│       │     ├── core/（intent, routing, memory...）      │
│       │     ├── dev/（default, database, refactor...）   │
│       │     ├── fix/（default, incident, security）      │
│       │     ├── audit/（common, dimensions D1~D20）      │
│       │     ├── analyze/（default, research）            │
│       │     └── cross/（impact-review, api-verify...）  │
│       │                                                 │
│       ├── instructions/（11 个 Instructions）            │
│       └── hooks/post-session.hook.md                   │
│             └── memory + compliance Skill               │
└──────────────────────────┬──────────────────────────────┘
                           │ v5.1 规划中
                           ▼
┌─────────────────────────────────────────────────────────┐
│              MCP Server Layer（动态数据层）               │
│  memory-server  │  violations-server  │  auth-server    │
└─────────────────────────────────────────────────────────┘
```

## Plugin Layer 详解

### Agent（统一入口）

`agents/devcodex.agent.md` 是唯一的入口点，定义了：
- Agent 的能力和可用工具（filesystem, terminal）
- 执行前的 pre-message hook 触发
- 高阶行为约束（P2 安全底线、CP 流程、合规检查）

### Hooks

| Hook | 触发时机 | 职责 |
|------|---------|------|
| `pre-message.hook.md` | 每条用户消息前 | 获取时间 → 读取规则 → 安全检查 → 加载约束 → 识别意图 → 加载项目规范 |
| `post-session.hook.md` | 会话结束后 | 写记忆 → 更新摘要 → 写报告 → 合规检查 |

### Skills（34 个）

Skills 是可复用的专业知识单元，按类型分层：

| 分类 | 数量 | 说明 |
|------|------|------|
| core/ | ~6 | intent, routing, memory, compliance, report, summary |
| dev/ | ~8 | dev-default, dev-database, dev-refactor, dev-plan-review 等 |
| fix/ | ~3 | fix-default, fix-incident, fix-security |
| audit/ | ~10 | audit-common + D1~D20 维度 Skills |
| analyze/ | 1 | analyze-research（default 子类型走通用流程，无专属 SKILL） |
| cross/ | ~5 | impact-review, api-verification, document-sync 等 |
| token/ | 1 | token-check（Pro/Enterprise 授权验证）|

### Instructions（11 个）

全局注入的规则文件，按优先级 P2~P5 分层：

| 档案 | 优先级 | 内容 |
|------|:------:|------|
| `00-safety.instructions.md` | P2 | S01~S06 安全底线（最高，不可覆盖）|
| `01-common.instructions.md` | P5 | C01~C15 通用约束 |
| `02-output-paths.instructions.md` | P5 | 产物路径规范 |
| `10-dev.instructions.md` | P4 | dev 工作流规则 |
| `11-fix.instructions.md` | P4 | fix 工作流规则 |
| `12-audit.instructions.md` | P4 | audit 工作流规则 |
| `13-analyze.instructions.md` | P4 | analyze 工作流规则 |
| `14-self-fix.instructions.md` | P4 | self-fix 工作流规则 |
| `15-memory.instructions.md` | P4 | 记忆写入规则 |
| `16-report.instructions.md` | P4 | 报告输出规则 |
| `17-compliance.instructions.md` | P4 | 合规检查规则 |

## MCP Server Layer（v5.1 规划）

v5.1 将通过 Model Context Protocol 提供动态数据能力：

| Server | 职责 |
|--------|------|
| `memory-server` | 读写会话记忆，支持跨会话上下文恢复 |
| `violations-server` | 追踪违规记录，支持趋势分析 |
| `auth-server` | Pro/Enterprise Token 在线验证 |

v5.0 在无 MCP Server 时完全离线运行，记忆和报告以本地文件形式存储。
