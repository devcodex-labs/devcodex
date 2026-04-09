# ① 预检查流程图

> 本页聚焦主流程中的 `① 预检查` 阶段。  
> 当前仍为流程定义阶段，下面是 v1.0.0 的预检查骨架，不代表已实现代码。

---

## 预检查主链

```mermaid
flowchart TD
    START(["收到用户消息"])
    READ_RULES["读取核心规则 / 安全底线 / 通用规范"]
    INTENT["识别意图"]
    PROFILE_BASE["加载基础 profile 上下文"]
    PROFILE_FULL["按意图补充加载完整 profile"]
    OUTPUT_PATH["确定产物落点"]
    NEXT["进入后续主流程（安全检查）"]

    START --> READ_RULES --> INTENT --> PROFILE_BASE --> PROFILE_FULL --> OUTPUT_PATH --> NEXT
```

---

## 预检查阶段输出

预检查阶段结束时，至少应产出以下基础信息：

1. 当前会话适用的规则基线
2. 当前任务意图分类结果
3. profile 上下文加载状态
4. 产物落点（报告、记忆、需求等）确定结果
5. 可供后续节点汇总的前置信息片段

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 合规语义见：[合规检查框架](/specs/compliance-framework)
- 前置状态汇总见：[前置状态汇总流程图](/specs/pre-state-summary-flow)

> 约束：预检查是必经阶段，不可跳过。
