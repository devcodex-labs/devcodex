# 安全检查流程图

> 本页聚焦主流程中的 `② 安全检查` 阶段。  
> 当前仍为流程定义阶段，下面是 v1.0.0 的安全检查骨架，不代表已实现代码。

---

## 安全检查主链

```mermaid
flowchart TD
    INPUT["接收预检查输出（规则基线 / 意图 / 上下文）"]
    SAFE_CHECK{"是否违反安全底线?"}
    PASS["通过：进入摘要阶段"]
    BLOCK_OP["操作级违规：阻断该操作\n说明原因并给出合规替代"]
    CONTINUE["以合规方式继续主流程（进入摘要）"]
    BLOCK_FATAL["致命违规：阻断并说明原因"]
    AUDIT["写入违规审计记录"]
    TERMINATE["终止当前请求处理"]

    INPUT --> SAFE_CHECK
    SAFE_CHECK -->|否| PASS
    SAFE_CHECK -->|操作级违规| BLOCK_OP --> CONTINUE
    SAFE_CHECK -->|致命违规| BLOCK_FATAL --> AUDIT --> TERMINATE
```

---

## 判定结果与后续动作

1. **通过**：继续主流程，进入“写入摘要”
2. **操作级违规**：阻断违规操作，给出合规替代后继续
3. **致命违规**：记录审计并终止，不再进入后续执行链

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 安全底线来源见：`ai-dev-guidelines/version/v4/specs/safety.md`
- 操作级违规处理细图见：[阻断并给出合规替代流程图](/specs/block-op-flow)

> 约束：安全检查是必经阶段，不可跳过。
