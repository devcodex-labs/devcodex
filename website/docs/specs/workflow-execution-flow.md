# ⑧ 工作流执行流程图

> 本页聚焦主流程中的 `⑧ 工作流执行` 阶段。  
> 各工作流有独立的执行细节，本页展示统一的执行骨架与分支。

---

## 工作流执行总览

```mermaid
flowchart TD
    IN["接收路由结果\n（工作流类型 + 子类型）"]
    STYLE["读取代码风格\n（dev/fix 必须）"]
    C12["C12 合理性评估\n有更好方案 → 先提出"]
    HOST_ROUTE["HostCapabilityRoutingGate\n原指令 ref + surface variant\n证据不足 → portable fallback"]

    WF{"工作流类型"}

    DEV_FLOW["dev 执行流程"]
    FIX_FLOW["fix 执行流程"]
    AUDIT_FLOW["audit 执行流程"]
    ANALYZE_FLOW["analyze 执行流程"]
    SELF_FIX_FLOW["self-fix 执行流程"]
    PLAN_FLOW["other → plan Skill 执行流程"]

    OUT["进入 ⑨ 执行阶段合规检查"]

    IN --> STYLE --> C12 --> HOST_ROUTE --> WF
    WF -->|dev| DEV_FLOW --> OUT
    WF -->|fix| FIX_FLOW --> OUT
    WF -->|audit| AUDIT_FLOW --> OUT
    WF -->|analyze| ANALYZE_FLOW --> OUT
    WF -->|self-fix| SELF_FIX_FLOW --> OUT
    WF -->|other (plan Skill)| PLAN_FLOW --> OUT
```

> 规范矩阵八个 intent：`dev` / `fix` / `self-fix` / `analyze` / `audit` / `other` / `chat` / `resume`。图中展开主执行支路；`chat` 快路径、`resume` 继承原阶段，见 `workflow-capabilities.json`。


---

## 宿主能力选择与原指令连续性

当任务需要宿主专属杠杆时，`intent` 仍拥有工作流路由；`host-capability-routing` 只选择宿主能力，不改变 dev/fix/audit/analyze、CP 或 Auto 语义。

```mermaid
flowchart TD
    ORIGINAL["OriginalInstructionRefV1\n引用原消息/CP/task artifact"]
    DECISION["CapabilityIntentDecisionV1\n意图、variant、authority、fallback"]
    CATALOG["HostLeverCatalogV1\n5 logical hosts / 8 variants"]
    EVIDENCE{"direct evidence、权限、\n生命周期均 fresh?"}
    NATIVE["native-eligible\n仍不得越过 CP/Auto/S01~S07"]
    PORTABLE["portable fallback\n保留原始任务语义"]

    ORIGINAL --> DECISION
    CATALOG --> DECISION
    DECISION --> EVIDENCE
    EVIDENCE -->|"是"| NATIVE
    EVIDENCE -->|"否/未知/MCP absent"| PORTABLE
```

Phase 1 的 canonical catalog 当前 `native eligible=0`，所以这条链首先提供可追溯、可测试和不误报的 portable 选择，不承诺提升 native 自动化率，也不新增 MCP primitive。

---

## dev 执行流程

```mermaid
flowchart TD
    CP1["CP1 需求确认\n（输出需求理解，等待确认）"]
    PR1["PR-1 需求完整性自检\n（AI 内部，不等用户）"]
    CP2["CP2 方案确认\n（输出技术方案，等待确认）"]
    PR["plan-review 方案验证\n（PR-2~PR-7 门禁）"]
    PR_OK{"plan-review 通过?"}
    IR{"PR-5② 跨模块\n架构依赖变更?"}
    IMPACT["impact-review\n影响评估"]
    CP3["CP3 实施计划确认"]
    EXEC["逐文件执行\nerror ≤ 2 次迭代"]
    POST_API{"涉及接口变更?"}
    API_V["api-verification"]
    POST_DOC{"涉及源码变更?"}
    DOC_S["document-sync"]
    ECR["ECR 执行闭环复审\nCP/报告/记忆/SUMMARY/diff/tests"]
    SCV["SCV 规范变更验证\nRecordRouter/真相源/部署副本/残留漂移"]
    DONE["dev 执行完成"]

    CP1 --> PR1 --> CP2 --> PR --> PR_OK
    PR_OK -->|"🔴 阻断"| CP2
    PR_OK -->|"通过"| IR
    IR -->|"是"| IMPACT --> CP3
    IR -->|"否"| CP3
    CP3 --> EXEC --> POST_API
    POST_API -->|"是"| API_V --> POST_DOC
    POST_API -->|"否"| POST_DOC
    POST_DOC -->|"是"| DOC_S --> ECR
    POST_DOC -->|"否"| ECR
    ECR --> SCV --> DONE
```

---

## fix 执行流程

```mermaid
flowchart TD
    DIAG["问题诊断三步\nS1重现 → S2定位 → S3影响"]
    CP1["CP1 问题确认\n（根因 + 影响范围）"]
    CP2["CP2 方案确认\n（修复方案 + 回归策略）"]
    IR{"PR-5② 跨模块?"}
    IMPACT["impact-review"]
    EXEC["最小化修复实现"]
    TEST["回归测试"]
    SCAN["修复三步必做（SC3）\n① 同类全局扫描\n② 数据联动扫描\n③ grep 零残留复核"]
    CP3_CHECK{"≥5 文件 或\n含高风险操作?"}
    CP3["CP3 执行确认"]
    ECR["ECR 执行闭环复审\nCP/报告/记忆/SUMMARY/diff/tests"]
    SCV["SCV 规范变更验证\n规范/路径/模板/部署/校验链变更时必做"]
    DONE["fix 执行完成"]

    DIAG --> CP1 --> CP2 --> IR
    IR -->|"是"| IMPACT --> EXEC
    IR -->|"否"| EXEC
    EXEC --> TEST --> SCAN --> CP3_CHECK
    CP3_CHECK -->|"是"| CP3 --> ECR
    CP3_CHECK -->|"否"| ECR
    ECR --> SCV --> DONE
```

---

## audit / analyze / self-fix / plan 执行骨架

```mermaid
flowchart TD
    subgraph audit
        A1["识别审查目标类型（7 种，含发布前审查）"]
        A2["加载维度规范"]
        A3["多轮审查\nReviewCoverageDelta\n连续 N 轮有效零发现"]
        A4{"收敛?"}
        A5["输出问题清单 + 三列验证\n多路径含推荐结论"]
        A1 --> A2 --> A3 --> A4
        A4 -->|"否"| A3
        A4 -->|"是"| A5
    end

    subgraph analyze
        B1["多轮只读分析（≥3轮，连续2轮无新发现后收敛）"]
        B2["每条结论附三项验证\n（用户面可见）"]
        B3["输出报告"]
        B1 --> B2 --> B3
    end

    subgraph self-fix
        C1["确定修复范围"]
        C2{"分级判定"}
        C3["A1~A5 自动修复"]
        C4["Pending 级 → 记录"]
        C5["拒绝级 → 提示"]
        C1 --> C2
        C2 -->|"自动级"| C3
        C2 -->|"Pending"| C4
        C2 -->|"拒绝"| C5
    end

    subgraph plan
        D1["分析目标"]
        D2["工作流重评估"]
        D3["制定执行计划"]
        D4["用户确认后逐步执行"]
        D1 --> D2 --> D3 --> D4
    end
```

---

## 阶段输出要求

1. 工作流执行必须按对应 Skill 规范完整执行
2. dev/fix 编码后必须运行 lint/typecheck/test；TypeScript 项目优先项目既有 `typecheck`，否则至少执行 1 次 `tsc --noEmit` 这类无产物校验（error ≤ 2 次迭代）
3. 2 次仍失败 → 停止，输出错误摘要标 ⚠️ 等待用户决策
4. 涉及规范、控制面、路径、模板、部署或校验链语义变更时，ECR 后必须执行 SCV（Spec Change Verification）
5. 触发宿主能力选择时必须保留 `OriginalInstructionRefV1` 与 portable fallback；native lever 不得改变 CP/Auto/S01~S07
6. 执行完成后进入 ⑨ 执行阶段合规检查

---

## 与主流程关系

- 主流程入口见：[主流程图](./flowcharts)
- 上游阶段见：[⑦ 路由到工作流流程图](./routing-flow)
- 下游阶段见：[⑨ 执行阶段合规检查流程图](./exec-compliance-flow)

> 约束：工作流执行为主链必经阶段，不可跳过。
