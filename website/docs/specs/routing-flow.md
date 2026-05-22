# ⑦ 路由到工作流流程图

> 本页聚焦主流程中的 `⑦ 路由到工作流` 阶段。  
> 路由逻辑内联在 Agent 文件中，本页为流程骨架描述。

---

## 路由主链

```mermaid
flowchart TD
    IN["接收开发阶段合规检查结果"]
    INTENT{"意图类型判定"}

    CHAT_PATH["chat 快速路径\n（豁免报告，仅记忆）"]
    RESUME_PATH["resume 恢复路径\n读取记忆 → 还原上下文"]
    VIOLATION["违规质疑路由\n强制 → audit"]
    WORKFLOW["标准工作流路由"]

    SUB_ROUTE{"子类型路由"}
    TOKEN_RESERVED["token-check\n当前仅作授权占位\n无 tier 阻断"]

    DEV["dev（8 子类型）"]
    FIX["fix（3 子类型）"]
    AUDIT["audit（6 目标类型）"]
    ANALYZE["analyze（2 子类型）"]
    SELF_FIX["self-fix"]
    PLAN["plan（兜底）"]
    EXEC["进入 ⑧ 工作流执行"]

    IN --> INTENT
    INTENT -->|"chat"| CHAT_PATH --> MEMORY_W["⑪ 更新记忆"] --> FINAL["⑫ 完成前合规检查"]
    INTENT -->|"resume"| RESUME_PATH --> EXEC
    INTENT -->|"违规质疑"| VIOLATION --> EXEC
    INTENT -->|"其他"| WORKFLOW --> SUB_ROUTE
    WORKFLOW -. "未来授权预留" .-> TOKEN_RESERVED

    SUB_ROUTE -->|dev| DEV --> EXEC
    SUB_ROUTE -->|fix| FIX --> EXEC
    SUB_ROUTE -->|audit| AUDIT --> EXEC
    SUB_ROUTE -->|analyze| ANALYZE --> EXEC
    SUB_ROUTE -->|self-fix| SELF_FIX --> EXEC
    SUB_ROUTE -->|other| PLAN --> EXEC
```

---

## 路由规则要点

1. **chat 快速路径**：三问法全指向分析 + 无文件变更意图 → 跳过 CP 和报告 → 仅写记忆
2. **resume 路径**：读取记忆（最近 14 天）→ 还原上下文 → 提取原始意图 → 重路由
3. **违规质疑**：用户质疑规范违反 → 强制路由到 audit → 先执行 compliance
4. **多意图处理**：≥2 意图 → 按序逐一路由，每个独立走完整工作流周期
5. **授权占位**：当前版本 `token-check` 仅说明所有功能全量开放；Token/Tier 校验保留给未来版本，不阻断 v1 工作流

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 上游阶段见：[⑥ 开发阶段合规检查流程图](/specs/dev-compliance-flow)
- 下游阶段见：[⑧ 工作流执行流程图](/specs/workflow-execution-flow)
- 路由参考文档见：`skills/routing/SKILL.md`

> 约束：路由为主链必经阶段，不可跳过。chat / resume / 违规质疑为特殊路径。

