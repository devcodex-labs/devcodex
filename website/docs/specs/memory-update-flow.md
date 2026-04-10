# ⑪ 更新记忆流程图

> 本页聚焦主流程中的 `⑪ 更新记忆` 阶段。  
> 该阶段在报告输出后执行，负责更新三层记忆体系，确保会话上下文可恢复。

---

## 更新记忆主链

```mermaid
flowchart TD
    IN["接收报告输出结果"]
    LAYER1["第一层：Agent 日记\n追加/更新今日记忆文件"]
    SESSION["确定会话编号\n追加 📨 对话记录"]
    REPORT_REF["追加 📄 关联报告路径"]
    STATUS{"任务完成?"}
    MARK_DONE["更新状态为 ✅"]
    MARK_WIP["保持状态 🔄"]
    SUMMARY["更新 Agent SUMMARY\n.memory/clients/<agent>/SUMMARY.md"]

    LAYER2{"任务关联到\n需求/Bug/优化?"}
    REQ_MEM["第二层：需求级记忆\n<需求目录>/.memory/sessions.md"]
    SKIP_REQ["跳过需求级记忆"]

    LAYER3{"涉及关键决策?\n（规范变更/架构决策/P0修复）"}
    GLOBAL["第三层：全局 SUMMARY\n.memory/SUMMARY.md"]
    SKIP_GLOBAL["跳过全局 SUMMARY"]

    TOKEN{"当前轮次 >13?"}
    CHECKPOINT["写入编码检查点\n📦 字段"]
    OUT["进入 ⑫ 完成前合规检查"]

    IN --> LAYER1 --> SESSION --> REPORT_REF --> STATUS
    STATUS -->|"是"| MARK_DONE --> SUMMARY
    STATUS -->|"否"| MARK_WIP --> SUMMARY
    SUMMARY --> LAYER2
    LAYER2 -->|"是"| REQ_MEM --> LAYER3
    LAYER2 -->|"否"| SKIP_REQ --> LAYER3
    LAYER3 -->|"是"| GLOBAL --> TOKEN
    LAYER3 -->|"否"| SKIP_GLOBAL --> TOKEN
    TOKEN -->|"是"| CHECKPOINT --> OUT
    TOKEN -->|"否"| OUT
```

---

## 三层记忆体系

| 层级 | 路径 | 触发条件 |
|------|------|---------|
| **① Agent 日记** | `.memory/clients/<agent>/tasks/YYYYMMDD.md` | 每会话必写 |
| **② 需求级记忆** | `<需求目录>/.memory/sessions.md` | 路由确定后追加 |
| **③ 全局 SUMMARY** | `.memory/SUMMARY.md` | 仅关键决策时 |

## Agent SUMMARY 格式

```markdown
| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |
```

---

## 写入约束

- ⛔ 禁止询问用户"是否需要写入记忆"（C05/S05 — 强制自动写入）
- ⛔ 禁止覆盖已有内容（C06/S04 — 只能追加，增量编辑）
- ⛔ 禁止使用终端命令修改 .md 文件（C09）
- ⛔ 禁止使用 glob/find 扫描 `.memory/`

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 上游阶段见：[⑩ 输出报告流程图](/specs/report-output-flow)
- 下游阶段见：[⑫ 完成前合规检查流程图](/specs/completion-compliance-flow)
- 记忆规范见：`skills/memory/SKILL.md`

> 约束：更新记忆为主链必经阶段（chat 仍须写记忆），不可跳过。

