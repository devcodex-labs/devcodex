# Agent 双模式 — 关键决策记录

> **需求来源**：[agent-modes.md](/versions/v1/1.0.0/requirements/p1/agent-modes)  
> **关联**：[技术方案](./design) · [实施计划](./plan) · [进度](./progress)

---

> 每次重要的技术决策或需求变更决策在此追加记录，保持最新在最下方。

---

## D-001：双 Agent 入口替代 `auto:` 指令前缀

**日期**：2026-04-04  
**背景**：原方案通过 `auto: [任务]` 消息前缀切换全自动模式。  
**决策**：改为两个独立 Agent 入口（`devcodex.agent.md` + `devcodex-auto.agent.md`）。  
**原因**：模式选择是会话级决策，不是消息级决策。在开始工作前选择 Agent 比每条消息加前缀更自然，且避免用户误操作。  
**影响**：需要在 `.github/agents/` 下创建两个 agent 文件，并在两个文件的 instructions 中分别定义 CP 确认/跳过逻辑。
