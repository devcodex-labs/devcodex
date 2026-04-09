# ⑥ 开发阶段合规检查流程图

> 本页聚焦主流程中的 `⑥ 开发阶段合规检查` 阶段。  
> 当前仍为流程定义阶段，下面是 v1.0.0 的开发前合规检查骨架，不代表已实现代码。

---

## 开发阶段合规检查主链

```mermaid
flowchart TD
    IN["接收前置状态汇总结果"]
    INTENT_CHECK["检查开发类意图是否成立"]
    PROFILE_CHECK["检查项目 / 版本 / profile 上下文是否完整"]
    OUTPUT_CHECK["检查产物落点是否明确"]
    CONSTRAINT_CHECK["检查执行前约束与变更边界"]
    CONFLICT_CHECK["检查记忆冲突与未完成任务"]
    READY{"是否具备进入开发类工作流条件?"}
    FIX_GAP["补齐缺失上下文"]
    FALLBACK["无法补齐：回退到 chat 轻路径或终止"]
    PASS["通过：进入路由节点"]

    IN --> INTENT_CHECK --> PROFILE_CHECK --> OUTPUT_CHECK --> CONSTRAINT_CHECK --> CONFLICT_CHECK --> READY
    READY -->|是| PASS
    READY -->|否| FIX_GAP
    FIX_GAP --> READY2{"补齐后是否满足条件?"}
    READY2 -->|是| PASS
    READY2 -->|否| FALLBACK
```

---

## 阶段输出要求

1. 给出"可路由 / 不可直接路由"的明确结论
2. 不可路由时，尝试补齐缺失上下文后**重新判断**
3. 补齐仍无法满足条件时，回退到 chat 轻路径或终止，不允许带着不完整状态进入路由
4. 通过时，保证进入路由前的项目上下文、边界和约束已清晰

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 合规框架入口见：[合规检查框架](/specs/compliance-framework)
- 上游阶段见：[前置状态汇总流程图](/specs/pre-state-summary-flow)

> 约束：该节点属于开发前闸门，位置在“前置状态汇总之后、路由之前”。
