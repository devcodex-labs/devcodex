---
name: ai-agent-system-architecture
description: AI Agent 系统架构专家 Owner — 当任务涉及 Agent 路由、工具调用、上下文管理、记忆、状态机、权限、人机协作、可观测性、回放验证或模型辅助治理时使用；要求把 Agent 行为设计成可解释、可恢复、可审计。
---

# AI Agent System Architecture Skill

## 定位

本 Skill 负责 AI Agent 系统 Owner 视角。它把 Agent 当作状态机和工具执行系统，而不是只关注 prompt 文案。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| Agent 路由、意图识别、Skill 触发、工具调用、权限、记忆、handoff、summary、hook 状态 | 必须 |
| 任务涉及模型辅助治理、自动吸纳、自动复审、回放验证、可观测性或人机确认 | 必须 |
| 报告或方案需要解释 Agent 为什么选择某工作流或工具 | 必须 |
| 纯业务代码且不涉及 Agent 执行系统 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `AiAgentSystemArchitectureGate` | Agent 行为必须有路由、工具权限、上下文、状态机、观测和人机边界 | intentRouting、toolPermissionBoundary |
| `AgentRoutingGate` | 意图、Skill、模式和降级路径必须可解释 | intentRouting |
| `ToolPermissionBoundaryGate` | 工具权限、危险操作、确认和 fallback 必须明确 | toolPermissionBoundary |
| `ContextMemoryStateGate` | 上下文恢复、记忆、handoff 和状态新鲜度必须设计 | contextMemoryModel |
| `ReplayObservabilityGate` | 行为验证不能只靠文字说明，需 replay、fixture 或日志证据 | observabilityReplay |
| `RepairCollaborationRoleBoundaryGate` | repair task 必须把决策/验收与执行/验证角色、授权证据、状态与独立复证设计清楚；模型或 Agent 名称不构成风险分类 | roleAssignments、authorizationEvidence、independentReReview |

## 执行步骤

1. 建立 Agent 行为图：用户输入、意图、Skill、工具、确认、报告。
2. 明确工具权限边界和危险操作拦截。
3. 定义上下文、记忆、handoff、summary 和恢复优先级。
4. 设计状态机和失败恢复：blocked、retry、fallback、handoff。
5. 用 direct replay、fixture replay、validate 或日志证据验证关键行为。

## 输出字段

```markdown
## AiAgentSystemArchitectureGate

| 字段 | 内容 |
|------|------|
| intentRouting | 意图、Skill、模式、降级路径 |
| toolPermissionBoundary | 工具权限、确认、危险操作和 fallback |
| contextMemoryModel | 上下文、记忆、handoff、summary、状态新鲜度 |
| stateMachineHandoff | 状态机、恢复、阻塞、交接 |
| observabilityReplay | replay、fixture、日志、validate 证据 |
| humanInLoopBoundary | 用户确认、auto、人工复核和最终责任边界 |
| evidenceMatrix | 判断 -> hook / runtime / report / memory / replay / tests |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 把 Agent 能力写成 prompt 愿望 | 写路由、状态机、工具权限和验证 |
| 用 summary 覆盖文件真相源 | 遵循 Context Rehydration Contract |
| 自动模式绕过危险确认 | 保留 S01/S06 等不可豁免底线 |
| 行为变更无 replay | 补 direct/fixture replay 或等价 validate |

## 与其他 Skill 的关系

- `intent` / `routing`：意图和 Skill 路由是 Agent 系统入口。
- `memory` / `summary`：上下文恢复和状态新鲜度需要联动。
- `host-contract-verification`：宿主行为变化需验证事件和可见回复。
