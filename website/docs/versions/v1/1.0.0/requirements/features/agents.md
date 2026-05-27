# 需求：agents/

> ⚠️ 历史快照说明：本页保留 `1.0.0` 阶段的 Agent 需求。当时文档中的 Free/Pro 层级、唯一 Agent、英文语言规划和 34 个 Skills 是历史口径；当前版本以 `plugin.json`、`README.md` 与 `skills/token-check/SKILL.md` 为准，当前为双 Agent 且所有工作流全量开放。

**状态**：⬜ 待开发  
**优先级**：P1  
**参考**：`v0.03/agents/devcodex.agent.md`

## 目标

创建统一 Agent 路由入口，负责意图识别和工作流分发。

## 文件结构

```
agents/
└── devcodex.agent.md    # 唯一 Agent
```

## 功能需求

### 基本信息
- Agent ID: `devcodex`
- `1.0.0` 阶段规划语言：英文；当前以仓库实际 Agent 文件为准
- 注册在 `plugin.json` agents 列表中

### 意图路由
- 收到消息后调用 `intent` Skill 识别意图
- 按路由表分发到 8 种工作流：dev / fix / analyze / audit / self-fix / resume / plan / chat
- 特殊路由：违规质疑 → audit 工作流

### 工作流路由表

| 意图 | 工作流 | `1.0.0` 阶段规划层级 |
|------|--------|----------------------|
| dev | 开发（8 子类型）| Free/Pro |
| fix | 修复（3 子类型）| Free/Pro |
| analyze | 分析 | Free |
| audit | 审计 | Free/Pro |
| self-fix | 规范自修复 | Pro |
| resume | 上下文恢复 | Pro |
| other | 规划（兜底）| Pro |
| chat | 快速问答 | Free |

> 当前 `token-check` 仅为授权占位，不按上表层级阻断任何工作流。

### 全局约束（注入到 Agent）
- 合规检查在每次工作流执行完毕后运行（chat 豁免）
- 记忆写入在每次会话结束前运行（强制）
- 安全底线 S01~S06 不可覆盖

### Skills 声明
- `1.0.0` 阶段规划通过 Agent 文件 HTML 注释声明 34 个 Skills；后续实现数量以 `plugin.json` 与 `skills/` 目录为准，本历史页不再维护固定数量
- 核心 Skills 同时注册在 `plugin.json`

## 验收标准
- [ ] Agent 可被 VS Code Copilot 加载
- [ ] 意图路由覆盖 8 种工作流
- [ ] 违规质疑特殊路由生效
- [ ] 全局约束注入完整
