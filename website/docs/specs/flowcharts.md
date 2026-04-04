# DevCodex 执行流程图

> 本页面展示 DevCodex Agent 的完整执行流程，作为 v1.0.0 实施的标准参考。

---

## 图一：主流程

每次收到用户消息后，Agent 必须按此流程执行：

```mermaid
flowchart TD
    START(["📨 收到用户消息"])

    subgraph PRECHECK["① 预检查（每次必做）"]
        MEM["读取今日记忆文件\n检查 🔄 待续任务"]
        PREOUT["输出预检查状态块\n• Token 轮次\n• 待跟进事项\n• 未完成任务"]
        MEM --> PREOUT
    end

    subgraph INTENT_BLOCK["② 意图识别与路由"]
        INTENT["intent Skill\n三问法识别意图类型"]
        TOKEN["token-check Skill\n验证授权层级"]
        INTENT --> TOKEN
    end

    subgraph ROUTE["③ 路由分发"]
        R_DEV["dev\n开发工作流"]
        R_FIX["fix\n修复工作流"]
        R_ANALYZE["analyze\n分析工作流"]
        R_AUDIT["audit\n审计工作流"]
        R_SELFFIX["self-fix\n规范自修复"]
        R_RESUME["resume\n恢复工作流"]
        R_CHAT["chat\n快速问答"]
        R_PLAN["plan\n规划工作流"]
    end

    subgraph POST["④ 收尾（chat 豁免报告）"]
        COMPLY["compliance Skill\nFC → SC → RC 合规检查"]
        REPORT["report Skill\n写入报告文件"]
        MEMORY["memory Skill\n写入记忆文件"]
        COMPLY --> REPORT --> MEMORY
    end

    START --> PRECHECK --> INTENT_BLOCK
    TOKEN -->|dev| R_DEV
    TOKEN -->|fix| R_FIX
    TOKEN -->|analyze| R_ANALYZE
    TOKEN -->|audit| R_AUDIT
    TOKEN -->|self-fix| R_SELFFIX
    TOKEN -->|resume| R_RESUME
    TOKEN -->|chat| R_CHAT
    TOKEN -->|other| R_PLAN

    R_DEV & R_FIX & R_ANALYZE & R_AUDIT & R_SELFFIX & R_RESUME & R_PLAN --> POST
    R_CHAT --> MEMORY
```

---

## 图二：dev / fix 工作流（CP 流程 + 双 Agent 模式）

```mermaid
flowchart TD
    START(["进入 dev / fix 工作流"])

    subgraph PRE["① 前置准备"]
        PROFILE["load-profile Skill\n读取项目代码风格"]
        C12["C12 合理性评估\n有更好方案先提出，等待确认"]
        PROFILE --> C12
    end

    subgraph CPFLOW["② CP 确认流程（@devcodex 默认）"]
        CP1["CP1\n输出需求 / 问题理解 ⏸"]
        CP2["CP2\n输出技术方案 ⏸\nplan-review 方案质量门禁（dev 必做）"]
        CP3["CP3\n输出实施计划 ⏸"]
        CP1 --> CP2 --> CP3
    end

    subgraph AUTOFLOW["② 全自动跳过（@devcodex-auto）"]
        AUTONODE["CP1 / CP2 / CP3 全部自动通过\n安全底线 S01~S06 仍强制执行"]
    end

    subgraph EXECBLOCK["③ 执行"]
        EXEC["逐文件执行\n最多 2 次迭代，失败标 ⚠️"]
        SCAN["fix 修复三步扫描\n同类全局 · 联动 · 零残留复核"]
        EXEC --> SCAN
    end

    START --> PROFILE
    C12 -->|"@devcodex"| CP1
    C12 -->|"@devcodex-auto"| AUTONODE
    CP3 --> EXEC
    AUTONODE --> EXEC
    SCAN --> DONE(["✅ 执行完成 → 进入收尾"])
```

---

## 图三：audit 工作流（多轮收敛）

```mermaid
flowchart TD
    START(["进入 audit 工作流"])

    subgraph PREP["① 审查准备"]
        COMMON["audit-common Skill\n识别审查目标类型（6种）"]
        LOAD["加载专属维度 Skill\n租户定制 > Plugin 默认 > 通用兜底"]
        COMMON --> LOAD
    end

    subgraph EXEC_A["② 执行审查（多轮）"]
        ROUND["按维度逐项审查\n每条结论附三列验证\n合理性 · 可实施性 · 收益"]
        GAP["登记维度盲区\ndata/gap-registry.md"]
        ROUND --> GAP
    end

    subgraph CONV_S["③ 收敛判断"]
        CONVCHECK["连续 N 轮无新发现？\n定向审查 N=2 · 全面体检 N=3\n未收敛 → 继续下一轮"]
    end

    subgraph CONCLUDE_S["④ 输出结论"]
        SF["含 🔴 问题 + 三列验证全通过\n直接启动 self-fix 工作流"]
        SUGGEST["存在 ⚠️ 待验证项\n输出建议，等待用户确认"]
    end

    START --> COMMON
    LOAD --> ROUND
    GAP --> CONVCHECK
    CONVCHECK -->|"未收敛，继续"| ROUND
    CONVCHECK -->|"已收敛"| SF
    CONVCHECK -->|"已收敛"| SUGGEST
    SF --> DONE(["输出审查报告 → 收尾"])
    SUGGEST --> DONE
```

---

## 图四：resume 工作流

```mermaid
flowchart TD
    START(["用户说「继续」/「恢复」"])

    subgraph READ["① 读取记忆"]
        MEM["读取最近记忆文件\n查找 🔄 未完成会话"]
    end

    subgraph RESTORE["② 还原上下文"]
        SUMM["输出恢复摘要\n原始任务 + 中断节点 + 待跟进事项"]
        WAIT["⏸ 等待用户确认\n（@devcodex-auto 自动确认）"]
        SUMM --> WAIT
    end

    subgraph EXEC_R["③ 重路由执行"]
        REROUTE["重路由到原始工作流\n从中断节点继续执行"]
    end

    NOTFOUND(["路由到 chat\n告知无中断任务可恢复"])
    DONE(["原始工作流继续 → 收尾"])

    START --> MEM
    MEM -->|"🔄 存在未完成会话"| SUMM
    MEM -->|"未找到"| NOTFOUND
    WAIT --> REROUTE
    REROUTE --> DONE
```

---

## 图五：合规检查流程（每次收尾执行）

```mermaid
flowchart TD
    START(["工作流主体执行完毕"])
    CHAT{"是 chat 工作流?"}
    SKIPCHAT(["跳过报告，仅写记忆"])

    subgraph FC["① FC 形式合规（FC1~FC6）"]
        FC_CHK["记忆/报告完整性 · 文件命名/路径\n不通过 → 内联修正后重检（禁止进入 self-fix）"]
    end

    subgraph SC["② SC 实质合规（SC1~SC13）"]
        SC_CHK["执行完整性 · fix 三步扫描 · 关联文件同步\n🔴 阻塞性失败 → 修正重检（≤5次后输出摘要⚠️）"]
    end

    subgraph RC["③ RC 恢复性检查"]
        RC_CHK["待跟进事项 · Token 防护\n>15 轮 → 强制写完整记忆"]
    end

    subgraph WRITE["④ 写入完成"]
        RPT["report Skill\n写入报告文件（chat 豁免）"]
        MEM_W["memory Skill\n写入记忆文件，状态更新 ✅"]
        RPT --> MEM_W
    end

    START --> CHAT
    CHAT -->|是| SKIPCHAT
    CHAT -->|否| FC_CHK
    FC_CHK --> SC_CHK
    SC_CHK --> RC_CHK
    RC_CHK --> RPT
    MEM_W --> ALLDONE(["✅ 回复发送"])
```

---

## 关键决策说明

| 决策点 | 规则 |
|--------|------|
| 全自动模式切换 | 选择 `@devcodex-auto` Agent 进入全自动模式，会话级生效 |
| 安全底线不可跳过 | 任何模式下 S01~S06/C01/C10 强制触发，全自动也不例外 |
| 全自动失败处理 | 自动重试 ≤2 次；仍失败则停止标 ⚠️ |
| audit 收敛阈值 | 定向审查=2轮无新发现；全面体检=3轮无新发现 |
| plan-review 阻断 | 回 CP2 重确认方案，不直接终止任务 |
| chat 豁免 | chat 豁免报告写入，但记忆必须写入 |
