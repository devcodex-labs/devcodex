# 需求：agents/

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
- 语言：英文
- 注册在 `plugin.json` agents 列表中

### 意图路由
- 收到消息后调用 `intent` Skill 识别意图
- 按路由表分发到 8 种工作流：dev / fix / analyze / audit / self-fix / resume / plan / chat
- 特殊路由：违规质疑 → audit 工作流

### 工作流路由表

| 意图 | 工作流 | 层级 |
|------|--------|------|
| dev | 开发（8 子类型）| Free/Pro |
| fix | 修复（3 子类型）| Free/Pro |
| analyze | 分析 | Free |
| audit | 审计 | Free/Pro |
| self-fix | 规范自修复 | Pro |
| resume | 上下文恢复 | Pro |
| other | 规划（兜底）| Pro |
| chat | 快速问答 | Free |

### 全局约束（注入到 Agent）
- 合规检查在每次工作流执行完毕后运行（chat 豁免）
- 记忆写入在每次会话结束前运行（强制）
- 安全底线 S01~S06 不可覆盖

### Skills 声明
- 通过 Agent 文件 HTML 注释声明所有 34 个 Skills
- 核心 Skills 同时注册在 `plugin.json`

## 验收标准
- [ ] Agent 可被 VS Code Copilot 加载
- [ ] 意图路由覆盖 8 种工作流
- [ ] 违规质疑特殊路由生效
- [ ] 全局约束注入完整
